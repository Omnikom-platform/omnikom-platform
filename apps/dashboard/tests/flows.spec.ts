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
import { callAs, leadLabel, mintTokenHash, PEOPLE, personAccessToken, RUN, serviceDelete, serviceGet, supabaseHost, TEST_MARK, WS } from './support/staging';
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
  await removeCrm3bTestData();
  await removeA16TestData();
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
    await expect(page).toHaveURL(/\/leads\/new(\?|$)/);   // the address keeps the list's view behind the sheet (work order 19)
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

/** The contract's own label of an industry field, as lead-list answers it (fields[].label): "Budget (USD)", not "budget". A label change then changes the test with it. */
async function contractLabel(key: string): Promise<string> {
  const token = await personAccessToken('owner-a');
  const r = await callAs(token, 'lead-list', { workspace: WS.a.id, size: 1 });
  expect(r.status, `lead-list answered ${r.status}: ${r.text.slice(0, 120)}`).toBe(200);
  const label = (r.json as { fields?: { key: string; label: string }[] }).fields?.find(f => f.key === key)?.label;
  expect(label, `${key} is a field of the test site's contract`).toBeTruthy();
  return label as string;
}
const exactly = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/** Filter by the column with that label, from a value. */
async function columnFrom(page: Page, label: string, from: string) {
  const column = page.getByLabel('Filter by');
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
    const budgetLabel = await contractLabel('budget');
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
    await columnFrom(page, budgetLabel, '500000');
    await expect(page.getByText(`${budgetLabel} is between 500000 and`)).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await expect(rowOf(page, `${CRM_MARK} alpha`)).toHaveCount(0);
    await page.getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(3);

    // sort by budget: ascending as numbers, then descending
    const heading = page.locator('thead').getByRole('button', { name: budgetLabel, exact: true });
    await heading.click();
    await settled(page);
    await expect.poll(() => columnOf(page, exactly(budgetLabel))).toEqual(['300000', '600000', '900000']);
    await expect(page.locator('thead th[aria-sort="ascending"]')).toHaveCount(1);
    await heading.click();
    await settled(page);
    await expect.poll(() => columnOf(page, exactly(budgetLabel))).toEqual(['900000', '600000', '300000']);
    await expect(page.locator('thead th[aria-sort="descending"]')).toHaveCount(1);

    // a lead nobody has opened is bold (data-unread); opening it marks it read; an edit of one industry field shows as an edited line
    const bravo = rowOf(page, `${CRM_MARK} bravo`);
    await expect(bravo).toHaveAttribute('data-unread', 'true');
    await bravo.getByRole('link').click();
    await expect(page.locator('#lead-name')).toHaveText(`${CRM_MARK} bravo`);
    await expect(bravo).not.toHaveAttribute('data-unread', 'true');
    const fields = page.locator('dl');
    await fields.getByRole('button', { name: `Edit ${budgetLabel}`, exact: true }).click();
    await page.getByLabel(budgetLabel, { exact: true }).fill('950000');
    await fields.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').last()).toContainText(`${budgetLabel} saved.`);
    await expect(page.locator('ol li').first()).toContainText(`Changed ${budgetLabel}: 900000 to 950000`);
    expect((await crmLeads()).find(l => l.id === byName('bravo').id)?.answers.budget, 'the edit is in the database as a number').toBe(950000);
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    // bulk: two marked leads to contacted, one call, the third untouched
    await page.getByRole('checkbox', { name: `Select ${CRM_MARK} alpha` }).check();
    await page.getByRole('checkbox', { name: `Select ${CRM_MARK} bravo` }).check();
    await expect(page.getByText(/^2 selected/)).toBeVisible();
    await page.getByLabel('Set status').selectOption('contacted');
    await expect(page.getByRole('status').last()).toContainText('2 leads marked Contacted.');
    await settled(page);
    expect((await crmLeads()).map(l => `${l.name.split(' ').pop()}:${l.status}`).sort()).toEqual(['alpha:contacted', 'bravo:contacted', 'charlie:not-contacted']);
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
    await columnFrom(page, budgetLabel, '500000');
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

// ---------- the CRM block 3b screens (work order 19: columns, saved views, follow-up and tasks, the duplicate mark) ----------
// Staging, workspace A. Owner-a makes two synthetic leads with the add-lead function (the second has the first one's email in capitals, so the second is
// the duplicate), then drives the Columns picker, the Duplicates and Due filters, the follow-up date, a task, and saved views (a private one and a shared one);
// member-a1 sees the shared view and has no Share control. The leads are marked by name ("crm-3b <RUN> ..."), as block 3a's are: add-lead types an answer
// against the contract, and a name needs no contract field. The teardown removes the leads (leads-bulk with confirm; their tasks go with them) and every
// view this run saved, by the marker, so staging keeps nothing.
const CRM3B_MARK = `crm-3b ${RUN}`;
const crm3bLeads = () => serviceGet<{ id: string; name: string }[]>(`/leads?workspace_id=eq.${WS.a.id}&name=like.${encodeURIComponent(`${CRM3B_MARK}*`)}&select=id,name&order=name`);

async function addCrm3bLead(token: string, suffix: string, email: string, phone: string) {
  const r = await callAs(token, 'add-lead', { site: WS.a.site, name: `${CRM3B_MARK} ${suffix}`, email, phone, answers: {}, consentText: 'The person agreed to be contacted', form: 'manual' });
  expect(r.status, `add-lead (${suffix}) answered ${r.status}: ${r.text.slice(0, 160)}`).toBe(201);
}

/** The block 3b teardown, called from the file's one afterAll: the flow leads through leads-bulk with confirm, the views by the marker in their names. */
async function removeCrm3bTestData() {
  const made = await crm3bLeads();
  if (made.length) {
    const token = await personAccessToken('owner-a');
    const r = await callAs(token, 'leads-bulk', { workspace: WS.a.id, ids: made.map(l => l.id), action: 'delete', confirm: true });
    console.log(`crm-3b cleanup: ${made.length} lead(s), leads-bulk answered ${r.status}`);
    expect(r.status, `removing the crm-3b leads answered ${r.status}: ${r.text.slice(0, 200)}`).toBe(200);
  }
  await serviceDelete(`/crm_views?workspace_id=eq.${WS.a.id}&name=like.${encodeURIComponent(`${CRM3B_MARK}*`)}`);
}

// the table is drawn only once rows arrive (a new view loads first), so wait for it before reading
const headings = async (page: Page) => {
  await expect(page.locator('thead th').first()).toBeVisible();
  return (await page.locator('thead th').allInnerTexts()).map(h => h.trim());
};
const toggleButton = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.describe('the CRM block 3b screens as the owner', () => {
  test.use({ storageState: '.auth/owner-a.json' });
  test.setTimeout(300_000);

  test('pick and reorder the columns (the address keeps them), see the duplicate mark and its filter, set a follow-up and find it with Due, add and finish a task, save a private and a shared view and apply and delete one', async ({ page }) => {
    const token = await personAccessToken('owner-a');
    await addCrm3bLead(token, 'alpha', `crm3b.${RUN}@example.com`, '(555) 010-0171');
    await addCrm3bLead(token, 'beta', `CRM3B.${RUN}@EXAMPLE.COM`, '(555) 010-0172');
    const made = await crm3bLeads();
    expect(made.map(l => l.name), 'the two leads are in the database').toEqual([`${CRM3B_MARK} alpha`, `${CRM3B_MARK} beta`]);
    const alpha = made[0]!;
    const alphaName = `${CRM3B_MARK} alpha`, betaName = `${CRM3B_MARK} beta`;

    await page.goto(`/w/${WS.a.slug}/leads`);
    await leadsLoaded(page);
    await radio(page, 'All').check();
    await settled(page);
    await page.getByRole('searchbox', { name: 'Search' }).fill(CRM3B_MARK);
    await expect(page.locator('tbody tr')).toHaveCount(2);

    // columns: the first view shows Follow-up and Possible duplicate (as plain words, not sort buttons); hide Email, move Status up; the address keeps it
    expect(await headings(page)).toEqual(expect.arrayContaining(['Follow-up', 'Possible duplicate', 'Email']));
    await expect(page.locator('thead').getByRole('button', { name: 'Follow-up' })).toHaveCount(0);
    await expect(page.locator('thead').getByRole('button', { name: 'Possible duplicate' })).toHaveCount(0);
    await toggleButton(page, 'Columns').click();
    await page.getByLabel('Show Email').uncheck();
    await expect(page.locator('thead').getByRole('button', { name: 'Email', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Move Status up' }).click();
    await expect(page).toHaveURL(/cols=/);
    const moved = await headings(page);
    expect(moved, 'Email is gone').not.toContain('Email');
    expect(moved.indexOf('Status'), 'Status moved before Page').toBeLessThan(moved.indexOf('Page'));
    await page.reload();
    await leadsLoaded(page);
    await settled(page);
    await expect(page.locator('tbody tr')).toHaveCount(2);   // the search is in the address too
    expect(await headings(page), 'the reloaded page keeps the columns').toEqual(moved);
    await toggleButton(page, 'Columns').click();
    await page.getByRole('button', { name: 'Reset columns' }).click();
    await expect(page).not.toHaveURL(/cols=/);
    expect(await headings(page), 'Reset columns brings the first view back').toContain('Email');
    await toggleButton(page, 'Columns').click();

    // the duplicate: the second lead carries the mark and the Duplicates tick finds exactly it; the record names the older lead and links to it
    const alphaRow = rowOf(page, alphaName), betaRow = rowOf(page, betaName);
    await expect(betaRow.getByText('Possible duplicate')).toBeVisible();
    await expect(alphaRow.getByText('Possible duplicate')).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Duplicates', exact: true }).check();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(betaRow).toHaveCount(1);
    await page.getByRole('checkbox', { name: 'Duplicates', exact: true }).uncheck();
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await betaRow.getByRole('link').click();
    await expect(page.locator('#lead-name')).toHaveText(betaName);
    await expect(page.getByText('Possible duplicate of')).toBeVisible();
    await page.locator('section[aria-labelledby="lead-name"]').getByRole('link', { name: alphaName }).click();
    await expect(page.locator('#lead-name')).toHaveText(alphaName);

    // follow-up: set a date in the past (it is due), see it in the record, the timeline and the list; the Due tick finds alpha only
    await page.getByRole('button', { name: 'Set follow-up' }).click();
    await page.getByLabel('Follow-up date and time').fill('2026-01-05T09:00');
    await page.locator('[data-plan="DP-1.3-68"]').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').last()).toContainText('Follow-up set.');
    const [row] = await serviceGet<{ follow_up_at: string | null }[]>(`/leads?id=eq.${alpha.id}&select=follow_up_at`);
    expect(row?.follow_up_at, 'the follow-up is in the database').toBeTruthy();
    expect(new Date(row?.follow_up_at ?? '').getTime(), 'the instant is the one typed, in the browser\'s offset').toBe(new Date('2026-01-05T09:00').getTime());
    await expect(page.locator('ol li').first()).toContainText('Follow-up set for');
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(alphaRow).toContainText('5 Jan 09:00');
    await page.getByRole('checkbox', { name: 'Due', exact: true }).check();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(alphaRow).toHaveCount(1);
    await page.getByRole('checkbox', { name: 'Due', exact: true }).uncheck();
    await expect(page.locator('tbody tr')).toHaveCount(2);

    // tasks: add one, finish it (one tick), reopen it (the same tick); the database and the timeline agree
    await alphaRow.getByRole('link').click();
    await expect(page.locator('#lead-name')).toHaveText(alphaName);
    await page.getByLabel('Task', { exact: true }).fill('call back');
    await page.getByRole('button', { name: 'Add task' }).click();
    await expect(page.getByRole('status').last()).toContainText('Task added.');
    const doneTick = page.getByRole('checkbox', { name: 'Done call back' });
    await expect(doneTick).not.toBeChecked();
    await doneTick.check();
    await expect(page.getByRole('status').last()).toContainText('Task done.');
    await expect(doneTick).toBeChecked();
    expect((await serviceGet<{ done_at: string | null }[]>(`/lead_tasks?lead_id=eq.${alpha.id}&select=done_at`))[0]?.done_at, 'the task is done in the database').toBeTruthy();
    await doneTick.uncheck();
    await expect(page.getByRole('status').last()).toContainText('Task reopened.');
    await expect(doneTick).not.toBeChecked();
    expect((await serviceGet<{ done_at: string | null }[]>(`/lead_tasks?lead_id=eq.${alpha.id}&select=done_at`))[0]?.done_at, 'the task is open again').toBeNull();
    await expect(page.locator('ol li').first()).toContainText('Task reopened: call back');
    expect(await planProblems(page, { required: ['DP-1.3-67', 'DP-1.3-69', 'DP-1.3-70'] }), 'the DOM plan gate on the record, follow-up and tasks').toEqual([]);
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    // views: save the current view (Email hidden) privately, then a shared one; a taken name is refused under the name box; applying a view restores its columns
    await toggleButton(page, 'Columns').click();
    await page.getByLabel('Show Email').uncheck();
    await toggleButton(page, 'Columns').click();
    await toggleButton(page, 'Views').click();
    await page.getByLabel('View name').fill(`${CRM3B_MARK} private`);
    await page.getByRole('button', { name: 'Save as', exact: true }).click();
    await expect(page.getByRole('status').last()).toContainText('View saved.');
    await page.getByLabel('View name').fill(`${CRM3B_MARK} shared`);
    await page.getByLabel('Share with the business').check();
    await page.getByRole('button', { name: 'Save as', exact: true }).click();
    await expect(page.getByRole('status').last()).toContainText('View saved.');
    // the first save's toast is still up, so wait for the shared view itself before reading the database
    await expect(page.getByRole('button', { name: `${CRM3B_MARK} shared`, exact: true })).toBeVisible();
    const stored = await serviceGet<{ name: string; user_id: string | null; columns: string[] }[]>(`/crm_views?workspace_id=eq.${WS.a.id}&name=like.${encodeURIComponent(`${CRM3B_MARK}*`)}&select=name,user_id,columns&order=name`);
    expect(stored.map(v => `${v.name}:${v.user_id === null ? 'shared' : 'own'}`), 'a private view and a shared one are stored').toEqual([`${CRM3B_MARK} private:own`, `${CRM3B_MARK} shared:shared`]);
    expect(stored[0]?.columns, 'the view stores the columns shown').not.toContain('email');
    await page.getByLabel('View name').fill(`${CRM3B_MARK} shared`);
    await page.getByLabel('Share with the business').check();
    await page.getByRole('button', { name: 'Save as', exact: true }).click();
    await expect(page.locator('[data-plan="DP-1.3-63"]').getByRole('alert')).toBeVisible();
    expect(await serviceGet<{ id: string }[]>(`/crm_views?workspace_id=eq.${WS.a.id}&name=eq.${encodeURIComponent(`${CRM3B_MARK} shared`)}&select=id`), 'the refused name saved nothing').toHaveLength(1);
    await toggleButton(page, 'Columns').click();
    await page.getByRole('button', { name: 'Reset columns' }).click();
    await toggleButton(page, 'Columns').click();
    expect(await headings(page)).toContain('Email');
    await page.getByRole('button', { name: `${CRM3B_MARK} private`, exact: true }).click();
    await expect(page.getByText(`View: ${CRM3B_MARK} private`)).toBeVisible();
    await expect(page).toHaveURL(/view=/);
    expect(await headings(page), 'applying the view hides Email again').not.toContain('Email');
    expect(await planProblems(page, { required: ['DP-1.3-51', 'DP-1.3-54', 'DP-1.3-55', 'DP-1.3-56', 'DP-1.3-57', 'DP-1.3-58', 'DP-1.3-59', 'DP-1.3-60', 'DP-1.3-62', 'DP-1.3-63'] }), 'the DOM plan gate on the list with the Views panel open').toEqual([]);
    await page.getByRole('button', { name: `Delete ${CRM3B_MARK} private` }).click();
    await expect(page.getByText(`Delete ${CRM3B_MARK} private?`)).toBeVisible();
    await page.getByRole('button', { name: 'Delete view' }).click();
    await expect(page.getByRole('status').last()).toContainText('View deleted.');
    expect(await serviceGet<{ id: string }[]>(`/crm_views?workspace_id=eq.${WS.a.id}&name=eq.${encodeURIComponent(`${CRM3B_MARK} private`)}&select=id`), 'the view is gone from the database').toEqual([]);
  });
});

test.describe('the CRM block 3b screens as an agent', () => {
  test.use({ storageState: '.auth/member-a1.json' });

  test('member-a1 sees the owner\'s shared view, can save its own, and has no Share control and no Delete on the shared one', async ({ page }) => {
    const shared = `${CRM3B_MARK} member shared`;
    const saved = await callAs(await personAccessToken('owner-a'), 'view-save', { workspace: WS.a.id, name: shared, query: {}, columns: ['name', 'status'], shared: true });
    expect(saved.status, `view-save answered ${saved.status}: ${saved.text.slice(0, 160)}`).toBe(200);
    // the table is drawn only with rows, and the earlier flows removed member-a1's leads: an agent's added lead is its own (the teardown removes it)
    await addCrm3bLead(await personAccessToken('member-a1'), 'member own lead', `crm3b.${RUN}.member@example.com`, '(555) 010-0173');

    await page.goto(`/w/${WS.a.slug}/leads`);
    await leadsLoaded(page);
    await toggleButton(page, 'Views').click();
    await expect(page.getByRole('heading', { name: 'Shared views' })).toBeVisible();
    await expect(page.getByRole('button', { name: shared, exact: true })).toBeVisible();
    await expect(page.getByLabel('Share with the business')).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Delete ${shared}` })).toHaveCount(0);

    await page.getByLabel('View name').fill(`${CRM3B_MARK} member own`);
    await page.getByRole('button', { name: 'Save as', exact: true }).click();
    await expect(page.getByRole('status').last()).toContainText('View saved.');
    await expect(page.getByRole('heading', { name: 'Your views' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: shared, exact: true }).click();
    await expect(page.getByText(`View: ${shared}`)).toBeVisible();
    const heads = await headings(page);
    expect(heads, 'the shared view shows Name and Status only').toContain('Status');
    expect(heads).not.toContain('Email');
  });
});

// ---- Settings (work order 08; DP-1.6-01 to -20) ----
// Staging, workspace A. The owner sees the five cards, saves alert addresses and reads them back, sees the inline error for a bad line, and (with an
// address the head names in SETTINGS_INVITE_EMAIL: a real mail goes out through Auth, so only to that address) invites a person, sees them in the list
// and removes them through the sheet. The alert addresses are put back as they were, in a finally. An agent sees only Your account and Sign out everywhere.
// Sign out everywhere ends EVERY session of the login, so it runs as member-a2 on a FRESH sign-in (no other spec uses member-a2's saved state).
const settingsUrl = `/w/${WS.a.slug}/settings`;
const cards = (page: Page) => ({
  account: page.getByRole('heading', { name: 'Your account', exact: true }), alerts: page.getByRole('heading', { name: 'Lead alerts', exact: true }),
  people: page.getByRole('heading', { name: 'People', exact: true }), websites: page.getByRole('heading', { name: 'Websites', exact: true }),
  signOut: page.getByRole('heading', { name: 'Sign out everywhere', exact: true }),
});

test.describe('settings: the owner', () => {
  test.use({ storageState: '.auth/owner-a.json' });

  test('owner-a sees the five cards, edits the alert addresses and reads them back; a bad line shows its inline error', async ({ page }) => {
    const before = await serviceGet<{ lead_alert_to: string[]; alert_assignee: boolean }[]>(`/sites?id=eq.${WS.a.site}&select=lead_alert_to,alert_assignee`);
    const token = await personAccessToken('owner-a');
    try {
      await page.goto(settingsUrl);
      const c = cards(page);
      for (const h of [c.account, c.alerts, c.people, c.websites, c.signOut]) await expect(h).toBeVisible();
      await expect(page).toHaveTitle('Settings');
      await expect(page.getByRole('navigation').getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();   // nothing changed yet

      const box = page.getByLabel('Addresses, one per line').first();
      const mine = `settings.${RUN}@example.org`;
      await box.fill(`${mine}\nnot-an-address`);
      await expect(page.getByRole('alert').filter({ hasText: 'Line 2 is not an email address.' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
      await box.fill(`${mine.toUpperCase()}\n\n${mine}`);   // upper case and a repeat: stored once, lower-cased
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('Saved');
      await page.reload();
      await expect(page.getByLabel('Addresses, one per line').first()).toHaveValue(mine);
      const stored = await serviceGet<{ lead_alert_to: string[] }[]>(`/sites?id=eq.${WS.a.site}&select=lead_alert_to`);
      expect(stored[0]?.lead_alert_to).toEqual([mine]);

      await page.getByLabel('Addresses, one per line').first().fill(Array.from({ length: 11 }, (_, i) => `many${i}.${RUN}@example.org`).join('\n'));
      await expect(page.getByRole('alert').filter({ hasText: 'At most 10 addresses.' })).toBeVisible();

      // leaving with an unsaved change asks once, in the page (no browser dialog)
      await page.getByLabel('Addresses, one per line').first().fill(`${mine}\nunsaved.${RUN}@example.org`);
      await page.getByRole('navigation').getByRole('link', { name: 'Leads' }).click();
      await expect(page.getByRole('dialog')).toContainText('Leave without saving?');
      await page.getByRole('button', { name: 'Stay', exact: true }).click();
      await expect(page).toHaveURL(/\/settings$/);
      await page.getByRole('navigation').getByRole('link', { name: 'Leads' }).click();
      await page.getByRole('button', { name: 'Leave', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${WS.a.slug}/leads`));
    } finally {
      const put = await callAs(token, 'settings-save', { workspace: WS.a.id, alerts: { site: WS.a.site, to: before[0]?.lead_alert_to ?? [], assignee: before[0]?.alert_assignee ?? true } });
      expect(put.status, 'the alert addresses were put back: ' + put.text).toBe(200);
    }
  });

  test('owner-a\'s cards show what the database holds: the people, the sites and the alert addresses are the service role\'s own reads, not a shape', async ({ page }) => {
    const members = await serviceGet<{ user_id: string; role: string; team_row_id: string | null }[]>(`/members?workspace_id=eq.${WS.a.id}&select=user_id,role,team_row_id`);
    const sites = await serviceGet<{ id: string; preview_host: string; domain: string | null; state: string; lead_alert_to: string[]; alert_assignee: boolean }[]>(`/sites?workspace_id=eq.${WS.a.id}&select=id,preview_host,domain,state,lead_alert_to,alert_assignee&order=created_at`);
    const teamNames = await serviceGet<{ id: string; content_versions: { n: number; data: { name?: string } }[] }[]>(`/content_rows?workspace_id=eq.${WS.a.id}&collection=eq.team&deleted_at=is.null&select=id,content_versions(n,data)`);
    const nameOf = (row: string | null) => { const r = teamNames.find(x => x.id === row); return r ? [...r.content_versions].sort((a, b) => b.n - a.n)[0]?.data.name ?? null : null; };
    expect(members.length, 'staging workspace A has members').toBeGreaterThan(2);
    expect(sites.length, 'staging workspace A has a site').toBeGreaterThan(0);

    await page.goto(settingsUrl);
    await expect(cards(page).people).toBeVisible();
    const rows = page.locator('ul[data-plan="DP-1.6-01"] > li');
    await expect(rows).toHaveCount(members.length);   // one row per member row in the database
    const shown = await rows.allInnerTexts();
    for (const m of members) {
      const known = Object.values(PEOPLE).find(p => p.id === m.user_id);
      if (!known) continue;
      expect(shown.some(t => t.includes(known.email)), `the list shows ${known.email}`).toBe(true);
      const profile = nameOf(m.team_row_id);
      if (profile) expect(shown.some(t => t.includes(profile) && t.includes(known.email)), `${known.email} is listed with the name ${profile}`).toBe(true);
    }
    expect(shown[0], 'owners come first').toContain(PEOPLE['owner-a'].email);
    expect(shown.filter(t => t.includes('Owner')).length, 'the owners on screen are the owner rows of the database').toBe(members.filter(m => m.role === 'owner').length);

    for (const site of sites) {
      await expect(page.getByText(site.preview_host, { exact: true }).first()).toBeVisible();   // the Websites card and the Lead alerts legend both name it
      if (site.domain) await expect(page.getByText(site.domain, { exact: true })).toBeVisible();
    }
    await expect(page.getByLabel('Addresses, one per line').first()).toHaveValue(sites[0]!.lead_alert_to.join('\n'));
    expect(await page.getByLabel('Also email the assigned agent').first().isChecked()).toBe(sites[0]!.alert_assignee);
    await expect(page.getByRole('definition').filter({ hasText: PEOPLE['owner-a'].email })).toBeVisible();
  });

  test('owner-a invites a person, sees them in the list and removes them through the sheet (only with SETTINGS_INVITE_EMAIL: a real mail goes out)', async ({ page }) => {
    const invite = process.env.SETTINGS_INVITE_EMAIL ?? '';
    test.skip(!invite, 'SETTINGS_INVITE_EMAIL is not set: the head names the one address a real invite may go to');
    await page.goto(settingsUrl);
    await expect(cards(page).people).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill('not-an-address');
    await page.getByRole('button', { name: 'Send invite', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Enter a full email address.' })).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill(invite);
    await page.getByRole('button', { name: 'Send invite', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: invite.toLowerCase() })).toBeVisible();
    const row = page.getByRole('listitem').filter({ hasText: invite.toLowerCase() });
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Their leads and edits stay.');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(row).toBeVisible();   // Cancel removes nobody
    await row.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('listitem').filter({ hasText: invite.toLowerCase() })).toHaveCount(0);
    // your own row has no Remove
    await expect(page.getByRole('listitem').filter({ hasText: PEOPLE['owner-a'].email }).getByRole('button', { name: 'Remove' })).toHaveCount(0);
  });
});

test.describe('settings: an agent', () => {
  test.use({ storageState: '.auth/member-a1.json' });

  test('member-a1 sees only Your account and Sign out everywhere, and no team or alert data comes back', async ({ page }) => {
    const bodies = watchSupabase(page);
    await page.goto(settingsUrl);
    const c = cards(page);
    await expect(c.account).toBeVisible();
    await expect(c.signOut).toBeVisible();
    for (const h of [c.alerts, c.people, c.websites]) await expect(h).toHaveCount(0);
    await expect(page.getByLabel('Addresses, one per line')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send invite' })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('definition').filter({ hasText: PEOPLE['member-a1'].email })).toBeVisible();
    expectNone(await bodies(), [PEOPLE['owner-a'].email, PEOPLE['member-a2'].email], 'the agent\'s settings page');
  });
});

test.describe('settings: sign out everywhere', () => {
  test('member-a2, freshly signed in, ends every session and lands on the sign-in card with the plan\'s sentence', async ({ page }) => {
    const hash = await mintTokenHash('member-a2');
    await page.goto(`/auth/confirm?token_hash=${encodeURIComponent(hash)}&type=magiclink`);
    await page.waitForURL(new RegExp(`/w/${WS.a.slug}/leads`), { timeout: 30_000 });
    await page.goto(settingsUrl);
    await page.getByRole('button', { name: 'Sign out everywhere', exact: true }).click();
    await expect(page).toHaveURL(/\/login\?ended=true$/);
    await expect(page.getByText('You were signed out. Sign in again.')).toBeVisible();
    await page.goto(settingsUrl);
    await expect(page).toHaveURL(/\/login/);   // nothing of this login is left in the browser
  });
});

// ---------- the A16 status board (work order 39): lead type and status as the business's own lists ----------
// Owner-a and member-a1 on workspace A's test site, whose contract (version 7) carries the real-estate lists. The words picked and read here are the list's
// labels as lead-list answers them (read at run time, never typed): a label change in the contract changes the test with it. Every lead is made with add-lead,
// marked by name ("a16 <RUN> ..."), and removed in the file's afterAll through leads-bulk with confirm.
const A16_MARK = `a16 ${RUN}`;
type A16Lead = { id: string; name: string; status: string; status_date: string | null; status_who: string | null; status_text: string | null; lead_type: string };
const a16Leads = () => serviceGet<A16Lead[]>(`/leads?workspace_id=eq.${WS.a.id}&name=like.${encodeURIComponent(`${A16_MARK}*`)}&select=id,name,status,status_date,status_who,status_text,lead_type&order=name`);
const a16One = async (name: string) => (await a16Leads()).find(l => l.name === name)!;

async function addA16Lead(suffix: string, owner?: string | null): Promise<string> {
  const token = await personAccessToken('owner-a');
  const name = `${A16_MARK} ${suffix}`;
  const r = await callAs(token, 'add-lead', { site: WS.a.site, name, email: `a16.${suffix}.${RUN}@example.com`, phone: '(555) 010-0163', answers: {}, consentText: 'The person agreed to be contacted', form: 'manual', ...(owner ? { owner } : {}) });
  expect(r.status, `add-lead (${suffix}) answered ${r.status}: ${r.text.slice(0, 160)}`).toBe(201);
  return name;
}

/** The business's lists as lead-list answers them: the screens must show exactly these words. */
async function a16Lists() {
  const token = await personAccessToken('owner-a');
  const r = await callAs(token, 'lead-list', { workspace: WS.a.id, size: 1 });
  expect(r.status, `lead-list answered ${r.status}: ${r.text.slice(0, 120)}`).toBe(200);
  const j = r.json as { statuses?: { key: string; label: string; needsDate?: boolean; needsWho?: boolean; needsText?: boolean }[]; lead_types?: { key: string; label: string }[] };
  expect(j.statuses?.length, 'the test site has a status list (crmFrom, contract version 7)').toBeGreaterThan(4);
  return { statuses: j.statuses!, types: j.lead_types! };
}
const a16Status = (lists: Awaited<ReturnType<typeof a16Lists>>, key: string) => lists.statuses.find(x => x.key === key)!;

async function a16Open(page: Page, name: string) {
  await page.goto(`/w/${WS.a.slug}/leads`);
  await leadsLoaded(page);
  await radio(page, 'All').check();
  await page.getByRole('searchbox', { name: 'Search' }).fill(name);
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.locator('#lead-name')).toHaveText(name);
}
const statusPick = (page: Page) => page.getByLabel('Status', { exact: true });

async function removeA16TestData() {
  const made = await a16Leads();
  if (!made.length) return;
  const token = await personAccessToken('owner-a');
  const r = await callAs(token, 'leads-bulk', { workspace: WS.a.id, ids: made.map(l => l.id), action: 'delete', confirm: true });
  console.log(`a16 cleanup: ${made.length} lead(s), leads-bulk answered ${r.status}`);
  expect(r.status, `removing the a16 leads answered ${r.status}: ${r.text.slice(0, 200)}`).toBe(200);
}

test.describe('the A16 status board as the owner', () => {
  test.use({ storageState: '.auth/owner-a.json' });
  test.setTimeout(300_000);

  test('a status that needs a date asks for it, shows the server\'s refusal, then saves the date; a status with a person and one with a line save theirs', async ({ page }) => {
    const lists = await a16Lists();
    const dated = a16Status(lists, 'call-back'), withWho = a16Status(lists, 'contacted'), withLine = a16Status(lists, 'interested');
    expect([dated.needsDate, withWho.needsWho, withLine.needsText], 'the list marks call-back, contacted and interested as the order expects').toEqual([true, true, true]);
    const name = await addA16Lead('owner');
    await a16Open(page, name);

    // the picker is the list's words, in the list's order, then spam
    await expect(statusPick(page).locator('option')).toHaveText(lists.statuses.some(x => x.key === 'spam') ? lists.statuses.map(x => x.label) : [...lists.statuses.map(x => x.label), 'Spam']);

    // a dated status: the Date box opens, Save with no date is refused by the database and its sentence shows under the box; nothing is written
    await statusPick(page).selectOption({ label: dated.label });
    await expect(page.getByLabel('Date', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: /needs a date/i })).toBeVisible();
    expect((await a16One(name)).status, 'a refused status changed nothing').toBe('not-contacted');
    await page.getByLabel('Date', { exact: true }).fill('2026-12-04');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').last()).toContainText(`Marked ${dated.label}.`);
    await expect.poll(async () => { const l = await a16One(name); return `${l.status}|${l.status_date}`; }).toBe('call-back|2026-12-04');
    await expect(page.locator('ol li').first()).toContainText(`Status: ${lists.statuses[0]!.label} to ${dated.label} (4 Dec 2026)`);

    // a status with a person: the Who pick starts on the signed-in person (or nobody, which the server fills with the caller); saved, it is the caller's id
    await statusPick(page).selectOption({ label: withWho.label });
    await expect(page.getByLabel('Who', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').last()).toContainText(`Marked ${withWho.label}.`);
    await expect.poll(async () => { const l = await a16One(name); return `${l.status}|${l.status_who}|${l.status_date}`; }, { message: 'the person is recorded and the old date is gone' }).toBe(`contacted|${PEOPLE['owner-a'].id}|null`);

    // a status with a line
    await statusPick(page).selectOption({ label: withLine.label });
    await page.getByLabel('Details', { exact: true }).fill('three beds near the park');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').last()).toContainText(`Marked ${withLine.label}.`);
    await expect.poll(async () => { const l = await a16One(name); return `${l.status}|${l.status_text}|${l.status_who}`; }).toBe('interested|three beds near the park|null');
    await expect(page.locator('ol li').first()).toContainText(`${withLine.label} (three beds near the park)`);
  });

  test('a bulk status that needs a date is refused by the server and its sentence shows in the bar; nothing is written. A bulk status that needs nothing saves', async ({ page }) => {
    const lists = await a16Lists();
    const dated = a16Status(lists, 'call-back'), plain = a16Status(lists, 'qualified');
    const a = await addA16Lead('bulk-a'), b = await addA16Lead('bulk-b');
    await page.goto(`/w/${WS.a.slug}/leads`);
    await leadsLoaded(page);
    await radio(page, 'All').check();
    await page.getByRole('searchbox', { name: 'Search' }).fill(`${A16_MARK} bulk`);
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await page.getByRole('checkbox', { name: `Select ${a}` }).check();
    await page.getByRole('checkbox', { name: `Select ${b}` }).check();
    await expect(page.getByLabel('Set status').locator('option')).toContainText([lists.statuses[0]!.label, dated.label]);
    await page.getByLabel('Set status').selectOption({ label: dated.label });
    await expect(page.getByRole('alert').filter({ hasText: /needs a date/i })).toBeVisible();
    expect((await a16Leads()).filter(l => l.name.includes(' bulk-')).map(l => l.status), 'the refused bulk wrote nothing').toEqual(['not-contacted', 'not-contacted']);
    await page.getByLabel('Set status').selectOption({ label: plain.label });
    await expect(page.getByRole('status').last()).toContainText(`2 leads marked ${plain.label}.`);
    await expect.poll(async () => (await a16Leads()).filter(l => l.name.includes(' bulk-')).map(l => l.status)).toEqual(['qualified', 'qualified']);
  });

  test('the lead type is set in the panel from the list, and the list filters on it by the list\'s words; the Status filter offers the list\'s words, not keys', async ({ page }) => {
    const lists = await a16Lists();
    const buy = lists.types.find(t => t.key === 'buy')!;
    const one = await addA16Lead('type-a'), two = await addA16Lead('type-b');
    await a16Open(page, one);
    await expect(page.getByLabel('Lead type', { exact: true }).locator('option')).toHaveText(lists.types.map(t => t.label));
    await page.getByLabel('Lead type', { exact: true }).selectOption({ label: buy.label });
    await expect(page.getByRole('status').last()).toContainText('Lead type saved.');
    await expect.poll(async () => (await a16One(one)).lead_type).toBe('buy');
    expect((await a16One(two)).lead_type, 'the other lead is still an enquiry').toBe('enquiry');
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    await radio(page, 'All').check();
    await page.getByRole('searchbox', { name: 'Search' }).fill(`${A16_MARK} type`);
    await expect(page.locator('tbody tr')).toHaveCount(2);
    expect(await columnOf(page, /^Lead type$/)).toEqual(expect.arrayContaining([buy.label, lists.types.find(t => t.key === 'enquiry')!.label]));
    await page.getByLabel('Filter by').selectOption({ label: 'Lead type' });
    await page.getByLabel('value', { exact: true }).selectOption({ label: buy.label });
    await page.getByRole('button', { name: 'Add filter' }).click();
    await expect(page.getByText(`Lead type is ${buy.label}`)).toBeVisible();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(rowOf(page, one)).toHaveCount(1);
    await page.getByRole('button', { name: 'Remove' }).click();

    // the known finding: the Status filter's values are the list's labels, never the keys
    await page.getByLabel('Filter by').selectOption({ label: 'Status' });
    const values = await page.getByLabel('value', { exact: true }).locator('option').allTextContents();
    expect(values).toEqual(expect.arrayContaining(lists.statuses.map(x => x.label)));
    expect(values.filter(v => /^[a-z]+(-[a-z]+)+$/.test(v)), 'no raw status key in the dropdown').toEqual([]);
  });
});

test.describe('the A16 status board as an agent', () => {
  test.use({ storageState: '.auth/member-a1.json' });

  test('member-a1 sets a dated status on a lead of their own, and the database holds the date', async ({ page }) => {
    const lists = await a16Lists();
    const dated = a16Status(lists, 'call-back');
    const members = await serviceGet<{ user_id: string; team_row_id: string | null }[]>(`/members?workspace_id=eq.${WS.a.id}&select=user_id,team_row_id`);
    const own = members.find(m => m.user_id === PEOPLE['member-a1'].id)?.team_row_id ?? null;
    expect(own, 'the seeded member has a team row (omnikom seed test)').toBeTruthy();
    const name = await addA16Lead('agent', own);
    await a16Open(page, name);
    await statusPick(page).selectOption({ label: dated.label });
    await page.getByLabel('Date', { exact: true }).fill('2026-12-07');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').last()).toContainText(`Marked ${dated.label}.`);
    await expect.poll(async () => { const l = await a16One(name); return `${l.status}|${l.status_date}`; }).toBe('call-back|2026-12-07');
  });
});
