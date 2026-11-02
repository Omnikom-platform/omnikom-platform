// Tests of the build runner (slice 4.4): publish.mjs, media.mjs, the machine-call signature and tools/github-secrets.mjs.
// Plain script: one line per check, ends "OK: N of N checks passed" (exit 0) or "FAILED: k of N" (exit 1).
// Everything the runner talks to is a local fake (test/lib/fake-platform.mjs, fake-wrangler.mjs, fake-gh.mjs): no staging, no Cloudflare,
// no GitHub. The platform's OWN verify (supabase/functions/_shared/signature.ts, Node type stripping) judges every signature the
// runner sends. The media checks need sharp (npm ci --prefix factory/runner); without it they print SKIP and are not counted.
// RUNNER_DIR points the tests at another copy of factory/runner and SECRETS_TOOL at another github-secrets.mjs (test/mutate.mjs runs
// broken copies); RUNNER_TEST_BAIL=1 stops at the first FAIL (the mutants only need one red line).
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startFake } from './lib/fake-platform.mjs';
import { GPS_BYTES, gpsTiff, webpChunks, webpSize, withExif } from './lib/exif.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const REAL_RUNNER = join(REPO, 'factory', 'runner');
const RUNNER = process.env.RUNNER_DIR ? resolve(process.env.RUNNER_DIR) : REAL_RUNNER;
const SECRETS_TOOL = process.env.SECRETS_TOOL ? resolve(process.env.SECRETS_TOOL) : join(REPO, 'tools', 'github-secrets.mjs');
const BAIL = process.env.RUNNER_TEST_BAIL === '1';
const ONLY = (process.env.RUNNER_TEST_ONLY || '').split(',').filter(Boolean);   // section names; empty = all (the mutants run only the sections their target is judged in)
const on = (name) => !ONLY.length || ONLY.includes(name);
const load = (p) => import(pathToFileURL(p).href);

let passed = 0, failed = 0;
const made = [];
const cleanup = () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* temp folder */ } } };
async function check(name, fn) {
  let ok = false, detail = '';
  try { const r = await fn(); ok = r === true || r === undefined; if (!ok) detail = String(r); } catch (e) { detail = `threw: ${String((e && e.message) || e).slice(0, 240)}`; }
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  ' + detail}`);
  if (!ok && BAIL) { console.log(`FAILED: ${failed} of ${passed + failed} (bail)`); cleanup(); process.exit(1); }
}
const tmp = (tag) => { const d = mkdtempSync(join(tmpdir(), `omnikom-runner-${tag}-`)); made.push(d); return d; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);   // a boolean, never a message: a string would count as true inside && chains

// ---------- the pieces under test and the platform's own code ----------
let PLATFORM, SIGN, COMMON, CLI_SIGN, WORKER;
try {
  PLATFORM = await load(join(REPO, 'supabase', 'functions', '_shared', 'signature.ts'));
  SIGN = await load(join(RUNNER, 'lib', 'sign.mjs'));
  COMMON = await load(join(RUNNER, 'lib', 'common.mjs'));
  CLI_SIGN = await load(join(REPO, 'tools', 'omnikom-cli', 'lib', 'sign.mjs'));
  WORKER = await load(join(REPO, 'factory', 'worker', 'lead-endpoint.mjs'));
} catch (e) { console.log(`FAIL import: ${String((e && e.message) || e).split('\n')[0]}`); console.log('FAILED: the modules under test could not be loaded'); process.exit(1); }

const FIXTURE = JSON.parse(readFileSync(join(REPO, 'factory', 'test', 'fixtures', 'export-test-demo-a.json'), 'utf8'));
const LOGO = readFileSync(join(REPO, 'sites', 'test-demo-a', 'media', 'logo.png'));
const JOB = FIXTURE.job.id, SITE = FIXTURE.site.id;
const SITE_B = 'bbbbbbbb-0000-0000-0000-00000000517e';
const RUNNER_KEY = 'runner-key-NOT-A-SECRET-for-tests-0123456789';
const CF_TOKEN = 'cf-token-NOT-A-SECRET-9876543210', CF_ACCOUNT = 'acct0123456789abcdef0123456789ab';
const HAS_SHARP = existsSync(join(REAL_RUNNER, 'node_modules', 'sharp')) && existsSync(join(RUNNER, 'node_modules', 'sharp'));

