// The detail page's read model and the timeline merge. Kept out of the component so the
// PostgREST embed — which has three load-bearing details in it — can be read on its own.

import { db } from '../../../core/supabase.service';
import { LeadStatus } from '../leads.store';
import { WebsiteKind } from '../../../shared/scoring/score';

export interface PsiResultRow {
  id: number;
  scan_id: string | null;
  strategy: string;
  score: number | null;
  lcp_ms: number | null;
  cls: number | null;
  tbt_ms: number | null;
  fcp_ms: number | null;
  si_ms: number | null;
  error: string | null;
  checked_at: string;
}

export interface SiteSnapshotRow {
  id: string;
  storage_path: string;
  viewport: string;
  captured_at: string;
  psi_result_id: number | null;
}

export interface LeadEventRow {
  id: number;
  type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface LeadDetailData {
  id: string;
  status: LeadStatus;
  notes: string | null;
  updated_at: string;
  businesses: {
    id: string;
    name: string;
    phone: string | null;
    address: string | null;
    website_url: string | null;
    website_kind: WebsiteKind;
    rating: number | null;
    rating_count: number | null;
    google_place_id: string;
    trades: { name: string } | null;
    suburbs: { name: string } | null;
    first_seen_scan: { started_at: string | null; created_at: string } | null;
    psi_results: PsiResultRow[];
    site_snapshots: SiteSnapshotRow[];
  };
  lead_events: LeadEventRow[];
}

/**
 * One embedded read, rather than a new view: `lead_rows` lacks `notes`, `tbt_ms`, `fcp_ms`
 * and `si_ms`, and widening it would add columns to all 450 grid rows to serve one page.
 *
 * Three things here are load-bearing:
 *
 * - **The `scans` FK hint is required, not optional.** `businesses` has two foreign keys to
 *   `scans` — `first_seen_scan_id` from migration 04 and `last_scan_id` from migration 15 —
 *   so a bare `scans(...)` embed is rejected. Verified against the live API, not assumed:
 *   it returns HTTP 300 `PGRST201`.
 *
 *   The `psi_results` hint is **not** required, and spec 0005 is wrong to say it is. The
 *   spec predicted that giving `site_snapshots` a `psi_result_id` would turn it into a
 *   junction between `businesses` and `psi_results` and trip PostgREST's many-to-many
 *   ambiguity detection; tested after the migration landed, the unhinted embed returns 200.
 *   The hint is kept because it is explicit and costs nothing, but it is not load-bearing —
 *   do not go looking for a bug if someone removes it.
 * - **`referencedTable` takes the dotted path** for a nested embed, and it is the alias
 *   where one is used — hence `businesses.psi_results` and `businesses.first_seen_scan`.
 * - **Every embed is bounded.** A business rechecked often would otherwise return its
 *   entire measurement history on every page load, and the site block only ever shows the
 *   newest snapshot.
 */
export async function fetchLeadDetail(leadId: string, signal?: AbortSignal): Promise<LeadDetailData | null> {
  const query = db
    .from('leads')
    .select(`
      id, status, notes, updated_at,
      businesses (
        id, name, phone, address, website_url, website_kind, rating, rating_count, google_place_id,
        trades ( name ),
        suburbs ( name ),
        first_seen_scan:scans!businesses_first_seen_scan_id_fkey ( started_at, created_at ),
        psi_results!psi_results_business_id_fkey ( * ),
        site_snapshots ( * )
      ),
      lead_events ( * )
    `)
    .eq('id', leadId)
    .order('checked_at', { referencedTable: 'businesses.psi_results', ascending: false })
    .limit(50, { referencedTable: 'businesses.psi_results' })
    .order('captured_at', { referencedTable: 'businesses.site_snapshots', ascending: false })
    .limit(1, { referencedTable: 'businesses.site_snapshots' })
    .order('created_at', { referencedTable: 'lead_events', ascending: false })
    .limit(100, { referencedTable: 'lead_events' });

  // abortSignal lives on the filter builder, so it has to be applied before maybeSingle()
  // narrows the chain to a PostgrestBuilder.
  const scoped = signal ? query.abortSignal(signal) : query;
  const { data, error } = await scoped.maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LeadDetailData | null) ?? null;
}

