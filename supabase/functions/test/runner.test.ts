// The four functions the build runner calls (slice 4.3): export-published, job-callback, media-export, media-process-callback.
// The runner holds RUNNER_KEY and signs every call (X-Runner-Signature); there is no user login, so the signature is the whole wall and every
// function is tried unsigned, with the wrong key, with a stale time and with a signature made for another call. The database walls (state
// machine, snapshot, tenancy) are tested in supabase/tests/tenancy.test.sql; these tests prove the functions use them and map them to the
// right answer, and that nothing of another workspace and no original upload (GPS data) reaches the runner.
import { handle as exportPublished } from '../export-published/index.ts';
import { handle as jobCallback } from '../job-callback/index.ts';
import { handle as mediaExport } from '../media-export/index.ts';
import { handle as mediaProcessed } from '../media-process-callback/index.ts';
import { handle as manage } from '../media-manage/index.ts';
import { derivativeSlot } from '../_shared/storage.ts';
import { assert, eq, call, env, fake, mkMedia, SITE_B, SUB, teamRows, t, WS_A, WS_B, withSql } from './util.ts';
import { callRunner, jobState, publishedVersion, runnerEvents, startJob, storageBehaviour, storageLog, type RunnerOpts } from './runner-util.ts';

type J = Record<string, any>; // deno-lint-ignore-line no-explicit-any
const exportOf = (job: string, o: RunnerOpts = {}) => callRunner(exportPublished, 'export-published', { query: `?job=${job}`, ...o });
const callback = (body: unknown, o: RunnerOpts = {}) => callRunner(jobCallback, 'job-callback', { method: 'POST', body, ...o });
const mexport = (media: string, o: RunnerOpts = {}) => callRunner(mediaExport, 'media-export', { query: `?media=${media}`, ...o });
const mprocessed = (body: unknown, o: RunnerOpts = {}) => callRunner(mediaProcessed, 'media-process-callback', { method: 'POST', body, ...o });
const NOBODY = '99999999-0000-0000-0000-000000000000';
const mediaPath = async (id: string) => await withSql(async sql => (await sql`select path from public.media where id = ${id}::uuid`)[0].path as string);
const failJob = async (job: string) => eq((await callback({ job, state: 'failed', error: 'test cleanup', gateReport: { reason: 'test cleanup' } })).status, 204, 'cleanup: failed callback');

// ---------------------------------------------------------------- export-published

t('export-published: unsigned is 401 SIGNATURE and one security event of the runner kind is recorded', async () => {
  const team = await teamRows();
  const job = await startJob([team.two], [1]);
  const before = await runnerEvents('export-published');
  const r = await exportOf(job, { unsigned: true });
  eq(r.status, 401, 'status: ' + r.text); eq(r.json?.code, 'SIGNATURE', 'code');
  eq(await runnerEvents('export-published'), before + 1, 'one security event (kind bad-signature, detail kind runner)');
  eq((await jobState(job)).state, 'queued', 'nothing was frozen or moved');
});

t('export-published: signed with the wrong key, with a stale time, for another job, or over a non-empty body is 401', async () => {
  const team = await teamRows();
  const job = await startJob([team.two], [1]);
  const other = await startJob([team.one], [1]);
  const now = Math.floor(Date.now() / 1000);
  eq((await exportOf(job, { key: 'not-the-runner-key' })).status, 401, 'wrong key');
  eq((await exportOf(job, { t: now - 400 })).status, 401, 'a signature older than 300 s');
  eq((await exportOf(job, { t: now + 400 })).status, 401, 'a signature from the future');
  eq((await exportOf(job, { signedPath: `/export-published?job=${other}` })).status, 401, 'a signature made for another job');
  eq((await exportOf(job, { signedBody: 'x' })).status, 401, 'a GET signs an empty body: a signature over text is not accepted');
  eq((await exportOf(job, { header: 'v1=abc' })).status, 401, 'a header that is not t=..,v1=..');
  eq((await jobState(job)).state, 'queued', 'nothing was frozen or moved');
  assert((await callRunner(exportPublished, 'export-published', { method: 'POST', query: `?job=${job}` })).status === 405, 'POST is 405');
});

