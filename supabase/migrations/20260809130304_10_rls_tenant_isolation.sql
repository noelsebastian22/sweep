-- §5 RLS. Every table is tenant-scoped. The demo tenant additionally blocks all writes,
-- so there is no path from a public visitor to a paid API call.
--
-- NOTE: the `for all` write policies created here are superseded by migration 12, which
-- splits them into insert/update/delete. Kept as applied so this directory matches the
-- remote migration ledger exactly.

alter table tenants          enable row level security;
alter table profiles         enable row level security;
alter table trades           enable row level security;
alter table regions          enable row level security;
alter table suburbs          enable row level security;
alter table scans            enable row level security;
alter table scan_queries     enable row level security;
alter table businesses       enable row level security;
alter table psi_results      enable row level security;
alter table site_snapshots   enable row level security;
alter table leads            enable row level security;
alter table lead_events      enable row level security;
alter table scoring_profiles enable row level security;
alter table api_budgets      enable row level security;
alter table spend_grants     enable row level security;
alter table api_calls        enable row level security;

create policy tenants_read on tenants for select to authenticated
  using (id = (select current_tenant()));

create policy profiles_read on profiles for select to authenticated
  using (tenant_id = (select current_tenant()));

do $$
declare t text;
begin
  foreach t in array array[
    'trades','regions','scans','businesses','leads',
    'scoring_profiles','api_budgets','spend_grants','api_calls'
  ] loop
    execute format($f$
      create policy %1$s_read on %1$s for select to authenticated
        using (tenant_id = (select current_tenant()));
    $f$, t);

    execute format($f$
      create policy %1$s_write on %1$s for all to authenticated
        using (tenant_id = (select current_tenant())
               and not (select current_tenant_is_demo()))
        with check (tenant_id = (select current_tenant())
               and not (select current_tenant_is_demo()));
    $f$, t);
  end loop;
end $$;

-- Tables scoped through a parent.

create policy suburbs_read on suburbs for select to authenticated
  using (exists (select 1 from regions r
                  where r.id = suburbs.region_id
                    and r.tenant_id = (select current_tenant())));

create policy suburbs_write on suburbs for all to authenticated
  using (exists (select 1 from regions r
                  where r.id = suburbs.region_id
                    and r.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()))
  with check (exists (select 1 from regions r
                  where r.id = suburbs.region_id
                    and r.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()));

create policy scan_queries_read on scan_queries for select to authenticated
  using (exists (select 1 from scans s
                  where s.id = scan_queries.scan_id
                    and s.tenant_id = (select current_tenant())));

create policy scan_queries_write on scan_queries for all to authenticated
  using (exists (select 1 from scans s
                  where s.id = scan_queries.scan_id
                    and s.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()))
  with check (exists (select 1 from scans s
                  where s.id = scan_queries.scan_id
                    and s.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()));

create policy psi_results_read on psi_results for select to authenticated
  using (exists (select 1 from businesses b
                  where b.id = psi_results.business_id
                    and b.tenant_id = (select current_tenant())));

create policy psi_results_write on psi_results for all to authenticated
  using (exists (select 1 from businesses b
                  where b.id = psi_results.business_id
                    and b.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()))
  with check (exists (select 1 from businesses b
                  where b.id = psi_results.business_id
                    and b.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()));

create policy site_snapshots_read on site_snapshots for select to authenticated
  using (exists (select 1 from businesses b
                  where b.id = site_snapshots.business_id
                    and b.tenant_id = (select current_tenant())));

create policy site_snapshots_write on site_snapshots for all to authenticated
  using (exists (select 1 from businesses b
                  where b.id = site_snapshots.business_id
                    and b.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()))
  with check (exists (select 1 from businesses b
                  where b.id = site_snapshots.business_id
                    and b.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()));

create policy lead_events_read on lead_events for select to authenticated
  using (exists (select 1 from leads l
                  where l.id = lead_events.lead_id
                    and l.tenant_id = (select current_tenant())));

create policy lead_events_write on lead_events for all to authenticated
  using (exists (select 1 from leads l
                  where l.id = lead_events.lead_id
                    and l.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()))
  with check (exists (select 1 from leads l
                  where l.id = lead_events.lead_id
                    and l.tenant_id = (select current_tenant()))
         and not (select current_tenant_is_demo()));
