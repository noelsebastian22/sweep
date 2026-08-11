// AC-3, AC-7, AC-8, AC-10, AC-13 — drains sweep_search for the active scan.

import type { Sql } from './db.ts';
import { archiveMessage, readQueue, releaseMessage } from './queue.ts';
import { reserve, refund, logCall } from './spend.ts';
import { isTradeBusiness, pool, trueTrade, norm, websiteKind, type Place } from './lib.ts';
import type { ActiveScan } from './state.ts';

const CONCURRENCY = 5;
const READ_VT = 120;

interface SearchMessage {
  scan_id: string;
  query_id: number;
  tenant_id: string;
  trade_id: string;
  trade_name: string;
  google_type: string | null;
  suburb_id: string;
  suburb_name: string;
  lat: number | null;
  lng: number | null;
}

// Reservation immediately before every attempt, including the untyped retry — the retry
// is its own reservation, refunding the first one, never an exception to the gate.
async function textSearchGated(
  sql: Sql, tenant: string, scanId: string, tradeName: string, googleType: string | null, suburbName: string, useType = true,
): Promise<
  | { blocked: true }
  | { ok: true; httpStatus: number; places: Place[] }
  | { ok: false; httpStatus: number; quotaHit: boolean; bodySnippet: string }
> {
  const grant = await reserve(sql, tenant, 'places_text_search', 'enterprise', 1);
  if (grant === 'denied' || grant === 'no_budget') return { blocked: true };

  const body: Record<string, unknown> = {
    textQuery: `${tradeName} in ${suburbName} NSW`, maxResultCount: 20, regionCode: 'AU',
  };
  if (googleType && useType) { body.includedType = googleType; body.strictTypeFiltering = true; }

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': Deno.env.get('GOOGLE_PLACES_API_KEY')!,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,'
        + 'places.websiteUri,places.rating,places.userRatingCount,places.types,places.primaryType,places.businessStatus',
    },
    body: JSON.stringify(body),
  });

  await logCall(sql, { tenant, scanId, api: 'places_text_search', sku: 'enterprise', grantKind: grant, httpStatus: res.status });

  // Google doesn't recognise the type name — fall back to an untyped search rather than
  // losing the query. Refund this reservation first; the retry makes its own.
  if (res.status === 400 && googleType && useType) {
    await refund(sql, tenant, 'places_text_search', 'enterprise', 1, grant);
    return textSearchGated(sql, tenant, scanId, tradeName, googleType, suburbName, false);
  }
  if (!res.ok) {
    return { ok: false, httpStatus: res.status, quotaHit: res.status === 429, bodySnippet: (await res.text()).slice(0, 200) };
  }
  const json = await res.json();
  return { ok: true, httpStatus: res.status, places: json.places || [] };
}

async function upsertBusiness(sql: Sql, args: {
  tenantId: string; scanId: string; tradeId: string; suburbId: string; place: Place;
}): Promise<void> {
  const { tenantId, scanId, tradeId, suburbId, place: p } = args;
  await sql`
    insert into businesses (
      tenant_id, google_place_id, name, name_norm, trade_id, suburb_id, phone,
      website_url, website_kind, address, rating, rating_count, primary_type, types,
      business_status, first_seen_scan_id, last_scan_id, last_seen_at
    ) values (
      ${tenantId}, ${p.id}, ${p.displayName?.text?.slice(0, 200) ?? p.id}, ${norm(p.displayName?.text)},
      ${tradeId}, ${suburbId}, ${p.nationalPhoneNumber ?? null},
      ${p.websiteUri ?? null}, ${websiteKind(p.websiteUri)}, ${p.formattedAddress ?? null},
      ${p.rating ?? null}, ${p.userRatingCount ?? null}, ${p.primaryType ?? null}, ${p.types ?? []},
      ${p.businessStatus ?? null}, ${scanId}, ${scanId}, now()
    )
    on conflict (tenant_id, google_place_id) do update set
      name = excluded.name,
      name_norm = excluded.name_norm,
      trade_id = excluded.trade_id,
      suburb_id = excluded.suburb_id,
      phone = excluded.phone,
      website_url = excluded.website_url,
      website_kind = excluded.website_kind,
      address = excluded.address,
      rating = excluded.rating,
      rating_count = excluded.rating_count,
      primary_type = excluded.primary_type,
      types = excluded.types,
      business_status = excluded.business_status,
      last_scan_id = excluded.last_scan_id,
      last_seen_at = excluded.last_seen_at
    -- first_seen_scan_id is deliberately absent from this SET list: omitting it is what
    -- preserves it on conflict while still setting it correctly on a fresh insert.
  `;
}

export async function drainSearch(sql: Sql, scan: ActiveScan, deadline: number): Promise<void> {
  const trades = await sql`select id, name from trades where tenant_id = ${scan.tenant_id}`;
  const tradesByName = new Map(trades.map((t) => [t.name as string, t.id as string]));

  while (Date.now() < deadline) {
    const msgs = await readQueue<SearchMessage>(sql, 'sweep_search', READ_VT, CONCURRENCY * 3);
    if (msgs.length === 0) break;

    let parked = false;
    await pool(msgs, CONCURRENCY, async (m) => {
      const payload = m.message;

      if (payload.scan_id !== scan.id) {
        await releaseMessage(sql, 'sweep_search', m.msg_id);
        return;
      }

      const [q] = await sql`select status from scan_queries where id = ${payload.query_id}`;
      if (!q || q.status === 'done' || q.status === 'failed') {
        await archiveMessage(sql, 'sweep_search', m.msg_id);
        return;
      }

      if (parked) return; // a sibling in this batch already parked the scan; leave unarchived

      const result = await textSearchGated(sql, payload.tenant_id, scan.id, payload.trade_name, payload.google_type, payload.suburb_name);

      if ('blocked' in result) {
        await sql`update scans set status = 'awaiting_approval' where id = ${scan.id}`;
        parked = true;
        return;
      }

      if (!result.ok) {
        await sql`update scan_queries set status = 'failed', http_status = ${result.httpStatus},
          error = ${result.bodySnippet}, completed_at = now() where id = ${payload.query_id}`;
        if (result.quotaHit) await sql`update scans set quota_hit = true where id = ${scan.id}`;
        await archiveMessage(sql, 'sweep_search', m.msg_id);
        return;
      }

      let kept = 0;
      for (const p of result.places) {
        if (!isTradeBusiness(p)) continue;
        kept++;
        const finalTradeName = trueTrade(p, payload.trade_name);
        const tradeId = tradesByName.get(finalTradeName) ?? payload.trade_id;
        await upsertBusiness(sql, { tenantId: payload.tenant_id, scanId: scan.id, tradeId, suburbId: payload.suburb_id, place: p });
      }

      await sql`update scan_queries set status = 'done', http_status = ${result.httpStatus},
        results_count = ${kept}, completed_at = now() where id = ${payload.query_id}`;
      await archiveMessage(sql, 'sweep_search', m.msg_id);
    });

    if (parked) break;
  }
}
