-- The grid's read model. security_invoker so the caller's RLS on leads/businesses
-- applies — without it the view would leak across tenants.

create view lead_rows
with (security_invoker = true)
as
select
  l.id as lead_id, l.status, l.tenant_id, l.updated_at,
  b.id as business_id, b.name, b.phone, b.website_url, b.website_kind,
  b.rating, b.rating_count, b.lat, b.lng,
  t.name as trade, s.name as suburb,
  p.score as psi_score, p.lcp_ms, p.cls, p.checked_at as psi_checked_at
from leads l
join businesses b on b.id = l.business_id
left join trades t on t.id = b.trade_id
left join suburbs s on s.id = b.suburb_id
left join lateral (
  select * from psi_results r
  where r.business_id = b.id and r.error is null
  order by r.checked_at desc limit 1
) p on true;
