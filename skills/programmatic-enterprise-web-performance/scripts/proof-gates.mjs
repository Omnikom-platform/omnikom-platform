// Usage: node proof-gates.mjs <proof>\cycle-N [--verify] [--checklist <dir>] [--shipgate <dir>] [--gates G1,G7]
// VTV-PROOF brief v4, T5: the proof gates, recomputed from the cycle's files only. Prints "Gn PASS|FAIL <numbers>" for G1 to G11, then
// "ALL GATES PASS" (exit 0) or exit 1; exit 2 on a bad call. Without --verify G4 is not run, so the gates cannot all pass. --gates runs a subset
// (tests); a subset never prints ALL GATES PASS. Paths: <cycle> = the folder given, <proof> = its parent. A file named below without a folder is
// looked for in <cycle>, <cycle>/logs, <cycle>/gates and <cycle>/work, in that order.
//   G1  root-a/.checks/ledger.json: written by merge --proof, one row per checklist rule, no slice problem, no proof problem
//   G2  every NOT CHECKED row is BLOCKED (lib-ledger isBlocked), on no tool we have, and in <proof>/head/blocked-allowed.tsv
//   G3  bytes-check*.tsv (header url, live_sha256, deploy_sha256): no mismatch outside <proof>/head/bytes-allow.tsv; logs/signature.log holds one
//       signature (omk-...) at every check point; logs/net-probes.tsv (method, host, path, status) has no POST outside Search Console, PageSpeed,
//       CrUX, OSV (and Google's token endpoint)
//   G4  (--verify) seed = sha256(ledger.json); 40 PASS rows with no check script, 30 other PASS, 15 FAIL or WARN, every N/A, every BLOCKED and
//       <proof>/head/verify-extra.tsv, each judged by "claude -p --model opus --output-format json --allowedTools Read Grep Glob Bash(node:*)"
//       (prompt by stdin: the full rule text from <shipgate>/spec/packs, the verdict, the evidence and the root paths; netguard in NODE_OPTIONS;
//       outputs in gates/G4/). Any disagreement is FAIL; round 2 re-judges the whole pack of each and a re-sample with seed + 1 (NOT MET if
//       it disagrees again).
//   G5  manifest-before.tsv = manifest-after.tsv; each "path<TAB>sha256" of worker-manifest.tsv (path from <cycle>) unchanged; at most 3
//       logs/merge*.log; root-a-before.tsv / root-b-before.tsv ("rel<TAB>sha256" of every root file outside .checks) equal every
//       <root>-after*.tsv and the roots as hashed now
//   G6  a PASS on an html, http or browser rule that a verdict file of either root calls NOT CHECKED carries "covers M of M pages"
//   G7  gates/G7/patches.tsv ("script<TAB>file<TAB>from<TAB>to", script from <cycle>, file from its root; a value in double quotes is JSON) and
//       its sha256 in <proof>/.claude/POSITION.md; every check script cited by a PASS has a row; the runner tests the scripts outside .checks plus
//       10 worker scripts (by seed): exit 2 on an empty copy, exit 1 under its patch (and under the same patch in the last page of the root in
//       sort order when its first line is "<n> pages"), the real root's exit under a neutral patch (a space at the end of a comment in an
//       unrelated file). A failing script is removed (its rules go NOT CHECKED) and its slice's other scripts are tested. Under netguard.
//   G8  numbers.md lines "label<TAB>value<TAB>file<TAB>line" (file from <cycle>): the value is on that line as written; every LABELS entry
//       starts some label
//   G9  every FAIL and WARN id is in exactly one hand-overs/*.md first line "rules: ID,ID"
//   G10 each .mjs in logs/runs.tsv ("sha256<TAB>path") is unchanged since; a skill script (and this one) equals master's
//   G11 list-bg-procs.ps1 shows no process naming the cycle or proof folder (this process and its parent excepted)
// io (tests): { claude({args, input, env}) -> {code, stdout}, run(file, root) -> {code, out}, bgProcs() -> text, masterSha(rel) -> hex|null,
// shipgateDir }. No network of its own.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { readChecklist, isBlocked, proofProblems, pageKind, pageList, ledgerProblems, CHECKLIST_DIR, SCRIPT_EXITS } from "./lib-ledger.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHIPGATE = "D:/internal building pipeline for making sure that all websites we make real enterprise grade on search engines/shipgate";
const LIST_BG = process.env.PEWP_LIST_BG_PROCS || "C:/Users/DELL/.claude/bench/agent-desktop/list-bg-procs.ps1";
const USAGE = "usage: node proof-gates.mjs <proof>\\cycle-N [--verify] [--checklist <dir>] [--shipgate <dir>] [--gates G1,G7]";
// section 6 of the brief: every label must start a line of numbers.md
export const LABELS = ["indexed sitemap URLs",
  ...["28d", "90d"].flatMap((w) => ["all", "without egy"].flatMap((c) => ["impressions", "clicks", "ctr", "position"].map((m) => m + " " + w + " " + c))),
  "before vs after change %", "crux p75 lcp", "crux p75 inp", "crux p75 cls", "psi median phone", "psi median desktop",
  "lab lcp", "lab cls", "lab tbt", "old urls 200 in one hop", "pages with console errors", "accessibility failures"];
