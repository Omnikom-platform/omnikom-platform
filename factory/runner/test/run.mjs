// Tests of the build runner (slice 4.4): publish.mjs, media.mjs, the machine-call signature and tools/github-secrets.mjs.
// Plain script: one line per check, ends "OK: N of N checks passed" (exit 0) or "FAILED: k of N" (exit 1).
// Everything the runner talks to is a local fake (test/lib/fake-platform.mjs, fake-wrangler.mjs, fake-gh.mjs): no staging, no Cloudflare,
// no GitHub. The platform's OWN verify (supabase/functions/_shared/signature.ts, Node type stripping) judges every signature the
// runner sends. The media checks need sharp (npm ci --prefix factory/runner); without it they print SKIP and are not counted.
// RUNNER_DIR points the tests at another copy of factory/runner, SECRETS_TOOL at another github-secrets.mjs and FLOWS_RESULT at another flows-result.mjs (test/mutate.mjs runs
// broken copies); RUNNER_TEST_BAIL=1 stops at the first FAIL (the mutants only need one red line).
import { spawn } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ALIASED, CANONICAL, DRAFT_DEPLOYMENT, NOT_THIS_DRAFT, startFake } from './lib/fake-platform.mjs';
import { GPS_BYTES, gpsTiff, webpChunks, webpSize, withExif } from './lib/exif.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const REAL_RUNNER = join(REPO, 'factory', 'runner');
const RUNNER = process.env.RUNNER_DIR ? resolve(process.env.RUNNER_DIR) : REAL_RUNNER;
const SECRETS_TOOL = process.env.SECRETS_TOOL ? resolve(process.env.SECRETS_TOOL) : join(REPO, 'tools', 'github-secrets.mjs');
const FLOWS_RESULT = process.env.FLOWS_RESULT ? resolve(process.env.FLOWS_RESULT) : join(REPO, '.github', 'scripts', 'flows-result.mjs');
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
const PLANTED = 'planted-NOT-A-SECRET-0123456789';   // put into the runner's own environment by the child-environment checks
const CHILD_ALLOWED = new Set(['PATH', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'LANG', 'TZ',
  // Windows adds these six to any process it starts, whatever the parent passed (measured 2026-11-09: node with env { PATH } sees them); none holds a secret. The runner itself runs on ubuntu.
  ...(process.platform === 'win32' ? ['HOMEDRIVE', 'HOMEPATH', 'LOGONSERVER', 'SYSTEMDRIVE', 'USERDOMAIN', 'USERNAME'] : [])]);   // the spec's list, upper case: not read from the code under test
