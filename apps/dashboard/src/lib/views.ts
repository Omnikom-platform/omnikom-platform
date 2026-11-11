// The pure parts of work order 19: the Leads view in the page address and back, a saved view (a lead-list query plus a column list) and back,
// the columns the list shows and how the picker changes them. No browser, no network: Vitest covers all of it. Words that are copy come from
// the plan (t(), DECISIONS 44).
import { t } from '../plan';
import { allKeys, newKeys, type Filter, type Lists } from './leads';
import {
  CORE_COLUMNS, FIRST_VIEW, listQuery, type Column, type ColumnFilter, type Condition, type ListFilter, type SortSpec, type View,
} from './crm';

// ---------- the columns (DP-1.3-51 to -54) ----------

/** The two columns that only show (lead-list refuses to sort or filter by them: they are not in its query check). */
export const FOLLOW_UP: Column = { key: 'follow_up', label: t('DP-1.3-52', 'Follow-up'), type: 'datetime' };
export const DUPLICATE: Column = { key: 'duplicate', label: t('DP-1.3-52', 'Possible duplicate'), type: 'duplicate' };
export const DISPLAY_ONLY: ReadonlySet<string> = new Set([FOLLOW_UP.key, DUPLICATE.key]);

/** Every column the list can show, in the first view's order: the core columns, Follow-up, Possible duplicate, then the industry columns in form order. */
export const allColumns = (industry: Column[]): Column[] => [...CORE_COLUMNS, FOLLOW_UP, DUPLICATE, ...industry];

/** The columns shown for a choice (the keys in the address or in a saved view); no choice is the first view. A key the list does not have is left out; Name always stays. */
export function shownColumns(all: Column[], chosen: readonly string[] | null | undefined): Column[] {
  if (!chosen || chosen.length === 0) return all;
  const out: Column[] = [];
  for (const k of chosen) {
    const c = all.find(x => x.key === k);
    if (c && !out.includes(c)) out.push(c);
  }
  const name = all.find(c => c.key === 'name');
  if (name && !out.includes(name)) out.unshift(name);
  return out;
}

/** The choice to keep in the address: null when it is the first view exactly. */
export function commitColumns(all: Column[], keys: readonly string[]): string[] | null {
  const same = keys.length === all.length && keys.every((k, i) => k === all[i]?.key);
  return same ? null : [...keys];
}

export type PickerLine = { column: Column; shown: boolean; locked: boolean; canUp: boolean; canDown: boolean };

/** The picker's lines (DP-1.3-52): the shown columns first, in their order, then the others in the first view's order. */
export function pickerLines(all: Column[], chosen: readonly string[] | null | undefined): PickerLine[] {
  const shown = shownColumns(all, chosen);
  const rest = all.filter(c => !shown.includes(c));
  return [
    ...shown.map((column, i) => ({ column, shown: true, locked: column.key === 'name', canUp: i > 0, canDown: i < shown.length - 1 })),
    ...rest.map(column => ({ column, shown: false, locked: false, canUp: false, canDown: false })),
  ];
}

/** Tick or untick one column: unticked leaves, ticked joins at the end. Name cannot leave. Returns the new keys, in order. */
export function toggleColumn(all: Column[], chosen: readonly string[] | null | undefined, key: string): string[] {
  const keys = shownColumns(all, chosen).map(c => c.key);
  if (keys.includes(key)) return key === 'name' ? keys : keys.filter(k => k !== key);
  return all.some(c => c.key === key) ? [...keys, key] : keys;
}

/** Move a shown column one place up or down; at its end nothing moves. */
export function moveColumn(all: Column[], chosen: readonly string[] | null | undefined, key: string, dir: 'up' | 'down'): string[] {
  const keys = shownColumns(all, chosen).map(c => c.key);
  const i = keys.indexOf(key);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= keys.length) return keys;
  [keys[i], keys[j]] = [keys[j]!, keys[i]!];
  return keys;
}

// ---------- the view in the page address (DP-1.3-51, -55, -56, -60) ----------

/** A column filter as the address keeps it: the key, the condition and the typed strings; the label and the type come back from the columns. */
export type AddressFilter = { k: string; c: Condition; v?: string; a?: string; b?: string };
export type LeadsSearch = { f?: Filter; q?: string; sort?: string; cf?: AddressFilter[]; site?: string; page?: number; due?: true; dup?: true; cols?: string[]; view?: string };

/** What the screen holds besides the server's data: the view, the columns chosen (null: the first view's), and the saved view applied (empty: none). */
export type Screen = { view: View; columns: string[] | null; viewId: string };

const FILTER_IDS: readonly string[] = ['new', 'all', 'mine', 'spam'];
const CONDITIONS: readonly string[] = ['is', 'between', 'empty', 'not_empty'];
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

