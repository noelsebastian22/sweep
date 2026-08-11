// Thin wrappers over pgmq's own functions. pgmq lives in its own schema (not exposed via
// PostgREST), which is why tick talks to Postgres directly rather than through
// supabase-js for any of this.

import type { Sql } from './db.ts';

export interface QueueMessage<T> {
  msg_id: string | number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: T;
}

export async function readQueue<T>(sql: Sql, queue: string, vt: number, qty: number): Promise<QueueMessage<T>[]> {
  return (await sql`select * from pgmq.read(${queue}, ${vt}, ${qty})`) as unknown as QueueMessage<T>[];
}

export async function archiveMessage(sql: Sql, queue: string, msgId: string | number): Promise<void> {
  await sql`select pgmq.archive(${queue}, ${msgId}::bigint)`;
}

// Zero visibility timeout — immediately eligible for a future tick, never held or
// dropped. Used for a message that belongs to a scan other than the one currently active.
export async function releaseMessage(sql: Sql, queue: string, msgId: string | number): Promise<void> {
  await sql`select pgmq.set_vt(${queue}, ${msgId}::bigint, 0)`;
}

export async function sendMessage(sql: Sql, queue: string, payload: unknown): Promise<void> {
  await sql`select pgmq.send(${queue}, ${sql.json(payload as object)})`;
}
