// The pure parts of the CRM list and record (work order 07): the query the list sends to lead-list, the column filters, the sort,
// the selection, the paging line, the cells, the record's fields and what a typed edit becomes. No browser, no network: Vitest covers
// all of it. Words that are copy come from the plan (t(), DECISIONS 44); everything else is the data itself.
import { t } from '../plan';
import { plainValue, receivedWords, STATUSES, formLabel, type ContractForms, type Filter, type Lead } from './leads';

export const PAGE_SIZE = 50;

export type Op = 'eq' | 'in' | 'range' | 'empty' | 'not_empty';
/** One entry of lead-list's `filters` (specs/openapi.json LeadListRequest). */
export type ListFilter = { field: string; op: Op; value?: unknown; values?: unknown[]; from?: unknown; to?: unknown };
export type SortSpec = { field: string; dir: 'asc' | 'desc' };

/** A column of the list or a field of the record, as `lead-list` answers it (`columns` and `fields`). */
export type Column = { key: string; label: string; type: string; options?: string[]; editable?: boolean; min?: number; max?: number };

/** The row `lead-list` answers: the core keys, then each industry key under its own name. */
export type ListRow = { id: string; created_at: string; name: string | null; email: string | null; phone: string | null; status: string; owner: string | null; form: string; page: string | null; site: string | null } & Record<string, unknown>;
export type ListAnswer = { total: number; page: number; size: number; columns: Column[]; fields: Column[]; rows: ListRow[] };

/** The core columns of the list, in order (DP-1.3-06). Their keys are lead-list's. */
export const CORE_COLUMNS: Column[] = [
  { key: 'created_at', label: t('DP-1.3-06', 'Received'), type: 'datetime' },
  { key: 'name', label: t('DP-1.3-06', 'Name'), type: 'text' },
  { key: 'email', label: t('DP-1.3-06', 'Email'), type: 'text' },
  { key: 'phone', label: t('DP-1.3-06', 'Phone'), type: 'text' },
  { key: 'form', label: t('DP-1.3-06', 'What they asked for'), type: 'text' },
  { key: 'page', label: t('DP-1.3-06', 'Page'), type: 'text' },
  { key: 'status', label: t('DP-1.3-06', 'Status'), type: 'enum', options: [...STATUSES] },
  { key: 'owner', label: t('DP-1.3-06', 'Owner'), type: 'owner' },
];

// ---------- the view, and the query it becomes ----------

/** A column filter as the person built it (DP-1.3-28): strings from the controls; `toListFilter` types them by the column. */
export type Condition = 'is' | 'between' | 'empty' | 'not_empty';
export type ColumnFilter = { key: string; label: string; type: string; cond: Condition; value?: string; from?: string; to?: string };

export type View = { filter: Filter; search: string; site: string; columnFilters: ColumnFilter[]; sort: SortSpec | null; page: number };
export const FIRST_VIEW: View = { filter: 'new', search: '', site: '', columnFilters: [], sort: null, page: 1 };

export const SEARCH_MIN = 2;   // DP-1.3-03: the server matches after 2 characters

const ALL_BUT_SPAM = STATUSES.filter(s => s !== 'spam');

/** New / All / Mine / Spam as lead-list filters (DP-1.3-02). Mine with no team row of mine matches nothing. */
export function statusFilters(filter: Filter, myTeamRow: string | null): ListFilter[] {
  switch (filter) {
    case 'new': return [{ field: 'status', op: 'eq', value: 'new' }];
    case 'spam': return [{ field: 'status', op: 'eq', value: 'spam' }];
    case 'all': return [{ field: 'status', op: 'in', values: [...ALL_BUT_SPAM] }];
    case 'mine': return [{ field: 'status', op: 'in', values: [...ALL_BUT_SPAM] }, { field: 'owner', op: myTeamRow ? 'eq' : 'in', ...(myTeamRow ? { value: myTeamRow } : { values: [] }) }];
  }
}

const numberOf = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** One column filter typed by its column: a number is a number, a tick is true or false, anything else is the text. Null when it is not complete. */
export function toListFilter(cf: ColumnFilter): ListFilter | null {
  if (cf.cond === 'empty') return { field: cf.key, op: 'empty' };
  if (cf.cond === 'not_empty') return { field: cf.key, op: 'not_empty' };
  if (cf.cond === 'between') {
    const num = cf.type === 'number';
    const from = num ? numberOf(cf.from) : (cf.from ?? '').trim() || null;
    const to = num ? numberOf(cf.to) : (cf.to ?? '').trim() || null;
    if (from === null && to === null) return null;
    return { field: cf.key, op: 'range', ...(from !== null ? { from } : {}), ...(to !== null ? { to } : {}) };
  }
  const v = (cf.value ?? '').trim();
  if (v === '') return null;
  if (cf.type === 'number') { const n = numberOf(v); return n === null ? null : { field: cf.key, op: 'eq', value: n }; }
  if (cf.type === 'boolean') return { field: cf.key, op: 'eq', value: v === 'yes' || v === 'true' };
  return { field: cf.key, op: 'eq', value: v };
}

