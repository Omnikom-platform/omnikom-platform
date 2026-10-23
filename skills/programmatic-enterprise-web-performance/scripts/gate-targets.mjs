// GT-001 targets-and-plan: the signed files (approve.mjs) are unchanged since approval; targets.json / business.json obey schemas/targets.md, and plan/ is consistent with them: every cluster
// has exactly one page and one brief, the briefs repeat the cluster's query, entities and questions, the planned titles carry the
// query, and the planned internal links are well formed (target exists, descriptive anchor that shares a content word with the
// target's primary query, no orphan in the plan itself). Exit 0 PASS, 1 FAIL, 2 cannot judge.
import { validate, validateBusiness } from "./targets-validate.mjs";
import { overlap, tokens, isGenericAnchor, THRESHOLD } from "./lib-text.mjs";
import { carriesQuery } from "./lib-growth.mjs";
import { normPath } from "./lib-site.mjs";
import { pass, fail, runCli } from "./lib-plan.mjs";

export const id = "GT-001";
export const title = "targets-and-plan";
export const plain = "The research file is valid, and the plan covers every target with one page, one brief and sensible links";
export function run(ctx) {
  const bad = [], warn = [];
  // Signed files (approve.mjs, TR-235): a file changed after approval fails the lock; under --strict the launch gate needs both signed.
  const inp = ctx.inputs;
  if (inp.lock.exists) { for (const p of inp.lock.problems) bad.push(`L-001 lock: ${p}`); for (const s of inp.lock.stale) bad.push(`L-002 lock: ${s}`); }
  if (ctx.strict && !(inp.approved.targets && inp.approved.plan)) bad.push(`L-003 targets and plan are not both approved (approve.mjs targets, then plan-site.mjs, then approve.mjs plan): the launch gate needs signed files`);
  else if (!inp.approved.targets || !inp.approved.plan) warn.push(`WARN not approved yet (${inp.approved.targets ? "plan" : "targets and plan"}): the gate ran on the working files`);
  const vt = validate(ctx.targets), vb = validateBusiness(ctx.business);
  for (const e of [...vt.errors, ...vb.errors]) bad.push(`${e.rule} ${e.path}: ${e.message}`);
  const sm = ctx.sitemap, clusters = ctx.targets.clusters, pages = sm.pages;
  const seenPath = new Set();
  for (const p of pages) { if (seenPath.has(p.path)) bad.push(`P-001 two pages planned at ${p.path}`); seenPath.add(p.path); }
  for (const c of clusters) {
    const mine = pages.filter((p) => p.cluster === c.id);
    if (mine.length !== 1) bad.push(`P-002 cluster ${c.id} has ${mine.length} planned pages (one cluster = one page)`);
    else if (c.targetPage !== "new" && normPath(c.targetPage) !== mine[0].path) bad.push(`P-003 cluster ${c.id} keeps ${c.targetPage} but the plan puts it at ${mine[0].path}`);
  }
  for (const p of pages) if (p.cluster && !clusters.some((c) => c.id === p.cluster)) bad.push(`P-002 page ${p.path} names unknown cluster ${p.cluster}`);
  const briefs = ctx.briefs;
  for (const p of pages) {
    const b = briefs.get(p.path), c = clusters.find((x) => x.id === p.cluster);
    if (c) {
      if ((b.primaryQuery || "").toLowerCase() !== c.primaryQuery.toLowerCase()) bad.push(`P-004 ${p.path}: brief primary query "${b.primaryQuery}" differs from the cluster's "${c.primaryQuery}"`);
      for (const e of c.requiredEntities) if (!b.entities.some((x) => x.toLowerCase() === e.toLowerCase())) bad.push(`P-005 ${p.path}: brief lacks required entity "${e}"`);
      for (const q of c.questions) if (!b.questions.some((x) => x.toLowerCase() === q.toLowerCase())) bad.push(`P-005 ${p.path}: brief lacks question "${q}"`);
      // P-006 follows TR-231 (06-growth): the planned title and H1 contain the primary query's head term (or one of the cluster's queries); the meta description is held to the same rule because TGT-004 checks it on the built page. (Was: >= 80% token overlap.)
      for (const [name, text] of [["title", p.title], ["h1", p.h1], ["meta description", p.metaDescription]]) if (!carriesQuery(text, c, { locale: ctx.locale })) bad.push(`P-006 ${p.path}: planned ${name} does not carry the primary query "${c.primaryQuery}" (head term or one of the cluster's queries)`);
    }
    if (!b.outline.length) bad.push(`P-007 ${p.path}: brief has no outline`);
    for (const [name, text] of [["title", p.title], ["H1", p.h1]]) {
      const seg = String(text).split(/\s+[|\u2013\u2014-]\s+|:\s+/).map((x) => [...new Set(tokens(x))].sort().join(" ")).filter(Boolean);
      if (new Set(seg).size < seg.length) bad.push(`P-011 ${p.path}: planned ${name} repeats a segment ("${text}")`);
    }
    if (p.title.length > 60) warn.push(`WARN ${p.path}: planned title is ${p.title.length} characters (over 60)`);
    if (p.metaDescription.length > 160) warn.push(`WARN ${p.path}: planned meta description is ${p.metaDescription.length} characters (over 160)`);
  }
  const byPath = new Map(pages.map((p) => [p.path, p]));
  for (const l of sm.links) {
    const to = byPath.get(l.to);
    if (!byPath.has(l.from) || !to) { bad.push(`P-008 link ${l.from} -> ${l.to}: an end is not a planned page`); continue; }
    if (l.from === l.to) bad.push(`P-008 link ${l.from} points at itself`);
    if (isGenericAnchor(l.anchor)) bad.push(`P-009 link ${l.from} -> ${l.to}: generic anchor "${l.anchor}"`);
    else if (to.primaryQuery && overlap(to.primaryQuery, l.anchor) === 0) bad.push(`P-009 link ${l.from} -> ${l.to}: anchor "${l.anchor}" shares no content word with "${to.primaryQuery}"`);
  }
  for (const p of pages) if (p.path !== "/" && !sm.links.some((l) => l.to === p.path)) bad.push(`P-010 ${p.path} has no planned inbound link (orphan in the plan)`);
  if (bad.length) return fail(`${bad.length} problem(s) in targets or plan`, [...bad, ...warn]);
  return pass(`${clusters.length} clusters, ${pages.length} pages, ${sm.links.length} planned links consistent${inp.approved.targets && inp.approved.plan ? " (approved copy, lock ok)" : ""}`, warn);
}
runCli(import.meta.url, { id, run });
