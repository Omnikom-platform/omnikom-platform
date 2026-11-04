// A test that needs a row makes its own (work order 07 fix 2): staging may hold no leads at all, so a screen test that waits for a first row
// must not rely on what an earlier session left behind. The lead is made by owner-a through add-lead (the way a person adds one by hand),
// named "<tag> <RUN> <label>", and removed by removeOwnLeads(tag) in the file's ONE test.afterAll, through leads-bulk with confirm.
// FLOWS_MUTANT=no-own-lead skips the add-lead (see tests/mutants.ts): every test that needs a row must then go red for want of one.
import { expect } from '@playwright/test';
import { active } from '../mutants';
import { callAs, PEOPLE, personAccessToken, RUN, serviceGet, WS } from './staging';

export type OwnLead = { name: string };

/** One lead for a test, owned by nobody (owner-a sees it) or by member-a1's team row (member-a1 sees it). */
export async function makeOwnLead(tag: string, label: string, forAgent = false): Promise<OwnLead> {
  const name = `${tag} ${RUN} ${label}`;
  if (active('no-own-lead')) return { name };
  let owner: string | null = null;
  if (forAgent) {
    const members = await serviceGet<{ user_id: string; team_row_id: string | null }[]>(`/members?workspace_id=eq.${WS.a.id}&select=user_id,team_row_id`);
    owner = members.find(m => m.user_id === PEOPLE['member-a1'].id)?.team_row_id ?? null;
    expect(owner, 'the seeded member-a1 has a team row (omnikom seed test)').toBeTruthy();
  }
  const token = await personAccessToken('owner-a');
  const r = await callAs(token, 'add-lead', {
    site: WS.a.site, name, email: `${tag.replace(/\W+/g, '.')}.${RUN}.${label.replace(/\W+/g, '.')}@example.com`, phone: '(555) 010-0162',
    answers: {}, consentText: 'The person agreed to be contacted', form: 'manual', ...(owner ? { owner } : {}),
  });
  expect(r.status, `add-lead (${name}) answered ${r.status}: ${r.text.slice(0, 160)}`).toBe(201);
  return { name };
}

/** Every lead this run made for that tag, removed (a failed removal fails the run: a lead left on staging is what this exists to stop). */
export async function removeOwnLeads(tag: string): Promise<void> {
  const made = await serviceGet<{ id: string }[]>(`/leads?workspace_id=eq.${WS.a.id}&name=like.${encodeURIComponent(`${tag} ${RUN} *`)}&select=id&limit=100`);
  if (!made.length) return;
  const token = await personAccessToken('owner-a');
  const r = await callAs(token, 'leads-bulk', { workspace: WS.a.id, ids: made.map(l => l.id), action: 'delete', confirm: true });
  console.log(`${tag} cleanup: ${made.length} lead(s), leads-bulk answered ${r.status}`);
  expect(r.status, `removing the ${tag} leads answered ${r.status}: ${r.text.slice(0, 200)}`).toBe(200);
}
