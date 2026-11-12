// The pure parts of the Site screen: what the editor shows for a contract's collection or page, reading and writing a value by its path,
// the counters, the compare list, the state line and the publish progress. No browser, no network: Vitest covers it. Words that are copy
// come from the plan (t(), DECISIONS 44); everything else is the data itself (the contract's labels, the person's own text).
import { t } from '../plan';
import { receivedWords } from './leads';

export type FieldDef = {
  type: string;
  required?: boolean;
  max?: number;
  min?: number;
  integer?: boolean;
  options?: string[];
  of?: Record<string, FieldDef>;
  open?: boolean;
  locked?: { reason?: string };
  internal?: boolean;
  label?: string;
  to?: string;
  multiple?: boolean;
  media?: { minWidth?: number; rightsConfirm?: boolean };
  sourced?: boolean;
};
export type SectionDef = { id: string; kind: 'fields' | 'feed' | 'form' | 'notice'; fields?: Record<string, FieldDef>; accepts?: string; form?: string; notice?: string };
export type CollectionDef = {
  label: string;
  kind: 'collection' | 'singleton' | 'inbox';
  titleField?: string;
  slugFrom?: string;
  access: { member: 'none' | 'own' | 'all' };
  ownerField?: string;
  fields: Record<string, FieldDef>;
};
export type Placement = { collection: string; to?: { page?: string; pageType?: string; section?: string }; sort?: string };
export type Contract = {
  collections: Record<string, CollectionDef>;
  pageTypes: Record<string, { label?: string; sections: SectionDef[] }>;
  pages: { path: string; type: string; bind?: string }[];
  placements?: Placement[];
};

// ---------- names ----------
const ACRONYMS = new Set(['seo', 'url', 'mls', 'id', 'crm', 'faq']);

/** A field or section name opened up for a person ("livingSqft" -> "Living sqft", "seo" -> "SEO"). A label the contract gives wins. */
export function humanize(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_.]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return name;
  return words.map((w, i) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(' ');
}
export const fieldLabel = (name: string, def?: Pick<FieldDef, 'label'>) => def?.label || humanize(name);

export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---------- values by path ----------
export type Path = (string | number)[];

/** The path as the server writes it in a problem: "sections.contact.heading", "features[0].name". */
export const pathKey = (p: Path) => p.reduce<string>((a, k) => (typeof k === 'number' ? `${a}[${k}]` : a ? `${a}.${k}` : k), '');

export function getAt(data: unknown, p: Path): unknown {
  let v: unknown = data;
  for (const k of p) {
    if (v === null || typeof v !== 'object') return undefined;
    v = (v as Record<string | number, unknown>)[k];
  }
  return v;
}

/** A copy of `data` with the value at `p` set; undefined (or an empty array) removes it, and an object left empty goes with it. A row of a list stays a row, even empty. */
export function setAt<T>(data: T, p: Path, value: unknown): T {
  if (!p.length) return value as T;
  const go = (node: unknown, i: number): unknown => {
    const k = p[i] as string | number;
    const last = i === p.length - 1;
    const isArray = Array.isArray(node) || ((node === undefined || node === null) && typeof k === 'number');
    const base = (isArray ? [...((node as unknown[] | undefined) ?? [])] : { ...((node as object | undefined) ?? {}) }) as Record<string | number, unknown>;
    const child = last ? value : go(base[k], i + 1);
    if (isArray) base[k] = child;
    else if (child === undefined || (Array.isArray(child) && child.length === 0) || (!last && child !== null && typeof child === 'object' && !Array.isArray(child) && Object.keys(child).length === 0)) delete base[k];
    else base[k] = child;
    return base;
  };
  return go(data, 0) as T;
}

export const sameData = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canon((v as Record<string, unknown>)[k])]));
  return v;
}

// ---------- what the editor shows ----------
export type FieldRef = { name: string; path: Path; def: FieldDef };
export type Card =
  | { id: string; kind: 'fields'; title: string; fields: FieldRef[] }
  | { id: string; kind: 'feed'; title: string; line: string }
  | { id: string; kind: 'locked'; title: string; reason: string };

