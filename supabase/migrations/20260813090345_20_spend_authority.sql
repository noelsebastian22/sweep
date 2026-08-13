-- 20 — the spend gate becomes the only writer of its own tables, and a grant finally
-- does something.
--
-- Two problems with one root cause. Migration 10 handed `authenticated` a generic write
-- policy on every tenant-scoped table, including the three financial ones. That meant a
-- signed-in browser could run
--
--   update api_budgets set allow_paid = true, granted_usd = 99999;
--
-- against its own tenant and RLS would allow it. Verified before writing this migration,
-- not inferred from reading the policy: the UPDATE reported 1 row affected and no error.
-- Hard rule 1 is enforced inside `reserve_api_calls()`, but the numbers it reads were
-- writable by the very thing the rule exists to protect against, so the gate could be
-- opened from the client without ever calling the gate.
--
-- Meanwhile `spend_grants` had the opposite problem: rows could be written but were never
-- read. `reserve_api_calls()` only ever consulted `api_budgets`, so approving a grant did
-- not unblock anything — there was no wired path from "Noel approves $10" to "the parked
-- scan resumes".
--
-- Both are fixed the same way. The browser loses write access to all three tables, and
-- `approve_spend()` becomes the single, capped, server-side path in. A grant flows into
-- `api_budgets.granted_usd` in the same transaction that writes the grant row — migration
-- 18's pattern applied to the other half of the ledger. New invariant, matching the one 18
-- established for `used`:
--
--   api_budgets.granted_usd = coalesce(sum(spend_grants.amount_usd)
--                                      for that tenant/api/sku, 0)
--
-- `reserve_api_calls()` is deliberately NOT changed to read `spend_grants` directly. It
-- holds `for update` on exactly one budget row and needs to stay a single-row read;
-- summing a growing ledger inside the hot path would trade a real property (the gate is
-- cheap and atomic) for a cosmetic one.

-- ---------------------------------------------------------------------------
-- 1. spend_grants gains sku, so a grant maps onto exactly one budget row.
-- ---------------------------------------------------------------------------

alter table public.spend_grants add column if not exists sku text;

comment on column public.spend_grants.sku is
  'Matches api_budgets.sku. Without it a grant could not be attributed to one budget row, since (api, sku) is what identifies a budget.';

