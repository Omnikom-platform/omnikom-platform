// add-lead: the dashboard adds a lead by hand (a phone call, a walk-in; slice 4.2; migration 7 service.add_lead).
// Steps: the user's JWT -> body { site, name?, email?, phone?, answers?, consentText, form?, owner? } (400: email format and lengths as
// capture-lead; the consent wording is required) -> service.add_lead (workspace from the site; a member's lead lands on the member's own
// team row whatever `owner` says; consent ledger written) -> 201 { lead }.
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, json, EMAIL, SLUG } from '../_shared/http.ts';

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'add-lead', async (c, d) => {
    const f = new Fields(d);
    const site = f.uuid('site'), consent = f.str('consentText', { max: 2000, required: true }), owner = f.uuid('owner', false);
    const name = f.str('name', { max: 120 }), email = f.str('email', { max: 320 }), phone = f.str('phone', { max: 40 }), form = f.str('form', { max: 60 });
    const answers = f.obj('answers', false);
    if (email && !EMAIL.test(email)) f.problems.push({ code: 'EMAIL', path: 'email', msg: 'Enter an email like name@example.com' });
    if (form && !SLUG.test(form)) f.problems.push({ code: 'FORM', path: 'form', msg: 'Unknown form.' });
    if (f.problems.length || !site || !consent) return badBody(f.problems);
    c.site = site;
    const [{ lead }] = await c.sql`select service.add_lead(${c.jwtClaims}::jsonb, ${site}::uuid, ${name}, ${email}, ${phone}, ${answers ?? {}}::jsonb, ${consent}, ${form ?? 'manual'}, ${owner}::uuid) as lead`;
    return json(201, { lead });
  });
}

if (import.meta.main) Deno.serve(handle);
