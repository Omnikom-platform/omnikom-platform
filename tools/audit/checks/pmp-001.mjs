// PMP-001 (P0): the publish rule of the prompt map. Every row of the plan's coverage file (plan/prompt-coverage.json, written by the skill's plan stage) is
// answered by a built page or carries a written reason. The file is given, never searched for: audit(dir, { promptCoverage: FILE }), run.mjs --prompt-coverage.
// With no file the rule judges nothing and prints exactly ONE line, the site-wide `SKIP PMP-001 / no --prompt-coverage ...` (a check that did not run is never silent).
import { mk } from "../lib/check.mjs";
import { normPath } from "../lib/site.mjs";

export const id = "PMP-001";
export const severity = "P0";
export const source = "planning/DECISIONS.md 35 (the prompt map; owner, 2026-10-31)";
const f = mk(id);

// one subject per row (the row id); with no file the one site-wide subject "/" is added by the engine after the (empty) subjects; a file with no rows has "/"
export const subjects = (site) => (site.promptCoverage ? (site.promptCoverage.rows.length ? site.promptCoverage.rows.map((r) => r.id) : ["/"]) : []);

export function run(site) {
  const cov = site.promptCoverage;
  if (!cov) return [f.skip("/", "no --prompt-coverage, so the prompt map is not judged (give --prompt-coverage plan/prompt-coverage.json)")];
  const built = new Set(site.pageList.map((p) => p.path));
  const out = [];
  for (const row of cov.rows) {
    if (row.coveredBy === null) {
      if (!row.reason.trim()) out.push(f.fail(row.id, 1, `missing-element: row ${row.id} (${row.kind}) has no page (coveredBy is null) and no written reason, so a buyer's question is left unanswered`));
    } else if (!built.has(normPath(row.coveredBy))) {
      out.push(f.fail(row.id, 1, `missing-page: row ${row.id} (${row.kind}) says ${row.coveredBy} answers it, but the build has no page at ${normPath(row.coveredBy)}`));
    }
  }
  return out;
}
