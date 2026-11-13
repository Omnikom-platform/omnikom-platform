// The slice 5.4 flows, against the STAGING project, in Edge, with the built dashboard (vite preview on localhost). Each finds things by role
// and label. Test data: only the contact page of the test site of workspace A (new versions; the heading is put back at the end of each
// flow that changes it). Nothing else on staging is changed. Each flow has a watched-red mutant in tests/mutants.ts.
import { expect, test, type Page } from '@playwright/test';
import { callAs, personAccessToken, RUN, serviceGet, WS } from './support/staging';
import { installMutant } from './mutants';
import { plan as resetPlan, removeRows } from './support/reset-staging-drafts.mjs';
import { planProblems } from './plan-gate.dom';
import { installSiteMutant } from './mutants';

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

  test('the list and the editor carry the plan, a save is a new version while the site stays as it is, and Restore and its Undo are new versions too', async ({ page }) => {
    await installMutant(page, 'save-lost');
    await installSiteMutant(page, 'undo-lost');
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
    await expect(page.getByRole('status').last()).toContainText('Saved');

    const after = await contact();
    expect(after.n, 'a save is one new version').toBe(before.n + 1);
    expect(heading(after.data)).toBe(mine);
    expect(after.published, 'the published version did not move').toBe(before.published);

    // History: the version list, Compare, Restore as a new version (nothing deleted), and the toast's Undo as one more
    await page.getByRole('button', { name: 'History', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Restore' })).toHaveCount((after.n) - 1);
    await ok(page, { required: ['DP-1.4-19', 'DP-1.4-20'] });
    await page.getByRole('button', { name: 'Compare' }).nth(1).click();
    await expect(page.locator('dl')).toContainText(original);
    await page.getByRole('button', { name: 'Restore' }).first().click();
    await expect(page.getByRole('status').last()).toContainText('Restored the version from');
    // Undo at once: the toast lasts 4 s (src/toast.tsx); the restore's version and the Undo's are read after it
    await page.getByRole('status').last().getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(page.getByRole('status').last()).toContainText('Saved');
    await expect(page.getByLabel('Heading')).toHaveValue(mine);
    const [restored] = await serviceGet<{ data: Record<string, unknown> }[]>(`/content_versions?row_id=eq.${after.id}&n=eq.${after.n + 1}&select=data`);
    expect(heading(restored?.data ?? {}), 'the restore put the old heading back as a new version').toBe(original);
    const undone = await contact();
    expect(undone.n, 'the Undo is a new version').toBe(after.n + 2);
    expect(heading(undone.data), 'the Undo put the pre-restore heading back').toBe(mine);
    await saveAsOwner(undone, original);   // the flow leaves the heading as it found it (this file's header)
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
      await expect(page.getByRole('status').last()).toContainText('Saved');
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
      await page.getByRole('button', { name: /^Publish \d+ changes?$/ }).click();
      const sheet = page.getByRole('dialog');
      await expect(sheet.getByRole('heading')).toContainText(/^Publish (these \d+ changes|this change) to /);
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
    test.setTimeout(1_800_000);   // the publish workflow's own limit (timeout-minutes: 30)
    // every run starts from a known state: the never-published rows of workspace A are removed first (tests/support/reset-staging-drafts.mjs)
    const removed = await removeRows((await resetPlan()).remove.map(r => r.id));
    expect(removed.filter(r => !r.ok), 'the reset removed every row it meant to').toEqual([]);
    const c = await contact();

    const original = heading(c.data);
    const mine = `5.4 flows ${RUN} live`;
    await openContact(page);
    await page.getByLabel('Heading').fill(mine);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').last()).toContainText('Saved');
    // the contact page and the one row the reset keeps (Agent Two, member-a2's team row) are waiting
    await page.getByRole('button', { name: /^Publish \d+ changes?$/ }).click({ timeout: 30_000 });
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: 'Publish', exact: true }).click({ timeout: 30_000 });
    await expect(sheet.getByText(/Building the site|Nothing went live/)).toBeVisible({ timeout: 600_000 });   // GitHub's runner can take minutes to pick the job up (2m05s and 3m18s on 2026-11-10); a queued job has no line yet
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

// ---------- book row B12: Delete on an item at phone width (slice S10): a marked draft listing, Cancel first, then the sheet; read back as the service role ----------
test.describe('B12 delete an item as the owner', () => {
  test.use({ storageState: '.auth/owner-a.json', viewport: { width: 390, height: 844 } });
  test('a marked listing is deleted through the sheet after a Cancel that sends nothing; it leaves the list and keeps its version', async ({ page }) => {
    await installSiteMutant(page, 'delete-lost');
    const street = `b12 ${RUN} delete`;
    const made = await callAs(await personAccessToken('owner-a'), 'save', { workspace: WS.a.id, collection: 'listings', row: null, data: { street } });
    expect(made.status, `save of the b12 listing answered ${made.status}: ${made.text.slice(0, 120)}`).toBe(200);
    const id = (made.json as { row: string }).row;
    const row = async () => (await serviceGet<{ deleted_at: string | null; published_version: number | null }[]>(`/content_rows?id=eq.${id}&select=deleted_at,published_version`))[0];
    try {
      await page.goto(`/w/${WS.a.slug}/site/listings/${id}`);
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('Its past versions stay in our records');
      await ok(page, { required: ['DP-1.4-21', 'DP-1.4-23'] });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 390 px').toBe(true);
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0); expect((await row())?.deleted_at, 'Cancel deleted nothing').toBeNull();
      await page.getByRole('button', { name: 'Delete', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Delete this item', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${WS.a.slug}/site/?$`));
      await expect(page.getByRole('status').last()).toContainText(`Deleted ${street}.`);
      await expect.poll(async () => (await row())?.deleted_at ?? null, { message: 'the row is deleted (deleted_at set)' }).not.toBeNull();
      expect((await serviceGet<unknown[]>(`/content_versions?row_id=eq.${id}&select=n`)).length, 'its version is kept').toBe(1);
      await expect(page.getByRole('link', { name: street })).toHaveCount(0);
    } finally {
      if (!(await row())?.deleted_at) { const gone = await removeRows([id]); expect(gone[0]?.ok, `the b12 row must be removed: ${gone[0]?.message}`).toBe(true); }
    }
  });
});

// ---------- book row B11: put the site back to an earlier publish at phone width (slice S10): two real publishes, read back as the service role ----------
test.describe('B11 put the site back as the owner', () => {
  test.use({ storageState: '.auth/owner-a.json', viewport: { width: 390, height: 844 } });
  test('an earlier publish comes back as new versions and goes live; the newer version is kept', async ({ page }) => {
    test.setTimeout(3_600_000); await installSiteMutant(page, 'restore-lost');   // two publishes, each within the workflow's 30 minutes
    const [earlier] = await serviceGet<{ finished_at: string; snapshot: Record<string, number> }[]>(`/publish_jobs?site_id=eq.${WS.a.site}&state=eq.done&preview=eq.false&order=finished_at.desc&limit=1&select=finished_at,snapshot`);
    if (!earlier) throw new Error('BLOCKED: the test site has no finished publish (run the publish sheet flow once)');
    const c = await contact();
    const [then] = await serviceGet<{ data: Record<string, unknown> }[]>(`/content_versions?row_id=eq.${c.id}&n=eq.${earlier.snapshot[c.id]}&select=data`);
    const old = heading(then?.data ?? {}), newer = `b11 ${RUN} newer`;
    await saveAsOwner(c, newer);
    try {
      const pub = await callAs(await personAccessToken('owner-a'), 'publish', { site: WS.a.site, rows: [c.id], versions: [c.n + 1] });
      expect(pub.status, `the newer publish answered ${pub.status}: ${pub.text.slice(0, 120)}`).toBe(202);
      await expect.poll(async () => (await serviceGet<{ state: string }[]>(`/publish_jobs?id=eq.${(pub.json as { job: string }).job}&select=state`))[0]?.state, { message: 'the newer publish ends done', timeout: 1_500_000, intervals: [15_000] }).toBe('done');
      await page.goto(`/w/${WS.a.slug}/site`); await page.getByRole('button', { name: 'Past publishes', exact: true }).click();
      await ok(page, { required: ['DP-1.4c-07', 'DP-1.4c-08'] });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 390 px').toBe(true);
      await page.getByRole('dialog').getByRole('listitem').filter({ has: page.locator(`time[datetime="${earlier.finished_at}"]`) }).getByRole('button', { name: 'Put the site back to this publish' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Put it back', exact: true }).click();
      await expect.poll(async () => heading((await contact()).data), { message: 'the earlier heading came back as a new version', timeout: 30_000 }).toBe(old);
      expect((await contact()).n, 'one new version on top of the newer one').toBe(c.n + 2);
      expect((await serviceGet<unknown[]>(`/content_versions?row_id=eq.${c.id}&n=eq.${c.n + 1}&select=n`)).length, 'the newer version is kept').toBe(1);
      await expect.poll(async () => (await contact()).published, { message: 'the restored version is the published one', timeout: 1_500_000, intervals: [15_000] }).toBe(c.n + 2);   // the sheet drops a job once it is done (PublishSheet.tsx:28-29)
      const shown = await (await fetch('https://preview.test-site-demo-a.pages.dev/contact/', { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(30_000) })).text();
      expect(shown, 'the published test site shows the earlier heading').toContain(old); expect(shown, 'and not the newer one').not.toContain(newer);
    } finally { const now = await contact(); if (heading(now.data) !== old) await saveAsOwner(now, old); }   // the saved heading is left as found (this file's header)
  });
});

// ---------- book row B15-a2: the instant frame at phone width (slice S10): a typed heading reaches the sandboxed frame ----------
test.describe('B15 the instant frame as the owner', () => {
  test.use({ storageState: '.auth/owner-a.json', viewport: { width: 390, height: 844 } });
  test('a typed heading shows in the frame with its section outlined, at phone then laptop width, and no site script is in it', async ({ page }) => {
    await installSiteMutant(page, 'frame-lost');
    const before = await contact(), typed = `b15 ${RUN} frame`;
    try {
      await page.goto(`/w/${WS.a.slug}/site/pages/${before.id}`);
      await page.getByLabel('Heading').fill(typed);
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      const frame = page.locator('iframe[title="Preview"]');
      await expect(frame, 'the frame shows the typed heading').toHaveAttribute('srcdoc', new RegExp(`<h1>${typed}</h1>`), { timeout: 15_000 });
      await expect(frame).toHaveAttribute('srcdoc', /<section data-changed class="contact">/);
      expect(await frame.getAttribute('srcdoc'), 'no site script in the frame').not.toMatch(/<script src=/);
      await expect(frame).toHaveAttribute('sandbox', ''); await expect(frame).toHaveAttribute('width', '390');
      await ok(page, { required: ['DP-1.4-18', 'DP-1.5-01', 'DP-1.5-02', 'DP-1.5-04'] });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 390 px').toBe(true);
      await page.getByRole('button', { name: 'Laptop', exact: true }).click(); await expect(frame).toHaveAttribute('width', '1366');
    } finally {
      await page.goto('about:blank');   // the editor's autosave (10 s idle) cannot fire after this
      const now = await contact(); if (heading(now.data) !== heading(before.data)) await saveAsOwner(now, heading(before.data));
    }
  });
});

// ---------- book row B15-b2 (slice S10): a refusal names what it left out; a saved heading reaches the draft address by its signed link, noindex, a bare address is 404 ----------
test.describe('B15 the preview site as the owner', () => {
  test.use({ storageState: '.auth/owner-a.json', viewport: { width: 390, height: 844 } });
  test('a refusal names the change left out; a saved heading shows through the signed link, noindex, and nothing without it; nothing goes live', async ({ page }) => {
    test.setTimeout(1_800_000); await installSiteMutant(page, 'preview-lost');   // one build, within the workflow's 30 minutes
    const c = await contact(), old = heading(c.data), draft = `b15 ${RUN} draft`, get = (u: string, cookie = '') => fetch(u, { headers: { 'cache-control': 'no-cache', ...(cookie ? { cookie } : {}) }, signal: AbortSignal.timeout(30_000) });
    const box = page.locator('[data-plan="DP-1.4c-09"]'), PUBLISH = /\/functions\/v1\/publish$/, press = () => page.getByRole('button', { name: 'Preview site', exact: true }).click();
    const refuse: Parameters<Page['route']>[1] = route => route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'NOTHING-TO-PREVIEW',
      message: 'Nothing can be previewed yet: no saved change is ready.', problems: [{ code: 'I-NOT-READY', path: 'sections.contact.heading', msg: 'Not filled in yet.', row: c.id }] }) });
    await saveAsOwner(c, draft);
    try {
      await page.goto(`/w/${WS.a.slug}/site`);
      await page.route(PUBLISH, refuse); await press();   // b1's 422 answered here: the screen's side (b1's Deno test proves the function's)
      await expect(box.getByRole('alert'), 'the plain refusal').toHaveText('Nothing can be previewed yet: no saved change is ready.');
      await expect(box.getByRole('listitem'), 'the change left out is named').toHaveText(['Contact Demo A: Heading is not filled in yet.']);
      await page.unroute(PUBLISH, refuse); await press();
      const line = box.getByRole('status');
      await expect(line, 'the preview build started').toContainText('Building the preview', { timeout: 30_000 });
      await ok(page, { required: ['DP-1.4c-09'] });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 390 px').toBe(true);
      await expect(line, 'the preview build ends ready').toContainText(/Preview from \d\d:\d\d\./, { timeout: 1_500_000 });
      const href = (await line.getByRole('link', { name: 'Open the preview' }).getAttribute('href')) ?? '';
      expect(href, 'the signed link').toMatch(/^https:\/\/draft\.test-site-demo-a\.pages\.dev\/\?k=[0-9a-f]{64}$/);
      const first = await fetch(href.replace('/?k=', '/contact/?k='), { redirect: 'manual', signal: AbortSignal.timeout(30_000) }), to = new URL(first.headers.get('location') ?? '', href);
      expect([first.status, to.pathname, to.searchParams.has('k')], 'the signed link: 302 to the same address, no token left (b3, R1)').toEqual([302, '/contact/', false]);
      const at = await get(to.href, (first.headers.get('set-cookie') ?? '').split(';')[0]);
      expect([at.status, at.headers.get('x-robots-tag') ?? ''], 'with its cookie: 200, noindex').toEqual([200, expect.stringMatching(/noindex/i)]);
      expect(await at.text(), 'the draft address shows the saved heading').toContain(draft);
      expect((await get('https://draft.test-site-demo-a.pages.dev/contact/')).status, 'without its link or cookie: a plain 404').toBe(404);
      await page.goto(href); await expect(page, 'the browser lands without the token').toHaveURL('https://draft.test-site-demo-a.pages.dev/'); await page.goto(to.href); await expect(page.locator('body'), 'its cookie opens the next page').toContainText(draft);
      expect(await (await get('https://preview.test-site-demo-a.pages.dev/contact/')).text(), 'the site address does not show it').not.toContain(draft);
      expect((await contact()).published, 'nothing was published').toBe(c.published);
    } finally { const now = await contact(); if (heading(now.data) !== old) await saveAsOwner(now, old); }   // the saved heading is left as found
  });
});

// ---------- book row B12 part b: a live listing taken off stays listed and marked, leaves the live site at the publish (its address is the site's 404 page), is put back ----------
test.describe('B12 take an item off the site as the owner', () => {
  test.use({ storageState: '.auth/owner-a.json', viewport: { width: 390, height: 844 } });
  test('taken off, marked, published away, the address answers 404, put back', async ({ page }) => {
    test.setTimeout(3_600_000); await installSiteMutant(page, 'off-lost');   // two publishes, each within the workflow's 30 minutes
    const reset = await removeRows((await resetPlan()).remove.map(r => r.id)); expect(reset.filter(r => !r.ok), 'the reset removed every row it meant to').toEqual([]);
    const seed = (await serviceGet<{ content_versions: { n: number; data: Record<string, unknown> }[] }[]>(`/content_rows?workspace_id=eq.${WS.a.id}&collection=eq.listings&deleted_at=is.null&off_site_at=is.null&published_version=not.is.null&select=content_versions(n,data)&limit=1`))[0];
    if (!seed) throw new Error('BLOCKED: staging workspace A has no live listing (sites/test-demo-a/stage.mjs)');
    const base = [...seed.content_versions].sort((a, b) => b.n - a.n)[0]!.data, street = `b12 ${RUN} off`, slug = `b12-off-${RUN}`, owner = await personAccessToken('owner-a'), addr = `https://preview.test-site-demo-a.pages.dev/listings/${slug}/`;
    const made = await callAs(owner, 'save', { workspace: WS.a.id, collection: 'listings', row: null, data: { ...base, street, slug, seo: { ...(base.seo as object), title: street, description: `${street}: a test listing of the B12 flow, taken off the site again.` } } });   // unique title and description (tools/audit/checks/met-002.mjs:24)
    expect(made.status, `save answered ${made.status}: ${made.text.slice(0, 120)}`).toBe(200); const id = (made.json as { row: string }).row;
    const row = async () => (await serviceGet<{ off_site_at: string | null; published_version: number | null }[]>(`/content_rows?id=eq.${id}&select=off_site_at,published_version`))[0];
    const live = (n: number | null, message: string) => expect.poll(async () => (await row())?.published_version ?? null, { message, timeout: 1_500_000, intervals: [15_000] }).toBe(n);
    try {
      expect((await callAs(owner, 'publish', { site: WS.a.site, rows: [id], versions: [1] })).status, 'the first publish is taken').toBe(202); await live(1, 'live after the first publish');
      expect((await fetch(addr, { signal: AbortSignal.timeout(30_000) })).status, 'the listing answers at its address').toBe(200);
      await page.goto(`/w/${WS.a.slug}/site/listings/${id}`); await page.getByRole('button', { name: 'Take off the site', exact: true }).click();
      await expect(page.getByRole('status').last()).toContainText(`Taken off the site: ${street}.`); await ok(page, { required: ['DP-1.4-24'] });
      await expect.poll(async () => (await row())?.off_site_at ?? null, { message: 'the row is marked off the site (off_site_at set)' }).not.toBeNull(); expect((await row())?.published_version, 'still live').toBe(1);
      await page.goto(`/w/${WS.a.slug}/site`); await expect(page.getByRole('listitem').filter({ hasText: street })).toContainText('off the site'); await ok(page, { required: ['DP-1.4-25'] });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 390 px').toBe(true);
      await page.getByRole('button', { name: /^Publish \d+ changes?$/ }).click({ timeout: 30_000 }); const sheet = page.getByRole('dialog');
      await expect(sheet.getByRole('listitem').filter({ hasText: street })).toContainText('leaves the site'); await ok(page, { required: ['DP-1.4c-10'] });
      await sheet.getByRole('button', { name: 'Publish', exact: true }).click(); await live(null, 'off the live site after the publish');
      const gone = await fetch(addr, { signal: AbortSignal.timeout(30_000) }); expect(gone.status, 'its address answers 404').toBe(404); expect(await gone.text(), 'the site\'s own 404 page').toContain('Page not found: ');
      await page.goto(`/w/${WS.a.slug}/site/listings/${id}`); await page.getByRole('button', { name: 'Put back on the site', exact: true }).click();
      await expect.poll(async () => (await row())?.off_site_at ?? null, { message: 'put back (off_site_at cleared)' }).toBeNull();
    } finally { if (((await row())?.published_version ?? null) === null) { const left = await removeRows([id]); expect(left[0]?.ok, `the b12 row must be removed: ${left[0]?.message}`).toBe(true); } }   // still live after a red: the run sheet's undo
  });
});
