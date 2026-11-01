// The plan side of the prompt map (DECISIONS 35, slice 5b). Pure helpers shared by plan-site.mjs (routes every map row to a page brief, a new page or an off-site
// item, and writes plan/prompt-coverage.json and the comparison facts) and gate-prompt-coverage.mjs (GT-014, which re-reads what the planner wrote). The row and its
// validator are lib-prompt-map.mjs (5a); this file adds nothing to the row. Schema notes: schemas/prompt-map.md, "The plan's side". Node built-ins only.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateMap, rowsOf, squash, isIsoDate } from "./lib-prompt-map.mjs";

export const PROMPT_KINDS = ["situation", "comparison"]; // the planner kinds a new-page row creates (fix.pageType)
export const COVERAGE = "plan/prompt-coverage.json";
export const FACTS_FILE = "plan/comparison-facts.json";
export const PROMPTS_SECTION = "prompts this page answers"; // brief section names as parseBrief() lower-cases them
export const FACTS_SECTION = "facts about the other option";
export const NO_FACTS = "(no sourced facts yet: add them to plan/comparison-facts.json and plan again; until then the page makes no claim about the other option)";
export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const noBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s); // a UTF-8 BOM (PowerShell 5.1, Notepad) is not a JSON error
const nonEmpty = (s) => typeof s === "string" && squash(s) !== "";
export const mentionId = (row) => `mention-${row.id}`;

// code 1 = the input is invalid (nothing is written), 2 = cannot judge (a file is not JSON)
export class PromptMapError extends Error {
  constructor(message, code = 1, lines = []) { super(message); this.code = code; this.lines = lines; }
}

// ---- the map: approved/prompt-map.json when the owner signed it, else research/prompt-map.json ----
export function promptMapPath(pewp) {
  const a = path.join(pewp, "approved", "prompt-map.json"), r = path.join(pewp, "research", "prompt-map.json");
  if (fs.existsSync(a)) return { file: a, rel: "approved/prompt-map.json", approved: true };
  if (fs.existsSync(r)) return { file: r, rel: "research/prompt-map.json", approved: false };
  return null;
}
export function loadPromptMap(pewp, { today } = {}) {
  const src = promptMapPath(pewp);
  if (!src) return null;
  const buf = fs.readFileSync(src.file);
  let doc;
  try { doc = JSON.parse(noBom(buf.toString("utf8"))); } catch (e) { throw new PromptMapError(`${src.rel} is not valid JSON: ${e.message}`, 2); }
  const v = validateMap(doc, today ? { today } : {});
  if (!v.ok) throw new PromptMapError(`${src.rel} is invalid (${v.errors.length} error(s); run research-prompts.mjs <target> --check)`, 1, v.errors.slice(0, 10).map((e) => `${e.rule} ${e.id}: ${e.message}`));
  return { ...src, sha: sha256(buf), rows: rowsOf(doc) };
}

// ---- which row goes where ----
// planned: the set of page paths the plan already has (cluster pages, home, hub); norm: path normaliser. A row names a page that is not in the plan = a problem,
// never a silent drop: the session fixes the map (a new-page row, or the right path).
export function routeRows(rows, planned, norm) {
  const improve = [], create = [], mention = [], problems = [];
  for (const r of rows) {
    const f = r.fix;
    if (f.kind === "improve-page") {
      const p = norm(f.target);
      if (!planned.has(p)) problems.push(`${r.id}: improve-page target ${f.target} is not a page of the plan (pages: ${[...planned].sort().join(", ")}); fix the path or make it a new-page row`);
      else improve.push({ row: r, path: p });
    } else if (f.kind === "new-page") create.push(r);
    else {
      if (f.target !== "new" && !planned.has(norm(f.target))) problems.push(`${r.id}: earn-mention target ${f.target} is not a page of the plan; use "new" or a page the plan has`);
      mention.push(r);
    }
  }
  return { improve, create, mention, problems };
}

