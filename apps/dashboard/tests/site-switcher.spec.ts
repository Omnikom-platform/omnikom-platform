// Book row A26, the Site switcher with two sites: shown only with 2 or more sites (DP-1.3-01 on Leads, DP-1.4-01 on Site), the pick
// filters the lead list, is remembered per login in this browser, and the Site screen follows it. Against STAGING, as owner-a.
// No seeded business has two sites, so a test makes a second site of workspace A with the service role; afterEach removes it, so a test that times out leaves none.
// Watched red with FLOWS_MUTANT=sites-one and site-filter-dropped; stall proves the removal after a timeout (site-switcher-mutants.ts).
import { expect, test, type Page } from '@playwright/test';
import { installSiteSwitcherMutant } from './site-switcher-mutants';
import { makeOwnLead, removeOwnLeads } from './support/own-lead';
import { need, RUN, serviceDelete, serviceGet, supabaseUrl, WS } from './support/staging';

type Site = { id: string; domain: string | null; preview_host: string; state: string };

const LEADS = `/w/${WS.a.slug}/leads`;
// every site this file ever made, also one a killed run left behind
const LEFTOVERS = `/sites?workspace_id=eq.${WS.a.id}&deploy_target=like.a26-*`;

const sitesOfA = () => serviceGet<Site[]>(`/sites?workspace_id=eq.${WS.a.id}&select=id,domain,preview_host,state&order=created_at`);
const optionText = (s: Site) => s.domain || s.preview_host;
// where the Site screen's Open link goes (siteUrl in src/lib/site.ts)
const openHref = (s: Site) => `https://${s.state === 'live' && s.domain ? s.domain : s.preview_host}`;

// the targets this test made, for afterEach to remove
const made: string[] = [];

