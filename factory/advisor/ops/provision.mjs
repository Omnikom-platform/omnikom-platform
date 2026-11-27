// The live part of the session report on omnikom.io (PARK A1 point 2a; docs/advisor/r3/HANDOVER-collector.md): the Workers KV namespace
// ADVISOR_REPORTS, its binding on the production environment of the Pages project that serves the domain, and the secret REPORT_SALT
// (32 random bytes made here, stored only as an encrypted Pages secret, never printed, never rotated once set).
//   node tools/with-env.mjs "<master env file>" -- node factory/advisor/ops/provision.mjs [--domain omnikom.io] [--token-env <NAME>] [--dry-run | --apply]
// The default is the dry run: GET calls only; it says which project serves the domain (YES / NO) and lists what --apply would do.
// The token is read by name from --token-env (default CLOUDFLARE_ADMIN_TOKEN, the work account's; omnikom.io's project is read by
// CLOUDFLARE_API_TOKEN, 2026-11-27); the output is scrubbed of the token, every account id and the salt.
// Exit 0 done or nothing to do, 1 an API call failed or the check after the change failed, 2 bad usage or no token,
// 3 no Pages project on the token's accounts serves the domain (BLOCKED: a token for the account that holds it).
// Sources, read 2026-11-27: https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/edit/ (PATCH; "To delete an
// environment variable, set its key to `null`", so names left out are kept; checked again after the PATCH), .../projects/methods/list/,
// https://developers.cloudflare.com/api/resources/kv/subresources/namespaces/methods/create/ and /list/,
// https://developers.cloudflare.com/pages/functions/bindings/ ("Redeploy your project for the binding to take effect."), and wrangler's own
// "pages secret put", which PATCHes one key and sends the project's wrangler_config_hash back: cloudflare/workers-sdk@629f135e
// packages/wrangler/src/pages/secret/index.ts.
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'https://api.cloudflare.com/client/v4', TIMEOUT_MS = 30000;
const NS_TITLE = 'ADVISOR_REPORTS', BINDING = 'ADVISOR_REPORTS', SECRET = 'REPORT_SALT', DEFAULT_TOKEN = 'CLOUDFLARE_ADMIN_TOKEN';

