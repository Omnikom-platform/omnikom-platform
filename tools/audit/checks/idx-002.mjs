// IDX-002 (P0): at most maxUrlsPerFile URLs and maxBytesPerFile bytes per sitemap file; a sitemap index when there is more than one file;
// valid escaped XML; absolute URLs on one origin; unique entries.
import { mk } from "../lib/check.mjs";
import { xmlProblems } from "../lib/xml.mjs";

export const id = "IDX-002";
export const severity = "P0";
export const source = "checklist/web-delivery.md IDX-002";
const f = mk(id);

export const subjects = (site) => site.sitemaps().files.map((s) => s.rel);

export function run(site) {
  const out = [];
  const { files, root } = site.sitemaps();
  if (files.length === 0) return [f.skip("sitemap.xml", "no sitemap*.xml in the folder, so there is nothing to judge")];
  const { maxUrlsPerFile, maxBytesPerFile } = site.config.sitemap;
  let origin = null;
  const seen = new Map(); // loc -> "file:line" of its first appearance
  if (files.length > 1 && root.kind !== "index") out.push(f.fail(root.rel, 1, `value-mismatch: the folder has ${files.length} sitemap files but ${root.rel} is not a sitemap index`));
  for (const s of files) {
    if (s.kind === "unknown") out.push(f.fail(s.rel, 1, "value-mismatch: the file is neither a <urlset> nor a <sitemapindex>"));
    for (const p of xmlProblems(s.text)) out.push(f.fail(s.rel, p.line, `value-mismatch: the XML is not valid: ${p.what}`));
    const urls = s.entries.filter((e) => e.kind === "url");
    if (urls.length > maxUrlsPerFile) out.push(f.fail(s.rel, urls[maxUrlsPerFile].line, `value-mismatch: ${urls.length} URLs, the limit is ${maxUrlsPerFile} per file`));
    if (s.bytes > maxBytesPerFile) out.push(f.fail(s.rel, 1, `value-mismatch: ${s.bytes} bytes, the limit is ${maxBytesPerFile} per file`));
    for (const e of s.entries) {
      let u = null;
      if (/^https?:\/\//i.test(e.loc)) { try { u = new URL(e.loc); } catch { u = null; } }
      if (!u) { out.push(f.fail(s.rel, e.line, `value-mismatch: the <loc> "${e.loc}" is not an absolute URL`)); continue; }
      if (origin === null) origin = u.origin;
      else if (u.origin !== origin) out.push(f.fail(s.rel, e.line, `value-mismatch: ${e.loc} is not on the origin ${origin} of the first URL`));
      if (seen.has(e.loc)) out.push(f.fail(s.rel, e.line, `duplicate-element: ${e.loc} is listed more than once (first at ${seen.get(e.loc)})`));
      else seen.set(e.loc, `${s.rel}:${e.line}`);
    }
  }
  return out;
}
