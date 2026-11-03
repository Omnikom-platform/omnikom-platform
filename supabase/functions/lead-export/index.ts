// lead-export: "Export CSV" under the lead filter (DP-1.3-05; 15-CRM section 7; slice 5.2). Body { site, filter?: 'new' | 'all' | 'mine' | 'spam', q?: string }.
// What the caller gets is exactly what the database lets them read: the leads are selected on a connection that acts AS THE CALLER under Row Level
// Security (db.ts asCaller: role authenticated + their verified claims), never as the service role. An owner or staff reads every lead of the
// site, an agent only the leads assigned to them.
//   filter (default 'all'): new = status new; all = every status except spam; mine = assigned to me (their team profile), except spam; spam = spam.
//   q: matches name, email and phone, case-insensitive, once it is at least 2 characters (as the list does); shorter is ignored.
//   Newest first. At most 5000 rows: when there were more, the answer carries the header X-Omnikom-Export-Capped: 5000 and holds the newest 5000.
// Columns: received (UTC, ISO), name, email, phone, form, page, status, owner (the team member's name), then every industry field of the contract as its
// own column, keyed as in the contract and in contract form order (work order 01: service.lead_list's `fields`, the database's one list; no answers
// cell). A multi choice is its values joined by "; ", a tick is yes or no, a number is plain; a field the lead has no value for is empty. Cells that start with
// = + - @ get a leading quote (csv.ts). Then service.leads_exported writes one `exported` event per lead the caller could read (and refuses with 404
// S-NOT-FOUND a site the caller cannot see: an outsider gets no file). Answers text/csv with a Content-Disposition filename and no-store.
import { dashboard, badBody, type Ctx } from '../_shared/dashboard.ts';
import { asCaller } from '../_shared/db.ts';
import { csvLine } from '../_shared/csv.ts';
import { Fields } from '../_shared/http.ts';

export const MAX_ROWS = 5000;
const FILTERS = ['new', 'all', 'mine', 'spam'];
type Field = { key: string };
type Lead = { id: string; created_at: Date; name: string | null; email: string | null; phone: string | null; form: string; page_path: string; status: string; owner_team_row: string | null; answers: unknown };

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'lead-export', async (c: Ctx, d) => {
    const f = new Fields(d);
    const site = f.uuid('site'), filter = f.str('filter', { max: 10 }) ?? 'all', q = (f.str('q', { max: 100 }) ?? '').trim();
    if (!FILTERS.includes(filter)) f.problems.push({ code: 'ENUM', path: 'filter', msg: 'Not a lead filter.' });
    if (f.problems.length || !site) return badBody(f.problems);
    c.site = site;
    const pattern = q.length >= 2 ? '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%' : null;
    const { leads, names, capped, ws } = await asCaller(c.sql, c.jwtClaims, async (tx) => {
      const [s] = await tx`select s.workspace_id from public.sites s where s.id = ${site}::uuid`;
      const [m] = filter === 'mine'
        ? await tx`select m.team_row_id from public.members m join public.sites s on s.workspace_id = m.workspace_id where s.id = ${site}::uuid and m.user_id = ${c.sub}::uuid`
        : [{ team_row_id: null }];
      const byFilter = filter === 'new' ? tx`and l.status = 'new'` : filter === 'spam' ? tx`and l.status = 'spam'`
        : filter === 'mine' ? tx`and l.status <> 'spam' and l.owner_team_row = ${m?.team_row_id ?? null}::uuid` : tx`and l.status <> 'spam'`;
      const byText = pattern ? tx`and (l.name ilike ${pattern} or l.email ilike ${pattern} or l.phone ilike ${pattern})` : tx``;
      const rows: Lead[] = await tx`select l.id, l.created_at, l.name, l.email, l.phone, l.form, l.page_path, l.status, l.owner_team_row, l.answers
        from public.leads l where l.site_id = ${site}::uuid ${byFilter} ${byText} order by l.created_at desc, l.id limit ${MAX_ROWS + 1}`;
      const owners = [...new Set(rows.map(r => r.owner_team_row).filter((x): x is string => !!x))];
      const named: { id: string; name: string | null }[] = owners.length
        ? await tx`select c.id, v.data ->> 'name' as name from public.content_rows c
            join lateral (select x.data from public.content_versions x where x.row_id = c.id order by x.n desc limit 1) v on true where c.id = any(${owners}::uuid[])`
        : [];
      return { leads: rows.slice(0, MAX_ROWS), names: new Map(named.map(n => [n.id, n.name])), capped: rows.length > MAX_ROWS, ws: (s?.workspace_id as string | undefined) ?? null };
    });
    // the event comes after the read and before the file leaves: a site the caller cannot see is refused here, with no file
    await c.sql`select service.leads_exported(${c.jwtClaims}::jsonb, ${site}::uuid, ${leads.map(l => l.id)}::uuid[])`;
    // the industry fields, in form order, from the same function the list uses (a caller who cannot see the workspace gets none, and 404 above)
    const fields: Field[] = ws ? (((await c.sql`select service.lead_list(${c.jwtClaims}::jsonb, ${ws}::uuid, '{"size":1}'::jsonb) as r`)[0].r as { fields?: Field[] }).fields ?? []) : [];
    const csv = csvLine(['received', 'name', 'email', 'phone', 'form', 'page', 'status', 'owner', ...fields.map(x => x.key)])
      + leads.map(l => { const a = (l.answers ?? {}) as Record<string, unknown>; return csvLine([l.created_at.toISOString(), l.name, l.email, l.phone, l.form, l.page_path, l.status,
        l.owner_team_row ? (names.get(l.owner_team_row) ?? l.owner_team_row) : '', ...fields.map(x => plain(a[x.key]))]); }).join('');
    return new Response(csv, { status: 200, headers: {
      'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store',
      'content-disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      ...(capped ? { 'x-omnikom-export-capped': String(MAX_ROWS) } : {}),
    } });
  });
}

/** one answer as a spreadsheet cell: a list joined by "; ", a tick yes or no, anything else as text (csv.ts adds the formula guard) */
export function plain(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(x => String(x)).join('; ');
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

if (import.meta.main) Deno.serve(handle);
