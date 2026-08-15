# 0005. Rationale

The reasoning behind [index.md](index.md) and its three child specs. `/develop` does not
need this file.

## Context

> ⚠️ Premise note: this topic spans three independently buildable decisions, which is why
> it is an umbrella rather than one spec. It also arrived with a requirement that changed
> under questioning: the original ask was for the table to fit the visible portion of the
> screen, but the follow up requirement was that the page must still scroll to reach charts
> and other information below. Those two are not compatible in the literal sense, and the
> second one is the real constraint. Once the page is allowed to scroll, measuring a page
> size to fill the viewport stops being worth its cost, so the expensive part of the
> original request was removed rather than built. Separately: the analytics band is the
> least specified piece here and the one most likely to make weekend 6's map and scoring lab
> slip. §10 of `BUILD-PLAN.md` already names the map as the thing to cut first, and that
> guidance should be honoured rather than quietly allowing everything to slide.

The engine has been producing leads since 11 August and the grid has been able to display
them since 13 August, but there is nowhere to go once a lead looks interesting. The grid
shows nine columns and a drawer that shows a few more. Everything that would actually
inform a sales decision is either unreachable or was never stored: the four PageSpeed
metrics beyond the composite score sit in `psi_results` and are shown nowhere, the
screenshot arrives in every PageSpeed response and is thrown away, `leads.notes` has
existed since migration 05 and has never been written, and `lead_events` has policies, an
index and no writer, so every status change since the grid shipped has been lost.

The scoring model makes this worse in a specific way. A business with no website scores
highest, so the leads most worth opening are exactly the ones with no site to screenshot
and no PageSpeed score to break down. A page designed around those two blocks is emptiest
when the lead is best.

The grid has a second, unrelated problem. It renders a `cdk-virtual-scroll-viewport` at a
hardcoded 600px inside a `<main>` that is itself scrollable, so there are two scroll
regions on one screen, the wheel behaves differently depending on where the pointer is, and
the column header scrolls away from the rows it labels. Above it, the filter bar renders
every trade, suburb, website kind, status and heat band as a chip in one wrapping block:
roughly forty controls and about two hundred pixels before the first row appears.

The forces that shaped what follows: PageSpeed is free with a very large allowance, so
measurement volume is not a cost constraint; Google Places is expensive and gated, so
nothing here may touch it; the browser bundle deliberately excludes the Supabase storage
and umbrella clients, so any solution needing a storage client in the browser fights a
decision made on 13 August; `reserve_api_calls` is revoked from `authenticated`, so
anything that spends has to run with the service role while still knowing who the caller
is; and the engine only measures businesses whose `website_kind` is `site`, so social pages
have never been measured at all.

## Options considered

### Option 1: bulk backfill every already measured business

A one time pass over the existing businesses, re measuring each so every lead has a
screenshot on day one.

**Pros**

- The page looks complete immediately, with no empty frames anywhere.
- PageSpeed is free, so the pass costs no money and only about two percent of the monthly
  allowance.

**Cons**

- `psi.ts` releases any queue message whose `scan_id` does not match the scan `tick`
  picked, so bulk work cannot be enqueued without inventing a `scans` row that has no
  search stage and no `scan_queries`, which `advance.ts` was never written for.
- It re measures 450 sites most of which will never be opened, and its accuracy starts
  decaying the moment it finishes, so a lead opened in October carries an August capture.

### Option 2: capture on measurement, with an on demand single lead refresh

Screenshots are stored whenever a measurement happens, and a `recheck-psi` function
measures one business when asked from its detail page.

**Pros**

- No wasted calls. Every measurement corresponds to something that was either scanned or
  deliberately opened.
- The freshest possible data at the moment you look, rather than the moment a job ran.
- Reuses the existing spend gate and needs no queue semantics, so there is no fake scan row
  and no new failure mode in `tick`.
- The recheck button earns a place on the page rather than being decoration, and it is also
  the mechanism that captures a social page.

**Cons**

- Every lead discovered before this weekend shows an empty frame until visited, which is
  most of the current 450.
- Adds an edge function to deploy and keep in step with `psi.ts`, which is why the
  extraction logic moves to a shared module rather than being copied.
- That function needs two connections, one for identity and one for the privileged work,
  because `reserve_api_calls` is revoked from `authenticated`.

### Option 3: measure social businesses in the engine so they get screenshots too

Change `advance.ts` to enqueue `website_kind = 'social'` businesses alongside `site` ones.

**Pros**

- Social leads get real imagery automatically, with no button to press.
- One code change in a place that already exists, rather than a new function.
- Contrary to what was assumed during the design conversation, it would **not** change any
  score. See the correction below.

**Cons**

