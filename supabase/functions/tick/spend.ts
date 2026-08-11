// AGENTS.md hard rule 1: no code path calls Places or PSI without reserve_api_calls()
// returning free or paid immediately before it. These are the only two functions that
// touch the spend gate.

import type { Sql } from './db.ts';

export type Grant = 'free' | 'paid' | 'denied' | 'no_budget';

export async function reserve(sql: Sql, tenant: string, api: string, sku: string, n = 1): Promise<Grant> {
  const [row] = await sql`select public.reserve_api_calls(${tenant}, ${api}, ${sku}, ${n}) as grant`;
  return row.grant as Grant;
}

export async function refund(sql: Sql, tenant: string, api: string, sku: string, n: number, kind: Grant): Promise<void> {
  await sql`select public.refund_api_calls(${tenant}, ${api}, ${sku}, ${n}, ${kind})`;
}

// Logged once per actual attempt (i.e. only when reserve() returned free/paid and the
// call was made) — the per-call history the dashboard and Google billing reconciliation
// read from. Running totals live on api_budgets; this table is only the log.
export async function logCall(sql: Sql, args: {
  tenant: string; scanId: string; api: string; sku: string; grantKind: Grant; httpStatus: number | null;
}): Promise<void> {
  await sql`insert into api_calls (tenant_id, scan_id, api, sku, grant_kind, http_status)
    values (${args.tenant}, ${args.scanId}, ${args.api}, ${args.sku}, ${args.grantKind}, ${args.httpStatus})`;
}
