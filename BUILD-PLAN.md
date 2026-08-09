# Sweep — Build Plan

A lead-prospecting tool for local trade businesses. Productises `prospecting/harvest.mjs`
into a real application: define a scan, watch it run, triage the results, act on them.

Two jobs at once — a tool Noel actually uses weekly, and the portfolio piece that proves
he builds applications, not just brochure sites.

Written 9 Aug 2026.

---

## 1. Decisions — locked

| Area | Decision |
|---|---|
| **Name** | Sweep |
| **Frontend** | **Angular 22** (released 3 Jun 2026), standalone components, **zoneless**, signals throughout. Signal Forms and the Resource APIs are stable in 22 and are used in preference to reactive forms and hand-rolled loaders |
| **State** | NgRx SignalStore for scan + leads stores. No NgRx classic, no RxJS-heavy patterns |
| **Styling** | Tailwind v4 with a design-token layer in `@theme` |
| **Backend** | Supabase only — Postgres, Auth, Realtime, Edge Functions, Queues (pgmq), pg_cron |
| **Maps** | MapLibre GL JS (no API token required) with a light, low-chroma basemap |
| **Motion** | Motion One + Angular router view transitions |
| **Hosting** | **Cloudflare Workers with static assets** — not Pages. Cloudflare's own guidance since Workers gained native asset serving is to start new projects on Workers; Pages still works but all new investment goes to Workers. One `wrangler deploy`, no second backend service |
| **Tooling** | Claude Code and **Command Code** are both used. `AGENTS.md` at the repo root is the single source of truth for both; `CLAUDE.md` only points at it. See §13 |
| **Art direction** | **Revised 9 Aug.** One light system across the whole app — white surfaces, indigo ink, single violet accent, soft 10px radii, heavy tight display type. Derived from the Snov.io reference. Density and mono tabular numerics carry the craft. See §7 |
| **Public site** | A marketing landing page at `/` in the same system, ahead of the login wall. Not in the original plan; added because the reference is a marketing page and it doubles as the portfolio entry point |
| **Cost posture** | **Free tier only by default.** No code path may call a metered API without an explicit, recorded spend grant. Default `granted_usd` is zero |
| **Demo** | Real app behind login. A "Try the demo" button drops visitors into a read-only demo tenant holding a fictionalised snapshot. One codebase, `tenants.is_demo` flag |
| **v1 scope** | Scan builder · Live scan · Leads grid · Map · Lead detail · Scoring lab · ⌘K palette |
| **Explicitly out of v1** | Outreach sequences, email sending, multi-user teams, billing, kanban pipeline |

### Why Supabase-only and not a NestJS service

The decisive argument is that **incremental job state is required regardless**. The live
scan screen is the hero feature, and it can only show progress if the backend writes
per-query state to Postgres as it goes. A single long-running process on Render would
need that same restructure — it just wouldn't get resumability or the Realtime feed in
return.

Supporting reasons:

- `harvest.mjs` is pure `fetch` with zero npm dependencies. No `fs`, no Node built-ins.
  It ports to Deno almost verbatim.
- A queue solves a problem the script already works around. The current code shuffles
  query order so that a mid-run quota exhaustion still samples every trade evenly
  (`harvest.mjs`, the shuffle block). With a queue, a partial run simply resumes. The
  shuffle hack is deleted.
- One platform, one deploy pipeline, no $7/mo Render floor.

Cost: the restructure from "one script with concurrency pools" into a job state machine,
and harder debugging of a distributed queue than a `console.log` loop.

---

## 2. Cost reality — read this before writing code

**The field mask in `harvest.mjs` is billed at Enterprise tier, not Pro.** The code
comment says Pro, which is wrong. `nationalPhoneNumber`, `websiteUri`, `rating` and
`userRatingCount` are all Enterprise-tier fields, and billing is set by the highest tier
any requested field belongs to.

| | Rate | Free monthly |
|---|---|---|
| Text Search **Pro** | $32 / 1,000 calls | 5,000 calls |
| Text Search **Enterprise** ← what Sweep uses | $35 / 1,000 calls | **1,000 calls** |

A full 16 trades × 18 suburbs scan is **288 calls ≈ $10.08**, and the free tier covers
roughly **three full scans per month**.

That is not a blocker — a single call returns up to 20 businesses, so the cost lands at
about $0.007 per business discovered. But it drives three product decisions:

1. **The scan builder must show a live cost estimate before you press run.** Query count
   × $0.035, plus remaining free-tier allowance. This is an honest feature and it demos
   extremely well.
2. **Never re-scan blindly.** Dedupe against `businesses` before enqueueing, and default
   the scan builder to trades/suburbs not covered in the last 30 days.
3. **Track spend in the app.** `api_calls` for the per-call log and `api_budgets` for the
   running totals, both surfaced on the dashboard. A tool that
   knows what it costs to run reads as professionally built.

PageSpeed Insights is free with an API key and generously rate-limited; a concurrency of
4 stays well inside it. Verify the current per-minute cap in the Google Cloud console
before raising concurrency.

**Also worth doing:** the current field mask fetches Enterprise fields for *every* result
including the landmarks and cafés that `isTradeBusiness()` then throws away. `types`,
`primaryType` and `businessStatus` are cheaper-tier fields. Worth measuring whether a
two-pass approach (cheap search to filter, then enrich survivors) actually saves money —
it may not, since billing is per call rather than per place returned.

---

## 3. Free-tier operating envelope

Sweep is designed to run at **$0/month indefinitely**. Every limit below is a design
input, not a footnote.

| Service | Free tier | Design response |
|---|---|---|
| Places Text Search Enterprise | **1,000 calls/month** | The spend gate (§4). ≈3 full scans free per month |
| PageSpeed Insights | Free, rate-limited | Costs nothing. Concurrency stays at 4 |
| Supabase database | 500 MB | **Never store raw PSI JSON** — a single response is ~600 KB. Extract metrics only |
| Supabase Edge Functions | 500K invocations/month, **150s wall clock** | Budget guard set to 120s, not 330s. One `tick` cron that early-exits when idle ≈ 43,200 calls/month |
| Supabase Storage | 1 GB | Screenshots downscaled to WebP thumbnails before storing |
| Supabase projects | 2 per organisation | Sweep uses one. The demo shares it via `tenants.is_demo` |
| Supabase project pausing | **Paused after 7 days of no activity** | Keepalive required — see below |
| Cloudflare Workers | 100K requests/day, static assets unmetered | Frontend + the whole deploy |
| MapLibre basemap | — | OpenFreeMap or CARTO free tier. No token, no account |

