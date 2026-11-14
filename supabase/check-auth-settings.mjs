import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Reads the staging project's Auth settings through the Supabase Management API (read-only, GET only) and compares them with
// supabase/auth-settings.md. Every setting with an expected value is also SENT by set-auth-settings.mjs (E11). Prints one line per setting: observed value, expected value, PASS / FAIL / RECORDED (no expectation,
// the value is recorded). Only the allowlisted keys below are ever printed with a value, the doors and limits (judgeOff, judgeLimits, judgeNamed) only as a boolean or a number: the endpoint also returns SMTP and provider secrets.
//   node tools/with-env.mjs "<env file>" -- node supabase/check-auth-settings.mjs [--ref-env STAGING_SUPABASE_REF]
// Needs SUPABASE_ACCESS_TOKEN (a personal access token; read by name, never printed) and STAGING_SUPABASE_REF.
// SUPABASE_API_BASE exists for the tests' local fake server only.
// Also two more reads, GET only: /postgrest (db_schema must be public) and /config/realtime (private_only recorded).
// Source: https://supabase.com/docs/reference/api/v1-get-auth-service-config (GET /v1/projects/{ref}/config/auth).

// setting -> [plain words, expected value or null (recorded only), source of the expectation]
export const EXPECT = {
  disable_signup: ['sign-ups off (invites only)', true, '24-GAP-HUNT C; PROGRESS.md 2026-10-29'],
  external_anonymous_users_enabled: ['anonymous sign-ins off', false, '24-GAP-HUNT C; PROGRESS.md 2026-10-29'],
  mailer_autoconfirm: ['email confirmation required (autoconfirm off)', false, 'PROGRESS.md 2026-10-29 "confirm email on"'],
  mailer_otp_exp: ['OTP and magic-link expiry, seconds (owner 2026-10-31: 10 minutes)', 600, 'owner 2026-10-31 23:58'],
  mailer_otp_length: ['OTP length', 8, 'PROGRESS.md 2026-10-29'],
  site_url: ['Site URL', 'https://omnikom-app-staging.pages.dev', 'head of operations 2026-11-12: the staging dashboard Pages address (8-routing.md); omnikom.io is never used'],
  uri_allow_list: ['redirect allow list', 'https://omnikom-app-staging.pages.dev/**', 'the site address with /**, as the set script sends it'],
  external_email_enabled: ['email provider on (magic link, DECISIONS 29 D18)', true, 'DECISIONS 29'],
  mfa_totp_enroll_enabled: ['TOTP enrolment on (staff second factor)', true, '13-DATA-MODEL 3; the CLI enrolled the staff factor 2026-10-30'],
  mfa_totp_verify_enabled: ['TOTP verification on', true, 'same'],
  security_captcha_enabled: ['CAPTCHA on Auth (Turnstile decision open, 24-GAP-HUNT C)', null, 'recorded'],
  rate_limit_email_sent: ['emails per hour through Auth mail (custom SMTP through Resend since 2026-10-30 01:41)', 30, 'observed 2026-10-31 through the Management API with the full-access token; the earlier "2 per hour" was the built-in mailer cap (21-PROTOCOLS section 5: "after custom SMTP a 30 per hour limit")'],
  rate_limit_verify: ['OTP and magic-link verifications per 5 minutes per IP', 30, 'PROGRESS.md 2026-10-29'],
  rate_limit_token_refresh: ['token refreshes per 5 minutes per IP', 150, 'PROGRESS.md 2026-10-29'],
  rate_limit_otp: ['OTP requests per 5 minutes', null, 'recorded'],
  rate_limit_anonymous_users: ['anonymous sign-ins per hour', null, 'recorded (anonymous is off)'],
  jwt_exp: ['JWT lifetime, seconds (D19: 3600, the vendor default)', 3600, 'E11 2026-11-12'],
  refresh_token_rotation_enabled: ['refresh token rotation', true, 'Supabase default; ASVS 7.x'],
  security_refresh_token_reuse_interval: ['refresh token reuse interval, seconds', null, 'recorded'],
  sessions_timebox: ['absolute session lifetime (paid feature; D19)', null, 'recorded'],
  sessions_inactivity_timeout: ['inactivity timeout (paid feature; D19)', null, 'recorded'],
  password_min_length: ['password minimum length (no passwords by D18; the dashboard never offers a password form)', null, 'recorded'],
  smtp_host: ['custom SMTP host set (Resend, D5)', null, 'recorded: a host name is not a secret; empty = built-in mailer'],
  smtp_sender_name: ['the name the sign-in email comes from', 'Omnikom Dashboard', 'owner 2026-11-01'],
  smtp_admin_email: ['the address the sign-in email comes from', 'login@notify.omnikom.io', 'owner 2026-11-01; PROGRESS.md 2026-10-30 01:41'],
  mailer_secure_email_change_enabled: ['secure email change (both addresses confirm)', true, 'Supabase default'],
};

