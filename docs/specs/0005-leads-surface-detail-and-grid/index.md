# 0005. Leads surface: detail page and grid rework

**Date**: 2026-08-15
**Status**: Proposed

## Summary

This covers two linked pieces of the leads surface. First, a new lead detail page at
`/leads/:id`, built as a 720px single column document so it reads as the opposite of the
dense grid: the screenshot of the prospect's site, the full PageSpeed breakdown, the
arithmetic behind the score, and a timeline of everything that happened to the lead.
Second, a rework of the grid at `/leads` so the table stops being a scroll box inside a
scrolling page: fixed pages of 25 rows, a header that stays put, a compact filter bar
built on multiselect dropdowns, and a band of summary numbers and charts underneath.

The load bearing choice is that screenshots are captured when a measurement happens and
never in bulk. PageSpeed already returns the image, so storing it costs nothing extra, and
a button on the page measures a single lead when you want it fresh. There is no backfill
job, because re measuring 450 sites you may never open is both wasteful and less accurate
than measuring the one you are looking at.

Two weekends of work. The detail page is the first; the grid rework and its analytics band
are the second.

## Structure

- **[0005-lead-detail-page.md](0005-lead-detail-page.md)** — the new `/leads/:id` document,
  the screenshot pipeline that fills it, and the `recheck-psi` function behind its refresh
  action. Supports the decision to capture screenshots on measurement rather than in bulk.
- **[0005-leads-grid-rework.md](0005-leads-grid-rework.md)** — pagination, the sticky
  header, the rebuilt filter bar, the keyboard model, and URL state. Supports the decision
  to replace virtual scrolling with fixed pages.
- **[0005-grid-analytics-band.md](0005-grid-analytics-band.md)** — the stat tiles above the
  table and the charts and scan context below it. Supports the decision to keep every
  aggregate derived from signals the store already holds, with no extra network cost.

**Reasoning and options**: see [rationale.md](rationale.md).

### Cross child contract

Five things are shared and must not be decided twice.

1. **The drawer becomes a preview and stops writing.** Clicking a row still opens it, but
   it loses its status control and carries a single button through to `/leads/:id`. The
   detail page becomes the only place a lead's status and notes are written, so there is
   one write path rather than two that drift. The `?lead=` query param retires; `/leads/:id`
   is the deep link.
2. **Score is computed the same way in both places.** `shared/scoring/score.ts` with the
   tenant's default `scoring_profiles` row, at read time, in the browser. The number on the
   detail page and the number in the grid row are the same call with the same inputs. Hard
   rule 6 stands: no score column, ever.
3. **`LeadsStore` owns row data; the detail page writes back into it. Notes are the
   exception and are page local.** `LeadRow` has no `notes` field, because `lead_rows` does
   not select one and this spec deliberately does not widen the view. So a notes save is a
   PATCH the page makes and keeps to itself, while status changes and recheck results patch
   the store:
   - `updateStatus` is widened to `.select('id, updated_at')` so it can return the
     confirming timestamp, and keeps its existing optimistic patch of `rawLeads`.
   - `applyPsiResult(businessId, { psi_score, lcp_ms, cls, psi_checked_at })` is added for
     measurements.
   - Notes touch no store state at all. This is a deliberate limit, not an oversight.
4. **`focusedIndex` stays a global index into `sortedRows()`, and `page` is derived from
   it.** Prev and next on the detail page walk the same array and call `focusIndex`, so
   returning to the grid lands on the right row. The grid's URL sync must not overwrite a
   `focusedIndex` whose derived page already matches the URL, or that handoff is lost.
5. **`lead_rows.psi_score` means "the performance of their site", so it is null for anyone
   who does not have one.** `penaltyBranch` returns `socialOnly` before reading `psi_score`,
   so a social lead's score never moves. But `lead_rows` filtered its measurement join on
   `error is null` alone, so once the capture action measures a social lead that lead would
   gain a `psi_score` visible to the PSI range filter, the `psi_score` column sort, the Poor
   PSI tile and the PageSpeed spread chart. **The fix is one clause in the view**, not a
   `website_kind === 'site'` test at four call sites: the lateral join gains `and
   b.website_kind = 'site'`. Every downstream surface is then correct with no special
   casing, no score changes (the branch never read it), and the detail page is unaffected
   because it reads `psi_results` through its own embed. `applyPsiResult` carries the same
   clause so an optimistic patch cannot reintroduce what the view excludes.

