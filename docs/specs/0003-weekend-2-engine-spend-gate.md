# 0003. Weekend 2: engine and spend gate

**Date**: 2026-08-11
**Status**: Proposed

## Summary

This weekend ports the standalone `harvest.mjs` script into the app itself. Three pieces of logic (searching Google Places, checking site speed with PageSpeed, and deciding when a scan is done) move into one Supabase edge function that a scheduled job wakes up every minute. Every call to a paid API is checked against a budget first, so the app can never spend money by accident. There is still no screen for any of this; a scan is started with a raw HTTP request and its progress is checked directly in the database. The screen comes in later weekends.

## Context

`harvest.mjs` at the repo root already does the real work: search Google Places for sixteen trades across eighteen Blue Mountains suburbs, filter out landmarks and cafés, check the site speed of anything with a website, score the result, and write the best fifty to Notion. It runs once, by hand, from a terminal.

Weekend 1 built the plumbing this port needs: the full schema (`scans`, `scan_queries`, `businesses`, `psi_results`, `leads`), the `reserve_api_calls()` spend gate function tested against `free`/`paid`/`denied`/`no_budget`, the `pgmq` queues `sweep_search` and `sweep_psi`, and a `pg_cron` job named `tick` that currently runs a no-op `select 1` every minute.

The forces that shape this weekend are cost and time, not features. Google Places Text Search is billed at Enterprise tier, $35 per 1,000 calls, with 1,000 free calls a month; a full scan is 288 calls. `AGENTS.md`'s hard rule is absolute: no code path calls a metered API without a grant returning `free` or `paid` first, and a `denied` result parks the work rather than failing it. Supabase's free plan edge functions also cap wall clock time at 150 seconds, not the 400 seconds the paid plan allows, and the invocation budget is 500,000 calls a month, cheap to burn through with a naive per-function cron. Both bound the shape of the engine as much as the business logic does.

There is no UI this weekend. The acceptance test is a scan run from a terminal, verified by reading rows out of Postgres, not by clicking anything.

## Requirements

**User stories**:
- As Noel, I want to start a scan with an HTTP request so the engine can be proven before any screen exists.
- As the system, I want every metered call gated by a budget check so a scan can never spend money without an explicit grant.
- As the system, I want a scan that runs out of free budget to pause cleanly and resume automatically, rather than fail and lose its place.

