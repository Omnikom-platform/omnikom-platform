// Usage: node checker-rules.mjs <url or profile:slug> [--cwd DIR]
// The checker step of audit-live by program (AB-7, parts AU.D-6 and SS.B-4): the measurable rules of tools/audit judge the run's newest complete snapshot, and every rule
// that has a defect becomes one root cause. No model, no network, no snapshot taken here: it reads the snapshot folder the snapshot step left.
//   {work}/checker/.checks/causes.json   the list report-live reads (the 9 keys merge.mjs writes, one cause per rule with a FAIL or a WARN)
//   {work}/checker/.checks/plan.json     { createdAt, snapshot: true, engine: { rulesRun, rulesInChecklist, pages }, slices: [], skipped: {}, families: [] }
//   {work}/checker/.checks/REPORT.md     its first line says it was written by program from <rulesRun> of <rulesInChecklist> rules, then one line per cause
// It never says the whole checklist was checked: the rules the program has are a part of the checklist, and the rest is not checked in a live audit.
// Exit 0: last line CHECKER: <c> causes from <f> findings, <rulesRun> of <rulesInChecklist> rules checked by program. Exit 3 (BLOCKED, nothing written, an older causes.json stays):
// no snapshot, the rule program is not there or throws, no checklist index. Exit 2: usage.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { makeVars } from "./lib-pipeline.mjs";
import { latestComplete } from "./live-target.mjs";

const USAGE = "usage: node checker-rules.mjs <url or profile:slug> [--cwd DIR]";
const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The program's words for a finding's status (tools/audit/index.mjs and its checks): FAIL, WARN and SKIP; a pass is no finding at all.
// FAIL and WARN are defects; SKIP (the rule could not judge) and every other word are not, and are left out.
const DEFECT = new Set(["FAIL", "WARN"]);
// the head's table: the program's severity word to the word causes.json and the report use
const SEVERITY = { P0: "critical", P1: "high", P2: "medium", W: "low" };
const ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

class Stop extends Error { constructor(message, exit) { super(message); this.exit = exit; } }
const blocked = (what, unblocks) => new Stop("BLOCKED: " + what + " | unblocks: " + unblocks, 3);

// the rule program, from the repository root two folders above the skill; the skill may be linked outside the repository
async function loadProgram(skillDir) {
  const file = path.join(skillDir, "..", "..", "tools", "audit", "index.mjs");
  if (!fs.existsSync(file)) throw blocked("the rule program is not here (" + file.replace(/\\/g, "/") + ")", "run this from a clone of the repository, where tools/audit/index.mjs is");
  try { const m = await import(pathToFileURL(file).href); return { audit: m.audit, listRules: m.listRules }; }
  catch (e) { throw blocked("the rule program failed (" + e.message + ")", "node tools/audit/run.mjs --help"); }
}

// the checklist: the count report-live reads from INDEX.md, and the rule's own text from its line ("- SEC-010 P1 [http, edge] text")
function checklist(skillDir) {
  const dirPath = path.join(skillDir, "checklist"), index = fs.existsSync(path.join(dirPath, "INDEX.md")) ? fs.readFileSync(path.join(dirPath, "INDEX.md"), "utf8") : "";
  const m = /shipgate spec ([\d.]+), (\d+) rules/.exec(index);
  if (!m) throw blocked("the checklist has no index with its rule count (" + path.join(dirPath, "INDEX.md").replace(/\\/g, "/") + ")", "restore skills/programmatic-enterprise-web-performance/checklist/INDEX.md");
  const text = new Map();
  for (const name of fs.readdirSync(dirPath).filter((x) => x.endsWith(".md") && x !== "INDEX.md")) {
    for (const line of fs.readFileSync(path.join(dirPath, name), "utf8").split(/\r?\n/)) {
      const l = /^- ([A-Z][A-Z0-9]*-\d+) (?:P0|P1|P2|W)\S*(?: \([^)]*\))? \[[^\]]*\] (.+)$/.exec(line);
      if (l && !text.has(l[1])) text.set(l[1], l[2].trim());
    }
  }
  return { total: Number(m[2]), text };
}

const idOf = (x) => x.rule + "@" + (x.page || "site") + (x.line === undefined || x.line === null ? "" : "#" + x.line);

