// Tests for the body supabase/set-auth-settings.mjs sends (E11): every Auth setting supabase/check-auth-settings.mjs expects a value for is
// sent with that exact value, no recorded-only setting is sent, importing either script runs nothing, and check-auth-settings.mjs judges the sign-in doors and limits without printing a value. In process and with no network:
// the configuration is the real emails.json, the templates the real files of this folder; the dry run (check 6) and the two runs against a local fake server (checks 13 and 14) are the only children.
//   node supabase/auth-emails/body.test.mjs              the suite
//   node supabase/auth-emails/body.test.mjs --mutants    the suite, then every MUTANT (one fault in copies of both scripts in a temp
//                                                        folder, imported with ?m=<n>): each must go red for the named check
// Exit 0 = every check passed (and, with --mutants, every mutant was caught).
import { mkdtempSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import http from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = fileURLToPath(new URL('../check-auth-settings.mjs', import.meta.url));
const SET = fileURLToPath(new URL('../set-auth-settings.mjs', import.meta.url));
const DATA = fileURLToPath(new URL('../set-data-api.mjs', import.meta.url));
const cfg = JSON.parse(readFileSync(join(HERE, 'emails.json'), 'utf8'));
const readTemplate = f => readFileSync(join(HERE, f), 'utf8');

// S1-A's 9 keys, the 13 every other expected value adds, and the 8 that are recorded only (never sent)
const S1A = ['mailer_otp_exp', 'smtp_sender_name', 'smtp_admin_email', 'site_url', 'uri_allow_list',
  'mailer_subjects_magic_link', 'mailer_subjects_invite', 'mailer_templates_magic_link_content', 'mailer_templates_invite_content'];
const ADDED = ['disable_signup', 'external_anonymous_users_enabled', 'mailer_autoconfirm', 'mailer_otp_length', 'external_email_enabled',
  'mfa_totp_enroll_enabled', 'mfa_totp_verify_enabled', 'rate_limit_email_sent', 'rate_limit_verify', 'rate_limit_token_refresh', 'jwt_exp',
  'refresh_token_rotation_enabled', 'mailer_secure_email_change_enabled'];
const RECORDED = ['security_captcha_enabled', 'rate_limit_otp', 'rate_limit_anonymous_users', 'security_refresh_token_reuse_interval',
  'sessions_timebox', 'sessions_inactivity_timeout', 'password_min_length', 'smtp_host'];

// checkUrl / setUrl: the two scripts to import; dry: the script to run with --dry-run (null for the mutants: a copy has no auth-emails folder beside it)
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function suite(checkUrl, setUrl, dry, probe, dataUrl, dataProbe) {
  const results = [];
  const t = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: ok ? '' : String(detail).slice(0, 900) });
  delete process.env.SUPABASE_ACCESS_TOKEN;
  delete process.env.STAGING_SUPABASE_REF;
  let fetches = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetches++; throw new Error('no network in this test'); };
  let chk, set, data = null, dataErr = '';
  try {
    chk = await import(checkUrl);   // before E11 both scripts ran on import: with no token this exits 2 here, and no suite line is printed
    set = await import(setUrl);
    try { data = await import(dataUrl); } catch (e) { dataErr = String(e.message).slice(0, 200); }
  } finally { globalThis.fetch = realFetch; }
  const expect = chk.EXPECT ?? {};
  t('1 importing both scripts with no token set does not exit and starts no fetch; EXPECT has 26 keys', fetches === 0 && Object.keys(expect).length === 26,
    `fetches ${fetches}, EXPECT keys ${Object.keys(expect).length}`);

  let body = {};
  try { body = set.authBody(cfg, expect, readTemplate); } catch (e) { t('authBody runs', false, e.message); }
  const keys = Object.keys(body).sort();
  const want = [...S1A, ...ADDED].sort();
  t('2 authBody has exactly 22 keys: S1-A\'s 9 and the 13 other expected settings', keys.length === 22 && keys.join() === want.join(),
    `missing ${want.filter(k => !keys.includes(k)).join(', ') || '-'}; extra ${keys.filter(k => !want.includes(k)).join(', ') || '-'}`);
  t('3 jwt_exp is 3600 and refresh_token_rotation_enabled is true', body.jwt_exp === 3600 && body.refresh_token_rotation_enabled === true,
    `jwt_exp ${JSON.stringify(body.jwt_exp)}, refresh_token_rotation_enabled ${JSON.stringify(body.refresh_token_rotation_enabled)}`);
  const sentRecorded = RECORDED.filter(k => k in body);
  t('4 no recorded-only setting is sent', sentRecorded.length === 0, `sent: ${sentRecorded.join(', ')}`);
  const differ = keys.filter(k => k in expect && expect[k][1] !== null && body[k] !== expect[k][1]);
  t('5 every sent key with an expectation equals it exactly (type included)', differ.length === 0,
    differ.map(k => `${k}: sent ${JSON.stringify(body[k])}, expected ${JSON.stringify(expect[k][1])}`).join('; '));

  if (dry) {
    const r = spawnSync(process.execPath, ['--max-old-space-size=256', dry, '--dry-run'], { encoding: 'utf8', timeout: 120000, windowsHide: true,
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: 'dry', STAGING_SUPABASE_REF: 'dry' } });
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
    const lines = out.split(/\r?\n/);
    const would = lines.filter(l => l.startsWith('would set')).length;
    t('6 the dry run: exit 0, 22 "would set" lines, last line "dry run: nothing sent"', r.status === 0 && would === 22 && lines[lines.length - 1] === 'dry run: nothing sent',
      `exit ${r.status}, ${would} would-set lines, last: ${lines[lines.length - 1]}`);
  }

  // cases 7 to 12 and 15: what the checker judges (the sign-in doors, the two limits, the three named doors); never sent
  const bad = c => typeof chk.judgeOff !== 'function' ? 'threw: judgeOff is not exported' : chk.judgeOff(c).filter(r => !r.ok).map(r => r.key).sort();
  const badL = c => typeof chk.judgeLimits !== 'function' ? 'threw: judgeLimits is not exported' : chk.judgeLimits(c).filter(r => !r.ok).map(r => r.key).sort();
  const badN = c => typeof chk.judgeNamed !== 'function' ? 'threw: judgeNamed is not exported' : chk.judgeNamed(c).filter(r => !r.ok).map(r => r.key).sort();
  const show = v => JSON.stringify(v);
  const ok7 = [bad({ saml_enabled: true }), bad({})];
  t('7 saml_enabled on is flagged, and a missing saml_enabled is flagged', eq(ok7[0], ['saml_enabled']) && eq(ok7[1], ['saml_enabled']), show(ok7));
  const g8 = bad({ saml_enabled: false, external_azure_enabled: true, external_phone_enabled: true, external_zzfuture_enabled: true, external_zzstring_enabled: 'true' });
  t('8 the external family: named providers, a never-heard-of one and a non-boolean are flagged', eq(g8, ['external_azure_enabled', 'external_phone_enabled', 'external_zzfuture_enabled', 'external_zzstring_enabled']), show(g8));
  const g9 = bad({ saml_enabled: false, mfa_phone_enroll_enabled: true, mfa_web_authn_verify_enabled: true, mfa_zzfuture_enabled: true, mfa_totp_enroll_enabled: true, mfa_totp_verify_enabled: true });
  t('9 the mfa family is flagged; the two TOTP keys are EXPECT\'s, not judged twice', eq(g9, ['mfa_phone_enroll_enabled', 'mfa_web_authn_verify_enabled', 'mfa_zzfuture_enabled']), show(g9));
  const g10 = bad({ saml_enabled: false, hook_send_email_enabled: true, hook_zzfuture_enabled: true, hook_send_email_secrets: 'x', hook_send_email_uri: 'y' });
  t('10 the hook family is flagged; only _enabled keys count', eq(g10, ['hook_send_email_enabled', 'hook_zzfuture_enabled']), show(g10));
  const g11 = bad({ saml_enabled: false, external_email_enabled: true, external_anonymous_users_enabled: true, external_azure_secret: 'x', external_azure_client_id: 'y',
    mfa_totp_enroll_enabled: true, mfa_totp_verify_enabled: true, mfa_phone_template: 't', security_captcha_enabled: true, refresh_token_rotation_enabled: true });
  t('11 what EXPECT judges is not judged twice; other keys and other families are not doors', eq(g11, []), show(g11));
  const g12 = [badL({ mfa_allow_low_aal: false, mfa_max_enrolled_factors: 10 }), badL({ mfa_allow_low_aal: true, mfa_max_enrolled_factors: 10 }),
    badL({ mfa_allow_low_aal: false, mfa_max_enrolled_factors: 11 }), badL({}), badL({ mfa_allow_low_aal: false, mfa_max_enrolled_factors: '5' })];
  t('12 the two limits: safe values pass; a true low-level switch, a count above 10, a missing key and a non-number are flagged',
    eq(g12, [[], ['mfa_allow_low_aal'], ['mfa_max_enrolled_factors'], ['mfa_allow_low_aal', 'mfa_max_enrolled_factors'], ['mfa_max_enrolled_factors']]), show(g12));
  const NAMED = ['custom_oauth_enabled', 'oauth_server_enabled', 'passkey_enabled'];
  const allOff = { passkey_enabled: false, oauth_server_enabled: false, custom_oauth_enabled: false };
  const g15 = [badN(allOff), badN({}), badN({ ...allOff, oauth_server_enabled: true }), badN({ ...allOff, passkey_enabled: 'false' }), bad({ saml_enabled: false, passkey_enabled: true })];
  t('15 the three named doors (passkey, oauth server, custom oauth) must be present and false; a missing one, a true one and a non-boolean are flagged; not judged twice by the families',
    eq(g15, [[], NAMED, ['oauth_server_enabled'], ['passkey_enabled'], []]), show(g15));

  // cases 16, 17 and 19: the Data API schemas (exactly public), the type of a recorded value, the setter's body
  const js = v => (typeof chk.judgeSchemas !== 'function' ? 'threw: judgeSchemas is not exported' : chk.judgeSchemas(v).ok);
  const g16 = [js({ db_schema: 'public' }), js({ db_schema: ' public ' }), js({ db_schema: 'public,graphql_public' }), js({ db_schema: 'public, graphql_public' }),
    js({ db_schema: 'graphql_public' }), js({ db_schema: '' }), js({ db_schema: 'public,public' }), js({ db_schema: 5 }), js({ db_schema: ['public'] }), js(null)];
  t('16 judgeSchemas: exactly public passes (spaces trimmed); a second schema, another schema, empty, a repeat, a number, a list and no answer fail',
    eq(g16, [true, true, false, false, false, false, false, false, false, false]), show(g16));
  const dt = v => (typeof chk.describeType !== 'function' ? 'threw: describeType is not exported' : chk.describeType(v));
  const g17 = [dt(undefined), dt(null), dt(true), dt('SECRETVALUE'), dt(5), dt({}), dt([])];
  t('17 describeType: a type, and a value only for a boolean or null',
    eq(g17, ['(not returned)', 'type null, value null', 'type boolean, value true', 'type string', 'type number', 'type object', 'type list']), show(g17));
  t('19 dataApiBody holds ONLY db_schema, set to public', eq(data ? data.dataApiBody() : `threw: ${dataErr}`, { db_schema: 'public' }), data ? show(data.dataApiBody()) : `threw: ${dataErr}`);

  // cases 13 and 14: the script itself as a child against a local fake server (or a refused local address); never the provider
  if (probe) {
    const guarded = readFileSync(probe, 'utf8').includes('process.env.SUPABASE_API_BASE');
    if (!guarded) {
      const why = 'the script has no SUPABASE_API_BASE guard; not run (it would call the real API)';
      t('13 the script against a local fake server: lines, last line, marker, exit code, no secret, one GET', false, why);
      t('14 SUPABASE_API_BASE naming a non-local address: exit 2, no verdict line, stderr names the variable', false, why);
    } else {
      const expectedGets = reqs => reqs.length === 3 && reqs.every(r => r.method === 'GET' && r.auth === 'Bearer x') && reqs.map(r => r.url).sort().join() === ['/v1/projects/r/config/auth', '/v1/projects/r/config/realtime', '/v1/projects/r/postgrest'].join();
      const run = async (body, answers = {}) => {
        const reqs = [];
        const served = { '/v1/projects/r/config/auth': body, '/v1/projects/r/postgrest': { db_schema: 'public' }, '/v1/projects/r/config/realtime': { private_only: false }, ...answers };
        const server = http.createServer((req, res) => {
          reqs.push({ method: req.method, url: req.url, auth: req.headers.authorization });
          const v = served[req.url];
          if (v === undefined || v === null) { res.writeHead(404); res.end('{}'); return; }
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(v));
        });
        await new Promise(r => server.listen(0, '127.0.0.1', r));
        const child = spawn(process.execPath, ['--max-old-space-size=256', probe], { windowsHide: true,
          env: { ...process.env, SUPABASE_ACCESS_TOKEN: 'x', STAGING_SUPABASE_REF: 'r', SUPABASE_API_BASE: `http://127.0.0.1:${server.address().port}` } });
        let out = '', timedOut = false;
        child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
        const timer = setTimeout(() => { timedOut = true; child.kill(); }, 20000);
        const code = await new Promise(r => child.on('close', c => r(c)));
        clearTimeout(timer);
        if (server.closeAllConnections) server.closeAllConnections();
        await new Promise(r => server.close(r));
        return { reqs, out, code: timedOut ? 'timeout after 20 s' : code };
      };
      const base = {};
      for (const [k, v] of Object.entries(expect)) if (v[1] !== null) base[k] = v[1];
      for (const [name, e] of Object.entries(cfg.emails)) { base[`mailer_subjects_${name}`] = e.subject; base[`mailer_templates_${name}_content`] = readTemplate(e.file); }
      Object.assign(base, { saml_enabled: false, external_azure_enabled: false, mfa_phone_enroll_enabled: false, hook_send_email_enabled: false,
        passkey_enabled: false, oauth_server_enabled: false, custom_oauth_enabled: false, mfa_allow_low_aal: false, mfa_max_enrolled_factors: 10 });
      const MARK = '[LOCAL FAKE SERVER, NOT THE PROVIDER]';
      const lineOf = (out, re) => out.split(/\r?\n/).some(l => re.test(l));
      const lastOf = out => out.trim().split(/\r?\n/).pop();
      const probs = [];
      const A = await run({ ...base, saml_enabled: true, external_azure_enabled: true, mfa_phone_enroll_enabled: true, hook_send_email_enabled: true, mfa_allow_low_aal: true, mfa_max_enrolled_factors: 99,
        external_zzstring_enabled: 'SECRETVALUE-3', external_azure_secret: 'SECRETVALUE-1', smtp_pass: 'SECRETVALUE-2', hook_send_email_secrets: 'SECRETVALUE-4' });
      for (const k of ['saml_enabled', 'external_azure_enabled', 'mfa_phone_enroll_enabled', 'hook_send_email_enabled', 'external_zzstring_enabled', 'mfa_allow_low_aal', 'mfa_max_enrolled_factors'])
        if (!lineOf(A.out, new RegExp(`^FAIL\\s+${k}\\b`))) probs.push(`A: no FAIL line for ${k}`);
      if (lineOf(A.out, /^FAIL\s+(external_email_enabled|mfa_totp)/)) probs.push('A: a FAIL line for an EXPECT key');
      if (A.out.includes('SECRETVALUE')) probs.push('A: a secret value was printed');
      if (!lastOf(A.out).startsWith('FAIL: 26 settings read, 7 differ') || !lastOf(A.out).endsWith(MARK)) probs.push(`A: last line ${lastOf(A.out)}`);
      if (A.code !== 1) probs.push(`A: exit ${A.code}`);
      if (!expectedGets(A.reqs)) probs.push(`A: requests ${show(A.reqs)}`);
      const B = await run(base);
      for (const k of ['saml_enabled', 'external_azure_enabled', 'mfa_phone_enroll_enabled', 'hook_send_email_enabled', 'mfa_allow_low_aal', 'mfa_max_enrolled_factors',
        'passkey_enabled', 'oauth_server_enabled', 'custom_oauth_enabled'])
        if (!lineOf(B.out, new RegExp(`^PASS\\s+${k}\\b`))) probs.push(`B: no PASS line for ${k}`);
      if (lineOf(B.out, /^FAIL/)) probs.push('B: a FAIL line');
      if (!lastOf(B.out).startsWith('OK: 26 settings read, 0 differ') || !lastOf(B.out).endsWith(MARK)) probs.push(`B: last line ${lastOf(B.out)}`);
      if (B.code !== 0) probs.push(`B: exit ${B.code}`);
      if (!expectedGets(B.reqs)) probs.push(`B: requests ${show(B.reqs)}`);
      if (!lineOf(B.out, /^PASS\s+db_schema\b/)) probs.push('B: no PASS line for db_schema');
      if (!lineOf(B.out, /^RECORDED\s+private_only\b.*observed type boolean, value false/)) probs.push('B: no RECORDED line for private_only (boolean false)');
      const gone = ['saml_enabled', 'mfa_allow_low_aal', 'mfa_max_enrolled_factors', 'passkey_enabled'];
      const noC = { ...base }; for (const k of gone) delete noC[k];
      const C = await run(noC);
      for (const k of gone) if (!lineOf(C.out, new RegExp(`^FAIL\\s+${k}\\s.*\\(not returned\\)`))) probs.push(`C: no "not returned" FAIL line for ${k}`);
      if (!expectedGets(C.reqs)) probs.push(`C: requests ${show(C.reqs)}`);
      t('13 the script against a local fake server: lines, last line, marker, exit code, no secret, one GET', probs.length === 0, probs.join('; '));

      const pD = [];
      const D = await run(base, { '/v1/projects/r/postgrest': { db_schema: 'public,graphql_public' }, '/v1/projects/r/config/realtime': { private_only: 'SECRETVALUE-5' } });
      if (!expectedGets(D.reqs)) pD.push(`D: requests ${show(D.reqs)}`);
      if (!lineOf(D.out, /^FAIL\s+db_schema\b.*observed public,graphql_public/)) pD.push('D: no FAIL line for db_schema');
      if (!lineOf(D.out, /^RECORDED\s+private_only\b.*observed type string/)) pD.push('D: no RECORDED line, type string');
      if (D.out.includes('SECRETVALUE')) pD.push('D: a value of an unknown type was printed');
      if (!lastOf(D.out).startsWith('FAIL: 26 settings read, 1 differ')) pD.push(`D: last line ${lastOf(D.out)}`);
      if (D.code !== 1) pD.push(`D: exit ${D.code}`);
      const E = await run(base, { '/v1/projects/r/postgrest': null, '/v1/projects/r/config/realtime': null });
      if (!lineOf(E.out, /^FAIL\s+db_schema\b.*\(not read: 404\)/)) pD.push('E: no "not read: 404" FAIL line for db_schema');
      if (!lineOf(E.out, /^RECORDED\s+private_only\b.*\(not read: 404\)/)) pD.push('E: no "not read: 404" RECORDED line for private_only');
      if (!lastOf(E.out).startsWith('FAIL: 26 settings read, 1 differ')) pD.push(`E: last line ${lastOf(E.out)}`);
      t('18 the checker reads /postgrest and /config/realtime: a wrong schema list and an unreadable endpoint FAIL, private_only is recorded by type only', pD.length === 0, pD.join('; '));

      const r14 = spawnSync(process.execPath, ['--max-old-space-size=256', probe], { encoding: 'utf8', timeout: 20000, windowsHide: true,
        env: { ...process.env, SUPABASE_ACCESS_TOKEN: 'x', STAGING_SUPABASE_REF: 'r', SUPABASE_API_BASE: 'http://127.0.0.2:9' } });
      t('14 SUPABASE_API_BASE naming a non-local address: exit 2, no verdict line, stderr names the variable',
        r14.status === 2 && !lineOf(r14.stdout || '', /^(PASS|FAIL)/) && (r14.stderr || '').includes('SUPABASE_API_BASE'), `exit ${r14.status}; stdout ${(r14.stdout || '').slice(0, 200)}; stderr ${(r14.stderr || '').slice(0, 200)}`);
    }
  }
  // cases 20 to 24: the setter as a child against a local fake server that answers only the staging ref's /postgrest; never the provider
  const NAMES = ['20 the setter dry run', '21 the setter apply (merging fake)', '22 the setter against a replacing fake', '23 the setter refusals', '24 the setter when db_schema is already public'];
  const setterOk = Boolean(dataProbe) && (() => { try { return readFileSync(dataProbe, 'utf8').includes('process.env.SUPABASE_API_BASE'); } catch { return false; } })();
  if (!setterOk) {
    for (const n of NAMES) t(n, false, 'the setter is missing or has no guard; not run');
  } else {
    const SREF = 'abcdefghijkl', SPATH = `/v1/projects/${SREF}/postgrest`;
    const lines = out => out.trim().split(/\r?\n/);
    const has = (out, re) => lines(out).some(l => re.test(l));
    const runSetter = async (initial, { mode = 'merge', args = [], env = {}, base } = {}) => {
      const reqs = []; let state = { ...initial };
      const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', d => { raw += d; });
        req.on('end', () => {
          reqs.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: raw });
          if (req.url !== SPATH) { res.writeHead(404); res.end('{}'); return; }
          if (req.method === 'PATCH') {
            let got = {}; try { got = JSON.parse(raw); } catch { got = {}; }
            state = mode === 'replace' ? { ...got } : { ...state, ...got };
            res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return;
          }
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(state));
        });
      });
      await new Promise(r => server.listen(0, '127.0.0.1', r));
      const child = spawn(process.execPath, ['--max-old-space-size=256', dataProbe, ...args], { windowsHide: true,
        env: { ...process.env, SUPABASE_ACCESS_TOKEN: 'x', STAGING_SUPABASE_REF: SREF, PROD_SUPABASE_REF: '', SUPABASE_API_BASE: base || `http://127.0.0.1:${server.address().port}`, ...env } });
      let out = '', timedOut = false;
      child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, 20000);
      const code = await new Promise(r => child.on('close', c => r(c)));
      clearTimeout(timer);
      if (server.closeAllConnections) server.closeAllConnections();
      await new Promise(r => server.close(r));
      return { reqs, out, code: timedOut ? 'timeout after 20 s' : code, state };
    };
    const MARK = '[LOCAL FAKE SERVER, NOT THE PROVIDER]';
    const START = { db_schema: 'public,graphql_public', max_rows: 1000, db_pool: null, db_extra_search_path: 'public, extensions', jwt_secret: 'SECRETVALUE-1' };
    const seq = r => r.reqs.map(q => q.method).join('>');
    let p = [];
    const d = await runSetter(START, { args: ['--dry-run'] });
    if (d.code !== 0) p.push(`exit ${d.code}`);
    if (seq(d) !== 'GET') p.push(`requests ${seq(d)}`);
    if (!has(d.out, /^db_schema now: public,graphql_public$/)) p.push('no "db_schema now" line');
    if (!has(d.out, /^would send PATCH \/postgrest \{"db_schema":"public"\}$/)) p.push('no "would send" line');
    if (!lines(d.out).pop().startsWith('dry run: nothing sent')) p.push(`last line ${lines(d.out).pop()}`);
    if (!d.out.includes('max_rows=1000')) p.push('max_rows not printed');
    if (d.out.includes('SECRETVALUE')) p.push('a secret was printed');
    t(NAMES[0] + ': exit 0, one GET, what it would send, last line "dry run: nothing sent", no secret', p.length === 0, p.join('; '));

    p = [];
    const a = await runSetter(START);
    if (a.code !== 0) p.push(`exit ${a.code}`);
    if (seq(a) !== 'GET>PATCH>GET') p.push(`requests ${seq(a)}`);
    const patch = a.reqs.find(q => q.method === 'PATCH');
    if (!patch || patch.body !== '{"db_schema":"public"}') p.push(`PATCH body ${patch ? patch.body : '(none)'}`);
    if (!eq(a.state, { ...START, db_schema: 'public' })) p.push(`state after ${show(a.state)}`);
    const la = lines(a.out).pop();
    if (!la.startsWith('OK: db_schema is public; other settings all same') || !la.endsWith(MARK)) p.push(`last line ${la}`);
    if (a.out.includes('SECRETVALUE')) p.push('a secret was printed');
    t(NAMES[1] + ': GET, PATCH of db_schema only, GET; last line OK with the marker; nothing else changed; no secret', p.length === 0, p.join('; '));

    p = [];
    const rp = await runSetter(START, { mode: 'replace' });
    if (rp.code !== 1) p.push(`exit ${rp.code}`);
    const lr = lines(rp.out).pop();
    if (!lr.startsWith('FAIL: db_schema is public; other settings CHANGED: db_extra_search_path, db_pool, jwt_secret, max_rows')) p.push(`last line ${lr}`);
    if (rp.out.includes('SECRETVALUE')) p.push('a secret was printed');
    t(NAMES[2] + ': exit 1, the changed settings named, no secret', p.length === 0, p.join('; '));

    p = [];
    const refusals = [['a non-local base', { base: 'http://127.0.0.2:9' }], ['PROD equals STAGING', { env: { PROD_SUPABASE_REF: SREF } }],
      ['--apply', { args: ['--apply'] }], ['a ref with a path', { env: { STAGING_SUPABASE_REF: 'a/../b' } }]];
    for (const [what, o] of refusals) {
      const r = await runSetter(START, o);
      if (r.code !== 2) p.push(`${what}: exit ${r.code}`);
      if (r.reqs.length !== 0) p.push(`${what}: ${r.reqs.length} requests`);
      if (!has(r.out, /^REFUSED/)) p.push(`${what}: no REFUSED line`);
    }
    t(NAMES[3] + ': a non-local base, the production ref, an unknown argument and a bad ref each exit 2 with no request', p.length === 0, p.join('; '));

    p = [];
    const al = await runSetter({ ...START, db_schema: 'public' });
    if (al.code !== 0) p.push(`exit ${al.code}`);
    if (seq(al) !== 'GET') p.push(`requests ${seq(al)}`);
    if (!lines(al.out).pop().startsWith('OK: db_schema is already public; nothing sent')) p.push(`last line ${lines(al.out).pop()}`);
    t(NAMES[4] + ': exit 0, one GET, nothing sent', p.length === 0, p.join('; '));
  }
  return results;
}