/** The router's validateSearch: anything that is not one of ours is dropped, a value of the wrong kind is dropped, never trusted. */
export function parseAddress(raw: Record<string, unknown>): LeadsSearch {
  const out: LeadsSearch = {};
  if (typeof raw.f === 'string' && FILTER_IDS.includes(raw.f) && raw.f !== FIRST_VIEW.filter) out.f = raw.f as Filter;
  const q = str(raw.q);
  if (q) out.q = q;
  if (typeof raw.sort === 'string' && /^.+:(asc|desc)$/.test(raw.sort)) out.sort = raw.sort;
  if (Array.isArray(raw.cf)) {
    const cf: AddressFilter[] = [];
    for (const e of raw.cf.slice(0, 20)) {
      const o = e && typeof e === 'object' ? (e as Record<string, unknown>) : {};
      const k = str(o.k), c = str(o.c);
      if (!k || !CONDITIONS.includes(c)) continue;
      cf.push({ k, c: c as Condition, ...(str(o.v) ? { v: str(o.v) } : {}), ...(str(o.a) ? { a: str(o.a) } : {}), ...(str(o.b) ? { b: str(o.b) } : {}) });
    }
    if (cf.length) out.cf = cf;
  }
  const site = str(raw.site);
  if (site) out.site = site;
  const page = Number(raw.page);
  if (Number.isInteger(page) && page > 1 && page <= 100000) out.page = page;
  if (raw.due === true || raw.due === 'true') out.due = true;
  if (raw.dup === true || raw.dup === 'true') out.dup = true;
  if (Array.isArray(raw.cols)) {
    const cols = raw.cols.filter((k): k is string => typeof k === 'string' && k !== '').slice(0, 60);
    if (cols.length) out.cols = cols;
  }
  const view = str(raw.view);
  if (view) out.view = view;
  return out;
}

const sortText = (s: SortSpec): string => `${s.field}:${s.dir}`;
function sortOf(text: string | undefined): SortSpec | null {
  const m = text ? /^(.+):(asc|desc)$/.exec(text) : null;
  return m ? { field: m[1]!, dir: m[2] as 'asc' | 'desc' } : null;
}

/** The screen as an address: every default is left out, so the first view is a bare address. */
export function toAddress(s: Screen): LeadsSearch {
  const v = s.view;
  return {
    ...(v.filter !== FIRST_VIEW.filter ? { f: v.filter } : {}),
    ...(v.search ? { q: v.search } : {}),
    ...(v.sort ? { sort: sortText(v.sort) } : {}),
    ...(v.columnFilters.length ? { cf: v.columnFilters.map(f => ({ k: f.key, c: f.cond, ...(f.value ? { v: f.value } : {}), ...(f.from ? { a: f.from } : {}), ...(f.to ? { b: f.to } : {}) })) } : {}),
    ...(v.site ? { site: v.site } : {}),
    ...(v.page > 1 ? { page: v.page } : {}),
    ...(v.due ? { due: true as const } : {}),
    ...(v.duplicates ? { dup: true as const } : {}),
    ...(s.columns && s.columns.length ? { cols: [...s.columns] } : {}),
    ...(s.viewId ? { view: s.viewId } : {}),
  };
}

/** What a column key is called and typed: from the columns of the list; a key it does not know is read as text under its own name. */
export type ColumnInfo = (key: string) => { label: string; type: string } | null;

export function fromAddress(a: LeadsSearch, info: ColumnInfo): Screen {
  const columnFilters: ColumnFilter[] = (a.cf ?? []).map(f => {
    const i = info(f.k);
    return { key: f.k, label: i?.label ?? f.k, type: i?.type ?? 'text', cond: f.c, ...(f.v !== undefined ? { value: f.v } : {}), ...(f.a !== undefined ? { from: f.a } : {}), ...(f.b !== undefined ? { to: f.b } : {}) };
  });
  return {
    view: { filter: a.f ?? FIRST_VIEW.filter, search: a.q ?? '', site: a.site ?? '', columnFilters, sort: sortOf(a.sort), page: a.page ?? 1, due: a.due === true, duplicates: a.dup === true },
    columns: a.cols && a.cols.length ? [...a.cols] : null,
    viewId: a.view ?? '',
  };
}

// ---------- a saved view: the lead-list query and the column list (DP-1.3-60, -63, -64) ----------

export type SavedQuery = ReturnType<typeof listQuery>;

/** What view-save stores for the screen: the very query lead-list takes, and the keys of the columns shown. */
export function toSaved(view: View, myTeamRow: string | null, shown: readonly Column[], lists: Lists): { query: SavedQuery; columns: string[] } {
  return { query: listQuery(view, myTeamRow, lists), columns: shown.map(c => c.key) };
}

const sameSet = (a: unknown[] | undefined, b: readonly string[]) => Array.isArray(a) && a.length === b.length && b.every(x => a.includes(x));

