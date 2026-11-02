// The publish runner (02-BACKEND section 7, 21-PROTOCOLS sections 1 to 3; brief factory/briefs/4-4-runner-and-workflows.md).
// One publish job: fetch the export, download its media, build the site, judge it with the audit engine, deploy it to the
// export's Pages project, smoke-test the address, tell the platform. Started by .github/workflows/publish.yml.
//   node factory/runner/publish.mjs [--force-fail heading] [--no-deploy <dir>] [--work <dir>]
//        [--smoke-url <url>] [--smoke-tries <n>] [--smoke-interval-ms <ms>]       (the last three exist for tests of the smoke step)
// Environment, by name: JOB_ID, SITE_ID (the dispatch payload), PLATFORM_FUNCTIONS_BASE (https://<ref>.supabase.co/functions/v1),
// RUNNER_KEY, CLOUDFLARE_PAGES_TOKEN, CLOUDFLARE_ACCOUNT_ID. Test hooks: OMNIKOM_REPO_ROOT, RUNNER_WRANGLER_SCRIPT,
// RUNNER_FETCH_TIMEOUT_MS, RUNNER_RETRY_BACKOFF_MS, RUNNER_CF_API_BASE (the Cloudflare API address the lead-settings check reads).
// Exit 0 only after `done` was answered 2xx. A failed run exits 1 after its `failed` callback was answered. 2 = usage / environment.
// Every line printed goes through the scrubber (secret values, the project ref and signed-URL tokens never reach a log).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, cpSync } from 'node:fs';
import { dirname, join, resolve, sep, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { UUID, SLUG, safeRelPath, checkBase, makeScrubber, makePlatform, numEnv } from './lib/common.mjs';

const WRANGLER_VERSION = '4.152.0';   // 4.156.0 (the brief's pin) was 2 days old on 2026-10-31: supply-chain rule 1 (7 days); bump on purpose
const LEAD_SETTINGS = ['SITE_ID', 'SITE_SIGNING_KEY', 'PLATFORM_BASE'];   // what factory/worker/pages-function-lead.js reads from the Pages project
const REPO = process.env.OMNIKOM_REPO_ROOT ? resolve(process.env.OMNIKOM_REPO_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const USAGE = 'usage: node factory/runner/publish.mjs [--force-fail heading] [--no-deploy <dir>] [--work <dir>] [--smoke-url <url>] [--smoke-tries <n>] [--smoke-interval-ms <ms>]';

const opts = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!['--force-fail', '--no-deploy', '--work', '--smoke-url', '--smoke-tries', '--smoke-interval-ms'].includes(a) || i + 1 >= argv.length) { console.error(`unknown or incomplete argument ${a}\n${USAGE}`); process.exit(2); }
  opts[a.slice(2)] = argv[++i];
}
if (opts['force-fail'] !== undefined && opts['force-fail'] !== 'heading') { console.error(`--force-fail knows only "heading"\n${USAGE}`); process.exit(2); }

const env = process.env;
const JOB_ID = env.JOB_ID, SITE_ID = env.SITE_ID, BASE = env.PLATFORM_FUNCTIONS_BASE, KEY = env.RUNNER_KEY;
const CF_TOKEN = env.CLOUDFLARE_PAGES_TOKEN, CF_ACCOUNT = env.CLOUDFLARE_ACCOUNT_ID;
const scrub = makeScrubber([KEY, CF_TOKEN, CF_ACCOUNT, BASE], BASE || '');
const out = (line) => console.log(scrub(line));
const step = (name, result) => out(`STEP ${name}: ${result}`);
const tail = (text, n) => String(text || '').split(/\r?\n/).filter((l) => l.trim() !== '').slice(-n);

const missing = ['JOB_ID', 'SITE_ID', 'PLATFORM_FUNCTIONS_BASE', 'RUNNER_KEY'].filter((n) => !env[n]);
if (missing.length) { console.error(`set (by name): ${missing.join(', ')}\n${USAGE}`); process.exit(2); }
if (!UUID.test(JOB_ID) || !UUID.test(SITE_ID)) { console.error('JOB_ID and SITE_ID must be UUIDs'); process.exit(2); }
const baseProblem = checkBase(BASE);
if (baseProblem) { console.error(baseProblem); process.exit(2); }

const platform = makePlatform({ base: BASE, key: KEY, timeoutMs: numEnv('RUNNER_FETCH_TIMEOUT_MS', 30000), retries: 3, backoffMs: numEnv('RUNNER_RETRY_BACKOFF_MS', 1000) });

class Stop extends Error { constructor(reason, report = {}) { super(reason); this.reason = reason; this.report = report; } }
class Refused extends Error {}   // the platform's state machine answered 409: print and stop, nothing more is sent

