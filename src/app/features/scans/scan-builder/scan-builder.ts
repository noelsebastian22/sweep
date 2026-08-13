import { Component, ChangeDetectionStrategy, inject, signal, computed, DestroyRef } from '@angular/core';
import { Router } from '@angular/router';
import { auth, db } from '../../../core/supabase.service';
import { AuthStore } from '../../../stores/auth.store';
import { environment } from '../../../../environments/environment';

interface Trade { id: string; name: string }
interface Suburb { id: string; name: string }
interface Budget { api: string; sku: string; used: number; free_allowance: number; unit_cost_usd: number }

/**
 * The scan builder — the missing front door.
 *
 * `scan-create` has been deployed since weekend 2 but nothing in the app called it, so the
 * only way to start a scan was a hand-written SQL insert. Everything downstream (the live
 * screen, the grid) was reachable only for scans that already existed.
 *
 * The preflight is the point of this screen, not decoration. A scan is trades x suburbs
 * Places calls, billed per call, and 16 x 18 is 288 of them — a third of the monthly free
 * allowance in one click. The count and what it leaves behind are shown before the button,
 * not after.
 */
@Component({
  selector: 'app-scan-builder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div style="display:flex;flex-direction:column;gap:24px;max-width:860px;">
      <div>
        <h1 style="font-family:'Geist Sans',sans-serif;font-size:20px;font-weight:600;color:var(--color-sw-ink);margin:0 0 4px;">New scan</h1>
        <p style="font-size:14px;color:var(--color-sw-ink-mid);margin:0;">Every trade is searched in every suburb you pick. One Places call each.</p>
      </div>

      @if (loading()) {
        <p style="font-size:14px;color:var(--color-sw-ink-mid);">Loading trades and suburbs…</p>
      } @else {

        @for (group of groups(); track group.key) {
          <div style="display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;align-items:baseline;gap:12px;">
              <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.12em;color:var(--color-sw-ink-lo);">{{ group.label }}</span>
              <span data-mono style="font-size:12px;color:var(--color-sw-ink-lo);">{{ group.selected().length }} of {{ group.items().length }}</span>
              <button (click)="group.all()" style="border:0;background:none;padding:0;color:var(--color-sw-violet);font-size:12px;cursor:pointer;">All</button>
              <button (click)="group.none()" style="border:0;background:none;padding:0;color:var(--color-sw-violet);font-size:12px;cursor:pointer;">None</button>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              @for (item of group.items(); track item.id) {
                <button (click)="group.toggle(item.id)"
                  [style.background]="group.has(item.id) ? 'var(--color-sw-violet-soft)' : 'var(--color-sw-bg)'"
                  [style.border-color]="group.has(item.id) ? 'var(--color-sw-violet)' : 'var(--color-sw-rule-2)'"
                  [style.color]="group.has(item.id) ? 'var(--color-sw-violet)' : 'var(--color-sw-ink-mid)'"
                  style="height:30px;padding:0 12px;border:1px solid;border-radius:var(--radius-sw-pill);font-size:13px;cursor:pointer;"
                >{{ item.name }}</button>
              }
            </div>
          </div>
        }

        <div style="display:flex;align-items:center;gap:10px;">
          <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.12em;color:var(--color-sw-ink-lo);">Top N</span>
          <input type="number" min="1" max="500" [value]="topN()" (input)="topN.set(+$any($event.target).value)" data-mono
            style="height:34px;width:90px;padding:0 12px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);background:var(--color-sw-surface-2);font-size:14px;color:var(--color-sw-ink);" />
          <span style="font-size:13px;color:var(--color-sw-ink-mid);">bounds how many sites get a PageSpeed check, not how many leads you keep.</span>
        </div>

        <!-- Preflight -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--color-sw-rule);border:1px solid var(--color-sw-rule);border-radius:var(--radius-sw);overflow:hidden;">
          @for (stat of preflight(); track stat.label) {
            <div style="display:flex;flex-direction:column;gap:4px;padding:16px;background:var(--color-sw-bg);">
              <span data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.12em;color:var(--color-sw-ink-lo);line-height:1;">{{ stat.label }}</span>
              <span data-mono [style.color]="stat.warn ? 'var(--color-sw-warn)' : 'var(--color-sw-ink)'"
                style="font-size:24px;font-weight:500;line-height:1.1;">{{ stat.value }}</span>
            </div>
          }
        </div>

        @if (overBudget()) {
          <div style="padding:14px 16px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw);background:var(--color-sw-warn-bg);font-size:13px;color:var(--color-sw-ink-mid);line-height:1.5;">
            This scan needs <span data-mono style="color:var(--color-sw-ink);">{{ callCount() }}</span> calls but only
            <span data-mono style="color:var(--color-sw-ink);">{{ freeLeft() }}</span> remain free this month. It will run to the
            limit and then park, waiting for you to approve the rest. Nothing is spent without approval.
          </div>
        }

        @if (auth.isDemo()) {
          <p style="font-size:13px;color:var(--color-sw-ink-lo);margin:0;">The demo is read only — starting a scan is disabled.</p>
        }

        @if (error(); as err) {
          <span style="font-size:13px;color:var(--color-sw-fail);">{{ err }}</span>
        }

        <div style="display:flex;gap:10px;align-items:center;">
          <button (click)="start()" [disabled]="!canStart()"
            [style.opacity]="canStart() ? '1' : '0.45'"
            [style.cursor]="canStart() ? 'pointer' : 'not-allowed'"
            style="height:38px;padding:0 18px;border:1px solid var(--color-sw-violet);border-radius:var(--radius-sw-sm);background:var(--color-sw-violet);color:white;font-size:14px;font-weight:500;"
          >{{ busy() ? 'Starting…' : 'Start scan' }}</button>
          <span style="font-size:13px;color:var(--color-sw-ink-mid);">Runs in the background. You can close the tab.</span>
        </div>
      }
    </div>
  `,
})
export class ScanBuilder {
  private readonly router = inject(Router);
  readonly auth = inject(AuthStore);

  readonly trades = signal<Trade[]>([]);
  readonly suburbs = signal<Suburb[]>([]);
  private readonly budgets = signal<Budget[]>([]);

  readonly selectedTrades = signal<string[]>([]);
  readonly selectedSuburbs = signal<string[]>([]);
  readonly topN = signal(50);

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
    inject(DestroyRef).onDestroy(() => this.busy.set(false));
  }

  private async load() {
    const [t, s, b] = await Promise.all([
      db.from('trades').select('id, name').order('name'),
      db.from('suburbs').select('id, name').order('name'),
      db.from('api_budgets').select('api, sku, used, free_allowance, unit_cost_usd'),
    ]);
    this.trades.set((t.data ?? []) as Trade[]);
    this.suburbs.set((s.data ?? []) as Suburb[]);
    this.budgets.set((b.data ?? []) as Budget[]);
    this.loading.set(false);
  }

  /** One shape for both chip groups, so the template renders them with a single block. */
  readonly groups = computed(() => [
    this.group('trades', 'Trades', this.trades, this.selectedTrades),
    this.group('suburbs', 'Suburbs', this.suburbs, this.selectedSuburbs),
  ]);

  private group(
    key: string, label: string,
    items: () => { id: string; name: string }[],
    selected: ReturnType<typeof signal<string[]>>,
  ) {
    return {
      key, label, items, selected,
      has: (id: string) => selected().includes(id),
      toggle: (id: string) => selected.update((cur) =>
        cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]),
      all: () => selected.set(items().map((i) => i.id)),
      none: () => selected.set([]),
    };
  }

  private readonly placesBudget = computed(() =>
    this.budgets().find((b) => b.api === 'places_text_search') ?? null);

  readonly callCount = computed(() => this.selectedTrades().length * this.selectedSuburbs().length);

  readonly freeLeft = computed(() => {
    const b = this.placesBudget();
    return b ? Math.max(b.free_allowance - b.used, 0) : 0;
  });

  readonly overBudget = computed(() => this.callCount() > this.freeLeft());

  readonly preflight = computed(() => {
    const b = this.placesBudget();
    const calls = this.callCount();
    const over = Math.max(calls - this.freeLeft(), 0);
    return [
      { label: 'Queries', value: calls.toLocaleString('en-AU'), warn: false },
      { label: 'Free left', value: this.freeLeft().toLocaleString('en-AU'), warn: false },
      { label: 'Over free', value: over.toLocaleString('en-AU'), warn: over > 0 },
      {
        label: 'Cost if approved',
        value: `$${(over * Number(b?.unit_cost_usd ?? 0)).toFixed(2)}`,
        warn: over > 0,
      },
    ];
  });

  readonly canStart = computed(() =>
    !this.busy() && !this.auth.isDemo() && this.callCount() > 0);

  /**
   * Calls the `scan-create` edge function with the user's own JWT — never the service
   * role. The function re-derives the tenant from that token rather than trusting a body
   * field, and the demo tenant is refused by RLS inside it, not by the check above; the
   * disabled button is a courtesy, the policy is the control.
   */
  async start() {
    if (!this.canStart()) return;
    this.busy.set(true);
    this.error.set(null);

    const { data } = await auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      this.error.set('Your session has expired — sign in again.');
      this.busy.set(false);
      return;
    }

    try {
      const res = await fetch(`${environment.supabaseUrl}/functions/v1/scan-create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: environment.supabasePublishableKey,
        },
        body: JSON.stringify({
          trade_ids: this.selectedTrades(),
          suburb_ids: this.selectedSuburbs(),
          top_n: this.topN(),
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.scan_id) {
        this.error.set(body.error ?? `Couldn't create the scan (HTTP ${res.status}).`);
        this.busy.set(false);
        return;
      }

      await this.router.navigate(['/scans', body.scan_id]);
    } catch (e) {
      this.error.set(String(e));
      this.busy.set(false);
    }
  }
}