### Free screenshots — solved, at zero cost

The PageSpeed response already contains the screenshots. The Lighthouse `audits` object
includes `final-screenshot`, `screenshot-thumbnails` and `full-page-screenshot`, all as
embedded base64 — and they are already in the responses `harvest.mjs` fetches today, since
it requests the performance category.

So there is no screenshot service to buy, no Playwright to host, and no extra API call.
Extract `final-screenshot`, downscale to WebP, push to Storage, discard the rest of the
payload. This also solves the 500 MB database concern in the same move.

### The pause trap — the one that would silently kill the demo

Supabase pauses Free Plan projects after **7 days with no API requests, database queries
or Edge Function invocations**. Postgres is stopped outright; data survives but is
inaccessible until manually restored.

For a tool Noel uses weekly this is invisible. For a portfolio demo it is fatal — and it
would be discovered by a prospective client clicking a dead link, not by him.

`pg_cron` firing internally is not reliably counted as activity. The fix is an external
HTTP request at least weekly:

- A free uptime monitor (UptimeRobot and similar) pinging a `health` edge function, or
- A GitHub Actions cron `curl`, or
- A Cowork scheduled task

Set this up in weekend 1, not at launch. It costs ten minutes and it protects everything
else.

---

## 4. The spend gate

The rule: **no code path calls a metered API without a grant.** Defaults are
`allow_paid = false` and `granted_usd = 0`, so the system cannot spend money on day one
even if every other safeguard fails.

This is also one of the better portfolio features in the app. "It will not spend your
money without asking" is a real engineering concern, and showing it working reads as
maturity rather than decoration.

### Budget ledger

```sql
create table api_budgets (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants on delete cascade,
  api            text not null,           -- places_text_search | psi
  sku            text not null,           -- enterprise | free
  unit_cost_usd  numeric(10,5) not null default 0,
  free_allowance int not null default 0,  -- calls per period
  period_start   date not null default date_trunc('month', now())::date,
  used           int not null default 0,
  allow_paid     boolean not null default false,
  granted_usd    numeric(8,2) not null default 0,
  spent_usd      numeric(8,2) not null default 0,
  unique (tenant_id, api, sku)
);

create table spend_grants (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants on delete cascade,
  scan_id     uuid references scans on delete set null,
  api         text not null,
  calls       int not null,
  amount_usd  numeric(8,2) not null,
  approved_by uuid references auth.users,
  approved_at timestamptz not null default now(),
  note        text
);
```

Seed for Places: `unit_cost_usd = 0.035`, `free_allowance = 1000`, `allow_paid = false`.
Seed for PSI: `unit_cost_usd = 0`, `allow_paid = true` — it is genuinely free, so it needs
tracking but not gating.

`spend_grants` is an append-only audit log. Every cent the app has ever been authorised to
spend has a row, with who approved it and when.

### Atomic reservation

Reservation happens **before** the call, inside a row lock, so concurrency 5 cannot race
past the allowance.

```sql
create or replace function reserve_api_calls(
  p_tenant uuid, p_api text, p_sku text, p_n int
) returns text
language plpgsql security definer as $$
declare b api_budgets%rowtype;
begin
  select * into b from api_budgets
    where tenant_id = p_tenant and api = p_api and sku = p_sku
    for update;
  if not found then return 'no_budget'; end if;

  if date_trunc('month', now())::date > b.period_start then
    update api_budgets
       set used = 0, spent_usd = 0,
           period_start = date_trunc('month', now())::date
     where id = b.id returning * into b;
  end if;

  if b.used + p_n <= b.free_allowance then
    update api_budgets set used = used + p_n where id = b.id;
    return 'free';
  end if;

  if b.allow_paid
     and b.spent_usd + (p_n * b.unit_cost_usd) <= b.granted_usd then
    update api_budgets
       set used = used + p_n,
           spent_usd = spent_usd + (p_n * b.unit_cost_usd)
     where id = b.id;
    return 'paid';
  end if;

  return 'denied';
end $$;
```

Returns `free` · `paid` · `denied` · `no_budget`.

A companion `refund_api_calls()` decrements on responses Google does not bill — the 4xx
paths that `textSearch()` already handles. Reserve pessimistically, refund on failure.

### Park, don't fail

When a reservation is denied the worker **does not archive the queue message**. The job
stays queued, the scan moves to `awaiting_approval`, and the worker exits cleanly.

```ts
const grant = await rpc('reserve_api_calls', { p_n: 1, ... });
if (grant === 'denied') {
  await parkScan(scanId, 'awaiting_approval');
  return;                    // message unarchived — resumes on approval or next month
}
```

Add `awaiting_approval` to the `scan_status` enum.

Nothing is lost. Approve the spend and the queue drains from exactly where it stopped;
approve nothing and it resumes on the 1st when the allowance resets.

### What the user sees

The live scan screen shows the pause as a first-class state, not an error:

> **Scan paused — free tier exhausted**
> 143 of 288 queries complete. 1,000 / 1,000 free calls used this month.
> The remaining 145 queries would cost **$5.08**.
> `[ Approve $5.08 ]`  `[ Resume 1 September ]`

Approving writes a `spend_grants` row and raises `granted_usd`. The cron picks the scan up
within a minute.

### Scan builder preflight

Before a scan is ever created, the builder shows the arithmetic live as trades and suburbs
are selected:

```
16 trades × 18 suburbs   =  288 queries
Free calls remaining      =  412
Billable                  =    0        ✓ fits within free tier
```

Or, when it doesn't fit:

```
16 trades × 18 suburbs   =  288 queries
Free calls remaining      =  100
Billable                  =  188  →  $6.58   ⚠ requires approval
```

