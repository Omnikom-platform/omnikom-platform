// Watched-red mutants for tests/business-switch.spec.ts (book row B4), kept out of tests/mutants.ts (its Mutant union is the flows
// slice's line). FLOWS_MUTANT=<name> breaks, from the test side, what the flow proves; with no FLOWS_MUTANT nothing here runs.
//   picker-one   every members read answers its first row only: the login looks like it has one business and is sent straight in
//   switch-lost  the address change to the second business is dropped: the switcher is picked and the page stays where it was
//   stall        the read of the login's role never answers, and the test's limit is cut below the spec's bounded wait, so the test times out
import { test, type Page } from '@playwright/test';
import { WS } from './support/staging';

export type BusinessSwitchMutant = 'picker-one' | 'switch-lost' | 'stall';
export const active = (name: BusinessSwitchMutant) => process.env.FLOWS_MUTANT === name;

export async function installBusinessSwitchMutant(page: Page) {
  if (active('picker-one')) await page.route(/\/rest\/v1\/members\?/, async route => {
    const res = await route.fetch(), body = (await res.json()) as unknown;
    return route.fulfill({ response: res, json: Array.isArray(body) ? body.slice(0, 1) : body, headers: { ...res.headers(), 'access-control-allow-origin': '*' } });
  });
  if (active('switch-lost')) await page.addInitScript(slug => {
    const push = history.pushState.bind(history);
    history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
      if (!String(url).includes(`/w/${slug}`)) push(data, unused, url);
    };
  }, WS.b.slug);
  if (active('stall')) {
    test.setTimeout(20_000);
    await page.route(/\/rest\/v1\/members\?select=role/, () => {});
  }
}
