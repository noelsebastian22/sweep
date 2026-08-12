-- §4, revision 2 — the reservation writes its own api_calls row.
--
-- Before this, tick reserved, ran the HTTP call, then logged. For psi that window spans
-- runPsi(), which with two attempts and a 3s sleep can reach ~35s; a platform kill inside
-- it orphaned the reservation with no matching ledger row. Twenty such orphans
-- accumulated during the 288-query test scan (api_budgets.used 188 vs 168 logged calls).
--
-- The insert now happens in the same transaction as the counter increment, so the two
-- cannot diverge. Invariant from here on:
--
--   api_budgets.used = coalesce(sum(api_calls.units) where refunded_at is null, 0)
--
-- api_calls keeps its role as the full attempt log — refunded rows stay visible, they
-- just stop counting. That is what made the places_text_search 400 path diagnosable.

alter table public.api_calls
  add column if not exists units       int not null default 1,
  add column if not exists refunded_at timestamptz;

comment on column public.api_calls.units is
  'Calls this row reserved; mirrors reserve_api_calls(p_n).';
comment on column public.api_calls.refunded_at is
  'Set when the reservation was handed back (a response Google does not bill). Non-null rows do not count toward api_budgets.used.';

-- Return type changes from text to a record, so this cannot be a create-or-replace.
drop function if exists public.reserve_api_calls(uuid, text, text, int);

create function public.reserve_api_calls(
  p_tenant uuid, p_api text, p_sku text, p_n int, p_scan uuid default null,
  out grant_kind text, out call_id bigint
)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  b      api_budgets%rowtype;
  v_cost numeric := 0;
begin
  call_id := null;

  if p_n is null or p_n <= 0 then
    raise exception 'p_n must be positive';
  end if;

  select * into b from api_budgets
    where tenant_id = p_tenant and api = p_api and sku = p_sku
    for update;
  if not found then
    grant_kind := 'no_budget';
    return;
  end if;

  -- Roll the period over lazily on first call of a new month.
  if date_trunc('month', now())::date > b.period_start then
    update api_budgets
       set used = 0, spent_usd = 0,
           period_start = date_trunc('month', now())::date
     where id = b.id returning * into b;
  end if;

  if b.used + p_n <= b.free_allowance then
    update api_budgets set used = used + p_n where id = b.id;
    grant_kind := 'free';
  elsif b.allow_paid
     and b.spent_usd + (p_n * b.unit_cost_usd) <= b.granted_usd then
    update api_budgets
       set used      = used + p_n,
           spent_usd = spent_usd + (p_n * b.unit_cost_usd)
     where id = b.id;
    grant_kind := 'paid';
    v_cost     := p_n * b.unit_cost_usd;
  else
    grant_kind := 'denied';
    return;  -- denied and no_budget never log: no call is made, nothing is consumed
  end if;

  insert into api_calls (tenant_id, scan_id, api, sku, grant_kind, units, cost_usd, http_status)
  values (p_tenant, p_scan, p_api, p_sku, grant_kind, p_n, v_cost, null)
  returning id into call_id;
end $$;

-- Refund by call id rather than by (tenant, api, sku, n, kind). The row already carries
-- all of it, so a caller can no longer refund an amount that does not match what it
-- reserved. Idempotent — a redelivered message refunding twice is a no-op.
drop function if exists public.refund_api_calls(uuid, text, text, int, text);

create function public.refund_api_call(p_call_id bigint) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare c api_calls%rowtype;
begin
  select * into c from api_calls where id = p_call_id for update;
  if not found or c.refunded_at is not null then return; end if;

  update api_budgets
     set used      = greatest(used - c.units, 0),
         spent_usd = greatest(spent_usd - c.cost_usd, 0)
   where tenant_id = c.tenant_id and api = c.api and sku = c.sku;

  update api_calls set refunded_at = now() where id = c.id;
end $$;

-- Migration 11's rule, reapplied to the new signatures: the spend gate is service-role
-- only. A client must never reserve or refund directly.
revoke execute on function public.reserve_api_calls(uuid, text, text, int, uuid)
  from public, anon, authenticated;
revoke execute on function public.refund_api_call(bigint)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill, so the invariant holds over the rows that already exist.
-- ---------------------------------------------------------------------------

-- Every places_text_search 400 was reserved, logged, then refunded by search.ts's
-- untyped-retry path — which is exactly why used (300) already sits 24 below the logged
-- row count (324), and why there are exactly 24 such rows. Mark them refunded.
-- psi has no refund path, so its 400s were genuinely consumed and stay counted.
update api_calls
   set refunded_at = called_at
 where api = 'places_text_search'
   and http_status = 400
   and refunded_at is null;

-- The orphaned reservations run the other way: the counter knows about calls the ledger
-- does not. Close that by adding the missing ledger rows, never by lowering the counter —
-- an orphan means the reservation was taken and the call may well have gone out, so
-- dropping it would under-report real spend, which is the one direction §4 must never
-- fail in. Restricted to budgets still inside their free allowance, where every
-- reservation was necessarily 'free' at zero cost and the synthesised rows are provably
-- accurate. A budget past its free allowance is left alone rather than guessed at.
-- http_status null is honest here: the call was reserved, its outcome was never recorded.
insert into api_calls (tenant_id, scan_id, api, sku, grant_kind, units, cost_usd, http_status)
select b.tenant_id, null, b.api, b.sku, 'free', 1, 0, null
  from api_budgets b
 cross join lateral generate_series(1, greatest(
        b.used - coalesce((
          select sum(c.units) from api_calls c
           where c.tenant_id = b.tenant_id and c.api = b.api and c.sku = b.sku
             and c.refunded_at is null), 0), 0))
 where b.used <= b.free_allowance;
