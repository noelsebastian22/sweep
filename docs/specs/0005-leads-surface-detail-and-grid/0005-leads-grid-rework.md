# 0005b. Leads grid: pagination, sticky header, filter bar

Child of [0005](index.md). Acceptance criteria live in the umbrella's `## Requirements`;
this file covers **AC-13** to **AC-22**.

## Summary

The grid stops being a scroll box inside a scrolling page. It renders one page of 25 rows at
its natural height with the column header stuck to the top of the viewport, and the page
itself scrolls normally so anything below the table is reachable. The filter bar collapses
from about forty chips into a row of multiselect dropdowns. Arrow keys become the primary
way to move, with the shortcuts printed in the table footer so they are findable.

## Why this shape

Today there are two scroll regions on one screen: `<main>` in `app-layout.ts`, and a
`cdk-virtual-scroll-viewport` hardcoded to `height:600px` at `leads-grid.ts:109`. The wheel
behaves differently depending on where the pointer sits, the table's bottom edge is
arbitrary, and the header scrolls away from the rows it labels. That is what reads as
unfinished, more than the height does.

Once the page is allowed to scroll so charts can sit beneath the table, a page of 25 rows
has nothing to virtualise. There is no scroll container and no overflowing list, so the
viewport component's only job disappears. This supersedes `BUILD-PLAN.md` §8.3, §10
weekend 3, and spec 0004's AC-1.

A fixed page size was chosen over measuring rows to fill the viewport because the measured
version only earns its `ResizeObserver` and its shifting page count if nothing may sit below
the fold, which is no longer true.

## Layout

```
  [ stat tiles ]                  ← sibling spec 0005c
  [ filter bar, one row ]
  ┌──────────────────────────────┐
  │ column header (sticky)       │
  ├──────────────────────────────┤
  │ 25 rows at 44px, hairline    │
  ├──────────────────────────────┤
  │ ↑↓ move · ⏎ open · ⌘K search │  1 to 25 of 450  page 1 of 18  ‹ ›
  └──────────────────────────────┘
  [ charts and scan context ]     ← sibling spec 0005c
```

**The sticky header's containing block has to be named or it will silently not stick.**
`position: sticky` resolves `top` against the nearest scrolling ancestor, and it fails
outright inside any ancestor whose `overflow` is not `visible`. Three changes make it work:

- `<main>` in `app-layout.ts` stays the page's only scroll container.
- `hairline-table.ts` drops `overflow:hidden` from its container, which is currently there
  to clip the border radius. The radius moves onto the first and last rows instead.
- The grid root drops `height:100%`, which currently exists to feed the viewport a height it
  no longer needs.

`top` is 0 unless sticky chrome is later added inside `<main>`, in which case it equals that
chrome's height.

The table container has no `overflow` and no fixed height. Rows stay 44px and hairline
separated, never boxed, per `AGENTS.md`.

The footer bar is one row: the keyboard legend at one end, the row range, page count and
page controls at the other, all mono with `tabular-nums`. With zero rows it reads `0 of 0`
with both controls disabled and rollover suppressed.

## Pagination and focus

Entirely in the browser. `LeadsStore` already loads every row in one query and derives
scoring, filtering, sorting and heat banding as `computed()` signals, so a page is a slice
of `sortedRows()` and turning a page issues no request. That preserves spec 0004's verified
behaviour of zero network calls across all nine column sorts, and it is also what the
weekend 6 scoring lab assumes.

**`focusedIndex` stays a global index into `sortedRows()` and `page` is derived from it.**
This is the decision that removes a whole class of desync bug, because `focusedIndex` is
already used by `focusedRow()`, by `moveFocus()`'s clamp, by the row click handler, and by
the `aria-selected` comparison. Introducing a second, page relative index would mean keeping
two things in step forever.

- `page` is `floor(focusedIndex / pageSize)`, or set directly by the footer controls, which
  then move `focusedIndex` to that page's first row.
- Row templates compare against `page * pageSize + i` rather than the bare template index.
- **Rollover falls out for free.** `moveFocus(±1)` already clamps to the whole array, so
  moving past a page edge simply lands on an index whose derived page is the next one. No
  edge case code is needed.
- The palette's jump to lead becomes
  `focusIndex(sortedRows().findIndex(r => r.lead_id === id))`, and the page follows.

**One reset path.** `setFilters`, `clearFilters` and `toggleHeatBand` already reset
`focusedIndex`; `setSort` does not, which is an existing inconsistency. All four route
through a single private `resetPosition()` so a future filter method cannot forget.

**Heat bands stay computed over the whole filtered set**, never the page, so a lead's band
does not change when you turn a page. This already works correctly through `heatBasis()` and
must not regress.

Default page size is 25, not measured and not configurable in this spec.

## URL state

Page, sort and every filter go in the URL, so a reload behaves and a view can be sent to
someone. This is also the honest precursor to the saved views that spec 0004 deferred.

| Param | Shape |
|---|---|
| `page` | `3`. Omitted when 1. Clamped to the last page on parse, rewriting the URL |
| `sort` | `score.desc`. Validated against `SortColumn`; anything unknown falls back to `score.desc` |
| `q` | The search text. Present because search is a filter and was missing from the first draft of this table |
| `trades`, `suburbs`, `statuses`, `kinds`, `heat` | Comma joined, each element percent encoded before joining, because trade and suburb values are free text from the view and may contain a comma. Omitted when empty |
| `psi` | `min-max`, with either side allowed to be empty: `40-`, `-40`, `20-60`. Omitted when both are null |
| `rating` | A bare number, `4.2`. Omitted when null |

Heat bands that no longer exist in the current basis are dropped on parse rather than
filtering everything to nothing.

