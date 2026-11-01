// The runner: node tools/audit/run.mjs <folder> [--json] [--only MET-003,MET-001] [--psi FILE] [--target preview|production] [--list]
// Prints PASS / WARN / FAIL / SKIP lines. Exit 0 = no FAIL (WARN and SKIP do not fail), 1 = at least one FAIL, 2 = usage error or missing folder.
const USAGE = "usage: node tools/audit/run.mjs <folder> [--json] [--only MET-003,MET-001] [--psi FILE] [--target preview|production] [--list]";
const die = (msg) => { console.error(msg); process.exit(2); };

const args = process.argv.slice(2);
let folder = null, json = false, list = false, only = null, psi = null, target = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--json") json = true;
  else if (a === "--list") list = true;
  else if (a === "--psi") { psi = args[++i]; if (!psi || psi.startsWith("--")) die(`--psi needs a PageSpeed Insights file (the psi/<date>.json psi.mjs writes)
${USAGE}`); }
  else if (a === "--target") { target = args[++i]; if (target !== "preview" && target !== "production") die(`--target needs preview or production (got ${target === undefined ? "nothing" : JSON.stringify(target)})\n${USAGE}`); }
  else if (a === "--only") { const v = args[++i]; if (!v || v.startsWith("--")) die(`--only needs a rule id list\n${USAGE}`); only = v.split(",").map((s) => s.trim()).filter(Boolean); if (!only.length) die(`--only needs a rule id list\n${USAGE}`); }
  else if (a.startsWith("--")) die(`unknown option ${a}\n${USAGE}`);
  else if (folder === null) folder = a;
  else die(`more than one folder given\n${USAGE}`);
}

let engine;
try { engine = await import(new URL("./index.mjs", import.meta.url).href); }
catch (e) { die(`engine refused to load: ${e.message}`); }

if (list) {
  for (const r of engine.listRules()) console.log(`${r.id.padEnd(8)} ${r.severity.padEnd(3)} ${r.source}`);
  process.exit(0);
}
if (!folder) die(USAGE);
try {
  const r = engine.audit(folder, { rules: only || undefined, psi: psi || undefined, target: target || undefined });
  if (json) console.log(JSON.stringify(r, null, 2));
  else {
    for (const l of r.lines) console.log(l);
    const n = (s) => r.findings.filter((f) => f.status === s).length;
    console.error(`${r.pass ? "OK" : "FAILED"}: ${r.pages.length} page(s), ${r.rules.length} rule(s), ${n("FAIL")} FAIL, ${n("WARN")} WARN, ${n("SKIP")} SKIP`);
  }
  process.exit(r.exit);
} catch (e) {
  if (e && e.exit === 2) die(e.message);
  throw e;
}
