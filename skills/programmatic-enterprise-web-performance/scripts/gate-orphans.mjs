// GT-007 no-orphans: every indexable page is linked from another page and reachable from the home page by following links.
// Needs the whole site (a live snapshot is a sample: cannot judge). Exit 0 PASS, 1 FAIL, 2 cannot judge.
import { resolveInternal } from "./lib-site.mjs";
import { pass, fail, error, isIndexable, runCli } from "./lib-plan.mjs";

export const id = "GT-007";
export const title = "no-orphans";
export const plain = "Every page can be reached by clicking from the home page";
export function run(ctx) {
  const site = ctx.site;
  if (!site.complete) return error("this is a snapshot sample of the site, not every page; orphans need the whole site (use the build folder)");
  if (!site.pages.has("/")) return error("the site has no home page at /");
  const inbound = new Map([...site.pages.keys()].map((p) => [p, new Set()])), out = new Map();
  for (const pg of site.pages.values()) {
    const to = new Set();
    for (const a of pg.links) { const t = resolveInternal(a.href, pg.path, site.hosts); if (t && t !== pg.path && site.pages.has(t)) { to.add(t); inbound.get(t).add(pg.path); } }
    out.set(pg.path, to);
  }
  const seen = new Set(["/"]), queue = ["/"];
  while (queue.length) for (const t of out.get(queue.shift())) if (!seen.has(t)) { seen.add(t); queue.push(t); }
  const bad = [];
  for (const pg of site.pages.values()) {
    if (pg.path === "/" || !ctx.indexable(pg)) continue;
    if (!inbound.get(pg.path).size) bad.push(`${pg.path}: no page links to it (orphan)`);
    else if (!seen.has(pg.path)) bad.push(`${pg.path}: only linked from pages that cannot be reached from the home page`);
  }
  if (bad.length) return fail(`${bad.length} orphan page(s)`, [...bad, ...ctx.noindexNote]);
  return pass(`${site.pages.size} pages, all linked and reachable from /`, ctx.noindexNote);
}
runCli(import.meta.url, { id, run });
