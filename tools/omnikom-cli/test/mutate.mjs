// Watched-fail for the CLI: make a broken COPY of the CLI with ONE rule removed, run test/run.mjs against it, and require the
// suite to go red. A mutant that stays green means no test measures that rule.
//   node tools/omnikom-cli/test/mutate.mjs [--only <name substring>]     exit 0 = every mutant caught
// The pattern of tools/crm-map/test/mutate.mjs: a copy in a temp dir (OMNIKOM_CLI_DIR points the tests at it, OMNIKOM_REPO_ROOT
// keeps the real repository for the files the CLI reuses), one child process per mutant (a hang is cut off by the timeout and
// counts as caught), [name, file, exactText, replacement, suite] with the text occurring exactly once in the file, applied with
// split(a).join(b) (no `$` replacement patterns). A layered rule gives a list of [text, replacement] pairs in place of the two. `suite` is the part of run.mjs that must go red: unit (no database) or db.
// One throwaway Postgres cluster is started here and shared; every database mutant run makes its own database in it.
// Not mutated, because a second layer makes the first unobservable: the key printed by `key mint` (lib/redact.mjs masks it;
// the redaction mutants prove that layer), and registerSecret() in key mint (same reason).
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startCluster } from './harness.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.OMNIKOM_REPO_ROOT ? resolve(process.env.OMNIKOM_REPO_ROOT) : resolve(CLI, '..', '..');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const R = String.raw;

