import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { DecimalPipe } from '@angular/common';

/**
 * The score column's heat coloured cell (AC-1, AC-3). Score heat is a fill, never a text
 * colour (BUILD-PLAN.md §7): the number sits in `ink` on a light fill for bands 0-2, and
 * flips to white once the fill reaches band 3, where the crossover was measured to hold
 * AA contrast on both sides.
 */
@Component({
  selector: 'app-heat-cell',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <span
      data-mono
      [style.background]="'var(--color-sw-heat-' + band() + ')'"
      [style.color]="textColor()"
      style="display:flex;align-items:center;justify-content:flex-end;height:44px;width:100%;padding:0 12px;font-size:13px;font-weight:500;box-sizing:border-box;"
    >{{ score() | number: '1.0-1' }}</span>
  `,
})
export class HeatCell {
  readonly score = input.required<number>();
  /** 0 (cold, weak lead) to 4 (hot, strong lead) — per AC-3's percentile banding. */
  readonly band = input.required<number>();
  readonly textColor = computed(() => (this.band() <= 2 ? 'var(--color-sw-ink)' : '#FFFFFF'));
}
