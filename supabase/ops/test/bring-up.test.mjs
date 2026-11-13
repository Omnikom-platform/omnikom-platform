// Tests for supabase/ops/bring-up.mjs (book row E2) against local fakes. One fake HTTP server on 127.0.0.1 plays the Supabase Management
// API and the Cloudflare Pages API and counts every write; the database (deps.sql), gh (deps.gh), the dashboard deploy (deps.deploy) and
// the commit (deps.head) are recorders, and deps.fetch refuses any address but the fake's. No cluster, no network, no account: every
// value is a test string. Every case passes repoRoot = the real repository root (case 12 a temp copy of the files it reads, see there).
//   node supabase/ops/test/bring-up.test.mjs              the suite (12 checks)
//   node supabase/ops/test/bring-up.test.mjs --mutants    the suite, then every seeded fault (in a copy of the script): each must go red for its named check
// Exit 0 = every check passed (and, with --mutants, every fault was caught).
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, cpSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { authBody } from '../../set-auth-settings.mjs';
import { EXPECT } from '../../check-auth-settings.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const REAL = resolve(HERE, '..', 'bring-up.mjs');
const IMPORTS = [   // the script's relative imports, rewritten to file URLs in a mutant copy that lives in the temp folder
  ["'./promote-check.mjs'", pathToFileURL(resolve(HERE, '..', 'promote-check.mjs')).href],
  ["'./backup.mjs'", pathToFileURL(resolve(HERE, '..', 'backup.mjs')).href],
  ["'../set-auth-settings.mjs'", pathToFileURL(resolve(HERE, '..', '..', 'set-auth-settings.mjs')).href],
  ["'../check-auth-settings.mjs'", pathToFileURL(resolve(HERE, '..', '..', 'check-auth-settings.mjs')).href],
];
let script = REAL;
const work = mkdtempSync(join(tmpdir(), 'omnikom-bringup-test-'));

const USAGE = 'usage: bring-up.mjs --env staging|production [--apply] [--i-mean-production]';
const sha = s => createHash('sha256').update(String(s)).digest('hex');
const val = name => `test-${name.toLowerCase().replace(/_/g, '-')}-not-a-secret`;
const MAIL_FROM = 'mail-from-not-a-secret@example.test';
const HEAD1 = 'c0ffee'.padEnd(40, '1'), HEAD2 = 'beef'.padEnd(40, '2');
const PROD_DASH = 'https://app.omnikom.ai';
// the function secrets the code reads at this commit (case 10 pins the list)
const FN_SECRETS = ['BING_WEBMASTER_KEY', 'CRON_KEY', 'CRUX_API_KEY', 'DASHBOARD_ORIGINS', 'DASHBOARD_URL', 'DB_POOLER_URL', 'GITHUB_DISPATCH_TOKEN',
  'GITHUB_DISPATCH_TOKEN_V2', 'GITHUB_REPO', 'LEAD_ALERT_FROM', 'MAIL_OUTBOX_KEY', 'PSI_API_KEY', 'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET', 'RUNNER_KEY'];
const SHARED = ['RESEND_API_KEY', 'PSI_API_KEY', 'CRUX_API_KEY', 'BING_WEBMASTER_KEY'];
// production: every variable bring-up needs (each must be named when missing); PROD_DB_URL_DIRECT and PROD_ALERTS_TO are optional
const PROD_NEEDED = ['PROD_SUPABASE_REF', 'PROD_DB_URL', 'PROD_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ACCESS_TOKEN', 'CLOUDFLARE_PAGES_TOKEN', 'CLOUDFLARE_ACCOUNT_ID',
  'RESEND_API_KEY', 'BING_WEBMASTER_KEY', 'PROD_CRON_KEY', 'CRUX_API_KEY', 'PROD_DB_POOLER_URL', 'PROD_GITHUB_DISPATCH_TOKEN', 'PROD_GITHUB_DISPATCH_TOKEN_V2',
  'PROD_GITHUB_REPO', 'PROD_MAIL_FROM', 'PROD_MAIL_OUTBOX_KEY', 'PSI_API_KEY', 'PROD_RESEND_WEBHOOK_SECRET', 'PROD_RUNNER_KEY',
  'STAGING_DB_URL', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'BACKUP2_ENDPOINT', 'BACKUP2_ACCESS_KEY_ID', 'BACKUP2_SECRET_ACCESS_KEY', 'BACKUP2_BUCKET'];