// the program's result to the list of causes (and how many findings were defects): one per rule with a defect, sorted as merge.mjs sorts, numbered C01, C02, ...
function derive(res, list, texts) {
  if (!res || !Array.isArray(res.findings) || !Array.isArray(res.pages)) throw new Error("its result has no findings and pages");
  const sev = new Map([...list, ...(res.rules || [])].map((r) => [r.id, r.severity]));
  const byRule = new Map();
  for (const x of res.findings) if (DEFECT.has(x.status)) byRule.set(x.rule, [...(byRule.get(x.rule) || []), x]);
  const causes = [...byRule].map(([rule, mine]) => {
    const severity = SEVERITY[sev.get(rule)];
    if (!severity) throw new Error("rule " + rule + " has no severity of P0, P1, P2 or W");
    const ids = [...new Set(mine.map(idOf))], text = texts.get(rule);
    return {
      id: "", severity, rules: [rule], fixAt: ["platform"],
      problem: rule + ": " + mine[0].what + (ids.length > 1 ? " (and " + (ids.length - 1) + " more)" : ""),
      fix: text ? "Meet " + rule + ": " + text : "Meet " + rule,
      pages: new Set(mine.map((x) => x.page || "site")).size, findings: ids, scripts: [],
    };
  }).sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.pages - a.pages || b.findings.length - a.findings.length || a.rules[0].localeCompare(b.rules[0]));
  causes.forEach((c, i) => { c.id = "C" + String(i + 1).padStart(2, "0"); });
  return { causes, kept: [...byRule.values()].reduce((n, m) => n + m.length, 0) };
}

async function produce(argv, io) {
  const skillDir = io.skillDir || SKILL, key = argv[0];
  const at = argv.indexOf("--cwd");
  if (!key || key.startsWith("--") || (at >= 0 && (!argv[at + 1] || argv[at + 1].startsWith("--")))) throw new Stop(USAGE, 2);
  let vars;
  try { vars = makeVars({ url: key, client: "", skillDir, data: path.resolve(at >= 0 ? argv[at + 1] : process.cwd()) }); } catch (e) { throw new Stop(e.message + "\n" + USAGE, 2); }
  const snapshots = vars.runDir + "/snapshots", snap = latestComplete(snapshots);
  if (!snap) throw blocked("there is no snapshot of this site (" + snapshots + ")", "run the snapshot step first");
  const out = vars.work + "/checker/.checks", lines = checklist(skillDir);
  const program = io.audit && io.listRules ? { audit: io.audit, listRules: io.listRules } : await loadProgram(skillDir);
  let causes, kept, list, res;
  try { list = program.listRules(); res = await program.audit(snap.dir, {}); ({ causes, kept } = derive(res, list, lines.text)); }
  catch (e) { throw new Stop("BLOCKED: the rule program failed (" + e.message + ") | unblocks: node tools/audit/run.mjs --help", 3); }
  const said = list.length + " of " + lines.total + " rules";
  const plan = { createdAt: new Date().toISOString(), snapshot: true, engine: { rulesRun: list.length, rulesInChecklist: lines.total, pages: res.pages.length }, slices: [], skipped: {}, families: [] };
  const md = ["This list was written by program from " + said + " of the checklist, with no model; the rest of the checklist was not checked.",
    ...causes.map((c) => [c.id, c.severity, c.rules[0], c.pages + " page" + (c.pages === 1 ? "" : "s"), c.problem].join(" | "))].join("\n") + "\n";
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(out + "/causes.json", JSON.stringify(causes, null, 1) + "\n");
  fs.writeFileSync(out + "/plan.json", JSON.stringify(plan, null, 1) + "\n");
  fs.writeFileSync(out + "/REPORT.md", md);
  return "CHECKER: " + causes.length + " causes from " + kept + " findings, " + said + " checked by program";
}

// io: { audit, listRules, skillDir } stand in for the rule program and the skill folder (the test hands in an invented result); returns { code, line }
export async function checkerRules(argv, io = {}) {
  try { return { code: 0, line: await produce(argv, io) }; }
  catch (e) { if (!(e instanceof Stop)) throw e; return { code: e.exit, line: e.message }; }
}

if (isMain(import.meta.url)) {
  const r = await checkerRules(process.argv.slice(2));
  (r.code === 2 ? console.error : console.log)(r.line);
  process.exit(r.code);
}
