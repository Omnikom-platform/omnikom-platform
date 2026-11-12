// Usage: node test-start.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>] [--keep]
// Proof of start.mjs (the one entry over every mode's stage sequence). No real stage script runs: --stage-scripts points at
// stand-ins that log their exact command line (STUB_LOG) and behave as the scenario says (files in STUB_CTL), so the test
// checks what start runs, in what order, where it stops, what it records in state.json, and what it marks stale.
// Fixtures only: no network, no Chrome, no model. Mutants: break the code each assertion guards, expect it red, restore.
// Exit 0 = every assertion passed and every mutant was caught.
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const A = process.argv.slice(2);
const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(opt("--scripts", here));
const node = process.execPath;
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const rj = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const TODAY = "2026-10-23";

// ---------------- the stand-in stage scripts (one body, copied under every script name) ----------------
const STUB = `
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const log = process.env.STUB_LOG, ctl = process.env.STUB_CTL, real = process.env.STUB_REAL;
fs.appendFileSync(log, JSON.stringify({ script: name, args, cwd: process.cwd() }) + "\\n");
const { locate } = await import(pathToFileURL(path.join(real, "state.mjs")).href);
const opt = (k, d = null) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const ctlFile = (ext) => path.join(ctl, name + "." + ext);
const stg = opt("--stage");
const fFile = stg && fs.existsSync(path.join(ctl, name + "." + stg + ".exit")) ? path.join(ctl, name + "." + stg + ".exit") : fs.existsSync(ctlFile("exit")) ? ctlFile("exit") : null;
const forced = fFile ? Number(fs.readFileSync(fFile, "utf8")) : null;
const noout = fs.existsSync(ctlFile("noout"));
const cwd = opt("--cwd", process.cwd());
const today = opt("--today", "2026-10-23");
const locOf = (t) => locate(t, { cwd });
const say = (s) => console.log(s);
const done = (code = 0) => process.exit(forced ?? code);
if (name === "doctor.mjs") { const l = locOf(args[0]); w(path.join(l.pewp, "doctor.json"), "{}"); say("doctor ok"); done(); }
else if (name === "live-target.mjs") {
  const l = locOf(args[0]); const n = fs.readdirSync(ctl).filter((f) => f.startsWith("snap-new")).length;
  const d = path.join(l.snapshots, "2026-10-2" + (1 + n));
  w(path.join(d, "_site.json"), JSON.stringify({ url: l.target, origin: l.target.replace(/\\/$/, ""), finishedAt: new Date().toISOString(), pages: [{ url: l.target, slug: "home", status: 200 }] }));
  say("NEW " + d); done();
}
else if (name === "intake.mjs") {
  const l = locOf(args[0]);
  if (fs.existsSync(path.join(l.pewp, "intake-answers.json"))) { w(path.join(l.pewp, "business.json"), JSON.stringify({ name: "Fixture Co", competitors: ["rival.test"] })); say("intake complete"); done(); }
  else { w(path.join(l.pewp, "intake-facts.json"), JSON.stringify({ questions: [{ id: "Q1", field: "industry", question: "What kind of business is it?", options: [{ label: "real estate agent" }, { label: "other" }], recommended: 0 }] })); say("questions open"); say("NEEDS-INPUT intake: 1 question(s) for the owner"); say("BLOCKED: intake needs the owner's answers | unblocks: answer the questions above in " + path.join(l.pewp, "intake-answers.json") + " and run intake again"); process.exit(3); }
}
else if (name === "research.mjs") {
  const l = locOf(args[0]);
  if (args.includes("--dry")) { say("DRY RUN: nothing fetched. plan: 12 external calls"); done(); }
  if (!noout) w(path.join(l.pewp, "targets.json"), JSON.stringify({ clusters: [{ q: "sell house" }] }));
  say("DONE 1 clusters"); done();
}
else if (name === "plan-site.mjs") { const p = args[0]; w(path.join(p, "plan", "sitemap.json"), JSON.stringify({ pages: [{ path: "/" }] })); say("plan written"); done(); }
else if (name === "plan-picture.mjs") { const p = args[0]; w(path.join(p, "plan", "page-plan.svg"), "<svg/>"); w(path.join(p, "plan", "page-plan.md"), "| page |"); say("page plan picture: 1 page"); done(); }
else if (name === "approve.mjs") {
  const l = locOf(args[0]); const kind = args[1];
  const copy = { targets: ["approved", "targets.json"], plan: ["approved", "plan", "sitemap.json"], business: ["approved", "business.json"], competitors: ["approved", "competitors.json"], seeds: ["approved", "seeds.json"] }[kind];
  const src = { business: ["business.json"], competitors: ["research", "competitors-proposed.json"], seeds: ["research", "seeds.json"] }[kind];
  if (fs.existsSync(path.join(l.pewp, "signed-" + kind))) { w(path.join(l.pewp, ...copy), src && fs.existsSync(path.join(l.pewp, ...src)) ? fs.readFileSync(path.join(l.pewp, ...src), "utf8") : "{}"); w(path.join(l.pewp, "approved", "lock.json"), "{}"); say("approved " + kind); done(); }
  else { say("DIFF " + kind + ": +1 row"); process.exit(3); }
}
else if (name === "build-site.mjs") {
  const l = locOf(args[0]); const pw = opt("--pewp") || l.pewp;
  if (args.includes("--builder-done")) { say("gate: PASS (x)"); say("measure: BLOCKED"); say("STATUS: BUILT-AWAITING-MEASURE"); done(); }
  else { w(path.join(pw, "builder", "HANDOFF.md"), "# handoff"); w(path.join(pw, "builder", "builder-prompt.md"), "Read the handoff"); say("handoff: wrote"); say("WAITING-FOR-BUILDER: start a builder session"); done(); }
}
else if (name === "classify-business.mjs") {
  const l = locOf(args[0]);
  if (!fs.existsSync(path.join(l.pewp, "business.json"))) { say("BLOCKED: no business.json"); process.exit(3); }
  w(path.join(l.pewp, "business-definition.md"), "# What Fixture Co is\\n- Kind of business: editorial-media\\n");
  say("- Kind of business: editorial-media (industry pack: editorial-media)");
  if (fs.existsSync(ctlFile("needs"))) { say("NEEDS-INPUT classify: vocabulary missing"); process.exit(3); }
  say("READY for the owner's approval"); done();
}
else if (name === "competitors-discover.mjs") {
  const l = locOf(args[0]);
  if (fs.existsSync(ctlFile("ok"))) { w(path.join(l.pewp, "research", "competitors-proposed.json"), JSON.stringify({ rows: [{ name: "Rival", domain: "rival.test", kind: "publisher", evidenceUrl: "https://rival.test/about", closeness: 4 }, { name: "@rival", handle: "@rival", domain: null, platform: "instagram", kind: "social-curator", evidenceUrl: "https://instagram.com/rival", closeness: 3 }] })); w(path.join(l.pewp, "research", "competitors-proposed.md"), "| Rival |"); say("competitors proposed: 1 row"); done(); }
  say("NEEDS-INPUT competitors: no candidates found. The main session runs discovery across kinds (websites, Instagram, TikTok, YouTube, newsletters, paid media, agencies) and writes research/competitors-candidates.json"); process.exit(3);
}
else if (name === "research-seeds.mjs") { const l = locOf(args[0]); w(path.join(l.pewp, "research", "seeds.json"), JSON.stringify({ queries: [{ query: "historic homes for sale", from: "definition vocabulary" }] })); say("seeds: 1 proposed"); done(); }
else if (name === "psi.mjs") { w(path.join(locOf(args[0]).pewp, "psi.json"), "{}"); say("psi: 2 pages"); done(); }
else if (name === "authority-classify.mjs" || name === "authority-vet.mjs" || name === "authority-outreach.mjs") { w(path.join(locOf(args[0]).pewp, "authority", name.slice(0, -4) + ".json"), "{}"); if (fs.existsSync(ctlFile("partial"))) { say("PARTIAL: read 10 of 25"); done(); } say(name + " ok (stand-in: never reached when authority is BLOCKED)"); done(); }
else if (name === "causes-map.mjs") { const repo = args[0]; w(path.join(repo, ".checks", "causes.json"), JSON.stringify([{ id: "C01" }, { id: "L01", origin: "live" }])); say("causes-map: 1 repo cause, 1 live cause added"); done(); }
else if (name === "gate.mjs") { const p = args[0]; if (fs.existsSync(ctlFile("fail"))) { say("FAIL GT-001 a planned page is missing"); process.exit(1); } w(path.join(p, "gate", "report.json"), "{}"); say("PASS GT-001 every planned page exists"); done(); }
else if (name === "sitemap-check.mjs") { const l = locOf(args[0]); const t = opt("--today", "2026-10-23"); if (fs.existsSync(ctlFile("fail"))) { say("FAIL /legal/ is in the sitemap file but not in the page plan"); process.exit(1); } w(path.join(l.pewp, "sitemap", "check-" + t + ".json"), "{}"); say("PASS sitemap: 12 urls, all in the page plan"); done(); }
else if (name === "sitemap-submit.mjs") { const l = locOf(args[0]); const t = opt("--today", "2026-10-23"); w(path.join(l.pewp, "sitemap", "submit-" + t + ".json"), "{}"); say("submitted: gsc 200, bing 200"); done(); }
else if (name === "report-live.mjs") { const l = locOf(args[0]); if (!noout) { w(path.join(l.pewp, "report.md"), "# report"); w(path.join(l.pewp, "report.json"), "{}"); } say("report written"); done(); }
else if (name === "authority.mjs") { if (fs.existsSync(ctlFile("ok"))) { w(args[0], "{}"); say("authority ok"); done(); } if (fs.existsSync(ctlFile("silent"))) { say("something odd happened"); process.exit(3); } if (fs.existsSync(ctlFile("skip"))) { say("SKIPPED: not applicable to this site"); process.exit(4); } say("BLOCKED: no complete Common Crawl release in the cache | unblocks: download one"); process.exit(3); }
else if (name === "guard-readonly.mjs") { say("PASS guard"); done(); }
else if (name === "refactor.mjs") {
  if (args.includes("--dry")) { say("DRY refactor x"); say("  3 root causes: 2 would get a fix worker"); done(); }
  say("REFACTOR DONE: 2 FIXED, 0 REGRESSED"); done();
}
else if (name === "measure.mjs") {
  const l = locOf(args[0]);
  if (args.includes("--init")) { w(path.join(l.pewp, "measure", "config.json"), "{}"); w(path.join(l.pewp, "measure", "run.mjs"), "//"); say("wrote config"); done(); }
  if (args.includes("--plan")) { say("plan: 40 API calls"); done(); }
  w(path.join(l.pewp, "measure", today, "summary.json"), "{}"); say("measured"); done();
}
else if (name === "iterate.mjs") { const l = locOf(args[0]); if (fs.existsSync(ctlFile("ok"))) { w(path.join(l.pewp, "iterate", "report.md"), "# iterate"); say("proposals written"); done(); } say("ERROR iterate cannot judge: no measure run"); process.exit(2); }
else if (name === "migrate.mjs") {
  const l = locOf(args[0]); const st = opt("--stage"); const M = (f) => path.join(l.pewp, "migrate", f);
  if (st === "inventory") w(M("inventory.json"), "{}");
  if (st === "map") { w(M("redirect-map.json"), JSON.stringify({ summary: { total: 10, same: 6, needsReview: 3, noTarget: 1, gone410: 0 } })); if (!fs.existsSync(M("redirect-map.csv"))) w(M("redirect-map.csv"), "from,to\\n/a,/b\\n"); w(M("_redirects"), "/a /b 301\\n"); }
  if (st === "baseline") w(M("baseline-" + today + ".json"), "{}");
  if (st === "gate") { if (!noout) w(M("gate-" + today + ".json"), "{}"); say("gate: PASS {}"); }
  if (st === "monitor") { w(M("monitor-" + today + ".json"), "{}"); say("monitor: {}"); }
  done();
}
else if (name === "ref-sw.mjs") { const out = opt("--out"); w(path.join(out, "serviceworkers-check.json"), "{}"); say("# Old service workers (REF-013): NOT-APPLICABLE"); done(); }
else if (name === "compare.mjs") {
  const h = (t) => (/^https?:/.test(t) ? new URL(t).hostname.replace(/^www\\./, "") : path.basename(path.resolve(cwd, t)));
  const d = path.join(cwd, "site-checks", "compare-" + h(args[0]) + "-vs-" + h(args[1])); w(path.join(d, "compare.md"), "# compare"); w(path.join(d, "compare.json"), "{}"); say("compare written"); done();
}
else if (name === "local-run.mjs") { say("local ok"); done(); }
else { say("unknown stand-in " + name); process.exit(9); }
`;
const STUB_NAMES = ["doctor", "live-target", "intake", "research", "plan-site", "approve", "build-site", "report-live", "authority", "guard-readonly", "refactor", "measure", "iterate", "migrate", "ref-sw", "compare", "local-run",
  "plan-picture", "classify-business", "competitors-discover", "research-seeds", "psi", "authority-classify", "authority-vet", "authority-outreach", "causes-map", "gate", "sitemap-check", "sitemap-submit"];

// ---------------- harness ----------------
function mkWorld(sdir, { omit = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-start-"));
  const stubs = path.join(root, "stubs"), ctl = path.join(root, "ctl"), cwd = path.join(root, "cwd");
  fs.mkdirSync(stubs); fs.mkdirSync(ctl); fs.mkdirSync(cwd);
  for (const n of STUB_NAMES) if (!omit.includes(n)) w(path.join(stubs, n + ".mjs"), STUB);
  const log = path.join(root, "calls.log"); fs.writeFileSync(log, "");
  const env = { ...process.env, STUB_LOG: log, STUB_CTL: ctl, STUB_REAL: sdir }; delete env.PSI_API_KEY; // the psi stage is skipped without the key, whatever this machine has
  const run = (args, { stdin = "", env: moreEnv = {}, cwd: otherCwd = null } = {}) => {
    const r = spawnSync(node, [path.join(sdir, "start.mjs"), ...args, ...(args.includes("--") ? [] : []), ], { cwd: otherCwd || cwd, env: { ...env, ...moreEnv }, encoding: "utf8", timeout: 120000 });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
  };
  // run with the usual global options appended before any `--`. A stage with external calls or agent workers needs the owner's plan ack
  // (G13): the harness records `--ack plan-ok --by "Test Owner"` once per mode and target before the first --go, unless the scenario passes the
  // harness-only marker --no-plan-ack (removed before the call) to test the stop itself.
  const acked = new Set();
  const start = (mode, targets, extra = []) => {
    const dd = extra.indexOf("--"); let pre = dd >= 0 ? extra.slice(0, dd) : extra; const post = dd >= 0 ? extra.slice(dd) : [];
    const noAck = pre.includes("--no-plan-ack"); pre = pre.filter((x) => x !== "--no-plan-ack");
    const key = mode + " " + targets.join(" ");
    const pf = pre.includes("--pipeline") ? ["--pipeline", pre[pre.indexOf("--pipeline") + 1]] : [];
    if (pre.includes("--go") && !noAck && !acked.has(key)) { acked.add(key); run([mode, ...targets, "--stage-scripts", stubs, "--cwd", cwd, "--today", TODAY, "--ack", "plan-ok", "--by", "Test Owner", ...pf]); }
    return run([mode, ...targets, "--stage-scripts", stubs, "--cwd", cwd, ...(pre.includes("--today") ? [] : ["--today", TODAY]), ...pre, ...post]);
  };
  const calls = () => fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const clear = () => fs.writeFileSync(log, "");
  const control = (file, content = "") => w(path.join(ctl, file), content);
  const uncontrol = (file) => fs.rmSync(path.join(ctl, file), { force: true });
  return { root, cwd, stubs, ctl, run, start, calls, clear, control, uncontrol, cleanup: () => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }) };
}
const names = (cs) => cs.map((c) => c.script.replace(".mjs", ""));

