// lead-export: the CRM's Export (DP-1.3-05; 15-CRM section 7; slice 5.2). Two body shapes:
//   { site, filter?: 'new' | 'all' | 'mine' | 'spam', q?: string }   block 1's: one site under the New / All / Mine / Spam filter (the CLI and the e2e files use it).
//   { workspace, search?, filters?, sort?, due?, duplicates?, template?, timezone? }    the CRM view (work orders 02 and 07; due and duplicates, work order 20): the leads exactly as service.lead_list shows them to the caller
//     (search over every column, filters and sort on any column, the same query as the screen), with the client's saved layout when `template` is given and, without it,
//     in block 1's one-column-per-field layout (the columns below). A body with `workspace` always takes this shape; `template` without `workspace` is a 400.
// What the caller gets is exactly what the database lets them read: the leads are selected on a connection that acts AS THE CALLER under Row Level
// Security (db.ts asCaller: role authenticated + their verified claims), never as the service role. An owner or staff reads every lead of the
// site, an agent only the leads assigned to them.
//   filter (default 'all'): new = status not-contacted; all = every status except spam; mine = assigned to me (their team profile), except spam; spam = spam.
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
import { Fields, problem } from '../_shared/http.ts';
import { exportRows, toCsv, type Template } from '../_shared/crm-map.ts';

export const MAX_ROWS = 5000;
const FILTERS = ['new', 'all', 'mine', 'spam'];
type Field = { key: string };
type Lead = { id: string; created_at: Date; name: string | null; email: string | null; phone: string | null; form: string; page_path: string; status: string; owner_team_row: string | null; answers: unknown };

/** maxRows: the cap of the export in a template's layout (a test injects a small one; the deployed function uses MAX_ROWS) */
export const makeHandle = (o: { maxRows?: number } = {}) => (req: Request) => serve(req, o.maxRows ?? MAX_ROWS);
export const handle = makeHandle();

async function serve(req: Request, maxRows: number): Promise<Response> {
  return await dashboard(req, 'lead-export', async (c: Ctx, d) => {
    if (d.template !== undefined || d.workspace !== undefined) return await inLayout(c, d, maxRows);   // work orders 02 and 07: the CRM view, in the client's layout or block 1's plain one
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
      const byFilter = filter === 'new' ? tx`and l.status = 'not-contacted'` : filter === 'spam' ? tx`and l.status = 'spam'`
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
    const csv = plainFile(leads, names, fields);
    return new Response(csv, { status: 200, headers: {
      'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store',
      'content-disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      ...(capped ? { 'x-omnikom-export-capped': String(MAX_ROWS) } : {}),
    } });
  });
}

/** block 1's file: the core columns, then every industry field of the contract in form order (the leads are in the order to write them) */
function plainFile(leads: Lead[], names: Map<string, string | null>, fields: Field[]): string {
  return csvLine(['received', 'name', 'email', 'phone', 'form', 'page', 'status', 'owner', ...fields.map(x => x.key)])
    + leads.map(l => { const a = (l.answers ?? {}) as Record<string, unknown>; return csvLine([l.created_at.toISOString(), l.name, l.email, l.phone, l.form, l.page_path, l.status,
      l.owner_team_row ? (names.get(l.owner_team_row) ?? l.owner_team_row) : '', ...fields.map(x => plain(a[x.key]))]); }).join('');
}

