# 0002. Weekend 1: Angular foundations (seed data, queues, keepalive, app shell)

**Date**: 2026-08-10
**Status**: Built except AC-4 (keepalive) — 11 Aug 2026, see docs/SESSIONS.md

## Summary

This weekend seeds reference data into the existing Postgres schema, enables the pgmq and pg_cron extensions, sets up the queue infrastructure the engine will use in Weekend 2, and protects the Supabase free plan project from the 7 day idle pause. On the Angular side it adds Supabase auth (email and password), an NgRx SignalStore holding the session and tenant, a shared layout shell, and a placeholder dashboard behind the auth guard. A health check edge function and an UptimeRobot free monitor serve as the keepalive.

## Context

BUILD-PLAN.md §10 defines Weekend 1 as "Foundations": the Supabase backend half shipped before the scaffold (project created, schema applied, RLS on, spend gate tested), and the Angular half now adds the seed data, queue plumbing, keepalive ping, and an app shell with login. Weekend 2 ports the engine; this weekend is the plumbing that makes the port possible.

The key constraint is the Supabase free plan 7 day idle pause (§3). The project at `ifwyufrepqkzsicjinfi` must receive external HTTP requests at least weekly to stay alive. pg_cron firing internally is not reliably counted as activity by Supabase, per BUILD-PLAN.md §3.

The seed data source is `harvest.mjs` at the repo root: 16 trades with optional `google_type` values and 18 Blue Mountains suburbs. Suburb lat/lng coordinates are needed for the map view in Weekend 6; these are filled once at seed time rather than calling the Geocoding API at runtime.

## Requirements

**User stories**:
- As Noel, I want the reference data (trades, suburbs, api_budgets) seeded so the engine can run in Weekend 2.
- As a user, I want to log in with email and password so the app knows who I am.
- As a visitor, I want to click "Try the demo" and explore a read only snapshot without creating an account.

**Acceptance criteria**:
- **AC-1**: pgmq and pg_cron extensions are enabled and the `sweep_search` and `sweep_psi` queues exist. A migration applied via the Supabase MCP creates both.
- **AC-2**: A seed edge function (run once with the service role key) inserts 2 tenants (Noel + demo), the Blue Mountains region, 16 trades from `harvest.mjs`, 18 suburbs with lat/lng, and 2 api_budgets (Places: $0.035/unit, 1000 free, allow_paid=false; PSI: $0/unit, free, allow_paid=true).
- **AC-3**: A `health` edge function at `supabase/functions/health/` returns 200 with `{status: "ok", version: "1"}` and checks Postgres connectivity. Returns 503 if the database is unreachable.
- **AC-4**: An external UptimeRobot free monitor pings the health endpoint every 5 minutes, keeping the Supabase project from being paused after 7 days of inactivity.
- **AC-5**: `@supabase/supabase-js` and `@ngrx/signals` are installed. The Supabase client (`createClient` with the publishable key) is provided in `app.config.ts`.
- **AC-6**: A login page at `/login` shows email and password fields, validates them, and calls `supabase.auth.signInWithPassword`. On success it redirects to `/`. On failure it shows the Supabase error message inline.
- **AC-7**: An auth guard (CanActivateFn) redirects unauthenticated users to `/login`. Protected routes (currently `/` only) sit behind it. The `/style` and `/login` routes are public.
- **AC-8**: An NgRx SignalStore (`AuthStore`) holds session, user, and tenant state. It calls `supabase.auth.getSession()` on initialisation and subscribes to `onAuthStateChange` so the state stays synchronised without polling.
- **AC-9**: A shared layout shell wraps protected pages with a header (app name, user email, sign out button) and a content area. The login page and style tile render without the shell.
- **AC-10**: A placeholder dashboard at `/` shows a welcome message with the user's email and three fixture stat cards (scans run: 0, leads found: 0, free allowance: 1,000). Every number uses `font-variant-numeric: tabular-nums` per the design rules.
- **AC-11**: `ng build` passes with zero errors and zero warnings.
- **AC-12**: `supabase get_advisors` (security and performance) returns no new warnings after the pgmq migration is applied.

## Options considered

### Option 1: Keepalive via UptimeRobot (chosen)

A free UptimeRobot monitor sends an HTTP GET to `/health` every 5 minutes. External, proves real reachability, has a status dashboard, and keeps working even if the repo is untouched for months.

