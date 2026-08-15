// recheck-psi — spec 0005 AC-7, AC-8, AC-27, AC-29.
//
// Measures ONE business on demand, from the lead detail page's Recheck button. This is the
// other half of "capture screenshots on measurement, never in bulk": the engine keeps the
// screenshot of everything it measures during a scan, and this function is how you get a
// fresh one for the lead you happen to be looking at. There is no backfill job anywhere.
//
// Two connections, deliberately. `reserve_api_calls` was revoked from `authenticated` in
// migration 18, and `current_tenant()` returns null on a service role connection, so
// neither one client can both identify the caller and spend on their behalf:
//
//   - identity: an anon-key supabase-js client carrying the caller's Authorization header,
//     exactly as scan-create does it.
//   - work: a separate service-role postgres connection, used only after the business has
//     been proven to belong to the tenant that token resolves to.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createDbClient, tryAdvisoryLock, advisoryUnlock } from '../_shared/db.ts';
import { reserve, refund, recordStatus, isGranted } from '../_shared/spend.ts';
import { runPsi, snapshotPath, uploadSnapshot } from '../_shared/psi-extract.ts';
import type { PsiOutcome } from '../_shared/psi-extract.ts';

const SUCCESS_WINDOW_MS = 24 * 60 * 60 * 1000; // performance rarely moves within a day
const FAILURE_WINDOW_MS = 60 * 60 * 1000;      // an unreachable site is worth retrying sooner

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Missing bearer token' }, 401);
  }

  let body: { business_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const businessId = body.business_id;
  if (typeof businessId !== 'string' || businessId.length === 0) {
    return json({ error: 'business_id is required' }, 422);
  }

  // ---- Step 1: identity. -----------------------------------------------------------
  const identity = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );

  const { data: tenantId, error: tenantErr } = await identity.rpc('current_tenant');
  if (tenantErr || !tenantId) {
    return json({ error: 'Unable to resolve tenant for this token' }, 401);
  }

  // ---- Step 2: the demo tenant, refused before anything is reserved. ----------------
  // reserve_api_calls() does not check this the way approve_spend() and cancel_scan() do,
  // so it has to be explicit. The UI disables the button too, but that is the courtesy —
  // this is the control.
  const { data: isDemo } = await identity.rpc('current_tenant_is_demo');
  if (isDemo === true) {
    return json({ error: 'The demo tenant cannot spend API calls.' }, 403);
  }

  // The acting user, for the lead_events row. auth.uid() is null on the service role
  // connection that does the writing, so the id has to come from here.
  const { data: userData } = await identity.auth.getUser();
  const actor = userData?.user?.id ?? null;

  const sql = createDbClient();
  let lockKey: number | null = null;

  try {
    // ---- Step 3: ownership, which also supplies the lead the event attaches to. -----
    const [lead] = await sql`
      select l.id as lead_id, b.website_url, b.website_kind
        from leads l
        join businesses b on b.id = l.business_id
       where l.business_id = ${businessId} and l.tenant_id = ${tenantId}`;

    // A business in another tenant and a business that does not exist are the same
    // answer, deliberately — the caller must not be able to tell them apart.
    if (!lead) return json({ error: 'No lead found for this business.' }, 404);

    if (!lead.website_url) {
      return json({ error: 'This business has no website to measure.' }, 422);
    }

    // ---- Step 4: the concurrency guard. --------------------------------------------
    // Session-level, held across the whole measurement, released in the finally below.
    //
    // It cannot be the transaction-scoped variant, and there is deliberately no
    // transaction here at all. Those pull in opposite directions and getting one right at
    // the cost of the other is the trap:
    //
    //   - No transaction may span the fetch. reserve_api_calls takes `for update` on the
    //     tenant's api_budgets row, so a transaction held across a 10–35s PageSpeed call
    //     would block every psi reservation in a running tick at concurrency 4. There is
    //     no lock cycle so it would never deadlock — which is worse, because it would
    //     present as unexplained slowness rather than as an error.
    //   - But mutual exclusion must outlast the fetch. pg_try_advisory_xact_lock releases
    //     at commit, and the psi_results row the guard below reads is not written for
    //     another 30 seconds, so two presses a second apart would both take the lock, both
    //     find the guard clear, both reserve and both measure. Nothing downstream catches
    //     it either: psi_results_business_scan_uidx is partial on `scan_id is not null`
    //     and a recheck writes a null scan_id.
    //
    // hashtext() is applied to the uuid cast to text — there is no hashtext(uuid) overload.
    const [k] = await sql`select hashtext(${businessId}::text) as key`;
    lockKey = Number(k.key);

    if (!(await tryAdvisoryLock(sql, lockKey))) {
      lockKey = null; // not ours to release
      return json({ error: 'A recheck of this business is already running.' }, 409);
    }

    // ---- Step 5: the guard window. --------------------------------------------------
    // A product rule, not a budget one. available_at is computed server-side so a client
    // with a wrong clock corrects itself.
    const [last] = await sql`
      select checked_at, error from psi_results
       where business_id = ${businessId}
       order by checked_at desc limit 1`;

    if (last) {
      const window = last.error == null ? SUCCESS_WINDOW_MS : FAILURE_WINDOW_MS;
      const availableAt = new Date(new Date(last.checked_at).getTime() + window);
      if (Date.now() < availableAt.getTime()) {
        return json({
          error: 'Measured too recently.',
          available_at: availableAt.toISOString(),
        }, 429);
      }
    }

    // ---- Step 6: the reservation. ---------------------------------------------------
    // Everything above consumes none, which is the point of the ordering: a request
    // refused for the demo tenant, for ownership, for the lock or for the guard leaves
    // api_budgets.used untouched.
    const r = await reserve(sql, tenantId, 'psi', 'free', null, 1);
    if (!isGranted(r)) {
      return json({ error: 'The PageSpeed allowance is exhausted. Approve more calls first.' }, 402);
    }

    // ---- Step 7: the measurement. ---------------------------------------------------
    // If anything throws between the reservation and Google, the reservation goes back —
    // hard rule 1 says hand it back with refund_api_call, never by decrementing `used`. A
    // call that *reached* Google is never refunded, matching psi.ts: PageSpeed is billed
    // at zero but still consumes the free allowance, and the ledger should record that it
    // happened.
    let outcome: PsiOutcome;
    try {
      outcome = await runPsi(lead.website_url);
    } catch (e) {
      await refund(sql, r.callId);
      throw e;
    }

    await recordStatus(sql, r.callId, outcome.httpStatus);

    // ---- Step 8: always write both rows, success or failure. ------------------------
    // A failed recheck that wrote nothing could not satisfy AC-5 — a site that fails to
    // load is itself a sales signal and belongs in the timeline with its reason.
    //
    // scan_id is null, and roll_psi_completed() guards on `new.scan_id is not null`, so a
    // recheck can never move a running scan's psi_completed counter.
    const [psiRow] = await sql`
      insert into psi_results (business_id, scan_id, strategy, score, lcp_ms, cls, tbt_ms, fcp_ms, si_ms, error)
      values (${businessId}, null, 'mobile', ${outcome.score}, ${outcome.lcpMs}, ${outcome.cls},
              ${outcome.tbtMs}, ${outcome.fcpMs}, ${outcome.siMs}, ${outcome.error})
      returning id, checked_at`;

    await sql`
      insert into lead_events (lead_id, type, payload)
      values (${lead.lead_id}, 'rechecked_psi',
              jsonb_build_object('actor', ${actor}::uuid, 'score', ${outcome.score}::int,
                                 'error', ${outcome.error}::text,
                                 'psi_result_id', ${psiRow.id}::bigint))`;

    // ---- Step 9: the screenshot, only when one came back. ---------------------------
    let snapshotPathValue: string | null = null;
    let snapshotError: string | null = null;

    if (outcome.screenshot) {
      const path = snapshotPath(tenantId, businessId, psiRow.id);
      snapshotError = await uploadSnapshot(path, outcome.screenshot);
      if (!snapshotError) {
        await sql`
          insert into site_snapshots (business_id, psi_result_id, storage_path, viewport)
          values (${businessId}, ${psiRow.id}, ${path}, 'mobile')
          on conflict do nothing`;
        snapshotPathValue = path;
      }
    }

    return json({
      psi_result_id: String(psiRow.id),
      checked_at: psiRow.checked_at,
      score: outcome.score,
      lcp_ms: outcome.lcpMs,
      cls: outcome.cls,
      tbt_ms: outcome.tbtMs,
      fcp_ms: outcome.fcpMs,
      si_ms: outcome.siMs,
      error: outcome.error,
      snapshot_path: snapshotPathValue,
      snapshot_error: snapshotError,
      grant_kind: r.grant,
    });
  } catch (e) {
    console.error('recheck-psi failed:', e);
    return json({ error: 'The recheck could not be completed.' }, 500);
  } finally {
    // Released before the connection closes rather than relying on it. `max: 1` means the
    // lock would die with the connection anyway, but only once the pooler noticed.
    if (lockKey !== null) await advisoryUnlock(sql, lockKey).catch(() => {});
    await sql.end({ timeout: 5 });
  }
});
