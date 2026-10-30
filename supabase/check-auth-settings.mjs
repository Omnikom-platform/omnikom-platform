// Reads the staging project's Auth settings through the Supabase Management API (read-only, GET only) and compares them with
// supabase/auth-settings.md. Prints one line per setting: observed value, expected value, PASS / FAIL / RECORDED (no expectation,
// the value is recorded). Only the allowlisted keys below are ever printed: the endpoint also returns SMTP and provider secrets.
//   node tools/with-env.mjs "<env file>" -- node supabase/check-auth-settings.mjs [--ref-env STAGING_SUPABASE_REF]
// Needs SUPABASE_ACCESS_TOKEN (a personal access token; read by name, never printed) and STAGING_SUPABASE_REF.
// Source: https://supabase.com/docs/reference/api/v1-get-auth-service-config (GET /v1/projects/{ref}/config/auth).
const argv = process.argv.slice(2);
const after = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const refEnv = after('--ref-env') || 'STAGING_SUPABASE_REF';
const ref = process.env[refEnv], token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) { console.error(`set ${refEnv} and SUPABASE_ACCESS_TOKEN (by name)`); process.exit(2); }

// setting -> [plain words, expected value or null (recorded only), source of the expectation]
const EXPECT = {
  disable_signup: ['sign-ups off (invites only)', true, '24-GAP-HUNT C; PROGRESS.md 2026-10-29'],
  external_anonymous_users_enabled: ['anonymous sign-ins off', false, '24-GAP-HUNT C; PROGRESS.md 2026-10-29'],
  mailer_autoconfirm: ['email confirmation required (autoconfirm off)', false, 'PROGRESS.md 2026-10-29 "confirm email on"'],
  mailer_otp_exp: ['OTP and magic-link expiry, seconds (at most 3600)', 3600, 'PROGRESS.md 2026-10-29'],
  mailer_otp_length: ['OTP length', 8, 'PROGRESS.md 2026-10-29'],
  site_url: ['Site URL', 'https://app-staging.omnikom.io', 'PROGRESS.md 2026-10-29'],
  uri_allow_list: ['redirect allow list', 'https://app-staging.omnikom.io/**', 'PROGRESS.md 2026-10-29'],
  external_email_enabled: ['email provider on (magic link, DECISIONS 29 D18)', true, 'DECISIONS 29'],
  mfa_totp_enroll_enabled: ['TOTP enrolment on (staff second factor)', true, '13-DATA-MODEL 3; the CLI enrolled the staff factor 2026-10-30'],
  mfa_totp_verify_enabled: ['TOTP verification on', true, 'same'],
  security_captcha_enabled: ['CAPTCHA on Auth (Turnstile decision open, 24-GAP-HUNT C)', null, 'recorded'],
  rate_limit_email_sent: ['emails per hour through Auth mail (custom SMTP through Resend since 2026-10-30 01:41)', 30, 'observed 2026-10-31 through the Management API with the full-access token; the earlier "2 per hour" was the built-in mailer cap (21-PROTOCOLS section 5: "after custom SMTP a 30 per hour limit")'],
  rate_limit_verify: ['OTP and magic-link verifications per 5 minutes per IP', 30, 'PROGRESS.md 2026-10-29'],
  rate_limit_token_refresh: ['token refreshes per 5 minutes per IP', 150, 'PROGRESS.md 2026-10-29'],
  rate_limit_otp: ['OTP requests per 5 minutes', null, 'recorded'],
  rate_limit_anonymous_users: ['anonymous sign-ins per hour', null, 'recorded (anonymous is off)'],
  jwt_exp: ['JWT lifetime, seconds (D19 open: proposed 3600)', null, 'recorded'],
  refresh_token_rotation_enabled: ['refresh token rotation', true, 'Supabase default; ASVS 7.x'],
  security_refresh_token_reuse_interval: ['refresh token reuse interval, seconds', null, 'recorded'],
  sessions_timebox: ['absolute session lifetime (paid feature; D19)', null, 'recorded'],
  sessions_inactivity_timeout: ['inactivity timeout (paid feature; D19)', null, 'recorded'],
  password_min_length: ['password minimum length (no passwords by D18; the dashboard never offers a password form)', null, 'recorded'],
  smtp_host: ['custom SMTP host set (Resend, D5)', null, 'recorded: a host name is not a secret; empty = built-in mailer'],
  mailer_secure_email_change_enabled: ['secure email change (both addresses confirm)', true, 'Supabase default'],
};

const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
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
const unknown = Object.keys(EXPECT).filter(k => !(k in cfg));
if (unknown.length) console.log(`NOTE: the API did not return: ${unknown.join(', ')} (vendor differs from the docs; a finding)`);
console.log(`${fail ? 'FAIL' : 'OK'}: ${Object.keys(EXPECT).length} settings read, ${fail} differ from auth-settings.md (checked ${new Date().toISOString().slice(0, 10)})`);
process.exit(fail ? 1 : 0);
