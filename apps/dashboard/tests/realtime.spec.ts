// Realtime only where shown (book row E7, rule 34, KNOWN-5), read from the channel joins on the page's socket: the Site screen joins jobs once; the
// Leads screen joins leads and, while nothing publishes in workspace A, no jobs channel (the leads join is the control that the socket is heard).
import { expect, test, type Page } from '@playwright/test';
import { WS } from './support/staging';

/** The kind of each channel the page joins ("jobs", "leads", "events"), in order. */
function joins(page: Page): string[] {
  const seen: string[] = [];
  page.on('websocket', ws => ws.on('framesent', f => {
    const text = typeof f.payload === 'string' ? f.payload : f.payload.toString();
    const m = /realtime:([a-z]+)-/.exec(text);
    if (m?.[1] && text.includes('phx_join')) seen.push(m[1]);
  }));
  return seen;
}

test.describe('realtime only where shown (E7)', () => {
  test.use({ storageState: '.auth/owner-a.json' });

  test('the Site screen joins the jobs channel once', async ({ page }) => {
    const seen = joins(page);
    await page.goto(`/w/${WS.a.slug}/site`);
    await expect(page.getByRole('link', { name: 'Contact Demo A', exact: true })).toBeVisible();
    await expect.poll(() => seen.filter(k => k === 'jobs').length).toBeGreaterThan(0);
    await page.waitForTimeout(2000);   // a second reader's join would come within this
    expect(seen.filter(k => k === 'jobs')).toEqual(['jobs']);
  });

  test('the Leads screen joins leads and no jobs channel while nothing publishes', async ({ page }) => {
    const seen = joins(page);
    await page.goto(`/w/${WS.a.slug}/leads`);
    await expect(page.getByRole('link', { name: 'Add a lead' })).toBeVisible();
    await expect.poll(() => seen.filter(k => k === 'leads').length).toBeGreaterThan(0);
    await page.waitForTimeout(2000);
    expect(seen.filter(k => k === 'jobs')).toEqual([]);
  });
});
