import { AuthClient } from '@supabase/auth-js';
import { PostgrestClient } from '@supabase/postgrest-js';
import { environment } from '../../environments/environment';

/**
 * The Supabase client, composed from its parts rather than the umbrella
 * `@supabase/supabase-js` package.
 *
 * Why: the umbrella package statically constructs a storage client, a realtime client
 * and an iceberg client in its constructor, so none of them tree-shake. That put ~98 kB
 * of code Sweep never runs into the initial bundle — storage (hard rule 4 means this app
 * never uploads a file), iceberg, functions, and realtime with its phoenix socket. This
 * file replaces all of it with an auth client, a PostgREST client, and the ~10 lines of
 * token plumbing that supabase-js puts between them.
 *
 * The defaults below are copied from `SupabaseClient`'s constructor deliberately, not
 * chosen. Two of them are load-bearing:
 *
 * - `storageKey` MUST stay `sb-<project-ref>-auth-token`. It is the localStorage key
 *   holding the session. Change its shape and every signed-in browser silently becomes
 *   signed out, with no error to notice.
 * - The `Authorization` bearer falls back to the publishable key when there is no
 *   session. PostgREST rejects a request with no bearer outright, so dropping the
 *   fallback breaks anonymous reads rather than merely returning no rows.
 *
 * When weekend 4 needs realtime, import `@supabase/realtime-js` with a dynamic `import()`
 * inside the live-scan route so it lands in that route's chunk and not this one — and
 * remember to call `setAuth()` on it from `onAuthStateChange`, which is the wiring the
 * umbrella package used to do.
 */

const BASE = environment.supabaseUrl;
const KEY = environment.supabasePublishableKey;

/** `sb-ifwyufrepqkzsicjinfi-auth-token` — derived exactly as supabase-js derives it. */
const storageKey = `sb-${new URL(BASE).hostname.split('.')[0]}-auth-token`;

export const auth = new AuthClient({
  url: `${BASE}/auth/v1`,
  headers: { Authorization: `Bearer ${KEY}`, apikey: KEY },
  storageKey,
  autoRefreshToken: true,
  persistSession: true,
  detectSessionInUrl: true,
  flowType: 'implicit',
});

/**
 * Attaches the current session to every PostgREST call. Read fresh each time rather than
 * cached, so a token refresh or a sign-out takes effect on the very next request — this
 * is what makes RLS see the right user, so it is the one function here worth being
 * paranoid about.
 */
const authedFetch: typeof fetch = async (input, init) => {
  const { data } = await auth.getSession();
  const headers = new Headers(init?.headers);
  if (!headers.has('apikey')) headers.set('apikey', KEY);
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${data.session?.access_token ?? KEY}`);
  }
  return fetch(input, { ...init, headers });
};

export const db = new PostgrestClient(`${BASE}/rest/v1`, { fetch: authedFetch });
