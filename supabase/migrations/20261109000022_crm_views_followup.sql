-- Omnikom Platform: work order 18 (CRM block 3b backend), migration 22. Additive to migrations 1 to 20 (create or replace of service.lead_list only).
-- Saved views and columns (A13, A14), follow-up date and tasks (A17), the duplicate flag (A18). The screens are work order 19.
--  1. lead_event_kind gains 'follow-up' (detail {old, new}) and 'task' (detail {action: added | done | reopened, task, text, due?}).
--  2. leads.follow_up_at (set through service.lead_follow_up) and leads.duplicate_of (set by a trigger on every insert: capture, add-lead, import).
--     The duplicate rule is the import's own (migration 15): the email lower-cased, or the phone as private.phone_key (E.164). The lead points at the
--     OLDEST earlier lead of its workspace with either (created_at, then a lead that is itself not flagged, then id: leads of one import share a
--     created_at). Nothing is merged or refused. Existing leads are not flagged (the rule runs when a lead is created).
--  3. crm_views: a view is a stored lead_list query plus an ordered column list. Read: a member reads their own and the workspace's shared views (user_id
--     null); every write goes through service.view_save / service.view_delete. The query is checked by private.lead_query_check, the function
--     service.lead_list itself checks with (migration 14's checks, moved into one function), so a saved view can never hold a query lead_list refuses.
--  4. lead_tasks: visible exactly where its lead is (the leads_read rule, evaluated by the subquery); service.task_add / service.task_done write them
--     and the timeline event in the same transaction.
--  5. service.lead_list: the answer gains follow_up, duplicate (true when flagged) and duplicate_of (the other lead's id only when the caller can read
--     that lead too, else null: a member sees "a duplicate" and nothing of the other lead); the query gains two booleans, `due` (follow_up_at or an open
--     task's due_at is at or before now) and `duplicates` (flagged leads only). The body is migration 18's with the checks moved out and these added.
-- Every new function: security definer, search_path = '', closed to PUBLIC, anon and authenticated, open to the function role.
-- Tests: tenancy.test.sql T29 (walls) and run-local.mjs mutants "crm22: ...".

alter type public.lead_event_kind add value if not exists 'follow-up';
alter type public.lead_event_kind add value if not exists 'task';

-- ---------- 2. follow-up and the duplicate flag ----------
alter table public.leads
  add column follow_up_at timestamptz,
  add column duplicate_of uuid references public.leads(id) on delete set null;
create index leads_dup_email on public.leads (workspace_id, (lower(btrim(email))));
create index leads_dup_phone on public.leads (workspace_id, (private.phone_key(phone)));
-- An index expression is evaluated as the role that writes the row: service_role writes leads directly (the other writers are definer functions that run as the owner,
-- and no login or the function role has a write grant), so it needs EXECUTE on the one private function the index calls. It is a pure function of its text.
grant execute on function private.phone_key(text) to service_role;
create index leads_follow_up on public.leads (workspace_id, follow_up_at) where follow_up_at is not null;
create index leads_duplicate_of on public.leads (duplicate_of) where duplicate_of is not null;

create function private.lead_duplicate_of(p_ws uuid, p_email text, p_phone text) returns uuid language sql stable security definer set search_path = '' as $$
  select l.id from public.leads l
  where l.workspace_id = p_ws
    and ((coalesce(btrim(p_email), '') <> '' and lower(btrim(l.email)) = lower(btrim(p_email)))
      or (private.phone_key(p_phone) is not null and private.phone_key(l.phone) = private.phone_key(p_phone)))
  order by l.created_at, (l.duplicate_of is not null), l.id
  limit 1 $$;

create function private.lead_set_duplicate() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.duplicate_of := private.lead_duplicate_of(new.workspace_id, new.email, new.phone);   -- never taken from the caller (the row is not in the table yet: it cannot match itself)
  return new;
end $$;
create trigger leads_duplicate before insert on public.leads for each row execute function private.lead_set_duplicate();

-- ---------- 3. saved views ----------
create table public.crm_views (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,        -- null = shared with the workspace
  name text not null check (length(name) between 1 and 60),
  query jsonb not null default '{}',                               -- the shape service.lead_list takes: search, filters, sort (page and size too, unused)
  columns text[] not null default '{}' check (cardinality(columns) <= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index crm_views_name on public.crm_views (workspace_id, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), name);
alter table public.crm_views enable row level security;
create policy crm_views_read on public.crm_views for select to authenticated
  using (private.can_see(workspace_id) and (user_id is null or user_id = (select auth.uid())));
revoke all on public.crm_views from anon;
revoke insert, update, delete, truncate, references, trigger on public.crm_views from authenticated;
grant select on public.crm_views to authenticated;
grant all on public.crm_views to service_role;

-- ---------- 4. tasks ----------
create table public.lead_tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  text text not null check (length(text) between 1 and 500),
  due_at timestamptz,
  done_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index lead_tasks_workspace on public.lead_tasks (workspace_id, lead_id);
create index lead_tasks_lead on public.lead_tasks (lead_id);
create index lead_tasks_open_due on public.lead_tasks (workspace_id, due_at) where done_at is null;
alter table public.lead_tasks enable row level security;
-- a task is seen exactly when its lead is: the leads_read policy decides (RLS applies inside the subquery), as for lead_events
create policy lead_tasks_read on public.lead_tasks for select to authenticated using (exists (select 1 from public.leads l where l.id = lead_id));
revoke all on public.lead_tasks from anon;
revoke insert, update, delete, truncate, references, trigger on public.lead_tasks from authenticated;
grant select on public.lead_tasks to authenticated;
grant all on public.lead_tasks to service_role;

-- ---------- 5. the query check (migration 14's and 18's checks of service.lead_list, in one place) ----------
-- Returns the parsed query: { types, cols, allf, search, skey, sdir, stype, size, pg }. Raises S-QUERY exactly as lead_list did.
create function private.lead_query_check(p_workspace uuid, p_query jsonb) returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
  types := types || '{"created_at":"datetime","name":"text","email":"text","phone":"text","status":"enum","owner":"owner","form":"text","page":"text","site":"text"}'::jsonb;
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

-- ---------- 5. the server list: migration 18's body, the checks moved to private.lead_query_check, plus follow_up, duplicates and the two flags ----------
create or replace function service.lead_list(p_claims jsonb, p_workspace uuid, p_query jsonb default '{}') returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid; staff boolean; role public.member_role; mine uuid; see_all boolean;
  q jsonb := coalesce(p_query, '{}'::jsonb); chk jsonb; cols jsonb; allf jsonb; types jsonb; search text; skey text; sdir text; stype text;
  size int; pg int; total bigint; rows jsonb; due boolean; dups boolean;
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

  -- each sort key typed once (sn number, sb boolean, ss status, st created_at, sx text); the page and the answer use the same row number
  with m as (
    select l.*, x.sv,
      case when stype = 'number' and jsonb_typeof(x.sv) = 'number' then (x.sv #>> '{}')::numeric end as sn,
      case when stype = 'boolean' and jsonb_typeof(x.sv) = 'boolean' then (x.sv #>> '{}')::boolean end as sb,
      case when skey = 'status' then l.status end as ss,
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
      jsonb_build_object('id', p.id, 'created_at', p.created_at, 'name', p.name, 'email', p.email, 'phone', p.phone, 'status', p.status,
        'owner', p.owner_team_row, 'form', p.form, 'page', p.page_path, 'site', p.site_id,
        'follow_up', p.follow_up_at, 'duplicate', p.duplicate_of is not null, 'duplicate_of', p.dv)
      || coalesce((select jsonb_object_agg(a.key, a.value) from jsonb_each(p.answers) a where types ? a.key and a.key not in ('follow_up', 'duplicate', 'duplicate_of', 'created_at', 'name', 'email', 'phone', 'status', 'owner', 'form', 'page', 'site')), '{}'::jsonb)
      order by p.ord) from o p where p.ord > (pg - 1) * size and p.ord <= pg * size), '[]'::jsonb)
    into total, rows;
  return jsonb_build_object('total', total, 'page', pg, 'size', size, 'columns', cols, 'fields', allf, 'rows', rows);
end $$;

-- ---------- 3. service.view_save / service.view_delete ----------
-- p_view: { id? (change this view), name (1 to 60), query? (a lead_list query), columns? (keys in order, at most 60), shared? }. A member saves their own
-- views; only an owner (or staff with the second factor) saves or changes a shared one (S-OWN-ONLY for anyone else). Another person's private view, another
-- workspace's view and a view that does not exist are all S-NOT-FOUND. Refused with the words of the problem: I-ANSWER name | query | columns | shared | views.
create function service.view_save(p_claims jsonb, p_workspace uuid, p_view jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid; staff boolean; role public.member_role; owner_ok boolean; v jsonb := coalesce(p_view, '{}'::jsonb); nm text; q jsonb; cols jsonb; known jsonb;
  shared boolean := false; vid uuid; old public.crm_views; e jsonb; k text; keys text[] := '{}'; n int;
begin
  me := service.use_claims(p_claims);
  staff := coalesce(private.is_staff(), false); role := private.my_role(p_workspace);
  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;
  owner_ok := coalesce(staff or role = 'owner', false);
  if jsonb_typeof(v) <> 'object' then raise exception 'I-ANSWER view: send the view as an object'; end if;
  if jsonb_typeof(v -> 'name') is distinct from 'string' then raise exception 'I-ANSWER name: A view needs a name'; end if;
  nm := btrim(v ->> 'name');
  if length(nm) not between 1 and 60 then raise exception 'I-ANSWER name: A view name is 1 to 60 characters'; end if;
  if v ? 'shared' then
    if jsonb_typeof(v -> 'shared') <> 'boolean' then raise exception 'I-ANSWER shared: Shared is yes or no'; end if;
    shared := (v ->> 'shared')::boolean;
  end if;
  if shared and not owner_ok then raise exception 'S-OWN-ONLY: only an owner shares a view with the business'; end if;
  q := coalesce(v -> 'query', '{}'::jsonb);
  if pg_column_size(q) > 16384 then raise exception 'I-ANSWER query: The query is too large'; end if;
  known := private.lead_query_check(p_workspace, q) -> 'types';   -- S-QUERY, as lead_list would refuse it
  cols := coalesce(v -> 'columns', '[]'::jsonb);
  if jsonb_typeof(cols) <> 'array' then raise exception 'I-ANSWER columns: Columns are a list of keys'; end if;
  if jsonb_array_length(cols) > 60 then raise exception 'I-ANSWER columns: At most 60 columns'; end if;
  for e in select x from jsonb_array_elements(cols) x loop
    if jsonb_typeof(e) <> 'string' then raise exception 'I-ANSWER columns: A column is a key'; end if;
    k := e #>> '{}';
    if not (known ? k) and k not in ('follow_up', 'duplicate') then
      raise exception 'I-ANSWER columns: % is not a column', case when k ~ '^[A-Za-z][A-Za-z0-9_]{0,39}$' then k else 'A key' end; end if;
    if k = any (keys) then raise exception 'I-ANSWER columns: % is listed twice', k; end if;
    keys := keys || k;
  end loop;
  begin
    if v ? 'id' and jsonb_typeof(v -> 'id') <> 'null' then
      if jsonb_typeof(v -> 'id') <> 'string' or (v ->> 'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'S-NOT-FOUND: not found'; end if;
      vid := (v ->> 'id')::uuid;
      select * into old from public.crm_views c where c.id = vid and c.workspace_id = p_workspace for update;
      if not found or (old.user_id is not null and old.user_id is distinct from me) then raise exception 'S-NOT-FOUND: not found'; end if;
      if old.user_id is null and not owner_ok then raise exception 'S-OWN-ONLY: only an owner changes a shared view'; end if;
      update public.crm_views set name = nm, query = q, columns = keys, user_id = case when shared then null else me end, updated_at = now() where id = vid;
    else
      insert into public.crm_views (workspace_id, user_id, name, query, columns) values (p_workspace, case when shared then null else me end, nm, q, keys) returning id into vid;
    end if;
  exception when unique_violation then
    raise exception 'I-ANSWER name: A view with that name already exists';
  end;
  select count(*) into n from public.crm_views c where c.workspace_id = p_workspace and c.user_id is not distinct from case when shared then null else me end;
  if n > 100 then raise exception 'I-ANSWER views: At most 100 views here, delete one first'; end if;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'view-save', vid::text, jsonb_build_object('shared', shared));
  return vid;
end $$;

create function service.view_delete(p_claims jsonb, p_view uuid) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid; staff boolean; role public.member_role; old public.crm_views;
begin
  me := service.use_claims(p_claims);
  select * into old from public.crm_views c where c.id = p_view for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  staff := coalesce(private.is_staff(), false); role := private.my_role(old.workspace_id);
  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;
  if old.user_id is not null and old.user_id is distinct from me then raise exception 'S-NOT-FOUND: not found'; end if;   -- someone else's private view is not there
  if old.user_id is null and not coalesce(staff or role = 'owner', false) then raise exception 'S-OWN-ONLY: only an owner deletes a shared view'; end if;
  delete from public.crm_views c where c.id = p_view;
  insert into public.audit_log (workspace_id, actor, action, target, detail) values (old.workspace_id, me, 'view-delete', p_view::text, jsonb_build_object('shared', old.user_id is null));
end $$;

-- ---------- 2. service.lead_follow_up ----------
-- Set (a time) or clear (null) the follow-up date of a lead the caller may act on. One `follow-up` event with old and new when it changes; answers whether it changed.
create function service.lead_follow_up(p_claims jsonb, p_lead uuid, p_at timestamptz) returns boolean language plpgsql security definer set search_path = '' as $$
declare me uuid; l public.leads;
begin
  me := service.use_claims(p_claims);
  select * into l from public.leads where public.leads.id = p_lead for update;
  if not found or not private.can_act_on_lead(l) then raise exception 'S-NOT-FOUND: not found'; end if;
  if p_at is not distinct from l.follow_up_at then return false; end if;
  update public.leads set follow_up_at = p_at where public.leads.id = p_lead;
  insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'follow-up', me, jsonb_build_object('old', l.follow_up_at, 'new', p_at));
  insert into public.audit_log (workspace_id, actor, action, target) values (l.workspace_id, me, 'lead-follow-up', p_lead::text);
  return true;
end $$;

-- ---------- 4. service.task_add / service.task_done ----------
create function service.task_add(p_claims jsonb, p_lead uuid, p_text text, p_due timestamptz default null) returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid; l public.leads; tx text := btrim(coalesce(p_text, '')); tid uuid;
begin
  me := service.use_claims(p_claims);
  select * into l from public.leads where public.leads.id = p_lead for update;
  if not found or not private.can_act_on_lead(l) then raise exception 'S-NOT-FOUND: not found'; end if;
  if length(tx) not between 1 and 500 then raise exception 'I-ANSWER text: A task is 1 to 500 characters'; end if;
  if (select count(*) from public.lead_tasks t where t.lead_id = p_lead) >= 100 then raise exception 'I-ANSWER tasks: A lead keeps at most 100 tasks'; end if;
  insert into public.lead_tasks (lead_id, workspace_id, text, due_at, created_by) values (p_lead, l.workspace_id, tx, p_due, me) returning id into tid;
  insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'task', me, jsonb_build_object('action', 'added', 'task', tid, 'text', tx, 'due', p_due));
  insert into public.audit_log (workspace_id, actor, action, target) values (l.workspace_id, me, 'task-add', tid::text);
  return tid;
end $$;

-- Finish (p_done true) or reopen (false) a task of a lead the caller may act on. A change writes one `task` event (done | reopened); asking for the state it is in writes nothing.
create function service.task_done(p_claims jsonb, p_task uuid, p_done boolean) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid; tk public.lead_tasks; l public.leads;
begin
  me := service.use_claims(p_claims);
  select * into tk from public.lead_tasks t where t.id = p_task for update;
  if not found then raise exception 'S-NOT-FOUND: not found'; end if;
  select * into l from public.leads where public.leads.id = tk.lead_id;
  if not found or not private.can_act_on_lead(l) then raise exception 'S-NOT-FOUND: not found'; end if;
  if p_done is null then raise exception 'I-ANSWER done: Done is yes or no'; end if;
  if p_done and tk.done_at is null then
    update public.lead_tasks set done_at = now() where id = p_task;
    insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (tk.lead_id, tk.workspace_id, 'task', me, jsonb_build_object('action', 'done', 'task', p_task, 'text', tk.text));
    insert into public.audit_log (workspace_id, actor, action, target) values (tk.workspace_id, me, 'task-done', p_task::text);
  elsif not p_done and tk.done_at is not null then
    update public.lead_tasks set done_at = null where id = p_task;
    insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (tk.lead_id, tk.workspace_id, 'task', me, jsonb_build_object('action', 'reopened', 'task', p_task, 'text', tk.text));
    insert into public.audit_log (workspace_id, actor, action, target) values (tk.workspace_id, me, 'task-reopen', p_task::text);
  end if;
end $$;

-- ---------- grants: closed to PUBLIC, anon and authenticated; the service functions open to the function role ----------
revoke all on function private.lead_duplicate_of(uuid, text, text) from public, anon, authenticated;
revoke all on function private.lead_set_duplicate() from public, anon, authenticated;
revoke all on function private.lead_query_check(uuid, jsonb) from public, anon, authenticated;
revoke all on function service.lead_list(jsonb, uuid, jsonb) from public, anon, authenticated;
grant execute on function service.lead_list(jsonb, uuid, jsonb) to service_role, omnikom_fn;
revoke all on function service.view_save(jsonb, uuid, jsonb) from public, anon, authenticated;
grant execute on function service.view_save(jsonb, uuid, jsonb) to service_role, omnikom_fn;
revoke all on function service.view_delete(jsonb, uuid) from public, anon, authenticated;
grant execute on function service.view_delete(jsonb, uuid) to service_role, omnikom_fn;
revoke all on function service.lead_follow_up(jsonb, uuid, timestamptz) from public, anon, authenticated;
grant execute on function service.lead_follow_up(jsonb, uuid, timestamptz) to service_role, omnikom_fn;
revoke all on function service.task_add(jsonb, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function service.task_add(jsonb, uuid, text, timestamptz) to service_role, omnikom_fn;
revoke all on function service.task_done(jsonb, uuid, boolean) from public, anon, authenticated;
grant execute on function service.task_done(jsonb, uuid, boolean) to service_role, omnikom_fn;
