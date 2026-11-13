// publish: the dashboard publishes a set of rows at the versions it shows (specs/openapi.json PublishRequest; 02-BACKEND sections 4, 6, 7).
// Steps: the user's JWT -> the body shape (400) -> service.site_for (the workspace of the site; 404 for a non-member) -> service.contract_for
// (404) -> for each row, its pinned version through service.row_version (404 when the row or the version is not this workspace's)
// and validateItem in publish mode (422 { problems }, every problem carries the row id) -> service.start_publish (it pins exactly these
// versions, N4; the walls: 403 S-OWN-ONLY / S-ROLE, 409 S-WORKSPACE-STATE, 422 S-KIND) -> GitHub dispatch (`_shared/dispatch.ts`:
// workflow_dispatch with the new token, repository_dispatch while only the old one is set) of { job_id, site_id } -> 202 { job, state: 'queued', dispatched, reason }.
// { site, preview: true } (book row B15): service.start_preview (owners and staff): the drafts that pass the publish-ready wall, to the branch draft; 202 names the rest (left_out); none ready: 422 NOTHING-TO-PREVIEW.
// dispatched: false (no token, GitHub refused, GitHub unreachable) is REPORTED, not hidden: the job stays queued and the reaper fails it
// after 24 hours. A missing version is 404 S-NOT-FOUND (service.row_version), the same answer as a row of another workspace.
import { dashboard, badBody } from '../_shared/dashboard.ts';
import type { Sql } from '../_shared/db.ts';
import { Fields, json, problem, type FieldProblem, serve } from '../_shared/http.ts';
import { RowValidator } from '../_shared/validate.ts';
import { dispatch } from '../_shared/dispatch.ts';

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'publish', async (c, d) => {
    const f = new Fields(d), preview = d.preview === true, none = Array.isArray(d.rows) && d.rows.length === 0 && Array.isArray(d.versions) && d.versions.length === 0;   // book row B15: a preview names no rows; book row B12: removals only
    const site = f.uuid('site'), rows = preview || none ? [] : f.uuids('rows', 200), versions = preview || none ? [] : f.ints('versions', 200);
    if (rows && versions && rows.length !== versions.length) f.problems.push({ code: 'LENGTH', path: 'versions', msg: 'One version for each row.' });
    if (f.problems.length || !site || !rows || !versions) return badBody(f.problems);
    c.site = site;
    const [{ ws }] = await c.sql`select service.site_for(${c.jwtClaims}::jsonb, ${site}::uuid) as ws`;
    c.workspace = ws;
    const [{ contract }] = await c.sql`select service.contract_for(${c.jwtClaims}::jsonb, ${ws}::uuid) as contract`;
    if (!contract) return problem(404, 'S-NOT-FOUND', 'Not found.');
    if (preview) {   // book row B15: the ready drafts are built, the rest named; none ready: 422 naming them, and no job
      const [{ out }] = await c.sql`select service.start_preview(${c.jwtClaims}::jsonb, ${site}::uuid) as out`;
      const left = (out.left_out ?? []) as { row: string; collection: string; path: string }[];
      if (!out.job) return problem(422, 'NOTHING-TO-PREVIEW', 'Nothing can be previewed yet: no saved change is ready.', left.map(x => ({ code: 'I-NOT-READY', path: x.path, msg: 'Not filled in yet.', row: x.row })));
      const sent = await dispatch('publish', { job_id: out.job, site_id: site });
      return json(202, { job: out.job, state: 'queued', dispatched: sent.dispatched, reason: sent.reason, left_out: left });
    }
    const all = await problemsOf(c.sql, c.jwtClaims, ws, contract, rows, versions);
    if (all.length) return problem(422, 'VALIDATION', 'Some items are not ready to publish.', all);
    const [{ job }] = await c.sql`select service.start_publish(${c.jwtClaims}::jsonb, ${site}::uuid, ${c.sql.array(rows)}::uuid[], ${c.sql.array(versions)}::int[]) as job`;
    const sent = await dispatch('publish', { job_id: job, site_id: site });
    return json(202, { job, state: 'queued', dispatched: sent.dispatched, reason: sent.reason });
  });
}

/** E13-d: the problems of a publish in at most 3 statements, whatever the number of rows (rows [] of a removals-only publish: one, which
 *  finds nothing): every pinned version at once (service.row_version raises S-NOT-FOUND for a missing one, as the loop did), then every
 *  reference and every photo the rows mention (prefetch). */
export async function problemsOf(sql: Sql, jwtClaims: object, ws: string, contract: unknown, rows: string[], versions: number[]): Promise<FieldProblem[]> {
  const validator = new RowValidator(sql, jwtClaims, ws, contract);
  const all: FieldProblem[] = [];
  const pinned: { i: number; collection: string; data: unknown }[] = await sql`select x.i::int as i, v.collection, v.data
    from unnest(${sql.array(rows)}::uuid[], ${sql.array(versions)}::int[]) with ordinality as x(r, n, i)
    cross join lateral service.row_version(${jwtClaims}::jsonb, ${ws}::uuid, x.r, x.n) as v order by x.i`;
  await validator.prefetch(pinned, 'publish');
  for (const v of pinned) for (const p of await validator.check(v.collection, v.data, 'publish')) all.push({ ...p, row: rows[v.i - 1] });
  return all;
}

if (import.meta.main) serve('publish', handle);