// [name, file, find, replace, the check that must go red]
const MUTANTS = [
  ['the other expected settings are not added', 'set', 'for (const [key, [, expected]] of Object.entries(expect)) if (expected !== null && !(key in body)) body[key] = expected;', '', /^2 /],
  ['recorded-only settings are sent too', 'set', 'if (expected !== null && !(key in body))', 'if (!(key in body))', /^4 /],
  ['jwt_exp has no expected value', 'check', "'JWT lifetime, seconds (D19: 3600, the vendor default)', 3600,", "'JWT lifetime, seconds (D19: 3600, the vendor default)', null,", /^3 /],
  ['the values are sent as text', 'set', 'body[key] = expected;', 'body[key] = String(expected);', /^5 /],
  ['saml_enabled is forgotten', 'check', "const keys = ['saml_enabled', ...Object.keys(cfg).filter(k => OFF_PATTERN.test(k) && !(k in EXPECT)).sort()];",
    'const keys = [...Object.keys(cfg).filter(k => OFF_PATTERN.test(k) && !(k in EXPECT)).sort()];', /^7 /],
  ['an absent door key passes', 'check', 'ok: cfg[key] === false', 'ok: cfg[key] !== true', /^7 /],
  ['the external family is dropped', 'check', 'export const OFF_PATTERN = /^(external|mfa|hook)_.+_enabled$/;', 'export const OFF_PATTERN = /^(mfa|hook)_.+_enabled$/;', /^8 /],
  ['the mfa family is dropped', 'check', 'export const OFF_PATTERN = /^(external|mfa|hook)_.+_enabled$/;', 'export const OFF_PATTERN = /^(external|hook)_.+_enabled$/;', /^9 /],
  ['the hook family is dropped', 'check', 'export const OFF_PATTERN = /^(external|mfa|hook)_.+_enabled$/;', 'export const OFF_PATTERN = /^(external|mfa)_.+_enabled$/;', /^10 /],
  ['what EXPECT judges is judged twice', 'check', "const keys = ['saml_enabled', ...Object.keys(cfg).filter(k => OFF_PATTERN.test(k) && !(k in EXPECT)).sort()];",
    "const keys = ['saml_enabled', ...Object.keys(cfg).filter(k => OFF_PATTERN.test(k)).sort()];", /^11 /],
  ['the factor count has no bound', 'check', "typeof max === 'number' && max <= MFA_MAX_DEFAULT", "typeof max === 'number'", /^12 /],
  ['an absent low-level switch passes', 'check', 'ok: low === false', 'ok: low !== true', /^12 /],
  ['a failing door is not counted in the exit', 'check', 'fail += ok ? 0 : 1;', 'fail += 0;', /^13 /, true],
  ['a value that may be a secret is printed', 'check', '`(a ${typeof got}, not printed)`', '`${JSON.stringify(got)}`', /^13 /, true],
  ['the token goes to any address', 'check', "if (base !== 'https://api.supabase.com' && !/^http:\\/\\/127\\.0\\.0\\.1:\\d+$/.test(base)) {", 'if (false) {', /^14 /, true],
  ['a fake verdict without its marker', 'check', "'  [LOCAL FAKE SERVER, NOT THE PROVIDER]'", "''", /^13 /, true],
  ['a door is put in EXPECT and so sent', 'check', "  mfa_totp_verify_enabled: ['TOTP verification on', true, 'same'],",
    "  saml_enabled: ['SAML off', false, 'x'], mfa_totp_verify_enabled: ['TOTP verification on', true, 'same'],", /^2 /],
  ['an absent named door passes', 'check', 'ok: Object.is(cfg[key], false)', 'ok: cfg[key] !== true', /^15 /],
  ['a list with a second schema passes', 'check', 'l !== null && l.length === 1 && l[0] === SCHEMAS_WANT', 'l !== null && l[0] === SCHEMAS_WANT', /^16 /],
  ['an unknown type prints its value', 'check', "`type ${Array.isArray(v) ? 'list' : typeof v}`", '`type ${typeof v}, value ${v}`', /^17 /],
  ['a wrong schema list is not counted in the exit', 'check', 'fail += sch.ok ? 0 : 1;', 'fail += 0;', /^18 /, true],
  ['private_only is printed as JSON', 'check', 'describeType(rt.json.private_only)', 'JSON.stringify(rt.json.private_only)', /^18 /, true],
  ['the body holds a second key', 'data', 'export const dataApiBody = () => ({ db_schema: SCHEMAS_WANT });', 'export const dataApiBody = () => ({ db_schema: SCHEMAS_WANT, max_rows: 1000 });', /^19 /, true],
  ['a dry run sends', 'data', 'if (dry) { console.log(', 'if (false) { console.log(', /^20 /, true],
  ['the whole answer is sent back', 'data', "await call('PATCH', body);", "await call('PATCH', { ...before, ...body });", /^21 /, true],
  ['a non-partial PATCH is unseen', 'data', "const changed = diffKeys(before, after, 'db_schema');", 'const changed = [];', /^22 /, true],
  ['the production ref is accepted', 'data', 'if (process.env.PROD_SUPABASE_REF && process.env.PROD_SUPABASE_REF === ref) refuse(', 'if (false) refuse(', /^23 /, true],
  ['any host is accepted', 'data', "if (base !== 'https://api.supabase.com' && !/^http:\\/\\/127\\.0\\.0\\.1:\\d+$/.test(base)) refuse(", 'if (false) refuse(', /^23 /, true],
  ['a needless PATCH when already public', 'data', 'if (schemaIsWanted(before.db_schema)) {', 'if (false) {', /^24 /, true],
  ['OK claimed without reading back', 'data', "const after = await call('GET');", 'const after = before;', /^21 /, true],
  ['a fake verdict without its marker (setter)', 'data', "'  [LOCAL FAKE SERVER, NOT THE PROVIDER]'", "''", /^21 /, true],
];