## Requirements

**User stories**

- As Noel, I want to open one lead and see everything known about it in a form I can read,
  so I can decide whether to build a mockup and call them.
- As Noel, I want the evidence for a lead's score shown as arithmetic rather than a number,
  so I can trust the ranking and tune it later in the scoring lab.
- As Noel, I want the grid to fit a page like a finished product rather than a scroll box
  in a scroll box, and to keep room underneath for summary information.
- As someone reviewing this as a portfolio piece, I want the keyboard shortcuts to be
  visible rather than assumed knowledge.

**Acceptance criteria**

Lead detail page:

- **AC-1**: `/leads/:id` renders a single column document at a 720px measure with contact,
  site, score derivation, timeline and notes blocks. Its density is visibly unlike the
  grid: one column, wide margins, no 44px rows.
- **AC-2**: The PageSpeed block shows the composite score plus all five metrics (`lcp_ms`,
  `cls`, `tbt_ms`, `fcp_ms`, `si_ms`) from the newest `psi_results` row with `error is
  null`, every number mono with `tabular-nums`, and is labelled with **that row's**
  `checked_at`, not with the newest measurement of any kind.
- **AC-3**: The score derivation block shows the arithmetic that produced the score, from
  `scoreBreakdown()`, and the number it displays equals the number the grid shows for the
  same lead. For a `social` lead it shows the `socialOnly` branch and states that the
  PageSpeed score does not enter the calculation.
- **AC-4**: A lead with `website_kind = 'none'` renders the opportunity block in place of
  the screenshot frame. A lead with `website_kind = 'social'` or `'site'` renders the newest
  `site_snapshots` row's image when one exists, and an empty frame with a capture action
  when it does not.
- **AC-5**: The timeline merges `lead_events` and `psi_results` into one reverse
  chronological list ordered by a single `at` field with `id` breaking ties, and includes
  measurements where `error` is set, showing the reason. The discovery entry is synthesised
  from the embedded first seen scan's `coalesce(started_at, created_at)`, not from a stored
  event, and renders on a cold visit without the grid's data.
- **AC-6**: Notes save through an explicit button that is disabled until the text changes,
  and the confirming timestamp is the `updated_at` the PATCH returns, never a client clock.
  The demo tenant sees it disabled.
- **AC-7**: Recheck PSI is disabled for 24 hours after a successful measurement and for 1
  hour after a failed one, and says when it becomes available. When it runs it waits in
  place with a live state and updates the PageSpeed block, the screenshot and the timeline
  on return.
- **AC-8**: A recheck writes a `rechecked_psi` row to `lead_events` carrying the acting
  user, as well as the `psi_results` row, so a deliberate measurement is distinguishable
  from a scheduled one. A recheck whose PageSpeed call fails still writes both, with the
  reason.
- **AC-9**: Prev and next walk the grid's current sorted and filtered order and are
  disabled at both ends with no wrap. On a cold visit to the URL the page paints from its
  own query first, and the controls appear once the set has loaded.
- **AC-10**: A lead id that does not exist, or belongs to another tenant, renders a not
  found state. A genuine load failure renders a distinct error state with a retry.
- **AC-11**: `tick/psi.ts` stores the `final-screenshot` audit for every successful
  measurement as a `site_snapshots` row plus an object in the bucket, and continues to
  discard the rest of the payload, per hard rule 4.
- **AC-12**: A redelivered psi queue message creates neither a second `site_snapshots` row
  nor a second object, because the upload is skipped entirely when the `psi_results` insert
  returned no row.
- **AC-27**: Every metered call is reserved immediately before the PageSpeed fetch and
  after every refusal check, so a request refused for demo tenant, ownership, or the recheck
  guard consumes no reservation. No transaction is held open across the PageSpeed fetch, so
  a recheck never blocks a running scan's reservations. A run that reserves and then aborts
  before reaching Google hands the reservation back with `refund_api_call`. The invariant
  `api_budgets.used = sum(api_calls.units where refunded_at is null)` holds after any
  sequence of rechecks.
