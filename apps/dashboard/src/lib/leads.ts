// The pure parts of the Leads screen: filters, search, the received time, labels, the timeline, the tab title. No browser, no network:
// Vitest covers all of it. Words that are copy come from the plan (t(), DECISIONS 44); everything else is the data itself.
import { t } from '../plan';

// Work order 20 (migration 23): a status is a key of the business's own list (its contract's crm.statuses). Until the screens read that list (work order 39) this is
// the platform floor, the list a business without one has: the four statuses of before, with "new" now called not-contacted, and spam (a system status).
export const STATUSES = ['not-contacted', 'contacted', 'qualified', 'closed', 'spam'] as const;
export type LeadStatus = (typeof STATUSES)[number];
/**
 * The words for a status key: the key spelled out (not-contacted is "Not contacted"; the business's own keys, call-back, "Call back"), "new" being what older timeline
 * events call not-contacted. The owner's exact words ("Not contacted yet") are the labels of the business's list in its contract; the screens read them in work order 39.
 */
const SPELLED: Record<string, string> = { contacted: 'Contacted', qualified: 'Qualified', closed: 'Closed', spam: 'Spam' };
export const statusLabel = (key: string): string => {
  const k = key === 'new' ? 'not-contacted' : key;
  return SPELLED[k] ?? (k ? k.charAt(0).toUpperCase() + k.slice(1).replace(/-/g, ' ') : '');
};
export type Filter = 'new' | 'all' | 'mine' | 'spam';
export const FILTERS: { id: Filter; label: string }[] = [
  { id: 'new', label: t('DP-1.3-02', 'New') },
  { id: 'all', label: t('DP-1.3-02', 'All') },
  { id: 'mine', label: t('DP-1.3-02', 'Mine') },
  { id: 'spam', label: t('DP-1.3-02', 'Spam') },
];

export type Lead = {
  id: string;
  workspace_id: string;
  site_id: string | null;
  form: string;
  flow: string | null;
  page_path: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  answers: Record<string, unknown>;
  consent_text: string;
  marketing_consent: { given?: boolean; text?: string } | null;
  status: LeadStatus;
  owner_team_row: string | null;
  created_at: string;
  cta?: string | null;
  sms_consent?: boolean;
  follow_up_at?: string | null;
  duplicate_of?: string | null;
};

export type LeadEvent = {
  id: number;
  lead_id: string;
  kind: string;
  by: string | null;
  detail: Record<string, unknown>;
  at: string;
};

/** Newest first; the id breaks a tie so the order never flickers. */
export function newestFirst<T extends { created_at: string; id: string }>(leads: T[]): T[] {
  return [...leads].sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1));
}

/**
 * New = status not-contacted. All = every lead that is not spam. Mine = the leads owned by the signed-in person's team row, spam left out.
 * Spam = status spam. (The database already hides what a person may not see; this only narrows what the database sent.)
 */
export function filterLeads<T extends { status: LeadStatus; owner_team_row: string | null }>(leads: T[], filter: Filter, myTeamRow: string | null): T[] {
  switch (filter) {
    case 'new': return leads.filter(l => l.status === 'not-contacted');
    case 'spam': return leads.filter(l => l.status === 'spam');
    case 'mine': return myTeamRow ? leads.filter(l => l.status !== 'spam' && l.owner_team_row === myTeamRow) : [];
    case 'all': return leads.filter(l => l.status !== 'spam');
  }
}

/** The number next to each filter (DP-1.3-02). */
export function filterCounts<T extends { status: LeadStatus; owner_team_row: string | null }>(leads: T[], myTeamRow: string | null): Record<Filter, number> {
  return { new: filterLeads(leads, 'new', myTeamRow).length, all: filterLeads(leads, 'all', myTeamRow).length, mine: filterLeads(leads, 'mine', myTeamRow).length, spam: filterLeads(leads, 'spam', myTeamRow).length };
}

const digits = (s: string) => s.replace(/\D/g, '');
export const SEARCH_MIN = 2;   // DP-1.3-03: matches as you type, after 2 characters

/** Name, email or phone contains the characters typed (after 2). A phone also matches on its digits, so "555 010" finds "(555) 010-0199". */
export function searchLeads<T extends { name: string | null; email: string | null; phone: string | null }>(leads: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (q.length < SEARCH_MIN) return leads;
  const qd = digits(q);
  return leads.filter(l => {
    if ((l.name ?? '').toLowerCase().includes(q) || (l.email ?? '').toLowerCase().includes(q)) return true;
    if ((l.phone ?? '').toLowerCase().includes(q)) return true;
    return qd.length >= SEARCH_MIN && digits(l.phone ?? '').includes(qd);
  });
}

