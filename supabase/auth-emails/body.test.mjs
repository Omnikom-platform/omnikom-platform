// Tests for the body supabase/set-auth-settings.mjs sends (E11): every Auth setting supabase/check-auth-settings.mjs expects a value for is
// sent with that exact value, no recorded-only setting is sent, and importing either script runs nothing. In process and with no network:
// the configuration is the real emails.json, the templates the real files of this folder; the dry run (check 6) is the only child.
//   node supabase/auth-emails/body.test.mjs              the suite
//   node supabase/auth-emails/body.test.mjs --mutants    the suite, then every MUTANT (one fault in copies of both scripts in a temp
//                                                        folder, imported with ?m=<n>): each must go red for the named check
// Exit 0 = every check passed (and, with --mutants, every mutant was caught).
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = fileURLToPath(new URL('../check-auth-settings.mjs', import.meta.url));
const SET = fileURLToPath(new URL('../set-auth-settings.mjs', import.meta.url));
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
async function suite(checkUrl, setUrl, dry) {
  const results = [];
  const t = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: ok ? '' : String(detail).slice(0, 900) });
  delete process.env.SUPABASE_ACCESS_TOKEN;
  delete process.env.STAGING_SUPABASE_REF;
  let fetches = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetches++; throw new Error('no network in this test'); };
  let chk, set;
  try {
    chk = await import(checkUrl);   // before E11 both scripts ran on import: with no token this exits 2 here, and no suite line is printed
    set = await import(setUrl);
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
  return results;
}

// [name, file, find, replace, the check that must go red]
const MUTANTS = [
  ['the other expected settings are not added', 'set', 'for (const [key, [, expected]] of Object.entries(expect)) if (expected !== null && !(key in body)) body[key] = expected;', '', /^2 /],
  ['recorded-only settings are sent too', 'set', 'if (expected !== null && !(key in body))', 'if (!(key in body))', /^4 /],
  ['jwt_exp has no expected value', 'check', "'JWT lifetime, seconds (D19: 3600, the vendor default)', 3600,", "'JWT lifetime, seconds (D19: 3600, the vendor default)', null,", /^3 /],
  ['the values are sent as text', 'set', 'body[key] = expected;', 'body[key] = String(expected);', /^5 /],
];

let exit = 0, work = null;
try {
  const base = await suite(new URL('../check-auth-settings.mjs', import.meta.url).href, new URL('../set-auth-settings.mjs', import.meta.url).href, SET);
  for (const r of base) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : '\n     ' + r.detail.replace(/\n/g, '\n     ')}`);
  const failed = base.filter(r => !r.ok).length;
  console.log(failed ? `\nAUTH BODY TESTS FAILED: ${failed} of 6` : `\nAUTH BODY TESTS OK: ${base.length} checks`);
  if (failed || base.length !== 6) exit = 1;

  if (process.argv.includes('--mutants') && !exit) {
    const source = { check: readFileSync(CHECK, 'utf8'), set: readFileSync(SET, 'utf8') };
    let caught = 0, n = 0;
    work = mkdtempSync(join(tmpdir(), 'auth-body-test-'));   // one folder: the copies import each other by ./
    for (const [name, file, from, to, expectRed] of MUTANTS) {
      n++;
      const count = source[file].split(from).length - 1;
      if (count !== 1) { console.log(`MISSED  ${name}: the target is ${count ? 'not unique' : 'missing'} in ${file === 'set' ? SET : CHECK}`); exit = 1; continue; }
      const text = { ...source, [file]: source[file].split(from).join(to) };
      writeFileSync(join(work, 'check-auth-settings.mjs'), text.check);
      writeFileSync(join(work, 'set-auth-settings.mjs'), text.set);
      const res = await suite(`${pathToFileURL(join(work, 'check-auth-settings.mjs')).href}?m=${n}`, `${pathToFileURL(join(work, 'set-auth-settings.mjs')).href}?m=${n}`, null);
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
