# Verify: weekend-2-engine-spend-gate · spec 0003 · updated 2026-08-13
_Steps derived from spec 0003 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._
_Note: `/check` and `/test` are not installed in this repo — `.claude/skills/` has only architect, audit, develop, impeccable, session-handoff. These steps were run by hand._

## Commands

- [x] `scan-create` with 2 trade_ids + 3 suburb_ids (Bricklayer + Builder × Blackheath/Blaxland/Bullaburra) → `{"scan_id": "..."}`, `scans` row `status='queued'`, `total_queries=6` → AC-1
- [x] Poll `scans` for that id until `status` reaches a terminal value, driven only by the cron-triggered `tick` (no manual intervention) → reaches `completed` within a few cron minutes, `completed_queries=6`, `failed_queries=0` → AC-2, AC-9
- [x] `select website_kind, count(*) from businesses where last_scan_id = <scan> group by website_kind` → all three kinds present (`site`/`none`/`social`), matching `businesses_found` → AC-3
- [x] `select count(*) from psi_results where scan_id = <scan>` → equals `psi_total`, and equals the count of `website_kind='site'` businesses that passed the ceiling cutoff, never `none`/`social` ones → AC-4
- [x] `select score, lcp_ms, cls, tbt_ms, fcp_ms, si_ms from psi_results limit 5` → all five metrics populated, no raw Lighthouse JSON column anywhere in the schema → AC-5, AGENTS.md hard rule 4
- [x] `select count(*) from leads l join businesses b on b.id=l.business_id where b.last_scan_id = <scan>` → equals `businesses_found` exactly (every business gets a lead, not just PSI-checked ones) → AC-6
- [x] Re-run `scan-create` with the *identical* trade/suburb payload as a second scan → most businesses rediscovered with `first_seen_scan_id` unchanged and `last_scan_id` moved to the new scan; any business Google didn't return this time keeps its old `last_scan_id`; total distinct `leads` rows never decreases or duplicates → AC-4, AC-6, AC-13
- [x] `select api, sku, used, free_allowance from api_budgets` after a scan → `used` increments match reservations made (net of any refund-then-retry on a 400) → AC-8
- [x] Full 288-query scan (all 16 trades × 18 suburbs) → completes with 0 `failed_queries`, `api_budgets.used` for `places_text_search` stays under `free_allowance` (1000) → AC-9
- [x] `select status_code from net._http_response order by created desc` immediately after the Vault secret is created → 200 with `{"processed":...}`, not 401 → AC-2, "Configuration required"

### Added 2026-08-13 — the four steps the first pass could not cover

- [x] **AC-7 denial.** Clamp `free_allowance` to `used` on `places_text_search`, *then* create a 2-query scan so any tick hits the gate deterministically → scan parks at `awaiting_approval`, `api_calls` count unchanged (512 → 512), `used` unchanged (300), both `scan_queries` still `pending`, both pgmq messages still present with `read_ct=1` and unarchived → AC-7, hard rule 2
- [x] **AC-7 resume.** Restore `free_allowance` → next tick moves `awaiting_approval` → `searching`, drains, and the scan reaches `completed`. Note the messages sit invisible for the remainder of their 120s `READ_VT` after the denial tick, so the *immediately* following tick legitimately finds an empty queue and the resume lands one tick later — not a fault, but it means a parked scan resumes within ~2 cron minutes, not 1 → AC-7
- [x] **AC-12 concurrency, forced.** Two `net.http_post` calls to `tick` issued in a single statement → one returned `{"processed":true,...}`, the other `{"processed":false,"reason":"locked"}`. Required adding a `reason` field to tick's response: a refused lock and an idle system both returned an identical `{processed:false, scan_id:null}`, which is *why* the first pass could only call this "unobserved" → AC-12
- [x] **AC-1 demo rejection.** Impersonate each user in SQL (`set local role authenticated` + their JWT `sub`) → demo tenant's `insert into scans` raises `insufficient_privilege`; the real tenant's identical insert succeeds (control). Demo `select` on `leads` still works — it is read-only, not blocked → AC-1
- [x] **AC-6 `businesses_found=0` status logic.** Rescanned a trade/suburb pair the 288-query scan already covered, so every business was a rediscovery and `businesses_found` stayed 0 → scan reached `completed` (2/2 queries, 0 failed, 18/18 psi, 23 businesses touched). Under the previous logic this exact scan would have been marked `failed` → AC-6
- [x] **Spend-gate invariant after a live scan.** `api_budgets.used = sum(api_calls.units) where refunded_at is null` holds on both budgets (places 302=302, psi 206=206); all 20 of the scan's `api_calls` rows carry a non-null `http_status` and a populated `scan_id` → AC-8, migration 18