const COMPLEX = new Set(['list', 'group', 'gallery', 'seo', 'image']);
const shown = (def: FieldDef) => !def.internal && def.type !== 'sections';

/** The line of a section that fills itself (DP-1.4-14): what fills it and in which order, from the contract's own placement; no words of ours. */
export function feedLine(contract: Contract, pageType: string, section: SectionDef): string {
  const label = section.accepts ? contract.collections[section.accepts]?.label ?? humanize(section.accepts) : '';
  const place = (contract.placements ?? []).find(p => p.collection === section.accepts && p.to?.section === section.id && (!p.to.pageType || p.to.pageType === pageType));
  const sort = place?.sort ? `${fieldLabel(place.sort.replace(/^-/, ''), contract.collections[section.accepts ?? '']?.fields[place.sort.replace(/^-/, '')])} ${place.sort.startsWith('-') ? '↓' : '↑'}` : '';
  return [label, sort].filter(Boolean).join(', ');
}

/** The section cards of one item: a page by its page type's sections, anything else by its fields (single fields together, a list, a group, photos and the search card each in their own). */
export function editorCards(contract: Contract, collection: string, data: Record<string, unknown>): Card[] {
  const col = contract.collections[collection];
  if (!col) return [];
  const ref = (name: string, def: FieldDef, base: Path = []): FieldRef => ({ name, path: [...base, name], def });
  if (collection === 'pages') {
    const type = typeof data.type === 'string' ? data.type : '';
    const cards: Card[] = [];
    for (const s of contract.pageTypes[type]?.sections ?? []) {
      if (s.kind === 'fields') cards.push({ id: s.id, kind: 'fields', title: humanize(s.id), fields: Object.entries(s.fields ?? {}).filter(([, d]) => shown(d)).map(([n, d]) => ref(n, d, ['sections', s.id])) });
      else if (s.kind === 'feed') cards.push({ id: s.id, kind: 'feed', title: humanize(s.id), line: feedLine(contract, type, s) });
      else if (s.kind === 'notice') cards.push({ id: s.id, kind: 'locked', title: humanize(s.id), reason: s.notice ?? '' });
    }
    if (col.fields.title) cards.push({ id: 'title', kind: 'fields', title: fieldLabel('title', col.fields.title), fields: [ref('title', col.fields.title)] });
    if (col.fields.seo) cards.push({ id: 'seo', kind: 'fields', title: fieldLabel('seo', col.fields.seo), fields: [ref('seo', col.fields.seo)] });
    return cards;
  }
  const entries = Object.entries(col.fields).filter(([, d]) => shown(d));
  const cards: Card[] = [{ id: 'main', kind: 'fields', title: col.label, fields: entries.filter(([, d]) => !COMPLEX.has(d.type)).map(([n, d]) => ref(n, d)) }];
  for (const [n, d] of entries) if (COMPLEX.has(d.type)) cards.push({ id: n, kind: 'fields', title: fieldLabel(n, d), fields: [ref(n, d)] });
  return cards.filter(c => c.kind !== 'fields' || c.fields.length > 0);
}

/** A row's title: the collection's title field, or the page's title; a singleton is its own label. */
export function rowTitle(contract: Contract, collection: string, data: Record<string, unknown> | null | undefined): string {
  const col = contract.collections[collection];
  const v = data && col?.titleField ? data[col.titleField] : undefined;
  if (typeof v === 'string' && v) return v;
  return col?.kind === 'singleton' ? col.label : '';
}

/** Collections the person can open from the list: not the pages, the business details, the inbox, uploads or redirects. */
export function listCollections(contract: Contract): [string, CollectionDef][] {
  return Object.entries(contract.collections).filter(([id, c]) => c.kind === 'collection' && !['pages', 'media', 'redirects'].includes(id));
}

