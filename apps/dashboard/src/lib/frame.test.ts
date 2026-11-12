// The instant frame (book row B15): the factory's own renderer draws one page from the rows with a draft in place. Synthetic fixture (Demo A).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assetsIn, changedSections, cssOf, type FrameInput, type FrameRow } from './frame';
import { frameHtml } from './frame-render';

const exp = JSON.parse(readFileSync(new URL('../../../../factory/test/fixtures/export-test-demo-a.json', import.meta.url), 'utf8')) as {
  contract: unknown; rows: FrameRow[]; media: { id: string; path: string; width: number; height: number }[]; site: unknown; workspace: { slug: string; name: string };
};
const contact = exp.rows.find(r => r.collection === 'pages' && r.data.path === '/contact/') as FrameRow;
const sections = contact.data.sections as Record<string, Record<string, unknown>>;
const typed: FrameRow = { ...contact, data: { ...contact.data, sections: { ...sections, contact: { ...sections.contact, heading: 'Typed in the frame' } } } };
const photos = Object.fromEntries(exp.media.map(m => [m.id, { url: `https://x.supabase.co/${m.path}`, width: m.width, height: m.height }]));
const input = (row: string, rows: FrameRow[], changed: string[]): FrameInput => ({
  n: 1, slug: 'test-demo-a', contract: exp.contract, rows, row, site: exp.site, workspace: exp.workspace, origin: 'https://preview.test-site-demo-a.pages.dev',
  css: ['/assets/tokens.css'], media: photos, changed,
});

describe('the instant frame (B15)', () => {
  it('the factory renderer draws the contact page with the typed heading, outlines that section only, links the stylesheets, runs no site script', async () => {
    const page = await frameHtml(input(contact.id, exp.rows.map(r => (r.id === contact.id ? typed : r)), ['contact']));
    expect(page).toContain('<h1>Typed in the frame</h1>');
    expect(page).toContain('<section data-changed class="contact">');
    expect(page).toContain('<link rel="stylesheet" href="/assets/tokens.css">');
    expect(page).toContain('<link rel="stylesheet" href="/frame.css">');
    expect(page.split('data-changed').length - 1).toBe(1);
    expect(page).not.toContain('<script src=');
  });

  it('a row with no page (the business details) draws the home page; a photo with no signed link is named', async () => {
    const settings = exp.rows.find(r => r.collection === 'settings') as FrameRow;
    expect(await frameHtml(input(settings.id, exp.rows, []))).toContain('<link rel="canonical" href="https://preview.test-site-demo-a.pages.dev/">');
    await expect(frameHtml({ ...input(settings.id, exp.rows, []), media: {} })).rejects.toThrow('no media row');
  });

  it('the changed sections are the sections.<id> paths, each once', () => {
    expect(changedSections(contact.data, typed.data)).toEqual(['contact']);
    expect(changedSections(contact.data, contact.data)).toEqual([]);
    expect(changedSections(contact.data, { ...contact.data, title: 'Another title' })).toEqual([]);
  });

  it('the photos are the rows\' { asset } values', () => {
    expect(assetsIn(exp.rows)).toEqual(exp.media.map(m => m.id).sort());
  });

  it('the stylesheets are tokens then base, none for a site with no design', () => {
    const css = cssOf('test-demo-a');
    expect(css).toHaveLength(2);
    expect(css[0]).toMatch(/tokens/);
    expect(cssOf('no-such-site')).toEqual([]);
  });
});
