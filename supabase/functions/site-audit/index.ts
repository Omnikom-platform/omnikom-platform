// site-audit: a site's search check, read back from its publish jobs (work order 10; migration 16 service.site_audit). Body { site }.
// Steps: the user's JWT -> body (400: site a uuid) -> service.site_audit (the owner of the site's workspace, or staff with MFA; a member, another
// workspace's owner or a site that does not exist gets 404 S-NOT-FOUND) -> 200 { latest: { preview, production }, history }.
// A row is { job, finished_at, state, target, pass, counts, summary }. latest.<target> is the newest finished job of that target whose audit summary
// is version 1 (summary = the whole summary, its fails included), or null; history is the last 10 finished jobs of the site, newest first, each
// without fails (summary null; a job from before the summary has pass and counts null).
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, json } from '../_shared/http.ts';

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'site-audit', async (c, d) => {
    const f = new Fields(d);
    const site = f.uuid('site');
    if (f.problems.length || !site) return badBody(f.problems);
    c.site = site;
    const [{ r }] = await c.sql`select service.site_audit(${c.jwtClaims}::jsonb, ${site}::uuid) as r`;
    return json(200, r);
  });
}

if (import.meta.main) Deno.serve(handle);
