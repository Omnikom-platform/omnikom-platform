// Usage: node merge.mjs <repo root>
// Verifies what the workers wrote and merges it: parses every .checks/findings/*.md table, syntax-checks
// and runs every .checks/scripts/*.mjs once, marks a finding `unchecked` when its script is missing,
// broken or crashes, then GROUPS the findings into root causes and writes .checks/REPORT.md,
// .checks/causes.json and .checks/run-all.mjs. Prints the counts.
// Root causes: one defect in a template or generator shows up on every page it builds, and different workers
// report it separately. Findings join one cause when they share a rule id AND a place to fix it: the same source
// file named in the `root cause` column or in the text, or the same template family (plan.families). BUG/SEC
// findings without a rule id join only on the same file:line. When unsure, it keeps them apart (under-merging
// is safe; merging two different defects hides one).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { groupFamilies, unitsFor } from "./families.mjs";

const root = path.resolve(process.argv[2] || ".");
const dir = path.join(root, ".checks");
const sev = { critical: 0, high: 1, medium: 2, low: 3 };
// A check that hangs is stopped at 60 s and one that prints a lot is not cut off at 1 MiB (ENOBUFS); either way the reason is named.
const run = (file) => {
  const r = spawnSync(process.execPath, [file, root], { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
  if (r.error) r.stderr = `${r.error.code === "ETIMEDOUT" ? "timed out after 60 s" : r.error.code || r.error.message} ${r.stderr || ""}`;
  return r;
};
const plan = fs.existsSync(path.join(dir, "plan.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf8")) : { slices: [], skipped: {} };

// Built-in checks (checks-builtin/ next to scripts/): copied into every audit, so a rule governing an artefact the audit did not see
// (a sitemap that did not exist yet) is still judged once a fix creates it. Exit 2 (cannot judge) until then. run-all runs them too.
const BUILTIN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "checks-builtin");
const builtins = fs.existsSync(BUILTIN_DIR) ? fs.readdirSync(BUILTIN_DIR).filter((f) => /^check-builtin-.*\.mjs$/.test(f)).sort() : [];
if (builtins.length) fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
for (const f of builtins) fs.copyFileSync(path.join(BUILTIN_DIR, f), path.join(dir, "scripts", f));
const scripts = fs.existsSync(path.join(dir, "scripts")) ? fs.readdirSync(path.join(dir, "scripts")).filter((f) => f.endsWith(".mjs")).sort() : [];
const scriptState = {};
for (const s of scripts) {
  const p = path.join(dir, "scripts", s);
  const syntax = spawnSync(process.execPath, ["--check", p], { encoding: "utf8", timeout: 30_000 });
  if (syntax.status !== 0) { scriptState[s] = { ok: false, why: "syntax error" }; continue; }
  const r = run(p);
  const line = (r.stdout || "").trim().split("\n")[0] || "";
  if (builtins.includes(s)) {
    scriptState[s] = r.status === 0 || r.status === 1 || (r.status === 2 && /^ERROR /.test(line)) ? { ok: true, open: r.status === 1, builtin: true, code: r.status, line } : { ok: false, builtin: true, why: `crashed (exit ${r.status}: ${(r.error ? r.stderr : line || r.stderr || "").slice(0, 80)})` };
  } else if (s.startsWith("check-")) {
    const valid = (r.status === 0 && /^PASS /.test(line)) || (r.status === 1 && /^FAIL /.test(line));
    scriptState[s] = valid ? { ok: true, open: r.status === 1, line } : { ok: false, why: `crashed or bad output (exit ${r.status}: ${(r.error ? r.stderr : line || r.stderr || "").slice(0, 80)})` };
  } else {
    scriptState[s] = r.status === 0 ? { ok: true } : { ok: false, why: `exit ${r.status}` };
  }
}

const findings = [];
const fdir = path.join(dir, "findings");
const sliceIdsWithFindings = new Set();
for (const f of fs.existsSync(fdir) ? fs.readdirSync(fdir).filter((x) => x.endsWith(".md")).sort() : []) {
  sliceIdsWithFindings.add(f.replace(/\.md$/, ""));
  for (const line of fs.readFileSync(path.join(fdir, f), "utf8").split(/\r?\n/)) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 7 || cells[0] === "id" || /^-+$/.test(cells[0])) continue;
    const [id, severity, where, problem, why, fix, check, rootCause = ""] = cells;
    if (/^rejected/i.test(severity)) continue;
    const name = (check.match(/(check-[A-Za-z0-9_.+-]+\.mjs)/) || [])[1];
    const st = name ? scriptState[name] : null;
    const status = !name ? "unchecked (no script)" : !st ? "unchecked (script missing)" : !st.ok ? `unchecked (${st.why})` : st.open ? "open" : "passes already";
    findings.push({ id, slice: f.replace(/\.md$/, ""), severity: severity.toLowerCase(), where, problem, why, fix, rootCause, script: name || "", status });
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
const sliceFiles = new Map(plan.slices.map((s) => [s.id, s.files]));
const allFiles = new Set(plan.slices.flatMap((s) => s.files));
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
  const pageCount = new Set(members.flatMap((m) => m.pages.flatMap((p) => famOfFile(p)?.members || [p]))).size;
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
const KNOWN = new Set(["findings", "scripts", "logs", "prev", "tmp", "REPORT.md", "REPORT.prev.md", "causes.json", "run-all.mjs", "plan.json"]);
const stray = fs.readdirSync(dir).filter((x) => !KNOWN.has(x));
fs.rmSync(path.join(dir, "tmp"), { recursive: true, force: true });
if (stray.length) console.log(`WARNING: unexpected files in .checks/ (a worker wrote outside findings/ and scripts/): ${stray.join(", ")}`);

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
