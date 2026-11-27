// B2 Sign out (DP-1.2-09): the rail's Sign out ends THIS device's session, in the browser and on the server; another device of the same
// login stays signed in ("Sign out everywhere", B3 in flows.spec.ts, is the one that ends them all). Against staging, like flows.spec.ts.
// Every sign-in here is freshly minted for the test, never a saved .auth state: a sign-out must not end a session another spec uses.
// No token, hash or refresh token is ever put in a title, a message or an expect: only status numbers and booleans are compared.
import { expect, test, type Page } from '@playwright/test';
import { mintTokenHash, need, supabaseUrl, WS, type Person } from './support/staging';
import { installSignOutMutant } from './sign-out-mutants';

const SESSION_KEY = 'omnikom-dashboard-auth';   // src/supabase.ts storageKey
const NO_STATE = { cookies: [], origins: [] };

test.use({ storageState: NO_STATE });

/** A fresh sign-in through the app's own email-link path, as flows.spec.ts "sign out everywhere" does. */
async function signInFresh(page: Page, person: Person) {
  const hash = await mintTokenHash(person);
  try {
    await page.goto(`/auth/confirm?token_hash=${encodeURIComponent(hash)}&type=magiclink`);
    await page.waitForURL(new RegExp(`/w/${WS.a.slug}/leads`), { timeout: 30_000 });
  } catch (e) {
    // the token hash is in the address: keep it out of the message
    throw new Error(`sign-in through /auth/confirm failed for ${person}: ${String((e as Error).message ?? e).split(hash).join('[token]').slice(0, 600)}`);
  }
}

/** The refresh token this browser keeps. It stays in a variable of the test. */
async function refreshTokenOf(page: Page): Promise<string> {
  const token = await page.evaluate(key => (JSON.parse(localStorage.getItem(key) ?? 'null') as { refresh_token?: string } | null)?.refresh_token ?? '', SESSION_KEY);
  expect(token.length > 0, 'the signed-in browser keeps a refresh token').toBe(true);
  return token;
}

/** Asks Auth itself whether a refresh token still works. Only the status comes back. A yes rotates the token: ask once per token. */
async function probe(refreshToken: string): Promise<number> {
  const res = await fetch(`${supabaseUrl()}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: need('STAGING_SUPABASE_PUBLISHABLE_KEY') },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(30_000),
  });
  await res.arrayBuffer();
  return res.status;
}

test('B2 control: a login that did not sign out still refreshes', async ({ page }) => {
  await signInFresh(page, 'member-a1');
  expect(await probe(await refreshTokenOf(page)), 'the probe answers yes for a live session').toBe(200);
});

test('B2 Sign out ends the session', async ({ page, browser, baseURL }) => {
  // the same login on a second device: its refresh token is read, then its browser is closed (the server session lives on)
  const other = await browser.newContext({ baseURL, storageState: NO_STATE });
  let otherToken = '';
  try {
    const otherPage = await other.newPage();
    await signInFresh(otherPage, 'member-a2');
    otherToken = await refreshTokenOf(otherPage);
  } finally {
    await other.close();
  }

  await installSignOutMutant(page);
  await signInFresh(page, 'member-a2');
  const ownToken = await refreshTokenOf(page);
  expect(ownToken !== otherToken, 'the two devices hold two different sessions').toBe(true);

  await page.getByRole('navigation').getByRole('button', { name: 'Sign out', exact: true }).click();
  // a person's own sign-out is the bare sign-in card: no "ended" in the address, no "You were signed out" sentence (that is B3)
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByText('You were signed out. Sign in again.')).toHaveCount(0);
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key) === null, SESSION_KEY), { message: 'nothing of the session is kept in storage' }).toBe(true);
  await page.goto(`/w/${WS.a.slug}/leads`);
  await expect(page).toHaveURL(/\/login$/);

  const own = await probe(ownToken);
  expect(own >= 400 && own < 500 && own !== 429, `the old refresh token is refused after Sign out (status ${own})`).toBe(true);
  expect(await probe(otherToken), 'the other device of the same login stays signed in').toBe(200);
});
