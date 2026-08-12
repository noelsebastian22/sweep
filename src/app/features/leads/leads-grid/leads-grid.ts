import { Component, ChangeDetectionStrategy, inject, computed, effect, DestroyRef, viewChild } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { ScrollingModule, CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { LeadsStore, LeadStatus } from '../leads.store';
import { AuthStore } from '../../../stores/auth.store';
import { KeyboardService, PaletteAction } from '../../../core/keyboard.service';
import { HairlineTable, HairlineColumn, hairlineGridTemplate } from '../../../shared/ui/hairline-table/hairline-table';
import { HeatCell } from '../../../shared/ui/heat-cell/heat-cell';
import { LeadDrawer } from '../lead-drawer/lead-drawer';
import { WEBSITE_KIND_LABEL } from '../../../shared/scoring/score';
import { STATUS_OPTIONS } from '../lead-drawer/lead-drawer';

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

@Component({
  selector: 'app-leads-grid',
  standalone: true,
  imports: [ScrollingModule, HairlineTable, HeatCell, LeadDrawer],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div style="display:flex;flex-direction:column;gap:20px;height:100%;">
      <div>
        <h1 style="font-family:'Geist Sans',sans-serif;font-size:20px;font-weight:600;color:var(--color-sw-ink);margin:0 0 4px;">Leads</h1>
        <p style="font-size:14px;color:var(--color-sw-ink-mid);margin:0;">{{ store.filteredRows().length }} of {{ store.rawLeads().length }} shown</p>
      </div>

      @if (store.loading() && !store.loaded()) {
        <p style="font-size:14px;color:var(--color-sw-ink-mid);">Loading leads…</p>
      } @else if (store.error()) {
        <div style="padding:16px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw);display:flex;align-items:center;justify-content:space-between;gap:16px;">
          <span style="font-size:14px;color:var(--color-sw-fail);">Couldn't load leads: {{ store.error() }}</span>
          <button (click)="store.load()" style="height:32px;padding:0 14px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);background:white;color:var(--color-sw-violet);font-size:13px;font-weight:500;cursor:pointer;">Retry</button>
        </div>
      } @else if (store.isEmpty()) {
        <p style="font-size:14px;color:var(--color-sw-ink-mid);">No leads yet. Run a scan to start finding them.</p>
      } @else {
        <!-- Filter bar (AC-5) -->
        <div style="display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--color-sw-rule);border-radius:var(--radius-sw);">
          <input
            type="text"
            placeholder="Search business name…"
            [value]="store.filters().search"
            (input)="store.setFilters({ search: $any($event.target).value })"
            style="height:36px;padding:0 12px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);background:var(--color-sw-surface-2);font-size:14px;color:var(--color-sw-ink);max-width:320px;"
          />

          <div style="display:flex;flex-wrap:wrap;gap:16px;">
            <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
              <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;color:var(--color-sw-ink-lo);margin-right:4px;">Trade</span>
              @for (t of store.filterOptions().trades; track t) {
                <button type="button" (click)="toggleTrade(t)" [style]="chipStyle(store.filters().trades.includes(t))">{{ t }}</button>
              }
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
              <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;color:var(--color-sw-ink-lo);margin-right:4px;">Suburb</span>
              @for (s of store.filterOptions().suburbs; track s) {
                <button type="button" (click)="toggleSuburb(s)" [style]="chipStyle(store.filters().suburbs.includes(s))">{{ s }}</button>
              }
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
              <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;color:var(--color-sw-ink-lo);margin-right:4px;">Website</span>
              @for (k of websiteKindOptions; track k) {
                <button type="button" (click)="toggleWebsiteKind(k)" [style]="chipStyle(store.filters().websiteKinds.includes(k))">{{ websiteLabel(k) }}</button>
              }
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
              <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;color:var(--color-sw-ink-lo);margin-right:4px;">Status</span>
              @for (s of store.filterOptions().statuses; track s) {
                <button type="button" (click)="toggleStatus(s)" [style]="chipStyle(store.filters().statuses.includes(s))">{{ s }}</button>
              }
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
              <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;color:var(--color-sw-ink-lo);margin-right:4px;">Heat</span>
              @for (b of store.heatBandOptions(); track b) {
                <button type="button" (click)="store.toggleHeatBand(b)" [style]="chipStyle(store.filters().heatBands.includes(b))">heat-{{ b }}</button>
              }
            </div>
          </div>

          <div style="display:flex;flex-wrap:wrap;gap:20px;align-items:center;">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--color-sw-ink-mid);">
              PSI
              <input type="number" min="0" max="100" placeholder="min" [value]="store.filters().psiRange.min" (input)="setPsiMin($any($event.target).value)" style="width:64px;height:32px;padding:0 8px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);" />
              <span>–</span>
              <input type="number" min="0" max="100" placeholder="max" [value]="store.filters().psiRange.max" (input)="setPsiMax($any($event.target).value)" style="width:64px;height:32px;padding:0 8px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);" />
            </label>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--color-sw-ink-mid);">
              Rating ≥
              <input type="number" min="0" max="5" step="0.1" placeholder="min" [value]="store.filters().ratingMin" (input)="setRatingMin($any($event.target).value)" style="width:64px;height:32px;padding:0 8px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);" />
            </label>
            <button type="button" (click)="store.clearFilters()" style="height:32px;padding:0 14px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);background:white;color:var(--color-sw-violet);font-size:13px;font-weight:500;cursor:pointer;">Clear filters</button>
          </div>
        </div>

        @if (store.filteredRows().length === 0) {
          <p style="font-size:14px;color:var(--color-sw-ink-mid);">No leads match the current filters.</p>
        } @else {
          <app-hairline-table [columns]="columns" [sortKey]="store.sort().column" [sortDirection]="store.sort().direction" (sortColumn)="store.setSort($any($event))">
            <cdk-virtual-scroll-viewport #vp itemSize="44" style="height:600px;">
              <div
                *cdkVirtualFor="let row of store.sortedRows(); let i = index; trackBy: trackByLeadId"
                role="row"
                [attr.aria-selected]="i === store.focusedIndex()"
                (click)="store.focusIndex(i); store.openLead(row.lead_id)"
                [style.background]="i === store.focusedIndex() ? 'var(--color-sw-violet-soft)' : 'transparent'"
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
            </cdk-virtual-scroll-viewport>
          </app-hairline-table>
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
  readonly websiteKindOptions: ('none' | 'social' | 'site')[] = ['none', 'social', 'site'];

  private readonly viewport = viewChild<CdkVirtualScrollViewport>('vp');

  readonly openRow = computed(() => {
    const id = this.store.openLeadId();
    if (!id) return null;
    return this.store.scoredRows().find((r) => r.lead_id === id) ?? null;
  });

  constructor() {
    this.store.load();

    const initialLeadId = this.route.snapshot.queryParamMap.get('lead');
    if (initialLeadId) this.store.openLead(initialLeadId);

    effect(() => {
      const id = this.store.openLeadId();
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { lead: id ?? null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });

    effect(() => {
      const idx = this.store.focusedIndex();
      this.viewport()?.scrollToIndex(idx);
    });

    const unregisterShortcuts = this.keyboard.registerShortcuts((event) => {
      if (event.key === 'j') { this.store.moveFocus(1); return true; }
      if (event.key === 'k') { this.store.moveFocus(-1); return true; }
      if (event.key === 'Enter') {
        const row = this.store.focusedRow();
        if (row) this.store.openLead(row.lead_id);
        return true;
      }
      return false;
    });

    this.keyboard.setActionProvider((query) => this.buildPaletteActions(query));

    this.destroyRef.onDestroy(() => {
      unregisterShortcuts();
      this.keyboard.setActionProvider(null);
    });
  }

  trackByLeadId(_: number, row: { lead_id: string }): string {
    return row.lead_id;
  }

  websiteLabel(kind: 'none' | 'social' | 'site'): string {
    return WEBSITE_KIND_LABEL[kind];
  }

  chipStyle(active: boolean): string {
    return `height:28px;padding:0 10px;border-radius:var(--radius-sw-pill);border:1px solid ${active ? 'var(--color-sw-violet)' : 'var(--color-sw-rule-2)'};background:${active ? 'var(--color-sw-violet-soft)' : 'white'};color:${active ? 'var(--color-sw-violet-hi)' : 'var(--color-sw-ink-mid)'};font-size:12px;cursor:pointer;`;
  }

  toggleTrade(value: string): void {
    const trades = this.store.filters().trades;
    this.store.setFilters({ trades: trades.includes(value) ? trades.filter((v) => v !== value) : [...trades, value] });
  }

  toggleSuburb(value: string): void {
    const suburbs = this.store.filters().suburbs;
    this.store.setFilters({ suburbs: suburbs.includes(value) ? suburbs.filter((v) => v !== value) : [...suburbs, value] });
  }

  toggleStatus(value: LeadStatus): void {
    const statuses = this.store.filters().statuses;
    this.store.setFilters({ statuses: statuses.includes(value) ? statuses.filter((v) => v !== value) : [...statuses, value] });
  }

  toggleWebsiteKind(value: 'none' | 'social' | 'site'): void {
    const kinds = this.store.filters().websiteKinds;
    this.store.setFilters({ websiteKinds: kinds.includes(value) ? kinds.filter((v) => v !== value) : [...kinds, value] });
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
        candidates.push({ id: `jump-${m.lead_id}`, label: m.name, hint: 'Jump to lead', run: () => this.store.openLead(m.lead_id) });
      }
    }

    const active = this.store.focusedRow() ?? this.openRow();
    if (active && !this.authStore.isDemo()) {
      for (const status of STATUS_OPTIONS) {
        if (status === active.status) continue;
        candidates.push({
          id: `status-${active.lead_id}-${status}`,
          label: `Set status: ${status} (${active.name})`,
          run: () => { this.store.updateStatus(active.lead_id, status); },
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
