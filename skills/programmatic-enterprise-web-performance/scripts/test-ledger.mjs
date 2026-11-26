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
//   L9  (T1) the order FAIL > WARN > PASS > N/A > BLOCKED > NOT CHECKED; a PASS beats a NOT CHECKED on an html/http/browser rule only with a
//       check script whose first line is "<n> pages" equal to the root's page count, else WARN "sampled N of M"
//   L10 (T2) evidence: path:N exists, N within the file, a quote of at most 80 characters found on line N; root A cites _source, not a bundle;
//       a cited check script exists, exits as cited, prints the rule id and exits 2 on an empty root; an online check-x- script is not re-run
//       and is valid only with its log (last line "exit N") hashed in logs/runs.tsv
//   L11 (T3) --with <root-b>: root B's verdicts, findings (B-) and scripts; x-*.tsv slices need no line per rule; an unknown flag exits 2
//   L12 (T4) BLOCKED: kept verbatim; --proof exits 3 on a NOT CHECKED that is not BLOCKED, an unblocks naming a tool we have, a BLOCKED id
//       not in <proof>/head/blocked-allowed.tsv; a second line "BLOCKED: b (ids ...)"
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
  for (const n of fs.readdirSync(dir).filter((x) => x.endsWith(".md") && x !== "INDEX.md").sort()) for (const l of rd(path.join(dir, n)).split(/\r?\n/)) { const m = /^- ([A-Z][A-Z0-9]{1,4}-\d{3}) (P0|P1|P2|W)/.exec(l); if (m) out.push({ id: m[1], grade: m[2], page: /^(html|http|browser)$/m.test(((/\[([^\]]*)\]/.exec(l) || [])[1] || "").split(/,\s*/).join("\n")) }); }
  return out;
})();
const IDS = OWN.map((r) => r.id), N = IDS.length;
const NONW = OWN.filter((r) => r.grade !== "W").map((r) => r.id), WIDS = OWN.filter((r) => r.grade === "W").map((r) => r.id);
const [R1, R2, R3, R4, R5, R6, R7, R8] = NONW, RW = WIDS[0], X = NONW[20];
// T1-T4 rules: page rules (an html, http or browser kind) and rules without one, none of them used above
const USED = new Set([R1, R2, R3, R4, R5, R6, R7, R8, RW, X]);
const PG = OWN.filter((r) => r.grade !== "W" && r.page && !USED.has(r.id)).map((r) => r.id), NP = OWN.filter((r) => r.grade !== "W" && !r.page && !USED.has(r.id)).map((r) => r.id);
// evidence: a file:line and a quote from that line (src/app.js has 12 lines, line n reads "// line n")
const EV = { PASS: 'src/app.js:12 "line 12"', FAIL: 'src/app.js:3 "line 3"', WARN: 'src/app.js:5 "line 5"', "NOT CHECKED": "not looked at in this slice", "N/A": "no such code here" };
const APP = ["export const a = 1;", ...Array.from({ length: 11 }, (_, i) => "// line " + (i + 2))].join("\n") + "\n";
// a check script that prints the rule id; exit 2 when the root has no src/app.js (an empty root), else the given exit; pages = a first "<n> pages" line
const SCRIPT = (rule, exit = 0, pages = null) => 'import fs from "node:fs"; import path from "node:path";\nconst root = process.argv[2] || ".";\n'
  + 'if (!fs.existsSync(path.join(root, "src/app.js"))) { console.log("ERROR ' + rule + ' cannot judge"); process.exit(2); }\n'
  + (pages !== null ? 'console.log("' + pages + ' pages");\n' : "") + 'console.log("' + (exit ? "FAIL " : "PASS ") + rule + '"); process.exit(' + exit + ');\n';
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
    const mkAudit = (verdicts, findings = {}, at = null) => {
      const r = at || path.join(root, "a" + ++n);
      writeFile(path.join(r, "src/app.js"), APP);
      writeFile(path.join(r, ".checks/scripts/check-s01-03.mjs"), SCRIPT(R2));
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
    check("L1: the totals line is printed, with the counts", x1.out.split(/\r?\n/).includes("LEDGER: 547 of 547 rules have a row: PASS 541, FAIL 2, WARN 3, NOT CHECKED 0, N/A 1") && (L1.md || "").startsWith("LEDGER: 547 of 547 rules have a row: PASS 541, FAIL 2, WARN 3, NOT CHECKED 0, N/A 1\n"), x1.out.slice(-400));
    check("L1: FAIL + PASS is FAIL", row(L1, R1)?.verdict === "FAIL" && /src\/app\.js:3/.test(row(L1, R1).evidence), JSON.stringify(row(L1, R1)));
    check("L1: PASS + N/A is PASS (a check script and its exit is evidence)", row(L1, R2)?.verdict === "PASS" && /check-s01-03\.mjs exit 0/.test(row(L1, R2).evidence), JSON.stringify(row(L1, R2)));
    check("L1: PASS + NOT CHECKED on a browser rule (no all-pages script) is WARN 'sampled 1 of 2', the reason names the slice and says who passed", row(L1, R3)?.verdict === "WARN" && /^sampled 1 of 2\b/.test(row(L1, R3).evidence) && /s02/.test(row(L1, R3).evidence) && /s02 holds only css/.test(row(L1, R3).evidence) && /passed in s01/.test(row(L1, R3).evidence), JSON.stringify(row(L1, R3)));
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

    // ---- L9 (T1): FAIL > WARN > PASS > N/A > BLOCKED > NOT CHECKED; a page rule's PASS over a NOT CHECKED needs an all-pages script
    const [NP1, NP2] = NP, [PG1, PG2, PG3, PG4] = PG;
    const BLK = "BLOCKED: the registrar page needs a login | unblocks: the owner reads the registrar page | tried: rdap.mjs exit 1; whois.txt:3";
    const notHere = ["NOT CHECKED", "not in this slice"];
    const a9 = mkAudit({
      s01: vfile({ [NP1]: ["PASS"], [NP2]: ["N/A", "no db code in the s01 files"], [PG1]: ["PASS", "check-s01-07.mjs exit 0"], [PG2]: ["PASS", "check-s01-08.mjs exit 0"], [PG3]: ["PASS"], [PG4]: ["NOT CHECKED", BLK] }),
      s02: vfile({ [NP1]: notHere, [NP2]: notHere, [PG1]: notHere, [PG2]: notHere, [PG3]: notHere, [PG4]: notHere }) });
    writeFile(path.join(a9, "index.html"), "<p>home</p>\n"); writeFile(path.join(a9, "about/index.html"), "<p>about</p>\n");
    writeFile(path.join(a9, ".checks/scripts/check-s01-07.mjs"), SCRIPT(PG1, 0, 2)); writeFile(path.join(a9, ".checks/scripts/check-s01-08.mjs"), SCRIPT(PG2, 0, 1));
    const x9 = await merge(a9), L9 = led(a9);
    check("L9: PASS beats another slice's NOT CHECKED on a rule with no html, http or browser kind (exit 0)", x9.code === 0 && row(L9, NP1)?.verdict === "PASS", x9.code + " " + x9.out.slice(-300) + JSON.stringify(row(L9, NP1)));
    check("L9: N/A beats another slice's NOT CHECKED on a rule with no html, http or browser kind", row(L9, NP2)?.verdict === "N/A", JSON.stringify(row(L9, NP2)));
    check("L9: a page rule's PASS beats NOT CHECKED when its check script's first line is '<n> pages' equal to the root's page count: PASS 'covers 2 of 2 pages'", row(L9, PG1)?.verdict === "PASS" && /covers 2 of 2 pages/.test(row(L9, PG1).evidence), JSON.stringify(row(L9, PG1)));
    check("L9: a page rule's PASS over NOT CHECKED with a script that prints '1 pages' (the root has 2) is WARN 'sampled 1 of 2'", row(L9, PG2)?.verdict === "WARN" && /^sampled 1 of 2\b/.test(row(L9, PG2).evidence), JSON.stringify(row(L9, PG2)));
    check("L9: a page rule's PASS with a file:line only, over NOT CHECKED, is WARN 'sampled 1 of 2'", row(L9, PG3)?.verdict === "WARN" && /^sampled 1 of 2\b/.test(row(L9, PG3).evidence), JSON.stringify(row(L9, PG3)));
    check("L9: BLOCKED beats NOT CHECKED: the row is NOT CHECKED and its reason is the BLOCKED text verbatim, with no prefix", row(L9, PG4)?.verdict === "NOT CHECKED" && L9.json?.rows.find((x) => x.rule === PG4)?.evidence === BLK, JSON.stringify(L9.json?.rows.find((x) => x.rule === PG4)));

    // ---- L10 (T2): evidence that does not hold is an invalid line
    const E = NP.slice(2, 20);
    const a10 = mkAudit({ s01: vfile({
      [E[0]]: ["PASS", 'src/app.js:99 "line 3"'], [E[1]]: ["PASS", "src/app.js:3"], [E[2]]: ["PASS", 'src/app.js:3 "line 4"'], [E[3]]: ["PASS", 'src/app.js:3 "' + "x".repeat(81) + '"'],
      [E[4]]: ["PASS", 'src/gone.js:1 "x"'], [E[5]]: ["PASS", 'page.html:1 "<a href="/x/">x</a>"'], [E[6]]: ["PASS", "check-s01-20.mjs exit 0"], [E[7]]: ["PASS", "check-s01-21.mjs exit 0"],
      [E[8]]: ["PASS", "check-s01-22.mjs exit 0"], [E[9]]: ["PASS", "check-s01-23.mjs exit 0"], [E[10]]: ["PASS", "check-x-net.mjs exit 0"], [E[11]]: ["PASS", "check-x-other.mjs exit 0"], [E[14]]: ["PASS", 'page.html:1 "<p>see <a href="made-up-text</a>"'] }), s02: vfile(Object.fromEntries(E.map((id) => [id, notHere]))) }, {}, path.join(root, "c10", "root-a"));
    writeFile(path.join(a10, "page.html"), '<p>see <a href="/x/">x</a></p>\n');
    writeFile(path.join(a10, ".checks/scripts/check-s01-21.mjs"), SCRIPT(E[7], 1));
    writeFile(path.join(a10, ".checks/scripts/check-s01-22.mjs"), SCRIPT(PG1, 0));
    writeFile(path.join(a10, ".checks/scripts/check-s01-23.mjs"), 'console.log("PASS ' + E[9] + '"); process.exit(0);\n');
    const ONLINE = 'import fs from "node:fs"; fs.writeFileSync((process.argv[2] || ".") + "/ran-" + process.pid + ".txt", "x"); console.log("PASS"); process.exit(0);\n';
    writeFile(path.join(a10, ".checks/scripts/check-x-net.mjs"), ONLINE); writeFile(path.join(a10, ".checks/scripts/check-x-other.mjs"), ONLINE);
    const logs10 = path.join(root, "c10", "logs"), netLog = "GET https://example.test/ 200\nexit 0\n";
    writeFile(path.join(logs10, "check-x-net.log"), netLog); writeFile(path.join(logs10, "check-x-other.log"), netLog + " ");
    const { createHash } = await import("node:crypto");
    writeFile(path.join(logs10, "runs.tsv"), createHash("sha256").update(netLog).digest("hex") + "\tlogs/check-x-net.log\n");
    const x10 = await merge(a10), L10 = led(a10);
    const bad10 = (i, re) => row(L10, E[i])?.verdict === "NOT CHECKED" && /invalid line from s01/.test(row(L10, E[i]).evidence) && re.test(row(L10, E[i]).evidence);
    const show10 = (i) => JSON.stringify(row(L10, E[i])) + " exit " + x10.code;
    check("L10: a path:N past the end of the file is an invalid line (merge exits 3)", x10.code === 3 && bad10(0, /past the end/), show10(0));
    check("L10: a path:N with no quote is an invalid line", bad10(1, /no quote/), show10(1));
    check("L10: a quote that is not on line N is an invalid line", bad10(2, /not on that line/), show10(2));
    check("L10: a quote over 80 characters is an invalid line", bad10(3, /80 characters/), show10(3));
    check("L10: a path that does not exist under the root is an invalid line", bad10(4, /does not exist/), show10(4));
    check("L10: a quote that holds double quotes, found on its line, is valid (PASS)", row(L10, E[5])?.verdict === "PASS", show10(5));
    check("L10: a quote whose text after an inner double quote is not on the line is an invalid line", bad10(14, /not on that line/), show10(14));
    check("L10: a cited check script that does not exist is an invalid line", bad10(6, /not in \.checks\/scripts/), show10(6));
    check("L10: a cited check script that exits otherwise than cited is an invalid line", bad10(7, /exits 1, not 0/), show10(7));
    check("L10: a cited check script that does not print the rule id is an invalid line", bad10(8, /does not print/), show10(8));
    check("L10: a check script that exits 0 or 1 on an empty root is vacuous: its line is invalid", bad10(9, /empty root/), show10(9));
    check("L10: an online check-x- script is not re-run by merge and is valid with its log (last line 'exit 0') hashed in logs/runs.tsv", row(L10, E[10])?.verdict === "PASS" && !fs.readdirSync(a10).some((f) => /^ran-/.test(f)), show10(10) + " " + fs.readdirSync(a10).join());
    check("L10: an online check-x- script whose log is not hashed in logs/runs.tsv is an invalid line", bad10(11, /runs\.tsv/), show10(11));
    const a10b = mkAudit({ s01: vfile({ [E[12]]: ["PASS", 'assets/app.min.js:1 "var a"'], [E[13]]: ["PASS", '_source/src/app.js:2 "line 2"'] }, "N/A"), s02: vfile({ [E[12]]: notHere, [E[13]]: notHere }, "N/A") });
    writeFile(path.join(a10b, "assets/app.min.js"), "var a=1;\n"); writeFile(path.join(a10b, "_source/src/app.js"), APP);
    const x10b = await merge(a10b), L10b = led(a10b);
    check("L10: with a _source folder, a citation of a script or style outside it (a bundle) is an invalid line; a _source citation is valid", row(L10b, E[12])?.verdict === "NOT CHECKED" && /_source/.test(row(L10b, E[12]).evidence) && row(L10b, E[13])?.verdict === "PASS", x10b.code + " " + JSON.stringify([row(L10b, E[12]), row(L10b, E[13])]));

    // ---- L11 (T3): --with root B, x- slices, flags
    const [F1, F2, F3] = NP.slice(20, 23), cyc = path.join(root, "cycle-1");
    const a11 = mkAudit({ s01: vfile() }, {}, path.join(cyc, "root-a"));
    const b11 = mkAudit({ s01: vfile({ [F1]: ["FAIL", 'src/b-only.js:1 "b line"'] }) }, { s01: "| s01-01 | high | src/b-only.js:1 | " + F2 + ": a finding of root B | why | fix | check-s01-01.mjs | src/b-only.js:1 |" }, path.join(cyc, "root-b"));
    writeFile(path.join(b11, "src/b-only.js"), "b line\n");
    writeFile(path.join(b11, ".checks/scripts/check-s01-01.mjs"), 'import fs from "node:fs";\nif (!fs.existsSync((process.argv[2] || ".") + "/src/b-only.js")) { console.log("ERROR cannot judge"); process.exit(2); }\nconsole.log("FAIL ' + F2 + ' still there"); process.exit(1);\n');
    writeFile(path.join(a11, ".checks/verdicts/x-absent.tsv"), F3 + '\tFAIL\tsrc/app.js:3 "line 3"\n');
    const x11 = await exec("merge.mjs", ["--with", b11, a11]), L11 = led(a11), rep11 = rd(path.join(a11, ".checks/REPORT.md")) || "";
    check("L11: --with root B (given before root A): the ledger is root A's, with slices s01 and B-s01; root B's FAIL (path:N read under root B) is the row", x11.code === 0 && L11.json && "B-s01" in L11.json.slices && row(L11, F1)?.verdict === "FAIL" && !fs.existsSync(path.join(b11, ".checks/LEDGER.md")), x11.code + " " + x11.out.slice(-400) + JSON.stringify(row(L11, F1)));
    check("L11: root B's findings get ids B-, its scripts run against root B ('open'), and the finding makes its rule FAIL", /\| B-s01-01 \|[^\n]*\| open \|/.test(rep11) && row(L11, F2)?.verdict === "FAIL" && /B-s01-01/.test(row(L11, F2).evidence), rep11.split("\n").filter((l) => /s01-01/.test(l)).join(" / ") + JSON.stringify(row(L11, F2)));
    check("L11: an x-*.tsv slice with one line is not missing the other rules, and its FAIL counts", !/x-absent/.test(x11.out) && row(L11, F3)?.verdict === "FAIL", x11.out.slice(-300) + JSON.stringify(row(L11, F3)));
    const a11b = mkAudit({ s01: vfile() });
    writeFile(path.join(a11b, ".checks/verdicts/x-bad.tsv"), F3 + "\tPASS\tlooks fine\n");
    const x11b = await merge(a11b);
    check("L11: an invalid line in an x-*.tsv still exits 3, naming that slice", x11b.code === 3 && /LEDGER FAIL: .*slice x-bad/.test(x11b.out), x11b.code + " " + x11b.out.slice(-300));
    const a11c = mkAudit({ s01: vfile() }), x11c = await merge(a11c, ["--frobnicate"]);
    check("L11: an unknown flag exits 2, naming it, and writes no ledger", x11c.code === 2 && /--frobnicate/.test(x11c.out) && !fs.existsSync(path.join(a11c, ".checks/LEDGER.md")), x11c.code + " " + x11c.out.slice(-300));

    // ---- L12 (T4): BLOCKED and --proof
    const [B1, B2, B3, B4, B5, B6] = NP.slice(23, 29), proof = path.join(root, "proof");
    const blk = (what, unblocks, tried = "rdap.mjs exit 1; whois.txt:3") => "BLOCKED: " + what + " | unblocks: " + unblocks + " | tried: " + tried;
    writeFile(path.join(proof, "head", "blocked-allowed.tsv"), B1 + "\towner\n" + B2 + "\towner\n" + B3 + "\towner\n" + B5 + "\towner\n" + B6 + "\towner\n");
    const a12 = mkAudit({ s01: vfile({ [B1]: ["NOT CHECKED", blk("registrar data", "the owner reads the registrar page")] }) }, {}, path.join(proof, "cycle-1", "root-a"));
    const x12 = await merge(a12, ["--proof"]), o12 = x12.out.split(/\r?\n/);
    check("L12: --proof with one allowed BLOCKED row: exit 0, the LEDGER line as it is, then 'BLOCKED: 1 (ids ...)'", x12.code === 0 && o12.includes("LEDGER: 547 of 547 rules have a row: PASS 546, FAIL 0, WARN 0, NOT CHECKED 1, N/A 0") && o12[o12.indexOf("LEDGER: 547 of 547 rules have a row: PASS 546, FAIL 0, WARN 0, NOT CHECKED 1, N/A 0") + 1] === "BLOCKED: 1 (ids " + B1 + ")", x12.code + " " + x12.out.slice(-400));
    const a12b = mkAudit({ s01: vfile({ [B1]: ["NOT CHECKED", blk("registrar data", "the owner reads the registrar page")], [B2]: ["NOT CHECKED", blk("x", "y", "rdap.mjs exit 1;;")], [B6]: ["NOT CHECKED", blk("x", "y", "rdap.mjs exit 1; asked the owner")], [B3]: ["NOT CHECKED", blk("lab numbers", "run psi.mjs with the key")],
      [B4]: ["NOT CHECKED", blk("registrar data", "the owner reads it")], [B5]: ["NOT CHECKED", "not in this slice"] }) }, {}, path.join(proof, "cycle-2", "root-a"));
    const x12b = await merge(a12b, ["--proof"]), fail12 = (x12b.out.match(/LEDGER FAIL: [^\n]*/) || [""])[0];
    check("L12: a BLOCKED reason with one tried approach is not BLOCKED: --proof exits 3 naming the rule", x12b.code === 3 && new RegExp(B2 + "[^|]*not BLOCKED").test(fail12), x12b.code + " " + fail12);
    check("L12: a BLOCKED reason with two approaches, one without 'exit N' or path:N, is not BLOCKED: --proof exits 3 naming the rule", new RegExp(B6 + "[^|]*not BLOCKED").test(fail12), fail12);
    check("L12: a NOT CHECKED that is not BLOCKED: --proof exits 3 naming the rule", new RegExp(B5 + "[^|]*not BLOCKED").test(fail12), fail12);
    check("L12: an unblocks that names a tool we have (psi): --proof exits 3 naming the rule", new RegExp(B3 + "[^|]*a tool we have").test(fail12), fail12);
    check("L12: a BLOCKED id not in head/blocked-allowed.tsv: --proof exits 3 naming the rule", new RegExp(B4 + "[^|]*blocked-allowed").test(fail12) && !new RegExp(B1 + "\\b").test(fail12), fail12);
    const x12c = await merge(a12b);
    check("L12: without --proof the same rows give no proof failure and no BLOCKED line", x12c.code === 0 && !/BLOCKED: \d/.test(x12c.out), x12c.code + " " + x12c.out.slice(-300));

    // ---- L8: the words workers and the coordinator are given
    const wp = rd(path.join(SKILL, "worker-prompt.md")) || "", co = rd(path.join(SKILL, "coordinator.md")) || "", mo = rd(path.join(SKILL, "modes.md")) || "";
    check("L8: worker-prompt.md names .checks/verdicts/, the five verdict words, the evidence rule, the NOT CHECKED reason and the chunk", /\.checks\/verdicts\/\{\{SLICE\}\}\.tsv/.test(wp) && ["PASS", "FAIL", "WARN", "NOT CHECKED", "N/A"].every((w) => wp.includes(w)) && /file:line/.test(wp) && /check script and its exit/.test(wp) && wp.includes("Never write N/A because your slice lacks the artefact; write NOT CHECKED<TAB>not in this slice. A check script over pages prints `<n> pages` as its first line.") && /EVERY rule/.test(wp) && /CHUNK/.test(wp) && /byte offset/.test(wp), "");
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

// VTV-PROOF T1-T4 mutants: { name, patches: [{ file, from, to }], expect: [regex source] }
MUTANTS.push(...[{"name":"a PASS no longer beats a NOT CHECKED","patches":[{"file":"lib-ledger.mjs","from":"const win = of(\"PASS\").length ? \"PASS\" : \"N/A\", wins = of(win);","to":"const win = of(\"PASS\").length ? \"PASS\" : \"N/A\", wins = of(win); if (win === \"PASS\") return { verdict: \"NOT CHECKED\", evidence: ncWhy };"}],"expect":["^L9: PASS beats another slice's NOT CHECKED"]},
  {"name":"an N/A no longer beats a NOT CHECKED","patches":[{"file":"lib-ledger.mjs","from":"const win = of(\"PASS\").length ? \"PASS\" : \"N/A\", wins = of(win);","to":"const win = of(\"PASS\").length ? \"PASS\" : \"N/A\", wins = of(win); if (win === \"N/A\") return { verdict: \"NOT CHECKED\", evidence: ncWhy };"}],"expect":["^L9: N/A beats another slice's NOT CHECKED"]},
  {"name":"a page rule passes over NOT CHECKED without covering every page","patches":[{"file":"lib-ledger.mjs","from":"if (!opts.page) return { verdict: win, evidence: ev(wins) };","to":"if (true) return { verdict: win, evidence: ev(wins) };"}],"expect":["^L9: a page rule's PASS with a file:line only","^L1: PASS \\+ NOT CHECKED on a browser rule","^L1: the totals line"]},
  {"name":"the page count is not compared","patches":[{"file":"lib-ledger.mjs","from":"const full = cov.find((c) => c.n > 0 && c.n === c.m);","to":"const full = cov.find((c) => c.n > 0);"}],"expect":["^L9: a page rule's PASS over NOT CHECKED with a script that prints '1 pages'"]},
  {"name":"the '<n> pages' line is not read","patches":[{"file":"merge.mjs","from":"pages = /^(\\d+) pages$/.exec(outLines[0] || \"\");","to":"pages = null;"}],"expect":["^L9: a page rule's PASS beats NOT CHECKED when its check script"]},
  {"name":"BLOCKED does not beat NOT CHECKED","patches":[{"file":"lib-ledger.mjs","from":"if (b) return { verdict: \"NOT CHECKED\", evidence: b.evidence };","to":"if (false) return { verdict: \"NOT CHECKED\", evidence: b.evidence };"}],"expect":["^L9: BLOCKED beats NOT CHECKED"]},
  {"name":"a path:N past the end is accepted","patches":[{"file":"lib-ledger.mjs","from":"if (n < 1 || n > lines.length) return","to":"if (n < 1) return"}],"expect":["^L10: a path:N past the end"]},
  {"name":"a citation needs no quote","patches":[{"file":"lib-ledger.mjs","from":"if (!q) return all + \" has no quote of its line in double quotes\";","to":"if (!q) continue;"}],"expect":["^L10: a path:N with no quote"]},
  {"name":"a quote need not be on its line","patches":[{"file":"lib-ledger.mjs","from":"if (lines[n - 1].includes(body.slice(0, i))) found = i;","to":"found = i;"}],"expect":["^L10: a quote that is not on line N"]},
  {"name":"a quote may be 800 characters","patches":[{"file":"lib-ledger.mjs","from":"i <= Math.min(80, body.length - 1)","to":"i <= Math.min(800, body.length - 1)"}],"expect":["^L10: a quote over 80 characters"]},
  {"name":"a cited path need not exist","patches":[{"file":"lib-ledger.mjs","from":"if (path.relative(root, f).startsWith(\"..\") || !fs.existsSync(f) || !fs.statSync(f).isFile()) return p + \" does not exist under the root\";","to":"if (path.relative(root, f).startsWith(\"..\") || !fs.existsSync(f) || !fs.statSync(f).isFile()) continue;"}],"expect":["^L10: a path that does not exist"]},
  {"name":"a quote ends at its first inner double quote","patches":[{"file":"lib-ledger.mjs","from":"(i + 1 >= body.length || /[\\s;,]/.test(body[i + 1]))","to":"true"}],"expect":["^L10: a quote whose text after an inner double quote"]},
  {"name":"a quote holding double quotes is refused","patches":[{"file":"lib-ledger.mjs","from":"if (lines[n - 1].includes(body.slice(0, i))) found = i;","to":"if (lines[n - 1].includes(body.slice(0, i)) && !body.slice(0, i).includes('\"')) found = i;"}],"expect":["^L10: a quote that holds double quotes"]},
  {"name":"a missing script is accepted","patches":[{"file":"merge.mjs","from":"if (!st || st.code === undefined) return name + \" is not in .checks/scripts\"","to":"if (!st || st.code === undefined) continue; if (false) return name + \" is not in .checks/scripts\""}],"expect":["^L10: a cited check script that does not exist"]},
  {"name":"the cited exit is not compared","patches":[{"file":"merge.mjs","from":"if (st.code !== Number(code)) return","to":"if (false) return"}],"expect":["^L10: a cited check script that exits otherwise"]},
  {"name":"the rule id need not be printed","patches":[{"file":"merge.mjs","from":"if (!st.out.includes(rule)) return","to":"if (false) return"}],"expect":["^L10: a cited check script that does not print"]},
  {"name":"a vacuous script is accepted","patches":[{"file":"merge.mjs","from":"if (st.empty !== 2) return","to":"if (false) return"}],"expect":["^L10: a check script that exits 0 or 1 on an empty root"]},
  {"name":"online scripts are run by merge","patches":[{"file":"merge.mjs","from":"if (/^check-x-/.test(s)) { state[s] =","to":"if (false) { state[s] ="}],"expect":["^L10: an online check-x- script is not re-run"]},
  {"name":"an online log need not be in runs.tsv","patches":[{"file":"merge.mjs","from":" || !runs.includes(sha256(buf))) return","to":") return"}],"expect":["^L10: an online check-x- script whose log is not hashed"]},
  {"name":"a bundle citation is accepted","patches":[{"file":"lib-ledger.mjs","from":"&& fs.existsSync(path.join(root, \"_source\"))) return","to":"&& false) return"}],"expect":["^L10: with a _source folder"]},
  {"name":"--with is ignored","patches":[{"file":"merge.mjs","from":"const rootB = argv.includes(\"--with\") ? path.resolve(argv[argv.indexOf(\"--with\") + 1] || \".\") : null;","to":"const rootB = null;"}],"expect":["^L11: --with root B"]},
  {"name":"root B's finding ids are not prefixed","patches":[{"file":"merge.mjs","from":"findings.push({ id: x.prefix + id,","to":"findings.push({ id: id,"}],"expect":["^L11: root B's findings get ids B-"]},
  {"name":"x- slices must hold every rule","patches":[{"file":"merge.mjs","from":"missing: s.exempt ? [] : p.missing,","to":"missing: p.missing,"}],"expect":["^L11: an x-\\*\\.tsv slice with one line"]},
  {"name":"x- verdict files are not read","patches":[{"file":"merge.mjs","from":"filter((y) => /^x-.*\\.tsv$/.test(y))","to":"filter((y) => /^x-NEVER$/.test(y))"}],"expect":["^L11: an invalid line in an x-\\*\\.tsv"]},
  {"name":"an unknown flag is accepted","patches":[{"file":"merge.mjs","from":"if (unknown.length) { console.error(","to":"if (false) { console.error("}],"expect":["^L11: an unknown flag exits 2"]},
  {"name":"no BLOCKED line","patches":[{"file":"merge.mjs","from":"if (ledger.proof) console.log(\"BLOCKED: \"","to":"if (false) console.log(\"BLOCKED: \""}],"expect":["^L12: --proof with one allowed BLOCKED row"]},
  {"name":"one tried approach is BLOCKED","patches":[{"file":"lib-ledger.mjs","from":".filter((t) => t.trim()).length >= 2","to":".filter((t) => t.trim()).length >= 1"}],"expect":["^L12: a BLOCKED reason with one tried approach"]},
  {"name":"a plain NOT CHECKED passes --proof","patches":[{"file":"lib-ledger.mjs","from":"if (!isBlocked(r.evidence)) { problems.push(r.rule + \" is NOT CHECKED and not BLOCKED\"); continue; }","to":"if (!isBlocked(r.evidence)) continue;"}],"expect":["^L12: a NOT CHECKED that is not BLOCKED"]},
  {"name":"a BLOCKED on a tool we have passes","patches":[{"file":"lib-ledger.mjs","from":"if (TOOLS_WE_HAVE.test(unblocks)) problems.push(","to":"if (false) problems.push("}],"expect":["^L12: an unblocks that names a tool we have"]},
  {"name":"a BLOCKED id need not be allowed","patches":[{"file":"lib-ledger.mjs","from":"if (!allowed.has(r.rule)) problems.push(","to":"if (false) problems.push("}],"expect":["^L12: a BLOCKED id not in head/blocked-allowed"]},
  {"name":"--proof is always on","patches":[{"file":"merge.mjs","from":"if (argv.includes(\"--proof\")) {","to":"if (true) {"}],"expect":["^L12: without --proof"]}].map((m) => ({ ...m, expect: m.expect.map((s) => new RegExp(s)) })));
MUTANTS.push(...[{"name":"an approach need not hold exit N or path:N","patches":[{"file":"lib-ledger.mjs","from":".every((t) => /exit \\d+|\\S:\\d+/.test(t))","to":".every((t) => true)"}],"expect":["^L12: a BLOCKED reason with two approaches"]}].map((m) => ({ ...m, expect: m.expect.map((s) => new RegExp(s)) })));

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-ledger.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "LEDGER", scenarios, MUTANTS, scriptsDir, argv: A }));
}