// ---------- running a child process while the fake server in this process keeps answering ----------
function spawnNode(script, args, env, timeoutMs = 180000) {
  return new Promise((done) => {
    const began = Date.now();
    const p = spawn(process.execPath, [script, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', killed = false;
    const t = setTimeout(() => { killed = true; p.kill('SIGKILL'); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => { clearTimeout(t); if (process.env.RUNNER_TEST_TIMING) console.log(`     (${basename(script)} ${Date.now() - began} ms)`); done({ code: killed ? 'timeout' : code, out }); });
  });
}
const BASE_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(JOB_ID|SITE_ID|MEDIA_ID|WORKSPACE_ID|RUNNER_|PLATFORM_|CLOUDFLARE_|STAGING_|FAKE_|GH_|OMNIKOM_)/.test(k)));

async function runPublish(o = {}) {
  const dir = tmp('pub'), deployDir = join(dir, 'deployed'), work = join(dir, 'work');
  const fixture = clone(FIXTURE);
  if (o.exportMut) o.exportMut(fixture);
  let fake;
  const cfg = {
    siteDir: deployDir,
    exportBody: () => { const e = clone(fixture); e.media = e.media.map((m) => ({ ...m, url: o.mediaUrl ? o.mediaUrl(m, fake.origin) : `${fake.origin}/storage/object/sign/media/${m.path}?token=SIGNEDTOKEN123` })); return e; },
    files: { '/storage/object/sign/media/logo.png': LOGO },
    ...(o.cfg || {}),
  };
  fake = await startFake({ runnerKey: RUNNER_KEY, verify: PLATFORM.verify, cfg });
  const smoke = ['--smoke-url', `${fake.origin}/site/`, '--smoke-tries', String(o.smokeTries ?? 2), '--smoke-interval-ms', '40'];
  const args = o.args ? o.args({ deployDir, work, smoke }) : ['--no-deploy', deployDir, '--work', work, ...smoke];
  const env = { ...BASE_ENV, JOB_ID: JOB, SITE_ID: SITE, PLATFORM_FUNCTIONS_BASE: fake.base, RUNNER_KEY, CLOUDFLARE_PAGES_TOKEN: CF_TOKEN, CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT,
    OMNIKOM_REPO_ROOT: REPO, RUNNER_RETRY_BACKOFF_MS: '20', RUNNER_CF_API_BASE: `${fake.origin}/cf`, ...(o.env || {}) };
  for (const k of o.unset || []) delete env[k];
  const r = await spawnNode(join(RUNNER, 'publish.mjs'), args, env, o.timeoutMs || 180000);
  await fake.close();
  const states = fake.log.callbacks.map((c) => c.body.state);
  return { ...r, fake, log: fake.log, dir, deployDir, work, states, last: fake.log.callbacks[fake.log.callbacks.length - 1] };
}

// ================= 1. the signature =================
if (on('signature')) {
const KNOWN = 't=1700000000,v1=dc7dd38a8a6708b4f17217cdfbb7bc2357b68c0db10b275962a598b52df260c3';
await check('signature: the known vector (key k, GET /x?a=1, empty body, t=1700000000) is the one the platform code produced', async () =>
  (await SIGN.sign('k', 'GET', '/x?a=1', '', 1700000000)) === KNOWN || 'the runner signs differently from the vector');
await check('signature: equals an independent HMAC over t, METHOD, path?query and body', async () => {
  const mac = createHmac('sha256', 'key-2').update('1700000123\nPOST\n/job-callback\n{"a":1}').digest('hex');
  return (await SIGN.sign('key-2', 'post', '/job-callback', '{"a":1}', 1700000123)) === `t=1700000123,v1=${mac}`;
});
await check('signature: identical to supabase/functions/_shared/signature.ts, to factory/worker/lead-endpoint.mjs and to the CLI re-export', async () => {
  const a = await SIGN.sign('k2', 'POST', '/job-callback', '{"job":"j"}', 1750000000);
  return a === await PLATFORM.sign('k2', 'POST', '/job-callback', '{"job":"j"}', 1750000000) && a === await WORKER.sign('k2', 'POST', '/job-callback', '{"job":"j"}', 1750000000)
    && a === await CLI_SIGN.sign('k2', 'POST', '/job-callback', '{"job":"j"}', 1750000000);
});
await check("signature: the platform's verify accepts the runner's header and refuses another body, path, method or key", async () => {
  const now = 1750000010, body = '{"job":"j","state":"gating"}';
  const h = await SIGN.sign('k3', 'POST', '/job-callback', body, 1750000000);
  return (await PLATFORM.verify(h, 'k3', 'POST', '/job-callback', body, now)) === true
    && (await PLATFORM.verify(h, 'k3', 'POST', '/job-callback', body + ' ', now)) === false
    && (await PLATFORM.verify(h, 'k3', 'POST', '/media-process-callback', body, now)) === false
    && (await PLATFORM.verify(h, 'k3', 'GET', '/job-callback', body, now)) === false
    && (await PLATFORM.verify(h, 'other', 'POST', '/job-callback', body, now)) === false;
});
await check('signature: a GET is signed over an empty body (a signature over a body fails the GET check)', async () => {
  const withBody = await SIGN.sign('k4', 'GET', '/export-published?job=x', 'not-empty', 1750000000);
  return (await PLATFORM.verify(withBody, 'k4', 'GET', '/export-published?job=x', '', 1750000005)) === false;
});

}
// ================= 2. small pieces =================
if (on('pieces')) {
await check('scrub: a secret value, the project ref, a signed-URL token and a JWT never survive', () => {
  const s = COMMON.makeScrubber(['my-secret-value-1'], 'https://abcdefghijklmnop.supabase.co/functions/v1');
  // The sample JWT (jwt.io's example header and payload, a made-up signature) is assembled at run time so the secret scanner never sees a JWT literal in the repo.
  const sampleJwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'SflKxwRJSMeKKF2QT4f'].join('.');
  const line = s('key my-secret-value-1 at https://abcdefghijklmnop.supabase.co/storage/x?token=ABC123&b=1 jwt ' + sampleJwt);
  return !/my-secret-value-1|abcdefghijklmnop|ABC123|eyJhbGci/.test(line) && line.includes('<secret>') && line.includes('<project ref>') && line.includes('token=<redacted>') && line.includes('<jwt>') || line;
});
await check('paths: a media path may not climb, be empty, absolute or hold a backslash', () =>
  COMMON.safeRelPath('ws/a.png') === true && ['../x', 'a/../b', 'a//b', '/a', 'a\\b', '', './a', 'a/'].every((p) => COMMON.safeRelPath(p) === false));
await check('base: https accepted, plain http only for a loopback address', () =>
  COMMON.checkBase('https://x.supabase.co/functions/v1') === null && COMMON.checkBase('http://127.0.0.1:9/functions/v1') === null
  && COMMON.checkBase('http://example.com/functions/v1') !== null && COMMON.checkBase('not a url') !== null);

}
// ================= 3. a full publish =================
if (on('full')) {
const full = await runPublish();
const stepNames = [...full.out.matchAll(/^STEP ([a-z]+):/gm)].map((m) => m[1]);
await check('full run: exit 0, ends "RESULT done"', () => (full.code === 0 && /RESULT done\s*$/.test(full.out)) || `exit ${full.code}\n${full.out.slice(-600)}`);
await check('full run: the steps print in order export, media, build, gating, deploying, smoke, done', () => same(stepNames, ['export', 'media', 'build', 'gating', 'deploying', 'smoke', 'done']));
await check('full run: the export is fetched with GET /export-published?job=<id>, signed, empty body, and the platform verifies it', () => {
  const c = full.log.exportCalls[0];
  return !!c && c.sigOk === true && c.method === 'GET' && c.path === `/export-published?job=${JOB}` && c.hasBody === false || JSON.stringify(full.log.exportCalls);
});
await check('full run: callbacks are gating, deploying, done in that order, each POST /job-callback, signed over its exact body, verified by the platform', () =>
  same(full.states, ['gating', 'deploying', 'done']) && full.log.callbacks.every((c) => c.sigOk === true && c.method === 'POST' && c.path === '/job-callback' && c.body.job === JOB) || JSON.stringify(full.states));
await check('full run: the real audit judged the preview build as a preview (the gating step line names target preview)', () => /^STEP gating: audit exit 0 \(target preview\)/m.test(full.out) || full.out.split('\n').filter((l) => /STEP gating/.test(l)).join(' | '));
await check('full run: done carries a local deploy id and the gate report (factory pass, audit exit 0, no FAIL lines)', () => {
  const d = full.last.body;
  return /^local-[0-9a-f]{12}$/.test(d.deployId) && d.gateReport && d.gateReport.factory === 'pass' && d.gateReport.audit.exit === 0 && d.gateReport.audit.fails.length === 0 || JSON.stringify(d);
});
await check('full run: the deploy folder holds the built site (index.html, _headers with noindex, the media file) and the record names the preview branch', () => {
  const rec = JSON.parse(readFileSync(join(full.work, 'deploy-record.json'), 'utf8'));
  return existsSync(join(full.deployDir, 'index.html')) && /X-Robots-Tag: noindex/.test(readFileSync(join(full.deployDir, '_headers'), 'utf8'))
    && existsSync(join(full.deployDir, 'media', 'logo.png')) && rec.branch === 'preview' && rec.project === 'test-site-demo-a' || JSON.stringify(rec);
});
await check('full run: the media file was downloaded from the signed URL the export carried', () => full.log.downloads.some((d) => d.startsWith('/storage/object/sign/media/logo.png?token=')) || JSON.stringify(full.log.downloads));
await check('full run: smoke asked the fixed address', () => full.log.siteHits.length >= 1 && full.log.siteHits[0] === '/site/');
await check('full run: no secret, no signed-URL token and no project ref in anything printed', () =>
  !full.out.includes(RUNNER_KEY) && !full.out.includes(CF_TOKEN) && !full.out.includes(CF_ACCOUNT) && !full.out.includes('SIGNEDTOKEN123') || 'a secret reached the output');

}
// ================= 4. the deploy command, with a fake wrangler =================
if (on('wrangler')) {
async function wranglerRun(o = {}) {
  const rec = join(tmp('wr'), 'record.json');
  const r = await runPublish({
    ...o,
    exportMut: o.exportMut,
    args: ({ work, smoke }) => ['--work', work, ...smoke],
    env: { RUNNER_WRANGLER_SCRIPT: join(HERE, 'lib', 'fake-wrangler.mjs'), FAKE_WRANGLER_RECORD: rec, FAKE_EXPECT_TOKEN: CF_TOKEN, FAKE_EXPECT_ACCOUNT: CF_ACCOUNT,
      FAKE_WRANGLER_DEPLOY_DIR: join(dirname(rec), 'deployed'), FAKE_WRANGLER_MODE: o.mode || 'ok', ...(o.env || {}) },
    cfg: { siteDir: join(dirname(rec), 'deployed'), ...(o.cfg || {}) },
  });
  r.wrangler = existsSync(rec) ? JSON.parse(readFileSync(rec, 'utf8')) : null;
  return r;
}
const wr = await wranglerRun();
await check('deploy: wrangler gets pages deploy <work>/dist --project-name <deploy_target> --branch preview --commit-dirty=true', () =>
  !!wr.wrangler && same(wr.wrangler.argv, ['pages', 'deploy', join(wr.work, 'dist'), '--project-name', 'test-site-demo-a', '--branch', 'preview', '--commit-dirty=true']));
await check('deploy: the Cloudflare token and account reach wrangler as CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID, and the runner key and platform address do not', () =>
  !!wr.wrangler && wr.wrangler.tokenOk && wr.wrangler.accountOk && !wr.wrangler.hasRunnerKey && !wr.wrangler.hasPagesToken && !wr.wrangler.hasBase || JSON.stringify(wr.wrangler));
await check("deploy: the site's /api/lead function travels with the deploy (functions/api/lead.js and lead-endpoint.mjs in wrangler's folder)", () => !!wr.wrangler && wr.wrangler.leadFunction && wr.wrangler.leadEndpoint);
await check('deploy: the deployment hash is parsed from wrangler output and sent as the deploy id; a token wrangler printed is scrubbed', () =>
  wr.code === 0 && same(wr.states, ['gating', 'deploying', 'done']) && wr.last.body.deployId === '1a2b3c4d' && !wr.out.includes(CF_TOKEN) && !wr.out.includes(CF_ACCOUNT)
  && wr.out.includes('https://1a2b3c4d.test-site-demo-a.pages.dev') || `${wr.code} ${JSON.stringify(wr.states)}\n${wr.out.slice(-500)}`);
const wrLive = await wranglerRun({ exportMut: (e) => { e.site.state = 'live'; e.site.domain = 'demo-a.example'; } });
await check('deploy: a live site goes to --branch main, and its smoke does not want noindex', () =>
  !!wrLive.wrangler && wrLive.wrangler.argv.includes('--branch') && wrLive.wrangler.argv[wrLive.wrangler.argv.indexOf('--branch') + 1] === 'main' && wrLive.code === 0 || `${wrLive.code}\n${wrLive.out.slice(-400)}`);
const wrFail = await wranglerRun({ mode: 'fail' });
await check('deploy: wrangler exiting non-zero = callback failed "deploy failed" after deploying, exit 1, token scrubbed', () =>
  wrFail.code === 1 && same(wrFail.states, ['gating', 'deploying', 'failed']) && wrFail.last.body.error === 'deploy failed' && !wrFail.out.includes(CF_TOKEN) && !JSON.stringify(wrFail.last.body).includes(CF_TOKEN) || `${wrFail.code} ${JSON.stringify(wrFail.states)}`);
const wrNoUrl = await wranglerRun({ mode: 'nourl' });
await check('deploy: wrangler printing no deployment address = failed, nothing is smoke tested', () =>
  wrNoUrl.code === 1 && wrNoUrl.states[wrNoUrl.states.length - 1] === 'failed' && /no deployment address/.test(wrNoUrl.last.body.error) && wrNoUrl.log.siteHits.length === 0 || `${wrNoUrl.code} ${JSON.stringify(wrNoUrl.states)}`);
// ---- the lead function's three settings (5-L round 2): a project that lacks one is refused at gating, nothing is deployed
await check('lead settings: all three on the preview environment = allowed; the runner read the project with the Cloudflare token, once, before deploying', () =>
  wr.code === 0 && wr.log.cfCalls.length === 1 && wr.log.cfCalls[0].path === `/cf/accounts/${CF_ACCOUNT}/pages/projects/test-site-demo-a` && wr.log.cfCalls[0].auth === `Bearer ${CF_TOKEN}` && /STEP lead settings: test-site-demo-a preview has SITE_ID, SITE_SIGNING_KEY, PLATFORM_BASE/.test(wr.out) || `${wr.code} ${JSON.stringify(wr.log.cfCalls)}`);
for (const lacks of ['SITE_ID', 'SITE_SIGNING_KEY', 'PLATFORM_BASE']) {
  const names = ['SITE_ID', 'SITE_SIGNING_KEY', 'PLATFORM_BASE'].filter((n) => n !== lacks);
  const rm = await wranglerRun({ cfg: { cf: { names: { preview: names, production: names } } } });
  await check(`lead settings: ${lacks} missing = failed at gating naming only ${lacks}, no deploying callback, wrangler never ran, exit 1`, () =>
    rm.code === 1 && same(rm.states, ['gating', 'failed']) && rm.wrangler === null && rm.last.body.error.includes(`lacks ${lacks};`) && same(rm.last.body.gateReport.missing, [lacks])
    && !rm.out.includes('LEAKCHECK-VALUE') && !JSON.stringify(rm.last.body).includes('LEAKCHECK-VALUE') || `${rm.code} ${JSON.stringify(rm.states)} ${rm.last && rm.last.body.error}`);
}
const rmPreview = await wranglerRun({ cfg: { cf: { names: { preview: [], production: ['SITE_ID', 'SITE_SIGNING_KEY', 'PLATFORM_BASE'] } } } });
await check('lead settings: a preview deploy is judged by the PREVIEW environment (names only on production do not help), all three named', () =>
  rmPreview.code === 1 && rmPreview.wrangler === null && /preview environment lacks SITE_ID, SITE_SIGNING_KEY, PLATFORM_BASE;/.test(rmPreview.last.body.error) || `${rmPreview.code} ${rmPreview.last && rmPreview.last.body.error}`);
const rmLive = await wranglerRun({ exportMut: (e) => { e.site.state = 'live'; e.site.domain = 'demo-a.example'; }, cfg: { cf: { names: { preview: ['SITE_ID', 'SITE_SIGNING_KEY', 'PLATFORM_BASE'], production: ['SITE_ID'] } } } });
await check('lead settings: a live deploy is judged by the PRODUCTION environment (full names only on preview do not help)', () =>
  rmLive.code === 1 && rmLive.wrangler === null && /production environment lacks SITE_SIGNING_KEY, PLATFORM_BASE;/.test(rmLive.last.body.error) || `${rmLive.code} ${rmLive.last && rmLive.last.body.error}`);
const cfDown = await wranglerRun({ cfg: { cf: { status: 403 } } });
await check('lead settings: a project whose settings cannot be read (HTTP 403) is refused too, nothing deployed', () =>
  cfDown.code === 1 && same(cfDown.states, ['gating', 'failed']) && cfDown.wrangler === null && /could not be read from the test-site-demo-a project \(HTTP 403\)/.test(cfDown.last.body.error) || `${cfDown.code} ${cfDown.last && cfDown.last.body.error}`);
const cfBusy = await wranglerRun({ cfg: { cf: { failFirst: 1 } } });
await check('lead settings: one 503 from Cloudflare is tried again and the deploy goes ahead (two reads)', () =>
  cfBusy.code === 0 && cfBusy.log.cfCalls.length === 2 && !!cfBusy.wrangler || `${cfBusy.code} ${cfBusy.log.cfCalls.length}`);
await check('lead settings: --no-deploy (no Cloudflare in the run) does not ask Cloudflare', async () => {
  const nd = await runPublish();
  return nd.code === 0 && nd.log.cfCalls.length === 0 || `${nd.code} ${nd.log.cfCalls.length}`;
});
await check('deploy: the default command is npx --yes wrangler@<exact version> (no range, no latest)', () => {
  const src = readFileSync(join(RUNNER, 'publish.mjs'), 'utf8');
  return /const WRANGLER_VERSION = '\d+\.\d+\.\d+';/.test(src) && src.includes("['--yes', `wrangler@${WRANGLER_VERSION}`, ...wargs]");
});

}
// ================= 5. the gate that must stop a bad build =================
if (on('gate')) {
const bad = await runPublish({ args: ({ deployDir, work, smoke }) => ['--no-deploy', deployDir, '--work', work, ...smoke, '--force-fail', 'heading'] });
await check('force-fail heading: callbacks gating then failed, nothing deploys, exit 1', () => bad.code === 1 && same(bad.states, ['gating', 'failed']) || `${bad.code} ${JSON.stringify(bad.states)}`);
await check('force-fail heading: the failed report carries the audit engine\'s MET-003 FAIL line in gateReport.audit.fails', () => {
  const g = bad.last.body.gateReport;
  return bad.last.body.state === 'failed' && g.audit.exit === 1 && g.audit.fails.some((l) => /^FAIL MET-003 \/contact\//.test(l)) && g.factory === 'pass' || JSON.stringify(g);
});
await check('force-fail heading: nothing was written to the deploy folder and the site was never smoke tested', () => !existsSync(bad.deployDir) && bad.log.siteHits.length === 0);
// an audit engine that answers exit 2 (usage / bad config): a checkout whose tools/audit/run.mjs is a stub, everything else the real factory and sites
const stubRepo = tmp('repo');
mkdirSync(join(stubRepo, 'tools', 'audit'), { recursive: true });
writeFileSync(join(stubRepo, 'tools', 'audit', 'run.mjs'), "console.log('usage: stub audit'); process.exit(2);\n");
for (const d of ['factory', 'sites', 'contracts']) symlinkSync(join(REPO, d), join(stubRepo, d), 'junction');
const usageAudit = await runPublish({ env: { OMNIKOM_REPO_ROOT: stubRepo } });
await check('audit exit 2 (usage error): failed "audit usage error" after gating, nothing deploys, exit 1', () =>
  usageAudit.code === 1 && same(usageAudit.states, ['gating', 'failed']) && usageAudit.last.body.error === 'audit usage error' && usageAudit.last.body.gateReport.audit.exit === 2 && !existsSync(usageAudit.deployDir) || `${usageAudit.code} ${JSON.stringify(usageAudit.states)}\n${usageAudit.out.slice(-300)}`);
// the build target the audit is told (ENV-001): a stub audit that records its arguments, then exits 2 so nothing deploys
const argvRepo = tmp('repo-argv');
mkdirSync(join(argvRepo, 'tools', 'audit'), { recursive: true });
writeFileSync(join(argvRepo, 'tools', 'audit', 'run.mjs'),
  "import { writeFileSync } from 'node:fs'; import { dirname, join } from 'node:path'; import { fileURLToPath } from 'node:url';\n"
  + "writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'argv.json'), JSON.stringify(process.argv.slice(2))); process.exit(2);\n");
for (const d of ['factory', 'sites', 'contracts']) symlinkSync(join(REPO, d), join(argvRepo, d), 'junction');
const auditArgv = () => JSON.parse(readFileSync(join(argvRepo, 'tools', 'audit', 'argv.json'), 'utf8'));
await runPublish({ env: { OMNIKOM_REPO_ROOT: argvRepo } });
const previewArgv = auditArgv();
await check('audit target: a preview export (site state not live) is audited with --target preview, after the built folder', () =>
  (previewArgv.length === 3 && /dist$/.test(previewArgv[0]) && previewArgv[1] === '--target' && previewArgv[2] === 'preview') || `audit was called with ${JSON.stringify(previewArgv)}`);
await runPublish({ env: { OMNIKOM_REPO_ROOT: argvRepo }, exportMut: (e) => { e.site.state = 'live'; e.site.domain = 'demo-a.example.com'; } });
const liveArgv = auditArgv();
await check('audit target: a live export is audited with --target production, after the built folder', () =>
  (liveArgv.length === 3 && /dist$/.test(liveArgv[0]) && liveArgv[1] === '--target' && liveArgv[2] === 'production') || `audit was called with ${JSON.stringify(liveArgv)}`);

}
// ================= 6. refusals before any build =================
if (on('refusals')) {
const wrongSite = await runPublish({ env: { SITE_ID: SITE_B } });
await check('site mismatch (SITE_ID is site B): failed "site mismatch" first, no build, no deploy, exit 1', () =>
  wrongSite.code === 1 && same(wrongSite.states, ['failed']) && wrongSite.last.body.error === 'site mismatch' && !existsSync(join(wrongSite.work, 'dist')) && !/STEP build/.test(wrongSite.out) || `${wrongSite.code} ${JSON.stringify(wrongSite.states)}`);
const wrongJob = await runPublish({ env: { JOB_ID: '11111111-1111-4111-8111-111111111111' } });
await check('job mismatch (the export is for another job): failed "job mismatch", no build, exit 1', () =>
  wrongJob.code === 1 && same(wrongJob.states, ['failed']) && wrongJob.last.body.error === 'job mismatch' && !existsSync(join(wrongJob.work, 'dist')) || `${wrongJob.code} ${JSON.stringify(wrongJob.states)}`);
const noLook = await runPublish({ exportMut: (e) => { e.workspace.slug = 'no-such-site'; } });
await check('missing look-folder (sites/<slug>/design is not in the checkout): failed "no look-folder", no build, exit 1', () =>
  noLook.code === 1 && same(noLook.states, ['failed']) && noLook.last.body.error === 'no look-folder' && !existsSync(join(noLook.work, 'dist')) || `${noLook.code} ${JSON.stringify(noLook.states)}`);
const e401 = await runPublish({ cfg: { exportStatus: 401 } });
await check('export answering 401: failed with the status, no build, exit 1', () =>
  e401.code === 1 && same(e401.states, ['failed']) && /HTTP 401/.test(e401.last.body.error) && !existsSync(join(e401.work, 'dist')) || `${e401.code} ${JSON.stringify(e401.states)}`);
const e500 = await runPublish({ cfg: { exportStatus: 500 } });
await check('export answering 500: failed with the status, exit 1', () => e500.code === 1 && same(e500.states, ['failed']) && /HTTP 500/.test(e500.last.body.error));
const badKey = await runPublish({ env: { RUNNER_KEY: 'another-key-than-the-platforms-0000' } });
await check('a runner key the platform does not know: the export is refused by the platform\'s verify (401), the run fails, exit 1', () =>
  badKey.code === 1 && badKey.log.exportCalls.length >= 1 && badKey.log.exportCalls.every((c) => c.sigOk === false) && !existsSync(join(badKey.work, 'dist')));
const hang = await runPublish({ cfg: { exportHang: true }, env: { RUNNER_FETCH_TIMEOUT_MS: '600' }, timeoutMs: 40000 });
await check('an export that never answers is cut by the timeout (tried again), the run fails with a signed callback and exits 1', () =>
  hang.code === 1 && same(hang.states, ['failed']) && /export failed/.test(hang.last.body.error) && hang.log.exportCalls.length >= 2 || `${hang.code} ${JSON.stringify(hang.states)} calls ${hang.log.exportCalls.length}`);
// RUNNER_WRANGLER_SCRIPT is set even here: if the credentials check were gone, the run would reach the FAKE wrangler, never the real npx
const noCf = await runPublish({ args: ({ work, smoke }) => ['--work', work, ...smoke], unset: ['CLOUDFLARE_PAGES_TOKEN'],
  env: { RUNNER_WRANGLER_SCRIPT: join(HERE, 'lib', 'fake-wrangler.mjs'), FAKE_WRANGLER_RECORD: join(tmp('wr0'), 'record.json') } });
await check('no Cloudflare token and no --no-deploy: failed "missing deploy credentials" before the export is even asked for', () =>
  noCf.code === 1 && same(noCf.states, ['failed']) && noCf.last.body.error === 'missing deploy credentials' && noCf.log.exportCalls.length === 0);

}
// ================= 7. media in the export =================
if (on('media-export')) {
const noUrl = await runPublish({ mediaUrl: () => null });
await check('a media file with no url that a built row needs: the factory stops the build, failed "build failed", nothing deploys', () =>
  noUrl.code === 1 && same(noUrl.states, ['failed']) && noUrl.last.body.error === 'build failed' && /not downloaded/.test(noUrl.out) && /no url/.test(noUrl.out) && !existsSync(noUrl.deployDir) || `${noUrl.code} ${JSON.stringify(noUrl.states)}\n${noUrl.out.slice(-500)}`);
const gone = await runPublish({ cfg: { files: {} } });
await check('a signed URL that answers 404: the file is missing, the build stops, failed, exit 1', () =>
  gone.code === 1 && gone.states[gone.states.length - 1] === 'failed' && /HTTP 404/.test(gone.out) && !existsSync(gone.deployDir));
const foreign = await runPublish({ mediaUrl: () => 'http://127.0.0.1:9/storage/x?token=T' });
await check('a media URL on another host is never fetched (the export is not allowed to aim the runner elsewhere)', () =>
  foreign.code === 1 && /url on another host/.test(foreign.out) && foreign.log.downloads.length === 0);
const traversal = await runPublish({ exportMut: (e) => { e.media[0].path = '../escape.png'; } });
await check('a media path that climbs out of the folder fails the job before anything is written', () =>
  traversal.code === 1 && same(traversal.states, ['failed']) && /unsafe media path/.test(traversal.last.body.error) && !existsSync(join(traversal.work, 'dist')));

}
// ================= 8. the smoke test =================
if (on('smoke')) {
const s503 = await runPublish({ cfg: { siteStatus: 503 }, smokeTries: 3 });
await check('smoke that never answers 200 (503): failed "deployed but smoke failed" with the deploy id, after deploying, exit 1', () => {
  const b = s503.last.body;
  return s503.code === 1 && same(s503.states, ['gating', 'deploying', 'failed']) && b.error === 'deployed but smoke failed' && /^local-/.test(b.deployId) && b.gateReport.deployId === b.deployId || `${s503.code} ${JSON.stringify(s503.states)}`;
});
await check('smoke: it asks again up to the number of tries (3 hits) before giving up', () => s503.log.siteHits.length === 3 || String(s503.log.siteHits.length));
const noIndex = await runPublish({ cfg: { siteRobotsHeader: '' } });
await check('smoke on a preview: an answer without x-robots-tag noindex fails the run', () =>
  noIndex.code === 1 && noIndex.last.body.error === 'deployed but smoke failed' && /noindex/.test(noIndex.last.body.gateReport.smoke));
const oldPage = await runPublish({ cfg: { siteMutate: (h) => h.replace(/<title>[^<]*<\/title>/, '<title>Some older page</title>') } });
await check('smoke: a page whose <title> is not the one that was built fails the run', () =>
  oldPage.code === 1 && oldPage.last.body.error === 'deployed but smoke failed' && /title/.test(oldPage.last.body.gateReport.smoke));
const liveNoindex = await runPublish({ exportMut: (e) => { e.site.state = 'live'; e.site.domain = 'demo-a.example'; }, cfg: { siteRobotsHeader: 'noindex, nofollow' } });
await check('smoke on a live site: an answer with noindex fails the run (a live site hidden from search is a failure)', () =>
  liveNoindex.code === 1 && liveNoindex.last.body.error === 'deployed but smoke failed' && /live site answered/.test(liveNoindex.last.body.gateReport.smoke));
const liveOk = await runPublish({ exportMut: (e) => { e.site.state = 'live'; e.site.domain = 'demo-a.example'; } });
await check('a live site (state live, domain set) builds, deploys to main and passes smoke without noindex', () => {
  const rec = JSON.parse(readFileSync(join(liveOk.work, 'deploy-record.json'), 'utf8'));
  return liveOk.code === 0 && rec.branch === 'main' && !/X-Robots-Tag/.test(readFileSync(join(liveOk.deployDir, '_headers'), 'utf8')) || `${liveOk.code} ${JSON.stringify(rec)}\n${liveOk.out.slice(-400)}`;
});

}
// ================= 9. the callbacks =================
if (on('callbacks')) {
const refused = await runPublish({ cfg: { callbackStatus: (n) => (n === 1 ? 409 : 204) } });
await check('a 409 on the gating callback: printed, the run stops, exit 1, nothing deploys and no further callback is sent', () =>
  refused.code === 1 && refused.states.length === 1 && /HTTP 409/.test(refused.out) && !existsSync(refused.deployDir) && /RESULT failed/.test(refused.out) || `${refused.code} ${JSON.stringify(refused.states)}\n${refused.out.slice(-300)}`);
const refusedDone = await runPublish({ cfg: { callbackStatus: (n, b) => (b.state === 'done' ? 409 : 204) } });
await check('a 409 on the done callback: exit 1 (a deploy happened but the platform did not accept it), no failed callback follows', () =>
  refusedDone.code === 1 && same(refusedDone.states, ['gating', 'deploying', 'done']) && /HTTP 409/.test(refusedDone.out));
const flaky = await runPublish({ cfg: { callbackStatus: (n) => (n === 1 ? 503 : 204) } });
await check('a callback answered 503 once is sent again (signed again) and the run still ends done', () =>
  flaky.code === 0 && same(flaky.states, ['gating', 'gating', 'deploying', 'done']) && flaky.log.callbacks.every((c) => c.sigOk));

}
// ================= 10. usage and environment =================
if (on('usage')) {
const usage = async (label, env, args, unset = []) => {
  const r = await runPublish({ env, args: () => args, unset });
  await check(`usage: ${label} exits 2 and talks to nobody`, () => r.code === 2 && r.log.exportCalls.length === 0 && r.log.callbacks.length === 0 || `${r.code} ${r.out.slice(0, 200)}`);
};
await usage('a missing RUNNER_KEY', {}, [], ['RUNNER_KEY']);
await usage('a JOB_ID that is not a UUID', { JOB_ID: 'job-1' }, []);
await usage('a plain http platform address that is not loopback', { PLATFORM_FUNCTIONS_BASE: 'http://example.com/functions/v1' }, []);
await usage('an unknown argument', {}, ['--nope', 'x']);
await usage('--force-fail with another name', {}, ['--force-fail', 'title']);

}
// ================= 11. the secrets tool =================
if (on('secrets')) {
async function runSecrets(args, env, failSet) {
  const dir = tmp('gh'), rec = join(dir, 'gh.jsonl');
  writeFileSync(rec, '');
  const r = await spawnNode(SECRETS_TOOL, args, { ...BASE_ENV, GH_SCRIPT: join(HERE, 'lib', 'fake-gh.mjs'), GH_RECORD: rec, ...(failSet ? { GH_FAIL_SET: failSet } : {}), ...env }, 60000);
  const calls = readFileSync(rec, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { ...r, calls, sets: calls.filter((c) => c.argv[1] === 'set') };
}
const SEC = { RUNNER_KEY: 'rk-secret-value-1234', CLOUDFLARE_PAGES_TOKEN: 'cf-secret-value-5678', STAGING_SUPABASE_REF: 'abcdefghijklmnopqrst' };
const NAMES = 'CLOUDFLARE_PAGES_TOKEN,CLOUDFLARE_ACCOUNT_ID,RUNNER_KEY,PLATFORM_FUNCTIONS_BASE,STAGING_DB_URL';
const dry = await runSecrets(['--repo', 'Omnikom-platform/omnikom-platform', '--names', NAMES, '--dry-run'], SEC);
await check('secrets --dry-run: names only, a missing name is "NOT SET (missing in the env)", no gh secret set is called, no value printed', () =>
  dry.code === 0 && /WOULD SET: RUNNER_KEY/.test(dry.out) && /WOULD SET: CLOUDFLARE_PAGES_TOKEN/.test(dry.out) && /NOT SET \(missing in the env\): CLOUDFLARE_ACCOUNT_ID/.test(dry.out)
  && /NOT SET \(missing in the env\): STAGING_DB_URL/.test(dry.out) && dry.sets.length === 0 && !/rk-secret|cf-secret/.test(dry.out) || `${dry.code}\n${dry.out}`);
await check('secrets: PLATFORM_FUNCTIONS_BASE is derived from STAGING_SUPABASE_REF when absent', () => /DERIVED: PLATFORM_FUNCTIONS_BASE/.test(dry.out) && /WOULD SET: PLATFORM_FUNCTIONS_BASE/.test(dry.out));
const real = await runSecrets(['--repo', 'Omnikom-platform/omnikom-platform', '--names', NAMES], SEC);
await check('secrets: each present name is set with gh secret set <NAME> -R <repo>, the value on stdin and never in argv', () =>
  real.code === 0 && real.sets.length === 3 && real.sets.every((c) => same(c.argv.slice(0, 2), ['secret', 'set']) && c.argv[3] === '-R' && c.argv[4] === 'Omnikom-platform/omnikom-platform')
  && real.sets.find((c) => c.argv[2] === 'RUNNER_KEY').stdin === 'rk-secret-value-1234'
  && real.sets.find((c) => c.argv[2] === 'PLATFORM_FUNCTIONS_BASE').stdin === 'https://abcdefghijklmnopqrst.supabase.co/functions/v1'
  && !real.calls.some((c) => c.argv.some((a) => /rk-secret|cf-secret|abcdefghijklmnopqrst/.test(a))) || `${real.code} ${JSON.stringify(real.calls.map((c) => c.argv))}`);
await check('secrets: the names on the repository are listed afterwards, and no value is printed', () =>
  /secrets on Omnikom-platform\/omnikom-platform \(names only\):/.test(real.out) && /^\s+RUNNER_KEY$/m.test(real.out) && !/rk-secret|cf-secret|abcdefghijklmnopqrst/.test(real.out) || real.out);
const failing = await runSecrets(['--repo', 'Omnikom-platform/omnikom-platform', '--names', 'RUNNER_KEY'], SEC, 'RUNNER_KEY');
await check('secrets: a failing gh secret set exits 1, is reported by name, and the value gh echoed is scrubbed', () =>
  failing.code === 1 && /FAILED: RUNNER_KEY/.test(failing.out) && !failing.out.includes('rk-secret-value-1234') || `${failing.code}\n${failing.out}`);
const badRepo = await runSecrets(['--repo', 'not a repo', '--names', 'RUNNER_KEY'], SEC);
const badName = await runSecrets(['--repo', 'a/b', '--names', 'lowercase'], SEC);
const ghName = await runSecrets(['--repo', 'a/b', '--names', 'GITHUB_TOKEN'], { ...SEC, GITHUB_TOKEN: 'x-secret-value-9999' });
await check('secrets: a malformed repo, a lowercase name or a GITHUB_ name is a usage error (exit 2) and gh is never called', () =>
  badRepo.code === 2 && badName.code === 2 && ghName.code === 2 && badRepo.calls.length === 0 && badName.calls.length === 0 && ghName.calls.length === 0);

}

// ================= 11b. the workflow files (the supply-chain and least-privilege rules, as tests) =================
if (on('workflows')) {
  const WF = process.env.WORKFLOWS_DIR ? resolve(process.env.WORKFLOWS_DIR) : join(REPO, '.github', 'workflows');
  const files = readdirSync(WF).filter((f) => f.endsWith('.yml')).sort();
  const wf = Object.fromEntries(files.map((f) => [f, readFileSync(join(WF, f), 'utf8')]));
  const lines = (f) => wf[f].split('\n');
  const jobCount = (f) => { const l = lines(f), at = l.indexOf('jobs:'); return l.slice(at + 1).filter((x) => /^  [A-Za-z0-9_-]+:\s*$/.test(x)).length; };
  await check('workflows: the seven files exist', () => same(files, ['alerts.yml', 'backup.yml', 'ci.yml', 'keepalive.yml', 'key-rotation.yml', 'media.yml', 'publish.yml']));
  await check('workflows: every file sets permissions contents: read for the whole workflow', () => files.every((f) => /^permissions:\n  contents: read\n/m.test(wf[f])) || files.filter((f) => !/^permissions:\n  contents: read\n/m.test(wf[f])).join(','));
  await check('workflows: every action is pinned by a 40 hex commit SHA with its version in a comment (supply-chain rule 7)', () => {
    const uses = files.flatMap((f) => lines(f).filter((l) => /^\s+(- )?uses:/.test(l)).map((l) => [f, l.trim()]));
    const bad = uses.filter(([, l]) => !/^(- )?uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/.test(l));
    return (uses.length >= 15 && bad.length === 0) || JSON.stringify(bad.slice(0, 2));
  });
  await check('workflows: every job has a timeout', () => files.every((f) => jobCount(f) > 0 && (wf[f].match(/^    timeout-minutes: \d+$/gm) || []).length === jobCount(f)) || files.map((f) => [f, jobCount(f), (wf[f].match(/^    timeout-minutes: \d+$/gm) || []).length].join(':')).join(' '));
  await check('workflows: a secret is read only into an env: entry, never into a command line', () => {
    const bad = files.flatMap((f) => lines(f).filter((l) => l.includes('secrets.') && !/^\s+[A-Z][A-Z0-9_]*: \$\{\{ secrets\.[A-Z0-9_]+ \}\}$/.test(l) && !/^\s*#/.test(l)).map((l) => f + ': ' + l.trim()));
    return bad.length === 0 || bad[0];
  });
  await check('workflows: event data (client_payload, inputs) reaches a script only through env: or the concurrency group (no script injection)', () => {
    const bad = files.flatMap((f) => lines(f).filter((l) => /\$\{\{[^}]*(client_payload|inputs\.)/.test(l) && !/^\s+[A-Z][A-Z0-9_]*: \$\{\{/.test(l) && !/^\s+group: /.test(l)).map((l) => f + ': ' + l.trim()));
    return bad.length === 0 || bad[0];
  });
  await check('publish.yml: repository_dispatch publish and a manual run with job_id, site_id, force_fail; one 30 minute job; one build per site, queue max', () => {
    const t = wf['publish.yml'];
    return /repository_dispatch:\n    types: \[publish\]/.test(t) && /workflow_dispatch:/.test(t) && ['job_id', 'site_id', 'force_fail'].every((n) => new RegExp('^      ' + n + ':', 'm').test(t))
      && /^    timeout-minutes: 30$/m.test(t) && /group: site-\$\{\{ github\.event\.client_payload\.site_id \|\| inputs\.site_id \}\}\n  queue: max/.test(t)
      && /node factory\/runner\/publish\.mjs/.test(t) && ['PLATFORM_FUNCTIONS_BASE', 'RUNNER_KEY', 'CLOUDFLARE_PAGES_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].every((n) => t.includes('secrets.' + n));
  });
  await check('media.yml: repository_dispatch media, a locked install of sharp with scripts off, one build per media id', () => {
    const t = wf['media.yml'];
    return /repository_dispatch:\n    types: \[media\]/.test(t) && t.includes('npm ci --prefix factory/runner --ignore-scripts') && /group: media-\$\{\{ github\.event\.client_payload\.media_id \}\}\n  queue: max/.test(t) && t.includes('node factory/runner/media.mjs');
  });
  await check('backup.yml: the job is off unless the variable BACKUP_ENABLED is true (R2 is deferred)', () => /^    if: \$\{\{ vars\.BACKUP_ENABLED == 'true' \}\}$/m.test(wf['backup.yml']) && /BLOCKED: R2/.test(wf['backup.yml']));
  await check('keepalive.yml: Mondays 06:00 UTC and by hand, one status call per target staging with the four staging names', () =>
    wf['keepalive.yml'].includes("cron: '0 6 * * 1'") && wf['keepalive.yml'].includes('workflow_dispatch:') && wf['keepalive.yml'].includes('omnikom.mjs status --target staging')
    && ['STAGING_DB_URL', 'STAGING_SUPABASE_REF', 'STAGING_SUPABASE_SECRET_KEY', 'STAGING_SUPABASE_PUBLISHABLE_KEY'].every((n) => wf['keepalive.yml'].includes('secrets.' + n)));
  await check('ci.yml: the nine jobs, and the three downloaded binaries (gitleaks, actionlint, shellcheck) are pinned by exact version and sha256 and the sum is checked; actionlint is given the pinned shellcheck', () => {
    const t = wf['ci.yml'], at = t.split('\n').indexOf('jobs:');
    const jobs = t.split('\n').slice(at + 1).filter((x) => /^  [a-z]+:\s*$/.test(x)).map((x) => x.trim().slice(0, -1));
    return same(jobs, ['gates', 'factory', 'functions', 'audit', 'cli', 'dashboard', 'departments', 'secrets', 'workflows'])
      && t.includes('551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb') && t.includes('8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8')
      && t.includes('b7af85e41cc99489dcc21d66c6d5f3685138f06d34651e6d34b42ec6d54fe6f6') && t.includes('shellcheck/releases/download/v0.11.0/')
      && t.includes('-shellcheck "$RUNNER_TEMP/shellcheck-v0.11.0/shellcheck"')
      && (t.match(/sha256sum --check -/g) || []).length === 3 && t.includes('gitleaks/releases/download/v8.30.1/') && t.includes('actionlint/releases/download/v1.7.12/') && t.includes('fetch-depth: 0');
  });
}
// ================= 12. media (needs sharp) =================
if (on('media')) {
if (!HAS_SHARP) {
  console.log('SKIP media test: run npm ci --prefix factory/runner');
} else {
  const sharp = createRequire(join(REAL_RUNNER, 'package.json'))('sharp');
  const MEDIA = '5d1f7c3a-1b2e-4c6d-9a8b-0123456789ab', WS = 'aaaaaaaa-0000-0000-0000-000000000000';
  const jpeg = async (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 60 } } }).jpeg({ quality: 80 }).toBuffer();
  const runMedia = async (o = {}) => {
    const path = o.path || `${WS}/${MEDIA}.jpg`, stem = path.replace(/\.[^.]+$/, '');
    let fake;
    const cfg = {
      files: { [`/storage/object/sign/media/${path}`]: o.bytes },
      mediaExportStatus: o.exportStatus, mediaCallbackStatus: o.callbackStatus, uploadStatus: o.uploadStatus,
      mediaExport: () => ({ id: MEDIA, workspace_id: WS, path, processed: false, url: `${fake.origin}/storage/object/sign/media/${path}?token=DLTOKEN`,
        uploads: Object.fromEntries([2400, 1600, 800].map((w) => [String(w), o.uploadHost || `${fake.origin}/storage/upload/sign/media/${stem}-${w}.webp?token=ULTOKEN${w}`])) }),
    };
    fake = await startFake({ runnerKey: RUNNER_KEY, verify: PLATFORM.verify, cfg });
    const env = { ...BASE_ENV, MEDIA_ID: MEDIA, WORKSPACE_ID: o.workspace || WS, PLATFORM_FUNCTIONS_BASE: fake.base, RUNNER_KEY, RUNNER_RETRY_BACKOFF_MS: '20' };
    const r = await spawnNode(join(RUNNER, 'media.mjs'), [], env, 120000);
    await fake.close();
    return { ...r, log: fake.log };
  };
  const sized = (r, w) => r.log.uploads.find((u) => u.path.endsWith(`-${w}.webp`));

  const big = withExif(await jpeg(3000, 2600), gpsTiff(6));
  const bigMeta = await sharp(big).metadata();
  await check('media input: the test JPEG really carries a GPS block and Orientation 6 (the test is not vacuous)', () => big.includes(GPS_BYTES) && bigMeta.orientation === 6 && bigMeta.width === 3000 && bigMeta.height === 2600);
  const m1 = await runMedia({ bytes: big });
  await check('media: exit 0 and three PUTs, 2400, 1600 and 800 wide, each to its own signed upload URL as image/webp', () =>
    m1.code === 0 && m1.log.uploads.length === 3 && [2400, 1600, 800].every((w) => sized(m1, w) && sized(m1, w).type === 'image/webp') || `${m1.code}\n${m1.out.slice(-400)}`);
  await check('media: no output carries EXIF, XMP, an ICC profile or the GPS bytes', () => m1.log.uploads.every((u) => {
    const names = webpChunks(u.body);
    return !names.includes('EXIF') && !names.includes('XMP ') && !names.includes('ICCP') && !u.body.includes(GPS_BYTES);
  }));
  await check('media: the widths are right and the orientation was applied (a 3000x2600 file turned 90 degrees is 2600x3000)', () => {
    const s = [2400, 1600, 800].map((w) => webpSize(sized(m1, w).body));
    return s[0].width === 2400 && s[1].width === 1600 && s[2].width === 800 && Math.abs(s[0].height - 2769) <= 1 && s[0].height > s[0].width || JSON.stringify(s);
  });
  await check('media: the callback is signed (verified by the platform), sent after all three PUTs, and says width 2600, height 3000, exifStripped true, the byte total and the sizes', () => {
    const c = m1.log.mediaCallbacks[0], total = m1.log.uploads.reduce((a, u) => a + u.body.length, 0);
    return m1.log.mediaCallbacks.length === 1 && c.sigOk && c.path === '/media-process-callback' && c.uploadsSoFar === 3
      && same(c.body, { media: MEDIA, width: 2600, height: 3000, exifStripped: true, bytes: total, sizes: [2400, 1600, 800], skipped: [] }) || JSON.stringify(c && c.body);
  });
  await check('media: no signed-URL token reaches the output', () => !m1.out.includes('DLTOKEN') && !m1.out.includes('ULTOKEN2400') && !m1.out.includes(RUNNER_KEY));

  const small = await runMedia({ bytes: await jpeg(1000, 700) });
  await check('media: a 1000 px original is never upscaled: only 800 is made, 2400 and 1600 are reported as skipped', () =>
    small.code === 0 && small.log.uploads.length === 1 && webpSize(small.log.uploads[0].body).width === 800 && same(small.log.mediaCallbacks[0].body.sizes, [800]) && same(small.log.mediaCallbacks[0].body.skipped, [2400, 1600]) || `${small.code} ${JSON.stringify(small.log.mediaCallbacks.map((c) => c.body))}`);
  const tiny = await runMedia({ bytes: await jpeg(600, 400) });
  // The 800 slot always exists (head's rule 2026-10-31: core allows images narrower than 800, the logo's minWidth is 200; export-published
  // points at the largest slot the width reaches, else 800). A narrower original fills the 800 slot at its own width, never upscaled.
  await check('media: an original narrower than 800 fills the 800 slot at its own width: exit 0, one PUT 600 px wide, sizes [800], skipped [2400, 1600]', () =>
    tiny.code === 0 && tiny.log.uploads.length === 1 && webpSize(tiny.log.uploads[0].body).width === 600 && /-800\.webp$/.test(tiny.log.uploads[0].path || '')
      && same(tiny.log.mediaCallbacks[0] && tiny.log.mediaCallbacks[0].body, { media: MEDIA, width: 600, height: 400, exifStripped: true, bytes: tiny.log.uploads[0].body.length, sizes: [800], skipped: [2400, 1600] })
      || `${tiny.code} ${JSON.stringify(tiny.log.uploads.map((u) => [u.path, u.body && u.body.length]))} ${JSON.stringify(tiny.log.mediaCallbacks.map((c) => c.body))}`);
  const pdf = await runMedia({ bytes: Buffer.from('%PDF-1.4 test'), path: `${WS}/${MEDIA}.pdf` });
  await check('media: a PDF is not processed: the callback is exactly { media, kind: "document" }, no upload', () =>
    pdf.code === 0 && pdf.log.uploads.length === 0 && same(pdf.log.mediaCallbacks[0].body, { media: MEDIA, kind: 'document' }) && pdf.log.mediaCallbacks[0].sigOk || `${pdf.code} ${pdf.out.slice(-300)}`);
  const wsBad = await runMedia({ bytes: big, workspace: 'bbbbbbbb-0000-0000-0000-000000000000' });
  await check('media: a workspace that is not the one in the dispatch is refused before any download', () =>
    wsBad.code === 1 && /workspace mismatch/.test(wsBad.out) && wsBad.log.downloads.length === 0 && wsBad.log.uploads.length === 0 && wsBad.log.mediaCallbacks.length === 0);
  const junk = await runMedia({ bytes: Buffer.from('this is not an image at all') });
  await check('media: a file that is not an image fails with no upload and no callback', () => junk.code === 1 && junk.log.uploads.length === 0 && junk.log.mediaCallbacks.length === 0);
  const upFail = await runMedia({ bytes: big, uploadStatus: 500 });
  await check('media: an upload that fails stops the run before the callback (nothing is marked processed)', () => upFail.code === 1 && upFail.log.mediaCallbacks.length === 0);
  const cbFail = await runMedia({ bytes: big, callbackStatus: 422 });
  await check('media: a callback the platform refuses (422) fails the run, exit 1', () => cbFail.code === 1 && /422/.test(cbFail.out));
  const expFail = await runMedia({ bytes: big, exportStatus: 404 });
  await check('media: media-export answering 404 fails the run before any download', () => expFail.code === 1 && expFail.log.downloads.length === 0);
  const foreignUp = await runMedia({ bytes: big, uploadHost: 'http://127.0.0.1:9/storage/upload/x?token=T' });
  await check('media: an upload URL on another host is refused', () => foreignUp.code === 1 && /upload url on the platform host/.test(foreignUp.out) && foreignUp.log.uploads.length === 0 && foreignUp.log.mediaCallbacks.length === 0);
}

}

cleanup();
if (failed) { console.log(`FAILED: ${failed} of ${passed + failed}`); process.exit(1); }
console.log(`OK: ${passed} of ${passed + failed} checks passed${HAS_SHARP ? '' : ' (media checks SKIPPED: sharp is not installed)'}`);
