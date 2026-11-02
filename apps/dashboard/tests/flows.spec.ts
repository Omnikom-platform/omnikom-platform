// The three step-5.3 flows, against the STAGING project, in Edge, with the built dashboard (vite preview on localhost).
// Each finds things by role and label, never by a class. Signed-in states come from tests/global-setup.ts (the email-link path).
// Test data: only leads on the test site of workspace A, each marked {"test": "5.3 flows"} in its answers (or, for the one the
// browser form makes, in its name and notes: that form has no field for answers). Nothing else on staging is changed.
// The leads this run made are removed in the afterAll below (slice 5-CL), through service.delete_lead, by the ids found for this run.
import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { callAs, leadLabel, PEOPLE, personAccessToken, RUN, serviceGet, supabaseHost, TEST_MARK, WS } from './support/staging';
import { active, installMutant } from './mutants';

const CLI = resolve(import.meta.dirname, '..', '..', '..', 'tools', 'omnikom-cli', 'omnikom.mjs');
const CLEAN_LEADS = resolve(import.meta.dirname, 'support', 'clean-flow-leads.mjs');

type LeadRow = { id: string; name: string | null; email: string | null; phone: string | null; status?: string };

/** Every response body the page got from the Supabase project, so a test can prove what did NOT come back. */
function watchSupabase(page: Page) {
  const host = supabaseHost();
  const pending: Promise<string>[] = [];
  page.on('response', r => {
    if (new URL(r.url()).host !== host) return;
    const where = `${r.request().method()} ${new URL(r.url()).pathname}`;
    pending.push(r.text().then(t => `${where} ${t}`, () => where));
  });
  return async () => (await Promise.all(pending)).join('\n');
}

function expectNone(haystack: string, needles: string[], where: string) {
  for (const n of needles.filter(Boolean)) expect(haystack.includes(n), `${where} must not contain ${n}`).toBe(false);
}

// Every lead this run made (all named "5.3 flows <RUN> ..."), found with the service role and removed through the platform's own deletion.
// A failed removal fails the run: a lead left on staging is exactly what this hook exists to stop.
test.afterAll(async () => {
  const made = await serviceGet<{ id: string }[]>(`/leads?site_id=eq.${WS.a.site}&name=like.${encodeURIComponent(`5.3 flows ${RUN}*`)}&select=id&limit=100`);
  if (!made.length) return;
  const out = spawnSync(process.execPath, [CLEAN_LEADS, '--apply', '--ids', made.map(l => l.id).join(',')], { encoding: 'utf8', env: process.env, timeout: 120_000, windowsHide: true });
  console.log(`flows cleanup: ${(out.stdout || '').trim().split('\n').pop()}`);
  expect(out.status, `removing the ${made.length} flows lead(s) answered ${out.status}: ${(out.stdout || out.stderr || '').trim().slice(0, 300)}`).toBe(0);
});

const radio = (page: Page, name: string) => page.getByRole('radio', { name: new RegExp(`^${name}\\b`) });
const leadsLoaded = (page: Page) => expect(page.getByRole('link', { name: 'Add a lead' })).toBeVisible();
const notFound = (page: Page) => expect(page.getByText('Not found', { exact: true })).toBeVisible();

