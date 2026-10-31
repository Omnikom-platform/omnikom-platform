// Mutation test of the dashboard Edge Functions (slice 4.2): remove ONE check from a COPY of the source and require the Deno tests to go
// red. A check whose mutant stays green has no test. Ends: `N mutants, N caught, 0 survived, 0 target text missing`.
//   node supabase/functions/test/mutate.mjs [--only <name substring>[|<another>]]
// The copy lives in a temp folder (supabase/functions copied, contracts/ linked as a junction, deno.json copied); the real source is never
// touched. Mutated runs use `deno test --no-check` (the real code is type-checked by `deno task check`), and a run that ends without a
// test summary (a mutant that does not even load) counts as BROKEN, not as caught.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHarness, denoTest, REPO } from './harness.mjs';

const F = 'supabase/functions/';
// [name, file, text that must occur exactly once, what replaces it]
const MUTANTS = [
  ['auth: the signature is not verified', F + '_shared/auth.ts', "  if (!ok) return null;\n", ''],
  ['auth: an expired token is accepted', F + '_shared/auth.ts', "  if (typeof exp !== 'number' || !(exp > now)) return null;\n", ''],
  ['auth: any audience is accepted', F + '_shared/auth.ts', "  if (!(aud === 'authenticated' || (Array.isArray(aud) && aud.includes('authenticated')))) return null;\n", ''],
  ['auth: a subject need not be a uuid', F + '_shared/auth.ts', "if (typeof payload.sub !== 'string' || !UUID.test(payload.sub)) return null;", "if (typeof payload.sub !== 'string') return null;"],
  ['auth: forged kids refetch the keys without limit', F + '_shared/auth.ts', 'Date.now() - c.lastForced > REFETCH_GAP_MS', 'true'],
  ['auth: the keys are not cached', F + '_shared/auth.ts', 'const fresh = (x: Cache | undefined) => !!x && Date.now() - x.at < TTL_MS;', 'const fresh = (_x: Cache | undefined) => false;'],
  ['dashboard: the function does not verify the JWT itself', F + '_shared/dashboard.ts',
    'const claims = await verifyUserJwt(req, { jwksUrl: jwksUrl() });',
    "const tok = (req.headers.get('authorization') ?? '').split('.')[1]; const claims = tok ? JSON.parse(atob(tok.replace(/-/g, '+').replace(/_/g, '/'))) : null;"],
  ['dashboard: a refusal leaves no security event', F + '_shared/dashboard.ts', "      if (r.kind) await recordEvent(sql, r.kind, r.code, { workspace: c.workspace, site: c.site, actor: c.sub, ipHash, fn });", '      /* no event */'],
  ['dashboard: a bad token leaves no security event', F + '_shared/dashboard.ts', "      await recordEvent(sql, 'auth-refused', 'S-AUTH', { fn, ipHash, reason: 'bad-jwt' });\n", ''],
  ['dashboard: no body cap (256 KiB)', F + '_shared/dashboard.ts', "  if (text.length > MAX_BODY) return problem(413, 'SIZE', 'This request is too large.');\n", ''],
  ['dashboard: any method', F + '_shared/dashboard.ts', "  if (req.method !== 'POST') return problem(405, 'METHOD', 'POST only.');\n", ''],
  ['db: no step-down to omnikom_fn', F + '_shared/db.ts', "await sql.unsafe('set role omnikom_fn');", "await sql.unsafe('select 1');"],
  ['db: I-NOT-READY is not a 422 with its own code', F + '_shared/db.ts', "  if (has('I-NOT-READY')) return { status: 422, code: 'I-NOT-READY', kind: 'refused', msg: 'Some items are not ready to publish.' };\n", ''],
  ['db: S-STALE is not mapped (migration 12)', F + '_shared/db.ts', "  if (has('S-STALE')) {", "  if (has('S-STALE-NEVER')) {"],
  ['db: S-STALE is a 400, not a 409', F + '_shared/db.ts', "return { status: 409, code: 'S-STALE', kind: null,", "return { status: 400, code: 'S-STALE', kind: null,"],
  ['db: S-STALE is recorded as a security event', F + '_shared/db.ts', "code: 'S-STALE', kind: null,", "code: 'S-STALE', kind: 'refused',"],
  ['db: S-STALE echoes whatever the database said', F + '_shared/db.ts', "msg: m ? m[1] : 'Someone else saved a newer version.' };", "msg: message };"],
  ['save: the contract_for refusal is ignored (validation first)', F + 'save/index.ts',
    "    const [{ contract }] = await c.sql`select service.contract_for(${c.jwtClaims}::jsonb, ${workspace}::uuid) as contract`;",
    "    let contract: unknown; try { [{ contract }] = await c.sql`select service.contract_for(${c.jwtClaims}::jsonb, ${workspace}::uuid) as contract`; } catch { contract = { collections: {} }; }"],
  ['save: validated as a publish instead of a draft', F + 'save/index.ts', ".check(collection, data, 'draft')", ".check(collection, data, 'publish')"],
  ['validate: the media lookup is ignored', F + '_shared/validate.ts', '      media: (asset: unknown) => this.files.get(String(asset)) ?? null,', '      media: () => ({ width: 5000, exifStripped: true, rightsConfirmed: true, processed: true }),'],
  ['validate: every reference exists', F + '_shared/validate.ts', '      exists: (coll: string, id: unknown) => this.refs.get(`${coll}|${String(id)}`) === true,', '      exists: () => true,'],
  ['validate: the id of a missing reference is echoed', F + '_shared/validate.ts', "      if (p.code === 'I-REF') return { ...p, msg: 'This points at something that does not exist here.' };", "      if (p.code === 'I-REF') return p;"],
  ['publish: nothing is dispatched', F + 'publish/index.ts', "    const sent = await dispatch('publish', { job_id: job, site_id: site });", '    const sent = { dispatched: true, reason: null };'],
  ['publish: the rows are validated as drafts', F + 'publish/index.ts', "validator.check(v.collection, v.data, 'publish')", "validator.check(v.collection, v.data, 'draft')"],
  ['publish: an invalid item still starts the job', F + 'publish/index.ts', "    if (all.length) return problem(422, 'VALIDATION', 'Some items are not ready to publish.', all);\n", ''],
  ['publish: one version for each row is not checked', F + 'publish/index.ts', "    if (rows && versions && rows.length !== versions.length) f.problems.push({ code: 'LENGTH', path: 'versions', msg: 'One version for each row.' });\n", ''],
  ['dispatch: a missing token is sent anyway', F + '_shared/dispatch.ts', "  if (!token) return { dispatched: false, reason: 'no dispatch token' };\n", ''],
  ['dispatch: a refusing GitHub counts as dispatched', F + '_shared/dispatch.ts', '    if (r.status === 204) return { dispatched: true, reason: null };', '    if (r.status < 600) return { dispatched: true, reason: null };'],
  ['upload-start: no cap (25 MB)', F + 'upload-start/index.ts', "    if (bytes > MAX_BYTES) return problem(413, 'SIZE', 'This file is too large (25 MB at most).');\n", ''],
  ['upload-start: no mime list', F + 'upload-start/index.ts', "    if (!MIMES.includes(mime)) return problem(415, 'MIME', 'Use a jpg, png, webp, heic or pdf file.');\n", ''],
  ['upload-start: Storage is called without the secret key', F + 'upload-start/index.ts', 'authorization: `Bearer ${key}`, apikey: key,', 'apikey: key,'],
  ['upload-start: a failed signing still answers 200', F + 'upload-start/index.ts', "    if (!signed || typeof signed.url !== 'string') return problem(502, 'STORAGE', 'Uploads are not available right now. Please try again.');", "    if (!signed) signed = { url: '/object/upload/sign/media/' + m.path };"],
  ['upload-finish: the rights tick is always true', F + 'upload-finish/index.ts', 'select service.finish_media(${c.jwtClaims}::jsonb, ${media}::uuid, ${rights})', 'select service.finish_media(${c.jwtClaims}::jsonb, ${media}::uuid, true)'],
  ['upload-finish: nothing is dispatched', F + 'upload-finish/index.ts', "    const sent = await dispatch('media', { media_id: media, workspace_id: m.workspace_id });", '    const sent = { dispatched: true, reason: null };'],
  ['add-lead: the email is not checked', F + 'add-lead/index.ts', '    if (email && !EMAIL.test(email)) f.problems.push(', '    if (false) f.problems.push('],
  ['lead-update: the status is not checked', F + 'lead-update/index.ts', '    if (status && !STATUS.includes(status)) f.problems.push(', '    if (false) f.problems.push('],

  // ---- slice 4.3: the runner's functions (the fifth element is the test file that must go red) and the capture-lead jsonb fix ----
  // the frame every runner function shares (_shared/runner.ts)
  ['runner: the signature is not checked', F + '_shared/runner.ts', "  const signed = await verify(req.headers.get('x-runner-signature'), key, o.method, pathForSignature(url), signedBody);", '  const signed = true;', 'runner.test.ts'],
  ['runner: a bad signature leaves no security event', F + '_shared/runner.ts', "service.record_security_event('bad-signature', 'SIGNATURE'", "service.record_security_event('no-such-kind', 'SIGNATURE'", 'runner.test.ts'],
  ['runner: the event does not say kind runner', F + '_shared/runner.ts', "{ fn: o.fn, kind: 'runner' }", '{ fn: o.fn }', 'runner.test.ts'],
  ['runner: a GET is verified over a body that is not empty', F + '_shared/runner.ts', "const signedBody = o.method === 'GET' ? '' : text;", "const signedBody = o.method === 'GET' ? 'x' : text;", 'runner.test.ts'],
  ['runner: a missing RUNNER_KEY is not refused', F + '_shared/runner.ts', "  if (!key) { console.error(o.fn, 'RUNNER_KEY is not set'); return problem(500, 'CONFIG', 'Not configured.'); }\n", '', 'runner.test.ts'],
  ['runner: any method', F + '_shared/runner.ts', "  if (req.method !== o.method) return problem(405, 'METHOD', `${o.method} only.`);\n", '', 'runner.test.ts'],
  ['runner: an id that is not a uuid is not refused', F + '_shared/runner.ts', "    if (!UUID.test(v)) return problem(404, 'S-NOT-FOUND', 'Not found.');\n", '', 'runner.test.ts'],
  ['runner: no body cap (256 KiB)', F + '_shared/runner.ts', "  if (text.length > MAX_BODY) return problem(413, 'SIZE', 'This request is too large.');\n", '', 'runner.test.ts'],
  ['runner: a refusal of the database is a plain 500', F + '_shared/runner.ts', '      return problem(r.status, r.code, r.msg);', "      return problem(500, 'SERVER', 'x');", 'runner.test.ts'],
  ['runner: the key row is not touched', F + '_shared/runner.ts', '    await touchKey(sql, key);\n', '', 'runner.test.ts'],
  // export-published
  ['export-published: the snapshot is not frozen first', F + 'export-published/index.ts', '    await c.sql`select service.freeze_snapshot(${c.id}::uuid)`;\n', '', 'runner.test.ts'],
  ['export-published: the ORIGINAL path is exported (GPS leak)', F + 'export-published/index.ts', '      const path = derivativePath(m.path, derivativeSlot(m.width));', '      const path = m.path;', 'runner.test.ts'],
  ['export-published: every photo is served at the 2400 slot', F + 'export-published/index.ts', 'derivativePath(m.path, derivativeSlot(m.width))', 'derivativePath(m.path, 2400)', 'runner.test.ts'],
  ['storage: derivativeSlot, 2400 needs more than 2400', F + '_shared/storage.ts', 'if (w >= 2400) return 2400;', 'if (w > 2400) return 2400;', 'runner.test.ts'],
  ['storage: derivativeSlot, 1600 needs more than 1600', F + '_shared/storage.ts', 'if (w >= 1600) return 1600;', 'if (w > 1600) return 1600;', 'runner.test.ts'],
  ['storage: derivativeSlot, the narrowest slot is 1600', F + '_shared/storage.ts', '  return 800;\n}', '  return 1600;\n}', 'runner.test.ts'],
  ['export-published: the URL is signed for the original upload (GPS leak)', F + 'export-published/index.ts', 'const url = await signDownload(cfg, path, 3600);', 'const url = await signDownload(cfg, m.path, 3600);', 'runner.test.ts'],
  ['export-published: the URL lasts a day, not an hour', F + 'export-published/index.ts', 'const url = await signDownload(cfg, path, 3600);', 'const url = await signDownload(cfg, path, 86400);', 'runner.test.ts'],
  ['export-published: unprocessed media are exported', F + 'export-published/index.ts', '.filter(m => m.processed === true)', '.filter(() => true)', 'runner.test.ts'],
  ['export-published: no bound on the signing (8 at a time)', F + 'export-published/index.ts', 'export const SIGN_AT_ONCE = 8;', 'export const SIGN_AT_ONCE = 1000;', 'runner.test.ts'],
  ['export-published: a file that did not sign has no error', F + 'export-published/index.ts', "rights_confirmed: m.rights_confirmed, url, ...(url ? {} : { error: 'sign failed' }) };", 'rights_confirmed: m.rights_confirmed, url };', 'runner.test.ts'],
  ['storage: Storage is called without the secret key', F + '_shared/storage.ts', 'authorization: `Bearer ${cfg.key}`, apikey: cfg.key, ', '', 'runner.test.ts'],
  ['storage: an upload URL is signed without upsert', F + '_shared/storage.ts', "{ 'x-upsert': 'true' }", '{}', 'runner.test.ts'],
  // job-callback
  ['job-callback: the state list is not checked', F + 'job-callback/index.ts', "    if (state && !STATES.includes(state)) f.problems.push({ code: 'ENUM', path: 'state', msg: 'Not a state the runner reports.' });\n", '', 'runner.test.ts'],
  ['job-callback: no cap on the gate report (64 KiB)', F + 'job-callback/index.ts', "    if (report && JSON.stringify(report).length > MAX_REPORT) return problem(413, 'SIZE', 'The gate report is too large (64 KiB at most).');\n", '', 'runner.test.ts'],
  ['job-callback: the deploy id is dropped', F + 'job-callback/index.ts', '${report}::jsonb, ${deployId}, ${error})', '${report}::jsonb, null, ${error})', 'runner.test.ts'],
  ['job-callback: the error is dropped', F + 'job-callback/index.ts', '${report}::jsonb, ${deployId}, ${error})', '${report}::jsonb, ${deployId}, null)', 'runner.test.ts'],
  ['job-callback: the gate report is stored as JSON text', F + 'job-callback/index.ts', '${report}::jsonb', '${report ? JSON.stringify(report) : null}::jsonb', 'runner.test.ts'],
  // media-export
  ['media-export: the upload paths are not the workspace folder', F + 'media-export/index.ts', 'signUpload(cfg, derivativePath(m.path, w))', 'signUpload(cfg, derivativePath(m.id, w))', 'runner.test.ts'],
  ['media-export: a failed signing still answers 200', F + 'media-export/index.ts', "    if (!url || ups.some(u => !u)) return problem(502, 'STORAGE', 'Files are not available right now. Please try again.');\n", '', 'runner.test.ts'],
  ['media-export: one size is missing', F + 'media-export/index.ts', 'export const WIDTHS = [...SLOTS];', 'export const WIDTHS = [2400, 1600];', 'runner.test.ts'],
  // media-process-callback
  ['media-process-callback: exifStripped false is accepted', F + 'media-process-callback/index.ts', 'if (c.body.exifStripped !== true) return', 'if (false) return', 'runner.test.ts'],
  ['media-process-callback: any truthy exifStripped is accepted', F + 'media-process-callback/index.ts', 'c.body.exifStripped !== true', '!c.body.exifStripped', 'runner.test.ts'],
  ['media-process-callback: a document is not refused', F + 'media-process-callback/index.ts', "if (c.body.kind === 'document') return", 'if (false) return', 'runner.test.ts'],
  ['media-process-callback: a width below 1 goes to the database', F + 'media-process-callback/index.ts', 'if (width < 1 || height < 1) return', 'if (false) return', 'runner.test.ts'],
  ['media-process-callback: negative bytes are accepted', F + 'media-process-callback/index.ts', 'if (bytes !== null && bytes < 0) return', 'if (false) return', 'runner.test.ts'],
  ['media-process-callback: sizes need not be a list', F + 'media-process-callback/index.ts', 'const widthsOk = (v: unknown) => v == null ||', 'const widthsOk = (v: unknown) => true || v == null ||', 'runner.test.ts'],
  // capture-lead: a jsonb parameter is the object, never JSON text
  ['capture-lead: the answers are given as JSON text', F + 'capture-lead/index.ts', '${L.answers}::jsonb', '${JSON.stringify(L.answers)}::jsonb', 'capture.test.ts'],
  ['capture-lead: the marketing consent is given as JSON text', F + 'capture-lead/index.ts', '${L.cta}, ${L.marketing}::jsonb', '${L.cta}, ${L.marketing ? JSON.stringify(L.marketing) : null}::jsonb', 'capture.test.ts'],
  ['capture-lead: the security event detail is given as JSON text', F + 'capture-lead/index.ts', '${{ path: url.pathname }}::jsonb', '${JSON.stringify({ path: url.pathname })}::jsonb', 'capture.test.ts'],
];

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const work = mkdtempSync(join(tmpdir(), 'omnikom-fn-mut-'));
cpSync(join(REPO, 'supabase', 'functions'), join(work, 'supabase', 'functions'), { recursive: true });
symlinkSync(join(REPO, 'contracts'), join(work, 'contracts'), 'junction');
cpSync(join(REPO, 'deno.json'), join(work, 'deno.json'));
const testDir = join(work, 'supabase', 'functions', 'test');

