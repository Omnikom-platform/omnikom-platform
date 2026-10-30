// MET-001 (P0): exactly one non-empty <title> in <head>, no longer than titleLength.hardMax, unique within its locale across indexable pages.
import { mk, headLine, codePoints } from "../lib/check.mjs";

export const id = "MET-001";
export const severity = "P0";
export const source = "checklist/web-delivery.md MET-001";
const f = mk(id);
const fold = (s) => String(s).normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

export function run(site) {
  const out = [];
  const seen = new Map(); // locale + folded title -> first page
  const cfg = site.config.titleLength;
  for (const p of site.pageList) {
    const heads = p.titles.filter((t) => t.inHead);
    if (heads.length === 0) { out.push(f.fail(p.path, headLine(p), "missing-element: the page has no <title> in <head>")); continue; }
    if (heads.length > 1) out.push(f.fail(p.path, heads[1].line, `duplicate-element: ${heads.length} <title> elements in <head>, exactly one is allowed`));
    const t = heads[0];
    if (!t.text) { out.push(f.fail(p.path, t.line, "value-mismatch: the <title> is empty")); continue; }
    const len = codePoints(t.text);
    if (len > cfg.hardMax) out.push(f.fail(p.path, t.line, `value-mismatch: the title is ${len} characters, the hard maximum is ${cfg.hardMax}`));
    if (site.indexable(p)) {
      const key = fold(p.lang) + "|" + fold(t.text);
      if (seen.has(key)) out.push(f.fail(p.path, t.line, `value-mismatch: the title "${t.text}" is also the title of ${seen.get(key)} (titles must be unique per locale)`));
      else seen.set(key, p.path);
    }
  }
  return out;
}
