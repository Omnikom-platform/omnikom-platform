// LNK-002 (P0): every internal a[href] lands on a page or file that exists in the folder, without rel=nofollow, in the target's canonical form.
import { mk } from "../lib/check.mjs";
import { resolveLink } from "../lib/context.mjs";

export const id = "LNK-002";
export const severity = "P0";
export const source = "checklist/web-delivery.md LNK-002";
const f = mk(id);

export function run(site) {
  const out = [];
  for (const p of site.pageList) {
    for (const l of p.links) {
      const r = resolveLink(site, l.href, p.path);
      if (!r) continue;
      if (/\bnofollow\b/i.test(l.rel)) out.push(f.fail(p.path, l.line, `forbidden-value: the internal link to ${l.href} has rel="${l.rel}"`));
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
