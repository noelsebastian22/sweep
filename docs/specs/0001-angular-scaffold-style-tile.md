# 0001. Angular 22 scaffold and weekend 0 style tile

**Date**: 2026-08-09
**Status**: In Progress

## Summary

Scaffold the Angular 22 application at the repo root and build a style tile route that renders every design token from BUILD-PLAN.md §7 against real looking data. The tile is the quality gate: if the palette works under density it sticks, if not we catch it before six screens are built on it. No database, no Supabase client, no heavier dependencies land yet.

## Context

The backend foundations are done (Supabase project, 16 tables, RLS, spend gate) but nothing on the frontend exists. BUILD-PLAN.md §7 defines the design system in detail: one light violet palette, Geist Sans and Mono self hosted, a type scale from 52px display to 11px stat labels, specific component geometry measured from a reference screenshot, and a motion ban list. The palette is the most common one in B2B SaaS (light, violet, rounded), and the failure mode is drift into generic. The style tile catches that before it spreads.

BUILD-PLAN.md §10 orders the style tile as Weekend 0, before the Angular half of foundations in Weekend 1. The task is deliberately scoped small: scaffold, Tailwind v4, tokens, one route. No NgRx, no Supabase client, no MapLibre, no Motion One — those land when they are needed.

## Requirements

**User story**: As the developer, I want to see every design token rendered on one page with computed contrast ratios and a dense realistic table, so I can judge whether the system holds up before building six screens on it.

**Acceptance criteria** (the contract):

- **AC-1**: A `/style` route renders every §7 colour token as a labelled swatch with its hex and its WCAG 2.1 contrast ratio against white, computed at runtime, and flags any ratio under 4.5:1.
- **AC-2**: The full type scale (display-1 through stat) renders with each row labelled by token name, px size, and line height in mono. Geist Sans and Geist Mono are self-hosted, not loaded from a CDN, and the two weights the hero uses are preloaded.
- **AC-3**: Primary and secondary buttons render at both 56px (marketing) and 40px (in-app) heights in rest, hover, focus-visible, and disabled states.
- **AC-4**: A text input, select, checkbox, and the eyebrow pill render against the §7 tokens. Tab through every interactive element on the page: each has a visible focus ring.
- **AC-5**: A hairline table renders 20 rows of realistic fake lead data (business name, trade, suburb, review count, rating, website state, PSI score, score with a heat cell, status). 44px rows, hairline separated, no card borders, every number mono and tabular. One row has a null PSI and one has no website.
- **AC-6**: A stat block section renders an 11px uppercase tracked mono label above a 30px mono number, four across, showing the scale contrast.
- **AC-7**: An SVG conic-gradient radar sweep renders over a light panel at 4s linear infinite. The verdict on whether it reads is written next to it; if it washes out, a violet-tinted panel variant appears beside it.
- **AC-8**: `ng build` passes with zero warnings. The page renders correctly at 1440px and 390px viewports per screenshots.

## Options considered

### Option 1: Angular 22 scaffold with ng new in the current directory (recommended)

Use `ng new sweep --directory . --routing --style css --ssr false --standalone --strict --zoneless --ai-config claude-code --test-runner vitest` to scaffold into the repo root. Tailwind v4 via the PostCSS plugin. Geist fonts downloaded from the Vercel GitHub releases and self-hosted via `@font-face` rules. Angular's `ng generate ai-config` adds an Angular MCP server config and an AGENTS.md (the existing AGENTS.md is preserved and the generated one is merged).

**Pros**:
- Supported by the Angular CLI, no manual config drift to maintain.
- The `--ai-config claude-code` flag generates agent aware project config that complements AGENTS.md.
- Angular 22 defaults: vitest test runner, standalone components, strict TypeScript, zoneless change detection. No legacy defaults to undo.

**Cons**:
- `ng new --directory .` overwrites any existing `angular.json`, `tsconfig.json`, or `src/` if they happen to exist. The repo is clean, so this is a non-issue for first scaffold.
- The generated AGENTS.md from `--ai-config` will need merging with the existing one rather than a blind overwrite.

### Option 2: Manual scaffold without the CLI

Write `angular.json`, `tsconfig.json`, `package.json`, and `src/` by hand to avoid any CLI surprises.

**Pros**:
- Full control over every configuration line, no generated cruft.

