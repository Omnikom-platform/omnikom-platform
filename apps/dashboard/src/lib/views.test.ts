import { describe, expect, it } from 'vitest';
import { CORE_COLUMNS, FIRST_VIEW, listQuery, type Column, type ColumnFilter, type View } from './crm';
import {
  allColumns, canChangeView, canShareView, commitColumns, DISPLAY_ONLY, fromAddress, fromSaved, groupViews, moveColumn, parseAddress, pickerLines, shownColumns,
  toAddress, toggleColumn, toSaved, type ColumnInfo, type SavedView, type Screen,
} from './views';

// Test data lives in tests only (DECISIONS 44 bans sample data in the app source, not in a test that proves a rule).
const industry: Column[] = [
  { key: 'budget', label: 'Budget', type: 'number' },
  { key: 'beds', label: 'Beds', type: 'number' },
  { key: 'pets', label: 'Pets', type: 'boolean' },
];
const everything = allColumns(industry);
const info: ColumnInfo = key => {
  const c = [...CORE_COLUMNS, ...industry].find(x => x.key === key);
  return c ? { label: c.label, type: c.type } : null;
};
const budget: ColumnFilter = { key: 'budget', label: 'Budget', type: 'number', cond: 'between', from: '300000' };
const pets: ColumnFilter = { key: 'pets', label: 'Pets', type: 'boolean', cond: 'is', value: 'yes' };
const noPhone: ColumnFilter = { key: 'phone', label: 'Phone', type: 'text', cond: 'empty' };

describe('the columns the list shows', () => {
  it('the first view is the core columns, Follow-up, Possible duplicate, then the industry columns in form order', () => {
    expect(everything.map(c => c.key)).toEqual(['created_at', 'name', 'email', 'phone', 'form', 'page', 'status', 'owner', 'follow_up', 'duplicate', 'budget', 'beds', 'pets']);
    expect(shownColumns(everything, null)).toEqual(everything);
    expect(shownColumns(everything, [])).toEqual(everything);
  });
  it('a choice shows exactly those columns in that order; a key the list does not have is left out and Name never goes', () => {
    expect(shownColumns(everything, ['budget', 'name', 'status']).map(c => c.key)).toEqual(['budget', 'name', 'status']);
    expect(shownColumns(everything, ['budget', 'zz-gone', 'budget']).map(c => c.key)).toEqual(['name', 'budget']);
  });
  it('Follow-up and Possible duplicate only show: they are the two columns with no sort', () => {
    expect([...DISPLAY_ONLY].sort()).toEqual(['duplicate', 'follow_up']);
    expect(everything.filter(c => DISPLAY_ONLY.has(c.key)).map(c => c.label)).toEqual(['Follow-up', 'Possible duplicate']);
  });
  it('the picker lists the shown columns first, in order, then the rest; Name is locked; the ends cannot move past themselves', () => {
    const lines = pickerLines(everything, ['status', 'name', 'budget']);
    expect(lines.map(l => `${l.column.key}:${l.shown}`).slice(0, 5)).toEqual(['status:true', 'name:true', 'budget:true', 'created_at:false', 'email:false']);
    expect(lines.find(l => l.column.key === 'name')?.locked).toBe(true);
    expect(lines.find(l => l.column.key === 'status')).toMatchObject({ canUp: false, canDown: true });
    expect(lines.find(l => l.column.key === 'budget')).toMatchObject({ canUp: true, canDown: false });
    expect(lines.filter(l => !l.shown).every(l => !l.canUp && !l.canDown)).toBe(true);
  });
  it('ticking adds a column at the end, unticking removes it, and Name cannot be unticked', () => {
    expect(toggleColumn(everything, ['name', 'status'], 'budget')).toEqual(['name', 'status', 'budget']);
    expect(toggleColumn(everything, ['name', 'status'], 'status')).toEqual(['name']);
    expect(toggleColumn(everything, ['name', 'status'], 'name')).toEqual(['name', 'status']);
    expect(toggleColumn(everything, null, 'follow_up')).toEqual(everything.map(c => c.key).filter(k => k !== 'follow_up'));
  });
  it('Move up and Move down swap neighbours; at an end nothing moves', () => {
    expect(moveColumn(everything, ['name', 'status', 'budget'], 'budget', 'up')).toEqual(['name', 'budget', 'status']);
    expect(moveColumn(everything, ['name', 'status', 'budget'], 'name', 'down')).toEqual(['status', 'name', 'budget']);
    expect(moveColumn(everything, ['name', 'status', 'budget'], 'name', 'up')).toEqual(['name', 'status', 'budget']);
    expect(moveColumn(everything, ['name', 'status', 'budget'], 'budget', 'down')).toEqual(['name', 'status', 'budget']);
  });
  it('a choice equal to the first view is kept as no choice (the address stays bare), any other is kept', () => {
    expect(commitColumns(everything, everything.map(c => c.key))).toBeNull();
    expect(commitColumns(everything, ['name', 'status'])).toEqual(['name', 'status']);
    expect(commitColumns(everything, everything.map(c => c.key).reverse())).not.toBeNull();
  });
});

