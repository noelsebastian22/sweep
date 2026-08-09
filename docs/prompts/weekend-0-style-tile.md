# Weekend 0 — Angular 22 scaffold + style tile

Paste the block below into Command Code (`cmd`) from the repo root.

Run it in **Plan mode first** (`shift+tab` until you see Plan, or `cmd --plan`). The
scaffold decisions are hard to unpick once `ng new` has run, so it's worth reading the
plan before letting it write.

---

```
/session-handoff start

Then: scaffold the Angular app and build the style tile — weekend 0 in BUILD-PLAN.md §10.

Read AGENTS.md and BUILD-PLAN.md §7 in full before writing anything. §7 is the spec for
this task; every token, size and radius in it was measured from a reference screenshot,
so use those exact values rather than approximating.

SCAFFOLD
- Angular 22, standalone, zoneless, strict TypeScript. App at the repo root, not a
  subfolder.
- provideZonelessChangeDetection() and provideRouter(routes, withViewTransitions()).
- Tailwind v4. Put every §7 token in @theme in a single global stylesheet — surfaces,
  rules, ink, violet, the five-step heat ramp, warn/fail/ok, the four radii.
- Geist Sans and Geist Mono, self-hosted, not from a CDN. Preload the two weights the
  hero uses.
- Do NOT install Supabase, MapLibre, Motion One or NgRx yet. This task renders nothing
  from the database and I don't want dependencies landing before they're needed.

STYLE TILE at /style
One scrolling route that renders the whole system against real-looking data. Sections:

1. Colour — every token as a labelled swatch with its hex and its contrast ratio against
   white, computed at runtime, not hardcoded. Flag anything under 4.5:1.
2. Type — the full scale from §7 (display-1 through stat), each row labelled with its
   token name, px size and line-height in mono.
3. Buttons — primary and secondary, at both 56px marketing and 40px in-app heights, in
   rest / hover / focus-visible / disabled.
4. Inputs — text field, select, checkbox, and the eyebrow pill.
5. Hairline table — 20 rows of realistic fake lead data: business name, trade, suburb,
   review count, rating, website state, PSI score, score with a heat cell, status.
   44px rows, hairline separated, no card borders, every number mono and tabular.
   Include a row with a null PSI and a row with no website — the empty states matter
   more than the happy path.
6. Stat blocks — an 11px uppercase tracked mono label above a 30px mono number, four
   across. The scale contrast between label and number is the point.
7. Radar sweep — an SVG conic-gradient sweep, 4s linear infinite, over a light panel.
   This is the one motion that was designed for a dark background and may wash out on
   white. Build it, then tell me honestly whether it reads. If it doesn't, show me a
   violet-tinted panel variant next to it rather than just darkening the sweep.

CONSTRAINTS
- Radius 10px default, 6px small controls, pill only for the eyebrow and avatars.
- Elevation is a hairline, not a shadow. One shadow token, overlays only — nothing on
  this page should use it.
- Every number: font-variant-numeric: tabular-nums. No exceptions.
- Banned: fade-up-on-scroll, gradient text, skeleton shimmer, glassmorphism, mesh
  gradient blobs, any decorative animation. The palette is a common one and these are
  exactly the moves that would make it look generated.
- No placeholder copy. Fake data must look like real Blue Mountains trade businesses.

VERIFY BEFORE YOU TELL ME IT'S DONE
- npm run build passes with no warnings.
- Tab through the whole page: every interactive element has a visible focus ring.
- The contrast readouts on the colour section agree with the table in §7. If any
  disagree, the token is wrong — tell me, don't silently adjust it.
- Screenshot /style at 1440px and at 390px and show me both.

Then run /session-handoff.
```

---

## Why it's shaped like this

- **`/session-handoff start` first** so Command Code reads the log and the git state
  before proposing anything, rather than trusting the prompt alone.
- **Plan mode** because scaffold decisions are expensive to reverse.
- **Dependencies explicitly deferred.** Left unsaid, an agent will install the whole
  stack on day one and the first commit becomes unreviewable.
- **Contrast computed at runtime.** If a token is wrong, the page says so — that's the
  difference between a style tile and a screenshot.
- **The radar sweep asks for an honest verdict.** Framing it as a question rather than
  an instruction makes a "this doesn't read" answer possible.
- **Empty-state rows are mandated.** A table of twenty perfect rows proves nothing; the
  null PSI and no-website rows are the ones that break layouts.
- **Screenshots at two widths** because "done" claims are cheap and images aren't.