**Cons**:
- Fragile. Missed settings (e.g. zoneless, strict, vitest) surface as hard-to-debug build failures.
- No Angular MCP server config.
- Angular CLI updates change config defaults; hand-maintained configs drift.

### Option 3: Scaffold into a subdirectory then move files

`ng new sweep` into a sibling directory, then move all files to the repo root.

**Pros**:
- Clean scaffold without `--directory .` concerns.

**Cons**:
- Two steps where one suffices. Extra friction that serves no purpose since the repo is empty of Angular config.

## Decision

**Chosen option**: Option 1: Scaffold into the repo root with `ng new --directory .`.

The Angular CLI is the supported path and `--directory .` is designed for exactly this case. The repo has no existing Angular config to overwrite.

**Implementation skills**: none installed for Angular; the Angular docs and CLI are authoritative.

## Rationale

The CLI is the right tool for the job at this stage. Manual config introduces drift risk without benefit. The `--ai-config claude-code` flag generates an Angular MCP server config that gives Claude Code structured access to the project's Angular compilation, which directly helps future build tasks. The generated AGENTS.md will be merged with the existing one rather than discarded — it contains Angular specific conventions that the hand written AGENTS.md deliberately omits.

Tailwind v4 via PostCSS is the standard integration pathway with Angular's build toolchain. The Vite plugin approach would also work (Angular 22 uses Vite internally), but PostCSS is the more universal and documented path. The fonts come from Vercel's GitHub releases (`vercel/geist-font`) rather than `@fontsource` packages because the task specifies preloading only the two hero weights, and direct `@font-face` gives that control without pulling the full variable font range.

The contrast computation is a pure TypeScript utility implementing the WCAG 2.1 relative luminance formula. It is roughly ten lines and needs no dependency. Using an npm package for this would add a dependency for what amounts to `(L1 + 0.05) / (L2 + 0.05)`.

The style tile lives in one component, not seven. It is a reference page, not reusable UI. The components that do become reusable (table rows, buttons, inputs) will be extracted when building the actual screens in later weekends.

## Feature design

**Data model sketch**:

No backend data for this task. The fake lead data for the hairline table is an inline TypeScript array. Entity shape matches the `lead_rows` view and `businesses` table for realism:

| Field | Type | Notes |
|---|---|---|
| `business_name` | string | Realistic Blue Mountains trade business name |
| `trade` | string | e.g. Plumber, Electrician, Roofer |
| `suburb` | string | e.g. Katoomba, Springwood, Lawson |
| `rating` | number | 1.0 to 5.0 |
| `rating_count` | number | integer, realistic distribution |
| `website_kind` | string \| null | e.g. "Full site", "Facebook only", "None" |
| `psi_score` | number \| null | 0 to 100 |
| `score` | number | derived client side from rating, rating_count, website_kind, psi_score (matching the `shared/scoring/score.ts` contract even though that file does not exist yet — the heat cell uses a simplified version inline) |
| `status` | string | e.g. "new", "contacted", "ignored" |
| `heat_severity` | number | 0 to 4, the band index that selects the fill colour |

**API surface**: none. The page is fully static.

**Value sourcing**:

| Section | Value produced / displayed | Source |
|---|---|---|
| Colour swatches | hex colour value | CSS custom properties read via `getComputedStyle()` at runtime |
| Colour swatches | contrast ratio against white | TypeScript utility implementing WCAG 2.1 relative luminance formula |
| Colour swatches | Pass/Fail flag (under 4.5:1) | Computed ratio compared to threshold |
| Table rows | All lead data fields | Inline TypeScript array of 20 hardcoded rows |
| Heat cell | Fill colour (`heat-0` through `heat-4`) | Derived from `score` via a simplified banding function |

**Key invariants**:
- Every number in the UI has `font-variant-numeric: tabular-nums`, enforced by a global CSS rule on `[data-mono]`.
- Score heat is a fill colour only, never a text colour. The flip from `ink` to white happens between `heat-2` and `heat-3`.
- Radii: `10px` default, `6px` small controls, `999px` pill only for the eyebrow.
- One accent colour (`violet`) in use; `warn`, `fail`, and `ok` are semantic and appear only where their meaning applies.

**Security model**: the style tile is a development route with no authentication requirement. No sensitive data is rendered.

**Configuration required**:
- `STYLE`: `css` in `angular.json` (set at scaffold)
- Tailwind v4 `@theme` block defining all tokens from §7
- `postcss.config.mjs` with `@tailwindcss/postcss` plugin
- Preload `<link>` tags in `index.html` for Geist Sans weight 700 and Geist Mono weight 500

