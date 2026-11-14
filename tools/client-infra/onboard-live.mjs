// The real calls behind onboard.mjs (tests use test/onboard-fakes.mjs). Names read from the environment, never printed:
// STAGING_DB_URL (psql), STAGING_SUPABASE_REF and the publishable key (functions), TEST_STAFF_TOTP_SECRET (the staff test login's
// MFA, through the CLI's personToken, the way supabase/tests/e2e-settings.mjs signs in). The CLI is called as a program, never edited.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
// repo and inboxes are passed in by onboard.mjs (importing it here would be a cycle that deadlocks its top-level await)
import { resolveTarget } from '../omnikom-cli/lib/target.mjs';
import { parseIdentity, personToken, claimsFor } from '../omnikom-cli/lib/identity.mjs';

export function onboardDeps({ log, repo: REPO, inboxes }) {
  if (!REPO || !Array.isArray(inboxes)) throw new Error('onboardDeps needs repo and inboxes');
  const dbUrl = process.env.STAGING_DB_URL;
  if (!dbUrl) throw new Error('set STAGING_DB_URL (read by name, never printed)');
  const scrub = (s) => String(s).split(dbUrl).join('[db]');
  const staff = parseIdentity('staff'), claims = JSON.stringify(claimsFor(staff));   // one identity: its claims open the window, its token makes the call
  const psql = (sql, vars = {}) => {
    const args = [dbUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A'];
    for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
    const r = spawnSync('psql', [...args, '-f', '-'], { encoding: 'utf8', input: sql, timeout: 60000, windowsHide: true });
    if (r.status !== 0) throw new Error(scrub(`psql exit ${r.status}: ${(r.stderr || r.error?.message || '').split('\n').slice(0, 3).join(' ')}`));
    return (r.stdout || '').trim();
  };

  const cli = {
    async seedWorkspace(a, dryRun) {
      const args = [join(REPO, 'tools', 'omnikom-cli', 'omnikom.mjs'), 'seed', 'workspace', '--slug', a.slug, '--name', a.name, '--industry', a.industry,
        '--deploy-target', a.deployTarget, '--preview-host', a.previewHost, '--contract', a.contract, '--target', 'staging', '--json', ...(dryRun ? ['--dry-run'] : [])];
      const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 180000, windowsHide: true });
      let j = null;
      try { j = JSON.parse(r.stdout); } catch { /* reported below */ }
      if (!j) return { ok: false, code: `exit ${r.status}, no JSON`, detail: scrub(`${r.stderr || r.stdout || ''}`).trim().split('\n').pop() };
      const dta = j.data || {};
      if (!j.ok) return { ok: false, code: j.code, detail: scrub(JSON.stringify(dta.problems || dta.message || dta).slice(0, 300)) };
      return { ok: true, code: j.code, changed: dta.changed === true, pages: dta.pages, places: dta.places,
        contractVersion: dta.stored && dta.stored.contract_version, pagesStored: dta.stored && dta.stored.pages };
    },
  };

  const db = {
    async getWorkspace(slug) {
      const t = psql(`select row_to_json(x) from (select w.id, (select s.deploy_target from public.sites s where s.workspace_id = w.id order by s.created_at limit 1) as deploy_target
        from public.workspaces w where w.slug = :'slug') x;`, { slug });
      return t ? JSON.parse(t) : null;
    },
    async rows(ws, collection) {   // live rows of a collection with their latest version's data
      const t = psql(`select coalesce(json_agg(x), '[]') from (select c.id, (select v.data from public.content_versions v where v.row_id = c.id order by v.n desc limit 1) as data
        from public.content_rows c where c.workspace_id = :'ws'::uuid and c.collection = :'coll' and c.deleted_at is null order by c.id) x;`, { ws, coll: collection });
      return JSON.parse(t);
    },
    async seedRow(ws, collection, data, ref) {
      const id = psql(`select service.seed_version(:'ws'::uuid, :'coll', :'data'::jsonb, (select user_id from public.staff order by created_at limit 1), :'ref');`,
        { ws, coll: collection, data: JSON.stringify(data), ref });
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error(`seed_version returned no row id for ${collection}`);
      return id;
    },
    // migration 43: onboard.mjs opens a window of 5 minutes around the invite and closes it after. The call itself is the staff TOKEN calling invite-member; the window is the staff login's own and holds for it
    async staffOpen(reason, minutes) { return psql(`select service.staff_open(:'claims'::jsonb, :'reason', :'min'::int);`, { claims, reason, min: minutes }); },
    async staffClose(until) {   // the window this call opened, by its end: exactly 1 row
      const n = psql(`with c as (update public.staff_access set until = now() where user_id = :'sub'::uuid and until = :'u'::timestamptz returning 1) select count(*) from c;`, { sub: staff.sub, u: until });
      if (n !== '1') throw new Error(`closing the staff window: ${n || 0} rows changed, expected 1`);   // the landed offboard-live.mjs wording
    },
    async memberByEmail(ws, email) {
      const t = psql(`select m.role::text from public.members m join auth.users u on u.id = m.user_id where m.workspace_id = :'ws'::uuid and lower(u.email) = lower(:'e');`, { ws, e: email });
      return t ? { role: t.split('\n')[0] } : null;
    },
  };

  const target = resolveTarget('staging', process.env, { needDb: false });
  async function invite(body) {
    if (!inboxes.includes(createHash('sha256').update(String(body.email).trim().toLowerCase()).digest('hex'))) throw new Error(`${body.email} is not a test inbox in test-inboxes.json; no mail sent`);
    if (!target.functionsBase) throw new Error('STAGING_SUPABASE_REF is not set (read by name)');
    const token = await personToken(staff, { target, env: process.env });
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
    const pub = process.env[target.vars.publishableKey];
    if (pub) headers.apikey = pub;
    const res = await fetch(`${target.functionsBase.replace(/\/$/, '')}/invite-member`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, text: text.split(token).join('[token]'), json };
  }

  async function provision({ site, domain, dryRun }) {
    const args = [join(REPO, 'tools', 'client-infra', 'provision.mjs'), '--site', site, ...(domain ? ['--domain', domain] : []), ...(dryRun ? ['--dry-run'] : [])];
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 20 * 60000, windowsHide: true });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  }

  return { cli, db, invite, provision, log };
}
