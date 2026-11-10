import { describe, expect, it } from 'vitest';
import { canAddTask, instantFromLocal, localFromInstant, offsetAt, orderTasks, TASK_MAX, type Task } from './followup';
import { followUpLine, taskLine, timelineLines } from './leads';

// Test data lives in tests only (DECISIONS 44 bans sample data in the app source, not in a test that proves a rule).
describe('the date and time box and the instant it becomes', () => {
  it('is an instant with the browser\'s offset, never a time with none', () => {
    expect(instantFromLocal('2026-11-20T10:00', 120)).toBe('2026-11-20T10:00:00+02:00');
    expect(instantFromLocal('2026-11-20T10:00', 0)).toBe('2026-11-20T10:00:00+00:00');
    expect(instantFromLocal('2026-11-20T10:00', -330)).toBe('2026-11-20T10:00:00-05:30');
    expect(instantFromLocal('2026-11-20T10:00', 330)).toBe('2026-11-20T10:00:00+05:30');
  });
  it('is the same moment the box showed: reading it back gives the box\'s own text', () => {
    for (const off of [120, 0, -330, 330, -480]) {
      const iso = instantFromLocal('2026-03-08T23:45', off);
      expect(localFromInstant(iso, off), `offset ${off}`).toBe('2026-03-08T23:45');
      expect(new Date(iso as string).getTime()).toBe(Date.UTC(2026, 2, 8, 23, 45) - off * 60000);
    }
  });
  it('nothing typed, half a date, or a day that does not exist is null (never a guess)', () => {
    for (const bad of ['', '2026-11-20', '2026-11-20T10', '2026-02-30T10:00', '2026-13-01T10:00', '2026-11-20T24:00', '2026-11-20T10:60', 'soon']) {
      expect(instantFromLocal(bad, 0), bad).toBeNull();
    }
  });
  it('an instant that is missing or unreadable is an empty box', () => {
    expect(localFromInstant(null)).toBe('');
    expect(localFromInstant(undefined)).toBe('');
    expect(localFromInstant('not a time')).toBe('');
  });
  it('the offset it reads for a time of its own is a whole number of minutes the browser reports', () => {
    expect(Number.isInteger(offsetAt('2026-11-20T10:00'))).toBe(true);
    expect(offsetAt('nonsense')).toBe(0);
    expect(instantFromLocal('2026-11-20T10:00')).toMatch(/^2026-11-20T10:00:00[+-]\d{2}:\d{2}$/);
  });
});

describe('the task list', () => {
  const task = (id: string, o: Partial<Task>): Task => ({ id, text: id, due_at: null, done_at: null, created_at: '2026-11-01T10:00:00Z', ...o });
  it('open tasks come first, the soonest due first and those with no due last', () => {
    const out = orderTasks([
      task('none', {}),
      task('late', { due_at: '2026-12-01T10:00:00Z' }),
      task('soon', { due_at: '2026-11-02T10:00:00Z' }),
    ]);
    expect(out.map(x => x.id)).toEqual(['soon', 'late', 'none']);
  });
  it('among equals the newest added comes first and the id breaks a tie, so the order never flickers', () => {
    const out = orderTasks([
      task('a', { created_at: '2026-11-01T10:00:00Z' }),
      task('b', { created_at: '2026-11-03T10:00:00Z' }),
      task('c', { created_at: '2026-11-03T10:00:00Z' }),
    ]);
    expect(out.map(x => x.id)).toEqual(['c', 'b', 'a']);
  });
  it('done tasks come after every open one, the newest done first', () => {
    const out = orderTasks([
      task('done-old', { done_at: '2026-11-05T10:00:00Z' }),
      task('open', { due_at: '2026-12-31T10:00:00Z' }),
      task('done-new', { done_at: '2026-11-09T10:00:00Z' }),
    ]);
    expect(out.map(x => x.id)).toEqual(['open', 'done-new', 'done-old']);
  });
  it('does not change the list it was given', () => {
    const given = [task('b', { created_at: '2026-11-01T10:00:00Z' }), task('a', { created_at: '2026-11-02T10:00:00Z' })];
    orderTasks(given);
    expect(given.map(x => x.id)).toEqual(['b', 'a']);
  });
  it('Add task needs some text and at most 500 characters', () => {
    expect(TASK_MAX).toBe(500);
    expect(canAddTask('')).toBe(false);
    expect(canAddTask('   ')).toBe(false);
    expect(canAddTask('x')).toBe(true);
    expect(canAddTask('x'.repeat(500))).toBe(true);
    expect(canAddTask('x'.repeat(501))).toBe(false);
  });
});

describe('the timeline lines of the new event kinds', () => {
  it('a follow-up set, changed and cleared', () => {
    expect(followUpLine({ old: null, new: '2025-01-05T09:00:00Z' })).toMatch(/^Follow-up set for .+/);
    expect(followUpLine({ old: '2025-01-05T09:00:00Z', new: '2025-01-09T09:00:00Z' })).toMatch(/^Follow-up changed from .+ to .+/);
    expect(followUpLine({ old: '2025-01-05T09:00:00Z', new: null })).toBe('Follow-up cleared');
  });
  it('a task added, done and reopened carries its text', () => {
    expect(taskLine({ action: 'added', text: 'Send the brochure' })).toBe('Task added: Send the brochure');
    expect(taskLine({ action: 'done', text: 'Send the brochure' })).toBe('Task done: Send the brochure');
    expect(taskLine({ action: 'reopened', text: 'Send the brochure' })).toBe('Task reopened: Send the brochure');
  });
  it('the timeline writes them in place of the kind\'s own name', () => {
    const names = { me: null, byUser: new Map<string, string>(), team: new Map<string, string>() };
    const lines = timelineLines([
      { id: 1, kind: 'task', by: null, detail: { action: 'added', text: 'Call back' }, at: '2025-01-05T09:00:00Z' },
      { id: 2, kind: 'follow-up', by: null, detail: { old: null, new: null }, at: '2025-01-06T09:00:00Z' },
    ], null, names);
    expect(lines.map(l => l.what)).toEqual(['Follow-up cleared', 'Task added: Call back']);
  });
});
