// leads-bulk: one action on many leads (work order 01; migration 14 service.leads_bulk). Body { workspace, ids: uuid[] (1 to 500), action: 'status' |
// 'owner' | 'delete', value?: a status key of the business's own list (work order 20), a team row id or null, confirm?: true }. A single delete (A9) is a bulk of one.
// Steps: the user's JWT -> body (400) -> service.leads_bulk: all or nothing (an id the caller may not act on, of another workspace or that does not
// exist: 404 S-NOT-FOUND and nothing written); owner and delete are for an owner (403 S-OWN-ONLY); delete is the hard delete, as privacy requires,
// and is refused without confirm: true (409 S-CONFIRM); one audit row per deleted lead, the consent ledger kept -> 200 { changed }.
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, json, UUID, SLUG } from '../_shared/http.ts';

const ACTIONS = ['status', 'owner', 'delete'];

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'leads-bulk', async (c, d) => {
    const f = new Fields(d);
    const workspace = f.uuid('workspace'), ids = f.uuids('ids', 500), action = f.str('action', { max: 10, required: true }), confirm = f.bool('confirm');
    let value: string | null = null;
    if (action && !ACTIONS.includes(action)) f.problems.push({ code: 'ENUM', path: 'action', msg: 'status, owner or delete.' });
    if (ids && ids.length === 0) f.problems.push({ code: 'REQUIRED', path: 'ids', msg: 'Pick at least one lead.' });
    if (action === 'status') {
      if (typeof d.value !== 'string' || d.value.length > 40 || !SLUG.test(d.value)) f.problems.push({ code: 'ENUM', path: 'value', msg: 'Not a lead status.' }); else value = d.value;
    } else if (action === 'owner') {
      if (d.value !== null && d.value !== undefined && !(typeof d.value === 'string' && UUID.test(d.value))) f.problems.push({ code: 'UUID', path: 'value', msg: 'A team member, or nobody.' });
      else value = (d.value as string | null | undefined) ?? null;
    }
    if (f.problems.length || !workspace || !ids || !action) return badBody(f.problems);
    c.workspace = workspace;
    const [{ n }] = await c.sql`select service.leads_bulk(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${ids}::uuid[], ${action}, ${value}, ${confirm === true}) as n`;
    return json(200, { changed: n });
  });
}

if (import.meta.main) Deno.serve(handle);
