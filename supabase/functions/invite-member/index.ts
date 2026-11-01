// invite-member: "Invite" under People on the Settings screen (DP-1.6-02; slice 5.2). Body { workspace, email, role: 'owner' | 'member', team_row?: uuid }.
// Owner or staff only; the database decides, in this order:
//   1. service.find_login (404 S-NOT-FOUND unless the caller is an owner of the workspace or staff with MFA, and the team profile, when named, is one of this
//      workspace's team rows) answers the login that already has this email, or nothing. This runs BEFORE anything is created: a member or an outsider
//      can never make a login through this function.
//   2. No login yet: the Auth admin API creates it with generate_link of type invite (POST <SUPABASE_URL>/auth/v1/admin/generate_link, the secret key).
//      That call creates the user and SENDS NOTHING. The link it returns is dropped on the spot: never stored, logged or returned.
//   3. service.set_member(workspace, user, role, team_row) makes them a member (the walls: an owner cannot demote themselves while they are the last one,
//      409 S-LAST-OWNER; the audit row `member-set`).
// Answers 200 { user, invited: true, email_sent: false }. EMAIL IS NOT SENT: no email sender exists yet (an owner-batch item, decision D5). When the sender
// exists, the invite mail plugs in right after step 3: send the sign-in link of that address (the page says who invited them and to which business,
// DP-1.2-10) and return email_sent: true. Until then the person is a member who signs in with their own email (the sign-in link screen sends the mail).
import { dashboard, badBody, type Ctx } from '../_shared/dashboard.ts';
import { EMAIL, Fields, json, problem } from '../_shared/http.ts';

export type AdminDeps = { fetchImpl?: typeof fetch };

/** Creates the login through the Auth admin API and returns its id, or null when Auth did not (the link in the answer is never read). */
async function createLogin(email: string, fetchImpl: typeof fetch): Promise<string | null> {
  const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
  if (!base || !key) return null;
  try {
    const r = await fetchImpl(`${base}/auth/v1/admin/generate_link`, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'invite', email }), signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) { console.error('invite: auth admin answered', r.status); await r.body?.cancel(); return null; }
    const j = await r.json();
    const id = j?.user?.id ?? j?.id;
    return typeof id === 'string' ? id : null;
  } catch (e) { console.error('invite: auth admin failed', String(e).slice(0, 120)); return null; }
}

export function makeHandle(deps: AdminDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return async (req: Request): Promise<Response> => await dashboard(req, 'invite-member', async (c: Ctx, d) => {
    const f = new Fields(d);
    const workspace = f.uuid('workspace'), team = f.uuid('team_row', false);
    const raw = f.str('email', { max: 254, required: true }), role = f.str('role', { max: 10, required: true });
    const email = raw ? raw.trim().toLowerCase() : null;
    if (email && !EMAIL.test(email)) f.problems.push({ code: 'EMAIL', path: 'email', msg: 'Enter an email like name@example.com' });
    if (role && role !== 'owner' && role !== 'member') f.problems.push({ code: 'ENUM', path: 'role', msg: 'Choose owner or member.' });
    if (f.problems.length || !workspace || !email || !role) return badBody(f.problems);
    c.workspace = workspace;
    const [found] = await c.sql`select service.find_login(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${email}, ${team}::uuid) as user_id`;
    let user: string | null = found.user_id;
    if (!user) {
      user = await createLogin(email, fetchImpl);
      if (!user) return problem(502, 'AUTH', 'Could not create the login right now. Please try again.');
    }
    await c.sql`select service.set_member(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${user}::uuid, ${role}::public.member_role, ${team}::uuid)`;
    return json(200, { user, invited: true, email_sent: false });
  });
}

export const handle = makeHandle();

if (import.meta.main) Deno.serve(handle);
