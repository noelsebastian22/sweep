# Scope

## At a glance

| Feature | Status | Spec |
|---|---|---|
| Weekend 0: Style tile | in-progress | [0001](../specs/0001-angular-scaffold-style-tile.md) |
| Weekend 1: Angular foundations | in-progress | [0002](../specs/0002-weekend-1-angular-foundations.md) |

---

### Weekend 0: Style tile · in-progress

Angular 22 scaffold and a style tile route at `/style` rendering every design token from BUILD-PLAN.md §7. Validate the design system before building the full app.

**Decision**: Scaffold into the repo root with `ng new --directory .`, Tailwind v4 via PostCSS, Geist Sans/Mono self-hosted. One monolithic component at `/style` — a reference page, not production UI. [0001](../specs/0001-angular-scaffold-style-tile.md)

- [x] Design it (spec)
- [x] Build it: /develop weekend-0-style-tile · code in `src/app/style-tile/style-tile.ts`
  - [x] Scaffold Angular 22, Tailwind v4, fonts, and routing · satisfies AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-8
  - [x] Build the style tile component with all seven sections · satisfies AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7
  - [x] Verify build, contrast, keyboard, screenshots · satisfies AC-8
- [ ] Verify it: /check verify weekend-0-style-tile

### Weekend 1: Angular foundations · in-progress

Seed data, queue plumbing, keepalive, and the Angular app shell with email/password auth plus a placeholder dashboard. [0002](../specs/0002-weekend-1-angular-foundations.md)

- [x] Design it (spec)
- [ ] Build it: /develop weekend-1-angular-foundations
  - [ ] Backend: pgmq/pg_cron/pg_net migration, health function, seed function, UptimeRobot keepalive · satisfies AC-1, AC-2, AC-3, AC-4, AC-12
  - [ ] Frontend: Supabase client, AuthStore, login, auth guard, layout shell, dashboard · satisfies AC-5, AC-6, AC-7, AC-8, AC-9, AC-10
  - [ ] Verify ng build passes · satisfies AC-11
