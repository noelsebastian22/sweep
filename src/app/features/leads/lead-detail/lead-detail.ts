import { Component, ChangeDetectionStrategy, inject, input, computed, signal, resource, effect } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '../../../stores/auth.store';
import { LeadsStore, LeadStatus } from '../leads.store';
import { db, auth } from '../../../core/supabase.service';
import { environment } from '../../../../environments/environment';
import { scoreBreakdown, WEBSITE_KIND_LABEL } from '../../../shared/scoring/score';
import { snapshotUrl } from '../snapshot-url';
import { fetchLeadDetail, buildTimeline, LeadDetailData, PsiResultRow } from './lead-detail.data';

const STATUS_OPTIONS: LeadStatus[] = [
  'identified', 'shortlisted', 'mockup_built', 'contacted', 'replied', 'won', 'lost', 'rejected',
];

/** The client's own abort. The server may still land its writes, which is why the abort
 * path re-reads rather than reporting a failure. */
const RECHECK_TIMEOUT_MS = 60_000;

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60_000);
  if (!Number.isFinite(mins)) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

function untilTime(iso: string): string {
  const mins = Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

const DATE_FMT = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const TIME_FMT = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' });

/**
 * `/leads/:id` — one lead as a document (BUILD-PLAN.md §8.5).
 *
 * The design constraint is the whole point of the page: same tokens as the grid, opposite
 * density. One 720px column, wide margins, `body-lg` prose, and no 44px rows anywhere. §8.5
 * says plainly that if it ends up looking like the grid with fewer rows, the page has
 * failed.
 *
 * The awkward part is that the scoring model rates a business with no website highest, so
 * the page's two largest blocks are empty exactly when the lead is best. Rather than
 * collapsing them, the empty case is rewritten as the finding itself — which turns the
 * thinnest page into the most persuasive one.
 */
@Component({
  selector: 'app-lead-detail',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <div style="max-width:720px;margin:0 auto;padding:8px 0 96px;">

      @if (lead.isLoading()) {
        <p style="font-size:15px;color:var(--color-sw-ink-mid);">Loading lead…</p>
      } @else if (lead.error()) {
        <div style="display:flex;flex-direction:column;gap:16px;align-items:flex-start;">
          <p style="font-size:18px;line-height:1.5;color:var(--color-sw-fail);margin:0;">Couldn't load this lead.</p>
          <p style="font-size:15px;color:var(--color-sw-ink-mid);margin:0;">{{ errorText() }}</p>
          <button type="button" (click)="lead.reload()" [style]="primaryButton">Try again</button>
        </div>
      } @else if (!lead.value()) {
        <div style="display:flex;flex-direction:column;gap:16px;align-items:flex-start;">
          <h1 style="font-family:'Geist Sans',sans-serif;font-size:36px;line-height:1.1;font-weight:700;color:var(--color-sw-ink);margin:0;">Not found</h1>
          <p style="font-size:18px;line-height:1.5;color:var(--color-sw-ink-mid);margin:0;max-width:60ch;">
            No lead with this id exists in your workspace.
          </p>
          <a routerLink="/leads" [style]="primaryButton">Back to leads</a>
        </div>
      } @else if (lead.value(); as d) {

        <!-- ── Header ─────────────────────────────────────────────────────────── -->
        <nav style="display:flex;align-items:center;justify-content:space-between;margin-bottom:32px;">
          <a routerLink="/leads" style="font-size:15px;color:var(--color-sw-violet);text-decoration:none;">← All leads</a>
          @if (hasNeighbours()) {
            <div style="display:flex;align-items:center;gap:4px;">
              <button type="button" (click)="goPrev()" [disabled]="!prevRow()" [style]="stepButton(!prevRow())" title="Previous lead">← Prev</button>
              <span data-mono style="font-size:12px;color:var(--color-sw-ink-lo);padding:0 6px;">{{ currentIndex() + 1 }} / {{ store.sortedRows().length }}</span>
              <button type="button" (click)="goNext()" [disabled]="!nextRow()" [style]="stepButton(!nextRow())" title="Next lead">Next →</button>
            </div>
          }
        </nav>

        <header style="margin-bottom:44px;">
          <h1 style="font-family:'Geist Sans',sans-serif;font-size:36px;line-height:1.1;font-weight:700;letter-spacing:-0.01em;color:var(--color-sw-ink);margin:0 0 12px;">{{ d.businesses.name }}</h1>
          <p style="font-size:18px;line-height:1.5;color:var(--color-sw-ink-mid);margin:0;">
            {{ d.businesses.trades?.name || 'Trade unknown' }} · {{ d.businesses.suburbs?.name || 'Suburb unknown' }}
          </p>
        </header>

        <!-- ── Score derivation ───────────────────────────────────────────────── -->
        <!-- Placed first: it is the reason this lead is in front of you. -->
        <section [style]="block">
          <h2 [style]="blockLabel">Lead score</h2>
          <p data-mono style="font-size:44px;line-height:1;font-weight:500;color:var(--color-sw-ink);margin:0 0 16px;">{{ breakdown().score.toFixed(1) }}</p>
          <p data-mono style="font-size:16px;line-height:1.6;color:var(--color-sw-ink-mid);margin:0;">
            {{ breakdown().ratingCount }} reviews × ({{ breakdown().rating.toFixed(1) }}/5) × {{ breakdown().penalty.toFixed(1) }}
            <span style="color:var(--color-sw-ink-lo);">({{ breakdown().penaltyLabel }})</span>
          </p>
          @if (d.businesses.website_kind === 'social') {
            <p style="font-size:16px;line-height:1.6;color:var(--color-sw-ink-mid);margin:16px 0 0;max-width:62ch;">
              A social-only presence scores on its own multiplier. The PageSpeed score below,
              if one has been captured, plays no part in this arithmetic.
            </p>
          }
        </section>

        <!-- ── Contact ────────────────────────────────────────────────────────── -->
        <section [style]="block">
          <h2 [style]="blockLabel">Contact</h2>
          <dl style="margin:0;display:grid;grid-template-columns:120px 1fr;gap:14px 24px;font-size:16px;line-height:1.5;">
            <dt style="color:var(--color-sw-ink-lo);">Phone</dt>
            <dd data-mono style="margin:0;color:var(--color-sw-ink);">
              @if (d.businesses.phone) {
                <a [href]="'tel:' + d.businesses.phone" style="color:var(--color-sw-ink);text-decoration:none;">{{ d.businesses.phone }}</a>
              } @else { — }
            </dd>
            <dt style="color:var(--color-sw-ink-lo);">Address</dt>
            <dd style="margin:0;color:var(--color-sw-ink);">{{ d.businesses.address || '—' }}</dd>
            <dt style="color:var(--color-sw-ink-lo);">Rating</dt>
            <dd data-mono style="margin:0;color:var(--color-sw-ink);">
              {{ d.businesses.rating != null ? d.businesses.rating.toFixed(1) : '—' }}
              <span style="color:var(--color-sw-ink-lo);">from {{ d.businesses.rating_count ?? 0 }} reviews</span>
            </dd>
            <dt style="color:var(--color-sw-ink-lo);">Listing</dt>
            <dd style="margin:0;">
              <a [href]="mapsUrl()" target="_blank" rel="noopener" style="color:var(--color-sw-violet);">Open in Google Maps ↗</a>
            </dd>
          </dl>
        </section>

        <!-- ── Site ───────────────────────────────────────────────────────────── -->
        <section [style]="block">
          @if (d.businesses.website_kind === 'none') {
            <!-- The opportunity block. The empty case IS the finding, so it is written as
                 one rather than rendered as a row of blanks. -->
            <h2 [style]="blockLabel">The opportunity</h2>
            <p style="font-size:18px;line-height:1.55;color:var(--color-sw-ink);margin:0 0 16px;max-width:62ch;">
              No website found. Their Google listing is their entire online presence.
            </p>
            <p style="font-size:16px;line-height:1.6;color:var(--color-sw-ink-mid);margin:0;max-width:62ch;">
              They have earned
              <strong data-mono style="color:var(--color-sw-ink);font-weight:500;">{{ d.businesses.rating_count ?? 0 }}</strong>
              reviews at
              <strong data-mono style="color:var(--color-sw-ink);font-weight:500;">{{ d.businesses.rating != null ? d.businesses.rating.toFixed(1) : '—' }}</strong>
              without one, which is the whole argument for the call.
            </p>
          } @else {
            <h2 [style]="blockLabel">{{ d.businesses.website_kind === 'social' ? 'Their social page' : 'Their site' }}</h2>

            @if (d.businesses.website_url) {
              <p style="font-size:16px;line-height:1.5;margin:0 0 20px;overflow-wrap:anywhere;">
                <a [href]="d.businesses.website_url" target="_blank" rel="noopener" style="color:var(--color-sw-violet);">{{ d.businesses.website_url }} ↗</a>
              </p>
            }

            <!-- Screenshot frame -->
            @if (snapshot(); as snap) {
              <img
                [src]="snapshotUrlFor(snap.storage_path)"
                [alt]="'Screenshot of ' + d.businesses.name"
                loading="lazy"
                style="display:block;width:100%;border:1px solid var(--color-sw-rule);border-radius:var(--radius-sw);background:var(--color-sw-surface-2);"
              />
              <p style="font-size:13px;color:var(--color-sw-ink-lo);margin:10px 0 0;">Captured {{ relative(snap.captured_at) }}</p>
            } @else {
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:200px;padding:32px;border:1px solid var(--color-sw-rule);border-radius:var(--radius-sw);background:var(--color-sw-surface-2);">
                <p style="font-size:15px;color:var(--color-sw-ink-lo);margin:0;text-align:center;max-width:44ch;">
                  {{ captureBlurb() }}
                </p>
              </div>
            }

            <!-- PageSpeed breakdown -->
            @if (latestGoodPsi(); as psi) {
              <div style="margin-top:32px;">
                <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:20px;">
                  <p data-mono style="font-size:30px;line-height:1;font-weight:500;margin:0;" [style.color]="psiColour(psi.score)">{{ psi.score }}<span style="font-size:15px;color:var(--color-sw-ink-lo);"> / 100</span></p>
                  <p style="font-size:13px;color:var(--color-sw-ink-lo);margin:0;">Measured {{ relative(psi.checked_at) }}</p>
                </div>
                <dl style="margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:20px 16px;">
                  @for (m of metrics(psi); track m.label) {
                    <div>
                      <dt data-mono style="font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.14em;color:var(--color-sw-ink-lo);margin-bottom:6px;">{{ m.label }}</dt>
                      <dd data-mono style="margin:0;font-size:18px;color:var(--color-sw-ink);">{{ m.value }}</dd>
                    </div>
                  }
                </dl>
              </div>
            } @else if (d.businesses.website_kind === 'site') {
              <p style="font-size:16px;line-height:1.6;color:var(--color-sw-ink-mid);margin:24px 0 0;max-width:62ch;">
                No successful PageSpeed measurement yet.
              </p>
            }

            <!-- The capture / recheck action -->
            <div style="margin-top:28px;display:flex;flex-wrap:wrap;align-items:center;gap:12px;">
              <button type="button" (click)="recheck()" [disabled]="!canRecheck()" [style]="primaryButton" [style.opacity]="canRecheck() ? '1' : '0.5'" [style.cursor]="canRecheck() ? 'pointer' : 'not-allowed'">
                {{ rechecking() ? 'Measuring…' : captureLabel() }}
              </button>
              @if (recheckHint(); as hint) {
                <span style="font-size:13px;color:var(--color-sw-ink-lo);">{{ hint }}</span>
              }
            </div>
            @if (recheckError(); as err) {
              <p style="font-size:14px;color:var(--color-sw-fail);margin:12px 0 0;">{{ err }}</p>
            }
            @if (recheckNote(); as note) {
              <p style="font-size:14px;color:var(--color-sw-warn);margin:12px 0 0;">{{ note }}</p>
            }
          }
        </section>

        <!-- ── Status ─────────────────────────────────────────────────────────── -->
        <section [style]="block">
          <h2 [style]="blockLabel">Status</h2>
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;">
            <select
              [value]="d.status"
              (change)="onStatusChange($event)"
              [disabled]="auth.isDemo()"
              [attr.title]="auth.isDemo() ? 'Read only in the demo' : null"
              style="height:44px;padding:0 14px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);background:var(--color-sw-surface-2);font-family:'Geist Sans',sans-serif;font-size:16px;color:var(--color-sw-ink);text-transform:capitalize;"
            >
              @for (s of statusOptions; track s) {
                <option [value]="s">{{ s.replace('_', ' ') }}</option>
              }
            </select>
            @if (statusSavedAt(); as at) {
              <span style="font-size:13px;color:var(--color-sw-ok);">Saved {{ relative(at) }}</span>
            }
          </div>
          @if (statusError(); as err) {
            <p style="font-size:14px;color:var(--color-sw-fail);margin:12px 0 0;">{{ err }}</p>
          }
        </section>

        <!-- ── Notes ──────────────────────────────────────────────────────────── -->
        <section [style]="block">
          <h2 [style]="blockLabel">Notes</h2>
          <textarea
            [value]="notesDraft()"
            (input)="notesDraft.set($any($event.target).value)"
            [disabled]="auth.isDemo()"
            rows="5"
            placeholder="What you found, what you pitched, what they said…"
            style="width:100%;box-sizing:border-box;padding:14px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw);background:var(--color-sw-surface-2);font-family:'Geist Sans',sans-serif;font-size:16px;line-height:1.6;color:var(--color-sw-ink);resize:vertical;"
          ></textarea>
          <div style="margin-top:12px;display:flex;flex-wrap:wrap;align-items:center;gap:12px;">
            <button type="button" (click)="saveNotes()" [disabled]="!notesDirty() || auth.isDemo() || savingNotes()" [style]="primaryButton" [style.opacity]="(notesDirty() && !auth.isDemo() && !savingNotes()) ? '1' : '0.5'" [style.cursor]="(notesDirty() && !auth.isDemo() && !savingNotes()) ? 'pointer' : 'not-allowed'">
              {{ savingNotes() ? 'Saving…' : 'Save notes' }}
            </button>
            @if (notesSavedAt(); as at) {
              <span style="font-size:13px;color:var(--color-sw-ok);">Saved {{ relative(at) }}</span>
            }
          </div>
          @if (notesError(); as err) {
            <p style="font-size:14px;color:var(--color-sw-fail);margin:12px 0 0;">{{ err }}</p>
          }
        </section>

        <!-- ── Timeline ───────────────────────────────────────────────────────── -->
        <section [style]="block">
          <h2 [style]="blockLabel">Timeline</h2>
          @if (timeline().length === 0) {
            <p style="font-size:16px;color:var(--color-sw-ink-mid);margin:0;">Nothing recorded yet.</p>
          } @else {
            <ol style="list-style:none;margin:0;padding:0;">
              @for (t of timeline(); track t.key) {
                <li style="display:grid;grid-template-columns:132px 1fr;gap:20px;padding:16px 0;border-bottom:1px solid var(--color-sw-rule);">
                  <div>
                    <p data-mono style="font-size:13px;color:var(--color-sw-ink);margin:0;">{{ dateOf(t.at) }}</p>
                    <p data-mono style="font-size:12px;color:var(--color-sw-ink-lo);margin:2px 0 0;">{{ timeOf(t.at) }}</p>
                  </div>
                  <div>
                    <p style="font-size:16px;line-height:1.5;margin:0;" [style.color]="t.failed ? 'var(--color-sw-fail)' : 'var(--color-sw-ink)'">{{ t.title }}</p>
                    @if (t.detail) {
                      <p style="font-size:14px;line-height:1.5;color:var(--color-sw-ink-mid);margin:4px 0 0;">{{ t.detail }}</p>
                    }
                    @if (t.kind === 'status' || t.kind === 'notes' || t.kind === 'recheck') {
                      <p style="font-size:13px;color:var(--color-sw-ink-lo);margin:4px 0 0;">{{ t.actor ? 'by you' : 'by the engine' }}</p>
                    }
                  </div>
                </li>
              }
            </ol>
          }
        </section>
      }
    </div>
  `,
})
export class LeadDetail {
  /** Bound from the route's `:id` via `withComponentInputBinding()`. */
  readonly id = input.required<string>();

  readonly store = inject(LeadsStore);
  readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  readonly statusOptions = STATUS_OPTIONS;
  readonly snapshotUrlFor = snapshotUrl;
  readonly relative = relativeTime;

  // Shared inline styles, so the block rhythm is stated once. Generous vertical space and
  // a hairline between sections is the whole density device — no cards, no boxes.
  readonly block = 'padding:36px 0;border-top:1px solid var(--color-sw-rule);';
  readonly blockLabel =
    "font-family:'Geist Mono',monospace;font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:0.14em;color:var(--color-sw-ink-lo);margin:0 0 18px;";
  readonly primaryButton =
    'display:inline-flex;align-items:center;height:44px;padding:0 18px;border:1px solid var(--color-sw-violet);border-radius:var(--radius-sw-sm);background:var(--color-sw-violet);color:white;font-family:\'Geist Sans\',sans-serif;font-size:15px;font-weight:500;cursor:pointer;text-decoration:none;';

  readonly lead = resource<LeadDetailData | null, string>({
    params: () => this.id(),
    loader: ({ params, abortSignal }) => fetchLeadDetail(params, abortSignal),
  });

  // ---- Derived reads --------------------------------------------------------------

  readonly errorText = computed(() => {
    const e = this.lead.error();
    return e instanceof Error ? e.message : String(e ?? '');
  });

  /** The block is labelled with the `checked_at` of the row it is *showing* — deliberately
   * not the newest measurement of any kind, or a page that had just failed a recheck would
   * read "measured 2 minutes ago" above week-old numbers. */
  readonly latestGoodPsi = computed<PsiResultRow | null>(() => {
    const rows = this.lead.value()?.businesses?.psi_results ?? [];
    return rows.find((p) => p.error == null) ?? null;
  });

  /** The guard reads every measurement, successful or not — the newest attempt is what
   * decides when the button comes back. */
  readonly latestAnyPsi = computed<PsiResultRow | null>(
    () => this.lead.value()?.businesses?.psi_results?.[0] ?? null,
  );

  readonly snapshot = computed(() => this.lead.value()?.businesses?.site_snapshots?.[0] ?? null);

  readonly timeline = computed(() => {
    const d = this.lead.value();
    return d ? buildTimeline(d) : [];
  });

  readonly breakdown = computed(() => {
    const b = this.lead.value()?.businesses;
    return scoreBreakdown(
      b?.rating ?? null,
      b?.rating_count ?? null,
      b?.website_kind ?? null,
      // The same input the grid uses: a PSI score only counts for a real site, which is
      // what the weekend 5 migration enforces in `lead_rows` for every other surface.
      b?.website_kind === 'site' ? this.latestGoodPsi()?.score ?? null : null,
      this.store.weights(),
    );
  });

  readonly mapsUrl = computed(() => {
    const b = this.lead.value()?.businesses;
    return b?.google_place_id
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.name)}&query_place_id=${b.google_place_id}`
      : 'https://www.google.com/maps';
  });

  // ---- Prev / next ----------------------------------------------------------------
  // Walk the grid's current sorted and filtered order, so the page follows whatever the
  // grid is showing. On a cold visit there is no such set yet, so the controls simply do
  // not render until the store arrives — the page itself never waits on it.

  readonly currentIndex = computed(() => this.store.sortedRows().findIndex((r) => r.lead_id === this.id()));
  readonly hasNeighbours = computed(() => this.currentIndex() >= 0 && this.store.sortedRows().length > 1);
  readonly prevRow = computed(() => {
    const i = this.currentIndex();
    return i > 0 ? this.store.sortedRows()[i - 1] : null;
  });
  readonly nextRow = computed(() => {
    const i = this.currentIndex();
    const rows = this.store.sortedRows();
    return i >= 0 && i < rows.length - 1 ? rows[i + 1] : null;
  });

  // ---- Local write state ----------------------------------------------------------

  readonly notesDraft = signal('');
  readonly savingNotes = signal(false);
  readonly notesSavedAt = signal<string | null>(null);
  readonly notesError = signal<string | null>(null);

  readonly statusError = signal<string | null>(null);
  readonly statusSavedAt = signal<string | null>(null);

  readonly rechecking = signal(false);
  readonly recheckError = signal<string | null>(null);
  readonly recheckNote = signal<string | null>(null);

  readonly notesDirty = computed(() => this.notesDraft() !== (this.lead.value()?.notes ?? ''));

  // ---- The recheck guard ----------------------------------------------------------

  /** 24 hours after a success, 1 hour after a failure. A product rule, not a budget one:
   * performance rarely moves within a day, but an unreachable site is exactly the case
   * worth retrying sooner. The server enforces the same windows — this only keeps the UI
   * honest about it. */
  readonly recheckAvailableAt = computed<string | null>(() => {
    const last = this.latestAnyPsi();
    if (!last) return null;
    const window = last.error == null ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
    return new Date(new Date(last.checked_at).getTime() + window).toISOString();
  });

  readonly recheckBlocked = computed(() => {
    const at = this.recheckAvailableAt();
    return at !== null && Date.now() < new Date(at).getTime();
  });

  readonly canRecheck = computed(() =>
    !this.rechecking() && !this.auth.isDemo() && !this.recheckBlocked()
    && !!this.lead.value()?.businesses?.website_url,
  );

  readonly recheckHint = computed(() => {
    if (this.auth.isDemo()) return 'Read only in the demo.';
    if (this.rechecking()) return 'PageSpeed usually takes 10 to 30 seconds.';
    const at = this.recheckAvailableAt();
    if (at && this.recheckBlocked()) return `Available again in ${untilTime(at)}.`;
    return null;
  });

  readonly captureLabel = computed(() => {
    const kind = this.lead.value()?.businesses?.website_kind;
    if (kind === 'social') return this.snapshot() ? 'Capture again' : 'Capture their social page';
    return this.latestGoodPsi() ? 'Recheck PageSpeed' : 'Measure this site';
  });

  readonly captureBlurb = computed(() => {
    const kind = this.lead.value()?.businesses?.website_kind;
    if (kind === 'social') {
      return 'No capture yet. The engine only measures real sites during a scan, so a social page is captured when you ask for it.';
    }
    return this.latestAnyPsi()
      ? 'This site was measured, but no screenshot was kept from that run.'
      : 'No screenshot yet. Measuring this site captures one at no extra API cost.';
  });

  constructor() {
    // The store is what prev/next and the scoring weights come from. The page never blocks
    // on it — it paints from its own query and these arrive when they arrive.
    if (!this.store.loaded() && !this.store.loading()) this.store.load();

    // Keep the grid's global focus on whatever lead is open, so going back lands on the
    // right row and therefore the right page. Guarded on inequality, so it settles.
    effect(() => {
      const i = this.currentIndex();
      if (i >= 0 && this.store.focusedIndex() !== i) this.store.focusIndex(i);
    });

    // Notes are page-local: `LeadRow` has no `notes` field because `lead_rows` does not
    // select one, and this spec deliberately does not widen the view to add a text column
    // to all 450 grid rows. So the draft is seeded from the page's own read and nothing
    // else ever touches it. Reseeds when the route moves to another lead.
    effect(() => {
      const d = this.lead.value();
      this.notesDraft.set(d?.notes ?? '');
      this.notesSavedAt.set(null);
      this.notesError.set(null);
      this.statusError.set(null);
      this.statusSavedAt.set(null);
      this.recheckError.set(null);
      this.recheckNote.set(null);
    });
  }

  // ---- Template helpers -----------------------------------------------------------

  dateOf(iso: string): string {
    return DATE_FMT.format(new Date(iso));
  }

  timeOf(iso: string): string {
    return TIME_FMT.format(new Date(iso));
  }

  /** Prev/next are disabled at both ends with no wrap — the list has a start and an end,
   * and pretending otherwise loses your place. */
  stepButton(disabled: boolean): string {
    return `height:30px;padding:0 10px;border:1px solid var(--color-sw-rule-2);border-radius:var(--radius-sw-sm);`
      + `background:white;color:${disabled ? 'var(--color-sw-ink-lo)' : 'var(--color-sw-violet)'};`
      + `font-family:'Geist Sans',sans-serif;font-size:13px;`
      + `cursor:${disabled ? 'not-allowed' : 'pointer'};opacity:${disabled ? '0.5' : '1'};`;
  }

  psiColour(score: number | null): string {
    const w = this.store.weights();
    if (score == null) return 'var(--color-sw-ink)';
    if (score < w.poorThreshold) return 'var(--color-sw-fail)';
    if (score <= w.mediumThreshold) return 'var(--color-sw-warn)';
    return 'var(--color-sw-ok)';
  }

  /** All five metrics, not just the composite (BUILD-PLAN.md §8.5). */
  metrics(psi: PsiResultRow): { label: string; value: string }[] {
    const secs = (ms: number | null) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);
    return [
      { label: 'LCP', value: secs(psi.lcp_ms) },
      { label: 'CLS', value: psi.cls == null ? '—' : Number(psi.cls).toFixed(3) },
      { label: 'TBT', value: psi.tbt_ms == null ? '—' : `${psi.tbt_ms}ms` },
      { label: 'FCP', value: secs(psi.fcp_ms) },
      { label: 'Speed index', value: secs(psi.si_ms) },
    ];
  }

  // ---- Actions --------------------------------------------------------------------

  goPrev(): void {
    const row = this.prevRow();
    if (row) this.goTo(row.lead_id);
  }

  goNext(): void {
    const row = this.nextRow();
    if (row) this.goTo(row.lead_id);
  }

  /** `replaceUrl` so one back press returns to the grid rather than walking back through
   * every lead visited on the way here. */
  private goTo(leadId: string): void {
    this.router.navigate(['/leads', leadId], { replaceUrl: true });
  }

  async onStatusChange(event: Event): Promise<void> {
    const status = (event.target as HTMLSelectElement).value as LeadStatus;
    this.statusError.set(null);
    const result = await this.store.updateStatus(this.id(), status);
    if (!result.ok) {
      this.statusError.set(result.error ?? 'Could not update status.');
      return;
    }
    this.statusSavedAt.set(result.updatedAt ?? null);
    // The status trigger wrote a lead_events row; re-read so the timeline shows it.
    this.lead.reload();
  }

  /**
   * Notes save through an explicit button, and the confirming timestamp is the
   * `updated_at` the PATCH returns — never a client clock, because `leads_touch_updated_at`
   * is what actually sets it.
   */
  async saveNotes(): Promise<void> {
    if (!this.notesDirty() || this.auth.isDemo()) return;
    this.savingNotes.set(true);
    this.notesError.set(null);

    const value = this.notesDraft();
    const { data, error } = await db
      .from('leads')
      .update({ notes: value === '' ? null : value })
      .eq('id', this.id())
      .select('id, updated_at');

    this.savingNotes.set(false);

    if (error) {
      this.notesError.set(error.message);
      return;
    }
    if (!data || data.length === 0) {
      this.notesError.set('No row updated (read only in the demo, or the lead no longer exists).');
      return;
    }
    this.notesSavedAt.set((data[0] as { updated_at: string }).updated_at);
    this.lead.reload();
  }

  /**
   * Measures this one business, now. The request is held — no queue, no polling, no
   * realtime — and only this block shows a waiting state, so the rest of the page stays
   * usable. The client aborts at 60s, and on abort it re-reads rather than reporting a
   * failure, because the server's writes may well have landed.
   */
  async recheck(): Promise<void> {
    if (!this.canRecheck()) return;
    const businessId = this.lead.value()?.businesses?.id;
    if (!businessId) return;

    this.rechecking.set(true);
    this.recheckError.set(null);
    this.recheckNote.set(null);

    const { data: session } = await auth.getSession();
    const token = session.session?.access_token;
    if (!token) {
      this.rechecking.set(false);
      this.recheckError.set('Your session has expired — sign in again.');
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RECHECK_TIMEOUT_MS);

    try {
      const res = await fetch(`${environment.supabaseUrl}/functions/v1/recheck-psi`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: environment.supabasePublishableKey,
        },
        body: JSON.stringify({ business_id: businessId }),
        signal: controller.signal,
      });

      const body = await res.json().catch(() => ({} as Record<string, unknown>));

      if (!res.ok) {
        this.recheckError.set(this.refusalMessage(res.status, body));
        return;
      }

      // AC-28: patch the store so the grid behind this page already shows the new score.
      // Only on a successful measurement — a failure leaves the previous good numbers
      // standing, which is exactly what `lead_rows` reports.
      if (body['error'] == null) {
        this.store.applyPsiResult(businessId, {
          psi_score: (body['score'] as number | null) ?? null,
          lcp_ms: (body['lcp_ms'] as number | null) ?? null,
          cls: (body['cls'] as number | null) ?? null,
          psi_checked_at: (body['checked_at'] as string) ?? new Date().toISOString(),
        });
      } else {
        this.recheckNote.set(`The site could not be measured: ${body['error']}. It is recorded in the timeline.`);
      }

      if (body['snapshot_error']) {
        this.recheckNote.set(`Measured, but the screenshot could not be stored (${body['snapshot_error']}).`);
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        this.recheckNote.set('That took longer than a minute. The measurement may still have completed — reloading what we have.');
      } else {
        this.recheckError.set(String(e));
      }
    } finally {
      clearTimeout(timer);
      this.rechecking.set(false);
      // Always re-read: the function writes psi_results, lead_events and possibly a
      // snapshot, and the page shows all three.
      this.lead.reload();
    }
  }

  private refusalMessage(status: number, body: Record<string, unknown>): string {
    if (status === 429 && typeof body['available_at'] === 'string') {
      return `Measured too recently — available again in ${untilTime(body['available_at'])}.`;
    }
    if (status === 409) return 'A recheck of this business is already running.';
    if (status === 402) return 'The PageSpeed allowance is exhausted. Approve more calls first.';
    if (status === 403) return 'Read only in the demo.';
    return (body['error'] as string) ?? `The recheck failed (HTTP ${status}).`;
  }
}
