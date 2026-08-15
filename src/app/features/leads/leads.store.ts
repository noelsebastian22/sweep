import { computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { db } from '../../core/supabase.service';
import {
  ScoringWeights,
  WebsiteKind,
  computeScore,
  mergeScoringWeights,
} from '../../shared/scoring/score';

export type LeadStatus =
  | 'identified'
  | 'shortlisted'
  | 'mockup_built'
  | 'contacted'
  | 'replied'
  | 'won'
  | 'lost'
  | 'rejected';

/** One row of the `lead_rows` view (leads joined to businesses/trades/suburbs/latest psi_results). */
export interface LeadRow {
  lead_id: string;
  status: LeadStatus;
  tenant_id: string;
  updated_at: string;
  business_id: string;
  name: string;
  phone: string | null;
  website_url: string | null;
  website_kind: WebsiteKind;
  rating: number | null;
  rating_count: number | null;
  lat: number | null;
  lng: number | null;
  trade: string | null;
  suburb: string | null;
  psi_score: number | null;
  lcp_ms: number | null;
  cls: number | null;
  psi_checked_at: string | null;
  /** From the weekend 5 migration. The analytics band's scan context and its "leads over
   * time" buckets both derive from these, which is what keeps the whole band free of
   * queries (AC-25 and AC-26 would otherwise contradict each other). */
  first_seen_scan_id: string | null;
  first_seen_scan_started_at: string | null;
}

/** A loaded row with its score attached (AC-2). */
export interface ScoredLeadRow extends LeadRow {
  score: number;
}

export type SortColumn = 'name' | 'trade' | 'suburb' | 'rating_count' | 'rating' | 'website_kind' | 'psi_score' | 'score' | 'status';
export type SortDirection = 'asc' | 'desc';

export interface RangeFilter {
  min: number | null;
  max: number | null;
}

export interface LeadsFilterState {
  trades: string[];
  suburbs: string[];
  websiteKinds: ('none' | 'social' | 'site')[];
  statuses: LeadStatus[];
  heatBands: number[];
  psiRange: RangeFilter;
  ratingMin: number | null;
  search: string;
}

const EMPTY_FILTERS: LeadsFilterState = {
  trades: [],
  suburbs: [],
  websiteKinds: [],
  statuses: [],
  heatBands: [],
  psiRange: { min: null, max: null },
  ratingMin: null,
  search: '',
};

/** Fixed, not measured and not configurable (spec 0005b). Once the page is allowed to
 * scroll so charts can sit beneath the table, a page that fits has nothing to virtualise,
 * and measuring rows to fill the viewport would only earn its ResizeObserver if nothing
 * were allowed below the fold. */
export const PAGE_SIZE = 25;

interface LeadsState {
  rawLeads: LeadRow[];
  rawWeights: Partial<ScoringWeights> | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  filters: LeadsFilterState;
  sort: { column: SortColumn; direction: SortDirection };
  focusedIndex: number;
  openLeadId: string | null;
}

const initial: LeadsState = {
  rawLeads: [],
  rawWeights: null,
  loading: false,
  loaded: false,
  error: null,
  filters: EMPTY_FILTERS,
  sort: { column: 'score', direction: 'desc' },
  focusedIndex: 0,
  openLeadId: null,
};

/** Every non-heat filter (AC-3's heat basis is the row set produced by these, and only these). */
function applyNonHeatFilters(rows: ScoredLeadRow[], f: LeadsFilterState): ScoredLeadRow[] {
  const search = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.trades.length && !(r.trade && f.trades.includes(r.trade))) return false;
    if (f.suburbs.length && !(r.suburb && f.suburbs.includes(r.suburb))) return false;
    if (f.statuses.length && !f.statuses.includes(r.status)) return false;
    if (f.websiteKinds.length) {
      const kind = r.website_kind ?? 'none';
      if (!f.websiteKinds.includes(kind)) return false;
    }
    if (f.psiRange.min !== null || f.psiRange.max !== null) {
      if (r.psi_score == null) return false; // null can't be evaluated against a bound
      if (f.psiRange.min !== null && r.psi_score < f.psiRange.min) return false;
      if (f.psiRange.max !== null && r.psi_score > f.psiRange.max) return false;
    }
    if (f.ratingMin !== null) {
      if (r.rating == null) return false;
      if (r.rating < f.ratingMin) return false;
    }
    if (search && !r.name.toLowerCase().includes(search)) return false;
    return true;
  });
}

/**
 * Percentile-rank heat banding over a basis (AC-3): rank rows by distinct score VALUE
 * (ties share a band), then spread ranks across bands 0..4. With 5 or fewer distinct
 * values the bands collapse to exactly that many, contiguous from 0 — never a forced
 * 5-way split of data that doesn't support it.
 */
function assignHeatBands(basis: ScoredLeadRow[]): Map<string, number> {
  const bands = new Map<string, number>();
  if (basis.length === 0) return bands;
  const distinct = Array.from(new Set(basis.map((r) => r.score))).sort((a, b) => a - b);
  const n = distinct.length;
  const rankOf = new Map<number, number>();
  distinct.forEach((v, i) => rankOf.set(v, i));
  for (const row of basis) {
    const rank = rankOf.get(row.score)!;
    const band = n <= 5 ? rank : Math.min(4, Math.floor((rank / n) * 5));
    bands.set(row.lead_id, band);
  }
  return bands;
}

