// Operator verbs `approve targets`, `approve plan` (shipgate 06 TR-235) and, from the overhaul mode, `approve business|competitors|seeds|prompt-map|research-cost`,
// and the lock check every later stage uses.
// Usage: node approve.mjs <target> targets|plan|business|competitors|seeds|prompt-map|research-cost [--by "<owner name>"] [--from proposals] [--run <research run id>] [--cwd DIR] [--pewp DIR]
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
// business | competitors | seeds | prompt-map | research-cost (contract C1): the same diff / sign / lock behaviour for one file each:
//   business.json                          -> approved/business.json     REFUSED (exit 1) while an owner-only field (kind, offer, audience, goals, competitors,
//                                            brand.constraints, vocabulary) has a provenance other than "owner" (intake.mjs writes provenance; stages/intake.md)
//   research/competitors-proposed.json    -> approved/competitors.json  REFUSED while a row lacks evidenceUrl, kind, closeness 1..5, or both domain and handle
//   research/seeds.json                    -> approved/seeds.json        REFUSED while a query lacks `from` (where it came from)
//   research/prompt-map.json               -> approved/prompt-map.json   REFUSED while a row fails the prompt-map validator (lib-prompt-map.mjs); plan-site.mjs reads the approved copy first
//   research/research-cost.json            -> approved/research-cost.json REFUSED while calls are not whole numbers, total is not their sum, or the competitor list does not match its sha256;
//                                            research.mjs lets a plan above its call limit run when its numbers, cost in money and competitor list fit this record (signedCopy)
// approvedMatches(pewp, kind) says whether the approved copy is current (sha256 of the source == the lock entry).
// Exit 0 approved / no change / lock ok, 1 invalid source or lock failed, 2 cannot judge (file missing), 3 diff shown, not signed (no --by).
import fs from "node:fs";
import { delegationOf } from "./lib-provenance.mjs";
import { isMain } from "./lib-main.mjs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { locate } from "./state.mjs";
import { validate, validateBusiness } from "./targets-validate.mjs";
import { validateMap } from "./lib-prompt-map.mjs";

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")); // a BOM from a Windows editor is not "not JSON"
const jr = (p, d = null) => { try { return J(p); } catch { return d; } };
const EXCLUDE_PLAN = new Set(["programmatic-data.json"]);
export const approvedDir = (pewp) => path.join(pewp, "approved");
// The single-file kinds (contract C1): the working file the owner reads, and its approved copy under approved/.
export const FILE_KINDS = {
  business: { src: "business.json", dst: "business.json" },
  competitors: { src: "research/competitors-proposed.json", dst: "competitors.json" },
  seeds: { src: "research/seeds.json", dst: "seeds.json" },
  "prompt-map": { src: "research/prompt-map.json", dst: "prompt-map.json" }, // DECISIONS 35: plan-site.mjs reads the approved copy first
  "research-cost": { src: "research/research-cost.json", dst: "research-cost.json" }, // SKILL-RESEARCHCOST-1: research.mjs reads the approved copy to let a plan above its call limit run
};
export const OWNER_ONLY = ["kind", "offer", "audience", "goals", "competitors", "brand.constraints", "vocabulary"];

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
  const hasKind = (k) => fs.existsSync(path.join(dir, FILE_KINDS[k].dst));
  if (!lock && !hasTargets && !hasPlan && !Object.keys(FILE_KINDS).some(hasKind)) return { exists: false, ok: true, problems: [], stale: [], lock: null };
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
  for (const k of Object.keys(FILE_KINDS)) { // business | competitors | seeds | prompt-map | research-cost: each approved file is listed in the lock and unchanged
    const entry = lock?.[k], f = FILE_KINDS[k].dst;
    if (!entry) { if (hasKind(k)) problems.push(`approved/${f} exists but is not in the lock`); continue; }
    for (const [rel, want] of Object.entries(entry.files)) {
      const fp = path.join(dir, rel);
      if (!fs.existsSync(fp)) problems.push(`${rel}: approved file is missing`);
      else if (sha256(fs.readFileSync(fp)) !== want) problems.push(`${rel}: changed after approval (sha256 differs from the lock)`);
    }
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

// ---------- business | competitors | seeds | prompt-map | research-cost (contract C1) ----------
const nonEmpty = (x) => typeof x === "string" && x.trim().length > 0;
const FIX = {
  business: 'Ask the owner, write the answer as {"value":..., "answeredBy":"owner"} in intake-answers.json, run intake again',
  competitors: "run competitors-discover.mjs again (every row needs one evidence URL, a kind, a closeness 1 to 5, and a domain or a handle) or fix the rows in research/competitors-proposed.json",
  seeds: 'run research-seeds.mjs again (it records where each query came from) or add "from" to each query in research/seeds.json',
  "research-cost": "run research.mjs <target> --dry again",
};
// Each check returns the reasons the file cannot be approved (empty = approvable).
function checkBusiness(b) {
  const out = [];
  const v = validateBusiness(b);
  if (!v.ok) { out.push(`business.json is not a valid business (${v.errors.length} error(s)); run intake until it says COMPLETE`); for (const e of v.errors.slice(0, 8)) out.push(`  ${e.rule} ${e.path}: ${e.message}`); return out; }
  const prov = b.provenance && typeof b.provenance === "object" && !Array.isArray(b.provenance) ? b.provenance : {};
  const groups = new Map();
  for (const field of OWNER_ONLY) {
    const missingValue = field === "vocabulary" && (!Array.isArray(b.vocabulary) || !b.vocabulary.length);
    let p = missingValue ? "unstated" : prov[field] || "unstated";
    if (p === "delegated" && !delegationOf(b.delegations?.[field])) p = "delegated without a record of who and when (business.delegations)"; // a hand-written "delegated" proves nothing
    if (p !== "owner" && p !== "delegated") groups.set(p, [...(groups.get(p) || []), field]);
  }
  for (const [p, fields] of groups) out.push(`${fields.join(", ")} ${fields.length > 1 ? "were" : "was"} not answered by the owner (provenance: ${p}). ${FIX.business}`);
  return out;
}
function rowsOf(doc) { return Array.isArray(doc) ? doc : Array.isArray(doc?.rows) ? doc.rows : null; }
function checkCompetitors(doc) {
  const rows = rowsOf(doc);
  if (!rows || !rows.length) return [`no rows in the competitors file; ${FIX.competitors}`];
  const out = [];
  rows.forEach((r, i) => {
    if (!r || typeof r !== "object") { out.push(`row ${i + 1}: not an object`); return; }
    const name = r.name || r.domain || r.handle || `row ${i + 1}`, why = [];
    if (!nonEmpty(r.evidenceUrl) || !/^https?:\/\//i.test(r.evidenceUrl)) why.push("no evidenceUrl");
    if (!nonEmpty(r.kind)) why.push("no kind");
    if (!(Number.isInteger(r.closeness) && r.closeness >= 1 && r.closeness <= 5)) why.push("closeness is not a whole number from 1 to 5");
    if (!nonEmpty(r.domain) && !nonEmpty(r.handle)) why.push("neither a domain nor a handle");
    if (why.length) out.push(`${name}: ${why.join(", ")}`);
  });
  if (out.length) out.push(`(${out.length} of ${rows.length} rows) ${FIX.competitors}`);
  return out;
}
function checkSeeds(doc) {
  const q = doc && Array.isArray(doc.queries) ? doc.queries : null;
  if (!q || !q.length) return [`seeds.json has no queries (${doc?.status === "blocked" ? "the seeds step is BLOCKED" : "run research-seeds.mjs"})`];
  const bad = q.filter((x) => !x || typeof x !== "object" || !nonEmpty(x.from));
  if (!bad.length) return [];
  return [`${bad.length} of ${q.length} queries have no "from" (where the query came from): ${bad.slice(0, 6).map((x) => JSON.stringify(x?.query ?? x)).join(", ")}${bad.length > 6 ? ", ..." : ""}. ${FIX.seeds}`];
}
function checkPromptMap(doc) {
  const v = validateMap(doc);
  if (!v.ok) return [`prompt-map.json is not a valid prompt map (${v.errors.length} error(s)); run research-prompts.mjs <target> --check`, ...v.errors.slice(0, 8).map((e) => `  ${e.rule} ${e.id}: ${e.message}`)];
  return v.rows ? [] : ["prompt-map.json has no rows"];
}
// SKILL-RESEARCHCOST-1: the cost of a research plan, written by research.mjs (--dry, or a plan above the limit that was refused)
function checkResearchCost(doc) {
  const d = doc && typeof doc === "object" && !Array.isArray(doc) ? doc : {}, out = [];
  const entries = d.calls && typeof d.calls === "object" && !Array.isArray(d.calls) ? Object.entries(d.calls) : [];
  if (!entries.length) out.push("calls is not an object with at least one source");
  const bad = entries.filter(([, n]) => !(Number.isInteger(n) && n >= 0));
  for (const [k, n] of bad) out.push(`${k}: ${JSON.stringify(n)} is not a whole number of 0 or more`);
  const sum = entries.reduce((s, [, n]) => s + n, 0);
  if (!bad.length && d.total !== sum) out.push(`total ${JSON.stringify(d.total)} is not the sum of the calls (${sum})`);
  if (!nonEmpty(d.costInMoney)) out.push("costInMoney is not a non-empty text");
  const sites = d.competitors?.sites, sitesOk = Array.isArray(sites) && sites.every(nonEmpty);
  if (!sitesOk) out.push("competitors.sites is not a list of non-empty texts");
  if (sitesOk && d.competitors.sha256 !== sha256(JSON.stringify(d.competitors.sites))) out.push("competitors.sha256 is not the sha256 of competitors.sites (the list the plan covers)");
  if (out.length) out.push(FIX["research-cost"]);
  return out;
}
const costSummary = (d) => `${d.total} external calls (${Object.entries(d.calls).map(([k, n]) => `${k} ${n}`).join(", ")}), ${d.costInMoney}, ${d.competitors.sites.length} competitor sites`;
const CHECKS = { business: checkBusiness, competitors: checkCompetitors, seeds: checkSeeds, "prompt-map": checkPromptMap, "research-cost": checkResearchCost };
const NOTFOUND = { business: " (run intake.mjs)", competitors: " (run competitors-discover.mjs)", seeds: " (run research-seeds.mjs)", "prompt-map": " (write research/prompt-map.json: stages/research.md, Prompt map)", "research-cost": " (run research.mjs <target> --dry)" };

function diffFile(kind, o, n) {
  const L = [];
  if (kind === "business") {
    for (const k of new Set([...Object.keys(o), ...Object.keys(n)])) if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) L.push(`~ ${k}: ${short(o[k])} -> ${short(n[k])}`);
  } else if (kind === "competitors") {
    const key = (r) => `${r.platform || "?"}|${String(r.handle || r.domain || r.name).toLowerCase()}`;
    const om = new Map((rowsOf(o) || []).map((r) => [key(r), r])), nm = new Map((rowsOf(n) || []).map((r) => [key(r), r]));
    for (const [k, r] of nm) if (!om.has(k)) L.push(`+ ${r.name} (${r.handle || r.domain}, ${r.kind}, closeness ${r.closeness})`);
    for (const [k, r] of om) if (!nm.has(k)) L.push(`- ${r.name} (${r.handle || r.domain})`);
    for (const [k, r] of nm) { const p = om.get(k); if (!p) continue; for (const f of ["kind", "closeness", "evidenceUrl", "domain", "handle"]) if (JSON.stringify(p[f]) !== JSON.stringify(r[f])) L.push(`~ ${r.name}.${f}: ${short(p[f])} -> ${short(r[f])}`); }
  } else if (kind === "prompt-map") {
    const om = new Map((rowsOf(o) || []).map((r) => [r.id, r])), nm = new Map((rowsOf(n) || []).map((r) => [r.id, r]));
    for (const [k, r] of nm) if (!om.has(k)) L.push(`+ ${k} "${short(r.prompt)}" (${r.fix?.kind})`);
    for (const [k, r] of om) if (!nm.has(k)) L.push(`- ${k} "${short(r.prompt)}"`);
    for (const [k, r] of nm) { const p = om.get(k); if (p && JSON.stringify(p.fix) !== JSON.stringify(r.fix)) L.push(`~ ${k}.fix: ${short(p.fix?.kind)} -> ${short(r.fix?.kind)}`); }
  } else if (kind === "research-cost") {
    const oc = o.calls || {}, nc = n.calls || {}, os = o.competitors?.sites || [], ns = n.competitors?.sites || [];
    for (const k of new Set([...Object.keys(oc), ...Object.keys(nc)])) if (oc[k] !== nc[k]) L.push(`~ ${k}: ${oc[k] ?? 0} -> ${nc[k] ?? 0}`);
    if (o.total !== n.total) L.push(`~ total: ${o.total} -> ${n.total}`);
    if (o.costInMoney !== n.costInMoney) L.push(`~ cost in money: ${o.costInMoney} -> ${n.costInMoney}`);
    for (const x of ns) if (!os.includes(x)) L.push(`+ ${x}`);
    for (const x of os) if (!ns.includes(x)) L.push(`- ${x}`);
  } else {
    const om = new Map((o.queries || []).map((q) => [q.query, q])), nm = new Map((n.queries || []).map((q) => [q.query, q]));
    for (const [k, q] of nm) if (!om.has(k)) L.push(`+ "${k}" (from ${short(q.from)})`);
    for (const k of om.keys()) if (!nm.has(k)) L.push(`- "${k}"`);
    for (const [k, q] of nm) { const p = om.get(k); if (p && JSON.stringify(p.from) !== JSON.stringify(q.from)) L.push(`~ "${k}".from: ${short(p.from)} -> ${short(q.from)}`); }
  }
  return L;
}

// the owner-only fields a delegate answered: [{ field, by, delegatedBy, at }]
const delegatedOf = (b) => OWNER_ONLY.filter((f) => b?.provenance?.[f] === "delegated" && delegationOf(b.delegations?.[f])).map((f) => ({ field: f, ...delegationOf(b.delegations[f]) }));
function approveFile(pewp, kind, { by, log, lock, stamp }) {
  const spec = FILE_KINDS[kind], dir = approvedDir(pewp), src = path.join(pewp, ...spec.src.split("/")), dstFile = path.join(dir, spec.dst);
  if (!fs.existsSync(src)) { log(`ERROR approve cannot judge: ${src} not found${NOTFOUND[kind]}`); return 2; }
  let doc; try { doc = J(src); } catch (e) { log(`ERROR approve cannot judge: ${src} is not JSON: ${e.message}`); return 2; }
  const problems = CHECKS[kind](doc);
  if (problems.length) { log(`FAIL approve ${kind}: ${spec.src} cannot be approved yet, nothing approved`); for (const p of problems) log(`  ${p}`); return 1; }
  const deleg = kind === "business" ? delegatedOf(doc) : [];
  if (deleg.length) log(`NOTE ${deleg.length} owner-only field(s) were answered by a delegate for the owner, not by the owner: ${deleg.map((d) => `${d.field} (by ${d.by}, delegated by the ${d.delegatedBy}, ${d.at})`).join("; ")}`);
  const buf = fs.readFileSync(src), sha = sha256(buf), old = jr(dstFile);
  log(old ? `Diff of ${spec.src} against the approved ${kind} (${String(lock[kind]?.files?.[spec.dst] || "").slice(0, 8)}):` : `First approval of the ${kind} (${spec.src}).`);
  const d = old ? diffFile(kind, old, doc) : [];
  for (const l of d) log("  " + l);
  if (old && lock[kind]?.files?.[spec.dst] === sha) { log(`PASS approve ${kind}: no change, already approved`); return 0; }
  if (old && !d.length) log("  (only formatting differs)");
  if (!by) { log(`NOT SIGNED: approving is the owner's act. Re-run with --by "<owner name>" after the owner has read ${old ? "the diff" : spec.src}.`); return 3; }
  if (old) { const h = path.join(dir, "history", stamp.replace(/[:.]/g, "-")); fs.mkdirSync(h, { recursive: true }); fs.copyFileSync(dstFile, path.join(h, spec.dst)); }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dstFile, buf);
  lock[kind] = { approvedAt: stamp, approvedBy: by, source: spec.src, files: { [spec.dst]: sha }, ...(deleg.length ? { delegated: deleg } : {}) };
  fs.writeFileSync(path.join(dir, "lock.json"), JSON.stringify(lock, null, 1) + "\n");
  const n = kind === "competitors" || kind === "prompt-map" ? `${rowsOf(doc).length} rows` : kind === "seeds" ? `${doc.queries.length} queries` : kind === "research-cost" ? costSummary(doc) : `${doc.name || doc.domain}`;
  log(`PASS approve ${kind}: ${n} signed by ${by} at ${stamp} (sha256 ${sha.slice(0, 12)})${deleg.length ? `; ${deleg.length} owner-only field(s) DELEGATED: ${deleg.map((d) => d.field).join(", ")}` : ""}`);
  return 0;
}

