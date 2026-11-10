import { describe, expect, it } from 'vitest';
import {
  allOnPage, cellText, choicesFor, conditionsFor, countQuery, describeFilter, editText, editValue, FIRST_VIEW, nextSort, pageLine, pageNumbers, recordFields, sortState,
  listQuery, statusFilters, toggleId, toListFilter, togglePage, viewFilters, viewQuery, type ColumnFilter, type Column, type ListRow,
} from './crm';
import { editedLine, plainValue, receivedWords, smsLine, timelineLines, type Lead } from './leads';

// Test data lives in tests only (DECISIONS 44 bans sample data in the app source, not in a test that proves a rule).
const budget: ColumnFilter = { key: 'budget', label: 'Budget', type: 'number', cond: 'between', from: '300000', to: '' };
const view = { ...FIRST_VIEW, filter: 'all' as const };

describe('the status filters and the query the list sends', () => {
  it('New, All, Spam and Mine are lead-list filters on status and owner', () => {
    expect(statusFilters('new', 't1')).toEqual([{ field: 'status', op: 'eq', value: 'not-contacted' }]);
    expect(statusFilters('spam', 't1')).toEqual([{ field: 'status', op: 'eq', value: 'spam' }]);
    expect(statusFilters('all', 't1')).toEqual([{ field: 'status', op: 'in', values: ['not-contacted', 'contacted', 'qualified', 'closed'] }]);
    expect(statusFilters('mine', 't1')).toEqual([{ field: 'status', op: 'in', values: ['not-contacted', 'contacted', 'qualified', 'closed'] }, { field: 'owner', op: 'eq', value: 't1' }]);
  });
  it('Mine with no team row of mine matches nobody, never everybody', () => {
    expect(statusFilters('mine', null)[1]).toEqual({ field: 'owner', op: 'in', values: [] });
  });
  it('a search under 2 characters is not sent; 2 or more is, trimmed', () => {
    expect(viewQuery({ ...view, search: 'a' }, null).search).toBeUndefined();
    expect(viewQuery({ ...view, search: '  ab ' }, null).search).toBe('ab');
  });
  it('the site is a filter only when there is one chosen, and column filters follow the status filter', () => {
    expect(viewFilters({ filter: 'new', site: '', columnFilters: [] }, null)).toHaveLength(1);
    const f = viewFilters({ filter: 'new', site: 's1', columnFilters: [budget] }, null);
    expect(f.map(x => x.field)).toEqual(['status', 'site', 'budget']);
    expect(f[1]).toEqual({ field: 'site', op: 'eq', value: 's1' });
  });
  it('the sort goes through when chosen and the count query has no search, column filter or sort', () => {
    expect(viewQuery({ ...view, sort: { field: 'budget', dir: 'desc' } }, null).sort).toEqual({ field: 'budget', dir: 'desc' });
    expect(viewQuery(view, null).sort).toBeUndefined();
    expect(countQuery('mine', 's1', 't1')).toEqual({ filters: viewFilters({ filter: 'mine', site: 's1', columnFilters: [] }, 't1') });
  });
});

