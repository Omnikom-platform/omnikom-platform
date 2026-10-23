// S5 target gate: runs every gate-*.mjs check against <pewp>/targets.json + plan/ and a built site folder (or a live snapshot).
// Usage: node gate.mjs <pewp dir> <site dir> [--strict] [--waive ID,ID] [--only GT-003,GT-004] [--no-report] [--out DIR] [--no-state] [--rules-dir DIR] [--priority-pages N] [--build "<cmd>" [--build-cwd DIR] [--setup "<cmd>"]]
// --out DIR writes report.md/report.json there instead of <pewp>/gate/ and never touches state.json (a builder may write only site/ and .pewp/builder/).
// Prints one first line per check (PASS / FAIL / ERROR <id> <summary>) with indented details, writes <pewp>/gate/report.md
// (plain words, for the owner) and report.json (every check, status, details). Exit 0 all PASS, 1 any FAIL, 2 none failed but
// a check could not judge. --strict turns WARN items (launch blockers such as disclosure pages) into FAIL.
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCtx, execute, formatResult, exitCode } from "./lib-plan.mjs";
import * as targets from "./gate-targets.mjs";
import * as clusters from "./gate-clusters.mjs";
import * as cannibal from "./gate-cannibalisation.mjs";
import * as queryMatch from "./gate-query-match.mjs";
import * as brief from "./gate-brief.mjs";
import * as links from "./gate-links.mjs";
import * as orphans from "./gate-orphans.mjs";
import * as schema from "./gate-schema.mjs";
import * as programmatic from "./gate-programmatic.mjs";
import * as industry from "./gate-industry.mjs";
import * as coverage from "./gate-coverage.mjs";
import * as intentFit from "./gate-intent-fit.mjs";
import * as freshness from "./gate-freshness.mjs";
import * as state from "./state.mjs";

export const CHECKS = [targets, clusters, cannibal, queryMatch, brief, links, orphans, schema, programmatic, industry, coverage, intentFit, freshness];
const GLOSSARY = [
  ["cannibalisation", "two pages of one site competing for the same search, so neither ranks well"],
  ["orphan page", "a page no other page links to, so visitors and search engines rarely find it"],
  ["schema", "structured data in the page that tells search engines and AI answers what the page is"],
  ["programmatic page", "a page generated from a template and a data table, such as one page per town"],
];

export function gate(pewp, siteDir, opts = {}) {
  const ctx = loadCtx(pewp, siteDir, opts);
  const only = opts.only ? new Set(opts.only) : null;
  const results = CHECKS.filter((c) => !only || only.has(c.id)).map((c) => ({ id: c.id, name: c.title, plain: c.plain, ...execute(c, ctx) }));
  const status = results.some((r) => r.status === "FAIL") ? "FAIL" : results.some((r) => r.status === "ERROR") ? "ERROR" : "PASS";
  return { status, results, strict: !!opts.strict, inputs: { approvedTargets: ctx.inputs.approved.targets, approvedPlan: ctx.inputs.approved.plan, lockOk: ctx.inputs.lock.ok, approvedBy: ctx.inputs.lock.lock?.targets?.approvedBy || null, approvedAt: ctx.inputs.lock.lock?.targets?.approvedAt || null } };
}

