// Usage: node merge.mjs <repo root> [--checklist <dir>] [--with <root-b>] [--proof]
// Verifies what the workers wrote and merges it: parses every .checks/findings/*.md table, syntax-checks
// and runs every .checks/scripts/*.mjs once, marks a finding `unchecked` when its script is missing,
// broken or crashes, then GROUPS the findings into root causes and writes .checks/REPORT.md,
// .checks/causes.json and .checks/run-all.mjs. Prints the counts.
// Root causes: one defect in a template or generator shows up on every page it builds, and different workers
// report it separately. Findings join one cause when they share a rule id AND a place to fix it: the same source
// file named in the `root cause` column or in the text, or the same template family (plan.families). BUG/SEC
// findings without a rule id join only on the same file:line. When unsure, it keeps them apart (under-merging
// is safe; merging two different defects hides one).
// The rule ledger (AB-17, lib-ledger.mjs): every worker also writes .checks/verdicts/<slice>.tsv, one line for EVERY rule of the checklist
// (worker-prompt.md section D). Merge combines them into .checks/LEDGER.md and ledger.json, puts the totals line in REPORT.md and prints it.
// Exit 3 (after everything is written) when a rule has no row, the rows differ from INDEX.md's total, the checklist is broken, or a slice has
// no verdict file or an invalid or missing line. --checklist <dir> reads another checklist (the test's small one).
// VTV-PROOF T1-T4 (lib-ledger.mjs): a verdict line's evidence must hold (each path:N with a quote found on line N; each cited check script ran here,
// exited as cited, printed the rule id and exits 2 on an empty root; an online check-x-*.mjs is not re-run: its <cycle>/logs/<name>.log must end
// "exit N" and be hashed in <cycle>/logs/runs.tsv, <cycle> = the root's parent), else the line is invalid. Scripts run with a 600 s timeout.
// --with <root-b>: root B's slices (B-<id>), findings (B-<id>) and scripts join the ledger. .checks/verdicts/x-*.tsv (evidence tools) are slices
// that need no line per rule. --proof: exit 3 on a NOT CHECKED that is not BLOCKED, a BLOCKED on a tool we have, or a BLOCKED id not in
// <root>/../../head/blocked-allowed.tsv; prints "BLOCKED: b (ids ...)" after the LEDGER line. An unknown flag exits 2.
// causes.json `pages` is the number of distinct PAGES a cause touches, not files: a family counts all its members, a live-site snapshot page
// (pages/<slug>/head.html and body.html) counts once, a codebase counts each .html file. A cause that names no page counts the slice's pages.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { groupFamilies, unitsFor, countPages } from "./families.mjs";
import os from "node:os";
import crypto from "node:crypto";
import { readChecklist, parseVerdicts, combine, finishLedger, ledgerLine, writeLedger, ledgerProblems, RULE_ID, citeProblem, SCRIPT_EXITS, pageKind, pageList, proofProblems } from "./lib-ledger.mjs";

const argv = process.argv.slice(2);
const VALUED = ["--checklist", "--with"], FLAGS = ["--proof"];
const unknown = argv.filter((a, i) => a.startsWith("--") && !VALUED.includes(a) && !FLAGS.includes(a) && !VALUED.includes(argv[i - 1]));
if (unknown.length) { console.error("merge.mjs: unknown flag " + unknown.join(", ") + " (usage: node merge.mjs <root> [--checklist <dir>] [--with <root-b>] [--proof])"); process.exit(2); }
const ckAt = argv.indexOf("--checklist");
const root = path.resolve(argv.find((a, i) => !a.startsWith("--") && !VALUED.includes(argv[i - 1])) || ".");
const rootB = argv.includes("--with") ? path.resolve(argv[argv.indexOf("--with") + 1] || ".") : null;
const dir = path.join(root, ".checks");
const sev = { critical: 0, high: 1, medium: 2, low: 3 };
// A check that hangs is stopped at 600 s and one that prints a lot is not cut off at 1 MiB (ENOBUFS); either way the reason is named.
const run = (file, at = root) => {
  const r = spawnSync(process.execPath, [file, at], { cwd: at, encoding: "utf8", timeout: 600_000, maxBuffer: 32 * 1024 * 1024 });
  if (r.error) r.stderr = `${r.error.code === "ETIMEDOUT" ? "timed out after 600 s" : r.error.code || r.error.message} ${r.stderr || ""}`;
  return r;
};
const readPlan = (d) => (fs.existsSync(path.join(d, "plan.json")) ? JSON.parse(fs.readFileSync(path.join(d, "plan.json"), "utf8")) : { slices: [], skipped: {} });
const plan = readPlan(dir);