const STAGING_NEEDED = ['STAGING_SUPABASE_REF', 'STAGING_DB_URL', 'STAGING_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ACCESS_TOKEN', 'CLOUDFLARE_PAGES_TOKEN', 'CLOUDFLARE_ACCOUNT_ID',
  ...FN_SECRETS.filter(n => !n.startsWith('DASHBOARD_'))];
// production: where each function secret's value comes from (the head's ruling in the brief)
const prodSecret = (name, env) => (name === 'DASHBOARD_URL' || name === 'DASHBOARD_ORIGINS' ? PROD_DASH
  : name === 'LEAD_ALERT_FROM' ? env.PROD_MAIL_FROM : SHARED.includes(name) ? env[name] : env[`PROD_${name}`]);
// the production repository's secret names: the brief's pattern over the files it names (anchors are checked in case 5)
const repoNames = root => [...new Set([...readdirSync(join(root, '.github', 'production')).filter(f => f.endsWith('.yml')).map(f => join(root, '.github', 'production', f)),
  join(root, '.github', 'workflows', 'publish.yml'), join(root, '.github', 'workflows', 'media.yml')]
  .flatMap(f => [...readFileSync(f, 'utf8').matchAll(/\$\{\{\s*secrets\.([A-Z][A-Z0-9_]*)\s*\}\}/g)].map(m => m[1])))].sort();
const repoSecret = (name, env) => (name === 'PLATFORM_FUNCTIONS_BASE' ? `https://${env.PROD_SUPABASE_REF}.supabase.co/functions/v1`
  : name === 'RUNNER_KEY' ? env.PROD_RUNNER_KEY : name === 'ALERTS_TO' ? env.PROD_ALERTS_TO : name === 'LEAD_ALERT_FROM' ? env.PROD_MAIL_FROM : env[name]);