const MUTANTS = [
  // ---- rule 1: the CLI never prints a secret (lib/redact.mjs and what feeds it)
  ['render skips the redaction', 'lib/redact.mjs', "=> redact(JSON.stringify(obj, null, compact ? 0 : 2), env) + '\\n';", "=> JSON.stringify(obj, null, compact ? 0 : 2) + '\\n';", 'unit'],
  ['exact secret values are not replaced', 'lib/redact.mjs', 's = s.split(value).join(`<redacted:${label}>`);', '', 'unit'],
  ['the JSON-escaped form is not replaced', 'lib/redact.mjs', 'if (escaped !== value) s = s.split(escaped).join(`<redacted:${label}>`);', '', 'unit'],
  ['a 64-digit hex (signature, key) is not redacted by shape', 'lib/redact.mjs', R`  [/\b[0-9a-fA-F]{64}\b/g, '<hex64 redacted>'],`, '', 'unit'],
  ['a connection string is not redacted by shape', 'lib/redact.mjs', R`  [/\b(postgres(?:ql)?):\/\/[^\s"'<>]+/gi, '$1://<redacted>'],`, '', 'unit'],
  ['the password inside a connection string is not extracted', 'lib/redact.mjs', 'for (const p of urlParts(value)) if (p.length >= MIN_LEN) out.set(p, name);', '', 'unit'],
  ['DB_URL variables are not treated as secret by name', 'lib/redact.mjs', 'PASSWD|DB_URL|SIGNING', 'PASSWD|SIGNING', 'unit'],
  ['key list shows the whole hash', 'commands/key.mjs', 'left(k.key_hash, 12) as hash_prefix', 'k.key_hash as hash_prefix', 'db'],
  // ---- rule 2: production is read-only except apply --i-mean-production; identity, seed and verify are refused
  ['production allows seed too', 'lib/target.mjs', "new Set(['status', 'apply'])", "new Set(['status', 'apply', 'seed'])", 'unit'],
  ['the production guard does nothing', 'lib/target.mjs', "  if (targetName !== 'production') return;", '  return;', 'unit'],
  ['production apply needs no --i-mean-production', 'lib/target.mjs', "if (command === 'apply' && !flags['i-mean-production']) throw new Blocked(", 'if (false) throw new Blocked(', 'unit'],
  ['the entry never calls the production guard', 'omnikom.mjs', '    guardProduction(flags.target, command, flags);\n', '', 'unit'],
  ['status opens a writable connection', 'lib/sql.mjs', 'const text = readOnly && !/^begin/i.test(script) ?', 'const text = false && !/^begin/i.test(script) ?', 'unit'],
  ['production apply does not pass --url-env PROD_DB_URL', 'commands/apply.mjs', "if (production) args.push('--url-env', 'PROD_DB_URL', '--i-mean-production');", '', 'unit'],
  ['staging may equal PROD_DB_URL', 'lib/target.mjs', "if (name !== 'production' && env.PROD_DB_URL && env.PROD_DB_URL === dbUrl) throw new Blocked(", 'if (false) throw new Blocked(', 'unit'],
  ['local may point at another machine', 'lib/target.mjs', "if (name === 'local' && !isLoopback(host)) throw new Blocked(", 'if (false) throw new Blocked(', 'unit'],
  // ---- rule 3: fixtures are synthetic
  ['a real-looking email passes as a fixture', 'lib/fixtures.mjs', 'if (/^e-?mail$/i.test(k) && v && !SYNTHETIC_EMAIL.test(v)) why.push(', 'if (false) why.push(', 'unit'],
  ['a real-looking phone passes as a fixture', 'lib/fixtures.mjs', 'if (/^(phone|mobile|tel)$/i.test(k) && v && !SYNTHETIC_PHONE.test(v)) why.push(', 'if (false) why.push(', 'unit'],
  ['a fixture outside the folder needs no --real', 'lib/fixtures.mjs', '    if (!real) throw new Usage(`a fixture must live in', '    if (false) throw new Usage(`a fixture must live in', 'unit'],
  ['--real prints no warning', 'lib/fixtures.mjs', "warnings.push('--real: this file is outside the fixtures folder and may hold client data; it is sent to the target as it is');", '', 'unit'],
  // ---- rule 4: retry-safe commands
  ['seed test: Agent One is seeded again every run', 'commands/seed.mjs', 'if t1 is null then t1 := service.seed_version(', 'if true then t1 := service.seed_version(', 'db'],
  ['seed test: logins are inserted again every run', 'commands/seed.mjs', 'values ${users} on conflict (id) do nothing;', 'values ${users};', 'db'],
  ['seed test: contracts are inserted again every run', 'commands/seed.mjs', 'where not exists (select 1 from site_contracts c where c.workspace_id = v.ws);', 'where true;', 'db'],
  ['seed workspace: pages are seeded again every run', 'commands/seed.mjs', "if not exists (select 1 from content_rows c join content_versions v on v.row_id = c.id and v.n = 1 where c.workspace_id = ws and c.collection = 'pages'", "if true or not exists (select 1 from content_rows c join content_versions v on v.row_id = c.id and v.n = 1 where c.workspace_id = ws and c.collection = 'pages'", 'db'],
  ['seed test --clean fails on a login that is still referenced', 'commands/seed.mjs', 'exception when foreign_key_violation then null; ', '', 'db'],
  ['lead send --retry does not count the stored rows', 'commands/lead.mjs', 'const duplicate = f.retry && stored !== null && stored !== 1;', 'const duplicate = false;', 'db'],
  ['lead send --retry sends only once', 'commands/lead.mjs', 'i < (f.retry ? 2 : 1)', 'i < 1', 'unit'],
  ['verify does not check that a retry stored one row', 'commands/verify.mjs', 'r.status === 202 && rows(L.idem) === 1,', 'r.status === 202,', 'db'],
  ['verify does not check that a retry alerts once', 'commands/verify.mjs', 'r.status, alerts(L.idem) <= 1,', 'r.status, true,', 'db'],
  // ---- rule 5: the canonical signature
  ['the signature is not the endpoint\'s', 'lib/sign.mjs', 'export const sign = endpoint.sign;', 'export const sign = (key, method, p, body, t) => endpoint.sign(key, method, p, body, t + 1);', 'unit'],
  ['a site signs with the runner header', 'lib/sign.mjs', "name: 'x-site-signature'", "name: 'x-runner-signature'", 'unit'],
  ['the query string is not signed', 'lib/fn.mjs', 'await authHeader(identity, key, method, path, body, t);', "await authHeader(identity, key, method, '/' + name, body, t);", 'unit'],
  // ---- exit codes, targets, identities, usage
  ['a mismatch exits 0', 'omnikom.mjs', 'exit: matched ? 0 : 1', 'exit: 0', 'unit'],
  ['--expect is ignored', 'omnikom.mjs', 'const matched = expect !== null ? res.code === expect : res.ok;', 'const matched = res.ok;', 'unit'],
  ['usage exits 1', 'omnikom.mjs', "code: 'USAGE', exit: 2", "code: 'USAGE', exit: 1", 'unit'],
  ['BLOCKED exits 1', 'omnikom.mjs', "code: 'BLOCKED', exit: 3", "code: 'BLOCKED', exit: 1", 'unit'],
  ['a missing target variable is not BLOCKED', 'lib/target.mjs', '  if (needDb && !dbUrl) throw new Blocked(', '  if (false) throw new Blocked(', 'unit'],
  ['a missing machine key is not BLOCKED', 'lib/identity.mjs', '  if (!value) throw new Blocked(', '  if (false) throw new Blocked(', 'unit'],
  ['person tokens are handed out', 'lib/identity.mjs', 'export function personToken(identity) {\n  throw new Blocked(', "export function personToken(identity) {\n  return 'token'; throw new Blocked(", 'unit'],
  ['staff act without MFA', 'lib/identity.mjs', "workspace: null, aal: 'aal2' }", "workspace: null, aal: 'aal1' }", 'unit'],
  ['a flag without a value is accepted', 'lib/args.mjs', "if (value === undefined || value.startsWith('--')) throw new Usage(", 'if (false) throw new Usage(', 'unit'],
  ['a uuid is not checked before it enters SQL', 'lib/sql.mjs', 'if (!isUuid(v)) throw new Usage(', 'if (false) throw new Usage(', 'unit'],
  ['a quote in a value is not doubled', 'lib/sql.mjs', 's.replace(/\'/g, "\'\'")', 's', 'unit'],
  ['the connection password goes nowhere', 'lib/sql.mjs', 'if (u.password) e.PGPASSWORD = decodeURIComponent(u.password);', '', 'unit'],
  ['platform error codes are not extracted', 'lib/sql.mjs', 'const m = /^([A-Z]{1,2}-[A-Z0-9-]+)/.exec(message);', 'const m = null;', 'unit'],
  ['a runner can send a website lead', 'commands/lead.mjs', "if (identity.kind !== 'site') throw new Usage(", 'if (false) throw new Usage(', 'unit'],
  // ---- the SQL path acts AS the person (claims), so the database walls decide
  ['lead list runs without the person\'s claims', 'commands/lead.mjs', 'order by created_at desc limit ${limit}`, { claims: claimsFor(id) });', 'order by created_at desc limit ${limit}`);', 'db'],
  ['lead get runs without the person\'s claims', 'commands/lead.mjs', 'from leads where id = ${uuidLit(lead)}`, { claims });', 'from leads where id = ${uuidLit(lead)}`);', 'db'],
  ['content get runs without the person\'s claims', 'commands/content.mjs', 'where r.id = ${uuidLit(row)}`, { claims: claimsFor(id) });', 'where r.id = ${uuidLit(row)}`);', 'db'],
  ['job get runs without the person\'s claims', 'commands/publish.mjs', 'const claims = identity ? { claims: claimsFor(identity) } : {};', 'const claims = {};', 'db'],
  ['content save skips the validator', 'commands/content.mjs', "if (problems.length) return result(false, problems[0].code, { as: id.name, problems: problems.slice(0, 20), stored: false });", '', 'db'],
  ['content save skips the contract_for outsider check', 'commands/content.mjs', '  if (!c.ok) return fromSql(c, { as: id.name });', '', 'db'],
  ['job wait hangs on a finished job', 'commands/publish.mjs', "if (TERMINAL.includes(state)) return result(false, 'JOB-' + state.toUpperCase(), { job, state, error: r.job.error });", '', 'db'],
  ['key mint writes without an env file to receive the value (both layers)', 'commands/key.mjs', [['if (!dry && (!envFile || !existsSync(envFile))) throw new Blocked(', 'if (false) throw new Blocked('], ["if (!dry) { try { accessSync(envFile, constants.W_OK); } catch { throw new Blocked('the env file is not writable', 'fix the file permissions'); } }", '']], null, 'db'],
  ['seed workspace accepts an invalid contract', 'commands/seed.mjs', 'if (problems.length) return result(false, problems[0].code, { problems: problems.slice(0, 20), total: problems.length });', '', 'db'],
  ['status ignores a changed migration', 'commands/status.mjs', 'const ok = mismatched.length === 0;', 'const ok = true;', 'db'],
  // ---- what key mint stores is what the function's lookup finds (the model reads service.active_key + the Vault view)
  ['key mint registers the key without its site', 'commands/key.mjs', "select s.id, s.workspace_id, 'site-signing'", "select null, s.workspace_id, 'site-signing'", 'db'],
  ['key mint registers a Vault name that does not exist', 'commands/key.mjs', "${lit(hash)}, ${lit(vaultName)}, jsonb_build_object('site', s.id)", "${lit(hash)}, ${lit(vaultName + '-x')}, jsonb_build_object('site', s.id)", 'db'],
  // ---- verify --only walls
  ['walls: any answer from a service function counts as refused', 'commands/verify.mjs', 'const refused = s => s === 401 || s === 403 || s === 404 || s === 406;', 'const refused = s => true;', 'db'],
  ['walls: rows returned to anon count as nothing', 'commands/verify.mjs', "const empty = r => r.status === 200 && Array.isArray(r.json) && r.json.length === 0;", "const empty = r => r.status === 200;", 'db'],
  ['walls: no anon key still runs', 'commands/verify.mjs', "  if (!anon) throw new Blocked(`${keyVar} is not set", "  if (false) throw new Blocked(`${keyVar} is not set", 'db'],
  // ---- verify keeps its promises
  ['verify exits 0 whatever failed', 'commands/verify.mjs', "result(failed === 0, failed === 0 ? 'ok' : 'VERIFY-FAILED', {", "result(true, 'ok', {", 'db'],
  ['verify does not check B\'s key', 'commands/verify.mjs', 'add("B\'s key on A\'s site is refused", \'401\', r.status, r.status === 401 && rows(L.idem) === 0);', 'add("B\'s key on A\'s site is refused", \'401\', r.status, true);', 'db'],
  ['verify replays with a fresh timestamp', 'commands/verify.mjs', 'r = await post({ ...L, t: ctx.now() - 301 });', 'r = await post({ ...L, t: ctx.now() });', 'db'],
  ['verify forgets to put a paused site back', 'commands/verify.mjs', '  } finally {\n    sql.exec(`update sites set state = ', '  } finally {\n    0 && sql.exec(`update sites set state = ', 'db'],
  ['verify leaves its leads behind', 'commands/verify.mjs', '  for (const k of created) sql.exec(', '  for (const k of []) sql.exec(', 'db'],
  ['verify sends the "unsigned" request signed', 'commands/verify.mjs', 'r = await post({ ...L, headers: {} });', 'r = await post({ ...L });', 'db'],
];

