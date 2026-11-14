-- Omnikom Platform: book row C11-a (suppressions), migration 50. Additive: one function replaced, migration 29's text but for one line.
-- An alert that service.outbox_claim dropped because its address is suppressed left no trace, so an owner never learned why no mail
-- came. Now the drop writes one alert-failed event on the lead (the kind exists since migration 2; the dashboard words it "An alert
-- could not be sent") with the address and the reason. Rights stay as migration 29 set them. Tests: T35j, T35k; mutants "alert50:".
create or replace function service.outbox_claim(p_limit int, p_now timestamptz default now())
returns table (message_id uuid, to_text text, lead_id uuid, workspace_slug text, business text, name text, phone text, email text, form text, flow text, page_path text, answers jsonb)
language plpgsql security definer set search_path = '' as $$
declare o public.mail_outbox; ws uuid; r record; mid uuid;
begin
  for o in select x.* from public.mail_outbox x where x.next_at <= p_now order by x.next_at, x.id limit p_limit for update loop
    select l.workspace_id into ws from public.leads l where l.id = o.lead_id;
    if private.is_suppressed(ws, 'email', o.to_text) then
      insert into public.lead_events (lead_id, workspace_id, kind, detail) values (o.lead_id, ws, 'alert-failed', jsonb_build_object('to', o.to_text, 'reason', 'suppressed'));
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
