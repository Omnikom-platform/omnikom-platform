-- The written reason for no per-key index on leads.answers (work order 01, the head's ruling 2026-11-03, option a):
-- 20,000 leads in one workspace and 100,000 in another (one client among many); service.lead_list sorts and filters on an industry number field.
-- Every list query is cut by workspace first (index leads_ws_created), then sorted in memory. Prints the EXPLAIN of the list's
-- core query and the time of service.lead_list. Run: node supabase/tests/run-local.mjs --tests supabase/tests/crm-scale.sql --only zz-none
-- Revisit when one workspace passes about 50,000 leads (docs/product/3-database.md, beside the leads table). Rolled back at the end.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner-a@test'), ('00000000-0000-0000-0000-00000000000b', 'owner-b@test');
insert into workspaces (id, slug, name, industry) values ('aaaaaaaa-0000-0000-0000-000000000000', 'scale-a', 'Scale A', 'real-estate-agent'),
  ('bbbbbbbb-0000-0000-0000-000000000000', 'scale-b', 'Scale B', 'real-estate-agent');
insert into sites (id, workspace_id, deploy_target, preview_host) values ('aaaaaaaa-0000-0000-0000-00000000517e', 'aaaaaaaa-0000-0000-0000-000000000000', 'scale-a', 'scale-a.test'),
  ('bbbbbbbb-0000-0000-0000-00000000517e', 'bbbbbbbb-0000-0000-0000-000000000000', 'scale-b', 'scale-b.test');
insert into site_contracts (workspace_id, version, contract, resolved, active)
select ws, 1, '{}'::jsonb, '{"collections":{},"forms":{"contact":{"fields":{"name":{"type":"text"},"budget":{"type":"number","min":0},"timing":{"type":"enum","options":["0-3 months","3-6 months","6-12 months","just looking"]}}}},
  "leadColumns":[{"key":"budget"},{"key":"timing"}]}'::jsonb, true
from (values ('aaaaaaaa-0000-0000-0000-000000000000'::uuid), ('bbbbbbbb-0000-0000-0000-000000000000'::uuid)) v(ws);
insert into members (workspace_id, user_id, role) values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('bbbbbbbb-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000b', 'owner');
insert into leads (workspace_id, site_id, form, page_path, name, email, answers, consent_text, created_at)
select w.ws, w.site, 'contact', '/', 'Scale ' || i, 'scale' || i || '@test',
  jsonb_build_object('budget', (i * 7919) % 1000003, 'timing', (array['0-3 months','3-6 months','6-12 months','just looking'])[1 + i % 4]), 'seeded', now() - make_interval(secs => i)
from (values ('aaaaaaaa-0000-0000-0000-000000000000'::uuid, 'aaaaaaaa-0000-0000-0000-00000000517e'::uuid, 20000), ('bbbbbbbb-0000-0000-0000-000000000000'::uuid, 'bbbbbbbb-0000-0000-0000-00000000517e'::uuid, 100000)) w(ws, site, n),
  generate_series(1, w.n) i;
analyze leads;
-- the list's core query as service.lead_list runs it for an owner: workspace first, then the typed sort key
do $$ declare p text := ''; rec record; begin
  for rec in execute $q$explain (costs off) select l.id from public.leads l where l.workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000'
    order by case when jsonb_typeof(l.answers -> 'budget') = 'number' then (l.answers ->> 'budget')::numeric end asc nulls last, l.created_at desc, l.id desc limit 200$q$ loop
    p := p || ' | ' || rec."QUERY PLAN"; end loop;
  raise warning 'SCALE PASSED explain:%', p;
end $$;
do $$ declare t0 timestamptz; r jsonb; i int; ms numeric[] := '{}'; prev numeric; cur numeric; begin
  for i in 1 .. 3 loop
    t0 := clock_timestamp();
    r := service.lead_list('{"sub":"00000000-0000-0000-0000-00000000000a","aal":"aal1"}', 'aaaaaaaa-0000-0000-0000-000000000000', '{"sort":{"field":"budget","dir":"asc"},"size":200}');
    ms := ms || round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
  end loop;
  assert (r ->> 'total')::int = 20000 and jsonb_array_length(r -> 'rows') = 200, 'the owner of A lists A''s 20000 leads, a page of 200';
  for i in 0 .. 199 loop cur := (r -> 'rows' -> i ->> 'budget')::numeric; assert prev is null or cur >= prev, 'number order at ' || i; prev := cur; end loop;
  raise warning 'SCALE PASSED lead_list, 20000 leads in the workspace (120000 in the table), sort budget asc, page of 200: % ms (3 runs)', ms;
  t0 := clock_timestamp();
  r := service.lead_list('{"sub":"00000000-0000-0000-0000-00000000000a","aal":"aal1"}', 'aaaaaaaa-0000-0000-0000-000000000000',
    '{"filters":[{"field":"budget","op":"range","from":100000,"to":300000},{"field":"timing","op":"eq","value":"0-3 months"}],"search":"scale 1","sort":{"field":"budget","dir":"desc"},"size":50}');
  raise warning 'SCALE PASSED lead_list, range + eq filter + search + sort desc over 20000: % ms, % matches', round(extract(epoch from clock_timestamp() - t0) * 1000, 1), r ->> 'total';
end $$;
select 'CRM SCALE RUN DONE' as result;
rollback;
