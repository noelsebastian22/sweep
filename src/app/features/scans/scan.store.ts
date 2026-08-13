import { computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { db } from '../../core/supabase.service';
import { subscribeToScan } from './realtime';

export type ScanStatus =
  | 'queued' | 'searching' | 'measuring' | 'awaiting_approval'
  | 'completed' | 'partial' | 'failed' | 'cancelled';

export type EventKind = 'stage' | 'query' | 'discovery' | 'spend' | 'error';

export interface ScanRow {
  id: string;
  status: ScanStatus;
  total_queries: number;
  completed_queries: number;
  failed_queries: number;
  businesses_found: number;
  psi_total: number;
  psi_completed: number;
  quota_hit: boolean | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface ScanEvent {
  id: number;
  at: string;
  kind: EventKind;
  message: string;
  detail: Record<string, unknown> | null;
}

export interface BudgetRow {
  api: string;
  sku: string;
  used: number;
  free_allowance: number;
  allow_paid: boolean;
  granted_usd: number;
  spent_usd: number;
  unit_cost_usd: number;
}

const SCAN_COLUMNS =
  'id, status, total_queries, completed_queries, failed_queries, businesses_found,'
  + ' psi_total, psi_completed, quota_hit, created_at, started_at, finished_at';

const TERMINAL: ScanStatus[] = ['completed', 'partial', 'failed', 'cancelled'];

/** The log is capped in memory. A 288-query scan produces ~600 rows and we render the
 *  newest first, so nothing below this is ever on screen — but an unbounded array on a
 *  page left open all day is a leak. */
const MAX_EVENTS = 1000;

interface ScanState {
  scanId: string | null;
  scan: ScanRow | null;
  events: ScanEvent[];
  budgets: BudgetRow[];
  connected: boolean;
  loading: boolean;
  error: string | null;
  busy: boolean;
  actionError: string | null;
}

const initial: ScanState = {
  scanId: null, scan: null, events: [], budgets: [],
  connected: false, loading: true, error: null, busy: false, actionError: null,
};

export const ScanStore = signalStore(
  withState(initial),

  withComputed(({ scan, events, budgets }) => {
    const isTerminal = computed(() => {
      const s = scan()?.status;
      return !!s && TERMINAL.includes(s);
    });

    const isParked = computed(() => scan()?.status === 'awaiting_approval');

    /**
     * Which budget ran out. Read from the most recent `spend` event rather than guessed
     * from the scan's stage: a scan parks during `searching` or `measuring`, but by the
     * time the row is re-read its status is `awaiting_approval` and the stage that failed
     * is no longer recoverable from it.
     */
    const blockedOn = computed(() => {
      if (scan()?.status !== 'awaiting_approval') return null;
      const last = [...events()].reverse().find((e) => e.kind === 'spend');
      const api = last?.detail?.['api'] as string | undefined;
      const sku = last?.detail?.['sku'] as string | undefined;
      if (!api) return null;
      return budgets().find((b) => b.api === api && (sku ? b.sku === sku : true)) ?? null;
    });

    const searchPct = computed(() => {
      const s = scan();
      if (!s || s.total_queries === 0) return 0;
      return Math.round(((s.completed_queries + s.failed_queries) / s.total_queries) * 100);
    });

    const psiPct = computed(() => {
      const s = scan();
      if (!s || s.psi_total === 0) return 0;
      return Math.round((s.psi_completed / s.psi_total) * 100);
    });

    // Newest first. The log is read top-down while a scan runs, so appending to the bottom
    // would push the interesting line off screen on every event.
    const feed = computed(() => [...events()].reverse());

    return { isTerminal, isParked, blockedOn, searchPct, psiPct, feed };
  }),

  withMethods((store) => {
    let unsubscribe: (() => void) | null = null;

    /** Re-reads everything after `sinceId`. Called on first load and on every reconnect —
     *  realtime replays nothing, so this is what closes the gap left by a dropped socket. */
    async function sync(scanId: string, sinceId = 0): Promise<string | null> {
      const [scanRes, eventRes, budgetRes] = await Promise.all([
        db.from('scans').select(SCAN_COLUMNS).eq('id', scanId).maybeSingle(),
        db.from('scan_events').select('id, at, kind, message, detail')
          .eq('scan_id', scanId).gt('id', sinceId).order('id', { ascending: true }).limit(MAX_EVENTS),
        db.from('api_budgets')
          .select('api, sku, used, free_allowance, allow_paid, granted_usd, spent_usd, unit_cost_usd'),
      ]);

      if (scanRes.error) return scanRes.error.message;
      if (!scanRes.data) return 'Scan not found.';

      patchState(store, (s) => ({
        scan: scanRes.data as unknown as ScanRow,
        budgets: (budgetRes.data ?? []) as unknown as BudgetRow[],
        events: mergeEvents(s.events, (eventRes.data ?? []) as unknown as ScanEvent[]),
      }));
      return null;
    }

    return {
      async open(scanId: string) {
        unsubscribe?.();
        patchState(store, { ...initial, scanId, loading: true });

        const error = await sync(scanId);
        patchState(store, { loading: false, error });
        if (error) return;

        unsubscribe = await subscribeToScan(scanId, {
          onScan: (row) => patchState(store, (s) => ({
            scan: s.scan ? { ...s.scan, ...(row as Partial<ScanRow>) } : (row as unknown as ScanRow),
          })),

          onEvent: (row) => patchState(store, (s) => ({
            events: mergeEvents(s.events, [row as unknown as ScanEvent]),
          })),

          onConnected: (connected) => {
            patchState(store, { connected });
            // Every SUBSCRIBED is treated as a resync, not just the first. On a reconnect
            // this pulls in whatever arrived while the socket was down.
            if (connected) {
              const last = store.events().at(-1)?.id ?? 0;
              void sync(scanId, last);
            }
          },
        });
      },

      close() {
        unsubscribe?.();
        unsubscribe = null;
        patchState(store, { connected: false });
      },

      /**
       * Approves more calls through `approve_spend()` (migration 20). The caps live in the
       * function, not here — this is a convenience, never the enforcement. tick picks the
       * scan back up on its next run once `budget_headroom()` sees the room.
       */
      async approve(calls: number): Promise<boolean> {
        const scan = store.scan();
        const budget = store.blockedOn();
        if (!scan || !budget) return false;

        patchState(store, { busy: true, actionError: null });
        const { error } = await db.rpc('approve_spend', {
          p_api: budget.api, p_sku: budget.sku, p_calls: calls, p_scan: scan.id,
        });

        if (error) {
          patchState(store, { busy: false, actionError: error.message });
          return false;
        }
        // Re-read rather than patching optimistically: the grant moved granted_usd and
        // allow_paid server-side, and the approval panel is driven off those numbers.
        await sync(scan.id, store.events().at(-1)?.id ?? 0);
        patchState(store, { busy: false });
        return true;
      },

      async cancel(): Promise<boolean> {
        const scan = store.scan();
        if (!scan) return false;

        patchState(store, { busy: true, actionError: null });
        const { error } = await db.rpc('cancel_scan', { p_scan: scan.id });
        if (error) {
          patchState(store, { busy: false, actionError: error.message });
          return false;
        }
        await sync(scan.id, store.events().at(-1)?.id ?? 0);
        patchState(store, { busy: false });
        return true;
      },
    };
  }),
);

/**
 * Merges incoming events into the log, de-duplicated by id and kept in id order.
 *
 * Both paths can deliver the same row: the realtime INSERT arrives, and a resync that
 * overlaps it re-reads the same id. Sorting by id rather than `at` matters — inside a
 * concurrency-5 drain several events routinely share a millisecond, and `at` alone does
 * not give a total order.
 */
function mergeEvents(existing: ScanEvent[], incoming: ScanEvent[]): ScanEvent[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  const merged = Array.from(byId.values()).sort((a, b) => a.id - b.id);
  return merged.length > MAX_EVENTS ? merged.slice(merged.length - MAX_EVENTS) : merged;
}