- **AC-29**: Two rechecks of the same business overlapping in time produce one measurement,
  not two. The second is refused with 409 for the whole duration of the first, including the
  10 to 35 seconds it is waiting on PageSpeed, so it takes no reservation and writes no rows.
- **AC-28**: A successful recheck patches `LeadsStore`, so the grid behind the page shows
  the new PageSpeed score and score without a reload.

Grid rework:

- **AC-13**: The grid renders exactly one page of rows, 25 by default, with no internal
  scroll region. `cdk-virtual-scroll-viewport` and the `ScrollingModule` import are gone.
- **AC-14**: The column header remains visible while any part of the table body is in view.
- **AC-15**: A footer bar carries the keyboard legend at one end and the row range, page
  count and page controls at the other, in the form `1 to 25 of 450` and `page 3 of 18`,
  mono with `tabular-nums`. With zero rows it reads `0 of 0` with both controls disabled.
- **AC-16**: Arrow keys move row focus, `j` and `k` do the same, and Enter opens the
  preview drawer. Moving past the last row of a page loads the next page and focuses its
  first row; moving before the first row returns to the previous page's last row.
- **AC-17**: Page, sort and every filter live in the URL and survive a reload. Footer page
  changes, sort changes and filter commits push a history entry so the back button steps
  through them; search keystrokes and keyboard page rollover replace instead of pushing.
  Query param changes are picked up while the route stays mounted, not only on entry.
- **AC-18**: Changing any filter or any sort returns to page 1 and resets focus, through
  one shared reset path that no future filter method can bypass.
- **AC-19**: Heat bands are computed over the whole filtered set, never the visible page,
  so a lead's band does not change when you turn a page.
- **AC-20**: The filter bar is one compact row of multiselect dropdowns built on Angular
  Aria `Listbox` with `multi` and `selectionMode="explicit"`, fully keyboard operable, with
  the currently active filters visible without opening anything.
- **AC-21**: The drawer is read only. It shows the lead and carries a button to
  `/leads/:id`, and it no longer writes status.
- **AC-22**: The command palette's jump to lead sets the global focus index, which moves to
  the page containing that lead and focuses its row.

Analytics band:

- **AC-23**: A tile row above the table shows total in view, no website, poor PSI and
  contacted, each computed from the filtered set and updating as filters change. Poor PSI
  needs no `website_kind` test, because the view no longer reports a `psi_score` for anyone
  without a site.
- **AC-24**: Four charts below the table cover score distribution, website state split,
  PageSpeed spread and leads over time, all over the filtered set, drawn as inline SVG with
  no charting dependency.
- **AC-25**: A scan context block lists the scans that produced the leads currently in
  view, each with its start date and lead count, each linking to `/scans/:id`.
- **AC-26**: The band issues no network requests. Every value derives from signals
  `LeadsStore` already holds, including the scan date carried on `lead_rows`.

## Decision

**Chosen option**: Option 2: capture on measurement, with an on demand single lead refresh.

Screenshots are extracted from the PageSpeed payload at measurement time and written to a
public Supabase Storage bucket, with no bulk backfill; a new `recheck-psi` edge function
measures one business when asked. The grid replaces virtual scrolling with fixed pages of
25 rows inside a page that scrolls normally, leaving room beneath the table for aggregates.

**Implementation skills**: `impeccable` (`.claude/skills/impeccable/`) for the interface
work on both screens. The `dataviz` skill informs the four charts in
[0005-grid-analytics-band.md](0005-grid-analytics-band.md); it is available in the Claude
Code environment but is not installed in this repo's skills directory, and neither skill is
referenced in `AGENTS.md` yet. See Follow-up.

## Feature design

**Data model sketch**

All schema work lands in one migration. **Run `list_migrations` before naming the file**,
per `AGENTS.md`: the remote assigns the version timestamp and three sessions have had to
rename local files to match. It is referred to below as the weekend 5 migration rather than
by a number.