test.describe('a member of A cannot open B', () => {
  test.use({ storageState: '.auth/member-a1.json' });

  test('member-a1 gets Not found for B\'s workspace and B\'s lead, with no B data in the page or in any response', async ({ page }) => {
    await installMutant(page, 'leak-b');
    const bodies = watchSupabase(page);

    const bLeads = await serviceGet<LeadRow[]>(`/leads?workspace_id=eq.${WS.b.id}&select=id,name,email,phone&limit=5`);
    // workspace B has a real lead on staging (added by owner-b through omnikom lead add); without one this flow would prove less
    expect(bLeads.length, 'staging workspace B must have at least one lead for the "B\'s lead URL" step').toBeGreaterThan(0);
    const bLeadId = bLeads[0]!.id;
    const bMarkers = [WS.b.id, WS.b.site, WS.b.name, PEOPLE['owner-b'].id, PEOPLE['owner-b'].email, ...bLeads.flatMap(l => [l.id, l.name ?? '', l.email ?? '', l.phone ?? ''])];

    // the positive control: the same login reads its own business, so "Not found" below is the wall, not a broken app
    await page.goto(`/w/${WS.a.slug}/leads`);
    await leadsLoaded(page);
    await expect(page.getByRole('navigation')).toContainText(WS.a.name);

    await page.goto(`/w/${WS.b.slug}/leads`);
    await notFound(page);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    expectNone(await page.locator('body').innerText(), bMarkers, 'the page of B\'s workspace');

    await page.goto(`/w/${WS.b.slug}/leads/${bLeadId}`);
    await notFound(page);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    expectNone(await page.locator('body').innerText(), bMarkers, 'the page of B\'s lead');

    // B's lead id under A's address is still not readable: the database says no rows, the panel says Not found
    await page.goto(`/w/${WS.a.slug}/leads/${bLeadId}`);
    await notFound(page);
    expectNone(await page.locator('body').innerText(), bMarkers, 'A\'s address with B\'s lead id');

    await page.waitForLoadState('networkidle');
    expectNone(await bodies(), bMarkers, 'a response from the project');
  });
});