export function visibleLeads<T extends Lead>(leads: T[], o: { filter: Filter; query: string; myTeamRow: string | null }): T[] {
  return searchLeads(filterLeads(newestFirst(leads), o.filter, o.myTeamRow), o.query);
}

function parts(d: Date, timeZone?: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) if (p.type !== 'literal') o[p.type] = p.value;
  return { y: Number(o.year), m: o.month ?? '', d: Number(o.day), wd: o.weekday ?? '', hh: o.hour ?? '00', mm: o.minute ?? '00' };
}

const MONTH_NUMBER = (d: Date, timeZone?: string) => Number(new Intl.DateTimeFormat('en-US', { timeZone, month: 'numeric' }).format(d));

/**
 * The received time (DP-1.3-06: today 09:12, yesterday, Mon): "today 09:12", "yesterday 09:12", then the weekday for the last six
 * days (Mon 09:12), then the date (12 Oct 09:12, with the year when it is not this year). Names come from Intl, not from this file.
 * An unreadable time is an empty string.
 */
export function receivedWords(iso: string, now: Date = new Date(), timeZone?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const a = parts(at, timeZone), b = parts(now, timeZone);
  const days = Math.round((Date.UTC(b.y, MONTH_NUMBER(now, timeZone) - 1, b.d) - Date.UTC(a.y, MONTH_NUMBER(at, timeZone) - 1, a.d)) / 86400000);
  const hm = `${a.hh}:${a.mm}`;
  if (days === 0) return `${t('DP-1.3-06', 'today')} ${hm}`;
  if (days === 1) return `${t('DP-1.3-06', 'yesterday')} ${hm}`;
  if (days > 1 && days <= 6) return `${a.wd} ${hm}`;
  return `${a.d} ${a.m}${a.y === b.y ? '' : ` ${a.y}`} ${hm}`;
}

const humanize = (s: string) => {
  const w = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().toLowerCase();
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : s;
};

/** The contract's forms by slug: { label, fields: { name: { label? } } }. Read from the workspace's contract at run time; never typed here. */
export type ContractForms = Record<string, { label?: string; fields?: Record<string, { label?: string }> }>;

/** The form in plain words: the contract's label; a hand-entered lead is "Added by hand" (the plan's word); any other slug is opened up. */
export function formLabel(form: string, forms: ContractForms | null): string {
  if (form === 'manual') return t('DP-1.3b-09', 'Added by hand');
  return forms?.[form]?.label || humanize(form);
}

/** An answer key as its label: the contract's field label when the form has one, else the key opened up ("howDidTheyReachYou" -> "How did they reach you"). */
export function labelWords(key: string, form?: string, forms?: ContractForms | null): string {
  return forms?.[form ?? '']?.fields?.[key]?.label || humanize(key);
}

export function answerRows(answers: Record<string, unknown> | null | undefined, form?: string, forms?: ContractForms | null): { label: string; value: string }[] {
  if (!answers || typeof answers !== 'object') return [];
  const rows: { label: string; value: string }[] = [];
  for (const [k, v] of Object.entries(answers)) {
    if (v === null || v === undefined || v === '') continue;
    rows.push({ label: labelWords(k, form, forms), value: typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v) });
  }
  return rows;
}

export type Names = { me: { id: string; email: string | null } | null; byUser: ReadonlyMap<string, string>; team: ReadonlyMap<string, string> };

/** A value in words for a cell, a field of the record or a line of the timeline: a tick is Yes or No, a list is its values, nothing is an empty string. */
export function plainValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? t('DP-1.3-14', 'Yes') : t('DP-1.3-14', 'No');
  if (Array.isArray(v)) return v.map(x => String(x)).join(', ');
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** "Changed <field>: <old> to <new>" (DP-1.3-22); a value with nothing in it reads "empty". */
export function editedLine(d: Record<string, unknown>, labelOf: (key: string) => string): string {
  const word = (v: unknown) => (plainValue(v) === '' ? t('DP-1.3-22', 'empty') : plainValue(v));
  return `${t('DP-1.3-22', 'Changed')} ${labelOf(String(d.field ?? ''))}: ${word(d.old)} ${t('DP-1.3-22', 'to')} ${word(d.new)}`;
}

