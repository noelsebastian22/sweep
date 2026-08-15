# 0005a. Lead detail page and the screenshot pipeline

Child of [0005](index.md). Acceptance criteria live in the umbrella's `## Requirements`;
this file covers **AC-1** to **AC-12**, **AC-27** and **AC-28**.

## Summary

A new page at `/leads/:id` showing one lead as a document rather than a row: who they are,
what their site looks like and how fast it is, why the score is what it is, and everything
that has happened to them. Behind it, two pieces of plumbing that have to exist first. The
engine starts keeping the screenshot that PageSpeed already hands it, and a new function
measures a single business when you press a button.

## Why this shape

`BUILD-PLAN.md` §8.5 asks for a 720px single measure document whose density is the opposite
of the grid, and says plainly that if it ends up looking like the grid with fewer rows, the
page has failed. That is the whole design constraint: same tokens, opposite density. One
column, wide margins, `body-lg` prose, and no 44px rows anywhere.

The awkward part is that the scoring model rates a business with no website highest, so the
page's two largest blocks are empty exactly when the lead is best. Rather than collapsing
them, the empty case is rewritten as the finding itself, which turns the thinnest page into
the most persuasive one.

## The document

Blocks in order, all inside a 720px measure:

1. **Header** — business name, trade and suburb, current status, and prev and next.
2. **Contact** — phone, address, and a Google Maps link built from
   `businesses.google_place_id`.
3. **Site** — the screenshot and the PageSpeed breakdown. Three cases, below.
4. **Score derivation** — the arithmetic, not the number alone.
5. **Timeline** — `lead_events`, `psi_results` and the synthesised discovery entry, newest
   first.
6. **Notes** — a text area and an explicit save button.
7. **Actions** — recheck PageSpeed, mark mockup built, open in Maps.

### The site block, three cases

| `website_kind` | What renders |
|---|---|
| `site` | The newest `site_snapshots` image, and the full breakdown: composite score plus `lcp_ms`, `cls`, `tbt_ms`, `fcp_ms`, `si_ms`. With no snapshot yet, an empty frame with a capture action |
| `social` | The screenshot of their social page once captured, otherwise an empty frame with a capture action worded for what it is, for example capture their Facebook page. The engine has never measured social businesses, so there is never a snapshot here until someone asks |
| `none` | The opportunity block instead of a frame. It states the finding: no website found, the Google listing is their only presence, and the review count and rating that make that worth a call. No empty slots |

Every number in this block is mono with `tabular-nums`, per `AGENTS.md`.

**The block is labelled with the `checked_at` of the row it is showing**, which is the newest
row with `error is null`. It is deliberately not the newest measurement of any kind, or a
page that had just failed a recheck would read "measured 2 minutes ago" above week old
numbers.

**Capturing a social page does not change its score, and must not leak into the grid.**
`penaltyBranch` in `score.ts` returns `socialOnly` on `website_kind === 'social'` before it
ever reads `psi_score`, so the PageSpeed branches are reachable only for `site` and the
score is untouched. The leak is elsewhere: `lead_rows` filtered its measurement join on
`error is null` alone, so a captured social lead would surface a `psi_score` to the grid's
PSI filter, its `psi_score` sort, and the analytics band. The weekend 5 migration closes
that in the view itself with `and b.website_kind = 'site'`, so the grid simply never sees
it. The detail page is unaffected, because it reads `psi_results` through its own embed
rather than through the view. The score derivation block states the situation explicitly,
so the page does not appear to contradict itself by showing a PageSpeed score that plays no
part in the arithmetic.

### The score derivation block

Renders `scoreBreakdown()` from `shared/scoring/score.ts`, which already returns the
`penaltyLabel` this block needs, in the shape `BUILD-PLAN.md` §8.5 gives:
`142.6 = 89 reviews × (4.8/5) × 1.0 (no website)`. Same function and same profile as the
grid, so the two numbers cannot disagree. Hard rule 6 stands: nothing is persisted, and hard
rule 5 stands: `score.ts` gains no imports to serve this page.

### The timeline

One reverse chronological list merging three sources in the browser into a common `at`
field, sorted descending with `id` breaking ties so a status and notes change written by one
PATCH has a stable order:

