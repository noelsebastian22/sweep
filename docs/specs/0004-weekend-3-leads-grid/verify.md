# Verify: weekend-3-leads-grid · spec 0004 · updated 2026-08-13
_Steps derived from spec 0004 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._
_Note: `/check` and `/test` are not installed in this repo — `.claude/skills/` has only architect, audit, develop, impeccable, session-handoff. These steps were run by hand._

Run 2026-08-13 against both tenants: the demo tenant seeded with 64 temporary `vfy-` tagged
leads (deleted afterwards, demo is back to zero) for the read paths, and Noel's real
450-lead tenant for scale and the status write. Structural claims were checked in the DOM
rather than by eye, since a screenshot cannot prove a row is 44px or that a sort made no
network call.

## UI / manual
- [x] Sign in, visit `/leads` → all of the caller's tenant leads load in one fetch (bounded 5000 rows), rendered as a virtual scrolled, 44px hairline table with columns business, trade, suburb, reviews, rating, website state, PSI, score (heat coloured), status, in that order → AC-1 · **450 of 450** on the real tenant; headers read exactly `Business, Trade, Suburb, Reviews, Rating, Website, PSI, Score ↓, Status`; virtual scroll renders 19 of 64 rows; measured row height 43.99px; numerics are `tabular-nums` in Geist Mono. The 5000-row bound was not reachable with 450 rows and remains untested
- [x] Default sort is score descending; click each column header → re-sorts client side with no network call (check devtools network tab) → AC-4 · instrumented `window.fetch` and `XMLHttpRequest.open` before clicking: **0 fetch, 0 XHR across all nine headers**, every sort ordered correctly
- [x] Open the drawer for a row (click or `enter` on the focused row) → the score line reads as a derivation, e.g. `49.1 = 63 reviews × (3.9/5) × 1.0 (no website)`, matching the row's rating/reviews/website state/PSI → AC-2, AC-7 · observed `233.1 = 350 reviews × (3.7/5) × 0.9 (social only)`, arithmetic and row values agree
- [x] With no non-heat filters active, heat cells span light-to-deep violet across the loaded set; toggling a `trade`/`suburb`/`website`/`status`/PSI/rating filter narrows the row set and heat cells visibly recompute against the new (smaller) basis → AC-3 · collected all 64 rows' heat colours unfiltered, then filtered to the 12 no-website rows: **9 of those 12 changed band**. `vfy Trade Co 30` (187.8) went heat-4 → heat-2
- [x] Select a heat band chip (e.g. `heat-4`) → the row set narrows to that band only, and the *other* bands' cells do not appear (the heat filter itself never re-buckets) → AC-3 · 9 of 64 shown, single distinct band `heat-4`
- [x] Filter to a set where every visible row has the same score → heat cells still render (collapsed to however many bands are distinct, not forced to 5) → AC-3 · narrowed to 6 rows with 4 distinct scores → exactly 4 contiguous bands (heat-0..heat-3), not 5
- [x] Toggle trade/suburb/website state/status/heat band chips in combination → rows filter correctly for all combinations; chip options match values present in the *loaded* rows only → AC-5 · `Social only` + `contacted` → 4 rows, all matching both. Chip options are derived from loaded rows: with only 2 suburbs present in the seed, only those 2 suburb chips rendered
- [x] Set a PSI range and a rating minimum → rows with a null value on that field disappear while the bound is active → AC-5 · PSI ≥ 30 → 27 rows, zero null-PSI visible; rating ≥ 4 → 23 rows, zero null-rating visible, minimum observed exactly 4
- [x] Type in the search box → filters to matching business names only → AC-5 · `Co 6` → 6 rows, every one containing the term
- [x] Press `j`/`k` repeatedly → row focus moves and the virtual list auto-scrolls to keep it visible; press `enter` → opens the drawer for the focused row → AC-6
- [x] With the drawer open, the URL shows `?lead=<id>`; refresh the page → the same drawer reopens on load → AC-7 · full reload reopened the same lead
- [x] Signed in as a normal tenant, change the drawer's status dropdown → the row's status updates in the grid and in Postgres (`leads.status`) → AC-8 · `Blue Mountains Painting` identified → shortlisted, grid row updated optimistically, confirmed in Postgres with a refreshed `updated_at`, then restored to `identified`
- [x] Signed in as the demo tenant, open a lead's drawer → the status dropdown is disabled with a "Read only in the demo" tooltip, and no write is attempted → AC-8, AC-13 · `disabled=true`, `title="Read only in the demo"`. The same control on the real tenant is enabled with no title, so the flag genuinely discriminates. Server side proven separately in SQL (see spec 0003's verify)
- [x] Press `Cmd/Ctrl+K` → the palette opens; type a business name substring → matching leads appear as "Jump to a lead" actions; select one via keyboard → opens that lead's drawer and closes the palette → AC-9
- [x] With no lead focused or open, `Cmd/Ctrl+K` → no "Set status" actions appear → AC-9
- [x] With a lead focused or open, `Cmd/Ctrl+K` → "Set status: …" actions appear for that lead (not shown for demo tenant) → AC-9 · on the demo tenant with a row focused the palette offered **zero** Set-status actions and exactly the six quick filters
- [x] Run each fixed quick filter from the palette → each applies the expected filter; "Hottest quintile" matches the `heat-4` chip filter's result set → AC-9 · No website 12, Social only 13, Poor PSI 9 (all non-null and < 40), Contacted 11, Clear filters 64, **Hottest quintile 9 — identical to the heat-4 chip**
- [x] A tenant with zero leads visiting `/leads` → sees a plain empty-state message with no call to action → AC-10 · demo tenant before seeding: "No leads yet. Run a scan to start finding them."
- [x] Throttle the network (or reload) and observe the initial fetch → a plain loading message shows, never a skeleton shimmer → AC-11 · template renders a plain `Loading leads…`; a repo-wide grep for `skeleton|shimmer|animate-pulse|backdrop-blur|gradient` across `src/app/` returns **nothing**

