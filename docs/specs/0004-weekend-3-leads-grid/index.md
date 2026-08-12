# 0004. Leads grid (weekend 3)

**Date**: 2026-08-12
**Status**: In Progress

## Summary

This builds the leads grid, the first real product screen: a dense table of every business
the engine has discovered, sorted and coloured by how good a lead it is. It also builds
`score.ts`, the pure function that turns raw rating, review count, website state, and
PageSpeed score into that ranking, ported from the original `harvest.mjs` script. Nothing
here talks to Google's APIs or spends money; it only reads what the engine already wrote.
Two screens it would normally link to (lead detail, the scan builder) do not exist yet, so
this weekend fills that gap with a lightweight inline panel rather than a dead link.

## Requirements

**User stories**:
- As Noel, I want to see every business the engine has found in one dense, sortable table
  so I can quickly spot the businesses most worth a cold outreach.
- As Noel, I want the table coloured by how strong each lead is so the best opportunities
  are visible without reading every row.
- As Noel, I want to filter and search the list and change a lead's status without leaving
  the keyboard.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: Visiting `/leads` while signed in loads all of the caller's tenant leads in one
  fetch (bounded to 5000 rows) and renders them as a virtual scrolled, hairline separated
  table (44px rows) with columns business, trade, suburb, reviews, rating, website state,
  PSI, score (heat coloured), status, in that order.
- **AC-2**: Score is computed client side by `shared/scoring/score.ts`, a pure function of
  `(rating, rating_count, website_kind, psi_score, weights)`, using the caller's tenant's
  default `scoring_profiles` row, merged field by field over `score.ts`'s own default
  constants (a loaded row missing a key, or absent entirely, still yields a fully usable
  weight set). `website_kind` is mapped `'none'` or `null` → `noWebsite`, `'social'` →
  `socialOnly`, `'site'` → the PSI threshold branch; `rating`/`rating_count`/`psi_score`
  null default to `0`/`0`/treated as unmeasured, matching `harvest.mjs` exactly.
- **AC-3**: Each row's heat cell is one of 5 bands (`heat-0`..`heat-4`), assigned by
  percentile rank of its score **value** (not row position) within the **heat basis**: the
  row set produced by every active filter except the heat band filter itself. Equal scores
  always share the same band. If the basis has a zero score range (every row scores the
  same, e.g. an all no-website filter) or fewer than 5 distinct score values, bands
  collapse to however many are distinct rather than forcing 5 populated bands. Recomputed
  whenever the non-heat filters or the loaded row set change; never recomputed by the heat
  filter itself, so filtering to a band cannot re-bucket the rows it just selected.
- **AC-4**: Every column is sortable; default sort is score descending. Sorting is a pure
  client side re-derivation with no network round trip.
- **AC-5**: Rows can be filtered, in any combination, by trade, suburb, website state
  (labelled "No website" / "Social only" / "Full site"), status, and heat band (multi
  select chips whose options are the values present in the loaded rows; the heat band
  filter selects from the bands already assigned per AC-3, it does not itself change them),
  by PSI score range and rating threshold (numeric ranges; a row with a null value on a
  bounded field is excluded while that bound is active, since it cannot be evaluated
  against it), and by a free text search on business name. All filtering runs client side.
- **AC-6**: Keyboard navigation: `j`/`k` move row focus up and down (auto scrolling the
  virtual list to keep focus visible), `enter` opens the inline lead drawer for the
  focused row.
- **AC-7**: The inline lead drawer (opened by row activation or by the palette's
  jump-to-lead) shows the lead's key fields, the score shown as its derivation (e.g.
  `85.4 = 89 reviews × (4.8/5) × 1.0 (no website)`), and a status dropdown. The open
  lead's id is reflected in a `?lead=` URL query parameter so the state survives a refresh
  or a shared link.
- **AC-8**: Changing status in the drawer writes `leads.status` directly through Supabase,
  governed by existing RLS. For the demo tenant, the status control is disabled with a
  "read only in the demo" tooltip rather than allowed to silently no-op.
- **AC-9**: A global command palette opens on `Cmd/Ctrl+K` from anywhere the app shell is
  mounted. It supports: jump to a lead by name (fuzzy match against the loaded rows);
  change status, offered only when a lead is currently focused or open (not shown in the
  action list otherwise, never a no-op invocation); and a fixed set of quick filter
  shortcuts (No website, Social only, Poor PSI, Hottest quintile, Contacted, Clear
  filters) — "Hottest quintile" applies `heat-4` against the current heat basis (AC-3), so
  it means the same thing here as it does in the chip filter.
