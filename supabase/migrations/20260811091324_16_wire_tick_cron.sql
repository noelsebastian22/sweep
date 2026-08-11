-- Spec 0003 build plan step 2. Replace the select 1 placeholder (migration 13) with a
-- real call to the tick edge function.
--
-- The raw service role key never appears here or anywhere in git: this reads it back
-- from Supabase Vault at call time. The one-time `select vault.create_secret(<key>,
-- 'service_role_key')` is a manual step, run directly against the database, documented in
-- BUILD-PLAN.md rather than committed to a migration file.
--
-- timeout_milliseconds is set well above pg_net's 5s default — tick has its own 120s
-- internal budget, and the default would time out the caller long before tick finishes.

select cron.unschedule('tick');

select cron.schedule(
  'tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://ifwyufrepqkzsicjinfi.supabase.co/functions/v1/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 130000
  );
  $$
);