/** Add is for owners and Omnikom staff, and for an agent only on a collection marked own (DP-1.4-06). */
export const canAdd = (role: 'owner' | 'member' | 'staff', col: Pick<CollectionDef, 'access'>) => role !== 'member' || col.access.member === 'own';

/** Delete (DP-1.4-21) is for owners and Omnikom staff, on the client's own items: not pages, the business details, the inbox, uploads, redirects or the team (a team row is a person's profile; leads and members point at it). */
export const canDelete = (role: 'owner' | 'member' | 'staff', id: string, col: Pick<CollectionDef, 'kind'>) => role !== 'member' && col.kind === 'collection' && !['pages', 'media', 'redirects', 'team'].includes(id);

/** An agent sees a collection only when it is not owner-only, and only the rows that are theirs when it is marked own. */
export function visibleTo(role: 'owner' | 'member' | 'staff', teamRow: string | null, col: CollectionDef, row: { owner_team_row: string | null; id: string }): boolean {
  if (role !== 'member') return true;
  if (col.access.member === 'none') return false;
  if (col.access.member === 'own') return row.owner_team_row === teamRow || (col.ownerField === 'self' && row.id === teamRow);
  return true;
}

// ---------- limits and counters ----------
// The search card's limits are the validator's (contracts/validate.mjs: seo title 60, description 160); a text field's own max comes from the contract.
export const SEO_TITLE_MAX = 60;
export const SEO_DESCRIPTION_MAX = 160;

export type Over = { path: string; label: string };

/** Every text that is longer than its limit, so Save can stay off and the field can say so (DP-1.4-09). */
export function overLimits(fields: FieldRef[], data: unknown): Over[] {
  const out: Over[] = [];
  const walk = (name: string, def: FieldDef, path: Path) => {
    const v = getAt(data, path);
    if ((def.type === 'text' || def.type === 'richtext') && typeof def.max === 'number' && typeof v === 'string' && v.length > def.max) out.push({ path: pathKey(path), label: fieldLabel(name, def) });
    if (def.type === 'seo' && v && typeof v === 'object') {
      const s = v as { title?: unknown; description?: unknown };
      if (typeof s.title === 'string' && s.title.length > SEO_TITLE_MAX) out.push({ path: pathKey([...path, 'title']), label: fieldLabel('title') });
      if (typeof s.description === 'string' && s.description.length > SEO_DESCRIPTION_MAX) out.push({ path: pathKey([...path, 'description']), label: fieldLabel('description') });
    }
    if (def.type === 'group' && def.of) for (const [n, d] of Object.entries(def.of)) walk(n, d, [...path, n]);
    if (def.type === 'list' && def.of && Array.isArray(v)) v.forEach((_, i) => { for (const [n, d] of Object.entries(def.of ?? {})) walk(n, d, [...path, i, n]); });
  };
  for (const f of fields) walk(f.name, f.def, f.path);
  return out;
}

// ---------- compare ----------
export type Change = { path: string; label: string; before: string; after: string };

