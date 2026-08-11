-- Spec 0003 build plan step 1. Three additions the tick engine needs, no new tables.

-- Overwritten on every upsert (unlike first_seen_scan_id, which is set once and kept).
-- advance.ts's cutoff computation and the final lead sweep both need "which businesses
-- did *this* scan touch" — first_seen_scan_id only answers that for a business's very
-- first scan ever.
alter table businesses add column last_scan_id uuid references scans on delete set null;
create index businesses_last_scan_idx on businesses (last_scan_id);

-- Mirrors businesses_roll_found (migration 08), which only rolls up scan_queries and
-- businesses, not psi_results — this trigger is what lets the live scan screen know when
-- PSI is done. psi_total is a one-time write from advance.ts, no trigger needed for it.
create or replace function public.roll_psi_completed()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.scan_id is not null then
    update scans set psi_completed = psi_completed + 1 where id = new.scan_id;
  end if;
  return new;
end $$;

create trigger psi_results_roll_completed
  after insert on psi_results
  for each row execute function public.roll_psi_completed();

revoke execute on function public.roll_psi_completed() from public, anon, authenticated;

-- Without this, a redelivered sweep_psi message inserts a second history row for the same
-- business in the same scan, double counting psi_completed and double spending a psi
-- reservation on work already done. Cross-scan history (the point of not overwriting the
-- table) is unaffected since the index only constrains rows sharing a scan_id. psi.ts
-- catches a violation on this index and treats it as "already done", not an error.
create unique index psi_results_business_scan_uidx
  on psi_results (business_id, scan_id) where scan_id is not null;
