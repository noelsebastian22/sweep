# AGENTS.md — Sweep

Project memory for coding agents. Loaded automatically by Command Code and Claude Code.
This is the **single source of truth**; `CLAUDE.md` only points here. Do not duplicate
instructions across both files.

## What this is

Sweep is a lead-prospecting tool for local trade businesses in the Blue Mountains, NSW. It
productises a standalone script (`harvest.mjs`, repo root) into an application: define a
scan, watch it run, triage the results, act on them.

It has two jobs. It is a tool Noel uses weekly, and it is the portfolio piece that proves
he builds applications rather than brochure sites. Both matter — code that works but looks
generic has only done half the job.

**Read `BUILD-PLAN.md` before starting any substantial work.** It contains the reasoning
behind every decision below. Its locked decisions are not open for re-litigation by an
agent mid-task; if one looks wrong, say so and stop rather than quietly doing something
else.

## Session protocol — read this first

This project is worked on from **two agents**, Claude Code and Command Code, and neither
can see the other's conversation. `docs/SESSIONS.md` is the only shared memory between
them.

**At the start of every session:** run `/session-handoff start`. It reads the newest log
entry, checks it against `git log`, and reports where things actually stand. Do this
before proposing work — the log routinely contains a dead end that would otherwise be
walked into again.

**Before finishing every session:** run `/session-handoff`. It writes a new entry
covering what was done, what was decided, **what didn't work**, what's open, and what's
next, then updates `BUILD-PLAN.md` §14 and commits.

The skill lives at `.agents/skills/session-handoff/` — Command Code discovers that path
natively, and `.claude/skills/session-handoff` is a symlink to the same directory, so
there is one copy and it cannot drift.

If the user ends a session without asking, offer the handoff rather than skipping it. An
unlogged session is invisible to the other agent.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Angular 22, standalone, zoneless, signals throughout |
| Forms | **Signal Forms** (stable in 22). Not reactive forms |
| Data loading | `resource()` / `httpResource()` for read-once; NgRx SignalStore for long-lived shared state |
| A11y primitives | **Angular Aria** (stable in 22) for palette, comboboxes, sliders |
| Styling | Tailwind v4, tokens in `@theme` — see `BUILD-PLAN.md` §7 |
| Backend | Supabase only — Postgres, Auth, Realtime, Edge Functions (Deno), pgmq, pg_cron |
| Maps | MapLibre GL JS, light low-chroma basemap, no API token |
| Motion | Motion One + router `withViewTransitions()` |
| Hosting | Cloudflare Workers with static assets (`wrangler deploy`). Not Pages |

No RxJS beyond what the Supabase client forces. No NgRx classic. No second backend
service.

## Supabase

Project `sweep`, ref `ifwyufrepqkzsicjinfi`, region `ap-southeast-2`, Postgres 17.
Schema is fully applied — 17 tables, RLS on all of them, plus the `lead_rows` view.

- Schema lives in `supabase/migrations/`, 20 files, matching the remote ledger exactly.
  **Check `list_migrations` before naming a new file** — the remote assigns the version
  timestamp, and three sessions running have had to rename local files to match it
- **Schema changes are migrations. Never edit through the dashboard.** Both agents can
  apply migrations through the Supabase MCP
- **Run `get_advisors` (security *and* performance) after any DDL.** It catches missing
  RLS and policy overlap that no test will. Migrations 11 and 12 exist only because it did
- Four security warnings are known and intentional. `current_tenant()` and
  `current_tenant_is_demo()` are executable by `authenticated`, because RLS policies are
  evaluated with the invoker's privileges — do not "fix" these by revoking, it breaks every
  policy in the schema. `approve_spend()` and `cancel_scan()` are `security definer` and
  callable by `authenticated` because they *are* the user actions; both re-derive the tenant
  from the JWT rather than taking it as a parameter, so neither can be aimed at another
  tenant
