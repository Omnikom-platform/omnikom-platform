// Usage: node test-checker-rules.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of checker-rules.mjs (AB-7, parts AU.D-6 and SS.B-4): the measurable rules of the audit program become causes.json, plan.json and REPORT.md with no model.
// Most cases hand the script an invented result of the rule program (io.audit, io.listRules) and an invented snapshot folder; ONE case runs the real audit() on a real
// fixture snapshot of tools/audit/fixtures (a copy of tools/audit sits beside a copy of the skill, as in the repository); ONE runs the real report-live.mjs on the files
// the script wrote. No network (netguard-import.mjs refuses every non-local request), no browser, no model. Mutants: a patch to a copy of the scripts folder must turn the named case red.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { checker, main, runner, mkTmp, rmTmp, W as writeFile } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const SKILL = path.resolve(here, "..");
const REPO = path.resolve(SKILL, "..", "..");
const KEYS = ["id", "severity", "rules", "fixAt", "problem", "fix", "pages", "findings", "scripts"];
const BASE_ENV = { GSC_TOKEN_FILE: "", GSC_SERVICE_ACCOUNT_FILE: "", GSC_SERVICE_ACCOUNT_JSON_B64: "" };
const rd = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const rj = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };

// the invented rule program: nine rules; the findings are in an order that is NOT the order of the answer
const RULES = [["AAA-001", "P0"], ["BBB-002", "P1"], ["CCC-003", "P2"], ["DDD-004", "W"], ["EEE-005", "P1"], ["FFF-006", "P0"], ["GGG-007", "P1"], ["HHH-008", "P1"], ["III-009", "P1"]];
const LIST = RULES.map(([id, severity]) => ({ id, severity, source: "invented", notCovered: [] }));
const f = (rule, page, line, what, status) => ({ rule, page, line, what, status });
const FINDINGS = [
  f("CCC-003", "/a", 9, "c nine", "FAIL"), f("EEE-005", "/a", 0, "e skipped", "SKIP"), f("III-009", "/a", 4, "i four", "WARN"), f("AAA-001", "/a", 3, "alpha broke", "FAIL"),
  f("FFF-006", "/b", 2, "f info", "INFO"), f("HHH-008", "/a", 1, "h one", "FAIL"), f("GGG-007", "/a", 5, "g five", "FAIL"), f("BBB-002", undefined, undefined, "site wide", "WARN"),
  f("AAA-001", "/b", 7, "alpha again", "FAIL"), f("CCC-003", "/a", 10, "c ten", "FAIL"), f("HHH-008", "/a", 2, "h two", "WARN"), f("DDD-004", "/a", 1, "d one", "WARN"),
  f("AAA-001", "/a", 3, "alpha broke", "WARN"), f("CCC-003", "/b", 1, "c b", "FAIL"), f("HHH-008", "/a", 3, "h three", "FAIL"), f("GGG-007", "/b", 6, "g six", "FAIL"), f("EEE-005", "/b", 0, "e skipped too", "SKIP"),
];
const KEPT = FINDINGS.filter((x) => x.status === "FAIL" || x.status === "WARN").length;
const invented = (findings) => ({ audit: () => ({ dir: "x", mode: "snapshot", pages: ["/a", "/b"], rules: LIST.map(({ id, severity, source }) => ({ id, severity, source })), findings, lines: [], pass: false, exit: 1 }), listRules: () => LIST });
const EXPECT = [   // what the invented result must give, in order
  { id: "C01", severity: "critical", rules: ["AAA-001"], problem: "AAA-001: alpha broke (and 1 more)", fix: "Meet AAA-001: Alpha must hold", pages: 2, findings: ["AAA-001@/a#3", "AAA-001@/b#7"] },
  { id: "C02", severity: "high", rules: ["GGG-007"], problem: "GGG-007: g five (and 1 more)", fix: "Meet GGG-007: Golf rule text", pages: 2, findings: ["GGG-007@/a#5", "GGG-007@/b#6"] },
  { id: "C03", severity: "high", rules: ["HHH-008"], problem: "HHH-008: h one (and 2 more)", fix: "Meet HHH-008: Hotel text", pages: 1, findings: ["HHH-008@/a#1", "HHH-008@/a#2", "HHH-008@/a#3"] },
  { id: "C04", severity: "high", rules: ["BBB-002"], problem: "BBB-002: site wide", fix: "Meet BBB-002: Bravo text", pages: 1, findings: ["BBB-002@site"] },
  { id: "C05", severity: "high", rules: ["III-009"], problem: "III-009: i four", fix: "Meet III-009", pages: 1, findings: ["III-009@/a#4"] },
  { id: "C06", severity: "medium", rules: ["CCC-003"], problem: "CCC-003: c nine (and 2 more)", fix: "Meet CCC-003: Charlie text", pages: 2, findings: ["CCC-003@/a#9", "CCC-003@/a#10", "CCC-003@/b#1"] },
  { id: "C07", severity: "low", rules: ["DDD-004"], problem: "DDD-004: d one", fix: "Meet DDD-004", pages: 1, findings: ["DDD-004@/a#1"] },
];