## Acceptance-criteria coverage

- AC-1 (scan-create validates + creates scan/queries, never enqueues) — covered, six-query scan
- AC-2 (tick picks up queued scans, enqueues once, includes awaiting_approval) — fully covered; the `awaiting_approval` resume path was closed 2026-08-13
- AC-3 (search drain, concurrency, 400-retry-refund, upsert) — covered; live-confirmed the refund-then-retry path (9 attempts logged against 6 queries)
- AC-4 (ceiling cutoff, PSI batch, measuring transition) — covered on both the first and the overlapping second scan
- AC-5 (PSI drain, metrics extraction, no raw JSON) — covered
- AC-6 (leads for every business, final status logic) — fully covered. The `businesses_found=0` edge was not merely tested but **fixed**: the status now reads `completed_queries`, not `businesses_found`, and a real 100%-overlap rescan proved it reaches `completed`
- AC-7 (denial parks, resume) — fully covered, both halves, against a live scan
- AC-8 (no call without a gate) — covered by code inspection and by budget-accounting checks across all three test scans
- AC-9 (full end to end, no UI) — covered: six-query, overlapping, and 288-query scans all completed via `scan-create` + cron-only `tick`
- AC-10 (idempotency under redelivery) — covered, and not just synthetically: real redeliveries occurred during the 288-query test (search: 0 excess; psi: 20-unit `used` drift with zero duplicate rows), confirming the unique-index catch works under genuine platform conditions, not just a forced test. That 20-unit drift is now understood and structurally closed — see migration 18 and the correction note below
- AC-11 (capture-snapshot/Notion out of scope) — trivially satisfied, nothing built
- AC-12 (no concurrent tick invocations) — covered, deliberately forced 2026-08-13
- AC-13 (rediscovery preserves first_seen, refreshes the rest) — covered by the overlapping second scan

## Correction to the 2026-08-12 pass — the budget drift was misdiagnosed

The earlier entry described a single "budget-accounting drift" caused by `drainSearch`/`drainPsi`'s soft deadline check. Measuring it showed two separate things, and the one that sounded most dangerous was not a defect:

| API | `used` | `api_calls` rows | Δ | Cause |
|---|---|---|---|---|
| `places_text_search` | 300 | 324 (300×`200`, 24×`400`) | −24 | **Correct.** Exactly the 24 `400`s, each reserved then refunded by the untyped-retry path. Google does not bill invalid-argument 400s, so `used` matched billed calls precisely |
| `psi` | 188 | 168 | **+20** | Real. `psi` has no refund path, so `used` counted every reserve, but `logCall` only ran *after* `runPsi` returned — a window spanning two attempts and a 3s sleep, up to ~35s. A platform kill inside it orphaned the reservation |

So the exposure was the gap between `reserve()` and the log write, not "starting a new batch" — and tightening `BUDGET_MS` would not have fixed it.

Closed structurally by migration 18 rather than by tuning: `reserve_api_calls()` now writes its own `api_calls` row in the same transaction as the counter increment and returns `(grant_kind, call_id)`; `refund_api_call(call_id)` marks the row rather than blind-decrementing. The 20 existing orphans were closed by **adding the missing ledger rows, not by lowering the counter** — an orphaned reservation may correspond to a call that really went out, and under-reporting spend is the one direction §4 must never fail in.

## Open (not covered by this pass)

- Nothing from the original list. AC-7 (both halves), AC-1's demo rejection, AC-12's forced concurrency, and both `index.md` Follow-up findings are all closed above.
- The resume latency noted in AC-7 above (a parked scan resumes on the *second* tick, not the first, because of the 120s `READ_VT`) is understood and benign, but worth knowing before weekend 4's live-scan screen shows a user a "resuming" state.
