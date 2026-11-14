import { describe, expect, it } from 'vitest';
import {
  answerRows, filterCounts, filterLeads, formLabel, labelWords, leadsTitle, marketingLine, newestFirst, receivedWords, searchLeads, statusLabel, telHref, timelineLines, visibleLeads, FLOOR_LISTS, listsFrom, statusChoices, newKeys, allKeys, typeLabel, statusWords, dayWords,
  type ContractForms, type Lead, type Lists, type Names,
} from './leads';
import { problemFrom, UNREACHABLE } from './problems';
import { readFileSync } from 'node:fs';
import { withoutTrailingSlashes } from './leads';

// A business's own lists as lead-list answers them: the owner's words as data (none of them is written in the app).
const LISTS: Lists = {
  statuses: [
    { key: 'not-contacted', label: 'Not contacted yet', stage: 'new' },
    { key: 'contacted', label: 'Contacted', stage: 'working', needsWho: true },
    { key: 'call-back', label: 'Call back', stage: 'working', needsDate: true },
    { key: 'interested', label: 'Interested in something specific', stage: 'working', needsText: true },
    { key: 'closed', label: 'Closed', stage: 'outcome' },
  ],
  leadTypes: [{ key: 'enquiry', label: 'Enquiry' }, { key: 'buy', label: 'Looking to buy' }],
};

// Test data lives in tests only (DECISIONS 44 bans sample data in the app source, not in a test that proves a rule).
const lead = (o: Partial<Lead> & { id: string }): Lead => ({
  workspace_id: 'w', site_id: 's', form: 'contact', flow: null, page_path: '/', name: null, email: null, phone: null, answers: {}, consent_text: 'c',
  marketing_consent: null, status: 'not-contacted', owner_team_row: null, created_at: '2026-10-30T09:00:00Z', ...o,
});

const A = lead({ id: 'a', name: 'Ada Lovelace', email: 'ada@example.com', phone: '(555) 010-0199', created_at: '2026-10-30T09:12:00Z', owner_team_row: 't1' });
const B = lead({ id: 'b', name: 'Bob Stone', status: 'contacted', created_at: '2026-10-29T09:12:00Z', owner_team_row: 't2' });
const C = lead({ id: 'c', name: 'Spam Bot', status: 'spam', created_at: '2026-10-31T01:00:00Z' });
const D = lead({ id: 'd', name: 'Dee New', created_at: '2026-10-31T08:00:00Z', owner_team_row: 't1' });

describe('order, filters and their counts', () => {
  it('lists the newest first and breaks a tie by id so the order never flickers', () => {
    expect(newestFirst([A, B, C, D]).map(l => l.id)).toEqual(['d', 'c', 'a', 'b']);
    const t1 = lead({ id: 'x', created_at: '2026-10-31T00:00:00Z' }), t2 = lead({ id: 'y', created_at: '2026-10-31T00:00:00Z' });
    expect(newestFirst([t1, t2]).map(l => l.id)).toEqual(['y', 'x']);
    expect(newestFirst([t2, t1]).map(l => l.id)).toEqual(['y', 'x']);
  });
  it('New is status not-contacted; All is everything but spam; Spam is spam', () => {
    expect(filterLeads([A, B, C, D], 'new', 't1', LISTS).map(l => l.id)).toEqual(['a', 'd']);
    expect(filterLeads([A, B, C, D], 'all', 't1', LISTS).map(l => l.id)).toEqual(['a', 'b', 'd']);
    expect(filterLeads([A, B, C, D], 'spam', 't1', LISTS).map(l => l.id)).toEqual(['c']);
  });
  it('Mine is the leads owned by my team row, spam left out; with no team row it is empty (never everything)', () => {
    expect(filterLeads([A, B, C, D], 'mine', 't1', LISTS).map(l => l.id)).toEqual(['a', 'd']);
    expect(filterLeads([A, B, C, D], 'mine', null, LISTS)).toEqual([]);
    const spamMine = lead({ id: 'e', status: 'spam', owner_team_row: 't1' });
    expect(filterLeads([spamMine], 'mine', 't1', LISTS)).toEqual([]);
  });
  it('counts what each filter shows (the number next to it)', () => {
    expect(filterCounts([A, B, C, D], 't1', LISTS)).toEqual({ new: 2, all: 3, mine: 2, spam: 1 });
    expect(filterCounts([], null, LISTS)).toEqual({ new: 0, all: 0, mine: 0, spam: 0 });
  });
});

