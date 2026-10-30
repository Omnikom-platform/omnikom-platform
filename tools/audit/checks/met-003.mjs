// MET-003 (P0): exactly one <main> with exactly one <h1> on every public page; and no heading level skipped going down.
import { mk, bodyLine } from "../lib/check.mjs";

export const id = "MET-003";
export const severity = "P0";
export const source = "checklist/web-delivery.md MET-003";
const f = mk(id);

export function run(site) {
  const out = [];
  for (const p of site.pageList) {
    // part main: one <main>, one <h1>
    if (p.mains.length === 0) out.push(f.fail(p.path, bodyLine(p), "missing-element: the page has no <main>"));
    if (p.mains.length > 1) out.push(f.fail(p.path, p.mains[1].line, `duplicate-element: ${p.mains.length} <main> elements, exactly one is allowed`));
    const h1s = p.headings.filter((h) => h.level === 1);
    if (h1s.length === 0) out.push(f.fail(p.path, bodyLine(p), "missing-element: the page has no <h1>"));
    if (h1s.length > 1) out.push(f.fail(p.path, h1s[1].line, `duplicate-element: ${h1s.length} <h1> elements, exactly one is allowed (the first is "${h1s[0].text}" on line ${h1s[0].line})`));
    // part skip: in document order each heading after the first is at most one level deeper than the one before it
    let prev = null;
    for (const h of p.headings) {
      if (prev && h.level > prev.level + 1) out.push(f.fail(p.path, h.line, `value-mismatch: <h${h.level}> "${h.text}" follows <h${prev.level}> "${prev.text}" (line ${prev.line}) and skips a level`));
      prev = h;
    }
  }
  return out;
}
