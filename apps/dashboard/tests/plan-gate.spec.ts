// The DOM half of the plan gate (DECISIONS 44), on the screens this run visits: every interactive element and every piece of text sits
// inside an element with a data-plan id; every id is in the plan and belongs to a built slice; the ids a screen must show are there.
// The last test turns the gate on a page that breaks each rule on purpose and needs every one reported.
import { expect, test } from '@playwright/test';
import { planProblems } from './plan-gate.dom';
import { WS } from './support/staging';

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
    await page.goto(`/w/${WS.a.slug}/leads`);
    await expect(page.getByRole('link', { name: 'Add a lead' })).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await ok(page, { required: ['DP-1.2s-01', 'DP-1.2s-03', 'DP-1.2-09', 'DP-1.3-02', 'DP-1.3-03', 'DP-1.3-04', 'DP-1.3-06'], absent: ['DP-1.2s-02', 'DP-1.3-01'] });

    await page.locator('tbody th a').first().click();
    await expect(page.locator('#lead-name')).toBeVisible();
    await expect(page.locator('ol li').first()).toBeVisible();   // the timeline has loaded
    await ok(page, { required: ['DP-1.3-11', 'DP-1.3-12', 'DP-1.3-13', 'DP-1.3-14', 'DP-1.3-15', 'DP-1.3-16', 'DP-1.3-17', 'DP-1.3-20', 'DP-1.3-22', 'DP-1.3-23', 'DP-1.3-24'] });
    await expect(page.getByText(/^\d+ of 2000$/)).toBeVisible();
    await page.getByRole('button', { name: 'X', exact: true }).click();

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
});

test.describe('the agent\'s screens', () => {
  test.use({ storageState: '.auth/member-a1.json' });

  test('an agent never sees the Owner control, and Not found for the other business', async ({ page }) => {
    await page.goto(`/w/${WS.a.slug}/leads`);
    await expect(page.locator('tbody th a').first()).toBeVisible();
    await page.locator('tbody th a').first().click();
    await expect(page.locator('#lead-name')).toBeVisible();
    await ok(page, { required: ['DP-1.3-11', 'DP-1.3-12', 'DP-1.3-15'], absent: ['DP-1.3-13'] });
    await page.getByRole('link', { name: 'Add a lead' }).click();
    await expect(page.getByLabel('Notes')).toBeVisible();
    await ok(page, { required: ['DP-1.3b-01', 'DP-1.3b-09'], absent: ['DP-1.3b-08'] });

    await page.goto(`/w/${WS.b.slug}/leads`);
    await expect(page.getByText('Not found', { exact: true })).toBeVisible();
    await ok(page, { required: ['DP-1.2s-06', 'DP-1.2s-11'] });
    await page.getByRole('link', { name: 'Go to your businesses' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${WS.a.slug}/leads`));   // one business: straight in
  });
});

test.describe('the DOM gate itself', () => {
  test('reports every rule it has when a page breaks them (watched red)', async ({ page }) => {
    await page.setContent(`<main>
      <button>No plan id</button>
      <p data-plan="DP-9.9-99">An id that is not in the plan</p>
      <p data-plan="DP-1.2s-04">A row of a slice that is not built</p>
      <p>Text outside every plan element</p>
      <p data-plan="DP-1.2s-01">Lorem ipsum dolor</p>
      <input placeholder="Invented placeholder" />
    </main>`);
    const found = await planProblems(page, { required: ['DP-1.3-04'], absent: ['DP-1.2s-01'] });
    for (const want of [
      'interactive element outside any data-plan: <button>',
      'data-plan DP-9.9-99 is not in the plan',
      'data-plan DP-1.2s-04 is a row of slice 5.4, which is not built',
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
