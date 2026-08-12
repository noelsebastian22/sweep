# Verify: weekend-3-leads-grid · spec 0004 · updated 2026-08-12
_Steps derived from spec 0004 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Sign in, visit `/leads` → all of the caller's tenant leads load in one fetch (bounded 5000 rows), rendered as a virtual scrolled, 44px hairline table with columns business, trade, suburb, reviews, rating, website state, PSI, score (heat coloured), status, in that order → AC-1
- [ ] Default sort is score descending; click each column header → re-sorts client side with no network call (check devtools network tab) → AC-4
- [ ] Open the drawer for a row (click or `enter` on the focused row) → the score line reads as a derivation, e.g. `49.1 = 63 reviews × (3.9/5) × 1.0 (no website)`, matching the row's rating/reviews/website state/PSI → AC-2, AC-7
- [ ] With no non-heat filters active, heat cells span light-to-deep violet across the loaded set; toggling a `trade`/`suburb`/`website`/`status`/PSI/rating filter narrows the row set and heat cells visibly recompute against the new (smaller) basis → AC-3
- [ ] Select a heat band chip (e.g. `heat-4`) → the row set narrows to that band only, and the *other* bands' cells do not appear (the heat filter itself never re-buckets) → AC-3
- [ ] Filter to a set where every visible row has the same score (e.g. filter to a single website state + status combination with identical rating/reviews if available) → heat cells still render (collapsed to however many bands are distinct, not forced to 5) → AC-3
- [ ] Toggle trade/suburb/website state/status/heat band chips in combination → rows filter correctly for all combinations; chip options match values present in the *loaded* rows only → AC-5
- [ ] Set a PSI range and a rating minimum → rows with a null value on that field disappear while the bound is active → AC-5
- [ ] Type in the search box → filters to matching business names only → AC-5
- [ ] Press `j`/`k` repeatedly → row focus (highlighted background) moves down/up and the virtual list auto-scrolls to keep it visible; press `enter` → opens the drawer for the focused row → AC-6
- [ ] With the drawer open, the URL shows `?lead=<id>`; refresh the page → the same drawer reopens on load → AC-7
- [ ] Signed in as a normal tenant, change the drawer's status dropdown → the row's status updates in the grid and in Postgres (`leads.status`) → AC-8
- [ ] Signed in as the demo tenant, open a lead's drawer → the status dropdown is disabled with a "Read only in the demo" tooltip, and no write is attempted → AC-8, AC-13
- [ ] Press `Cmd/Ctrl+K` from `/leads` (and from another app-shell route) → the palette opens; type a business name substring → matching leads appear as "Jump to a lead" actions; select one (via keyboard) → opens that lead's drawer and closes the palette → AC-9
- [ ] With no lead focused or open, `Cmd/Ctrl+K` → no "Set status" actions appear in the list → AC-9
- [ ] With a lead focused or open, `Cmd/Ctrl+K` → "Set status: …" actions appear for that lead (not shown for demo tenant) → AC-9
- [ ] Run each fixed quick filter from the palette (No website, Social only, Poor PSI, Hottest quintile, Contacted, Clear filters) → each applies the expected filter; "Hottest quintile" matches the `heat-4` chip filter's result set → AC-9
- [ ] A tenant with zero leads visiting `/leads` → sees a plain empty-state message with no call to action → AC-10
- [ ] Throttle the network (or reload) and observe the initial fetch → a plain loading message shows, never a skeleton shimmer → AC-11

## Commands
- [ ] `npm test` → all `score.ts` unit tests pass (rating/rating_count/psi_score null handling, every `website_kind` value including `null`, each penalty tier, the no-row and partial-row fallback paths) → AC-2
- [ ] `npx ng build` → clean, no errors → AC-1..AC-13 (build-time correctness)
- [ ] Query `scoring_profiles` for each existing tenant → exactly one `is_default = true` row per tenant, `name = 'Default'`, weights matching `harvest.mjs`'s constants → AC-12

## Acceptance-criteria coverage
- AC-1 … visit `/leads`, column/row/virtual-scroll checks · AC-2 … drawer derivation string + unit tests · AC-3 … heat basis recompute, band-filter non-circularity, degenerate-set collapse · AC-4 … column sort clicks, no network call · AC-5 … filter chip/range/search checks · AC-6 … `j`/`k`/`enter` · AC-7 … drawer fields + `?lead=` persistence · AC-8 … status write + demo disablement · AC-9 … palette jump/status/quick-filters · AC-10 … empty state · AC-11 … loading placeholder · AC-12 … migration query · AC-13 … demo disablement (shared with AC-8)
