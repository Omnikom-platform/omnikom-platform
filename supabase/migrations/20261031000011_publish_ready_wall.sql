-- Omnikom Platform: step 4, slice 4.6 (brief factory/briefs/4-6-publish-ready-wall.md). Additive to migrations 1 to 10.
-- A row that fails publish validation can never be published, on any path.
--
-- Why: the publish Edge Function validates every requested row with the JS validator (contracts/validate.mjs, publish mode) before it
-- calls service.start_publish. Every other path skipped that (the CLI's SQL path, test scripts, anything with a database connection),
-- and three bare test listings were published that way on staging. Every publish snapshots ALL published rows of the workspace, so from
-- then on every build of the test site failed in the factory, on one bad row. The database refuses it now, whatever the path.
--
-- What:
--  1. private.publish_problems(resolved, collection, data) -> text[]: a SQL port of the publish-mode REQUIRED rules of
--     contracts/validate.mjs (checkValue, checkObject, validateItem, empty), and only those. Each problem is '<path> required' with the
--     path built as the JS builds it. The port is checked against the JS validator by supabase/tests/publish-parity.mjs.
--     STAYS IN JS (not ported on purpose, more SQL is more drift; the publish Edge Function still runs all of it): types (I-TYPE),
--     max/min (I-MAX, I-MIN), slug (I-SLUG), enum (I-ENUM), references (I-REF), media and EXIF (I-MEDIA-*, I-ALT, I-RIGHTS, I-EXIF),
--     placeholder text (I-PLACEHOLDER), consent wording (I-CONSENT-*), sample items (I-SAMPLE-LIVE), unknown fields (I-UNKNOWN),
--     and the shape of a sourced fact (I-SOURCE; here only used to decide whether the value inside can be entered).
--  2. Layer one: a trigger before insert on public.publish_jobs. Every (row id, version) of new.requested is loaded from
--     content_versions and checked against the workspace's ACTIVE contract; no active contract = refused.
--  3. Layer two: a trigger before update of published_version on public.content_rows, when the new value is not null and changes: the
--     same check on that version. It stops a job created before this migration, a faked "done" callback and a hand edit.
--     Both triggers fire for a superuser too. Taking a row off the site (published_version to null) is never refused.
--  Both trigger functions are SECURITY DEFINER with search_path = '' (T14). The helper functions touch no table: immutable, empty
--  search_path. All of them are closed to PUBLIC, anon and authenticated (migration 8's default privileges do it; the explicit
--  statements at the end are the second layer, and the mutants in run-local.mjs remove both).
-- Tests: tenancy.test.sql T19, written before this file.

-- ---------- JS truthiness and emptiness ----------
-- JS `f.required`, `f.open`, `f.sourced` are truthy tests: anything but undefined, null, false, 0 and "".
create function private.js_truthy(v jsonb) returns boolean language sql immutable set search_path = '' as
  $$ select coalesce(v, 'null'::jsonb) not in ('null'::jsonb, 'false'::jsonb, '0'::jsonb, '""'::jsonb) $$;

-- JS `empty(v)`: missing, JSON null, the empty string, the empty array. A whitespace-only string is NOT empty.
create function private.publish_empty(v jsonb) returns boolean language sql immutable set search_path = '' as
  $$ select v is null or v in ('null'::jsonb, '""'::jsonb, '[]'::jsonb) $$;

-- JS `isStr(s) && s.trim()`: a string with at least one character that String.prototype.trim keeps (it strips the white space and line
-- terminators of ECMAScript: \s plus U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF).
create function private.publish_has_text(v jsonb) returns boolean language sql immutable set search_path = '' as
  $$ select coalesce(jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '[^\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]', false) $$;

-- ---------- checkObject: every field of the contract against the data object ----------
create function private.publish_problems_object(p_types jsonb, p_page_type text, p_path text, p_data jsonb, p_fields jsonb) returns text[]
language plpgsql immutable set search_path = '' as $$
declare probs text[] := '{}'; f record;
begin
  -- JS: data that is not an object is I-TYPE (stays in JS), no required path
  if jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(p_fields) is distinct from 'object' then return probs; end if;
  for f in select e.key as k, e.value as def from jsonb_each(p_fields) e loop
    probs := probs || private.publish_problems_value(p_types, p_page_type, case when p_path = '' then f.k else p_path || '.' || f.k end, p_data -> f.k, f.def);
  end loop;
  return probs;
end $$;

-- ---------- checkValue: one field ----------
create function private.publish_problems_value(p_types jsonb, p_page_type text, p_path text, p_value jsonb, p_field jsonb) returns text[]
language plpgsql immutable set search_path = '' as $$
declare probs text[] := '{}'; v jsonb := p_value; t text := p_field ->> 'type'; pt jsonb; s jsonb; x record; i int;
begin
  if private.publish_empty(v) then
    if private.js_truthy(p_field -> 'required') then return array[p_path || ' required']; end if;
    return probs;
  end if;
  -- a client-facing fact is { value, source, date }: the value inside is what the rules below look at (a malformed one is I-SOURCE in JS)
  if private.js_truthy(p_field -> 'sourced') then
    if not coalesce(jsonb_typeof(v) = 'object' and v ? 'value' and jsonb_typeof(v -> 'source') = 'string' and (v ->> 'source') <> ''
        and jsonb_typeof(v -> 'date') = 'string' and (v ->> 'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$', false) then return probs; end if;
    v := v -> 'value';
  end if;
  if t = 'list' and not private.js_truthy(p_field -> 'open') then
    if jsonb_typeof(v) = 'array' then
      for i in 0 .. jsonb_array_length(v) - 1 loop
        probs := probs || private.publish_problems_object(p_types, p_page_type, p_path || '[' || i || ']', v -> i, coalesce(p_field -> 'of', '{}'::jsonb));
      end loop;
    end if;
  elsif t = 'group' and not private.js_truthy(p_field -> 'open') then
    if jsonb_typeof(v) = 'object' then
      probs := probs || private.publish_problems_object(p_types, p_page_type, p_path, v, coalesce(p_field -> 'of', '{}'::jsonb));
    end if;
  elsif t = 'seo' then
    -- JS: `v && typeof v === 'object'` (an array counts), then title and description must be non-blank after trim
    if jsonb_typeof(v) in ('object', 'array') then
      if not private.publish_has_text(v -> 'title') then probs := probs || (p_path || '.title required'); end if;
      if not private.publish_has_text(v -> 'description') then probs := probs || (p_path || '.description required'); end if;
    end if;
  elsif t = 'sections' then
    if jsonb_typeof(v) in ('object', 'array') then
      pt := p_types -> p_page_type;
      -- JS: an unknown page type is I-TYPE (stays in JS), no required path
      if jsonb_typeof(pt) is distinct from 'object' then return probs; end if;
      if jsonb_typeof(v) = 'object' then
        for x in select e.key as k, e.value as sv from jsonb_each(v) e loop
          s := (select q.sec from jsonb_array_elements(coalesce(pt -> 'sections', '[]'::jsonb)) with ordinality q(sec, ord) where q.sec ->> 'id' = x.k order by q.ord limit 1);
          if s is not null and s ->> 'kind' = 'fields' and jsonb_typeof(x.sv) = 'object' then
            probs := probs || private.publish_problems_object(p_types, p_page_type, p_path || '.' || x.k, x.sv, coalesce(s -> 'fields', '{}'::jsonb));
          end if;
        end loop;
      end if;
      for x in select q.sec from jsonb_array_elements(coalesce(pt -> 'sections', '[]'::jsonb)) q(sec) loop
        if x.sec ->> 'kind' = 'fields' and (x.sec ->> 'id') is not null
           and exists (select 1 from jsonb_each(coalesce(x.sec -> 'fields', '{}'::jsonb)) fd where private.js_truthy(fd.value -> 'required'))
           and not private.js_truthy(v -> (x.sec ->> 'id')) then
          probs := probs || (p_path || '.' || (x.sec ->> 'id') || ' required');
        end if;
      end loop;
    end if;
  end if;
  return probs;
end $$;

-- ---------- validateItem: one row of one collection against the resolved contract ----------
create function private.publish_problems(p_resolved jsonb, p_collection text, p_data jsonb) returns text[]
language plpgsql immutable set search_path = '' as $$
declare c jsonb := p_resolved -> 'collections' -> p_collection;
begin
  if jsonb_typeof(c) is distinct from 'object' then return array[p_collection || ' unknown collection']; end if;
  return private.publish_problems_object(p_resolved -> 'pageTypes', p_data ->> 'type', '', p_data, coalesce(c -> 'fields', '{}'::jsonb));
end $$;

-- ---------- layer one: no publish job can be created for a row that is not ready ----------
create function private.check_job_ready() returns trigger language plpgsql security definer set search_path = '' as $$
declare res jsonb; r record; coll text; d jsonb; probs text[];
begin
  select sc.resolved into res from public.site_contracts sc where sc.workspace_id = new.workspace_id and sc.active;
  if res is null then raise exception 'I-NOT-READY: % no active contract', new.workspace_id; end if;
  for r in select k.key as row_id, k.value as n from jsonb_each_text(new.requested) k order by k.key loop
    select c.collection, v.data into coll, d from public.content_rows c join public.content_versions v on v.row_id = c.id
      where c.id = r.row_id::uuid and c.workspace_id = new.workspace_id and v.n = r.n::int;
    if not found then raise exception 'I-NOT-READY: % version % not found in this workspace', r.row_id, r.n; end if;
    probs := private.publish_problems(res, coll, d);
    if cardinality(probs) > 0 then raise exception 'I-NOT-READY: % %', r.row_id, probs[1]; end if;
  end loop;
  return new;
end $$;
create trigger publish_jobs_ready before insert on public.publish_jobs for each row execute function private.check_job_ready();

-- ---------- layer two: no row goes live at a version that is not ready ----------
create function private.check_version_ready() returns trigger language plpgsql security definer set search_path = '' as $$
declare res jsonb; d jsonb; probs text[];
begin
  select sc.resolved into res from public.site_contracts sc where sc.workspace_id = new.workspace_id and sc.active;
  if res is null then raise exception 'I-NOT-READY: % no active contract', new.workspace_id; end if;
  select v.data into d from public.content_versions v where v.row_id = new.id and v.n = new.published_version;
  if not found then raise exception 'I-NOT-READY: % version % not found', new.id, new.published_version; end if;
  probs := private.publish_problems(res, new.collection, d);
  if cardinality(probs) > 0 then raise exception 'I-NOT-READY: % %', new.id, probs[1]; end if;
  return new;
end $$;
create trigger content_rows_ready before update of published_version on public.content_rows for each row
  when (new.published_version is not null and new.published_version is distinct from old.published_version)
  execute function private.check_version_ready();

-- ---------- grants: closed to everyone (second layer beside migration 8's default privileges) ----------
revoke all on function private.js_truthy(jsonb) from public, anon, authenticated;
revoke all on function private.publish_empty(jsonb) from public, anon, authenticated;
revoke all on function private.publish_has_text(jsonb) from public, anon, authenticated;
revoke all on function private.publish_problems_object(jsonb, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.publish_problems_value(jsonb, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function private.publish_problems(jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function private.check_job_ready() from public, anon, authenticated;
revoke all on function private.check_version_ready() from public, anon, authenticated;
