// GT-011 priority-demand-covered = shipgate TGT-011 (packs/targeting.md), severity W: the top `targeting.priorityPages` (default 20) clusters by priority (06-growth 9.4,
// the `priority` of targets.json, higher first; ties: bigger value, then the query) each have a BUILT planned page: the planned page exists on the site and answers 200.
// The finding lists the unbuilt clusters with their value. W means a warning, not a block: it is a WARN line (the run still PASSES) and becomes a FAIL under --strict,
// like the other launch blockers. A snapshot sample that lacks a planned page cannot judge it (exit 2), exactly as GT-002 does. Exit 0 PASS, 1 FAIL, 2 cannot judge.
// --priority-pages N overrides the count; so does business.json targeting.priorityPages.
import { pass, fail, error, runCli } from "./lib-plan.mjs";

export const id = "GT-011";
export const title = "priority-demand-covered";
export const plain = "The searches worth the most each have a page on the site";
const num = (f) => (typeof f?.value === "number" ? f.value : null);
export function run(ctx) {
  const n = ctx.priorityPages;
  if (!Number.isInteger(n) || n < 1) return error(`priorityPages must be a whole number >= 1 (got ${ctx.priorityPages})`);
  const site = ctx.site, sm = ctx.sitemap;
  const ranked = [...ctx.targets.clusters].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (num(b.value) ?? 0) * (num(b.volume) ?? 0) - (num(a.value) ?? 0) * (num(a.volume) ?? 0) || (a.primaryQuery < b.primaryQuery ? -1 : 1));
  const top = ranked.slice(0, n), unbuilt = [], unseen = [];
  for (const c of top) {
    const planned = sm.pages.find((p) => p.cluster === c.id);
    const pg = planned ? site.pages.get(planned.path) : null;
    const desc = `#${ranked.indexOf(c) + 1} "${c.primaryQuery}" (${c.id}, priority ${c.priority}, ${c.intent}${num(c.value) != null ? `, value ${num(c.value)}` : ""}${Array.isArray(c.volume?.value) ? `, volume ${c.volume.value.join("-")}` : num(c.volume) != null ? `, volume ${num(c.volume)}` : ""})`;
    if (!planned) { unbuilt.push(`${desc}: the plan has no page for it`); continue; }
    if (!pg) { (site.complete ? unbuilt : unseen).push(`${desc}: ${site.complete ? `no page built at ${planned.path}` : `${planned.path} is not in the snapshot sample`}`); continue; }
    if (pg.status !== 200) unbuilt.push(`${desc}: ${planned.path} answers ${pg.status}, not 200`);
  }
  if (unbuilt.length) {
    const lines = unbuilt.map((u) => `unbuilt priority cluster ${u}`);
    if (ctx.strict) return fail(`${unbuilt.length} of the top ${top.length} priority cluster(s) have no built page (--strict: a warning counts as a failure)`, lines);
    return pass(`${top.length - unbuilt.length} of the top ${top.length} priority clusters are built; ${unbuilt.length} are not (warning, W)`, lines.map((l) => `WARN ${l}`));
  }
  if (unseen.length) return error(`${unseen.length} priority page(s) not in the snapshot sample`, unseen);
  return pass(`the top ${top.length} priority cluster(s) all have a built page`);
}
runCli(import.meta.url, { id, run });
