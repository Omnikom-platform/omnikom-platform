// Usage: node test-proof-gates.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of proof-gates.mjs (VTV-PROOF brief v4, T5): the gates G1-G11 recomputed from a proof cycle's files. Temp folders only; no network and
// no model: G4's "claude -p", G10's master hashes and G11's process list are injected (io), as checker-rules.mjs takes its io object. G7 runs
// its real runner (node on patched copies, under netguard) over the fixture's two small check scripts.
// The fixture is one complete passing cycle (<proof>/cycle-1 with root-a, root-b, logs, gates, hand-overs and the head's files); its ledger is
// written by the real merge.mjs --with root-b --proof. Each case copies the proof folder, breaks one thing and expects that gate red.
// The checklist is read here with a reading of our own (not lib-ledger.mjs). Mutants: a patch to a copy of the scripts folder must turn the
// named assertions red.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { checker, main, runner, mkTmp, rmTmp, W, J, walk } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const CK = path.join(here, "..", "checklist");
const rd = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

const OWN = [];
for (const n of fs.readdirSync(CK).filter((x) => x.endsWith(".md") && x !== "INDEX.md").sort()) for (const l of rd(path.join(CK, n)).split(/\r?\n/)) {
  const m = /^- ([A-Z][A-Z0-9]{1,4}-\d{3}) (P0|P1|P2|W)/.exec(l);
  if (m) OWN.push({ id: m[1], grade: m[2], pack: n.replace(/\.md$/, ""), page: ((/\[([^\]]*)\]/.exec(l) || [])[1] || "").split(/,\s*/).some((k) => ["html", "http", "browser"].includes(k)) });
}
const NP = OWN.filter((r) => r.grade !== "W" && !r.page).map((r) => r.id);
const [FA, NA1, BL1, SP, SP2, EX] = NP, WA = OWN.find((r) => r.grade === "W").id, PGX = OWN.find((r) => r.page && r.grade !== "W").id;
const BLK = "BLOCKED: the registrar page needs a login | unblocks: the owner reads the registrar page | tried: rdap.mjs exit 1; whois.txt:3";
const LINE = (over, def) => OWN.map((r) => r.id + "\t" + (over[r.id] || def).join("\t")).join("\n") + "\n";
const PAGE_SCRIPT = (id, body) => 'import fs from "node:fs"; import path from "node:path";\nconst root = process.argv[2] || ".";\n' + body.replace(/ID/g, id);
const S1 = PAGE_SCRIPT(SP, 'const f = path.join(root, "index.html");\nif (!fs.existsSync(f)) { console.log("ERROR ID cannot judge"); process.exit(2); }\nif (fs.readFileSync(f, "utf8").includes("home")) { console.log("PASS ID"); process.exit(0); }\nconsole.log("FAIL ID"); process.exit(1);\n');
const S2 = PAGE_SCRIPT(SP2, 'const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => x.name === ".checks" ? [] : x.isDirectory() ? walk(path.join(d, x.name)) : x.name.endsWith(".html") ? [path.join(d, x.name)] : []);\nconst pages = fs.existsSync(root) ? walk(root) : [];\nif (!pages.length) { console.log("ERROR ID cannot judge"); process.exit(2); }\nconsole.log(pages.length + " pages");\nif (pages.some((p) => !fs.readFileSync(p, "utf8").includes("<p>"))) { console.log("FAIL ID"); process.exit(1); }\nconsole.log("PASS ID"); process.exit(0);\n');
// sha256 of every file under a root outside .checks: "rel<TAB>sha", sorted (this test's own walk)
const rootHashes = (r) => walk(r).map((f) => path.relative(r, f).split(path.sep).join("/")).filter((f) => !f.startsWith(".checks/")).sort().map((f) => f + "\t" + sha(fs.readFileSync(path.join(r, f)))).join("\n") + "\n";

