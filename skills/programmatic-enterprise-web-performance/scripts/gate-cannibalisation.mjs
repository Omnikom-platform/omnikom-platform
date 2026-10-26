// GT-003 no-cannibalisation = shipgate TGT-003 (packs/targeting.md) with the page-cluster match of 06-growth 9.7: no indexable page other than a cluster's planned
// page has a <title> or <h1> containing that cluster's primary-query head term (stemmed words, web-delivery section 12) with a page type (9.3) compatible with the
// cluster's intent (03 section 22.2). Pages listed in the cluster's `alsoServes` (targets.json) are exempt. Exit 0 PASS, 1 FAIL, 2 cannot judge.
// CHANGED 2026-10-22 (was: each page assigned to the cluster whose primary query its title AND H1 cover best at >= 80% token overlap). Two judgement calls, both
// recorded in the build report: (1) the spec's "page other than a cluster's planned page" is read as "other than THAT cluster's planned page", so a planned city page
// of another cluster is also a candidate; because a head term has place names removed, "we buy houses tracy" and "... manteca" would otherwise accuse each other,
// so a page that names a place the cluster's query does not name is a page for another place and is exempt (EXTRA, not in TGT-003). (2) "same title on two pages" is
// kept as an extra check (it is not in TGT-003).
// CHANGED 2026-10-26 (rule GT-003-SUBTOPIC, EXTRA, not in TGT-003): a planned page of ANOTHER cluster is not a rival of this one when that cluster is a deliberate sub-topic
// of it: its head term has all of this head term's words and either at least one more word ("luxury real estate marketing" under "real estate marketing") or a different set
// of place names, in either direction ("historic homes for sale hudson valley" next to "historic homes for sale"). GT-001 already proves clusters are distinct, and the
// planner made that page on purpose. Still flagged: an unplanned page, and a planned page whose cluster has the same head term and the same places (a true duplicate).
import { headTerm, containsHeadTerm, tokens } from "./lib-text.mjs";
import { isCompatible, namesOtherPlace, placesIn } from "./lib-growth.mjs";
import { pass, fail, error, runCli } from "./lib-plan.mjs";
import { normPath } from "./lib-site.mjs";

export const id = "GT-003";
export const title = "no-cannibalisation";
export const plain = "No two pages compete for the same search";
// GT-003-SUBTOPIC: is cluster d (the cluster whose planned page this is) a deliberate sub-topic of cluster c? d is not c, its head term has every word of c's head term,
// and it is not the same head term with the same places (that is a true duplicate and stays a rival).
function isSubTopicOf(c, head, myPlaces, d, locale) {
  if (!d || d.id === c.id) return false;
  const dHead = headTerm(d.primaryQuery, { locale }), have = new Set(dHead.words);
  if (!head.words.every((w) => have.has(w))) return false;
  const dPlaces = new Set(placesIn(d.primaryQuery, { locale }));
  const samePlaces = dPlaces.size === myPlaces.size && [...dPlaces].every((x) => myPlaces.has(x));
  return dHead.words.length > head.words.length || !samePlaces;
}
export function run(ctx) {
  const clusters = ctx.targets.clusters, pages = [...ctx.site.pages.values()].filter((p) => ctx.indexable(p));
  if (!pages.length) return ctx.business.launchState === "live" ? fail("every page is noindex but the business is live", ["set launchState to planned/preview while the site is a preview, or remove the noindex"]) : error("the site has no pages");
  const locale = ctx.locale;
  const bad = [], clusterOfPlanned = new Map(ctx.sitemap.pages.filter((p) => p.cluster).map((p) => [p.path, clusters.find((k) => k.id === p.cluster)])), plannedOf = (c) => ctx.sitemap.pages.find((p) => p.cluster === c.id)?.path;
  const hasCta = (path) => { try { return !!ctx.briefs.get(path)?.fields?.cta; } catch { return false; } }; // a planned page has a brief with a cta; any other page has none
  for (const c of clusters) {
    const head = headTerm(c.primaryQuery, { locale }), mine = plannedOf(c), exempt = new Set((c.alsoServes || []).map(normPath));
    const rivals = [], myPlaces = new Set(placesIn(c.primaryQuery, { locale }));
    for (const pg of pages) {
      if (pg.path === mine || exempt.has(pg.path)) continue;
      if (isSubTopicOf(c, head, myPlaces, clusterOfPlanned.get(pg.path), locale)) continue; // GT-003-SUBTOPIC: the plan made this page for a narrower or local sibling cluster
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
