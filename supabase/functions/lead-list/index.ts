// lead-list: the CRM's server list (work order 01; migration 14 service.lead_list). Body { workspace, search?, filters?, sort?, page?, size? }.
// Steps: the user's JWT -> body (400: workspace a uuid, search at most 200 characters, filters a list of at most 20, sort an object, page and size
// whole numbers) -> service.lead_list, which shows exactly the leads the caller may read (a member: its own; another workspace: none) and checks
// every sort and filter key against the contract's columns (422 S-QUERY otherwise; no caller text reaches SQL text) -> 200 { total, page, size,
// columns: [{ key, label, type, options, editable, ... }] in contract form order, fields (every industry field, for the export), rows: [{ id,
// created_at, name, email, phone, status, owner, form, page, site, follow_up, duplicate, duplicate_of, <column key>: typed value }] }.
// Work order 18 (migration 22): body `due: true` keeps the leads whose follow-up date or an open task's due time has come, `duplicates: true` the flagged ones;
// a row's duplicate_of is the other lead's id only when the caller may read that lead too (else null, with duplicate true).
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, json } from '../_shared/http.ts';

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'lead-list', async (c, d) => {
    const f = new Fields(d);
    const workspace = f.uuid('workspace'), search = f.str('search', { max: 200 }), page = f.int('page'), size = f.int('size');
    const due = f.bool('due'), duplicates = f.bool('duplicates');
    const filters = d.filters, sort = d.sort;
    if (filters !== undefined && !(Array.isArray(filters) && filters.length <= 20)) f.problems.push({ code: 'TYPE', path: 'filters', msg: 'A list of at most 20 filters.' });
    if (sort !== undefined && (sort === null || typeof sort !== 'object' || Array.isArray(sort))) f.problems.push({ code: 'TYPE', path: 'sort', msg: 'An object { field, dir }.' });
    if (f.problems.length || !workspace) return badBody(f.problems);
    c.workspace = workspace;
    const q: Record<string, unknown> = {};
    if (search) q.search = search;
    if (filters !== undefined) q.filters = filters;
    if (sort !== undefined) q.sort = sort;
    if (page !== null) q.page = page;
    if (size !== null) q.size = size;
    if (due !== null) q.due = due;
    if (duplicates !== null) q.duplicates = duplicates;
    const [{ r }] = await c.sql`select service.lead_list(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${q}::jsonb) as r`;
    return json(200, r);
  });
}

if (import.meta.main) Deno.serve(handle);
