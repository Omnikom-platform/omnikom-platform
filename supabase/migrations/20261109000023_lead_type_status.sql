-- Omnikom Platform: work order 20 (CRM A16: lead type and status as per-industry lists held as data, note authors), migration 23.
-- Additive to migrations 1 to 22, except that the lead_status enum is replaced by text (the conversion is below). Applied migrations are never edited.
--  1. The lists are DATA of the industry contract (contracts/README.md "crm"): site_contracts.resolved -> crm -> lead_types / statuses, each an ordered list of
--     { key, label } (statuses also stage and the flags needsDate, needsWho, needsText), validated by contracts/validate.mjs (C-CRM-*). A site whose contract has no
--     crm block has the platform floor only: lead type "enquiry", and the four statuses the product had before this migration (not-contacted, contacted, qualified,
--     closed; no flags), so every existing business keeps working and its old rows stay settable; "spam" is accepted everywhere (head's ruling A, 2026-11-10).
--     Nothing per industry is written in this file: private.crm_lists reads the active contract.
--  2. leads: status is text (the old enum maps new -> not-contacted, every other key is kept: contacted, qualified, closed, spam are keys of the new lists),
--     lead_type text not null default 'enquiry', status_date date, status_who uuid (a member of the workspace), status_text (up to 200).
--  3. private.lead_guard (BEFORE INSERT, and UPDATE of the five columns) is the one place that decides: the status and the lead type are checked against the site's
--     list on every write, from any caller; a status that needsDate refuses a missing date, one that needsWho takes the caller (a member) when no one is named and
--     refuses a person who is not a member, a status that does not need a value clears it. On INSERT the lead type is set from the form the lead came through:
--     the contract's forms.<form>.leadType (fixed) or leadTypeFrom { field, map } (the value of one answer picks the type); anything else is "enquiry"; a type the list
--     dropped since falls back to "enquiry" (a lead is never lost). A change that touches only other columns never trips it, so older rows stay editable.
--  4. service.lead_update takes the status as text and the status date, who and text; service.lead_set_fields takes status, lead_type, status_date, status_who,
--     status_text; service.leads_bulk and service.import_leads read the business's list (a bulk change or an import cannot set a status that needs a date).
--  5. service.lead_list returns lead_type, status_date, status_who, status_text on every row and the two lists in the answer; filters and sort take lead_type, status,
--     status_date (a status sorts by its place in the list). Saved views (migration 22) accept the new keys through private.lead_query_check.
--  6. Every note's timeline row carries its author in detail.author { kind: user | agent, name } next to the existing lead_events.by (the user id); the name is
--     written at the time (a team member's name, "Owner", "Team member", "Omnikom"), "Agent" when the verified claims say app_metadata.actor = 'agent'. Notes
--     written before this migration get the same author block from their by.
--  7. sites_domain_unique: two sites can never claim one domain, in any letter case (work order 35, E15).
--  8. A status change clears the date, person and line it carried: they belong to the status they were set for, so the caller sends them again (ruling G). The write
--     paths that know what was sent do the clearing (lead_update, lead_set_fields, leads_bulk: a value sent counts even when it equals the old one); the guard only validates.
--  9. A map may name the lead type (save_crm_template) and an import file may carry it (import_leads), a key or a label of the business's own list (ruling E).
-- 10. A bulk delete is service.delete_lead once per lead, so every delete path erases the same way (ruling J).
-- Tests: tenancy.test.sql T31 (walls) and run-local.mjs mutants "crm23: ...".

set lock_timeout = '5s';

-- ---------- 7. one domain, one site ----------
create unique index sites_domain_unique on public.sites (lower(domain)) where domain is not null;

-- ---------- 2. the columns ----------
alter table public.leads alter column status drop default;
alter table public.leads alter column status type text using (case status::text when 'new' then 'not-contacted' else status::text end);
alter table public.leads alter column status set default 'not-contacted';
alter table public.leads
  add constraint leads_status_key check (status ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(status) <= 40),
  add column lead_type text not null default 'enquiry' check (lead_type ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(lead_type) <= 40),
  add column status_date date,
  add column status_who uuid references auth.users(id) on delete set null,
  add column status_text text check (length(status_text) <= 200);
create index leads_status on public.leads (workspace_id, status);
create index leads_lead_type on public.leads (workspace_id, lead_type);

-- ---------- 1. the lists, read from the active contract ----------
create function private.crm_lists(p_ws uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'lead_types', case when jsonb_typeof(c.crm -> 'lead_types') = 'array' and jsonb_array_length(c.crm -> 'lead_types') > 0 then c.crm -> 'lead_types'
                       else '[{"key":"enquiry","label":"Enquiry"}]'::jsonb end,
    'statuses',   case when jsonb_typeof(c.crm -> 'statuses') = 'array' and jsonb_array_length(c.crm -> 'statuses') > 0 then c.crm -> 'statuses'
                       else '[{"key":"not-contacted","label":"Not contacted yet","stage":"new","needsDate":false,"needsWho":false,"needsText":false},
                              {"key":"contacted","label":"Contacted","stage":"working","needsDate":false,"needsWho":false,"needsText":false},
                              {"key":"qualified","label":"Qualified","stage":"working","needsDate":false,"needsWho":false,"needsText":false},
                              {"key":"closed","label":"Closed","stage":"outcome","needsDate":false,"needsWho":false,"needsText":false}]'::jsonb end)
  from (select (select sc.resolved -> 'crm' from public.site_contracts sc where sc.workspace_id = p_ws and sc.active limit 1) as crm) c $$;

-- a status by its key: the business's list, then the system status spam (it hides a lead and is not an acquisition outcome); null when there is none
create function private.status_def(p_ws uuid, p_key text) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select e from jsonb_array_elements(private.crm_lists(p_ws) -> 'statuses') e where e ->> 'key' = p_key limit 1),
    case when p_key = 'spam' then '{"key":"spam","label":"Spam","stage":"outcome","needsDate":false,"needsWho":false,"needsText":false,"system":true}'::jsonb end) $$;

