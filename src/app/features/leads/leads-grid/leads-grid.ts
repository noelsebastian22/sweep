import { Component, ChangeDetectionStrategy, inject, computed, effect, DestroyRef, untracked } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { LeadsStore, LeadStatus, PAGE_SIZE } from '../leads.store';
import { AuthStore } from '../../../stores/auth.store';
import { KeyboardService, PaletteAction } from '../../../core/keyboard.service';
import { HairlineTable, HairlineColumn, hairlineGridTemplate } from '../../../shared/ui/hairline-table/hairline-table';
import { HeatCell } from '../../../shared/ui/heat-cell/heat-cell';
import { MultiSelect, MultiSelectOption } from '../../../shared/ui/multi-select/multi-select';
import { LeadDrawer } from '../lead-drawer/lead-drawer';
import { LeadStatTiles } from '../analytics-band/stat-tiles';
import { LeadsAnalyticsBand } from '../analytics-band/analytics-band';
import { WEBSITE_KIND_LABEL } from '../../../shared/scoring/score';
import { STATUS_OPTIONS } from '../lead-drawer/lead-drawer';
import { parseLeadsUrl, buildLeadsQueryParams, sameQueryParams } from '../leads-url-state';

const COLUMNS: HairlineColumn[] = [
  { key: 'name', label: 'Business', sortable: true, width: '2fr' },
  { key: 'trade', label: 'Trade', sortable: true, width: '1fr' },
  { key: 'suburb', label: 'Suburb', sortable: true, width: '1fr' },
  { key: 'rating_count', label: 'Reviews', sortable: true, align: 'right', width: '90px' },
  { key: 'rating', label: 'Rating', sortable: true, align: 'right', width: '80px' },
  { key: 'website_kind', label: 'Website', sortable: true, width: '110px' },
  { key: 'psi_score', label: 'PSI', sortable: true, align: 'right', width: '80px' },
  { key: 'score', label: 'Score', sortable: true, align: 'right', width: '96px' },
  { key: 'status', label: 'Status', sortable: true, width: '130px' },
];

const WEBSITE_KIND_OPTIONS: MultiSelectOption[] = (['none', 'social', 'site'] as const).map((k) => ({
  value: k, label: WEBSITE_KIND_LABEL[k],
}));

