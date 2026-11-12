// view-save: the CRM saves a view (work order 18; migration 22 service.view_save). A view is a stored lead-list query plus an ordered column list.
// Body { workspace, id?, name, query?, columns?, shared? }. Steps: the user's JWT -> body (400: workspace and id uuids, name 1 to 60 characters, query an
// object, columns a list of at most 60 keys, shared yes or no) -> service.view_save, which checks the query with the very code lead_list uses (422 S-QUERY),
// every column key against the list's columns (400 I-ANSWER columns naming the key), the name (400 I-ANSWER name, also for a name already used), and the
// right to share: a member saves only their own (403 S-OWN-ONLY for a shared one); another person's private view, another workspace's view and a view
// that does not exist are all 404 S-NOT-FOUND -> 200 { view }. Views are listed by the dashboard with a plain select (row level security), not here.
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, json, serve } from '../_shared/http.ts';

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'view-save', async (c, d) => {
    const f = new Fields(d);
    const workspace = f.uuid('workspace'), id = f.uuid('id', false), name = f.str('name', { max: 60, required: true }), shared = f.bool('shared');
    const query = d.query === undefined ? {} : d.query, columns = d.columns === undefined ? [] : d.columns;
    if (query === null || typeof query !== 'object' || Array.isArray(query)) f.problems.push({ code: 'TYPE', path: 'query', msg: 'Must be an object like the lead list takes.' });
    if (!Array.isArray(columns) || columns.length > 60 || !columns.every(x => typeof x === 'string')) f.problems.push({ code: 'TYPE', path: 'columns', msg: 'A list of at most 60 column keys.' });
    if (f.problems.length || !workspace) return badBody(f.problems);
    c.workspace = workspace;
    const view = { ...(id ? { id } : {}), name, query, columns, shared: shared === true };
    const [{ saved }] = await c.sql`select service.view_save(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${view}::jsonb) as saved`;
    return json(200, { view: saved });
  });
}

if (import.meta.main) serve('view-save', handle);
