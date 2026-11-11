-- Omnikom Platform: work order 46 (Clients department, head of operations 2026-11-11 06:25; number 28, 27 being platform's work order 44),
-- reviewed by platform before it lands. Product row E12, 11-rules.md rule 12 ("every growing table has ... a retention rule"), H2-1.
-- Additive to migrations 1 to 27. It adds one table and one function, schedules the function, and replaces private.refuse_change with
-- `create or replace`, keeping migration 26's body verbatim (its mutants keep biting) and adding one branch.
--  1. public.retention_rules: how long each growing table keeps a row, as data (a change of period needs no migration). The periods were
--     set by the head of operations on 2026-11-11 from these sources; the owner may revise any of them:
--     - webhook_events, processed without error: 30 days. The rows exist to recognise a provider's retry (unique on connector and
--       provider event id); providers retry for days, not weeks (Stripe: up to 3 days, docs.stripe.com/webhooks "Retry behavior").
--     - webhook_events not processed or with an error: 90 days, to debug them.
--     - security_event_counts: 30 days (per-minute rate buckets; the security_events row each one points at keeps its own period).
--     - security_events: 365 days (PCI DSS v4.0 requirement 10.5.1: audit log history retained for at least 12 months).
--     - audit_log: 730 days (a proposal of two years, not a sourced rule; the head of operations' call).
--     - messages: 1461 days, four years: the send record is the evidence in a TCPA dispute, and such claims have a four-year limit
--       (28 U.S.C. 1658(a)).
--     - consent_ledger: never (the proof of consent; after an erasure it holds hashes and the time only, migration 26).
--     A floor per table refuses a period that would wipe an audit trail by mistake: audit_log at least 365 days, security_events at least
--     90, messages at least 365, the others at least 7. consent_ledger cannot be given a period.
--  2. service.purge_expired(batch): deletes each table's rows older than its period, at most `batch` rows per table per call, and writes
--     one audit_log row (action retention-purge) with the counts. Service role and the function role only. pg_cron runs it daily at
--     03:17 UTC as purge-expired (guarded as in migration 19: without pg_cron one notice, the migration still succeeds).
--  3. audit_log and security_events stay append-only. private.refuse_change() lets through exactly one delete: on those two tables,
--     inside purge_expired (the transaction-local setting omnikom.purge = 'on', run as the table's owner), and only of a row older than
--     its table's period in retention_rules. A newer row, another role, no setting, an update or a truncate: refused as before.
-- Partitioning stays open on E12. Tests: supabase/tests/tenancy.test.sql T33; mutants in supabase/tests/run-local.mjs ("retention 28: ...").

set lock_timeout = '5s';

create table public.retention_rules (
  table_name text primary key,
  keep_days int,
  set_by text not null check (length(set_by) between 1 and 120),
  set_on date not null,
  source text not null check (length(source) between 1 and 400)
);
alter table public.retention_rules add constraint retention_rules_table_known
  check (table_name in ('webhook_events', 'webhook_events.unprocessed', 'security_event_counts', 'security_events', 'audit_log', 'messages', 'consent_ledger'));
alter table public.retention_rules add constraint retention_rules_floor
  check (case table_name when 'consent_ledger' then keep_days is null
                         when 'audit_log' then keep_days >= 365
                         when 'security_events' then keep_days >= 90
                         when 'messages' then keep_days >= 365
                         else keep_days >= 7 end);
alter table public.retention_rules enable row level security;
create policy retention_rules_staff_read on public.retention_rules for select to authenticated using (private.is_staff());
revoke all on public.retention_rules from anon;
revoke insert, update, delete, truncate, references, trigger on public.retention_rules from authenticated;
grant select on public.retention_rules to authenticated;
grant all on public.retention_rules to service_role;

insert into public.retention_rules (table_name, keep_days, set_by, set_on, source) values
  ('webhook_events', 30, 'head of operations (the owner may revise)', '2026-11-11', 'processed rows only serve retry recognition; Stripe retries for up to 3 days (docs.stripe.com/webhooks, Retry behavior)'),
  ('webhook_events.unprocessed', 90, 'head of operations (the owner may revise)', '2026-11-11', 'unprocessed or failed rows are kept longer to debug them'),
  ('security_event_counts', 30, 'head of operations (the owner may revise)', '2026-11-11', 'per-minute rate buckets; the event rows keep their own period'),
  ('security_events', 365, 'head of operations (the owner may revise)', '2026-11-11', 'PCI DSS v4.0 requirement 10.5.1: at least 12 months of audit log history'),
  ('audit_log', 730, 'head of operations (the owner may revise)', '2026-11-11', 'two years, proposed by the Clients department; no sourced rule'),
  ('messages', 1461, 'head of operations (the owner may revise)', '2026-11-11', 'four years: TCPA claims have a four-year limit (28 U.S.C. 1658(a)); the send record is the evidence'),
  ('consent_ledger', null, 'head of operations (the owner may revise)', '2026-11-11', 'never purged: the proof of consent (hashes and the time after an erasure, migration 26)');

-- private.refuse_change: migration 26's body verbatim, plus the purge branch of item 3 first
create or replace function private.refuse_change() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and tg_table_name in ('audit_log', 'security_events') and coalesce(current_setting('omnikom.purge', true), '') = 'on'
     and current_user = (select pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = tg_relid) then
    if old.at < now() - make_interval(days => (select r.keep_days from public.retention_rules r where r.table_name = tg_table_name and r.keep_days is not null)) then
      return old;
    end if;
  end if;
  if tg_table_name = 'consent_ledger' and tg_op = 'UPDATE' and coalesce(current_setting('omnikom.erasure', true), '') = 'on'
     and current_user = (select pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = tg_relid) then
    -- every other column unchanged: the rows compared as jsonb without the five erasure columns (naming each column fails: BY is a
    -- PL/pgSQL reserved word, so new.by is not a field to it; CI run 42888920024)
    if new.lead_id is null and new.user_agent is null and new.marketing is null
       and (to_jsonb(new) - array['lead_id', 'user_agent', 'marketing', 'email_hash', 'phone_hash']) = (to_jsonb(old) - array['lead_id', 'user_agent', 'marketing', 'email_hash', 'phone_hash'])
       and (old.email_hash is null or new.email_hash is not distinct from old.email_hash)
       and (old.phone_hash is null or new.phone_hash is not distinct from old.phone_hash) then
      return new;
    end if;
  end if;
  raise exception 'A-APPEND-ONLY: % is append-only', tg_table_name;
end $$;

-- service.purge_expired: item 2
create function service.purge_expired(p_batch int default 5000) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.retention_rules; n int; counts jsonb := '{}'; cutoff timestamptz;
begin
  if p_batch is null or p_batch < 1 or p_batch > 50000 then raise exception 'R-BATCH: the batch is 1 to 50000 rows'; end if;
  for r in select * from public.retention_rules where keep_days is not null order by table_name loop
    cutoff := now() - make_interval(days => r.keep_days);
    if r.table_name = 'webhook_events' then
      delete from public.webhook_events w where w.ctid = any(array(select x.ctid from public.webhook_events x where x.received_at < cutoff and x.processed_at is not null and x.error is null limit p_batch));
    elsif r.table_name = 'webhook_events.unprocessed' then
      delete from public.webhook_events w where w.ctid = any(array(select x.ctid from public.webhook_events x where x.received_at < cutoff and (x.processed_at is null or x.error is not null) limit p_batch));
    elsif r.table_name = 'security_event_counts' then
      delete from public.security_event_counts s where s.ctid = any(array(select x.ctid from public.security_event_counts x where x.last_at < cutoff limit p_batch));
    elsif r.table_name = 'security_events' then
      perform set_config('omnikom.purge', 'on', true);
      delete from public.security_events s where s.ctid = any(array(select x.ctid from public.security_events x where x.at < cutoff limit p_batch));
      perform set_config('omnikom.purge', 'off', true);
    elsif r.table_name = 'audit_log' then
      perform set_config('omnikom.purge', 'on', true);
      delete from public.audit_log a where a.ctid = any(array(select x.ctid from public.audit_log x where x.at < cutoff limit p_batch));
      perform set_config('omnikom.purge', 'off', true);
    elsif r.table_name = 'messages' then
      delete from public.messages m where m.ctid = any(array(select x.ctid from public.messages x where x.created_at < cutoff limit p_batch));
    else
      raise exception 'R-RULE: no purge is written for %', r.table_name;
    end if;
    get diagnostics n = row_count;
    counts := counts || jsonb_build_object(r.table_name, n);
  end loop;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (null, null, 'retention-purge', 'retention_rules', jsonb_build_object('deleted', counts, 'batch', p_batch));
  return counts;
end $$;

revoke all on function service.purge_expired(int) from public, anon, authenticated;
grant execute on function service.purge_expired(int) to service_role, omnikom_fn;

do $$ begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('purge-expired', '17 3 * * *', 'select service.purge_expired()');
  else
    raise notice 'pg_cron is not installed here: the retention purge (service.purge_expired) is not scheduled';
  end if;
end $$;
