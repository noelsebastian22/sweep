// A direct Postgres connection (not supabase-js/PostgREST) — tick needs raw pgmq calls
// (an extension schema PostgREST doesn't expose) and conflict-aware upserts PostgREST's
// upsert can't express (preserve one column, overwrite the rest). One client per
// invocation, closed in a `finally` in index.ts.

import postgres from 'postgres';

export type Sql = ReturnType<typeof postgres>;

export function createDbClient(): Sql {
  const url = Deno.env.get('SUPABASE_DB_URL');
  if (!url) throw new Error('Missing SUPABASE_DB_URL');
  return postgres(url, { prepare: false, max: 1 });
}

// AC-12: two tick invocations never run concurrently. Held for the request's duration on
// the same reserved connection so it survives across every query the request makes.
const LOCK_KEY = 841205551;

export async function tryLock(sql: Sql): Promise<boolean> {
  const [row] = await sql`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
  return row.locked as boolean;
}

export async function unlock(sql: Sql): Promise<void> {
  await sql`select pg_advisory_unlock(${LOCK_KEY})`;
}
