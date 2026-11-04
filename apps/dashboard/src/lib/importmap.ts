// The pure parts of the import screen (work order 07, DP-1.3-43 to -50): the map pairs the owner can change, the layout's name as the slug the
// function wants, the report's numbers, and the sample rows flattened for a table. No browser, no network: Vitest covers all of it.
import { t } from '../plan';
import type { Column } from './crm';

export const MAX_FILE_BYTES = 1024 * 1024;   // lead-import and crm-map-propose take at most 1 MB (work order 02 F6)

export type MapColumn = { header: string; field: string; transform?: string };
/** crm-map-propose's answer, as far as the screen reads it. */
export type Proposal = {
  template: { columns: MapColumn[]; value_maps?: Record<string, unknown> };
  scores: { header: string; field: string; score: number }[];
  unmapped?: { headers?: { header: string }[] };
  warnings: string[];
};

/** One header of the client's file and the field of ours it goes to ('' = not imported). `score` is the proposal's, null when the owner chose it. */
export type Pair = { header: string; field: string; transform?: string; score: number | null; proposed: { field: string; transform?: string; score: number | null } };

/** Every header of the file: the mapped ones as proposed (with their score), then the unmapped ones with no field. */
export function pairsFromProposal(p: Proposal): Pair[] {
  const score = new Map(p.scores.map(s => [`${s.header}\u0000${s.field}`, s.score]));
  const mapped: Pair[] = p.template.columns.map(c => ({
    header: c.header, field: c.field, ...(c.transform ? { transform: c.transform } : {}), score: score.get(`${c.header}\u0000${c.field}`) ?? null,
    proposed: { field: c.field, ...(c.transform ? { transform: c.transform } : {}), score: score.get(`${c.header}\u0000${c.field}`) ?? null },
  }));
  const seen = new Set(mapped.map(m => m.header));
  const left: Pair[] = (p.unmapped?.headers ?? []).filter(h => h.header.trim() && !seen.has(h.header)).map(h => ({ header: h.header, field: '', score: null, proposed: { field: '', score: null } }));
  return [...mapped, ...left];
}

/** The owner points a header at another field (or at nothing): a transform (a name's first, a phone's form) is kept only while the field is the proposed one. */
export function changePair(pairs: Pair[], index: number, field: string): Pair[] {
  return pairs.map((p, i) => {
    if (i !== index) return p;
    const same = field === p.proposed.field;
    const { transform: _drop, ...rest } = p;
    return { ...rest, field, ...(same && p.proposed.transform ? { transform: p.proposed.transform } : {}), score: same ? p.proposed.score : null };
  });
}

/** The columns crm-template-save takes: every header that goes somewhere. */
export function templateColumns(pairs: Pair[]): MapColumn[] {
  return pairs.filter(p => p.field).map(p => ({ header: p.header, field: p.field, ...(p.transform ? { transform: p.transform } : {}) }));
}

/** The CRM's name as the lowercase, hyphenated word the function wants ("Follow Up Boss" -> "follow-up-boss"); "crm" when nothing is left. */
export function crmSlug(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'crm';
}

/** "<n>% match" (DP-1.3-44). Nothing when the owner chose the field. */
export function matchWords(score: number | null): string {
  return score === null ? '' : `${Math.round(score * 100)}${t('DP-1.3-44', '% match')}`;
}

/** The fields of ours a header can go to: the core fields the import reads, then each industry field by its label (DP-1.3-44). */
export function fieldChoices(fields: Column[]): { value: string; label: string }[] {
  return [
    { value: 'name', label: t('DP-1.3-44', 'Name') },
    { value: 'email', label: t('DP-1.3-44', 'Email') },
    { value: 'phone', label: t('DP-1.3-44', 'Phone') },
    { value: 'status', label: t('DP-1.3-44', 'Status') },
    { value: 'owner', label: t('DP-1.3-44', 'Owner') },
    ...fields.map(f => ({ value: `answers.${f.key}`, label: f.label })),
  ];
}

/** Is the file over what the import takes (1 MB)? Checked before anything is sent. */
export const fileTooBig = (bytes: number): boolean => bytes > MAX_FILE_BYTES;

export type Report = {
  dry_run?: boolean; rows: number; valid: number; new: number; refused_count: number; duplicates_count: number;
  refused: { line: number | null; field: string | null; reason: string }[];
  duplicates: { line: number; by: 'email' | 'phone'; with: string }[];
  warnings: { line: number | null; field: string | null; reason: string }[];
  sample: Record<string, unknown>[];
  created?: number; skipped?: number;
};

/** A sample row as a flat list of cells: `line`, the core values, then each answer by its key (a nested value as text). */
export function flattenSample(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const text = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  for (const [k, v] of Object.entries(row)) {
    if (k === 'answers' && v && typeof v === 'object' && !Array.isArray(v)) for (const [ak, av] of Object.entries(v as Record<string, unknown>)) out[ak] = text(av);
    else out[k] = text(v);
  }
  return out;
}

/** The column heads of the sample table: every key seen in the rows, in the order first seen. */
export function sampleHeads(rows: Record<string, string>[]): string[] {
  const heads: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!heads.includes(k)) heads.push(k);
  return heads;
}
