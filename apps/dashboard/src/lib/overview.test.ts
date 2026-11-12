// The pure parts of the Overview (B20): where this week starts, the lines of the cards, the newest publish of a site.
import { describe, expect, it } from 'vitest';
import { changesWords, checkLine, lastPublished, leadsWeekWords, publishWords, visibilityCards, weekStart, type AuditRow, type MetricRow } from './overview';
import type { Job } from './site';

const job = (id: string, site_id: string, state: Job['state']): Job => ({
  id, site_id, requested_by: 'u1', rows: [], requested: {}, state, gate_report: null, error: null, created_at: '2026-11-12T10:00:00Z', finished_at: null,
});

describe('the Overview (B20)', () => {
  it('O1: this week starts on Monday 00:00 in the local zone', () => {
    const monday = (day: number) => new Date(2026, 10, day).getTime();
    expect(weekStart(new Date(2026, 10, 12, 15, 0, 0)).getTime()).toBe(monday(9));
    expect(weekStart(new Date(2026, 10, 9, 0, 0, 0)).getTime()).toBe(monday(9));
    expect(weekStart(new Date(2026, 10, 15, 23, 59, 0)).getTime()).toBe(monday(9));
    expect(weekStart(new Date(2026, 10, 16, 0, 0, 1)).getTime()).toBe(monday(16));
  });

  it('O2: the leads line has a zero and a one of its own', () => {
    expect(leadsWeekWords(0)).toBe('No leads this week');
    expect(leadsWeekWords(1)).toBe('1 lead this week');
    expect(leadsWeekWords(12)).toBe('12 leads this week');
  });

  it('O3: the changes line has a zero and a one of its own', () => {
    expect(changesWords(0)).toBe('Nothing to publish');
    expect(changesWords(1)).toBe('1 change waiting to publish');
    expect(changesWords(3)).toBe('3 changes waiting to publish');
  });

  it('O4: the last publish names when and by whom, or says it has not happened', () => {
    const now = new Date('2026-11-12T12:00:00Z');
    expect(publishWords(null, now, 'UTC')).toBe('Not published yet');
    expect(publishWords({ at: '2026-11-12T10:00:00Z', by: 'Agent One' }, now, 'UTC')).toBe('Last published today 10:00 by Agent One');
    expect(publishWords({ at: '2026-11-12T10:00:00Z', by: '' }, now, 'UTC')).toBe('Last published today 10:00');
  });

  it('O5: the last publish of a site is its newest job that is done', () => {
    const jobs = [job('a5', 'A', 'building'), job('a4', 'A', 'failed'), job('b1', 'B', 'done'), job('a2', 'A', 'done'), job('a1', 'A', 'done')];
    expect(lastPublished(jobs, 'A')?.id).toBe('a2');
    expect(lastPublished(jobs, 'B')?.id).toBe('b1');
    expect(lastPublished(jobs, 'C')).toBeNull();
  });
});

const now = new Date('2026-11-12T12:00:00Z');
const audit = (target: 'preview' | 'production', counts: Record<string, number> | null, pages: number): AuditRow => ({
  job: `job-${target}`, finished_at: '2026-11-12T10:00:00Z', state: 'done', target, pass: counts ? counts.FAIL === 0 : null, counts, summary: { pages },
});
const preview = audit('preview', { PASS: 41, FAIL: 3, SKIP: 2 }, 6);
const production = audit('production', { PASS: 40, FAIL: 0 }, 1);
const NOT = 'Not connected yet';
const blocked = { blocked: { reason: 'a reason', unblock: 'what unblocks it' } };
const metric = (source: string, day: string, data: Record<string, unknown>): MetricRow => ({ source, day, data });
const search = (end: string, clicks: number, impressions: number) => ({ window: { start: end, end }, totals: { clicks, impressions } });
const speed = (crux: Record<string, unknown>) => metric('pagespeed', '2026-11-09', { strategy: 'mobile', pages: [{ url: 'https://site.test/', performance: 87 }], crux });

