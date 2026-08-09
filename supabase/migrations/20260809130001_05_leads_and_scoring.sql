-- Leads, their event timeline, and scoring profiles.
-- NOTE: there is deliberately no `score` column — see §5 "The single most important
-- schema decision". Score is derived on the client from rating, rating_count,
-- website_kind and the latest psi score, which is what makes the scoring lab instant.

create type lead_status as enum
  ('identified','shortlisted','mockup_built','contacted','replied','won','lost','rejected');

create table leads (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants on delete cascade,
  business_id uuid not null references businesses on delete cascade,
  status      lead_status not null default 'identified',
  notes       text,
  updated_at  timestamptz not null default now(),
  unique (tenant_id, business_id)
);

create index leads_tenant_status_idx on leads (tenant_id, status);
create index leads_business_id_idx on leads (business_id);

create table lead_events (
  id         bigserial primary key,
  lead_id    uuid not null references leads on delete cascade,
  type       text not null,
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index lead_events_lead_created_idx on lead_events (lead_id, created_at desc);

create table scoring_profiles (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants on delete cascade,
  name       text not null,
  weights    jsonb not null,
  is_default boolean not null default false,
  unique (tenant_id, name)
);

-- Only one default profile per tenant.
create unique index scoring_profiles_one_default_idx
  on scoring_profiles (tenant_id) where is_default;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger leads_touch_updated_at
  before update on leads
  for each row execute function public.touch_updated_at();
