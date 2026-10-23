// Usage: node test-iterate.mjs [--verbose] [--no-mutants]
// Self-test of approve.mjs (targets / plan approval with a sha256 lock), iterate.mjs (proposals from the last two measure runs under the
// 06 9.8 significance rules) and the gate's preference for approved files. Fixtures only: the two-date measure pair of fixtures/measure,
// the fixture pewp and site; extra measure files (gsc.json, crux.json, diff.json) are built here in temp folders. No network, nothing under
// any project folder is touched. Groups: A approve · I iterate · G gate on approved files · M watched-fail mutants. Exit 0 = all pass.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = process.env.PEWP_FIX ? path.resolve(process.env.PEWP_FIX) : path.resolve(HERE, "..", "fixtures");
const VERBOSE = process.argv.includes("--verbose");
const { PLAN_FLAGS } = await import(pathToFileURL(path.join(FIX, "build-fixtures.mjs")).href);
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const tree = (d, base = d, out = []) => { if (!fs.existsSync(d)) return out; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) tree(p, base, out); else out.push(path.relative(base, p).split(path.sep).join("/") + ":" + sha(p)); } return out.sort(); };

async function suite(scriptsDir) {
  const R = [];
  const check = (name, ok, detail = "") => R.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 800) });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-it-"));
  let seq = 0;
  const fresh = (l = "d") => path.join(tmp, `${l}${seq++}`);
  const cp = (a, b) => fs.cpSync(a, b, { recursive: true });
  const run = (script, a) => spawnSync(process.execPath, [path.join(scriptsDir, script), ...a], { encoding: "utf8", timeout: 120000 });
  const W = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof o === "string" ? o : JSON.stringify(o, null, 1)); };
  try {
    // ---- a planned base repo (working files only), reused by every scenario ----
    const base = fresh("base");
    cp(path.join(FIX, "pewp"), base);
    const planned = run("plan-site.mjs", [base, ...PLAN_FLAGS]);
    if (planned.status !== 0) throw new Error("plan-site failed: " + planned.stdout + planned.stderr);
    const newPewp = () => { const d = fresh("p"); cp(base, d); return d; };
    const approveT = (pw, extra = []) => run("approve.mjs", ["--pewp", pw, "targets", "--by", "Test Owner", ...extra]);
    const approveP = (pw, extra = []) => run("approve.mjs", ["--pewp", pw, "plan", "--by", "Test Owner", ...extra]);
    const approvedPewp = () => { const pw = newPewp(); const a = approveT(pw), b = approveP(pw); if (a.status !== 0 || b.status !== 0) throw new Error("approve failed: " + a.stdout + b.stdout); return pw; };
    const approvedBase = approvedPewp();
    const copyApproved = () => { const d = fresh("ap"); cp(approvedBase, d); return d; };
    const T0 = J(path.join(base, "targets.json"));
    const lockOf = (pw) => J(path.join(pw, "approved", "lock.json"));

    // ======================= A: approve =======================
    {
      const pw = newPewp();
      let r = run("approve.mjs", ["--pewp", pw, "targets"]);
      check("A: approve targets without --by shows the diff and signs nothing (exit 3)", r.status === 3 && /First approval of the targets \(6 clusters\)/.test(r.stdout) && /NOT SIGNED/.test(r.stdout) && !fs.existsSync(path.join(pw, "approved")), r.stdout + r.stderr);
      r = approveT(pw);
      const lk = fs.existsSync(path.join(pw, "approved", "lock.json")) ? lockOf(pw) : null;
      check("A: approve targets --by writes approved/targets.json + lock (sha256, research run, approvedAt, approvedBy)", r.status === 0 && lk && lk.targets.approvedBy === "Test Owner" && /^\d{4}-\d{2}-\d{2}T/.test(lk.targets.approvedAt) && lk.targets.files["targets.json"] === sha(path.join(pw, "approved", "targets.json")) && lk.targets.files["targets.json"] === sha(path.join(pw, "targets.json")) && /createdAt 2026-10-20/.test(lk.targets.researchRun), r.stdout + JSON.stringify(lk));
      r = run("approve.mjs", ["--pewp", pw, "targets", "--by", "X", "--run", "RUN-7"]);
      check("A: re-approving identical targets says no change and writes nothing", r.status === 0 && /no change, already approved/.test(r.stdout) && !fs.existsSync(path.join(pw, "approved", "history")), r.stdout);
      const pw2 = newPewp(); r = approveP(pw2);
      check("A: approve plan before targets is refused (exit 1)", r.status === 1 && /approve the targets first/.test(r.stdout) && !fs.existsSync(path.join(pw2, "approved")), r.stdout);
      approveT(pw2); r = run("approve.mjs", ["--pewp", pw2, "plan"]);
      check("A: approve plan without --by shows the first-approval summary, signs nothing (exit 3)", r.status === 3 && /First approval of the plan \(6 pages/.test(r.stdout) && !fs.existsSync(path.join(pw2, "approved", "plan")), r.stdout);
      r = approveP(pw2);
      const l2 = lockOf(pw2);
      check("A: approve plan --by copies the plan, lists every file with its sha256 and the targets sha it was approved against", r.status === 0 && l2.plan.targetsSha256 === l2.targets.files["targets.json"] && l2.plan.files["plan/sitemap.json"] === sha(path.join(pw2, "approved/plan/sitemap.json")) && Object.keys(l2.plan.files).some((f) => f.startsWith("plan/briefs/")) && l2.plan.approvedBy === "Test Owner", r.stdout);
      check("A: the builder's programmatic-data.json is not part of the approved plan", !fs.existsSync(path.join(pw2, "approved/plan/programmatic-data.json")) && !("plan/programmatic-data.json" in l2.plan.files));
      r = run("approve.mjs", ["--pewp", pw2, "--check"]);
      check("A: --check passes on untouched approved files (exit 0)", r.status === 0 && /^PASS approve-lock/.test(r.stdout), r.stdout);
      r = run("approve.mjs", ["--pewp", fresh("none"), "--check"]);
      check("A: --check with nothing approved is cannot-judge (exit 2)", r.status === 2 && /^ERROR/.test(r.stdout), r.stdout);
      // tampering
      const tamper = (name, edit, re) => { const d = copyApproved(); edit(d); const x = run("approve.mjs", ["--pewp", d, "--check"]); check(`A: lock check FAILS when ${name}`, x.status === 1 && /^FAIL approve-lock/.test(x.stdout) && re.test(x.stdout), x.stdout); };
      tamper("approved targets.json is edited after approval", (d) => fs.appendFileSync(path.join(d, "approved/targets.json"), " "), /targets\.json: changed after approval/);
      tamper("an approved brief is edited", (d) => fs.appendFileSync(path.join(d, "approved/plan/briefs/rocklin-ca.md"), "\n- sneaky edit"), /plan\/briefs\/rocklin-ca\.md: changed after approval/);
      tamper("an approved plan file is deleted", (d) => fs.rmSync(path.join(d, "approved/plan/offsite.json")), /plan\/offsite\.json: approved file is missing/);
      tamper("a file is added to the approved plan", (d) => fs.writeFileSync(path.join(d, "approved/plan/extra.json"), "{}"), /plan\/extra\.json: file added after approval/);
      tamper("the lock itself is deleted", (d) => fs.rmSync(path.join(d, "approved/lock.json")), /no lock\.json/);
      tamper("the lock is edited to hide a change", (d) => { const l = lockOf(d); l.targets.files["targets.json"] = "0".repeat(64); fs.writeFileSync(path.join(d, "approved/lock.json"), JSON.stringify(l)); }, /targets\.json: changed after approval/);
      // diff against the approved copy
      const d = copyApproved();
      const t = J(path.join(d, "targets.json")); t.clusters[1].priority = 8; t.clusters.splice(2, 1); const nc = structuredClone(T0.clusters[1]); nc.id = "c-new-thing"; nc.primaryQuery = "new thing roseville ca"; nc.queries = [nc.primaryQuery]; nc.targetPage = "new"; t.clusters.push(nc); W(path.join(d, "targets.json"), t);
      r = run("approve.mjs", ["--pewp", d, "targets"]);
      check("A: the diff names changed fields, added and removed clusters (exit 3 without --by, approved copy untouched)", r.status === 3 && /~ c-agent-rocklin\.priority: 7 -> 8/.test(r.stdout) && /\+ cluster c-new-thing: "new thing roseville ca"/.test(r.stdout) && /- cluster c-agent-lincoln/.test(r.stdout) && sha(path.join(d, "approved/targets.json")) === sha(path.join(approvedBase, "approved/targets.json")), r.stdout);
      r = approveT(d);
      const hist = fs.existsSync(path.join(d, "approved/history")) ? fs.readdirSync(path.join(d, "approved/history")) : [];
      check("A: re-approval archives the replaced copy under approved/history and updates the lock", r.status === 0 && hist.length === 1 && fs.existsSync(path.join(d, "approved/history", hist[0], "targets.json")) && lockOf(d).targets.files["targets.json"] === sha(path.join(d, "approved/targets.json")), r.stdout);
      r = run("approve.mjs", ["--pewp", d, "--check"]);
      check("A: after re-approving the targets the old plan is reported STALE and the lock check fails (exit 1)", r.status === 1 && /STALE plan was approved for targets/.test(r.stdout), r.stdout);
      // plan diff
      const d2 = copyApproved();
      const sm = J(path.join(d2, "plan/sitemap.json")); const gone = sm.links.shift(); W(path.join(d2, "plan/sitemap.json"), sm);
      r = run("approve.mjs", ["--pewp", d2, "plan"]);
      check("A: the plan diff names changed files and removed links", r.status === 3 && /~ plan\/sitemap\.json changed/.test(r.stdout) && new RegExp(`link removed: ${gone.from.replace(/\//g, "\\/")} > ${gone.to.replace(/\//g, "\\/")}`).test(r.stdout), r.stdout);
      // refusals
      const bad = newPewp(); const bt = J(path.join(bad, "targets.json")); bt.clusters[1].primaryQuery = bt.clusters[0].primaryQuery; W(path.join(bad, "targets.json"), bt);
      r = approveT(bad);
      check("A: invalid targets are refused, nothing is written (exit 1, rule printed)", r.status === 1 && /T-003/.test(r.stdout) && !fs.existsSync(path.join(bad, "approved")), r.stdout);
      const d3 = copyApproved(); const s3 = J(path.join(d3, "plan/sitemap.json")); s3.pages = s3.pages.filter((p) => p.cluster !== "c-home-value"); W(path.join(d3, "plan/sitemap.json"), s3);
      r = approveP(d3);
      check("A: a plan with a cluster that has no page is refused (exit 1)", r.status === 1 && /c-home-value must have exactly one page/.test(r.stdout), r.stdout);
      const d4 = copyApproved(); const s4 = J(path.join(d4, "plan/sitemap.json")); s4.pages[1].cluster = "c-nope"; W(path.join(d4, "plan/sitemap.json"), s4);
      r = approveP(d4);
      check("A: a plan naming a cluster that is not in the approved targets is refused (exit 1)", r.status === 1 && /c-nope, which is not in the approved targets/.test(r.stdout), r.stdout);
      const d5 = copyApproved(); fs.appendFileSync(path.join(d5, "approved/targets.json"), " ");
      r = approveT(d5);
      check("A: nothing new is approved on top of tampered approved files (exit 1)", r.status === 1 && /changed after approval/.test(r.stdout), r.stdout);
      const ap = await import(pathToFileURL(path.join(scriptsDir, "approve.mjs")).href);
      check("A: resolveInputs / approvedTargetsPath point at the approved copy when it exists, else the working file", ap.approvedTargetsPath(approvedBase) === path.join(approvedBase, "approved", "targets.json") && ap.approvedTargetsPath(newPewp()).endsWith(path.join(".", "targets.json").slice(1)) && !ap.approvedTargetsPath(newPewp()).includes("approved"));
    }

    // ======================= I: iterate =======================
    const MA = path.join(FIX, "measure", "2026-09-22"), MB = path.join(FIX, "measure", "2026-10-22");
    const rowsOf = (dir) => structuredClone(J(path.join(dir, "rankings.json")).rankings), citOf = (dir) => structuredClone(J(path.join(dir, "citations.json")).citations);
    const writeRun = (pw, date, rankings, citations, extra = {}) => { const dir = path.join(pw, "measure", date); W(path.join(dir, "rankings.json"), { date, status: "ok", rankings }); W(path.join(dir, "citations.json"), { date, status: "ok", citations }); for (const [f, o] of Object.entries(extra)) W(path.join(dir, f), o); };
    const row = (rows, q, loc) => rows.find((r) => r.query === q && (!loc || r.location === loc));
    const setPos = (rows, q, v, imp) => { const r = row(rows, q, "Roseville, CA"); r.position.value = v; if (v == null) r.url = null; else r.url = r.url || "https://sample-valley-realty.test/"; if (imp != null) r.impressions = imp; return r; };
    const gscQ = (rows) => ({ status: "ok", fetchedAt: "2026-10-22T06:00:00Z", tables: { current: { query: rows.map(([q, impressions, clicks, position]) => ({ keys: [q], impressions, clicks, ctr: clicks / impressions, position })) } } });
    const QS = [["sell home roseville fast", 120, 6, 8.2], ["real estate agent roseville ca near me", 300, 20, 6.1], ["best open houses weekend", 30, 1, 20], ["sample valley realty reviews", 90, 9, 1.3], ["how to stage a home in placer county", 75, 3, 12.1]];
    const it = (pw, extra = []) => run("iterate.mjs", ["--pewp", pw, "--today", "2026-10-23", ...extra]);
    const rep = (pw) => J(path.join(pw, "iterate", "report.json"));
    const prop = (pw) => (fs.existsSync(path.join(pw, "proposals", "targets.json")) ? J(path.join(pw, "proposals", "targets.json")) : { clusters: [], iteration: {} });
    const newOnes = (pw) => prop(pw).clusters.filter((c) => !T0.clusters.some((t) => t.id === c.id));
    const ids = (pw) => rep(pw).underperforming.map((u) => u.cluster).sort();
    const kinds = (pw, id) => (rep(pw).underperforming.find((u) => u.cluster === id)?.reasons || []).map((r) => r.kind).sort();
    const scenario = ({ prevRows, curRows, prevCit, curCit, prevExtra, curExtra, prevDate = "2026-10-12", curDate = "2026-10-20", args = [] }) => { const pw = copyApproved(); writeRun(pw, prevDate, prevRows, prevCit, prevExtra); writeRun(pw, curDate, curRows, curCit, curExtra); const r = it(pw, args); if (r.status !== 0) check("I: scenario ran (exit 0)", false, r.stdout + r.stderr); return { pw, r }; };
    const qs = { agentRos: "real estate agent roseville ca", rocklin: "real estate agent rocklin ca", lincoln: "real estate agent lincoln ca", cost: "how much does a realtor cost in california", home: "home value roseville ca" };

    // improvement pair: the fixtures as they are (everything got better) + Search Console demand
    {
      const pw = copyApproved(); const before = tree(path.join(pw, "approved"));
      writeRun(pw, "2026-09-22", rowsOf(MA), citOf(MA)); writeRun(pw, "2026-10-22", rowsOf(MB), citOf(MB), { "gsc.json": gscQ(QS) });
      const r = it(pw);
      check("I: iterate on the fixture pair runs (exit 0, PASS line, approved/ unchanged)", r.status === 0 && /^PASS iterate 0 underperforming cluster\(s\), 2 new cluster\(s\)/.test(r.stdout) && /approved\/ unchanged/.test(r.stdout), r.stdout + r.stderr);
      check("I: approved/ is byte-identical after iterate and the lock still passes", JSON.stringify(tree(path.join(pw, "approved"))) === JSON.stringify(before) && run("approve.mjs", ["--pewp", pw, "--check"]).status === 0);
      check("I: improvements (14 -> 9, 22 -> 17, entered at 38, 31 -> 25) are not raised as underperformance", rep(pw).underperforming.length === 0);
      const nc = prop(pw).clusters.filter((c) => !T0.clusters.some((t) => t.id === c.id));
      check("I: new clusters only from queries with >= 50 impressions that no cluster covers (not the 30, not the planned one, not the brand search)", nc.map((c) => c.primaryQuery).sort().join("|") === "how to stage a home in placer county|sell home roseville fast" && rep(pw).skippedQueries.belowImpressions === 1 && rep(pw).skippedQueries.alreadyPlanned === 1 && rep(pw).skippedQueries.branded === 1, JSON.stringify(rep(pw).skippedQueries) + nc.map((c) => c.primaryQuery));
      const local = nc.find((c) => c.primaryQuery === "sell home roseville fast"), guide = nc.find((c) => c.primaryQuery === "how to stage a home in placer county");
      check("I: a new cluster is a sourced proposal: stable id, targetPage new, impressions as an estimate with source and date, intent and place from the wording", local.id === "c-sell-home-roseville-fast" && local.targetPage === "new" && local.volume.value === 120 && local.volume.estimate === true && /not a search volume/.test(local.volume.source) && /^2026-10-22/.test(local.volume.fetchedAt) && local.intent === "local" && local.location === "Roseville, CA" && guide.intent === "informational" && guide.location === null && local.difficulty === null);
      check("I: the proposal validates as targets.json and keeps the approved clusters' ids", (await import(pathToFileURL(path.join(scriptsDir, "targets-validate.mjs")).href)).validate(prop(pw)).ok && T0.clusters.every((c) => prop(pw).clusters.some((p) => p.id === c.id)));
      check("I: the proposal records where it came from (parent sha, measure runs, research run, rule)", prop(pw).iteration.parentSha256 === sha(path.join(pw, "approved/targets.json")) && prop(pw).iteration.measureRuns.join() === "2026-09-22,2026-10-22" && /createdAt 2026-10-20/.test(prop(pw).iteration.researchRun) && prop(pw).iteration.basedOn === "approved/targets.json");
      const dl = J(path.join(pw, "proposals/plan/deltas.json"));
      check("I: deltas.json lists new pages (informational under /guides/), no page changes, and the noise it ignored", dl.newPages.length === 2 && dl.newPages.some((p) => p.path === "/guides/how-to-stage-a-home-in-placer-county/") && dl.newPages.some((p) => p.path === "/sell-home-roseville-fast/") && dl.pageChanges.length === 0 && dl.ignoredAsNoise.notComparable === 2, JSON.stringify(dl.newPages) + JSON.stringify(dl.ignoredAsNoise));
      check("I: briefs-delta holds one file per new page, marked NEW PAGE, with the impressions", fs.existsSync(path.join(pw, "proposals/plan/briefs-delta/guides-how-to-stage-a-home-in-placer-county.md")) && /NEW PAGE.*75 impressions/s.test(fs.readFileSync(path.join(pw, "proposals/plan/briefs-delta/guides-how-to-stage-a-home-in-placer-county.md"), "utf8")));
      const md = fs.readFileSync(path.join(pw, "iterate/report.md"), "utf8");
      check("I: report.md leads with the one-line answer and says nothing in approved/ changed", /^# Iterate 2026-10-23: 0 clusters underperform, 2 new clusters proposed, 2 actions ranked; nothing in approved\/ changed/.test(md), md.slice(0, 200));
      check("I: report.md explains the significance rule in words and each term once, and says how to approve", /not to be chance \(06 9\.8\)/.test(md) && (md.match(/^- impressions:/gm) || []).length === 1 && (md.match(/^- cluster:/gm) || []).length === 1 && /approve\.mjs <target> targets --from proposals/.test(md));
      check("I: gains are listed but not acted on", /## Gains \(not acted on\)/.test(md) && /moved up 5 places/.test(md));
      const r2 = it(pw);
      check("I: deterministic (a second run writes byte-identical proposals and report)", r2.status === 0 && tree(path.join(pw, "proposals")).join() === tree(path.join(pw, "proposals")).join() && (() => { const a = tree(path.join(pw, "proposals")).concat(tree(path.join(pw, "iterate"))); it(pw); return JSON.stringify(a) === JSON.stringify(tree(path.join(pw, "proposals")).concat(tree(path.join(pw, "iterate")))); })());
      // approving the proposals closes the loop: the queries are now planned
      const ap = run("approve.mjs", ["--pewp", pw, "targets", "--from", "proposals", "--by", "Test Owner"]);
      check("I: approve targets --from proposals signs them, replaces the working targets.json and archives the old copy", ap.status === 0 && /\+ cluster c-sell-home-roseville-fast/.test(ap.stdout) && sha(path.join(pw, "targets.json")) === sha(path.join(pw, "approved/targets.json")) && sha(path.join(pw, "approved/targets.json")) === sha(path.join(pw, "proposals/targets.json")) && fs.existsSync(path.join(pw, "approved/history")), ap.stdout);
      const r3 = it(pw);
      check("I: after approval the same demand is no longer proposed (idempotent loop)", r3.status === 0 && rep(pw).newClusters.length === 0 && rep(pw).skippedQueries.alreadyPlanned === 3, r3.stdout + JSON.stringify(rep(pw).skippedQueries));
      const ap2 = run("approve.mjs", ["--pewp", pw, "plan", "--from", "proposals", "--by", "Test Owner"]);
      check("I: proposals/plan holds deltas only, so approving it as the plan is refused with the way forward (exit 2)", ap2.status === 2 && /deltas only/.test(ap2.stdout), ap2.stdout);
    }

    // decline scenario: the improvement pair played backwards
    {
      const cur = rowsOf(MA), prev = rowsOf(MB);
      const pc = citOf(MB), cc = citOf(MA);
      pc[0].question = "Is 3% a normal real estate commission?"; cc[0].question = "Is 3% a normal real estate commission?"; // cost cluster
      pc[0].citedShare.value = 1; pc[0].runs = 3; cc[0].citedShare.value = 0; cc[0].runs = 3; cc[0].ourDomainCited = false; pc[0].ourDomainCited = true; pc[0].citedSources = ["sample-valley-realty.test", "example-competitor-one.test"]; cc[0].citedSources = ["example-competitor-one.test", "example-listing-portal.test"];
      pc[1].question = "How do I choose a real estate agent in Roseville?"; cc[1].question = "How do I choose a real estate agent in Roseville?"; // 2 of 3 -> 1 of 3: a drop of 1 is noise
      const { pw, r } = scenario({ prevRows: prev, curRows: cur, prevCit: pc, curCit: cc });
      check("I: decline: exit 0 and the four clusters that lost ground are the ones raised", r.status === 0 && ids(pw).join() === "c-agent-lincoln,c-agent-rocklin,c-agent-roseville,c-cost-of-realtor", r.stdout + ids(pw));
      check("I: decline: a position that moved 5 / 5 / 6 places is lost-positions; a ranking that dropped out entirely is lost-positions", ["c-agent-roseville", "c-agent-rocklin", "c-cost-of-realtor", "c-agent-lincoln"].every((id) => kinds(pw, id).includes("lost-positions")));
      const lin = rep(pw).underperforming.find((u) => u.cluster === "c-agent-lincoln").reasons[0];
      check("I: decline: a dropout carries its evidence (from 38 to none, both dates) and the rule that raised it", lin.evidence.from === 38 && lin.evidence.to === null && lin.evidence.dropped === true && lin.evidence.measured.from === "2026-10-12" && /ranked before, no position now/.test(lin.significance));
      check("I: decline: a citation count falling from 3 of 3 to 0 of 3 is raised with who is cited instead; a fall of 1 sample is noise", kinds(pw, "c-cost-of-realtor").includes("citation-dropped") && !kinds(pw, "c-agent-roseville").includes("citation-dropped") && rep(pw).underperforming.find((u) => u.cluster === "c-cost-of-realtor").reasons.find((x) => x.kind === "citation-dropped").evidence.citedInstead.includes("example-listing-portal.test") && rep(pw).ignoredAsNoise.citations === 1);
      check("I: decline: a ranking measured in another place than last time (Sacramento vs Roseville) is never compared", !ids(pw).includes("c-home-value") && rep(pw).ignoredAsNoise.notComparable >= 1);
      const dl = J(path.join(pw, "proposals/plan/deltas.json"));
      const pcRos = dl.pageChanges.find((p) => p.cluster === "c-agent-roseville");
      check("I: decline: page changes are keyed by the page of the approved plan, with effort, reason, what to do and evidence", pcRos.path === "/" && pcRos.changes[0].effort === "M" && pcRos.changes[0].what.length === 3 && /moved 5 places/.test(pcRos.changes[0].significance) && pcRos.changes[0].evidence.from === 9 && dl.pageChanges.find((p) => p.cluster === "c-agent-rocklin").path === "/rocklin-ca/");
      const pr = J(path.join(pw, "proposals/plan/priorities.json")).items;
      const B = { H: 3, M: 2, L: 1 }, E = { S: 3, M: 2, L: 1 };
      check("I: priorities follow 06 9.4: impact band first, then effort with S first, then cluster value; ranks are 1..n", pr.every((x, i) => x.rank === i + 1) && pr.every((x, i) => i === 0 || (B[pr[i - 1].impact] > B[x.impact] || (B[pr[i - 1].impact] === B[x.impact] && (E[pr[i - 1].effort] > E[x.effort] || (E[pr[i - 1].effort] === E[x.effort] && pr[i - 1].value >= x.value))))), JSON.stringify(pr.map((x) => [x.rank, x.impact, x.effort, x.value])));
      check("I: every action carries its proof: the rule id and the significance rule that raised it", pr.length >= 5 && pr.every((x) => /^MSR-00\d: /.test(x.proof) && ["new-page", "page-change", "finding", "offsite"].includes(x.kind)));
      const pt = prop(pw).clusters;
      check("I: cluster priorities are rewritten on the 06 9.4 scale (band*100 + effort*10 + value digit), best first, ids unchanged", pt.every((c, i) => Number.isInteger(c.priority) && c.priority >= 100 && (i === 0 || pt[i - 1].priority >= c.priority)) && pt.length === 6 && T0.clusters.every((c) => pt.some((p) => p.id === c.id)), JSON.stringify(pt.map((c) => [c.id, c.priority])));
      check("I: briefs-delta has a file per changed page naming the rule and the why", /Win back lost positions \(effort M, MSR-002\)/.test(fs.readFileSync(path.join(pw, "proposals/plan/briefs-delta/home.md"), "utf8")) && /Why: 06 9\.8: position moved 5 places/.test(fs.readFileSync(path.join(pw, "proposals/plan/briefs-delta/home.md"), "utf8")));
      const md = fs.readFileSync(path.join(pw, "iterate/report.md"), "utf8");
      check("I: decline: the report names each underperformer with page, impact, reason and evidence", /^# Iterate 2026-10-23: 4 clusters underperform/.test(md) && /### real estate agent lincoln ca \(c-agent-lincoln, page \/lincoln-ca\//.test(md) && /Evidence: "real estate agent roseville ca" \(mobile, Roseville, CA\): 9 -> 14/.test(md) && /## Ignored as noise/.test(md));
    }

    // significance boundaries, one change at a time
    {
      const mk = (mut) => { const prev = rowsOf(MB), cur = rowsOf(MB), pc = citOf(MB), cc = citOf(MB); mut({ prev, cur, pc, cc }); return scenario({ prevRows: prev, curRows: cur, prevCit: pc, curCit: cc }); };
      let s = mk(({ cur }) => { setPos(cur, qs.rocklin, 19); });
      check("I: significance: a 2-place move is noise (not raised, counted)", s.r.status === 0 && ids(s.pw).length === 0 && rep(s.pw).ignoredAsNoise.positions === 1, s.r.stdout + ids(s.pw));
      s = mk(({ cur }) => { setPos(cur, qs.rocklin, 20); });
      check("I: significance: exactly 3 places worse is raised", ids(s.pw).join() === "c-agent-rocklin" && kinds(s.pw, "c-agent-rocklin")[0] === "lost-positions");
      s = mk(({ cur }) => { setPos(cur, qs.rocklin, 12); });
      check("I: significance: moving up 5 places is a gain, never raised", ids(s.pw).length === 0);
      s = mk(({ prev, cur }) => { setPos(prev, qs.rocklin, 17, 200); setPos(cur, qs.rocklin, 25, 30); });
      check("I: significance: a 8-place move on only 30 impressions in the new window is noise (needs >= 50 in both)", ids(s.pw).length === 0 && rep(s.pw).ignoredAsNoise.positions === 1, s.r.stdout + ids(s.pw));
      s = mk(({ prev, cur }) => { setPos(prev, qs.rocklin, 17, 200); setPos(cur, qs.rocklin, 25, 60); });
      check("I: significance: the same move with >= 50 impressions in both windows is raised, with the impressions as evidence", ids(s.pw).join() === "c-agent-rocklin" && rep(s.pw).underperforming[0].reasons[0].evidence.impressions.current === 60);
      s = mk(({ pc, cc }) => { pc[0].question = cc[0].question = "Is 3% a normal real estate commission?"; pc[0].citedShare.value = 1; cc[0].citedShare.value = 0.6667; });
      check("I: significance: 3 of 3 answers -> 2 of 3 is a difference of 1 sample: noise", ids(s.pw).length === 0 && rep(s.pw).ignoredAsNoise.citations === 1, ids(s.pw));
      s = mk(({ pc, cc }) => { pc[0].question = cc[0].question = "Is 3% a normal real estate commission?"; pc[0].citedShare.value = 1; cc[0].citedShare.value = 0.3333; });
      check("I: significance: 3 of 3 -> 1 of 3 (2 samples fewer) is raised", ids(s.pw).join() === "c-cost-of-realtor" && kinds(s.pw, "c-cost-of-realtor")[0] === "citation-dropped");
      s = mk(({ pc, cc }) => { pc[0].question = cc[0].question = "Is 3% a normal real estate commission?"; pc[0].citedShare.value = 1; pc[0].runs = 3; cc[0].citedShare.value = 0.6; cc[0].runs = 5; });
      check("I: significance: runs may differ between dates: share 1.0 of 3 -> 0.6 of 5 is 2 samples fewer on the larger count: raised", ids(s.pw).join() === "c-cost-of-realtor");
      s = mk(({ pc, cc }) => { pc[0].question = cc[0].question = "Is 3% a normal real estate commission?"; pc[0].citedShare.value = 0; cc[0].citedShare.value = 1; });
      check("I: significance: citations that rose are not raised", ids(s.pw).length === 0);
      // no impressions: a cluster with no position in both runs
      s = mk(({ prev, cur }) => { setPos(prev, qs.lincoln, null); setPos(cur, qs.lincoln, null); });
      check("I: a cluster with no position for any of its queries in both runs is 'no impressions' (small fix first: effort S)", ids(s.pw).join() === "c-agent-lincoln" && kinds(s.pw, "c-agent-lincoln")[0] === "no-impressions" && J(path.join(s.pw, "proposals/plan/priorities.json")).items.find((x) => x.id === "act-c-agent-lincoln-no-impressions").effort === "S");
      s = mk(({ prev, cur }) => { setPos(prev, qs.lincoln, null); setPos(cur, qs.lincoln, 30); });
      check("I: a cluster that just entered the results is not 'no impressions'", ids(s.pw).length === 0);
      // field speed
      const crux = (t, status) => ({ status: "ok", results: [{ target: t, formFactor: "PHONE", metrics: { lcp: { status } } }] });
      s = scenario({ prevRows: rowsOf(MB), curRows: rowsOf(MB), prevCit: citOf(MB), curCit: citOf(MB), prevExtra: { "crux.json": crux("https://sample-valley-realty.test/rocklin-ca/", "good") }, curExtra: { "crux.json": crux("https://sample-valley-realty.test/rocklin-ca/", "poor") } });
      check("I: a page whose field LCP status got worse (good -> poor) is raised for its cluster with a small fix (effort S, a finding)", ids(s.pw).join() === "c-agent-rocklin" && kinds(s.pw, "c-agent-rocklin")[0] === "cwv-worse" && J(path.join(s.pw, "proposals/plan/priorities.json")).items.find((x) => x.id === "act-c-agent-rocklin-cwv-worse").kind === "finding");
      s = scenario({ prevRows: rowsOf(MB), curRows: rowsOf(MB), prevCit: citOf(MB), curCit: citOf(MB), prevExtra: { "crux.json": crux("https://sample-valley-realty.test/rocklin-ca/", "poor") }, curExtra: { "crux.json": crux("https://sample-valley-realty.test/rocklin-ca/", "good") } });
      check("I: a speed status that improved is not raised (counted as noise)", ids(s.pw).length === 0 && rep(s.pw).ignoredAsNoise.cwv === 1);
      s = scenario({ prevRows: rowsOf(MB), curRows: rowsOf(MB), prevCit: citOf(MB), curCit: citOf(MB), prevExtra: { "crux.json": crux("https://sample-valley-realty.test/", "good") }, curExtra: { "crux.json": crux("https://sample-valley-realty.test/", "needs improvement") } });
      check("I: an origin-level speed regression is a site-wide finding in the priorities (impact L, effort S)", J(path.join(s.pw, "proposals/plan/priorities.json")).items.some((x) => x.id === "act-site-cwv-lcp" && x.impact === "L" && x.effort === "S") && J(path.join(s.pw, "proposals/plan/deltas.json")).siteWide.length === 1);
      s = scenario({ prevRows: rowsOf(MB), curRows: rowsOf(MB), prevCit: citOf(MB), curCit: citOf(MB), curExtra: { "diff.json": { cruxChanges: [{ target: "https://sample-valley-realty.test/lincoln-ca/", metric: "inp", from: "good", to: "poor", worse: true }] } } });
      check("I: without crux.json the speed changes of the measure diff.json are used", ids(s.pw).join() === "c-agent-lincoln" && kinds(s.pw, "c-agent-lincoln")[0] === "cwv-worse");
      // new-cluster sources and options
      s = scenario({ prevRows: rowsOf(MB), curRows: rowsOf(MB), prevCit: citOf(MB), curCit: citOf(MB), curExtra: { "report.json": { generatedAt: "2026-10-20T08:00:00Z", findings: [{ rule: "MSR-003", title: 'Unplanned demand: "cash offer for my house roseville"', evidence: { impressions: { value: 88 }, clicks: { value: 4 }, position: { value: 9.5 } } }, { rule: "MSR-002", title: 'Ranking got worse: "x"', evidence: {} }] } } });
      check("I: without gsc.json the unplanned demand comes from report.json findings MSR-003 (and says so)", prop(s.pw).clusters.some((c) => c.primaryQuery === "cash offer for my house roseville" && c.volume.value === 88) && /from report\.json findings MSR-003/.test(fs.readFileSync(path.join(s.pw, "iterate/report.md"), "utf8")));
      s = scenario({ prevRows: rowsOf(MB), curRows: rowsOf(MB), prevCit: citOf(MB), curCit: citOf(MB) });
      check("I: with no query source at all the report says BLOCKED with the unblock step and proposes no new cluster", rep(s.pw).newClusters.length === 0 && /BLOCKED: connect Search Console/.test(fs.readFileSync(path.join(s.pw, "iterate/report.md"), "utf8")));
      s = scenario({ prevRows: rowsOf(MB), curRows: rowsOf(MB), prevCit: citOf(MB), curCit: citOf(MB), curExtra: { "gsc.json": gscQ(QS) }, args: ["--min-impressions", "100"] });
      check("I: --min-impressions raises the demand bar (100: only the 120-impression query)", newOnes(s.pw).map((c) => c.primaryQuery).join() === "sell home roseville fast");
      s = scenario({ prevRows: rowsOf(MB), curRows: rowsOf(MB), prevCit: citOf(MB), curCit: citOf(MB), curExtra: { "gsc.json": gscQ([["sell home roseville fast", 120, 6, 8], ["roseville sell home fast", 80, 3, 9], ["cash for homes near me", 70, 2, 14]]) } });
      const nc = newOnes(s.pw);
      check("I: queries with the same words in another order are one cluster (variants kept); 'near me' without a place is not 'local'", nc.length === 2 && nc.find((c) => c.primaryQuery === "sell home roseville fast").queries.includes("roseville sell home fast") && nc.find((c) => c.primaryQuery === "cash for homes near me").intent !== "local" && nc.find((c) => c.primaryQuery === "cash for homes near me").location === null, JSON.stringify(nc.map((c) => [c.primaryQuery, c.queries, c.intent])));
    }

    // exits and inputs
    {
      let pw = newPewp(); writeRun(pw, "2026-09-22", rowsOf(MA), citOf(MA)); writeRun(pw, "2026-10-22", rowsOf(MB), citOf(MB));
      let r = it(pw);
      check("I: nothing approved is BLOCKED, with the step that unblocks it (exit 2) and no proposal written", r.status === 2 && /no approved targets \(BLOCKED\)/.test(r.stdout) && !fs.existsSync(path.join(pw, "proposals")), r.stdout);
      r = it(pw, ["--from-working"]);
      check("I: --from-working iterates on the unsigned file and the report says so", r.status === 0 && /UNAPPROVED working targets/.test(fs.readFileSync(path.join(pw, "iterate/report.md"), "utf8")) && prop(pw).iteration.basedOn === "targets.json (NOT approved)", r.stdout);
      pw = copyApproved(); fs.appendFileSync(path.join(pw, "approved/targets.json"), " "); writeRun(pw, "2026-09-22", rowsOf(MA), citOf(MA)); writeRun(pw, "2026-10-22", rowsOf(MB), citOf(MB));
      r = it(pw);
      check("I: approved files changed after approval stop iterate (exit 1, nothing written)", r.status === 1 && /changed after approval/.test(r.stdout) && !fs.existsSync(path.join(pw, "proposals")), r.stdout);
      pw = copyApproved(); r = it(pw);
      check("I: no measure run is BLOCKED (exit 2)", r.status === 2 && /no measure run to read/.test(r.stdout), r.stdout);
      pw = copyApproved(); writeRun(pw, "2026-10-22", rowsOf(MB), citOf(MB), { "gsc.json": gscQ(QS) }); r = it(pw);
      check("I: a single measure run is a baseline: no change is judged, unplanned demand still proposed", r.status === 0 && /only one measure run \(2026-10-22\): no change can be judged yet/.test(fs.readFileSync(path.join(pw, "iterate/report.md"), "utf8")) && rep(pw).underperforming.length === 0 && rep(pw).newClusters.length === 2);
      pw = copyApproved(); writeRun(pw, "2026-10-22", rowsOf(MB), citOf(MB)); r = it(pw, ["--runs", "2026-01-01,2026-10-22"]);
      check("I: --runs naming a run that does not exist is cannot-judge (exit 2)", r.status === 2, r.stdout);
      // started through a junction (a linked skill folder): argv[1] keeps the link path, import.meta.url is the real file; the old exact
      // compare skipped the CLI and exited 0 with no output, a silent pass
      pw = copyApproved(); writeRun(pw, "2026-10-22", rowsOf(MB), citOf(MB));
      const jx = path.join(tmp, "jx-scripts"); fs.symlinkSync(scriptsDir, jx, "junction");
      r = spawnSync(process.execPath, [path.join(jx, "iterate.mjs"), "--pewp", pw, "--today", "2026-10-23"], { encoding: "utf8", timeout: 120000 });
      check("I: started through a junction, iterate.mjs still runs its CLI (exit 0 and the PASS line, not a silent exit 0)", r.status === 0 && /^PASS iterate /m.test(r.stdout), `exit ${r.status} stdout=${JSON.stringify(r.stdout.slice(0, 200))} ${r.stderr.slice(0, 200)}`);
      fs.rmSync(jx, { recursive: true, force: true }); // removes the link only (the scripts stay)
      // a typo in a number or a date is a usage error (exit 2), never a run on NaN
      pw = copyApproved(); writeRun(pw, "2026-09-22", rowsOf(MA), citOf(MA)); writeRun(pw, "2026-10-22", rowsOf(MB), citOf(MB));
      const bad = [["--min-impressions", "abc"], ["--today", "2026-13-45"], ["--runs", "last,first"]].map((x) => [x.join(" "), run("iterate.mjs", ["--pewp", pw, ...x])]);
      check("I: --min-impressions abc, --today 2026-13-45 and --runs last,first are usage errors (exit 2), nothing written", bad.every(([, x]) => x.status === 2 && /must be/.test(x.stderr)) && !fs.existsSync(path.join(pw, "proposals")), bad.map(([k, x]) => `${k}: exit ${x.status} ${x.stderr.slice(0, 80)}`).join(" | "));
    }

    // ======================= G: the gate prefers the approved files =======================
    {
      const G = await import(pathToFileURL(path.join(scriptsDir, "gate.mjs")).href);
      const SITE = path.join(FIX, "site-clean");
      const one = (pw, id, o = {}) => G.gate(pw, SITE, { only: [id], ...o }).results[0];
      const t = (r) => `${r.summary}\n${r.details.join("\n")}`;
      let r = one(approvedBase, "GT-001");
      check("G: with approved targets and plan the gate reads them and reports the lock ok", r.status === "PASS" && /approved copy, lock ok/.test(r.summary), t(r));
      const whole = G.gate(approvedBase, SITE);
      check("G: the whole gate on the approved copy still passes every check and names the signer in the report", whole.status === "PASS" && G.reportMd(whole, { site: SITE, pewp: approvedBase, ranAt: "2026-10-23T00:00:00Z" }).includes("signed by Test Owner on"), whole.results.map((x) => x.id + x.status).join(" "));
      let pw = copyApproved(); const wt = J(path.join(pw, "targets.json")); wt.clusters = wt.clusters.slice(0, 2); W(path.join(pw, "targets.json"), wt); fs.rmSync(path.join(pw, "plan"), { recursive: true });
      r = one(pw, "GT-001");
      check("G: a broken or deleted WORKING targets.json / plan does not matter once approved copies exist (proof the gate reads approved/)", r.status === "PASS", t(r));
      const res = G.gate(pw, SITE, { only: ["GT-004", "GT-005", "GT-006", "GT-008"] });
      check("G: the page checks read the approved sitemap and briefs too (working plan folder deleted)", res.results.every((x) => x.status === "PASS"), res.results.map((x) => x.id + x.status + t(x)).join("\n"));
      pw = copyApproved(); fs.appendFileSync(path.join(pw, "approved/plan/briefs/rocklin-ca.md"), "\n- edited");
      r = one(pw, "GT-001");
      check("G: a file changed after approval fails GT-001 (lock check)", r.status === "FAIL" && /L-001 lock: plan\/briefs\/rocklin-ca\.md: changed after approval/.test(t(r)), t(r));
      pw = copyApproved(); fs.appendFileSync(path.join(pw, "approved/targets.json"), " ");
      r = one(pw, "GT-001");
      check("G: tampered approved targets fail GT-001 too", r.status === "FAIL" && /L-001 lock: targets\.json/.test(t(r)));
      pw = newPewp(); r = one(pw, "GT-001");
      check("G: nothing approved: GT-001 passes on the working files with a WARN", r.status === "PASS" && /WARN not approved yet/.test(t(r)));
      r = one(pw, "GT-001", { strict: true });
      check("G: nothing approved under --strict (the launch gate) FAILS: the files must be signed", r.status === "FAIL" && /L-003 targets and plan are not both approved/.test(t(r)));
      r = one(approvedBase, "GT-001", { strict: true });
      check("G: approved targets and plan pass GT-001 under --strict", r.status === "PASS", t(r));
      pw = copyApproved(); const wt2 = J(path.join(pw, "targets.json")); wt2.clusters[0].priority = 99; W(path.join(pw, "targets.json"), wt2); approveT(pw);
      r = one(pw, "GT-001");
      check("G: targets re-approved without re-approving the plan: GT-001 FAILS as stale", r.status === "FAIL" && /L-002 lock: plan was approved for targets/.test(t(r)), t(r));
      const cli = run("gate.mjs", [copyApproved(), SITE, "--no-report"]);
      check("G: gate.mjs CLI on approved files exits 0", cli.status === 0, cli.stdout);
    }
  } catch (e) {
    check("suite crashed", false, e.stack || e);
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  return R;
}

// child mode: a mutant's suite runs in its own process so several run in parallel
if (process.argv.includes("--suite-json")) {
  const rs = await suite(path.resolve(process.argv[process.argv.indexOf("--suite-json") + 1]));
  process.stdout.write(JSON.stringify(rs.map((r) => ({ name: r.name, ok: r.ok }))));
  process.exit(0);
}
const t0 = Date.now();
const main = await suite(HERE);
const grp = (r) => (r.name.match(/^([A-Z]):/) || [, "?"])[1];
for (const r of main) if (VERBOSE || !r.ok) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${r.ok ? "" : "\n     " + r.detail.replace(/\n/g, "\n     ")}`);
for (const [g, n] of Object.entries({ A: "approve", I: "iterate", G: "gate on approved files" })) { const rs = main.filter((r) => grp(r) === g); console.log(`${g} ${n}: ${rs.filter((r) => r.ok).length}/${rs.length}`); }
let failed = main.filter((r) => !r.ok).length;
console.log(`${failed ? "FAIL" : "PASS"} test-iterate ${main.filter((r) => r.ok).length}/${main.length} checks (${Math.round((Date.now() - t0) / 1000)} s)`);

// ---------- M: watched-fail mutants ----------
if (!process.argv.includes("--no-mutants")) {
  const MUTANTS = [
    ["approve.mjs", "else if (sha256(fs.readFileSync(f)) !== want) problems.push", "else if (false) problems.push", /A: lock check FAILS when approved targets\.json is edited/, "the lock no longer compares sha256"],
    ["approve.mjs", "if (!(rel in entry.files)) problems.push(", "if (false) problems.push(", /A: lock check FAILS when a file is added/, "files added after approval are not detected"],
    ["approve.mjs", "if (!by) { log(`NOT SIGNED: approving is the owner's act. Re-run with --by \"<owner name>\" after the owner has read the diff.`); return 3; }\n    if (old)", "if (old)", /A: approve targets without --by/, "targets can be approved without --by"],
    ["approve.mjs", "if (!lock.targets || !fs.existsSync(path.join(dir, \"targets.json\"))) {", "if (false) {", /A: approve plan before targets is refused/, "plan can be approved before the targets"],
    ["approve.mjs", "if (lockNow.exists && !lockNow.ok) {", "if (false) {", /A: nothing new is approved on top of tampered/, "approval on top of tampered files allowed"],
    ["approve.mjs", "if (lock?.plan && tsha && lock.plan.targetsSha256 !== tsha)", "if (false)", /A: after re-approving the targets the old plan is reported STALE/, "a stale plan is not reported"],
    ["approve.mjs", "if (!v.ok) { log(`FAIL approve: ${src} is not valid", "if (false) { log(`FAIL approve: ${src} is not valid", /A: invalid targets are refused/, "invalid targets can be approved"],
    ["iterate.mjs", "if (delta >= TH.positionDelta && impOk)", "if (delta >= 1 && impOk)", /I: significance: a 2-place move is noise/, "position threshold lowered to 1 place"],
    ["iterate.mjs", "const impOk = !(typeof o.impressions === \"number\" && typeof r.impressions === \"number\") || (o.impressions >= MI && r.impressions >= MI);", "const impOk = true;", /I: significance: a 8-place move on only 30 impressions/, "impressions rule removed"],
    ["iterate.mjs", "if (drop >= TH.aiSampleDelta) {", "if (drop >= 1) {", /I: significance: 3 of 3 answers -> 2 of 3/, "citation threshold lowered to 1 sample"],
    ["iterate.mjs", "if (!ch.worse) { noise.cwv++; continue; }", "if (false) { noise.cwv++; continue; }", /I: a speed status that improved is not raised/, "improved speed raised as underperformance"],
    ["iterate.mjs", "if (!(r.impressions >= MI)) { skipped.belowImpressions++; continue; }", "", /I: new clusters only from queries with >= 50 impressions/, "new clusters proposed below the impressions bar"],
    ["iterate.mjs", "if (planned.some((q) => containsWords(r.query, q))) { skipped.alreadyPlanned++; continue; }", "", /I: iterate on the fixture pair runs|I: new clusters only from queries/, "already planned queries proposed again"],
    ["iterate.mjs", "brand.every((t) => new Set(tokens(r.query)).has(t))", "false", /I: new clusters only from queries/, "brand searches proposed as clusters"],
    ["iterate.mjs", "BAND[b.impact] - BAND[a.impact] || EFFORT[b.effort] - EFFORT[a.effort]", "BAND[a.impact] - BAND[b.impact] || EFFORT[a.effort] - EFFORT[b.effort]", /I: priorities follow 06 9\.4/, "priority order reversed"],
    ["iterate.mjs", "const PROP = path.join(pewp, \"proposals\");", "const PROP = path.join(pewp, \"approved\");", /I: iterate on the fixture pair runs|I: approved\/ is byte-identical/, "iterate writes its proposals into approved/"],
    ["iterate.mjs", "if (inp.lock.exists && !inp.lock.ok) {", "if (false) {", /I: approved files changed after approval stop iterate/, "iterate builds on tampered approved files"],
    ["iterate.mjs", "if (!inp.approved.targets && !opts.fromWorking) {", "if (false) {", /I: nothing approved is BLOCKED/, "iterate runs without approved targets"],
    ["iterate.mjs", "if (from != null && to == null && impOk)", "if (false)", /I: decline: a position that moved/, "dropouts not raised"],
    ["lib-plan.mjs", "readJson(ctx.inputs.targetsFile, \"targets.json\")", "readJson(path.join(pewp, \"targets.json\"), \"targets.json\")", /G: a broken or deleted WORKING/, "gate reads the working targets instead of the approved copy"],
    ["gate-targets.mjs", "for (const p of inp.lock.problems) bad.push(", "for (const p of []) bad.push(", /G: a file changed after approval fails GT-001/, "gate ignores the lock check"],
    ["gate-targets.mjs", "if (ctx.strict && !(inp.approved.targets && inp.approved.plan))", "if (false)", /G: nothing approved under --strict/, "the launch gate accepts unsigned files"],
    ["lib-main.mjs", "  try { return norm(fs.realpathSync(arg)) === norm(fs.realpathSync(me)); }", "  try { return norm(arg) === norm(me); }", /I: started through a junction/, "the main-module check compares paths exactly again (no real path; lib-main.mjs is the one copy)"],
    ["iterate.mjs", "if (a.includes(\"--min-impressions\") && !(", "if (false && !(", /I: --min-impressions abc/, "a non-number --min-impressions runs on NaN"],
    ["iterate.mjs", "if (a.includes(\"--today\") && !isDay(", "if (false && !isDay(", /I: --min-impressions abc/, "an impossible --today is accepted"],
  ];
  const results = new Array(MUTANTS.length);
  const jobs = [];
  for (const [i, [file, from, to, expectRe, why]] of MUTANTS.entries()) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-itmut-"));
    fs.cpSync(HERE, path.join(root, "scripts"), { recursive: true });
    fs.cpSync(path.join(HERE, "..", "rules"), path.join(root, "rules"), { recursive: true });
    const f = path.join(root, "scripts", file), src = fs.readFileSync(f, "utf8");
    if (!src.includes(from)) { results[i] = { i, file, why, status: "PATCH-NEVER-APPLIED", detail: from.slice(0, 70) }; continue; }
    fs.writeFileSync(f, src.replace(from, to));
    jobs.push({ i, file, why, expectRe, root });
  }
  const runJob = (j) => new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(j.root, "scripts", "test-iterate.mjs"), "--suite-json", path.join(j.root, "scripts")], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PEWP_FIX: FIX } });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    const kill = setTimeout(() => c.kill(), 300000); // a mutant that hangs is a red result, never a hung test run
    c.on("close", () => {
      clearTimeout(kill);
      let rs = []; try { rs = JSON.parse(out); } catch { rs = [{ name: "mutant suite did not finish", ok: false }]; }
      const red = rs.filter((r) => !r.ok), right = red.filter((r) => j.expectRe.test(r.name));
      results[j.i] = { i: j.i, file: j.file, why: j.why, status: right.length ? "RED (right reason)" : red.length ? "RED (other reason only)" : "GREEN (survived)", red: red.length, detail: (right[0] || red[0] || {}).name };
      try { fs.rmSync(j.root, { recursive: true, force: true }); } catch {}
      resolve();
    });
  });
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(6, os.cpus().length) }, async () => { while (queue.length) await runJob(queue.shift()); }));
  for (const r of results) console.log(`M mutant ${String(r.i + 1).padStart(2)} ${r.file}: ${r.why} -> ${r.status}${r.red ? ` (${r.red} failing; e.g. ${r.detail})` : r.detail ? " " + r.detail : ""}`);
  const ok = results.filter((r) => r.status === "RED (right reason)").length;
  console.log(`${ok === results.length ? "PASS" : "FAIL"} mutants ${ok}/${results.length} went red for the right reason`);
  if (ok !== results.length) failed++;
}
process.exit(failed ? 1 : 0);