describe('the view in the page address', () => {
  const full: Screen = {
    view: { filter: 'mine', search: 'smith', site: 's1', columnFilters: [budget, pets, noPhone], sort: { field: 'budget', dir: 'desc' }, page: 3, due: true, duplicates: true },
    columns: ['name', 'follow_up', 'budget'],
    viewId: '11111111-1111-4111-8111-111111111111',
  };
  it('the first view is a bare address', () => {
    expect(toAddress({ view: FIRST_VIEW, columns: null, viewId: '' })).toEqual({});
    expect(fromAddress({}, info)).toEqual({ view: FIRST_VIEW, columns: null, viewId: '' });
  });
  it('every part of the view goes into the address and comes back as it was', () => {
    const a = toAddress(full);
    expect(a).toMatchObject({ f: 'mine', q: 'smith', sort: 'budget:desc', site: 's1', page: 3, due: true, dup: true, cols: ['name', 'follow_up', 'budget'], view: full.viewId });
    expect(fromAddress(parseAddress(JSON.parse(JSON.stringify(a))), info)).toEqual(full);
  });
  it('each filter keeps its condition and its typed ends; the label and the type come back from the columns', () => {
    const back = fromAddress(parseAddress(toAddress(full) as Record<string, unknown>), info).view.columnFilters;
    expect(back).toEqual([budget, pets, noPhone]);
  });
  it('an end left empty in the box and an end that is not in the address are the same filter for the server', () => {
    const typed: ColumnFilter = { ...budget, to: '' };
    const back = fromAddress(parseAddress(toAddress({ view: { ...FIRST_VIEW, columnFilters: [typed] }, columns: null, viewId: '' }) as Record<string, unknown>), info).view.columnFilters;
    expect(listQuery({ ...FIRST_VIEW, columnFilters: back }, null)).toEqual(listQuery({ ...FIRST_VIEW, columnFilters: [typed] }, null));
  });
  it('a filter on a column the list does not know is read as text under its key, not lost', () => {
    const back = fromAddress({ cf: [{ k: 'zz', c: 'is', v: 'x' }] }, info).view.columnFilters;
    expect(back).toEqual([{ key: 'zz', label: 'zz', type: 'text', cond: 'is', value: 'x' }]);
  });
  it('what is not ours or not of the right kind is dropped, never trusted', () => {
    const a = parseAddress({
      f: 'zzz', q: ['x'], sort: 'bad', cf: [{ k: 'a', c: 'nope' }, { c: 'is' }, 5, { k: 'ok', c: 'empty' }], page: -2, due: 'yes', dup: false, cols: 'name', view: 7, extra: 1,
    });
    expect(a).toEqual({ cf: [{ k: 'ok', c: 'empty' }], view: '7' });
  });
  it('a search typed as digits stays text (the router reads "2024" as a number)', () => {
    expect(parseAddress({ q: 2024 }).q).toBe('2024');
    expect(fromAddress(parseAddress({ q: 2024 }), info).view.search).toBe('2024');
  });
  it('page 1 and the default filter are left out; a page past 100000 is dropped', () => {
    expect(toAddress({ view: { ...FIRST_VIEW, page: 1, filter: 'new' }, columns: null, viewId: '' })).toEqual({});
    expect(parseAddress({ page: 100001 }).page).toBeUndefined();
    expect(parseAddress({ page: '4' }).page).toBe(4);
  });
});