-- a status as a person or a file writes it: its key or its label, any case, against a list read once (the import)
create function private.status_pick(p_statuses jsonb, p_value text) returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(
    (select e from jsonb_array_elements(p_statuses) e where lower(e ->> 'key') = lower(btrim(p_value)) or lower(e ->> 'label') = lower(btrim(p_value)) limit 1),
    case when lower(btrim(p_value)) = 'spam' then '{"key":"spam","label":"Spam","stage":"outcome","needsDate":false,"needsWho":false,"needsText":false,"system":true}'::jsonb end) $$;

create function private.lead_type_def(p_ws uuid, p_key text) returns jsonb language sql stable security definer set search_path = '' as $$
  select e from jsonb_array_elements(private.crm_lists(p_ws) -> 'lead_types') e where e ->> 'key' = p_key limit 1 $$;

-- ---------- 6. authors ----------
create function private.person_label(p_ws uuid, p_user uuid) returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select nullif(btrim(v.data ->> 'name'), '') from public.members m
       join lateral (select x.data from public.content_versions x where x.row_id = m.team_row_id order by x.n desc limit 1) v on true
       where m.workspace_id = p_ws and m.user_id = p_user),
    (select case m.role when 'owner' then 'Owner' else 'Team member' end from public.members m where m.workspace_id = p_ws and m.user_id = p_user),
    case when exists (select 1 from public.staff s where s.user_id = p_user) then 'Omnikom' end,
    'Team member') $$;

create function private.actor_kind(p_claims jsonb) returns text language sql immutable set search_path = '' as $$
  select case when p_claims -> 'app_metadata' ->> 'actor' = 'agent' then 'agent' else 'user' end $$;

update public.lead_events e set detail = e.detail || jsonb_build_object('author', jsonb_build_object('kind', 'user', 'name', private.person_label(e.workspace_id, e.by)))
  where e.kind = 'note' and e.by is not null and not (e.detail ? 'author');

-- ---------- 3. the guard ----------
create function private.lead_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare f jsonb; lf jsonb; v text; def jsonb; ins boolean := tg_op = 'INSERT';
begin
  if ins then
    select sc.resolved -> 'forms' -> new.form into f from public.site_contracts sc where sc.workspace_id = new.workspace_id and sc.active limit 1;
    if jsonb_typeof(f) = 'object' then   -- a form the contract declares says how its submission sets the type; any other writer (manual, import) keeps what it set
      if jsonb_typeof(f -> 'leadType') = 'string' then new.lead_type := f ->> 'leadType';
      elsif jsonb_typeof(f -> 'leadTypeFrom') = 'object' then
        lf := f -> 'leadTypeFrom';
        v := case when jsonb_typeof(new.answers -> (lf ->> 'field')) = 'string' then new.answers ->> (lf ->> 'field') end;
        new.lead_type := coalesce(lf -> 'map' ->> v, 'enquiry');
      else new.lead_type := 'enquiry'; end if;
      if private.lead_type_def(new.workspace_id, new.lead_type) is null then new.lead_type := 'enquiry'; end if;
    end if;
  end if;
  if (ins or new.lead_type is distinct from old.lead_type) and private.lead_type_def(new.workspace_id, new.lead_type) is null then
    raise exception 'I-ANSWER lead_type: Lead type must be one of this business''s lead types'; end if;
  if ins or new.status is distinct from old.status or new.status_date is distinct from old.status_date
     or new.status_who is distinct from old.status_who or new.status_text is distinct from old.status_text then
    def := private.status_def(new.workspace_id, new.status);
    if def is null then
      -- a status the list dropped since stays as it is while only its notes change; it is never set
      if ins or new.status is distinct from old.status then raise exception 'I-ANSWER status: Status must be one of this business''s statuses'; end if;
    else
      if coalesce((def ->> 'needsDate')::boolean, false) then
        if new.status_date is null then raise exception 'I-ANSWER status_date: % needs a date', def ->> 'label'; end if;
      else new.status_date := null; end if;
      if coalesce((def ->> 'needsWho')::boolean, false) then
        if new.status_who is null then   -- defaults to the caller when the caller is a member of this business
          select m.user_id into new.status_who from public.members m where m.workspace_id = new.workspace_id and m.user_id = (select auth.uid()); end if;
        if new.status_who is not null and not exists (select 1 from public.members m where m.workspace_id = new.workspace_id and m.user_id = new.status_who) then
          raise exception 'I-ANSWER status_who: Pick a member of this business'; end if;
      else new.status_who := null; end if;
      if coalesce((def ->> 'needsText')::boolean, false) then new.status_text := nullif(btrim(new.status_text), '');
      else new.status_text := null; end if;
    end if;
  end if;
  return new;
end $$;
create trigger leads_guard before insert or update of status, lead_type, status_date, status_who, status_text on public.leads for each row execute function private.lead_guard();

-- ---------- 4. the functions that change or read the columns ----------
create or replace function private.lead_value(l public.leads, p_key text) returns jsonb language sql immutable set search_path = '' as $$
  select case p_key when 'created_at' then to_jsonb(l.created_at) when 'name' then to_jsonb(l.name) when 'email' then to_jsonb(l.email)
    when 'phone' then to_jsonb(l.phone) when 'status' then to_jsonb(l.status::text) when 'owner' then to_jsonb(l.owner_team_row)
    when 'form' then to_jsonb(l.form) when 'page' then to_jsonb(l.page_path) when 'site' then to_jsonb(l.site_id::text)
    when 'lead_type' then to_jsonb(l.lead_type) when 'status_date' then to_jsonb(l.status_date::text) when 'status_who' then to_jsonb(l.status_who::text)
    when 'status_text' then to_jsonb(l.status_text) else l.answers -> p_key end $$;

