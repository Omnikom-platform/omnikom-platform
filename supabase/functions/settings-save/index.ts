// settings-save: the Settings screen's Save (DP-1.6-04 lead alerts, DP-1.6-05 the CRM connection; slice 5.2).
// Body { workspace, alerts?: { site, to: string[], assignee?: boolean }, crm?: { url: string | null } }; at least one of alerts and crm.
//   alerts -> service.set_alerts (owner or staff; at most 10 addresses after de-duplication, lower-cased; `assignee` null keeps the tick).
//             The site must belong to `workspace` (404 S-NOT-FOUND otherwise).
//   crm    -> a string: the host check first (netguard.ts: the name is resolved, A and AAAA, and any private, loopback, link-local or
//             unique-local answer refuses it, 422 I-URL; SQL cannot see DNS), then in ONE transaction: a fresh 32-byte signing secret into
//             Vault under crm-webhook-<workspace> (service.crm_secret_put, which derives the name itself), then service.set_crm_webhook with that
//             NAME (it checks the text of the address, I-URL, and stores the name, never the value). The secret is replaced on every save of an address.
//             null: the connection and its Vault secret are removed.
// Alerts and the connection are saved together or not at all. Answers 200 { alerts: boolean, crm: 'set' | 'removed' | null } (what this call changed);
// the screen reads the new values back through RLS. The secret value is never returned, logged or stored in a table: it leaves the database only
// in the signed request of crm-test.
import { dashboard, badBody, type Ctx } from '../_shared/dashboard.ts';
import { recordEvent } from '../_shared/db.ts';
import { Fields, json, problem } from '../_shared/http.ts';
import { hostProblem, systemResolve, type Resolve } from '../_shared/netguard.ts';

const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');

export function makeHandle(deps: { resolve?: Resolve } = {}) {
  const resolve = deps.resolve ?? systemResolve;
  return async (req: Request): Promise<Response> => await dashboard(req, 'settings-save', async (c: Ctx, d) => {
    const f = new Fields(d);
    const workspace = f.uuid('workspace');
    const a = f.obj('alerts', false), k = f.obj('crm', false);
    let alerts: { site: string; to: string[]; assignee: boolean | null } | null = null;
    if (a) {
      const g = new Fields(a);
      const site = g.uuid('site'), assignee = g.bool('assignee');
      const to = a.to;
      if (!Array.isArray(to)) g.problems.push({ code: 'TYPE', path: 'to', msg: 'Must be a list of email addresses.' });
      else if (to.length > 100) g.problems.push({ code: 'LENGTH', path: 'to', msg: 'At most 100.' });
      else if (!to.every(x => typeof x === 'string' && x.length <= 320)) g.problems.push({ code: 'TYPE', path: 'to', msg: 'Each address must be text of at most 320 characters.' });
      for (const p of g.problems) f.problems.push({ ...p, path: `alerts.${p.path}` });
      if (site && !g.problems.length) alerts = { site, to: a.to as string[], assignee };
    }
    let crm: { url: string | null } | null = null;
    if (k) {
      const raw = k.url;
      if (raw === null) crm = { url: null };
      else if (typeof raw === 'string' && raw.trim() !== '' && raw.length <= 2000) crm = { url: raw.trim() };
      else f.problems.push({ code: 'TYPE', path: 'crm.url', msg: 'Must be a web address of at most 2000 characters, or null to remove the connection.' });
    }
    if (!a && !k) f.problems.push({ code: 'REQUIRED', path: 'alerts', msg: 'Send alerts, crm, or both.' });
    if (f.problems.length || !workspace) return badBody(f.problems);
    c.workspace = workspace;
    if (alerts) {
      c.site = alerts.site;
      const [{ ws }] = await c.sql`select service.site_for(${c.jwtClaims}::jsonb, ${alerts.site}::uuid) as ws`;
      if (ws !== workspace) throw new Error('S-NOT-FOUND: the site is not in this workspace');   // refused like any wall: 404 and a security event
    }
    if (crm && crm.url !== null) {
      let u: URL | null = null;
      try { u = new URL(crm.url); } catch { /* refused below */ }
      const why = u && u.protocol === 'https:' ? await hostProblem(u.hostname, resolve) : 'Use a public web address that starts with https://.';
      if (why) {
        await recordEvent(c.sql, 'refused', 'I-URL', { workspace, actor: c.sub, fn: c.fn });
        return problem(422, 'I-URL', why);
      }
    }
    await c.sql.begin(async (tx: typeof c.sql) => {
      if (alerts) await tx`select service.set_alerts(${c.jwtClaims}::jsonb, ${alerts.site}::uuid, ${alerts.to}::text[], ${alerts.assignee}::boolean)`;
      if (crm && crm.url === null) {
        await tx`select service.set_crm_webhook(${c.jwtClaims}::jsonb, ${workspace}::uuid, null::text, null::text)`;
        await tx`select service.crm_secret_drop(${c.jwtClaims}::jsonb, ${workspace}::uuid)`;
      } else if (crm) {
        const [{ name }] = await tx`select service.crm_secret_put(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${hex(32)}) as name`;
        await tx`select service.set_crm_webhook(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${crm.url}, ${name})`;
      }
    });
    return json(200, { alerts: alerts !== null, crm: crm ? (crm.url === null ? 'removed' : 'set') : null });
  });
}

export const handle = makeHandle();

if (import.meta.main) Deno.serve(handle);