export type TimelineKind = 'discovery' | 'measurement' | 'status' | 'notes' | 'recheck' | 'other';

export interface TimelineEntry {
  key: string;
  /** The single field the whole list sorts on, so three sources interleave correctly. */
  at: string;
  /** Breaks ties, so a status and a notes change written by one PATCH have a stable order. */
  tieBreak: number;
  kind: TimelineKind;
  title: string;
  detail: string | null;
  /** True for a measurement that failed — rendered as a finding, not hidden. */
  failed: boolean;
  /** Null means the engine or a hand-written SQL write, not a person. */
  actor: string | null;
}

const STATUS_LABEL = (v: unknown) => String(v ?? '—').replace(/_/g, ' ');

/**
 * Merges `lead_events`, `psi_results` and the synthesised discovery entry into one reverse
 * chronological list (AC-5).
 *
 * Failed measurements are included deliberately. `lead_rows` filters them out for the grid,
 * but a site that fails to load is itself a sales signal, so the detail page shows it with
 * its reason.
 *
 * The discovery entry is synthesised from the embedded first-seen scan rather than read
 * from a stored event, because `lead_events` has never held a row and nothing backfills
 * one. Coming from the page's own query is also what makes it render on a cold visit.
 *
 * The event vocabulary is exactly `status_changed`, `notes_updated` and `rechecked_psi`.
 * Anything else renders as a generic entry rather than being dropped — an unknown event is
 * still something that happened.
 */
export function buildTimeline(data: LeadDetailData): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const e of data.lead_events ?? []) {
    const payload = e.payload ?? {};
    const actor = typeof payload['actor'] === 'string' ? (payload['actor'] as string) : null;

    if (e.type === 'status_changed') {
      entries.push({
        key: `event-${e.id}`, at: e.created_at, tieBreak: e.id, kind: 'status',
        title: `Status changed to ${STATUS_LABEL(payload['to'])}`,
        detail: payload['from'] ? `from ${STATUS_LABEL(payload['from'])}` : null,
        failed: false, actor,
      });
    } else if (e.type === 'notes_updated') {
      const length = typeof payload['length'] === 'number' ? (payload['length'] as number) : null;
      entries.push({
        key: `event-${e.id}`, at: e.created_at, tieBreak: e.id, kind: 'notes',
        title: 'Notes updated',
        detail: length === null ? null : length === 0 ? 'cleared' : `${length} characters`,
        failed: false, actor,
      });
    } else if (e.type === 'rechecked_psi') {
      const score = typeof payload['score'] === 'number' ? (payload['score'] as number) : null;
      const err = typeof payload['error'] === 'string' ? (payload['error'] as string) : null;
      entries.push({
        key: `event-${e.id}`, at: e.created_at, tieBreak: e.id, kind: 'recheck',
        title: 'PageSpeed rechecked by hand',
        detail: score !== null ? `scored ${score}` : err,
        failed: score === null, actor,
      });
    } else {
      entries.push({
        key: `event-${e.id}`, at: e.created_at, tieBreak: e.id, kind: 'other',
        title: e.type.replace(/_/g, ' '), detail: null, failed: false, actor,
      });
    }
  }

  for (const p of data.businesses?.psi_results ?? []) {
    entries.push({
      key: `psi-${p.id}`, at: p.checked_at, tieBreak: p.id, kind: 'measurement',
      title: p.error ? 'PageSpeed measurement failed' : `PageSpeed measured ${p.score}`,
      detail: p.error ? p.error : p.lcp_ms != null ? `LCP ${(p.lcp_ms / 1000).toFixed(1)}s` : null,
      failed: !!p.error,
      // A scan-driven measurement has a scan_id; a recheck does not. Neither is attributed
      // to a person here — the paired `rechecked_psi` event carries the actor.
      actor: null,
    });
  }

  const scan = data.businesses?.first_seen_scan;
  if (scan) {
    entries.push({
      key: 'discovery', at: scan.started_at ?? scan.created_at, tieBreak: 0, kind: 'discovery',
      title: 'Discovered by a scan', detail: null, failed: false, actor: null,
    });
  }

  return entries.sort((a, b) => {
    const diff = new Date(b.at).getTime() - new Date(a.at).getTime();
    return diff !== 0 ? diff : b.tieBreak - a.tieBreak;
  });
}