t('export-published: a malformed or missing job id is 404, and a job that does not exist is 404', async () => {
  eq((await exportOf('not-a-uuid')).status, 404, 'malformed');
  eq((await callRunner(exportPublished, 'export-published')).status, 404, 'missing');
  const r = await exportOf(NOBODY);
  eq(r.status, 404, 'unknown: ' + r.text); eq(r.json?.code, 'S-NOT-FOUND', 'code');
});

t('export-published: A\'s job is 200 with the snapshot, A\'s site, signed 2400 px derivatives, and nothing of workspace B or of an unprocessed or original file', async () => {
  await fake.reset();
  const team = await teamRows();
  const done = await mkMedia(WS_A, { width: 3000, processed: true, exif: true, rights: true });
  const raw = await mkMedia(WS_A, { width: 3000, processed: false });
  const bMedia = await mkMedia(WS_B, { width: 3000, processed: true, exif: true, rights: true });
  await withSql(sql => sql`insert into public.leads (workspace_id, site_id, form, page_path, name, consent_text) values (${WS_B}::uuid, ${SITE_B}::uuid, 'contact', '/contact', 'Canary Lead Of B', 'agree')`);
  const job = await startJob([team.two], [1]);
  const r = await exportOf(job);
  eq(r.status, 200, 'status: ' + r.text);
  const b = r.json as J;
  eq(b.schema, 'omnikom-export/1', 'schema'); eq(b.job.id, job, 'job id'); eq(b.site.deploy_target, 'test-site-demo-a', 'the deploy target');
  assert(b.job.snapshot && b.job.snapshot[team.two] === 1, 'the snapshot is present and pins the row at version 1');
  eq(JSON.stringify(b.rows.map((x: J) => [x.id, x.version]).sort()), JSON.stringify(Object.entries(b.job.snapshot).sort()), 'rows are exactly the snapshot');
  // media: processed only, the derivative, a signed URL for THAT path, nothing of B
  const ids = b.media.map((m: J) => m.id);
  assert(ids.includes(done), 'the processed media of A is exported');
  assert(!ids.includes(raw), 'an unprocessed media row is not exported');
  assert(!ids.includes(bMedia), 'a media row of workspace B is not exported');
  const own = b.media.find((m: J) => m.id === done);
  const orig = await mediaPath(done);
  eq(own.original_path, orig, 'original_path is the upload (information only)');
  eq(own.path, orig.replace(/\.[^./]+$/, '') + '-2400.webp', 'path is the 2400 derivative');
  assert(String(own.path).endsWith('-2400.webp') && !String(own.path).endsWith('.jpg'), 'the exported path ends in -2400.webp, never the original');
  assert(typeof own.url === 'string' && own.url.includes(`/storage/v1/object/sign/media/${own.path}?token=`), 'url is signed for the derivative path: ' + own.url);
  assert(!b.media.some((m: J) => m.url && m.url.includes(m.original_path)), 'no URL points at an original upload');
  assert(!('error' in own), 'no error on a file that signed');
  const log = await storageLog();
  assert(log.signed.some(s => s.path === own.path && s.authorized && s.expiresIn === 3600), 'Storage was asked to sign THAT path for 1 hour with the secret key');
  assert(!log.signed.some(s => s.path === orig), 'the original upload was never signed');
  // nothing of workspace B anywhere in the answer
  const bv = await withSql(async sql => {
    const [w] = await sql`select slug, name from public.workspaces where id = ${WS_B}::uuid`;
    const [s] = await sql`select deploy_target, preview_host from public.sites where id = ${SITE_B}::uuid`;
    const u = await sql`select email from auth.users where id = ${SUB['owner-b']}::uuid`;
    const rows = await sql`select id from public.content_rows where workspace_id = ${WS_B}::uuid`;
    const m = await sql`select id, path from public.media where workspace_id = ${WS_B}::uuid`;
    return [WS_B, SITE_B, 'bbbbbbbb-0000', w.slug, w.name, s.deploy_target, s.preview_host, 'Canary Lead Of B', ...u.map((x: J) => x.email), ...rows.map((x: J) => x.id), ...m.flatMap((x: J) => [x.id, x.path])] as string[];
  });
  assert(bv.length >= 10, 'the list of B values is real: ' + bv.length);
  for (const v of bv) assert(!r.text.includes(v), `a value of workspace B is in the export: ${v}`);
  eq((await jobState(job)).state, 'building', 'the first export moved the job to building');
  await failJob(job);
});

