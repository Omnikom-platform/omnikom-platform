// GT-002 clusters-have-pages: every page the plan lists (so every cluster's page) exists on the built site, answers 200, is not
// noindex (unless the business is not live yet) and is its own canonical. On a live snapshot (a sample of pages) a page that is
// not in the sample is "cannot judge", never a failure. Exit 0 PASS, 1 FAIL, 2 cannot judge.
import { normPath } from "./lib-site.mjs";
import { pass, fail, error, runCli } from "./lib-plan.mjs";

export const id = "GT-002";
export const title = "clusters-have-pages";
export const plain = "Every page in the plan exists on the site and can be indexed";
export function run(ctx) {
  const site = ctx.site, live = ctx.business.launchState === "live";
  const bad = [], notSeen = [], notes = [];
  for (const p of ctx.sitemap.pages) {
    const pg = site.pages.get(p.path);
    if (!pg) { (site.complete ? bad : notSeen).push(`${p.cluster || "support"} ${p.path}: ${site.complete ? "no page built at this path" : "not in the snapshot sample (re-snapshot with --include)"}`); continue; }
    if (pg.status !== 200) bad.push(`${p.cluster || "support"} ${p.path}: answers ${pg.status}, not 200`);
    if (pg.noindex) { if (ctx.strict && !live) bad.push(`${p.cluster || "support"} ${p.path}: page is noindex and --strict is the launch gate (set launchState to live and remove the noindex)`); else if (live) bad.push(`${p.cluster || "support"} ${p.path}: page is noindex but the business is live`); else notes.push(`NOTE ${p.path}: noindex, expected while launchState is "${ctx.business.launchState}" (not a defect)`); }
    if (pg.canonical) { let cp = null; try { cp = normPath(new URL(pg.canonical, "https://x.invalid" + p.path).pathname); } catch {} if (cp && cp !== p.path) bad.push(`${p.cluster || "support"} ${p.path}: canonical points at ${cp} (a page cannot rank when it names another page as the original)`); }
  }
  if (bad.length) return fail(`${bad.length} planned page(s) missing or not indexable`, [...bad, ...notes]);
  if (notSeen.length) return error(`${notSeen.length} planned page(s) not in the snapshot sample`, [...notSeen, ...notes]);
  return pass(`all ${ctx.sitemap.pages.length} planned pages exist`, notes);
}
runCli(import.meta.url, { id, run });
