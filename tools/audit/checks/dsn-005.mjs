// DSN-005 (P1): no hype words and no "AI-powered" copy. Visible body text (not script, style, noscript, template, svg, comments, head) that
// holds, as whole words in any case, across inline elements within one block of text: AI-powered (also "AI powered"), "powered by AI",
// supercharge, seamless, unlock, magic, revolutionize (revolutionise, the -s -d -ing forms, revolutionary), game-changing (also
// "game changing", game-changer). The list is skills/unslop/references/signs.md:47 and SKILL.md:110; unlock and magic may need a per-site exception.
import { mk } from "../lib/check.mjs";
import { scanPage, dsnSource } from "../lib/design.mjs";

export const id = "DSN-005";
export const severity = "P1";
export const source = dsnSource("skills/unslop/references/signs.md:47 and skills/unslop/SKILL.md:110");
export const notCovered = ["hype words outside the list above (and inflections of supercharge, seamless, unlock and magic: whole words only)","text in attributes (alt, title, meta description) and text added by JavaScript"];
const f = mk(id);
const HYPE = new RegExp(String.raw`\b(?:AI[-‐‑ ]+powered|powered +by +AI|supercharge|seamless|unlock|magic|revolutioni[sz](?:e|es|ed|ing)|revolutionary|game[-‐‑ ]chang(?:ing|er|ers))\b`, "gi");

export function run(site) {
  const out = [];
  for (const p of site.pageList) {
    const sc = scanPage(site, p);
    for (const m of sc.bodyMatches(HYPE)) out.push(f.fail(p.path, m.line, `forbidden-value: hype copy "${m.text.replace(/\s+/g, " ")}" in the visible text`));
  }
  return out;
}
