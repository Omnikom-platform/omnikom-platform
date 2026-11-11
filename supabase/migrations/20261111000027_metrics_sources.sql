-- Omnikom Platform: work order 44 (blocks B20, B21, C16), migration 27. Additive to migrations 1 to 25 (26 is Clients').
-- metrics_snapshots (migration 1) had no writer and its source CHECK lacked 'bing', which SEO's collectors write (tools/audit/metrics, work order 33:
-- SOURCES = search-console, pagespeed, bing, ai-answers). Four parts:
--  1. The source CHECK gets 'bing' (the new check NOT VALID, validated, then the old one dropped; 'uptime' stays, nothing writes it yet).
--  2. The function role's way in and out of the table (it has no table grants, every access is a service.* function):
--       service.metrics_targets()            one site per workspace to measure: the live one, else the oldest preview one; a workspace that is
--                                            suspended, offboarding or deleted is left out
--       service.metrics_target_for_job(job)  the same facts for the site of one publish job (sitemap-submit)
--       service.metrics_put(ws, source, day, data)   upsert by the key (workspace, source, day): a rerun overwrites, never duplicates
--       service.metrics_get(ws, source, day)         that row's data or null (the IndexNow append reads the day's bing row)
--       service.metrics_last_day(ws, source)         the newest day with a row of that source or null (the weekly PageSpeed rule)
--  3. service.metrics_calls() lists what the daily job must call; service.metrics_pull_all() signs each call and posts it through pg_net with the
--     key and the project address read from Supabase Vault (names metrics_cron_key and project_url). Only the cron job runs it: no grant to anyone.
--  4. pg_cron runs service.metrics_pull_all() at 03:30 UTC under the name metrics-pull-daily (the named form replaces a job of the same name; the
--     call is guarded exactly like migration 19, so local and CI Postgres, which have no pg_cron, print one notice and still succeed).
-- The signature is the machine-call one of _shared/signature.ts, in the header X-Cron-Signature: t=<unix>,v1=HMAC-SHA256(key, t \n POST \n
-- /metrics-pull?workspace=<id>[&source=pagespeed] \n body); the function reads the key from its secret CRON_KEY.
-- UNPROVEN until staging: pg_net's body serialisation matching the signed text, and the two Vault entries (a head step, named in work/44).
-- Tests: tenancy.test.sql T32 and T25 (the stand-in for cron), run-local.mjs mutants "metrics27: ...", supabase/functions/test/metrics.test.ts.

set lock_timeout = '5s';

-- ---------- 1. the source check ----------
alter table public.metrics_snapshots add constraint metrics_snapshots_source_ok check (source in ('search-console', 'pagespeed', 'bing', 'ai-answers', 'uptime')) not valid;
alter table public.metrics_snapshots validate constraint metrics_snapshots_source_ok;
alter table public.metrics_snapshots drop constraint metrics_snapshots_source_check;

-- ---------- 2. the function role's access ----------
create function service.metrics_targets() returns table (workspace_id uuid, site_id uuid, site_state text, host text, domain text)
  language sql stable security definer set search_path = '' as $$
  select distinct on (s.workspace_id) s.workspace_id, s.id, s.state::text, s.preview_host, s.domain
  from public.sites s join public.workspaces w on w.id = s.workspace_id
  where w.state in ('trial', 'active') and s.state in ('live', 'preview')
  order by s.workspace_id, (s.state = 'live') desc, s.created_at, s.id $$;