// Built-in checks (checks-builtin/ next to scripts/): copied into every audit, so a rule governing an artefact the audit did not see
// (a sitemap that did not exist yet) is still judged once a fix creates it. Exit 2 (cannot judge) until then. run-all runs them too.
const BUILTIN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "checks-builtin");
const builtins = fs.existsSync(BUILTIN_DIR) ? fs.readdirSync(BUILTIN_DIR).filter((f) => /^check-builtin-.*\.mjs$/.test(f)).sort() : [];
if (builtins.length) fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
for (const f of builtins) fs.copyFileSync(path.join(BUILTIN_DIR, f), path.join(dir, "scripts", f));
// Every script of a root: syntax-checked and run once against the root; a check- script also against an empty folder (it must exit 2 there).
// An online check-x- script is never run here. A first stdout line "<n> pages" is read as the pages it covered; the status line comes after it.
const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-merge-empty-"));
function runScripts(r) {
  const sdir = path.join(r, ".checks", "scripts");
  const names = fs.existsSync(sdir) ? fs.readdirSync(sdir).filter((f) => f.endsWith(".mjs")).sort() : [];
  const state = {};
  for (const s of names) {
    const p = path.join(sdir, s);
    if (/^check-x-/.test(s)) { state[s] = { ok: false, online: true, why: "online script, not re-run by merge" }; continue; }
    const syntax = spawnSync(process.execPath, ["--check", p], { encoding: "utf8", timeout: 30_000 });
    if (syntax.status !== 0) { state[s] = { ok: false, why: "syntax error" }; continue; }
    const res = run(p, r);
    const outLines = (res.stdout || "").trim().split(/\r?\n/), pages = /^(\d+) pages$/.exec(outLines[0] || "");
    const line = (pages ? outLines[1] : outLines[0]) || "";
    state[s] = { ...oneState(s, res, line), code: res.status, out: res.stdout || "", pages: pages ? Number(pages[1]) : null, empty: s.startsWith("check-") ? run(p, emptyRoot).status : null };
  }
  return state;
}
function oneState(s, r, line) {
  if (builtins.includes(s)) {
    return r.status === 0 || r.status === 1 || (r.status === 2 && /^ERROR /.test(line)) ? { ok: true, open: r.status === 1, builtin: true, code: r.status, line } : { ok: false, builtin: true, why: `crashed (exit ${r.status}: ${(r.error ? r.stderr : line || r.stderr || "").slice(0, 80)})` };
  } else if (s.startsWith("check-")) {
    const valid = (r.status === 0 && /^PASS /.test(line)) || (r.status === 1 && /^FAIL /.test(line));
    return valid ? { ok: true, open: r.status === 1, line } : { ok: false, why: `crashed or bad output (exit ${r.status}: ${(r.error ? r.stderr : line || r.stderr || "").slice(0, 80)})` };
  }
  return r.status === 0 ? { ok: true } : { ok: false, why: `exit ${r.status}` };
}
const scriptState = runScripts(root);
const scripts = Object.keys(scriptState);
// the roots: A (this one) and, with --with, B; root B's slice and finding ids get "B-"
const roots = [{ r: root, prefix: "", plan, scripts: scriptState }, ...(rootB ? [{ r: rootB, prefix: "B-", plan: readPlan(path.join(rootB, ".checks")), scripts: runScripts(rootB) }] : [])];
fs.rmSync(emptyRoot, { recursive: true, force: true });

