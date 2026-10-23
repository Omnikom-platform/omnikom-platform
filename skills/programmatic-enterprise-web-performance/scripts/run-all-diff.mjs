// Before/after comparison of two `.checks/run-all.mjs --json` results: the proof standard of refactor mode.
// A fix is proven when the cause's own check scripts go from not-passing to passing AND no other check that
// passed before stops passing (a check that now errors, or whose script was deleted, counts as stopped) AND no check that was not
// failing before (pass, cannot judge, missing) FAILS now (`newlyFailing`; `broken` = regressed + newlyFailing, what rejects a fix).
// Usage (CLI):
//   node run-all-diff.mjs snapshot <site root> <out.json>      run <root>/.checks/run-all.mjs --json, save the result
//   node run-all-diff.mjs diff <before.json> <after.json> [--targets check-a.mjs,check-b.mjs] [--json]
//   exit 0 = no regression, 1 = at least one check went PASS -> not pass, or became newly failing (was pass / cannot judge /
//   missing, FAILS now), 2 = bad input
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Run every check of a site root and return run-all's JSON ({ summary, causes, scripts:[{script,status,line}] }).
export function snapshotRunAll(root, { timeoutMs = 600_000 } = {}) {
  const runAll = path.join(root, ".checks", "run-all.mjs");
  if (!fs.existsSync(runAll)) return { error: `no ${runAll}`, scripts: [], causes: [], summary: "" };
  const r = spawnSync(process.execPath, [runAll, "--json"], { cwd: root, encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { error: `run-all did not finish: ${r.error.code === "ETIMEDOUT" ? `stopped after ${Math.round(timeoutMs / 1000)} s` : r.error.code === "ENOBUFS" ? "its output passed 64 MiB" : r.error.code || r.error.message}`, scripts: [], causes: [], summary: "" };
  try {
    const j = JSON.parse(r.stdout);
    if (!Array.isArray(j.scripts)) throw new Error("no scripts array");
    return j;
  } catch (e) {
    return { error: `run-all gave no JSON (exit ${r.status}): ${(r.stderr || r.stdout || String(e)).slice(0, 200)}`, scripts: [], causes: [], summary: "" };
  }
}

export const toMap = (runAll) => new Map((runAll.scripts || []).map((s) => [s.script, s.status]));

// before/after: run-all JSON objects. targets: the check scripts of the cause being fixed.
export function diffRunAll(before, after, targets = []) {
  const b = toMap(before);
  const a = toMap(after);
  const status = (m, s) => m.get(s) ?? "missing";
  const fixed = [];
  const regressed = [];
  const stillFailing = [];
  // newlyFailing: a check that was NOT failing before (pass, cannot judge = "error", or missing) and FAILS ("open") now. A check that
  // could not judge at the audit (no sitemap existed yet) and fails once a fix creates the thing it judges is a defect the fix brought
  // in (2026-10-22: a clock-stamped sitemap). Pass -> open is in both lists; `regressed` keeps its old meaning for other readers.
  const newlyFailing = [];
  for (const s of new Set([...b.keys(), ...a.keys()])) {
    const was = status(b, s);
    const now = status(a, s);
    if (now === "open" && was !== "open") newlyFailing.push({ script: s, was, now });
    if (!b.has(s)) continue;
    if (was === "pass" && now !== "pass") regressed.push({ script: s, was, now });
    else if (was !== "pass" && now === "pass") fixed.push(s);
    else if (was !== "pass" && now !== "pass") stillFailing.push(s);
  }
  // everything that rejects a fix: regressions plus the newly failing checks that were not already counted as regressions
  const broken = [...regressed, ...newlyFailing.filter((x) => !regressed.some((r) => r.script === x.script))];
  const target = targets.map((s) => ({ script: s, before: status(b, s), after: status(a, s) }));
  const targetsPass = target.length > 0 && target.every((t) => t.after === "pass");
  const targetsImproved = target.some((t) => t.before !== "pass" && t.after === "pass");
  const regressedOutsideTargets = regressed.filter((r) => !targets.includes(r.script));
  return {
    fixed, regressed, newlyFailing, broken, stillFailing, target,
    targetFixed: targetsPass && targetsImproved,
    // a target check that passed before and fails now is also a regression (listed in `regressed`)
    regressedOutsideTargets,
    passBefore: [...b.values()].filter((x) => x === "pass").length,
    passAfter: [...a.values()].filter((x) => x === "pass").length,
    total: Math.max(b.size, a.size),
  };
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
  const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
  if (a[0] === "snapshot" && a[1] && a[2]) {
    const j = snapshotRunAll(path.resolve(a[1]));
    fs.mkdirSync(path.dirname(path.resolve(a[2])), { recursive: true });
    fs.writeFileSync(a[2], JSON.stringify(j, null, 1) + "\n");
    console.log(j.error ? `ERROR ${j.error}` : `snapshot: ${j.summary}`);
    process.exit(j.error ? 2 : 0);
  } else if (a[0] === "diff" && a[1] && a[2]) {
    let d;
    try { d = diffRunAll(read(a[1]), read(a[2]), (opt("--targets") || "").split(",").filter(Boolean)); } catch (e) { console.error(`cannot read inputs: ${e.message}`); process.exit(2); }
    if (a.includes("--json")) console.log(JSON.stringify(d, null, 1));
    else {
      for (const s of d.fixed) console.log(`FIXED     ${s}`);
      for (const r of d.regressed) console.log(`REGRESSED ${r.script} (${r.was} -> ${r.now})`);
      for (const r of d.newlyFailing.filter((x) => x.was !== "pass")) console.log(`NEWLY FAILING ${r.script} (${r.was} -> FAIL: it could not judge before and fails now)`);
      console.log(`${d.passBefore}/${d.total} pass before, ${d.passAfter}/${d.total} after; ${d.fixed.length} fixed, ${d.regressed.length} regressed, ${d.newlyFailing.length} newly failing${d.target.length ? `; targets ${d.targetFixed ? "FIXED" : "not fixed"}` : ""}`);
    }
    process.exit(d.broken.length ? 1 : 0);
  } else {
    console.error("usage: node run-all-diff.mjs snapshot <site root> <out.json> | diff <before.json> <after.json> [--targets a.mjs,b.mjs] [--json]");
    process.exit(2);
  }
}