- `lead_events` rows: `status_changed` and `notes_updated` from the trigger,
  `rechecked_psi` from the recheck function. Vocabulary is exactly those three; anything
  else renders as a generic entry rather than being dropped.
- `psi_results` rows: every measurement, including those where `error` is set, which render
  as a failure with its reason. `lead_rows` filters those out for the grid; the detail page
  does not, because a site that fails to load is itself a sales signal.
- **The discovery entry**, synthesised from the embedded first seen scan's
  `coalesce(started_at, created_at)`. It comes from the page's own query rather than from
  `LeadsStore`, so it renders on a cold visit. No event row exists for it and none is
  backfilled, because `lead_events` has never held a row.

An event whose `payload.actor` is null was written by the engine or by hand in SQL, and
renders as such rather than attributing it to a person.

## Data and schema

Covered in the umbrella's `## Feature design`. In short: `site_snapshots` gains
`psi_result_id` and a unique index on `(psi_result_id, viewport)`, `leads` gains a
conditioned trigger writing `lead_events`, `lead_rows` gains `first_seen_scan_id` and
`first_seen_scan_started_at`, and a public `site-snapshots` bucket is created.

The page reads through PostgREST embedding rather than a new view, because `lead_rows` lacks
`notes`, `tbt_ms`, `fcp_ms` and `si_ms`, and widening it would add columns to all 450 grid
rows to serve one page:

```
db.from('leads').select(`
  id, status, notes, updated_at,
  businesses (
    *,
    first_seen_scan:scans!businesses_first_seen_scan_id_fkey ( started_at, created_at ),
    psi_results!psi_results_business_id_fkey ( * ),
    site_snapshots ( * )
  ),
  lead_events ( * )
`)
  .eq('id', leadId)
  .order('checked_at',  { referencedTable: 'businesses.psi_results',   ascending: false })
  .limit(50,            { referencedTable: 'businesses.psi_results' })
  .order('captured_at', { referencedTable: 'businesses.site_snapshots', ascending: false })
  .limit(1,             { referencedTable: 'businesses.site_snapshots' })
  .order('created_at',  { referencedTable: 'lead_events', ascending: false })
  .limit(100,           { referencedTable: 'lead_events' })
  .maybeSingle()
```

Three things in that query are load bearing:

- **The FK hints are required, not optional.** `businesses` has two foreign keys to `scans`,
  `first_seen_scan_id` from migration 04 and `last_scan_id` from migration 15, so a bare
  `scans(...)` embed is rejected as ambiguous. `psi_results` is hinted for a subtler reason:
  giving `site_snapshots` a `psi_result_id` turns it into a junction between `businesses`
  and `psi_results`, which already have a direct foreign key, and PostgREST's ambiguity
  detection considers many to many paths. The hint costs nothing and pre empts a "more than
  one relationship was found" error that would only appear once the new column exists.
- **`referencedTable` takes the dotted path for a nested embed**, and it is the alias when
  one is used, hence `businesses.psi_results` and `businesses.first_seen_scan`.
- **Every embed is bounded.** A business rechecked often would otherwise return every
  measurement it has ever had on every page load, and the site block only ever shows the
  newest snapshot.

Per `AGENTS.md`, this is read once data for one route, so it belongs in a `resource()`
rather than a SignalStore. `LeadsStore` is still injected, for the prev and next ordering
and for the write back below.

## Writing back to the store

The detail page is the only place status and notes are written, and a recheck changes data
the grid displays. Writes that change row data patch `LeadsStore` so the two never disagree:

- **Status** reuses the existing optimistic patch in `updateStatus`, widened to
  `.select('id, updated_at')` so it can return the confirming timestamp.
- **A recheck** calls a new `applyPsiResult(businessId, { psi_score, lcp_ms, cls,
  psi_checked_at })`, which patches the matching `rawLeads` entry. Score, heat band and every
  tile and chart downstream recompute automatically, because they are all `computed()` off
  `rawLeads`. **It patches `psi_score` only when the row's `website_kind` is `site`**,
  mirroring the view's new clause, so an optimistic patch cannot put back what the view
  deliberately excludes. The other fields are patched regardless.
