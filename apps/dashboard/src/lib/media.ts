// The media library's pure part (book row B14): where each file is used, read from the newest version of every item against the contract, and
// what is wrong with it there: the publish checks of contracts/validate.mjs checkImage the screen can know (I-ALT, I-MEDIA-SIZE, I-RIGHTS).
import type { ContentRow } from '../data';
import { fieldLabel, pathKey, rowTitle, type Contract, type FieldDef, type Path } from './site';

export type Use = { row: string; collection: string; title: string; label: string; path: string; photo: boolean; alt: string; minWidth?: number; rights: boolean };
export type Problem = { code: 'no-alt' | 'too-small' | 'no-rights'; use: Use };

/** Every file in use: media id -> each item and field that holds it (`path` is what the editor's ?field= takes). */
export function usesOf(contract: Contract, rows: Pick<ContentRow, 'id' | 'collection' | 'newest'>[]): Map<string, Use[]> {
  const out = new Map<string, Use[]>();
  for (const r of rows) {
    const data = r.newest?.data;
    if (!data) continue;
    const title = rowTitle(contract, r.collection, data) || (contract.collections[r.collection]?.label ?? r.collection);
    const add = (v: unknown, name: string, def: FieldDef, path: Path): void => {
      if (!v || typeof v !== 'object') return;
      if (def.type === 'image' || def.type === 'file') {
        const x = v as { asset?: unknown; alt?: unknown };
        if (typeof x.asset !== 'string') return;
        out.set(x.asset, [...(out.get(x.asset) ?? []), { row: r.id, collection: r.collection, title, label: fieldLabel(name, def), path: pathKey(path),
          photo: def.type === 'image', alt: typeof x.alt === 'string' ? x.alt.trim() : '', minWidth: def.media?.minWidth, rights: def.media?.rightsConfirm === true }]);
      } else if (def.type === 'gallery' && Array.isArray(v)) v.forEach((x, i) => add(x, name, { ...def, type: 'image' }, [...path, i]));
      else if (def.type === 'group' && def.of) for (const [n, d] of Object.entries(def.of)) add((v as Record<string, unknown>)[n], n, d, [...path, n]);
      else if (def.type === 'list' && def.of && Array.isArray(v)) v.forEach((x, i) => { for (const [n, d] of Object.entries(def.of ?? {})) add((x as Record<string, unknown> | null)?.[n], n, d, [...path, i, n]); });
    };
    for (const [n, d] of Object.entries(contract.collections[r.collection]?.fields ?? {})) add(data[n], n, d, [n]);
    if (r.collection === 'pages') for (const s of contract.pageTypes[String(data.type)]?.sections ?? []) {
      const sv = (data.sections as Record<string, Record<string, unknown> | undefined> | undefined)?.[s.id];
      for (const [n, d] of Object.entries(s.fields ?? {})) add(sv?.[n], n, d, ['sections', s.id, n]);
    }
  }
  return out;
}

/** What is wrong with one file where it is used; a width not known yet is no problem here (the screen says "Preparing sizes"). */
export function problemsOf(file: { width: number | null; rights_confirmed: boolean }, uses: Use[]): Problem[] {
  const out: Problem[] = [];
  for (const use of uses) {
    if (use.photo && !use.alt) out.push({ code: 'no-alt', use });
    if (use.minWidth && file.width !== null && file.width < use.minWidth) out.push({ code: 'too-small', use });
    if (use.rights && !file.rights_confirmed) out.push({ code: 'no-rights', use });
  }
  return out;
}
