// IDX-003 (W here): the build-clock signature in a sitemap: five or more URLs sharing one lastmod that lies within ten minutes of the
// time the sitemap file was written. A WARN in this engine (the checklist lists IDX-003 as P1; the slice 1 brief fixes it as a WARN).
import { mk } from "../lib/check.mjs";
import { buildClockSignature } from "../lib/sitemap-lastmod.mjs";

export const id = "IDX-003";
export const severity = "W";
export const source = "checklist/web-delivery.md IDX-003";
const f = mk(id);

export const subjects = (site) => site.sitemaps().files.map((s) => s.rel);

export function run(site) {
  const maps = site.sitemaps().files;
  if (maps.length === 0) return [f.skip("sitemap.xml", "no sitemap*.xml in the folder, so there is no lastmod source to judge")];
  const out = [];
  for (const m of maps) {
    const urls = m.entries.filter((e) => e.kind === "url");
    if (buildClockSignature(urls, site.mtime(m.rel))) out.push(f.warn(m.rel, urls[0].line, `all ${urls.length} URLs share one lastmod (${urls[0].lastmod}) within 10 minutes of the time this file was written: the build clock, not content dates`));
  }
  return out;
}
