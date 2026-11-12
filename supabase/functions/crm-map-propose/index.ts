// crm-map-propose: propose how the columns of the client's own CRM file map to our lead fields (work order 02 Settled 2). Owner only; stores nothing.
// Body { workspace, headers: string[] (1 to 200) and rows?: their first rows (at most 20, objects keyed by header or arrays), or csv: the file's
// text (at most 1 MB; parsed with parseCsv, its first 20 rows are the samples) }.
// Steps: the user's JWT -> body (400) -> service.crm_fields (owner or staff; 404 S-NOT-FOUND outsider, 403 S-OWN-ONLY member) -> proposeMap(our fields,
// their headers, the samples) -> 200 { template: { columns: [{ header, field, transform? }], value_maps: {} }, scores: [{ header, field, score }],
// unmapped, splits, warnings }. A pair under 0.5 is never assigned (the library's rule); the client confirms the map with crm-template-save.
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, json, serve } from '../_shared/http.ts';
import { crmFields, ourFields, parseCsv, proposeMap } from '../_shared/crm-map.ts';

export const MAX_CSV = 1024 * 1024;
export const MAX_SAMPLE = 20;
type Col = { header: string; field: string; transform?: string; score: number };

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'crm-map-propose', async (c, d) => {
    const f = new Fields(d);
    const workspace = f.uuid('workspace'), csv = f.str('csv', { max: MAX_CSV });
    let headers = d.headers as string[] | undefined, rows = d.rows as unknown[] | undefined;
    if (d.csv != null && (headers !== undefined || rows !== undefined)) f.problems.push({ code: 'BODY', path: 'csv', msg: 'Send headers and rows, or a csv, not both.' });
    if (d.csv == null) {
      if (!Array.isArray(headers) || headers.length < 1 || headers.length > 200 || !headers.every(h => typeof h === 'string' && h.length <= 200))
        f.problems.push({ code: 'TYPE', path: 'headers', msg: 'A list of 1 to 200 headers, each at most 200 characters.' });
      if (rows !== undefined && !(Array.isArray(rows) && rows.length <= MAX_SAMPLE && rows.every(r => r !== null && typeof r === 'object')))
        f.problems.push({ code: 'TYPE', path: 'rows', msg: `At most ${MAX_SAMPLE} sample rows.` });
    }
    if (f.problems.length || !workspace) return badBody(f.problems);
    c.workspace = workspace;
    const fields = await crmFields(c, workspace);   // the owner check comes before any parsing
    const warnings: string[] = [];
    if (csv !== null) {
      const p = parseCsv(csv);
      if (!p.headers.length) return badBody([{ code: 'CSV', path: 'csv', msg: 'The file has no header line.' }]);
      headers = p.headers; rows = p.rows.slice(0, MAX_SAMPLE); warnings.push(...p.warnings);
    }
    const m = proposeMap(ourFields(fields), headers as string[], rows ?? []);
    const cols = m.columns as Col[];
    return json(200, {
      template: { columns: cols.map(({ score: _s, ...col }) => col), value_maps: {} },
      scores: cols.map(x => ({ header: x.header, field: x.field, score: x.score })),
      unmapped: m.unmapped, splits: m.splits, warnings: [...warnings, ...m.warnings],
    });
  }, { maxBody: 2 * MAX_CSV + 64 * 1024 });   // JSON escapes line ends and quotes: the body of a 1 MB file can be up to twice its size

}

if (import.meta.main) serve('crm-map-propose', handle);
