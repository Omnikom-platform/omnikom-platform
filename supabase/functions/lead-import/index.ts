// lead-import: the client's own CRM file comes back as leads, through the saved map (work order 02 Settled 5 and 6). Owner only; a dry run first.
// Body { workspace, template, file: the CSV text (at most 1 MB, work order 02 F6), file_name, dry_run? (default true; only false imports), duplicates?: skip | add,
// consent?: true (the owner's tick "These people agreed to be contacted by my business"), date?: us | eu (how 03/04/2026 reads), timezone? (IANA) }.
// Steps: the user's JWT -> body (400) -> service.crm_fields (owner or staff; 404 outsider, 403 S-OWN-ONLY member; before the file is read) -> the map,
// read as the caller under RLS (another workspace's is not found, 404) -> parseCsv -> more than MAX_ROWS rows is refused whole (413, plain words; never
// cut short) -> importRows (the map's transforms and value maps) -> service.import_leads, the wall: every row typed as capture types, duplicates by
// email or E.164 phone against the workspace and the file; a dry run writes nothing; a real run needs the tick and a choice for duplicates and is
// all or nothing (422 I-IMPORT names the line and the field) -> 200 the report (dry run: rows, valid, new, refused, duplicates, warnings, the first 20
// rows as they would be stored; real run: rows, created, skipped).
// MAX_ROWS is measured, not guessed: parse + map of 1000, 2000 and 5000 rows in this harness (test/import-cpu.ts, docs/product/4-backend.md).
import { dashboard, badBody, type Ctx } from '../_shared/dashboard.ts';
import { asCaller } from '../_shared/db.ts';
import { Fields, json, problem, sha256Hex } from '../_shared/http.ts';
import { crmFields, importRows, parseCsv, SET_ON_IMPORT, type Template } from '../_shared/crm-map.ts';

// F6 (measured, test/import-cpu.ts): CPU follows the file's size, about 0.75 s per MB at worst; 1 MB holds 5000 typical rows under 0.4 s
export const MAX_FILE = 1024 * 1024;
export const MAX_ROWS = 5000;
type Lead = { name?: string; email?: string; phone?: string; status?: string; owner?: string; answers?: Record<string, unknown> };
type Warning = { row: number | null; header: string; message: string };

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'lead-import', async (c: Ctx, d) => {
    const f = new Fields(d);
    const workspace = f.uuid('workspace'), template = f.uuid('template'), file = f.str('file', { max: 2 * MAX_FILE, required: true });   // the size wall is the byte check below
    const fileName = f.str('file_name', { max: 200, required: true }), dryRun = f.bool('dry_run') ?? true, consent = f.bool('consent') ?? false;
    const duplicates = f.str('duplicates', { max: 10 }), date = f.str('date', { max: 4 }), timezone = f.str('timezone', { max: 60 });
    if (duplicates !== null && !['skip', 'add'].includes(duplicates)) f.problems.push({ code: 'ENUM', path: 'duplicates', msg: 'skip or add.' });
    if (date !== null && !['us', 'eu'].includes(date)) f.problems.push({ code: 'ENUM', path: 'date', msg: 'us or eu.' });
    if (f.problems.length || !workspace || !template || file === null || !fileName) return badBody(f.problems);
    c.workspace = workspace;
    await crmFields(c, workspace);   // owner only: a member or an outsider is refused before the file is read
    const [tpl] = await asCaller(c.sql, c.jwtClaims, (tx) =>
      tx`select t.id, t.name, t.crm, t.columns, t.value_maps from public.crm_templates t where t.id = ${template}::uuid and t.workspace_id = ${workspace}::uuid`) as Template[];
    if (!tpl) return problem(404, 'S-NOT-FOUND', 'Not found.');

    // bytes, not characters, and before anything is parsed: a bigger file would cost more CPU than the function has (F6)
    if (new TextEncoder().encode(file).length > MAX_FILE) {
      return problem(413, 'I-FILE', 'This file is over 1 MB; an import takes at most 1 MB and 5000 rows. Split the file and import each part.');
    }
    const parsed = parseCsv(file);
    if (!parsed.headers.length) return badBody([{ code: 'CSV', path: 'file', msg: 'The file has no header line.' }]);
    if (parsed.rows.length > MAX_ROWS) {
      return problem(413, 'I-ROWS', `This file has ${parsed.rows.length} rows; an import takes at most ${MAX_ROWS}. Split the file and import each part.`);
    }
    let mapped: { leads: Lead[]; sourceRows: number[]; warnings: Warning[] };
    try { mapped = importRows({ columns: tpl.columns, value_maps: tpl.value_maps }, parsed.rows, { date: date ?? undefined, timezone: timezone ?? undefined }); }
    catch (e) {
      const code = (/^(T-[A-Z-]+):/.exec(String((e as Error).message)) ?? [, 'T-COLUMNS'])[1] as string;
      return problem(422, code, code === 'T-TIMEZONE' ? 'Not a time zone we know (use a name like America/Los_Angeles).' : 'The saved map cannot read this file; save the map again.');
    }
    if (!mapped.leads.length) return badBody([{ code: 'CSV', path: 'file', msg: 'No row of the file has a value in a mapped column.' }]);
    // line numbers as the client sees them in a spreadsheet: the header is line 1, the first row line 2
    const rows = mapped.leads.map((l, i) => ({ line: mapped.sourceRows[i] + 2, name: l.name, email: l.email, phone: l.phone, status: l.status, owner: l.owner, answers: l.answers ?? {} }));
    const warnings = [
      ...parsed.warnings.map(message => ({ line: null, field: null, reason: message })),
      ...mapped.warnings.map(w => ({ line: w.row === null ? null : w.row + 2, field: w.header, reason: w.message })),
      ...tpl.columns.filter(col => SET_ON_IMPORT.includes(col.field)).map(col => ({ line: null, field: col.header, reason: 'not read on an import: an imported lead has form import and is received now' })),
    ];
    const opts = { dry_run: dryRun, duplicates, consent, file_name: fileName, file_sha256: await sha256Hex(file) };
    const [{ r }] = await c.sql`select service.import_leads(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${template}::uuid, ${JSON.stringify(rows)}::jsonb, ${JSON.stringify(opts)}::jsonb) as r`;
    const report = r as Record<string, unknown>;
    return json(200, { ...report, warnings: [...warnings, ...((report.warnings as unknown[] | undefined) ?? [])] });
  }, { maxBody: 2 * MAX_FILE + 64 * 1024 });   // JSON escapes line ends and quotes: the body of a 1 MB file can be up to twice its size
}

if (import.meta.main) Deno.serve(handle);