/** A second site of workspace A for the rest of the test. It has no leads and no jobs, so it deletes cleanly. */
async function withSecondSite(n: string, fn: (second: Site) => Promise<void>) {
  const target = `a26-${RUN}-${n}`;
  // noted before the insert: a site made by an insert whose answer was lost goes too
  made.push(target);
  const key = need('STAGING_SUPABASE_SECRET_KEY');
  const res = await fetch(`${supabaseUrl()}/rest/v1/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: key, authorization: `Bearer ${key}`, prefer: 'return=representation' },
    body: JSON.stringify({ workspace_id: WS.a.id, deploy_target: target, preview_host: `${target}.example.test` }),
    signal: AbortSignal.timeout(30_000),
  });
  expect(res.status, 'the service insert of the second site').toBe(201);
  const [second] = (await res.json()) as Site[];
  expect(second?.id, 'the insert answers the new site').toBeTruthy();
  await fn(second!);
}

const switcher = (page: Page) => page.getByLabel('Site switcher', { exact: true });
const leadRow = (page: Page, name: string) => page.locator('tbody tr', { hasText: name });
/** The list has answered: the screen marks a call in flight with data-busy. */
async function leadsLoaded(page: Page) {
  await expect(page.getByRole('link', { name: 'Add a lead' })).toBeVisible();
  await expect(page.locator('[data-plan="DP-1.2s-10"]')).toHaveCount(0);
  await expect(page.locator('[data-busy="true"]')).toHaveCount(0);
}
const openSiteScreen = (page: Page) => page.getByRole('navigation').getByRole('link', { name: 'Site', exact: true }).click();

// a pick, fill or click that finds nothing fails here, well under the 90 s test limit
test.use({ storageState: '.auth/owner-a.json', actionTimeout: 15_000 });

test.describe('A26 site switcher with two sites', () => {
  test.beforeAll(async () => {
    await serviceDelete(LEFTOVERS);
    expect(await serviceGet(`${LEFTOVERS}&select=id`), 'no a26 site is left over').toEqual([]);
  });

  // not a finally in the test body: afterEach has a time slot of its own after a test timeout
  test.afterEach(async () => {
    for (const target of made.splice(0)) {
      await serviceDelete(`/sites?workspace_id=eq.${WS.a.id}&deploy_target=eq.${target}`);
      expect(await serviceGet(`/sites?workspace_id=eq.${WS.a.id}&deploy_target=eq.${target}&select=id`), 'the second site is gone').toEqual([]);
    }
  });

  test.afterAll(async () => {
    await removeOwnLeads('a26');
  });

  test('A26 one site shows no switcher', async ({ page }) => {
    await installSiteSwitcherMutant(page);
    const sites = await sitesOfA();
    expect(sites.length, 'workspace A is seeded with one site').toBe(1);

    await page.goto(LEADS);
    await leadsLoaded(page);
    await expect(switcher(page)).toHaveCount(0);

    await openSiteScreen(page);
    await expect(page.locator(`a[href="${openHref(sites[0]!)}"]`)).toHaveText('Open');
    await expect(switcher(page)).toHaveCount(0);
  });

  test('A26 two sites: pick filters the list', async ({ page }) => {
    await installSiteSwitcherMutant(page);
    const before = await sitesOfA();
    expect(before.length, 'workspace A is seeded with one site').toBe(1);
    const main = before[0]!;
    const lead = await makeOwnLead('a26', 'on main');
    // the control: the lead really is on the main site, so its leaving the list below is the filter
    expect(await serviceGet(`/leads?workspace_id=eq.${WS.a.id}&name=eq.${encodeURIComponent(lead.name)}&select=site_id`)).toEqual([{ site_id: main.id }]);

    await withSecondSite('t2', async second => {
      await page.goto(LEADS);
      await leadsLoaded(page);
      await page.getByRole('searchbox', { name: 'Search' }).fill(lead.name);
      await expect(page).toHaveURL(/[?&]q=/);
      await expect(switcher(page).locator('option')).toHaveText([optionText(main), optionText(second)]);
      expect(await switcher(page).locator('option').evaluateAll(os => os.map(o => (o as HTMLOptionElement).value))).toEqual([main.id, second.id]);
      await expect(switcher(page)).toHaveValue(main.id);
      await expect(leadRow(page, lead.name)).toBeVisible();

      await switcher(page).selectOption(second.id);
      await expect(page).toHaveURL(new RegExp(`[?&]site=${second.id}`));
      // the new list has answered with nothing (not only: the old row is not drawn while it loads)
      await expect(page.getByText(/^No leads (yet|match this filter)/)).toBeVisible();
      await expect(leadRow(page, lead.name)).toHaveCount(0);

      await switcher(page).selectOption(main.id);
      await expect(leadRow(page, lead.name)).toBeVisible();
    });
  });

  test('A26 the pick is remembered', async ({ page }) => {
    await installSiteSwitcherMutant(page);
    await withSecondSite('t3', async second => {
      await page.goto(LEADS);
      await leadsLoaded(page);
      await switcher(page).selectOption(second.id);
      await expect(page).toHaveURL(new RegExp(`[?&]site=${second.id}`));

      await page.goto(LEADS);
      await leadsLoaded(page);
      await expect(page).not.toHaveURL(/[?&]site=/);
      await expect(switcher(page)).toHaveValue(second.id);
    });
  });

  test('A26 the Site screen follows', async ({ page }) => {
    await installSiteSwitcherMutant(page);
    await withSecondSite('t4', async second => {
      const main = (await sitesOfA())[0]!;
      await page.goto(LEADS);
      await leadsLoaded(page);
      await switcher(page).selectOption(second.id);
      await expect(page).toHaveURL(new RegExp(`[?&]site=${second.id}`));

      await openSiteScreen(page);
      await expect(switcher(page)).toHaveValue(second.id);
      await expect(page.locator(`a[href="${openHref(second)}"]`)).toHaveText('Open');

      await switcher(page).selectOption(main.id);
      await expect(page.locator(`a[href="${openHref(main)}"]`)).toHaveText('Open');
    });
  });
});
