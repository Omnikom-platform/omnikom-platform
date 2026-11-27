// Book row B4, pick or switch business: a login that belongs to two businesses sees the picker at /w, opens either one from it, and
// changes business with the rail's switcher; what the screen offers follows the login's role in each. Against the STAGING project,
// signed in as the owner of the second demo business (tests/global-setup.ts). No seeded login belongs to two businesses, so the test
// adds a member row in the first one with the service role and takes it away again; a killed run leaves it, and the next run of this
// file removes it first. Watched red with FLOWS_MUTANT=picker-one, switch-lost and stall (tests/business-switch-mutants.ts).
import { expect, test, type Page } from '@playwright/test';
import { need, PEOPLE, serviceDelete, serviceGet, supabaseUrl, WS } from './support/staging';
import { installBusinessSwitchMutant } from './business-switch-mutants';

const LOGIN = PEOPLE['owner-b'].id;
const addedRow = `/members?workspace_id=eq.${WS.a.id}&user_id=eq.${LOGIN}`;

async function addMembershipInA() {
  await serviceDelete(addedRow);
  const key = need('STAGING_SUPABASE_SECRET_KEY');
  const res = await fetch(`${supabaseUrl()}/rest/v1/members`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ workspace_id: WS.a.id, user_id: LOGIN, role: 'member' }),
    signal: AbortSignal.timeout(30_000),
  });
  expect(res.status, 'the temporary member row was added').toBe(201);
}

const switcher = (page: Page) => page.getByRole('combobox', { name: 'Workspace switcher' });
const picker = (page: Page) => page.getByRole('heading', { name: 'Choose a business' });
const importLink = (page: Page) => page.getByRole('link', { name: 'Import', exact: true });

/** The address, the rail's business name and the lead list of one business. */
async function inBusiness(page: Page, ws: (typeof WS)['a' | 'b']) {
  await expect(page).toHaveURL(new RegExp(`/w/${ws.slug}/leads`));
  await expect(page.getByRole('banner').locator('strong')).toHaveText(ws.name);
  await expect(page.getByRole('link', { name: 'Add a lead' })).toBeVisible();
}

/** Opens the first business from the picker and waits for the login's role there, so a missing Import link is the role's doing. */
async function openAFromPicker(page: Page) {
  const role = page.waitForResponse(r => r.url().includes('/rest/v1/members?select=role') && r.url().includes(WS.a.id), { timeout: 30_000 });
  await page.getByRole('link', { name: `Open ${WS.a.name}`, exact: true }).click();
  await role;
  await inBusiness(page, WS.a);
}

test.use({ storageState: '.auth/owner-b.json' });
test.beforeAll(() => serviceDelete(addedRow));
test.beforeEach(async ({ page }) => {
  await installBusinessSwitchMutant(page);
});
// A hook, not a finally in the test body: a test that times out never reaches the body's finally, and this still runs.
test.afterEach(async () => {
  await serviceDelete(addedRow);
  expect(await serviceGet(`${addedRow}&select=user_id`), 'the temporary member row is gone').toEqual([]);
});

test('B4 one business goes straight in', async ({ page }) => {
  expect(await serviceGet<unknown[]>(`/members?user_id=eq.${LOGIN}&select=workspace_id`), 'the seeded login has one business').toHaveLength(1);
  await page.goto('/w');
  await inBusiness(page, WS.b);
  await expect(switcher(page)).toHaveCount(0);
  await expect(picker(page)).toHaveCount(0);
});

test('B4 two businesses show the picker', async ({ page }) => {
  await addMembershipInA();
  await page.goto('/w');
  await expect(picker(page)).toBeVisible();
  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(2);
  for (const [ws, role] of [[WS.a, 'member'], [WS.b, 'owner']] as const) {
    const row = rows.filter({ hasText: ws.name });
    await expect(row).toHaveCount(1);
    await expect(row.getByText(role, { exact: true })).toBeVisible();
    await expect(row.getByRole('link', { name: `Open ${ws.name}`, exact: true })).toBeVisible();
  }
  await openAFromPicker(page);
  await expect(importLink(page)).toHaveCount(0);
});

test('B4 the switcher changes business', async ({ page }) => {
  await addMembershipInA();
  await page.goto('/w');
  await openAFromPicker(page);
  await expect(switcher(page)).toHaveValue(WS.a.slug);
  const slugs = await switcher(page).locator('option').evaluateAll(all => all.map(o => o.getAttribute('value') ?? ''));
  expect(slugs.sort(), 'one option for each business').toEqual([WS.a.slug, WS.b.slug].sort());
  await expect(importLink(page)).toHaveCount(0);

  await switcher(page).selectOption(WS.b.slug);
  await inBusiness(page, WS.b);
  await expect(importLink(page)).toBeVisible();

  await switcher(page).selectOption(WS.a.slug);
  await inBusiness(page, WS.a);
  await expect(importLink(page)).toHaveCount(0);
});