const findings = [];
const sliceIdsWithFindings = new Set();
for (const x of roots) {
  const fdir = path.join(x.r, ".checks", "findings");
  for (const f of fs.existsSync(fdir) ? fs.readdirSync(fdir).filter((y) => y.endsWith(".md")).sort() : []) {
    sliceIdsWithFindings.add(x.prefix + f.replace(/\.md$/, ""));
    for (const line of fs.readFileSync(path.join(fdir, f), "utf8").split(/\r?\n/)) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.length < 7 || cells[0] === "id" || /^-+$/.test(cells[0])) continue;
      const [id, severity, where, problem, why, fix, check, rootCause = ""] = cells;
      if (/^rejected/i.test(severity)) continue;
      const name = (check.match(/(check-[A-Za-z0-9_.+-]+\.mjs)/) || [])[1];
      const st = name ? x.scripts[name] : null;
      const status = !name ? "unchecked (no script)" : !st ? "unchecked (script missing)" : !st.ok ? `unchecked (${st.why})` : st.open ? "open" : "passes already";
      findings.push({ id: x.prefix + id, slice: x.prefix + f.replace(/\.md$/, ""), severity: severity.toLowerCase(), where, problem, why, fix, rootCause, script: name || "", status });
    }
  }
}
findings.sort((a, b) => (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9) || a.id.localeCompare(b.id));

