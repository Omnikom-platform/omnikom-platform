// A Cloudflare Pages project for one of our own pages (the dashboard, the status page): created when missing, a custom domain
// attached when asked (the DNS record it needs is printed for the owner's click: DNS stays his, CLAUDE.md rule 6), and a folder
// deployed with the pinned wrangler the way factory/runner/publish.mjs does. Client sites are NOT made here (the publish job).
//   node tools/with-env.mjs "<env file>" -- node tools/pages-project.mjs --name omnikom-app-staging [--branch main]
//        [--domain <host>] [--deploy <folder>]
// Needs CLOUDFLARE_PAGES_TOKEN and CLOUDFLARE_ACCOUNT_ID (by name; never printed; the output is scrubbed of both).
// Sources: https://developers.cloudflare.com/api/resources/pages/subresources/projects/ (GET/POST projects, POST .../domains).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const WRANGLER_VERSION = '4.152.0';   // the same pin as factory/runner/publish.mjs (supply-chain rule 1: at least 7 days old)
const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const NAME = opt('--name'), BRANCH = opt('--branch') || 'main', DOMAIN = opt('--domain'), DEPLOY = opt('--deploy');
if (!NAME || !/^[a-z0-9][a-z0-9-]{0,56}$/.test(NAME)) { console.error('usage: --name <project> [--branch main] [--domain host] [--deploy folder]'); process.exit(2); }
if (!/^omnikom-/.test(NAME)) { console.error(`refused: ${NAME} is not one of our own pages (omnikom-*); client sites are made by the publish job`); process.exit(2); }
if (DEPLOY && !existsSync(DEPLOY)) { console.error(`no folder ${DEPLOY}`); process.exit(2); }
const TOKEN = process.env.CLOUDFLARE_PAGES_TOKEN, ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!TOKEN || !ACCOUNT) { console.error('set CLOUDFLARE_PAGES_TOKEN and CLOUDFLARE_ACCOUNT_ID (by name)'); process.exit(2); }
const scrub = s => String(s).split(TOKEN).join('[token]').split(ACCOUNT).join('[account]');
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects`;
const cf = async (method, path, body) => {
  const r = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => null);
  return { status: r.status, ok: r.ok && j?.success !== false, result: j?.result ?? null, errors: (j?.errors || []).map(e => `${e.code} ${e.message}`).join('; ') };
};

let p = await cf('GET', `/${NAME}`);
if (p.status === 404) {
  const c = await cf('POST', '', { name: NAME, production_branch: BRANCH });
  if (!c.ok) { console.error(scrub(`FAIL create ${NAME}: HTTP ${c.status} ${c.errors}`)); process.exit(1); }
  console.log(`created Pages project ${NAME} (production branch ${BRANCH})`);
  p = await cf('GET', `/${NAME}`);
}
if (!p.ok) { console.error(scrub(`FAIL read ${NAME}: HTTP ${p.status} ${p.errors}`)); process.exit(1); }
console.log(`project ${NAME}: ${p.result.subdomain} (production branch ${p.result.production_branch})`);

if (DOMAIN) {
  const d = await cf('GET', `/${NAME}/domains`);
  let dom = (d.result || []).find(x => x.name === DOMAIN);
  if (!dom) {
    const a = await cf('POST', `/${NAME}/domains`, { name: DOMAIN });
    if (!a.ok) { console.error(scrub(`FAIL attach ${DOMAIN}: HTTP ${a.status} ${a.errors}`)); process.exit(1); }
    dom = a.result;
    console.log(`attached ${DOMAIN} to ${NAME}`);
  }
  console.log(`domain ${DOMAIN}: status ${dom.status}${dom.verification_data?.status ? `, verification ${dom.verification_data.status}` : ''}`);
  if (dom.status !== 'active') console.log(`DNS record it needs (the owner's click): CNAME ${DOMAIN} -> ${p.result.subdomain} (proxied)`);
}

if (DEPLOY) {
  const env = { ...process.env, CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT, WRANGLER_SEND_METRICS: 'false', CI: 'true', npm_config_ignore_scripts: 'true' };
  delete env.CLOUDFLARE_PAGES_TOKEN;
  const win = process.platform === 'win32';
  const w = spawnSync(win ? 'npx.cmd' : 'npx', ['--yes', `wrangler@${WRANGLER_VERSION}`, 'pages', 'deploy', DEPLOY, '--project-name', NAME, '--branch', BRANCH, '--commit-dirty=true'],
    { encoding: 'utf8', env, timeout: 420000, shell: win, windowsHide: true });
  const text = scrub(`${w.stdout || ''}${w.stderr || ''}`);
  for (const l of text.trim().split(/\r?\n/).slice(-6)) console.log(`  wrangler: ${l}`);
  const m = new RegExp(`https://[a-z0-9]+\\.${NAME}\\.pages\\.dev`).exec(text);
  if (w.status !== 0 || !m) { console.error(`FAIL deploy (exit ${w.status}${w.error ? `, ${w.error.code}` : ''})`); process.exit(1); }
  console.log(`deployed ${DEPLOY} to ${m[0]} (branch ${BRANCH}; the production address is https://${p.result.subdomain})`);
}
