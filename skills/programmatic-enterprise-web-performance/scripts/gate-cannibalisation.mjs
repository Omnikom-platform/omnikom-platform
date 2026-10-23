// GT-003 no-cannibalisation = shipgate TGT-003 (packs/targeting.md) with the page-cluster match of 06-growth 9.7: no indexable page other than a cluster's planned
// page has a <title> or <h1> containing that cluster's primary-query head term (stemmed words, web-delivery section 12) with a page type (9.3) compatible with the
// cluster's intent (03 section 22.2). Pages listed in the cluster's `alsoServes` (targets.json) are exempt. Exit 0 PASS, 1 FAIL, 2 cannot judge.
// CHANGED 2026-10-22 (was: each page assigned to the cluster whose primary query its title AND H1 cover best at >= 80% token overlap). Two judgement calls, both
// recorded in the build report: (1) the spec's "page other than a cluster's planned page" is read as "other than THAT cluster's planned page", so a planned city page
// of another cluster is also a candidate; because a head term has place names removed, "we buy houses tracy" and "... manteca" would otherwise accuse each other,
// so a page that names a place the cluster's query does not name is a page for another place and is exempt (EXTRA, not in TGT-003). (2) "same title on two pages" is
// kept as an extra check (it is not in TGT-003).
import { headTerm, containsHeadTerm, tokens } from "./lib-text.mjs";
import { isCompatible, namesOtherPlace } from "./lib-growth.mjs";
import { pass, fail, error, runCli } from "./lib-plan.mjs";
import { normPath } from "./lib-site.mjs";

export const id = "GT-003";
export const title = "no-cannibalisation";
export const plain = "No two pages compete for the same search";
export function run(ctx) {
  const clusters = ctx.targets.clusters, pages = [...ctx.site.pages.values()].filter((p) => ctx.indexable(p));
  if (!pages.length) return ctx.business.launchState === "live" ? fail("every page is noindex but the business is live", ["set launchState to planned/preview while the site is a preview, or remove the noindex"]) : error("the site has no pages");
  const locale = ctx.locale;
  const bad = [], plannedOf = (c) => ctx.sitemap.pages.find((p) => p.cluster === c.id)?.path;
  const hasCta = (path) => { try { return !!ctx.briefs.get(path)?.fields?.cta; } catch { return false; } }; // a planned page has a brief with a cta; any other page has none
  for (const c of clusters) {
    const head = headTerm(c.primaryQuery, { locale }), mine = plannedOf(c), exempt = new Set((c.alsoServes || []).map(normPath));
    const rivals = [];
    for (const pg of pages) {
      if (pg.path === mine || exempt.has(pg.path)) continue;
      if (!(containsHeadTerm(pg.title, head, { locale }) || containsHeadTerm(pg.h1[0] || "", head, { locale }))) continue;
      if (!isCompatible(c.intent, ctx.pageTypeOf(pg), { cta: hasCta(pg.path) }) && !(pg.path === "/" && isCompatible(c.intent, "home"))) continue;
      if (namesOtherPlace(c.primaryQuery, `${pg.title} ${pg.h1[0] || ""}`, { locale })) continue; // a page for another place
      rivals.push(`${pg.path} (${ctx.pageTypeOf(pg)})`);
    }
    if (rivals.length) bad.push(`"${c.primaryQuery}" (${c.id}, ${c.intent}) is planned for ${mine || "no page"} but ${rivals.length} other page(s) have its head term [${head.words.join(" ")}] in the title or H1 with a fitting page type: ${rivals.join(", ")}`);
  }
  const byTitle = new Map();
  for (const pg of pages) { const k = [...new Set(tokens(pg.title))].sort().join(" "); if (!k) continue; byTitle.set(k, [...(byTitle.get(k) || []), pg.path]); }
  for (const [, ps] of byTitle) if (ps.length > 1) bad.push(`EXTRA (not TGT-003) same title on ${ps.join(", ")}`);
  if (bad.length) return fail(`${bad.length} cannibalisation problem(s)`, [...bad, ...ctx.noindexNote]);
  return pass(`${pages.length} pages, no page other than a cluster's planned page competes for its head term`, ctx.noindexNote);
}
runCli(import.meta.url, { id, run });