create function service.metrics_target_for_job(p_job uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('workspace_id', s.workspace_id, 'site_id', s.id, 'site_state', s.state::text, 'host', s.preview_host, 'domain', s.domain)
  from public.publish_jobs j join public.sites s on s.id = j.site_id join public.workspaces w on w.id = s.workspace_id
  where j.id = p_job and w.state in ('trial', 'active') $$;

create function service.metrics_put(p_workspace uuid, p_source text, p_day date, p_data jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_source is null or p_source not in ('search-console', 'pagespeed', 'bing', 'ai-answers') then raise exception 'S-SOURCE: not a metrics source'; end if;
  if p_day is null or p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'S-BODY: a day and an object are needed'; end if;
  if length(p_data::text) > 262144 then raise exception 'S-SIZE: a metrics row is at most 256 KiB'; end if;
  if not exists (select 1 from public.workspaces w where w.id = p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;
  insert into public.metrics_snapshots (workspace_id, source, day, data) values (p_workspace, p_source, p_day, p_data)
    on conflict (workspace_id, source, day) do update set data = excluded.data;
end $$;

create function service.metrics_get(p_workspace uuid, p_source text, p_day date) returns jsonb language sql stable security definer set search_path = '' as $$
  select m.data from public.metrics_snapshots m where m.workspace_id = p_workspace and m.source = p_source and m.day = p_day $$;

create function service.metrics_last_day(p_workspace uuid, p_source text) returns date language sql stable security definer set search_path = '' as $$
  select max(m.day) from public.metrics_snapshots m where m.workspace_id = p_workspace and m.source = p_source $$;

-- ---------- 3. the daily job ----------
-- Two calls per workspace: the quick one (Search Console, Bing) and the slow one (PageSpeed on five pages, which can take close to the function's
-- 150 s), so each has its own invocation and its own time.
create function service.metrics_calls() returns table (workspace_id uuid, path text) language sql stable security definer set search_path = '' as $$
  select t.workspace_id, p.path from service.metrics_targets() t
    cross join lateral (values ('/metrics-pull?workspace=' || t.workspace_id::text), ('/metrics-pull?workspace=' || t.workspace_id::text || '&source=pagespeed')) p (path)
  order by t.workspace_id, p.path $$;

-- Returns how many calls it sent. Without pg_net, Vault, pgcrypto or the two entries it sends nothing and says why in a notice (it is a no-op
-- on local and CI Postgres). The body is '{}' and is signed as the text '{}' (the same text pg_net sends for the jsonb '{}').
create function service.metrics_pull_all() returns int language plpgsql security definer set search_path = '' as $$
declare k text; base text; c record; t bigint; sig text; n int := 0;
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null or to_regclass('vault.decrypted_secrets') is null
     or to_regprocedure('extensions.hmac(text,text,text)') is null then
    raise notice 'pg_net, Vault or pgcrypto is not installed here: the daily metrics pull sends nothing'; return 0;
  end if;
  select d.decrypted_secret into k from vault.decrypted_secrets d where d.name = 'metrics_cron_key' limit 1;
  select d.decrypted_secret into base from vault.decrypted_secrets d where d.name = 'project_url' limit 1;
  if coalesce(k, '') = '' or coalesce(base, '') = '' then
    raise notice 'the Vault entries metrics_cron_key and project_url are not both set: the daily metrics pull sends nothing'; return 0;
  end if;
  for c in select * from service.metrics_calls() loop
    t := extract(epoch from now())::bigint;
    sig := 't=' || t || ',v1=' || encode(extensions.hmac(t || E'\n' || 'POST' || E'\n' || c.path || E'\n' || '{}', k, 'sha256'), 'hex');
    perform net.http_post(rtrim(base, '/') || '/functions/v1' || c.path, '{}'::jsonb, '{}'::jsonb,
      jsonb_build_object('content-type', 'application/json', 'x-cron-signature', sig), 60000);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- grants: closed to PUBLIC, anon and authenticated; the function role for the five it needs; the cron pair to nobody ----------
revoke all on function service.metrics_targets() from public, anon, authenticated;
revoke all on function service.metrics_target_for_job(uuid) from public, anon, authenticated;
revoke all on function service.metrics_put(uuid, text, date, jsonb) from public, anon, authenticated;
revoke all on function service.metrics_get(uuid, text, date) from public, anon, authenticated;
revoke all on function service.metrics_last_day(uuid, text) from public, anon, authenticated;
revoke all on function service.metrics_calls() from public, anon, authenticated;
revoke all on function service.metrics_pull_all() from public, anon, authenticated;
-- the schema's default privileges give every new service function to service_role and omnikom_fn (migration 8); the cron pair is for pg_cron alone
revoke all on function service.metrics_calls() from omnikom_fn, service_role;
revoke all on function service.metrics_pull_all() from omnikom_fn, service_role;
grant execute on function service.metrics_targets() to service_role, omnikom_fn;
grant execute on function service.metrics_target_for_job(uuid) to service_role, omnikom_fn;
grant execute on function service.metrics_put(uuid, text, date, jsonb) to service_role, omnikom_fn;
grant execute on function service.metrics_get(uuid, text, date) to service_role, omnikom_fn;
grant execute on function service.metrics_last_day(uuid, text) to service_role, omnikom_fn;

-- ---------- 4. the schedule ----------
do $$ begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('metrics-pull-daily', '30 3 * * *', 'select service.metrics_pull_all()');
  else
    raise notice 'pg_cron is not installed here: the daily metrics pull (service.metrics_pull_all) is not scheduled';
  end if;
end $$;
