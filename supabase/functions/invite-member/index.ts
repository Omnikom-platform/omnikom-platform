// invite-member: "Send invite" under People on the Settings screen (DP-1.6-02; slice 5.2, mail added by work order 08). Body { workspace, email, role: 'owner' | 'member', team_row?: uuid }.
// Owner or staff only; the database decides, in this order:
//   1. service.find_login (404 S-NOT-FOUND unless the caller is an owner of the workspace or staff with MFA, and the team profile, when named, is one of this
//      workspace's team rows) answers the login that already has this email, or nothing. This runs BEFORE anything is created: a member or an outsider
//      can never make a login through this function.
//   2. service.invite_context (the business's name and the inviter's name, for DP-email-10), then, with no login yet, the Auth admin API creates it with
//      generate_link of type invite (POST <SUPABASE_URL>/auth/v1/admin/generate_link, the secret key) with the same user data. That call creates the user and
//      SENDS NOTHING. The link it returns is dropped on the spot: never stored, logged or returned. Auth applies `data` only when it creates the login
//      (supabase/auth internal/api/invite.go, read 2026-11-04), which is why the data goes here and not only on the mail call below.
//   3. service.set_member(workspace, user, role, team_row) makes them a member (the walls: an owner cannot demote themselves while they are the last one,
//      409 S-LAST-OWNER; the audit row `member-set`).
//   4. Only now the mail, so a refused invite sends nothing: a NEW login (made unconfirmed in step 2) gets Auth's invite mail (POST /auth/v1/invite with
//      { email, data: { inviter, business } }; Auth resends the invite to an unconfirmed user, and answers 422 email_exists for a confirmed one; template
//      DP-email-08 to 12 reads the user data as {{ .Data.inviter }} and {{ .Data.business }}); a login that already existed and is confirmed (Auth's
//      record, GET /auth/v1/admin/users/<id>) gets the normal sign-in link mail (POST /auth/v1/otp, create_user false; it cannot name the inviter or the
//      business); one that exists but never opened its invite gets the invite again, after this business and inviter are put in its user data
//      (PUT /auth/v1/admin/users/<id>; when Auth refuses that, no mail: it would name another business). Auth unreadable: the sign-in mail.
//      Auth's own answer decides: 200 { user, invited: true, email_sent: true | false }. A mail that did not go (Auth down, its rate limit) does not
//      undo the membership: the person is a member and can ask for a sign-in link at /login.
import { dashboard, badBody, type Ctx } from '../_shared/dashboard.ts';
import { EMAIL, Fields, json, problem } from '../_shared/http.ts';

export type AdminDeps = { fetchImpl?: typeof fetch };

const base = () => (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const secretKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');

/** Creates the login through the Auth admin API and returns its id, or null when Auth did not (the link in the answer is never read). */
async function createLogin(email: string, data: Record<string, string>, fetchImpl: typeof fetch): Promise<string | null> {
  const key = secretKey();
  if (!base() || !key) return null;
  try {
    const r = await fetchImpl(`${base()}/auth/v1/admin/generate_link`, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'invite', email, data }), signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) { console.error('invite: auth admin answered', r.status); await r.body?.cancel(); return null; }
    const j = await r.json();
    const id = j?.user?.id ?? j?.id;
    return typeof id === 'string' ? id : null;
  } catch (e) { console.error('invite: auth admin failed', String(e).slice(0, 120)); return null; }
}

/** Asks Auth to send the mail; true only when Auth said it did (a 2xx). A new login: the invite mail with the two facts; an existing one: the sign-in link mail. */
async function sendMail(email: string, isNew: boolean, data: Record<string, string>, fetchImpl: typeof fetch): Promise<boolean> {
  const key = secretKey();
  if (!base() || !key) return false;
  try {
    const r = await fetchImpl(`${base()}/auth/v1/${isNew ? 'invite' : 'otp'}`, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify(isNew ? { email, data } : { email, create_user: false }), signal: AbortSignal.timeout(10000),
    });
    await r.body?.cancel();
    if (!r.ok) console.error('invite: auth mail answered', r.status);
    return r.ok;
  } catch (e) { console.error('invite: auth mail failed', String(e).slice(0, 120)); return false; }
}

