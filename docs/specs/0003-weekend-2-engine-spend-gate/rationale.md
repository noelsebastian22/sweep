## Context

`harvest.mjs` at the repo root already does the real work: search Google Places for sixteen trades across eighteen Blue Mountains suburbs, filter out landmarks and cafés, check the site speed of anything with a website, score the result, and write the best fifty to Notion. It runs once, by hand, from a terminal.

Weekend 1 built the plumbing this port needs: the full schema (`scans`, `scan_queries`, `businesses`, `psi_results`, `leads`), the `reserve_api_calls()` spend gate function tested against `free`/`paid`/`denied`/`no_budget`, the `pgmq` queues `sweep_search` and `sweep_psi`, and a `pg_cron` job named `tick` that currently runs a no-op `select 1` every minute.

The forces that shape this weekend are cost and time, not features. Google Places Text Search is billed at Enterprise tier, $35 per 1,000 calls, with 1,000 free calls a month; a full scan is 288 calls. `AGENTS.md`'s hard rule is absolute: no code path calls a metered API without a grant returning `free` or `paid` first, and a `denied` result parks the work rather than failing it. Supabase's free plan edge functions also cap wall clock time at 150 seconds, not the 400 seconds the paid plan allows, and the invocation budget is 500,000 calls a month, cheap to burn through with a naive per-function cron. Both bound the shape of the engine as much as the business logic does.

There is no UI this weekend. The acceptance test is a scan run from a terminal, verified by reading rows out of Postgres, not by clicking anything.

## Options considered

### Option 1: One `tick` function, three internal modules

`supabase/functions/tick/` is the only function the cron job invokes. `index.ts` is a thin entry point; `search.ts`, `psi.ts`, and `advance.ts` are plain TypeScript modules it imports and calls in sequence, each doing one stage of the work inside the same request and the same 120 second budget.

**Pros**:
- Matches `BUILD-PLAN.md` §6's own invocation math exactly: one edge function invocation per cron minute, 43,200 a month, about 9% of the free allowance.
- One shared time budget per tick; a scan that's mostly done with search can spend the leftover seconds on PSI in the same wake-up rather than waiting for a whole separate function's next turn.
- One deployment, one log stream to read while debugging a live run.

**Cons**:
- All logic runs in one process; a bug in `psi.ts` can only be tested by invoking the whole `tick` function, not `psi.ts` in isolation over HTTP.

### Option 2: Four separately deployed functions

`scan-create`, `worker-search`, `worker-psi`, and `scan-advance` each deployed independently. `tick` becomes a thin dispatcher making internal `fetch()` calls to the other three.

**Pros**:
- Each function is independently invokable and testable over HTTP without standing up the whole pipeline.
- Matches the descriptive table in `BUILD-PLAN.md` §6 literally, function name for function name.

**Cons**:
- Each `fetch()` call from `tick` to another function counts as its own edge function invocation, working against the invocation budget the naive-cron section of the same document explicitly warns about.
- Each function gets its own 120 second budget rather than one shared one; a tick that finishes search early can't spend the remainder on PSI, it has to wait for the next minute.
- Four deployments and four log streams to reason about instead of one.

## Rationale

`BUILD-PLAN.md` §6 states the invocation math in absolute terms ("One function, 43,200 invocations a month") right after describing the four logical stages, which only reconciles if the four collapse into a single deployed function at runtime. Reading the table literally as four deployed functions contradicts the document's own arithmetic two paragraphs later. A shared time budget is also the better fit for the actual workload: PSI checks run roughly 10 seconds each, so a tick with light search results and idle PSI time this minute should be able to spend it, not sit on it until the next wake-up. The cost, in return, is that `search.ts` and `psi.ts` can only be exercised by invoking the whole `tick` function during development — an acceptable tradeoff for a solo weekly tool where nobody else needs to invoke a worker stage independently.

## Implementation decisions made during the build (not in the original spec)

These weren't deliberated in `/architect` — they're local implementation choices made during `/develop`, recorded here so they're not silently invented twice.

- **`tick` talks to Postgres directly**, via `postgres.js` (`npm:postgres`) and `SUPABASE_DB_URL`, rather than through `supabase-js`/PostgREST. It needs raw `pgmq` calls (`pgmq.read`/`archive`/`set_vt`/`send`), which live in an extension schema PostgREST doesn't expose, and a conflict-aware `businesses` upsert (preserve `first_seen_scan_id`, overwrite everything else) that PostgREST's upsert syntax can't express — omitting a column from the `on conflict do update set` list is the native Postgres way to do this, and that requires raw SQL. `scan-create` still uses `supabase-js` with the caller's own JWT so RLS enforces tenant scoping normally; it's a small, purely CRUD function with no queue or extension-schema work.
- **The final-status computation reads `businesses_found`** (per the spec's own Value sourcing table), which per migration 08's trigger only counts genuinely new discoveries, not total businesses touched by a scan. See `index.md`'s Follow-up for the latent gap this creates.
- **The one-time Vault secret step never touched an agent's context.** `NOEL_PASSWORD` (set as a Supabase secret in a prior session) turned out to be unrecoverable when Noel forgot it — Supabase secrets are write-only, no tool (dashboard, CLI, MCP) can read one back. Rather than routing the real password or the service role key through this conversation, two small one-time edge functions were deployed and then deleted immediately after use:
  - `vault-setup` (`verify_jwt = true`): read `SUPABASE_SERVICE_ROLE_KEY` from its own auto-injected environment and wrote it into Vault via `vault.create_secret`. Invoked once with Noel's own user JWT.
  - `reset-password` (`verify_jwt = false`, gated by a throwaway `RESET_TOKEN` secret generated for this purpose and unset afterward): let Noel set a new Auth password for himself directly via the Admin API, using the service role key from its own environment. Necessary because `verify_jwt = true` would have been circular — the whole problem was he had no JWT to offer.
  Both are gone from the deployed functions and the repo; this paragraph is the only record they existed.

## References

None beyond `BUILD-PLAN.md` §4 and §6, already cited inline above.
