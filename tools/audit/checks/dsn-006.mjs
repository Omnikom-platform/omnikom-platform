// DSN-006 (P1): no exclamation mark in a headline. A "!" in the text of h1-h6 (one finding per heading).
import { mk } from "../lib/check.mjs";
import { scanPage, dsnSource } from "../lib/design.mjs";
import { shortText } from "../lib/typography.mjs";

export const id = "DSN-006";
export const severity = "P1";
export const source = dsnSource("skills/unslop/references/signs.md:44 and skills/unslop/SKILL.md:105");
export const notCovered = ["exclamation marks outside h1-h6 (buttons, paragraphs)", "text added by JavaScript"];
const f = mk(id);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export function run(site) {
  const out = [];
  for (const p of site.pageList) {
    const sc = scanPage(site, p);
    for (const el of sc.elements) {
      if (!HEADINGS.has(el.tag)) continue;
      const hit = sc.textMatches(el, /!/)[0];
      if (hit) out.push(f.fail(p.path, hit.line, `forbidden-value: exclamation mark in <${el.tag}> "${shortText(sc.textOf(el), 60)}"`));
    }
  }
  return out;
}
