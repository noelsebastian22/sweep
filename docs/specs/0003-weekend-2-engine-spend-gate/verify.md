# Verify: weekend-2-engine-spend-gate · spec 0003 · updated 2026-08-12
_Steps derived from spec 0003 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

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

## Acceptance-criteria coverage

- AC-1 (scan-create validates + creates scan/queries, never enqueues) — covered, six-query scan
- AC-2 (tick picks up queued scans, enqueues once, includes awaiting_approval) — covered for the queued→searching path; the `awaiting_approval` resume path specifically is **not yet covered** (see Open below)
- AC-3 (search drain, concurrency, 400-retry-refund, upsert) — covered; live-confirmed the refund-then-retry path (9 attempts logged against 6 queries)
- AC-4 (ceiling cutoff, PSI batch, measuring transition) — covered on both the first and the overlapping second scan
- AC-5 (PSI drain, metrics extraction, no raw JSON) — covered
- AC-6 (leads for every business, final status logic) — covered for the `completed` path; the `businesses_found=0` edge of the status logic is **not covered** (flagged as a latent gap in `index.md`'s Follow-up, not proven safe)
- AC-7 (denial parks, resume) — **not covered**. Never exercised against a live scan (see Open below)
- AC-8 (no call without a gate) — covered by code inspection and by budget-accounting checks across all three test scans
- AC-9 (full end to end, no UI) — covered: six-query, overlapping, and 288-query scans all completed via `scan-create` + cron-only `tick`
- AC-10 (idempotency under redelivery) — covered, and not just synthetically: real redeliveries occurred during the 288-query test (search: 0 excess; psi: 20-unit `used` drift with zero duplicate rows), confirming the unique-index catch works under genuine platform conditions, not just a forced test
- AC-11 (capture-snapshot/Notion out of scope) — trivially satisfied, nothing built
- AC-12 (no concurrent tick invocations) — **not deliberately forced**; no evidence of a violation across three real scans and 100+ cron invocations, but never tested by triggering genuinely overlapping ticks
- AC-13 (rediscovery preserves first_seen, refreshes the rest) — covered by the overlapping second scan

## Open (not covered by this pass)

- AC-7's denial/resume path — needs a test tenant with `free_allowance` temporarily lowered below what a scan needs, then confirming `awaiting_approval` → resume works.
- AC-1's demo-tenant rejection (`scan-create` called with the demo tenant's token → RLS 403 before any queue message sent).
- AC-12's concurrent-tick guard, forced rather than merely unobserved.
- The two findings in `index.md`'s Follow-up (budget-drift edge case, `businesses_found=0` status gap) — neither is covered by a repeatable test yet.
