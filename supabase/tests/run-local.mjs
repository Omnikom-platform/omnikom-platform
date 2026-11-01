// Run the migration and the tenancy tests on a throwaway local Postgres cluster (no Supabase account needed).
//   node supabase/tests/run-local.mjs [--keep] [--shim <file>] [--only <mutant name substring>]
// Needs initdb/pg_ctl/psql on PATH (Postgres 15+). The shim (default local-shim.sql) models Supabase's defaults.
// Then runs each MUTANT (one wall removed from a copy of the migration) and requires the tests to fail: a wall whose
// mutant passes has no test. Exit 0 = tests pass on the real migration AND every mutant is caught.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { qualify } from './qualify.mjs';
// 5-H: the cluster folder is guarded (stopped and removed on every exit path; swept at start when an earlier run was killed)
import { guardedTemp, sweep } from '../../tools/proc-guard/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');   // every migration, in file-name order, as Supabase applies them
const SHIM = arg('--shim') ? resolve(arg('--shim')) : join(HERE, 'local-shim.sql');
const ONLY = arg('--only');
const TESTS = join(HERE, 'tenancy.test.sql');
const PORT = String(54000 + Math.floor(Math.random() * 900));
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 120000, ...opts });

// Read every input ONCE at the start, so editing files during a run cannot mix versions.
const migrationFiles = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
const src = migrationFiles.map(f => `-- >>> ${f}\n` + readFileSync(join(MIGRATIONS_DIR, f), 'utf8')).join('\n');
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
r = run('pg_ctl', ['-D', data, '-o', `-p ${PORT} -k ""`, '-l', join(dir, 'pg.log'), '-w', 'start'], { timeout: START_MS });
if (r.status !== 0) { console.error('pg_ctl start failed:', r.stderr, readFileSync(join(dir, 'pg.log'), 'utf8')); process.exit(2); }
for (const [n, t] of [['shim.sql', shimText], ['tests.sql', testText]]) writeFileSync(join(dir, n), t);

const psql = (db, file) => run('psql', ['-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file]);
const sqlOn = (db, cmd) => run('psql', ['-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', db, '-q', '-t', '-A', '-c', cmd]);
// A child that could not run at all (spawn error, timeout) has null output: say why instead of crashing on null.
const outOf = x => `${x.stdout ?? ''}${x.stderr ?? ''}${x.error ? `\n(${x.error.code || x.error.message})` : ''}`.trim();
const pgLogTail = (n = 15) => { try { return readFileSync(join(dir, 'pg.log'), 'utf8').trim().split(/\r?\n/).slice(-n).join('\n'); } catch { return '(no pg.log)'; } };
const fresh = (name, migrationText) => {
  sqlOn('postgres', `create database ${name}`);
  const m = join(dir, `${name}.sql`);
  writeFileSync(m, migrationText);
  for (const f of [join(dir, 'shim.sql'), m]) { const x = psql(name, f); if (x.status !== 0) return { setup: false, out: outOf(x) }; }
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
  ['status change writes its event', "    insert into lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'status', me, jsonb_build_object('from', l.status, 'to', p_status));", "    null;"],
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
  ['template field allowlist (review 10)', "       or (c ->> 'field') !~ '^(name|email|phone|form|page_path|flow|cta|status|created_at|answers\\.[a-z][a-zA-Z0-9_]{0,60})$'", ''],
  ['value maps shape (review 10)', "    then raise exception 'T-VALUE-MAPS: value maps must be an object of objects under 64 KB'; end if;", '    then null; end if;'],
  ['secrets anywhere in a connector config (review 10)', 'alter table connectors add constraint connectors_no_secret_in_config check (not private.has_secret_like(config));', 'alter table connectors add constraint connectors_no_secret_in_config check (true);'],
  ['has_secret_like walks nested objects', "      if private.has_secret_like(v) then return true; end if;\n    end loop;\n  elsif jsonb_typeof(j) = 'array'", "    end loop;\n  elsif jsonb_typeof(j) = 'array'"],
  ['secret-looking URLs refused', "    if (j #>> '{}') ~* '://[^/@\\s]+:[^@\\s]+@' or", '    if false or'],
  ['lead deletion: owner or staff (review 9)', "  if not found or not private.is_owner_or_staff(l.workspace_id) then raise exception 'S-NOT-FOUND: not found'; end if;\n  insert into audit_log (workspace_id, actor, action, target, detail) values (l.workspace_id, me, 'lead-delete'", "  insert into audit_log (workspace_id, actor, action, target, detail) values (l.workspace_id, me, 'lead-delete'"],
  ['lead deletion is audited (review 9)', "'lead-delete', p_lead::text", "'lead-removed', p_lead::text"],
  ['workspace index on leads (review 8, T14)', [['create index if not exists leads_ws_created on leads (workspace_id, created_at desc);', ''], ['create index if not exists leads_ws_owner on leads (workspace_id, owner_team_row, created_at desc);', '']]],
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
  ['storage folder must be a visible workspace', "  with check (bucket_id = 'media' and private.try_uuid((storage.foldername(name))[1]) is not null and private.can_see(private.try_uuid((storage.foldername(name))[1])));", "  with check (bucket_id = 'media');"],
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
];

// remove a wall from the original text and, when the wall lives in a function body, from its schema-qualified copy too
const mutate = (s, x, y) => { let t = s.split(x).join(y); const qx = qualify(x); if (qx !== x) t = t.split(qx).join(qualify(y)); return t; };

let failed = 0, crashed = null, real = { setup: false, ok: false, out: '' }, ran = 0, left = '?';
try {
  real = fresh('real', src);
  console.log(real.setup && real.ok ? `PASS real migration: ${real.out.split('\n').filter(l => /PASSED/.test(l)).join(' ').trim()}` : `FAIL real migration:\n${real.out.split('\n').filter(l => /ERROR|EXPECTED|assert|\(E[A-Z]+\)/i.test(l)).join('\n')}`);
  if (!(real.setup && real.ok)) failed++;
  let n = 0;
  for (const [name, a, b] of MUTANTS) {
    if (ONLY && !name.includes(ONLY)) continue;
    ran++;
    const pairs = Array.isArray(a) ? a : [[a, b]];
    const missing = pairs.find(([x]) => !src.includes(x) && !src.includes(qualify(x)));
    if (missing) { console.log(`MUTANT TARGET MISSING: ${name}: ${missing[0].slice(0, 60)}`); failed++; continue; }
    const db = `m${++n}`;
    const m = fresh(db, pairs.reduce((s, [x, y]) => mutate(s, x, y), src));
    done(db);
    const caught = m.setup && !m.ok;
    if (!caught) failed++;
    const why = (m.out.match(/(EXPECTED[^\n]*|Assertion[^\n]*|assert[^\n]*|ERROR:[^\n]*|\(E[A-Z]+\))/) || [''])[0].slice(0, 120);
    console.log(`${caught ? 'caught  ' : (m.setup ? 'SURVIVED' : 'SETUP-FAIL')} ${name.padEnd(44)} ${why}`);
    if (!m.setup) console.log(`  setup output: ${m.out.split('\n').slice(-3).join(' | ').slice(0, 300)}\n  server log:\n${pgLogTail(8).replace(/^/gm, '    ')}`);
  }
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
console.log(`\n${failed ? 'FAILED' : 'OK'}: real migration ${real.ok ? 'passes' : 'fails'}; ${ran} mutants${crashed ? ' (CRASHED, see CRASH above)' : ''}`);
process.exit(failed ? 1 : 0);
