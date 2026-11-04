// crm-template-save: the client confirms the map (work order 02 Settled 3). Owner only.
// Body { workspace, id?, name, crm (a slug: hubspot, google-contacts, custom), direction?: export | import | both (default both), columns:
// [{ header, field, transform? }], value_maps? }.
// Steps: the user's JWT -> body (400) -> service.crm_fields (owner or staff; 404 outsider, 403 S-OWN-ONLY member) -> validateTemplate (the library's
// rules) and every transform known (422 T-* with fixed words) -> every industry field the map names is on this business's forms (422 T-FIELD naming the
// field) -> service.save_crm_template (the same rules in the database, which is the wall; one map per workspace and name: a re-save of a name is the
// same row, updated) -> 200 { template }.
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, json, problem, SLUG } from '../_shared/http.ts';
import { crmFields, exportRows, templateProblems, validateTemplate } from '../_shared/crm-map.ts';

const DIRECTIONS = ['export', 'import', 'both'];

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'crm-template-save', async (c, d) => {
    const f = new Fields(d);
    const workspace = f.uuid('workspace'), id = f.uuid('id', false), name = f.str('name', { max: 120, required: true }), crm = f.str('crm', { max: 60, required: true });
    const direction = f.str('direction', { max: 10 }) ?? 'both';
    if (crm && !SLUG.test(crm)) f.problems.push({ code: 'SLUG', path: 'crm', msg: 'Lower-case words joined by dashes, like hubspot.' });
    if (!DIRECTIONS.includes(direction)) f.problems.push({ code: 'ENUM', path: 'direction', msg: 'export, import or both.' });
    if (d.value_maps !== undefined && (d.value_maps === null || typeof d.value_maps !== 'object' || Array.isArray(d.value_maps))) f.problems.push({ code: 'TYPE', path: 'value_maps', msg: 'Must be an object.' });
    if (f.problems.length || !workspace || !name || !crm) return badBody(f.problems);
    c.workspace = workspace;
    const fields = await crmFields(c, workspace);   // owner only, before anything else is looked at
    const template = { columns: d.columns, value_maps: d.value_maps ?? {} };
    let problems = validateTemplate(template) as string[];
    if (!problems.length) { try { exportRows(template, []); } catch (e) { problems = [String((e as Error).message)]; } }   // an unknown transform throws T-TRANSFORM
    if (problems.length) return problem(422, 'T-COLUMNS', 'The map is not valid.', templateProblems(problems));
    const ours = new Set(fields.map(x => x.key));
    const cols = template.columns as { field: string }[];
    const missing = cols.map((col, i) => ({ i, key: col.field.startsWith('answers.') ? col.field.slice(8) : null })).filter(x => x.key !== null && !ours.has(x.key));
    if (missing.length) {
      return problem(422, 'T-FIELD', 'The map names a field this business does not have.', missing.map(x => ({ code: 'T-FIELD', path: `columns.${x.i}.field`,
        msg: /^[a-z][a-zA-Z0-9_]{0,60}$/.test(x.key as string) ? `"${x.key}" is not a field of this business's forms.` : 'This is not a field of this business\'s forms.' })));
    }
    const [{ t }] = await c.sql`select service.save_crm_template(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${id}::uuid, ${name}, ${crm}, ${direction},
      ${{ v: template.columns }}::jsonb -> 'v', ${template.value_maps}::jsonb) as t`;   // objects, never JSON text (capture-lead, slice 4.3); a bare JS array would be sent as a Postgres array
    return json(200, { template: t });
  });
}

if (import.meta.main) Deno.serve(handle);