- **Notes are page local and touch no store state.** `LeadRow` has no `notes` field, because
  `lead_rows` does not select one and this spec does not widen the view. There is nothing in
  `rawLeads` to patch, so the save is a PATCH the page makes and keeps to itself. This is a
  stated limit: the grid cannot search or filter on notes.

## The screenshot pipeline

**The shared modules** live under `supabase/functions/_shared/`: `psi-extract.ts` holding
metric extraction, the screenshot decode and the upload, plus `db.ts` and `spend.ts` moved
out of `tick/`, because `recheck-psi` needs a `Sql` client and the reservation helpers too.
`tick` and `recheck-psi` are separate deploy units, so both must be redeployed whenever
anything in `_shared/` changes.

**The upload is a `POST`, not a `PUT`, and upsert is a header.** In the Storage REST API
`POST /object/{bucket}/{path}` creates and `PUT` replaces something that already exists, so
a `PUT` would fail on every first capture. `?upsert=true` as a query parameter is ignored:

```
POST ${SUPABASE_URL}/storage/v1/object/site-snapshots/<path>
Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}
apikey: ${SUPABASE_SERVICE_ROLE_KEY}
Content-Type: image/jpeg
x-upsert: true
<raw bytes>
```

A raw `fetch` is used because `tick/deno.json` imports only `postgres` and the project
carries no storage client anywhere. Paths are unique per `psi_result_id`, so `x-upsert` is
belt and braces rather than the mechanism. The image is stored as the JPEG PageSpeed
returns, with no conversion; see the umbrella's Follow-up for the WebP trigger.

**In `tick/psi.ts`.** The insert gains a conflict clause and a returning clause:

```sql
insert into psi_results (...) values (...) on conflict do nothing returning id
```

**If the returning set is empty, skip the upload entirely.** A sibling redelivery won the
race, the row already exists, and its screenshot is already uploaded. This, not the unique
index, is what prevents a duplicate object: the index only constrains the `site_snapshots`
row. Both are kept, because the index also guards a hand written insert.

**Delete the existing `23505` catch at `psi.ts:129`.** `on conflict do nothing` handles the
same race, and leaving both makes the redelivery story read as two competing mechanisms.

**An upload failure is not fatal.** The measurement stands, the response reports
`snapshot_error`, and no `site_snapshots` row is written. The consequence, stated plainly in
the umbrella, is that the guard then blocks a retry for a day.

**No backfill.** Nothing walks the existing businesses.

## `recheck-psi` edge function

**Two connections, deliberately.** `reserve_api_calls` was revoked from `authenticated` in
migration 18, and `current_tenant()` returns null on a service role connection, so neither
one client can do both jobs.

- **Identity**: an anon key `createClient` carrying the caller's `Authorization` header,
  then `rpc('current_tenant')` and `rpc('current_tenant_is_demo')`. This is exactly what
  `scan-create/index.ts` already does.
- **Work**: a separate service role `postgres` connection over `SUPABASE_DB_URL`, used only
  after the business has been proven to belong to the derived tenant.

**Order of operations. The ordering is the spend correctness story, so it is fixed:**

1. Derive the tenant. Null means 401.
2. `current_tenant_is_demo()` true means 403. `reserve_api_calls` does not check this the
   way `approve_spend()` and `cancel_scan()` do, so it has to be explicit here.
3. `select id from leads where business_id = $1 and tenant_id = $2`. No row means 404, and
   this doubles as the ownership check and supplies the `lead_id` the event needs.
4. **Take a session level advisory lock**, `pg_try_advisory_lock(hashtext(business_id::text))`,
   on the dedicated service role connection. False means another recheck of this business is
   already running, so return 409. Release it in a `finally`.
5. The guard, as a plain statement: `max(checked_at)` over all `psi_results` for the
   business, with a window of 24 hours if that newest row succeeded and 1 hour if it failed.
   Inside the window means 429 with `available_at` computed server side.
6. `reserve(sql, tenant, 'psi', 'free', null, 1)`. Denied or no budget means 402 and nothing
   else is written. `reserve()` in `spend.ts` types `scanId` as `string`; it is widened to
   `string | null`.
