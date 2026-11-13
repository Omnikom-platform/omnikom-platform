// Mutation test of the dashboard Edge Functions (slice 4.2): remove ONE check from a COPY of the source and require the Deno tests to go
// red. A check whose mutant stays green has no test. Ends: `N mutants, N caught, 0 survived, 0 target text missing`.
//   node supabase/functions/test/mutate.mjs [--only <name substring>[|<another>]] [--shard i/N] [--list]
// --shard i/N runs share i of N (the ci.yml jobs functions-mutants-1..N): the whole-folder mutants dealt round-robin on their own, then the scoped ones
// (tools/omnikom-cli/test/mutate-run.mjs shardBalanced); an empty share exits 1, a bad value 2; --list prints the selected mutants and stops.
// The copy lives in a temp folder (supabase/functions copied, contracts/ linked as a junction, deno.json copied); the real source is never
// touched. Mutated runs use `deno test --no-check` (the real code is type-checked by `deno task check`), and a run that ends without a
// test summary (a mutant that does not even load) counts as BROKEN, not as caught.
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHarness, denoTest, REPO } from './harness.mjs';
import { planShard } from '../../../tools/omnikom-cli/test/mutate-run.mjs';   // --shard i/N and --list: tested and mutated with the CLI (test/mutate-run.mjs, mutate.mjs [functions-shards])

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
  ['db: no step-down to omnikom_fn', F + '_shared/db.ts', "await tx.unsafe('set local role omnikom_fn');", "await tx.unsafe('select 1');"],
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
  ['lead-update: the status is not checked', F + 'lead-update/index.ts', '    if (status && !SLUG.test(status)) f.problems.push(', '    if (false) f.problems.push('],

  // ---- slice 4.3: the runner's functions (the fifth element is the test file that must go red) and the capture-lead jsonb fix ----
  // the frame every runner function shares (_shared/runner.ts)
  ['runner: the signature is not checked', F + '_shared/runner.ts', "  const signed = await verify(req.headers.get(o.header ?? 'x-runner-signature'), key, o.method, pathForSignature(url), signedBody);", '  const signed = true;', 'runner.test.ts'],
  ['runner: a bad signature leaves no security event', F + '_shared/runner.ts', "service.record_security_event('bad-signature', 'SIGNATURE'", "service.record_security_event('no-such-kind', 'SIGNATURE'", 'runner.test.ts'],
  ['runner: the event does not say kind runner', F + '_shared/runner.ts', "{ fn: o.fn, kind: o.keyEnv ? 'cron' : 'runner' }", '{ fn: o.fn }', 'runner.test.ts'],
  ['runner: a GET is verified over a body that is not empty', F + '_shared/runner.ts', "const signedBody = o.method === 'GET' ? '' : text;", "const signedBody = o.method === 'GET' ? 'x' : text;", 'runner.test.ts'],
  ['runner: a missing RUNNER_KEY is not refused', F + '_shared/runner.ts', "  if (!key) { console.error(o.fn, `${keyEnv} is not set`); return problem(500, 'CONFIG', 'Not configured.'); }\n", '', 'runner.test.ts'],
  ['runner: any method', F + '_shared/runner.ts', "  if (req.method !== o.method) return problem(405, 'METHOD', `${o.method} only.`);\n", '', 'runner.test.ts'],
  ['runner: an id that is not a uuid is not refused', F + '_shared/runner.ts', "    if (!UUID.test(v)) return problem(404, 'S-NOT-FOUND', 'Not found.');\n", '', 'runner.test.ts'],
  ['runner: no body cap (256 KiB)', F + '_shared/runner.ts', "  if (text.length > MAX_BODY) return problem(413, 'SIZE', 'This request is too large.');\n", '', 'runner.test.ts'],
  ['runner: a refusal of the database is a plain 500', F + '_shared/runner.ts', '      return problem(r.status, r.code, r.msg);', "      return problem(500, 'SERVER', 'x');", 'runner.test.ts'],
  ['runner: the key row is not touched', F + '_shared/runner.ts', "    if (!o.keyEnv) await touchKey(sql, key);   // the registry row is the runner key's; the cron key has none\n", '', 'runner.test.ts'],
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
  ['settings-save: a site of another workspace is accepted', F + 'settings-save/index.ts', "    if (ws !== workspace) throw new Error('S-NOT-FOUND: the site is not in this workspace');   // refused like any wall: 404 and a security event\n", '', 'settings.test.ts'],
  ['settings-save: the alert tick is dropped', F + 'settings-save/index.ts', '${alerts.to}::text[], ${alerts.assignee}::boolean)', '${alerts.to}::text[], ${null}::boolean)', 'settings.test.ts'],
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
  ['lead-export: new is every lead', F + 'lead-export/index.ts', "filter === 'new' ? tx`and l.status = 'not-contacted'`", "filter === 'new' ? tx``", 'export.test.ts'],
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
  ['lead-import: the rows are given as JSON text', F + 'lead-import/index.ts', "${{ v: rows }}::jsonb -> 'v'", '${JSON.stringify(rows)}::jsonb', 'import.test.ts'],
  ['crm-template-save: the columns are given as JSON text', F + 'crm-template-save/index.ts', "${{ v: template.columns }}::jsonb -> 'v'", '${JSON.stringify(template.columns)}::jsonb', 'import.test.ts'],
  ['lead-export layout: the view is given as JSON text', F + 'lead-export/index.ts', '${{ ...q, page }}::jsonb', '${JSON.stringify({ ...q, page })}::jsonb', 'import.test.ts'],
  // work order 07 Settled 9: the view without a template (export.test.ts)
  ["lead-export view: the column filters of the view are dropped", F + 'lead-export/index.ts', "  if (filters !== undefined) q.filters = filters;\n", "", 'export.test.ts'],
  ["lead-export view: the sort of the view is dropped", F + 'lead-export/index.ts', "  if (sort !== undefined) q.sort = sort;\n", "", 'export.test.ts'],
  ["lead-export view: no exported event", F + 'lead-export/index.ts', "  for (const [site, list] of bySite) await c.sql`select service.leads_exported(${c.jwtClaims}::jsonb, ${site}::uuid, ${list}::uuid[])`;\n", "", 'export.test.ts'],
  ["lead-export view: the plain file has no industry columns", F + 'lead-export/index.ts', "if (page === 1) fields = (r.fields as Field[] | undefined) ?? [];", "if (page === 1) fields = [];", 'export.test.ts'],
  ["lead-export view: the cap is said nowhere", F + 'lead-export/index.ts', "      ...(total > maxRows ? { 'x-omnikom-export-capped': `${maxRows}` } : {}),\n", "", 'export.test.ts'],
  ["lead-export view: a workspace the caller cannot see answers an empty file", F + 'lead-export/index.ts', "  if (template ? !tpl : !seen) return problem(404, 'S-NOT-FOUND', 'Not found.');", "  if (template && !tpl) return problem(404, 'S-NOT-FOUND', 'Not found.');", 'export.test.ts'],
  ["lead-export view: a body with a workspace and no template is read as block 1's", F + 'lead-export/index.ts', "d.template !== undefined || d.workspace !== undefined", "d.template !== undefined", 'export.test.ts'],
  ["lead-export view: the cap is not applied to the plain view", F + 'lead-export/index.ts', "const take = ids.slice(0, maxRows);", "const take = ids;", 'export.test.ts'],
  ['db: I-IMPORT does not name the line', F + '_shared/db.ts', "path: m ? m[2] : '', row: m ? m[1] : undefined };", "path: m ? m[2] : '' };", 'import.test.ts'],
  ['db: T-FIELD is not mapped (a 500)', F + '_shared/db.ts', "  if (has('T-FIELD')) {", "  if (has('T-FIELD-NEVER')) {", 'import.test.ts'],
  ['db: I-CONSENT is not mapped (a 500)', F + '_shared/db.ts', "  if (has('I-CONSENT')) return", "  if (has('I-CONSENT-NEVER')) return", 'import.test.ts'],
  // site-audit (work order 10)
  ['site-audit: the body is not checked', F + 'site-audit/index.ts', "    if (f.problems.length || !site) return badBody(f.problems);\n", '', 'site-audit.test.ts'],
  ['site-audit: the claims are always the owner\'s, not the caller\'s', F + 'site-audit/index.ts', 'select service.site_audit(${c.jwtClaims}::jsonb,', "select service.site_audit('{\"sub\":\"00000000-0000-0000-0000-00000000000a\",\"aal\":\"aal1\",\"role\":\"authenticated\"}'::jsonb,", 'site-audit.test.ts'],
  ['site-audit: a refusal is not recorded against the site', F + 'site-audit/index.ts', '    c.site = site;\n', '', 'site-audit.test.ts'],
  ['site-audit: the answer is wrapped, not the database\'s', F + 'site-audit/index.ts', 'return json(200, r);', 'return json(200, { audit: r });', 'site-audit.test.ts'],
  ['site-audit: the answer is not 200 JSON', F + 'site-audit/index.ts', 'return json(200, r);', 'return json(201, r);', 'site-audit.test.ts'],
  // invite-member
  ['invite-member: a login is made even when one exists', F + 'invite-member/index.ts', '    if (!user) {', '    if (true) {', 'invite.test.ts'],
  ['invite-member: the role is always member', F + 'invite-member/index.ts', '${role}::public.member_role', "'member'::public.member_role", 'invite.test.ts'],
  ['invite-member: the team profile is not checked before the login is made', F + 'invite-member/index.ts', '${email}, ${team}::uuid) as user_id`', '${email}, null::uuid) as user_id`', 'invite.test.ts'],
  ['invite-member: the email is not lower-cased', F + 'invite-member/index.ts', '.trim().toLowerCase()', '.trim()', 'invite.test.ts'],
  ['invite-member: the answer says the email was sent whatever Auth said', F + 'invite-member/index.ts', 'email_sent: emailSent });', 'email_sent: true });', 'invite.test.ts'],
  ['invite-member: Auth is called without the secret key to make the login', F + 'invite-member/index.ts', "{ authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' },\n      body: JSON.stringify({ type: 'invite', email, data })", "{ 'content-type': 'application/json' },\n      body: JSON.stringify({ type: 'invite', email, data })", 'invite.test.ts'],
  ['invite-member: Auth is asked for a magic link, not an invite', F + 'invite-member/index.ts', "JSON.stringify({ type: 'invite', email, data })", "JSON.stringify({ type: 'magiclink', email, data })", 'invite.test.ts'],
  ['invite-member: the login is made before anyone is asked who may', F + 'invite-member/index.ts', "    const [found] = await c.sql`select service.find_login(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${email}, ${team}::uuid) as user_id`;\n    let user: string | null = found.user_id;",
    "    let user: string | null = await createLogin(email, fetchImpl);\n    const [found] = await c.sql`select service.find_login(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${email}, ${team}::uuid) as user_id`;", 'invite.test.ts'],
  ['invite-member: the mail is sent before the member is set', F + 'invite-member/index.ts', [
    ["    await c.sql`select service.set_member(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${user}::uuid, ${role}::public.member_role, ${team}::uuid)`;\n", ''],
    ['    return json(200, { user, invited: true, email_sent: emailSent });', "    await c.sql`select service.set_member(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${user}::uuid, ${role}::public.member_role, ${team}::uuid)`;\n    return json(200, { user, invited: true, email_sent: emailSent });"]], null, 'invite.test.ts'],
  ['invite-member: a new login gets the sign-in mail, not the invite', F + 'invite-member/index.ts', "${isNew ? 'invite' : 'otp'}", "otp", 'invite.test.ts'],
  ['invite-member: an existing login gets the invite mail', F + 'invite-member/index.ts', "${isNew ? 'invite' : 'otp'}", "invite", 'invite.test.ts'],
  ['invite-member: the invite mail carries no user data', F + 'invite-member/index.ts', "isNew ? { email, data } : { email, create_user: false }", "isNew ? { email } : { email, create_user: false }", 'invite.test.ts'],
  ['invite-member: the sign-in mail may create a login', F + 'invite-member/index.ts', "{ email, create_user: false }", "{ email, create_user: true }", 'invite.test.ts'],
  ['invite-member: the mail is sent without the secret key', F + 'invite-member/index.ts', "{ authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' },\n      body: JSON.stringify(isNew", "{ 'content-type': 'application/json' },\n      body: JSON.stringify(isNew", 'invite.test.ts'],
  ['invite-member: a mail Auth refused counts as sent', F + 'invite-member/index.ts', "    if (!r.ok) console.error('invite: auth mail answered', r.status);\n    return r.ok;", "    if (!r.ok) console.error('invite: auth mail answered', r.status);\n    return true;", 'invite.test.ts'],
  ['invite-member: the inviter is not named', F + 'invite-member/index.ts', "inviter: String(ctx?.inviter ?? '')", "inviter: ''", 'invite.test.ts'],
  ['invite-member: the business is not named', F + 'invite-member/index.ts', "business: String(ctx?.business ?? '')", "business: ''", 'invite.test.ts'],
  ['invite-member: the login is made without the user data', F + 'invite-member/index.ts', "body: JSON.stringify({ type: 'invite', email, data })", "body: JSON.stringify({ type: 'invite', email })", 'invite.test.ts'],
  // slice S1 (S1-E): a login that never opened its invite gets it again
  ['invite-member: an unconfirmed login gets the sign-in mail', F + 'invite-member/index.ts', 'const resend = !isNew && (await isConfirmed(user, fetchImpl)) === false;', 'const resend = false;', 'invite.test.ts'],
  ['invite-member: every existing login is sent the invite', F + 'invite-member/index.ts', 'const resend = !isNew && (await isConfirmed(user, fetchImpl)) === false;', 'const resend = !isNew;', 'invite.test.ts'],
  ['invite-member: a login Auth could not read is sent the invite', F + 'invite-member/index.ts', '(await isConfirmed(user, fetchImpl)) === false', '(await isConfirmed(user, fetchImpl)) !== true', 'invite.test.ts'],
  ['invite-member: the invite to an unconfirmed login keeps the old business', F + 'invite-member/index.ts', '(await setInviteData(user, data, fetchImpl)) && ', '', 'invite.test.ts'],
  ['invite-member: the invite goes although its user data was refused', F + 'invite-member/index.ts', '(await setInviteData(user, data, fetchImpl)) && (await sendMail(email, true, data, fetchImpl))', '(await setInviteData(user, data, fetchImpl), await sendMail(email, true, data, fetchImpl))', 'invite.test.ts'],
  ['invite-member: Auth is asked without the secret key whether a login is confirmed', F + 'invite-member/index.ts', "{ headers: { authorization: `Bearer ${key}`, apikey: key }, signal", '{ headers: {}, signal', 'invite.test.ts'],
  ['invite-member: the user data is set without the secret key', F + 'invite-member/index.ts', "method: 'PUT', headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' },", "method: 'PUT', headers: { 'content-type': 'application/json' },", 'invite.test.ts'],
  ['invite-member: the user data put is empty', F + 'invite-member/index.ts', 'body: JSON.stringify({ user_metadata: data })', 'body: JSON.stringify({ user_metadata: {} })', 'invite.test.ts'],
  // team-list and member-remove (work order 08)
  ['team-list: the workspace is not passed on', F + 'team-list/index.ts', "service.list_members(${c.jwtClaims}::jsonb, ${workspace}::uuid)", "service.list_members(${c.jwtClaims}::jsonb, ${'aaaaaaaa-0000-0000-0000-000000000000'}::uuid)", 'team.test.ts'],
  ['team-list: the email is left out', F + 'team-list/index.ts', "user: r.user_id, email: r.email,", "user: r.user_id, email: null,", 'team.test.ts'],
  ['team-list: the team profile name is left out', F + 'team-list/index.ts', "name: r.team_name,", "name: null,", 'team.test.ts'],
  ['team-list: a refusal leaves no security event', F + '_shared/dashboard.ts', "      if (r.kind) await recordEvent(sql, r.kind, r.code, { workspace: c.workspace, site: c.site, actor: c.sub, ipHash, fn });", "      /* no event */", 'team.test.ts'],
  ['member-remove: the person is not passed on', F + 'member-remove/index.ts', "${workspace}::uuid, ${user}::uuid)`;", "${workspace}::uuid, ${c.sub}::uuid)`;", 'team.test.ts'],
  ['member-remove: the answer says removed whatever happened', F + 'member-remove/index.ts', "await c.sql`select service.remove_member(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${user}::uuid)`;", "await c.sql`select 1`;", 'team.test.ts'],
  // book row B12 (slice S10): unpublish, Delete on an item (each must turn unpublish.test.ts red). Run only these: --only "unpublish [B12]"
  ['unpublish [B12]: the row is not passed on', F + 'unpublish/index.ts', 'service.unpublish(${c.jwtClaims}::jsonb, ${row}::uuid', "service.unpublish(${c.jwtClaims}::jsonb, ${'aaaaaaaa-0000-0000-0000-000000000000'}::uuid", 'unpublish.test.ts'],   // U1
  ['unpublish [B12]: the row is only taken off, not deleted', F + 'unpublish/index.ts', '${row}::uuid, true)`;', '${row}::uuid, false)`;', 'unpublish.test.ts'],   // U1
  ['unpublish [B12]: the answer says done whatever happened', F + 'unpublish/index.ts', '    await c.sql`select service.unpublish(${c.jwtClaims}::jsonb, ${row}::uuid, true)`;\n', '    await c.sql`select 1`;\n', 'unpublish.test.ts'],   // U1
  ['unpublish [B12]: a refusal of the database is answered done', F + 'unpublish/index.ts', '${row}::uuid, true)`;', '${row}::uuid, true)`.catch(() => null);', 'unpublish.test.ts'],   // U2
  ['unpublish [B12]: any text is taken as a row id', F + 'unpublish/index.ts', "const row = f.uuid('row');", "const row = typeof d.row === 'string' ? d.row : null;", 'unpublish.test.ts'],   // U3
  ['unpublish [B12-b]: taking off deletes', F + 'unpublish/index.ts', 'p_delete => false)', 'p_delete => true)', 'unpublish.test.ts'],
  ['unpublish [B12-b]: off is not read', F + 'unpublish/index.ts', '    if (off) {', '    if (false) {', 'unpublish.test.ts'],
  ['unpublish [B12-b]: back is not read', F + 'unpublish/index.ts', '    if (back) {', '    if (false) {', 'unpublish.test.ts'],
  ['publish [B12-b]: an empty publish is refused', F + 'publish/index.ts', 'none = Array.isArray(d.rows)', 'none = false && Array.isArray(d.rows)', 'unpublish.test.ts'],
  // work order 18 (migration 22): saved views, follow-up and tasks, the due and duplicates filters (each must turn crm3b.test.ts red). Run only these: --only "crm3b"
  ['crm3b view-save: shared is always false', F + 'view-save/index.ts', 'shared: shared === true }', 'shared: false }', 'crm3b.test.ts'],
  ['crm3b view-save: the id is dropped', F + 'view-save/index.ts', 'const view = { ...(id ? { id } : {}), name,', 'const view = { name,', 'crm3b.test.ts'],
  ['crm3b view-save: the workspace is not passed on', F + 'view-save/index.ts', 'service.view_save(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${view}::jsonb)', "service.view_save(${c.jwtClaims}::jsonb, ${'aaaaaaaa-0000-0000-0000-000000000000'}::uuid, ${view}::jsonb)", 'crm3b.test.ts'],
  ['crm3b view-save: columns need not be texts', F + 'view-save/index.ts', " || !columns.every(x => typeof x === 'string')", '', 'crm3b.test.ts'],
  ['crm3b view-save: any number of columns at the edge', F + 'view-save/index.ts', 'columns.length > 60 || ', '', 'crm3b.test.ts'],
  ['crm3b view-save: the query may be a list', F + 'view-save/index.ts', ' || Array.isArray(query)', '', 'crm3b.test.ts'],
  ['crm3b view-save: the name has no limit at the edge', F + 'view-save/index.ts', '{ max: 60, required: true }', '{ max: 6000, required: true }', 'crm3b.test.ts'],
  ['crm3b view-delete: the view is not passed on', F + 'view-delete/index.ts', 'service.view_delete(${c.jwtClaims}::jsonb, ${view}::uuid)', 'service.view_delete(${c.jwtClaims}::jsonb, ${c.sub}::uuid)', 'crm3b.test.ts'],
  ['crm3b view-delete: nothing is deleted', F + 'view-delete/index.ts', '    await c.sql`select service.view_delete(${c.jwtClaims}::jsonb, ${view}::uuid)`;\n', '    await c.sql`select 1`;\n', 'crm3b.test.ts'],
  ['crm3b lead-task: both shapes, or neither, are accepted', F + 'lead-task/index.ts', 'if (adding === marking) f.problems.push(', 'if (false) f.problems.push(', 'crm3b.test.ts'],
  ['crm3b lead-task: the text is not passed on', F + 'lead-task/index.ts', '${lead}::uuid, ${text}, ${due}::timestamptz', "${lead}::uuid, ${'x'}, ${due}::timestamptz", 'crm3b.test.ts'],
  ['crm3b lead-task: the due time is not passed on', F + 'lead-task/index.ts', '${lead}::uuid, ${text}, ${due}::timestamptz', '${lead}::uuid, ${text}, ${null}::timestamptz', 'crm3b.test.ts'],
  ['crm3b lead-task: done is always true', F + 'lead-task/index.ts', '${task}::uuid, ${done}::boolean', '${task}::uuid, ${true}::boolean', 'crm3b.test.ts'],
  ['crm3b lead-task: the due time is not checked', F + 'lead-task/index.ts', "f.instant('due')", "(typeof d.due === 'string' ? d.due : null)", 'crm3b.test.ts'],
  ['crm3b lead-task: an add answers 200', F + 'lead-task/index.ts', 'json(201, { task: created })', 'json(200, { task: created })', 'crm3b.test.ts'],
  ['crm3b lead-task: marking does not say what it set', F + 'lead-task/index.ts', 'json(200, { task, done })', 'json(200, { task })', 'crm3b.test.ts'],
  ['crm3b lead-update: follow_up is ignored', F + 'lead-update/index.ts', "      if (setFollowUp) await tx`select service.lead_follow_up(${c.jwtClaims}::jsonb, ${lead}::uuid, ${followUp}::timestamptz)`;\n", '', 'crm3b.test.ts'],
  ['crm3b lead-update: a null follow_up does not clear', F + 'lead-update/index.ts', "'follow_up' in d && d.follow_up !== undefined", "'follow_up' in d && d.follow_up != null", 'crm3b.test.ts'],
  ['crm3b lead-update: follow_up is not checked', F + 'lead-update/index.ts', "followUp = f.instant('follow_up')", "followUp = typeof d.follow_up === 'string' ? d.follow_up : null", 'crm3b.test.ts'],
  ['crm3b lead-list: due is dropped', F + 'lead-list/index.ts', '    if (due !== null) q.due = due;\n', '', 'crm3b.test.ts'],
  ['crm3b lead-list: duplicates is dropped', F + 'lead-list/index.ts', '    if (duplicates !== null) q.duplicates = duplicates;\n', '', 'crm3b.test.ts'],
  ['crm3b lead-list: due need not be true or false at the edge', F + 'lead-list/index.ts', "due = f.bool('due')", 'due = (d.due ?? null) as boolean | null', 'crm3b.test.ts'],
  ['crm3b http: an instant may be a day that does not exist', F + '_shared/http.ts', ' && t.getUTCDate() === d && mi < 60', ' && mi < 60', 'instant.test.ts'],
  ['crm3b http: an instant needs no offset', F + '_shared/http.ts', '(?:Z|[+-](?:0\\d|1[0-5]):[0-5]\\d)$/.exec(v)', '(?:Z|[+-](?:0\\d|1[0-5]):[0-5]\\d)?$/.exec(v)', 'instant.test.ts'],
  ['crm3b http: an instant may carry an offset of any hours', F + '_shared/http.ts', '(?:Z|[+-](?:0\\d|1[0-5]):', '(?:Z|[+-]\\d{2}:', 'instant.test.ts'],
  ['crm3b http: an instant may have 60 minutes or more', F + '_shared/http.ts', 'mi < 60 && s < 60', 's < 60', 'instant.test.ts'],
  ['crm3b http: an instant may have 60 seconds or more', F + '_shared/http.ts', 'mi < 60 && s < 60', 'mi < 60', 'instant.test.ts'],
  ['crm3b db: the words of an I-ANSWER may not name a key with an underscore', F + '_shared/db.ts', "([A-Za-z0-9_ ().,;'\\-]{1,160}?)", "([A-Za-z0-9 ().,;'\\-]{1,160}?)", 'crm3b.test.ts'],
  ['crm3b http: Fields.instant lets a number through', F + '_shared/http.ts', "if (typeof v !== 'string' || !isInstant(v)) return this.bad('TYPE', k, 'A date and time", "if (typeof v === 'string' && !isInstant(v)) return this.bad('TYPE', k, 'A date and time", 'crm3b.test.ts'],
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
  // work order 20 (migration 23): lead type and status lists as data (each must turn crm20.test.ts, capture.test.ts or export.test.ts red). Run only these: --only "crm20"
  ['crm20 db: the refusal words may not hold a semicolon', F + '_shared/db.ts', "([A-Za-z0-9_ ().,;'\\-]{1,160}?)", "([A-Za-z0-9_ ().,'\\-]{1,160}?)", 'crm20.test.ts'],
  ['crm20 lead-update: the status date is not passed on', F + 'lead-update/index.ts', '${statusDate}::date', '${null}::date', 'crm20.test.ts'],
  ['crm20 lead-update: the status person is not passed on', F + 'lead-update/index.ts', '${statusWho}::uuid', '${null}::uuid', 'crm20.test.ts'],
  ['crm20 lead-update: the status line is not passed on', F + 'lead-update/index.ts', '${statusText}::text)', '${null}::text)', 'crm20.test.ts'],
  ['crm20 http: a status date may have a day that does not exist', F + '_shared/http.ts', 'return t.toISOString().slice(0, 10) === v;', 'return true;', 'crm20.test.ts'],
  // both guards go: the anchored pattern and the read-back (which on its own also refuses a time, since the day read back is shorter than what was sent)
  ['crm20 http: a status date may carry a time', F + '_shared/http.ts', "const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(v);\n  if (!m) return false;\n  const [y, mo, d] = [m[1], m[2], m[3]].map(Number);\n  const t = new Date(Date.UTC(y, mo - 1, d));\n  return t.toISOString().slice(0, 10) === v;", "const m = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(v);\n  if (!m) return false;\n  const [y, mo, d] = [m[1], m[2], m[3]].map(Number);\n  const t = new Date(Date.UTC(y, mo - 1, d));\n  return t.toISOString().slice(0, 10) === v.slice(0, 10);", 'crm20.test.ts'],
  ['crm20 http: Fields.day lets a number through', F + '_shared/http.ts', "if (typeof v !== 'string' || !isDay(v)) return this.bad('TYPE', k, 'A date like 2026-11-20.');", "if (typeof v === 'string' && !isDay(v)) return this.bad('TYPE', k, 'A date like 2026-11-20.');", 'crm20.test.ts'],
  ['crm20 lead-export: the due tick is not passed to the list', F + 'lead-export/index.ts', 'if (d.due !== undefined) q.due = d.due;', '', 'export.test.ts'],
  ['crm20 lead-export: the duplicates tick is not passed to the list', F + 'lead-export/index.ts', 'if (d.duplicates !== undefined) q.duplicates = d.duplicates;', '', 'export.test.ts'],
  ['crm20 lead-export: a tick that is not true or false is not refused here', F + 'lead-export/index.ts', "if (d[k] !== undefined && typeof d[k] !== 'boolean') f.problems.push({ code: 'TYPE', path: k, msg: 'True or false.' });", '', 'export.test.ts'],
  ['crm20 lead-export: the new filter reads the old status', F + 'lead-export/index.ts', "tx`and l.status = 'not-contacted'`", "tx`and l.status = 'new'`", 'export.test.ts'],

  // work order 44 (migration 27): the metrics functions and job-callback's sitemap step (each must turn metrics.test.ts red). Run only these: --only "metrics"
  ['metrics: the cron key is read from the runner key\'s variable', F + '_shared/runner.ts', "const keyEnv = o.keyEnv ?? 'RUNNER_KEY';", "const keyEnv = 'RUNNER_KEY';", 'metrics.test.ts'],
  ['metrics: the cron signature is read from the runner header', F + '_shared/runner.ts', "req.headers.get(o.header ?? 'x-runner-signature')", "req.headers.get('x-runner-signature')", 'metrics.test.ts'],
  ['metrics: a bad cron signature is recorded as a runner event', F + '_shared/runner.ts', "kind: o.keyEnv ? 'cron' : 'runner'", "kind: 'runner'", 'metrics.test.ts'],
  ['metrics: metrics-pull takes any source', F + 'metrics-pull/index.ts', "    if (only !== null && only !== 'pagespeed') return problem(400, 'BODY', 'source is pagespeed, or leave it out.');\n", '', 'metrics.test.ts'],
  ['metrics: metrics-pull pulls a workspace that is not a target', F + 'metrics-pull/index.ts', 'select * from service.metrics_targets() where workspace_id = ${c.id}::uuid`', 'select * from service.metrics_targets() limit 1`', 'metrics.test.ts'],
  ['metrics: Bing is asked about a preview site', F + 'metrics-pull/index.ts', "site: t.site_state === 'live' && t.domain ? `https://${t.domain}/` : undefined, indexnow", 'site: `https://${t.domain ?? t.host}/`, indexnow', 'metrics.test.ts'],
  ['metrics: the day\'s IndexNow list is dropped when the bing row is rebuilt', F + 'metrics-pull/index.ts', 'const indexnow = Array.isArray(d?.indexnow) ? d.indexnow : [];', 'const indexnow: unknown[] = [];', 'metrics.test.ts'],
  ['metrics: PageSpeed runs every day', F + 'metrics-pull/index.ts', 'if (!pagespeedDue(last, d, day))', 'if (false)', 'metrics.test.ts'],
  ['metrics: the sitemap is read without a PSI key', F + 'metrics-pull/index.ts', 'if (keys.PSI_API_KEY) {   // the one polite request', 'if (true) {   // the one polite request', 'metrics.test.ts'],
  ['metrics: every page of the sitemap is measured, not five', F + 'metrics-pull/index.ts', 'urls = pickPages(sitemapLocs(await r.text(), new URL(origin).host), origin);', 'urls = sitemapLocs(await r.text(), new URL(origin).host);', 'metrics.test.ts'],
  ['metrics: a live site is measured at its preview host', F + '_shared/metrics.ts', "const h = t.site_state === 'live' && t.domain ? t.domain : t.host;", 'const h = t.host;', 'metrics.test.ts'],
  ['metrics: sitemapLocs keeps addresses of other hosts', F + '_shared/metrics.ts', "&& p.host === host && !out.includes(u)", '&& !out.includes(u)', 'metrics.test.ts'],
  ['metrics: sitemapLocs does not decode &amp;', F + '_shared/metrics.ts', ".replace(/&amp;/g, '&')", '', 'metrics.test.ts'],
  ['metrics: pickPages takes every page of a section', F + '_shared/metrics.ts', 'if (seen.has(section) || u === home) continue;', 'if (u === home) continue;', 'metrics.test.ts'],
  ['metrics: pagespeedDue ignores a BLOCKED last row', F + '_shared/metrics.ts', 'if (lastData && lastData.blocked) return true;\n', '', 'metrics.test.ts'],
  ['metrics: pagespeedDue after six days', F + '_shared/metrics.ts', 'return dayNumber(day) - dayNumber(lastDay) >= 7;', 'return dayNumber(day) - dayNumber(lastDay) >= 6;', 'metrics.test.ts'],
  ['metrics: a preview site is submitted', F + '_shared/sitemap.ts', "if (t.site_state !== 'live' || !t.domain) return", 'if (false) return', 'metrics.test.ts'],
  ['metrics: IndexNow is pinged with no key file', F + '_shared/sitemap.ts', 'const k = deps.indexNow?.(target) ?? null;', "const k = deps.indexNow?.(target) ?? { key: 'k', keyLocation: `${origin}/k.txt` };", 'metrics.test.ts'],
  ['metrics: the ping is not recorded', F + '_shared/sitemap.ts', "  await sql`select service.metrics_put(${target.workspace_id}::uuid, 'bing', ${day}::date, ${row.data}::jsonb)`;\n", '', 'metrics.test.ts'],
  ['metrics: a second ping replaces the day\'s list', F + '_shared/sitemap.ts', 'appendIndexNow(d ? { workspace_id: target.workspace_id, source: \'bing\', day, data: d } : null,', 'appendIndexNow(null,', 'metrics.test.ts'],
  ['metrics: job-callback submits the sitemap for a preview job', F + 'job-callback/index.ts', "(report?.audit as { target?: unknown } | undefined)?.target === 'production'", 'true', 'metrics.test.ts'],
  ['metrics: job-callback submits the sitemap on a failed job', F + 'job-callback/index.ts', "if (state === 'done' && (report?.audit", 'if ((report?.audit', 'metrics.test.ts'],
  ['metrics: a failed sitemap step fails the callback', F + 'job-callback/index.ts', "try { await submitForJob(c.sql, job, deps); } catch (e) { console.error('job-callback: the sitemap was not submitted', String(e).slice(0, 200)); }", 'await submitForJob(c.sql, job, deps);', 'metrics.test.ts'],
  // ---- E4: the mail outbox worker and the queued alert ----
  ['E4 mail-outbox: a bad signature is let through', F + 'mail-outbox/index.ts', 'if (!signed) {', 'if (false) {', 'outbox.test.ts'],
  ['E4 mail-outbox: Resend has no timeout', F + 'mail-outbox/index.ts', 'signal: AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS)', 'signal: undefined', 'outbox.test.ts'],
  ['E4 mail-outbox: no idempotency key goes to Resend', F + 'mail-outbox/index.ts', "'idempotency-key': r.message_id", "'x-none': r.message_id", 'outbox.test.ts'],
  ['E4 mail-outbox: Resend\'s answer is not recorded', F + 'mail-outbox/index.ts', 'await sql`select service.outbox_done(${r.message_id}::uuid, ${ok}, ${id}, ${err})`;', 'void 0;', 'outbox.test.ts'],
  ['E4 mail-outbox: it runs without the Resend key or the sender', F + 'mail-outbox/index.ts', 'if (!key || !apiKey || !from) return problem(500', 'if (!key) return problem(500', 'outbox.test.ts'],
  ['E4 lead-alert: the link has no workspace', F + '_shared/lead-alert.ts', '/w/${r.workspace_slug}/leads/${r.lead_id}', '/leads/${r.lead_id}', 'outbox.test.ts'],
  ['E4 capture-lead: the alert is not queued', F + 'capture-lead/index.ts', 'await sql`select service.queue_lead_alert(${site}::uuid, ${row.id}::uuid)`;', 'void 0;', 'capture.test.ts'],
  // ---- E5: the visitor limit in capture-lead ----
  ['E5 capture-lead: the visitor is not counted', F + 'capture-lead/index.ts', 'await sql`select service.count_visitor(${site}::uuid, ${visitor})`;', 'void 0;', 'capture.test.ts'],
  ['E5 capture-lead: any visitor text is a visitor', F + 'capture-lead/index.ts', 'const VISITOR = /^[0-9a-f]{64}$/;', 'const VISITOR = /^.+$/;', 'capture.test.ts'],
  ['E5 capture-lead: the lead stores the caller\'s address hash, not the visitor\'s', F + 'capture-lead/index.ts', '${L.assignee}, ${visitor}, ${ua})', '${L.assignee}, ${ipHash}, ${ua})', 'capture.test.ts'],
  // ---- E21: the Resend webhook ----
  ['E21 mail-events: a bad signature is let through', F + 'mail-events/index.ts', 'if (!ok) {', 'if (false) {', 'mail-events.test.ts'],
  ['E21 mail-events: an old timestamp is accepted', F + 'mail-events/index.ts', 'Math.abs(now - Number(ts)) > TOLERANCE_S', 'false', 'mail-events.test.ts'],
  ['E21 mail-events: only the first signature of the header is tried', F + 'mail-events/index.ts', "header.split(' ').some(", "header.split(' ').slice(0, 1).some(", 'mail-events.test.ts'],
  ['E21 mail-events: a temporary bounce suppresses', F + 'mail-events/index.ts', "e?.data?.bounce?.type === 'Permanent'", 'true', 'mail-events.test.ts'],
  ['E21 mail-events: the body is not signed', F + 'mail-events/index.ts', '`${id}.${ts}.${body}`', '`${id}.${ts}.`', 'mail-events.test.ts'],
  ['E21 mail-events: a complaint suppresses for the whole platform', F + 'mail-events/index.ts', "e?.type === 'email.complained' ? 'complaint'", "e?.type === 'email.complained' ? 'bounce'", 'mail-events.test.ts'],
  ['E21 mail-events: a secret that is not base64 is not refused', F + 'mail-events/index.ts', '  } catch { return null; }', '  } catch { return new Uint8Array(0); }', 'mail-events.test.ts'],
  // ---- E3: the request id and the error sink ----
  ['E3 http: the answer has no x-request-id header', F + '_shared/http.ts', "headers.set('x-request-id', id);", '', 'request-id.test.ts'],
  ['E3 http: a problem does not name the request id', F + '_shared/http.ts', ', ...(requestId() ? { request_id: requestId() } : {})', '', 'request-id.test.ts'],
  ['E3 http: a log line of a call does not start with its id', F + '_shared/http.ts', 'logSink.write(level, id ? [`request ${id}`, ...args] : args);', 'logSink.write(level, args);', 'request-id.test.ts'],
  ['E3 http: every call has the same id', F + '_shared/http.ts', 'const id = crypto.randomUUID();', "const id = '00000000-0000-4000-8000-000000000000';", 'request-id.test.ts'],
  ['E3 http: a 5xx answer is not counted', F + '_shared/http.ts', 'if (res.status >= 500) { try { await record(', 'if (false) { try { await record(', 'request-id.test.ts'],
  ['E3 http: a handler that throws gets no answer', F + '_shared/http.ts', "catch (e) { console.error(fn, 'threw', String(e).slice(0, 300)); res = problem(500, 'SERVER', 'Something went wrong on our side.'); }", 'catch (e) { throw e; }', 'request-id.test.ts'],
  ['E3 http: a sink that fails fails the answer', F + '_shared/http.ts', "try { await record(fn, res.status, id); } catch (e) { console.error('function error not recorded', String(e).slice(0, 160)); }", 'await record(fn, res.status, id);', 'request-id.test.ts'],
  ['E3 drafts: the function serves without the request id', F + 'drafts/index.ts', "if (import.meta.main) serve('drafts', handle);", 'if (import.meta.main) Deno.serve(handle);', 'request-id.test.ts'],
  // ---- E9: the dispatch token, new name first ----
  ['E9 dispatch: the old token wins', F + '_shared/dispatch.ts', "token = v2 || Deno.env.get('GITHUB_DISPATCH_TOKEN')", "token = Deno.env.get('GITHUB_DISPATCH_TOKEN') || v2", 'db.test.ts'],
  ['E9 dispatch: the new token goes to repository_dispatch', F + '_shared/dispatch.ts', 'const [path, body] = v2 ?', 'const [path, body] = false ?', 'db.test.ts'],
  ['E9 dispatch: the old token goes to the workflow file', F + '_shared/dispatch.ts', 'const [path, body] = v2 ?', 'const [path, body] = token ?', 'db.test.ts'],
  ['E9 dispatch: no ref', F + '_shared/dispatch.ts', "{ ref: 'master', inputs }", '{ inputs }', 'db.test.ts'],
  ['E9 dispatch: the old token is never read', F + '_shared/dispatch.ts', "|| Deno.env.get('GITHUB_DISPATCH_TOKEN')", '', 'db.test.ts'],
  // ---- E16: plan limits in plain words ----
  ['E16 db: S-LIMIT is not a refusal', F + '_shared/db.ts', "  if (has('S-LIMIT')) {", '  if (false) {', 'limits.test.ts'],
  ['E16 db: S-LIMIT passes any database text', F + '_shared/db.ts', '(sites|MB of photos and files|publishes today)', '(.+?)', 'limits.test.ts'],
  // ---- E6: pooled connections (DB_POOLER_URL, a step-down per statement). Run only these: --only "E6 |db: no step-down" ----
  ['E6 db: the door reads the direct address', F + '_shared/db.ts', "const url = Deno.env.get('DB_POOLER_URL');", "const url = Deno.env.get('SUPABASE_DB_URL');", 'db.test.ts'],
  ['E6 db: no pooler address falls back to the direct one', F + '_shared/db.ts', "const url = Deno.env.get('DB_POOLER_URL');", "const url = Deno.env.get('DB_POOLER_URL') ?? Deno.env.get('SUPABASE_DB_URL');", 'db.test.ts'],
  ['E6 db: the step-down is a session SET', F + '_shared/db.ts', "await tx.unsafe('set local role omnikom_fn');", "await tx.unsafe('set role omnikom_fn');", 'db.test.ts'],
  ['E6 db: a statement runs outside a transaction', F + '_shared/db.ts', 'inTx((tx: Sql) => tx(strings, ...values))', 'base(strings, ...values)', 'db.test.ts'],
  ['E6 db: sql.begin does not step down', F + '_shared/db.ts', '=> inTx(run), array:', '=> base.begin(run), array:', 'db.test.ts'],
  ['E6 capture-lead: its own connection to the direct address', F + 'capture-lead/index.ts', 'try { sql = await connect(); }', "try { sql = (await import('npm:postgres@3.4.5')).default(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false }); }", 'db.test.ts'],
  ['publish [B15]: no ready draft still starts a preview', F + 'publish/index.ts', "if (!out.job) return problem(422, 'NOTHING-TO-PREVIEW',", "if (false) return problem(422, 'NOTHING-TO-PREVIEW',", 'publish.test.ts'],
  ['publish [B15]: a preview body must name rows', F + 'publish/index.ts', "rows = preview || none ? [] : f.uuids('rows', 200)", "rows = none ? [] : f.uuids('rows', 200)", 'publish.test.ts'],
  ['publish [B15]: the left-out drafts are not named', F + 'publish/index.ts', 'reason: sent.reason, left_out: left })', 'reason: sent.reason, left_out: [] })', 'publish.test.ts'],
  ['media-manage: replace may put a file in its own place', F + 'media-manage/index.ts', 'if (other && other === media) ', 'if (false) ', 'media-manage.test.ts'],
  ['media-manage: an unknown action deletes', F + 'media-manage/index.ts', "if (action && action !== 'replace' && action !== 'delete') ", 'if (false) ', 'media-manage.test.ts'],
  ['media-manage: a replace skips the save checks', F + 'media-manage/index.ts', 'for (const it of changed) for', 'for (const it of changed.slice(0, 0)) for', 'media-manage.test.ts'],
  ['media-manage: a refused replace is kept', F + 'media-manage/index.ts', 'if (problems.length) throw new Error(', 'if (false) throw new Error(', 'media-manage.test.ts'],
  ['media-manage: Storage keeps the three sizes', F + 'media-manage/index.ts', 'body: JSON.stringify({ prefixes: paths })', 'body: JSON.stringify({ prefixes: paths.slice(0, 1) })', 'media-manage.test.ts'],
  ['media-manage: Storage is asked without the secret key', F + 'media-manage/index.ts', "headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' }", "headers: { 'content-type': 'application/json' }", 'media-manage.test.ts'],
  ['media-manage: the record is deleted although Storage refused', F + 'media-manage/index.ts', 'if (!r.ok) refused = ', 'if (false) refused = ', 'media-manage.test.ts'],
  ['media-manage: a refused delete is committed, not rolled back', F + 'media-manage/index.ts', 'if (refused) throw new Error(', 'if (false) throw new Error(', 'media-manage.test.ts'],
  ['media-manage: Storage has no time limit', F + 'media-manage/index.ts', ', signal: AbortSignal.timeout(10000) })', ' })', 'media-manage.test.ts'],
  ['media-manage: a file in use is a server error, not 409', F + '_shared/db.ts', "  if (has('S-MEDIA-IN-USE')) return", '  if (false) return', 'media-manage.test.ts'],
  // ---- E13-d: publish validation in 3 statements ----
  ['E13-d validate: the batch\'s photos are not kept', F + '_shared/validate.ts', '      for (const g of got) this.files.set(askFiles[Number(g.i) - 1], g.facts ?? null);', '      void got;', 'publish-batch.test.ts'],
  ['E13-d validate: the batch\'s references are not kept', F + '_shared/validate.ts', '      for (const g of got) this.refs.set(askRefs[Number(g.i) - 1][0], g.ok === true);', '      void got;', 'publish-batch.test.ts'],
  ['E13-d publish: nothing is asked before the rows are checked', F + 'publish/index.ts', "  await validator.prefetch(pinned, 'publish');\n", '', 'publish-batch.test.ts'],
  ['E13-d publish: a problem names the next row', F + 'publish/index.ts', 'row: rows[v.i - 1] }', 'row: rows[v.i] }', 'publish-batch.test.ts'],
  ['E13-d validate: the cap is below a full publish', F + '_shared/validate.ts', 'const MAX_LOOKUPS = 2000;', 'const MAX_LOOKUPS = 199;', 'publish-batch.test.ts'],
];

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const plan = planShard(process.argv, MUTANTS, only);   // --only a|b (any of the substrings), then the share of --shard i/N; --list prints and stops
// one write, awaited until it is flushed: console.log per line then process.exit dropped the tail of --list into a pipe (CI 42950225902 read 189
// of 255 rows; the CLI's mutate.mjs had the same bug, 6dadcdb). Made by CLI and testing, reviewed by the platform head 2026-11-11 06:22.
if (plan.lines.length) await new Promise(done => process.stdout.write(plan.lines.join('\n') + '\n', done));
if (plan.exit !== null) process.exit(plan.exit);
const { list, label } = plan;
const work = mkdtempSync(join(tmpdir(), 'omnikom-fn-mut-'));
cpSync(join(REPO, 'supabase', 'functions'), join(work, 'supabase', 'functions'), { recursive: true });
symlinkSync(join(REPO, 'contracts'), join(work, 'contracts'), 'junction');
mkdirSync(join(work, 'tools'));
symlinkSync(join(REPO, 'tools', 'crm-map'), join(work, 'tools', 'crm-map'), 'junction');   // work order 02: _shared/crm-map.ts imports tools/crm-map
mkdirSync(join(work, 'tools', 'audit'));
symlinkSync(join(REPO, 'tools', 'audit', 'metrics'), join(work, 'tools', 'audit', 'metrics'), 'junction');   // work order 44: _shared/metrics.ts imports tools/audit/metrics
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
    for (const [name, file, find, to, scope] of list) {
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
    console.log(`\n${label}${ran} mutants,${caught} caught, ${survived} survived, ${missing} target text missing${broken ? `, ${broken} broken` : ''}`);
    process.exitCode = (caught === ran && !survived && !missing && !broken) ? 0 : 1;
  }
} finally { await api.stop(); rmSync(work, { recursive: true, force: true }); }
