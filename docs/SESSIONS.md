# Session log

Shared memory between Claude Code and Command Code. Neither agent can see the other's
conversation; this file is the handoff.

Not a changelog — git covers that. This records **intent, dead ends, and open threads**:
the things that live in a conversation and would otherwise die with it.

Written by the `/session-handoff` skill. Newest entry first. Never edit a past entry; if
it turned out wrong, say so in a new one.

<!-- newest first -->

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
