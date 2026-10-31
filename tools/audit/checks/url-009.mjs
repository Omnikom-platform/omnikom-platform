// URL-009 (P0): on each indexable page the same canonical string in the canonical tag, og:url, the page's own hreflang href and
// JSON-LD WebPage.url; every hreflang href equals the canonical of its target page. In a folder there is no origin: the canonical
// must be present, absolute (https://) and its path must normalise to the page's own path.
import { mk, headLine } from "../lib/check.mjs";
import { normPath } from "../lib/site.mjs";
import { graphOf, typesOf, WEBPAGE_TYPES } from "../lib/schema.mjs";

export const id = "URL-009";
export const severity = "P0";
export const source = "checklist/web-delivery.md URL-009";
const f = mk(id);

export function run(site) {
  const out = [];
  for (const p of site.pageList) {
    if (!site.indexable(p)) continue;
    const c = p.canonicals[0];
    if (!c) { out.push(f.fail(p.path, headLine(p), "missing-element: the page has no canonical link")); continue; }
    const canon = c.href.trim();
    let u = null;
    if (/^https:\/\//i.test(canon)) { try { u = new URL(canon); } catch { u = null; } }
    if (!u) { out.push(f.fail(p.path, c.line, `value-mismatch: the canonical "${canon}" is not an absolute https:// URL`)); continue; }
    // a snapshot knows the HTTP origin the page was fetched from, so the canonical's origin is checked exactly (a folder has none)
    if (site.mode === "snapshot" && site.origin && u.origin !== site.origin) out.push(f.fail(p.path, c.line, `value-mismatch: the canonical origin ${u.origin} is not the origin ${site.origin} the page was fetched from`));
    if (normPath(u.pathname) !== p.path) out.push(f.fail(p.path, c.line, `value-mismatch: the canonical path ${u.pathname} is not this page's own path ${p.path}`));
    for (const og of p.ogUrls) if (og.content.trim() !== canon) out.push(f.fail(p.path, og.line, `value-mismatch: og:url "${og.content}" is not the canonical "${canon}"`));
    for (const h of p.hreflangs) {
      let hp = null;
      try { hp = normPath(new URL(h.href, canon).pathname); } catch { hp = null; }
      const target = hp === null ? null : site.pages.get(hp);
      if (!target) continue;
      const want = target === p ? canon : site.canonicalOf(target);
      if (want && h.href.trim() !== want) out.push(f.fail(p.path, h.line, `value-mismatch: the hreflang ${h.hreflang} href "${h.href}" is not the canonical "${want}" of ${target.path}`));
    }
    const block = p.jsonld[0];
    for (const n of graphOf(p)) {
      if (typesOf(n).some((t) => WEBPAGE_TYPES.has(t)) && typeof n.url === "string" && n.url !== canon) out.push(f.fail(p.path, block.line, `value-mismatch: JSON-LD WebPage.url "${n.url}" is not the canonical "${canon}"`));
    }
  }
  return out;
}
