-- The written reason for no per-key index on leads.answers (work order 01, the head's ruling 2026-11-03, option a):
-- 50,000 leads in one workspace and 100,000 in another (one client among many); service.lead_list sorts and filters on an industry number field.
-- Every list query is cut by workspace first (index leads_ws_created), then sorted in memory. Prints the EXPLAIN of the list's
-- core query and the time of service.lead_list. Run: node supabase/tests/run-local.mjs --tests supabase/tests/crm-scale.sql --only zz-none --psql-timeout-s 600 (it ends FAILED by the none-ran rule; the result is the PASS line)
-- E13-a (2026-11-13): 50,000 leads in A; each L and R line is the median of 3 runs against its budget, the head's choice, changeable below. Rolled back at the end.
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
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'agent-a@test');
insert into content_rows (id, workspace_id, collection) values ('aaaaaaaa-0000-0000-0000-0000000007ea', 'aaaaaaaa-0000-0000-0000-000000000000', 'team');
insert into members (workspace_id, user_id, role, team_row_id) values ('aaaaaaaa-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1', 'member', 'aaaaaaaa-0000-0000-0000-0000000007ea');
insert into leads (workspace_id, site_id, form, page_path, name, email, answers, consent_text, created_at, owner_team_row)
select w.ws, w.site, 'contact', '/', 'Scale ' || i, 'scale' || i || '@test',
  jsonb_build_object('budget', (i * 7919) % 1000003, 'timing', (array['0-3 months','3-6 months','6-12 months','just looking'])[1 + i % 4]), 'seeded', now() - make_interval(secs => i),
  case when w.ws = 'aaaaaaaa-0000-0000-0000-000000000000' and i % 100 = 0 then 'aaaaaaaa-0000-0000-0000-0000000007ea'::uuid end
from (values ('aaaaaaaa-0000-0000-0000-000000000000'::uuid, 'aaaaaaaa-0000-0000-0000-00000000517e'::uuid, 50000), ('bbbbbbbb-0000-0000-0000-000000000000'::uuid, 'bbbbbbbb-0000-0000-0000-00000000517e'::uuid, 100000)) w(ws, site, n),
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
  assert (r ->> 'total')::int = 50000 and jsonb_array_length(r -> 'rows') = 200, 'the owner of A lists A''s 50000 leads, a page of 200';
  for i in 0 .. 199 loop cur := (r -> 'rows' -> i ->> 'budget')::numeric; assert prev is null or cur >= prev, 'number order at ' || i; prev := cur; end loop;
  raise warning 'SCALE PASSED lead_list, 50000 leads in the workspace (150000 in the table), sort budget asc, page of 200: % ms (3 runs)', ms;
  t0 := clock_timestamp();
  r := service.lead_list('{"sub":"00000000-0000-0000-0000-00000000000a","aal":"aal1"}', 'aaaaaaaa-0000-0000-0000-000000000000',
    '{"filters":[{"field":"budget","op":"range","from":100000,"to":300000},{"field":"timing","op":"eq","value":"0-3 months"}],"search":"scale 1","sort":{"field":"budget","dir":"desc"},"size":50}');
  raise warning 'SCALE PASSED lead_list, range + eq filter + search + sort desc over 50000: % ms, % matches', round(extract(epoch from clock_timestamp() - t0) * 1000, 1), r ->> 'total';
end $$;
-- E13-a: the lines that decide which part is built (E13.md). L: service.lead_list as the screen calls it; X1: the export's 25 pages.
do $$ declare c record; t0 timestamptz; ms numeric[]; i int; r jsonb; med numeric;
  st jsonb := '{"field":"status","op":"in","values":["not-contacted","contacted","qualified","closed"]}';
  si jsonb := '{"field":"site","op":"eq","value":"aaaaaaaa-0000-0000-0000-00000000517e"}'; begin
  for c in select * from (values
    ('L1 the All view of the site, received newest first, page of 50', '00000000-0000-0000-0000-00000000000a', jsonb_build_object('filters', jsonb_build_array(st, si), 'size', 50)),
    ('L2 sort by budget, page of 200', '00000000-0000-0000-0000-00000000000a', '{"sort":{"field":"budget","dir":"asc"},"size":200}'::jsonb),
    ('L3 range and eq filters, search, sort desc, page of 50', '00000000-0000-0000-0000-00000000000a', '{"filters":[{"field":"budget","op":"range","from":100000,"to":300000},{"field":"timing","op":"eq","value":"0-3 months"}],"search":"scale 1","sort":{"field":"budget","dir":"desc"},"size":50}'::jsonb),
    ('L4 a filter count as the member, the Mine view, size 1', '00000000-0000-0000-0000-0000000000a1', jsonb_build_object('filters', jsonb_build_array(st, '{"field":"owner","op":"eq","value":"aaaaaaaa-0000-0000-0000-0000000007ea"}'::jsonb, si), 'size', 1))
  ) v(id, sub, q) loop
    ms := '{}';
    for i in 1 .. 3 loop
      t0 := clock_timestamp();
      r := service.lead_list(jsonb_build_object('sub', c.sub, 'aal', 'aal1'), 'aaaaaaaa-0000-0000-0000-000000000000', c.q);
      ms := ms || round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
    end loop;
    med := (select x from unnest(ms) x order by x offset 1 limit 1);
    raise warning 'SCALE PASSED % (total %): % ms, budget 250 ms, %', c.id, r ->> 'total', med, case when med <= 250 then 'IN' else 'OVER' end;
  end loop;
  t0 := clock_timestamp();
  for i in 1 .. 25 loop
    r := service.lead_list('{"sub":"00000000-0000-0000-0000-00000000000a","aal":"aal1"}', 'aaaaaaaa-0000-0000-0000-000000000000', jsonb_build_object('filters', jsonb_build_array(st, si), 'size', 200, 'page', i));
  end loop;
  med := round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
  raise warning 'SCALE PASSED X1 the export''s 25 pages of 200: % ms, budget 15000 ms, %', med, case when med <= 15000 then 'IN' else 'OVER' end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","aal":"aal1"}', false), set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
do $$ declare t0 timestamptz; ms numeric[] := '{}'; i int; n int; med numeric; begin
  for i in 1 .. 3 loop
    t0 := clock_timestamp();
    select count(*) into n from (select l.id from public.leads l where l.workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' order by l.created_at desc limit 500) x;
    ms := ms || round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
  end loop;
  med := (select x from unnest(ms) x order by x offset 1 limit 1);
  raise warning 'SCALE PASSED R1 the owner reads the newest 500 leads (data.ts useLeads): % leads, % ms, budget 100 ms, %', n, med, case when med <= 100 then 'IN' else 'OVER' end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","aal":"aal1"}', false), set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ declare t0 timestamptz; ms numeric[] := '{}'; i int; n int; med numeric; begin
  for i in 1 .. 3 loop
    t0 := clock_timestamp();
    select count(*) into n from (select l.id from public.leads l where l.workspace_id = 'aaaaaaaa-0000-0000-0000-000000000000' order by l.created_at desc limit 500) x;
    ms := ms || round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
  end loop;
  med := (select x from unnest(ms) x order by x offset 1 limit 1);
  raise warning 'SCALE PASSED R2 the member reads their newest 500 leads (data.ts useLeads): % leads, % ms, budget 100 ms, %', n, med, case when med <= 100 then 'IN' else 'OVER' end;
end $$;
reset role;
select 'CRM SCALE RUN DONE' as result;
rollback;
