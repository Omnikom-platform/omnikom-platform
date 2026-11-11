// Usage: node test-step-contracts.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of three scripts keeping pipeline.json's step contract (exit 0 = ok with its evidence, exit 3 = BLOCKED with the LAST line
// `BLOCKED: <what> | unblocks: <what would>`; a runner quotes that line and never invents a reason):
//   A  live-target.mjs: EVERY successful run, a reuse too, writes snapshots/latest.json (dir, finishedAt, reused, at), so the snapshot step's evidence is a file
//      written by this run; a failed run leaves the pointer alone
//   B  local-grid.mjs plan and import: BLOCKED (nothing could be planned or imported) is exit 3 with the BLOCKED line last, cities without a sourced centre are
//      listed before it; a partial plan (some cities have centres) is exit 0 with its requests written
//   C  intake.mjs: without the owner's answers it keeps its question lines and a NEEDS-INPUT line, and its LAST line is the BLOCKED line (exit 3)
//   K  EVERY script step of pipeline.json whose BLOCKED path is cheap to reach (a bare fixture: no pewp files, no key, no network): run with its manifest args it must exit 3
//      with a last line that starts "BLOCKED:" (what stepOutcome enforces; a step that exits 1, 2 or 0 there is a convention breaker and shows up HERE, not in the
//      first live run). The steps that cannot be reached that way are listed, each with the reason; the last lines that lack the full form " | unblocks: " are listed too.
// No network (netguard-import.mjs), no browser: the snapshot crawl is a stand-in script in a scratch copy of live-target.mjs and its helpers.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { runner, J, W, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const SITE = "https://contract-test.test/";
const lastLine = (s) => String(s).trim().split("\n").pop();

