// restore-drill.mjs: the monthly restore drill (11-OPERATIONS section 3): take a dump, restore it into a throwaway local Postgres,
// prove the walls on the restored copy, build the test site from the restored rows with the factory, time every phase.
//
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node supabase/ops/restore-drill.mjs [--db STAGING_DB_URL]
//   node supabase/ops/restore-drill.mjs --dump <file> [--key <private key pem>]      (a dump the backup job made: --key opens the CMS envelope)
//        [--slug test-demo-a] [--limit-minutes 120] [--keep]
//
// The phases, each timed:
//   1 dump      pg_dump of the database named by --db (read only, custom format, with privileges: see backup.mjs --privileges), or
//               --dump: a plain archive, or with --key a backup.mjs file decrypted with `openssl cms -decrypt`
//   2 cluster   a throwaway cluster (initdb, pg_ctl) in the SYSTEM TEMP folder (C:, never E:), removed at the end unless --keep
//   3 restore   pg_restore of everything into database "restored". The local Postgres has no pg_cron, pg_net, pgmq or Supabase Vault, so
//               exactly the errors about those four extensions and their data are expected and listed; ANY other error fails the drill.
//               The roles the dump names (anon, authenticated, supabase_auth_admin, omnikom_fn...) are created first, read from the dump.
//   4 counts    rows per table (counts, never rows) of public, auth, storage, ops; with --db also the source's counts: a difference is
//               a WARN (the source moves while the drill runs), a table with fewer rows restored than the source had is a FAIL
//   5 checks    every public table has row level security on; no constraint is left NOT VALID
//   6 walls     tenancy.test.sql, unchanged, on database "walls" = the restored SCHEMA (functions, policies, grants, triggers: every wall) plus the
//               reference rows the migrations insert (storage.buckets, platform_limits). Why not on "restored": the test inserts its own fixtures
//               (workspace test-demo-a, fixed user ids) and a restored staging already holds them; it runs in one transaction and rolls back.
//   7 build     the factory builds the site of --slug from the restored rows: the newest `done` publish job of that workspace, its
//               service.export_bundle shaped like the export-published function (processed media only, derivative paths), factory/build.mjs.
//               A pg_dump holds no Storage files: the media the rows reference are replaced by the repository's stand-in logo
//               (sites/test-demo-a/media/logo.png), so the build proves the rows, the contract and the design, not the photos.
// Exit 0 DRILL PASS (every phase passed and the total is under the limit); 1 a phase failed (named); 2 usage; 3 blocked (a variable or tool missing).
// Printed: counts, times, plain error classes. Never a URL, a key, a password or a row.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync, statSync, readdirSync, copyFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.OMNIKOM_6B_REPO ? resolve(process.env.OMNIKOM_6B_REPO) : resolve(HERE, '..', '..');   // the override is for the mutation harness only (a copy of this file lives in the temp folder)
const NAME_RE = /^[A-Z][A-Z0-9_]*$/;
class Stop extends Error { constructor(code, message) { super(message); this.code = code; } }

// ---- pure helpers (tested in 6b-drill.test.mjs)
export function pgEnv(url) {
  const u = new URL(url);
  const e = {};
  if (u.hostname) e.PGHOST = u.hostname.replace(/^\[|\]$/g, '');
  if (u.port) e.PGPORT = u.port;
  if (u.username) e.PGUSER = decodeURIComponent(u.username);
  if (u.password) e.PGPASSWORD = decodeURIComponent(u.password);
  const db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (db) e.PGDATABASE = db;
  const ssl = u.searchParams.get('sslmode');
  if (ssl) e.PGSSLMODE = ssl;
  return e;
}

// the errors a restore into plain Postgres is EXPECTED to give: the four extensions it does not have, and their schemas and rows
const EXPECTED = /\b(pg_cron|pg_net|pgmq|supabase_vault)\b|\b(cron|vault|net|pgmq)\.|schema "(cron|vault|net|pgmq)"|ON SCHEMA (cron|vault|net|pgmq)\b/i;
export function parseRestoreErrors(stderr) {
  const blocks = String(stderr).split(/^pg_restore: /m).filter(Boolean);
  const errors = [];
  let ignored = null;
  for (const b of blocks) {
    const m = /^(?:warning: )?errors ignored on restore: (\d+)/.exec(b);
    if (m) { ignored = Number(m[1]); continue; }
    if (!/^error: /.test(b)) continue;
    const msg = (/ERROR:\s+(.*)/.exec(b) || [, b.split('\n')[0]])[1].trim();
    const cmd = (/Command was: ([\s\S]*)/.exec(b) || [, ''])[1];
    errors.push({ message: msg.slice(0, 160), command: cmd.trim().split('\n')[0].slice(0, 100), expected: EXPECTED.test(msg) || EXPECTED.test(cmd) });
  }
  return { errors, ignored, unexpected: errors.filter(e => !e.expected), expected: errors.filter(e => e.expected) };
}