const POST_OK = /^((searchconsole|pagespeedonline|chromeuxreport|oauth2)\.googleapis\.com|api\.osv\.dev)(\/|$)|^www\.googleapis\.com\/(webmasters|pagespeedonline|oauth2)\//i;

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const rd = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const tsv = (p) => (rd(p) || "").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("\t").map((c) => c.trim()));
const norm = (t) => String(t || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).sort().join("\n");
const listFiles = (r, rel = "") => (fs.existsSync(path.join(r, rel)) ? fs.readdirSync(path.join(r, rel), { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? (rel === "" && x.name === ".checks" ? [] : listFiles(r, rel + x.name + "/")) : [rel + x.name])) : []);
export const rootHashes = (r) => listFiles(r).sort().map((f) => f + "\t" + sha(fs.readFileSync(path.join(r, f)))).join("\n");
const dec = (v) => (/^".*"$/s.test(v) ? JSON.parse(v) : v);
const rank = (seed, id) => sha(seed + ":" + id);
const bySeed = (seed, list, key = (x) => x) => [...list].sort((a, b) => (rank(seed, key(a)) < rank(seed, key(b)) ? -1 : 1));

const defaultClaude = ({ args, input, env }) => { const r = spawnSync("claude", args, { input, env: { ...process.env, ...env }, encoding: "utf8", timeout: 1_800_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }); return { code: r.status, stdout: r.stdout || "", error: r.error?.message }; };
const netguard = () => "--import " + pathToFileURL(path.join(HERE, "netguard-import.mjs")).href;
const defaultRun = (file, at) => { const r = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(HERE, "netguard-import.mjs")).href, file, at], { cwd: at, encoding: "utf8", timeout: 600_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: { ...process.env, NODE_OPTIONS: "" } }); return { code: r.status, out: r.stdout || "" }; };
const defaultBg = () => spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", LIST_BG], { encoding: "utf8", timeout: 120_000, windowsHide: true }).stdout || "";
const defaultMasterSha = (rel) => {
  const repo = path.resolve(HERE, "..", "..", "..");
  for (const ref of ["backup-gh/master", "master"]) { const r = spawnSync("git", ["-C", repo, "show", ref + ":" + rel], { maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 60_000 }); if (r.status === 0) return sha(r.stdout); }
  return null;
};

