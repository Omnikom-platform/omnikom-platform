// DSN-011 (P1, WARN): no negative letter spacing on small text. An element with text whose declared tracking is negative (tracking-tight,
// tracking-tighter, tracking-[-...], or a negative letter-spacing) and whose declared font size is under 14 px (text-xs, text-[<n>px],
// or font-size in px or rem). A WARN: the engine sees declared styles, not computed ones.
import { mk } from "../lib/check.mjs";
import { scanPage, dsnSource } from "../lib/design.mjs";
import { declaredSize, declaredTracking, shortText } from "../lib/typography.mjs";

export const id = "DSN-011";
export const severity = "P1";
export const source = dsnSource("skills/unslop/references/signs.md:22 and skills/unslop/SKILL.md:121");
export const notCovered = ["computed styles: inheritance, media queries, specificity", "calc(), var() and em-only sizes", "classes with a variant prefix (md:, hover:)", "a snapshot's stylesheets (not in the snapshot)"];
const f = mk(id);

export function run(site) {
  const out = [];
  for (const p of site.pageList) {
    const sc = scanPage(site, p);
    for (const el of sc.elements) {
      const t = declaredTracking(sc, el);
      if (!t || t.sign >= 0) continue;
      const s = declaredSize(sc, el);
      if (!s || !(s.px < 14)) continue;
      const text = sc.textOf(el);
      if (!text) continue;
      out.push(f.warn(p.path, el.line, `forbidden-value: negative letter spacing at ${s.px} px on <${el.tag}> "${shortText(text)}": ${t.desc} with ${s.desc} (declared styles, not computed)`));
    }
  }
  return out;
}
