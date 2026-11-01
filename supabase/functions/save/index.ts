// save: the dashboard saves one item (specs/openapi.json SaveRequest; 02-BACKEND section 6; slice 4.2).
// Steps: the user's JWT (_shared/dashboard.ts) -> the body shape (400 BODY) -> service.contract_for FIRST (a non-member gets 404 here,
// before any field name or limit could be revealed; dry run 2 N1) -> validateItem in draft mode with the database's answers for
// references and photos (422 { problems }, a validation is NOT a security event) -> service.save_as (the walls: 403 S-OWN-ONLY,
// S-LOCKED, S-ROLE, S-SIGNOFF; 409 S-SINGLETON; 404; 409 S-STALE) -> 200 { row, version }.
// Slice 5.2: the body carries `base`, the version the editor started from (a whole number). It is required when `row` is set (400 BODY without
// it); for a new row it is optional and, when sent, must be 0. It goes to service.save_as as p_base, which refuses a save on top of a newer
// version with 409 S-STALE (the database's sentence: the row id and the newest version).
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, json, problem } from '../_shared/http.ts';
import { RowValidator } from '../_shared/validate.ts';

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'save', async (c, d) => {
    const f = new Fields(d);
    const workspace = f.uuid('workspace'), collection = f.str('collection', { max: 80, required: true }), row = f.uuid('row', false), data = f.obj('data');
    const so = f.obj('signOff', false);
    let signOff: { by: string; ref: string } | null = null;
    if (so) {
      const g = new Fields(so);
      const by = g.str('by', { max: 200, required: true }), ref = g.str('ref', { max: 400, required: true });
      for (const p of g.problems) f.problems.push({ ...p, path: `signOff.${p.path}` });
      if (by && ref) signOff = { by, ref };
    }
    const base = f.int('base');
    if (base !== null && base < 0) f.problems.push({ code: 'RANGE', path: 'base', msg: 'Must be 0 or more.' });
    if (row && base === null && !f.problems.some(p => p.path === 'base')) f.problems.push({ code: 'REQUIRED', path: 'base', msg: 'This is needed.' });
    if (f.problems.length || !workspace || !collection || !data) return badBody(f.problems);
    c.workspace = workspace;
    const [{ contract }] = await c.sql`select service.contract_for(${c.jwtClaims}::jsonb, ${workspace}::uuid) as contract`;
    if (!contract) return problem(404, 'S-NOT-FOUND', 'Not found.');
    const problems = await new RowValidator(c.sql, c.jwtClaims, workspace, contract).check(collection, data, 'draft');
    if (problems.length) return problem(422, 'VALIDATION', 'Some fields need attention.', problems);
    const [saved] = await c.sql`select * from service.save_as(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${collection}, ${row}::uuid, ${data}::jsonb, ${signOff}::jsonb, ${base}::int)`;
    return json(200, { row: saved.row_id, version: saved.version });
  });
}

if (import.meta.main) Deno.serve(handle);
