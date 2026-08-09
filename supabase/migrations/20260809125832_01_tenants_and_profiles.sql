-- Sweep §5 data model — tenancy foundation

create table tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now()
);

create table profiles (
  id          uuid primary key references auth.users on delete cascade,
  tenant_id   uuid not null references tenants on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now()
);

create index profiles_tenant_id_idx on profiles (tenant_id);

-- Resolves the caller's tenant. STABLE + security definer so RLS policies can call it
-- without recursing into profiles' own policies.
create or replace function public.current_tenant()
returns uuid language sql stable security definer
set search_path = public, pg_temp
as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;

-- True when the caller's tenant is the read-only demo tenant.
create or replace function public.current_tenant_is_demo()
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select t.is_demo
       from public.tenants t
       join public.profiles p on p.tenant_id = t.id
      where p.id = auth.uid()),
    true)
$$;
