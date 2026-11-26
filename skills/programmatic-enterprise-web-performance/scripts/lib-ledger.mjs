// The rule ledger: one row per rule of the checklist, what a slice said about it, and how the slices are combined.
// Used by merge.mjs (audit-repo), checker-rules.mjs (audit-live) and test-ledger.mjs. No network, no model.
//   readChecklist(dir)       the rules (lines of <pack>.md that match RULE_LINE) and whether the checklist is BROKEN
//   parseVerdicts(text, ck)  one worker's .checks/verdicts/<slice>.tsv: valid verdicts, invalid lines, rules with no line
//   combine(parts, ...)      the verdicts of every slice for one rule: FAIL > WARN > PASS > N/A > BLOCKED > NOT CHECKED (VTV-PROOF T1); a slice's
//                            PASS or N/A beats another slice's NOT CHECKED only on a rule with no html, http or browser kind, or with a check
//                            script whose first line is "<n> pages" equal to the root's page count; else WARN "sampled N of M"
//   citeProblem(ev, ...)     T2: each path:N exists with N within the file and a quote (at most 80 characters, in double quotes) found on line N
//   isBlocked / proofProblems  T4: the BLOCKED reason and what merge --proof (and proof-gates G2) refuse
//   pageKind / pageList      a rule with an html, http or browser kind; a root's pages (snapshot pages/<slug>/, else .html files)
//   finishLedger / ledgerLine / ledgerMd / writeLedger / ledgerProblems
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CHECKLIST_DIR = path.join(HERE, "..", "checklist");
// "- SEC-010 P1 [http, edge] text", "- SEC-011 P0† [..]", "- GT-003 P1 (part x W) [..]"
export const RULE_LINE = /^- ([A-Z][A-Z0-9]{1,4}-\d{3}) (P0|P1|P2|W)†?[ (]/;
export const RULE_ID = /\b[A-Z][A-Z0-9]{1,4}-\d{3}\b/g;
export const VERDICTS = ["PASS", "FAIL", "WARN", "NOT CHECKED", "N/A"];
const NEEDS_EVIDENCE = new Set(["PASS", "FAIL", "WARN"]);
// evidence: a file:line it looked at (path:12) or a check script and its exit (check-s01-03.mjs exit 0)
const FILE_LINE = /(?<![\w/:])[\w@+.\/\\-]*[A-Za-z][\w@+.\/\\-]*:\d+\b/;
const SCRIPT_EXIT = /\bcheck-[\w.+-]+\.mjs exit \d+\b/;
export const evidenceOk = (s) => FILE_LINE.test(s) || SCRIPT_EXIT.test(s);
export const SCRIPT_EXITS = /\b(check-[\w.+-]+\.mjs) exit (\d+)\b/g;
export const kindsOf = (r) => ((/\[([^\]]*)\]/.exec(r.text) || [])[1] || "").split(/,\s*/).filter(Boolean);
export const pageKind = (r) => kindsOf(r).some((k) => k === "html" || k === "http" || k === "browser");

// The pages of a root, sorted: a snapshot's pages/<slug>/ folders, else every .html file outside .checks, _source, node_modules and .git.
export function pageList(root) {
  const snap = path.join(root, "pages");
  const snapPages = fs.existsSync(snap) && fs.statSync(snap).isDirectory() ? fs.readdirSync(snap, { withFileTypes: true }).filter((d) => d.isDirectory() && ["body.html", "head.html", "response.json"].some((f) => fs.existsSync(path.join(snap, d.name, f)))) : [];
  if (snapPages.length) return snapPages.map((d) => "pages/" + d.name).sort();
  const out = [], walk = (d, rel) => { for (const x of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
    if (x.isDirectory()) { if (![".checks", "_source", "node_modules", ".git"].includes(x.name)) walk(path.join(d, x.name), rel + x.name + "/"); }
    else if (/\.html?$/i.test(x.name)) out.push(rel + x.name);
  } };
  walk(root, "");
  return out.sort();
}

