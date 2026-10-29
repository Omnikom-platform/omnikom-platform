// Presence and one live call per platform key in the master .env (by name; nothing printed but name, HTTP status, verdict).
//   node tools/check-platform-keys.mjs "<env file>"
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const file = process.argv[2] || process.env.OMNIKOM_ENV_FILE;
if (!file) { console.error('usage: node tools/check-platform-keys.mjs <env file>'); process.exit(2); }
const env = Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => /^[A-Z][A-Z0-9_]*=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const t = ms => AbortSignal.timeout(ms);
const scrub = (s, k) => String(s).split(k).join('<key>').slice(0, 140);
async function check(label, key, fn) {
  if (!env[key]) return console.log(`${label}: MISSING (${key})`);
  try { const r = await fn(env[key]); const body = await r.text(); console.log(`${label}: HTTP ${r.status} ${r.ok ? 'OK' : scrub(body, env[key])}`); }
  catch (e) { console.log(`${label}: ERROR ${scrub(e.message, env[key])}`); }
}
const ref = env.STAGING_SUPABASE_REF;
console.log(`STAGING_SUPABASE_REF: ${ref ? 'present' : 'MISSING'}`);
for (const k of ['STAGING_DB_PASSWORD', 'STAGING_DB_URL', 'STAGING_DB_URL_DIRECT']) console.log(`${k}: ${env[k] ? 'present' : 'MISSING'}`);
if (env.STAGING_DB_URL) {
  const r = spawnSync('psql', [env.STAGING_DB_URL, '-X', '-q', '-t', '-A', '-c', 'select 1'], { encoding: 'utf8', timeout: 30000 });
  console.log(`STAGING_DB_URL connect: ${r.status === 0 && r.stdout.trim() === '1' ? 'OK' : 'FAILED ' + scrub(r.stderr, env.STAGING_DB_URL)}`);
}
if (ref) {
  await check('Supabase publishable key', 'STAGING_SUPABASE_PUBLISHABLE_KEY', k => fetch(`https://${ref}.supabase.co/auth/v1/settings`, { headers: { apikey: k }, signal: t(20000) }));
  await check('Supabase secret key', 'STAGING_SUPABASE_SECRET_KEY', k => fetch(`https://${ref}.supabase.co/rest/v1/`, { headers: { apikey: k, authorization: `Bearer ${k}` }, signal: t(20000) }));
}
await check('Cloudflare Pages token', 'CLOUDFLARE_PAGES_TOKEN', k => fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', { headers: { authorization: `Bearer ${k}` }, signal: t(20000) }));
await check('Cloudflare DNS token', 'CLOUDFLARE_DNS_TOKEN', k => fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', { headers: { authorization: `Bearer ${k}` }, signal: t(20000) }));
for (const k of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ACCOUNT_ID', 'LEAD_ALERT_FROM', 'GOOGLE_SERVICE_ACCOUNT_JSON']) console.log(`${k}: ${env[k] ? 'present' : 'MISSING'}`);
await check('Resend', 'RESEND_API_KEY', k => fetch('https://api.resend.com/domains', { headers: { authorization: `Bearer ${k}` }, signal: t(20000) }));
