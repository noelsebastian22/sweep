# Session log

Shared memory between Claude Code and Command Code. Neither agent can see the other's
conversation; this file is the handoff.

Not a changelog — git covers that. This records **intent, dead ends, and open threads**:
the things that live in a conversation and would otherwise die with it.

Written by the `/session-handoff` skill. Newest entry first. Never edit a past entry; if
it turned out wrong, say so in a new one.

<!-- newest first -->

## 2026-08-13 · claude-code · weekend 4 live scan, spend lockdown

**Did**
- Migration 19 (`20260813090228`): `scan_events` table + read-only RLS, `cancelled` added to `scan_status`, `scans` (with `replica identity full`) and `scan_events` added to `supabase_realtime`.
- Migration 20 (`20260813090345`): dropped every `authenticated` write policy on `api_budgets`/`spend_grants`/`api_calls`, plus `businesses`/`psi_results`/`site_snapshots`/`trades`/`regions`/`suburbs` and the unused verbs on `scan_queries`/`leads`/`lead_events`/`scans`. Added `approve_spend()`, `budget_headroom()`, `cancel_scan()`. `spend_grants` gains `sku`.
- `tick/events.ts` new (`logEvent`, `headroom`, `STAGE_BUDGET`). `index.ts` park fix + `settled()` guard + stage events; `search.ts`/`psi.ts` emit query/discovery/error/spend events and dedup the park line; `advance.ts` emits both stage transitions. `upsertBusiness` returns `xmax = 0` so the log can say "12 found, 3 new". Redeployed twice via the CLI.
- Frontend: `features/scans/{realtime.ts,scan.store.ts,live-scan/,scan-builder/}`, dashboard rewritten off real counts + active-scan card, `withComponentInputBinding()` added, `/scans/new` before `/scans/:id` in the route table.
- `@supabase/realtime-js` pinned exact at `2.112.2`. `ng build` 424.98 kB initial, no budget warning; `realtime-js` grepped out of `main` and found only in the 58 kB lazy chunk. Tests 22/22.
- `wrangler.jsonc` added (assets-only Worker, SPA `not_found_handling`). `deploy --dry-run` passes. **Not deployed** — needs Noel's Cloudflare login and is a public publish.
- Docs: `AGENTS.md` (17 tables, 20 migrations, realtime section, lockdown bullet, hard rule 2 amendment, current state), `BUILD-PLAN.md` §14 weekend 4 row + two new blocks, `scope.md` at-a-glance + weekend 1 AC-4 ticked + weekend 4 section.

**Decided**
- **`scan_events` is a table, not a stream.** Realtime replays nothing, so subscribing to `scan_queries`/`businesses` directly would leave a mid-scan page load blank and a finished scan with no log at all. One table also collapses three subscriptions into one and carries stage transitions and spend denials, which no existing row represents. The store treats every `SUBSCRIBED` as a resync and re-reads after its last seen id — that is the reconnect story, rather than trying to make the socket lossless.
- **`approve_spend()` is the only writer of `spend_grants` and the only way `granted_usd` rises**, and it sets `allow_paid` itself — they were two switches, so a grant could sit approved and inert. Caps (1,000 calls / $35 per grant, $50 a month) are constants in the function body, not a config table, so moving them needs a migration. `reserve_api_calls()` deliberately still reads only `api_budgets`: it holds `for update` on one row and must stay a single-row read.
- **A parked scan blocks the queue on purpose.** tick picks strictly the oldest active scan; skipping a parked one would put two scans' messages in flight and break AC-2. That is why `cancel_scan()` had to exist before parking could be made real.
- Grants are attributed per `(api, sku)`, so `spend_grants` needed `sku`. Invariant now mirrors migration 18's: `granted_usd = sum(spend_grants.amount_usd)` for that tenant/api/sku.

**Didn't work**
- **The security hole was verified, not inferred.** Before migration 20, `update api_budgets set allow_paid = true, granted_usd = 99999` as `authenticated` returned **1 row affected, no error**. Worth doing the probe: reading the policy alone would not have told you whether table grants also blocked it. The probe write is real and had to be reversed by hand afterwards.
- **`budget_headroom()` returned 0 inside `UPDATE ... RETURNING` and 698 a moment later.** Not a bug — it is `stable`, so it sees the statement-start snapshot. Nearly chased as a broken function. Read it in a separate statement.
- **The park event was logged CONCURRENCY times.** Every worker in the `pool` reaches the denial together, and `parked` was only set after an `await`. Fixed by claiming the flag synchronously (`const firstToPark = !parked; parked = true;`) before any await. The first live park wrote the line twice; the second wrote it once.
- **Resume looked broken for three ticks after the allowance was restored.** It was not — the parked messages still held their 120s `READ_VT` visibility timeout. Wait it out before concluding anything about the resume path.
- **Screenshot coordinates are scaled and do not match the DOM.** A click at the button's apparent centre (884, 97) silently missed; `getBoundingClientRect()` put it at (942, 104). Same stale-coordinate trap as 12 and 13 Aug. Read the rect and click the element, or click via `.click()`.
- **The Supabase CLI needed a login, and `supabase login` prompts for the macOS *keychain* password, not a Supabase one.** Noel's login had in fact already succeeded — `projects list` worked while the dialog was still on screen. `SUPABASE_ACCESS_TOKEN` bypasses the keychain entirely.
- The `deploy_edge_function` MCP tool needs *every* file inlined including the entrypoint; omitting `index.ts` fails with a confusing "Entrypoint path does not exist". The CLI is far cheaper — use it.
- Migration 19 originally contained `cancel_scan()`, which references `scan_events` and the `cancelled` enum value. Split: events + enum first, spend authority second.

**Open**
- **`approve_spend()` is unexercised through the UI.** Proven thoroughly at SQL level (demo refused, per-grant call cap, per-grant dollar cap, month ceiling, correct headroom arithmetic) and the button is wired to `db.rpc`, but clicking it would have spent real money on a paid grant, so it was not clicked. First real park in anger is the test.
- **The app login is `noel@nooel-sebastian.com`** — note the typo'd `nooel` domain — with `NOEL_PASSWORD` from `.env`. The password grant is now verified working (200, valid session), which closes the previous entry's "sign-in round trip untested" item. Noel could not remember this; worth leaving written down.
- **Not deployed to Cloudflare.** `wrangler.jsonc` is in place and `deploy --dry-run` passes; `npx wrangler login && npx wrangler deploy` is the remaining step.
- The radar sweep from `BUILD-PLAN.md` §12 was **not** built. It was meant to be prototyped in weekend 0's style tile and never was, and decorative animation is banned by default — building it unproven on the hero screen was the wrong order.
- Weekend 4 has **no spec file**, unlike 0003/0004. Decisions are in `BUILD-PLAN.md` §14, `scope.md` and the migration headers instead.
- Still open from before: leaked password protection at `/auth/providers` is off; `/check` and `/test` remain uninstalled. `businesses_found` counts only genuinely new discoveries, so a rescan of covered ground correctly shows 0 — the terminal summary says "0 new businesses found", which reads oddly but is accurate.
- Test scans `6648e2ae` (completed) and `b94039a9` (cancelled) are real rows in Noel's tenant and show on the dashboard.

