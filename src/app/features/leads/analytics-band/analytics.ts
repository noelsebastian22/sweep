// Pure derivations for the analytics band. Every one of them takes the already-filtered,
// already-scored rows the table is showing and returns plottable numbers — no fetching, no
// signals, no framework. That is what makes the whole band cost zero requests (AC-26) and
// what makes it testable without a component.

import { ScoredLeadRow } from '../leads.store';

export interface Bin {
  /** Bucket lower bound, for the axis and the accessible label. */
  from: number;
  to: number;
  count: number;
}

export interface WeekBucket {
  /** ISO week start (Monday), as an ISO date string. */
  weekStart: string;
  label: string;
  count: number;
}

export interface ScanContextRow {
  scanId: string;
  startedAt: string | null;
  count: number;
}

export interface SplitSegment {
  key: 'none' | 'social' | 'site';
  label: string;
  count: number;
}

/** Histogram over an explicit range. `binCount` buckets, last bucket inclusive of `max`. */
export function histogram(values: number[], min: number, max: number, binCount: number): Bin[] {
  const span = max - min;
  const width = span > 0 ? span / binCount : 1;
  const bins: Bin[] = Array.from({ length: binCount }, (_, i) => ({
    from: min + i * width,
    to: min + (i + 1) * width,
    count: 0,
  }));
  for (const v of values) {
    if (v < min || v > max) continue;
    // The top edge belongs to the last bin rather than falling off the end.
    const idx = Math.min(binCount - 1, Math.floor((v - min) / width));
    bins[idx].count++;
  }
  return bins;
}

/**
 * Score is unbounded — it is `rating_count × rating/5 × penalty` — so the range has to come
 * from the data rather than from a fixed scale. 20 bins over [0, max] of the rows on screen.
 */
export function scoreHistogram(rows: ScoredLeadRow[]): Bin[] {
  const max = rows.reduce((m, r) => Math.max(m, r.score), 0);
  return histogram(rows.map((r) => r.score), 0, max > 0 ? max : 1, 20);
}

/** PageSpeed is a defined 0–100 scale, so this one is fixed rather than data-derived. */
export function psiHistogram(rows: ScoredLeadRow[]): Bin[] {
  const scores = rows.filter((r) => r.psi_score != null).map((r) => r.psi_score as number);
  return histogram(scores, 0, 100, 10);
}

/**
 * The heat band boundaries, for marking on the score histogram.
 *
 * `heatBandAssignments()` returns a `Map<lead_id, band>` and computes no score cut points,
 * so they have to be derived here — as the maximum score within each band.
 *
 * Derived over the **filtered** rows, the same set the histogram bins, not over
 * `heatBasis()`. The two differ whenever a heat filter is active, and taking the markers
 * from the wider set would draw boundaries describing rows the chart is not showing.
 */
export function heatBandMarkers(rows: ScoredLeadRow[], bands: Map<string, number>): { band: number; score: number }[] {
  const maxByBand = new Map<number, number>();
  for (const r of rows) {
    const band = bands.get(r.lead_id);
    if (band === undefined) continue;
    maxByBand.set(band, Math.max(maxByBand.get(band) ?? 0, r.score));
  }
  return [...maxByBand.entries()]
    .map(([band, score]) => ({ band, score }))
    .sort((a, b) => a.band - b.band)
    // The top band's maximum is the right edge of the chart, not a boundary inside it.
    .slice(0, -1);
}

export function websiteSplit(rows: ScoredLeadRow[]): SplitSegment[] {
  const counts = { none: 0, social: 0, site: 0 };
  for (const r of rows) counts[(r.website_kind ?? 'none') as keyof typeof counts]++;
  return [
    { key: 'none', label: 'No website', count: counts.none },
    { key: 'social', label: 'Social only', count: counts.social },
    { key: 'site', label: 'Full site', count: counts.site },
  ];
}

/** Monday of the ISO week containing `d`, in UTC, so buckets don't drift with the clock. */
function isoWeekStart(d: Date): Date {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = copy.getUTCDay(); // 0 = Sunday
  const offset = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + offset);
  return copy;
}

const WEEK_FMT = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * Discoveries bucketed by ISO week from `first_seen_scan_started_at`.
 *
 * Empty weeks between the first and last are filled in, so a gap in prospecting reads as a
 * gap rather than as two adjacent bars — the whole point of this chart is showing that the
 * thing is worked on over time.
 */
export function leadsOverTime(rows: ScoredLeadRow[]): WeekBucket[] {
  const counts = new Map<number, number>();
  for (const r of rows) {
    const raw = r.first_seen_scan_started_at;
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    const key = isoWeekStart(d).getTime();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return [];

  const keys = [...counts.keys()].sort((a, b) => a - b);
  const out: WeekBucket[] = [];
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  // Guard against an absurd span (a bad date) turning this into a million-bar chart.
  const span = Math.min(104, Math.round((keys[keys.length - 1] - keys[0]) / WEEK_MS));
  for (let i = 0; i <= span; i++) {
    const t = keys[0] + i * WEEK_MS;
    out.push({
      weekStart: new Date(t).toISOString(),
      label: WEEK_FMT.format(new Date(t)),
      count: counts.get(t) ?? 0,
    });
  }
  return out;
}

/** The scans that produced the leads currently in view, newest first. */
export function scanContext(rows: ScoredLeadRow[]): ScanContextRow[] {
  const byScan = new Map<string, { startedAt: string | null; count: number }>();
  for (const r of rows) {
    const id = r.first_seen_scan_id;
    if (!id) continue;
    const existing = byScan.get(id);
    if (existing) existing.count++;
    else byScan.set(id, { startedAt: r.first_seen_scan_started_at, count: 1 });
  }
  return [...byScan.entries()]
    .map(([scanId, v]) => ({ scanId, startedAt: v.startedAt, count: v.count }))
    .sort((a, b) => new Date(b.startedAt ?? 0).getTime() - new Date(a.startedAt ?? 0).getTime());
}