export async function run({ argv = [], env = {}, fetch = globalThis.fetch, log = console.log, salt = () => randomBytes(32).toString('hex') } = {}) {
  const usage = '[--domain <host>] [--token-env <NAME>] [--dry-run | --apply]';
  const di = argv.indexOf('--domain'), domain = di >= 0 ? argv[di + 1] : 'omnikom.io';
  const ti = argv.indexOf('--token-env');
  const tokenName = ti >= 0 ? argv[ti + 1] : DEFAULT_TOKEN;
  const extra = argv.filter((a, i) => !['--dry-run', '--apply', '--domain', '--token-env'].includes(a) && !(di >= 0 && i === di + 1) && !(ti >= 0 && i === ti + 1));
  const apply = argv.includes('--apply');
  if (extra.length || (apply && argv.includes('--dry-run')) || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain || '') || !/^CLOUDFLARE_[A-Z_]*TOKEN$/.test(tokenName)) { log('usage: ' + usage); return 2; }
  const token = env[tokenName];
  if (!token) { log(`set ${tokenName} (by name)`); return 2; }
  const hide = [token];
  const scrub = (s) => hide.reduce((t, h) => t.split(h).join('[hidden]'), String(s));
  const say = (s) => log(scrub(s));
  const cf = async (method, path, body) => {
    const r = await fetch(API + path, { method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS), });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.success === false) throw new Error(`${method} ${path}: HTTP ${r.status} ${(j?.errors || []).map((e) => e.code + ' ' + e.message).join('; ')}`);
    return j.result;
  };
  const all = async (path, per) => {
    const out = [];
    for (let page = 1; page <= 100; page++) {
      const list = (await cf('GET', `${path}?page=${page}&per_page=${per}`)) || [];
      out.push(...list);
      if (list.length < per) break;
    }
    return out;
  };
  try {
    const accounts = await all('/accounts', 50);
    for (const a of accounts) hide.push(a.id);
    const found = [];
    for (const a of accounts) {
      for (const p of await all(`/accounts/${a.id}/pages/projects`, 10)) {
        let names = p.domains;
        if (!Array.isArray(p.domains)) names = ((await cf('GET', `/accounts/${a.id}/pages/projects/${p.name}/domains`)) || []).map((d) => d.name);
        if (names.some((d) => d === domain || d === 'www.' + domain)) found.push({ acct: a.id, project: p.name });
      }
    }
    if (found.length > 1) { say(`FAIL: ${found.length} Pages projects list ${domain}: ${found.map((f) => f.project).join(', ')}. This script does not choose between them; nothing changed.`); return 1; }
    const { acct, project } = found[0] || {};
    if (!project) {
      say(`NO: none of the ${accounts.length} account(s) this token reads holds a Pages project that serves ${domain}.`);
      say(`BLOCKED — ${domain} is not on this token's account — a token for the account that holds its Pages project`);
      return 3;
    }
    say(`YES: the Pages project ${project} serves ${domain} (account ${accounts.findIndex((a) => a.id === acct) + 1} of ${accounts.length} read; ids not printed).`);
    const projPath = `/accounts/${acct}/pages/projects/${project}`;
    const configs = async () => (await cf('GET', projPath))?.deployment_configs || {};
    // every name in every map of both environments (KV, variables and secrets, D1, R2, services, ...): the PATCH may lose none of them
    const names = (dc) => Object.entries(dc).flatMap(([envName, c]) => Object.entries(c || {}).flatMap(([kind, m]) => (m && typeof m === 'object' && !Array.isArray(m) ? Object.keys(m).map((k) => `${envName} ${kind} ${k}`) : [])));
    const dcB = await configs(), before = dcB.production || {}, kvB = before.kv_namespaces || {}, varsB = before.env_vars || {};
    let ns = (await all(`/accounts/${acct}/storage/kv/namespaces`, 100)).find((n) => n.title === NS_TITLE);
    const bound = kvB[BINDING]?.namespace_id;
    if (bound && (!ns || bound !== ns.id)) { say(`FAIL: ${BINDING} is bound on ${project} to another namespace than ${NS_TITLE}; nothing changed.`); return 1; }
    const needNs = !ns, needBind = !bound, needSalt = !(SECRET in varsB);
    const plan = [
      needNs ? `create the Workers KV namespace ${NS_TITLE}` : `already: the Workers KV namespace ${NS_TITLE} exists`,
      needBind ? `bind ${BINDING} to it on ${project} (production)` : `already: ${BINDING} is bound on ${project} (production)`,
      needSalt ? `generate ${SECRET} (32 random bytes) and set it as an encrypted secret on ${project} (production), never printed` : `already: ${SECRET} is set on ${project} (production); not rotated`,
    ];
    if (!apply) {
      for (const l of plan) say(l.startsWith('already') ? l : 'would ' + l);
      say(`DRY RUN: nothing was changed. ${needNs || needBind || needSalt ? '--apply makes the changes above.' : 'Nothing to do.'}`);
      return 0;
    }
    if (needNs) { ns = await cf('POST', `/accounts/${acct}/storage/kv/namespaces`, { title: NS_TITLE }); say(`done: created the Workers KV namespace ${NS_TITLE}`); }
    const production = before.wrangler_config_hash ? { wrangler_config_hash: before.wrangler_config_hash } : {};
    if (needBind) production.kv_namespaces = { [BINDING]: { namespace_id: ns.id } };
    if (needSalt) { const value = salt(); hide.push(value); production.env_vars = { [SECRET]: { type: 'secret_text', value } }; }
    if (needBind || needSalt) await cf('PATCH', projPath, { deployment_configs: { production } });
    const dcA = await configs(), after = dcA.production || {}, kvA = after.kv_namespaces || {}, varsA = after.env_vars || {};
    const left = names(dcA), lost = names(dcB).filter((n) => !left.includes(n));
    if (lost.length) { say(`FAIL: after the PATCH these names are gone from ${project}: ${lost.join(', ')}. Set them again by hand.`); return 1; }
    if (kvA[BINDING]?.namespace_id !== ns.id || !(SECRET in varsA)) { say(`FAIL: after the PATCH ${BINDING} or ${SECRET} is not on ${project} (production).`); return 1; }
    for (const l of plan) say(l.startsWith('already') ? l : 'done: ' + l);
    say(`OK: it takes effect at ${project}'s next production deployment ("Redeploy your project for the binding to take effect.").`);
    return 0;
  } catch (e) {
    say(`FAIL ${e.message}`);
    return 1;
  }
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) process.exit(await run({ argv: process.argv.slice(2), env: process.env }));