/** One stored filter as a column filter the person could have built (DP-1.3-28); null when the controls cannot say it. */
function toColumnFilter(f: ListFilter, info: ColumnInfo): ColumnFilter | null {
  const i = info(f.field);
  const base = { key: f.field, label: i?.label ?? f.field, type: i?.type ?? 'text' };
  const word = (v: unknown) => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : str(v));
  switch (f.op) {
    case 'empty': return { ...base, cond: 'empty' };
    case 'not_empty': return { ...base, cond: 'not_empty' };
    case 'range': return { ...base, cond: 'between', ...(f.from !== undefined ? { from: word(f.from) } : {}), ...(f.to !== undefined ? { to: word(f.to) } : {}) };
    case 'eq': return { ...base, cond: 'is', value: word(f.value) };
    case 'in': return f.values && f.values.length === 1 ? { ...base, cond: 'is', value: word(f.values[0]) } : null;
    default: return null;
  }
}

/**
 * A stored view as the screen's pieces. The status filter reads back as New, All, Mine or Spam; Mine only when the owner it names is the caller's
 * own team row (another person's Mine is that person as an owner filter). A query with no status filter reads as All. A status filter the four
 * cannot say stays as a column filter on Status (with All, which it narrows). `dropped` counts filters the controls cannot say (an `in` of
 * several values on a column); a view made only by the screen has none. The page is always 1.
 */
export function fromSaved(query: Partial<SavedQuery> & { due?: unknown; duplicates?: unknown }, columns: readonly string[] | null | undefined, o: { myTeamRow: string | null; info: ColumnInfo; lists: Lists }): { view: View; columns: string[] | null; dropped: number } {
  const filters = Array.isArray(query.filters) ? [...query.filters] : [];
  let filter: Filter = 'all';
  let dropped = 0;
  const rest: ListFilter[] = [];
  const statusAt = filters.findIndex(f => f.field === 'status');
  const status = statusAt >= 0 ? filters[statusAt]! : null;
  // a view saved before work order 20 says status new; that status is now called not-contacted, and both read back as New
  const fresh = newKeys(o.lists), every = allKeys(o.lists);
  if (status && ((status.op === 'eq' && (status.value === 'new' || fresh.includes(String(status.value)))) || (status.op === 'in' && fresh.length > 1 && sameSet(status.values, fresh)))) filter = 'new';
  else if (status && status.op === 'eq' && status.value === 'spam') filter = 'spam';
  else if (status && status.op === 'in' && sameSet(status.values, every)) filter = 'all';
  else if (status) rest.push(status);
  if (filter === 'all' && status && status.op === 'in' && sameSet(status.values, every)) {
    const ownerAt = filters.findIndex(f => f.field === 'owner' && ((f.op === 'eq' && o.myTeamRow !== null && f.value === o.myTeamRow) || (f.op === 'in' && o.myTeamRow === null && Array.isArray(f.values) && f.values.length === 0)));
    if (ownerAt >= 0) { filter = 'mine'; filters.splice(ownerAt, 1); }
  }
  let site = '';
  const columnFilters: ColumnFilter[] = [];
  for (const [i, f] of filters.entries()) {
    if (i === statusAt) continue;
    if (f.field === 'site' && f.op === 'eq' && typeof f.value === 'string') { site = f.value; continue; }
    const c = toColumnFilter(f, o.info);
    if (c) columnFilters.push(c); else dropped += 1;
  }
  for (const f of rest) { const c = toColumnFilter(f, o.info); if (c) columnFilters.push(c); else dropped += 1; }
  const view: View = {
    filter, search: typeof query.search === 'string' ? query.search : '', site, columnFilters,
    sort: query.sort && typeof query.sort.field === 'string' && (query.sort.dir === 'asc' || query.sort.dir === 'desc') ? { field: query.sort.field, dir: query.sort.dir } : null,
    page: 1, due: query.due === true, duplicates: query.duplicates === true,
  };
  return { view, columns: columns && columns.length ? [...columns] : null, dropped };
}

// ---------- who may do what to a view (DP-1.3-64 to -66) ----------

export type SavedView = { id: string; user_id: string | null; name: string; query: Partial<SavedQuery>; columns: string[]; updated_at?: string };

/** Your views are the caller's own, Shared views the ones with no person; each by name. */
export function groupViews(views: readonly SavedView[], userId: string): { mine: SavedView[]; shared: SavedView[] } {
  const by = (a: SavedView, b: SavedView) => a.name.localeCompare(b.name);
  return { mine: views.filter(v => v.user_id === userId).sort(by), shared: views.filter(v => v.user_id === null).sort(by) };
}

/** Save and Delete: the caller's own view, or a shared one for an owner. */
export const canChangeView = (v: Pick<SavedView, 'user_id'>, userId: string, isOwner: boolean): boolean => (v.user_id === null ? isOwner : v.user_id === userId);
/** Share: an owner, on a view that is the owner's own. */
export const canShareView = (v: Pick<SavedView, 'user_id'>, userId: string, isOwner: boolean): boolean => isOwner && v.user_id === userId;