With a **"Fit to free tier"** button that trims the selection to the free remainder,
prioritising trade × suburb pairs not covered in the last 30 days. This is the button that
makes the whole posture usable rather than annoying.

### The demo can never spend

The demo tenant carries `allow_paid = false`, `granted_usd = 0`, and RLS blocks writes
outright. Even if a visitor found a way to trigger `scan-create`, the first reservation
returns `denied` and the scan parks. There is no path from a public visitor to Noel's
credit card.

---

## 5. Data model

Postgres, all tables tenant-scoped with RLS. Full DDL below is the intended v1 shape.

```sql
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now()
);

create table profiles (
  id          uuid primary key references auth.users on delete cascade,
  tenant_id   uuid not null references tenants on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now()
);
```

### Reference data

```sql
create table trades (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants on delete cascade,
  name         text not null,
  google_type  text,                    -- null where Google has no matching type
  active       boolean not null default true,
  unique (tenant_id, name)
);

create table regions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants on delete cascade,
  name       text not null,
  unique (tenant_id, name)
);

create table suburbs (
  id         uuid primary key default gen_random_uuid(),
  region_id  uuid not null references regions on delete cascade,
  name       text not null,
  state      text not null default 'NSW',
  lat        double precision,
  lng        double precision,
  unique (region_id, name)
);
```

Seed `trades` from the `TRADES` array and `suburbs` from `SUBURBS` in `harvest.mjs`.
Suburb lat/lng is needed for the map view — geocode once at seed time, not per scan.

### Scans

```sql
create type scan_status as enum
  ('queued','searching','measuring','completed','partial','failed');

create table scans (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants on delete cascade,
  region_id          uuid not null references regions,
  status             scan_status not null default 'queued',
  config             jsonb not null default '{}',   -- trade ids, suburb ids, top_n
  total_queries      int not null default 0,
  completed_queries  int not null default 0,
  failed_queries     int not null default 0,
  businesses_found   int not null default 0,
  psi_total          int not null default 0,
  psi_completed      int not null default 0,
  quota_hit          boolean not null default false,
  estimated_cost_usd numeric(8,2),
  started_at         timestamptz,
  finished_at        timestamptz,
  created_at         timestamptz not null default now()
);

create table scan_queries (
  id            bigserial primary key,
  scan_id       uuid not null references scans on delete cascade,
  trade_id      uuid not null references trades,
  suburb_id     uuid not null references suburbs,
  status        text not null default 'pending',  -- pending|running|done|failed
  http_status   int,
  results_count int,
  error         text,
  completed_at  timestamptz,
  unique (scan_id, trade_id, suburb_id)
);
create index on scan_queries (scan_id, status);
```

`scan_queries` is the spine of the live scan screen — 288 rows per scan, each flipping
`pending → running → done`. A Postgres trigger rolls the counts up onto `scans` so the
client subscribes to a single row for the progress counter rather than 288.

### Businesses and measurements

```sql
create table businesses (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants on delete cascade,
  google_place_id     text not null,
  name                text not null,
  name_norm           text not null,        -- the norm() fn from harvest.mjs
  trade_id            uuid references trades,
  suburb_id           uuid references suburbs,
  phone               text,
  website_url         text,
  website_kind        text,                 -- none | social | site
  address             text,
  lat                 double precision,
  lng                 double precision,
  rating              numeric(2,1),
  rating_count        int,
  primary_type        text,
  types               text[],
  business_status     text,
  first_seen_scan_id  uuid references scans,
  last_seen_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  unique (tenant_id, google_place_id)
);
create index on businesses (tenant_id, name_norm);

create table psi_results (
  id          bigserial primary key,
  business_id uuid not null references businesses on delete cascade,
  scan_id     uuid references scans on delete set null,
  strategy    text not null default 'mobile',
  score       int,
  lcp_ms      int,
  cls         numeric(4,3),
  tbt_ms      int,
  fcp_ms      int,
  si_ms       int,
  error       text,
  checked_at  timestamptz not null default now()
);
create index on psi_results (business_id, checked_at desc);
```

`psi_results` keeps history rather than overwriting a column. This gives the lead detail
page a "their site got slower since March" chart for free, which is a genuinely strong
outreach hook.

Note the extra metrics — `lcp_ms`, `cls`, `tbt_ms`. The current script throws away
everything except the composite score. Capture them; the detail page needs the breakdown
and it costs nothing extra since the API already returns them.

### Leads and scoring

```sql
create type lead_status as enum
  ('identified','shortlisted','mockup_built','contacted','replied','won','lost','rejected');

create table leads (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants on delete cascade,
  business_id uuid not null references businesses on delete cascade,
  status      lead_status not null default 'identified',
  notes       text,
  updated_at  timestamptz not null default now(),
  unique (tenant_id, business_id)
);

create table lead_events (
  id         bigserial primary key,
  lead_id    uuid not null references leads on delete cascade,
  type       text not null,          -- status_change | note | mockup_built | psi_rechecked
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table scoring_profiles (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants on delete cascade,
  name       text not null,
  weights    jsonb not null,
  is_default boolean not null default false
);

create table site_snapshots (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses on delete cascade,
  storage_path text not null,
  viewport    text not null default 'mobile',
  captured_at timestamptz not null default now()
);

create table api_calls (
  id          bigserial primary key,
  tenant_id   uuid references tenants,
  scan_id     uuid references scans on delete set null,
  api         text not null,        -- places_text_search | psi
  sku         text,
  grant_kind  text,                 -- free | paid
  cost_usd    numeric(10,5) not null default 0,
  http_status int,
  called_at   timestamptz not null default now()
);
create index on api_calls (tenant_id, called_at desc);
```

`api_calls` is the per-call log for the dashboard and for reconciling against Google's own
billing. The running totals that the spend gate reads live on `api_budgets` (§4) — this
table is history, that one is state.

### The single most important schema decision

**There is no `score` column.** Score is computed on the client from the raw inputs —
`rating`, `rating_count`, `website_kind`, latest `psi_score`.

This is what makes the scoring lab instant. Drag a penalty slider, a `computed()` signal
re-derives 2,000 scores and the grid re-sorts in the same frame, with no round trip. If
the score were persisted, every slider change would be a database write and the feature
would be dead on arrival.

