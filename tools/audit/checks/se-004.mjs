// SE-004 (P1): every sitemap <lastmod> is a W3C datetime with seconds and a timezone, and not in the future.
import { mk } from "../lib/check.mjs";
import { lastmodProblem } from "../lib/sitemap-lastmod.mjs";

export const id = "SE-004";
export const severity = "P1";
export const source = "checklist/search-engines.md SE-004";
const f = mk(id);

// the sitemap files this rule judges; with none the rule cannot judge and says so
export const subjects = (site) => site.sitemaps().files.map((s) => s.rel);

export function run(site) {
  const out = [];
  const maps = site.sitemaps().files;
  if (maps.length === 0) return [f.skip("sitemap.xml", "no sitemap*.xml in the folder, so there is no lastmod to read")];
  for (const m of maps) {
    for (const e of m.entries.filter((x) => x.kind === "url" && x.lastmod != null)) {
      const why = lastmodProblem(e.lastmod);
      if (why) out.push(f.fail(m.rel, e.lastmodLine, `value-mismatch: the lastmod "${e.lastmod}" of ${e.loc} is ${why}`));
    }
  }
  return out;
}
