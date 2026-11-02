// Slice 5-DS: the design system is loaded on every screen (03-FRONTEND.md B5). On each screen, at the phone size 390x844 and the
// owner's laptop size 1536x730: the document has a stylesheet with rules, the screen has an h1 and every h1 is Poppins at weight
// 600 with the Poppins face really loaded, no visible text is under 14 px, and on the laptop a card (the element marked data-card)
// has at least 28 px of inner padding on every side.
// Read-only against staging: it opens screens as owner-a and changes nothing. The publish sheet needs a waiting change to open;
// when staging has none, the test answers the page's own `drafts` call with one change to the contact page (nothing is written).
// SHOTS=<folder> also saves a PNG of each screen at each size (viewport only, the size the owner looks at) and the measured text
// sizes of the screen (<screen>-<w>x<h>-text.json).
//   FLOWS_MUTANT=no-styles  the page is served an empty stylesheet (the import of the styles dropped): every test here must go red
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PEOPLE, WS } from './support/staging';
import { installMutant } from './mutants';

const SIZES = [
  { name: 'phone', width: 390, height: 844, desktop: false },
  { name: 'laptop', width: 1536, height: 730, desktop: true },
] as const;
type Size = (typeof SIZES)[number];

type Look = {
  sheets: number; h1: number; h1Fonts: string[]; h1Weights: string[]; poppinsLoaded: boolean; card: boolean; pad: number;
  sizes: { px: number; tag: string; text: string }[];
};

async function look(page: Page): Promise<Look> {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const sheets = [...document.styleSheets].filter(s => { try { return s.cssRules.length > 0; } catch { return false; } }).length;
    const h1s = [...document.querySelectorAll('h1')];
    const poppinsLoaded = [...document.fonts].some(f => f.family.replace(/["']/g, '') === 'Poppins' && f.status === 'loaded' && f.weight === '600');
    const card = document.querySelector('[data-card]');
    const ccs = card ? getComputedStyle(card) : null;
    const pad = ccs ? Math.min(parseFloat(ccs.paddingTop), parseFloat(ccs.paddingRight), parseFloat(ccs.paddingBottom), parseFloat(ccs.paddingLeft)) : -1;
    // every element that draws text of its own and is on screen (not display:none, not clipped away to 1 px)
    const sizes: { px: number; tag: string; text: string }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
      const el = n.parentElement;
      if (!text || !el) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1 || !el.checkVisibility({ visibilityProperty: true })) continue;
      sizes.push({ px: parseFloat(getComputedStyle(el).fontSize), tag: el.tagName.toLowerCase(), text: text.slice(0, 40) });
    }
    return {
      sheets, h1: h1s.length, h1Fonts: h1s.map(h => getComputedStyle(h).fontFamily), h1Weights: h1s.map(h => getComputedStyle(h).fontWeight),
      poppinsLoaded, card: Boolean(card), pad, sizes,
    };
  });
}

async function check(page: Page, screen: string, size: Size) {
  // the entrance motion has ended (a picture mid-fade shows the page through a sheet)
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().map(a => a.finished)); });
  const l = await look(page);
  const dir = process.env.SHOTS;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `${screen}-${size.width}x${size.height}.png`) });
    const bySize: Record<string, string[]> = {};
    for (const s of l.sizes) (bySize[`${s.px}px`] ??= []).length < 6 && bySize[`${s.px}px`]!.push(`${s.tag}: ${s.text}`);
    writeFileSync(join(dir, `${screen}-${size.width}x${size.height}-text.json`), JSON.stringify(bySize, null, 1));
  }
  expect(l.sheets, `${screen}: the document has no loaded stylesheet with rules`).toBeGreaterThan(0);
  expect(l.h1, `${screen}: the screen has an h1`).toBeGreaterThan(0);
  for (const f of l.h1Fonts) expect(f, `${screen}: the h1 font-family starts with Poppins`).toMatch(/^"?Poppins"?(,|$)/);
  for (const w of l.h1Weights) expect(w, `${screen}: the h1 is weight 600`).toBe('600');
  expect(l.poppinsLoaded, `${screen}: the Poppins 600 face loaded`).toBe(true);
  const small = l.sizes.filter(s => s.px < 14).map(s => `${s.px}px ${s.tag} "${s.text}"`);
  expect(small, `${screen}: no visible text under 14 px`).toEqual([]);
  if (size.desktop) {
    expect(l.card, `${screen}: a card (data-card) is on the screen`).toBe(true);
    expect(l.pad, `${screen}: the card's inner padding is at least 28 px on every side`).toBeGreaterThanOrEqual(28);
  }
  // render-clean (the render gate's checks, here at both sizes and signed in): no console error, no uncaught exception, no
  // page wider than the screen
  expect(problems.get(page) ?? [], `${screen}: console errors or uncaught exceptions`).toEqual([]);
  const wider = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(wider, `${screen}: the page is wider than the screen by this many px`).toBeLessThanOrEqual(0);
}