// ------------------------------------------------------------------------------------------------ one world: the fakes and recorders
async function world(kind) {
  const st = { auth: {}, secrets: new Map(), project: null, domains: [], deployments: [], writes: 0, requests: [], patchStatus: 200, dropKey: null };
  const rec = { fetch: [], sql: [], gh: [], deploys: [], exts: new Set(), ghSet: new Set(), head: HEAD1 };
  const w = { kind, st, rec };
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://fake'), p = u.pathname, m = req.method, auth = req.headers.authorization;
      st.requests.push(`${m} ${p}`);
      const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const body = raw ? JSON.parse(raw) : null;
      if (p.startsWith('/v1/')) {   // the Management API: the right token, the right project, or nothing
        if (auth !== `Bearer ${w.env.SUPABASE_ACCESS_TOKEN}`) return send(401, { message: 'bad token' });
        const pre = `/v1/projects/${w.ref}`;
        if (p === `${pre}/config/auth` && m === 'GET') return send(200, st.auth);
        if (p === `${pre}/config/auth` && m === 'PATCH') {
          st.writes++;
          if (st.patchStatus !== 200) return send(st.patchStatus, { message: 'fake failure' });
          Object.assign(st.auth, body);
          if (st.dropKey) delete st.auth[st.dropKey];
          return send(200, st.auth);
        }
        if (p === `${pre}/secrets` && m === 'GET') return send(200, [...st.secrets].map(([name, value]) => ({ name, value })));
        if (p === `${pre}/secrets` && m === 'POST') { st.writes++; for (const s of body) st.secrets.set(s.name, sha(s.value)); return send(201, {}); }
        return send(404, { message: 'not found' });
      }
      // the Pages API: the right token, the right account, or nothing
      if (auth !== `Bearer ${w.env.CLOUDFLARE_PAGES_TOKEN}`) return send(403, { success: false, errors: [{ code: 10000, message: 'bad token' }] });
      const ok = result => send(200, { success: true, errors: [], result });
      const pre = `/accounts/${w.acct}/pages/projects`, proj = st.project && `${pre}/${st.project.name}`;
      if (p === pre && m === 'POST') { st.writes++; st.project = { name: body.name, production_branch: body.production_branch, subdomain: `${body.name}.pages.dev` }; return ok(st.project); }
      if (proj && p === proj && m === 'GET') return ok(st.project);
      if (proj && p === `${proj}/domains` && m === 'GET') return ok(st.domains);
      if (proj && p === `${proj}/domains` && m === 'POST') { st.writes++; const d = { name: body.name, status: 'pending' }; st.domains.push(d); return ok(d); }
      if (proj && p === `${proj}/deployments` && m === 'GET' && u.searchParams.get('env') === 'production') return ok(st.deployments);
      return send(404, { success: false, errors: [{ code: 8000007, message: 'not found' }], result: null });
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  w.base = `http://127.0.0.1:${server.address().port}`;
  w.close = () => new Promise(r => { server.closeAllConnections(); server.close(() => r()); });
  const names = kind === 'production' ? [...PROD_NEEDED, 'PROD_DB_URL_DIRECT', 'PROD_ALERTS_TO'] : STAGING_NEEDED;
  w.env = { ...Object.fromEntries(names.map(n => [n, val(n)])), ...(kind === 'production' ? { PROD_MAIL_FROM: MAIL_FROM } : {}), SUPABASE_API_BASE: w.base, CLOUDFLARE_API_BASE: w.base };
  w.ref = w.env[kind === 'production' ? 'PROD_SUPABASE_REF' : 'STAGING_SUPABASE_REF'];
  w.acct = w.env.CLOUDFLARE_ACCOUNT_ID;
  w.deps = repoRoot => ({
    repoRoot,
    fetch: async (url, init = {}) => {
      rec.fetch.push(`${init.method || 'GET'} ${url}`);
      if (!String(url).startsWith(`${w.base}/`)) throw new Error('the test refused a request that leaves this machine');
      return fetch(url, { signal: AbortSignal.timeout(10000), ...init });
    },
    sql: (url, text) => {
      rec.sql.push({ url, text });
      const c = /^create extension if not exists ([a-z_]+)/.exec(text);
      if (c) { rec.exts.add(c[1]); return ''; }
      if (/from pg_extension/.test(text)) return [...rec.exts].join(',');
      throw new Error('the fake database knows no such statement');
    },
    gh: (args, input) => {
      rec.gh.push({ args, input });
      if (args[0] === 'secret' && args[1] === 'list') return { status: 0, stdout: JSON.stringify([...rec.ghSet].map(name => ({ name }))), stderr: '' };
      if (args[0] === 'secret' && args[1] === 'set') { rec.ghSet.add(args[2]); return { status: 0, stdout: '', stderr: '' }; }
      return { status: 1, stdout: '', stderr: 'the fake gh knows no such command' };
    },
    deploy: async ({ pages, sha: commit, buildEnv }) => {
      rec.deploys.push({ pages, sha: commit, buildEnv });
      st.deployments.unshift({ id: `dep-${rec.deploys.length}`, deployment_trigger: { metadata: { commit_hash: commit } } });
    },
    head: () => rec.head,
  });
  return w;
}
const creates = w => w.rec.sql.filter(s => s.text.startsWith('create extension')).length;
const ghSets = w => w.rec.gh.filter(g => g.args[1] === 'set');
const writes = w => w.st.writes + creates(w) + ghSets(w).length + w.rec.deploys.length;
const untouched = w => w.rec.fetch.length === 0 && w.st.requests.length === 0 && w.rec.sql.length === 0 && w.rec.gh.length === 0 && w.rec.deploys.length === 0;
const show = r => (r ? `exit ${r.exit}\n${r.lines.join('\n')}` : 'no run');