-- ---------------------------------------------------------------------------
-- 2. Revoke every authenticated write path that nothing legitimately uses.
--
-- Audited against the client and the edge functions before dropping anything. The only
-- writes a user JWT actually performs are:
--
--   leads.update          status changes from the grid
--   lead_events.insert    the audit trail those changes leave
--   scans.insert          scan-create, with the caller's own token
--   scan_queries.insert   the same call, expanding trade x suburb
--   scoring_profiles.*    the scoring lab saving a profile
--
-- Everything else is written by tick or seed under the service role, which bypasses RLS
-- entirely and is unaffected by any of this.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  -- The financial tables. No write path for authenticated at all. This is the fix.
  foreach t in array array['api_budgets', 'spend_grants', 'api_calls'] loop
    execute format('drop policy if exists %1$s_insert on public.%1$s;', t);
    execute format('drop policy if exists %1$s_update on public.%1$s;', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s;', t);
  end loop;

  -- Engine-owned measurements. The browser has no business writing these, and a lead
  -- score derived from client-writable ratings would be worth nothing.
  foreach t in array array['businesses', 'psi_results', 'site_snapshots'] loop
    execute format('drop policy if exists %1$s_insert on public.%1$s;', t);
    execute format('drop policy if exists %1$s_update on public.%1$s;', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s;', t);
  end loop;

  -- Reference data, seeded once under the service role.
  foreach t in array array['trades', 'regions', 'suburbs'] loop
    execute format('drop policy if exists %1$s_insert on public.%1$s;', t);
    execute format('drop policy if exists %1$s_update on public.%1$s;', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s;', t);
  end loop;
end $$;

-- Narrower drops, where one verb survives and the others do not.
drop policy if exists scan_queries_update on public.scan_queries;  -- tick owns query outcomes
drop policy if exists scan_queries_delete on public.scan_queries;
drop policy if exists leads_insert        on public.leads;         -- advance.ts creates leads
drop policy if exists leads_delete        on public.leads;
drop policy if exists lead_events_update  on public.lead_events;   -- an audit trail is append-only
drop policy if exists lead_events_delete  on public.lead_events;
drop policy if exists scans_delete        on public.scans;

-- scans_update survives, because cancelling is a user action. cancel_scan() below is its
-- only sanctioned use.

-- ---------------------------------------------------------------------------
-- 3. budget_headroom() — how many more calls the gate would grant right now.
--
-- This is what lets a parked scan tell "still blocked" from "a grant landed". Before it
-- existed, tick flipped awaiting_approval straight back to searching on every tick
-- regardless, so a genuinely blocked scan looped park -> resume -> denied -> park once a
-- minute forever, and the screen could not honestly say "waiting for approval".
--
-- Service-role only: it takes a tenant id, so exposing it to authenticated would leak
-- other tenants' budget positions. The client reads its own api_budgets row instead,
-- which RLS already scopes.
-- ---------------------------------------------------------------------------

create or replace function public.budget_headroom(p_tenant uuid, p_api text, p_sku text)
returns int
language plpgsql stable security definer
set search_path = public, pg_temp
as $fn$
declare
  b         api_budgets%rowtype;
  free_left bigint;
  paid_left bigint;
begin
  select * into b from api_budgets
   where tenant_id = p_tenant and api = p_api and sku = p_sku;
  if not found then return 0; end if;

  -- Mirrors reserve_api_calls()'s lazy period rollover. On the first call of a new month
  -- the whole free allowance is available again even though `used` has not been reset
  -- yet, so reporting the stale number here would leave a scan parked at a month boundary
  -- that reserve() would happily have let through.
  if date_trunc('month', now())::date > b.period_start then
    free_left := b.free_allowance;
    paid_left := case when b.allow_paid and b.unit_cost_usd > 0
                      then floor(b.granted_usd / b.unit_cost_usd)::bigint
                      when b.allow_paid then 1000000000::bigint
                      else 0 end;
  else
    free_left := greatest(b.free_allowance - b.used, 0);
    paid_left := case when not b.allow_paid then 0
                      -- unit_cost 0 (psi is free) would divide by zero, and also never
                      -- exhausts, so treat it as effectively unbounded.
                      when b.unit_cost_usd <= 0 then 1000000000::bigint
                      else greatest(floor((b.granted_usd - b.spent_usd) / b.unit_cost_usd)::bigint, 0)
                 end;
  end if;

  return least(free_left + paid_left, 2147483647)::int;
end $fn$;

comment on function public.budget_headroom(uuid, text, text) is
  'How many more calls reserve_api_calls() would grant right now. Lets a parked scan tell "still blocked" from "a grant landed". Mirrors reserve()''s lazy month rollover deliberately.';

-- ---------------------------------------------------------------------------
-- 4. approve_spend() — the only way a grant is ever created.
--
-- The three caps are constants in the function body on purpose. A config table would
-- itself need protecting, and "the most this app may ever spend" is exactly the kind of
-- number that should require a migration and a code review to move, not an UPDATE. A
-- compromised browser cannot reach them.
-- ---------------------------------------------------------------------------

create or replace function public.approve_spend(
  p_api   text,
  p_sku   text,
  p_calls int,
  p_scan  uuid default null,
  p_note  text default null,
  out grant_id    uuid,
  out amount_usd  numeric,
  out granted_usd numeric,
  out headroom    int
)
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  -- A full 288-query scan costs $10.08 at the enterprise rate, so one grant covers three
  -- of them and the month covers roughly five. Deliberately small: this is a portfolio
  -- project on a personal card, and the failure mode worth engineering against is an
  -- unattended loop, not an under-provisioned scan.
  max_calls_per_grant constant int     := 1000;
  max_grant_usd       constant numeric := 35.00;
  max_month_usd       constant numeric := 50.00;

  v_tenant uuid := current_tenant();
  b        api_budgets%rowtype;
  v_amount numeric;
  v_month  numeric;
begin
  if v_tenant is null then
    raise exception 'no tenant for this caller' using errcode = '42501';
  end if;
  if current_tenant_is_demo() then
    raise exception 'the demo tenant cannot approve spend' using errcode = '42501';
  end if;
  if p_calls is null or p_calls <= 0 then
    raise exception 'p_calls must be positive' using errcode = '22023';
  end if;
  if p_calls > max_calls_per_grant then
    raise exception 'a single grant is capped at % calls (asked for %)',
      max_calls_per_grant, p_calls using errcode = '22023';
  end if;

  select * into b from api_budgets
   where tenant_id = v_tenant and api = p_api and sku = p_sku
   for update;
  if not found then
    raise exception 'no budget row for %/%', p_api, p_sku using errcode = '22023';
  end if;

  v_amount := round(p_calls * b.unit_cost_usd, 2);

  if v_amount > max_grant_usd then
    raise exception 'a single grant is capped at $% (this one is $%)',
      max_grant_usd, v_amount using errcode = '22023';
  end if;

  -- Rolling calendar month, matching how api_budgets rolls its own period over.
  select coalesce(sum(g.amount_usd), 0) into v_month
    from spend_grants g
   where g.tenant_id = v_tenant
     and g.approved_at >= date_trunc('month', now());

  if v_month + v_amount > max_month_usd then
    raise exception 'this grant would take the month to $%, over the $% ceiling',
      v_month + v_amount, max_month_usd using errcode = '22023';
  end if;

  insert into spend_grants (tenant_id, scan_id, api, sku, calls, amount_usd, approved_by, note)
  values (v_tenant, p_scan, p_api, p_sku, p_calls, v_amount, auth.uid(), p_note)
  returning id into grant_id;

  -- Same transaction as the grant row, so the counter and the ledger cannot diverge.
  -- allow_paid is set here rather than being a separate toggle: approving a grant IS the
  -- act of allowing paid calls, and leaving them as two switches meant a grant could sit
  -- approved and inert while the scan it was meant to unblock stayed parked.
  update api_budgets
     set granted_usd = api_budgets.granted_usd + v_amount,
         allow_paid  = true
   where id = b.id
  returning api_budgets.granted_usd into granted_usd;

  if p_scan is not null then
    insert into scan_events (scan_id, tenant_id, kind, message, detail)
    values (p_scan, v_tenant, 'spend',
            format('Approved %s more %s calls ($%s)', p_calls, p_api, v_amount),
            jsonb_build_object('api', p_api, 'sku', p_sku, 'calls', p_calls,
                               'amount_usd', v_amount, 'grant_id', grant_id));
  end if;

  amount_usd := v_amount;
  headroom   := public.budget_headroom(v_tenant, p_api, p_sku);
end $fn$;

comment on function public.approve_spend(text, text, int, uuid, text) is
  'The only path into spend_grants and the only way granted_usd ever rises. Caps are constants in the body on purpose: moving them requires a migration, not an UPDATE. Derives the tenant from the JWT, so it cannot be pointed at another tenant.';

-- ---------------------------------------------------------------------------
-- 5. cancel_scan() — the one sanctioned scans.update.
--
-- Needed before parking could be made to actually park. tick picks strictly the oldest
-- active scan, so a scan parked against a grant that is never coming would otherwise sit
-- at the head of that queue forever, blocking every scan behind it with no way out except
-- funding it.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_scan(p_scan uuid) returns text
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare v_tenant uuid := current_tenant(); s scans%rowtype;
begin
  if v_tenant is null then
    raise exception 'no tenant for this caller' using errcode = '42501';
  end if;
  if current_tenant_is_demo() then
    raise exception 'the demo tenant cannot cancel scans' using errcode = '42501';
  end if;

  select * into s from scans where id = p_scan and tenant_id = v_tenant for update;
  if not found then
    raise exception 'scan not found' using errcode = '22023';
  end if;
  if s.status not in ('queued', 'searching', 'measuring', 'awaiting_approval') then
    return s.status::text;  -- already terminal, nothing to do
  end if;

  update scans set status = 'cancelled', finished_at = now() where id = p_scan;

  insert into scan_events (scan_id, tenant_id, kind, message)
  values (p_scan, v_tenant, 'stage', 'Scan cancelled');

  return 'cancelled';
end $fn$;

-- ---------------------------------------------------------------------------
-- 6. Grants. Migration 11's rule holds: anon gets nothing, and the spend gate itself
-- stays service-role only. approve_spend and cancel_scan are the deliberate exceptions —
-- they ARE the user actions — and both re-derive the tenant from the JWT rather than
-- taking it as a parameter, so neither can be pointed at someone else's data.
--
-- These two will show up in `get_advisors` as
-- `authenticated_security_definer_function_executable`. That is expected and intentional,
-- for the same reason current_tenant() and current_tenant_is_demo() already do.
-- ---------------------------------------------------------------------------

revoke execute on function public.approve_spend(text, text, int, uuid, text) from public, anon;
grant  execute on function public.approve_spend(text, text, int, uuid, text) to authenticated;

revoke execute on function public.cancel_scan(uuid) from public, anon;
grant  execute on function public.cancel_scan(uuid) to authenticated;

revoke execute on function public.budget_headroom(uuid, text, text) from public, anon, authenticated;
