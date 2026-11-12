-- Omnikom Platform: product row E4 (hardening H1-4), migration 29. Additive to migrations 1 to 28; changes no table or function of theirs.
-- capture-lead sent the new-lead alert itself, inside the form's request: the visitor waited for Resend, which had no timeout; a capped alert was
-- recorded as blocked and nothing ever sent it (no worker existed for "the queue retries tomorrow"); a suppressed first address threw out of the
-- loop, so the later addresses got nothing. Now the post only queues the alert, and a pg_cron worker sends it:
--  1. public.mail_outbox: one row per lead, template and address (unique), with the message of its current try, the tries so far and when it is due.
--     Written only by the functions below; staff with MFA read it; a lead's delete removes its rows (no workspace_id: the lead carries it).
--  2. service.queue_lead_alert(site, lead), called by capture-lead: a row per address of the site's lead_alert_to, none for a lead already alerted
--     (a retry of the same submission). No message row, no count, no outbound call.
--  3. service.outbox_claim(limit, now), called by the mail-outbox function: per due row, oldest first and locked, a suppressed address drops the row;
--     a row with no message, or whose message was blocked, is recorded through service.record_message (it stays the one daily cap): blocked by a daily
--     cap, the row waits for the next day (the blocked message stays as that day's record), blocked otherwise, the row is dropped; a message that is no
--     longer queued drops the row. Else the row is leased (one try more, the next 5 minutes times the tries later) and the alert's facts returned.
--  4. service.outbox_done(message, ok, provider id, error): sent, with Resend's email id as messages.provider_id; on the sixth failed try failed;
--     either way the row goes. A failed try before the sixth keeps the row for the next try its lease set.
--  5. service.mail_outbox_tick(): what pg_cron runs every minute as mail-outbox. With no due row it calls nothing ('idle'); else it signs a POST of {}
--     to /mail-outbox and sends it through pg_net with the key and the project address read from Vault (mail_outbox_key, project_url), as migration
--     27's daily job does: 'not installed' without pg_net, Vault or pgcrypto, 'no vault entries' without the two entries, else 'called'. Only pg_cron
--     runs it (as the owner). The schedule is guarded as in migration 19: local and CI Postgres have no pg_cron, so one notice and the migration
--     still succeeds. The named form of cron.schedule replaces a job of the same name.
-- UNPROVEN until staging: pg_net, the Vault entries, the signed call accepted by mail-outbox, the real Resend call, the row lock between two runs.
-- Tests: supabase/tests/tenancy.test.sql T35 and the run-local.mjs mutants "outbox29: ..."; the function: supabase/functions/test/outbox.test.ts.

set lock_timeout = '5s';

-- ---------- 1. the outbox ----------
create table public.mail_outbox (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  template text not null,
  to_text text not null check (length(to_text) <= 320),
  message_id uuid references public.messages(id) on delete set null,
  attempts int not null default 0,
  next_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint mail_outbox_once unique (lead_id, template, to_text)
);
create index mail_outbox_due on public.mail_outbox (next_at);
alter table public.mail_outbox enable row level security;
create policy mail_outbox_staff_read on public.mail_outbox for select to authenticated using (private.is_staff());
revoke all on public.mail_outbox from public, anon, authenticated, service_role, omnikom_fn;
grant select on public.mail_outbox to authenticated;

-- ---------- 2. queue (capture-lead) ----------
create function service.queue_lead_alert(p_site uuid, p_lead uuid) returns int language plpgsql security definer set search_path = '' as $$
declare tos text[]; t text; n int := 0;
begin
  select s.lead_alert_to into tos from public.sites s join public.leads l on l.site_id = s.id where s.id = p_site and l.id = p_lead;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  if service.lead_alerted(p_lead) then return 0; end if;
  foreach t in array tos loop
    insert into public.mail_outbox (lead_id, template, to_text) values (p_lead, 'new-lead', t) on conflict do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ---------- 3. claim (mail-outbox) ----------
create function service.outbox_claim(p_limit int, p_now timestamptz default now())
returns table (message_id uuid, to_text text, lead_id uuid, workspace_slug text, business text, name text, phone text, email text, form text, flow text, page_path text, answers jsonb)
language plpgsql security definer set search_path = '' as $$
declare o public.mail_outbox; ws uuid; r record; mid uuid;
begin
  for o in select x.* from public.mail_outbox x where x.next_at <= p_now order by x.next_at, x.id limit p_limit for update loop
    select l.workspace_id into ws from public.leads l where l.id = o.lead_id;
    if private.is_suppressed(ws, 'email', o.to_text) then
      delete from public.mail_outbox x where x.id = o.id;
      continue;
    end if;
    if o.message_id is null or (select m.state from public.messages m where m.id = o.message_id) = 'blocked' then
      select * into r from service.record_message(ws, o.lead_id, null, 'email', o.template, o.to_text, null, p_now);
      if r.state = 'blocked' then
        if r.reason like 'daily cap%' then
          update public.mail_outbox x set message_id = r.id, next_at = date_trunc('day', p_now) + interval '1 day' where x.id = o.id;
        else
          delete from public.mail_outbox x where x.id = o.id;
        end if;
        continue;
      end if;
      mid := r.id;
    elsif (select m.state from public.messages m where m.id = o.message_id) is distinct from 'queued' then
      delete from public.mail_outbox x where x.id = o.id;
      continue;
    else
      mid := o.message_id;
    end if;
    update public.mail_outbox x set message_id = mid, attempts = o.attempts + 1, next_at = p_now + interval '5 minutes' * (o.attempts + 1) where x.id = o.id;
    return query select mid, o.to_text, o.lead_id, w.slug, w.name, l.name, l.phone, l.email, l.form, l.flow, l.page_path, l.answers
      from public.leads l join public.workspaces w on w.id = l.workspace_id where l.id = o.lead_id;
  end loop;
end $$;

-- ---------- 4. done (mail-outbox) ----------
create function service.outbox_done(p_message uuid, p_ok boolean, p_provider_id text, p_error text) returns void language plpgsql security definer set search_path = '' as $$
declare a int;
begin
  select o.attempts into a from public.mail_outbox o where o.message_id = p_message;
  if p_ok then perform service.set_message_state(p_message, 'sent', p_provider_id);
  elsif a >= 6 then perform service.set_message_state(p_message, 'failed', null, left(p_error, 200));
  else return;   -- the lease already set the next try
  end if;
  delete from public.mail_outbox o where o.message_id = p_message;
end $$;

-- ---------- 5. the tick (pg_cron) ----------
create function service.mail_outbox_tick() returns text language plpgsql security definer set search_path = '' as $$
declare k text; base text; t bigint; sig text;
begin
  if not exists (select 1 from public.mail_outbox o where o.next_at <= now()) then return 'idle'; end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null or to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('extensions.hmac(text,text,text)') is null then
    raise notice 'pg_net, Vault or pgcrypto is not installed here: the mail outbox is not called'; return 'not installed';
  end if;
  select d.decrypted_secret into k from vault.decrypted_secrets d where d.name = 'mail_outbox_key' limit 1;
  select d.decrypted_secret into base from vault.decrypted_secrets d where d.name = 'project_url' limit 1;
  if coalesce(k, '') = '' or coalesce(base, '') = '' then
    raise notice 'the Vault entries mail_outbox_key and project_url are not both set: the mail outbox is not called'; return 'no vault entries';
  end if;
  t := extract(epoch from now())::bigint;
  sig := 't=' || t || ',v1=' || encode(extensions.hmac(t || E'\n' || 'POST' || E'\n' || '/mail-outbox' || E'\n' || '{}', k, 'sha256'), 'hex');
  perform net.http_post(rtrim(base, '/') || '/functions/v1/mail-outbox', '{}'::jsonb, '{}'::jsonb,
    jsonb_build_object('content-type', 'application/json', 'x-cron-signature', sig), 60000);
  return 'called';
end $$;

-- ---------- grants: closed to PUBLIC, anon and authenticated; the function role for queue, claim and done; the tick to nobody ----------
revoke all on function service.queue_lead_alert(uuid, uuid) from public, anon, authenticated;
revoke all on function service.outbox_claim(int, timestamptz) from public, anon, authenticated;
revoke all on function service.outbox_done(uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function service.mail_outbox_tick() from public, anon, authenticated;
-- the schema's default privileges give every new service function to service_role and omnikom_fn (migration 8); the tick is for pg_cron alone
revoke all on function service.mail_outbox_tick() from omnikom_fn, service_role;
grant execute on function service.queue_lead_alert(uuid, uuid) to service_role, omnikom_fn;
grant execute on function service.outbox_claim(int, timestamptz) to service_role, omnikom_fn;
grant execute on function service.outbox_done(uuid, boolean, text, text) to service_role, omnikom_fn;

-- ---------- the schedule ----------
do $$ begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('mail-outbox', '* * * * *', 'select service.mail_outbox_tick()');
  else
    raise notice 'pg_cron is not installed here: the mail outbox (service.mail_outbox_tick) is not scheduled';
  end if;
end $$;