t('export-published: a second export of the same job answers the same snapshot and rows, and the state is still building with no second event', async () => {
  const team = await teamRows();
  const job = await startJob([team.two], [1]);
  const a = await exportOf(job), b = await exportOf(job);
  eq(a.status, 200, 'first'); eq(b.status, 200, 'second');
  eq(JSON.stringify((a.json as J).job.snapshot), JSON.stringify((b.json as J).job.snapshot), 'the same snapshot');
  eq(JSON.stringify((a.json as J).rows), JSON.stringify((b.json as J).rows), 'the same rows');
  const s = await jobState(job);
  eq(s.state, 'building', 'still building'); eq(s.events.join(), 'queued,building', 'one building event, not two');
  await failJob(job);
});

t('export-published: a job whose site has another running build is 409 S-JOB-BUSY; once the first finishes the same call is 200', async () => {
  const team = await teamRows();
  const first = await startJob([team.two], [1]), second = await startJob([team.one], [1]);
  eq((await exportOf(first)).status, 200, 'the first build starts');
  const busy = await exportOf(second);
  eq(busy.status, 409, 'status: ' + busy.text); eq(busy.json?.code, 'S-JOB-BUSY', 'code');
  const s = await jobState(second);
  eq(s.state, 'queued', 'the waiting job stays queued'); eq(s.events.join(), 'queued', 'no event');
  await failJob(first);
  eq((await exportOf(second)).status, 200, 'the queue retries and now it runs');
  await failJob(second);
});

t('export-published: a signing failure for one file gives that file url null and error "sign failed"; the others still carry a URL; the call is 200', async () => {
  await fake.reset();
  const team = await teamRows();
  const bad = await mkMedia(WS_A, { width: 3000, processed: true, exif: true }), good = await mkMedia(WS_A, { width: 3000, processed: true, exif: true });
  const badPath = (await mediaPath(bad)).replace(/\.[^./]+$/, '') + '-2400.webp';
  await storageBehaviour(badPath, 0);
  const job = await startJob([team.two], [1]);
  try {
    const r = await exportOf(job);
    eq(r.status, 200, 'status: ' + r.text);
    const m = (r.json as J).media;
    const x = m.find((e: J) => e.id === bad), y = m.find((e: J) => e.id === good);
    eq(x.url, null, 'the failed file has no url'); eq(x.error, 'sign failed', 'and says why');
    assert(typeof y.url === 'string' && y.url.length > 10 && !('error' in y), 'the good file is signed');
  } finally { await fake.reset(); await failJob(job); }
});

t('export-published: at most 8 files are signed at the same time', async () => {
  await fake.reset();
  const team = await teamRows();
  const made: string[] = [];
  for (let i = 0; i < 20; i++) made.push(await mkMedia(WS_A, { width: 3000, processed: true, exif: true }));
  await storageBehaviour('', 60);
  const job = await startJob([team.two], [1]);
  try {
    const r = await exportOf(job);
    eq(r.status, 200, 'status: ' + r.text);
    const m = (r.json as J).media as J[];
    assert(made.every(id => m.some(e => e.id === id && e.url)), 'all 20 files got a URL');
    const log = await storageLog();
    assert(log.maxInflight <= 8, `at most 8 signings at once, saw ${log.maxInflight}`);
    assert(log.maxInflight >= 2, `the signings do run in parallel, saw ${log.maxInflight}`);
  } finally {
    await fake.reset(); await failJob(job);
    await withSql(sql => sql`delete from public.media where id = any(${made}::uuid[])`);
  }
});

t('export-published: a function without RUNNER_KEY accepts nobody (500 CONFIG), signed or not', async () => {
  const key = Deno.env.get('RUNNER_KEY');
  Deno.env.delete('RUNNER_KEY');
  try {
    const team = await teamRows();
    const job = await startJob([team.two], [1]);
    const r = await callRunner(exportPublished, 'export-published', { query: `?job=${job}`, key: 'anything' });
    eq(r.status, 500, 'status: ' + r.text); eq(r.json?.code, 'CONFIG', 'code');
    eq((await jobState(job)).state, 'queued', 'nothing moved');
  } finally { if (key) Deno.env.set('RUNNER_KEY', key); }
});

