// view-delete: the CRM deletes a saved view (work order 18; migration 22 service.view_delete). Body { view }. Steps: the user's JWT -> body (400: view a uuid)
// -> service.view_delete (the caller's own view, or an owner's for a shared one: 403 S-OWN-ONLY for a member on a shared view; 404 S-NOT-FOUND for a view
// that does not exist, another workspace's, or another person's private one) -> 204.
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, noContent } from '../_shared/http.ts';

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'view-delete', async (c, d) => {
    const f = new Fields(d);
    const view = f.uuid('view');
    if (f.problems.length || !view) return badBody(f.problems);
    await c.sql`select service.view_delete(${c.jwtClaims}::jsonb, ${view}::uuid)`;
    return noContent();
  });
}

if (import.meta.main) Deno.serve(handle);