/** Every filter of the view: the status filter, the site, then each complete column filter. */
export function viewFilters(view: Pick<View, 'filter' | 'site' | 'columnFilters'>, myTeamRow: string | null): ListFilter[] {
  const out = statusFilters(view.filter, myTeamRow);
  if (view.site) out.push({ field: 'site', op: 'eq', value: view.site });
  for (const cf of view.columnFilters) { const f = toListFilter(cf); if (f) out.push(f); }
  return out;
}

/** The body of lead-list and of the export without a workspace: search (after 2 characters), filters, sort. */
export function viewQuery(view: View, myTeamRow: string | null): { search?: string; filters: ListFilter[]; sort?: SortSpec } {
  const search = view.search.trim();
  return {
    ...(search.length >= SEARCH_MIN ? { search } : {}),
    filters: viewFilters(view, myTeamRow),
    ...(view.sort ? { sort: view.sort } : {}),
  };
}

/** The count next to a filter is that filter's total in the current site (DP-1.3-02): the view with nothing else narrowing it. */
export function countQuery(filter: Filter, site: string, myTeamRow: string | null): { filters: ListFilter[] } {
  return { filters: viewFilters({ filter, site, columnFilters: [] }, myTeamRow) };
}

// ---------- sort ----------

/** The first tap on a heading sorts it (received newest first, any other column ascending); a tap on the sorted heading reverses it (DP-1.3-27). */
export function nextSort(current: SortSpec | null, field: string): SortSpec {
  const now: SortSpec = current ?? { field: 'created_at', dir: 'desc' };
  if (now.field === field) return { field, dir: now.dir === 'asc' ? 'desc' : 'asc' };
  return { field, dir: field === 'created_at' ? 'desc' : 'asc' };
}

/** aria-sort of a heading. */
export function sortState(current: SortSpec | null, field: string): 'ascending' | 'descending' | undefined {
  const now: SortSpec = current ?? { field: 'created_at', dir: 'desc' };
  if (now.field !== field) return undefined;
  return now.dir === 'asc' ? 'ascending' : 'descending';
}

// ---------- the filters in use (DP-1.3-29) ----------

/** "<column> is <value>", "<column> is between <from> and <to>", "<column> is empty", "<column> is not empty". `valueLabel` turns a stored value into its words (an owner's name). */
export function describeFilter(cf: ColumnFilter, valueLabel: (v: string) => string = v => v): string {
  const is = t('DP-1.3-29', 'is');
  switch (cf.cond) {
    case 'empty': return `${cf.label} ${is} ${t('DP-1.3-29', 'empty')}`;
    case 'not_empty': return `${cf.label} ${is} ${t('DP-1.3-29', 'not empty')}`;
    case 'between': return `${cf.label} ${is} ${t('DP-1.3-29', 'between')} ${cf.from ?? ''} ${t('DP-1.3-29', 'and')} ${cf.to ?? ''}`;
    default: return `${cf.label} ${is} ${valueLabel(cf.value ?? '')}`;
  }
}

/** The conditions a column offers (DP-1.3-28): "between" for a number or a date, "is" for the rest, and the two empty tests for all. */
export function conditionsFor(type: string): Condition[] {
  return type === 'number' || type === 'date' || type === 'datetime' ? ['between', 'empty', 'not_empty'] : ['is', 'empty', 'not_empty'];
}

export const CONDITION_WORDS: Record<Condition, string> = {
  is: t('DP-1.3-28', 'is'),
  between: t('DP-1.3-28', 'between'),
  empty: t('DP-1.3-28', 'is empty'),
  not_empty: t('DP-1.3-28', 'is not empty'),
};

/** The values a pick-one column offers: its options (a tick: yes and no). Null when the value is typed. */
export function choicesFor(col: Pick<Column, 'type' | 'options'>): string[] | null {
  if (col.type === 'boolean') return ['yes', 'no'];
  if ((col.type === 'enum' || col.type === 'choice' || col.type === 'multi') && col.options?.length) return col.options;
  return null;
}

// ---------- the selection (DP-1.3-30) ----------

export const toggleId = (sel: ReadonlySet<string>, id: string): Set<string> => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); return n; };
export const allOnPage = (sel: ReadonlySet<string>, ids: readonly string[]): boolean => ids.length > 0 && ids.every(i => sel.has(i));
/** The heading's box: select every row of the page, or, when all are selected, none of them. */
export function togglePage(sel: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const n = new Set(sel);
  if (allOnPage(sel, ids)) for (const i of ids) n.delete(i); else for (const i of ids) n.add(i);
  return n;
}