/** Auth's own record of a login that exists: true when its address is confirmed, false when not, null when Auth did not answer
 *  (GET /auth/v1/admin/users/<id>; GoTrue omits email_confirmed_at until the address is confirmed: supabase/auth models/user.go). */
async function isConfirmed(id: string, fetchImpl: typeof fetch): Promise<boolean | null> {
  const key = secretKey();
  if (!base() || !key) return null;
  try {
    const r = await fetchImpl(`${base()}/auth/v1/admin/users/${id}`, { headers: { authorization: `Bearer ${key}`, apikey: key }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) { console.error('invite: auth user read answered', r.status); await r.body?.cancel(); return null; }
    const j = await r.json();
    return typeof j?.email_confirmed_at === 'string';
  } catch (e) { console.error('invite: auth user read failed', String(e).slice(0, 120)); return null; }
}

/** Puts this business and inviter in the user data of a login that exists, so the invite mail names them: Auth's invite to an existing login
 *  reads the data the login already holds (invite.go); PUT /auth/v1/admin/users/<id> merges user_metadata (user.go). True only when Auth took it. */
async function setInviteData(id: string, data: Record<string, string>, fetchImpl: typeof fetch): Promise<boolean> {
  const key = secretKey();
  if (!base() || !key) return false;
  try {
    const r = await fetchImpl(`${base()}/auth/v1/admin/users/${id}`, {
      method: 'PUT', headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' },
      body: JSON.stringify({ user_metadata: data }), signal: AbortSignal.timeout(10000),
    });
    await r.body?.cancel();
    if (!r.ok) console.error('invite: auth user data answered', r.status);
    return r.ok;
  } catch (e) { console.error('invite: auth user data failed', String(e).slice(0, 120)); return false; }
}

export function makeHandle(deps: AdminDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return async (req: Request): Promise<Response> => await dashboard(req, 'invite-member', async (c: Ctx, d) => {
    const f = new Fields(d);
    const workspace = f.uuid('workspace'), team = f.uuid('team_row', false);
    const raw = f.str('email', { max: 254, required: true }), role = f.str('role', { max: 10, required: true });
    const email = raw ? raw.trim().toLowerCase() : null;
    if (email && !EMAIL.test(email)) f.problems.push({ code: 'EMAIL', path: 'email', msg: 'Enter a full email address.' });
    if (role && role !== 'owner' && role !== 'member') f.problems.push({ code: 'ENUM', path: 'role', msg: 'Choose owner or member.' });
    if (f.problems.length || !workspace || !email || !role) return badBody(f.problems);
    c.workspace = workspace;
    const [found] = await c.sql`select service.find_login(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${email}, ${team}::uuid) as user_id`;
    let user: string | null = found.user_id;
    const isNew = !user;
    const [ctx] = await c.sql`select business, inviter from service.invite_context(${c.jwtClaims}::jsonb, ${workspace}::uuid)`;
    const data = { inviter: String(ctx?.inviter ?? ''), business: String(ctx?.business ?? '') };
    if (!user) {
      user = await createLogin(email, data, fetchImpl);
      if (!user) return problem(502, 'AUTH', 'Could not create the login right now. Please try again.');
    }
    await c.sql`select service.set_member(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${user}::uuid, ${role}::public.member_role, ${team}::uuid)`;
    // A login that exists but never opened its invite (not confirmed) gets the invite again, naming this business: Auth refuses it the sign-in
    // mail while sign-ups are off (supabase/auth 8872586: otp.go, magic_link.go, signup.go). Auth unreadable: the sign-in mail, as before.
    const resend = !isNew && (await isConfirmed(user, fetchImpl)) === false;
    const emailSent = resend ? (await setInviteData(user, data, fetchImpl)) && (await sendMail(email, true, data, fetchImpl)) : await sendMail(email, isNew, data, fetchImpl);
    return json(200, { user, invited: true, email_sent: emailSent });
  });
}

export const handle = makeHandle();

if (import.meta.main) Deno.serve(handle);