The current `penalty()` function becomes a config object:

```ts
interface ScoringWeights {
  noWebsite: number;      // 1.0
  socialOnly: number;     // 0.9
  psiUnmeasured: number;  // 0.5
  psiPoor: number;        // 0.5   applied below poorThreshold
  psiMedium: number;      // 0.2   applied below mediumThreshold
  psiGood: number;        // 0.0
  poorThreshold: number;  // 40
  mediumThreshold: number;// 70
}
```

### Grid view

```sql
create view lead_rows as
select
  l.id as lead_id, l.status, l.tenant_id, l.updated_at,
  b.id as business_id, b.name, b.phone, b.website_url, b.website_kind,
  b.rating, b.rating_count, b.lat, b.lng,
  t.name as trade, s.name as suburb,
  p.score as psi_score, p.lcp_ms, p.cls, p.checked_at as psi_checked_at
from leads l
join businesses b on b.id = l.business_id
left join trades t on t.id = b.trade_id
left join suburbs s on s.id = b.suburb_id
left join lateral (
  select * from psi_results r
  where r.business_id = b.id and r.error is null
  order by r.checked_at desc limit 1
) p on true;
```

### RLS

Every table: `tenant_id = (select tenant_id from profiles where id = auth.uid())`.

Demo tenant additionally blocks all writes:

```sql
create policy leads_write on leads for all
  using (tenant_id = current_tenant())
  with check (
    tenant_id = current_tenant()
    and not (select is_demo from tenants where id = tenant_id)
  );
```

The demo user is a real `auth.users` row created at seed time. "Try the demo" performs a
silent `signInWithPassword` against that account — no anonymous-auth complexity, and the
whole app works unmodified.

---

## 6. Queue and worker design

Two pgmq queues: `sweep_search` and `sweep_psi`.

### Edge functions

| Function | Trigger | Job |
|---|---|---|
| `scan-create` | HTTP from app | Insert `scans` row, expand trades × suburbs into `scan_queries`, `pgmq.send_batch` to `sweep_search`, return scan id immediately |
| `worker-search` | pg_cron, every minute | Drain `sweep_search`, call Places, upsert `businesses`, update `scan_queries` |
| `worker-psi` | pg_cron, every minute | Drain `sweep_psi`, call PageSpeed, insert `psi_results` |
| `scan-advance` | pg_cron, every minute | State machine: when searches finish, compute the ceiling cutoff and enqueue PSI jobs; when PSI finishes, create `leads` rows and mark the scan complete |
| `capture-snapshot` | queue, optional | Screenshot a prospect's current site into Storage |

### The time guard

This is the pattern that makes the whole thing work within Edge Function limits.

**On the free plan the wall clock is 150s, not 400s** — 400s is the Pro-plan ceiling for
background work. `EdgeRuntime.waitUntil()` prevents early shutdown but does **not** extend
either ceiling. Sweep targets the free number.

```ts
const DEADLINE = Date.now() + 120_000;   // 30s headroom under the 150s free-plan limit

async function drain(queue: string, concurrency: number, handle: Handler) {
  while (Date.now() < DEADLINE) {
    const msgs = await pgmqRead(queue, { vt: 120, qty: concurrency * 3 });
    if (!msgs.length) break;
    await pool(msgs, concurrency, async (m) => {
      try {
        await handle(m.message);
        await pgmqArchive(queue, m.msg_id);
      } catch (e) {
        // leave unarchived — visibility timeout returns it to the queue
      }
    });
  }
}
```

Concurrency matches the current script: **5 for search, 4 for PSI**.

Throughput check for the worst stage: PSI at ~10s per check, concurrency 4, 120s budget
→ roughly 45 checks per invocation. A typical scan needs ~100, so it completes across
2–3 cron ticks — about three minutes. Acceptable, and the live scan screen makes the wait
legible rather than dead time.

`pool()` from `harvest.mjs` carries over unchanged.

### Invocation budget

500K edge invocations/month sounds generous but a naive minute-cron across four functions
burns ~173K doing nothing. Instead: **a single `tick` function on cron** that queries for
an active scan and returns immediately if there is none. One function, 43,200 invocations
a month, ~9% of the free allowance.

### The spend gate sits here

Every worker calls `reserve_api_calls()` before touching a metered endpoint (§4). A
`denied` result parks the scan and leaves the message queued. This replaces the shuffle
workaround in the current script entirely — a run that stops mid-way simply resumes.

### Porting `harvest.mjs` to Deno

The script is pure `fetch` with no npm dependencies, so the port is mechanical:

| Change | From | To |
|---|---|---|
| Env | `process.env.X` | `Deno.env.get('X')` |
| Entry | top-level script | `Deno.serve(handler)` |
| Output | `console.table` | delete — the UI is the output |
| Notion writes | `createRow()` | replaced by Postgres upserts (keep Notion as an optional sync later) |
| Concurrency | `pool()` | unchanged |
| Sleep | `sleep()` | unchanged |

Logic to preserve verbatim, because it is the genuinely hard-won part:

- `BLOCKED_TYPES` — the landmark/café rejection set
- `isTradeBusiness()` — operational + has phone + not blocked
- `TYPE_TO_TRADE` / `trueTrade()` — Google's classification beats the search term
- `norm()` — dedupe normalisation
- The `ceiling()` cutoff that avoids spending PSI calls on candidates that can't reach
  the top N
- The 400-with-type → untyped retry fallback in `textSearch()`
- The two-attempt PSI retry with the 4xx early exit

---

## 7. Design system

**Revised 9 Aug 2026.** The original dark "field instrument" / warm-paper editorial pairing
is retired. Sweep now uses **one light violet system** across every surface, derived from
the Snov.io reference: white page, deep-indigo ink, a single violet accent, generous
whitespace, soft radii, and a heavy tight-tracked display face for headlines.

What survives the change, because it was never about the palette:

- Tabular mono numerics everywhere a number appears
- 11px uppercase tracked labels sitting next to large numbers
- One accent, used with discipline — no rainbow of status pills
- The motion ban list

### Tokens

Values sampled directly from the reference screenshot, not eyeballed.

