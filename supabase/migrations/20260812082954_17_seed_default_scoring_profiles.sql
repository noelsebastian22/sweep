-- Weekend 3 (leads grid, spec 0004): seed one default scoring_profiles row per
-- existing tenant, so the grid always has a weight set to score against (AC-12).
-- Weights are harvest.mjs's original penalty()/score() constants, verbatim.
insert into scoring_profiles (tenant_id, name, weights, is_default)
select
  t.id,
  'Default',
  jsonb_build_object(
    'noWebsite', 1.0,
    'socialOnly', 0.9,
    'psiUnmeasured', 0.5,
    'psiPoor', 0.5,
    'psiMedium', 0.2,
    'psiGood', 0.0,
    'poorThreshold', 40,
    'mediumThreshold', 70
  ),
  true
from tenants t
where not exists (
  select 1 from scoring_profiles sp
  where sp.tenant_id = t.id and sp.is_default = true
);