// the sign-in doors that must be off (security review 2026-11-14, methods 3, 4 and 5; staging read 2026-11-14): SAML, and every key
// external_<x>_enabled, mfa_<x>_enabled or hook_<x>_enabled that EXPECT does not judge itself (email on, anonymous off, the two TOTP switches
// on). A pattern, so a provider, factor type or hook the vendor adds later is caught with no edit. Only checked, never sent.
export const OFF_PATTERN = /^(external|mfa|hook)_.+_enabled$/;
export function judgeOff(cfg) {
  const keys = ['saml_enabled', ...Object.keys(cfg).filter(k => OFF_PATTERN.test(k) && !(k in EXPECT)).sort()];
  return keys.map(key => ({ key, got: cfg[key], want: 'false', ok: cfg[key] === false }));
}
// three more doors with no common prefix (head's ruling 2026-11-14 12:26; all false on staging): a named list, judged and never sent
export const NAMED_DOORS = ['passkey_enabled', 'oauth_server_enabled', 'custom_oauth_enabled'];
export function judgeNamed(cfg) {
  return NAMED_DOORS.map(key => ({ key, got: cfg[key], want: 'false', ok: Object.is(cfg[key], false) }));
}
// the two second-factor limits (B-sign-in.md 124-126 names the keys and no value; the safe values are the head's ruling 2026-11-14): no
// lower-level sign-in after a factor (mfa_allow_low_aal false) and no more factors per login than the vendor's default (recalled, UNPROVEN: 10)
export const MFA_MAX_DEFAULT = 10;
export function judgeLimits(cfg) {
  const low = cfg.mfa_allow_low_aal, max = cfg.mfa_max_enrolled_factors;
  return [
    { key: 'mfa_allow_low_aal', got: low, want: 'false', ok: low === false },
    { key: 'mfa_max_enrolled_factors', got: max, want: `at most ${MFA_MAX_DEFAULT}`, ok: typeof max === 'number' && max <= MFA_MAX_DEFAULT },
  ];
}

// the Data API (TABLE row 12, security review 2026-11-14): the schemas the REST door serves must be exactly public (staging read 2026-11-14:
// public,graphql_public). A second read, GET only; a check that cannot read it fails. supabase/set-data-api.mjs is the one setter.
export const SCHEMAS_WANT = 'public';
export const schemaList = raw => (typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(Boolean) : null);
export const schemaIsWanted = raw => { const l = schemaList(raw); return l !== null && l.length === 1 && l[0] === SCHEMAS_WANT; };
export const judgeSchemas = pg => { const raw = pg ? pg.db_schema : undefined; return { key: 'db_schema', got: raw, want: SCHEMAS_WANT, ok: schemaIsWanted(raw) }; };
// the JSON type of a value and, only for a boolean or null, the value (Realtime's private_only is recorded; nothing is judged yet)
export const describeType = v => (v === undefined ? '(not returned)' : v === null ? 'type null, value null' : typeof v === 'boolean' ? `type boolean, value ${v}` : `type ${Array.isArray(v) ? 'list' : typeof v}`);

