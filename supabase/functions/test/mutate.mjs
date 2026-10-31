// Mutation test of the dashboard Edge Functions (slice 4.2): remove ONE check from a COPY of the source and require the Deno tests to go
// red. A check whose mutant stays green has no test. Ends: `N mutants, N caught, 0 survived, 0 target text missing`.
//   node supabase/functions/test/mutate.mjs [--only <name substring>]
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
    for (const [name, file, find, to] of MUTANTS) {
      if (only && !name.includes(only)) continue;
      ran++;
      const path = join(work, file);
      const orig = readFileSync(join(REPO, file), 'utf8');
      const n = orig.split(find).length - 1;
      if (n !== 1) { missing++; console.log(`TARGET TEXT MISSING (${n} matches): ${name}`); continue; }
      writeFileSync(path, orig.split(find).join(to));
      const r = await denoTest(api, testDir, { noCheck: true, cwd: work });
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
