// unpublish: Delete on an item in the editor (book row B12; DP-1.4-21, -23). Body { row } -> 204. service.unpublish(claims,
// row, true) (migration 8): owner or staff of the ROW's workspace only (anyone else, another workspace's row or none: 404 S-NOT-FOUND, a security
// event); soft-deleted, off the site with the next publish, versions kept, one audit row. Off without delete is not offered (drafts_waiting relists it).
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, noContent } from '../_shared/http.ts';

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'unpublish', async (c, d) => {
    const f = new Fields(d);
    const row = f.uuid('row');
    if (f.problems.length || !row) return badBody(f.problems);
    await c.sql`select service.unpublish(${c.jwtClaims}::jsonb, ${row}::uuid, true)`;
    return noContent();
  });
}

if (import.meta.main) Deno.serve(handle);