| Table | Change |
|---|---|
| `site_snapshots` | New column `psi_result_id bigint references psi_results on delete cascade`. New unique index on `(psi_result_id, viewport)`. Existing columns unchanged. The table has never held a row |
| `lead_rows` (view) | Gains `b.first_seen_scan_id` and `coalesce(s.started_at, s.created_at) as first_seen_scan_started_at`, from a left join to `scans`. Its measurement lateral join gains `and b.website_kind = 'site'`, so `psi_score` is null for anyone without a site. `create or replace view`, keeping `security_invoker = true` |
| `leads` | New trigger `leads_log_event`, `after update for each row when (old.status is distinct from new.status or old.notes is distinct from new.notes)`, calling `log_lead_event()`, `security definer` with a pinned `search_path` |
| `storage.buckets` | New public bucket `site-snapshots`, inserted idempotently |

**There is no scan label column and this spec does not add one.** `scans` is
`(id, tenant_id, region_id, status, config, total_queries, completed_queries,
failed_queries, businesses_found, psi_total, psi_completed, quota_hit,
estimated_cost_usd, started_at, finished_at, created_at)`. Scan context identifies a scan
by its start date and its link, which is all AC-25 asks for. `started_at` is nullable,
populated when a scan leaves `queued`, hence the `coalesce` to `created_at`.

The trigger's `when` clause matters: `leads_touch_updated_at` already fires on every update,
so an unconditioned trigger would log an event for writes that changed nothing.

`log_lead_event()` writes one row per changed field: `status_changed` carrying
`{from, to, actor}` and `notes_updated` carrying `{length, actor}`, where `actor` is
`auth.uid()` and is null for engine or hand written writes. `lead_events` gets no new
column; tenant is already reachable through `lead_id` to `leads.tenant_id`, which is what
`lead_events_read` scopes on.

