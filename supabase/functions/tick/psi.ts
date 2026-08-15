// AC-5, AC-7, AC-8, AC-10 — drains sweep_psi for the active scan.
//
// AGENTS.md hard rule 4: never store raw PageSpeed JSON (a single response is ~600KB
// against a 500MB free tier). Only the five metrics, the score, and the final-screenshot
// bytes survive a response; everything else is discarded when runPsi() returns.
//
// Spec 0005 AC-11: the screenshot is kept now rather than thrown away. It arrives at zero
// additional API cost, because the bytes are already in a response the engine has paid
// for — which is the whole reason capture happens on measurement and never in bulk.

import type { Sql } from '../_shared/db.ts';
import { archiveMessage, readQueue, releaseMessage } from './queue.ts';
import { reserve, recordStatus, isGranted } from '../_shared/spend.ts';
import { runPsi, snapshotPath, uploadSnapshot } from '../_shared/psi-extract.ts';
import { pool } from './lib.ts';
import { logEvent } from './events.ts';
import type { ActiveScan } from './state.ts';

const CONCURRENCY = 4;
const READ_VT = 120;

interface PsiMessage {
  scan_id: string;
  business_id: string;
  tenant_id: string;
  website_url: string;
}

export async function drainPsi(sql: Sql, scan: ActiveScan, deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    const msgs = await readQueue<PsiMessage>(sql, 'sweep_psi', READ_VT, CONCURRENCY * 3);
    if (msgs.length === 0) break;

    let parked = false;
    await pool(msgs, CONCURRENCY, async (m) => {
      const payload = m.message;

      if (payload.scan_id !== scan.id) {
        await releaseMessage(sql, 'sweep_psi', m.msg_id);
        return;
      }

      // Redelivery pre-check (the cheap path). The unique index below is the real
      // guarantee — two redelivered messages can both pass this check.
      const [existing] = await sql`
        select 1 from psi_results where business_id = ${payload.business_id} and scan_id = ${scan.id}`;
      if (existing) {
        await archiveMessage(sql, 'sweep_psi', m.msg_id);
        return;
      }

      if (parked) return;

      const r = await reserve(sql, payload.tenant_id, 'psi', 'free', scan.id, 1);
      if (!isGranted(r)) {
        // Claim the park synchronously, before any await — see the same guard in
        // search.ts. Every worker in the pool hits the denial together, and without this
        // each one writes its own copy of the pause message.
        const firstToPark = !parked;
        parked = true;

        await sql`update scans set status = 'awaiting_approval' where id = ${scan.id}`;
        if (firstToPark) {
          await logEvent(sql, scan.id, payload.tenant_id, 'spend',
            'Paused — the PageSpeed allowance is exhausted. Approve more calls to resume.',
            { api: 'psi', sku: 'free', stage: 'measuring' });
        }
        return;
      }

      // runPsi can span ~35s across its two attempts and the sleep between them. Before
      // migration 18 the ledger row was only written after it returned, so a kill inside
      // that window orphaned the reservation; the row now already exists and this only
      // fills in the outcome.
      const outcome = await runPsi(payload.website_url);
      await recordStatus(sql, r.callId, outcome.httpStatus);

      // `on conflict do nothing returning id` replaces the 23505 catch that used to sit
      // here: one mechanism for the redelivery race instead of two competing ones. The
      // conflict target is left implicit so it covers psi_results_business_scan_uidx,
      // which is partial on `scan_id is not null`.
      const [inserted] = await sql`
        insert into psi_results (business_id, scan_id, strategy, score, lcp_ms, cls, tbt_ms, fcp_ms, si_ms, error)
        values (${payload.business_id}, ${scan.id}, 'mobile', ${outcome.score}, ${outcome.lcpMs}, ${outcome.cls}, ${outcome.tbtMs}, ${outcome.fcpMs}, ${outcome.siMs}, ${outcome.error})
        on conflict do nothing
        returning id`;

      // AC-12. An empty returning set means a sibling redelivery won the race: the row
      // exists and its screenshot is already uploaded. Skipping here is what prevents a
      // duplicate *object* — the unique index on site_snapshots only constrains the row,
      // and by the time it fired the bytes would already be in the bucket.
      if (inserted && outcome.screenshot) {
        const path = snapshotPath(payload.tenant_id, payload.business_id, inserted.id);
        const uploadError = await uploadSnapshot(path, outcome.screenshot);
        if (uploadError) {
          // Not fatal: the measurement stands and the numbers are correct. The lead is
          // left with a measurement and no screenshot, which the detail page shows as an
          // empty frame rather than pretending nothing happened.
          console.error(`snapshot upload failed for ${payload.business_id}: ${uploadError}`);
        } else {
          await sql`
            insert into site_snapshots (business_id, psi_result_id, storage_path, viewport)
            values (${payload.business_id}, ${inserted.id}, ${path}, 'mobile')
            on conflict do nothing`;
        }
      }

      await archiveMessage(sql, 'sweep_psi', m.msg_id);

      // Host rather than the full URL: the log is a narrow column and the path adds
      // nothing. A site that fails to resolve is worth a line too — an unmeasurable site
      // is itself a signal about the lead, not noise to hide.
      let host = payload.website_url;
      try { host = new URL(payload.website_url).hostname.replace(/^www\./, ''); } catch { /* keep raw */ }

      await logEvent(sql, scan.id, payload.tenant_id,
        outcome.score == null ? 'error' : 'query',
        outcome.score == null
          ? `${host} — no PageSpeed score (${outcome.error ?? 'unknown'})`
          : `${host} — PageSpeed ${outcome.score}`,
        { business_id: payload.business_id, url: payload.website_url, score: outcome.score,
          lcp_ms: outcome.lcpMs, cls: outcome.cls, http_status: outcome.httpStatus,
          error: outcome.error });
    });

    if (parked) break;
  }
}