- **The browser cannot write `api_budgets`, `spend_grants` or `api_calls`** (migration 20).
  It could until 13 Aug — `update api_budgets set allow_paid = true, granted_usd = 99999`
  succeeded under the generic write policy migration 10 handed every tenant-scoped table,
  which meant the client could raise its own paid allowance and walk straight past hard rule
  1. All three now have read policies only. The single way `granted_usd` ever rises is
  `approve_spend(api, sku, calls, scan, note)`, whose caps (1,000 calls and $35 per grant,
  $50 a month) are constants in the function body precisely so that moving them needs a
  migration. `businesses`, `psi_results`, `site_snapshots`, `trades`, `regions` and
  `suburbs` are engine- or seed-owned and lost their write policies at the same time. The
  only writes a user JWT still performs are `leads.update`, `lead_events.insert`,
  `scans.insert`/`update`, `scan_queries.insert` and `scoring_profiles.*`
- **The browser client is composed, not the umbrella package.** `@supabase/supabase-js` is
  deliberately *not* a dependency. `core/supabase.service.ts` builds the client from
  `@supabase/auth-js` + `@supabase/postgrest-js` and exports `auth` and `db`; import those,
  never a `supabase` object. The umbrella package constructs storage, realtime and iceberg
  clients in its constructor, so none of them tree-shake — it put ~98 kB of never-executed
  code in the initial bundle. Two details in that file are load-bearing and must not drift:
  the localStorage `storageKey` has to stay `sb-<project-ref>-auth-token` (change its shape
  and every signed-in browser silently signs out, with no error), and the `Authorization`
  bearer must fall back to the publishable key when there is no session
- **Realtime is done, in `features/scans/realtime.ts`.** It dynamic-`import()`s
  `@supabase/realtime-js` so the socket and its phoenix dependency land in the `/scans/:id`
  route chunk (58 kB) and never in `main` — verified by grepping the built bundle, not
  assumed. The `RealtimeClient` import at the top of that file is `import type` on purpose;
  making it a value import silently undoes the whole bundle cut. It also calls `setAuth()`
  from `onAuthStateChange`, which is wiring the umbrella package used to do: realtime holds
  its own copy of the JWT, and a stale one means RLS filters out every payload while the
  channel still reports a healthy `SUBSCRIBED`. **Realtime replays nothing** — the store
  treats every `SUBSCRIBED` as a resync and re-reads `scan_events` after its last seen id,
  which is why that log is a table and not just a stream
- `supabase_realtime` publishes `scans` (with `replica identity full`) and `scan_events`.
  It contained **zero tables** until migration 19, so any subscription before that connected
  successfully and then delivered nothing forever — it looks exactly like a client bug
- **The `tick` cron job authenticates via a Vault secret, not a committed value.** It reads
  the service role key back with `select decrypted_secret from vault.decrypted_secrets
  where name = 'service_role_key'` (migration 16). That secret is created once, by hand,
  directly against the database — `select vault.create_secret(<the actual key>,
  'service_role_key')` — and is **never** run through an agent, a migration file, or a
  chat message; the raw key must never enter a tool call or a transcript. If a fresh
  Supabase project is ever restored from a backup, this step has to be redone manually or
  `tick` silently stops authenticating (the cron job still fires, it just gets a 401)

## Hard rules

These are the ones that cost real money or leak real data if broken.

1. **Never call a metered API without `reserve_api_calls()` returning `free` or `paid`
   first.** Not in a script, not in a test, not "just to check it works". Google Places
   Text Search is billed at Enterprise tier: $35/1,000 calls, 1,000 free per month. A full
   scan is 288 calls. See `BUILD-PLAN.md` §2 and §4.
   Since migration 18 the reservation returns `(grant_kind, call_id)` and writes its own
   `api_calls` row in the same transaction, so the counter and the ledger cannot diverge.
   Hand a reservation back with `refund_api_call(call_id)`, never by decrementing `used`.
   The invariant, and it should stay true:
   `api_budgets.used = sum(api_calls.units) where refunded_at is null`
