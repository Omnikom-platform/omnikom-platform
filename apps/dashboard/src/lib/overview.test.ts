// The pure parts of the Overview (B20): where this week starts, the lines of the cards, the newest publish of a site.
import { describe, expect, it } from 'vitest';
import { changesWords, lastPublished, leadsWeekWords, publishWords, weekStart } from './overview';
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