describe('the site check and how people find you (B21)', () => {
  it('V1: the check line says when, which check, and how many pass of those that ran; nothing before the first check', () => {
    expect(checkLine({ preview, production: null }, false, now, 'UTC')).toBe('Checked today 10:00 (preview): 41 of 44 checks pass on 6 pages.');
    expect(checkLine({ preview, production }, false, now, 'UTC')).toBe('Checked today 10:00 (preview): 41 of 44 checks pass on 6 pages.');
    expect(checkLine({ preview, production }, true, now, 'UTC')).toBe('Checked today 10:00 (live): 40 of 40 checks pass on 1 page.');
    expect(checkLine({ preview, production: null }, true, now, 'UTC')).toBe('Checked today 10:00 (preview): 41 of 44 checks pass on 6 pages.');
    expect(checkLine({ preview: audit('preview', null, 6), production: null }, false, now, 'UTC')).toBe('');
    expect(checkLine({ preview: null, production: null }, true, now, 'UTC')).toBe('');
    expect(checkLine(undefined, false, now, 'UTC')).toBe('');
  });

  it('V2: with no row at all, the four cards are there, in order, each not connected yet', () => {
    const off = (title: string) => ({ title, value: NOT, note: 'Omnikom connects this for you.', extra: '', bar: null });
    expect(visibilityCards([], now)).toEqual([off('Google search'), off('Bing search'), off('Speed on a phone'), off('AI answers')]);
  });

  it('V3: a blocked row, or a row without its numbers, is not connected yet and never a zero', () => {
    const rows = [
      metric('search-console', '2026-11-10', blocked),
      metric('bing', '2026-11-10', { window: { start: '2026-11-10', end: '2026-11-10' }, totals: {}, indexnow: [] }),
      metric('pagespeed', '2026-11-09', blocked),
      metric('ai-answers', '2026-11-08', blocked),
    ];
    expect(visibilityCards(rows, now).map(c => c.value)).toEqual([NOT, NOT, NOT, NOT]);
    expect(visibilityCards([metric('bing', '2026-11-10', { ...blocked, indexnow: [] })], now).map(c => c.value)).toEqual([NOT, NOT, NOT, NOT]);
  });

  it('V4: Google and Bing show what was seen and clicked, with the source and the day; a measured zero is shown', () => {
    const cards = visibilityCards([metric('search-console', '2026-11-12', search('2026-11-10', 3, 1200)), metric('bing', '2026-11-11', search('2026-11-09', 0, 15))], now);
    expect([cards[0]?.value, cards[0]?.note]).toEqual(['1,200 times seen, 3 clicks', 'Google Search Console, 10 Nov']);
    expect([cards[1]?.value, cards[1]?.note]).toEqual(['15 times seen, 0 clicks', 'Bing Webmaster Tools, 9 Nov']);
    expect([cards[2]?.value, cards[3]?.value]).toEqual([NOT, NOT]);
  });

  it('V5: the speed card shows the score with a bar, and what real visitors see only when CrUX has it', () => {
    const card = (crux: Record<string, unknown>) => visibilityCards([speed(crux)], now)[2];
    expect(card({ origin: 'https://site.test', lcpMs: 2300 })).toMatchObject({ value: 'Speed score 87 of 100', bar: 87, note: 'Google PageSpeed, 9 Nov', extra: 'Real visitors: the main content shows in 2.3 seconds' });
    expect(card({ origin: 'https://site.test', none: true, reason: 'no record' })?.extra).toBe('Not enough real visitors yet');
    expect(card({ origin: 'https://site.test', blocked: blocked.blocked })?.extra).toBe('');
  });

  it('V6: the AI answers card counts the answers that name the business, and lists the engines once', () => {
    const answer = (engine: string, named: boolean | null) => ({ engine, named, cited: null });
    const card = visibilityCards([metric('ai-answers', '2026-11-08', { date: '2026-11-08', rows: [answer('gemini', true), answer('chatgpt', false), answer('gemini', null)] })], now)[3];
    expect([card?.value, card?.note]).toEqual(['Named in 1 of 3 AI answers', 'gemini, chatgpt, 8 Nov']);
  });
});
