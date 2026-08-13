-- 19 — the live scan screen's data model: a persisted event log, a terminal status for
-- scans that are abandoned rather than finished, and a realtime publication that actually
-- contains tables.
--
-- `supabase_realtime` existed but was empty. A client could subscribe, get a successful
-- SUBSCRIBED callback, and then receive nothing forever — which looks exactly like a
-- client bug and is not one. Weekend 4 could not have worked without this.
--
-- Why a log table rather than subscribing to scan_queries and businesses directly:
--
--   1. Realtime replays nothing. Subscribe to a scan that is 200 queries in and the
--      screen is blank until the 201st. Reloading mid-scan would lose everything already
--      shown, and a finished scan would have no log at all. An event row is readable
--      after the fact, so the same component renders a live scan and a historical one
--      from one query plus a subscription.
--   2. It collapses three subscriptions into one, and carries things no table row does —
--      stage transitions, and the spend denial that parks a scan.
--
-- Volume: roughly one row per query plus a handful of stage rows, so ~300 for a full
-- 288-query scan. Discoveries ride along in `detail` rather than getting a row each,
-- which is both the right log granularity ("Electrician - Katoomba, 12 found, 3 new")
-- and what keeps this from being 750 rows.

-- ---------------------------------------------------------------------------
-- 1. A scan can now be cancelled.
--
-- Without this the only way out of awaiting_approval was to fund it. A scan parked
-- against a grant that is never coming had no terminal state and would sit at the head of
-- pickActiveScan's queue indefinitely, blocking every scan behind it.
-- ---------------------------------------------------------------------------

alter type scan_status add value if not exists 'cancelled';

-- ---------------------------------------------------------------------------
-- 2. The event log.
-- ---------------------------------------------------------------------------

create table if not exists public.scan_events (
  id        bigserial primary key,
  scan_id   uuid not null references public.scans(id)   on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  at        timestamptz not null default now(),
  kind      text not null check (kind in ('stage', 'query', 'discovery', 'spend', 'error')),
  message   text not null,
  detail    jsonb
);

comment on table public.scan_events is
  'Append-only log for the live scan screen. Written by tick under the service role only; authenticated may read its own tenant''s rows and nothing else.';
comment on column public.scan_events.kind is
  'stage = status transition, query = one scan_queries row resolved, discovery = new businesses, spend = reservation granted/denied, error = a failure worth surfacing.';

-- id, not at: two events in the same millisecond are common inside a concurrency-5 drain,
-- and the screen needs a total order to append into.
create index if not exists scan_events_scan_idx on public.scan_events (scan_id, id);
create index if not exists scan_events_tenant_idx on public.scan_events (tenant_id, id desc);

alter table public.scan_events enable row level security;

-- Read only, and only your own tenant. There is deliberately no insert/update/delete
-- policy: tick writes these under the service role, which bypasses RLS. A log the
-- subject of the log can edit is not a log.
drop policy if exists scan_events_read on public.scan_events;
create policy scan_events_read on public.scan_events for select to authenticated
  using (tenant_id = (select current_tenant()));

-- ---------------------------------------------------------------------------
-- 3. Realtime.
--
-- Postgres Changes evaluates the subscriber's RLS policy against each WAL record, so the
-- read policies above are what stop one tenant seeing another's scan. Both tables are
-- already tenant-scoped, so nothing extra is needed here.
--
-- `replica identity full` on scans only. It makes the old row available on UPDATE, which
-- is what lets the client tell a status transition from an unrelated counter bump instead
-- of diffing against its own possibly-stale copy. scan_events is insert-only and high
-- volume, so it stays on the default (primary key) identity — `full` there would put every
-- column of every row into the WAL for no benefit.
-- ---------------------------------------------------------------------------

alter table public.scans replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'scans'
  ) then
    alter publication supabase_realtime add table public.scans;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'scan_events'
  ) then
    alter publication supabase_realtime add table public.scan_events;
  end if;
end $$;
