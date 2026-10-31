// DSN-009 (P1): no unverifiable-claim patterns in the visible text:
//   "loved by <number>[k|m][+] <word>" or "trusted by ..."  (Loved by 10,000+ teams, trusted by 5k customers)
//   "<number>[.n] x <comparative>"      (10x faster, 3.5 x better); x or the multiplication sign; faster, better, more, cheaper, quicker,
//                                        easier, smarter, higher. Any case.
import { mk } from "../lib/check.mjs";
import { scanPage, dsnSource } from "../lib/design.mjs";

export const id = "DSN-009";
export const severity = "P1";
export const source = dsnSource("skills/unslop/references/signs.md:71 and skills/unslop/SKILL.md:111");
export const notCovered = ["other claim wordings (number one, award-winning, rows of avatars or stars)", "whether the claim is true: this only finds the pattern, a client fact with a source still has to be checked by a person", "text in attributes and text added by JavaScript"];
const f = mk(id);
const LOVED = /\b(?:loved|trusted) +by +\d[\d,.]*(?: *[km])?\+? +\p{L}+/giu;
const TIMES = /(?<![\p{L}\p{N}.])\d+(?:\.\d+)? *[x×] +(?:faster|better|more|cheaper|quicker|easier|smarter|higher)\b/giu;

export function run(site) {
  const out = [];
  for (const p of site.pageList) {
    const sc = scanPage(site, p);
    for (const re of [LOVED, TIMES]) for (const m of sc.bodyMatches(re)) out.push(f.fail(p.path, m.line, `forbidden-value: unverifiable claim "${m.text.replace(/\s+/g, " ")}" in the visible text`));
  }
  return out;
}
