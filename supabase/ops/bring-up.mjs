// The bring-up (book row E2): makes a Supabase project and its dashboard match what staging proved. It reads first and changes only
// what differs: the extensions, every Auth setting, the function secrets the code reads, the dashboard's Pages project, domain and
// build, and (production only) the production repository's secrets. Migrations and functions are promote.yml's, never this script's.
//   node tools/with-env.mjs "<env file>" -- node supabase/ops/bring-up.mjs --env staging|production [--apply] [--i-mean-production]
// Without --apply it is a dry run (reads only, `would` lines). Production with --apply needs --i-mean-production as well.
// Variables, by name (P = STAGING_ or PROD_, supabase/ops/environments.json): <P>SUPABASE_REF, <P>DB_URL (<P>DB_URL_DIRECT when set),
// <P>SUPABASE_PUBLISHABLE_KEY, SUPABASE_ACCESS_TOKEN, CLOUDFLARE_PAGES_TOKEN, CLOUDFLARE_ACCOUNT_ID, RESEND_API_KEY; the source of every
// function secret (staging: the same name; production: PROD_<NAME>, except the shared RESEND_API_KEY, PSI_API_KEY, CRUX_API_KEY and
// BING_WEBMASTER_KEY and GOOGLE_SERVICE_ACCOUNT_JSON, LEAD_ALERT_FROM from PROD_MAIL_FROM; DASHBOARD_URL and DASHBOARD_ORIGINS come from environments.json); for
// production also PROD_MAIL_FROM, PROD_GITHUB_REPO and the source of every secret the production workflows name (PROD_ALERTS_TO is
// optional). SUPABASE_API_BASE and CLOUDFLARE_API_BASE exist for the tests' local fake server only.
// It prints names, counts and short states, never a value: every line passes backup.mjs's scrubber, fed with every value read.
// Last line: `DRY RUN: <n> would change`, `BRING-UP OK: <n> changed` or `BRING-UP FAILED: <area> <what>: <reason>` (the first failure
// stops the run). Exit 0 ok, 1 failed, 2 usage, 3 BLOCKED (a variable is missing; nothing was read or changed).
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { psqlReadOnly } from './promote-check.mjs';
import { scrubber } from './backup.mjs';
import { authBody } from '../set-auth-settings.mjs';
import { EXPECT } from '../check-auth-settings.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const USAGE = 'usage: bring-up.mjs --env staging|production [--apply] [--i-mean-production]';
const EXTENSIONS = ['pg_cron', 'pg_net', 'pgmq', 'pg_stat_statements'];
const SEAMS = ['JWKS_URL', 'GITHUB_API_BASE'];   // test seams of the functions (dashboard.ts, dispatch.ts), never a secret
const SHARED = ['RESEND_API_KEY', 'PSI_API_KEY', 'CRUX_API_KEY', 'BING_WEBMASTER_KEY', 'GOOGLE_SERVICE_ACCOUNT_JSON'];   // one key for staging and production
const WRANGLER_VERSION = '4.152.0';   // the pin of tools/pages-project.mjs
const sha256hex = s => createHash('sha256').update(s).digest('hex');
class Stop extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (where, why) => { throw new Stop(1, `BRING-UP FAILED: ${where}: ${why}`); };

// every function secret the code reads: Deno.env.get('NAME') and the runner frame's keyEnv names, minus what Supabase gives and the seams
export function secretNames(dir) {
  const found = new Set();
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!(d === dir && e.name === 'test')) walk(p); continue; }
      if (e.name.endsWith('.ts')) for (const m of readFileSync(p, 'utf8').matchAll(/(?:Deno\.env\.get\(|keyEnv(?::|\s*\?\?)\s*)'([A-Z][A-Z0-9_]*)'/g)) found.add(m[1]);
    }
  };
  walk(dir);
  return [...found].filter(n => !/^SUPABASE_/.test(n) && !SEAMS.includes(n)).sort();
}

// the secret names the production repository's workflows read
const repoNames = root => {
  const prod = join(root, '.github', 'production');
  const files = [...readdirSync(prod).filter(f => f.endsWith('.yml')).map(f => join(prod, f)), join(root, '.github', 'workflows', 'publish.yml'), join(root, '.github', 'workflows', 'media.yml')];
  return [...new Set(files.flatMap(f => [...readFileSync(f, 'utf8').matchAll(/\$\{\{\s*secrets\.([A-Z][A-Z0-9_]*)\s*\}\}/g)].map(m => m[1])))].sort();
};

