// The provisioning script for the session report's live part on omnikom.io (PARK A1 point 2a): factory/advisor/ops/provision.mjs.
// A fake Cloudflare API in memory: the dry run only reads, the salt is generated and never printed nor rotated, the token and the
// account ids never reach the output, a PATCH that drops a name is caught by the check after it, the domain is matched exactly.
// Run: node factory/advisor/test/test-provision.mjs  -> "PROVISION TEST PASS: n of n" then "MUTANTS PASS: n of n caught"
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main, checker } from '../../../skills/programmatic-enterprise-web-performance/scripts/lib-test-kit.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const load = async (dir, f) => { try { return await import(pathToFileURL(path.join(dir, f)).href + '?' + Date.now()); } catch (e) { return { __err: String(e.message).split('\n')[0] }; } };

const TOKEN = 'x'.repeat(24), ACCT = '9f2e4c1a7b3d5e6f8a0b1c2d3e4f5a6b', OTHER_ACCT = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d';
const API = 'https://api.cloudflare.com/client/v4';

// state: { projects: [{ name, domains, kv, vars, more (production's other keys), preview }], namespaces: [{ id, title }] }; opts: replace (PATCH drops names),
// dropRest (PATCH drops production's other binding kinds and the preview environment), fail (HTTP 403 echoing the token), noDomains (list without domains)
function fakeCF(state, opts = {}) {
  const calls = [];
  const ok = (result, info) => new Response(JSON.stringify({ success: true, errors: [], result, ...(info ? { result_info: info } : {}) }), { status: 200 });
  const page = (list, u, per) => { const p = Number(u.searchParams.get('page') || 1), n = Number(u.searchParams.get('per_page') || per);
    return ok(list.slice((p - 1) * n, p * n), { page: p, per_page: n, count: Math.min(n, Math.max(0, list.length - (p - 1) * n)), total_count: list.length }); };
  const show = (p) => ({ name: p.name, ...(opts.noDomains ? {} : { domains: p.domains }), subdomain: p.name + '.pages.dev',
    deployment_configs: { preview: structuredClone(p.preview || {}), production: { ...(p.hash ? { wrangler_config_hash: p.hash } : {}), ...structuredClone(p.more || {}), kv_namespaces: structuredClone(p.kv), env_vars: Object.fromEntries(Object.entries(p.vars).map(([k, v]) => [k, { type: v.type, value: v.type === 'secret_text' ? '' : v.value }])) } } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path: u.pathname.replace('/client/v4', ''), body, auth: init.headers?.authorization, signal: init.signal });
    const parts = u.pathname.replace('/client/v4/', '').split('/');
    if (parts[0] === 'accounts' && parts.length === 1) return page([{ id: ACCT, name: 'Work' }], u, 50);
    if (opts.fail) return new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'Authentication error for ' + TOKEN + ' on ' + ACCT }] }), { status: 403 });
    const acct = parts[1];
    if (acct !== ACCT) return new Response(JSON.stringify({ success: false, errors: [{ code: 7003, message: 'no route' }] }), { status: 404 });
    if (parts[2] === 'pages' && parts.length === 4) return page(state.projects.map(show), u, 10);
    if (parts[2] === 'pages') {
      const p = state.projects.find((x) => x.name === parts[4]);
      if (!p) return new Response(JSON.stringify({ success: false, errors: [{ code: 8000007, message: 'Project not found' }] }), { status: 404 });
      if (parts[5] === 'domains') return ok(p.domains.map((name) => ({ name, status: 'active' })));
      if (method === 'PATCH') {
        const prod = body?.deployment_configs?.production || {};
        if (opts.replace) { if (prod.kv_namespaces) p.kv = {}; if (prod.env_vars) p.vars = {}; }
        if (opts.dropRest) { p.more = {}; p.preview = {}; }
        Object.assign(p.kv, prod.kv_namespaces || {});
        for (const [k, v] of Object.entries(prod.env_vars || {})) { if (v === null) delete p.vars[k]; else p.vars[k] = v; }
      }
      return ok(show(p));
    }
    if (parts[2] === 'storage' && method === 'POST') { const n = { id: 'ns' + (state.namespaces.length + 1).toString().padStart(30, '0'), title: body.title }; state.namespaces.push(n); return ok(n); }
    if (parts[2] === 'storage') return page(state.namespaces, u, 20);
    return new Response('{}', { status: 404 });
  };
  return { calls, fetch, state };
}
const site = (over = {}) => ({ name: 'omnikom-io', domains: ['omnikom-io.pages.dev', 'omnikom.io', 'www.omnikom.io'],
  kv: { LEAD_LIMITS: { namespace_id: 'ns-lead' } }, vars: { TURNSTILE_SECRET: { type: 'secret_text', value: 'ts-value' }, SITE_NAME: { type: 'plain_text', value: 'Omnikom' } }, ...over });
