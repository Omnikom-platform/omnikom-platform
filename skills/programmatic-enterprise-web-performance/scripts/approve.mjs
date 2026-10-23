// Operator verbs `approve targets` and `approve plan` (shipgate 06 TR-235), and the lock check every later stage uses.
// Usage: node approve.mjs <target> targets|plan [--by "<owner name>"] [--from proposals] [--run <research run id>] [--cwd DIR] [--pewp DIR]
//        node approve.mjs <target> --check            verify the lock only (exit 0 ok, 1 a file changed after approval, 2 nothing approved)
// <target> = a URL (state in <cwd>/site-checks/<host>/.pewp/) or a repo path (state in <repo>/.pewp/); --pewp names the folder directly.
// What it does: shows the diff of the source against the current approved copy, then (only with --by) writes
//   <pewp>/approved/targets.json            the approved targets
//   <pewp>/approved/plan/                   the approved plan (sitemap, briefs, programmatic.json, offsite, priorities; not the builder's
//                                           programmatic-data.json, which is data the builder fills after approval)
//   <pewp>/approved/lock.json               sha256 of every approved file, research run id, approvedAt, approvedBy
//   <pewp>/approved/history/<time>/         the copy that was replaced
// A file changed, added or removed under approved/ after approval makes the lock check fail; a plan approved for other targets than the
// approved ones is reported stale. The gate (lib-plan.mjs) and measure prefer the approved files when they exist.
// Source = <pewp>/targets.json and <pewp>/plan/, or with --from proposals the iterate proposals (<pewp>/proposals/targets.json), which
// also replaces the working targets.json so plan-site.mjs plans from them. Approving is the owner's act: never run it on your own.
// Exit 0 approved / no change / lock ok, 1 invalid source or lock failed, 2 cannot judge (file missing), 3 diff shown, not signed (no --by).
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { locate } from "./state.mjs";
import { validate } from "./targets-validate.mjs";

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")); // a BOM from a Windows editor is not "not JSON"
const jr = (p, d = null) => { try { return J(p); } catch { return d; } };
const EXCLUDE_PLAN = new Set(["programmatic-data.json"]);
export const approvedDir = (pewp) => path.join(pewp, "approved");

function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out); else out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out.sort();
}
const planFiles = (dir) => walk(dir).filter((f) => !EXCLUDE_PLAN.has(f));
const hashMap = (dir, files) => Object.fromEntries(files.map((f) => [f, sha256(fs.readFileSync(path.join(dir, f)))]));

export function readLock(pewp) { return jr(path.join(approvedDir(pewp), "lock.json")); }

// The lock check: every approved file is listed and unchanged; nothing else sits under approved/plan; the plan was approved for the approved targets.
export function verifyLock(pewp) {
  const dir = approvedDir(pewp), lock = readLock(pewp);
  const hasTargets = fs.existsSync(path.join(dir, "targets.json")), hasPlan = fs.existsSync(path.join(dir, "plan"));
  if (!lock && !hasTargets && !hasPlan) return { exists: false, ok: true, problems: [], stale: [], lock: null };
  const problems = [], stale = [];
  if (!lock) problems.push("approved/ has files but no lock.json");
  for (const kind of ["targets", "plan"]) {
    const entry = lock?.[kind];
    if (!entry) { if (kind === "targets" ? hasTargets : hasPlan) problems.push(`approved/${kind === "targets" ? "targets.json" : "plan/"} exists but is not in the lock`); continue; }
    for (const [rel, want] of Object.entries(entry.files)) {
      const f = path.join(dir, rel);
      if (!fs.existsSync(f)) problems.push(`${rel}: approved file is missing`);
      else if (sha256(fs.readFileSync(f)) !== want) problems.push(`${rel}: changed after approval (sha256 differs from the lock)`);
    }
    if (kind === "plan") for (const rel of planFiles(path.join(dir, "plan")).map((x) => "plan/" + x)) if (!(rel in entry.files)) problems.push(`${rel}: file added after approval (not in the lock)`);
  }
  const tsha = lock?.targets && lock.targets.files["targets.json"];
  if (lock?.plan && tsha && lock.plan.targetsSha256 !== tsha) stale.push(`plan was approved for targets ${String(lock.plan.targetsSha256).slice(0, 8)}, the approved targets are now ${tsha.slice(0, 8)}: re-plan and approve the plan again`);
  return { exists: true, ok: problems.length === 0, problems, stale, lock };
}

