// unpublish: Delete, Take off the site and Put back on an item in the editor (book row B12; DP-1.4-21, -23, -24). { row } deletes, { row, off: true } takes it off the site,
// { row, back: true } puts it back -> 204. service.unpublish / service.put_back (migrations 8, 45): owner or staff of the ROW's workspace only (anyone else, another workspace's
// row or none: 404 S-NOT-FOUND, a security event). Deleted or taken off, it leaves the live site at the next publish (the job carries it); taken off, it stays listed, marked.
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, noContent, serve } from '../_shared/http.ts';

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'unpublish', async (c, d) => {
    const f = new Fields(d);
    const row = f.uuid('row');
    const off = f.bool('off'), back = f.bool('back');
    if (f.problems.length || !row) return badBody(f.problems);
    if (back) { await c.sql`select service.put_back(${c.jwtClaims}::jsonb, ${row}::uuid)`; return noContent(); }
    if (off) { await c.sql`select service.unpublish(p_claims => ${c.jwtClaims}::jsonb, p_row => ${row}::uuid, p_delete => false)`; return noContent(); }
    await c.sql`select service.unpublish(${c.jwtClaims}::jsonb, ${row}::uuid, true)`;
    return noContent();
  });
}

if (import.meta.main) serve('unpublish', handle);