const PRIVILEGES = new Set(['all', 'select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger', 'execute', 'usage', 'create', 'connect', 'temporary', 'temp', 'maintain', 'set', 'alter']);
// the roles a dump's GRANT / REVOKE / ALTER DEFAULT PRIVILEGES lines name (so a restore finds them): from `pg_restore -f -` text
export function rolesIn(sqlText) {
  const found = new Set();
  const add = raw => { for (const part of raw.split(',')) { const n = part.trim().replace(/^"|"$/g, ''); if (/^[a-z_][a-z0-9_]*$/.test(n)) found.add(n); } };
  for (const line of String(sqlText).split(/\r?\n/)) {
    if (!/^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES)\b/.test(line)) continue;
    let m;
    const to = /\b(?:TO|FROM)\s+((?:"?[A-Za-z_][A-Za-z0-9_]*"?\s*,\s*)*"?[A-Za-z_][A-Za-z0-9_]*"?)/g;
    while ((m = to.exec(line))) add(m[1]);
    const member = /^GRANT\s+("?[A-Za-z_][A-Za-z0-9_]*"?)\s+TO\b/.exec(line);       // GRANT <role> TO <role>: the granted one is a role too
    if (member && !PRIVILEGES.has(member[1].toLowerCase())) add(member[1]);
    const forRole = /\bFOR ROLE\s+("?[A-Za-z_][A-Za-z0-9_]*"?)/g;
    while ((m = forRole.exec(line))) add(m[1]);
  }
  for (const r of ['public', 'current_user', 'session_user', 'current_role', 'postgres']) found.delete(r);
  return [...found].filter(r => !r.startsWith('pg_')).sort();
}