async function build(dir, base) {
  const proof = path.join(base, "proof"), cyc = path.join(proof, "cycle-1"), ra = path.join(cyc, "root-a"), rb = path.join(cyc, "root-b"), logs = path.join(cyc, "logs");
  W(path.join(ra, "index.html"), "<p>home</p>\n"); W(path.join(ra, "about/index.html"), "<!-- about -->\n<p>about</p>\n"); W(path.join(ra, "style.css"), "/* style */\np { color: red }\n");
  W(path.join(ra, ".checks/plan.json"), { slices: [{ id: "s01", files: ["index.html"] }], families: [], skipped: { generatedOrBinary: 0, tooLarge: [] } });
  W(path.join(ra, ".checks/verdicts/s01.tsv"), LINE({ [FA]: ["FAIL", 'about/index.html:2 "<p>about</p>"'], [WA]: ["WARN", 'about/index.html:2 "<p>about</p>"'], [NA1]: ["N/A", "no such artefact in root A"], [BL1]: ["NOT CHECKED", BLK], [SP]: ["PASS", "check-s01-01.mjs exit 0"], [SP2]: ["PASS", "check-s01-02.mjs exit 0"] }, ["PASS", 'index.html:1 "<p>home</p>"']));
  W(path.join(ra, ".checks/scripts/check-s01-01.mjs"), S1); W(path.join(ra, ".checks/scripts/check-s01-02.mjs"), S2);
  W(path.join(ra, ".checks/findings/s01.md"), "| id | severity | file:line | problem | why it matters | fix | check script | root cause |\n|---|---|---|---|---|---|---|---|\n");
  W(path.join(rb, "pages/home/body.html"), "<p>home</p>\n"); W(path.join(rb, "pages/about/body.html"), "<p>about</p>\n");
  W(path.join(rb, ".checks/plan.json"), { snapshot: true, slices: [{ id: "s01", files: ["pages/home/body.html"] }], families: [], skipped: { generatedOrBinary: 0, tooLarge: [] } });
  W(path.join(rb, ".checks/verdicts/s01.tsv"), LINE({ [NA1]: ["N/A", "no such artefact in root B"], [BL1]: ["NOT CHECKED", BLK] }, ["PASS", 'pages/home/body.html:1 "<p>home</p>"']));
  W(path.join(proof, "head/blocked-allowed.tsv"), BL1 + "\towner\n"); W(path.join(proof, "head/bytes-allow.tsv"), "https://x.test/allowed.png\towner\n"); W(path.join(proof, "head/verify-extra.tsv"), EX + "\n");
  const exec = runner(dir, path.join(base, "home"), path.join(base, "net.log"));
  fs.mkdirSync(path.join(base, "home"), { recursive: true });
  const m = await exec("merge.mjs", ["--with", rb, ra, "--proof", "--checklist", CK], { timeout: 300000 });
  W(path.join(logs, "merge-1.log"), m.out + "\nexit " + m.code + "\n");
  W(path.join(logs, "signature.log"), "P0 x-omnikom-signature: omk-vtv-20261126-aaa\nP1 x-omnikom-signature: omk-vtv-20261126-aaa\nP8 x-omnikom-signature: omk-vtv-20261126-aaa\n");
  const hs = path.join(proof, "search-baseline", "gsc-90.mjs"); W(hs, "// head script\n");
  W(path.join(logs, "runs.tsv"), [sha(fs.readFileSync(path.join(dir, "merge.mjs"))) + "\t" + path.join(dir, "merge.mjs"), sha(fs.readFileSync(hs)) + "\t" + hs].join("\n") + "\n");
  W(path.join(logs, "net-probes.tsv"), "method\thost\tpath\tstatus\nGET\tvalleytovalleyrealty.test\t/\t200\nPOST\tpagespeedonline.googleapis.com\t/x\t200\n");
  for (const p of ["P0", "P1", "P8"]) W(path.join(logs, "bytes-check-" + p + ".tsv"), "url\tlive_sha256\tdeploy_sha256\nhttps://x.test/\taa\taa\nhttps://x.test/allowed.png\tbb\tcc\n");
  W(path.join(cyc, "manifest-before.tsv"), "a.html\t11\n"); W(path.join(cyc, "manifest-after.tsv"), "a.html\t11\n");
  W(path.join(cyc, "worker-manifest.tsv"), "root-a/.checks/findings/s01.md\t" + sha(fs.readFileSync(path.join(ra, ".checks/findings/s01.md"))) + "\n");
  for (const [r, n] of [[ra, "root-a"], [rb, "root-b"]]) { W(path.join(cyc, n + "-before.tsv"), rootHashes(r)); W(path.join(cyc, n + "-after.tsv"), rootHashes(r)); }
  const patches = "root-a/.checks/scripts/check-s01-01.mjs\tindex.html\thome\tgone\nroot-a/.checks/scripts/check-s01-02.mjs\tabout/index.html\t<p>\t<q>\n";
  W(path.join(cyc, "gates/G7/patches.tsv"), patches); W(path.join(proof, ".claude/POSITION.md"), "G7 patches sha256 " + sha(patches) + "\n");
  const lib = await import(pathToFileURL(path.join(dir, "proof-gates.mjs")).href + "?" + Math.random());
  W(path.join(logs, "numbers-src.txt"), lib.LABELS.map((l, i) => l + " = " + (100 + i)).join("\n") + "\n");
  W(path.join(cyc, "numbers.md"), lib.LABELS.map((l, i) => l + "\t" + (100 + i) + "\tlogs/numbers-src.txt\t" + (i + 1)).join("\n") + "\n");
  W(path.join(cyc, "hand-overs/a.md"), "rules: " + FA + "," + WA + "\n\nfix them\n");
  return { proof, cyc, ra, rb, logs, merge: m, lib };
}