describe('search (after 2 characters)', () => {
  it('finds by name or email, any case, and an empty or one-character search keeps everything', () => {
    expect(searchLeads([A, B], 'LOVELACE').map(l => l.id)).toEqual(['a']);
    expect(searchLeads([A, B], 'ada@example').map(l => l.id)).toEqual(['a']);
    expect(searchLeads([A, B], '   ')).toHaveLength(2);
    expect(searchLeads([A, B], 'l')).toHaveLength(2);
  });
  it('finds a phone by its digits however it was typed', () => {
    expect(searchLeads([A, B], '555 010').map(l => l.id)).toEqual(['a']);
    expect(searchLeads([A, B], '5550100199').map(l => l.id)).toEqual(['a']);
    expect(searchLeads([A, B], '(555)').map(l => l.id)).toEqual(['a']);
  });
  it('does not match a lead that has none of the words', () => {
    expect(searchLeads([A, B], 'zzz')).toEqual([]);
    expect(searchLeads([A, B], '999 999')).toEqual([]);
  });
  it('combines with the order and the filter', () => {
    expect(visibleLeads([A, B, C, D], { filter: 'all', query: 'e', myTeamRow: null, lists: LISTS }).map(l => l.id)).toEqual(['d', 'a', 'b']);
  });
});

describe('the received time', () => {
  const now = new Date('2026-10-31T15:30:00Z');
  const w = (iso: string) => receivedWords(iso, now, 'UTC');
  it('says today, yesterday, a weekday, then the date', () => {
    expect(w('2026-10-31T09:12:00Z')).toBe('today 09:12');
    expect(w('2026-10-30T23:59:00Z')).toBe('yesterday 23:59');
    expect(w('2026-10-29T08:05:00Z')).toBe('Thu 08:05');
    expect(w('2026-10-25T08:05:00Z')).toBe('Sun 08:05');
    expect(w('2026-10-24T08:05:00Z')).toBe('24 Oct 08:05');
    expect(w('2025-12-24T08:05:00Z')).toBe('24 Dec 2025 08:05');
  });
  it('counts days in the viewer time zone, not in UTC', () => {
    expect(receivedWords('2026-10-30T23:30:00Z', now, 'Europe/Berlin')).toBe('today 00:30');
    expect(receivedWords('2026-10-30T23:30:00Z', now, 'UTC')).toBe('yesterday 23:30');
  });
  it('does not guess at a time it cannot read', () => {
    expect(receivedWords('not a time', now, 'UTC')).toBe('');
  });
});

describe('labels come from the contract, then from the data itself', () => {
  const forms: ContractForms = { 'home-value': { label: 'Home value request', fields: { propertyType: { label: 'Type of home' } } } };
  it('names a form by the contract label, a hand-entered lead by the plan word, any other slug opened up', () => {
    expect(formLabel('home-value', forms)).toBe('Home value request');
    expect(formLabel('manual', forms)).toBe('Added by hand');
    expect(formLabel('open-house-rsvp', forms)).toBe('Open house rsvp');
    expect(formLabel('open-house-rsvp', null)).toBe('Open house rsvp');
  });
  it('labels an answer by the contract field label, else the key opened up', () => {
    expect(labelWords('propertyType', 'home-value', forms)).toBe('Type of home');
    expect(labelWords('beds_wanted', 'home-value', forms)).toBe('Beds wanted');
    expect(labelWords('howDidTheyReachYou')).toBe('How did they reach you');
    expect(answerRows({ message: 'Hello', beds: 3, ok: true, none: null, blank: '', list: ['a', 'b'] })).toEqual([
      { label: 'Message', value: 'Hello' }, { label: 'Beds', value: '3' }, { label: 'Ok', value: 'true' }, { label: 'List', value: '["a","b"]' },
    ]);
    expect(answerRows(null)).toEqual([]);
  });
  it('builds tel: from digits and a leading plus only', () => {
    expect(telHref('(555) 010-0199')).toBe('tel:5550100199');
    expect(telHref('+44 20 7946 0958')).toBe('tel:+442079460958');
  });
});

describe('the tab title', () => {
  it('puts the count in front when something is new, and caps it', () => {
    expect(leadsTitle(1)).toBe('(1) Leads');
    expect(leadsTitle(0)).toBe('Leads');
    expect(leadsTitle(250)).toBe('(99+) Leads');
  });
});

