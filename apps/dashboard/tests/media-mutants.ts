// Watched-red mutants for tests/media.spec.ts, the way tests/mutants.ts works: FLOWS_MUTANT=<name> breaks, from the test side, what one flow
// proves, and that flow must go red for its own reason. A file of its own: the flows and site-editor slices edit tests/mutants.ts.
//   photo-lost       B13: the editor's save goes out without the logo field, so the uploaded photo never reaches a version
import type { Page } from '@playwright/test';
export type MediaMutant = 'photo-lost';
export async function installMediaMutant(page: Page, name: MediaMutant) {
  if (process.env.FLOWS_MUTANT !== name) return;
  if (name === 'photo-lost') {
    await page.route(/\/functions\/v1\/save$/, route => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { data?: Record<string, unknown> };
      if (body.data) delete body.data.logo;
      return route.continue({ postData: JSON.stringify(body) });
    });
  }
}