Bucket creation, idempotent so the migration can be re run:

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-snapshots', 'site-snapshots', true, 5242880, array['image/jpeg'])
on conflict (id) do nothing;
```

No `storage.objects` policies are added. Public reads bypass row level security, and the
engine writes with the service role, which bypasses it too. If `apply_migration` turns out
to lack privileges on the `storage` schema, create the bucket once by hand and keep this
statement as the record.

`storage_path` takes the shape `<tenant_id>/<business_id>/<psi_result_id>.jpg`.

Relationships: `leads` to `businesses` is 1 to 1 through `unique (tenant_id, business_id)`;
`businesses` to `psi_results` is 1 to many; `psi_results` to `site_snapshots` is 1 to 0 or
1 per viewport; `leads` to `lead_events` is 1 to many, append only. **`businesses` has two
foreign keys to `scans`**, `first_seen_scan_id` and `last_scan_id` (migration 15), so any
PostgREST embed of `scans` must name the constraint or it is rejected as ambiguous.

No new view for the detail page. It reads through PostgREST embedding from `leads`, so the
grid's payload shape is untouched.

**State transitions**

`lead_status` is unchanged. The only new transition behaviour is that a status change now
leaves a `lead_events` row, written by the trigger rather than by any caller.

**API surface**

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `recheck-psi` (edge function) | POST | `business_id: uuid` (req) | `psi_result_id`, `score`, the five metrics, `snapshot_path` or null, `snapshot_error` or null, `grant_kind` | Caller's JWT on an anon key client for identity; service role connection for the work | 401 no tenant, 403 demo tenant, 404 no lead for this business in this tenant, 409 another recheck in flight, 429 inside the guard window with `available_at`, 402 reservation denied, 502 PageSpeed unreachable (rows still written) |
| Storage upload | POST | `/storage/v1/object/site-snapshots/<path>`, raw JPEG bytes | object path | service role key in `Authorization` and `apikey`, `x-upsert: true` | 400 malformed, 413 over the 5 MB bucket limit |
| `leads` read (PostgREST) | GET | `id`, embedded `businesses` (with the first seen scan by FK hint), bounded `psi_results`, `site_snapshots`, `lead_events` | the detail document | user JWT, RLS scoped | empty result renders not found; a transport failure renders the error state |
| `leads` write (PostgREST) | PATCH | `status` or `notes`, `.select('id, updated_at')` | updated row with `updated_at` | user JWT, RLS scoped | 0 rows means demo tenant or gone |

**Value sourcing**

| Action | Value produced or displayed | Source |
|---|---|---|
| Render detail | Score and its derivation | `scoreBreakdown()` in `shared/scoring/score.ts` with weights from `scoring_profiles where is_default`, at read time |
| Render detail | Screenshot image URL | `` `${environment.supabaseUrl}/storage/v1/object/public/site-snapshots/${storage_path}` ``, built by a leads feature helper. `core/supabase.service.ts` exports only `auth` and `db` and is not widened |
| Render detail | PageSpeed block label, "measured 3 hours ago" | `checked_at` of the row the block is showing, the newest with `error is null` |
| Render detail | Recheck availability | `max(checked_at)` over all `psi_results` for the business, plus 24 hours if that row succeeded or 1 hour if it failed |
| Render detail | Notes saved confirmation timestamp | `leads.updated_at` returned by the PATCH, set by the existing `leads_touch_updated_at` trigger |
| Render detail | Poor PSI threshold in the opportunity block | `weights().poorThreshold` from the same scoring profile the grid uses |
| Render detail | Prev and next targets | `LeadsStore.sortedRows()` indexed by the global `focusedIndex` |
| Render detail | Google Maps link | `businesses.google_place_id` |
| Render detail | Discovery entry in the timeline | The embedded first seen scan's `coalesce(started_at, created_at)`, via the FK hinted embed, so it works on a cold visit |
| Render detail | Timeline sort key | A single `at` field: `lead_events.created_at` or `psi_results.checked_at`, with `id` breaking ties |
| Recheck | Caller's tenant and demo flag | `rpc('current_tenant')` and `rpc('current_tenant_is_demo')` on an anon key client carrying the caller's `Authorization` header, following `scan-create` |
| Recheck | The lead the event attaches to | `select id from leads where business_id = $1 and tenant_id = $2`, which doubles as the ownership check |
| Recheck | Whether the call may proceed | `reserve_api_calls(tenant, 'psi', 'free', 1, null)` through `spend.ts`'s `reserve()`, on the service role connection, per hard rule 1 |
| Recheck | `available_at` in the 429 body | The guard timestamp plus its window, computed server side so a client with a wrong clock corrects itself |
| Recheck | Concurrency guard | A **session level** `pg_try_advisory_lock(hashtext(business_id::text))` on the dedicated service role connection, held across the whole measurement and released in a `finally`. Not the transaction scoped variant, and not `hashtext` on a bare uuid, which has no such overload |
| Grid | Heat band per row | `LeadsStore.heatBandAssignments()`, computed over `heatBasis()` |
| Grid | Page number | Derived as `floor(focusedIndex / pageSize)`, or set directly by the footer controls |
| Grid | Page count and row range | `sortedRows().length` and the page size |
| Analytics band | Scan date for scan context and the leads over time buckets | `lead_rows.first_seen_scan_started_at`, added by the weekend 5 migration so the band needs no query |
| Analytics band | Score histogram bins and band markers | 20 bins over `[0, max(score)]` of `filteredRows()`; markers are the maximum score within each band, derived over the same set the histogram uses |

**Key invariants**

- At most one `site_snapshots` row per `(psi_result_id, viewport)`, and no object is
  uploaded when the `psi_results` insert returned no row. The index guards the row; the
  skip guards the object.
- No raw PageSpeed payload is ever persisted. Only the six metric values and the screenshot
  bytes survive a response, per hard rule 4.
- Score is never stored, per hard rule 6.
- `lead_events` is append only. Migration 20 removed update and delete, and nothing here
  restores them.
- A reservation is taken only immediately before the PageSpeed fetch, and is handed back
  only with `refund_api_call`, never by decrementing `used`, per hard rule 1.
  `api_budgets.used = sum(api_calls.units where refunded_at is null)` holds throughout.
- **No database transaction is open while a PageSpeed request is in flight.** The engine's
  reservations take `for update` on the same `api_budgets` row, so a held transaction would
  stall every running scan for the length of the fetch. Mutual exclusion comes from a
  session level advisory lock instead, which is not a transaction and takes no row lock, so
  it can be held for the whole measurement without blocking anything.
- A recheck writes `psi_results` with a null `scan_id`, and `roll_psi_completed()` guards on
  `new.scan_id is not null`, so a recheck can never move a running scan's `psi_completed`
  counter.
- The detail page's score and the grid's score for the same lead are equal, because both
  are the same function called with the same profile and the store is patched on every
  write that changes row data.

**Security model**

The bucket is public read, and only the image bytes are public. They are captures of
websites already reachable by anyone, so there is nothing in them to protect, and a private
bucket would need a storage client the browser deliberately no longer carries. The
`site_snapshots` rows stay tenant scoped by the `site_snapshots_read` policy from migration
10, and migration 20 already removed the browser's write access.

`recheck-psi` splits its connections deliberately. Identity comes from an anon key client
carrying the caller's `Authorization` header, because `reserve_api_calls` was revoked from
`authenticated` in migration 18 and `current_tenant()` returns null on a service role
connection. The privileged work then runs on a separate service role connection, after the
business has been proven to belong to the derived tenant. The demo tenant is refused by an
explicit `current_tenant_is_demo()` check, because `reserve_api_calls` does not check it
the way `approve_spend()` and `cancel_scan()` do.

No new personal data enters the system; business contact details are public listing data
already held in `businesses`.

**Configuration required**

None new. `recheck-psi` reuses the existing `GOOGLE_PSI_API_KEY`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` edge function
secrets, the last being what a service role Postgres connection reads and which the platform
injects. The bucket is created by migration rather than by configuration.

