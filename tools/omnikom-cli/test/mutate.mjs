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
// One run of the suite is cut off after this long (a hang counts as caught). 10 minutes was enough on a quiet laptop; the whole suite took
// 16 minutes on 2026-10-31 under load, so the baseline failed with no FAIL line. OMNIKOM_MUTANT_TIMEOUT_MS raises it (milliseconds).
const LIMIT_MS = Number(process.env.OMNIKOM_MUTANT_TIMEOUT_MS) || 600000;

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
  ['seed test: logins are inserted again every run', 'commands/seed.mjs', '  on conflict (id) do nothing;\nupdate auth.users set instance_id', '  ;\nupdate auth.users set instance_id', 'db'],
  ['seed test: logins written without aud and role (GoTrue cannot find them)', 'commands/seed.mjs', "uuidLit(P[n].sub)}, 'authenticated', 'authenticated', ${lit(P[n].email)}", "uuidLit(P[n].sub)}, null, null, ${lit(P[n].email)}", 'unit'],
  ['seed test: token columns left null (both layers: the insert and the repair)', 'commands/seed.mjs', [["${TOKEN_COLUMNS.map(() => \"''\").join(', ')}, ${lit(APP_META)}", "${TOKEN_COLUMNS.map(() => 'null').join(', ')}, ${lit(APP_META)}"], ["  ${TOKEN_COLUMNS.map(c => `${c} = coalesce(${c}, '')`).join(', ')},\n", ""]], null, 'db'],
  ['seed test: logins of the earlier seed are not repaired', 'commands/seed.mjs', '  where id in (${ids});`;', '  where false;`;', 'db'],
  ['seed test: nobody is not seeded', 'commands/seed.mjs', "'member-a2', 'staff', 'nobody'];", "'member-a2', 'staff'];", 'unit'],
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
  // ---- person sessions over HTTP (Auth generate_link + verify), the staff aal2 session, and verify --only people
  ['person token: an Auth refusal is ignored', 'lib/identity.mjs', "if (g.status !== 200 || !g.json || !g.json.hashed_token) throw new Blocked(", 'if (false) throw new Blocked(', 'unit'],
  ['person token: the session is not registered for masking', 'lib/identity.mjs', 'registerSecret(v.json.access_token, `session token ${identity.name}`);', '', 'unit'],
  ['person token: the token hash is not registered for masking', 'lib/identity.mjs', "registerSecret(g.json.hashed_token, 'magic-link token hash');", '', 'unit'],
  ['person token: staff stay at aal1', 'lib/identity.mjs', "if (identity.aal !== 'aal2' || aal1) return token;", 'return token;', 'unit'],
  ['person token: the admin key is not required', 'lib/identity.mjs', "  if (!secret) throw new Blocked(`${secretVar} is not set", "  if (false) throw new Blocked(`${secretVar} is not set", 'unit'],
  ['totp: the dynamic truncation offset is wrong', 'lib/totp.mjs', 'const o = h[h.length - 1] & 15;', 'const o = h[h.length - 1] & 7;', 'unit'],
  ['mfa verify uses a stale code (previous step)', 'lib/mfa.mjs', 'code: totp(secret, now)', 'code: totp(secret, now - 3600)', 'db'],
  ['people: owner B is not checked', 'commands/verify.mjs', `add("owner B reads A's leads -> 0 rows", '200, 0 rows', r.status, same(idsOf(r), []));`, `add("owner B reads A's leads -> 0 rows", '200, 0 rows', r.status, true);`, 'db'],
  ['people: a member seeing every lead is accepted', 'commands/verify.mjs', "add('member A1 sees only their own lead', \"200, the lead handed to them\", r.status, same(idsOf(r), [L1]));", "add('member A1 sees only their own lead', \"200, the lead handed to them\", r.status, true);", 'db'],
  ['people: the key registry is not checked for owners', 'commands/verify.mjs', "add('an owner reading the key registry gets nothing', '200, 0 rows', r.status, same(idsOf(r), []));", "add('an owner reading the key registry gets nothing', '200, 0 rows', r.status, true);", 'db'],
  ['people: the test leads are left behind', 'commands/verify.mjs', "    for (const id of made) sql.exec(`delete from leads where id = ${uuidLit(id)};`);   // events cascade", '', 'db'],
  ['people: staff without MFA may see keys', 'commands/verify.mjs', "add('staff without MFA (aal1) sees no key', '200, 0 rows', r.status, same(idsOf(r), []));", "add('staff without MFA (aal1) sees no key', '200, 0 rows', r.status, true);", 'db'],
  ['mfa enroll-staff: the secret is not written to the env file', 'commands/mfa.mjs', 'try { appendFileSync(envFile,', 'try { (() => {})(envFile,', 'db'],
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
  // ---- key mint numbering and the env file (one more than the highest number in the registry, the Vault and the env file's record line; a mint rewrites the file)
  ['key mint counts registry rows instead of taking the highest number (the old formula back)', 'commands/key.mjs', [['const have = sql.scalar(`greatest(${parts.join(\', \')})`);', 'const have = sql.scalar(`select count(*) from api_keys where site_id = ${uuidLit(site.id)} and kind = \'site-signing\'`);'], ['Math.max(Number(have.value), envHi) + 1', 'Number(have.value) + 1']], null, 'db'],
  ['key mint ignores the env file\'s record line when computing n', 'commands/key.mjs', 'Math.max(Number(have.value), envHi) + 1', 'Number(have.value) + 1', 'db'],
  ['key mint appends instead of rewriting (the removal of earlier lines dropped)', 'commands/key.mjs', 'if (rec.test(body) || val.test(body)) { if (at < 0) at = out.length; continue; }', '', 'db'],
  ['key mint ignores the Vault when computing n', 'commands/key.mjs', 'if (vaultThere.value === true) parts.push(highest(\'vault.secrets\', \'name\', \'\'));', '', 'db'],
  ['key mint ignores the registry when computing n', 'commands/key.mjs', 'const parts = [highest(\'api_keys\', \'vault_ref\', `site_id = ${uuidLit(site.id)} and kind = \'site-signing\' and `)];', 'const parts = [\'0\'];', 'db'],
  ['key mint rewrites the file with the wrong line ending (always LF)', 'commands/key.mjs', 'const eol = (/\\r?\\n/.exec(text) || [\'\\n\'])[0];', 'const eol = \'\\n\';', 'db'],
  ['key mint hides a Vault name collision (the name is silently changed when --n is given)', 'commands/key.mjs', 'const vaultName = `${prefix}${n}`;', 'const vaultName = `${prefix}${n}${ctx.flags.n ? \'x\' : \'\'}`;', 'db'],
  ['key mint reads the Vault even when there is none (a database without the Vault)', 'commands/key.mjs', 'if (vaultThere.value === true) parts.push(', 'if (true) parts.push(', 'db'],
  ['key mint env: a new key goes at the end with no blank line before it', 'commands/key.mjs', "if (out.length && bodyOf(out[out.length - 1]) !== '') out.push(eol);", '', 'unit'],
  // ---- verify --only lead asserts the ledgers of migration 7 (security_events, consent_ledger) and the 409 of a paused site
  ['verify does not check the security_events delta of the refused signatures', 'commands/verify.mjs', 'deltas.length === 4 && deltas.every(d => d === 1)', 'true', 'db'],
  ['verify does not check that a paused refusal is recorded as suspended', 'commands/verify.mjs', 'events(\'suspended\') - suspended === 1,', 'true,', 'db'],
  ['verify does not check the consent_ledger count of an accepted lead', 'commands/verify.mjs', '\'1 row\', r.status, consents(L.idem) === 1,', '\'1 row\', r.status, true,', 'db'],
  ['verify does not check that a retry adds no consent_ledger row', 'commands/verify.mjs', '\'still 1 row\', r.status, consents(L.idem) === 1,', '\'still 1 row\', r.status, true,', 'db'],
  ['verify: the paused check accepts any non-202 again', 'commands/verify.mjs', 'r.status === 409 && rows(L.idem) === 0', 'r.status !== 202 && rows(L.idem) === 0', 'db'],
  // ---- audit and gate (commands/audit.mjs): thin calls into tools/audit; a FAIL stays a FAIL, a crash is never a pass
  ['audit: the exit is forced to pass', 'commands/audit.mjs', "return result(r.pass, r.pass ? 'ok' : 'AUDIT-FAILED', r);", "return result(true, 'ok', r);", 'unit'],
  ['gate: the exit is forced to pass', 'commands/audit.mjs', "return result(data.pass, data.pass ? 'ok' : 'AUDIT-FAILED', data);", "return result(true, 'ok', data);", 'unit'],
  ['audit: the printed lines drop every FAIL line', 'commands/audit.mjs', 'const shown = d.lines.map(l => redact(l, env));', 'const shown = d.lines.filter(l => !isFail(l)).map(l => redact(l, env));', 'unit'],
  ['audit: the printed lines skip the redaction', 'commands/audit.mjs', 'const shown = d.lines.map(l => redact(l, env));', 'const shown = d.lines;', 'unit'],
  ['gate: the FAIL lines are not collected', 'commands/audit.mjs', 'const fails = r.lines.filter(isFail);', 'const fails = [];', 'unit'],
  ['gate: the FAIL lines are not printed', 'commands/audit.mjs', '    out.push(...d.fails.map(l => redact(l, env)));\n', '', 'unit'],
  ['gate: the printed FAIL lines skip the redaction', 'commands/audit.mjs', 'out.push(...d.fails.map(l => redact(l, env)));', 'out.push(...d.fails);', 'unit'],
  ['gate: a result that says fail is ignored when no line starts with FAIL', 'commands/audit.mjs', 'const pass = r.pass && fails.length === 0;', 'const pass = fails.length === 0;', 'unit'],
  ['audit and gate: --dir is optional (defaults to the current folder)', 'commands/audit.mjs', "const dir = resolve(need(f, 'dir'));", "const dir = resolve(f.dir === undefined ? '.' : f.dir);", 'unit'],
  ['audit and gate: any --target value is accepted (a database environment name reaches the engine) [small-fixes]', 'commands/audit.mjs', 'if (f.target !== undefined && !BUILD_TARGETS.includes(f.target)) throw new Usage(', 'if (false) throw new Usage(', 'unit'],
  ['audit and gate: --expect is accepted (a FAIL can be told to match)', 'commands/audit.mjs', 'if (f.expect !== undefined) throw new Usage(', 'if (false) throw new Usage(', 'unit'],
  ['gate: --only is accepted (a weaker gate)', 'commands/audit.mjs', 'if (!only && f.only !== undefined) throw new Usage(', 'if (false) throw new Usage(', 'unit'],
  ['audit: a stray argument is accepted', 'commands/audit.mjs', 'if (ctx.positionals.length > 1) throw new Usage(', 'if (false) throw new Usage(', 'unit'],
  ['audit: --only is not passed to the library', 'commands/audit.mjs', 'rules ? { rules } : {}', '{}', 'unit'],
  ['audit: empty --only ids are not dropped (the engine runs zero rules for an empty id and passes)', 'commands/audit.mjs', '.map(s => s.trim()).filter(Boolean);', '.map(s => s.trim());', 'unit'],
  ['audit: an empty --only is accepted', 'commands/audit.mjs', 'if (rules.length === 0) throw new Usage(', 'if (false) throw new Usage(', 'unit'],
  ['audit: the engine\'s refusal (unknown rule id) is a crash, not usage', 'commands/audit.mjs', "if (lib && typeof lib.AuditError === 'function' && e instanceof lib.AuditError) throw new Usage(message(e));", '', 'unit'],
  ['audit: a crash inside the library becomes a pass', 'commands/audit.mjs', "    throw new AuditCrash(`audit crashed: ${message(e)}`);\n  }\n  const shaped", "    return { pass: true, exit: 0, lines: [], pages: [], rules: [], findings: [] };\n  }\n  const shaped", 'unit'],
  ['audit: an unexpected throw in the command becomes a pass', 'commands/audit.mjs', "    throw new AuditCrash(`audit crashed: ${message(e)}`);\n  }\n};", "    return result(true, 'ok', { pass: true, exit: 0, lines: [], pages: [], rules: [], findings: [], fails: [] });\n  }\n};", 'unit'],
  ['audit: an unreadable library result is accepted', 'commands/audit.mjs', "if (!shaped) throw new AuditCrash(", 'if (false) throw new AuditCrash(', 'unit'],
  ['audit: pass with FAIL lines is accepted', 'commands/audit.mjs', "if (r.pass && r.lines.some(isFail)) throw new AuditCrash(", 'if (false) throw new AuditCrash(', 'unit'],
  ['audit: a crash exits 1 (reads like a FAIL)', 'omnikom.mjs', "code: 'AUDIT-CRASH', exit: 2", "code: 'AUDIT-CRASH', exit: 1", 'unit'],
  ['audit: a crash exits 0', 'omnikom.mjs', "code: 'AUDIT-CRASH', exit: 2", "code: 'AUDIT-CRASH', exit: 0", 'unit'],
  ['audit: the injected library is ignored', 'omnikom.mjs', "    if (deps.auditLib) ctx.auditLib = deps.auditLib;   // a test hands audit/gate a library that throws\n", '', 'unit'],
  ['audit and gate: text mode prints the JSON object', 'omnikom.mjs', "if ((first === 'audit' || first === 'gate') && obj.command", "if (false && obj.command", 'unit'],
  ['audit and gate: the result shows a target', 'omnikom.mjs', "const ctxUsesTarget = command => !['contract', 'audit', 'gate'].includes(command);", "const ctxUsesTarget = command => command !== 'contract';", 'unit'],
  ['audit: the summary line miscounts the FAIL lines', 'commands/audit.mjs', "${n('FAIL')} FAIL", "${n('WARN')} FAIL", 'unit'],
  ['audit and gate: a built folder with no --target is given a default target [4c-flip]', 'commands/audit.mjs', "return { dir, rules, target: f.target };", "return { dir, rules, target: f.target ?? 'production' };", 'unit'],
  // ---- tools.json, tools ensure and ci (DECISIONS 42): the checks that refuse before a byte is fetched, the hash and size after, the table that maps every ci.yml step
  ["tools ensure: the sha256 comparison is always true", "lib/tools.mjs", "const shaOk = actualSha === plat.sha256;", "const shaOk = true;", 'unit'],
  ["tools ensure: the size comparison is always true", "lib/tools.mjs", "const sizeOk = onDisk.length === plat.size;", "const sizeOk = true;", 'unit'],
  ["tools ensure: the 7-day check is removed", "lib/tools.mjs", "if (nowSec - pub / 1000 < MIN_AGE_DAYS * DAY) return", "if (false) return", 'unit'],
  ["tools ensure: the host check is removed", "lib/tools.mjs", "if (!urlOk) return", "if (false) return", 'unit'],
  ["tools ensure: the url need not start with the repository's release folder", "lib/tools.mjs", "let urlOk = typeof p.url === 'string' && p.url.startsWith(prefix);", "let urlOk = typeof p.url === 'string';", 'unit'],
  ["tools ensure: a url that changes when parsed (dot segments) is accepted", "lib/tools.mjs", "urlOk = u.href === p.url && u.protocol === 'https:'", "urlOk = u.protocol === 'https:'", 'unit'],
  ["tools ensure: a missing published date is accepted", "lib/tools.mjs", "if (!Number.isFinite(pub)) return", "if (false) return", 'unit'],
  ["tools ensure: a missing sha256 is accepted", "lib/tools.mjs", "if (typeof p.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(p.sha256)) return", "if (false) return", 'unit'],
  ["tools ensure: the .ok skip ignores the version", "lib/tools.mjs", "ok.version !== entry.version || ", "", 'unit'],
  ["tools ensure: the .ok skip ignores the executable's hash", "lib/tools.mjs", "if (typeof ok.binSha256 !== 'string' || sha256Of(readFileSync(binPath)) !== ok.binSha256) return", "if (false) return", 'unit'],
  ["tools ensure: a download that does not match is kept", "lib/tools.mjs", "rm(tmp);   // the file is deleted: a download that does not match is never kept", "", 'unit'],
  ["tools ensure: a failed extraction leaves its temp folder", "lib/tools.mjs", "if (x.error || x.status !== 0) { rm(tmp); return refuse(", "if (x.error || x.status !== 0) { return refuse(", 'unit'],
  ["tools ensure: the archive is read by a tar found on PATH, not the system one", "lib/tools.mjs", "(platform === 'win32' ? join(ctx.env.SystemRoot", "(false ? join(ctx.env.SystemRoot", 'unit'],
  ["tools ensure: a .ok without the executable's hash is trusted", "lib/tools.mjs", "if (typeof ok.binSha256 !== 'string' || sha256Of", "if (ok.binSha256 && sha256Of", 'unit'],
  ["tools ensure: a failed download is not tried again", "lib/tools.mjs", "const DOWNLOAD_ATTEMPTS = 2;", "const DOWNLOAD_ATTEMPTS = 1;", 'unit'],
  ["tools ensure: the cause of a failed fetch is not printed", "lib/tools.mjs", "const cause = c ? ", "const cause = false ? ", 'unit'],
  ["tools ensure: an HTTP 404 is retried", "lib/tools.mjs", "if (res.status < 500) break; ", "", 'unit'],
  ["tools ensure: an unknown tool name is not refused", "lib/tools.mjs", "for (const n of wanted) if (!manifest.tools[n]) throw new Usage(", "for (const n of wanted) if (false) throw new Usage(", 'unit'],
  ["tools ensure: a refused tool still exits 0", "commands/tools.mjs", "const ok = tools.every(t => t.status === 'present' || t.status === 'downloaded');", "const ok = true;", 'unit'],
  ["tools: --target is accepted", "commands/tools.mjs", "if (ctx.flags.target !== undefined) throw new Usage(`tools ${verb} takes no --target", "if (false) throw new Usage(`tools ${verb} takes no --target", 'unit'],
  ["ci: an unmapped step passes", "commands/ci.mjs", "if (!row) return { ok: false, lines: [`step not mapped:", "if (!row) return { ok: true, lines: [`step not mapped:", 'unit'],
  ["ci: the Dashboard tests step is not mapped", "commands/ci.mjs", "'Client files', 'Dashboard tests'];", "'Client files'];", 'unit'],
  ["ci: a FAIL job is counted as PASS", "commands/ci.mjs", "const status = steps.some(s => s.status === 'FAIL') ? 'FAIL' : 'PASS';", "const status = 'PASS';", 'unit'],
  ["ci: .tools/bin is dropped from the child's PATH", "commands/ci.mjs", "[key]: binDir + delimiter + (env[key] || '')", "[key]: env[key] || ''", 'unit'],
  ["ci: the shellcheck flag is dropped", "commands/ci.mjs", "args.splice(0, 0, '-shellcheck', shell);", "", 'unit'],
  ["ci: a -shellcheck already in ci.yml is kept next to the pinned one", "commands/ci.mjs", "if (at >= 0) args.splice(at, 2);", "", 'unit'],
  ["ci: --job is ignored", "commands/ci.mjs", "jobs = parsed.jobs.filter(j => j.id === f.job);", "jobs = parsed.jobs;", 'unit'],
  ["ci: a step with if: always() is skipped after a failure", "commands/ci.mjs", "if (failedBefore && step.if !== 'always()')", "if (failedBefore)", 'unit'],
  ["ci: the job timeout is shorter than ci.yml's timeout-minutes", "commands/ci.mjs", "(job.timeoutMinutes > 0 ? job.timeoutMinutes : 360) * 60000", "(job.timeoutMinutes > 0 ? job.timeoutMinutes : 360) * 1000", 'unit'],
  ["ci: shell syntax in a run line is accepted", "commands/ci.mjs", "throw new Error(`shell syntax '${c}' in a run line (omnikom ci does not run a shell)`)", "void 0", 'unit'],
  ["ci: a step key the runner does not model is ignored", "commands/ci.mjs", "if (step.extra.length) return { ok: false, lines: [`step '${step.name}' uses", "if (false) return { ok: false, lines: [`step '${step.name}' uses", 'unit'],
  ["ci: an if: the runner does not model is ignored", "commands/ci.mjs", "if (step.if && step.if !== 'always()') return", "if (false) return", 'unit'],
  ["ci: a job key the runner does not model is ignored", "commands/ci.mjs", "let broken = job.extra.length ? `job keys not modelled: ${job.extra.join(', ')}` : '';", "let broken = '';", 'unit'],
  ["ci: a top-level key the runner does not model is ignored", "commands/ci.mjs", "if (odd.length) return fail1(", "if (false) return fail1(", 'unit'],
  ["ci: npm ci runs without --install", "commands/ci.mjs", "if (!st.flags.install) {", "if (false) {", 'unit'],
  ["ci: a download step does not run tools ensure", "commands/ci.mjs", "const [r] = await ensureTools(st.ctx, [tool]);", "const r = { status: 'present', version };", 'unit'],
  ["ci: a download step's url and sha256 need not equal the manifest's", "commands/ci.mjs", "if (!linux || url !== linux.url || sha !== linux.sha256) return", "if (false) return", 'unit'],
  ["ci: a download step's version need not equal the manifest's", "commands/ci.mjs", "if (version !== entry.version) return { ok: false, lines: [`ci.yml names", "if (false) return { ok: false, lines: [`ci.yml names", 'unit'],
  ["ci: the shellcheck in .tools/bin may be any version", "commands/ci.mjs", "if (!sv.ok || have !== pinned) return", "if (false) return", 'unit'],
  ["ci: the node version check always passes", "commands/ci.mjs", "return { ok: same, lines: [same ? `node ${have}", "return { ok: true, lines: [same ? `node ${have}", 'unit'],
  ["ci: the deno version check always passes", "commands/ci.mjs", "return { ok: same, lines: [same ? `deno ${have}", "return { ok: true, lines: [same ? `deno ${have}", 'unit'],
  ["ci: a tool missing from .tools/bin is run anyway", "commands/ci.mjs", "if (!existsSync(bin)) return missing(first);", "", 'unit'],
  ["ci: the text lines skip the redaction", "commands/ci.mjs", "out.push(redact(`${j.status} ${j.id}  ${j.last}`, env));", "out.push(`${j.status} ${j.id}  ${j.last}`);", 'unit'],
  ["ci: the exit is 0 whatever failed", "commands/ci.mjs", "return result(failed === 0, failed === 0 ? 'ok' : 'CI-FAILED',", "return result(true, 'ok',", 'unit'],
  ["ci: a failing command's last line is not the last of stderr", "commands/ci.mjs", "const lines = failed ? [...out, ...err] : [...err, ...out];", "const lines = [...err, ...out];", 'unit'],
  ["ci: --target is accepted", "commands/ci.mjs", "if (f.target !== undefined) throw new Usage('ci takes no --target", "if (false) throw new Usage('ci takes no --target", 'unit'],
  ["ci: --expect is accepted", "commands/ci.mjs", "if (f.expect !== undefined) throw new Usage('ci takes no --expect", "if (false) throw new Usage('ci takes no --expect", 'unit'],
  ["ci: text mode prints the JSON object", "omnikom.mjs", "if (first === 'ci' && obj.command !== 'help' && !parsed.flags.json", "if (false && first === 'ci' && obj.command !== 'help' && !parsed.flags.json", 'unit'],
  ["tools and ci: the result shows a target", "omnikom.mjs", "&& command !== 'tools' && command !== 'ci' ? ctx.targetName", "? ctx.targetName", 'unit'],
  ["ci: a PostgreSQL major that differs from the step name is not said", "commands/ci.mjs", "wantMajor && haveMajor && wantMajor !== haveMajor ?", "false ?", 'unit'],
  ["ci: --install is not a switch", "lib/args.mjs", "'help', 'install']);", "'help']);", 'unit'],
  // ---- impact, the stamp and the pre-push hook (DECISIONS 43): each is a rule whose removal the planted-repository tests must see
  ["impact: the import scan is off", "lib/graph.mjs", "for (const spec of s.imports) { const to = resolveImport(f, spec); if (to) add(imports, f, to); }", "", 'unit'],
  ["impact: the join(...) / resolve(...) path scan is off", "lib/graph.mjs", "    if (!kind) continue;\n", "    if (!kind || kind === 'join') continue;\n", 'unit'],
  ["impact: the named literal copies are ignored", "commands/impact.mjs", "    for (const e of copies) {", "    for (const e of []) {", 'unit'],
  ["impact: a registry entry names a file that does not exist", "impact-copies.json", '"tools/omnikom-cli/commands/seed.mjs", "supabase/tests/tenancy.test.sql"]', '"tools/omnikom-cli/commands/seed.mjs", "supabase/tests/tenancy_gone.test.sql"]', 'unit'],
  ["impact: transitive imports are not followed", "commands/impact.mjs", "if (!parent.has(a)) { parent.set(a, f); queue.push(a); }", "if (!parent.has(a)) { parent.set(a, f); }", 'unit'],
  ["impact: the owner is the first matching path, not the longest", "commands/impact.mjs", "if (!best || o.path.length > best.path.length) best = o;", "if (!best) best = o;", 'unit'],
  ["impact: a bullet's except paths are ignored", "commands/impact.mjs", "    if (o.except.some(e => under(path, e))) continue;\n", "", 'unit'],
  ["impact: a folder named by one segment reads everything under it", "lib/graph.mjs", "if (folder && dirFiles.has(c) && segCount(c) >= 2)", "if (folder && dirFiles.has(c) && segCount(c) >= 1)", 'unit'],
  ["impact: a // comment is scanned as code", "lib/graph.mjs", "if (c === '/' && src[i + 1] === '/') {", "if (false) {", 'unit'],
  ["impact: the secret scan job is printed as a gate", "lib/graph.mjs", "      if (/gitleaks/.test(job.run)) continue;\n", "", 'unit'],
  ["impact: a gate does not reach the files its scripts read", "lib/graph.mjs", "for (const f of closure) if (JS_EXT.has(extOf(f))) for (const to of graph.reads.get(f) || []) out.add(to);", "", 'unit'],
  ["impact: a push of prose is not announced as prose only", "commands/impact.mjs", "out.push(d.proseOnly && d.gatesToRun.length === 0", "out.push(false", 'unit'],
  ["impact: a deleted file is not in the graph", "commands/impact.mjs", "const graph = buildGraph(source, { extraPaths, noScan: [COPIES_FILE] });", "const graph = buildGraph(source, { noScan: [COPIES_FILE] });", 'unit'],
  ["impact: a path that does not exist is accepted", "commands/impact.mjs", "if (!existsSync(join(repo, q))) throw new Usage(", "if (false) throw new Usage(", 'unit'],
  ["impact: --staged is not a switch", "lib/args.mjs", "SWITCHES.add('staged');", "", 'unit'],
  ["impact: text mode prints the JSON object", "omnikom.mjs", "if (TEXT[first] && obj.command !== 'help'", "if (false && TEXT[first] && obj.command !== 'help'", 'unit'],
  // ---- the GitHub run is the gate (DECISIONS 45): the verdict of a commit, the pre-push hook, land, and ci on an exact tree
  ["ghrun: a skipped job is counted as green", "lib/ghrun.mjs", "for (const j of run.jobs) if (j.conclusion !== 'success') {", "for (const j of run.jobs) if (j.conclusion !== 'success' && j.conclusion !== 'skipped') {", 'unit'],
  ["ghrun: the ci.yml job-name list is not checked", "lib/ghrun.mjs", "for (const name of jobNames) if (!run.jobs.some(", "for (const name of []) if (!run.jobs.some(", 'unit'],
  ["ghrun: a red run beside a green one is ignored", "lib/ghrun.mjs", "if (badRuns.size > 0) {", "if (badRuns.size > 0 && badRuns.size === runs.length) {", 'unit'],
  ["ghrun: the headSha equality is off", "lib/ghrun.mjs", "String(r.headSha).toLowerCase() === String(sha).toLowerCase() &&", "true &&", 'unit'],
  ["ghrun: a failed gh call is read as no run, not Blocked", "lib/ghrun.mjs", "if (!r || !r.ok) throw new Blocked(", "if (!r || !r.ok) return [];\n    if (false) throw new Blocked(", 'unit'],
  ["ghrun: a cancelled run counts", "lib/ghrun.mjs", " && r.conclusion !== 'cancelled');", ");", 'unit'],
  ["ghrun: a run that is not completed is not pending", "lib/ghrun.mjs", "if (waiting.length) return {", "if (false) return {", 'unit'],
  ["ghrun: the run's own conclusion is not checked", "lib/ghrun.mjs", "if (run.conclusion !== 'success') {", "if (false) {", 'unit'],
  ["ghrun: the url of another host is read as github.com", "lib/ghrun.mjs", "https://(?:[^@/\\\\s]+@)?github\\\\.com/", "https://(?:[^@/\\\\s]+@)?[a-z.]+/", 'unit'],
  ["hooks: master is allowed without a green ci run", "commands/hooks.mjs", "if (v.state === 'green') return { allowed: true,", "if (true) return { allowed: true,", 'unit'],
  ["hooks: the fast-forward check is off", "commands/hooks.mjs", "if (!git.run(['merge-base', '--is-ancestor', rsha, lsha]).ok) return", "if (false) return", 'unit'],
  ["hooks: a remote master this clone does not have is not refused", "commands/hooks.mjs", "if (!known) return { allowed: false,", "if (!known) return { allowed: true,", 'unit'],
  ["hooks: another branch is allowed", "commands/hooks.mjs", "if (ref !== 'refs/heads/master') {", "if (false) {", 'unit'],
  ["hooks: a master delete is allowed", "commands/hooks.mjs", "if (isDelete) return { allowed: false,", "if (isDelete) return { allowed: true,", 'unit'],
  ["hooks: a check branch is refused", "commands/hooks.mjs", R`if (/^refs\/heads\/check\/.+/.test(ref)) return { allowed: true,`, R`if (false) return { allowed: true,`, 'unit'],
  ["hooks: a failed gh call allows the push", "commands/hooks.mjs", "return { allowed: false, lines: [`pre-push: REFUSED ${ref}: ${e.message}`", "return { allowed: true, lines: [`pre-push: REFUSED ${ref}: ${e.message}`", 'unit'],
  ["hooks: a foreign pre-push hook is overwritten", "commands/hooks.mjs", "    if (!isOurs(have)) throw new Blocked(", "    if (false) throw new Blocked(", 'unit'],
  ["hooks: uninstall removes a foreign hook", "commands/hooks.mjs", "  if (!isOurs(readFileSync(file, 'utf8'))) throw new Blocked(", "  if (false) throw new Blocked(", 'unit'],
  ["hooks: installing twice rewrites the file", "commands/hooks.mjs", "    if (have === HOOK_TEXT) return result(true, 'ok', { state: 'installed', action: 'unchanged', path: file });\n", "", 'unit'],
  ["hooks: core.hooksPath is ignored", "commands/hooks.mjs", "  if (hooksPath) throw new Blocked(", "  if (false) throw new Blocked(", 'unit'],
  ["hooks: the shim has CRLF line endings", "commands/hooks.mjs", "hooks pre-push \"$@\"\\n`;", "hooks pre-push \"$@\"\\r\\n`;", 'unit'],
  ["hooks: the refusal does not end with the --no-verify line", "commands/hooks.mjs", "  if (refused) lines.push(NO_VERIFY_LINE);\n", "", 'unit'],
  ["land: a red verdict is pushed", "commands/land.mjs", "  if (v.state === 'red') {", "  if (false) {", 'unit'],
  ["land: the fast-forward check is off [small-fixes]", "commands/land.mjs", "if (hasMaster && !git.run(['merge-base', '--is-ancestor', master, sha]).ok) {", "if (false) {", 'unit'],
  ["land: a commit already in master is pushed again [small-fixes]", "commands/land.mjs", "if (hasMaster && git.run(['merge-base', '--is-ancestor', sha, master]).ok) {", "if (false) {", 'unit'],
  ["land: no ci run is waited for forever (no 5 minute bound)", "commands/land.mjs", "if (v.state === 'none' && noneMs > NONE_LIMIT_MS) throw new Blocked(", "if (false) throw new Blocked(", 'unit'],
  ["land: the department check is off", "commands/land.mjs", "const charter = charterOf(m[1], departments);", "const charter = m[1];", 'unit'],
  ["land: a department prefix matching two charters picks the first", "commands/land.mjs", "if (hits.length === 1) return hits[0];", "if (hits.length >= 1) return hits[0];", 'unit'],
  ["land: a department prefix need not end at a '-'", "commands/land.mjs", "departments.filter(d => d.startsWith(`${dept}-`))", "departments.filter(d => d.startsWith(dept))", 'unit'],
  ["land: the push is forced", "commands/land.mjs", "git.run(['push', remote, `${sha}:refs/heads/master`]", "git.run(['push', '--force', remote, `${sha}:refs/heads/master`]", 'unit'],
  ["land: the push skips the hook", "commands/land.mjs", "git.run(['push', remote, `${sha}:refs/heads/master`]", "git.run(['push', '--no-verify', remote, `${sha}:refs/heads/master`]", 'unit'],
  ["land lock: the lock is not taken", "commands/land.mjs", "const push = git.run(['push', remote, `${made.out}:${LOCK_REF}`], { timeout: 180000 });", "const push = { ok: true };", 'unit'],
  ["land lock: the lock is not released after a refusal or the success", "commands/land.mjs", "\n  const rel = await releaseLock(ctx, git, remote, lock.sha);\n  res.data.lines.push(rel.line);", "\n  const rel = { line: 'land: lock released' };\n  res.data.lines.push(rel.line);", 'unit'],
  ["land lock: the lock is not released after a Blocked", "commands/land.mjs", "\n    const rel = await releaseLock(ctx, git, remote, lock.sha);\n    if (e &&", "\n    const rel = { line: '' };\n    if (e &&", 'unit'],
  ["land lock: the stale bound is off (a fresh lock gets broken)", "commands/land.mjs", "if (held.seconds > STALE_LOCK_MINUTES * 60 && attempt === 0) {", "if (held.seconds > -1 && attempt === 0) {", 'unit'],
  ["land lock: the stale bound is 89 minutes", "commands/land.mjs", "if (held.seconds > STALE_LOCK_MINUTES * 60 && attempt === 0) {", "if (held.seconds >= 89 * 60 && attempt === 0) {", 'unit'],
  ["land lock: the release has no lease (somebody else's lock gets deleted)", "commands/land.mjs", "['push', `--force-with-lease=${LOCK_REF}:${lockSha}`, remote,", "['push', '--force', remote,", 'unit'],
  ["land lock: the lock is a plain push of the lock but the holder is not read", "commands/land.mjs", "const m = /^land-lock: (\\S+) (\\S+) by (.+) at (\\S+)\\s*$/.exec(msg.join('\\n').trim());", "const m = null;", 'unit'],
  ["hooks: the land queue ref is refused", "commands/hooks.mjs", "if (ref === LOCK_REF) return { allowed: true,", "if (false) return { allowed: true,", 'unit'],
  ["cluster guard: the sweep of dead owners is off", "test/harness.mjs", "  sweepClusters({ markerDir, run, alive, remove });\n", "", 'unit'],
  ["cluster guard: the sweep also stops a live owner's cluster", "test/harness.mjs", "    if (alive(info.pid)) continue;\n", "", 'unit'],
  ["cluster guard: a planted marker can aim the sweep at any folder", "test/harness.mjs", "if (!ours(info.dir)) {", "if (false) {", 'unit'],
  ["cluster guard: a normal stop leaves its marker", "test/harness.mjs", "    rmSync(marker, { force: true });\n  };", "  };", 'unit'],
  // the sweep never throws on a folder it cannot remove (Windows EPERM)
  ["cluster sweep: a folder that cannot be removed aborts the sweep", "test/harness.mjs", "try { remove(info.dir); } catch (e) { removeErr = e; }", "try { remove(info.dir); } catch (e) { throw e; }", 'unit'],
  ["cluster sweep: the marker of a stuck folder is removed anyway", "test/harness.mjs", "code: removeErr.code || 'ERR' }); continue; }", "code: removeErr.code || 'ERR' }); rmSync(file, { force: true }); continue; }", 'unit'],
  ["cluster sweep: a stuck folder is reported swept", "test/harness.mjs", "swept: false, why: `could not remove ${info.dir}`", "swept: true, why: `could not remove ${info.dir}`", 'unit'],
  ["cluster sweep: the error code is not reported", "test/harness.mjs", "code: removeErr.code || 'ERR' }", "code: 'ERR' }", 'unit'],
  ["cluster sweep: startCluster's sweep ignores the folder remover", "test/harness.mjs", "sweepClusters({ markerDir, run, alive, remove });", "sweepClusters({ markerDir, run, alive });", 'unit'],
  // the check that every mutant above still finds its target (test/mutant-targets.mjs)
  ["mutate targets: the exactly-once count is skipped", "test/mutant-targets.mjs", "if (counts.some(n => n !== 1)) { missing.push(", "if (false) { missing.push(", 'unit'],
  ["mutate targets: a replacement that changes nothing is not a miss", "test/mutant-targets.mjs", "if (mutated === text) missing.push(", "if (false) missing.push(", 'unit'],
  ["mutate targets: only the first text of a layered rule is counted", "test/mutant-targets.mjs", "const counts = pairs.map(([a]) => text.split(a).length - 1);", "const counts = pairs.slice(0, 1).map(([a]) => text.split(a).length - 1);", 'unit'],
  ["mutate targets: the check reports no miss", "test/mutant-targets.mjs", "return { count: mutants.length, missing };", "return { count: mutants.length, missing: [] };", 'unit'],
  // the port wall (2026-11-01: a held 127.0.0.1:P left the server half bound on ::1, pg_ctl said ok, 127.0.0.1 was refused for its whole life)
  ["cluster port: the old ephemeral-range ports (57000+) are back", "test/harness.mjs", "export const CLUSTER_PORTS = { first: 21000, count: 900, tries: 5 };", "export const CLUSTER_PORTS = { first: 57000, count: 900, tries: 5 };", 'unit'],
  ["cluster port: the server listens on localhost again (half bound on ::1)", "test/harness.mjs", " -c listen_addresses=127.0.0.1`", "`", 'unit'],
  ["cluster port: no walk to the next port on a failed bind (the held port fails the start)", "test/harness.mjs", "|| tries >= CLUSTER_PORTS.tries", "|| true", 'db'],
  ["cluster port: any start failure walks on, not only a bind failure", "test/harness.mjs", "!bindFailed(log) ||", "", 'unit'],
  ["cluster port: the walk is silent", "test/harness.mjs", "say(`cluster: port ${port} in use (could not bind), trying ${next}`);", "", 'unit'],
  ["cluster port: the walk leaves its block (no wrap)", "test/harness.mjs", " % CLUSTER_PORTS.count);", ");", 'unit'],
  ["cluster port: 9 tries instead of 5", "test/harness.mjs", "tries: 5 }", "tries: 9 }", 'unit'],
  ["cluster port: the marker keeps the first port after a walk", "test/harness.mjs", "      rmSync(marker, { force: true });                                  // the marker file is named by its port: replace it, never keep two\n      marker = writeMarker(markerDir, { pid: process.pid, dir, data, port, startedAt: new Date().toISOString() });\n", "", 'unit'],
  ["cluster port: a walk leaves the first port's marker behind (two files, one never removed)", "test/harness.mjs", "      rmSync(marker, { force: true });                                  // the marker file is named by its port: replace it, never keep two\n      marker = writeMarker(", "      writeMarker(", 'unit'],
  ["cluster port: a start that names its port gets the shared cluster of the environment", "test/harness.mjs", "if (process.env.OMNIKOM_TEST_CLUSTER_PORT && !firstPort) return {", "if (process.env.OMNIKOM_TEST_CLUSTER_PORT) return {", 'unit'],
  ["cluster port: a start that names its port gets the shared cluster (the held-port check in a mutate copy)", "test/harness.mjs", "if (process.env.OMNIKOM_TEST_CLUSTER_PORT && !firstPort) return {", "if (process.env.OMNIKOM_TEST_CLUSTER_PORT) return {", 'db'],
  ["cluster diag: a failed create database names no cluster", "test/harness.mjs", " + r.stderr + clusterDiag(cluster));", " + r.stderr);", 'db'],
  ["cluster guard (real kill): a dead owner's cluster is never stopped by the sweep", "test/harness.mjs", "    if (alive(info.pid)) continue;\n", "    continue;\n", 'db'],
  ["ci: the CLI full suite step is not mapped", "commands/ci.mjs", "'CLI full suite and mutants (when the change reaches them)', ", "", 'unit'],
  ["ci-heavy: the scope check always says not needed", "test/ci-heavy.mjs", "if (!v.needed) {", "if (true) {", 'unit'],
  ["ci-heavy: the child exit code is ignored", "test/ci-heavy.mjs", "if (code !== 0) {", "if (false) {", 'unit'],
  ["ci-heavy: a file the cli job reads through impact is not counted", "test/ci-heavy.mjs", "reached = a.changed.filter(c => c.gates.includes('job cli')).map(c => c.path);", "reached = [];", 'unit'],
  ["ci-heavy: no base is not needed", "test/ci-heavy.mjs", "if (!base) return { needed: true,", "if (!base) return { needed: false,", 'unit'],
  ["ci: the checkout is not removed after a failed job", "lib/checkout.mjs", "finally { info.removed = removeCheckout(git, dir); }", "finally { if (value && value.ok) info.removed = removeCheckout(git, dir); }", 'unit'],
  ["ci: --staged is the tree of HEAD, not the index", "lib/checkout.mjs", "const r = git.run(['write-tree']);", "const r = git.run(['rev-parse', 'HEAD^{tree}']);", 'unit'],
  ["ci: --commit is ignored (the index tree is used)", "lib/checkout.mjs", "  if (commit !== undefined) {", "  if (false) {", 'unit'],
  ["ci: --staged runs on the working tree, not the checkout", "commands/ci.mjs", "dir => ciRun(ctx, dir));", "dir => ciRun(ctx, ctx.repo));", 'unit'],
  ["ci: a checkout root on E: is accepted", "lib/checkout.mjs", "if (/^[eE]:/.test(norm) || /^[eE]:/.test(String(root))) throw new Usage(", "if (false) throw new Usage(", 'unit'],
  ["ci: a checkout root containing claude is accepted", "lib/checkout.mjs", "if (/claude/i.test(norm)) throw new Usage(", "if (false) throw new Usage(", 'unit'],
  ["impact: the laptop lines are dropped", "commands/impact.mjs", "for (const l of d.laptop || []) {", "for (const l of []) {", 'unit'],
  ["impact: regex literals are not told from division", "lib/graph.mjs", "const regexOk = !p || (p.t === 'p' && !')]}'.includes(p.v)) || (p.t === 'id' && KEYWORDS_BEFORE_REGEX.has(p.v));", "const regexOk = false;", 'unit'],
  ["impact: the GATES table is not read", "lib/graph.mjs", "toks[k].t === 'id' && toks[k].v === 'GATES' &&", "toks[k].t === 'id' && toks[k].v === 'GATESX' &&", 'unit'],
  ["impact: new URL(..., import.meta.url) is not a read", "lib/graph.mjs", "else if (t.v === 'URL') kind = pv && pv.t === 'id' && pv.v === 'new' ? 'url' : null;", "else if (t.v === 'URL') kind = null;", 'unit'],
  ["impact: export ... from is not an import", "lib/graph.mjs", "    if (t.v === 'from' && nx && nx.t === 'str') { imports.push(nx.v); used.add(k + 1); continue; }\n", "", 'unit'],
  ["impact: repoPath() and importRepo() are not reads", "lib/graph.mjs", "else if (t.v === 'repoPath' || t.v === 'importRepo') kind = 'repo';", "else if (t.v === 'repoPath' || t.v === 'importRepo') kind = null;", 'unit'],
  // ---- seed test seeds the test site (sites/test-demo-a/), status shows the function role and counts, test walls runs in a namespace of its own
  // (the tag [seed-site] lets one run pick exactly these: mutate.mjs --only "[seed-site]")
  ["seed test: the test site's rows are seeded again every run (find-by-key dropped) [seed-site]", 'commands/seed.mjs', 'if hits is null then\n      rid := service.seed_version(a, coll, payload, s, ${ref});', 'if true then\n      rid := service.seed_version(a, coll, payload, s, ${ref});', 'db'],
  ["seed test: the test site's contract is written as version 1 again [seed-site]", 'commands/seed.mjs', 'coalesce((select max(version) from site_contracts where workspace_id = a), 0) + 1, cnt, res, true, s);', '1, cnt, res, true, s);', 'db'],
  ['seed test: a ref:<id> in a row is left unresolved [seed-site]', 'commands/seed.mjs', '      return ids -> k;\n', '      return v;\n', 'db'],
  ['seed test: the repair path is dropped (a changed row is never re-versioned) [seed-site]', 'commands/seed.mjs', 'if cur is distinct from payload then', 'if false then', 'db'],
  ['seed test: two live rows for one key are not refused [seed-site]', 'commands/seed.mjs', "if cardinality(hits) > 1 then raise exception 'S-SEED-AMBIGUOUS", "if false then raise exception 'S-SEED-AMBIGUOUS", 'db'],
  ['seed test: a settings row that names a media row of A is not honoured [seed-site]', 'commands/seed.mjs', 'if logo ~ ${uuidRe} then select m.id into mid', 'if false then select m.id into mid', 'db'],
  ['seed test: the preview host update is dropped [seed-site]', 'commands/seed.mjs', 'update sites set preview_host = ${lit(PREVIEW_HOST_A)} where id = ${uuidLit(SITE_A)} and preview_host is distinct from ${lit(PREVIEW_HOST_A)};', 'update sites set preview_host = preview_host where false;', 'db'],
  ['seed test: Agent Two is seeded without slug and role [seed-site]', 'commands/seed.mjs', "data: { name: 'Agent Two', slug: 'agent-two', role: 'Agent' } };", "data: { name: 'Agent Two' } };", 'db'],
  ['seed test: with no site the earlier content is not seeded [seed-site]', 'commands/seed.mjs', '${site ? siteSql(site) : legacyContentSql()}', "${site ? siteSql(site) : ''}", 'db'],
  ['status: the function role is always present [seed-site]', 'commands/status.mjs', 'const functionRole = roleRow.ok && roleRow.value === true;', 'const functionRole = true;', 'db'],
  ['status: onDisk is the ledger count [seed-site]', 'commands/status.mjs', 'onDisk: disk.length,', 'onDisk: ledger.length,', 'db'],
  ['status: a disabled function is listed as enabled [seed-site]', 'commands/status.mjs', '.map(d => ({ name: d.name, disabled: off.has(d.name) }))', '.map(d => ({ name: d.name, disabled: false }))', 'unit'],
  ['status: a folder without index.ts is listed as a function [seed-site]', 'commands/status.mjs', " && existsSync(join(functionsDir, d.name, 'index.ts')))", ')', 'unit'],
  ['test walls: the staff email is left unmapped [seed-site]', 'lib/walls.mjs', '  out = out.replace(/staff@omnikom\\b/g, () => { emails++; return `staff@walls-${run}.test`; });\n', '', 'unit'],
  ['test walls: the @test emails are left unmapped [seed-site]', 'lib/walls.mjs', '  out = out.replace(/@(test)\\b/gi, (m, word) => { emails++; return `@walls-${run}.${word}`; });\n', '', 'unit'],
  ['test walls: the test- slugs are left unmapped [seed-site]', 'lib/walls.mjs', '  out = out.replace(/(?<![A-Za-z0-9_])test-(?=[a-z0-9])/g, () => { slugs++; return `walls-${run}-`; });\n', '', 'unit'],
  ['test walls: one fixed UUID is left unmapped [seed-site-b]', 'lib/walls.mjs', "uuids.set(k, WIDTH.map((w, i) => segFor(s, i)).join('-'));", "uuids.set(k, k === '00000000-0000-0000-0000-00000000000a' ? k : WIDTH.map((w, i) => segFor(s, i)).join('-'));", 'unit'],
  ['test walls: the beginning of an id written on its own is left unmapped [seed-site-b]', 'lib/walls.mjs', "if (!levels[s.length - 1].has(s.join('-'))) return m;", 'return m;', 'unit'],
  ['test walls: the fingerprint column is called t again, so the rows aggregate as bare strings [seed-site-b]', 'lib/walls.mjs', "`select '${label}' as tbl, count(*)::int", "`select '${label}' as t, count(*)::int", 'db'],
  ['test walls: the scan of the mapped copy is skipped [seed-site]', 'commands/apply.mjs', 'if (unmapped.length) {', 'if (false) {', 'unit'],
  ['test walls: the before/after fingerprint comparison is always equal [seed-site]', 'commands/apply.mjs', 'const diff = fingerprintDiff(before.rows, after.rows);', 'const diff = [];', 'db'],
  // ---- small CLI fixes (brief small-cli-fixes): the local master moves with land, the billing line, audit/gate --target, land waits for the lock
  // (the tag [small-fixes] lets one run pick exactly these: mutate.mjs --only "[small-fixes]")
  ['land local move: the dirty-path check is skipped [small-fixes]', 'commands/land.mjs', R`const blocking = diff.out.split('\0').filter(Boolean).filter(p => dirty.has(p));`, 'const blocking = [];', 'unit'],
  ['land local move: a failed or skipped move turns the land into a failure [small-fixes]', 'commands/land.mjs', "  data.localMaster = lm.state;\n  return result(true, 'ok', data);", "  data.localMaster = lm.state;\n  return result(lm.state !== 'not-moved', 'ok', data);", 'unit'],
  ['land local move: a rename line is read with one path [small-fixes]', 'commands/land.mjs', "if (/[RC]/.test(e.slice(0, 2))) { i++; if (parts[i]) set.add(parts[i]); }", "", 'unit'],
  ['land local move: master checked out in another worktree is moved anyway [small-fixes]', 'commands/land.mjs', "if (elsewhere) return notMoved(", "if (false) return notMoved(", 'unit'],
  ['land local move: update-ref has no lease [small-fixes]', 'commands/land.mjs', "['update-ref', 'refs/heads/master', sha, old]", "['update-ref', 'refs/heads/master', sha]", 'unit'],
  ['land local move: a local master with its own commits is not left alone [small-fixes]', 'commands/land.mjs', "if (!git.run(['merge-base', '--is-ancestor', old, sha]).ok) return notMoved(", "if (false) return notMoved(", 'unit'],
  ['land local move: every blocking path is named [small-fixes]', 'commands/land.mjs', "blocking.slice(0, 10).join(', ')", "blocking.slice(0, 99).join(', ')", 'unit'],
  ['land local move: the merge is not --ff-only [small-fixes]', 'commands/land.mjs', "git.run(['merge', '--ff-only', sha], { timeout: 180000 })", "git.run(['merge', sha], { timeout: 180000 })", 'unit'],
  ['ghrun billing line: printed when only SOME failed jobs ran no step [small-fixes]', 'lib/ghrun.mjs', "!failed.every(j => j.steps === 0)", "!failed.some(j => j.steps === 0)", 'unit'],
  ['ghrun billing line: a job whose step list is unknown counts as no step [small-fixes]', 'lib/ghrun.mjs', "!failed.every(j => j.steps === 0)", "!failed.every(j => !j.steps)", 'unit'],
  ['ghrun billing line: the annotation message is not cut to 200 characters [small-fixes]', 'lib/ghrun.mjs', ".trim().slice(0, 200) : ''", ".trim() : ''", 'unit'],
  ['ghrun billing line: the annotation is read from no job [small-fixes]', 'lib/ghrun.mjs', "await gh(['api', `repos/${repo}/check-runs/${id.id}/annotations`])", "await gh(['api', `repos/${repo}/check-runs/0/annotations`])", 'unit'],
  ['audit: the --target value is not passed to the engine [small-fixes]', 'commands/audit.mjs', ", ...(target ? { target } : {}) });", " });", 'unit'],
  ['gate: the --target value is not passed to the engine [small-fixes]', 'commands/audit.mjs', "runLib(ctx, dir, target ? { target } : {});", "runLib(ctx, dir, {});", 'unit'],
  ['production guard: the exemption covers a third command [small-fixes]', 'lib/target.mjs', "new Set(['audit', 'gate'])", "new Set(['audit', 'gate', 'contract'])", 'unit'],
  ['production guard: audit and gate are refused on production again [small-fixes]', 'lib/target.mjs', "  if (BUILD_TARGET_COMMANDS.has(command)) return;\n", "", 'unit'],
  ['land lock wait: it never polls (refuses at once with the default) [small-fixes]', 'commands/land.mjs', "if (waitedMs >= lockWaitMs) {", "if (true) {", 'unit'],
  ['land lock wait: the default wait is 0 [small-fixes]', 'commands/land.mjs', "export const DEFAULT_LOCK_WAIT_MINUTES = 30;", "export const DEFAULT_LOCK_WAIT_MINUTES = 0;", 'unit'],
  ['land lock wait: the holder line is printed on every poll [small-fixes]', 'commands/land.mjs', "if (h.sha !== shown) {", "if (true) {", 'unit'],
  ['land lock wait: the 180 minute cap is off [small-fixes]', 'commands/land.mjs', "if (!(lockWaitMinutes >= 0) || lockWaitMinutes > MAX_LOCK_WAIT_MINUTES) throw new Usage(", "if (!(lockWaitMinutes >= 0)) throw new Usage(", 'unit'],
  ['land early check: the not-a-fast-forward refusal waits for ci first [small-fixes]', 'commands/land.mjs', "if (early && !git.run(['merge-base', '--is-ancestor', early, sha]).ok) {", "if (false) {", 'unit'],
  ['land release: the lock delete is never tried again after a network failure [small-fixes]', 'commands/land.mjs', "if (del.ok || tries > RELEASE_WAITS_MS.length || !looksLikeNetworkFailure(del.err || del.out)) break;", "break;", 'unit'],
  ['land release: a lease refusal is tried again too [small-fixes]', 'commands/land.mjs', "export const looksLikeNetworkFailure = text => !LEASE_REFUSED.test(String(text)) && NETWORK_FAILED.test(String(text));", "export const looksLikeNetworkFailure = text => NETWORK_FAILED.test(String(text)) || LEASE_REFUSED.test(String(text));", 'unit'],
  ['land release: the tries are not bounded by the wait list [small-fixes]', 'commands/land.mjs', "tries > RELEASE_WAITS_MS.length ||", "tries > 99 ||", 'unit'],
  ['land release: the retry does not wait [small-fixes]', 'commands/land.mjs', "await ctx.sleep(RELEASE_WAITS_MS[tries - 1]);", "", 'unit'],
  ['land release: the warning does not say how many tries were made [small-fixes]', 'commands/land.mjs', "${tries === 1 ? '' : ` after ${tries} tries`}", "", 'unit'],
  ['land early check: a commit already in master waits for ci first [small-fixes]', 'commands/land.mjs', "if (early && git.run(['merge-base', '--is-ancestor', sha, early]).ok) {", "if (false) {", 'unit'],
  // ---- test journey (briefs/journey.md section 6): each broken copy must turn test/journey.mjs red
  ['journey J3: the runner ignores the dashboard test result (a broken publish stays green)', 'commands/journey.mjs', '    return playwrightVerdict(sum, title);', "    return { status: 'PASS', evidence: 'ignored' };", 'unit'],
  ['journey J3: a present spec file whose title is missing passes the title check', 'commands/journey.mjs', 'if (!spec.text.includes(title)) return {', 'if (false) return {', 'unit'],
  ['journey J3: a present spec file still prints NOT BUILT YET', 'commands/journey.mjs', "if (!spec.exists) return { status: 'NOT BUILT YET'", "if (true) return { status: 'NOT BUILT YET'", 'unit'],
  ['journey: NOT BUILT YET is counted as a PASS', 'commands/journey.mjs', 'for (const r of out) counts[r.status]++;', "for (const r of out) counts[r.status === 'NOT BUILT YET' ? 'PASS' : r.status]++;", 'unit'],
  ['journey: a SKIPPED step is printed as PASS', 'commands/journey.mjs', '`SKIPPED (after ${s.after})`', "'PASS'", 'unit'],
  ['journey: a step runs after the step it needs failed', 'commands/journey.mjs', 'const bad = step.needs.map(n => done.get(n)).find(r => r && BAD.has(r.status));', 'const bad = null;', 'unit'],
  ['journey: the zero-tests guard is removed', 'commands/journey.mjs', 'if (sum.ran === 0) return {', 'if (false) return {', 'unit'],
  ['journey: a report that ran another test as well still passes', 'commands/journey.mjs', 'if (other.length) return {', 'if (false) return {', 'unit'],
  ['journey J4: the console-error count is ignored', 'commands/journey.mjs', 'if (v.consoleErrors.length) problems.push(', 'if (false) problems.push(', 'unit'],
  ['journey J4: uncaught exceptions are ignored', 'commands/journey.mjs', 'if (v.exceptions.length) problems.push(', 'if (false) problems.push(', 'unit'],
  ['journey J4: sideways scroll is ignored', 'commands/journey.mjs', 'if (v.overflow.overflowing) problems.push(', 'if (false) problems.push(', 'unit'],
  ['journey J4: the noindex header is not checked', 'commands/journey.mjs', "if ((v.headers['x-robots-tag'] || '') !== 'noindex, nofollow') problems.push(", 'if (false) problems.push(', 'unit'],
  ['journey J4: the screenshot is printed without being written (browser reports success, writes nothing)', 'lib/browser.mjs', "    writeFileSync(file, Buffer.from(shot.data, 'base64'));\n    return statSync(file).size;", '    return 1;', 'unit'],
  ['journey J5: a stored lead row is not required', 'commands/journey.mjs', 'if (count !== 1) return {', 'if (false) return {', 'unit'],
  ['journey J5: the form\'s answer is not required to say sent', 'commands/journey.mjs', R`if (sent.status !== 200 || !SENT_ANSWER.test(sent.text)) return {`,'if (false) return {', 'unit'],
  ['journey J5/J6: the alert list is not checked before an alert is sent', 'commands/journey.mjs', 'if (!(await c.impl.alertsOnlyTo(c.alertTo))) return {', 'if (false) return {', 'unit'],
  ['journey: J5 and J6 need no --alert-to', 'commands/journey.mjs', "&& !alertTo) throw new Usage('J5 and J6", "&& false) throw new Usage('J5 and J6", 'unit'],
  ['journey: it runs on any target, not only staging', 'commands/journey.mjs', "if (ctx.targetName !== 'staging') throw new Blocked(", 'if (false) throw new Blocked(', 'unit'],
  ['journey: production allows the test command', 'lib/target.mjs', "new Set(['status', 'apply'])", "new Set(['status', 'apply', 'test'])", 'unit'],
  ['journey J2: a login that reads another workspace still passes', 'commands/journey.mjs', 'if (JSON.stringify(r.ids) !== JSON.stringify([WS_A])) return {', 'if (false) return {', 'unit'],
  ['journey J7: the CSV need not hold the marker lead', 'commands/journey.mjs', 'if (hits.length !== 1) return {', 'if (false) return {', 'unit'],
  ['journey: the printed text skips the redaction', 'commands/journey.mjs', "return redact([...lines, summaryLine(d)].join('\\n'), env) + '\\n';", "return [...lines, summaryLine(d)].join('\\n') + '\\n';", 'unit'],
  ['journey browser: close leaves the browser running (both kill layers removed)', 'lib/browser.mjs', [['      try { guard.killTree(child.pid, folder.dir); } catch { /* already gone */ }\n', ''], ['      try { folder.release(); } catch { /* the guard cleans at exit */ }\n', ''], ['      try { rmSync(folder.dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* a process still holds it: kill again */ }\n', ''], ['      if (!existsSync(folder.dir)) return;\n', '      return;\n']], null, 'unit'],
  ['journey J6/J7: the lead from lead send is reported as if J5 had stored it', 'commands/journey.mjs', "via: ' (lead from lead send: J5 did not store one)'", "via: ''", 'unit'],
  ['journey J6/J7: a pass with no lead at all (lead send stored nothing)', 'commands/journey.mjs', 'if (stored !== 1) return (c.state.fallbackFail', 'if (false) return (c.state.fallbackFail', 'unit'],
  ['journey J7: the lead send fallback is made without checking the alert list', 'commands/journey.mjs', 'const blocked = await alertGuard(c); if (blocked) return { fail: blocked };', '', 'unit'],
  ['journey J6 inbox: the preview is started without the dashboard\'s port variable (it would listen elsewhere than the page opened)', 'commands/journey.mjs', 'env: { ...ctx.env, [pp.PORT_ENV]: String(port) }', 'env: ctx.env', 'unit'],
  ['journey J6 inbox: the page is opened at localhost:4173 again', 'commands/journey.mjs', 'const base = pp.baseUrl(port);', "const base = 'http://localhost:4173';", 'unit'],
  ['journey J5: the Thank-you page is not accepted as a sent answer', 'commands/journey.mjs', 'export const SENT_ANSWER = /"sent"\\s*:\\s*true|your message was sent/i;', 'export const SENT_ANSWER = /"sent"\\s*:\\s*true/;', 'unit'],
  ['journey J6/J7: the fallback is tried again by every step (a second alert)', 'commands/journey.mjs', 'if (c.state.fallbackFail) return c.state.fallbackFail;', '', 'unit'],
  // ---- journey browser start (briefs/browser-start-deadline.md): the wait for the DevTools address is a measured wall clock
  ['journey browser start: the bound is back to the old 15 s', 'lib/browser.mjs', 'export const DEVTOOLS_WAIT_MS = 180000;', 'export const DEVTOOLS_WAIT_MS = 15000;', 'unit'],
  ['journey browser start: the poll loop is a single check (gives up after the first look)', 'lib/browser.mjs', 'if (elapsed >= devtoolsWaitMs) throw new Error(', 'if (true) throw new Error(', 'unit'],
  ['journey browser start: a read error of the DevTools file (EBUSY while the browser writes it) is thrown instead of looked at again', 'lib/browser.mjs', [['try { const [p, w] = readFileSync(portFile', '{ const [p, w] = readFileSync(portFile'], [' catch { /* the browser still holds the file (EBUSY on Windows): look again */ }', '']], null, 'unit'],
  ['journey browser start: an exited browser is waited for until the bound', 'lib/browser.mjs', 'if (exited) throw new Error(', 'if (false) throw new Error(', 'unit'],
];

const sh = (args, env) => new Promise(res => {
  const c = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { err += d; });
  const timer = setTimeout(() => { c.kill(); }, LIMIT_MS);
  c.on('close', code => { clearTimeout(timer); res({ status: code, out, err }); });
});

const cluster = startCluster();
const env = { OMNIKOM_TEST_CLUSTER_PORT: String(cluster.port), OMNIKOM_TEST_CLUSTER_DIR: cluster.dir, OMNIKOM_REPO_ROOT: REPO };   // the dir lets a copy name this cluster's log when it cannot reach it
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