2. **When a reservation returns `denied`, park — do not fail and do not retry.** Leave the
   queue message unarchived, set the scan to `awaiting_approval`, exit cleanly.
   A parked scan now *stays* parked: `index.ts` checks `budget_headroom()` before leaving
   `awaiting_approval` and only resumes once a grant has created real room. It used to flip
   back to `searching` on every tick, so a blocked scan looped park → resume → deny → park
   once a minute and the state never meant anything. Because tick picks strictly the oldest
   active scan, a parked one blocks everything behind it until it is funded or
   `cancel_scan()`-ed — that is deliberate, and it is why cancelling had to exist.
3. **The service role key never enters the browser bundle, the repo, or a log line.** Edge
   functions only. Client code uses the publishable key.
4. **Never store raw PageSpeed JSON.** A single response is ~600 KB against a 500 MB free
   tier. Extract the metrics and the `final-screenshot` audit, discard the rest.
5. **`shared/scoring/score.ts` stays pure and dependency-free.** No framework imports, no
   I/O. It is shared by the grid, map, detail page and scoring lab, and it is unit tested
   to death.
6. **There is no `score` column in the database, and there must never be one.** Score is
   derived client-side from `rating`, `rating_count`, `website_kind` and the latest PSI
   score. Persisting it would kill the scoring lab.

## Design rules

Full system in `BUILD-PLAN.md` §7. The short version, because these are the ones agents
break:

- One accent: violet `#6F58E3`. Warn/fail/ok are semantic only. Nothing else is coloured
- Radius `10px` default, `6px` small controls. No `rounded-3xl`
- Elevation is a hairline, not a shadow. One shadow token, overlays only
- **Every number is mono with `font-variant-numeric: tabular-nums`.** Non-negotiable
- Table rows are 44px, hairline separated, never boxed cards
- Banned: fade-up-on-scroll, gradient text, skeleton shimmer, glassmorphism, mesh gradient
  blobs, decorative animation of any kind

The palette is a common one — light, violet, rounded is what every UI generator produces
by default. Density and mono numerics are what stop this looking generated. If a screen
starts drifting toward padded cards and 72px rows, that is the failure mode.

## Conventions

- Australian English in user-facing copy (`organise`, `colour`, `centre`). Code
  identifiers stay US-spelled where a library forces it
- Real numbers over placeholder copy. If a component shows a stat, wire it to real data or
  a realistic fixture — never `Lorem` or `1,234`
- Prefer deleting to commenting out
- Commit messages: imperative, lowercase, no scope prefixes

## Commands

```bash
npm start                 # ng serve
npm run build             # production build
npm test                  # unit tests — score.ts especially
npx wrangler deploy       # ship to Cloudflare Workers
supabase migration new x  # new migration; never edit an applied one
```

## Environment

Copy `.env.example` to `.env`. Never commit `.env`.

The publishable key is safe in client code — RLS is what protects the data, not the key.
The service role key and the Google API keys are edge-function secrets, set with
`supabase secrets set`, and must not appear anywhere else.

## Where things live

| Path | What |
|---|---|
| `BUILD-PLAN.md` | The reasoning behind every decision. §14 is current build status |
| `docs/SESSIONS.md` | Shared session log — see the session protocol above |
| `docs/prompts/` | Reusable task prompts, one per weekend in §10 |
| `supabase/migrations/` | 18 migrations, matching the remote ledger exactly |
| `.agents/skills/` | Shared skills. Symlinked into `.claude/skills/` |
| `.commandcode/taste/` | Command Code's learned conventions. **Committed on purpose** |

## Current state

Weekends 0–4 are built. Backend is done and proven against real scans: schema applied, RLS
on, spend gate tested and now locked down, `tick` + `scan-create` deployed, the engine has
run 288 queries end to end and genuinely parks and resumes when the allowance runs out. On
the frontend the style tile, app shell, auth, dashboard, the leads grid at `/leads`, the
scan builder at `/scans/new` and the live scan screen at `/scans/:id` all exist.

The app is usable end to end for the first time: pick trades and suburbs, watch the scan
run, approve spend when it parks, triage the leads it produces.

Next up: weekend 5 — lead detail as a 720px document, with the PSI breakdown and the
screenshots already sitting in the PSI payload. Then map + lab, and the landing page last.

See `BUILD-PLAN.md` §14 for detailed status, and `docs/SESSIONS.md` for what the last
session left open.