@Component({
  selector: 'app-leads-grid',
  standalone: true,
  imports: [HairlineTable, HeatCell, LeadDrawer, MultiSelect, LeadStatTiles, LeadsAnalyticsBand],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div style="display:flex;flex-direction:column;gap:20px;">
      <div>
        <h1 style="font-family:'Geist Sans',sans-serif;font-size:20px;font-weight:600;color:var(--color-sw-ink);margin:0 0 4px;">Leads</h1>
        <p style="font-size:14px;color:var(--color-sw-ink-mid);margin:0;">{{ store.filteredRows().length }} of {{ store.rawLeads().length }} shown</p>
      </div>

      @if (store.loading() && !store.loaded()) {
        <p style="font-size:14px;color:var(--color-sw-ink-mid);">Loading leads…</p>
      } @else if (store.error()) {
        <div style="padding:16px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw);display:flex;align-items:center;justify-content:space-between;gap:16px;">
          <span style="font-size:14px;color:var(--color-sw-fail);">Couldn't load leads: {{ store.error() }}</span>
          <button (click)="store.load()" [style]="secondaryButton">Retry</button>
        </div>
      } @else if (store.isEmpty()) {
        <p style="font-size:14px;color:var(--color-sw-ink-mid);">No leads yet. Run a scan to start finding them.</p>
      } @else {

        <!-- Stat tiles (AC-23) — above the table, where the eye lands -->
        <app-lead-stat-tiles />

        <!-- Filter bar (AC-20) — one compact row, no wrapping chip block -->
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;">
          <input
            type="search"
            placeholder="Search business name…"
            [value]="store.filters().search"
            (input)="onSearch($any($event.target).value)"
            style="height:34px;padding:0 12px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);background:var(--color-sw-surface-2);font-size:13px;color:var(--color-sw-ink);width:220px;"
          />

          <app-multi-select label="Trade" [options]="tradeOptions()" [selected]="store.filters().trades" (selectedChange)="store.setFilters({ trades: $event })" />
          <app-multi-select label="Suburb" [options]="suburbOptions()" [selected]="store.filters().suburbs" (selectedChange)="store.setFilters({ suburbs: $event })" />
          <app-multi-select label="Website" [options]="websiteKindOptions" [selected]="store.filters().websiteKinds" (selectedChange)="store.setFilters({ websiteKinds: $any($event) })" />
          <app-multi-select label="Status" [options]="statusOptions()" [selected]="store.filters().statuses" (selectedChange)="store.setFilters({ statuses: $any($event) })" />
          <app-multi-select label="Heat" [options]="heatOptions()" [selected]="heatSelection()" (selectedChange)="onHeatChange($event)" />

          <label style="display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 10px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);font-size:13px;color:var(--color-sw-ink-mid);">
            <span data-mono style="font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;color:var(--color-sw-ink-lo);">PSI</span>
            <input type="number" min="0" max="100" placeholder="min" aria-label="Minimum PageSpeed score" [value]="store.filters().psiRange.min" (change)="setPsiMin($any($event.target).value)" [style]="numberInput" />
            <span aria-hidden="true">–</span>
            <input type="number" min="0" max="100" placeholder="max" aria-label="Maximum PageSpeed score" [value]="store.filters().psiRange.max" (change)="setPsiMax($any($event.target).value)" [style]="numberInput" />
          </label>

          <label style="display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 10px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);font-size:13px;color:var(--color-sw-ink-mid);">
            <span data-mono style="font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;color:var(--color-sw-ink-lo);">Rating ≥</span>
            <input type="number" min="0" max="5" step="0.1" placeholder="any" aria-label="Minimum rating" [value]="store.filters().ratingMin" (change)="setRatingMin($any($event.target).value)" [style]="numberInput" />
          </label>

          @if (anyFilterActive()) {
            <button type="button" (click)="store.clearFilters()" [style]="secondaryButton">Clear</button>
          }
        </div>

        @if (store.filteredRows().length === 0) {
          <p style="font-size:14px;color:var(--color-sw-ink-mid);">No leads match the current filters.</p>
        } @else {
          <!-- One page of rows at its natural height. No internal scroll region: the page
               itself scrolls, which is what lets the charts below be reachable (AC-13). -->
          <app-hairline-table [columns]="columns" [sortKey]="store.sort().column" [sortDirection]="store.sort().direction" (sortColumn)="onSort($any($event))">
            <div role="rowgroup">
              @for (row of store.pageRows(); track row.lead_id; let i = $index) {
                <div
                  role="row"
                  [attr.aria-selected]="globalIndex(i) === store.focusedIndex()"
                  (click)="onRowClick(i, row.lead_id)"
                  [style.background]="globalIndex(i) === store.focusedIndex() ? 'var(--color-sw-violet-soft)' : 'transparent'"
                  [style.grid-template-columns]="gridTemplate"
                  style="display:grid;align-items:center;height:44px;border-bottom:1px solid var(--color-sw-rule);cursor:pointer;font-size:13px;color:var(--color-sw-ink);"
                >
                  <span style="padding:0 12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ row.name }}</span>
                  <span style="padding:0 12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ row.trade || '—' }}</span>
                  <span style="padding:0 12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ row.suburb || '—' }}</span>
                  <span data-mono style="padding:0 12px;text-align:right;">{{ row.rating_count ?? 0 }}</span>
                  <span data-mono style="padding:0 12px;text-align:right;">{{ row.rating != null ? row.rating.toFixed(1) : '—' }}</span>
                  <span style="padding:0 12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ websiteLabel(row.website_kind ?? 'none') }}</span>
                  <span data-mono style="padding:0 12px;text-align:right;">{{ row.psi_score ?? '—' }}</span>
                  <app-heat-cell [score]="row.score" [band]="store.heatBandAssignments().get(row.lead_id) ?? 0" />
                  <span style="padding:0 12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:capitalize;color:var(--color-sw-ink-mid);">{{ row.status.replace('_', ' ') }}</span>
                </div>
              }
            </div>

            <!-- Footer bar (AC-15). The legend is the point: §8.3 asks this grid to prove
                 keyboard craft, and craft nobody can discover proves nothing. -->
            <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;background:var(--color-sw-surface);border-radius:0 0 var(--radius-sw) var(--radius-sw);">
              <p data-mono style="font-size:11px;color:var(--color-sw-ink-lo);margin:0;">↑↓ move · ⏎ open · ⌘K search</p>
              <div style="display:flex;align-items:center;gap:14px;">
                <span data-mono style="font-size:11px;color:var(--color-sw-ink-lo);">{{ rangeText() }}</span>
                <span data-mono style="font-size:11px;color:var(--color-sw-ink-lo);">page {{ store.page() + 1 }} of {{ store.pageCount() }}</span>
                <span style="display:flex;gap:4px;">
                  <button type="button" aria-label="Previous page" [disabled]="store.page() === 0 || store.rowRange().total === 0" (click)="goToPage(store.page() - 1)" [style]="pageButton(store.page() === 0 || store.rowRange().total === 0)">‹</button>
                  <button type="button" aria-label="Next page" [disabled]="store.page() >= store.pageCount() - 1 || store.rowRange().total === 0" (click)="goToPage(store.page() + 1)" [style]="pageButton(store.page() >= store.pageCount() - 1 || store.rowRange().total === 0)">›</button>
                </span>
              </div>
            </div>
          </app-hairline-table>

          <!-- Charts and scan context (AC-24, AC-25) — the reason the table stopped being
               a scroll box in the first place. -->
          <div style="margin-top:24px;">
            <app-leads-analytics-band />
          </div>
        }
      }
    </div>

    @if (openRow(); as row) {
      <app-lead-drawer [row]="row" />
    }
  `,
})
export class LeadsGrid {
  readonly store = inject(LeadsStore);
  readonly authStore = inject(AuthStore);
  private readonly keyboard = inject(KeyboardService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  readonly columns = COLUMNS;
  readonly gridTemplate = hairlineGridTemplate(COLUMNS);
  readonly websiteKindOptions = WEBSITE_KIND_OPTIONS;

  readonly numberInput =
    "width:52px;height:24px;padding:0 4px;border:1px solid var(--color-sw-rule-2);border-radius:4px;font-family:'Geist Mono',monospace;font-size:12px;";
  readonly secondaryButton =
    "height:34px;padding:0 12px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);background:white;color:var(--color-sw-violet);font-family:'Geist Sans',sans-serif;font-size:13px;font-weight:500;cursor:pointer;";

  /** Written by our own URL sync, so the reader can tell its own echo from a real change. */
  private lastWritten: Record<string, string | null> | null = null;

  readonly openRow = computed(() => {
    const id = this.store.openLeadId();
    if (!id) return null;
    return this.store.scoredRows().find((r) => r.lead_id === id) ?? null;
  });

  readonly tradeOptions = computed<MultiSelectOption[]>(() =>
    this.store.filterOptions().trades.map((t) => ({ value: t, label: t })));
  readonly suburbOptions = computed<MultiSelectOption[]>(() =>
    this.store.filterOptions().suburbs.map((s) => ({ value: s, label: s })));
  readonly statusOptions = computed<MultiSelectOption[]>(() =>
    this.store.filterOptions().statuses.map((s) => ({ value: s, label: s.replace('_', ' ') })));
  readonly heatOptions = computed<MultiSelectOption[]>(() =>
    this.store.heatBandOptions().map((b) => ({ value: String(b), label: `heat-${b}` })));
  readonly heatSelection = computed(() => this.store.filters().heatBands.map(String));

  readonly anyFilterActive = computed(() => {
    const f = this.store.filters();
    return f.trades.length > 0 || f.suburbs.length > 0 || f.websiteKinds.length > 0
      || f.statuses.length > 0 || f.heatBands.length > 0 || f.search.trim() !== ''
      || f.psiRange.min !== null || f.psiRange.max !== null || f.ratingMin !== null;
  });

  readonly rangeText = computed(() => {
    const { from, to, total } = this.store.rowRange();
    return total === 0 ? '0 of 0' : `${from} to ${to} of ${total}`;
  });

  constructor() {
    this.store.load();

    // ---- URL → store, and store → URL ---------------------------------------------
    //
    // Precedence is decided by *when*, not by whether the pages happen to agree. The
    // tempting rule — "focusedIndex wins whenever its derived page already matches the
    // URL" — fails at exactly the moment it exists for: walking prev/next on the detail
    // page from row 74 to row 75 crosses from page 3 to page 4, so on return the pages do
    // NOT match, the URL would win, and the handoff would be silently thrown away.
    //
    // So: on construction, a loaded store with a non-zero focus wins (that is the return
    // from /leads/:id, however you got back here) and the grid writes its derived page to
    // the URL. Otherwise the URL wins and seeds the store. While mounted, the URL always
    // wins — which is what makes the back button step through the pushed entries.
    const returningWithPosition = this.store.loaded() && this.store.focusedIndex() !== 0;
    if (returningWithPosition) {
      this.writeUrl(true);
    } else {
      this.applyUrl(this.snapshotParams(this.route.snapshot.queryParamMap));
    }

    // A live subscription, not a one-time read on entry. Two flows break otherwise: the
    // back button changes query params *without* re-entering the route, so nothing would
    // re-seed the store; and returning from /leads/:id re-enters /leads with the old page
    // in the URL, which would reset focus to that page's first row.
    //
    // The first emission is the URL as it stands *now*. When we are returning with a
    // position, the navigate above has not resolved yet, so that first value is the stale
    // URL — applying it would throw away the very handoff this branch exists to preserve.
    let skipFirst = returningWithPosition;
    const sub = this.route.queryParamMap.subscribe((params) => {
      if (skipFirst) { skipFirst = false; return; }
      const incoming = this.snapshotParams(params);
      // The loop guard: ignore the echo of a write we just made, or store→URL→store
      // oscillates forever.
      if (this.lastWritten && sameQueryParams(this.lastWritten, this.normalise(incoming))) return;
      this.applyUrl(incoming);
    });

    // The URL is parsed at construction, but the rows arrive later — so `page` was clamped
    // against an empty list (pageCount 1) and a deep link to `?page=3` would land on page 1,
    // and every heat band would have looked non-existent. Re-apply once the data is in.
    effect(() => {
      if (!this.store.loaded()) return;
      untracked(() => {
        const pending = this.pendingUrl;
        if (!pending) return;
        this.pendingUrl = null;
        this.applyUrl(pending);
      });
    });

    // Store → URL. Untracked reads of everything that is *output* here, so this effect
    // depends only on the state it serialises.
    effect(() => {
      const params = buildLeadsQueryParams({
        page: this.store.page() + 1,
        sort: this.store.sort(),
        filters: this.store.filters(),
      });
      untracked(() => {
        if (this.lastWritten && sameQueryParams(this.lastWritten, params)) return;
        this.writeParams(params, this.replaceNext);
        this.replaceNext = false;
      });
    });

    const unregisterShortcuts = this.keyboard.registerShortcuts((event) => {
      // Arrow keys are primary; j/k are kept so existing muscle memory and spec 0004's
      // AC-6 still hold. Rollover across a page boundary needs no code — moveFocus clamps
      // to the whole array and `page` is derived from where it lands.
      if (event.key === 'ArrowDown' || event.key === 'j') { this.moveFocusReplacing(1); return true; }
      if (event.key === 'ArrowUp' || event.key === 'k') { this.moveFocusReplacing(-1); return true; }
      if (event.key === 'Enter') {
        const row = this.store.focusedRow();
        if (row) this.store.openLead(row.lead_id);
        return true;
      }
      return false;
    });

    this.keyboard.setActionProvider((query) => this.buildPaletteActions(query));

    this.destroyRef.onDestroy(() => {
      sub.unsubscribe();
      unregisterShortcuts();
      this.keyboard.setActionProvider(null);
    });
  }

  // ---- URL plumbing -----------------------------------------------------------------

  /** Set for the next store→URL write only. Search keystrokes and keyboard page rollover
   * replace; footer page changes, sort changes and filter commits push, because AC-17 asks
   * the back button to step through them and a replace leaves nothing to step back to. */
  private replaceNext = false;

  /** Params parsed before the rows loaded, held so they can be re-applied once they have. */
  private pendingUrl: Record<string, string | null> | null = null;

  /** A plain copy, so it survives past the emission that carried it. */
  private snapshotParams(params: { keys: string[]; get(key: string): string | null }): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const key of params.keys) out[key] = params.get(key);
    return out;
  }

  private normalise(params: Record<string, string | null>): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(params)) out[k] = v === '' ? null : v;
    return out;
  }

  private applyUrl(params: Record<string, string | null>): void {
    const loaded = this.store.loaded();
    const state = parseLeadsUrl((k) => params[k] ?? null, loaded ? this.store.heatBandOptions() : null);
    this.store.replaceFilters(state.filters);
    this.store.setSortExplicit(state.sort.column, state.sort.direction);
    // Page last: both calls above reset position, so setting it first would be undone.
    // Clamped by setPage, which also rewrites the URL through the effect if it was too big.
    this.store.setPage(state.page - 1);
    // If the rows were not in yet, that clamp was against an empty list — keep the params
    // so the effect above can redo this properly once they arrive.
    this.pendingUrl = loaded ? null : params;
  }

  private writeUrl(replace: boolean): void {
    this.writeParams(buildLeadsQueryParams({
      page: this.store.page() + 1,
      sort: this.store.sort(),
      filters: this.store.filters(),
    }), replace);
  }

  private writeParams(params: Record<string, string | null>, replace: boolean): void {
    this.lastWritten = params;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: replace,
    });
  }

  // ---- Interaction ------------------------------------------------------------------

  /** The global index of a row rendered at position `i` on the current page. Row templates
   * must compare against this, never the bare template index, or every page would look
   * like page 1 to the focus highlight. */
  globalIndex(i: number): number {
    return this.store.page() * PAGE_SIZE + i;
  }

  private moveFocusReplacing(delta: number): void {
    // Walking 450 rows with the arrow keys crosses seventeen page boundaries; pushing a
    // history entry at each one would fill the stack with steps nobody asked for.
    this.replaceNext = true;
    this.store.moveFocus(delta);
  }

  onRowClick(i: number, leadId: string): void {
    this.store.focusIndex(this.globalIndex(i));
    this.store.openLead(leadId);
  }

  onSearch(value: string): void {
    // Replace, not push: otherwise the back button walks back one character at a time.
    this.replaceNext = true;
    this.store.setFilters({ search: value });
  }

  onSort(column: string): void {
    this.store.setSort(column as never);
  }

  onHeatChange(values: string[]): void {
    this.store.setFilters({ heatBands: values.map(Number).filter(Number.isInteger) });
  }

  goToPage(page: number): void {
    this.store.setPage(page);
  }

  websiteLabel(kind: 'none' | 'social' | 'site'): string {
    return WEBSITE_KIND_LABEL[kind];
  }

  pageButton(disabled: boolean): string {
    return `width:28px;height:24px;border:1px solid var(--color-sw-rule-2);border-radius:4px;`
      + `background:white;color:${disabled ? 'var(--color-sw-ink-lo)' : 'var(--color-sw-violet)'};`
      + `font-size:13px;line-height:1;cursor:${disabled ? 'not-allowed' : 'pointer'};`
      + `opacity:${disabled ? '0.5' : '1'};`;
  }

  setPsiMin(raw: string): void {
    const min = raw === '' ? null : Number(raw);
    this.store.setFilters({ psiRange: { ...this.store.filters().psiRange, min } });
  }

  setPsiMax(raw: string): void {
    const max = raw === '' ? null : Number(raw);
    this.store.setFilters({ psiRange: { ...this.store.filters().psiRange, max } });
  }

  setRatingMin(raw: string): void {
    this.store.setFilters({ ratingMin: raw === '' ? null : Number(raw) });
  }

  private buildPaletteActions(query: string): PaletteAction[] {
    const q = query.trim().toLowerCase();
    const candidates: PaletteAction[] = [];

    if (q) {
      const matches = this.store
        .rawLeads()
        .filter((r) => r.name.toLowerCase().includes(q))
        .slice(0, 8);
      for (const m of matches) {
        candidates.push({
          id: `jump-${m.lead_id}`,
          label: m.name,
          hint: 'Jump to lead',
          // Through the global focus index, so the grid moves to the page containing that
          // lead and focuses its row (AC-22). This used to assume every row was rendered.
          run: () => {
            const index = this.store.sortedRows().findIndex((r) => r.lead_id === m.lead_id);
            if (index >= 0) this.store.focusIndex(index);
            this.store.openLead(m.lead_id);
          },
        });
      }
    }

    const active = this.store.focusedRow() ?? this.openRow();
    if (active && !this.authStore.isDemo()) {
      for (const status of STATUS_OPTIONS) {
        if (status === active.status) continue;
        candidates.push({
          id: `status-${active.lead_id}-${status}`,
          label: `Set status: ${status} (${active.name})`,
          run: () => { this.store.updateStatus(active.lead_id, status as LeadStatus); },
        });
      }
    }

    candidates.push(
      { id: 'qf-no-website', label: 'No website', run: () => this.store.setFilters({ websiteKinds: ['none'] }) },
      { id: 'qf-social-only', label: 'Social only', run: () => this.store.setFilters({ websiteKinds: ['social'] }) },
      { id: 'qf-poor-psi', label: 'Poor PSI', run: () => this.store.setFilters({ psiRange: { min: null, max: this.store.weights().poorThreshold - 1 } }) },
      { id: 'qf-hottest', label: 'Hottest quintile', run: () => this.store.setFilters({ heatBands: [4] }) },
      { id: 'qf-contacted', label: 'Contacted', run: () => this.store.setFilters({ statuses: ['contacted'] }) },
      { id: 'qf-clear', label: 'Clear filters', run: () => this.store.clearFilters() },
    );

    if (!q) return candidates;
    return candidates.filter((a) => a.id.startsWith('jump-') || a.label.toLowerCase().includes(q));
  }
}
