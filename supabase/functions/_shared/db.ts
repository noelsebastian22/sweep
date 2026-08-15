// A direct Postgres connection (not supabase-js/PostgREST) — the engine needs raw pgmq
// calls (an extension schema PostgREST doesn't expose) and conflict-aware upserts
// PostgREST's upsert can't express (preserve one column, overwrite the rest). One client
// per invocation, closed in a `finally` by the caller.
//
// Shared by `tick` and `recheck-psi`. They are separate deploy units, so both must be
// redeployed whenever anything in `_shared/` changes.

import postgres from 'postgres';

export type Sql = ReturnType<typeof postgres>;

export function createDbClient(): Sql {
  const url = Deno.env.get('SUPABASE_DB_URL');
  if (!url) throw new Error('Missing SUPABASE_DB_URL');
  return postgres(url, { prepare: false, max: 1 });
}

/**
 * Session-level advisory locks, deliberately not the `_xact_` variants.
 *
 * A session-level lock is not a transaction and takes no row lock, so it can be held
 * across a slow external call — a 120s tick, or a 10–35s PageSpeed fetch — without
 * blocking anything else in the database. A transaction-scoped lock would release at
 * commit, which is exactly wrong for both callers: they need mutual exclusion to outlast
 * the work, not the statement.
 *
 * Both callers run `max: 1`, so the lock also dies with the connection if the function is
 * killed mid-flight rather than leaking until the pooler recycles.
 */
export async function tryAdvisoryLock(sql: Sql, key: number): Promise<boolean> {
  const [row] = await sql`select pg_try_advisory_lock(${key}) as locked`;
  return row.locked as boolean;
}

export async function advisoryUnlock(sql: Sql, key: number): Promise<void> {
  await sql`select pg_advisory_unlock(${key})`;
}
