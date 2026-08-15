// tick — the only cron-triggered function (AC-2). pg_cron wakes it every minute over
// pg_net; it finds the one active scan across all tenants, drives it forward as far as
// the shared 120s budget allows, and returns.
//
// One consequence of picking strictly the oldest active scan: a scan parked on
// `awaiting_approval` sits at the head of that queue and blocks every scan behind it until
// it is either funded or cancelled. That is deliberate — skipping past it would put two
// scans' messages in flight at once, which is exactly the invariant AC-2 exists to hold —
// and it is why `cancel_scan()` had to exist before parking could be made to actually park.

import { createDbClient, tryAdvisoryLock, advisoryUnlock } from '../_shared/db.ts';
import { pickActiveScan, enqueueSearchBatch, searchFullyResolved, psiFullyResolved, currentStatus } from './state.ts';
import { drainSearch } from './search.ts';
import { drainPsi } from './psi.ts';
import { advanceAfterSearch, advanceAfterPsi } from './advance.ts';
import { headroom, logEvent, STAGE_BUDGET } from './events.ts';

const BUDGET_MS = 120_000; // 30s headroom under the free-plan 150s wall clock

// AC-12: two tick invocations never run concurrently. Session-level and held for the
// request's duration on the same reserved connection, so it survives across every query
// the request makes. `recheck-psi` locks on a different key, derived per business, so the
// two functions never contend.
const TICK_LOCK_KEY = 841205551;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const sql = createDbClient();
  const deadline = Date.now() + BUDGET_MS;

  try {
    const locked = await tryAdvisoryLock(sql, TICK_LOCK_KEY);
    // reason distinguishes the two ways a tick can decline to do work. They were
    // indistinguishable in the response until now, which made AC-12's guard impossible to
    // observe from outside: a refused lock and an idle system looked identical.
    if (!locked) return json({ processed: false, scan_id: null, reason: 'locked' });

    try {
      const scan = await pickActiveScan(sql);
      if (!scan) return json({ processed: false, scan_id: null, reason: 'no_active_scan' });

      if (scan.status === 'queued') {
        await enqueueSearchBatch(sql, scan);
        await sql`update scans set status = 'searching', started_at = coalesce(started_at, now()) where id = ${scan.id}`;
        scan.status = 'searching';
        const [t] = await sql`select total_queries from scans where id = ${scan.id}`;
        await logEvent(sql, scan.id, scan.tenant_id, 'stage',
          `Scan started — ${t.total_queries} queries queued`, { total_queries: t.total_queries });
      } else if (scan.status === 'awaiting_approval') {
        // Resume from wherever it stalled: the stage that hasn't fully resolved yet.
        const target = (await searchFullyResolved(sql, scan.id)) ? 'measuring' : 'searching';

        // The park fix. This used to flip straight back to `target` unconditionally, so a
        // scan blocked on a spend denial resumed every single tick, immediately got denied
        // again, and re-parked — a park/resume/deny loop once a minute, forever. Nothing
        // was broken enough to notice; it just meant `awaiting_approval` never actually
        // parked, and the UI could not honestly say "waiting for approval" about it.
        //
        // Now it only leaves the parked state when a grant has genuinely created room.
        // That makes approval the sole un-park mechanism and keeps it automatic: land a
        // grant, and the next tick picks the scan straight back up.
        const b = STAGE_BUDGET[target];
        const room = await headroom(sql, scan.tenant_id, b.api, b.sku);
        if (room <= 0) {
          // Deliberately silent — this path runs every minute for as long as the scan
          // stays parked, and logging here would bury the real log under a heartbeat.
          // The event explaining *why* it parked was written once, at denial.
          return json({ processed: false, scan_id: scan.id, reason: 'awaiting_approval' });
        }

        await sql`update scans set status = ${target} where id = ${scan.id}`;
        scan.status = target;
        await logEvent(sql, scan.id, scan.tenant_id, 'stage',
          `Resumed — ${room.toLocaleString('en-AU')} ${b.api} calls now available`,
          { stage: target, headroom: room });
      }

      // A scan can be cancelled (migration 20's cancel_scan) at any moment, including
      // while this very tick is mid-drain. Every re-read of the status below is therefore
      // checked against `settled` rather than against 'awaiting_approval' alone — without
      // that, a scan cancelled during drainSearch would be advanced to 'measuring' on the
      // next line and quietly un-cancel itself.
      const settled = (s: string) =>
        s === 'cancelled' || s === 'completed' || s === 'partial' || s === 'failed';

      if (scan.status === 'searching') {
        await drainSearch(sql, scan, deadline);
        const status = await currentStatus(sql, scan.id);
        if (settled(status)) return json({ processed: true, scan_id: scan.id, reason: status });
        if (status !== 'awaiting_approval' && (await searchFullyResolved(sql, scan.id))) {
          await advanceAfterSearch(sql, scan.id);
          scan.status = 'measuring';
        } else {
          scan.status = status;
        }
      }

      if (scan.status === 'measuring' && Date.now() < deadline) {
        await drainPsi(sql, scan, deadline);
        const status = await currentStatus(sql, scan.id);
        if (settled(status)) return json({ processed: true, scan_id: scan.id, reason: status });
        if (status !== 'awaiting_approval' && (await psiFullyResolved(sql, scan.id))) {
          await advanceAfterPsi(sql, scan.id);
        }
      }

      return json({ processed: true, scan_id: scan.id, reason: null });
    } finally {
      await advisoryUnlock(sql, TICK_LOCK_KEY);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
});