describe('the timeline (DP-1.3-22 wording, newest first)', () => {
  const names: Names = { me: { id: 'u-me', email: 'me@login.test' }, byUser: new Map([['u-ann', 'Agent One']]), team: new Map([['t1', 'Agent One']]) };
  const L = { page_path: '/sell' };
  const ev = (id: number, kind: string, by: string | null, detail: Record<string, unknown>, min: number) => ({ id, kind, by, detail, at: '2026-10-31T09:' + String(min).padStart(2, '0') + ':00Z' });
  it('says each event kind in the plan words; who is the team name, else the login email, else nothing; never an id', () => {
    const lines = timelineLines([
      ev(1, 'received', null, {}, 0),
      ev(2, 'status', 'u-ann', { from: 'not-contacted', to: 'contacted' }, 5),
      ev(3, 'assigned', 'u-ann', { to: 't1' }, 6),
      ev(4, 'note', 'u-me', { text: 'Called back' }, 7),
      ev(5, 'note', 'u-zzz', { text: 'Left a message' }, 8),
      ev(6, 'received', 'u-ann', { manual: true }, 9),
    ], L, names);
    expect(lines.map(l => [l.who, l.what])).toEqual([
      ['', 'Added by hand by Agent One'],
      ['', 'Note: Left a message'],
      ['me@login.test', 'Note: Called back'],
      ['Agent One', 'Given to Agent One'],
      ['Agent One', 'Status: Not contacted to Contacted'],
      ['', 'Received from /sell'],
    ]);
  });
  it('has a sentence for the events an alert and an export write; the dropped push kinds have none (work order 07)', () => {
    const w = (kind: string) => timelineLines([ev(1, kind, null, {}, 0)], L, names)[0]?.what;
    expect([w('alert-sent'), w('alert-failed'), w('exported')]).toEqual(['Alert sent', 'An alert could not be sent', 'Exported to a CSV file']);
    expect([w('pushed'), w('push-failed'), w('resent')]).toEqual(['pushed', 'push-failed', 'resent']);
  });
  it('says what the form asked about marketing (DP-1.3-23)', () => {
    expect([marketingLine(null), marketingLine({ given: true }), marketingLine({ given: false })]).toEqual([
      'Marketing: not asked on this form.', 'Marketing: yes', 'Marketing: no',
    ]);
  });
});

describe('a failed call', () => {
  it('uses the function sentence and appends its field problems for a 400', () => {
    const p = problemFrom(400, { code: 'BODY', message: 'Something is missing or not valid.', problems: [{ code: 'EMAIL', path: 'email', msg: 'Enter an email like name@example.com' }] });
    expect(p.message).toBe('Something is missing or not valid. Enter an email like name@example.com');
    expect(p.code).toBe('BODY');
    expect(p.plain).toBe(true);
  });
  it('falls back to the plan banner for a body that is not ours or no answer at all', () => {
    expect(problemFrom(0, null).message).toBe(UNREACHABLE);
    expect(problemFrom(0, null).plain).toBe(false);
    expect(problemFrom(502, '<html>bad gateway</html>').message).toBe(UNREACHABLE);
    expect(problemFrom(403, { code: 'S-OWN-ONLY', message: 'You can only keep your own leads.' }).message).toBe('You can only keep your own leads.');
  });
});

