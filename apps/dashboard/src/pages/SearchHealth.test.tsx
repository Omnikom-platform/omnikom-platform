// The Search health page (B24-b): its states from its reads, by renderToStaticMarkup (no router here: `next` stands in for the page's Link).
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import NAMES from '../../../../tools/audit/names.json';
import { SearchHealthView, type Read } from './SearchHealth';
import type { Site } from '../data';
import type { AuditRow, MetricRow, SiteAudit } from '../lib/overview';

vi.mock('../supabase', () => ({ supabase: {} }));   // no client and no keys in a test (vi.mock runs before the imports)

const s1: Site = { id: 's1', preview_host: 'preview.site.test', domain: null, state: 'preview' };
const s2: Site = { id: 's2', preview_host: 'p2.site.test', domain: 'www.main.test', state: 'live' };
const j1: AuditRow = {
  job: 'j1', finished_at: '2026-11-12T10:00:00Z', state: 'done', target: 'preview', pass: null, counts: { PASS: 5, FAIL: 1, SKIP: 0 },
  summary: { pages: 2, byTopic: { headings: { PASS: 5, FAIL: 1, SKIP: 0 } }, fails: [{ rule: 'MET-003', page: '/about/' }], truncated: 0 } as AuditRow['summary'],
};
const audit: Read<SiteAudit> = { data: { latest: { preview: j1, production: null }, history: [j1] }, error: null, isLoading: false };
const metrics: Read<MetricRow[]> = {
  data: [{ source: 'bing', day: '2026-11-11', data: { window: { start: '2026-11-09', end: '2026-11-09' }, totals: { clicks: 3, impressions: 1200 } } }],
  error: null, isLoading: false,
};
const failed = { error: new Error('x'), isLoading: false };
const view = (site: Site, a: Read<SiteAudit>, m: Read<MetricRow[]>, measuredFor: Site | null) =>
  renderToStaticMarkup(<SearchHealthView site={site} audit={a} metrics={m} measuredFor={measuredFor} next={<b>next</b>} />);
const alerts = (html: string) => html.split('This could not be read. Reload the page to try again.').length - 1;

describe('the Search health page (B24-b)', () => {
  it('P1: both reads answered: the title, the topic and its problem, the history line, the site measured and its card; no alert', () => {
    const html = view(s1, audit, metrics, s1);
    expect(html).toContain('<h1 data-plan="DP-1.10-02">Search health</h1>');
    expect(html).toContain('Headings and structure: 5 of 6 pass');
    expect(html).toContain(`${NAMES.rules['MET-003'].problem} Omnikom fixes this. Pages: /about/`);
    expect(html).toContain('(preview): 5 passed, 1 failed.');
    expect(html).toContain('Measured for preview.site.test.');
    expect(html).toContain('1,200 times seen, 3 clicks');
    expect(alerts(html)).toBe(0);
  });

  it('P2: the site check read failed: its two parts say so, the numbers stay, no word about a draft', () => {
    const html = view(s1, failed, metrics, s1);
    expect(alerts(html)).toBe(2);
    expect(html).toContain('1,200 times seen, 3 clicks');
    expect(html).not.toMatch(/draft/i);
  });

  it('P3: the numbers read failed: their part says so, the check and its history stay, no word about a draft', () => {
    const html = view(s1, audit, failed, s1);
    expect(alerts(html)).toBe(1);
    expect(html).toContain('Headings and structure: 5 of 6 pass');
    expect(html).toContain('(preview): 5 passed, 1 failed.');
    expect(html).toContain('Measured for preview.site.test.');
    expect(html).not.toMatch(/draft/i);
  });

  it('P4: on the page of a site that is not measured, the numbers name the other site and no card shows', () => {
    const html = view(s1, audit, metrics, s2);
    expect(html).toContain('Measured for www.main.test only, not for this site.');
    expect(html).not.toContain('1,200 times seen');
    expect(html).not.toContain('Not connected yet');
  });

  it('P5: before the first check, the one empty state and its button, under the site address', () => {
    const html = view(s1, { data: { latest: { preview: null, production: null }, history: [] }, error: null, isLoading: false }, metrics, s1);
    expect(html).toContain('preview.site.test');
    expect(html).toContain('No search check yet: one runs each time the site is published.');
    expect(html).toContain('<b>next</b>');
    expect(html).not.toContain('Site check');
    expect(html).not.toContain('How people find you');
  });
});