function flatten(v: unknown, prefix: string, out: Record<string, string>) {
  if (Array.isArray(v)) v.forEach((x, i) => flatten(x, `${prefix}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  else if (v !== undefined && v !== null) out[prefix] = String(v);
}

/** The fields whose value differs between two versions, as label, before and after (History > Compare, DP-1.4-19). */
export function changesBetween(before: unknown, after: unknown): Change[] {
  const a: Record<string, string> = {}, b: Record<string, string> = {};
  flatten(before, '', a);
  flatten(after, '', b);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
    .filter(k => (a[k] ?? '') !== (b[k] ?? ''))
    .map(k => ({ path: k, label: k.replace(/\[(\d+)\]/g, ' $1').split('.').map(humanize).join(' / '), before: a[k] ?? '', after: b[k] ?? '' }));
}

// ---------- the state line, the sentences with a time in them ----------
export type SiteState = 'preview' | 'live' | 'paused';

/** DP-1.4-02: "Preview, not live yet", or "Live, last published <when> by <who>". A paused site has no sentence in the plan: an empty line. */
export function stateLine(state: SiteState, last: { at: string; by: string } | null, now: Date = new Date()): string {
  if (state === 'preview') return t('DP-1.4-02', 'Preview, not live yet');
  if (state === 'paused') return '';
  if (!last) return t('DP-1.4-02', 'Live');
  return `${t('DP-1.4-02', 'Live, last published')} ${receivedWords(last.at, now)}${last.by ? ` ${t('DP-1.4-02', 'by')} ${last.by}` : ''}`;
}

/** DP-1.4-17, the stale save: "<who> saved a newer version at <time>." (the rest of the sentence is the button and its tail in the screen). */
export function staleLine(who: string, at: string): string {
  return `${who ? `${who} ` : ''}${t('DP-1.4-17', 'saved a newer version at')} ${clock(at)}.`.trim();
}

/** HH:MM in the browser's own time zone (or the given one). */
export function clock(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

/** The address "Open" goes to: the live domain once there is one and the site is live, else the preview address. */
export function siteUrl(site: { domain: string | null; preview_host: string; state: string }): string {
  return `https://${site.state === 'live' && site.domain ? site.domain : site.preview_host}`;
}
/** The preview site's signed link (book row B15): the draft branch with the preview job's token (B15-b3); none without a project, a good token, or after its end. */
export function draftLink(site: { deploy_target?: string }, job: Pick<Job, 'gate_report'> | null | undefined, now: Date = new Date()): string {
  const l = (job?.gate_report?.link ?? null) as { k?: unknown; until?: unknown } | null;
  if (!site.deploy_target || !l || typeof l.k !== 'string' || !/^[0-9a-f]{64}$/.test(l.k) || typeof l.until !== 'string' || !(Date.parse(l.until) > now.getTime())) return '';
  return `https://draft.${site.deploy_target}.pages.dev/?k=${l.k}`;
}
/** A saved change a preview left out (publish_jobs.left_out, or the 422's problems), in plain words: its title, else its collection, and the field it still needs. */
export type LeftOut = { row: string; path: string; collection?: string };
export function leftOutLine(contract: Contract, row: { collection: string; newest: { data: Record<string, unknown> } | null } | undefined, path: string): string {
  const col = row ? contract.collections[row.collection] : undefined, name = path.replace(/\[\d+\]/g, '').split('.').pop() || path;
  const title = (row && rowTitle(contract, row.collection, row.newest?.data)) || col?.label || t('DP-1.4c-09', 'A saved change');
  return `${title}: ${col?.fields[path] ? fieldLabel(path, col.fields[path]) : humanize(name)} ${t('DP-1.4c-09', 'is not filled in yet.')}`;
}

// ---------- the publish progress ----------
export type JobState = 'queued' | 'building' | 'gating' | 'deploying' | 'done' | 'failed';
export const RUNNING: JobState[] = ['queued', 'building', 'gating', 'deploying'];
export type Job = {
  id: string;
  site_id: string;
  requested_by: string;
  rows: string[];
  requested: Record<string, number>;
  state: JobState;
  gate_report: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};
export type JobEvent = { job_id: string; state: JobState; at: string };

/** The step a running job is in, in the plan's words (DP-1.4c-03); a queued job has none yet. */
export function stepWords(state: JobState): string {
  switch (state) {
    case 'building': return t('DP-1.4c-03', 'Building the site');
    case 'gating': return t('DP-1.4c-03', 'Checking');
    case 'deploying': return t('DP-1.4c-03', 'Putting it live');
    default: return '';
  }
}

export type Line = { key: string; text: string; at: string; live: boolean };

/** One line per step reached, in order, from the job's own events (DP-1.4c-03). The line for `done` is the live line: its Open is the screen's. */
export function progressLines(events: JobEvent[]): Line[] {
  const seen = new Set<string>();
  const lines: Line[] = [];
  for (const e of [...events].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))) {
    if (seen.has(e.state) || e.state === 'queued' || e.state === 'failed') continue;
    seen.add(e.state);
    if (e.state === 'done') lines.push({ key: e.state, text: `${t('DP-1.4c-03', 'Live since')} ${clock(e.at)}.`, at: e.at, live: true });
    else lines.push({ key: e.state, text: stepWords(e.state), at: e.at, live: false });
  }
  return lines;
}

