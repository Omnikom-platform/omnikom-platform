// One command that takes a client site from a bare `sites` row to a Cloudflare Pages project with its lead settings, a signing
// key, and (when asked) its domain with TLS. Work order 35, product row E15 (hardening step H2-7).
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/client-infra/provision.mjs --site <deploy_target>
//        [--domain <host>] [--write-dns] [--tls-wait-min 0] [--dry-run] [--target staging]
// Every step reads first and writes only what differs, so a second run changes nothing ("changed 0"). --dry-run reads the same
// and prints each write it would make (method and path) without making it.
// Exit: 0 done, 1 a step failed, 2 usage or refused (nothing written), 3 done but waiting on someone (DNS record or TLS).
// Safety: staging only for now (production is the owner's click). A domain is accepted only when it is listed in dns-allowed.json
// (owner rulings, exact hostnames); a DNS record is written only with --write-dns, only that one CNAME, never over a different one.
// Keys and tokens are read by name and never printed. The site's key goes to the Vault, the api_keys registry and the Pages secret
// SITE_SIGNING_KEY; the plain variable SITE_SIGNING_KEY_REF names the Vault secret it came from, so a run can tell that the Pages
// secret is the newest active key without reading the secret back (Cloudflare never returns it).
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENVS = ['preview', 'production'];
export const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const PROJECT_RE = /^[a-z0-9][a-z0-9-]{0,56}$/;

export class Refused extends Error {}

// The owner's rulings, exact hosts; an entry past its `until` day (UTC) is ignored, so an exception lapses by itself.
export function loadAllowed(file = join(dirname(fileURLToPath(import.meta.url)), 'dns-allowed.json'), today = new Date().toISOString().slice(0, 10)) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  return (j.hosts || [])
    .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.until || '') && today <= h.until)
    .map((h) => ({ host: String(h.host).toLowerCase(), zone: String(h.zone).toLowerCase() }))
    .filter((h) => h.host === h.zone || h.host.endsWith(`.${h.zone}`));
}

