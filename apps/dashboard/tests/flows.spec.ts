// The three step-5.3 flows, against the STAGING project, in Edge, with the built dashboard (vite preview on localhost).
// Each finds things by role and label, never by a class. Signed-in states come from tests/global-setup.ts (the email-link path).
// Test data: only leads on the test site of workspace A, each marked {"test": "5.3 flows"} in its answers (or, for the one the
// browser form makes, in its name and notes: that form has no field for answers). Nothing else on staging is changed.
// The leads this run made are removed in the afterAll below (slice 5-CL), through service.delete_lead, by the ids found for this run.
import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { callAs, leadLabel, PEOPLE, personAccessToken, RUN, serviceDelete, serviceGet, supabaseHost, TEST_MARK, WS } from './support/staging';
import { active, installMutant } from './mutants';
import { planProblems } from './plan-gate.dom';

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
  await removeCrmScreensTestData();
  const made = await serviceGet<{ id: string }[]>(`/leads?site_id=eq.${WS.a.site}&name=like.${encodeURIComponent(`5.3 flows ${RUN}*`)}&select=id&limit=100`);
  if (!made.length) return;
  const out = spawnSync(process.execPath, [CLEAN_LEADS, '--apply', '--ids', made.map(l => l.id).join(',')], { encoding: 'utf8', env: process.env, timeout: 120_000, windowsHide: true });
  console.log(`flows cleanup: ${(out.stdout || '').trim().split('\n').pop()}`);
  expect(out.status, `removing the ${made.length} flows lead(s) answered ${out.status}: ${(out.stdout || out.stderr || '').trim().slice(0, 300)}`).toBe(0);
});

const radio = (page: Page, name: string) => page.getByRole('radio', { name: new RegExp(`^${name}\\b`) });
const leadsLoaded = (page: Page) => expect(page.getByRole('link', { name: 'Add a lead' })).toBeVisible();
/** The list and its counts have answered (the screen marks a call in flight with data-busy). */
const settled = (page: Page) => expect(page.locator('[data-busy="true"]')).toHaveCount(0);
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
      await settled(page);
      const all: string[] = [];
      for (;;) {   // the list pages by 50: walk every page
        all.push(...(await page.locator('tbody th a').allInnerTexts()));
        const next = page.getByRole('button', { name: 'Next', exact: true });
        if (!(await next.count()) || !(await next.isEnabled())) break;
        await next.click();
        await settled(page);
      }
      return all;
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

// ---------- the CRM screens (work order 07, block 3a) ----------
// Owner-a drives the list, the record, bulk, the export and the import against three leads this run sends to the test site through
// the CLI (the way a visitor's form arrives, so the contract's real-estate fields are typed by capture). The contract drops an answer key it does
// not declare, so these leads cannot carry {"test": "crm-screens"} in their answers: they are marked by name ("crm-screens <RUN> ...") and removed in
// the afterAll through leads-bulk with confirm, by the ids found for this run. The import flow checks a synthetic 3-row file and never imports it;
// the one layout it saves is removed again by its exact name.
const CRM_MARK = `crm-screens ${RUN}`;
const CRM_LAYOUT = `flows ${RUN}`;

