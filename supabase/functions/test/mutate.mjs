// Mutation test of the dashboard Edge Functions (slice 4.2): remove ONE check from a COPY of the source and require the Deno tests to go
// red. A check whose mutant stays green has no test. Ends: `N mutants, N caught, 0 survived, 0 target text missing`.
//   node supabase/functions/test/mutate.mjs [--only <name substring>[|<another>]]
// The copy lives in a temp folder (supabase/functions copied, contracts/ linked as a junction, deno.json copied); the real source is never
// touched. Mutated runs use `deno test --no-check` (the real code is type-checked by `deno task check`), and a run that ends without a
// test summary (a mutant that does not even load) counts as BROKEN, not as caught.
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
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
  ['dashboard: no body cap (256 KiB)', F + '_shared/dashboard.ts', "  if (text.length > (o.maxBody ?? MAX_BODY)) return problem(413, 'SIZE', 'This request is too large.');\n", ''],
  ['dashboard: a function\'s own body cap is ignored (256 KiB for an import file)', F + '_shared/dashboard.ts', 'text.length > (o.maxBody ?? MAX_BODY)', 'text.length > MAX_BODY', 'import.test.ts'],
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

  // ---- slice 5.2: the functions of the four screens (the fifth element is the test file that must go red) ----
  // save: the base version
  ['save: the base is not passed to save_as', F + 'save/index.ts', '${signOff}::jsonb, ${base}::int)`', '${signOff}::jsonb)`', 'save-base.test.ts'],
  ['save: an existing row needs no base', F + 'save/index.ts', "    if (row && base === null && !f.problems.some(p => p.path === 'base')) f.problems.push({ code: 'REQUIRED', path: 'base', msg: 'This is needed.' });\n", '', 'save-base.test.ts'],
  ['save: a negative base is accepted', F + 'save/index.ts', "    if (base !== null && base < 0) f.problems.push({ code: 'RANGE', path: 'base', msg: 'Must be 0 or more.' });\n", '', 'save-base.test.ts'],
  // lead-update: read
  ['lead-update: read is ignored', F + 'lead-update/index.ts', "      if (read === true) await tx`select service.mark_lead_read(${c.jwtClaims}::jsonb, ${lead}::uuid)`;\n", '', 'lead-read.test.ts'],
  ['lead-update: read: false marks the lead', F + 'lead-update/index.ts', '      if (read === true) await tx`select service.mark_lead_read', '      if (read !== null) await tx`select service.mark_lead_read', 'lead-read.test.ts'],
  ['lead-update: the change is skipped when the call also reads', F + 'lead-update/index.ts', "      await tx`select service.lead_update(", "      if (read !== true) await tx`select service.lead_update(", 'lead-read.test.ts'],
  // drafts
  ['drafts: the editor is not reported', F + 'drafts/index.ts', 'editedBy: r.edited_by,', 'editedBy: null,', 'drafts.test.ts'],
  ['drafts: the published version is not reported', F + 'drafts/index.ts', 'published: r.published_version,', 'published: null,', 'drafts.test.ts'],
  ['drafts: the time is not ISO', F + 'drafts/index.ts', 'r.edited_at instanceof Date ? r.edited_at.toISOString() : r.edited_at', 'String(r.edited_at)', 'drafts.test.ts'],
  // settings-save
  ['settings-save: no host check', F + 'settings-save/index.ts', 'await hostProblem(u.hostname, resolve)', 'null', 'settings.test.ts'],
  ['settings-save: a site of another workspace is accepted', F + 'settings-save/index.ts', "      if (ws !== workspace) throw new Error('S-NOT-FOUND: the site is not in this workspace');   // refused like any wall: 404 and a security event\n", '', 'settings.test.ts'],
  ['settings-save: the secret is not random', F + 'settings-save/index.ts', '${hex(32)}', "${'0'.repeat(64)}", 'settings.test.ts'],
  ['settings-save: removing the connection keeps the secret', F + 'settings-save/index.ts', "        await tx`select service.crm_secret_drop(${c.jwtClaims}::jsonb, ${workspace}::uuid)`;\n", '', 'settings.test.ts'],
  ['settings-save: removing the connection keeps the address', F + 'settings-save/index.ts', "        await tx`select service.set_crm_webhook(${c.jwtClaims}::jsonb, ${workspace}::uuid, null::text, null::text)`;\n", '', 'settings.test.ts'],
  ['settings-save: a refused host leaves no security event', F + 'settings-save/index.ts', "        await recordEvent(c.sql, 'refused', 'I-URL', { workspace, actor: c.sub, fn: c.fn });\n", '', 'settings.test.ts'],
  ['settings-save: the alert tick is dropped', F + 'settings-save/index.ts', '${alerts.to}::text[], ${alerts.assignee}::boolean)', '${alerts.to}::text[], ${null}::boolean)', 'settings.test.ts'],
  ['settings-save: alerts and the connection are saved apart (no transaction)', F + 'settings-save/index.ts', [
    ['    await c.sql.begin(async (tx: typeof c.sql) => {\n      if (alerts) await tx', '    await (async (tx: typeof c.sql) => {\n      if (alerts) await tx'],
    ['    });\n    return json(200, { alerts: alerts !== null', '    })(c.sql);\n    return json(200, { alerts: alerts !== null']], null, 'settings.test.ts'],
  // crm-test
  ['crm-test: no host check', F + 'crm-test/index.ts', 'await hostProblem(url.hostname, resolve)', 'null', 'crm-test.test.ts'],
  ['crm-test: redirects are followed', F + 'crm-test/index.ts', "method: 'POST', redirect: 'manual', ", "method: 'POST', ", 'crm-test.test.ts'],
  ['crm-test: no timeout', F + 'crm-test/index.ts', 'signal: AbortSignal.timeout(TIMEOUT_MS), ', '', 'crm-test.test.ts'],
  ['crm-test: the request is not signed', F + 'crm-test/index.ts', "'x-omnikom-signature': signature, ", '', 'crm-test.test.ts'],
  ['crm-test: the signature leaves out the query', F + 'crm-test/index.ts', "'POST', url.pathname + url.search, TEST_BODY)", "'POST', url.pathname, TEST_BODY)", 'crm-test.test.ts'],
  ['crm-test: the audit row is given the whole address', F + 'crm-test/index.ts', '${status}::int, ${url.hostname})`', '${status}::int, ${url.toString()})`', 'crm-test.test.ts'],
  ['crm-test: a refusal is not audited', F + 'crm-test/index.ts', "      await tested('refused', null);\n", '', 'crm-test.test.ts'],
  ['crm-test: an answer is not audited', F + 'crm-test/index.ts', "    await tested(status !== null ? 'sent' : 'failed', status);\n", '', 'crm-test.test.ts'],
  ['crm-test: a redirect counts as ok', F + 'crm-test/index.ts', 'const ok = status !== null && status >= 200 && status < 300;', 'const ok = status !== null && status >= 200 && status < 400;', 'crm-test.test.ts'],
  ['crm-test: the test body is not the fixed one', F + 'crm-test/index.ts', "lead: { name: 'Test Lead', email: 'test@example.com' }", "lead: { name: 'Test Lead', email: 'test@example.com', real: true }", 'crm-test.test.ts'],
  // lead-export
  ['lead-export: the service connection instead of the caller\'s (RLS)', F + '_shared/db.ts', "await tx.unsafe('set local role authenticated');", "await tx.unsafe('set local role postgres');", 'export.test.ts'],
  ['lead-export: no role switch at all', F + '_shared/db.ts', "    await tx.unsafe('set local role authenticated');\n", '', 'export.test.ts'],
  ['lead-export: the caller\'s claims are not set', F + '_shared/db.ts', "    await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true), set_config('request.jwt.claim.sub', ${claims.sub}, true)`;\n", '', 'export.test.ts'],
  ['lead-export: spreadsheet formulas are not quoted', F + '_shared/csv.ts', `  if (/^[=+\\-@\\t\\r]/.test(s)) s = "'" + s;\n`, '', 'export.test.ts'],
  ['lead-export: only = is quoted', F + '_shared/csv.ts', '/^[=+\\-@\\t\\r]/.test(s)', '/^[=]/.test(s)', 'export.test.ts'],
  ['lead-export: the export event is not recorded', F + 'lead-export/index.ts', "    await c.sql`select service.leads_exported(${c.jwtClaims}::jsonb, ${site}::uuid, ${leads.map(l => l.id)}::uuid[])`;\n", '', 'export.test.ts'],
  ['lead-export: no cap (50000 rows)', F + 'lead-export/index.ts', 'export const MAX_ROWS = 5000;', 'export const MAX_ROWS = 50000;', 'export.test.ts'],
  ['lead-export: the cap is said nowhere', F + 'lead-export/index.ts', "      ...(capped ? { 'x-omnikom-export-capped': String(MAX_ROWS) } : {}),\n", '', 'export.test.ts'],
  ['lead-export: % and _ are wildcards in the search', F + 'lead-export/index.ts', "q.replace(/[\\\\%_]/g, m => '\\\\' + m)", 'q', 'export.test.ts'],
  ['lead-export: one character already searches', F + 'lead-export/index.ts', 'const pattern = q.length >= 2 ?', 'const pattern = q.length >= 1 ?', 'export.test.ts'],
  ['lead-export: spam is in the list of all', F + 'lead-export/index.ts', ": tx`and l.status <> 'spam'`;", ': tx``;', 'export.test.ts'],
  ['lead-export: mine is every lead', F + 'lead-export/index.ts', ' and l.owner_team_row = ${m?.team_row_id ?? null}::uuid`', '`', 'export.test.ts'],
  ['lead-export: new is every lead', F + 'lead-export/index.ts', "filter === 'new' ? tx`and l.status = 'new'`", "filter === 'new' ? tx``", 'export.test.ts'],
  ['lead-export: oldest first', F + 'lead-export/index.ts', 'order by l.created_at desc, l.id', 'order by l.created_at asc, l.id', 'export.test.ts'],
  ['lead-export: the owner column is the team row id', F + 'lead-export/index.ts', '(names.get(l.owner_team_row) ?? l.owner_team_row)', 'l.owner_team_row', 'export.test.ts'],
  ['lead-export: the site is not in the filter', F + 'lead-export/index.ts', 'from public.leads l where l.site_id = ${site}::uuid ${byFilter}', 'from public.leads l where true ${byFilter}', 'export.test.ts'],
  // work order 01: one column per industry field (each must turn export.test.ts red)
  ['lead-export: every industry value is written empty', F + 'lead-export/index.ts', '...fields.map(x => plain(a[x.key]))', "...fields.map(() => '')", 'export.test.ts'],
  ['lead-export: no industry columns at all', F + 'lead-export/index.ts', 'const fields: Field[] = ws ?', 'const fields: Field[] = false ?', 'export.test.ts'],
  ['lead-export: a multi choice is one JSON cell', F + 'lead-export/index.ts', "  if (Array.isArray(v)) return v.map(x => String(x)).join('; ');\n", '', 'export.test.ts'],
  // work order 02: the export in the client's layout, the map, the import (each must turn import.test.ts red)
  ['lead-export layout: the search of the view is dropped', F + 'lead-export/index.ts', '  if (search) q.search = search;\n', '', 'import.test.ts'],
  ['lead-export layout: the sort of the view is dropped', F + 'lead-export/index.ts', '  if (sort !== undefined) q.sort = sort;\n', '', 'import.test.ts'],
  ['lead-export layout: the columns are not in the map\'s order', F + 'lead-export/index.ts', 'toCsv(out, tpl.columns.map(col => col.header))', 'toCsv(out, tpl.columns.map(col => col.header).reverse())', 'import.test.ts'],
  ['lead-export layout: no formula guard', F + 'lead-export/index.ts', 'toCsv(out, tpl.columns.map(col => col.header))', 'toCsv(out, tpl.columns.map(col => col.header), { formulaGuard: false })', 'import.test.ts'],
  ['lead-export layout: no exported event', F + 'lead-export/index.ts', "  for (const [site, list] of bySite) await c.sql`select service.leads_exported(${c.jwtClaims}::jsonb, ${site}::uuid, ${list}::uuid[])`;\n", '', 'import.test.ts'],
  ['lead-export layout: the owner is the team row id', F + 'lead-export/index.ts', "owner: l.owner_team_row ? (names.get(l.owner_team_row) ?? '') : ''", 'owner: l.owner_team_row ?? \'\'', 'import.test.ts'],
  ['lead-export layout: no cap', F + 'lead-export/index.ts', 'const take = ids.slice(0, maxRows);', 'const take = ids;', 'import.test.ts'],
  ['lead-export layout: the cap is said nowhere', F + 'lead-export/index.ts', "    ...(total > maxRows ? { 'x-omnikom-export-capped': String(maxRows) } : {}),\n", '', 'import.test.ts'],  ['crm-map-propose: no owner check', F + 'crm-map-propose/index.ts', '    const fields = await crmFields(c, workspace);   // the owner check comes before any parsing', '    const fields = [] as never[];', 'import.test.ts'],
  ['crm-map-propose: the industry fields are not offered', F + 'crm-map-propose/index.ts', 'proposeMap(ourFields(fields),', 'proposeMap(ourFields([]),', 'import.test.ts'],
  ['crm-template-save: the library\'s check is skipped', F + 'crm-template-save/index.ts', '    let problems = validateTemplate(template) as string[];', '    let problems: string[] = [];', 'import.test.ts'],
  ['crm-template-save: an unknown transform is saved', F + 'crm-template-save/index.ts', '    if (!problems.length) { try { exportRows(template, []); }', '    if (false) { try { exportRows(template, []); }', 'import.test.ts'],
  ['crm-template-save: a field not on the forms is left to the database', F + 'crm-template-save/index.ts', '    if (missing.length) {', '    if (false) {', 'import.test.ts'],
  ['lead-import: the file is read before the owner check', F + 'lead-import/index.ts', '    await crmFields(c, workspace);   // owner only: a member or an outsider is refused before the file is read\n', '', 'import.test.ts'],
  ['lead-import: no file size cap (F6: 1 MB)', F + 'lead-import/index.ts', '    if (new TextEncoder().encode(file).length > MAX_FILE) {', '    if (false) {', 'import.test.ts'],
  ['lead-import: the file size is counted in characters, not bytes', F + 'lead-import/index.ts', 'new TextEncoder().encode(file).length > MAX_FILE', 'file.length > MAX_FILE', 'import.test.ts'],
  ['lead-import: the file size cap is off by one', F + 'lead-import/index.ts', 'new TextEncoder().encode(file).length > MAX_FILE', 'new TextEncoder().encode(file).length >= MAX_FILE', 'import.test.ts'],
  ['lead-import: no row cap (the database refuses with 422, not 413)', F + 'lead-import/index.ts', '    if (parsed.rows.length > MAX_ROWS) {', '    if (false) {', 'import.test.ts'],
  ['lead-import: a real run is the default', F + 'lead-import/index.ts', "dryRun = f.bool('dry_run') ?? true", "dryRun = f.bool('dry_run') ?? false", 'import.test.ts'],
  ['lead-import: the tick is always sent', F + 'lead-import/index.ts', 'dry_run: dryRun, duplicates, consent,', 'dry_run: dryRun, duplicates, consent: true,', 'import.test.ts'],
  ['lead-import: line numbers count from 0', F + 'lead-import/index.ts', 'line: mapped.sourceRows[i] + 2,', 'line: mapped.sourceRows[i],', 'import.test.ts'],
  ['lead-import: the fingerprint is not the file\'s', F + 'lead-import/index.ts', 'file_sha256: await sha256Hex(file)', 'file_sha256: await sha256Hex(fileName)', 'import.test.ts'],
  ['db: I-IMPORT does not name the line', F + '_shared/db.ts', "path: m ? m[2] : '', row: m ? m[1] : undefined };", "path: m ? m[2] : '' };", 'import.test.ts'],
  ['db: T-FIELD is not mapped (a 500)', F + '_shared/db.ts', "  if (has('T-FIELD')) {", "  if (has('T-FIELD-NEVER')) {", 'import.test.ts'],
  ['db: I-CONSENT is not mapped (a 500)', F + '_shared/db.ts', "  if (has('I-CONSENT')) return", "  if (has('I-CONSENT-NEVER')) return", 'import.test.ts'],
  // invite-member
  ['invite-member: a login is made even when one exists', F + 'invite-member/index.ts', '    if (!user) {', '    if (true) {', 'invite.test.ts'],
  ['invite-member: the role is always member', F + 'invite-member/index.ts', '${role}::public.member_role', "'member'::public.member_role", 'invite.test.ts'],
  ['invite-member: the team profile is not checked before the login is made', F + 'invite-member/index.ts', '${email}, ${team}::uuid) as user_id`', '${email}, null::uuid) as user_id`', 'invite.test.ts'],
  ['invite-member: the email is not lower-cased', F + 'invite-member/index.ts', '.trim().toLowerCase()', '.trim()', 'invite.test.ts'],
  ['invite-member: the answer says the email was sent', F + 'invite-member/index.ts', 'email_sent: false });', 'email_sent: true });', 'invite.test.ts'],
  ['invite-member: Auth is called without the secret key', F + 'invite-member/index.ts', 'authorization: `Bearer ${key}`, apikey: key, ', '', 'invite.test.ts'],
  ['invite-member: Auth is asked for a magic link, not an invite', F + 'invite-member/index.ts', "JSON.stringify({ type: 'invite', email })", "JSON.stringify({ type: 'magiclink', email })", 'invite.test.ts'],
  ['invite-member: the login is made before anyone is asked who may', F + 'invite-member/index.ts', "    const [found] = await c.sql`select service.find_login(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${email}, ${team}::uuid) as user_id`;\n    let user: string | null = found.user_id;",
    "    let user: string | null = await createLogin(email, fetchImpl);\n    const [found] = await c.sql`select service.find_login(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${email}, ${team}::uuid) as user_id`;", 'invite.test.ts'],
  // refusal(): the migration 12 input codes and the last owner
  ['db: I-EMAIL is not mapped', F + '_shared/db.ts', "  if (has('I-EMAIL')) return { status: 422, code: 'I-EMAIL', kind: null, msg: 'An email address is not valid, or there are more than ten.' };\n", '', 'db.test.ts'],
  ['db: I-URL is not mapped', F + '_shared/db.ts', "  if (has('I-URL')) return { status: 422, code: 'I-URL', kind: null, msg: 'Use a public web address that starts with https://.' };\n", '', 'db.test.ts'],
  ['db: I-SECRET-REF is not mapped', F + '_shared/db.ts', "  if (has('I-SECRET-REF')) return { status: 422, code: 'I-SECRET-REF', kind: null, msg: 'The secret for this connection is not valid.' };\n", '', 'db.test.ts'],
  ['db: S-LAST-OWNER is not mapped', F + '_shared/db.ts', "  if (has('S-LAST-OWNER')) return { status: 409, code: 'S-LAST-OWNER', kind: null, msg: 'A business keeps at least one owner.' };\n", '', 'db.test.ts'],
  ['db: I-URL echoes the database message', F + '_shared/db.ts', "code: 'I-URL', kind: null, msg: 'Use a public web address that starts with https://.' };", "code: 'I-URL', kind: null, msg: message };", 'db.test.ts'],
  ['db: I-EMAIL is a security event', F + '_shared/db.ts', "code: 'I-EMAIL', kind: null,", "code: 'I-EMAIL', kind: 'refused',", 'db.test.ts'],
  // CORS for the dashboard
  ['cors: Allow-Origin is *', F + '_shared/dashboard.ts', "return { 'access-control-allow-origin': origin, vary: 'Origin' };", "return { 'access-control-allow-origin': '*', vary: 'Origin' };", 'cors.test.ts'],
  ['cors: any origin is allowed', F + '_shared/dashboard.ts', 'if (!origin || !allowedOrigins().includes(origin)) return null;', 'if (!origin) return null;', 'cors.test.ts'],
  ['cors: * in the list is honoured', F + '_shared/dashboard.ts', ".filter(s => s && s !== '*')", '.filter(s => s)', 'cors.test.ts'],
  ['cors: no preflight', F + '_shared/dashboard.ts', "  if (req.method === 'OPTIONS') return new Response(null,", "  if (false) return new Response(null,", 'cors.test.ts'],
  ['cors: a refusal carries no Allow-Origin', F + '_shared/dashboard.ts', '  if (!cors) return res;', '  if (!cors || !res.ok) return res;', 'cors.test.ts'],
  ['cors: Vary is missing', F + '_shared/dashboard.ts', "return { 'access-control-allow-origin': origin, vary: 'Origin' };", "return { 'access-control-allow-origin': origin };", 'cors.test.ts'],
  ['cors: Max-Age is not 600', F + '_shared/dashboard.ts', "'access-control-max-age': '600'", "'access-control-max-age': '6'", 'cors.test.ts'],
  ['cors: apikey is not an allowed header', F + '_shared/dashboard.ts', "'authorization, apikey, content-type, x-client-info'", "'authorization, content-type, x-client-info'", 'cors.test.ts'],
  ['cors: GET is allowed too', F + '_shared/dashboard.ts', "'access-control-allow-methods': 'POST'", "'access-control-allow-methods': 'POST, GET'", 'cors.test.ts'],
  ['cors: the file headers are not exposed', F + '_shared/dashboard.ts', "  headers.set('access-control-expose-headers', EXPOSED);\n", '', 'cors.test.ts'],
  ['cors: a preflight from an unlisted origin is answered with CORS headers', F + '_shared/dashboard.ts', '...(cors ? { ...cors, ...PREFLIGHT } : {})', '...{ ...(cors ?? { \'access-control-allow-origin\': req.headers.get(\'origin\') ?? \'\' }), ...PREFLIGHT }', 'cors.test.ts'],
  // netguard: every range and every rule of the host check
  ...[
    ['10/8 is public', 'a === 0 || a === 10 || a === 127 || a >= 224', 'a === 0 || a === 127 || a >= 224'], ['0/8 is public', 'a === 0 || a === 10 || a === 127 || a >= 224', 'a === 10 || a === 127 || a >= 224'],
    ['127/8 is public', 'a === 0 || a === 10 || a === 127 || a >= 224', 'a === 0 || a === 10 || a >= 224'], ['224/4 starts one late', 'a === 0 || a === 10 || a === 127 || a >= 224', 'a === 0 || a === 10 || a === 127 || a > 224'],
    ['100.64/10 starts one late', '(a === 100 && b >= 64 && b <= 127)', '(a === 100 && b >= 65 && b <= 127)'], ['100.64/10 ends one early', '(a === 100 && b >= 64 && b <= 127)', '(a === 100 && b >= 64 && b <= 126)'],
    ['169.254/16 is public', '(a === 169 && b === 254)', 'false'], ['172.16/12 starts one late', 'b >= 16 && b <= 31', 'b >= 17 && b <= 31'], ['172.16/12 ends one early', 'b >= 16 && b <= 31', 'b >= 16 && b <= 30'],
    ['192.168/16 is public', '(a === 192 && b === 168)', 'false'], ['192.0.0/24 is public', '(c === 0 || c === 2)', 'c === 2'], ['192.0.2/24 is public', '(c === 0 || c === 2)', 'c === 0'],
    ['198.18/15 loses 198.19', '(b === 18 || b === 19)', 'b === 18'], ['198.18/15 loses 198.18', '(b === 18 || b === 19)', 'b === 19'], ['198.51.100/24 is public', '(a === 198 && b === 51 && c === 100)', 'false'],
    ['203.0.113/24 is public', '(a === 203 && b === 0 && c === 113)', 'false'],
    ['a number out of range is an address', 'o.every(n => n <= 255)', 'true'],
    ['IPv4-mapped IPv6 is not looked into', 'return embedded(g[6], g[7]);   // ::ffff:a.b.c.d (IPv4-mapped)', 'return false;'], ['NAT64 is not looked into', 'return embedded(g[6], g[7]);   // 64:ff9b::/96 (NAT64)', 'return false;'],
    ['IPv4-compatible IPv6 is not looked into', 'return embedded(g[6], g[7]);               // ::a.b.c.d (IPv4-compatible, deprecated)', 'return false;'], ['6to4 is not looked into', 'return embedded(g[1], g[2]);                                 // 2002::/16 (6to4 carries an IPv4 address)', 'return false;'],
    ['unique-local IPv6 is public', '  if ((g[0] & 0xfe00) === 0xfc00) return true;', '  if (false) return true;'], ['link-local IPv6 is public', '(g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0', '(g[0] & 0xffc0) === 0xfec0'],
    ['site-local IPv6 is public', '(g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0', '(g[0] & 0xffc0) === 0xfe80'], ['multicast IPv6 is public', '  if ((g[0] & 0xff00) === 0xff00) return true;', '  if (false) return true;'],
    ['documentation IPv6 is public', 'g[1] === 0x0db8 || g[1] === 0', 'g[1] === 0'], ['Teredo is public', 'g[1] === 0x0db8 || g[1] === 0', 'g[1] === 0x0db8'], ['the IPv6 discard prefix is public', '  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;', '  if (false) return true;'],
    ['text that is no address is allowed', 'return b ? privateV6(b) : true;', 'return b ? privateV6(b) : false;'],
    ['one private answer among public ones is allowed', 'found.some(isPrivateAddress)', 'found.every(isPrivateAddress)'], ['a name that does not resolve is allowed', "  if (!found.length) return 'That host name could not be found.';\n", ''],
    ['IPv6 answers are not asked for', "for (const type of ['A', 'AAAA'] as const)", "for (const type of ['A'] as const)"], ['IPv4 answers are not asked for', "for (const type of ['A', 'AAAA'] as const)", "for (const type of ['AAAA'] as const)"],
    ['a number is resolved like a name', 'if (parseV4(host) || parseV6(host)) return', 'if (false) return'], ['brackets are not removed', ".replace(/^\\[|\\]$/g, '')", ''],
    ['the final dot is not removed', ".replace(/\\.$/, '')", ''], ['the name is not lower-cased', '.toLowerCase();\n  if (!host)', ';\n  if (!host)'],
  ].map(([n, f, to]) => ['netguard: ' + n, F + '_shared/netguard.ts', f, to, 'netguard.test.ts']),
];

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const work = mkdtempSync(join(tmpdir(), 'omnikom-fn-mut-'));
cpSync(join(REPO, 'supabase', 'functions'), join(work, 'supabase', 'functions'), { recursive: true });
symlinkSync(join(REPO, 'contracts'), join(work, 'contracts'), 'junction');
mkdirSync(join(work, 'tools'));
symlinkSync(join(REPO, 'tools', 'crm-map'), join(work, 'tools', 'crm-map'), 'junction');   // work order 02: _shared/crm-map.ts imports tools/crm-map
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
      // `find` is one text, or a list of [find, to] pairs that are applied together (slice 5.2); each text must occur exactly once
      const pairs = Array.isArray(find) ? find : [[find, to]];
      let mutated = orig, bad = null;
      for (const [x, y] of pairs) { const n = mutated.split(x).length - 1; if (n !== 1) { bad = n; break; } mutated = mutated.split(x).join(y); }
      if (bad !== null) { missing++; console.log(`TARGET TEXT MISSING (${bad} matches): ${name}`); continue; }
      writeFileSync(path, mutated);
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
