// publish: the dashboard publishes a set of rows at the versions it shows (specs/openapi.json PublishRequest; 02-BACKEND sections 4, 6, 7).
// Steps: the user's JWT -> the body shape (400) -> service.site_for (the workspace of the site; 404 for a non-member) -> service.contract_for
// (404) -> for each row, its pinned version through service.row_version (404 when the row or the version is not this workspace's)
// and validateItem in publish mode (422 { problems }, every problem carries the row id) -> service.start_publish (it pins exactly these
// versions, N4; the walls: 403 S-OWN-ONLY / S-ROLE, 409 S-WORKSPACE-STATE, 422 S-KIND) -> GitHub workflow_dispatch of publish.yml
// { ref, inputs: { job_id, site_id } } (string inputs) -> 202 { job, state: 'queued', dispatched, reason }.
// dispatched: false (no token, GitHub refused, GitHub unreachable) is REPORTED, not hidden: the job stays queued and the reaper fails it
// after 24 hours. A missing version is 404 S-NOT-FOUND (service.row_version), the same answer as a row of another workspace.
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, json, problem, type FieldProblem } from '../_shared/http.ts';
import { RowValidator } from '../_shared/validate.ts';
import { dispatch } from '../_shared/dispatch.ts';

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'publish', async (c, d) => {
    const f = new Fields(d);
    const site = f.uuid('site'), rows = f.uuids('rows', 200), versions = f.ints('versions', 200);
    if (rows && versions && rows.length !== versions.length) f.problems.push({ code: 'LENGTH', path: 'versions', msg: 'One version for each row.' });
    if (f.problems.length || !site || !rows || !versions) return badBody(f.problems);
    c.site = site;
    const [{ ws }] = await c.sql`select service.site_for(${c.jwtClaims}::jsonb, ${site}::uuid) as ws`;
    c.workspace = ws;
    const [{ contract }] = await c.sql`select service.contract_for(${c.jwtClaims}::jsonb, ${ws}::uuid) as contract`;
    if (!contract) return problem(404, 'S-NOT-FOUND', 'Not found.');
    const validator = new RowValidator(c.sql, c.jwtClaims, ws, contract);
    const all: FieldProblem[] = [];
    for (let i = 0; i < rows.length; i++) {
      const [v] = await c.sql`select * from service.row_version(${c.jwtClaims}::jsonb, ${ws}::uuid, ${rows[i]}::uuid, ${versions[i]}::int)`;
      for (const p of await validator.check(v.collection, v.data, 'publish')) all.push({ ...p, row: rows[i] });
    }
    if (all.length) return problem(422, 'VALIDATION', 'Some items are not ready to publish.', all);
    const [{ job }] = await c.sql`select service.start_publish(${c.jwtClaims}::jsonb, ${site}::uuid, ${c.sql.array(rows)}::uuid[], ${c.sql.array(versions)}::int[]) as job`;
    const sent = await dispatch('publish', { job_id: job, site_id: site });
    return json(202, { job, state: 'queued', dispatched: sent.dispatched, reason: sent.reason });
  });
}

if (import.meta.main) Deno.serve(handle);
