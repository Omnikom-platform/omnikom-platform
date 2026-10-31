// DSN-004 (P1): no uppercase tracked labels. An element with text that is uppercase (class "uppercase" or text-transform: uppercase)
// and has a positive tracking (tracking-wide, tracking-wider, tracking-widest, tracking-[<positive>] or a positive letter-spacing).
import { mk } from "../lib/check.mjs";
import { scanPage, dsnSource } from "../lib/design.mjs";
import { declaredUppercase, declaredTracking, shortText } from "../lib/typography.mjs";

export const id = "DSN-004";
export const severity = "P1";
export const source = dsnSource("skills/unslop/references/signs.md:19");
export const notCovered = ["inheritance (an uppercase parent with a tracked child is two elements)", "classes with a variant prefix (md:, hover:, dark:)", "calc(), var() and other lengths that are not plain numbers", "a snapshot's stylesheets (not in the snapshot)"];
const f = mk(id);

export function run(site) {
  const out = [];
  for (const p of site.pageList) {
    const sc = scanPage(site, p);
    for (const el of sc.elements) {
      const up = declaredUppercase(sc, el);
      if (!up || !up.upper) continue;
      const tr = declaredTracking(sc, el);
      if (!tr || tr.sign <= 0) continue;
      const text = sc.textOf(el);
      if (!text) continue;
      out.push(f.fail(p.path, el.line, `forbidden-value: uppercase tracked label on <${el.tag}> "${shortText(text)}": ${up.desc} with ${tr.desc}`));
    }
  }
  return out;
}
