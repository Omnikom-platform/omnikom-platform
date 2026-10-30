// A11-007 (P1): every <img>, input[type=image] and area[href] has a usable text alternative. The browser parts are not judged here.
import { mk } from "../lib/check.mjs";

export const id = "A11-007";
export const severity = "P1";
export const source = "checklist/accessibility.md A11-007";
export const notCovered = ["role=img names, button-name, link-name and the axe rules (browser channel)"];
const f = mk(id);
// the spec's genericAltWords list for en
const GENERIC = new Set(["image", "picture", "photo", "graphic", "icon", "logo", "img"]);
const FILENAME = /^[^\s/]+\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;
// the src, its last path segment, and that segment without a query string or fragment
const srcForms = (s) => [s, String(s).split("/").pop(), String(s).split(/[?#]/)[0].split("/").pop()].map((x) => x.toLowerCase());

export function run(site) {
  const out = [];
  for (const p of site.pageList) {
    for (const im of p.imgs) {
      const a = im.attrs;
      const label = im.tag === "img" ? "<img>" : im.tag === "input" ? "<input type=image>" : "<area>";
      const hasAlt = "alt" in a;
      const named = !!((a["aria-label"] || "").trim() || (a["aria-labelledby"] || "").trim());
      if (im.tag === "img") {
        if (/^(presentation|none)$/i.test(a.role || "")) continue; // decorative
        if (!hasAlt) { out.push(f.fail(p.path, im.line, `missing-element: ${label} with src "${a.src || ""}" has no alt attribute`)); continue; }
        if (a.alt === "") continue; // alt="" marks it decorative
      } else if (!hasAlt && !named) { out.push(f.fail(p.path, im.line, `missing-element: ${label} has no alt, aria-label or aria-labelledby`)); continue; }
      const t = a.alt === undefined ? "" : a.alt.trim();
      if (!t) { if (!named) out.push(f.fail(p.path, im.line, `value-mismatch: ${label} has an empty alt and no aria-label or aria-labelledby`)); continue; }
      const src = String(a.src || "").trim();
      if (FILENAME.test(t)) out.push(f.fail(p.path, im.line, `value-mismatch: the alt "${t}" of ${label} is a file name`));
      else if (src && srcForms(src).includes(t.toLowerCase())) out.push(f.fail(p.path, im.line, `value-mismatch: the alt "${t}" of ${label} is the same as its src`));
      else if (GENERIC.has(t.toLowerCase())) out.push(f.fail(p.path, im.line, `value-mismatch: the alt "${t}" of ${label} is a generic word`));
    }
  }
  return out;
}
