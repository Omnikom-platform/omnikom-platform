// Usage: node test-ledger.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of the rule ledger (AB-17): one row per checklist rule in every audit, and no file skipped for size. Temp folders only; no network, no browser, no model.
//   L1  merge.mjs combines the verdict files of two slices into LEDGER.md, ledger.json and a totals line (FAIL beats PASS, N/A, a finding, a W rule ...)
//   L2  an invalid line (a bare PASS, no third column, a made-up verdict word, two verdicts for one id, an unknown id) is NOT CHECKED and merge exits 3
//   L3  a rule missing from one slice, or from every slice: exit 3, the slice and the rule named, "546 of 547"
//   L4  a slice with no verdict file: exit 3, after REPORT.md, causes.json, run-all.mjs and the ledger are written
//   L5  a broken checklist (a small one, merge.mjs --checklist): exit 3
//   L6  checker-rules.mjs (audit-live): a row for every rule, from the program's result (injected io) and from the real program on a real fixture
//   L7  plan.mjs: a 450 KB one-line file and a 300 KB many-line file are cut into chunks that rebuild the original bytes; twins are sent once
//   L8  worker-prompt.md, coordinator.md and modes.md say what workers and the coordinator must do
// The checklist is read here with a reading of our own (not lib-ledger.mjs), so the test does not share its answer with what it checks.
// Mutants: a patch to a copy of the scripts folder must turn the named assertions red.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { checker, main, runner, mkTmp, rmTmp, W as writeFile, J } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const SKILL = path.resolve(here, "..");
const REPO = path.resolve(SKILL, "..", "..");
const rd = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };

// the real checklist, read by this test
const OWN = (() => {
  const dir = path.join(SKILL, "checklist"), out = [];
  for (const n of fs.readdirSync(dir).filter((x) => x.endsWith(".md") && x !== "INDEX.md").sort()) for (const l of rd(path.join(dir, n)).split(/\r?\n/)) { const m = /^- ([A-Z][A-Z0-9]{1,4}-\d{3}) (P0|P1|P2|W)/.exec(l); if (m) out.push({ id: m[1], grade: m[2] }); }
  return out;
})();
const IDS = OWN.map((r) => r.id), N = IDS.length;
const NONW = OWN.filter((r) => r.grade !== "W").map((r) => r.id), WIDS = OWN.filter((r) => r.grade === "W").map((r) => r.id);
const [R1, R2, R3, R4, R5, R6, R7, R8] = NONW, RW = WIDS[0], X = NONW[20];
const EV = { PASS: "src/app.js:12", FAIL: "src/app.js:3", WARN: "src/app.js:5", "NOT CHECKED": "not looked at in this slice", "N/A": "no such code here" };
// a verdict file: over[id] = [verdict, evidence?] | { raw } | null (no line)
const vfile = (over = {}, def = "PASS", ids = IDS) => ids.flatMap((id) => {
  const o = over[id] === undefined ? [def] : over[id];
  if (o === null) return [];
  if (o.raw !== undefined) return [o.raw];
  const list = Array.isArray(o[0]) ? o : [o];
  return list.map(([v, e]) => id + "\t" + v + "\t" + (e ?? EV[v]));
}).join("\n") + "\n";
const HEAD = "| id | severity | file:line | problem | why it matters | fix | check script | root cause |\n|---|---|---|---|---|---|---|---|\n";
const rowsOf = (md) => (md || "").split(/\r?\n/).map((l) => /^\| (\S+) \| (\S+) \| (\S+) \| (PASS|FAIL|WARN|NOT CHECKED|N\/A) \| (.*) \|$/.exec(l)).filter(Boolean).map((m) => ({ rule: m[1], grade: m[2], pack: m[3], verdict: m[4], evidence: m[5] }));