const problems = new WeakMap<Page, string[]>();
function watch(page: Page) {
  const list: string[] = [];
  problems.set(page, list);
  page.on('console', m => { if (m.type() === 'error') list.push(`console: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', e => list.push(`uncaught: ${String(e.message).slice(0, 200)}`));
}

const leads = `/w/${WS.a.slug}/leads`;
const site = `/w/${WS.a.slug}/site`;

async function openSite(page: Page) {
  await page.goto(site);
  await expect(page.getByRole('heading', { name: 'Pages', exact: true })).toBeVisible();
}

for (const size of SIZES) {
  test.describe(`styles at ${size.width}x${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });
    test.beforeEach(({ page }) => watch(page));

    test(`sign in is styled at ${size.name}`, async ({ page }) => {
      await installMutant(page, 'no-styles');
      await page.goto('/login');
      await expect(page.getByRole('button', { name: 'Send me a sign-in link' })).toBeVisible();
      await check(page, 'sign-in', size);
    });

    test.describe('signed in as owner-a', () => {
      test.use({ storageState: '.auth/owner-a.json' });

      test(`leads is styled at ${size.name}`, async ({ page }) => {
        await installMutant(page, 'no-styles');
        await page.goto(leads);
        await expect(page.getByRole('link', { name: 'Add a lead' })).toBeVisible();
        await expect(page.locator('tbody tr').first()).toBeVisible();
        await check(page, 'leads', size);
      });

      test(`the lead panel is styled at ${size.name}`, async ({ page }) => {
        await installMutant(page, 'no-styles');
        await page.goto(leads);
        await page.locator('tbody th a').first().click();
        await expect(page.locator('#lead-name')).toBeVisible();
        await expect(page.getByRole('radiogroup', { name: 'Status' })).toBeVisible();
        await check(page, 'lead-panel', size);
      });

      test(`add a lead is styled at ${size.name}`, async ({ page }) => {
        await installMutant(page, 'no-styles');
        await installMutant(page, 'no-bar-room');
        await page.goto(`${leads}/new`);
        await expect(page.getByLabel('Phone')).toBeVisible();
        // the Owner field comes in after the team loads (an owner can pick one) and makes the form longer: wait for the whole form
        await expect(page.getByLabel('Owner')).toBeVisible();
        await check(page, 'add-lead', size);
        if (!size.desktop) {
          // the end of the form: Save is reachable above the bottom bar (the bar's top measured on the page)
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          const save = page.getByRole('button', { name: 'Save', exact: true });
          await expect(save).toBeInViewport();
          const box = await save.boundingBox();
          const barTop = await page.getByRole('link', { name: 'Leads', exact: true }).evaluate(a => a.parentElement!.getBoundingClientRect().top);
          expect((box?.y ?? 0) + (box?.height ?? 0), 'Save ends above the bottom bar').toBeLessThanOrEqual(barTop);
          await check(page, 'add-lead-end', size);
        }
      });

      test(`site is styled at ${size.name}`, async ({ page }) => {
        await installMutant(page, 'no-styles');
        await openSite(page);
        await check(page, 'site', size);
      });

      test(`the editor is styled at ${size.name}`, async ({ page }) => {
        await installMutant(page, 'no-styles');
        await openSite(page);
        await page.getByRole('link', { name: 'Contact Demo A', exact: true }).click();
        await expect(page.locator('#editor-title')).toBeVisible();
        await expect(page.getByRole('button', { name: 'History', exact: true })).toBeVisible();
        await check(page, 'editor', size);
      });

      test(`the publish sheet is styled at ${size.name}`, async ({ page }) => {
        await installMutant(page, 'no-styles');
        await openSite(page);
        const href = await page.getByRole('link', { name: 'Contact Demo A', exact: true }).getAttribute('href');
        const row = href?.split('/').pop() ?? '';
        expect(row, 'the contact page row id from its link').not.toBe('');
        // read only: when staging has no waiting change, the page's own drafts call is answered with one (the contact page)
        await page.route(/\/functions\/v1\/drafts$/, async route => {
          const r = await route.fetch();
          const body = (await r.json()) as { drafts?: unknown[] };
          if (!body.drafts?.length) body.drafts = [{ row, collection: 'pages', newest: 2, published: 1, editedBy: PEOPLE['owner-a'].id, editedAt: new Date().toISOString() }];
          await route.fulfill({ response: r, json: body });
        });
        await page.reload();
        await page.getByRole('button', { name: /^Publish \d+ changes?$/ }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await check(page, 'publish-sheet', size);
      });
    });
  });
}

// r4 rulings (head of operations, 2026-11-02): read only; the page's own drafts or leads call is answered or held by the test.
async function answerDrafts(page: Page, n: 0 | 1) {
  await openSite(page);
  const href = await page.getByRole('link', { name: 'Contact Demo A', exact: true }).getAttribute('href');
  const row = href?.split('/').pop() ?? '';
  expect(row, 'the contact page row id from its link').not.toBe('');
  await page.route(/\/functions\/v1\/drafts$/, async route => {
    const r = await route.fetch();
    const drafts = n === 0 ? [] : [{ row, collection: 'pages', newest: 2, published: 1, editedBy: PEOPLE['owner-a'].id, editedAt: new Date().toISOString() }];
    await route.fulfill({ response: r, json: { drafts } });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Pages', exact: true })).toBeVisible();
}

for (const size of SIZES) {
  test.describe(`r4 rulings at ${size.width}x${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, storageState: '.auth/owner-a.json' });
    // a refetch the page starts as the test ends must not fail it: the routes go first
    test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }); });

    test(`(2) nothing to publish is a status line, not a disabled button, at ${size.name}`, async ({ page }) => {
      await answerDrafts(page, 0);
      await expect(page.getByText('Nothing to publish', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Nothing to publish' }), '(2) no disabled "Nothing to publish" button').toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Publish/ }), '(2) no Publish button when there is nothing to publish').toHaveCount(0);
    });

    test(`(7) one change is singular, on the button and in the sheet, at ${size.name}`, async ({ page }) => {
      await answerDrafts(page, 1);
      await expect(page.getByRole('button', { name: /^Publish 1 changes?$/ }), '(7) the button says "Publish 1 change"').toHaveText('Publish 1 change');
      await page.getByRole('button', { name: /^Publish 1 changes?$/ }).click();
      await expect(page.getByRole('dialog').getByRole('heading').first(), '(7) the sheet asks "Publish this change to ..."').toHaveText(/^Publish this change to /);
    });

    test(`(6) the filter shows no counts while the list is loading, at ${size.name}`, async ({ page }) => {
      // the leads read is held for 4 s, so the screen sits in its Loading state
      await page.route(/\/rest\/v1\/leads\?/, async route => { await new Promise(r => setTimeout(r, 4000)); await route.continue(); });
      await page.goto(leads);
      const filter = page.getByRole('radiogroup', { name: 'Filter' });
      await expect(page.getByText('Loading', { exact: true })).toBeVisible();
      await expect(filter, '(6) no count beside New / All / Mine / Spam while the list says Loading').not.toContainText(/\d/);
      await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
      await expect(filter, '(6) the counts come with the list').toContainText(/\d/);
    });
  });
}
