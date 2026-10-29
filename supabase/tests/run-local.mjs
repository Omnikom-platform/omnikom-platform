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
  ['lead_update needs to see the lead', "  if not (staff or role = 'owner' or (role = 'member' and l.owner_team_row = mine)) then raise exception 'S-NOT-FOUND: not found'; end if;", "  null;"],
  ['no direct status update (grant removed)', "revoke update on leads from authenticated;\ndrop policy leads_update on leads;", "-- (grant kept)"],
  ['status change writes its event', "    insert into lead_events (lead_id, workspace_id, kind, by, detail) values (p_lead, l.workspace_id, 'status', me, jsonb_build_object('from', l.status, 'to', p_status));", "    null;"],
  ['new owner must be a team row of the workspace', "    if not exists (select 1 from content_rows c where c.id = p_owner and c.workspace_id = l.workspace_id and c.collection = 'team' and c.deleted_at is null)\n      then raise exception 'S-NOT-FOUND: no such team member'; end if;", "    null;"],
  ['timeline read wall follows the lead', "create policy lead_events_read on lead_events for select to authenticated using (exists (select 1 from leads l where l.id = lead_id));", "create policy lead_events_read on lead_events for select to authenticated using (true);"],
  ['a retry stores nothing (idempotency)', "    if lid is not null then return lid; end if;    -- a retry of the same submission stores nothing and answers the same id", "    lid := null;"],
  ['assignee slug resolves inside the workspace only', "      where c.workspace_id = ws and c.collection = 'team' and c.deleted_at is null and v.data ->> 'slug' = p_assignee limit 1;", "      where c.collection = 'team' and c.deleted_at is null and v.data ->> 'slug' = p_assignee order by c.created_at limit 1;"],
  ['received event on capture', "  insert into lead_events (lead_id, workspace_id, kind, detail) values (lid, ws, 'received', jsonb_build_object('form', p_form, 'page', p_page, 'flow', p_flow));", "  null;"],
  ['manual lead: members only to themselves', "  who := case when role = 'member' and not staff then private.my_team_row(ws) else p_owner end;", "  who := p_owner;"],
  ['manual lead needs membership', "  if not staff and role is null then raise exception 'S-NOT-FOUND: not found'; end if;\n  if coalesce(p_consent, '') = '' then raise exception 'consent text required'; end if;\n  who :=", "  if coalesce(p_consent, '') = '' then raise exception 'consent text required'; end if;\n  who :="],
  ['api keys are staff-only', "create policy api_keys_staff_read on api_keys for select to authenticated using (private.is_staff());", "create policy api_keys_staff_read on api_keys for select to authenticated using (true);"],
  ['a revoked key is dead', "    and k.revoked_at is null and (k.expires_at is null or k.expires_at > now())", "    and (k.expires_at is null or k.expires_at > now())"],
  ['step C service functions closed to clients (both layers)', "revoke all on all functions in schema service from public, anon, authenticated;\ngrant execute on all functions in schema service to service_role;\n\ndo $$ begin\n  if exists (select from pg_publication where pubname = 'supabase_realtime') then\n    alter publication supabase_realtime add table lead_events;", "grant usage on schema service to anon, authenticated;\ngrant execute on all functions in schema service to service_role, anon, authenticated;\n\ndo $$ begin\n  if exists (select from pg_publication where pubname = 'supabase_realtime') then\n    alter publication supabase_realtime add table lead_events;"],
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
  // Double since step C: the first migration closes the schema, the second closes its own functions again. Remove both layers.
  ['service functions closed to clients (both layers)', [['grant usage on schema service to service_role;', 'grant usage on schema service to service_role, anon, authenticated; grant execute on all functions in schema service to anon, authenticated;'],
    ["revoke all on all functions in schema service from public, anon, authenticated;\ngrant execute on all functions in schema service to service_role;", "grant execute on all functions in schema service to service_role;"]]],
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
  ['contract only for members (N1)', "  if not (private.is_staff() or private.is_member(p_workspace)) then raise exception 'S-NOT-FOUND: not found'; end if;\n  return (select resolved", "  return (select resolved"],
  ['job records the validated version (N4)', "  select jsonb_object_agg(x.id, x.n) into req from unnest(p_rows, p_versions) x(id, n);", "  select jsonb_object_agg(c.id, (select max(n) from content_versions v where v.row_id = c.id)) into req from content_rows c where c.id = any(p_rows);"],
  ['pinned version must exist (N4)', "    then raise exception 'S-NOT-FOUND: a pinned version does not exist'; end if;", "    then null; end if;"],
  ['seed records its reference (N9)', "jsonb_build_object('by', p_actor, 'ref', p_ref));", "null);"],
  ['no extension functions in public (N10)', "-- gen_random_uuid() is built into Postgres 13+:", "create extension if not exists pgcrypto;\n-- gen_random_uuid() is built into Postgres 13+:"],
  ['job error recorded (N13)', "error = coalesce(p_error, error),", ""],
  ['unpublish: owners and staff only', "  if not found or not (private.is_staff() or private.my_role(c.workspace_id) = 'owner') then", "  if not found then"],
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