```css
@theme {
  /* Surface */
  --color-sw-bg:        #FFFFFF;   /* page */
  --color-sw-surface:   #FBFBFD;   /* panel / raised */
  --color-sw-surface-2: #F4F4F8;   /* hover, table zebra, input rest */

  /* Rules — cool, never neutral grey */
  --color-sw-rule:      #ECEEF5;   /* row hairline, header underline */
  --color-sw-rule-2:    #D2DCE7;   /* input + secondary-button border */

  /* Ink — indigo-tinted, deliberately not black */
  --color-sw-ink:       #2C224E;   /* headlines, table primary text */
  --color-sw-ink-mid:   #626879;   /* body copy, subheads */
  --color-sw-ink-lo:    #7E8497;   /* labels, meta — darkened from the reference's
                                      #9498A3, which fails AA at 2.9:1 */

  /* Accent — the only brand colour */
  --color-sw-violet:      #6F58E3;
  --color-sw-violet-hi:   #5A43D4;  /* hover / pressed */
  --color-sw-violet-soft: #EFECFC;  /* tinted fills, selected row */

  /* Score heat — one hue, violet, light→deep */
  --color-sw-heat-0: #C9CBD6;   /* cold — good site, weak lead */
  --color-sw-heat-1: #B3AEE8;
  --color-sw-heat-2: #9384EC;
  --color-sw-heat-3: #7660E5;
  --color-sw-heat-4: #5334C9;   /* hot — strong lead */

  /* Functional — used only for these meanings, never decoration */
  --color-sw-warn:    #A06A1C;   /* spend, quota, parked scans */
  --color-sw-warn-bg: #FDF6E9;
  --color-sw-fail:    #C0392B;   /* failed query, error state */
  --color-sw-ok:      #1E7F5C;   /* completed scan, contacted lead */

  --radius-sw-sm: 6px;
  --radius-sw:    10px;
  --radius-sw-lg: 14px;
  --radius-sw-pill: 999px;
}
```

**Why a violet heat ramp instead of the old amber.** Amber is now reserved for spend and
quota — the one place in the app where a warning colour carries real meaning. Making the
score ramp a single-hue violet keeps the "one accent" rule intact and makes a dense grid
read as one instrument rather than a heatmap. Cold is a desaturated grey-violet so that a
low-score row recedes; hot is a deep violet that holds contrast against white.

Accessibility check, computed rather than assumed — all against white:

| Token | Ratio | Verdict |
|---|---|---|
| `ink` #2C224E | 14.5:1 | AAA |
| `ink-mid` #626879 | 5.6:1 | AA body |
| `ink-lo` #7E8497 | 3.7:1 | AA large / 11px labels at 500 weight only |
| `violet` #6F58E3 | 5.0:1 | AA body; white-on-violet is the same 5.0:1, so the button label passes |
| `warn` #A06A1C | 4.6:1 | AA body |
| `fail` #C0392B | 5.4:1 | AA body |
| `ok` #1E7F5C | 5.0:1 | AA body |
| `heat-4` #5334C9 | 7.8:1 | AAA |
| `heat-0` #C9CBD6 | 1.6:1 | **fill only** |

Two deliberate departures from the reference: its meta grey `#9498A3` sits at 2.9:1 and
fails outright, so `ink-lo` is darkened; and the heat ramp's cold end is unreadable as
text, so **score heat is a fill, never a text colour** — the number sits in `ink` on a
tinted chip, or in white once the fill reaches `heat-3`. The crossover is checked: `ink` on
`heat-2` is 4.7:1 and white on `heat-3` is 4.6:1, so the flip happens between those two
steps and every heat cell passes AA.

### Rules, enforced

1. **One accent.** Violet. Everything else is ink, rule, or surface. Warn/fail/ok exist
   but are semantic, not decorative.
2. **Soft, not round.** `10px` is the default radius; `6px` for small controls and table
   chips; `999px` only for the eyebrow pill and avatar stacks. No `rounded-3xl`.
3. **Elevation is a hairline, not a shadow.** Panels sit on `--color-sw-surface` with a
   `1px solid var(--color-sw-rule)` edge. One shadow token exists —
   `0 1px 2px rgba(44,34,78,.06), 0 8px 24px rgba(44,34,78,.06)` — and it is used only for
   overlays: ⌘K palette, dropdowns, the spend-approval modal.
4. **Table rows are separated by hairlines, not boxed.** Same discipline as before, new
   colour. `1px solid var(--color-sw-rule)` between rows, no vertical borders.
5. **Every number is mono with `font-variant-numeric: tabular-nums`.** Non-negotiable.
   This is what stops a light SaaS palette collapsing into AI-default.
6. **Labels are 11px mono, uppercase, `letter-spacing: 0.14em`, `--color-sw-ink-lo`.**
   They sit next to 30px mono numbers. The scale contrast is the point.
7. **Whitespace is the layout.** The reference gets its quality from air, not ornament.
   Marketing sections are `120px` vertical; app panels are `24px` padded. Resist filling.

### Type

| Role | Face | Notes |
|---|---|---|
| Display / headlines | **Geist Sans**, weight 700, tracking `-0.02em` | Heavy and tight, per the reference |
| UI + body | Geist Sans, 400/500 | |
| All numerics, labels, IDs, codes | **Geist Mono** | tabular-nums always |

Still deliberately not Inter, and not the Instrument Sans / IBM Plex Mono pairing on the
brochure sites. Geist covers display, UI and mono from one family, which removes the
serif face the retired direction B needed.

Scale, measured from the reference at a 1487px viewport:

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `display-1` | 52 / 0.95, `-0.02em` | 700 | Marketing hero. `clamp(2.25rem, 3.6vw, 3.25rem)` |
| `display-2` | 36 / 1.1 | 700 | Section headings |
| `title` | 20 / 1.3 | 600 | Panel and screen titles |
| `body-lg` | 18 / 1.5 | 400 | Hero subhead, lead detail prose |
| `body` | 15 / 1.5 | 400 | Default UI text, nav |
| `small` | 13 / 1.4 | 400 | Table cells, meta |
| `label` | 11 / 1, `0.14em`, uppercase | 500 mono | Stat labels |
| `stat` | 30 / 1 | 500 mono | Big numerics |