**Pros**:
- Truly external: proves the Supabase project is reachable from the internet, not just internally alive
- Dashboard: an uptime history page is a nice detail for a portfolio demo
- Survives repo inactivity: GitHub Actions stops if nobody pushes for 90 days

**Cons**:
- External dependency: if UptimeRobot goes down, the keepalive stops (though the project stays alive for 7 more days)
- No version control: the monitor config lives in UptimeRobot's UI, not in the repo

### Option 2: Keepalive via GitHub Actions cron

A `.github/workflows/keepalive.yml` with a schedule cron that curls the health endpoint.

**Pros**:
- Lives in the repo, version controlled
- Free, no external account needed beyond GitHub

**Cons**:
- Stops working after 60 days of repo inactivity (GitHub disables scheduled workflows on dormant repos)
- Does not prove external reachability the way an independent monitor does

### Option 3: Keepalive via pg_cron self-ping

A pg_cron job that calls `http_post` to the project's own URL.

**Pros**:
- Fully self contained, no external service

**Cons**:
- Supabase documentation notes that internal pg_cron activity is not reliably counted as project activity
- The trap this is meant to prevent (project pausing) may still fire

## Decision

**Chosen option**: Option 1: Keepalive via UptimeRobot.

The seed data and queue plumbing follow the decisions already locked in BUILD-PLAN.md §4 through §6: two pgmq queues (`sweep_search`, `sweep_psi`), a single `tick` cron at every minute, api_budgets seeded at zero paid allowance, and a demo tenant that cannot spend money.

## Rationale

The keepalive choice turns on reliability under zero maintenance. A portfolio demo sits untouched for months between viewings; it must stay alive with no human checking on it. GitHub Actions disables scheduled workflows on dormant repos after 60 days. pg_cron self-ping is not reliably counted as project activity per Supabase's own documentation. UptimeRobot is the only option that works unattended for arbitrarily long periods and has no dormant repo timeout. The tradeoff (an external account outside version control) is acceptable because the monitor is infrastructure, not application code, and the health endpoint it pings is version controlled.

## Feature design

**Data model sketch**:

No new tables. The existing schema already has `tenants`, `trades`, `regions`, `suburbs`, and `api_budgets`. This weekend populates them.

Migration 13 adds:
- `create extension if not exists pgmq` and `create extension if not exists pg_cron`
- `create extension if not exists pg_net` (the `net.http_post` function used by the tick cron in Weekend 2)
- Two queues: `sweep_search` and `sweep_psi` via `pgmq.create()`
- One pg_cron job: `tick` running `select 1` every minute (the no-op placeholder; Weekend 2 replaces the function body)

Seed edge function inserts into existing tables:

```
tenants (2 rows):
  name: "Noel", is_demo: false
  name: "Demo",  is_demo: true
```

The seed function also creates auth.users rows via `supabase.auth.admin.createUser()` (using the service role key), then inserts matching `profiles` rows:

```
profiles (2 rows):
  id: <Noel auth user id>, tenant_id: <Noel tenant id>, email: <Noel's email>
  id: <Demo auth user id>, tenant_id: <Demo tenant id>, email: "demo@sweep.local"
```

This is critical: without a profiles row, `current_tenant()` returns nothing and every RLS protected query returns zero rows. The profiles row must exist for a login to reach any data.

```
regions:
  name: "Blue Mountains", tenant_id: <Noel tenant id>

trades (16 rows, one per TRADES entry):
  name, google_type (nullable), tenant_id: <Noel tenant id>
  active: true

suburbs (18 rows):
  name, state: "NSW", lat, lng, region_id: <Blue Mountains region id>

api_budgets (per tenant, so 4 rows = 2 tenants × 2 APIs):
  api: "places_text_search", sku: "enterprise", unit_cost_usd: 0.035,
    free_allowance: 1000, allow_paid: false, granted_usd: 0
  api: "psi", sku: "free", unit_cost_usd: 0,
    free_allowance: 25000, allow_paid: true, granted_usd: 0
```

The demo tenant's `api_budgets` rows share the same values but `allow_paid` stays false and `granted_usd` stays 0. RLS blocks writes on the demo tenant, so no code path can spend money regardless of budget settings.

**Queue message shapes (Weekend 2 reference)**:

