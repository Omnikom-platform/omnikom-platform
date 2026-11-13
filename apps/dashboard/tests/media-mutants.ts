// Watched-red mutants for tests/media.spec.ts, the way tests/mutants.ts works: FLOWS_MUTANT=<name> breaks, from the test side, what one flow
// proves, and that flow must go red for its own reason. A file of its own: the flows and site-editor slices edit tests/mutants.ts.
//   photo-lost       B13: the editor's save goes out without the logo field, so the uploaded photo never reaches a version
//   library-rights   B14-a2: the library's file records come back with the rights box ticked
//   library-all      B14-a2: a member's library asks for every file of the business (its uploaded_by filter dropped)
//   library-hidden   B14-a2: the item rows come back without those no team row owns, so a use the member cannot open is not counted
//   replace-lost     B14-c2: the replace call is answered "2 items" by the test and never reaches the server
//   member-as-owner  B14-c2: the member's role comes back as owner, so the screen offers Replace and Delete
//   sheet-narrow     B14-c2: a style added by the test takes the phone rule off a sheet's buttons (each as wide as its words again)
import type { Page } from '@playwright/test';
export type MediaMutant = 'photo-lost' | 'library-rights' | 'library-all' | 'library-hidden' | 'replace-lost' | 'member-as-owner' | 'sheet-narrow';
export async function installMediaMutant(page: Page, name: MediaMutant) {
  if (process.env.FLOWS_MUTANT !== name) return;
  if (name === 'photo-lost') {
    await page.route(/\/functions\/v1\/save$/, route => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { data?: Record<string, unknown> };
      if (body.data) delete body.data.logo;
      return route.continue({ postData: JSON.stringify(body) });
    });
  }
  if (name === 'library-rights') await page.route(/\/rest\/v1\/media\?/, async route => {
    const res = await route.fetch(), body = (await res.json()) as Record<string, unknown>[] | Record<string, unknown> | null;
    const tick = (m: Record<string, unknown>) => ({ ...m, rights_confirmed: true });
    return route.fulfill({ response: res, json: Array.isArray(body) ? body.map(tick) : body ? tick(body) : body });
  });
  if (name === 'library-all') await page.route(/\/rest\/v1\/media\?.*uploaded_by=eq\./, route => route.continue({ url: route.request().url().replace(/&uploaded_by=eq\.[0-9a-f-]+/, '') }));
  if (name === 'library-hidden') await page.route(/\/rest\/v1\/content_rows\?/, async route => {
    const res = await route.fetch(), rows = (await res.json()) as { owner_team_row?: unknown }[];
    return route.fulfill({ response: res, json: rows.filter(r => r.owner_team_row !== null) });
  });
  if (name === 'replace-lost') {
    await page.route(/\/functions\/v1\/media-manage$/, route => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { action?: string };
      if (body.action !== 'replace') return route.continue();
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ versions: 2 }) });
    });
  }
  if (name === 'member-as-owner') {
    await page.route(/\/rest\/v1\/members\?select=role/, async route => {
      const res = await route.fetch();
      const body = (await res.json()) as Record<string, unknown>[] | Record<string, unknown> | null;
      const owner = (m: Record<string, unknown>) => ({ ...m, role: 'owner' });
      return route.fulfill({ response: res, json: Array.isArray(body) ? body.map(owner) : body ? owner(body) : body });
    });
  }
  if (name === 'sheet-narrow') {
    await page.addInitScript(() => {
      const s = document.createElement('style');
      s.textContent = '[class*="sheetButtons"] > button { width: auto !important; }';
      document.addEventListener('DOMContentLoaded', () => document.head.appendChild(s));
    });
  }
}
