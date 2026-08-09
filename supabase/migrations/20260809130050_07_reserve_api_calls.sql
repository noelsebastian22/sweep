-- §4 Atomic reservation. Runs before the call, inside a row lock, so concurrency
-- cannot race past the allowance. Returns free | paid | denied | no_budget.

create or replace function public.reserve_api_calls(
  p_tenant uuid, p_api text, p_sku text, p_n int
) returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare b api_budgets%rowtype;
begin
  if p_n is null or p_n <= 0 then
    raise exception 'p_n must be positive';
  end if;

  select * into b from api_budgets
    where tenant_id = p_tenant and api = p_api and sku = p_sku
    for update;
  if not found then return 'no_budget'; end if;

  -- Roll the period over lazily on first call of a new month.
  if date_trunc('month', now())::date > b.period_start then
    update api_budgets
       set used = 0, spent_usd = 0,
           period_start = date_trunc('month', now())::date
     where id = b.id returning * into b;
  end if;

  if b.used + p_n <= b.free_allowance then
    update api_budgets set used = used + p_n where id = b.id;
    return 'free';
  end if;

  if b.allow_paid
     and b.spent_usd + (p_n * b.unit_cost_usd) <= b.granted_usd then
    update api_budgets
       set used = used + p_n,
           spent_usd = spent_usd + (p_n * b.unit_cost_usd)
     where id = b.id;
    return 'paid';
  end if;

  return 'denied';
end $$;

-- Reserve pessimistically, refund on the responses Google does not bill (the 4xx paths
-- textSearch() already handles). Never refunds below zero.
create or replace function public.refund_api_calls(
  p_tenant uuid, p_api text, p_sku text, p_n int, p_kind text
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update api_budgets
     set used = greatest(used - p_n, 0),
         spent_usd = case
           when p_kind = 'paid'
             then greatest(spent_usd - (p_n * unit_cost_usd), 0)
           else spent_usd
         end
   where tenant_id = p_tenant and api = p_api and sku = p_sku;
end $$;