t('runner key: a signed call touches the registry row of the key (last_used_at); a bad signature does not', async () => {
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env('RUNNER_KEY')))), b => b.toString(16).padStart(2, '0')).join('');
  await withSql(sql => sql`insert into public.api_keys (kind, label, key_hash) values ('runner', 'test runner key', ${hash})`);
  const used = async () => await withSql(async sql => (await sql`select last_used_at from public.api_keys where key_hash = ${hash}`)[0].last_used_at as Date | null);
  eq(await used(), null, 'never used yet');
  await exportOf(NOBODY, { key: 'wrong' });
  eq(await used(), null, 'a bad signature does not touch it');
  eq((await exportOf(NOBODY)).status, 404, 'a signed call for a job that is not there is still an accepted call');
  assert((await used()) !== null, 'the signed call set last_used_at');
});

// ---------------------------------------------------------------- job-callback

t('job-callback: building -> gating -> deploying -> done is 204 each, then the job\'s row is live at its snapshot version; the report and deploy id are stored as they were sent', async () => {
  const team = await teamRows();
  const job = await startJob([team.one], [1]);
  eq(await publishedVersion(team.one), null, 'not live before');
  eq((await exportOf(job)).status, 200, 'export moves the job to building');
  const report = { factory: 'pass', audit: { exit: 0, fails: [] } };
  eq((await callback({ job, state: 'gating' })).status, 204, 'gating');
  eq((await callback({ job, state: 'deploying' }, { prefix: '/functions/v1' })).status, 204, 'deploying (the gateway prefix is not signed)');
  eq(await publishedVersion(team.one), null, 'not live while deploying');
  const d = await callback({ job, state: 'done', deployId: 'abc123', gateReport: report });
  eq(d.status, 204, 'done: ' + d.text);
  eq(await publishedVersion(team.one), 1, 'live at the snapshot version');
  const s = await jobState(job);
  eq(s.state, 'done', 'state'); eq(s.events.join(), 'queued,building,gating,deploying,done', 'one event per state'); eq(s.deploy, 'abc123', 'deploy id');
  eq((s.gate as J).factory, 'pass', 'the gate report is an object, not a JSON string'); eq(typeof s.gate, 'object', 'jsonb object');
});

t('job-callback: done straight from queued is 409 S-JOB-STATE; queued, an unknown state and a done after failed are refused', async () => {
  const team = await teamRows();
  const job = await startJob([team.two], [1]);
  const r = await callback({ job, state: 'done' });
  eq(r.status, 409, 'status: ' + r.text); eq(r.json?.code, 'S-JOB-STATE', 'code');
  eq((await callback({ job, state: 'queued' })).status, 400, 'queued is not a state the runner reports');
  eq((await callback({ job, state: 'bogus' })).status, 400, 'an unknown state');
  eq((await jobState(job)).state, 'queued', 'unchanged');
  eq((await callback({ job, state: 'failed', error: 'gave up' })).status, 204, 'failed from queued is allowed');
  const again = await callback({ job, state: 'done' });
  eq(again.status, 409, 'a failed job is not done afterwards'); eq(again.json?.code, 'S-JOB-STATE', 'code');
});

t('job-callback: failed from gating records the report and the error and leaves published_version where it was', async () => {
  const team = await teamRows();
  const before = await publishedVersion(team.two);
  const job = await startJob([team.two], [1]);
  eq((await exportOf(job)).status, 200, 'export');
  eq((await callback({ job, state: 'gating' })).status, 204, 'gating');
  const f = await callback({ job, state: 'failed', error: 'audit failed', gateReport: { reason: 'test', audit: { exit: 1, fails: ['FAIL MET-003'] } } });
  eq(f.status, 204, 'failed: ' + f.text);
  const s = await jobState(job);
  eq(s.state, 'failed', 'state'); eq(s.error, 'audit failed', 'error'); eq((s.gate as J).reason, 'test', 'gate report');
  eq(await publishedVersion(team.two), before, 'published_version did not move');
});

