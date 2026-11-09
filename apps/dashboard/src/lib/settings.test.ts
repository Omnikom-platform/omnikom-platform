import { describe, expect, it } from 'vitest';
import { alertsChanged, alertsText, canRemove, canSaveAlerts, memberName, onlyYou, parseAlerts, validEmail } from './settings';

const stored = { to: ['a@test.com', 'b@test.com'], assignee: true };

describe('parseAlerts', () => {
  it('reads one address per line, lower-cased, trimmed, blank lines ignored, repeats dropped', () => {
    expect(parseAlerts(' A@Test.com \n\n b@test.com\r\na@test.com ').addresses).toEqual(['a@test.com', 'b@test.com']);
    expect(parseAlerts('').addresses).toEqual([]);
  });
  it('names the first line that is not an address, counting the lines as typed', () => {
    expect(parseAlerts('a@test.com\nnot-an-email\nalso bad').problem).toEqual({ kind: 'line', line: 2 });
    expect(parseAlerts('\n\nbad').problem).toEqual({ kind: 'line', line: 3 });
    expect(parseAlerts('a@b').problem).toEqual({ kind: 'line', line: 1 });
    expect(parseAlerts('a @test.com').problem).toEqual({ kind: 'line', line: 1 });
  });
  it('allows ten distinct addresses and refuses an eleventh; a repeat does not count', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `p${i}@test.com`);
    expect(parseAlerts(ten.join('\n')).problem).toBeNull();
    expect(parseAlerts([...ten, 'P0@test.com'].join('\n')).problem).toBeNull();
    expect(parseAlerts([...ten, 'p10@test.com'].join('\n')).problem).toEqual({ kind: 'many' });
  });
});

describe('alertsChanged and canSaveAlerts', () => {
  it('is not changed by case, blank lines or order of nothing: the stored list typed back is the same', () => {
    expect(alertsChanged(stored, { text: alertsText(stored.to), assignee: true })).toBe(false);
    expect(alertsChanged(stored, { text: 'A@TEST.com\n\nb@test.com\n', assignee: true })).toBe(false);
  });
  it('is changed by an address added, removed or reordered, and by the tick', () => {
    expect(alertsChanged(stored, { text: 'a@test.com', assignee: true })).toBe(true);
    expect(alertsChanged(stored, { text: 'a@test.com\nb@test.com\nc@test.com', assignee: true })).toBe(true);
    expect(alertsChanged(stored, { text: 'b@test.com\na@test.com', assignee: true })).toBe(true);
    expect(alertsChanged(stored, { text: alertsText(stored.to), assignee: false })).toBe(true);
    expect(alertsChanged({ to: [], assignee: false }, { text: '', assignee: false })).toBe(false);
  });
  it('Save is on only when changed and valid', () => {
    expect(canSaveAlerts(stored, { text: alertsText(stored.to), assignee: true })).toBe(false);
    expect(canSaveAlerts(stored, { text: 'a@test.com\nnope', assignee: true })).toBe(false);
    expect(canSaveAlerts(stored, { text: 'a@test.com', assignee: true })).toBe(true);
    expect(canSaveAlerts(stored, { text: alertsText(stored.to), assignee: false })).toBe(true);
    expect(canSaveAlerts({ to: [], assignee: true }, { text: Array.from({ length: 11 }, (_, i) => `p${i}@test.com`).join('\n'), assignee: true })).toBe(false);
  });
});

describe('the people list', () => {
  const m = (user: string, name: string | null) => ({ user, email: `${user}@test.com`, name });
  it('names a person by their team profile, else their email', () => {
    expect(memberName(m('x', 'Agent One'))).toBe('Agent One');
    expect(memberName(m('x', null))).toBe('x@test.com');
    expect(memberName(m('x', ''))).toBe('x@test.com');
  });
  it('Remove is not on your own row', () => {
    expect(canRemove(m('me', null), 'me')).toBe(false);
    expect(canRemove(m('other', null), 'me')).toBe(true);
  });
  it('"Only you so far" holds for a list of only you, not for an empty list or a longer one', () => {
    expect(onlyYou([m('me', null)], 'me')).toBe(true);
    expect(onlyYou([], 'me')).toBe(false);
    expect(onlyYou([m('me', null), m('x', null)], 'me')).toBe(false);
  });
  it('validEmail trims and wants a full address', () => {
    expect(validEmail(' a@test.com ')).toBe(true);
    expect(validEmail('a@test')).toBe(false);
    expect(validEmail('')).toBe(false);
  });
});
