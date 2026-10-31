// DSN-010 (P1, WARN): no heavy weight on small text. An element with text whose declared font weight is 700 or more and whose declared
// font size is under 14 px: Tailwind font-bold, font-extrabold, font-black (or font-[700+]) with text-xs (or text-[<n>px] / text-[<n>rem]
// under 14 px), or font-weight and font-size in a style attribute, a <style> block or a linked stylesheet. text-sm is 14 px and does not trip.
// A WARN: the engine sees declared styles, not computed ones (no inheritance, no media queries).
import { mk } from "../lib/check.mjs";
import { scanPage, dsnSource } from "../lib/design.mjs";
import { declaredSize, declaredWeight, shortText } from "../lib/typography.mjs";

export const id = "DSN-010";
export const severity = "P1";
export const source = dsnSource("skills/unslop/SKILL.md:118");
export const notCovered = ["computed styles: inheritance (a bold parent and a small child are two elements), media queries, specificity", "the font shorthand, em and % sizes, named sizes (small, x-small)", "classes with a variant prefix (md:, hover:)", "a snapshot's stylesheets (not in the snapshot)"];
const f = mk(id);

export function run(site) {
  const out = [];
  for (const p of site.pageList) {
    const sc = scanPage(site, p);
    for (const el of sc.elements) {
      const w = declaredWeight(sc, el);
      if (!w || w.weight < 700) continue;
      const s = declaredSize(sc, el);
      if (!s || !(s.px < 14)) continue;
      const text = sc.textOf(el);
      if (!text) continue;
      out.push(f.warn(p.path, el.line, `forbidden-value: weight ${w.weight} at ${s.px} px on <${el.tag}> "${shortText(text)}": ${w.desc} with ${s.desc} (declared styles, not computed)`));
    }
  }
  return out;
}