t('job-callback: unsigned, wrong key, a signature over another body, and a stale or future time are 401 and leave the job alone', async () => {
  const team = await teamRows();
  const job = await startJob([team.two], [1]);
  const before = await runnerEvents('job-callback');
  const now = Math.floor(Date.now() / 1000);
  eq((await callback({ job, state: 'failed' }, { unsigned: true })).status, 401, 'unsigned');
  eq((await callback({ job, state: 'failed' }, { key: 'not-the-runner-key' })).status, 401, 'wrong key');
  eq((await callback({ job, state: 'failed' }, { signedBody: JSON.stringify({ job, state: 'gating' }) })).status, 401, 'a signature over another body');
  eq((await callback({ job, state: 'failed' }, { t: now - 400 })).status, 401, 'a replay older than 300 s');
  eq((await callback({ job, state: 'failed' }, { t: now + 400 })).status, 401, 'a time in the future');
  eq((await callback({ job, state: 'failed' }, { signedPath: '/export-published' })).status, 401, 'a signature made for another path');
  eq(await runnerEvents('job-callback'), before + 6, 'six security events');
  eq((await jobState(job)).state, 'queued', 'the job was not touched');
  eq((await callRunner(jobCallback, 'job-callback', { method: 'GET', query: `?job=${job}` })).status, 405, 'GET is 405');
});

t('job-callback: a body that is not a valid callback is 400 (not JSON, no job, a bad id, a bad state type, a report that is text); an unknown job is 404', async () => {
  const team = await teamRows();
  const job = await startJob([team.two], [1]);
  eq((await callRunner(jobCallback, 'job-callback', { method: 'POST', raw: 'not json' })).status, 400, 'not JSON');
  eq((await callRunner(jobCallback, 'job-callback', { method: 'POST', raw: '[1]' })).status, 400, 'not an object');
  eq((await callback({ state: 'gating' })).status, 400, 'no job');
  eq((await callback({ job: 'nope', state: 'gating' })).status, 400, 'bad job id');
  eq((await callback({ job, state: 7 })).status, 400, 'state not text');
  eq((await callback({ job, state: 'gating', gateReport: 'text' })).status, 400, 'a report that is text');
  eq((await callback({ job, state: 'failed', error: 'x'.repeat(2001) })).status, 400, 'a long error');
  const missing = await callback({ job: NOBODY, state: 'gating' });
  eq(missing.status, 404, 'unknown job: ' + missing.text); eq(missing.json?.code, 'S-NOT-FOUND', 'code');
  eq((await jobState(job)).state, 'queued', 'the job was not touched');
});

t('job-callback: a gate report over 64 KiB is 413 and not stored; one just under is stored', async () => {
  const team = await teamRows();
  const job = await startJob([team.two], [1]);
  eq((await exportOf(job)).status, 200, 'export');
  const big = await callback({ job, state: 'failed', gateReport: { blob: 'x'.repeat(64 * 1024 + 1) } });
  eq(big.status, 413, 'over: ' + big.text.slice(0, 120));
  eq((await jobState(job)).state, 'building', 'nothing was recorded');
  const ok = await callback({ job, state: 'failed', gateReport: { blob: 'x'.repeat(60 * 1024) } });
  eq(ok.status, 204, 'just under: ' + ok.text.slice(0, 120));
  eq((await jobState(job)).state, 'failed', 'recorded');
});

t('job-callback: a body over 256 KiB is 413 before anything is checked', async () => {
  const r = await callRunner(jobCallback, 'job-callback', { method: 'POST', raw: JSON.stringify({ job: NOBODY, state: 'gating', pad: 'x'.repeat(300 * 1024) }) });
  eq(r.status, 413, 'status: ' + r.text.slice(0, 120));
});

t('job-callback: a function without RUNNER_KEY accepts nobody (500 CONFIG)', async () => {
  const key = Deno.env.get('RUNNER_KEY');
  Deno.env.delete('RUNNER_KEY');
  try {
    const r = await callRunner(jobCallback, 'job-callback', { method: 'POST', body: { job: NOBODY, state: 'gating' }, key: 'anything' });
    eq(r.status, 500, 'status: ' + r.text); eq(r.json?.code, 'CONFIG', 'code');
  } finally { if (key) Deno.env.set('RUNNER_KEY', key); }
});