// T2: why the file:line citations of an evidence text do not hold (null = they hold). Each path:N is followed by a quote of at most 80 characters
// in double quotes that occurs on line N of that file under root. The quote may hold double quotes: it ends at a double quote followed by the end,
// a space, ";" or ",", and the longest such quote found on the line is taken (so made-up text after an inner quote does not pass). With a _source folder in the root
// (root A), a script or style outside it is a bundle: cite _source.
const CITE = /(?<![\w/:])([\w@+.\/\\-]*[A-Za-z][\w@+.\/\\-]*):(\d+)\b/g;
export function citeProblem(ev, root) {
  const s = String(ev);
  CITE.lastIndex = 0;
  for (let m; (m = CITE.exec(s)); ) {
    const [all, p, nStr] = m, n = Number(nStr), rel = p.replace(/\\/g, "/").replace(/^\.\//, ""), f = path.resolve(root, rel);
    if (/\.(m?js|cjs|css)$/i.test(rel) && !rel.startsWith("_source/") && fs.existsSync(path.join(root, "_source"))) return all + " is a bundle or a built file: cite the _source file";
    if (path.relative(root, f).startsWith("..") || !fs.existsSync(f) || !fs.statSync(f).isFile()) return p + " does not exist under the root";
    const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
    if (n < 1 || n > lines.length) return all + " is past the end of the file (" + lines.length + " lines)";
    const rest = s.slice(m.index + all.length);
    const q = /^\s+"/.exec(rest);
    if (!q) return all + " has no quote of its line in double quotes";
    const body = rest.slice(q[0].length);
    let found = -1, closes = 0;
    for (let i = 1; i <= Math.min(80, body.length - 1); i++) if (body[i] === '"' && (i + 1 >= body.length || /[\s;,]/.test(body[i + 1]))) { closes++; if (lines[n - 1].includes(body.slice(0, i))) found = i; }
    if (found < 0) return closes ? "the quote after " + all + " is not on that line" : "the quote after " + all + " is longer than 80 characters or not closed";
    CITE.lastIndex = m.index + all.length + q[0].length + found + 1;
  }
  return null;
}

// T4: a NOT CHECKED reason that is BLOCKED: "BLOCKED: <what> | unblocks: <who or what> | tried: <a>; <b>", each approach holding "exit N" or path:N.
const BLOCKED = /^BLOCKED: [^|]+ \| unblocks: [^|]+ \| tried: .+;.+/;
export const isBlocked = (reason) => BLOCKED.test(reason) && String(reason).split("| tried: ")[1].split(";").filter((t) => t.trim()).length >= 2
  && String(reason).split("| tried: ")[1].split(";").filter((t) => t.trim()).every((t) => /exit \d+|\S:\d+/.test(t));
export const TOOLS_WE_HAVE = /psi|crux|with-env|chrome|vantage|search console|gsc|cloudflare/i;
// rows: the ledger rows; allowed: the ids of <proof>/head/blocked-allowed.tsv. Returns { problems: [...], blocked: [ids] }.
export function proofProblems(rows, allowed) {
  const problems = [], blocked = [];
  for (const r of rows.filter((x) => x.verdict === "NOT CHECKED")) {
    if (!isBlocked(r.evidence)) { problems.push(r.rule + " is NOT CHECKED and not BLOCKED"); continue; }
    blocked.push(r.rule);
    const unblocks = r.evidence.split("| unblocks: ")[1].split(" | tried: ")[0];
    if (TOOLS_WE_HAVE.test(unblocks)) problems.push(r.rule + " is BLOCKED on a tool we have (" + unblocks.trim().slice(0, 60) + ")");
    if (!allowed.has(r.rule)) problems.push(r.rule + " is BLOCKED but not in head/blocked-allowed.tsv");
  }
  return { problems, blocked };
}

// The checklist: the pack files, and INDEX.md's heading total and per-pack counts. BROKEN (problems non-empty) when they disagree
// or an id is repeated.
export function readChecklist(dir = CHECKLIST_DIR) {
  const problems = [], rules = [], byId = new Map(), packs = {}, indexPacks = {};
  let indexTotal = null;
  const idx = path.join(dir, "INDEX.md");
  if (!fs.existsSync(idx)) problems.push("INDEX.md is missing");
  else {
    const text = fs.readFileSync(idx, "utf8").replace(/^﻿/, "");
    const h = /^#[^\n]*?(\d+) rules/m.exec(text);
    if (h) indexTotal = Number(h[1]); else problems.push("INDEX.md has no heading with the rule total");
    for (const line of text.split(/\r?\n/)) { const m = /^- ([a-z0-9-]+): (\d+) rules\s*$/.exec(line); if (m) indexPacks[m[1]] = Number(m[2]); }
  }
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith(".md") && x !== "INDEX.md").sort() : [];
  for (const name of files) {
    const pack = name.replace(/\.md$/, "");
    packs[pack] = 0;
    for (const line of fs.readFileSync(path.join(dir, name), "utf8").split(/\r?\n/)) {
      const m = RULE_LINE.exec(line);
      if (!m) continue;
      packs[pack]++;
      if (byId.has(m[1])) { problems.push("rule " + m[1] + " is in the checklist twice (" + byId.get(m[1]).pack + " and " + pack + ")"); continue; }
      const r = { id: m[1], grade: m[2], pack, text: line.slice(m[0].length) };
      rules.push(r); byId.set(r.id, r);
    }
  }
  for (const p of new Set([...Object.keys(indexPacks), ...Object.keys(packs)])) {
    if (!(p in packs)) problems.push("pack " + p + ": INDEX.md lists it, there is no " + p + ".md");
    else if (!(p in indexPacks)) problems.push("pack " + p + ": " + p + ".md is not in INDEX.md");
    else if (indexPacks[p] !== packs[p]) problems.push("pack " + p + ": INDEX.md says " + indexPacks[p] + " rules, the file has " + packs[p] + " rule lines");
  }
  const sum = Object.values(indexPacks).reduce((a, b) => a + b, 0);
  if (indexTotal !== null && indexTotal !== sum) problems.push("INDEX.md heading says " + indexTotal + " rules, its pack lines add up to " + sum);
  if (indexTotal !== null && indexTotal !== rules.length) problems.push("INDEX.md heading says " + indexTotal + " rules, the packs hold " + rules.length + " distinct rule lines");
  return { dir, rules, byId, packs, indexPacks, indexTotal, problems, broken: problems.length > 0 };
}