const sh = (args, env) => new Promise(res => {
  const c = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { err += d; });
  const timer = setTimeout(() => { c.kill(); }, 600000);
  c.on('close', code => { clearTimeout(timer); res({ status: code, out, err }); });
});

const cluster = startCluster();
const env = { OMNIKOM_TEST_CLUSTER_PORT: String(cluster.port), OMNIKOM_REPO_ROOT: REPO };
const copies = [];
const copyCli = () => { const d = mkdtempSync(join(tmpdir(), 'omnikom-cli-mut-')); copies.push(d); cpSync(CLI, d, { recursive: true }); return d; };
let missing = 0, survived = 0, done = 0;

async function runMutant([name, file, find, repl, suite]) {
  const dir = copyCli();
  const target = join(dir, file);
  const src = readFileSync(target, 'utf8');
  const pairs = Array.isArray(find) ? find : [[find, repl]];   // a layered rule has several lines; the mutant removes them all
  const counts = pairs.map(([a]) => src.split(a).length - 1);
  if (counts.some(n => n !== 1)) { missing++; console.log(`MISSING  ${name.padEnd(62)} (target text found ${counts.join('/')} times in ${file})`); return; }
  const mutated = pairs.reduce((s, [a, b]) => s.split(a).join(b), src);
  if (mutated === src) { missing++; console.log(`MISSING  ${name.padEnd(62)} (the replacement changed nothing)`); return; }
  writeFileSync(target, mutated);
  const r = await sh([join(dir, 'test', 'run.mjs'), suite === 'unit' ? '--unit' : '--db'], { ...env, OMNIKOM_CLI_DIR: dir });
  const fails = r.out.split('\n').filter(l => l.startsWith('FAIL'));
  const caught = r.status !== 0;
  if (!caught) survived++;
  const why = fails[0] ? fails[0].slice(5, 100) : (r.err || '').split('\n').find(Boolean) || 'non-zero exit, no FAIL line';
  console.log(`${caught ? 'caught  ' : 'SURVIVED'} ${name.padEnd(62)} ${caught ? `(${suite}: ${fails.length} red: ${why})` : `(${suite})`}`);
  done++;
}

try {
  // the unbroken copy must pass first, or "caught" would mean nothing
  const base = copyCli();
  const b = await sh([join(base, 'test', 'run.mjs')], { ...env, OMNIKOM_CLI_DIR: base });
  if (b.status !== 0) { console.log(`BASELINE FAILS: the unbroken copy does not pass\n${b.out.split('\n').filter(l => l.startsWith('FAIL')).join('\n')}${b.err}`); process.exitCode = 1; }
  else {
    console.log(`baseline: ${b.out.trim().split('\n').pop()}`);
    const list = MUTANTS.filter(m => !only || m[0].includes(only));
    const queue = [...list];
    const workers = Array.from({ length: 3 }, async () => { while (queue.length) await runMutant(queue.shift()); });
    await Promise.all(workers);
    console.log(`\n${list.length} mutants, ${list.length - survived - missing} caught, ${survived} survived, ${missing} target text missing`);
    process.exitCode = survived || missing ? 1 : 0;
  }
} finally {
  cluster.stop();
  for (const d of copies) rmSync(d, { recursive: true, force: true });
}