// ---------------------------------------------------------------- media-export

t('media-export: A\'s file is 200 with a signed download URL for the original and three signed upload URLs for the webp sizes, all under A\'s folder', async () => {
  await fake.reset();
  const id = await mkMedia(WS_A, { width: null });
  const orig = await mediaPath(id);
  const r = await mexport(id);
  eq(r.status, 200, 'status: ' + r.text);
  const b = r.json as J;
  eq(b.id, id, 'id'); eq(b.workspace_id, WS_A, 'workspace'); eq(b.path, orig, 'path'); eq(b.processed, false, 'processed');
  assert(String(b.url).includes(`/storage/v1/object/sign/media/${orig}?token=`), 'a signed download URL for the original: ' + b.url);
  eq(Object.keys(b.uploads).sort().join(), '1600,2400,800', 'the three sizes');
  const base = orig.replace(/\.[^./]+$/, '');
  for (const w of [2400, 1600, 800]) {
    assert(String(b.uploads[String(w)]).includes(`/storage/v1/object/upload/sign/media/${base}-${w}.webp?token=`), `upload URL for ${w}: ${b.uploads[String(w)]}`);
    assert(`${base}-${w}.webp`.startsWith(`${WS_A}/`), 'the derivative stays in the workspace folder');
  }
  const log = await storageLog();
  eq(log.storage.filter(s => s.authorized && s.upsert === 'true').length, 3, 'the three upload signings were asked with upsert and the secret key');
  assert(log.signed.some(s => s.path === orig && s.authorized && s.expiresIn === 3600), 'the download was signed for 1 hour');
});

t('media-export: unsigned, wrong key, a stale time is 401; a malformed or unknown id is 404; the gateway prefix works; a file Storage will not sign is 502', async () => {
  const id = await mkMedia(WS_A, { width: null });
  const before = await runnerEvents('media-export');
  eq((await mexport(id, { unsigned: true })).status, 401, 'unsigned');
  eq((await mexport(id, { key: 'not-the-runner-key' })).status, 401, 'wrong key');
  eq((await mexport(id, { t: Math.floor(Date.now() / 1000) - 400 })).status, 401, 'stale');
  eq((await mexport(id, { signedPath: `/media-export?media=${NOBODY}` })).status, 401, 'a signature made for another file');
  eq(await runnerEvents('media-export'), before + 4, 'four security events');
  eq((await mexport('nope')).status, 404, 'malformed');
  const unknown = await mexport(NOBODY);
  eq(unknown.status, 404, 'unknown: ' + unknown.text); eq(unknown.json?.code, 'S-NOT-FOUND', 'code');
  eq((await mexport(id, { prefix: '/functions/v1' })).status, 200, 'with /functions/v1 in front');
  await fake.reset();
  await storageBehaviour((await mediaPath(id)).replace(/\.[^./]+$/, '') + '-1600', 0);
  const down = await mexport(id);
  eq(down.status, 502, 'storage would not sign one upload: ' + down.text); eq(down.json?.code, 'STORAGE', 'code');
  await fake.reset();
});

// ---------------------------------------------------------------- media-process-callback

t('media-process-callback: exifStripped false (or missing) is 422 I-EXIF and the file stays unprocessed; true is 204 and the facts are stored', async () => {
  const id = await mkMedia(WS_A, { width: null });
  const state = async () => await withSql(async sql => (await sql`select processed, width, height, bytes, exif_stripped from public.media where id = ${id}::uuid`)[0] as J);
  const no = await mprocessed({ media: id, width: 2400, height: 1600, exifStripped: false, bytes: 50000, sizes: [2400, 1600, 800] });
  eq(no.status, 422, 'false: ' + no.text); eq(no.json?.code, 'I-EXIF', 'code');
  eq((await mprocessed({ media: id, width: 2400, height: 1600, bytes: 50000 })).status, 422, 'missing exifStripped');
  eq((await mprocessed({ media: id, width: 2400, height: 1600, exifStripped: 'true', bytes: 50000 })).status, 422, 'the text "true" is not the boolean');
  const s0 = await state();
  eq(s0.processed, false, 'processed stays false'); eq(s0.exif_stripped, false, 'exif_stripped stays false');
  const ok = await mprocessed({ media: id, width: 2400, height: 1600, exifStripped: true, bytes: 51234, sizes: [2400, 1600, 800], skipped: [] });
  eq(ok.status, 204, 'true: ' + ok.text);
  const s1 = await state();
  eq(s1.processed, true, 'processed'); eq(s1.width, 2400, 'width'); eq(s1.height, 1600, 'height'); eq(s1.exif_stripped, true, 'exif_stripped'); eq(s1.bytes, 51234, 'bytes');
  eq((await mprocessed({ media: id, width: 1200, height: 800, exifStripped: true, bytes: 900, sizes: [800], skipped: [2400, 1600] })).status, 204, 'a narrower original: skipped sizes are accepted');
});

