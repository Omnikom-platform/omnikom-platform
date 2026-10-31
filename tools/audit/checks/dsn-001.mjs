// DSN-001 (P1): no looping or bouncy motion. A class token animate-pulse, animate-ping, animate-bounce, transition-all, hover:scale-*
// (any value, also group-hover and peer-hover), or a class or @keyframes name that contains "shimmer". Variant prefixes do not hide a token.
import { mk } from "../lib/check.mjs";
import { scanPage, splitToken, dsnSource } from "../lib/design.mjs";

export const id = "DSN-001";
export const severity = "P1";
export const source = dsnSource("skills/unslop/references/signs.md:85-86 and skills/unslop/SKILL.md:170-171");
export const notCovered = ["computed styles and media queries", "animation or transition declared in CSS (only the class tokens and @keyframes names above)", "a snapshot's stylesheets (not in the snapshot)"];
const f = mk(id);
const MOTION = new Set(["animate-pulse", "animate-ping", "animate-bounce", "transition-all"]);
const HOVER = /^(?:(?:group|peer)-)?hover(?:\/.+)?$/;

export function run(site) {
  const out = [];
  const seen = new Set();
  for (const p of site.pageList) {
    const sc = scanPage(site, p);
    for (const el of sc.elements) {
      for (const tok of sc.classes(el)) {
        const { variants, utility } = splitToken(tok);
        let why = null;
        if (MOTION.has(utility)) why = utility === "transition-all" ? "transitions every property" : "loops or bounces";
        else if (variants.some((v) => HOVER.test(v)) && /^-?scale(-|$)/.test(utility)) why = "scales on hover";
        else if (tok.toLowerCase().includes("shimmer")) why = "shimmer";
        if (why) out.push(f.fail(p.path, el.line, `forbidden-value: class "${tok}" on <${el.tag}> (${why})`));
      }
    }
    for (const k of sc.keyframes) {
      if (!/shimmer/i.test(k.name)) continue;
      const key = (k.file || p.path) + ":" + k.line;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f.fail(k.file || p.path, k.line, `forbidden-value: @keyframes "${k.name}" (shimmer)`));
    }
  }
  return out;
}