async function scenarios(dir) {
  const results = [], check = checker(results);
  const base = mkTmp("proofgates");
  try {
    let lib = null, fx = null;
    try { fx = await build(dir, base); lib = fx.lib; } catch (e) { check("the fixture builds and proof-gates.mjs loads", false, e.stack); return results; }
    check("fixture: merge.mjs --with root-b --proof on the fixture cycle exits 0 with 547 rows", fx.merge.code === 0 && /LEDGER: 547 of 547/.test(fx.merge.out), fx.merge.code + " " + fx.merge.out.slice(-500));
    const calls = [];
    const claude = (disagree = new Set()) => (c) => { calls.push(c); const id = (/^RULE (\S+)/m.exec(c.input) || [])[1]; return { code: 0, stdout: JSON.stringify({ type: "result", result: "I re-opened the evidence.\n" + JSON.stringify({ agree: !disagree.has(id), why: "fixture" }) }) }; };
    const io = (over = {}) => ({ claude: claude(), bgProcs: () => "Pid Name Cmd\n4242 node.exe node C:\\other\\thing.mjs\n", masterSha: (rel) => { try { return sha(fs.readFileSync(path.join(dir, path.basename(rel)))); } catch { return null; } }, shipgateDir: SG, ...over });
    // the shipgate spec: one full-text line per rule
    const SG = path.join(base, "shipgate"); W(path.join(SG, "spec/packs/all.md"), OWN.map((r) => "- **" + r.id + "** · " + r.grade + " · html — FULL TEXT OF " + r.id + ".").join("\n") + "\n");
    let k = 0;
    // a fresh copy of the proof folder, broken by fn(cycle paths), then the gates
    const run = async (fn = () => {}, argv = [], ioOver = {}) => {
      const p = path.join(base, "case" + ++k); fs.cpSync(fx.proof, p, { recursive: true });
      const c = { proof: p, cyc: path.join(p, "cycle-1"), ra: path.join(p, "cycle-1", "root-a"), rb: path.join(p, "cycle-1", "root-b"), logs: path.join(p, "cycle-1", "logs") };
      await fn(c);
      calls.length = 0;
      const r = await lib.proofGates([c.cyc, "--checklist", CK, ...argv], io(ioOver));
      const out = r.lines.join("\n"), g = (n) => r.lines.find((l) => l.startsWith("G" + n + " ")) || "";
      return { ...r, out, g, c, calls: [...calls] };
    };
    const runG = (n, fn = () => {}, argv = [], ioOver = {}) => run(fn, [...argv, "--gates", "G" + n], ioOver);
    const edit = (f, from, to) => { const t = rd(f); if (!t || !t.includes(from)) throw new Error("fixture edit: " + from + " not in " + f); fs.writeFileSync(f, t.replace(from, to)); };
    const ledgerOf = (c) => J(path.join(c.ra, ".checks/ledger.json"));

    // ---- the complete cycle
    const ok = await run(() => {}, ["--verify"]);
    const order = ok.lines.filter((l) => /^G\d+ (PASS|FAIL)/.test(l)).map((l) => l.split(" ")[0]).join();
    check("a complete cycle with --verify: G1 to G11 each print 'Gn PASS <numbers>' in order, then ALL GATES PASS, exit 0", ok.code === 0 && order === "G1,G2,G3,G4,G5,G6,G7,G8,G9,G10,G11" && ok.lines.filter((l) => /^G\d+ PASS \S/.test(l)).length === 11 && ok.lines[ok.lines.length - 1] === "ALL GATES PASS", ok.code + "\n" + ok.out);
    const noV = await run();
    check("without --verify G4 is not run: G4 FAIL, no ALL GATES PASS, exit 1", noV.code === 1 && /^G4 FAIL .*--verify/.test(noV.g(4)) && !/ALL GATES PASS/.test(noV.out) && noV.calls.length === 0, noV.code + " " + noV.g(4));
    const bad = await lib.proofGates([path.join(base, "nope"), "--checklist", CK], io()), bad2 = await lib.proofGates([fx.cyc, "--frob"], io());
    check("a missing cycle folder or an unknown flag exits 2", bad.code === 2 && bad2.code === 2 && /--frob/.test(bad2.lines.join(" ")), bad.code + " " + bad2.code + " " + bad2.lines.join(" "));

    // ---- G1, G2
    const g1 = await runG(1, (c) => { const l = ledgerOf(c); l.rows = l.rows.filter((x) => x.rule !== EX); l.noRow = [EX]; W(path.join(c.ra, ".checks/ledger.json"), l); });
    check("G1: a ledger with 546 of 547 rows is G1 FAIL naming the rule", /^G1 FAIL/.test(g1.g(1)) && g1.g(1).includes(EX) && g1.code === 1, g1.g(1));
    const g1b = await runG(1, (c) => { const l = ledgerOf(c); delete l.proof; W(path.join(c.ra, ".checks/ledger.json"), l); });
    check("G1: a ledger merge wrote without --proof is G1 FAIL", /^G1 FAIL .*--proof/.test(g1b.g(1)), g1b.g(1));
    const g2 = await runG(2, (c) => W(path.join(c.proof, "head/blocked-allowed.tsv"), "ZZZ-999\towner\n"));
    check("G2: a BLOCKED row whose id is not in head/blocked-allowed.tsv is G2 FAIL naming it", /^G2 FAIL/.test(g2.g(2)) && g2.g(2).includes(BL1), g2.g(2));
    // ---- G3
    const g3 = await runG(3, (c) => fs.appendFileSync(path.join(c.logs, "bytes-check-P8.tsv"), "https://x.test/sitemap.xml\tdd\tee\n"));
    check("G3: a bytes mismatch outside head/bytes-allow.tsv is G3 FAIL naming the URL (the allowed mismatch is not)", /^G3 FAIL/.test(g3.g(3)) && g3.g(3).includes("sitemap.xml") && !g3.g(3).includes("allowed.png") && /^G3 PASS/.test(ok.g(3)), g3.g(3) + " | " + ok.g(3));
    const g3b = await runG(3, (c) => edit(path.join(c.logs, "signature.log"), "P8 x-omnikom-signature: omk-vtv-20261126-aaa", "P8 x-omnikom-signature: omk-vtv-20261126-bbb"));
    check("G3: a different signature at one check point is G3 FAIL", /^G3 FAIL .*signature/.test(g3b.g(3)), g3b.g(3));
    const g3c = await runG(3, (c) => fs.appendFileSync(path.join(c.logs, "net-probes.tsv"), "POST\tvalleytovalleyrealty.test\t/api/lead\t200\n"));
    check("G3: a POST to a host outside Search Console, PageSpeed, CrUX and OSV in logs/net-probes.tsv is G3 FAIL", /^G3 FAIL .*POST/.test(g3c.g(3)) && g3c.g(3).includes("/api/lead"), g3c.g(3));
    // ---- G4
    const ids = (r) => r.calls.map((c) => (/^RULE (\S+)/m.exec(c.input) || [])[1]);
    const L = ledgerOf({ ra: fx.ra }), by = new Map(L.rows.map((r) => [r.rule, r]));
    const s1 = ids(ok), s1b = ids(await runG(4, () => {}, ["--verify"]));
    const workerPass = s1.filter((id) => by.get(id)?.verdict === "PASS" && !/check-\S+\.mjs exit/.test(by.get(id).evidence));
    check("G4: the sample: 40 PASS rows backed only by a worker verdict file, the other PASS, every FAIL and WARN, every N/A, every BLOCKED and head/verify-extra.tsv, each once; the same ledger gives the same sample",
      (workerPass.length === 40 || (workerPass.length === 41 && workerPass.includes(EX))) && [SP, SP2, FA, WA, NA1, BL1, EX].every((id) => s1.includes(id)) && new Set(s1).size === s1.length && s1.join() === s1b.join(), JSON.stringify([workerPass.length, s1.length, s1.slice(0, 5)]));
    const c0 = ok.calls[0] || {};
    check("G4: each call is claude -p --model opus --output-format json --allowedTools Read Grep Glob Bash(node:*), the prompt by stdin with the full rule text, the evidence and both roots, under netguard; outputs in gates/G4/",
      JSON.stringify(c0.args) === JSON.stringify(["-p", "--model", "opus", "--output-format", "json", "--allowedTools", "Read", "Grep", "Glob", "Bash(node:*)"]) && ok.calls.every((c) => { const id = (/^RULE (\S+)/m.exec(c.input) || [])[1]; return c.input.includes("FULL TEXT OF " + id + ".") && c.input.includes(by.get(id).evidence) && c.input.includes(ok.c.ra) && c.input.includes(ok.c.rb); })
      && /netguard-import\.mjs/.test(c0.env?.NODE_OPTIONS || "") && fs.readdirSync(path.join(ok.c.cyc, "gates", "G4")).length >= s1.length, JSON.stringify({ args: c0.args, env: c0.env?.NODE_OPTIONS, input: (c0.input || "").slice(0, 300) }));
    const g4 = await runG(4, () => {}, ["--verify"], { claude: claude(new Set([FA])) });
    const packFA = OWN.find((r) => r.id === FA).pack, round2 = ids(g4).slice(s1.length);
    check("G4: one disagreement is G4 FAIL naming the rule; the second round re-judges that rule's whole pack and a re-sample with seed + 1", /^G4 FAIL/.test(g4.g(4)) && g4.g(4).includes(FA) && g4.code === 1 && OWN.filter((r) => r.pack === packFA).every((r) => round2.includes(r.id)) && round2.length > OWN.filter((r) => r.pack === packFA).length, g4.g(4) + " round2 " + round2.length);
    // ---- G5
    const g5a = await runG(5, (c) => fs.writeFileSync(path.join(c.cyc, "manifest-after.tsv"), "a.html\t12\n"));
    check("G5: manifest-before.tsv and manifest-after.tsv differ: G5 FAIL", /^G5 FAIL .*manifest/.test(g5a.g(5)), g5a.g(5));
    const g5b = await runG(5, (c) => fs.appendFileSync(path.join(c.ra, ".checks/findings/s01.md"), "| late | low | x | y | z | w | none | x |\n"));
    check("G5: a file in worker-manifest.tsv changed after its worker ended: G5 FAIL naming it", /^G5 FAIL .*findings\/s01\.md/.test(g5b.g(5)), g5b.g(5));
    const g5c = await runG(5, (c) => { for (const i of [2, 3, 4]) W(path.join(c.logs, "merge-" + i + ".log"), "exit 0\n"); });
    check("G5: merge run 4 times (logs/merge-*.log): G5 FAIL", /^G5 FAIL .*merge/.test(g5c.g(5)), g5c.g(5));
    const g5d = await runG(5, (c) => W(path.join(c.ra, "late.html"), "<p>late</p>\n"));
    check("G5: a root file added or changed since root-a-before.tsv (the roots are hashed again now): G5 FAIL", /^G5 FAIL .*root-a/.test(g5d.g(5)), g5d.g(5));
    // ---- G6
    const g6 = await runG(6, (c) => edit(path.join(c.rb, ".checks/verdicts/s01.tsv"), PGX + "\tPASS\tpages/home/body.html:1", PGX + "\tNOT CHECKED\tnot in this slice\t"));
    check("G6: a PASS on a page rule that a verdict file calls NOT CHECKED, with no 'covers M of M pages', is G6 FAIL naming it", /^G6 FAIL/.test(g6.g(6)) && g6.g(6).includes(PGX) && /^G6 PASS/.test(ok.g(6)), g6.g(6));
    // ---- G7
    const pat = (c) => path.join(c.cyc, "gates/G7/patches.tsv");
    const repin = (c) => W(path.join(c.proof, ".claude/POSITION.md"), "G7 patches sha256 " + sha(fs.readFileSync(pat(c))) + "\n");
    check("G7: the complete cycle tests both scripts (empty copy exit 2, patch exit 1, neutral patch as the real root, the pages script on the last page): G7 PASS 2 of 2", /^G7 PASS .*2 of 2/.test(ok.g(7)), ok.g(7));
    const g7a = await runG(7, (c) => edit(path.join(c.ra, ".checks/scripts/check-s01-01.mjs"), 'console.log("ERROR ' + SP + ' cannot judge"); process.exit(2);', 'console.log("PASS ' + SP + '"); process.exit(0);'));
    check("G7: a script that does not exit 2 on an empty copy is removed: G7 FAIL naming it and its rules going NOT CHECKED", /^G7 FAIL/.test(g7a.g(7)) && /check-s01-01\.mjs/.test(g7a.g(7)) && g7a.g(7).includes(SP) && /empty/.test(g7a.g(7)), g7a.g(7));
    const g7b = await runG(7, (c) => { fs.writeFileSync(pat(c), rd(pat(c)).replace("\thome\tgone", "\tnot-there\tgone")); repin(c); });
    check("G7: a patch whose 'from' is not in its file is G7 FAIL", /^G7 FAIL .*not-there|^G7 FAIL .*from/.test(g7b.g(7)), g7b.g(7));
    const g7c = await runG(7, (c) => { fs.writeFileSync(pat(c), rd(pat(c)).replace("\tindex.html\thome\tgone", "\tstyle.css\tred\tblue")); repin(c); });
    check("G7: a script that stays green under its patch is removed, its slice's other scripts are tested, and its rules are named: G7 FAIL", /^G7 FAIL/.test(g7c.g(7)) && /check-s01-01\.mjs/.test(g7c.g(7)) && g7c.g(7).includes(SP) && /green/.test(g7c.g(7)) && /tested 2\b/.test(g7c.g(7)), g7c.g(7));
    const g7d = await runG(7, (c) => edit(path.join(c.ra, ".checks/scripts/check-s01-02.mjs"), "pages.some((p) =>", "pages.slice(0, 1).some((p) =>"));
    check("G7: a '<n> pages' script that misses a patch in the last page of the root in sort order is G7 FAIL", /^G7 FAIL/.test(g7d.g(7)) && /check-s01-02\.mjs/.test(g7d.g(7)) && /last page/.test(g7d.g(7)), g7d.g(7));
    const g7e = await runG(7, (c) => edit(path.join(c.ra, ".checks/scripts/check-s01-01.mjs"), 'if (fs.readFileSync(f, "utf8").includes("home"))', 'if (fs.readFileSync(f, "utf8").includes("home") && !fs.readFileSync(path.join(root, "about/index.html"), "utf8").includes("  -->"))'));
    check("G7: a script whose exit changes under the neutral patch (a space at the end of a comment in an unrelated file) is removed: G7 FAIL", /^G7 FAIL .*neutral/.test(g7e.g(7)) && /check-s01-01\.mjs/.test(g7e.g(7)), g7e.g(7));
    const g7f = await runG(7, (c) => W(path.join(c.proof, ".claude/POSITION.md"), "no hash here\n"));
    check("G7: POSITION without the sha256 of gates/G7/patches.tsv is G7 FAIL", /^G7 FAIL .*POSITION/.test(g7f.g(7)), g7f.g(7));
    const g7g = await runG(7, (c) => { fs.writeFileSync(pat(c), rd(pat(c)).split("\n").filter((l) => !l.includes("check-s01-02")).join("\n")); repin(c); });
    check("G7: a script that backs a PASS with no row in patches.tsv is G7 FAIL naming it", /^G7 FAIL .*check-s01-02\.mjs/.test(g7g.g(7)) && /no patch/.test(g7g.g(7)), g7g.g(7));
    // ---- G8, G9
    const g8 = await runG(8, (c) => edit(path.join(c.logs, "numbers-src.txt"), lib.LABELS[2] + " = 102", lib.LABELS[2] + " = 999"));
    check("G8: a number that is not on the line it cites is G8 FAIL naming the label", /^G8 FAIL/.test(g8.g(8)) && g8.g(8).includes(lib.LABELS[2]), g8.g(8));
    const g8b = await runG(8, (c) => fs.writeFileSync(path.join(c.cyc, "numbers.md"), rd(path.join(c.cyc, "numbers.md")).split("\n").filter((l) => !l.startsWith(lib.LABELS[0] + "\t")).join("\n")));
    check("G8: a label of section 6 with no line in numbers.md is G8 FAIL naming it", /^G8 FAIL/.test(g8b.g(8)) && g8b.g(8).includes(lib.LABELS[0]) && lib.LABELS.length >= 10, g8b.g(8));
    const g9 = await runG(9, (c) => W(path.join(c.cyc, "hand-overs/b.md"), "rules: " + FA + "\n"));
    check("G9: a FAIL id in two hand-overs is G9 FAIL naming it", /^G9 FAIL/.test(g9.g(9)) && g9.g(9).includes(FA), g9.g(9));
    const g9b = await runG(9, (c) => W(path.join(c.cyc, "hand-overs/a.md"), "rules: " + FA + "\n"));
    check("G9: a WARN id in no hand-over is G9 FAIL naming it", /^G9 FAIL/.test(g9b.g(9)) && g9b.g(9).includes(WA), g9b.g(9));
    // ---- G10, G11
    const g10 = await runG(10, () => {}, [], { masterSha: (rel) => (/merge\.mjs$/.test(rel) ? "0".repeat(64) : sha(fs.readFileSync(path.join(dir, path.basename(rel))))) });
    check("G10: a skill script used whose sha256 differs from master's is G10 FAIL naming it", /^G10 FAIL .*merge\.mjs/.test(g10.g(10)), g10.g(10));
    const g10b = await runG(10, (c) => fs.appendFileSync(path.join(c.proof, "search-baseline", "gsc-90.mjs"), "// changed\n"));
    const g10c = await runG(10, (c) => W(path.join(c.logs, "runs.tsv"), rd(path.join(c.logs, "runs.tsv")).replace(fx.proof, c.proof)));
    check("G10: a head script changed since runs.tsv hashed it at first use is G10 FAIL naming it", /^G10 PASS/.test(g10c.g(10)) && (await runG(10, (c) => { W(path.join(c.logs, "runs.tsv"), rd(path.join(c.logs, "runs.tsv")).replace(fx.proof, c.proof)); fs.appendFileSync(path.join(c.proof, "search-baseline", "gsc-90.mjs"), "// changed\n"); })).g(10).match(/^G10 FAIL .*gsc-90\.mjs/), g10c.g(10) + " | " + g10b.g(10));
    const g11 = await runG(11, (c) => {}, [], { bgProcs: () => "Pid Name Cmd\n4243 chrome.exe chrome --user-data-dir=" + path.join(base, "case" + k, "cycle-1", "work", "profile") + "\n" });
    check("G11: list-bg-procs output with a process naming the cycle folder is G11 FAIL", /^G11 FAIL/.test(g11.g(11)) && /4243/.test(g11.g(11)), g11.g(11));
  } finally { rmTmp(base); }
  return results;
}

