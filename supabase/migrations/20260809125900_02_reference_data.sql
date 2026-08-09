-- Trades, regions, suburbs

create table trades (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants on delete cascade,
  name         text not null,
  google_type  text,
  active       boolean not null default true,
  unique (tenant_id, name)
);

create table regions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants on delete cascade,
  name       text not null,
  unique (tenant_id, name)
);

create table suburbs (
  id         uuid primary key default gen_random_uuid(),
  region_id  uuid not null references regions on delete cascade,
  name       text not null,
  state      text not null default 'NSW',
  lat        double precision,
  lng        double precision,
  unique (region_id, name)
);

create index suburbs_region_id_idx on suburbs (region_id);
