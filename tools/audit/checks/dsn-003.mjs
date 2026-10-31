// DSN-003 (P1): no emoji in labels or headings. In the text of h1-h6, button, a, label, legend, summary, th or option, a character that SHOWS as an
// emoji: one with the Unicode property Emoji_Presentation, or any Extended_Pictographic character followed by U+FE0F (the head's reading of DECISIONS 37).
// A text-style symbol passes: the bare arrow of an external link, the copyright, registered and trade mark signs, U+25B6, U+2714, U+260E, digits, # and *.
import { mk } from "../lib/check.mjs";
import { scanPage, dsnSource } from "../lib/design.mjs";
import { shortText } from "../lib/typography.mjs";

export const id = "DSN-003";
export const severity = "P1";
export const source = dsnSource("skills/unslop/references/signs.md:27");
export const notCovered = ["emoji in other elements (a paragraph, a div, a list item)", "emoji in attributes (alt, aria-label, title) or in images", "text added by JavaScript or by CSS content"];
const f = mk(id);
const LABELS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "button", "a", "label", "legend", "summary", "th", "option"]);
const EMOJI = /\p{Extended_Pictographic}[️⃣\u{1F3FB}-\u{1F3FF}]*(?:‍\p{Extended_Pictographic}[️\u{1F3FB}-\u{1F3FF}]*)*/gu;
const FE0F = String.fromCharCode(0xfe0f);
const PICTOGRAPH_WITH_SELECTOR = new RegExp(String.raw`\p{Extended_Pictographic}` + FE0F, "u");
// a cluster shows as an emoji when it holds an emoji-presentation character, or a pictographic one that the selector U+FE0F turns into an emoji
const showsAsEmoji = (cluster) => /\p{Emoji_Presentation}/u.test(cluster) || PICTOGRAPH_WITH_SELECTOR.test(cluster);

export function run(site) {
  const out = [];
  for (const p of site.pageList) {
    const sc = scanPage(site, p);
    for (const n of sc.nodes) {
      if (n.boundary || n.owner < 0) continue;
      let el = sc.elements[n.owner];
      while (el && !LABELS.has(el.tag)) el = el.parent >= 0 ? sc.elements[el.parent] : null; // the nearest label element holding this text
      if (!el) continue;
      const found = [...new Set((n.t.match(EMOJI) || []).filter(showsAsEmoji))];
      if (found.length) out.push(f.fail(p.path, n.line, `forbidden-value: emoji ${found.map((e) => `"${e}"`).join(" ")} in the text of <${el.tag}> "${shortText(sc.textOf(el))}"`));
    }
  }
  return out;
}
