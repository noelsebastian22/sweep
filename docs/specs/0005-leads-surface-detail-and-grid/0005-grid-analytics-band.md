# 0005c. Grid analytics band: tiles, charts, scan context

Child of [0005](index.md). Acceptance criteria live in the umbrella's `## Requirements`;
this file covers **AC-23** to **AC-26**.

## Summary

A row of counts above the table and a band of charts below it, all describing whatever the
filters currently select rather than the whole tenant. Nothing here fetches anything. Every
number and every series derives from signals `LeadsStore` already computes, so the whole
band costs one extra render and zero requests.

## Why this shape

The tiles go above the table and the charts below because the tiles are the cheapest and
densest information on the page and belong where the eye lands, while the charts are the
part you scroll to when you want to understand a filter rather than act on it. This is also
what makes the grid rework worth doing: the table stopped being a scroll box specifically so
this band would have somewhere to live.

The band is the least specified part of spec 0005 and the most likely to slip.
`BUILD-PLAN.md` §10 says that if a weekend slips, cut the map before the scoring lab. If
this band threatens weekend 6, it should be cut before either.

## Stat tiles

One mono row above the filter bar. Four tiles, each a count over `filteredRows()`:

| Tile | Derivation |
|---|---|
| Total in view | `filteredRows().length` |
| No website | count where `website_kind === 'none'` |
| Poor PSI | count where `psi_score` is not null and below `weights().poorThreshold` |
| Contacted | count where `status === 'contacted'` |

**No `website_kind` test is needed here, and that is a deliberate schema choice rather than
an omission.** Once the detail page's capture action measures a social lead, that lead would
have gained a real `psi_score` in `lead_rows`, because the view's measurement join filtered
on `error is null` and never on `website_kind`, and capturing a screenshot would silently
increment a tile about site performance for a business with no site. The weekend 5 migration
fixes that once in the view (`and b.website_kind = 'site'`) rather than at each of the four
places that read `psi_score`, so this tile, the chart below, the grid's PSI range filter and
its `psi_score` column sort are all correct with no special casing.

They update as filters change, because they read the same signal the table reads. Numbers
are mono with `tabular-nums`, per `AGENTS.md`. These are counts, not cards: hairline
separated, no boxes, no padding drift toward the failure mode `AGENTS.md` names.

`poorThreshold` comes from the tenant's default `scoring_profiles` weights, the same source
the grid and the detail page use, so all three agree on what poor means.

## Charts

Four, below the table, all over `filteredRows()`.

| Chart | What it shows | Why it earns space |
|---|---|---|
| Score distribution | Histogram of lead score, with the heat band boundaries marked | Shows immediately whether a filter has isolated anything worth calling |
| Website state split | The `none`, `social` and `site` breakdown | The strongest single signal in the scoring model, and the fastest read of whether a trade or suburb is worth prospecting |
| PageSpeed spread | Distribution of `psi_score` across leads that have a measurement, with the poor threshold marked | Separates has no site at all from has a bad site, which are different sales conversations |
| Leads over time | Discoveries bucketed by ISO week, from `first_seen_scan_started_at` | The clearest read that this is a working product rather than a static list |

PageSpeed spread needs no `website_kind` test either, for the reason given under the tiles:
the view no longer reports a `psi_score` for a business without a site.

**Hand rolled inline SVG, no charting library.** This is a decision, not an omission left
for the builder. Four charts of these shapes are a histogram, a split bar, a second
histogram and a small time series, which is on the order of 150 lines of SVG in the leads
route chunk and adds nothing to `main`. Any charting dependency works directly against the
bundle discipline that removed 98 kB on 13 August, for output this project does not need to
be interactive.

**Bins and bounds are fixed here rather than at build time.** Score is unbounded, since it
is `rating_count × rating/5 × penalty`, so the score histogram uses 20 bins over
`[0, max(score)]` of `filteredRows()`. PageSpeed spread uses 10 bins over the fixed
`[0, 100]` range, because that scale is defined. Leads over time buckets by ISO week.

**The band markers need deriving, because no existing signal holds them.**
`heatBandAssignments()` returns a `Map<lead_id, band>` and computes no score cut points, so
the marker positions are `max(score)` within each band, computed here. They are derived over
`filteredRows()`, the same set the histogram bins, **not** over `heatBasis()`. The two sets
differ whenever a heat filter is active, and taking the markers from the wider set would
draw boundaries that describe rows the chart is not showing.

The `dataviz` skill informs form, axes, legends and the light and dark treatment. It is not
installed in this repo's skills directory, which is recorded in the umbrella's Follow-up and
should be resolved before this slice starts rather than inventing conventions and
reconciling them later.

Two constraints from `AGENTS.md` bind harder than any skill's defaults and win where they
conflict: one accent only, violet `#6F58E3`, with warn, fail and ok used semantically and
nothing else coloured; and no decorative animation, which rules out entry transitions and
animated draw in. A chart may change when the data changes, but it does not perform.

## Scan context

Below the charts. Lists the scans that produced the leads currently in view, each with its
start date, how many of the leads in view came from it, and a link to `/scans/:id`.

This is where AC-25 and AC-26 would contradict each other if the schema were left alone.
`first_seen_scan_id` is a bare uuid, and `LeadsStore` holds no `scans` rows, so a date could
only come from a query, which AC-26 forbids. The weekend 5 migration therefore adds
`first_seen_scan_started_at` to `lead_rows` alongside the uuid, through a left join to
`scans`. The view is being replaced anyway, and this keeps the whole band a pure derivation.

**A scan is identified by its date and its link, and nothing else.** `scans` has no name or
label column, and adding one is scope this spec has no other reason to touch. `started_at`
is also nullable, populated when a scan leaves `queued`, so the view column is
`coalesce(s.started_at, s.created_at)`.

That column does double duty: scan context and the leads over time buckets. The detail
page's discovery entry looks the same but comes from a different place, its own FK hinted
`scans` embed, so that page renders on a cold visit without waiting for the grid's data.

## No network cost

The whole band derives from `filteredRows()`, `heatBandAssignments()` and `weights()`, all
of which `LeadsStore` already computes for the table. Nothing here adds a query, a
subscription or a round trip, which is what makes it affordable to recompute on every filter
change.

The one thing to watch is that four charts recomputing on every keystroke in the search
field is real work in the browser. If it shows, the fix is to debounce the search input
feeding the store, not to memoise each chart separately or to move any of this to the
server.

## Build order

Slices 16 to 18 in the umbrella's `## Build plan`, after the grid rework, since the band has
nowhere to sit until the table stops being a scroll container.
