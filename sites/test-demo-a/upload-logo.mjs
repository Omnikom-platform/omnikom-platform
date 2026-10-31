// Uploads the test site's logo the way the dashboard does, as owner-a, so the media job on GitHub (media.yml) processes it (step 4.5).
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node sites/test-demo-a/upload-logo.mjs [--wait] [--media <uuid>]
// Steps: upload-start (owner-a's real session token) -> PUT the bytes to the signed upload URL -> upload-finish (rights ticked), which
// dispatches the media job -> with --wait, reads the media row on staging every 15 s (at most 15 minutes) until processed is true.
// --media <uuid> skips the upload and only waits on that row (a second run never uploads the logo twice when given the id).
// Prints the media id, `dispatched`, and the processed width; never a URL (a signed URL carries a token), a token or a key value.
// Exit 0 = uploaded (and processed, with --wait); 1 = a step failed; 2 = usage; 3 = a name is missing in the environment.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTarget } from '../../tools/omnikom-cli/lib/target.mjs';
import { parseIdentity, personToken } from '../../tools/omnikom-cli/lib/identity.mjs';
import { callFunction } from '../../tools/omnikom-cli/lib/fn.mjs';
import { makeSql, uuidLit } from '../../tools/omnikom-cli/lib/sql.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WS_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const argv = process.argv.slice(2);
const wait = argv.includes('--wait');
const mi = argv.indexOf('--media');
let media = mi >= 0 ? argv[mi + 1] : null;
if (mi >= 0 && !(media && UUID.test(media))) { console.error('usage: upload-logo.mjs [--wait] [--media <uuid>]'); process.exit(2); }
const die = (code, msg) => { console.error(msg); process.exit(code); };

const target = resolveTarget('staging', process.env, { needDb: false });
if (!target.functionsBase) die(3, 'BLOCKED: STAGING_SUPABASE_REF is not set (read by name)');
if (!process.env.STAGING_DB_URL) die(3, 'BLOCKED: STAGING_DB_URL is not set (read by name)');
const pubKey = process.env[target.vars.publishableKey];

if (!media) {
  const bytes = readFileSync(join(HERE, 'media', 'logo.png'));
  const token = await personToken(parseIdentity('owner-a'), { target, env: process.env });
  const call = (name, body) => callFunction({ base: target.functionsBase, name, body: JSON.stringify(body), extraHeaders: { authorization: `Bearer ${token}`, ...(pubKey ? { apikey: pubKey } : {}) } });
  const us = await call('upload-start', { workspace: WS_A, filename: 'logo.png', bytes: bytes.length, mime: 'image/png' });
  if (us.status !== 200 || !us.json || !UUID.test(us.json.media || '')) die(1, `FAIL upload-start: ${us.status} ${us.json && us.json.code || us.error || ''}`);
  media = us.json.media;
  console.log(`upload-start 200: media ${media}`);
  let put;
  try { const r = await fetch(us.json.uploadUrl, { method: 'PUT', body: bytes, headers: { 'content-type': 'image/png' }, signal: AbortSignal.timeout(60000) }); await r.text(); put = r.status; }
  catch (e) { put = `network ${String(e && e.message || e).slice(0, 80)}`; }
  if (put !== 200) die(1, `FAIL upload PUT: ${put}`);
  console.log(`upload PUT 200: ${bytes.length} bytes`);
  const uf = await call('upload-finish', { media, rightsConfirmed: true });
  if (uf.status !== 200 || !uf.json) die(1, `FAIL upload-finish: ${uf.status} ${uf.json && uf.json.code || uf.error || ''}`);
  console.log(`upload-finish 200: processed ${uf.json.processed}, dispatched ${uf.json.dispatched}${uf.json.reason ? ' (' + uf.json.reason + ')' : ''}`);
  if (uf.json.dispatched !== true) die(1, 'FAIL the media job was not dispatched');
}

if (wait) {
  const sql = makeSql({ url: process.env.STAGING_DB_URL, readOnly: true });
  const until = Date.now() + 15 * 60 * 1000;
  for (;;) {
    const r = sql.rows(`select processed, width, height from public.media where id = ${uuidLit(media)}`);
    if (!r.ok) die(1, `FAIL database: ${r.code} ${r.message}`);
    const m = r.rows[0];
    if (!m) die(1, `FAIL no media row ${media}`);
    if (m.processed === true) { console.log(`PROCESSED: media ${media}, width ${m.width}, height ${m.height}`); break; }
    if (Date.now() > until) die(1, `FAIL media ${media} not processed after 15 minutes`);
    await new Promise(res => setTimeout(res, 15000));
  }
}
console.log(`OK: media ${media}`);
