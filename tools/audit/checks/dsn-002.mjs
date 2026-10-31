// DSN-002 (P1): no gradient text, and no hue gradient as a background.
//   text: Tailwind bg-clip-text with text-transparent on one element; or CSS background-clip: text (also -webkit-) together with a gradient
//         (a CSS gradient or a Tailwind gradient class) on the same element.
//   background: Tailwind from-, via- and to- colours of one variant group that name two different hue families; or a CSS linear-, radial-
//         or conic-gradient (also repeating-) in background or background-image whose colour stops fall in two different hue families.
//   The hue families are in lib/colour.mjs and rules/DSN-002.md. Greys, black, white and transparent are no family.
import { mk } from "../lib/check.mjs";
import { scanPage, splitToken, dsnSource } from "../lib/design.mjs";
import { TW_FAMILY, TW_NO_FAMILY, colourFamily, gradientsIn, gradientStops } from "../lib/colour.mjs";
import { shortText } from "../lib/typography.mjs";

export const id = "DSN-002";
export const severity = "P1";
export const source = dsnSource("skills/unslop/references/signs.md:7-8 and skills/unslop/SKILL.md:89");
export const notCovered = ["oklch, oklab, lab, lch, color-mix and var() colours (a stop in such a form is not read)", "Tailwind colour names that are not in the default palette", "gradients built by JavaScript or in an image", "a snapshot's stylesheets (not in the snapshot)"];
const f = mk(id);

// family of the part after "from-", "via-" or "to-": { family } | { none } | { unknown }
function stopFamily(rest) {
  const s = rest.replace(/\/[\w.%[\]]+$/, "");
  let m;
  if ((m = /^\[(.+)\]$/.exec(s))) return colourFamily(m[1].replace(/^color:/, ""));
  if ((m = /^([a-z]+)(?:-(?:\d{2,3}|950))?$/.exec(s))) {
    if (Object.prototype.hasOwnProperty.call(TW_FAMILY, m[1])) return { family: TW_FAMILY[m[1]] };
    if (TW_NO_FAMILY.has(m[1])) return { none: true };
  }
  return { unknown: true };
}

const bgDecls = (sc, el) => ["background", "background-image"].map((p) => sc.effective(el, p)).filter(Boolean);

export function run(site) {
  const out = [];
  for (const p of site.pageList) {
    const sc = scanPage(site, p);
    for (const el of sc.elements) {
      const toks = sc.classes(el).map((t) => ({ token: t, ...splitToken(t) }));
      if (!toks.length && !el.attrs.style && !sc.css(el).length) continue;
      const here = `<${el.tag}>`;
      // ---- gradient text
      const gradDecls = bgDecls(sc, el).filter((d) => gradientsIn(d.value).length);
      const gradClass = toks.find((t) => /^(bg-gradient-|bg-linear-|bg-radial|bg-conic)/.test(t.utility) || /gradient\(/.test(t.utility));
      let textWhy = null;
      if (toks.some((t) => t.utility === "bg-clip-text") && toks.some((t) => t.utility === "text-transparent")) textWhy = 'classes "bg-clip-text" and "text-transparent"';
      else {
        const clip = sc.css(el).filter((d) => (d.prop === "background-clip" || d.prop === "-webkit-background-clip") && /\btext\b/i.test(d.value));
        if (clip.length && (gradDecls.length || gradClass)) {
          const c = clip[clip.length - 1];
          textWhy = `${c.prop}: ${c.value} (${c.where}) with ${gradDecls.length ? shortText(gradDecls[0].value, 50) : 'class "' + gradClass.token + '"'}`;
        }
      }
      if (textWhy) out.push(f.fail(p.path, el.line, `forbidden-value: gradient text on ${here}: ${textWhy}`));
      // ---- hue gradient, Tailwind colour classes (one finding per variant group)
      const groups = new Map();
      for (const t of toks) {
        const m = /^(from|via|to)-(.+)$/.exec(t.utility);
        if (!m) continue;
        const sf = stopFamily(m[2]);
        if (!sf.family) continue;
        const key = t.variants.join(":");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ token: t.token, family: sf.family });
      }
      for (const stops of groups.values()) {
        const fams = [...new Set(stops.map((s) => s.family))];
        if (fams.length >= 2) out.push(f.fail(p.path, el.line, `forbidden-value: hue gradient on ${here}: classes "${stops.map((s) => s.token).join(" ")}" name two hue families (${fams.join(", ")})`));
      }
      // ---- hue gradient, CSS background gradients (one finding per declaration)
      for (const d of gradDecls) {
        for (const g of gradientsIn(d.value)) {
          const fams = [...new Set(gradientStops(g.args).filter((s) => s.family).map((s) => s.family))];
          if (fams.length >= 2) { out.push(f.fail(p.path, el.line, `forbidden-value: hue gradient on ${here}: ${d.prop}: ${shortText(d.value, 60)} (${d.where}) has colour stops in two hue families (${fams.join(", ")})`)); break; }
        }
      }
    }
  }
  return out;
}