async function scenarios(dir) {
  const results = [], check = checker(results);
  const root = mkTmp("checkerrules");
  try {
    // the repository's shape: <repo>/skills/<skill>/{scripts,checklist} and <repo>/tools/audit (without its fixtures)
    const repo = path.join(root, "repo"), skill = path.join(repo, "skills", "programmatic-enterprise-web-performance");
    fs.cpSync(dir, path.join(skill, "scripts"), { recursive: true });
    fs.cpSync(path.join(SKILL, "checklist"), path.join(skill, "checklist"), { recursive: true });
    fs.cpSync(path.join(REPO, "tools", "audit"), path.join(repo, "tools", "audit"), { recursive: true, filter: (s) => !/[\\/](fixtures|test|proof)([\\/]|$)/.test(path.relative(path.join(REPO, "tools", "audit"), s)) });
    // a small skill of our own for the invented cases: a checklist of three kinds of line and an index that says 12 rules
    const small = path.join(root, "small");
    writeFile(path.join(small, "checklist", "INDEX.md"), "# Checklist index (shipgate spec 8.0.0, 12 rules)\n\n- one: 12 rules\n");
    writeFile(path.join(small, "checklist", "one.md"), "# One\n\n- AAA-001 P0 [http] Alpha must hold\n- BBB-002 P1 [html, http] Bravo text\n- CCC-003 P2 [cfg] Charlie text\n- GGG-007 P1 (part `x` W) [html] Golf rule text\n- HHH-008 P0\u2020 [db] Hotel text\n");
    const home = path.join(root, "home"); fs.mkdirSync(home, { recursive: true });
    const exec = runner(path.join(skill, "scripts"), home, path.join(root, "net.log"));
    let n = 0;
    check("0: checker-rules.mjs exists next to the other scripts", fs.existsSync(path.join(dir, "checker-rules.mjs")), "the script is not there yet");
    let lib = null;
    try { lib = await import(pathToFileURL(path.join(skill, "scripts", "checker-rules.mjs")).href + "?" + Math.random()); }
    catch (e) { check("0: checker-rules.mjs loads", false, e.message); }
    const chk = lib && lib.checkerRules ? lib.checkerRules : async () => ({ code: -1, line: "no checkerRules export" });

    // a run folder with a complete invented snapshot (latestComplete wants finishedAt and one page)
    const host = () => "r" + ++n + ".example";
    const mkRun = (h, { snapshot = true } = {}) => {
      const data = path.join(root, "data" + n), base = path.join(data, "site-checks", h);
      if (snapshot) writeFile(path.join(base, "snapshots", "2026-10-24", "_site.json"), { finishedAt: "2026-10-24T10:00:00Z", stoppedEarly: null, pages: [{ url: "https://" + h + "/", slug: "home", status: 200 }] });
      return { data, base, url: "https://" + h + "/", out: path.join(base, "work", "checker", ".checks") };
    };
    const go = (r, io) => chk(["https://" + path.basename(r.base) + "/", "--cwd", r.data], { skillDir: small, ...io });
    const names = (r) => (fs.existsSync(r.out) ? fs.readdirSync(r.out).sort().join() : "");

    // 1. the invented result: four rules with findings of every status
    const r1 = mkRun(host()), x1 = await go(r1, invented(FINDINGS)), c1 = rj(path.join(r1.out, "causes.json"));
    check("1: exit 0 and a list in causes.json", x1.code === 0 && Array.isArray(c1), x1.code + " " + x1.line);
    check("1: exactly the rules with a FAIL or a WARN are causes (a SKIP, an INFO and a rule with no finding are not)", c1 && c1.map((c) => c.rules[0]).sort().join() === "AAA-001,BBB-002,CCC-003,DDD-004,GGG-007,HHH-008,III-009", JSON.stringify(c1 && c1.map((c) => c.rules)));
    check("1: each entry has exactly the 9 keys of merge.mjs, in order, with the right types", c1 && c1.length === 7 && c1.every((c) => Object.keys(c).join() === KEYS.join() && typeof c.id === "string" && typeof c.severity === "string" && Array.isArray(c.rules) && c.rules.length === 1
      && JSON.stringify(c.fixAt) === '["platform"]' && typeof c.problem === "string" && typeof c.fix === "string" && Number.isInteger(c.pages) && Array.isArray(c.findings) && c.findings.every((x) => typeof x === "string") && JSON.stringify(c.scripts) === "[]"), JSON.stringify(c1 && c1[0]));
    check("1: severity by the table (P0 critical, P1 high, P2 medium, W low)", c1 && EXPECT.every((e, i) => c1[i] && c1[i].severity === e.severity), JSON.stringify(c1 && c1.map((c) => [c.rules[0], c.severity])));
    check("1: pages are the distinct pages of the kept findings (a finding with no page is the page 'site'), never one per finding", c1 && EXPECT.every((e, i) => c1[i] && c1[i].pages === e.pages), JSON.stringify(c1 && c1.map((c) => [c.rules[0], c.pages])));
    check("1: finding ids are rule@page#line (no line: rule@page; no page: rule@site), a duplicate kept once", c1 && EXPECT.every((e, i) => c1[i] && JSON.stringify(c1[i].findings) === JSON.stringify(e.findings)), JSON.stringify(c1 && c1.map((c) => c.findings)));
    check("1: the order is severity, then pages (most first), then findings (most first), then rule id; the ids are C01, C02, ... in that order", c1 && EXPECT.every((e, i) => c1[i] && c1[i].id === e.id && c1[i].rules[0] === e.rules[0]), JSON.stringify(c1 && c1.map((c) => [c.id, c.rules[0]])));
    check("1: problem is '<rule>: <the first finding's what>' and ' (and <n> more)' when there are more", c1 && EXPECT.every((e, i) => c1[i] && c1[i].problem === e.problem), JSON.stringify(c1 && c1.map((c) => c.problem)));
    check("1: fix names the rule and gives the checklist's own text, and with no checklist line it is only 'Meet <rule>'", c1 && EXPECT.every((e, i) => c1[i] && c1[i].fix === e.fix), JSON.stringify(c1 && c1.map((c) => c.fix)));

    // 2. plan.json, REPORT.md and the last line
    const p2 = rj(path.join(r1.out, "plan.json")), md = rd(path.join(r1.out, "REPORT.md")) || "", ml = md.split(/\r?\n/).filter((l, i, a) => l !== "" || i < a.length - 1);
    check("2: only causes.json, plan.json and REPORT.md are written there", names(r1) === "REPORT.md,causes.json,plan.json", names(r1));
    check("2: plan.json is the small plan of choice 6 (createdAt now, snapshot true, engine with rulesRun 9, rulesInChecklist 12, pages 2, empty slices, skipped and families)", p2 && Object.keys(p2).join() === "createdAt,snapshot,engine,slices,skipped,families" && Math.abs(Date.now() - Date.parse(p2.createdAt)) < 120000 && p2.snapshot === true
      && JSON.stringify(p2.engine) === '{"rulesRun":9,"rulesInChecklist":12,"pages":2}' && JSON.stringify(p2.slices) === "[]" && JSON.stringify(p2.skipped) === "{}" && JSON.stringify(p2.families) === "[]", JSON.stringify(p2));
    check("2: REPORT.md first line says it was written by program from 9 of 12 rules, then one line per cause with id, severity, rule, pages and problem", ml.length === 8 && /written by program from 9 of 12 rules/.test(ml[0]) && EXPECT.every((e, i) => [e.id, e.severity, e.rules[0], e.pages + " page", e.problem].every((s) => ml[i + 1] && ml[i + 1].includes(s))), md);
    check("2: the last line says causes, kept findings, and 9 of 12 rules checked by program (never that the whole checklist was checked)", x1.line === "CHECKER: 7 causes from " + KEPT + " findings, 9 of 12 rules checked by program", x1.line);

    // 3. no finding at all
    const r3 = mkRun(host()), x3 = await go(r3, invented(FINDINGS.filter((x) => x.status === "SKIP")));
    check("3: no finding that is a defect: exit 0, causes.json is [], the last line says 0 causes from 0 findings", x3.code === 0 && rd(path.join(r3.out, "causes.json")).trim() === "[]" && x3.line === "CHECKER: 0 causes from 0 findings, 9 of 12 rules checked by program", x3.code + " " + x3.line);

    // 4. nothing to judge, a program that fails
    const r4 = mkRun(host(), { snapshot: false }), x4 = await go(r4, invented(FINDINGS));
    check("4: no snapshot: exit 3, the BLOCKED line with the folder and what unblocks, nothing written", x4.code === 3 && x4.line === "BLOCKED: there is no snapshot of this site (" + r4.base.replace(/\\/g, "/") + "/snapshots) | unblocks: run the snapshot step first" && !fs.existsSync(path.join(r4.base, "work")), x4.code + " " + x4.line);
    const r5 = mkRun(host()); writeFile(path.join(r5.out, "causes.json"), "OLD RESULT");
    const x5 = await go(r5, { audit: () => { throw new Error("boom"); }, listRules: () => LIST });
    check("4: the program throws: exit 3, the BLOCKED line with its message, an older causes.json untouched, no other file", x5.code === 3 && x5.line === "BLOCKED: the rule program failed (boom) | unblocks: node tools/audit/run.mjs --help" && rd(path.join(r5.out, "causes.json")) === "OLD RESULT" && names(r5) === "causes.json", x5.code + " " + x5.line + " " + names(r5));
    const u = await exec("checker-rules.mjs", []);
    check("4: no key: exit 2 and the usage line", u.code === 2 && /usage: node checker-rules\.mjs <url or profile:slug> \[--cwd DIR\]/.test(u.out), u.code + " " + u.out);

    // 5. the REAL rule program on real fixture snapshots, the real script as a child process (no invented part)
    const real = await import(pathToFileURL(path.join(repo, "tools", "audit", "index.mjs")).href), ids = new Set(real.listRules().map((x) => x.id));
    const idx = /shipgate spec [\d.]+, (\d+) rules/.exec(rd(path.join(SKILL, "checklist", "INDEX.md")) || "");
    const r6 = mkRun("fixture-bad.example"); fs.rmSync(path.join(r6.base, "snapshots"), { recursive: true });
    fs.cpSync(path.join(REPO, "tools", "audit", "fixtures", "snapshot-bad-MET-003"), path.join(r6.base, "snapshots", "2026-10-30"), { recursive: true });
    const x6 = await exec("checker-rules.mjs", ["https://fixture-bad.example/", "--cwd", r6.data]), c6 = rj(path.join(r6.out, "causes.json")), last6 = x6.out.trim().split(/\r?\n/).pop();
    check("5: the real program on a real fixture snapshot: exit 0, at least one cause, every rule one of listRules()'s ids, every severity one of the four words", x6.code === 0 && Array.isArray(c6) && c6.length >= 1 && c6.every((c) => c.rules.every((r) => ids.has(r)) && ["critical", "high", "medium", "low"].includes(c.severity)), x6.out + JSON.stringify(c6));
    check("5: the real fixture's own FAIL (MET-003) is a cause with its finding id, and the last line counts the program's rules against the checklist's", c6 && c6.some((c) => c.rules[0] === "MET-003" && c.findings.every((x) => /^MET-003@\/\S*#\d+$/.test(x))) && idx && last6 === "CHECKER: " + c6.length + " causes from " + c6.reduce((s, c) => s + c.findings.length, 0) + " findings, " + ids.size + " of " + idx[1] + " rules checked by program", last6);
    const r7 = mkRun("fixture-good.example"); fs.rmSync(path.join(r7.base, "snapshots"), { recursive: true });
    fs.cpSync(path.join(REPO, "tools", "audit", "fixtures", "snapshot-good"), path.join(r7.base, "snapshots", "2026-10-30"), { recursive: true });
    const x7 = await exec("checker-rules.mjs", ["https://fixture-good.example/", "--cwd", r7.data]);
    check("5: the real program on the good fixture snapshot: exit 0 and causes.json is []", x7.code === 0 && (rd(path.join(r7.out, "causes.json")) || "").trim() === "[]", x7.out);
    const tools = path.join(repo, "tools"), away = path.join(repo, "tools-away");
    fs.renameSync(tools, away);
    const x8 = await exec("checker-rules.mjs", ["https://fixture-bad.example/", "--cwd", r6.data]); fs.renameSync(away, tools);
    check("5: the skill linked outside the repository (no tools/audit): exit 3 and a BLOCKED line that says the rule program is not there", x8.code === 3 && /^BLOCKED: the rule program is not here \(.*index\.mjs\) \| unblocks: /m.test(x8.out), x8.code + " " + x8.out);

    // 6. the REAL report-live.mjs reads what the script wrote
    const mkWorld = (h) => {
      const data = path.join(root, "world-" + h), base = path.join(data, "site-checks", h), sd = path.join(base, "snapshots", "2026-10-24");
      writeFile(path.join(sd, "_site.json"), { finishedAt: "2026-10-24T10:00:00Z", runs: 1, stoppedEarly: null, machineLoad: null, pages: [{ url: "https://" + h + "/", slug: "home", status: 200 }] });
      writeFile(path.join(sd, "site/robots.json"), { status: 200, groups: [{ agents: ["*"], rules: [] }] });
      writeFile(path.join(sd, "site/sitemaps.json"), { urlCount: 3 });
      writeFile(path.join(sd, "site/probes.json"), { notFound: { finalStatus: 404 } });
      writeFile(path.join(sd, "pages", "home", "browser-mobile.json"), { url: "https://" + h + "/", measuredAt: "2026-10-24T10:00:00Z", vitals: { lcpMs: 1500, cls: 0.01, tbtMs: 100 }, totals: { bytes: 1024000, requests: 20 }, page: { canonical: "https://" + h + "/", metaDescription: "d", h1Count: 1, structuredData: [{ ok: true, types: ["WebPage"] }], og: { "og:title": "t" }, robotsMeta: [] } });
      writeFile(path.join(sd, "pages", "home", "response.json"), { headers: {} });
      return { data, base, sd, pewp: path.join(base, ".pewp"), url: "https://" + h + "/", wk: path.join(base, "work", "checker", ".checks"), host: h };
    };
    const rep = (w) => exec("report-live.mjs", [w.url, "--cwd", w.data, "--snapshot", w.sd, "--checks", w.wk], { env: BASE_ENV });
    const w6 = mkWorld("world6.example"), y6 = await chk([w6.url, "--cwd", w6.data], { skillDir: skill, ...invented(FINDINGS) });
    const plan6 = rj(path.join(w6.wk, "plan.json")), rep6 = await rep(w6), md6 = rd(path.join(w6.pewp, "report.md")) || "", js6 = (rd(path.join(w6.pewp, "report.json")) || "").replace(/"writtenAt": "[^"]*"/, '"writtenAt": "W"'), rc6 = (() => { try { return JSON.parse(js6).questions[0].facts.rootCauses; } catch { return null; } })();
    check("6: report-live reads the script's files: exit 0, no BLOCKED line, the causes counted by severity (1 critical, 4 high, 1 medium, 1 low)", y6.code === 0 && rep6.code === 0 && !/^BLOCKED:/m.test(rep6.out) && rc6 && JSON.stringify(rc6.value) === '{"total":7,"critical":1,"high":4,"medium":1,"low":1}' && /cache\/|work\/checker\/\.checks\/causes\.json/.test(rc6.cacheFile), JSON.stringify(rc6));
    const said = plan6 ? plan6.engine.rulesRun + " of " + plan6.engine.rulesInChecklist + " rules, checked by program" : "?";
    check("6: with an engine in plan.json the report says '<rulesRun> of <rulesInChecklist> rules, checked by program' where it said the checklist's count (the sentence and the source of the figure)", plan6 && plan6.engine.rulesRun === 9 && plan6.engine.rulesInChecklist === Number(/(\d+) rules/.exec(rd(path.join(SKILL, "checklist", "INDEX.md")))[1])
      && md6.includes("- The checklist (" + said + ") found 7 root causes: 1 critical, 4 high, 1 medium, 1 low") && rc6 && rc6.source === "the checker's root causes (" + said + ")" && !/shipgate spec/.test(md6.split("## 2.")[0]), said + " | " + md6.split("\n").filter((l) => /The checklist/.test(l)).join(" / ") + " | " + (rc6 && rc6.source));
    // the same world, no engine key: everything is as before (the old words), and nothing else moved
    const pewpKeep = (fs.existsSync(w6.pewp) ? fs.readdirSync(w6.pewp) : []).filter((x) => /^report/.test(x)); for (const x of pewpKeep) fs.rmSync(path.join(w6.pewp, x), { force: true });
    writeFile(path.join(w6.wk, "plan.json"), { createdAt: plan6 ? plan6.createdAt : "x", snapshot: true, slices: [], skipped: {}, families: [] });
    const repB = await rep(w6), mdB = rd(path.join(w6.pewp, "report.md")) || "", jsB = (rd(path.join(w6.pewp, "report.json")) || "").replace(/"writtenAt": "[^"]*"/, '"writtenAt": "W"'), old = "RULES_OLD";
    const oldWords = (() => { const m = /shipgate spec ([\d.]+), (\d+) rules/.exec(rd(path.join(SKILL, "checklist", "INDEX.md")) || ""); return m ? m[2] + " rules, shipgate spec " + m[1] : "?"; })();
    check("6: with a plan.json that has no engine key, report.md and report.json are byte for byte the engine run's with the old words (the checklist's own count) in place of the new ones", repB.code === 0 && mdB.length > 500 && mdB === md6.split(said).join(oldWords) && jsB === js6.split(said).join(oldWords) && mdB.includes("- The checklist (" + oldWords + ") found 7 root causes"), (() => { const a = jsB, b = js6.split(said).join(oldWords); let i = 0; while (i < a.length && a[i] === b[i]) i++; return repB.code + " first json difference at " + i + ": " + a.slice(Math.max(0, i - 60), i + 80) + " <> " + b.slice(Math.max(0, i - 60), i + 80); })());
  } finally { rmTmp(root); }

  // 7. the real pipeline.json
  { const m = rj(path.join(SKILL, "pipeline.json")), L = await import(pathToFileURL(path.join(dir, "lib-pipeline.mjs")).href + "?" + Math.random());
    const st = m ? m.steps.find((s) => s.id === "checker") : null, rl = m ? m.steps.find((s) => s.id === "report-live") : null, v = m ? L.validateManifest(m, { skillDir: SKILL }) : { ok: false, problems: [{ detail: "no manifest" }] };
    check("7: the real pipeline.json is valid (validateManifest)", v.ok === true, v.problems.map(L.describe).join("; "));
    check("7: the checker step runs scripts/checker-rules.mjs with {key} --cwd {skill}, needs no agent, is not heavy, 10 minutes, no hits; station, dependsOn, skipWhen, kind and maxAgeDays as before",
      st && st.script === "scripts/checker-rules.mjs" && JSON.stringify(st.args) === '["{key}","--cwd","{skill}"]' && st.needsAi === false && st.heavy === false && st.timeoutMinutes === 10 && st.hits === "none" && st.station === "site" && st.skipWhen === "site-none"
      && JSON.stringify(st.dependsOn) === '["snapshot"]' && st.kind === "time-sensitive" && st.maxAgeDays === 7, JSON.stringify(st));
    check("7: the checker step's outputs and evidence are causes.json and REPORT.md (outputs also plan.json) under {work}/checker/.checks, and its words say by program, no model",
      st && JSON.stringify(st.outputs) === '["{work}/checker/.checks/causes.json","{work}/checker/.checks/REPORT.md","{work}/checker/.checks/plan.json"]' && JSON.stringify(st.evidence) === '["{work}/checker/.checks/causes.json"]' && /by program/.test(st.what) && /no model/.test(st.what) && !/coordinator|agent/i.test(st.what) && !("brief" in st && /coordinator/.test(st.brief)), JSON.stringify(st));
    check("7: report-live still comes after the checker and reads {work}/checker/.checks", rl && rl.dependsOn.includes("checker") && rl.args.includes("--checks") && rl.args[rl.args.indexOf("--checks") + 1] === "{work}/checker/.checks", JSON.stringify(rl && rl.args)); }
  return results;
}

const CR = "checker-rules.mjs", RL = "report-live.mjs";
const MUTANTS = [
  { name: "a WARN finding is dropped", patches: [{ file: CR, from: 'const DEFECT = new Set(["FAIL", "WARN"]);', to: 'const DEFECT = new Set(["FAIL"]);' }], expect: [/^1: exactly the rules with a FAIL or a WARN/] },
  { name: "a status that is no defect is kept", patches: [{ file: CR, from: "DEFECT.has(x.status)", to: "true" }], expect: [/^1: exactly the rules with a FAIL or a WARN/, /^3: no finding that is a defect/] },
  { name: "P0 is mapped to high", patches: [{ file: CR, from: 'P0: "critical"', to: 'P0: "high"' }], expect: [/^1: severity by the table/] },
  { name: "pages are counted per finding", patches: [{ file: CR, from: 'new Set(mine.map((x) => x.page || "site")).size', to: "mine.length" }], expect: [/^1: pages are the distinct pages/] },
  { name: "the ids do not follow the sort", patches: [{ file: CR, from: "b.pages - a.pages", to: "a.pages - b.pages" }], expect: [/^1: the order is severity/] },
  { name: "a fix sentence does not name the rule", patches: [{ file: CR, from: '"Meet " + rule + ": " + text', to: '"Meet: " + text' }], expect: [/^1: fix names the rule/] },
  { name: "causes.json is written when the program throws", patches: [{ file: CR, from: "catch (e) { throw new Stop(\"BLOCKED: the rule program failed", to: "catch (e) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(out + \"/causes.json\", \"[]\"); throw new Stop(\"BLOCKED: the rule program failed" }], expect: [/^4: the program throws/] },
  { name: "report-live prints the whole checklist's count for a program run", patches: [{ file: RL, from: "engine = checkPlan?.engine &&", to: "engine = false &&" }], expect: [/^6: with an engine in plan\.json/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-checker-rules.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "CHECKER RULES", scenarios, MUTANTS, scriptsDir, argv: A }));
}