7. Fetch PageSpeed, reusing the two attempt retry from `psi.ts` through the shared module.
8. Always `recordStatus(callId, httpStatus)`. Always insert the `psi_results` row, with
   `error` set when the call failed, and always insert the `rechecked_psi` event. A failure
   that wrote nothing could not satisfy AC-5.
9. Upload and write `site_snapshots` only when a screenshot came back.

**Why the lock is session level and not transaction scoped, and why there is no transaction
at all.** These are two separate requirements that pull in opposite directions, and getting
one right at the cost of the other is the trap here.

- **No transaction may span the fetch.** `reserve_api_calls` takes `for update` on the
  tenant's `api_budgets` row, and `search.ts` upserts `businesses` on every scan. A
  transaction holding either across a 10 to 35 second PageSpeed call would block every psi
  reservation in a running `tick` at concurrency 4 and queue behind the engine's own writes.
  There is no lock cycle so it would never deadlock, which is worse: it would present as
  unexplained slowness rather than an error, and it touches hard rule 2's park path.
- **But mutual exclusion must last the whole measurement.** A transaction scoped lock
  (`pg_try_advisory_xact_lock`) releases at commit. Since the `psi_results` row that the
  guard reads is not written until step 8, two presses a second apart would both take the
  lock, both find the guard clear, both reserve, both fetch and both insert. The partial
  index `psi_results_business_scan_uidx` is `where scan_id is not null` and a recheck writes
  a null `scan_id`, so nothing downstream would catch it either.

A session level advisory lock satisfies both. It is not a transaction and takes no row lock,
so it blocks nothing, and it survives until explicitly released or the connection closes,
which covers the entire measurement. The `postgres` client runs `max: 1`, so the lock also
dies with the connection if the function is killed mid flight.

Steps 1 to 5 consume no reservation, which is the point of the ordering. If the function
aborts between step 6 and step 7 it hands the reservation back with `refund(callId)`, per
hard rule 1. A call that reached Google is never refunded, matching `psi.ts`: PageSpeed is
billed at zero but still consumes the free allowance, and the ledger should record that it
happened.

A recheck's `psi_results` row carries a null `scan_id`, and `roll_psi_completed()` guards on
`new.scan_id is not null`, so it cannot move a running scan's `psi_completed` counter.

**The guard windows** are a product rule, not a budget one. Performance rarely moves within
a day, so repeat presses on a healthy site return the same numbers. A failure is different:
an unreachable site is exactly the case worth retrying sooner, so it waits an hour rather
than a day. The button states when it becomes available rather than silently doing nothing.

**The wait.** PageSpeed takes roughly 10 to 30 seconds. The request is held and the page
shows a live measuring state on the affected block only, so the rest of the page stays
usable. The client aborts at 60 seconds, and on abort it re reads the lead's newest
`psi_results` row rather than showing a failure, because the server writes may well have
landed. No queue, no polling, and no realtime dependency in this route.

## Prev and next

Walk `LeadsStore.sortedRows()` by the global `focusedIndex`, so they follow whatever order
and filters the grid currently has. Disabled at both ends with no wrap. Each move calls
`focusIndex`, so returning to the grid lands on the right row and therefore the right page.
The grid's URL sync must respect that, see the sibling spec.

On a cold visit straight to the URL there is no such set, so the page paints from its own
query immediately and the store loads in the background; the controls appear when it
arrives. The page is never blocked on the grid's data, and the discovery entry comes from
the page's own query for the same reason.

## States

| State | Behaviour |
|---|---|
| Loading | A plain loading line, matching the grid's existing treatment. No skeleton shimmer, which `AGENTS.md` bans |
| Not found | `data === null` with no error. A lead id that does not exist and one belonging to another tenant look identical, because row level security returns an empty result either way and the page must not reveal which |
| Error | A transport or server failure gets its own line with a retry, distinct from not found |
| Demo tenant | Notes, status and recheck are disabled in the UI, and `recheck-psi` refuses server side. The UI must disable rather than rely on the write silently failing, per the note on `updateStatus` in `leads.store.ts` |
| No measurement ever | The site block shows the capture action; the timeline shows the synthesised discovery entry and any status events |

## Build order

Slices 1 to 9 in the umbrella's `## Build plan`. The first three are schema, shared modules
and function, so that by slice 4 the page has real data to render rather than placeholders.
