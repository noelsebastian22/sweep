-- `for all` includes SELECT, so every table had two permissive policies evaluated on
-- every read. Split the write policies into insert/update/delete so SELECT is served by
-- exactly one policy. Flagged by the performance advisor on all 15 tables.

do $$
declare t text;
begin
  foreach t in array array[
    'trades','regions','scans','businesses','leads',
    'scoring_profiles','api_budgets','spend_grants','api_calls'
  ] loop
    execute format('drop policy %1$s_write on %1$s;', t);

    execute format($f$
      create policy %1$s_insert on %1$s for insert to authenticated
        with check (tenant_id = (select current_tenant())
                    and not (select current_tenant_is_demo()));
    $f$, t);

    execute format($f$
      create policy %1$s_update on %1$s for update to authenticated
        using (tenant_id = (select current_tenant())
               and not (select current_tenant_is_demo()))
        with check (tenant_id = (select current_tenant())
               and not (select current_tenant_is_demo()));
    $f$, t);

    execute format($f$
      create policy %1$s_delete on %1$s for delete to authenticated
        using (tenant_id = (select current_tenant())
               and not (select current_tenant_is_demo()));
    $f$, t);
  end loop;
end $$;

-- Parent-scoped tables, same treatment.

drop policy suburbs_write on suburbs;
create policy suburbs_insert on suburbs for insert to authenticated
  with check (exists (select 1 from regions r where r.id = region_id
                        and r.tenant_id = (select current_tenant()))
              and not (select current_tenant_is_demo()));
create policy suburbs_update on suburbs for update to authenticated
  using (exists (select 1 from regions r where r.id = suburbs.region_id
                   and r.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()))
  with check (exists (select 1 from regions r where r.id = region_id
                        and r.tenant_id = (select current_tenant()))
              and not (select current_tenant_is_demo()));
create policy suburbs_delete on suburbs for delete to authenticated
  using (exists (select 1 from regions r where r.id = suburbs.region_id
                   and r.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()));

drop policy scan_queries_write on scan_queries;
create policy scan_queries_insert on scan_queries for insert to authenticated
  with check (exists (select 1 from scans s where s.id = scan_id
                        and s.tenant_id = (select current_tenant()))
              and not (select current_tenant_is_demo()));
create policy scan_queries_update on scan_queries for update to authenticated
  using (exists (select 1 from scans s where s.id = scan_queries.scan_id
                   and s.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()))
  with check (exists (select 1 from scans s where s.id = scan_id
                        and s.tenant_id = (select current_tenant()))
              and not (select current_tenant_is_demo()));
create policy scan_queries_delete on scan_queries for delete to authenticated
  using (exists (select 1 from scans s where s.id = scan_queries.scan_id
                   and s.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()));

drop policy psi_results_write on psi_results;
create policy psi_results_insert on psi_results for insert to authenticated
  with check (exists (select 1 from businesses b where b.id = business_id
                        and b.tenant_id = (select current_tenant()))
              and not (select current_tenant_is_demo()));
create policy psi_results_update on psi_results for update to authenticated
  using (exists (select 1 from businesses b where b.id = psi_results.business_id
                   and b.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()))
  with check (exists (select 1 from businesses b where b.id = business_id
                        and b.tenant_id = (select current_tenant()))
              and not (select current_tenant_is_demo()));
create policy psi_results_delete on psi_results for delete to authenticated
  using (exists (select 1 from businesses b where b.id = psi_results.business_id
                   and b.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()));

drop policy site_snapshots_write on site_snapshots;
create policy site_snapshots_insert on site_snapshots for insert to authenticated
  with check (exists (select 1 from businesses b where b.id = business_id
                        and b.tenant_id = (select current_tenant()))
              and not (select current_tenant_is_demo()));
create policy site_snapshots_update on site_snapshots for update to authenticated
  using (exists (select 1 from businesses b where b.id = site_snapshots.business_id
                   and b.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()))
  with check (exists (select 1 from businesses b where b.id = business_id
                        and b.tenant_id = (select current_tenant()))
              and not (select current_tenant_is_demo()));
create policy site_snapshots_delete on site_snapshots for delete to authenticated
  using (exists (select 1 from businesses b where b.id = site_snapshots.business_id
                   and b.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()));

drop policy lead_events_write on lead_events;
create policy lead_events_insert on lead_events for insert to authenticated
  with check (exists (select 1 from leads l where l.id = lead_id
                        and l.tenant_id = (select current_tenant()))
              and not (select current_tenant_is_demo()));
create policy lead_events_update on lead_events for update to authenticated
  using (exists (select 1 from leads l where l.id = lead_events.lead_id
                   and l.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()))
  with check (exists (select 1 from leads l where l.id = lead_id
                        and l.tenant_id = (select current_tenant()))
              and not (select current_tenant_is_demo()));
create policy lead_events_delete on lead_events for delete to authenticated
  using (exists (select 1 from leads l where l.id = lead_events.lead_id
                   and l.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()));