- It spends measurement effort at scan time on every social business, whether or not anyone
  ever opens them, which is the same waste Option 1 was rejected for.
- It grows the psi queue on every scan, lengthening the measuring stage for results that
  may never be looked at.

### Option 4: keep virtual scrolling and only fix the height

Replace the hardcoded 600px with a measured height and change nothing else.

**Pros**

- The smallest possible change, and it preserves the measured virtualisation behaviour that
  spec 0004 verified.
- No pagination state to carry in the URL and no keyboard model to rework.

**Cons**

- It fixes the nested scrollbar and delivers no pagination, so it answers half the request.
- It leaves the table as an unbounded region, which is precisely what makes adding content
  underneath awkward later.

## Correction: what the social measurement argument got wrong

During the design conversation, Option 3 was argued against on the grounds that measuring
social businesses would give every social lead a `psi_score`, which `computeScore` would
consume, shifting every score and heat band in the grid. **That is wrong.**

`penaltyBranch` in `score.ts` reads:

```ts
if (websiteKind === 'none' || websiteKind == null) return 'noWebsite';
if (websiteKind === 'social') return 'socialOnly';
// 'site' → the PSI threshold branch
```

The `social` branch returns before `psi_score` is read at all. The PageSpeed branches are
reachable only when the kind is `site`. So a social business can carry any number of
measurements without its score moving by a fraction, and the same is true of the capture
action on the detail page.

Two things follow. Option 3 is still rejected, but on cost of unnecessary measurement rather
than on scoring side effects, and the Cons above have been rewritten accordingly. And the
social capture action in AC-4 is safe, which is why it survives rather than being cut. The
wrong argument is recorded here rather than deleted, because a future reader would otherwise
find the same intuition and reach the same wrong conclusion.

## Rationale

**Option 2 over Option 1** because the mechanics rule Option 1 out before the merits do.
`drainPsi` takes the active scan as an argument and releases anything that does not match
it, so a backfill without a scan row would read and release the same messages forever. The
only way to make it work is to create a scan that has no search stage, which pushes an
untested shape through `advance.ts` for no benefit. Even setting that aside, the stated
constraint was to avoid using resources unnecessarily and to give accurate information, and
a bulk pass fails both at once: it measures sites nobody opens, and what it measures is
stale by the time anybody reads it. Measuring on open is fewer calls and fresher data
together, which is unusual enough to be worth taking.

**Option 2 over Option 3** on waste, not on scoring. Both would produce social screenshots
and neither would move a score. The difference is when the work happens: Option 3 measures
every social business on every scan, Option 2 measures the one you are looking at. That is
the same argument that rejected Option 1, applied at a smaller scale.

**Option 2's storage shape** follows from the bundle decision of 13 August.
`@supabase/supabase-js` was replaced with a composed client precisely to keep storage,
realtime and iceberg code out of `main`, so any design needing a storage client in the
browser to sign a URL works against that. A public bucket needs no client at all: the
browser renders an `<img src>`. The content is a capture of a website already reachable by
anyone, so the privacy cost of public bytes is zero, and the `site_snapshots` rows stay
tenant scoped through the policy migration 10 already wrote. On the writing side there is
no storage client either, in `tick` or anywhere else, so the upload is a raw `fetch` against
the Storage REST endpoint with the service role key.

**Option 2 over the WebP conversion `BUILD-PLAN.md` §3 specifies**, at least for now. The
saving is roughly 20 KB per capture, so about 9 MB across the current business set against
a 1 GB tier. The cost is a WASM codec pinned inside `tick`, plus its module cold start, in
the one function that gates spending. That is a poor trade at this volume, so the raw
PageSpeed JPEG is stored and the conversion is recorded as a follow up with a concrete
trigger rather than dropped. This is a deliberate amendment to §3's wording.

**The recheck function orders its refusals before its reservation** because the alternative
quietly breaks hard rule 1's invariant. A request rejected for the 24 hour guard, for the
demo tenant, or for a business in another tenant must consume nothing, so the reservation
sits immediately before the PageSpeed fetch with nothing between them. Migration 18 made
the reservation write its own `api_calls` row in the same transaction precisely so the
counter and the ledger cannot diverge; reserving early and refusing late would put that
right back.

**The recheck holds no transaction across the PageSpeed fetch, and its lock is session
level.** These two requirements pull against each other and the first two attempts each got
one at the cost of the other, so the reasoning is worth keeping.

