// The DOM half of the plan gate (DECISIONS 44), on the screens this run visits: every interactive element and every piece of text sits
// inside an element with a data-plan id; every id is in the plan and belongs to a built slice; the ids a screen must show are there.
// The last test turns the gate on a page that breaks each rule on purpose and needs every one reported.
import { expect, test } from '@playwright/test';
import { builtSlices, planIds, planProblems } from './plan-gate.dom';
import { WS } from './support/staging';
import { makeOwnLead, removeOwnLeads } from './support/own-lead';

// The rows these screens show are this file's own (a test that needs a row makes one); the file's one afterAll removes them.
const TAG = 'plan-gate';
test.afterAll(async () => { await removeOwnLeads(TAG); });

const ok = async (page: import('@playwright/test').Page, o: Parameters<typeof planProblems>[1]) => expect(await planProblems(page, o)).toEqual([]);

test.describe('the sign-in screens (no login)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('sign in, password, wrong password, expired link, check your email', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Send me a sign-in link' })).toBeVisible();
    await ok(page, { required: ['DP-1.2-01', 'DP-1.2-02', 'DP-1.2-04'] });

    await page.getByLabel('Email').fill('not an email');
    await page.getByRole('button', { name: 'Send me a sign-in link' }).click();
    await expect(page.getByRole('alert')).toHaveText('Enter an email like name@example.com');
    await ok(page, { required: ['DP-1.2-01'] });

    // an address with no account looks exactly like a sent mail (no account discovery); no mail is sent to a nonexistent address
    await page.getByLabel('Email').fill('nobody-5-3@flows.invalid');
    await page.getByRole('button', { name: 'Send me a sign-in link' }).click();
    await expect(page.getByRole('status').first()).toHaveText('Check your email. The link works for 10 minutes.');
    await expect(page.getByRole('button', { name: 'Send it again' })).toBeDisabled();
    await ok(page, { required: ['DP-1.2-02', 'DP-1.2-03'] });

    await page.goto('/login');
    await page.getByRole('button', { name: 'Use a password instead' }).click();
    await ok(page, { required: ['DP-1.2-01', 'DP-1.2-05'] });
    await page.getByLabel('Email').fill('nobody-5-3@flows.invalid');
    await page.getByLabel('Password').fill('not the password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Email or password is wrong.');
    await ok(page, { required: ['DP-1.2-05'] });

    await page.goto('/login?expired=true');
    await expect(page.getByRole('alert')).toHaveText('That link expired. Send a new one.');
    await ok(page, { required: ['DP-1.2-06', 'DP-1.2-02'] });

    await expect(page).toHaveTitle('Sign in');
    await page.goto('/login?ended=true');
    await expect(page.getByRole('alert')).toHaveText('You were signed out. Sign in again.');
    await ok(page, { required: ['DP-1.2-13'] });

    await page.goto('/auth/confirm?token_hash=not-a-token&type=magiclink');
    await expect(page).toHaveURL(/\/login\?expired=true/);
    await expect(page.getByRole('alert')).toHaveText('That link expired. Send a new one.');
  });
});