**The two-colour headline is a real device, use it once.** In the reference the headline
splits mid-sentence into violet. Sweep uses it on the marketing hero only — nowhere in the
app.

### Component geometry

Also measured, not guessed:

| Component | Spec |
|---|---|
| Header | 64px tall, white, `1px solid var(--color-sw-rule)` bottom |
| Primary button | 56px tall marketing / 40px in-app, `10px` radius, violet fill, white 15px/500 label |
| Secondary button | Same box, white fill, `1px solid var(--color-sw-rule-2)`, violet label |
| Eyebrow pill | 38px tall, pill radius, white, `1px solid #E9E9E9`, 14px label + leading icon |
| Input | 40px, `6px` radius, `--color-sw-surface-2` fill, rule-2 border, violet focus ring |
| Table row | 44px, hairline separated, `--color-sw-surface-2` on hover, `--color-sw-violet-soft` on select |
| Container | `max-width: 1280px`, 64px gutters desktop / 20px mobile |

### The marketing hero, spelled out

The structure worth copying from the reference, top to bottom, all centered:

1. Eyebrow pill with icon and `→`
2. `display-1` headline, three lines, second phrase in violet
3. `body-lg` subhead, `max-width: 620px`
4. Dual CTA — violet primary, outlined secondary
5. Trust strip — three mono-labelled proof points in a single row
6. Product screenshot, `14px` radius, hairline border, bleeding off the bottom of the fold

For Sweep the copy targets are: headline about finding under-served local trades; trust
strip carries **"$0 to run"**, **"288 queries / scan"**, **"live in 40s"** — real numbers
from the app, in mono. That last swap is the whole difference between this reading as a
template and reading as a product.

### Motion

Motion One (~5kb) plus `withViewTransitions()` on the router. Unchanged from the original
plan, because none of it depended on the palette.

| Duration | Use |
|---|---|
| 120ms | Micro — hover, focus, checkbox |
| 200ms | Layout — sort, filter, re-rank |
| 400ms | Entrance — row streaming in, panel open |

Easing: `cubic-bezier(0.32, 0.72, 0, 1)`.

Four motions, each earning its place:

1. **Radar sweep** over the suburb map while a scan runs. On light this inverts: an SVG
   conic gradient from `transparent` to `rgba(111,88,227,.28)`, 4s linear infinite, over a
   light basemap. Test it early — a sweep that read well on near-black can look washed out
   on white, and if it does, the fix is a violet-tinted map panel, not a darker sweep.
2. **Row streaming** on the live scan — 20ms stagger, `translateY(4px) → 0`, opacity `0 → 1`.
3. **Re-rank** in the scoring lab — FLIP on row position when weights change.
4. **Score count-up** — 300ms numeric interpolation.

**Banned:** fade-up-on-scroll, gradient text, skeleton shimmer, glassmorphism, mesh
gradient blobs, anything decorative. The light violet palette makes these temptations
considerably stronger than the dark one did. The ban is the same; holding it takes more
discipline now.

### The risk this change introduces, stated plainly

The retired direction was unusual, and unusual is what made it portfolio-worthy. Light +
violet + rounded is the single most common look in B2B SaaS, and it is also what every AI
UI generator produces by default. Three things carry the quality now, and if any of them
slips the app looks generic:

- **Mono tabular numerics at large scale.** The one detail generated UI never gets right.
- **Density.** A real 44px data row with hairline separation, not 72px padded cards.
- **Real numbers in the chrome** — live cost estimates, quota meters, query counts.

Build the leads grid before the marketing page. If the grid looks right in this palette,
everything else will.
---

## 8. The screens

Six app screens plus the public landing page added in the 9 Aug revision.

### 0. Landing page — `/` (public)

The Snov.io structure from §7, rendered with Sweep's own numbers: eyebrow pill → split
violet headline → subhead → dual CTA (`Try the demo` / `Log in`) → mono trust strip →
product screenshot bleeding off the fold. Below it, three sections and nothing more: how a
scan works, the scoring model, the free-tier cost table from §2 shown honestly.

Statically rendered — this page must not require Supabase to paint, so a dead database
never produces a blank portfolio link.

*Proves:* it is the first thing a prospective client sees. Treat it as a deliverable, not
a placeholder.

### 1. Scan builder — `/scans/new`

Trade multi-select, suburb picker with a map preview of coverage, top-N control.

Live readout as selections change: query count, **estimated cost in USD**, remaining
free-tier allowance, count of trade×suburb pairs already covered in the last 30 days
(defaulted off).

*Proves:* reactive forms, derived state, product judgement.

### 2. Live scan — `/scans/:id` ★ hero screen

Three regions:

- Suburb map with the radar sweep, suburbs lighting up as their queries complete
- Progress rail: `218 / 288`, businesses found, PSI progress, quota meter, elapsed
- Streaming log — results landing in real time, failures called out rather than hidden

Realtime: subscribe to the `scans` row for counters (trigger-rolled), and to `businesses`
inserts filtered by `first_seen_scan_id` for the streaming feed.

Must handle the ugly cases visibly: quota exhaustion, failed queries, partial completion.
The current script already surfaces these to stderr — the UI should be equally honest.

*Proves:* real-time architecture, long-running job UX, error handling.

### 3. Leads grid — `/leads`

The workhorse. CDK virtual scroll over the full `lead_rows` set.

Columns: business, trade, suburb, reviews, rating, website state, PSI, **score** (heat
coloured), status. Sortable, filterable, column visibility config, saved views, bulk
status change, full keyboard navigation (`j`/`k`/`enter`/`x`).

*Proves:* performance at scale, complex state, keyboard craft.

### 4. Map — `/leads/map`

Same data, geographic. Clustered markers coloured by score heat. Selection is
bidirectional with the grid — click a marker, the row highlights, and vice versa.

MapLibre GL with a light, low-chroma basemap — roads and labels desaturated to near-grey
so the violet score markers are the only saturated thing on screen. This is the inverse of
the old plan and it is the easier problem: a light basemap needs less tuning than a dark
one, and free light styles are more plentiful than free dark ones.

