// One real run of the build runner's four functions on the STAGING project (slice 4.3; brief factory/briefs/4-3-runner-functions.md item 6).
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node supabase/tests/e2e-export.mjs
// The caller here plays the runner: it signs every call with RUNNER_KEY (read by name, never printed) exactly as factory/runner/lib/sign.mjs
// will (tools/omnikom-cli/lib/sign.mjs is the same function). The job is started on the SQL path (`omnikom publish --as owner-a`, which does
// NOT dispatch to GitHub, so no real runner races this script), and the dashboard side (save, upload-start) uses owner-a's real session token.
// Prints one PASS/FAIL line per check and never a URL, token or key value (a signed URL carries a token). Exits 1 on any FAIL, 3 when a name is
// missing. What it leaves on staging, on purpose: the content VERSION of the saved listing (versions are append-only), ONE job `done` and ONE
// job `failed`, and ONE test media row of workspace A with its original and its three derivatives in Storage (processed, so the export carries
// it). The listing ROW (published by the done job) is soft-deleted again in the finally through service.unpublish (STAGING_DB_URL, read by
// name; e2e-cleanup.mjs), which also clears its published_version.
import { resolveTarget } from '../../tools/omnikom-cli/lib/target.mjs';
import { parseIdentity, personToken } from '../../tools/omnikom-cli/lib/identity.mjs';
import { callFunction } from '../../tools/omnikom-cli/lib/fn.mjs';
import { sign } from '../../tools/omnikom-cli/lib/sign.mjs';
import { main as cli } from '../../tools/omnikom-cli/omnikom.mjs';
import { makeSql } from '../../tools/omnikom-cli/lib/sql.mjs';
import { createCleanup, stagingDbUrl, stagingRemover } from './e2e-cleanup.mjs';

