import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';

export interface HairlineColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  sortable?: boolean;
  /** CSS track size, e.g. '2fr' or '96px'. Defaults to `minmax(0,1fr)`. */
  width?: string;
}

/** Shared by the header (this component) and the virtualised row template (the feature
 * using it), so header cells and body cells always line up under the same grid. */
export function hairlineGridTemplate(columns: HairlineColumn[]): string {
  return columns.map((c) => c.width ?? 'minmax(0,1fr)').join(' ');
}

/**
 * The dense table shell (AGENTS.md design rules: 44px rows, hairline separated, never
 * boxed cards). Owns the bordered container and the sticky, sortable header row; the body
 * rows are projected in by the feature that uses it, so this stays reusable for any future
 * dense table, not just the leads grid.
 *
 * **The container has no `overflow` and that is load-bearing.** `position: sticky` resolves
 * against the nearest scrolling ancestor and fails outright inside any ancestor whose
 * `overflow` is not `visible` — silently, with no error and no warning. This container used
 * to set `overflow: hidden` purely to clip the border radius against the header; the radius
 * now sits on the header's own top corners instead. If the header ever stops sticking, an
 * ancestor with `overflow` set is the first thing to check.
 */
@Component({
  selector: 'app-hairline-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div style="border:1px solid var(--color-sw-rule);border-radius:var(--radius-sw);display:flex;flex-direction:column;">
      <div role="row" style="display:grid;position:sticky;top:0;z-index:5;background:var(--color-sw-surface);border-bottom:1px solid var(--color-sw-rule);border-radius:var(--radius-sw) var(--radius-sw) 0 0;" [style.grid-template-columns]="gridTemplateColumns()">
        @for (col of columns(); track col.key) {
          <button
            type="button"
            role="columnheader"
            [attr.aria-sort]="sortKey() === col.key ? (sortDirection() === 'asc' ? 'ascending' : 'descending') : 'none'"
            (click)="col.sortable && sortColumn.emit(col.key)"
            style="display:flex;align-items:center;gap:4px;padding:10px 12px;border:none;background:none;font-family:'Geist Mono',monospace;font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.08em;color:var(--color-sw-ink-lo);white-space:nowrap;"
            [style.cursor]="col.sortable ? 'pointer' : 'default'"
            [style.justify-content]="col.align === 'right' ? 'flex-end' : 'flex-start'"
          >
            {{ col.label }}
            @if (col.sortable && sortKey() === col.key) {
              <span aria-hidden="true">{{ sortDirection() === 'asc' ? '↑' : '↓' }}</span>
            }
          </button>
        }
      </div>
      <ng-content />
    </div>
  `,
})
export class HairlineTable {
  readonly columns = input.required<HairlineColumn[]>();
  readonly sortKey = input<string | null>(null);
  readonly sortDirection = input<'asc' | 'desc'>('desc');
  readonly sortColumn = output<string>();

  readonly gridTemplateColumns = () => hairlineGridTemplate(this.columns());
}