const HAS_SHARP =existsSync(join(REAL_RUNNER, 'node_modules', 'sharp')) && existsSync(join(RUNNER, 'node_modules', 'sharp'));

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
    OMNIKOM_REPO_ROOT: REPO, RUNNER_RETRY_BACKOFF_MS: '20', RUNNER_CF_API_BASE: `${fake.origin}/cf`, RUNNER_SMOKE_DEPLOY_URL: `${fake.origin}/deploy/`, ...(o.env || {}) };
  for (const k of o.unset || []) delete env[k];
  const r = await spawnNode(join(RUNNER, 'publish.mjs'), args, env, o.timeoutMs || 180000);
  await fake.close();
  const states = fake.log.callbacks.map((c) => c.body.state);
  return { ...r, fake, log: fake.log, dir, deployDir, work, states, last: fake.log.callbacks[fake.log.callbacks.length - 1] };
}
const LIVE = (e) => { e.site.state = 'live'; e.site.domain = 'demo-a.example'; };   // a live site (E8): deployed to main, judged as production
const NOT_BUILT = (h) => h + '\n<!-- not the build -->';   // the served page is not the built one, and its title is the same (E8)

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
await check('childEnv: only the allow-listed names pass from the source, the caller adds its own, an undefined extra is dropped', () => {
  const src = { PATH: '/bin', HOME: '/h', LANG: 'C', TZ: 'UTC', RUNNER_KEY: 'k', CLOUDFLARE_PAGES_TOKEN: 't', GITHUB_TOKEN: 'g', OMNIKOM_PLANTED_SECRET: 's', NODE_OPTIONS: '--x', FAKE_ANYTHING: '1' };
  const e = COMMON.childEnv({ NEEDED: '1', MISSING: undefined }, src);
  return same(Object.keys(e).sort(), ['HOME', 'LANG', 'NEEDED', 'PATH', 'TZ']) && e.PATH === '/bin' && e.NEEDED === '1' || JSON.stringify(e);
});
await check('childEnv: a caller value wins over the source, and the source object is not changed', () => {
  const src = { PATH: '/bin', HOME: '/h' };
  const e = COMMON.childEnv({ HOME: '/other' }, src);
  return e.HOME === '/other' && src.HOME === '/h' && Object.keys(src).length === 2;
});

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
await check('full run: done carries a local deploy id and the gate report (factory pass, the audit summary v 1: target preview, pass true, exit 0, counts.FAIL 0, no fails)', () => {
  const d = full.last.body, a = d.gateReport && d.gateReport.audit;
  return /^local-[0-9a-f]{12}$/.test(d.deployId) && d.gateReport.factory === 'pass' && !!a && a.v === 1 && a.target === 'preview' && a.pass === true && a.exit === 0 && a.counts.FAIL === 0 && a.counts.PASS > 0 && a.fails.length === 0 && a.truncated === 0 || JSON.stringify(d).slice(0, 600);
});
await check('full run: the stored gate report is under the callback\'s 64 KiB', () => JSON.stringify(full.last.body.gateReport).length < 64 * 1024);
await check('full run: the deploy folder holds the built site (index.html, _headers with noindex, the media file) and the record names the preview branch', () => {
  const rec = JSON.parse(readFileSync(join(full.work, 'deploy-record.json'), 'utf8'));
  return existsSync(join(full.deployDir, 'index.html')) && /X-Robots-Tag: noindex/.test(readFileSync(join(full.deployDir, '_headers'), 'utf8'))
    && existsSync(join(full.deployDir, 'media', 'logo.png')) && rec.branch === 'preview' && rec.project === 'test-site-demo-a' || JSON.stringify(rec);
});
await check('full run: the media file was downloaded from the signed URL the export carried', () => full.log.downloads.some((d) => d.startsWith('/storage/object/sign/media/logo.png?token=')) || JSON.stringify(full.log.downloads));
await check('full run: smoke asked the fixed address', () => full.log.siteHits.length >= 1 && full.log.siteHits[0] === '/site/');
await check("full run (E8): smoke also asked the deployment's own address", () => full.log.deployHits[0] === '/deploy/' || JSON.stringify(full.log.deployHits));
await check('full run: no secret, no signed-URL token and no project ref in anything printed', () =>
  !full.out.includes(RUNNER_KEY) && !full.out.includes(CF_TOKEN) && !full.out.includes(CF_ACCOUNT) && !full.out.includes('SIGNEDTOKEN123') || 'a secret reached the output');

}
// ================= 3b. the environment of the build and the audit (work order 14, H0-3) =================
// The design code the build imports and the audit run as children of the runner; neither may see a key. A fake repo root holds the real
// factory (a junction), a copy of the Demo A look whose shell.mjs first writes the names in its environment to a file, and a fake audit
// that does the same. The record paths are baked into those files: the children's own environment cannot carry them any more.
if (on('childenv')) {
const SECRET_NAMES = ['RUNNER_KEY', 'CLOUDFLARE_PAGES_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'PLATFORM_FUNCTIONS_BASE', 'GITHUB_TOKEN', 'OMNIKOM_PLANTED_SECRET', 'JOB_ID', 'SITE_ID'];
const seenSecrets = (names) => SECRET_NAMES.filter((n) => names.map((x) => x.toUpperCase()).includes(n));
const unknownNames = (names, extra = []) => names.filter((x) => !CHILD_ALLOWED.has(x.toUpperCase()) && !extra.includes(x.toUpperCase()));
const root = tmp('envroot'), seenDir = join(root, 'seen');
mkdirSync(seenDir, { recursive: true });
symlinkSync(join(REPO, 'factory'), join(root, 'factory'), 'junction');
const lookDir = join(root, 'sites', 'test-demo-a', 'design');
cpSync(join(REPO, 'sites', 'test-demo-a', 'design'), lookDir, { recursive: true });
const shellFile = join(lookDir, 'shell.mjs');
writeFileSync(shellFile, `import { writeFileSync as recordEnv } from 'node:fs';\nrecordEnv(${JSON.stringify(join(seenDir, 'build.json'))}, JSON.stringify(Object.keys(process.env)));\n${readFileSync(shellFile, 'utf8')}`);
mkdirSync(join(root, 'tools', 'audit'), { recursive: true });
writeFileSync(join(root, 'tools', 'audit', 'run.mjs'),
  `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(join(seenDir, 'audit.json'))}, JSON.stringify(Object.keys(process.env)));\nconsole.log(JSON.stringify({ v: 1, target: 'preview', mode: 'fake', pass: true, exit: 0, pages: 1, rules: 1, counts: { PASS: 1, FAIL: 0, SKIP: 0 }, byFamily: {}, fails: [], truncated: 0, commit: 'fake0001' }));\n`);   // the runner reads the audit's --summary JSON (work order 10)
const er = await runPublish({ env: { OMNIKOM_REPO_ROOT: root, GITHUB_TOKEN: `${PLANTED}-gh`, OMNIKOM_PLANTED_SECRET: PLANTED, CLOUDFLARE_API_TOKEN: `${PLANTED}-cf` } });
const readSeen = (f) => (existsSync(join(seenDir, f)) ? JSON.parse(readFileSync(join(seenDir, f), 'utf8')) : null);
const buildSeen = readSeen('build.json'), auditSeen = readSeen('audit.json');
await check('child env: the publish through the fake root ran to done, so the design and the audit really recorded their environment', () =>
  (er.code === 0 && !!buildSeen && !!auditSeen) || `exit ${er.code} build:${!!buildSeen} audit:${!!auditSeen}\n${er.out.slice(-500)}`);
await check('child env: the design code the build runs sees none of RUNNER_KEY, the Pages token, the API token, the account, the platform address, GITHUB_TOKEN or the planted secret', () =>
  !!buildSeen && seenSecrets(buildSeen).length === 0 || JSON.stringify(seenSecrets(buildSeen || [])));
await check('child env: the audit sees none of them either', () => !!auditSeen && seenSecrets(auditSeen).length === 0 || JSON.stringify(seenSecrets(auditSeen || [])));
await check('child env: the build and the audit see only allow-listed names (no job, site, test or CI variable)', () =>
  !!buildSeen && !!auditSeen && unknownNames(buildSeen).length === 0 && unknownNames(auditSeen).length === 0 || JSON.stringify([unknownNames(buildSeen || []), unknownNames(auditSeen || [])]));
await check('child env: the build still gets what it needs to start (PATH)', () => !!buildSeen && buildSeen.some((n) => n.toUpperCase() === 'PATH'));

}
// ================= 4. the deploy command, with a fake wrangler =================
if (on('wrangler')) {
const CFP = `/cf/accounts/${CF_ACCOUNT}/pages/projects/test-site-demo-a`;
// The fake is started through a per-run wrapper: it records the names in the environment wrangler was given, THEN adds the fake's own
// settings (a smaller environment no longer carries FAKE_* names) and imports the fake itself.
async function wranglerRun(o = {}) {
  const dir = tmp('wr'), rec = join(dir, 'record.json'), seen = join(dir, 'env-names.json'), wrapper = join(dir, 'wrapper.mjs');
  const fakeSettings = { FAKE_WRANGLER_RECORD: rec, FAKE_EXPECT_TOKEN: CF_TOKEN, FAKE_EXPECT_ACCOUNT: CF_ACCOUNT, FAKE_WRANGLER_DEPLOY_DIR: join(dir, 'deployed'), FAKE_WRANGLER_MODE: o.mode || 'ok' };
  writeFileSync(wrapper, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(seen)}, JSON.stringify(Object.keys(process.env)));\n`
    + `Object.assign(process.env, ${JSON.stringify(fakeSettings)});\nawait import(${JSON.stringify(pathToFileURL(join(HERE, 'lib', 'fake-wrangler.mjs')).href)});\n`);
  const r = await runPublish({
    ...o,
    exportMut: o.exportMut,
    args: ({ work, smoke }) => ['--work', work, ...smoke],
    env: { RUNNER_WRANGLER_SCRIPT: wrapper, GITHUB_TOKEN: `${PLANTED}-gh`, OMNIKOM_PLANTED_SECRET: PLANTED,...(o.env || {}) },
    cfg: { siteDir: join(dir, 'deployed'), ...(o.cfg || {}) },
  });
  r.wrangler = existsSync(rec) ? JSON.parse(readFileSync(rec, 'utf8')) : null;
  r.wranglerEnvNames = existsSync(seen) ? JSON.parse(readFileSync(seen, 'utf8')) : null;
  return r;
}
const wr = await wranglerRun();
await check('deploy: wrangler gets pages deploy <work>/dist --project-name <deploy_target> --branch preview --commit-dirty=true', () =>
  !!wr.wrangler && same(wr.wrangler.argv, ['pages', 'deploy', join(wr.work, 'dist'), '--project-name', 'test-site-demo-a', '--branch', 'preview', '--commit-dirty=true']));
await check('deploy: the Cloudflare token and account reach wrangler as CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID, and the runner key and platform address do not', () =>
  !!wr.wrangler && wr.wrangler.tokenOk && wr.wrangler.accountOk && !wr.wrangler.hasRunnerKey && !wr.wrangler.hasPagesToken && !wr.wrangler.hasBase || JSON.stringify(wr.wrangler));
const WR_EXTRA = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'WRANGLER_SEND_METRICS', 'CI', 'NPM_CONFIG_IGNORE_SCRIPTS'];
await check('deploy: wrangler is given exactly the allow list plus CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, WRANGLER_SEND_METRICS, CI and npm_config_ignore_scripts, nothing else', () => {
  const names = (wr.wranglerEnvNames || []).map((n) => n.toUpperCase());
  const stray = names.filter((n) => !CHILD_ALLOWED.has(n) && !WR_EXTRA.includes(n));
  return !!wr.wranglerEnvNames && WR_EXTRA.every((n) => names.includes(n)) && stray.length === 0 || `stray: ${JSON.stringify(stray)} missing: ${JSON.stringify(WR_EXTRA.filter((n) => !names.includes(n)))}`;
});
await check('deploy: wrangler does not see the planted secret, GITHUB_TOKEN, the job or site id, or the runner\'s own test settings', () => {
  const names = (wr.wranglerEnvNames || []).map((n) => n.toUpperCase());
  const bad = ['OMNIKOM_PLANTED_SECRET', 'GITHUB_TOKEN', 'JOB_ID', 'SITE_ID', 'RUNNER_KEY', 'PLATFORM_FUNCTIONS_BASE', 'CLOUDFLARE_PAGES_TOKEN', 'OMNIKOM_REPO_ROOT', 'RUNNER_WRANGLER_SCRIPT'].filter((n) => names.includes(n));
  return !!wr.wranglerEnvNames && bad.length === 0 || JSON.stringify(bad);
});
await check("deploy: the site's /api/lead function travels with the deploy (functions/api/lead.js and lead-endpoint.mjs in wrangler's folder)", () => !!wr.wrangler && wr.wrangler.leadFunction && wr.wrangler.leadEndpoint);
await check('deploy: the deployment hash is parsed from wrangler output and sent as the deploy id; a token wrangler printed is scrubbed', () =>
  wr.code === 0 && same(wr.states, ['gating', 'deploying', 'done']) && wr.last.body.deployId === '1a2b3c4d' && !wr.out.includes(CF_TOKEN) && !wr.out.includes(CF_ACCOUNT)
  && wr.out.includes('https://1a2b3c4d.test-site-demo-a.pages.dev') || `${wr.code} ${JSON.stringify(wr.states)}\n${wr.out.slice(-500)}`);
const wrLive = await wranglerRun({ exportMut: (e) => { e.site.state = 'live'; e.site.domain = 'demo-a.example'; } });
await check('deploy: a live site goes to --branch main, and its smoke does not want noindex', () =>
  !!wrLive.wrangler && wrLive.wrangler.argv.includes('--branch') && wrLive.wrangler.argv[wrLive.wrangler.argv.indexOf('--branch') + 1] === 'main' && wrLive.code === 0 || `${wrLive.code}\n${wrLive.out.slice(-400)}`);
const PREVIEW_JOB = (e) => { e.job.preview = true; }, wrDraft = await wranglerRun({ exportMut: (e) => { LIVE(e); PREVIEW_JOB(e); } });
await check('deploy (B15): a preview build of a live site goes to --branch draft, its smoke wants noindex, and it is judged as a preview', () =>
  !!wrDraft.wrangler && wrDraft.wrangler.argv[wrDraft.wrangler.argv.indexOf('--branch') + 1] === 'draft' && wrDraft.code === 0 && same(wrDraft.states, ['gating', 'deploying', 'done'])
  && wrDraft.last.body.gateReport?.audit?.target === 'preview' || `${wrDraft.code} ${JSON.stringify(wrDraft.states)}\n${wrDraft.out.slice(-400)}`);
await check('deploy (B15-b3): a preview ships the draft gate (only the token\'s sha256 and end time), is smoked through its link, and reports the link once, at done', () => {
  const key = readFileSync(join(wrDraft.work, 'pages-root', 'functions', 'draft-gate-key.mjs'), 'utf8'), link = wrDraft.last.body.gateReport?.link ?? {};
  return !!wrDraft.wrangler?.draftGate && /^[0-9a-f]{64}$/.test(link.k ?? '') && key.includes(createHash('sha256').update(link.k).digest('hex')) && !key.includes(link.k)
    && Date.parse(link.until) - Date.now() > 6.9 * 864e5 && !wrDraft.out.includes(link.k) && wrDraft.log.callbacks.filter((c) => c.rawBody.includes(link.k)).length === 1 || JSON.stringify({ gate: wrDraft.wrangler?.draftGate, link });
});
await check('deploy (B15-b3): a publish ships no draft gate and reports no link', () => wrLive.wrangler?.draftGate === false && wrLive.code === 0 && !wrLive.last.body.gateReport?.link);
const wrOpen = await wranglerRun({ exportMut: PREVIEW_JOB, cfg: { gateOff: true } }), wrStuck = await wranglerRun({ exportMut: PREVIEW_JOB, cfg: { gateOff: true, cf: { deleteStatus: 403 } } });
const wrKeep = await wranglerRun({ exportMut: PREVIEW_JOB, cfg: { gateKeepsToken: true } }), wrServe = await wranglerRun({ exportMut: PREVIEW_JOB, cfg: { gateServesLink: true } }), deletes = (r) => r.log.cfCalls.filter((c) => c.method === 'DELETE' && c.path === `${CFP}/deployments/${DRAFT_DEPLOYMENT.id}`).length;   // this site's project, this deployment, by its uuid (R3)
const wrNone = await wranglerRun({ exportMut: PREVIEW_JOB, cfg: { gateOff: true, cf: { pages: Array(5).fill([...NOT_THIS_DRAFT, ...Array(22).fill(NOT_THIS_DRAFT[0])]) } } }), wrTwo = await wranglerRun({ exportMut: PREVIEW_JOB, cfg: { gateOff: true, cf: { list: [DRAFT_DEPLOYMENT, { ...DRAFT_DEPLOYMENT, id: '1a2b3c4d-ffff-4fff-8fff-ffffffffffff' }] } } }), wrList = await wranglerRun({ exportMut: PREVIEW_JOB, cfg: { gateOff: true, cf: { listStatus: 500 } } });
await check('smoke (B15-b3): a draft address that answers without its link fails the run, exit 1', () => wrOpen.code === 1 && same(wrOpen.states, ['gating', 'deploying', 'failed'])
  && wrOpen.last.body.error.startsWith('deployed but smoke failed') && /without its signed link/.test(wrOpen.last.body.gateReport?.smoke ?? '') || `${wrOpen.code} ${JSON.stringify(wrOpen.states)}`);
await check('smoke (B15-b3, R1): a signed link answered without a redirect, or redirected to an address that keeps the token, fails the run', () => wrKeep.code === 1 && /still holds the token/.test(wrKeep.last.body.gateReport?.smoke ?? '') && wrServe.code === 1 && /not a redirect/.test(wrServe.last.body.gateReport?.smoke ?? '') || `${wrKeep.code} ${wrKeep.last?.body?.gateReport?.smoke} ${wrServe.code} ${wrServe.last?.body?.gateReport?.smoke}`);
await check('smoke (B15-b3, R2, R3): a failed draft is deleted by its uuid, found by its short id (the list read page by page, at most 4); a refused delete, no match, two matches or a failed list say so and name the address as still up', () => deletes(wrOpen) === 1 && deletes(wrStuck) === 1
  && [wrNone, wrTwo, wrList].every((r) => r.code === 1 && r.log.cfCalls.every((c) => c.method !== 'DELETE')) && wrNone.log.cfCalls.filter((c) => c.method === 'GET' && c.path.endsWith('/deployments')).length === 4 && same([wrOpen, wrStuck, wrNone, wrTwo, wrList].map((r) => (r.last?.body?.error ?? '').replace('deployed but smoke failed; ', '')), ['the draft deployment 1a2b3c4d was deleted (HTTP 200, success true)', ...['deleting the draft deployment 1a2b3c4d failed (HTTP 403, success false, refused by the fake)', ...['it is not in the deployment list', '2 deployments match it', 'the deployment list answered HTTP 500, success false, refused by the fake'].map((why) => `the draft deployment 1a2b3c4d was not deleted (${why})`)].map((s) => `${s}: https://1a2b3c4d.test-site-demo-a.pages.dev is still up`)]) || JSON.stringify([wrOpen, wrStuck, wrNone, wrTwo, wrList].map((r) => r.last?.body?.error)));
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
// ---- E8: a live deploy that fails its smoke goes back to the deployment that was live before (Pages makes a production deployment live the moment it exists)
const rbLive = await wranglerRun({ exportMut: LIVE, cfg: { siteMutate: NOT_BUILT } });
await check('rollback (E8): a live deploy whose smoke fails puts back the deployment that was live before, and the job fails saying so', () =>
  rbLive.code === 1 && same(rbLive.states, ['gating', 'deploying', 'failed']) && rbLive.last.body.error === `deployed but smoke failed; rolled back to deployment ${CANONICAL}`
  && same(rbLive.log.cfCalls.map((c) => [c.method, c.path]), [['GET', CFP], ['POST', `${CFP}/deployments/${CANONICAL}/rollback`]])
  && rbLive.log.cfCalls.every((c) => c.auth === `Bearer ${CF_TOKEN}`) && !rbLive.out.includes(CF_TOKEN)
  || `${rbLive.code} ${JSON.stringify(rbLive.states)} ${rbLive.last && rbLive.last.body.error} ${JSON.stringify(rbLive.log.cfCalls.map((c) => [c.method, c.path]))}`);
const rbPreview = await wranglerRun({ cfg: { siteMutate: NOT_BUILT } });
await check('rollback (E8): a preview that fails its smoke is not rolled back (Pages rolls back production only)', () =>
  rbPreview.code === 1 && rbPreview.last.body.error === 'deployed but smoke failed' && rbPreview.log.cfCalls.length >= 1 && rbPreview.log.cfCalls.every((c) => c.method === 'GET')
  || `${rbPreview.code} ${rbPreview.last && rbPreview.last.body.error} ${JSON.stringify(rbPreview.log.cfCalls.map((c) => c.method))}`);
const rbFirst = await wranglerRun({ exportMut: LIVE, cfg: { siteMutate: NOT_BUILT, cf: { canonical: null } } });
await check('rollback (E8): a first live deploy has nothing to roll back to and says so', () =>
  rbFirst.code === 1 && rbFirst.last.body.error === 'deployed but smoke failed; no earlier deployment to roll back to: the failed one stays live' && rbFirst.log.cfCalls.every((c) => c.method !== 'POST')
  || `${rbFirst.code} ${rbFirst.last && rbFirst.last.body.error} ${JSON.stringify(rbFirst.log.cfCalls.map((c) => c.method))}`);
const rbRefused = await wranglerRun({ exportMut: LIVE, cfg: { siteMutate: NOT_BUILT, cf: { rollbackStatus: 403 } } });
await check('rollback (E8): a rollback Cloudflare refuses is reported as failed, never as done', () =>
  rbRefused.code === 1 && rbRefused.last.body.error === `deployed but smoke failed; the rollback to ${CANONICAL} failed (HTTP 403): the failed deployment stays live` && rbRefused.log.cfCalls.filter((c) => c.method === 'POST').length === 1
  || `${rbRefused.code} ${rbRefused.last && rbRefused.last.body.error} ${JSON.stringify(rbRefused.log.cfCalls.map((c) => c.method))}`);
// ---- B15-F: Cloudflare refuses the DELETE of the deployment that holds the draft alias unless the query says force=true (HTTP 400, staging 2026-11-13); the fake refuses it the same way
const forced = (r) => r.log.cfCalls.filter((c) => c.search.includes('force')).map((c) => `${c.method} ${c.search}`);
await check('delete (B15-F): the DELETE of a failed draft carries ?force=true, and no other call of the runner (list reads, settings read, rollback) carries force', () =>
  same(forced(wrOpen), ['DELETE ?force=true']) && same(forced(wrStuck), ['DELETE ?force=true']) && [wrDraft, wrLive, rbLive, rbPreview, rbFirst, rbRefused].every((r) => forced(r).length === 0)
  || JSON.stringify([wrOpen, wrStuck, wrDraft, wrLive, rbLive, rbPreview, rbFirst, rbRefused].map(forced)));
const wrRefused = await wranglerRun({ exportMut: PREVIEW_JOB, cfg: { gateOff: true, cf: { deleteStatus: 400, deleteMessage: ALIASED } } }), told = `deployed but smoke failed; deleting the draft deployment 1a2b3c4d failed (HTTP 400, success false, ${ALIASED}): https://1a2b3c4d.test-site-demo-a.pages.dev is still up`;
await check('delete (B15-F): a 400 on the draft DELETE is told in Cloudflare\'s own words in the failed job\'s error, in its report and on the run\'s last line; the job fails once, exit 1, and the address is named as still up', () =>
  wrRefused.code === 1 && same(wrRefused.states, ['gating', 'deploying', 'failed']) && wrRefused.last.body.error === told && wrRefused.last.body.gateReport?.reason === told && wrRefused.out.includes(`RESULT failed: ${told}`)
  || `${wrRefused.code} ${JSON.stringify(wrRefused.states)} ${wrRefused.last?.body?.error}`);

}
// ================= 5. the gate that must stop a bad build =================
if (on('gate')) {
const bad = await runPublish({ args: ({ deployDir, work, smoke }) => ['--no-deploy', deployDir, '--work', work, ...smoke, '--force-fail', 'heading'] });
await check('force-fail heading: callbacks gating then failed, nothing deploys, exit 1', () => bad.code === 1 && same(bad.states, ['gating', 'failed']) || `${bad.code} ${JSON.stringify(bad.states)}`);
await check('force-fail heading: the failed report carries the audit summary v 1 (pass false, exit 1, counts.FAIL > 0) with the MET-003 FAIL of /contact/ in gateReport.audit.fails', () => {
  const g = bad.last.body.gateReport, a = g.audit;
  return bad.last.body.state === 'failed' && g.reason === 'audit failed' && g.factory === 'pass' && a.v === 1 && a.pass === false && a.exit === 1 && a.counts.FAIL > 0
    && a.fails.some((f) => f.rule === 'MET-003' && /^\/contact\//.test(f.page)) || JSON.stringify(g).slice(0, 600);
});
await check('force-fail heading: the FAIL is printed in the log (rule, page) from the summary', () => /^\s+FAIL MET-003 \/contact\//m.test(bad.out) || bad.out.slice(-500));
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
  (previewArgv.length === 4 && /dist$/.test(previewArgv[0]) && previewArgv[1] === '--target' && previewArgv[2] === 'preview' && previewArgv[3] === '--summary') || `audit was called with ${JSON.stringify(previewArgv)}`);
await runPublish({ env: { OMNIKOM_REPO_ROOT: argvRepo }, exportMut: (e) => { e.site.state = 'live'; e.site.domain = 'demo-a.example.com'; } });
const liveArgv = auditArgv();
await check('audit target: a live export is audited with --target production, after the built folder', () =>
  (liveArgv.length === 4 && /dist$/.test(liveArgv[0]) && liveArgv[1] === '--target' && liveArgv[2] === 'production' && liveArgv[3] === '--summary') || `audit was called with ${JSON.stringify(liveArgv)}`);
// the summary is stored whole (work order 10): a stub audit prints a known summary object and exits 0 or 1; what the platform is told must be that object, byte for byte
const stubAudit = (tag, script) => {
  const d = tmp(`repo-${tag}`);
  mkdirSync(join(d, 'tools', 'audit'), { recursive: true });
  writeFileSync(join(d, 'tools', 'audit', 'run.mjs'), script);
  for (const x of ['factory', 'sites', 'contracts']) symlinkSync(join(REPO, x), join(d, x), 'junction');
  return d;
};
const SUMMARY = { v: 1, target: 'preview', mode: 'stub', pass: true, exit: 0, pages: 3, rules: 7, counts: { PASS: 20, FAIL: 0, SKIP: 1 }, byFamily: { MET: { PASS: 20, FAIL: 0, SKIP: 1 } }, fails: [], truncated: 0, commit: 'stub0001' };
const SUMMARY_FAIL = { ...SUMMARY, pass: false, exit: 1, counts: { PASS: 19, FAIL: 1, SKIP: 1 }, byFamily: { MET: { PASS: 19, FAIL: 1, SKIP: 1 } }, fails: [{ rule: 'MET-003', page: '/x/', line: 4, what: 'stub finding', source: 'stub' }] };
const printing = (o, code) => `console.log(${JSON.stringify(JSON.stringify(o))}); process.exit(${code});\n`;
const stubPass = await runPublish({ env: { OMNIKOM_REPO_ROOT: stubAudit('pass', printing(SUMMARY, 0)) } });
await check('audit summary: a pass stores the summary whole as gateReport.audit in the done callback (and the log line gives its counts)', () =>
  stubPass.code === 0 && same(stubPass.states, ['gating', 'deploying', 'done']) && same(stubPass.last.body.gateReport, { factory: 'pass', audit: SUMMARY }) && /STEP gating: audit exit 0 \(target preview\), PASS 20, FAIL 0, SKIP 1/.test(stubPass.out)
  || `${stubPass.code} ${JSON.stringify(stubPass.states)} ${JSON.stringify(stubPass.last.body).slice(0, 400)}`);
const stubFail = await runPublish({ env: { OMNIKOM_REPO_ROOT: stubAudit('fail', printing(SUMMARY_FAIL, 1)) } });
await check('audit summary: a fail stores the summary whole in the failed callback and still stops (exit 1, nothing deploys, no smoke)', () =>
  stubFail.code === 1 && same(stubFail.states, ['gating', 'failed']) && stubFail.last.body.error === 'audit failed' && same(stubFail.last.body.gateReport, { reason: 'audit failed', factory: 'pass', audit: SUMMARY_FAIL })
  && !existsSync(stubFail.deployDir) && stubFail.log.siteHits.length === 0 || `${stubFail.code} ${JSON.stringify(stubFail.states)} ${JSON.stringify(stubFail.last.body).slice(0, 400)}`);
for (const [label, script, exit] of [
  ['not JSON, exit 0', "console.log('PASS MET-001 /'); process.exit(0);\n", 0],
  ['not JSON, exit 1', "console.log('FAIL MET-003 /contact/ 4 x'); process.exit(1);\n", 1],
  ['nothing printed, exit 1', 'process.exit(1);\n', 1],
  ['a JSON list', "console.log('[]'); process.exit(0);\n", 0],
  ['a summary of another version (v 2)', printing({ ...SUMMARY, v: 2 }, 0), 0],
  ['a summary without a pass flag', printing({ v: 1, fails: [] }, 0), 0],
]) {
  const un = await runPublish({ env: { OMNIKOM_REPO_ROOT: stubAudit('unreadable', script) } });
  await check(`audit summary: ${label} = failed "audit output unreadable" after gating (never a silent pass), the exit and the last lines kept, nothing deploys`, () =>
    un.code === 1 && same(un.states, ['gating', 'failed']) && un.last.body.error === 'audit output unreadable' && un.last.body.gateReport.audit.exit === exit && Array.isArray(un.last.body.gateReport.audit.lines)
    && !existsSync(un.deployDir) || `${un.code} ${JSON.stringify(un.states)} ${JSON.stringify(un.last.body).slice(0, 300)}`);
}

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
// work order 13 (H0-1): S-JOB-BUSY (409, another build of the site is running or stuck until the reaper fails it) is waited out, not made a permanent failed.
// The waits shrink through RUNNER_BUSY_BACKOFF_MS (first wait; then x2, x4, x4) and RUNNER_BUSY_WAIT_MS (total); the real ones are 30 s, 60 s, 120 s and 20 minutes.
const busy2 = await runPublish({ cfg: { exportBusy: 2 }, env: { RUNNER_BUSY_BACKOFF_MS: '30', RUNNER_BUSY_WAIT_MS: '5000' } });
await check('export busy (409 S-JOB-BUSY) twice, then 200: waits twice (one STEP line each, tries 1 and 2), then builds and ends done, exit 0', () =>
  busy2.code === 0 && same(busy2.states, ['gating', 'deploying', 'done']) && busy2.log.exportCalls.length === 3
  && (busy2.out.match(/^STEP export: site busy \(S-JOB-BUSY\), waiting [\d.]+ s, try \d+$/gm) || []).length === 2 && /waiting [\d.]+ s, try 1\b/.test(busy2.out) && /waiting [\d.]+ s, try 2\b/.test(busy2.out)
  || `${busy2.code} ${JSON.stringify(busy2.states)} calls ${busy2.log.exportCalls.length}\n${busy2.out.slice(0, 600)}`);
const busyForever = await runPublish({ cfg: { exportBusy: Infinity }, env: { RUNNER_BUSY_BACKOFF_MS: '30', RUNNER_BUSY_WAIT_MS: '200' } });
await check('export busy past RUNNER_BUSY_WAIT_MS: failed "site busy: another build of this site is still running after N min (the reaper clears a stuck one within 35 min)", every wait printed, no build, exit 1', () =>
  busyForever.code === 1 && same(busyForever.states, ['failed']) && /^site busy: another build of this site is still running after [\d.]+ min \(the reaper clears a stuck one within 35 min\)$/.test(busyForever.last.body.error)
  && (busyForever.out.match(/waiting [\d.]+ s, try \d+/g) || []).length === 3 && busyForever.log.exportCalls.length === 4 && !existsSync(join(busyForever.work, 'dist'))
  || `${busyForever.code} ${JSON.stringify(busyForever.states)} ${busyForever.last && busyForever.last.body.error} calls ${busyForever.log.exportCalls.length}\n${busyForever.out.slice(0, 600)}`);
const other409 = await runPublish({ cfg: { exportStatus: 409 }, env: { RUNNER_BUSY_BACKOFF_MS: '30', RUNNER_BUSY_WAIT_MS: '200' } });
await check('a 409 that is not S-JOB-BUSY on the export: failed at once with the status, one call, no wait printed, exit 1', () =>
  other409.code === 1 && same(other409.states, ['failed']) && /HTTP 409/.test(other409.last.body.error) && other409.log.exportCalls.length === 1 && !/site busy|waiting/.test(other409.out)
  || `${other409.code} ${JSON.stringify(other409.states)} calls ${other409.log.exportCalls.length}\n${other409.out.slice(0, 400)}`);
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
const notBuilt = await runPublish({ cfg: { siteMutate: NOT_BUILT } });
await check("smoke (E8): the deployment's own address serving another page than the one built (same title) fails the run on the content hash, exit 1", () =>
  notBuilt.code === 1 && same(notBuilt.states, ['gating', 'deploying', 'failed']) && notBuilt.last.body.error === 'deployed but smoke failed' && /content hash/.test(notBuilt.last.body.gateReport.smoke)
  || `${notBuilt.code} ${JSON.stringify(notBuilt.states)} ${notBuilt.last && notBuilt.last.body.error} ${notBuilt.last && notBuilt.last.body.gateReport && notBuilt.last.body.gateReport.smoke}`);

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
  await check('workflows: the nine files exist', () => same(files, ['alerts.yml', 'backup.yml', 'ci.yml', 'flows.yml', 'keepalive.yml', 'key-rotation.yml', 'media.yml', 'publish.yml', 'restore-drill.yml']));
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
  const ciNames = lines('ci.yml').filter((l) => /^    name: /.test(l)).map((l) => l.slice('    name: '.length).trim());
  await check('ci.yml: no job name carries a version number, so a tool bump never renames a required check (E9)', () => {
    const bad = ciNames.filter((n) => /\d+\.\d+/.test(n));
    return (ciNames.length >= 9 && bad.length === 0) || `${ciNames.length} job names; with a version: ${bad.join(' | ')}`;
  });
  await check('ci.yml: every required check of .github/master-ruleset.json is a ci.yml job name (E9)', () => {
    const rule = JSON.parse(readFileSync(join(REPO, '.github', 'master-ruleset.json'), 'utf8')).rules.find((r) => r.type === 'required_status_checks');
    const want = rule.parameters.required_status_checks.map((c) => c.context), missing = want.filter((n) => !ciNames.includes(n));
    return (want.length >= 9 && missing.length === 0) || `${want.length} required checks; not a ci.yml job name: ${missing.join(' | ')}`;
  });
  await check('publish.yml: repository_dispatch publish and a manual run with job_id, site_id, force_fail; one 30 minute job; one build per site, queue max', () => {
    const t = wf['publish.yml'];
    return /repository_dispatch:\n    types: \[publish\]/.test(t) && /workflow_dispatch:/.test(t) && ['job_id', 'site_id', 'force_fail'].every((n) => new RegExp('^      ' + n + ':', 'm').test(t))
      && /^    timeout-minutes: 30$/m.test(t) && /group: site-\$\{\{ github\.event\.client_payload\.site_id \|\| inputs\.site_id \}\}\n  queue: max/.test(t)
      && /node factory\/runner\/publish\.mjs/.test(t) && ['PLATFORM_FUNCTIONS_BASE', 'RUNNER_KEY', 'CLOUDFLARE_PAGES_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].every((n) => t.includes('secrets.' + n));
  });
  await check('media.yml: repository_dispatch media and workflow_dispatch with media_id and workspace_id (E9), a locked install of sharp with scripts off, one build per media id', () => {
    const t = wf['media.yml'];
    return /repository_dispatch:\n    types: \[media\]/.test(t) && /^  workflow_dispatch:\n    inputs:\n      media_id:/m.test(t) && /^      workspace_id:/m.test(t)
      && t.includes('npm ci --prefix factory/runner --ignore-scripts') && t.includes('group: media-${{ github.event.client_payload.media_id || inputs.media_id }}\n  queue: max')
      && lines('media.yml').includes('          MEDIA_ID: ${{ github.event.client_payload.media_id || inputs.media_id }}')
      && lines('media.yml').includes('          WORKSPACE_ID: ${{ github.event.client_payload.workspace_id || inputs.workspace_id }}') && t.includes('node factory/runner/media.mjs');
  });
  await check('backup.yml: the job is off unless the variable BACKUP_ENABLED is true (R2 is deferred)', () => /^    if: \$\{\{ vars\.BACKUP_ENABLED == 'true' \}\}$/m.test(wf['backup.yml']) && /BLOCKED: R2/.test(wf['backup.yml']));
  await check('keepalive.yml: Mondays 06:00 UTC and by hand, one status call per target staging with the four staging names', () =>
    wf['keepalive.yml'].includes("cron: '0 6 * * 1'") && wf['keepalive.yml'].includes('workflow_dispatch:') && wf['keepalive.yml'].includes('omnikom.mjs status --target staging')
    && ['STAGING_DB_URL', 'STAGING_SUPABASE_REF', 'STAGING_SUPABASE_SECRET_KEY', 'STAGING_SUPABASE_PUBLISHABLE_KEY'].every((n) => wf['keepalive.yml'].includes('secrets.' + n)));
  await check('ci.yml: the nine jobs, and the four downloaded binaries (gitleaks, osv-scanner, actionlint, shellcheck) are pinned by exact version and sha256 and the sum is checked; actionlint is given the pinned shellcheck', () => {
    const t = wf['ci.yml'], at = t.split('\n').indexOf('jobs:');
    const jobs = t.split('\n').slice(at + 1).filter((x) => /^  [a-z]+:\s*$/.test(x)).map((x) => x.trim().slice(0, -1));
    return same(jobs, ['gates', 'factory', 'functions', 'audit', 'cli', 'dashboard', 'departments', 'secrets', 'workflows'])
      && t.includes('551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb') && t.includes('8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8')
      && t.includes('b7af85e41cc99489dcc21d66c6d5f3685138f06d34651e6d34b42ec6d54fe6f6') && t.includes('shellcheck/releases/download/v0.11.0/')
      && t.includes('-shellcheck "$RUNNER_TEMP/shellcheck-v0.11.0/shellcheck"')
      && (t.match(/sha256sum --check -/g) || []).length === 4 && t.includes('gitleaks/releases/download/v8.30.1/')
      && t.includes('160c6253e2922e9e0a6a9771c5c4c40a4b3c6090b34a3cdd5e80c96cc2e4218b') && t.includes('osv-scanner/releases/download/v2.7.0/') && t.includes('actionlint/releases/download/v1.7.12/') && t.includes('fetch-depth: 0');
  });
  // FLOWS-RUNNER-1: one named staging flow on GitHub's runner, by hand (flows.yml), and its result line (.github/scripts/flows-result.mjs)
  const t = wf['flows.yml'];
  const whole = (x) => lines('flows.yml').includes(x);
  await check('flows.yml: started only by hand', () =>
    /^on:\n  workflow_dispatch:\n/m.test(t) && !/^  (push|pull_request|pull_request_target|schedule|repository_dispatch|workflow_run|workflow_call|merge_group):/m.test(t));
  await check('flows.yml: the inputs spec (a choice of exactly the spec files of apps/dashboard/tests), grep and mutant', () => {
    const choice = lines('flows.yml').filter((l) => /^          - [\w.-]+\.spec\.ts$/.test(l)).map((l) => l.trim().slice(2));
    const specs = readdirSync(join(REPO, 'apps', 'dashboard', 'tests')).filter((f) => f.endsWith('.spec.ts')).sort();
    return (same(choice, specs) && /^        type: choice$/m.test(t) && /^      spec:$/m.test(t) && /^      grep:$/m.test(t) && /^      mutant:$/m.test(t)) || `${JSON.stringify(choice)} ${JSON.stringify(specs)}`;
  });
  await check('flows.yml: one flow at a time against staging, the job 90 minutes, the flow stopped at 75', () =>
    t.includes('concurrency:\n  group: flows-staging\n  queue: max\n') && /^    timeout-minutes: 90$/m.test(t) && t.includes('timeout 75m node node_modules/@playwright/test/cli.js test '));
  await check('flows.yml: a ref other than master or check/, a spec, grep or mutant outside its pattern and an empty staging secret are refused before anything is installed', () => {
    const want = [
      '          case "$GITHUB_REF" in refs/heads/master|refs/heads/check/*) ;; *) echo "BLOCKED: flows run only from master or a check/ branch"; exit 1 ;; esac',
      "          spec_re='^[a-z-]+\\.spec\\.ts$'; grep_re='^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,99}$'; mutant_re='^([a-z0-9]+(-[a-z0-9]+)*)?$'",
      '          [[ "$FLOWS_SPEC" =~ $spec_re ]] || { echo "BLOCKED: spec is not a file name of apps/dashboard/tests"; exit 1; }',
      '          [[ "$FLOWS_GREP" =~ $grep_re ]] || { echo "BLOCKED: grep takes 1 to 100 letters, digits, spaces and . _ : - only"; exit 1; }',
      '          [[ "$FLOWS_MUTANT" =~ $mutant_re ]] || { echo "BLOCKED: mutant is empty or a FLOWS_MUTANT name (lower-case words joined by -)"; exit 1; }',
      '          for name in STAGING_SUPABASE_REF STAGING_SUPABASE_PUBLISHABLE_KEY STAGING_SUPABASE_SECRET_KEY STAGING_DB_URL; do [ -n "${!name}" ] || { echo "BLOCKED: $name has no repository secret (setting one is the owner\'s)"; missing=1; }; done',
    ];
    const lacking = want.filter((x) => !whole(x));
    return (lacking.length === 0 && t.indexOf('- name: Preflight (names only)') < t.indexOf('npm ci ')) || `not whole: ${lacking.map((x) => x.trim().slice(0, 40)).join(' | ')}`;
  });
  await check('flows.yml: the inputs reach the command only as quoted variables, all output goes to files, no trace, screenshot or video', () =>
    whole('        run: PLAYWRIGHT_JSON_OUTPUT_FILE="$RUNNER_TEMP/flows/report.json" timeout 75m node node_modules/@playwright/test/cli.js test "tests/$FLOWS_SPEC" --grep="$FLOWS_GREP" --reporter=list,json > "$RUNNER_TEMP/flows/flows.log" 2>&1 || echo "playwright exit $?"')
    && t.includes('> "$RUNNER_TEMP/flows/npm.log" 2>&1') && t.includes('> "$RUNNER_TEMP/flows/build.log" 2>&1') && !/--trace|--screenshot|--video/.test(t));
  await check('flows.yml: the output is sealed with FLOWS_REPORT_KEY read from the environment, only when it is set, and only the sealed file is kept, 7 days', () => {
    const seal = ['          set -o pipefail',
      '          if [ -z "$FLOWS_REPORT_KEY" ]; then echo "no artifact: FLOWS_REPORT_KEY has no repository secret, and nothing is kept unsealed"; exit 0; fi',
      '          tar -czf - -C "$RUNNER_TEMP/flows" . | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:FLOWS_REPORT_KEY -out "$RUNNER_TEMP/flows-report.enc"',
      '          echo "sealed=yes" >> "$GITHUB_OUTPUT"'];
    const paths = lines('flows.yml').filter((l) => /^\s+path: /.test(l));
    return (t.includes('\n' + seal.map((l) => `${l}\n`).join('')) && whole("        if: ${{ !cancelled() && steps.seal.outputs.sealed == 'yes' }}")
      && same(paths, ['          path: ${{ runner.temp }}/flows-report.enc']) && /^          retention-days: 7$/m.test(t)) || JSON.stringify(paths);
  });
  await check('flows.yml: the secrets are exactly six names', () => {
    const names = [...new Set([...t.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]))].sort();
    return same(names, ['FLOWS_REPORT_KEY', 'SITE_SIGNING_KEY_TEST_DEMO_A', 'STAGING_SUPABASE_REF', 'STAGING_SUPABASE_PUBLISHABLE_KEY', 'STAGING_SUPABASE_SECRET_KEY', 'STAGING_DB_URL'].sort()) || names.join(',');
  });
  await check('flows.yml: the result comes from the JSON report, also after a red flow', () =>
    t.includes('        if: ${{ !cancelled() }}\n        run: node .github/scripts/flows-result.mjs "$RUNNER_TEMP/flows/report.json"'));
  await check('flows.yml: without SITE_SIGNING_KEY_TEST_DEMO_A a chosen flow that sends a lead stops before the browser starts', () =>
    ['          if [ -n "$SITE_SIGNING_KEY_TEST_DEMO_A" ]; then echo "SITE_SIGNING_KEY_TEST_DEMO_A is set"; exit 0; fi',
      '          PLAYWRIGHT_JSON_OUTPUT_FILE="$RUNNER_TEMP/flows/list.json" node node_modules/@playwright/test/cli.js test "tests/$FLOWS_SPEC" --grep="$FLOWS_GREP" --list --reporter=json > "$RUNNER_TEMP/flows/list.log" 2>&1 || { echo "BLOCKED: Playwright could not list the chosen flows (list.log, sealed)"; exit 1; }',
      '          node ../../.github/scripts/flows-result.mjs --sends-lead "$RUNNER_TEMP/flows/list.json" "tests/$FLOWS_SPEC"'].every(whole)
    && t.indexOf('npm ci ') < t.indexOf('--sends-lead') && t.indexOf('--sends-lead') < t.indexOf('timeout 75m '));
  await check("flows.yml: the dashboard's dependencies are installed locked, install scripts off, and no other install runs", () => {
    const ci = t.split('npm ci').length - 1, other = ['npm install', 'npm i ', 'npx ', 'playwright install'].filter((x) => t.includes(x));
    return (t.includes('        working-directory: apps/dashboard\n        run: npm ci --ignore-scripts --no-audit --no-fund ') && ci === 1 && other.length === 0)
      || `npm ci ${ci} time(s); other installs: ${other.join(' | ') || 'none'}`;
  });

  // the script, run as the workflow runs it: a report (an object as JSON, a string as is, undefined no file), the job summary in a temp file
  const fr = async (report, env = {}, spec) => {
    const dir = tmp('flows'), file = join(dir, 'report.json'), summary = join(dir, 'summary.md');
    if (report !== undefined) writeFileSync(file, typeof report === 'string' ? report : JSON.stringify(report));
    writeFileSync(summary, 'before\n');
    const childEnv = { ...BASE_ENV, GITHUB_STEP_SUMMARY: summary, ...env };
    if (env.GITHUB_STEP_SUMMARY === null) delete childEnv.GITHUB_STEP_SUMMARY;   // CI's own summary is never written by a test
    const r = await spawnNode(FLOWS_RESULT, spec ? ['--sends-lead', file, spec] : [file], childEnv, 30000);
    return { code: r.code, lines: r.out.split(/\r?\n/).filter(Boolean), summary: readFileSync(summary, 'utf8') };
  };
  const rep = (specs, stats, errors = []) => ({ suites: [{ title: 'x.spec.ts', specs: [], suites: [{ title: 'd', specs, suites: [] }] }], errors, stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 0, ...stats } });
  const sp = (title, status, msgs = []) => ({ title, tests: [{ status, results: [{ errors: msgs.map((message) => ({ message })) }] }] });
  const lst = (...titles) => ({ suites: [{ title: 'flows.spec.ts', specs: [], suites: titles.map((title) => ({ title, specs: [{ title: 't', tests: [] }], suites: [] })) }] });
  const SPEC = join(REPO, 'apps', 'dashboard', 'tests', 'flows.spec.ts');
  const KEYLINE = "BLOCKED: the chosen flow sends a lead and SITE_SIGNING_KEY_TEST_DEMO_A has no repository secret (setting one is the owner's)";
  const LEAK = 'eyJnotajwt0.eyJnotajwt0.notasig abcdefghijklmnopqrst.supabase.co someone@example.com 00000000-0000-0000-0000-00000000000a 5.3 flows abc123def live (555) 010-0153 NOTREAL0123456789abcdefghijklmnopqrs qrstuvwxyzabcdefghij Q:\\fake\\a.txt http://127.0.0.1:27001/auth/confirm?token_hash=abc';
  await check('flows-result: R1 one passed test exits 0 and its line is in the log and the job summary', async () => {
    const r = await fr(rep([sp('B11 put the site back', 'expected')], { expected: 1 }));
    return (r.code === 0 && same(r.lines, ['flows result: 1 passed']) && r.summary === 'before\nflows result: 1 passed\n') || JSON.stringify(r);
  });
  await check('flows-result: R2 a failed test exits 1 with the counts and the first line of its first error, every pattern redacted', async () => {
    const r = await fr(rep([sp('B11 put the site back', 'unexpected', [`Error: the earlier heading came back (${LEAK})\n\nExpected: 7`]), sp('other', 'expected')], { expected: 1, unexpected: 1 }));
    return (r.code === 1 && same(r.lines, ['flows result: 1 failed, 1 passed', 'flows first error: B11 put the site back: Error: the earlier heading came back ([token] [host] [email] [uuid] [lead] [phone] [secret] [id] [path] [url])'])) || JSON.stringify(r);
  });
  await check('flows-result: R3 a skipped test is never a pass', async () => {
    const r = await fr(rep([sp('s', 'skipped')], { skipped: 1 }), { GITHUB_STEP_SUMMARY: null });
    return (r.code === 1 && same(r.lines, ['flows result: 1 skipped'])) || JSON.stringify(r);
  });
  await check('flows-result: R4 a setup error with no test run exits 1 and is reported', async () => {
    const r = await fr(rep([], {}, [{ message: 'Error: BLOCKED: Auth generate_link for owner-a answered 401: Invalid API key\n    at mintTokenHash' }]));
    return (r.code === 1 && same(r.lines, ['flows result: 0 tests ran', 'flows first error: Error: BLOCKED: Auth generate_link for owner-a answered 401: Invalid API key'])) || JSON.stringify(r);
  });
  await check('flows-result: R5 no report file, or a report that is not JSON, exits 1', async () => {
    const none = await fr(undefined), junk = await fr('not json');
    return [none, junk].every((r) => r.code === 1 && same(r.lines, ['flows result: no readable report'])) || JSON.stringify([none, junk]);
  });
  await check('flows-result: R6 a chosen flow of the describe that sends the live lead stops without the key', async () => {
    const r = await fr(lst('a lead appears live'), {}, SPEC);
    return (r.code === 1 && same(r.lines, [KEYLINE])) || JSON.stringify(r);
  });
  await check('flows-result: R7 a chosen flow of the describe that sends a member\'s lead stops without the key', async () => {
    const r = await fr(lst('a member sees only their leads'), {}, SPEC);
    return (r.code === 1 && same(r.lines, [KEYLINE])) || JSON.stringify(r);
  });
  await check('flows-result: R8 chosen flows that send no lead go on', async () => {
    const r = await fr(lst('a member of A cannot open B', 'the CRM screens as the owner'), {}, SPEC);
    return (r.code === 0 && same(r.lines, ['flows list: no chosen flow sends a lead'])) || JSON.stringify(r);
  });
  await check('flows-result: R9 no list file exits 1', async () => {
    const r = await fr(undefined, {}, SPEC);
    return (r.code === 1 && same(r.lines, ['BLOCKED: no readable list of the chosen flows'])) || JSON.stringify(r);
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