create or replace function private.lead_query_check(p_workspace uuid, p_query jsonb) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare q jsonb := coalesce(p_query, '{}'::jsonb); cols jsonb; allf jsonb; types jsonb; f jsonb; search text; skey text; sdir text; stype text;
  size int; pg int;
begin
  if jsonb_typeof(q) <> 'object' then raise exception 'S-QUERY: the query must be an object'; end if;
  -- the keys a caller may name: the core list and the contract's industry columns, each with its type
  select coalesce(jsonb_agg(c.def || jsonb_build_object('key', c.key, 'label', coalesce(c.def ->> 'label', c.key)) order by c.ord), '[]'::jsonb)
    into allf from private.lead_columns(p_workspace) c;   -- every industry field, a column or not (the export writes them all)
  select coalesce(jsonb_agg(c.def || jsonb_build_object('key', c.key, 'label', coalesce(c.def ->> 'label', c.key)) order by c.ord), '[]'::jsonb),
         coalesce(jsonb_object_agg(c.key, c.def ->> 'type'), '{}'::jsonb)
    into cols, types from private.lead_columns(p_workspace) c where (c.def ->> 'column')::boolean;
  types := types || '{"created_at":"datetime","name":"text","email":"text","phone":"text","status":"enum","owner":"owner","form":"text","page":"text","site":"text","lead_type":"enum","status_date":"date","status_who":"text","status_text":"text"}'::jsonb;
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
  -- migration 22: the two flags
  if (q ? 'due' and jsonb_typeof(q -> 'due') <> 'boolean') or (q ? 'duplicates' and jsonb_typeof(q -> 'duplicates') <> 'boolean') then
    raise exception 'S-QUERY: due and duplicates are true or false'; end if;
  return jsonb_build_object('types', types, 'cols', cols, 'allf', allf, 'search', search, 'skey', skey, 'sdir', sdir, 'stype', stype, 'size', size, 'pg', pg);
end $$;

create or replace function service.lead_list(p_claims jsonb, p_workspace uuid, p_query jsonb default '{}') returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid; staff boolean; role public.member_role; mine uuid; see_all boolean;
  q jsonb := coalesce(p_query, '{}'::jsonb); chk jsonb; cols jsonb; allf jsonb; types jsonb; search text; skey text; sdir text; stype text;
  size int; pg int; total bigint; rows jsonb; due boolean; dups boolean; lists jsonb; srank jsonb;
