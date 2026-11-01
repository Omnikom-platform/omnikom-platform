// The slice 5.4 flows, against the STAGING project, in Edge, with the built dashboard (vite preview on localhost). Each finds things by role
// and label. Test data: only the contact page of the test site of workspace A (new versions; the heading is put back at the end of each
// flow that changes it). Nothing else on staging is changed. Each flow has a watched-red mutant in tests/mutants.ts.
import { expect, test, type Page } from '@playwright/test';
import { callAs, personAccessToken, RUN, serviceGet, WS } from './support/staging';
import { installMutant } from './mutants';
import { plan as resetPlan, removeRows } from './support/reset-staging-drafts.mjs';
import { planProblems } from './plan-gate.dom';

const ok = async (page: Page, o: Parameters<typeof planProblems>[1]) => expect(await planProblems(page, o)).toEqual([]);

type Contact = { id: string; n: number; published: number | null; data: Record<string, unknown> };
const heading = (d: Record<string, unknown>) => ((d.sections as { contact?: { heading?: string } } | undefined)?.contact?.heading ?? '');

/** The contact page of the test site as the service role sees it: the truth the screen is compared with. */
async function contact(): Promise<Contact> {
  const rows = await serviceGet<{ id: string; published_version: number | null; content_versions: { n: number; data: Record<string, unknown> }[] }[]>(
    `/content_rows?workspace_id=eq.${WS.a.id}&collection=eq.pages&deleted_at=is.null&select=id,published_version,content_versions(n,data)`);
  for (const r of rows) {
    const newest = [...r.content_versions].sort((a, b) => b.n - a.n)[0];
    if (newest?.data.path === '/contact/') return { id: r.id, n: newest.n, published: r.published_version, data: newest.data };
  }
  throw new Error('BLOCKED: staging workspace A has no contact page row (sites/test-demo-a/stage.mjs)');
}

/** A save as owner-a through the function (server to server), for the part of a flow that is "someone else". */
async function saveAsOwner(c: Contact, newHeading: string) {
  const data = { ...c.data, sections: { ...(c.data.sections as object), contact: { ...((c.data.sections as { contact?: object }).contact), heading: newHeading } } };
  const r = await callAs(await personAccessToken('owner-a'), 'save', { workspace: WS.a.id, collection: 'pages', row: c.id, base: c.n, data });
  expect(r.status, `save as owner-a answered ${r.status}: ${r.text.slice(0, 120)}`).toBe(200);
}

const openContact = async (page: Page) => {
  await page.goto(`/w/${WS.a.slug}/site`);
  await page.getByRole('link', { name: 'Contact Demo A', exact: true }).click();
  await expect(page.getByLabel('Heading')).toBeVisible();
};

