// IDX-001 (P0): the sitemap URL set equals the set of indexable pages in canonical form. Each discrepancy class is its own finding:
// extra (a URL with no page), missing (a page not in the sitemap), non-canonical (a URL that is not the page's canonical), noindex.
import { mk } from "../lib/check.mjs";
import { normPath } from "../lib/site.mjs";

export const id = "IDX-001";
export const severity = "P0";
export const source = "checklist/web-delivery.md IDX-001";
const f = mk(id);

export const subjects = (site) => [site.sitemaps().root ? site.sitemaps().root.rel : "sitemap.xml"];

export function run(site) {
  const { files, root } = site.sitemaps();
  if (!root) return [f.fail("sitemap.xml", 1, "missing-element: the folder has no sitemap file, so no page is listed")];
  const out = [];
  const byCanon = new Map(site.pageList.map((p) => [site.expectedCanonical(p), p]));
  const listed = new Set();
  // A snapshot is a sample of the site unless _site.json says complete: true. Then "extra" (a listed URL with no crawled page) and
  // "missing" (a crawled page the sitemap does not list; the sitemap files may be cut off) cannot be judged and are one SKIP each.
  const partial = site.mode === "snapshot" && !site.complete;
  const extraSkipped = [], missingSkipped = [];
  for (const s of files) {
    for (const e of s.entries.filter((x) => x.kind === "url")) {
      listed.add(e.loc);
      const page = byCanon.get(e.loc);
      if (page) { if (page.noindex) out.push(f.fail(s.rel, e.line, `forbidden-value: ${e.loc} is listed but the page ${page.path} is noindex`)); continue; }
      let byPath = null;
      try { byPath = site.pages.get(normPath(new URL(e.loc).pathname)) || null; } catch { byPath = null; }
      if (byPath && byPath.status !== 200) { out.push(f.fail(s.rel, e.line, `status-mismatch: ${e.loc} is listed but the crawl saw status ${byPath.status || "none"} for ${byPath.path}`)); continue; }
      if (!byPath && partial) { extraSkipped.push(e.loc); continue; }
      if (!byPath) out.push(f.fail(s.rel, e.line, `value-mismatch: extra, ${e.loc} is listed but no page of the folder has that address`));
      else if (byPath.noindex) out.push(f.fail(s.rel, e.line, `forbidden-value: ${e.loc} is listed but the page ${byPath.path} is noindex`));
      else out.push(f.fail(s.rel, e.line, `value-mismatch: non-canonical, ${e.loc} is not the canonical ${site.expectedCanonical(byPath)} of page ${byPath.path}`));
    }
  }
  for (const p of site.pageList) {
    if (!site.indexable(p)) continue;
    const want = site.expectedCanonical(p);
    if (partial && !listed.has(want)) { missingSkipped.push(p.path); continue; }
    if (!listed.has(want)) out.push(f.fail(root.rel, 1, `missing-element: the page ${p.path} (canonical ${want}) is not in the sitemap`));
  }
  const some = (xs) => xs.slice(0, 5).join(", ") + (xs.length > 5 ? ", ..." : "");
  if (extraSkipped.length) out.push(f.skip(root.rel, `incomplete-crawl: ${extraSkipped.length} sitemap URL(s) have no crawled page (${some(extraSkipped)}); the crawl is a sample, so "extra" is not judged`));
  if (missingSkipped.length) out.push(f.skip(root.rel, `incomplete-crawl: ${missingSkipped.length} crawled page(s) are not listed in the sitemap (${some(missingSkipped)}); the crawl is a sample, so "missing" is not judged`));
  return out;
}
