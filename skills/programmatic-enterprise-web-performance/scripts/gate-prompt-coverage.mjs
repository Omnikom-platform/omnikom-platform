// GT-014 prompt-rows-covered (DECISIONS 35, slice 5b), a sibling of GT-011: every row of the prompt map (research/prompt-map.json, or the approved copy) is answered by a page
// of the plan that is built, or carries a written reason why not. plan-site.mjs writes plan/prompt-coverage.json ({ map: sha256 of the map file, rows: [{ id, coveredBy, kind, reason }] });
// this check re-reads it against the map, the page plan, the briefs and the built site:
//   - no map and no coverage file: nothing to cover, PASS (said in the summary). A map with no coverage file, a coverage file made for another version of the map, a row the file
//     does not list: FAIL (run plan-site.mjs again). A coverage file with no map: cannot judge (exit 2).
//   - a row with `coveredBy: null` and no `reason`: FAIL (the point of the check). With a reason it passes and is listed as a WARN; an earn-mention row also needs its item in plan/offsite.json.
//   - a row covered by a path that is not a page of the plan, whose brief does not list the row id under "Prompts this page answers", or that is not built (200): FAIL. A snapshot sample that
//     lacks the page cannot judge it (exit 2), exactly as GT-002 and GT-011 do.
//   - a comparison page's brief: every line under "Facts about the other option" carries a public source URL and a date, or the page makes no claim yet (WARN).
// Exit 0 PASS, 1 FAIL, 2 cannot judge.
import fs from "node:fs";
import path from "node:path";
import { pass, fail, error, readJson, cannot, runCli } from "./lib-plan.mjs";
import { validateMap, rowsOf } from "./lib-prompt-map.mjs";
import { promptMapPath, sha256, COVERAGE, PROMPTS_SECTION, FACTS_SECTION, briefFactProblems } from "./lib-prompt-plan.mjs";

export const id = "GT-014";
export const title = "prompt-rows-covered";
export const plain = "Every question buyers ask has a page that answers it, or a written reason why not";
const nonEmpty = (s) => typeof s === "string" && s.trim() !== "";
export function run(ctx) {
  const src = promptMapPath(ctx.pewp), covFile = path.join(ctx.inputs.planRoot, COVERAGE), hasCov = fs.existsSync(covFile);
  if (!src && !hasCov) return pass("no prompt map in this project (research/prompt-map.json): no prompt rows to cover");
  if (!src) return cannot(`${COVERAGE} exists but there is no research/prompt-map.json or approved/prompt-map.json to compare it with`);
  const buf = fs.readFileSync(src.file);
  let doc; try { doc = JSON.parse(buf.toString("utf8").replace(/^﻿/, "")); } catch (e) { return cannot(`${src.rel} is not valid JSON: ${e.message}`); }
  const v = validateMap(doc);
  if (!v.ok) return cannot(`${src.rel} is invalid (${v.errors.length} error(s), e.g. ${v.errors[0].rule} ${v.errors[0].id}); run research-prompts.mjs <target> --check`);
  const rows = rowsOf(doc);
  if (!hasCov) return fail(`${rows.length} prompt row(s) in ${src.rel} but ${COVERAGE} does not exist`, [`${COVERAGE} is missing: run plan-site.mjs (the plan has not answered the prompt map yet)`]);
  const cov = readJson(covFile, COVERAGE);
  if (!cov || typeof cov !== "object" || typeof cov.map !== "string" || !Array.isArray(cov.rows)) return fail(`${COVERAGE} has the wrong shape`, [`${COVERAGE} is { "map": "<sha256>", "rows": [ { "id", "coveredBy", "kind", "reason" } ] }: run plan-site.mjs`]);

  const sm = ctx.sitemap, planned = new Map(sm.pages.map((p) => [p.path, p]));
  const bad = [], warn = [], byId = new Map(cov.rows.map((r) => [r && r.id, r]));
  const sha = sha256(buf);
  if (cov.map !== sha) bad.push(`STALE ${COVERAGE} was made for ${src.rel} ${cov.map.slice(0, 8)}, the map is now ${sha.slice(0, 8)}: run plan-site.mjs again`);
  let site = null, offsite = null, withPage = 0, withReason = 0;
  const unseen = [];
  for (const r of rows) {
    const c = byId.get(r.id), tag = `${r.id} "${String(r.prompt).slice(0, 70)}"`;
    if (!c) { bad.push(`${tag}: not in ${COVERAGE}, so the plan does not cover it`); continue; }
    if (c.coveredBy == null) {
      if (!nonEmpty(c.reason)) { bad.push(`${tag}: no page and no reason (coveredBy is null and reason is empty); answer it with a page, or write why it is not`); continue; }
      withReason++;
      if (r.fix?.kind === "earn-mention") {
        offsite ||= readJson(path.join(ctx.inputs.planRoot, "plan", "offsite.json"), "plan/offsite.json");
        if (!(offsite.promptMentions || []).some((m) => m && m.promptId === r.id)) bad.push(`${tag}: an earn-mention row, but plan/offsite.json has no item for it (promptMentions): run plan-site.mjs`);
      } else warn.push(`WARN ${tag}: not covered by a page, written reason: ${c.reason.trim().slice(0, 140)}`);
      continue;
    }
    const pg = planned.get(c.coveredBy);
    if (!pg) { bad.push(`${tag}: covered by ${c.coveredBy}, which is not a page of the plan`); continue; }
    const b = ctx.briefs.get(c.coveredBy), listed = (b?.sections[PROMPTS_SECTION] || []).map((l) => l.split(" | ")[0].trim());
    if (!listed.includes(r.id)) { bad.push(`${tag}: covered by ${c.coveredBy}, but its brief does not list ${r.id} under "Prompts this page answers"`); continue; }
    site ||= ctx.site;
    const built1 = site.pages.get(c.coveredBy);
    if (!built1) { (site.complete ? bad : unseen).push(`${tag}: covered by ${c.coveredBy}, ${site.complete ? "but no page is built there" : "which is not in the snapshot sample"}`); continue; }
    if (built1.status !== 200) { bad.push(`${tag}: covered by ${c.coveredBy}, which answers ${built1.status}, not 200`); continue; }
    withPage++;
  }
  for (const c of cov.rows) if (c && !rows.some((r) => r.id === c.id)) bad.push(`${c.id}: in ${COVERAGE} but not in ${src.rel} (a row that is gone, or a wrong id)`);
  // comparison pages: no claim about the other option without a public source URL and a date
  const today = new Date().toISOString().slice(0, 10);
  for (const p of sm.pages.filter((x) => x.kind === "comparison")) {
    const lines = ctx.briefs.get(p.path)?.sections[FACTS_SECTION];
    if (!lines) { bad.push(`${p.path}: a comparison page whose brief has no "Facts about the other option" section`); continue; }
    const f = briefFactProblems(lines, today);
    for (const pr of f.problems) bad.push(`${p.path}: ${pr}`);
    if (!f.facts && !f.problems.length) warn.push(`WARN ${p.path}: a comparison page with no sourced fact about the other option yet (the page may make no claim about it)`);
  }
  if (bad.length) return fail(`${bad.length} problem(s) with the prompt map's coverage (${rows.length} row(s))`, bad);
  if (unseen.length) return error(`${unseen.length} covering page(s) not in the snapshot sample`, unseen);
  return pass(`${rows.length} prompt row(s) covered: ${withPage} by a built page, ${withReason} with a written reason`, warn);
}
runCli(import.meta.url, { id, run });
