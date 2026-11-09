// Staging proof of the media bucket limits (work order 16, hardening H0-4, migration 21). Synthetic data only; staging only.
//   STAGING_SUPABASE_REF=... STAGING_DB_URL=... node supabase/tests/e2e-media-limits.mjs     (run only after migration 21 is applied to staging)
// One PASS/FAIL line per check, as owner-a with a real session:
//   - the bucket row: file_size_limit 26214400 and exactly the five types (read over the database);
//   - upload-start for a 1-byte png is 200; then PUT 26214401 bytes to its signed URL is refused (4xx) and no object lands;
//   - upload-start again, PUT a text/html body (declared image/png to upload-start, which only checks what the caller says) is refused and no object lands;
//   - upload-start again, PUT a real small png is accepted (2xx) and the object exists (the limits did not shut the front door);
//   - a direct POST /storage/v1/object/media/<workspace A>/<name>.png with owner-a's own token is refused (no insert policy) and no object lands.
// Cleanup in the `finally`, through the service role: every storage object this run could have made is deleted, and so is every media row upload-start made
// (a refusal of the row delete is an INFO line, never a silent pass). Keys by variable name only: the secret key and the publishable key are read from the
// environment names target.mjs gives, and never printed.
import { resolveTarget } from '../../tools/omnikom-cli/lib/target.mjs';
import { parseIdentity, personToken } from '../../tools/omnikom-cli/lib/identity.mjs';
import { makeSql } from '../../tools/omnikom-cli/lib/sql.mjs';
import { stagingDbUrl } from './e2e-cleanup.mjs';

const WS_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const MAX_BYTES = 26214400;
const FIVE = ['application/pdf', 'image/heic', 'image/jpeg', 'image/png', 'image/webp'];
// a real 1x1 png (67 bytes)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const target = resolveTarget('staging', process.env, { needDb: false });
if (!target.functionsBase) { console.error('BLOCKED: STAGING_SUPABASE_REF is not set (read by name)'); process.exit(3); }
let dbUrl;
try { dbUrl = stagingDbUrl(process.env); } catch (e) { console.error(e.message); process.exit(String(e.message).startsWith('BLOCKED') ? 3 : 2); }
const sql = makeSql({ url: dbUrl, readOnly: true });
const fnBase = target.functionsBase.replace(/\/$/, ''), storage = target.authBase.replace(/\/auth\/v1$/, '/storage/v1'), restBase = target.restBase;
const pub = process.env[target.vars.publishableKey], secret = process.env[target.vars.secretKey] ?? '';
if (!pub || !secret) { console.error('BLOCKED: the publishable or the secret key is not set (read by name)'); process.exit(3); }

let failed = 0;
const line = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : '  ' + String(detail).slice(0, 300)}`); if (!ok) failed++; };
const info = text => console.log(`INFO ${text}`);
const short = r => `${r.status} ${String(r.text).replace(/\s+/g, ' ').slice(0, 160)}`;

const token = await personToken(parseIdentity('owner-a'), { target, env: process.env });
const madePaths = [], madeMedia = [];

async function http(url, init) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(120000) });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text, json };
  } catch (e) { return { status: 0, text: String(e && e.message || e).slice(0, 160), json: null }; }
}
/** upload-start as owner-a; declares what the caller says (1 byte of image/png unless told) and remembers the path and media row for cleanup */
async function uploadStart(filename, bytes = 1, mime = 'image/png') {
  const r = await http(`${fnBase}/upload-start`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, apikey: pub }, body: JSON.stringify({ workspace: WS_A, filename, bytes, mime }) });
  if (r.json?.path) madePaths.push(r.json.path);
  if (r.json?.media) madeMedia.push(r.json.media);
  return r;
}
/** PUT to the signed address the way the dashboard does (multipart, x-upsert); the file part carries the type */
function putSigned(uploadUrl, body, type) {
  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('', new Blob([body], { type }), 'e2e');
  return http(uploadUrl, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: form });
}
const objectsAmong = paths => {
  const list = paths.map(p => `'${String(p).replace(/'/g, "''")}'`).join(',');
  const r = sql.rows(`select name from storage.objects where bucket_id = 'media' and name in (${list || "''"})`);
  return r.ok ? r.rows.map(x => x.name) : null;
};
const refused = r => r.status >= 400 && r.status < 500;

