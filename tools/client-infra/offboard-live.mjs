// The real calls behind offboard.mjs (tests use test/offboard-fakes.mjs). Names read from the environment, never printed:
// STAGING_DB_URL (psql), STAGING_SUPABASE_REF and STAGING_SUPABASE_SECRET_KEY (Storage reads), and through live.mjs the
// Cloudflare Pages token and account. The database functions are called with the staff test identity's claims, the way the CLI's
// `omnikom lead delete` calls service.delete_lead (tools/omnikom-cli/commands/lead.mjs). Every value travels to psql in the stdin
// text (\set), never in argv: a privacy subject is a person's address.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { resolveTarget } from '../omnikom-cli/lib/target.mjs';
import { parseIdentity, claimsFor } from '../omnikom-cli/lib/identity.mjs';
import { liveDeps } from './live.mjs';

const BY = 'tools/client-infra/offboard.mjs';
const NAME_RE = /^[a-z_][a-z0-9_]*$/;

// The top folder of the git working tree that holds dir (or its nearest existing parent), or null.
export function gitTop(dir) {
  let d = resolve(dir);
  while (!existsSync(d) && dirname(d) !== d) d = dirname(d);
  if (existsSync(d) && !statSync(d).isDirectory()) d = dirname(d);
  const r = spawnSync('git', ['-C', d, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

export function offboardDeps({ log }) {
  const dbUrl = process.env.STAGING_DB_URL;
  if (!dbUrl) throw new Error('set STAGING_DB_URL (read by name, never printed)');
  const target = resolveTarget('staging', process.env, { needDb: false });
  const secret = process.env[target.vars.secretKey];
  const staff = parseIdentity('staff');
  const claims = JSON.stringify(claimsFor(staff));
  const { cf: cfBase, scrub: cfScrub } = liveDeps({ log, allowed: [] });
  const scrub = (s) => cfScrub(String(s).split(dbUrl).join('[db]').split(secret || '\u0000').join('[hidden]'));

  const quote = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/\r?\n/g, '\\n')}'`;
  const psql = (sql, vars = {}) => {
    const head = Object.entries(vars).map(([k, v]) => `\\set ${k} ${quote(v)}\n`).join('');
    const r = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'],
      { encoding: 'utf8', input: head + sql, timeout: 300000, maxBuffer: 1024 * 1024 * 1024, windowsHide: true });
    if (r.status !== 0) throw new Error(scrub(`psql exit ${r.status}: ${(r.stderr || r.error?.message || '').split('\n').slice(0, 3).join(' ')}`));
    return (r.stdout || '').trim();
  };
  const one = (sql, vars, what) => { const t = psql(sql, vars); if (t !== '1') throw new Error(`${what}: ${t || 0} rows changed, expected 1`); };

  // The workspace's own tables: every public table with a workspace_id column, plus two that hang off one (no workspace_id).
  let tableList = null;
  const tables = () => {
    if (!tableList) {
      const t = psql(`select coalesce(json_agg(c.relname order by c.relname), '[]') from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped);`);
      const names = JSON.parse(t);
      if (!names.length || names.some((x) => !NAME_RE.test(x))) throw new Error('the table list is empty or holds an unexpected name');
      if (names.length > 45) throw new Error(`${names.length} tables: jsonb_build_object takes at most 100 arguments; split the export query`);
      tableList = [
        ...names.map((n) => ({ name: n, from: `public."${n}" x where x.workspace_id = :'ws'::uuid` })),
        { name: 'lead_reads', from: `public.lead_reads x where x.lead_id in (select id from public.leads where workspace_id = :'ws'::uuid)` },
        { name: 'publish_job_events', from: `public.publish_job_events x where x.job_id in (select id from public.publish_jobs where workspace_id = :'ws'::uuid)` },
      ];
    }
    return tableList;
  };

  const db = {
    async workspace(slug) {
      const t = psql(`select row_to_json(w) from (select id, slug, name, state::text as state, state_changed_at, state_reason from public.workspaces where slug = :'slug') w;`, { slug });
      return t ? JSON.parse(t) : null;
    },
    async staffOk() { return psql(`select exists (select 1 from public.staff where user_id = :'sub'::uuid);`, { sub: staff.sub }) === 't'; },
    async setState(ws, state, reason) {
      psql(`select service.set_workspace_state(:'claims'::jsonb, :'ws'::uuid, :'st'::public.workspace_state, :'reason');`, { claims, ws, st: state, reason: `${reason} (${BY})` });
    },
    async ticket(id) {
      const t = psql(`select row_to_json(r) from (select id, workspace_id, kind::text as kind, state::text as state, subject, lead_ids from public.privacy_requests where id = :'id'::uuid) r;`, { id });
      return t ? JSON.parse(t) : null;
    },
    // the request's listed leads that still exist, and any lead matching the subject: the email as service.open_privacy_request
    // matches it, a number by its last 10 digits (that function compares all digits, so a country code hides a lead)
    async subjectLeads(ws, subject, ids) {
      return JSON.parse(psql(`select coalesce(json_agg(l.id order by l.id), '[]') from public.leads l where l.workspace_id = :'ws'::uuid and (l.id = any(:'ids'::uuid[])
        or lower(btrim(coalesce(l.email, ''))) = lower(btrim(:'s'))
        or (right(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g'), 10) = right(regexp_replace(:'s', '[^0-9]', '', 'g'), 10) and length(regexp_replace(:'s', '[^0-9]', '', 'g')) >= 7));`,
      { ws, s: subject, ids: `{${ids.join(',')}}` }));
    },
    async deleteLead(id, reason) { psql(`select service.delete_lead(:'claims'::jsonb, :'id'::uuid, :'reason');`, { claims, id, reason }); },
    async setTicket(id, state, notes) {
      psql(`select service.set_privacy_request_state(:'claims'::jsonb, :'id'::uuid, :'st'::public.privacy_request_state, nullif(:'notes', ''));`, { claims, id, st: state, notes: notes || '' });
    },
    // every table of the workspace (privacy_requests aside: it keeps the address to answer the person) for the email or the number
    async scan(ws, key) {
      const cond = key.email ? `strpos(lower(x::text), :'em') > 0` : `x::text ~ :'re'`;
      const parts = [...tables().filter((t) => t.name !== 'privacy_requests'), { name: 'workspaces', from: `public.workspaces x where x.id = :'ws'::uuid` }]
        .map((t) => `select '${t.name}' as t, count(*) as n from ${t.from} and ${cond}`);
      const t = psql(`select coalesce(json_agg(json_build_object('table', t, 'n', n) order by t), '[]') from (${parts.join('\nunion all ')}) z where n > 0;`,
        { ws, ...(key.email ? { em: key.email } : { re: key.digits.split('').join('[-. ()+]{0,3}') }) });
      return JSON.parse(t);
    },
    async exportPlan(ws) {
      const parts = tables().map((t) => `select count(*) as n from ${t.from}`);
      const t = psql(`select json_build_object('rows', (select sum(n) from (${parts.join(' union all ')}) z), 'tables', ${tables().length},
        'logins', (select count(*) from public.members where workspace_id = :'ws'::uuid),
        'files', (select count(*) from storage.objects where bucket_id = 'media' and name like :'ws' || '/%'));`, { ws });
      return JSON.parse(t);
    },
    // all rows (api_keys without key_hash), and each table's count(*) as a separate figure the export is checked against
    async exportData(ws) {
      const tablesSql = tables().map((t) => `'${t.name}', (select coalesce(json_agg(j order by j::text), '[]') from (select to_jsonb(x) - 'key_hash' as j from ${t.from}) s)`);
      const countsSql = tables().map((t) => `'${t.name}', (select count(*) from ${t.from})`);
      const t = psql(`select json_build_object(
        'workspace', (select to_jsonb(w) from public.workspaces w where w.id = :'ws'::uuid),
        'tables', jsonb_build_object(${tablesSql.join(',\n')}),
        'counts', jsonb_build_object(${countsSql.join(',\n')}),
        'logins', (select coalesce(json_agg(json_build_object('user_id', m.user_id, 'email', u.email, 'role', m.role) order by u.email), '[]')
                   from public.members m join auth.users u on u.id = m.user_id where m.workspace_id = :'ws'::uuid));`, { ws });
      return JSON.parse(t);
    },
    async sites(ws) {
      return JSON.parse(psql(`select coalesce(json_agg(json_build_object('id', id, 'deploy_target', deploy_target, 'domain', domain) order by created_at), '[]') from public.sites where workspace_id = :'ws'::uuid;`, { ws }));
    },
    async clearSiteDomain(site, domain) {   // by the site id and its current domain: exactly 1 row, with its audit row
      one(`with c as (update public.sites set domain = null where id = :'id'::uuid and domain = :'d' returning workspace_id),
        a as (insert into public.audit_log (workspace_id, actor, action, target, detail) select workspace_id, :'actor'::uuid, 'site-domain-detach', :'id', jsonb_build_object('domain', :'d', 'by', :'by') from c returning 1)
        select count(*) from a;`, { id: site, d: domain, actor: staff.sub, by: BY }, 'clearing sites.domain');
    },
    async activeKeys(site) {
      return JSON.parse(psql(`select coalesce(json_agg(json_build_object('id', id, 'vault_ref', vault_ref)), '[]') from service.active_key('site-signing', :'id'::uuid);`, { id: site }));
    },
    async revokeKey(site, key) {   // by the key id, of that site, still active: exactly 1 row, with its audit row
      one(`with c as (update public.api_keys set revoked_at = now() where id = :'k'::uuid and site_id = :'s'::uuid and kind = 'site-signing' and revoked_at is null returning workspace_id, vault_ref),
        a as (insert into public.audit_log (workspace_id, actor, action, target, detail) select workspace_id, :'actor'::uuid, 'key-revoke', :'k', jsonb_build_object('vault_ref', vault_ref, 'by', :'by') from c returning 1)
        select count(*) from a;`, { k: key, s: site, actor: staff.sub, by: BY }, 'revoking the key');
    },
    async audit(ws, action, target) {
      one(`with a as (insert into public.audit_log (workspace_id, actor, action, target, detail) values (:'ws'::uuid, :'actor'::uuid, :'act', :'t', jsonb_build_object('by', :'by')) returning 1) select count(*) from a;`,
        { ws, actor: staff.sub, act: action, t: target, by: BY }, 'the audit row');
    },
  };

  const storage = {
    async list(ws) {
      return JSON.parse(psql(`select coalesce(json_agg(json_build_object('name', name, 'size', (metadata->>'size')::bigint) order by name), '[]') from storage.objects where bucket_id = 'media' and name like :'ws' || '/%';`, { ws }));
    },
    async get(name) {
      if (!target.ref || !secret) throw new Error(`set STAGING_SUPABASE_REF and ${target.vars.secretKey} (read by name) to read Storage`);
      const url = `https://${target.ref}.supabase.co/storage/v1/object/media/${name.split('/').map(encodeURIComponent).join('/')}`;
      const r = await fetch(url, { headers: { apikey: secret, authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(120000) });
      if (r.status !== 200) throw new Error(scrub(`Storage GET media/${name}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`));
      return Buffer.from(await r.arrayBuffer());
    },
  };

  const cf = { getProject: cfBase.getProject, listDomains: cfBase.listDomains, detachDomain: cfBase.detachDomain, deleteProject: cfBase.deleteProject };
  const fs = {
    exists: (p) => existsSync(p),
    read: (p) => readFileSync(p),
    write: (p, b) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, b); },
  };
  return { db, storage, cf, fs, log };
}