- **AC-10**: Zero leads renders a plain empty state message, with no dead call to action
  (the scan builder that would create leads does not exist yet).
- **AC-11**: While the initial fetch is in flight, the grid shows a plain loading
  placeholder, never a skeleton shimmer (banned in `AGENTS.md`'s design rules).
- **AC-12**: A migration seeds one `is_default = true` `scoring_profiles` row per existing
  tenant, `name = 'Default'`, with `harvest.mjs`'s original weight constants.
- **AC-13**: `AuthStore` additionally exposes `isDemo`, sourced by joining `tenants.is_demo`
  in `loadProfile`.

## Decision

**Chosen option**: Option 1: Client side single fetch, computed sort/filter/score.

Fetch the tenant's `lead_rows` once into `leads.store.ts` (an NgRx SignalStore, per
`BUILD-PLAN.md` §9's architecture diagram), and derive sort, filter, score, and heat
banding as `computed()` signals with no further network access.

## Rationale

Reasoning and options: see `rationale.md`.

## Feature design

**Data model sketch**:

No schema changes. This feature reads the existing `lead_rows` view (`leads` joined to
`businesses`, `trades`, `suburbs`, and the latest successful `psi_results` row) and writes
only `leads.status`, both already in place since weekend 1/2. The one data gap is
`scoring_profiles`, currently empty for every tenant:

| Table | Change | Detail |
|---|---|---|
| `scoring_profiles` | new rows, no schema change | one row per existing tenant: `name='Default'`, `is_default=true`, `weights={noWebsite:1.0, socialOnly:0.9, psiUnmeasured:0.5, psiPoor:0.5, psiMedium:0.2, psiGood:0.0, poorThreshold:40, mediumThreshold:70}` (verbatim from `harvest.mjs`'s `penalty()`/`score()`) |

**State transitions**:

`leads.status` already has its full enum and transition surface from migration 05
(`identified → shortlisted → mockup_built → contacted → replied → won/lost/rejected`,
unconstrained transitions). This feature only exposes an existing transition through a UI
control; it does not add or restrict any transition.

**API surface**:

No new endpoints or edge functions. Every read and write goes directly through
`@supabase/supabase-js` against RLS protected tables/views with the publishable key.

| Action | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| Load leads | `select` on `lead_rows` | tenant scope (implicit via RLS) | all `lead_rows` columns, `limit 5000` | authenticated | RLS denies cross tenant rows silently (returns none, not an error) |
| Load default weights | `select` on `scoring_profiles` | `tenant_id`, `is_default = true` | `weights` jsonb | authenticated | no row found → `score.ts` fallback constants, AC-2 |
| Update status | `update` on `leads` | `id`, `status` | updated row | authenticated, blocked for demo tenant by RLS | demo tenant write affects 0 rows; UI must not attempt it (AC-8) |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Render row | `score` | `score.ts(rating, rating_count, website_kind, psi_score, weights)` |
| Render row | `weights` | the tenant's `scoring_profiles` row where `is_default = true`, merged field by field over `score.ts`'s own constants; those constants alone if no row exists |
| Render row | `website_kind` → penalty branch | fixed mapping in `score.ts`: `'none'`/`null` → `noWebsite`, `'social'` → `socialOnly`, `'site'` → the PSI threshold branch |
| Render row | heat band (`heat-0`..`heat-4`) | percentile rank of this row's score value within the heat basis (the row set after every filter except the heat band filter itself), computed client side, ties sharing a band |
| Render filter chips | trade / suburb / website state / status options | distinct values present in the loaded `lead_rows` array (not the raw `trades`/`suburbs` tables, which include entries no current lead has, producing dead filter options) |
| Filter by PSI/rating range | inclusion of a null valued row | excluded while that bound is active; null cannot be evaluated against a numeric bound |
| Open drawer | `?lead=` query param value | the activated row's `lead_id`, set via `Router` `queryParams` |
| Disable status control | `isDemo` | `AuthStore.isDemo`, sourced by joining `tenants.is_demo` through `profiles.tenant_id` in `loadProfile` |
| Palette jump-to-lead | candidate list | the same loaded `lead_rows` array, substring/fuzzy matched on `name` client side |
| Palette quick filters | filter presets | a fixed list defined in the palette's own action registry (No website, Social only, Poor PSI, Hottest quintile, Contacted, Clear filters), not sourced from data |

**Key invariants**:
- `score.ts` takes no dependencies and performs no I/O (`AGENTS.md` hard rule 5); it is a
  pure function of its five inputs.
- There is no `score` column anywhere in the database (`AGENTS.md` hard rule 6); score is
  always derived, never persisted.
- Heat band membership is only ever meaningful relative to its heat basis (AC-3); it is
  never compared or persisted across different filtered views, and the heat filter itself
  never contributes to computing the bands it selects from (the circularity the cross
  check on this spec caught: filtering to the hottest band must not re-bucket that band
  back across all 5 colours).
- Heat banding degrades gracefully on a small or uniform basis: a zero score range or
  fewer than 5 distinct values yields fewer non-empty bands, never a forced 5-way split of
  data that doesn't support it.
- Every write this feature performs is a single `leads.status` update, gated by the RLS
  policies already in place (migration 10/12); this feature adds no new authorization
  logic, only a client side UX layer (AC-8) on top of what the database already enforces.
- The default scoring weights exist in three places that must move together: `score.ts`'s
  own fallback constants, the AC-12 migration's seed values, and `BUILD-PLAN.md`'s
  `ScoringWeights` documentation. A future weight change updates all three; this
  duplication is a consequence of `score.ts` staying dependency-free (hard rule 5) and the
  migration being plain SQL, not an oversight.

**Security model**:
- Tenant isolation and the demo tenant's write block are both already enforced at the RLS
  layer (migrations 10 and 12); nothing in this feature changes or extends that model.
- The demo-tenant UI disablement (AC-8) is a UX courtesy, not a security boundary — the
  database is the boundary regardless of what the client does.

**Configuration required**: none. No new environment variables, secrets, or third party
credentials.

**Critical test scenarios**:
- Happy path: sign in as Noel, `/leads` loads and renders all rows sorted by score
  descending with heat cells, filtering by trade narrows the visible set and its heat
  bucketing recomputes, verifies **AC-1**, **AC-3**, **AC-4**, **AC-5**.
- Failure case: a tenant with no `scoring_profiles` row still gets a fully scored,
  heat coloured grid using `score.ts`'s fallback constants, verifies **AC-2**.
- Auth/permission: signed in as the demo tenant, the status dropdown is visibly disabled
  with an explanatory tooltip and no write is attempted, verifies **AC-8**, **AC-13**.

## Build plan

**Directory layout**: this weekend adopts `BUILD-PLAN.md` §9's `core/`/`features/`/`shared/`
structure for everything it builds (`core/supabase.service.ts`, `core/keyboard.service.ts`,
`features/leads/`, `shared/scoring/`, `shared/ui/`). The existing flat tree
(`stores/auth.store.ts`, `pages/login`, `pages/dashboard`, `guards/`, `layout/`) is left in
place, not renamed wholesale into the new structure — that's unrelated churn on
already-working code, out of scope here (see Follow-up). Task 2 below moves only the
Supabase client construction itself out of `auth.store.ts`; the rest of that file (state,
methods) stays where it is.

1. Migration: seed one default `scoring_profiles` row per existing tenant with
   `harvest.mjs`'s constants, satisfies **AC-12**.
2. Extract `core/supabase.service.ts` from the client currently inlined in
   `auth.store.ts`, so `leads.store.ts` can share the same client instance (`BUILD-PLAN.md`
   §9's architecture; no behaviour change to existing auth flows), prerequisite for **AC-1**.
3. Extend `AuthStore.loadProfile` to join `tenants.is_demo` and expose `isDemo`, satisfies
   **AC-13**.
4. Write `shared/scoring/score.ts`: the pure port of `harvest.mjs`'s `penalty()`/`score()`,
   taking a `ScoringWeights` config merged field by field over its own default constants,
   plus its unit tests (rating/rating_count/psi_score null handling, every `website_kind`
   value including `null`, each penalty tier, the no-row and partial-row fallback paths),
   satisfies **AC-2**.
5. Build `leads.store.ts` (NgRx SignalStore): `httpResource()` fetch of `lead_rows` (bounded
   `limit 5000`) and of the tenant's default `scoring_profiles` row, exposed as raw state.
   Render a bare, unstyled table of the fetched rows on `/leads` — the thin end to end
   slice proving data flows from Postgres to the screen before any density or interaction
   work begins, satisfies **AC-1** (data half).
6. Add `computed()` signals for score (via `score.ts`), sort, and percentile-rank heat
   banding over the heat basis (per AC-3, computed before the heat filter applies, with the
   degenerate-set fallback), satisfies **AC-2**, **AC-3**, **AC-4**.
7. Build the `shared/ui/hairline-table/` and `shared/ui/heat-cell/` components (44px rows,
   hairline separators, tabular numerics, the heat cell fill/text contrast rules already
   proven in the style tile) and swap the bare table for them, satisfies **AC-1** (visual
   half).
8. Swap in `@angular/cdk` virtual scrolling over the hairline table, satisfies **AC-1**
   (performance half).
9. Add filter chips and range/search controls, deriving their options from the loaded row
   set per the value sourcing table, satisfies **AC-5**.
10. Add keyboard navigation (`j`/`k`/`enter`) via `core/keyboard.service.ts` (new, per
    `BUILD-PLAN.md` §9), scoped to the grid's row focus, satisfies **AC-6**.
11. Build the inline lead drawer: key fields, the score derivation string, the status
    dropdown, `?lead=` query param wiring, and the demo tenant disablement using
    `AuthStore.isDemo`, satisfies **AC-7**, **AC-8**.
12. Build the global `⌘K` command palette on `core/keyboard.service.ts` using Angular Aria's
    combobox/listbox primitives: jump to lead, status change on the focused/open lead, and
    the fixed quick filter shortcuts, satisfies **AC-9**.
13. Add the empty state and the plain (non shimmer) loading placeholder, and an inline
    error state with retry for a failed fetch, satisfies **AC-10**, **AC-11**.
14. Verify: `ng build` clean, unit tests for `score.ts` pass, manual pass through every
    acceptance criterion including the demo tenant path.

## Consequences

**Positive**:
- The grid becomes the first screen that actually exercises the design system at density,
  the explicit goal `BUILD-PLAN.md` §10 sets for this weekend.
- `score.ts` and `leads.store.ts` are now real and reusable; the scoring lab (weekend 6)
  and the map (weekend 6) both read the same store and the same pure function rather than
  re-deriving score their own way.
- `core/keyboard.service.ts` exists as a real registry now, so later weekends add palette
  actions (run a scan, switch view) without re-architecting how the palette works.

**Negative / tradeoffs**:
- The inline lead drawer is intentionally throwaway: weekend 5 replaces it wholesale with
  the real 720px detail document rather than growing it, which is deliberate but does mean
  this weekend's drawer work is not reused later.
- The single-fetch, 5000 row bound will need revisiting (server pagination, Option 2)
  if the tenant's lead volume ever approaches that ceiling; not expected within this
  project's Google Places budget, but not impossible over a long enough time horizon.
- Saved views, column visibility config, and bulk status change from `BUILD-PLAN.md` §8
  are explicitly deferred, not built this weekend.

**Neutral**:
- `@angular/cdk` becomes a new dependency (the scrolling module only).
- `core/supabase.service.ts` is a small refactor of already-working code (`auth.store.ts`),
  not new behaviour.

## Follow-up

- [ ] Saved views, column visibility config, and bulk status change (`BUILD-PLAN.md` §8)
      are deferred; revisit if triage volume makes single-lead status changes too slow.
- [ ] The palette's "run a scan" and "switch view" actions wait on the scan builder
      (weekend 7) and the map (weekend 6) existing; add them to `core/keyboard.service.ts`'s
      action registry as those screens land, rather than re-designing the palette.
- [ ] AC-7's inline drawer is a deliberate throwaway; do not extend it toward the full
      detail page, replace it outright in weekend 5 per `BUILD-PLAN.md` §8 section 5.
- [ ] Weekend 2's two open follow-ups (budget accounting drift, the
      `businesses_found = 0` status logic gap) are unrelated to this spec and remain open
      against `docs/specs/0003-weekend-2-engine-spend-gate/`.
- [ ] `stores/auth.store.ts`, `pages/`, `guards/`, and `layout/` still predate
      `BUILD-PLAN.md` §9's `core/`/`features/`/`shared/` layout that this weekend's new code
      adopts. Left as is deliberately (see Build plan); fold them into the target structure
      whenever they're next touched for an unrelated reason, not as a dedicated pass.