export async function proofGates(argv, io = {}) {
  const lines = [], say = (s) => lines.push(s);
  const VALUED = ["--checklist", "--shipgate", "--gates"], FLAGS = ["--verify"];
  const unknown = argv.filter((a, i) => a.startsWith("--") && !VALUED.includes(a) && !FLAGS.includes(a) && !VALUED.includes(argv[i - 1]));
  const cycArg = argv.find((a, i) => !a.startsWith("--") && !VALUED.includes(argv[i - 1]));
  if (unknown.length || !cycArg || !fs.existsSync(cycArg)) { say(USAGE + (unknown.length ? " (unknown flag " + unknown.join(", ") + ")" : " (no cycle folder " + cycArg + ")")); return { code: 2, lines }; }
  const val = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const cyc = path.resolve(cycArg), proof = path.dirname(cyc), ra = path.join(cyc, "root-a"), rb = path.join(cyc, "root-b"), logs = path.join(cyc, "logs"), gates = path.join(cyc, "gates");
  const dirs = [cyc, logs, gates, path.join(cyc, "work")];
  const find = (name) => dirs.map((d) => path.join(d, name)).find((f) => fs.existsSync(f)) || null;
  const findAll = (re) => dirs.flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => re.test(f)).map((f) => path.join(d, f)) : []));
  const ck = readChecklist(val("--checklist", CHECKLIST_DIR));
  const only = val("--gates", null)?.split(",");
  const ledgerFile = path.join(ra, ".checks", "ledger.json"), ledgerBuf = fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile) : null;
  let L = null; try { L = JSON.parse(ledgerBuf); } catch {}
  const rows = L?.rows || [], seed = ledgerBuf ? sha(ledgerBuf) : "0";
  const results = {};
  const gate = async (n, fn) => {
    if (only && !only.includes("G" + n)) return;
    let r; try { r = await fn(); } catch (e) { r = { ok: false, msg: "error: " + e.message }; }
    results[n] = !!r.ok; say("G" + n + " " + (r.ok ? "PASS" : "FAIL") + " " + r.msg);
  };
  const tail = (why) => (why.length ? ": " + why.join("; ") : "");

  await gate(1, () => {
    if (!L) return { ok: false, msg: "no root-a/.checks/ledger.json" };
    const why = ledgerProblems(L, ck);
    if (!L.proof) why.push("the ledger was not written by merge --proof");
    else why.push(...L.proof.problems);
    return { ok: !why.length, msg: L.rows.length + " of " + ck.rules.length + " rows" + tail(why.slice(0, 6)) };
  });
  await gate(2, () => {
    const allowed = new Set(tsv(path.join(proof, "head", "blocked-allowed.tsv")).map((r) => r[0]));
    const { problems, blocked } = proofProblems(rows, allowed);
    return { ok: !!L && !problems.length, msg: "BLOCKED " + blocked.length + " (ids " + blocked.join(", ") + ")" + tail(problems) };
  });
  await gate(3, () => {
    const why = [], allow = new Set(tsv(path.join(proof, "head", "bytes-allow.tsv")).map((r) => r[0])), files = findAll(/^bytes-check.*\.tsv$/), mism = new Set();
    let n = 0;
    if (!files.length) why.push("no bytes-check*.tsv");
    for (const f of files) {
      const t = tsv(f), h = t[0] || [], [iu, il, id] = ["url", "live_sha256", "deploy_sha256"].map((k) => h.indexOf(k));
      if (iu < 0 || il < 0 || id < 0) { why.push(path.basename(f) + " has no url, live_sha256 and deploy_sha256 header"); continue; }
      for (const r of t.slice(1)) { n++; if (r[il] !== r[id] && !allow.has(r[iu])) mism.add(r[iu]); }
    }
    if (mism.size) why.push(mism.size + " bytes mismatch(es) outside head/bytes-allow.tsv: " + [...mism].slice(0, 6).join(", "));
    const sigs = new Set((rd(path.join(logs, "signature.log")) || "").match(/omk-[a-z0-9-]+/g) || []);
    if (!sigs.size) why.push("logs/signature.log holds no signature"); else if (sigs.size > 1) why.push("the signature differs between check points: " + [...sigs].join(", "));
    const posts = tsv(path.join(logs, "net-probes.tsv")).filter((r) => r[0] === "POST" && !POST_OK.test(r[1] + (r[2] || "")));
    if (posts.length) why.push(posts.length + " POST(s) outside Search Console, PageSpeed, CrUX and OSV: " + posts.slice(0, 4).map((r) => r[1] + (r[2] || "")).join(", "));
    return { ok: !why.length, msg: n + " byte rows in " + files.length + " file(s), " + sigs.size + " signature(s)" + tail(why) };
  });
  await gate(4, async () => {
    if (!argv.includes("--verify")) return { ok: false, msg: "not run (needs --verify)" };
    if (!L) return { ok: false, msg: "no ledger" };
    const dir4 = path.join(gates, "G4"); fs.mkdirSync(dir4, { recursive: true });
    const texts = new Map(), packs = path.join(io.shipgateDir || val("--shipgate", SHIPGATE), "spec", "packs");
    for (const f of fs.existsSync(packs) ? fs.readdirSync(packs).filter((x) => x.endsWith(".md")) : []) for (const l of fs.readFileSync(path.join(packs, f), "utf8").split(/\r?\n/)) { const m = /^- \*\*([A-Z][A-Z0-9]{1,4}-\d{3})\*\*/.exec(l); if (m && !texts.has(m[1])) texts.set(m[1], l); }
    const extra = new Set(tsv(path.join(proof, "head", "verify-extra.tsv")).map((r) => r[0]));
    const script = (r) => /\bcheck-[\w.+-]+\.mjs exit \d+/.test(r.evidence), pass = rows.filter((r) => r.verdict === "PASS");
    const pick = (s) => [...new Map([...bySeed(s, pass.filter((r) => !script(r)), (r) => r.rule).slice(0, 40), ...bySeed(s, pass.filter(script), (r) => r.rule).slice(0, 30),
      ...bySeed(s, rows.filter((r) => r.verdict === "FAIL" || r.verdict === "WARN"), (r) => r.rule).slice(0, 15), ...rows.filter((r) => r.verdict === "N/A"),
      ...rows.filter((r) => r.verdict === "NOT CHECKED" && isBlocked(r.evidence)), ...rows.filter((r) => extra.has(r.rule))].map((r) => [r.rule, r])).values()];
    const args = ["-p", "--model", "opus", "--output-format", "json", "--allowedTools", "Read", "Grep", "Glob", "Bash(node:*)"];
    const ask = (r, round) => {
      const rule = ck.byId.get(r.rule) || {};
      const input = ["RULE " + r.rule + " (" + r.pack + ", " + r.grade + ")", "Full rule text:", texts.get(r.rule) || "(no shipgate text found; the checklist line) " + (rule.text || ""), "",
        "Verdict to verify: " + r.verdict, "Evidence: " + r.evidence, "Root A: " + ra, "Root B: " + rb, "",
        "Re-open every path:N in the evidence under the root it belongs to and check that the quoted text is on that line and supports the verdict; re-run every offline check script it names (node <root>/.checks/scripts/<name> <root>) and compare its exit. You are given no worker's reasoning on purpose. End with one JSON object on the last line: {\"agree\": true or false, \"why\": \"<one sentence>\"}."].join("\n");
      const res = (io.claude || defaultClaude)({ args, input, env: { NODE_OPTIONS: netguard() } });
      let agree = false, why = "";
      try { const t = String(JSON.parse(res.stdout).result ?? ""), m = t.match(/\{[^{}]*"agree"[^{}]*\}/g); const o = JSON.parse(m[m.length - 1]); agree = o.agree === true; why = String(o.why || ""); } catch { why = "unreadable answer (exit " + res.code + ")"; }
      fs.writeFileSync(path.join(dir4, round + "-" + r.rule + ".json"), JSON.stringify({ rule: r.rule, verdict: r.verdict, evidence: r.evidence, args, code: res.code, agree, why, stdout: res.stdout }, null, 1) + "\n");
      return { r, agree, why };
    };
    const r1 = pick(seed).map((r) => ask(r, 1)), dis1 = r1.filter((x) => !x.agree);
    if (!dis1.length) return { ok: true, msg: r1.length + " rows judged, 0 disagreements (seed " + seed.slice(0, 12) + ")" };
    const packsOf = new Set(dis1.map((x) => x.r.pack)), seed2 = (BigInt("0x" + seed) + 1n).toString(16).padStart(64, "0");
    const r2 = [...new Map([...rows.filter((r) => packsOf.has(r.pack)), ...pick(seed2)].map((r) => [r.rule, r])).values()].map((r) => ask(r, 2)), dis2 = r2.filter((x) => !x.agree);
    return { ok: false, msg: dis1.length + " disagreement(s) of " + r1.length + ": " + dis1.map((x) => x.r.rule).join(", ") + "; round 2 (the whole pack(s) " + [...packsOf].join(", ") + " and seed + 1): " + r2.length + " rows, " + dis2.length + " disagreement(s)" + (dis2.length ? ": NOT MET " + dis2.map((x) => x.r.rule).join(", ") : "") };
  });
  await gate(5, () => {
    const why = [], mb = find("manifest-before.tsv"), ma = find("manifest-after.tsv"), wmf = find("worker-manifest.tsv");
    if (!mb || !ma) why.push("manifest-before.tsv or manifest-after.tsv is missing"); else if (norm(rd(mb)) !== norm(rd(ma))) why.push("manifest-before.tsv and manifest-after.tsv differ");
    if (!wmf) why.push("no worker-manifest.tsv");
    const wm = wmf ? tsv(wmf) : [];
    for (const [p, h] of wm) { const f = path.resolve(cyc, p); if ((fs.existsSync(f) ? sha(fs.readFileSync(f)) : "missing") !== h) why.push(p + " changed since its worker ended"); }
    const merges = fs.existsSync(logs) ? fs.readdirSync(logs).filter((f) => /^merge.*\.log$/.test(f)).length : 0;
    if (merges > 3) why.push("merge was run " + merges + " times (logs/merge*.log; at most 3)");
    for (const [r, n] of [[ra, "root-a"], [rb, "root-b"]]) {
      const bf = find(n + "-before.tsv");
      if (!bf) { why.push("no " + n + "-before.tsv"); continue; }
      const before = norm(rd(bf)), afters = findAll(new RegExp("^" + n + "-after.*\\.tsv$"));
      if (!afters.length) why.push("no " + n + "-after.tsv");
      for (const a of afters) if (norm(rd(a)) !== before) why.push(path.basename(a) + " differs from " + n + "-before.tsv");
      if (norm(rootHashes(r)) !== before) why.push(n + " as hashed now differs from " + n + "-before.tsv");
    }
    return { ok: !why.length, msg: wm.length + " worker file(s), " + merges + " merge run(s)" + tail(why) };
  });
  await gate(6, () => {
    const nc = new Set();
    for (const r of [ra, rb]) { const d = path.join(r, ".checks", "verdicts"); for (const f of fs.existsSync(d) ? fs.readdirSync(d).filter((x) => x.endsWith(".tsv")) : []) for (const l of (rd(path.join(d, f)) || "").split(/\r?\n/)) { const c = l.split("\t"); if ((c[1] || "").trim() === "NOT CHECKED") nc.add(c[0].trim()); } }
    const pagePass = rows.filter((r) => r.verdict === "PASS" && ck.byId.has(r.rule) && pageKind(ck.byId.get(r.rule)));
    const bad = pagePass.filter((r) => nc.has(r.rule) && !/covers (\d+) of \1 pages/.test(r.evidence)).map((r) => r.rule);
    return { ok: !!L && !bad.length, msg: pagePass.length + " PASS rows on html, http or browser rules" + (bad.length ? ": " + bad.length + " do not cover every page: " + bad.join(", ") : "") };
  });
  await gate(7, async () => {
    const why = [], pf = path.join(gates, "G7", "patches.tsv");
    if (!fs.existsSync(pf)) return { ok: false, msg: "no gates/G7/patches.tsv" };
    const psha = sha(fs.readFileSync(pf));
    if (!(rd(path.join(proof, ".claude", "POSITION.md")) || "").includes(psha)) why.push("POSITION does not hold the sha256 of gates/G7/patches.tsv (" + psha.slice(0, 12) + ")");
    const prow = tsv(pf).filter((r) => r[0] !== "script" && r.length >= 4).map(([s, f, from, to]) => ({ script: s.replace(/\\/g, "/"), file: f.replace(/\\/g, "/"), from: dec(from), to: dec(to) }));
    const backing = new Set(rows.filter((r) => r.verdict === "PASS").flatMap((r) => [...r.evidence.matchAll(SCRIPT_EXITS)].map((m) => m[1])).filter((n) => !/^check-x-/.test(n)));
    for (const n of backing) if (!prow.some((p) => path.basename(p.script) === n)) why.push(n + " backs a PASS and has no patch row");
    const worker = [ra, rb].flatMap((r) => { const d = path.join(r, ".checks", "scripts"); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^check-(?!x-|builtin-).*\.mjs$/.test(f)).sort().map((f) => ({ name: f, file: path.join(d, f), root: r })) : []; });
    const mine = prow.filter((p) => !p.script.includes(".checks/")).map((p) => ({ name: path.basename(p.script), file: path.resolve(cyc, p.script), root: p.script.startsWith("root-b/") ? rb : ra }));
    const queue = [...mine, ...bySeed(seed, worker, (w) => w.root + w.name).slice(0, 10)], tested = new Map(), removed = [];
    const copies = new Map(), copyOf = (r) => { if (!copies.has(r)) { const d = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-g7-")); fs.cpSync(r, d, { recursive: true, filter: (s) => !path.relative(r, s).split(path.sep).includes(".checks") }); copies.set(r, d); } return copies.get(r); };
    const runS = io.run || defaultRun;
    const withPatch = (copy, rel, from, to, fn) => { const f = path.join(copy, rel); if (!fs.existsSync(f)) return null; const orig = fs.readFileSync(f), t = orig.toString("utf8"); if (!t.includes(from)) return null; fs.writeFileSync(f, t.replace(from, () => to)); try { return fn(); } finally { fs.writeFileSync(f, orig); } };
    const COMMENT = { html: /<!--[\s\S]*?-->/, htm: /<!--[\s\S]*?-->/, css: /\/\*[\s\S]*?\*\//, js: /\/\*[\s\S]*?\*\/|^[ \t]*\/\/[^\n]*/m, mjs: /\/\*[\s\S]*?\*\/|^[ \t]*\/\/[^\n]*/m };
    const neutral = (copy, not) => { for (const rel of listFiles(copy).sort()) { const re = COMMENT[(rel.split(".").pop() || "").toLowerCase()]; if (rel === not || !re) continue; const t = fs.readFileSync(path.join(copy, rel), "utf8"), m = re.exec(t); if (!m) continue; const end = m.index + m[0].length - (m[0].endsWith("-->") ? 3 : m[0].endsWith("*/") ? 2 : 0); return { rel, from: m[0], to: t.slice(m.index, end) + " " + t.slice(end, m.index + m[0].length) }; } return null; };
    try {
      while (queue.length) {
        const s = queue.shift(), key = s.root + "|" + s.name;
        if (tested.has(key)) continue;
        const row = prow.find((p) => path.basename(p.script) === s.name && (p.script.startsWith("root-b/") ? rb : ra) === s.root) || prow.find((p) => path.resolve(cyc, p.script) === s.file), fails = [];
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-g7-empty-")), e = runS(s.file, empty).code; fs.rmSync(empty, { recursive: true, force: true });
        if (e !== 2) fails.push("exits " + e + " on an empty copy");
        const copy = copyOf(s.root), real = runS(s.file, copy), paged = /^\d+ pages$/.test((real.out || "").trim().split(/\r?\n/)[0] || "");
        if (row) {
          const p = withPatch(copy, row.file, row.from, row.to, () => runS(s.file, copy).code);
          if (p === null) fails.push("its patch 'from' is not in " + row.file); else if (p !== 1) fails.push("green under its patch (exit " + p + ")");
          if (paged) {
            const pages = pageList(copy), lastDir = pages[pages.length - 1] || "", lp = /^pages\/[^/]+\//.test(row.file) ? row.file.replace(/^pages\/[^/]+/, lastDir) : lastDir;
            if (lp !== row.file) { const q = withPatch(copy, lp, row.from, row.to, () => runS(s.file, copy).code); if (q === null) fails.push("its patch cannot be made in the last page " + lp); else if (q !== 1) fails.push("green under its patch in the last page " + lp + " (exit " + q + ")"); }
          }
        }
        const nf = neutral(copy, row?.file);
        if (!nf) fails.push("no unrelated file with a comment for the neutral patch");
        else { const n = withPatch(copy, nf.rel, nf.from, nf.to, () => runS(s.file, copy).code); if (n !== real.code) fails.push("its exit changes under the neutral patch in " + nf.rel + " (" + real.code + " -> " + n + ")"); }
        tested.set(key, fails);
        if (fails.length) {
          const rules = rows.filter((r) => r.evidence.includes(s.name)).map((r) => r.rule);
          removed.push(s.name + " removed (" + fails.join(", ") + "; rules " + (rules.join(", ") || "none") + " go NOT CHECKED)");
          const slice = (/^check-(.+)-\d+\.mjs$/.exec(s.name) || [])[1];
          if (slice) queue.push(...worker.filter((w) => w.root === s.root && w.name.startsWith("check-" + slice + "-")));
        }
      }
    } finally { for (const d of copies.values()) fs.rmSync(d, { recursive: true, force: true }); }
    why.push(...removed);
    const n = tested.size, red = [...tested.values()].filter((f) => !f.length).length;
    return { ok: !why.length, msg: "tested " + n + " script(s): " + red + " of " + n + " behave" + tail(why) };
  });
  await gate(8, () => {
    const nm = find("numbers.md");
    if (!nm) return { ok: false, msg: "no numbers.md" };
    const why = [], ls = rd(nm).split(/\r?\n/).filter((l) => l.includes("\t"));
    for (const l of ls) {
      const [label, value, f, n] = l.split("\t"), file = path.resolve(cyc, f || "");
      const line = f && fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file, "utf8").split(/\r?\n/)[Number(n) - 1] : undefined;
      if (line === undefined || !value || !line.includes(value)) why.push(label + ": " + value + " is not on " + f + ":" + n);
    }
    const missing = LABELS.filter((lb) => !ls.some((l) => l.split("\t")[0].startsWith(lb)));
    if (missing.length) why.push("no line for: " + missing.join(", "));
    return { ok: !why.length, msg: ls.length + " numbers, " + (LABELS.length - missing.length) + " of " + LABELS.length + " labels" + tail(why.slice(0, 8)) };
  });
  await gate(9, () => {
    const hd = path.join(cyc, "hand-overs"), count = new Map();
    for (const f of fs.existsSync(hd) ? fs.readdirSync(hd).filter((x) => x.endsWith(".md")) : []) { const m = /^rules:\s*(.*)$/.exec((rd(path.join(hd, f)) || "").split(/\r?\n/)[0]); for (const id of (m ? m[1].split(",") : []).map((x) => x.trim()).filter(Boolean)) count.set(id, (count.get(id) || 0) + 1); }
    const fw = rows.filter((r) => r.verdict === "FAIL" || r.verdict === "WARN").map((r) => r.rule), none = fw.filter((id) => !count.get(id)), many = fw.filter((id) => count.get(id) > 1);
    const why = [...(none.length ? ["in no hand-over: " + none.join(", ")] : []), ...(many.length ? ["in more than one hand-over: " + many.join(", ")] : [])];
    return { ok: !!L && !why.length, msg: fw.length + " FAIL and WARN ids" + tail(why) };
  });
  await gate(10, () => {
    const why = [], used = new Map([[path.join(HERE, "proof-gates.mjs"), null]]);
    for (const [h, p] of tsv(path.join(logs, "runs.tsv"))) if (p && /\.mjs$/i.test(p)) used.set(path.resolve(cyc, p), h);
    for (const [f, h] of used) {
      const now = fs.existsSync(f) ? sha(fs.readFileSync(f)) : "missing";
      if (h && now !== h) why.push(path.basename(f) + " changed since logs/runs.tsv hashed it");
      if (path.dirname(f) === HERE) { const m = (io.masterSha || defaultMasterSha)("skills/programmatic-enterprise-web-performance/scripts/" + path.basename(f)); if (m !== now) why.push(path.basename(f) + " differs from master" + (m ? "" : " (not on master)")); }
    }
    return { ok: !why.length, msg: used.size + " script(s)" + tail(why) };
  });
  await gate(11, () => {
    const marks = [cyc, proof].flatMap((p) => [p, p.replace(/\\/g, "/")]).map((s) => s.toLowerCase());
    const hits = String((io.bgProcs || defaultBg)()).split(/\r?\n/).filter((l) => !new RegExp("^\\s*(" + process.pid + "|" + process.ppid + ")\\s").test(l) && marks.some((m) => l.toLowerCase().includes(m)));
    return { ok: !hits.length, msg: hits.length ? hits.length + " process(es) naming this proof still running: " + hits.map((h) => h.trim().slice(0, 140)).join(" / ") : "no process names the proof folder" };
  });
  const all = Object.keys(results).length === 11 && Object.values(results).every(Boolean);
  if (all) say("ALL GATES PASS");
  return { code: all ? 0 : 1, lines };
}

if (isMain(import.meta.url)) {
  const r = await proofGates(process.argv.slice(2));
  for (const l of r.lines) (r.code === 2 ? console.error : console.log)(l);
  process.exit(r.code);
}
