-- Businesses discovered by search, plus PSI measurement history

create table businesses (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants on delete cascade,
  google_place_id     text not null,
  name                text not null,
  name_norm           text not null,
  trade_id            uuid references trades,
  suburb_id           uuid references suburbs,
  phone               text,
  website_url         text,
  website_kind        text check (website_kind in ('none','social','site')),
  address             text,
  lat                 double precision,
  lng                 double precision,
  rating              numeric(2,1),
  rating_count        int,
  primary_type        text,
  types               text[],
  business_status     text,
  first_seen_scan_id  uuid references scans on delete set null,
  last_seen_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  unique (tenant_id, google_place_id)
);

create index businesses_tenant_name_norm_idx on businesses (tenant_id, name_norm);
create index businesses_first_seen_scan_idx  on businesses (first_seen_scan_id);
create index businesses_trade_id_idx         on businesses (trade_id);
create index businesses_suburb_id_idx        on businesses (suburb_id);

-- History, not a single overwritten column: the detail page charts PSI over time.
create table psi_results (
  id          bigserial primary key,
  business_id uuid not null references businesses on delete cascade,
  scan_id     uuid references scans on delete set null,
  strategy    text not null default 'mobile',
  score       int,
  lcp_ms      int,
  cls         numeric(4,3),
  tbt_ms      int,
  fcp_ms      int,
  si_ms       int,
  error       text,
  checked_at  timestamptz not null default now()
);

create index psi_results_business_checked_idx on psi_results (business_id, checked_at desc);
create index psi_results_scan_id_idx on psi_results (scan_id);

-- Screenshots extracted from the PSI payload, downscaled to WebP in Storage.
create table site_snapshots (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses on delete cascade,
  storage_path text not null,
  viewport     text not null default 'mobile',
  captured_at  timestamptz not null default now()
);

create index site_snapshots_business_idx on site_snapshots (business_id, captured_at desc);