export function fmt(s) { const m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min ${Math.round(s % 60)} s` : m ? `${m} min ${Math.round(s % 60)} s` : `${s.toFixed(1)} s`; }

// the export the factory reads, from export_bundle's document, shaped like supabase/functions/export-published/index.ts does
export function shapeExport(bundle) {
  const slot = w => (typeof w === 'number' && w >= 2400 ? 2400 : typeof w === 'number' && w >= 1600 ? 1600 : 800);
  const derivative = (p, s) => `${p.replace(/\.[^./]+$/, '')}-${s}.webp`;
  const processed = (bundle.media || []).filter(m => m.processed === true);
  return { ...bundle, media: processed.map(m => ({ id: m.id, path: derivative(m.path, slot(m.width)), original_path: m.path, width: m.width, height: m.height, processed: m.processed, exif_stripped: m.exif_stripped, rights_confirmed: m.rights_confirmed, url: null })) };
}

// ---- the run
const sh = (cmd, args, { env, input, timeout = 30 * 60 * 1000, cwd, stdio } = {}) => {
  const r = spawnSync(cmd, args, { env: { ...process.env, ...(env || {}) }, input, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024, windowsHide: true, shell: false, cwd, ...(stdio ? { stdio } : {}) });
  return { status: r.status, out: r.stdout || '', err: r.stderr || '', error: r.error ? (r.error.code || r.error.message) : null };
};
const lastLine = t => String(t).split(/\r?\n/).filter(Boolean).slice(-1)[0] || '(no output)';

// rows per table (counts, never rows) of the schemas we own or restore; one psql session, read only
const COUNT_SCHEMAS = ['public', 'auth', 'storage', 'ops'];
const countsSql = `select format('select %L, count(*) from %I.%I', schemaname || '.' || tablename, schemaname, tablename) from pg_tables where schemaname in (${COUNT_SCHEMAS.map(s => `'${s}'`).join(',')}) order by 1 \\gexec`;
export function parseCounts(out) {
  const m = new Map();
  for (const l of String(out).split(/\r?\n/)) { const x = /^([a-z_.0-9]+)\|(\d+)$/.exec(l.trim()); if (x) m.set(x[1], Number(x[2])); }
  return m;
}
// the restored count must lie between what the source held before the dump started and after the restore ended (the source moves a little)
export function compareCounts(before, after, restored) {
  const fewer = [], more = [], moved = [];
  for (const [t, b] of before) {
    const a = after.get(t) ?? b, r = restored.get(t);
    if (r === undefined) { fewer.push(`${t} missing`); continue; }
    if (r < b) fewer.push(`${t} ${r} of ${b}`);
    else if (r > a) more.push(`${t} ${r} but the source has ${a}`);
    if (a !== b) moved.push(t);
  }
  return { fewer, more, moved };
}

export async function drill(argv, env = process.env, log = console.log) {
  const o = { db: null, dump: null, key: null, slug: 'test-demo-a', limit: 120, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => { const x = argv[++i]; if (x === undefined || x.startsWith('--')) throw new Stop(2, `${a} needs a value`); return x; };
    if (a === '--db') o.db = v(); else if (a === '--dump') o.dump = resolve(v()); else if (a === '--key') o.key = resolve(v());
    else if (a === '--slug') o.slug = v(); else if (a === '--limit-minutes') o.limit = Number(v()); else if (a === '--keep') o.keep = true;
    else throw new Stop(2, `unknown argument ${a}`);
  }
  if (o.dump && o.db) throw new Stop(2, '--db and --dump are two ways to get the dump: give one');
  if (!o.dump) o.db = o.db || 'STAGING_DB_URL';
  if (o.db && !NAME_RE.test(o.db)) throw new Stop(2, '--db takes the NAME of a variable, not a URL');
  if (o.key && !o.dump) throw new Stop(2, '--key goes with --dump');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(o.slug)) throw new Stop(2, '--slug is a plain workspace slug');
  if (!(o.limit > 0)) throw new Stop(2, '--limit-minutes is a positive number');
  const url = o.db ? env[o.db] : null;
  if (o.db && !url) throw new Stop(3, `${o.db} is not set (read by name; node tools/with-env.mjs <env file> -- ...)`);
  if (o.dump && !existsSync(o.dump)) throw new Stop(2, `no such dump file`);
  if (o.key && !existsSync(o.key)) throw new Stop(2, `no such key file`);
  for (const t of ['pg_dump', 'pg_restore', 'psql', 'initdb', 'pg_ctl']) { const r = sh(t, ['--version']); if (r.error || r.status !== 0) throw new Stop(3, `${t} is not on PATH (PostgreSQL 15+ client and server binaries)`); }
  const designDir = join(REPO, 'sites', o.slug, 'design');
  if (!existsSync(designDir)) throw new Stop(3, `no look-folder at sites/${o.slug}/design`);

  const secrets = [url, env.PGPASSWORD].filter(s => s && s.length >= 4);
  if (url) { try { const u = new URL(url); [u.password, u.hostname, u.username].forEach(x => x && x.length >= 4 && secrets.push(x)); } catch { /* checked by pg_dump */ } }
  const scrub = t => { let s = String(t); for (const x of secrets) s = s.split(x).join('***'); return s; };

  const work = mkdtempSync(join(tmpdir(), 'omnikom-drill-'));
  const phases = [];
  const failures = [];
  let cluster = null;
  const t0 = Date.now();
  const phase = async (name, fn) => {
    const t = Date.now();
    let res;
    try { res = await fn(); } catch (e) { res = { ok: false, detail: scrub(e && e.message || e) }; }
    const secs = (Date.now() - t) / 1000;
    phases.push({ name, secs, ok: res.ok });
    if (!res.ok) failures.push(name);
    log(`${res.ok ? 'PASS' : 'FAIL'} ${name.padEnd(8)} ${fmt(secs).padStart(10)}  ${res.detail || ''}`);
    for (const l of res.more || []) log(`     ${l}`);
    return res;
  };
  const readSource = () => {
    const r = sh('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { env: pgEnv(url), input: `begin transaction read only;\n${countsSql}\ncommit;` });
    return r.status === 0 ? { ok: true, m: parseCounts(r.out) } : { ok: false, err: scrub(lastLine(r.err)) };
  };
  const cleanup = () => {
    if (cluster) sh('pg_ctl', ['-D', cluster.data, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' });
    if (!o.keep) rmSync(work, { recursive: true, force: true });
  };
  try {
    log(`restore drill ${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}: ${o.db ? `dump of ${o.db}` : 'dump file'}, site ${o.slug}, work folder in the system temp folder, limit ${o.limit} min`);
    let archive = join(work, 'drill.dump');

    // 1 dump
    let srcBefore = null;
    const dumpRes = await phase('dump', async () => {
      if (o.db) {
        const c0 = readSource();
        if (c0.ok) srcBefore = c0.m;
        const r = sh('pg_dump', ['--format=custom', '--no-owner', '--file', archive], { env: pgEnv(url) });
        if (r.status !== 0) return { ok: false, detail: `pg_dump failed: ${scrub(lastLine(r.err))}` };
        return { ok: true, detail: `pg_dump of the source, ${statSync(archive).size} bytes (custom format, with privileges, read only)` };
      }
      if (o.key) {
        const r = sh('openssl', ['cms', '-decrypt', '-binary', '-inform', 'DER', '-in', o.dump, '-inkey', o.key, '-out', archive]);
        if (r.status !== 0) return { ok: false, detail: `openssl cms -decrypt failed: ${scrub(lastLine(r.err))}` };
        return { ok: true, detail: `decrypted ${statSync(o.dump).size} bytes to a ${statSync(archive).size}-byte archive` };
      }
      archive = o.dump;
      return { ok: true, detail: `plain archive ${statSync(archive).size} bytes` };
    });
    if (!dumpRes.ok) throw new Stop(1, 'no dump, nothing to restore');
    const toc = sh('pg_restore', ['--list', archive]);
    if (toc.status !== 0) throw new Stop(1, `the archive does not read: ${scrub(lastLine(toc.err))}`);
    const entries = (toc.out.match(/^\d+; /gm) || []).length;
    const hasAcl = /^\d+; \d+ \d+ ACL /m.test(toc.out);
    log(`     archive: ${entries} entries, grants ${hasAcl ? 'present' : 'ABSENT (a dump made without privileges: the walls phase is expected to fail)'}`);

    // 2 cluster
    const cl = await phase('cluster', async () => {
      const data = join(work, 'pgdata');
      const port = String(55000 + Math.floor(Math.random() * 900));
      let r = sh('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8']);
      if (r.status !== 0) return { ok: false, detail: `initdb failed: ${lastLine(r.err || r.out)}` };
      r = sh('pg_ctl', ['-D', data, '-o', `-p ${port} -k ""`, '-l', join(work, 'pg.log'), '-w', 'start'], { stdio: 'ignore' });   // piped output would be held open by the server
      if (r.status !== 0) return { ok: false, detail: `pg_ctl start failed: ${lastLine(r.err || r.out)}` };
      cluster = { data, port };
      const v = sh('psql', ['-h', '127.0.0.1', '-p', port, '-U', 'postgres', '-d', 'postgres', '-Atc', 'show server_version']);
      return { ok: true, detail: `PostgreSQL ${v.out.trim()} on port ${port}, folder ${work.split(/[\\/]/).slice(0, -1).join('/')}/...` };
    });
    if (!cl.ok) throw new Stop(1, 'no cluster');
    const base = ['-h', '127.0.0.1', '-p', cluster.port, '-U', 'postgres'];
    const psql = (db, args, input) => sh('psql', [...base, '-d', db, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], { input });
    const q = (db, text) => { const r = psql(db, ['-At'], text); return { ok: r.status === 0, out: r.out.trim(), err: lastLine(r.err) }; };

    // roles the dump names
    const sqlText = sh('pg_restore', ['--schema-only', '-f', '-', archive]).out;
    const roles = rolesIn(sqlText);
    const mkRoles = roles.map(r => `do $$ begin if not exists (select from pg_roles where rolname = '${r}') then create role "${r}" nologin${r === 'service_role' ? ' bypassrls' : ''}; end if; end $$;`).join('\n');
    const rr = q('postgres', mkRoles || 'select 1');
    if (!rr.ok) throw new Stop(1, `could not create the roles the dump names: ${rr.err}`);

    // 3 restore
    const restore = (db, extra) => {
      q('postgres', `create database ${db}`);
      const r = sh('pg_restore', [...base, '-d', db, '--no-owner', ...extra, archive]);
      return { r, parsed: parseRestoreErrors(r.err) };
    };
    const full = await phase('restore', async () => {
      const { r, parsed } = restore('restored', []);
      const more = [];
      const kinds = new Map();
      for (const e of parsed.expected) kinds.set(e.command.split(/\s+/).slice(0, 3).join(' '), (kinds.get(e.command.split(/\s+/).slice(0, 3).join(' ')) || 0) + 1);
      if (parsed.expected.length) more.push(`expected here (no pg_cron, pg_net, pgmq, Supabase Vault in plain Postgres): ${parsed.expected.length} errors, all about those four extensions, their schemas and their rows (${[...kinds].map(([k, n]) => `${k} x${n}`).slice(0, 6).join('; ')}${kinds.size > 6 ? '; ...' : ''})`);
      for (const e of parsed.unexpected.slice(0, 8)) more.push(`UNEXPECTED: ${e.message} | ${e.command}`);
      const consistent = parsed.ignored === null ? parsed.errors.length === 0 : parsed.ignored === parsed.errors.length;
      if (!consistent) more.push(`pg_restore counted ${parsed.ignored} ignored errors, ${parsed.errors.length} were read from its output`);
      const ok = (r.status === 0 || parsed.ignored !== null) && parsed.unexpected.length === 0 && consistent;
      return { ok, detail: ok ? `restored into database "restored"; ${parsed.expected.length} expected errors, 0 unexpected` : `restore failed: ${parsed.unexpected.length} unexpected error(s)`, more };
    });

    // 4 counts
    const cnt = full.ok ? await phase('counts', async () => {
      const r = psql('restored', ['-t', '-A'], countsSql);
      if (r.status !== 0) return { ok: false, detail: `could not count: ${scrub(lastLine(r.err))}` };
      const mine = parseCounts(r.out);
      const total = [...mine.values()].reduce((a, b) => a + b, 0);
      const more = [...mine].filter(([, n]) => n > 0).map(([tb, n]) => `${tb} ${n}`);
      let detail = `${mine.size} tables, ${total} rows in all (the non-empty tables below)`;
      let ok = true;
      if (o.db) {
        const after = readSource();
        if (!srcBefore || !after.ok) { ok = false; detail = `could not count the source: ${(after && after.err) || 'before the dump'}`; }
        else {
          const c = compareCounts(srcBefore, after.m, mine);
          if (c.fewer.length || c.more.length) { ok = false; detail = `restored counts differ from the source: ${[...c.fewer.map(x => 'fewer rows ' + x), ...c.more.map(x => 'more rows ' + x)].join('; ')}`; }
          else detail += `; every table lies between the source count before the dump and after the restore${c.moved.length ? ` (WARN: ${c.moved.join(', ')} changed meanwhile)` : ' (the source did not change)'}`;
        }
      }
      return { ok, detail, more };
    }) : { ok: false };

    // 5 structural checks on the restored data
    if (full.ok) await phase('checks', async () => {
      const rls = q('restored', "select coalesce(string_agg(c.relname, ', '), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity");
      const nv = q('restored', 'select count(*) from pg_constraint where not convalidated');
      const tables = q('restored', "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'");
      if (!rls.ok || !nv.ok || !tables.ok) return { ok: false, detail: `a check could not run: ${rls.err || nv.err || tables.err}` };
      const ok = rls.out === '' && nv.out === '0' && Number(tables.out) > 0;
      return { ok, detail: ok ? `${tables.out} public tables, all with row level security on; 0 constraints NOT VALID` : `row level security off on: ${rls.out || '(none)'}; constraints NOT VALID: ${nv.out}; public tables: ${tables.out}` };
    });

    // 6 the walls, on the restored schema
    await phase('walls', async () => {
      const { parsed } = restore('walls', ['--schema-only']);
      if (parsed.unexpected.length) return { ok: false, detail: `the schema restore gave ${parsed.unexpected.length} unexpected error(s): ${parsed.unexpected[0].message}` };
      for (const [n, t] of [['storage', 'buckets'], ['public', 'platform_limits']]) {
        const x = sh('pg_restore', [...base, '-d', 'walls', '--no-owner', '--data-only', '-n', n, '-t', t, archive]);
        if (x.status !== 0) return { ok: false, detail: `the reference rows of ${n}.${t} did not restore: ${lastLine(x.err)}` };
      }
      const r = psql('walls', [], readFileSync(join(REPO, 'supabase', 'tests', 'tenancy.test.sql'), 'utf8'));
      const passed = r.status === 0 && /ALL TENANCY TESTS PASSED/.test(r.out);
      if (passed) return { ok: true, detail: 'tenancy.test.sql (unchanged, rolled back): ALL TENANCY TESTS PASSED on the restored schema' };
      const why = `${r.err}`.split(/\r?\n/).filter(l => /ERROR|EXPECTED|assert/i.test(l)).slice(0, 2).map(l => l.replace(/^psql:[^:]*:\d+: /, '')).join(' | ');
      return { ok: false, detail: `tenancy.test.sql FAILED on the restored schema: ${why || lastLine(r.err)}${hasAcl ? '' : ' (this dump holds no grants)'}` };
    });

    // 7 build the site from the restored rows
    if (full.ok) await phase('build', async () => {
      const job = q('restored', `select j.id from public.publish_jobs j join public.workspaces w on w.id = j.workspace_id where w.slug = '${o.slug}' and j.state = 'done' and j.snapshot is not null order by j.created_at desc limit 1`);
      if (!job.ok) return { ok: false, detail: `could not look for a job: ${job.err}` };
      if (!/^[0-9a-f-]{36}$/.test(job.out)) return { ok: false, detail: `the restored copy holds no finished publish job for the site "${o.slug}"` };
      const b = q('restored', `select service.export_bundle('${job.out}'::uuid)::text`);
      if (!b.ok) return { ok: false, detail: `export_bundle failed: ${b.err}` };
      let bundle; try { bundle = JSON.parse(b.out); } catch { return { ok: false, detail: 'export_bundle did not return JSON' }; }
      const exp = shapeExport(bundle);
      const exportFile = join(work, 'export.json'), mediaDir = join(work, 'media'), outDir = join(work, 'site');
      writeFileSync(exportFile, JSON.stringify(exp));
      mkdirSync(mediaDir, { recursive: true });
      const logo = join(REPO, 'sites', 'test-demo-a', 'media', 'logo.png');
      for (const m of exp.media) { const dest = join(mediaDir, ...m.path.split('/')); mkdirSync(dirname(dest), { recursive: true }); copyFileSync(logo, dest); }
      const builtAt = String(bundle.job.created_at).replace(/\.\d+/, '').replace(/\+00(:00)?$/, 'Z').replace(' ', 'T');
      const r = sh(process.execPath, [join(REPO, 'factory', 'build.mjs'), '--export', exportFile, '--out', outDir, '--design', designDir, '--media', mediaDir, '--built-at', /Z$|[+-]\d\d:\d\d$/.test(builtAt) ? builtAt : `${builtAt}Z`], { cwd: REPO });
      if (r.status !== 0) return { ok: false, detail: `factory/build.mjs exit ${r.status}: ${scrub(lastLine(r.err || r.out))}` };
      const built = /BUILT (\d+) pages \((\d+) contract pages \+ (\d+) item pages\)/.exec(r.out);
      const htmlCount = (function walk(d) { let n = 0; for (const e of readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? walk(join(d, e.name)) : /\.html$/.test(e.name) ? 1 : 0; return n; })(outDir);
      const home = existsSync(join(outDir, 'index.html'));
      const ok = !!built && home && htmlCount >= Number(built[1]);
      return { ok, detail: ok ? `job ${job.out.slice(0, 8)}: ${bundle.rows.length} rows, ${exp.media.length} media (stand-in logo), factory built ${built[1]} pages (${built[2]} contract + ${built[3]} item), ${htmlCount} html files, index.html present` : `build output not as expected: ${lastLine(r.out)}; html files ${htmlCount}; index.html ${home}` };
    });
  } catch (e) {
    if (!(e instanceof Stop)) failures.push(`crash: ${scrub(e && e.message || e)}`);
    else if (e.code === 1) failures.push(scrub(e.message));
    else { cleanup(); throw e; }
  } finally { cleanup(); }
  const total = (Date.now() - t0) / 1000;
  log(`total ${fmt(total)} (target under ${o.limit / 60 >= 1 ? `${o.limit / 60} hours` : `${o.limit} min`})`);
  if (total > o.limit * 60) failures.push(`total time over the limit of ${o.limit} min`);
  log(failures.length ? `DRILL FAIL: ${failures.join('; ')}` : `DRILL PASS: ${phases.length} phases, ${fmt(total)}`);
  return { exit: failures.length ? 1 : 0, failures, phases, total };
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isMain()) {
  try { const r = await drill(process.argv.slice(2)); process.exit(r.exit); }
  catch (e) { console.error(e instanceof Stop ? `${e.code === 3 ? 'BLOCKED' : 'usage'}: ${e.message}` : `drill crashed: ${e && e.message}`); process.exit(e instanceof Stop ? e.code : 1); }
}
