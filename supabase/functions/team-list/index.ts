// team-list: the People card of the Settings screen (DP-1.6-01; work order 08, migration 17 service.list_members). Body { workspace }.
// Owner or staff only; the database decides (404 S-NOT-FOUND for a member, another workspace's owner, a login of nothing, a workspace that does not exist).
// 200 { members: [{ user, email, role: 'owner' | 'member', team_row: uuid | null, name: string | null, joined: ISO time }] }, owners first.
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, json, serve } from '../_shared/http.ts';

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'team-list', async (c, d) => {
    const f = new Fields(d);
    const workspace = f.uuid('workspace');
    if (f.problems.length || !workspace) return badBody(f.problems);
    c.workspace = workspace;
    const rows = await c.sql`select user_id, email, role::text as role, team_row_id, team_name, joined_at from service.list_members(${c.jwtClaims}::jsonb, ${workspace}::uuid)`;
    return json(200, {
      members: rows.map((r: { user_id: string; email: string; role: string; team_row_id: string | null; team_name: string | null; joined_at: Date | string }) => ({
        user: r.user_id, email: r.email, role: r.role, team_row: r.team_row_id, name: r.team_name, joined: new Date(r.joined_at).toISOString(),
      })),
    });
  });
}

if (import.meta.main) serve('team-list', handle);