test.describe('the owner\'s screens', () => {
  test.use({ storageState: '.auth/owner-a.json' });

  test('Leads, a lead, Add a lead', async ({ page }) => {
    await makeOwnLead(TAG, 'owner screens');
    await page.goto(`/w/${WS.a.slug}/leads`);
    await expect(page.getByRole('link', { name: 'Add a lead' })).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await ok(page, { required: ['DP-1.2s-01', 'DP-1.2s-03', 'DP-1.2-09', 'DP-1.3-02', 'DP-1.3-03', 'DP-1.3-04', 'DP-1.3-05', 'DP-1.3-06', 'DP-1.3-08', 'DP-1.3-26', 'DP-1.3-27', 'DP-1.3-28', 'DP-1.3-30', 'DP-1.3-36', 'DP-1.3-41'], absent: ['DP-1.2s-02', 'DP-1.3-01', 'DP-1.3-31'] });

    // a control's name is its label alone (a label around a select gives it every option's text): the screen reader hears exactly this
    await expect(page.getByRole('combobox', { name: 'Filter by', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Export layout', exact: true })).toBeVisible();

    // one lead ticked: the bar for an owner, then the delete sheet (nothing is sent: Cancel)
    await page.getByRole('checkbox', { name: /^Select / }).first().check();
    await expect(page.getByLabel('Set status')).toBeVisible();
    await ok(page, { required: ['DP-1.3-30', 'DP-1.3-31', 'DP-1.3-32', 'DP-1.3-33', 'DP-1.3-34'] });
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await ok(page, { required: ['DP-1.3-35'] });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Clear selection' }).click();

    // a filter on a column: the control, then the filter in use
    await page.getByLabel('Filter by').selectOption({ index: 1 });
    await ok(page, { required: ['DP-1.3-28'] });
    await page.getByLabel('Condition').selectOption('empty');
    await page.getByRole('button', { name: 'Add filter' }).click();
    await ok(page, { required: ['DP-1.3-28', 'DP-1.3-29'] });
    await page.getByRole('button', { name: 'Remove' }).click();

    await page.locator('tbody th a').first().click();
    await expect(page.locator('#lead-name')).toBeVisible();
    await expect(page.locator('ol li').first()).toBeVisible();   // the timeline has loaded
    await ok(page, { required: ['DP-1.3-11', 'DP-1.3-12', 'DP-1.3-13', 'DP-1.3-14', 'DP-1.3-15', 'DP-1.3-16', 'DP-1.3-17', 'DP-1.3-19', 'DP-1.3-20', 'DP-1.3-22', 'DP-1.3-23', 'DP-1.3-24', 'DP-1.3-37', 'DP-1.3-39', 'DP-1.3-40', 'DP-1.3-80'] });
    // a status that asks for something opens its boxes (nothing is sent: Cancel)
    await page.getByLabel('Status', { exact: true }).selectOption({ label: 'Call back' });
    await expect(page.getByLabel('Date', { exact: true })).toBeVisible();
    await ok(page, { required: ['DP-1.3-12', 'DP-1.3-81'] });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.locator('dl').getByRole('button', { name: /^Edit / }).first().click();   // a field's box, with Save and Cancel (nothing is saved)
    await ok(page, { required: ['DP-1.3-37'] });
    await page.locator('dl').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText(/^\d+ of 2000$/)).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    // no match: the plan's sentence and Show all
    await page.getByRole('searchbox', { name: 'Search' }).fill('zzzzzz');
    await expect(page.getByText('No leads match this filter.')).toBeVisible();
    await ok(page, { required: ['DP-1.3-21'] });
    await page.getByRole('button', { name: 'Show all' }).click();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await expect(page).toHaveTitle(/^(\(\d+\) )?Leads$/);
    await page.locator('tbody th a').first().click();

    await page.getByRole('link', { name: 'Add a lead' }).click();
    await expect(page.getByLabel('Notes')).toBeVisible();
    await ok(page, { required: ['DP-1.3b-01', 'DP-1.3b-02', 'DP-1.3b-03', 'DP-1.3b-04', 'DP-1.3b-05', 'DP-1.3b-06', 'DP-1.3b-07', 'DP-1.3b-08', 'DP-1.3b-09', 'DP-1.3-20'] });
  });

  test('Settings: the five cards, then the remove sheet and the leave sheet', async ({ page }) => {
    await page.goto(`/w/${WS.a.slug}/settings`);
    await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible();
    await expect(page.getByRole('listitem').first()).toBeVisible();   // the team list has loaded
    await expect(page.locator('[data-plan="DP-1.6-10"]')).toBeVisible();   // the Lead alerts card has its data: its form is rendered only then
    await ok(page, { required: ['DP-1.2s-05', 'DP-1.2s-09', 'DP-1.6-01', 'DP-1.6-02', 'DP-1.6-04', 'DP-1.6-07', 'DP-1.6-08', 'DP-1.6-09', 'DP-1.6-10'] });

    await page.getByRole('button', { name: 'Remove', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toContainText('Their leads and edits stay.');
    await ok(page, { required: ['DP-1.6-12'] });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await page.getByLabel('Addresses, one per line').first().fill('not-an-address');
    await expect(page.getByRole('alert').filter({ hasText: 'is not an email address.' })).toBeVisible();
    await ok(page, { required: ['DP-1.6-16'] });
    await page.getByRole('navigation').getByRole('link', { name: 'Leads' }).click();
    await expect(page.getByRole('dialog')).toContainText('Leave without saving?');
    await ok(page, { required: ['DP-1.6-18'] });
    await page.getByRole('button', { name: 'Stay', exact: true }).click();
  });
});

test.describe('the agent\'s screens', () => {
  test.use({ storageState: '.auth/member-a1.json' });

  test('an agent never sees the Owner control, and Not found for the other business', async ({ page }) => {
    await makeOwnLead(TAG, 'agent screens', true);
    await page.goto(`/w/${WS.a.slug}/leads`);
    await expect(page.locator('tbody th a').first()).toBeVisible();
    await ok(page, { required: ['DP-1.3-05', 'DP-1.3-26', 'DP-1.3-27', 'DP-1.3-28', 'DP-1.3-30'], absent: ['DP-1.3-41'] });
    await page.getByRole('checkbox', { name: /^Select / }).first().check();
    await expect(page.getByLabel('Set status')).toBeVisible();
    await ok(page, { required: ['DP-1.3-31', 'DP-1.3-32'], absent: ['DP-1.3-33', 'DP-1.3-34'] });
    await page.getByRole('button', { name: 'Clear selection' }).click();
    await page.locator('tbody th a').first().click();
    await expect(page.locator('#lead-name')).toBeVisible();
    await ok(page, { required: ['DP-1.3-11', 'DP-1.3-12', 'DP-1.3-15', 'DP-1.3-37'], absent: ['DP-1.3-13', 'DP-1.3-19'] });
    await page.getByRole('link', { name: 'Add a lead' }).click();
    await expect(page.getByLabel('Notes')).toBeVisible();
    await ok(page, { required: ['DP-1.3b-01', 'DP-1.3b-09'], absent: ['DP-1.3b-08'] });

    await page.goto(`/w/${WS.b.slug}/leads`);
    await expect(page.getByText('Not found', { exact: true })).toBeVisible();
    await ok(page, { required: ['DP-1.2s-06', 'DP-1.2s-11'] });
    await page.getByRole('link', { name: 'Go to your businesses' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${WS.a.slug}/leads`));   // one business: straight in
  });

  test('Settings: only Your account and Sign out everywhere', async ({ page }) => {
    await page.goto(`/w/${WS.a.slug}/settings`);
    await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible();
    await ok(page, { required: ['DP-1.2s-05', 'DP-1.2s-09', 'DP-1.6-08', 'DP-1.6-09'], absent: ['DP-1.6-01', 'DP-1.6-02', 'DP-1.6-04', 'DP-1.6-07', 'DP-1.6-10'] });
  });
});

test.describe('the Overview as the owner (slice 5.7)', () => {
  test.use({ storageState: '.auth/owner-a.json' });

  test('the cards, the title, and the Overview tab as the place the owner is in', async ({ page }) => {
    await page.goto(`/w/${WS.a.slug}`);
    await expect(page.getByText(/leads? this week$/)).toBeVisible();
    await expect(page.locator('[data-plan="DP-1.9-04"]').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How people find you', exact: true })).toBeVisible();
    await expect(page.locator('[data-plan="DP-1.9-06"]').first()).toBeVisible();
    await ok(page, { required: ['DP-1.2s-14', 'DP-1.9-01', 'DP-1.9-02', 'DP-1.9-03', 'DP-1.9-04', 'DP-1.9-05', 'DP-1.9-06', 'DP-1.9-07', 'DP-1.9-08'] });
    // staging holds no verified Search Console property and no writer of AI answers: those two cards say so, and show no zero
    const cards = page.locator('[data-plan="DP-1.9-08"]');
    await expect(cards.nth(0)).toContainText('Not connected yet');
    await expect(cards.nth(3)).toContainText('Not connected yet');
    await expect(page).toHaveTitle('Overview');
    const nav = page.getByRole('navigation');
    await expect(nav.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Leads', exact: true })).not.toHaveAttribute('aria-current', 'page');
  });
});

test.describe('the Overview as an agent (slice 5.7)', () => {
  test.use({ storageState: '.auth/member-a1.json' });

  test('the site card and the leads card (the agent counts their own)', async ({ page }) => {
    await page.goto(`/w/${WS.a.slug}`);
    await expect(page.getByText(/leads? this week$/)).toBeVisible();
    await ok(page, { required: ['DP-1.2s-14', 'DP-1.9-01', 'DP-1.9-02', 'DP-1.9-03', 'DP-1.9-05'], absent: ['DP-1.9-06', 'DP-1.9-07', 'DP-1.9-08'] });
  });
});

test.describe('the DOM gate itself', () => {
  test('reports every rule it has when a page breaks them (watched red)', async ({ page }) => {
    // a row of a slice that is not built, taken from the plan and built-slices.json (a hard-coded one goes stale when its slice ships)
    const built = builtSlices();
    const [unbuiltId, unbuiltSlice] = [...planIds()].find(([, slice]) => !built.includes(slice)) ?? ['', ''];
    expect(unbuiltId, 'the plan has a row of a slice that is not built').not.toBe('');
    await page.setContent(`<main>
      <button>No plan id</button>
      <p data-plan="DP-9.9-99">An id that is not in the plan</p>
      <p data-plan="${unbuiltId}">A row of a slice that is not built</p>
      <p>Text outside every plan element</p>
      <p data-plan="DP-1.2s-01">Lorem ipsum dolor</p>
      <input placeholder="Invented placeholder" />
    </main>`);
    const found = await planProblems(page, { required: ['DP-1.3-04'], absent: ['DP-1.2s-01'] });
    for (const want of [
      'interactive element outside any data-plan: <button>',
      'data-plan DP-9.9-99 is not in the plan',
      `data-plan ${unbuiltId} is a row of slice ${unbuiltSlice}, which is not built`,
      'text outside any data-plan: Text outside every plan element',
      'placeholder tell: Lorem ipsum dolor',
      'interactive element outside any data-plan: <input>',
      'placeholder="Invented placeholder"',
      'DP-1.3-04 is not on this screen',
      'DP-1.2s-01 must not be on this screen',
    ]) {
      expect(found.some(p => p.includes(want)), `the DOM gate must report: ${want}\n${found.join('\n')}`).toBe(true);
    }
    console.log(`DOM gate on the broken page reported ${found.length} problems, for example: ${found.slice(0, 3).join(' | ')}`);
  });
});