// ---------- paging (DP-1.3-36) ----------

/** "<from> to <to> of <total>": the numbers of the page; empty when there is nothing. */
export function pageNumbers(page: number, size: number, total: number): { from: number; to: number; last: number } {
  if (total <= 0) return { from: 0, to: 0, last: 1 };
  return { from: (page - 1) * size + 1, to: Math.min(page * size, total), last: Math.ceil(total / size) };
}
export const pageLine = (page: number, size: number, total: number): string => { const p = pageNumbers(page, size, total); return `${p.from} ${t('DP-1.3-36', 'to')} ${p.to} ${t('DP-1.3-36', 'of')} ${total}`; };

// ---------- cells and fields ----------

/** A cell of the list in words. The owner is the team member's name, received is the received words, the form is its label. */
export function cellText(row: ListRow, key: string, o: { owner: (id: string) => string; forms: ContractForms | null }): string {
  switch (key) {
    case 'created_at': return receivedWords(row.created_at);
    case 'form': return formLabel(row.form, o.forms);
    case 'owner': return row.owner ? o.owner(row.owner) : '';
    case 'page': return row.form === 'manual' ? '' : row.page ?? '';
    default: return plainValue(row[key]);
  }
}

/** A field of the open record (DP-1.3-14, -37): where its value lives, how it is edited, and whether it can be. */
export type RecordField = { key: string; label: string; type: string; options?: string[]; min?: number; max?: number; editable: boolean; core: boolean; value: unknown; display: string; empty: boolean };

/**
 * The record's fields in order: Name, Email, Phone, each industry field in form order, then Form, Page, Flow, Call to action, Site (with 2+ sites)
 * and Received. Core Name, Email and Phone and every industry field the contract does not mark read only are editable; the rest are not (DP-1.3-39).
 */
export function recordFields(lead: Lead & { cta?: string | null }, fields: Column[], o: { forms: ContractForms | null; siteName: (id: string | null) => string; manySites: boolean }): RecordField[] {
  const empty = t('DP-1.3-14', 'Empty');
  const make = (f: Omit<RecordField, 'display' | 'empty'>): RecordField => {
    const display = plainValue(f.value);
    return { ...f, display: display || empty, empty: display === '' };
  };
  const out: RecordField[] = [
    make({ key: 'name', label: t('DP-1.3-14', 'Name'), type: 'text', editable: true, core: true, value: lead.name }),
    make({ key: 'email', label: t('DP-1.3-14', 'Email'), type: 'email', editable: true, core: true, value: lead.email }),
    make({ key: 'phone', label: t('DP-1.3-14', 'Phone'), type: 'phone', editable: true, core: true, value: lead.phone }),
  ];
  for (const f of fields) out.push(make({ key: f.key, label: f.label, type: f.type, options: f.options, min: f.min, max: f.max, editable: f.editable !== false, core: false, value: lead.answers?.[f.key] }));
  out.push(
    make({ key: 'form', label: t('DP-1.3-14', 'Form'), type: 'text', editable: false, core: true, value: formLabel(lead.form, o.forms) }),
    make({ key: 'page_path', label: t('DP-1.3-14', 'Page'), type: 'text', editable: false, core: true, value: lead.form === 'manual' ? '' : lead.page_path }),
    make({ key: 'flow', label: t('DP-1.3-14', 'Flow'), type: 'text', editable: false, core: true, value: lead.flow }),
    make({ key: 'cta', label: t('DP-1.3-14', 'Call to action'), type: 'text', editable: false, core: true, value: lead.cta ?? null }),
  );
  if (o.manySites) out.push(make({ key: 'site', label: t('DP-1.3-14', 'Site'), type: 'text', editable: false, core: true, value: o.siteName(lead.site_id) }));
  out.push(make({ key: 'created_at', label: t('DP-1.3-14', 'Received'), type: 'text', editable: false, core: true, value: receivedWords(lead.created_at) }));
  return out;
}

/** What the person typed in a field's box, as the value `lead-update` `fields` takes; null when it cannot be (a number that is not one, over its limits). An empty box clears the field. */
export function editValue(f: Pick<RecordField, 'type' | 'options' | 'min' | 'max'>, text: string | string[]): { ok: true; value: unknown } | { ok: false } {
  if (Array.isArray(text)) return { ok: true, value: text };
  const s = text.trim();
  if (s === '') return { ok: true, value: null };
  if (f.type === 'number') {
    const n = Number(s);
    if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) return { ok: false };
    return { ok: true, value: n };
  }
  if (f.type === 'boolean') return { ok: true, value: s === 'yes' };
  return { ok: true, value: s };
}

/** The text a field's box starts with. */
export function editText(f: Pick<RecordField, 'type' | 'value'>): string | string[] {
  const v = f.value;
  if (Array.isArray(v)) return v.map(String);
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}
