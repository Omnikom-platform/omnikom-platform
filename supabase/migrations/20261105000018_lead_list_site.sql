-- Omnikom Platform: work order 07 (the CRM screens, block 3a), migration 18. Additive to migrations 1 to 17 (create or replace of two functions).
-- The leads screen's site switcher is a service.lead_list filter (head's ruling 2026-11-04): `site` joins the core keys a caller may filter and
-- sort on: created_at, name, email, phone, status, owner, form, page, site. The value is the site's id as text, so eq / in / empty / not_empty
-- work as they do on any text column; a site of another workspace matches nothing (the query is cut by workspace first, then by the
-- caller's row level rules, exactly as before). Nothing else in either function changes: the bodies below are migration 14's, with the
-- `site` branch, the `site` entry of the typed keys, and `site` kept out of the answers merged into a row (a form field of that name
-- must not overwrite the row's own site).
-- private.lead_value: language sql, immutable, search_path = ''. service.lead_list: security definer, search_path = ''. The grants are
-- migration 14's and are stated again below so this file stands alone.
-- Tests: tenancy.test.sql T24 (walls) and run-local.mjs mutants "crm18: ...".

create or replace function private.lead_value(l public.leads, p_key text) returns jsonb language sql immutable set search_path = '' as $$
  select case p_key when 'created_at' then to_jsonb(l.created_at) when 'name' then to_jsonb(l.name) when 'email' then to_jsonb(l.email)
    when 'phone' then to_jsonb(l.phone) when 'status' then to_jsonb(l.status::text) when 'owner' then to_jsonb(l.owner_team_row)
    when 'form' then to_jsonb(l.form) when 'page' then to_jsonb(l.page_path) when 'site' then to_jsonb(l.site_id::text) else l.answers -> p_key end $$;

create or replace function service.lead_list(p_claims jsonb, p_workspace uuid, p_query jsonb default '{}') returns jsonb language plpgsql security definer set search_path = '' as $$
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
      || coalesce((select jsonb_object_agg(a.key, a.value) from jsonb_each(p.answers) a where types ? a.key and a.key not in ('created_at', 'name', 'email', 'phone', 'status', 'owner', 'form', 'page', 'site')), '{}'::jsonb)
      order by p.ord) from o p where p.ord > (pg - 1) * size and p.ord <= pg * size), '[]'::jsonb)
    into total, rows;
  return jsonb_build_object('total', total, 'page', pg, 'size', size, 'columns', cols, 'fields', allf, 'rows', rows);
end $$;

-- ---------- grants: as migration 14 has them ----------
revoke all on function private.lead_value(public.leads, text) from public, anon, authenticated;
revoke all on function service.lead_list(jsonb, uuid, jsonb) from public, anon, authenticated;
grant execute on function service.lead_list(jsonb, uuid, jsonb) to service_role, omnikom_fn;
