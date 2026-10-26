// causes-map: bring the root causes of a LIVE audit (a snapshot's .checks/causes.json) into the repo's own causes file, so a fix run
// (refactor.mjs) can take them. There is no other path from a live finding to a fix.
// Usage: node causes-map.mjs <repo> --live <snapshot>/.checks/causes.json [--out <file, default <repo>/.checks/causes.json>] [--dry]
//   <repo>   the folder that holds .checks/causes.json from the repo checker (coordinator.md audit of the code); exit 2 if it is missing
//   A live cause whose `rules` share a rule id with a repo cause is attached to that repo cause as
//     liveEvidence: { pages, findings, snapshot, liveCheckScripts:[abs paths], causes:[{id,severity,rules,problem,fix}] }
//   (several live causes may attach to one repo cause). A live cause that matches no repo cause is appended as a new cause
//     { id:"L01".., origin:"live", severity, rules, fixAt:"UNKNOWN: ...", problem, fix, pages, findings, scripts:[], liveChecks:[abs paths] }
//   Order: the repo's causes first, then the live ones; most severe first inside each group (stable). Ids never collide.
//   Idempotent: the file's own marks (origin "live" causes, liveEvidence) are stripped before mapping, so running it twice, or again
//   with a newer live file, gives the same result and never duplicates. The unmarked repo list is kept in causes.repo-original.json
//   beside it (rewritten whenever the file being read carries no marks of ours, i.e. after the repo checker ran again).
//   --dry prints the result and writes nothing. Exit 0 done, 2 usage / missing input. Local files only; no network.
import fs from "node:fs";
import path from "node:path";
import { isMain } from "./lib-main.mjs";

const SEV = { critical: 0, high: 1, medium: 2, low: 3 };
const sevRank = (c) => SEV[String(c.severity || "").toLowerCase()] ?? 9;
const ruleSet = (c) => new Set((c.rules || []).map((r) => String(r).trim().toUpperCase()).filter(Boolean));
const stableBySeverity = (list) => list.map((c, i) => [c, i]).sort((a, b) => sevRank(a[0]) - sevRank(b[0]) || a[1] - b[1]).map((x) => x[0]);
const isOurs = (c) => c && (c.origin === "live" || c.liveEvidence !== undefined);

// The repo's own list: our L-causes dropped, our liveEvidence removed.
export function stripMarks(causes) {
  return causes.filter((c) => !(c && c.origin === "live")).map((c) => { if (c.liveEvidence === undefined) return c; const { liveEvidence, ...rest } = c; return rest; });
}

// repoCauses: array (unmarked or marked). liveCauses: array from the snapshot. snapshotDir: absolute folder that holds .checks/.
// -> { causes, attached: [liveId...], added: [liveId...], missingScripts: [path...] }
export function mapCauses(repoCauses, liveCauses, snapshotDir) {
  const base = stableBySeverity(stripMarks(repoCauses));
  const scriptsDir = path.join(snapshotDir, ".checks", "scripts");
  const abs = (c) => (c.scripts || []).map((s) => path.resolve(scriptsDir, s));
  const used = new Set(base.map((c) => c.id));
  const attached = new Set();
  const evid = new Map(); // repo cause id -> accumulated
  const unmatched = [];
  for (const lc of stableBySeverity(liveCauses)) {
    const lr = ruleSet(lc);
    const hits = base.filter((rc) => [...ruleSet(rc)].some((r) => lr.has(r)));
    if (!hits.length) { unmatched.push(lc); continue; }
    attached.add(lc.id);
    for (const rc of hits) {
      const e = evid.get(rc.id) || { pages: 0, findings: [], snapshot: snapshotDir, liveCheckScripts: [], causes: [] };
      e.pages = Math.max(e.pages, Number(lc.pages) || 0);
      for (const f of lc.findings || []) if (!e.findings.includes(f)) e.findings.push(f);
      for (const s of abs(lc)) if (!e.liveCheckScripts.includes(s)) e.liveCheckScripts.push(s);
      e.causes.push({ id: lc.id, severity: lc.severity, rules: lc.rules || [], problem: lc.problem, fix: lc.fix });
      evid.set(rc.id, e);
    }
  }
  const withEvidence = base.map((rc) => (evid.has(rc.id) ? { ...rc, liveEvidence: evid.get(rc.id) } : rc));
  let n = 0;
  const nextId = () => { let id; do { id = "L" + String(++n).padStart(2, "0"); } while (used.has(id)); used.add(id); return id; };
  const added = unmatched.map((lc) => ({
    id: nextId(), origin: "live", severity: lc.severity, rules: lc.rules || [],
    fixAt: "UNKNOWN: find the source of this live finding (the worker names the file it changed)",
    problem: lc.problem, fix: lc.fix, pages: lc.pages, findings: lc.findings || [], scripts: [], liveChecks: abs(lc),
    liveId: lc.id, liveSnapshot: snapshotDir, liveFixAt: lc.fixAt || [],
  }));
  const missingScripts = [...new Set([...withEvidence.flatMap((c) => c.liveEvidence?.liveCheckScripts || []), ...added.flatMap((c) => c.liveChecks)])].filter((p) => !fs.existsSync(p));
  return { causes: [...withEvidence, ...added], attached: [...attached], added: added.map((c) => c.id), missingScripts, repoCount: base.length };
}

