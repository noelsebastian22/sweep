-- Spec 0005 build plan slice 1. Everything the lead detail page needs from the schema:
-- snapshots tied to the measurement that produced them, a lead_events timeline that
-- something actually writes, the two scan columns the analytics band derives from, and
-- the bucket the screenshots land in.

-- 1. Snapshots are keyed to the measurement, not just the business.
--
-- The screenshot comes out of a specific PageSpeed response, so it belongs to that
-- psi_results row: it is what the site looked like when those numbers were taken. The
-- unique index is the second half of AC-12's redelivery story — psi.ts skips the upload
-- entirely when its insert returns no row, which is what stops a duplicate *object*; this
-- index is what stops a duplicate *row*, including from a hand-written insert.
alter table site_snapshots
  add column psi_result_id bigint references psi_results on delete cascade;

create unique index site_snapshots_psi_result_viewport_uidx
  on site_snapshots (psi_result_id, viewport);

create index site_snapshots_psi_result_idx on site_snapshots (psi_result_id);

-- 2. lead_rows gains the scan columns, and stops reporting a PSI score for a business
--    with no site.
--
-- The website_kind clause is the load-bearing one. Once the detail page's capture action
-- can measure a *social* business, the old join (filtered on `error is null` alone) would
-- have surfaced a psi_score for it to the grid's PSI range filter, its psi_score column
-- sort, the Poor PSI tile and the PageSpeed spread chart. Fixing it in the view is one
-- clause instead of a website_kind test at four call sites, and it cannot be forgotten at
-- a fifth. It changes nothing about scoring: penaltyBranch() in score.ts returns
-- socialOnly before it ever reads psi_score, so the PSI branches were only ever reachable
-- for 'site'. It is also a no-op against today's data — advance.ts only ever enqueued
-- businesses whose website_kind is 'site', and a check at apply time found 0 successful
-- measurements belonging to a non-'site' business.
--
-- first_seen_scan_started_at exists so the analytics band can name the scans that produced
-- the leads in view without issuing a query (AC-25 and AC-26 would otherwise contradict
-- each other). started_at is nullable until a scan leaves 'queued', hence the coalesce.
-- New columns are appended, which is what create or replace view allows.
create or replace view lead_rows
with (security_invoker = true)
as
select
  l.id as lead_id, l.status, l.tenant_id, l.updated_at,
  b.id as business_id, b.name, b.phone, b.website_url, b.website_kind,
  b.rating, b.rating_count, b.lat, b.lng,
  t.name as trade, s.name as suburb,
  p.score as psi_score, p.lcp_ms, p.cls, p.checked_at as psi_checked_at,
  b.first_seen_scan_id,
  coalesce(sc.started_at, sc.created_at) as first_seen_scan_started_at
from leads l
join businesses b on b.id = l.business_id
left join trades t on t.id = b.trade_id
left join suburbs s on s.id = b.suburb_id
left join scans sc on sc.id = b.first_seen_scan_id
left join lateral (
  select * from psi_results r
  where r.business_id = b.id and r.error is null and b.website_kind = 'site'
  order by r.checked_at desc limit 1
) p on true;

-- 3. Something finally writes lead_events.
--
-- Nothing has ever inserted a row, so status history has been silently lost since
-- migration 05. The trigger writes it rather than the client, so a change made from the
-- detail page, from SQL, or from a future bulk action all leave the same trail — and
-- migration 20's removal of the browser's insert policy can stand.
--
-- The `when` clause is not optional: leads_touch_updated_at already fires on every update,
-- so an unconditioned trigger would log an event for writes that changed nothing.
--
-- actor is auth.uid(), which is null for an engine or hand-written write. The page renders
-- that as "by the engine" rather than attributing it to a person.
create or replace function public.log_lead_event()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if old.status is distinct from new.status then
    insert into lead_events (lead_id, type, payload)
    values (new.id, 'status_changed',
            jsonb_build_object('from', old.status, 'to', new.status, 'actor', auth.uid()));
  end if;

  if old.notes is distinct from new.notes then
    insert into lead_events (lead_id, type, payload)
    values (new.id, 'notes_updated',
            jsonb_build_object('length', coalesce(length(new.notes), 0), 'actor', auth.uid()));
  end if;

  return null;
end $$;

create trigger leads_log_event
  after update on leads
  for each row
  when (old.status is distinct from new.status or old.notes is distinct from new.notes)
  execute function public.log_lead_event();

-- Same treatment as roll_psi_completed() in migration 15. Postgres checks EXECUTE on a
-- trigger function when the trigger is created, not when it fires, so revoking here does
-- not stop it running for an authenticated user's update — it only stops the function
-- being called directly.
revoke execute on function public.log_lead_event() from public, anon, authenticated;

-- 4. The bucket.
--
-- Public read: the contents are captures of websites already reachable by anyone, so there
-- is nothing in them to protect, and a private bucket would need a storage client the
-- browser deliberately no longer carries (see AGENTS.md on the composed client). The
-- site_snapshots *rows* stay tenant-scoped by the existing read policy.
--
-- No storage.objects policies are added: public reads bypass RLS, and the engine writes
-- with the service role, which bypasses it too. Idempotent so the migration can be re-run.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-snapshots', 'site-snapshots', true, 5242880, array['image/jpeg'])
on conflict (id) do nothing;
