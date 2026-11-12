// Watched-red mutants of the Search health page and of the Overview's numbers (book row B24, slice S13), kept out of tests/mutants.ts (its Mutant
// union is the flows slice's line). FLOWS_MUTANT=<name> breaks one read from the test side; with no FLOWS_MUTANT nothing here runs.
//   audit-lost     the page's site-audit call is answered 500: the site check and the history say so, the numbers stay
//   metrics-lost   every metrics_snapshots read is answered 500: the numbers say so, the site check stays (the page and the Overview)
//   no-check-answer  the owner's "before the first check" test leaves out its own "no check yet" answer: the real check comes, the Overview shows its link
import type { Page } from '@playwright/test';

export type SearchMutant = 'audit-lost' | 'metrics-lost';
export async function installSearchMutant(page: Page, name: SearchMutant) {
  if (process.env.FLOWS_MUTANT !== name) return;
  const fail = { status: 500, contentType: 'application/json', body: JSON.stringify({ message: name }), headers: { 'access-control-allow-origin': '*' } };
  if (name === 'audit-lost') await page.route(/\/functions\/v1\/site-audit$/, route => route.fulfill(fail));
  if (name === 'metrics-lost') await page.route(/\/rest\/v1\/metrics_snapshots\?/, route => route.fulfill(fail));
}