// POST <base>/job-callback, the body signed. 2xx = taken. 409 = refused (the run stops). Anything else = the run cannot continue.
async function callback(state, extra = {}) {
  const body = JSON.stringify({ job: JOB_ID, state, ...extra });
  const r = await platform.call('POST', '/job-callback', body);
  if (r.status >= 200 && r.status < 300) return;
  if (r.status === 409) throw new Refused(`the platform refused the ${state} callback (HTTP 409): ${r.text.slice(0, 200)}`);
  throw new Error(`the ${state} callback was not delivered (${r.status || r.error}): ${r.text.slice(0, 200)}`);
}

function runTool(cmd, args, { cwd = REPO, timeoutMs, envOverride } = {}) {
  const r = spawnSync(cmd, args, { cwd, env: envOverride || env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true, shell: false });
  return { status: r.status, text: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '', error: r.error ? String(r.error.message || r.error) : null };
}

function treeHash(dir) {
  const h = createHash('sha256');
  const walk = (d) => readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).forEach((e) => {
    const p = join(d, e.name);
    if (e.isDirectory()) return walk(p);
    h.update(relative(dir, p).split(sep).join('/')).update('\0').update(readFileSync(p)).update('\0');
  });
  walk(dir);
  return h.digest('hex');
}

const titleOf = (htmlText) => { const m = /<title>([^<]*)<\/title>/i.exec(htmlText); return m ? m[1] : null; };

