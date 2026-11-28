-- Omnikom Platform: book row D8b (follow-up of D8), migration 55. Additive: two functions replaced, migration 54's and migration 8's text plus a few lines each.
-- The head of operations ruled on D8's two open design questions (2026-11-28 03:20):
--  1. service.queue_lead_alert mails EVERY login linked to the lead's owner team row, not only the lowest user id: one mail_outbox row per
--     distinct valid address (the rule of migration 54: the address shape and at most 254 characters), beside the listed addresses; an
--     address already listed, or shared by two logins, is queued once (the outbox's unique rule and its on conflict do nothing). An empty
--     list still mails the logins. Only this business's members are looked at. Rights stay as migration 54 set them.
--  2. service.record_message: a new-lead alert (template 'new-lead': the business's own team, both the listed addresses and the logins) is not
--     counted toward the workspace's daily email cap (email_per_day_workspace, or the workspace's own number). Team alerts are counted apart,
--     per workspace and day, and stop at the same number: past it the alert is recorded as blocked, error 'daily cap (team alerts)', and the
--     outbox keeps its row for the next day (service.outbox_claim treats every 'daily cap%' reason so). The client-facing email still
--     stops at the cap, the platform-wide cap (email_per_day) still counts every email, and every other line of record_message is kept verbatim.
-- Tests: tenancy.test.sql T55; mutants "alert55:".
create or replace function service.queue_lead_alert(p_site uuid, p_lead uuid) returns int language plpgsql security definer set search_path = '' as $$
declare tos text[]; t text; n int := 0; assignee boolean; owner uuid; ws uuid; a text;
begin
  select s.lead_alert_to, s.alert_assignee, l.workspace_id, l.owner_team_row into tos, assignee, ws, owner from public.sites s join public.leads l on l.site_id = s.id where s.id = p_site and l.id = p_lead;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  if service.lead_alerted(p_lead) then return 0; end if;
  foreach t in array tos loop
    insert into public.mail_outbox (lead_id, template, to_text) values (p_lead, 'new-lead', t) on conflict do nothing;
    if found then n := n + 1; end if;
  end loop;
  if assignee and owner is not null then
    for a in select lower(btrim(u.email)) from public.members m join auth.users u on u.id = m.user_id where m.workspace_id = ws and m.team_row_id = owner order by m.user_id loop
      if a ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(a) <= 254
        and not exists (select 1 from unnest(tos) x where lower(btrim(x)) = a) then
        insert into public.mail_outbox (lead_id, template, to_text) values (p_lead, 'new-lead', a) on conflict do nothing;
        if found then n := n + 1; end if;
      end if;
    end loop;
  end if;
  return n;
end $$;

create or replace function service.record_message(p_workspace uuid, p_lead uuid, p_user uuid, p_channel public.message_channel, p_template text, p_to text, p_about_booking uuid default null, p_now timestamptz default now(), p_idem_key text default null)
returns table (id uuid, state public.message_state, reason text) language plpgsql security definer set search_path = '' as $$
declare l public.leads; cap int; cap_ws int; sent_today int; sent_ws int; sent_team int; team boolean; tz text; h int; st public.message_state := 'queued'; why text; mid uuid; ex record; wst public.workspace_state;
begin
  if p_idem_key is not null then
    select m.id, m.state, m.error into ex from public.messages m where m.workspace_id = p_workspace and m.idem_key = p_idem_key;
    if ex.id is not null then return query select ex.id, ex.state, ex.error; return; end if;   -- a retry records nothing twice
  end if;
  if p_lead is not null then
    select * into l from public.leads where public.leads.id = p_lead;
    if not found or l.workspace_id <> p_workspace then raise exception 'S-NOT-FOUND: not found'; end if;
    if p_channel = 'sms' and not l.sms_consent then raise exception 'M-CONSENT: this person did not agree to text messages'; end if;
    if p_channel = 'sms' and l.sms_stopped_at is not null then raise exception 'M-STOP: this person asked for no more texts'; end if;
  elsif p_channel = 'sms' and p_user is null then
    raise exception 'M-CONSENT: an SMS needs a lead with consent or a team member';
  end if;
  if private.is_suppressed(p_workspace, p_channel::text::public.suppression_channel, p_to) then raise exception 'M-SUPPRESSED: this address asked for no more messages'; end if;
  team := p_channel = 'email' and p_template = 'new-lead';   -- a lead alert to the business's own team (the listed addresses and the logins)
  select value into cap from public.platform_limits where key = p_channel::text || '_per_day';
  cap_ws := private.limit_for(p_workspace, p_channel::text || '_per_day_workspace');
  select count(*), count(*) filter (where m.workspace_id = p_workspace and (m.template is distinct from 'new-lead' or m.channel <> 'email')), count(*) filter (where m.workspace_id = p_workspace and m.template = 'new-lead') into sent_today, sent_ws, sent_team from public.messages m
    where m.channel = p_channel and m.state <> 'blocked' and m.created_at >= date_trunc('day', p_now) and m.created_at < date_trunc('day', p_now) + interval '1 day';
  if team then
    if cap_ws is not null and sent_team >= cap_ws then st := 'blocked'; why := 'daily cap (team alerts)'; end if;
  else
    if cap_ws is not null and sent_ws >= cap_ws then st := 'blocked'; why := 'daily cap (workspace)'; end if;
  end if;
  if cap is not null and sent_today >= cap then st := 'blocked'; why := 'daily cap'; end if;
  select w.state into wst from public.workspaces w where w.id = p_workspace;
  if wst in ('suspended', 'deleted') then st := 'blocked'; why := 'workspace suspended'; end if;
  if p_channel = 'sms' and st = 'queued' then
    select timezone into tz from public.workspaces where public.workspaces.id = p_workspace;
    h := extract(hour from (p_now at time zone tz));
    if h >= (select value from public.platform_limits where key = 'quiet_hours_start') or h < (select value from public.platform_limits where key = 'quiet_hours_end') then
      st := 'blocked'; why := 'quiet hours'; end if;
  end if;
  insert into public.messages (workspace_id, lead_id, user_id, channel, template, to_text, about_booking, state, error, created_at, idem_key)
    values (p_workspace, p_lead, p_user, p_channel, p_template, p_to, p_about_booking, st, why, p_now, p_idem_key) returning public.messages.id into mid;
  return query select mid, st, why;
end $$;
