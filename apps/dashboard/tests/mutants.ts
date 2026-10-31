// Watched-red mutants for the flows (ground rule 10: a check is a test with a mutant). FLOWS_MUTANT=<name> breaks, from the test side,
// exactly the thing one flow claims to prove, and that flow must go red for its own reason. With no FLOWS_MUTANT nothing here runs.
//   leak-b           flow 1: B's workspace row is served to member-a1's page from a SERVICE-ROLE read, as if the wall were missing
//   no-live          flow 2: the Realtime socket is closed, so a new lead can only appear by a reload
//   member-sees-all  flow 3: member-a1's list of leads is served from a SERVICE-ROLE read (every lead of A, not only theirs)
import type { Page } from '@playwright/test';
import { serviceRepeat } from './support/staging';

export type Mutant = 'leak-b' | 'no-live' | 'member-sees-all';
export const MUTANT = (process.env.FLOWS_MUTANT ?? '') as Mutant | '';

export function active(name: Mutant): boolean {
  return MUTANT === name;
}

/** Answer matching requests from the page with the same request made as the service role (which ignores Row-Level Security). */
async function serveAsServiceRole(page: Page, urlPart: RegExp) {
  await page.route(urlPart, async route => {
    const req = route.request();
    if (req.method() !== 'GET') return route.continue();
    const r = await serviceRepeat(req.url(), req.headers().accept);
    return route.fulfill({ status: r.status, body: r.body, contentType: r.contentType });
  });
}

export async function installMutant(page: Page, name: Mutant) {
  if (!active(name)) return;
  if (name === 'leak-b') await serveAsServiceRole(page, /\/rest\/v1\/workspaces\?.*slug=eq\.test-demo-b/);
  if (name === 'member-sees-all') await serveAsServiceRole(page, /\/rest\/v1\/leads\?/);
  if (name === 'no-live') await page.routeWebSocket(/realtime/, ws => { void ws.close(); });
}