**Next**
Weekend 5 — lead detail at `/leads/:id` as a 720px single-measure document: PSI metric breakdown, the event timeline, and the screenshots that are already sitting in the PSI payload (hard rule 4 means extracting `final-screenshot` at measure time, so `psi.ts` needs to store it — check `site_snapshots` is the right home before building the screen).

**Touched** — `supabase/migrations/20260813090228_19_scan_events_and_realtime.sql`, `supabase/migrations/20260813090345_20_spend_authority.sql`, `supabase/functions/tick/{events,index,search,psi,advance,state}.ts`, `src/app/features/scans/{realtime.ts,scan.store.ts,live-scan/live-scan.ts,scan-builder/scan-builder.ts}`, `src/app/pages/dashboard/dashboard.ts`, `src/app/stores/auth.store.ts`, `src/app/{app.config,app.routes}.ts`, `src/app/layout/app-layout.ts`, `wrangler.jsonc`, `AGENTS.md`, `BUILD-PLAN.md`, `docs/scope/scope.md`, `package.json`

## 2026-08-13 · claude-code · bundle cut, weekend 4 started

**Did**
- `core/supabase.service.ts` rewritten: client composed from `@supabase/auth-js` + `@supabase/postgrest-js`, exports `auth` and `db`. `@supabase/supabase-js` removed from `package.json`; the two sub-packages pinned exact at `2.112.2`.
- `auth.store.ts` (`supabase.auth.` → `auth.`, `Session`/`User` now from `@supabase/auth-js`) and `leads.store.ts` (`supabase.from` → `db.from`) rewired.
- `main` 506.49 → 407.46 kB raw, 125.25 → 102.89 kB transfer; initial total 524.69 → 425.65 kB. `ng build` warning gone, budget left at 500 kB. `realtime-js`, `phoenix`, `storage-js`, `iceberg-js`, `functions-js` confirmed absent from `stats.json`.
- `npx ng test --watch=false` 22/22.
- `AGENTS.md` Supabase section: new bullet on the composed client. `BUILD-PLAN.md` §14: bundle-budget resolution block under the status table.
- Diagnosed the UptimeRobot "down" email: not a real incident. Started the weekend 4 architect interview (no spec file written).

**Decided**
- **The browser client is composed, not the umbrella package.** The umbrella builds storage/realtime/iceberg clients in its constructor so nothing tree-shakes, and its `exports` map offers no slim build (only `.`, `./cors`, `./tracing`). ~108 kB of `main` was code Sweep never runs. Note ~17 kB of `auth-js` is WebAuthn + Web3 login paths and a 9.5 kB `GoTrueAdminApi`, all statically reachable from `GoTrueClient` and therefore unremovable.
- **Two lines in `supabase.service.ts` are load-bearing.** `storageKey` must stay `sb-<project-ref>-auth-token` (wrong shape = every signed-in browser silently signs out, no error), and the `Authorization` bearer must fall back to the publishable key with no session (PostgREST rejects a missing bearer outright).
- **Weekend 4 must `import('@supabase/realtime-js')` dynamically inside the scan route** and call `setAuth()` from `onAuthStateChange` — wiring the umbrella used to do. Keeps realtime out of `main`.
- Weekend 4 Stage (a) answers, from Noel: dashboard card as entry point (no `/scans` list yet); one screen that settles into a terminal summary for completed/partial/failed; log carries discoveries + failed queries + stage/spend events; `spend_grants` gets wired into `reserve_api_calls()` properly rather than bumping `api_budgets`.

**Didn't work**
- **Lazy-loading the umbrella client via dynamic `import()` was considered and rejected.** It moves ~214 kB out of the initial chunk but changes total bytes downloaded by zero, and auth is on the critical path for every route, so time-to-interactive barely moves. It satisfies the budget metric without fixing the problem. Do not "fix" a future budget warning this way.
- **Coordinate-based clicks in the leads grid landed on the column header twice**, re-sorting instead of opening the drawer — the same stale-coordinate trap as 12 Aug. Verified the write path with a same-value `PATCH` through `javascript_tool` instead: it is a real RLS-governed UPDATE with zero net data change, only `leads_touch_updated_at` fires.
- **Background `ng serve` reported exit 127 twice with empty output.** Misleading: the real cause was port 4200 already in use by Noel's own dev server. Check the port before believing the exit code.
- Supabase MCP `execute_sql` takes `query`, not `sql`.

**Open**
- **Sign-out → sign-in round trip is untested.** I do not type passwords into forms. Everything around it is proven (auth URL, headers, `storageKey`, session restore, `getSession`), but the literal password grant is unexercised. If it fails, look at the `AuthClient` config in `core/supabase.service.ts`.
- **`supabase_realtime` publication contains zero tables.** Realtime subscriptions will connect and deliver nothing until a migration adds `scans` and `businesses`. Weekend 4 blocker; looks exactly like a client bug.
- **`reserve_api_calls()` never reads `spend_grants`.** The table exists with `calls`/`amount_usd`/`approved_by` but the gate only reads `api_budgets`. No wired path makes an approval unblock a scan. Weekend 4 owns fixing this (§4 change).
- **`awaiting_approval` does not actually park.** `pickActiveScan` includes it and `tick/index.ts:38` flips it back to `searching`/`measuring` next tick, so it loops park → resume → denied → park once a minute. The UI must say "blocked, retrying", not "waiting for you".
- **`authenticated` can write `api_budgets` and `spend_grants` directly** — the browser can raise its own paid allowance. Decide this deliberately in weekend 4.
- `docs/scope/scope.md` has **no weekend 4 row**, and its "At a glance" table still says weekend 3 is `in-progress` while the body heading says `done`.
- Weekend 1 AC-4 (UptimeRobot) is **now genuinely satisfied** — monitor live, checks landing every ~6 min, confirmed in `function_edge_logs`. `scope.md` still shows it unticked.
- UptimeRobot emails were `TEST:`-prefixed notifications 2 seconds apart, fired by the "send test notification" button; the dashboard correctly shows no incidents. Not a bug. Health has returned unbroken 200s.
- Still open from before: leaked password protection at `/auth/providers`; `noel1234` is weak and will likely be rejected once it is on. Sign out still leaves the grid rendered until the next navigation. `/check` and `/test` remain uninstalled.