/** one answer as a spreadsheet cell: a list joined by "; ", a tick yes or no, anything else as text (csv.ts adds the formula guard) */
export function plain(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(x => String(x)).join('; ');
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

// ---------- work order 02 Settled 4: the export in the client's CRM layout ----------
// Body { workspace, template?, search?, filters?, sort?, timezone? (IANA; the day the us and eu date forms print) }; block 1's site, filter and q are not read.
// Without `template` (work order 07) the file is block 1's plain CSV of the same view: the same columns in the same order, the same cap and header, one `exported` event per lead.
// The set and its order are service.lead_list's: the same query as the CRM screen (search, filters, sort), exactly the leads RLS shows the caller,
// read 200 a page up to MAX_ROWS (X-Omnikom-Export-Capped beyond, the first MAX_ROWS of the view). The map and the leads are read as the caller
// (asCaller): a member exports with its workspace's map and only its own leads; another workspace's map is not found (404). exportRows writes the
// map's columns in its order (phones and dates in the client's form, value maps applied, industry fields as answers.<key>, owner as the team
// member's name); toCsv puts the formula guard on every cell. One `exported` event per lead (service.leads_exported, per site).
export const PAGE = 200;
type Full = { id: string; site_id: string | null; created_at: Date; name: string | null; email: string | null; phone: string | null; form: string; page_path: string;
  flow: string | null; cta: string | null; status: string; owner_team_row: string | null; answers: Record<string, unknown> | null };

async function inLayout(c: Ctx, d: Record<string, unknown>, maxRows: number): Promise<Response> {
  const f = new Fields(d);
  const workspace = f.uuid('workspace'), template = f.uuid('template', false), search = f.str('search', { max: 200 }), timezone = f.str('timezone', { max: 60 });
  const filters = d.filters, sort = d.sort;
  // work order 19 finding 4 (head's ruling H): the view's Due and Duplicates ticks are part of the view, so the file holds what the screen shows (service.lead_list reads both)
  for (const k of ['due', 'duplicates'] as const) if (d[k] !== undefined && typeof d[k] !== 'boolean') f.problems.push({ code: 'TYPE', path: k, msg: 'True or false.' });
  if (filters !== undefined && !(Array.isArray(filters) && filters.length <= 20)) f.problems.push({ code: 'TYPE', path: 'filters', msg: 'A list of at most 20 filters.' });
  if (sort !== undefined && (sort === null || typeof sort !== 'object' || Array.isArray(sort))) f.problems.push({ code: 'TYPE', path: 'sort', msg: 'An object { field, dir }.' });
  if (f.problems.length || !workspace) return badBody(f.problems);
  c.workspace = workspace;
  const tpl: Template | undefined = template ? ((await asCaller(c.sql, c.jwtClaims, (tx) =>
    tx`select t.id, t.name, t.crm, t.columns, t.value_maps from public.crm_templates t where t.id = ${template}::uuid and t.workspace_id = ${workspace}::uuid`)) as Template[])[0] : undefined;
  // no template: the caller must be able to see the workspace (RLS), as a site they cannot see is a 404 in block 1's shape; lead_list alone would answer an empty file
  const seen = template ? true : ((await asCaller(c.sql, c.jwtClaims, (tx) => tx`select w.id from public.workspaces w where w.id = ${workspace}::uuid`)) as unknown[]).length > 0;
  if (template ? !tpl : !seen) return problem(404, 'S-NOT-FOUND', 'Not found.');
  const q: Record<string, unknown> = { size: PAGE };
  if (search) q.search = search;
  if (filters !== undefined) q.filters = filters;
  if (sort !== undefined) q.sort = sort;
  if (d.due !== undefined) q.due = d.due;
  if (d.duplicates !== undefined) q.duplicates = d.duplicates;
  const ids: string[] = [];
  let total = 0;
  let fields: Field[] = [];
  for (let page = 1; ids.length < maxRows; page++) {
    const [{ r }] = await c.sql`select service.lead_list(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${{ ...q, page }}::jsonb) as r`;
    total = Number(r.total);
    if (page === 1) fields = (r.fields as Field[] | undefined) ?? [];   // the contract's industry fields in form order, the plain CSV's columns
    for (const row of r.rows as { id: string }[]) ids.push(row.id);
    if ((r.rows as unknown[]).length < PAGE || ids.length >= total) break;
  }
  const take = ids.slice(0, maxRows);
  const { leads, names } = await asCaller(c.sql, c.jwtClaims, async (tx) => {
    const rows: Full[] = take.length ? await tx`select l.id, l.site_id, l.created_at, l.name, l.email, l.phone, l.form, l.page_path, l.flow, l.cta, l.status, l.owner_team_row, l.answers
      from public.leads l where l.id = any(${take}::uuid[]) and l.workspace_id = ${workspace}::uuid` : [];
    const owners = [...new Set(rows.map(r => r.owner_team_row).filter((x): x is string => !!x))];
    const named: { id: string; name: string | null }[] = owners.length
      ? await tx`select c.id, v.data ->> 'name' as name from public.content_rows c
          join lateral (select x.data from public.content_versions x where x.row_id = c.id order by x.n desc limit 1) v on true where c.id = any(${owners}::uuid[])`
      : [];
    return { leads: rows, names: new Map(named.map(n => [n.id, n.name])) };
  });
  const byId = new Map(leads.map(l => [l.id, l]));
  const ordered = take.map(id => byId.get(id)).filter((l): l is Full => !!l);   // lead_list's order
  const ours = ordered.map(l => ({ name: l.name, email: l.email, phone: l.phone, form: l.form, page_path: l.page_path, flow: l.flow, cta: l.cta, status: l.status,
    created_at: l.created_at.toISOString(), owner: l.owner_team_row ? (names.get(l.owner_team_row) ?? '') : '',
    answers: Object.fromEntries(Object.entries(l.answers ?? {}).map(([k, v]) => [k, plain(v)])) }));
  let out: Record<string, string>[] = [];
  if (tpl) try { out = exportRows({ columns: tpl.columns, value_maps: tpl.value_maps }, ours, { timezone: timezone ?? undefined }); }
  catch (e) {
    const code = (/^(T-[A-Z-]+):/.exec(String((e as Error).message)) ?? [, 'T-COLUMNS'])[1] as string;
    return problem(422, code, code === 'T-TIMEZONE' ? 'Not a time zone we know (use a name like America/Los_Angeles).' : 'The saved map cannot write this export; save the map again.');
  }
  // the event comes after the read and before the file leaves, one call per site (service.leads_exported checks each lead again)
  const bySite = new Map<string, string[]>();
  for (const l of ordered) if (l.site_id) bySite.set(l.site_id, [...(bySite.get(l.site_id) ?? []), l.id]);
  for (const [site, list] of bySite) await c.sql`select service.leads_exported(${c.jwtClaims}::jsonb, ${site}::uuid, ${list}::uuid[])`;
  if (!tpl) {   // block 1's plain file from the same view
    return new Response(plainFile(ordered, names, fields), { status: 200, headers: {
      'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store',
      'content-disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      ...(total > maxRows ? { 'x-omnikom-export-capped': `${maxRows}` } : {}),
    } });
  }
  const csv = toCsv(out, tpl.columns.map(col => col.header));
  return new Response(csv, { status: 200, headers: {
    'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store',
    'content-disposition': `attachment; filename="leads-${tpl.crm}-${new Date().toISOString().slice(0, 10)}.csv"`,
    ...(total > maxRows ? { 'x-omnikom-export-capped': String(maxRows) } : {}),
  } });
}

if (import.meta.main) Deno.serve(handle);