const psqlWrite = (url, sql) => {
  const r = spawnSync('psql', [url, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', timeout: 120000, windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(String(r.stderr || (r.error && r.error.message) || 'psql did not run').trim().split(/\r?\n/)[0]);
  return String(r.stdout || '').trim();
};

// the dashboard build and deploy: npm ci, the build with the project's VITE_ values, the pinned wrangler (token as pages-project.mjs passes it)
const deployDashboard = (root, env) => ({ pages, sha, buildEnv }) => {
  const win = process.platform === 'win32';
  const run = (cmd, args, extra = {}) => {
    const childEnv = { ...process.env, ...extra };
    delete childEnv.CLOUDFLARE_PAGES_TOKEN;
    const r = spawnSync(win ? `${cmd}.cmd` : cmd, args, { cwd: root, env: childEnv, encoding: 'utf8', timeout: 600000, shell: win, windowsHide: true });
    if (r.status !== 0) throw new Error(`${cmd} ${args[0]} exit ${r.status}${r.error ? ` ${r.error.code}` : ''}`);
  };
  run('npm', ['ci', '--prefix', 'apps/dashboard', '--ignore-scripts', '--no-fund']);
  run('npm', ['run', 'build', '--prefix', 'apps/dashboard'], buildEnv);
  run('npx', ['--yes', `wrangler@${WRANGLER_VERSION}`, 'pages', 'deploy', 'apps/dashboard/dist', '--project-name', pages, '--branch', 'main', '--commit-hash', sha, '--commit-dirty=true'],
    { CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_PAGES_TOKEN, CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID, WRANGLER_SEND_METRICS: 'false', CI: 'true', npm_config_ignore_scripts: 'true' });
};

export async function bringUp(argv, env = process.env, deps = {}) {
  const lines = [], seen = [];
  const say = l => lines.push(l);
  const v = name => { const x = env[name] || ''; if (x) seen.push(x); return x; };
  let n = 0, exit = 0;
  try {
    const after = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
    const o = { env: after('--env'), apply: argv.includes('--apply'), mean: argv.includes('--i-mean-production') };
    if (!['staging', 'production'].includes(o.env)) throw new Stop(2, USAGE);
    if (o.env === 'production' && o.apply && !o.mean) throw new Stop(2, 'production needs --i-mean-production');
    const bases = {};
    for (const [name, standard] of [['SUPABASE_API_BASE', 'https://api.supabase.com'], ['CLOUDFLARE_API_BASE', 'https://api.cloudflare.com/client/v4']]) {
      const base = v(name);
      if (!base) { bases[name] = standard; continue; }
      if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Stop(2, `${name} may only name the tests' local fake server`);
      bases[name] = base;
    }

    // R: every needed variable, before any network or database call
    const root = deps.repoRoot || ROOT, prod = o.env === 'production';
    const E = JSON.parse(readFileSync(join(root, 'supabase', 'ops', 'environments.json'), 'utf8'))[o.env], P = E.prefix;
    const fnNames = secretNames(join(root, 'supabase', 'functions'));
    const derived = { DASHBOARD_URL: E.dashboard, DASHBOARD_ORIGINS: E.origins.join(',') };
    const fnSource = name => (!prod || SHARED.includes(name) ? name : name === 'LEAD_ALERT_FROM' ? 'PROD_MAIL_FROM' : `PROD_${name}`);
    const repoList = prod ? repoNames(root) : [];
    const repoSource = name => (/^(PROD|STAGING)_/.test(name) ? name : { RUNNER_KEY: 'PROD_RUNNER_KEY', ALERTS_TO: 'PROD_ALERTS_TO', LEAD_ALERT_FROM: 'PROD_MAIL_FROM' }[name] || name);
    const needed = [`${P}SUPABASE_REF`, `${P}DB_URL`, `${P}SUPABASE_PUBLISHABLE_KEY`, 'SUPABASE_ACCESS_TOKEN', 'CLOUDFLARE_PAGES_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'RESEND_API_KEY',
      ...fnNames.filter(x => !(x in derived)).map(fnSource),
      ...(prod ? ['PROD_MAIL_FROM', 'PROD_GITHUB_REPO', ...repoList.filter(x => x !== 'PLATFORM_FUNCTIONS_BASE' && x !== 'ALERTS_TO').map(repoSource)] : [])];
    const missing = [...new Set(needed)].filter(x => !env[x]);
    if (missing.length) throw new Stop(3, `missing variables (by name): ${missing.join(', ')}`);
    needed.forEach(v);   // every value read feeds the scrubber

    const ref = v(`${P}SUPABASE_REF`), token = v('SUPABASE_ACCESS_TOKEN'), cfToken = v('CLOUDFLARE_PAGES_TOKEN'), acct = v('CLOUDFLARE_ACCOUNT_ID');
    const dbUrl = v(`${P}DB_URL_DIRECT`) || v(`${P}DB_URL`), fnBase = `https://${ref}.supabase.co/functions/v1`;
    const f = deps.fetch || globalThis.fetch, read = deps.sql || psqlReadOnly, write = deps.sql || psqlWrite;
    const gh = deps.gh || ((args, input) => spawnSync('gh', args, { input, encoding: 'utf8', timeout: 60000, windowsHide: true }));
    const deploy = deps.deploy || deployDashboard(root, env);
    const head = deps.head || (() => String(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 30000, windowsHide: true }).stdout || '').trim());
    const guard = async (where, fn) => { try { return await fn(); } catch (e) { if (e instanceof Stop) throw e; return fail(where, (e && e.message) || e); } };
    const call = (where, base, auth, path, method = 'GET', body, allow = []) => guard(where, async () => {
      const r = await f(`${base}${path}`, { method, headers: { authorization: `Bearer ${auth}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      const text = await r.text();
      if (!r.ok && !allow.includes(r.status)) fail(where, r.status);
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: r.status, json, result: json && json.result };
    });
    const sb = (where, path, method, body) => call(where, bases.SUPABASE_API_BASE, token, `/v1/projects/${ref}${path}`, method, body);
    const cf = (where, path, method, body, allow) => call(where, bases.CLOUDFLARE_API_BASE, cfToken, `/accounts/${acct}/pages/projects${path}`, method, body, allow);
    const step = async (area, what, same, act) => { if (same) { say(`same    ${area} ${what}`); return; } n++;
      if (!o.apply) { say(`would   ${area} ${what}`); return; }
      await act(); say(`change  ${area} ${what}`); };

    { // X extensions (the statement of tools/staging-extensions.mjs)
      const have = String(await guard('extensions read', () => read(dbUrl, `select coalesce(string_agg(extname, ','), '') from pg_extension where extname = any(array['${EXTENSIONS.join("','")}'])`))).split(',');
      for (const e of EXTENSIONS) {
        const schema = e === 'pg_cron' || e === 'pgmq' ? '' : ' with schema extensions';
        await step('extensions', e, have.includes(e), () => guard(`extensions ${e}`, () => write(dbUrl, `create extension if not exists ${e}${schema} cascade`)));
      }
    }
    { // A auth: E11's body for this environment's address and sender, and Resend's SMTP
      const emails = JSON.parse(readFileSync(join(root, 'supabase', 'auth-emails', 'emails.json'), 'utf8'));
      const cfg = { ...emails, site_url: E.dashboard, sender: { ...emails.sender, address: prod ? v('PROD_MAIL_FROM') : emails.sender.address } };
      const want = { ...authBody(cfg, EXPECT, file => readFileSync(join(root, 'supabase', 'auth-emails', file), 'utf8')), smtp_host: 'smtp.resend.com', smtp_port: '465', smtp_user: 'resend' };
      const keys = Object.keys(want), equal = (a, b) => String(a) === String(b);
      const got = (await sb('auth read', '/config/auth')).json || {};
      const diff = keys.filter(k => !equal(got[k], want[k]));
      await step('auth', `${diff.length || keys.length} keys`, !diff.length, async () => {
        const body = Object.fromEntries(diff.map(k => [k, want[k]]));
        if (diff.some(k => k.startsWith('smtp_'))) body.smtp_pass = v('RESEND_API_KEY');
        await sb(`auth ${diff.length} keys`, '/config/auth', 'PATCH', body);
        const back = (await sb('auth read back', '/config/auth')).json || {};
        const still = keys.filter(k => !equal(back[k], want[k]));
        if (still.length) fail('auth read back', `${still.join(', ')} still differ`);
      });
    }
    { // S secrets: the list answers each value's sha256; the differing ones go in one POST
      const got = new Map(((await sb('secrets read', '/secrets')).json || []).map(s => [s.name, s.value]));
      const batch = [];
      for (const name of fnNames) {
        const value = name in derived ? derived[name] : v(fnSource(name));
        const same = got.get(name) === sha256hex(value);
        await step('secrets', name, same, async () => { batch.push({ name, value }); });
      }
      if (batch.length) await sb(`secrets ${batch.map(s => s.name).join(', ')}`, '/secrets', 'POST', batch);
    }
    { // G dashboard: the Pages project, its domain, and a build of this commit
      let proj = await cf('dashboard read', `/${E.pages}`, 'GET', undefined, [404]);
      await step('dashboard', `project ${E.pages}`, proj.status !== 404, async () => { proj = await cf(`dashboard project ${E.pages}`, '', 'POST', { name: E.pages, production_branch: 'main' }); });
      if (E.domain) {
        const list = proj.status === 404 ? [] : (await cf('dashboard domains read', `/${E.pages}/domains`)).result || [];
        let dom = list.find(d => d.name === E.domain);
        await step('dashboard', `domain ${E.domain}`, Boolean(dom), async () => { dom = (await cf(`dashboard domain ${E.domain}`, `/${E.pages}/domains`, 'POST', { name: E.domain })).result; });
        if (dom && dom.status !== 'active') say(`DNS record it needs (the owner's click): CNAME ${E.domain} -> ${proj.result.subdomain}`);
      }
      const deployments = proj.status === 404 ? [] : (await cf('dashboard deployments read', `/${E.pages}/deployments?env=production`)).result || [];
      const newest = deployments[0] && deployments[0].deployment_trigger && deployments[0].deployment_trigger.metadata && deployments[0].deployment_trigger.metadata.commit_hash;
      const sha = await guard('dashboard head', () => head());
      const fresh = newest === sha;
      const buildEnv = { VITE_SUPABASE_URL: `https://${ref}.supabase.co`, VITE_SUPABASE_PUBLISHABLE_KEY: v(`${P}SUPABASE_PUBLISHABLE_KEY`), VITE_FUNCTIONS_BASE: fnBase };
      await step('dashboard', `deploy ${sha.slice(0, 12)}`, fresh, () => guard(`dashboard deploy ${sha.slice(0, 12)}`, () => deploy({ pages: E.pages, sha, buildEnv })));
    }
    if (prod) { // H repo: a name the repository lacks is set (value on stdin); a present one is never replaced (GitHub shows no value)
      const repo = v('PROD_GITHUB_REPO');
      const listed = await guard('repo read', () => {
        const r = gh(['secret', 'list', '-R', repo, '--json', 'name']);
        if (r.status !== 0) throw new Error(`gh exit ${r.status}: ${String(r.stderr || '').trim().split(/\r?\n/)[0]}`);
        return JSON.parse(r.stdout);
      });
      const present = new Set(listed.map(s => s.name));
      for (const name of repoList) {
        const value = name === 'PLATFORM_FUNCTIONS_BASE' ? fnBase : v(repoSource(name));
        if (!present.has(name) && !value) { say(`skip    repo ${name} (${repoSource(name)} not set)`); continue; }
        await step('repo', name, present.has(name), () => guard(`repo ${name}`, () => {
          const r = gh(['secret', 'set', name, '-R', repo], value);
          if (r.status !== 0) throw new Error(`gh exit ${r.status}`);
        }));
      }
    }
    say(o.apply ? `BRING-UP OK: ${n} changed` : `DRY RUN: ${n} would change`);
  } catch (e) {
    const s = e instanceof Stop ? e : new Stop(1, `BRING-UP FAILED: bring-up unexpected: ${(e && e.message) || e}`);
    say(s.message);
    exit = s.code;
  }
  return { exit, lines: lines.map(scrubber(seen)) };
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isMain()) {
  const r = await bringUp(process.argv.slice(2));
  for (const l of r.lines) console.log(l);
  process.exit(r.exit);
}
