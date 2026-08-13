import {
  Component, ChangeDetectionStrategy, inject, computed, signal, effect, DestroyRef, input,
} from '@angular/core';
import { Router } from '@angular/router';
import { ScanStore, ScanStatus, EventKind } from '../scan.store';
import { AuthStore } from '../../../stores/auth.store';

/** Status → the one semantic colour it is allowed to use. Violet is progress, warn is
 *  spend/parked, ok is done, fail is failure. Nothing here is decorative. */
const STATUS_STYLE: Record<ScanStatus, { label: string; fg: string; bg: string }> = {
  queued:            { label: 'Queued',            fg: 'var(--color-sw-ink-mid)', bg: 'var(--color-sw-surface-2)' },
  searching:         { label: 'Searching',         fg: 'var(--color-sw-violet)',  bg: 'var(--color-sw-violet-soft)' },
  measuring:         { label: 'Measuring',         fg: 'var(--color-sw-violet)',  bg: 'var(--color-sw-violet-soft)' },
  awaiting_approval: { label: 'Needs approval',    fg: 'var(--color-sw-warn)',    bg: 'var(--color-sw-warn-bg)' },
  completed:         { label: 'Completed',         fg: 'var(--color-sw-ok)',      bg: '#E8F4EF' },
  partial:           { label: 'Partial',           fg: 'var(--color-sw-warn)',    bg: 'var(--color-sw-warn-bg)' },
  failed:            { label: 'Failed',            fg: 'var(--color-sw-fail)',    bg: '#FBEDEB' },
  cancelled:         { label: 'Cancelled',         fg: 'var(--color-sw-ink-lo)',  bg: 'var(--color-sw-surface-2)' },
};

const EVENT_FG: Record<EventKind, string> = {
  stage:     'var(--color-sw-ink)',
  discovery: 'var(--color-sw-violet)',
  query:     'var(--color-sw-ink-mid)',
  spend:     'var(--color-sw-warn)',
  error:     'var(--color-sw-fail)',
};