const clip = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 240);

/** What the failed check said, from the job's gate report and error, as the report's own lines (data, not our words). */
export function failureLines(job: Pick<Job, 'gate_report' | 'error'>): string[] {
  const r = job.gate_report ?? {};
  const out: string[] = [];
  const audit = r.audit as { fails?: unknown } | undefined;
  if (audit && Array.isArray(audit.fails)) out.push(...audit.fails.filter((x): x is string => typeof x === 'string'));
  if (typeof r.reason === 'string') out.push(r.reason);
  const factory = r.factory as { lines?: unknown } | undefined;
  if (factory && Array.isArray(factory.lines)) out.push(...factory.lines.filter((x): x is string => typeof x === 'string'));
  if (!out.length && job.error) out.push(job.error);
  return out.map(clip).filter(Boolean).slice(0, 8);
}

// ---------- past publishes and putting the site back (book row B11) ----------
/** DP-1.4c-07: "41 checks passed, 0 failed" from a finished job's audit summary; '' for a job from before the summary. */
export function checksLine(job: Pick<Job, 'gate_report'>): string {
  const c = (job.gate_report?.audit as { counts?: { PASS?: unknown; FAIL?: unknown } } | undefined)?.counts;
  return c && typeof c.PASS === 'number' && typeof c.FAIL === 'number' ? `${c.PASS} ${t('DP-1.4c-07', 'checks passed')}, ${c.FAIL} ${t('DP-1.4c-07', 'failed')}` : '';
}
export type RestoreStep = { row: string; collection: string; base: number; data: Record<string, unknown> | null };
/** DP-1.4c-08 item by item (`snapshot`: that publish's { row: version }; `old`: each such version's content that is not the item's newest). Newest
 *  holds it: published at it (data null); else saved as a NEW version on top. Left out: published as it was, deleted or added since. */
export function restoreSteps(snapshot: Record<string, number>, rows: { id: string; collection: string; published_version: number | null; newest: { n: number; data: Record<string, unknown> } | null }[], old: Record<string, Record<string, unknown>>): RestoreStep[] {
  const steps: RestoreStep[] = [];
  for (const [id, n] of Object.entries(snapshot)) {
    const r = rows.find(x => x.id === id); if (!r?.newest) continue;
    const was = r.newest.n === n ? r.newest.data : old[id];
    if (!was) throw new Error(`version ${n} of ${r.collection} ${id} could not be read`);
    const same = sameData(was, r.newest.data); if (same && r.published_version === r.newest.n) continue;
    steps.push({ row: id, collection: r.collection, base: r.newest.n, data: same ? null : was });
  }
  return steps;
}

// ---------- a draft kept in this browser when the network drops (16-DESIGN-PARTS 3.2) ----------
const draftKey = (ws: string, row: string) => `omnikom-draft:${ws}:${row}`;

export function keepDraft(ws: string, row: string, base: number, data: unknown) {
  try { localStorage.setItem(draftKey(ws, row), JSON.stringify({ base, data })); } catch { /* kept only when the browser allows */ }
}
export function loadDraft(ws: string, row: string): { base: number; data: Record<string, unknown> } | null {
  try {
    const v = JSON.parse(localStorage.getItem(draftKey(ws, row)) ?? 'null') as { base?: unknown; data?: unknown } | null;
    return v && typeof v.base === 'number' && v.data && typeof v.data === 'object' ? { base: v.base, data: v.data as Record<string, unknown> } : null;
  } catch { return null; }
}
export function dropDraft(ws: string, row: string) {
  try { localStorage.removeItem(draftKey(ws, row)); } catch { /* nothing to drop */ }
}
