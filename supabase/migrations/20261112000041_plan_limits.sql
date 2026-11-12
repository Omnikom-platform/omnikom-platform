-- Omnikom Platform: book row E16 (our part, H2-9), migration 41. Additive to the migrations before it.
-- Caps per workspace on sites, on the bytes of photos and files, and on publishes a day. Before this, the only caps were leads per hour and
-- mail or SMS per day (migrations 7 and 8). Each new cap is built the same way as those:
--  1. a platform_limits row holds the platform value; a workspace_limits row (staff only) replaces it for one workspace; private.limit_for
--     reads the one that applies. The three defaults have no source: they are the head's choice 2026-11-12, changeable as data:
--       sites_workspace 25 (a main site plus agent or campaign sites stays far under it; the alerts fixture holds 18 in one workspace),
--       media_mb_workspace 200 (MB, so the int can later pass 2 GiB; five workspaces fill the present 1 GB of Storage),
--       publishes_per_day_workspace 100 (a UTC day; a publish every 5 minutes of an 8-hour day).
--  2. one BEFORE INSERT trigger per table counts on the workspace-first indexes (sites_ws, media_ws, publish_jobs_ws) and refuses with
--     S-LIMIT in plain words that name the number and the thing (_shared/db.ts passes exactly those words on, 409). Sites are inserted
--     directly by the service role, every media row comes from service.record_media and every publish job from service.start_publish, so a
--     trigger is one wall on every path. The bytes are media.bytes: the declared size of an upload until the runner's processed total
--     replaces it; Storage's own sizes are not read.
-- Trigger functions: security definer, search_path = '', no grant (migration 8's default privileges close a new function to PUBLIC).
-- Tests: tenancy.test.sql T47 and run-local.mjs mutants "limits41: ...".
set lock_timeout = '5s';

insert into public.platform_limits (key, value, note) values
  ('sites_workspace', 25, 'the head''s choice 2026-11-12, changeable as data; staff raise it per workspace in workspace_limits'),
  ('media_mb_workspace', 200, 'the head''s choice 2026-11-12, changeable as data; staff raise it per workspace in workspace_limits'),
  ('publishes_per_day_workspace', 100, 'the head''s choice 2026-11-12, changeable as data; staff raise it per workspace in workspace_limits');

-- ---------- S: sites per workspace ----------
create function private.limit_sites() returns trigger language plpgsql security definer set search_path = '' as $$
declare cap int;
begin
  cap := private.limit_for(new.workspace_id, 'sites_workspace');
  if cap is not null and (select count(*) from public.sites s where s.workspace_id = new.workspace_id) >= cap then
    raise exception 'S-LIMIT: this workspace has reached its limit of % sites', cap; end if;
  return new;
end $$;
create trigger sites_limit before insert on public.sites for each row execute function private.limit_sites();

-- ---------- M: MB of photos and files per workspace (the new file's own bytes count) ----------
create function private.limit_media() returns trigger language plpgsql security definer set search_path = '' as $$
declare cap int;
begin
  cap := private.limit_for(new.workspace_id, 'media_mb_workspace');
  if cap is not null and (select coalesce(sum(m.bytes), 0) from public.media m where m.workspace_id = new.workspace_id) + coalesce(new.bytes, 0) > cap::bigint * 1048576 then
    raise exception 'S-LIMIT: this workspace has reached its limit of % MB of photos and files', cap; end if;
  return new;
end $$;
create trigger media_limit before insert on public.media for each row execute function private.limit_media();

-- ---------- P: publishes per workspace and UTC day (fires before publish_jobs_ready: triggers run in name order) ----------
create function private.limit_publishes() returns trigger language plpgsql security definer set search_path = '' as $$
declare cap int;
begin
  cap := private.limit_for(new.workspace_id, 'publishes_per_day_workspace');
  if cap is not null and (select count(*) from public.publish_jobs j where j.workspace_id = new.workspace_id and j.created_at >= date_trunc('day', now())) >= cap then
    raise exception 'S-LIMIT: this workspace has reached its limit of % publishes today', cap; end if;
  return new;
end $$;
create trigger publish_jobs_limit before insert on public.publish_jobs for each row execute function private.limit_publishes();