// ---- Root causes ----
// Families: from the plan, or computed now for a plan made before families existed.
let families = plan.families;
if (!families) {
  const files = [...new Set(plan.slices.flatMap((s) => s.files))];
  families = groupFamilies(unitsFor(root, files)).families;
}
const famOf = new Map();
for (const fam of families) for (const m of fam.members) famOf.set(m, fam);
const famOfFile = (f) => famOf.get(f) || famOf.get(f.replace(/\/[^/]+$/, "")) || null; // snapshot units are page folders
const sliceFiles = new Map(plan.slices.map((s) => [s.id, s.chunk ? [s.chunk.file] : s.files]));
const allFiles = new Set(plan.slices.flatMap((s) => (s.chunk ? [s.chunk.file] : s.files)));
for (const fam of families) for (const m of fam.members) allFiles.add(m);
const FILE_RE = /[A-Za-z0-9_.*\/-]+\.(?:m?js|cjs|ts|tsx|jsx|html?|css|json|md|toml|ya?ml|txt|xml|py|go|rs|php|rb|vue|svelte|astro)\b/g;
const RULE_RE = /\b[A-Z][A-Z0-9]{1,4}-\d{3}\b/g;
// Files a text names, resolved against the repo: exact paths, globs like blog/*/index.html, or bare names.
function filesIn(text) {
  const out = new Set();
  for (const tok of text.match(FILE_RE) || []) {
    const t = tok.replace(/^\.?\//, "");
    if (allFiles.has(t)) { out.add(t); continue; }
    if (t.includes("*")) {
      const re = new RegExp("^" + t.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, (c) => "\\" + c)).join("[^/]+") + "$");
      for (const f of allFiles) if (re.test(f)) out.add(f);
      continue;
    }
    const hits = [...allFiles].filter((f) => f === t || f.endsWith("/" + t));
    if (hits.length && hits.length <= 3) hits.forEach((h) => out.add(h));
  }
  return [...out];
}
// The places a finding can be fixed: generator/source files first, else the template family, else the page.
function locsOf(f) {
  const named = filesIn(`${f.rootCause} ${f.where} ${f.problem} ${f.fix}`);
  const sources = named.filter((x) => !/\.html?$/i.test(x));
  const pages = named.filter((x) => /\.html?$/i.test(x));
  const locs = new Set();
  // A live-site snapshot has no source: every page comes from the same platform, so "platform" is one place to fix
  // (two findings still need a shared rule AND a shared specific term to join).
  if (/^\s*platform\b/i.test(f.rootCause) || plan.snapshot) locs.add("platform");
  if (f.rootCause) filesIn(f.rootCause).forEach((x) => locs.add(famOfFile(x)?.id || x));
  for (const s of sources) locs.add(s);
  // A family named by id ("F01 (19 pages)") stands for its members.
  const famNamed = families.filter((fam) => new RegExp(`\\b${fam.id}\\b`).test(`${f.where} ${f.rootCause}`));
  for (const fam of famNamed) { locs.add(fam.id); pages.push(fam.reps[0]); }
  // Only when nothing is named at all, fall back to the worker's slice (the old "all four, 13-14" style).
  const pageSet = pages.length ? pages : named.length ? [] : (sliceFiles.get(f.slice) || []).filter((x) => /\.html?$/i.test(x) || famOfFile(x));
  for (const p of pageSet) locs.add(famOfFile(p)?.id || p);
  return { locs: [...locs], pages: pageSet };
}
const parent = findings.map((_, i) => i);
const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
const union = (a, b) => { parent[find(a)] = find(b); };
// One rule can cover different defects (SCH-004 = required properties: breadcrumb items AND BlogPosting fields),
// so two findings also need one shared specific term: a `code` identifier or a CamelCase name from the problem text.
const COMMON = new Set(["script", "json", "ld", "json-ld", "application/ld+json", "html", "head", "body", "type", "index.html", "javascript", "css", "id"]);
function terms(text) {
  const out = new Set();
  for (const m of text.matchAll(/`([^`]{1,80})`/g)) for (const w of m[1].split(/[^A-Za-z0-9@_-]+/)) if (w.length > 2 && !COMMON.has(w.toLowerCase()) && !/^\d+$/.test(w)) out.add(w.toLowerCase());
  for (const m of text.matchAll(/\b[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+\b/g)) out.add(m[0].toLowerCase());
  return out;
}
const keyOwners = new Map();
for (const [i, f] of findings.entries()) {
  const rules = [...new Set(f.problem.match(RULE_RE) || [])];
  const { locs, pages } = locsOf(f);
  Object.assign(f, { rules, locs, pages, terms: terms(f.problem.replace(RULE_RE, "")) });
  const lineKey = (f.rootCause || f.where).replace(/\s+/g, "");
  const keys = rules.length ? rules.flatMap((r) => locs.map((l) => `${r}@${l}`)) : [`${/^SEC/i.test(f.problem) ? "SEC" : "BUG"}@${lineKey}`];
  for (const k of keys) {
    const owners = keyOwners.get(k) || [];
    for (const j of owners) {
      const g = findings[j];
      const shared = !f.terms.size || !g.terms.size || [...f.terms].some((t) => g.terms.has(t));
      if (shared) union(i, j);
    }
    owners.push(i);
    keyOwners.set(k, owners);
  }
}
const groups = new Map();
for (const [i, f] of findings.entries()) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(f); }
const causes = [...groups.values()].map((members) => {
  members.sort((a, b) => (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9) || a.id.localeCompare(b.id));
  const lead = members[0];
  const locs = [...new Set(members.flatMap((m) => m.locs))];
  const famIds = locs.filter((l) => /^F\d+$/.test(l));
  const pageCount = countPages(members.flatMap((m) => m.pages), famOfFile, !!plan.snapshot);
  const withScript = members.filter((m) => m.status === "open" || m.status === "passes already");
  const open = withScript.filter((m) => m.status === "open").length;
  return {
    severity: lead.severity, rules: [...new Set(members.flatMap((m) => m.rules))], lead, members,
    fixAt: [...locs.filter((l) => !/^F\d+$/.test(l) && !/\.html?$/i.test(l)), ...famIds.map((id) => { const fam = families.find((x) => x.id === id); return `${id} ${fam.label} (${fam.size} pages)`; }), ...locs.filter((l) => /\.html?$/i.test(l))],
    pages: pageCount, scripts: withScript.map((m) => m.script),
    status: !withScript.length ? "unchecked" : open ? `open (${open} of ${withScript.length} checks fail)` : "fixed (all checks pass)",
  };
}).sort((a, b) => (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9) || b.pages - a.pages || b.members.length - a.members.length);
causes.forEach((c, i) => { c.id = `C${String(i + 1).padStart(2, "0")}`; for (const m of c.members) m.cause = c.id; });

// ---- Files a worker left where they do not belong (scratch goes to .checks/tmp/, deleted here) ----
const KNOWN = new Set(["findings", "scripts", "logs", "prev", "tmp", "verdicts", "chunks", "LEDGER.md", "ledger.json", "REPORT.md", "REPORT.prev.md", "causes.json", "run-all.mjs", "plan.json"]);
const stray = fs.readdirSync(dir).filter((x) => !KNOWN.has(x));
fs.rmSync(path.join(dir, "tmp"), { recursive: true, force: true });
if (stray.length) console.log(`WARNING: unexpected files in .checks/ (a worker wrote outside findings/ and scripts/): ${stray.join(", ")}`);

// ---- The rule ledger ----
const ck = readChecklist(ckAt >= 0 ? path.resolve(argv[ckAt + 1] || ".") : undefined);
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
// T2: why a valid line's evidence does not hold (null = it holds)
function evidenceProblem(rule, ev, x) {
  const c = citeProblem(ev, x.r);
  if (c) return c;
  for (const [, name, code] of String(ev).matchAll(SCRIPT_EXITS)) {
    if (/^check-x-/.test(name)) {
      const logs = path.join(path.dirname(x.r), "logs"), log = path.join(logs, name.replace(/\.mjs$/, ".log"));
      const buf = fs.existsSync(log) ? fs.readFileSync(log) : null, runs = fs.existsSync(path.join(logs, "runs.tsv")) ? fs.readFileSync(path.join(logs, "runs.tsv"), "utf8") : "";
      if (!buf || buf.toString("utf8").trim().split(/\r?\n/).pop().trim() !== "exit " + code || !runs.includes(sha256(buf))) return name + " (online, not re-run) needs logs/" + path.basename(log) + ' ending "exit ' + code + '" with its sha256 in logs/runs.tsv';
      continue;
    }
    const st = x.scripts[name];
    if (!st || st.code === undefined) return name + " is not in .checks/scripts" + (st ? " as a script that runs (" + st.why + ")" : "");
    if (st.code !== Number(code)) return name + " exits " + st.code + ", not " + code;
    if (!st.out.includes(rule)) return name + " does not print " + rule;
    if (st.empty !== 2) return name + " exits " + st.empty + " on an empty root (it must exit 2): vacuous";
  }
  return null;
}
// the slices: each root's plan slices, plus its .checks/verdicts/x-*.tsv (exempt from the one-line-per-rule check)
const slicesAll = [];
for (const x of roots) {
  for (const s of x.plan.slices) slicesAll.push({ id: x.prefix + s.id, file: path.join(x.r, ".checks", "verdicts", s.id + ".tsv"), exempt: false, x });
  const vd = path.join(x.r, ".checks", "verdicts");
  for (const f of fs.existsSync(vd) ? fs.readdirSync(vd).filter((y) => /^x-.*\.tsv$/.test(y)).sort() : []) slicesAll.push({ id: x.prefix + f.replace(/\.tsv$/, ""), file: path.join(vd, f), exempt: true, x });
}
const parsed = new Map(), sliceReport = {};
for (const s of slicesAll) {
  if (!fs.existsSync(s.file)) { parsed.set(s.id, null); sliceReport[s.id] = { valid: 0, invalid: [], missing: ck.rules.map((r) => r.id), noFile: true }; continue; }
  const p = parseVerdicts(fs.readFileSync(s.file, "utf8"), ck);
  for (const [id, v] of [...p.valid]) { const why = ["PASS", "FAIL", "WARN"].includes(v.verdict) ? evidenceProblem(id, v.evidence, s.x) : null; if (why) { p.valid.delete(id); p.invalid.push({ id, reason: id + ": " + why }); } }
  parsed.set(s.id, p);
  sliceReport[s.id] = { valid: p.valid.size, invalid: [...new Set(p.invalid.map((y) => y.id))], missing: s.exempt ? [] : p.missing, noFile: false };
}
const pagesOf = new Map(roots.map((x) => [x.r, pageList(x.r).length]));
// T1: the pages a part's cited check scripts cover, against its root's page count
const cover = (part) => {
  const ns = [...String(part.evidence).matchAll(SCRIPT_EXITS)].map(([, name]) => part.s.x.scripts[name]?.pages).filter((n) => typeof n === "number");
  return ns.length ? { n: Math.max(...ns), m: pagesOf.get(part.s.x.r) } : null;
};
const findingIdsOf = new Map();
for (const f of findings) { const first = (f.problem.match(RULE_ID) || [])[0]; if (first && ck.byId.has(first)) findingIdsOf.set(first, [...(findingIdsOf.get(first) || []), f.id]); }
const ledgerRows = [];
for (const r of ck.rules) {
  const parts = slicesAll.map((s) => {
    const p = parsed.get(s.id);
    if (!p) return { slice: s.id, state: "missing" };
    const v = p.valid.get(r.id);
    if (v) return { slice: s.id, state: "valid", verdict: v.verdict, evidence: v.evidence, s };
    const bad = p.invalid.find((x) => x.id === r.id);
    return bad ? { slice: s.id, state: "invalid", reason: bad.reason } : s.exempt ? null : { slice: s.id, state: "missing" };
  }).filter(Boolean);
  const c = combine(parts, findingIdsOf.get(r.id) || [], r.grade, { page: pageKind(r), cover });
  if (c) ledgerRows.push({ rule: r.id, ...c });
}
const ledger = finishLedger(ck, ledgerRows, sliceReport);
const ledgerWhy = ledgerProblems(ledger, ck);
ledger.pages = pagesOf.get(root);
if (argv.includes("--proof")) {
  const allowedFile = path.resolve(root, "..", "..", "head", "blocked-allowed.tsv");
  const allowed = new Set((fs.existsSync(allowedFile) ? fs.readFileSync(allowedFile, "utf8") : "").split(/\r?\n/).map((l) => l.split("\t")[0].trim()).filter(Boolean));
  ledger.proof = proofProblems(ledger.rows, allowed);
  ledgerWhy.push(...ledger.proof.problems.map((p) => "proof: " + p));
}
writeLedger(dir, ledger);

// ---- Not checked ----
const notChecked = [
  ...plan.slices.filter((s) => !sliceIdsWithFindings.has(s.id)).map((s) => `slice ${s.id} (${s.files.length} files): no findings file, the worker did not finish`),
  ...(plan.skipped?.tooLarge || []).map((x) => `${x}: over the per-file size limit`),
];

if (fs.existsSync(path.join(dir, "REPORT.md"))) fs.copyFileSync(path.join(dir, "REPORT.md"), path.join(dir, "REPORT.prev.md"));
const count = (list, k) => list.filter((f) => f.severity === k).length;
const know = scripts.filter((s) => s.startsWith("know-"));
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
const md = [
  `# ${plan.snapshot ? "Live-site" : "Codebase"} check — ${new Date().toISOString().slice(0, 10)}`,
  "",
  ledgerLine(ledger) + " (.checks/LEDGER.md)",
  ...(ledgerWhy.length ? ["", "LEDGER FAIL: " + ledgerWhy.join(" | ")] : []),
  "",
  `**${causes.length} root causes** (${count(causes, "critical")} critical, ${count(causes, "high")} high, ${count(causes, "medium")} medium, ${count(causes, "low")} low), from ${findings.length} findings. ` +
    `${findings.filter((f) => f.status === "open" || f.status === "passes already").length} findings have a working check script; run \`node .checks/run-all.mjs\` to see which causes are still open.`,
  families.length ? `\nTemplate families (each checked through 2 representative pages; a cause on a family affects every member): ${families.map((f) => `${f.id} ${f.label} (${f.size} pages)`).join("; ")}.` : "",
  "",
  "## Root causes",
  "",
  "| cause | severity | rules | fix at | what is wrong | fix | pages affected | findings | status |",
  "|---|---|---|---|---|---|---|---|---|",
  ...causes.map((c) => `| ${c.id} | ${c.severity} | ${c.rules.join(", ") || (/^SEC/i.test(c.lead.problem) ? "SEC" : "BUG")} | ${cell(c.fixAt.slice(0, 4).join("; ") || c.lead.where)} | ${cell(c.lead.problem)} | ${cell(c.lead.fix)} | ${c.pages || "—"} | ${c.members.length} | ${c.status} |`),
  "",
  notChecked.length ? "## NOT CHECKED\n\n" + notChecked.map((x) => `- ${x}`).join("\n") + "\n" : "",
  stray.length ? `## Warning\n\nUnexpected files in .checks/ (a worker wrote outside findings/ and scripts/): ${stray.join(", ")}\n` : "",
  "## Every finding",
  "",
  "| id | cause | severity | file:line | problem | why it matters | fix | check | status |",
  "|---|---|---|---|---|---|---|---|---|",
  ...findings.map((f) => `| ${f.id} | ${f.cause} | ${f.severity} | ${cell(f.where)} | ${cell(f.problem)} | ${cell(f.why)} | ${cell(f.fix)} | ${f.script || "—"} | ${f.status} |`),
  "",
  "## Built-in checks (builtin: shipped with the skill, copied into every audit; not from a worker's findings)",
  "",
  ...(builtins.length ? builtins.map((b) => { const st = scriptState[b] || {}; return `- \`${b}\` builtin: ${!st.ok ? `BROKEN (${st.why})` : st.code === 0 ? "PASS" : st.code === 1 ? "FAIL" : "cannot judge yet"} ${cell(st.line || "")}`; }) : ["- none (checks-builtin/ not found next to merge.mjs)"]),
  "",
  "## Knowledge scripts",
  ...know.map((k) => `- \`node .checks/scripts/${k}\`${scriptState[k]?.ok ? "" : ` — broken (${scriptState[k]?.why})`}`),
  "",
].join("\n");
fs.writeFileSync(path.join(dir, "REPORT.md"), md);
fs.writeFileSync(path.join(dir, "causes.json"), JSON.stringify(causes.map((c) => ({ id: c.id, severity: c.severity, rules: c.rules, fixAt: c.fixAt, problem: c.lead.problem, fix: c.lead.fix, pages: c.pages, findings: c.members.map((m) => m.id), scripts: c.scripts })), null, 1) + "\n");

