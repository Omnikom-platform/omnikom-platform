// LNK-002 (P0): every internal a[href] lands on a page or file that exists in the folder, without rel=nofollow, in the target's canonical form.
// Snapshot mode (slice 2): the pages the crawl saw carry the HTTP status; an internal page link is judged by what the crawl saw at its target:
// 200 fine; a redirect (the target's first hop was 3xx, or its final status is 3xx) is redirect-target; any other status is status-mismatch;
// a target the crawl did not visit is SKIP not-crawled (the crawl is a sample): never a PASS and never a FAIL. File links are not judged.
import { mk } from "../lib/check.mjs";
import { resolveLink } from "../lib/context.mjs";

export const id = "LNK-002";
export const severity = "P0";
export const source = "checklist/web-delivery.md LNK-002";
export const notCovered = ["folder mode: the HTTP status of the link in production (needs a fetch; a snapshot carries it)", "snapshot mode: links to files and assets (the crawl fetches pages only)"];
const f = mk(id);

export function run(site) {
  const out = [];
  const snap = site.mode === "snapshot";
  for (const p of site.pageList) {
    const skipped = new Set();
    for (const l of p.links) {
      const r = resolveLink(site, l.href, p.path);
      if (!r) continue;
      if (/\bnofollow\b/i.test(l.rel)) out.push(f.fail(p.path, l.line, `forbidden-value: the internal link to ${l.href} has rel="${l.rel}"`));
      if (snap) {
        if (r.kind === "file") continue;
        const seen = site.pages.get(r.path);
        const red = site.redirects.get(r.path);
        if (!seen && !red) {
          if (!skipped.has(r.path)) out.push(f.skip(p.path, `not-crawled: the link to ${l.href} lands on a page the snapshot did not visit (the crawl is a sample), so its status is not judged`));
          skipped.add(r.path);
          continue;
        }
        if (!seen) { out.push(f.fail(p.path, l.line, `redirect-target: the link to ${l.href} lands on a URL the crawl saw answer ${red.status} (it redirects to ${red.to})`)); continue; }
        if (seen.status >= 300 && seen.status < 400) { out.push(f.fail(p.path, l.line, `redirect-target: the link to ${l.href} lands on a URL the crawl saw answer ${seen.status}`)); continue; }
        if (seen.status !== 200) { out.push(f.fail(p.path, l.line, `status-mismatch: the link to ${l.href} lands on a URL the crawl saw answer ${seen.status || "no status"}, not 200`)); continue; }
        if (r.pathname.toLowerCase() !== seen.path) out.push(f.fail(p.path, l.line, `value-mismatch: the link to ${l.href} is not the canonical form ${seen.path} of that page`));
        continue;
      }
      if (r.kind === "file") {
        if (!site.has(r.path)) out.push(f.fail(p.path, l.line, `status-mismatch: the link to ${l.href} lands on no file in the folder (404)`));
        continue;
      }
      const target = site.pages.get(r.path);
      if (!target) { out.push(f.fail(p.path, l.line, `status-mismatch: the link to ${l.href} lands on no page in the folder (404)`)); continue; }
      if (r.pathname.toLowerCase() !== target.path) out.push(f.fail(p.path, l.line, `value-mismatch: the link to ${l.href} is not the canonical form ${target.path} of that page`));
    }
  }
  return out;
}
