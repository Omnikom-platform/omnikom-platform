// The real Cloudflare and database calls behind provision.mjs (tests use test/fakes.mjs instead).
// Names read from the environment, never printed: CLOUDFLARE_PAGES_TOKEN + CLOUDFLARE_ACCOUNT_ID (Pages), CLOUDFLARE_API_TOKEN
// (DNS zones; CLOUDFLARE_DNS_TOKEN_LEGACY first), STAGING_DB_URL (psql). Sources: https://developers.cloudflare.com/api/resources/pages/subresources/projects/ and
// .../projects/subresources/domains/, https://developers.cloudflare.com/api/resources/dns/subresources/records/ (read 2026-11-10).
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';

const need = (n) => { const v = process.env[n]; if (!v) throw new Error(`set ${n} (read by name, never printed)`); return v; };

// allowed: loadAllowed() of provision.mjs (passed in, not imported: provision.mjs imports this file, and a cycle would deadlock)
export function liveDeps({ log, allowed }) {
  if (!Array.isArray(allowed)) throw new Error('liveDeps needs the allow-list');
  const pagesToken = need('CLOUDFLARE_PAGES_TOKEN'), account = need('CLOUDFLARE_ACCOUNT_ID'), dbUrl = need('STAGING_DB_URL');
  // DNS: CLOUDFLARE_DNS_TOKEN_LEGACY is the token with DNS edit on omnikom.io (the one dns-upsert.mjs used for notify and
  // app-staging); CLOUDFLARE_API_TOKEN lists zones but is refused on their records (403, 2026-11-10)
  const dnsToken = process.env.CLOUDFLARE_DNS_TOKEN_LEGACY || process.env.CLOUDFLARE_API_TOKEN || null;
  const secrets = [pagesToken, account, dbUrl, ...(dnsToken ? [dnsToken] : [])];
  const scrub = (s) => secrets.reduce((t, x) => t.split(x).join('[hidden]'), String(s));

  const call = async (token, method, path, body) => {
    const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
    });
    const j = await r.json().catch(() => null);
    if (r.status === 404 && method === 'GET') return null;
    if (!r.ok || !j || j.success === false) throw new Error(scrub(`${method} ${path.replace(account, '[account]')}: HTTP ${r.status} ${((j && j.errors) || []).map((e) => `${e.code} ${e.message}`).join('; ')}`));
    return j.result;
  };
  const pages = (method, rest = '', body) => call(pagesToken, method, `/accounts/${account}/pages/projects${rest}`, body);

  const zoneIds = new Map();
  const zoneId = async (zone) => {
    if (!dnsToken) throw new Error('set CLOUDFLARE_API_TOKEN (read by name) for DNS');
    if (!zoneIds.has(zone)) {
      const z = await call(dnsToken, 'GET', `/zones?name=${encodeURIComponent(zone)}`);
      if (!z || z.length !== 1) throw new Error(`zone ${zone} is not visible to CLOUDFLARE_API_TOKEN`);
      zoneIds.set(zone, z[0].id);
    }
    return zoneIds.get(zone);
  };
  const allowedOnly = (host) => { if (!allowed.some((a) => a.host === host)) throw new Error(`${host} is not in dns-allowed.json`); };

  // psql reads the SQL from stdin; values travel as psql variables. The key itself is put in the stdin text (\set), never in argv.
  const psql = (sql, vars = {}, stdinVars = {}) => {
    const args = [dbUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A'];
    for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
    const head = Object.entries(stdinVars).map(([k, v]) => { if (!/^[0-9a-f]+$/.test(v)) throw new Error('stdin variables are hex only'); return `\\set ${k} '${v}'\n`; }).join('');
    const r = spawnSync('psql', [...args, '-f', '-'], { encoding: 'utf8', input: head + sql, timeout: 60000, windowsHide: true });
    if (r.status !== 0) throw new Error(scrub(`psql exit ${r.status}: ${(r.stderr || r.error?.message || '').split('\n').slice(0, 3).join(' ')}`));
    return (r.stdout || '').trim();
  };

  const db = {
    async getSite(target) {
      const t = psql(`select row_to_json(x) from (select s.id, s.workspace_id, w.slug as workspace_slug, s.deploy_target, s.domain, s.state::text as state
        from public.sites s join public.workspaces w on w.id = s.workspace_id where s.deploy_target = :'t') x;`, { t: target });
      return t ? JSON.parse(t) : null;
    },
    async domainHolder(domain, siteId) {
      return psql(`select deploy_target from public.sites where lower(domain) = lower(:'d') and id <> :'id'::uuid limit 1;`, { d: domain, id: siteId }) || null;
    },
    async activeKey(siteId) {
      const t = psql(`select vault_ref from service.active_key('site-signing', :'id'::uuid) where vault_ref is not null limit 1;`, { id: siteId });
      return t ? { vault_ref: t } : null;
    },
    async readKey(ref) {
      return psql(`select decrypted_secret from vault.decrypted_secrets where name = :'n';`, { n: ref });
    },
    // one transaction: the next free number for site-<workspace slug>-key-<n>, the Vault secret, the registry row, the site's ref
    async mintKey(site) {
      const value = randomBytes(32).toString('hex');
      const hash = createHash('sha256').update(value).digest('hex');
      const name = psql(`begin;
select coalesce(max((regexp_match(n, '-key-([0-9]+)$'))[1]::int), 0) + 1 as next_n from (
  select name as n from vault.secrets where name like 'site-' || :'slug' || '-key-%'
  union all select vault_ref from public.api_keys where vault_ref like 'site-' || :'slug' || '-key-%') x \\gset
select 'site-' || :'slug' || '-key-' || :'next_n' as key_name \\gset
select vault.create_secret(:'k', :'key_name', 'lead signing key, site ' || :'site') as secret_id \\gset
insert into public.api_keys (site_id, workspace_id, kind, label, key_hash, vault_ref, scope)
  select s.id, s.workspace_id, 'site-signing', :'slug' || ' lead key (client-infra)', :'hash', :'key_name', jsonb_build_object('site', s.id)
  from public.sites s where s.id = :'site'::uuid;
update public.sites set signing_key_ref = :'key_name' where id = :'site'::uuid;
commit;
select vault_ref from public.api_keys where vault_ref = :'key_name' and key_hash = :'hash';`, { slug: site.workspace_slug, site: site.id, hash }, { k: value });
      if (!/^site-[a-z0-9-]+-key-\d+$/.test(name)) throw new Error('the key was not stored (no registry row read back)');
      return { vault_ref: name, value };
    },
    async setDomain(siteId, domain) {
      // scoped by the site's id (the primary key, so at most one row); anything but exactly 1 changed row fails
      const t = psql(`with c as (update public.sites set domain = :'d' where id = :'id'::uuid and domain is null returning 1) select count(*) from c;`, { d: domain, id: siteId });
      if (t !== '1') throw new Error(`sites.domain was not set: ${t} rows changed, expected 1 (already set by someone else?)`);
    },
    async clearDomain(siteId, domain) {   // proof clean-up only: exactly the one test row, or nothing
      allowedOnly(domain);
      const t = psql(`with c as (update public.sites set domain = null where id = :'id'::uuid and lower(domain) = lower(:'d') returning 1) select count(*) from c;`, { d: domain, id: siteId });
      if (t !== '1') throw new Error(`clearing sites.domain changed ${t} rows, expected 1`);
    },
  };

  const cf = {
    getProject: (name) => pages('GET', `/${name}`),
    createProject: (name, branch) => pages('POST', '', { name, production_branch: branch }),
    setEnvVars: (name, env, vars) => pages('PATCH', `/${name}`, { deployment_configs: { [env]: { env_vars: vars } } }),
    listDomains: async (name) => (await pages('GET', `/${name}/domains`)) || [],
    addDomain: (name, host) => { allowedOnly(host); return pages('POST', `/${name}/domains`, { name: host }); },
    getDomain: (name, host) => pages('GET', `/${name}/domains/${host}`),
    deleteDomain: (name, host) => { allowedOnly(host); return pages('DELETE', `/${name}/domains/${host}`); },
    // offboarding (offboard.mjs, a marked workspace's own project): the host is detached only when that project lists it; no DNS
    detachDomain: async (name, host) => {
      const on = (await pages('GET', `/${name}/domains`)) || [];
      if (!on.some((x) => x.name === host)) throw new Error(`${host} is not a custom domain of ${name}; nothing detached`);
      return pages('DELETE', `/${name}/domains/${encodeURIComponent(host)}`);
    },
    deleteProject: async (name) => {
      if (!(await pages('GET', `/${name}`))) throw new Error(`Pages project ${name} does not exist; nothing deleted`);
      return pages('DELETE', `/${name}`);
    },
    dnsRecords: async (zone, host) => {
      const id = await zoneId(zone);
      return (await call(dnsToken, 'GET', `/zones/${id}/dns_records?name=${encodeURIComponent(host)}&per_page=100`)) || [];
    },
    createCname: async (zone, host, target) => {
      allowedOnly(host);
      const id = await zoneId(zone);
      return call(dnsToken, 'POST', `/zones/${id}/dns_records`, { type: 'CNAME', name: host, content: target, proxied: true, ttl: 1, comment: 'tools/client-infra test host (work order 35)' });
    },
    deleteCname: async (zone, host, recordId) => {   // proof clean-up only: the one record of the allowed host, re-read first
      allowedOnly(host);
      const id = await zoneId(zone);
      const r = await call(dnsToken, 'GET', `/zones/${id}/dns_records/${recordId}`);
      if (!r || r.name !== host || r.type !== 'CNAME') throw new Error(`record ${recordId} is not the CNAME of ${host}; not deleted`);
      return call(dnsToken, 'DELETE', `/zones/${id}/dns_records/${recordId}`);
    },
    zoneRecords: async (zone) => {   // the whole list, for the before/after snapshot (read only)
      const id = await zoneId(zone);
      const all = [];
      for (let page = 1; page <= 50; page++) {
        const r = await call(dnsToken, 'GET', `/zones/${id}/dns_records?per_page=100&page=${page}`);
        all.push(...(r || []));
        if (!r || r.length < 100) break;
      }
      return all;
    },
  };

  return { db, cf, log, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), scrub };
}