test.describe('the owner\'s Site screen', () => {
  test.use({ storageState: '.auth/owner-a.json' });

  test('the list and the editor carry the plan, and a save is a new version while the site stays as it is', async ({ page }) => {
    await installMutant(page, 'save-lost');
    const before = await contact();
    const original = heading(before.data);
    expect(original, 'the contact page has a heading').not.toBe('');

    await page.goto(`/w/${WS.a.slug}/site`);
    await expect(page.getByRole('link', { name: 'Contact Demo A', exact: true })).toBeVisible();
    await expect(page).toHaveTitle('Site');
    await ok(page, { required: ['DP-1.2s-04', 'DP-1.4-02', 'DP-1.4-04', 'DP-1.4-05', 'DP-1.4-06', 'DP-1.4-07', 'DP-1.4-22'], absent: ['DP-1.4-01'] });
    await expect(page.getByText('Preview, not live yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Business details' })).toBeVisible();

    await page.getByRole('link', { name: 'Contact Demo A', exact: true }).click();
    await expect(page.getByLabel('Heading')).toHaveValue(original);
    await ok(page, { required: ['DP-1.4-05', 'DP-1.4-08', 'DP-1.4-09', 'DP-1.4-17', 'DP-1.4-19'] });
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

    const mine = `5.4 flows ${RUN}`;
    await page.getByLabel('Heading').fill(mine);
    await expect(page.getByText(`${mine.length} of 90`)).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Saved');

    const after = await contact();
    expect(after.n, 'a save is one new version').toBe(before.n + 1);
    expect(heading(after.data)).toBe(mine);
    expect(after.published, 'the published version did not move').toBe(before.published);

    // History: the version list, Compare, and Restore as a new version (nothing deleted)
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Restore' })).toHaveCount((after.n) - 1);
    await ok(page, { required: ['DP-1.4-19', 'DP-1.4-20'] });
    await page.getByRole('button', { name: 'Compare' }).nth(1).click();
    await expect(page.locator('dl')).toContainText(original);
    await page.getByRole('button', { name: 'Restore' }).first().click();
    await expect(page.getByRole('status')).toContainText('Restored the version from');
    const restored = await contact();
    expect(restored.n, 'a restore is a new version').toBe(after.n + 1);
    expect(heading(restored.data), 'the restore put the old heading back').toBe(original);
  });

  test('a field over its limit turns the counter red and keeps Save off; a stale save shows the plan\'s sentence', async ({ page }) => {
    await installMutant(page, 'no-stale');
    await openContact(page);
    const before = await contact();
    const original = heading(before.data);

    await page.getByLabel('Heading').fill('x'.repeat(91));
    await expect(page.getByText('91 of 90')).toBeVisible();
    await expect(page.getByText('Heading is too long')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await ok(page, { required: ['DP-1.4-09'] });

    // someone else saves a newer version while this editor is open
    await saveAsOwner(before, `5.4 flows ${RUN} elsewhere`);
    const theirs = await contact();
    try {
      await page.getByLabel('Heading').fill(`5.4 flows ${RUN} mine`);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'saved a newer version at' })).toHaveText(/saved a newer version at \d\d:\d\d\. See their changes, then save again\.$/);
      expect((await contact()).n, 'the stale save wrote nothing').toBe(theirs.n);
      await ok(page, { required: ['DP-1.4-17'] });

      await page.getByRole('button', { name: 'See their changes' }).click();
      await expect(page.locator('dl')).toContainText(`5.4 flows ${RUN} elsewhere`);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('Saved');
      const last = await contact();
      expect(last.n, 'both versions are kept').toBe(theirs.n + 1);
      expect(heading(last.data)).toBe(`5.4 flows ${RUN} mine`);
    } finally {
      const now = await contact();
      if (heading(now.data) !== original) await saveAsOwner(now, original);
    }
  });

  test('an invalid draft stops the sheet at the failed check with Fix and the plan\'s sentence; the invalid row is removed afterwards', async ({ page }) => {
    await installMutant(page, 'publish-accepted');
    const token = await personAccessToken('owner-a');
    // a listing with only a street: it saves as a draft (draft mode checks types, not required fields) and cannot be published
    const made = await callAs(token, 'save', { workspace: WS.a.id, collection: 'listings', row: null, data: { street: `5.4 flows ${RUN} invalid` } });
    expect(made.status, `save of the invalid draft answered ${made.status}: ${made.text.slice(0, 120)}`).toBe(200);
    const bad = (made.json as { row: string }).row;
    try {
      await page.goto(`/w/${WS.a.slug}/site`);
      await expect(page.getByRole('link', { name: `5.4 flows ${RUN} invalid` })).toBeVisible();
      await page.getByRole('button', { name: /^Publish \d+ changes$/ }).click();
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByRole('heading')).toContainText(/^Publish these \d+ changes to /);
      await expect(sheet.getByRole('listitem').filter({ hasText: `5.4 flows ${RUN} invalid` })).toBeVisible();
      await ok(page, { required: ['DP-1.4c-01', 'DP-1.4c-02'] });
      await sheet.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(sheet.getByText('Nothing went live')).toBeVisible();
      await expect(sheet.getByText('I-REQUIRED').first()).toBeVisible();
      await ok(page, { required: ['DP-1.4c-04'] });
      expect((await serviceGet<unknown[]>(`/publish_jobs?workspace_id=eq.${WS.a.id}&rows=cs.{${bad}}&select=id`)).length, 'no job was started').toBe(0);
      await sheet.getByRole('button', { name: 'Fix' }).first().click();
      await expect(page).toHaveURL(/\/site\/listings\/[0-9a-f-]+\?field=/);
    } finally {
      const gone = await removeRows([bad]);
      expect(gone[0]?.ok, `the invalid row must be removed: ${gone[0]?.message}`).toBe(true);
    }
  });

  test('the publish sheet: the progress comes in live, the job ends done, the preview shows the new heading', async ({ page }) => {
    test.setTimeout(900_000);
    // every run starts from a known state: the never-published rows of workspace A are removed first (tests/support/reset-staging-drafts.mjs)
    const removed = await removeRows((await resetPlan()).remove.map(r => r.id));
    expect(removed.filter(r => !r.ok), 'the reset removed every row it meant to').toEqual([]);
    const c = await contact();

    const original = heading(c.data);
    const mine = `5.4 flows ${RUN} live`;
    await openContact(page);
    await page.getByLabel('Heading').fill(mine);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Saved');
    // the contact page and the one row the reset keeps (Agent Two, member-a2's team row) are waiting
    await page.getByRole('button', { name: /^Publish \d+ changes$/ }).click({ timeout: 30_000 });
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: 'Publish', exact: true }).click({ timeout: 30_000 });
    await expect(sheet.getByText(/Building the site|Nothing went live/)).toBeVisible({ timeout: 120_000 });
    if (await sheet.getByText('Nothing went live').isVisible()) throw new Error(`BLOCKED: the sheet stopped at a failed check: ${(await sheet.innerText()).replace(/\s+/g, ' ')}`);
    await expect(sheet.getByText('Checking')).toBeVisible({ timeout: 240_000 });
    await expect(sheet.getByText('Putting it live')).toBeVisible({ timeout: 240_000 });
    await expect(sheet.getByText(/^Live since \d\d:\d\d\./)).toBeVisible({ timeout: 480_000 });
    await ok(page, { required: ['DP-1.4c-03'] });
    const jobs = await serviceGet<{ state: string }[]>(`/publish_jobs?workspace_id=eq.${WS.a.id}&order=created_at.desc&limit=1&select=state`);
    expect(jobs[0]?.state).toBe('done');
    const res = await fetch('https://preview.test-site-demo-a.pages.dev/contact/', { signal: AbortSignal.timeout(30_000) });
    expect(await res.text()).toContain(mine);
    expect(original).not.toBe(mine);
  });
});