function compareRows(a: ScoredLeadRow, b: ScoredLeadRow, column: SortColumn, direction: SortDirection): number {
  const dir = direction === 'asc' ? 1 : -1;
  const av = a[column];
  const bv = b[column];
  if (av == null && bv == null) return 0;
  if (av == null) return 1; // nulls sort last regardless of direction
  if (bv == null) return -1;
  if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
  return String(av).localeCompare(String(bv)) * dir;
}

export const LeadsStore = signalStore(
  { providedIn: 'root' },
  withState(initial),
  withComputed(({ rawLeads, rawWeights, filters, sort, focusedIndex, loading, loaded }) => {
    const weights = computed(() => mergeScoringWeights(rawWeights()));

    const scoredRows = computed<ScoredLeadRow[]>(() =>
      rawLeads().map((r) => ({
        ...r,
        score: computeScore(r.rating, r.rating_count, r.website_kind, r.psi_score, weights()),
      })),
    );

    // The heat basis: every active filter EXCEPT the heat band filter itself (AC-3).
    const heatBasis = computed(() => {
      const f = filters();
      return applyNonHeatFilters(scoredRows(), { ...f, heatBands: [] });
    });

    const heatBandAssignments = computed(() => assignHeatBands(heatBasis()));

    const heatBandOptions = computed(() => {
      const bands = new Set(heatBandAssignments().values());
      return Array.from(bands).sort((a, b) => a - b);
    });

    const filteredRows = computed(() => {
      const f = filters();
      if (!f.heatBands.length) return heatBasis();
      const bandMap = heatBandAssignments();
      return heatBasis().filter((r) => {
        const band = bandMap.get(r.lead_id);
        return band !== undefined && f.heatBands.includes(band);
      });
    });

    const sortedRows = computed(() => {
      const { column, direction } = sort();
      return [...filteredRows()].sort((a, b) => compareRows(a, b, column, direction));
    });

    // Filter chip options: distinct values in the loaded row set, not the raw reference tables.
    const filterOptions = computed(() => {
      const rows = rawLeads();
      const trades = new Set<string>();
      const suburbs = new Set<string>();
      const statuses = new Set<LeadStatus>();
      for (const r of rows) {
        if (r.trade) trades.add(r.trade);
        if (r.suburb) suburbs.add(r.suburb);
        statuses.add(r.status);
      }
      return {
        trades: Array.from(trades).sort(),
        suburbs: Array.from(suburbs).sort(),
        statuses: Array.from(statuses).sort(),
      };
    });

    const focusedRow = computed(() => sortedRows()[focusedIndex()] ?? null);
    const isEmpty = computed(() => loaded() && !loading() && rawLeads().length === 0);

    // Pagination is derived, never stored. `focusedIndex` stays the single global index
    // into sortedRows() and `page` falls out of it, which is what removes a whole class of
    // desync bug: there is no second, page-relative index to keep in step with the one
    // that focusedRow(), moveFocus()'s clamp, the row click handler and the aria-selected
    // comparison already use. Rollover across a page boundary then needs no code at all —
    // moveFocus(±1) clamps to the whole array, so stepping past a page edge simply lands on
    // an index whose derived page is the next one.
    const pageCount = computed(() => Math.max(1, Math.ceil(sortedRows().length / PAGE_SIZE)));
    const page = computed(() => Math.min(pageCount() - 1, Math.floor(focusedIndex() / PAGE_SIZE)));
    const pageRows = computed(() => sortedRows().slice(page() * PAGE_SIZE, page() * PAGE_SIZE + PAGE_SIZE));

    /** `1 to 25 of 450`, or `0 of 0` when nothing matches (AC-15). */
    const rowRange = computed(() => {
      const total = sortedRows().length;
      if (total === 0) return { from: 0, to: 0, total: 0 };
      return { from: page() * PAGE_SIZE + 1, to: Math.min(total, (page() + 1) * PAGE_SIZE), total };
    });

    return {
      weights, scoredRows, heatBasis, heatBandAssignments, heatBandOptions, filteredRows,
      sortedRows, filterOptions, focusedRow, isEmpty, pageCount, page, pageRows, rowRange,
    };
  }),
  withMethods((store) => {
  /**
   * The one place position is reset. Every filter and sort method routes through it, so a
   * future filter method cannot forget to — which `setSort` already had, silently: it was
   * the only one of the four that left `focusedIndex` where it was, so changing sort could
   * leave you focused on row 300 of a re-ordered list.
   */
  const resetPosition = () => patchState(store, { focusedIndex: 0 });

  return {
    async load() {
      patchState(store, { loading: true, error: null });
      const [leadsRes, weightsRes] = await Promise.all([
        db.from('lead_rows').select('*').limit(5000),
        db.from('scoring_profiles').select('weights').eq('is_default', true).limit(1).maybeSingle(),
      ]);
      if (leadsRes.error) {
        patchState(store, { loading: false, loaded: true, error: leadsRes.error.message });
        return;
      }
      patchState(store, {
        rawLeads: (leadsRes.data ?? []) as LeadRow[],
        rawWeights: (weightsRes.data?.weights ?? null) as Partial<ScoringWeights> | null,
        loading: false,
        loaded: true,
        error: null,
        focusedIndex: 0,
      });
    },

    setFilters(patch: Partial<LeadsFilterState>) {
      patchState(store, (s) => ({ filters: { ...s.filters, ...patch } }));
      resetPosition();
    },

    toggleHeatBand(band: number) {
      patchState(store, (s) => {
        const has = s.filters.heatBands.includes(band);
        const heatBands = has ? s.filters.heatBands.filter((b) => b !== band) : [...s.filters.heatBands, band];
        return { filters: { ...s.filters, heatBands } };
      });
      resetPosition();
    },

    clearFilters() {
      patchState(store, { filters: EMPTY_FILTERS });
      resetPosition();
    },

    /** Replaces the whole filter set at once. The URL parser uses this so that seeding
     * from a link is one state change rather than eight, and so it lands on page 1. */
    replaceFilters(filters: LeadsFilterState) {
      patchState(store, { filters });
      resetPosition();
    },

    setSort(column: SortColumn) {
      patchState(store, (s) => {
        const direction: SortDirection = s.sort.column === column && s.sort.direction === 'asc' ? 'desc' : s.sort.column === column ? 'asc' : 'desc';
        return { sort: { column, direction } };
      });
      resetPosition();
    },

    /** Used by the URL parser, which carries an explicit direction rather than toggling. */
    setSortExplicit(column: SortColumn, direction: SortDirection) {
      const current = store.sort();
      if (current.column === column && current.direction === direction) return;
      patchState(store, { sort: { column, direction } });
      resetPosition();
    },

    focusIndex(index: number) {
      patchState(store, { focusedIndex: index });
    },

    /** Footer page controls. Moves focus to the target page's first row, which is what
     * makes `page` — a pure derivation of focusedIndex — land where asked. */
    setPage(page: number) {
      const last = store.pageCount() - 1;
      const clamped = Math.min(last, Math.max(0, page));
      patchState(store, { focusedIndex: clamped * PAGE_SIZE });
    },

    moveFocus(delta: number) {
      const count = store.sortedRows().length;
      if (count === 0) return;
      patchState(store, (s) => ({ focusedIndex: Math.min(count - 1, Math.max(0, s.focusedIndex + delta)) }));
    },

    openLead(leadId: string | null) {
      patchState(store, { openLeadId: leadId });
    },

    /** Writes leads.status directly through Supabase, governed by RLS (AC-8). The demo
     * tenant is blocked at the RLS layer; callers must check AuthStore.isDemo() first and
     * disable the control rather than relying on this silently no-opping.
     *
     * Selects `updated_at` as well as `id` so the caller can show the confirming timestamp
     * the database actually wrote, never a client clock. Since the weekend 5 migration this
     * write also leaves a `status_changed` row in `lead_events`, written by the
     * `leads_log_event` trigger rather than by anything here. */
    async updateStatus(leadId: string, status: LeadStatus): Promise<{ ok: boolean; updatedAt?: string; error?: string }> {
      const { data, error } = await db.from('leads').update({ status }).eq('id', leadId).select('id, updated_at');
      if (error) return { ok: false, error: error.message };
      if (!data || data.length === 0) return { ok: false, error: 'No row updated (read only in the demo, or the lead no longer exists).' };
      const updatedAt = (data[0] as { updated_at: string }).updated_at;
      patchState(store, (s) => ({
        rawLeads: s.rawLeads.map((r) => (r.lead_id === leadId ? { ...r, status, updated_at: updatedAt } : r)),
      }));
      return { ok: true, updatedAt };
    },

    /**
     * Patches a row after the detail page measures it, so the grid behind the page shows
     * the new PageSpeed score — and therefore the new score, heat band, tiles and charts —
     * without a reload (AC-28). Everything downstream is `computed()` off `rawLeads`, so
     * one patch is the whole update.
     *
     * `psi_score` is patched only when the row is a `site`, mirroring the clause the
     * weekend 5 migration added to `lead_rows`. Capturing a social page is a real
     * measurement and belongs in the detail page's own timeline, but the view deliberately
     * does not report a PSI score for a business with no site, and an optimistic patch must
     * not put back what the view excludes. The other fields are patched regardless.
     */
    applyPsiResult(
      businessId: string,
      result: { psi_score: number | null; lcp_ms: number | null; cls: number | null; psi_checked_at: string },
    ) {
      patchState(store, (s) => ({
        rawLeads: s.rawLeads.map((r) =>
          r.business_id === businessId
            ? {
                ...r,
                psi_score: r.website_kind === 'site' ? result.psi_score : r.psi_score,
                lcp_ms: result.lcp_ms,
                cls: result.cls,
                psi_checked_at: result.psi_checked_at,
              }
            : r,
        ),
      }));
    },
  };
  }),
);