// run only as the script itself: importing the file (set-auth-settings.mjs, auth-emails/body.test.mjs) runs nothing
if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const after = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const refEnv = after('--ref-env') || 'STAGING_SUPABASE_REF';
  const ref = process.env[refEnv], token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !token) { console.error(`set ${refEnv} and SUPABASE_ACCESS_TOKEN (by name)`); process.exit(2); }
  const base = process.env.SUPABASE_API_BASE || 'https://api.supabase.com';
  if (base !== 'https://api.supabase.com' && !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) { console.error("SUPABASE_API_BASE may only name the tests' local fake server"); process.exit(2); }

  const r = await fetch(`${base}/v1/projects/${ref}/config/auth`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) { console.error(`Management API answered ${r.status} ${r.statusText} (the token needs read access to the project's auth config); nothing checked`); process.exit(1); }
  const cfg = await r.json();
  let fail = 0;
  for (const [key, [words, expected, source]] of Object.entries(EXPECT)) {
    const got = cfg[key];
    const shown = got === undefined ? '(not returned)' : typeof got === 'string' && got === '' ? '(empty)' : JSON.stringify(got);
    const verdict = expected === null ? 'RECORDED' : got === expected ? 'PASS' : 'FAIL';
    if (verdict === 'FAIL') fail++;
    console.log(`${verdict.padEnd(8)} ${key.padEnd(40)} observed ${shown}${expected === null ? '' : `  expected ${JSON.stringify(expected)}`}  (${words}; ${source})`);
  }
  for (const { key, got, want, ok } of [...judgeOff(cfg), ...judgeNamed(cfg), ...judgeLimits(cfg)]) {
    fail += ok ? 0 : 1;
    const shown = got === undefined ? '(not returned)' : got === null ? 'null' : typeof got === 'boolean' || (typeof got === 'number' && Number.isFinite(got)) ? String(got) : `(a ${typeof got}, not printed)`;
    console.log(`${ok ? 'PASS' : 'FAIL'}     ${key.padEnd(40)} observed ${shown}  expected ${want}  (a sign-in door that must stay off, or a second-factor limit; security review 2026-11-14, methods 3 to 5)`);
  }
  const get = async path => { const g = await fetch(`${base}/v1/projects/${ref}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) }); if (!g.ok) { await g.body?.cancel(); return { status: g.status, json: null }; } return { status: g.status, json: await g.json() }; };
  const pg = await get('/postgrest');
  const sch = judgeSchemas(pg.json);
  fail += sch.ok ? 0 : 1;
  const schShown = pg.json === null ? `(not read: ${pg.status})` : sch.got === undefined ? '(not returned)' : typeof sch.got === 'string' && /^[A-Za-z0-9_, ]{1,200}$/.test(sch.got) ? sch.got : `(a ${typeof sch.got}, not printed)`;
  console.log(`${sch.ok ? 'PASS' : 'FAIL'}     ${sch.key.padEnd(40)} observed ${schShown}  expected ${sch.want}  (the Data API serves public only; security review 2026-11-14, TABLE row 12)`);
  const rt = await get('/config/realtime');
  console.log(`${'RECORDED'.padEnd(8)} ${'private_only'.padEnd(40)} observed ${rt.json === null ? `(not read: ${rt.status})` : describeType(rt.json.private_only)}  (Realtime public access; recorded, nothing judged yet; TABLE row 19)`);
  // the email templates and subjects: the files in supabase/auth-emails/ (DP-email rows in 16-DESIGN-PARTS)
  const emails = JSON.parse(readFileSync(new URL('./auth-emails/emails.json', import.meta.url), 'utf8'));
  for (const [name, e] of Object.entries(emails.emails)) {
    const want = { [`mailer_subjects_${name}`]: e.subject, [`mailer_templates_${name}_content`]: readFileSync(new URL(`./auth-emails/${e.file}`, import.meta.url), 'utf8') };
    for (const [key, value] of Object.entries(want)) {
      const ok = cfg[key] === value;
      if (!ok) fail++;
      console.log(`${ok ? 'PASS' : 'FAIL'}     ${key.padEnd(40)} ${ok ? 'matches' : 'differs from'} supabase/auth-emails/${key.includes('subjects') ? 'emails.json' : e.file}`);
    }
  }
  const unknown = Object.keys(EXPECT).filter(k => !(k in cfg));
  if (unknown.length) console.log(`NOTE: the API did not return: ${unknown.join(', ')} (vendor differs from the docs; a finding)`);
  console.log(`${fail ? 'FAIL' : 'OK'}: ${Object.keys(EXPECT).length} settings read, ${fail} differ from auth-settings.md (checked ${new Date().toISOString().slice(0, 10)})${base === 'https://api.supabase.com' ? '' : '  [LOCAL FAKE SERVER, NOT THE PROVIDER]'}`);
  process.exit(fail ? 1 : 0);
}