async function scenarios(dir) {
  const results = [], check = checker(results);
  const tmp = mkTmp("contracts"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
  fs.mkdirSync(home);
  const run = runner(dir, home, netLog, ["STUB_FAIL", "PSI_API_KEY", "BING_WEBMASTER_KEY", "CRUX_API_KEY", "REDDIT_TOKEN", "GSC_SERVICE_ACCOUNT_FILE", "GSC_TOKEN_FILE"]);
  try {
    // ---------------- A: live-target.mjs writes snapshots/latest.json on every successful run ----------------
    const mini = path.join(tmp, "mini"); fs.mkdirSync(mini);
    for (const f of ["live-target.mjs", "lib-main.mjs", "lib-polite.mjs", "state.mjs", "netguard-import.mjs"]) fs.copyFileSync(path.join(dir, f), path.join(mini, f));
    fs.writeFileSync(path.join(mini, "snapshot-site.mjs"), `import fs from "node:fs"; import path from "node:path";
const dir = process.argv[3];
if (process.env.STUB_FAIL) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "_site.json"), JSON.stringify({ stoppedEarly: "429" })); process.exit(3); }
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "_site.json"), JSON.stringify({ origin: "https://contract-test.test", finishedAt: new Date().toISOString(), pages: [{ url: "https://contract-test.test/", status: 200 }] }));
console.log("stand-in crawl done");
`);
    const runMini = runner(mini, home, netLog, ["STUB_FAIL"]);
    const cwdA = path.join(tmp, "cwdA"), snaps = path.join(cwdA, "site-checks", "contract-test.test", "snapshots"), latest = path.join(snaps, "latest.json");
    const t0 = Date.now();
    const a1 = await runMini("live-target.mjs", [SITE, "--cwd", cwdA]);
    const p1 = fs.existsSync(latest) ? J(latest) : null;
    check("A: a new snapshot writes snapshots/latest.json { dir, finishedAt, reused: false, at } and the file is newer than the start of the run", a1.code === 0 && /^NEW /m.test(a1.so) && p1 && p1.reused === false && p1.dir && fs.existsSync(path.join(p1.dir, "_site.json")) && !Number.isNaN(Date.parse(p1.finishedAt)) && Date.parse(p1.at) >= t0 && fs.statSync(latest).mtimeMs >= t0, `exit ${a1.code} ${a1.out} ${JSON.stringify(p1)}`);
    await new Promise((r) => setTimeout(r, 60));
    const t1 = Date.now();
    const a2 = await runMini("live-target.mjs", [SITE, "--cwd", cwdA]);
    const p2 = fs.existsSync(latest) ? J(latest) : null;
    check("A: a REUSE (young snapshot, nothing crawled) still writes latest.json, reused true, the same dir, newer than the start of that run", a2.code === 0 && /^REUSE /m.test(a2.so) && p2 && p2.reused === true && p2.dir === p1?.dir && fs.statSync(latest).mtimeMs >= t1 && Date.parse(p2.at) >= t1 && fs.readdirSync(snaps).filter((x) => /^\d{4}-/.test(x)).length === 1, `exit ${a2.code} ${a2.out} ${JSON.stringify(p2)}`);
    await new Promise((r) => setTimeout(r, 60));
    const a3 = await runMini("live-target.mjs", [SITE, "--cwd", cwdA, "--fresh"]);
    const p3 = fs.existsSync(latest) ? J(latest) : null;
    check("A: --fresh takes a new snapshot and the pointer follows it (reused false, a second dated folder)", a3.code === 0 && /^NEW /m.test(a3.so) && p3 && p3.reused === false && p3.dir !== p1?.dir && fs.readdirSync(snaps).filter((x) => /^\d{4}-/.test(x)).length === 2, `exit ${a3.code} ${a3.out} ${JSON.stringify(p3)}`);
    const before = fs.existsSync(latest) ? fs.readFileSync(latest, "utf8") : null;
    const a4 = await runMini("live-target.mjs", [SITE, "--cwd", cwdA, "--fresh"], { env: { STUB_FAIL: "1" } });
    check("A: a failed crawl exits 1 and leaves the pointer exactly as it was (a failed run hands nothing on)", a4.code === 1 && /^FAILED /m.test(a4.so) && before !== null && fs.readFileSync(latest, "utf8") === before, `exit ${a4.code} ${a4.out}`);

    // ---------------- B: local-grid.mjs ----------------
    const cwdB = path.join(tmp, "cwdB"), pewpB = path.join(cwdB, "site-checks", "contract-test.test", ".pewp"), gdir = path.join(pewpB, "captures", "local", "grid");
    const biz = (area) => W(path.join(pewpB, "business.json"), { name: "Contract Test Lending", domain: "contract-test.test", market: { country: "US", language: "en" }, locations: area ? [{ serviceArea: area }] : [{}] });
    const grid = (cmd, extra = []) => run("local-grid.mjs", [cmd, SITE, "--cwd", cwdB, ...extra]);
    biz(null);
    let b = await grid("plan", ["--query", "hard money loans {city}"]);
    check("B: plan with no service-area cities is BLOCKED: exit 3 and the last line is 'BLOCKED: <what> | unblocks: <what would>'", b.code === 3 && /^BLOCKED: business\.json has no locations\[\]\.serviceArea cities \| unblocks: Add the service-area cities/.test(lastLine(b.so)), `exit ${b.code} ${b.out}`);
    biz(["Sacramento, CA", "Elk Grove, CA"]);
    b = await grid("plan");
    check("B: plan with no query templates is BLOCKED: exit 3, last line 'BLOCKED: no query templates for the grid | unblocks: Pass --query ...'", b.code === 3 && /^BLOCKED: no query templates for the grid \| unblocks: Pass --query/.test(lastLine(b.so)), `exit ${b.code} ${b.out}`);
    b = await grid("plan", ["--query", "hard money loans {city}"]);
    const lines = b.so.trim().split("\n");
    check("B: plan with no city centres: each city is listed 'BLOCKED city X: ...' BEFORE the one BLOCKED line, which is last, exit 3, no requests.json", b.code === 3 && lines.filter((l) => /^BLOCKED city /.test(l)).length === 2 && /^BLOCKED: no service-area city has a sourced centre, so there is nothing to plan \| unblocks: /.test(lines.at(-1)) && lines.findIndex((l) => /^BLOCKED: /.test(l)) > lines.findLastIndex((l) => /^BLOCKED city /.test(l)) && !fs.existsSync(path.join(gdir, "requests.json")), `exit ${b.code} ${b.out}`);
    W(path.join(gdir, "cities.json"), [{ city: "Sacramento, CA", lat: 38.58111, lng: -121.49389, source: "https://en.wikipedia.org/wiki/Sacramento,_California", readAt: "2026-11-10" }]);
    b = await grid("plan", ["--query", "hard money loans {city}", "--n", "1"]);
    check("B: a partial plan (one city has a sourced centre, one does not) is exit 0: requests.json is written, the other city is listed 'BLOCKED city ...' and nothing is blocked as a whole", b.code === 0 && fs.existsSync(path.join(gdir, "requests.json")) && /^BLOCKED city Elk Grove, CA: no centre coordinates/m.test(b.so) && !/^BLOCKED: /m.test(b.so), `exit ${b.code} ${b.out}`);
    W(path.join(gdir, "cities.json"), [{ city: "Sacramento, CA", lat: 38.58111, lng: -121.49389, source: "https://en.wikipedia.org/wiki/Sacramento,_California", readAt: "2026-11-10" }, { city: "Elk Grove, CA", lat: 38.4088, lng: -121.3716, source: "https://en.wikipedia.org/wiki/Elk_Grove,_California", readAt: "2026-11-10" }]);
    b = await grid("plan", ["--query", "hard money loans {city}", "--n", "1"]);
    check("B: a full plan is exit 0 with no line that starts with BLOCKED", b.code === 0 && !/^BLOCKED/m.test(b.so), `exit ${b.code} ${b.out}`);
    b = await grid("import");
    check("B: import with no grid captures is BLOCKED: exit 3, last line 'BLOCKED: no grid captures in <dir> | unblocks: Run `local-grid.mjs plan` ...'", b.code === 3 && /^BLOCKED: no grid captures in .* \| unblocks: Run `local-grid\.mjs plan`/.test(lastLine(b.so)), `exit ${b.code} ${b.out}`);
    b = await run("local-grid.mjs", ["nonsense"]);
    check("B: a bad command line is still a usage error (exit 2, nothing on stdout)", b.code === 2 && /usage: node local-grid\.mjs/.test(b.se), `exit ${b.code} ${b.out}`);

    // ---------------- C: intake.mjs ----------------
    const empty = path.join(tmp, "site-empty"); fs.mkdirSync(empty);
    const c = await run("intake.mjs", [empty, "--cwd", tmp]);
    const cl = c.so.trim().split("\n");
    check("C: intake without the owner's answers keeps its question list (QUESTIONS n and the JSON) and a NEEDS-INPUT line, exit 3, intake-facts.json written", c.code === 3 && cl.some((l) => /^QUESTIONS \d+/.test(l)) && cl.some((l) => /^NEEDS-INPUT intake: \d+ question\(s\) for the owner/.test(l)) && fs.existsSync(path.join(empty, ".pewp", "intake-facts.json")), `exit ${c.code} ${c.out.slice(-600)}`);
    check("C: its LAST line is 'BLOCKED: intake needs the owner's answers | unblocks: answer the questions above in <pewp>/intake-answers.json and run intake again'", /^BLOCKED: intake needs the owner's answers \| unblocks: answer the questions above in .*intake-answers\.json and run intake again$/.test(lastLine(c.so)), lastLine(c.so));
    check("C: the earlier 'BLOCKED: N answers missing' line (with the optional count) is still there for the main session", cl.some((l) => /^BLOCKED: \d+ answers missing/.test(l)) && cl.findIndex((l) => /^NEEDS-INPUT intake:/.test(l)) < cl.length - 1, c.so.slice(-400));
    // ---------------- K: every script step's BLOCKED path that is cheap to reach on a bare fixture ----------------
    const lib = await import(pathToFileURL(path.join(dir, "lib-pipeline.mjs")).href + "?" + Math.random());
    const man = lib.loadManifest(path.join(here, "..", "pipeline.json")).manifest;
    // steps that cannot show a BLOCKED path on a bare fixture, and why (printed, not asserted: a step that is changed to conform simply moves to the checked list)
    const UNREACHED = {
      doctor: "never BLOCKED: it reports which sources and keys are missing as information and looks up the latest Common Crawl release (a network call)",
      snapshot: "its only stops are a crawl failing (exit 1) or a 429 mid-crawl: reaching them needs a crawl",
      "demand-bing": "a missing NAMED input file (--seeds-file) is exit 2 by design: research-lib's listFile, and test-research asserts it; approve-seeds writes that file before this step can run",
      forums: "the same: a missing named --queries-file is exit 2 by design",
      "targets-validate": "its own contract is 0 pass, 1 fail, 2 cannot judge (a missing targets.json); research writes that file before this step can run",
      local: "exit 0 with every part (profile, pack, nap, reviews, grid) reported as BLOCKED inside local/<date>/summary.json: a suite of parts, not one step that blocks",
    };
    const kEnv = { VANTAGE_HOME: path.join(tmp, "vantage-home") };
    const noPipe = [];
    const PIPE_EXEMPT = ["authority-anchors"]; // WO 42's script: it ends 'BLOCKED: ...; unblocks: ...', theirs to change
    let kRan = 0;
    for (const st of man.steps.filter((x) => x.script && !(x.id in UNREACHED))) {
      const cwdK = path.join(tmp, "k-" + st.id), runDir = path.join(cwdK, "site-checks", "contract-test.test"), pewp = path.join(runDir, ".pewp");
      const vars = { url: SITE, client: "c", host: "contract-test.test", skill: path.join(here, ".."), runDir, pewp, work: path.join(cwdK, "work") };
      const args = lib.substitute(st.args, vars).map((a, i, arr) => (arr[i - 1] === "--cwd" ? cwdK : a));
      fs.mkdirSync(cwdK, { recursive: true });
      const r = await run(path.basename(st.script), args, { env: kEnv, timeout: 60000 });
      const ll = lastLine(r.out);
      kRan++;
      const full = /^BLOCKED: .+ \| unblocks: .+/.test(ll), exempt = PIPE_EXEMPT.includes(st.id);
      if (r.code === 3 && /^BLOCKED: /.test(ll) && !full) noPipe.push(st.id);
      check(`K: ${st.id}: on a bare fixture (no pewp files, no key, no network) it is BLOCKED: exit 3 and the last line is 'BLOCKED: <what> | unblocks: <what would>'${exempt ? " (only the 'BLOCKED: ' start is demanded of this one: WO 42's script)" : ""}`, r.code === 3 && (exempt ? /^BLOCKED: /.test(ll) : full), `exit ${r.code}; last line: ${ll.slice(0, 260)}`);
    }
    check(`K: ${kRan} script steps checked; not reached on a bare fixture (${Object.keys(UNREACHED).length}): ${Object.entries(UNREACHED).map(([k, v]) => `${k} (${v})`).join("; ")}`, kRan + Object.keys(UNREACHED).length === man.steps.filter((x) => x.script).length, `checked ${kRan} + unreached ${Object.keys(UNREACHED).length} is not the ${man.steps.filter((x) => x.script).length} script steps of the manifest`);
    check(`K: the BLOCKED last lines without the full form ' | unblocks: ' are only the exempt ones (${noPipe.join(", ") || "none"})`, noPipe.every((x) => PIPE_EXEMPT.includes(x)), `not exempt and not in the full form: ${noPipe.filter((x) => !PIPE_EXEMPT.includes(x)).join(", ")}`);
    const net = fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8").trim() : "";
    check("contracts: nothing in this suite left the machine (network guard log empty)", !net, net);
  } finally { rmTmp(tmp); }
  return results;
}

const LT = "live-target.mjs", LG = "local-grid.mjs";
const MUTANTS = [
  { name: "a reuse does not write the pointer", patches: [{ file: LT, from: "pointer(last.dir, last.finishedAt, true); ", to: "" }], expect: [/^A: a REUSE/] },
  { name: "a new snapshot does not write the pointer", patches: [{ file: LT, from: "pointer(dir, fin, false); ", to: "" }], expect: [/^A: a new snapshot writes/, /^A: --fresh takes a new snapshot/] },
  { name: "a reuse says reused false", patches: [{ file: LT, from: "pointer(last.dir, last.finishedAt, true);", to: "pointer(last.dir, last.finishedAt, false);" }], expect: [/^A: a REUSE/] },
  { name: "a failed crawl moves the pointer", patches: [{ file: LT, from: "else { console.log(`FAILED ${dir} exit ${r.status}", to: "else { pointer(dir, null, false); console.log(`FAILED ${dir} exit ${r.status}" }], expect: [/^A: a failed crawl/] },
  { name: "local-grid BLOCKED is exit 0", patches: [{ file: LG, from: "process.exitCode = 3; }", to: "}" }], expect: [/^B: plan with no service-area cities/, /^B: plan with no query templates/, /^B: plan with no city centres/, /^B: import with no grid captures/] },
  { name: "local-grid BLOCKED line in the old wording", patches: [{ file: LG, from: "| unblocks: ${r.blocked.unblock}`);", to: ". To fix: ${r.blocked.unblock}`);" }], expect: [/^B: plan with no service-area cities/, /^B: import with no grid captures/] },
  { name: "local-grid lists the cities after the BLOCKED line", patches: [{ file: LG, from: "for (const b of r.plan?.blocked || []) console.log(`BLOCKED city ${b.city}: ${b.reason}. To fix: ${b.unblock}`);\n  if (r.status === \"blocked\") { console.log(`BLOCKED: ${r.blocked.reason} | unblocks: ${r.blocked.unblock}`); process.exitCode = 3; }", to: "if (r.status === \"blocked\") { console.log(`BLOCKED: ${r.blocked.reason} | unblocks: ${r.blocked.unblock}`); process.exitCode = 3; }\n  for (const b of r.plan?.blocked || []) console.log(`BLOCKED city ${b.city}: ${b.reason}. To fix: ${b.unblock}`);" }], expect: [/^B: plan with no city centres/] },
  { name: "local-grid: a partial plan is exit 3", patches: [{ file: LG, from: "for (const b of r.plan?.blocked || []) console.log(`BLOCKED city", to: "for (const b of r.plan?.blocked || []) process.exitCode = 3;\n  for (const b of r.plan?.blocked || []) console.log(`BLOCKED city" }], expect: [/^B: a partial plan/] },
  { name: "report-live: a missing snapshot is exit 1 again", patches: [{ file: "report-live.mjs", from: "(the snapshot step of pipeline.json)`); process.exit(3); }", to: "(the snapshot step of pipeline.json)`); process.exit(1); }" }], expect: [/^K: report-live: on a bare fixture/] },
  { name: "psi: a missing key does not block", patches: [{ file: "psi.mjs", from: "if (!key) throw new Blocked(UNBLOCK);", to: "" }], expect: [/^K: psi: on a bare fixture/] },
  { name: "research-lib runCli: a Blocked step exits 1", patches: [{ file: "research-lib.mjs", from: "if (e instanceof Blocked) { console.log(`BLOCKED: ${e.unblock}`); process.exitCode = 3; return; }", to: "if (e instanceof Blocked) { console.log(`BLOCKED: ${e.unblock}`); process.exitCode = 1; return; }" }], expect: [/^K: seeds: on a bare fixture/, /^K: research-plan: on a bare fixture/, /^K: psi: on a bare fixture/] },
  { name: "intake: no BLOCKED last line", patches: [{ file: "intake.mjs", from: "console.log(`BLOCKED: intake needs the owner's answers | unblocks: answer the questions above in ${path.join(ctx.pewp, \"intake-answers.json\")} and run intake again`);", to: "" }], expect: [/^C: its LAST line is/] },
  { name: "intake: no NEEDS-INPUT line", patches: [{ file: "intake.mjs", from: "console.log(`NEEDS-INPUT intake: ${r.questions.filter((q) => !q.optional).length} question(s) for the owner", to: "void (`NEEDS-INPUT intake: ${r.questions.filter((q) => !q.optional).length} question(s) for the owner" }], expect: [/^C: intake without the owner's answers keeps/] },
  { name: "intake: exit 0 with questions open", patches: [{ file: "intake.mjs", from: "process.exit(3);\n});", to: "process.exit(0);\n});" }], expect: [/^C: intake without the owner's answers keeps/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-step-contracts.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "STEP CONTRACTS", scenarios, MUTANTS, scriptsDir, argv: A }));
}