The obvious way to stop two simultaneous presses writing two measurements is a `for update`
lock on the business row held for the duration. That is a self inflicted outage:
`reserve_api_calls` takes `for update` on the tenant's `api_budgets` row, and `search.ts`
upserts `businesses` on every scan, so a transaction spanning a 10 to 35 second fetch would
block every psi reservation in a running `tick` at concurrency 4 and queue behind the
engine's own writes. One person pressing a button would stall the engine, and with no lock
cycle it would never deadlock, which is worse, because it presents as unexplained slowness
rather than an error.

The obvious correction, a transaction scoped advisory lock in a short transaction that
commits before the fetch, fixes the stall and quietly reopens the race. The lock releases at
commit, and the `psi_results` row the guard reads is not written until 30 seconds later, so
two presses a second apart both take the lock, both find the guard clear, both reserve and
both insert. The partial index does not catch it either.

A session level `pg_try_advisory_lock` satisfies both constraints at once. It is not a
transaction and takes no row lock, so it blocks nothing, and it lasts until released or
until the connection closes, which covers the whole measurement. Everything after the guard
runs as autocommit statements exactly as `psi.ts` does.

**The `psi_results` insert has to return its id, and the upload has to be skipped when it
does not.** This is what actually makes redelivery safe. The unique index on
`(psi_result_id, viewport)` only constrains the `site_snapshots` row, so without the skip a
redelivered message would re upload the same object and only then fail to insert. The
constraint is still worth having, because it also guards a hand written insert, but it is
not the mechanism.

**The grid abandons virtual scrolling (against Option 4)** because the requirement changed
during the conversation. Once the page is allowed to scroll so that charts can sit beneath
the table, a page of 25 rows has nothing to virtualise: there is no scroll container, no
overflowing list, and no reason to keep a viewport component whose only job is to render a
window into one. Option 4 was the conservative choice and it was rejected because it
delivers half the request while keeping all of the machinery. This does mean giving up a
verified behaviour from spec 0004, which is a real loss and is recorded as such in
Consequences.

**`focusedIndex` stays global and `page` is derived from it** because the store already
treats that index as the single source of truth in four places. Adding a page relative index
alongside it would create two values that must agree forever, and rollover, the palette
jump, and the row click handler would each be a place they could stop agreeing. Deriving the
page instead makes rollover fall out of the existing clamp with no edge case code.

**Arrow keys become primary over `j` and `k`** because the grid's job in `BUILD-PLAN.md`
§8.3 is to prove keyboard craft, and a binding nobody can discover proves nothing. The
engineer raised this directly and was right. Both bindings are kept, since removing working
behaviour verified under 0004's AC-6 would be a regression for no gain, and the footer
legend is what actually solves the problem: always visible, no modal to open, and it shares
a row with the pagination controls that had to exist anyway.

**A trigger writes `lead_events` rather than the client** because the client is exactly what
has been failing to write them. `leads.store.ts:285` updates status and returns without
logging anything, and any future write path would have to remember. A trigger cannot forget,
and it also captures writes made by the engine or by hand in SQL, which a client side insert
never would. It carries a `when` clause because `leads_touch_updated_at` already fires on
every update, so an unconditioned trigger would log events for writes that changed nothing.
The timeline reads `psi_results` directly rather than duplicating measurements into events,
because that table already carries `checked_at`, the score and the failure reason, and
storing the same fact twice invites the two copies to disagree.

## Evidence gathered

Findings from reading the code during the design conversation and the cross check. Several
contradict what the documentation says, and several corrected an earlier draft of this spec.

- **`score.ts:59-67`**, `penaltyBranch` returns `socialOnly` on `website_kind === 'social'`
  before reading `psi_score`. Measuring a social business cannot change its score. This
  reversed the stated reason for rejecting Option 3, see the correction above.
- **`advance.ts:25`** filters candidates to `website_kind === 'site'` and additionally to
  those whose ceiling clears a cutoff, so social businesses have never been measured.
- **`psi.ts:76`** releases any queue message whose `payload.scan_id` does not equal the scan
  `tick` selected, and `drainPsi(sql, scan, deadline)` takes that scan as an argument. Bulk
  work cannot be enqueued onto `sweep_psi` without a matching scan row.
- **`psi.ts:127`** inserts into `psi_results` with no `returning`, so there is currently no
  way to obtain the `psi_result_id` that both `site_snapshots.psi_result_id` and the storage
  path need.
- **`psi.ts:5`** states in a comment that screenshot extraction is out of scope, so
  `final-screenshot` is currently discarded even though hard rule 4 explicitly permits
  keeping it.
- **Migration 18 line 106** revokes `execute` on
  `reserve_api_calls(uuid, text, text, int, uuid)` from `authenticated`. Anything that
  spends must hold a service role connection, while `current_tenant()` returns null on one,
  which is what forces `recheck-psi` to open two.