function sendCrmLead(name: string, answers: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'dash-crm-'));
  try {
    const fixture = join(dir, 'lead.json');
    writeFileSync(fixture, JSON.stringify({
      form: 'contact', flow: 'contact', page: '/crm-screens', cta: 'crm screens', name, email: `${name.replace(/\W+/g, '.')}@example.com`, phone: '(555) 010-0160',
      answers, consentText: 'I agree that the business may contact me about this request by email, phone or text.', marketingConsent: { given: false, text: 'marketing wording' }, hp: '',
    }));
    const sent = spawnSync(process.execPath, [CLI, 'lead', 'send', '--site', WS.a.site, '--as', 'site:test-demo-a', '--target', 'staging', '--fixture', fixture, '--real', '--key', randomUUID(), '--json'],
      { encoding: 'utf8', env: process.env, timeout: 90_000, windowsHide: true });
    const out = JSON.parse(sent.stdout || '{}') as { ok?: boolean };
    expect(out.ok, `omnikom lead send (${name}) must succeed`).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type CrmLead = { id: string; name: string; status: string; answers: Record<string, unknown> };
const crmLeads = () => serviceGet<CrmLead[]>(`/leads?workspace_id=eq.${WS.a.id}&name=like.${encodeURIComponent(`${CRM_MARK}*`)}&select=id,name,status,answers&order=name`);
const rowOf = (page: Page, name: string) => page.locator('tbody tr', { hasText: name });
/** The text of one column of the list, by its heading, top to bottom. */
async function columnOf(page: Page, heading: RegExp): Promise<string[]> {
  const heads = await page.locator('thead th').allInnerTexts();
  const at = heads.findIndex(h => heading.test(h.trim()));
  expect(at, `the list has a column headed ${heading}`).toBeGreaterThan(0);
  return page.locator('tbody tr').evaluateAll((rows, i) => rows.map(r => (r.children[i]?.textContent ?? '').trim()), at);
}

/** Filter by the budget column, from a value: the column's label is the contract's own, so it is found by its words. */
async function budgetFrom(page: Page, from: string) {
  const column = page.getByLabel('Filter by');
  const label = (await column.locator('option').allInnerTexts()).find(o => /^budget$/i.test(o.trim()));
  expect(label, 'budget is a column of the list').toBeTruthy();
  await column.selectOption({ label });
  await page.getByLabel('Condition').selectOption('between');
  await page.getByLabel('From').fill(from);
  await page.getByRole('button', { name: 'Add filter' }).click();
}

/** The CRM screens' teardown, called from the file's one afterAll: the flow leads go through leads-bulk with confirm, the saved layout by its exact name. */
async function removeCrmScreensTestData() {
  const made = await crmLeads();
  if (made.length) {
    const token = await personAccessToken('owner-a');
    const r = await callAs(token, 'leads-bulk', { workspace: WS.a.id, ids: made.map(l => l.id), action: 'delete', confirm: true });
    console.log(`crm-screens cleanup: ${made.length} lead(s), leads-bulk answered ${r.status}`);
    expect(r.status, `removing the crm-screens leads answered ${r.status}: ${r.text.slice(0, 200)}`).toBe(200);
  }
  await serviceDelete(`/crm_templates?workspace_id=eq.${WS.a.id}&name=eq.${encodeURIComponent(CRM_LAYOUT)}`);
}

test.describe('the CRM screens as the owner', () => {
  test.use({ storageState: '.auth/owner-a.json' });
  test.setTimeout(300_000);

  test('search, a filter on an industry column, sort by budget, edit a field, bulk status, delete through the sheet, export the view, and a dry-run import', async ({ page }) => {
    for (const [n, budget, beds] of [['alpha', 300000, 2], ['bravo', 900000, 4], ['charlie', 600000, 3]] as const) {
      sendCrmLead(`${CRM_MARK} ${n}`, { budget, beds, timing: '0-3 months', side: 'Buying', area: 'alpha' });
    }
    const made = await crmLeads();
    expect(made.map(l => l.name), 'the three leads are in the database').toEqual([`${CRM_MARK} alpha`, `${CRM_MARK} bravo`, `${CRM_MARK} charlie`]);
    const byName = (n: string) => made.find(l => l.name === `${CRM_MARK} ${n}`)!;

    await page.goto(`/w/${WS.a.slug}/leads`);
    await leadsLoaded(page);
    await radio(page, 'All').check();
    await settled(page);
    const search = page.getByRole('searchbox', { name: 'Search' });

    // search narrows (on the server, over every column)
    await search.fill(CRM_MARK);
    await expect(page.locator('tbody tr')).toHaveCount(3);
    await search.fill(`${CRM_MARK} bravo`);
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await search.fill(CRM_MARK);
    await expect(page.locator('tbody tr')).toHaveCount(3);

    // a filter on an industry column: budget from 500000 leaves bravo and charlie; Remove brings alpha back
    await budgetFrom(page, '500000');
    await expect(page.getByText(/budget is between 500000 and/i)).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await expect(rowOf(page, `${CRM_MARK} alpha`)).toHaveCount(0);
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(3);

    // sort by budget: ascending as numbers, then descending
    const heading = page.locator('thead').getByRole('button', { name: /^budget$/i });
    await heading.click();
    await settled(page);
    await expect.poll(() => columnOf(page, /^budget$/i)).toEqual(['300000', '600000', '900000']);
    await expect(page.locator('thead th[aria-sort="ascending"]')).toHaveCount(1);
    await heading.click();
    await settled(page);
    await expect.poll(() => columnOf(page, /^budget$/i)).toEqual(['900000', '600000', '300000']);
    await expect(page.locator('thead th[aria-sort="descending"]')).toHaveCount(1);

    // a lead nobody has opened is bold (data-unread); opening it marks it read; an edit of one industry field shows as an edited line
    const bravo = rowOf(page, `${CRM_MARK} bravo`);
    await expect(bravo).toHaveAttribute('data-unread', 'true');
    await bravo.getByRole('link').click();
    await expect(page.locator('#lead-name')).toHaveText(`${CRM_MARK} bravo`);
    await expect(bravo).not.toHaveAttribute('data-unread', 'true');
    const fields = page.locator('dl');
    await fields.getByRole('button', { name: /^Edit budget$/i }).click();
    await page.getByLabel(/^budget$/i).fill('950000');
    await fields.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').last()).toContainText(/budget saved\./i);
    await expect(page.locator('ol li').first()).toContainText(/Changed budget: 900000 to 950000/i);
    expect((await crmLeads()).find(l => l.id === byName('bravo').id)?.answers.budget, 'the edit is in the database as a number').toBe(950000);
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    // bulk: two marked leads to contacted, one call, the third untouched
    await page.getByRole('checkbox', { name: `Select ${CRM_MARK} alpha` }).check();
    await page.getByRole('checkbox', { name: `Select ${CRM_MARK} bravo` }).check();
    await expect(page.getByText(/^2 selected/)).toBeVisible();
    await page.getByLabel('Set status').selectOption('contacted');
    await expect(page.getByRole('status').last()).toContainText('2 leads marked contacted.');
    await settled(page);
    expect((await crmLeads()).map(l => `${l.name.split(' ').pop()}:${l.status}`).sort()).toEqual(['alpha:contacted', 'bravo:contacted', 'charlie:new']);
    await expect(page.getByText(/ selected/)).toHaveCount(0);   // the selection cleared

    // delete one through the sheet: Cancel sends nothing, the sheet's own button deletes
    await page.getByRole('checkbox', { name: `Select ${CRM_MARK} charlie` }).check();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Delete this lead?' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await crmLeads(), 'Cancel deleted nothing').toHaveLength(3);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Delete this lead', exact: true }).click();
    await expect(page.getByRole('status').last()).toContainText('Deleted 1 leads.');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(async () => (await crmLeads()).length).toBe(2);

    // export the view: the filter and the sort are the file's (budget from 500000 leaves bravo only), the header row has the contract's columns
    await budgetFrom(page, '500000');
    await expect(page.locator('tbody tr')).toHaveCount(1);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export', exact: true }).click()]);
    const file = readFileSync((await download.path()) ?? '', 'utf8').trim().split(/\r?\n/);
    console.log(`export header row: ${file[0]}`);
    expect(file[0], 'the header row has the core columns and the budget field').toMatch(/^received,name,email,phone,form,page,status,owner,.*budget/);
    expect(file, 'the file holds the view: the header and bravo').toHaveLength(2);
    expect(file[1]).toContain(`${CRM_MARK} bravo`);
    await page.getByRole('button', { name: 'Clear filters' }).or(page.getByRole('button', { name: 'Remove' })).first().click();

    // import: propose, save and dry-run a synthetic 3-row file; nothing is written
    const emails = [1, 2, 3].map(n => `crm.import.${RUN}.${n}@example.com`);
    const csv = ['First Name,Last Name,E-mail,Phone', ...emails.map((e, i) => `Crm,Import${i + 1},${e},(555) 010-02${10 + i}`)].join('\n');
    await page.getByRole('link', { name: 'Import', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Import leads' })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({ name: 'crm-export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(page.getByRole('heading', { name: 'How your columns match ours' })).toBeVisible();
    expect(await planProblems(page, { required: ['DP-1.3-42', 'DP-1.3-43', 'DP-1.3-44', 'DP-1.3-45', 'DP-1.3-50'] }), 'the DOM plan gate on the import screen, steps 1 and 2').toEqual([]);
    await page.getByLabel('Name of your CRM').fill(CRM_LAYOUT);
    await page.getByRole('button', { name: 'Save these matches' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.getByRole('button', { name: 'Check the file' }).click();
    await expect(page.getByText('3 rows in the file')).toBeVisible();
    await expect(page.getByText('3 will be added')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The first 20 rows as they will be saved' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Import 3 leads$/ })).toBeVisible();
    expect(await planProblems(page, { required: ['DP-1.3-46', 'DP-1.3-48', 'DP-1.3-49'] }), 'the DOM plan gate on the import screen, step 3').toEqual([]);
    const written = await serviceGet<{ id: string }[]>(`/leads?workspace_id=eq.${WS.a.id}&email=in.(${emails.map(e => `"${e}"`).join(',')})&select=id`);
    expect(written, 'the dry run wrote no lead').toEqual([]);
  });
});

test.describe('the CRM screens as an agent', () => {
  test.use({ storageState: '.auth/member-a1.json' });

  test('member-a1 sees no Import, no Delete and no Set owner, and Not found on the import address', async ({ page }) => {
    const members = await serviceGet<{ user_id: string; team_row_id: string | null }[]>(`/members?workspace_id=eq.${WS.a.id}&select=user_id,team_row_id`);
    const one = members.find(m => m.user_id === PEOPLE['member-a1'].id)?.team_row_id ?? null;
    expect(one, 'the seeded member has a team row (omnikom seed test)').toBeTruthy();
    const token = await personAccessToken('owner-a');
    const name = `${CRM_MARK} agent`;
    const r = await callAs(token, 'add-lead', { site: WS.a.site, name, email: `crm.agent.${RUN}@example.com`, phone: '(555) 010-0161', answers: {}, consentText: 'The person agreed to be contacted', form: 'manual', owner: one });
    expect(r.status, `add-lead answered ${r.status}: ${r.text.slice(0, 120)}`).toBe(201);

    await page.goto(`/w/${WS.a.slug}/leads`);
    await leadsLoaded(page);
    await radio(page, 'All').check();
    await settled(page);
    await expect(page.getByRole('link', { name: 'Import', exact: true })).toHaveCount(0);
    await page.getByRole('checkbox', { name: `Select ${name}` }).check();
    await expect(page.getByLabel('Set status')).toBeVisible();
    await expect(page.getByLabel('Set owner')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name }).click();
    await expect(page.locator('#lead-name')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete this lead' })).toHaveCount(0);

    await page.goto(`/w/${WS.a.slug}/leads/import`);
    await notFound(page);
  });
});