t('media-process-callback: a document, a width below 1, a bad body is refused and nothing changes; an unknown file is 404', async () => {
  const id = await mkMedia(WS_A, { width: null });
  const state = async () => await withSql(async sql => (await sql`select processed, width from public.media where id = ${id}::uuid`)[0] as J);
  const doc = await mprocessed({ media: id, kind: 'document' });
  eq(doc.status, 422, 'document: ' + doc.text); eq(doc.json?.code, 'I-MEDIA-SIZE', 'code');
  const zero = await mprocessed({ media: id, width: 0, height: 0, exifStripped: true, bytes: 10 });
  eq(zero.status, 422, 'zero width: ' + zero.text); eq(zero.json?.code, 'I-MEDIA-SIZE', 'code');
  eq((await mprocessed({ media: id, width: 100.5, height: 10, exifStripped: true })).status, 400, 'a width that is not whole');
  eq((await mprocessed({ media: id, width: 100, height: 10, exifStripped: true, bytes: -1 })).status, 400, 'negative bytes');
  eq((await mprocessed({ media: id, width: 100, height: 10, exifStripped: true, sizes: 'big' })).status, 400, 'sizes that is not a list');
  eq((await mprocessed({ media: 'nope', width: 100, height: 10, exifStripped: true })).status, 400, 'a bad media id');
  eq((await mprocessed({ width: 100, height: 10, exifStripped: true })).status, 400, 'no media');
  const s = await state();
  eq(s.processed, false, 'still unprocessed'); eq(s.width, null, 'no width');
  const unknown = await mprocessed({ media: NOBODY, width: 100, height: 10, exifStripped: true, bytes: 5 });
  eq(unknown.status, 404, 'unknown: ' + unknown.text); eq(unknown.json?.code, 'S-NOT-FOUND', 'code');
});

t('media-process-callback: unsigned, wrong key, a signature over another body and a stale time are 401 and change nothing', async () => {
  const id = await mkMedia(WS_A, { width: null });
  const body = { media: id, width: 2400, height: 1600, exifStripped: true, bytes: 1 };
  const before = await runnerEvents('media-process-callback');
  eq((await mprocessed(body, { unsigned: true })).status, 401, 'unsigned');
  eq((await mprocessed(body, { key: 'not-the-runner-key' })).status, 401, 'wrong key');
  eq((await mprocessed(body, { signedBody: JSON.stringify({ ...body, width: 1 }) })).status, 401, 'another body');
  eq((await mprocessed(body, { t: Math.floor(Date.now() / 1000) - 400 })).status, 401, 'stale');
  eq(await runnerEvents('media-process-callback'), before + 4, 'four security events');
  eq(await withSql(async sql => (await sql`select processed from public.media where id = ${id}::uuid`)[0].processed), false, 'nothing changed');
  eq((await callRunner(mediaProcessed, 'media-process-callback', { method: 'GET' })).status, 405, 'GET is 405');
});

