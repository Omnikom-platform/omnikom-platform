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
  ['audit and gate: --target is accepted', 'commands/audit.mjs', 'if (f.target !== undefined) throw new Usage(', 'if (false) throw new Usage(', 'unit'],
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
  ["tools ensure: the .ok skip ignores the executable's hash", "lib/tools.mjs", "if (ok.binSha256 && sha256Of(readFileSync(binPath)) !== ok.binSha256) return", "if (false) return", 'unit'],
  ["tools ensure: a download that does not match is kept", "lib/tools.mjs", "rm(tmp);   // the file is deleted: a download that does not match is never kept", "", 'unit'],
  ["tools ensure: a failed extraction leaves its temp folder", "lib/tools.mjs", "if (x.error || x.status !== 0) { rm(tmp); return refuse(", "if (x.error || x.status !== 0) { return refuse(", 'unit'],
  ["tools ensure: the archive is read by a tar found on PATH, not the system one", "lib/tools.mjs", "(process.platform === 'win32' ? join(ctx.env.SystemRoot", "(false ? join(ctx.env.SystemRoot", 'unit'],
  ["tools ensure: an unknown tool name is not refused", "lib/tools.mjs", "for (const n of wanted) if (!manifest.tools[n]) throw new Usage(", "for (const n of wanted) if (false) throw new Usage(", 'unit'],
  ["tools ensure: a refused tool still exits 0", "commands/tools.mjs", "const ok = tools.every(t => t.status === 'present' || t.status === 'downloaded');", "const ok = true;", 'unit'],
  ["tools: --target is accepted", "commands/tools.mjs", "if (ctx.flags.target !== undefined) throw new Usage(`tools ${verb} takes no --target", "if (false) throw new Usage(`tools ${verb} takes no --target", 'unit'],
  ["ci: an unmapped step passes", "commands/ci.mjs", "if (!row) return { ok: false, lines: [`step not mapped:", "if (!row) return { ok: true, lines: [`step not mapped:", 'unit'],
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
];

const sh = (args, env) => new Promise(res => {
  const c = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { err += d; });
  const timer = setTimeout(() => { c.kill(); }, LIMIT_MS);
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