describe('work order 39: the lists are the business\'s, with the floor only when there are none', () => {
  it('reads both lists from a lead-list answer, keys, labels and the three flags', () => {
    const l = listsFrom({ statuses: [{ key: 'call-back', label: 'Call back', stage: 'working', needsDate: true }, { key: 'x' }, { nokey: 1 }, 'junk'], lead_types: [{ key: 'buy', label: 'Looking to buy' }, 5] });
    expect(l.statuses).toEqual([
      { key: 'call-back', label: 'Call back', stage: 'working', needsDate: true, needsWho: false, needsText: false },
      { key: 'x', label: 'X', needsDate: false, needsWho: false, needsText: false },
    ]);
    expect(l.leadTypes).toEqual([{ key: 'buy', label: 'Looking to buy' }]);
  });
  it('an answer with no list (or nothing usable in it) is the platform floor, never an empty picker', () => {
    expect(listsFrom(null)).toEqual(FLOOR_LISTS);
    expect(listsFrom({ statuses: [], lead_types: 'x' })).toEqual(FLOOR_LISTS);
    expect(FLOOR_LISTS.statuses.map(s => s.key)).toEqual(['not-contacted', 'contacted', 'qualified', 'closed']);
    expect(FLOOR_LISTS.leadTypes.map(s => s.key)).toEqual(['enquiry']);
  });
  it('the words are the list\'s labels, whatever they are; spam is the one system status; an older key is spelled out; new reads as not-contacted', () => {
    expect(statusLabel(LISTS, 'not-contacted')).toBe('Not contacted yet');
    expect(statusLabel(LISTS, 'new')).toBe('Not contacted yet');
    expect(statusLabel(LISTS, 'interested')).toBe('Interested in something specific');
    expect(statusLabel(LISTS, 'spam')).toBe('Spam');
    expect(statusLabel(LISTS, 'gone-key')).toBe('Gone key');
    expect(statusLabel(LISTS, '')).toBe('');
    expect(statusChoices(LISTS).map(s => s.key)).toEqual(['not-contacted', 'contacted', 'call-back', 'interested', 'closed', 'spam']);
    expect(typeLabel(LISTS, 'buy')).toBe('Looking to buy');
    expect(typeLabel(LISTS, 'old-type')).toBe('Old type');
  });
  it('a list that already holds spam (the real-estate list does) offers it once; its own label wins; All and New leave it out', () => {
    const withSpam: Lists = { ...LISTS, statuses: [...LISTS.statuses, { key: 'spam', label: 'Spam or junk', stage: 'outcome' }] };
    expect(statusChoices(withSpam).map(s => s.key)).toEqual(['not-contacted', 'contacted', 'call-back', 'interested', 'closed', 'spam']);
    expect(statusChoices(withSpam).find(s => s.key === 'spam')?.label).toBe('Spam or junk');
    expect(statusLabel(withSpam, 'spam')).toBe('Spam or junk');
    expect(allKeys(withSpam)).toEqual(['not-contacted', 'contacted', 'call-back', 'interested', 'closed']);
    expect(newKeys(withSpam)).toEqual(['not-contacted']);
  });
  it('New is the statuses at stage new, All every status of the list but spam', () => {
    expect(newKeys(LISTS)).toEqual(['not-contacted']);
    expect(allKeys(LISTS)).toEqual(['not-contacted', 'contacted', 'call-back', 'interested', 'closed']);
  });
  it('a status in words carries its date, person and line in that order; a day names the year only when it is not this year', () => {
    const who = (id: string) => (id === 'u1' ? 'Agent One' : '');
    expect(statusWords(LISTS, 'call-back', { date: '2025-11-20', who: null, text: null }, who)).toBe('Call back, 20 Nov 2025');
    expect(statusWords(LISTS, 'contacted', { date: null, who: 'u1', text: '' }, who)).toBe('Contacted, Agent One');
    expect(statusWords(LISTS, 'closed', {}, who)).toBe('Closed');
    expect(dayWords('2026-11-20', new Date('2026-11-11T00:00:00Z'))).toBe('20 Nov');
    expect(dayWords('not a day')).toBe('');
  });
  it('the timeline says a status change in the list\'s words and brackets what it carries; an edit of the lead type reads its labels', () => {
    const names: Names = { me: null, byUser: new Map(), team: new Map() };
    const at = '2026-10-31T09:05:00Z';
    const w = (kind: string, detail: Record<string, unknown>) => timelineLines([{ id: 1, kind, by: null, detail, at }], null, names, k => k, LISTS)[0]?.what;
    expect(w('status', { from: 'not-contacted', to: 'call-back', date: '2025-11-20' })).toBe('Status: Not contacted yet to Call back (20 Nov 2025)');
    expect(w('status', { from: 'call-back', to: 'contacted', who_name: 'Agent One', text: 'left a message' })).toBe('Status: Call back to Contacted (Agent One, left a message)');
    expect(w('status', { from: 'contacted', to: 'closed' })).toBe('Status: Contacted to Closed');
    expect(w('edited', { field: 'lead_type', old: 'enquiry', new: 'buy' })).toBe('Changed lead_type: Enquiry to Looking to buy');
  });
});

// SEC-REGEX-BOUND: the address bar's trailing slashes are cut by a loop, not by an expression that is quadratic on a long run of slashes (method 7)
describe('withoutTrailingSlashes', () => {
  it('cuts every trailing slash and nothing else', () => {
    for (const [from, to] of [['', ''], ['/', ''], ['///', ''], ['/w/x/leads', '/w/x/leads'], ['/w/x/leads/', '/w/x/leads'], ['/w/x/leads///', '/w/x/leads'], ['/a//b/', '/a//b']] as [string, string][]) expect(withoutTrailingSlashes(from)).toBe(to);
  });
  it('does not stall on a long run of slashes', () => {
    expect(withoutTrailingSlashes(`x${'/'.repeat(300000)}`)).toBe('x');
    expect(withoutTrailingSlashes('/'.repeat(300000))).toBe('');
  });
  it('is what the Leads screen uses, and the expression is gone from it', () => {
    const src = readFileSync(new URL('../pages/Leads.tsx', import.meta.url), 'utf8');
    expect(src).toContain('withoutTrailingSlashes(s.location.pathname)');
    expect(src).not.toContain('.replace(/\\/+$/');
  });
});
