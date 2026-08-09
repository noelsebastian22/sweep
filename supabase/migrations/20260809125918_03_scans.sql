-- Scans and the per-query spine.
-- 'awaiting_approval' is included from the start per §4 "Park, don't fail".

create type scan_status as enum
  ('queued','searching','measuring','awaiting_approval','completed','partial','failed');

create table scans (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants on delete cascade,
  region_id          uuid not null references regions,
  status             scan_status not null default 'queued',
  config             jsonb not null default '{}',
  total_queries      int not null default 0,
  completed_queries  int not null default 0,
  failed_queries     int not null default 0,
  businesses_found   int not null default 0,
  psi_total          int not null default 0,
  psi_completed      int not null default 0,
  quota_hit          boolean not null default false,
  estimated_cost_usd numeric(8,2),
  started_at         timestamptz,
  finished_at        timestamptz,
  created_at         timestamptz not null default now()
);

create index scans_tenant_created_idx on scans (tenant_id, created_at desc);
create index scans_region_id_idx on scans (region_id);

create table scan_queries (
  id            bigserial primary key,
  scan_id       uuid not null references scans on delete cascade,
  trade_id      uuid not null references trades,
  suburb_id     uuid not null references suburbs,
  status        text not null default 'pending'
                  check (status in ('pending','running','done','failed')),
  http_status   int,
  results_count int,
  error         text,
  completed_at  timestamptz,
  unique (scan_id, trade_id, suburb_id)
);

create index scan_queries_scan_status_idx on scan_queries (scan_id, status);
create index scan_queries_trade_id_idx on scan_queries (trade_id);
create index scan_queries_suburb_id_idx on scan_queries (suburb_id);