**Acceptance criteria**:
- **AC-1**: A `scan-create` edge function, called with an authenticated user's own token, accepts `trade_ids`, `suburb_ids`, and an optional `top_n` (default 50). It derives `region_id` from the given `suburb_ids` (they must all belong to one region; more than one region is a 422), inserts a `scans` row scoped to the caller's own tenant with `status = 'queued'`, and expands the trade by suburb combinations into `scan_queries` rows. It does **not** enqueue anything onto `sweep_search` yet — see AC-2.
- **AC-2**: A single `tick` edge function, invoked every minute by the existing `pg_cron` job over `pg_net`, looks for one active scan (the oldest whose status is `queued`, `searching`, `measuring`, or `awaiting_approval`) across all tenants. With none active, it returns immediately without touching either queue. The first time `tick` picks up a scan still in `queued`, it batches that scan's `scan_queries` onto `sweep_search` and moves it to `searching` before draining — this is the only place messages ever get enqueued, which is what keeps exactly one scan's messages in flight at a time.
- **AC-3**: While a scan is `searching`, `tick` drains `sweep_search` at concurrency 5 within a 120 second budget, only processing messages belonging to the active scan (any message for a different scan is released back to the queue immediately, unprocessed, via a zero visibility timeout, not left to expire naturally). For each message it reserves one `places_text_search`/`enterprise` call before calling Google; if that typed call 400s, it refunds the reservation and makes a fresh one before the untyped retry (both attempts stay reservation-then-call). It upserts the result into `businesses` and marks the `scan_queries` row `done` or `failed`.
- **AC-4**: When every `scan_queries` row for a scan is resolved, `tick` computes the same ceiling cutoff `harvest.mjs` uses over the businesses this scan discovered (via `last_scan_id`, not `first_seen_scan_id` — see Feature design), selects the businesses that could plausibly reach the top `N` and have a real, non social only website, and batches them onto `sweep_psi`. The scan moves to `measuring`.
- **AC-5**: `tick` then drains `sweep_psi` at concurrency 4 within the same time budget, filtering to the active scan the same way AC-3 does, reserving one `psi`/`free` call per check (tracked even though it costs nothing), and inserts a `psi_results` row per business.
- **AC-6**: When every queued PSI check for a scan is done, `tick` creates or updates a `leads` row for **every business the scan discovered**, not only the ones that got a PSI check — a business with no website or a social only page is frequently the best lead (`harvest.mjs`'s own scoring gives it the least penalty) and must not be silently dropped. `top_n` bounds only the PSI ceiling cutoff (AC-4), never which businesses become leads. The scan's final status is then set: `completed` if every query and check succeeded, `partial` if some failed or the budget ran out mid-scan but leads were still produced, `failed` only if the scan produced zero businesses at all.
- **AC-7**: A `denied` reservation at any point parks the scan (`status = 'awaiting_approval'`) and leaves the current queue message unarchived. Because AC-2's active scan query includes `awaiting_approval`, the next `tick` picks the parked scan back up, attempts one fresh reservation for the head of whichever queue it stalled on, and on `free`/`paid` flips the status back to `searching` or `measuring` and resumes draining from exactly where it stopped; on `denied` again it stays parked for the following tick.
- **AC-8**: No code path calls Places or PageSpeed Insights without `reserve_api_calls()` returning `free` or `paid` immediately before it, with no exceptions for testing, partial runs, or a retry (the untyped fallback in AC-3 is not an exception, it is its own reservation).
- **AC-9**: A real scan, started by `scan-create` and driven only by the cron-triggered `tick`, completes end to end with no UI: a small six-query scan first, then one full 288-query scan, both verified by querying `scans`, `businesses`, `psi_results`, and `leads` directly.
- **AC-10**: Idempotency holds under redelivery and concurrency: `search.ts` skips a `scan_queries` row already `done`; `psi.ts` skips a business that already has a `psi_results` row for that scan, checked both before calling PSI (the cheap pre-check) and by catching a unique violation on the insert itself (the actual guarantee, since two redelivered messages can both pass the pre-check) — either path archives the message without a second reservation or a second error.
- **AC-11**: `capture-snapshot` (screenshot extraction) and the Notion sync are out of scope this weekend; nothing in this build depends on either.
- **AC-12**: Two `tick` invocations never run concurrently. An advisory lock taken at the start of `tick/index.ts` means a slow invocation still running when the next minute's cron fires causes the new invocation to exit immediately rather than double-processing the same active scan.
- **AC-13**: Rediscovering a business on a later scan always refreshes its mutable fields (`rating`, `rating_count`, `website_url`, `website_kind`, `phone`, `primary_type`, `types`, `business_status`, `last_seen_at`, `last_scan_id`) and always preserves the original `first_seen_scan_id`.

## Options considered

### Option 1: One `tick` function, three internal modules

`supabase/functions/tick/` is the only function the cron job invokes. `index.ts` is a thin entry point; `search.ts`, `psi.ts`, and `advance.ts` are plain TypeScript modules it imports and calls in sequence, each doing one stage of the work inside the same request and the same 120 second budget.

**Pros**:
- Matches `BUILD-PLAN.md` §6's own invocation math exactly: one edge function invocation per cron minute, 43,200 a month, about 9% of the free allowance.
- One shared time budget per tick; a scan that's mostly done with search can spend the leftover seconds on PSI in the same wake-up rather than waiting for a whole separate function's next turn.
- One deployment, one log stream to read while debugging a live run.

**Cons**:
- All logic runs in one process; a bug in `psi.ts` can only be tested by invoking the whole `tick` function, not `psi.ts` in isolation over HTTP.

### Option 2: Four separately deployed functions

`scan-create`, `worker-search`, `worker-psi`, and `scan-advance` each deployed independently. `tick` becomes a thin dispatcher making internal `fetch()` calls to the other three.

**Pros**:
- Each function is independently invokable and testable over HTTP without standing up the whole pipeline.
- Matches the descriptive table in `BUILD-PLAN.md` §6 literally, function name for function name.

**Cons**:
- Each `fetch()` call from `tick` to another function counts as its own edge function invocation, working against the invocation budget the naive-cron section of the same document explicitly warns about.
- Each function gets its own 120 second budget rather than one shared one; a tick that finishes search early can't spend the remainder on PSI, it has to wait for the next minute.
- Four deployments and four log streams to reason about instead of one.

## Decision

**Chosen option**: Option 1: One `tick` function, three internal modules.

`scan-create` stays a separately deployed, HTTP-triggered function (the app will call it directly from Weekend 3 onward). `tick` is the only cron-triggered function, deployed at `supabase/functions/tick/`, importing `search.ts`, `psi.ts`, and `advance.ts` as internal modules rather than as separately deployed functions.

## Rationale

`BUILD-PLAN.md` §6 states the invocation math in absolute terms ("One function, 43,200 invocations a month") right after describing the four logical stages, which only reconciles if the four collapse into a single deployed function at runtime. Reading the table literally as four deployed functions contradicts the document's own arithmetic two paragraphs later. A shared time budget is also the better fit for the actual workload: PSI checks run roughly 10 seconds each, so a tick with light search results and idle PSI time this minute should be able to spend it, not sit on it until the next wake-up. The cost, in return, is that `search.ts` and `psi.ts` can only be exercised by invoking the whole `tick` function during development — an acceptable tradeoff for a solo weekly tool where nobody else needs to invoke a worker stage independently.

## Feature design

**Data model sketch**:

No new tables. This weekend reuses `scans`, `scan_queries`, `businesses`, `psi_results`, and `leads` exactly as migrated in weekends 0 to 1. Three small additions to the existing schema:

- A nullable `businesses.last_scan_id uuid references scans on delete set null`, overwritten on every upsert (unlike `first_seen_scan_id`, which is set once and preserved). `advance.ts`'s cutoff computation (AC-4) and the final lead sweep (AC-6) both need "which businesses did *this* scan touch," and `first_seen_scan_id` only answers that for a business's very first scan ever — every later scan that rediscovers it would otherwise silently lose it from that scan's own cutoff and lead logic, a gap that a fresh-tenant test run (AC-9) would never surface but the project's actual weekly-reuse pattern would hit immediately.
- A trigger on `psi_results` insert that increments `scans.psi_completed`, mirroring the existing `businesses_roll_found` trigger from migration 08 (which currently only rolls up `scan_queries` and `businesses`, not `psi_results` — this gap would otherwise leave the live scan screen with no way to know when PSI is done). `scans.psi_total` is set directly by `advance.ts` when it decides the cutoff and enqueues the PSI batch; it does not need a trigger, it's a one time write.
- A partial unique index on `psi_results (business_id, scan_id) where scan_id is not null`. Without it, a redelivered `sweep_psi` message inserts a second history row for the same business in the same scan, double counting `psi_completed` and double spending a `psi` reservation on work already done. Cross-scan history (the point of not overwriting the table) is unaffected since the index only constrains rows sharing a `scan_id`. Per AC-10, a unique violation on this index is the second line of defence behind the pre-check and must be caught and treated as "already done," not as an error — otherwise a message that loses the pre-check race redelivers forever against the same violation.

**State transitions**:

`scans.status`: `queued` (created by `scan-create`, nothing enqueued yet) → `searching` (the first `tick` to pick this scan as active enqueues `sweep_search` and moves it here) → `measuring` (all `scan_queries` resolved, PSI batch enqueued) → `completed` | `partial` | `failed` (all PSI checks resolved). Any state before the final one can detour through `awaiting_approval` when a reservation is denied; because `awaiting_approval` is itself one of the statuses `tick`'s active-scan query selects (AC-2), the next tick picks the same scan back up and attempts to resume rather than needing a separate un-park mechanism.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/scan-create` | POST | `trade_ids: uuid[]` (req), `suburb_ids: uuid[]` (req), `top_n: int` (opt, default 50) | `scan_id` | bearer (caller's own JWT) | 403 if the demo tenant (blocked by RLS, not application code); 422 if either id array is empty, or if `suburb_ids` span more than one region |
| `/tick` | POST | none (cron invoked, no body) | `{ processed: boolean, scan_id: string \| null }` | bearer (service role, via the cron job's `pg_net` call) | none meaningful to a caller; internal failures are logged and leave queue messages unarchived for retry |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| `scan-create` | `tenant_id` on the new `scans` row | The caller's JWT, via `current_tenant()` in the RLS policy — never a request body field, so it cannot be spoofed |
| `scan-create` | `region_id` on the new `scans` row | `distinct region_id from suburbs where id = any(suburb_ids)`; more than one distinct value is a 422 |
| `scan-create` | `total_queries` on the new `scans` row | `count(trade_ids) × count(suburb_ids)`, computed server side from the two id arrays |
| `search.ts` | the reservation call's `p_tenant` | `scans.tenant_id`, looked up once per message via the message's `scan_id` (see message envelope below) |
| `search.ts` | `businesses.website_kind` on upsert | `'none'` if no `websiteUri`; `'social'` if `isFacebookOnly(websiteUri)` (ported verbatim from `harvest.mjs`); else `'site'` |
| `search.ts` | `businesses.last_scan_id` on upsert | The message's own `scan_id` — always overwritten, unlike `first_seen_scan_id` which is only ever set on first insert |
| `advance.ts` | the PSI cutoff (`ceiling`) | `ceiling(p) = userRatingCount × (rating / 5)`, ported verbatim from `harvest.mjs`, computed over businesses where `last_scan_id = this scan` (not `first_seen_scan_id`, which only holds for a business's first ever scan) |
| `advance.ts` | which businesses get a `leads` row (AC-6) | Every business where `last_scan_id = this scan` — not filtered by `top_n` or by whether it received a PSI check |
| `advance.ts` | final `scans.status` | The confirmed status logic: `completed` when `completed_queries + failed_queries = total_queries` and `failed_queries = 0` and `psi_completed = psi_total`; `partial` when finished but `failed_queries > 0` or a denial occurred; `failed` when `businesses_found = 0` |

**Queue message envelopes** (both queues carry `tenant_id` directly, denormalised from the scan row, so no worker needs an extra join per message just to call `reserve_api_calls()`):

- `sweep_search`: `{ scan_id, query_id, tenant_id, trade_id, trade_name, google_type, suburb_id, suburb_name, lat, lng }`
- `sweep_psi`: `{ scan_id, business_id, tenant_id, website_url }`

**Key invariants**:
- No code path calls Places or PSI without an immediately preceding `reserve_api_calls()` returning `free` or `paid` (AGENTS.md hard rule 1, restated as AC-8) — including the untyped retry inside `textSearch()`, which refunds its first reservation with `refund_api_calls()` (migration 07, built for exactly this path per BUILD-PLAN §4) before making its own fresh one.
- A `denied` reservation always parks the scan and always leaves the triggering message unarchived; it never fails the message outright.
- Only messages belonging to `tick`'s currently selected active scan are ever processed; a message for any other scan is released with a zero visibility timeout, immediately eligible for a future tick, never held or dropped. Combined with `scan-create` never enqueueing (AC-1/AC-2), this is what keeps exactly one scan's work in flight system wide.
- No `scans` row can ever exist for a tenant with `is_demo = true`: every `scans_insert` policy already requires `not current_tenant_is_demo()` (migration 12, applies to all fifteen tenant scoped tables uniformly, not just `leads`). Because `scan-create` is the only path that creates a `scans` row and it runs under the caller's own JWT, the engine never needs its own demo tenant check anywhere.
- `search.ts` and `psi.ts` are both idempotent against redelivery: a `scan_queries` row already `done` is skipped by `search.ts`; a `psi_results` row already present for that `business_id` + `scan_id` is skipped by `psi.ts`, checked both before calling PSI and by catching the unique index violation on the insert itself, since two redelivered messages can both pass the first check.
- Two `tick` invocations never overlap: an advisory lock held for the duration of the request means a second invocation, triggered by the next cron minute while the first is still running, exits immediately rather than double-selecting or double-draining the same active scan.
- `harvest.mjs`'s logic carries over unmodified in behaviour, only its I/O changes: `BLOCKED_TYPES`, `isTradeBusiness()`, `TYPE_TO_TRADE` / `trueTrade()`, `norm()`, `isFacebookOnly()`, the `ceiling()` cutoff, the 400-with-type → untyped retry in `textSearch()`, and the two attempt PSI retry with the 4xx early exit.

**Security model**:
- `scan-create`: `verify_jwt = true`. The caller must be an authenticated user; `tenant_id` on the new scan is never a request input, only what RLS derives from the token. The demo tenant is rejected at the database layer, not by application logic.
- `tick`: `verify_jwt = true`. Only a request bearing a valid Supabase JWT is accepted; the cron job's own `pg_net.http_post` call supplies the service role key as that JWT, so nothing else is expected to invoke it. Its internal database client is the service role client (it must write across whichever tenant owns the active scan), but every write it issues is scoped explicitly by that scan's own `tenant_id` — never a blanket cross-tenant write.

**Configuration required**:
- `GOOGLE_PLACES_API_KEY`: already set as a Supabase secret.
- `GOOGLE_PSI_API_KEY`: already set as a Supabase secret.
- A one time `select vault.create_secret(<the actual service role key>, 'service_role_key')`, run directly against the database (not via a migration file, and not committed anywhere) before the cron job can authenticate its call to `tick`. The migration that replaces the current `select 1` placeholder reads the key back with `(select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')` — the raw value itself never appears in git history, satisfying AGENTS.md hard rule 3.
- The same migration's `net.http_post` call must set `timeout_milliseconds := 130000` explicitly. `pg_net`'s default timeout is 5 seconds, far short of `tick`'s own 120 second internal budget; left at the default, the cron caller would consider the request timed out long before `tick` finishes its work.

**Critical test scenarios**:
- Happy path: `scan-create` with 2 trades and 3 suburbs (6 queries), left for `tick` to drain unattended, produces `businesses` (including no-website/social-only ones), `psi_results`, and `leads` rows for every discovered business and a `completed` status, verifies **AC-1** through **AC-6**, **AC-9**.
- Second scan, same tenant: run a second small scan that overlaps some of the first scan's trades/suburbs; confirm rediscovered businesses still get `last_scan_id` updated, still get correctly cutoff-filtered and lead-created for the *second* scan specifically, verifies **AC-4**, **AC-6**, **AC-13** and the steady-state gap the cross check identified in AC-9's original single-scan-only test.
- Denial and resume: temporarily lower a test tenant's `api_budgets.free_allowance` below what a scan needs, confirm the scan parks at `awaiting_approval` with its triggering message unarchived, then confirm the next `tick` picks it back up (not silently skipped) and resumes correctly once the allowance is raised again, verifies **AC-2**, **AC-7**.
- Concurrent scans: create a second scan while the first is still `searching`; confirm the second scan's messages are never drained until the first finishes, verifies **AC-2**, **AC-3**.
- Redelivery: manually requeue a `sweep_search` or `sweep_psi` message for work already recorded, confirm no duplicate `psi_results` row (the unique index fires and is caught, not thrown), and no second reservation spent, verifies **AC-10**.
- Auth/permission: `scan-create` called with the demo tenant's token is rejected by RLS before any queue message is ever sent, verifies part of **AC-1**'s tenant scoping and the demo tenant invariant.

## Build plan

1. Migration: add `businesses.last_scan_id` (nullable, `references scans on delete set null`), the `psi_results` insert trigger rolling up `scans.psi_completed`, and the partial unique index on `psi_results (business_id, scan_id)`, satisfies **AC-4**, **AC-6**, **AC-10**, **AC-13**.
2. Migration: replace the `tick` cron job's `select 1` placeholder with a real `net.http_post` call to the `tick` function, `timeout_milliseconds := 130000`, reading the service role key from `vault.decrypted_secrets`; document the one time `vault.create_secret` step as a manual action, not a migration, satisfies **AC-2**.
3. Build `supabase/functions/scan-create/index.ts`: authenticated, validates `trade_ids`/`suburb_ids`/`top_n`, derives and validates `region_id` from `suburb_ids`, inserts the `scans` row as `queued`, expands `scan_queries` — does **not** enqueue `sweep_search` (that moves to step 8), satisfies **AC-1**.
4. Build `supabase/functions/tick/search.ts`: ports `textSearch()`, `isTradeBusiness()`, `BLOCKED_TYPES`, `TYPE_TO_TRADE`, `norm()`, `isFacebookOnly()` from `harvest.mjs` verbatim; drains `sweep_search` filtered to the active scan, releasing any other scan's messages unprocessed; the reservation gate covers both the typed call and the untyped retry (refund before retry); upserts `businesses` with the full conflict column list (`last_scan_id` always overwritten, `first_seen_scan_id` preserved, `website_kind` computed); park-on-denied; skips a `scan_queries` row already `done`, satisfies **AC-3**, **AC-7**, **AC-8**, **AC-10**, **AC-13**.
5. Build `supabase/functions/tick/advance.ts`, search to measuring transition: computes the `ceiling()` cutoff over businesses where `last_scan_id = this scan`, selects qualifying businesses with a real (non social only) website, batches `sweep_psi`, sets `psi_total` and `status = 'measuring'`, satisfies **AC-4**.
6. Build `supabase/functions/tick/psi.ts`: ports `psi()` from `harvest.mjs` verbatim (the two attempt retry, the 4xx early exit); drains `sweep_psi` filtered to the active scan; the redelivery skip checks both a pre-check and catches the unique index violation on insert (treats either as already done, not an error); park-on-denied, satisfies **AC-5**, **AC-7**, **AC-8**, **AC-10**.
7. Extend `advance.ts`, measuring to final transition: upserts `leads` for **every** business where `last_scan_id = this scan` (not gated by PSI or `top_n`), applies the confirmed `completed` / `partial` / `failed` logic, sets `finished_at`, satisfies **AC-6**.
8. Build `supabase/functions/tick/index.ts`: the entry point; takes an advisory lock for the request's duration (exits immediately if already held); finds the one active scan (oldest by `created_at`, including `awaiting_approval`) or returns immediately; if the scan is still `queued`, batches `sweep_search` and moves it to `searching` before draining; runs `search.ts` then `advance.ts` then `psi.ts` then `advance.ts` again inside the shared 120 second budget, satisfies **AC-2**, **AC-7**, **AC-12**.
9. Deploy `tick` and `scan-create` (`verify_jwt = true` on both); run the one time `vault.create_secret` step; confirm the cron job fires and reaches `tick`, satisfies **AC-2**.
10. Run the six query test scan against `scan-create` with Noel's seeded credentials; verify every table populates (including no-website/social-only leads) and the status machine transitions correctly, satisfies **AC-9**.
11. Run a second, overlapping small scan on the same tenant; verify rediscovered businesses update `last_scan_id` correctly and still get cutoff-filtered and lead-created for the new scan, satisfies **AC-4**, **AC-6**, **AC-13**.
12. Run the full 288 query scan as the end to end proof; verify `api_budgets` and `api_calls` tracked it correctly, satisfies **AC-9**.
13. Run `get_advisors` (security and performance) after the new migration, per AGENTS.md's standing rule on any DDL change.

## Consequences

**Positive**:
- The spend gate is load bearing from the very first call this weekend makes, not retrofitted after the fact — matches `BUILD-PLAN.md` §10's own framing of this weekend.
- A scan that runs out of budget resumes cleanly from where it stopped; no lost work, no special resume logic needed beyond the queue's own visibility timeout.
- The engine is fully provable without any UI, which keeps this weekend's scope honest: nothing here is placeholder work waiting on a screen.

**Negative / tradeoffs**:
- `search.ts` and `psi.ts` can only be exercised by invoking the whole `tick` function; there is no way to unit test a single stage over HTTP in isolation.
- `@ngrx/signals` and Angular are untouched this weekend; the frontend dependency drift noted in the last session log is orthogonal to this spec and not addressed here.
- The single-active-scan-at-a-time design (matching `BUILD-PLAN.md` §6's singular phrasing, and actually enforced at the queue-drain level per AC-2/AC-3, not just assumed) means two scans started close together serialise rather than run concurrently — the second sits `queued` until the first reaches a terminal or parked state. Fine for a solo weekly tool; would need real per-scan queue partitioning or a scan-scoped lock if Sweep ever supported concurrent operators.

**Neutral**:
- The Vault based service role key step is a new one-time manual action outside of any committed migration, the first of its kind in this project; it should be written down somewhere durable (README or a runbook) so a project restore doesn't silently break the cron trigger.

## Follow-up

- [ ] Document the one time `vault.create_secret('service_role_key', ...)` step somewhere durable (a short runbook note), so restoring the project from a backup or a fresh Supabase project doesn't silently leave `tick` unauthenticated.
- [ ] The denial and resume path (AC-7) has never been exercised against a live scan, only proven at the SQL level in Weekend 1. Worth a deliberate test once this weekend's build lands, by temporarily lowering a test budget.
- [ ] `capture-snapshot` and the Notion sync remain explicitly out of scope (AC-11); Weekend 5 is where screenshot extraction is next expected to matter.
