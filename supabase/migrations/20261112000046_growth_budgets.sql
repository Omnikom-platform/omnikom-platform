-- Omnikom Platform: book row E12 (11-rules.md rule 12: every growing table has a (workspace_id, ...) index, a retention rule and a measured
-- budget trigger), hand-over E12.md, head of operations 2026-11-12. Additive to every earlier migration; no function is replaced.
--  1. Every growing public table has a row in public.retention_rules (migration 28): a period only where service.purge_expired has a branch
--     (retention_rules_purged), else the reason it keeps its rows. retention_rules_table_known goes: T42 matches rows and tables both ways.
--  2. budget_mb: 35 MB a table with its indexes, a tenth of the 350 MB that moves production to Supabase Pro (docs/product/2-architecture.md).
--  3. service.over_budget(): the tables over their budget (pg_total_relation_size), read only, the service role only; the hourly alert
--     table-over-budget (supabase/ops/alerts.mjs) asks it. Tests: tenancy.test.sql T42, run-local.mjs "growth46: ...", alerts.test.mjs.

set lock_timeout = '5s';

alter table public.retention_rules drop constraint retention_rules_table_known;
alter table public.retention_rules add column budget_mb numeric;
update public.retention_rules set budget_mb = 35 where table_name <> 'webhook_events.unprocessed';
insert into public.retention_rules (table_name, keep_days, set_by, set_on, source, budget_mb) values
  ('leads', null, 'head of operations (the owner may revise)', '2026-11-12', 'kept until the owner deletes one (service.delete_lead, migration 26); no period', 35),
  ('lead_events', null, 'head of operations (the owner may revise)', '2026-11-12', 'removed with their lead (on delete cascade, migration 2)', 35),
  ('lead_tasks', null, 'head of operations (the owner may revise)', '2026-11-12', 'removed with their lead (on delete cascade, migration 22)', 35),
  ('lead_reads', null, 'head of operations (the owner may revise)', '2026-11-12', 'removed with their lead (on delete cascade, migration 12)', 35),
  ('content_rows', null, 'head of operations (the owner may revise)', '2026-11-12', 'kept; a delete is soft (book row B12)', 35),
  ('content_versions', null, 'head of operations (the owner may revise)', '2026-11-12', 'every saved version is kept: the history and restore of an item', 35),
  ('media', null, 'head of operations (the owner may revise)', '2026-11-12', 'kept until the owner deletes one nothing uses (service.delete_media, migration 44); the files are in Storage (1 GB free)', 35),
  ('publish_jobs', null, 'head of operations (the owner may revise)', '2026-11-12', 'the publish history, preview builds too (migration 42); no period set yet', 35),
  ('publish_job_events', null, 'head of operations (the owner may revise)', '2026-11-12', 'removed with their job (on delete cascade, migration 1)', 35),
  ('metrics_snapshots', null, 'head of operations (the owner may revise)', '2026-11-12', 'one row per workspace, source and day; no period set yet', 35),
  ('bookings', null, 'head of operations (the owner may revise)', '2026-11-12', 'parked (10-expansion.md); nothing writes it', 35),
  ('suppressions', null, 'head of operations (the owner may revise)', '2026-11-12', 'never removed: a suppression survives the lead''s deletion (migration 7)', 35),
  ('privacy_requests', null, 'head of operations (the owner may revise)', '2026-11-12', 'the record of each request; no period set yet', 35),
  ('site_contracts', null, 'head of operations (the owner may revise)', '2026-11-12', 'every contract version is kept, two jsonb columns each (migration 1); removed with its workspace', 35),
  ('api_keys', null, 'head of operations (the owner may revise)', '2026-11-12', 'a revoked key is kept with its revoked_at (migration 2); removed with its workspace or site', 35),
  ('mail_outbox', null, 'head of operations (the owner may revise)', '2026-11-12', 'a row goes when its mail is sent or given up, or with its lead (migration 29)', 35),
  ('visitor_counts', null, 'head of operations (the owner may revise)', '2026-11-12', 'keeps one hour per site, cleaned as it is written (migration 30)', 35),
  ('function_errors', null, 'head of operations (the owner may revise)', '2026-11-12', '30 days, cleaned as it is written by service.record_function_error (migration 32)', 35),
  ('staff_access', null, 'head of operations (the owner may revise)', '2026-11-12', '365 days, cleaned as it is written by service.staff_open (migration 43)', 35);
alter table public.retention_rules add constraint retention_rules_purged
  check (keep_days is null or table_name in ('webhook_events', 'webhook_events.unprocessed', 'security_event_counts', 'security_events', 'audit_log', 'messages')) not valid;
alter table public.retention_rules validate constraint retention_rules_purged;
alter table public.retention_rules add constraint retention_rules_budget check (table_name = 'webhook_events.unprocessed' or coalesce(budget_mb > 0, false)) not valid;
alter table public.retention_rules validate constraint retention_rules_budget;

create function service.over_budget() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('table', x.table_name, 'mb', round(x.bytes / 1048576.0, 1), 'budget_mb', x.budget_mb) order by x.table_name), '[]'::jsonb)
    from (select r.table_name, r.budget_mb, pg_total_relation_size(to_regclass('public.' || quote_ident(r.table_name))) as bytes
            from public.retention_rules r where r.budget_mb is not null and to_regclass('public.' || quote_ident(r.table_name)) is not null) x
   where x.bytes > x.budget_mb * 1048576
$$;
-- omnikom_fn is named on purpose (migration 28's reason): migration 8's default privileges give it execute on every new service function
revoke all on function service.over_budget() from public, anon, authenticated, omnikom_fn;
grant execute on function service.over_budget() to service_role;
