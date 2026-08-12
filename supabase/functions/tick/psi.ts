// AC-5, AC-7, AC-8, AC-10 — drains sweep_psi for the active scan.
//
// AGENTS.md hard rule 4: never store raw PageSpeed JSON (a single response is ~600KB
// against a 500MB free tier). Only the five metrics below and the score are kept; the
// final-screenshot audit and everything else in the payload is discarded (screenshot
// extraction is its own out-of-scope feature this weekend — AC-11).

import type { Sql } from './db.ts';
import { archiveMessage, readQueue, releaseMessage } from './queue.ts';
import { reserve, recordStatus } from './spend.ts';
import { pool, sleep } from './lib.ts';
import type { ActiveScan } from './state.ts';

const CONCURRENCY = 4;
const READ_VT = 120;

interface PsiMessage {
  scan_id: string;
  business_id: string;
  tenant_id: string;
  website_url: string;
}

interface PsiOutcome {
  httpStatus: number | null;
  score: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
  siMs: number | null;
  error: string | null;
}

// Two-attempt retry, 4xx early exit — ported verbatim from harvest.mjs's psi().
async function runPsi(url: string): Promise<PsiOutcome> {
  const q = new URLSearchParams({
    url, strategy: 'mobile', category: 'performance', key: Deno.env.get('GOOGLE_PSI_API_KEY')!,
  });
  let last: string | null = null;
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`);
      lastStatus = res.status;
      if (res.ok) {
        const json = await res.json();
        const audits = json?.lighthouseResult?.audits ?? {};
        const s = json?.lighthouseResult?.categories?.performance?.score;
        return {
          httpStatus: res.status,
          score: s == null ? null : Math.round(s * 100),
          lcpMs: audits['largest-contentful-paint']?.numericValue != null ? Math.round(audits['largest-contentful-paint'].numericValue) : null,
          cls: audits['cumulative-layout-shift']?.numericValue ?? null,
          tbtMs: audits['total-blocking-time']?.numericValue != null ? Math.round(audits['total-blocking-time'].numericValue) : null,
          fcpMs: audits['first-contentful-paint']?.numericValue != null ? Math.round(audits['first-contentful-paint'].numericValue) : null,
          siMs: audits['speed-index']?.numericValue != null ? Math.round(audits['speed-index'].numericValue) : null,
          error: s == null ? 'no score returned' : null,
        };
      }
      last = `HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) break; // 4xx won't fix itself
    } catch (e) {
      last = String(e).slice(0, 40);
    }
    await sleep(3000);
  }
  return {
    httpStatus: lastStatus, score: null, lcpMs: null, cls: null, tbtMs: null, fcpMs: null, siMs: null,
    error: last || 'unreachable',
  };
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
      if (r.grant === 'denied' || r.grant === 'no_budget') {
        await sql`update scans set status = 'awaiting_approval' where id = ${scan.id}`;
        parked = true;
        return;
      }

      // runPsi can span ~35s across its two attempts and the sleep between them. Before
      // migration 18 the ledger row was only written after it returned, so a kill inside
      // that window orphaned the reservation; the row now already exists and this only
      // fills in the outcome.
      const outcome = await runPsi(payload.website_url);
      await recordStatus(sql, r.callId, outcome.httpStatus);

      try {
        await sql`
          insert into psi_results (business_id, scan_id, strategy, score, lcp_ms, cls, tbt_ms, fcp_ms, si_ms, error)
          values (${payload.business_id}, ${scan.id}, 'mobile', ${outcome.score}, ${outcome.lcpMs}, ${outcome.cls}, ${outcome.tbtMs}, ${outcome.fcpMs}, ${outcome.siMs}, ${outcome.error})`;
      } catch (e) {
        // 23505 = unique_violation — a sibling redelivery won the race; already done, not an error.
        if ((e as { code?: string }).code !== '23505') throw e;
      }

      await archiveMessage(sql, 'sweep_psi', m.msg_id);
    });

    if (parked) break;
  }
}
