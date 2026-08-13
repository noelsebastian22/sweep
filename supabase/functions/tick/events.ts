// The scan_events log (migration 19) — what the live scan screen renders.
//
// Two rules for everything in here:
//
//   1. Logging must never fail a scan. A broken log line is a cosmetic problem; a tick
//      that throws because of one is not. Every write is swallowed.
//   2. Messages are user-facing copy, in Australian English, and get read on screen with
//      no other context. "Electrician · Katoomba — 12 found, 3 new" beats
//      "query 4f2a done".

import type { Sql } from './db.ts';

export type EventKind = 'stage' | 'query' | 'discovery' | 'spend' | 'error';

export async function logEvent(
  sql: Sql,
  scanId: string,
  tenantId: string,
  kind: EventKind,
  message: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await sql`
      insert into scan_events (scan_id, tenant_id, kind, message, detail)
      values (${scanId}, ${tenantId}, ${kind}, ${message},
              ${detail ? sql.json(detail) : null})`;
  } catch (e) {
    // Deliberately swallowed — see rule 1 above. Still worth a line in the function logs.
    console.error('scan_events insert failed', String(e).slice(0, 200));
  }
}

/**
 * How many more calls the gate would grant right now, via migration 20's
 * `budget_headroom()`.
 *
 * This is what lets a parked scan tell "still blocked" from "a grant landed". Before it
 * existed, tick flipped `awaiting_approval` straight back to `searching` on every tick, so
 * a genuinely blocked scan looped park → resume → denied → park once a minute forever and
 * the UI could only ever say "waiting for you" about something that was not waiting.
 */
export async function headroom(
  sql: Sql, tenant: string, api: string, sku: string,
): Promise<number> {
  const [row] = await sql`
    select public.budget_headroom(${tenant}, ${api}, ${sku}) as n`;
  return Number(row?.n ?? 0);
}

/** The budget a scan draws on in each of its two working stages. */
export const STAGE_BUDGET = {
  searching: { api: 'places_text_search', sku: 'enterprise' },
  measuring: { api: 'psi', sku: 'free' },
} as const;
