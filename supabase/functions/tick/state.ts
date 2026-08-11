// Shared scan-state queries — picking the active scan, enqueueing its first batch, and
// checking whether a stage has fully resolved. Kept separate from advance.ts, which owns
// the two state-machine transitions (their cutoff/lead logic), not the plumbing around them.

import type { Sql } from './db.ts';
import { sendMessage } from './queue.ts';

export interface ActiveScan {
  id: string;
  tenant_id: string;
  status: string;
}

// AC-2: the oldest scan whose status is queued, searching, measuring, or
// awaiting_approval, across all tenants. awaiting_approval is included deliberately —
// that's what lets a parked scan resume on its own, with no separate un-park mechanism.
export async function pickActiveScan(sql: Sql): Promise<ActiveScan | null> {
  const [scan] = await sql`
    select id, tenant_id, status from scans
     where status in ('queued', 'searching', 'measuring', 'awaiting_approval')
     order by created_at asc
     limit 1`;
  return (scan as ActiveScan) ?? null;
}

// The first time tick picks a scan up while still queued: batch its scan_queries onto
// sweep_search. This is the only place messages ever get enqueued (AC-1/AC-2) — what
// keeps exactly one scan's messages in flight system-wide.
export async function enqueueSearchBatch(sql: Sql, scan: ActiveScan): Promise<void> {
  const rows = await sql`
    select sq.id as query_id, sq.trade_id, t.name as trade_name, t.google_type,
           sq.suburb_id, s.name as suburb_name, s.lat, s.lng
      from scan_queries sq
      join trades t on t.id = sq.trade_id
      join suburbs s on s.id = sq.suburb_id
     where sq.scan_id = ${scan.id} and sq.status = 'pending'`;

  for (const row of rows) {
    await sendMessage(sql, 'sweep_search', {
      scan_id: scan.id,
      query_id: row.query_id,
      tenant_id: scan.tenant_id,
      trade_id: row.trade_id,
      trade_name: row.trade_name,
      google_type: row.google_type,
      suburb_id: row.suburb_id,
      suburb_name: row.suburb_name,
      lat: row.lat,
      lng: row.lng,
    });
  }
}

export async function searchFullyResolved(sql: Sql, scanId: string): Promise<boolean> {
  const [row] = await sql`
    select total_queries, completed_queries, failed_queries from scans where id = ${scanId}`;
  return row.completed_queries + row.failed_queries >= row.total_queries;
}

export async function psiFullyResolved(sql: Sql, scanId: string): Promise<boolean> {
  const [row] = await sql`select psi_total, psi_completed from scans where id = ${scanId}`;
  return row.psi_completed >= row.psi_total;
}

export async function currentStatus(sql: Sql, scanId: string): Promise<string> {
  const [row] = await sql`select status from scans where id = ${scanId}`;
  return row.status as string;
}
