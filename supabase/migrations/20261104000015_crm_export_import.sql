-- Omnikom Platform: work order 02 (CRM export and import in the client's own format), migration 15. Additive to migrations 1 to 14.
-- A lead reaches the client's own CRM as an export in that CRM's layout, which they upload, and their file comes back through the same map
-- (tools/crm-map, run in the Edge Functions). The database is the wall: what may be mapped, who may import, how every value is typed.
--  1. private.lead_column_defs(ws)       the industry fields of private.lead_columns as one object { key: def } (looked up once per call)
--     private.typed_lead_answers(...)    answers typed against every industry field of the workspace, as capture types them against a form;
--                                        a key the forms do not declare is dropped (p_strict false) or refused I-UNKNOWN (p_strict true)
--     private.phone_key(text)            a phone in E.164 for the duplicate check (a bare 10-digit number is read as US, as tools/crm-map does)
--  2. service.add_lead types its answers (work order 01 finding F3): a bad value is I-ANSWER naming the field, as capture.
--  3. service.save_crm_template: a field may also be `owner` (the team member); every industry field the map names must be on this business's
--     forms (T-FIELD <key>); one map per workspace and name: saving a name that exists updates that row (the same row, a new version of it).
--  4. service.crm_fields(claims, ws)     our industry fields for the map (owner or staff only), in form order.
--  5. service.import_leads(claims, ws, template, rows, opts)   the import: owner or staff only; a dry run (the default) types every row, finds the
--     duplicates and writes nothing; a real run needs the consent tick and a choice for duplicates, is all or nothing, and writes per lead one
--     `received` event and one consent ledger row, and one audit row for the call.
-- Every function: security definer, set search_path = '', fully schema-qualified, closed to PUBLIC, granted to the function role only.
-- Tests: tenancy.test.sql T23 (walls) and run-local.mjs mutants "crm15: ...".

-- ---------- 1. typing against every industry field ----------
create function private.lead_column_defs(p_ws uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(c.key, c.def), '{}'::jsonb) from private.lead_columns(p_ws) c $$;

-- p_cols: private.lead_column_defs(ws). Returns the answers typed; an empty value is not stored.
create function private.typed_lead_answers(p_ws uuid, p_cols jsonb, p_answers jsonb, p_strict boolean) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare k text; v jsonb; d jsonb; t jsonb; out jsonb := '{}'::jsonb;
begin
  if p_answers is null or p_answers = 'null'::jsonb then return out; end if;
  if jsonb_typeof(p_answers) <> 'object' then raise exception 'I-ANSWER answers: the answers must be an object'; end if;
  for k, v in select x.key, x.value from jsonb_each(p_answers) x loop
    d := p_cols -> k;
    if d is null then
      if p_strict then raise exception 'I-UNKNOWN: "%" is not a field of this lead', left(k, 40); end if;
      continue;   -- as capture: a key the forms do not declare is dropped, never stored
    end if;
    t := private.typed_value(k, d, v);
    if t is null then continue; end if;
    if d ->> 'type' = 'reference' and not private.reference_ok(p_ws, d, t #>> '{}') then
      raise exception 'I-ANSWER %: % must be one of the listed choices', k, coalesce(d ->> 'label', k); end if;
    out := out || jsonb_build_object(k, t);
  end loop;
  return out;
end $$;

create function private.phone_key(p text) returns text language sql immutable set search_path = '' as $$
  select case when x.d ~ '^[0-9]{7,15}$' then '+' || case when length(x.d) = 10 and btrim(coalesce(p, '')) !~ '^\+' then '1' || x.d else x.d end end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x $$;

-- ---------- 2. add_lead types its answers (as migration 8, plus the typing) ----------
create or replace function service.add_lead(p_claims jsonb, p_site uuid, p_name text, p_email text, p_phone text, p_answers jsonb, p_consent text,
  p_form text default 'manual', p_owner uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid; ws uuid; role public.member_role; staff boolean; who uuid; lid uuid; typed jsonb;
begin
  me := service.use_claims(p_claims);
  select workspace_id into ws from public.sites where public.sites.id = p_site;
  if ws is null then raise exception 'S-NOT-FOUND: not found'; end if;
  staff := private.is_staff(); role := private.my_role(ws);
  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;
  if coalesce(p_consent, '') = '' then raise exception 'consent text required'; end if;
  who := case when role = 'member' and not staff then private.my_team_row(ws) else p_owner end;
  if who is not null and not exists (select 1 from public.content_rows c where c.id = who and c.workspace_id = ws and c.collection = 'team' and c.deleted_at is null)
    then raise exception 'S-NOT-FOUND: no such team member'; end if;
  typed := private.typed_lead_answers(ws, private.lead_column_defs(ws), p_answers, false);   -- migration 15: typed against every industry field
  insert into public.leads (workspace_id, site_id, form, page_path, name, email, phone, answers, consent_text, owner_team_row)
    values (ws, p_site, coalesce(p_form, 'manual'), 'dashboard', p_name, p_email, p_phone, typed, p_consent, who) returning public.leads.id into lid;
  insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (lid, ws, 'received', me, jsonb_build_object('manual', true, 'form', coalesce(p_form, 'manual')));
  insert into public.audit_log (workspace_id, actor, action, target) values (ws, me, 'lead-add', lid::text);
  perform private.record_consent(ws, p_site, lid, coalesce(p_form, 'manual'), 'dashboard', p_consent, false, null, null, null, me);
  return lid;
end $$;

-- ---------- 3. save_crm_template (as migration 8, plus owner, the industry-field check and one map per name) ----------
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
       or (c ->> 'field') !~ '^(name|email|phone|form|page_path|flow|cta|status|created_at|owner|answers\.[a-z][a-zA-Z0-9_]{0,60})$'
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

-- ---------- 4. our fields for the map ----------
create function service.crm_fields(p_claims jsonb, p_workspace uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid; staff boolean; role public.member_role;
begin
  me := service.use_claims(p_claims);
  staff := coalesce(private.is_staff(), false); role := private.my_role(p_workspace);
  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;
  if not coalesce(staff or role = 'owner', false) then raise exception 'S-OWN-ONLY: only an owner can map the CRM layout'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('key', c.key, 'label', coalesce(c.def ->> 'label', c.key), 'type', c.def ->> 'type', 'options', c.def -> 'options') order by c.ord)
    from private.lead_columns(p_workspace) c), '[]'::jsonb);
end $$;

-- ---------- 5. the import ----------
-- p_rows: [{ line, name?, email?, phone?, status?, owner?, answers? }] (1 to 5000), what tools/crm-map importRows made of the file; `line` is the file's
-- line number (the header is line 1), echoed in the report. p_opts: { dry_run (default true; only false is a real run), duplicates: skip | add,
-- consent: true, file_name, file_sha256 }.
-- A row is typed as capture types: name, email and phone as lead_set_fields does, status one of the lead statuses (empty is new), answers against
-- every industry field (an unknown key refused), and a lead needs a name, an email or a phone. Owner: the team member a mapped column names (name,
-- email or slug, any case), otherwise the importing owner's own team row (a warning says so). A duplicate has the email (lower-cased) or the phone
-- (E.164) of a lead of this workspace or of an earlier row of the file.
-- Dry run: writes nothing; answers { dry_run, rows, valid, new, refused_count, refused (first 100: line, field, reason), duplicates_count,
-- duplicates (first 100: line, by, with), warnings (first 100), sample (the first 20 rows as they would be stored) }.
-- Real run: refused unless consent is true (I-CONSENT) and duplicates is skip or add (I-DUPLICATES); the first refused row refuses the whole call
-- (I-IMPORT line <n> <field>: <words>), nothing is written. Each lead: form and page `import`, the consent sentence with the date and the file's
-- name as consent_text, marketing and SMS consent false, one `received` event (detail { import: true }), one consent ledger row. One audit row
-- for the call (file sha256 and the counts). Answers { dry_run: false, rows, created, skipped }.
create function service.import_leads(p_claims jsonb, p_workspace uuid, p_template uuid, p_rows jsonb, p_opts jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid; staff boolean; role public.member_role; o jsonb := coalesce(p_opts, '{}'::jsonb); dry boolean; dup text; fname text; sha text;
  tpl public.crm_templates; cols jsonb; missing text; site uuid; mine uuid; team jsonb; have_e jsonb; have_p jsonb; seen_e jsonb := '{}'::jsonb; seen_p jsonb := '{}'::jsonb;
  r jsonb; line int; m text; fld text; n_name text; n_email text; n_phone text; n_status public.lead_status; n_owner uuid; n_answers jsonb;
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
      if coalesce(btrim(r ->> 'status'), '') = '' then n_status := 'new';
      elsif lower(btrim(r ->> 'status')) = any (enum_range(null::public.lead_status)::text[]) then n_status := lower(btrim(r ->> 'status'))::public.lead_status;
      else raise exception 'I-ANSWER status: Status must be one of the lead statuses'; end if;
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
        sample := sample || jsonb_build_array(jsonb_build_object('line', line, 'name', n_name, 'email', n_email, 'phone', n_phone, 'status', n_status,
          'owner', n_owner, 'answers', n_answers, 'duplicate', dupe is not null)); end if;
    elsif dupe is not null and dup = 'skip' then
      skipped := skipped + 1;
    else
      insert into public.leads (workspace_id, site_id, form, page_path, name, email, phone, answers, consent_text, status, owner_team_row, marketing_consent, sms_consent)
        values (p_workspace, site, 'import', 'import', n_name, n_email, n_phone, n_answers, consent, n_status, n_owner, '{"given":false}'::jsonb, false)
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

-- ---------- grants: closed to PUBLIC, anon and authenticated; the function role (and service_role) only ----------
revoke all on function private.lead_column_defs(uuid) from public, anon, authenticated;
revoke all on function private.typed_lead_answers(uuid, jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function private.phone_key(text) from public, anon, authenticated;
revoke all on function service.add_lead(jsonb, uuid, text, text, text, jsonb, text, text, uuid) from public, anon, authenticated;
grant execute on function service.add_lead(jsonb, uuid, text, text, text, jsonb, text, text, uuid) to service_role, omnikom_fn;
revoke all on function service.save_crm_template(jsonb, uuid, uuid, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function service.save_crm_template(jsonb, uuid, uuid, text, text, text, jsonb, jsonb) to service_role, omnikom_fn;
revoke all on function service.crm_fields(jsonb, uuid) from public, anon, authenticated;
grant execute on function service.crm_fields(jsonb, uuid) to service_role, omnikom_fn;
revoke all on function service.import_leads(jsonb, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function service.import_leads(jsonb, uuid, uuid, jsonb, jsonb) to service_role, omnikom_fn;
