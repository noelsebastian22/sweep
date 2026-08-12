# Scope

## At a glance

| Feature | Status | Spec |
|---|---|---|
| Weekend 0: Style tile | done | [0001](../specs/0001-angular-scaffold-style-tile.md) |
| Weekend 1: Angular foundations | done except keepalive | [0002](../specs/0002-weekend-1-angular-foundations.md) |
| Weekend 2: Engine and spend gate | done | [0003](../specs/0003-weekend-2-engine-spend-gate/index.md) |
| Weekend 3: Leads grid | in-progress | [0004](../specs/0004-weekend-3-leads-grid/index.md) |

---

### Weekend 0: Style tile · done

Angular scaffold (v20 at the time, upgraded to v22 on 11 Aug) and a style tile route at `/style` rendering every design token from BUILD-PLAN.md §7. Validate the design system before building the full app.

**Decision**: Scaffold into the repo root with `ng new --directory .`, Tailwind v4 via PostCSS, Geist Sans/Mono self-hosted. One monolithic component at `/style` — a reference page, not production UI. [0001](../specs/0001-angular-scaffold-style-tile.md)

- [x] Design it (spec)
- [x] Build it: /develop weekend-0-style-tile · code in `src/app/style-tile/style-tile.ts`
  - [x] Scaffold Angular, Tailwind v4, fonts, and routing · satisfies AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-8
  - [x] Build the style tile component with all seven sections · satisfies AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7
  - [x] Verify build, contrast, keyboard, screenshots · satisfies AC-8
- [x] Verify it: `ng build` clean, contrast ratios checked against BUILD-PLAN.md §7 (see 10 Aug session log), re-verified visually 11 Aug on Angular 22

### Weekend 1: Angular foundations · done except keepalive

Seed data, queue plumbing, keepalive, and the Angular app shell with email/password auth plus a placeholder dashboard. [0002](../specs/0002-weekend-1-angular-foundations.md)

- [x] Design it (spec)
- [x] Build it: /develop weekend-1-angular-foundations
  - [x] Backend: pgmq/pg_cron/pg_net migration, health function, seed function · satisfies AC-1, AC-2, AC-3
  - [ ] UptimeRobot keepalive monitor · satisfies AC-4 — **still open**, needs an external UptimeRobot account signup
  - [x] Frontend: Supabase client, AuthStore, login, auth guard, layout shell, dashboard · satisfies AC-5, AC-6, AC-7, AC-8, AC-9, AC-10
  - [x] Verify ng build passes · satisfies AC-11
  - [x] `get_advisors` re-run after the pgmq/pg_cron/pg_net migration · satisfies AC-12 — run 11 Aug, found `pg_net` installed in the public schema, fixed in migration 14

### Weekend 2: Engine and spend gate · done

Ports `harvest.mjs` into a `tick` edge function that a `pg_cron` job wakes every minute: search Google Places, check PageSpeed, decide when a scan is done. Every metered call is gated by `reserve_api_calls()` from the first line of code. No UI yet — a scan is started with a raw HTTP request and verified by reading Postgres directly. [0003](../specs/0003-weekend-2-engine-spend-gate/index.md)

**Decision**: One `tick` function with `search.ts`/`psi.ts`/`advance.ts` as internal modules, not four separately deployed functions — matches `BUILD-PLAN.md` §6's own invocation budget math and lets one shared 120s time budget cover all three stages. `scan-create` stays its own HTTP-triggered function. [0003](../specs/0003-weekend-2-engine-spend-gate/index.md)

- [x] Design it (spec)
- [x] Build it: /develop weekend-2-engine-spend-gate · code in `supabase/functions/scan-create/`, `supabase/functions/tick/`, `supabase/migrations/`
  - [x] Schema: `businesses.last_scan_id`, the `psi_results` rollup trigger, the redelivery-safe unique index · satisfies AC-4, AC-6, AC-10, AC-13
  - [x] Cron wiring: replace the `tick` placeholder with a real `net.http_post` call reading the service role key from Vault, deploy `tick` + `scan-create` · satisfies AC-2
  - [x] `scan-create` edge function: validates inputs, derives `region_id`, creates the scan and its `scan_queries` · satisfies AC-1
  - [x] The `tick` engine itself: `search.ts`, `advance.ts`, `psi.ts` ported from `harvest.mjs`, spend-gated, idempotent under redelivery, scoped to one active scan at a time · satisfies AC-3, AC-5, AC-7, AC-8, AC-10, AC-12
  - [x] End to end verification: a six query test scan, an overlapping second scan, then one full 288 query scan, all verified directly in Postgres · satisfies AC-9
- [x] Verify it: run by hand 13 Aug 2026 (`/check` is not installed in this repo) — every step in `verify.md` ticked, including the four AC-7/AC-12/AC-1 gaps the first pass left open, plus fixes for both `index.md` Follow-up findings

### Weekend 3: Leads grid · in-progress

The first real product screen: a dense, virtual scrolled table of every business the engine has discovered, sorted and coloured by lead strength. Builds `shared/scoring/score.ts` (the pure port of `harvest.mjs`'s `penalty()`/`score()`) and `leads.store.ts`, both of which the scoring lab and the map reuse later. No new API surface — reads `lead_rows`, writes only `leads.status`, all direct through Supabase with existing RLS. [0004](../specs/0004-weekend-3-leads-grid/index.md)

**Decision**: Single client side fetch of `lead_rows` into an NgRx SignalStore, with sort, filter, score, and heat banding all derived as `computed()` signals — no round trip on any interaction, which is also what the weekend 6 scoring lab already assumes. Saved views, column visibility config, bulk status change, and the palette's scan/view-switch actions are deferred to the weekends that build their targets. [0004](../specs/0004-weekend-3-leads-grid/index.md)

- [x] Design it (spec)
- [x] Build it: /develop weekend-3-leads-grid · code in `src/app/features/leads/`, `src/app/shared/scoring/score.ts`, `src/app/shared/ui/{hairline-table,heat-cell,command-palette}/`, `src/app/core/{supabase.service,keyboard.service}.ts`, `supabase/migrations/20260812082954_17_seed_default_scoring_profiles.sql`
  - [x] Data foundations: migration seeding default `scoring_profiles`, `core/supabase.service.ts` extraction, `AuthStore.isDemo`, `shared/scoring/score.ts` with unit tests · satisfies AC-2, AC-12, AC-13
  - [x] Data flow to screen: `leads.store.ts` fetch of `lead_rows` + default weights, `computed()` signals for score/sort/heat banding · satisfies AC-1 (data half), AC-2, AC-3, AC-4
  - [x] Grid visuals and scale: `hairline-table`/`heat-cell` components, `@angular/cdk` virtual scroll · satisfies AC-1 (visual and performance halves)
  - [x] Interaction: filter chips and ranges, keyboard nav (`j`/`k`/`enter`), inline lead drawer with status change and demo tenant disablement · satisfies AC-5, AC-6, AC-7, AC-8
  - [x] Palette and polish: global `⌘K` command palette, empty/loading/error states · satisfies AC-9, AC-10, AC-11
- [ ] Verify it: /check verify weekend-3-leads-grid