// Is the approved copy of a file kind the signed one? Only the approved file and the lock are looked at, never the working file:
// research.mjs asks this of research-cost, where a plan smaller than the approved one is still approved (approvedMatches would say no).
export function signedCopy(pewp, kind) {
  const spec = FILE_KINDS[kind], entry = readLock(pewp)?.[kind], f = path.join(approvedDir(pewp), spec.dst), want = entry?.files?.[spec.dst];
  if (!want || !fs.existsSync(f)) return { ok: false, signed: false, reason: `${kind} is not approved yet` };
  const have = sha256(fs.readFileSync(f));
  return have === want ? { ok: true, signed: true, doc: jr(f), entry } : { ok: false, signed: true, reason: `approved/${spec.dst} was changed after approval (sha256 differs from the lock)` };
}

// Is the approved copy of <kind> current? ok when the approved file is unchanged and the working file still has the signed sha256.
export function approvedMatches(pewp, kind) {
  const dir = approvedDir(pewp), lock = readLock(pewp), entry = lock?.[kind];
  const how = `node approve.mjs <target> ${kind} --by "<owner name>"`;
  if (kind === "plan") {
    if (!entry) return { ok: false, reason: `plan is not approved yet (no plan entry in approved/lock.json): ${how}` };
    const srcDir = path.join(pewp, "plan"), nh = hashMap(srcDir, planFiles(srcDir));
    const oh = Object.fromEntries(Object.entries(entry.files).map(([k, v]) => [k.replace(/^plan\//, ""), v]));
    return JSON.stringify(Object.entries(nh).sort()) === JSON.stringify(Object.entries(oh).sort()) ? { ok: true, reason: "the approved plan matches plan/" } : { ok: false, reason: `plan/ changed since it was approved: ${how}` };
  }
  const spec = kind === "targets" ? { src: "targets.json", dst: "targets.json" } : FILE_KINDS[kind];
  if (!spec) return { ok: false, reason: `unknown kind "${kind}" (targets, plan, business, competitors, seeds, prompt-map, research-cost)` };
  if (!entry) return { ok: false, reason: `${kind} is not approved yet (no ${kind} entry in approved/lock.json): ${how}` };
  const want = entry.files?.[spec.dst], dstFile = path.join(dir, spec.dst), srcFile = path.join(pewp, ...spec.src.split("/"));
  if (!fs.existsSync(dstFile)) return { ok: false, reason: `approved/${spec.dst} is missing` };
  if (sha256(fs.readFileSync(dstFile)) !== want) return { ok: false, reason: `approved/${spec.dst} was changed after approval (sha256 differs from the lock)` };
  if (!fs.existsSync(srcFile)) return { ok: false, reason: `${spec.src} is missing, so the approved copy cannot be compared` };
  const now = sha256(fs.readFileSync(srcFile));
  if (now !== want) return { ok: false, reason: `${spec.src} changed since it was approved (approved ${String(want).slice(0, 8)}, now ${now.slice(0, 8)}): ${how}` };
  return { ok: true, reason: `${spec.src} is the approved ${kind} (signed by ${entry.approvedBy})` };
}

export function approve(pewp, kind, { by = null, from = null, run = null, log = console.log } = {}) {
  const dir = approvedDir(pewp), lockNow = verifyLock(pewp);
  if (lockNow.exists && !lockNow.ok) { for (const p of lockNow.problems) log(`  ${p}`); log("FAIL approve: the approved files changed after approval; restore them (or delete approved/ and approve again) before approving anything new"); return 1; }
  const stamp = new Date().toISOString();
  const lock = lockNow.lock || { formatVersion: 1 };
  if (FILE_KINDS[kind]) return approveFile(pewp, kind, { by, log, lock, stamp });
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
  if (!opt("--pewp") && pos.length < 1) { console.error('usage: node approve.mjs <target> targets|plan|business|competitors|seeds|prompt-map|research-cost [--by "<name>"] [--from proposals] [--run ID] [--cwd DIR] [--pewp DIR] | <target> --check'); process.exit(2); }
  const pewp = opt("--pewp") ? path.resolve(opt("--pewp")) : locate(pos[0], { cwd: opt("--cwd") || process.cwd() }).pewp;
  if (a.includes("--check")) {
    const r = verifyLock(pewp);
    if (!r.exists) { console.log("ERROR approve --check cannot judge: nothing is approved yet (no approved/ folder)"); process.exit(2); }
    if (!r.ok || r.stale.length) { console.log(`FAIL approve-lock ${r.problems.length + r.stale.length} problem(s)`); for (const p of r.problems) console.log(`  ${p}`); for (const s of r.stale) console.log(`  STALE ${s}`); process.exit(1); }
    const extra = Object.keys(FILE_KINDS).filter((k) => r.lock[k]);
    console.log(`PASS approve-lock ${Object.keys(r.lock.targets?.files || {}).length + Object.keys(r.lock.plan?.files || {}).length + extra.reduce((n, k) => n + Object.keys(r.lock[k].files || {}).length, 0)} approved file(s) unchanged${r.lock.targets ? `, targets by ${r.lock.targets.approvedBy}` : ""}${extra.map((k) => `, ${k} by ${r.lock[k].approvedBy}`).join("")}`);
    for (const k of extra) { const m = approvedMatches(pewp, k); if (!m.ok) console.log(`  NOTE ${k}: ${m.reason}`); }
    for (const s of r.stale) console.log(`  STALE ${s}`);
    process.exit(0);
  }
  const kind = pos[pos.length - 1];
  if (!["targets", "plan", ...Object.keys(FILE_KINDS)].includes(kind)) { console.error("say what to approve: targets, plan, business, competitors, seeds, prompt-map or research-cost"); process.exit(2); }
  process.exit(approve(pewp, kind, { by: opt("--by"), from: opt("--from"), run: opt("--run") }));
}
if (isMain(import.meta.url)) main();
