// Run the migration and the tenancy tests on a throwaway local Postgres cluster (no Supabase account needed).
//   node supabase/tests/run-local.mjs [--keep] [--shim <file>] [--only <mutant name substring>] [--tests <sql file>]
// Needs initdb/pg_ctl/psql on PATH (Postgres 15+). The shim (default local-shim.sql) models Supabase's defaults.
// Then runs each MUTANT (one wall removed from a copy of the migration) and requires the tests to fail: a wall whose
// mutant passes has no test. Exit 0 = tests pass on the real migration AND every mutant is caught.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { qualify } from './qualify.mjs';
// 5-H: the cluster folder is guarded (stopped and removed on every exit path; swept at start when an earlier run was killed)
import { guardedTemp, sweep } from '../../tools/proc-guard/index.mjs';
// 5-PORT: the port block, the listen pin and the bind fallback live in one module for every test cluster
import { startOnBlock } from './lib/cluster-port.mjs';
// a mutant that can never run (a missing comma, an entry in the wrong list) and a run of none are FAILs, never a quiet green
import { mutantListProblems, noneRanProblem } from './lib/mutant-lists.mjs';
// a failing real migration is named (file, line, the whole database error) on the last lines, the only ones CI keeps
import { whereFailed, failedLine } from './lib/real-failure.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');   // every migration, in file-name order, as Supabase applies them
const SHIM = arg('--shim') ? resolve(arg('--shim')) : join(HERE, 'local-shim.sql');
const ONLY = arg('--only');
const TESTS = arg('--tests') ? resolve(arg('--tests')) : join(HERE, 'tenancy.test.sql');   // --tests: another SQL file (crm-scale.sql, work order 01)
let PORT;   // set once the cluster is up: a port of this harness's block (lib/cluster-port.mjs)
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 120000, ...opts });

// Read every input ONCE at the start, so editing files during a run cannot mix versions.
const migrationFiles = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
const migrationParts = migrationFiles.map(f => [f, readFileSync(join(MIGRATIONS_DIR, f), 'utf8')]);
const src = migrationParts.map(([f, t]) => `-- >>> ${f}\n` + t).join('\n');
const shimText = readFileSync(SHIM, 'utf8');
const testText = readFileSync(TESTS, 'utf8');