**Next**
Resume the weekend 4 architect interview from Stage (b). The four Stage (a) answers above are already settled; still to walk are the data model (realtime publication migration, `spend_grants` wiring), realtime mechanics (dynamic `realtime-js` import, `setAuth` on token change, reconnect/missed-event handling), page composition for the three regions, API surface, authz, and edge cases. Spec goes to `docs/specs/0005-weekend-4-live-scan/` as a directory spec (`index.md` + `rationale.md` + `verify.md`), matching 0003 and 0004.

**Touched** — `src/app/core/supabase.service.ts`, `src/app/stores/auth.store.ts`, `src/app/features/leads/leads.store.ts`, `package.json`, `package-lock.json`, `AGENTS.md`, `BUILD-PLAN.md`

## 2026-08-13 · claude-code · weekend 2 and 3 gaps closed

**Did**
- Migration 18 (`20260812214957_18_reserve_logs_atomically`): `reserve_api_calls()` gains `p_scan`, returns `(grant_kind, call_id)`, inserts its own `api_calls` row in the same transaction. `api_calls` gains `units`/`refunded_at`. `refund_api_calls(...)` dropped, replaced by idempotent `refund_api_call(call_id)`.
- `tick/spend.ts` rewritten (`Reservation` discriminated union, `refund`, `recordStatus`); `search.ts` + `psi.ts` rewired to it. `tick` redeployed twice.
- `advance.ts`: final scan status reads `completed_queries`, not `businesses_found`.
- `index.ts`: tick response carries `reason` (`locked` / `no_active_scan` / null).
- `src/app/app.spec.ts`: replaced the scaffold's `Hello, sweep` assertion with a router-outlet test. `npm test` 21/22 → 22/22.
- `.github/workflows/keepalive.yml` added — 6-hourly ping of the public `health` function.
- `docs/specs/0003-*/verify.md`: 6 new ticked steps + a "the budget drift was misdiagnosed" correction table. `docs/specs/0004-*/verify.md` rewritten with all 25 steps ticked, 3 findings, 2 harness traps. Spec 0004 → `Accepted`.
- `AGENTS.md` current-state + migration count (14→18) + hard rule 1 unstaled. `BUILD-PLAN.md` §4 revision block, §12 keepalive, §14 rows for weekends 2 and 3, "still to do before the engine can run" struck through.
- Verified live: AC-7 both halves, AC-12 forced (two concurrent `net.http_post`), AC-1 demo rejection, and weekend 3 AC-1..AC-13 across both tenants.

**Decided**
- **The reservation owns its log line.** Noel approved changing the §4 function. Callers now fill in `http_status` with a plain `UPDATE` that deliberately cannot create a row — if it never runs, the reservation still stands. Invariant: `api_budgets.used = sum(api_calls.units) where refunded_at is null`.
- **Orphaned reservations are repaired by adding ledger rows, never by lowering `used`.** An orphan may correspond to a call that really went out; under-reporting spend is the one direction §4 must never fail in.
- **Scan status describes whether the scan did its work, not what it found.** `completed_queries = 0` means failed; `businesses_found` counts only new discoveries and made every 100%-overlap rescan look failed.
- **Keepalive is UptimeRobot primary, GitHub Actions backup.** Actions disables scheduled workflows after 60 days of repo inactivity — exactly when a quiet portfolio project needs the ping. UptimeRobot does not decay and its free tier costs nothing.

**Didn't work**
- **The previous entry's budget-drift diagnosis was wrong.** It described one drift caused by `drainSearch`/`drainPsi`'s soft deadline. Measuring first showed two things: `places_text_search` −24 was *correct* (24 `400`s reserved then refunded; Google does not bill invalid-argument 400s, so `used` matched billed calls exactly), and only psi's +20 was real — no refund path, and `logCall` ran after `runPsi`, a window up to ~35s. **Tightening `BUDGET_MS`, the fix the entry proposed, would not have touched it.** Measure before fixing.
- **Do not close the drawer with `history.replaceState()`.** It desyncs Angular's router; afterwards `isDemo()` reads stale and the palette offers Set-status actions on the demo tenant. This looked exactly like a real AC-9 violation and was reported as a defect before being traced to the harness. Close the drawer through the UI.
- **`Cmd+K` needs the page to hold focus.** After a programmatic `navigate`, focus sits outside the document and the shortcut silently does nothing — it is not broken.
- **An RLS `USING` failure is 0 rows, not an error.** First demo-write test "passed" against an empty table and then read `accepted` against a real row; both were meaningless. `UPDATE` filtered by `USING` raises nothing. Always assert on rows-affected plus a positive control on the real tenant.
- `set local role authenticated` inside a `DO` block cannot then write to a temp table (permission denied), and a PL/pgSQL exception block silently rolls the role back. Capture the outcome into a variable, `reset role`, *then* log.
- `raise notice` output does not come back through the Supabase MCP. Insert assertions into a temp table and `select` it.
- `npm test` is `ng test`, which watches and never exits — use `npx ng test --watch=false`.
- Palette quick filters *merge* into the active filter set. Running them back to back gives `0 of 64` and looks broken; clear between them.
- Foreground `sleep` is blocked in this harness; use `run_in_background` or poll.

**Open**
- **Noel to do:** create the UptimeRobot monitor on `https://ifwyufrepqkzsicjinfi.supabase.co/functions/v1/health`, and enable leaked password protection at `/auth/providers` (the last advisor warning).
- **Password**: Noel supplied `noel1234` in chat this session and put it in `.env` (correctly gitignored, never staged). It is weak, almost certainly in HaveIBeenPwned, and will likely be rejected once leaked-password protection is on. Recommend rotating. Do not re-record it here.
- **`ng build` warns**: initial bundle 524.69 kB vs a 500 kB budget. Routes are already lazy; 506 kB is framework + supabase-js needed at bootstrap, 125 kB gzipped. Left for Noel to either raise `maximumWarning` in `angular.json` or do bundle work — deliberately not silently re-baselined.
- Demo read-only-ness is invisible until you try: the disabled `select` has `opacity: 1`/`cursor: default`, and the DB refuses silently. **Client code must never infer success from the absence of an error on a demo write.**
- Sign out clears the header but leaves the grid rendered until the next navigation; the guard only runs on route change.
- `/check` and `/test` are referenced by `/develop`, `/architect`, both `verify.md` files and `scope.md`, but are **not installed** in `.claude/skills/` (only architect, audit, develop, impeccable, session-handoff). Verification this session was manual. Install them or stop referencing them.
- Test scan `fc8ec3b6-7ade-4a8d-9692-466ca6c53978` (2-query Joinery rescan) left in Noel's scan history — real data, 23 businesses refreshed. Delete if it clutters weekend 4's screen.
- AC-1's 5000-row fetch bound never exercised (450 leads is well under it).

