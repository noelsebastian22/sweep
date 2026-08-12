// tick — the only cron-triggered function (AC-2). pg_cron wakes it every minute over
// pg_net; it finds the one active scan across all tenants, drives it forward as far as
// the shared 120s budget allows, and returns.

import { createDbClient, tryLock, unlock } from './db.ts';
import { pickActiveScan, enqueueSearchBatch, searchFullyResolved, psiFullyResolved, currentStatus } from './state.ts';
import { drainSearch } from './search.ts';
import { drainPsi } from './psi.ts';
import { advanceAfterSearch, advanceAfterPsi } from './advance.ts';

const BUDGET_MS = 120_000; // 30s headroom under the free-plan 150s wall clock

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const sql = createDbClient();
  const deadline = Date.now() + BUDGET_MS;

  try {
    const locked = await tryLock(sql);
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
      } else if (scan.status === 'awaiting_approval') {
        // Resume from wherever it stalled: the stage that hasn't fully resolved yet.
        const target = (await searchFullyResolved(sql, scan.id)) ? 'measuring' : 'searching';
        await sql`update scans set status = ${target} where id = ${scan.id}`;
        scan.status = target;
      }

      if (scan.status === 'searching') {
        await drainSearch(sql, scan, deadline);
        const status = await currentStatus(sql, scan.id);
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
        if (status !== 'awaiting_approval' && (await psiFullyResolved(sql, scan.id))) {
          await advanceAfterPsi(sql, scan.id);
        }
      }

      return json({ processed: true, scan_id: scan.id, reason: null });
    } finally {
      await unlock(sql);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
});