// Where later stages read their inputs: the approved copy when there is one, else the working files.
export function resolveInputs(pewp) {
  const dir = approvedDir(pewp);
  const at = fs.existsSync(path.join(dir, "targets.json")), ap = fs.existsSync(path.join(dir, "plan", "sitemap.json"));
  return { targetsFile: at ? path.join(dir, "targets.json") : path.join(pewp, "targets.json"), planRoot: ap ? dir : pewp, approved: { targets: at, plan: ap }, lock: verifyLock(pewp) };
}
export const approvedTargetsPath = (pewp) => resolveInputs(pewp).targetsFile;

// ---------- diffs ----------
const short = (v) => { const x = v && typeof v === "object" && !Array.isArray(v) && "value" in v ? v.value : v; const s = JSON.stringify(x) ?? "none"; return s.length > 60 ? s.slice(0, 57) + "..." : s; };
export function diffTargets(oldT, newT) {
  const L = [];
  const top = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== "clusters"));
  const ot = top(oldT || {}), nt = top(newT);
  for (const k of new Set([...Object.keys(ot), ...Object.keys(nt)])) if (JSON.stringify(ot[k]) !== JSON.stringify(nt[k])) L.push(`~ ${k}: ${short(ot[k])} -> ${short(nt[k])}`);
  const oc = new Map((oldT?.clusters || []).map((c) => [c.id, c])), nc = new Map(newT.clusters.map((c) => [c.id, c]));
  for (const [id, c] of nc) if (!oc.has(id)) L.push(`+ cluster ${id}: "${c.primaryQuery}" -> ${c.targetPage}, priority ${c.priority}`);
  for (const [id, c] of oc) if (!nc.has(id)) L.push(`- cluster ${id}: "${c.primaryQuery}"`);
  for (const [id, n] of nc) {
    const o = oc.get(id); if (!o) continue;
    for (const k of new Set([...Object.keys(o), ...Object.keys(n)])) if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) L.push(`~ ${id}.${k}: ${short(o[k])} -> ${short(n[k])}`);
  }
  return L;
}
export function diffPlan(oldDir, newDir) {
  const L = [];
  const oldF = planFiles(oldDir), newF = planFiles(newDir), oh = hashMap(oldDir, oldF), nh = hashMap(newDir, newF);
  for (const f of newF) { if (!(f in oh)) L.push(`+ plan/${f}`); else if (oh[f] !== nh[f]) L.push(`~ plan/${f} changed`); }
  for (const f of oldF) if (!(f in nh)) L.push(`- plan/${f}`);
  const os = jr(path.join(oldDir, "sitemap.json")), ns = jr(path.join(newDir, "sitemap.json"));
  if (os && ns) {
    const op = new Set(os.pages.map((p) => p.path)), np = new Set(ns.pages.map((p) => p.path));
    for (const p of np) if (!op.has(p)) L.push(`  page added: ${p}`);
    for (const p of op) if (!np.has(p)) L.push(`  page removed: ${p}`);
    const lk = (s) => new Set(s.links.map((l) => `${l.from} > ${l.to} "${l.anchor}"`));
    const ol = lk(os), nl = lk(ns);
    for (const l of nl) if (!ol.has(l)) L.push(`  link added: ${l}`);
    for (const l of ol) if (!nl.has(l)) L.push(`  link removed: ${l}`);
  }
  return L;
}

function researchRun(pewp, t, given) {
  if (given) return given;
  if (t?.researchRun) return String(t.researchRun);
  const s = jr(path.join(pewp, "research", "summary.json"));
  const v = s && (s.run || s.runId || s.ranAt || s.generatedAt || s.createdAt);
  return v ? String(v) : `targets createdAt ${t?.createdAt || "unknown"}`;
}

function copyDir(from, to, files) { for (const f of files) { fs.mkdirSync(path.dirname(path.join(to, f)), { recursive: true }); fs.copyFileSync(path.join(from, f), path.join(to, f)); } }