**History behaviour.** Footer page changes, sort changes and filter commits push a real
history entry, because AC-17 asks the back button to step through them and a replace leaves
nothing to step back to. Two things replace instead: search keystrokes, which would
otherwise fill the stack one character at a time, and **keyboard page rollover**, because
walking 450 rows with the arrow keys crosses seventeen page boundaries and would push
seventeen entries nobody asked for.

**Parsing is a live subscription, not a one time read on entry.** Two flows break if the
store is seeded only when the route is first entered:

- The back button through the pushed entries above changes query params **without**
  re entering the route, so nothing would re seed the store and the URL and the grid would
  drift apart.
- Returning from `/leads/:id` after walking prev and next re enters `/leads` with the old
  `page` in the URL, which would reset `focusedIndex` to that page's first row and throw
  away the handoff the cross child contract promises.

So the grid subscribes to `queryParamMap` for as long as it is mounted, with a loop guard so
a store to URL write does not immediately read back as a URL to store write.

**Precedence is decided by when, not by whether the pages agree.** The tempting rule, that
`focusedIndex` wins whenever its derived page already matches the URL, fails at exactly the
moment it is needed: walking prev and next from row 74 to row 75 crosses from page 3 to page
4, so on return the pages do not match and the URL would win and throw the position away.
The rule is:

- **On component construction**: if the store is already loaded and `focusedIndex` is not 0,
  the store wins and the grid immediately writes its derived page to the URL with
  `replaceUrl`. This is the return from `/leads/:id`, however you got back to it. Otherwise,
  on a cold load or a fresh app, the URL wins and seeds the store.
- **While the component stays mounted**: the URL always wins, which is what makes the back
  button work through the pushed entries.

Prev and next on the detail page navigate with `replaceUrl: true`, so one back press returns
to the grid rather than walking back through every lead visited.

`?lead=` retires; `/leads/:id` is the deep link now.

## Keyboard

| Key | Action |
|---|---|
| Arrow up and down | Move row focus. The primary binding |
| `j` and `k` | The same, kept so existing muscle memory and spec 0004's AC-6 still hold |
| Enter | Open the preview drawer |
| `⌘K` | Palette, unchanged |

Focus rolls across page boundaries, which is a consequence of `focusedIndex` being global
rather than a feature that needs writing. The 450 leads behave as one continuous list to the
keyboard, which is the triage flow `BUILD-PLAN.md` §8.3 describes.

Arrow keys are primary because `j` and `k` are a vim convention that is invisible to anyone
who does not already know it, and a grid whose stated job is to prove keyboard craft cannot
prove it with shortcuts nobody can find. The footer legend is what actually fixes that, not
the binding change.

## Filter bar

One compact row replacing the wrapping chip block. Seven controls plus the search field:
Trade, Suburb, Website, Status, Heat, PSI range, Rating minimum. Each opens a dropdown of
checkboxes rather than spilling every option onto the page. Filters that are currently
active stay visible on the closed control, so nothing hides state.

Built on primitives already installed, not hand rolled and not Angular Material:

- **`Combobox`** and **`ComboboxPopup`** from `@angular/aria` for the trigger and popup.
- **`Listbox`** from `@angular/aria` with `multi` set and `selectionMode="explicit"`, which
  is exactly checkbox behaviour: arrows move without selecting, space or click toggles. Its
  `value` is a `ModelSignal<V[]>`, so it binds straight to the store's filter arrays.

There is no paginator in `@angular/aria` or `@angular/cdk`. `MatPaginator` belongs to
Angular Material, which is not a dependency and would bring a theming layer that fights the
§7 tokens for one control, so the footer page controls are built directly.

## The drawer

Reduced to a read only preview. It still opens on row click and on Enter, still shows the
lead, and gains a single button through to `/leads/:id`. It loses its status control, so the
detail page becomes the only place status and notes are written.

One write path rather than two matters here because both would call the same `updateStatus`
and both would need the same demo tenant disabling, and that is the kind of duplication that
drifts. The button is focusable, so Enter twice takes you from the grid to the full page
without touching the mouse.

## Migration plan

**Strategy**: fix in place, one deployment. No data is transformed and nothing runs in two
modes at once, so the strangler pattern would be overhead here.

**Phases**

1. Store changes first: `page` derived from `focusedIndex`, the shared `resetPosition()`,
   and the two way URL sync with its loop guard, with the viewport still in place. Paging is
   provable before anything is rendered differently.
2. The viewport is removed and the sticky header and footer replace it, together with the
   three containing block changes above.
3. Keyboard, filter bar and drawer follow independently; each is revertible on its own.

**Rollback**: revert the commit. No schema change belongs to this child spec, so there is
nothing to unwind in the database.

**Risks**

- Removing virtual scrolling gives up a measured behaviour spec 0004 verified, 19 of 64 rows
  rendered. If a page size well beyond 25 is ever wanted, this decision needs revisiting
  rather than quietly reintroducing a scroll container.
- Sticky positioning fails silently. If the header does not stick, the cause is an ancestor
  with `overflow` set, and the three changes named above are the places to check first.
- The palette's jump to lead currently assumes every row is rendered. Routing it through the
  global `focusedIndex` fixes that, but it is the path most likely to be missed.
- `setSort` not resetting position is a live inconsistency today; folding it into
  `resetPosition()` changes existing behaviour, which is intended but worth noticing during
  verification.
- The two way URL sync is the highest risk piece in this child spec. Without the loop guard
  it oscillates, and with the wrong precedence rule it silently eats the prev and next
  handoff from the detail page at exactly the page boundaries where it matters. Both are
  easy to get wrong and neither fails loudly.

## Build order

Slices 10 to 15 in the umbrella's `## Build plan`.
