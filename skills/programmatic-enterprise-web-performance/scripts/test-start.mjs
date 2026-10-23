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
import { fileURLToPath } from "node:url";

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
  else { w(path.join(l.pewp, "intake-facts.json"), JSON.stringify({ questions: [{ id: "Q1", field: "industry", question: "What kind of business is it?", options: [{ label: "real estate agent" }, { label: "other" }], recommended: 0 }] })); say("questions open"); process.exit(3); }
}
else if (name === "research.mjs") {
  const l = locOf(args[0]);
  if (args.includes("--dry")) { say("DRY RUN: nothing fetched. plan: 12 external calls"); done(); }
  if (!noout) w(path.join(l.pewp, "targets.json"), JSON.stringify({ clusters: [{ q: "sell house" }] }));
  say("DONE 1 clusters"); done();
}
else if (name === "plan-site.mjs") { const p = args[0]; w(path.join(p, "plan", "sitemap.json"), JSON.stringify({ pages: [{ path: "/" }] })); say("plan written"); done(); }
else if (name === "approve.mjs") {
  const l = locOf(args[0]); const kind = args[1];
  if (fs.existsSync(path.join(l.pewp, "signed-" + kind))) { if (kind === "targets") w(path.join(l.pewp, "approved", "targets.json"), "{}"); else w(path.join(l.pewp, "approved", "plan", "sitemap.json"), "{}"); w(path.join(l.pewp, "approved", "lock.json"), "{}"); say("approved " + kind); done(); }
  else { say("DIFF " + kind + ": +1 cluster"); process.exit(3); }
}
else if (name === "build-site.mjs") {
  const l = locOf(args[0]);
  if (args.includes("--builder-done")) { say("gate: PASS (x)"); say("measure: BLOCKED"); say("STATUS: BUILT-AWAITING-MEASURE"); done(); }
  else { w(path.join(l.pewp, "builder", "HANDOFF.md"), "# handoff"); w(path.join(l.pewp, "builder", "builder-prompt.md"), "Read the handoff"); say("handoff: wrote"); say("WAITING-FOR-BUILDER: start a builder session"); done(); }
}
else if (name === "report-live.mjs") { const l = locOf(args[0]); if (!noout) { w(path.join(l.pewp, "report.md"), "# report"); w(path.join(l.pewp, "report.json"), "{}"); } say("report written"); done(); }
else if (name === "authority.mjs") { if (fs.existsSync(ctlFile("ok"))) { w(args[0], "{}"); say("authority ok"); done(); } say("BLOCKED: no complete Common Crawl release in the cache"); process.exit(3); }
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
const STUB_NAMES = ["doctor", "live-target", "intake", "research", "plan-site", "approve", "build-site", "report-live", "authority", "guard-readonly", "refactor", "measure", "iterate", "migrate", "ref-sw", "compare", "local-run"];

