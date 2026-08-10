# Scope

## At a glance

| Feature | Status | Spec |
|---|---|---|
| Weekend 0: Style tile | done | [0001](../specs/0001-angular-scaffold-style-tile.md) |
| Weekend 1: Angular foundations | done except keepalive | [0002](../specs/0002-weekend-1-angular-foundations.md) |

---

### Weekend 0: Style tile · done

Angular scaffold (v20 at the time, upgraded to v22 on 11 Aug) and a style tile route at `/style` rendering every design token from BUILD-PLAN.md §7. Validate the design system before building the full app.

**Decision**: Scaffold into the repo root with `ng new --directory .`, Tailwind v4 via PostCSS, Geist Sans/Mono self-hosted. One monolithic component at `/style` — a reference page, not production UI. [0001](../specs/0001-angular-scaffold-style-tile.md)

- [x] Design it (spec)
- [x] Build it: /develop weekend-0-style-tile · code in `src/app/style-tile/style-tile.ts`
  - [x] Scaffold Angular, Tailwind v4, fonts, and routing · satisfies AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-8
  - [x] Build the style tile component with all seven sections · satisfies AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7
  - [x] Verify build, contrast, keyboard, screenshots · satisfies AC-8
- [x] Verify it: `ng build` clean, contrast ratios checked against BUILD-PLAN.md §7 (see 10 Aug session log), re-verified visually 11 Aug on Angular 22

### Weekend 1: Angular foundations · done except keepalive

Seed data, queue plumbing, keepalive, and the Angular app shell with email/password auth plus a placeholder dashboard. [0002](../specs/0002-weekend-1-angular-foundations.md)

- [x] Design it (spec)
- [x] Build it: /develop weekend-1-angular-foundations
  - [x] Backend: pgmq/pg_cron/pg_net migration, health function, seed function · satisfies AC-1, AC-2, AC-3
  - [ ] UptimeRobot keepalive monitor · satisfies AC-4 — **still open**, needs an external UptimeRobot account signup
  - [x] Frontend: Supabase client, AuthStore, login, auth guard, layout shell, dashboard · satisfies AC-5, AC-6, AC-7, AC-8, AC-9, AC-10
  - [x] Verify ng build passes · satisfies AC-11
  - [ ] `get_advisors` re-run after the pgmq/pg_cron/pg_net migration · satisfies AC-12 — not confirmed run, do this before Weekend 2
