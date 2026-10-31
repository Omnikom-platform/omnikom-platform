// DSN-007 (P1): no greeting headline. The text of an h1, h2 or h3 starts with Hello, Hi, Hey, Welcome, Greetings or Howdy as a whole word
// (so "Hi-fi speakers" and "Highlights" do not trip it), any case.
import { mk } from "../lib/check.mjs";
import { scanPage, dsnSource } from "../lib/design.mjs";
import { shortText } from "../lib/typography.mjs";

export const id = "DSN-007";
export const severity = "P1";
export const source = dsnSource("skills/unslop/references/signs.md:43 and skills/unslop/SKILL.md:106");
export const notCovered = ["greetings in h4-h6 or in other elements", "greetings in other languages", "a greeting that is not the first word"];
const f = mk(id);
const HEADINGS = new Set(["h1", "h2", "h3"]);
const GREETING = /^(?:hello|hi|hey|welcome|greetings|howdy)(?![\p{L}\p{N}_'’-])/iu;

export function run(site) {
  const out = [];
  for (const p of site.pageList) {
    const sc = scanPage(site, p);
    for (const el of sc.elements) {
      if (!HEADINGS.has(el.tag)) continue;
      const text = sc.textOf(el);
      const m = GREETING.exec(text);
      if (m) out.push(f.fail(p.path, el.line, `forbidden-value: greeting "${m[0]}" starts <${el.tag}> "${shortText(text, 60)}"`));
    }
  }
  return out;
}