const api = await startHarness();
let caught = 0, survived = 0, missing = 0, broken = 0, ran = 0;
try {
  const base = await denoTest(api, testDir, { noCheck: true, cwd: work });
  if (!(base.status === 0 && base.failed === 0 && base.passed > 0)) {
    console.log(base.out.trim().split(/\r?\n/).slice(-40).join('\n'));
    console.log('FAILED: the unmutated copy does not pass; nothing to measure');
    process.exitCode = 1;
  } else {
    console.log(`baseline (the unmutated copy): ${base.passed} passed, 0 failed`);
    for (const [name, file, find, to, scope] of MUTANTS) {
      if (only && !only.split('|').some(s => name.includes(s))) continue;   // --only a|b: any of the substrings
      ran++;
      const path = join(work, file);
      const orig = readFileSync(join(REPO, file), 'utf8');
      const n = orig.split(find).length - 1;
      if (n !== 1) { missing++; console.log(`TARGET TEXT MISSING (${n} matches): ${name}`); continue; }
      writeFileSync(path, orig.split(find).join(to));
      const r = await denoTest(api, scope ? join(testDir, scope) : testDir, { noCheck: true, cwd: work });   // a mutant may name the one test file that must go red (slice 4.3: faster)
      writeFileSync(path, orig);
      if (r.failed === null) { broken++; console.log(`BROKEN   ${name}: no test summary\n${r.out.trim().split(/\r?\n/).slice(-6).join('\n')}`); }
      else if (r.failed > 0 && r.status !== 0) {
        caught++;
        const first = (r.out.match(/^(.*) \.\.\. FAILED/m) || [, '?'])[1].replace(/\x1b\[[0-9;]*m/g, '').slice(0, 90);
        console.log(`caught   ${name.padEnd(62)} red: ${first}`);
      } else { survived++; console.log(`SURVIVED ${name}`); }
    }
    console.log(`\n${ran} mutants, ${caught} caught, ${survived} survived, ${missing} target text missing${broken ? `, ${broken} broken` : ''}`);
    process.exitCode = (caught === ran && !survived && !missing && !broken) ? 0 : 1;
  }
} finally { await api.stop(); rmSync(work, { recursive: true, force: true }); }
