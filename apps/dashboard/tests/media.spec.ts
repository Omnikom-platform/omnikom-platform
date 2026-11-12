// Slice S11 (book rows B13, C8, B14): photos, against the STAGING project, in Edge, with the built dashboard (vite preview), at 390 px. Each test
// draws its own photo (two flat colours: no person, no file from anyone); workspace A only; each test puts back or removes what it changed.
import { expect, test, type Page } from '@playwright/test';
import { callAs, personAccessToken, RUN, serviceGet, WS } from './support/staging';
import { plan as resetPlan, removeRows } from './support/reset-staging-drafts.mjs';
import { planProblems } from './plan-gate.dom';
import { installMediaMutant } from './media-mutants';
const ok = async (page: Page, o: Parameters<typeof planProblems>[1]) => expect(await planProblems(page, o)).toEqual([]);
const PREVIEW = 'https://preview.test-site-demo-a.pages.dev';   // the test site's preview branch (factory/lib/launch.mjs originOf)
/** A PNG of w x h px drawn in the page: the test's own photo. */
async function testPhoto(page: Page, w: number, h: number): Promise<Buffer> {
  return Buffer.from(await page.evaluate(async ([w, h]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d')!; g.fillStyle = '#2f6f8f'; g.fillRect(0, 0, w, h); g.fillStyle = '#f2c14e'; g.fillRect(w / 4, h / 4, w / 2, h / 2);
    const blob = await new Promise<Blob>((done, fail) => c.toBlob(b => (b ? done(b) : fail(new Error('no PNG'))), 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, [w, h] as const));
}
/** The Business details row of workspace A at its newest version, as the service role reads it (the truth the screen is compared with). */
async function settings(): Promise<{ id: string; n: number; data: Record<string, unknown> }> {
  const rows = await serviceGet<{ id: string; content_versions: { n: number; data: Record<string, unknown> }[] }[]>(
    `/content_rows?workspace_id=eq.${WS.a.id}&collection=eq.settings&deleted_at=is.null&select=id,content_versions(n,data)`);
  const newest = [...(rows[0]?.content_versions ?? [])].sort((a, b) => b.n - a.n)[0];
  if (!rows[0] || !newest) throw new Error('BLOCKED: staging workspace A has no Business details row (sites/test-demo-a/stage.mjs)');
  return { id: rows[0].id, n: newest.n, data: newest.data };
}
test.describe('B13 a photo from the editor to the published site', () => {
  test.use({ storageState: '.auth/owner-a.json', viewport: { width: 390, height: 844 } });
  test('a photo drawn here becomes the logo: uploaded in the slot, saved with its alt text, processed, published, served as WebP', async ({ page }) => {
    test.setTimeout(2_700_000);   // the media job on GitHub (minutes) and the publish workflow (timeout-minutes: 30)
    await installMediaMutant(page, 'photo-lost');
    const removed = await removeRows((await resetPlan()).remove.map(r => r.id));   // the sheet publishes every waiting draft (README "Staging data")
    expect(removed.filter(r => !r.ok), 'the reset removed every row it meant to').toEqual([]);
    const before = await settings();
    const alt = `b13 ${RUN} logo`;
    try {
      await page.goto(`/w/${WS.a.slug}/site/settings/${before.id}?field=logo`);
      const slot = page.locator('[data-plan="DP-1.4-11"][data-path="logo"]');
      await expect(slot).toBeVisible();
      const png = await testPhoto(page, 1000, 600);
      const started = page.waitForResponse(r => r.url().endsWith('/functions/v1/upload-start') && r.request().method() === 'POST');
      const finished = page.waitForResponse(r => r.url().endsWith('/functions/v1/upload-finish') && r.request().method() === 'POST');
      await slot.locator('input[type="file"]').setInputFiles({ name: `b13-${RUN}.png`, mimeType: 'image/png', buffer: png });
      const media = ((await (await started).json()) as { media: string }).media;
      expect((await finished).status(), 'upload-finish answered').toBe(200);
      await expect(slot.getByText('Preparing sizes', { exact: true })).toBeVisible();   // the new file's own state, not the old logo's "Ready"
      await slot.getByLabel('Alt text').fill(alt);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect.poll(async () => (await settings()).data.logo, { message: 'the saved version holds the uploaded photo and its alt text' }).toEqual({ asset: media, alt });
      await ok(page, { required: ['DP-1.4-11', 'DP-1.4-17'] });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 390 px').toBe(true);
      await expect(slot.getByText('Ready', { exact: true })).toBeVisible({ timeout: 900_000 });   // media.yml on GitHub: pick-up, npm ci, sharp
      const [m] = await serviceGet<{ processed: boolean; exif_stripped: boolean; width: number }[]>(`/media?id=eq.${media}&select=processed,exif_stripped,width`);
      expect(m, 'the runner processed it and says EXIF is stripped').toEqual({ processed: true, exif_stripped: true, width: 1000 });
      await page.goto(`/w/${WS.a.slug}/site`);
      await page.getByRole('button', { name: /^Publish \d+ changes?$/ }).click({ timeout: 30_000 });
      const sheet = page.getByRole('dialog');
      await sheet.getByRole('button', { name: 'Publish', exact: true }).click({ timeout: 30_000 });
      await expect(sheet.getByText(/^Live since \d\d:\d\d\.|Nothing went live/)).toBeVisible({ timeout: 1_500_000 });
      if (await sheet.getByText('Nothing went live').isVisible()) throw new Error(`BLOCKED: the sheet stopped at a failed check: ${(await sheet.innerText()).replace(/\s+/g, ' ')}`);
      const file = `/media/${WS.a.id}/${media}-800.webp`;   // a 1000 px original: its widest slot (supabase/functions/_shared/storage.ts derivativeSlot)
      const home = await (await fetch(`${PREVIEW}/`, { signal: AbortSignal.timeout(30_000) })).text();
      expect(home, 'the published page shows the photo with its alt text').toContain(`<img src="${file}" alt="${alt}" width="40" height="40">`);
      const res = await fetch(`${PREVIEW}${file}`, { signal: AbortSignal.timeout(30_000) });
      expect(res.status, 'the photo is served').toBe(200);
      expect(res.headers.get('content-type') ?? '', 'as WebP').toMatch(/^image\/webp/);
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes.toString('latin1', 0, 4) + bytes.toString('latin1', 8, 12), 'a WebP file, not the PNG').toBe('RIFFWEBP');
    } finally {
      const now = await settings();   // the old logo back as a new version; the next publish puts it live
      if (JSON.stringify(now.data.logo) !== JSON.stringify(before.data.logo)) {
        const r = await callAs(await personAccessToken('owner-a'), 'save', { workspace: WS.a.id, collection: 'settings', row: now.id, base: now.n, data: { ...now.data, logo: before.data.logo } });
        expect(r.status, `the old logo must be saved back: ${r.text.slice(0, 120)}`).toBe(200);
      }
    }
  });
});
