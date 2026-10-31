// promote-check: may these migrations go to the target database? (10-DELIVERY section 5 step 4, DECISIONS 27 and 29)
//   node supabase/ops/promote-check.mjs --proven STAGING_DB_URL --target PROD_DB_URL [--dry-run] [--expect-pending N] [--migrations <dir>]
//   node supabase/ops/promote-check.mjs functions                      the functions to deploy, comma separated (supabase/functions/*, not _shared or test)
//   node supabase/ops/promote-check.mjs smoke --ref PROD_SUPABASE_REF   read-only: every function answers (OPTIONS, no body, no key)
// Both database URLs are given by variable NAME and read from the environment; a value is never printed. Every connection is a
// read-only transaction (begin read only), so this script cannot change a database even by mistake.
//
// The check reads each database's applied-migration history and compares it with the repository's supabase/migrations/:
//   ledger   ops.platform_migrations (name, sha256, applied_at) written by supabase/apply-staging.mjs (what staging and production
//            use), else the legacy public.platform_migrations, else the Supabase CLI's supabase_migrations.schema_migrations
//            (version, name, statements). A database with no history at all counts as "nothing applied" (a new production project).
//   content  the ops ledger keeps a sha256 per file, so a file edited after it was proven is caught exactly. The CLI history keeps
//            statements instead: they are compared with the file with whitespace and semicolons ignored (UNPROVEN against a history
//            a real CLI wrote: no such database exists yet). A history that keeps neither is reported as not comparable.
// It prints the target's pending list and refuses (exit 1, one line each, code first) when:
//   R-PENDING-NOT-PROVEN    a pending file is not applied on the proven database
//   R-ORDER                 the order differs: a pending file sorts before one the target already applied, or a database applied
//                           its files in a different order than their names
//   R-TARGET-NOT-IN-REPO    the target applied a migration the repository does not have
//   R-TARGET-NOT-PROVEN     the target applied a migration the proven database does not have
//   R-PROVEN-NOT-IN-REPO    the proven database applied a migration the repository does not have
//   R-CONTENT               a file differs from what the proven database recorded (says: hash or statements)
//   R-CONTENT-TARGET        a file differs from what the target recorded
// Exit 0 = every pending file is proven, in order. Exit 2 = usage or a database that could not be read.
import { readdirSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPABASE = join(HERE, '..');
const VAR = /^[A-Z][A-Z0-9_]*$/;
const sha256 = text => createHash('sha256').update(text).digest('hex');
const norm = text => String(text).replace(/[\s;]+/g, '');
const short = h => (h ? `${h.slice(0, 12)}` : 'none');

// -------------------------------------------------------------------------------------------------------- repository files
export function readRepoMigrations(dir) {
  return readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(name => {
    const text = readFileSync(join(dir, name), 'utf8');   // read as utf8 text and hashed as that text, exactly like apply-staging.mjs
    return { name, sha: sha256(text), norm: norm(text) };
  });
}

// ------------------------------------------------------------------------------------------------------------ the database
export class DbError extends Error {}

// One read-only round trip. The SQL goes on stdin inside `begin read only`, so a write fails with "read-only transaction".
export function psqlReadOnly(url, sql, spawn = spawnSync) {
  const r = spawn('psql', [url, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], {
    input: `begin read only;\n${sql}\ncommit;\n`, encoding: 'utf8', timeout: 60000, windowsHide: true,
    env: { ...process.env, PGCONNECT_TIMEOUT: '15' },
  });
  if (r.error || r.status !== 0) {
    let pass = ''; try { pass = decodeURIComponent(new URL(url).password); } catch { /* not a URL we can parse */ }
    let msg = String((r.stderr || (r.error && r.error.message) || 'psql did not run')).trim();
    msg = msg.split(url).join('<db url>').replace(/postgres(ql)?:\/\/\S+/g, '<db url>');
    if (pass.length >= 3) msg = msg.split(pass).join('<password>');
    throw new DbError(msg.split(/\r?\n/).slice(0, 3).join(' | '));
  }
  return String(r.stdout || '').trim();
}

export function readLedger(url, exec = psqlReadOnly) {
  const have = JSON.parse(exec(url, `select json_build_object(
    'ops', to_regclass('ops.platform_migrations') is not null,
    'pub', to_regclass('public.platform_migrations') is not null,
    'sup', to_regclass('supabase_migrations.schema_migrations') is not null);`));
  if (have.ops || have.pub) {
    const table = have.ops ? 'ops.platform_migrations' : 'public.platform_migrations';
    const rows = JSON.parse(exec(url, `select coalesce(json_agg(json_build_object('name', name, 'sha256', sha256, 'at', applied_at) order by applied_at, name), '[]') from ${table};`));
    return { source: table, entries: rows.map(r => ({ name: r.name, sha256: r.sha256, statements: null, at: r.at })) };
  }
  if (have.sup) {
    const rows = JSON.parse(exec(url, `select coalesce(json_agg(json_build_object('version', version, 'name', name, 'statements', statements) order by version), '[]') from supabase_migrations.schema_migrations;`));
    return {
      source: 'supabase_migrations.schema_migrations',
      entries: rows.map(r => ({ name: `${r.version}_${r.name || ''}.sql`.replace('_.sql', '.sql'), sha256: null, statements: Array.isArray(r.statements) ? r.statements.join('\n') : null, at: r.version })),
    };
  }
  return { source: 'none (no history table: nothing applied)', entries: [] };
}

// ----------------------------------------------------------------------------------------------------------- the decision
// true = the file differs from what this entry recorded, false = same, null = the history cannot say
export function contentDiffers(entry, file) {
  if (entry.sha256) return entry.sha256 !== file.sha;
  if (entry.statements != null) return norm(entry.statements) !== file.norm;
  return null;
}
const how = (entry, file) => (entry.sha256 ? `recorded sha256 ${short(entry.sha256)}, file sha256 ${short(file.sha)}` : 'the recorded statements differ from the file');

export function evaluate({ files, proven, target }) {
  const refusals = [], notes = [];
  const fileBy = new Map(files.map(f => [f.name, f]));
  const pBy = new Map(proven.entries.map(e => [e.name, e]));
  const tBy = new Map(target.entries.map(e => [e.name, e]));
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const pending = files.filter(f => !tBy.has(f.name)).map(f => f.name);

  for (const name of pending) if (!pBy.has(name)) refusals.push(`R-PENDING-NOT-PROVEN: ${name} is pending on the target but not applied on the proven database`);

  // order: each database must have applied its files in file-name order, and nothing pending may sort before what the target has
  for (const [label, led] of [['proven database', proven], ['target', target]]) {
    const applied = led.entries.slice().sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : byName(a, b)));
    const byFile = led.entries.slice().sort(byName);
    for (let i = 0; i < applied.length; i++) {
      if (applied[i].name !== byFile[i].name) {
        refusals.push(`R-ORDER: the ${label} applied ${applied[i].name} before ${byFile[i].name}, but the file order is the other way`);
        break;
      }
    }
  }
  const lastTarget = target.entries.map(e => e.name).sort().pop();
  for (const name of pending) if (lastTarget && name < lastTarget) refusals.push(`R-ORDER: ${name} is pending but sorts before ${lastTarget}, which the target already applied`);

  for (const t of target.entries) {
    if (!fileBy.has(t.name)) refusals.push(`R-TARGET-NOT-IN-REPO: the target applied ${t.name}, the repository has no such file`);
    if (!pBy.has(t.name)) refusals.push(`R-TARGET-NOT-PROVEN: the target applied ${t.name}, the proven database did not`);
  }
  let blind = 0;
  for (const p of proven.entries) {
    const f = fileBy.get(p.name);
    if (!f) { refusals.push(`R-PROVEN-NOT-IN-REPO: the proven database applied ${p.name}, the repository has no such file`); continue; }
    const d = contentDiffers(p, f);
    if (d === true) refusals.push(`R-CONTENT: ${p.name} differs from what the proven database recorded (${how(p, f)})`);
    if (d === null) blind++;
  }
  for (const t of target.entries) {
    const f = fileBy.get(t.name);
    if (!f) continue;
    const d = contentDiffers(t, f);
    if (d === true) refusals.push(`R-CONTENT-TARGET: ${t.name} differs from what the target recorded (${how(t, f)})`);
    if (d === null) blind++;
  }
  if (blind) notes.push(`content not comparable for ${blind} entries (the history keeps neither a hash nor statements)`);
  return { pending, refusals, notes };
}

