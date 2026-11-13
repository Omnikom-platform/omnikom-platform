// The publish runner (02-BACKEND section 7, 21-PROTOCOLS sections 1 to 3; brief factory/briefs/4-4-runner-and-workflows.md).
// One publish job: fetch the export, download its media, build the site, judge it with the audit engine, deploy it to the
// export's Pages project, smoke-test the deployment's own address by content hash and the site's address, roll a live deploy that fails the smoke
// back to the deployment that was live before, tell the platform. Started by .github/workflows/publish.yml.
//   node factory/runner/publish.mjs [--force-fail heading] [--no-deploy <dir>] [--work <dir>]
//        [--smoke-url <url>] [--smoke-tries <n>] [--smoke-interval-ms <ms>]       (the last three exist for tests of the smoke step)
// Environment, by name: JOB_ID, SITE_ID (the dispatch payload), PLATFORM_FUNCTIONS_BASE (https://<ref>.supabase.co/functions/v1),
// RUNNER_KEY, CLOUDFLARE_PAGES_TOKEN, CLOUDFLARE_ACCOUNT_ID. Test hooks: OMNIKOM_REPO_ROOT, RUNNER_WRANGLER_SCRIPT,
// RUNNER_FETCH_TIMEOUT_MS, RUNNER_RETRY_BACKOFF_MS, RUNNER_CF_API_BASE (the Cloudflare API address the lead-settings check reads),
// RUNNER_BUSY_BACKOFF_MS (the first S-JOB-BUSY wait, default 30000; then x2, x4, x4 ...). RUNNER_BUSY_WAIT_MS (default 1200000) is the total S-JOB-BUSY wait.
// RUNNER_SMOKE_DEPLOY_URL stands in for the deployment's own address (https://<hash>.<project>.pages.dev) in the smoke, which a --no-deploy run has none of.
// Every child process (build, audit, wrangler) gets childEnv(): an allow list plus what that step needs, never this process's whole environment (H0-3).
// Exit 0 only after `done` was answered 2xx. A failed run exits 1 after its `failed` callback was answered. 2 = usage / environment.
// Every line printed goes through the scrubber (secret values, the project ref and signed-URL tokens never reach a log).
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, cpSync } from 'node:fs';
import { dirname, join, resolve, sep, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { UUID, SLUG, safeRelPath, checkBase, makeScrubber, makePlatform, numEnv, childEnv } from './lib/common.mjs';

const WRANGLER_VERSION = '4.152.0';   // 4.156.0 (the brief's pin) was 2 days old on 2026-10-31: supply-chain rule 1 (7 days); bump on purpose
const LEAD_SETTINGS = ['SITE_ID', 'SITE_SIGNING_KEY', 'PLATFORM_BASE'];   // what factory/worker/pages-function-lead.js reads from the Pages project
// Cloudflare's limits on a _routes.json (developers.cloudflare.com/pages/functions/routing/, read by the head 2026-11-13): "You may have no more than 100 include/exclude rules combined." and "Each rule may have no more than 100 characters." Past either, the gone function (book row B12-E) is invoked for every request instead of for its addresses only.
const ROUTES_MAX_RULES = 100, ROUTES_MAX_CHARS = 100;
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
const CF_API = env.RUNNER_CF_API_BASE || 'https://api.cloudflare.com/client/v4';
// E8: Cloudflare's shapes, UNPROVEN against the real API (outside knowledge, no source in the repository): the project's live production deployment, and the call that makes a deployment live again.
const liveDeploymentOf = (project) => (project && project.canonical_deployment && project.canonical_deployment.id) || null;
const rollbackUrl = (target, id) => `${CF_API}/accounts/${CF_ACCOUNT}/pages/projects/${target}/deployments/${id}/rollback`;
const deploymentsUrl = (target) => `${CF_API}/accounts/${CF_ACCOUNT}/pages/projects/${target}/deployments`;   // B15-b3 (R2, R3): the project's deployment list; one deployment is <this>/<its uuid>
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

function runTool(cmd, args, { cwd = REPO, timeoutMs, toolEnv } = {}) {
  if (!toolEnv) throw new Error('runTool: the child needs its environment passed (childEnv)');
  const r = spawnSync(cmd, args, { cwd, env: toolEnv, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true, shell: false });
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

// E8: put back the deployment that was live before (one try, 30 s like the settings read); the words go into the failed job.
async function rollBack(target, previous) {
  if (!previous) return 'no earlier deployment to roll back to: the failed one stays live';
  const r = await fetch(rollbackUrl(target, previous), { method: 'POST', headers: { authorization: `Bearer ${CF_TOKEN}` }, signal: AbortSignal.timeout(30000) }).catch(() => null);
  const j = r ? await r.json().catch(() => null) : null;
  return r && r.status === 200 && j && j.success === true ? `rolled back to deployment ${previous}` : `the rollback to ${previous} failed (${r ? `HTTP ${r.status}` : 'no answer'}): the failed deployment stays live`;
}

// Book row B15-b3 (R2, R3): a draft whose smoke failed may be open to anyone: delete it by its uuid, never a guess. Its short id (wrangler's address) is looked up in the deployment list (pages of 25, at most 4, no order assumed, stopping at the first page that holds it); exactly one entry whose short_id is it AND whose id starts with it is deleted by that id; anything else deletes nothing and says so. Cloudflare's status, success and first error go into the failed job.
async function deleteDraft(target, shortId, url) {
  const call = (u, method) => fetch(u, { method, headers: { authorization: `Bearer ${CF_TOKEN}` }, signal: AbortSignal.timeout(30000) }).then(async (r) => ({ r, j: await r.json().catch(() => null) }), () => ({ r: null, j: null }));
  const said = ({ r, j }) => (r ? `HTTP ${r.status}, success ${j ? j.success : 'unreadable'}${j && Array.isArray(j.errors) && j.errors[0] ? `, ${scrub(String(j.errors[0].message)).slice(0, 160)}` : ''}` : 'no answer'), left = (why) => `the draft deployment ${shortId} was not deleted (${why}): ${url} is still up`;
  let hits = [];
  for (let page = 1, n = 25; page <= 4 && !hits.length && n === 25; page++) {
    const got = await call(`${deploymentsUrl(target)}?per_page=25&page=${page}`, 'GET'), list = got.r && got.r.ok && got.j && got.j.success === true && Array.isArray(got.j.result) ? got.j.result : null;
    if (!list) return left(`the deployment list answered ${said(got)}`);
    hits = list.filter((d) => d && d.short_id === shortId && typeof d.id === 'string' && d.id.startsWith(shortId)); n = list.length;
  }
  if (hits.length !== 1) return left(hits.length ? `${hits.length} deployments match it` : 'it is not in the deployment list');   // R3: no match or more than one is never a guess
  const del = await call(`${deploymentsUrl(target)}/${hits[0].id}?force=true`, 'DELETE');   // B15-F: Cloudflare refuses the DELETE of the deployment that holds the draft alias without force (HTTP 400, staging 2026-11-13)
  return del.r && del.r.ok && del.j && del.j.success === true ? `the draft deployment ${shortId} was deleted (${said(del)})` : `deleting the draft deployment ${shortId} failed (${said(del)}): ${url} is still up`;
}

// Book row B15-b3 (R1): a draft is asked as a visitor asks it: the signed link must answer 3xx with the cookie and an address holding no k; that address is asked with the cookie.
async function viaLink(url, token, ask) {
  const first = await ask(`${url}?k=${token}`, 'manual'), to = new URL(first.headers.get('location') || url, url), cookie = (first.headers.get('set-cookie') || '').split(';')[0];
  if (first.status < 300 || first.status > 399) return { res: first, why: `the signed link answers HTTP ${first.status}, not a redirect` };
  return to.searchParams.has('k') ? { res: first, why: 'the signed link redirects to an address that still holds the token' } : { res: await ask(to.href, 'follow', cookie), why: '' };
}

async function run() {
  const work = opts.work ? resolve(opts.work) : mkdtempSync(join(tmpdir(), `omnikom-publish-${JOB_ID.slice(0, 8)}-`));
  mkdirSync(work, { recursive: true });
  const dist = join(work, 'dist');

  // ---- 1 export
  if (!opts['no-deploy'] && (!CF_TOKEN || !CF_ACCOUNT)) throw new Stop('missing deploy credentials', { missing: ['CLOUDFLARE_PAGES_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter((n) => !env[n]) });
  let ex = await platform.call('GET', `/export-published?job=${JOB_ID}`);
  // S-JOB-BUSY (409): another build of this site is still running, or was killed and waits for the reaper (pg_cron, every 5 minutes, fails a job stuck
  // for 30 minutes). Wait 30 s, 60 s, then 120 s per try, up to RUNNER_BUSY_WAIT_MS in all; any other 409 and every other status is handled below as before.
  const busyWaitMs = numEnv('RUNNER_BUSY_WAIT_MS', 20 * 60000), busyBaseMs = numEnv('RUNNER_BUSY_BACKOFF_MS', 30000);
  const isBusy = (r) => { if (r.status !== 409) return false; try { return JSON.parse(r.text).code === 'S-JOB-BUSY'; } catch { return false; } };
  const tenth = (ms, unit) => Math.round(ms / unit * 10) / 10;
  for (let tries = 0, waited = 0; isBusy(ex); tries++) {
    const remaining = busyWaitMs - waited;
    if (remaining <= 0) throw new Stop(`site busy: another build of this site is still running after ${tenth(waited, 60000)} min (the reaper clears a stuck one within 35 min)`, { status: 409, waitedMs: waited });
    const wait = Math.min(busyBaseMs * Math.min(2 ** tries, 4), remaining);
    step('export', `site busy (S-JOB-BUSY), waiting ${tenth(wait, 1000)} s, try ${tries + 1}`);
    await new Promise((r) => setTimeout(r, wait));
    waited += wait;
    ex = await platform.call('GET', `/export-published?job=${JOB_ID}`);
  }
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
    ...(opts['force-fail'] ? ['--force-fail', opts['force-fail']] : [])], { timeoutMs: 180000, toolEnv: childEnv() });
  if (b.status !== 0) throw new Stop('build failed', { factory: { exit: b.status, lines: tail(b.text, 20) } });
  step('build', tail(b.text, 2).join(' | '));

  // ---- 4 gating: the audit engine judges the built folder, independent of the factory's own gates
  await callback('gating');
  // one decision for the audit and the deploy: a site that is not live goes to the preview branch and is judged as a preview build (it must carry noindex), a live site goes to main and is judged as production (it must not)
  const branch = exp.job.preview === true ? 'draft' : exp.site.state !== 'live' ? 'preview' : 'main';   // book row B15: a preview build goes to draft, judged and smoked as a preview
  const auditTarget = branch === 'main' ? 'production' : 'preview';
  const gate = branch === 'draft' && !opts['no-deploy'] ? { token: randomBytes(32).toString('hex'), until: Date.now() + 7 * 24 * 3600 * 1000 } : null;   // book row B15-b3: one signed link per preview job, 7 days
  // --summary prints one small versioned JSON object (tools/audit/summary.mjs, under 60 KiB); it is stored whole as gateReport.audit for a pass and a fail
  const a = runTool(process.execPath, [join(REPO, 'tools', 'audit', 'run.mjs'), dist, '--target', auditTarget, '--summary'], { timeoutMs: 180000, toolEnv: childEnv() });
  if (a.status === 2) throw new Stop('audit usage error', { factory: 'pass', audit: { exit: 2, lines: tail(a.text, 10) } });
  let audit = null;
  try { audit = JSON.parse(a.stdout); } catch { /* reported below */ }
  if (!audit || typeof audit !== 'object' || audit.v !== 1 || typeof audit.pass !== 'boolean' || !Array.isArray(audit.fails)) throw new Stop('audit output unreadable', { factory: 'pass', audit: { exit: a.status, lines: tail(a.text, 10) } });
  const counts = audit.counts || {};
  const countsLine = `PASS ${counts.PASS ?? 0}, FAIL ${counts.FAIL ?? 0}, SKIP ${counts.SKIP ?? 0}`;
  if (a.status !== 0) {
    for (const f of audit.fails.slice(0, 20)) out(`  FAIL ${f.rule} ${f.page}${f.line == null ? '' : `:${f.line}`} ${f.what}`);
    throw new Stop('audit failed', { factory: 'pass', audit });
  }
  const gateReport = { factory: 'pass', audit };
  step('gating', `audit exit 0 (target ${auditTarget}), ${countsLine}`);

  // ---- 4b the lead function ships with every deploy and answers 503 "not configured" without its three settings (5-L round 2):
  // read the target project's settings (names only) for the environment this deploy lands in and stop at gating if one is missing
  let previous = null;   // E8: the production deployment live before this deploy (liveDeploymentOf)
  if (!opts['no-deploy']) {
    const envName = branch === 'main' ? 'production' : 'preview';
    let cf = null, cfJson = null;
    for (let n = 1; n <= 3 && !(cf && cf.status < 500); n++) {   // a dropped connection or a 5xx is tried again (like platform.call); a 4xx is an answer
      if (n > 1) await new Promise((r) => setTimeout(r, numEnv('RUNNER_RETRY_BACKOFF_MS', 1000) * n));
      cf = await fetch(`${CF_API}/accounts/${CF_ACCOUNT}/pages/projects/${target}`, { headers: { authorization: `Bearer ${CF_TOKEN}` }, signal: AbortSignal.timeout(30000) }).catch(() => null);
      cfJson = cf ? await cf.json().catch(() => null) : null;
    }
    if (!cf || cf.status !== 200 || !cfJson || cfJson.success === false || !cfJson.result) throw new Stop(`lead endpoint settings could not be read from the ${target} project (${cf ? `HTTP ${cf.status}` : 'no answer'}): nothing was deployed`, { project: target, environment: envName });
    previous = liveDeploymentOf(cfJson.result);
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
    if (gate) {   // book row B15-b3: the draft gate runs before every request of this deployment; only the token's sha256 and end time ship
      const fns = join(work, 'pages-root', 'functions');
      cpSync(join(REPO, 'factory', 'worker', 'pages-function-draft-gate.js'), join(fns, '_middleware.js'));
      cpSync(join(REPO, 'factory', 'worker', 'draft-gate.mjs'), join(fns, 'draft-gate.mjs'));
      writeFileSync(join(fns, 'draft-gate-key.mjs'), `export const GATE = ${JSON.stringify({ sha256: createHash('sha256').update(gate.token).digest('hex'), until: gate.until })};\n`);
    }
    // book row B12-E: the addresses of items that left the site in the last 7 days (the export's `removed`, minus what this build serves) answer a true 404 from a function of this deployment, because Cloudflare's edge goes on serving an old deployment's page for up to a week. Never in a draft (the draft gate has this file name there). _routes.json names the same addresses and /api/lead, so the function is invoked for nothing else; past Cloudflare's limits (ROUTES_MAX_RULES, ROUTES_MAX_CHARS) it names every request instead, and the function's exact match keeps every other page as it is, so a publish never fails for the number of removed items. With no such address the deploy is exactly what it was.
    const gone = gate ? [] : (await import(pathToFileURL(join(REPO, 'factory', 'lib', 'plan.mjs')).href)).goneAddresses(exp);
    if (gone.length) {
      const fns = join(work, 'pages-root', 'functions');
      const rules = ['/api/lead', ...gone], wide = rules.length > ROUTES_MAX_RULES || gone.some((a) => a.length > ROUTES_MAX_CHARS);
      cpSync(join(REPO, 'factory', 'worker', 'pages-function-gone.js'), join(fns, '_middleware.js'));
      cpSync(join(REPO, 'factory', 'worker', 'gone.mjs'), join(fns, 'gone.mjs'));
      writeFileSync(join(fns, 'gone-list.mjs'), `export const GONE = ${JSON.stringify({ paths: gone, page: readFileSync(join(dist, '404.html'), 'utf8') })};\n`);
      writeFileSync(join(dist, '_routes.json'), `${JSON.stringify({ version: 1, include: wide ? ['/*'] : rules, exclude: [] })}\n`);
      step('gone', `${gone.length} removed address(es) answer 404 from this deployment's own function (the addresses are not printed)${wide ? `; every request passes the function (more than ${ROUTES_MAX_RULES} rules or a rule over ${ROUTES_MAX_CHARS} characters)` : ''}`);
    }
    const wargs = ['pages', 'deploy', dist, '--project-name', target, '--branch', branch, '--commit-dirty=true'];
    const [cmd, args] = process.env.RUNNER_WRANGLER_SCRIPT
      ? [process.execPath, [process.env.RUNNER_WRANGLER_SCRIPT, ...wargs]]
      : [process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', `wrangler@${WRANGLER_VERSION}`, ...wargs]];
    const wenv = childEnv({ CLOUDFLARE_API_TOKEN: CF_TOKEN, CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT, WRANGLER_SEND_METRICS: 'false', CI: 'true', npm_config_ignore_scripts: 'true' });
    const w = runTool(cmd, args, { cwd: join(work, 'pages-root'), timeoutMs: 420000, toolEnv: wenv });
    for (const l of tail(w.text, 6)) out(`  wrangler: ${l}`);
    if (w.status !== 0) throw new Stop('deploy failed', { wrangler: { exit: w.status, lines: tail(w.text, 10).map(scrub) } });
    const m = new RegExp(`https://([a-z0-9]+)\\.${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.pages\\.dev`).exec(w.text);
    if (!m) throw new Stop('deploy failed: wrangler printed no deployment address', { wrangler: { exit: w.status, lines: tail(w.text, 10).map(scrub) } });
    deployUrl = m[0];
    deployId = m[1];
  }
  step('deploying', `${branch} deployment ${deployId}${deployUrl ? ` at ${deployUrl}` : ' (local, nothing sent to Cloudflare)'}`);

  // ---- 6 smoke: the deployment's own address serves the bytes we built (sha256 of the home page); the fixed address answers 200, a preview says noindex, a live site does not, the page is the one we built
  const isLive = branch === 'main';
  const smokeUrl = opts['smoke-url'] || (isLive ? (exp.site.domain ? `https://${exp.site.domain}/` : `https://${target}.pages.dev/`) : `https://${branch}.${target}.pages.dev/`);
  const wantTitle = titleOf(readFileSync(join(dist, 'index.html'), 'utf8'));
  const wantHash = createHash('sha256').update(readFileSync(join(dist, 'index.html'))).digest('hex');
  const ownUrl = env.RUNNER_SMOKE_DEPLOY_URL || deployUrl;   // the deployment's own address (a test hook stands in for it)
  const ask = (u, redirect = 'follow', cookie = '') => fetch(u, { redirect, headers: { 'cache-control': 'no-cache', ...(cookie ? { cookie } : {}) }, signal: AbortSignal.timeout(15000) });
  const tries = Number(opts['smoke-tries'] || 6), gap = Number(opts['smoke-interval-ms'] || 10000);
  let smokeWhy = 'never answered';
  let smokeOk = false;
  for (let n = 1; n <= tries && !smokeOk; n++) {
    try {
      const a = gate ? await viaLink(smokeUrl, gate.token, ask) : { res: await ask(smokeUrl), why: '' }, res = a.res;   // book row B15-b3: a draft through its signed link
      const body = await res.text();
      const b = gate ? await viaLink(ownUrl, gate.token, ask) : { res: await ask(ownUrl), why: '' }, own = b.res;
      const ownHash = createHash('sha256').update(Buffer.from(await own.arrayBuffer())).digest('hex');
      const robots = res.headers.get('x-robots-tag') || '';
      const bare = gate ? (await ask(smokeUrl, 'manual')).status : 404;   // book row B15-b3: without the link, a plain 404
      if (bare !== 404) smokeWhy = `the draft address answers HTTP ${bare} without its signed link`;
      else if (a.why || b.why) smokeWhy = a.why || b.why;
      else if (res.status !== 200) smokeWhy = `HTTP ${res.status}`;
      else if (!isLive && !/noindex/i.test(robots)) smokeWhy = 'a preview must answer x-robots-tag noindex';
      else if (isLive && /noindex/i.test(robots)) smokeWhy = 'a live site answered x-robots-tag noindex';
      else if (wantTitle === null || !body.includes(`<title>${wantTitle}</title>`)) smokeWhy = 'the page is not the one that was built (title differs)';
      else if (ownHash !== wantHash) smokeWhy = "the deployment's own address does not serve the page that was built (content hash differs)";
      else smokeOk = true;
    } catch (e) { smokeWhy = e && e.name === 'TimeoutError' ? 'timeout' : 'no answer'; }
    out(`  smoke ${n} of ${tries}: ${smokeOk ? 'ok' : smokeWhy}`);
    if (!smokeOk && n < tries) await new Promise((r) => setTimeout(r, gap));
  }
  if (!smokeOk) throw new Stop(`deployed but smoke failed${branch === 'main' && !opts['no-deploy'] ? `; ${await rollBack(target, previous)}` : gate ? `; ${await deleteDraft(target, deployId, deployUrl)}` : ''}`, { ...gateReport, deployId, deployUrl, smoke: smokeWhy });
  step('smoke', `${smokeUrl} answers 200${isLive ? '' : ' with noindex'}, title and content hash match${gate ? ', its link a redirect, 404 without it' : ''}`);

  // ---- 7 done
  await callback('done', { deployId, gateReport: gate ? { ...gateReport, link: { k: gate.token, until: new Date(gate.until).toISOString() } } : gateReport });
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