test.describe('the agent\'s Site screen', () => {
  test.use({ storageState: '.auth/member-a1.json' });

  test('an agent sees Add only on the collections marked own, and none of the owner-only groups', async ({ page }) => {
    await installMutant(page, 'agent-add-everywhere');
    const contractRows = await serviceGet<{ resolved: { collections: Record<string, { label: string; kind: string; access: { member: string } }> } }[]>(`/site_contracts?workspace_id=eq.${WS.a.id}&active=eq.true&select=resolved`);
    const cols = Object.entries(contractRows[0]!.resolved.collections).filter(([id, c]) => c.kind === 'collection' && !['pages', 'media', 'redirects'].includes(id));
    const own = cols.filter(([, c]) => c.access.member === 'own');
    const closed = cols.filter(([, c]) => c.access.member === 'none');
    expect(own.length, 'the test contract has an own collection').toBeGreaterThan(0);
    expect(closed.length, 'the test contract has an owner-only collection').toBeGreaterThan(0);

    await page.goto(`/w/${WS.a.slug}/site`);
    for (const [, c] of own) await expect(page.getByRole('heading', { name: c.label, exact: true })).toBeVisible();
    for (const [, c] of closed) await expect(page.getByRole('heading', { name: c.label, exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Add', exact: true })).toHaveCount(own.length);
    await expect(page.getByRole('link', { name: 'Business details' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Pages', exact: true })).toHaveCount(0);
    await ok(page, { required: ['DP-1.2s-04', 'DP-1.4-02', 'DP-1.4-06'], absent: ['DP-1.4-05', 'DP-1.4-07', 'DP-1.4-01'] });

    // the owner-only page is Not found for an agent, not an empty editor
    const contactId = (await contact()).id;
    await page.goto(`/w/${WS.a.slug}/site/pages/${contactId}`);
    await expect(page.getByText('Not found', { exact: true })).toBeVisible();
  });
});

test.describe('the owner sees Add on every collection', () => {
  test.use({ storageState: '.auth/owner-a.json' });

  test('Add is on each group, and a new item opens an empty editor', async ({ page }) => {
    await installMutant(page, 'contract-empty');
    await page.goto(`/w/${WS.a.slug}/site`);
    const adds = page.getByRole('link', { name: 'Add', exact: true });
    await expect(adds.first()).toBeVisible();
    expect(await adds.count()).toBeGreaterThan(2);
    await adds.first().click();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await ok(page, { required: ['DP-1.4-06', 'DP-1.4-08', 'DP-1.4-17'] });
  });
});