describe('column filters are typed by their column', () => {
  it('a number range sends numbers and only the ends that are filled', () => {
    expect(toListFilter(budget)).toEqual({ field: 'budget', op: 'range', from: 300000 });
    expect(toListFilter({ ...budget, from: '', to: '' })).toBeNull();
    expect(toListFilter({ ...budget, from: 'abc', to: '' })).toBeNull();
  });
  it('is on a number sends a number, on a tick a boolean, on anything else the text', () => {
    expect(toListFilter({ key: 'beds', label: 'Beds', type: 'number', cond: 'is', value: '3' })).toEqual({ field: 'beds', op: 'eq', value: 3 });
    expect(toListFilter({ key: 'pre', label: 'Pre-approved', type: 'boolean', cond: 'is', value: 'no' })).toEqual({ field: 'pre', op: 'eq', value: false });
    expect(toListFilter({ key: 'timing', label: 'Timing', type: 'enum', cond: 'is', value: '0-3 months' })).toEqual({ field: 'timing', op: 'eq', value: '0-3 months' });
    expect(toListFilter({ key: 'timing', label: 'Timing', type: 'enum', cond: 'is', value: ' ' })).toBeNull();
  });
  it('is empty and is not empty need no value', () => {
    expect(toListFilter({ key: 'area', label: 'Area', type: 'enum', cond: 'empty' })).toEqual({ field: 'area', op: 'empty' });
    expect(toListFilter({ key: 'area', label: 'Area', type: 'enum', cond: 'not_empty' })).toEqual({ field: 'area', op: 'not_empty' });
  });
  it('a column offers between for numbers and dates, is for the rest, and always the two empty tests', () => {
    expect(conditionsFor('number')).toEqual(['between', 'empty', 'not_empty']);
    expect(conditionsFor('date')).toEqual(['between', 'empty', 'not_empty']);
    expect(conditionsFor('enum')).toEqual(['is', 'empty', 'not_empty']);
    expect(choicesFor({ type: 'boolean' })).toEqual(['yes', 'no']);
    expect(choicesFor({ type: 'enum', options: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(choicesFor({ type: 'text' })).toBeNull();
  });
  it('the filters in use read in words', () => {
    expect(describeFilter(budget)).toBe('Budget is between 300000 and ');
    expect(describeFilter({ key: 'area', label: 'Area', type: 'enum', cond: 'is', value: 'x' }, v => v.toUpperCase())).toBe('Area is X');
    expect(describeFilter({ key: 'area', label: 'Area', type: 'enum', cond: 'empty' })).toBe('Area is empty');
    expect(describeFilter({ key: 'area', label: 'Area', type: 'enum', cond: 'not_empty' })).toBe('Area is not empty');
  });
});

describe('sort, selection and paging', () => {
  it('the first view is received, newest first; a tap on the sorted heading reverses it, another heading starts ascending', () => {
    expect(sortState(null, 'created_at')).toBe('descending');
    expect(sortState(null, 'name')).toBeUndefined();
    expect(nextSort(null, 'created_at')).toEqual({ field: 'created_at', dir: 'asc' });
    expect(nextSort(null, 'budget')).toEqual({ field: 'budget', dir: 'asc' });
    expect(nextSort({ field: 'budget', dir: 'asc' }, 'budget')).toEqual({ field: 'budget', dir: 'desc' });
    expect(nextSort({ field: 'budget', dir: 'desc' }, 'created_at')).toEqual({ field: 'created_at', dir: 'desc' });
  });
  it('select all on the page selects the page, a second tap clears it, and rows toggle one by one', () => {
    const ids = ['a', 'b', 'c'];
    expect(allOnPage(new Set(), ids)).toBe(false);
    const all = togglePage(new Set(['z']), ids);
    expect([...all].sort()).toEqual(['a', 'b', 'c', 'z']);
    expect(allOnPage(all, ids)).toBe(true);
    expect([...togglePage(all, ids)]).toEqual(['z']);
    expect(allOnPage(new Set(), [])).toBe(false);
    expect([...toggleId(new Set(['a']), 'b')].sort()).toEqual(['a', 'b']);
    expect([...toggleId(new Set(['a']), 'a')]).toEqual([]);
  });
  it('the paging line counts what is on this page', () => {
    expect(pageLine(1, 50, 132)).toBe('1 to 50 of 132');
    expect(pageLine(3, 50, 132)).toBe('101 to 132 of 132');
    expect(pageNumbers(1, 50, 0)).toEqual({ from: 0, to: 0, last: 1 });
    expect(pageNumbers(1, 50, 132).last).toBe(3);
  });
});

describe('cells, record fields and edits', () => {
  const row = { id: 'x', created_at: '2026-10-30T09:12:00Z', name: 'Ada', email: null, phone: null, status: 'not-contacted', owner: 't1', form: 'manual', page: '/home', site: 's1', budget: 450000, pre: true, tags: ['a', 'b'] } as ListRow;
  const o = { owner: (id: string) => (id === 't1' ? 'Agent One' : ''), forms: null };
  it('a cell is words: the owner by name, a number plain, a tick Yes or No, a list joined, a hand-entered lead has no page', () => {
    expect(cellText(row, 'owner', o)).toBe('Agent One');
    expect(cellText(row, 'budget', o)).toBe('450000');
    expect(cellText(row, 'pre', o)).toBe('Yes');
    expect(cellText(row, 'tags', o)).toBe('a, b');
    expect(cellText(row, 'email', o)).toBe('');
    expect(cellText(row, 'page', o)).toBe('');
    expect(cellText({ ...row, form: 'contact' }, 'page', o)).toBe('/home');
  });

  const lead = { id: 'x', workspace_id: 'w', site_id: 's1', form: 'contact', flow: 'f', page_path: '/home', name: 'Ada', email: null, phone: '555', answers: { budget: 450000 }, consent_text: 'c', marketing_consent: null, status: 'not-contacted', owner_team_row: null, created_at: '2026-10-30T09:12:00Z', cta: 'Book', sms_consent: false } as Lead;
  const fields: Column[] = [{ key: 'budget', label: 'Budget', type: 'number', min: 0, max: 5000000 }, { key: 'area', label: 'Area', type: 'enum', options: ['north'], editable: false }];
  it('the record lists every field in order, edits the core three and the industry fields not marked read only', () => {
    const rows = recordFields(lead, fields, { forms: null, siteName: () => 'site one', manySites: true });
    expect(rows.map(r => r.label)).toEqual(['Name', 'Email', 'Phone', 'Budget', 'Area', 'Form', 'Page', 'Flow', 'Call to action', 'Site', 'Received']);
    expect(rows.filter(r => r.editable).map(r => r.key)).toEqual(['name', 'email', 'phone', 'budget']);
    expect(rows.find(r => r.key === 'email')).toMatchObject({ display: 'Empty', empty: true });
    expect(rows.find(r => r.key === 'budget')).toMatchObject({ display: '450000', empty: false });
    expect(rows.find(r => r.key === 'cta')?.display).toBe('Book');
  });
  it('the site shows only with two or more sites', () => {
    expect(recordFields(lead, fields, { forms: null, siteName: () => 'x', manySites: false }).some(r => r.key === 'site')).toBe(false);
  });
  it('an edit becomes the typed value: a number a number within its limits, a tick a boolean, empty clears, a list stays a list', () => {
    expect(editValue({ type: 'number', min: 0, max: 10 }, '7')).toEqual({ ok: true, value: 7 });
    expect(editValue({ type: 'number', min: 0, max: 10 }, '11')).toEqual({ ok: false });
    expect(editValue({ type: 'number' }, 'abc')).toEqual({ ok: false });
    expect(editValue({ type: 'boolean' }, 'yes')).toEqual({ ok: true, value: true });
    expect(editValue({ type: 'boolean' }, 'no')).toEqual({ ok: true, value: false });
    expect(editValue({ type: 'text' }, '  ')).toEqual({ ok: true, value: null });
    expect(editValue({ type: 'multi' }, ['a', 'b'])).toEqual({ ok: true, value: ['a', 'b'] });
    expect(editText({ type: 'boolean', value: true })).toBe('yes');
    expect(editText({ type: 'number', value: 5 })).toBe('5');
    expect(editText({ type: 'text', value: null })).toBe('');
    expect(editText({ type: 'multi', value: ['a'] })).toEqual(['a']);
  });
});

describe('the timeline and the consent lines', () => {
  it('an edit reads "Changed <field>: <old> to <new>" and a value with nothing in it reads empty', () => {
    const label = (k: string) => (k === 'budget' ? 'Budget' : k);
    expect(editedLine({ field: 'budget', old: 300000, new: 450000 }, label)).toBe('Changed Budget: 300000 to 450000');
    expect(editedLine({ field: 'budget', old: null, new: 5 }, label)).toBe('Changed Budget: empty to 5');
    expect(editedLine({ field: 'pre', old: false, new: true }, label)).toBe('Changed pre: No to Yes');
    expect(plainValue(['x', 'y'])).toBe('x, y');
  });
  it('the timeline has an edited line, and the dropped push kinds fall through to their own name', () => {
    const names = { me: null, byUser: new Map<string, string>(), team: new Map<string, string>() };
    const lines = timelineLines([{ id: 1, kind: 'edited', by: null, detail: { field: 'budget', old: 1, new: 2 }, at: '2026-10-30T09:00:00Z' }], null, names, () => 'Budget');
    expect(lines[0]?.what).toBe('Changed Budget: 1 to 2');
    expect(timelineLines([{ id: 2, kind: 'pushed', by: null, detail: {}, at: '2026-10-30T09:00:00Z' }], null, names)[0]?.what).toBe('pushed');
  });
  it('the text-message line says yes or no', () => {
    expect(smsLine(true)).toBe('Text messages: yes');
    expect(smsLine(false)).toBe('Text messages: no');
    expect(smsLine(undefined)).toBe('Text messages: no');
  });
});

describe('work order 19: the follow-up cell and the two flags of lead-list', () => {
  const row = (o: Partial<ListRow>): ListRow => ({ id: 'r1', created_at: '2025-01-05T09:00:00Z', name: 'n', email: null, phone: null, status: 'not-contacted', owner: null, form: 'contact', page: '/p', site: null, ...o });
  it('the follow-up cell is the follow-up worded as the received time, and empty with none', () => {
    const at = '2025-01-09T09:00:00Z';
    expect(cellText(row({ follow_up: at }), 'follow_up', { owner: () => '', forms: null })).toBe(receivedWords(at));
    expect(cellText(row({ follow_up: null }), 'follow_up', { owner: () => '', forms: null })).toBe('');
    expect(cellText(row({}), 'follow_up', { owner: () => '', forms: null })).toBe('');
  });
  it('Due and Duplicates go to lead-list only when ticked, and never into the export query', () => {
    expect(listQuery(view, null)).toEqual(viewQuery(view, null));
    expect(listQuery({ ...view, due: true }, null)).toMatchObject({ due: true });
    expect(listQuery({ ...view, due: true }, null)).not.toHaveProperty('duplicates');
    expect(listQuery({ ...view, duplicates: true }, null)).toMatchObject({ duplicates: true });
    expect(viewQuery({ ...view, due: true, duplicates: true }, null)).not.toHaveProperty('due');
    expect(viewQuery({ ...view, due: true, duplicates: true }, null)).not.toHaveProperty('duplicates');
    expect(FIRST_VIEW).toMatchObject({ due: false, duplicates: false });
  });
});

describe('work order 20: the status cell is words, and New asks for not-contacted', () => {
  it('the Status cell shows the label of the key, not the key', () => {
    const o = { owner: () => '', forms: null };
    const r = (status: string) => ({ id: 'r', created_at: '2025-01-05T09:00:00Z', name: 'n', email: null, phone: null, status, owner: null, form: 'contact', page: '/p', site: null }) as unknown as ListRow;
    expect(cellText(r('not-contacted'), 'status', o)).toBe('Not contacted');
    expect(cellText(r('closed'), 'status', o)).toBe('Closed');
    expect(cellText(r('call-back'), 'status', o)).toBe('Call back');
  });
  it('the first screen is the New filter, which is status not-contacted (the platform floor key)', () => {
    expect(FIRST_VIEW.filter).toBe('new');
    expect(viewFilters({ filter: 'new', site: '', columnFilters: [] }, null)).toEqual([{ field: 'status', op: 'eq', value: 'not-contacted' }]);
  });
});
