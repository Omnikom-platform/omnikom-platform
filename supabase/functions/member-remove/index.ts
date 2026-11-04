// member-remove: "Remove" under People on the Settings screen (DP-1.6-03, -12; work order 08). Body { workspace, user }.
// Owner or staff only, through service.remove_member (migration 8): never the last owner (409 S-LAST-OWNER), 404 S-NOT-FOUND for a member, another
// workspace's owner, a login of nothing or a person who is not a member; one audit row `member-remove`; the person's leads, edits and uploads stay.
// Open sessions are NOT ended: Supabase Auth has no admin logout by user id (api.go and GoTrueAdminApi.ts, read 2026-11-04). The wall does it: every
// request is checked against `members`, so the removed person's next request in this workspace is refused (tenancy.test.sql T24).
// 200 { removed: true }.
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, json } from '../_shared/http.ts';

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'member-remove', async (c, d) => {
    const f = new Fields(d);
    const workspace = f.uuid('workspace'), user = f.uuid('user');
    if (f.problems.length || !workspace || !user) return badBody(f.problems);
    c.workspace = workspace;
    await c.sql`select service.remove_member(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${user}::uuid)`;
    return json(200, { removed: true });
  });
}

if (import.meta.main) Deno.serve(handle);