*Proves:* geospatial, hard two-way state synchronisation.

### 5. Lead detail — `/leads/:id`

The old plan flipped this page to warm paper for density contrast. With a single light
system that device is gone, so **the contrast now has to come from layout instead of
palette**: the grid is a full-bleed 44px-row instrument, the detail page is a single
`720px` measure with `body-lg` prose, wide margins and one column. Same tokens, opposite
density. If it ends up looking like the grid with fewer rows, the page has failed.

The record:

- Contact block — phone, address, Google listing link
- Their current site: screenshot, and the **full PSI breakdown** (LCP, CLS, TBT, FCP),
  not just the composite score
- PSI history chart if more than one measurement exists
- Score derivation, shown as an explanation: `142.6 = 89 reviews × (4.8/5) × 1.0 (no website)`
- Notes, status, event timeline
- Actions: mark mockup built, recheck PSI, open in Maps

*Proves:* information design, API depth, restraint.

### 6. Scoring lab — `/scoring`

Sliders for every weight in `ScoringWeights`. The full lead list re-ranks live underneath
with a FLIP animation. Save named profiles; compare two profiles side by side.

Half a day of work. The thing people screenshot.

*Proves:* signals mastery. This is the Angular showpiece.

### Plus — ⌘K palette

Jump to any lead by name, run a scan, switch view, change status. Available everywhere.

---

## 9. Angular architecture

```
src/app/
  core/
    supabase.service.ts        client wrapper, session, tenant resolution
    realtime.service.ts        channel lifecycle, typed subscriptions
    keyboard.service.ts        global shortcut registry
  features/
    scans/    scan-builder/  scan-live/  scan.store.ts
    leads/    leads-grid/  leads-map/  lead-detail/  leads.store.ts
    scoring/  scoring-lab/  scoring.store.ts
    marketing/  landing/  sections/    public, must render with no Supabase dependency
  shared/
    ui/       rail/  hairline-table/  heat-cell/  stat/  command-palette/
              button/  pill/  panel/  field/       the §7 primitives
    scoring/  score.ts          pure fn — the port of penalty() and score()
```

Decisions:

- `provideZonelessChangeDetection()`. Note that zoneless is production-stable as of
  Angular 22 and OnPush is now the default change detection strategy, so this is no longer
  the differentiator the original plan treated it as — it is simply the correct default.
  The signals work still shows, it just has to show in the scoring lab rather than in a
  bootstrap line
- `provideRouter(routes, withViewTransitions())` — grid → detail transition for free
- **Signal Forms** for the scan builder and the scoring lab. Stable in 22, and a much
  better fit than reactive forms for a form whose entire purpose is deriving a live cost
  estimate from the current selection
- **Resource APIs** (`resource()` / `httpResource()`) for read-once data; NgRx SignalStore
  only where state is long-lived and shared. Both are stable in 22 — do not hand-roll
  loading/error state
- **Angular Aria** for the ⌘K palette, the trade multi-select, and the scoring sliders.
  Stable in 22, and it removes the main excuse for shipping inaccessible custom widgets
- `score.ts` is a **pure function with no dependencies**, unit tested to death. It's the
  business logic, it's shared by the grid, map, detail page and scoring lab, and it's the
  file to point at in an interview
- CDK virtual scroll for the grid. Do not hand-roll windowing
- No RxJS beyond what Supabase's client forces

---

## 10. Build order

Roughly one weekend each at 10–15 hrs/week. Every step ends with something demonstrable.

| # | Weekend | Outcome |
|---|---|---|
| 0 | **Style tile** — half a day | A single route rendering every §7 token in place: type scale, buttons, inputs, a 20-row hairline table with heat cells, a stat block, the eyebrow pill. Judge the direction here, before it is baked into six screens. Non-negotiable now that the palette is a common one |
| 1 | **Foundations** | Supabase project, full schema, RLS, seed trades + suburbs (geocoded), `api_budgets` seeded at zero paid allowance, **keepalive ping configured**. Angular scaffold, zoneless, Tailwind v4, §7 tokens in `@theme`, app shell |
| 2 | **Engine + spend gate** | Port `harvest.mjs` to `worker-search` + `worker-psi` + `scan-advance`, pgmq queues, single `tick` cron. `reserve_api_calls()` wired in from the first call, not retrofitted. A real scan runs end to end, parks correctly when the allowance runs out, and lands in Postgres. No UI yet |
| 3 | **Grid** | Leads grid: virtual scroll, sort, filter, keyboard nav, heat cells. ⌘K palette. First screen that feels like a product — **and the screen that proves the palette works at density** |
| 4 | **Live scan** | Realtime subscriptions, progress rail, streaming log, radar sweep on light, the paused-for-approval state. The hero screen |
| 5 | **Detail** | Lead detail as a 720px single-measure document, PSI breakdown, screenshots extracted from the PSI payload, event timeline |
| 6 | **Map + lab** | MapLibre light basemap with linked selection, scoring lab with FLIP re-rank |
| 7 | **Landing + ship** | Marketing page at `/`, demo tenant, fictionalised snapshot, "Try the demo" flow, scan builder preflight and "fit to free tier", `wrangler deploy` to Cloudflare Workers, record a 90-second walkthrough for the portfolio |