export function reportMd(g, meta) {
  const word = { PASS: "passes", FAIL: "FAILS", ERROR: "could not be judged" };
  const nf = g.results.filter((r) => r.status === "FAIL").length, ne = g.results.filter((r) => r.status === "ERROR").length;
  const L = [`# Site gate: ${g.status === "PASS" ? "the built site matches the plan" : g.status === "FAIL" ? `the built site does not match the plan (${nf} check${nf > 1 ? "s" : ""} failed)` : `could not be fully judged (${ne} check${ne > 1 ? "s" : ""})`}`, "",
    `Checked ${meta.site} against the plan in ${meta.pewp} on ${meta.ranAt.slice(0, 10)}${g.strict ? " (strict: launch blockers count as failures)" : ""}.`, g.inputs.approvedTargets && g.inputs.approvedPlan ? `Plan inputs: the approved copy, signed by ${g.inputs.approvedBy} on ${String(g.inputs.approvedAt).slice(0, 10)}${g.inputs.lockOk ? "" : " (the lock check FAILS: a signed file changed)"}.` : "Plan inputs: working files, not approved yet.", "",
    "| Check | What it asks | Result |", "|---|---|---|", ...g.results.map((r) => `| ${r.id} ${r.name} | ${r.plain} | ${word[r.status]}: ${r.summary} |`), ""];
  const bad = g.results.filter((r) => r.status !== "PASS");
  if (bad.length) {
    L.push("## What to fix, check by check", "");
    for (const r of bad) { L.push(`### ${r.id} ${r.name}`, "", ...r.details.filter((d) => !/^(NOTE|WARN)/.test(d)).slice(0, 25).map((d) => `- ${d}`), ""); }
  }
  const warn = g.results.flatMap((r) => r.details.filter((d) => d.startsWith("WARN")).map((d) => `${r.id} ${d}`));
  if (warn.length) L.push("## Warnings (not failures)", "", ...warn.map((w) => `- ${w}`), "");
  const text = L.join("\n");
  const used = GLOSSARY.filter(([t]) => new RegExp(t, "i").test(text) || g.results.some((r) => r.plain.toLowerCase().includes(t.split(" ")[0])));
  if (used.length) L.push("## Words used", "", ...used.map(([t, d]) => `- ${t}: ${d}.`), "");
  return L.join("\n");
}

// Writes report.md + report.json (default <pewp>/gate/) and marks the gate stage in state.json. With out (a builder may write only
// site/ and .pewp/builder/) the report goes there and state.json is not touched; noState also skips the state write.
export function emit(g, pewpDir, siteDir, { out = null, noState = false } = {}) {
  const meta = { pewp: path.resolve(pewpDir), site: path.resolve(siteDir), ranAt: new Date().toISOString() };
  const dir = out ? path.resolve(out) : path.join(meta.pewp, "gate");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "report.md"), reportMd(g, meta));
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify({ ...meta, strict: g.strict, inputs: g.inputs, status: g.status, checks: g.results.map(({ id, name, status, summary, details }) => ({ id, name, status, summary, details })) }, null, 1) + "\n");
  try { if (!out && !noState && fs.existsSync(path.join(meta.pewp, "state.json"))) state.markStage(state.locate(path.dirname(meta.pewp)), "gate", { report: "gate/report.md", json: "gate/report.json" }, { status: g.status }); } catch {}
  return dir;
}

function main() {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
  const pos = a.filter((x, i) => !x.startsWith("--") && !["--waive", "--only", "--rules-dir", "--out", "--priority-pages", "--build", "--build-cwd", "--setup"].includes(a[i - 1]));
  // (the usage text is single-quoted: inside double quotes the "<cmd>" ended the string and the line crashed with "cmd is not defined", exit 1)
  if (pos.length < 2) { console.error('usage: node gate.mjs <pewp dir> <site dir> [--strict] [--waive ID,ID] [--only GT-003,...] [--no-report] [--out DIR] [--no-state] [--rules-dir DIR] [--priority-pages N] [--build "<cmd>" [--build-cwd DIR] [--setup "<cmd>"]]'); process.exit(2); }
  const g = gate(pos[0], pos[1], { strict: a.includes("--strict"), waive: opt("--waive")?.split(",") || [], only: opt("--only")?.split(","), rulesDir: opt("--rules-dir") || undefined, priorityPages: opt("--priority-pages") != null ? Number(opt("--priority-pages")) : undefined, build: opt("--build"), buildCwd: opt("--build-cwd"), setup: opt("--setup") });
  for (const r of g.results) console.log(formatResult(r.id, r));
  const counts = g.results.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});
  console.log(`${g.status} gate ${g.results.length} checks: ${counts.PASS || 0} PASS, ${counts.FAIL || 0} FAIL, ${counts.ERROR || 0} ERROR`);
  if (!a.includes("--no-report")) {
    const dir = emit(g, pos[0], pos[1], { out: opt("--out"), noState: a.includes("--no-state") });
    console.log(`report: ${path.join(dir, "report.md")}`);
  }
  process.exit(exitCode(g.status));
}
if (isMain(import.meta.url)) main(); // real-path compare: started through a junction the gate used to exit 0 with no output