try {
  // the bucket row itself
  const b = sql.rows(`select file_size_limit::text as lim, (select array_agg(t order by t) from unnest(allowed_mime_types) t) as types from storage.buckets where id = 'media'`);
  const row = b.ok ? b.rows[0] : null;
  const types = row ? (Array.isArray(row.types) ? row.types : String(row.types ?? '').replace(/[{}]/g, '').split(',')).filter(Boolean).sort() : null;
  line(!!row && row.lim === String(MAX_BYTES) && JSON.stringify(types) === JSON.stringify(FIVE), 'the media bucket carries file_size_limit 26214400 and exactly the five types', row ? `limit ${row.lim}, types ${JSON.stringify(types)}` : 'bucket row not read');

  // 1 byte declared, then 26214401 bytes sent
  const big = await uploadStart('e2e-big.png');
  line(big.status === 200 && !!big.json?.uploadUrl, 'upload-start for 1 byte of image/png is 200 with a signed upload URL', short(big));
  if (big.json?.uploadUrl) {
    const put = await putSigned(big.json.uploadUrl, new Uint8Array(MAX_BYTES + 1), 'image/png');
    info(`PUT ${MAX_BYTES + 1} bytes: ${short(put)}`);
    line(refused(put), 'a PUT of 26214401 bytes to the signed URL is refused (4xx)', short(put));
    line((objectsAmong([big.json.path]) ?? ['unreadable']).length === 0, 'no object landed from the oversize PUT');
  }

  // a text/html body declared as image/png
  const html = await uploadStart('e2e-html.png');
  line(html.status === 200 && !!html.json?.uploadUrl, 'upload-start (second) is 200 with a signed upload URL', short(html));
  if (html.json?.uploadUrl) {
    const put = await putSigned(html.json.uploadUrl, Buffer.from('<html><script>1</script></html>'), 'text/html');
    info(`PUT text/html: ${short(put)}`);
    line(refused(put), 'a PUT of a text/html body to the signed URL is refused (4xx)', short(put));
    line((objectsAmong([html.json.path]) ?? ['unreadable']).length === 0, 'no object landed from the text/html PUT');
  }

  // a real small png still goes through
  const good = await uploadStart('e2e-good.png', PNG.length);
  line(good.status === 200 && !!good.json?.uploadUrl, 'upload-start for a real small png is 200 with a signed upload URL', short(good));
  if (good.json?.uploadUrl) {
    const put = await putSigned(good.json.uploadUrl, PNG, 'image/png');
    line(put.status >= 200 && put.status < 300, 'a PUT of a real small png to the signed URL is accepted (2xx)', short(put));
    line((objectsAmong([good.json.path]) ?? []).length === 1, 'the small png exists in the bucket');
  }

  // a direct insert with owner-a's own token
  const direct = `${WS_A}/e2e-direct-${Date.now()}.png`;
  madePaths.push(direct);
  const form = new FormData();
  form.append('', new Blob([PNG], { type: 'image/png' }), 'x.png');
  const post = await http(`${storage}/object/media/${direct}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, apikey: pub, 'x-upsert': 'false' }, body: form });
  info(`direct POST: ${short(post)}`);
  line(refused(post), 'a direct POST /storage/v1/object/media/<workspace A>/<name>.png with owner-a\'s token is refused (4xx)', short(post));
  line((objectsAmong([direct]) ?? ['unreadable']).length === 0, 'no object landed from the direct POST');
} catch (e) {
  line(false, 'the run', String(e && e.message || e).slice(0, 200));
} finally {
  // everything this run could have made, through the service role
  const sh = { authorization: `Bearer ${secret}`, apikey: secret };
  for (const p of madePaths) {
    const d = await http(`${storage}/object/media/${p}`, { method: 'DELETE', headers: sh });
    if (d.status >= 300 && d.status !== 404) info(`cleanup: could not delete object ${p}: ${short(d)}`);
  }
  for (const m of madeMedia) {
    const d = await http(`${restBase}/media?id=eq.${m}`, { method: 'DELETE', headers: { ...sh, prefer: 'return=minimal' } });
    if (d.status >= 300) info(`cleanup: media row ${m} stays: ${short(d)}`);
  }
  const left = objectsAmong(madePaths);
  line(left !== null && left.length === 0, 'cleanup: no object of this run remains in the bucket', left === null ? 'unreadable' : left.join(', '));
}
console.log(`\n${failed ? 'FAILED' : 'PASS'}: staging media limits, ${failed} problem(s)`);
process.exit(failed ? 1 : 0);
