import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LeadsStore } from '../leads.store';
import {
  Bin, scoreHistogram, psiHistogram, heatBandMarkers, websiteSplit, leadsOverTime, scanContext,
} from './analytics';

/** Plot geometry, in user units. The SVG scales to its container. */
const W = 640;
const H = 132;
const PAD_BOTTOM = 22;
const PLOT_H = H - PAD_BOTTOM;

/**
 * Ordered fills for the website split.
 *
 * Website state is a *scale*, not a set of categories — none → social → site is monotonic
 * in web presence, and inversely monotonic in how good a lead it is. So it takes a
 * sequential ramp, and the design system's heat ramp is exactly that: one hue, light to
 * dark, which is also all `AGENTS.md`'s one-accent rule permits.
 *
 * `heat-0` is deliberately not used. It is a cell *background* token meant to sit under
 * text, and as a standalone mark on white it fails on chroma (reads grey) and contrast
 * (1.62:1) — measured with the dataviz validator, not eyeballed. These three steps are
 * lightness-monotonic, and identity is carried by the direct labels beneath each segment
 * plus a 2px surface gap between them, never by colour alone.
 */
const SPLIT_FILLS: Record<'none' | 'social' | 'site', string> = {
  none: 'var(--color-sw-heat-4)',
  social: 'var(--color-sw-heat-3)',
  site: 'var(--color-sw-heat-1)',
};

interface Bar {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  label: string | null;
}

/**
 * The charts and scan context below the table (AC-24, AC-25, AC-26).
 *
 * Hand-rolled inline SVG, no charting dependency. Four charts of these shapes are a
 * histogram, a split bar, a second histogram and a small time series — a couple of hundred
 * lines that land in the leads route chunk and add nothing to `main`. Any charting library
 * would work directly against the bundle discipline that removed 98 kB on 13 August, for
 * output this project deliberately does not need to be interactive.
 *
 * Non-interactive is a decision, not a gap: marks carry a `<title>`, which gives a native
 * tooltip and an accessible name with no script and no motion. `AGENTS.md` bans decorative
 * animation, so nothing here animates in — a chart may change when the data changes, but it
 * does not perform.
 */