Seven and a half weekends. If it slips, cut the map (#6) before cutting the scoring lab —
the lab is cheaper and shows more. Do **not** cut weekend 0; skipping the style tile is
how a light violet system drifts into generic without anyone noticing until week five.

Note the ordering: the landing page is last, not first. It is the most fun to build and
the least informative — its layout is already decided by the reference, so building it
early teaches nothing about whether the system holds up under real data.

---

## 11. The fictionalised demo snapshot

Generated once by a script, from a real scan, with identity stripped:

- Business names → generated from a trade + surname/suburb word list
- Phone numbers → `02 5550 XXXX` (the 5550 range is reserved for fiction)
- Website URLs → `example.com` subdomains
- Screenshots → generic site images, not real captures
- **Keep real:** ratings, review counts, PSI scores, coordinates (jittered ~200m), the
  score distribution

Keeping the measurements real is what makes the demo convincing. Only identity is faked.

The demo tenant is read-only by RLS, so nothing in it can trigger a paid API call no
matter what a visitor clicks.

---

## 12. Open items

| Item | Note |
|---|---|
| ~~Screenshot service~~ | **Resolved** — PSI already returns base64 screenshots in its audits. Free, no extra call |
| Suburb geocoding | One-off at seed time. Hand-fill 18 rows; that's faster than wiring up the Geocoding API, and it avoids adding a second metered service |
| Notion sync | The current script writes to Notion. Keep it as an optional export in v2 rather than porting it now |
| MapLibre basemap | Needs a **light** tile source with no account. OpenFreeMap `positron` first choice; CARTO positron as fallback. Desaturate labels in the style JSON so violet markers stay the only saturated element |
| Radar sweep on light | The one motion whose readability depended on the retired dark palette. Prototype it in weekend 0's style tile, not weekend 4 |
| Keepalive | Decide the mechanism in weekend 1 — uptime monitor, GitHub Actions cron, or a Cowork scheduled task |
| Domain | `sweep.*` is likely gone. `noel-sebastian.com/sweep` works fine for portfolio purposes and costs nothing |
| Places two-pass | Measure whether filtering on cheap-tier fields first actually reduces spend. Billing is per call, not per place, so it may not |
| Free-tier drift | Google and Supabase both change free tiers. Re-check `unit_cost_usd` and `free_allowance` against current pricing before the first paid grant is ever approved |

---

## 13. Working with coding agents

Sweep is built with **Claude Code** and **Command Code** interchangeably. Both read
project memory from a markdown file at the repo root, and both support project-level
skills and MCP servers — so the repo is set up once, agent-agnostically.

| File | Role |
|---|---|
| `AGENTS.md` | **Single source of truth.** Stack, commands, conventions, guardrails. Command Code loads this natively as project memory; Claude Code reads it too |
| `CLAUDE.md` | A pointer at `AGENTS.md`. Nothing lives here — two memory files that drift apart is worse than one |
| `BUILD-PLAN.md` | This document. The *why*. Agents are told to read it before starting a weekend's work, and not to re-litigate its locked decisions |
| `supabase/migrations/` | Every migration, checked in, numbered, applied. An agent reads these rather than guessing the schema |
| `.env.example` | Variable names only. Real values never enter the repo |

Rules that apply to any agent working in this repo, restated in `AGENTS.md` where they
will actually be read:

1. **Never call a metered API without `reserve_api_calls()` first.** Not in a script, not
   in a test, not "just to check it works". §4 exists precisely because this rule is easy
   to break by accident.
2. **The service role key never reaches the browser bundle or the repo.** Edge functions
   only.
3. **Schema changes are migrations, never dashboard edits.** Both agents can apply
   migrations through the Supabase MCP; neither should be clicking around the dashboard.
4. **Run `get_advisors` after any DDL.** It catches missing RLS and policy overlap that no
   test will.
5. **`score.ts` stays pure and dependency-free.** It is the one file with no excuse for
   a framework import.

Command Code additionally writes learned conventions to `.commandcode/taste/`. That
directory is committed — it is reviewable, and it is what keeps the two agents producing
code that looks like it came from one person.

---

## 14. Build status

Updated as work lands. Weekend numbers refer to §10.

| Weekend | Status | Notes |
|---|---|---|
| **1 — Foundations (backend half)** | **Done, 9 Aug 2026** | Supabase project `sweep` created in `ap-southeast-2` (Sydney). Full §5 schema applied as 12 migrations, RLS on all 16 tables, spend gate tested. See below |
| 0 — Style tile | **In progress** | Spec written, scope enrolled, git initialised. Awaiting scaffold and component build |
| 1 — Foundations (Angular half) | Not started | Angular 22 scaffold, Tailwind v4, §7 tokens, keepalive ping |
| 2–7 | Not started | |

### What exists in Supabase now

Project ref `ifwyufrepqkzsicjinfi`, region `ap-southeast-2`, Postgres 17.

Sixteen tables, all with RLS enabled and policies applied: `tenants`, `profiles`,
`trades`, `regions`, `suburbs`, `scans`, `scan_queries`, `businesses`, `psi_results`,
`site_snapshots`, `leads`, `lead_events`, `scoring_profiles`, `api_budgets`,
`spend_grants`, `api_calls`. Plus the `lead_rows` view with `security_invoker = true`.

Deviations from the §5 DDL as written, all deliberate:

- `scan_status` includes `awaiting_approval` from the start, rather than being added later
  as §4 suggested
- `current_tenant()` and `current_tenant_is_demo()` are `security definer` helpers with
  pinned `search_path`; RLS policies call them instead of inlining a subquery against
  `profiles`, which would recurse into that table's own policy
- Write policies are split into separate `insert` / `update` / `delete` policies rather
  than one `for all`. A `for all` policy also covers `SELECT`, which meant two permissive
  policies were being evaluated on every read — the performance advisor flagged it on
  every table
- `refund_api_calls()` is implemented alongside `reserve_api_calls()`, clamped at zero
- Counter rollup triggers exist on `scan_queries` and `businesses`, so the live scan screen
  can subscribe to one `scans` row
- Foreign-key indexes added throughout; the advisor's `unused_index` notices are expected
  on an empty database and should be re-checked once real data lands

Spend gate verified against the §4 spec — with `free_allowance = 3`, reserving 2 returns
`free`, a further 2 returns `denied`, 1 more returns `free`, and an unseeded budget returns
`no_budget`.

Two security advisor warnings remain and are intentional: `current_tenant()` and
`current_tenant_is_demo()` are executable by `authenticated`, because RLS policies are
evaluated with the invoker's privileges and therefore require it. Both take no arguments
and expose only the caller's own tenant. `anon` has been revoked from both, and from every
other function in the schema.

### Still to do before the engine can run

- Seed `tenants`, a `regions` row for the Blue Mountains, 16 `trades`, 18 geocoded
  `suburbs`, and `api_budgets` at `free_allowance = 1000`, `allow_paid = false`
- Enable `pgmq` and `pg_cron`, create the queues
- The demo tenant and its `auth.users` row
- Keepalive ping — the existing paused project in this org is proof the trap is real