// o: { site, domain, dryRun, writeDns, tlsWaitMs, platformBase, allowed: [{host, zone}] }
// d: { db, cf, log(line), sleep(ms) }   (live.mjs builds the real ones; test/fakes.mjs the in-memory ones)
export async function provision(o, d) {
  const out = { changed: 0, waiting: [], failed: [] };
  const log = d.log;
  const would = (what, call) => log(`would  ${what}  [${call}]`);
  const did = (what) => { out.changed++; log(`done   ${what}`); };

  if (!o.site || !PROJECT_RE.test(o.site)) throw new Refused(`--site must be a Pages project name (the sites.deploy_target), got ${JSON.stringify(o.site)}`);
  if (!o.platformBase || !/^https:\/\/[^\s]+$/.test(o.platformBase)) throw new Refused('PLATFORM_FUNCTIONS_BASE is not set to an https address');
  const domain = o.domain ? String(o.domain).toLowerCase() : null;
  let allowedHost = null;
  if (domain) {
    if (!HOST_RE.test(domain)) throw new Refused(`--domain ${domain} is not a hostname`);
    allowedHost = (o.allowed || []).find((a) => a.host === domain) || null;
    if (!allowedHost) throw new Refused(`--domain ${domain} is not in dns-allowed.json: on staging only hosts the owner ruled on are used; a client's real domain is the owner's click`);
  }
  if (o.writeDns && !domain) throw new Refused('--write-dns needs --domain');

  // 1 the site row (made by the dashboard, or by the proof's seed); nothing is created here
  const site = await d.db.getSite(o.site);
  if (!site) throw new Refused(`no sites row with deploy_target ${o.site}: the site must exist first`);
  log(`ok     site ${site.deploy_target} (${site.id.slice(0, 8)}, workspace ${site.workspace_slug}, state ${site.state})`);
  if (domain) {
    const holder = await d.db.domainHolder(domain, site.id);
    if (holder) throw new Refused(`domain ${domain} already belongs to site ${holder}`);
    if (site.domain && site.domain.toLowerCase() !== domain) throw new Refused(`site ${site.deploy_target} already has domain ${site.domain}; changing it is the owner's call`);
  }

  // 2 the Pages project
  let project = await d.cf.getProject(site.deploy_target);
  if (project) log(`ok     Pages project ${project.name} (${project.subdomain})`);
  else if (o.dryRun) would(`create Pages project ${site.deploy_target}, production branch main`, 'POST /accounts/[account]/pages/projects');
  else {
    project = await d.cf.createProject(site.deploy_target, 'main');
    did(`created Pages project ${project.name} (${project.subdomain})`);
  }

  // 3 the signing key: the newest active site-signing key, minted when there is none
  let key = await d.db.activeKey(site.id);
  let keyValue = null;
  if (key) log(`ok     signing key ${key.vault_ref} (active)`);
  else if (o.dryRun) would(`mint a signing key for ${site.deploy_target} (Vault secret, api_keys row, sites.signing_key_ref)`, 'psql: vault.create_secret + insert api_keys + update sites');
  else {
    const m = await d.db.mintKey(site);
    key = { vault_ref: m.vault_ref };
    keyValue = m.value;
    did(`minted signing key ${m.vault_ref} (Vault, api_keys, sites.signing_key_ref; value not shown)`);
  }

  // 4 the lead settings on both environments (what factory/worker/pages-function-lead.js reads)
  for (const env of ENVS) {
    const have = (project && project.deployment_configs && project.deployment_configs[env] && project.deployment_configs[env].env_vars) || {};
    const ref = key ? key.vault_ref : '(new key)';
    const want = { SITE_ID: site.id, PLATFORM_BASE: o.platformBase, SITE_SIGNING_KEY_REF: ref };
    const plain = Object.keys(want).filter((k) => !have[k] || have[k].type !== 'plain_text' || have[k].value !== want[k]);
    const secret = !have.SITE_SIGNING_KEY || have.SITE_SIGNING_KEY.type !== 'secret_text' || (have.SITE_SIGNING_KEY_REF && have.SITE_SIGNING_KEY_REF.value) !== ref;
    const names = [...plain, ...(secret ? ['SITE_SIGNING_KEY'] : [])];
    if (!names.length) { log(`ok     ${env} settings SITE_ID, PLATFORM_BASE, SITE_SIGNING_KEY, SITE_SIGNING_KEY_REF`); continue; }
    if (o.dryRun) { would(`set ${env} ${names.join(', ')}`, `PATCH /accounts/[account]/pages/projects/${site.deploy_target} deployment_configs.${env}.env_vars`); continue; }
    if (secret && !keyValue) keyValue = await d.db.readKey(key.vault_ref);
    if (secret && !/^[0-9a-f]{64}$/.test(keyValue || '')) throw new Error(`the Vault secret ${key.vault_ref} is not a 64-hex key`);
    const vars = {};
    for (const k of plain) vars[k] = { type: 'plain_text', value: want[k] };
    if (secret) vars.SITE_SIGNING_KEY = { type: 'secret_text', value: keyValue };
    const before = Object.keys(have);
    project = await d.cf.setEnvVars(site.deploy_target, env, vars);
    const after = (project.deployment_configs && project.deployment_configs[env] && project.deployment_configs[env].env_vars) || {};
    const lost = before.filter((k) => !after[k]);
    const missing = [...Object.keys(want), 'SITE_SIGNING_KEY'].filter((k) => !after[k] || (want[k] !== undefined && after[k].value !== want[k]));
    if (after.SITE_SIGNING_KEY && after.SITE_SIGNING_KEY.type !== 'secret_text') throw new Error(`${env} SITE_SIGNING_KEY reads back as ${after.SITE_SIGNING_KEY.type}, not an encrypted secret`);
    if (lost.length || missing.length) throw new Error(`${env} settings did not read back: ${lost.length ? `lost ${lost.join(', ')}` : ''}${missing.length ? ` missing ${missing.join(', ')}` : ''}`);
    did(`set ${env} ${names.join(', ')} (read back)`);
  }

  // 5 the domain: the sites row, the Pages custom domain, the DNS record, TLS
  if (domain) {
    if (!site.domain) {
      if (o.dryRun) would(`set sites.domain = ${domain}`, `psql: update sites set domain where id = ${site.id} and domain is null; exactly 1 row or fail`);
      else { await d.db.setDomain(site.id, domain); did(`set sites.domain = ${domain}`); }
    } else log(`ok     sites.domain ${site.domain}`);

    let dom = project ? (await d.cf.listDomains(site.deploy_target)).find((x) => x.name === domain) : null;
    if (dom) log(`ok     Pages custom domain ${domain} (status ${dom.status})`);
    else if (o.dryRun) would(`attach custom domain ${domain} to ${site.deploy_target}`, `POST /accounts/[account]/pages/projects/${site.deploy_target}/domains`);
    else { dom = await d.cf.addDomain(site.deploy_target, domain); did(`attached custom domain ${domain} (status ${dom.status})`); }

    const target = project ? project.subdomain : `${site.deploy_target}.pages.dev`;
    const recs = await d.cf.dnsRecords(allowedHost.zone, domain);
    const same = recs.find((r) => r.type === 'CNAME' && r.content === target);
    if (same) log(`ok     DNS CNAME ${domain} -> ${target} (proxied ${same.proxied})`);
    else if (recs.length) { out.failed.push('dns'); log(`FAIL   DNS: ${domain} already has ${recs.map((r) => `${r.type} ${r.content}`).join(', ')}; nothing was changed (a different record is never overwritten)`); }
    else if (!o.writeDns) { out.waiting.push('dns'); log(`WAIT   DNS record to add (the owner's click): CNAME ${domain} -> ${target} (proxied)`); }
    else if (o.dryRun) would(`create DNS CNAME ${domain} -> ${target} (proxied) in zone ${allowedHost.zone}`, `POST /zones/[${allowedHost.zone}]/dns_records`);
    else { const r = await d.cf.createCname(allowedHost.zone, domain, target); did(`created DNS CNAME ${r.name} -> ${r.content} (proxied ${r.proxied}, record ${r.id.slice(0, 8)})`); }

    if (dom && !o.dryRun) {
      const until = Date.now() + (o.tlsWaitMs || 0);
      while (dom.status !== 'active' && Date.now() < until) { await d.sleep(15000); dom = await d.cf.getDomain(site.deploy_target, domain); }
      if (dom.status === 'active') log(`ok     TLS ${domain}: domain active${dom.certificate_authority ? `, certificate by ${dom.certificate_authority}` : ''}`);
      else { out.waiting.push('tls'); log(`WAIT   TLS ${domain}: status ${dom.status}${dom.validation_data && dom.validation_data.status ? `, validation ${dom.validation_data.status}` : ''}`); }
    }
  }

  log(`${o.dryRun ? 'DRY RUN' : 'RESULT'}: changed ${out.changed}${out.waiting.length ? `, waiting on ${out.waiting.join(', ')}` : ''}${out.failed.length ? `, FAILED ${out.failed.join(', ')}` : ''}`);
  return out;
}

