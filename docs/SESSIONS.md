# Session log

Shared memory between Claude Code and Command Code. Neither agent can see the other's
conversation; this file is the handoff.

Not a changelog — git covers that. This records **intent, dead ends, and open threads**:
the things that live in a conversation and would otherwise die with it.

Written by the `/session-handoff` skill. Newest entry first. Never edit a past entry; if
it turned out wrong, say so in a new one.

<!-- newest first -->

## 2026-08-09 · claude-code · design pivot + supabase foundations

**Did**
- Replaced `BUILD-PLAN.md` §7 wholesale. Retired the dark "field instrument" + warm-paper
  editorial pairing for one light violet system derived from a Snov.io screenshot Noel
  liked. Tokens sampled from the image, not eyeballed.
- Propagated through §1, §8, §9, §10 and open items. Added §13 (agent tooling) and §14
  (build status). Added a marketing landing page as screen 0 and a style tile as
  weekend 0.
- Created Supabase project `sweep`, ref `ifwyufrepqkzsicjinfi`, `ap-southeast-2`, PG 17.
- Applied the full §5 data model as 12 migrations. 16 tables, RLS on all of them,
  `lead_rows` view with `security_invoker = true`, `reserve_api_calls` +
  `refund_api_calls`, counter-rollup triggers on `scan_queries` and `businesses`.
- Verified the spend gate against §4: `free` → `denied` → `free` → `no_budget`.
- Switched the plan to Angular 22 and Cloudflare Workers at Noel's direction.
- Set up `AGENTS.md` as single source of truth, `CLAUDE.md` as a pointer,
  `supabase/migrations/` checked in, `.env.example`, `.gitignore`.

**Decided**
- Score heat is a **violet ramp**, not the old amber. Amber is now reserved for spend and
  quota, where a warning colour means something. Keeps the one-accent rule intact.
- Score heat is a **fill, never a text colour** — `heat-0` is 1.6:1 on white. Number sits
  in ink up to `heat-2`, white from `heat-3`.
- Lead detail loses the warm-paper trick. Grid↔detail contrast now comes from layout —
  full-bleed 44px rows vs a 720px single measure. If the detail page ends up looking like
  the grid with fewer rows, it has failed.
- Landing page built **last**, not first. Its layout is already decided by the reference,
  so building it early teaches nothing about whether the system survives real data.
- `awaiting_approval` added to `scan_status` at creation rather than bolted on later.

**Didn't work**
- `revoke execute ... from anon, authenticated` did **not** clear the advisor warnings.
  `PUBLIC` still held EXECUTE and both roles inherit through it. Had to
  `revoke ... from public`. Migration 11 exists only for this.
- `for all` write policies also cover `SELECT`, so every table was evaluating two
  permissive policies on every read. The performance advisor flagged all 15. Migration 12
  splits them into insert/update/delete. **Do not reintroduce `for all` policies.**
- Two Snov.io colours had to be rejected rather than copied: its meta grey `#9498A3` is
  2.9:1 on white and fails AA outright (darkened to `#7E8497`), and the amber equivalent
  needed darkening to `#A06A1C`.

**Open**
- `current_tenant()` and `current_tenant_is_demo()` still raise
  `authenticated_security_definer_function_executable`. **Intentional** — RLS policies are
  evaluated with the invoker's privileges, so `authenticated` must keep EXECUTE. Do not
  "fix" by revoking; it breaks every policy in the schema.
- Radar sweep was designed for near-black and may wash out on white. Unprototyped.
- Noel's older Supabase project (`noelsebastian22's Project`, May, Singapore) is
  **paused** — the §3 pause trap, confirmed before we shipped anything. Keepalive still
  not wired.
- No frontend exists at all.

**Next**
Weekend 0: scaffold Angular 22 + Tailwind v4 with the §7 tokens in `@theme`, and build the
style tile route at `/style`. Prototype the radar sweep on light there. Prompt is in
`docs/prompts/weekend-0-style-tile.md`.

**Touched** — `BUILD-PLAN.md`, `AGENTS.md`, `CLAUDE.md`, `.env.example`, `.gitignore`,
`supabase/migrations/*.sql` (12 files), `.agents/skills/session-handoff/SKILL.md`