function main(argv) {
  const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
  const usage = "usage: node causes-map.mjs <repo> --live <snapshot>/.checks/causes.json [--out <repo>/.checks/causes.json] [--dry]";
  if (argv.includes("--help") || argv.includes("-h")) { console.log(usage); return 0; }
  const positional = argv.filter((x, i) => !x.startsWith("--") && !["--live", "--out"].includes(argv[i - 1]));
  if (!positional[0] || !opt("--live")) { console.error(usage); return 2; }
  const repo = path.resolve(positional[0]);
  const repoFile = path.join(repo, ".checks", "causes.json");
  const liveFile = path.resolve(opt("--live"));
  const outFile = path.resolve(opt("--out") || repoFile);
  const readJson = (f, what) => { try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")); } catch (e) { console.error(`${what} ${f} cannot be read as JSON: ${e.message}`); process.exit(2); } };
  if (!fs.existsSync(repoFile)) { console.error(`no ${repoFile}: run the repo checker first (the audit of the code, coordinator.md), then map the live causes onto it`); return 2; }
  if (!fs.existsSync(liveFile)) { console.error(`no live causes file ${liveFile}: --live takes <snapshot>/.checks/causes.json from the live audit`); return 2; }
  const repoRaw = readJson(repoFile, "the repo causes file");
  const live = readJson(liveFile, "the live causes file");
  if (!Array.isArray(repoRaw) || !Array.isArray(live)) { console.error("both causes files must be a JSON array of causes"); return 2; }
  const snapshotDir = path.resolve(path.dirname(path.dirname(liveFile)));
  const r = mapCauses(repoRaw, live, snapshotDir);
  console.log(`causes-map: ${r.repoCount} repo causes, ${r.attached.length} live attached, ${r.added.length} live added as new causes`);
  for (const c of r.causes) {
    if (c.liveEvidence) console.log(`  ${c.id} (repo) <- live ${c.liveEvidence.causes.map((x) => x.id).join(", ")}`);
    else if (c.origin === "live") console.log(`  ${c.id} (live ${c.liveId}, ${c.severity}) ${String(c.problem).slice(0, 90)}`);
  }
  if (r.missingScripts.length) console.log(`  NOTE: ${r.missingScripts.length} live check script(s) not found under ${snapshotDir}/.checks/scripts; those causes will end NEEDS-PROOF in the fix run`);
  if (argv.includes("--dry")) { console.log(`--dry: nothing written (would write ${outFile})`); return 0; }
  // keep the repo's own list (only when the file we read carries none of our marks, so a later run never keeps a marked copy)
  if (outFile === repoFile && !repoRaw.some(isOurs)) fs.writeFileSync(path.join(path.dirname(repoFile), "causes.repo-original.json"), JSON.stringify(repoRaw, null, 1) + "\n");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(r.causes, null, 1) + "\n");
  console.log(`wrote ${outFile}`);
  return 0;
}

if (isMain(import.meta.url)) process.exit(main(process.argv.slice(2)));
