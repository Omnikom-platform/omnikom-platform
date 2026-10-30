// Tests for the omnikom CLI: units (no database) and an integration run on a throwaway local Postgres cluster with a fake fetch.
//   node tools/omnikom-cli/test/run.mjs [--unit | --db]      exit 0 = every check passed
// OMNIKOM_CLI_DIR points the tests at a copy of the CLI (test/mutate.mjs runs one broken copy at a time).
// OMNIKOM_TEST_CLUSTER_PORT reuses a cluster a parent already started. Output lines start with "ok  " or "FAIL ".
// Everything secret in these tests is generated at run time (no key literal in the file).
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLI_ROOT, REPO_ROOT, startCluster, freshDb, cli, makeFunctionModel } from './harness.mjs';

const onlyUnit = process.argv.includes('--unit'), onlyDb = process.argv.includes('--db');
let failed = 0, total = 0;
const t0 = Date.now();
const check = (name, ok, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'}${process.argv.includes('--time') ? ` [${((Date.now() - t0) / 1000).toFixed(0)}s]` : ''} ${name}${ok || !detail ? '' : ': ' + String(detail).slice(0, 300)}`); };
const rand = (n = 24) => randomBytes(n).toString('hex');
const lib = async f => import(pathToFileURL(join(CLI_ROOT, 'lib', f)).href);
const UUID_X = '11111111-2222-3333-4444-555555555555';

// ======================================================================================================== UNITS
async function units() {
  const { parseArgs } = await lib('args.mjs');
  const { Usage, Blocked } = await lib('errors.mjs');
  const { redact, render, registerSecret, clearRuntimeSecrets } = await lib('redact.mjs');
  const { resolveTarget, guardProduction, keyPresence } = await lib('target.mjs');
  const { parseIdentity, claimsFor, machineKey, personToken, PERSONS, siteVar } = await lib('identity.mjs');
  const { sign } = await lib('sign.mjs');
  const { lit, uuidLit, classify, pgEnv } = await lib('sql.mjs');
  const { loadFixture, realLooking } = await lib('fixtures.mjs');
  const throws = (fn, cls) => { try { fn(); return false; } catch (e) { return e instanceof cls; } };

  // ---- args
  const a = parseArgs(['lead', 'send', '--site', 'x', '--retry', '--expect=202', '--json']);
  check('args: positionals, valued flags, switches, --flag=value', a.positionals.join(' ') === 'lead send' && a.flags.site === 'x' && a.flags.retry === true && a.flags.expect === '202' && a.flags.json === true);
  check('args: a flag with no value is a usage error', throws(() => parseArgs(['status', '--target']), Usage));

  // ---- the canonical signature (rule 5): the CLI re-exports the endpoint's sign, and signature.ts accepts it
  const key = rand();
  const header = await sign(key, 'post', '/capture-lead?site=' + UUID_X, '{"a":1}', 1800000000);
  const independent = createHmac('sha256', key).update(`1800000000\nPOST\n/capture-lead?site=${UUID_X}\n{"a":1}`).digest('hex');
  check('sign: equals an independent HMAC of t, METHOD, path?query, body', header === `t=1800000000,v1=${independent}`);
  const { verify } = await import(pathToFileURL(join(REPO_ROOT, 'supabase', 'functions', '_shared', 'signature.ts')).href);
  check('sign: the platform verifier (signature.ts) accepts it', await verify(header, key, 'POST', '/capture-lead?site=' + UUID_X, '{"a":1}', 1800000010));
  check('sign: and refuses it after 301 s', !(await verify(header, key, 'POST', '/capture-lead?site=' + UUID_X, '{"a":1}', 1800000301)));

  // ---- rule 1: redaction
  const S = rand();
  const envS = { SOME_SECRET_KEY: S, PLAIN: 'visible-value' };
  check('redact: an environment value whose name looks secret is removed', !redact(`x ${S} y`, envS).includes(S) && redact('visible-value', envS) === 'visible-value');
  check('redact: the JSON-escaped form is removed too', !redact(JSON.stringify({ k: `a"${S}` }), { K_TOKEN: `a"${S}` }).includes(S));
  clearRuntimeSecrets(); registerSecret(S + 'rt', 'minted');
  check('redact: a secret registered at run time is removed', !redact(`v=${S}rt`, {}).includes(S));
  clearRuntimeSecrets();
  const jwt = `eyJ${rand(8)}.eyJ${rand(8)}.${rand(8)}`;
  check('redact: a JWT, an sb_ key, a 64-hex string, a Bearer token and a connection string are removed by shape',
    ![jwt, 'sb_secret_' + rand(8), rand(32), 'Bearer ' + rand(10) + 'zz', 'postgres://u:p@h/db'].some(v => redact('x ' + v + ' y', {}).includes(v.replace('Bearer ', ''))));
  const dbpw = rand();
  check('redact: the password inside a connection string is removed even when printed alone', !redact(`pw ${dbpw}`, { DB_URL: `postgres://u:${dbpw}@h/db` }).includes(dbpw));
  check('render: one JSON object; indented, or on one line with compact', render({ a: 1 }, { env: {} }).includes('\n  "a"') && render({ a: 1 }, { compact: true, env: {} }) === '{"a":1}\n');

  // ---- targets and the environment-by-name rules
  check('target: an unknown target is a usage error', throws(() => resolveTarget('moon', {}), Usage));
  let e; try { resolveTarget('staging', {}); } catch (x) { e = x; }
  check('target: a missing variable is BLOCKED and the message names it', e instanceof Blocked && e.message.includes('STAGING_DB_URL'));
  check('target: local must be on this machine', throws(() => resolveTarget('local', { LOCAL_DB_URL: 'postgres://u@db.example.com/x' }), Blocked));
  check('target: loopback is accepted for local', resolveTarget('local', { LOCAL_DB_URL: 'postgres://u@127.0.0.1:5/x' }).name === 'local');
  check('target: staging equal to PROD_DB_URL is refused', throws(() => resolveTarget('staging', { STAGING_DB_URL: 'postgres://u@h/x', PROD_DB_URL: 'postgres://u@h/x' }), Blocked));
  check('target: the functions URL comes from the project ref', resolveTarget('staging', { STAGING_DB_URL: 'postgres://u@h/x', STAGING_SUPABASE_REF: 'abc' }).functionsBase === 'https://abc.supabase.co/functions/v1');
  const kp = keyPresence('staging', { STAGING_DB_URL: 'postgres://u:pw1234567@h/x' });
  check('target: key presence is booleans by name, never a value', Object.values(kp).every(v => typeof v === 'boolean') && !JSON.stringify(kp).includes('pw1234567') && kp.STAGING_DB_URL === true && kp.STAGING_SUPABASE_REF === false);
  check('target: production allows status; refuses seed', !throws(() => guardProduction('production', 'status'), Blocked) && throws(() => guardProduction('production', 'seed'), Blocked));
  check('target: production apply needs --i-mean-production', throws(() => guardProduction('production', 'apply', {}), Blocked) && !throws(() => guardProduction('production', 'apply', { 'i-mean-production': true }), Blocked));

  // ---- identities
  check('identity: every person maps to the tenancy fixtures', ['owner-a', 'owner-b', 'member-a1', 'member-a2', 'staff', 'nobody'].every(n => parseIdentity(n).kind === 'person'));
  check('identity: staff carry aal2, everyone else aal1', claimsFor(parseIdentity('staff')).aal === 'aal2' && claimsFor(parseIdentity('owner-a')).aal === 'aal1');
  check('identity: site:<slug>, runner and cron are machines', parseIdentity('site:test-demo-a').keyVar === 'SITE_SIGNING_KEY_TEST_DEMO_A' && parseIdentity('runner').keyVar === 'RUNNER_KEY' && parseIdentity('cron').keyVar === 'CRON_SECRET');
  check('identity: an unknown name is a usage error; a machine has no claims', throws(() => parseIdentity('root'), Usage) && throws(() => claimsFor(parseIdentity('runner')), Usage));
  let m; try { machineKey(parseIdentity('runner'), {}); } catch (x) { m = x; }
  check('identity: a missing machine key is BLOCKED and names the variable', m instanceof Blocked && m.message.includes('RUNNER_KEY'));
  check('identity: person tokens are BLOCKED (staging GoTrue cannot see the seeded logins)', throws(() => personToken(parseIdentity('owner-a')), Blocked));
  const tenancy = readFileSync(join(REPO_ROOT, 'supabase', 'tests', 'tenancy.test.sql'), 'utf8');
  const { WS_A, WS_B, SITE_A, SITE_B, TEST_CONTRACT } = await import(pathToFileURL(join(CLI_ROOT, 'commands', 'seed.mjs')).href);
  check('seed test: ids, emails and logins are the ones in tenancy.test.sql',
    [WS_A, WS_B, SITE_A, SITE_B, ...Object.entries(PERSONS).filter(([n]) => n !== 'nobody').flatMap(([, p]) => [p.sub, p.email])].every(v => tenancy.includes(v)));
  const contractText = /select ws, 1, '\{\}'::jsonb, '(\{"collections":[\s\S]*?\})'::jsonb, true/.exec(tenancy);
  check('seed test: the contract is the one in tenancy.test.sql', contractText && JSON.stringify(JSON.parse(contractText[1])) === JSON.stringify(TEST_CONTRACT), contractText ? 'differs' : 'not found in the test file');

  // ---- sql literals
  check('sql: lit doubles quotes; uuidLit refuses a non-uuid; a NUL is refused', lit("a'b") === "'a''b'" && throws(() => uuidLit("x'; drop table leads;--"), Usage) && throws(() => lit('a\0b'), Usage));
  check('sql: errors carry the platform code', classify('psql:<stdin>:3: ERROR:  S-NOT-FOUND: not found\nCONTEXT: x').code === 'S-NOT-FOUND' && classify('ERROR:  B-OVERLAP: x').code === 'B-OVERLAP' && classify('ERROR:  syntax error').code === 'SQL' && classify('connection to server at "x" failed').code === 'CONNECT');
  const pe = pgEnv('postgres://user:p%40ss@host.example:6543/mydb?sslmode=require');
  check('sql: the connection string becomes PG* variables (nothing on the command line)', pe.PGHOST === 'host.example' && pe.PGPORT === '6543' && pe.PGUSER === 'user' && pe.PGPASSWORD === 'p@ss' && pe.PGDATABASE === 'mydb' && pe.PGSSLMODE === 'require');

  // ---- fixtures (rule 3)
  check('fixtures: the shipped fixtures look synthetic', realLooking(JSON.parse(readFileSync(join(CLI_ROOT, 'fixtures', 'lead-contact.json'), 'utf8'))).length === 0 && realLooking(JSON.parse(readFileSync(join(CLI_ROOT, 'fixtures', 'lead-manual.json'), 'utf8'))).length === 0);
  check('fixtures: a real-looking email or phone is detected', realLooking({ email: 'someone@gmail.com' }).length === 1 && realLooking({ phone: '(415) 867-5309' }).length === 1 && realLooking({ email: 'a@example.com', phone: '555-0100' }).length === 0);
  const tmp = mkdtempSync(join(tmpdir(), 'omnikom-fx-'));
  try {
    writeFileSync(join(tmp, 'outside.json'), JSON.stringify({ email: 'fake.person@example.com' }));
    check('fixtures: a synthetic file outside the folder still needs --real', throws(() => loadFixture(join(tmp, 'outside.json')), Usage));
    const outside = loadFixture(join(tmp, 'outside.json'), { real: true });
    check('fixtures: with --real it loads and carries the "outside the folder" warning', outside.warnings.length === 1 && /outside the fixtures folder/.test(outside.warnings[0]));
    writeFileSync(join(tmp, 'client.json'), JSON.stringify({ email: 'someone@gmail.com' }));
    check('fixtures: a real-looking file needs --real; with it, a warning says so', throws(() => loadFixture(join(tmp, 'client.json')), Usage) && loadFixture(join(tmp, 'client.json'), { real: true }).warnings.some(w => /gmail|not an example/.test(w)));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  check('fixtures: lead-contact loads from the folder with no warning', loadFixture('lead-contact.json').warnings.length === 0);

  // ---- exit codes and --expect
  const rUsage = await cli(['frobnicate'], {});
  check('exit 2 for usage: unknown command', rUsage.exit === 2 && rUsage.json.code === 'USAGE');
  const rUsage2 = await cli(['lead', 'send'], {});
  check('exit 2 for usage: a required flag is missing', rUsage2.exit === 2);
  const rBlocked = await cli(['status', '--target', 'staging'], {});
  check('exit 3 for BLOCKED: a missing variable, named', rBlocked.exit === 3 && rBlocked.json.code === 'BLOCKED' && rBlocked.json.error.includes('STAGING_DB_URL'));

  // ---- lead send over a fake fetch: the request is what a website sends
  const siteKey = rand();
  const envSend = { SITE_SIGNING_KEY_TEST_DEMO_A: siteKey, STAGING_DB_URL: '', STAGING_SUPABASE_REF: 'abcdefgh' };
  const seen = [];
  const answer = status => async (url, init) => { seen.push({ url: String(url), init }); return new Response(JSON.stringify({ ok: status === 202 }), { status }); };
  seen.length = 0;
  let r = await cli(['lead', 'send', '--site', UUID_X, '--as', 'site:test-demo-a', '--target', 'staging', '--retry', '--expect', '202', '--json'], envSend, { fetch: answer(202) });
  check('lead send: a signed POST to <ref>.supabase.co/functions/v1/capture-lead?site=<id>', seen.length === 2 && seen[0].url === `https://abcdefgh.supabase.co/functions/v1/capture-lead?site=${UUID_X}` && seen[0].init.method === 'POST', seen.map(s => s.url).join(' '));
  const okSig = await verify(seen[0].init.headers['x-site-signature'], siteKey, 'POST', `/capture-lead?site=${UUID_X}`, seen[0].init.body);
  check('lead send: the signature verifies with the site key against the exact body sent', okSig);
  check('lead send: --retry sends the same body (same idempotency key) twice', seen.length === 2 && seen[0].init.body === seen[1].init.body && JSON.parse(seen[0].init.body).idempotencyKey.length === 36);
  check('lead send: --expect 202 matched -> exit 0', r.exit === 0 && r.json.matched === true && r.json.code === '202');
  r = await cli(['lead', 'send', '--site', UUID_X, '--as', 'site:test-demo-a', '--target', 'staging', '--json'], envSend, { fetch: answer(401) });
  check('lead send: a 401 without --expect is exit 1; with --expect 401 it is exit 0',
    r.exit === 1 && r.json.code === '401' && (await cli(['lead', 'send', '--site', UUID_X, '--as', 'site:test-demo-a', '--target', 'staging', '--expect', '401'], envSend, { fetch: answer(401) })).exit === 0);
  r = await cli(['lead', 'send', '--site', UUID_X, '--as', 'site:test-demo-a', '--target', 'staging', '--expect', '202'], { ...envSend, SITE_SIGNING_KEY_TEST_DEMO_A: '' }, { fetch: answer(202) });
  check('lead send: no site key in the environment is BLOCKED (exit 3), naming the variable', r.exit === 3 && r.json.error.includes('SITE_SIGNING_KEY_TEST_DEMO_A'));
  r = await cli(['lead', 'send', '--site', UUID_X, '--as', 'runner', '--target', 'staging'], envSend, { fetch: answer(202) });
  check('lead send: a runner cannot send a website lead (exit 2)', r.exit === 2);
  r = await cli(['lead', 'send', '--site', UUID_X, '--as', 'site:test-demo-a', '--target', 'staging', '--fixture', join(tmpdir(), 'x.json')], envSend, { fetch: answer(202) });
  check('lead send: a fixture outside the fixtures folder is refused without --real (exit 2)', r.exit === 2);

  // ---- rule 1 hygiene: feed fake secrets, make every part of the program echo them, grep the output
  const KEY = rand(), DBPW = rand(), SK = rand();
  const dbUrl = `postgres://postgres:${DBPW}@db.example.test:5432/postgres`;
  const envH = { STAGING_DB_URL: dbUrl, STAGING_SUPABASE_REF: 'abcdefgh', STAGING_SUPABASE_SECRET_KEY: SK, SITE_SIGNING_KEY_TEST_DEMO_A: KEY };
  let sigHex = '';
  const echoFetch = async (url, init) => {
    sigHex = (/v1=([0-9a-f]{64})/.exec(init.headers['x-site-signature']) || [])[1] || '';
    return new Response(JSON.stringify({ echo: { url, headers: init.headers, key: KEY, db: dbUrl, secret: SK, text: `${KEY} ${SK} ${dbUrl}` } }), { status: 500 });
  };
  const leaky = [KEY, DBPW, SK, dbUrl];
  r = await cli(['lead', 'send', '--site', UUID_X, '--as', 'site:test-demo-a', '--target', 'staging', '--retry', '--json'], envH, { fetch: echoFetch });
  check('hygiene: a function that echoes the key, the signature and the DB URL leaks nothing into the output', leaky.every(v => !r.all.includes(v)) && sigHex.length === 64 && !r.all.includes(sigHex) && r.all.includes('<redacted'), `exit ${r.exit} ${r.all.slice(0, 200)}`);
  const noisySpawn = () => ({ status: 1, stdout: '', stderr: `psql: ERROR:  S-X: password ${DBPW} for ${dbUrl} key ${KEY}\n` });
  r = await cli(['status', '--target', 'staging'], envH, { spawn: noisySpawn });
  check('hygiene: a psql error that quotes the password and URL leaks nothing', leaky.every(v => !r.all.includes(v)) && r.json.code === 'CONNECT', r.all.slice(0, 200));
  r = await cli(['lead', 'send', '--site', UUID_X, '--as', KEY, '--target', 'staging'], envH);
  check('hygiene: a usage error that quotes its input (--as <the key>) cannot print a secret that is in the environment', r.exit === 2 && r.json.error.includes('is not an identity') && !r.all.includes(KEY), r.all.slice(0, 200));
  r = await cli(['status', '--target', 'staging', '--json'], envH, { spawn: () => ({ status: 0, stdout: '1\n', stderr: '' }), fetch: echoFetch });
  check('hygiene: status prints key names with booleans only', leaky.every(v => !r.all.includes(v)) && r.json && r.json.data.keys.STAGING_SUPABASE_SECRET_KEY === true);

  // ---- rule 2: the production guard, with a fake PROD_DB_URL; nothing may be spawned or fetched
  const PROD = { PROD_DB_URL: 'postgres://postgres:fakeprodpassword@db.prod.example.test:5432/postgres', PROD_SUPABASE_REF: 'prodref' };
  const calls = [];
  const spies = { spawn: (...x) => { calls.push(['spawn', x[0]]); return { status: 1, stdout: '', stderr: 'ERROR: x' }; }, fetch: async (...x) => { calls.push(['fetch', x[0]]); return new Response('{}', { status: 200 }); } };
  const refused = [
    ['seed', 'test'], ['seed', 'workspace', '--slug', 'x'], ['verify', '--only', 'lead'], ['key', 'mint', '--site', 'test-demo-a'], ['key', 'list'],
    ['lead', 'send', '--site', UUID_X, '--as', 'site:test-demo-a'], ['lead', 'list', '--as', 'owner-a'], ['lead', 'update', '--as', 'staff', '--lead', UUID_X],
    ['content', 'save', '--as', 'member-a1'], ['content', 'get', '--as', 'owner-a'], ['publish', '--as', 'owner-a'], ['job', 'get', '--job', UUID_X], ['test', 'walls'],
  ];
  let allRefused = true, detail = '';
  for (const argv of refused) {
    calls.length = 0;
    const x = await cli([...argv, '--target', 'production'], PROD, spies);
    if (x.exit !== 3 || x.json.code !== 'BLOCKED' || calls.length !== 0) { allRefused = false; detail += ` [${argv.slice(0, 2).join(' ')}: exit ${x.exit}, ${calls.length} calls]`; }
  }
  check('production guard: identity, seed, verify, key, lead, content, publish, job and test commands are refused (exit 3) before anything is spawned or fetched', allRefused, detail);
  calls.length = 0;
  r = await cli(['lead', 'list', '--as', 'owner-a', '--target', 'production'], PROD, spies);
  check('production guard: --as on production is refused', r.exit === 3 && calls.length === 0);
  calls.length = 0;
  r = await cli(['status', '--target', 'production'], PROD, spies);
  const statusCall = calls.find(c => c[0] === 'spawn');
  check('production guard: status is allowed and its connection is opened read-only', r.json.command === 'status' && Boolean(statusCall));
  let ro = false;
  await cli(['status', '--target', 'production'], PROD, { ...spies, spawn: (cmd, args, opts) => { ro = /^begin transaction read only;/i.test(opts.input); return { status: 1, stdout: '', stderr: '' }; } });
  check('production guard: status runs in a read-only transaction (also works through a transaction pooler)', ro);
  calls.length = 0;
  r = await cli(['apply', '--target', 'production'], PROD, spies);
  check('production guard: apply without --i-mean-production is refused', r.exit === 3 && calls.length === 0);
  let applyArgs = null;
  await cli(['apply', '--target', 'production', '--i-mean-production'], PROD, { ...spies, spawn: (cmd, args) => { applyArgs = args; return { status: 0, stdout: 'OK: applied 0 of 4 (4 were already applied)\n', stderr: '' }; } });
  check('production guard: apply --i-mean-production runs apply-staging with --url-env PROD_DB_URL', applyArgs && applyArgs.includes('--url-env') && applyArgs.includes('PROD_DB_URL') && applyArgs.includes('--i-mean-production'));
  r = await cli(['contract', 'validate', '--file', 'x.json', '--target', 'production'], PROD, spies);
  check('production guard: even a pure command is refused when asked to run against production', r.exit === 3);
}

// ======================================================================================================== DATABASE
async function database() {
  const { makeSql } = await lib('sql.mjs');
  const cluster = startCluster();
  const db = freshDb(cluster);
  const work = mkdtempSync(join(tmpdir(), 'omnikom-cli-run-'));
  const envFile = join(work, 'master.env');
  writeFileSync(envFile, '# test env file\n');
  const base = { LOCAL_DB_URL: db.url, OMNIKOM_ENV_FILE: envFile };
  const everything = [];                                  // all output of the whole run, for the final hygiene grep
  const run = async (argv, env = {}, deps = {}) => { const r = await cli(argv, { ...base, ...env }, deps); everything.push(r.all); return r; };
  const T = ['--target', 'local'];
  try {
    // ---- status before apply, apply, status after
    let r = await run(['status', ...T]);
    check('status: reachable, ledger missing, every migration pending', r.json.data.reachable && r.json.data.ledger === 'missing' && r.json.data.migrations.pending.length >= 4, JSON.stringify(r.json && r.json.data).slice(0, 200));
    r = await run(['apply', ...T, '--dry-run']);
    check('apply --dry-run: lists what would be applied, changes nothing', r.exit === 0 && r.json.data.wouldApply.length >= 4 && db.query("select to_regclass('public.workspaces') is null") === 't', r.all.slice(0, 200));
    r = await run(['apply', ...T]);
    const nApplied = r.json && r.json.data.applied.length;
    check('apply: applies every migration through apply-staging.mjs', r.exit === 0 && nApplied >= 4, r.all.slice(0, 300));
    r = await run(['apply', ...T]);
    check('apply: a second run applies none', r.exit === 0 && r.json.data.applied.length === 0 && r.json.data.skipped.length === nApplied);
    r = await run(['status', ...T]);
    check('status: all applied, none pending, none mismatched', r.exit === 0 && r.json.data.migrations.pending.length === 0 && r.json.data.migrations.applied.length === nApplied && r.json.data.migrations.mismatched.length === 0);
    check('status: no functions URL for a local target -> functions not checked', r.json.data.functions.checked === false);

    // ---- a ledger row whose hash differs from the file on disk: status says so (a migration is never edited after it applied)
    const ledgerTable = db.query("select coalesce(to_regclass('ops.platform_migrations')::text, to_regclass('public.platform_migrations')::text)");
    const firstFile = db.query(`select name from ${ledgerTable} order by name limit 1`);
    const goodHash = db.query(`select sha256 from ${ledgerTable} where name = '${firstFile}'`);
    db.query(`update ${ledgerTable} set sha256 = 'not-the-hash' where name = '${firstFile}'`);
    r = await run(['status', ...T]);
    check('status: a ledger hash that differs from the file is MIGRATION-HASH (exit 1)', r.exit === 1 && r.json.code === 'MIGRATION-HASH' && r.json.data.migrations.mismatched[0] === firstFile, r.all.slice(0, 200));
    db.query(`update ${ledgerTable} set sha256 = '${goodHash}' where name = '${firstFile}'`);

    // ---- the walls on the database (before any fixture exists)
    r = await run(['test', 'walls', ...T]);
    check('test walls: tenancy.test.sql passes on the target and leaves nothing', r.exit === 0 && (r.json.data.lines || []).some(l => l.startsWith('PASS')), r.all.slice(0, 300));

    // ---- seed test: idempotent
    const fp = () => { const s = makeSql({ url: db.url }); return s.fingerprint(); };
    const f0 = fp();
    r = await run(['seed', 'test', ...T]);
    check('seed test: creates workspaces A and B, sites, contracts, logins', r.exit === 0 && r.json.data.changed === true && db.query("select count(*) from workspaces where slug like 'test-demo-%'") === '2' && db.query('select count(*) from members') === '4' && db.query("select count(*) from content_rows where collection = 'team'") === '2', r.all.slice(0, 300));
    const f1 = fp();
    r = await run(['seed', 'test', ...T]);
    const f2 = fp();
    check('seed test twice changes nothing: every table has the same content before and after the second run', f1 !== f0 && f1 === f2 && r.json.data.changed === false, `${f1} ${f2} ${r.all.slice(0, 200)}`);
    check('seed test: each agent is linked to a team row', db.query("select count(*) from members where team_row_id is not null") === '2');
    r = await run(['seed', 'test', ...T, '--alert-to', 'owner@example.com']);
    check('seed test --alert-to sets the sites\' lead alert address', db.query("select count(distinct lead_alert_to::text) from sites") === '1' && db.query("select lead_alert_to::text from sites limit 1") === '{owner@example.com}');
    r = await run(['test', 'walls', ...T]);
    check('test walls: refuses a database that holds the seeded fixtures, and says how to clean', r.exit === 1 && r.json.code === 'FIXTURES-PRESENT' && /seed test --clean/.test(r.json.data.hint), r.all.slice(0, 200));

    // ---- seed workspace from a from-plan contract (SQL path)
    const elev8 = join(REPO_ROOT, 'contracts', 'examples', 'elev8', 'contract.json');
    const planned = JSON.parse(readFileSync(elev8, 'utf8'));
    const wsArgs = ['seed', 'workspace', ...T, '--slug', 'elev8', '--name', 'ELEV8 Real Estate Group', '--industry', 'real-estate-agent', '--deploy-target', 'elev8-omnikom-website', '--preview-host', 'elev8-omnikom-website.pages.dev', '--contract', elev8];
    r = await run([...wsArgs, '--dry-run']);
    check('seed workspace --dry-run: counts pages and places, writes nothing', r.exit === 0 && r.json.data.pages === planned.pages.length && r.json.data.places === 10 && db.query("select count(*) from workspaces where slug = 'elev8'") === '0', r.all.slice(0, 200));
    r = await run(wsArgs);
    check('seed workspace: workspace, site, active contract, every page and every place', r.exit === 0 && String(r.json.data.stored.pages) === String(planned.pages.length) && String(r.json.data.stored.other_rows) === '10' && r.json.data.stored.contract_version === 1, r.all.slice(0, 300));
    check('seed workspace: the pages carry the plan reference as their sign-off', db.query("select count(*) from content_versions v join content_rows c on c.id = v.row_id join workspaces w on w.id = c.workspace_id where w.slug = 'elev8' and v.sign_off ->> 'ref' like 'plan sitemap sha256 %'") === String(planned.pages.length + 10));
    r = await run(wsArgs);
    check('seed workspace twice changes nothing', r.exit === 0 && r.json.data.changed === false, r.all.slice(0, 200));
    const bad = join(work, 'bad.json'); writeFileSync(bad, JSON.stringify({ contractVersion: 1 }));
    r = await run([...wsArgs.slice(0, -1), bad]);
    check('seed workspace: an invalid contract is refused with its problem code and stores nothing', r.exit === 1 && r.json.code === 'C-SHAPE');

    // ---- contract validate / place (pure)
    r = await run(['contract', 'validate', '--file', elev8]);
    check('contract validate: the ELEV8 contract is valid', r.exit === 0 && r.json.data.total === 0);
    r = await run(['contract', 'validate', '--file', bad]);
    check('contract validate: a broken contract exits 1 with the first problem code', r.exit === 1 && r.json.code === 'C-SHAPE');
    const rowsFile = join(work, 'rows.json'); writeFileSync(rowsFile, JSON.stringify([{ id: 'r1', collection: 'areas', data: { name: 'Napa', slug: 'napa' } }]));
    r = await run(['contract', 'place', '--file', elev8, '--rows', rowsFile]);
    check('contract place: published rows become sitemap entries', r.exit === 0 && Array.isArray(r.json.data.sitemap) && r.json.data.sitemap.length > 0, r.all.slice(0, 200));

    // ---- key mint | list | revoke
    r = await run(['key', 'mint', ...T, '--site', 'test-demo-a']);
    const mintedA = readFileSync(envFile, 'utf8').match(/SITE_SIGNING_KEY_TEST_DEMO_A=([0-9a-f]{64})/);
    check('key mint: the value goes to the env file and the Vault and is printed nowhere', r.exit === 0 && mintedA && !r.all.includes(mintedA[1]) && db.query(`select count(*) from vault.secrets where secret = '${mintedA[1]}' and name = 'site-test-demo-a-key-1'`) === '1', r.all.slice(0, 300));
    check('key mint: the registry holds the SHA-256, the Vault name and the site', mintedA && db.query(`select count(*) from api_keys where kind = 'site-signing' and key_hash = '${createHash('sha256').update(mintedA[1]).digest('hex')}' and vault_ref = 'site-test-demo-a-key-1'`) === '1' && db.query("select signing_key_ref from sites where deploy_target = 'test-site-demo-a'") === 'site-test-demo-a-key-1');
    await run(['key', 'mint', ...T, '--site', 'test-demo-b']);
    r = await run(['key', 'mint', ...T, '--site', 'test-demo-a']);
    check('key mint: a second key is a rotation (name -key-2), the first stays active', r.exit === 0 && r.json.data.vaultSecret === 'site-test-demo-a-key-2' && db.query("select count(*) from api_keys where revoked_at is null and kind = 'site-signing'") === '3');
    r = await run(['key', 'mint', ...T, '--site', 'test-demo-b', '--env-file', join(work, 'no-such-file.env')]);
    check('key mint: no env file to receive the value is BLOCKED (exit 3) and no key is made', r.exit === 3 && db.query("select count(*) from api_keys") === '3' && !existsSync(join(work, 'no-such-file.env')), r.all.slice(0, 200));
    r = await run(['key', 'mint', ...T, '--site', '00000000-0000-0000-0000-00000000dead']);
    check('key mint: an unknown site is refused (exit 2) and nothing is stored', r.exit === 2 && db.query("select count(*) from api_keys") === '3', r.all.slice(0, 200));
    r = await run(['key', 'list', ...T]);
    const listed = JSON.stringify(r.json.data.keys);
    check('key list: hash prefixes and Vault names, never a value', r.exit === 0 && r.json.data.keys.length === 3 && r.json.data.keys.every(k => k.hash_prefix.length === 12) && !/[0-9a-f]{64}/.test(listed) && !listed.includes(mintedA[1]));
    const toRevoke = r.json.data.keys.find(k => k.vault_ref === 'site-test-demo-a-key-2').id;
    r = await run(['key', 'revoke', ...T, '--id', toRevoke]);
    check('key revoke: the key is dead (revoked_at set)', r.exit === 0 && db.query(`select revoked_at is not null from api_keys where id = '${toRevoke}'`) === 't');
    r = await run(['key', 'revoke', ...T, '--id', toRevoke, '--expect', 'S-NOT-FOUND']);
    check('key revoke: revoking again is S-NOT-FOUND (and --expect matches -> exit 0)', r.exit === 0 && r.json.code === 'S-NOT-FOUND');

    // ---- lead send over the function model, retry stores one row (rule 4)
    const siteA = db.query("select id from sites where deploy_target = 'test-site-demo-a'"), siteB = db.query("select id from sites where deploy_target = 'test-site-demo-b'");
    const keyOf = v => readFileSync(envFile, 'utf8').match(new RegExp(`${v}=([0-9a-f]{64})`))[1];
    const keyA = keyOf('SITE_SIGNING_KEY_TEST_DEMO_A'), keyB = keyOf('SITE_SIGNING_KEY_TEST_DEMO_B');
    const model = await makeFunctionModel({ makeSql, dbUrl: db.url });
    const sendEnv = { SITE_SIGNING_KEY_TEST_DEMO_A: keyA, SITE_SIGNING_KEY_TEST_DEMO_B: keyB, LOCAL_FUNCTIONS_BASE: 'https://fn.example.test/functions/v1' };
    const rkey = '9d5f9c7a-0000-4000-8000-00000000c0de';
    r = await run(['lead', 'send', ...T, '--site', 'test-demo-a', '--retry', '--key', rkey, '--expect', '202'], sendEnv, { fetch: model });
    check('lead send --retry: two sends of the same key store exactly one row', r.exit === 0 && r.json.data.attempts.length === 2 && r.json.data.stored === 1 && db.query(`select count(*) from leads where idempotency_key = '${rkey}'`) === '1', r.all.slice(0, 300));
    check('lead send: the lead arrives with its journey fields and a received event', db.query(`select flow || '|' || cta from leads where idempotency_key = '${rkey}'`) === 'contact|cli test' && db.query(`select count(*) from lead_events e join leads l on l.id = e.lead_id where l.idempotency_key = '${rkey}' and e.kind = 'received'`) === '1');
    r = await run(['lead', 'send', ...T, '--site', 'test-demo-a', '--key', rkey, '--expect', '202'], sendEnv, { fetch: model });
    check('lead send: a retry in a later run with --key still stores nothing more', r.exit === 0 && db.query(`select count(*) from leads where idempotency_key = '${rkey}'`) === '1');
    r = await run(['lead', 'send', ...T, '--site', 'test-demo-a', '--expect', '401'], { ...sendEnv, SITE_SIGNING_KEY_TEST_DEMO_A: keyB }, { fetch: model });
    check("lead send: B's key on A's site is 401, and --expect 401 passes", r.exit === 0 && r.json.code === '401');
    const dropModel = await makeFunctionModel({ makeSql, dbUrl: db.url, dropIdem: true });
    r = await run(['lead', 'send', ...T, '--site', 'test-demo-a', '--retry', '--key', '9d5f9c7a-0000-4000-8000-00000000d0d0'], sendEnv, { fetch: dropModel });
    check('lead send --retry: a platform that stores the retry again is reported (exit 1, RETRY-STORED-n)', r.exit === 1 && /^RETRY-STORED-/.test(r.json.code), r.all.slice(0, 200));
    db.query("delete from leads where idempotency_key is null and page_path = '/omnikom-cli-test'");

    // ---- lead list / get / update / add / delete as people (claims through the service functions)
    const leadId = db.query(`select id from leads where idempotency_key = '${rkey}'`);
    r = await run(['lead', 'list', ...T, '--as', 'owner-a']);
    check('lead list: the owner of A sees the lead', r.exit === 0 && r.json.data.leads.some(l => l.id === leadId));
    r = await run(['lead', 'list', ...T, '--as', 'owner-b']);
    check("lead list: owner B reads A's leads -> 0 rows", r.exit === 0 && r.json.data.count === 0);
    r = await run(['lead', 'list', ...T, '--as', 'member-a1']);
    check('lead list: a member sees only leads assigned to them (none yet)', r.exit === 0 && r.json.data.count === 0);
    r = await run(['lead', 'list', ...T, '--as', 'nobody']);
    check('lead list: a login with no workspace sees nothing', r.exit === 0 && r.json.data.count === 0);
    r = await run(['lead', 'get', ...T, '--as', 'owner-a', '--lead', leadId]);
    check('lead get: row and timeline for the owner', r.exit === 0 && r.json.data.lead.id === leadId && r.json.data.events.some(e => e.kind === 'received'));
    r = await run(['lead', 'get', ...T, '--as', 'owner-b', '--lead', leadId, '--expect', 'S-NOT-FOUND']);
    check("lead get: B's owner gets S-NOT-FOUND for A's lead", r.exit === 0 && r.json.code === 'S-NOT-FOUND');
    r = await run(['lead', 'update', ...T, '--as', 'member-a1', '--lead', leadId, '--status', 'contacted', '--expect', 'S-NOT-FOUND']);
    check("lead update: member A1 cannot update a lead that is not theirs -> S-NOT-FOUND", r.exit === 0 && r.json.code === 'S-NOT-FOUND' && db.query(`select status from leads where id = '${leadId}'`) === 'new');
    r = await run(['lead', 'update', ...T, '--as', 'owner-b', '--lead', leadId, '--status', 'spam', '--expect', 'S-NOT-FOUND']);
    check("lead update: B's owner cannot update A's lead -> S-NOT-FOUND", r.exit === 0 && db.query(`select status from leads where id = '${leadId}'`) === 'new');
    r = await run(['lead', 'update', ...T, '--as', 'owner-a', '--lead', leadId, '--status', 'contacted', '--note', 'called, left a message']);
    check('lead update: the owner changes the status; the timeline gets the status and note events', r.exit === 0 && db.query(`select status from leads where id = '${leadId}'`) === 'contacted' && db.query(`select string_agg(kind::text, ',' order by id) from lead_events where lead_id = '${leadId}'`) === 'received,status,note');
    r = await run(['lead', 'update', ...T, '--as', 'owner-a', '--lead', leadId, '--status', 'bogus']);
    check('lead update: a status outside the list is a usage error (exit 2)', r.exit === 2);
    r = await run(['lead', 'add', ...T, '--as', 'owner-a', '--site', 'test-demo-a', '--fixture', 'lead-manual.json']);
    const added = r.json && r.json.data.lead;
    check('lead add: a manual lead from the fixture, with the manual event', r.exit === 0 && added && db.query(`select form from leads where id = '${added}'`) === 'manual', r.all.slice(0, 300));
    r = await run(['lead', 'add', ...T, '--as', 'owner-b', '--site', 'test-demo-a', '--fixture', 'lead-manual.json', '--expect', 'S-NOT-FOUND']);
    check("lead add: B's owner cannot add a lead to A's site -> S-NOT-FOUND", r.exit === 0 && r.json.code === 'S-NOT-FOUND');
    r = await run(['lead', 'delete', ...T, '--as', 'owner-b', '--lead', added, '--expect', 'S-NOT-FOUND']);
    check("lead delete: B's owner cannot delete A's lead", r.exit === 0 && db.query(`select count(*) from leads where id = '${added}'`) === '1');
    r = await run(['lead', 'delete', ...T, '--as', 'owner-a', '--lead', added, '--reason', 'cli test']);
    check('lead delete: the owner deletes; the audit row survives', r.exit === 0 && db.query(`select count(*) from leads where id = '${added}'`) === '0' && db.query(`select count(*) from audit_log where action = 'lead-delete' and target = '${added}'`) === '1');
    r = await run(['lead', 'list', ...T, '--as', 'runner']);
    check('lead list: a machine identity has no login (exit 2)', r.exit === 2);

    // ---- content save / get / history
    const wsA = ['--workspace', 'test-demo-a'];
    const fx = n => join(CLI_ROOT, 'fixtures', n);
    r = await run(['content', 'save', ...T, '--as', 'member-a1', ...wsA, '--collection', 'listings', '--file', fx('listing-a1.json')]);
    const listing = r.json && r.json.data.row;
    check('content save: a member saves their own listing (version 1)', r.exit === 0 && listing && r.json.data.version === 1, r.all.slice(0, 300));
    r = await run(['content', 'save', ...T, '--as', 'member-a1', ...wsA, '--collection', 'listings', '--row', listing, '--file', fx('listing-a1-v2.json')]);
    check('content save: saving again appends version 2', r.exit === 0 && r.json.data.version === 2);
    r = await run(['content', 'history', ...T, '--as', 'member-a1', '--row', listing]);
    check('content history: two versions, by the member', r.exit === 0 && r.json.data.versions.length === 2 && r.json.data.versions[0].by === PERSON('member-a1'));
    r = await run(['content', 'get', ...T, '--as', 'member-a1', '--row', listing]);
    check('content get: the latest version', r.exit === 0 && r.json.data.row.data.street === '1 Demo Rd, Unit 2' && r.json.data.row.version === 2);
    r = await run(['content', 'get', ...T, '--as', 'member-a1', '--row', listing, '--version', '1']);
    check('content get --version 1: the first version', r.exit === 0 && r.json.data.row.data.street === '1 Demo Rd');
    r = await run(['content', 'save', ...T, '--as', 'member-a2', ...wsA, '--collection', 'listings', '--row', listing, '--file', fx('listing-a1-v2.json'), '--expect', 'S-OWN-ONLY']);
    check("content save: member A2 cannot edit A1's listing -> S-OWN-ONLY", r.exit === 0 && r.json.code === 'S-OWN-ONLY');
    r = await run(['content', 'save', ...T, '--as', 'owner-b', ...wsA, '--collection', 'listings', '--file', fx('listing-a1.json'), '--expect', 'S-NOT-FOUND']);
    check("content save: B's owner saving into A's workspace -> S-NOT-FOUND before any validation", r.exit === 0 && r.json.code === 'S-NOT-FOUND');
    r = await run(['content', 'get', ...T, '--as', 'owner-b', '--row', listing, '--expect', 'S-NOT-FOUND']);
    check("content get: B's owner cannot read A's row", r.exit === 0 && r.json.code === 'S-NOT-FOUND');
    const unknown = join(work, 'unknown.json'); writeFileSync(unknown, JSON.stringify({ street: 'x', nonsense: 1 }));
    r = await run(['content', 'save', ...T, '--as', 'member-a1', ...wsA, '--collection', 'listings', '--file', unknown, '--expect', 'I-UNKNOWN']);
    check('content save: a field outside the contract is refused by the validator (I-UNKNOWN) and nothing is stored', r.exit === 0 && db.query(`select count(*) from content_rows where collection = 'listings'`) === '1');

    // ---- publish and the job states
    r = await run(['publish', ...T, '--as', 'member-a2', '--site', 'test-demo-a', '--rows', listing, '--expect', 'S-OWN-ONLY']);
    check("publish: member A2 cannot publish A1's listing -> S-OWN-ONLY", r.exit === 0 && r.json.code === 'S-OWN-ONLY');
    r = await run(['publish', ...T, '--as', 'owner-b', '--site', 'test-demo-a', '--rows', listing, '--expect', 'S-NOT-FOUND']);
    check("publish: B's owner cannot publish on A's site -> S-NOT-FOUND", r.exit === 0 && r.json.code === 'S-NOT-FOUND');
    r = await run(['publish', ...T, '--as', 'member-a1', '--site', 'test-demo-a', '--rows', listing]);
    const job = r.json && r.json.data.job;
    check('publish: the member publishes their own listing; a queued job pins version 2', r.exit === 0 && job && db.query(`select (requested ->> '${listing}') from publish_jobs where id = '${job}'`) === '2', r.all.slice(0, 300));
    r = await run(['job', 'get', ...T, '--job', job]);
    check('job get: state queued with its first event', r.exit === 0 && r.json.data.job.state === 'queued' && r.json.data.events.length === 1);
    r = await run(['job', 'get', ...T, '--job', job, '--as', 'owner-b', '--expect', 'S-NOT-FOUND']);
    check("job get: B's owner cannot see A's job", r.exit === 0 && r.json.code === 'S-NOT-FOUND');
    r = await run(['job', 'wait', ...T, '--job', job, '--timeout', '0']);
    check('job wait: a job that is not done within the time is TIMEOUT (exit 1)', r.exit === 1 && r.json.code === 'TIMEOUT');
    r = await run(['job', 'set', ...T, '--job', job, '--state', 'done', '--expect', 'S-JOB-STATE']);
    check('job set: queued -> done is not a legal change (S-JOB-STATE)', r.exit === 0 && r.json.code === 'S-JOB-STATE');
    for (const s of ['building', 'gating', 'deploying', 'done']) { r = await run(['job', 'set', ...T, '--job', job, '--state', s]); if (r.exit !== 0) break; }
    check('job set: building (snapshot), gating, deploying, done are legal; the listing goes live at done', r.exit === 0 && db.query(`select published_version from content_rows where id = '${listing}'`) === '2', r.all.slice(0, 200));
    r = await run(['job', 'wait', ...T, '--job', job, '--timeout', '5']);
    check('job wait: returns ok once the job is done', r.exit === 0 && r.json.data.state === 'done');
    r = await run(['job', 'wait', ...T, '--job', job, '--state', 'queued', '--timeout', '0']);
    check('job wait: a finished job that never was in the wanted state is JOB-DONE (exit 1), not a hang', r.exit === 1 && r.json.code === 'JOB-DONE');

    // ---- verify --only lead, against the model and against a broken model
    r = await run(['verify', ...T, '--only', 'lead'], sendEnv, { fetch: model });
    check('verify --only lead: every check PASSes against the function model', r.exit === 0 && r.json.data.failed === 0 && r.json.data.checks.length >= 10 && /^PASS /.test(r.stderr), r.all.slice(0, 600));
    check('verify: one line per check on stderr, the real status in it', r.stderr.trim().split('\n').length === r.json.data.checks.length && /got 202/.test(r.stderr));
    check('verify: the paused-site check put the site state back and removed its leads', db.query("select state::text from sites where deploy_target = 'test-site-demo-a'") === 'preview' && db.query("select count(*) from leads where page_path = '/omnikom-cli-test'") === '1');
    const naive = await makeFunctionModel({ makeSql, dbUrl: db.url, naive: true });
    r = await run(['verify', ...T, '--only', 'lead'], sendEnv, { fetch: naive });
    check('verify: a function that accepts any signature FAILs (exit 1) on the signature checks', r.exit === 1 && r.json.code === 'VERIFY-FAILED' && r.json.data.checks.filter(c => !c.pass).map(c => c.name).join('|').includes("B's key") && /^FAIL /m.test(r.stderr), r.stderr.slice(0, 600));
    const dropped = await makeFunctionModel({ makeSql, dbUrl: db.url, dropIdem: true });
    r = await run(['verify', ...T, '--only', 'lead'], sendEnv, { fetch: dropped });
    check('verify: a function that stores a retry twice FAILs only the idempotency check', r.exit === 1 && r.json.data.checks.filter(c => !c.pass).map(c => c.name).join('|') === 'the same idempotency key twice stores one row', r.stderr.slice(0, 600));
    db.query("delete from leads where idempotency_key is null and page_path = '/omnikom-cli-test'");
    const chatty = await makeFunctionModel({ makeSql, dbUrl: db.url, doubleAlert: true });
    r = await run(['verify', ...T, '--only', 'lead'], sendEnv, { fetch: chatty });
    check('verify: a function that alerts again on a retry FAILs only the alert check', r.exit === 1 && r.json.data.checks.filter(c => !c.pass).map(c => c.name).join('|') === 'a retry sends no second alert', r.stderr.slice(0, 600));
    r = await run(['verify', ...T, '--only', 'lead'], { ...sendEnv, SITE_SIGNING_KEY_TEST_DEMO_B: '' }, { fetch: model });
    check("verify: no key for site B in the environment is BLOCKED (exit 3)", r.exit === 3);
    r = await run(['verify', ...T, '--only', 'job']);
    check('verify: an unknown suite is a usage error', r.exit === 2);

    // ---- verify --only walls: anon callers of the Data API (a model of PostgREST over a fake fetch)
    const anonKey = `sb_publishable_${rand(12)}`;
    const wallsEnv = { LOCAL_REST_BASE: 'https://rest.example.test/rest/v1', LOCAL_SUPABASE_PUBLISHABLE_KEY: anonKey };
    const postgrest = ({ openRpc = false, openRows = false } = {}) => async (url, init = {}) => {
      const u = new URL(url);
      const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
      if (init.headers && init.headers.apikey !== anonKey) return json(401, { message: 'No API key found' });
      if (u.pathname.includes('/rpc/')) return openRpc ? json(200, { id: 'x' }) : json(406, { code: 'PGRST106' });
      return openRows ? json(200, [{ id: 'row' }]) : json(401, { code: '42501' });
    };
    r = await run(['verify', ...T, '--only', 'walls'], wallsEnv, { fetch: postgrest() });
    check('verify --only walls: a Data API that refuses anon passes, and the person checks are listed as waiting', r.exit === 0 && r.json.data.failed === 0 && r.json.data.checks.length === 5 && r.json.data.waiting.length >= 5 && /^PASS /.test(r.stderr), r.all.slice(0, 400));
    r = await run(['verify', ...T, '--only', 'walls'], wallsEnv, { fetch: postgrest({ openRpc: true }) });
    check('verify --only walls: a service function that answers anon FAILs (exit 1)', r.exit === 1 && r.json.data.checks.filter(c => !c.pass).map(c => c.name).join('|') === 'anon calling a service function is refused|anon calling service.lead_update is refused', r.stderr.slice(0, 400));
    r = await run(['verify', ...T, '--only', 'walls'], wallsEnv, { fetch: postgrest({ openRows: true }) });
    check('verify --only walls: a table that returns rows to anon FAILs (exit 1)', r.exit === 1 && r.json.data.checks.filter(c => !c.pass).length === 3, r.stderr.slice(0, 400));
    r = await run(['verify', ...T, '--only', 'walls'], { ...wallsEnv, LOCAL_SUPABASE_PUBLISHABLE_KEY: '' }, { fetch: postgrest() });
    check('verify --only walls: no anon key in the environment is BLOCKED (exit 3)', r.exit === 3);
    r = await run(['verify', ...T, '--only', 'walls'], { LOCAL_SUPABASE_PUBLISHABLE_KEY: anonKey }, { fetch: postgrest() });
    check('verify --only walls: no Data API URL is BLOCKED (exit 3)', r.exit === 3);
    check('hygiene: the anon key is in no output of the walls runs', everything.every(o => !o.includes(anonKey)));

    // ---- seed test --clean: a login that a real workspace still references (the staff actor of elev8) stays, and is reported
    r = await run(['seed', 'test', ...T, '--clean']);
    check('seed test --clean: removes the fixtures and their Vault secrets; the staff login that elev8 still references is kept and reported',
      r.exit === 0 && db.query("select count(*) from workspaces where slug like 'test-demo-%'") === '0' && db.query("select count(*) from vault.secrets where name like 'site-test-demo-%'") === '0' && db.query('select count(*) from auth.users') === '1' && r.json.data.keptLogins.length === 1, r.all.slice(0, 300));
    db.query("delete from workspaces where slug = 'elev8'");
    r = await run(['seed', 'test', ...T, '--clean']);
    check('seed test --clean: once nothing references it, the last login goes too', r.exit === 0 && db.query('select count(*) from auth.users') === '0' && r.json.data.keptLogins.length === 0, r.all.slice(0, 300));
    r = await run(['test', 'walls', ...T]);
    check('test walls: passes again after the clean', r.exit === 0, r.all.slice(0, 300));

    // ---- rule 1 over the whole database session
    const secrets = [keyA, keyB, db.url];
    check('hygiene: nothing printed in the whole database session contains a minted key or the DB URL', secrets.every(s => everything.every(o => !o.includes(s))));
  } finally {
    cluster.stop();
    rmSync(work, { recursive: true, force: true });
  }
}
const PERSON = n => ({ 'member-a1': '00000000-0000-0000-0000-0000000000a1' })[n];

if (!onlyDb) await units();
if (!onlyUnit) await database();
console.log(`\n${failed ? 'FAILED' : 'OK'}: ${total - failed} of ${total} checks passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