const WS_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const target = resolveTarget('staging', process.env, { needDb: false });
if (!target.functionsBase) { console.error('BLOCKED: STAGING_SUPABASE_REF is not set (read by name)'); process.exit(3); }
const KEY = process.env.RUNNER_KEY;
if (!KEY) { console.error('BLOCKED: RUNNER_KEY is not set (read by name; node tools/mint-site-key.mjs --runner mints it)'); process.exit(3); }
const pubKey = process.env[target.vars.publishableKey];
const base = target.functionsBase.replace(/\/$/, '');
let failed = 0;
const line = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + detail : ''}`); if (!ok) failed++; };
let dbUrl;
try { dbUrl = stagingDbUrl(process.env); } catch (e) { console.error(e.message); process.exit(String(e.message).startsWith('BLOCKED') ? 3 : 2); }
const cleanup = createCleanup({ remove: stagingRemover({ url: dbUrl }), report: line });   // every content row this run creates is removed in the finally (slice 5.2b)

// ---- the runner's calls
async function runner(method, name, { query = '', body = '', key = KEY, t, sendBody = body } = {}) {
  const path = `/${name}${query}`;
  const headers = { 'content-type': 'application/json' };
  if (key) headers['x-runner-signature'] = await sign(key, method, path, body, t);
  try {
    const res = await fetch(base + path, { method, headers, body: method === 'GET' ? undefined : sendBody, signal: AbortSignal.timeout(60000) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* 204 */ }
    return { status: res.status, json, text };
  } catch (e) { return { status: 0, json: null, text: '', error: String(e && e.message || e).slice(0, 120) }; }
}
const getExport = job => runner('GET', 'export-published', { query: `?job=${job}` });
const callback = (obj, o = {}) => runner('POST', 'job-callback', { body: JSON.stringify(obj), ...o });
const brief = r => `${r.status}${r.json && r.json.code ? ' ' + r.json.code : ''}`;

// ---- the dashboard side, as owner-a
const tokens = {};
async function as(person) { return tokens[person] ??= await personToken(parseIdentity(person), { target, env: process.env }); }
async function fn(name, who, body) {
  const token = await as(who);
  return await callFunction({ base: target.functionsBase, name, body: JSON.stringify(body), extraHeaders: { authorization: `Bearer ${token}`, ...(pubKey ? { apikey: pubKey } : {}) } });
}
const cliJson = async argv => { const r = await cli([...argv, '--target', 'staging', '--json']); let j = null; try { j = JSON.parse(r.stdout); } catch { /* reported below */ } return { exit: r.exit, j }; };
const jobGet = async job => { const r = await cliJson(['job', 'get', '--job', job]); return r.j && r.j.data ? r.j.data : (r.j || {}); };
const startJob = async row => { const r = await cliJson(['publish', '--as', 'owner-a', '--site', 'test-demo-a', '--rows', row]); const d = r.j && (r.j.data || r.j); return d && d.job ? { ok: r.exit === 0, job: d.job } : { ok: false, job: null }; };

const WEBP = Uint8Array.from(Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64'));   // a 1 x 1 WebP
const bytesOf = n => { const b = new Uint8Array(WEBP.length + n); b.set(WEBP); return b; };
async function put(url, bytes, type) {
  try { const r = await fetch(url, { method: 'PUT', body: bytes, headers: { 'content-type': type, 'x-upsert': 'true' }, signal: AbortSignal.timeout(60000) }); const t = await r.text(); return { status: r.status, text: t.slice(0, 120) }; }
  catch (e) { return { status: 0, text: String(e && e.message || e).slice(0, 120) }; }
}
async function download(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()) }; }
  catch { return { status: 0, bytes: new Uint8Array() }; }
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

try {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const nobodyJob = '99999999-0000-0000-0000-000000000000';

  // ---- the wall first: nothing is accepted without the runner's signature
  const u = await runner('GET', 'export-published', { query: `?job=${nobodyJob}`, key: '' });   // key '' = no header at all
  line(u.status === 401 && u.json && u.json.code === 'SIGNATURE', 'an unsigned export is 401 SIGNATURE', brief(u));
  const w = await runner('GET', 'export-published', { query: `?job=${nobodyJob}`, key: 'not-the-runner-key' });
  line(w.status === 401, 'an export signed with the wrong key is 401', brief(w));
  const old = await callback({ job: nobodyJob, state: 'gating' }, { t: Math.floor(Date.now() / 1000) - 400 });
  line(old.status === 401, 'a callback signed 400 s ago (a replay) is 401', brief(old));
  const unknown = await getExport(nobodyJob);
  line(unknown.status === 404, 'a signed export of a job that does not exist is 404', brief(unknown));

  // ---- the media path, for real: upload-start -> original in Storage -> media-export -> three derivatives -> callback -> export carries the derivative
  const us = await fn('upload-start', 'owner-a', { workspace: WS_A, filename: 'e2e-4-3.jpg', bytes: 5000, mime: 'image/jpeg' });
  const media = us.json && us.json.media;
  line(us.status === 200 && media, 'upload-start by owner-a is 200 (a test media row of workspace A)', brief(us));
  const original = bytesOf(1000);
  if (media) {
    const up = await put(us.json.uploadUrl, original, 'image/jpeg');
    line(up.status === 200, 'the original upload through its signed upload URL is 200', `${up.status} ${up.status === 200 ? '' : up.text}`.trim());
    const me = await runner('GET', 'media-export', { query: `?media=${media}` });
    const j = me.json || {};
    line(me.status === 200 && j.workspace_id === WS_A && String(j.path).startsWith(`${WS_A}/`) && Object.keys(j.uploads || {}).sort().join() === '1600,2400,800', 'media-export is 200 with the original, a download URL and three upload URLs under workspace A', brief(me));
    const dl = j.url ? await download(j.url) : { status: 0, bytes: new Uint8Array() };
    line(dl.status === 200 && same(dl.bytes, original), 'the signed download URL of the original gives the original bytes', `${dl.status}`);
    const first = j.uploads ? await put(j.uploads['2400'], bytesOf(1), 'image/webp') : { status: 0, text: '' };
    const again = j.uploads ? await put(j.uploads['2400'], bytesOf(2), 'image/webp') : { status: 0, text: '' };   // a rerun of the media job writes the same file again (upsert)
    const s16 = j.uploads ? await put(j.uploads['1600'], bytesOf(3), 'image/webp') : { status: 0, text: '' };
    const s8 = j.uploads ? await put(j.uploads['800'], bytesOf(4), 'image/webp') : { status: 0, text: '' };
    line([first, again, s16, s8].every(r => r.status === 200), 'the three derivatives upload, and the 2400 one can be written twice (upsert through the signed URL)', [first, again, s16, s8].map(r => r.status).join(' '));
    const exif = await runner('POST', 'media-process-callback', { body: JSON.stringify({ media, width: 3000, height: 2000, exifStripped: false, bytes: 5000, sizes: [2400, 1600, 800] }) });
    line(exif.status === 422 && exif.json && exif.json.code === 'I-EXIF', 'media-process-callback with exifStripped false is 422 I-EXIF', brief(exif));
    const ok = await runner('POST', 'media-process-callback', { body: JSON.stringify({ media, width: 3000, height: 2000, exifStripped: true, bytes: 5000, sizes: [2400, 1600, 800], skipped: [] }) });
    line(ok.status === 204, 'media-process-callback with exifStripped true is 204', brief(ok));
    const doc = await runner('POST', 'media-process-callback', { body: JSON.stringify({ media, kind: 'document' }) });
    line(doc.status === 422 && doc.json && doc.json.code === 'I-MEDIA-SIZE', 'media-process-callback for a document is 422 I-MEDIA-SIZE (the data model has no document flag)', brief(doc));
  }

  // ---- a publish job for owner-a's row, started on the SQL path
  // A listing the active contract accepts for PUBLISH: since migration 11 (the publish-ready wall) the database refuses a job for a row that
  // fails the required rules, so a bare { street } listing is refused on the SQL path (slice 4.6). The two references are read from the
  // test site's own rows (read-only SQL, the connection string read by name): the town Alpha and Agent One.
  const sqlRead = makeSql({ url: target.dbUrl, readOnly: true });
  const refOf = (coll, slug) => { const r = sqlRead.rows(`select c.id from public.content_rows c join public.content_versions v on v.row_id = c.id where c.workspace_id = '${WS_A}' and c.collection = '${coll}' and c.deleted_at is null and v.data ->> 'slug' = '${slug}' order by v.n desc limit 1`); return r.ok && r.rows[0] ? r.rows[0].id : null; };
  const area = refOf('areas', 'alpha'), agent = refOf('team', 'agent-one');
  line(!!area && !!agent, 'the test site has its town Alpha and Agent One (references for the listing)', area && agent ? 'found' : 'missing: stage the test site first (sites/test-demo-a/stage.mjs)');
  if (!area || !agent) throw new Error('no references for the listing');
  const tag = stamp.replace(/[^0-9]/g, '');
  const listing = { sample: false, street: `4.3 e2e ${stamp}`, slug: `e2e-${tag}`, address: { street: `4.3 e2e ${stamp}`, city: 'Alpha' }, status: 'active', price: { amount: 450000, currency: 'USD' },
    description: 'A synthetic home saved by the staging export test; it is unpublished by the test site staging script.', area, agent,
    seo: { title: 'E2E test home in Alpha', description: 'A synthetic listing saved by the staging export test, used only to prove the runner export.' } };
  const s = await fn('save', 'owner-a', { workspace: WS_A, collection: 'listings', row: null, data: listing });
  cleanup.track(s.json && s.json.row);   // created by this save (row: null), so it is removed in the finally
  line(s.status === 200 && s.json && s.json.row, 'save by owner-a is 200 (a row to publish)', brief(s));
  if (!(s.json && s.json.row)) throw new Error('no row to publish');
  const j1 = await startJob(s.json.row);
  line(j1.ok && j1.job, 'omnikom publish --as owner-a started a job (SQL path, no dispatch)', j1.job ? 'queued' : 'no job');
  if (!j1.job) throw new Error('no job');

  const e1 = await getExport(j1.job);
  const b = e1.json || {};
  const snap = b.job && b.job.snapshot ? b.job.snapshot : {};
  line(e1.status === 200 && b.schema === 'omnikom-export/1' && snap[s.json.row] === s.json.version, 'GET export is 200, schema omnikom-export/1, and the snapshot pins the row at its saved version', brief(e1));
  const rowsOk = Array.isArray(b.rows) && b.rows.length === Object.keys(snap).length && b.rows.every(r => snap[r.id] === r.version);
  line(rowsOk && b.site && b.site.deploy_target === 'test-site-demo-a', 'rows are exactly the snapshot and the site is test-site-demo-a', `rows ${b.rows && b.rows.length}`);
  const leak = ['bbbbbbbb-0000', 'test-demo-b', 'Demo B', 'test-site-demo-b', 'demo-b.preview'].filter(v => e1.text.includes(v));
  line(e1.status === 200 && leak.length === 0, 'the export holds 0 values of workspace B', leak.length ? `FOUND ${leak.length}` : 'checked 5 B values');
  const mine = (b.media || []).find(m => m.id === media);
  line(Boolean(mine) && String(mine.path).endsWith('-2400.webp') && String(mine.path) !== mine.original_path && mine.original_path === (us.json && us.json.path), 'the test media is in the export at its 2400 derivative path (not its original), original_path is the upload', mine ? mine.path.slice(0, 8) + '...' + mine.path.slice(-18) : 'missing');
  const dd = mine && mine.url ? await download(mine.url) : { status: 0, bytes: new Uint8Array() };
  line(dd.status === 200 && same(dd.bytes, bytesOf(2)) && !same(dd.bytes, original), 'the export url gives the DERIVATIVE bytes (the second write), not the original', `${dd.status}`);
  line((b.media || []).every(m => m.processed === true), 'every exported media row is processed', `${(b.media || []).length} rows`);

  const e2 = await getExport(j1.job);
  line(e2.status === 200 && JSON.stringify(e2.json && e2.json.job.snapshot) === JSON.stringify(snap) && JSON.stringify(e2.json && e2.json.rows) === JSON.stringify(b.rows), 'a second GET export answers the same snapshot and rows', brief(e2));

  const g = await callback({ job: j1.job, state: 'gating' });
  const d = await callback({ job: j1.job, state: 'deploying' });
  const done = await callback({ job: j1.job, state: 'done', deployId: 'e2e-4-3', gateReport: { factory: 'pass', audit: { exit: 0, fails: [] }, note: 'slice 4.3 e2e' } });
  line(g.status === 204 && d.status === 204 && done.status === 204, 'callbacks gating, deploying, done are 204, 204, 204', [g, d, done].map(r => r.status).join(', '));
  const bad = await callback({ job: j1.job, state: 'gating' });
  line(bad.status === 409 && bad.json && bad.json.code === 'S-JOB-STATE', 'a callback after done is 409 S-JOB-STATE', brief(bad));
  const g1 = await jobGet(j1.job);
  const ev1 = (g1.events || []).map(e => e.state);
  line(g1.job && g1.job.state === 'done' && ev1.join() === 'queued,building,gating,deploying,done', 'omnikom job get shows done with 5 events', `state ${g1.job && g1.job.state}; events ${ev1.join(' > ')}`);
  console.log(`INFO done job ${j1.job}`);

  // ---- one more job, ended failed, so both terminal states exist on staging
  const j2 = await startJob(s.json.row);
  line(j2.ok && j2.job, 'a second job was started', j2.job ? 'queued' : 'no job');
  if (j2.job) {
    // a photo narrower than 800 px: the runner reports width 400 with sizes [800]; the export then serves the always-present 800 slot
    if (media) {
      const narrow = await runner('POST', 'media-process-callback', { body: JSON.stringify({ media, width: 400, height: 300, exifStripped: true, bytes: 5000, sizes: [800], skipped: [2400, 1600] }) });
      line(narrow.status === 204, 'media-process-callback for a 400 px photo with sizes [800] is 204', brief(narrow));
    }
    const x2 = await getExport(j2.job);
    line(x2.status === 200, 'the second job exports (the first is done, so the site is free)', brief(x2));
    const nm = media && x2.json ? (x2.json.media || []).find(m => m.id === media) : null;
    const nd = nm && nm.url ? await download(nm.url) : { status: 0, bytes: new Uint8Array() };
    line(Boolean(nm) && String(nm.path).endsWith('-800.webp') && nd.status === 200 && same(nd.bytes, bytesOf(4)), 'the 400 px photo is exported at the 800 slot and its url gives the 800 derivative', nm ? nm.path.slice(-12) : 'missing');
    const f = await callback({ job: j2.job, state: 'failed', error: 'test', gateReport: { reason: 'test' } });
    line(f.status === 204, 'a failed callback with { reason: test } is 204', brief(f));
    const g2 = await jobGet(j2.job);
    line(g2.job && g2.job.state === 'failed' && g2.job.error === 'test' && g2.job.gate_report && g2.job.gate_report.reason === 'test', 'omnikom job get shows failed, error test, report { reason: test }', `state ${g2.job && g2.job.state}; events ${(g2.events || []).map(e => e.state).join(' > ')}`);
    console.log(`INFO failed job ${j2.job}`);
  }
} catch (e) {
  line(false, 'the run', String(e && e.message || e).slice(0, 200));
} finally {
  await cleanup.run();
}
console.log(`\n${failed ? 'FAILED' : 'PASS'}: staging end to end for the runner functions, ${failed} problem(s)`);
process.exit(failed ? 1 : 0);