// mutants: { name, patches: [{ file, from, to }], expect: [regex source] }
const MUTANTS = [{"name":"the fixture's BLOCKED row is refused by merge --proof","patches":[{"file":"lib-ledger.mjs","from":"if (!allowed.has(r.rule)) problems.push(","to":"if (allowed.has(r.rule)) problems.push("}],"expect":["^fixture: merge\\.mjs"]},
  {"name":"ALL GATES PASS never printed","patches":[{"file":"proof-gates.mjs","from":"if (all) say(\"ALL GATES PASS\");","to":"if (false) say(\"ALL GATES PASS\");"}],"expect":["^a complete cycle with --verify"]},
  {"name":"G4 runs without --verify","patches":[{"file":"proof-gates.mjs","from":"if (!argv.includes(\"--verify\")) return { ok: false","to":"if (false) return { ok: false"}],"expect":["^without --verify G4 is not run"]},
  {"name":"an unknown flag is accepted","patches":[{"file":"proof-gates.mjs","from":"if (unknown.length || !cycArg || !fs.existsSync(cycArg))","to":"if (!cycArg || !fs.existsSync(cycArg))"}],"expect":["^a missing cycle folder or an unknown flag"]},
  {"name":"G1 ignores a missing row","patches":[{"file":"proof-gates.mjs","from":"const why = ledgerProblems(L, ck);","to":"const why = [];"}],"expect":["^G1: a ledger with 546 of 547 rows"]},
  {"name":"G1 accepts a ledger without --proof","patches":[{"file":"proof-gates.mjs","from":"if (!L.proof) why.push(\"the ledger was not written by merge --proof\");","to":"if (false) why.push(\"the ledger was not written by merge --proof\");"}],"expect":["^G1: a ledger merge wrote without --proof"]},
  {"name":"G2 ignores the proof problems","patches":[{"file":"proof-gates.mjs","from":"return { ok: !!L && !problems.length,","to":"return { ok: !!L,"}],"expect":["^G2: a BLOCKED row"]},
  {"name":"G3 ignores bytes mismatches","patches":[{"file":"proof-gates.mjs","from":"if (r[il] !== r[id] && !allow.has(r[iu])) mism.add(r[iu]);","to":"if (false) mism.add(r[iu]);"}],"expect":["^G3: a bytes mismatch"]},
  {"name":"G3 ignores a second signature","patches":[{"file":"proof-gates.mjs","from":"else if (sigs.size > 1) why.push(","to":"else if (false) why.push("}],"expect":["^G3: a different signature"]},
  {"name":"G3 ignores POSTs","patches":[{"file":"proof-gates.mjs","from":".filter((r) => r[0] === \"POST\" && !POST_OK.test(","to":".filter((r) => false && !POST_OK.test("}],"expect":["^G3: a POST to a host"]},
  {"name":"G4 samples 20 worker PASS rows","patches":[{"file":"proof-gates.mjs","from":"pass.filter((r) => !script(r)), (r) => r.rule).slice(0, 40)","to":"pass.filter((r) => !script(r)), (r) => r.rule).slice(0, 20)"}],"expect":["^G4: the sample"]},
  {"name":"G4's sample is not seeded","patches":[{"file":"proof-gates.mjs","from":"const rank = (seed, id) => sha(seed + \":\" + id);","to":"const rank = (seed, id) => sha(Math.random() + \":\" + id);"}],"expect":["^G4: the sample"]},
  {"name":"G4 asks another model","patches":[{"file":"proof-gates.mjs","from":"\"--model\", \"opus\"","to":"\"--model\", \"sonnet\""}],"expect":["^G4: each call is claude -p"]},
  {"name":"G4 runs without netguard","patches":[{"file":"proof-gates.mjs","from":"env: { NODE_OPTIONS: netguard() } });","to":"env: {} });"}],"expect":["^G4: each call is claude -p"]},
  {"name":"G4 passes with a disagreement","patches":[{"file":"proof-gates.mjs","from":"if (!dis1.length) return { ok: true","to":"if (true) return { ok: true"}],"expect":["^G4: one disagreement"]},
  {"name":"G4's second round skips the pack","patches":[{"file":"proof-gates.mjs","from":"...rows.filter((r) => packsOf.has(r.pack))","to":"...rows.filter((r) => false)"}],"expect":["^G4: one disagreement"]},
  {"name":"G5 ignores the manifests","patches":[{"file":"proof-gates.mjs","from":"else if (norm(rd(mb)) !== norm(rd(ma))) why.push(","to":"else if (false) why.push("}],"expect":["^G5: manifest-before"]},
  {"name":"G5 ignores worker files","patches":[{"file":"proof-gates.mjs","from":"!== h) why.push(p + \" changed since its worker ended\");","to":"!== h && false) why.push(p + \" changed since its worker ended\");"}],"expect":["^G5: a file in worker-manifest"]},
  {"name":"G5 allows 4 merge runs","patches":[{"file":"proof-gates.mjs","from":"if (merges > 3) why.push(","to":"if (merges > 4) why.push("}],"expect":["^G5: merge run 4 times"]},
  {"name":"G5 does not hash the roots now","patches":[{"file":"proof-gates.mjs","from":"if (norm(rootHashes(r)) !== before) why.push(","to":"if (false) why.push("}],"expect":["^G5: a root file added"]},
  {"name":"G6 ignores NOT CHECKED slices","patches":[{"file":"proof-gates.mjs","from":"nc.has(r.rule) && !/covers","to":"false && !/covers"}],"expect":["^G6: a PASS on a page rule"]},
  {"name":"G7 picks one worker script","patches":[{"file":"proof-gates.mjs","from":".slice(0, 10)], tested","to":".slice(0, 1)], tested"}],"expect":["^G7: the complete cycle tests both scripts"]},
  {"name":"G7 skips the empty copy","patches":[{"file":"proof-gates.mjs","from":"if (e !== 2) fails.push(","to":"if (false) fails.push("}],"expect":["^G7: a script that does not exit 2"]},
  {"name":"G7 does not assert 'from'","patches":[{"file":"proof-gates.mjs","from":"if (p === null) fails.push(\"its patch 'from' is not in \" + row.file);","to":"if (false) fails.push(\"its patch 'from' is not in \" + row.file);"}],"expect":["^G7: a patch whose 'from'"]},
  {"name":"G7 keeps a script green under its patch","patches":[{"file":"proof-gates.mjs","from":"else if (p !== 1) fails.push(\"green under its patch","to":"else if (false) fails.push(\"green under its patch"}],"expect":["^G7: a script that stays green"]},
  {"name":"G7 skips the last page","patches":[{"file":"proof-gates.mjs","from":"else if (q !== 1) fails.push(\"green under its patch in the last page","to":"else if (false) fails.push(\"green under its patch in the last page"}],"expect":["^G7: a '<n> pages' script"]},
  {"name":"G7 skips the neutral patch","patches":[{"file":"proof-gates.mjs","from":"if (n !== real.code) fails.push(","to":"if (false) fails.push("}],"expect":["^G7: a script whose exit changes under the neutral patch"]},
  {"name":"G7 does not read POSITION","patches":[{"file":"proof-gates.mjs","from":".includes(psha)) why.push(","to":".includes(psha) && false) why.push("}],"expect":["^G7: POSITION without"]},
  {"name":"G7 allows a PASS script with no row","patches":[{"file":"proof-gates.mjs","from":"if (!prow.some((p) => path.basename(p.script) === n)) why.push(","to":"if (false) why.push("}],"expect":["^G7: a script that backs a PASS"]},
  {"name":"G8 does not read the line","patches":[{"file":"proof-gates.mjs","from":"if (line === undefined || !value || !line.includes(value)) why.push(","to":"if (line === undefined || !value) why.push("}],"expect":["^G8: a number that is not on the line"]},
  {"name":"G8 does not need every label","patches":[{"file":"proof-gates.mjs","from":"if (missing.length) why.push(\"no line for: \"","to":"if (false) why.push(\"no line for: \""}],"expect":["^G8: a label of section 6"]},
  {"name":"G9 allows an id twice","patches":[{"file":"proof-gates.mjs","from":"many = fw.filter((id) => count.get(id) > 1);","to":"many = fw.filter((id) => count.get(id) > 2);"}],"expect":["^G9: a FAIL id in two hand-overs"]},
  {"name":"G9 allows an id in none","patches":[{"file":"proof-gates.mjs","from":"none = fw.filter((id) => !count.get(id))","to":"none = fw.filter((id) => false)"}],"expect":["^G9: a WARN id in no hand-over"]},
  {"name":"G10 does not compare with master","patches":[{"file":"proof-gates.mjs","from":"if (m !== now) why.push(path.basename(f) + \" differs from master\"","to":"if (false) why.push(path.basename(f) + \" differs from master\""}],"expect":["^G10: a skill script used"]},
  {"name":"G10 does not compare with runs.tsv","patches":[{"file":"proof-gates.mjs","from":"if (h && now !== h) why.push(","to":"if (false) why.push("}],"expect":["^G10: a head script changed"]},
  {"name":"G11 sees no process","patches":[{"file":"proof-gates.mjs","from":"marks.some((m) => l.toLowerCase().includes(m))","to":"false"}],"expect":["^G11: list-bg-procs"]}].map((m) => ({ ...m, expect: m.expect.map((s) => new RegExp(s)) }));

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-proof-gates.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "PROOF GATES", scenarios, MUTANTS, scriptsDir, argv: A }));
}
