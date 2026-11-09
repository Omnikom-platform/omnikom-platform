// settings-save: the Settings screen's Save on the Lead alerts card (DP-1.6-04, -10; slice 5.2, work order 08).
// Body { workspace, alerts: { site, to: string[], assignee?: boolean } }.
//   alerts -> service.set_alerts (owner or staff; at most 10 addresses after de-duplication, lower-cased; `assignee` null keeps the tick).
//             The site must belong to `workspace` (404 S-NOT-FOUND otherwise).
// Answers 200 { alerts: true }; the screen reads the new values back through RLS. There is no CRM part any more: leads leave as an export
// (docs/product/5-crm.md); a body without `alerts` is 400 REQUIRED, whatever else it carries.
import { dashboard, badBody, type Ctx } from '../_shared/dashboard.ts';
import { Fields, json } from '../_shared/http.ts';

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'settings-save', async (c: Ctx, d) => {
    const f = new Fields(d);
    const workspace = f.uuid('workspace');
    const a = f.obj('alerts', false);
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
    if (!a) f.problems.push({ code: 'REQUIRED', path: 'alerts', msg: 'Send alerts.' });
    if (f.problems.length || !workspace || !alerts) return badBody(f.problems);
    c.workspace = workspace;
    c.site = alerts.site;
    const [{ ws }] = await c.sql`select service.site_for(${c.jwtClaims}::jsonb, ${alerts.site}::uuid) as ws`;
    if (ws !== workspace) throw new Error('S-NOT-FOUND: the site is not in this workspace');   // refused like any wall: 404 and a security event
    await c.sql`select service.set_alerts(${c.jwtClaims}::jsonb, ${alerts.site}::uuid, ${alerts.to}::text[], ${alerts.assignee}::boolean)`;
    return json(200, { alerts: true });
  });
}

if (import.meta.main) Deno.serve(handle);
