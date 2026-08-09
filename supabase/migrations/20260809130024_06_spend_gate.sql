-- §4 The spend gate. Defaults are allow_paid=false and granted_usd=0, so the system
-- cannot spend money on day one even if every other safeguard fails.

create table api_budgets (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants on delete cascade,
  api            text not null,
  sku            text not null,
  unit_cost_usd  numeric(10,5) not null default 0,
  free_allowance int not null default 0,
  period_start   date not null default date_trunc('month', now())::date,
  used           int not null default 0,
  allow_paid     boolean not null default false,
  granted_usd    numeric(8,2) not null default 0,
  spent_usd      numeric(8,2) not null default 0,
  unique (tenant_id, api, sku)
);

create table spend_grants (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants on delete cascade,
  scan_id     uuid references scans on delete set null,
  api         text not null,
  calls       int not null,
  amount_usd  numeric(8,2) not null,
  approved_by uuid references auth.users,
  approved_at timestamptz not null default now(),
  note        text
);

create index spend_grants_tenant_idx on spend_grants (tenant_id, approved_at desc);
create index spend_grants_scan_id_idx on spend_grants (scan_id);
create index spend_grants_approved_by_idx on spend_grants (approved_by);

-- Per-call history, for the dashboard and for reconciling against Google's billing.
-- Running totals live on api_budgets; this table is the log.
create table api_calls (
  id          bigserial primary key,
  tenant_id   uuid references tenants on delete cascade,
  scan_id     uuid references scans on delete set null,
  api         text not null,
  sku         text,
  grant_kind  text check (grant_kind in ('free','paid')),
  cost_usd    numeric(10,5) not null default 0,
  http_status int,
  called_at   timestamptz not null default now()
);

create index api_calls_tenant_called_idx on api_calls (tenant_id, called_at desc);
create index api_calls_scan_id_idx on api_calls (scan_id);
