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
    // gap 2 (a skill run): the manifest's evidence paths are the paths local-grid.mjs really writes and reads (they were local-grid/requests.json, captures/local/pack/*.json, local-grid/*.json)
    {
      const lpB = await import(pathToFileURL(path.join(dir, "lib-pipeline.mjs")).href + "?" + Math.random());
      const manB = lpB.loadManifest(path.join(here, "..", "pipeline.json")).manifest, stepB = (id) => manB.steps.find((s) => s.id === id);
      const varsB = { url: SITE, client: null, host: "contract-test.test", skill: path.join(here, ".."), runDir: cwdB, pewp: pewpB, work: path.join(cwdB, "work") };
      const evB = (id) => { try { return lpB.evidenceState(stepB(id), varsB, { since: 0 }); } catch (e) { return { state: "threw", problems: [e.message] }; } };
      check("B: after a plan, local-grid-plan's manifest evidence is done: it names captures/local/grid/requests.json, the file the plan wrote", evB("local-grid-plan").state === "done", JSON.stringify(evB("local-grid-plan")));
      const reqB = fs.existsSync(path.join(gdir, "requests.json")) ? J(path.join(gdir, "requests.json")) : { requests: [] }, rq = (reqB.requests || [])[0] || { id: "no-request" };
      check("B: capture-maps' evidence is NOT satisfied by the plan's own files (requests.json, plan.json, cities.json sit in the same folder): before any capture it is missing", evB("capture-maps").state === "missing", JSON.stringify(evB("capture-maps")));
      W(path.join(gdir, `${rq.id}.json`), { id: rq.id });
      check("B: a capture named after its request id (<city>__<query>__<point>.json, what local-grid.mjs reads from that folder) is capture-maps' evidence", rq.id.includes("__") && evB("capture-maps").state === "done", JSON.stringify([rq.id, evB("capture-maps")]));
      fs.rmSync(path.join(gdir, `${rq.id}.json`), { force: true }); // the import checks below expect no captures yet
      W(path.join(pewpB, "local", "2026-11-10", "grid.json"), { ok: 1 });
      check("B: local-grid-import's evidence is the dated grid the import writes (local/<date>/grid.json)", evB("local-grid-import").state === "done", JSON.stringify(evB("local-grid-import")));
      fs.rmSync(path.join(pewpB, "local"), { recursive: true, force: true });
    }
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
    const SKIPPED = { vantage: "SKIPPED: no allowed US egress" }; // a step that cannot verify what it checks does not BLOCK the run: exit 4 and this last line (P3.4 R1)
    let kRan = 0;
    for (const st of man.steps.filter((x) => x.script && !(x.id in UNREACHED))) {
      const cwdK = path.join(tmp, "k-" + st.id), runDir = path.join(cwdK, "site-checks", "contract-test.test"), pewp = path.join(runDir, ".pewp");
      const vars = { url: SITE, client: "c", host: "contract-test.test", skill: path.join(here, ".."), runDir, pewp, work: path.join(runDir, "work") };
      const args = lib.substitute(st.args, vars).map((a, i, arr) => (arr[i - 1] === "--cwd" ? cwdK : a));
      fs.mkdirSync(cwdK, { recursive: true });
      const r = await run(path.basename(st.script), args, { env: kEnv, timeout: 60000 });
      const ll = lastLine(r.out);
      kRan++;
      const full = /^BLOCKED: .+ \| unblocks: .+/.test(ll), exempt = PIPE_EXEMPT.includes(st.id), skip = SKIPPED[st.id];
      if (r.code === 3 && /^BLOCKED: /.test(ll) && !full) noPipe.push(st.id);
      check(`K: ${st.id}: on a bare fixture (no pewp files, no key, no network) it is ${skip ? `SKIPPED: exit 4 and the last line is '${skip}'` : "BLOCKED: exit 3 and the last line is 'BLOCKED: <what> | unblocks: <what would>'"}${exempt ? " (only the 'BLOCKED: ' start is demanded of this one: WO 42's script)" : ""}`, skip ? r.code === 4 && ll === skip : r.code === 3 && (exempt ? /^BLOCKED: /.test(ll) : full), `exit ${r.code}; last line: ${ll.slice(0, 260)}`);
    }
    check(`K: ${kRan} script steps checked; not reached on a bare fixture (${Object.keys(UNREACHED).length}): ${Object.entries(UNREACHED).map(([k, v]) => `${k} (${v})`).join("; ")}`, kRan + Object.keys(UNREACHED).length === man.steps.filter((x) => x.script).length, `checked ${kRan} + unreached ${Object.keys(UNREACHED).length} is not the ${man.steps.filter((x) => x.script).length} script steps of the manifest`);
    check(`K: the BLOCKED last lines without the full form ' | unblocks: ' are only the exempt ones (${noPipe.join(", ") || "none"})`, noPipe.every((x) => PIPE_EXEMPT.includes(x)), `not exempt and not in the full form: ${noPipe.filter((x) => !PIPE_EXEMPT.includes(x)).join(", ")}`);
    // ---------------- T: every script step that CAN run on fixtures, run with its manifest args: exit 0 and its evidence done (P3.4 R2, T1b) ----------------
    // The K group above shows what each step does when it cannot go on; this one shows that the manifest's own command line, on inputs the step's predecessors leave, does the work and leaves exactly the
    // evidence the manifest names. Fixtures are copied from test-importers.mjs (the six capture importers), the B group above (the local grid) and test-research.mjs (seeds, autocomplete captures).
    {
      const TH = "sample-valley-realty.test", TURL = `https://${TH}/`, TSKILL = path.join(here, "..");
      const ago = (d) => new Date(Date.now() - d * 86400000).toISOString(), day = (d) => ago(d).slice(0, 10), cap = { capturedAt: ago(1), browser: "owner's Edge" };
      // the skill's own fixture business (a definition targets-validate accepts), with no named competitor (an audit would make a network call) and two service-area cities
      const BIZ = { ...J(path.join(TSKILL, "fixtures", "pewp", "business.json")), competitors: [], vocabulary: ["realtor"], locations: [{ name: "Tracy office", address: null, serviceArea: ["Tracy, CA", "Elk Grove, CA"] }], existing: { site: null, searchConsole: false, businessProfile: null, socials: [] }, rankTracking: { source: "search-console", locations: ["Tracy, CA"], devices: ["mobile"] } };
      const stepT = (id) => man.steps.find((s) => s.id === id);
      const worldT = (name, files = {}) => {
        const cwd = path.join(tmp, "t-" + name), runDir = path.join(cwd, "site-checks", TH), pewp = path.join(runDir, ".pewp");
        W(path.join(pewp, "business.json"), BIZ);
        for (const [rel, body] of Object.entries(files)) W(path.join(pewp, rel), body);
        return { cwd, runDir, pewp, vars: { url: TURL, client: "c", host: TH, skill: TSKILL, runDir, pewp, work: path.join(runDir, "work") } };
      };
      const stepRun = async (id, w) => {
        const st = stepT(id), args = lib.substitute(st.args, w.vars).map((a, i, arr) => (arr[i - 1] === "--cwd" ? w.cwd : a));
        const start = Date.now(), r = await run(path.basename(st.script), args, { timeout: 120000 });
        return { r, ev: lib.evidenceState(st, w.vars, { since: start }) };
      };
      const importFiles = (dirName, files) => Object.fromEntries(Object.entries(files).map(([f, body]) => [`captures/${dirName}/${f}`, body]));
      const IMPORTERS = [
        ["index-import", "index", { "google.json": { ...cap, engine: "google", query: `site:${TH}`, resultCountText: "About 1,230 results", listedUrls: [TURL, `${TURL}a`, `${TURL}b`], serviceChecks: [{ service: "Hard Money Loans", listed: true, url: `${TURL}a` }, { service: "bridge loans", listed: false }] }, "bing.json": { ...cap, engine: "bing", query: `site:${TH}`, resultCount: 12, listedUrls: [TURL], serviceChecks: [{ service: "bridge loans", listed: true }] } }],
        ["trends-import", "trends", { "hard-money.json": { ...cap, service: "Hard money loans", period: "past 12 months", geo: "US", address: "https://trends.google.com/trends/explore?q=hard%20money", regions: [{ name: "California", value: 87 }, { name: "Texas", value: 100 }, { name: "Florida", value: 61 }], metros: [{ name: "Sacramento CA", value: 100 }, { name: "Fresno CA", value: 55 }], client: { state: "California", metro: "Sacramento CA" } } }],
        ["ai-import", "ai", { "chatgpt-1.json": { ...cap, engine: "chatgpt", type: "buyer", question: "who lends on rentals in Sacramento", answerText: "Sample Valley Realty and Kiavi both lend on rentals.", named: true, competitorsNamed: ["Kiavi"], citedSources: ["https://www.kiavi.com/a"] }, "perplexity-1.json": { ...cap, engine: "perplexity", type: "buyer", question: "best hard money lender Sacramento", answerText: "Lima One and Kiavi lead the list.", named: false, competitorsNamed: ["Kiavi", "Lima One"], citedSources: ["https://www.kiavi.com/b"] } }],
        ["reputation-import", "reputation", { "client-google.json": { ...cap, subject: "client", site: "google", listed: true, rating: 4.8, reviewCount: 100, newestReviewDate: day(20), complaintCount: null }, "client-yelp.json": { ...cap, subject: "client", site: "yelp", listed: false } }],
        ["social-import", "social", { "youtube.json": { ...cap, platform: "youtube", kind: "channel", handle: "@svr", profileUrl: "https://www.youtube.com/@svr", followers: "1.2K", posts: 58, postsIncludeShorts: true, newestPostDate: day(10), linkTarget: TURL, linkStatus: 200 }, "linkedin.json": { ...cap, platform: "linkedin", kind: "company", profileUrl: "https://www.linkedin.com/company/svr", blocked: "login wall" } }],
        ["ads-import", "ads", { "client-meta.json": { ...cap, advertiser: "client", library: "meta-ad-library", region: "US", running: true, adCount: 3, since: day(40), formats: ["Image", "video"] }, "kiavi-google.json": { ...cap, advertiser: "Kiavi.com", library: "google-transparency", region: "US", running: true, adCount: 25 } }],
      ];
      const tcheck = (id, got, extra = "") => check(`T: ${id}: run with its manifest args on a fixture, it exits 0 and its evidence is done${extra}`, got.r.code === 0 && got.ev.state === "done", `exit ${got.r.code}; evidence ${got.ev.state}: ${got.ev.problems.join("; ")}; ${got.r.out.slice(-400)}`);
      for (const [id, dirName, files] of IMPORTERS) tcheck(id, await stepRun(id, worldT(id, importFiles(dirName, files))));
      const acFiles = importFiles("autocomplete", { "a1.google.json": { seed: "Realtor in Tracy", engine: "google", capturedAt: "2026-10-21T10:00:00Z", browser: "owner's Edge", language: "en", location: { requested: "Tracy, CA", footer: "Tracy, California" }, suggestions: ["realtor in tracy ca", "realtor in tracy california reviews", "realtor in {city}"] } });
      tcheck("autocomplete-import", await stepRun("autocomplete-import", worldT("autocomplete", acFiles)), " (the autocomplete captures of test-research.mjs)");
      // the local grid (the B group above): the plan writes requests.json from the cities, their sourced centres and the query templates of config.json; the import reads a capture made for a point
      const gridFiles = { "captures/local/grid/cities.json": [{ city: "Tracy, CA", lat: 37.7397, lng: -121.4252, source: "https://en.wikipedia.org/wiki/Tracy,_California", readAt: "2026-11-10" }, { city: "Elk Grove, CA", lat: 38.4088, lng: -121.3716, source: "https://en.wikipedia.org/wiki/Elk_Grove,_California", readAt: "2026-11-10" }], "captures/local/grid/config.json": { n: 3, spacingKm: 3, queryTemplates: ["realtor in {city}"], maxCaptures: 200 }, "approved/business.json": BIZ };
      const gw = worldT("grid", gridFiles);
      tcheck("local-grid-plan", await stepRun("local-grid-plan", gw));
      const requested = J(path.join(gw.pewp, "captures", "local", "grid", "requests.json")).requests[0];
      W(path.join(gw.pewp, "captures", "local", "grid", `${requested.id}.json`), { id: requested.id, query: requested.query, city: requested.city, location: requested.location, locationShown: "Tracy, California", device: "mobile", language: "en", point: requested.point, capturedAt: ago(1), capturedIn: "owner's Edge", pack: [{ position: 1, name: "Sample Valley Realty", rating: 4.9, reviews: 20 }, { position: 2, name: "Rival Realty", rating: 4.5, reviews: 10 }] });
      tcheck("local-grid-import", await stepRun("local-grid-import", gw));
      // research: business.json, the seeds the owner approved and the autocomplete captures (no key, no network: the autocomplete suggestions are the demand signal)
      const seedQueries = [{ query: "realtor in tracy ca", source: "fixture", from: "definition vocabulary", location: "Tracy, CA" }, { query: "realtor", source: "fixture", from: "definition vocabulary", location: null }];
      const researchFiles = { ...acFiles, "research/seeds.json": { step: "seeds", status: "ok", generatedAt: ago(1), market: BIZ.market, queries: seedQueries }, "approved/seeds.json": { queries: seedQueries } };
      const rw = worldT("research", researchFiles);
      tcheck("research-plan", await stepRun("research-plan", rw));
      const rr = await stepRun("research", rw);
      check("T-R: the real research.mjs on a fixture (business.json, approved seeds, autocomplete captures), no BING_WEBMASTER_KEY: exit 0 and targets.json written", rr.r.code === 0 && fs.existsSync(path.join(rw.pewp, "targets.json")) && J(path.join(rw.pewp, "targets.json")).clusters.length > 0, `exit ${rr.r.code}; ${rr.r.out.slice(-500)}`);
      tcheck("research", rr);
      tcheck("targets-validate", await stepRun("targets-validate", rw));
      // the other script steps are NOT run here, one reason each; the K group above shows their BLOCKED path where one is cheap to reach
      const NOT_RUN_HERE = {
        doctor: "a network call (the latest Common Crawl release)", vantage: "a browser and the machine's egress (exit 4 when it cannot verify)", snapshot: "a crawl of the live site",
        psi: "a key (PSI_API_KEY) and the PageSpeed API", crux: "a key (CRUX_API_KEY) and the CrUX API", intake: "the owner's answers (NEEDS-INPUT)", "city-centres": "a read of a public map (a network host)",
        seeds: "the owner's vocabulary from intake, proposed for approval", "demand-bing": "a key (BING_WEBMASTER_KEY) and the Bing Webmaster API", "search-console": "a Search Console credential and its API",
        competitors: "a crawl of the competitors' sites", authority: "the Common Crawl link graph (a download of several GB)", "authority-anchors": "Common Crawl index reads (a network host, a 24 h stop file)",
        "authority-classify": "the link opportunities that authority leaves (a crawl of the opportunity sites)", "authority-vet": "a visit to each opportunity site", local: "the local profile, pack, citations and reviews (captures, a browser)",
        forums: "the Reddit API and its token", "report-live": "every earlier step's output (a whole run)",
      };
      const scriptSteps = man.steps.filter((s) => s.script).map((s) => s.id), tested = [...IMPORTERS.map((x) => x[0]), "autocomplete-import", "local-grid-plan", "local-grid-import", "research-plan", "research", "targets-validate"];
      check(`T: the other ${Object.keys(NOT_RUN_HERE).length} script steps are named with one reason each (${Object.keys(NOT_RUN_HERE).join(", ")}); ${tested.length} + ${Object.keys(NOT_RUN_HERE).length} are the manifest's ${scriptSteps.length} script steps, none twice, none left out`, tested.length + Object.keys(NOT_RUN_HERE).length === scriptSteps.length && [...tested, ...Object.keys(NOT_RUN_HERE)].every((id) => scriptSteps.includes(id)) && new Set([...tested, ...Object.keys(NOT_RUN_HERE)]).size === scriptSteps.length, `script steps ${scriptSteps.join(", ")}; tested ${tested.join(", ")}`);
    }
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