- **`spend.ts`** exposes `reserve(sql, tenant, api, sku, scanId, n)` with `scanId` typed
  `string`, plus `refund(sql, callId)` and `recordStatus(sql, callId, httpStatus)`. A
  recheck has no scan, so `scanId` needs widening to `string | null`.
- **`scan-create/index.ts:19-54`** is the precedent for deriving a caller's tenant in an
  edge function: an anon key `createClient` carrying the request's `Authorization` header,
  then `rpc('current_tenant')`.
- **`psi_results_business_scan_uidx`** (migration 15) is partial, `where scan_id is not
  null`, so it does not constrain recheck rows at all. Nothing in the schema prevents two
  rechecks writing two measurements, which is why the concurrency guard has to be explicit.
- **`roll_psi_completed()`** (migration 15) guards on `if new.scan_id is not null`, so a
  recheck's null `scan_id` row cannot move a running scan's `psi_completed` counter.
- **`tick/deno.json`** imports only `postgres`. There is no storage client anywhere in the
  project, so uploads are a raw `fetch` against the Storage REST endpoint.
- **`lead_events`** is `(id, lead_id, type, payload, created_at)`. It has no tenant or actor
  column, so the acting user goes in `payload`; tenant is already reachable through
  `lead_id`, which is what `lead_events_read` scopes on. It has a read policy, an insert
  policy, an index, and no writer anywhere in the codebase.
- **`leads_touch_updated_at`** (migration 05 line 52) already fires on every update to
  `leads`, which is why the new event trigger needs a `when` clause.
- **`site_snapshots`** has existed since migration 04 with a `storage_path` column and has
  never held a row. Its read policy from migration 10 scopes through `businesses` to the
  tenant; migration 20 removed its write policies.
- **`lead_rows`** carries neither `notes` nor `first_seen_scan_id` nor the three metrics
  `tbt_ms`, `fcp_ms` and `si_ms`, so the detail page cannot be served from the view the grid
  uses, and the analytics band's scan context cannot be satisfied without adding columns.
- **`core/supabase.service.ts`** exports only `auth` and `db`. The project URL is not
  exported, so the public image base is built from `environment.supabaseUrl` in a leads
  feature helper rather than by widening that file.
- **`leads-grid.ts:109`** hardcodes `height:600px` on the viewport, inside an
  `app-layout.ts` `<main>` that is `flex:1` within a `min-height:100dvh` column, which is
  the nested scroll region. `hairline-table.ts` sets `overflow:hidden` on its container,
  which would prevent the header ever sticking.
- **`leads.store.ts`** resets `focusedIndex` in `setFilters`, `clearFilters` and
  `toggleHeatBand` but not in `setSort`, an existing inconsistency that pagination would
  otherwise make visible.
- **`scans` (migration 03) has no name or label column**, and `started_at` is nullable,
  populated when a scan leaves `queued`. Scan context therefore identifies a scan by
  `coalesce(started_at, created_at)` and its link, and no column is added to `scans`.
- **`businesses` has two foreign keys to `scans`**: `first_seen_scan_id` (migration 04) and
  `last_scan_id` (migration 15). A PostgREST embed of `scans` must name the constraint or it
  is rejected as ambiguous.
- **`reserve_api_calls` takes `for update` on the `api_budgets` row** (migration 18), which
  is what makes holding a transaction across a PageSpeed fetch an engine wide stall rather
  than a local slowdown.
- **`LeadRow` in `leads.store.ts` has no `notes` field**, because `lead_rows` does not select
  one. Notes therefore cannot be patched into `rawLeads` and are page local on the detail
  page.
- **`updateStatus` selects only `id`**, so it cannot currently return the `updated_at` that
  AC-6's confirmation timestamp needs. It is widened to `.select('id, updated_at')`.
- **Supabase Storage REST uses `POST` to create and `PUT` to replace**, and upsert is the
  `x-upsert` request header, not a query parameter. A `PUT` with `?upsert=true` would fail
  on every first capture and the query parameter would be ignored.
- **`postgrest-js` 2.112.2 builds `referencedTable` keys as `` `${referencedTable}.order` ``
  and `` `${referencedTable}.limit` ``**, so a nested embed is addressed by its dotted path,
  and by its alias when one is used.
- **`@angular/aria` 22.1.1** ships `Listbox` with a `multi` input, `value` as a
  `ModelSignal<V[]>` and `selectionMode` accepting `explicit`, plus `Combobox` and
  `ComboboxPopup`. This is the multiselect dropdown behaviour the filter bar needs, already
  installed. There is no paginator in `@angular/aria` or `@angular/cdk`; `MatPaginator`
  belongs to Angular Material, which is not a dependency and would bring a theming layer
  that fights the §7 tokens.
