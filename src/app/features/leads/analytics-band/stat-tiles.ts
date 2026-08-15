import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { LeadsStore } from '../leads.store';

/**
 * Four counts over the filtered set, above the table (AC-23).
 *
 * Counts, not cards: hairline-separated, no boxes, no padding drift toward the failure mode
 * `AGENTS.md` names. They update as filters change because they read the same signal the
 * table reads — there is no query behind any of them.
 */
@Component({
  selector: 'app-lead-stat-tiles',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <dl style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0;margin:0;border-top:1px solid var(--color-sw-rule);border-bottom:1px solid var(--color-sw-rule);">
      @for (t of tiles(); track t.label) {
        <div style="padding:16px 20px 16px 0;">
          <dt data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.14em;color:var(--color-sw-ink-lo);margin-bottom:8px;">{{ t.label }}</dt>
          <dd data-mono style="margin:0;font-size:30px;line-height:1;font-weight:500;color:var(--color-sw-ink);">{{ t.value }}</dd>
        </div>
      }
    </dl>
  `,
})
export class LeadStatTiles {
  private readonly store = inject(LeadsStore);

  readonly tiles = computed(() => {
    const rows = this.store.filteredRows();
    const poor = this.store.weights().poorThreshold;
    return [
      { label: 'In view', value: rows.length },
      { label: 'No website', value: rows.filter((r) => (r.website_kind ?? 'none') === 'none').length },
      // No website_kind test needed, and that is a schema choice rather than an omission:
      // since the weekend 5 migration `lead_rows` reports no psi_score at all for a business
      // without a site, so capturing a screenshot of a social page can no longer quietly
      // increment a tile about site performance.
      { label: 'Poor PSI', value: rows.filter((r) => r.psi_score != null && r.psi_score < poor).length },
      { label: 'Contacted', value: rows.filter((r) => r.status === 'contacted').length },
    ];
  });
}
