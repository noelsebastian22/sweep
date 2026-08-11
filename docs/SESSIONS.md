# Session log

Shared memory between Claude Code and Command Code. Neither agent can see the other's
conversation; this file is the handoff.

Not a changelog — git covers that. This records **intent, dead ends, and open threads**:
the things that live in a conversation and would otherwise die with it.

Written by the `/session-handoff` skill. Newest entry first. Never edit a past entry; if
it turned out wrong, say so in a new one.

<!-- newest first -->

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
