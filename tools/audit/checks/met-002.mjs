// MET-002 (P1): a non-empty <meta name="description"> in <head> (the first is judged), no longer than descriptionLength.hardMax,
// unique across indexable pages.
import { mk, headLine, codePoints } from "../lib/check.mjs";

export const id = "MET-002";
export const severity = "P1";
export const source = "checklist/web-delivery.md MET-002";
const f = mk(id);
const fold = (s) => String(s).normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

export function run(site) {
  const out = [];
  const seen = new Map();
  const cfg = site.config.descriptionLength;
  for (const p of site.pageList) {
    const heads = p.descriptions.filter((d) => d.inHead);
    if (heads.length === 0) { out.push(f.fail(p.path, headLine(p), 'missing-element: the page has no <meta name="description"> in <head>')); continue; }
    const d = heads[0];
    if (!d.text) { out.push(f.fail(p.path, d.line, "value-mismatch: the meta description is empty")); continue; }
    const len = codePoints(d.text);
    if (len > cfg.hardMax) out.push(f.fail(p.path, d.line, `value-mismatch: the meta description is ${len} characters, the hard maximum is ${cfg.hardMax}`));
    if (site.indexable(p)) {
      const key = fold(p.lang) + "|" + fold(d.text);
      if (seen.has(key)) out.push(f.fail(p.path, d.line, `value-mismatch: the meta description is also the description of ${seen.get(key)} (descriptions must be unique per locale)`));
      else seen.set(key, p.path);
    }
  }
  return out;
}
