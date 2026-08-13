import { Component, inject, ChangeDetectionStrategy, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../stores/auth.store';
import { db } from '../../core/supabase.service';
import { ScanStatus } from '../../features/scans/scan.store';

interface ScanSummary {
  id: string;
  status: ScanStatus;
  total_queries: number;
  completed_queries: number;
  failed_queries: number;
  businesses_found: number;
  created_at: string;
  finished_at: string | null;
}

const ACTIVE: ScanStatus[] = ['queued', 'searching', 'measuring', 'awaiting_approval'];

const STATUS_FG: Record<ScanStatus, string> = {
  queued: 'var(--color-sw-ink-mid)',
  searching: 'var(--color-sw-violet)',
  measuring: 'var(--color-sw-violet)',
  awaiting_approval: 'var(--color-sw-warn)',
  completed: 'var(--color-sw-ok)',
  partial: 'var(--color-sw-warn)',
  failed: 'var(--color-sw-fail)',
  cancelled: 'var(--color-sw-ink-lo)',
};

const STATUS_LABEL: Record<ScanStatus, string> = {
  queued: 'Queued', searching: 'Searching', measuring: 'Measuring',
  awaiting_approval: 'Needs approval', completed: 'Completed', partial: 'Partial',
  failed: 'Failed', cancelled: 'Cancelled',
};

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div style="display:flex;flex-direction:column;gap:28px;max-width:960px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <div>
          <h1 style="font-family:'Geist Sans',sans-serif;font-size:20px;font-weight:600;line-height:1.3;color:var(--color-sw-ink);margin:0 0 4px;">Welcome{{ authStore.email() ? ', ' + authStore.email() : '' }}</h1>
          <p style="font-size:15px;line-height:1.5;color:var(--color-sw-ink-mid);margin:0;">Blue Mountains lead prospecting.</p>
        </div>
        <a routerLink="/scans/new"
          style="display:inline-flex;align-items:center;height:36px;padding:0 16px;border:1px solid var(--color-sw-violet);border-radius:var(--radius-sw-sm);background:var(--color-sw-violet);color:white;font-size:14px;font-weight:500;text-decoration:none;"
        >New scan</a>
      </div>

      <!-- The active-scan card is the entry point to the live screen. It is the first
           thing on the page when there is something running, and absent otherwise —
           rather than a permanently present card showing "none". -->
      @if (activeScan(); as s) {
        <a [routerLink]="['/scans', s.id]"
          style="display:flex;flex-direction:column;gap:8px;padding:20px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw);text-decoration:none;background:var(--color-sw-surface);"
        >
          <div style="display:flex;align-items:center;gap:10px;">
            <span data-mono [style.color]="statusFg(s.status)"
              style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.12em;">{{ statusLabel(s.status) }}</span>
            <span data-mono style="font-size:12px;color:var(--color-sw-ink-lo);">{{ s.id.slice(0, 8) }}</span>
          </div>
          <span style="font-family:'Geist Sans',sans-serif;font-size:16px;font-weight:600;color:var(--color-sw-ink);">
            {{ s.status === 'awaiting_approval' ? 'A scan is waiting on your approval' : 'A scan is running' }}
          </span>
          <span style="font-size:14px;color:var(--color-sw-ink-mid);">
            <span data-mono>{{ s.completed_queries + s.failed_queries }}</span> of
            <span data-mono>{{ s.total_queries }}</span> queries,
            <span data-mono>{{ s.businesses_found }}</span> found — open the live view
          </span>
        </a>
      }

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1px;background:var(--color-sw-rule);border:1px solid var(--color-sw-rule);border-radius:var(--radius-sw);overflow:hidden;">
        @for (stat of stats(); track stat.label) {
          <div style="display:flex;flex-direction:column;gap:4px;padding:20px;background:var(--color-sw-bg);">
            <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.12em;color:var(--color-sw-ink-lo);line-height:1;">{{ stat.label }}</span>
            <span data-mono style="font-size:28px;font-weight:500;color:var(--color-sw-ink);line-height:1.1;">{{ stat.value }}</span>
            @if (stat.note) {
              <span style="font-size:12px;color:var(--color-sw-ink-lo);">{{ stat.note }}</span>
            }
          </div>
        }
      </div>

      <div style="display:flex;flex-direction:column;gap:10px;">
        <h2 style="font-family:'Geist Sans',sans-serif;font-size:15px;font-weight:600;color:var(--color-sw-ink);margin:0;">Recent scans</h2>
        @if (recent().length === 0) {
          <p style="font-size:14px;color:var(--color-sw-ink-mid);margin:0;">No scans yet. Start one to fill the leads grid.</p>
        } @else {
          <div style="border:1px solid var(--color-sw-rule);border-radius:var(--radius-sw);overflow:hidden;">
            @for (s of recent(); track s.id) {
              <a [routerLink]="['/scans', s.id]"
                style="display:grid;grid-template-columns:1fr 130px 110px 90px;align-items:center;gap:12px;height:44px;padding:0 16px;border-bottom:1px solid var(--color-sw-rule);text-decoration:none;"
              >
                <span data-mono style="font-size:13px;color:var(--color-sw-ink);">{{ s.id.slice(0, 8) }}</span>
                <span data-mono [style.color]="statusFg(s.status)" style="font-size:12px;">{{ statusLabel(s.status) }}</span>
                <span data-mono style="font-size:13px;color:var(--color-sw-ink-mid);">{{ s.businesses_found }} found</span>
                <span data-mono style="font-size:12px;color:var(--color-sw-ink-lo);text-align:right;">{{ date(s.created_at) }}</span>
              </a>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class Dashboard {
  readonly authStore = inject(AuthStore);

  private readonly scans = signal<ScanSummary[]>([]);
  private readonly leadCount = signal(0);
  private readonly freeLeft = signal<number | null>(null);
  private readonly freeTotal = signal<number | null>(null);

  constructor() {
    void this.load();
  }

  private async load() {
    // head + exact count: PostgREST returns the count in a header and no rows, so the
    // dashboard does not pull 450 lead rows just to show a number.
    const [scansRes, leadsRes, budgetRes] = await Promise.all([
      db.from('scans')
        .select('id, status, total_queries, completed_queries, failed_queries, businesses_found, created_at, finished_at')
        .order('created_at', { ascending: false }).limit(10),
      db.from('leads').select('id', { count: 'exact', head: true }),
      db.from('api_budgets').select('api, used, free_allowance').eq('api', 'places_text_search').maybeSingle(),
    ]);

    this.scans.set((scansRes.data ?? []) as unknown as ScanSummary[]);
    this.leadCount.set(leadsRes.count ?? 0);

    const b = budgetRes.data as { used: number; free_allowance: number } | null;
    if (b) {
      this.freeLeft.set(Math.max(b.free_allowance - b.used, 0));
      this.freeTotal.set(b.free_allowance);
    }
  }

  readonly activeScan = computed(() => this.scans().find((s) => ACTIVE.includes(s.status)) ?? null);
  readonly recent = computed(() => this.scans().slice(0, 6));

  readonly stats = computed(() => {
    const left = this.freeLeft();
    const total = this.freeTotal();
    return [
      { label: 'Scans run', value: this.scans().length.toLocaleString('en-AU'), note: null as string | null },
      { label: 'Leads', value: this.leadCount().toLocaleString('en-AU'), note: null },
      {
        label: 'Free calls left',
        value: left === null ? '—' : left.toLocaleString('en-AU'),
        note: total === null ? null : `of ${total.toLocaleString('en-AU')} this month`,
      },
    ];
  });

  statusFg(s: ScanStatus) { return STATUS_FG[s]; }
  statusLabel(s: ScanStatus) { return STATUS_LABEL[s]; }
  date(iso: string) {
    return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  }
}