test.describe('a lead appears live', () => {
  test.use({ storageState: '.auth/owner-a.json' });

  test('owner-a has Leads open; a lead sent to the test site the way omnikom lead send does appears without a reload within 15 s', async ({ page }) => {
    await installMutant(page, 'no-live');
    await page.goto(`/w/${WS.a.slug}/leads`);
    await leadsLoaded(page);
    await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true; });
    if (active('no-live')) await page.waitForTimeout(4000);   // let the closed socket be noticed
    else await expect(page.locator('[data-live="live"]')).toBeVisible({ timeout: 20_000 });

    const name = `5.3 flows ${RUN} live`;
    const dir = mkdtempSync(join(tmpdir(), 'dash-flows-'));
    try {
      const fixture = join(dir, 'lead.json');
      writeFileSync(fixture, JSON.stringify({
        form: 'contact', flow: 'contact', page: '/5-3-flows', cta: '5.3 flows', name,
        email: `flows.${RUN}@example.com`, phone: '(555) 010-0153',
        answers: { ...TEST_MARK, run: RUN, message: 'Sent by the dashboard flows. Synthetic. Safe to ignore.' },
        consentText: 'I agree that the business may contact me about this request by email, phone or text.',
        marketingConsent: { given: false, text: 'marketing wording' }, hp: '',
      }));
      // the very command a person runs: it signs with the test site's key and posts to capture-lead (no signing is redone here)
      const sent = spawnSync(process.execPath, [CLI, 'lead', 'send', '--site', WS.a.site, '--as', 'site:test-demo-a', '--target', 'staging', '--fixture', fixture, '--real', '--key', randomUUID(), '--json'],
        { encoding: 'utf8', env: process.env, timeout: 90_000, windowsHide: true });
      const out = JSON.parse(sent.stdout || '{}') as { ok?: boolean; code?: string | number; data?: { attempts?: { status: number }[] } };
      console.log(`lead send: ok=${out.ok} code=${out.code} statuses=${(out.data?.attempts ?? []).map(a => a.status).join(',')}`);
      expect(out.ok, 'omnikom lead send must succeed').toBe(true);
      const t0 = Date.now();

      await expect(page.getByRole('link', { name })).toBeVisible({ timeout: 15_000 });
      console.log(`the lead appeared ${((Date.now() - t0) / 1000).toFixed(1)} s after the send returned`);
      await expect(page.locator('tbody tr').first()).toContainText(name);
      await expect(page).toHaveTitle(/^\(\d+\) Leads$/);
      expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload), 'the page was not reloaded').toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe('a member sees only their leads', () => {
  test.use({ storageState: '.auth/member-a1.json' });

  test('member-a1 sees exactly the leads assigned to them (compared with the service role), and Add a lead makes one that is theirs', async ({ page }) => {
    await installMutant(page, 'member-sees-all');

    // set up, as owner-a, through add-lead: one lead for Agent One, one for Agent Two, one nobody owns
    const members = await serviceGet<{ user_id: string; team_row_id: string | null }[]>(`/members?workspace_id=eq.${WS.a.id}&select=user_id,team_row_id`);
    const rowOf = (id: string) => members.find(m => m.user_id === id)?.team_row_id ?? null;
    const one = rowOf(PEOPLE['member-a1'].id), two = rowOf(PEOPLE['member-a2'].id);
    expect(one && two, 'the seeded members have team rows (omnikom seed test)').toBeTruthy();
    const token = await personAccessToken('owner-a');
    const make = async (label: string, owner?: string | null) => {
      const r = await callAs(token, 'add-lead', {
        site: WS.a.site, name: `5.3 flows ${RUN} ${label}`, email: `flows.${RUN}.${label}@example.com`, phone: '(555) 010-0154',
        answers: { ...TEST_MARK, run: RUN }, consentText: 'The person agreed to be contacted', form: 'manual', ...(owner ? { owner } : {}),
      });
      expect(r.status, `add-lead (${label}) answered ${r.status}: ${r.text.slice(0, 120)}`).toBe(201);
    };
    await make('for-one', one);
    await make('for-two', two);
    await make('for-nobody');

    const expected = async () => {
      const rows = await serviceGet<LeadRow[]>(`/leads?workspace_id=eq.${WS.a.id}&owner_team_row=eq.${one}&select=id,name,email,phone,status&limit=500`);
      return rows.map(leadLabel).sort();
    };
    const shown = async (filter: string) => {
      await radio(page, filter).check();
      return page.locator('tbody th a').allInnerTexts();
    };

    await page.goto(`/w/${WS.a.slug}/leads`);
    await leadsLoaded(page);
    await expect(page.getByRole('link', { name: `5.3 flows ${RUN} for-one` })).toBeVisible();

    const everything = [...(await shown('All')), ...(await shown('Spam'))].sort();
    expect(everything, 'the leads on the screen (All + Spam) equal the leads the service role counts as owned by member-a1').toEqual(await expected());
    expect(everything).not.toContain(`5.3 flows ${RUN} for-two`);
    expect(everything).not.toContain(`5.3 flows ${RUN} for-nobody`);
    expect((await shown('Mine')).sort(), 'Mine is the same list for an agent (less the spam)').toEqual((await shown('All')).sort());
    await radio(page, 'All').check();

    // Add a lead: an agent's lead is always their own, and the screen does not offer an owner to pick
    await page.getByRole('link', { name: 'Add a lead' }).click();
    await expect(page.getByLabel('Notes')).toBeVisible();
    await expect(page.getByLabel('Owner')).toHaveCount(0);
    const mine = `5.3 flows ${RUN} added by member-a1`;
    await page.getByLabel('Name', { exact: true }).fill(mine);
    await page.getByLabel('Phone').fill('(555) 010-0155');
    await page.getByLabel('Email').fill(`flows.${RUN}.mine@example.com`);
    await page.getByLabel('Notes').fill('Test data from the 5.3 flows. Safe to ignore.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();   // the consent tick is required: first try without it
    await expect(page).toHaveURL(/\/leads\/new$/);
    await expect(page.getByRole('alert')).toHaveText('Tick this to confirm the person agreed to be contacted.');
    await page.getByLabel('The person agreed to be contacted').check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Lead added.');
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByRole('region', { name: mine })).toBeVisible();

    const made = await serviceGet<{ id: string; owner_team_row: string | null; form: string; page_path: string; consent_text: string }[]>(`/leads?workspace_id=eq.${WS.a.id}&name=eq.${encodeURIComponent(mine)}&select=id,owner_team_row,form,page_path,consent_text`);
    expect(made).toHaveLength(1);
    expect(made[0]?.owner_team_row, 'the new lead belongs to member-a1\'s own team row').toBe(one);
    expect(made[0]?.form).toBe('manual');
    expect(made[0]?.page_path).toBe('dashboard');
    expect(made[0]?.consent_text).toBe('The person agreed to be contacted');

    await page.keyboard.press('Escape');   // the panel closes with Esc (DP-1.3-20)
    await expect(page.getByRole('link', { name: mine })).toBeVisible();
    const after = [...(await shown('All')), ...(await shown('Spam'))].sort();
    expect(after, 'still exactly what the service role counts, now with the new lead').toEqual(await expected());
    expect(after).toContain(mine);
  });
});
