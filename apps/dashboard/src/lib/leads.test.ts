import { describe, expect, it } from 'vitest';
import {
  answerRows, filterCounts, filterLeads, formLabel, labelWords, leadsTitle, marketingLine, newestFirst, receivedWords, searchLeads, statusLabel, STATUSES, telHref, timelineLines, visibleLeads,
  type ContractForms, type Lead, type LeadStatus, type Names,
} from './leads';
import { problemFrom, UNREACHABLE } from './problems';

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
    expect(filterLeads([A, B, C, D], 'new', 't1').map(l => l.id)).toEqual(['a', 'd']);
    expect(filterLeads([A, B, C, D], 'all', 't1').map(l => l.id)).toEqual(['a', 'b', 'd']);
    expect(filterLeads([A, B, C, D], 'spam', 't1').map(l => l.id)).toEqual(['c']);
  });
  it('Mine is the leads owned by my team row, spam left out; with no team row it is empty (never everything)', () => {
    expect(filterLeads([A, B, C, D], 'mine', 't1').map(l => l.id)).toEqual(['a', 'd']);
    expect(filterLeads([A, B, C, D], 'mine', null)).toEqual([]);
    const spamMine = lead({ id: 'e', status: 'spam' as LeadStatus, owner_team_row: 't1' });
    expect(filterLeads([spamMine], 'mine', 't1')).toEqual([]);
  });
  it('counts what each filter shows (the number next to it)', () => {
    expect(filterCounts([A, B, C, D], 't1')).toEqual({ new: 2, all: 3, mine: 2, spam: 1 });
    expect(filterCounts([], null)).toEqual({ new: 0, all: 0, mine: 0, spam: 0 });
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
    expect(visibleLeads([A, B, C, D], { filter: 'all', query: 'e', myTeamRow: null }).map(l => l.id)).toEqual(['d', 'a', 'b']);
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

describe('work order 20: the status keys are the floor and show as words', () => {
  it('the keys are the floor list (new is called not-contacted) and every one has words', () => {
    expect([...STATUSES]).toEqual(['not-contacted', 'contacted', 'qualified', 'closed', 'spam']);
    expect(STATUSES.map(statusLabel)).toEqual(['Not contacted', 'Contacted', 'Qualified', 'Closed', 'Spam']);
  });
  it("a key of a business's own list is its key spelled out, and an older timeline event that says new reads as Not contacted", () => {
    expect(statusLabel('call-back')).toBe('Call back');
    expect(statusLabel('new')).toBe('Not contacted');
    expect(statusLabel('')).toBe('');
  });
});
