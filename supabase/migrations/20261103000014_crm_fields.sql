-- Omnikom Platform: work order 01 (CRM backend), migration 14. Additive to migrations 1 to 13 (applied migrations are never edited).
-- The CRM is a full CRM, not an inbox: every lead field is visible and editable, the columns follow the business's industry.
-- Industry fields stay in leads.answers (jsonb, keyed as in the contract); "a column" means the list, the export and the record
-- expose the key as one. Nothing per industry here: every rule reads the workspace's active resolved contract
-- (site_contracts.resolved -> forms -> <form> -> fields), declared and validated by contracts/validate.mjs (C-FORM-*).
--  1. lead_event_kind gains 'edited': one event per changed field, detail {field, old, new}.
--  2. private.lead_columns(ws)       the industry columns: every non-core form key of the active contract, typed (contracts leadColumns)
--     private.typed_value(def, v)    one value checked and typed against its declaration: a number becomes a JSON number, a select value
--                                    must be one of its options, a reference must name a row of its collection; a bad value raises
--                                    'I-ANSWER <key>: <plain words>' (the words come from the contract, never from the caller)
--     private.typed_answers(ws, form, answers)  a submission's answers against its form: unknown keys dropped, empty dropped, required checked
--  3. service.capture_lead types the answers before it stores them, so no caller can skip the check (the function may pre-check for the message).
--  4. service.lead_set_fields  edit any core field (name, email, phone, status, owner) and any editable industry field; never the consent record.
--  5. service.lead_list        search, filter, sort and page on the server, exactly the leads the caller may read (the leads_read policy's rule).
--  6. service.leads_bulk       status, owner or delete for up to 500 leads, all or nothing; delete is the hard delete and needs p_confirm.
-- Every function: security definer, set search_path = '', fully schema-qualified, closed to PUBLIC, granted to the function role only.
-- Tests: tenancy.test.sql T22 (walls) and run-local.mjs mutants "crm14: ...".

alter type public.lead_event_kind add value if not exists 'edited';

-- ---------- 2. the industry columns and the typing ----------
-- name, email and phone are the lead's own columns; every other key of every form is an industry column, first declaration wins
-- its type and flags (validate.mjs C-FORM-SAME-KEY makes them agree), options are the union of every form that declares the key.
create function private.lead_columns(p_ws uuid) returns table (key text, def jsonb, ord bigint) language sql stable security definer set search_path = '' as $$
  with f as (
    select fl.key, fl.value as d, fm.ord * 1000 + fl.ord as ord
    from public.site_contracts sc,
      jsonb_each(coalesce(sc.resolved -> 'forms', '{}'::jsonb)) with ordinality fm(fid, form, ord),
      jsonb_each(case when jsonb_typeof(fm.form -> 'fields') = 'object' then fm.form -> 'fields' else '{}'::jsonb end) with ordinality fl(key, value, ord)
    where sc.workspace_id = p_ws and sc.active and fl.key not in ('name', 'email', 'phone') and jsonb_typeof(fl.value) = 'object'
  ), first0 as (
    select distinct on (f.key) f.key, f.d, f.ord from f order by f.key, f.ord
  ), first as (
    -- jsonb keeps no key order, so the resolved contract carries leadColumns (an ARRAY, contracts/validate.mjs leadColumns, form order):
    -- it decides the order only; types, flags and options always come from the forms above. A contract without it: jsonb order.
    select first0.key, first0.d, coalesce((select o.ord from public.site_contracts sc2,
        jsonb_array_elements(case when jsonb_typeof(sc2.resolved -> 'leadColumns') = 'array' then sc2.resolved -> 'leadColumns' else '[]'::jsonb end) with ordinality o(v, ord)
        where sc2.workspace_id = p_ws and sc2.active and o.v ->> 'key' = first0.key limit 1), 1000000 + first0.ord) as ord
    from first0
  )
  select first.key,
    first.d || jsonb_build_object(
      'column', coalesce((first.d ->> 'column')::boolean, true),
      'editable', coalesce((first.d ->> 'editable')::boolean, true),
      'options', coalesce((select jsonb_agg(o order by o_ord) from (
         select distinct on (o.value) o.value as o, f2.ord * 1000 + o.ord as o_ord
         from f f2, jsonb_array_elements(case when jsonb_typeof(f2.d -> 'options') = 'array' then f2.d -> 'options' else '[]'::jsonb end) with ordinality o(value, ord)
         where f2.key = first.key order by o.value, f2.ord * 1000 + o.ord) x), '[]'::jsonb)),
    first.ord
  from first order by first.ord $$;

-- One value against its declaration. Returns the typed JSON value, or NULL for an empty value (nothing is stored for it).
create function private.typed_value(p_key text, p_def jsonb, p_v jsonb) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t text := p_def ->> 'type'; lbl text := coalesce(p_def ->> 'label', p_key); s text; n numeric; d date; a jsonb := '[]'::jsonb; e jsonb;
begin
  if p_v is null or p_v = 'null'::jsonb or p_v = '""'::jsonb or p_v = '[]'::jsonb then return null; end if;
  if t = 'choice' and coalesce((p_def ->> 'multi')::boolean, false) then
    for e in select x from jsonb_array_elements(case when jsonb_typeof(p_v) = 'array' then p_v else jsonb_build_array(p_v) end) x loop
      if jsonb_typeof(e) <> 'string' or not ((p_def -> 'options') ? (e #>> '{}')) then
        raise exception 'I-ANSWER %: % must be one or more of the listed choices', p_key, lbl; end if;
      if not a @> jsonb_build_array(e) then a := a || jsonb_build_array(e); end if;
    end loop;
    return case when jsonb_array_length(a) = 0 then null else a end;
  end if;
  if jsonb_typeof(p_v) in ('array', 'object') then raise exception 'I-ANSWER %: % must be a single value', p_key, lbl; end if;
  s := btrim(p_v #>> '{}');
  if s = '' then return null; end if;
  if t = 'number' then
    if jsonb_typeof(p_v) = 'number' then n := (p_v #>> '{}')::numeric;
    elsif s ~ '^-?[0-9]{1,15}(\.[0-9]{1,6})?$' then n := s::numeric;
    else raise exception 'I-ANSWER %: % must be a number', p_key, lbl; end if;
    if (p_def ? 'min' and n < (p_def ->> 'min')::numeric) or (p_def ? 'max' and n > (p_def ->> 'max')::numeric) then
      raise exception 'I-ANSWER %: % must be a number from % to %', p_key, lbl, coalesce(p_def ->> 'min', 'any'), coalesce(p_def ->> 'max', 'any'); end if;
    return to_jsonb(n);
  elsif t = 'boolean' then
    if lower(s) in ('true', 'yes', 'on', '1') then return 'true'::jsonb; end if;
    if lower(s) in ('false', 'no', 'off', '0') then return 'false'::jsonb; end if;
    raise exception 'I-ANSWER %: % must be ticked or not', p_key, lbl;
  elsif t in ('enum', 'choice') then
    if jsonb_typeof(p_v) <> 'string' or not ((p_def -> 'options') ? s) then raise exception 'I-ANSWER %: % must be one of the listed choices', p_key, lbl; end if;
    return to_jsonb(s);
  elsif t = 'date' then
    if s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'I-ANSWER %: % must be a date (year-month-day)', p_key, lbl; end if;
    begin d := s::date; exception when others then raise exception 'I-ANSWER %: % must be a date (year-month-day)', p_key, lbl; end;
    return to_jsonb(d::text);
  elsif t = 'email' then
    if length(s) > 254 or s !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'I-ANSWER %: % must be an email address', p_key, lbl; end if;
    return to_jsonb(s);
  elsif t = 'phone' then
    if length(s) > 40 or s !~ '^[0-9+().\s-]{4,40}$' then raise exception 'I-ANSWER %: % must be a phone number', p_key, lbl; end if;
    return to_jsonb(s);
  elsif t = 'reference' then
    if s !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(s) > 120 then raise exception 'I-ANSWER %: % must be one of the listed choices', p_key, lbl; end if;
    return to_jsonb(s);
  elsif t = 'text' then
    if length(s) > least(coalesce((p_def ->> 'max')::int, 2000), 5000) then
      raise exception 'I-ANSWER %: % is at most % characters', p_key, lbl, least(coalesce((p_def ->> 'max')::int, 2000), 5000); end if;
    return to_jsonb(s);
  end if;
  raise exception 'I-ANSWER %: % cannot be stored', p_key, lbl;
end $$;

-- A reference value must name a live row of its collection in this workspace (latest version's slug), as the assignee does.
create function private.reference_ok(p_ws uuid, p_def jsonb, p_slug text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.content_rows c
    join public.content_versions v on v.row_id = c.id and v.n = (select max(x.n) from public.content_versions x where x.row_id = c.id)
    where c.workspace_id = p_ws and c.collection = p_def ->> 'to' and c.deleted_at is null and v.data ->> 'slug' = p_slug) $$;

-- A submission's answers against the form it came from: only declared industry keys are kept, each typed; a required one must be there.
create function private.typed_answers(p_ws uuid, p_form text, p_answers jsonb) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare fields jsonb; k text; d jsonb; v jsonb; out jsonb := '{}'::jsonb;
begin
  select sc.resolved -> 'forms' -> p_form -> 'fields' into fields from public.site_contracts sc where sc.workspace_id = p_ws and sc.active;
  -- a form the contract does not declare: the lead is kept (a lead is never lost), every answer is an unknown key and is dropped
  if fields is null or jsonb_typeof(fields) <> 'object' then return '{}'::jsonb; end if;
  if p_answers is not null and jsonb_typeof(p_answers) <> 'object' then raise exception 'I-ANSWER answers: the answers must be an object'; end if;
  for k, d in select x.key, x.value from jsonb_each(fields) x where x.key not in ('name', 'email', 'phone') loop
    v := private.typed_value(k, d, coalesce(p_answers, '{}'::jsonb) -> k);
    if v is null then
      if coalesce((d ->> 'required')::boolean, false) then raise exception 'I-ANSWER %: % is needed', k, coalesce(d ->> 'label', k); end if;
      continue;
    end if;
    if d ->> 'type' = 'reference' and not private.reference_ok(p_ws, d, v #>> '{}') then
      raise exception 'I-ANSWER %: % must be one of the listed choices', k, coalesce(d ->> 'label', k); end if;
    out := out || jsonb_build_object(k, v);
  end loop;
  return out;   -- a key the form does not declare is dropped here, never stored
end $$;

-- ---------- 3. capture types the answers (as migration 8, plus the one typing line) ----------
create or replace function service.capture_lead(p_site uuid, p_form text, p_page text, p_name text, p_email text, p_phone text, p_answers jsonb, p_consent text,
  p_flow text default null, p_cta text default null, p_marketing jsonb default null, p_idempotency uuid default null, p_assignee text default null,
  p_ip_hash text default null, p_user_agent text default null, p_sms_consent boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare ws uuid; st public.site_state; wst public.workspace_state; lid uuid; who uuid; cap int; typed jsonb;
begin
  select s.workspace_id, s.state, w.state into ws, st, wst from public.sites s join public.workspaces w on w.id = s.workspace_id where s.id = p_site;
  if ws is null then raise exception 'unknown site'; end if;
  if st = 'paused' then raise exception 'S-SITE-PAUSED: this site is paused'; end if;
  if wst in ('suspended', 'deleted') then raise exception 'S-WORKSPACE-SUSPENDED: this workspace is suspended'; end if;
  if coalesce(p_consent, '') = '' then raise exception 'consent text required'; end if;
  if p_idempotency is not null then
    select public.leads.id into lid from public.leads where site_id = p_site and idempotency_key = p_idempotency;
    if lid is not null then return lid; end if;    -- a retry of the same submission stores nothing and answers the same id
  end if;
  typed := private.typed_answers(ws, p_form, p_answers);   -- migration 14: checked against the active contract's form, unknown keys dropped
  cap := private.limit_for(ws, 'leads_per_hour_workspace');
  if cap is not null and (select count(*) from public.leads l where l.workspace_id = ws and l.created_at > now() - interval '1 hour') >= cap then
    raise exception 'S-QUOTA: this workspace reached its hourly lead limit'; end if;
  if p_assignee is not null then
    -- the team row of THIS workspace whose latest version has that slug; another workspace's slug never matches
    select c.id into who from public.content_rows c
      join public.content_versions v on v.row_id = c.id and v.n = (select max(n) from public.content_versions x where x.row_id = c.id)
      where c.workspace_id = ws and c.collection = 'team' and c.deleted_at is null and v.data ->> 'slug' = p_assignee limit 1;
  end if;
  -- two concurrent retries: the unique index decides, the loser reads the winner's row
  insert into public.leads (workspace_id, site_id, form, page_path, name, email, phone, answers, consent_text, flow, cta, marketing_consent, idempotency_key, source_ip_hash, user_agent, owner_team_row, sms_consent)
    values (ws, p_site, p_form, p_page, p_name, p_email, p_phone, typed, p_consent, p_flow, p_cta, p_marketing, p_idempotency, p_ip_hash, p_user_agent, who, coalesce(p_sms_consent, false))
    on conflict (site_id, idempotency_key) where idempotency_key is not null do nothing
    returning public.leads.id into lid;
  if lid is null then select public.leads.id into lid from public.leads where site_id = p_site and idempotency_key = p_idempotency; return lid; end if;
  insert into public.lead_events (lead_id, workspace_id, kind, detail) values (lid, ws, 'received', jsonb_build_object('form', p_form, 'page', p_page, 'flow', p_flow));
  perform private.record_consent(ws, p_site, lid, p_form, p_page, p_consent, p_sms_consent, p_marketing, p_ip_hash, p_user_agent, null);
  return lid;
end $$;

-- ---------- 4. one edit call ----------
-- p_fields: { name?, email?, phone?, status?, owner? (team row id or null), <industry key>? (null or "" clears it) }, at most 50 keys.
-- Refused: a consent field (S-CONSENT), a key that is not a column (I-UNKNOWN), a field the contract marks editable false (S-LOCKED),
-- a bad value (I-ANSWER), a member changing the owner (S-OWN-ONLY), a lead the caller cannot act on (S-NOT-FOUND). All or nothing.
create function service.lead_set_fields(p_claims jsonb, p_lead uuid, p_fields jsonb) returns int language plpgsql security definer set search_path = '' as $$
declare me uuid; l public.leads; staff boolean; role public.member_role; k text; v jsonb; d jsonb; old jsonb; nv jsonb;
  ans jsonb; changed text[] := '{}'; ev jsonb := '[]'::jsonb; e jsonb;
  n_name text; n_email text; n_phone text; n_status public.lead_status; n_owner uuid;
begin
  me := service.use_claims(p_claims);
  select * into l from public.leads where public.leads.id = p_lead for update;
  if not found or not private.can_act_on_lead(l) then raise exception 'S-NOT-FOUND: not found'; end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or (select count(*) from jsonb_object_keys(p_fields)) > 50 then
    raise exception 'I-ANSWER fields: send at most 50 fields as an object'; end if;
  staff := private.is_staff(); role := private.my_role(l.workspace_id);
  ans := l.answers; n_name := l.name; n_email := l.email; n_phone := l.phone; n_status := l.status; n_owner := l.owner_team_row;
  for k, v in select x.key, x.value from jsonb_each(p_fields) x loop
    if k in ('consent_text', 'consentText', 'consent', 'marketing_consent', 'marketingConsent', 'marketingConsentText', 'sms_consent', 'smsConsent', 'sms_stopped_at') then
      raise exception 'S-CONSENT: the consent record cannot be edited'; end if;
    if k = 'name' then
      nv := private.typed_value('name', '{"type":"text","max":120,"label":"Name"}', v); old := to_jsonb(l.name); n_name := nv #>> '{}';
    elsif k = 'email' then
      nv := private.typed_value('email', '{"type":"email","label":"Email"}', v); old := to_jsonb(l.email); n_email := nv #>> '{}';
    elsif k = 'phone' then
      nv := private.typed_value('phone', '{"type":"phone","label":"Phone"}', v); old := to_jsonb(l.phone); n_phone := nv #>> '{}';
    elsif k = 'status' then
      if jsonb_typeof(v) <> 'string' or not ((v #>> '{}') = any (enum_range(null::public.lead_status)::text[])) then
        raise exception 'I-ANSWER status: Status must be one of the lead statuses'; end if;
      nv := v; old := to_jsonb(l.status::text); n_status := (v #>> '{}')::public.lead_status;
    elsif k = 'owner' then
      if not staff and role = 'member' then raise exception 'S-OWN-ONLY: members cannot hand a lead to someone else'; end if;
      if v is not null and v <> 'null'::jsonb then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or not exists (select 1 from public.content_rows c where c.id = (v #>> '{}')::uuid and c.workspace_id = l.workspace_id and c.collection = 'team' and c.deleted_at is null)
          then raise exception 'S-NOT-FOUND: no such team member'; end if;
        nv := v; n_owner := (v #>> '{}')::uuid;
      else nv := null; n_owner := null; end if;
      old := to_jsonb(l.owner_team_row);
    else
      select c.def into d from private.lead_columns(l.workspace_id) c where c.key = k;
      if d is null then raise exception 'I-UNKNOWN: "%" is not a field of this lead', left(k, 40); end if;
      if not (d ->> 'editable')::boolean then raise exception 'S-LOCKED: "%" cannot be edited', k; end if;
      nv := private.typed_value(k, d, v);
      if nv is not null and d ->> 'type' = 'reference' and not private.reference_ok(l.workspace_id, d, nv #>> '{}') then
        raise exception 'I-ANSWER %: % must be one of the listed choices', k, coalesce(d ->> 'label', k); end if;
      old := l.answers -> k;
      ans := case when nv is null then ans - k else ans || jsonb_build_object(k, nv) end;
    end if;
    if old is distinct from nv and not (old is null and nv = 'null'::jsonb) then
      changed := changed || k;
      ev := ev || jsonb_build_array(jsonb_build_object('field', k, 'old', old, 'new', nv));
    end if;
  end loop;
  if cardinality(changed) > 0 then
    update public.leads set name = n_name, email = n_email, phone = n_phone, status = n_status, owner_team_row = n_owner, answers = ans
      where public.leads.id = p_lead;
    for e in select x from jsonb_array_elements(ev) x loop
      insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'edited', me, e);
    end loop;
  end if;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (l.workspace_id, me, 'lead-edit', p_lead::text, jsonb_build_object('fields', to_jsonb(changed)));
  return cardinality(changed);
end $$;

-- ---------- 5. the server list ----------
-- p_query: { search?: text (<= 200), filters?: [ { field, op: eq | in | range | empty | not_empty, value?, values?, from?, to? } ] (<= 20),
--            sort?: { field, dir: asc | desc }, page?: 1.., size?: 1..200 (default 50) }
-- Core keys: created_at, name, email, phone, status, owner, form, page. Industry keys: private.lead_columns with column true.
-- A key outside both is refused (S-QUERY); no caller text is ever put into SQL text: every value is a parameter or a jsonb lookup.
-- Returns { total, page, size, columns: [{ key, type, label, options, ... }], rows: [{ id, created_at, name, email, phone, status, owner,
--   form, page, site, <industry key>: typed value, ... }] }: exactly the leads the leads_read policy shows the caller (a member: own only).
-- The order: the sort key typed as the contract says (a number sorts as a number), empty last, then created_at desc, id desc.
create function private.lead_value(l public.leads, p_key text) returns jsonb language sql immutable set search_path = '' as $$
  select case p_key when 'created_at' then to_jsonb(l.created_at) when 'name' then to_jsonb(l.name) when 'email' then to_jsonb(l.email)
    when 'phone' then to_jsonb(l.phone) when 'status' then to_jsonb(l.status::text) when 'owner' then to_jsonb(l.owner_team_row)
    when 'form' then to_jsonb(l.form) when 'page' then to_jsonb(l.page_path) else l.answers -> p_key end $$;

create function private.lead_filter_ok(l public.leads, p_type text, p_f jsonb) returns boolean language plpgsql immutable set search_path = '' as $$
declare v jsonb := private.lead_value(l, p_f ->> 'field'); op text := p_f ->> 'op'; x jsonb; num numeric;
begin
  if op = 'empty' then return v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb; end if;
  if op = 'not_empty' then return not (v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb); end if;
  if v is null or v = 'null'::jsonb then return false; end if;
  if op = 'range' then
    if p_type = 'number' then
      if jsonb_typeof(v) <> 'number' then return false; end if;
      num := (v #>> '{}')::numeric;
      return (p_f -> 'from' is null or num >= (p_f ->> 'from')::numeric) and (p_f -> 'to' is null or num <= (p_f ->> 'to')::numeric);
    end if;   -- date, datetime: ISO text compares in time order
    return (p_f -> 'from' is null or (v #>> '{}') >= (p_f ->> 'from')) and (p_f -> 'to' is null or (v #>> '{}') <= (p_f ->> 'to') || case when p_type = 'datetime' then '~' else '' end);
  end if;
  for x in select y from jsonb_array_elements(case when op = 'in' then p_f -> 'values' else jsonb_build_array(p_f -> 'value') end) y loop
    if jsonb_typeof(v) = 'array' then
      if v @> jsonb_build_array(x) then return true; end if;
    elsif p_type = 'number' then
      if jsonb_typeof(v) = 'number' and jsonb_typeof(x) = 'number' and (v #>> '{}')::numeric = (x #>> '{}')::numeric then return true; end if;
    elsif lower(v #>> '{}') = lower(x #>> '{}') then return true;
    end if;
  end loop;
  return false;
end $$;

create function service.lead_list(p_claims jsonb, p_workspace uuid, p_query jsonb default '{}') returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid; staff boolean; role public.member_role; mine uuid; see_all boolean;
  q jsonb := coalesce(p_query, '{}'::jsonb); cols jsonb; allf jsonb; types jsonb; f jsonb; search text; skey text; sdir text; stype text;
  size int; pg int; total bigint; rows jsonb;
begin
  me := service.use_claims(p_claims);
  staff := coalesce(private.is_staff(), false); role := private.my_role(p_workspace); mine := private.my_team_row(p_workspace);
  if not staff and role is null then   -- not a member of this workspace: the leads_read policy shows nothing, and so does this
    return jsonb_build_object('total', 0, 'page', 1, 'size', 0, 'columns', '[]'::jsonb, 'fields', '[]'::jsonb, 'rows', '[]'::jsonb); end if;
  see_all := staff or role = 'owner';
  if jsonb_typeof(q) <> 'object' then raise exception 'S-QUERY: the query must be an object'; end if;
  -- the keys a caller may name: the core list and the contract's industry columns, each with its type
  select coalesce(jsonb_agg(c.def || jsonb_build_object('key', c.key, 'label', coalesce(c.def ->> 'label', c.key)) order by c.ord), '[]'::jsonb)
    into allf from private.lead_columns(p_workspace) c;   -- every industry field, a column or not (the export writes them all)
  select coalesce(jsonb_agg(c.def || jsonb_build_object('key', c.key, 'label', coalesce(c.def ->> 'label', c.key)) order by c.ord), '[]'::jsonb),
         coalesce(jsonb_object_agg(c.key, c.def ->> 'type'), '{}'::jsonb)
    into cols, types from private.lead_columns(p_workspace) c where (c.def ->> 'column')::boolean;
  types := types || '{"created_at":"datetime","name":"text","email":"text","phone":"text","status":"enum","owner":"owner","form":"text","page":"text"}'::jsonb;
  search := nullif(btrim(coalesce(q ->> 'search', '')), '');
  if length(search) > 200 then raise exception 'S-QUERY: search is at most 200 characters'; end if;
  if q ? 'filters' and (jsonb_typeof(q -> 'filters') <> 'array' or jsonb_array_length(q -> 'filters') > 20) then raise exception 'S-QUERY: at most 20 filters'; end if;
  for f in select x from jsonb_array_elements(coalesce(q -> 'filters', '[]'::jsonb)) x loop
    if jsonb_typeof(f) <> 'object' or not (types ? coalesce(f ->> 'field', '')) then raise exception 'S-QUERY: "%" is not a column', left(coalesce(f ->> 'field', ''), 40); end if;
    if coalesce(f ->> 'op', '') not in ('eq', 'in', 'range', 'empty', 'not_empty') then raise exception 'S-QUERY: a filter is eq, in, range, empty or not_empty'; end if;
    if f ->> 'op' = 'range' and not (types ->> (f ->> 'field') in ('number', 'date', 'datetime')) then raise exception 'S-QUERY: a range needs a number or date column'; end if;
    if f ->> 'op' = 'range' and types ->> (f ->> 'field') = 'number' and ((f ? 'from' and jsonb_typeof(f -> 'from') <> 'number') or (f ? 'to' and jsonb_typeof(f -> 'to') <> 'number')) then
      raise exception 'S-QUERY: a number range takes numbers'; end if;
    if f ->> 'op' = 'in' and (jsonb_typeof(f -> 'values') is distinct from 'array' or jsonb_array_length(f -> 'values') > 100) then raise exception 'S-QUERY: "in" takes a list of at most 100 values'; end if;
  end loop;
  skey := coalesce(q -> 'sort' ->> 'field', 'created_at'); sdir := coalesce(q -> 'sort' ->> 'dir', case when skey = 'created_at' then 'desc' else 'asc' end);
  if not (types ? skey) then raise exception 'S-QUERY: "%" is not a column', left(skey, 40); end if;
  if sdir not in ('asc', 'desc') then raise exception 'S-QUERY: sort direction is asc or desc'; end if;
  stype := types ->> skey;
  if (q ? 'size' and jsonb_typeof(q -> 'size') <> 'number') or (q ? 'page' and jsonb_typeof(q -> 'page') <> 'number') then
    raise exception 'S-QUERY: page and size are numbers'; end if;
  size := coalesce((q ->> 'size')::numeric::int, 50); pg := coalesce((q ->> 'page')::numeric::int, 1);
  if size < 1 or size > 200 then raise exception 'S-QUERY: a page holds 1 to 200 leads'; end if;
  if pg < 1 or pg > 100000 then raise exception 'S-QUERY: page starts at 1'; end if;

  -- each sort key typed once (sn number, sb boolean, ss status, st created_at, sx text); the page and the answer use the same row number
  with m as (
    select l.*, x.sv,
      case when stype = 'number' and jsonb_typeof(x.sv) = 'number' then (x.sv #>> '{}')::numeric end as sn,
      case when stype = 'boolean' and jsonb_typeof(x.sv) = 'boolean' then (x.sv #>> '{}')::boolean end as sb,
      case when skey = 'status' then l.status end as ss,
      case when skey = 'created_at' then l.created_at end as st,
      case when stype not in ('number', 'boolean') and skey not in ('status', 'created_at') then nullif(lower(x.sv #>> '{}'), '') end as sx
    from public.leads l cross join lateral (select private.lead_value(l, skey) as sv) x
    where l.workspace_id = p_workspace
      and (see_all or (role = 'member' and l.owner_team_row = mine))      -- the leads_read policy's rule, row by row
      and (search is null or position(lower(search) in lower(concat_ws(' ', l.name, l.email, l.phone,
            (select string_agg(a.value, ' ') from jsonb_each_text(l.answers) a)))) > 0)
      and not exists (select 1 from jsonb_array_elements(coalesce(q -> 'filters', '[]'::jsonb)) x
            where not private.lead_filter_ok(l, types ->> (x ->> 'field'), x))
  ), o as (
    select m.*, row_number() over (order by
      case when sdir = 'asc' then m.sn end asc nulls last, case when sdir = 'desc' then m.sn end desc nulls last,
      case when sdir = 'asc' then m.sb end asc nulls last, case when sdir = 'desc' then m.sb end desc nulls last,
      case when sdir = 'asc' then m.ss end asc nulls last, case when sdir = 'desc' then m.ss end desc nulls last,
      case when sdir = 'asc' then m.st end asc nulls last, case when sdir = 'desc' then m.st end desc nulls last,
      case when sdir = 'asc' then m.sx end asc nulls last, case when sdir = 'desc' then m.sx end desc nulls last,
      m.created_at desc, m.id desc) as ord
    from m
  )
  select (select count(*) from m),
    coalesce((select jsonb_agg(
      jsonb_build_object('id', p.id, 'created_at', p.created_at, 'name', p.name, 'email', p.email, 'phone', p.phone, 'status', p.status,
        'owner', p.owner_team_row, 'form', p.form, 'page', p.page_path, 'site', p.site_id)
      || coalesce((select jsonb_object_agg(a.key, a.value) from jsonb_each(p.answers) a where types ? a.key and a.key not in ('created_at', 'name', 'email', 'phone', 'status', 'owner', 'form', 'page')), '{}'::jsonb)
      order by p.ord) from o p where p.ord > (pg - 1) * size and p.ord <= pg * size), '[]'::jsonb)
    into total, rows;
  return jsonb_build_object('total', total, 'page', pg, 'size', size, 'columns', cols, 'fields', allf, 'rows', rows);
end $$;

-- ---------- 6. bulk ----------
-- p_action: 'status' (p_value a lead status), 'owner' (p_value a team row id, or null to unassign; owner or staff only),
-- 'delete' (owner or staff only; the hard delete, as privacy requires; refused unless p_confirm is true; one audit row per lead as
-- service.delete_lead writes; the consent ledger keeps its rows). At most 500 ids. All or nothing: an id the caller may not act on,
-- of another workspace or that does not exist refuses the whole call with S-NOT-FOUND and writes nothing.
-- status and owner: one event per lead whose value changed and one audit row for the call. Returns the number of leads changed or deleted.
create function service.leads_bulk(p_claims jsonb, p_workspace uuid, p_ids uuid[], p_action text, p_value text default null, p_confirm boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare me uuid; staff boolean; role public.member_role; ids uuid[]; l public.leads; n int := 0; st public.lead_status; own uuid; seen int;
begin
  me := service.use_claims(p_claims);
  staff := coalesce(private.is_staff(), false); role := private.my_role(p_workspace);
  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;
  select coalesce(array_agg(distinct x), '{}') into ids from unnest(coalesce(p_ids, '{}'::uuid[])) x where x is not null;
  if cardinality(ids) = 0 or cardinality(ids) > 500 then raise exception 'S-QUERY: send 1 to 500 lead ids'; end if;
  if coalesce(p_action, '') not in ('status', 'owner', 'delete') then raise exception 'S-QUERY: the action is status, owner or delete'; end if;
  if p_action in ('owner', 'delete') and not coalesce(staff or role = 'owner', false) then
    raise exception 'S-OWN-ONLY: only an owner can % leads', case when p_action = 'owner' then 'hand on' else 'delete' end; end if;
  if p_action = 'delete' and p_confirm is not true then raise exception 'S-CONFIRM: deleting leads needs the confirm step'; end if;
  if p_action = 'status' then
    if p_value is null or not (p_value = any (enum_range(null::public.lead_status)::text[])) then raise exception 'I-ANSWER status: Status must be one of the lead statuses'; end if;
    st := p_value::public.lead_status;
  elsif p_action = 'owner' and p_value is not null then
    if p_value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or not exists (select 1 from public.content_rows c where c.id = p_value::uuid and c.workspace_id = p_workspace and c.collection = 'team' and c.deleted_at is null)
      then raise exception 'S-NOT-FOUND: no such team member'; end if;
    own := p_value::uuid;
  end if;
  -- all or nothing: every id must be a lead of this workspace the caller can act on, locked before anything is written
  perform 1 from public.leads x where x.id = any (ids) for update;
  select count(*) into seen from public.leads x where x.id = any (ids) and x.workspace_id = p_workspace and private.can_act_on_lead(x);
  if seen <> cardinality(ids) then raise exception 'S-NOT-FOUND: not found'; end if;
  for l in select * from public.leads x where x.id = any (ids) order by x.id loop
    if p_action = 'status' and l.status is distinct from st then
      update public.leads set status = st where public.leads.id = l.id;
      insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (l.id, l.workspace_id, 'status', me, jsonb_build_object('from', l.status, 'to', st, 'bulk', true));
      n := n + 1;
    elsif p_action = 'owner' and l.owner_team_row is distinct from own then
      update public.leads set owner_team_row = own where public.leads.id = l.id;
      insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (l.id, l.workspace_id, 'assigned', me, jsonb_build_object('from', l.owner_team_row, 'to', own, 'bulk', true));
      n := n + 1;
    elsif p_action = 'delete' then
      insert into public.audit_log (workspace_id, actor, action, target, detail) values (l.workspace_id, me, 'lead-delete', l.id::text,
        jsonb_build_object('reason', 'bulk', 'email_hash', encode(sha256(convert_to(coalesce(l.email, ''), 'utf8')), 'hex')));
      delete from public.leads where public.leads.id = l.id;
      n := n + 1;
    end if;
  end loop;
  if p_action <> 'delete' then
    insert into public.audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'leads-bulk', p_workspace::text,
      jsonb_build_object('action', p_action, 'ids', cardinality(ids), 'changed', n));
  end if;
  return n;
end $$;

-- ---------- grants: closed to PUBLIC, anon and authenticated; the function role (and service_role) only ----------
revoke all on function private.lead_columns(uuid) from public, anon, authenticated;
revoke all on function private.typed_value(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.reference_ok(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function private.typed_answers(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function private.lead_value(public.leads, text) from public, anon, authenticated;
revoke all on function private.lead_filter_ok(public.leads, text, jsonb) from public, anon, authenticated;
revoke all on function service.capture_lead(uuid, text, text, text, text, text, jsonb, text, text, text, jsonb, uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function service.capture_lead(uuid, text, text, text, text, text, jsonb, text, text, text, jsonb, uuid, text, text, text, boolean) to service_role, omnikom_fn;
revoke all on function service.lead_set_fields(jsonb, uuid, jsonb) from public, anon, authenticated;
grant execute on function service.lead_set_fields(jsonb, uuid, jsonb) to service_role, omnikom_fn;
revoke all on function service.lead_list(jsonb, uuid, jsonb) from public, anon, authenticated;
grant execute on function service.lead_list(jsonb, uuid, jsonb) to service_role, omnikom_fn;
revoke all on function service.leads_bulk(jsonb, uuid, uuid[], text, text, boolean) from public, anon, authenticated;
grant execute on function service.leads_bulk(jsonb, uuid, uuid[], text, text, boolean) to service_role, omnikom_fn;