**Critical test scenarios**:
- Happy path: the page loads at `/style`, all seven sections render, `ng build` passes with zero warnings. Verifies **AC-1** through **AC-8**.
- Contrast verification: the computed ratios on the colour section match the table in BUILD-PLAN.md §7. If any disagree, the token is wrong and is corrected before the task is declared done. Verifies **AC-1**.
- Empty state rendering: the null PSI row shows a dash or "—" in the PSI column, the no-website row shows "No website" in the website column, and neither breaks the 44px row height. Verifies **AC-5**.
- Keyboard accessibility: tabbing through every interactive element on the page shows a visible focus ring on each. Verifies **AC-4**.
- Radar verdict: the sweep is built, and an honest assessment of whether it reads on the light panel is written on the page. If it does not, a violet tinted panel variant appears next to it for comparison. Verifies **AC-7**.

## Build plan

The project has no recorded build approach. Defaulting to end to end (Tracer Bullet) slices for production work. This feature is small enough to be one slice.

1. Scaffold Angular 22 with `ng new sweep --directory . --routing --style css --ssr false --standalone --strict --zoneless --ai-config claude-code --test-runner vitest`, choosing `claude-code` for the ai-config tool prompt. Commit the scaffold before adding anything else. Satisfies all ACs by establishing the build target.

2. Install Tailwind v4 and configure PostCSS: `npm install tailwindcss @tailwindcss/postcss`, create `postcss.config.mjs`, add `@import "tailwindcss"` and the full `@theme` block from BUILD-PLAN.md §7 to `src/styles.css`. Satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-6**.

3. Download and self-host Geist Sans (weight 700) and Geist Mono (weight 500) from `vercel/geist-font` GitHub releases into `src/assets/fonts/`. Write `@font-face` rules in the global stylesheet. Add `<link rel="preload">` for both in `index.html`. Satisfies **AC-2**.

4. Configure `provideZonelessChangeDetection()` and `provideRouter(routes, withViewTransitions())` in `app.config.ts`. Add the `/style` route. Satisfies **AC-1** through **AC-8** by wiring the route.

5. Build the style tile component at `/style` as one monolithic standalone component. Seven sections in order: colour swatches (rendered by iterating an array of token names and reading `getComputedStyle`), type scale, buttons (four states each), inputs, hairline table (20 rows of hardcoded fake data), stat blocks, and the radar sweep with verdict. Satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-7**.

6. Add the contrast computation utility inline in the component (WCAG 2.1 relative luminance formula). Flag any swatch under 4.5:1. Satisfies **AC-1**.

7. Add the fake lead data array with 20 realistic Blue Mountains trade businesses. Include one null-PSI row and one no-website row. Satisfies **AC-5**.

8. Verify: `ng build` passes with zero warnings. Tab through the page and confirm every interactive element has a visible focus ring. Screenshot at 1440px and 390px. Compare contrast readouts against the §7 table and fix any disagreements. Satisfies **AC-8**.

## Consequences

**Positive**:
- The design system is validated in one place before it spreads across six screens.
- The scaffold is committed clean before any feature code lands, making it easy to roll back or redo.
- Angular MCP config gives structured tooling access for future tasks.

**Negative / tradeoffs**:
- `ng new --directory .` could overwrite files if the repo had existing Angular config. It does not, so this is a theoretical risk only.
- The monolithic style tile component will be thrown away when real screens are built. That is intentional — it is a reference page, not production UI.
- The `--ai-config claude-code` flag was not available on the CLI version used. No generated AGENTS.md or `.mcp.json` were created. The existing hand-written AGENTS.md remains the single source of truth.

**Neutral**:
- The scaffold adds Angular config files (`angular.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.spec.json`, `package.json`, and `src/` with the app shell).
- Geist font files add roughly 100KB to the repo but are versioned alongside the code as intended.

## Follow-up

- [x] Merge the Angular generated AGENTS.md with the hand written one. The `--ai-config` flag was not supported by this CLI version, so no generated file was produced. The existing AGENTS.md is comprehensive and needs no merge.
- [ ] After the style tile is signed off, the monolithic component should be replaced with extracted reusable components (table, buttons, inputs) as part of the Weekend 1 Angular foundation task.