**Critical test scenarios**

- Happy path: open a lead with a measured site, see its screenshot, the five metrics and
  the score arithmetic, verifies **AC-1**, **AC-2**, **AC-3**.
- Happy path: press Recheck on a lead measured over 24 hours ago, watch the block update in
  place, then go back to the grid and find the new score already there on the row you left,
  verifies **AC-7**, **AC-8**, **AC-28**, **AC-17**.
- Spend: a recheck refused for the guard, for the demo tenant, and for a foreign business
  each leave `api_budgets.used` unchanged; a granted one moves it by exactly one and leaves
  a matching `api_calls` row, verifies **AC-27**.
- Concurrency: a recheck running while a scan is measuring does not delay that scan's
  reservations, verifies **AC-27**.
- Concurrency: two rechecks of the same business fired two seconds apart produce one
  measurement, one reservation and one uploaded object, with the second returning 409,
  verifies **AC-29**.
- Failure case: PageSpeed returns unreachable during a recheck; a `psi_results` row with
  `error` set and a `rechecked_psi` event are both written, the failure appears in the
  timeline with its reason, and the button returns after 1 hour rather than 24, verifies
  **AC-5**, **AC-7**, **AC-8**.
- Failure case: a redelivered psi queue message for a measurement that already exists
  creates no second row and uploads no second object, verifies **AC-12**.
- Failure case: focus moves past the last row of page 3 and lands on the first row of page
  4 without losing the filter set or changing any heat band, verifies **AC-16**, **AC-19**.
- Auth: the demo tenant sees notes, status and recheck disabled, and `recheck-psi` refuses
  it server side before reserving anything, verifies **AC-6**, **AC-27**.
- Auth: requesting another tenant's lead id renders not found, verifies **AC-10**.

## Build plan

No build approach is recorded in `AGENTS.md` or the scope header, so this assumes thin end
to end slices: each slice reaches from schema through engine to screen and is demonstrable
on its own, rather than building all the backend first.

**Weekend 5, the detail page**

1. Run `list_migrations`, then write the weekend 5 migration: `site_snapshots.psi_result_id`
   and its unique index, the two new `lead_rows` columns, the conditioned `leads_log_event`
   trigger and `log_lead_event()`, and the `site-snapshots` bucket. Run `get_advisors` for
   security and performance after, per `AGENTS.md`. Satisfies **AC-5**, **AC-8**, **AC-11**,
   **AC-12**, **AC-25**.
