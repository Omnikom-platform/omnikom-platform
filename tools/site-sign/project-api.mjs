// project-api: create or read one Cloudflare Pages project, or set its secrets, through the provider's API. Never deletes.
//   node project-api.mjs create <project>
//   node project-api.mjs get <project>
//   node project-api.mjs secrets <project> --names A,B     (each value is read from the environment variable of its name, never an argument)
// Needs CLOUDFLARE_API_TOKEN (read by name, never printed). The account is CLOUDFLARE_ACCOUNT_ID when set, else the one account the token
// sees (none or several: exit 1, set it by name). Exit 0 the provider answered success, 1 refused or no answer, 2 wrong command line.
// The network is the seam `fetch` (project-api.test.mjs); every printed line has the token, the account id and the secret values cut out.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERBS = ['create', 'get', 'secrets'];
const USAGE = 'usage: project-api.mjs create|get <project> | secrets <project> --names A,B';
const DELETE = "delete is not wrapped: it is irreversible and the head's own step";
const API = 'https://api.cloudflare.com/client/v4/accounts';

export async function projectApi(argv, { env = process.env, fetch = globalThis.fetch, out = console.log, err = console.error } = {}) {
  const verb = argv[0], p = argv[1], rest = argv.slice(2);
  if (!VERBS.includes(verb)) { err(verb === 'delete' ? DELETE : USAGE); return 2; }
  if (!/^[a-z0-9-]{3,58}$/.test(p || '')) { err(USAGE); return 2; }
  let names = [];
  if (verb === 'secrets') {
    if (rest.length !== 2 || rest[0] !== '--names') { err(USAGE); return 2; }
    names = rest[1].split(',');
    if (!names.every((n) => /^[A-Z][A-Z0-9_]{2,60}$/.test(n)) || new Set(names).size !== names.length) { err(USAGE); return 2; }
  } else if (rest.length) { err(USAGE); return 2; }
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!token) { err('CLOUDFLARE_API_TOKEN is not set'); return 1; }
  const short = names.filter((n) => !env[n] || env[n].length < 8);
  if (short.length) { err(`REFUSED: ${short[0]} is not set in the environment or is shorter than 8 characters; nothing sent`); return 1; }
  const vals = names.map((n) => env[n]);
  const hide = [token, ...vals];
  const scrub = (s) => { let t = String(s); for (const h of hide) if (h) t = t.split(h).join('[hidden]'); return t; };
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const call = async (method, url, body) => {
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    let j = null;
    try { j = JSON.parse(await res.text()); } catch { j = null; }
    return { status: res.status, j, ok: j?.success === true };
  };
  const errs = (j) => (Array.isArray(j?.errors) && j.errors.length ? `, errors ${j.errors.map((e) => `${e?.code}: ${e?.message}`).join(' | ')}` : '');
  try {
    let account = env.CLOUDFLARE_ACCOUNT_ID;
    if (!env.CLOUDFLARE_ACCOUNT_ID) {
      const lk = await call('GET', API);
      if (!lk.ok) { err(scrub(`${verb} ${p}: the account lookup answered HTTP ${lk.status}, success false${errs(lk.j)}`)); return 1; }
      const accounts = Array.isArray(lk.j?.result) ? lk.j.result : [];
      if (accounts.length !== 1) { err(`CLOUDFLARE_ACCOUNT_ID is not set and the token sees ${accounts.length} accounts; set it by name`); return 1; }
      account = accounts[0].id;
    }
    hide.push(account);
    const base = `${API}/${account}/pages/projects`;
    let r;
    if (verb === 'create') r = await call('POST', base, { name: p, production_branch: 'main' });
    else if (verb === 'get') r = await call('GET', `${base}/${p}`);
    else {
      const E = { env_vars: Object.fromEntries(names.map((n) => [n, { type: 'secret_text', value: env[n] }])) };
      r = await call('PATCH', `${base}/${p}`, { deployment_configs: { production: E, preview: E } });
    }
    const { status, j, ok } = r;
    const result = j?.result && typeof j.result === 'object' && !Array.isArray(j.result) ? j.result : {};
    let line = `${verb} ${p}: HTTP ${status}, success ${ok}`;
    if (result.subdomain) line += `, address ${result.subdomain}`;
    if (result.production_branch) line += `, production branch ${result.production_branch}`;
    line += errs(j);
    if (verb === 'secrets') {
      const list = (c) => { const v = c?.env_vars && typeof c.env_vars === 'object' ? Object.entries(c.env_vars).map(([k, x]) => `${k} (${x?.type})`) : []; return v.length ? v.join(', ') : 'none'; };
      line += `; now production: ${list(result.deployment_configs?.production)}; preview: ${list(result.deployment_configs?.preview)}`;
    }
    out(scrub(line));
    return j?.success === true ? 0 : 1;
  } catch (e) { err(scrub(`${verb} ${p}: no answer from the provider (${String(e && e.message).slice(0, 100)})`)); return 1; }
}

const isMain = (() => { if (!process.argv[1]) return false; try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })();
if (isMain) process.exitCode = await projectApi(process.argv.slice(2));
