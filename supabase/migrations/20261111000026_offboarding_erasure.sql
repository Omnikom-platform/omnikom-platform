-- Omnikom Platform: work order 37b (Clients department; head of operations ruling 2026-11-10 20:57: this one migration file and its tests
-- are the Clients department's, reviewed by platform before it lands; number 26 set by the head of operations 2026-11-11 02:19: 24 was reserved first, renamed before anything applied it, so the staging ledger runs 23, 25, 26 in order). Product row E14.
-- Additive to migrations 1 to 25. It replaces three functions with `create or replace` (service.delete_lead, service.set_workspace_state,
-- private.refuse_change), each keeping every earlier line verbatim, and adds one. It does not touch service.lead_set_fields or
-- private.lead_query_check (migration 20 redefines them).
--  1. Erasure scrubs every copy of the person (platform's condition: after delete_lead no plaintext address or number stays anywhere).
--     service.delete_lead, before the lead row goes:
--     - messages: to_text that is the lead's email (any case) or holds its number (the last 10 digits, any layout, an optional leading 1,
--       and no other digit next to them, so another person's longer number is never taken: platform review 2026-11-10) becomes
--       'erased:<sha256 of the old text>', and its error is emptied (a provider error can quote the address). messages.lead_id is ON DELETE SET NULL, so these rows
--       outlived the lead with the address in them (found by work order 37's scan, `work/37-offboard/CONTEXT.md` finding 2).
--     - webhook_events of the workspace whose payload holds the email (as a whole address: no address character next to it) or the
--       number (as above): payload becomes {"erased": true}, error emptied. The
--       kind, the provider's event id and the times stay (they hold no address and keep a retried webhook recognisable).
--     - consent_ledger rows of the lead keep only hashes and the time: lead_id, user_agent and marketing are emptied, and the new columns
--       email_hash and phone_hash take private.address_hash of the lead's email and number (the suppression list's own hash), so a later
--       question "did this person consent?" can still be answered from the person's own address. The wording (consent_text, the same
--       for every lead of a form), its consent_hash, ip_hash, form, page_path, sms_consent and `at` are kept: the proof of consent.
--  2. The ledger stays append-only. private.refuse_change() lets through exactly one update: on consent_ledger, inside delete_lead
--     (the transaction-local setting omnikom.erasure = 'on', run as the table's owner, that is the definer function), and only the shape
--     of item 1: the three fields emptied, the two hashes set where they were empty, every other column unchanged. Anything else is
--     refused as before, by every role, the owner included.
--  3. service.offboarding_storage(claims, workspace): staff with MFA only, and only for a workspace in the state offboarding: the paths of
--     the workspace's files in the media bucket. Supabase refuses a direct SQL delete of storage rows ("Direct deletion from storage
--     tables is not allowed. Use the Storage API instead.", trigger storage.protect_delete, read on staging 2026-11-10), so the files are
--     deleted through the Storage API by tools/client-infra/offboard.mjs with this list.
--  4. service.set_workspace_state: the move offboarding -> deleted is refused while the workspace still has a file in the media bucket
--     (S-WORKSPACE-STORAGE) or an api key that is not revoked (S-WORKSPACE-KEYS).
--     Limit: a number with fewer than 10 digits is not scrubbed (too short to tell apart from part of another number); the person's
--     email still is, and the lead row itself goes in any case.
-- Tests: supabase/tests/tenancy.test.sql T31; mutants in supabase/tests/run-local.mjs ("erasure 26: ...").

set lock_timeout = '5s';

alter table public.consent_ledger add column email_hash text, add column phone_hash text;
alter table public.consent_ledger add constraint consent_ledger_email_hash_hex check (email_hash ~ '^[0-9a-f]{64}$') not valid;
alter table public.consent_ledger validate constraint consent_ledger_email_hash_hex;
alter table public.consent_ledger add constraint consent_ledger_phone_hash_hex check (phone_hash ~ '^[0-9a-f]{64}$') not valid;
alter table public.consent_ledger validate constraint consent_ledger_phone_hash_hex;

-- private.refuse_change: unchanged for every table but consent_ledger; there, the one erasure update of item 2
create or replace function private.refuse_change() returns trigger language plpgsql set search_path = '' as $$
begin
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

-- service.delete_lead: migration 8's lines verbatim, the erasure of item 1 between the audit row and the delete
create or replace function service.delete_lead(p_claims jsonb, p_lead uuid, p_reason text default null) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid; l public.leads; em text; emr text; ph text; re text;
begin
  me := service.use_claims(p_claims);
  select * into l from public.leads where id = p_lead;
  if not found or not private.is_owner_or_staff(l.workspace_id) then raise exception 'S-NOT-FOUND: not found'; end if;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (l.workspace_id, me, 'lead-delete', p_lead::text, jsonb_build_object('reason', p_reason, 'email_hash', encode(sha256(convert_to(coalesce(l.email, ''), 'utf8')), 'hex')));
  -- the person's address and number as they may be written anywhere: the email lower-cased, as a whole address; the number's last 10
  -- digits in any layout, an optional leading 1, and no digit on either side (never part of another person's longer number)
  em := nullif(lower(btrim(coalesce(l.email, ''))), '');
  emr := case when em is null then null else '(^|[^a-z0-9._%+-])' || regexp_replace(em, '([^a-z0-9])', '\\\1', 'g') || '($|[^a-z0-9._%+-])' end;
  ph := regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g');
  ph := case when length(ph) >= 10 then right(ph, 10) end;
  re := case when ph is null then null else '(^|[^0-9])(1[-. ()+]{0,3})?' || regexp_replace(ph, '([0-9])', '\1[-. ()+]{0,3}', 'g') || '($|[^0-9])' end;
  update public.messages m set to_text = 'erased:' || encode(sha256(convert_to(lower(btrim(m.to_text)), 'utf8')), 'hex'), error = null
    where m.workspace_id = l.workspace_id and m.to_text not like 'erased:%' and ((em is not null and lower(btrim(m.to_text)) = em) or (re is not null and m.to_text ~ re));
  update public.webhook_events w set payload = jsonb_build_object('erased', true), error = null
    where w.workspace_id = l.workspace_id and ((emr is not null and lower(w.payload::text) ~ emr) or (re is not null and w.payload::text ~ re));
  perform set_config('omnikom.erasure', 'on', true);
  update public.consent_ledger c set lead_id = null, user_agent = null, marketing = null,
      email_hash = coalesce(c.email_hash, private.address_hash('email', l.email)), phone_hash = coalesce(c.phone_hash, private.address_hash('sms', l.phone))
    where c.workspace_id = l.workspace_id and c.lead_id = p_lead;
  perform set_config('omnikom.erasure', 'off', true);
  delete from public.leads where id = p_lead;
end $$;

-- service.offboarding_storage: item 3
create function service.offboarding_storage(p_claims jsonb, p_workspace uuid) returns table (path text) language plpgsql security definer set search_path = '' as $$
declare w public.workspaces;
begin
  perform service.use_claims(p_claims);
  if not private.is_staff() then raise exception 'S-NOT-FOUND: not found'; end if;
  select * into w from public.workspaces where id = p_workspace;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  if w.state <> 'offboarding' then raise exception 'S-WORKSPACE-STATE: % is %: only an offboarding workspace''s files are listed for deletion', w.slug, w.state; end if;
  return query select o.name::text from storage.objects o where o.bucket_id = 'media' and o.name like p_workspace::text || '/%' order by o.name;
end $$;

-- service.set_workspace_state: migration 8's lines verbatim, item 4 before the update
create or replace function service.set_workspace_state(p_claims jsonb, p_workspace uuid, p_state public.workspace_state, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid; w public.workspaces; ok boolean; n int;
begin
  me := service.use_claims(p_claims);
  if not private.is_staff() then raise exception 'S-NOT-FOUND: not found'; end if;
  select * into w from public.workspaces where id = p_workspace for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  ok := (w.state, p_state) in (('trial', 'active'), ('trial', 'suspended'), ('active', 'suspended'), ('suspended', 'active'), ('active', 'offboarding'), ('suspended', 'offboarding'), ('offboarding', 'deleted'));
  ok := coalesce(ok, false);
  if not ok then raise exception 'S-WORKSPACE-STATE: % -> % is not allowed', w.state, p_state; end if;
  if p_state = 'deleted' then
    select count(*) into n from storage.objects o where o.bucket_id = 'media' and o.name like p_workspace::text || '/%';
    if n > 0 then raise exception 'S-WORKSPACE-STORAGE: % file(s) of the workspace are still in Storage', n; end if;
    select count(*) into n from public.api_keys k where k.workspace_id = p_workspace and k.revoked_at is null;
    if n > 0 then raise exception 'S-WORKSPACE-KEYS: % key(s) of the workspace are not revoked', n; end if;
  end if;
  update public.workspaces set state = p_state, state_changed_at = now(), state_reason = p_reason where id = p_workspace;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'workspace-' || p_state, p_workspace::text, jsonb_build_object('from', w.state, 'reason', p_reason));
end $$;

revoke all on function service.offboarding_storage(jsonb, uuid) from public, anon, authenticated;
grant execute on function service.offboarding_storage(jsonb, uuid) to service_role, omnikom_fn;