@Component({
  selector: 'app-leads-analytics-band',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:36px 40px;">

      <!-- Score distribution -->
      <figure style="margin:0;">
        <figcaption [style]="caption">Score distribution</figcaption>
        <svg [attr.viewBox]="viewBox" width="100%" [attr.height]="height" role="img" aria-label="Histogram of lead score" style="display:block;overflow:visible;">
          <line [attr.x1]="0" [attr.y1]="plotH" [attr.x2]="width" [attr.y2]="plotH" stroke="var(--color-sw-rule-2)" stroke-width="1" />
          @for (b of scoreBars(); track b.x) {
            <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" rx="2" fill="var(--color-sw-violet)"><title>{{ b.title }}</title></rect>
          }
          @for (m of heatMarkers(); track m.band) {
            <line [attr.x1]="m.x" y1="0" [attr.x2]="m.x" [attr.y2]="plotH" stroke="var(--color-sw-ink-lo)" stroke-width="1" stroke-dasharray="2 3" />
            <text [attr.x]="m.x + 3" y="9" font-family="Geist Mono, monospace" font-size="9" fill="var(--color-sw-ink-lo)">heat-{{ m.band }}</text>
          }
          <text x="0" [attr.y]="plotH + 14" [style]="axisText">0</text>
          <text [attr.x]="width" [attr.y]="plotH + 14" text-anchor="end" [style]="axisText">{{ scoreMax().toFixed(0) }}</text>
        </svg>
      </figure>

      <!-- Website state split -->
      <figure style="margin:0;">
        <figcaption [style]="caption">Website state</figcaption>
        <svg [attr.viewBox]="viewBox" width="100%" [attr.height]="height" role="img" aria-label="Split of leads by website state" style="display:block;overflow:visible;">
          @for (s of splitBars(); track s.key) {
            <rect [attr.x]="s.x" y="24" [attr.width]="s.w" height="34" rx="3" [attr.fill]="s.fill"><title>{{ s.title }}</title></rect>
            @if (s.w > 42) {
              <text [attr.x]="s.x" y="76" [style]="axisText">{{ s.label }}</text>
              <text [attr.x]="s.x" y="90" font-family="Geist Mono, monospace" font-size="12" fill="var(--color-sw-ink)">{{ s.count }}</text>
            }
          }
          @if (totalInView() === 0) {
            <text x="0" y="46" [style]="axisText">No leads in view</text>
          }
        </svg>
        <!-- Direct labels for any segment too narrow to carry its own, so identity is never
             colour-alone even when a category is tiny. -->
        <ul style="list-style:none;margin:10px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:14px;">
          @for (s of splitBars(); track s.key) {
            @if (s.w <= 42) {
              <li style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--color-sw-ink-mid);">
                <span aria-hidden="true" [style.background]="s.fill" style="width:9px;height:9px;border-radius:2px;display:inline-block;"></span>
                {{ s.label }} <span data-mono style="color:var(--color-sw-ink);">{{ s.count }}</span>
              </li>
            }
          }
        </ul>
      </figure>

      <!-- PageSpeed spread -->
      <figure style="margin:0;">
        <figcaption [style]="caption">PageSpeed spread</figcaption>
        @if (psiTotal() === 0) {
          <p style="font-size:13px;color:var(--color-sw-ink-lo);margin:0;">No measurements in view.</p>
        } @else {
          <svg [attr.viewBox]="viewBox" width="100%" [attr.height]="height" role="img" aria-label="Distribution of PageSpeed scores" style="display:block;overflow:visible;">
            <line [attr.x1]="0" [attr.y1]="plotH" [attr.x2]="width" [attr.y2]="plotH" stroke="var(--color-sw-rule-2)" stroke-width="1" />
            @for (b of psiBars(); track b.x) {
              <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" rx="2" fill="var(--color-sw-violet)"><title>{{ b.title }}</title></rect>
            }
            <line [attr.x1]="poorX()" y1="0" [attr.x2]="poorX()" [attr.y2]="plotH" stroke="var(--color-sw-ink-lo)" stroke-width="1" stroke-dasharray="2 3" />
            <text [attr.x]="poorX() + 3" y="9" font-family="Geist Mono, monospace" font-size="9" fill="var(--color-sw-ink-lo)">poor &lt; {{ poorThreshold() }}</text>
            <text x="0" [attr.y]="plotH + 14" [style]="axisText">0</text>
            <text [attr.x]="width" [attr.y]="plotH + 14" text-anchor="end" [style]="axisText">100</text>
          </svg>
        }
      </figure>

      <!-- Leads over time -->
      <figure style="margin:0;">
        <figcaption [style]="caption">Leads discovered, by week</figcaption>
        @if (weekBars().length === 0) {
          <p style="font-size:13px;color:var(--color-sw-ink-lo);margin:0;">No discovery dates in view.</p>
        } @else {
          <svg [attr.viewBox]="viewBox" width="100%" [attr.height]="height" role="img" aria-label="Leads discovered per week" style="display:block;overflow:visible;">
            <line [attr.x1]="0" [attr.y1]="plotH" [attr.x2]="width" [attr.y2]="plotH" stroke="var(--color-sw-rule-2)" stroke-width="1" />
            @for (b of weekBars(); track b.x) {
              <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" rx="2" fill="var(--color-sw-violet)"><title>{{ b.title }}</title></rect>
            }
            <text x="0" [attr.y]="plotH + 14" [style]="axisText">{{ weekBars()[0].label }}</text>
            <text [attr.x]="width" [attr.y]="plotH + 14" text-anchor="end" [style]="axisText">{{ weekBars()[weekBars().length - 1].label }}</text>
          </svg>
        }
      </figure>
    </div>

    <!-- Scan context -->
    <section style="margin-top:40px;">
      <h2 data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.14em;color:var(--color-sw-ink-lo);margin:0 0 14px;">Scans in view</h2>
      @if (scans().length === 0) {
        <p style="font-size:13px;color:var(--color-sw-ink-lo);margin:0;">None of the leads in view record the scan that found them.</p>
      } @else {
        <ul style="list-style:none;margin:0;padding:0;">
          @for (s of scans(); track s.scanId) {
            <li style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--color-sw-rule);">
              <a [routerLink]="['/scans', s.scanId]" data-mono style="font-size:13px;color:var(--color-sw-violet);text-decoration:none;">{{ s.startedAt ? dateOf(s.startedAt) : 'Undated scan' }}</a>
              <span data-mono style="font-size:13px;color:var(--color-sw-ink-mid);">{{ s.count }} lead{{ s.count === 1 ? '' : 's' }}</span>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class LeadsAnalyticsBand {
  private readonly store = inject(LeadsStore);

  readonly viewBox = `0 0 ${W} ${H}`;
  readonly width = W;
  readonly height = H;
  readonly plotH = PLOT_H;
  readonly caption =
    "font-family:'Geist Mono',monospace;font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.14em;color:var(--color-sw-ink-lo);margin-bottom:14px;";
  readonly axisText = 'font-family:Geist Mono, monospace;font-size:10px;fill:var(--color-sw-ink-lo);';

  readonly totalInView = computed(() => this.store.filteredRows().length);
  readonly poorThreshold = computed(() => this.store.weights().poorThreshold);
  readonly scoreMax = computed(() => this.store.filteredRows().reduce((m, r) => Math.max(m, r.score), 0));

  // ---- Score histogram ------------------------------------------------------------

  private readonly scoreBins = computed(() => scoreHistogram(this.store.filteredRows()));
  readonly scoreBars = computed(() => this.toBars(this.scoreBins(), (b) => `${b.count} leads scoring ${b.from.toFixed(0)}–${b.to.toFixed(0)}`));

  readonly heatMarkers = computed(() => {
    const max = this.scoreMax() || 1;
    return heatBandMarkers(this.store.filteredRows(), this.store.heatBandAssignments())
      .map((m) => ({ band: m.band, x: (m.score / max) * W }));
  });

  // ---- PageSpeed spread -----------------------------------------------------------

  private readonly psiBins = computed(() => psiHistogram(this.store.filteredRows()));
  readonly psiTotal = computed(() => this.psiBins().reduce((n, b) => n + b.count, 0));
  readonly psiBars = computed(() => this.toBars(this.psiBins(), (b) => `${b.count} sites scoring ${b.from.toFixed(0)}–${b.to.toFixed(0)}`));
  readonly poorX = computed(() => (this.poorThreshold() / 100) * W);

  // ---- Website split --------------------------------------------------------------

  readonly splitBars = computed(() => {
    const segments = websiteSplit(this.store.filteredRows());
    const total = segments.reduce((n, s) => n + s.count, 0);
    if (total === 0) return segments.map((s) => ({ ...s, x: 0, w: 0, fill: SPLIT_FILLS[s.key], title: `${s.label}: 0` }));

    const GAP = 2; // the surface gap that keeps adjacent fills from reading as one mark
    let x = 0;
    return segments.map((s) => {
      const w = Math.max(0, (s.count / total) * W - GAP);
      const bar = { ...s, x, w, fill: SPLIT_FILLS[s.key], title: `${s.label}: ${s.count} of ${total}` };
      x += w + GAP;
      return bar;
    });
  });

  // ---- Leads over time ------------------------------------------------------------

  readonly weekBars = computed(() => {
    const weeks = leadsOverTime(this.store.filteredRows());
    if (weeks.length === 0) return [];
    const max = weeks.reduce((m, w) => Math.max(m, w.count), 0) || 1;
    const slot = W / weeks.length;
    const barW = Math.max(1, slot - 2);
    return weeks.map((wk, i) => ({
      x: i * slot,
      y: PLOT_H - (wk.count / max) * PLOT_H,
      w: barW,
      h: (wk.count / max) * PLOT_H,
      label: wk.label,
      title: `week of ${wk.label}: ${wk.count} lead${wk.count === 1 ? '' : 's'}`,
    }));
  });

  // ---- Scan context ---------------------------------------------------------------

  readonly scans = computed(() => scanContext(this.store.filteredRows()));

  private readonly dateFmt = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  dateOf(iso: string): string {
    return this.dateFmt.format(new Date(iso));
  }

  /** Shared bar layout for the two histograms: equal slots, a 2px surface gap, height
   * scaled to the tallest bin. A zero-count bin renders nothing rather than a 0-height
   * sliver. */
  private toBars(bins: Bin[], title: (b: Bin) => string): Bar[] {
    const max = bins.reduce((m, b) => Math.max(m, b.count), 0) || 1;
    const slot = W / bins.length;
    return bins.map((b, i) => {
      const h = (b.count / max) * PLOT_H;
      return {
        x: i * slot,
        y: PLOT_H - h,
        w: Math.max(1, slot - 2),
        h,
        title: title(b),
        label: null,
      };
    });
  }
}