async function run(w, argv, env = w.env, repoRoot = ROOT) {
  const mod = await import(`${pathToFileURL(script).href}?x=${Math.random()}`);
  const r = await mod.bringUp(argv, env, w.deps(repoRoot));
  return { ...r, text: r.lines.join('\n'), last: r.lines[r.lines.length - 1] };
}

// ------------------------------------------------------------------------------------------------------------------ the cases
async function suite() {
  const results = [], outs = [], worlds = [];
  const t = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: ok ? '' : String(detail).slice(0, 1500) });
  const check = async (name, fn) => { try { const [ok, detail] = await fn(); t(name, ok, detail); } catch (e) { t(name, false, `threw: ${String((e && e.stack) || e).slice(0, 600)}`); } };
  const make = async kind => { const w = await world(kind); worlds.push(w); return w; };
  const prodArgs = ['--env', 'production', '--apply', '--i-mean-production'];
  try {
    await check('1 usage: no --env, --env dev, production --apply without --i-mean-production: exit 2 with its text; no fake touched', async () => {
      const w = await make('production');
      const a = await run(w, []), b = await run(w, ['--env', 'dev']), c = await run(w, ['--env', 'production', '--apply']);
      return [a.exit === 2 && a.text === USAGE && b.exit === 2 && b.text === USAGE && c.exit === 2 && c.text === 'production needs --i-mean-production' && untouched(w),
        [a, b, c].map(show).join('\n--\n')];
    });

    await check('2 production with no variable set: exit 3, one line naming every missing variable; no request, no sql, no gh', async () => {
      const w = await make('production');
      const r = await run(w, ['--env', 'production'], {});
      const m = r.lines.length === 1 ? /^missing variables \(by name\): (.+)$/.exec(r.lines[0]) : null;
      const list = m ? m[1].split(', ') : [];
      return [r.exit === 3 && m && PROD_NEEDED.every(n => list.includes(n)) && !list.includes('PROD_ALERTS_TO') && !list.includes('PROD_DB_URL_DIRECT') && untouched(w),
        `${show(r)}\nnot named: ${PROD_NEEDED.filter(n => !list.includes(n)).join(', ')}`];
    });

    await check('3 SUPABASE_API_BASE (or CLOUDFLARE_API_BASE) not 127.0.0.1: exit 2; no request', async () => {
      const w = await make('production');
      const a = await run(w, ['--env', 'production'], { ...w.env, SUPABASE_API_BASE: 'https://example.test' });
      const b = await run(w, ['--env', 'production'], { ...w.env, CLOUDFLARE_API_BASE: 'https://example.test' });
      return [a.exit === 2 && /^SUPABASE_API_BASE /.test(a.last) && b.exit === 2 && /^CLOUDFLARE_API_BASE /.test(b.last) && untouched(w), [a, b].map(show).join('\n--\n')];
    });

    const P = await make('production');   // cases 4 to 7 share one production world: empty, then applied, then applied again
    let r4, r5, r6, r7;
    await check('4 dry run on an empty production: exit 0, a would line per extension, auth, secret, project, domain, deploy and repo name; no write; DRY RUN: n', async () => {
      r4 = await run(P, ['--env', 'production']);
      outs.push(r4.text);
      const would = r4.lines.filter(l => l.startsWith('would   '));
      const by = area => would.filter(l => l.startsWith(`would   ${area} `)).length;
      const repo = repoNames(ROOT);
      return [r4.exit === 0 && by('extensions') === 4 && by('auth') === 1 && by('secrets') === FN_SECRETS.length && FN_SECRETS.every(n => would.includes(`would   secrets ${n}`))
        && by('dashboard') === 3 && would.includes('would   dashboard project omnikom-app') && would.includes('would   dashboard domain app.omnikom.ai')
        && would.includes(`would   dashboard deploy ${HEAD1.slice(0, 12)}`) && by('repo') === repo.length && repo.every(n => would.includes(`would   repo ${n}`))
        && !r4.lines.some(l => /^(same|change) /.test(l)) && r4.last === `DRY RUN: ${would.length} would change` && writes(P) === 0, `${show(r4)}\nwrites ${writes(P)}`];
    });

    await check('5 apply on it: Auth, secrets, extensions, project, domain, deploy and repository secrets as wanted; BRING-UP OK: n changed', async () => {
      r5 = await run(P, prodArgs);
      outs.push(r5.text);
      const env = P.env, a = P.st.auth, bad = [];
      const emails = JSON.parse(readFileSync(join(ROOT, 'supabase', 'auth-emails', 'emails.json'), 'utf8'));
      const want = { ...authBody({ ...emails, site_url: PROD_DASH, sender: { ...emails.sender, address: MAIL_FROM } }, EXPECT, f => readFileSync(join(ROOT, 'supabase', 'auth-emails', f), 'utf8')),
        smtp_host: 'smtp.resend.com', smtp_port: '465', smtp_user: 'resend' };
      for (const [k, v] of Object.entries(want)) if (String(a[k]) !== String(v)) bad.push(`auth ${k}`);
      if (a.site_url !== PROD_DASH || a.uri_allow_list !== `${PROD_DASH}/**` || a.smtp_admin_email !== MAIL_FROM || a.smtp_pass !== env.RESEND_API_KEY) bad.push('auth site_url, allow list, sender or smtp_pass');
      if (new Set(Object.values(env)).size !== Object.keys(env).length - 1) bad.push('test values not distinct');   // the two bases are the same fake
      for (const n of FN_SECRETS) if (P.st.secrets.get(n) !== sha(prodSecret(n, env))) bad.push(`secret ${n}`);
      if (P.st.secrets.size !== FN_SECRETS.length) bad.push(`secrets: ${P.st.secrets.size}`);
      if (P.st.secrets.get('PSI_API_KEY') !== sha(env.PSI_API_KEY) || P.st.secrets.get('RESEND_WEBHOOK_SECRET') !== sha(env.PROD_RESEND_WEBHOOK_SECRET)
        || P.st.secrets.get('DASHBOARD_ORIGINS') !== sha(PROD_DASH) || P.st.secrets.get('GITHUB_REPO') !== sha(env.PROD_GITHUB_REPO)) bad.push('secret sources');
      const made = P.rec.sql.filter(s => s.text.startsWith('create extension')).map(s => s.text).sort().join(' | ');
      if (made !== 'create extension if not exists pg_cron cascade | create extension if not exists pg_net with schema extensions cascade | create extension if not exists pg_stat_statements with schema extensions cascade | create extension if not exists pgmq cascade') bad.push(`extensions: ${made}`);
      if (!P.rec.sql.every(s => s.url === env.PROD_DB_URL_DIRECT)) bad.push('sql not on PROD_DB_URL_DIRECT');
      if (!P.st.project || P.st.project.name !== 'omnikom-app' || P.st.project.production_branch !== 'main' || P.st.domains.map(d => d.name).join() !== 'app.omnikom.ai') bad.push('project or domain');
      if (!r5.lines.includes("DNS record it needs (the owner's click): CNAME app.omnikom.ai -> omnikom-app.pages.dev")) bad.push('DNS line');
      const d = P.rec.deploys;
      if (d.length !== 1 || d[0].pages !== 'omnikom-app' || d[0].sha !== HEAD1 || JSON.stringify(d[0].buildEnv) !== JSON.stringify({
        VITE_SUPABASE_URL: `https://${env.PROD_SUPABASE_REF}.supabase.co`, VITE_SUPABASE_PUBLISHABLE_KEY: env.PROD_SUPABASE_PUBLISHABLE_KEY,
        VITE_FUNCTIONS_BASE: `https://${env.PROD_SUPABASE_REF}.supabase.co/functions/v1` })) bad.push(`deploy ${JSON.stringify(d.map(x => x.sha))}`);
      const repo = repoNames(ROOT), sets = ghSets(P);
      if (!['PLATFORM_FUNCTIONS_BASE', 'PROD_DB_URL', 'RUNNER_KEY', 'STAGING_DB_URL', 'R2_BUCKET'].every(n => repo.includes(n))) bad.push('repo anchors');
      if (sets.map(g => g.args[2]).sort().join() !== repo.join()) bad.push(`gh set: ${sets.map(g => g.args[2]).join()}`);
      for (const g of sets) {
        if (g.input !== repoSecret(g.args[2], env) || g.args.includes(g.input) || g.args.join(' ') !== `secret set ${g.args[2]} -R ${env.PROD_GITHUB_REPO}`) bad.push(`gh set ${g.args[2]}`);
      }
      const changed = r5.lines.filter(l => l.startsWith('change  ')).length;
      if (r5.exit !== 0 || r5.last !== `BRING-UP OK: ${changed} changed` || changed !== 4 + 1 + FN_SECRETS.length + 3 + repo.length) bad.push('exit or last line');
      return [!bad.length, `${bad.join('; ')}\n${show(r5)}`];
    });

    let before;
    await check('6 the same apply again: BRING-UP OK: 0 changed; the write counters unchanged', async () => {
      before = writes(P);
      r6 = await run(P, prodArgs);
      outs.push(r6.text);
      return [r6.exit === 0 && r6.last === 'BRING-UP OK: 0 changed' && writes(P) === before && !r6.lines.some(l => /^(would|change) /.test(l)), `${show(r6)}\nwrites ${before} -> ${writes(P)}`];
    });

    await check('7 one secret source changed and a new head: exactly 2 changed, that secret and the deploy', async () => {
      const env = { ...P.env, PROD_CRON_KEY: `${P.env.PROD_CRON_KEY}-changed` };
      P.rec.head = HEAD2;
      const n0 = P.rec.deploys.length;
      r7 = await run(P, prodArgs, env);
      outs.push(r7.text);
      const changed = r7.lines.filter(l => l.startsWith('change  '));
      return [r7.exit === 0 && r7.last === 'BRING-UP OK: 2 changed' && changed.join('|') === `change  secrets CRON_KEY|change  dashboard deploy ${HEAD2.slice(0, 12)}`
        && P.st.secrets.get('CRON_KEY') === sha(env.PROD_CRON_KEY) && P.rec.deploys.length === n0 + 1 && P.rec.deploys[n0].sha === HEAD2, show(r7)];
    });

    await check('8 staging: plain sources, DASHBOARD_ORIGINS the three origins, no domain step, no repo area; site_url = emails.json = environments.json', async () => {
      const w = await make('staging');
      const r = await run(w, ['--env', 'staging', '--apply']);
      outs.push(r.text);
      const emails = JSON.parse(readFileSync(join(ROOT, 'supabase', 'auth-emails', 'emails.json'), 'utf8'));
      const envs = JSON.parse(readFileSync(join(ROOT, 'supabase', 'ops', 'environments.json'), 'utf8'));
      const origins = 'http://localhost:5173,http://localhost:4173,https://omnikom-app-staging.pages.dev';
      const bad = [];
      if (w.st.secrets.get('DASHBOARD_ORIGINS') !== sha(origins)) bad.push('DASHBOARD_ORIGINS');
      for (const n of FN_SECRETS.filter(x => !x.startsWith('DASHBOARD_'))) if (w.st.secrets.get(n) !== sha(w.env[n])) bad.push(`secret ${n}`);
      if (r.lines.some(l => / domain |^DNS /.test(l)) || r.lines.some(l => /^\S+ +repo /.test(l)) || w.rec.gh.length) bad.push('a domain step or the repo area');
      if (!(w.st.auth.site_url === emails.site_url && emails.site_url === envs.staging.dashboard && envs.staging.dashboard === 'https://omnikom-app-staging.pages.dev')) bad.push('site_url agreement');
      if (w.st.auth.smtp_admin_email !== emails.sender.address) bad.push('staging sender');
      if (!w.rec.sql.length || !w.rec.sql.every(s => s.url === w.env.STAGING_DB_URL)) bad.push('sql not on STAGING_DB_URL');
      if (!w.st.project || w.st.project.name !== 'omnikom-app-staging' || w.rec.deploys.length !== 1) bad.push('project or deploy');
      if (r.exit !== 0 || !/^BRING-UP OK: \d+ changed$/.test(r.last)) bad.push('exit or last line');
      return [!bad.length, `${bad.join('; ')}\n${show(r)}`];
    });

    await check('9 the fake answers 500 to the PATCH: exit 1, BRING-UP FAILED: auth ...: 500; no later area ran (and a key not kept is FAILED)', async () => {
      const w = await make('production');
      w.st.patchStatus = 500;
      const r = await run(w, prodArgs);
      outs.push(r.text);
      const after = w.st.requests.slice(w.st.requests.findIndex(q => q.startsWith('PATCH ')) + 1);
      const v = await make('production');
      v.st.dropKey = 'site_url';
      const k = await run(v, prodArgs);
      outs.push(k.text);
      return [r.exit === 1 && /^BRING-UP FAILED: auth \d+ keys: 500$/.test(r.last) && w.st.requests.some(q => q.startsWith('PATCH ')) && after.length === 0
        && w.rec.gh.length === 0 && w.rec.deploys.length === 0
        && k.exit === 1 && k.last === 'BRING-UP FAILED: auth read back: site_url still differ' && !v.st.requests.some(q => /secrets|accounts/.test(q)), `${show(r)}\nafter the PATCH: ${after.join(', ')}\n--\n${show(k)}`];
    });

    await check('10 secretNames: a temp folder gives exactly NEW_ONE; the real supabase/functions gives the 15 names, no SUPABASE_ name', async () => {
      const mod = await import(`${pathToFileURL(script).href}?x=${Math.random()}`);
      const dir = join(work, `fns-${Math.random().toString(36).slice(2)}`);
      for (const [f, text] of [['a/index.ts', "Deno.env.get('NEW_ONE');"], ['_shared/x.ts', "Deno.env.get('SUPABASE_URL'); Deno.env.get('JWKS_URL');"], ['test/t.ts', "Deno.env.get('IN_TEST');"]]) {
        mkdirSync(dirname(join(dir, f)), { recursive: true });
        writeFileSync(join(dir, f), text);
      }
      const temp = mod.secretNames(dir), real = mod.secretNames(join(ROOT, 'supabase', 'functions'));
      return [JSON.stringify(temp) === '["NEW_ONE"]' && JSON.stringify(real) === JSON.stringify(FN_SECRETS) && !real.some(n => n.startsWith('SUPABASE_')), `temp ${JSON.stringify(temp)}\nreal ${JSON.stringify(real)}`];
    });

    await check('11 the output of cases 4 to 9 holds none of the values set (tokens, keys, URLs, refs, secret values)', async () => {
      const text = outs.join('\n');
      const values = [...new Set([...worlds.flatMap(w => Object.values(w.env)), `${P.env.PROD_CRON_KEY}-changed`])];
      const leaked = values.filter(x => text.includes(x));
      return [outs.length === 7 && leaked.length === 0, `${outs.length} outputs (7 expected); leaked: ${leaked.join(' | ')}`];
    });

    await check('12 PROD_ALERTS_TO unset, everything else set: the skip line, exit 0', async () => {
      const root = join(work, `root-${Math.random().toString(36).slice(2)}`);   // the real files bring-up reads, plus one workflow naming ALERTS_TO
      cpSync(join(ROOT, 'supabase', 'functions'), join(root, 'supabase', 'functions'), { recursive: true, filter: s => statSync(s).isDirectory() || s.endsWith('.ts') });
      cpSync(join(ROOT, 'supabase', 'auth-emails'), join(root, 'supabase', 'auth-emails'), { recursive: true });
      cpSync(join(ROOT, 'supabase', 'ops', 'environments.json'), join(root, 'supabase', 'ops', 'environments.json'));
      cpSync(join(ROOT, '.github', 'production'), join(root, '.github', 'production'), { recursive: true });
      for (const f of ['publish.yml', 'media.yml']) cpSync(join(ROOT, '.github', 'workflows', f), join(root, '.github', 'workflows', f));
      writeFileSync(join(root, '.github', 'production', 'case-12.yml'), 'env:\n  ALERTS_TO: ${{ secrets.ALERTS_TO }}\n');
      const w = await make('production');
      const env = { ...w.env };
      delete env.PROD_ALERTS_TO;
      const r = await run(w, prodArgs, env, root);
      return [r.exit === 0 && r.lines.includes('skip    repo ALERTS_TO (PROD_ALERTS_TO not set)') && /^BRING-UP OK: \d+ changed$/.test(r.last) && !ghSets(w).some(g => g.args[2] === 'ALERTS_TO'), show(r)];
    });
  } finally {
    for (const w of worlds) await w.close();
  }
  return results;
}

