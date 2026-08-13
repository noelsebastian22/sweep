/**
 * Realtime, kept out of the initial bundle.
 *
 * `core/supabase.service.ts` composes the Supabase client from `auth-js` +
 * `postgrest-js` precisely so that realtime and its phoenix socket never land in `main`.
 * That only holds if the import below stays a *dynamic* `import()` inside this file, and
 * this file is only ever reached from a lazily-loaded route. Two rules follow:
 *
 *   - The `RealtimeClient` import at the top is `import type`. Type imports are erased at
 *     build time; a value import here would silently undo the whole bundle cut.
 *   - Nothing in the eager part of the app may import this module.
 *
 * The `setAuth` wiring is what `@supabase/supabase-js` used to do for us. Realtime
 * authorises the socket with its own copy of the JWT, so without it RLS sees an anonymous
 * subscriber, every `postgres_changes` payload is filtered out, and the channel reports a
 * perfectly healthy SUBSCRIBED while delivering nothing.
 */

import type { RealtimeClient as RealtimeClientType, RealtimeChannel } from '@supabase/realtime-js';
import { auth } from '../../core/supabase.service';
import { environment } from '../../../environments/environment';

const KEY = environment.supabasePublishableKey;

let clientPromise: Promise<RealtimeClientType> | null = null;

/** One socket for the whole app, created on first use and reused after that. */
function getClient(): Promise<RealtimeClientType> {
  clientPromise ??= (async () => {
    const { RealtimeClient } = await import('@supabase/realtime-js');

    const client = new RealtimeClient(
      `${environment.supabaseUrl.replace(/^http/, 'ws')}/realtime/v1`,
      { params: { apikey: KEY } },
    );

    const { data } = await auth.getSession();
    await client.setAuth(data.session?.access_token ?? KEY);

    // Access tokens expire roughly hourly. A scan can easily outlive one, and a socket
    // holding a stale JWT stops passing RLS without disconnecting — it just goes quiet.
    auth.onAuthStateChange((_event, session) => {
      void client.setAuth(session?.access_token ?? KEY);
    });

    return client;
  })();
  return clientPromise;
}

export interface ScanSubscriptionHandlers {
  onScan: (row: Record<string, unknown>) => void;
  onEvent: (row: Record<string, unknown>) => void;
  /** Fires on every (re)subscribe. Treat each `true` as "resync", not "first connect". */
  onConnected: (connected: boolean) => void;
}

/**
 * Subscribes to one scan's row and its event log. Returns an unsubscribe function.
 *
 * Realtime replays nothing: anything that happened while the socket was down is simply
 * missed. Rather than trying to make the socket lossless, `onConnected(true)` fires on
 * every successful subscribe — including reconnects — so the caller can re-read the log
 * from its last seen id and close the gap itself. That is why `scan_events` is a table
 * and not just a stream.
 */
export async function subscribeToScan(
  scanId: string,
  handlers: ScanSubscriptionHandlers,
): Promise<() => void> {
  const client = await getClient();
  const channel: RealtimeChannel = client.channel(`scan:${scanId}`);

  channel
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'scans', filter: `id=eq.${scanId}` },
      (payload) => handlers.onScan(payload.new as Record<string, unknown>),
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'scan_events', filter: `scan_id=eq.${scanId}` },
      (payload) => handlers.onEvent(payload.new as Record<string, unknown>),
    )
    .subscribe((status) => {
      handlers.onConnected(status === 'SUBSCRIBED');
    });

  return () => {
    void client.removeChannel(channel);
  };
}
