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

const dir = mkdtempSync(join(tmpdir(), 'omnikom-pg-'));
const data = join(dir, 'data');
let r = run('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8']);
if (r.status !== 0) { console.error('initdb failed:', r.stderr || r.error); process.exit(2); }
r = run('pg_ctl', ['-D', data, '-o', `-p ${PORT} -k ""`, '-l', join(dir, 'pg.log'), '-w', 'start']);
if (r.status !== 0) { console.error('pg_ctl start failed:', r.stderr, readFileSync(join(dir, 'pg.log'), 'utf8')); process.exit(2); }
for (const [n, t] of [['shim.sql', shimText], ['tests.sql', testText]]) writeFileSync(join(dir, n), t);

const psql = (db, file) => run('psql', ['-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file]);
const fresh = (name, migrationText) => {
  run('psql', ['-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', 'postgres', '-q', '-c', `create database ${name}`]);
  const m = join(dir, `${name}.sql`);
  writeFileSync(m, migrationText);
  for (const f of [join(dir, 'shim.sql'), m]) { const x = psql(name, f); if (x.status !== 0) return { setup: false, out: x.stderr }; }
  const t = psql(name, join(dir, 'tests.sql'));
  return { setup: true, ok: t.status === 0, out: (t.stdout + t.stderr).trim() };
};

// The walls, each removed in one mutant. Every target must exist in the migration.
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
  ['definer functions set search_path (T14)', "create function service.lead_sms_stop(p_lead uuid, p_detail jsonb default '{}') returns void language plpgsql security definer set search_path = public as $$", "create function service.lead_sms_stop(p_lead uuid, p_detail jsonb default '{}') returns void language plpgsql security definer as $$"],
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
  ['SMS quiet hours', "      st := 'blocked'; why := 'quiet hours'; end if;", "      null; end if;"],
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
  ['clients cannot skip the validator (save body private)', 'revoke all on all functions in schema private from public, anon, authenticated;', 'grant execute on all functions in schema private to anon, authenticated;'],
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
  ['job error recorded (N13)', "error = coalesce(p_error, error),", ""],
  ['unpublish: owners and staff only (null-guarded, review 1)', "  if not found or not private.is_owner_or_staff(c.workspace_id) then raise exception 'S-NOT-FOUND: not found'; end if;\n  update content_rows set published_version = null", "  update content_rows set published_version = null"],
  ['jobs and leads stream through Realtime', "    alter publication supabase_realtime add table publish_jobs, leads;", "    null;"],
  ['consent required on leads', "if coalesce(p_consent, '') = '' then raise", "if false then raise"],
  ['media key under its workspace', "constraint media_path_in_workspace check (path like workspace_id::text || '/%')", "constraint media_path_in_workspace check (true)"],
  ['storage folder must be a visible workspace', "  with check (bucket_id = 'media' and private.try_uuid((storage.foldername(name))[1]) is not null and private.can_see(private.try_uuid((storage.foldername(name))[1])));", "  with check (bucket_id = 'media');"],
];

let failed = 0;
const real = fresh('real', src);
console.log(real.setup && real.ok ? `PASS real migration: ${real.out.split('\n').filter(l => /PASSED/.test(l)).join(' ').trim()}` : `FAIL real migration:\n${real.out.split('\n').filter(l => /ERROR|EXPECTED|assert/i.test(l)).join('\n')}`);
if (!(real.setup && real.ok)) failed++;
let n = 0, ran = 0;
for (const [name, a, b] of MUTANTS) {
  if (ONLY && !name.includes(ONLY)) continue;
  ran++;
  const pairs = Array.isArray(a) ? a : [[a, b]];
  const missing = pairs.find(([x]) => !src.includes(x));
  if (missing) { console.log(`MUTANT TARGET MISSING: ${name}: ${missing[0].slice(0, 60)}`); failed++; continue; }
  const m = fresh(`m${++n}`, pairs.reduce((s, [x, y]) => s.split(x).join(y), src));
  const caught = m.setup && !m.ok;
  if (!caught) failed++;
  const why = (m.out.match(/(EXPECTED[^\n]*|Assertion[^\n]*|assert[^\n]*|ERROR:[^\n]*)/) || [''])[0].slice(0, 120);
  console.log(`${caught ? 'caught  ' : (m.setup ? 'SURVIVED' : 'SETUP-FAIL')} ${name.padEnd(44)} ${why}`);
}
run('pg_ctl', ['-D', data, '-m', 'fast', 'stop']);
if (!process.argv.includes('--keep')) rmSync(dir, { recursive: true, force: true });
console.log(`\n${failed ? 'FAILED' : 'OK'}: real migration ${real.ok ? 'passes' : 'fails'}; ${ran} mutants`);
process.exit(failed ? 1 : 0);