// --------------------------------------------------------------------------------------- the seeded faults (each find once in the script)
const MUTANTS = [
  ['1 a dry run writes', [['if (!o.apply) { say(`would   ${area} ${what}`); return; }', '']], /^4 /],
  ['2 production applies without --i-mean-production', [["if (o.env === 'production' && o.apply && !o.mean) throw new Stop(2, 'production needs --i-mean-production');", '']], /^1 /],
  ['3 a secret is never the same', [['same = got.get(name) === sha256hex(value)', 'same = false']], /^6 /],
  ['4 the deploy is never fresh', [['const fresh = newest === sha;', 'const fresh = false;']], /^6 /],
  ['5 every Auth key differs', [['const diff = keys.filter(k => !equal(got[k], want[k]));', 'const diff = keys;']], /^6 /],
  ['6 a missing variable is not BLOCKED', [['if (missing.length) throw new Stop(3,', 'if (false) throw new Stop(3,']], /^2 /],
  ['7 any API base is taken', [[String.raw`if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Stop(2,`, 'if (false) throw new Stop(2,']], /^3 /],
  ['8 SUPABASE_ names and the test seams are kept', [['.filter(n => !/^SUPABASE_/.test(n) && !SEAMS.includes(n))', '.filter(n => true)']], /^10 /],
];