export function parseArgs(argv) {
  const o = { dryRun: false, writeDns: false, tlsWaitMs: 0, target: 'staging' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => { const x = argv[++i]; if (x === undefined) throw new Refused(`${a} needs a value`); return x; };
    if (a === '--site') o.site = v();
    else if (a === '--domain') o.domain = v();
    else if (a === '--write-dns') o.writeDns = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--tls-wait-min') { const n = Number(v()); if (!(n >= 0 && n <= 60)) throw new Refused('--tls-wait-min is 0 to 60'); o.tlsWaitMs = n * 60000; }
    else if (a === '--target') o.target = v();
    else throw new Refused(`unknown argument ${a}`);
  }
  if (o.target !== 'staging') throw new Refused(`--target ${o.target}: only staging is built (work order 35); production is the owner's click`);
  return o;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); }
})();
if (isMain) {
  let code = 0;
  try {
    const o = parseArgs(process.argv.slice(2));
    const { liveDeps } = await import('./live.mjs');
    o.allowed = loadAllowed();
    const d = liveDeps({ log: (l) => console.log(l), allowed: o.allowed });
    // the same derivation as the runner's secrets (docs/blueprint/PROGRESS.md: PLATFORM_FUNCTIONS_BASE from STAGING_SUPABASE_REF)
    const ref = process.env.STAGING_SUPABASE_REF;
    o.platformBase = process.env.PLATFORM_FUNCTIONS_BASE || (ref && /^[a-z0-9]{20}$/.test(ref) ? `https://${ref}.supabase.co/functions/v1` : '');
    const r = await provision(o, d);
    code = r.failed.length ? 1 : r.waiting.length ? 3 : 0;
  } catch (e) {
    console.error(`${e instanceof Refused ? 'REFUSED' : 'FAIL'}: ${e.message}`);
    code = e instanceof Refused ? 2 : 1;
  }
  process.exit(code);
}
