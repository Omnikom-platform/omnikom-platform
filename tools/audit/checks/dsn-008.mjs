// DSN-008 (P1): no PRO or Beta badge. A span, small, sup, div, strong, em, mark or b whose whole trimmed text is PRO or Beta, any case.
// When a badge sits in nested elements only the innermost one is reported.
import { mk } from "../lib/check.mjs";
import { scanPage, dsnSource } from "../lib/design.mjs";

export const id = "DSN-008";
export const severity = "P1";
export const source = dsnSource("skills/unslop/references/signs.md:54 and skills/unslop/SKILL.md:113");
export const notCovered = ["a badge in any other element (a button, a link, an li)", "a badge whose text has more words (Beta feature)", "a badge drawn by an image or CSS content"];
const f = mk(id);
const TAGS = new Set(["span", "small", "sup", "div", "strong", "em", "mark", "b"]);
const WORD = /^(?:pro|beta)$/i;

export function run(site) {
  const out = [];
  for (const p of site.pageList) {
    const sc = scanPage(site, p);
    const hits = sc.elements.filter((el) => TAGS.has(el.tag) && WORD.test(sc.textOf(el)));
    for (const el of hits) {
      if (hits.some((o) => o !== el && o.parent === el.i)) continue; // a child element carries the same text: report that one
      out.push(f.fail(p.path, el.line, `forbidden-value: badge <${el.tag}> "${sc.textOf(el)}"`));
    }
  }
  return out;
}