// One worker's verdict file. Returns { valid: Map id -> {verdict, evidence}, invalid: [{ id, reason }], missing: [ids with no line at all] }.
// A line is INVALID when the id is not in the checklist, the verdict is not one of the five words, the third column is empty, PASS/FAIL/WARN
// has no evidence of the right shape, or the same id has two different verdicts.
export function parseVerdicts(text, ck) {
  const entries = [];
  String(text).replace(/^﻿/, "").split(/\r?\n/).forEach((ln, i) => {
    if (!ln.trim()) return;
    const cells = ln.split("\t"), id = cells[0].trim(), verdict = (cells[1] || "").trim(), ev = cells.slice(2).join(" ").trim();
    let why = null;
    if (!ck.byId.has(id)) why = "id " + id.slice(0, 20) + " is not in the checklist";
    else if (!VERDICTS.includes(verdict)) why = id + ": verdict \"" + verdict.slice(0, 20) + "\" is not one of PASS, FAIL, WARN, NOT CHECKED, N/A";
    else if (!ev) why = id + ": " + verdict + " has no " + (NEEDS_EVIDENCE.has(verdict) ? "evidence" : "reason");
    else if (NEEDS_EVIDENCE.has(verdict) && !evidenceOk(ev)) why = id + ": " + verdict + " has no evidence of the shape path:12 or check-x.mjs exit 0";
    entries.push({ id, verdict, ev, why, n: i + 1 });
  });
  const by = new Map();
  for (const e of entries) by.set(e.id, [...(by.get(e.id) || []), e]);
  const valid = new Map(), invalid = [];
  for (const [id, list] of by) {
    const words = new Set(list.filter((e) => VERDICTS.includes(e.verdict) && ck.byId.has(id)).map((e) => e.verdict));
    if (words.size > 1) { invalid.push({ id, reason: id + ": given twice with different verdicts" }); continue; }
    for (const e of list) if (e.why) invalid.push({ id, reason: e.why });
    const good = list.find((e) => !e.why);
    if (good) valid.set(id, { verdict: good.verdict, evidence: good.ev });
  }
  const missing = ck.rules.filter((r) => !by.has(r.id)).map((r) => r.id);
  return { valid, invalid, missing };
}