sweep();
const guard = guardedTemp('omnikom-pg-', 'cluster', { label: 'run-local' });
const dir = guard.dir;
const data = join(dir, 'data');
// Starting the cluster gets 10 minutes: on 2026-10-31 a bare initdb took 123 s on the loaded laptop and the 120 s limit killed the
// whole wall gate before a single test ran (combined 5.1/6A/6B tree). The per-statement limit below stays 120 s.
const START_MS = 600000;
let r = run('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], { timeout: START_MS });
if (r.status !== 0) { console.error('initdb failed:', r.stderr || r.error); process.exit(2); }
const started = startOnBlock('run-local', { data, log: join(dir, 'pg.log'), run, opts: { timeout: START_MS } });
if (!started.ok) { console.error('pg_ctl start failed:', started.stderr, started.log); process.exit(2); }
PORT = String(started.port);
for (const [n, t] of [['shim.sql', shimText], ['tests.sql', testText]]) writeFileSync(join(dir, n), t);

const psql = (db, file) => run('psql', ['-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file]);
const sqlOn = (db, cmd) => run('psql', ['-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', db, '-q', '-t', '-A', '-c', cmd]);
// A child that could not run at all (spawn error, timeout) has null output: say why instead of crashing on null.
const outOf = x => `${x.stdout ?? ''}${x.stderr ?? ''}${x.error ? `\n(${x.error.code || x.error.message})` : ''}`.trim();
const pgLogTail = (n = 15) => { try { return readFileSync(join(dir, 'pg.log'), 'utf8').trim().split(/\r?\n/).slice(-n).join('\n'); } catch { return '(no pg.log)'; } };
// Work order 13: local Postgres has no pg_cron. This stand-in (the test harness, never a migration) has cron.schedule(text, text, text) record its
// arguments, one row per job name like pg_cron's named form, so migration 19's call can be asserted (tenancy.test.sql T25).
const CRON_STUB = `create schema cron;
create table cron.stub_jobs (jobname text primary key, schedule text not null, command text not null);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as
  $$ insert into cron.stub_jobs values (job_name, schedule, command) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;
`;
const fresh = (name, migrationText) => {
  sqlOn('postgres', `create database ${name}`);
  const m = join(dir, `${name}.sql`);
  writeFileSync(m, migrationText);
  writeFileSync(join(dir, 'cron-stub.sql'), CRON_STUB);
  for (const f of [join(dir, 'shim.sql'), join(dir, 'cron-stub.sql'), m]) { const x = psql(name, f); if (x.status !== 0) return { setup: false, out: outOf(x) }; }
  const t = psql(name, join(dir, 'tests.sql'));
  return { setup: true, ok: t.status === 0, out: outOf(t) };
};
// Every mutant database is dropped after its run (and its SQL file deleted): 215 kept databases filled a CI runner's disk once
// (run 41187071384 attempt 1: the walls died mid-run, then the next gate could not write a file). Only `real` stays until the end.
// WITH (FORCE): on 2026-10-31 (5.3 combined tree, loaded laptop) one mutant database survived its drop and the gate failed with no
// reason; a backend still attached (a psql killed at its time limit) makes a plain drop fail. The drop is checked, retried once,
// and a failure names the database and the server's answer.
const done = (name) => {
  let x = sqlOn('postgres', `drop database if exists ${name} with (force)`);
  if (x.status !== 0) x = sqlOn('postgres', `drop database if exists ${name} with (force)`);
  if (x.status !== 0) console.log(`DROP FAILED ${name}: ${outOf(x).slice(0, 300)}`);
  rmSync(join(dir, `${name}.sql`), { force: true });
};

// The walls, each removed in one mutant. Every target must exist in the migration (as written, or schema-qualified: since
// migration 8 every SECURITY DEFINER function exists twice in the migration text, the original and its qualified copy with
// search_path = ''; a mutant removes the wall from both copies, through the same qualify() that wrote migration 8).
const MUTANTS = [
  ['RLS read wall on content_rows', 'create policy rows_read on content_rows for select to authenticated using (private.can_see(workspace_id));', 'create policy rows_read on content_rows for select to authenticated using (true);'],
  ['RLS read wall on content_versions', 'create policy versions_read on content_versions for select to authenticated using (private.can_see(workspace_id));', 'create policy versions_read on content_versions for select to authenticated using (true);'],
  ['RLS on workspaces', 'create policy ws_read on workspaces for select to authenticated using (private.can_see(id));', 'create policy ws_read on workspaces for select to authenticated using (true);'],
  ['media insert wall', "create policy media_insert on media for insert to authenticated with check (private.can_see(workspace_id) and uploaded_by = (select auth.uid()));", "create policy media_insert on media for insert to authenticated with check (true);"],
  ['leads read wall', "create policy leads_read on leads for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner'", "create policy leads_read on leads for select to authenticated using (true or private.my_role(workspace_id) = 'owner'"],
  // Step C (20261029000002_crm.sql): status and owner change only through service.lead_update, which writes the timeline.
  ['member cannot reassign a lead (lead_update)', "    if not staff and role = 'member' then raise exception 'S-OWN-ONLY: members cannot hand a lead to someone else'; end if;", "    null;"],
  ['lead_update needs to see the lead', "  if not coalesce(staff or role = 'owner' or (role = 'member' and l.owner_team_row = mine), false) then raise exception 'S-NOT-FOUND: not found'; end if;", "  null;"],
  ['no direct status update (grant removed)', "revoke update on leads from authenticated;\ndrop policy leads_update on leads;", "-- (grant kept)"],
  ['status change writes its event', "values (p_lead, l.workspace_id, 'status', me,", "values (p_lead, l.workspace_id, 'edited', me,"],   // every copy of lead_update, migration 23's the one that stands
  ['new owner must be a team row of the workspace', "    if not exists (select 1 from content_rows c where c.id = p_owner and c.workspace_id = l.workspace_id and c.collection = 'team' and c.deleted_at is null)\n      then raise exception 'S-NOT-FOUND: no such team member'; end if;", "    null;"],
  ['timeline read wall follows the lead', "create policy lead_events_read on lead_events for select to authenticated using (exists (select 1 from leads l where l.id = lead_id));", "create policy lead_events_read on lead_events for select to authenticated using (true);"],
  // Double since migration 4: the early return AND the on-conflict insert; the mutant removes both layers.
  ['a retry stores nothing (idempotency, both layers)', [["    if lid is not null then return lid; end if;    -- a retry of the same submission stores nothing and answers the same id", "    lid := null;"],
    ["    on conflict (site_id, idempotency_key) where idempotency_key is not null do nothing\n", ""]]],
  ['assignee slug resolves inside the workspace only', "      where c.workspace_id = ws and c.collection = 'team' and c.deleted_at is null and v.data ->> 'slug' = p_assignee limit 1;", "      where c.collection = 'team' and c.deleted_at is null and v.data ->> 'slug' = p_assignee order by c.created_at limit 1;"],
  ['received event on capture', "  insert into lead_events (lead_id, workspace_id, kind, detail) values (lid, ws, 'received', jsonb_build_object('form', p_form, 'page', p_page, 'flow', p_flow));", "  null;"],
  ['manual lead: members only to themselves', "  who := case when role = 'member' and not staff then private.my_team_row(ws) else p_owner end;", "  who := p_owner;"],
  ['manual lead needs membership', "  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;\n  if coalesce(p_consent, '') = '' then raise exception 'consent text required'; end if;\n  who :=", "  if coalesce(p_consent, '') = '' then raise exception 'consent text required'; end if;\n  who :="],
  ['api keys are staff-only', "create policy api_keys_staff_read on api_keys for select to authenticated using (private.is_staff());", "create policy api_keys_staff_read on api_keys for select to authenticated using (true);"],
  ['a revoked key is dead', "    and k.revoked_at is null and (k.expires_at is null or k.expires_at > now())", "    and (k.expires_at is null or k.expires_at > now())"],
  // Migration 3 (expansion blocks): add-ons, bookings, messages, webhook inbox, CRM templates.
  ['add-ons: owners and staff only', "  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;\n  insert into add_ons", "  insert into add_ons"],
  // A non-member has a NULL role; "not NULL" is NULL and PL/pgSQL would not raise. Each guard is a wall of its own.
  ['unknown never counts as allowed (lead_update)', "  if not coalesce(staff or role = 'owner' or (role = 'member' and l.owner_team_row = mine), false) then raise exception 'S-NOT-FOUND: not found'; end if;", "  if not (staff or role = 'owner' or (role = 'member' and l.owner_team_row = mine)) then raise exception 'S-NOT-FOUND: not found'; end if;"],
  ['unknown never counts as allowed (can_act_on_lead)', "  select coalesce(private.is_staff() or private.my_role(l.workspace_id) = 'owner'\n      or (private.my_role(l.workspace_id) = 'member' and l.owner_team_row = private.my_team_row(l.workspace_id)), false) $$;", "  select private.is_staff() or private.my_role(l.workspace_id) = 'owner'\n      or (private.my_role(l.workspace_id) = 'member' and l.owner_team_row = private.my_team_row(l.workspace_id)) $$;"],
  ['unknown never counts as allowed (owner checks)', "  select coalesce(private.is_staff() or private.my_role(ws) = 'owner', false) $$;", "  select private.is_staff() or private.my_role(ws) = 'owner' $$;"],
  ['add-on legal states only', "  if not ok then raise exception 'S-ADDON-STATE: % -> % is not allowed', a.state, p_state; end if;", "  -- (removed)"],
  ['add-ons read wall', "create policy add_ons_read on add_ons for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner');", "create policy add_ons_read on add_ons for select to authenticated using (true);"],
  ['no double booking', "    then raise exception 'B-OVERLAP: that team member already has a meeting then'; end if;", "    then null; end if;"],
  ['members book only for themselves', "    raise exception 'S-OWN-ONLY: members book meetings for themselves'; end if;", "    null; end if;"],
  ['booking needs the lead', "  if me is not null and not private.can_act_on_lead(l) then raise exception 'S-NOT-FOUND: not found'; end if;\n  role :=", "  role :="],
  ['booking team row must be of the workspace', "  if not exists (select 1 from content_rows c where c.id = p_with and c.workspace_id = l.workspace_id and c.collection = 'team' and c.deleted_at is null)\n    then raise exception 'S-NOT-FOUND: no such team member'; end if;\n  if p_ends is null", "  if p_ends is null"],
  ['bookings read wall', "  or (private.my_role(workspace_id) = 'member' and with_team_row = private.my_team_row(workspace_id)));", "  or private.is_member(workspace_id));"],
  ['booking legal states only', "  if not ok then raise exception 'B-STATE: % -> % is not allowed', b.state, p_state; end if;", "  -- (removed)"],
  ['SMS needs recorded consent (review 6)', "    if p_channel = 'sms' and not l.sms_consent then raise exception 'M-CONSENT: this person did not agree to text messages'; end if;", "    null;"],
  // Migration 4 (hardening after REVIEW-2026-10-29).
  ['media facts only from the processor (review 3)', 'grant insert (workspace_id, path, uploaded_by, rights_confirmed) on media to authenticated;', 'grant insert on media to authenticated;'],
  ['members only through functions (review 4)', 'revoke insert, update, delete on members from authenticated;', '-- (members grants kept)'],
  ['set_member: team row of the workspace', "  if p_team_row is not null and not exists (select 1 from content_rows c where c.id = p_team_row and c.workspace_id = p_workspace and c.collection = 'team' and c.deleted_at is null)\n    then raise exception 'S-NOT-FOUND: not found'; end if;", ''],
  ['set_member: unknown login is not probed', "  if not exists (select 1 from auth.users u where u.id = p_user) then raise exception 'S-NOT-FOUND: not found'; end if;", ''],
  ['last owner stays (remove)', "  if r = 'owner' and (select count(*) from members m where m.workspace_id = p_workspace and m.role = 'owner') = 1\n    then raise exception 'S-LAST-OWNER: a workspace keeps at least one owner'; end if;\n  delete from members", '  delete from members'],
  ['last owner stays (demote)', "    then raise exception 'S-LAST-OWNER: a workspace keeps at least one owner'; end if;\n  insert into members", '    then null; end if;\n  insert into members'],
  ['one build per site at a time (review 5)', "    then raise exception 'S-JOB-BUSY: another build of this site is running'; end if;", '    then null; end if;'],
  ['published_version never moves backwards (review 5)', 'set published_version = greatest(coalesce(c.published_version, 0), (j.snapshot ->> c.id::text)::int)', 'set published_version = (j.snapshot ->> c.id::text)::int'],
  ['own needs an ownerField (review 12)', "  if member_access = 'own' and owner_field is null then raise exception 'S-CONTRACT", "  if false then raise exception 'S-CONTRACT"],
  ['paused site refuses leads (review 12)', "  if st = 'paused' then raise exception 'S-SITE-PAUSED: this site is paused'; end if;", ''],
  ['bounded lead inputs (review 12)', "check (length(coalesce(name, '')) <= 120 and", "check (true or length(coalesce(name, '')) <= 120 and"],
  ['STOP honoured (review 6)', "    if p_channel = 'sms' and l.sms_stopped_at is not null then raise exception 'M-STOP", "    if false then raise exception 'M-STOP"],
  ['per-workspace daily cap (review 6)', "  if cap_ws is not null and sent_ws >= cap_ws then st := 'blocked'; why := 'daily cap (workspace)'; end if;", ''],
  ['message idempotency (review 6)', '    if ex.id is not null then return query select ex.id, ex.state, ex.error; return; end if;', ''],
  ['message legal transitions (review 6)', "  if not ok then raise exception 'M-STATE: % -> % is not allowed', m.state, p_state; end if;", ''],
  ['repeated callback writes one event (review 6)', '  if m.state = p_state then return; end if;', ''],
  ['owners never move the billing state (review 7)', "    if not private.is_staff() and p_state <> 'cancelled' then raise exception 'S-ROLE: only Omnikom or a payment can change this'; end if;", ''],
  ['re-activation clears paid_until (review 7)', ', cancelled_at = null, paid_until = null', ', cancelled_at = null'],
  ['null claims only for the concierge (review 12)', "  if p_claims is null and p_source <> 'concierge' then raise exception 'S-AUTH", "  if false then raise exception 'S-AUTH"],
  ['booking state needs a login (review 12)', "  if p_claims is null then raise exception 'S-AUTH: a login is needed'; end if;\n  me := service.use_claims(p_claims);\n  select * into b from bookings", "  me := case when p_claims is null then null else service.use_claims(p_claims) end;\n  select * into b from bookings"],
  ['the member a meeting is with may change it (review 12)', 'or (private.my_role(b.workspace_id) = \'member\' and b.with_team_row = private.my_team_row(b.workspace_id))', 'or false'],
  // migration 15 replaces save_crm_template and adds owner to the list: the wall is removed from every copy at once
  ['template field allowlist (review 10)', [["       or (c ->> 'field') !~ '^(name|email|phone|form|page_path|flow|cta|status|created_at|answers\\.[a-z][a-zA-Z0-9_]{0,60})$'", ''],
    ["       or (c ->> 'field') !~ '^(name|email|phone|form|page_path|flow|cta|status|created_at|owner|answers\\.[a-z][a-zA-Z0-9_]{0,60})$'", ''],
    ["       or (c ->> 'field') !~ '^(name|email|phone|form|page_path|flow|cta|status|lead_type|created_at|owner|answers\\.[a-z][a-zA-Z0-9_]{0,60})$'", '']]],   // migration 23's copy (ruling E)
  ['value maps shape (review 10)', "    then raise exception 'T-VALUE-MAPS: value maps must be an object of objects under 64 KB'; end if;", '    then null; end if;'],
  ['secrets anywhere in a connector config (review 10)', 'alter table connectors add constraint connectors_no_secret_in_config check (not private.has_secret_like(config));', 'alter table connectors add constraint connectors_no_secret_in_config check (true);'],
  ['has_secret_like walks nested objects', "      if private.has_secret_like(v) then return true; end if;\n    end loop;\n  elsif jsonb_typeof(j) = 'array'", "    end loop;\n  elsif jsonb_typeof(j) = 'array'"],
  ['secret-looking URLs refused', "    if (j #>> '{}') ~* '://[^/@\\s]+:[^@\\s]+@' or", '    if false or'],
  ['lead deletion: owner or staff (review 9)', "  if not found or not private.is_owner_or_staff(l.workspace_id) then raise exception 'S-NOT-FOUND: not found'; end if;\n  insert into audit_log (workspace_id, actor, action, target, detail) values (l.workspace_id, me, 'lead-delete'", "  insert into audit_log (workspace_id, actor, action, target, detail) values (l.workspace_id, me, 'lead-delete'"],
  ['lead deletion is audited (review 9)', "'lead-delete', p_lead::text", "'lead-removed', p_lead::text"],
  ['workspace index on leads (review 8, T14)', [['create index if not exists leads_ws_created on leads (workspace_id, created_at desc);', ''], ['create index if not exists leads_ws_owner on leads (workspace_id, owner_team_row, created_at desc);', ''],
    // migration 22's indexes also lead with workspace_id, so they go too (else T14 still finds one and the mutant survives: CI 42761845178)
    ['create index leads_dup_email on public.leads (workspace_id, (lower(btrim(email))));', ''], ['create index leads_dup_phone on public.leads (workspace_id, (private.phone_key(phone)));', ''],
    ['create index leads_follow_up on public.leads (workspace_id, follow_up_at) where follow_up_at is not null;', ''],
    // migration 23's two indexes lead with workspace_id as well
    ['create index leads_status on public.leads (workspace_id, status);', ''], ['create index leads_lead_type on public.leads (workspace_id, lead_type);', '']]],
  ['definer functions set search_path (T14)', "create or replace function service.lead_sms_stop(p_lead uuid, p_detail jsonb default '{}') returns void language plpgsql security definer set search_path = '' as $$", "create or replace function service.lead_sms_stop(p_lead uuid, p_detail jsonb default '{}') returns void language plpgsql security definer as $$"],
  ['definer functions pin the empty search_path (migration 8, T14)', "create or replace function service.delete_lead(p_claims jsonb, p_lead uuid, p_reason text default null) returns void language plpgsql security definer set search_path = '' as $$", "create or replace function service.delete_lead(p_claims jsonb, p_lead uuid, p_reason text default null) returns void language plpgsql security definer set search_path = pg_catalog, public as $$"],
  ['default privileges close a new private or service function (migration 8)', 'alter default privileges revoke execute on functions from public;', '-- (PUBLIC keeps EXECUTE on new functions)'],
  ['the function role reaches service functions only (migration 8)', 'grant usage on schema service to omnikom_fn;', 'grant usage on schema service, private to omnikom_fn; grant select on all tables in schema public to omnikom_fn;'],
  ['RLS read wall on sites (T14 loop)', 'create policy sites_read on sites for select to authenticated using (private.can_see(workspace_id));', 'create policy sites_read on sites for select to authenticated using (true);'],
  ['RLS read wall on site_contracts (T14 loop)', 'create policy contracts_read on site_contracts for select to authenticated using (private.can_see(workspace_id));', 'create policy contracts_read on site_contracts for select to authenticated using (true);'],
  ['RLS read wall on media (T14 loop)', 'create policy media_read on media for select to authenticated using (private.can_see(workspace_id));', 'create policy media_read on media for select to authenticated using (true);'],
  ['RLS read wall on publish_jobs (T14 loop)', 'create policy jobs_read on publish_jobs for select to authenticated using (private.can_see(workspace_id));', 'create policy jobs_read on publish_jobs for select to authenticated using (true);'],
  ['RLS read wall on publish_job_events (T14 loop)', 'create policy job_events_read on publish_job_events for select to authenticated using (exists (select 1 from publish_jobs j where j.id = job_id and private.can_see(j.workspace_id)));', 'create policy job_events_read on publish_job_events for select to authenticated using (true);'],
  ['RLS read wall on metrics_snapshots (T14 loop)', 'create policy metrics_read on metrics_snapshots for select to authenticated using (private.can_see(workspace_id));', 'create policy metrics_read on metrics_snapshots for select to authenticated using (true);'],
  ['RLS read wall on audit_log (T14 loop)', "create policy audit_read on audit_log for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner');", 'create policy audit_read on audit_log for select to authenticated using (true);'],
  ['RLS read wall on integrations (T14 loop)', "create policy integrations_read on integrations for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner');", 'create policy integrations_read on integrations for select to authenticated using (true);'],
  ['RLS read wall on staff (T14 loop)', 'create policy staff_read on staff for select to authenticated using (user_id = (select auth.uid()) or private.is_staff());', 'create policy staff_read on staff for select to authenticated using (true);'],
  ['RLS read wall on connectors (T14 loop)', "create policy connectors_read on connectors for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner');", 'create policy connectors_read on connectors for select to authenticated using (true);'],
  ['RLS read wall on crm_templates (T14 loop)', 'create policy crm_templates_read on crm_templates for select to authenticated using (private.can_see(workspace_id));', 'create policy crm_templates_read on crm_templates for select to authenticated using (true);'],
  ['RLS read wall on lead_events (T14 loop)', 'create policy lead_events_read on lead_events for select to authenticated using (exists (select 1 from leads l where l.id = lead_id));', 'create policy lead_events_read on lead_events for select to authenticated using (true);'],
  // Migration 6 (found 2026-10-30 on staging): a site key stored with its workspace is found by the site alone.
  ['site key found by the site alone (migration 6: the old filter back)', "    and case when p_site is null then k.site_id is null and k.workspace_id is not distinct from p_workspace\n             else k.site_id = p_site and (p_workspace is null or k.workspace_id = p_workspace) end", "    and k.site_id is not distinct from p_site and k.workspace_id is not distinct from p_workspace"],
  ['a given workspace narrows a site key lookup (migration 6)', "(p_workspace is null or k.workspace_id = p_workspace) end", "true end"],
  ['no site: platform-wide keys only (migration 6)', "case when p_site is null then k.site_id is null and k.workspace_id is not distinct from p_workspace", "case when p_site is null then k.workspace_id is not distinct from p_workspace"],
  ['SMS quiet hours',"      st := 'blocked'; why := 'quiet hours'; end if;", "      null; end if;"],
  ['daily message cap', "  if cap is not null and sent_today >= cap then st := 'blocked'; why := 'daily cap'; end if;", "  null;"],
  ['messages read wall', "create policy messages_read on messages for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner'\n  or user_id = (select auth.uid()) or (lead_id is not null and exists (select 1 from leads l where l.id = lead_id)));", "create policy messages_read on messages for select to authenticated using (true);"],
  ['no client writes on the expansion tables', "revoke insert, update, delete, truncate, references, trigger on add_ons, connectors, bookings, messages, platform_limits, crm_templates, webhook_events from authenticated;", "grant update on messages to authenticated;"],
  ['webhook: the same provider event once', "    if eid is not null then return eid; end if;", "    eid := null;"],
  ['webhook: workspace from the connector, not the payload', "insert into webhook_events (connector_id, workspace_id, kind, provider_event_id, payload) values (p_connector, ws,", "insert into webhook_events (connector_id, workspace_id, kind, provider_event_id, payload) values (p_connector, coalesce((p_payload ->> 'workspace_id')::uuid, ws),"],
  ['webhook: revoked connector refused', "select workspace_id into ws from connectors where connectors.id = p_connector and state <> 'revoked';", "select workspace_id into ws from connectors where connectors.id = p_connector;"],
  ['webhook inbox staff-only', "create policy webhook_events_staff_read on webhook_events for select to authenticated using (private.is_staff());", "create policy webhook_events_staff_read on webhook_events for select to authenticated using (true);"],
  ['crm template: every column needs a field', "  if bad > 0 then raise exception 'T-COLUMNS: every column needs a header and a field'; end if;", "  -- (removed)"],
  ['crm template: owners and staff only', "  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;\n  if jsonb_typeof(p_columns)", "  if jsonb_typeof(p_columns)"],
  ['crm template update stays in its workspace', "      where id = p_id and workspace_id = p_workspace returning id into tid;", "      where id = p_id returning id into tid;"],
  ['locked fields', "    if not staff then raise exception 'S-LOCKED:", "    if false then raise exception 'S-LOCKED:"],
  ['sign-off for staff', "if p_sign_off is null or p_sign_off ->> 'by' is null or p_sign_off ->> 'ref' is null then", "if false then"],
  ['staff need MFA (aal2)', "and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2' $$;", " $$;"],
  ['own-only for members', "      if owner_field <> 'self' and (owner_val is distinct from private.my_team_row(p_workspace)", "      if false and (owner_val is distinct from private.my_team_row(p_workspace)"],
  ['members-none collections', "if member_access = 'none' or member_access is null then raise", "if false then raise"],
  ['not-a-member check', "  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;   -- outsiders learn nothing", "  -- (membership check removed)"],
  ['row must belong to the workspace', 'where id = p_row and workspace_id = p_workspace and collection = p_collection', 'where id = p_row and collection = p_collection'],
  ['owner field from the login', "      p_data := jsonb_set(p_data, array[owner_field], to_jsonb(private.my_team_row(p_workspace)::text));", "      null;"],
  ['singleton', "    then raise exception 'S-SINGLETON: % has one row; edit it', p_collection; end if;\n  if p_row is null then", "    and false then raise exception 'S-SINGLETON: % has one row; edit it', p_collection; end if;\n  if p_row is null then"],
  ['contract lookup guarded by workspace', 'where workspace_id = ws and active and private.can_see(ws) $$;', 'where workspace_id = ws and active $$;'],
  // Grant walls are double: Supabase's defaults are switched off first AND revoked explicitly. Each mutant removes both layers.
  ['append-only versions (table grants, both layers)', [['alter default privileges in schema public revoke all on tables from anon, authenticated;', '-- (default revoke removed)'], ['revoke insert, update, delete, truncate, references, trigger on all tables in schema public from authenticated;', '-- (revoke removed)']]],
  ['anon has no table rights (both layers)', [['alter default privileges in schema public revoke all on tables from anon, authenticated;', '-- (default revoke removed)'], ['revoke all on all tables in schema public from anon;', '-- (revoke removed)']]],
  // since migration 12 private.save_version is re-created (new signature), after the blanket statements of migrations 1 to 8: the mutant takes away the blanket revoke of
  // every migration AND the two layers that close the new function (the default privileges of migration 8 and migration 12's own revoke)
  ['clients cannot skip the validator (save body private)', [['revoke all on all functions in schema private from public, anon, authenticated;', 'grant execute on all functions in schema private to anon, authenticated;'],
    ['alter default privileges revoke execute on functions from public;', '-- (PUBLIC keeps EXECUTE on new functions)'], ['revoke all on function private.save_version(uuid, text, uuid, jsonb, jsonb, int) from public, anon, authenticated;', 'grant execute on function private.save_version(uuid, text, uuid, jsonb, jsonb, int) to anon, authenticated;']]],
  // Layered: every migration closes the service schema again. The mutant removes the schema-usage wall and EVERY revoke line
  // (split/join replaces all occurrences), so that Postgres's default EXECUTE to PUBLIC is what is left.
  ['service functions closed to clients (all layers)', [['grant usage on schema service to service_role;', 'grant usage on schema service to service_role, anon, authenticated;'],
    ['revoke all on all functions in schema service from public, anon, authenticated;', '-- (service revoke removed)']]],
  ['seed actor must be staff', "if not exists (select 1 from staff where user_id = p_actor) then raise exception 'S-SEED-ACTOR", "if false then raise exception 'S-SEED-ACTOR"],
  ['members publish only their own items', "        raise exception 'S-OWN-ONLY: members publish only their own items';", "        null;"],
  ['publish needs membership', "  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;\n  if coalesce(array_length", "  if coalesce(array_length"],
  ['publish rows must belong to the site', "  if bad > 0 then raise exception 'S-NOT-FOUND", "  if false then raise exception 'S-NOT-FOUND"],
  ['nothing live before done', "  insert into publish_job_events (job_id, state) values (job, 'queued');", "  insert into publish_job_events (job_id, state) values (job, 'queued');\n  update content_rows c set published_version = (req ->> c.id::text)::int where c.id = any(p_rows);"],
  ['failed job publishes nothing', "  if p_state = 'done' then\n    if j.snapshot is null", "  if p_state in ('done', 'failed') and j.snapshot is not null then\n    update content_rows c set published_version = (j.snapshot ->> c.id::text)::int where c.id = any(j.rows);\n  end if;\n  if p_state = 'done' then\n    if j.snapshot is null"],
  ['failed content never ships with the next publish', "  select coalesce(jsonb_object_agg(c.id, c.published_version), '{}') into snap from content_rows c\n    where c.workspace_id = j.workspace_id and c.deleted_at is null and c.published_version is not null;", "  select coalesce(jsonb_object_agg(c.id, (select max(n) from content_versions v where v.row_id = c.id)), '{}') into snap from content_rows c\n    where c.workspace_id = j.workspace_id and c.deleted_at is null;"],
  ['snapshot keeps what is live at build start', "  snap := snap || j.requested;", "  snap := j.requested;"],
  ['rerun ships the frozen snapshot', "  if j.snapshot is not null then return j.snapshot; end if;", "  -- (re-freeze every time)"],
  ['export reads the job snapshot', "join content_versions v on v.row_id = c.id and v.n = (j.snapshot ->> c.id::text)::int", "join content_versions v on v.row_id = c.id and v.n = (select max(n) from content_versions x where x.row_id = c.id)"],
  ['legal job state changes only', "  if not ok then raise exception 'S-JOB-STATE: % -> % is not allowed', j.state, p_state; end if;", "  -- (transition check removed)"],
  ['stale jobs are reaped', "then interval '24 hours' else interval '30 minutes' end loop", "then interval '24 hours' else interval '30 days' end loop"],
  ['reaper counts from the last state change (N2)', "(select max(e.at) from publish_job_events e where e.job_id = pj.id)", "pj.created_at"],
  ['queued jobs may wait 24 hours (N2)', "case when pj.state = 'queued' then interval '24 hours' else interval '30 minutes' end", "interval '30 minutes'"],
  ['done after reap reconciles (N2)', "\n        or (p_state = 'done' and j.state = 'failed' and coalesce(j.gate_report ->> 'reason', '') = 'timeout');", ";"],
  ['unknown never counts as allowed (both layers)', [["  ok := coalesce(ok, false);   -- NULL (unknown) must never count as allowed", "  -- (null guard removed)"], ["coalesce(j.gate_report ->> 'reason', '') = 'timeout'", "j.gate_report ->> 'reason' = 'timeout'"]]],
  ['contract only for members (N1)', "  if not coalesce(private.is_staff() or private.is_member(p_workspace), false) then raise exception 'S-NOT-FOUND: not found'; end if;\n  return (select resolved", "  return (select resolved"],
  ['job records the validated version (N4)', "  select jsonb_object_agg(x.id, x.n) into req from unnest(p_rows, p_versions) x(id, n);", "  select jsonb_object_agg(c.id, (select max(n) from content_versions v where v.row_id = c.id)) into req from content_rows c where c.id = any(p_rows);"],
  ['pinned version must exist (N4)', "    then raise exception 'S-NOT-FOUND: a pinned version does not exist'; end if;", "    then null; end if;"],
  ['seed records its reference (N9)', "jsonb_build_object('by', p_actor, 'ref', p_ref));", "null);"],
  ['no extension functions in public (N10)', "-- gen_random_uuid() is built into Postgres 13+:", "create extension if not exists pgcrypto;\n-- gen_random_uuid() is built into Postgres 13+:"],
  ['vendor function defaults overridden (N10 on real Supabase, migration 5)', 'revoke execute on all functions in schema public from public, anon;', '-- (vendor defaults kept)'],
  ['job error recorded (N13)', "error = coalesce(p_error, error),", ""],
  ['unpublish: owners and staff only (null-guarded, review 1)', "  if not found or not private.is_owner_or_staff(c.workspace_id) then raise exception 'S-NOT-FOUND: not found'; end if;\n  update content_rows set published_version = null", "  update content_rows set published_version = null"],
  ['jobs and leads stream through Realtime', "    alter publication supabase_realtime add table publish_jobs, leads;", "    null;"],
  ['consent required on leads', "if coalesce(p_consent, '') = '' then raise", "if false then raise"],
  ['media key under its workspace', "constraint media_path_in_workspace check (path like workspace_id::text || '/%')", "constraint media_path_in_workspace check (true)"],
  // (retargeted by work order 16: migration 21 drops the insert policy this mutant used to weaken, so it now weakens the read policy; tests: T10)
  ['storage folder must be a visible workspace', "  using (bucket_id = 'media' and private.try_uuid((storage.foldername(name))[1]) is not null and private.can_see(private.try_uuid((storage.foldername(name))[1])));", "  using (bucket_id = 'media');"],
  // Migration 7 (step 3 leftovers): append-only audit, security events, consent ledger, suppressions, lifecycle, quotas, privacy requests.
  ['audit trail append-only for every role (trigger)', [["create trigger audit_log_append_only before update or delete on audit_log for each row execute function private.refuse_change();", ''], ["create trigger audit_log_no_truncate before truncate on audit_log for each statement execute function private.refuse_change();", '']]],
  ['audit trail: service role cannot rewrite it', 'revoke update, delete, truncate on audit_log from service_role;', '-- (service_role keeps update and delete on audit_log)'],
  ['audit trail outlives the tenant (no cascade)', 'alter table audit_log drop constraint audit_log_workspace_id_fkey;', '-- (cascade kept)'],
  ['security events staff-only', 'create policy security_events_staff_read on security_events for select to authenticated using (private.is_staff());', 'create policy security_events_staff_read on security_events for select to authenticated using (true);'],
  ["security events readable by staff (read scoped to the test event's id)", 'create policy security_events_staff_read on security_events for select to authenticated using (private.is_staff());', 'create policy security_events_staff_read on security_events for select to authenticated using (false);'],
  ['security events append-only', 'create trigger security_events_append_only before update or delete on security_events for each row execute function private.refuse_change();', ''],
  ['consent ledger written on capture', '  perform private.record_consent(ws, p_site, lid, p_form, p_page, p_consent, p_sms_consent, p_marketing, p_ip_hash, p_user_agent, null);', ''],
  ['consent ledger written on a manual lead', "  perform private.record_consent(ws, p_site, lid, coalesce(p_form, 'manual'), 'dashboard', p_consent, false, null, null, null, me);", ''],
  ['consent ledger holds the hash of the wording', "encode(sha256(convert_to(p_consent, 'utf8')), 'hex'), coalesce(p_sms, false)", "repeat('0', 64), coalesce(p_sms, false)"],
  ['consent ledger read wall', "create policy consent_ledger_read on consent_ledger for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner');", 'create policy consent_ledger_read on consent_ledger for select to authenticated using (true);'],
  ['consent ledger append-only', 'create trigger consent_ledger_append_only before update or delete on consent_ledger for each row execute function private.refuse_change();', ''],
  ['STOP writes a suppression that outlives the lead', "  if private.address_hash('sms', ph) is not null then perform service.suppress(ws, 'sms', ph, 'stop', 'sms reply', p_lead); end if;", ''],
  ['a suppressed address is refused (record_message)', "  if private.is_suppressed(p_workspace, p_channel::text::suppression_channel, p_to) then raise exception 'M-SUPPRESSED: this address asked for no more messages'; end if;", ''],
  ['suppression lookup normalises the address', "case when p_channel = 'email' then lower(btrim(p_address)) else regexp_replace(regexp_replace(p_address, '[^0-9]', '', 'g'), '^1(?=[0-9]{10}$)', '') end", 'p_address'],
  ['a platform-wide suppression reaches every workspace', '    and (s.workspace_id is null or s.workspace_id = p_workspace)), false) $$;', '    and s.workspace_id = p_workspace), false) $$;'],
  ['suppressions read wall', "create policy suppressions_read on suppressions for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner');", 'create policy suppressions_read on suppressions for select to authenticated using (true);'],
  ['workspace lifecycle: staff only', "  if not private.is_staff() then raise exception 'S-NOT-FOUND: not found'; end if;\n  select * into w from workspaces where id = p_workspace for update;", '  select * into w from workspaces where id = p_workspace for update;'],
  ['workspace lifecycle: legal moves only', "  if not ok then raise exception 'S-WORKSPACE-STATE: % -> % is not allowed', w.state, p_state; end if;", ''],
  ['a suspended workspace takes no leads', "  if wst in ('suspended', 'deleted') then raise exception 'S-WORKSPACE-SUSPENDED: this workspace is suspended'; end if;", ''],
  ['a suspended workspace publishes nothing', "  if wst not in ('trial', 'active') then raise exception 'S-WORKSPACE-STATE: a % workspace publishes nothing', wst; end if;", ''],
  ['a suspended workspace sends nothing', "  if wst in ('suspended', 'deleted') then st := 'blocked'; why := 'workspace suspended'; end if;", ''],
  ['lead quota per workspace', "    raise exception 'S-QUOTA: this workspace reached its hourly lead limit'; end if;", '    null; end if;'],
  ['a workspace value overrides the platform limit', '  select coalesce((select value from workspace_limits where workspace_id = p_workspace and key = p_key), (select value from platform_limits where key = p_key)) $$;', '  select (select value from platform_limits where key = p_key) $$;'],
  ['workspace limits staff-only', 'create policy workspace_limits_staff_read on workspace_limits for select to authenticated using (private.is_staff());', 'create policy workspace_limits_staff_read on workspace_limits for select to authenticated using (true);'],
  ['privacy requests: owner or staff opens one', "  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;\n  if coalesce(btrim(p_subject), '') = ''", "  if coalesce(btrim(p_subject), '') = ''"],
  ['privacy requests: owner or staff moves one', "  if not found or not private.is_owner_or_staff(r.workspace_id) then raise exception 'S-NOT-FOUND: not found'; end if;\n  ok := (r.state, p_state)", "  ok := (r.state, p_state)"],
  ['privacy request legal moves only', "  if not ok then raise exception 'P-STATE: % -> % is not allowed', r.state, p_state; end if;", ''],
  ['privacy request: the 45-day clock', "values (p_workspace, p_kind, btrim(p_subject), h, now() + interval '45 days', me, p_notes, ids)", "values (p_workspace, p_kind, btrim(p_subject), h, now() + interval '450 days', me, p_notes, ids)"],
  ["privacy request lists the person's leads", "    and (lower(btrim(coalesce(l.email, ''))) = lower(btrim(p_subject)) or", '    and (false or'],
  ['privacy requests read wall', "create policy privacy_requests_read on privacy_requests for select to authenticated using (private.is_staff() or private.my_role(workspace_id) = 'owner');", 'create policy privacy_requests_read on privacy_requests for select to authenticated using (true);'],
  // Migration 9 (slice 4.2, 20261031000009_media_and_export.sql): one mutant per raise exception line, per boundary and per grant (T18).
  ['record_media: members and staff only', "  if not coalesce(private.is_staff() or private.is_member(p_workspace), false) then raise exception 'S-NOT-FOUND: not found'; end if;\n  ext := case", "  ext := case"],
  ['record_media: the five allowed types', "  if ext is null then raise exception 'I-MEDIA-TYPE: jpg, png, webp, heic or pdf only'; end if;", "  null;"],
  ['record_media: the size range (raise)', "  if p_bytes is null or p_bytes < 1 or p_bytes > 26214400 then raise exception 'I-MEDIA-SIZE: a file is between 1 byte and 25 MB'; end if;", "  null;"],
  ['record_media: the 25 MB cap', "p_bytes > 26214400 then raise", "p_bytes > 262144000 then raise"],
  ['record_media: at least one byte', "p_bytes < 1 or p_bytes > 26214400", "p_bytes < 0 or p_bytes > 26214400"],
  ['record_media: uploaded_by is the login', "values (mid, p_workspace, mpath, p_bytes, me);", "values (mid, p_workspace, mpath, p_bytes, null);"],
  ['record_media: the upload is audited', "'media-start', mid::text,", "'media-start-off', mid::text,"],
  ['finish_media: unknown media', "  if not found then raise exception 'S-NOT-FOUND: not found'; end if;\n  if not coalesce(private.is_staff() or private.my_role(m.workspace_id) = 'owner'", "  if not coalesce(private.is_staff() or private.my_role(m.workspace_id) = 'owner'"],
  ['finish_media: uploader, owner or staff only', "  if not coalesce(private.is_staff() or private.my_role(m.workspace_id) = 'owner' or (m.uploaded_by = me and private.is_member(m.workspace_id)), false) then raise exception 'S-NOT-FOUND: not found'; end if;\n", ""],
  ['finish_media: the uploader must still be a member', "(m.uploaded_by = me and private.is_member(m.workspace_id))", "(m.uploaded_by = me)"],
  ['finish_media: the tick follows the request', "set rights_confirmed = coalesce(p_rights, false) where", "set rights_confirmed = true where"],
  ['finish_media: never touches the processor facts', "set rights_confirmed = coalesce(p_rights, false) where", "set rights_confirmed = coalesce(p_rights, false), processed = true where"],
  ['finish_media: the finish is audited', "'media-finish', p_media::text,", "'media-finish-off', p_media::text,"],
  ['media_processed: width of at least 1', "  if p_width is null or p_width < 1 then raise exception 'I-MEDIA-SIZE: the processor must report a width of at least 1'; end if;\n", ""],
  ['media_processed: unknown media', "  if not found then raise exception 'S-NOT-FOUND: no such media'; end if;\n  insert into public.audit_log (workspace_id, actor, action, target, detail) values (ws, null", "  insert into public.audit_log (workspace_id, actor, action, target, detail) values (ws, null"],
  ['media_processed: sets processed', "bytes = coalesce(p_bytes, bytes), processed = true", "bytes = coalesce(p_bytes, bytes), processed = false"],
  ['media_processed: sets the width', "set width = p_width, height = p_height", "set width = 1, height = p_height"],
  ['media_for_runner: unknown media', "where m.id = p_media;\n  if not found then raise exception 'S-NOT-FOUND: no such media'; end if;", "where m.id = p_media;"],
  ['media_facts: members and staff only', "  if not coalesce(private.is_staff() or private.is_member(p_workspace), false) then raise exception 'S-NOT-FOUND: not found'; end if;\n  return (select jsonb_build_object('width'", "  return (select jsonb_build_object('width'"],
  ['media_facts: only the named workspace', "from public.media m where m.id = p_media and m.workspace_id = p_workspace);", "from public.media m where m.id = p_media);"],
  ['row_exists: members and staff only', "  if not coalesce(private.is_staff() or private.is_member(p_workspace), false) then raise exception 'S-NOT-FOUND: not found'; end if;\n  return exists (", "  return exists ("],
  ['row_exists: only the named workspace', " and c.workspace_id = p_workspace and c.collection = p_collection", " and c.collection = p_collection"],
  ['row_exists: the collection must match', " and c.collection = p_collection and c.deleted_at is null);", " and c.deleted_at is null);"],
  ['site_for: members and staff only', "  if ws is null or not coalesce(private.is_staff() or private.is_member(ws), false) then raise exception 'S-NOT-FOUND: not found'; end if;\n  return ws;", "  if ws is null then raise exception 'S-NOT-FOUND: not found'; end if;\n  return ws;"],
  ['site_for: unknown site', "  if ws is null or not coalesce(private.is_staff() or private.is_member(ws), false) then raise exception 'S-NOT-FOUND: not found'; end if;\n  return ws;", "  if not coalesce(private.is_staff() or private.is_member(ws), false) then return null; end if;\n  return ws;"],
  ['row_version: members and staff only', "  if not coalesce(private.is_staff() or private.is_member(p_workspace), false) then raise exception 'S-NOT-FOUND: not found'; end if;\n  return query select c.collection, v.data", "  return query select c.collection, v.data"],
  ['row_version: only the named workspace', "where c.id = p_row and c.workspace_id = p_workspace and c.deleted_at is null and v.n = p_n;", "where c.id = p_row and c.deleted_at is null and v.n = p_n;"],
  ['row_version: unknown version', "v.n = p_n;\n  if not found then raise exception 'S-NOT-FOUND: not found'; end if;", "v.n = p_n;"],
  ['export_bundle: unknown job', "  if not found then raise exception 'S-NOT-FOUND: no job'; end if;\n  if j.snapshot is null then raise exception 'S-JOB-STATE: snapshot not frozen'; end if;\n  select * into s", "  if j.snapshot is null then raise exception 'S-JOB-STATE: snapshot not frozen'; end if;\n  select * into s"],
  ['export_bundle: a frozen snapshot only (both layers: published_rows says it too)', [["  if j.snapshot is null then raise exception 'S-JOB-STATE: snapshot not frozen'; end if;\n  select * into s", "  select * into s"], ["  if (select snapshot from publish_jobs where publish_jobs.id = p_job) is null then raise exception 'S-JOB-STATE: snapshot not frozen'; end if;", "  null;"]]],
  ['export_bundle: media of this workspace only', "from public.media m where m.workspace_id = j.workspace_id), '[]'::jsonb));", "from public.media m), '[]'::jsonb));"],
  ['export_bundle: the schema key the factory checks first (migration 10)', "    'schema', 'omnikom-export/1',\n", ''],
  ['job_site: unknown job',"where j.id = p_job;\n  if not found then raise exception 'S-NOT-FOUND: no job'; end if;", "where j.id = p_job;"],
  // the grants of migration 9, both layers each (migration 8's default privileges would hide a missing explicit statement)
  ...['record_media(jsonb, uuid, text, int, text)', 'finish_media(jsonb, uuid, boolean)', 'media_processed(uuid, int, int, boolean, int)', 'media_for_runner(uuid)', 'media_facts(jsonb, uuid, uuid)',
    'row_exists(jsonb, uuid, text, uuid)', 'site_for(jsonb, uuid)', 'row_version(jsonb, uuid, uuid, int)', 'export_bundle(uuid)', 'job_site(uuid)'].flatMap(sig => [
    [`migration 9 closes service.${sig.split('(')[0]} to anon, authenticated, PUBLIC (both layers)`, [['alter default privileges revoke execute on functions from public;', '-- (PUBLIC keeps EXECUTE on new functions)'], [`revoke all on function service.${sig} from public, anon, authenticated;`, '-- (revoke removed)']]],
    [`migration 9 opens service.${sig.split('(')[0]} to the function role (both layers)`, [['alter default privileges in schema service grant execute on functions to service_role, omnikom_fn;', '-- (no default grant)'], [`grant execute on function service.${sig} to omnikom_fn;`, '-- (grant removed)']]],
  ]),
  // Migration 11 (slice 4.6, 20261031000011_publish_ready_wall.sql): the publish-ready wall. Layer one is a trigger on publish_jobs, layer two a
  // trigger on content_rows.published_version; the rules are a SQL port of the REQUIRED rules of contracts/validate.mjs (publish mode).
  ...(() => {
    const T1 = 'create trigger publish_jobs_ready before insert on public.publish_jobs for each row execute function private.check_job_ready();';
    const T2 = 'create trigger content_rows_ready before update of published_version on public.content_rows for each row\n  when (new.published_version is not null and new.published_version is distinct from old.published_version)\n  execute function private.check_version_ready();';
    const NOCON1 = "  if res is null then raise exception 'I-NOT-READY: % no active contract', new.workspace_id; end if;\n  for r in select";
    const NOCON2 = "  if res is null then raise exception 'I-NOT-READY: % no active contract', new.workspace_id; end if;\n  select v.data into d";
    const fns = ['js_truthy(jsonb)', 'publish_empty(jsonb)', 'publish_has_text(jsonb)', 'publish_problems_object(jsonb, text, text, jsonb, jsonb)', 'publish_problems_value(jsonb, text, text, jsonb, jsonb)',
      'publish_problems(jsonb, text, jsonb)', 'check_job_ready()', 'check_version_ready()'];
    return [
      ['publish-ready: layer one, no job for a row that is not ready (insert trigger)', T1, '-- (no insert trigger)'],
      ['publish-ready: layer two, no row goes live at a bare version (update trigger)', T2, '-- (no update trigger)'],
      ['publish-ready: both layers removed together', [[T1, '-- (no insert trigger)'], [T2, '-- (no update trigger)']]],
      ['publish-ready: layer two only fires on a change of version', 'and new.published_version is distinct from old.published_version)', ')'],
      ['publish-ready: layer two lets a row go off the site (new value null)', 'when (new.published_version is not null and', 'when (true and'],
      ['publish-ready: layer one needs an active contract', NOCON1, '  for r in select'],
      ['publish-ready: layer two needs an active contract', NOCON2, '  select v.data into d'],
      ['publish-ready: layer one, a version that does not exist', "    if not found then raise exception 'I-NOT-READY: % version % not found in this workspace', r.row_id, r.n; end if;\n", ''],
      ['publish-ready: layer one, the row is of the job\'s workspace', 'where c.id = r.row_id::uuid and c.workspace_id = new.workspace_id and v.n = r.n::int;', 'where c.id = r.row_id::uuid and v.n = r.n::int;'],
      ['publish-ready: layer two, a version that does not exist', "  if not found then raise exception 'I-NOT-READY: % version % not found', new.id, new.published_version; end if;\n", ''],
      ["publish-ready: empty treats '' as present", "$$ select v is null or v in ('null'::jsonb, '\"\"'::jsonb, '[]'::jsonb) $$;", "$$ select v is null or v in ('null'::jsonb, '[]'::jsonb) $$;"],
      ['publish-ready: empty treats white space as empty', "$$ select v is null or v in ('null'::jsonb, '\"\"'::jsonb, '[]'::jsonb) $$;", "$$ select v is null or v in ('null'::jsonb, '\"\"'::jsonb, '[]'::jsonb) or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '') $$;"],
      ['publish-ready: a required value is a problem', "    if private.js_truthy(p_field -> 'required') then return array[p_path || ' required']; end if;", '    null;'],
      ['publish-ready: a missing optional value is not a problem', "    if private.js_truthy(p_field -> 'required') then return array[p_path || ' required']; end if;", "    return array[p_path || ' required'];"],
      ['publish-ready: seo title required', "      if not private.publish_has_text(v -> 'title') then probs := probs || (p_path || '.title required'); end if;", '      null;'],
      ['publish-ready: seo description required', "      if not private.publish_has_text(v -> 'description') then probs := probs || (p_path || '.description required'); end if;", '      null;'],
      ['publish-ready: seo text is trimmed', "~ '[^\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]'", "~ '.'"],
      ['publish-ready: a section with required fields must be present', "          probs := probs || (p_path || '.' || (x.sec ->> 'id') || ' required');", '          null;'],
      ['publish-ready: a present section is entered', "            probs := probs || private.publish_problems_object(p_types, p_page_type, p_path || '.' || x.k, x.sv, coalesce(s -> 'fields', '{}'::jsonb));", '            null;'],
      ['publish-ready: a group is entered', "      probs := probs || private.publish_problems_object(p_types, p_page_type, p_path, v, coalesce(p_field -> 'of', '{}'::jsonb));", '      null;'],
      ['publish-ready: a list is entered row by row', "        probs := probs || private.publish_problems_object(p_types, p_page_type, p_path || '[' || i || ']', v -> i, coalesce(p_field -> 'of', '{}'::jsonb));", '        null;'],
      ['publish-ready: an open group is not entered', "  elsif t = 'group' and not private.js_truthy(p_field -> 'open') then", "  elsif t = 'group' then"],
      ['publish-ready: a sourced value is unwrapped', "    v := v -> 'value';", '    null;'],
      ['publish-ready: a sourced value needs its source', "and (v ->> 'source') <> ''", 'and true'],
      ['publish-ready: an unknown collection is a problem', "  if jsonb_typeof(c) is distinct from 'object' then return array[p_collection || ' unknown collection']; end if;", '  null;'],
      ...fns.map(sig => [`publish-ready: migration 11 closes private.${sig.split('(')[0]} to anon, authenticated, PUBLIC (both layers)`,
        [['alter default privileges revoke execute on functions from public;', '-- (PUBLIC keeps EXECUTE on new functions)'], [`revoke all on function private.${sig} from public, anon, authenticated;`, '-- (revoke removed)']]]),
    ];
  })(),
  // Migration 12 (slice 5.1, 20261031000012_screens.sql): the database for the four screens. Tests: tenancy.test.sql T20. Run only these: --only screens:
  ...(() => {
    const IP = "    if o[1] in (0, 10, 127) or o[1] >= 224\n       or (o[1] = 100 and o[2] between 64 and 127) or (o[1] = 169 and o[2] = 254) or (o[1] = 172 and o[2] between 16 and 31)\n       or (o[1] = 192 and o[2] = 168) or (o[1] = 192 and o[2] = 0 and o[3] = 0) or (o[1] = 198 and o[2] in (18, 19))\n      then return 'the address must be public, not a private, loopback or link-local number'; end if;";
    const ipWith = (x, y) => ['screens: crm range, ' + x + ' becomes ' + y, IP, IP.replace(x, y)];
    const sigs = ['mark_lead_read(jsonb, uuid)', 'leads_exported(jsonb, uuid, uuid[])', 'set_alerts(jsonb, uuid, text[], boolean)', 'set_crm_webhook(jsonb, uuid, text, text)', 'drafts_waiting(jsonb, uuid)',
      'save_as(jsonb, uuid, text, uuid, jsonb, jsonb, int)'];
    return [
      // 1. S-STALE
      ['screens: S-STALE, the stale check removed', "    elsif newest > p_base then\n", "    elsif false then\n"],
      ['screens: S-STALE, off by one (>= for >)', "    elsif newest > p_base then\n", "    elsif newest >= p_base then\n"],
      ['screens: S-STALE, a new row with a base is accepted', "      if p_base <> 0 then raise exception 'S-STALE: a new item", "      if false then raise exception 'S-STALE: a new item"],
      ['screens: S-STALE, the message names another version', "by someone else', r.id, newest;", "by someone else', r.id, newest + 1;"],
      ['screens: S-STALE, the old save_as stays callable (no drop)', "drop function service.save_as(jsonb, uuid, text, uuid, jsonb, jsonb);", "-- (old signature kept)"],
      ['screens: S-STALE, the old save_version stays (no drop)', "drop function private.save_version(uuid, text, uuid, jsonb, jsonb);", "-- (old signature kept)"],
      // 2. unread leads
      ['screens: lead_reads, mark_lead_read without the readable check', "  if not found or not private.can_act_on_lead(l) then raise exception 'S-NOT-FOUND: not found'; end if;\n  insert into public.lead_reads", "  if not found then raise exception 'S-NOT-FOUND: not found'; end if;\n  insert into public.lead_reads"],
      ['screens: lead_reads, the select policy widened to true', "create policy lead_reads_own on public.lead_reads for select to authenticated using (user_id = (select auth.uid()));", "create policy lead_reads_own on public.lead_reads for select to authenticated using (true);"],
      ['screens: lead_reads, no select policy', "create policy lead_reads_own on public.lead_reads for select to authenticated using (user_id = (select auth.uid()));", "-- (no policy)"],
      ['screens: lead_reads, RLS off', "alter table public.lead_reads enable row level security;", "-- (RLS off)"],
      // two layers each since migration 1 (alter default privileges in schema public revoke all on tables from anon, authenticated): the mutant removes both
      ['screens: lead_reads, write grants kept for authenticated (both layers)', [["alter default privileges in schema public revoke all on tables from anon, authenticated;", "-- (tables open by default)"], ["revoke insert, update, delete, truncate, references, trigger on public.lead_reads from authenticated;", "-- (grants kept)"]]],
      ['screens: lead_reads, anon keeps its grants (both layers)', [["alter default privileges in schema public revoke all on tables from anon, authenticated;", "-- (tables open by default)"], ["revoke all on public.lead_reads from anon;", "-- (kept)"]]],
      ['screens: lead_reads, not in the Realtime publication', "    alter publication supabase_realtime add table public.lead_reads;", "    null;"],
      ['screens: lead_reads, a second mark is not an upsert', "\n    on conflict (lead_id, user_id) do update set read_at = now();", ";"],
      ['screens: lead_reads, marks do not follow a deleted lead', "lead_id uuid not null references public.leads(id) on delete cascade,", "lead_id uuid not null references public.leads(id),"],
      // 3. export events
      ['screens: export, without the readable check', "    if not found or not private.can_act_on_lead(l) then skipped := skipped + 1; continue; end if;", "    if not found then skipped := skipped + 1; continue; end if;"],
      ['screens: export, a lead of another site is recorded', "where public.leads.id = lid and public.leads.site_id = p_site;", "where public.leads.id = lid;"],
      ['screens: export, any caller may name any site', "  if ws is null or not coalesce(private.is_staff() or private.is_member(ws), false) then raise exception 'S-NOT-FOUND: not found'; end if;\n  -- a lead of another site", "  if ws is null then raise exception 'S-NOT-FOUND: not found'; end if;\n  -- a lead of another site"],
      ['screens: export, the event does not say who', "'exported', me, jsonb_build_object('by', me));", "'exported', null, '{}');"],
      ['screens: export, a repeated id is recorded twice', "for lid in select distinct x from unnest(", "for lid in select x from unnest("],
      ['screens: export, not audited', "'leads-export', p_site::text", "'leads-exported', p_site::text"],
      // 4. lead alerts
      ['screens: alerts, without the owner check', "  if ws is null or not private.is_owner_or_staff(ws) then raise exception 'S-NOT-FOUND: not found'; end if;\n  if cardinality(coalesce(p_to", "  if ws is null then raise exception 'S-NOT-FOUND: not found'; end if;\n  if cardinality(coalesce(p_to"],
      ['screens: alerts, no email check', String.raw`    if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v) > 254 then`, "    if false or length(v) > 254 then"],
      ['screens: alerts, not lower-cased', "    v := lower(btrim(coalesce(a, '')));", "    v := btrim(coalesce(a, ''));"],
      ['screens: alerts, not trimmed', "    v := lower(btrim(coalesce(a, '')));", "    v := lower(coalesce(a, ''));"],
      ['screens: alerts, not de-duplicated', "    if not (v = any(clean)) then clean := clean || v; end if;", "    clean := clean || v;"],
      ['screens: alerts, more than ten addresses', "  if cardinality(clean) > 10 then raise exception 'I-EMAIL: at most 10 addresses'; end if;\n", ""],
      ['screens: alerts, the assignee tick is not stored', "alert_assignee = coalesce(p_assignee, alert_assignee) where public.sites.id = p_site;", "alert_assignee = alert_assignee where public.sites.id = p_site;"],
      ['screens: alerts, a null tick is stored as null', "alert_assignee = coalesce(p_assignee, alert_assignee) where public.sites.id = p_site;", "alert_assignee = p_assignee where public.sites.id = p_site;"],
      ['screens: alerts, not audited', "'alerts-set', p_site::text", "'alerts-changed', p_site::text"],
      ['screens: alerts, a site starts with the agent left out', "add column alert_assignee boolean not null default true", "add column alert_assignee boolean not null default false"],
      // 5. the CRM connection
      ['screens: crm, without the owner check', "  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;\n  if p_url is null then", "  if p_url is null then"],
      ['screens: crm, no address check at all', "  why := private.crm_url_problem(p_url);\n  if why is not null then raise exception 'I-URL: %', why; end if;\n", ""],
      ['screens: crm, without the private-host check (numbers)', IP, IP.replace("then return 'the address must be public, not a private, loopback or link-local number'; end if;", "then null; end if;")],
      ['screens: crm, without the private-host check (localhost and private names)', "  if host = 'localhost' or host like '%.localhost' or host like '%.local' or host like '%.internal' then return 'the address must be public, not localhost or a private name'; end if;\n", ""],
      ['screens: crm, other ways to write a number are accepted', String.raw`  if host ~ '(^|\.)0x' or host ~ '\.[0-9]+$' then return`, "  if false then return"],
      ['screens: crm, a number not in four plain parts is accepted', String.raw`    if host !~ '^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$' then return`, "    if false then return"],
      ['screens: crm, plain http is accepted', "  if lower(left(p_url, 8)) <> 'https://' then", "  if false then"],
      ['screens: crm, a login in the address is accepted', "  if position('@' in auth) > 0 then return", "  if false then return"],
      ['screens: crm, no length limit', "  if length(p_url) > 2000 then", "  if false then"],
      ['screens: crm, a space or control character or backslash is accepted', String.raw`  if p_url ~ '[[:space:][:cntrl:]\\]' then`, "  if false then"],
      ['screens: crm, any secret ref is accepted', "  if p_secret_ref is not null and p_secret_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$' then raise exception 'I-SECRET-REF: a name of the secret, not the secret itself'; end if;\n", ""],
      ['screens: crm, the secret goes into the config', "jsonb_build_object('url', p_url), p_secret_ref)", "jsonb_build_object('url', p_url, 'secret', p_secret_ref), p_secret_ref)"],
      ['screens: crm, the audit row carries the ref', "'crm-set', p_workspace::text, jsonb_build_object('removed', false)", "'crm-set', p_workspace::text, jsonb_build_object('removed', false, 'ref', p_secret_ref)"],
      ['screens: crm, a new address drops the ref', "secret_ref = coalesce(excluded.secret_ref, public.integrations.secret_ref)", "secret_ref = excluded.secret_ref"],
      ['screens: crm, no address does not remove the row', "    delete from public.integrations i where i.workspace_id = p_workspace and i.kind = 'crm-webhook';", "    null;"],
      ['screens: crm, the removal is not audited', "      insert into public.audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'crm-set', p_workspace::text, jsonb_build_object('removed', true));", "      null;"],
      ipWith("o[1] in (0, 10, 127)", "o[1] in (0, 127)"), ipWith("o[1] in (0, 10, 127)", "o[1] in (10, 127)"), ipWith("o[1] in (0, 10, 127)", "o[1] in (0, 10)"),
      ipWith("o[1] >= 224", "o[1] > 224"), ipWith("o[2] between 64 and 127", "o[2] between 65 and 127"), ipWith("o[2] between 64 and 127", "o[2] between 64 and 126"),
      ipWith("(o[1] = 169 and o[2] = 254)", "false"), ipWith("o[2] between 16 and 31", "o[2] between 17 and 31"), ipWith("o[2] between 16 and 31", "o[2] between 16 and 30"),
      ipWith("(o[1] = 192 and o[2] = 168)", "false"), ipWith("(o[1] = 192 and o[2] = 0 and o[3] = 0)", "false"), ipWith("(o[1] = 198 and o[2] in (18, 19))", "false"), ipWith("o[2] in (18, 19)", "o[2] in (18)"),
      // 6. drafts waiting
      ['screens: drafts, an agent sees every draft', "or (role = 'member' and contract -> ", "or (role = 'member') or (false and contract -> "],
      ['screens: drafts, a row published at its newest version is waiting', "    and v.n > coalesce(c.published_version, 0)", "    and v.n >= coalesce(c.published_version, 0)"],
      ['screens: drafts, inbox rows are waiting', "    and coalesce(contract -> 'collections' -> c.collection ->> 'kind', '') <> 'inbox'\n", ""],
      ['screens: drafts, deleted rows are waiting', "  where c.workspace_id = ws and c.deleted_at is null\n    and v.n >", "  where c.workspace_id = ws\n    and v.n >"],
      ['screens: drafts, rows of every workspace', "  where c.workspace_id = ws and c.deleted_at is null\n    and v.n >", "  where c.deleted_at is null\n    and v.n >"],
      ['screens: drafts, any caller may name any site', "  if ws is null or not coalesce(staff or role is not null, false) then raise exception 'S-NOT-FOUND: not found'; end if;", "  if ws is null then raise exception 'S-NOT-FOUND: not found'; end if;"],
      ['screens: drafts, the oldest version instead of the newest', "order by x.n desc limit 1) v on true", "order by x.n asc limit 1) v on true"],
      // every new definer function pins the empty search_path (T14 and the check in T20 (g))
      ['screens: private.save_version does not pin the search_path', "returns table (row_id uuid, version int) language plpgsql security definer set search_path = '' as $$\ndeclare\n  def jsonb := private.collection_def(p_workspace, p_collection);\n  r public.content_rows;\n  prev jsonb;\n  newest int;", "returns table (row_id uuid, version int) language plpgsql security definer as $$\ndeclare\n  def jsonb := private.collection_def(p_workspace, p_collection);\n  r public.content_rows;\n  prev jsonb;\n  newest int;"],
      ['screens: service.drafts_waiting does not pin the search_path', "language plpgsql security definer set search_path = '' as $$\ndeclare me uuid; ws uuid; role public.member_role; staff boolean; mine uuid; contract jsonb;", "language plpgsql security definer as $$\ndeclare me uuid; ws uuid; role public.member_role; staff boolean; mine uuid; contract jsonb;"],
      ...['mark_lead_read(p_claims jsonb, p_lead uuid) returns void', 'leads_exported(p_claims jsonb, p_site uuid, p_lead_ids uuid[]) returns int', 'set_alerts(p_claims jsonb, p_site uuid, p_to text[], p_assignee boolean) returns void',
        'set_crm_webhook(p_claims jsonb, p_workspace uuid, p_url text, p_secret_ref text) returns void'].map(h => [`screens: service.${h.split('(')[0]} does not pin the search_path`,
        `create function service.${h} language plpgsql security definer set search_path = '' as $$`, `create function service.${h} language plpgsql security definer as $$`]),
      ['screens: service.save_as does not pin the search_path', "returns table (row_id uuid, version int) language plpgsql security definer set search_path = '' as $$\nbegin\n  perform service.use_claims(p_claims);\n  return query select * from private.save_version(p_workspace, p_collection, p_row, p_data, p_sign_off, p_base);", "returns table (row_id uuid, version int) language plpgsql security definer as $$\nbegin\n  perform service.use_claims(p_claims);\n  return query select * from private.save_version(p_workspace, p_collection, p_row, p_data, p_sign_off, p_base);"],
      // the grants of migration 12, both layers each (migration 8's default privileges would hide a missing explicit statement)
      ...sigs.flatMap(sig => [
        [`screens: migration 12 closes service.${sig.split('(')[0]} to anon, authenticated, PUBLIC (both layers)`, [['alter default privileges revoke execute on functions from public;', '-- (PUBLIC keeps EXECUTE on new functions)'], [`revoke all on function service.${sig} from public, anon, authenticated;`, '-- (revoke removed)']]],
        [`screens: migration 12 opens service.${sig.split('(')[0]} to the function role (both layers)`, [['alter default privileges in schema service grant execute on functions to service_role, omnikom_fn;', '-- (no default grant)'], [`grant execute on function service.${sig} to service_role, omnikom_fn;`, '-- (grant removed)']]],
      ]),
      ...['crm_url_problem(text)', 'save_version(uuid, text, uuid, jsonb, jsonb, int)'].map(sig => [`screens: migration 12 closes private.${sig.split('(')[0]} to anon, authenticated, PUBLIC (both layers)`,
        [['alter default privileges revoke execute on functions from public;', '-- (PUBLIC keeps EXECUTE on new functions)'], [`revoke all on function private.${sig} from public, anon, authenticated;`, '-- (revoke removed)']]]),
    ];
  })(),
  // Migration 13 (slice 5.2, 20261031000013_screens_functions.sql): the Vault secret of the CRM webhook, the test audit row, the invite lookup. Tests: tenancy.test.sql T21. Run only these: --only fn52:
  ...(() => {
    const OWN = "not private.is_owner_or_staff(p_workspace) or not exists (select 1 from public.workspaces w where w.id = p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;\n";
    const own = (after) => OWN + after;
    const noOwner = (after) => "not exists (select 1 from public.workspaces w where w.id = p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;\n" + after;
    const noWs = (after) => "not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;\n" + after;
    const PUT = "  if p_secret is null or length(p_secret) < 32 or length(p_secret) > 200 then raise exception 'I-SECRET-REF: a secret of 32 to 200 characters'; end if;\n";
    const DROP = "  nm := 'crm-webhook-' || p_workspace::text;\n  execute 'delete from vault.secrets where name = $1' using nm;";
    const FIND = "  if p_team_row is not null and not exists (select 1 from public.content_rows c where c.id = p_team_row and c.workspace_id = p_workspace and c.collection = 'team' and c.deleted_at is null)\n    then raise exception 'S-NOT-FOUND: not found'; end if;\n  return (select u.id";
    const TEAM = "c.id = p_team_row and c.workspace_id = p_workspace and c.collection = 'team' and c.deleted_at is null)\n    then raise exception 'S-NOT-FOUND: not found'; end if;\n  return (select u.id";
    const TGT = "  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;\n  -- the secret is pinned";
    const TST = "  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;\n  if p_outcome is null";
    const pins = [
      'crm_secret_put(p_claims jsonb, p_workspace uuid, p_secret text) returns text', 'crm_secret_drop(p_claims jsonb, p_workspace uuid) returns void',
      'crm_target(p_claims jsonb, p_workspace uuid) returns table (url text, secret text)', 'crm_tested(p_claims jsonb, p_workspace uuid, p_outcome text, p_status int, p_host text) returns void',
      'find_login(p_claims jsonb, p_workspace uuid, p_email text, p_team_row uuid default null) returns uuid',
    ];
    const sigs = ['crm_secret_put(jsonb, uuid, text)', 'crm_secret_drop(jsonb, uuid)', 'crm_target(jsonb, uuid)', 'crm_tested(jsonb, uuid, text, int, text)', 'find_login(jsonb, uuid, text, uuid)'];
    return [
      ['fn52: put, without the owner check', own("  if p_secret is null"), noOwner("  if p_secret is null")],
      ['fn52: put, a workspace that does not exist gets a secret', own("  if p_secret is null"), noWs("  if p_secret is null")],
      ['fn52: put, a short secret is accepted', PUT, "  null;\n"],
      ['fn52: put, a very long secret is accepted', "or length(p_secret) > 200 then", "or false then"],
      ['fn52: put, the name is not derived from the workspace', "  nm := 'crm-webhook-' || p_workspace::text;\n  execute 'select id from vault.secrets", "  nm := 'crm-webhook';\n  execute 'select id from vault.secrets"],
      ['fn52: put, a second put makes a second secret', "  if sid is null then\n    execute 'select vault.create_secret", "  if true then\n    execute 'select vault.create_secret"],
      ['fn52: put, a second put does not replace the value', "    execute 'select vault.update_secret($1, $2, $3, $4)' using sid, p_secret, nm, 'CRM webhook signing secret, workspace ' || p_workspace::text;", "    null;"],
      ['fn52: drop, without the owner check', own("  nm := 'crm-webhook-'"), noOwner("  nm := 'crm-webhook-'")],
      ['fn52: drop, a workspace that does not exist is accepted', own("  nm := 'crm-webhook-'"), noWs("  nm := 'crm-webhook-'")],
      ['fn52: drop, every CRM secret is deleted', DROP, "  execute 'delete from vault.secrets where name like ''crm-webhook-%''';"],
      ['fn52: drop, every secret is deleted', DROP, "  execute 'delete from vault.secrets';"],
      ['fn52: drop, nothing is deleted', DROP, "  nm := null;"],
      ['fn52: target, without the owner check', TGT, "  -- the secret is pinned"],
      ['fn52: target, the secret is not pinned to the derived name', " and i.secret_ref = $2' using p_workspace, 'crm-webhook-' || p_workspace::text;", "' using p_workspace;"],
      ['fn52: target, rows of every workspace (both layers)', [["' where i.workspace_id = $1 and i.kind = ''crm-webhook'' and i.secret_ref = $2' using p_workspace, 'crm-webhook-' || p_workspace::text;", "' where i.kind = ''crm-webhook''' using p_workspace;"]]],
      ['fn52: tested, without the owner check', TST, "  if p_outcome is null"],
      ['fn52: tested, any outcome is accepted', "  if p_outcome is null or p_outcome not in ('sent', 'refused', 'failed') then raise exception 'I-OUTCOME: sent, refused or failed'; end if;\n", ""],
      ['fn52: tested, any host text is stored', "case when p_host ~ '^[A-Za-z0-9.-]{1,253}$' then p_host end", "p_host"],
      ['fn52: tested, a host of any length is stored', "'^[A-Za-z0-9.-]{1,253}$'", "'^[A-Za-z0-9.-]+$'"],
      ['fn52: tested, not audited under its name', "values (p_workspace, me, 'crm-test', p_workspace::text,", "values (p_workspace, me, 'crm-tested', p_workspace::text,"],
      ['fn52: tested, the audit row does not say who', "values (p_workspace, me, 'crm-test', p_workspace::text,", "values (p_workspace, null, 'crm-test', p_workspace::text,"],
      ['fn52: find_login, without the owner check', own("  if p_team_row is not null"), noOwner("  if p_team_row is not null")],
      ['fn52: find_login, a workspace that does not exist is accepted', own("  if p_team_row is not null"), noWs("  if p_team_row is not null")],
      ['fn52: find_login, the team row is not checked', FIND, "  return (select u.id"],
      ['fn52: find_login, a team row of another workspace', TEAM, TEAM.replace("c.workspace_id = p_workspace and ", "")],
      ['fn52: find_login, a row that is not a team row', TEAM, TEAM.replace("c.collection = 'team' and ", "")],
      ['fn52: find_login, the email is case sensitive', "where lower(u.email) = lower(btrim(coalesce(p_email, '')))", "where u.email = btrim(coalesce(p_email, ''))"],
      ['fn52: find_login, the email is not trimmed', "lower(btrim(coalesce(p_email, '')))", "lower(coalesce(p_email, ''))"],
      ...pins.map(h => [`fn52: service.${h.split('(')[0]} does not pin the search_path`, `create function service.${h} language plpgsql security definer set search_path = '' as $$`, `create function service.${h} language plpgsql security definer as $$`]),
      ...sigs.flatMap(sig => [
        [`fn52: migration 13 closes service.${sig.split('(')[0]} to anon, authenticated, PUBLIC (both layers)`, [['alter default privileges revoke execute on functions from public;', '-- (PUBLIC keeps EXECUTE on new functions)'], [`revoke all on function service.${sig} from public, anon, authenticated;`, '-- (revoke removed)']]],
        [`fn52: migration 13 opens service.${sig.split('(')[0]} to the function role (both layers)`, [['alter default privileges in schema service grant execute on functions to service_role, omnikom_fn;', '-- (no default grant)'], [`grant execute on function service.${sig} to service_role, omnikom_fn;`, '-- (grant removed)']]],
      ]),
    ];
  })(),
  // Work order 01 (20261103000014_crm_fields.sql): one mutant per wall; tenancy.test.sql T22 must go red on each.
  ['crm14: capture stores the raw answers (no typing)', "  typed := private.typed_answers(ws, p_form, p_answers);   -- migration 14", "  typed := coalesce(p_answers, '{}');   -- migration 14"],
  ['crm14: an undeclared form stores its answers', "  if fields is null or jsonb_typeof(fields) <> 'object' then return '{}'::jsonb; end if;", "  if fields is null or jsonb_typeof(fields) <> 'object' then return coalesce(p_answers, '{}'::jsonb); end if;"],
  ['crm14: a key the form does not declare is stored', "  return out;   -- a key the form does not declare is dropped here, never stored", "  return coalesce(p_answers, '{}'::jsonb) || out;"],
  ['crm14: a required answer may be missing', "      if coalesce((d ->> 'required')::boolean, false) then raise exception 'I-ANSWER %: % is needed', k, coalesce(d ->> 'label', k); end if;", "      null;"],
  ['crm14: a number outside min/max is stored', "    if (p_def ? 'min' and n < (p_def ->> 'min')::numeric) or (p_def ? 'max' and n > (p_def ->> 'max')::numeric) then", "    if false then"],
  ['crm14: a number is stored as text', "    return to_jsonb(n);", "    return to_jsonb(s);"],
  ['crm14: a select value is not checked against its options', "    if jsonb_typeof(p_v) <> 'string' or not ((p_def -> 'options') ? s) then raise exception 'I-ANSWER %: % must be one of the listed choices', p_key, lbl; end if;", "    if jsonb_typeof(p_v) <> 'string' then raise exception 'I-ANSWER %: % must be one of the listed choices', p_key, lbl; end if;"],
  ['crm14: a multi choice is not checked against its options', "      if jsonb_typeof(e) <> 'string' or not ((p_def -> 'options') ? (e #>> '{}')) then", "      if jsonb_typeof(e) <> 'string' then"],
  ['crm14: a single choice takes a list', "  if jsonb_typeof(p_v) in ('array', 'object') then raise exception 'I-ANSWER %: % must be a single value', p_key, lbl; end if;", "  if jsonb_typeof(p_v) = 'object' then raise exception 'I-ANSWER %: % must be a single value', p_key, lbl; end if;"],
  ['crm14: a bad date is stored', "    begin d := s::date; exception when others then raise exception 'I-ANSWER %: % must be a date (year-month-day)', p_key, lbl; end;\n    return to_jsonb(d::text);", "    return to_jsonb(s);"],
  ['crm14: a reference to a row that does not exist is stored (capture)', "    if d ->> 'type' = 'reference' and not private.reference_ok(p_ws, d, v #>> '{}') then", "    if false then"],
  ['crm14: a reference to a row that does not exist is stored (edit)', "      if nv is not null and d ->> 'type' = 'reference' and not private.reference_ok(l.workspace_id, d, nv #>> '{}') then", "      if false then"],
  ['crm14: a tick takes any word', "    raise exception 'I-ANSWER %: % must be ticked or not', p_key, lbl;", "    return 'true'::jsonb;"],
  ['crm14: set_fields, a member edits a lead not theirs', "  if not found or not private.can_act_on_lead(l) then raise exception 'S-NOT-FOUND: not found'; end if;\n  if p_fields is null", "  if not found then raise exception 'S-NOT-FOUND: not found'; end if;\n  if p_fields is null"],
  ['crm14: set_fields, a member changes the owner', "    elsif k = 'owner' then\n      if not staff and role = 'member' then raise exception 'S-OWN-ONLY: members cannot hand a lead to someone else'; end if;", "    elsif k = 'owner' then\n      null;"],
  ['crm14: set_fields, the consent record is editable', "      raise exception 'S-CONSENT: the consent record cannot be edited'; end if;", "      null; end if;"],
  ['crm14: set_fields, a non-editable field is editable', "      if not (d ->> 'editable')::boolean then raise exception 'S-LOCKED: \"%\" cannot be edited', k; end if;", "      null;"],
  ['crm14: set_fields, an edit is not typed', "      nv := private.typed_value(k, d, v);\n", "      nv := v;\n"],
  ['crm14: set_fields, an unknown key is accepted', "      if d is null then raise exception 'I-UNKNOWN: \"%\" is not a field of this lead', left(k, 40); end if;", "      if d is null then d := '{\"type\":\"text\",\"editable\":true}'; end if;"],
  ['crm14: set_fields, a bad status is accepted (both layers)', [["      if jsonb_typeof(v) <> 'string' or private.status_def(l.workspace_id, btrim(v #>> '{}')) is null then\n        raise exception 'I-ANSWER status: Status must be one of this business''s statuses'; end if;", "      null;"], ["      if ins or new.status is distinct from old.status then raise exception 'I-ANSWER status: Status must be one of this business''s statuses'; end if;", "      null;"]]],
  ['crm14: set_fields, writes no edited event', "      insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'edited', me, e);", "      null;"],
  ['crm14: set_fields, an unchanged value writes an event', "    if old is distinct from nv and not (old is null and nv = 'null'::jsonb) then", "    if true then"],
  ['crm14: set_fields, not audited', "values (l.workspace_id, me, 'lead-edit', p_lead::text,", "values (l.workspace_id, me, 'lead-edited', p_lead::text,"],
  ['crm14: lead_list, a member sees every lead', "      and (see_all or (role = 'member' and l.owner_team_row = mine))", "      and (true or (role = 'member' and l.owner_team_row = mine))"],
  ['crm14: lead_list, a non-member reads the workspace (both layers)', [["  if not staff and role is null then   -- not a member", "  if false then   -- not a member"], ["  see_all := staff or role = 'owner';", "  see_all := staff or role = 'owner' or role is null;"]]],
  ['crm14: lead_list, every workspace is listed', "    where l.workspace_id = p_workspace\n", "    where true\n"],
  ['crm14: lead_list, a sort key outside the contract is accepted', "  if not (types ? skey) then raise exception 'S-QUERY: \"%\" is not a column', left(skey, 40); end if;", "  null;"],
  ['crm14: lead_list, a filter key outside the contract is accepted', "    if jsonb_typeof(f) <> 'object' or not (types ? coalesce(f ->> 'field', '')) then raise exception", "    if jsonb_typeof(f) <> 'object' then raise exception"],
  ['crm14: lead_list, a number sorts as text', [["      case when stype = 'number' and jsonb_typeof(x.sv) = 'number' then (x.sv #>> '{}')::numeric end as sn,", "      null::numeric as sn,"], ["      case when stype not in ('number', 'boolean') and skey", "      case when stype not in ('boolean') and skey"]]],
  ['crm14: lead_list, empty sorts first', "      case when sdir = 'asc' then m.sn end asc nulls last,", "      case when sdir = 'asc' then m.sn end asc nulls first,"],
  ['crm14: lead_list, the page size is unbounded', "  if size < 1 or size > 200 then", "  if size < 1 then"],
  ['crm14: lead_list, columns in jsonb order, not form order', "where sc2.workspace_id = p_ws and sc2.active and o.v ->> 'key' = first0.key limit 1), 1000000 + first0.ord) as ord", "where false limit 1), 1000000 + first0.ord) as ord"],
  ['crm14: lead_list, a non-column field is filterable', "    into cols, types from private.lead_columns(p_workspace) c where (c.def ->> 'column')::boolean;", "    into cols, types from private.lead_columns(p_workspace) c;"],
  ['crm14: lead_list, search ignores industry values', "            (select string_agg(a.value, ' ') from jsonb_each_text(l.answers) a)))) > 0)", "            null))) > 0)"],
  ['crm14: lead_list, a filter is ignored', "            where not private.lead_filter_ok(l, types ->> (x ->> 'field'), x))", "            where false)"],
  ['crm14: bulk, a foreign id does not refuse the call (partial write)', "  if seen <> cardinality(ids) then raise exception 'S-NOT-FOUND: not found'; end if;", "  null;"],
  ['crm14: bulk, a member may hand on or delete', "  if p_action in ('owner', 'delete') and not coalesce(staff or role = 'owner', false) then", "  if false then"],
  ['crm14: bulk, delete without the confirm flag', "  if p_action = 'delete' and p_confirm is not true then raise exception 'S-CONFIRM: deleting leads needs the confirm step'; end if;", "  null;"],
  ['crm14: bulk, no audit row per deleted lead', "perform service.delete_lead(p_claims, l.id, 'bulk');", "delete from public.leads where public.leads.id = l.id;"],   // ruling J: the audit row is delete_lead's; a direct delete leaves none
  ['crm14: bulk, more than 500 ids', "  if cardinality(ids) = 0 or cardinality(ids) > 500 then", "  if cardinality(ids) = 0 then"],
  ['crm14: bulk, a bad status is accepted (both layers)', [["    if p_value is null or private.status_def(p_workspace, btrim(p_value)) is null then raise exception 'I-ANSWER status: Status must be one of this business''s statuses'; end if;", "    if p_value is null then raise exception 'I-ANSWER status: no value'; end if;"], ["      if ins or new.status is distinct from old.status then raise exception 'I-ANSWER status: Status must be one of this business''s statuses'; end if;", "      null;"]]],
  ['crm14: bulk, no status event per lead', "values (l.id, l.workspace_id, 'status', me, jsonb_build_object('from', l.status, 'to', st, 'bulk', true));", "values (l.id, l.workspace_id, 'note', me, jsonb_build_object('from', l.status, 'to', st, 'bulk', true));"],
  ...['lead_set_fields(jsonb, uuid, jsonb)', 'lead_list(jsonb, uuid, jsonb)', 'leads_bulk(jsonb, uuid, uuid[], text, text, boolean)'].flatMap(sig => [
    [`crm14: migration 14 closes service.${sig.split('(')[0]} to anon, authenticated, PUBLIC (both layers)`, [['alter default privileges revoke execute on functions from public;', '-- (PUBLIC keeps EXECUTE on new functions)'], [`revoke all on function service.${sig} from public, anon, authenticated;`, '-- (revoke removed)']]],
    [`crm14: migration 14 opens service.${sig.split('(')[0]} to the function role (both layers)`, [['alter default privileges in schema service grant execute on functions to service_role, omnikom_fn;', '-- (no default grant)'], [`grant execute on function service.${sig} to service_role, omnikom_fn;`, '-- (grant removed)']]],
  ]),
  ...['lead_set_fields(p_claims jsonb, p_lead uuid, p_fields jsonb) returns int'].map(h => [`crm14: service.${h.split('(')[0]} does not pin the search_path`, `create or replace function service.${h} language plpgsql security definer set search_path = '' as $$`, `create or replace function service.${h} language plpgsql security definer as $$`]),

  // ---- work order 02 (migration 15): the map's fields, the map, the import, add_lead typed; tests in tenancy.test.sql T23 ----
  ['crm15: add_lead stores the raw answers (F3)', "  typed := private.typed_lead_answers(ws, private.lead_column_defs(ws), p_answers, false);", "  typed := coalesce(p_answers, '{}');"],
  ['crm15: typed answers keep a key the forms do not declare', "      continue;   -- as capture: a key the forms do not declare is dropped, never stored", "      out := out || jsonb_build_object(k, v); continue;"],
  ['crm15: typed answers skip the reference check', "    if d ->> 'type' = 'reference' and not private.reference_ok(p_ws, d, t #>> '{}') then", "    if false then"],
  ['crm15: the import takes a key the forms do not declare', "      if p_strict then raise exception 'I-UNKNOWN: \"%\" is not a field of this lead', left(k, 40); end if;", "      null;"],
  ['crm15: a map may name a field the forms do not have', "  if missing is not null then raise exception 'T-FIELD %: the map names a field this business''s forms do not have', missing; end if;", "  null;"],
  ['crm15: a re-save of a name is not the same row', "      on conflict (workspace_id, name) do update set crm = excluded.crm, direction = excluded.direction, columns = excluded.columns, value_maps = excluded.value_maps, updated_at = now()\n", ''],
  ['crm15: crm_fields, a member reads the fields', "  if not coalesce(staff or role = 'owner', false) then raise exception 'S-OWN-ONLY: only an owner can map the CRM layout'; end if;", "  null;"],
  ['crm15: crm_fields, an outsider is told the workspace exists', "  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;\n  if not coalesce(staff or role = 'owner', false) then raise exception 'S-OWN-ONLY: only an owner can map the CRM layout'; end if;", "  if not coalesce(staff or role = 'owner', false) then raise exception 'S-OWN-ONLY: only an owner can map the CRM layout'; end if;"],
  ['crm15: import, a member imports', "  if not coalesce(staff or role = 'owner', false) then raise exception 'S-OWN-ONLY: only an owner can import leads'; end if;", "  null;"],
  ['crm15: import, an outsider is told the workspace exists', "  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;\n  if not coalesce(staff or role = 'owner', false) then raise exception 'S-OWN-ONLY: only an owner can import leads'; end if;", "  if not coalesce(staff or role = 'owner', false) then raise exception 'S-OWN-ONLY: only an owner can import leads'; end if;"],
  ['crm15: import, another workspace\'s map is used', "  select * into tpl from public.crm_templates t where t.id = p_template and t.workspace_id = p_workspace;", "  select * into tpl from public.crm_templates t where t.id = p_template;"],
  ['crm15: import, more than 5000 rows', "jsonb_array_length(p_rows) not between 1 and 5000 then", "jsonb_array_length(p_rows) < 1 then"],
  ['crm15: import, a real run is the default', "  dry := (o -> 'dry_run') is distinct from 'false'::jsonb;", "  dry := (o -> 'dry_run') = 'true'::jsonb;"],
  ['crm15: import, a real run without the consent tick', "    if (o -> 'consent') is distinct from 'true'::jsonb then raise exception 'I-CONSENT: tick \"These people agreed to be contacted by my business\" to import'; end if;", "    null;"],
  ['crm15: import, any consent value is a tick', "(o -> 'consent') is distinct from 'true'::jsonb", "(o -> 'consent') is null"],
  ['crm15: import, no choice for duplicates is needed', "    if dup is null or dup not in ('skip', 'add') then raise exception 'I-DUPLICATES: choose skip or add for the duplicates'; end if;", "    null;"],
  ['crm15: import, the consent text is not the fixed sentence', "    consent := format('These people agreed to be contacted by my business. Ticked by the owner on %s for the import of the file \"%s\".',", "    consent := format('I agree %s %s',"],
  ['crm15: import, the file name keeps its quotes', "regexp_replace(coalesce(o ->> 'file_name', ''), '[[:cntrl:]\"]', '', 'g')", "regexp_replace(coalesce(o ->> 'file_name', ''), '[[:cntrl:]]', '', 'g')"],
  ['crm15: import, a map naming a field the forms no longer have is used', "  if missing is not null then raise exception 'T-FIELD %: the map names a field this business''s forms no longer have; save the map again', missing; end if;", "  null;"],
  ['crm15: import, a refused row does not refuse a real run (partial write)', "      if not dry then raise exception 'I-IMPORT line % %: %', line, fld, m; end if;   -- all or nothing: one refused row refuses the import\n", ''],
  ['crm15: import, answers are not typed', "      n_answers := private.typed_lead_answers(p_workspace, cols, r -> 'answers', true);", "      n_answers := coalesce(r -> 'answers', '{}');"],
  ['crm15: import, a bad status becomes not-contacted', "        if pick is null then raise exception 'I-ANSWER status: Status must be one of this business''s statuses'; end if;", "        if pick is null then pick := '{\"key\":\"not-contacted\",\"label\":\"Not contacted yet\"}'::jsonb; end if;"],
  ['crm15: import, a lead with no name, email or phone', "      if n_name is null and n_email is null and n_phone is null then raise exception", "      if false then raise exception"],
  ['crm15: import, a lead of the workspace is not a duplicate', "    if ekey is not null and have_e ? ekey then dupe := 'email'; dwith := 'a lead you already have';\n    elsif", "    if false then null;\n    elsif"],
  ['crm15: import, email case matters', "ekey := lower(btrim(n_email));", "ekey := btrim(n_email);"],
  ['crm15: import, a phone is compared as written, not E.164', "pkey := private.phone_key(n_phone);", "pkey := n_phone;"],
  ['crm15: import, a repeat within the file is not a duplicate', "    elsif ekey is not null and seen_e ? ekey then dupe := 'email'; dwith := 'line ' || (seen_e ->> ekey);\n", ''],
  ['crm15: import, duplicates are created on skip', "    elsif dupe is not null and dup = 'skip' then\n      skipped := skipped + 1;\n    else\n", "    else\n"],
  ['crm15: import, the owner column is ignored', "      if team ? lower(btrim(r ->> 'owner')) then n_owner := (team ->> lower(btrim(r ->> 'owner')))::uuid;", "      if false then null;"],
  ['crm15: import, the site is the first by id, not the oldest', "where s.workspace_id = p_workspace order by s.created_at, s.id limit 1;", "where s.workspace_id = p_workspace order by s.id limit 1;"],
  ['crm15: import, no received event per lead', "      insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (lid, p_workspace, 'received', me, jsonb_build_object('import', true, 'form', 'import'));\n", ''],
  ['crm15: import, no consent ledger row per lead', "      perform private.record_consent(p_workspace, site, lid, 'import', 'import', consent, false, '{\"given\":false}'::jsonb, null, null, me);\n", ''],
  ['crm15: import, no audit row for the call', "  insert into public.audit_log (workspace_id, actor, action, target, detail) values (p_workspace, me, 'lead-import', p_template::text,", "  perform (p_workspace, me, 'lead-import', p_template::text,"],
  ...['crm_fields(jsonb, uuid)', 'import_leads(jsonb, uuid, uuid, jsonb, jsonb)'].flatMap(sig => [
    [`crm15: migration 15 closes service.${sig.split('(')[0]} to anon, authenticated, PUBLIC (both layers)`, [['alter default privileges revoke execute on functions from public;', '-- (PUBLIC keeps EXECUTE on new functions)'], [`revoke all on function service.${sig} from public, anon, authenticated;`, '-- (revoke removed)']]],
    [`crm15: migration 15 opens service.${sig.split('(')[0]} to the function role (both layers)`, [['alter default privileges in schema service grant execute on functions to service_role, omnikom_fn;', '-- (no default grant)'], [`grant execute on function service.${sig} to service_role, omnikom_fn;`, '-- (grant removed)']]],
  ]),
  ['crm15: service.crm_fields does not pin the search_path', "create function service.crm_fields(p_claims jsonb, p_workspace uuid) returns jsonb language plpgsql security definer set search_path = '' as $$", "create function service.crm_fields(p_claims jsonb, p_workspace uuid) returns jsonb language plpgsql security definer as $$"],
  ['crm15: service.import_leads does not pin the search_path', "returns jsonb\nlanguage plpgsql security definer set search_path = '' as $$\ndeclare me uuid; staff boolean; role public.member_role; o jsonb", "returns jsonb\nlanguage plpgsql security definer as $$\ndeclare me uuid; staff boolean; role public.member_role; o jsonb"],

  // ---- work order 07 (migration 18): `site` is a filterable key of lead_list; tests in tenancy.test.sql T24 ----
  ['crm18: service.lead_list does not pin the search_path (migrations 14 and 18)', [["create function service.lead_list(p_claims jsonb, p_workspace uuid, p_query jsonb default '{}') returns jsonb language plpgsql security definer set search_path = '' as $", "create function service.lead_list(p_claims jsonb, p_workspace uuid, p_query jsonb default '{}') returns jsonb language plpgsql security definer as $"], ["create or replace function service.lead_list(p_claims jsonb, p_workspace uuid, p_query jsonb default '{}') returns jsonb language plpgsql security definer set search_path = '' as $", "create or replace function service.lead_list(p_claims jsonb, p_workspace uuid, p_query jsonb default '{}') returns jsonb language plpgsql security definer as $"]]],
  ['crm18: the site key is not a filterable key', ",\"page\":\"text\",\"site\":\"text\",\"lead_type\":\"enum\"", ",\"page\":\"text\",\"lead_type\":\"enum\""],
  ['crm18: the site key is not in lead_value', " when 'site' then to_jsonb(l.site_id::text)\n    when 'lead_type'", "\n    when 'lead_type'"],
  ['crm18: the site key reads the workspace, not the site', "when 'site' then to_jsonb(l.site_id::text)", "when 'site' then to_jsonb(l.workspace_id::text)"],
  ['crm18: a site filter reaches across workspaces (both layers)', "    where l.workspace_id = p_workspace\n      and (see_all or", "    where true\n      and (see_all or"],
  ['crm18: an answer named site overwrites the row\'s site', "'owner', 'form', 'page', 'site')", "'owner', 'form', 'page')"],

  // ---- work order 13 (migration 19): the reaper is scheduled; tests in tenancy.test.sql T25 against the cron stand-in above ----
  ['reaper: the schedule call is removed (migration 19)', "    perform cron.schedule('reap-stale-jobs', '*/5 * * * *', 'select service.reap_stale_jobs()');", "    null;"],

  // ---- work order 18 (migration 22): saved views, follow-up, tasks, duplicates; tests in tenancy.test.sql T29. Run only these: --only "crm22" ----
  ...(() => {
    const VS = 'service.view_save', GRANT = (sig, how) => [`crm22: migration 22 ${how === 'close' ? 'closes' : 'opens'} service.${sig.split('(')[0]} to ${how === 'close' ? 'anon, authenticated, PUBLIC' : 'the function role'} (both layers)`,
      how === 'close' ? [['alter default privileges revoke execute on functions from public;', '-- (PUBLIC keeps EXECUTE on new functions)'], [`revoke all on function service.${sig} from public, anon, authenticated;`, '-- (revoke removed)']]
                      : [['alter default privileges in schema service grant execute on functions to service_role, omnikom_fn;', '-- (no default grant)'], [`grant execute on function service.${sig} to service_role, omnikom_fn;`, '-- (grant removed)']]];
    const DUE_FILTER = `      and (not due or l.follow_up_at <= now()\n           or exists (select 1 from public.lead_tasks t where t.lead_id = l.id and t.done_at is null and t.due_at <= now()))`;
    const ORDER = 'order by l.created_at, (l.duplicate_of is not null), l.id';
    return [
      // service.view_save
      ['crm22: view_save, a member shares a view', `  if shared and not owner_ok then raise exception 'S-OWN-ONLY: only an owner shares a view with the business'; end if;`, '  null;'],
      ['crm22: view_save, a member changes the owner\'s shared view', `      if old.user_id is null and not owner_ok then raise exception 'S-OWN-ONLY: only an owner changes a shared view'; end if;`, '      null;'],
      ['crm22: view_save, another person\'s private view is changed', `      if not found or (old.user_id is not null and old.user_id is distinct from me) then raise exception 'S-NOT-FOUND: not found'; end if;`, `      if not found then raise exception 'S-NOT-FOUND: not found'; end if;`],
      ['crm22: view_save, a view of another workspace is changed', `where c.id = vid and c.workspace_id = p_workspace for update;`, `where c.id = vid for update;`],
      ['crm22: view_save, a non-member saves a view', `  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;\n  owner_ok :=`, `  owner_ok :=`],
      ['crm22: view_save, staff with the second factor cannot share', `  owner_ok := coalesce(staff or role = 'owner', false);`, `  owner_ok := coalesce(role = 'owner', false);`],
      ['crm22: view_save, the query is not checked by lead_list\'s code', `known := private.lead_query_check(p_workspace, q) -> 'types';`, `known := private.lead_query_check(p_workspace, '{}'::jsonb) -> 'types';`],
      ['crm22: view_save, a column key is not checked', `    if not (known ? k) and k not in ('follow_up', 'duplicate') then`, `    if false then`],
      ['crm22: view_save, a column may be listed twice', `    if k = any (keys) then raise exception 'I-ANSWER columns: % is listed twice', k; end if;`, `    null;`],
      ['crm22: view_save, any number of columns', `  if jsonb_array_length(cols) > 60 then raise exception 'I-ANSWER columns: At most 60 columns'; end if;`, `  null;`],
      ['crm22: view_save, a column need not be a text', `    if jsonb_typeof(e) <> 'string' then raise exception 'I-ANSWER columns: A column is a key'; end if;`, `    null;`],
      ['crm22: view_save, columns need not be a list', `  if jsonb_typeof(cols) <> 'array' then raise exception 'I-ANSWER columns: Columns are a list of keys'; end if;`, `  null;`],
      ['crm22: view_save, the name length is not checked', `  if length(nm) not between 1 and 60 then raise exception 'I-ANSWER name: A view name is 1 to 60 characters'; end if;`, `  null;`],
      ['crm22: view_save, the name need not be a text', `  if jsonb_typeof(v -> 'name') is distinct from 'string' then raise exception 'I-ANSWER name: A view needs a name'; end if;`, `  null;`],
      ['crm22: view_save, shared need not be a yes or no', `    if jsonb_typeof(v -> 'shared') <> 'boolean' then raise exception 'I-ANSWER shared: Shared is yes or no'; end if;`, `    null;`],
      ['crm22: view_save, the query size is not limited', `  if pg_column_size(q) > 16384 then raise exception 'I-ANSWER query: The query is too large'; end if;`, `  null;`],
      ['crm22: view_save, no limit of 100 views', `  if n > 100 then raise exception 'I-ANSWER views: At most 100 views here, delete one first'; end if;`, `  null;`],
      ['crm22: crm_views, a name may repeat for one person', `create unique index crm_views_name on public.crm_views`, `create index crm_views_name on public.crm_views`],
      ['crm22: crm_views, a name is unique across workspaces', `on public.crm_views (workspace_id, coalesce(user_id, `, `on public.crm_views (coalesce(user_id, `],
      ['crm22: view_save does not pin the search_path', `create function service.view_save(p_claims jsonb, p_workspace uuid, p_view jsonb) returns uuid language plpgsql security definer set search_path = '' as $$`, `create function service.view_save(p_claims jsonb, p_workspace uuid, p_view jsonb) returns uuid language plpgsql security definer as $$`],
      // service.view_delete
      ['crm22: view_delete, a member deletes a shared view', `  if old.user_id is null and not coalesce(staff or role = 'owner', false) then raise exception 'S-OWN-ONLY: only an owner deletes a shared view'; end if;`, `  null;`],
      ['crm22: view_delete, another person\'s private view is deleted', `  if old.user_id is not null and old.user_id is distinct from me then raise exception 'S-NOT-FOUND: not found'; end if;   -- someone else's private view is not there`, `  null;`],
      ['crm22: view_delete, a non-member deletes a shared view', `  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;\n  if old.user_id is not null and old.user_id is distinct from me then`, `  if old.user_id is not null and old.user_id is distinct from me then`],
      // the views table
      ['crm22: crm_views, everyone reads every private view', `  using (private.can_see(workspace_id) and (user_id is null or user_id = (select auth.uid())));`, `  using (private.can_see(workspace_id));`],
      ['crm22: crm_views, any workspace\'s shared views are read', `  using (private.can_see(workspace_id) and (user_id is null or user_id = (select auth.uid())));`, `  using (user_id is null or user_id = (select auth.uid()));`],
      ['crm22: crm_views, logins may write views directly', `revoke insert, update, delete, truncate, references, trigger on public.crm_views from authenticated;`, `grant insert, update, delete on public.crm_views to authenticated;`],
      // follow-up
      ['crm22: lead_follow_up, any lead of the workspace', `  if not found or not private.can_act_on_lead(l) then raise exception 'S-NOT-FOUND: not found'; end if;\n  if p_at is not distinct from l.follow_up_at then return false; end if;`, `  if not found then raise exception 'S-NOT-FOUND: not found'; end if;\n  if p_at is not distinct from l.follow_up_at then return false; end if;`],
      ['crm22: lead_follow_up, an unchanged time is a change', `  if p_at is not distinct from l.follow_up_at then return false; end if;`, `  null;`],
      ['crm22: lead_follow_up, no timeline event', `  insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'follow-up', me, jsonb_build_object('old', l.follow_up_at, 'new', p_at));\n`, ''],
      ['crm22: lead_follow_up, the event has no old time', `jsonb_build_object('old', l.follow_up_at, 'new', p_at)`, `jsonb_build_object('new', p_at)`],
      // tasks
      ['crm22: task_add, any lead of the workspace', `  if not found or not private.can_act_on_lead(l) then raise exception 'S-NOT-FOUND: not found'; end if;\n  if length(tx) not between`, `  if not found then raise exception 'S-NOT-FOUND: not found'; end if;\n  if length(tx) not between`],
      ['crm22: task_add, the text is not trimmed', `tx text := btrim(coalesce(p_text, ''))`, `tx text := coalesce(p_text, '')`],
      ['crm22: task_add, the text length is left to the table', `  if length(tx) not between 1 and 500 then raise exception 'I-ANSWER text: A task is 1 to 500 characters'; end if;`, `  null;`],
      ['crm22: task_add, a lead keeps any number of tasks', `  if (select count(*) from public.lead_tasks t where t.lead_id = p_lead) >= 100 then raise exception 'I-ANSWER tasks: A lead keeps at most 100 tasks'; end if;`, `  null;`],
      ['crm22: task_add, no timeline event', `  insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'task', me, jsonb_build_object('action', 'added', 'task', tid, 'text', tx, 'due', p_due));\n`, ''],
      ['crm22: task_done, any task of the workspace', `  if not found or not private.can_act_on_lead(l) then raise exception 'S-NOT-FOUND: not found'; end if;\n  if p_done is null`, `  if not found then raise exception 'S-NOT-FOUND: not found'; end if;\n  if p_done is null`],
      ['crm22: task_done, done may be empty', `  if p_done is null then raise exception 'I-ANSWER done: Done is yes or no'; end if;`, `  null;`],
      ['crm22: task_done, a finished task is finished again (an event each time)', `  if p_done and tk.done_at is null then`, `  if p_done then`],
      ['crm22: task_done, an open task is reopened again (an event each time)', `  elsif not p_done and tk.done_at is not null then`, `  elsif not p_done then`],
      ['crm22: task_done, no done event', `    insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (tk.lead_id, tk.workspace_id, 'task', me, jsonb_build_object('action', 'done', 'task', p_task, 'text', tk.text));\n`, ''],
      ['crm22: task_done, no reopened event', `    insert into public.lead_events (lead_id, workspace_id, kind, by, detail) values (tk.lead_id, tk.workspace_id, 'task', me, jsonb_build_object('action', 'reopened', 'task', p_task, 'text', tk.text));\n`, ''],
      ['crm22: lead_tasks, the task RLS is opened to the workspace', `create policy lead_tasks_read on public.lead_tasks for select to authenticated using (exists (select 1 from public.leads l where l.id = lead_id));`, `create policy lead_tasks_read on public.lead_tasks for select to authenticated using (private.can_see(workspace_id));`],
      ['crm22: lead_tasks, logins may write tasks directly', `revoke insert, update, delete, truncate, references, trigger on public.lead_tasks from authenticated;`, `grant insert, update, delete on public.lead_tasks to authenticated;`],
      ['crm22: task_add does not pin the search_path', `create function service.task_add(p_claims jsonb, p_lead uuid, p_text text, p_due timestamptz default null) returns uuid language plpgsql security definer set search_path = '' as $$`, `create function service.task_add(p_claims jsonb, p_lead uuid, p_text text, p_due timestamptz default null) returns uuid language plpgsql security definer as $$`],
      // the due and duplicates filters of lead_list
      ['crm22: lead_list, the due filter ignores follow-up dates', `      and (not due or l.follow_up_at <= now()`, `      and (not due or false`],
      ['crm22: lead_list, the due filter ignores tasks', `\n           or exists (select 1 from public.lead_tasks t where t.lead_id = l.id and t.done_at is null and t.due_at <= now()))`, `)`],
      ['crm22: lead_list, the due filter counts finished tasks', `t.done_at is null and t.due_at <= now()))`, `t.due_at <= now()))`],
      ['crm22: lead_list, the due filter counts tasks with no time', `t.done_at is null and t.due_at <= now()))`, `t.done_at is null and (t.due_at <= now() or t.due_at is null)))`],
      ['crm22: lead_list, the due filter counts later tasks', `t.done_at is null and t.due_at <= now()))`, `t.done_at is null and t.due_at >= now()))`],
      ['crm22: lead_list, the due filter counts later follow-ups', `      and (not due or l.follow_up_at <= now()`, `      and (not due or l.follow_up_at >= now()`],
      ['crm22: lead_list, the due flag is never read', `due := coalesce((q ->> 'due')::boolean, false);`, `due := false;`],
      ['crm22: lead_list, the duplicates filter is ignored', `      and (not dups or l.duplicate_of is not null)`, `      and (true or l.duplicate_of is not null)`],
      ['crm22: lead_list, the duplicates flag is never read', `dups := coalesce((q ->> 'duplicates')::boolean, false);`, `dups := false;`],
      ['crm22: lead_list, a member sees the other lead of a duplicate', `when see_all or exists (select 1 from public.leads d where d.id = l.duplicate_of and mine is not null and d.owner_team_row = mine) then l.duplicate_of end as dv`, `when true then l.duplicate_of end as dv`],
      ['crm22: lead_list, "a duplicate" is told only to who sees both leads', `'duplicate', p.duplicate_of is not null`, `'duplicate', p.dv is not null`],
      ['crm22: lead_list, a row has no follow_up', `'follow_up', p.follow_up_at, 'duplicate'`, `'follow_up', null::timestamptz, 'duplicate'`],
      ['crm22: lead_list, due and duplicates may be anything', `  if (q ? 'due' and jsonb_typeof(q -> 'due') <> 'boolean') or (q ? 'duplicates' and jsonb_typeof(q -> 'duplicates') <> 'boolean') then\n    raise exception 'S-QUERY: due and duplicates are true or false'; end if;\n`, ''],
      ['crm22: lead_query_check does not pin the search_path', `create or replace function private.lead_query_check(p_workspace uuid, p_query jsonb) returns jsonb language plpgsql stable security definer set search_path = '' as $$`, `create or replace function private.lead_query_check(p_workspace uuid, p_query jsonb) returns jsonb language plpgsql stable security definer as $$`],
      // the duplicate rule
      ['crm22: duplicates, no trigger (nothing is flagged)', `create trigger leads_duplicate before insert on public.leads for each row execute function private.lead_set_duplicate();`, `-- (no trigger)`],
      ['crm22: duplicates, the flag can be sent in', `new.duplicate_of := private.lead_duplicate_of(new.workspace_id, new.email, new.phone);`, `new.duplicate_of := coalesce(new.duplicate_of, private.lead_duplicate_of(new.workspace_id, new.email, new.phone));`],
      ['crm22: duplicates, the email match is case sensitive', `lower(btrim(l.email)) = lower(btrim(p_email))`, `btrim(l.email) = btrim(p_email)`],
      ['crm22: duplicates, empty emails match', `((coalesce(btrim(p_email), '') <> '' and lower(`, `((lower(`],
      ['crm22: duplicates, the phone match is on the raw text', `private.phone_key(l.phone) = private.phone_key(p_phone)`, `l.phone = p_phone`],
      ['crm22: duplicates, the match crosses workspaces', `  where l.workspace_id = p_ws\n    and ((`, `  where true\n    and ((`],
      ['crm22: duplicates, the newest earlier lead, not the oldest', ORDER, ORDER.replace('l.created_at,', 'l.created_at desc,')],
      ['crm22: duplicates, a flagged lead stands in for its root', ORDER, 'order by l.created_at, l.id'],
      ['crm22: duplicates, the service role cannot write a lead (the phone index)', `grant execute on function private.phone_key(text) to service_role;`, `-- (no grant)`],
      ['crm22: lead_duplicate_of does not pin the search_path', `create function private.lead_duplicate_of(p_ws uuid, p_email text, p_phone text) returns uuid language sql stable security definer set search_path = '' as $$`, `create function private.lead_duplicate_of(p_ws uuid, p_email text, p_phone text) returns uuid language sql stable security definer as $$`],
      ['crm22: lead_set_duplicate does not pin the search_path', `create function private.lead_set_duplicate() returns trigger language plpgsql security definer set search_path = '' as $$`, `create function private.lead_set_duplicate() returns trigger language plpgsql security definer as $$`],
      // grants of the five service functions
      ...['view_save(jsonb, uuid, jsonb)', 'view_delete(jsonb, uuid)', 'lead_follow_up(jsonb, uuid, timestamptz)', 'task_add(jsonb, uuid, text, timestamptz)', 'task_done(jsonb, uuid, boolean)'].flatMap(sig => [GRANT(sig, 'close'), GRANT(sig, 'open')]),
    ];
  })(),

  // work order 08, migration 17: the team list and the removal (tenancy.test.sql T27)
  ...(() => {
    const GUARD = "  if not private.is_owner_or_staff(p_workspace) or not exists (select 1 from public.workspaces w where w.id = p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;\n  return query";
    return [
      ['team17: list_members, a member lists', GUARD, GUARD.replace('not private.is_owner_or_staff(p_workspace)', 'not coalesce(private.is_staff() or private.is_member(p_workspace), false)')],
      ['team17: list_members, staff without the second factor lists', GUARD, GUARD.replace('not private.is_owner_or_staff(p_workspace)', "not coalesce(private.my_role(p_workspace) = 'owner' or exists (select 1 from public.staff s where s.user_id = (select auth.uid())), false)")],
      ['team17: list_members, a workspace that does not exist is told apart', GUARD, GUARD.replace(' or not exists (select 1 from public.workspaces w where w.id = p_workspace)', '')],
      ['team17: list_members, every workspace\'s people', "     where m.workspace_id = p_workspace\n     order by (m.role = 'owner') desc", "     where true\n     order by (m.role = 'owner') desc"],
      ['team17: list_members, owners are not first', "order by (m.role = 'owner') desc, m.created_at, u.email;", "order by m.created_at, u.email;"],
      ['team17: list_members, no team profile name', "(select v.data ->> 'name' from public.content_versions v", "(select v.data ->> 'nom' from public.content_versions v"],
      ['team17: list_members, the id in place of the email', "select m.user_id, u.email::text, m.role,", "select m.user_id, m.user_id::text, m.role,"],
      ['team17: remove_member deletes nothing, so the removed person still reads', "  delete from public.members m where m.workspace_id = p_workspace and m.user_id = p_user;\n  insert into public.audit_log (workspace_id, actor, action, target) values (p_workspace, me, 'member-remove'", "  null;\n  insert into public.audit_log (workspace_id, actor, action, target) values (p_workspace, me, 'member-remove'"],
      ...['list_members(jsonb, uuid)', 'invite_context(jsonb, uuid)'].flatMap(sig => [
        [`team17: migration 17 closes service.${sig.split('(')[0]} to anon, authenticated, PUBLIC (both layers)`, [['alter default privileges revoke execute on functions from public;', '-- (PUBLIC keeps EXECUTE on new functions)'], [`revoke all on function service.${sig} from public, anon, authenticated;`, '-- (revoke removed)']]],
        [`team17: migration 17 opens service.${sig.split('(')[0]} to the function role (both layers)`, [['alter default privileges in schema service grant execute on functions to service_role, omnikom_fn;', '-- (no default grant)'], [`grant execute on function service.${sig} to service_role, omnikom_fn;`, '-- (grant removed)']]],
      ]),
      ['team17: invite_context, a member asks', "  if not private.is_owner_or_staff(p_workspace) or not exists (select 1 from public.workspaces w where w.id = p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;\n  return query\n    select w.name::text,", "  if not coalesce(private.is_staff() or private.is_member(p_workspace), false) or not exists (select 1 from public.workspaces w where w.id = p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;\n  return query\n    select w.name::text,"],
      ['team17: invite_context, another workspace\'s name', "      from public.workspaces w where w.id = p_workspace;\nend $$;", "      from public.workspaces w where w.id <> p_workspace limit 1;\nend $$;"],
      ['team17: invite_context, the inviter has no team name', "coalesce(nullif(btrim((select v.data ->> 'name'", "coalesce(nullif(btrim((select v.data ->> 'nom'"],
      ['team17: invite_context, a workspace that does not exist is told apart', "  if not private.is_owner_or_staff(p_workspace) or not exists (select 1 from public.workspaces w where w.id = p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;\n  return query\n    select w.name::text,", "  if not private.is_owner_or_staff(p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;\n  return query\n    select w.name::text,"],
      ['team17: service.list_members does not pin the search_path', "returns table (user_id uuid, email text, role public.member_role, team_row_id uuid, team_name text, joined_at timestamptz)\nlanguage plpgsql security definer set search_path = '' as $$", "returns table (user_id uuid, email text, role public.member_role, team_row_id uuid, team_name text, joined_at timestamptz)\nlanguage plpgsql security definer as $$"],
    ];
  })(),

  // ---- work order 15 (migration 20): security events are bucketed per source and minute; tests in tenancy.test.sql T26. Run only these: --only "security buckets" ----
  ['security buckets: the bucket lookup is skipped (every call writes a row)', "  if found then return eid; end if;\n  -- 2. a new anonymous bucket past the ceiling", "  -- 2. a new anonymous bucket past the ceiling"],
  ['security buckets: the ceiling is removed (anonymous calls never fold)', "actor = zero and not overflow) >= cap then", "actor = zero and not overflow) < 0 then"],
  ['security buckets: signed-in calls fold too', "if p_actor is null and (select count(*) from public.security_event_counts", "if (select count(*) from public.security_event_counts"],
  ['security buckets: the counts are readable by every signed-in user', 'create policy security_event_counts_staff_read on security_event_counts for select to authenticated using (private.is_staff());', 'create policy security_event_counts_staff_read on security_event_counts for select to authenticated using (true);'],
  ['security buckets: service_role and the function role may write the counts', 'revoke all on security_event_counts from public, anon, authenticated, service_role, omnikom_fn;', 'grant insert, update, delete on security_event_counts to service_role, omnikom_fn;'],
  ['security buckets: fn is out of the key (two functions in one minute share a bucket)', "f text := coalesce(left(p_detail ->> 'fn', 60), '');", "f text := '';"],

  // work order 10 (migration 16): a site's stored audit summaries (tenancy.test.sql T28)
  ['audit16: site_audit, a member reads', "if ws is null or not private.is_owner_or_staff(ws) then raise exception 'S-NOT-FOUND: not found'; end if;\n  select private.audit_row(", "if ws is null or not coalesce(private.is_owner_or_staff(ws) or private.is_member(ws), false) then raise exception 'S-NOT-FOUND: not found'; end if;\n  select private.audit_row("],
  ['audit16: site_audit, any owner of any workspace reads', "if ws is null or not private.is_owner_or_staff(ws) then raise exception 'S-NOT-FOUND: not found'; end if;\n  select private.audit_row(", "if ws is null or not coalesce(private.is_owner_or_staff(ws) or exists (select 1 from public.members m where m.user_id = me and m.role = 'owner'), false) then raise exception 'S-NOT-FOUND: not found'; end if;\n  select private.audit_row("],
  ['audit16: site_audit, staff without MFA reads', "if ws is null or not private.is_owner_or_staff(ws) then raise exception 'S-NOT-FOUND: not found'; end if;\n  select private.audit_row(", "if ws is null or not coalesce(private.my_role(ws) = 'owner' or exists (select 1 from public.staff st where st.user_id = me), false) then raise exception 'S-NOT-FOUND: not found'; end if;\n  select private.audit_row("],
  ['audit16: site_audit, a site that does not exist is told apart for staff', "if ws is null or not private.is_owner_or_staff(ws) then raise exception 'S-NOT-FOUND: not found'; end if;\n  select private.audit_row(", "if not private.is_owner_or_staff(ws) then raise exception 'S-NOT-FOUND: not found'; end if;\n  select private.audit_row("],
  ['audit16: site_audit, latest.preview takes a job without v 1', "where j.site_id = p_site and j.state in ('done', 'failed') and j.gate_report #>> '{audit,v}' = '1' and j.gate_report #>> '{audit,target}' = 'preview'", "where j.site_id = p_site and j.state in ('done', 'failed') and j.gate_report #>> '{audit,target}' = 'preview'"],
  ['audit16: site_audit, latest.production takes a job without v 1', "where j.site_id = p_site and j.state in ('done', 'failed') and j.gate_report #>> '{audit,v}' = '1' and j.gate_report #>> '{audit,target}' = 'production'", "where j.site_id = p_site and j.state in ('done', 'failed') and j.gate_report #>> '{audit,target}' = 'production'"],
  ['audit16: site_audit, latest.preview reads every site', "where j.site_id = p_site and j.state in ('done', 'failed') and j.gate_report #>> '{audit,v}' = '1' and j.gate_report #>> '{audit,target}' = 'preview'", "where j.state in ('done', 'failed') and j.gate_report #>> '{audit,v}' = '1' and j.gate_report #>> '{audit,target}' = 'preview'"],
  ['audit16: site_audit, latest.production reads every site', "where j.site_id = p_site and j.state in ('done', 'failed') and j.gate_report #>> '{audit,v}' = '1' and j.gate_report #>> '{audit,target}' = 'production'", "where j.state in ('done', 'failed') and j.gate_report #>> '{audit,v}' = '1' and j.gate_report #>> '{audit,target}' = 'production'"],
  ['audit16: site_audit, latest is the oldest, not the newest', "order by j.finished_at desc nulls last, j.id desc limit 1;", "order by j.finished_at nulls last, j.id desc limit 1;"],
  ['audit16: site_audit, history holds 11', "limit 10) h;", "limit 11) h;"],
  ['audit16: site_audit, history keeps fails', "private.audit_row(j.id, j.finished_at, j.state, j.gate_report, false) as r", "private.audit_row(j.id, j.finished_at, j.state, j.gate_report, true) as r"],
  ['audit16: site_audit, history picks the 10 oldest', "order by j.finished_at desc nulls last, j.id desc limit 10) h;", "order by j.finished_at nulls last, j.id desc limit 10) h;"],
  ['audit16: site_audit, history is oldest first', "jsonb_agg(h.r order by h.finished_at desc nulls last, h.id desc)", "jsonb_agg(h.r order by h.finished_at nulls last, h.id desc)"],
  ['audit16: site_audit, history reads every site', "where j.site_id = p_site and j.state in ('done', 'failed') order by", "where j.state in ('done', 'failed') order by"],
  ['audit16: site_audit, history lists a job not finished', "where j.site_id = p_site and j.state in ('done', 'failed') order by", "where j.site_id = p_site order by"],
  ['audit16: audit_row, a summary of another version is trusted', "coalesce(p_report #>> '{audit,v}' = '1', false) as v", "coalesce(p_report #>> '{audit,v}' is not null, false) as v"],
  ['audit16: audit_row, target is read without v 1', "'target', case when x.v then x.a ->> 'target' end,", "'target', x.a ->> 'target',"],
  ['audit16: audit_row, pass is read without v 1', "'pass', case when x.v and jsonb_typeof(x.a -> 'pass') = 'boolean' then x.a -> 'pass' end,", "'pass', x.a -> 'pass',"],
  ['audit16: audit_row, counts are read without v 1', "'counts', case when x.v and jsonb_typeof(x.a -> 'counts') = 'object' then x.a -> 'counts' end,", "'counts', x.a -> 'counts',"],
  ...['site_audit(jsonb, uuid)'].flatMap(sig => [
    [`audit16: migration 16 closes service.${sig.split('(')[0]} to anon, authenticated, PUBLIC (both layers)`, [['alter default privileges revoke execute on functions from public;', '-- (PUBLIC keeps EXECUTE on new functions)'], [`revoke all on function service.${sig} from public, anon, authenticated;`, '-- (revoke removed)']]],
    [`audit16: migration 16 opens service.${sig.split('(')[0]} to the function role (both layers)`, [['alter default privileges in schema service grant execute on functions to service_role, omnikom_fn;', '-- (no default grant)'], [`grant execute on function service.${sig} to service_role, omnikom_fn;`, '-- (grant removed)']]],
  ]),
  ['audit16: private.audit_row is open to anon, authenticated, PUBLIC (both layers)', [['alter default privileges revoke execute on functions from public;', '-- (PUBLIC keeps EXECUTE on new functions)'], ['revoke all on function private.audit_row(uuid, timestamptz, public.job_state, jsonb, boolean) from public, anon, authenticated;', '-- (revoke removed)']]],
  ['audit16: service.site_audit does not pin the search_path', "create function service.site_audit(p_claims jsonb, p_site uuid) returns jsonb language plpgsql security definer set search_path = '' as $$", "create function service.site_audit(p_claims jsonb, p_site uuid) returns jsonb language plpgsql security definer as $$"],
  ['audit16: private.audit_row does not pin the search_path', "returns jsonb language sql stable security definer set search_path = '' as $$\n  select jsonb_build_object('job', p_job", "returns jsonb language sql stable security definer as $$\n  select jsonb_build_object('job', p_job"],

  // ---- work order 16 (migration 21): the media bucket's size and type limits, no direct insert; tests in tenancy.test.sql T10 and T30. Run only these: --only "media limits" ----
  ['media limits: the size limit is one byte too high', "file_size_limit = 26214400,", "file_size_limit = 26214401,"],
  ['media limits: one more type is allowed (text/html)', "'image/heic', 'application/pdf']", "'image/heic', 'application/pdf', 'text/html']"],
  ['media limits: one type is missing (application/pdf)', "'image/heic', 'application/pdf']", "'image/heic']"],
  ['media limits: the insert policy is kept', "drop policy media_objects_insert on storage.objects;", ""],

  // ---- work order 20 (migration 23): lead type and status lists as data, the guard, note authors, one domain per site; tests in tenancy.test.sql T31 and the "upgrade" below. Run only these: --only "crm23" ----
  ['crm23: the guard is not on the table', "create trigger leads_guard before insert or update of status, lead_type, status_date, status_who, status_text on public.leads for each row execute function private.lead_guard();", '-- (trigger removed)'],
  ['crm23: the guard accepts a status that is not in the list', "      if ins or new.status is distinct from old.status then raise exception 'I-ANSWER status: Status must be one of this business''s statuses'; end if;", "      null;"],
  ['crm23: the guard accepts a lead type that is not in the list', "  if (ins or new.lead_type is distinct from old.lead_type) and private.lead_type_def(new.workspace_id, new.lead_type) is null then\n    raise exception 'I-ANSWER lead_type: Lead type must be one of this business''s lead types'; end if;", "  null;"],
  ['crm23: a status that needs a date takes none', "        if new.status_date is null then raise exception 'I-ANSWER status_date: % needs a date', def ->> 'label'; end if;", "        null;"],
  ['crm23: a date stays on a status that does not take one', "      else new.status_date := null; end if;", "      end if;"],
  ['crm23: a person is not defaulted to the caller', "          select m.user_id into new.status_who from public.members m where m.workspace_id = new.workspace_id and m.user_id = (select auth.uid()); end if;", "          null; end if;"],
  ['crm23: a status can name a person who is not a member', "        if new.status_who is not null and not exists (select 1 from public.members m where m.workspace_id = new.workspace_id and m.user_id = new.status_who) then\n          raise exception 'I-ANSWER status_who: Pick a member of this business'; end if;", "        null;"],
  ['crm23: a person stays on a status that does not record one', "      else new.status_who := null; end if;", "      end if;"],
  ['crm23: a line stays on a status that does not ask for one', "      else new.status_text := null; end if;", "      end if;"],
  ['crm23: a form\'s fixed lead type is ignored', "      if jsonb_typeof(f -> 'leadType') = 'string' then new.lead_type := f ->> 'leadType';", "      if false then null;"],
  ['crm23: a form\'s leadTypeFrom map is ignored', "        new.lead_type := coalesce(lf -> 'map' ->> v, 'enquiry');", "        new.lead_type := 'enquiry';"],
  ['crm23: a type the list dropped is not replaced by enquiry', "      if private.lead_type_def(new.workspace_id, new.lead_type) is null then new.lead_type := 'enquiry'; end if;\n    end if;", "    end if;"],
  ['crm23: a lead type is read from every business\'s contract', "from public.site_contracts sc where sc.workspace_id = new.workspace_id and sc.active limit 1;\n    if jsonb_typeof(f) = 'object' then", "from public.site_contracts sc where sc.active limit 1;\n    if jsonb_typeof(f) = 'object' then"],
  ['crm23: the lists are read from any business\'s contract', "from (select (select sc.resolved -> 'crm' from public.site_contracts sc where sc.workspace_id = p_ws and sc.active limit 1) as crm) c $$;", "from (select (select sc.resolved -> 'crm' from public.site_contracts sc where sc.active limit 1) as crm) c $$;"],
  ['crm23: spam is not a system status', "    case when p_key = 'spam' then", "    case when p_key = 'never' then"],
  // ruling A: the floor is the four statuses the product had before (an existing business keeps working); each one is a mutant
  ['crm23: a business without a crm block has no not-contacted in its floor', "else '[{\"key\":\"not-contacted\",\"label\":\"Not contacted yet\",\"stage\":\"new\",\"needsDate\":false,\"needsWho\":false,\"needsText\":false},", "else '["],
  ['crm23: the floor has no contacted', "{\"key\":\"contacted\",\"label\":\"Contacted\",\"stage\":\"working\",\"needsDate\":false,\"needsWho\":false,\"needsText\":false},", ""],
  ['crm23: the floor has no qualified', "{\"key\":\"qualified\",\"label\":\"Qualified\",\"stage\":\"working\",\"needsDate\":false,\"needsWho\":false,\"needsText\":false},", ""],
  ['crm23: the floor has no closed', "{\"key\":\"closed\",\"label\":\"Closed\",\"stage\":\"outcome\",\"needsDate\":false,\"needsWho\":false,\"needsText\":false}]'::jsonb end)", "{\"key\":\"qualified\",\"label\":\"Qualified\",\"stage\":\"working\",\"needsDate\":false,\"needsWho\":false,\"needsText\":false}]'::jsonb end)"],
  // ruling J: a bulk delete goes through service.delete_lead (the direct delete of migration 14 and 22 restored, audit row and all)
  ['crm23: bulk, delete restores the direct delete (not through service.delete_lead)', "perform service.delete_lead(p_claims, l.id, 'bulk');", "insert into public.audit_log (workspace_id, actor, action, target, detail) values (l.workspace_id, me, 'lead-delete', l.id::text, jsonb_build_object('reason', 'bulk', 'email_hash', encode(sha256(convert_to(coalesce(l.email, ''), 'utf8')), 'hex'))); delete from public.leads where public.leads.id = l.id;"],
  // ruling E: the import template names the lead type, a file carries it
  ['crm23: a map cannot name the lead type', "status|lead_type|created_at|owner|answers", "status|created_at|owner|answers"],
  ['crm23: import, a lead type that is not in the list is taken', "if n_type is null then raise exception 'I-ANSWER lead_type: Lead type must be one of this business''s lead types'; end if;", "null;"],
  ['crm23: import, the lead type is never read from the row', "where lower(e ->> 'key') = lower(btrim(r ->> 'lead_type')) or lower(e ->> 'label') = lower(btrim(r ->> 'lead_type')) limit 1;", "where false limit 1;"],
  ['crm23: import, the dry run sample has no lead type', "'status', n_status, 'lead_type', n_type,", "'status', n_status,"],
  ['crm23: import, the lead is stored without its lead type', "consent, n_status, n_type, n_owner,", "consent, n_status, 'enquiry', n_owner,"],
  // ruling G: a status change clears the date, person and line the old status carried
  // (the write paths clear what was not sent and keep what was, even when it equals the old value: lead_update, lead_set_fields, leads_bulk; the guard only validates)
  ...[['date', 'nd', 'p_status_date', 'status_date'], ['person', 'nw', 'p_status_who', 'status_who'], ['line', 'nt', "nullif(btrim(p_status_text), '')", 'status_text']].flatMap(([w, v, sent, col]) => [
    [`crm23: lead_update, a status change keeps the old ${w}`, `${v} := ${sent};`, `${v} := coalesce(${sent}, l.${col});`],
    [`crm23: lead_update, a status change clears a ${w} that was sent again`, `${v} := ${sent};`, `${v} := case when ${sent} is not distinct from l.${col} then null else ${sent} end;`]]),
  ...[['date', 'n_sdate', 'status_date', 'date'], ['person', 'n_swho', 'status_who', 'uuid'], ['line', 'n_stext', 'status_text', 'text']].flatMap(([w, v, key, ty]) => [
    [`crm23: lead_set_fields, a status change keeps the old ${w}`, `if not p_fields ? '${key}' then ${v} := null; end if;`, `null;`],
    [`crm23: lead_set_fields, a status change clears a ${w} that was sent again`, `if not p_fields ? '${key}' then ${v} := null; end if;`,
      `if not p_fields ? '${key}' or (p_fields ->> '${key}')::${ty} is not distinct from l.${key} then ${v} := null; end if;`]]),
  ['crm23: bulk, a status change keeps the old person', "status = st, status_who = null, status_text = null where", "status = st, status_text = null where"],
  ['crm23: bulk, a status change keeps the old line', "status = st, status_who = null, status_text = null where", "status = st, status_who = null where"],
  ['crm23: lead_update, a member sets a status on a lead not theirs', "  if not coalesce(staff or role = 'owner' or (role = 'member' and l.owner_team_row = mine), false) then raise exception 'S-NOT-FOUND: not found'; end if;\n  actor := private.actor_kind(p_claims);", "  actor := private.actor_kind(p_claims);"],
  ['crm23: lead_update, a note has no author block', "jsonb_build_object('text', p_note, 'author', jsonb_build_object('kind', actor, 'name', case when actor = 'agent' then 'Agent' else private.person_label(l.workspace_id, me) end)));", "jsonb_build_object('text', p_note));"],
  ['crm23: an AI operator is never recognised', "  select case when p_claims -> 'app_metadata' ->> 'actor' = 'agent' then 'agent' else 'user' end $$;", "  select 'user'::text $$;"],
  ['crm23: a claim outside app_metadata names an agent', "  select case when p_claims -> 'app_metadata' ->> 'actor' = 'agent' then 'agent' else 'user' end $$;", "  select case when p_claims ->> 'actor' = 'agent' or p_claims -> 'app_metadata' ->> 'actor' = 'agent' then 'agent' else 'user' end $$;"],
  ['crm23: a member\'s note does not carry their name', "    (select nullif(btrim(v.data ->> 'name'), '') from public.members m", "    (select null::text from public.members m"],
  ['crm23: the status event has no date', "jsonb_build_object('from', l.status, 'to', r.status, 'date', r.status_date, 'who', r.status_who,", "jsonb_build_object('from', l.status, 'to', r.status, 'who', r.status_who,"],
  ['crm23: lead_set_fields, a bad lead type is stored (both layers)', [["      if jsonb_typeof(v) <> 'string' or private.lead_type_def(l.workspace_id, btrim(v #>> '{}')) is null then\n        raise exception 'I-ANSWER lead_type: Lead type must be one of this business''s lead types'; end if;", "      null;"], ["  if (ins or new.lead_type is distinct from old.lead_type) and private.lead_type_def(new.workspace_id, new.lead_type) is null then\n    raise exception 'I-ANSWER lead_type: Lead type must be one of this business''s lead types'; end if;", "  null;"]]],
  ['crm23: lead_set_fields, a status that is not a member\'s person (both layers)', [["        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'I-ANSWER status_who: Pick a member of this business'; end if;\n        nv := v; n_swho := (v #>> '{}')::uuid;", "        nv := v; n_swho := (v #>> '{}')::uuid;"], ["        if new.status_who is not null and not exists (select 1 from public.members m where m.workspace_id = new.workspace_id and m.user_id = new.status_who) then\n          raise exception 'I-ANSWER status_who: Pick a member of this business'; end if;", "        null;"]]],
  ['crm23: lead_set_fields, the status date is not typed', "      nv := private.typed_value('status_date', '{\"type\":\"date\",\"label\":\"Date\"}', v); old := to_jsonb(l.status_date::text); n_sdate := (nv #>> '{}')::date;", "      nv := v; old := to_jsonb(l.status_date::text); n_sdate := (nv #>> '{}')::date;"],
  ['crm23: lead_set_fields, the line is not limited to 200 characters', "      nv := private.typed_value('status_text', '{\"type\":\"text\",\"max\":200,\"label\":\"Status note\"}', v);", "      nv := private.typed_value('status_text', '{\"type\":\"text\",\"max\":2000,\"label\":\"Status note\"}', v);"],
  ['crm23: bulk, a status that needs a date is set without one', "    if coalesce((private.status_def(p_workspace, st) ->> 'needsDate')::boolean, false) then\n      raise exception 'I-ANSWER status: % needs a date; set it on one lead at a time', private.status_def(p_workspace, st) ->> 'label'; end if;", ""],
  ['crm23: import, a status that needs a date is accepted from a file', "        if coalesce((pick ->> 'needsDate')::boolean, false) then\n          raise exception 'I-ANSWER status: % needs a date, so a file cannot set it; import the lead as Not contacted yet and set it in the CRM', pick ->> 'label'; end if;", ""],
  ['crm23: import, a status is read by its key only', "    (select e from jsonb_array_elements(p_statuses) e where lower(e ->> 'key') = lower(btrim(p_value)) or lower(e ->> 'label') = lower(btrim(p_value)) limit 1),", "    (select e from jsonb_array_elements(p_statuses) e where lower(e ->> 'key') = lower(btrim(p_value)) limit 1),"],
  ['crm23: lead_list, a status sorts by its letters', "case when skey = 'status' then coalesce((srank ->> l.status)::int, 1000) end as ss,", "case when skey = 'status' then ascii(l.status) end as ss,"],
  ['crm23: lead_list, the answer has no lists', ", 'lead_types', lists -> 'lead_types', 'statuses', lists -> 'statuses');", ");"],
  ['crm23: lead_list, a row has no lead type', "'status', p.status, 'lead_type', p.lead_type,", "'status', p.status,"],
  ['crm23: lead_list, a row has no status date', "'status_date', p.status_date, 'status_who'", "'status_who'"],
  ['crm23: a lead type cannot be filtered on', "    when 'lead_type' then to_jsonb(l.lead_type) when 'status_date'", "    when 'lead_type' then null when 'status_date'"],
  ['crm23: the status date is not a date column (no range)', '"status_date":"date"', '"status_date":"text"'],
  ['crm23: lead types are not a column of a saved view', '"lead_type":"enum","status_date"', '"status_date"'],
  ['crm23: the unique domain index is gone', "create unique index sites_domain_unique on public.sites (lower(domain)) where domain is not null;", "-- (index removed)"],
  ['crm23: the unique domain index is case sensitive', "create unique index sites_domain_unique on public.sites (lower(domain)) where domain is not null;", "create unique index sites_domain_unique on public.sites (domain) where domain is not null;"],
  ['crm23: the old lead_status enum is kept', "drop type public.lead_status;", "-- (enum kept)"],
  ...['private.crm_lists(uuid)', 'private.lead_guard()'].map(sig => [`crm23: migration 23 opens ${sig} to anon, authenticated, PUBLIC (both layers)`, [['alter default privileges revoke execute on functions from public;', '-- (PUBLIC keeps EXECUTE on new functions)'], [`revoke all on function ${sig} from public, anon, authenticated;`, '-- (revoke removed)']]]),
  ['crm23: migration 23 opens service.lead_update to anon, authenticated, PUBLIC (both layers)', [['alter default privileges revoke execute on functions from public;', '-- (PUBLIC keeps EXECUTE on new functions)'], ['revoke all on function service.lead_update(jsonb, uuid, text, uuid, text, boolean, date, uuid, text) from public, anon, authenticated;', '-- (revoke removed)']]],
  ['crm23: migration 23 does not open service.lead_update to the function role (both layers)', [['alter default privileges in schema service grant execute on functions to service_role, omnikom_fn;', '-- (no default grant)'], ['grant execute on function service.lead_update(jsonb, uuid, text, uuid, text, boolean, date, uuid, text) to service_role, omnikom_fn;', '-- (grant removed)']]],
  // Work order 37b (migration 26, the Clients department's file): erasure scrubs every copy; the ledger's one erasure update; Storage and keys gate deleted
  ['erasure 26: messages keep the address', "  update public.messages m set to_text = 'erased:' || encode(sha256(convert_to(lower(btrim(m.to_text)), 'utf8')), 'hex'), error = null\n    where m.workspace_id = l.workspace_id and m.to_text not like 'erased:%' and ((em is not null and lower(btrim(m.to_text)) = em) or (re is not null and m.to_text ~ re));", '  null;'],
  ['erasure 26: a number in another layout is missed', "  re := case when ph is null then null else '(^|[^0-9])(1[-. ()+]{0,3})?' || regexp_replace(ph, '([0-9])', '\\1[-. ()+]{0,3}', 'g') || '($|[^0-9])' end;", '  re := ph;'],
  ['erasure 26: another person\'s longer number is erased', "'(^|[^0-9])(1[-. ()+]{0,3})?' || regexp_replace(ph, '([0-9])', '\\1[-. ()+]{0,3}', 'g') || '($|[^0-9])'", "regexp_replace(ph, '([0-9])', '\\1[-. ()+]{0,3}', 'g')"],
  ['erasure 26: an address inside a longer address is erased', "((emr is not null and lower(w.payload::text) ~ emr)", "((em is not null and strpos(lower(w.payload::text), em) > 0)"],
  ['erasure 26: a message to a longer address is erased', "((em is not null and lower(btrim(m.to_text)) = em)", "((em is not null and strpos(lower(m.to_text), em) > 0)"],
  ['erasure 26: webhook payloads keep the address', "  update public.webhook_events w set payload = jsonb_build_object('erased', true), error = null\n    where w.workspace_id = l.workspace_id and ((emr is not null and lower(w.payload::text) ~ emr) or (re is not null and w.payload::text ~ re));", '  null;'],
  ['erasure 26: the ledger keeps the lead and the user agent', "  update public.consent_ledger c set lead_id = null, user_agent = null, marketing = null,\n      email_hash = coalesce(c.email_hash, private.address_hash('email', l.email)), phone_hash = coalesce(c.phone_hash, private.address_hash('sms', l.phone))\n    where c.workspace_id = l.workspace_id and c.lead_id = p_lead;", '  null;'],
  ['erasure 26: the erasure setting stays on', "  perform set_config('omnikom.erasure', 'off', true);\n  delete from public.leads where id = p_lead;", '  delete from public.leads where id = p_lead;'],
  ['erasure 26: the ledger takes any update under the setting', "       and (to_jsonb(new) - array['lead_id', 'user_agent', 'marketing', 'email_hash', 'phone_hash']) = (to_jsonb(old) - array['lead_id', 'user_agent', 'marketing', 'email_hash', 'phone_hash'])", "       and true"],
  ['erasure 26: a set hash may be overwritten', "       and (old.email_hash is null or new.email_hash is not distinct from old.email_hash)", "       and true"],
  ['erasure 26: any role may use the erasure update', "     and current_user = (select pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = tg_relid) then", "     then"],
  ['erasure 26: anyone lists an offboarding workspace\'s files', "  perform service.use_claims(p_claims);\n  if not private.is_staff() then raise exception 'S-NOT-FOUND: not found'; end if;\n  select * into w from public.workspaces where id = p_workspace;\n  if not found", "  perform service.use_claims(p_claims);\n  select * into w from public.workspaces where id = p_workspace;\n  if not found"],
  ['erasure 26: files are listed in any state', "  if w.state <> 'offboarding' then raise exception 'S-WORKSPACE-STATE: % is %: only an offboarding workspace''s files are listed for deletion', w.slug, w.state; end if;", '  null;'],
  ['erasure 26: deleted with files still in Storage', "    if n > 0 then raise exception 'S-WORKSPACE-STORAGE: % file(s) of the workspace are still in Storage', n; end if;", '    null;'],
  ['erasure 26: deleted with keys not revoked', "    if n > 0 then raise exception 'S-WORKSPACE-KEYS: % key(s) of the workspace are not revoked', n; end if;", '    null;'],

  // ---- work order 44 (migration 27): the metrics sources, the function role's access, the daily job; tests in tenancy.test.sql T34 and T25 ----
  ['metrics27: bing is not an allowed source', "'search-console', 'pagespeed', 'bing', 'ai-answers', 'uptime')) not valid", "'search-console', 'pagespeed', 'ai-answers', 'uptime')) not valid"],
  ['metrics27: the old source check stays', 'alter table public.metrics_snapshots drop constraint metrics_snapshots_source_check;', '-- (old check kept)'],
  ['metrics27: the new source check is never validated', 'alter table public.metrics_snapshots validate constraint metrics_snapshots_source_ok;', '-- (not validated)'],
  ['metrics27: metrics_put takes any source', "  if p_source is null or p_source not in ('search-console', 'pagespeed', 'bing', 'ai-answers') then raise exception 'S-SOURCE: not a metrics source'; end if;\n", ''],
  ['metrics27: metrics_put takes data that is not an object', "if p_day is null or p_data is null or jsonb_typeof(p_data) <> 'object' then", 'if p_day is null or p_data is null then'],
  ['metrics27: metrics_put has no size cap', "  if length(p_data::text) > 262144 then raise exception 'S-SIZE: a metrics row is at most 256 KiB'; end if;\n", ''],
  ['metrics27: metrics_put takes a workspace that does not exist', "  if not exists (select 1 from public.workspaces w where w.id = p_workspace) then raise exception 'S-NOT-FOUND: not found'; end if;\n", ''],
  ['metrics27: metrics_put keeps the first row, not the newest', 'on conflict (workspace_id, source, day) do update set data = excluded.data;', 'on conflict (workspace_id, source, day) do nothing;'],
  ['metrics27: metrics_targets measures a workspace in any state', "where w.state in ('trial', 'active') and s.state in ('live', 'preview')", "where s.state in ('live', 'preview')"],
  ['metrics27: metrics_targets measures a paused site', "and s.state in ('live', 'preview')\n  order by", "and s.state in ('live', 'preview', 'paused')\n  order by"],
  ['metrics27: metrics_targets prefers a preview site to a live one', "(s.state = 'live') desc", "(s.state = 'live') asc"],
  ['metrics27: metrics_targets gives every site of a workspace', 'select distinct on (s.workspace_id) s.workspace_id,', 'select s.workspace_id,'],
  ['metrics27: metrics_target_for_job answers for a workspace in any state', 'where j.id = p_job and w.state in (\'trial\', \'active\') $$;', 'where j.id = p_job $$;'],
  ['metrics27: metrics_calls has no PageSpeed call', ", ('/metrics-pull?workspace=' || t.workspace_id::text || '&source=pagespeed')", ''],
  ...['metrics_targets()', 'metrics_target_for_job(uuid)', 'metrics_put(uuid, text, date, jsonb)', 'metrics_get(uuid, text, date)', 'metrics_last_day(uuid, text)', 'metrics_calls()', 'metrics_pull_all()'].map(sig =>
    [`metrics27: migration 27 opens service.${sig.split('(')[0]} to anon, authenticated, PUBLIC (both layers)`, [['alter default privileges revoke execute on functions from public;', '-- (PUBLIC keeps EXECUTE on new functions)'], [`revoke all on function service.${sig} from public, anon, authenticated;`, '-- (revoke removed)']]]),
  ...['metrics_targets()', 'metrics_target_for_job(uuid)', 'metrics_put(uuid, text, date, jsonb)', 'metrics_get(uuid, text, date)', 'metrics_last_day(uuid, text)'].map(sig =>
    [`metrics27: migration 27 does not open service.${sig.split('(')[0]} to the function role (both layers)`, [['alter default privileges in schema service grant execute on functions to service_role, omnikom_fn;', '-- (no default grant)'], [`grant execute on function service.${sig} to service_role, omnikom_fn;`, '-- (grant removed)']]]),
  ['metrics27: service.metrics_calls stays open to the function role', 'revoke all on function service.metrics_calls() from omnikom_fn, service_role;', '-- (default grant kept)'],
  ['metrics27: service.metrics_pull_all stays open to the function role', 'revoke all on function service.metrics_pull_all() from omnikom_fn, service_role;', '-- (default grant kept)'],
  ['metrics27: service.metrics_put does not pin the search_path', "create function service.metrics_put(p_workspace uuid, p_source text, p_day date, p_data jsonb) returns void language plpgsql security definer set search_path = '' as $$", 'create function service.metrics_put(p_workspace uuid, p_source text, p_day date, p_data jsonb) returns void language plpgsql security definer as $$'],
  ['metrics27: service.metrics_pull_all does not pin the search_path', "create function service.metrics_pull_all() returns int language plpgsql security definer set search_path = '' as $$", 'create function service.metrics_pull_all() returns int language plpgsql security definer as $$'],
  ['metrics27: the daily schedule is removed', "    perform cron.schedule('metrics-pull-daily', '30 3 * * *', 'select service.metrics_pull_all()');", '    null;'],
  ['metrics27: the daily schedule runs at another time', "'30 3 * * *', 'select service.metrics_pull_all()'", "'30 4 * * *', 'select service.metrics_pull_all()'"],

  // Work order 46 (migration 28, the Clients department's file): retention periods as data with floors, the daily purge, the narrow append-only exception
  ['retention 28: the purge takes rows younger than their period', "    cutoff := now() - make_interval(days => r.keep_days);", "    cutoff := now();"],
  ['retention 28: the trigger lets any purge delete through', "    if old.at < now() - make_interval(days => (select r.keep_days from public.retention_rules r where r.table_name = tg_table_name and r.keep_days is not null)) then", "    if true then"],
  ['retention 28: any role may use the purge exception', "  if tg_op = 'DELETE' and tg_table_name in ('audit_log', 'security_events') and coalesce(current_setting('omnikom.purge', true), '') = 'on'\n     and current_user = (select pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = tg_relid) then", "  if tg_op = 'DELETE' and tg_table_name in ('audit_log', 'security_events') and coalesce(current_setting('omnikom.purge', true), '') = 'on' then"],
  ['retention 28: the purge exception needs no setting', "tg_table_name in ('audit_log', 'security_events') and coalesce(current_setting('omnikom.purge', true), '') = 'on'", "tg_table_name in ('audit_log', 'security_events') and true"],
  ['retention 28: the purge leaves its setting on', "      perform set_config('omnikom.purge', 'off', true);\n    elsif r.table_name = 'audit_log' then", "    elsif r.table_name = 'audit_log' then"],
  ['retention 28: the count is read after the setting call (9749cef)', "      delete from public.audit_log a where a.ctid = any(array(select x.ctid from public.audit_log x where x.at < cutoff limit p_batch));\n      get diagnostics n = row_count;\n      perform set_config('omnikom.purge', 'off', true);", "      delete from public.audit_log a where a.ctid = any(array(select x.ctid from public.audit_log x where x.at < cutoff limit p_batch));\n      perform set_config('omnikom.purge', 'off', true);\n      get diagnostics n = row_count;"],
  ['retention 28: open or failed webhooks go after 30 days', "x.received_at < cutoff and x.processed_at is not null and x.error is null limit p_batch", "x.received_at < cutoff limit p_batch"],
  ['retention 28: the consent ledger can be given a period', "when 'consent_ledger' then keep_days is null", "when 'consent_ledger' then true"],
  ['retention 28: the audit log has no floor', "when 'audit_log' then keep_days >= 365", "when 'audit_log' then true"],
  // dropping the revoke, or granting to authenticated, are equivalent mutants: default privileges withhold execute, and authenticated has
  // no USAGE on schema service (CI 42964569179, 42968691043). The function role can reach service functions and gets execute by
  // migration 8's default privileges, so the wall is naming it in the revoke:
  ['retention 28: the function role may run the purge', "revoke all on function service.purge_expired(int) from public, anon, authenticated, omnikom_fn;", "revoke all on function service.purge_expired(int) from public, anon, authenticated;"],
  ['retention 28: the purge writes no audit row', "  insert into public.audit_log (workspace_id, actor, action, target, detail) values (null, null, 'retention-purge', 'retention_rules', jsonb_build_object('deleted', counts, 'batch', p_batch));", "  null;"],
  ['retention 28: a batch out of range is taken', "  if p_batch is null or p_batch < 1 or p_batch > 50000 then raise exception 'R-BATCH: the batch is 1 to 50000 rows'; end if;", "  null;"],
  ['retention 28: the daily purge is not scheduled', "    perform cron.schedule('purge-expired', '17 3 * * *', 'select service.purge_expired()');", '    null;'],
  // ---- E4 (migration 29): the mail outbox; tests T35. Run only these: --only "outbox29" ----
  ['outbox29: an alerted lead is queued again', '  if service.lead_alerted(p_lead) then return 0; end if;', ''],
  ['outbox29: one address is queued twice for a lead', 'constraint mail_outbox_once unique (lead_id, template, to_text)', 'constraint mail_outbox_once unique (id, lead_id, template, to_text)'],
  ['outbox29: a suppressed address is claimed', "    if private.is_suppressed(ws, 'email', o.to_text) then", '    if false then'],
  ['outbox29: a capped alert is dropped', "if r.reason like 'daily cap%' then", 'if false then'],
  ['outbox29: a capped alert is due again at once', "next_at = date_trunc('day', p_now) + interval '1 day'", 'next_at = p_now'],
  ['outbox29: a leased row is due again at once', "next_at = p_now + interval '5 minutes' * (o.attempts + 1)", 'next_at = p_now'],
  ['outbox29: a blocked message is never recorded again', "or (select m.state from public.messages m where m.id = o.message_id) = 'blocked'", ''],
  ['outbox29: the sixth failed try does not fail the message', 'elsif a >= 6 then', 'elsif a >= 600 then'],
  ['outbox29: Resend\'s email id is not stored', "perform service.set_message_state(p_message, 'sent', p_provider_id);", "perform service.set_message_state(p_message, 'sent', null);"],
  ['outbox29: the tick calls with nothing due', "  if not exists (select 1 from public.mail_outbox o where o.next_at <= now()) then return 'idle'; end if;", ''],
  ['outbox29: the mail outbox is not scheduled', "    perform cron.schedule('mail-outbox', '* * * * *', 'select service.mail_outbox_tick()');", '    null;'],
  ['outbox29: the function role may run the tick', 'revoke all on function service.mail_outbox_tick() from omnikom_fn, service_role;', ''],
  ['outbox29: every login reads the outbox', 'create policy mail_outbox_staff_read on public.mail_outbox for select to authenticated using (private.is_staff());', 'create policy mail_outbox_staff_read on public.mail_outbox for select to authenticated using (true);'],

  // ---- E5 (migration 30): visitor counts; tests T36. Run only these: --only "visitor30" ----
  ['visitor30: a visitor is never refused', "if cap is not null and c > cap then raise exception 'S-QUOTA-VISITOR", "if false then raise exception 'S-QUOTA-VISITOR"],
  ['visitor30: a visitor may send one lead more than the limit', 'and c > cap then', 'and c > cap + 1 then'],
  ['visitor30: every visitor is counted as one visitor', 'values (p_site, p_ip_hash, h)', "values (p_site, '', h)"],
  ['visitor30: the older hours are never deleted', 'delete from public.visitor_counts v where v.site_id = p_site and v.hour < h;', ''],
  ['visitor30: the workspace limit is ignored', "cap := private.limit_for(ws, 'leads_per_hour_visitor');", "cap := (select value from public.platform_limits where key = 'leads_per_hour_visitor');"],
  ['visitor30: every login reads the visitor counts', 'create policy visitor_counts_staff_read on visitor_counts for select to authenticated using (private.is_staff());', 'create policy visitor_counts_staff_read on visitor_counts for select to authenticated using (true);'],
  ['visitor30: service_role and the function role may write the visitor counts', 'revoke all on visitor_counts from public, anon, authenticated, service_role, omnikom_fn;', 'grant insert, update, delete on visitor_counts to service_role, omnikom_fn;'],

  // ---- E21 (migration 31): bounces and complaints; tests T37. Run only these: --only "events31" ----
  ['events31: a bounce suppresses for one workspace only', "case when p_kind = 'bounce' then null else m.workspace_id end", 'm.workspace_id'],
  ['events31: an email id that is none of ours is not refused', '  if not found then return 0; end if;', ''],
  ['events31: the event suppresses nothing', "  perform service.suppress(case when p_kind = 'bounce' then null else m.workspace_id end, 'email', m.to_text, p_kind, 'resend webhook');", '  null;'],
  ['events31: an erased address is suppressed', " and x.to_text not like 'erased:%'", ''],

  // ---- E3 (migration 32): the function error sink; tests T38. Run only these: --only "errors32" ----
  ['errors32: a second error of the minute is refused, not counted', '    on conflict (fn, status, minute) do update set n = public.function_errors.n + 1, last_request = excluded.last_request, last_at = now();', '    ;'],
  ['errors32: a status below 500 is stored', 'check (status between 500 and 599)', 'check (status between 100 and 599)'],
  ['errors32: every login reads the function errors', 'create policy function_errors_staff_read on public.function_errors for select to authenticated using (private.is_staff());', 'create policy function_errors_staff_read on public.function_errors for select to authenticated using (true);'],
  ['errors32: service_role and authenticated keep their table rights', 'revoke all on public.function_errors from public, anon, authenticated, service_role, omnikom_fn;', 'revoke all on public.function_errors from public, anon;'],
  ['errors32: migration 32 does not open service.record_function_error to the function role (both layers)', [['alter default privileges in schema service grant execute on functions to service_role, omnikom_fn;', '-- (no default grant)'], ['grant execute on function service.record_function_error(text, int, uuid) to service_role, omnikom_fn;', '-- (grant removed)']]],
  ['errors32: rows older than 30 days are never deleted', "  delete from public.function_errors e where e.minute < now() - interval '30 days';", ''],
];

// 5-PORT mutants: [name, 'lib' = lib/cluster-port.mjs | 'harness' = this file, text to find, text to put instead]
const PORT_HARNESS_FILES = ['tests/run-local.mjs', 'tests/publish-parity.mjs', 'functions/test/harness.mjs', 'tests/test-apply.mjs', 'tests/e2e-screens.mjs', 'ops/restore-drill.mjs', 'ops/test/6b-cluster.mjs', 'ops/test/cluster.mjs'];
const PORT_MUTANTS = [
  ['port: the old range is back', 'lib', "'run-local': [22000, 22899]", "'run-local': [54000, 54899]"],
  ['port: the listen pin is removed', 'lib', ' -c listen_addresses=${LISTEN}`', '`'],
  ['port: the bind fallback is removed', 'lib', "const bind = BIND_FAILURE.test(text) || BIND_FAILURE.test(`${r.stderr ?? ''}${r.stdout ?? ''}`);", 'const bind = false;'],
  ['port: every failure counts as a bind failure', 'lib', "const bind = BIND_FAILURE.test(text) || BIND_FAILURE.test(`${r.stderr ?? ''}${r.stdout ?? ''}`);", 'const bind = true;'],
  ['port: the tries have no cap', 'lib', 'if (tries >= MAX_TRIES) return', 'if (false) return'],
  ['port: the walk leaves its block at the end', 'lib', 'return port >= hi ? lo : port + 1;', 'return port + 1;'],
  // built from parts: cluster-port.test.mjs reads THIS file and must not find the old pick written out in it
  ['port: this harness picks the old range again', 'harness', 'PORT = String(started.port);', `PORT = String(${'54' + '000'} + Math.floor(Math.random() * ${'9' + '00'}));`],
];

// remove a wall from the original text and, when the wall lives in a function body, from its schema-qualified copy too
const mutate = (s, x, y) => { let t = s.split(x).join(y); const qx = qualify(x); if (qx !== x) t = t.split(qx).join(qualify(y)); return t; };


// Work order 20 (migration 23): the enum conversion and the note backfill need rows that exist BEFORE the migration. This builds a database with migrations 1 to 22,
// puts one lead of each old status and one note in it, applies migration 23 alone, and reads the rows back. Mutants of migration 23 run the same check.
const UP_FILE = '20261109000023_lead_type_status.sql';
const UP_SEED = `insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000aa01', 'up-owner@test');
insert into workspaces (id, slug, name, industry) values ('aaaaaaaa-0000-0000-0000-0000000000f1', 'test-upgrade', 'Upgrade', 'real-estate-agent');
insert into members (workspace_id, user_id, role) values ('aaaaaaaa-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000aa01', 'owner');
insert into leads (workspace_id, form, page_path, name, consent_text, status) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'f', '/', 'u1', 'x', 'new'), ('aaaaaaaa-0000-0000-0000-0000000000f1', 'f', '/', 'u2', 'x', 'contacted'),
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'f', '/', 'u3', 'x', 'qualified'), ('aaaaaaaa-0000-0000-0000-0000000000f1', 'f', '/', 'u4', 'x', 'closed'),
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'f', '/', 'u5', 'x', 'spam');
insert into lead_events (lead_id, workspace_id, kind, by, detail) select id, workspace_id, 'note', '00000000-0000-0000-0000-00000000aa01', '{"text":"an old note"}' from leads where name = 'u1';
`;
const UP_CHECK = `select coalesce((select string_agg(status, ',' order by name) from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-0000000000f1'), 'no rows') || ' | ' ||
  coalesce((select string_agg(distinct lead_type, ',') from leads where workspace_id = 'aaaaaaaa-0000-0000-0000-0000000000f1'), '-') || ' | ' ||
  coalesce((select detail -> 'author' ->> 'kind' || ':' || (detail -> 'author' ->> 'name') from lead_events where kind = 'note' limit 1), 'no author') || ' | ' ||
  case when to_regtype('public.lead_status') is null then 'enum gone' else 'enum kept' end`;
const UP_WANT = 'not-contacted,contacted,qualified,closed,spam | enquiry | user:Owner | enum gone';
const upgradeRun = (name, mutate23) => {
  sqlOn('postgres', `create database ${name}`);
  const old = migrationParts.filter(([f]) => f < UP_FILE).map(([f, t]) => `-- >>> ${f}\n` + t).join('\n');
  const up = migrationParts.find(([f]) => f === UP_FILE);
  if (!up) return { setup: false, out: 'migration 23 is missing' };
  const files = [['shim.sql', null], ['cron-stub.sql', null], [`${name}-old.sql`, old], [`${name}-seed.sql`, UP_SEED], [`${name}-23.sql`, mutate23(up[1])]];
  writeFileSync(join(dir, 'cron-stub.sql'), CRON_STUB);
  for (const [f, text] of files) {
    if (text !== null) writeFileSync(join(dir, f), text);
    const x = psql(name, join(dir, f));
    if (x.status !== 0) { return { setup: false, out: outOf(x) }; }
  }
  const got = (sqlOn(name, UP_CHECK).stdout ?? '').trim();
  return { setup: true, ok: got === UP_WANT, got };
};
const upgradeDone = (name) => { done(name); for (const f of ['old', 'seed', '23']) rmSync(join(dir, `${name}-${f}.sql`), { force: true }); };
const UPGRADE_MUTANTS = [
  ['crm23: upgrade, the enum conversion keeps new as new', "when 'new' then 'not-contacted' else status::text end", "when 'new' then 'new' else status::text end"],
  ['crm23: upgrade, the enum conversion drops spam', "when 'new' then 'not-contacted' else status::text end", "when 'new' then 'not-contacted' when 'spam' then 'not-contacted' else status::text end"],
  ['crm23: upgrade, notes written before the migration get no author', "update public.lead_events e set detail = e.detail || jsonb_build_object('author', jsonb_build_object('kind', 'user', 'name', private.person_label(e.workspace_id, e.by)))\n  where e.kind = 'note' and e.by is not null and not (e.detail ? 'author');", ""],
  ['crm23: upgrade, a new lead type column starts empty', "add column lead_type text not null default 'enquiry'", "add column lead_type text not null default 'other'"],
];

let failed = 0, crashed = null, real = { setup: false, ok: false, out: '' }, ran = 0, left = '?', realFail = null;
const bad = [];   // the mutants not caught, named again on the last line (CI keeps only the last lines of a gate)
try {
  const listProblems = mutantListProblems({ MUTANTS, PORT_MUTANTS, PORT_HARNESS_FILES, exists: f => existsSync(join(HERE, '..', f)) });
  for (const p of listProblems) { console.log(`FAIL mutant lists: ${p}`); failed++; bad.push(`mutant lists: ${p}`); }
  if (listProblems.length) throw new Error(`the mutant lists are broken (${listProblems.length} FAIL line(s) above); nothing was run`);
  real = fresh('real', src);
  console.log(real.setup && real.ok ? `PASS real migration: ${real.out.split('\n').filter(l => /PASSED/.test(l)).join(' ').trim()}` : `FAIL real migration:\n${real.out.split('\n').filter(l => /ERROR|EXPECTED|assert|\(E[A-Z]+\)/i.test(l)).join('\n')}`);
  if (!(real.setup && real.ok)) { failed++; realFail = whereFailed(real.out, { 'real.sql': { label: 'the migrations', src }, 'tests.sql': { label: 'the tenancy tests', src: null }, 'shim.sql': { label: 'the local shim', src: null }, 'cron-stub.sql': { label: 'the cron stub', src: null } }); }
  // Work order 16 (T30c): the media bucket's two limits must equal upload-start's MAX_BYTES and MIMES, so the two cannot drift apart.
  if (real.setup) {
    const us = readFileSync(join(HERE, '..', 'functions', 'upload-start', 'index.ts'), 'utf8');
    const maxBytes = (us.match(/export const MAX_BYTES = (\d+);/) || [])[1];
    const mimes = ((us.match(/export const MIMES = \[([^\]]*)\];/) || [])[1] || '').split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean).sort();
    const b = sqlOn('real', "select file_size_limit || '|' || array_to_string(array(select unnest(allowed_mime_types) order by 1), ',') from storage.buckets where id = 'media'");
    const want = `${maxBytes}|${mimes.join(',')}`, got = (b.stdout ?? '').trim();
    const same = !!maxBytes && mimes.length > 0 && got === want;
    console.log(same ? `PASS T30c media bucket limits equal upload-start (${maxBytes} bytes, ${mimes.length} types)` : `FAIL T30c media bucket limits differ from upload-start: bucket '${got || outOf(b)}' vs upload-start '${want}'`);
    if (!same) failed++;
  }
  // Work order 20: the upgrade check, real and then each of its mutants (caught = the check reads something else)
  let n = 0;
  if (!ONLY || 'crm23: upgrade'.includes(ONLY)) {
    ran++;
    const u = upgradeRun('upreal', t => t);
    upgradeDone('upreal');
    console.log(u.setup && u.ok ? `PASS upgrade: migrations 1 to 22 with one lead of each old status and a note, then 23: ${u.got}` : `FAIL upgrade: ${u.setup ? `read '${u.got}', wanted '${UP_WANT}'` : u.out.split('\n').slice(-4).join(' | ')}`);
    if (!(u.setup && u.ok)) { failed++; bad.push('upgrade (the real migration)'); }
  }
  for (const [name, a, b] of UPGRADE_MUTANTS) {
    if (ONLY && !name.includes(ONLY)) continue;
    ran++;
    const t = migrationParts.find(([f]) => f === UP_FILE);
    if (!t || !t[1].includes(a)) { console.log(`MUTANT TARGET MISSING: ${name}: ${a.slice(0, 60)}`); failed++; bad.push(`${name} (target missing)`); continue; }
    const m = upgradeRun(`up${++n}`, x => x.split(a).join(b));
    upgradeDone(`up${n}`);
    const caught = !m.setup || !m.ok;
    if (!caught) { failed++; bad.push(`${name} (survived)`); }
    console.log(`${caught ? 'caught  ' : 'SURVIVED'} ${name.padEnd(44)} ${m.setup ? `read '${m.got}'` : 'setup failed: ' + m.out.split('\n').slice(-2).join(' | ').slice(0, 160)}`);
  }
  for (const [name, a, b] of MUTANTS) {
    if (ONLY && !name.includes(ONLY)) continue;
    ran++;
    const pairs = Array.isArray(a) ? a : [[a, b]];
    const missing = pairs.find(([x]) => !src.includes(x) && !src.includes(qualify(x)));
    if (missing) { console.log(`MUTANT TARGET MISSING: ${name}: ${missing[0].slice(0, 60)}`); failed++; bad.push(`${name} (target missing)`); continue; }
    const db = `m${++n}`;
    const m = fresh(db, pairs.reduce((s, [x, y]) => mutate(s, x, y), src));
    done(db);
    const caught = m.setup && !m.ok;
    if (!caught) { failed++; bad.push(`${name} (${m.setup ? 'survived' : 'setup failed'})`); }
    const why = (m.out.match(/(EXPECTED[^\n]*|Assertion[^\n]*|assert[^\n]*|ERROR:[^\n]*|\(E[A-Z]+\))/) || [''])[0].slice(0, 120);
    console.log(`${caught ? 'caught  ' : (m.setup ? 'SURVIVED' : 'SETUP-FAIL')} ${name.padEnd(44)} ${why}`);
    if (!m.setup) console.log(`  setup output: ${m.out.split('\n').slice(-3).join(' | ').slice(0, 300)}\n  server log:\n${pgLogTail(8).replace(/^/gm, '    ')}`);
  }
  // 5-PORT: the port rules are code, not SQL. Each mutant breaks a copy of lib/cluster-port.mjs (or of this file) and the unit test
  // (cluster-port.test.mjs) must go red. The unit test runs unbroken first and must pass.
  const portSel = PORT_MUTANTS.filter(m => !ONLY || m[0].includes(ONLY));
  if (portSel.length) {
    const unit = (env) => run(process.execPath, [join(HERE, 'cluster-port.test.mjs')], { env: { ...process.env, ...env } });
    const u = unit({});
    console.log(u.status === 0 ? 'PASS port unit test (cluster-port.test.mjs)' : `FAIL port unit test:\n${outOf(u).split('\n').filter(l => /^FAIL/.test(l)).join('\n')}`);
    if (u.status !== 0) failed++;
    const libText = readFileSync(join(HERE, 'lib', 'cluster-port.mjs'), 'utf8');
    for (const [name, kind, x, y] of portSel) {
      ran++;
      const harnessRel = 'tests/run-local.mjs';
      const text = kind === 'lib' ? libText : readFileSync(join(HERE, '..', harnessRel), 'utf8');
      if (!text.includes(x)) { console.log(`MUTANT TARGET MISSING: ${name}: ${x.slice(0, 60)}`); failed++; bad.push(`${name} (target missing)`); continue; }
      const broken = text.split(x).join(y);
      const mdir = mkdtempSync(join(tmpdir(), 'omk-portmut-'));
      let m;
      try {
        if (kind === 'lib') {
          writeFileSync(join(mdir, 'cluster-port.mjs'), broken);
          m = unit({ CLUSTER_PORT_MODULE: join(mdir, 'cluster-port.mjs') });
        } else {
          for (const f of PORT_HARNESS_FILES) { mkdirSync(dirname(join(mdir, f)), { recursive: true }); writeFileSync(join(mdir, f), f === harnessRel ? broken : readFileSync(join(HERE, '..', f))); }
          m = unit({ CLUSTER_PORT_SUPABASE: mdir });
        }
      } finally { rmSync(mdir, { recursive: true, force: true }); }
      const caught = m.status === 1;
      if (!caught) { failed++; bad.push(`${name} (survived)`); }
      console.log(`${caught ? 'caught  ' : 'SURVIVED'} ${name.padEnd(44)} ${(outOf(m).match(/^FAIL[^\n]*/m) || [''])[0].slice(0, 120)}`);
    }
  }
  const none = noneRanProblem(ran, ONLY);
  if (none) { console.log(`FAIL ${none}`); failed++; bad.push(none); }
  // no mutant database may be left behind (the disk wall above); `real` is the only database of ours
  const q = sqlOn('postgres', "select count(*) from pg_database where datname ~ '^m[0-9]+$'");
  left = (q.stdout ?? '').trim();
  if (left !== '0') { console.log(`FAIL mutant databases left behind: ${left || outOf(q)}`); failed++; }
} catch (e) {
  crashed = e;
  failed++;
  console.log(`CRASH ${e && e.code ? e.code + ' ' : ''}${String(e && e.stack || e).split('\n').slice(0, 4).join(' | ')}`);
  console.log(`server log:\n${pgLogTail()}`);
} finally {
  guard.release({ keep: process.argv.includes('--keep') });   // always: a crash must not leave a server running (pg_ctl stop -m immediate, every process naming the folder, then the folder)
}
// the failing statement's file, line and whole error go last, next to the summary: CI keeps only the last lines of a gate
if (realFail) console.log(`\nFAIL real migration in ${realFail.where}${realFail.line ? ` line ${realFail.line}` : ''}:\n${realFail.error.split(/\r?\n/).slice(0, 6).join('\n')}`);
console.log(`\n${failed ? 'FAILED' : 'OK'}: real migration ${real.ok ? 'passes' : `fails${realFail ? ` (${failedLine(realFail)})` : ''}`}; ${ran} mutants${crashed ? ' (CRASHED, see CRASH above)' : ''}${bad.length ? `; not caught: ${bad.join('; ')}` : ''}`);
process.exit(failed ? 1 : 0);