// ---- facts about the other option (comparison pages): every fact has a public source URL and a date, or the plan is refused ----
export const factLine = (f) => `${squash(f.fact)} | source: ${f.url} | date: ${f.date}`;
const FACT_LINE = /^(.+?) \| source: (https?:\/\/\S+) \| date: (\d{4}-\d{2}-\d{2})$/;
export function urlProblem(u) {
  if (typeof u !== "string" || !/^https?:\/\//i.test(u.trim())) return "no public source URL (an http or https address)";
  try { const h = new URL(u.trim()).hostname; if (!h.includes(".")) return `the source URL ${JSON.stringify(u)} has no real host`; } catch { return `the source URL ${JSON.stringify(u)} is not a URL`; }
  return null;
}
export function factProblems(f, today) {
  if (!f || typeof f !== "object" || Array.isArray(f)) return ["a fact is an object { fact, url, date }"];
  const out = [];
  if (!nonEmpty(f.fact)) out.push("the fact text is empty");
  else if (String(f.fact).includes("|")) out.push('the fact text holds a "|" (it separates the fact from its source in the brief); write it without');
  const u = urlProblem(f.url);
  if (u) out.push(u);
  if (!isIsoDate(f.date)) out.push(`no date (YYYY-MM-DD), got ${JSON.stringify(f.date)}`);
  else if (today && f.date > today) out.push(`the date ${f.date} is in the future`);
  return out;
}
// plan/comparison-facts.json: { "facts": { "<row id>": [ { "fact", "url", "date" } ] } }. Hand-filled from public pages, never overwritten by the planner.
export function loadFacts(pewp, comparisonIds, today) {
  const f = path.join(pewp, FACTS_FILE);
  if (!fs.existsSync(f)) return new Map();
  let doc;
  try { doc = JSON.parse(noBom(fs.readFileSync(f, "utf8"))); } catch (e) { throw new PromptMapError(`${FACTS_FILE} is not valid JSON: ${e.message}`, 2); }
  const facts = doc && typeof doc === "object" && !Array.isArray(doc) && doc.facts && typeof doc.facts === "object" && !Array.isArray(doc.facts) ? doc.facts : null;
  if (!facts) throw new PromptMapError(`${FACTS_FILE} is { "facts": { "<row id>": [ { "fact", "url", "date" } ] } }`, 1);
  const lines = [], out = new Map();
  for (const [id, list] of Object.entries(facts)) {
    if (!comparisonIds.has(id)) { lines.push(`${id}: facts for a row that is not a new-page comparison row of the map (comparison rows: ${[...comparisonIds].join(", ") || "none"})`); continue; }
    if (!Array.isArray(list)) { lines.push(`${id}: facts is a list`); continue; }
    list.forEach((x, i) => { for (const p of factProblems(x, today)) lines.push(`${id} fact ${i + 1}: ${p}`); });
    out.set(id, list);
  }
  if (lines.length) throw new PromptMapError(`${FACTS_FILE} holds ${lines.length} refused fact line(s): a claim about the other option needs a public source URL and a date`, 1, lines.slice(0, 12));
  return out;
}
// The fact lines of a written brief (the gate re-checks them: a hand edit of a brief must not smuggle in a claim). Returns { problems, facts, placeholder }.
export function briefFactProblems(lines, today) {
  const problems = []; let facts = 0, placeholder = false;
  for (const l of lines) {
    if (l === NO_FACTS) { placeholder = true; continue; }
    const m = l.match(FACT_LINE);
    if (!m) { problems.push(`a fact line without a public source URL and a date: ${JSON.stringify(l.slice(0, 90))}`); continue; }
    const bad = factProblems({ fact: m[1], url: m[2], date: m[3] }, today);
    if (bad.length) problems.push(`${bad.join("; ")}: ${JSON.stringify(l.slice(0, 90))}`); else facts++;
  }
  return { problems, facts, placeholder };
}

// ---- plan/prompt-coverage.json ----
// rows: the map rows; pathOf: Map row id -> the planned page that answers it (improve-page and new-page rows). A row with no page carries the reason; an earn-mention row's
// reason names its item in plan/offsite.json.
export function coverageDoc({ today, mapRel, sha, rows, pathOf }) {
  return {
    version: 1, generatedAt: today, map: sha, mapFile: mapRel,
    rows: rows.map((r) => ({
      id: r.id, coveredBy: pathOf.get(r.id) ?? null, kind: r.fix.kind,
      reason: r.fix.kind === "earn-mention" ? `off-site item ${mentionId(r)} in plan/offsite.json: ${squash(r.fix.note)}` : squash(r.fix.note),
    })),
  };
}
