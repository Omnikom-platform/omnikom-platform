// Watched-red mutants for tests/sign-out.spec.ts (book row B2), the way tests/search-mutants.ts works: a file of its own, so no other
// slice's Mutant union is touched. FLOWS_MUTANT=<name> breaks the sign-out from the test side; with no FLOWS_MUTANT nothing here runs.
//   logout-lost    the logout call is answered 204 by the test and never reaches the server: the page looks signed out, the session lives
//   session-kept   the browser's storage refuses to drop the session key
//   scope-global   the logout call goes out with scope=global: the other device of the same login is signed out too
import type { Page } from '@playwright/test';

export type SignOutMutant = 'logout-lost' | 'session-kept' | 'scope-global';
export const active = (name: SignOutMutant) => process.env.FLOWS_MUTANT === name;

export async function installSignOutMutant(page: Page) {
  if (active('logout-lost')) await page.route(/\/auth\/v1\/logout/, route => route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }));
  if (active('session-kept')) await page.addInitScript(() => {
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (this: Storage, key: string) {
      if (key !== 'omnikom-dashboard-auth') remove.call(this, key);
    };
  });
  if (active('scope-global')) await page.route(/\/auth\/v1\/logout/, route => {
    const url = new URL(route.request().url());
    url.searchParams.set('scope', 'global');
    return route.continue({ url: url.toString() });
  });
}
