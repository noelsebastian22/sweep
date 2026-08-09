-- Advisor remediation.
-- 1. Pin search_path on the remaining trigger function.
-- 2. Revoke EXECUTE from PUBLIC (anon/authenticated inherit through it, which is why a
--    direct revoke from those roles alone does not take effect).

create or replace function public.touch_updated_at()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Trigger functions must never be reachable over /rest/v1/rpc.
revoke execute on function public.touch_updated_at()      from public, anon, authenticated;
revoke execute on function public.roll_scan_counters()    from public, anon, authenticated;
revoke execute on function public.roll_businesses_found() from public, anon, authenticated;

-- The spend gate is service-role only. A client must never be able to reserve or
-- refund calls directly — that is the whole point of §4.
revoke execute on function public.reserve_api_calls(uuid, text, text, int)
  from public, anon, authenticated;
revoke execute on function public.refund_api_calls(uuid, text, text, int, text)
  from public, anon, authenticated;

-- current_tenant() and current_tenant_is_demo() are called by RLS policies, which are
-- evaluated with the invoker's privileges, so `authenticated` must retain EXECUTE.
-- anon must not: an unauthenticated caller has no tenant to resolve.
revoke execute on function public.current_tenant()         from public, anon;
revoke execute on function public.current_tenant_is_demo() from public, anon;
grant  execute on function public.current_tenant()         to authenticated;
grant  execute on function public.current_tenant_is_demo() to authenticated;
