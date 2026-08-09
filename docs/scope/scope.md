# Scope

## At a glance

| Feature | Status | Spec |
|---|---|---|
| Weekend 0: Style tile | in-progress | [0001](../specs/0001-angular-scaffold-style-tile.md) |

---

### Weekend 0: Style tile · in-progress

Angular 22 scaffold and a style tile route at `/style` rendering every design token from BUILD-PLAN.md §7. Validate the design system before building the full app.

**Decision**: Scaffold into the repo root with `ng new --directory .`, Tailwind v4 via PostCSS, Geist Sans/Mono self-hosted. One monolithic component at `/style` — a reference page, not production UI. [0001](../specs/0001-angular-scaffold-style-tile.md)

- [x] Design it (spec)
- [ ] Build it: /develop weekend-0-style-tile
  - [ ] Scaffold Angular 22, Tailwind v4, fonts, and routing · satisfies AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-8
  - [ ] Build the style tile component with all seven sections · satisfies AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7
  - [ ] Verify build, contrast, keyboard, screenshots · satisfies AC-8
- [ ] Verify it: /check verify weekend-0-style-tile