describe('a saved view and the screen it makes', () => {
  const mine = 't-mine';
  const base: View = { ...FIRST_VIEW };
  const roundTrip = (v: View, cols: string[] | null = null, myTeamRow: string | null = mine) => {
    const shown = shownColumns(everything, cols);
    const saved = toSaved(v, myTeamRow, shown);
    return fromSaved(JSON.parse(JSON.stringify(saved.query)), saved.columns, { myTeamRow, info });
  };
  it('saves the very query lead-list takes (the same function builds both) and the keys of the columns shown', () => {
    const v: View = { ...base, filter: 'all', search: 'ab', due: true, duplicates: true, columnFilters: [budget] };
    const saved = toSaved(v, mine, shownColumns(everything, ['name', 'budget']));
    expect(saved.query).toEqual(listQuery(v, mine));
    expect(saved.query).toMatchObject({ due: true, duplicates: true, search: 'ab' });
    expect(saved.columns).toEqual(['name', 'budget']);
  });
  it('New, All, Mine and Spam each come back as themselves', () => {
    for (const filter of ['new', 'all', 'mine', 'spam'] as const) expect(roundTrip({ ...base, filter }).view.filter, filter).toBe(filter);
  });
  it('search, sort, site, the flags and every kind of column filter come back as they were', () => {
    const v: View = { ...base, filter: 'all', search: 'smith', site: 's1', sort: { field: 'budget', dir: 'asc' }, due: true, duplicates: true, columnFilters: [budget, pets, noPhone, { key: 'beds', label: 'Beds', type: 'number', cond: 'not_empty' }] };
    const r = roundTrip(v);
    expect(r.view).toEqual(v);
    expect(r.dropped).toBe(0);
  });
  it('the columns come back in order; no column list means the first view', () => {
    expect(roundTrip(base, ['name', 'budget']).columns).toEqual(['name', 'budget']);
    expect(fromSaved({ filters: [] }, [], { myTeamRow: null, info }).columns).toBeNull();
  });
  it('Mine of another person is an owner filter for the reader, never their own Mine', () => {
    const saved = toSaved({ ...base, filter: 'mine' }, 'someone-else', everything);
    const r = fromSaved(saved.query, saved.columns, { myTeamRow: mine, info });
    expect(r.view.filter).toBe('all');
    expect(r.view.columnFilters).toEqual([{ key: 'owner', label: 'Owner', type: 'owner', cond: 'is', value: 'someone-else' }]);
  });
  it('a reader with no team row reads Mine as Mine (it matches nobody, as it did for the saver)', () => {
    const saved = toSaved({ ...base, filter: 'mine' }, null, everything);
    expect(fromSaved(saved.query, saved.columns, { myTeamRow: null, info }).view.filter).toBe('mine');
  });
  it('a query with no status filter reads as All; a status the four cannot say stays a filter on Status', () => {
    expect(fromSaved({ filters: [] }, null, { myTeamRow: null, info }).view.filter).toBe('all');
    const r = fromSaved({ filters: [{ field: 'status', op: 'eq', value: 'contacted' }] }, null, { myTeamRow: null, info });
    expect(r.view.filter).toBe('all');
    expect(r.view.columnFilters).toEqual([{ key: 'status', label: 'Status', type: 'enum', cond: 'is', value: 'contacted' }]);
  });
  it('a filter the controls cannot say (an in of several values on a column) is counted, not turned into another filter', () => {
    const r = fromSaved({ filters: [{ field: 'status', op: 'eq', value: 'new' }, { field: 'beds', op: 'in', values: [2, 3] }] }, null, { myTeamRow: null, info });
    expect(r.dropped).toBe(1);
    expect(r.view.columnFilters).toEqual([]);
    expect(fromSaved({ filters: [{ field: 'status', op: 'eq', value: 'new' }, { field: 'beds', op: 'in', values: [2] }] }, null, { myTeamRow: null, info }).view.columnFilters).toHaveLength(1);
  });
  it('a view saved before work order 20 (status new) and one saved now (status not-contacted) both read back as New', () => {
    for (const value of ['new', 'not-contacted']) {
      const r = fromSaved({ filters: [{ field: 'status', op: 'eq', value }] }, null, { myTeamRow: null, info });
      expect(r.view.filter, value).toBe('new');
      expect(r.view.columnFilters, value).toEqual([]);
    }
    expect(toSaved({ ...FIRST_VIEW }, null, []).query.filters).toEqual([{ field: 'status', op: 'eq', value: 'not-contacted' }]);
  });
  it('the page is always 1 and a stored query of the wrong shape never throws', () => {
    expect(fromSaved({ filters: [] }, null, { myTeamRow: null, info }).view.page).toBe(1);
    expect(() => fromSaved({} as never, undefined, { myTeamRow: null, info })).not.toThrow();
    expect(() => fromSaved({ filters: 'x', sort: 5, search: 3 } as never, null, { myTeamRow: null, info })).not.toThrow();
  });
});

describe('who may do what to a view', () => {
  const own: SavedView = { id: '1', user_id: 'me', name: 'Beta', query: {}, columns: [] };
  const other: SavedView = { id: '2', user_id: null, name: 'alpha', query: {}, columns: [] };
  const mate: SavedView = { id: '3', user_id: 'someone', name: 'Gamma', query: {}, columns: [] };
  it('Your views are the caller\'s own, Shared views the ones with no person, each by name', () => {
    const g = groupViews([own, other, mate, { ...own, id: '4', name: 'Alpha' }], 'me');
    expect(g.mine.map(v => v.name)).toEqual(['Alpha', 'Beta']);
    expect(g.shared.map(v => v.name)).toEqual(['alpha']);
  });
  it('Save and Delete: your own, or a shared view for an owner; never another person\'s', () => {
    expect(canChangeView(own, 'me', false)).toBe(true);
    expect(canChangeView(other, 'me', false)).toBe(false);
    expect(canChangeView(other, 'me', true)).toBe(true);
    expect(canChangeView(mate, 'me', true)).toBe(false);
  });
  it('Share: an owner, on their own view; a member never, a shared view never', () => {
    expect(canShareView(own, 'me', true)).toBe(true);
    expect(canShareView(own, 'me', false)).toBe(false);
    expect(canShareView(other, 'me', true)).toBe(false);
  });
});
