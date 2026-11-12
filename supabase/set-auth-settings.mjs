// Sets the staging project's Auth email settings from the repository (owner 2026-10-31 and 2026-11-01): the link life
// (mailer_otp_exp), the address the links land on (site_url, and uri_allow_list as that address with /**), the sender name and address, and the sign-in and invite email subjects and templates in supabase/auth-emails/.
// PATCH /v1/projects/{ref}/config/auth with ONLY these keys, then GET and compare each key with what was sent. Prints key names,
// the short values and "matches" for the templates; never prints any other field (the endpoint also returns SMTP secrets).
//   node tools/with-env.mjs "<env file>" -- node supabase/set-auth-settings.mjs [--ref-env STAGING_SUPABASE_REF] [--dry-run]
// Needs SUPABASE_ACCESS_TOKEN (read by name, never printed) and the project ref. The email check runs first and must pass.
// Source: https://supabase.com/docs/reference/api/v1-update-auth-service-config (PATCH /v1/projects/{ref}/config/auth).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const after = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const dry = argv.includes('--dry-run');
const refEnv = after('--ref-env') || 'STAGING_SUPABASE_REF';
const ref = process.env[refEnv], token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) { console.error(`set ${refEnv} and SUPABASE_ACCESS_TOKEN (by name)`); process.exit(2); }

const check = spawnSync(process.execPath, [fileURLToPath(new URL('./auth-emails/check.mjs', import.meta.url))], { encoding: 'utf8', timeout: 60000 });
if (check.status !== 0) { console.error(`the email check fails; nothing sent:\n${check.stdout}${check.stderr}`); process.exit(1); }
console.log(check.stdout.trim());

const cfg = JSON.parse(readFileSync(new URL('./auth-emails/emails.json', import.meta.url), 'utf8'));
const body = { mailer_otp_exp: cfg.link_life_seconds, smtp_sender_name: cfg.sender.name, smtp_admin_email: cfg.sender.address, site_url: cfg.site_url, uri_allow_list: `${cfg.site_url}/**` };
for (const [name, e] of Object.entries(cfg.emails)) {
  body[`mailer_subjects_${name}`] = e.subject;
  body[`mailer_templates_${name}_content`] = readFileSync(new URL(`./auth-emails/${e.file}`, import.meta.url), 'utf8');
}
const show = (k, v) => k.startsWith('mailer_templates_') ? `(${v.length} characters, from supabase/auth-emails/)` : JSON.stringify(v);
for (const [k, v] of Object.entries(body)) console.log(`${dry ? 'would set' : 'set'}  ${k.padEnd(40)} ${show(k, v)}`);
if (dry) { console.log('dry run: nothing sent'); process.exit(0); }

const api = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const p = await fetch(api, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
if (!p.ok) { console.error(`Management API PATCH answered ${p.status} ${p.statusText}; nothing confirmed`); await p.body?.cancel(); process.exit(1); }
await p.body?.cancel();
console.log(`PATCH ${p.status}`);

const g = await fetch(api, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
if (!g.ok) { console.error(`read-back GET answered ${g.status}`); process.exit(1); }
const got = await g.json();
let fail = 0;
for (const [k, v] of Object.entries(body)) {
  const ok = got[k] === v;
  if (!ok) fail++;
  const seen = k.startsWith('mailer_templates_') ? (ok ? 'matches the file' : 'DIFFERS from the file') : JSON.stringify(got[k]);
  console.log(`${ok ? 'PASS' : 'FAIL'}  read back ${k.padEnd(40)} ${seen}`);
}
console.log(`${fail ? 'FAIL' : 'OK'}: ${Object.keys(body).length} Auth settings set and read back on ${refEnv}, ${fail} differ (${new Date().toISOString()})`);
process.exit(fail ? 1 : 0);