const runAll = `// Generated by merge.mjs. Usage: node .checks/run-all.mjs [--json]
// Runs every check script; prints the root causes still open (from causes.json) and any script that errors.
// Exit 1 while any check is open. No tokens, no network.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "scripts");
const root = path.resolve(here, "..");
const res = fs.readdirSync(dir).filter((f) => f.startsWith("check-") && f.endsWith(".mjs")).sort().map((f) => {
  const r = spawnSync(process.execPath, [path.join(dir, f), root], { cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  const line = (r.stdout || "").trim().split("\\n")[0] || "";
  // a check that hangs (stopped at 60 s) or cannot run is an error with its reason, never a pass
  if (r.error) return { script: f, status: "error", line: (r.error.code === "ETIMEDOUT" ? "timed out after 60 s" : String(r.error.code || r.error.message)) + (line ? ": " + line : "") };
  return { script: f, status: r.status === 0 ? "pass" : r.status === 1 ? "open" : "error", line: line || (r.stderr || "").split("\\n")[0] };
});
const causes = fs.existsSync(path.join(here, "causes.json")) ? JSON.parse(fs.readFileSync(path.join(here, "causes.json"), "utf8")) : [];
const by = Object.fromEntries(res.map((r) => [r.script, r]));
const causeState = causes.map((c) => { const rs = c.scripts.map((s) => by[s]).filter(Boolean); const open = rs.filter((r) => r.status !== "pass").length;
  return { id: c.id, severity: c.severity, problem: c.problem, checks: rs.length, open }; });
const open = res.filter((x) => x.status !== "pass").length;
const causesOpen = causeState.filter((c) => c.open).length;
const summary = \`\${res.length - open}/\${res.length} checks pass; \${causesOpen} of \${causeState.filter((c) => c.checks).length} checked root causes still open\`;
if (process.argv.includes("--json")) console.log(JSON.stringify({ summary, causes: causeState, scripts: res }, null, 2));
else {
  for (const c of causeState.filter((c) => c.open)) console.log(\`OPEN  \${c.id} \${c.severity.padEnd(6)} \${c.open}/\${c.checks} checks fail  \${c.problem.slice(0, 110)}\`);
  for (const r of res.filter((x) => x.status === "error")) console.log("ERROR", r.script, r.line);
  console.log(summary);
}
process.exit(open ? 1 : 0);
`;
fs.writeFileSync(path.join(dir, "run-all.mjs"), runAll);
const unchecked = findings.filter((f) => f.status.startsWith("unchecked")).length;
console.log(`${causes.length} root causes (${count(causes, "critical")} critical, ${count(causes, "high")} high, ${count(causes, "medium")} medium, ${count(causes, "low")} low) from ${findings.length} findings; ${findings.length - unchecked} findings with working check scripts, ${unchecked} unchecked; ${notChecked.length} NOT CHECKED item(s); ${know.length} knowledge scripts; wrote .checks/REPORT.md, causes.json and run-all.mjs`);
console.log(ledgerLine(ledger));
if (ledger.proof) console.log("BLOCKED: " + ledger.proof.blocked.length + (ledger.proof.blocked.length ? " (ids " + ledger.proof.blocked.join(", ") + ")" : ""));
if (ledgerWhy.length) { console.log("LEDGER FAIL: " + ledgerWhy.join(" | ")); process.exit(3); }