t('media-process-callback: a file deleted while its job made the sizes is 404 and its sizes are removed (B25)', async () => {
  const body = (media: string) => ({ media, width: 2400, height: 1600, exifStripped: true, bytes: 5, sizes: [800] });
  const live = await mkMedia(WS_A, { width: null }), gone = await mkMedia(WS_A, { width: null });
  await fake.reset(); await mexport(gone);
  const wrote = (await storageLog()).storage.map(s => s.path).sort();   // what the job's 3 upload URLs let it write
  eq(wrote.length, 3, 'the job may write three sizes');
  eq((await call(manage, 'media-manage', { media: gone, action: 'delete' }, 'owner-a')).status, 200, 'deleted');
  await fake.reset();   // the delete's own Storage call is not what is measured
  const r = await mprocessed(body(gone)), removed = (await fake.recorded()).removed;
  eq(r.status, 404, 'the job reports after the delete: ' + r.text); eq(r.json?.code, 'S-NOT-FOUND', 'the old answer');
  eq(removed.length, 1, 'Storage is asked once'); eq(removed[0]?.authorized, true, 'with the secret key');
  eq(JSON.stringify([...(removed[0]?.prefixes ?? [])].sort()), JSON.stringify(wrote), 'the three sizes, no more');
  await fake.reset(); await fake.removeStatus(500);
  const refused = await mprocessed(body(gone));
  eq(refused.status, 502, 'Storage refuses: ' + refused.text); eq(refused.json?.code, 'STORAGE', 'the runner asks again');
  await fake.reset();
  eq((await mprocessed(body(live))).status, 204, 'a file with its record is processed');
  eq((await mprocessed(body(NOBODY))).status, 404, 'a file that never existed is 404');
  eq((await fake.recorded()).removed.length, 0, 'for neither is Storage asked to remove anything');
});

// ---------------------------------------------------------------- the derivative slot (2400, 1600, 800; the 800 slot always exists)

t('derivativeSlot: the widest slot that exists, at every boundary (2400, 2399, 1600, 1599, 800, 799, 400, 200)', () => {
  const want: [number, number][] = [[3000, 2400], [2400, 2400], [2399, 1600], [1600, 1600], [1599, 800], [800, 800], [799, 800], [400, 800], [200, 800], [1, 800]];
  for (const [w, slot] of want) eq(derivativeSlot(w), slot, `width ${w}`);
  eq(derivativeSlot(null), 800, 'no width'); eq(derivativeSlot(undefined), 800, 'undefined width');
});

t('export-published: each processed photo is exported at the widest slot its width allows (2400, 1600, or the always-present 800)', async () => {
  const team = await teamRows();
  const cases: [number, number][] = [[2400, 2400], [2399, 1600], [1600, 1600], [1599, 800], [800, 800], [799, 800], [400, 800], [200, 800]];
  const made: [string, number][] = [];
  for (const [w, slot] of cases) made.push([await mkMedia(WS_A, { width: w, processed: true, exif: true, rights: true }), slot]);
  const job = await startJob([team.two], [1]);
  try {
    const r = await exportOf(job);
    eq(r.status, 200, 'status: ' + r.text);
    for (const [id, slot] of made) {
      const m = ((r.json as J).media as J[]).find(x => x.id === id);
      const orig = await mediaPath(id);
      assert(m, 'the photo is exported');
      eq(m.path, orig.replace(/\.[^./]+$/, '') + `-${slot}.webp`, `path for a ${m.width} px original`);
      assert(String(m.url).includes(`/object/sign/media/${m.path}?token=`), 'url is signed for that slot: ' + m.url);
    }
  } finally {
    await failJob(job);
    await withSql(sql => sql`delete from public.media where id = any(${made.map(x => x[0])}::uuid[])`);
  }
});

t('media-process-callback: a photo narrower than 800 px is accepted with sizes [800] (any width of at least 1)', async () => {
  const id = await mkMedia(WS_A, { width: null });
  const r = await mprocessed({ media: id, width: 400, height: 300, exifStripped: true, bytes: 9000, sizes: [800], skipped: [2400, 1600] });
  eq(r.status, 204, 'status: ' + r.text);
  const row = await withSql(async sql => (await sql`select processed, width, height from public.media where id = ${id}::uuid`)[0] as J);
  eq(row.processed, true, 'processed'); eq(row.width, 400, 'width');
  const one = await mkMedia(WS_A, { width: null });
  eq((await mprocessed({ media: one, width: 1, height: 1, exifStripped: true, bytes: 100, sizes: [800] })).status, 204, 'a 1 px photo');
});