const others = (n) => Array.from({ length: n }, (_, i) => ({ name: 'other-' + i, domains: ['other-' + i + '.pages.dev'], kv: {}, vars: {} }));

const scenarios = async (dir) => {
  const results = [], check = checker(results);
  const mod = await load(dir, 'provision.mjs');
  const run = typeof mod.run === 'function' ? mod.run : async () => { throw new Error('no export run' + (mod.__err ? ' (' + mod.__err + ')' : '')); };
  const go = async (argv, cf, { env = { CLOUDFLARE_ADMIN_TOKEN: TOKEN }, salt } = {}) => {
    const lines = []; let code;
    try { code = await run({ argv, env, fetch: cf.fetch, log: (s) => lines.push(String(s)), ...(salt ? { salt } : {}) }); } catch (e) { code = 'threw: ' + e.message; }
    return { code, out: lines.join('\n'), writes: cf.calls.filter((c) => c.method !== 'GET') };
  };
  const clean = (out, extra = []) => ![TOKEN, ACCT, ...extra].some((s) => out.includes(s));
  let cf, r;

  // usage and keys
  cf = fakeCF({ projects: [site()], namespaces: [] }); r = await go(['--bogus'], cf);
  check('usage: an unknown flag = exit 2, no call', r.code === 2 && cf.calls.length === 0, r.code);
  cf = fakeCF({ projects: [site()], namespaces: [] }); r = await go(['--apply', '--dry-run'], cf);
  check('usage: --apply with --dry-run = exit 2, no call', r.code === 2 && cf.calls.length === 0, r.code);
  cf = fakeCF({ projects: [site()], namespaces: [] }); r = await go(['--dry-run'], cf, { env: {} });
  check('keys: no CLOUDFLARE_ADMIN_TOKEN = exit 2, no call', r.code === 2 && cf.calls.length === 0 && /CLOUDFLARE_ADMIN_TOKEN/.test(r.out), r.code + ' ' + r.out);

  // the token is read from the name given by --token-env (the account that holds omnikom.io is not the admin token's)
  cf = fakeCF({ projects: [site()], namespaces: [] }); r = await go(['--token-env', 'CLOUDFLARE_API_TOKEN'], cf, { env: { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ADMIN_TOKEN: 'tok-admin-other' } });
  check('--token-env CLOUDFLARE_API_TOKEN: that token is used, exit 0', r.code === 0 && cf.calls.length > 0 && cf.calls.every((c) => c.auth === 'Bearer ' + TOKEN), r.code + ' ' + (cf.calls[0]?.auth || '').slice(0, 12));
  cf = fakeCF({ projects: [site()], namespaces: [] }); r = await go(['--token-env', 'CLOUDFLARE_API_TOKEN'], cf);
  check('--token-env names an unset variable = exit 2 naming it, no call', r.code === 2 && cf.calls.length === 0 && /CLOUDFLARE_API_TOKEN/.test(r.out), r.code + ' ' + r.out);
  cf = fakeCF({ projects: [site()], namespaces: [] }); r = await go(['--token-env', 'PATH'], cf, { env: { PATH: TOKEN } });
  check('--token-env a name that is not a Cloudflare token = exit 2, no call', r.code === 2 && cf.calls.length === 0, r.code);

  // the dry run on a project with nothing done yet
  let salted = 0;
  cf = fakeCF({ projects: [...others(3), site()], namespaces: [{ id: 'ns-lead', title: 'LEAD_LIMITS' }] });
  r = await go(['--dry-run'], cf, { salt: () => { salted++; return 'f'.repeat(64); } });
  check('dry run: exit 0', r.code === 0, r.code + '\n' + r.out);
  check('dry run: GET only, nothing written', r.writes.length === 0 && cf.calls.length > 0, r.writes.map((c) => c.method + ' ' + c.path).join(', '));
  check('dry run: no salt generated', salted === 0, salted);
  check('dry run: says YES and names the project', /YES/.test(r.out) && /omnikom-io/.test(r.out), r.out);
  check('dry run: lists the three steps it would take', /would create .*ADVISOR_REPORTS/.test(r.out) && /would bind ADVISOR_REPORTS/.test(r.out) && /would generate REPORT_SALT/.test(r.out), r.out);
  check('dry run: says nothing was changed', /nothing was changed/i.test(r.out), r.out);
  check('dry run: the token and the account id never printed', clean(r.out), r.out);
  check('every call carries the token and a timeout signal', cf.calls.length > 0 && cf.calls.every((c) => c.auth === 'Bearer ' + TOKEN && c.signal instanceof AbortSignal), cf.calls.length);

  // the dry run when all is done
  cf = fakeCF({ projects: [site({ kv: { ADVISOR_REPORTS: { namespace_id: 'ns-adv' } }, vars: { REPORT_SALT: { type: 'secret_text', value: 'x' } } })], namespaces: [{ id: 'ns-adv', title: 'ADVISOR_REPORTS' }] });
  r = await go([], cf);
  check('dry run (the default) when done: exit 0, all three already, nothing would change', r.code === 0 && !/would /.test(r.out) && (r.out.match(/already/g) || []).length === 3 && r.writes.length === 0, r.out);

  // the domain: exact or www., found past the first page, found through the domains call when the list has none
  cf = fakeCF({ projects: [{ ...site(), domains: ['omnikom-io.pages.dev', 'www.omnikom.io'] }], namespaces: [] }); r = await go(['--dry-run'], cf);
  check('domain: served only on www. = found', r.code === 0 && /YES/.test(r.out), r.out);
  cf = fakeCF({ projects: [...others(12), site()], namespaces: [] }); r = await go(['--dry-run'], cf);
  check('domain: the project on page 2 of the list = found', r.code === 0 && /YES/.test(r.out), r.out);
  cf = fakeCF({ projects: [site()], namespaces: [] }, { noDomains: true }); r = await go(['--dry-run'], cf);
  check('domain: a list without domains = asked per project, found', r.code === 0 && /YES/.test(r.out), r.out);
  cf = fakeCF({ projects: [...others(2), { name: 'look-alike', domains: ['notomnikom.io', 'omnikom.io.example.com'], kv: {}, vars: {} }], namespaces: [] });
  r = await go(['--apply'], cf);
  check('domain: no project serves it (look-alikes only) = exit 3, NO, BLOCKED, nothing written', r.code === 3 && /NO/.test(r.out) && /BLOCKED/.test(r.out) && r.writes.length === 0, r.code + '\n' + r.out);

  // apply on a project with nothing done
  cf = fakeCF({ projects: [site()], namespaces: [{ id: 'ns-lead', title: 'LEAD_LIMITS' }] });
  r = await go(['--apply'], cf);
  const post = r.writes.filter((c) => c.method === 'POST'), patch = r.writes.filter((c) => c.method === 'PATCH');
  const prod = patch[0]?.body?.deployment_configs?.production || {}, made = cf.state.namespaces.find((n) => n.title === 'ADVISOR_REPORTS');
  const saltValue = prod.env_vars?.REPORT_SALT?.value || '';
  check('apply: exit 0', r.code === 0, r.code + '\n' + r.out);
  check('apply: one POST makes the namespace ADVISOR_REPORTS', post.length === 1 && post[0].body?.title === 'ADVISOR_REPORTS' && !!made, JSON.stringify(post.map((c) => c.body)));
  check('apply: one PATCH binds ADVISOR_REPORTS to the new namespace on production', patch.length === 1 && prod.kv_namespaces?.ADVISOR_REPORTS?.namespace_id === made?.id, JSON.stringify(prod.kv_namespaces));
  check('apply: REPORT_SALT is a secret_text of 32 random bytes (64 hex)', prod.env_vars?.REPORT_SALT?.type === 'secret_text' && /^[0-9a-f]{64}$/.test(saltValue), prod.env_vars?.REPORT_SALT?.type);
  check('apply: the PATCH names only the two new keys', Object.keys(prod.kv_namespaces || {}).join() === 'ADVISOR_REPORTS' && Object.keys(prod.env_vars || {}).join() === 'REPORT_SALT', JSON.stringify(Object.keys(prod)));
  check('apply: the salt, the token and the account id never printed', saltValue.length === 64 && clean(r.out, [saltValue]), r.out);
  check('apply: the other names are kept', !!cf.state.projects[0].vars.TURNSTILE_SECRET && !!cf.state.projects[0].kv.LEAD_LIMITS, JSON.stringify(Object.keys(cf.state.projects[0].vars)));
  check('apply: says it takes effect at the next production deployment', /next production deployment/.test(r.out), r.out);
  const mark = cf.calls.length, second = await go(['--apply'], cf);
  check('apply twice: the second run writes nothing (the salt is not rotated)', second.code === 0 && cf.calls.slice(mark).every((c) => c.method === 'GET') && cf.state.projects[0].vars.REPORT_SALT.value === saltValue, second.out);

  // apply when the namespace exists and the salt is set: bind only
  cf = fakeCF({ projects: [site({ vars: { REPORT_SALT: { type: 'secret_text', value: 'keep-me' } } })], namespaces: [{ id: 'ns-adv', title: 'ADVISOR_REPORTS' }] });
  r = await go(['--apply'], cf);
  const p2 = r.writes.find((c) => c.method === 'PATCH')?.body?.deployment_configs?.production || {};
  check('apply: namespace exists = no POST; salt set = not in the PATCH, not rotated', r.code === 0 && !r.writes.some((c) => c.method === 'POST') && p2.kv_namespaces?.ADVISOR_REPORTS?.namespace_id === 'ns-adv' && !p2.env_vars && cf.state.projects[0].vars.REPORT_SALT.value === 'keep-me', r.out);

  // the project's wrangler_config_hash goes back with the PATCH, as wrangler's own "pages secret put" does
  cf = fakeCF({ projects: [site({ hash: 'h-1234' })], namespaces: [] }); r = await go(['--apply'], cf);
  const ph = r.writes.find((c) => c.method === 'PATCH')?.body?.deployment_configs?.production || {};
  check('apply: the PATCH carries the project\'s wrangler_config_hash', r.code === 0 && ph.wrangler_config_hash === 'h-1234', JSON.stringify(Object.keys(ph)));

  // a binding to another namespace is not touched
  cf = fakeCF({ projects: [site({ kv: { ADVISOR_REPORTS: { namespace_id: 'ns-somewhere-else' } } })], namespaces: [{ id: 'ns-adv', title: 'ADVISOR_REPORTS' }] });
  r = await go(['--apply'], cf);
  check('apply: ADVISOR_REPORTS bound to another namespace = exit 1, nothing written', r.code === 1 && r.writes.length === 0 && /another namespace/.test(r.out), r.code + '\n' + r.out);
  cf = fakeCF({ projects: [site({ kv: { ADVISOR_REPORTS: { namespace_id: 'ns-somewhere-else' } } })], namespaces: [{ id: 'ns-somewhere-else', title: 'SOMETHING_ELSE' }] });
  r = await go(['--apply'], cf);
  check('apply: ADVISOR_REPORTS bound to a namespace of another title, none titled ADVISOR_REPORTS = exit 1, nothing written', r.code === 1 && r.writes.length === 0 && /another namespace/.test(r.out), r.code + '\n' + r.out + '\nwrites: ' + r.writes.map((c) => c.method).join(', '));

  // a PATCH that replaces instead of merging is caught after it
  cf = fakeCF({ projects: [site()], namespaces: [] }, { replace: true });
  r = await go(['--apply'], cf);
  check('apply: a PATCH that dropped other names = exit 1, FAIL names them', r.code === 1 && /FAIL/.test(r.out) && /TURNSTILE_SECRET/.test(r.out) && /LEAD_LIMITS/.test(r.out), r.code + '\n' + r.out);

  // the check after the PATCH reads every binding kind and the preview environment, not only production's KV and variables
  cf = fakeCF({ projects: [site({ more: { d1_databases: { LEADS_DB: { id: 'd1-1' } }, compatibility_date: '2026-11-25' }, preview: { env_vars: { PREVIEW_FLAG: { type: 'plain_text', value: '1' } } } })], namespaces: [] }, { dropRest: true });
  r = await go(['--apply'], cf);
  check('apply: a PATCH that dropped a binding of another kind (D1) = exit 1, FAIL names it', r.code === 1 && /FAIL/.test(r.out) && /LEADS_DB/.test(r.out), r.code + '\n' + r.out);
  check('apply: a PATCH that dropped a preview name = exit 1, FAIL names it', r.code === 1 && /FAIL/.test(r.out) && /PREVIEW_FLAG/.test(r.out), r.code + '\n' + r.out);
  cf = fakeCF({ projects: [site({ more: { d1_databases: { LEADS_DB: { id: 'd1-1' } }, compatibility_date: '2026-11-25' }, preview: { env_vars: { PREVIEW_FLAG: { type: 'plain_text', value: '1' } } } })], namespaces: [] });
  r = await go(['--apply'], cf);
  check('apply: other binding kinds and the preview environment kept = exit 0', r.code === 0 && !/FAIL/.test(r.out), r.code + '\n' + r.out);

  // an API error that echoes the token and the account id
  cf = fakeCF({ projects: [site()], namespaces: [] }, { fail: true });
  r = await go(['--dry-run'], cf);
  check('error: HTTP 403 = exit 1, the token and the account id scrubbed from the message', r.code === 1 && /403/.test(r.out) && clean(r.out), r.code + '\n' + r.out);
  return results;
};
const P = (file, from, to) => ({ file, from, to });
const MUTANTS = [
  { name: 'the dry-run stop removed', patches: [P('provision.mjs', 'if (!apply) {', 'if (false) {')], expect: [/dry run: GET only/, /dry run: no salt generated/] },
  { name: 'the salt printed instead of hidden', patches: [P('provision.mjs', 'hide.push(value);', "hide.push(); log('salt ' + value);")], expect: [/the salt, the token and the account id never printed/] },
  { name: 'the scrub removed', patches: [P('provision.mjs', 'const scrub = (s) => hide.reduce(', 'const scrub = (s) => [].reduce(')], expect: [/scrubbed from the message/] },
  { name: 'the salt rotated when set', patches: [P('provision.mjs', 'needSalt = !(SECRET in varsB);', 'needSalt = true;')], expect: [/not rotated/] },
  { name: 'the check after the PATCH removed', patches: [P('provision.mjs', 'if (lost.length) {', 'if (false) {')], expect: [/dropped other names/] },
  { name: 'the check after the PATCH reads production only', patches: [P('provision.mjs', 'const names = (dc) => Object.entries(dc).flatMap(', 'const names = (dc) => Object.entries({ production: dc.production || {} }).flatMap(')], expect: [/dropped a preview name/] },
  { name: 'the check after the PATCH reads KV and variables only', patches: [P('provision.mjs', 'Object.entries(c || {}).flatMap(', "Object.entries(c || {}).filter(([kind]) => ['kv_namespaces', 'env_vars'].includes(kind)).flatMap(")], expect: [/binding of another kind/] },
  { name: 'the domain matched by suffix', patches: [P('provision.mjs', "(d) => d === domain || d === 'www.' + domain", '(d) => d.endsWith(domain)')], expect: [/look-alikes only/] },
  { name: 'only the first page read', patches: [P('provision.mjs', 'if (list.length < per) break;', 'break;')], expect: [/page 2 of the list/] },
  { name: 'the other-namespace refusal removed', patches: [P('provision.mjs', 'if (bound && (!ns || bound !== ns.id)) {', 'if (false) {')], expect: [/bound to another namespace/, /of another title/] },
  { name: 'the refusal only when a namespace of that title exists', patches: [P('provision.mjs', 'if (bound && (!ns || bound !== ns.id)) {', 'if (bound && ns && bound !== ns.id) {')], expect: [/of another title/] },
  { name: 'the timeout signal dropped', patches: [P('provision.mjs', ' signal: AbortSignal.timeout(TIMEOUT_MS),', '')], expect: [/timeout signal/] },
  { name: '--token-env ignored', patches: [P('provision.mjs', 'const tokenName = ti >= 0 ? argv[ti + 1] : DEFAULT_TOKEN;', 'const tokenName = DEFAULT_TOKEN;')], expect: [/that token is used/, /names an unset variable/] },
  { name: 'any variable name taken as a token', patches: [P('provision.mjs', '/^CLOUDFLARE_[A-Z_]*TOKEN$/.test(tokenName)', 'true')], expect: [/not a Cloudflare token/] },
  { name: 'the wrangler_config_hash dropped', patches: [P('provision.mjs', 'const production = before.wrangler_config_hash ? { wrangler_config_hash: before.wrangler_config_hash } : {};', 'const production = {};')], expect: [/wrangler_config_hash/] },
  { name: 'the domains call dropped', patches: [P('provision.mjs', 'if (!Array.isArray(p.domains))', 'if (false)')], expect: [/asked per project/] },
];
process.exit(await main({ label: 'PROVISION', scenarios, MUTANTS, scriptsDir: path.join(here, '../ops'), argv: process.argv.slice(2) }));