begin
  me := service.use_claims(p_claims);
  staff := coalesce(private.is_staff(), false); role := private.my_role(p_workspace); mine := private.my_team_row(p_workspace);
  if not staff and role is null then   -- not a member of this workspace: the leads_read policy shows nothing, and so does this
    return jsonb_build_object('total', 0, 'page', 1, 'size', 0, 'columns', '[]'::jsonb, 'fields', '[]'::jsonb, 'rows', '[]'::jsonb); end if;
  see_all := staff or role = 'owner';
  chk := private.lead_query_check(p_workspace, q);   -- one function checks the query, here and when a view is saved
  cols := chk -> 'cols'; allf := chk -> 'allf'; types := chk -> 'types'; search := chk ->> 'search'; skey := chk ->> 'skey'; sdir := chk ->> 'sdir';
  stype := chk ->> 'stype'; size := (chk ->> 'size')::int; pg := (chk ->> 'pg')::int;
  due := coalesce((q ->> 'due')::boolean, false); dups := coalesce((q ->> 'duplicates')::boolean, false);
  -- migration 23: the business's own lists (the contract's crm block); a status sorts by its place in the list, not by its letters
  lists := private.crm_lists(p_workspace);
  select coalesce(jsonb_object_agg(x.s ->> 'key', x.ord), '{}'::jsonb) into srank from jsonb_array_elements(lists -> 'statuses') with ordinality x(s, ord);

  -- each sort key typed once (sn number, sb boolean, ss status, st created_at, sx text); the page and the answer use the same row number
  with m as (
    select l.*, x.sv,
      case when stype = 'number' and jsonb_typeof(x.sv) = 'number' then (x.sv #>> '{}')::numeric end as sn,
      case when stype = 'boolean' and jsonb_typeof(x.sv) = 'boolean' then (x.sv #>> '{}')::boolean end as sb,
      case when skey = 'status' then coalesce((srank ->> l.status)::int, 1000) end as ss,
      case when skey = 'created_at' then l.created_at end as st,
      case when stype not in ('number', 'boolean') and skey not in ('status', 'created_at') then nullif(lower(x.sv #>> '{}'), '') end as sx,
      -- the other lead of a duplicate, only for a caller who may read that lead too
      case when l.duplicate_of is null then null
           when see_all or exists (select 1 from public.leads d where d.id = l.duplicate_of and mine is not null and d.owner_team_row = mine) then l.duplicate_of end as dv
    from public.leads l cross join lateral (select private.lead_value(l, skey) as sv) x
    where l.workspace_id = p_workspace
      and (see_all or (role = 'member' and l.owner_team_row = mine))      -- the leads_read policy's rule, row by row
      and (not due or l.follow_up_at <= now()
           or exists (select 1 from public.lead_tasks t where t.lead_id = l.id and t.done_at is null and t.due_at <= now()))
      and (not dups or l.duplicate_of is not null)
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
      jsonb_build_object('id', p.id, 'created_at', p.created_at, 'name', p.name, 'email', p.email, 'phone', p.phone, 'status', p.status, 'lead_type', p.lead_type, 'status_date', p.status_date, 'status_who', p.status_who, 'status_text', p.status_text,
        'owner', p.owner_team_row, 'form', p.form, 'page', p.page_path, 'site', p.site_id,
        'follow_up', p.follow_up_at, 'duplicate', p.duplicate_of is not null, 'duplicate_of', p.dv)
      || coalesce((select jsonb_object_agg(a.key, a.value) from jsonb_each(p.answers) a where types ? a.key and a.key not in ('follow_up', 'duplicate', 'duplicate_of', 'lead_type', 'status_date', 'status_who', 'status_text', 'created_at', 'name', 'email', 'phone', 'status', 'owner', 'form', 'page', 'site')), '{}'::jsonb)
      order by p.ord) from o p where p.ord > (pg - 1) * size and p.ord <= pg * size), '[]'::jsonb)
    into total, rows;
  return jsonb_build_object('total', total, 'page', pg, 'size', size, 'columns', cols, 'fields', allf, 'rows', rows, 'lead_types', lists -> 'lead_types', 'statuses', lists -> 'statuses');
end $$;

create or replace function service.lead_set_fields(p_claims jsonb, p_lead uuid, p_fields jsonb) returns int language plpgsql security definer set search_path = '' as $$
declare me uuid; l public.leads; staff boolean; role public.member_role; k text; v jsonb; d jsonb; old jsonb; nv jsonb;
  ans jsonb; changed text[] := '{}'; ev jsonb := '[]'::jsonb; e jsonb;
  n_name text; n_email text; n_phone text; n_status text; n_owner uuid; n_type text; n_sdate date; n_swho uuid; n_stext text;
begin
  me := service.use_claims(p_claims);
  select * into l from public.leads where public.leads.id = p_lead for update;
  if not found or not private.can_act_on_lead(l) then raise exception 'S-NOT-FOUND: not found'; end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or (select count(*) from jsonb_object_keys(p_fields)) > 50 then
    raise exception 'I-ANSWER fields: send at most 50 fields as an object'; end if;
  staff := private.is_staff(); role := private.my_role(l.workspace_id);
  ans := l.answers; n_name := l.name; n_email := l.email; n_phone := l.phone; n_status := l.status; n_owner := l.owner_team_row; n_type := l.lead_type; n_sdate := l.status_date; n_swho := l.status_who; n_stext := l.status_text;
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
      if jsonb_typeof(v) <> 'string' or private.status_def(l.workspace_id, btrim(v #>> '{}')) is null then
        raise exception 'I-ANSWER status: Status must be one of this business''s statuses'; end if;
      nv := to_jsonb(btrim(v #>> '{}')); old := to_jsonb(l.status); n_status := btrim(v #>> '{}');
    elsif k = 'lead_type' then
      if jsonb_typeof(v) <> 'string' or private.lead_type_def(l.workspace_id, btrim(v #>> '{}')) is null then
        raise exception 'I-ANSWER lead_type: Lead type must be one of this business''s lead types'; end if;
      nv := to_jsonb(btrim(v #>> '{}')); old := to_jsonb(l.lead_type); n_type := btrim(v #>> '{}');
    elsif k = 'status_date' then
      nv := private.typed_value('status_date', '{"type":"date","label":"Date"}', v); old := to_jsonb(l.status_date::text); n_sdate := (nv #>> '{}')::date;
    elsif k = 'status_who' then
      if v is not null and v <> 'null'::jsonb then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'I-ANSWER status_who: Pick a member of this business'; end if;
        nv := v; n_swho := (v #>> '{}')::uuid;
      else nv := null; n_swho := null; end if;
      old := to_jsonb(l.status_who);
    elsif k = 'status_text' then
      nv := private.typed_value('status_text', '{"type":"text","max":200,"label":"Status note"}', v); old := to_jsonb(l.status_text); n_stext := nv #>> '{}';
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
  if n_status is distinct from l.status then   -- ruling G: a new status starts clean; a date, person or line the caller sent in this call is kept (even equal to the old value), the others are cleared
    if not p_fields ? 'status_date' then n_sdate := null; end if;
    if not p_fields ? 'status_who' then n_swho := null; end if;
    if not p_fields ? 'status_text' then n_stext := null; end if;
  end if;
  if cardinality(changed) > 0 then
    update public.leads set name = n_name, email = n_email, phone = n_phone, status = n_status, owner_team_row = n_owner, answers = ans,
      lead_type = n_type, status_date = n_sdate, status_who = n_swho, status_text = n_stext
      where public.leads.id = p_lead;
    for e in select x from jsonb_array_elements(ev) x loop
      insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'edited', me, e);
    end loop;
  end if;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (l.workspace_id, me, 'lead-edit', p_lead::text, jsonb_build_object('fields', to_jsonb(changed)));
  return cardinality(changed);
end $$;

create or replace function service.leads_bulk(p_claims jsonb, p_workspace uuid, p_ids uuid[], p_action text, p_value text default null, p_confirm boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare me uuid; staff boolean; role public.member_role; ids uuid[]; l public.leads; n int := 0; st text; own uuid; seen int;
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
    if p_value is null or private.status_def(p_workspace, btrim(p_value)) is null then raise exception 'I-ANSWER status: Status must be one of this business''s statuses'; end if;
    st := btrim(p_value);
    -- a status that needs a date takes it one lead at a time (the screen asks), never as a bulk change
    if coalesce((private.status_def(p_workspace, st) ->> 'needsDate')::boolean, false) then
      raise exception 'I-ANSWER status: % needs a date; set it on one lead at a time', private.status_def(p_workspace, st) ->> 'label'; end if;
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
      update public.leads set status = st, status_who = null, status_text = null where public.leads.id = l.id;   -- ruling G: nothing is sent in bulk, so no person or line is carried (a date cannot be: bulk refuses a status that needs one, and the guard clears it on any other)
      insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (l.id, l.workspace_id, 'status', me, jsonb_build_object('from', l.status, 'to', st, 'bulk', true));
      n := n + 1;
    elsif p_action = 'owner' and l.owner_team_row is distinct from own then
      update public.leads set owner_team_row = own where public.leads.id = l.id;
      insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (l.id, l.workspace_id, 'assigned', me, jsonb_build_object('from', l.owner_team_row, 'to', own, 'bulk', true));
      n := n + 1;
    elsif p_action = 'delete' then
      -- ruling J (head, 2026-11-10): every delete path erases the same way, so a bulk delete is service.delete_lead once per lead (its audit row, one per lead; the later
      -- privacy scrub of the person's copies lives there); the owner-or-staff check above and the lock taken on the whole set still stand
      perform service.delete_lead(p_claims, l.id, 'bulk');
      n := n + 1;
    end if;
  end loop;
  if p_action <> 'delete' then
    insert into public.audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'leads-bulk', p_workspace::text,
      jsonb_build_object('action', p_action, 'ids', cardinality(ids), 'changed', n));
  end if;
  return n;
end $$;

-- ruling E (head, 2026-11-10): a map may name the lead type (a column of an import file); save_crm_template is migration 15's, with lead_type added to the fields it accepts
create or replace function service.save_crm_template(p_claims jsonb, p_workspace uuid, p_id uuid, p_name text, p_crm text, p_direction text, p_columns jsonb, p_value_maps jsonb default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid; tid uuid; bad int; missing text;
begin
  me := service.use_claims(p_claims);
  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  if jsonb_typeof(p_columns) <> 'array' then raise exception 'T-COLUMNS: columns must be a list'; end if;
  select count(*) into bad from jsonb_array_elements(p_columns) c where c ->> 'header' is null or c ->> 'field' is null;
  if bad > 0 then raise exception 'T-COLUMNS: every column needs a header and a field'; end if;
  if (select count(distinct c ->> 'header') from jsonb_array_elements(p_columns) c) <> jsonb_array_length(p_columns) then raise exception 'T-COLUMNS: two columns have the same header'; end if;
  -- a field is one of the lead's own fields, the owner (a team member) or answers.<key>; headers are non-empty text; value maps are an object of objects, bounded
  select count(*) into bad from jsonb_array_elements(p_columns) c
    where jsonb_typeof(c -> 'header') <> 'string' or length(c ->> 'header') not between 1 and 120
       or jsonb_typeof(c -> 'field') <> 'string'
       or (c ->> 'field') !~ '^(name|email|phone|form|page_path|flow|cta|status|lead_type|created_at|owner|answers\.[a-z][a-zA-Z0-9_]{0,60})$'
       or (c ? 'transform' and (jsonb_typeof(c -> 'transform') <> 'string' or (c ->> 'transform') !~ '^[a-z][a-z0-9-]{0,30}$'));
  if bad > 0 then raise exception 'T-COLUMNS: a column has a bad header, field or transform'; end if;
  -- migration 15: every industry field the map names is a field of this business's forms (private.lead_columns); the key is safe to name (the pattern above)
  select min(substr(c ->> 'field', 9)) into missing from jsonb_array_elements(p_columns) c
    where (c ->> 'field') like 'answers.%' and not exists (select 1 from private.lead_columns(p_workspace) x where x.key = substr(c ->> 'field', 9));
  if missing is not null then raise exception 'T-FIELD %: the map names a field this business''s forms do not have', missing; end if;
  if jsonb_typeof(coalesce(p_value_maps, '{}')) <> 'object' or pg_column_size(coalesce(p_value_maps, '{}')) > 65536
     or exists (select 1 from jsonb_each(coalesce(p_value_maps, '{}')) v where jsonb_typeof(v.value) <> 'object')
    then raise exception 'T-VALUE-MAPS: value maps must be an object of objects under 64 KB'; end if;
  if p_id is null then
    -- one map per workspace and name: saving a name that exists again is a new version of that same row
    insert into public.crm_templates (workspace_id, name, crm, direction, columns, value_maps, created_by) values (p_workspace, p_name, p_crm, p_direction, p_columns, coalesce(p_value_maps, '{}'), me)
      on conflict (workspace_id, name) do update set crm = excluded.crm, direction = excluded.direction, columns = excluded.columns, value_maps = excluded.value_maps, updated_at = now()
      returning id into tid;
  else
    if exists (select 1 from public.crm_templates t where t.workspace_id = p_workspace and t.name = p_name and t.id <> p_id) then
      raise exception 'T-NAME: another map of this business has that name'; end if;
    update public.crm_templates set name = p_name, crm = p_crm, direction = p_direction, columns = p_columns, value_maps = coalesce(p_value_maps, '{}'), updated_at = now()
      where id = p_id and workspace_id = p_workspace returning id into tid;
    if tid is null then raise exception 'S-NOT-FOUND: not found'; end if;
  end if;
  insert into public.audit_log (workspace_id, actor, action, target) values (p_workspace, me, 'crm-template', tid::text);
  return tid;
end $$;

create or replace function service.import_leads(p_claims jsonb, p_workspace uuid, p_template uuid, p_rows jsonb, p_opts jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid; staff boolean; role public.member_role; o jsonb := coalesce(p_opts, '{}'::jsonb); dry boolean; dup text; fname text; sha text;
  tpl public.crm_templates; cols jsonb; missing text; site uuid; mine uuid; team jsonb; have_e jsonb; have_p jsonb; seen_e jsonb := '{}'::jsonb; seen_p jsonb := '{}'::jsonb;
  r jsonb; line int; m text; fld text; n_name text; n_email text; n_phone text; n_status text; n_owner uuid; stl jsonb; ltl jsonb; n_type text; pick jsonb; n_answers jsonb;
  ekey text; pkey text; dupe text; dwith text; consent text; lid uuid;
  total int; valid int := 0; fresh int := 0; n_refused int := 0; n_dupes int := 0; created int := 0; skipped int := 0;
  refused jsonb := '[]'::jsonb; duplicates jsonb := '[]'::jsonb; warnings jsonb := '[]'::jsonb; sample jsonb := '[]'::jsonb;
begin
  me := service.use_claims(p_claims);
  staff := coalesce(private.is_staff(), false); role := private.my_role(p_workspace);
  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;
  if not coalesce(staff or role = 'owner', false) then raise exception 'S-OWN-ONLY: only an owner can import leads'; end if;
  select * into tpl from public.crm_templates t where t.id = p_template and t.workspace_id = p_workspace;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 5000 then raise exception 'I-ROWS: an import takes 1 to 5000 rows'; end if;
  if jsonb_typeof(o) <> 'object' then raise exception 'I-ROWS: the options must be an object'; end if;
  total := jsonb_array_length(p_rows);
  dry := (o -> 'dry_run') is distinct from 'false'::jsonb;   -- a dry run unless the caller says exactly false
  if not dry then
    if (o -> 'consent') is distinct from 'true'::jsonb then raise exception 'I-CONSENT: tick "These people agreed to be contacted by my business" to import'; end if;
    dup := o ->> 'duplicates';
    if dup is null or dup not in ('skip', 'add') then raise exception 'I-DUPLICATES: choose skip or add for the duplicates'; end if;
    fname := btrim(regexp_replace(coalesce(o ->> 'file_name', ''), '[[:cntrl:]"]', '', 'g'));
    sha := o ->> 'file_sha256';
    if length(fname) not between 1 and 200 or sha is null or sha !~ '^[0-9a-f]{64}$' then raise exception 'I-ROWS: a real import needs the file''s name and its sha256'; end if;
    consent := format('These people agreed to be contacted by my business. Ticked by the owner on %s for the import of the file "%s".',
      to_char(now() at time zone 'utc', 'YYYY-MM-DD'), fname);
  end if;
  -- the map's industry fields must still be on this business's forms (the contract may have changed since the map was saved)
  cols := private.lead_column_defs(p_workspace);
  select min(substr(c ->> 'field', 9)) into missing from jsonb_array_elements(tpl.columns) c where (c ->> 'field') like 'answers.%' and not (cols ? substr(c ->> 'field', 9));
  if missing is not null then raise exception 'T-FIELD %: the map names a field this business''s forms no longer have; save the map again', missing; end if;
  select s.id into site from public.sites s where s.workspace_id = p_workspace order by s.created_at, s.id limit 1;
  stl := private.crm_lists(p_workspace) -> 'statuses';   -- read once, not once per row
  ltl := private.crm_lists(p_workspace) -> 'lead_types';
  mine := private.my_team_row(p_workspace);
  -- looked up once: the team by name, email and slug (latest version), and the keys of the workspace's leads
  select coalesce(jsonb_object_agg(z.k, z.id), '{}'::jsonb) into team from (
    select distinct on (k.k) k.k, c.id from public.content_rows c
      join lateral (select x.data from public.content_versions x where x.row_id = c.id order by x.n desc limit 1) v on true
      cross join lateral unnest(array[lower(btrim(v.data ->> 'name')), lower(btrim(v.data ->> 'email')), lower(btrim(v.data ->> 'slug'))]) k(k)
    where c.workspace_id = p_workspace and c.collection = 'team' and c.deleted_at is null and coalesce(k.k, '') <> '' order by k.k, c.id) z;
  select coalesce(jsonb_object_agg(z.k, true), '{}'::jsonb) into have_e from (select distinct lower(btrim(l.email)) as k from public.leads l
    where l.workspace_id = p_workspace and coalesce(btrim(l.email), '') <> '') z;
  select coalesce(jsonb_object_agg(z.k, true), '{}'::jsonb) into have_p from (select distinct private.phone_key(l.phone) as k from public.leads l
    where l.workspace_id = p_workspace and private.phone_key(l.phone) is not null) z;

  for r, line in select x.v, case when jsonb_typeof(x.v -> 'line') = 'number' then (x.v ->> 'line')::numeric::int else x.n::int + 1 end
      from jsonb_array_elements(p_rows) with ordinality x(v, n) loop
    begin
      if jsonb_typeof(r) <> 'object' then raise exception 'I-ANSWER row: a row must be an object'; end if;
      n_name := private.typed_value('name', '{"type":"text","max":120,"label":"Name"}', r -> 'name') #>> '{}';
      n_email := private.typed_value('email', '{"type":"email","label":"Email"}', r -> 'email') #>> '{}';
      n_phone := private.typed_value('phone', '{"type":"phone","label":"Phone"}', r -> 'phone') #>> '{}';
      if n_name is null and n_email is null and n_phone is null then raise exception 'I-ANSWER name: a lead needs a name, an email or a phone'; end if;
      if coalesce(btrim(r ->> 'status'), '') = '' then n_status := 'not-contacted';
      else
        -- migration 23: the status is one of this business's own (its key or its label, any case); one that needs a date cannot come from a file
        pick := private.status_pick(stl, r ->> 'status');
        if pick is null then raise exception 'I-ANSWER status: Status must be one of this business''s statuses'; end if;
        if coalesce((pick ->> 'needsDate')::boolean, false) then
          raise exception 'I-ANSWER status: % needs a date, so a file cannot set it; import the lead as Not contacted yet and set it in the CRM', pick ->> 'label'; end if;
        n_status := pick ->> 'key';
      end if;
      -- ruling E: the lead type is one of this business's own (its key or its label, any case); empty is enquiry
      if coalesce(btrim(r ->> 'lead_type'), '') = '' then n_type := 'enquiry';
      else
        select e ->> 'key' into n_type from jsonb_array_elements(ltl) e where lower(e ->> 'key') = lower(btrim(r ->> 'lead_type')) or lower(e ->> 'label') = lower(btrim(r ->> 'lead_type')) limit 1;
        if n_type is null then raise exception 'I-ANSWER lead_type: Lead type must be one of this business''s lead types'; end if;
      end if;
      n_answers := private.typed_lead_answers(p_workspace, cols, r -> 'answers', true);
    exception when others then
      m := sqlerrm;
      if m !~ '^I-(ANSWER|UNKNOWN)' then raise; end if;   -- only a row's own problem is reported; anything else stops the call
      fld := coalesce(substring(m from '^I-ANSWER ([A-Za-z][A-Za-z0-9_]{0,60}):'), substring(m from '^I-UNKNOWN: "([A-Za-z0-9_]{1,40})"'), 'row');
      m := case when m ~ '^I-ANSWER' then regexp_replace(m, '^I-ANSWER [^:]*: ', '') else 'this business has no such field' end;
      if not dry then raise exception 'I-IMPORT line % %: %', line, fld, m; end if;   -- all or nothing: one refused row refuses the import
      n_refused := n_refused + 1;
      if jsonb_array_length(refused) < 100 then refused := refused || jsonb_build_array(jsonb_build_object('line', line, 'field', fld, 'reason', m)); end if;
      continue;
    end;
    valid := valid + 1;
    n_owner := mine;
    if coalesce(btrim(r ->> 'owner'), '') <> '' then
      if team ? lower(btrim(r ->> 'owner')) then n_owner := (team ->> lower(btrim(r ->> 'owner')))::uuid;
      elsif jsonb_array_length(warnings) < 100 then
        warnings := warnings || jsonb_build_array(jsonb_build_object('line', line, 'field', 'owner', 'reason', 'not a team member of this business; the lead goes to you'));
      end if;
    end if;
    ekey := lower(btrim(n_email)); pkey := private.phone_key(n_phone); dupe := null; dwith := null;
    if ekey is not null and have_e ? ekey then dupe := 'email'; dwith := 'a lead you already have';
    elsif pkey is not null and have_p ? pkey then dupe := 'phone'; dwith := 'a lead you already have';
    elsif ekey is not null and seen_e ? ekey then dupe := 'email'; dwith := 'line ' || (seen_e ->> ekey);
    elsif pkey is not null and seen_p ? pkey then dupe := 'phone'; dwith := 'line ' || (seen_p ->> pkey);
    end if;
    if ekey is not null and not (seen_e ? ekey) then seen_e := seen_e || jsonb_build_object(ekey, line); end if;
    if pkey is not null and not (seen_p ? pkey) then seen_p := seen_p || jsonb_build_object(pkey, line); end if;
    if dupe is not null then
      n_dupes := n_dupes + 1;
      if jsonb_array_length(duplicates) < 100 then duplicates := duplicates || jsonb_build_array(jsonb_build_object('line', line, 'by', dupe, 'with', dwith)); end if;
    else fresh := fresh + 1;
    end if;
    if dry then
      if jsonb_array_length(sample) < 20 then
        sample := sample || jsonb_build_array(jsonb_build_object('line', line, 'name', n_name, 'email', n_email, 'phone', n_phone, 'status', n_status, 'lead_type', n_type,
          'owner', n_owner, 'answers', n_answers, 'duplicate', dupe is not null)); end if;
    elsif dupe is not null and dup = 'skip' then
      skipped := skipped + 1;
    else
      insert into public.leads (workspace_id, site_id, form, page_path, name, email, phone, answers, consent_text, status, lead_type, owner_team_row, marketing_consent, sms_consent)
        values (p_workspace, site, 'import', 'import', n_name, n_email, n_phone, n_answers, consent, n_status, n_type, n_owner, '{"given":false}'::jsonb, false)
        returning public.leads.id into lid;
      insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (lid, p_workspace, 'received', me, jsonb_build_object('import', true, 'form', 'import'));
      perform private.record_consent(p_workspace, site, lid, 'import', 'import', consent, false, '{"given":false}'::jsonb, null, null, me);
      created := created + 1;
    end if;
  end loop;

  if dry then
    return jsonb_build_object('dry_run', true, 'rows', total, 'valid', valid, 'new', fresh, 'refused_count', n_refused, 'refused', refused,
      'duplicates_count', n_dupes, 'duplicates', duplicates, 'warnings', warnings, 'sample', sample);
  end if;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'lead-import', p_template::text,
    jsonb_build_object('file_sha256', sha, 'rows', total, 'created', created, 'skipped', skipped, 'duplicates', n_dupes));
  return jsonb_build_object('dry_run', false, 'rows', total, 'created', created, 'skipped', skipped);
end $$;

-- service.lead_update: the status is text, with its date, person and line. A note carries its author. (The old signature used the enum, which goes below.)
drop function service.lead_update(jsonb, uuid, public.lead_status, uuid, text, boolean);
create function service.lead_update(p_claims jsonb, p_lead uuid, p_status text default null, p_owner uuid default null, p_note text default null, p_unassign boolean default false,
  p_status_date date default null, p_status_who uuid default null, p_status_text text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid; l public.leads; r public.leads; role public.member_role; staff boolean; mine uuid; ns text; nd date; nw uuid; nt text; actor text;
begin
  me := service.use_claims(p_claims);
  select * into l from public.leads where id = p_lead for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  staff := private.is_staff(); role := private.my_role(l.workspace_id); mine := private.my_team_row(l.workspace_id);
  if not coalesce(staff or role = 'owner' or (role = 'member' and l.owner_team_row = mine), false) then raise exception 'S-NOT-FOUND: not found'; end if;
  actor := private.actor_kind(p_claims);
  if p_status is not null or p_status_date is not null or p_status_who is not null or p_status_text is not null then
    ns := coalesce(btrim(p_status), l.status);
    if private.status_def(l.workspace_id, ns) is null then raise exception 'I-ANSWER status: Status must be one of this business''s statuses'; end if;
    if ns is distinct from l.status then   -- ruling G: a new status starts clean; what the caller sent now is kept (even equal to the old value), what was not sent is cleared
      nd := p_status_date; nw := p_status_who; nt := nullif(btrim(p_status_text), '');
    else nd := coalesce(p_status_date, l.status_date); nw := coalesce(p_status_who, l.status_who); nt := coalesce(nullif(btrim(p_status_text), ''), l.status_text); end if;
    if ns is distinct from l.status or nd is distinct from l.status_date or nw is distinct from l.status_who or nt is distinct from l.status_text then
      update public.leads set status = ns, status_date = nd, status_who = nw, status_text = nt where id = p_lead;   -- private.lead_guard has the last word
      select * into r from public.leads where id = p_lead;
      insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'status', me,
        jsonb_build_object('from', l.status, 'to', r.status, 'date', r.status_date, 'who', r.status_who, 'who_name', case when r.status_who is not null then private.person_label(l.workspace_id, r.status_who) end,
          'text', r.status_text, 'author', jsonb_build_object('kind', actor, 'name', case when actor = 'agent' then 'Agent' else private.person_label(l.workspace_id, me) end)));
    end if;
  end if;
  if p_owner is not null and p_owner is distinct from l.owner_team_row then
    if not staff and role = 'member' then raise exception 'S-OWN-ONLY: members cannot hand a lead to someone else'; end if;
    if not exists (select 1 from public.content_rows c where c.id = p_owner and c.workspace_id = l.workspace_id and c.collection = 'team' and c.deleted_at is null)
      then raise exception 'S-NOT-FOUND: no such team member'; end if;
    update public.leads set owner_team_row = p_owner where id = p_lead;
    insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'assigned', me, jsonb_build_object('from', l.owner_team_row, 'to', p_owner));
  end if;
  if p_unassign and l.owner_team_row is not null then
    if not staff and role = 'member' then raise exception 'S-OWN-ONLY: members cannot hand a lead to someone else'; end if;
    update public.leads set owner_team_row = null where id = p_lead;
    insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'assigned', me, jsonb_build_object('from', l.owner_team_row, 'to', null));
  end if;
  if coalesce(p_note, '') <> '' then
    if length(p_note) > 2000 then raise exception 'S-NOTE: a note is at most 2000 characters'; end if;
    insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'note', me,
      jsonb_build_object('text', p_note, 'author', jsonb_build_object('kind', actor, 'name', case when actor = 'agent' then 'Agent' else private.person_label(l.workspace_id, me) end)));
  end if;
  insert into public.audit_log (workspace_id, actor, action, target) values (l.workspace_id, me, 'lead-update', p_lead::text);
end $$;

-- the enum has no user left (the column, lead_update's signature, and the three functions above that named it)
drop type public.lead_status;

-- ---------- grants: closed to PUBLIC, anon and authenticated; the service functions open to the function role ----------
revoke all on function private.crm_lists(uuid) from public, anon, authenticated;
revoke all on function private.status_def(uuid, text) from public, anon, authenticated;
revoke all on function private.status_pick(jsonb, text) from public, anon, authenticated;
revoke all on function private.lead_type_def(uuid, text) from public, anon, authenticated;
revoke all on function private.person_label(uuid, uuid) from public, anon, authenticated;
revoke all on function private.actor_kind(jsonb) from public, anon, authenticated;
revoke all on function private.lead_guard() from public, anon, authenticated;
revoke all on function private.lead_value(public.leads, text) from public, anon, authenticated;
revoke all on function private.lead_query_check(uuid, jsonb) from public, anon, authenticated;
revoke all on function service.lead_list(jsonb, uuid, jsonb) from public, anon, authenticated;
grant execute on function service.lead_list(jsonb, uuid, jsonb) to service_role, omnikom_fn;
revoke all on function service.lead_set_fields(jsonb, uuid, jsonb) from public, anon, authenticated;
grant execute on function service.lead_set_fields(jsonb, uuid, jsonb) to service_role, omnikom_fn;
revoke all on function service.leads_bulk(jsonb, uuid, uuid[], text, text, boolean) from public, anon, authenticated;
grant execute on function service.leads_bulk(jsonb, uuid, uuid[], text, text, boolean) to service_role, omnikom_fn;
revoke all on function service.import_leads(jsonb, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function service.import_leads(jsonb, uuid, uuid, jsonb, jsonb) to service_role, omnikom_fn;
revoke all on function service.lead_update(jsonb, uuid, text, uuid, text, boolean, date, uuid, text) from public, anon, authenticated;
grant execute on function service.lead_update(jsonb, uuid, text, uuid, text, boolean, date, uuid, text) to service_role, omnikom_fn;
revoke all on function service.save_crm_template(jsonb, uuid, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function service.save_crm_template(jsonb, uuid, uuid, text, text, text, jsonb, jsonb) to service_role, omnikom_fn;
