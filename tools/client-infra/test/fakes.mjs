// In-memory stand-ins for live.mjs: the staging database (sites, api_keys, Vault) and Cloudflare (Pages projects with their
// settings and custom domains, DNS zones). Cloudflare never returns a secret's value, so neither does this one; tests read the
// stored value from `state.secretValues`. `writes` lists every write call, so a test can say "nothing was written".
import { randomBytes } from 'node:crypto';

export function newState() {
  return {
    sites: [], keys: [], vault: {}, projects: {}, secretValues: {}, zones: { 'omnikom.io': [{ id: 'r-apex', type: 'A', name: 'omnikom.io', content: '192.0.2.1', proxied: true }] },
    writes: [], patchMode: 'merge', nextId: 1,
  };
}

export function addSite(s, { target = 'test-site-wo35', slug = 'test-wo35', domain = null } = {}) {
  const site = { id: `${String(s.nextId++).padStart(8, '0')}-0000-4000-8000-000000000000`, workspace_id: 'ws-' + slug, workspace_slug: slug, deploy_target: target, domain, state: 'preview' };
  s.sites.push(site);
  return site;
}

export function addKey(s, site, n) {
  const ref = `site-${site.workspace_slug}-key-${n}`;
  s.vault[ref] = randomBytes(32).toString('hex');
  s.keys.push({ site_id: site.id, vault_ref: ref, created: s.nextId++, revoked: false });
  return ref;
}

const clone = (x) => JSON.parse(JSON.stringify(x));
const view = (p) => p && clone({ name: p.name, subdomain: p.subdomain, production_branch: p.production_branch, deployment_configs: p.deployment_configs });

export function fakeDeps(s, lines = []) {
  const w = (what) => s.writes.push(what);
  const db = {
    async getSite(t) { const x = s.sites.find((y) => y.deploy_target === t); return x ? clone(x) : null; },
    async domainHolder(d, id) { const x = s.sites.find((y) => y.domain && y.domain.toLowerCase() === d.toLowerCase() && y.id !== id); return x ? x.deploy_target : null; },
    async activeKey(id) { const k = s.keys.filter((x) => x.site_id === id && !x.revoked).sort((a, b) => b.created - a.created)[0]; return k ? { vault_ref: k.vault_ref } : null; },
    async readKey(ref) { return s.vault[ref]; },
    async mintKey(site) {
      w('db.mintKey');
      const nums = [...Object.keys(s.vault), ...s.keys.map((k) => k.vault_ref)].map((n) => (n.match(new RegExp(`^site-${site.workspace_slug}-key-(\\d+)$`)) || [])[1]).filter(Boolean).map(Number);
      const ref = `site-${site.workspace_slug}-key-${(nums.length ? Math.max(...nums) : 0) + 1}`;
      const value = randomBytes(32).toString('hex');
      s.vault[ref] = value;
      s.keys.push({ site_id: site.id, vault_ref: ref, created: s.nextId++, revoked: false });
      return { vault_ref: ref, value };
    },
    async setDomain(id, d) { w('db.setDomain'); const x = s.sites.find((y) => y.id === id); if (x.domain) throw new Error('already set'); x.domain = d; },
  };
  const proj = (name) => { const p = s.projects[name]; if (!p) throw new Error(`HTTP 404 project ${name}`); return p; };
  const status = (p, d) => { if ((s.zones['omnikom.io'] || []).some((r) => r.type === 'CNAME' && r.name === d.name && r.content === p.subdomain)) d.status = 'active'; return clone(d); };
  const cf = {
    async getProject(name) { return view(s.projects[name]); },
    async createProject(name, branch) {
      w('cf.createProject');
      if (s.projects[name]) throw new Error('HTTP 409 exists');
      s.projects[name] = { name, subdomain: `${name}.pages.dev`, production_branch: branch, deployment_configs: { preview: { env_vars: {} }, production: { env_vars: {} } }, domains: [] };
      return view(s.projects[name]);
    },
    async setEnvVars(name, env, vars) {
      w(`cf.setEnvVars ${env}`);
      const p = proj(name);
      const cur = s.patchMode === 'replace' ? {} : p.deployment_configs[env].env_vars;
      for (const [k, v] of Object.entries(vars)) {
        if (v.type === 'secret_text') { cur[k] = { type: 'secret_text' }; s.secretValues[`${name}/${env}/${k}`] = v.value; }
        else cur[k] = { type: v.type, value: v.value };
      }
      p.deployment_configs[env].env_vars = cur;
      return view(p);
    },
    async listDomains(name) { const p = proj(name); return p.domains.map((d) => status(p, d)); },
    async addDomain(name, host) { w('cf.addDomain'); const p = proj(name); const d = { name: host, status: 'pending', validation_data: { status: 'pending' } }; p.domains.push(d); return clone(d); },
    async getDomain(name, host) { const p = proj(name); return status(p, p.domains.find((d) => d.name === host)); },
    async dnsRecords(zone, host) { return clone((s.zones[zone] || []).filter((r) => r.name === host)); },
    async createCname(zone, host, target) { w('cf.createCname'); const r = { id: `rec${s.nextId++}-0000`, type: 'CNAME', name: host, content: target, proxied: true }; s.zones[zone].push(r); return clone(r); },
  };
  return { db, cf, log: (l) => lines.push(l), sleep: async () => {} };
}