async function run() {
  const work = opts.work ? resolve(opts.work) : mkdtempSync(join(tmpdir(), `omnikom-publish-${JOB_ID.slice(0, 8)}-`));
  mkdirSync(work, { recursive: true });
  const dist = join(work, 'dist');

  // ---- 1 export
  if (!opts['no-deploy'] && (!CF_TOKEN || !CF_ACCOUNT)) throw new Stop('missing deploy credentials', { missing: ['CLOUDFLARE_PAGES_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter((n) => !env[n]) });
  const ex = await platform.call('GET', `/export-published?job=${JOB_ID}`);
  if (ex.status !== 200) throw new Stop(`export failed: HTTP ${ex.status || ex.error}`, { status: ex.status });
  let exp;
  try { exp = JSON.parse(ex.text); } catch { throw new Stop('export failed: the answer is not JSON'); }
  if (!exp || !exp.site || !exp.job || !exp.workspace || typeof exp.workspace.slug !== 'string') throw new Stop('export failed: the answer has no site, job or workspace');
  if (exp.site.id !== SITE_ID) throw new Stop('site mismatch', { expected: SITE_ID, got: String(exp.site.id).slice(0, 40) });
  if (exp.job.id !== JOB_ID) throw new Stop('job mismatch', { expected: JOB_ID, got: String(exp.job.id).slice(0, 40) });
  if (!SLUG.test(exp.workspace.slug)) throw new Stop('export failed: the workspace slug is not a plain slug');
  const target = exp.site.deploy_target;
  if (typeof target !== 'string' || !SLUG.test(target)) throw new Stop('export failed: the deploy target is not a Pages project name');
  const design = join(REPO, 'sites', exp.workspace.slug, 'design');
  if (!existsSync(design)) throw new Stop('no look-folder', { looked: `sites/${exp.workspace.slug}/design` });
  writeFileSync(join(work, 'export.json'), ex.text);
  step('export', `job ${JOB_ID.slice(0, 8)} site ${SITE_ID.slice(0, 8)} -> ${target}, ${(exp.rows || []).length} rows, ${(exp.media || []).length} media, state ${exp.site.state}`);

  // ---- 2 media: download every signed URL of the export; the factory copies only what a built row references and stops if that is missing
  const mediaDir = join(work, 'media');
  mkdirSync(mediaDir, { recursive: true });
  const origin = new URL(BASE).origin;
  const fetchTimeout = numEnv('RUNNER_FETCH_TIMEOUT_MS', 60000);
  const deadline = Date.now() + 240000;
  const lost = [];
  let got = 0;
  const list = Array.isArray(exp.media) ? exp.media : [];
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const m = list[next++];
      if (!m || !safeRelPath(m.path)) throw new Stop('unsafe media path in the export', { media: m && m.id });
      let why = null;
      if (typeof m.url !== 'string' || !m.url) why = 'no url';
      else if (new URL(m.url, origin).origin !== origin) why = 'url on another host';
      else if (Date.now() > deadline) why = 'step time spent';
      else {
        try {
          const res = await fetch(m.url, { signal: AbortSignal.timeout(fetchTimeout) });
          if (res.status !== 200) why = `HTTP ${res.status}`;
          else {
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length > 32 * 1024 * 1024) why = 'file over 32 MB';
            else { const dest = join(mediaDir, ...m.path.split('/')); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, buf); got++; }
          }
        } catch (e) { why = e && e.name === 'TimeoutError' ? 'timeout' : 'download error'; }
      }
      if (why) lost.push(`${m.id}: ${why}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, list.length) }, worker));
  step('media', `${got} of ${list.length} downloaded${lost.length ? `; not downloaded (a build stops if it needs one): ${lost.join('; ')}` : ''}`);

  // ---- 3 build
  const b = runTool(process.execPath, [join(REPO, 'factory', 'build.mjs'), '--export', join(work, 'export.json'), '--out', dist, '--design', design, '--media', mediaDir,
    ...(opts['force-fail'] ? ['--force-fail', opts['force-fail']] : [])], { timeoutMs: 180000 });
  if (b.status !== 0) throw new Stop('build failed', { factory: { exit: b.status, lines: tail(b.text, 20) } });
  step('build', tail(b.text, 2).join(' | '));

  // ---- 4 gating: the audit engine judges the built folder, independent of the factory's own gates
  await callback('gating');
  // one decision for the audit and the deploy: a site that is not live goes to the preview branch and is judged as a preview build (it must carry noindex), a live site goes to main and is judged as production (it must not)
  const branch = exp.site.state !== 'live' ? 'preview' : 'main';
  const auditTarget = branch === 'main' ? 'production' : 'preview';
  const a = runTool(process.execPath, [join(REPO, 'tools', 'audit', 'run.mjs'), dist, '--target', auditTarget], { timeoutMs: 180000 });
  const fails = a.stdout.split(/\r?\n/).filter((l) => /^FAIL\s/.test(l));
  if (a.status === 2) throw new Stop('audit usage error', { factory: 'pass', audit: { exit: 2, fails, lines: tail(a.text, 10) } });
  if (a.status !== 0) throw new Stop('audit failed', { factory: 'pass', audit: { exit: a.status, fails } });
  const gateReport = { factory: 'pass', audit: { exit: 0, fails: [] } };
  step('gating', `audit exit 0 (target ${auditTarget}), ${tail(a.text, 1).join('')}`);

  // ---- 4b the lead function ships with every deploy and answers 503 "not configured" without its three settings (5-L round 2):
  // read the target project's settings (names only) for the environment this deploy lands in and stop at gating if one is missing
  if (!opts['no-deploy']) {
    const envName = branch === 'main' ? 'production' : 'preview';
    let cf = null, cfJson = null;
    for (let n = 1; n <= 3 && !(cf && cf.status < 500); n++) {   // a dropped connection or a 5xx is tried again (like platform.call); a 4xx is an answer
      if (n > 1) await new Promise((r) => setTimeout(r, numEnv('RUNNER_RETRY_BACKOFF_MS', 1000) * n));
      cf = await fetch(`${env.RUNNER_CF_API_BASE || 'https://api.cloudflare.com/client/v4'}/accounts/${CF_ACCOUNT}/pages/projects/${target}`, { headers: { authorization: `Bearer ${CF_TOKEN}` }, signal: AbortSignal.timeout(30000) }).catch(() => null);
      cfJson = cf ? await cf.json().catch(() => null) : null;
    }
    if (!cf || cf.status !== 200 || !cfJson || cfJson.success === false || !cfJson.result) throw new Stop(`lead endpoint settings could not be read from the ${target} project (${cf ? `HTTP ${cf.status}` : 'no answer'}): nothing was deployed`, { project: target, environment: envName });
    const have = Object.keys((cfJson.result.deployment_configs && cfJson.result.deployment_configs[envName] && cfJson.result.deployment_configs[envName].env_vars) || {});
    const lacking = LEAD_SETTINGS.filter((n) => !have.includes(n));
    if (lacking.length) throw new Stop(`lead endpoint not configured: the ${target} ${envName} environment lacks ${lacking.join(', ')}; nothing was deployed`, { project: target, environment: envName, missing: lacking });
    step('lead settings', `${target} ${envName} has ${LEAD_SETTINGS.join(', ')}`);
  }

  // ---- 5 deploying: preview branch unless the site is live; Functions of the site (/api/lead) travel with the deploy from a staged root
  await callback('deploying');
  let deployId, deployUrl;
  if (opts['no-deploy']) {
    const dir = resolve(opts['no-deploy']);
    if (existsSync(dir) && readdirSync(dir).length) throw new Stop('deploy failed: the --no-deploy folder is not empty');
    cpSync(dist, dir, { recursive: true });
    deployId = `local-${treeHash(dist).slice(0, 12)}`;
    deployUrl = null;
    writeFileSync(join(work, 'deploy-record.json'), JSON.stringify({ project: target, branch, dir, deployId }, null, 2));
  } else {
    const root = join(work, 'pages-root', 'functions', 'api');
    mkdirSync(root, { recursive: true });
    cpSync(join(REPO, 'factory', 'worker', 'pages-function-lead.js'), join(root, 'lead.js'));
    cpSync(join(REPO, 'factory', 'worker', 'lead-endpoint.mjs'), join(root, 'lead-endpoint.mjs'));
    const wargs = ['pages', 'deploy', dist, '--project-name', target, '--branch', branch, '--commit-dirty=true'];
    const [cmd, args] = process.env.RUNNER_WRANGLER_SCRIPT
      ? [process.execPath, [process.env.RUNNER_WRANGLER_SCRIPT, ...wargs]]
      : [process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', `wrangler@${WRANGLER_VERSION}`, ...wargs]];
    const wenv = { ...env, CLOUDFLARE_API_TOKEN: CF_TOKEN, CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT, WRANGLER_SEND_METRICS: 'false', CI: 'true', npm_config_ignore_scripts: 'true' };
    delete wenv.RUNNER_KEY; delete wenv.CLOUDFLARE_PAGES_TOKEN; delete wenv.PLATFORM_FUNCTIONS_BASE;
    const w = runTool(cmd, args, { cwd: join(work, 'pages-root'), timeoutMs: 420000, envOverride: wenv });
    for (const l of tail(w.text, 6)) out(`  wrangler: ${l}`);
    if (w.status !== 0) throw new Stop('deploy failed', { wrangler: { exit: w.status, lines: tail(w.text, 10).map(scrub) } });
    const m = new RegExp(`https://([a-z0-9]+)\\.${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.pages\\.dev`).exec(w.text);
    if (!m) throw new Stop('deploy failed: wrangler printed no deployment address', { wrangler: { exit: w.status, lines: tail(w.text, 10).map(scrub) } });
    deployUrl = m[0];
    deployId = m[1];
  }
  step('deploying', `${branch} deployment ${deployId}${deployUrl ? ` at ${deployUrl}` : ' (local, nothing sent to Cloudflare)'}`);

  // ---- 6 smoke: the fixed address answers 200, a preview says noindex, a live site does not, the page is the one we built
  const isLive = exp.site.state === 'live';
  const smokeUrl = opts['smoke-url'] || (isLive ? (exp.site.domain ? `https://${exp.site.domain}/` : `https://${target}.pages.dev/`) : `https://preview.${target}.pages.dev/`);
  const wantTitle = titleOf(readFileSync(join(dist, 'index.html'), 'utf8'));
  const tries = Number(opts['smoke-tries'] || 6), gap = Number(opts['smoke-interval-ms'] || 10000);
  let smokeWhy = 'never answered';
  let smokeOk = false;
  for (let n = 1; n <= tries && !smokeOk; n++) {
    try {
      const res = await fetch(smokeUrl, { redirect: 'follow', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
      const body = await res.text();
      const robots = res.headers.get('x-robots-tag') || '';
      if (res.status !== 200) smokeWhy = `HTTP ${res.status}`;
      else if (!isLive && !/noindex/i.test(robots)) smokeWhy = 'a preview must answer x-robots-tag noindex';
      else if (isLive && /noindex/i.test(robots)) smokeWhy = 'a live site answered x-robots-tag noindex';
      else if (wantTitle === null || !body.includes(`<title>${wantTitle}</title>`)) smokeWhy = 'the page is not the one that was built (title differs)';
      else smokeOk = true;
    } catch (e) { smokeWhy = e && e.name === 'TimeoutError' ? 'timeout' : 'no answer'; }
    out(`  smoke ${n} of ${tries}: ${smokeOk ? 'ok' : smokeWhy}`);
    if (!smokeOk && n < tries) await new Promise((r) => setTimeout(r, gap));
  }
  if (!smokeOk) throw new Stop('deployed but smoke failed', { ...gateReport, deployId, deployUrl, smoke: smokeWhy });
  step('smoke', `${smokeUrl} answers 200${isLive ? '' : ' with noindex'}, title matches`);

  // ---- 7 done
  await callback('done', { deployId, gateReport });
  step('done', `deploy ${deployId}`);
}

try {
  try { await run(); }
  catch (e) {
    if (!(e instanceof Stop)) throw e;
    step('failed', e.reason);
    await callback('failed', { error: e.reason, gateReport: { reason: e.reason, ...e.report }, ...(e.report.deployId ? { deployId: e.report.deployId } : {}) });
    out(`RESULT failed: ${e.reason}`);
    process.exit(1);
  }
  out('RESULT done');
  process.exit(0);
} catch (e) {
  out(`RESULT failed: ${e instanceof Refused ? e.message : `${e && e.message ? e.message : e}`}`);
  process.exit(1);
}
