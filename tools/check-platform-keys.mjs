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
// Account API tokens (dash > account > Account API tokens, 2026-10-30) verify at the ACCOUNT endpoint; the user endpoint answers
// 401 "Invalid API Token" for them (measured). User tokens verify at /user/tokens/verify.
const cfVerify = env.CLOUDFLARE_ACCOUNT_ID ? `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/tokens/verify` : 'https://api.cloudflare.com/client/v4/user/tokens/verify';
await check('Cloudflare Pages token', 'CLOUDFLARE_PAGES_TOKEN', k => fetch(cfVerify, { headers: { authorization: `Bearer ${k}` }, signal: t(20000) }));
await check('Cloudflare DNS token', 'CLOUDFLARE_DNS_TOKEN', k => fetch(cfVerify, { headers: { authorization: `Bearer ${k}` }, signal: t(20000) }));
for (const k of ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ACCOUNT_ID', 'LEAD_ALERT_FROM']) console.log(`${k}: ${env[k] ? 'present' : 'MISSING'}`);
// Google service account: the value is the base64 of the JSON key. Live check = sign a JWT with its private key, exchange it for
// an access token, list Search Console sites (an empty list is the expected answer until step 7 adds properties).
if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) console.log('Google service account: MISSING (GOOGLE_SERVICE_ACCOUNT_JSON)');
else try {
  const { createSign } = await import('node:crypto');
  const sa = JSON.parse(Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_JSON, 'base64').toString('utf8'));
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/webmasters.readonly', aud: sa.token_uri, iat: now, exp: now + 300 })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const tok = await fetch(sa.token_uri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${sig}`, signal: t(20000) }).then(r => r.json());
  if (!tok.access_token) console.log(`Google service account: token exchange failed ${JSON.stringify(tok).slice(0, 120)}`);
  else { const r = await fetch('https://www.googleapis.com/webmasters/v3/sites', { headers: { authorization: `Bearer ${tok.access_token}` }, signal: t(20000) }); const j = await r.json().catch(() => ({})); console.log(`Google service account (${sa.client_email}): HTTP ${r.status} ${r.ok ? `OK, ${(j.siteEntry || []).length} Search Console site(s)` : JSON.stringify(j).slice(0, 120)}`); }
} catch (e) { console.log(`Google service account: ERROR ${String(e.message).slice(0, 120)}`); }
// A sending-only key answers 401 "restricted to only send emails" on /domains (measured 2026-10-30): that is a VALID key with the
// least privilege; an unknown key answers 401 "API key is invalid". No harmless send endpoint exists, so the message is the check.
if (!env.RESEND_API_KEY) console.log('Resend: MISSING (RESEND_API_KEY)');
else try {
  const r = await fetch('https://api.resend.com/domains', { headers: { authorization: `Bearer ${env.RESEND_API_KEY}` }, signal: t(20000) });
  const body = await r.text();
  console.log(r.ok ? 'Resend: HTTP 200 OK (full-access key)' : /restricted to only send/.test(body) ? 'Resend: HTTP 401 OK (sending-only key, as intended)' : `Resend: HTTP ${r.status} ${scrub(body, env.RESEND_API_KEY)}`);
} catch (e) { console.log(`Resend: ERROR ${scrub(e.message, env.RESEND_API_KEY)}`); }