let exit = 0;
try {
  const base = await suite();
  for (const r of base) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : '\n     ' + r.detail.replace(/\n/g, '\n     ')}`);
  const failed = base.filter(r => !r.ok).length;
  console.log(failed ? `\nBRING-UP TESTS FAILED: ${failed} of ${base.length}` : `\nBRING-UP TESTS OK: ${base.length} checks`);
  if (failed) exit = 1;

  if (process.argv.includes('--mutants') && !exit) {
    const source = readFileSync(REAL, 'utf8');
    let caught = 0, n = 0;
    for (const [name, pairs, expectRed] of MUTANTS) {
      let text = source, applied = true;
      for (const [from, to] of pairs) {
        if (text.split(from).length !== 2) { console.log(`MISSED  ${name}: the patch did not apply (target text found ${text.split(from).length - 1} times, not once: ${from.slice(0, 50)})`); applied = false; break; }
        text = text.split(from).join(to);
      }
      if (applied) for (const [quoted, url] of IMPORTS) {
        if (!text.includes(quoted)) { console.log(`MISSED  ${name}: the import ${quoted} was not found to rewrite`); applied = false; break; }
        text = text.split(quoted).join(`'${url}'`);
      }
      if (!applied) { exit = 1; continue; }
      const copy = join(work, `mutant-${n++}.mjs`);
      writeFileSync(copy, text);
      script = copy;
      let res;
      try { res = await suite(); } finally { script = REAL; }
      const red = res.filter(r => !r.ok);
      const nums = red.map(r => r.name.split(' ')[0]);
      if (red.some(r => expectRed.test(r.name))) { caught++; console.log(`caught  ${name}  [first FAIL: check ${nums[0]}; all red: ${nums.join(',')}]`); }
      else { exit = 1; console.log(`MISSED  ${name}  (${red.length ? 'red, but not the named check: ' + red[0].name : 'still green'})`); }
    }
    console.log(exit ? `\nMUTANTS: not all caught (${caught} of ${MUTANTS.length})` : `\nMUTANTS OK: ${caught} of ${MUTANTS.length} caught, each red for the named reason`);
  }
} catch (e) {
  console.error(`test run crashed: ${(e && e.stack) || e}`);
  exit = 2;
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(exit);