async function scenarios(dir) {
  const results = [], check = checker(results);
  const root = mkTmp("ledger");
  try {
    // the repository's shape: <repo>/skills/<skill>/{scripts,checklist} and <repo>/tools/audit (without its fixtures)
    const repo = path.join(root, "repo"), tree = path.join(repo, "skills", "programmatic-enterprise-web-performance"), S = path.join(tree, "scripts");
    fs.cpSync(dir, S, { recursive: true });
    fs.cpSync(path.join(SKILL, "checklist"), path.join(tree, "checklist"), { recursive: true });
    const auditSrc = path.join(REPO, "tools", "audit");
    fs.cpSync(auditSrc, path.join(repo, "tools", "audit"), { recursive: true, filter: (s) => !/[\\/](fixtures|test|proof)([\\/]|$)/.test(path.relative(auditSrc, s)) });
    const home = path.join(root, "home"); fs.mkdirSync(home, { recursive: true });
    const exec = runner(S, home, path.join(root, "net.log"));
    let n = 0;
    // an audit root: plan.json with the slices, verdict files (null = no file), findings tables
    const mkAudit = (verdicts, findings = {}) => {
      const r = path.join(root, "a" + ++n);
      writeFile(path.join(r, "src/app.js"), "export const a = 1;\n");
      writeFile(path.join(r, ".checks/plan.json"), { slices: Object.keys(verdicts).map((id) => ({ id, files: ["src/app.js"] })), families: [], skipped: { generatedOrBinary: 0, tooLarge: [] } });
      for (const [id, text] of Object.entries(verdicts)) if (text !== null) writeFile(path.join(r, ".checks/verdicts", id + ".tsv"), text);
      for (const [id, rows] of Object.entries(findings)) writeFile(path.join(r, ".checks/findings", id + ".md"), HEAD + rows + "\n");
      return r;
    };
    const merge = async (r, extra = []) => exec("merge.mjs", [r, ...extra]);
    const led = (r) => ({ md: rd(path.join(r, ".checks/LEDGER.md")), json: (() => { try { return J(path.join(r, ".checks/ledger.json")); } catch { return null; } })() });
    const row = (L, id) => rowsOf(L.md).find((x) => x.rule === id);
    const find = (id, problem) => "| " + id + " | high | src/app.js:1 | " + problem + " | why | fix | none (manual) | src/app.js:1 |";

    check("L0: the real checklist has 547 rules by this test's own reading, INDEX.md says 547, a W rule exists", N === 547 && new Set(IDS).size === 547 && /\b547 rules\)/.test(rd(path.join(SKILL, "checklist", "INDEX.md"))) && WIDS.length > 0 && !!X, N + " " + WIDS.length);

    // ---- L1: two slices with complete valid verdicts
    const s1 = vfile({ [R1]: ["FAIL"], [R2]: ["PASS", "check-s01-03.mjs exit 0"], [R3]: ["PASS"], [R4]: ["N/A", "no db code in the s01 files"], [RW]: ["FAIL"], [R6]: ["WARN"] });
    const s2 = vfile({ [R1]: ["PASS"], [R2]: ["N/A"], [R3]: ["NOT CHECKED", "s02 holds only css"], [R4]: ["N/A", "no db code in the s02 files"], [RW]: ["PASS"], [R6]: ["PASS"] });
    const fnd = find("s01-01", R5 + ": the first rule id of this text is the rule it is filed under, " + R7 + " only comes after it") + "\n" + "| s01-02 | rejected (not a defect) | src/app.js:2 | " + R8 + ": wrongly reported | why | fix | none (manual) | src/app.js:2 |";
    const a1 = mkAudit({ s01: s1, s02: s2 }, { s01: fnd });
    const x1 = await merge(a1), L1 = led(a1), rows1 = rowsOf(L1.md);
    const sum1 = L1.json ? Object.values(L1.json.counts).reduce((a, b) => a + b, 0) : -1;
    check("L1: two complete valid slices: exit 0 and no LEDGER FAIL", x1.code === 0 && !/LEDGER FAIL/.test(x1.out), x1.code + " " + x1.out.slice(-500));
    check("L1: LEDGER.md has 547 rows and the totals sum to 547", rows1.length === 547 && sum1 === 547 && L1.json && L1.json.total === 547 && L1.json.indexTotal === 547 && L1.json.rows.length === 547 && L1.json.noRow.length === 0, rows1.length + " rows, counts " + JSON.stringify(L1.json && L1.json.counts));
    check("L1: the totals line is printed, with the counts", x1.out.split(/\r?\n/).includes("LEDGER: 547 of 547 rules have a row: PASS 541, FAIL 2, WARN 2, NOT CHECKED 1, N/A 1") && (L1.md || "").startsWith("LEDGER: 547 of 547 rules have a row: PASS 541, FAIL 2, WARN 2, NOT CHECKED 1, N/A 1\n"), x1.out.slice(-400));
    check("L1: FAIL + PASS is FAIL", row(L1, R1)?.verdict === "FAIL" && /src\/app\.js:3/.test(row(L1, R1).evidence), JSON.stringify(row(L1, R1)));
    check("L1: PASS + N/A is PASS (a check script and its exit is evidence)", row(L1, R2)?.verdict === "PASS" && /check-s01-03\.mjs exit 0/.test(row(L1, R2).evidence), JSON.stringify(row(L1, R2)));
    check("L1: PASS + NOT CHECKED is NOT CHECKED, the reason names the slice and says who passed", row(L1, R3)?.verdict === "NOT CHECKED" && /s02/.test(row(L1, R3).evidence) && /s02 holds only css/.test(row(L1, R3).evidence) && /passed in s01/.test(row(L1, R3).evidence), JSON.stringify(row(L1, R3)));
    check("L1: N/A + N/A is N/A with both reasons", row(L1, R4)?.verdict === "N/A" && /no db code in the s01 files/.test(row(L1, R4).evidence) && /no db code in the s02 files/.test(row(L1, R4).evidence), JSON.stringify(row(L1, R4)));
    check("L1: FAIL on a W rule is WARN", row(L1, RW)?.verdict === "WARN" && row(L1, RW).grade === "W", JSON.stringify(row(L1, RW)));
    check("L1: WARN + PASS is WARN", row(L1, R6)?.verdict === "WARN", JSON.stringify(row(L1, R6)));
    check("L1: a finding naming a rule that every slice called PASS makes it FAIL, with the finding id; the second rule id of the text and a rejected finding change nothing", row(L1, R5)?.verdict === "FAIL" && /s01-01/.test(row(L1, R5).evidence) && row(L1, R7)?.verdict === "PASS" && row(L1, R8)?.verdict === "PASS", JSON.stringify([row(L1, R5), row(L1, R7), row(L1, R8)]));
    check("L1: ledger.json has total, indexTotal, counts, rows, noRow and a report per slice; REPORT.md has the totals line near the top", L1.json && J(path.join(a1, ".checks/ledger.json")).slices.s01.valid === 547 && L1.json.slices.s02.noFile === false && L1.json.slices.s02.invalid.length === 0 && L1.json.slices.s02.missing.length === 0
      && (rd(path.join(a1, ".checks/REPORT.md")) || "").split("\n").slice(0, 6).some((l) => l.startsWith("LEDGER: 547 of 547 rules have a row")), JSON.stringify(L1.json && L1.json.slices));
    check("L1: no 'unexpected files in .checks/' warning for verdicts/, LEDGER.md and ledger.json", !/unexpected files/.test(x1.out), x1.out);

    // ---- L2: invalid lines
    const dup = [["PASS"], ["FAIL"]];
    const a2 = mkAudit({ s01: vfile({ [R1]: { raw: R1 + "\tPASS\tlooks fine to me" }, [R2]: { raw: R2 + "\tPASS" }, [R3]: dup, [R5]: { raw: R5 + "\tMAYBE\tsrc/app.js:1" }, [R6]: ["PASS", ""] }) + "ZZZ-999\tPASS\tsrc/app.js:1\n", s02: vfile() });
    const x2 = await merge(a2), L2 = led(a2);
    check("L2: a bare PASS (no evidence of the shape path:12) is NOT CHECKED with 'invalid line', and merge exits 3 naming the slice", x2.code === 3 && /LEDGER FAIL: .*slice s01/.test(x2.out) && !/slice s02/.test(x2.out) && row(L2, R1)?.verdict === "NOT CHECKED" && /invalid line from s01/.test(row(L2, R1).evidence), x2.code + " " + x2.out.slice(-400) + JSON.stringify(row(L2, R1)));
    check("L2: no third column, two verdicts for one id, a verdict that is not one of the five words, an empty evidence and an unknown id are invalid lines of the slice", L2.json && ["R2", "R3", "R5", "R6"].every((k, i) => row(L2, [R2, R3, R5, R6][i])?.verdict === "NOT CHECKED" && /invalid line from s01/.test(row(L2, [R2, R3, R5, R6][i]).evidence))
      && [R1, R2, R3, R5, R6, "ZZZ-999"].every((id) => L2.json.slices.s01.invalid.includes(id)) && L2.json.slices.s02.invalid.length === 0, JSON.stringify(L2.json && L2.json.slices.s01.invalid));
    check("L2: a rule the other slice passed and this slice made invalid still has a row, and a clean rule stays PASS", row(L2, R4)?.verdict === "PASS" && rowsOf(L2.md).length === 547, JSON.stringify(row(L2, R4)));

    // ---- L3: a rule missing
    const a3 = mkAudit({ s01: vfile({ [X]: null }), s02: vfile() });
    const x3 = await merge(a3), L3 = led(a3);
    check("L3: one rule missing from one slice: exit 3 naming the slice and the rule; the rule is NOT CHECKED 'no verdict from s01'", x3.code === 3 && /LEDGER FAIL: .*slice s01/.test(x3.out) && x3.out.includes(X) && row(L3, X)?.verdict === "NOT CHECKED" && /no verdict from s01/.test(row(L3, X).evidence) && L3.json.slices.s01.missing.join() === X, x3.code + " " + x3.out.slice(-300));
    const a3b = mkAudit({ s01: vfile({ [X]: null }), s02: vfile({ [X]: null }) });
    const x3b = await merge(a3b), L3b = led(a3b);
    check("L3: one rule missing from every slice: exit 3, '546 of 547' and the rule named, no row for it", x3b.code === 3 && x3b.out.includes("LEDGER: 546 of 547 rules have a row") && new RegExp("LEDGER FAIL: .*have no row: [^|\n]*" + X).test(x3b.out) && L3b.json.noRow.join() === X && rowsOf(L3b.md).length === 546, x3b.code + " " + x3b.out.slice(-300));

    // ---- L4: a slice with no verdict file
    const a4 = mkAudit({ s01: vfile(), s02: null });
    const x4 = await merge(a4), L4 = led(a4);
    check("L4: a slice with no verdict file: exit 3 naming it; the ledger says noFile", x4.code === 3 && /LEDGER FAIL: .*slice s02 has no verdict file/.test(x4.out) && L4.json && L4.json.slices.s02.noFile === true && L4.json.slices.s01.noFile === false, x4.code + " " + x4.out.slice(-300));
    check("L4: the exit 3 comes after REPORT.md, causes.json, run-all.mjs, LEDGER.md and ledger.json are written, and REPORT.md carries the LEDGER FAIL line", ["REPORT.md", "causes.json", "run-all.mjs", "LEDGER.md", "ledger.json"].every((f) => fs.existsSync(path.join(a4, ".checks", f))) && /LEDGER FAIL: /.test(rd(path.join(a4, ".checks/REPORT.md")) || ""), fs.readdirSync(path.join(a4, ".checks")).join());

    // ---- L5: a broken checklist (a small one through --checklist)
    const mkCk = (heading, index, packs) => {
      const d = path.join(root, "ck" + ++n);
      writeFile(path.join(d, "INDEX.md"), "# Checklist index (shipgate spec 8.0.0, " + heading + " rules)\n\n" + index.map(([p, c]) => "- " + p + ": " + c + " rules").join("\n") + "\n");
      for (const [p, lines] of Object.entries(packs)) writeFile(path.join(d, p + ".md"), "# " + p + "\n\n" + lines.join("\n") + "\n");
      return d;
    };
    const PA = ["- AAA-001 P0 [x] first", "- BBB-002 W [x] second"], PB = ["- CCC-003 P0† [x] third"];
    const tiny = (ck) => { const r = mkAudit({ s01: vfile({}, "PASS", ["AAA-001", "BBB-002", "CCC-003"]) }); return merge(r, ["--checklist", ck]).then((x) => ({ x, r })); };
    const good = await tiny(mkCk(3, [["a", 2], ["b", 1]], { a: PA, b: PB }));
    check("L5: a small consistent checklist (with a P0† grade) works through --checklist: exit 0, 3 of 3 rows", good.x.code === 0 && good.x.out.includes("LEDGER: 3 of 3 rules have a row: PASS 3, FAIL 0, WARN 0, NOT CHECKED 0, N/A 0"), good.x.code + " " + good.x.out.slice(-300));
    const bad1 = await tiny(mkCk(4, [["a", 2], ["b", 1]], { a: PA, b: PB }));
    check("L5: a checklist whose INDEX.md total differs from its pack lines: exit 3, 'checklist' named", bad1.x.code === 3 && /LEDGER FAIL: .*checklist/.test(bad1.x.out), bad1.x.code + " " + bad1.x.out.slice(-300));
    check("L5: the LEDGER FAIL line also says the rows differ from the INDEX total (the INDEX total check)", /3 rows, INDEX\.md says 4 rules/.test(bad1.x.out), bad1.x.out.slice(-300));
    const bad2 = await tiny(mkCk(3, [["a", 3], ["b", 0]], { a: PA, b: PB }));
    check("L5: a checklist whose per-pack counts differ from its pack lines (the heading total is right): exit 3, 'checklist' named", bad2.x.code === 3 && /LEDGER FAIL: .*checklist is broken: .*pack a/.test(bad2.x.out), bad2.x.code + " " + bad2.x.out.slice(-300));
    const bad3 = await tiny(mkCk(3, [["a", 2], ["b", 1]], { a: PA, b: ["- AAA-001 P1 [x] repeated"] }));
    check("L5: a checklist with an id twice: exit 3, 'checklist' named", bad3.x.code === 3 && /LEDGER FAIL: .*checklist is broken: .*AAA-001/.test(bad3.x.out), bad3.x.code + " " + bad3.x.out.slice(-300));

    // ---- L6: audit-live, checker-rules.mjs
    const mkRun = (h) => { const data = path.join(root, "data" + ++n), base = path.join(data, "site-checks", h);
      writeFile(path.join(base, "snapshots", "2026-10-24", "_site.json"), { finishedAt: "2026-10-24T10:00:00Z", stoppedEarly: null, pages: [{ url: "https://" + h + "/", slug: "home", status: 200 }] });
      return { data, base, out: path.join(base, "work", "checker", ".checks") }; };
    const [PF, PD, PE, PB2, PS] = [NONW[1], NONW[2], NONW[3], NONW[4], NONW[5]];
    const f = (rule, page, line, what, status) => ({ rule, page, line, what, status });
    const FINDS = [f(R1, "/a", 3, "alpha broke", "FAIL"), f(RW, "/a", 4, "w broke", "FAIL"), f(PB2, "/b", 2, "b half", "WARN"), f(PS, "/a", 0, "skipped because the page has no form", "SKIP"), f(PE, "/a", 9, "info only", "INFO")];
    const PROG = [[R1, "P1"], [RW, "W"], [PB2, "P1"], [PS, "P1"], [PD, "P1"], [PE, "P1"], ["QQQ-001", "P1"]].map(([id, severity]) => ({ id, severity, source: "invented", notCovered: [] }));
    const prog = { audit: () => ({ dir: "x", mode: "snapshot", pages: ["/a", "/b"], rules: PROG, findings: FINDS, lines: [], pass: false, exit: 1 }), listRules: () => PROG };
    let lib = null;
    try { lib = await import(pathToFileURL(path.join(S, "checker-rules.mjs")).href + "?" + Math.random()); } catch (e) { check("L6: checker-rules.mjs loads", false, e.message); }
    const r6 = mkRun("l6.example");
    const x6 = lib ? await lib.checkerRules(["https://l6.example/", "--cwd", r6.data], { skillDir: tree, ...prog }) : { code: -1, line: "" };
    const L6 = { md: rd(path.join(r6.out, "LEDGER.md")), json: (() => { try { return J(path.join(r6.out, "ledger.json")); } catch { return null; } })() }, rw6 = rowsOf(L6.md);
    const v6 = (id) => rw6.find((x) => x.rule === id);
    check("L6: checker-rules: exit 0, LEDGER.md and ledger.json hold all 547 rows, the LEDGER line comes with the unchanged CHECKER line", x6.code === 0 && rw6.length === 547 && L6.json && L6.json.rows.length === 547 && L6.json.total === 547 && L6.json.noRow.length === 0
      && x6.ledger === "LEDGER: 547 of 547 rules have a row: PASS 2, FAIL 1, WARN 2, NOT CHECKED 542, N/A 0" && /^CHECKER: 3 causes from 3 findings, 7 of 547 rules checked by program$/.test(x6.line), x6.code + " " + x6.ledger + " | " + x6.line + " rows " + rw6.length);
    check("L6: a program rule with a FAIL is FAIL (a W rule WARN), a WARN finding is WARN", v6(R1)?.verdict === "FAIL" && /alpha|@\/a#3/.test(v6(R1).evidence) && v6(RW)?.verdict === "WARN" && v6(PB2)?.verdict === "WARN", JSON.stringify([v6(R1), v6(RW), v6(PB2)]));
    check("L6: a SKIP is NOT CHECKED 'SKIP: <why>'", v6(PS)?.verdict === "NOT CHECKED" && v6(PS).evidence === "SKIP: skipped because the page has no form", JSON.stringify(v6(PS)));
    check("L6: a program rule with no finding (or only INFO) is PASS with the program's evidence", v6(PD)?.verdict === "PASS" && v6(PD).evidence === "tools/audit rule " + PD + ", 2 pages, exit 1 of the program" && v6(PE)?.verdict === "PASS", JSON.stringify([v6(PD), v6(PE)]));
    check("L6: a rule outside the program is NOT CHECKED 'no program check' (every one of the 541 others)", rw6.filter((x) => ![R1, RW, PB2, PS, PD, PE].includes(x.rule)).every((x) => x.verdict === "NOT CHECKED" && /^no program check in tools\/audit/.test(x.evidence)) && rw6.filter((x) => /^no program check/.test(x.evidence)).length === 541, JSON.stringify(rw6.filter((x) => x.verdict === "NOT CHECKED" && !/^no program check/.test(x.evidence)).slice(0, 2)));
    // a broken checklist: the heading says 548
    const broken = path.join(root, "brokenskill"); fs.cpSync(path.join(tree, "checklist"), path.join(broken, "checklist"), { recursive: true });
    fs.writeFileSync(path.join(broken, "checklist", "INDEX.md"), rd(path.join(broken, "checklist", "INDEX.md")).replace("547 rules)", "548 rules)"));
    const r6b = mkRun("l6b.example"), x6b = lib ? await lib.checkerRules(["https://l6b.example/", "--cwd", r6b.data], { skillDir: broken, ...prog }) : { code: -1, line: "" };
    check("L6: a broken checklist is exit 3 with 'checklist' named and nothing written", x6b.code === 3 && /^BLOCKED: the checklist is broken/.test(x6b.line) && !fs.existsSync(r6b.out), x6b.code + " " + x6b.line);
    // the real program on a real fixture, the real script as a child process
    const r6c = mkRun("fixture-bad.example"); fs.rmSync(path.join(r6c.base, "snapshots"), { recursive: true });
    fs.cpSync(path.join(REPO, "tools", "audit", "fixtures", "snapshot-bad-MET-003"), path.join(r6c.base, "snapshots", "2026-10-30"), { recursive: true });
    const x6c = await exec("checker-rules.mjs", ["https://fixture-bad.example/", "--cwd", r6c.data]), ls6 = x6c.out.trim().split(/\r?\n/), j6 = (() => { try { return J(path.join(r6c.out, "ledger.json")); } catch { return null; } })();
    check("L6: the real program on a real fixture: exit 0, the LEDGER line is printed before the CHECKER line (the last), 547 rows, MET-003 is FAIL", x6c.code === 0 && ls6[ls6.length - 2]?.startsWith("LEDGER: 547 of 547 rules have a row:") && /^CHECKER: /.test(ls6[ls6.length - 1]) && j6 && j6.rows.length === 547 && j6.rows.find((x) => x.rule === "MET-003")?.verdict === "FAIL", x6c.code + " " + x6c.out.slice(-400));

    // ---- L7: plan.mjs, no file skipped for size
    const pr = path.join(root, "planrepo"), pw = (rel, buf) => { fs.mkdirSync(path.dirname(path.join(pr, rel)), { recursive: true }); fs.writeFileSync(path.join(pr, rel), buf); };
    const big1 = Buffer.from("x" + "é".repeat(230400), "utf8");   // one line, 460801 bytes; 204800 falls inside a two-byte character
    const manyLines = []; for (let i = 0; manyLines.join("\n").length < 300 * 1024 - 5000; i++) manyLines.push(i % 400 === 7 ? ("long " + i + " " + "€".repeat(2500)) : "line " + i + " " + "word ".repeat(i % 9) + (i % 5 === 0 ? "\r" : ""));
    const big2 = Buffer.from(manyLines.join("\n") + "\n", "utf8");
    pw("assets/v4/map1.js", big1); pw("assets/v4/map2.js", big2); pw("assets/v4/map2b.js", big2);
    pw("about.html", "<!doctype html><html><head><title>About</title></head><body><p>x</p></body></html>"); pw("copy/about.html", "<!doctype html><html><head><title>About</title></head><body><p>x</p></body></html>");
    pw("src/app.js", "export const a = 1;\n");
    const pl = spawnSync(process.execPath, [path.join(S, "plan.mjs"), pr], { encoding: "utf8", timeout: 120000 });
    const plan = (() => { try { return J(path.join(pr, ".checks/plan.json")); } catch { return null; } })();
    check("L7: plan.mjs ran, plan.json has no tooLarge entry (an empty list stays) and no slice names a big file", pl.status === 0 && plan && Array.isArray(plan.skipped?.tooLarge) && plan.skipped.tooLarge.length === 0 && !plan.slices.some((s) => s.files.some((x) => /map[12]b?\.js$/.test(x) && !x.startsWith(".checks/chunks/"))) && !/over 200 KB \(not checked\)|too large to read/.test(pl.stdout), pl.status + " " + pl.stdout + pl.stderr);
    const parts = (name, count) => Array.from({ length: count }, (_, i) => path.join(pr, ".checks/chunks", name + ".part" + (i + 1) + "-of-" + count + ".txt"));
    const rebuild = (orig, name, count) => {
      const out = Buffer.alloc(orig.length, 10); let ok = true, maxLen = 0, headers = [];
      for (const p of parts(name, count)) {
        const t = rd(p); if (t === null) { ok = false; continue; }
        const ls = t.split("\n"); headers.push(ls[0]);
        for (const l of ls.slice(1)) { if (l === "") continue; const m = /^@(\d+) ([\s\S]*)$/.exec(l); if (!m) { ok = false; continue; } maxLen = Math.max(maxLen, m[2].length); Buffer.from(m[2], "utf8").copy(out, Number(m[1])); }
      }
      return { same: ok && Buffer.compare(out, orig) === 0, maxLen, headers };
    };
    const b1 = rebuild(big1, "assets__v4__map1.js", 3), b2 = rebuild(big2, "assets__v4__map2.js", 2);
    check("L7: the chunks of both big files, rebuilt from their @offsets, equal the original bytes exactly (a character cut in two would show)", b1.same && b2.same, JSON.stringify([b1.same, b2.same]));
    check("L7: every chunk line holds at most 1000 characters after its prefix, and the first line is 'PEWP CHUNK <file> bytes <a>-<b> of <size> (part i of n)'", b1.maxLen > 0 && b1.maxLen <= 1000 && b2.maxLen <= 1000 && b2.maxLen > 900 && /^PEWP CHUNK assets\/v4\/map1\.js bytes 0-\d+ of 460801 \(part 1 of 3\)$/.test(b1.headers[0] || "") && /^PEWP CHUNK assets\/v4\/map2\.js bytes \d+-\d+ of \d+ \(part 2 of 2\)$/.test(b2.headers[1] || ""), JSON.stringify([b1.maxLen, b2.maxLen, b1.headers[0], b2.headers[1]]));
    const cs = plan ? plan.slices.filter((s) => s.chunk) : [];
    const cut = (s) => [s.chunk.from, s.chunk.to];
    check("L7: each chunk is a slice of its own (3 + 2), at most the 200 KB budget, contiguous, never ending inside a UTF-8 character", cs.length === 5 && cs.every((s) => s.files.length === 1 && /^\.checks\/chunks\//.test(s.files[0]) && s.chunk.to - s.chunk.from <= 200 * 1024)
      && cs.filter((s) => s.chunk.file === "assets/v4/map1.js").every((s, i, a) => s.chunk.from === (i ? a[i - 1].chunk.to : 0) && (s.chunk.to === big1.length || (big1[s.chunk.to] & 0xc0) !== 0x80)) && cs.filter((s) => s.chunk.file === "assets/v4/map1.js").slice(-1)[0].chunk.to === big1.length && new Set(plan.slices.map((s) => s.id)).size === plan.slices.length, JSON.stringify(cs.map(cut)));
    check("L7: byte-identical twins are sent once and recorded in duplicates (the small page and the big file)", plan && JSON.stringify(plan.duplicates) === JSON.stringify([{ sent: "about.html", sameAs: ["copy/about.html"] }, { sent: "assets/v4/map2.js", sameAs: ["assets/v4/map2b.js"] }]) && !plan.slices.some((s) => s.files.includes("copy/about.html") || (s.chunk && s.chunk.file === "assets/v4/map2b.js")), JSON.stringify(plan && plan.duplicates));

    // ---- L8: the words workers and the coordinator are given
    const wp = rd(path.join(SKILL, "worker-prompt.md")) || "", co = rd(path.join(SKILL, "coordinator.md")) || "", mo = rd(path.join(SKILL, "modes.md")) || "";
    check("L8: worker-prompt.md names .checks/verdicts/, the five verdict words, the evidence rule, the NOT CHECKED reason and the chunk", /\.checks\/verdicts\/\{\{SLICE\}\}\.tsv/.test(wp) && ["PASS", "FAIL", "WARN", "NOT CHECKED", "N/A"].every((w) => wp.includes(w)) && /file:line/.test(wp) && /check script and its exit/.test(wp) && /needs its reason/.test(wp) && /EVERY rule/.test(wp) && /CHUNK/.test(wp) && /byte offset/.test(wp), "");
    check("L8: coordinator.md names LEDGER.md, exit 3 and the re-launch of the named slices; modes.md lists LEDGER.md for audit-repo", /LEDGER\.md/.test(co) && /exit 3/.test(co) && /--only/.test(co) && /LEDGER FAIL/.test(co) && /audit-repo[^\n]*LEDGER\.md/.test(mo), "");
  } finally { rmTmp(root); }
  return results;
}

const MUTANTS = [
  { name: "FAIL no longer beats PASS", patches: [{ file: "lib-ledger.mjs", from: 'if (of("FAIL").length || findingIds.length) return', to: 'if ((of("FAIL").length && !of("PASS").length) || findingIds.length) return' }], expect: [/^L1: FAIL \+ PASS is FAIL/] },
  { name: "a bare PASS accepted", patches: [{ file: "lib-ledger.mjs", from: 'else if (!ev) why = id + ": " + verdict + " has no " + (NEEDS_EVIDENCE.has(verdict) ? "evidence" : "reason");', to: "" }, { file: "lib-ledger.mjs", from: "else if (NEEDS_EVIDENCE.has(verdict) && !evidenceOk(ev)) why =", to: "else if (false) why =" }], expect: [/^L2: a bare PASS/, /^L2: no third column/] },
  { name: "the no-row check removed", patches: [{ file: "lib-ledger.mjs", from: "if (l.noRow.length) out.push(", to: "if (false) out.push(" }], expect: [/^L3: one rule missing from every slice/] },
  { name: "the incomplete-slice exit removed", patches: [{ file: "lib-ledger.mjs", from: "for (const [id, s] of Object.entries(l.slices)) {", to: "for (const [id, s] of Object.entries({})) {" }], expect: [/^L2: a bare PASS/, /^L3: one rule missing from one slice/, /^L4: a slice with no verdict file/] },
  { name: "the INDEX total check removed", patches: [{ file: "lib-ledger.mjs", from: "if (l.indexTotal !== null && l.rows.length !== l.indexTotal) out.push(", to: "if (false) out.push(" }], expect: [/^L5: the LEDGER FAIL line also says/] },
  { name: "a broken checklist is accepted", patches: [{ file: "lib-ledger.mjs", from: "if (ck.broken) out.push(", to: "if (false) out.push(" }], expect: [/^L5: a checklist whose per-pack counts/] },
  { name: "the size skip is restored", patches: [{ file: "plan.mjs", from: "try { size = fs.statSync(path.join(root, f)).size; } catch { continue; }", to: "try { size = fs.statSync(path.join(root, f)).size; } catch { continue; }\n  if (size > MAX_FILE) { skipped.tooLarge.push(f); continue; }" }], expect: [/^L7: plan\.mjs ran/, /^L7: the chunks of both big files/] },
  { name: "a chunk may end inside a character", patches: [{ file: "plan.mjs", from: "while (b < buf.length && b > a && (buf[b] & 0xc0) === 0x80) b--;", to: "" }], expect: [/^L7: the chunks of both big files/, /^L7: each chunk is a slice of its own/] },
  { name: "a rule outside the program becomes PASS (checker-rules)", patches: [{ file: "checker-rules.mjs", from: 'rows.push({ rule: r.id, verdict: "NOT CHECKED", evidence: NO_PROGRAM }); continue; }', to: 'rows.push({ rule: r.id, verdict: "PASS", evidence: NO_PROGRAM }); continue; }' }], expect: [/^L6: a rule outside the program/, /^L6: checker-rules: exit 0/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-ledger.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "LEDGER", scenarios, MUTANTS, scriptsDir, argv: A }));
}