## Commands
- [x] `npm test` → all `score.ts` unit tests pass → AC-2 · **22/22**. Was 21/22 before this pass: `app.spec.ts` still carried the Angular scaffold's "should render title" test asserting an `h1` reading `Hello, sweep`, which stopped existing when the real template landed. Replaced with a test of what `App` actually does (hosts a router outlet)
- [x] `npx ng build` → clean, no errors → AC-1..AC-13 · builds, routes correctly lazy-chunked (leads-grid 50.67 kB, login 39.17 kB, app-layout 35.15 kB). **One warning, not clean**: initial bundle 524.69 kB against a 500 kB budget, 24.69 kB over. See Open
- [x] Query `scoring_profiles` for each existing tenant → exactly one `is_default = true` row per tenant, `name = 'Default'`, weights matching `harvest.mjs`'s constants → AC-12 · both tenants, one row each, weights identical to `DEFAULT_SCORING_WEIGHTS`

## Acceptance-criteria coverage
AC-1 … AC-13 all covered. AC-1's 5000-row bound is the single sub-clause not exercised (needs a tenant with more than 5000 leads).

## Findings from this pass

Neither of these is a spec violation; both are worth a decision.

- **The demo tenant's read-only-ness is invisible until you try.** The disabled `select` has `opacity: 1` and `cursor: default`, so it looks ordinary; and RLS refuses the write *silently* — an `UPDATE` from the demo user matches 0 rows and raises nothing, because the policy's `USING` clause filters the row out rather than failing a `WITH CHECK`. Two consequences: a visitor gets no feedback, and **client code must never infer success from the absence of an error** on a demo write.
- **Sign out does not leave the authenticated screen.** Clicking Sign out clears the header email but leaves the grid and its data rendered on `/leads`; the guard only runs on navigation, so the redirect happens on the next route change (verified: navigating afterwards correctly bounces to `/login`). Minor privacy wrinkle on a shared machine.
- **Palette quick filters merge rather than replace.** Running `No website` then `Contacted` intersects them rather than swapping. Defensible — `Clear filters` exists precisely to reset — but it surprised this pass into a false "0 of 64" reading before the cause was spotted.

## Notes for whoever runs this next

Two harness traps cost time here and are not app bugs:

- **Do not close the drawer with `history.replaceState()`.** It desyncs Angular's router, after which `isDemo()` reads stale and the palette wrongly offers Set-status actions on the demo tenant. This looked exactly like a real AC-9 violation for several minutes. Close the drawer through the UI.
- **`Cmd+K` needs the page to have focus.** After a programmatic `navigate`, focus sits outside the document and the shortcut silently does nothing. Click anywhere in the page first.

## Open

- The `ng build` bundle-budget warning above. Routes are already lazy; the 506 kB initial is framework plus the Supabase client that auth needs at bootstrap, and 125 kB gzipped is respectable. Either raise `maximumWarning` in `angular.json` to reflect reality or do bundle work — a decision for Noel, not something to silently re-baseline.
- AC-1's 5000-row fetch bound, untestable at 450 leads.
