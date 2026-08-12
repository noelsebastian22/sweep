import { Component, ChangeDetectionStrategy, inject, input, computed, signal } from '@angular/core';
import { AuthStore } from '../../../stores/auth.store';
import { LeadsStore, ScoredLeadRow, LeadStatus } from '../leads.store';
import { scoreBreakdown, WEBSITE_KIND_LABEL } from '../../../shared/scoring/score';

export const STATUS_OPTIONS: LeadStatus[] = [
  'identified', 'shortlisted', 'mockup_built', 'contacted', 'replied', 'won', 'lost', 'rejected',
];

/**
 * The AC-7 inline lead drawer. Deliberately throwaway — weekend 5 replaces it wholesale
 * with the real 720px detail document (spec 0004's Follow-up), so this stays a single
 * self-contained component rather than a reusable pattern.
 */
@Component({
  selector: 'app-lead-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <aside
      role="dialog"
      aria-label="Lead detail"
      style="position:fixed;top:0;right:0;bottom:0;width:400px;max-width:100vw;background:white;border-left:1px solid var(--color-sw-rule);box-shadow:0 1px 2px rgba(44,34,78,.06),0 8px 24px rgba(44,34,78,.06);z-index:40;display:flex;flex-direction:column;overflow-y:auto;"
    >
      <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:24px;border-bottom:1px solid var(--color-sw-rule);">
        <div>
          <h2 style="font-family:'Geist Sans',sans-serif;font-size:20px;font-weight:600;color:var(--color-sw-ink);margin:0 0 4px;">{{ row().name }}</h2>
          <p style="font-size:13px;color:var(--color-sw-ink-mid);margin:0;">{{ row().trade || '—' }} · {{ row().suburb || '—' }}</p>
        </div>
        <button
          (click)="close()"
          aria-label="Close"
          style="border:none;background:none;color:var(--color-sw-ink-lo);font-size:20px;line-height:1;cursor:pointer;padding:4px;"
        >×</button>
      </div>

      <div style="padding:24px;display:flex;flex-direction:column;gap:20px;">
        <div>
          <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.14em;color:var(--color-sw-ink-lo);">Score</span>
          <p data-mono style="font-size:15px;color:var(--color-sw-ink);margin:6px 0 0;line-height:1.5;">{{ breakdownText() }}</p>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div>
            <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.14em;color:var(--color-sw-ink-lo);">Rating</span>
            <p data-mono style="font-size:15px;color:var(--color-sw-ink);margin:6px 0 0;">{{ row().rating ?? '—' }} ({{ row().rating_count ?? 0 }})</p>
          </div>
          <div>
            <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.14em;color:var(--color-sw-ink-lo);">PSI</span>
            <p data-mono style="font-size:15px;color:var(--color-sw-ink);margin:6px 0 0;">{{ row().psi_score ?? 'unmeasured' }}</p>
          </div>
          <div>
            <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.14em;color:var(--color-sw-ink-lo);">Website</span>
            <p style="font-size:14px;color:var(--color-sw-ink);margin:6px 0 0;">{{ websiteLabel() }}</p>
          </div>
          <div>
            <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.14em;color:var(--color-sw-ink-lo);">Phone</span>
            <p data-mono style="font-size:14px;color:var(--color-sw-ink);margin:6px 0 0;">{{ row().phone ?? '—' }}</p>
          </div>
        </div>

        @if (row().website_url) {
          <div>
            <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.14em;color:var(--color-sw-ink-lo);">Site</span>
            <p style="font-size:14px;margin:6px 0 0;overflow-wrap:anywhere;"><a [href]="row().website_url" target="_blank" rel="noopener" style="color:var(--color-sw-violet);">{{ row().website_url }}</a></p>
          </div>
        }

        <div style="display:flex;flex-direction:column;gap:6px;">
          <label data-mono for="lead-status" style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.14em;color:var(--color-sw-ink-lo);">Status</label>
          <select
            id="lead-status"
            [value]="row().status"
            (change)="onStatusChange($event)"
            [disabled]="authStore.isDemo()"
            [attr.title]="authStore.isDemo() ? 'Read only in the demo' : null"
            style="height:40px;padding:0 12px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);background:var(--color-sw-surface-2);font-family:'Geist Sans',sans-serif;font-size:14px;color:var(--color-sw-ink);"
          >
            @for (s of statusOptions; track s) {
              <option [value]="s">{{ s }}</option>
            }
          </select>
          @if (statusError()) {
            <p style="font-size:13px;color:var(--color-sw-fail);margin:4px 0 0;">{{ statusError() }}</p>
          }
        </div>
      </div>
    </aside>
  `,
})
export class LeadDrawer {
  readonly row = input.required<ScoredLeadRow>();

  readonly authStore = inject(AuthStore);
  private readonly leadsStore = inject(LeadsStore);

  readonly statusOptions = STATUS_OPTIONS;
  readonly statusError = signal<string | null>(null);

  readonly websiteLabel = computed(() => WEBSITE_KIND_LABEL[this.row().website_kind ?? 'none']);

  readonly breakdownText = computed(() => {
    const r = this.row();
    const b = scoreBreakdown(r.rating, r.rating_count, r.website_kind, r.psi_score, this.leadsStore.weights());
    return `${b.score.toFixed(1)} = ${b.ratingCount} reviews × (${b.rating.toFixed(1)}/5) × ${b.penalty.toFixed(1)} (${b.penaltyLabel})`;
  });

  close(): void {
    this.leadsStore.openLead(null);
  }

  async onStatusChange(event: Event): Promise<void> {
    const status = (event.target as HTMLSelectElement).value as LeadStatus;
    this.statusError.set(null);
    const result = await this.leadsStore.updateStatus(this.row().lead_id, status);
    if (!result.ok) this.statusError.set(result.error ?? 'Could not update status.');
  }
}
