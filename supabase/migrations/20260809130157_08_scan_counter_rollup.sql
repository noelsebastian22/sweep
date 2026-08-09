-- A trigger rolls scan_queries counts up onto scans, so the live scan screen
-- subscribes to one row rather than 288.

create or replace function public.roll_scan_counters()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    update scans s
       set completed_queries = (
             select count(*) from scan_queries q
              where q.scan_id = s.id and q.status = 'done'),
           failed_queries = (
             select count(*) from scan_queries q
              where q.scan_id = s.id and q.status = 'failed')
     where s.id = new.scan_id;
  end if;
  return new;
end $$;

create trigger scan_queries_roll_counters
  after update on scan_queries
  for each row execute function public.roll_scan_counters();

-- Keep businesses_found accurate as the search worker inserts.
create or replace function public.roll_businesses_found()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.first_seen_scan_id is not null then
    update scans
       set businesses_found = businesses_found + 1
     where id = new.first_seen_scan_id;
  end if;
  return new;
end $$;

create trigger businesses_roll_found
  after insert on businesses
  for each row execute function public.roll_businesses_found();
