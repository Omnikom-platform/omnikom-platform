// Tests for the omnikom CLI: units (no database) and an integration run on a throwaway local Postgres cluster with a fake fetch.
//   node tools/omnikom-cli/test/run.mjs [--unit | --db] [--bail]      exit 0 = every check passed; --bail stops at the first FAIL (exit 1)
// OMNIKOM_CLI_DIR points the tests at a copy of the CLI (test/mutate.mjs runs one broken copy at a time).
// OMNIKOM_TEST_CLUSTER_PORT reuses a cluster a parent already started. Output lines start with "ok  " or "FAIL ".
// Everything secret in these tests is generated at run time (no key literal in the file).
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync, mkdirSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative, dirname, basename, delimiter, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import { CLI_ROOT, REPO_ROOT, startCluster, sweepClusters, clusterDiag, freshDb, cli, makeFunctionModel, makeSupabaseModel } from './harness.mjs';
import { impactStampHooksTests } from './impact-stamp-hooks.mjs';
import { journeyTests } from './journey.mjs';
import { withEnvTests } from './with-env.mjs';
import { makeCheck, mutateRunTests } from './mutate-run.mjs';

const onlyUnit = process.argv.includes('--unit'), onlyDb = process.argv.includes('--db');
// --bail stops at the first FAIL (test/mutate.mjs: a caught mutant needs one red check; a run with no FAIL still runs everything); see makeCheck
const { check, counts } = makeCheck({ bail: process.argv.includes('--bail'), timed: process.argv.includes('--time') });
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
  // ---- person tokens (Auth admin generate_link + verify) over a fake GoTrue; TOTP for the staff aal2 session
  const { totp } = await lib('totp.mjs');
  check('totp: the RFC 6238 vectors (SHA1, 8 digits, T=59 and T=1111111109)', totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59, { digits: 8 }) === '94287082' && totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1111111109, { digits: 8 }) === '07081804');
  const blocked = async fn => { try { await fn(); return null; } catch (e) { return e instanceof Blocked ? e : null; } };
  const admK = `sb_secret_${rand(12)}`, pubK = `sb_publishable_${rand(12)}`, sess = `tok_${rand(20)}`, hashed = `th_${rand(8)}`, aal2tok = `tok_${rand(20)}`, totpSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const tgt = resolveTarget('staging', { STAGING_DB_URL: 'postgres://u:p@h.example.test:6543/db', STAGING_SUPABASE_REF: 'abcdref' }, { needDb: false });
  const authEnv = { STAGING_SUPABASE_SECRET_KEY: admK, STAGING_SUPABASE_PUBLISHABLE_KEY: pubK };
  const authSeen = [];
  const gotrue = (over = {}) => async (url, init = {}) => {
    const path = new URL(url).pathname.replace('/auth/v1', '');
    authSeen.push({ path, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    const reply = (s, o) => new Response(JSON.stringify(o), { status: s });
    if (over[path]) return over[path];
    if (path === '/admin/generate_link') return reply(200, { hashed_token: hashed });
    if (path === '/verify') return reply(200, { access_token: sess });
    if (path === '/user') return reply(200, { factors: [{ id: 'f-1', factor_type: 'totp', status: 'verified' }] });
    if (path === '/factors/f-1/challenge') return reply(200, { id: 'ch-1' });
    if (path === '/factors/f-1/verify') return reply(200, { access_token: aal2tok });
    return reply(404, { msg: 'no' });
  };
  let tok = await personToken(parseIdentity('owner-a'), { target: tgt, env: authEnv, fetchImpl: gotrue() });
  check('person token: generate_link with the admin key, then verify with the token hash and the anon key; the session comes back',
    tok === sess && authSeen[0].path === '/admin/generate_link' && authSeen[0].headers.apikey === admK && authSeen[0].body.email === 'owner-a@test' && authSeen[0].body.type === 'magiclink'
    && authSeen[1].path === '/verify' && authSeen[1].headers.apikey === pubK && authSeen[1].body.token_hash === hashed);
  check('person token: the session and the token hash are masked in anything rendered', !render({ x: sess, y: hashed, z: `Bearer ${sess}` }, {}).includes(sess) && !render({ y: hashed }, {}).includes(hashed));
  authSeen.length = 0;
  let b = await blocked(() => personToken(parseIdentity('owner-a'), { target: tgt, env: authEnv, fetchImpl: gotrue({ '/admin/generate_link': new Response(JSON.stringify({ code: 500, msg: 'users_email_partial_key' }), { status: 500 }) }) }));
  check('person token: a refusal from Auth is BLOCKED with its status and message, and nothing else is tried', b && /500/.test(b.message) && /users_email_partial_key/.test(b.message) && authSeen.length === 1, b ? b.message : 'not blocked');
  b = await blocked(() => personToken(parseIdentity('owner-a'), { target: tgt, env: authEnv, fetchImpl: gotrue({ '/verify': new Response('{}', { status: 400 }) }) }));
  check('person token: a verify without a session is BLOCKED', b && /verify answered 400/.test(b.message));
  b = await blocked(() => personToken(parseIdentity('owner-a'), { target: tgt, env: { STAGING_SUPABASE_PUBLISHABLE_KEY: pubK }, fetchImpl: gotrue() }));
  check('person token: a missing admin key is BLOCKED and names the variable', b && b.message.includes('STAGING_SUPABASE_SECRET_KEY'));
  b = await blocked(() => personToken(parseIdentity('owner-a'), { target: resolveTarget('local', { LOCAL_DB_URL: 'postgres://u@127.0.0.1:5432/db' }), env: authEnv, fetchImpl: gotrue() }));
  check('person token: the local target has no Auth service (BLOCKED)', b && /Auth/.test(b.message));
  b = await blocked(() => personToken(parseIdentity('staff'), { target: tgt, env: authEnv, fetchImpl: gotrue() }));
  check('person token: staff without TEST_STAFF_TOTP_SECRET is BLOCKED and names it', b && b.message.includes('TEST_STAFF_TOTP_SECRET'));
  authSeen.length = 0;
  tok = await personToken(parseIdentity('staff'), { target: tgt, env: { ...authEnv, TEST_STAFF_TOTP_SECRET: totpSecret }, fetchImpl: gotrue(), now: () => 59 });
  const mfaVerify = authSeen.find(s => s.path === '/factors/f-1/verify');
  check('person token: staff gets an aal2 session: factor found, challenge made, the code is the TOTP of the secret', tok === aal2tok && mfaVerify && mfaVerify.body.challenge_id === 'ch-1' && mfaVerify.body.code === totp(totpSecret, 59) && mfaVerify.headers.authorization === `Bearer ${sess}`);
  tok = await personToken(parseIdentity('staff'), { target: tgt, env: { ...authEnv, TEST_STAFF_TOTP_SECRET: totpSecret }, fetchImpl: gotrue(), aal1: true });
  check('person token: aal1 asked for -> the plain session, no MFA calls', tok === sess);
  const tenancy = readFileSync(join(REPO_ROOT, 'supabase', 'tests', 'tenancy.test.sql'), 'utf8');
  const { WS_A, WS_B, SITE_A, SITE_B, TEST_CONTRACT } = await import(pathToFileURL(join(CLI_ROOT, 'commands', 'seed.mjs')).href);
  check('seed test: ids, emails and logins are the ones in tenancy.test.sql',
    [WS_A, WS_B, SITE_A, SITE_B, ...Object.entries(PERSONS).filter(([n]) => n !== 'nobody').flatMap(([, p]) => [p.sub, p.email])].every(v => tenancy.includes(v)));
  const { loginsSql, LOGINS } = await import(pathToFileURL(join(CLI_ROOT, 'commands', 'seed.mjs')).href);
  const lsql = loginsSql();
  check('seed test: the login rows carry every column GoTrue scans, for all six logins',
    LOGINS.length === 6 && ['instance_id', 'aud', 'role', 'email_confirmed_at', 'confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change', 'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token', 'raw_app_meta_data', 'raw_user_meta_data', 'is_sso_user'].every(c => lsql.includes(c)) && (lsql.match(/'authenticated', 'authenticated'/g) || []).length === 6 && /update auth\.users set/.test(lsql));
  const contractText = /select ws, 1, '\{\}'::jsonb, '(\{"collections":[\s\S]*?\})'::jsonb, true/.exec(tenancy);
  check('seed test: the contract is the one in tenancy.test.sql', contractText && JSON.stringify(JSON.parse(contractText[1])) === JSON.stringify(TEST_CONTRACT), contractText ? 'differs' : 'not found in the test file');

  {   // seed test and sites/test-demo-a/stage.mjs write the same resolved contract, the ordered leadColumns included (J7 of the journey found them rewriting each other)
    const { loadTestSite } = await import(pathToFileURL(join(CLI_ROOT, 'commands', 'seed.mjs')).href);
    const V = await import(pathToFileURL(join(REPO_ROOT, 'contracts', 'validate.mjs')).href);
    const site = await loadTestSite();
    const stageResolved = { ...site.contract, collections: V.mergeCore(site.contract), leadColumns: V.leadColumns(site.contract) };
    const stageSrc = readFileSync(join(REPO_ROOT, 'sites', 'test-demo-a', 'stage.mjs'), 'utf8');
    check('seed test: the resolved contract equals the one stage.mjs builds for the same contract, the ordered leadColumns included (the two no longer rewrite each other)',
      JSON.stringify(site.resolved) === JSON.stringify(stageResolved) && Array.isArray(site.resolved.leadColumns) && site.resolved.leadColumns.length > 0 && stageSrc.includes('collections: mergeCore(contract), leadColumns: leadColumns(contract)'),
      JSON.stringify(Object.keys(site.resolved)));
    {   // seed workspace builds its resolved contract through the same helper: a plan with industry form fields seeds leadColumns in form order
      const { seedGroup, resolveContract } = await import(pathToFileURL(join(CLI_ROOT, 'commands', 'seed.mjs')).href);
      const { makeCtx } = await lib('ctx.mjs');
      const elev8File = join(REPO_ROOT, 'contracts', 'examples', 'elev8', 'contract.json');
      const plan = JSON.parse(readFileSync(elev8File, 'utf8'));
      const dry = await seedGroup(makeCtx({ command: 'seed', positionals: ['seed', 'workspace'], flags: { slug: 'elev8', name: 'ELEV8', industry: 'real-estate-agent', 'deploy-target': 'elev8-site', 'preview-host': 'elev8.pages.dev', contract: elev8File, 'dry-run': true } }));
      const want = V.leadColumns(plan).map(c => c.key), got = (dry.data && dry.data.leadColumns) || [];
      check('seed workspace: a plan with industry form fields seeds leadColumns in form order (topic of the first form before address of the second before area of the third), the same list leadColumns of the contract gives',
        dry.ok && got.length >= 10 && got.join() === want.join() && got.indexOf('topic') < got.indexOf('address') && got.indexOf('address') < got.indexOf('area'), JSON.stringify({ ok: dry.ok, code: dry.code, got }));
      check('seed workspace and seed test build the resolved contract through one helper (resolveContract: contract, merged core, ordered leadColumns)',
        JSON.stringify(resolveContract(plan, V)) === JSON.stringify({ ...plan, collections: V.mergeCore(plan), leadColumns: V.leadColumns(plan) }));
    }
    check('seed test: leadColumns is in form order (side, budget, timing, beds, area, message), not the order jsonb would keep', site.resolved.leadColumns.map(c => c.key).join() === Object.values(site.contract.forms).flatMap(f => Object.keys(f.fields)).filter(k => !['name', 'email', 'phone'].includes(k)).join(),
      site.resolved.leadColumns.map(c => c.key).join());
  }

  // ---- test walls: the namespace map (lib/walls.mjs). The expectations come from the test's own patterns, not from the mapper's.
  {
    const walls = await lib('walls.mjs');
    const fresh = () => { const h = randomBytes(16).toString('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
    const RUN = 'abc123def0';
    const mw = walls.mapNamespace(tenancy, { run: RUN, newUuid: fresh });
    const origIds = [...new Set((tenancy.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || []).map(x => x.toLowerCase()))];
    const countOf = (text, needle) => text.split(needle).length - 1;
    const lowerMapped = mw.text.toLowerCase();
    check('walls map: every UUID literal of tenancy.test.sql is replaced, one fresh id per old id, as often as it stood, and no original is left',
      origIds.length >= 15 && mw.uuids.size === origIds.length && origIds.every(id => !lowerMapped.includes(id) && countOf(lowerMapped, mw.uuids.get(id)) === countOf(tenancy.toLowerCase(), id)),
      `${origIds.length} ids, ${mw.uuids.size} mapped, left: ${origIds.filter(id => lowerMapped.includes(id)).join(' ')}`);
    // the file writes the beginning of an id on its own twice (line 886: m ->> 'path' like 'aaaaaaaa-%'; line 888: position('bbbbbbbb-0000-0000-0000-' in ...)):
    // those must still mean the ids of A and of B after the map
    const nWsA = mw.uuids.get(WS_A), nSiteA = mw.uuids.get(SITE_A), nWsB = mw.uuids.get(WS_B), nSiteB = mw.uuids.get(SITE_B);
    check('walls map: ids that shared their beginning still share it (workspace A and site A, workspace B and site B), A and B differ, and the whole ids differ',
      nWsA.slice(0, 24) === nSiteA.slice(0, 24) && nWsB.slice(0, 24) === nSiteB.slice(0, 24) && nWsA.slice(0, 9) !== nWsB.slice(0, 9) && nWsA !== nSiteA && nWsB !== nSiteB && new Set(mw.uuids.values()).size === mw.uuids.size, `${nWsA} ${nSiteA} ${nWsB} ${nSiteB}`);
    check('walls map: a LIKE \'aaaaaaaa-%\' and a position(\'bbbbbbbb-0000-0000-0000-\' ...) follow their ids',
      mw.text.includes(`like '${nWsA.slice(0, 9)}%'`) && mw.text.includes(`position('${nWsB.slice(0, 24)}' in`) && mw.prefixes >= 2 && !/like 'aaaaaaaa-%'|position\('bbbbbbbb-0000-0000-0000-'/.test(mw.text), `prefixes ${mw.prefixes}`);
    check('walls map: no test- slug or target, no @test email and no staff@omnikom is left (the test\'s own patterns, any letter case)',
      !/(^|[^a-z0-9_])test-[a-z0-9]/i.test(mw.text) && !/@test\b/i.test(mw.text) && !/staff@omnikom/i.test(mw.text), (mw.text.match(/(^|[^a-z0-9_])test-[a-z0-9]\S*|\S*@test\b\S*/i) || [''])[0]);
    check('walls map: slugs, targets and emails land in walls-<run> (the names the file asserts on are mapped the same way)',
      ['walls-abc123def0-demo-a', 'walls-abc123def0-site-demo-a', 'walls-abc123def0-demo-d', "'owner-a@walls-abc123def0.test'", 'boss@walls-abc123def0.test.com', 'Boss@walls-abc123def0.Test.com', "'staff@walls-abc123def0.test'"].every(s => mw.text.includes(s))
      && mw.slugs >= 7 && mw.emails >= 30, `slugs ${mw.slugs} emails ${mw.emails}`);
    check('walls map: the scan finds nothing left in the mapped copy', walls.unmappedLiterals(tenancy, mw.text).length === 0, walls.unmappedLiterals(tenancy, mw.text).join(' '));
    const skipped = mw.text.split(mw.uuids.get(WS_A)).join(WS_A);
    check('walls map: a copy whose map skipped one id is named by the scan (that id, nothing else)', JSON.stringify(walls.unmappedLiterals(tenancy, skipped)) === JSON.stringify([WS_A]), walls.unmappedLiterals(tenancy, skipped).join(' '));
    check('walls map: a copy that kept one slug, or one email, is named by the scan',
      walls.unmappedLiterals(tenancy, mw.text.replace('walls-abc123def0-demo-b', 'test-demo-b')).includes('test-demo-b')
      && walls.unmappedLiterals(tenancy, mw.text.replace('owner-b@walls-abc123def0.test', 'owner-b@test')).some(x => x.includes('owner-b@test')));
    check('walls map: the scan is wider than the map: an upper-case TEST- slug is named although the map does not rewrite it',
      JSON.stringify(walls.unmappedLiterals("select 'TEST-demo-x';", walls.mapNamespace("select 'TEST-demo-x';", { run: RUN, newUuid: fresh }).text)) === JSON.stringify(['TEST-demo-x']));
    check('walls map: a run id that is not 6 to 16 lower-case letters or digits is refused', throws(() => walls.mapNamespace('x', { run: 'Bad Run', newUuid: fresh }), Error));

    // the fingerprint of the test site: one row per table; a difference names the table
    const row = (t, nn, h) => ({ tbl: t, n: nn, h });
    const same = walls.FINGERPRINT_TABLES.map(t => row(t, 3, 'aa'));
    const diffs = walls.fingerprintDiff(same, same.map(x => x.tbl === 'content_rows' ? row('content_rows', 3, 'bb') : x.tbl === 'leads' ? row('leads', 4, 'aa') : x));
    check('walls fingerprint: only an answer that names every table with a count and a hash is a fingerprint (a list of bare strings, a missing table, an empty answer are not)',
      walls.complete(same) && !walls.complete(walls.FINGERPRINT_TABLES) && !walls.complete(same.slice(1)) && !walls.complete([]) && !walls.complete(null) && !walls.complete(same.map(x => ({ ...x, h: undefined }))));
    check('walls fingerprint: equal rows -> no difference; a changed table is named (content, and count)',
      walls.fingerprintDiff(same, same).length === 0 && diffs.map(d => d.table).sort().join(',') === 'content_rows,leads' && walls.diffLine(diffs.find(d => d.table === 'content_rows')).includes('content_rows (3 rows -> 3 rows, same count, different content)'), JSON.stringify(diffs));
    const fpSql = walls.siteFingerprintSql({ workspaces: [WS_A, WS_B], sites: [SITE_A, SITE_B], users: [PERSONS['owner-a'].sub] });
    check('walls fingerprint: the query covers workspaces, sites, contracts, content rows and versions, media, members, keys, leads, the two ledgers and the audit log',
      ['workspaces', 'sites', 'site_contracts', 'content_rows', 'content_versions', 'media', 'members', 'api_keys', 'leads', 'security_events', 'consent_ledger', 'audit_log'].every(t => fpSql.includes(`'${t}' as tbl`)) && fpSql.includes(WS_A) && fpSql.includes(SITE_B) && walls.FINGERPRINT_TABLES.length >= 12);

    // the whole command refuses a copy that still holds a fixture literal BEFORE any database is touched: the database url points at a closed port,
    // so reaching it would be CONNECT, not WALLS-UNMAPPED
    const fxRoot = mkdtempSync(join(tmpdir(), 'omnikom-walls-fx-'));
    try {
      mkdirSync(join(fxRoot, 'supabase', 'tests'), { recursive: true });
      mkdirSync(join(fxRoot, 'factory', 'worker'), { recursive: true });   // lib/sign.mjs imports it from the repo root when the CLI loads
      cpSync(join(REPO_ROOT, 'factory', 'worker', 'lead-endpoint.mjs'), join(fxRoot, 'factory', 'worker', 'lead-endpoint.mjs'));
      writeFileSync(join(fxRoot, 'supabase', 'tests', 'tenancy.test.sql'), "select 'TEST-demo-x', '00000000-0000-0000-0000-00000000000a', 'ALL TENANCY TESTS PASSED';\n");
      const child = spawnSync(process.execPath, [join(CLI_ROOT, 'omnikom.mjs'), 'test', 'walls', '--target', 'local'], {
        encoding: 'utf8', timeout: 120000, windowsHide: true,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, OMNIKOM_REPO_ROOT: fxRoot, LOCAL_DB_URL: 'postgres://postgres@127.0.0.1:1/none' },
      });
      let out = null; try { out = JSON.parse(child.stdout); } catch { /* reported below */ }
      check('test walls: a copy that still holds a fixture literal is refused (exit 1, WALLS-UNMAPPED, the literal named) before any database is touched',
        child.status === 1 && out && out.code === 'WALLS-UNMAPPED' && out.data.left.includes('TEST-demo-x'), `${child.status} ${String(child.stdout).slice(0, 200)} ${String(child.stderr).slice(0, 100)}`);
    } finally { rmSync(fxRoot, { recursive: true, force: true }); }
  }

  // ---- status: which folders are functions (supabase/functions, supabase/config.toml)
  {
    const { listFunctions, disabledFunctions } = await import(pathToFileURL(join(CLI_ROOT, 'commands', 'status.mjs')).href);
    const fx = mkdtempSync(join(tmpdir(), 'omnikom-fn-fx-'));
    try {
      const put = (rel, text = 'x') => { mkdirSync(join(fx, dirname(rel)), { recursive: true }); writeFileSync(join(fx, rel), text); };
      put('functions/alpha/index.ts'); put('functions/beta/index.ts'); put('functions/gamma/index.ts'); put('functions/_shared/auth.ts');
      put('functions/test/harness.mjs'); put('functions/notes/readme.md'); put('functions/zed/index.ts');
      const cfg = ['[functions.alpha]', 'verify_jwt = true', '', '[functions.beta]', 'verify_jwt = false', 'enabled = false   # off for now', '', '# [functions.gamma]', '# enabled = false', '', '[functions."zed"]', 'enabled = true', '', '[other]', 'enabled = false', ''].join('\n');
      check('status functions: a folder is a function only with an index.ts (_shared, test and notes are not), and a disabled one is listed as disabled',
        JSON.stringify(listFunctions(join(fx, 'functions'), cfg)) === JSON.stringify([{ name: 'alpha', disabled: false }, { name: 'beta', disabled: true }, { name: 'gamma', disabled: false }, { name: 'zed', disabled: false }]), JSON.stringify(listFunctions(join(fx, 'functions'), cfg)));
      check('status functions: only a [functions.<name>] table with enabled = false disables (a comment, another table and enabled = true do not)',
        JSON.stringify([...disabledFunctions(cfg)]) === JSON.stringify(['beta']) && disabledFunctions('').size === 0);
      check('status functions: no functions folder -> an empty list', listFunctions(join(fx, 'nothing'), cfg).length === 0);
    } finally { rmSync(fx, { recursive: true, force: true }); }
  }
  // tenancy.test.sql (T21) builds its own Vault stand-in only when no vault schema exists; the CLI's cluster has test/vault-shim.sql, so T21
  // runs against that one: it must hold every function, table column and view column of T21's stand-in (run 41263232641: no update_secret)
  const vaultShape = sql => {
    const items = s => { const out = []; let depth = 0, cur = ''; for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
    const tbl = /create table vault\.secrets \(([\s\S]*?)\);/.exec(sql);
    const view = /create view vault\.decrypted_secrets as select ([\s\S]*?) from vault\.secrets/.exec(sql);
    return {
      functions: [...sql.matchAll(/create function vault\.(\w+)/g)].map(m => m[1]),
      columns: tbl ? items(tbl[1]).map(i => i.split(/\s+/)[0]) : [],
      view: view ? items(view[1]).map(i => i.split(/\s+/).pop()) : [],
    };
  };
  const t21Vault = vaultShape(tenancy), cliVault = vaultShape(readFileSync(join(CLI_ROOT, 'test', 'vault-shim.sql'), 'utf8'));
  const vaultMissing = ['functions', 'columns', 'view'].flatMap(k => t21Vault[k].filter(n => !cliVault[k].includes(n)).map(n => `${k}: ${n}`));
  check('vault shim: test/vault-shim.sql holds every function, column and view column of the Vault stand-in in tenancy.test.sql (T21 runs against it)',
    t21Vault.functions.length >= 2 && t21Vault.columns.length >= 4 && t21Vault.view.length >= 4 && vaultMissing.length === 0, vaultMissing.join(', ') || JSON.stringify(t21Vault));

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

  // ---- audit and gate: thin calls into tools/audit (the engine has its own tests); the lines must come out exactly as the engine made them
  const GOOD = join(REPO_ROOT, 'tools', 'audit', 'fixtures', 'good'), BAD = join(REPO_ROOT, 'tools', 'audit', 'fixtures', 'bad-MET-003');
  const engine = await import(pathToFileURL(join(REPO_ROOT, 'tools', 'audit', 'index.mjs')).href);
  const out = x => x.stdout.split('\n').filter(Boolean);
  const FAIL_LINE = 'FAIL MET-003 /tasting-room/:48 ';
  // slice 4c flip: a built folder run names its target (the engine refuses one with none), so the runs that are not about the target pass production
  const TP = ['--target', 'production'];
  const engineGood = engine.audit(GOOD, { target: 'production' }), engineBad = engine.audit(BAD, { target: 'production' });
  // the counts come from the engine, not from a literal: the SEO department adds rules to tools/audit without touching this file (17 on 2026-10-31, 14 the day before)
  const NP = engineGood.pages.length, NR = engineGood.rules.length;
  r = await cli(['audit', '--dir', GOOD, ...TP], {});
  check('audit: the good site exits 0, every line but the summary starts with PASS, the summary counts the engine\'s pages and rules and 0 FAIL',
    r.exit === 0 && out(r).slice(0, -1).every(l => l.startsWith('PASS ') || l.startsWith('SKIP PMP-001 / no --prompt-coverage')) && out(r).filter(l => l.startsWith('SKIP PMP-001 / no --prompt-coverage')).length === 1 && out(r).length > 1 && out(r).at(-1).startsWith(`audit: ${NP} pages, ${NR} rules, 0 FAIL`), r.all.slice(-200));
  check('audit: text mode prints no JSON object and nothing on stderr', !r.stdout.trimStart().startsWith('{') && r.stderr === '');
  r = await cli(['audit', '--dir', BAD, ...TP], {});
  check('audit: the bad site exits 1 and its lines (minus the summary) are the engine\'s lines, identical and in order',
    r.exit === 1 && JSON.stringify(out(r).slice(0, -1)) === JSON.stringify(engineBad.lines) && engineBad.lines.some(l => l.startsWith('FAIL ')), r.all.slice(-300));
  check('audit: the last line counts the FAIL', out(r).at(-1) === `audit: ${NP} pages, ${NR} rules, 1 FAIL, 0 WARN, 1 SKIP`, out(r).at(-1));
  r = await cli(['audit', '--dir', BAD, '--only', 'MET-003', ...TP], {});
  check('audit --only MET-003 prints the one FAIL MET-003 line with its source',
    r.exit === 1 && out(r).filter(l => l.startsWith('FAIL ')).length === 1 && out(r).some(l => l.startsWith(FAIL_LINE) && l.endsWith('(source: checklist/web-delivery.md MET-003)')) && out(r).slice(0, -1).every(l => l.includes(' MET-003 ')), r.all.slice(-300));
  r = await cli(['audit', '--dir', BAD, '--only', ' MET-003 , ,met-003', ...TP], {});
  check('audit --only: ids are split on commas, trimmed, empty ones dropped', r.exit === 1 && out(r).slice(0, -1).every(l => l.includes(' MET-003 ')) && out(r).at(-1).startsWith(`audit: ${NP} pages, 1 rules`), r.all.slice(-200));
  r = await cli(['audit', '--dir', relative(process.cwd(), GOOD), ...TP], {});
  check('audit: --dir is resolved against the current working directory', r.exit === 0 && out(r).at(-1).startsWith(`audit: ${NP} pages`), r.all.slice(-200));
  r = await cli(['gate', '--dir', BAD, ...TP], {});
  check('gate: the bad site exits 1; first line GATE FAIL 1 finding(s), then the engine\'s FAIL line unchanged, nothing else',
    r.exit === 1 && out(r).length === 2 && out(r)[0] === 'GATE FAIL 1 finding(s)' && out(r)[1] === engineBad.lines.find(l => l.startsWith('FAIL ')) && out(r)[1].startsWith(FAIL_LINE), r.all.slice(-300));
  r = await cli(['gate', '--dir', GOOD, ...TP], {});
  check('gate: the good site exits 0 with the one line GATE PASS <pages> pages, <rules> rules', r.exit === 0 && r.stdout === `GATE PASS ${NP} pages, ${NR} rules\n`, r.all.slice(-200));
  r = await cli(['gate'], {});
  check('gate without --dir exits 2 (no default to the current folder)', r.exit === 2 && r.stdout.startsWith('ERROR ') && r.stdout.includes('--dir'), r.all);
  r = await cli(['audit', ...TP], {});
  check('audit without --dir exits 2 naming --dir (not the target)', r.exit === 2 && r.stdout.startsWith('ERROR ') && r.stdout.includes('--dir'), r.all);
  r = await cli(['gate', '--dir', join(REPO_ROOT, 'tools', 'audit', 'fixtures', 'no-such-folder'), ...TP], {});
  check('gate --dir <missing folder> exits 2 (never 0), saying it is not a folder', r.exit === 2 && r.stdout.startsWith('ERROR ') && r.stdout.includes('--dir is not a folder'), r.all);
  r = await cli(['audit', '--dir', join(GOOD, 'index.html'), ...TP], {});
  check('audit --dir <a file> exits 2, saying it is not a folder', r.exit === 2 && r.stdout.includes('--dir is not a folder'), r.all);
  const TARGET_MSG = 'ERROR audit takes --target preview|production (the build\'s target); it talks to no environment\n';
  r = await cli(['audit', '--dir', GOOD, '--target', 'staging'], {});
  check('audit --target staging exits 2 with the build-target message (it talks to no environment)', r.exit === 2 && r.stdout === TARGET_MSG, r.all);
  r = await cli(['gate', '--dir', GOOD, '--target', 'local'], {});
  check('gate --target local exits 2 with the build-target message', r.exit === 2 && r.stdout === TARGET_MSG.replace('audit takes', 'gate takes'), r.all);
  r = await cli(['audit', '--dir', GOOD, '--target', 'Production'], {});
  check('audit --target Production (a value that is not exactly preview or production) exits 2 from the CLI, before the engine', r.exit === 2 && r.stdout === TARGET_MSG, r.all);
  r = await cli(['gate', '--dir', GOOD, '--only', 'MET-003', ...TP], {});
  check('gate --only exits 2 (a gate with fewer rules is a weaker gate)', r.exit === 2 && r.stdout.includes('gate takes no --only'), r.all);
  r = await cli(['gate', '--dir', BAD, '--expect', 'AUDIT-FAILED', ...TP], {});
  check('gate --expect exits 2: a verdict cannot be told to match a failure', r.exit === 2 && r.stdout.includes('gate takes no --expect'), r.all);
  r = await cli(['audit', '--dir', BAD, '--expect', 'AUDIT-FAILED', ...TP], {});
  check('audit --expect exits 2 as well', r.exit === 2 && r.stdout.includes('audit takes no --expect'), r.all);
  r = await cli(['audit', '--dir', GOOD, '--only', 'NOPE-999'], {});
  check('audit --only NOPE-999 exits 2: the engine\'s refusal passes through as usage with its message', r.exit === 2 && r.stdout.startsWith('ERROR ') && r.stdout.includes('NOPE-999') && !r.stdout.includes('crashed'), r.all);
  r = await cli(['audit', '--dir', GOOD, '--only', 'NOPE-999', '--json'], {});
  check('audit --only NOPE-999 --json: code USAGE, not AUDIT-CRASH', r.exit === 2 && r.json.code === 'USAGE', r.all);
  r = await cli(['audit', '--dir', GOOD, '--only', ','], {});
  check('audit --only with no id exits 2 from the CLI\'s own guard (not only the engine\'s: the engine refuses an empty list since 2026-10-31, so the message is what tells them apart)', r.exit === 2 && r.stdout.includes('--only needs at least one rule id'), r.all);
  r = await cli(['audit', '--dir', GOOD, 'extra', ...TP], {});
  check('audit with a stray argument exits 2, naming it', r.exit === 2 && r.stdout.includes("unexpected argument 'extra'"), r.all);
  const boom = { audit() { throw new Error('boom inside the engine'); } };
  r = await cli(['audit', '--dir', GOOD], {}, { auditLib: boom });
  check('audit: a crash inside the library exits 2 and prints one line ERROR audit crashed: <message>', r.exit === 2 && r.stdout === 'ERROR audit crashed: boom inside the engine\n', r.all);
  r = await cli(['gate', '--dir', GOOD], {}, { auditLib: boom });
  check('gate: a crash inside the library exits 2 (never 0, never 1) and prints ERROR audit crashed:', r.exit === 2 && r.stdout.startsWith('ERROR audit crashed: boom'), r.all);
  r = await cli(['gate', '--dir', GOOD, '--json'], {}, { auditLib: boom });
  check('gate --json: a crash is code AUDIT-CRASH, exit 2, with the error text', r.exit === 2 && r.json && r.json.code === 'AUDIT-CRASH' && r.json.error === 'audit crashed: boom inside the engine', r.all);
  const throwingGetter = { get pass() { throw new Error('getter exploded'); }, lines: [], pages: [], rules: [] };
  for (const [name, bogus] of [['nothing', {}], ['an object with no lines', { pass: true }], ['pass with FAIL lines', { pass: true, lines: ['FAIL X /a:1 y (source: z)'], pages: [], rules: [] }], ['a result that throws when read', throwingGetter]]) {
    for (const command of ['gate', 'audit']) {
      r = await cli([command, '--dir', GOOD], {}, { auditLib: { audit: () => bogus } });
      check(command + ': a library that returns ' + name + ' is a crash (exit 2), never a pass', r.exit === 2 && r.stdout.startsWith('ERROR audit crashed:'), r.all);
    }
  }
  r = await cli(['gate', '--dir', GOOD], {}, { auditLib: { audit: () => ({ pass: false, lines: ['WARN X /a:1 y (source: z)'], pages: ['/'], rules: [{ id: 'X' }] }) } });
  check('gate: a library that says pass false is a failed gate even with no FAIL line (exit 1, GATE FAIL)', r.exit === 1 && r.stdout.startsWith('GATE FAIL 0 finding(s)'), r.all);
  r = await cli(['audit', '--dir', GOOD, '--json', ...TP], {});
  check('audit --json: one JSON object whose data has the engine\'s lines, pages, rules, pass and exit', r.exit === 0 && r.json && r.json.command === 'audit' && r.json.target === undefined && JSON.stringify(r.json.data.lines) === JSON.stringify(engineGood.lines) && r.json.data.exit === 0 && r.json.data.pass === true && r.json.data.pages.length === NP && r.json.data.rules.length === NR, r.all.slice(0, 200));
  r = await cli(['audit', '--dir', BAD, '--json', ...TP], {});
  check('audit --json on the bad site: exit 1, code AUDIT-FAILED, data.exit 1, data.lines equals the engine\'s', r.exit === 1 && r.json.code === 'AUDIT-FAILED' && r.json.data.exit === 1 && r.json.data.pass === false && JSON.stringify(r.json.data.lines) === JSON.stringify(engineBad.lines), r.all.slice(0, 200));
  r = await cli(['gate', '--dir', BAD, '--json', ...TP], {});
  check('gate --json: data.pass false, data.exit 1, data.fails is the FAIL line', r.exit === 1 && r.json.data.pass === false && r.json.data.exit === 1 && r.json.data.fails.length === 1 && r.json.data.fails[0] === engineBad.lines.find(l => l.startsWith('FAIL ')), r.all.slice(0, 200));
  r = await cli(['gate', '--dir', GOOD, '--json', ...TP], {});
  check('gate --json on the good site: data.pass true, data.exit 0, data.fails empty', r.exit === 0 && r.json.data.pass === true && r.json.data.exit === 0 && r.json.data.fails.length === 0 && r.json.target === undefined, r.all.slice(0, 200));
  // --target <preview|production> is the BUILD target (the engine's ENV-001), passed through; the lines are the engine's own for that target
  const FIX = name => join(REPO_ROOT, 'tools', 'audit', 'fixtures', name);
  const GOOD_PREVIEW = FIX('good-preview'), BAD_ENV_PREVIEW = FIX('bad-ENV-001-preview'), BAD_ENV_PROD = FIX('bad-ENV-001-production');
  const eProd = engine.audit(GOOD, { target: 'production' }), ePrev = engine.audit(GOOD_PREVIEW, { target: 'preview' });
  const eBadPrev = engine.audit(BAD_ENV_PREVIEW, { target: 'preview' }), eGoodAsPrev = engine.audit(GOOD, { target: 'preview' });
  const envFails = lines => lines.filter(l => l.startsWith('FAIL ENV-001 '));
  r = await cli(['audit', '--dir', GOOD, '--target', 'production'], {});
  check('audit --target production on the good site: exit 0, no SKIP ENV-001 line, the lines are the engine\'s for that target',
    eProd.pass && r.exit === 0 && !out(r).some(l => l.startsWith('SKIP ENV-001')) && JSON.stringify(out(r).slice(0, -1)) === JSON.stringify(eProd.lines) && out(r).at(-1).startsWith(`audit: ${NP} pages, ${NR} rules, 0 FAIL`), r.all.slice(-300));
  r = await cli(['audit', '--dir', GOOD_PREVIEW, '--target', 'preview'], {});
  check('audit --target preview on good-preview: exit 0, no SKIP ENV-001 line, the lines are the engine\'s for that target',
    ePrev.pass && r.exit === 0 && !out(r).some(l => l.startsWith('SKIP ENV-001')) && JSON.stringify(out(r).slice(0, -1)) === JSON.stringify(ePrev.lines), r.all.slice(-300));
  r = await cli(['audit', '--dir', BAD_ENV_PREVIEW, '--target', 'preview'], {});
  check('audit --target preview on bad-ENV-001-preview: exit 1 and the engine\'s FAIL ENV-001 lines, nothing skipped',
    !eBadPrev.pass && envFails(eBadPrev.lines).length > 0 && r.exit === 1 && JSON.stringify(envFails(out(r))) === JSON.stringify(envFails(eBadPrev.lines)) && !out(r).some(l => l.startsWith('SKIP ENV-001')), r.all.slice(-300));
  r = await cli(['audit', '--dir', BAD_ENV_PROD, '--target', 'production'], {});
  check('audit --target production on bad-ENV-001-production: exit 1 and the engine\'s FAIL ENV-001 lines',
    envFails(engine.audit(BAD_ENV_PROD, { target: 'production' }).lines).length > 0 && r.exit === 1 && out(r).some(l => l.startsWith('FAIL ENV-001 ')), r.all.slice(-300));
  r = await cli(['audit', '--dir', GOOD, '--target', 'preview'], {});
  check('audit: the value reaches the engine (the good site is a production build, so --target preview fails ENV-001 where --target production passes)',
    !eGoodAsPrev.pass && r.exit === 1 && JSON.stringify(out(r).slice(0, -1)) === JSON.stringify(eGoodAsPrev.lines) && out(r).some(l => l.startsWith('FAIL ENV-001 ')), r.all.slice(-300));
  r = await cli(['gate', '--dir', GOOD, '--target', 'production'], {});
  check('gate --target production on the good site: exit 0 (no production guard for a folder gate), GATE PASS with the engine\'s counts',
    r.exit === 0 && r.stdout === `GATE PASS ${NP} pages, ${NR} rules\n`, r.all.slice(-200));
  r = await cli(['gate', '--dir', GOOD, '--target', 'preview'], {});
  check('gate --target preview on the good site: exit 1, GATE FAIL with the engine\'s ENV-001 lines (the value reaches the engine)',
    r.exit === 1 && out(r)[0] === `GATE FAIL ${envFails(eGoodAsPrev.lines).length + eGoodAsPrev.lines.filter(l => l.startsWith('FAIL ') && !l.startsWith('FAIL ENV-001 ')).length} finding(s)` && envFails(out(r)).length === envFails(eGoodAsPrev.lines).length, r.all.slice(-300));
  r = await cli(['gate', '--dir', BAD_ENV_PREVIEW, '--target', 'preview', '--json'], {});
  check('gate --target preview --json: data.fails holds the ENV-001 lines and the result shows no environment target', r.exit === 1 && r.json.target === undefined && r.json.data.fails.some(l => l.startsWith('FAIL ENV-001 ')), r.all.slice(0, 300));
  r = await cli(['audit', '--dir', GOOD, '--target', 'production', '--json'], {});
  check('audit --target production --json: the engine\'s data.target is "production" and the result shows no environment target (ctxUsesTarget unchanged)', r.exit === 0 && r.json.data.target === 'production' && r.json.target === undefined, r.all.slice(0, 300));
  r = await cli(['audit', '--dir', GOOD, '--json'], {});
  check('audit with no --target passes nothing to the engine, which refuses a built folder with none: exit 2 USAGE naming --target', r.exit === 2 && r.json && r.json.code === 'USAGE' && /--target/.test(r.json.error) && r.json.data === undefined, r.all.slice(0, 300));
  r = await cli(['gate', '--dir', GOOD], {});
  check('gate with no --target exits 2 as well, nothing judged (a gate that skipped the indexing check is not a gate)', r.exit === 2 && r.stdout.startsWith('ERROR ') && /--target/.test(r.stdout), r.all.slice(0, 300));
  const libOpts = [];
  const spyLib = { audit: (d, o) => { libOpts.push(o); return { pass: true, lines: [], pages: [], rules: [] }; } };
  await cli(['audit', '--dir', GOOD, '--target', 'preview', '--only', 'ENV-001'], {}, { auditLib: spyLib });
  await cli(['gate', '--dir', GOOD, '--target', 'production'], {}, { auditLib: spyLib });
  await cli(['gate', '--dir', GOOD], {}, { auditLib: spyLib });
  check('audit and gate: the options handed to the library are { rules, target } / { target } / {} (no --target passes no key)',
    JSON.stringify(libOpts) === JSON.stringify([{ rules: ['ENV-001'], target: 'preview' }, { target: 'production' }, {}]), JSON.stringify(libOpts));
  const { BUILD_TARGET_COMMANDS, PRODUCTION_ALLOWED } = await import(pathToFileURL(join(CLI_ROOT, 'lib', 'target.mjs')).href);
  check('production guard: the build-target exemption is exactly audit and gate, and PRODUCTION_ALLOWED is still exactly status and apply',
    [...BUILD_TARGET_COMMANDS].sort().join() === 'audit,gate' && [...PRODUCTION_ALLOWED].sort().join() === 'apply,status');
  calls.length = 0;
  r = await cli(['seed', 'test', '--target', 'production'], PROD, spies);
  check('production guard: seed is still refused on production (exit 3) beside the audit and gate exemption', r.exit === 3 && calls.length === 0, r.all.slice(0, 200));
  // rule 1: a secret that the environment holds is masked on every printed line, text mode included
  const SECRET = rand(), leakDir = mkdtempSync(join(tmpdir(), 'omnikom-audit-'));
  try {
    cpSync(GOOD, leakDir, { recursive: true });
    cpSync(join(GOOD, 'about'), join(leakDir, SECRET), { recursive: true });
    const leakEnv = { SOME_SECRET_KEY: SECRET };
    const withPage = engine.audit(leakDir, { target: 'production' });
    check('audit hygiene: the setup puts the secret into the engine\'s own lines (else the test measures nothing)', withPage.lines.some(l => l.includes(SECRET)));
    for (const argv of [['audit', '--dir', leakDir, ...TP], ['gate', '--dir', leakDir, ...TP], ['audit', '--dir', leakDir, '--json', ...TP], ['gate', '--dir', leakDir, '--json', ...TP]]) {
      r = await cli(argv, leakEnv);
      check('audit hygiene: ' + argv.filter(x => x !== '--dir' && x !== leakDir).join(' ') + ' never prints the secret', !r.all.includes(SECRET) && r.stdout.length > 0, r.all.slice(0, 200));
    }
    r = await cli(['audit', '--dir', leakDir, ...TP], leakEnv);
    check('audit hygiene: the masked value is named, not blanked', r.stdout.includes('<redacted:SOME_SECRET_KEY>'), r.all.slice(0, 200));
  } finally { rmSync(leakDir, { recursive: true, force: true }); }

  // ---- key mint: the env file's text (pure functions of commands/key.mjs; the numbering rule itself is proven on the database below)
  const { envHighest, rewriteEnv } = await import(pathToFileURL(join(CLI_ROOT, 'commands', 'key.mjs')).href);
  const REC = (slug, n) => `# site-${slug}-key-${n}: r`;
  check('key mint env: the highest record number of the slug, and not that of a slug that starts the same', envHighest(`${REC('a', 2)}\n${REC('a', 11)}\n${REC('a-b', 40)}\n${REC('ab', 50)}\nX=1\n`, 'a') === 11 && envHighest('X=1\n', 'a') === 0 && envHighest('', 'a') === 0);
  check('key mint env: the record number is read through CRLF too', envHighest(`${REC('a', 3)}\r\n`, 'a') === 3);
  check('key mint env: a file without a trailing line break gets one before the blank line and the new lines', rewriteEnv('A=1', 'a', 'VAR_A', 'REC', 'VAR_A=new') === 'A=1\n\nREC\nVAR_A=new\n');
  check('key mint env: no second blank line when the file already ends with one; an empty file gets no leading blank', rewriteEnv('A=1\n\n', 'a', 'VAR_A', 'REC', 'VAR_A=new') === 'A=1\n\nREC\nVAR_A=new\n' && rewriteEnv('', 'a', 'VAR_A', 'REC', 'VAR_A=new') === 'REC\nVAR_A=new\n');
  check('key mint env: the lines of another slug that starts the same are kept; this slug\'s are replaced in place', rewriteEnv(`T=1\nVAR_AB=keep\n${REC('ab', 1)}\nVAR_A=old\n${REC('a', 1)}\nU=2\n`, 'a', 'VAR_A', 'REC', 'VAR_A=new') === `T=1\nVAR_AB=keep\n${REC('ab', 1)}\nREC\nVAR_A=new\nU=2\n`);
}

// ======================================================================================================== TOOLS AND CI
// tools.json, `tools ensure` (over a fake fetch serving archives built here with the system tar: no network, no real download) and `ci`
// (fixture ci.yml files in temp roots; a fake spawn records what would run). DECISIONS 42.
async function toolsAndCi() {
  const NOW = 1800000000;                        // the clock the tests hand to the CLI (seconds)
  const DAY = 86400;
  const iso = ago => new Date((NOW - ago) * 1000).toISOString();
  const tarExe = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const sha = b => createHash('sha256').update(b).digest('hex');
  const sh16 = h => `${h.slice(0, 16)}...${h.slice(-8)}`;
  const NODEV = process.version.slice(1);
  const work = mkdtempSync(join(tmpdir(), 'omnikom-tools-'));
  const tree = root => { const out = []; const walk = (d, rel) => { let es = []; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = rel ? `${rel}/${e.name}` : e.name; out.push(p); if (e.isDirectory()) walk(join(d, e.name), p); } }; walk(root, ''); return out.sort(); };
  const fresh = () => join(mkdtempSync(join(work, 'case-')), 'tools');   // a tools folder that does not exist yet
  const archiveOf = (kind, bin, body, inner = 'faketool-1.0.0') => {
    const src = mkdtempSync(join(work, 'src-'));
    mkdirSync(join(src, inner));
    writeFileSync(join(src, inner, bin), body);
    writeFileSync(join(src, inner, 'README.txt'), 'docs\n');
    const out = join(src, kind === 'zip' ? 'a.zip' : 'a.tar.gz');
    const r = spawnSync(tarExe, kind === 'zip' ? ['-a', '-cf', out, '-C', src, inner] : ['-czf', out, '-C', src, inner], { encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0) throw new Error(`could not build the fixture archive: ${r.stderr}`);
    return readFileSync(out);
  };
  const URL1 = 'https://github.com/acme/faketool/releases/download/v1.0.0/faketool-1.0.0.tar.gz';
  const manifestOf = (bytes, over = {}) => {
    const plat = over.plat || 'linux-amd64', bin = over.bin || 'faketool';
    const p = { url: 'url' in over ? over.url : URL1, sha256: 'sha256' in over ? over.sha256 : sha(bytes), size: 'size' in over ? over.size : bytes.length };
    for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
    return { schema: 1, tools: { faketool: { version: '1.0.0', published: 'published' in over ? over.published : iso(30 * DAY), repo: 'acme/faketool', bin: over.noBin ? {} : { [plat]: bin }, platforms: { [plat]: p } }, node: { version: NODEV } } };
  };
  const server = bytes => { const f = async url => { f.calls.push(String(url)); return new Response(bytes, { status: 200 }); }; f.calls = []; return f; };
  const ens = (manifest, fetchFn, dir, extra = [], deps = {}, env = {}) => cli(['tools', 'ensure', '--json', ...extra], { OMNIKOM_TOOLS_DIR: dir, ...env }, { fetch: fetchFn, now: () => NOW, manifest, platform: 'linux-amd64', ...deps });
  const body = Buffer.from('#!/bin/sh\necho a fake tool\n');
  try {
    // ---- the manifest and ci.yml agree (independent of the CLI's own reader: plain regular expressions over the two files)
    const ciReal = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    const manReal = JSON.parse(readFileSync(join(CLI_ROOT, 'tools.json'), 'utf8'));
    const agree = (ciText, man) => {
      const bad = [];
      const urls = [...ciText.matchAll(/https:\/\/github\.com\/([^\s"/]+)\/([^\s"/]+)\/releases\/download\/v([0-9.]+)\/[^\s"]+/g)];
      const shas = [...ciText.matchAll(/echo "([0-9a-f]{64})  /g)].map(m => m[1]);
      if (urls.length !== 4 || shas.length !== 4) bad.push(`ci.yml has ${urls.length} download urls and ${shas.length} sha256 lines (expected 4 and 4)`);
      urls.forEach((m, i) => {
        const name = m[2].toLowerCase(), e = man.tools[name], linux = e && e.platforms && e.platforms['linux-amd64'];
        if (!e) { bad.push(`${name}: not in tools.json`); return; }
        if (m[3] !== e.version) bad.push(`${name}: version ${m[3]} in ci.yml, ${e.version} in tools.json`);
        if (!linux || m[0] !== linux.url) bad.push(`${name}: linux url differs`);
        if (!linux || shas[i] !== linux.sha256) bad.push(`${name}: linux sha256 differs`);
        if (e.repo !== `${m[1]}/${m[2]}`) bad.push(`${name}: repo differs`);
      });
      for (const [key, tool] of [['node-version', 'node'], ['deno-version', 'deno']]) {
        const vals = new Set([...ciText.matchAll(new RegExp(`${key}: ([0-9.]+)`, 'g'))].map(m => m[1]));
        if (vals.size !== 1 || ![...vals][0] || [...vals][0] !== man.tools[tool].version) bad.push(`${tool}: ci.yml says ${[...vals].join('/')}, tools.json says ${man.tools[tool].version}`);
      }
      return bad;
    };
    const diffs = agree(ciReal, manReal);
    check('tools.json and ci.yml agree: actionlint, gitleaks, osv-scanner and shellcheck (version, linux url, sha256), node-version and deno-version', diffs.length === 0, diffs.join('; '));
    const firstSha = /echo "([0-9a-f]{64})  /.exec(ciReal)[1];
    const flipped = agree(ciReal.replace(firstSha, firstSha.replace(/^./, c => (c === '0' ? '1' : '0'))), manReal);
    check('tools.json and ci.yml agree: watched red, one changed hash in a copy of ci.yml is named (tool and "sha256")', flipped.length === 1 && /sha256 differs/.test(flipped[0]) && /^(actionlint|gitleaks|osv-scanner|shellcheck|deno):/.test(flipped[0]), flipped.join('; '));
    check('tools.json and ci.yml agree: watched red, another node-version in a copy is named', agree(ciReal.replace('node-version: 24', 'node-version: 23'), manReal).some(m => m.startsWith('node:')));
    // the manifest's own rules (the head's design): every download has an official github.com release url, a sha256 and a size; node is checked only
    const rules = [];
    for (const [name, e] of Object.entries(manReal.tools)) {
      if (!e.platforms) { if (name !== 'node' || Object.keys(e).join() !== 'version') rules.push(`${name}: only node may be a bare version`); continue; }
      for (const [plat, p] of Object.entries(e.platforms)) {
        if (!['windows-amd64', 'linux-amd64'].includes(plat)) rules.push(`${name}: platform ${plat}`);
        if (!p.url.startsWith(`https://github.com/${e.repo}/releases/download/v${e.version}/`)) rules.push(`${name} ${plat}: url`);
        if (!/^[0-9a-f]{64}$/.test(p.sha256) || !(p.size > 0) || !e.bin[plat]) rules.push(`${name} ${plat}: sha256, size or bin`);
      }
      if (!Number.isFinite(Date.parse(e.published))) rules.push(`${name}: published`);
    }
    check('tools.json: every download is an official github.com release asset with a sha256, a size, an executable name and a published date; node is a bare version', rules.length === 0 && ['actionlint', 'gitleaks', 'deno', 'shellcheck', 'osv-scanner', 'node'].every(n => manReal.tools[n]), rules.join('; '));

    // ---- tools ensure over a fake fetch
    const tgz = archiveOf('tgz', 'faketool', body);
    const man = manifestOf(tgz);
    let dir = fresh();
    const f1 = server(tgz);
    let r = await ens(man, f1, dir);
    let t0 = r.json && r.json.data.tools[0];
    check('tools ensure: a fixture release is fetched once (the manifest url), extracted with the system tar, and the executable is in bin/',
      r.exit === 0 && t0 && t0.status === 'downloaded' && f1.calls.length === 1 && f1.calls[0] === URL1 && existsSync(join(dir, 'bin', 'faketool')) && readFileSync(join(dir, 'bin', 'faketool')).equals(body), r.all.slice(0, 300));
    let ok = {};
    try { ok = JSON.parse(readFileSync(join(dir, 'faketool-1.0.0', '.ok'), 'utf8')); } catch { ok = {}; }
    const left = tree(dir);
    check('tools ensure: .ok holds the version and the archive sha256; no archive and no temp folder are left', ok.version === '1.0.0' && ok.sha256 === sha(tgz) && left.every(p => !p.includes('.tmp-') && !p.endsWith('/archive')) && left.includes('bin/faketool') && left.includes('faketool-1.0.0/faketool-1.0.0/faketool'), left.join(' '));
    const spyDir = fresh(), tarCalls = [];
    const spyTar = (cmd, args, opts) => { tarCalls.push({ cmd, args }); return spawnSync(cmd, args, opts); };   // no-timeout: opts is the CLI's own, with its timeout
    r = await ens(man, server(tgz), spyDir, [], { spawn: spyTar });
    check('tools ensure: the archive is read by the system tar (%SystemRoot%\\System32\\tar.exe on Windows, tar on linux) with -xf, into a folder inside the tools folder; nothing else is spawned',
      r.exit === 0 && tarCalls.length === 1 && tarCalls[0].cmd === tarExe && tarCalls[0].args[0] === '-xf' && resolve(tarCalls[0].args[1]).startsWith(resolve(spyDir) + sep) && resolve(tarCalls[0].args[3]).startsWith(resolve(spyDir) + sep), r.all.slice(0, 300) + JSON.stringify(tarCalls));
    {
      // both branches on any OS (run 41267322498: on linux the "tar from PATH" mutant gave 'tar' either way and survived)
      const { tarPath } = await lib('tools.mjs');
      const win = tarPath({ env: { SystemRoot: 'C:\\Win' } }, 'win32'), lin = tarPath({ env: { SystemRoot: 'C:\\Win' } }, 'linux');
      check('tools ensure: the system tar is %SystemRoot%\\System32\\tar.exe on win32 and tar on linux, whatever OS runs the test',
        win.startsWith('C:\\Win') && /System32[\\/]tar\.exe$/.test(win) && lin === 'tar', JSON.stringify({ win, lin }));
    }
    r = await ens(man, f1, dir);
    check('tools ensure: a second run is present and fetches nothing', r.exit === 0 && r.json.data.tools[0].status === 'present' && f1.calls.length === 1, r.all.slice(0, 200));
    writeFileSync(join(dir, 'faketool-1.0.0', '.ok'), JSON.stringify({ ...ok, version: '0.0.1' }));
    r = await ens(man, f1, dir);
    check('tools ensure: an .ok of another version is not a skip (fetched again)', r.exit === 0 && r.json.data.tools[0].status === 'downloaded' && f1.calls.length === 2, r.all.slice(0, 200));
    writeFileSync(join(dir, 'bin', 'faketool'), 'not the file that was extracted');
    r = await ens(man, f1, dir);
    check('tools ensure: an executable that is not the extracted file is replaced (fetched again)', r.exit === 0 && r.json.data.tools[0].status === 'downloaded' && f1.calls.length === 3 && readFileSync(join(dir, 'bin', 'faketool')).equals(body), r.all.slice(0, 200));

    dir = fresh();
    const other = Buffer.from(tgz); other[other.length - 1] ^= 1;   // the same size, other content
    r = await ens(man, server(other), dir);
    t0 = r.json && r.json.data.tools[0];
    check('tools ensure: a wrong sha256 deletes the download and exits 1 naming the tool, the expected and the actual hash',
      r.exit === 1 && r.json.code === 'TOOLS-REFUSED' && t0.tool === 'faketool' && t0.reason.includes(`expected ${sh16(sha(tgz))}`) && t0.reason.includes(`got ${sh16(sha(other))}`) && tree(dir).length === 0, `${r.all.slice(0, 300)} ${tree(dir).join(' ')}`);
    dir = fresh();
    r = await ens(manifestOf(tgz, { size: tgz.length + 1 }), server(tgz), dir);
    check('tools ensure: a wrong size is refused and nothing is kept', r.exit === 1 && /size \d+ bytes, expected \d+/.test(r.json.data.tools[0].reason) && tree(dir).length === 0, r.all.slice(0, 300));

    const offsite = [
      ['a host that is not github.com', 'https://evil.example/acme/faketool/releases/download/v1.0.0/x.tar.gz'],
      ['another repository', 'https://github.com/other/repo/releases/download/v1.0.0/x.tar.gz'],
      ['plain http', 'http://github.com/acme/faketool/releases/download/v1.0.0/x.tar.gz'],
      ['dot segments out of the release folder', 'https://github.com/acme/faketool/releases/download/v1.0.0/../../../../evil/x.tar.gz'],
      ['another tag', 'https://github.com/acme/faketool/releases/download/v9.9.9/x.tar.gz'],
      ['the source archive of a tag', 'https://github.com/acme/faketool/archive/refs/tags/v1.0.0.tar.gz'],
      ['a query string', `${URL1}?token=x`],
      ['a dot segment that the url parser would remove (the string is not the url that is fetched)', 'https://github.com/acme/faketool/releases/download/v1.0.0/./faketool-1.0.0.tar.gz'],
    ];
    let bad = '';
    for (const [why, url] of offsite) {
      dir = fresh();
      const f = server(tgz);
      r = await ens(manifestOf(tgz, { url }), f, dir);
      if (r.exit !== 1 || f.calls.length !== 0 || existsSync(dir) || !/not an asset of https:\/\/github\.com\/acme\/faketool\/releases\/download\/v1\.0\.0\//.test(r.json.data.tools[0].reason)) bad += ` [${why}: exit ${r.exit}, ${f.calls.length} fetches, folder ${existsSync(dir)}]`;
    }
    check('tools ensure: a url off github.com/<repo>/releases/download/<tag>/ is refused before any fetch and before any byte is written', bad === '', bad);

    dir = fresh();
    let f = server(tgz);
    r = await ens(manifestOf(tgz, { published: iso(6 * DAY) }), f, dir);
    check('tools ensure: a release 6 days old is refused (supply-chain rule 1) before any fetch, nothing written', r.exit === 1 && /released 6\.0 days ago/.test(r.json.data.tools[0].reason) && f.calls.length === 0 && !existsSync(dir), r.all.slice(0, 300));
    r = await ens(manifestOf(tgz, { published: iso(7 * DAY) }), f, dir);
    check('tools ensure: a release exactly 7 days old is allowed', r.exit === 0 && r.json.data.tools[0].status === 'downloaded', r.all.slice(0, 300));
    bad = '';
    for (const [why, over, re] of [['no sha256', { sha256: undefined }, /no sha256/], ['no size', { size: undefined }, /no size/], ['no published date', { published: undefined }, /published/], ['no executable name', { noBin: true }, /no executable/], ['another platform only', { plat: 'windows-amd64', bin: 'faketool.exe' }, /no build of faketool for linux-amd64/]]) {
      dir = fresh(); f = server(tgz);
      r = await ens(manifestOf(tgz, over), f, dir);
      if (r.exit !== 1 || f.calls.length !== 0 || existsSync(dir) || !re.test(r.json.data.tools[0].reason)) bad += ` [${why}: exit ${r.exit}, ${f.calls.length} fetches, ${(r.json && r.json.data.tools[0].reason) || r.all.slice(0, 80)}]`;
    }
    check('tools ensure: a missing sha256, size, published date or executable name, and a platform with no build, are refused before any fetch', bad === '', bad);
    r = await ens(man, f, fresh(), ['--only', 'nosuchtool']);
    check('tools ensure: an unknown tool name is a usage error (exit 2)', r.exit === 2 && r.json.error.includes('nosuchtool'), r.all.slice(0, 200));
    r = await cli(['tools', 'ensure', '--target', 'staging'], {}, { manifest: man });
    check('tools: --target is a usage error (exit 2); production is refused (exit 3) before anything runs', r.exit === 2 && (await cli(['tools', 'list', '--target', 'production'], {}, { manifest: man })).exit === 3, r.all.slice(0, 200));

    // ---- a failed download names its cause and is tried once more (head of operations 2026-10-31 19:10: "fetch failed" alone could not be diagnosed)
    {
      const failing = n => { const f = async url => { f.calls.push(String(url)); if (f.calls.length <= n) throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNRESET 1.2.3.4:443'), { code: 'ECONNRESET' }) }); return new Response(tgz, { status: 200 }); }; f.calls = []; return f; };
      let f = failing(1), d = fresh();
      r = await ens(man, f, d, [], {}, { OMNIKOM_RETRY_MS: '0' });
      check('tools ensure: a download that fails once is tried once more and then installed', r.exit === 0 && f.calls.length === 2 && r.json.data.tools[0].status === 'downloaded', r.all.slice(0, 300));
      f = failing(9); d = fresh();
      r = await ens(man, f, d, [], {}, { OMNIKOM_RETRY_MS: '0' });
      const why = (r.json && r.json.data.tools[0].reason) || '';
      check('tools ensure: a download that keeps failing is refused after exactly 2 attempts, naming the cause (code and message)', r.exit === 1 && f.calls.length === 2 && why.includes('fetch failed') && why.includes('ECONNRESET') && why.includes('after 2 attempts') && tree(d).every(p => !p.startsWith('.tmp-')), why || r.all.slice(0, 300));
      const g = async url => { g.calls.push(String(url)); return new Response('no', { status: 404 }); }; g.calls = [];
      r = await ens(man, g, fresh(), [], {}, { OMNIKOM_RETRY_MS: '0' });
      check('tools ensure: an HTTP 404 is not retried', r.exit === 1 && g.calls.length === 1, r.all.slice(0, 200));
    }
    // ---- "present" re-checks the executable against the hash its .ok recorded; a .ok without that hash is not trusted
    {
      const d = fresh();
      r = await ens(man, server(tgz), d);
      const okPath = join(d, 'faketool-1.0.0', '.ok');
      const okRec = JSON.parse(readFileSync(okPath, 'utf8'));
      delete okRec.binSha256;
      writeFileSync(okPath, JSON.stringify(okRec));
      writeFileSync(join(d, 'bin', 'faketool'), 'a planted file\n');
      const s2 = server(tgz);
      r = await ens(man, s2, d);
      check('tools ensure: a .ok without the executable\'s hash is not trusted: a planted bin is replaced by a fresh verified download', r.exit === 0 && s2.calls.length === 1 && r.json.data.tools[0].status === 'downloaded' && readFileSync(join(d, 'bin', 'faketool'), 'utf8') === body.toString(), r.all.slice(0, 300));
    }
    // nothing is written outside the tools folder
    const root = mkdtempSync(join(work, 'root-'));
    mkdirSync(join(root, 'sibling'));
    writeFileSync(join(root, 'sibling', 'keep.txt'), 'x');
    const outside = () => tree(root).filter(p => !p.startsWith('tools')).join('|');
    const repoTools = join(REPO_ROOT, '.tools');
    const repoSnap = () => (existsSync(repoTools) ? tree(repoTools).join('|') : 'absent');
    const b4 = [outside(), repoSnap()];
    r = await ens(man, server(tgz), join(root, 'tools'));
    check('tools ensure: nothing is written outside the tools folder (the fixture root and the repository\'s .tools are as they were)', r.exit === 0 && outside() === b4[0] && repoSnap() === b4[1] && tree(join(root, 'tools')).includes('bin/faketool'), `${outside()} ${repoSnap()}`);

    dir = fresh();
    r = await ens(manifestOf(Buffer.from('this is not an archive')), server(Buffer.from('this is not an archive')), dir);
    check('tools ensure: bytes the system tar cannot read are refused and leave nothing behind (no half-written tool)', r.exit === 1 && /extraction with the system tar failed/.test(r.json.data.tools[0].reason) && tree(dir).length === 0, `${r.all.slice(0, 300)} ${tree(dir).join(' ')}`);
    const noBin = archiveOf('tgz', 'something-else', body);
    dir = fresh();
    r = await ens(manifestOf(noBin), server(noBin), dir);
    check('tools ensure: an archive without the named executable is refused and leaves nothing behind', r.exit === 1 && /holds no file named faketool/.test(r.json.data.tools[0].reason) && tree(dir).length === 0, r.all.slice(0, 300));
    if (process.platform === 'win32') {
      const zip = archiveOf('zip', 'faketool.exe', body);
      dir = fresh();
      r = await ens({ ...manifestOf(zip, { plat: 'windows-amd64', bin: 'faketool.exe', url: 'https://github.com/acme/faketool/releases/download/v1.0.0/faketool-1.0.0.zip' }) }, server(zip), dir, [], { platform: 'windows-amd64' });
      check('tools ensure: a zip (windows-amd64) is extracted by %SystemRoot%\\System32\\tar.exe and bin/faketool.exe holds the file', r.exit === 0 && r.json.data.tools[0].status === 'downloaded' && readFileSync(join(dir, 'bin', 'faketool.exe')).equals(body), r.all.slice(0, 300));
    } else console.log('skip  tools ensure: the zip case (GNU tar on this system cannot read zip; the Windows tar.exe can)');
    // "raw": true (osv-scanner publishes the bare executable): checked against size and sha256, then copied; no tar
    const rawM = manifestOf(body, { url: 'https://github.com/acme/faketool/releases/download/v1.0.0/faketool_linux_amd64' });
    rawM.tools.faketool.raw = true;
    dir = fresh();
    r = await ens(rawM, server(body), dir);
    check('tools ensure: a "raw" tool (the asset is the executable) is installed as bin/faketool with the downloaded bytes', r.exit === 0 && r.json.data.tools[0].status === 'downloaded' && readFileSync(join(dir, 'bin', 'faketool')).equals(body), r.all.slice(0, 300));
    r = await ens(rawM, server(body), dir);
    check('tools ensure: a raw tool already installed is "present" and nothing is fetched again', r.exit === 0 && r.json.data.tools[0].status === 'present', r.all.slice(0, 300));
    dir = fresh();
    r = await ens({ ...rawM, tools: { ...rawM.tools, faketool: { ...rawM.tools.faketool, platforms: { 'linux-amd64': { ...rawM.tools.faketool.platforms['linux-amd64'], sha256: sha(Buffer.from('other')) } } } } }, server(body), dir);
    check('tools ensure: a raw tool whose bytes do not match the sha256 is refused and leaves nothing behind', r.exit === 1 && /sha256 mismatch/.test(r.json.data.tools[0].reason) && tree(dir).length === 0, r.all.slice(0, 300));
    r = await ens(man, server(tgz), fresh(), ['--only', 'node']);
    check('tools ensure --only node: present when the running node is the manifest\'s; refused (never downloaded) when it is not',
      r.exit === 0 && r.json.data.tools[0].status === 'present' && (await ens({ ...man, tools: { ...man.tools, node: { version: '1.1.1' } } }, server(tgz), fresh(), ['--only', 'node'])).json.data.tools[0].status === 'refused');

    // tools list: read-only
    dir = fresh();
    r = await cli(['tools', 'list', '--json'], { OMNIKOM_TOOLS_DIR: dir }, { manifest: man, now: () => NOW, platform: 'linux-amd64' });
    check('tools list: the manifest rows, nothing installed, no target in the result, and it creates nothing', r.exit === 0 && r.json.target === undefined && r.json.data.tools.find(t => t.tool === 'faketool').installed === 'missing' && r.json.data.tools.find(t => t.tool === 'faketool').sha256 === sh16(sha(tgz)) && !existsSync(dir), r.all.slice(0, 300));
    await ens(man, server(tgz), dir);
    mkdirSync(join(dir, 'stray'));
    const listed = tree(dir).join('|');
    r = await cli(['tools', 'list', '--json'], { OMNIKOM_TOOLS_DIR: dir }, { manifest: man, now: () => NOW, platform: 'linux-amd64' });
    check('tools list: shows an installed tool and a folder that is not in the manifest; the folder is unchanged', r.json.data.tools.find(t => t.tool === 'faketool').installed === 'present' && r.json.data.unknownFolders.join() === 'stray' && r.json.data.bin.join() === 'faketool' && tree(dir).join('|') === listed, r.all.slice(0, 300));
    const SEC = rand();
    const boom = async () => { throw new Error(`connection reset, key ${SEC}`); };
    r = await ens(man, boom, fresh(), [], {}, { SOME_SECRET_KEY: SEC });
    check('tools ensure: a failing download is refused (exit 1) and the secret its error quotes is masked in the output', r.exit === 1 && /download failed/.test(r.all) && !r.all.includes(SEC) && r.all.includes('<redacted:SOME_SECRET_KEY>'), r.all.slice(0, 300));

    // ---- ci: a fixture ci.yml in a temp root; what would run is real (node scripts) or recorded (the tools)
    const CHECKOUT = '      - name: Check out the repository\n        uses: actions/checkout@aaaa # v1\n        with:\n          persist-credentials: false\n';
    const SETUP_NODE = (v = NODEV) => `      - name: Set up Node\n        uses: actions/setup-node@bbbb # v1\n        with:\n          node-version: ${v}\n`;
    const RUN = (name, cmd, extra = '') => `      - name: ${name}\n        run: ${cmd}\n${extra}`;
    const JOB = (id, steps, mins = 5, more = '') => `  ${id}:\n    name: ${id} job\n    runs-on: ubuntu-latest\n    timeout-minutes: ${mins}\n${more}    steps:\n${steps}`;
    const YML = jobs => `# fixture\nname: fixture\n\non: [push]\n\npermissions:\n  contents: read\n\njobs:\n${jobs}`;
    const mkRoot = (yml, files = {}) => {
      const rt = mkdtempSync(join(work, 'ci-'));
      const all = { '.github/workflows/ci.yml': yml, 'jobs/ok.mjs': "console.log('first line'); console.log('ok line');\n", 'jobs/bad.mjs': "console.log('before the failure'); console.error('boom last line'); process.exit(1);\n",
        'jobs/path.mjs': "import { delimiter } from 'node:path'; const k = Object.keys(process.env).find(x => x.toLowerCase() === 'path'); console.log('PATHFIRST=' + process.env[k].split(delimiter)[0]);\n",
        'jobs/secret.mjs': "console.log('value is ' + process.env.SOME_SECRET_KEY);\n", ...files };
      for (const [p, c] of Object.entries(all)) { mkdirSync(dirname(join(rt, p)), { recursive: true }); writeFileSync(join(rt, p), c); }
      return rt;
    };
    // fake tools: archives, a manifest, a fetch that serves them
    const toolMan = {}, toolBytes = {};
    for (const [name, ver] of [['actionlint', '1.2.3'], ['shellcheck', '1.0.0'], ['gitleaks', '4.5.6'], ['deno', '1.2.3']]) {
      const b = archiveOf('tgz', name, Buffer.from(`fake ${name}\n`), `${name}-${ver}`);
      toolBytes[name] = b;
      toolMan[name] = { version: ver, published: iso(40 * DAY), repo: `acme/${name}`, bin: { 'linux-amd64': name }, platforms: { 'linux-amd64': { url: `https://github.com/acme/${name}/releases/download/v${ver}/${name}-${ver}.tar.gz`, sha256: sha(b), size: b.length } } };
    }
    toolMan.node = { version: NODEV };
    const ciMan = { schema: 1, tools: toolMan };
    const routeFetch = () => { const fn = async url => { fn.calls.push(String(url)); const t = Object.keys(toolMan).find(n => toolMan[n].platforms && toolMan[n].platforms['linux-amd64'].url === String(url)); return t ? new Response(toolBytes[t], { status: 200 }) : new Response('no', { status: 404 }); }; fn.calls = []; return fn; };
    const DL = tool => { const e = toolMan[tool], p = e.platforms['linux-amd64']; return `      - name: Download ${tool} ${e.version} and check its sha256\n        run: |\n          curl -fsSL -o "$RUNNER_TEMP/${tool}.tar.gz" ${p.url}\n          echo "${p.sha256}  $RUNNER_TEMP/${tool}.tar.gz" | sha256sum --check -\n          mkdir "$RUNNER_TEMP/${tool}"\n`; };
    const LINT = (flags = '-color') => `      - name: Lint every workflow (with the pinned shellcheck)\n        run: '"$RUNNER_TEMP/actionlint/actionlint" ${flags} .github/workflows/*.yml'\n`;
    const SCAN = '      - name: Scan the history and the tree\n        run: \'"$RUNNER_TEMP/gitleaks/gitleaks" detect --source . --redact --no-banner\'\n';
    const DEFAULT_TOOL = {
      shellcheck: () => ({ status: 0, stdout: 'ShellCheck - shell script analysis tool\nversion: 1.0.0\nlicense: GNU General Public License, version 3\n', stderr: '' }),
      deno: () => ({ status: 0, stdout: 'deno 1.2.3 (stable, release, x86_64)\nv8 12.0\n', stderr: '' }),
    };
    // a spawn that records every call; tools in the tools folder are scripted (default: exit 0), npm is never run, anything else really runs
    const recorder = (toolsDir, script = {}, real = true) => {
      const log = [];
      const fn = (cmd, args, opts) => {
        log.push({ cmd: String(cmd), args: [...args], opts });
        const name = basename(String(cmd)).replace(/\.exe$/, '');
        const inBin = resolve(String(cmd)).toLowerCase().startsWith(resolve(toolsDir, 'bin').toLowerCase());
        if (inBin) return (script[name] || DEFAULT_TOOL[name] || (() => ({ status: 0, stdout: '', stderr: '' })))(args, opts);
        if (name === 'initdb') return script.initdb ? script.initdb(args, opts) : { status: 0, stdout: 'initdb (PostgreSQL) 16.4\n', stderr: '' };
        if (String(args[0] || '').endsWith('npm-cli.js')) return script.npm ? script.npm(args, opts) : { status: 0, stdout: 'added 1 package\n', stderr: '' };
        if (real) return spawnSync(cmd, args, opts);   // no-timeout: opts is the CLI's own, with its timeout
        return { status: 0, stdout: 'fake ok\n', stderr: '' };
      };
      fn.log = log;
      return fn;
    };
    const ciRun = (rt, extra = [], o = {}) => cli(['ci', '--root', rt, ...extra], { OMNIKOM_TOOLS_DIR: o.dir || fresh(), ...(o.env || {}) }, { manifest: o.manifest || ciMan, platform: 'linux-amd64', ...(o.deps || {}) });
    const lines = x => x.stdout.split('\n').filter(Boolean);

    let rt = mkRoot(YML(JOB('good', CHECKOUT + SETUP_NODE() + RUN('CLI unit tests', 'node jobs/ok.mjs'))
      + JOB('bad', CHECKOUT + RUN('Factory tests', 'node jobs/bad.mjs') + RUN('Factory mutants', 'node jobs/ok.mjs') + RUN('Free disk after the gates', 'df -h /tmp', '        if: always()\n'))
      + JOB('unmapped', CHECKOUT + RUN('Brand new check', 'node jobs/ok.mjs'))));
    r = await ciRun(rt);
    check('ci: one line per job (PASS with the last line of its output; FAIL with the failing command\'s last line), then the count; exit 1',
      r.exit === 1 && lines(r).join('|') === 'PASS good  ok line|FAIL bad  boom last line|FAIL unmapped  step not mapped: Brand new check|ci: 3 jobs, 1 PASS, 2 FAIL', r.all.slice(0, 400));
    r = await ciRun(rt, ['--json']);
    const badJob = r.json && r.json.data.jobs.find(j => j.id === 'bad');
    check('ci --json: a step after the failing one is SKIP, a step with if: always() still runs, the mapped checkout says "working tree"',
      badJob && badJob.steps.map(s => s.status).join() === 'PASS,FAIL,SKIP,PASS' && /disk free/.test(badJob.steps[3].lines[0]) && /working tree/.test(badJob.steps[0].lines[0]) && r.json.code === 'CI-FAILED' && r.json.target === undefined, r.all.slice(0, 400));
    r = await ciRun(rt, ['--job', 'good']);
    check('ci --job: runs the one job only', r.exit === 0 && lines(r).join('|') === 'PASS good  ok line|ci: 1 jobs, 1 PASS, 0 FAIL', r.all.slice(0, 300));
    r = await ciRun(rt, ['--job', 'nope']);
    check('ci --job <unknown>: exit 2, naming the jobs there are', r.exit === 2 && r.stdout.startsWith('ERROR ') && r.stdout.includes('good, bad, unmapped'), r.all.slice(0, 300));
    r = await ciRun(rt, ['--job', 'unmapped']);
    check('ci: a ci.yml step the table does not map makes its job FAIL with "step not mapped: <name>" (exit 1)', r.exit === 1 && lines(r)[0] === 'FAIL unmapped  step not mapped: Brand new check', r.all.slice(0, 300));
    rt = mkRoot(YML(JOB('only', CHECKOUT + SETUP_NODE() + RUN('CLI unit tests', 'node jobs/ok.mjs'))));
    r = await ciRun(rt);
    check('ci: every job PASS is exit 0', r.exit === 0 && lines(r).at(-1) === 'ci: 1 jobs, 1 PASS, 0 FAIL', r.all.slice(0, 300));
    r = await ciRun(rt, ['--json']);
    check('ci --json: the node version step reports ci.yml\'s, the manifest\'s and the running node', r.json.data.jobs[0].steps[1].lines[0] === `node ${NODEV} (ci.yml ${NODEV}, tools.json ${NODEV})`, r.all.slice(0, 300));
    rt = mkRoot(YML(JOB('dash', CHECKOUT + SETUP_NODE() + RUN('Dashboard tests', 'node jobs/ok.mjs'))));
    r = await ciRun(rt);
    check('ci: the dashboard job\'s "Dashboard tests" step is mapped and runs with node (PASS)', r.exit === 0 && lines(r).join('|') === 'PASS dash  ok line|ci: 1 jobs, 1 PASS, 0 FAIL', r.all.slice(0, 300));
    rt = mkRoot(YML(JOB('wrongnode', CHECKOUT + SETUP_NODE('1.2.3'))));
    r = await ciRun(rt);
    check('ci: a node-version in ci.yml that is not the manifest\'s (and not the running node) is a FAIL that names all three', r.exit === 1 && lines(r)[0].startsWith(`FAIL wrongnode  node ${NODEV} is running, ci.yml wants 1.2.3, tools.json says ${NODEV}`), r.all.slice(0, 300));

    // the child's PATH carries .tools/bin first; the parent's PATH and the caller's environment do not change
    rt = mkRoot(YML(JOB('p', RUN('CLI unit tests', 'node jobs/path.mjs'))));
    const toolsHere = fresh();
    const parentPath = process.env.PATH;
    r = await ciRun(rt, [], { dir: toolsHere });
    const shown = (lines(r)[0] || '').replace(/^PASS p  PATHFIRST=/, '');
    check('ci: the child process\'s PATH starts with <tools>/bin; the parent\'s PATH is untouched', r.exit === 0 && resolve(shown).toLowerCase() === resolve(toolsHere, 'bin').toLowerCase() && process.env.PATH === parentPath && !String(process.env.PATH).toLowerCase().includes(resolve(toolsHere, 'bin').toLowerCase()), `${r.all.slice(0, 300)}`);
    const spy = recorder(toolsHere);
    await ciRun(rt, [], { dir: toolsHere, deps: { spawn: spy } });
    const first = (spy.log.find(c => c.args.includes('jobs/path.mjs')) || { opts: { env: {} } }).opts.env;
    const pk = Object.keys(first).find(k => k.toLowerCase() === 'path');
    check('ci: the child PATH is .tools/bin + the caller\'s PATH, and the caller\'s environment object is not changed', pk && first[pk] === resolve(toolsHere, 'bin') + delimiter + process.env.PATH);

    // redaction: a secret in the environment that a step prints
    const SEC2 = rand();
    rt = mkRoot(YML(JOB('s', RUN('CLI unit tests', 'node jobs/secret.mjs'))));
    r = await ciRun(rt, [], { env: { SOME_SECRET_KEY: SEC2 } });
    const rj = await ciRun(rt, ['--json'], { env: { SOME_SECRET_KEY: SEC2 } });
    check('ci hygiene: a secret that a step prints is masked in the text lines and in --json', !r.all.includes(SEC2) && r.stdout.includes('<redacted:SOME_SECRET_KEY>') && !rj.all.includes(SEC2) && rj.all.includes('<redacted:SOME_SECRET_KEY>'), r.all.slice(0, 300));

    // usage, and shapes the table does not model
    r = await ciRun(rt, ['--target', 'staging']);
    check('ci: --target, --expect, a stray argument and a root without ci.yml are usage errors (exit 2); production is refused (exit 3)',
      r.exit === 2 && (await ciRun(rt, ['--expect', '202'])).exit === 2 && (await cli(['ci', 'extra', '--root', rt], {}, { manifest: ciMan })).exit === 2 && (await ciRun(join(work, 'no-such-root'))).exit === 2 && (await ciRun(rt, ['--target', 'production'])).exit === 3, r.all.slice(0, 200));
    rt = mkRoot(YML(JOB('e', CHECKOUT + RUN('CLI unit tests', 'node jobs/ok.mjs', '        env:\n          X: y\n')) + JOB('i', CHECKOUT + RUN('CLI unit tests', 'node jobs/ok.mjs', '        if: success()\n')) + JOB('n', CHECKOUT + RUN('CLI unit tests', 'node jobs/ok.mjs'), 5, '    needs: e\n')
      + JOB('x', CHECKOUT + RUN('CLI unit tests', 'node jobs/ok.mjs && node jobs/ok.mjs'))));
    r = await ciRun(rt);
    check('ci: a step key, an if:, a job key or a shell construct the runner does not model FAILs the job instead of being skipped',
      lines(r).slice(0, 4).every(l => l.startsWith('FAIL ')) && /uses env, which omnikom ci does not model/.test(lines(r)[0]) && /has if: success\(\)/.test(lines(r)[1]) && /job keys not modelled: needs/.test(lines(r)[2]) && /shell syntax/.test(lines(r)[3]), r.all.slice(0, 600));
    rt = mkRoot('name: x\nenv:\n  A: b\njobs:\n  a:\n    steps:\n      - name: x\n');
    r = await ciRun(rt);
    check('ci: a top-level key that is not modelled (env) is a FAIL of the whole run, not a pass', r.exit === 1 && lines(r)[0].startsWith('FAIL ci.yml  ci.yml top-level keys not modelled: env'), r.all.slice(0, 300));

    // ---- the tools in a ci run (recorded, not executed)
    const files = { '.github/workflows/other.yml': 'name: other\n' };
    const WF = (lint) => YML(JOB('secrets', CHECKOUT + DL('gitleaks') + SCAN, 7) + JOB('workflows', CHECKOUT + DL('actionlint') + DL('shellcheck') + lint, 9));
    rt = mkRoot(WF(LINT()), files);
    const td = fresh();
    const rf = routeFetch();
    let rec = recorder(td);
    r = await ciRun(rt, ['--json'], { dir: td, deps: { fetch: rf, spawn: rec, now: () => NOW } });
    const dlStep = r.json && r.json.data.jobs.find(j => j.id === 'workflows').steps[1];
    check('ci: a download step runs tools ensure for its tool (fetched once from the manifest url, extracted, checked)', r.exit === 0 && /tools ensure actionlint 1\.2\.3: downloaded/.test(dlStep.lines[0]) && rf.calls.length === 3 && rf.calls.includes(toolMan.actionlint.platforms['linux-amd64'].url), r.all.slice(0, 500));
    const binDir = resolve(td, 'bin');
    const al = rec.log.find(c => resolve(c.cmd) === resolve(binDir, 'actionlint'));
    check('ci: actionlint is called from .tools/bin with -shellcheck <.tools/bin/shellcheck> given explicitly, then the flags of ci.yml and the expanded workflow files',
      al && JSON.stringify(al.args) === JSON.stringify(['-shellcheck', resolve(binDir, 'shellcheck'), '-color', '.github/workflows/ci.yml', '.github/workflows/other.yml']) && resolve(al.opts.cwd) === resolve(rt), al && JSON.stringify(al.args));
    const alEnv = al ? al.opts.env : {};
    const alKey = Object.keys(alEnv).find(k => k.toLowerCase() === 'path');
    check('ci: the tool runs with .tools/bin first on its PATH and a timeout of the job\'s timeout-minutes (9 minutes, not less)', alKey && alEnv[alKey].startsWith(binDir + delimiter) && al.opts.timeout > 8.5 * 60000 && al.opts.timeout <= 9 * 60000, al && String(al.opts.timeout));
    r = await ciRun(rt, [], { dir: td, deps: { fetch: rf, spawn: rec, now: () => NOW } });
    check('ci: the PASS line of the lint reports the shellcheck version used; a second run downloads nothing', lines(r).includes('PASS workflows  actionlint: no findings [shellcheck 1.0.0]') && rf.calls.length === 3, `${r.all.slice(0, 300)} fetches ${rf.calls.length}`);
    const gl = rec.log.find(c => resolve(c.cmd) === resolve(binDir, 'gitleaks'));
    check('ci: the gitleaks call keeps its arguments and runs from .tools/bin', gl && JSON.stringify(gl.args) === JSON.stringify(['detect', '--source', '.', '--redact', '--no-banner']), gl && JSON.stringify(gl.args));

    rt = mkRoot(WF(LINT('-color -shellcheck "$RUNNER_TEMP/shellcheck-v1.0.0/shellcheck"')), files);
    rec = recorder(td);
    r = await ciRun(rt, [], { dir: td, deps: { fetch: rf, spawn: rec, now: () => NOW } });
    const al2 = rec.log.find(c => resolve(c.cmd) === resolve(binDir, 'actionlint'));
    check('ci: a -shellcheck "$RUNNER_TEMP/..." in ci.yml becomes the .tools/bin one, given once', al2 && al2.args.filter(a => a === '-shellcheck').length === 1 && al2.args[al2.args.indexOf('-shellcheck') + 1] === resolve(binDir, 'shellcheck') && !al2.args.some(a => a.includes('RUNNER_TEMP')), al2 && JSON.stringify(al2.args));
    rec = recorder(td, { actionlint: () => ({ status: 1, stdout: '.github/workflows/ci.yml:7:9: shellcheck reported issue in this script: SC2086:info:1:6: Double quote to prevent globbing [shellcheck]\n', stderr: '' }) });
    r = await ciRun(rt, [], { dir: td, deps: { fetch: rf, spawn: rec, now: () => NOW } });
    check('ci: actionlint finding -> FAIL naming the finding and the shellcheck version used, exit 1', r.exit === 1 && /^FAIL workflows  .*SC2086.* \[shellcheck 1\.0\.0\]$/.test(lines(r).find(l => l.startsWith('FAIL workflows'))), r.all.slice(0, 400));
    rec = recorder(td, { shellcheck: () => ({ status: 0, stdout: 'ShellCheck - shell script analysis tool\nversion: 9.9.9\n', stderr: '' }) });
    r = await ciRun(rt, [], { dir: td, deps: { fetch: rf, spawn: rec, now: () => NOW } });
    check('ci: a shellcheck in .tools/bin that is not the manifest\'s version is a FAIL (actionlint is not run)', r.exit === 1 && /^FAIL workflows  shellcheck 9\.9\.9 is in \.tools\/bin, tools\.json says 1\.0\.0$/.test(lines(r).find(l => l.startsWith('FAIL workflows'))) && !rec.log.some(c => resolve(c.cmd) === resolve(binDir, 'actionlint')), r.all.slice(0, 400));
    // a download step that disagrees with the manifest, and a tool that is not there
    const stale = YML(JOB('d', CHECKOUT + DL('actionlint').replace(toolMan.actionlint.platforms['linux-amd64'].sha256, '0'.repeat(64)) + DL('gitleaks').replace('gitleaks 4.5.6', 'gitleaks 4.5.7')));
    r = await ciRun(mkRoot(stale), [], { dir: td, deps: { fetch: rf, spawn: recorder(td) } });
    check('ci: a download step whose sha256 or version differs from tools.json is a FAIL (the check that ci.yml and the manifest agree, inside the run)', r.exit === 1 && /^FAIL d  ci\.yml's url or sha256 for actionlint differs from tools\.json$/.test(lines(r)[0]), r.all.slice(0, 300));
    r = await ciRun(mkRoot(YML(JOB('d', CHECKOUT + DL('gitleaks').replace('gitleaks 4.5.6', 'gitleaks 4.5.7')))), [], { dir: td, deps: { fetch: rf, spawn: recorder(td) } });
    check('ci: a download step naming another version than tools.json is a FAIL', /^FAIL d  ci\.yml names gitleaks 4\.5\.7 but tools\.json has 4\.5\.6$/.test(lines(r)[0]), r.all.slice(0, 300));
    r = await ciRun(mkRoot(YML(JOB('g', CHECKOUT + SCAN))), [], { dir: fresh(), deps: { spawn: recorder(td) } });
    check('ci: a tool that is not in .tools/bin is a FAIL telling to run tools ensure --only <tool>', /^FAIL g  gitleaks is not in \.tools\/bin: run omnikom tools ensure --only gitleaks$/.test(lines(r)[0]), r.all.slice(0, 300));
    // deno, initdb, npm
    await cli(['tools', 'ensure', '--only', 'deno'], { OMNIKOM_TOOLS_DIR: td }, { manifest: ciMan, platform: 'linux-amd64', fetch: routeFetch(), now: () => NOW });
    const DENO = v => `      - name: Set up Deno\n        uses: denoland/setup-deno@cccc # v2\n        with:\n          deno-version: ${v}\n`;
    const PG = '      - name: PostgreSQL 16 binaries on PATH (the image\'s own; apt install postgresql only if the image lacks them)\n        run: |\n          if [ -x /usr/lib/postgresql/16/bin/initdb ]; then\n            echo /usr/lib/postgresql/16/bin >> "$GITHUB_PATH"\n          fi\n';
    r = await ciRun(mkRoot(YML(JOB('a', CHECKOUT + DENO('1.2.3')) + JOB('b', CHECKOUT + DENO('9.9.9')) + JOB('c', CHECKOUT + DENO('1.2.3') + PG))), [], { dir: td, deps: { spawn: recorder(td), fetch: rf } });
    check('ci: setup-deno is a version check of .tools/bin/deno against ci.yml and the manifest (PASS, FAIL on a mismatch)', /^PASS a  deno 1\.2\.3 from \.tools\/bin \(ci\.yml 1\.2\.3, tools\.json 1\.2\.3\)$/.test(lines(r)[0]) && /^FAIL b  deno 1\.2\.3 is in \.tools\/bin, ci\.yml wants 9\.9\.9/.test(lines(r)[1]), r.all.slice(0, 400));
    check('ci: the PostgreSQL PATH step is "initdb found" (its version line)', /^PASS c  initdb \(PostgreSQL\) 16\.4/.test(lines(r)[2]), r.all.slice(0, 400));
    r = await ciRun(mkRoot(YML(JOB('c', CHECKOUT + PG))), [], { dir: td, deps: { spawn: recorder(td, { initdb: () => ({ error: Object.assign(new Error('spawn initdb ENOENT'), { code: 'ENOENT' }), status: null, stdout: '', stderr: '' }) }) } });
    check('ci: no initdb on PATH is a FAIL', r.exit === 1 && /^FAIL c  .*initdb/.test(lines(r)[0]), r.all.slice(0, 300));
    r = await ciRun(mkRoot(YML(JOB('c', CHECKOUT + PG))), [], { dir: td, deps: { spawn: recorder(td, { initdb: () => ({ status: 0, stdout: 'initdb (PostgreSQL) 18.4\n', stderr: '' }) }) } });
    check('ci: an initdb of another major than the step\'s name is a PASS that says so (CI runs 16, this machine 18)', r.exit === 0 && /^PASS c  initdb \(PostgreSQL\) 18\.4 \(initdb found; CI runs PostgreSQL 16, this machine 18\)$/.test(lines(r)[0]), r.all.slice(0, 300));
    r = await ciRun(mkRoot(YML(JOB('n', CHECKOUT + SETUP_NODE() + RUN('Free disk before the gates', 'df -h /tmp "$RUNNER_TEMP" && free -m')))), [], { dir: td, deps: { spawn: recorder(td) } });
    check('ci: the df step is a disk and memory report (PASS), mapped explicitly', r.exit === 0 && /memory free \d+ MiB/.test(lines(r)[0]), r.all.slice(0, 300));
    const NPM = RUN('Install the runner\'s pinned dependency (sharp), install scripts off', 'npm ci --prefix factory/runner --ignore-scripts --no-audit --no-fund');
    rt = mkRoot(YML(JOB('n', CHECKOUT + NPM)));
    rec = recorder(td);
    r = await ciRun(rt, [], { dir: td, deps: { spawn: rec } });
    check('ci: npm ci without --install and without node_modules is a FAIL saying "run with --install"; npm is not run', r.exit === 1 && /^FAIL n  npm ci: factory\/runner\/node_modules is missing; run with --install$/.test(lines(r)[0]) && !rec.log.some(c => String(c.args[0]).endsWith('npm-cli.js')), r.all.slice(0, 300));
    mkdirSync(join(rt, 'factory', 'runner', 'node_modules'), { recursive: true });
    rec = recorder(td);
    r = await ciRun(rt, [], { dir: td, deps: { spawn: rec } });
    check('ci: npm ci without --install is SKIP (PASS) when node_modules exists; npm is not run', r.exit === 0 && /^PASS n  SKIP npm ci: factory\/runner\/node_modules exists/.test(lines(r)[0]) && !rec.log.some(c => String(c.args[0]).endsWith('npm-cli.js')), r.all.slice(0, 300));
    r = await ciRun(rt, ['--install'], { dir: td, deps: { spawn: rec } });
    const npmCall = rec.log.find(c => String(c.args[0]).endsWith('npm-cli.js'));
    check('ci --install: npm ci runs as written (with --ignore-scripts), through node and npm-cli.js', r.exit === 0 && npmCall && JSON.stringify(npmCall.args.slice(1)) === JSON.stringify(['ci', '--prefix', 'factory/runner', '--ignore-scripts', '--no-audit', '--no-fund']), r.all.slice(0, 300));

    // ---- the real ci.yml: every job and step is mapped today, every `run: node ...` line runs as written (nothing really runs: a fake spawn)
    const rtools = fresh();
    for (const [name, e] of Object.entries(manReal.tools)) {
      if (!e.platforms) continue;
      mkdirSync(join(rtools, `${name}-${e.version}`), { recursive: true });
      writeFileSync(join(rtools, `${name}-${e.version}`, '.ok'), JSON.stringify({ name, version: e.version, sha256: e.platforms['linux-amd64'].sha256, binSha256: sha('placeholder') }));
      mkdirSync(join(rtools, 'bin'), { recursive: true });
      writeFileSync(join(rtools, 'bin', e.bin['linux-amd64']), 'placeholder');
    }
    const calls = [];
    const allOk = (cmd, args, opts) => {
      calls.push({ cmd: String(cmd), args: [...args], opts });
      const name = basename(String(cmd)).replace(/\.exe$/, '');
      if (name === 'shellcheck') return { status: 0, stdout: `version: ${manReal.tools.shellcheck.version}\n`, stderr: '' };
      if (name === 'deno') return { status: 0, stdout: `deno ${manReal.tools.deno.version} (stable)\n`, stderr: '' };
      if (String(cmd) === process.execPath && args[0] === '--version') return { status: 0, stdout: `v${manReal.tools.node.version}\n`, stderr: '' };
      return { status: 0, stdout: 'fake ok\n', stderr: '' };
    };
    r = await cli(['ci', '--install', '--json'], { OMNIKOM_TOOLS_DIR: rtools }, { manifest: manReal, platform: 'linux-amd64', spawn: allOk, fetch: async () => { throw new Error('the real ci.yml test must not fetch'); }, now: () => NOW + 400 * DAY });
    const jobCount = (ciReal.slice(ciReal.indexOf('\njobs:')).match(/^ {2}[A-Za-z0-9_-]+:\s*$/gm) || []).length;
    const unmapped = r.json ? r.json.data.jobs.flatMap(j => j.steps).filter(s => /step not mapped|does not model/.test(s.lines.join(' '))) : [];
    check('ci on the real ci.yml: every job and step is mapped (none "not mapped"), every job PASSes with the commands faked', r.exit === 0 && r.json.data.total === jobCount && jobCount >= 8 && unmapped.length === 0, `${unmapped.map(s => s.name).join('; ')} ${r.all.slice(0, 300)}`);
    const wantNode = [...ciReal.matchAll(/^\s+run: node (.+)$/gm)].map(m => m[1].trim().split(' '));
    const gotNode = calls.filter(c => c.cmd === process.execPath && c.args[0] !== '--version' && !String(c.args[0]).endsWith('npm-cli.js')).map(c => c.args);
    check('ci on the real ci.yml: every `run: node ...` line is run exactly as written, in file order', wantNode.length >= 12 && JSON.stringify(gotNode) === JSON.stringify(wantNode), `${gotNode.length} of ${wantNode.length}`);
    const wantNpm = /^\s+run: npm (ci .+)$/m.exec(ciReal)[1].split(' ');
    const gotNpm = calls.find(c => String(c.args[0]).endsWith('npm-cli.js'));
    check('ci on the real ci.yml: npm ci runs as written with --install', gotNpm && JSON.stringify(gotNpm.args.slice(1)) === JSON.stringify(wantNpm), gotNpm && JSON.stringify(gotNpm.args));
    // the files actionlint must get: the folders named by the globs on the lint line of ci.yml (read here by a regular expression), every .yml in them, sorted per glob
    const lintLine = ciReal.split('\n').find(l => l.includes('actionlint/actionlint"')) || '';
    const wfFiles = [...lintLine.matchAll(/(\.github\/[A-Za-z0-9_-]+)\/\*\.yml/g)].flatMap(m => readdirSync(join(REPO_ROOT, m[1])).filter(n => n.endsWith('.yml')).sort().map(n => `${m[1]}/${n}`));
    const lintCall = calls.find(c => basename(c.cmd).startsWith('actionlint'));
    check('ci on the real ci.yml: actionlint gets the pinned shellcheck first, -color, and every file of the globs on its line in ci.yml', wfFiles.length >= 5 && lintCall && lintCall.args[0] === '-shellcheck' && basename(lintCall.args[1]).startsWith('shellcheck') && JSON.stringify(lintCall.args.slice(2)) === JSON.stringify(['-color', ...wfFiles]), lintCall && JSON.stringify(lintCall.args));
  } finally { rmSync(work, { recursive: true, force: true }); }
}

// ======================================================================================================== DATABASE
async function database() {
  const { makeSql } = await lib('sql.mjs');
  const { PERSONS } = await lib('identity.mjs');
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
    const migrationFiles = readdirSync(join(REPO_ROOT, 'supabase', 'migrations')).filter(f => f.endsWith('.sql')).length;
    check('status: migrations.onDisk is the number of files in supabase/migrations, and inLedger is 0 while there is no ledger', r.json.data.migrations.onDisk === migrationFiles && migrationFiles >= 13 && r.json.data.migrations.inLedger === 0, JSON.stringify(r.json.data.migrations).slice(0, 200));
    check('status: functionRole is a boolean and the text line says so', typeof r.json.data.functionRole === 'boolean' && r.json.data.functionRoleLine === `function role omnikom_fn: ${r.json.data.functionRole ? 'present' : 'MISSING'}`, r.json.data.functionRoleLine);
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

    // ---- status: the function role, the counts of migrations, which folders are functions
    r = await run(['status', ...T]);
    const inLedgerNow = Number(db.query(`select count(*) from ${ledgerTable}`));
    check('status: after apply the function role omnikom_fn is present, onDisk is the file count and inLedger the ledger row count',
      r.json.data.functionRole === true && r.json.data.functionRoleLine === 'function role omnikom_fn: present' && r.json.data.migrations.onDisk === migrationFiles && r.json.data.migrations.inLedger === inLedgerNow && inLedgerNow === nApplied, JSON.stringify(r.json.data.migrations).slice(0, 200));
    const NOT_ON_DISK = '99999999999999_not_on_disk.sql';
    db.query(`insert into ${ledgerTable} (name, sha256) values ('${NOT_ON_DISK}', 'x')`);
    try { r = await run(['status', ...T]); } finally { db.query(`delete from ${ledgerTable} where name = '${NOT_ON_DISK}'`); }
    check('status: a ledger row for a file that is not on disk counts in inLedger and not in onDisk (the two numbers are not one number)',
      r.json.data.migrations.inLedger === nApplied + 1 && r.json.data.migrations.onDisk === migrationFiles && r.json.data.migrations.unknownInDatabase.length === 1, JSON.stringify(r.json.data.migrations).slice(0, 200));
    // a database without the role: roles are cluster-wide and other test runs share this cluster (mutate.mjs), so the role is not touched;
    // the query asks the real database about a role name that does not exist
    const noRole = (cmd, args, opts) => spawnSync(cmd, args, { timeout: 120000, ...opts, input: String((opts && opts.input) || '').split("rolname = 'omnikom_fn'").join("rolname = 'omnikom_fn_absent'") });
    r = await run(['status', ...T], {}, { spawn: noRole });
    check('status: without the role omnikom_fn, functionRole is false and the line says MISSING; a missing role is shown, not a failure (exit 0)',
      r.exit === 0 && r.json.ok === true && r.json.data.functionRole === false && r.json.data.functionRoleLine === 'function role omnikom_fn: MISSING', r.all.slice(0, 200));
    r = await run(['status', ...T], { LOCAL_FUNCTIONS_BASE: 'http://127.0.0.1:9/functions/v1' }, { fetch: async () => new Response('{}', { status: 200 }) });
    const fnDir = join(REPO_ROOT, 'supabase', 'functions');
    const fnWanted = readdirSync(fnDir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(fnDir, d.name, 'index.ts'))).map(d => d.name).sort();
    const fnGot = r.json.data.functions.checked ? Object.keys(r.json.data.functions).filter(k => k !== 'checked').sort() : [];
    check('status: the functions listed are the folders of supabase/functions that hold an index.ts (the test folder and _shared are not functions, so none is "not deployed" for that reason)',
      fnWanted.length >= 10 && JSON.stringify(fnGot) === JSON.stringify(fnWanted) && !fnGot.includes('test') && fnGot.every(k => r.json.data.functions[k] === 'deployed' || r.json.data.functions[k] === 'disabled'), JSON.stringify(r.json.data.functions).slice(0, 300));

    // ---- the walls on the database (before any fixture exists)
    // a failed walls run prints one " expect_error " line per passed negative test before the cause: show the lines that are not those
    const wallsWhy = x => ((x.json && x.json.data && x.json.data.lines) || []).filter(l => !/^\s*expect_error\s*$/.test(l)).join(' | ').slice(0, 300) || x.all.slice(0, 300);
    r = await run(['test', 'walls', ...T]);
    check('test walls: tenancy.test.sql passes on the target and leaves nothing', r.exit === 0 && (r.json.data.lines || []).some(l => l.startsWith('PASS')), wallsWhy(r));

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
    const gotrue = "aud = 'authenticated' and role = 'authenticated' and instance_id = '00000000-0000-0000-0000-000000000000' and email_confirmed_at is not null and confirmation_token = '' and recovery_token = '' and email_change = '' and email_change_token_new = '' and email_change_token_current = '' and phone_change = '' and phone_change_token = '' and reauthentication_token = '' and raw_app_meta_data ->> 'provider' = 'email' and raw_user_meta_data = '{}'::jsonb";
    check('seed test: the six logins are written the way GoTrue reads them (aud, role, instance, confirmed, empty token columns, app metadata)', db.query(`select count(*) from auth.users where ${gotrue}`) === '6' && db.query("select count(*) from auth.users where email = 'nobody@test'") === '1');
    db.query("update auth.users set aud = null, role = null, instance_id = null, email_confirmed_at = null, confirmation_token = null, recovery_token = null, raw_app_meta_data = null where email in ('owner-a@test', 'staff@omnikom')");
    r = await run(['seed', 'test', ...T]);
    check('seed test repairs logins left by the earlier seed (null aud, instance, tokens) without manual SQL', r.exit === 0 && db.query(`select count(*) from auth.users where ${gotrue}`) === '6' && db.query('select count(*) from auth.users') === '6', r.all.slice(0, 200));
    r = await run(['seed', 'test', ...T, '--alert-to', 'owner@example.com']);
    check('seed test --alert-to sets the sites\' lead alert address', db.query("select count(distinct lead_alert_to::text) from sites") === '1' && db.query("select lead_alert_to::text from sites limit 1") === '{owner@example.com}');
    const fpW = fp();
    r = await run(['test', 'walls', ...T]);
    // the case staging is in: the fixtures (and the test site) are there; the walls run in a namespace of their own and leave them alone
    const wallsLines = x => (x.json && x.json.data && x.json.data.lines) || [];
    check('test walls: on a database that holds the seeded fixtures it passes in a namespace of its own, the test site is unchanged and 0 rows of the run are left',
      r.exit === 0 && /^PASS tenancy tests \(isolated namespace walls-[0-9a-f]{10}\)$/.test(wallsLines(r)[0] || '') && /^PASS test site unchanged \(\d+ tables compared\)$/.test(wallsLines(r)[1] || '') && wallsLines(r)[2] === 'OK: 0 rows of the run left', wallsWhy(r));
    check('test walls: the database is what it was (the fingerprint of every table in public and auth.users)', fp() === fpW);

    // ---- seed test: the test site of sites/test-demo-a/ (contract version 2, the rows of rows.json, the logo's media row, the preview host)
    const seedMod = await import(pathToFileURL(join(CLI_ROOT, 'commands', 'seed.mjs')).href);
    const { PREVIEW_HOST_A, TEST_CONTRACT: TC, seedTestSql, WS_A, WS_B, SITE_A, SITE_B } = seedMod;
    const STAFF = PERSONS.staff.sub;
    const SITE_DIR = join(REPO_ROOT, 'sites', 'test-demo-a');
    const siteContract = JSON.parse(readFileSync(join(SITE_DIR, 'contract.json'), 'utf8'));
    const siteRows = JSON.parse(readFileSync(join(SITE_DIR, 'rows.json'), 'utf8'));
    const logoSize = readFileSync(join(SITE_DIR, 'media', 'logo.png')).length;
    const { mergeCore, leadColumns } = await import(pathToFileURL(join(REPO_ROOT, 'contracts', 'validate.mjs')).href);
    const COLLECTIONS = ['settings', 'team', 'areas', 'notices', 'pages', 'listings'];
    const AGENT_TWO = { name: 'Agent Two', slug: 'agent-two', role: 'Agent' };   // the CLI's fixture for member A2; not in rows.json
    const wantRows = [...siteRows.map(x => ({ id: x.id, collection: x.collection, data: x.data })), { id: 'team-agent-two', collection: 'team', data: AGENT_TWO }];
    const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.fromEntries(Object.keys(x).sort().map(m => [m, x[m]])) : x);
    const jsonq = q => JSON.parse(db.query(q) || 'null');
    const rowKey = (coll, d) => coll === 'settings' ? 'settings' : coll === 'pages' ? d.path : d.slug;
    const activeContract = ws => jsonq(`select to_jsonb(c) from site_contracts c where c.workspace_id = '${ws}' and c.active`);
    // everything the test looks at in workspace A, read by the test's own queries
    const siteFacts = () => {
      const rows = jsonq(`select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'collection', c.collection, 'owner', c.owner_team_row, 'n', l.n, 'data', l.data, 'versions', (select count(*) from content_versions v where v.row_id = c.id))), '[]'::jsonb)
        from content_rows c join lateral (select n, data from content_versions where row_id = c.id order by n desc limit 1) l on true where c.workspace_id = '${WS_A}' and c.deleted_at is null`);
      const media = jsonq(`select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from media m where m.workspace_id = '${WS_A}'`);
      const byKey = new Map(rows.map(x => [`${x.collection}:${rowKey(x.collection, x.data)}`, x]));
      const rowOf = sym => { const w = wantRows.find(x => x.id === sym); return w ? byKey.get(`${w.collection}:${rowKey(w.collection, w.data)}`) : undefined; };
      const swap = v => typeof v === 'string' && v.startsWith('ref:') ? (v === 'ref:media-logo' ? (media[0] && media[0].id) : (rowOf(v.slice(4)) || {}).id)
        : Array.isArray(v) ? v.map(swap) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v;
      return { rows, media, byKey, rowOf, swap };
    };
    // the checks of a freshly seeded test site; `tag` names the moment
    const checkSite = (tag, contractVersion) => {
      const f = siteFacts(), actA = activeContract(WS_A), actB = activeContract(WS_B);
      check(`seed test (${tag}): A's active contract is the file sites/test-demo-a/contract.json as version ${contractVersion}, made by the staff login; the version before is inactive`,
        actA.version === contractVersion && canon(actA.contract) === canon(siteContract) && actA.created_by === STAFF && db.query(`select count(*) from site_contracts where workspace_id = '${WS_A}' and active`) === '1' && db.query(`select count(*) from site_contracts where workspace_id = '${WS_A}' and version = ${contractVersion - 1} and not active`) === '1', JSON.stringify(actA).slice(0, 200));
      check(`seed test (${tag}): A's resolved contract is the file with the core merged in (mergeCore) and the ordered leadColumns (leadColumns of the file, the way sites/test-demo-a/stage.mjs writes them)`,
        canon(actA.resolved.collections) === canon(mergeCore(siteContract)) && canon({ ...actA.resolved, collections: 0 }) === canon({ ...siteContract, collections: 0, leadColumns: leadColumns(siteContract) }));
      check(`seed test (${tag}): workspace B keeps contract version 1 with the contract text of tenancy.test.sql`, actB.version === 1 && canon(actB.resolved) === canon(TC) && canon(actB.contract) === '{}');
      const counts = Object.fromEntries(COLLECTIONS.map(c => [c, f.rows.filter(x => x.collection === c).length]));
      const wantCounts = Object.fromEntries(COLLECTIONS.map(c => [c, wantRows.filter(x => x.collection === c).length]));
      check(`seed test (${tag}): A holds the rows of rows.json plus Agent Two, per collection (${COLLECTIONS.map(c => wantCounts[c]).join('/')} = ${wantRows.length})`, canon(counts) === canon(wantCounts) && f.rows.length === wantRows.length && wantRows.length === 13, JSON.stringify(counts));
      const m = f.media[0] || {};
      check(`seed test (${tag}): one media row, ${WS_A}/logo.png, 400 x 400, the bytes of sites/test-demo-a/media/logo.png, processed, exif stripped, rights confirmed, uploaded by the staff login`,
        f.media.length === 1 && m.path === `${WS_A}/logo.png` && m.width === 400 && m.height === 400 && m.bytes === logoSize && m.processed === true && m.exif_stripped === true && m.rights_confirmed === true && m.uploaded_by === STAFF, JSON.stringify(f.media).slice(0, 300));
      const wrong = wantRows.filter(w => { const hit = f.rowOf(w.id); return !hit || canon(hit.data) !== canon(f.swap(w.data)); }).map(w => w.id);
      check(`seed test (${tag}): every row's latest data is the file's data with each ref:<id> swapped for the id the test looked up itself`, wrong.length === 0, `differs: ${wrong.join(' ')}`);
      const one = f.rowOf('team-agent-one'), two = f.rowOf('team-agent-two');
      check(`seed test (${tag}): the listings' agent is Agent One's real row id and owner_team_row is set from it`,
        one && f.rows.filter(x => x.collection === 'listings').every(x => x.data.agent === one.id && x.owner === one.id), JSON.stringify(f.rows.filter(x => x.collection === 'listings').map(x => [x.data.agent, x.owner])));
      check(`seed test (${tag}): member A1 is linked to Agent One and member A2 to Agent Two`,
        one && two && db.query(`select team_row_id from members where workspace_id = '${WS_A}' and user_id = '${PERSONS['member-a1'].sub}'`) === one.id && db.query(`select team_row_id from members where workspace_id = '${WS_A}' and user_id = '${PERSONS['member-a2'].sub}'`) === two.id);
      check(`seed test (${tag}): the seeded versions are the staff login's, signed off with the reference "omnikom seed test"`,
        db.query(`select count(*) from content_versions v where v.workspace_id = '${WS_A}' and (v.by <> '${STAFF}' or v.sign_off ->> 'ref' <> 'omnikom seed test' or v.sign_off ->> 'by' <> '${STAFF}')`) === '0');
      check(`seed test (${tag}): SITE_A serves from ${PREVIEW_HOST_A}, SITE_B keeps its placeholder`,
        db.query(`select preview_host from sites where id = '${SITE_A}'`) === PREVIEW_HOST_A && PREVIEW_HOST_A === 'preview.test-site-demo-a.pages.dev' && db.query(`select preview_host from sites where id = '${SITE_B}'`) === 'demo-b.preview.test');
      return f;
    };
    r = await run(['seed', 'test', ...T, '--json']);
    check('seed test: the result carries testSite { contractVersion, rows per collection, media } as numbers', r.exit === 0 && r.json.data.testSite.contractVersion === 2 && canon(r.json.data.testSite.rows) === canon(Object.fromEntries(COLLECTIONS.map(c => [c, wantRows.filter(x => x.collection === c).length]))) && r.json.data.testSite.media === 1 && r.json.data.changed === false, r.all.slice(0, 300));
    const site1 = checkSite('first seed', 2);
    const agentOne = site1.rowOf('team-agent-one').id;
    const idsBefore = site1.rows.map(x => x.id).sort().join(',');

    // repair without re-creating: the earlier seed's Agent One had no slug and no role; it gets a new version, never a second row
    db.query(`insert into content_versions (row_id, n, workspace_id, data, by, sign_off) values ('${agentOne}', 2, '${WS_A}', '{"name":"Agent One"}'::jsonb, '${STAFF}', '{}'::jsonb)`);
    r = await run(['seed', 'test', ...T]);
    let fx2 = siteFacts();
    check('seed test: a team row left bare by the earlier seed (name only) is repaired with one more version of the file\'s data; the row id, the member\'s link and the listings\' references survive',
      r.exit === 0 && r.json.data.changed === true && fx2.rowOf('team-agent-one').id === agentOne && fx2.rowOf('team-agent-one').versions === 3 && canon(fx2.rowOf('team-agent-one').data) === canon(siteRows.find(x => x.id === 'team-agent-one').data)
      && fx2.rows.map(x => x.id).sort().join(',') === idsBefore && db.query(`select team_row_id from members where user_id = '${PERSONS['member-a1'].sub}'`) === agentOne && fx2.rows.filter(x => x.collection === 'listings').every(x => x.data.agent === agentOne), r.all.slice(0, 300));
    const fpRep = fp();
    r = await run(['seed', 'test', ...T]);
    check('seed test: a further run after the repair adds nothing', r.exit === 0 && r.json.data.changed === false && fp() === fpRep && siteFacts().rowOf('team-agent-one').versions === 3);

    // a key that finds more than one live row is a failure naming the collection, the key and the ids; nothing is written
    const DUP = '5eed0000-0000-4000-8000-000000000001';
    db.query(`insert into content_rows (id, workspace_id, collection) values ('${DUP}', '${WS_A}', 'areas')`);
    db.query(`insert into content_versions (row_id, n, workspace_id, data, by, sign_off) values ('${DUP}', 1, '${WS_A}', '{"name":"Alpha again","slug":"alpha"}'::jsonb, '${STAFF}', '{}'::jsonb)`);
    const fpDup = fp();
    r = await run(['seed', 'test', ...T]);
    check('seed test: two live rows for one key is exit 1, S-SEED-AMBIGUOUS naming the collection, the key and both ids, and nothing is written (no partial seed)',
      r.exit === 1 && r.json.code === 'S-SEED-AMBIGUOUS' && /areas/.test(r.all) && /alpha/.test(r.all) && r.all.includes(DUP) && r.all.includes(fx2.rowOf('area-alpha').id) && fp() === fpDup, r.all.slice(0, 300));
    db.query(`delete from content_rows where id = '${DUP}'`);

    // the contract is compared by content, never by number: a file that differs from the active contract is the next version, the old one goes inactive
    const auditCount = action => Number(db.query(`select count(*) from audit_log where action = '${action}'`));
    const sc0 = auditCount('seed-contract');
    db.query(`update site_contracts set resolved = resolved || '{"spare": true}'::jsonb where workspace_id = '${WS_A}' and active`);
    r = await run(['seed', 'test', ...T]);
    check('seed test: an active contract that differs from the file (a spare field) is replaced by the next version; the file is active again and the old version is inactive',
      r.exit === 0 && r.json.data.changed === true && auditCount('seed-contract') === sc0 + 1, r.all.slice(0, 200));
    checkSite('after the contract changed', 3);
    const fpC = fp();
    r = await run(['seed', 'test', ...T]);
    check('seed test: and the next run adds nothing', r.exit === 0 && r.json.data.changed === false && fp() === fpC);

    // the preview host: one update and one audit line when it differs
    const ss0 = auditCount('seed-site');
    db.query(`update sites set preview_host = 'demo-a.preview.test' where id = '${SITE_A}'`);
    r = await run(['seed', 'test', ...T]);
    check('seed test: SITE_A\'s preview host set back to the placeholder is corrected, with one seed-site audit line', r.exit === 0 && r.json.data.changed === true && db.query(`select preview_host from sites where id = '${SITE_A}'`) === PREVIEW_HOST_A && auditCount('seed-site') === ss0 + 1, r.all.slice(0, 200));
    r = await run(['seed', 'test', ...T]);
    check('seed test: and a further run writes nothing (no second seed-site line)', r.exit === 0 && r.json.data.changed === false && auditCount('seed-site') === ss0 + 1);

    // a settings row that already names a media row of A keeps it: no media row is inserted, the settings row is not re-versioned for it
    const OTHER = '5eed0000-0000-4000-8000-0000000000e1';
    const st = siteFacts().rowOf('settings');
    db.query(`insert into media (id, workspace_id, path, width, height, bytes, processed, exif_stripped, rights_confirmed, uploaded_by) values ('${OTHER}', '${WS_A}', '${WS_A}/other.png', 800, 600, 1000, true, true, true, '${STAFF}')`);
    db.query(`insert into content_versions (row_id, n, workspace_id, data, by, sign_off) values ('${st.id}', ${st.n + 1}, '${WS_A}', '${JSON.stringify({ ...st.data, logo: { ...st.data.logo, asset: OTHER } }).replace(/'/g, "''")}'::jsonb, '${STAFF}', '{}'::jsonb)`);
    const fpO = fp();
    r = await run(['seed', 'test', ...T]);
    check('seed test: when A\'s settings already name another media row of A, that id is kept: nothing is written (no media row inserted, no new settings version)',
      r.exit === 0 && r.json.data.changed === false && fp() === fpO && db.query(`select count(*) from media where workspace_id = '${WS_A}'`) === '2' && siteFacts().rowOf('settings').n === st.n + 1, r.all.slice(0, 300));

    // the isolated walls, with the test site in the database: unchanged is the pass, and a change inside the window is a FAIL naming the table
    const inWindow = sqlText => (cmd, args, opts) => {
      const out = spawnSync(cmd, args, { timeout: 600000, ...opts });   // no-timeout: the command's own opts carry its limit; this is the fallback
      const fileArg = args[args.indexOf('-f') + 1];   // the walls copy is a temp file; the other psql calls of the command send their SQL on stdin
      if (cmd === 'psql' && args.includes('-f') && fileArg !== '-' && readFileSync(fileArg, 'utf8').includes('create schema test;')) {
        windowHook.fired++;
        const h = spawnSync('psql', ['-h', '127.0.0.1', '-p', cluster.port, '-U', 'postgres', '-d', db.name, '-X', '-v', 'ON_ERROR_STOP=1', '-c', sqlText], { encoding: 'utf8', timeout: 60000 });
        windowHook.out = `status ${h.status} ${String(h.stdout).trim()} ${String(h.stderr).trim().slice(0, 200)}`;
      }   // inside the window: after the walls, before the second fingerprint
      return out;
    };
    const windowHook = { fired: 0, out: '' };
    r = await run(['test', 'walls', ...T], {}, { spawn: inWindow(`update workspaces set name = 'Demo A (changed)' where id = '${WS_A}'`) });
    check('test walls: a row of workspace A changed while the walls ran is FAIL test site changed, naming the table (exit 1, SITE-CHANGED)',
      r.exit === 1 && r.json.code === 'SITE-CHANGED' && wallsLines(r).some(l => l.startsWith('FAIL test site changed: workspaces')) && wallsLines(r)[0].startsWith('PASS tenancy tests'), `hook fired ${windowHook.fired}x (${windowHook.out}) exit ${r.exit} ${r.json && r.json.code} rows ${JSON.stringify(r.json && r.json.data && r.json.data.rowsPerTable)} ${wallsWhy(r)}`);
    db.query(`update workspaces set name = 'Demo A' where id = '${WS_A}'`);
    r = await run(['test', 'walls', ...T], {}, { spawn: inWindow(`insert into audit_log (workspace_id, action) values ('${WS_B}', 'cli-test-window')`) });
    check('test walls: a row added to workspace B inside the window is named too (audit_log, 1 row more)', r.exit === 1 && wallsLines(r).some(l => l.startsWith('FAIL test site changed: audit_log (')), wallsWhy(r));
    db.query(`set session_replication_role = replica; delete from audit_log where action = 'cli-test-window'`);   // audit_log is append-only; the test database only

    // seed test --clean, then seed test: the same counts and the same data, new ids (the test asserts the data, not the ids)
    r = await run(['seed', 'test', ...T, '--clean']);
    check('seed test --clean: the test site goes with its workspace (rows, versions and the media row)', r.exit === 0 && db.query(`select count(*) from content_rows where workspace_id = '${WS_A}'`) === '0' && db.query(`select count(*) from media where workspace_id = '${WS_A}'`) === '0');
    r = await run(['seed', 'test', ...T]);
    const site2 = checkSite('after --clean and seed test', 2);
    check('seed test: after --clean the rows have new ids and the same data', site2.rows.every(x => !idsBefore.split(',').includes(x.id)) && site2.rows.length === wantRows.length);
    const fpClean = fp();
    r = await run(['seed', 'test', ...T]);
    check('seed test: the logo\'s media row was inserted once (none before), and a further run inserts no second', r.exit === 0 && r.json.data.changed === false && fp() === fpClean && db.query(`select count(*) from media where workspace_id = '${WS_A}'`) === '1');

    // part 4: the seeded rows are publish-ready (migration 11's wall) and a bare row is still refused
    const bareId = db.query(`select service.seed_version('${WS_A}', 'listings', '{"street":"3 Bare Rd"}'::jsonb, '${STAFF}', 'cli test')`);
    r = await run(['publish', ...T, '--as', 'owner-a', '--site', 'test-demo-a', '--rows', bareId, '--expect', 'I-NOT-READY']);
    check('publish: a bare row of A is still refused with I-NOT-READY, and no job is queued for it', r.exit === 0 && r.json.code === 'I-NOT-READY' && db.query(`select count(*) from publish_jobs where '${bareId}'::uuid = any(rows)`) === '0', r.all.slice(0, 300));
    db.query(`delete from content_rows where id = '${bareId}'`);
    const seededIds = siteFacts().rows.map(x => x.id);
    r = await run(['publish', ...T, '--as', 'owner-a', '--site', 'test-demo-a', '--rows', seededIds.join(',')]);
    const seededJob = r.json && r.json.data && r.json.data.job;
    check('publish: all the seeded rows of A publish as owner A with no I-NOT-READY (migration 11): one queued job pinning every row', r.exit === 0 && seededJob && db.query(`select count(*) from publish_jobs p, jsonb_object_keys(p.requested) k where p.id = '${seededJob}'`) === String(seededIds.length), r.all.slice(0, 400));

    // the earlier flows below were written against contract version 1 and two bare team rows; seedTestSql() with no argument still seeds exactly that
    // (supabase/functions/test/harness.mjs calls it so, and the platform's function tests expect it)
    r = await run(['seed', 'test', ...T, '--clean']);
    const legacy = makeSql({ url: db.url }).exec(seedTestSql({ alertTo: 'owner@example.com' }));
    check('seedTestSql() with no site (the call the platform\'s function tests make) still seeds contract version 1 for A and two bare team rows, and nothing of the test site',
      r.exit === 0 && legacy.ok && activeContract(WS_A).version === 1 && canon(activeContract(WS_A).resolved) === canon(TC)
      && db.query(`select string_agg(data::text, ',' order by data ->> 'name') from content_versions where workspace_id = '${WS_A}'`) === '{"name": "Agent One"},{"name": "Agent Two"}' && db.query(`select count(*) from media`) === '0', legacy.message);
    const fpLegacy = fp();
    const legacy2 = makeSql({ url: db.url }).exec(seedTestSql({ alertTo: 'owner@example.com' }));
    check('seedTestSql() with no site, run twice, changes nothing the second time (the platform\'s function tests seed once; the earlier flows below seed once and rely on it)', legacy2.ok && fp() === fpLegacy && db.query(`select count(*) from content_rows where workspace_id = '${WS_A}'`) === '2', legacy2.message);

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
    // (key-1: the env file now holds only the newest value, key-2, and the lead tests below sign with the env file's value)
    const toRevoke = r.json.data.keys.find(k => k.vault_ref === 'site-test-demo-a-key-1').id;
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
    check("lead update: member A1 cannot update a lead that is not theirs -> S-NOT-FOUND", r.exit === 0 && r.json.code === 'S-NOT-FOUND' && db.query(`select status from leads where id = '${leadId}'`) === 'not-contacted');
    r = await run(['lead', 'update', ...T, '--as', 'owner-b', '--lead', leadId, '--status', 'spam', '--expect', 'S-NOT-FOUND']);
    check("lead update: B's owner cannot update A's lead -> S-NOT-FOUND", r.exit === 0 && db.query(`select status from leads where id = '${leadId}'`) === 'not-contacted');
    r = await run(['lead', 'update', ...T, '--as', 'owner-a', '--lead', leadId, '--status', 'contacted', '--note', 'called, left a message']);
    check('lead update: the owner changes the status; the timeline gets the status and note events', r.exit === 0 && db.query(`select status from leads where id = '${leadId}'`) === 'contacted' && db.query(`select string_agg(kind::text, ',' order by id) from lead_events where lead_id = '${leadId}'`) === 'received,status,note');
    r = await run(['lead', 'update', ...T, '--as', 'owner-a', '--lead', leadId, '--status', 'bogus', '--expect', 'I-ANSWER']);
    check("lead update: a status outside the business's list is refused by the database (I-ANSWER, migration 23), the CLI keeps no list, and the lead keeps its status", r.exit === 0 && r.json.code === 'I-ANSWER' && db.query(`select status from leads where id = '${leadId}'`) === 'contacted');
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
    // ---- the publish-ready wall (platform 4.6, migration 11): a row missing a required value is saved as a draft, never published
    const bareFile = join(work, 'listing-bare.json'); writeFileSync(bareFile, JSON.stringify({ street: '3 Bare Rd' }));
    r = await run(['content', 'save', ...T, '--as', 'member-a1', ...wsA, '--collection', 'listings', '--file', bareFile]);
    const bare = r.json && r.json.data.row;
    check('content save: a listing without its required status is still saved (a draft)', r.exit === 0 && bare, r.all.slice(0, 300));
    r = await run(['publish', ...T, '--as', 'member-a1', '--site', 'test-demo-a', '--rows', bare, '--expect', 'I-NOT-READY']);
    check('publish: a bare row is refused with I-NOT-READY naming the row and the first missing path; no job is queued for it',
      r.exit === 0 && r.json.code === 'I-NOT-READY' && String(r.json.data && r.json.data.error).includes(`${bare} status required`)
      && db.query(`select count(*) from publish_jobs where '${bare}'::uuid = any(rows)`) === '0', r.all.slice(0, 300));
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
    check('verify --only lead: every check PASSes against the function model', r.exit === 0 && r.json.data.failed === 0 && r.json.data.checks.length === 16 && /^PASS /.test(r.stderr), r.all.slice(0, 600));
    check('verify: the ledger checks of migration 7 are in the suite and PASS (refused signatures, suspended, consent once, retry adds none)', ['each refused signature is recorded once in security_events', 'the paused refusal is recorded once in security_events as suspended', 'an accepted lead has exactly one consent_ledger row', 'a retry adds no consent_ledger row'].every(n => r.json.data.checks.some(c => c.name === n && c.pass)) && /deltas=1,1,1,1/.test(r.stderr), r.stderr.slice(0, 900));
    check('verify: one line per check on stderr, the real status in it', r.stderr.trim().split('\n').length === r.json.data.checks.length && /got 202/.test(r.stderr));
    check('verify: the paused-site check put the site state back and removed its leads', db.query("select state::text from sites where deploy_target = 'test-site-demo-a'") === 'preview' && db.query("select count(*) from leads where page_path = '/omnikom-cli-test'") === '1');
    const naive = await makeFunctionModel({ makeSql, dbUrl: db.url, naive: true });
    r = await run(['verify', ...T, '--only', 'lead'], sendEnv, { fetch: naive });
    check('verify: a function that accepts any signature FAILs (exit 1) on the signature checks', r.exit === 1 && r.json.code === 'VERIFY-FAILED' && r.json.data.checks.filter(c => !c.pass).map(c => c.name).join('|').includes("B's key") && /^FAIL /m.test(r.stderr), r.stderr.slice(0, 600));
    const dropped = await makeFunctionModel({ makeSql, dbUrl: db.url, dropIdem: true });
    r = await run(['verify', ...T, '--only', 'lead'], sendEnv, { fetch: dropped });
    // (the stored leads carry no key, so the consent rows cannot be found through the key either: those two checks fail with the idempotency check)
    check('verify: a function that stores a retry twice FAILs the idempotency check (and the consent checks, which find the lead through the key)', r.exit === 1 && r.json.data.checks.filter(c => !c.pass).map(c => c.name).join('|') === 'an accepted lead has exactly one consent_ledger row|the same idempotency key twice stores one row|a retry adds no consent_ledger row', r.stderr.slice(0, 900));
    db.query("delete from leads where idempotency_key is null and page_path = '/omnikom-cli-test'");
    const chatty = await makeFunctionModel({ makeSql, dbUrl: db.url, doubleAlert: true });
    r = await run(['verify', ...T, '--only', 'lead'], sendEnv, { fetch: chatty });
    check('verify: a function that alerts again on a retry FAILs only the alert check', r.exit === 1 && r.json.data.checks.filter(c => !c.pass).map(c => c.name).join('|') === 'a retry sends no second alert', r.stderr.slice(0, 600));
    const failedBy = flag => makeFunctionModel({ makeSql, dbUrl: db.url, [flag]: true }).then(async m => { const x = await run(['verify', ...T, '--only', 'lead'], sendEnv, { fetch: m }); return { x, names: x.json.data.checks.filter(c => !c.pass).map(c => c.name).join('|') }; });
    let broken = await failedBy('noSecurityLog');
    check('verify: a function that does not record its refusals FAILs the refused-signature and the suspended checks (exit 1)', broken.x.exit === 1 && broken.names === 'each refused signature is recorded once in security_events|the paused refusal is recorded once in security_events as suspended' && /deltas=0,0,0,0/.test(broken.x.stderr), broken.x.stderr.slice(0, 900));
    broken = await failedBy('doubleConsent');
    check('verify: a function that writes the consent row twice FAILs the consent checks (exit 1)', broken.x.exit === 1 && broken.names === 'an accepted lead has exactly one consent_ledger row|a retry adds no consent_ledger row', broken.x.stderr.slice(0, 900));
    broken = await failedBy('pausedAs500');
    check('verify: a function that answers a paused site with 500 FAILs the tightened paused check and records no suspended event (exit 1)', broken.x.exit === 1 && broken.names === 'a lead to a paused site is not stored|the paused refusal is recorded once in security_events as suspended' && /got 500/.test(broken.x.stderr), broken.x.stderr.slice(0, 900));
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
    check('verify --only walls: a Data API that refuses anon passes, and the person checks are listed as waiting', r.exit === 0 && r.json.data.failed === 0 && r.json.data.checks.length === 5 && r.json.data.waiting.length >= 3 && /^PASS /.test(r.stderr), r.all.slice(0, 400));
    r = await run(['verify', ...T, '--only', 'walls'], wallsEnv, { fetch: postgrest({ openRpc: true }) });
    check('verify --only walls: a service function that answers anon FAILs (exit 1)', r.exit === 1 && r.json.data.checks.filter(c => !c.pass).map(c => c.name).join('|') === 'anon calling a service function is refused|anon calling service.lead_update is refused', r.stderr.slice(0, 400));
    r = await run(['verify', ...T, '--only', 'walls'], wallsEnv, { fetch: postgrest({ openRows: true }) });
    check('verify --only walls: a table that returns rows to anon FAILs (exit 1)', r.exit === 1 && r.json.data.checks.filter(c => !c.pass).length === 3, r.stderr.slice(0, 400));
    r = await run(['verify', ...T, '--only', 'walls'], { ...wallsEnv, LOCAL_SUPABASE_PUBLISHABLE_KEY: '' }, { fetch: postgrest() });
    check('verify --only walls: no anon key in the environment is BLOCKED (exit 3)', r.exit === 3);
    r = await run(['verify', ...T, '--only', 'walls'], { LOCAL_SUPABASE_PUBLISHABLE_KEY: anonKey }, { fetch: postgrest() });
    check('verify --only walls: no Data API URL is BLOCKED (exit 3)', r.exit === 3);
    check('hygiene: the anon key is in no output of the walls runs', everything.every(o => !o.includes(anonKey)));

    // ---- verify --only people over a model of GoTrue and PostgREST on this database (row-level security decides what each login sees)
    const secretK = `sb_secret_${rand(12)}`, staffTotp = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const peopleEnv = { ...wallsEnv, LOCAL_AUTH_BASE: 'https://auth.example.test/auth/v1', LOCAL_SUPABASE_SECRET_KEY: secretK };
    const testLeads = () => db.query("select count(*) from leads where page_path = '/omnikom-cli-test'");
    const leadsBefore = testLeads();
    const supa = opts => makeSupabaseModel({ makeSql, dbUrl: db.url, anonKey, secretKey: secretK, ...opts });
    r = await run(['verify', ...T, '--only', 'people'], { ...peopleEnv, TEST_STAFF_TOTP_SECRET: staffTotp }, { fetch: await supa({ totpSecret: staffTotp }) });
    check('verify --only people: every login sees what its role allows (owner B 0, member A1 own, nobody none, keys hidden, staff only at aal2)',
      r.exit === 0 && r.json.data.failed === 0 && r.json.data.checks.length === 15 && /^PASS /.test(r.stderr) && !r.json.data.waiting.some(w => w.startsWith('staff at aal2')), r.stderr.slice(0, 700) || r.all.slice(0, 400));
    check('verify --only people: the two test leads are removed again', testLeads() === leadsBefore);
    check('hygiene: no session token and no admin key in the people run', !/eyJ[\w-]+\.[\w-]+\.[\w-]+/.test(r.all) && !r.all.includes(secretK));
    r = await run(['verify', ...T, '--only', 'people'], peopleEnv, { fetch: await supa({}) });
    check('verify --only people: without the staff TOTP secret the staff checks are listed as waiting, not faked', r.exit === 0 && r.json.data.checks.length === 11 && r.json.data.waiting.some(w => w.startsWith('staff at aal2')), r.all.slice(0, 300));
    r = await run(['verify', ...T, '--only', 'people'], { ...peopleEnv, TEST_STAFF_TOTP_SECRET: staffTotp }, { fetch: await supa({ totpSecret: staffTotp, leaky: true }) });
    check('verify --only people: a Data API that ignores the caller FAILs (exit 1) on the wall checks', r.exit === 1 && r.json.code === 'VERIFY-FAILED' && ["owner B reads A's leads -> 0 rows", 'member A1 sees only their own lead', 'an owner reading the key registry gets nothing'].every(n => r.json.data.checks.some(c => !c.pass && c.name === n)), r.stderr.slice(0, 700));
    check('verify --only people: the leads of a failed run are removed too', testLeads() === leadsBefore);
    r = await run(['verify', ...T, '--only', 'people'], { ...peopleEnv, TEST_STAFF_TOTP_SECRET: staffTotp }, { fetch: await supa({ totpSecret: staffTotp, noMfa: true }) });
    check('verify --only people: staff who count as aal2 without MFA FAIL both aal1 staff checks (exit 1)', r.exit === 1 && ['staff without MFA (aal1) sees no lead', 'staff without MFA (aal1) sees no key'].every(n => r.json.data.checks.some(c => !c.pass && c.name === n)), r.stderr.slice(0, 700));
    r = await run(['verify', ...T, '--only', 'people'], peopleEnv, { fetch: await supa({ blindAuth: true }) });
    check('verify --only people: logins Auth cannot find are BLOCKED (exit 3) with the status, and no lead is made', r.exit === 3 && /500/.test(r.all) && testLeads() === leadsBefore, r.all.slice(0, 300));

    // ---- mfa enroll-staff: a factor is made once, the secret goes to the env file only
    const mfaEnvFile = join(work, 'mfa.env'); writeFileSync(mfaEnvFile, 'SOMETHING=1\n');
    const mfaModel = await supa({});
    r = await run(['mfa', 'enroll-staff', ...T], { ...peopleEnv, OMNIKOM_ENV_FILE: mfaEnvFile }, { fetch: mfaModel });
    const envText = readFileSync(mfaEnvFile, 'utf8');
    check('mfa enroll-staff: a TOTP factor is enrolled, verified, and its secret appended to the env file by name', r.exit === 0 && r.json.data.changed === true && envText.includes(`TEST_STAFF_TOTP_SECRET=${staffTotp}`) && !r.all.includes(staffTotp), r.all.slice(0, 300));
    r = await run(['mfa', 'enroll-staff', ...T], { ...peopleEnv, OMNIKOM_ENV_FILE: mfaEnvFile, TEST_STAFF_TOTP_SECRET: staffTotp }, { fetch: mfaModel });
    check('mfa enroll-staff: twice changes nothing', r.exit === 0 && r.json.data.changed === false && readFileSync(mfaEnvFile, 'utf8') === envText, r.all.slice(0, 200));
    r = await run(['mfa', 'enroll-staff', ...T], { ...peopleEnv, OMNIKOM_ENV_FILE: join(work, 'no-such.env') }, { fetch: await supa({}) });
    check('mfa enroll-staff: no env file to receive the secret is BLOCKED (exit 3) before any factor is made', r.exit === 3, r.all.slice(0, 200));

    // ---- seed test --clean: a login that a real workspace still references (the staff actor of elev8) stays, and is reported
    r = await run(['seed', 'test', ...T, '--clean']);
    check('seed test --clean: removes the fixtures and their Vault secrets; the staff login that elev8 still references is kept and reported',
      r.exit === 0 && db.query("select count(*) from workspaces where slug like 'test-demo-%'") === '0' && db.query("select count(*) from vault.secrets where name like 'site-test-demo-%'") === '0' && db.query('select count(*) from auth.users') === '1' && r.json.data.keptLogins.length === 1, r.all.slice(0, 300));
    db.query("delete from workspaces where slug = 'elev8'");
    r = await run(['seed', 'test', ...T, '--clean']);
    check('seed test --clean: once nothing references it, the last login goes too', r.exit === 0 && db.query('select count(*) from auth.users') === '0' && r.json.data.keptLogins.length === 0, r.all.slice(0, 300));
    // verify --only lead leaves rows in the append-only ledgers on purpose, and the function model now records them like the function
    // does (bad-signature events of site A, whose id is the fixture id of tenancy.test.sql). That test counts that site's events
    // (line 633: exactly the one it makes itself), so this throwaway database is emptied of the ledgers first (replica role: the
    // append-only triggers are skipped; the test database only). On staging the same collision is a finding, not something to delete.
    db.query('set session_replication_role = replica; delete from security_events; delete from consent_ledger; delete from security_event_counts;');
    check('the ledgers and the security event counts are empty again before the walls re-run (a throwaway database)', db.query('select (select count(*) from security_events) + (select count(*) from consent_ledger) + (select count(*) from security_event_counts)') === '0');
    r = await run(['test', 'walls', ...T]);
    check('test walls: passes again after the clean', r.exit === 0, wallsWhy(r));

    // ---- key mint numbering and the env file: n is one more than the highest number in the registry, the Vault and the env file's
    // record line; the env file keeps one record line and one value line per variable (a mint rewrites it, line endings kept)
    r = await run(['seed', 'test', ...T]);
    check('key numbering: the fixtures are seeded again, with no key, no registry row and no Vault secret', r.exit === 0 && db.query('select count(*) from api_keys') === '0' && db.query("select count(*) from vault.secrets where name like 'site-test-demo-%'") === '0', r.all.slice(0, 200));
    const siteAId = db.query("select id from sites where deploy_target = 'test-site-demo-a'");
    const VARA = 'SITE_SIGNING_KEY_TEST_DEMO_A', recordA = n => new RegExp(`^# site-test-demo-a-key-${n}: lead signing key for site ${siteAId} \\(minted \\d{4}-\\d{2}-\\d{2}; set it on the Pages project as SITE_SIGNING_KEY\\)$`);
    const lineOf = (text, eol) => text.split(eol);
    const messy = join(work, 'messy.env');
    writeFileSync(messy, ['# master env', 'FOO=1', `${VARA}=old-value-one`, '# site-test-demo-a-key-3: lead signing key for site x (minted 2026-10-01; set it on the Pages project as SITE_SIGNING_KEY)', 'BAR=2', `${VARA}=old-value-two`, 'SITE_SIGNING_KEY_TEST_DEMO_B=keep-b-value', '# site-test-demo-b-key-1: record of b', ''].join('\r\n'));
    r = await run(['key', 'mint', ...T, '--site', 'test-demo-a', '--env-file', messy]);
    const mText = readFileSync(messy, 'utf8'), mLines = lineOf(mText, '\r\n');
    const mVals = mLines.filter(l => l.startsWith(`${VARA}=`)), mRecs = mLines.filter(l => l.startsWith('# site-test-demo-a-key-'));
    const mNew = mVals.length === 1 ? mVals[0].slice(VARA.length + 1) : '';
    check('key mint: an env file with two value lines and a record line -key-3 gives -key-4 (exit 0)', r.exit === 0 && r.json.data.vaultSecret === 'site-test-demo-a-key-4' && db.query("select count(*) from vault.secrets where name = 'site-test-demo-a-key-4'") === '1', r.all.slice(0, 300));
    check('key mint: the env file then holds exactly one value line for the variable, and it is the new value (the one in the Vault)', mVals.length === 1 && /^[0-9a-f]{64}$/.test(mNew) && db.query(`select count(*) from vault.secrets where name = 'site-test-demo-a-key-4' and secret = '${mNew}'`) === '1' && !r.all.includes(mNew), mText.slice(0, 300));
    check('key mint: and exactly one record line, for -key-4', mRecs.length === 1 && recordA(4).test(mRecs[0]), mRecs.join(' | ').slice(0, 300));
    check('key mint: every unrelated line is unchanged, and the new lines stand where the first removed line was', mLines.length === 8 && [mLines[0], mLines[1], mLines[4], mLines[5], mLines[6], mLines[7]].join('|') === '# master env|FOO=1|BAR=2|SITE_SIGNING_KEY_TEST_DEMO_B=keep-b-value|# site-test-demo-b-key-1: record of b|' && mLines[2] === mRecs[0] && mLines[3] === mVals[0], mText.slice(0, 400));
    check('key mint: the line ending (CRLF) is unchanged: every line break in the file is CRLF', mText.split('\n').slice(0, -1).every(l => l.endsWith('\r')) && mText.endsWith('\r\n'));

    // a fresh env file remembers nothing, so only the registry and the Vault count; a new key goes at the end after one blank line
    const memo = join(work, 'memo.env'); writeFileSync(memo, '# memo\n');
    r = await run(['key', 'mint', ...T, '--site', 'test-demo-b', '--env-file', memo]);
    check('key mint: a fresh env file, an empty Vault and an empty registry for the site give -key-1; the key goes at the end after one blank line', r.exit === 0 && r.json.data.vaultSecret === 'site-test-demo-b-key-1' && /^# memo\n\n# site-test-demo-b-key-1: .*\nSITE_SIGNING_KEY_TEST_DEMO_B=[0-9a-f]{64}\n$/.test(readFileSync(memo, 'utf8')), r.all.slice(0, 300));
    r = await run(['key', 'mint', ...T, '--site', 'test-demo-a', '--env-file', memo]);
    check('key mint: the number of one site does not count the keys of another', r.exit === 0 && r.json.data.vaultSecret === 'site-test-demo-a-key-5', r.all.slice(0, 300));

    // after seed test --clean the Vault secrets and the registry rows are gone with the workspaces; the env file remembers
    r = await run(['seed', 'test', ...T, '--clean']);
    check('key numbering: seed test --clean takes the Vault secrets and the registry rows away', r.exit === 0 && db.query('select count(*) from api_keys') === '0' && db.query("select count(*) from vault.secrets where name like 'site-test-demo-%'") === '0', r.all.slice(0, 200));
    r = await run(['seed', 'test', ...T]);
    r = await run(['key', 'mint', ...T, '--site', 'test-demo-b', '--env-file', memo]);
    const memoText = readFileSync(memo, 'utf8');
    check('key mint: after seed test --clean and seed test again, the same env file gives -key-2 (it remembers -key-1), not -key-1, and still one value line and one record line', r.exit === 0 && r.json.data.vaultSecret === 'site-test-demo-b-key-2' && memoText.split('\n').filter(l => l.startsWith('SITE_SIGNING_KEY_TEST_DEMO_B=')).length === 1 && memoText.split('\n').filter(l => l.startsWith('# site-test-demo-b-key-')).length === 1 && /# site-test-demo-b-key-2: /.test(memoText), r.all.slice(0, 300) + memoText.slice(0, 300));

    // the Vault alone remembers a higher number (no registry row, a fresh env file)
    db.query("insert into vault.secrets (name, secret) values ('site-test-demo-a-key-7', 'seven')");
    const vaultOnly = join(work, 'vault-only.env'); writeFileSync(vaultOnly, '# fresh\n');
    r = await run(['key', 'mint', ...T, '--site', 'test-demo-a', '--env-file', vaultOnly]);
    check('key mint: the Vault alone remembering -key-7 (no registry row, a fresh env file) gives -key-8', r.exit === 0 && r.json.data.vaultSecret === 'site-test-demo-a-key-8', r.all.slice(0, 300));
    // a Vault name that exists is the SQL error it is: exit 1, nothing registered, the env file untouched, no retry under another number
    const collide = join(work, 'collide.env'); writeFileSync(collide, '# c\n');
    const keysBefore = db.query('select count(*) from api_keys');
    r = await run(['key', 'mint', ...T, '--site', 'test-demo-a', '--env-file', collide, '--n', '8']);
    check('key mint: a Vault name that already exists is reported as the SQL error (exit 1), nothing is registered and the env file is untouched', r.exit === 1 && /duplicate|unique/i.test(r.all) && db.query('select count(*) from api_keys') === keysBefore && readFileSync(collide, 'utf8') === '# c\n' && db.query("select count(*) from vault.secrets where name like 'site-test-demo-a-key-%'") === '2', r.all.slice(0, 300));

    // the registry alone remembers (a revoked row counts; the Vault holds nothing of this site, the env file nothing)
    db.query("delete from vault.secrets where name like 'site-test-demo-a-key-%'");
    db.query("update api_keys set revoked_at = now() where vault_ref = 'site-test-demo-a-key-8'");
    const registryOnly = join(work, 'registry-only.env'); writeFileSync(registryOnly, '# fresh\n');
    r = await run(['key', 'mint', ...T, '--site', 'test-demo-a', '--env-file', registryOnly]);
    check('key mint: the registry alone remembering -key-8 (revoked; empty Vault, fresh env file) gives -key-9', r.exit === 0 && r.json.data.vaultSecret === 'site-test-demo-a-key-9', r.all.slice(0, 300));
    // a database without the Vault counts it as nothing (dry run: the Vault is moved away for one command)
    db.query('alter schema vault rename to vault_away');
    try { r = await run(['key', 'mint', ...T, '--site', 'test-demo-a', '--env-file', registryOnly, '--dry-run']); } finally { db.query('alter schema vault_away rename to vault'); }
    check('key mint --dry-run: an absent Vault counts as nothing (the registry and the env file still count: -key-10), nothing is written', r.exit === 0 && r.json.data.dryRun === true && r.json.data.wouldCreate.vaultSecret === 'site-test-demo-a-key-10' && db.query("select count(*) from vault.secrets where name like 'site-test-demo-a-key-%'") === '1', r.all.slice(0, 300));
    check('key mint: the values minted by these tests are printed nowhere', [mNew, ...[memo, vaultOnly, registryOnly].map(f => (readFileSync(f, 'utf8').match(/=([0-9a-f]{64})$/m) || [])[1])].every(v => v && everything.every(o => !o.includes(v))));

    // ---- the cluster guard, for real: a child starts a cluster and is killed hard (no handler runs); the next sweep stops and removes it.
    // (The unit part tests the same sweep with a fake pg_ctl and planted markers; this is the real kill, so it runs where the db part runs.)
    {
      const markers = mkdtempSync(join(tmpdir(), 'omnikom-cli-markers-'));
      const childEnv = { ...process.env, OMNIKOM_TEST_MARKER_DIR: markers };
      delete childEnv.OMNIKOM_TEST_CLUSTER_PORT;
      const child = spawn(process.execPath, [join(CLI_ROOT, 'test', 'cluster-child.mjs')], { env: childEnv, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
      const info = await new Promise(res => {
        let buf = '';
        const timer = setTimeout(() => res(null), 600000);
        child.stdout.on('data', d => { buf += d; const nl = buf.indexOf('\n'); if (nl >= 0) { clearTimeout(timer); try { res(JSON.parse(buf.slice(0, nl))); } catch { res(null); } } });
        child.on('exit', () => { clearTimeout(timer); res(null); });
      });
      const pings = [];                                                     // each ping's status and first stderr line, for the failure detail
      const ping = port => { const p = spawnSync('psql', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-c', 'select 1'], { encoding: 'utf8', timeout: 60000 }); pings.push(`${p.status}${p.error ? ` ${p.error.code}` : ''} ${String(p.stderr || '').split('\n')[0].slice(0, 120)}`.trim()); return p.status === 0; };
      // the child prints its marker as soon as pg_ctl returns; on a loaded Linux runner the server can still refuse for a moment,
      // so the first ping is retried for about 10 s (one try per second); the later pings are not retried (they measure the kill)
      const pingUntil = (port, ms) => { const end = Date.now() + ms; for (;;) { if (ping(port)) return true; if (Date.now() >= end) return false; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); } };
      const up = !!info && pingUntil(info.port, 10000);
      const exited = new Promise(res => { child.on('exit', () => res()); setTimeout(res, 60000); });
      child.kill('SIGKILL');
      await exited;
      const outlived = !!info && ping(info.port);                         // the kill ran no handler: the cluster is still running
      const markerLeft = !!info && existsSync(info.marker);
      const diag = info ? clusterDiag(info) : '\n  cluster: the child printed no marker (it exited first)';   // read before the sweep removes the folder; printed only if the check fails
      const swept = sweepClusters({ markerDir: markers });
      const gone = !!info && !ping(info.port) && !existsSync(info.dir) && !existsSync(info.marker);
      const killOk = up && outlived && markerLeft && swept.length === 1 && swept[0].swept === true && gone;
      check('cluster guard (real kill): a child starts a cluster and is killed hard; its marker and cluster outlive it; the next sweep stops it (pg_ctl stop -m immediate) and removes its folder and marker',
        killOk, JSON.stringify({ pings: pings.slice(-3), up, outlived, markerLeft, swept, gone, info }));   // pings first: check() cuts the detail at 300 characters
      if (!killOk) console.log(`     real kill: failed at ${!up ? 'up (the first ping, 10 s of tries)' : !outlived ? 'outlived (the ping after the kill)' : !markerLeft ? 'markerLeft' : !gone ? 'gone (after the sweep)' : 'the sweep result'}; pings ${JSON.stringify(pings)}${diag}`);   // the long part: check() cuts its detail at 300 characters
      rmSync(markers, { recursive: true, force: true });

      // a port held by something else: the harness walks to the next port of its block and says so, and the cluster answers on 127.0.0.1
      {
        const markers2 = mkdtempSync(join(tmpdir(), 'omnikom-cli-markers-'));
        const holder = net.createServer(() => {});                          // a program that owns P (any listener: the bind conflict is the same)
        const taken = await new Promise(res => { const tryOn = n => { holder.once('error', () => (n < 20 ? tryOn(n + 1) : res(0))); holder.listen(21000 + 100 + n * 10, '127.0.0.1', () => res(holder.address().port)); }; tryOn(0); });
        const saidLines = [];
        let held = null, heldErr = null;
        try { held = startCluster({ markerDir: markers2, signals: false, firstPort: taken, say: l => saidLines.push(l) }); } catch (e) { heldErr = e; }
        const answers = !!held && spawnSync('psql', ['-h', '127.0.0.1', '-p', String(held.port), '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-c', 'select 1'], { encoding: 'utf8', timeout: 60000 }).status === 0;
        check('cluster guard (held port): with P held by another program the harness says "port P in use (could not bind), trying P+1", lands on P+1 and the cluster answers on 127.0.0.1',
          !!taken && !!held && String(held.port) === String(taken + 1) && answers && saidLines.length === 1 && saidLines[0] === `cluster: port ${taken} in use (could not bind), trying ${taken + 1}`,
          JSON.stringify({ taken, port: held && held.port, saidLines, answers, err: heldErr && String(heldErr.message).slice(0, 150) }));
        if (held) held.stop();
        await new Promise(res => holder.close(res));
        rmSync(markers2, { recursive: true, force: true });
      }

      // a database that cannot be created names its cluster: port, data folder, whether the postmaster pid lived, the log tail
      {
        const ghost = mkdtempSync(join(tmpdir(), 'omnikom-cli-pg-'));
        mkdirSync(join(ghost, 'data'), { recursive: true });
        writeFileSync(join(ghost, 'data', 'postmaster.pid'), '999999\n');
        writeFileSync(join(ghost, 'pg.log'), 'LOG:  line one\nLOG:  the last line\n');
        let msg = '';
        try { freshDb({ port: '1', dir: ghost }); } catch (e) { msg = String(e.message); }
        check('cluster diag: a create database that fails names the cluster (port, data folder, postmaster pid not alive) and prints the server log tail',
          /^create database failed/.test(msg) && msg.includes('port 1') && msg.includes(join(ghost, 'data')) && /postmaster pid 999999 not alive/.test(msg) && msg.includes('LOG:  the last line'), msg.slice(0, 250));
        rmSync(ghost, { recursive: true, force: true });
      }
    }

    // ---- rule 1 over the whole database session
    const secrets = [keyA, keyB, db.url];
    check('hygiene: nothing printed in the whole database session contains a minted key or the DB URL', secrets.every(s => everything.every(o => !o.includes(s))));
  } finally {
    cluster.stop();
    rmSync(work, { recursive: true, force: true });
  }
}
const PERSON = n => ({ 'member-a1': '00000000-0000-0000-0000-0000000000a1' })[n];

if (!onlyDb) { await units(); await toolsAndCi(); await impactStampHooksTests({ check, cli, CLI_ROOT, REPO_ROOT, lib }); await journeyTests({ check, cli, CLI_ROOT, REPO_ROOT }); await mutateRunTests({ check, CLI_ROOT, REPO_ROOT }); await withEnvTests({ check, CLI_ROOT, REPO_ROOT, lib }); }
if (!onlyUnit) await database();
const { total, failed } = counts();
console.log(`\n${failed ? 'FAILED' : 'OK'}: ${total - failed} of ${total} checks passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