// ---------------- harness ----------------
function mkWorld(sdir, { omit = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-start-"));
  const stubs = path.join(root, "stubs"), ctl = path.join(root, "ctl"), cwd = path.join(root, "cwd");
  fs.mkdirSync(stubs); fs.mkdirSync(ctl); fs.mkdirSync(cwd);
  for (const n of STUB_NAMES) if (!omit.includes(n)) w(path.join(stubs, n + ".mjs"), STUB);
  const log = path.join(root, "calls.log"); fs.writeFileSync(log, "");
  const env = { ...process.env, STUB_LOG: log, STUB_CTL: ctl, STUB_REAL: sdir };
  const run = (args, { stdin = "" } = {}) => {
    const r = spawnSync(node, [path.join(sdir, "start.mjs"), ...args, ...(args.includes("--") ? [] : []), ], { cwd, env, encoding: "utf8", timeout: 120000 });
    return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
  };
  // run with the usual global options appended before any `--`
  const start = (mode, targets, extra = []) => {
    const dd = extra.indexOf("--"); const pre = dd >= 0 ? extra.slice(0, dd) : extra; const post = dd >= 0 ? extra.slice(dd) : [];
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

  if (want("A")) {
    const W = mkWorld(sdir); const live = path.join(W.cwd, "site-checks", "fixture.test"); const pewp = path.join(live, ".pewp");
    // A1: no --go -> plan only
    let r = W.start("audit-live", [URL1], ["--exclude", "^/home-search"]);
    check("A: plan only (no --go) runs nothing and exits 0", r.code === 0 && W.calls().length === 0 && /Plan only/.test(r.out), `${r.code} ${W.calls().length} ${r.out.slice(0, 300)}`);
    check("A: the plan lists the audit-live stages in order with costs", ["doctor", "snapshot", "checker", "authority", "report"].every((n, i, a) => r.out.indexOf(n.padEnd(18)) > (i ? r.out.indexOf(a[i - 1].padEnd(18)) : -1)) && /cost: polite crawl/.test(r.out), r.out.slice(0, 900));
    let st = rj(path.join(pewp, "state.json"));
    check("A: the sequence is recorded in state.json", st.start?.mode === "audit-live" && st.start.sequence.map((s) => s.name).join() === "doctor,snapshot,checker,authority,report" && st.start.status === "planned", JSON.stringify(st.start));
    // A2: --go runs doctor + snapshot then stops at the checker (a task for the main session)
    r = W.start("audit-live", [URL1], ["--go", "--exclude", "^/home-search", "--max-pages", "9"]);
    const c2 = W.calls();
    check("A: --go runs doctor then live-target, in order", names(c2).join() === "doctor,live-target", names(c2).join());
    check("A: the snapshot gets the exact command line (url, --cwd, then -- --exclude ... --max-pages)", c2[1] && c2[1].args[0] === URL1 && c2[1].args.includes("--cwd") && c2[1].args.join(" ").includes("-- --exclude ^/home-search --max-pages 9"), JSON.stringify(c2[1]));
    check("A: it stops at the checker with WAITING-FOR, the coordinator brief and exit 3", r.code === 3 && /WAITING-FOR the checker agent/.test(r.out) && /coordinator\.md/.test(r.out) && /"sonnet"/.test(r.out) && /plan\.mjs/.test(r.out), `${r.code} ${r.out.slice(-600)}`);
    // A3: the checker's outputs appear; the optional authority is BLOCKED and skipped; the report runs; all done
    const snapDir = path.join(live, "snapshots", "2026-10-21");
    w(path.join(snapDir, ".checks", "REPORT.md"), "# report"); w(path.join(snapDir, ".checks", "causes.json"), "[]");
    W.clear(); r = W.start("audit-live", [URL1], ["--go"]);
    const c3 = names(W.calls());
    check("A: with the checker output present it goes on: authority (BLOCKED, optional, skipped), then report-live", c3.join() === "authority,report-live" && /authority: skipped, BLOCKED \(optional\)/.test(r.out) && r.code === 0 && /ALL STAGES DONE/.test(r.out), `${c3.join()} ${r.code} ${r.out.slice(-500)}`);
    check("A: report-live gets the url and --cwd", W.calls()[1]?.args[0] === URL1, JSON.stringify(W.calls()[1]));
    // A4: a second run does nothing
    W.clear(); r = W.start("audit-live", [URL1], ["--go"]);
    check("A: a second --go with nothing changed re-runs nothing but the optional stage that was BLOCKED (authority), exit 0", names(W.calls()).join() === "authority" && r.code === 0 && /ALL STAGES DONE/.test(r.out), `${names(W.calls())} ${r.code}`);
    // A5: a new snapshot makes the checker and the report stale; stale is written to state.json
    W.control("snap-new-1"); W.clear();
    r = W.start("audit-live", [URL1], ["--go", "--stage", "snapshot"]);
    st = rj(path.join(pewp, "state.json"));
    check("A: --stage snapshot runs ONLY the snapshot", names(W.calls()).join() === "live-target", names(W.calls()).join());
    check("A: options given once (--exclude, --max-pages) are remembered: the next start of the same run still sends them to the crawler", W.calls()[0].args.join(" ").includes("-- --exclude ^/home-search --max-pages 9") && /options remembered/.test(r.out), JSON.stringify(W.calls()[0]) + r.out.slice(0, 300));
    check("A: stages whose input changed are marked stale in state.json (checker, report)", !!st.stages.checker?.stale && !!st.stages.report?.stale && /_site\.json/.test(JSON.stringify(st.stages.checker.stale.changed)), JSON.stringify([st.stages.checker?.stale, st.stages.report?.stale]));
    check("A: and --stage says which ones it marked", /marked stale in state\.json.*checker.*report/.test(r.out), r.out.slice(-300));
    W.clear(); r = W.start("audit-live", [URL1], ["--go"]);
    check("A: the next --go re-runs the stale checker (asks for the agent again) and does NOT run report-live on old checks", r.code === 3 && /WAITING-FOR the checker agent/.test(r.out) && !names(W.calls()).includes("report-live"), `${r.code} ${names(W.calls())} ${r.out.slice(-300)}`);
    const snap2 = path.join(live, "snapshots", "2026-10-22");
    await new Promise((x) => setTimeout(x, 30));
    w(path.join(snap2, ".checks", "REPORT.md"), "# report2"); w(path.join(snap2, ".checks", "causes.json"), "[]");
    W.clear(); r = W.start("audit-live", [URL1], ["--go"]);
    check("A: once the agent redid it, the report is re-run on the new checks", names(W.calls()).includes("report-live") && r.code === 0, `${names(W.calls())} ${r.code} ${r.out.slice(-300)}`);
    // A6: --stage forces one stage even when done
    W.clear(); r = W.start("audit-live", [URL1], ["--go", "--stage", "report"]);
    check("A: --stage report re-runs only report-live although it is done", names(W.calls()).join() === "report-live" && r.code === 0, names(W.calls()).join());
    // A7: a stage that exits 0 without its outputs FAILS (a pass without the file proves nothing)
    W.control("report-live.mjs.noout"); fs.rmSync(path.join(pewp, "report.md")); W.clear();
    r = W.start("audit-live", [URL1], ["--go"]);
    check("A: a script that exits 0 but did not write its outputs is FAILED, exit 1", r.code === 1 && /FAILED stage=report: the script exited 0 but did not write/.test(r.out), `${r.code} ${r.out.slice(-300)}`);
    W.uncontrol("report-live.mjs.noout");
    // A8: a stage script that does not exist is BLOCKED (never improvised)
    const W2 = mkWorld(sdir, { omit: ["report-live"] });
    W2.start("audit-live", [URL1], ["--go"]);
    const sd2 = path.join(W2.cwd, "site-checks", "fixture.test", "snapshots", "2026-10-21");
    w(path.join(sd2, ".checks", "REPORT.md"), "#"); w(path.join(sd2, ".checks", "causes.json"), "[]");
    r = W2.start("audit-live", [URL1], ["--go"]); W2.cleanup();
    check("A: a stage whose script is not built is BLOCKED with what unblocks it (exit 4), never improvised", r.code === 4 && /BLOCKED stage=report: scripts\/report-live\.mjs is not built yet\. Unblocks:/.test(r.out), `${r.code} ${r.out.slice(-300)}`);
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
    check("E: research: intake, then research --dry with the args, then research itself", names(Wr.calls()).join() === "intake,research,research" && Wr.calls()[1].args.includes("--dry") && !Wr.calls()[2].args.includes("--dry") && Wr.calls()[2].args.includes("--service") && r.code === 0, `${names(Wr.calls())} ${r.code} ${r.out.slice(-200)}`);
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
    r = W.run(["audit", URL1, "--stage-scripts", W.stubs, "--cwd", W.cwd]);
    check("E: `audit <url>` is audit-live", /PLAN audit-live/.test(r.out), r.out.slice(0, 200));
    const Wi = mkWorld(sdir); r = Wi.start("iterate", [URL1], ["--go"]);
    check("E: iterate cannot judge without two measure runs: BLOCKED with what unblocks it (exit 4)", r.code === 4 && /Unblocks: two measure runs/.test(r.out), `${r.code} ${r.out.slice(-300)}`);
    for (const x of [W, Wr, Wc, Wi]) x.cleanup();
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
  { name: "stale detection disabled", file: "start.mjs", from: "if (rec.inputsHash && rec.inputsHash !== cur.hash) {", to: "if (false) {", sc: "A+B+D", expect: [/^A: stages whose input changed are marked stale/, /^B: a changed targets\.json marks plan/, /^D: editing redirect-map\.csv/] },
  { name: "--go not needed to run stages", file: "start.mjs", from: "if (!go && !val(\"--ack\")) {", to: "if (false) {", sc: "A", expect: [/^A: plan only/] },
  { name: "approval exit 3 treated as approved", file: "start.mjs", from: "(r.code === 0 ? { outcome: \"done\", message: \"approved copy matches the working file\" } : r.code === 3 ?", to: "(r.code === 0 || r.code === 3 ? { outcome: \"done\", message: \"approved copy matches the working file\" } : r.code === 99 ?", sc: "B", expect: [/^B: the approval stop prints the diff/] },
  { name: "--by not required for an owner approval", file: "start.mjs", from: "if (s.ack.by && !val(\"--by\"))", to: "if (false)", sc: "C", expect: [/^C: an owner approval needs the owner's name/] },
  { name: "--stage runs the whole sequence", file: "start.mjs", from: "const targetsToRun = val(\"--stage\") ? [byName.get(val(\"--stage\"))] : SEQ;", to: "const targetsToRun = SEQ;", sc: "A", expect: [/^A: --stage snapshot runs ONLY the snapshot/, /^A: --stage report re-runs only report-live/] },
  { name: "a script's outputs are not verified", file: "start.mjs", from: "if (v.outcome === \"done\" && outsOf(s).some((o) => !fs.existsSync(o)))", to: "if (false)", sc: "A", expect: [/^A: a script that exits 0 but did not write/] },
  { name: "an optional BLOCKED stage stops the run", file: "start.mjs", from: "if (v.outcome === \"blocked\" && s.optional) {", to: "if (false) {", sc: "A+E", expect: [/^A: with the checker output present/, /^E: measure: doctor, init/] },
  { name: "the agent's old outputs count as done", file: "start.mjs", from: "const fresh = done && outsOf(s).every((o) => fs.statSync(o).mtimeMs > since) && !forced;", to: "const fresh = done && !forced;", sc: "A", expect: [/^A: a moved git HEAD makes the checker stale/] },
  { name: "refactor runs without the visual proof by default", file: "start.mjs", from: "...(flag(\"--no-visual\") ? [] : [\"--visual\"])", to: "...(flag(\"--no-visual\") ? [] : [])", sc: "C", expect: [/^C: the real run gets --visual by default/] },
  { name: "the migrate gate leaves the image check out", file: "start.mjs", from: "...(flag(\"--no-images\") ? [] : [\"--images\"])", to: "...[]", sc: "D", expect: [/^D: the gate runs with --images/] },
  { name: "the gate runs without the new origin", file: "start.mjs", from: "needs: () => (newFolder && !val(\"--new-origin\")", to: "needs: () => (false && !val(\"--new-origin\")", sc: "D", expect: [/^D: after the review: baseline/] },
  { name: "the service-worker check is dropped from migrate", file: "start.mjs", from: "{ name: \"service-workers\", kind: \"script\"", to: "{ name: \"service-workers\", skipIf: () => \"x\", kind: \"script\"", sc: "D", expect: [/^D: after the review: baseline/] },
  { name: "options are not remembered between starts", file: "start.mjs", from: "if (!keys.has(k)) { A = [...A, k, ...(v == null ? [] : [v])]; remembered.push(v == null ? k : `${k} ${v}`); }", to: "if (!keys.has(k)) { }", sc: "A+D", expect: [/^A: options given once/, /^D: after the review: baseline/] },
  { name: "the cutover date from the acknowledgement is lost", file: "start.mjs", from: "const cutoverDate = () => (load(runLoc)?.stages?.cutover?.ack?.date) || val(\"--cutover-date\");", to: "const cutoverDate = () => null;", sc: "D", expect: [/^D: monitor is called with the cutover date/] },
];

if (isMain(import.meta.url)) { // lib-main.mjs: real paths (started through a junction this used to skip the whole suite)
  // --help: the usage path test-main.mjs runs through a junction (inside the guard, so a broken guard prints nothing and goes red)
  if (A.includes("--help")) { console.log("usage: node test-start.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>] [--keep]"); process.exit(0); }
  const main = await runScenarios(scriptsDir);
  for (const r of main) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail.slice(0, 700)}`}`);
  let failed = main.filter((r) => !r.ok).length;
  console.log(failed ? `START TEST FAIL: ${failed} of ${main.length}` : `START TEST PASS: ${main.length} of ${main.length}`);
  if (!failed && !A.includes("--no-mutants")) {
    console.log("\nWatched-fail mutants (each must turn the named assertions red; the unmutated tree is green above):");
    let caught = 0, ran = 0;
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
  process.exit(failed ? 1 : 0);
}