/** "Follow-up set for <time>", "Follow-up changed from <old> to <new>" or "Follow-up cleared" (DP-1.3-72). */
export function followUpLine(d: Record<string, unknown>): string {
  const at = (v: unknown) => (typeof v === 'string' ? receivedWords(v) : '');
  if (!at(d.new)) return t('DP-1.3-72', 'Follow-up cleared');
  if (!at(d.old)) return `${t('DP-1.3-72', 'Follow-up set for')} ${at(d.new)}`;
  return `${t('DP-1.3-72', 'Follow-up changed from')} ${at(d.old)} ${t('DP-1.3-72', 'to')} ${at(d.new)}`;
}

/** "Task added: <text>", "Task done: <text>" or "Task reopened: <text>" (DP-1.3-72). */
export function taskLine(d: Record<string, unknown>): string {
  const text = String(d.text ?? '');
  switch (d.action) {
    case 'added': return `${t('DP-1.3-72', 'Task added:')} ${text}`;
    case 'done': return `${t('DP-1.3-72', 'Task done:')} ${text}`;
    case 'reopened': return `${t('DP-1.3-72', 'Task reopened:')} ${text}`;
    default: return `${t('DP-1.3-72', 'Task')}: ${text}`;
  }
}

export type TimelineLine = { at: string; who: string; what: string };

/**
 * The timeline (DP-1.3-16, wording from DP-1.3-22), newest first: time, who, what. Who is the team member's name, else the login's email
 * (only this login's own email is known to the browser; another login without a team name shows no name). The note's text and the
 * statuses are the data itself.
 */
export function timelineLines(events: Pick<LeadEvent, 'id' | 'kind' | 'by' | 'detail' | 'at'>[], lead: Pick<Lead, 'page_path'> | null, n: Names, labelOf: (key: string) => string = k => k): TimelineLine[] {
  const nameOf = (id: unknown) => (typeof id === 'string' ? n.team.get(id) ?? '' : '');
  return [...events]
    .sort((a, b) => (a.at === b.at ? b.id - a.id : a.at < b.at ? 1 : -1))
    .map(e => {
      const d = e.detail ?? {};
      const who = e.by ? n.byUser.get(e.by) ?? (n.me && n.me.id === e.by ? n.me.email ?? '' : '') : '';
      let what: string;
      switch (e.kind) {
        case 'received': what = d.manual ? `${t('DP-1.3-22', 'Added by hand by')} ${who}` : `${t('DP-1.3-22', 'Received from')} ${lead?.page_path ?? ''}`; break;
        case 'alert-sent': what = t('DP-1.3-22', 'Alert sent'); break;
        case 'alert-failed': what = t('DP-1.3-22', 'An alert could not be sent'); break;
        case 'status': what = `${t('DP-1.3-22', 'Status:')} ${statusLabel(String(d.from ?? ''))} ${t('DP-1.3-22', 'to')} ${statusLabel(String(d.to ?? ''))}`; break;
        case 'assigned': what = `${t('DP-1.3-22', 'Given to')} ${nameOf(d.to)}`; break;
        case 'note': what = `${t('DP-1.3-22', 'Note:')} ${String(d.text ?? '')}`; break;
        case 'edited': what = editedLine(d, labelOf); break;
        case 'exported': what = t('DP-1.3-22', 'Exported to a CSV file'); break;
        case 'follow-up': what = followUpLine(d); break;
        case 'task': what = taskLine(d); break;
        default: what = e.kind;
      }
      return { at: e.at, who: e.kind === 'received' && d.manual ? '' : who, what };
    });
}

/** The marketing line of the consent block (DP-1.3-23). */
export function marketingLine(m: { given?: boolean } | null): string {
  if (!m) return t('DP-1.3-23', 'Marketing: not asked on this form.');
  return m.given ? t('DP-1.3-23', 'Marketing: yes') : t('DP-1.3-23', 'Marketing: no');
}

/** The text-message line of the consent block (DP-1.3-40). */
export function smsLine(given: boolean | undefined): string {
  return given ? t('DP-1.3-40', 'Text messages: yes') : t('DP-1.3-40', 'Text messages: no');
}

/** tel: link target: digits and a leading plus only. */
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** The tab title (DP-1.3-09): "(1) Leads" when something is new, "Leads" when not. */
export function leadsTitle(newCount: number): string {
  return newCount > 0 ? `(${newCount > 99 ? '99+' : newCount}) ${t('DP-1.3-09', 'Leads')}` : t('DP-1.3-09', 'Leads');
}