// ---------------------------------------------------------------------------------------------------- functions and smoke
export function functionNames(dir = join(SUPABASE, 'functions')) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('_') && d.name !== 'test').map(d => d.name).sort();
}

// A function "answers" when the gateway did not say NOT_FOUND and nothing crashed: OPTIONS carries no body and no key, changes nothing.
export function judgeSmoke(status, json) {
  if (status === 0) return { ok: false, why: 'no answer' };
  if (status === 404 && json && json.code === 'NOT_FOUND') return { ok: false, why: 'not deployed' };
  if (status >= 500) return { ok: false, why: `server error ${status}` };
  return { ok: true, why: String(status) };
}

export async function smoke(base, names, fetchImpl = globalThis.fetch) {
  const out = [];
  for (const name of names) {
    let status = 0, json = null;
    try {
      const res = await fetchImpl(`${base}/${name}`, { method: 'OPTIONS', signal: AbortSignal.timeout(20000) });
      status = res.status;
      try { json = JSON.parse(await res.text()); } catch { /* not JSON */ }
    } catch { status = 0; }
    out.push({ name, ...judgeSmoke(status, json) });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------ main
const usage = 'usage: promote-check.mjs --proven <VAR> --target <VAR> [--dry-run] [--expect-pending N] [--migrations <dir>] | functions | smoke --ref <VAR>';

export async function main(argv, env = process.env, log = console.log, err = console.error) {
  const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  if (argv[0] === 'functions') { log(functionNames().join(',')); return 0; }
  if (argv[0] === 'smoke') {
    const refVar = opt('--ref');
    if (!refVar || !VAR.test(refVar)) { err(usage); return 2; }
    const ref = env[refVar];
    if (!ref) { err(`set ${refVar} (the project ref; read by name)`); return 2; }
    if (!/^[a-z0-9]{10,40}$/.test(ref)) { err(`${refVar} is not a project ref`); return 2; }
    const results = await smoke(`https://${ref}.supabase.co/functions/v1`, functionNames());
    for (const r of results) log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}  ${r.why}`);
    const bad = results.filter(r => !r.ok).length;
    log(bad ? `SMOKE FAILED: ${bad} of ${results.length} functions did not answer` : `SMOKE OK: ${results.length} functions answered`);
    return bad ? 1 : 0;
  }

  const provenVar = opt('--proven'), targetVar = opt('--target');
  if (!provenVar || !targetVar || !VAR.test(provenVar) || !VAR.test(targetVar)) { err(usage); return 2; }
  const dry = argv.includes('--dry-run');
  const expect = opt('--expect-pending');
  if (expect !== null && !/^\d+$/.test(expect)) { err(usage); return 2; }
  const dir = opt('--migrations') || join(SUPABASE, 'migrations');
  const provenUrl = env[provenVar], targetUrl = env[targetVar];
  if (!provenUrl) { err(`set ${provenVar} (a database URL; read by name, never printed)`); return 2; }
  if (!targetUrl) { err(`set ${targetVar} (a database URL; read by name, never printed)`); return 2; }
  if (provenUrl === targetUrl && !dry) { err(`refusing: ${provenVar} and ${targetVar} are the same database (only --dry-run may compare a database with itself)`); return 2; }

  let files, proven, target;
  try { files = readRepoMigrations(dir); } catch (e) { err(`cannot read the migrations folder: ${String(e.message).split(dir).join('<dir>')}`); return 2; }
  try { proven = readLedger(provenUrl); } catch (e) { err(`cannot read ${provenVar}: ${e.message}`); return 2; }
  try { target = readLedger(targetUrl); } catch (e) { err(`cannot read ${targetVar}: ${e.message}`); return 2; }

  const { pending, refusals, notes } = evaluate({ files, proven, target });
  log(`${dry ? 'DRY RUN (reads only; this script never writes)\n' : ''}repository: ${files.length} migrations`);
  log(`proven ${provenVar}: ${proven.entries.length} applied (${proven.source})`);
  log(`target ${targetVar}: ${target.entries.length} applied (${target.source})`);
  log(`pending on the target: ${pending.length}`);
  for (const p of pending) log(`  ${p}`);
  for (const n of notes) log(`note: ${n}`);
  if (expect !== null && Number(expect) !== pending.length) refusals.push(`R-COUNT: expected ${expect} pending, found ${pending.length}`);
  if (refusals.length) {
    for (const r of refusals) log(`REFUSE ${r}`);
    log(`REFUSED: ${refusals.length} problem${refusals.length === 1 ? '' : 's'}; nothing may be promoted`);
    return 1;
  }
  log(`OK: ${pending.length} pending, all applied on the proven database, in order, with the recorded content`);
  return 0;
}

if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then(code => process.exit(code), e => { console.error(`promote-check crashed: ${e && e.message}`); process.exit(2); });
}
