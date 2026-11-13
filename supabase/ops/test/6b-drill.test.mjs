// Tests for supabase/ops/restore-drill.mjs. Run: node supabase/ops/test/6b-drill.test.mjs
// Pure parts first (error classification, role discovery, count comparison, export shape), then the drill itself on a tiny local database
// dumped to a file: it must reach the restore, then go RED at the walls and the build (that database has no platform schema and no job),
// say which phases failed, and leave no working folder behind. The real run against staging is in the 6B report. OMNIKOM_6B_DRILL points
// the test at a mutated copy of restore-drill.mjs (6b-mutate.mjs).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startCluster, ROLES_SQL } from './6b-cluster.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUT = process.env.OMNIKOM_6B_DRILL || join(HERE, '..', 'restore-drill.mjs');
const D = await import(pathToFileURL(SUT).href);

let failed = 0, passed = 0;
const check = (name, ok, detail = '') => { if (ok) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}${detail ? ': ' + detail : ''}`); } };

// ---- error classification: only the four extensions' errors are expected
{
  const sample = [
    'pg_restore: error: could not execute query: ERROR:  extension "pg_cron" is not available',
    'HINT:  The extension must first be installed on the system where PostgreSQL is running.',
    'Command was: CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;',
    '', '',
    'pg_restore: error: could not execute query: ERROR:  relation "vault.secrets" does not exist',
    'Command was: COPY vault.secrets (id, name) FROM stdin;',
    'pg_restore: error: could not execute query: ERROR:  schema "cron" does not exist',
    'Command was: GRANT USAGE ON SCHEMA cron TO postgres WITH GRANT OPTION;',
    'pg_restore: error: could not execute query: ERROR:  function vault.create_secret(text, text, text, uuid) does not exist',
    'Command was: GRANT ALL ON FUNCTION vault.create_secret(new_secret text) TO service_role;',
    'pg_restore: error: could not execute query: ERROR:  extension "pgmq" does not exist',
    'Command was: COMMENT ON EXTENSION pgmq IS \'A lightweight message queue\';',
    'pg_restore: warning: errors ignored on restore: 5',
  ].join('\n');
  const p = D.parseRestoreErrors(sample);
  check('errors: the five errors about pg_cron, vault, cron, pgmq are all expected, none unexpected, and the count matches pg_restore\'s own', p.errors.length === 5 && p.expected.length === 5 && p.unexpected.length === 0 && p.ignored === 5, JSON.stringify(p.errors.map(e => e.expected)));
  const bad = D.parseRestoreErrors([
    'pg_restore: error: could not execute query: ERROR:  syntax error at or near "BROKEN"',
    'Command was: CREATE TABLE public.leads (id uuid BROKEN);',
    'pg_restore: error: could not execute query: ERROR:  relation "public.workspaces" does not exist',
    'Command was: ALTER TABLE ONLY public.sites ADD CONSTRAINT x FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);',
    'pg_restore: warning: errors ignored on restore: 2',
  ].join('\n'));
  check('errors: a broken table and a missing public relation are UNEXPECTED (the drill fails on them)', bad.unexpected.length === 2 && bad.expected.length === 0, JSON.stringify(bad.errors));
  const sneaky = D.parseRestoreErrors('pg_restore: error: could not execute query: ERROR:  relation "public.cabinets" does not exist\nCommand was: COPY public.cabinets (id) FROM stdin;\npg_restore: warning: errors ignored on restore: 1');
  check('errors: a table whose name merely contains "net" (cabinets) is not excused', sneaky.unexpected.length === 1);
  check('errors: no error at all is a clean parse', D.parseRestoreErrors('').errors.length === 0);
}

// ---- roles the dump names
{
  const sql = [
    'GRANT USAGE ON SCHEMA auth TO anon;', 'GRANT ALL ON FUNCTION auth.email() TO dashboard_user;', 'REVOKE ALL ON SCHEMA service FROM PUBLIC, legacy_role;',
    'GRANT omnikom_fn TO postgres;', 'GRANT SELECT ON TABLE public.notes TO authenticated, service_role WITH GRANT OPTION;',
    'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;',
    'GRANT USAGE ON SCHEMA storage TO "supabase_storage_admin";', 'CREATE TABLE public.to_everyone (id int);', '-- GRANT x TO commented;',
  ].join('\n');
  const r = D.rolesIn(sql);
  check('roles: found from GRANT, REVOKE and ALTER DEFAULT PRIVILEGES lines; PUBLIC and postgres left out; a CREATE TABLE is not read', JSON.stringify(r) === JSON.stringify(['anon', 'authenticated', 'dashboard_user', 'legacy_role', 'omnikom_fn', 'service_role', 'supabase_admin', 'supabase_storage_admin']), JSON.stringify(r));
}

// ---- counts: between the source before the dump and after the restore
{
  const before = new Map([['public.a', 10], ['public.b', 5], ['public.c', 0]]);
  const after = new Map([['public.a', 12], ['public.b', 5], ['public.c', 0]]);
  const ok = D.compareCounts(before, after, new Map([['public.a', 11], ['public.b', 5], ['public.c', 0]]));
  check('counts: a table that grew while the drill ran is fine when the restored count lies between, and is listed as moved', ok.fewer.length === 0 && ok.more.length === 0 && ok.moved.join() === 'public.a', JSON.stringify(ok));
  const lost = D.compareCounts(before, after, new Map([['public.a', 9], ['public.b', 5], ['public.c', 0]]));
  check('counts: FEWER rows restored than the source held before the dump is caught', lost.fewer.length === 1 && /public\.a 9 of 10/.test(lost.fewer[0]), JSON.stringify(lost));
  const extra = D.compareCounts(before, after, new Map([['public.a', 12], ['public.b', 6], ['public.c', 0]]));
  check('counts: MORE rows than the source has even after the restore is caught', extra.more.length === 1 && /public\.b 6/.test(extra.more[0]), JSON.stringify(extra));
  const gone = D.compareCounts(before, after, new Map([['public.a', 10], ['public.b', 5]]));
  check('counts: a table missing from the restore is caught', gone.fewer.length === 1 && /public\.c missing/.test(gone.fewer[0]), JSON.stringify(gone));
  const m = D.parseCounts('public.a|10\nauth.users|3\nnoise\npublic.weird name|4\n');
  check('counts: parseCounts reads "table|n" lines and ignores the rest', m.size === 2 && m.get('public.a') === 10 && m.get('auth.users') === 3);
}

// ---- the export shape: processed media only, the derivative slot of the width (the rule of export-published)
{
  const e = D.shapeExport({ schema: 'omnikom-export/1', job: { id: 'j' }, rows: [], media: [
    { id: 'm1', path: 'ws/a.png', width: 400, height: 400, processed: true, exif_stripped: true, rights_confirmed: true },
    { id: 'm2', path: 'ws/b.jpg', width: 1700, height: 900, processed: true, exif_stripped: true, rights_confirmed: true },
    { id: 'm3', path: 'ws/c.jpg', width: 2400, height: 900, processed: true, exif_stripped: true, rights_confirmed: true },
    { id: 'm4', path: 'ws/d.jpg', width: 3000, height: 900, processed: false, exif_stripped: false, rights_confirmed: true },
  ] });
  check('export: the unprocessed upload is dropped; the paths are the 800, 1600 and 2400 px WebP slots; the schema key survives', e.schema === 'omnikom-export/1' && e.media.map(m => m.path).join() === 'ws/a-800.webp,ws/b-1600.webp,ws/c-2400.webp' && e.media.every(m => m.url === null), JSON.stringify(e.media));
  check('fmt: seconds, minutes and hours are readable', D.fmt(4.2) === '4.2 s' && D.fmt(125) === '2 min 5 s' && D.fmt(3725) === '1 h 2 min 5 s', `${D.fmt(4.2)} | ${D.fmt(125)} | ${D.fmt(3725)}`);
}

// ---- row E1: the Vault copy's names against the restored references, and where a page's media come from
{
  const vg = typeof D.vaultGaps === 'function' ? D.vaultGaps(['a', 'b', 'c'], [{ name: 'a', secret: 'x' }, { name: 'b', secret: '' }, { name: 'd', secret: 'y' }]) : 'no export vaultGaps';
  check('e1 case 12, vaultGaps: an entry with an empty secret counts as missing, a present one does not', JSON.stringify(vg) === '["b","c"]', JSON.stringify(vg));
  const copy = join(tmpdir(), 'a-media-copy'), at = join(copy, 'ws', 'a-800.webp'), exists = p => p === at;
  const ms = typeof D.mediaSource === 'function' ? [D.mediaSource(null, 'LOGO', 'ws/a-800.webp', exists), D.mediaSource(copy, 'LOGO', 'ws/a-800.webp', exists), D.mediaSource(copy, 'LOGO', 'ws/b-800.webp', exists)] : 'no export mediaSource';
  check('e1 case 13, mediaSource: no copy gives the logo, a present file its path, a missing one null', JSON.stringify(ms) === JSON.stringify(['LOGO', at, null]), JSON.stringify(ms));
}

// ---- arguments
{
  const refuse = async (argv, env, code, re, name) => { try { await D.drill(argv, env, () => {}); check(name, false, 'ran'); } catch (e) { check(name, e.code === code && re.test(e.message), `${e.code} ${e.message}`); } };
  await refuse(['--db', 'postgres://u:p@h/db'], {}, 2, /NAME of a variable/, 'args: --db takes a variable name, a URL is refused');
  await refuse(['--db', 'X_URL', '--dump', 'f'], { X_URL: 'postgresql://h/d' }, 2, /give one/, 'args: --db and --dump together are refused');
  await refuse(['--key', 'k'], {}, 2, /--key goes with --dump/, 'args: --key alone is refused');
  await refuse(['--dump', join(tmpdir(), 'no-such-dump-file.dump')], {}, 2, /no such dump/, 'args: a missing dump file is refused');
  await refuse([], {}, 3, /STAGING_DB_URL is not set/, 'args: the default variable, unset, is BLOCKED (exit 3), by name');
  await refuse(['--slug', 'Bad Slug', '--db', 'X_URL'], { X_URL: 'postgresql://h/d' }, 2, /plain workspace slug/, 'args: a slug with a space is refused');
  await refuse(['--limit-minutes', '0', '--db', 'X_URL'], { X_URL: 'postgresql://h/d' }, 2, /positive number/, 'args: a limit of zero minutes is refused');
  await refuse(['--media', 'f'], {}, 2, /--media and --vault go with --dump/, 'e1 case 14, args: --media without --dump is refused with its text');
  await refuse(['--dump', fileURLToPath(import.meta.url), '--vault', join(tmpdir(), 'no-such-vault-copy.json')], {}, 2, /no such vault file/, 'e1 case 15, args: a missing --vault file is refused');
}

// ---- the drill itself on a tiny database: red where it must be, clean afterwards
{
  const cluster = startCluster({ label: '6b-drill-src' });
  const root = mkdtempSync(join(tmpdir(), 'omnikom-6b-drill-test-'));
  try {
    cluster.createDb('tiny');
    cluster.sql('tiny', `${ROLES_SQL}
      create table notes (id int primary key, body text not null); insert into notes select g, 'row ' || g from generate_series(1, 40) g;
      grant select on notes to anon;
      alter table notes add constraint notes_body_short check (length(body) < 100) not valid;
      create schema realtime; create table realtime.messages (payload text);
      alter table realtime.messages add constraint messages_payload_exclusive check (payload is not null) not valid;
      create table api_keys (vault_ref text); insert into api_keys values ('k-one'), (null);
      create table integrations (secret_ref text); insert into integrations values ('crm-webhook-x'), ('k-two');`);
    const dump = join(root, 'tiny.dump');
    const d = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--file', dump, cluster.url('tiny')], { encoding: 'utf8', timeout: 5 * 60 * 1000 });
    check('setup: a tiny dump was made', d.status === 0, d.stderr);
    const tmpRoot = join(root, 'tmp'); mkdirSync(tmpRoot);
    const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
    process.env.TEMP = process.env.TMP = process.env.TMPDIR = tmpRoot;
    const lines = [];
    let r;
    try { r = await D.drill(['--dump', dump, '--limit-minutes', '0.001'], {}, l => lines.push(l)); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
    const text = lines.join('\n');
    const phase = n => r.phases.find(p => p.name === n);
    check('drill: dump, cluster and restore pass on the tiny dump', phase('dump').ok && phase('cluster').ok && phase('restore').ok, text);
    check('drill: counts and checks pass (40 + 0 rows counted, row level security is OFF on the tiny table, so the checks phase must be RED)', phase('counts').ok && phase('checks') && !phase('checks').ok, text);
    check('drill: the walls phase is RED (the tiny database has no service schema, tenancy.test.sql cannot pass)', phase('walls') && !phase('walls').ok, text);
    check('drill: the build phase is RED with the plain reason (no finished publish job)', phase('build') && !phase('build').ok && /no finished publish job|export_bundle|could not look for a job/.test(text), text);
    check('drill: checks name a NOT VALID constraint in our schemas (public.notes notes_body_short) and ignore the vendor one (realtime)', phase('checks') && !phase('checks').ok && /constraints NOT VALID: public\.notes notes_body_short/.test(text) && !/realtime\.messages/.test(text), text);
    check('drill: exit 1, "DRILL FAIL" names the failed phases, and no "DRILL PASS" is printed', r.exit === 1 && /DRILL FAIL: .*checks.*walls.*build/.test(text) && !/DRILL PASS/.test(text), text);
    check('drill: every phase line carries a time, and a total is printed', r.phases.every(p => Number.isFinite(p.secs)) && /^total .*\(target under /m.test(text), text);
    check('drill: a total over the limit (set to 0.06 s here) fails the drill by itself', r.failures.some(f => /total time over the limit/.test(f)), r.failures.join(' | '));
    check('drill: the working folder (cluster, dump copies) is gone afterwards', readdirSync(tmpRoot).length === 0, readdirSync(tmpRoot).join(','));
    check('drill: no connection string or row appears in the output', !/postgres(ql)?:\/\//.test(text) && !/row 17/.test(text), text);

    // e1 case 16: a second drill of the same dump, with a plain Vault copy that holds k-one (a value) and k-two (empty): 2 of the 3 references lack one
    const vaultCopy = join(root, 'vault-copy.json');
    writeFileSync(vaultCopy, JSON.stringify([{ name: 'k-one', description: 'one', secret: 'secret-value-one' }, { name: 'k-two', description: 'two', secret: '' }]));
    const lines2 = [];
    let r2 = null, thrown = '';
    try { r2 = await D.drill(['--dump', dump, '--vault', vaultCopy], {}, l => lines2.push(l)); } catch (e) { thrown = `threw ${e && e.code} ${e && e.message}`; }
    const text2 = lines2.join('\n'), vp = r2 && r2.phases.find(p => p.name === 'vault');
    check('e1 case 16, drill --vault: the vault phase is red with "lacks 2 of 3", and no line holds a reference name or the value', !!vp && !vp.ok && /the vault copy lacks 2 of 3 references/.test(text2)
      && !['k-one', 'k-two', 'crm-webhook-x', 'secret-value-one'].some(s => text2.includes(s)), thrown || text2);
    // drill-w (hand-over DRILL-W): the walls database must look to tenancy.test.sql like a cluster with no Vault. The file builds its own Vault stand-in
    // (cut out of the file here, never copied) only where no schema named vault exists; a restored Supabase dump can leave one, so the walls phase drops it first.
    const standIn = readFileSync(join(HERE, '..', '..', 'tests', 'tenancy.test.sql'), 'utf8').match(/do \$v\$ begin[\s\S]*?end \$v\$;/g) || [];
    check('drill-w setup: tenancy.test.sql holds its own Vault stand-in block (do $v$ ... end $v$;) exactly once', standIn.length === 1, `${standIn.length} blocks`);
    const useIt = `${standIn[0] || ''}\nselect vault.create_secret('a-value-of-forty-characters-0000000000', 'a-name');\nselect count(*) from vault.secrets where name = 'a-name';`;
    cluster.createDb('huskc'); cluster.createDb('huskf'); cluster.sql('huskc', 'create schema vault;'); cluster.sql('huskf', 'create schema vault;');
    const noPrep = cluster.sql('huskc', useIt);
    check('drill-w control: a schema named vault with nothing in it keeps the file from building its stand-in, and its first call gives the staging error', !noPrep.ok && /function vault\.create_secret\(unknown, unknown\) does not exist/.test(noPrep.err), noPrep.err);
    const prepped = typeof D.WALLS_NO_VAULT_SQL === 'string' ? cluster.sql('huskf', `${D.WALLS_NO_VAULT_SQL};\n${useIt}`) : null;
    check('drill-w case 1: WALLS_NO_VAULT_SQL, then the block of the file, gives a Vault stand-in that works', !!prepped && prepped.ok && prepped.out.split(/\r?\n/).pop() === '1', prepped ? prepped.err : 'no export WALLS_NO_VAULT_SQL');
    cluster.createDb('tinyv'); cluster.sql('tinyv', 'create schema vault; create table vault.kept (x int);');
    const dumpV = join(root, 'tinyv.dump');
    const dv = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--file', dumpV, cluster.url('tinyv')], { encoding: 'utf8', timeout: 5 * 60 * 1000 });
    const linesV = []; let thrownV = '';
    try { await D.drill(['--dump', dumpV], {}, l => linesV.push(l)); } catch (e) { thrownV = `threw ${e && e.code} ${e && e.message}`; }
    const textV = linesV.join('\n');
    check('drill-w case 2: a vault schema that holds an object is not dropped, and the walls phase names that', dv.status === 0 && /FAIL walls\s.*the vault schema of the restored copy could not be dropped/.test(textV), thrownV || textV);
  } finally { cluster.stop(); rmSync(root, { recursive: true, force: true }); }
}

console.log(`drill tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
