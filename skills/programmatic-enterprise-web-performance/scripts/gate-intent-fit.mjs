// GT-012 intent-fit = shipgate TGT-012 (packs/targeting.md), severity P1: the planned page's type (06-growth 9.3 applied to the built page: its JSON-LD types, its path,
// its main entity) is compatible with its cluster's intent (03 section 22.2 table): informational -> article, page, video, comparison; commercial -> comparison, article,
// category, page; transactional -> product, category, local, or a page whose brief has a cta; local -> local, page, category; navigational -> page, home. The finding
// names the intent and the page type found. A planned page that is not built is GT-002's finding, skipped here. Exit 0 PASS, 1 FAIL, 2 cannot judge.
// "A form or CTA from the brief" is read as: the brief has a CTA line (plan-site.mjs writes one for every planned page from the business goal).
import { isCompatible, compatibleTypes } from "./lib-growth.mjs";
import { pass, fail, error, runCli } from "./lib-plan.mjs";

export const id = "GT-012";
export const title = "intent-fit";
export const plain = "Each page is the kind of page people searching for it expect";
export function run(ctx) {
  const bad = [], skipped = [];
  let checked = 0;
  for (const p of ctx.sitemap.pages) {
    const c = p.cluster && ctx.clusterById(p.cluster);
    if (!c) continue;
    const pg = ctx.pageFor(p.path);
    if (!pg) { skipped.push(p.path); continue; }
    checked++;
    const brief = ctx.briefs.get(p.path), cta = !!brief?.fields?.cta;
    const type = ctx.pageTypeOf(pg);
    const ok = isCompatible(c.intent, type, { cta }) || (p.path === "/" && isCompatible(c.intent, "home", { cta }));
    if (!ok) bad.push(`${p.path}: the cluster "${c.primaryQuery}" (${c.id}) is ${c.intent} but the page is of type ${type}; ${c.intent} searches are answered by pages of type ${compatibleTypes(c.intent, { cta }).join(", ")}${c.intent === "transactional" && !cta ? " (or a page with a call to action in its brief; this brief has none)" : ""}`);
  }
  const note = skipped.length ? [`NOTE not built, skipped (see GT-002): ${skipped.join(", ")}`] : [];
  if (!checked) return error("no cluster page is built, nothing to check", note);
  if (bad.length) return fail(`${bad.length} page(s) of the wrong kind for their search`, [...bad, ...note]);
  return pass(`${checked} page(s) fit their cluster's intent`, note);
}
runCli(import.meta.url, { id, run });