// ---------------- scenarios ----------------
export async function runScenarios(sdir, only = null) {
  const results = [];
  try { await runScenariosInner(sdir, only, results); } catch (e) { results.push({ name: "the scenarios crashed", ok: false, detail: String(e.stack || e).slice(0, 500) }); }
  return results;
}
async function runScenariosInner(sdir, only, results) {
  const check = (name, cond, detail = "") => results.push({ name, ok: !!cond, detail: cond ? "" : String(detail) });
  const want = (id) => !only || only.includes(id);
  const URL1 = "https://fixture.test/";

  if (want("AD")) {
    // --adopt <id>[,<id>]: take over a step's valid existing outputs instead of running it (work order 41; the owner: no repeated work)
    const S1 = (id, over) => ({ id, module: "x", what: id, script: null, args: [], inputs: [], outputs: [], dependsOn: [], needsBrowser: "none", needsAi: false, needsPerson: false, needsKeys: [], heavy: false, hits: "none", pace: null, timeoutMinutes: 5, evidence: [], kind: "derived", maxAgeDays: null, ...over });
    const steps = [
      S1("seeds", { module: "research", script: "scripts/research-seeds.mjs", args: ["{url}", "--cwd", "{skill}"], inputs: ["{pewp}/business.json"], outputs: ["{pewp}/research/seeds.json"], evidence: ["{pewp}/research/seeds.json"] }),
      S1("plan", { module: "plan", script: "scripts/plan-site.mjs", args: ["{pewp}"], dependsOn: ["seeds"], inputs: ["{pewp}/research/seeds.json"], outputs: ["{pewp}/plan/sitemap.json"], evidence: ["{pewp}/plan/sitemap.json"] }),
      S1("capture-x", { module: "visibility", needsBrowser: "owner", hits: "third-party:google.com", pace: "one page at least 45 s apart", inputs: ["{pewp}/captures-brief.md"], outputs: ["{pewp}/captures/x/"], evidence: ["{pewp}/captures/x/*.json"], brief: "Capture x in the owner's browser." }),
    ];
    const world = () => {
      const W = mkWorld(sdir), pewp = path.join(W.cwd, "site-checks", "fixture.test", ".pewp"), PL = path.join(W.root, "ad-pipeline.json");
      w(PL, JSON.stringify({ version: 1, name: "adopt", what: "adopt", conventions: {}, vars: {}, steps }, null, 1));
      const at = (rel, content, ageMs) => { const p = path.join(pewp, rel); w(p, content); const t = new Date(Date.now() - ageMs); fs.utimesSync(p, t, t); return p; };
      const go = (extra = []) => W.start("audit-live", [URL1], ["--go", "--yes", "--pipeline", PL, ...extra]);
      return { W, pewp, at, go, state: () => rj(path.join(pewp, "state.json")) };
    };
    const H = 3_600_000;
    // 1. adopt OK: the step is not run, its dependent is, and the record says exit 0 / adopted with the evidence's own date
    let A = world();
    A.at("business.json", "{}", 3 * H); A.at("captures-brief.md", "x", 3 * H); A.at("captures/x/a.json", "{\"ok\":1}", H); const seedsFile = A.at("research/seeds.json", "{\"queries\":[]}", H);
    const seedsMtime = fs.statSync(seedsFile).mtime.toISOString();
    let r = A.go(["--adopt", "seeds"]);
    let st = A.state(), rec = st?.stages?.seeds;
    check("AD: --adopt seeds: exit 0, the seeds step is NOT run and its dependent (plan) IS", r.code === 0 && names(A.W.calls()).join() === "plan-site", `${r.code} ${names(A.W.calls()).join()} ${r.out.slice(0, 400)}`);
    check("AD: the state records the adopted step as done with the EVIDENCE's mtime as its evidenceDate (not now), adopted true, exit 0, outcome 'adopted'", rec?.adopted === true && rec.evidenceDate === seedsMtime && rec.exit === 0 && rec.outcome === "adopted" && !!rec.adoptedAt && rec.evidenceDate !== rec.adoptedAt, JSON.stringify(rec));
    const runFile = path.join(A.pewp, "runs", TODAY + "-audit-live-seeds.md"), runText = fs.existsSync(runFile) ? fs.readFileSync(runFile, "utf8") : "";
    check("AD: the run log has a file for the adopted step: exit code 0, 'adopted', and the evidence's own date", /exit code: 0/.test(runText) && /adopted/.test(runText) && runText.includes(seedsMtime), runText.slice(0, 400));
    check("AD: the screen says the step was adopted, with the date", /seeds: adopted/.test(r.out) && r.out.includes(seedsMtime.slice(0, 10)), r.out.slice(0, 400));
    A.W.clear(); r = A.go();
    check("AD: the next run without --adopt keeps the adopted step done: it is not run (nothing runs again)", r.code === 0 && !names(A.W.calls()).includes("research-seeds"), `${r.code} ${names(A.W.calls()).join()} ${r.out.slice(0, 300)}`);
    A.W.cleanup();
    // 2. an input newer than the evidence: refused, the input named, nothing started
    A = world();
    A.at("research/seeds.json", "{\"queries\":[]}", H); A.at("business.json", "{}", 60_000);
    r = A.go(["--adopt", "seeds"]);
    check("AD: an input newer than the evidence refuses the adoption (exit 3, last line BLOCKED: ... | unblocks: ...), names the input (business.json) and starts nothing", r.code === 3 && /business\.json/.test(r.out) && /input/.test(r.out) && /BLOCKED: .*\| unblocks: /.test(r.out.trim().split("\n").pop()) && A.W.calls().length === 0 && !A.state()?.stages?.seeds?.adopted, `${r.code} ${A.W.calls().length} ${r.out.slice(-400)}`);
    A.W.cleanup();
    // 3. empty evidence
    A = world();
    A.at("business.json", "{}", 3 * H); A.at("research/seeds.json", "", H);
    r = A.go(["--adopt", "seeds"]);
    check("AD: empty evidence refuses the adoption (exit 3), says the file is empty and names it, and starts nothing", r.code === 3 && /empty/.test(r.out) && /seeds\.json/.test(r.out) && A.W.calls().length === 0, `${r.code} ${A.W.calls().length} ${r.out.slice(-400)}`);
    A.W.cleanup();
    // 4. a waiting step (an owner capture) is adopted the same way
    A = world();
    A.at("captures-brief.md", "x", 3 * H); A.at("captures/x/a.json", "{\"ok\":1}", H);
    r = A.go(["--adopt", "capture-x"]);
    check("AD: a waiting step (owner capture) whose evidence exists is adopted: done, adopted true, no WAITING-FOR line for it", /capture-x: adopted/.test(r.out) && A.state()?.stages?.["capture-x"]?.adopted === true && !/WAITING-FOR[^\n]*capture-x/.test(r.out), r.out.slice(0, 500));
    A.W.cleanup();
    // 5. an id that is not a step, and two ids at once
    A = world();
    r = A.go(["--adopt", "nope"]);
    check("AD: --adopt with an id that is not a step of the manifest is a usage error (exit 2) that lists the step ids, and starts nothing", r.code === 2 && /nope/.test(r.out) && /seeds/.test(r.out) && A.W.calls().length === 0, `${r.code} ${r.out.slice(-300)}`);
    A.at("business.json", "{}", 3 * H); A.at("research/seeds.json", "{}", H); A.at("captures/x/a.json", "{}", H);
    r = A.go(["--adopt", "seeds,capture-x"]);
    check("AD: two ids with a comma adopt both (seeds and capture-x) and the dependent runs", r.code === 0 && A.state()?.stages?.seeds?.adopted === true && A.state()?.stages?.["capture-x"]?.adopted === true && names(A.W.calls()).join() === "plan-site", `${r.code} ${names(A.W.calls()).join()} ${r.out.slice(-300)}`);
    A.W.cleanup();
    // 6. the DEFAULT of a run: resume. Without --adopt every step whose evidence exists and whose inputs are older is adopted; --fresh discards; a newer input re-runs that step and its dependents only
    {
      const finished = () => { const X = world(); X.at("business.json", "{}", 4 * H); X.at("captures-brief.md", "x", 4 * H); X.at("research/seeds.json", "{\"queries\":[]}", 3 * H); X.at("plan/sitemap.json", "{\"pages\":[]}", 2 * H); X.at("captures/x/a.json", "{\"ok\":1}", H); return X; };
      let X = finished();
      r = X.go();
      st = X.state();
      check("AD: a finished fixture (all evidence there, every input older), run WITHOUT --adopt: nothing is run (no calls), every step is adopted (exit 0), each dated by its own evidence", r.code === 0 && X.W.calls().length === 0 && ["seeds", "plan", "capture-x"].every((id) => st?.stages?.[id]?.adopted === true && st.stages[id].outcome === "adopted") && !/WAITING-FOR/.test(r.out), `${r.code} ${names(X.W.calls()).join()} ${r.out.slice(0, 500)}`);
      check("AD: the adopted dates are the evidence files' own mtimes, not now (seeds 3 h old, plan 2 h, capture 1 h)", ["seeds", "plan", "capture-x"].every((id, i) => Math.abs(Date.now() - Date.parse(st?.stages?.[id]?.evidenceDate) - [3, 2, 1][i] * H) < 5 * 60_000), JSON.stringify(["seeds", "plan", "capture-x"].map((id) => st?.stages?.[id]?.evidenceDate)));
      X.W.clear(); r = X.go();
      check("AD: a second run on the same finished fixture runs nothing again", r.code === 0 && X.W.calls().length === 0, `${r.code} ${names(X.W.calls()).join()}`);
      X.W.clear(); r = X.go(["--fresh"]);
      check("AD: --fresh discards: every script step runs again (seeds then plan), and the capture is asked for again (WAITING-FOR), nothing is adopted", names(X.W.calls()).join() === "research-seeds,plan-site" && /WAITING-FOR[^\n]*capture-x|capture-x/.test(r.out) && !/seeds: adopted|plan: adopted/.test(r.out), `${r.code} ${names(X.W.calls()).join()} ${r.out.slice(0, 500)}`);
      X.W.cleanup();
      X = finished();
      r = X.go(); X.W.clear();
      r = X.go(["--fresh", "seeds"]);
      check("AD: --fresh seeds re-runs that step and its dependent (plan) only; the capture stays adopted", names(X.W.calls()).join() === "research-seeds,plan-site" && !/capture-x: running/.test(r.out), `${r.code} ${names(X.W.calls()).join()} ${r.out.slice(0, 400)}`);
      X.W.cleanup();
      X = finished();
      X.at("business.json", "{}", 60_000); // seeds' input is now newer than seeds.json
      r = X.go();
      check("AD: an input newer than its evidence re-runs only that step and its dependents (seeds, then plan); the capture, whose input is older, is adopted without a run", r.code === 0 && names(X.W.calls()).join() === "research-seeds,plan-site" && /not adopted \(input .*business\.json/.test(r.out) && /capture-x: adopted/.test(r.out), `${r.code} ${names(X.W.calls()).join()} ${r.out.slice(0, 600)}`);
      X.W.cleanup();
    }
  }

  if (want("A")) {
    // audit-live: the steps are the manifest's (a small fixture manifest here: the real pipeline.json is proven by test-pipeline.mjs)
    const S1 = (id, over) => ({ id, module: "x", what: id, script: null, args: [], inputs: [], outputs: [], dependsOn: [], needsBrowser: "none", needsAi: false, needsPerson: false, needsKeys: [], heavy: false, hits: "none", pace: null, timeoutMinutes: 5, evidence: [], kind: "derived", maxAgeDays: null, ...over });
    const fixSteps = (extra = []) => [
      S1("doctor", { module: "setup", script: "scripts/doctor.mjs", args: ["{url}", "--cwd", "{skill}", "--json"], outputs: ["{pewp}/doctor.json"], evidence: ["{pewp}/doctor.json"] }),
      S1("snapshot", { module: "technical", script: "scripts/live-target.mjs", args: ["{url}", "--cwd", "{skill}"], dependsOn: ["doctor"], outputs: ["{runDir}/snapshots/"], evidence: ["{runDir}/snapshots/*/_site.json"], hits: "client", pace: "1 request per 4 s", needsBrowser: "headless", timeoutMinutes: 150 }),
      S1("checker", { module: "technical", dependsOn: ["snapshot"], inputs: ["{runDir}/snapshots/*/_site.json"], outputs: ["{work}/checker/.checks/causes.json"], evidence: ["{work}/checker/.checks/causes.json"], needsAi: true, brief: "Run ONE coordinator agent (coordinator.md) on {work}/checker." }),
      S1("authority", { module: "authority", script: "scripts/authority.mjs", args: ["{pewp}/authority.json", "--target", "{host}"], dependsOn: ["doctor"], outputs: ["{pewp}/authority.json"], evidence: ["{pewp}/authority.json"], heavy: true, hits: "third-party:commoncrawl" }),
      S1("authority-classify", { module: "authority", script: "scripts/authority-classify.mjs", args: ["{url}", "--cwd", "{skill}"], dependsOn: ["authority"], outputs: ["{pewp}/authority/authority-classify.json"], evidence: ["{pewp}/authority/authority-classify.json"] }),
      S1("report-live", { module: "report", script: "scripts/report-live.mjs", args: ["{url}", "--cwd", "{skill}"], dependsOn: ["snapshot", "checker"], inputs: ["{runDir}/snapshots/*/_site.json", "{work}/checker/.checks/causes.json"], outputs: ["{pewp}/report.md", "{pewp}/report.json"], evidence: ["{pewp}/report.json"] }),
      S1("approve-business", { module: "setup", dependsOn: ["doctor"], needsPerson: true, outputs: ["{pewp}/approved/business.json"], evidence: ["{pewp}/approved/business.json"], brief: "Show the owner business.json as pickable options." }),
      S1("capture-x", { module: "visibility", dependsOn: ["doctor"], needsBrowser: "owner", hits: "third-party:google.com", pace: "one page at least 45 s apart", outputs: ["{pewp}/captures/x/"], evidence: ["{pewp}/captures/x/*.json"], brief: "Capture x in the owner's browser." }),
      ...extra];
    const mkFix = (W, extra = [], mutate = (m) => m) => { const f = path.join(W.root, "fix-pipeline.json"); w(f, JSON.stringify(mutate({ version: 1, name: "fixture", what: "fixture", conventions: {}, vars: {}, steps: fixSteps(extra) }), null, 1)); return f; };
    const W = mkWorld(sdir); const live = path.join(W.cwd, "site-checks", "fixture.test"); const pewp = path.join(live, ".pewp"); const PL = mkFix(W); const PLF = ["--pipeline", PL];
    const ORDER = "doctor,snapshot,checker,authority,authority-classify,report-live,approve-business,capture-x";
    // A1: no --go -> plan only
    let r = W.start("audit-live", [URL1], ["--exclude", "^/home-search", ...PLF]);
    check("A: plan only (no --go) runs nothing and exits 0", r.code === 0 && W.calls().length === 0 && /Plan only/.test(r.out), `${r.code} ${W.calls().length} ${r.out.slice(0, 300)}`);
    check("A: the plan lists the manifest's steps in the manifest's order, with kind and cost", ORDER.split(",").every((n, i, a) => r.out.indexOf(` ${n.padEnd(18)} `) > (i ? r.out.indexOf(` ${a[i - 1].padEnd(18)} `) : -1)) && /\[agent\]/.test(r.out) && /\[person\]/.test(r.out) && /\[browser\]/.test(r.out) && /cost: requests to the client's site; pace: 1 request per 4 s/.test(r.out), r.out.slice(0, 900));
    let st = rj(path.join(pewp, "state.json"));
    check("A: the sequence recorded in state.json carries ids, order and dependsOn from the manifest", st.start?.mode === "audit-live" && st.start.sequence.map((s) => s.name).join() === ORDER && JSON.stringify(st.start.sequence.find((s) => s.name === "report-live").dependsOn) === '["snapshot","checker"]' && st.start.status === "planned", JSON.stringify(st.start));
    // A2: --go runs what can run, goes on past BLOCKED authority, and lists every waiting step with its brief
    r = W.start("audit-live", [URL1], ["--go", "--exclude", "^/home-search", "--max-pages", "9", ...PLF]);
    const c2 = W.calls();
    check("A: --go runs doctor, the snapshot and authority (BLOCKED, so authority-classify is held); report-live waits for the checker", names(c2).join() === "doctor,live-target,authority", names(c2).join());
    check("A: the snapshot gets its manifest args, --cwd of this run (not the skill folder) and the remembered options after --", c2[1] && c2[1].args[0] === URL1 && c2[1].args[c2[1].args.indexOf("--cwd") + 1] === W.cwd && c2[1].args.join(" ").includes("-- --exclude ^/home-search --max-pages 9"), JSON.stringify(c2[1]));
    check("A: a BLOCKED step prints its own last line and does not stop the others", /authority: BLOCKED: no complete Common Crawl release in the cache \| unblocks: download one/.test(r.out) && !names(c2).includes("authority-classify"), r.out.slice(-900));
    check("A: every waiting step is listed with its kind, brief and evidence, exit 3", r.code === 3 && /WAITING-FOR an agent \(stage=checker\)/.test(r.out) && /coordinator\.md/.test(r.out) && /NEEDS-APPROVAL stage=approve-business/.test(r.out) && /WAITING-FOR the owner's browser \(stage=capture-x\)/.test(r.out) && /evidence it must leave: .*captures\/x\/\*\.json/.test(r.out) && /3 step\(s\) wait/.test(r.out), `${r.code} ${r.out.slice(-1200)}`);
    check("A: the runner made {work} for the checker's brief, and the brief shows the real path", fs.existsSync(path.join(live, "work")) && r.out.includes(`${path.join(live, "work")}/checker`.replace(/\\/g, "/")) || r.out.includes(path.join(live, "work")), r.out.slice(-900));
    // A3: the checker's evidence appears -> report-live runs; the person and browser steps still wait
    w(path.join(live, "work", "checker", ".checks", "causes.json"), "[]");
    { const hourOld = new Date(Date.now() - 3600000); fs.utimesSync(path.join(live, "work", "checker", ".checks", "causes.json"), hourOld, hourOld); }   // the engine gives file times 2 s of slack, so the first answer is made clearly older than the step's later completion
    W.clear(); r = W.start("audit-live", [URL1], ["--go", ...PLF]);
    check("A: with the checker evidence present report-live runs (authority is tried again), two steps still wait (exit 3)", names(W.calls()).join() === "authority,report-live" && fs.existsSync(path.join(pewp, "report.json")) && r.code === 3 && /2 step\(s\) wait/.test(r.out) && !/stage=checker\)/.test(r.out), `${names(W.calls())} ${r.code} ${r.out.slice(-600)}`);
    // A4: all evidence in, authority still BLOCKED: exit 4 and the held steps are named
    w(path.join(pewp, "approved", "business.json"), "{}"); w(path.join(pewp, "captures", "x", "a.json"), "{}");
    W.clear(); r = W.start("audit-live", [URL1], ["--go", ...PLF]);
    check("A: nothing waits but authority is BLOCKED: exit 4, the held step is named", r.code === 4 && /^BLOCKED: authority: /m.test(r.out) && /authority-classify waits for authority/.test(r.out) && !/ALL STAGES DONE/.test(r.out), `${r.code} ${r.out.slice(-500)}`);
    // A5: authority unblocked -> authority, authority-classify run, all done
    W.control("authority.mjs.ok"); W.clear(); r = W.start("audit-live", [URL1], ["--go", ...PLF]);
    check("A: once authority works its dependent runs and the run ends ALL STAGES DONE, exit 0", names(W.calls()).join() === "authority,authority-classify" && r.code === 0 && /ALL STAGES DONE/.test(r.out) && rj(path.join(pewp, "state.json")).start.status === "done", `${names(W.calls())} ${r.code} ${r.out.slice(-300)}`);
    W.clear(); r = W.start("audit-live", [URL1], ["--go", ...PLF]);
    check("A: a second --go with nothing changed runs nothing (exit 0)", W.calls().length === 0 && r.code === 0 && /ALL STAGES DONE/.test(r.out), `${names(W.calls())} ${r.code}`);
    // A6: a new snapshot makes the checker and report-live stale
    W.control("snap-new-1"); W.clear();
    r = W.start("audit-live", [URL1], ["--go", "--stage", "snapshot", ...PLF]);
    st = rj(path.join(pewp, "state.json"));
    check("A: --stage snapshot runs ONLY the snapshot", names(W.calls()).join() === "live-target", names(W.calls()).join());
    check("A: options given once (--exclude, --max-pages) are remembered by the next start of the run", W.calls()[0].args.join(" ").includes("-- --exclude ^/home-search --max-pages 9") && /options remembered/.test(r.out), JSON.stringify(W.calls()[0]) + r.out.slice(0, 300));
    check("A: steps whose input changed are marked stale in state.json (checker, report-live) and --stage says so", !!st.stages.checker?.stale && !!st.stages["report-live"]?.stale && /marked stale in state\.json.*checker.*report-live/.test(r.out), JSON.stringify([st.stages.checker?.stale, st.stages["report-live"]?.stale]) + r.out.slice(-300));
    W.clear(); r = W.start("audit-live", [URL1], ["--go", ...PLF]);
    check("A: the next --go asks for the checker again (old evidence is older than its completion) and does NOT run report-live on old checks", r.code === 3 && /WAITING-FOR an agent \(stage=checker\)/.test(r.out) && !names(W.calls()).includes("report-live"), `${r.code} ${names(W.calls())} ${r.out.slice(-400)}`);
    await new Promise((x) => setTimeout(x, 30));
    w(path.join(live, "work", "checker", ".checks", "causes.json"), "[1]");
    W.clear(); r = W.start("audit-live", [URL1], ["--go", ...PLF]);
    check("A: once the agent redid it, report-live is re-run on the new checks (exit 0)", names(W.calls()).join() === "report-live" && r.code === 0, `${names(W.calls())} ${r.code} ${r.out.slice(-300)}`);
    W.clear(); r = W.start("audit-live", [URL1], ["--go", "--stage", "report-live", ...PLF]);
    check("A: --stage report-live re-runs only report-live although it is done", names(W.calls()).join() === "report-live" && r.code === 0, names(W.calls()).join());
    // A7: the evidence rule: exit 0 is not enough
    W.control("report-live.mjs.noout"); fs.rmSync(path.join(pewp, "report.md")); fs.rmSync(path.join(pewp, "report.json")); W.clear();
    r = W.start("audit-live", [URL1], ["--go", "--stage", "report-live", ...PLF]);
    check("A: a script that exits 0 without writing its evidence is FAILED (exit 1) and the message names the missing file", r.code === 1 && /FAILED stage=report-live: exit 0 but evidence missing: .*report\.json \(no non-empty file\)/.test(r.out), `${r.code} ${r.out.slice(-300)}`);
    for (const f of ["report.md", "report.json"]) { w(path.join(pewp, f), "{}"); const old = new Date(Date.now() - 86400000); fs.utimesSync(path.join(pewp, f), old, old); }
    W.clear(); r = W.start("audit-live", [URL1], ["--go", "--stage", "report-live", ...PLF]);
    check("A: evidence that exists but is older than the step's start does not count (FAILED, 'older than the step')", r.code === 1 && /report\.json \(only files older than the step started\)/.test(r.out), `${r.code} ${r.out.slice(-300)}`);
    w(path.join(pewp, "report.md"), "{}"); w(path.join(pewp, "report.json"), "");
    W.clear(); r = W.start("audit-live", [URL1], ["--go", "--stage", "report-live", ...PLF]);
    check("A: empty evidence does not count (FAILED, 'empty')", r.code === 1 && /report\.json \(1 empty file: .*report\.json\)/.test(r.out), `${r.code} ${r.out.slice(-300)}`);
    W.uncontrol("report-live.mjs.noout");
    // A8: exit codes: 3 without the BLOCKED line, 4 SKIPPED, 4 partial, 2 usage
    const W3 = mkWorld(sdir); const PL3 = mkFix(W3); const P3 = ["--pipeline", PL3, "--go"]; const live3 = path.join(W3.cwd, "site-checks", "fixture.test");
    W3.start("audit-live", [URL1], [...P3, "--stage", "doctor"]); W3.control("authority.mjs.silent"); r = W3.start("audit-live", [URL1], [...P3, "--stage", "authority"]);
    check("A: exit 3 whose last line is not 'BLOCKED: ...' is a FAILED contract break, not a BLOCKED", r.code === 1 && /FAILED stage=authority: exit 3 means BLOCKED but the last line is not "BLOCKED:/.test(r.out), `${r.code} ${r.out.slice(-300)}`);
    W3.uncontrol("authority.mjs.silent"); W3.control("authority.mjs.skip"); W3.clear(); r = W3.start("audit-live", [URL1], [...P3, "--stage", "authority"]);
    check("A: exit 4 with 'SKIPPED: <reason>' settles the step: the reason is quoted and recorded", r.code === 0 && /authority: SKIPPED: not applicable to this site/.test(r.out) && rj(path.join(live3, ".pewp", "state.json")).stages.authority?.skipped === "not applicable to this site", `${r.code} ${r.out.slice(-300)}`);
    W3.clear(); r = W3.start("audit-live", [URL1], [...P3]);
    check("A: a skipped step does not hold its dependent: in a normal run authority-classify runs and authority is not run again", names(W3.calls()).includes("authority-classify") && !names(W3.calls()).includes("authority"), `${names(W3.calls())} ${r.code} ${r.out.slice(-300)}`);
    W3.control("authority-classify.mjs.partial"); W3.clear(); r = W3.start("audit-live", [URL1], [...P3, "--stage", "authority-classify"]);
    check("A: a step that exits 0 with a PARTIAL: last line is PARTIAL (kept, not done): exit 4, 'run again to continue'", r.code === 4 && /authority-classify: PARTIAL/.test(r.out) && /run again to continue/.test(r.out) && !rj(path.join(live3, ".pewp", "state.json")).stages["authority-classify"]?.doneAt, `${r.code} ${r.out.slice(-300)}`);
    W3.uncontrol("authority-classify.mjs.partial"); W3.control("doctor.mjs.exit", "2"); W3.clear(); r = W3.start("audit-live", [URL1], [...P3, "--stage", "doctor"]);
    check("A: exit 2 is a usage error: FAILED saying the manifest's args do not fit the script", r.code === 1 && /FAILED stage=doctor: usage error \(exit 2\)/.test(r.out), `${r.code} ${r.out.slice(-300)}`);
    // A9: --no-authority, --stage before its dependency, the owner's plan ack
    const W4 = mkWorld(sdir); const PL4 = mkFix(W4); const P4 = ["--pipeline", PL4];
    r = W4.start("audit-live", [URL1], ["--go", "--stage", "report-live", ...P4]);
    check("A: --stage on a step whose dependencies are not done is refused (WAITING-FOR the dependency, exit 3) and its script never runs", r.code === 3 && /WAITING-FOR stage=snapshot: report-live depends on snapshot, checker/.test(r.out) && W4.calls().length === 0, `${r.code} ${names(W4.calls())} ${r.out.slice(-300)}`);
    W4.clear(); r = W4.start("audit-live", [URL1], ["--go", "--no-authority", ...P4]);
    check("A: --no-authority skips every step of the authority module (and does not hold their dependents)", !names(W4.calls()).includes("authority") && /authority: skipped \(--no-authority\)/.test(r.out) && /authority-classify: skipped \(--no-authority\)/.test(r.out), `${names(W4.calls())} ${r.out.slice(-400)}`);
    const Wn = mkWorld(sdir); const Pn = ["--pipeline", mkFix(Wn)];
    r = Wn.start("audit-live", [URL1], ["--go", "--no-plan-ack", ...Pn]);
    check("A: without the owner's plan ack the free doctor runs and the run stops before the first step that makes external calls (exit 3, plan-ok)", r.code === 3 && names(Wn.calls()).join() === "doctor" && /NEEDS-APPROVAL stage=plan-ok \(before snapshot\)/.test(r.out), `${r.code} ${names(Wn.calls())} ${r.out.slice(-300)}`);
    // A10: {client}: a step that needs it asks for it
    const W6 = mkWorld(sdir); const P6 = ["--pipeline", mkFix(W6, [S1("psi", { script: "scripts/psi.mjs", args: ["{url}", "--client", "{client}"], dependsOn: ["doctor"], outputs: ["{pewp}/psi.json"], evidence: ["{pewp}/psi.json"] })])];
    W6.start("audit-live", [URL1], ["--go", "--stage", "doctor", ...P6]); W6.clear();
    r = W6.start("audit-live", [URL1], ["--go", "--stage", "psi", ...P6]);
    check("A: a step with {client} and no --client stops with NEEDS-INPUT naming --client (exit 3), nothing run", r.code === 3 && /NEEDS-INPUT stage=psi: the placeholder \{client\} has no value for this run \(pass --client <slug>\)/.test(r.out) && W6.calls().length === 0, `${r.code} ${r.out.slice(-300)}`);
    r = W6.start("audit-live", [URL1], ["--go", "--stage", "psi", "--client", "acme", ...P6]);
    check("A: with --client acme the script gets it", r.code === 0 && W6.calls()[0]?.args.join(" ").endsWith("--client acme"), `${r.code} ${JSON.stringify(W6.calls())} ${r.out.slice(-200)}`);
    // A11: an invalid manifest or a missing script stops everything before it starts
    const W7 = mkWorld(sdir, { omit: ["report-live"] }); const PL7 = mkFix(W7);
    r = W7.start("audit-live", [URL1], ["--go", "--pipeline", PL7]);
    check("A: a manifest whose script does not exist is invalid: exit 2 naming the script, nothing ran (never improvised)", r.code === 2 && /is not valid; nothing ran/.test(r.out) && /step report-live: script 'scripts\/report-live\.mjs' does not exist/.test(r.out) && W7.calls().length === 0, `${r.code} ${r.out.slice(-300)}`);
    const W8 = mkWorld(sdir); const PL8b = mkFix(W8, [], (m) => { m.steps[0].surprise = 1; return m; });
    r = W8.start("audit-live", [URL1], ["--go", "--pipeline", PL8b]);
    check("A: a manifest with an unknown key is invalid: exit 2, nothing ran", r.code === 2 && /step doctor: unknown key 'surprise'/.test(r.out) && W8.calls().length === 0, `${r.code} ${r.out.slice(-300)}`);
    // A12: intake exits 3 with question lines, a NEEDS-INPUT line and the BLOCKED line last: the owner is asked, it is not just BLOCKED
    const W9 = mkWorld(sdir); const P9 = ["--pipeline", mkFix(W9, [S1("intake", { module: "setup", script: "scripts/intake.mjs", args: ["{url}", "--cwd", "{skill}"], dependsOn: ["doctor"], outputs: ["{pewp}/business.json"], evidence: ["{pewp}/business.json"] })])];
    W9.start("audit-live", [URL1], ["--go", "--stage", "doctor", ...P9]); W9.clear();
    r = W9.start("audit-live", [URL1], ["--go", "--stage", "intake", ...P9]);
    check("A: a step that exits 3 with a NEEDS-INPUT line (intake) asks the owner: the question list as pickable options, exit 3, state needs-input, and it is not reported as BLOCKED", r.code === 3 && /NEEDS-INPUT stage=intake: 1 question\(s\)\. Ask ALL of them/.test(r.out) && /real estate agent \[recommended\]/.test(r.out) && !/BLOCKED stage=intake|intake: BLOCKED/.test(r.out) && rj(path.join(W9.cwd, "site-checks", "fixture.test", ".pewp", "state.json")).start.status === "needs-input", `${r.code} ${r.out.slice(-500)}`);
    w(path.join(W9.cwd, "site-checks", "fixture.test", ".pewp", "intake-answers.json"), JSON.stringify({ industry: "real estate agent" }));
    W9.clear(); r = W9.start("audit-live", [URL1], ["--go", "--stage", "intake", ...P9]);
    check("A: with the answers written intake completes and the step is done", r.code === 0 && fs.existsSync(path.join(W9.cwd, "site-checks", "fixture.test", ".pewp", "business.json")) && /intake: done/.test(r.out), `${r.code} ${r.out.slice(-300)}`);
    // A13: {work} is outside ~/.claude when the run lives under it (the checker's headless workers cannot write there)
    const Wh = mkWorld(sdir); const fakeHome = path.join(Wh.root, "home"), cwdH = path.join(fakeHome, ".claude", "skills", "x"); fs.mkdirSync(cwdH, { recursive: true });
    const envH = { USERPROFILE: fakeHome, HOME: fakeHome };
    r = Wh.run(["audit-live", URL1, "--stage-scripts", Wh.stubs, "--cwd", cwdH, "--pipeline", mkFix(Wh), "--go", "--yes", "--today", TODAY], { env: envH });
    const outWork = path.join(os.tmpdir(), "pewp-work", "fixture.test").replace(/\\/g, "/");
    check("A: when the run lives under ~/.claude, {work} is <os temp>/pewp-work/<host> (the checker's headless workers cannot write under ~/.claude): the brief shows it and the folder exists", r.out.replace(/\\/g, "/").includes(`${outWork}/checker`) && fs.existsSync(outWork) && !fs.existsSync(path.join(cwdH, "site-checks", "fixture.test", "work")), `${r.code} ${r.out.slice(-500)}`);
    fs.rmSync(outWork, { recursive: true, force: true });
    // A14: a step with engines is BLOCKED, never started, while a stop is in force; a desktop lift frees only the person-paced capture in the owner's browser
    const stopsLib = await import(pathToFileURL(path.join(sdir, "lib-stops.mjs")).href + "?" + Math.random());
    const mkStops = (W0, fn) => { const d = path.join(W0.root, "stops"); fs.mkdirSync(d, { recursive: true }); fn(d); return d; };
    const withEngines = (m) => { for (const s of m.steps) { if (s.id === "authority") s.engines = ["commoncrawl"]; if (s.id === "capture-x") s.engines = ["google"]; } return m; };
    const runE = (W0, plf, dir) => W0.run(["audit-live", URL1, "--stage-scripts", W0.stubs, "--cwd", W0.cwd, "--pipeline", plf, "--go", "--yes", "--today", TODAY], { env: { OMNIKOM_STOPS_DIR: dir } });
    const We = mkWorld(sdir); const PLe = mkFix(We, [], withEngines);
    const dirE = mkStops(We, (d) => { stopsLib.writeStop({ engine: "google", until: Date.now() + 3600_000, reason: "robot check", setBy: "test", dir: d }); stopsLib.writeStop({ engine: "commoncrawl", until: Date.now() + 3600_000, reason: "HTTP 429", setBy: "test", dir: d }); });
    r = runE(We, PLe, dirE);
    check("A: while a stop is in force a step with engines is BLOCKED with the stop's until and reason and never started: the script step (authority, commoncrawl) is not run, the owner-browser capture (capture-x, google) is not asked for", /authority: BLOCKED: commoncrawl is stopped until \d{4}-\d{2}-\d{2}T[\d:.]+Z \(HTTP 429\) \| unblocks: wait until then/.test(r.out) && /capture-x: BLOCKED: google is stopped until .* \(robot check\)/.test(r.out) && !names(We.calls()).includes("authority") && !/WAITING-FOR the owner's browser \(stage=capture-x\)/.test(r.out), `${r.code} ${names(We.calls())} ${r.out.slice(-900)}`);
    check("A: the stop is recorded for the step in state.json (blocked text and the engine's until), so a later reader sees why", /commoncrawl is stopped until/.test(rj(path.join(We.cwd, "site-checks", "fixture.test", ".pewp", "state.json")).stages.authority?.blocked || "") && rj(path.join(We.cwd, "site-checks", "fixture.test", ".pewp", "state.json")).stages.authority?.stop?.engine === "commoncrawl", JSON.stringify(rj(path.join(We.cwd, "site-checks", "fixture.test", ".pewp", "state.json")).stages.authority));
    stopsLib.liftStop({ engine: "google", by: "test", note: "a person paces the capture in the owner's own browser", dir: dirE });
    We.clear(); r = runE(We, PLe, dirE);
    check("A: a desktop lift of the google stop frees only the person-paced capture: capture-x is asked for again (WAITING-FOR the owner's browser) while the script step (authority) stays BLOCKED", /WAITING-FOR the owner's browser \(stage=capture-x\)/.test(r.out) && /authority: BLOCKED: commoncrawl is stopped/.test(r.out) && !names(We.calls()).includes("authority"), `${r.code} ${names(We.calls())} ${r.out.slice(-700)}`);
    const Wf = mkWorld(sdir); const PLf = mkFix(Wf, [], withEngines);
    const dirF = mkStops(Wf, (d) => { stopsLib.writeStop({ engine: "commoncrawl", until: Date.now() - 1000, reason: "HTTP 429", setBy: "test", dir: d }); });
    r = runE(Wf, PLf, dirF);
    check("A: an expired stop does not hold the step: authority runs, capture-x is asked for", names(Wf.calls()).includes("authority") && /WAITING-FOR the owner's browser \(stage=capture-x\)/.test(r.out) && !/stopped until/.test(r.out), `${r.code} ${names(Wf.calls())} ${r.out.slice(-500)}`);
    for (const x of [W3, W4, Wn, W6, W7, W8, W9, Wh, We, Wf]) x.cleanup();
    // audit-repo: a moved git HEAD makes the finished checker stale; the old .checks are not trusted
    const W5 = mkWorld(sdir); const repo = path.join(W5.cwd, "repo"); fs.mkdirSync(repo, { recursive: true });
    const g = (...a) => spawnSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8", timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" } });
    g("init", "-q"); w(path.join(repo, "a.txt"), "1"); g("add", "-A"); g("commit", "-q", "-m", "one");
    r = W5.start("audit-repo", [repo], ["--go"]);
    check("A: audit-repo: doctor, guard --before, then the checker task (exit 3)", names(W5.calls()).join() === "doctor,guard-readonly" && W5.calls()[1].args.includes("--before") && /WAITING-FOR the checker agent/.test(r.out) && r.code === 3, `${names(W5.calls())} ${r.code} ${r.out.slice(-300)}`);
    await new Promise((x) => setTimeout(x, 30));
    w(path.join(repo, ".checks", "REPORT.md"), "#"); w(path.join(repo, ".checks", "causes.json"), "[]");
    W5.clear(); r = W5.start("audit-repo", [repo], ["--go"]);
    check("A: audit-repo: with the checker output present it runs guard --after and is done", names(W5.calls()).join() === "guard-readonly" && W5.calls()[0].args.includes("--after") && r.code === 0, `${names(W5.calls())} ${r.code} ${r.out.slice(-300)}`);
    w(path.join(repo, "b.txt"), "2"); g("add", "-A"); g("commit", "-q", "-m", "two");
    W5.clear(); r = W5.start("audit-repo", [repo], ["--go"]);
    check("A: a moved git HEAD makes the checker stale: the old .checks are not trusted, the agent is asked again", r.code === 3 && /WAITING-FOR the checker agent/.test(r.out) && W5.calls()[0].args.includes("--before"), `${r.code} ${names(W5.calls())} ${r.out.slice(-300)}`);
    W5.cleanup();
    W.cleanup();
  }

  if (want("B")) {
    const W = mkWorld(sdir); const dir = path.join(W.cwd, "newsite"); const pewp = path.join(dir, ".pewp");
    let r = W.start("build", [dir], ["--go", "--brief", "none.txt"]);
    check("B: build mode: intake with open questions stops with the question list as pickable options, exit 3", r.code === 3 && /NEEDS-INPUT stage=intake: 1 question\(s\)\. Ask ALL of them/.test(r.out) && /real estate agent \[recommended\]/.test(r.out) && /QUESTIONS-JSON/.test(r.out), `${r.code} ${r.out.slice(-500)}`);
    check("B: nothing after intake ran", names(W.calls()).join() === "doctor,intake", names(W.calls()).join());
    w(path.join(pewp, "intake-answers.json"), JSON.stringify({ industry: "real estate agent" }));
    W.control("research.mjs.noout"); r = W.start("build", [dir], ["--go", "--stage", "research", "--research-args", "--service sell --yes"]); W.uncontrol("research.mjs.noout");
    check("B: a script that exits 0 but did not write its outputs is FAILED (exit 1)", r.code === 1 && /FAILED stage=research: the script exited 0 but did not write/.test(r.out), `${r.code} ${r.out.slice(-300)}`);
    W.clear(); r = W.start("build", [dir], ["--go", "--research-args", "--service sell --yes"]);
    check("B: with the answers it runs intake, research (args passed through), plan and stops at the targets approval", names(W.calls()).join() === "intake,research,plan-site,approve" && W.calls()[1].args.join(" ").includes("--service sell --yes") && W.calls()[3].args.slice(0, 2)[1] === "targets", names(W.calls()).join());
    check("B: the approval stop prints the diff, names approve.mjs and is exit 3 (start never signs)", r.code === 3 && /DIFF targets/.test(r.out) && /NEEDS-APPROVAL stage=approve-targets/.test(r.out) && /approve\.mjs/.test(r.out) && /--by "<owner name>"/.test(r.out) && !W.calls().some((c) => c.args.includes("--by")), `${r.code} ${r.out.slice(-500)}`);
    w(path.join(pewp, "signed-targets"), "1");
    W.clear(); r = W.start("build", [dir], ["--go"]);
    check("B: after the owner signs targets it moves on to the plan approval and stops there", names(W.calls()).join() === "approve,approve" && /NEEDS-APPROVAL stage=approve-plan/.test(r.out) && r.code === 3, `${names(W.calls())} ${r.code} ${r.out.slice(-300)}`);
    w(path.join(pewp, "signed-plan"), "1");
    W.clear(); r = W.start("build", [dir], ["--go"]);
    check("B: then the handoff runs and the run waits for the builder session", names(W.calls()).includes("build-site") && /WAITING-FOR the builder session/.test(r.out) && r.code === 3, `${names(W.calls())} ${r.code} ${r.out.slice(-300)}`);
    r = W.start("build", [dir], ["--ack", "builder", "--site", path.join(dir, "no-such-site")]);
    check("B: --ack builder with a site folder that does not exist is refused (exit 2)", r.code === 2, `${r.code} ${r.out}`);
    fs.mkdirSync(path.join(dir, "site"), { recursive: true });
    r = W.start("build", [dir], ["--ack", "builder", "--site", path.join(dir, "site")]);
    check("B: --ack builder --site <folder> records the builder as done", r.code === 0 && /builder acknowledged/.test(r.out), `${r.code} ${r.out}`);
    W.clear(); r = W.start("build", [dir], ["--go", "--strict"]);
    const bs = W.calls().find((c) => c.script === "build-site.mjs");
    check("B: the gate runs build-site with --builder-done and the built site (and --strict)", bs && bs.args.includes("--builder-done") && bs.args.includes("--strict") && bs.args[bs.args.indexOf("--site") + 1].endsWith("site"), JSON.stringify(bs));
    check("B: before launch it ends at the natural pause BUILT-AWAITING-MEASURE with exit 0", r.code === 0 && /STATUS: BUILT-AWAITING-MEASURE/.test(r.out), `${r.code} ${r.out.slice(-300)}`);
    // changing the approved targets' source makes the plan, approvals and handoff stale
    await new Promise((x) => setTimeout(x, 30));
    w(path.join(pewp, "targets.json"), JSON.stringify({ clusters: [{ q: "sell house" }, { q: "buy house" }] }));
    r = W.start("build", [dir], []);
    check("B: a changed targets.json marks plan and approve-targets stale in the plan", /plan\s+stale/.test(r.out) && /approve-targets\s+stale/.test(r.out), r.out.slice(0, 1200));
    W.cleanup();
  }

  if (want("C")) {
    const W = mkWorld(sdir); const repo = path.join(W.cwd, "site"); fs.mkdirSync(path.join(repo, ".checks"), { recursive: true });
    w(path.join(repo, ".checks", "REPORT.md"), "# r"); w(path.join(repo, ".checks", "causes.json"), "[]");
    let r = W.start("refactor", [repo], ["--go"]);
    check("C: refactor: without a build command it stops with the question (pickable options), exit 3, before any worker", r.code === 3 && /NEEDS-INPUT stage=refactor-dry/.test(r.out) && /\[build\]/.test(r.out) && !names(W.calls()).includes("refactor"), `${r.code} ${names(W.calls())} ${r.out.slice(-400)}`);
    W.clear(); r = W.start("refactor", [repo], ["--go", "--build", "node gen.mjs", "--causes", "C01,C02"]);
    const dry = W.calls().find((c) => c.script === "refactor.mjs");
    check("C: the dry run gets --build and --dry and the cause list; the stop is the cost approval (exit 3)", dry && dry.args.includes("--dry") && dry.args[dry.args.indexOf("--build") + 1] === "node gen.mjs" && dry.args.includes("C01,C02") && /NEEDS-APPROVAL stage=refactor-ok/.test(r.out) && /2 would get a fix worker/.test(r.out) && r.code === 3, `${JSON.stringify(dry)} ${r.code} ${r.out.slice(-400)}`);
    W.clear(); r = W.start("refactor", [repo], ["--go", "--stage", "refactor"]);
    check("C: --stage refactor before the owner's cost approval is refused (exit 3) and no fix worker runs", r.code === 3 && !W.calls().some((c) => c.script === "refactor.mjs") && /NEEDS-APPROVAL stage=refactor: it depends on .*--ack refactor-ok/.test(r.out), `${r.code} ${names(W.calls())} ${r.out.slice(-300)}`);
    r = W.start("refactor", [repo], ["--ack", "refactor-ok"]);
    check("C: an owner approval needs the owner's name (--by), else exit 2", r.code === 2 && /needs --by/.test(r.out), `${r.code} ${r.out}`);
    r = W.start("refactor", [repo], ["--ack", "guard-before", "--by", "x"]);
    check("C: --ack on a stage a script runs is refused (exit 2)", r.code === 2, `${r.code} ${r.out}`);
    r = W.start("refactor", [repo], ["--ack", "refactor-ok", "--by", "Dave"]);
    check("C: --ack refactor-ok --by Dave is recorded in state.json with the name", r.code === 0 && rj(path.join(repo, ".pewp", "state.json")).stages["refactor-ok"].ack.by === "Dave", `${r.code} ${r.out}`);
    W.clear(); r = W.start("refactor", [repo], ["--go", "--build", "node gen.mjs", "--causes", "C01,C02"]);
    const rf = W.calls().find((c) => c.script === "refactor.mjs" && !c.args.includes("--dry"));
    check("C: the real run gets --visual by default (REF-009), the build command, no --yes", rf && rf.args.includes("--visual") && !rf.args.includes("--yes") && rf.args.includes("--build"), JSON.stringify(rf));
    check("C: after the run it stops at the merge approval: start never merges (exit 3)", r.code === 3 && /NEEDS-APPROVAL stage=refactor-merge/.test(r.out) && /REFACTOR DONE: 2 FIXED/.test(r.out), `${r.code} ${r.out.slice(-500)}`);
    // --no-visual, and a failing refactor
    const W3 = mkWorld(sdir); const repo3 = path.join(W3.cwd, "site"); fs.mkdirSync(path.join(repo3, ".checks"), { recursive: true });
    w(path.join(repo3, ".checks", "REPORT.md"), "# r"); w(path.join(repo3, ".checks", "causes.json"), "[]");
    W3.start("refactor", [repo3], ["--go", "--no-build"]); W3.start("refactor", [repo3], ["--ack", "refactor-ok", "--by", "Dave"]);
    W3.control("refactor.mjs.exit", "1"); W3.clear();
    r = W3.start("refactor", [repo3], ["--go", "--no-build", "--no-visual"]);
    const rf3 = W3.calls().find((c) => c.script === "refactor.mjs");
    check("C: --no-visual leaves --visual out, and a refactor that exits 1 is FAILED (exit 1), not approved", rf3 && !rf3.args.includes("--visual") && r.code === 1 && /FAILED stage=refactor/.test(r.out), `${JSON.stringify(rf3)} ${r.code} ${r.out.slice(-300)}`);
    W3.cleanup(); W.cleanup();
  }

  if (want("D")) {
    const W = mkWorld(sdir); const OLD = "https://old.test/"; const NEW = path.join(W.cwd, "newbuild"); fs.mkdirSync(NEW, { recursive: true }); w(path.join(NEW, "index.html"), "<html></html>");
    const pewp = path.join(W.cwd, "site-checks", "old.test", ".pewp");
    let r = W.start("migrate", [OLD, NEW], ["--go", "--exclude", "^/home-search", "--gsc-file", "gsc.json"]);
    check("D: migrate runs snapshot, inventory, map, then stops at the redirect review (exit 3)", names(W.calls()).join() === "live-target,migrate,migrate" && r.code === 3 && /NEEDS-APPROVAL stage=map-review/.test(r.out) && /3 guesses to approve/.test(r.out), `${names(W.calls())} ${r.code} ${r.out.slice(-400)}`);
    const mi = W.calls()[1], mm = W.calls()[2];
    check("D: migrate.mjs is called with the real command line (old new --stage inventory/map --cwd, exclude, gsc file)", mi.args.slice(0, 4).join(" ").startsWith(`${OLD} ${NEW} --stage inventory`) && mi.args.includes("--gsc-file") && mm.args.includes("map") && mi.args.join(" ").includes("--exclude ^/home-search"), JSON.stringify([mi.args, mm.args]));
    r = W.start("migrate", [OLD, NEW], ["--ack", "map-review", "--by", "Dave"]);
    W.clear(); r = W.start("migrate", [OLD, NEW], ["--go"]);
    check("D: after the review: baseline, then the service-worker check (REF-013) with the new folder, then the gate needs the new origin (exit 3)", names(W.calls()).join() === "migrate,ref-sw" && W.calls()[1].args.includes("--new-site") && /NEEDS-INPUT stage=gate/.test(r.out) && /--new-origin/.test(r.out) && r.code === 3, `${names(W.calls())} ${r.code} ${r.out.slice(-400)}`);
    W.clear(); r = W.start("migrate", [OLD, NEW], ["--go", "--new-origin", "http://127.0.0.1:9"]);
    const g = W.calls().find((c) => c.script === "migrate.mjs" && c.args.includes("gate"));
    check("D: the gate runs with --images (REF-014) by default, the new origin and the exclude list", g && g.args.includes("--images") && g.args.includes("--new-origin") && g.args.includes("http://127.0.0.1:9"), JSON.stringify(g));
    check("D: a passing gate leads to the cutover stop: the owner switches the site, start does not (exit 3)", r.code === 3 && /NEEDS-APPROVAL stage=cutover/.test(r.out), `${r.code} ${r.out.slice(-300)}`);
    r = W.start("migrate", [OLD, NEW], ["--ack", "cutover", "--by", "Dave"]);
    check("D: --ack cutover without --cutover-date is refused (exit 2)", r.code === 2, `${r.code} ${r.out}`);
    r = W.start("migrate", [OLD, NEW], ["--ack", "cutover", "--by", "Dave", "--cutover-date", "2026-11-01"]);
    W.clear(); r = W.start("migrate", [OLD, NEW], ["--go"]);
    const mon = W.calls().find((c) => c.args.includes("monitor"));
    check("D: monitor is called with the cutover date from the acknowledgement", mon && mon.args[mon.args.indexOf("--cutover") + 1] === "2026-11-01" && r.code === 0, `${JSON.stringify(mon)} ${r.code} ${r.out.slice(-200)}`);
    // the owner edits the csv after approving: map-review and the gate go stale
    await new Promise((x) => setTimeout(x, 30));
    w(path.join(pewp, "migrate", "redirect-map.csv"), "from,to\n/a,/c\n");
    r = W.start("migrate", [OLD, NEW], []);
    check("D: editing redirect-map.csv after the review makes map-review stale (needs the owner again)", /map-review\s+stale/.test(r.out), r.out.slice(0, 1500));
    // --no-images, gate failing, gate stopped at a 429
    const W4 = mkWorld(sdir); const NEW4 = path.join(W4.cwd, "nb"); fs.mkdirSync(NEW4, { recursive: true });
    W4.start("migrate", [OLD, NEW4], ["--go"]); W4.start("migrate", [OLD, NEW4], ["--ack", "map-review", "--by", "D"]);
    W4.control("migrate.mjs.gate.exit", "1"); W4.clear();
    r = W4.start("migrate", [OLD, NEW4], ["--go", "--new-origin", "http://127.0.0.1:9", "--no-images"]);
    const g4 = W4.calls().find((c) => c.args.includes("gate"));
    check("D: --no-images leaves --images out; a failed gate is FAILED (exit 1) and the cutover is not offered", g4 && !g4.args.includes("--images") && r.code === 1 && /FAILED stage=gate/.test(r.out) && !/cutover/.test(r.out.split("FAILED")[1] || ""), `${JSON.stringify(g4)} ${r.code} ${r.out.slice(-300)}`);
    W4.control("migrate.mjs.gate.exit", "3"); W4.clear();
    r = W4.start("migrate", [OLD, NEW4], ["--go", "--new-origin", "http://127.0.0.1:9"]);
    check("D: a gate stopped at a 429 is BLOCKED (exit 4), nothing concluded", r.code === 4 && /429/.test(r.out), `${r.code} ${r.out.slice(-300)}`);
    W4.cleanup(); W.cleanup();
  }

  if (want("E")) {
    // measure, research, compare, iterate, local, usage errors
    const W = mkWorld(sdir); const URL1 = "https://fixture.test/"; const pewp = path.join(W.cwd, "site-checks", "fixture.test", ".pewp");
    let r = W.start("measure", [URL1], ["--go", "--property", "sc-domain:fixture.test"]);
    check("E: measure: doctor, init (with the property), plan, run; iterate is optional and its BLOCKED does not fail the run", names(W.calls()).join() === "doctor,measure,measure,measure,iterate" && W.calls()[1].args.includes("sc-domain:fixture.test") && W.calls()[2].args.includes("--plan") && /iterate: skipped, BLOCKED \(optional\)/.test(r.out) && r.code === 0, `${names(W.calls())} ${r.code} ${r.out.slice(-300)}`);
    check("E: measure-run output is dated (today) so it runs again tomorrow", fs.existsSync(path.join(pewp, "measure", TODAY, "summary.json")), "");
    W.clear(); r = W.start("measure", [URL1], ["--go", "--today", "2026-10-24"]);
    check("E: next day: only the run (dated 2026-10-24) and the retried optional iterate; init and plan are not repeated", names(W.calls()).join() === "measure,iterate" && !W.calls()[0].args.includes("--init") && !W.calls()[0].args.includes("--plan") && W.calls()[0].args[W.calls()[0].args.indexOf("--today") + 1] === "2026-10-24", names(W.calls()).join() + JSON.stringify(W.calls()[0]));
    const Wr = mkWorld(sdir); const biz = path.join(Wr.cwd, "bakery");
    r = Wr.start("research", [biz], ["--go"]);
    check("E: research on a name with no site creates the folder and stops at intake questions (exit 3)", r.code === 3 && fs.existsSync(biz) && /NEEDS-INPUT stage=intake/.test(r.out), `${r.code} ${r.out.slice(-200)}`);
    w(path.join(biz, ".pewp", "intake-answers.json"), "{}");
    Wr.clear(); r = Wr.start("research", [biz], ["--go", "--research-args", "--service bread"]);
    check("E: research: intake, then the seeds are proposed and the OWNER seeds approval stops the run (G3): research never ran", names(Wr.calls()).join() === "intake,research-seeds,approve" && Wr.calls()[2].args[1] === "seeds" && r.code === 3 && /NEEDS-APPROVAL stage=approve-seeds/.test(r.out), `${names(Wr.calls())} ${r.code} ${r.out.slice(-200)}`);
    w(path.join(biz, ".pewp", "signed-seeds"), ""); Wr.clear(); r = Wr.start("research", [biz], ["--go"]);
    check("E: research: with the seeds approved, research --dry with the remembered args, then research itself", names(Wr.calls()).join() === "approve,research,research" && Wr.calls()[1].args.includes("--dry") && !Wr.calls()[2].args.includes("--dry") && Wr.calls()[2].args.includes("--service") && r.code === 0, `${names(Wr.calls())} ${r.code} ${r.out.slice(-200)}`);
    const Wc = mkWorld(sdir); const repoB = path.join(Wc.cwd, "repob"); fs.mkdirSync(repoB, { recursive: true });
    r = Wc.start("compare", [URL1, repoB], ["--go", "--launch-state-b", "preview"]);
    check("E: compare: snapshot only for the URL side, a checker task for each side", names(Wc.calls()).join() === "live-target" && /WAITING-FOR the checker agent \(stage=checker-a\)/.test(r.out), `${names(Wc.calls())} ${r.out.slice(-300)}`);
    const cdir = path.join(Wc.cwd, "site-checks", "fixture.test", "snapshots", "2026-10-21");
    w(path.join(cdir, ".checks", "REPORT.md"), "#"); w(path.join(cdir, ".checks", "causes.json"), "[]"); w(path.join(repoB, ".checks", "REPORT.md"), "#"); w(path.join(repoB, ".checks", "causes.json"), "[]");
    Wc.clear(); r = Wc.start("compare", [URL1, repoB], ["--go", "--launch-state-b", "preview"]);
    const cc = Wc.calls().find((c) => c.script === "compare.mjs");
    check("E: compare with both sides checked runs compare.mjs <a> <b> with the launch state, state under site-checks/compare-*", cc && cc.args[0] === URL1 && cc.args[1] === repoB && cc.args.includes("preview") && fs.existsSync(path.join(Wc.cwd, "site-checks", "compare-fixture.test-vs-repob", ".pewp", "state.json")) && r.code === 0, `${JSON.stringify(cc)} ${r.code} ${r.out.slice(-300)}`);
    r = W.start("measure", [URL1], ["--stage", "nope"]);
    check("E: an unknown --stage is a usage error (exit 2) naming the stages", r.code === 2 && /Stages: doctor/.test(r.out), `${r.code} ${r.out}`);
    W.clear(); r = W.run(["audit-live", URL1, "--exclude", "^C:/Program Files/Git/home-search", "--go", "--stage-scripts", W.stubs, "--cwd", W.cwd]);
    check("E: an --exclude rewritten by Git Bash is refused before anything runs (exit 2)", r.code === 2 && /REFUSED/.test(r.out) && W.calls().length === 0, `${r.code} ${r.out}`);
    r = W.run(["nonsense", URL1]);
    check("E: an unknown mode is a usage error (exit 2)", r.code === 2, `${r.code} ${r.out}`);
    const onePipe = path.join(W.root, "one-pipeline.json"); w(onePipe, JSON.stringify({ version: 1, name: "one", what: "one", conventions: {}, vars: {}, steps: [{ id: "doctor", module: "setup", what: "doctor", script: "scripts/doctor.mjs", args: ["{url}"], inputs: [], outputs: ["{pewp}/doctor.json"], dependsOn: [], needsBrowser: "none", needsAi: false, needsPerson: false, needsKeys: [], heavy: false, hits: "none", pace: null, timeoutMinutes: 5, evidence: ["{pewp}/doctor.json"], kind: "derived", maxAgeDays: null }] }));
    r = W.run(["audit", URL1, "--stage-scripts", W.stubs, "--cwd", W.cwd, "--pipeline", onePipe]);
    check("E: `audit <url>` is audit-live", /PLAN audit-live/.test(r.out), r.out.slice(0, 200));
    const Wi = mkWorld(sdir); r = Wi.start("iterate", [URL1], ["--go"]);
    check("E: iterate cannot judge without two measure runs: BLOCKED with what unblocks it (exit 4)", r.code === 4 && /Unblocks: two measure runs/.test(r.out), `${r.code} ${r.out.slice(-300)}`);
    for (const x of [W, Wr, Wc, Wi]) x.cleanup();
  }

  if (want("G")) {
    // overhaul <url> <repo>: the 14-step chain for fixing an existing live site (stages/overhaul.md). Stand-ins for every stage script;
    // what is proven: the order, the OWNER stops, that a later stage never starts before an earlier approval, stale re-approval, the plan
    // ack (G13), the run files (G14), the project inputs asked once (G21), and that nothing is submitted before the sitemap check passes.
    const W = mkWorld(sdir); const live = path.join(W.cwd, "site-checks", "fixture.test"); const pewp = path.join(live, ".pewp");
    const repo = path.join(W.cwd, "siterepo"); fs.mkdirSync(repo, { recursive: true }); w(path.join(repo, "package.json"), "{}");
    const runs = (f) => path.join(pewp, "runs", f);
    let r = W.run(["overhaul", URL1, "--stage-scripts", W.stubs, "--cwd", W.cwd]);
    check("G: overhaul without the repo folder is a usage error (exit 2)", r.code === 2 && /overhaul needs the live site's URL and the code repo/.test(r.out), `${r.code} ${r.out.slice(0, 200)}`);
    r = W.start("overhaul", [URL1, "siterepo"], []);
    const steps = (r.out.match(/== step (\d+) of 14/g) || []).map((x) => Number(x.match(/\d+/)[0]));
    const at = (n) => r.out.indexOf(" " + n.padEnd(18) + " ");
    check("G: the plan (no --go) prints the 14 steps in order with their stages, the OWNER stops and the costs, runs nothing, exit 0", r.code === 0 && W.calls().length === 0 && steps.join() === "1,2,3,4,5,6,7,8,9,10,11,12,13,14" && (r.out.match(/OWNER/g) || []).length >= 8 && at("sitemap-check") > 0 && at("sitemap-check") < at("sitemap-submit") && at("approve-competitors") < at("authority") && at("approve-seeds") < at("research") && at("approve-plan") < at("checker-repo") && at("classify") < at("approve-business") && at("deploy") < at("sitemap-check"), `${r.code} ${W.calls().length} ${steps.join()} ${r.out.slice(0, 400)}`);
    check("G: the plan calls plan/sitemap.json the page plan and the sitemap file what search engines read (G10)", /page plan/.test(r.out) && /sitemap file search engines read/.test(r.out) && !/the sitemap \(plan/.test(r.out), r.out.slice(0, 300));
    check("G: a run file is written even for the plan-only start (G14), saying the owner has not seen the plan", fs.existsSync(runs(`${TODAY}-overhaul.md`)) && /exit code: 0/.test(fs.readFileSync(runs(`${TODAY}-overhaul.md`), "utf8")) && /NOT RECORDED/.test(fs.readFileSync(runs(`${TODAY}-overhaul.md`), "utf8")), fs.existsSync(runs(`${TODAY}-overhaul.md`)) ? fs.readFileSync(runs(`${TODAY}-overhaul.md`), "utf8").slice(0, 400) : "no run file");
    // G13: --go without the owner's plan ack runs the free doctor and stops before the first external stage
    W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go", "--no-plan-ack"]);
    check("G: --go without the plan ack runs doctor (free) and stops at plan-ok before the snapshot (exit 3): nothing external ran", r.code === 3 && names(W.calls()).join() === "doctor" && /NEEDS-APPROVAL stage=plan-ok \(before snapshot\)/.test(r.out) && /--ack plan-ok --by/.test(r.out), `${r.code} ${names(W.calls())} ${r.out.slice(-500)}`);
    check("G: the run file records the stop and the doctor stage it ran", /exit code: 3/.test(fs.readFileSync(runs(`${TODAY}-overhaul.md`), "utf8")) && fs.existsSync(runs(`${TODAY}-overhaul-doctor.md`)) && /doctor\.mjs/.test(fs.readFileSync(runs(`${TODAY}-overhaul-doctor.md`), "utf8")), fs.readFileSync(runs(`${TODAY}-overhaul.md`), "utf8").slice(0, 500));
    // a forced later stage never starts before the approval it depends on
    W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go", "--stage", "seeds-propose"]);
    check("G: --stage seeds-propose before the competitor list is approved is refused (NEEDS-APPROVAL, exit 3) and research-seeds never runs", r.code === 3 && !names(W.calls()).includes("research-seeds") && /NEEDS-APPROVAL stage=seeds-propose: it depends on .*the approval that writes approved\/competitors\.json/.test(r.out), `${r.code} ${names(W.calls())} ${r.out.slice(-400)}`);
    // the owner acked the plan (the harness did it): the chain runs to the first stop of each step
    W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go"]);
    check("G: with the ack: doctor is done, the snapshot runs, psi is skipped without its key, and it stops at the live checker agent (exit 3)", r.code === 3 && names(W.calls()).join() === "live-target" && /psi: skipped \(PSI_API_KEY not set/.test(r.out) && /WAITING-FOR the checker agent \(stage=checker-live\)/.test(r.out), `${r.code} ${names(W.calls())} ${r.out.slice(-500)}`);
    const snapDir = path.join(live, "snapshots", "2026-10-21"); w(path.join(snapDir, ".checks", "REPORT.md"), "# live"); w(path.join(snapDir, ".checks", "causes.json"), JSON.stringify([{ id: "C01", rules: ["SCH-001"] }]));
    W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go"]);
    check("G: step 2 ends with report-live; step 3 intake asks the owner's questions (NEEDS-INPUT, exit 3)", r.code === 3 && names(W.calls()).join() === "report-live,intake" && /NEEDS-INPUT stage=intake/.test(r.out), `${r.code} ${names(W.calls())} ${r.out.slice(-400)}`);
    w(path.join(pewp, "intake-answers.json"), JSON.stringify({ kind: { value: "editorial-media", answeredBy: "owner" } }));
    W.control("classify-business.mjs.needs"); W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go"]);
    check("G: with the answers intake completes; classify writes the one-screen definition and stops when a field is missing or not the owner's (NEEDS-INPUT, exit 3), before any approval", r.code === 3 && names(W.calls()).join() === "intake,classify-business" && /NEEDS-INPUT stage=classify: NEEDS-INPUT classify: vocabulary missing/.test(r.out) && fs.existsSync(path.join(pewp, "business-definition.md")), `${r.code} ${names(W.calls())} ${r.out.slice(-300)}`);
    W.uncontrol("classify-business.mjs.needs"); W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go"]);
    check("G: when the definition is complete the OWNER approval of the business definition stops the run (exit 3), approve.mjs business shown the diff", r.code === 3 && names(W.calls()).slice(-2).join() === "classify-business,approve" && W.calls().at(-1).args[1] === "business" && /Kind of business: editorial-media/.test(r.out) && /NEEDS-APPROVAL stage=approve-business/.test(r.out), `${r.code} ${names(W.calls())} ${JSON.stringify(W.calls()[1])} ${r.out.slice(-300)}`);
    w(path.join(pewp, "signed-business"), ""); W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go"]);
    check("G: step 4: competitors-discover without candidates stops for the main session's discovery (NEEDS-INPUT, exit 3) and names the kinds", r.code === 3 && names(W.calls()).join() === "approve,competitors-discover" && /Instagram/.test(r.out) && /NEEDS-INPUT/.test(r.out), `${r.code} ${names(W.calls())} ${r.out.slice(-400)}`);
    W.control("competitors-discover.mjs.ok"); W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go"]);
    check("G: with candidates the proposed list is written and the OWNER approval of the competitors stops the run", r.code === 3 && names(W.calls()).join() === "competitors-discover,approve" && W.calls()[1].args[1] === "competitors" && /NEEDS-APPROVAL stage=approve-competitors/.test(r.out), `${r.code} ${names(W.calls())} ${r.out.slice(-300)}`);
    w(path.join(pewp, "signed-competitors"), ""); W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go"]);
    const c5 = W.calls();
    check("G: authority-prepare is tried early with --download-only and skipped as BLOCKED (no release); step 5 proposes seeds and stops at the OWNER seeds approval", r.code === 3 && names(c5).join() === "approve,authority,research-seeds,approve" && c5[1].args.includes("--download-only") && /authority-prepare: skipped, BLOCKED/.test(r.out) && /NEEDS-APPROVAL stage=approve-seeds/.test(r.out), `${r.code} ${names(c5)} ${r.out.slice(-400)}`);
    w(path.join(pewp, "signed-seeds"), ""); W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go"]);
    // the optional authority-prepare (BLOCKED) is tried again on every --go, like any optional BLOCKED stage: it is left out of the order checks below
    const nz = (cs) => names(cs).filter((n) => n !== "authority");
    const c6 = W.calls(); const rs = c6.filter((c) => c.script === "research.mjs"); const au = c6.find((c) => c.script === "authority.mjs" && !c.args.includes("--download-only")); const ps = c6.find((c) => c.script === "plan-site.mjs");
    check("G: research runs (dry plan, then the run) only after the seeds are approved; authority on the approved list is BLOCKED and skipped with its follow-ups; the page plan and its picture are written; stop at the OWNER targets approval", r.code === 3 && nz(c6).join() === "approve,research,research,plan-site,plan-picture,approve" && au && rs[0].args.includes("--dry") && !rs[1].args.includes("--dry") && au.args.includes("--approved-competitors") && au.args.includes("--require-approved") && au.args.join(" ").includes("--competitor rival.test") && !au.args.join(" ").includes("@rival") && /authority-classify: skipped \(authority BLOCKED or skipped/.test(r.out) && ps.args.includes("--require-approved-business") && /NEEDS-APPROVAL stage=approve-targets/.test(r.out), `${r.code} ${nz(c6)} ${JSON.stringify(au?.args)} ${r.out.slice(-400)}`);
    // stale: the seeds change after their approval -> the approval is asked again before anything else
    fs.rmSync(path.join(pewp, "signed-seeds")); w(path.join(pewp, "research", "seeds.json"), JSON.stringify({ queries: [{ query: "victorian houses for sale", from: "owner" }] }));
    W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go"]);
    check("G: a changed seeds.json after its approval makes approve-seeds stale: the owner is asked again and research does not run on the new seeds", r.code === 3 && nz(W.calls()).join() === "approve" && /approve-seeds: stale/.test(r.out) && /NEEDS-APPROVAL stage=approve-seeds/.test(r.out), `${r.code} ${names(W.calls())} ${r.out.slice(-400)}`);
    w(path.join(pewp, "signed-seeds"), ""); W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go"]);
    check("G: after the re-approval research is stale and runs again, then the targets approval stops", r.code === 3 && nz(W.calls()).slice(0, 3).join() === "approve,research,research" && /NEEDS-APPROVAL stage=approve-targets/.test(r.out), `${r.code} ${names(W.calls())} ${r.out.slice(-300)}`);
    w(path.join(pewp, "signed-targets"), ""); w(path.join(pewp, "signed-plan"), ""); W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go"]);
    check("G: targets and page plan approved: step 8 guards the repo and stops at the repo checker agent", r.code === 3 && nz(W.calls()).join() === "approve,approve,guard-readonly" && /WAITING-FOR the checker agent \(stage=checker-repo\)/.test(r.out) && /siterepo/.test(r.out), `${r.code} ${names(W.calls())} ${r.out.slice(-300)}`);
    w(path.join(repo, ".checks", "REPORT.md"), "# repo"); w(path.join(repo, ".checks", "causes.json"), JSON.stringify([{ id: "C01", rules: ["SCH-001"] }]));
    W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go"]);
    const qids = (r.out.match(/\[(build|setup|max-parallel|merges)\]/g) || []).join(" ");
    check("G: step 9 maps the live causes onto the repo causes (causes-map with --live), then refactor-dry asks ONCE for the build command, the setup command, the workers at once and who merges (G21), exit 3", r.code === 3 && nz(W.calls()).join() === "guard-readonly,causes-map" && W.calls().find((c) => c.script === "causes-map.mjs").args.includes("--live") && /NEEDS-INPUT stage=refactor-dry: 4 question/.test(r.out) && ["[build]", "[setup]", "[max-parallel]", "[merges]"].every((q) => qids.includes(q)), `${r.code} ${names(W.calls())} ${qids} ${r.out.slice(-600)}`);
    W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go", "--build", "bun run build", "--no-setup", "--max-parallel", "1", "--project-merges"]);
    check("G: with the four answers the dry run goes and the OWNER cost approval stops the run", r.code === 3 && nz(W.calls()).join() === "refactor" && W.calls().at(-1).args.includes("--dry") && W.calls().at(-1).args.join(" ").includes("--max-parallel 1") && W.calls().at(-1).args.includes("--project-merges") && /NEEDS-APPROVAL stage=refactor-ok/.test(r.out), `${r.code} ${names(W.calls())} ${JSON.stringify(W.calls()[0])} ${r.out.slice(-300)}`);
    W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go", "--stage", "refactor"]);
    check("G: --stage refactor before the OWNER cost approval is refused (NEEDS-APPROVAL, exit 3): no fix worker runs without --ack refactor-ok", r.code === 3 && !W.calls().some((c) => c.script === "refactor.mjs") && /NEEDS-APPROVAL stage=refactor: it depends on .*--ack refactor-ok/.test(r.out), `${r.code} ${names(W.calls())} ${r.out.slice(-300)}`);
    r = W.start("overhaul", [URL1, "siterepo"], ["--ack", "refactor-ok", "--by", "Owner"]); W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go"]);
    const rf = W.calls().find((c) => c.script === "refactor.mjs" && !c.args.includes("--dry"));
    check("G: the fix run gets the remembered project inputs (--build, --max-parallel 1, --project-merges, --visual) and stops at the OWNER merge decision, which names the project's merge gate", r.code === 3 && rf && rf.args.join(" ").includes("--max-parallel 1") && rf.args.includes("--project-merges") && rf.args.includes("--visual") && /NEEDS-APPROVAL stage=refactor-merge/.test(r.out) && /project's own merge gate/.test(r.out), `${r.code} ${JSON.stringify(rf)} ${r.out.slice(-300)}`);
    r = W.start("overhaul", [URL1, "siterepo"], ["--ack", "refactor-merge", "--by", "Owner"]); W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go"]);
    const ho = W.calls().find((c) => c.script === "build-site.mjs");
    check("G: step 10: the handoff is written into the run's own .pewp (build-site --pewp) and it waits for the builder session", r.code === 3 && ho && ho.args.includes("--pewp") && ho.args[ho.args.indexOf("--pewp") + 1] === pewp && fs.existsSync(path.join(pewp, "builder", "HANDOFF.md")) && /WAITING-FOR the builder session/.test(r.out) && /--ack builder --site/.test(r.out), `${r.code} ${JSON.stringify(ho)} ${r.out.slice(-300)}`);
    r = W.start("overhaul", [URL1, "siterepo"], ["--ack", "builder", "--site", path.join(repo, "dist")]);
    check("G: --ack builder refuses a built folder that does not exist (exit 2)", r.code === 2 && /does not exist/.test(r.out), `${r.code} ${r.out}`);
    fs.mkdirSync(path.join(repo, "dist"), { recursive: true }); r = W.start("overhaul", [URL1, "siterepo"], ["--ack", "builder", "--site", path.join(repo, "dist")]); W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go"]);
    const gt = W.calls().find((c) => c.script === "gate.mjs");
    check("G: step 11 gates the built folder --strict with the build command, then step 12 stops for the OWNER's deploy (exit 3), which must record the release", r.code === 3 && gt && gt.args[0] === pewp && gt.args[1] === path.join(repo, "dist") && gt.args.includes("--strict") && gt.args.join(" ").includes("--build bun run build") && /NEEDS-APPROVAL stage=deploy/.test(r.out) && /--release/.test(r.out), `${r.code} ${JSON.stringify(gt)} ${r.out.slice(-300)}`);
    r = W.start("overhaul", [URL1, "siterepo"], ["--ack", "deploy", "--by", "Owner"]);
    check("G: --ack deploy without --release is refused (exit 2): the skill records what went live", r.code === 2 && /--release/.test(r.out), `${r.code} ${r.out}`);
    r = W.start("overhaul", [URL1, "siterepo"], ["--ack", "deploy", "--by", "Owner", "--release", "abc123"]);
    check("G: the deploy ack records the release in state.json", rj(path.join(pewp, "state.json")).stages.deploy?.ack?.release === "abc123", JSON.stringify(rj(path.join(pewp, "state.json")).stages.deploy));
    W.control("sitemap-check.mjs.fail"); W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go"]);
    check("G: step 13: a failing sitemap check FAILS the run (exit 1) and sitemap-submit is never called: nothing is submitted before the file passes", r.code === 1 && nz(W.calls()).join() === "sitemap-check" && /FAILED stage=sitemap-check/.test(r.out) && /nothing is submitted until it passes/.test(r.out), `${r.code} ${names(W.calls())} ${r.out.slice(-300)}`);
    W.uncontrol("sitemap-check.mjs.fail"); W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go"]);
    const sub = W.calls().find((c) => c.script === "sitemap-submit.mjs");
    check("G: when the check passes the sitemap file is submitted (--sitemap <live>/sitemap.xml), step 14 measures the baseline, iterate is BLOCKED (optional) and ALL STAGES DONE (exit 0)", r.code === 0 && nz(W.calls()).join() === "sitemap-check,sitemap-submit,measure,measure,measure,iterate" && sub.args.join(" ").includes("--sitemap https://fixture.test/sitemap.xml") && /iterate: skipped, BLOCKED/.test(r.out) && /ALL STAGES DONE/.test(r.out), `${r.code} ${names(W.calls())} ${r.out.slice(-400)}`);
    const st = rj(path.join(pewp, "state.json"));
    check("G: state.json records the plan ack by the owner for this mode and the mode's sequence", st.start.planAck?.overhaul?.by === "Test Owner" && st.start.mode === "overhaul" && st.start.sequence.length >= 38 && st.start.status === "done", JSON.stringify(st.start).slice(0, 300));
    check("G: the final run file lists the stages run and exit 0, and one file per stage exists", /exit code: 0/.test(fs.readFileSync(runs(`${TODAY}-overhaul.md`), "utf8")) && /sitemap-submit \(exit 0\)/.test(fs.readFileSync(runs(`${TODAY}-overhaul.md`), "utf8")) && fs.existsSync(runs(`${TODAY}-overhaul-sitemap-check.md`)), fs.readFileSync(runs(`${TODAY}-overhaul.md`), "utf8").slice(0, 600));
    // a capped authority follow-up ends exit 0 with the last line 'PARTIAL: <why>': kept as partial with its reason, never done, so the next --go runs it again
    w(path.join(pewp, "authority.json"), "{}"); w(path.join(pewp, "authority", "opportunities.json"), "{}"); W.control("authority-classify.mjs.partial");
    W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go", "--stage", "authority-classify"]);
    const acP = rj(path.join(pewp, "state.json")).stages["authority-classify"], outP = r.out;
    W.clear(); r = W.start("overhaul", [URL1, "siterepo"], ["--go"]);
    check("G: a capped authority-classify (exit 0, last line 'PARTIAL: ...') is kept in state.json as partial with its reason, not done; start prints PARTIAL: for it and the next --go runs it again", acP?.partial === "read 10 of 25" && !acP.doneAt && /authority-classify: PARTIAL: read 10 of 25/.test(outP) && names(W.calls()).includes("authority-classify"), `${JSON.stringify(acP)} ${names(W.calls())} ${outP.slice(-300)}`);
    // --yes is the main session saying the owner agreed in words: recorded as such, no stop
    const Wy = mkWorld(sdir); const repoY = path.join(Wy.cwd, "r2"); fs.mkdirSync(repoY, { recursive: true });
    r = Wy.start("overhaul", [URL1, "r2"], ["--go", "--yes", "--no-plan-ack"]);
    const sty = rj(path.join(Wy.cwd, "site-checks", "fixture.test", ".pewp", "state.json"));
    check("G: --go --yes passes the plan-ok stop and records how (--yes, main session) in state.json and the run file", r.code === 3 && names(Wy.calls()).join() === "doctor,live-target" && sty.start.planAck?.overhaul?.how === "--yes" && /plan seen by the owner: --yes/.test(fs.readFileSync(path.join(Wy.cwd, "site-checks", "fixture.test", ".pewp", "runs", `${TODAY}-overhaul.md`), "utf8")), `${r.code} ${names(Wy.calls())} ${JSON.stringify(sty.start.planAck)}`);
    // --env-file: an existing file is loaded by start itself and handed to doctor as --dotenv (never --env-file: Node 24 pre-scans that name)
    const envFile = path.join(Wy.cwd, "keys.env"); w(envFile, "PEWP_TEST_ONLY_NAME=secret-value-xyz\n");
    Wy.clear(); r = Wy.start("overhaul", [URL1, "r2"], ["--go", "--stage", "doctor", "--env-file", envFile]);
    const dc = Wy.calls().find((c) => c.script === "doctor.mjs");
    check("G: --env-file is loaded by start (names only printed) and passed to doctor as --dotenv; the value never appears in the output or the run file", dc && dc.args.includes("--dotenv") && !dc.args.includes("--env-file") && /env: loaded 1 name/.test(r.out) && !/secret-value-xyz/.test(r.out) && !/secret-value-xyz/.test(fs.readFileSync(path.join(Wy.cwd, "site-checks", "fixture.test", ".pewp", "runs", `${TODAY}-overhaul.md`), "utf8")), `${r.code} ${JSON.stringify(dc)} ${r.out.slice(0, 300)}`);
    W.cleanup(); Wy.cleanup();
  }

  if (want("F")) {
    // The REAL stage scripts, offline stages only, on fixtures: the command lines start builds must be accepted by the scripts that
    // own them (a stand-in would accept anything). No network: doctor --offline, plan, approve, intake on a folder, research --dry,
    // measure --init/--plan, iterate (BLOCKED), migrate map/inventory are not run here (they need a snapshot).
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-startreal-")); const cwd = path.join(root, "cwd"); fs.mkdirSync(cwd);
    const real = (args) => { const r = spawnSync(node, [path.join(sdir, "start.mjs"), ...args, "--cwd", cwd, "--today", TODAY, "--go"], { cwd, encoding: "utf8", timeout: 120000 }); return { code: r.status, out: (r.stdout || "") + (r.stderr || "") }; };
    const dir = path.join(cwd, "site1"); fs.cpSync(path.join(sdir, "..", "fixtures", "pewp"), path.join(dir, ".pewp"), { recursive: true });
    let r = real(["build", dir, "--stage", "doctor", "--offline"]);
    check("F: real doctor.mjs accepts start's command line (offline) and writes doctor.json", r.code === 0 && fs.existsSync(path.join(dir, ".pewp", "doctor.json")), `${r.code} ${r.out.slice(-400)}`);
    r = real(["build", dir, "--stage", "plan"]);
    check("F: real plan-site.mjs accepts <pewp> and writes plan/sitemap.json", r.code === 0 && fs.existsSync(path.join(dir, ".pewp", "plan", "sitemap.json")), `${r.code} ${r.out.slice(-500)}`);
    r = real(["build", dir, "--stage", "approve-targets"]);
    check("F: real approve.mjs shows the diff of the targets and the stop is NEEDS-APPROVAL (exit 3), nothing signed", r.code === 3 && /NEEDS-APPROVAL stage=approve-targets/.test(r.out) && !fs.existsSync(path.join(dir, ".pewp", "approved", "lock.json")), `${r.code} ${r.out.slice(-600)}`);
    w(path.join(dir, ".pewp", "approved", "seeds.json"), "{}"); // research-plan depends on the seeds approval (G3): a forced stage is refused without it
    r = real(["research", dir, "--stage", "research-plan"]);
    check("F: real research.mjs --dry accepts start's command line and prints the plan to the log (exit 0)", r.code === 0 && fs.existsSync(path.join(dir, ".pewp", "start", "research-plan.log")) && /DRY RUN/.test(fs.readFileSync(path.join(dir, ".pewp", "start", "research-plan.log"), "utf8")), `${r.code} ${r.out.slice(-600)}`);
    const dirB = path.join(cwd, "empty-biz");
    r = real(["build", dirB, "--stage", "intake"]);
    check("F: real intake.mjs on a folder with no facts stops with the question list from intake-facts.json (exit 3)", r.code === 3 && /NEEDS-INPUT stage=intake: \d+ question\(s\)/.test(r.out) && /QUESTIONS-JSON/.test(r.out), `${r.code} ${r.out.slice(-600)}`);
    const URLM = "https://fixture.test/";
    r = real(["measure", URLM, "--stage", "measure-init", "--property", "sc-domain:fixture.test"]);
    const mcfg = path.join(cwd, "site-checks", "fixture.test", ".pewp", "measure");
    check("F: real measure.mjs --init accepts the property and writes config.json and run.mjs", r.code === 0 && fs.existsSync(path.join(mcfg, "config.json")) && fs.existsSync(path.join(mcfg, "run.mjs")), `${r.code} ${r.out.slice(-500)}`);
    r = real(["iterate", URLM, "--stage", "iterate"]);
    check("F: real iterate.mjs without approved files cannot judge: start reports BLOCKED with the unblock step (exit 4)", r.code === 4 && /BLOCKED stage=iterate/.test(r.out) && /Unblocks: two measure runs/.test(r.out), `${r.code} ${r.out.slice(-500)}`);
    r = real(["measure", URLM, "--stage", "iterate"]);
    check("F: in measure mode the same iterate is optional: skipped as BLOCKED and the stage run ends (exit 0)", r.code === 0 && /iterate: skipped, BLOCKED \(optional\)/.test(r.out), `${r.code} ${r.out.slice(-400)}`);
    const repo = path.join(cwd, "plainrepo"); fs.mkdirSync(repo, { recursive: true }); fs.writeFileSync(path.join(repo, "index.html"), "<html></html>");
    r = real(["audit-repo", repo, "--stage", "guard-before"]);
    check("F: real guard-readonly.mjs accepts <repo> --before (exit 0)", r.code === 0, `${r.code} ${r.out.slice(-300)}`);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
}

// ---------------- mutants ----------------
const MUTANTS = [
  { name: "stale detection disabled", file: "start.mjs", from: "if (rec.inputsHash && rec.inputsHash !== cur.hash) {", to: "if (false) {", sc: "A+B+D", expect: [/^A: steps whose input changed are marked stale/, /^B: a changed targets\.json marks plan/, /^D: editing redirect-map\.csv/] },
  { name: "--go not needed to run stages", file: "start.mjs", from: "if (!go && !val(\"--ack\")) {", to: "if (false) {", sc: "A", expect: [/^A: plan only/] },
  { name: "approval exit 3 treated as approved", file: "start.mjs", from: "(r.code === 0 ? { outcome: \"done\", message: \"approved copy matches the working file\" } : r.code === 3 ?", to: "(r.code === 0 || r.code === 3 ? { outcome: \"done\", message: \"approved copy matches the working file\" } : r.code === 99 ?", sc: "B", expect: [/^B: the approval stop prints the diff/] },
  { name: "--by not required for an owner approval", file: "start.mjs", from: "if (s.ack.by && !val(\"--by\"))", to: "if (false)", sc: "C", expect: [/^C: an owner approval needs the owner's name/] },
  { name: "--stage runs the whole sequence", file: "start.mjs", from: "const targetsToRun = val(\"--stage\") ? [byName.get(val(\"--stage\"))] : SEQ;", to: "const targetsToRun = SEQ;", sc: "G", expect: [/^G: --stage seeds-propose before the competitor list is approved is refused/] },
  { name: "a script's outputs are not verified", file: "start.mjs", from: "if (v.outcome === \"done\" && outsOf(s).some((o) => !fs.existsSync(o)))", to: "if (false)", sc: "B", expect: [/^B: a script that exits 0 but did not write its outputs/] },
  { name: "an optional BLOCKED stage stops the run", file: "start.mjs", from: "if (v.outcome === \"blocked\" && s.optional) {", to: "if (false) {", sc: "E", expect: [/^E: measure: doctor, init/] },
  { name: "audit-live: exit 0 counts as done without looking at the evidence", file: "start.mjs", from: "evidence: r.code === 0 ? evid(m, since) : null", to: "evidence: null", sc: "A", expect: [/^A: a script that exits 0 without writing its evidence/, /^A: evidence that exists but is older/, /^A: empty evidence/] },
  { name: "audit-live: a BLOCKED step stops the whole run", file: "start.mjs", from: "blockedNotes.push(`${s.name}: ${v.message}`); res.set(s.name, \"blocked\"); continue; }", to: "blockedNotes.push(`${s.name}: ${v.message}`); return 4; }", sc: "A", expect: [/^A: every waiting step is listed/] },
  { name: "audit-live: exit 3 without a BLOCKED last line is believed", file: "lib-pipeline.mjs", from: "return /^BLOCKED:/.test(ll) ? {", to: "return true ? {", sc: "A", expect: [/^A: exit 3 whose last line is not/] },
  { name: "audit-live: a skipped step holds its dependents", file: "start.mjs", from: "const settled = new Set([\"done\", \"skipped\"]);", to: "const settled = new Set([\"done\"]);", sc: "A", expect: [/^A: a skipped step does not hold its dependent/] },
  { name: "audit-live: a waiting step's old evidence counts after an input changed", file: "start.mjs", from: "const since = Date.parse(rec?.doneAt || 0) || 0;", to: "const since = 0;", sc: "A", expect: [/^A: the next --go asks for the checker again/] },
  { name: "audit-live: a step runs before the steps it depends on are settled", file: "start.mjs", from: "const unmet = forced ? [] : s.dependsOn.filter((d) => !settled.has(res.get(d)));", to: "const unmet = [];", sc: "A", expect: [/^A: --go runs doctor, the snapshot and authority/] },
  { name: "audit-live: external steps run without the owner's plan ack", file: "start.mjs", from: "if (!planAckOf() && s.external) {", to: "if (false) {", sc: "A", expect: [/^A: without the owner's plan ack/] },
  { name: "audit-live: --no-authority does not skip the authority module", file: "start.mjs", from: "skipIf: () => (m.module === \"authority\" && flag(\"--no-authority\") ? \"--no-authority\" : null),", to: "skipIf: () => null,", sc: "A", expect: [/^A: --no-authority skips/] },
  { name: "audit-live: the script gets the skill folder as --cwd instead of this run's", file: "start.mjs", from: "(raw[i - 1] === \"--cwd\" && m.args[i] === \"{skill}\" ? cwd : a)", to: "a", sc: "A", expect: [/^A: the snapshot gets its manifest args, --cwd of this run/] },
  { name: "audit-live: an invalid manifest still runs", file: "start.mjs", from: "if (problems.length) die(`${rel(PIPELINE_FILE)} is not valid; nothing ran:", to: "if (false) die(`${rel(PIPELINE_FILE)} is not valid; nothing ran:", sc: "A", expect: [/^A: a manifest whose script does not exist is invalid/, /^A: a manifest with an unknown key is invalid/] },
  { name: "audit-live: a PARTIAL: last line is not honoured", file: "lib-pipeline.mjs", from: "if (code === 0 && /^PARTIAL:/.test(ll)) return", to: "if (false) return", sc: "A", expect: [/^A: a step that exits 0 with a PARTIAL: last line is PARTIAL/] },
  { name: "audit-live: a SKIPPED step's reason is not recorded", file: "start.mjs", from: "markDone(s, {}, { skipped: String(v.message).slice(0, 300) });", to: "markDone(s);", sc: "A", expect: [/^A: exit 4 with 'SKIPPED/] },
  { name: "audit-live: --stage starts before its dependencies are done", file: "start.mjs", from: "if (dep.length) { setRun(\"waiting-for-dependency\"", to: "if (false) { setRun(\"waiting-for-dependency\"", sc: "A", expect: [/^A: --stage on a step whose dependencies are not done is refused/] },
  { name: "audit-live: --stage runs the whole manifest", file: "start.mjs", from: "const queue = forced ? [byName.get(forced)] : SEQ;", to: "const queue = SEQ;", sc: "A", expect: [/^A: --stage snapshot runs ONLY the snapshot/, /^A: --stage report-live re-runs only report-live/] },
  { name: "audit-live: a step with a NEEDS-INPUT line is reported as BLOCKED, the owner is not asked", file: "start.mjs", from: "if (o.outcome === \"needs-input\") return { outcome: \"needs-input\", message: intakeQuestionText(m.id, r) ||", to: "if (false) return { outcome: \"needs-input\", message: intakeQuestionText(m.id, r) ||", sc: "A", expect: [/^A: a step that exits 3 with a NEEDS-INPUT line/] },
  { name: "audit-live: {work} stays under ~/.claude", file: "start.mjs", from: "work: underClaude(loc.root) ? path.join(os.tmpdir(), \"pewp-work\", loc.host) : path.join(loc.root, \"work\")", to: "work: path.join(loc.root, \"work\")", sc: "A", expect: [/^A: when the run lives under ~\/\.claude, \{work\} is/] },
  { name: "audit-live: a stopped script step is started anyway", file: "start.mjs", from: "if (stopS) { stopBlock(s, stopS); continue; }", to: "if (false) { stopBlock(s, stopS); continue; }", sc: "A", expect: [/^A: while a stop is in force a step with engines is BLOCKED/] },
  { name: "audit-live: a stopped owner-browser capture is asked for anyway", file: "start.mjs", from: "if (stopW) { stopBlock(s, stopW); continue; }", to: "if (false) { stopBlock(s, stopW); continue; }", sc: "A", expect: [/^A: while a stop is in force a step with engines is BLOCKED/] },
  { name: "audit-live: a desktop lift frees a script too", file: "start.mjs", from: "const stopS = stepStop(s.manifest, { mode: \"script\" });", to: "const stopS = stepStop(s.manifest, { mode: \"desktop\" });", sc: "A", expect: [/^A: a desktop lift of the google stop frees only/] },
  { name: "audit-live: a desktop lift is not honoured for the owner-browser capture", file: "start.mjs", from: "mode: s.kind === \"browser\" ? \"desktop\" : \"script\" });", to: "mode: \"script\" });", sc: "A", expect: [/^A: a desktop lift of the google stop frees only/] },
  { name: "audit-live: the stop is not recorded in state.json", file: "start.mjs", from: ", stop: { engine: stop.engine, until: stop.until } }; }); console.log(`${s.name}: BLOCKED:", to: " }; }); console.log(`${s.name}: BLOCKED:", sc: "A", expect: [/^A: the stop is recorded for the step in state.json/] },
  { name: "audit-live: the runner does not make {work}", file: "start.mjs", from: "prepare: () => { if (usesWork) fs.mkdirSync(pipelineVars().work, { recursive: true }); },", to: "prepare: () => {},", sc: "A", expect: [/^A: the runner made \{work\}/] },
  { name: "audit-live: a waiting step is done without evidence being newer than its last completion nor present", file: "start.mjs", from: "if (ev.ok && !forced) { markDone(s);", to: "if (!forced) { markDone(s);", sc: "A", expect: [/^A: every waiting step is listed/] },
  { name: "the agent's old outputs count as done", file: "start.mjs", from: "const fresh = done && outsOf(s).every((o) => fs.statSync(o).mtimeMs > since) && !forced;", to: "const fresh = done && !forced;", sc: "A", expect: [/^A: a moved git HEAD makes the checker stale/] },
  { name: "refactor runs without the visual proof by default", file: "start.mjs", from: "...(flag(\"--no-visual\") ? [] : [\"--visual\"])", to: "...(flag(\"--no-visual\") ? [] : [])", sc: "C", expect: [/^C: the real run gets --visual by default/] },
  { name: "the migrate gate leaves the image check out", file: "start.mjs", from: "...(flag(\"--no-images\") ? [] : [\"--images\"])", to: "...[]", sc: "D", expect: [/^D: the gate runs with --images/] },
  { name: "the gate runs without the new origin", file: "start.mjs", from: "needs: () => (newFolder && !val(\"--new-origin\")", to: "needs: () => (false && !val(\"--new-origin\")", sc: "D", expect: [/^D: after the review: baseline/] },
  { name: "the service-worker check is dropped from migrate", file: "start.mjs", from: "{ name: \"service-workers\", kind: \"script\"", to: "{ name: \"service-workers\", skipIf: () => \"x\", kind: \"script\"", sc: "D", expect: [/^D: after the review: baseline/] },
  { name: "options are not remembered between starts", file: "start.mjs", from: "if (!keys.has(k)) { A = [...A, k, ...(v == null ? [] : [v])]; remembered.push(v == null ? k : `${k} ${v}`); }", to: "if (!keys.has(k)) { }", sc: "A+D", expect: [/^A: options given once/, /^D: after the review: baseline/] },
  { name: "the cutover date from the acknowledgement is lost", file: "start.mjs", from: "const cutoverDate = () => (load(runLoc)?.stages?.cutover?.ack?.date) || val(\"--cutover-date\");", to: "const cutoverDate = () => null;", sc: "D", expect: [/^D: monitor is called with the cutover date/] },
  // overhaul (scenario G)
  { name: "G13: external stages run without the owner's plan ack", file: "start.mjs", from: "if (s.external && !planAckOf()) {", to: "if (false) {", sc: "G", expect: [/^G: --go without the plan ack runs doctor/] },
  { name: "G13: --yes is not recorded as the plan ack", file: "start.mjs", from: "if (go && flag(\"--yes\") && !planAckOf()) persist(", to: "if (false) persist(", sc: "G", expect: [/^G: --go --yes passes the plan-ok stop/] },
  { name: "G14: no run file is written", file: "start.mjs", from: "const finish = (code) => { writeRunFiles(code); process.exit(code); };", to: "const finish = (code) => { process.exit(code); };", sc: "G", expect: [/^G: a run file is written even for the plan-only start/] },
  { name: "a forced stage starts before the approval it depends on", file: "start.mjs", from: "if (missing.length) { setRun(\"needs-approval\", s.name, missing.join(\", \"));", to: "if (false) { setRun(\"needs-approval\", s.name, missing.join(\", \"));", sc: "G", expect: [/^G: --stage seeds-propose before the competitor list is approved is refused/] },
  { name: "the seeds approval is not an input of research (unapproved seeds would be researched)", file: "start.mjs", from: "inputs: () => [\"business.json\", \"approved/seeds.json\", \"approved/competitors.json\", \"captures/serp\", \"captures/ai\"] });", to: "inputs: () => [\"business.json\", \"approved/competitors.json\", \"captures/serp\", \"captures/ai\"] });", sc: "G", expect: [/^G: after the re-approval research is stale and runs again/] },
  { name: "authority is not told the approved competitor list", file: "start.mjs", from: "\"--approved-competitors\", P(\"approved\", \"competitors.json\"), \"--require-approved\", ...approvedDomains().flatMap((d) => [\"--competitor\", d])]),", to: "...approvedDomains().flatMap((d) => [\"--competitor\", d])]),", sc: "G", expect: [/^G: research runs \(dry plan, then the run\) only after the seeds are approved/] },
  { name: "a failed sitemap check counts as passed (submit would run)", file: "start.mjs", from: "judge: (r) => (r.code === 0 ? { outcome: \"done\", message: r.out.split(\"\\n\").filter((l) => /^(PASS|sitemap:)/.test(l)).join(\"\\n\") } : r.code === 3 ?", to: "judge: (r) => (r.code === 0 || r.code === 1 ? { outcome: \"done\", message: r.out.split(\"\\n\").filter((l) => /^(PASS|sitemap:)/.test(l)).join(\"\\n\") } : r.code === 3 ?", sc: "G", expect: [/^G: step 13: a failing sitemap check FAILS the run/] },
  { name: "G21: who merges is not asked", file: "start.mjs", from: "...(flag(\"--project-merges\") || flag(\"--owner-merges\") ? [] : [{ id: \"merges\",", to: "...(true ? [] : [{ id: \"merges\",", sc: "G", expect: [/^G: step 9 maps the live causes onto the repo causes/] },
  { name: "G21: --max-parallel is not passed to the fix run", file: "start.mjs", from: "...(val(\"--max-parallel\") ? [\"--max-parallel\", val(\"--max-parallel\")] : []), ...(flag(\"--project-merges\") ? [\"--project-merges\"] : [])];", to: "...(flag(\"--project-merges\") ? [\"--project-merges\"] : [])];", sc: "G", expect: [/^G: with the four answers the dry run goes/] },
  { name: "--ack deploy does not need the release", file: "start.mjs", from: "if (s.name === \"deploy\") { if (!String(val(\"--release\") || \"\").trim()) die(", to: "if (s.name === \"deploy\") { if (false) die(", sc: "G", expect: [/^G: --ack deploy without --release is refused/] },
  { name: "the fix run does not depend on the owner's cost approval (a forced --stage refactor would run workers)", file: "start.mjs", from: "inputs: () => [{ abs: path.join(repo, \".checks\", \"causes.json\") }, \"start/refactor-dry.log\", \"start/ack-refactor-ok\"]", to: "inputs: () => [{ abs: path.join(repo, \".checks\", \"causes.json\") }, \"start/refactor-dry.log\"]", sc: "G", expect: [/^G: --stage refactor before the OWNER cost approval is refused/] },
  { name: "refactor mode: the fix run does not depend on the owner's cost approval", file: "start.mjs", from: "inputs: () => [{ abs: path.join(loc.root, \".checks\", \"causes.json\") }, \"start/refactor-dry.log\", \"start/ack-refactor-ok\"]", to: "inputs: () => [{ abs: path.join(loc.root, \".checks\", \"causes.json\") }, \"start/refactor-dry.log\"]", sc: "C", expect: [/^C: --stage refactor before the owner's cost approval is refused/] },
  { name: "the classify stage is dropped from step 3", file: "start.mjs", from: "{ name: \"classify\", kind: \"script\", what:", to: "{ name: \"classify\", kind: \"script\", skipIf: () => \"x\", what:", sc: "G", expect: [/^G: with the answers intake completes; classify writes/] },
  { name: "overhaul: a capped authority follow-up (PARTIAL: last line) counts as done", file: "start.mjs", from: "return o.outcome === \"partial\" ? { outcome: \"partial\", message: o.message } : { outcome: \"done\", message: \"\" };", to: "return { outcome: \"done\", message: \"\" };", sc: "G", expect: [/^G: a capped authority-classify/] },
  { name: "G1: children get --env-file (Node 24 pre-scans it) instead of --dotenv", file: "start.mjs", from: "const envArgs = () => (envInfo.file ? [\"--dotenv\", envInfo.file] : []);", to: "const envArgs = () => (envInfo.file ? [\"--env-file\", envInfo.file] : []);", sc: "G", expect: [/^G: --env-file is loaded by start/] },
];

if (isMain(import.meta.url)) { // lib-main.mjs: real paths (started through a junction this used to skip the whole suite)
  // --help: the usage path test-main.mjs runs through a junction (inside the guard, so a broken guard prints nothing and goes red)
  if (A.includes("--help")) { console.log("usage: node test-start.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>] [--keep]"); process.exit(0); }
  const t0 = Date.now();
  const main = await runScenarios(scriptsDir);
  for (const r of main) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail.slice(0, 700)}`}`);
  let failed = main.filter((r) => !r.ok).length; const mainFailed = failed; let caught = 0, ran = 0;
  console.log(failed ? `START TEST FAIL: ${failed} of ${main.length}` : `START TEST PASS: ${main.length} of ${main.length}`);
  if (!failed && !A.includes("--no-mutants")) {
    console.log("\nWatched-fail mutants (each must turn the named assertions red; the unmutated tree is green above):");
    for (const mu of MUTANTS.filter((m) => !opt("--mutant") || m.name.includes(opt("--mutant")))) {
      ran++;
      const mdir = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-mutant-"));
      const sdir = path.join(mdir, "scripts");
      for (let t = 0; ; t++) { try { fs.mkdirSync(sdir, { recursive: true }); fs.cpSync(scriptsDir, sdir, { recursive: true }); break; } catch (e) { if (t >= 4) throw e; } }
      const target = path.join(sdir, mu.file); const src = fs.readFileSync(target, "utf8"); const count = src.split(mu.from).length - 1;
      if (count !== 1) { console.log(`FAIL mutant "${mu.name}": patch target found ${count} times in ${mu.file} (the patch did not apply)`); failed++; fs.rmSync(mdir, { recursive: true, force: true }); continue; }
      fs.writeFileSync(target, src.replace(mu.from, () => mu.to));
      const chk = spawnSync(node, ["--check", target], { encoding: "utf8", timeout: 60_000 });
      if (chk.status) { console.log(`FAIL mutant "${mu.name}": mutated file does not parse: ${chk.stderr.slice(0, 200)}`); failed++; fs.rmSync(mdir, { recursive: true, force: true }); continue; }
      const res = await runScenarios(sdir, mu.sc.split("+"));
      const red = res.filter((r) => !r.ok);
      const missing = mu.expect.filter((re) => !red.some((r) => re.test(r.name)));
      const ok = red.length > 0 && !missing.length;
      if (ok) caught++; else failed++;
      console.log(`${ok ? "RED (caught)" : "FAIL (survived)"} ${mu.name}: ${red.length} assertion(s) red${red.length ? ` e.g. "${red[0].name.slice(0, 80)}"` : ""}${missing.length ? `; expected red but green: ${missing.map(String).join(" ")}` : ""}`);
      fs.rmSync(mdir, { recursive: true, force: true, maxRetries: 5 });
    }
    console.log(failed ? `MUTANTS FAIL: ${caught} of ${ran} caught` : `MUTANTS PASS: ${caught} of ${ran} caught`);
  }
  if (A.includes("--json")) console.log(JSON.stringify({ suite: "start", ok: !failed, assertions: { total: main.length, failed: mainFailed }, mutants: ran ? { ran, caught, failed: ran - caught } : null, wallMs: Date.now() - t0 }));
  process.exit(failed ? 1 : 0);
}
