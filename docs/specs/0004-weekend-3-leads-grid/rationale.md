# 0004. Leads grid — rationale

## Context

Weekend 2 shipped the engine: a scan runs, discovers businesses, checks their PageSpeed
score, and writes every result into Postgres. Nothing reads any of it back yet — the only
way to see a scan's results today is a direct SQL query. `BUILD-PLAN.md` §10 calls the
leads grid "the screen that proves the palette works at density", which sets the actual
bar: this is not just a table, it is the first evidence that the light violet, hairline,
mono-numeric design system (validated in isolation by the weekend 0 style tile) survives
contact with several hundred real rows.

Two forces shape the build order more than anything else. First, `AGENTS.md` hard rule 6:
there is no `score` column, and there must never be one — score is always derived client
side from `rating`, `rating_count`, `website_kind`, and the latest PSI score. This is what
makes the weekend 6 scoring lab possible (drag a weight slider, 2000 scores re-derive and
the grid re-sorts with no round trip), so whatever this weekend builds has to already be
shaped for that, not retrofitted later. Second, the grid is being built out of order
relative to the screens it would naturally link to: the scan builder (weekend 7), the map
(weekend 6), and the lead detail page (weekend 5) do not exist yet. Every decision below
that touches navigation has to account for that gap honestly rather than assume screens
that are not there.

The scoring formula itself is not a new design; it is a port. `harvest.mjs`'s `penalty()`
and `score()` functions are the actual formula in production use today, and
`BUILD-PLAN.md` already documents the target `ScoringWeights` shape it becomes. The
decision here is not "what should the formula be", it is "how does an unbounded,
review-count-weighted score map onto a five-band heat colour" — which turned out to need
checking against real data rather than assuming.

## Options considered

### Option 1: Client side single fetch, computed sort/filter/score (recommended)

One `httpResource()` call loads the tenant's `lead_rows` (bounded `limit 5000`) into
`leads.store.ts`. Sort, filter, and score are `computed()` signals over that array; every
interaction re-derives in the same frame with no request.

**Pros**:
- No round trip on sort, filter, search, or a scoring weight change — the exact property
  the scoring lab (weekend 6) already assumes exists (`BUILD-PLAN.md` §5: "a `computed()`
  signal re-derives 2,000 scores and the grid re-sorts in the same frame").
- One query, one loading state, one error state to build.
- Matches the confirmed data scale: 450 leads today, a full 288 query scan adds low
  hundreds more per run.

**Cons**:
- Does not scale past roughly 5000 to 10000 rows in one browser tab; would need to become
  server paginated if the business ever runs at a scale this project's own Google Places
  budget (1000 free calls a month) cannot approach.

### Option 2: Server side filter, sort, and pagination

Every sort, filter, or page change sends new query params to PostgREST and re-fetches a
page.

**Pros**:
- Scales to any row count without a client side memory ceiling.
- Database does the sorting work it is already good at.

**Cons**:
- Every interaction becomes a network round trip, which directly contradicts the "no round
  trip" scoring lab premise this same `lead_rows` view and `score.ts` are being built to
  support next weekend — the scoring lab would need to be rebuilt server side to keep it
  live.
- Score cannot be sorted or filtered server side at all, since it is deliberately not a
  database column (`AGENTS.md` hard rule 6). Every score dependent interaction would still
  need the whole page loaded client side anyway, defeating the point.

### Option 3: Hybrid — server paginated initial load, client side refine within the page

Fetch one page server side, then filter/sort only within it client side.

**Pros**:
- A middle ground on data volume.

**Cons**:
- Filtering within a partial page silently hides leads that would match outside the loaded
  page, which is actively misleading for a triage tool — a filter for "no website" should
  show every no-website lead, not just the ones that happened to be in the first page.
  Solves a scale problem the project does not have at the cost of a real one it does.

## Rationale

Option 1 wins because the project already committed to its consequence one weekend early:
the scoring lab spec (`BUILD-PLAN.md` §5, §8 section 6) is only buildable if the full lead
list already lives client side as reactive signals. Building the grid server paginated now
and rebuilding it client side in three weekends is strictly more work than building it
client side once. The data scale confirms this isn't a premature optimisation either — see
the query below.

The heat bucketing decision (percentile of the visible set, over fixed absolute
thresholds) came out of checking the real formula against the real data rather than
trusting the style tile's placeholder thresholds, which were never calibrated against the
actual `score()` formula (see evidence below). A fixed cutoff tuned to today's distribution
would need re-tuning as more scans run and the distribution shifts; a percentile-based
bucket stays correct by construction.

### Evidence: real score distribution vs. the style tile's placeholder thresholds

Queried directly against the live project (`ifwyufrepqkzsicjinfi`) during design, computing
`harvest.mjs`'s actual formula over the 450 leads that exist today:

```
p0    p25   p50   p75   p90   p100    zero_count / total
0.0   0.5   2.6   7.6   14.2  102.5   88 / 450
```

The style tile's illustrative heat thresholds (`>=80`, `>=65`, `>=45`, `>=25`) were tuned
for a 0 to 100 scale and would put nearly every real row (p90 is only 14.2) into the
coldest band. Roughly a fifth of leads score exactly 0 (a good site with good PSI — the
formula's floor, not noise). This is why bucketing has to be relative to whatever's on
screen, not an absolute cutoff.

`scoring_profiles` was also confirmed empty (`select count(*) from scoring_profiles` → 0)
for both tenants, which is why AC-12's migration and AC-2's fallback path both exist —
without either, `score.ts` would have nothing to compute against on a fresh read.

## References

None. This spec reuses decisions `BUILD-PLAN.md` already locked (CDK virtual scroll, NgRx
SignalStore, Angular Aria, the `ScoringWeights` shape) rather than evaluating new external
tools, so there is little outside the project itself to cite.