export function approve(pewp, kind, { by = null, from = null, run = null, log = console.log } = {}) {
  const dir = approvedDir(pewp), lockNow = verifyLock(pewp);
  if (lockNow.exists && !lockNow.ok) { for (const p of lockNow.problems) log(`  ${p}`); log("FAIL approve: the approved files changed after approval; restore them (or delete approved/ and approve again) before approving anything new"); return 1; }
  const stamp = new Date().toISOString();
  const lock = lockNow.lock || { formatVersion: 1 };
  if (kind === "targets") {
    const src = from === "proposals" ? path.join(pewp, "proposals", "targets.json") : path.join(pewp, "targets.json");
    if (!fs.existsSync(src)) { log(`ERROR approve cannot judge: ${src} not found`); return 2; }
    let t; try { t = J(src); } catch (e) { log(`ERROR approve cannot judge: ${src} is not JSON: ${e.message}`); return 2; }
    const v = validate(t);
    if (!v.ok) { log(`FAIL approve: ${src} is not valid, nothing approved (${v.errors.length} error(s))`); for (const e of v.errors.slice(0, 10)) log(`  ${e.rule} ${e.path}: ${e.message}`); return 1; }
    const old = jr(path.join(dir, "targets.json"));
    const buf = fs.readFileSync(src), sha = sha256(buf);
    log(old ? `Diff of ${path.relative(pewp, src)} against the approved targets (${(lock.targets?.files["targets.json"] || "").slice(0, 8)}):` : `First approval of the targets (${t.clusters.length} clusters).`);
    const d = old ? diffTargets(old, t) : [];
    for (const l of d) log("  " + l);
    if (old && lock.targets?.files["targets.json"] === sha) { log("PASS approve targets: no change, already approved"); return 0; }
    if (old && !d.length) log("  (only formatting differs)");
    if (!by) { log(`NOT SIGNED: approving is the owner's act. Re-run with --by "<owner name>" after the owner has read the diff.`); return 3; }
    if (old) { const h = path.join(dir, "history", stamp.replace(/[:.]/g, "-")); fs.mkdirSync(h, { recursive: true }); fs.copyFileSync(path.join(dir, "targets.json"), path.join(h, "targets.json")); }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "targets.json"), buf);
    if (from === "proposals") fs.writeFileSync(path.join(pewp, "targets.json"), buf); // plan-site.mjs plans from the working file
    lock.targets = { approvedAt: stamp, approvedBy: by, researchRun: researchRun(pewp, t, run), source: from === "proposals" ? "proposals/targets.json" : "targets.json", files: { "targets.json": sha } };
    fs.writeFileSync(path.join(dir, "lock.json"), JSON.stringify(lock, null, 1) + "\n");
    log(`PASS approve targets: ${t.clusters.length} clusters signed by ${by} at ${stamp} (sha256 ${sha.slice(0, 12)}, research run ${lock.targets.researchRun})`);
    const after = verifyLock(pewp);
    for (const s of after.stale) log(`  STALE ${s}`);
    return 0;
  }
  // plan
  if (!lock.targets || !fs.existsSync(path.join(dir, "targets.json"))) { log("FAIL approve: approve the targets first (the plan is approved against them)"); return 1; }
  const srcDir = from === "proposals" ? path.join(pewp, "proposals", "plan") : path.join(pewp, "plan");
  const sm = jr(path.join(srcDir, "sitemap.json"));
  if (!sm) { log(`ERROR approve cannot judge: ${path.join(srcDir, "sitemap.json")} not found${from === "proposals" ? " (proposals/plan holds deltas only: approve the targets, run plan-site.mjs, then approve the working plan)" : " (run plan-site.mjs)"}`); return 2; }
  const at = J(path.join(dir, "targets.json")), ids = new Set(at.clusters.map((c) => c.id)), bad = [];
  for (const c of at.clusters) if (sm.pages.filter((p) => p.cluster === c.id).length !== 1) bad.push(`cluster ${c.id} must have exactly one page in the plan`);
  for (const p of sm.pages) { if (p.cluster && !ids.has(p.cluster)) bad.push(`page ${p.path} names cluster ${p.cluster}, which is not in the approved targets`); if (!fs.existsSync(path.join(srcDir, p.brief.replace(/^plan\//, "")))) bad.push(`page ${p.path}: brief ${p.brief} is missing`); }
  if (bad.length) { log(`FAIL approve: the plan does not match the approved targets, nothing approved (${bad.length} problem(s))`); for (const b of bad.slice(0, 10)) log(`  ${b}`); return 1; }
  const files = planFiles(srcDir), nh = hashMap(srcDir, files);
  const oldDir = path.join(dir, "plan");
  log(fs.existsSync(oldDir) ? `Diff of ${path.relative(pewp, srcDir)} against the approved plan:` : `First approval of the plan (${sm.pages.length} pages, ${files.length} files).`);
  for (const l of fs.existsSync(oldDir) ? diffPlan(oldDir, srcDir) : []) log("  " + l);
  const tsha = lock.targets.files["targets.json"];
  const oh = lock.plan ? lock.plan.files : null;
  const same = oh && JSON.stringify(Object.entries(oh).map(([k, v]) => [k.replace(/^plan\//, ""), v]).sort()) === JSON.stringify(Object.entries(nh).sort()) && lock.plan.targetsSha256 === tsha;
  if (same) { log("PASS approve plan: no change, already approved"); return 0; }
  if (!by) { log(`NOT SIGNED: approving is the owner's act. Re-run with --by "<owner name>" after the owner has read the diff.`); return 3; }
  if (fs.existsSync(oldDir)) { const h = path.join(dir, "history", stamp.replace(/[:.]/g, "-")); fs.mkdirSync(h, { recursive: true }); fs.cpSync(oldDir, path.join(h, "plan"), { recursive: true }); fs.rmSync(oldDir, { recursive: true, force: true }); }
  copyDir(srcDir, oldDir, files);
  lock.plan = { approvedAt: stamp, approvedBy: by, researchRun: lock.targets.researchRun, targetsSha256: tsha, source: from === "proposals" ? "proposals/plan" : "plan", files: Object.fromEntries(Object.entries(nh).map(([k, v]) => ["plan/" + k, v])) };
  fs.writeFileSync(path.join(dir, "lock.json"), JSON.stringify(lock, null, 1) + "\n");
  log(`PASS approve plan: ${sm.pages.length} pages, ${files.length} files signed by ${by} at ${stamp} (for targets ${tsha.slice(0, 12)})`);
  return 0;
}

function main() {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
  const pos = a.filter((x, i) => !x.startsWith("--") && !["--by", "--from", "--run", "--cwd", "--pewp"].includes(a[i - 1]));
  if (!opt("--pewp") && pos.length < 1) { console.error('usage: node approve.mjs <target> targets|plan [--by "<name>"] [--from proposals] [--run ID] [--cwd DIR] [--pewp DIR] | <target> --check'); process.exit(2); }
  const pewp = opt("--pewp") ? path.resolve(opt("--pewp")) : locate(pos[0], { cwd: opt("--cwd") || process.cwd() }).pewp;
  if (a.includes("--check")) {
    const r = verifyLock(pewp);
    if (!r.exists) { console.log("ERROR approve --check cannot judge: nothing is approved yet (no approved/ folder)"); process.exit(2); }
    if (!r.ok || r.stale.length) { console.log(`FAIL approve-lock ${r.problems.length + r.stale.length} problem(s)`); for (const p of r.problems) console.log(`  ${p}`); for (const s of r.stale) console.log(`  STALE ${s}`); process.exit(1); }
    console.log(`PASS approve-lock ${Object.keys(r.lock.targets?.files || {}).length + Object.keys(r.lock.plan?.files || {}).length} approved file(s) unchanged${r.lock.targets ? `, targets by ${r.lock.targets.approvedBy}` : ""}`);
    for (const s of r.stale) console.log(`  STALE ${s}`);
    process.exit(0);
  }
  const kind = pos[pos.length - 1];
  if (!["targets", "plan"].includes(kind)) { console.error("say what to approve: targets or plan"); process.exit(2); }
  process.exit(approve(pewp, kind, { by: opt("--by"), from: opt("--from"), run: opt("--run") }));
}
if (isMain(import.meta.url)) main();