// parts: one per slice { slice, state: "valid" | "invalid" | "missing", verdict, evidence, reason }; findingIds: the non-rejected findings whose first rule id is this rule.
// Returns null (no row: no slice gave a valid verdict and no finding names the rule) or { verdict, evidence }.
// opts: { page: the rule has an html, http or browser kind; cover(part) -> { n: the "<n> pages" of a script the part cites, m: its root's page count } or null }
export function combine(parts, findingIds, grade, opts = {}) {
  const valid = parts.filter((p) => p.state === "valid");
  if (!valid.length && !findingIds.length) return null;
  const ev = (list) => [...list.map((p) => p.evidence).filter(Boolean).slice(0, 3), ...(findingIds.length ? ["findings " + findingIds.join(", ")] : [])].join("; ");
  const of = (v) => valid.filter((p) => p.verdict === v);
  if (of("FAIL").length || findingIds.length) return { verdict: grade === "W" ? "WARN" : "FAIL", evidence: ev(of("FAIL")) };
  if (of("WARN").length) return { verdict: "WARN", evidence: ev(of("WARN")) };
  const broken = parts.filter((p) => p.state !== "valid"), nc = of("NOT CHECKED"), good = [...of("PASS"), ...of("N/A")];
  if (!broken.length && nc.length && good.length) {
    const ncWhy = nc.map((p) => "NOT CHECKED by " + p.slice + ": " + p.evidence).join("; ");
    const win = of("PASS").length ? "PASS" : "N/A", wins = of(win);
    if (!opts.page) return { verdict: win, evidence: ev(wins) };
    const cov = wins.map((p) => (opts.cover ? opts.cover(p) : null)).filter(Boolean).sort((a, b) => b.n - a.n);
    const full = cov.find((c) => c.n > 0 && c.n === c.m);
    if (full) return { verdict: win, evidence: ev(wins) + "; covers " + full.n + " of " + full.m + " pages" };
    const of2 = cov.length ? cov[0].n + " of " + cov[0].m + " pages" : good.length + " of " + (good.length + nc.length) + " slices";
    return { verdict: "WARN", evidence: "sampled " + of2 + "; " + ncWhy + "; passed in " + wins.map((p) => p.slice + ": " + p.evidence).join("; ") };
  }
  if (!broken.length && nc.length) { const b = nc.find((p) => isBlocked(p.evidence)); if (b) return { verdict: "NOT CHECKED", evidence: b.evidence }; }
  const bad = parts.filter((p) => p.state !== "valid" || p.verdict === "NOT CHECKED");
  if (bad.length) {
    const why = bad.map((p) => (p.state === "missing" ? "no verdict from " + p.slice : p.state === "invalid" ? "invalid line from " + p.slice + (p.reason ? ": " + p.reason : "") : "NOT CHECKED by " + p.slice + ": " + p.evidence));
    const passed = of("PASS").map((p) => p.slice);
    return { verdict: "NOT CHECKED", evidence: why.join("; ") + (passed.length ? "; passed in " + passed.join(", ") : "") };
  }
  if (of("PASS").length) return { verdict: "PASS", evidence: ev(of("PASS")) };
  return { verdict: "N/A", evidence: of("N/A").map((p) => p.slice + ": " + p.evidence).join("; ") };
}

// rows: [{ rule, verdict, evidence }] (grade and pack are filled from the checklist). slices: the per-slice report of merge.mjs.
export function finishLedger(ck, rows, slices = {}) {
  const full = rows.map((r) => ({ rule: r.rule, grade: ck.byId.get(r.rule).grade, pack: ck.byId.get(r.rule).pack, verdict: r.verdict, evidence: r.evidence }));
  const order = new Map(ck.rules.map((r, i) => [r.id, i]));
  full.sort((a, b) => order.get(a.rule) - order.get(b.rule));
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, full.filter((r) => r.verdict === v).length]));
  const have = new Set(full.map((r) => r.rule));
  return { total: ck.rules.length, indexTotal: ck.indexTotal, counts, rows: full, noRow: ck.rules.filter((r) => !have.has(r.id)).map((r) => r.id), slices };
}
export const ledgerLine = (l) => "LEDGER: " + l.rows.length + " of " + l.total + " rules have a row: PASS " + l.counts.PASS + ", FAIL " + l.counts.FAIL + ", WARN " + l.counts.WARN + ", NOT CHECKED " + l.counts["NOT CHECKED"] + ", N/A " + l.counts["N/A"];
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
export function ledgerMd(l) {
  return [ledgerLine(l), "", "| rule | grade | pack | verdict | evidence or reason |", "|---|---|---|---|---|",
    ...l.rows.map((r) => "| " + [r.rule, r.grade, r.pack, r.verdict, cell(r.evidence)].join(" | ") + " |"),
    ...(l.noRow.length ? ["", "## Rules with no row", "", l.noRow.join(", ")] : []), ""].join("\n");
}
export function writeLedger(dir, l) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "LEDGER.md"), ledgerMd(l));
  fs.writeFileSync(path.join(dir, "ledger.json"), JSON.stringify(l, null, 1) + "\n");
}
const few = (a, n = 8) => a.slice(0, n).join(", ") + (a.length > n ? " and " + (a.length - n) + " more" : "");
// Why the audit FAILS (an empty list = it does not). Names the rules and the slices.
export function ledgerProblems(l, ck) {
  const out = [];
  if (ck.broken) out.push("the checklist is broken: " + ck.problems.slice(0, 4).join("; "));
  if (l.noRow.length) out.push(l.noRow.length + " rule(s) have no row: " + few(l.noRow));
  if (l.indexTotal !== null && l.rows.length !== l.indexTotal) out.push(l.rows.length + " rows, INDEX.md says " + l.indexTotal + " rules");
  for (const [id, s] of Object.entries(l.slices)) {
    if (s.noFile) { out.push("slice " + id + " has no verdict file"); continue; }
    const bits = [];
    if (s.invalid.length) bits.push(s.invalid.length + " invalid line(s): " + few(s.invalid, 5));
    if (s.missing.length) bits.push(s.missing.length + " rule(s) with no line: " + few(s.missing, 5));
    if (bits.length) out.push("slice " + id + " has " + bits.join(" and "));
  }
  return out;
}
