-- Omnikom Platform: book row D8 (new-lead alert to the assigned agent), migration 54. Additive: one function replaced, migration 29's text plus one block.
-- With the site's tick (sites.alert_assignee, default on) on, the login of the member linked to the lead's owner team row also gets the new-lead
-- alert: one more mail_outbox row, sent, retried, capped and suppression-checked by the existing outbox. Skipped silently, never raised, when the
-- lead has no owner, the team row has no login, the address is missing or invalid, or the address is already in lead_alert_to. Only this
-- business's members are looked at. Rights stay as migration 29 set them. Tests: tenancy.test.sql T54; mutants "alert54:".
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
    select lower(btrim(u.email)) into a from public.members m join auth.users u on u.id = m.user_id where m.workspace_id = ws and m.team_row_id = owner order by m.user_id limit 1;
    if a ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(a) <= 254
      and not exists (select 1 from unnest(tos) x where lower(btrim(x)) = a) then
      insert into public.mail_outbox (lead_id, template, to_text) values (p_lead, 'new-lead', a) on conflict do nothing;
      if found then n := n + 1; end if;
    end if;
  end if;
  return n;
end $$;
