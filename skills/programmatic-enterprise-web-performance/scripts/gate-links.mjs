// GT-006 internal-links: every internal link in plan/sitemap.json exists on the built page it starts from, and its anchor is
// descriptive: never "click here" / "read more" (anywhere on the page), and for links in the page body at least one content
// token shared with the target's primary query (menu and footer labels are exempt from the token rule). On a complete site
// every internal link must also land on a page that exists. Exit 0 PASS, 1 FAIL, 2 cannot judge.
import { overlap, isGenericAnchor } from "./lib-text.mjs";
import { resolveInternal } from "./lib-site.mjs";
import { pass, fail, error, runCli } from "./lib-plan.mjs";

export const id = "GT-006";
export const title = "internal-links";
export const plain = "The links the plan asked for are on the pages, with words that describe where they go";
export function run(ctx) {
  const site = ctx.site, bad = [], skipped = [];
  const planned = ctx.sitemap.links;
  let checked = 0;
  const target = new Map(ctx.sitemap.pages.map((p) => [p.path, p]));
  for (const l of planned) {
    const from = site.pages.get(l.from), to = target.get(l.to);
    if (!from || !site.pages.get(l.to)) { skipped.push(`${l.from} -> ${l.to}`); continue; }
    checked++;
    const anchors = from.links.filter((a) => resolveInternal(a.href, l.from, site.hosts) === l.to);
    if (!anchors.length) { bad.push(`${l.from} -> ${l.to}: planned link ("${l.anchor}") is not on the page`); continue; }
    for (const a of anchors) {
      if (isGenericAnchor(a.text)) bad.push(`${l.from} -> ${l.to}: generic anchor "${a.text}"`);
      else if (to.primaryQuery && (a.region === "main" || a.region === "body") && overlap(to.primaryQuery, a.text) === 0) bad.push(`${l.from} -> ${l.to}: anchor "${a.text}" shares no content word with "${to.primaryQuery}"`);
    }
  }
  if (site.complete) {
    for (const pg of site.pages.values()) for (const a of pg.links) {
      const t = resolveInternal(a.href, pg.path, site.hosts);
      if (t && !site.pages.has(t)) bad.push(`${pg.path}: broken internal link ${a.href} ("${a.text}")`);
    }
  }
  const note = skipped.length ? [`NOTE planned links skipped because an end is not built (see GT-002): ${skipped.join("; ")}`] : [];
  if (!checked && !bad.length) return error("no planned link has both ends built", note);
  if (bad.length) return fail(`${bad.length} link problem(s), ${checked} planned link(s) checked`, [...bad, ...note]);
  return pass(`${checked} planned link(s) present with descriptive anchors${site.complete ? ", no broken internal links" : ""}`, note);
}
runCli(import.meta.url, { id, run });
