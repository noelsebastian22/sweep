// AGENTS.md hard rule 1: no code path calls Places or PSI without reserve_api_calls()
// returning free or paid immediately before it. These are the only functions that touch
// the spend gate.
//
// Since migration 18 the reservation also writes its own api_calls row, in the same
// transaction as the counter increment — so there is no window in which the counter has
// moved but the ledger has not. Everything below only fills in, or hands back, a row that
// reserve() already created.

import type { Sql } from './db.ts';

export type Grant = 'free' | 'paid' | 'denied' | 'no_budget';

// Discriminated on grant: a granted reservation always carries the ledger row's id, a
// refused one never does. Don't destructure it — narrowing on `grant` is what removes the
// need for a non-null assertion on callId at the call sites.
export type Reservation =
  | { grant: 'free' | 'paid'; callId: string }
  | { grant: 'denied' | 'no_budget'; callId: null };

export async function reserve(
  sql: Sql, tenant: string, api: string, sku: string, scanId: string, n = 1,
): Promise<Reservation> {
  const [row] = await sql`
    select grant_kind, call_id
      from public.reserve_api_calls(${tenant}, ${api}, ${sku}, ${n}, ${scanId})`;
  const grant = row.grant_kind as Grant;
  return grant === 'denied' || grant === 'no_budget'
    ? { grant, callId: null }
    : { grant, callId: String(row.call_id) };
}

// Hands a reservation back for a response Google does not bill. Idempotent by call id, so
// a redelivered message refunding the same row twice is a no-op.
export async function refund(sql: Sql, callId: string): Promise<void> {
  await sql`select public.refund_api_call(${callId}::bigint)`;
}

// Fills in the outcome of a call already on the ledger. Deliberately cannot create a row:
// if this never runs — a platform kill mid-fetch — the reservation still stands with a
// null http_status. That is the safe direction. The counter over-reports a call whose
// outcome we lost, rather than losing a call Google may have billed us for.
export async function recordStatus(
  sql: Sql, callId: string, httpStatus: number | null,
): Promise<void> {
  await sql`update api_calls set http_status = ${httpStatus} where id = ${callId}::bigint`;
}