@Component({
  selector: 'app-live-scan',
  standalone: true,
  providers: [ScanStore],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div style="display:flex;flex-direction:column;gap:24px;max-width:960px;">

      @if (store.loading()) {
        <p style="font-size:14px;color:var(--color-sw-ink-mid);">Loading scan…</p>
      } @else if (store.error()) {
        <div style="padding:16px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw);">
          <span style="font-size:14px;color:var(--color-sw-fail);">{{ store.error() }}</span>
        </div>
      } @else if (scan(); as s) {

        <!-- Region 1 — heading, status, and the live/terminal counters -->
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <h1 style="font-family:'Geist Sans',sans-serif;font-size:20px;font-weight:600;color:var(--color-sw-ink);margin:0;">Scan</h1>
            <span data-mono style="font-size:12px;color:var(--color-sw-ink-lo);">{{ s.id.slice(0, 8) }}</span>

            <span data-mono
              [style.color]="statusStyle().fg"
              [style.background]="statusStyle().bg"
              style="display:inline-flex;align-items:center;height:22px;padding:0 10px;border-radius:var(--radius-sw-pill);font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.1em;"
            >{{ statusStyle().label }}</span>

            @if (!store.isTerminal()) {
              <span data-mono
                [style.color]="store.connected() ? 'var(--color-sw-ok)' : 'var(--color-sw-ink-lo)'"
                style="font-size:12px;">{{ store.connected() ? 'Live' : 'Reconnecting…' }}</span>
            }

            <span style="flex:1;"></span>

            @if (!store.isTerminal() && !auth.isDemo()) {
              <button (click)="cancel()" [disabled]="store.busy()"
                style="height:32px;padding:0 12px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);background:white;color:var(--color-sw-ink-mid);font-size:13px;font-weight:500;cursor:pointer;"
              >Cancel scan</button>
            }
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;background:var(--color-sw-rule);border:1px solid var(--color-sw-rule);border-radius:var(--radius-sw);overflow:hidden;">
            @for (stat of stats(); track stat.label) {
              <div style="display:flex;flex-direction:column;gap:4px;padding:16px;background:var(--color-sw-bg);">
                <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.12em;color:var(--color-sw-ink-lo);line-height:1;">{{ stat.label }}</span>
                <span data-mono style="font-size:24px;font-weight:500;color:var(--color-sw-ink);line-height:1.1;">{{ stat.value }}</span>
              </div>
            }
          </div>
        </div>

        <!-- Region 2 — the progress rail. Two stages, because the scan genuinely has two. -->
        @if (s.total_queries > 0) {
          <div style="display:flex;flex-direction:column;gap:14px;padding:20px;border:1px solid var(--color-sw-rule);border-radius:var(--radius-sw);">
            @for (rail of rails(); track rail.label) {
              <div style="display:flex;flex-direction:column;gap:6px;">
                <div style="display:flex;align-items:baseline;justify-content:space-between;">
                  <span style="font-size:13px;color:var(--color-sw-ink-mid);">{{ rail.label }}</span>
                  <span data-mono style="font-size:13px;color:var(--color-sw-ink);">{{ rail.done }} / {{ rail.total }}</span>
                </div>
                <!-- A hairline track with a violet fill. No shimmer, no stripes, no
                     indeterminate animation — the numbers above carry the information. -->
                <div style="height:6px;border-radius:var(--radius-sw-pill);background:var(--color-sw-surface-2);overflow:hidden;">
                  <div [style.width.%]="rail.pct"
                    [style.background]="rail.failed ? 'var(--color-sw-fail)' : 'var(--color-sw-violet)'"
                    style="height:100%;border-radius:var(--radius-sw-pill);transition:width 240ms ease-out;"></div>
                </div>
              </div>
            }
          </div>
        }

        <!-- Region 3a — the parked state. The one screen element that asks for a decision. -->
        @if (store.isParked()) {
          <div style="display:flex;flex-direction:column;gap:14px;padding:20px;border:1px solid var(--color-sw-rule-2);border-left:3px solid var(--color-sw-warn);border-radius:var(--radius-sw);background:var(--color-sw-warn-bg);">
            <div style="display:flex;flex-direction:column;gap:4px;">
              <span style="font-family:'Geist Sans',sans-serif;font-size:15px;font-weight:600;color:var(--color-sw-ink);">Paused — the allowance ran out</span>
              <span style="font-size:14px;color:var(--color-sw-ink-mid);line-height:1.5;">
                {{ parkedMessage() }}
              </span>
            </div>

            @if (blocked(); as b) {
              <div style="display:flex;flex-wrap:wrap;gap:20px;font-size:13px;color:var(--color-sw-ink-mid);">
                <span>Used <span data-mono style="color:var(--color-sw-ink);">{{ b.used }}</span> of <span data-mono style="color:var(--color-sw-ink);">{{ b.free_allowance }}</span> free</span>
                <span>Rate <span data-mono style="color:var(--color-sw-ink);">\${{ b.unit_cost_usd }}</span> / call</span>
              </div>

              @if (auth.isDemo()) {
                <span style="font-size:13px;color:var(--color-sw-ink-lo);">The demo is read only — approving spend is disabled.</span>
              } @else {
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                  <input type="number" min="1" max="1000" [value]="approveCalls()"
                    (input)="approveCalls.set(+$any($event.target).value)"
                    data-mono
                    style="height:36px;width:110px;padding:0 12px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);background:white;font-size:14px;color:var(--color-sw-ink);"
                  />
                  <span style="font-size:13px;color:var(--color-sw-ink-mid);">
                    calls — costs <span data-mono style="color:var(--color-sw-ink);">\${{ approveCost() }}</span>
                  </span>
                  <button (click)="approve()" [disabled]="store.busy() || approveCalls() < 1"
                    style="height:36px;padding:0 16px;border:1px solid var(--color-sw-violet);border-radius:var(--radius-sw-sm);background:var(--color-sw-violet);color:white;font-size:13px;font-weight:500;cursor:pointer;"
                  >{{ store.busy() ? 'Approving…' : 'Approve and resume' }}</button>
                </div>
                <span style="font-size:12px;color:var(--color-sw-ink-lo);">
                  Grants are capped server side at 1,000 calls and $35 each, $50 a month. The scan resumes on the next tick, within a minute.
                </span>
              }
            }

            @if (store.actionError(); as err) {
              <span style="font-size:13px;color:var(--color-sw-fail);">{{ err }}</span>
            }
          </div>
        }

        <!-- Region 3b — the terminal summary the screen settles into. -->
        @if (store.isTerminal()) {
          <div style="display:flex;flex-direction:column;gap:8px;padding:20px;border:1px solid var(--color-sw-rule);border-left:3px solid {{ statusStyle().fg }};border-radius:var(--radius-sw);">
            <span style="font-family:'Geist Sans',sans-serif;font-size:15px;font-weight:600;color:var(--color-sw-ink);">{{ terminalHeadline() }}</span>
            <span style="font-size:14px;color:var(--color-sw-ink-mid);line-height:1.5;">{{ terminalDetail() }}</span>
            <div style="display:flex;gap:10px;margin-top:6px;">
              <button (click)="router.navigate(['/leads'])"
                style="height:34px;padding:0 14px;border:1px solid var(--color-sw-violet);border-radius:var(--radius-sw-sm);background:var(--color-sw-violet);color:white;font-size:13px;font-weight:500;cursor:pointer;"
              >View leads</button>
              <button (click)="router.navigate(['/scans/new'])"
                style="height:34px;padding:0 14px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);background:white;color:var(--color-sw-violet);font-size:13px;font-weight:500;cursor:pointer;"
              >New scan</button>
            </div>
          </div>
        }

        <!-- Region 4 — the log. Newest first, hairline rows, mono timestamps. -->
        <div style="display:flex;flex-direction:column;gap:10px;">
          <div style="display:flex;align-items:baseline;justify-content:space-between;">
            <h2 style="font-family:'Geist Sans',sans-serif;font-size:15px;font-weight:600;color:var(--color-sw-ink);margin:0;">Activity</h2>
            <span data-mono style="font-size:12px;color:var(--color-sw-ink-lo);">{{ store.events().length }} events</span>
          </div>

          @if (store.feed().length === 0) {
            <p style="font-size:14px;color:var(--color-sw-ink-mid);margin:0;">Nothing logged yet. The first tick picks this scan up within a minute.</p>
          } @else {
            <div style="border:1px solid var(--color-sw-rule);border-radius:var(--radius-sw);overflow:hidden;">
              @for (e of store.feed(); track e.id) {
                <div style="display:grid;grid-template-columns:76px 1fr;align-items:center;gap:12px;height:44px;padding:0 16px;border-bottom:1px solid var(--color-sw-rule);">
                  <span data-mono style="font-size:12px;color:var(--color-sw-ink-lo);">{{ time(e.at) }}</span>
                  <span [style.color]="eventFg(e.kind)" style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ e.message }}</span>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class LiveScan {
  /** Bound from the route's `:id` via `withComponentInputBinding()`. */
  readonly id = input.required<string>();

  readonly store = inject(ScanStore);
  readonly auth = inject(AuthStore);
  readonly router = inject(Router);

  readonly scan = computed(() => this.store.scan());
  readonly blocked = computed(() => this.store.blockedOn());

  readonly approveCalls = signal(100);

  /** Ticks only while the scan is live, so a finished scan left open costs nothing. */
  private readonly now = signal(Date.now());

  constructor() {
    effect(() => {
      const scanId = this.id();
      if (scanId) void this.store.open(scanId);
    });

    const timer = setInterval(() => {
      if (!this.store.isTerminal()) this.now.set(Date.now());
    }, 1000);

    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      this.store.close();
    });
  }

  readonly statusStyle = computed(() =>
    STATUS_STYLE[this.scan()?.status ?? 'queued']);

  readonly stats = computed(() => {
    const s = this.scan();
    if (!s) return [];
    return [
      { label: 'Queries', value: `${s.completed_queries + s.failed_queries} / ${s.total_queries}` },
      { label: 'Businesses', value: s.businesses_found.toLocaleString('en-AU') },
      { label: 'Measured', value: `${s.psi_completed} / ${s.psi_total}` },
      { label: 'Failed', value: s.failed_queries.toLocaleString('en-AU') },
      { label: 'Elapsed', value: this.elapsed() },
    ];
  });

  readonly rails = computed(() => {
    const s = this.scan();
    if (!s) return [];
    const rails = [{
      label: 'Search', done: s.completed_queries + s.failed_queries, total: s.total_queries,
      pct: this.store.searchPct(), failed: s.total_queries > 0 && s.completed_queries === 0 && s.failed_queries > 0,
    }];
    // The measure rail only exists once the search stage has handed one over. Showing an
    // empty 0/0 bar before that reads as "stuck" rather than "not started".
    if (s.psi_total > 0) {
      rails.push({
        label: 'Measure', done: s.psi_completed, total: s.psi_total,
        pct: this.store.psiPct(), failed: false,
      });
    }
    return rails;
  });

  readonly elapsed = computed(() => {
    const s = this.scan();
    if (!s?.started_at) return '—';
    const end = s.finished_at ? Date.parse(s.finished_at) : this.now();
    const secs = Math.max(0, Math.round((end - Date.parse(s.started_at)) / 1000));
    const m = Math.floor(secs / 60);
    return m > 0 ? `${m}m ${String(secs % 60).padStart(2, '0')}s` : `${secs}s`;
  });

  readonly approveCost = computed(() => {
    const b = this.blocked();
    if (!b) return '0.00';
    return (this.approveCalls() * Number(b.unit_cost_usd)).toFixed(2);
  });

  readonly parkedMessage = computed(() => {
    const s = this.scan();
    const b = this.blocked();
    if (!s) return '';
    const remaining = b?.api === 'psi'
      ? s.psi_total - s.psi_completed
      : s.total_queries - s.completed_queries - s.failed_queries;
    const what = b?.api === 'psi' ? 'sites left to measure' : 'queries left to run';
    return `The scan stopped rather than spending past its allowance. `
      + `${remaining} ${what}. Approve more calls and it resumes on its own.`;
  });

  readonly terminalHeadline = computed(() => {
    const s = this.scan();
    if (!s) return '';
    switch (s.status) {
      case 'completed': return 'Scan complete';
      case 'partial':   return `Finished with ${s.failed_queries} failed ${s.failed_queries === 1 ? 'query' : 'queries'}`;
      case 'failed':    return 'Scan failed';
      case 'cancelled': return 'Scan cancelled';
      default:          return '';
    }
  });

  readonly terminalDetail = computed(() => {
    const s = this.scan();
    if (!s) return '';
    if (s.status === 'cancelled') {
      return `Stopped after ${s.completed_queries} of ${s.total_queries} queries. Anything already found is on the leads grid.`;
    }
    if (s.status === 'failed') {
      return 'No queries resolved, so nothing was measured. Check the activity log below for the failure.';
    }
    return `${s.completed_queries} of ${s.total_queries} queries ran, `
      + `${s.businesses_found.toLocaleString('en-AU')} new ${s.businesses_found === 1 ? 'business' : 'businesses'} found, `
      + `${s.psi_completed} ${s.psi_completed === 1 ? 'site' : 'sites'} measured in ${this.elapsed()}.`;
  });

  eventFg(kind: EventKind): string {
    return EVENT_FG[kind] ?? 'var(--color-sw-ink-mid)';
  }

  time(at: string): string {
    return new Date(at).toLocaleTimeString('en-AU', { hour12: false });
  }

  async approve() {
    await this.store.approve(this.approveCalls());
  }

  async cancel() {
    await this.store.cancel();
  }
}
