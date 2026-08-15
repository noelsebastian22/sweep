// Page, sort and every filter, encoded into the URL so a reload behaves and a view can be
// sent to someone. This is also the honest precursor to the saved views spec 0004 deferred.
//
// Kept out of the grid component because it is pure: params in, state out, state in, params
// out. The subscription, the loop guard and the precedence rule are the component's job —
// they are about *when* to apply this, which is the part that is actually hard.

import { LeadsFilterState, LeadStatus, SortColumn, SortDirection } from './leads.store';

const SORT_COLUMNS: SortColumn[] = [
  'name', 'trade', 'suburb', 'rating_count', 'rating', 'website_kind', 'psi_score', 'score', 'status',
];

const STATUSES: LeadStatus[] = [
  'identified', 'shortlisted', 'mockup_built', 'contacted', 'replied', 'won', 'lost', 'rejected',
];

const WEBSITE_KINDS = ['none', 'social', 'site'] as const;

export interface LeadsUrlState {
  page: number;
  sort: { column: SortColumn; direction: SortDirection };
  filters: LeadsFilterState;
}

/**
 * Each element is percent-encoded *before* joining, because trade and suburb values are
 * free text out of the view and may contain a comma. Splitting a raw join on `,` would
 * silently break "Smith, Jones & Co" into two filters that match nothing.
 */
function encodeList(values: readonly string[]): string | null {
  return values.length ? values.map(encodeURIComponent).join(',') : null;
}

function decodeList(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').filter(Boolean).map((v) => {
    try { return decodeURIComponent(v); } catch { return v; }
  });
}

function decodeNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** `min-max`, with either side allowed to be empty: `40-`, `-40`, `20-60`. */
function decodeRange(raw: string | null): { min: number | null; max: number | null } {
  if (!raw || !raw.includes('-')) return { min: null, max: null };
  const idx = raw.indexOf('-');
  return { min: decodeNumber(raw.slice(0, idx)), max: decodeNumber(raw.slice(idx + 1)) };
}

/**
 * Reads state out of the URL.
 *
 * `availableHeatBands` drops heat bands that no longer exist in the current basis, so a
 * link saved when five bands existed degrades rather than blanking the screen.
 *
 * Pass **null** when the row set has not loaded yet. Every band would otherwise look
 * non-existent — the basis is empty before the fetch returns — and a shared `?heat=4` link
 * would silently lose its filter on the way in. Null means "cannot judge yet, keep them";
 * the caller re-parses once the store is loaded.
 */
export function parseLeadsUrl(
  get: (key: string) => string | null,
  availableHeatBands: number[] | null,
): LeadsUrlState {
  // An unrecognised column discards the direction with it. `score.desc` is the default as a
  // pair, so honouring `asc` from a sort string we could not otherwise parse would produce
  // an order nobody asked for — worst-scoring leads first, on a screen built to rank them.
  const [rawColumn, rawDirection] = (get('sort') ?? '').split('.');
  const known = SORT_COLUMNS.includes(rawColumn as SortColumn);
  const column: SortColumn = known ? (rawColumn as SortColumn) : 'score';
  const direction: SortDirection = known && rawDirection === 'asc' ? 'asc' : 'desc';

  const statuses = decodeList(get('statuses')).filter((s): s is LeadStatus =>
    STATUSES.includes(s as LeadStatus));
  const websiteKinds = decodeList(get('kinds')).filter((k): k is 'none' | 'social' | 'site' =>
    (WEBSITE_KINDS as readonly string[]).includes(k));
  const heatBands = decodeList(get('heat'))
    .map(Number)
    .filter((b) => Number.isInteger(b) && (availableHeatBands === null || availableHeatBands.includes(b)));

  const page = Math.max(1, decodeNumber(get('page')) ?? 1);

  return {
    page,
    sort: { column, direction },
    filters: {
      trades: decodeList(get('trades')),
      suburbs: decodeList(get('suburbs')),
      websiteKinds,
      statuses,
      heatBands,
      psiRange: decodeRange(get('psi')),
      ratingMin: decodeNumber(get('rating')),
      search: get('q') ?? '',
    },
  };
}

/**
 * Writes state back out. Every key is always present in the returned object — a param that
 * should not appear is set to `null`, which is how the Angular router is told to *remove*
 * it. Omitting the key entirely would leave a stale value in the URL under
 * `queryParamsHandling: 'merge'`.
 */
export function buildLeadsQueryParams(state: LeadsUrlState): Record<string, string | null> {
  const f = state.filters;
  const { min, max } = f.psiRange;

  return {
    page: state.page > 1 ? String(state.page) : null,
    sort: `${state.sort.column}.${state.sort.direction}`,
    q: f.search.trim() ? f.search : null,
    trades: encodeList(f.trades),
    suburbs: encodeList(f.suburbs),
    statuses: encodeList(f.statuses),
    kinds: encodeList(f.websiteKinds),
    heat: f.heatBands.length ? f.heatBands.map(String).join(',') : null,
    psi: min === null && max === null ? null : `${min ?? ''}-${max ?? ''}`,
    rating: f.ratingMin === null ? null : String(f.ratingMin),
  };
}

/** Cheap structural comparison, used by the loop guard to decide whether a write is a
 * genuine change or an echo of what was just read. */
export function sameQueryParams(
  a: Record<string, string | null>,
  b: Record<string, string | null>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? null) !== (b[k] ?? null)) return false;
  return true;
}