```
sweep_search message:
  { scan_id: uuid, query_id: bigint, trade_name: string,
    trade_google_type: string | null, suburb: string,
    suburb_lat: float, suburb_lng: float }

sweep_psi message:
  { scan_id: uuid, business_id: uuid, website_url: string }
```

The worker looks up scan config from the `scans` row; messages carry only the identifiers needed to perform one unit of work. This keeps message size small and the queue self documenting.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/health` (edge function) | GET | none | `{status, version}` | none (verify_jwt: false) | 503 if DB unreachable |
| `/seed` (edge function) | POST | none (reads service role key from header) | `{tenants, trades, suburbs, budgets}` counts | service_role only | 409 if already seeded |
| Login page | N/A (client side) | email, password | redirect to `/` or inline error | unauthenticated | invalid credentials, email not confirmed |
| Dashboard page | N/A (client side) | none (reads from AuthStore) | welcome message, 3 fixture stat cards | authenticated | N/A |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Login | user identity (email, id) | `supabase.auth.signInWithPassword` response |
| Login | tenant id | `profiles` table row for the authenticated user, joined on `auth.uid()` |
| AuthGuard | is authenticated | `AuthStore.session` signal (derived from `onAuthStateChange`) |
| Dashboard welcome | user email | `AuthStore.user` signal → `user.email` |
| Dashboard stats | scans run, leads found, free allowance | fixture constants: `0`, `0`, `1000` |
| Health check | status | `SELECT 1` against Postgres (returns "ok" on success, "error" on exception) |

**Key invariants**:
- The seed function is idempotent: running it twice produces no duplicate rows (all table inserts use `on conflict do nothing` against existing unique constraints; `auth.admin.createUser()` checks for existing email before creating)
- The demo tenant's `is_demo = true` flag combined with RLS policies guarantees no write can succeed from a demo session
- The publishable key appears only in `app.config.ts` and `src/environments/`; never in a component or a route

**Security model**:
- `/health` is unauthenticated (deployed with `verify_jwt: false`). It connects to Postgres using the service role key (fetched from `supabase secrets` at function load) to run the liveness query. The key is never exposed in the response
- `/seed` requires the Supabase service role key (passed as an `Authorization: Bearer` header), which is set as a Supabase secret and never enters client code or the repo
- Login uses Supabase Auth with email and password. No anonymous access to protected routes
- The demo user is created via the Supabase admin API (`createUser`) with email `demo@sweep.local` and a password stored as the Supabase secret `DEMO_PASSWORD`. The `Try the demo` button (Weekend 7) will call `signInWithPassword` with these credentials
- RLS policies already scope every table to `current_tenant()`, which is derived from `auth.uid()` via the `profiles` table. No row can be read or written outside the authenticated user's tenant

**Configuration required**:
- `VITE_SUPABASE_URL`: the Supabase project URL (already in `.env` from scaffold)
- `VITE_SUPABASE_ANON_KEY`: the publishable (anon) key (already in `.env`)
- `DEMO_PASSWORD`: the demo user's password, set as a Supabase secret via `supabase secrets set`
- `SERVICE_ROLE_KEY`: the Supabase service role key, set as a Supabase secret (used by the seed function)
- UptimeRobot account with a free HTTP(s) monitor pointed at `<project-url>/functions/v1/health`

**Critical test scenarios** (each maps to an acceptance criterion in ## Requirements):
- Happy path: Login with valid email and password, see the dashboard with welcome message and stat cards, verifies **AC-6**, **AC-10**
- Failure case: Login with wrong password shows inline error, verifies **AC-6**
- Auth/permission: Visiting `/` while unauthenticated redirects to `/login`. Visiting `/style` works without login, verifies **AC-7**
- Infrastructure: `curl <project-url>/functions/v1/health` returns 200 with `{status: "ok"}`, verifies **AC-3**
- Seed: Running the seed function twice produces the same row counts (idempotent), verifies **AC-2**
- Build: `ng build` passes with zero errors and zero warnings, verifies **AC-11**

## Build plan

The build follows a Tracer Bullet approach (the project default from AGENTS.md, confirmed in the scaffold spec): stand up every layer thinly before thickening any. Ordered tasks:

1. Install `@supabase/supabase-js` and `@ngrx/signals`, satisfies **AC-5**
2. Write migration 13: enable pgmq, pg_cron, pg_net extensions; create `sweep_search` and `sweep_psi` queues; schedule tick cron as `select 1` every minute, satisfies **AC-1**, **AC-12**
3. Apply migration 13 via Supabase MCP, run `get_advisors` for security and performance, satisfies **AC-1**, **AC-12**
4. Write and deploy the health edge function at `supabase/functions/health/index.ts` (verify_jwt: false, service role key for Postgres), satisfies **AC-3**
5. Write and deploy the seed edge function: create tenants, region, trades, suburbs, api_budgets, plus create auth users and profiles for Noel and the demo tenant. Run it once, satisfies **AC-2**
6. Set `DEMO_PASSWORD` secret via `supabase secrets set`, satisfies **AC-2**
7. Configure UptimeRobot monitor pointing at the health endpoint, satisfies **AC-4**
8. Create `src/environments/environment.ts` with Supabase URL and publishable key (read from `.env`), satisfies **AC-5**
9. Create the AuthStore (`src/app/stores/auth.store.ts`): SignalStore with `withState`, `withComputed`, `withMethods` holding session/user/tenant, satisfies **AC-8**
10. Create the login page component at `src/app/pages/login/login.ts`, satisfies **AC-6**
11. Create the auth guard at `src/app/guards/auth.guard.ts`, satisfies **AC-7**
12. Create the dashboard page at `src/app/pages/dashboard/dashboard.ts` with fixture stat cards, satisfies **AC-10**
13. Create the shared layout shell component at `src/app/layout/app-layout.ts` with header and content projection, satisfies **AC-9**
14. Wire routes in `app.routes.ts`: `/login` (public), `/style` (public, lazy), `/` (protected by auth guard, dashboard), satisfies **AC-7**, **AC-9**
15. `ng build` to confirm zero errors and zero warnings, satisfies **AC-11**

## Consequences

**Positive**:
- The pgmq and pg_cron plumbing is live, so Weekend 2's engine port drops straight into working queues
- Seed data is in place: the engine can reference real trades and suburbs from day one of the port
- The Supabase project will not pause, eliminating the silent demo death trap
- Auth and the app shell are wired, so every subsequent weekend builds into a working frame rather than wiring auth from scratch each time

**Negative / tradeoffs**:
- The tick cron fires every minute but is a no-op until Weekend 2. This burns ~43,200 edge function invocations per month (~9% of the free allowance) without doing real work. Acceptable because no worker exists yet to set up a conditional schedule, and changing the schedule later is more risky than accepting the burn
- The demo user password is a Supabase secret, not in version control. If the secret is lost, the demo user must be recreated
- Suburb lat/lng coordinates are hand filled once. If a suburb is added later, it must be geocoded manually

**Neutral**:
- Installing `@ngrx/signals` is a new dependency. It is the project standard per AGENTS.md and every data backed feature from Weekend 2 onwards will use it

## Follow-up

- [ ] Suburb lat/lng: the seed function hardcodes approximate coordinates for 18 Blue Mountains suburbs. Verify them against a real map before Weekend 6 (the map view)
- [ ] UptimeRobot monitor URL: document the monitor's public status page URL in BUILD-PLAN.md or the README so it is findable for portfolio demos
- [x] Angular version: resolved 11 Aug 2026 — upgraded the actual install from v20 to v22 rather than editing the doc to match a lower version. BUILD-PLAN.md §1 and AGENTS.md now both say v22, matching `package.json`

## References

**Project sources**:
- `AGENTS.md`: stack, conventions, hard rules
- `BUILD-PLAN.md` §3: free tier operating envelope and the pause trap
- `BUILD-PLAN.md` §4: spend gate, api_budgets seed values
- `BUILD-PLAN.md` §5: data model (reference data tables, scans)
- `BUILD-PLAN.md` §6: queue and worker design, tick cron, message flow
- `BUILD-PLAN.md` §7: design system tokens (applied to dashboard stat cards)
- `BUILD-PLAN.md` §10: build order, Weekend 1 definition
- `BUILD-PLAN.md` §14: current build status
- `harvest.mjs`: TRADES array (16 trades with google_type), SUBURBS array (18 suburbs)
- `supabase/migrations/`: existing 12 migrations confirming the schema is live
- Spec 0001: Angular scaffold and style tile (completed Weekend 0)
