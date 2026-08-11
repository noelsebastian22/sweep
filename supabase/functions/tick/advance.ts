// The two state-machine transitions. AC-4 (search -> measuring), AC-6 (measuring -> final).

import type { Sql } from './db.ts';
import { sendMessage } from './queue.ts';
import { ceiling } from './lib.ts';

// AC-4: once every scan_queries row is resolved, compute the ceiling cutoff over
// businesses *this scan* touched (last_scan_id, not first_seen_scan_id — see spec Feature
// design), batch the ones that could plausibly reach top_n and have a real website onto
// sweep_psi, and move the scan to measuring.
export async function advanceAfterSearch(sql: Sql, scanId: string): Promise<void> {
  const [scan] = await sql`select tenant_id, config from scans where id = ${scanId}`;
  const topN = (scan.config?.top_n as number | undefined) ?? 50;

  const candidates = await sql`
    select id, website_url, website_kind, rating, rating_count
      from businesses
     where last_scan_id = ${scanId}
     order by (coalesce(rating_count, 0) * (coalesce(rating, 0) / 5.0)) desc`;

  const ceilings = candidates.map((b) => ceiling(b.rating_count, b.rating));
  const cutoff = ceilings[topN * 2] ?? 0;

  const needPsi = candidates.filter((b, i) => b.website_kind === 'site' && ceilings[i] >= cutoff);

  for (const b of needPsi) {
    await sendMessage(sql, 'sweep_psi', {
      scan_id: scanId, business_id: b.id, tenant_id: scan.tenant_id, website_url: b.website_url,
    });
  }

  await sql`update scans set psi_total = ${needPsi.length}, status = 'measuring' where id = ${scanId}`;
}

// AC-6: every business the scan discovered gets a leads row, not only the ones that got a
// PSI check — a business with no website or a social-only page is frequently the best
// lead. top_n bounds only the PSI cutoff (AC-4), never which businesses become leads.
export async function advanceAfterPsi(sql: Sql, scanId: string): Promise<void> {
  await sql`
    insert into leads (tenant_id, business_id)
    select tenant_id, id from businesses where last_scan_id = ${scanId}
    on conflict (tenant_id, business_id) do nothing`;

  const [scan] = await sql`
    select total_queries, completed_queries, failed_queries, businesses_found
      from scans where id = ${scanId}`;

  // failed only if the scan produced zero businesses at all; partial if finished but some
  // queries failed; completed otherwise. A denied reservation never fails a scan_queries
  // row outright (it parks instead, per AC-7), so failed_queries already captures every
  // path a "partial" outcome can come from — there is no separate denial flag to source.
  const status = scan.businesses_found === 0 ? 'failed' : scan.failed_queries > 0 ? 'partial' : 'completed';

  await sql`update scans set status = ${status}, finished_at = now() where id = ${scanId}`;
}