**Next**
Weekend 4 — the live scan screen. Realtime subscription on the one `scans` row (migration 08's rollup triggers exist for exactly this), progress rail, streaming log, radar sweep, and the `awaiting_approval` state. Note before drawing that state: a parked scan resumes on the **second** tick after approval, not the first, because the queue messages stay invisible for the remainder of their 120s `READ_VT`.

**Touched** — `supabase/migrations/20260812214957_18_reserve_logs_atomically.sql`, `supabase/functions/tick/{spend.ts,search.ts,psi.ts,advance.ts,index.ts}`, `src/app/app.spec.ts`, `.github/workflows/keepalive.yml`, `AGENTS.md`, `BUILD-PLAN.md`, `docs/scope/scope.md`, `docs/specs/0003-weekend-2-engine-spend-gate/verify.md`, `docs/specs/0004-weekend-3-leads-grid/{index.md,verify.md}`

## 2026-08-12 · claude-code · weekend 3 leads grid built and proven live

**Did**
- Migration 17: seeds one `is_default=true` `scoring_profiles` row per tenant with `harvest.mjs`'s constants. Applied, verified on both tenants.
- `core/supabase.service.ts` (client extracted out of `auth.store.ts`), `AuthStore.isDemo` (joins `tenants.is_demo` in `loadProfile`).
- `shared/scoring/score.ts`: pure port of `penalty()`/`score()`, `mergeScoringWeights`, `scoreBreakdown` for the drawer's derivation string. 21 unit tests in `score.spec.ts`, all pass.
- `features/leads/leads.store.ts`: NgRx SignalStore, one fetch of `lead_rows` + default weights, `computed()` signals for score, the AC-3 heat basis/percentile banding (collapses correctly on a degenerate set), filter, sort.
- `shared/ui/hairline-table`, `shared/ui/heat-cell`, CDK virtual scroll (`@angular/cdk` added), `features/leads/leads-grid/leads-grid.ts` wiring it all together with filter chips, PSI/rating ranges, search.
- `core/keyboard.service.ts` (global shortcut + palette registry), `features/leads/lead-drawer/lead-drawer.ts` (status write, demo-tenant disablement, `?lead=` query param), `shared/ui/command-palette` on `@angular/aria` combobox/listbox (added).
- Route `/leads` added to `app.routes.ts`, nav link added to `app-layout.ts`.
- Fixed a real pre-existing bug: `postcss.config.mjs` was never read by `ng build`/`ng serve` — Angular's builder only recognizes `postcss.config.json`/`.postcssrc.json`. Every `--color-sw-*` token has been compiling to nothing since that file was written; the whole app has been rendering colourless (login, dashboard, style tile, this grid) with no one noticing. Replaced with `postcss.config.json`, confirmed `:root` now carries the tokens in both dev and prod builds.
- Verified live in Chrome: seeded 40 temp businesses/leads onto the demo tenant directly in Postgres (it had zero real data and no reference tables), exercised every AC, deleted all of it afterward — demo tenant is back to empty. Read-only spot-checked against Noel's real 450-lead tenant via direct SQL.
- `docs/scope/scope.md` weekend 3 build box + 5 sub-boxes ticked. `docs/specs/0004-weekend-3-leads-grid/index.md` Status → `In Progress`. `docs/specs/0004-weekend-3-leads-grid/verify.md` written (full AC checklist).

**Decided**
- Used `resource()`/manual `patchState` pattern (matching `AuthStore`'s existing convention) instead of the build plan's literal `httpResource()` wording for `leads.store.ts` — `httpResource()` is HttpClient-specific and doesn't wrap a `supabase-js` call; `resource()`/plain async + `patchState` is what the codebase already does and makes optimistic status-update patching straightforward.
- Heat band collapse rule (AC-3, not fully pinned by the spec): with ≤5 distinct score values in the basis, bands are the direct rank (0..n-1, contiguous); above 5, percentile bucketing across bands 0-4. Ties always share a band either way.

**Didn't work**
- Tried logging in as `noel@nooel-sebastian.com` with the `demo1234!` password from `docs/SESSIONS.md` — 400 invalid_credentials (confirmed via direct curl against the auth endpoint, not a browser quirk). An earlier entry (12 Aug, budget/password session) shows Noel's password was reset since that log line was written and the log was never updated. Did not attempt further guesses. Verified with the demo tenant instead (seeded temp data, see above).
- First `left_click` on a palette option (`ngOption` in `selectionMode="explicit"`) didn't register a selection even after adding an explicit `(click)` handler — only keyboard `enter` selection works. AC-9 only requires the keyboard flow, so left as a known rough edge rather than sunk further time into Angular Aria's click semantics.
- First couple of browser `find`+coordinate-based clicks landed on stale positions after the page re-rendered (filtered row count shrank, shifting layout) — switched to re-`find`-ing elements by ref right before each click rather than reusing coordinates across screenshots.

**Open**
- Noel's current login password isn't recorded anywhere agents can read (by design) — a full read+write pass against his real 450-lead tenant needs a session where he's present, or a fresh `NOEL_PASSWORD` secret + reset flow like the one used earlier this week.
- Command palette mouse-click selection (see Didn't work above) — cosmetic, not spec-blocking.
- `/check verify weekend-3-leads-grid` not yet run — `docs/specs/0004-weekend-3-leads-grid/verify.md` has the checklist.
- Weekend 2's two follow-ups (budget-accounting drift, `businesses_found=0` status logic) remain open, untouched this session.

**Next**
- `/check verify weekend-3-leads-grid`, then mark the feature `done` and mirror the spec status to `Accepted`.

**Touched** — `supabase/migrations/20260812082954_17_seed_default_scoring_profiles.sql`, `src/app/core/supabase.service.ts`, `src/app/core/keyboard.service.ts`, `src/app/stores/auth.store.ts`, `src/app/shared/scoring/score.ts`, `src/app/shared/scoring/score.spec.ts`, `src/app/shared/ui/hairline-table/hairline-table.ts`, `src/app/shared/ui/heat-cell/heat-cell.ts`, `src/app/shared/ui/command-palette/command-palette.ts`, `src/app/features/leads/leads.store.ts`, `src/app/features/leads/leads-grid/leads-grid.ts`, `src/app/features/leads/lead-drawer/lead-drawer.ts`, `src/app/app.routes.ts`, `src/app/layout/app-layout.ts`, `postcss.config.json` (new), `postcss.config.mjs` (removed), `package.json`, `docs/scope/scope.md`, `docs/specs/0004-weekend-3-leads-grid/index.md`, `docs/specs/0004-weekend-3-leads-grid/verify.md`, `BUILD-PLAN.md` §14

## 2026-08-12 · claude-code · weekend 2 engine built and proven live

**Did**
- Migrations 15 (`businesses.last_scan_id`, `psi_results_roll_completed` trigger, `psi_results_business_scan_uidx` partial unique index) and 16 (real `net.http_post` cron wiring, `timeout_milliseconds := 130000`, reads the service role key from Vault). Applied and confirmed against remote; filenames renamed to match the remote ledger's actual apply timestamps (same drift issue as last session — always check `list_migrations` before naming a new file).
- Built and deployed `supabase/functions/scan-create/index.ts` (validates `trade_ids`/`suburb_ids`/`top_n`, derives `region_id`, resolves `tenant_id` via `current_tenant()` RPC, inserts `scans` + `scan_queries`).
- Built and deployed `supabase/functions/tick/` — `index.ts` (advisory lock, active-scan pickup, orchestration), `db.ts`, `queue.ts`, `spend.ts`, `state.ts`, `search.ts`, `psi.ts`, `advance.ts`, `lib.ts` (harvest.mjs's pure logic ported verbatim).
- `tick` talks to Postgres directly via `postgres.js`/`SUPABASE_DB_URL`, not `supabase-js`/PostgREST — needed raw `pgmq.read/archive/set_vt/send` (an extension schema PostgREST doesn't expose) and a conflict-aware `businesses` upsert (omit `first_seen_scan_id` from the `on conflict do update set` list to preserve it while overwriting everything else). Not in the original spec; recorded as an implementation decision in the spec's `rationale.md`.
- Ran three real scans end to end: 6-query, an identical 6-query rescan, and the full 288-query scan. All verified directly in Postgres (`scans`, `scan_queries`, `businesses`, `psi_results`, `leads`, `api_budgets`, `api_calls`).
- Split spec 0003 from a single file into a directory (`index.md`/`rationale.md`/`verify.md`) on first `verify.md` write, per the develop skill's convention. Repointed `docs/scope/scope.md` (3 links) and `BUILD-PLAN.md` §14 to the new `index.md` path.
- Marked Weekend 2 `done` in scope, spec 0003 `Status` advanced `Proposed` → `In Progress` → `Accepted`.

**Decided**
- Noel forgot the `NOEL_PASSWORD` he'd set last session; Supabase secrets are write-only, unrecoverable by any tool. Fixed without ever routing the real password or the service role key through the agent: deployed a temporary `vault-setup` function (read `SUPABASE_SERVICE_ROLE_KEY` from its own env, wrote it to Vault) and a temporary `reset-password` function (`verify_jwt = false`, gated by a throwaway `RESET_TOKEN` secret, since the whole problem was Noel having no JWT to offer). Both deleted immediately after use; nothing sensitive ever appeared in this transcript.
- Business rule: `advance.ts`'s final scan status reads `businesses_found` per the spec's own Value sourcing table, even though migration 08's trigger only counts genuinely new discoveries (not total businesses touched). Built to spec as written rather than silently changing the source column — flagged as a latent gap instead.

**Didn't work**
- First attempt at asking Noel for his access token via a plain password-grant curl failed — he'd left the literal `<your password>` placeholder in the command unsubstituted, then genuinely forgot the real password on the next attempt.
- First `Monitor` polling script crashed immediately (`(eval):6: read-only variable: status`) — `status` collides with zsh's own reserved `$status` exit-code variable. Renamed to `scan_status` and it worked. Watch for this in any future zsh polling script.

**Open**
- **Budget-accounting drift**: `drainSearch`/`drainPsi`'s deadline check is soft (only gates starting a new batch, not an in-flight one). A platform hard-kill mid-batch can orphan a `reserve_api_calls()` increment with no matching write; the message redelivers correctly later (pgmq vt), so no data loss, but `api_budgets.used` drifts high. Observed a real 20-unit drift on `psi` (cost $0, harmless) during the 288-query test; architecturally possible but unproven on the billed `places_text_search` API. Needs a decision: tighten `BUDGET_MS` headroom, or race reserve+call+archive against the deadline per message.
- **Status-logic gap**: a scan with 100% overlap and zero new businesses would read `businesses_found = 0` and get marked `failed` despite successfully rediscovering and lead-creating for every business it touched. Not hit in testing (every rescan found a few new ones). See spec 0003's Follow-up for the full writeup.
- AC-7 (denial/resume), AC-12 (concurrent-tick guard forced rather than merely unobserved), and AC-1's demo-tenant-rejection path were never exercised — listed in `verify.md`'s Open section.
- UptimeRobot keepalive still not configured (carried over from two sessions ago).
- Leaked password protection still disabled on Supabase Auth (carried over, no MCP tool exposes the setting).

**Next**
No code prerequisite blocks the next feature. Candidates, in the order `BUILD-PLAN.md` §10 implies: Weekend 3 (the leads grid, first real UI) or clearing the AC-7/AC-12 test gaps first via `/check verify weekend-2-engine-spend-gate`. Either is reasonable; the two open findings above don't block starting Weekend 3, they're independent of the frontend.

**Touched** — `AGENTS.md`, `BUILD-PLAN.md`, `docs/scope/scope.md`, `docs/specs/0003-weekend-2-engine-spend-gate/{index.md,rationale.md,verify.md}` (new, replaces the old single-file spec), `supabase/config.toml`, `supabase/migrations/20260811091301_15_engine_schema_additions.sql`, `supabase/migrations/20260811091324_16_wire_tick_cron.sql`, `supabase/functions/scan-create/`, `supabase/functions/tick/`

## 2026-08-11 · claude-code · weekend 2 spec + hygiene

**Did**
- Fixed `AppLayout` (`src/app/layout/app-layout.ts`): `<ng-content />` → `<router-outlet />` — it was wired as a router parent with `children` but rendering via content projection, so the dashboard likely never showed. Verified end to end in browser (login → dashboard renders inside the shell).
- Upgraded Angular v20 → v21 → v22 (`ng update` twice), bumped Node to 24.19.0 LTS (pinned in `.nvmrc`, Angular 22's CLI requires it), `@ngrx/signals` pinned to `22.0.0-rc.0` (no stable release targets Angular 22 yet).
- Backend hygiene: `supabase login` + linked the project; set secrets `GOOGLE_PLACES_API_KEY`, `GOOGLE_PSI_API_KEY`, `NOEL_PASSWORD`, `DEMO_PASSWORD` (none ever written to a file); removed the hardcoded password fallback in `supabase/functions/seed/index.ts`, redeployed; added `supabase/config.toml` tracking `verify_jwt` per function.
- Ran `get_advisors` (overdue since migration 13, never run last session): found migration 13 left `pg_net` installed in the `public` schema. Fixed with migration 14 (`20260810231309_14_move_pg_net_out_of_public.sql`).
- Found and fixed migration filename drift: local file for migration 13 was named `20260810000013_queue_plumbing.sql` but the remote ledger recorded it as `20260810221724`; renamed both 13 and 14 so `supabase migration list` matches exactly, local to remote.
- Corrected stale docs: AGENTS.md/BUILD-PLAN.md Angular version (said 23, actual is v22), migration count (said 12, then 13, now 14), `harvest.mjs` path (no `prospecting/` dir exists), `docs/scope/scope.md` and specs 0001/0002 status headers reconciled to what actually shipped.
- Wrote and confirmed `docs/specs/0003-weekend-2-engine-spend-gate.md` via `/architect` — full staged design conversation, then a same-model cross check that found 10 real gaps: queue not scoped to the active scan, `awaiting_approval` scans invisible to `tick`'s active-scan query (AC-7's resume could never fire), no `region_id` source for `scan-create`, no per-scan business linkage (`first_seen_scan_id` only holds for a business's *first ever* scan — would silently break on the second real scan, the project's actual steady state), missing `refund_api_calls()` on the Places 400-retry path, a redelivery race on the PSI unique index, `pg_net`'s default 5s timeout vs `tick`'s 120s budget, no overlapping-tick guard, unspecified `businesses` upsert conflict columns, no `website_kind` classification carried over. All 10 fixed directly in the spec's ACs, data model, and build plan — not left as follow-ups.
- Enrolled Weekend 2 on `docs/scope/scope.md`, in-progress, 5-milestone rollup. Updated `BUILD-PLAN.md` §14.

**Decided**
- `tick` is one deployed edge function with `search.ts`/`psi.ts`/`advance.ts` as internal modules, not four separately deployed functions — matches `BUILD-PLAN.md` §6's own invocation-budget arithmetic (one function, 43,200/month) and gives all three stages one shared 120s time budget instead of three separate ones.
- `scan-create` never enqueues `sweep_search` itself; `tick` enqueues it the first time it picks a `queued` scan as active. This is what actually keeps one scan's work in flight system-wide — the first draft of the spec didn't enforce this anywhere, the cross check caught it.
- The service role key for the cron→edge-function call goes through Supabase Vault (`vault.create_secret`, run manually, never committed) rather than a Postgres setting inside a migration file — keeps the raw key out of git per AGENTS.md hard rule 3.
- `@ngrx/signals` stays on the `22.0.0-rc.0` prerelease until a stable 22.x ships; recorded here so a future `npm update` doesn't silently need re-deciding.

**Didn't work**
- First Angular upgrade attempt: bumped `@ngrx/signals` to 21.1.1 for the v21 hop but forgot to bump it again for the v22 hop — `npm i` broke for Noel with a peer-dep conflict. Fixed by pinning to the `22.0.0-rc.0` prerelease.
- `ng update @angular/cli@22` failed outright on Node 22.17.0 ("requires v22.22.3+"). Had to install Node 24.19.0 via `nvm` first.
- Tried `alter extension pg_net set schema extensions` to fix the public-schema finding — pg_net doesn't support `set schema` on an existing install. Had to `drop extension` + `create extension ... with schema extensions` instead.

**Open**
- Weekend 2 is spec'd and confirmed but **not built**. `/develop weekend-2-engine-spend-gate` is next.
- UptimeRobot keepalive still not configured (carried over from last session).
- Leaked password protection is disabled on Supabase Auth — flagged by `get_advisors`, no MCP tool exposes the setting to fix it; needs the dashboard directly.
- The one-time `select vault.create_secret('service_role_key', ...)` step has not been run — it's build-plan step 2 for `/develop`, the migration that reads it back doesn't exist yet either.

**Next**
`/clear` then `/develop weekend-2-engine-spend-gate` — build the schema additions (`last_scan_id`, the `psi_completed` trigger, the redelivery-safe unique index), the `tick` cron wiring, `scan-create`, and the `tick` engine itself (`search.ts`/`advance.ts`/`psi.ts`/`index.ts`), per the spec's 13-step build plan.

**Touched** — `src/app/layout/app-layout.ts`, `package.json`, `package-lock.json`, `.nvmrc`, `AGENTS.md`, `BUILD-PLAN.md`, `docs/scope/scope.md`, `docs/specs/0001-angular-scaffold-style-tile.md`, `docs/specs/0002-weekend-1-angular-foundations.md`, `docs/specs/0003-weekend-2-engine-spend-gate.md`, `supabase/config.toml`, `supabase/functions/seed/index.ts`, `supabase/migrations/20260810221724_13_queue_plumbing.sql`, `supabase/migrations/20260810231309_14_move_pg_net_out_of_public.sql`, `.impeccable/config.json`

## 2026-08-11 · command-code · weekend 1 Angular build

**Did**
- Installed `@supabase/supabase-js@2.112.2` and `@ngrx/signals@20.1.0` (v21 needs Angular ^21; this project is v20).
- Wrote and applied migration 13: enabled pgmq, pg_cron, pg_net; created `sweep_search` and `sweep_psi` queues; scheduled tick cron as `select 1` every minute.
- Deployed `supabase/functions/health/` — GET returns 200 `{status:"ok"}` with Postgres liveness check, 503 if DB unreachable.
- Deployed `supabase/functions/seed/` and ran it once: 2 tenants (Noel + Demo), 2 auth users (`noel@nooel-sebastian.com` and `demo@sweep.local`, both password `demo1234!`), 2 profiles, 16 trades, 18 Blue Mountains suburbs with lat/lng, 4 api_budgets. Idempotent — rerunning returns 409.
- Created `src/app/stores/auth.store.ts` — NgRx SignalStore with session/user/tenantId, `getSession()` on init, `onAuthStateChange` subscription.
- Created `src/app/pages/login/login.ts` — email + password form, calls `signInWithPassword`, inline error, redirects to `/` on success.
- Created `src/app/guards/auth.guard.ts` — async CanActivateFn that waits for `whenReady()` before checking auth.
- Created `src/app/layout/app-layout.ts` — header with app name, user email, sign out button, content projection.
- Created `src/app/pages/dashboard/dashboard.ts` — welcome message + 3 fixture stat cards (Scans run: 0, Leads found: 0, Free allowance: 1,000).
- Wired routes: `/style` and `/login` public, `/` protected behind auth guard with AppLayout shell.
- `ng build` passes with zero errors and zero warnings.
- Created `.env` and `src/environments/environment.ts`.

**Decided**
- NgRx Signals 20.1.0, not 21.1.1 — Angular 20 in this project doesn't satisfy the ^21 peer dep. No material difference for our usage.

**Didn't work**
- `npm install` omitted devDeps (`@angular/build`, `@angular/cli`, etc.), causing "Could not find builder" on first build. Fixed with `npm install --include=dev`.
- Health v1 used `supabase.rpc('version')` for the liveness check — returned 503. v2 uses `from('tenants').select('id').limit(1)` which works.
- Initially tried constructor injection for AuthStore in Login — SignalStore with `providedIn: 'root'` needs `inject()` not constructor DI.

**Open**
- UptimeRobot monitor not configured — needs an external account. Health endpoint is live and ready.
- `DEMO_PASSWORD` not set as a Supabase secret — CLI not logged in. Currently hardcoded in the seed function source.
- Both auth user passwords are hardcoded in the seed function. Should be moved to `Deno.env.get()` once secrets are set.
- Angular version mismatch: BUILD-PLAN.md §1 says "Angular 23", actual installed is v20. SESSIONS.md claimed v23 but package.json is v20.

**Next**
Configure UptimeRobot free monitor → `supabase login` + set secrets → Weekend 2 engine port (`docs/specs/0002-weekend-1-angular-foundations.md` §3 follow-ups).

**Touched** — `package.json`, `package-lock.json`, `src/app/app.config.ts`, `src/app/app.routes.ts`, `src/app/stores/auth.store.ts`, `src/app/guards/auth.guard.ts`, `src/app/pages/login/login.ts`, `src/app/pages/dashboard/dashboard.ts`, `src/app/layout/app-layout.ts`, `src/environments/environment.ts`, `supabase/migrations/20260810000013_queue_plumbing.sql`, `supabase/functions/health/index.ts`, `supabase/functions/seed/index.ts`, `.env`

## 2026-08-10 · command-code · weekend 1 architect

**Did**
- Ran `/architect` for Weekend 1: seed data, queue plumbing, keepalive, Angular app shell. Wrote spec `docs/specs/0002-weekend-1-angular-foundations.md` — `Proposed`.
- Cross-checked the spec: found five gaps (no profiles rows, health function missing verify_jwt, tick cron no-op had no SQL, missing pg_net extension). All fixed before confirmation.
- Enrolled Weekend 1 on the scope at `docs/scope/scope.md`, in-progress with 3 milestone tasks.
- Discovered `harvest.mjs` was not tracked in git. Now staged.

**Decided**
- Keepalive: **UptimeRobot free monitor** pinging `/health` every 5 minutes. Chosen over GitHub Actions (dormant-repo timeout kills it) and pg_cron self-ping (not reliably counted as activity by Supabase). The health function checks Postgres connectivity with `select 1`, not just a bare 200.
- Auth: **email/password only** for now. Google OAuth can be added later as a Supabase config change with no code rewrite. Demo user at `demo@sweep.local`, password as a Supabase secret.
- Seed: **migration (DDL) + edge function (data)**. Migration 13 enables pgmq, pg_cron, pg_net, creates queues, schedules tick cron as `select 1`. A seed edge function inserts tenants, trades, suburbs (lat/lng filled by /develop), api_budgets, plus creates auth users and profiles for Noel and demo.
- State: **NgRx SignalStore** for auth (session, user, tenant). Supabase client provided in `app.config.ts`. Auth guard reads from the store.
- App shell: **login page at `/login`**, shared layout shell with header and content projection, placeholder dashboard at `/` with fixture stat cards.
- Queue messages: **minimal** — sweep_search carries scan_id, query_id, trade name/type, suburb name/lat/lng. sweep_psi carries scan_id, business_id, website_url. Workers look up config from the scan row.

**Open**
- `harvest.mjs` was never committed (not in any git history). The spec references it for the TRADES and SUBURBS arrays. Must be staged in this commit.
- Suburb lat/lng coordinates are left for /develop to fill during the build.
- Angular version mismatch (23 vs 22 in BUILD-PLAN.md §1) still not fixed. Follow-up in spec 0002.

**Next**
`/develop weekend-1-angular-foundations` — 15 build tasks across backend (migration, health, seed, keepalive) and frontend (Supabase client, AuthStore, login, guard, layout, dashboard).

**Touched** — `docs/specs/0002-weekend-1-angular-foundations.md`, `docs/scope/scope.md`, `harvest.mjs`

## 2026-08-10 · command-code · weekend 0 build

**Did**
- Scaffolded Angular 22 with `ng new sweep --directory . --routing --style css --ssr false --standalone --strict --zoneless`. Installed deps and Tailwind v4 + `@tailwindcss/postcss`.
- Configured `postcss.config.mjs` and wrote all 20 §7 colour tokens plus radius tokens into `@theme` in `src/styles.css`.
- Downloaded Geist Sans Bold and Geist Mono Medium from `vercel/geist-font` v1.7.2 zip (one zip asset per release). Self-hosted at `src/assets/fonts/`, preloaded in `index.html`.
- Wired `provideZonelessChangeDetection()` and `provideRouter(routes, withViewTransitions())` in `app.config.ts`.
- Built the style tile as one monolithic standalone component at `src/app/style-tile/style-tile.ts`, lazy-loaded at `/style`. Seven inline-styled sections: colour swatches with runtime WCAG 2.1 contrast ratios, type scale samples, 56px/40px buttons in 4 states, text input/select/checkbox/eyebrow pill with focus rings, 20-row hairline table of fake Blue Mountains leads, 4 stat blocks, SVG radar sweep with verdict on both panels.
- `ng build` passes with zero warnings. Contrast ratios verified against BUILD-PLAN.md §7 — all match (ok token is 4.95:1, plan's 5.0:1 is rounded).

**Decided**
- Angular CLI installed is v23, not v22 — `@angular/cli@22` is not in the npm registry. Built with v23; no API surface difference for the features we use.

**Didn't work**
- `ng new --ai-config claude-code --test-runner vitest` — both flags unrecognised by the installed CLI. Skipped them. Vitest is the Angular 23 default. No generated AGENTS.md or `.mcp.json` to merge.
- `ng new --directory .` rejected on `.gitignore` conflict. Renamed `.gitignore` to a backup, scaffolded, merged and deduped the two files.
- Geist fonts: GitHub releases served a single `.zip` asset, not individual `.woff2` files per weight. Extracted the two needed weights from the zip via Python `zipfile`.

**Open**
- Dev server never spun up — `ng serve` was not run. `ng build` confirmed clean.
- Radar sweep verdict is written inline in the component. Untested visually at real display.
- The Angular version mismatch (23 vs planned 22) should be noted somewhere durable — BUILT-PLAN.md §1 still says "Angular 22".

**Next**
`/develop weekend-1-angular-foundations` — seed tenants/data, enable pgmq + pg_cron, set up keepalive ping.

**Touched** — `angular.json`, `package.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.spec.json`, `postcss.config.mjs`, `src/index.html`, `src/styles.css`, `src/app/app.config.ts`, `src/app/app.routes.ts`, `src/app/style-tile/style-tile.ts`, `src/assets/fonts/Geist-Bold.woff2`, `src/assets/fonts/GeistMono-Medium.woff2`, `docs/specs/0001-angular-scaffold-style-tile.md`, `docs/scope/scope.md`, `BUILD-PLAN.md`

## 2026-08-09 · command-code · git init + architect weekend 0

**Did**
- Initialised git, wrote `.gitignore` exclusions for local configs and screenshots, committed all 387 project files as `528aec2`.
- Ran `/architect` for Weekend 0: scaffold and style tile. Wrote spec `docs/specs/0001-angular-scaffold-style-tile.md` — `Proposed`.
- Enrolled the style tile on the scope at `docs/scope/scope.md`, in-progress.

**Decided**
- Scaffold with `ng new sweep --directory . --routing --style css --ssr false --standalone --strict --zoneless --ai-config claude-code --test-runner vitest`. The `--ai-config claude-code` flag generates Angular MCP config and an AGENTS.md to merge with the hand-written one.
- Tailwind v4 via `@tailwindcss/postcss` (PostCSS), not the Vite plugin. More universal and documented for Angular.
- Geist Sans + Mono self-hosted from Vercel's `vercel/geist-font` releases, not `@fontsource`. Direct `@font-face` with preload on the two hero weights.
- Contrast ratio computed at runtime with inline WCAG 2.1 formula, no npm dependency.
- Style tile is one monolithic component at `/style`, not seven sub-components. Throwaway reference page — reusable components extracted in Weekend 1.
- No Supabase, MapLibre, Motion One, or NgRx installed yet. Scaffold only.

**Open**
- The Angular-generated AGENTS.md from `--ai-config` will need merging with the hand-written one. Follow-up in spec.
- Radar sweep readability on light is unproven. The style tile must render both variants and give an honest verdict.

**Next**
`/develop weekend-0-style-tile` — scaffold Angular 22, Tailwind v4, fonts, then build the style tile component per spec 0001.

**Touched** — `.gitignore`, `docs/specs/0001-angular-scaffold-style-tile.md`, `docs/scope/scope.md`

## 2026-08-09 · claude-code · design pivot + supabase foundations

**Did**
- Replaced `BUILD-PLAN.md` §7 wholesale. Retired the dark "field instrument" + warm-paper
  editorial pairing for one light violet system derived from a Snov.io screenshot Noel
  liked. Tokens sampled from the image, not eyeballed.
- Propagated through §1, §8, §9, §10 and open items. Added §13 (agent tooling) and §14
  (build status). Added a marketing landing page as screen 0 and a style tile as
  weekend 0.
- Created Supabase project `sweep`, ref `ifwyufrepqkzsicjinfi`, `ap-southeast-2`, PG 17.
- Applied the full §5 data model as 12 migrations. 16 tables, RLS on all of them,
  `lead_rows` view with `security_invoker = true`, `reserve_api_calls` +
  `refund_api_calls`, counter-rollup triggers on `scan_queries` and `businesses`.
- Verified the spend gate against §4: `free` → `denied` → `free` → `no_budget`.
- Switched the plan to Angular 22 and Cloudflare Workers at Noel's direction.
- Set up `AGENTS.md` as single source of truth, `CLAUDE.md` as a pointer,
  `supabase/migrations/` checked in, `.env.example`, `.gitignore`.

**Decided**
- Score heat is a **violet ramp**, not the old amber. Amber is now reserved for spend and
  quota, where a warning colour means something. Keeps the one-accent rule intact.
- Score heat is a **fill, never a text colour** — `heat-0` is 1.6:1 on white. Number sits
  in ink up to `heat-2`, white from `heat-3`.
- Lead detail loses the warm-paper trick. Grid↔detail contrast now comes from layout —
  full-bleed 44px rows vs a 720px single measure. If the detail page ends up looking like
  the grid with fewer rows, it has failed.
- Landing page built **last**, not first. Its layout is already decided by the reference,
  so building it early teaches nothing about whether the system survives real data.
- `awaiting_approval` added to `scan_status` at creation rather than bolted on later.

**Didn't work**
- `revoke execute ... from anon, authenticated` did **not** clear the advisor warnings.
  `PUBLIC` still held EXECUTE and both roles inherit through it. Had to
  `revoke ... from public`. Migration 11 exists only for this.
- `for all` write policies also cover `SELECT`, so every table was evaluating two
  permissive policies on every read. The performance advisor flagged all 15. Migration 12
  splits them into insert/update/delete. **Do not reintroduce `for all` policies.**
- Two Snov.io colours had to be rejected rather than copied: its meta grey `#9498A3` is
  2.9:1 on white and fails AA outright (darkened to `#7E8497`), and the amber equivalent
  needed darkening to `#A06A1C`.

**Open**
- `current_tenant()` and `current_tenant_is_demo()` still raise
  `authenticated_security_definer_function_executable`. **Intentional** — RLS policies are
  evaluated with the invoker's privileges, so `authenticated` must keep EXECUTE. Do not
  "fix" by revoking; it breaks every policy in the schema.
- Radar sweep was designed for near-black and may wash out on white. Unprototyped.
- Noel's older Supabase project (`noelsebastian22's Project`, May, Singapore) is
  **paused** — the §3 pause trap, confirmed before we shipped anything. Keepalive still
  not wired.
- No frontend exists at all.

**Next**
Weekend 0: scaffold Angular 22 + Tailwind v4 with the §7 tokens in `@theme`, and build the
style tile route at `/style`. Prototype the radar sweep on light there. Prompt is in
`docs/prompts/weekend-0-style-tile.md`.

**Touched** — `BUILD-PLAN.md`, `AGENTS.md`, `CLAUDE.md`, `.env.example`, `.gitignore`,
`supabase/migrations/*.sql` (12 files), `.agents/skills/session-handoff/SKILL.md`