2. Create `supabase/functions/_shared/` holding `psi-extract.ts` (metric extraction, the
   screenshot decode, the Storage upload) plus `db.ts` and `spend.ts` moved out of `tick/`,
   since `recheck-psi` needs the reservation helpers and a `Sql` client too. **Seven files
   in `tick/` import from those two modules and all need their import paths updated**:
   `index.ts`, `psi.ts`, `search.ts`, `advance.ts`, `state.ts`, `events.ts` and `queue.ts`.
   A missed one fails at bundle time rather than at run time, so the deployed `tick` is not
   at risk. Move `psi.ts` onto the shared extractor, add `on conflict do nothing returning
   id` to its `psi_results` insert, **delete the now dead 23505 catch at `psi.ts:129`**, and
   skip the upload when the returning set is empty. Widen `reserve()` to accept a null
   `scanId`. Redeploy `tick`. Satisfies **AC-11**, **AC-12**.
3. `recheck-psi` edge function, with its own `deno.json` importing both `npm:postgres@3`
   for `_shared/db.ts` and `jsr:@supabase/supabase-js@2` for the identity client. Order is
   refusals, then the session advisory lock, then reservation, then fetch. Satisfies
   **AC-7**, **AC-8**, **AC-27**, **AC-29**.
4. The route and the document shell at `/leads/:id`: one embedded read with the FK hinted
   scan, contact block, status, not found and error states. Satisfies **AC-1**, **AC-10**.
5. The site block: screenshot, the five metric breakdown, the opportunity block for
   siteless leads, the capture action for social and unmeasured sites. Satisfies **AC-2**,
   **AC-4**.
6. The score derivation block off `scoreBreakdown()`, including the social case. Satisfies
   **AC-3**.
7. Timeline merging `lead_events`, `psi_results` and the synthesised discovery entry, and
   the notes block with its explicit save and page local state. Satisfies **AC-5**,
   **AC-6**.
8. Wire the recheck action to the function with its wait in place state, a 60 second client
   abort, and `LeadsStore.applyPsiResult` on success. Satisfies **AC-7**, **AC-8**,
   **AC-28**.
9. Prev and next, disabled at both ends, including the cold visit path where the store loads
   behind the page. Satisfies **AC-9**.

**Weekend 6, the grid**

10. Add `page` to `LeadsStore` derived from the global `focusedIndex`, route
    `setFilters`, `clearFilters`, `toggleHeatBand` and `setSort` through one shared
    `resetPosition()`, and sync page, sort and filters to the URL through a live
    `queryParamMap` subscription with a loop guard. Satisfies **AC-17**, **AC-18**,
    **AC-22**.
11. Replace the viewport with a paged block, make the header sticky, build the footer bar
    with the legend and page controls. Satisfies **AC-13**, **AC-14**, **AC-15**.
12. Keyboard: arrows as primary with `j` and `k` retained, and page rollover falling out of
    `moveFocus` for free. Satisfies **AC-16**.
13. Rebuild the filter bar on Angular Aria `Listbox` and `Combobox`. Satisfies **AC-20**.
14. Reduce the drawer to a read only preview with its button through to the page. Satisfies
    **AC-21**.
15. Confirm the heat basis is still the filtered set and not the page. Satisfies **AC-19**.
16. The tile row above the table. Satisfies **AC-23**.
17. The four charts as inline SVG. Satisfies **AC-24**.
18. Scan context. Satisfies **AC-25**, **AC-26**.

## Consequences

**Positive**

- The grid stops nesting a scroll region inside a scrolling page, which is the specific
  thing that read as unfinished, and gains room underneath for the aggregates without a
  later redesign.
- Keyboard navigation becomes discoverable rather than assumed, which matters for a screen
  whose stated job in `BUILD-PLAN.md` §8.3 is to prove keyboard craft.
- The timeline becomes honest for the first time. Nothing has ever written `lead_events`,
  so status history has been silently lost since migration 05.