let exit = 0, work = null;
try {
  const base = await suite(new URL('../check-auth-settings.mjs', import.meta.url).href, new URL('../set-auth-settings.mjs', import.meta.url).href, SET, CHECK, new URL('../set-data-api.mjs', import.meta.url).href, DATA);
  for (const r of base) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : '\n     ' + r.detail.replace(/\n/g, '\n     ')}`);
  const failed = base.filter(r => !r.ok).length;
  console.log(failed ? `\nAUTH BODY TESTS FAILED: ${failed} of 24` : `\nAUTH BODY TESTS OK: ${base.length} checks`);
  if (failed || base.length !== 24) exit = 1;

  if (process.argv.includes('--mutants') && !exit) {
    const source = { check: readFileSync(CHECK, 'utf8'), set: readFileSync(SET, 'utf8'), data: readFileSync(DATA, 'utf8') };
    let caught = 0, n = 0;
    work = mkdtempSync(join(tmpdir(), 'auth-body-test-'));   // one folder: the copies import each other by ./
    cpSync(HERE, join(work, 'auth-emails'), { recursive: true });
    for (const [name, file, from, to, expectRed, child] of MUTANTS) {
      n++;
      const count = source[file].split(from).length - 1;
      if (count !== 1) { console.log(`MISSED  ${name}: the target is ${count ? 'not unique' : 'missing'} in ${{ set: SET, data: DATA, check: CHECK }[file]}`); exit = 1; continue; }
      const text = { ...source, [file]: source[file].split(from).join(to) };
      writeFileSync(join(work, 'check-auth-settings.mjs'), text.check);
      writeFileSync(join(work, 'set-auth-settings.mjs'), text.set);
      writeFileSync(join(work, 'set-data-api.mjs'), text.data);
      const res = await suite(`${pathToFileURL(join(work, 'check-auth-settings.mjs')).href}?m=${n}`, `${pathToFileURL(join(work, 'set-auth-settings.mjs')).href}?m=${n}`, null, child ? join(work, 'check-auth-settings.mjs') : null, `${pathToFileURL(join(work, 'set-data-api.mjs')).href}?m=${n}`, child ? join(work, 'set-data-api.mjs') : null);
      const red = res.filter(r => !r.ok);
      if (red.some(r => expectRed.test(r.name))) { caught++; console.log(`caught  ${name}  [red: ${red.map(r => r.name.slice(0, 60)).slice(0, 2).join(' | ')}]`); }
      else { exit = 1; console.log(`MISSED  ${name}  (${red.length ? 'red, but not the expected check: ' + red[0].name : 'still green'})`); }
    }
    console.log(exit ? `\nMUTANTS: not all caught (${caught} of ${MUTANTS.length})` : `\nMUTANTS OK: ${caught} of ${MUTANTS.length} caught`);
  }
} catch (e) {
  console.error(`test run crashed: ${(e && e.stack) || e}`);
  exit = 2;
} finally {
  if (work) rmSync(work, { recursive: true, force: true });
}
process.exit(exit);
