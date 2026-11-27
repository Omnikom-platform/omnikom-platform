// Watched-red mutants for tests/site-switcher.spec.ts (book row A26), the way tests/mutants.ts works: FLOWS_MUTANT=<name> breaks, from the
// test side, what the flows prove. A file of its own: the flows and site-editor slices edit tests/mutants.ts. With no FLOWS_MUTANT nothing runs.
//   sites-one            the page's read of the sites comes back with the first one only: no switcher, T2 to T4 go red, T1 (the control) stays green
//   site-filter-dropped  the site entry is taken out of the page's lead-list filters: the lead stays after the pick, T2 goes red
//   stall                the page's read of the sites never answers and the test's limit is 12 s, under the 15 s bounded waits:
//                        every test ends by "Test timeout", T2 to T4 with their second site already made, and none may be left
import { test, type Page } from '@playwright/test';

export type SiteSwitcherMutant = 'sites-one' | 'site-filter-dropped' | 'stall';
export function active(name: SiteSwitcherMutant): boolean {
  return process.env.FLOWS_MUTANT === name;
}

export async function installSiteSwitcherMutant(page: Page) {
  if (active('stall')) {
    // cut here, in the test's own flow (called from inside a route handler it did not take): 12 s from the test's start, so a wait
    // that begins after the goto cannot reach its own 15 s first
    test.setTimeout(12_000);
    await page.route(/\/rest\/v1\/sites\?/, () => {});
  }
  if (active('sites-one')) {
    await page.route(/\/rest\/v1\/sites\?/, async route => {
      const response = await route.fetch();
      const rows = (await response.json()) as unknown;
      return route.fulfill({ response, json: Array.isArray(rows) ? rows.slice(0, 1) : rows });
    });
  }
  if (active('site-filter-dropped')) {
    await page.route(/\/functions\/v1\/lead-list$/, route => {
      const data = route.request().postData();
      if (!data) return route.continue();
      const body = JSON.parse(data) as { filters?: { field: string }[] };
      if (body.filters) body.filters = body.filters.filter(f => f.field !== 'site');
      return route.continue({ postData: JSON.stringify(body) });
    });
  }
}
