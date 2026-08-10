-- Sweep §6 — queue infrastructure for Weekend 2 engine

create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Queues: one message per trade×suburb combination and one per business website
select pgmq.create('sweep_search');
select pgmq.create('sweep_psi');

-- Tick cron — no-op placeholder. Weekend 2 replaces the function body to dequeue work.
-- Runs every minute so the engine can react within ~60s of a scan being submitted.
select cron.schedule(
  'tick',
  '* * * * *',
  'select 1'
);