- Screenshots arrive at zero additional API cost, because the bytes are already in a
  response the engine pays for.
- One write path for status instead of two, and one place that patches the store, so the
  grid and the detail page cannot disagree.

**Negative and tradeoffs**

- Leads discovered before this weekend show an empty frame until visited. Most of the
  current 450 fall in that group, and the page will look sparser than it eventually will
  for a while.
- **Notes are page local.** They are not in `lead_rows`, so they are not in `rawLeads`, so
  the grid cannot filter or search on them and the drawer cannot show them. Widening the
  view to fix that would add a text column to all 450 grid rows, which is why it is not
  done here.
- A Storage upload failure after a successful measurement leaves the lead with a
  measurement and no screenshot, and the guard then blocks a retry for a day. The
  measurement is still correct and the response reports the upload error, so this is
  visible rather than silent, but it is a real gap. A guard that ignores measurements with
  no snapshot is recorded as a follow up rather than built.
- The detail page depends on grid state for prev and next, so it is not fully independent
  of `LeadsStore`. A cold visit shows those controls appearing a moment late.
- A fixed page of 25 rows runs past the fold on a laptop. This is deliberate, but it does
  not match a literal reading of "fits the visible portion of the screen".
- Removing virtual scrolling gives up a measured, verified behaviour from spec 0004 (19
  rows rendered of 64) in exchange for a simpler component. If the page size ever grows far
  beyond 25, that decision needs revisiting rather than quietly reintroducing a scroll
  container.
- `recheck-psi` opens two connections, one for identity and one for the work. That is more
  moving parts than a single client, and it is forced by `reserve_api_calls` being revoked
  from `authenticated`.
- The analytics band is the least specified part of this and the most likely to push
  weekend 6's map and scoring lab back. `BUILD-PLAN.md` §10 already says to cut the map
  before the lab if something slips.

**Neutral**

- Supersedes part of `BUILD-PLAN.md` §8.3 and §10 weekend 3, and spec 0004's AC-1, on
  virtual scrolling. Amends §3's wording that screenshots are converted to WebP before
  storing.
- The weekend 5 migration is the first to touch `storage.buckets`.
- `db.ts` and `spend.ts` move from `tick/` to `_shared/`, so `tick` and `recheck-psi` must
  be redeployed together whenever anything in `_shared/` changes. `tick` is redeployed in
  slice 2 rather than at the end.

## Follow-up

- [ ] Convert screenshots to WebP if Storage passes 300 MB. At roughly 50 KB per capture
      that is around 6,000 measurements away, so it is deliberately deferred rather than
      dropped. The conversion belongs in `_shared/psi-extract.ts`, so only one call site
      changes.
- [ ] Let the guard ignore a measurement that has no snapshot row, so a Storage failure does
      not block a retry for a day. Not built now because it adds a clause to the one rule
      that gates spending, and the failure it covers has not been seen.
- [ ] Consider a bounded backfill that enqueues only the leads currently in view, if the
      empty frames prove annoying in practice.
- [ ] `AGENTS.md` lists `lead_events.insert` as a live browser write path. After this spec
      the client never inserts one; the trigger does. The policy stays because dropping it
      is a separate migration, but the wording should be corrected.
- [ ] `impeccable` is installed at `.claude/skills/impeccable/` and shapes every screen in
      this spec, but `AGENTS.md` has no `## Agent skills` section, so nothing points at it.
      It is project wide, so it belongs in root `AGENTS.md`.
- [ ] `dataviz` informs the four charts but is not installed in this repo's skills
      directory. Worth installing before weekend 6.
- [ ] Weekend 4 still has no spec file. Not this spec's job, but the gap is now two
      weekends old and `0005` assumes `scan_events` and `/scans/:id` behaviour recorded only
      in migration headers and the session log.
- [ ] Decide whether `advance.ts` should measure social businesses at scan time. It would
      not change any score, because `penaltyBranch` returns `socialOnly` before reading
      `psi_score`, so this is purely a question of whether to spend measurement effort at
      scan time on businesses nobody may open.

## Rationale

Reasoning, the options weighed, and the evidence behind them: see
[rationale.md](rationale.md).
