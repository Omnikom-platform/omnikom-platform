// The pure parts of the Search health page (B24-a): the newest check, the check by topic, the history, each source, the measured site.
import { describe, expect, it } from 'vitest';
import NAMES from '../../../../tools/audit/names.json';
import { checkHistory, checkTopics, measuredSite, newestCheck, sourceViews } from './search-health';
import { visibilityCards, type AuditRow, type MetricRow } from './overview';

const now = new Date('2026-11-12T12:00:00Z');
const B = { blocked: { reason: 'r', unblock: 'u' } };
const bing = (day: string, end: string, clicks: number, seen: number): MetricRow => ({ source: 'bing', day, data: { window: { start: end, end }, totals: { clicks, impressions: seen } } });
const NOT = 'Not connected yet';
const row = (job: string, target: string | null, state: string, counts: Record<string, number> | null, finished_at: string | null): AuditRow => ({
  job, finished_at, state, target, pass: null, counts, summary: null,
});

describe('the Search health page, pure parts (B24-a)', () => {
  it('H1: the check by topic lists the topics that ran in the table order, then other, each failed rule once with its pages once', () => {
    const S = {
      byTopic: {
        titles: { PASS: 6, FAIL: 0, SKIP: 0 }, headings: { PASS: 5, FAIL: 1, SKIP: 0 }, indexing: { PASS: 0, FAIL: 0, SKIP: 3 },
        links: { PASS: 2, FAIL: 2, SKIP: 0 }, other: { PASS: 1, FAIL: 1, SKIP: 0 },
      },
      fails: [
        { rule: 'MET-003', page: 'about/index.html' }, { rule: 'LNK-002', page: 'index.html' }, { rule: 'LNK-002', page: 'contact/index.html' },
        { rule: 'LNK-002', page: 'index.html' }, { rule: 'XYZ-999', page: 'index.html' },
      ],
      truncated: 0,
    };
    const r = checkTopics(S);
    const of = (id: string) => r.topics.find(t => t.id === id);
    expect(r.topics.map(t => t.id)).toEqual(['titles', 'headings', 'links', 'other']);
    expect(of('headings')).toEqual({ id: 'headings', name: NAMES.topics[1]?.name, pass: 5, fail: 1, problems: [{ rule: 'MET-003', problem: NAMES.rules['MET-003'].problem, pages: ['about/index.html'] }] });
    expect(of('links')?.problems).toEqual([{ rule: 'LNK-002', problem: NAMES.rules['LNK-002'].problem, pages: ['index.html', 'contact/index.html'] }]);
    expect(of('titles')?.problems).toEqual([]);
    expect(of('other')?.problems).toEqual([]);
    expect(of('other')?.name).toBe('');
    expect(r.notListed).toBe(0);
  });

  it('H2: no summary is no topic; the left-out fails are counted; a fail with no page has no page', () => {
    expect(checkTopics(null)).toEqual({ topics: [], notListed: 0 });
    expect(checkTopics(undefined)).toEqual({ topics: [], notListed: 0 });
    expect(checkTopics({})).toEqual({ topics: [], notListed: 0 });
    expect(checkTopics({ byTopic: {}, fails: [], truncated: 12 })).toEqual({ topics: [], notListed: 12 });
    expect(checkTopics({ byTopic: { headings: { PASS: 0, FAIL: 1 } }, fails: [{ rule: 'MET-003' }] }).topics[0]?.problems[0]?.pages).toEqual([]);
  });

  it('H3: the check history says live or preview, failed or not, and its counts; an old job has none of them', () => {
    const history = [
      row('j3', 'production', 'done', { PASS: 40, FAIL: 0, SKIP: 1 }, '2026-11-12T10:00:00Z'),
      row('j2', 'preview', 'failed', { PASS: 38, FAIL: 2, SKIP: 0 }, '2026-11-11T09:00:00Z'),
      row('j1', null, 'done', null, null),
    ];
    expect(checkHistory(history)).toEqual([
      { job: 'j3', at: '2026-11-12T10:00:00Z', live: true, failed: false, pass: 40, fail: 0 },
      { job: 'j2', at: '2026-11-11T09:00:00Z', live: false, failed: true, pass: 38, fail: 2 },
      { job: 'j1', at: '', live: null, failed: false, pass: null, fail: null },
    ]);
  });

  it('H4: a source shows its newest reading with numbers, the day a newer read got none, and its earlier readings newest first', () => {
    const v = sourceViews([bing('2026-11-09', '2026-11-07', 2, 900), { source: 'bing', day: '2026-11-11', data: B }, bing('2026-11-10', '2026-11-08', 3, 1200)], now)[1];
    expect([v?.card.value, v?.card.note]).toEqual(['1,200 times seen, 3 clicks', 'Bing Webmaster Tools, 8 Nov']);
    expect(v?.blockedOn).toBe('2026-11-11');
    expect(v?.earlier.map(c => c.value)).toEqual(['900 times seen, 2 clicks']);
  });

  it('H5: a source with no reading that has numbers is not connected yet, never a zero, in the Overview order', () => {
    const views = sourceViews([
      { source: 'search-console', day: '2026-11-11', data: B },
      { source: 'search-console', day: '2026-11-10', data: B },
      { source: 'pagespeed', day: '2026-11-09', data: { strategy: 'mobile', pages: [{ url: 'https://site.test/', performance: 87 }], crux: { none: true } } },
    ], now);
    expect(views.map(v => v.card.title)).toEqual(['Google search', 'Bing search', 'Speed on a phone', 'AI answers']);
    expect([views[0]?.card.value, views[0]?.blockedOn, views[0]?.earlier]).toEqual([NOT, null, []]);
    expect([views[2]?.card.value, views[2]?.blockedOn]).toEqual(['Speed score 87 of 100', null]);
    expect([views[1]?.card.value, views[3]?.card.value]).toEqual([NOT, NOT]);
    expect(sourceViews([], now)).toEqual(visibilityCards([], now).map(card => ({ card, blockedOn: null, earlier: [] })));
  });

  it('H6: the measured site is the live one, else the oldest preview one, else none', () => {
    expect(measuredSite([{ id: 'p1', state: 'preview' }, { id: 'l1', state: 'live' }, { id: 'p2', state: 'preview' }])).toBe('l1');
    expect(measuredSite([{ id: 'x', state: 'paused' }, { id: 'p1', state: 'preview' }, { id: 'p2', state: 'preview' }])).toBe('p1');
    expect(measuredSite([{ id: 'x', state: 'paused' }])).toBeNull();
    expect(measuredSite([])).toBeNull();
  });

  it('H7: the newest check is the live check of a live site, else the preview check, else none', () => {
    const P = row('jp', 'preview', 'done', { PASS: 1, FAIL: 0 }, '2026-11-12T10:00:00Z');
    const L = row('jl', 'production', 'done', { PASS: 1, FAIL: 0 }, '2026-11-12T11:00:00Z');
    expect(newestCheck({ preview: P, production: L }, true)).toBe(L);
    expect(newestCheck({ preview: P, production: L }, false)).toBe(P);
    expect(newestCheck({ preview: P, production: null }, true)).toBe(P);
    expect(newestCheck(undefined, true)).toBeNull();
    expect(newestCheck({ preview: null, production: null }, false)).toBeNull();
  });
});
