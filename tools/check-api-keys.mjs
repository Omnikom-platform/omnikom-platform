// One small live call per saved key; prints only the service, HTTP status and a short verdict, never a key.
// Usage: node tools/check-api-keys.mjs [path to .secrets/api-keys.env]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.secrets', 'api-keys.env');
const env = Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const t = (ms) => AbortSignal.timeout(ms);
async function check(name, key, fn) {
  if (!env[key]) return console.log(`${name}: MISSING (${key} not in the file)`);
  try {
    const r = await fn(env[key]);
    const body = await r.text();
    const msg = r.ok ? 'OK' : (body.match(/"message"\s*:\s*"([^"]{0,140})/)?.[1] || body.slice(0, 140)).replace(env[key], '<key>');
    console.log(`${name}: HTTP ${r.status} ${msg}`);
  } catch (e) { console.log(`${name}: ERROR ${String(e.message).replace(env[key], '<key>')}`); }
}
await check('Chrome UX Report', 'CRUX_API_KEY', (k) => fetch(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${k}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origin: 'https://www.google.com' }), signal: t(30000) }));
await check('PageSpeed Insights', 'PSI_API_KEY', (k) => fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent('https://example.com/')}&strategy=mobile&category=performance&key=${k}`, { signal: t(120000) }));
await check('Gemini', 'GEMINI_API_KEY', (k) => fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': k }, signal: t(30000) }));
await check('Bing Webmaster', 'BING_WEBMASTER_KEY', (k) => fetch(`https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=${k}`, { signal: t(30000) }));
