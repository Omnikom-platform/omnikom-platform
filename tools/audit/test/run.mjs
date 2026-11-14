// Tests for tools/audit: the good site passes every rule, every bad fixture fails exactly its own rule, the runner's shapes and exit codes,
// the source wall, and the committed fixtures equal their generator. Lines start with "ok  " or "FAIL"; the last line is
// "OK: N of N checks passed" (exit 0) or "FAILED: n of N" (exit 1).
//   node tools/audit/test/run.mjs
// OMNIKOM_AUDIT_DIR points at a copy of tools/audit/ (test/mutate.mjs runs one broken copy at a time).
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIT = process.env.OMNIKOM_AUDIT_DIR ? resolve(process.env.OMNIKOM_AUDIT_DIR) : resolve(HERE, "..");
const FIX = join(AUDIT, "fixtures");
let failed = 0, total = 0;
const check = (name, ok, detail = "") => {
  total++; if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ": " + String(detail).slice(0, 400)}`);
  // OMNIKOM_AUDIT_FAILFAST=1 (set by test/mutate.mjs for its broken copies): stop at the first red check. The suite still prints that FAIL line and
  // exits 1, which is all the mutant harness needs to call it caught; a green run is never shortened. A normal run never sets it.
  if (!ok && process.env.OMNIKOM_AUDIT_FAILFAST === "1") { removeRoot(); console.log(`FAILED: ${failed} of ${total} (stopped at the first failure, OMNIKOM_AUDIT_FAILFAST=1)`); process.exit(1); }
};
const cliRaw = (args, audit = AUDIT) => { const r = spawnSync(process.execPath, [join(audit, "run.mjs"), ...args], { encoding: "utf8", timeout: 60000, env: childEnv }); return { status: r.status, out: r.stdout || "", err: r.stderr || "" }; };
// slice 4c flip (REQUIRE_TARGET_FOR_FOLDER = true): a built folder run must name its target. cli() and engine.audit() add `production` to a folder run that names none,
// so a test about another rule keeps judging what it judged; cliRaw and engineRaw.audit are the unchanged calls, used by the tests about the target itself.
const isFolder = (d) => { try { return statSync(d).isDirectory() && !(existsSync(join(d, "_site.json")) && existsSync(join(d, "pages"))); } catch { return false; } };
// The target goes right after the folder, never at the end: an option under test that is left with no value (--psi, --prompt-coverage) must stay valueless, or it would take --target as its value.
const cli = (args, audit = AUDIT) => { const at = args.findIndex((a) => !a.startsWith("--") && isFolder(a)); return args.includes("--target") || at < 0 ? cliRaw(args, audit) : cliRaw([...args.slice(0, at + 1), "--target", "production", ...args.slice(at + 1)], audit); };
const json = (args) => { const r = cli(["--json", ...args]); let j = null; try { j = JSON.parse(r.out); } catch {} return { ...r, j }; };
// Every temp folder of this run lives under ONE root, omnikom-audit-run-*, inside OMNIKOM_AUDIT_TMP (test/mutate.mjs sets it inside the broken copy) or
// the system temp folder. The root is removed in the finally below, at the first red check under FAILFAST, and on SIGINT/SIGTERM. A run that is killed
// outright (SIGKILL, the laptop sleeping) cannot clean up; then the root is left where the one who started it can find and remove it, and test/mutate.mjs
// starts every run inside a folder it removes itself. The children this run starts get TMPDIR, TEMP and TMP inside the root too.
const TMP_BASE = process.env.OMNIKOM_AUDIT_TMP ? resolve(process.env.OMNIKOM_AUDIT_TMP) : tmpdir();
mkdirSync(TMP_BASE, { recursive: true });
const ROOT = mkdtempSync(join(TMP_BASE, "omnikom-audit-run-"));
const tmps = [];
const tmp = (p = "omnikom-audit-") => { const d = mkdtempSync(join(ROOT, p)); tmps.push(d); return d; };
const childEnv = { ...process.env, TMPDIR: ROOT, TEMP: ROOT, TMP: ROOT };
const removeRoot = () => { try { rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {} };
process.on("SIGINT", () => { removeRoot(); process.exit(130); });
process.on("SIGTERM", () => { removeRoot(); process.exit(143); });
const FAIL_SHAPE = /^FAIL [A-Z0-9-]+ \S+:\d+ .+ \(source: .+\)$/;
const ruleOf = (name) => (name.match(/^(?:snapshot-)?bad-([A-Z0-9]+-\d{3})/) || [])[1];
// rules that judge only a snapshot (a built folder has no browser and no server): they print no line in folder mode
const SNAPSHOT_ONLY = new Set(["PRF-001", "PRF-016"]);
// work order 38: rules that judge the response headers: a snapshot has them, a folder only through its _headers file; the good folder has none, so it prints no line for them
const HEADERS_ONLY = new Set(["SEC-010", "SEC-075"]);
// slice 4c, the ruling of 2026-11-01 (final): a run with no target prints exactly ONE ENV-001 line, the site-wide `SKIP ENV-001 / no --target ...`, and no other ENV-001 line
const snapshotNoTargetSkipOnly = (j) => { const own = j.findings.filter((f) => f.rule === "ENV-001"), ls = j.lines.filter((l) => /ENV-001/.test(l)); return own.length === 1 && own[0].status === "SKIP" && own[0].page === "/" && own[0].what.startsWith("no --target") && ls.length === 1 && ls[0].startsWith("SKIP ENV-001 / no --target"); };
// slice 4c flip: ENV-001 as it must show on a run the helpers gave a target: a snapshot with no target prints the one SKIP above; a folder (always run with a target now) has no ENV-001 SKIP and prints its PASS lines
const envLineOk = (j) => (j.mode === "snapshot" ? snapshotNoTargetSkipOnly(j) : j.target !== null && !j.findings.some((f) => f.rule === "ENV-001" && f.status === "SKIP") && j.lines.some((l) => l.startsWith("PASS ENV-001 ")));
// the lines of a no-target run that are not the one ENV-001 SKIP (what the old "every line is PASS" checks look at)
// slice 5c: a run with no --prompt-coverage also prints exactly ONE site-wide `SKIP PMP-001 / no --prompt-coverage ...` line, and no other PMP-001 line
const noCoverageSkipOnly = (j) => { const own = j.findings.filter((f) => f.rule === "PMP-001"), ls = j.lines.filter((l) => /PMP-001/.test(l)); return own.length === 1 && own[0].status === "SKIP" && own[0].page === "/" && own[0].what.startsWith("no --prompt-coverage") && ls.length === 1 && ls[0].startsWith("SKIP PMP-001 / no --prompt-coverage"); };
// the lines of a no-target, no-coverage run that are not the two SKIP lines (what the old "every line is PASS" checks look at; the name is from slice 4c)
const exceptEnvSkip = (lines) => lines.filter((l) => !l.startsWith("SKIP ENV-001 / no --target") && !l.startsWith("SKIP PMP-001 / no --prompt-coverage"));
// the whole findings list of a no-target, no-coverage run on a clean site: exactly the two SKIPs
const skipsOnly = (j) => j.findings.length === (j.mode === "snapshot" ? 2 : 1) && envLineOk(j) && noCoverageSkipOnly(j);
const PMP_SOURCE = "planning/DECISIONS.md 35 (the prompt map; owner, 2026-10-31)";
const COVERAGE_REL = "plan/prompt-coverage.json";
const ENV_SOURCE = "factory/lib/launch.mjs headersText and factory/README.md (robots.txt always Allow, the preview kept out by X-Robots-Tag; head, 2026-10-31); head of operations, 2026-11-01 (slice 4c)";

try {
  // work order 33: the metrics collectors (tools/audit/metrics/); first, so a mutant of them is caught before the long checks run
  await (await import(pathToFileURL(join(AUDIT, "test", "metrics.mjs")).href)).metricsChecks({ check, AUDIT, SKILL: process.env.OMNIKOM_SKILL_DIR ? resolve(process.env.OMNIKOM_SKILL_DIR) : resolve(HERE, "..", "..", "..", "skills", "programmatic-enterprise-web-performance") });
  // work order 38: SEC-010 and SEC-075 (test/sec.mjs runs alone too: node tools/audit/test/sec.mjs)
  await (await import(pathToFileURL(join(AUDIT, "test", "sec.mjs")).href)).secChecks({ check, AUDIT, tmp });
  // TF-AUDIT-HARNESS: what test/mutate.mjs reads from a broken copy's run (test/harness.mjs runs alone too). OMNIKOM_AUDIT_SKIP_HARNESS=1
  // (set by test/mutate.mjs for every mutant except the [harness] ones) skips it; a run without that variable that lost it fails below
  const harnessFrom = total;
  if (process.env.OMNIKOM_AUDIT_SKIP_HARNESS !== "1") {
    await (await import(pathToFileURL(join(AUDIT, "test", "harness.mjs")).href)).harnessChecks({ check, AUDIT, tmp });
  }
  if (process.env.OMNIKOM_AUDIT_SKIP_HARNESS !== "1" && total === harnessFrom) check("harness: the harness checks did not run", false);
  // the rules the engine has, from --list
  const listed = cli(["--list"]);
  const rules = listed.out.split(/\r?\n/).filter(Boolean).map((l) => { const [id, severity, ...src] = l.trim().split(/\s+/); return { id, severity, source: src.join(" ") }; });
  const sevOf = Object.fromEntries(rules.map((r) => [r.id, r.severity]));
  const checkFiles = readdirSync(join(AUDIT, "checks")).filter((f) => f.endsWith(".mjs"));
  // a source is either a shipgate checklist line (checklist/<file>.md <ID>) or, for the DSN family, DECISIONS 37 with its origin credit (slice 4b)
  // the source of each DSN rule: the line(s) of the unslop copy in skills/unslop/ that the head named, then DECISIONS 37 and the credit
  const SGN = "skills/unslop/references/signs.md", SKM = "skills/unslop/SKILL.md", TAIL = "; planning/DECISIONS.md 37 (owner, 2026-10-31); unslop by Damir Sokolovsky, CC BY 4.0";
  const DSN_SOURCES = { "DSN-001": `${SGN}:85-86 and ${SKM}:170-171`, "DSN-002": `${SGN}:7-8 and ${SKM}:89`, "DSN-003": `${SGN}:27`, "DSN-004": `${SGN}:19`, "DSN-005": `${SGN}:47 and ${SKM}:110`, "DSN-006": `${SGN}:44 and ${SKM}:105`, "DSN-007": `${SGN}:43 and ${SKM}:106`, "DSN-008": `${SGN}:54 and ${SKM}:113`, "DSN-009": `${SGN}:71 and ${SKM}:111`, "DSN-010": `${SKM}:118`, "DSN-011": `${SGN}:22 and ${SKM}:121` };
  const sourceOk = (r) => (r.id === "ENV-001" ? r.source === ENV_SOURCE : r.id === "PMP-001" ? r.source === PMP_SOURCE : r.id.startsWith("DSN-") ? r.source === DSN_SOURCES[r.id] + TAIL : /^checklist\/\S+\.md [A-Z0-9-]+$/.test(r.source));
  check("--list: exit 0 and one line per check file, each with its severity and a source", listed.status === 0 && rules.length === checkFiles.length && rules.length > 0 && rules.every((r) => /^(P0|P1|P2|W)$/.test(r.severity) && sourceOk(r) && checkFiles.includes(r.id.toLowerCase() + ".mjs")), listed.out + listed.err);
  check("--list: ENV-001 is listed as P0 with the factory source", rules.some((r) => r.id === "ENV-001" && r.severity === "P0" && r.source === ENV_SOURCE), listed.out);
  check("--list: PMP-001 is listed as P0 with the DECISIONS 35 source", rules.some((r) => r.id === "PMP-001" && r.severity === "P0" && r.source === PMP_SOURCE), listed.out);
  check("--list: 32 rules, the 11 DSN rules among them, each P1 with the DECISIONS 37 source and the unslop credit", rules.length === 32 && rules.filter((r) => r.id.startsWith("DSN-")).length === 11 && Array.from({ length: 11 }, (_, i) => "DSN-" + String(i + 1).padStart(3, "0")).every((id) => rules.some((r) => r.id === id && r.severity === "P1" && r.source === DSN_SOURCES[id] + TAIL)), listed.out);

  // every check has its rules file, and the file carries the source and the spec path (a DSN rule: DECISIONS 37 and the unslop credit)
  const sourceless = rules.filter((r) => { const p = join(AUDIT, "rules", r.id + ".md"); if (!existsSync(p)) return true; const t = readFileSync(p, "utf8"); const specOk = r.id === "ENV-001" ? t.includes("factory/lib/launch.mjs headersText") : r.id === "PMP-001" ? t.includes("planning/DECISIONS.md 35") : r.id.startsWith("DSN-") ? t.includes("skills/unslop/") && t.includes("CC BY 4.0") && t.includes("Damir Sokolovsky") : /shipgate\/spec\/packs\/(web-delivery|accessibility|search-engines|performance|security)\.md/.test(t); return !t.includes(r.source) || !specOk || !t.includes("## Rule text") || !t.includes("## Judged here") || !t.includes("## Not judged here"); });
  check("every rule has rules/<ID>.md with its source, the spec path (a DSN rule: the unslop credit) and the rule text", sourceless.length === 0, sourceless.map((r) => r.id).join(", "));

  // the good site passes every rule, in text mode and in JSON
  const good = cli([join(FIX, "good")]);
  const goodLines = good.out.split(/\r?\n/).filter(Boolean);
  check("good site with --target production: exit 0, every line is PASS except exactly one `SKIP PMP-001 / no --prompt-coverage` line (no WARN, no FAIL, no other SKIP), four PASS ENV-001 lines", good.status === 0 && goodLines.length > 0 && goodLines.filter((l) => !l.startsWith("PASS ")).length === 1 && goodLines.filter((l) => l.startsWith("SKIP PMP-001 / no --prompt-coverage")).length === 1 && goodLines.filter((l) => l.startsWith("PASS ENV-001 ")).length === 4, good.out + good.err);
  const goodNone = cliRaw([join(FIX, "good")]);
  check("good site with no --target: exit 2, nothing on stdout, stderr names --target (slice 4c flip)", goodNone.status === 2 && goodNone.out === "" && /needs --target/.test(goodNone.err), goodNone.status + goodNone.out + goodNone.err);
  const gj = json([join(FIX, "good")]);
  const pagesN = gj.j ? gj.j.pages.length : 0;
  check("good site: one PASS line per rule per page or file, every rule present", gj.j && rules.filter((r) => !SNAPSHOT_ONLY.has(r.id) && !HEADERS_ONLY.has(r.id) && r.id !== "ENV-001" && r.id !== "PMP-001").every((r) => gj.j.lines.some((l) => l.startsWith(`PASS ${r.id} `))) && !gj.j.lines.some((l) => /^\w+ PRF-/.test(l)) && envLineOk(gj.j) && noCoverageSkipOnly(gj.j) && gj.j.lines.filter((l) => l.startsWith("PASS MET-003 ")).length === pagesN, gj.out.slice(0, 300));
  check("good site: --json is valid JSON, exit equals the process exit, pass true, no finding but the PMP-001 SKIP", gj.j && gj.j.exit === gj.status && gj.status === 0 && gj.j.pass === true && skipsOnly(gj.j) && Array.isArray(gj.j.pages) && Array.isArray(gj.j.rules) && gj.j.lines.length > 0, gj.out.slice(0, 300) + gj.err);

  // the bad fixtures, driven by the generator's own table
  const gen = await import(pathToFileURL(join(FIX, "build-fixtures.mjs")).href);
  const ALL = { ...gen.FIXTURES, ...gen.SNAPSHOT_FIXTURES };
  const names = Object.keys(ALL);
  const onDisk = readdirSync(FIX).filter((n) => n.startsWith("bad-") || n.startsWith("snapshot-bad-")).sort();
  const siteLib = await import(pathToFileURL(join(AUDIT, "lib", "site.mjs")).href);
  check("fixtures: a folder exists for every generator entry and the other way round", names.every((n) => onDisk.includes(n)) && onDisk.every((n) => names.includes(n)), `generator ${names.length}, disk ${onDisk.length}`);
  for (const rule of rules) check(`fixtures: rule ${rule.id} has at least one bad fixture`, names.some((n) => ruleOf(n) === rule.id), rule.id);
  let first = true;
  const engineRaw = await import(pathToFileURL(join(AUDIT, "index.mjs")).href);
  const engine = { ...engineRaw, audit: (dir, o) => engineRaw.audit(dir, o && o.target !== undefined ? o : !isFolder(dir) ? o : { ...o, target: "production" }) };
  const viaCli = new Set();
  for (const name of names) {
    const spec = ALL[name];
    // a fixture that carries several rules' tells (bad-DSN) lists every expected rule and its status; the check is exact in both directions:
    // each listed rule shows its status, no other rule shows anything, the exit is 1 (it is never a way to loosen a one-rule fixture)
    if (spec.multi) {
      const tgt = spec.target ? ["--target", spec.target] : [];
      const mr = engine.audit(join(FIX, name), spec.target ? { target: spec.target } : undefined);
      const want = Object.entries(spec.multi);
      const missing = want.filter(([id, st]) => !mr.findings.some((f) => f.rule === id && f.status === st)).map(([id, st]) => `${id} ${st}`);
      const stray = mr.findings.filter((f) => !(f.rule in spec.multi) || f.status === "SKIP").filter((f) => spec.target || !(f.rule === "ENV-001" && f.status === "SKIP")).filter((f) => !(f.rule === "PMP-001" && f.status === "SKIP")).map((f) => `${f.rule} ${f.status} ${f.page}:${f.line}`);
      const wrongStatus = mr.findings.filter((f) => f.rule in spec.multi && f.status !== spec.multi[f.rule]).map((f) => `${f.rule} ${f.status}`);
      const cl = cli([join(FIX, name), ...tgt]);
      const shown = cl.out.split(/\r?\n/).filter((l) => /^(FAIL|WARN) /.test(l)).map((l) => l.split(" ")[1]);
      check(`${name}: names all ${want.length} rules (${want.map(([id]) => id.slice(4)).join(",")}) with FAIL or WARN lines as listed, nothing else, exit 1`, missing.length === 0 && stray.length === 0 && wrongStatus.length === 0 && (spec.target || envLineOk(mr)) && noCoverageSkipOnly(mr) && mr.exit === 1 && cl.status === 1 && want.every(([id]) => shown.includes(id)) && cl.out.split(/\r?\n/).filter((l) => /^(FAIL|WARN) /.test(l)).every((l) => FAIL_SHAPE.test(l.replace(/^WARN /, "FAIL "))), `missing ${missing.join(", ")}; stray ${stray.join(" | ")}; wrong ${wrongStatus.join(", ")}; exit ${mr.exit}/${cl.status}`);
      continue;
    }
    const rule = ruleOf(name);
    const snap = name.startsWith("snapshot-");
    let dir = join(FIX, name);
    if (spec.setup) { dir = join(tmp(), name); cpSync(join(FIX, name), dir, { recursive: true }); spec.setup(dir); }
    // the first fixture of each rule goes through the real command line; the rest call audit() in this process (same engine, ~50x faster)
    let r;
    const cov = spec.coverage ? join(dir, spec.coverage) : null;
    const tgtArgs = [...(spec.target ? ["--target", spec.target] : []), ...(cov ? ["--prompt-coverage", cov] : [])];
    if (!viaCli.has(rule)) { viaCli.add(rule); r = json([dir, ...tgtArgs]); } else { try { const j0 = engine.audit(dir, { ...(spec.target ? { target: spec.target } : {}), ...(cov ? { promptCoverage: cov } : {}) }); r = { status: j0.exit, out: "", err: "", j: JSON.parse(JSON.stringify(j0)) }; } catch (e) { r = { status: null, out: "", err: String(e.stack), j: null }; } }
    const j = r.j;
    // status: the status of the rule's own finding (FAIL, WARN, SKIP, or PASS = none); also: rules whose findings are expected too
    // (one fact breaks two rules). A snapshot fixture must give exactly its rule's finding and nothing else, of any status.
    const wantStatus = spec.status || (sevOf[rule] === "W" ? "WARN" : "FAIL");
    const own = j ? j.findings.filter((f) => f.rule === rule && f.status === wantStatus) : [];
    const allowed = new Set([rule, ...(spec.also || [])]);
    // the DSN fixtures are held to the strict form (no finding of any status from another rule), in folder mode as well
    const strict = snap || /^DSN-/.test(rule);
    const foreignFails = j ? (strict ? j.findings.filter((f) => !allowed.has(f.rule) && !(f.rule === "ENV-001" && f.status === "SKIP" && !spec.target) && !(f.rule === "PMP-001" && f.status === "SKIP" && !spec.coverage)) : j.findings.filter((f) => f.rule !== rule && f.status === "FAIL")) : [];
    // slice 4c: a fixture that gives no target must show exactly one ENV-001 line, the SKIP "no --target", and no other ENV-001 line
    const ntOk = j ? (!!spec.target || rule === "ENV-001" || envLineOk(j)) && (!!spec.coverage || rule === "PMP-001" || noCoverageSkipOnly(j)) : false;
    const ownOther = strict && j ? j.findings.filter((f) => f.rule === rule).length - own.length : 0;
    let snapPages = null;
    const lineText = (pg, n) => {
      try {
        if (snap) {
          if (/^(site|psi)\//.test(pg)) return readFileSync(join(dir, pg), "utf8").split(/\r?\n/)[n - 1] || "";
          snapPages ||= siteLib.loadSite(dir).pages;
          return snapPages.get(pg).raw.split(/\r?\n/)[n - 1] || "";
        }
        return readFileSync(pg.endsWith("/") ? join(dir, pg.slice(1), "index.html") : join(dir, pg), "utf8").split(/\r?\n/)[n - 1] || "";
      } catch { return ""; }
    };
    const pass = wantStatus === "PASS";
    const right = pass || own.some((f) => f.what.includes(spec.expect) && (!spec.at || lineText(f.page, f.line).includes(spec.at)));
    const countOk = pass ? j && j.findings.filter((f) => f.rule === rule).length === 0 && j.lines.some((l) => l.startsWith(`PASS ${rule} `)) : own.length === (spec.count ?? 1);
    const wantExit = wantStatus === "FAIL" || (spec.also && spec.also.length) ? 1 : 0;
    check(`${name}: ${wantStatus} ${rule} naming "${spec.expect}", ${snap ? "no other rule's finding" + (spec.also && spec.also.length ? " but " + spec.also.join(", ") : "") : "no FAIL from any other rule"}, exit ${wantExit}`,
      j && countOk && right && foreignFails.length === 0 && ntOk && ownOther === 0 && r.status === wantExit && j.exit === r.status,
      j ? `own ${own.map((f) => f.what).join(" | ")}; foreign ${foreignFails.map((f) => f.rule + " " + f.page + ":" + f.line + " " + f.what).join(" | ")}; exit ${r.status}` : r.out + r.err);
    if (j) {
      const failLines = j.lines.filter((l) => l.startsWith("FAIL "));
      check(`${name}: every FAIL line is "FAIL <rule> <page>:<line> <what> (source: <checklist file>)"`, failLines.every((l) => FAIL_SHAPE.test(l)) && (wantStatus !== "FAIL" || failLines.length > 0), failLines.filter((l) => !FAIL_SHAPE.test(l)).join(" | "));
    }
    if (first && wantStatus === "FAIL") { // text mode prints the same lines as --json, and exits 1
      first = false;
      const t = cli([dir, ...tgtArgs]);
      check(`${name}: text mode prints the --json lines and exits 1`, t.status === 1 && j && t.out.split(/\r?\n/).filter(Boolean).join("\n") === j.lines.join("\n"), t.out);
    }
  }

  // runner: --only limits the rules, bad usage exits 2
  const only = json([join(FIX, "good"), "--only", "MET-003"]);
  check("--only MET-003: only MET-003 lines, only that rule in the result", only.j && only.j.lines.length === only.j.pages.length && only.j.lines.every((l) => l.startsWith("PASS MET-003 ")) && only.j.rules.length === 1 && only.j.rules[0].id === "MET-003", only.out.slice(0, 300));
  const onlyBad = cli([join(FIX, "bad-MET-003"), "--only", "MET-003"]);
  check("--only on a bad fixture: the FAIL still shows and the exit is 1", onlyBad.status === 1 && /^FAIL MET-003 /m.test(onlyBad.out), onlyBad.out);
  const otherRule = rules.find((r) => r.id !== "MET-003");
  if (otherRule) {
    const onlyOther = cli([join(FIX, "bad-MET-003"), "--only", otherRule.id]);
    check(`--only ${otherRule.id} on bad-MET-003: no MET-003 line and exit 0`, onlyOther.status === 0 && !/MET-003/.test(onlyOther.out), onlyOther.out);
  }
  const unknown = cli([join(FIX, "good"), "--only", "NOPE-999"]);
  check("--only with an unknown rule id exits 2", unknown.status === 2 && /unknown rule id/.test(unknown.err), unknown.err);
  check("a missing folder exits 2", cli([join(FIX, "does-not-exist")]).status === 2);
  check("no folder exits 2 with the usage line", (() => { const r = cli([]); return r.status === 2 && /usage:/.test(r.err); })());
  check("an unknown option exits 2", cli([join(FIX, "good"), "--nope"]).status === 2);

  // configuration: the length numbers are overridable and checked (WCF-004)
  let d = tmp(); cpSync(join(FIX, "good"), d, { recursive: true });
  writeFileSync(join(d, "audit.config.json"), JSON.stringify({ titleLength: { warnMin: 50, warnMax: 40, hardMax: 70 } }), "utf8");
  const badCfg = cli([d]);
  check("audit.config.json with warnMin >= warnMax exits 2 naming WCF-004", badCfg.status === 2 && /WCF-004/.test(badCfg.err), badCfg.err);
  writeFileSync(join(d, "audit.config.json"), JSON.stringify({ titleLength: { warnMin: 30, warnMax: 60, hardMax: 50 } }), "utf8");
  check("audit.config.json with warnMax > hardMax exits 2", cli([d]).status === 2);

  // the source wall: a check without its rules file is refused
  const copy = tmp("omnikom-audit-copy-");
  for (const n of readdirSync(AUDIT)) if (n !== ".tmp") cpSync(join(AUDIT, n), join(copy, n), { recursive: true });
  const m3 = readFileSync(join(copy, "checks", "met-003.mjs"), "utf8");
  writeFileSync(join(copy, "checks", "zzz-001.mjs"), m3.split('"MET-003"').join('"ZZZ-001"'), "utf8");
  const refused = cli([join(FIX, "good")], copy);
  check("a check with no rules/<ID>.md is refused: exit 2 and 'admitted only with a source'", refused.status === 2 && /admitted only with a source/.test(refused.err), refused.err + refused.out);
  writeFileSync(join(copy, "rules", "ZZZ-001.md"), "# ZZZ-001\nSource: planted for the test\n", "utf8");
  const admitted = cli([join(FIX, "good")], copy);
  check("the same check with its rules file is admitted", admitted.status === 0 && /^PASS ZZZ-001 /m.test(admitted.out), admitted.err + admitted.out);

  // fixtures equal their generator, and nothing in this folder carries an em dash
  const built = gen.buildAll();
  const problems = gen.diffAgainstDisk(built, FIX);
  check("every committed fixture equals the generator output (no stale folder, no missing or extra file)", problems.length === 0, problems.slice(0, 3).join(" | "));
  const emdash = String.fromCharCode(0x2014);
  const offenders = [];
  const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(mjs|md|json|html|xml|txt|svg)$/.test(e.name) && readFileSync(p, "utf8").includes(emdash)) offenders.push(p.slice(AUDIT.length)); else if (/\.gz$/.test(e.name) && zlib.gunzipSync(readFileSync(p)).toString("utf8").includes(emdash)) offenders.push(p.slice(AUDIT.length)); } };
  walk(AUDIT);
  check("no file under tools/audit contains an em dash", offenders.length === 0, offenders.join(", "));

  // ad-hoc cases on a temp copy of the good site: parts that cannot be a clean bad fixture (breaking them breaks a second rule) and
  // the passing sides of a rule (a mutant that over-fails or under-fails there must still be caught)
  const adhoc = (name, edit, assertion) => {
    const dir = tmp(); cpSync(join(FIX, "good"), dir, { recursive: true });
    let j = null, err = "";
    try { edit(dir); j = engine.audit(dir); } catch (e) { err = String(e.stack || e); }
    let ok = false;
    try { ok = !!j && assertion(j); } catch (e) { err = String(e.stack || e); }
    check(name, ok, err || (j ? j.lines.filter((l) => !l.startsWith("PASS ")).join(" | ") : ""));
  };
  const sub = (file, from, to) => (dir) => { const p = join(dir, file); const t = readFileSync(p, "utf8"); if (!t.includes(from)) throw new Error(`ad-hoc edit: ${file}: text not found: ${from}`); writeFileSync(p, t.split(from).join(to), "utf8"); };
  const failsOf = (j, rule) => j.findings.filter((f) => f.rule === rule && f.status === "FAIL");
  const O = "https://www.brindlewood-tea.example";
  const JA14 = "ブリンドウッド紅茶店のご案内";
  adhoc("SE-202: a Japanese page with a 14 character title passes (the zh/ja/ko minimum is 10)", (d) => { sub("about/index.html", '<html lang="en">', '<html lang="ja-JP">')(d); sub("about/index.html", "About Brindlewood Tea Co.: Our Blenders and Our Story", JA14)(d); }, (j) => failsOf(j, "SE-202").length === 0);
  adhoc("SE-202: an English page with a 14 character title fails (the minimum is 20)", sub("about/index.html", "About Brindlewood Tea Co.: Our Blenders and Our Story", "Brindlewood Tea"), (j) => failsOf(j, "SE-202").length === 1);
  adhoc("MET-001: a <title> inside an <svg> is not counted and an alt-less decorative svg is not an image", (d) => { sub("about/index.html", "<h2>The blenders</h2>", '<h2>The blenders</h2>\n<svg viewBox="0 0 4 4"><title>Leaf icon</title></svg>')(d); sub("about/index.html", "</head>", '<svg viewBox="0 0 4 4"><title>Sprite</title></svg>\n</head>')(d); }, (j) => failsOf(j, "MET-001").length === 0 && failsOf(j, "A11-007").length === 0);
  adhoc("MET-001: the same title in two different locales is not a duplicate", (d) => { sub("tasting-room/index.html", "Tasting Room: Sample Loose-Leaf Tea in Person", "About Brindlewood Tea Co.: Our Blenders and Our Story")(d); sub("tasting-room/index.html", '<html lang="en">', '<html lang="en-GB">')(d); }, (j) => failsOf(j, "MET-001").length === 0);
  adhoc("MET-004: a title or description outside the range is a WARN and the run still passes", sub("about/index.html", "About Brindlewood Tea Co.: Our Blenders and Our Story", "About Brindlewood Tea Co.: Our Blenders and Our Story, Updated"), (j) => j.exit === 0 && j.findings.some((f) => f.rule === "MET-004" && f.status === "WARN"));
  adhoc("MET-004: the numbers come from options.config (a range that holds the good titles gives no WARN)", (d) => sub("about/index.html", "About Brindlewood Tea Co.: Our Blenders and Our Story", "About Brindlewood Tea Co.: Our Blenders and Our Story, Updated")(d), (j) => { const r = engine.audit(j.dir, { config: { titleLength: { warnMin: 30, warnMax: 90, hardMax: 100 } } }); return r.findings.every((f) => f.rule !== "MET-004"); });
  adhoc("URL-009: a canonical that is not an absolute https URL fails", sub("about/index.html", `<link rel="canonical" href="${O}/about/">`, '<link rel="canonical" href="/about/">'), (j) => failsOf(j, "URL-009").some((f) => f.what.includes("not an absolute https:// URL")));
  adhoc("URL-009: an http:// canonical fails", sub("about/index.html", `<link rel="canonical" href="${O}/about/">`, `<link rel="canonical" href="${O.replace("https", "http")}/about/">`), (j) => failsOf(j, "URL-009").some((f) => f.what.includes("not an absolute https:// URL")));
  adhoc("URL-009: an hreflang to another page of the folder must be that page's canonical", sub("about/index.html", `<link rel="alternate" hreflang="en" href="${O}/about/">`, `<link rel="alternate" hreflang="en" href="${O}/about/">\n<link rel="alternate" hreflang="fr" href="${O}/tasting-room">`), (j) => failsOf(j, "URL-009").some((f) => f.what.includes("hreflang fr")));
  adhoc("URL-009: a noindex page is not judged (no canonical needed)", (d) => { sub("about/index.html", `<link rel="canonical" href="${O}/about/">\n`, "")(d); sub("about/index.html", '<meta property="og:type" content="website">', '<meta property="og:type" content="website">\n<meta name="robots" content="noindex">')(d); sub("sitemap.xml", `  <url>\n    <loc>${O}/about/</loc>\n    <lastmod>2026-09-21T14:40:00Z</lastmod>\n  </url>\n`, "")(d); }, (j) => failsOf(j, "URL-009").length === 0);
  adhoc("IDX-002: a relative <loc> fails as not absolute", sub("sitemap.xml", `<loc>${O}/about/</loc>`, "<loc>/about/</loc>"), (j) => failsOf(j, "IDX-002").some((f) => f.what.includes("not an absolute URL")));
  adhoc("IDX-002: a sitemap that is a <sitemapindex> over two files passes", (d) => {
    sub("sitemap.xml", "<urlset", "<urlset")(d);
    const idx = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <sitemap>\n    <loc>${O}/sitemap-a.xml</loc>\n  </sitemap>\n  <sitemap>\n    <loc>${O}/sitemap-b.xml</loc>\n  </sitemap>\n</sitemapindex>\n`;
    const blocks = readFileSync(join(d, "sitemap.xml"), "utf8").match(/  <url>[\s\S]*?<\/url>\n/g);
    const wrap = (b) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${b.join("")}</urlset>\n`;
    writeFileSync(join(d, "sitemap-a.xml"), wrap(blocks.slice(0, 2)), "utf8"); writeFileSync(join(d, "sitemap-b.xml"), wrap(blocks.slice(2)), "utf8"); writeFileSync(join(d, "sitemap.xml"), idx, "utf8");
  }, (j) => failsOf(j, "IDX-002").length === 0 && failsOf(j, "IDX-001").length === 0 && failsOf(j, "IDX-004").length === 0);
  adhoc("a folder with no sitemap: IDX-002, SE-004 and IDX-003 say SKIP (never PASS), IDX-001 fails", (d) => unlinkSync(join(d, "sitemap.xml")), (j) => ["IDX-002", "SE-004", "IDX-003"].every((r) => j.lines.some((l) => l.startsWith(`SKIP ${r} sitemap.xml `)) && !j.lines.some((l) => l.startsWith(`PASS ${r} `))) && failsOf(j, "IDX-001").length === 1);
  adhoc("IDX-004: Allow of equal length beats Disallow, and a longer Allow beats a shorter Disallow", sub("robots.txt", "Disallow: /private/\n", "Disallow: /about/\nAllow: /about/\nDisallow: /tasting\nAllow: /tasting-room/\n"), (j) => failsOf(j, "IDX-004").length === 0);
  adhoc("IDX-004: Disallow: / blocks every page and the sitemap", sub("robots.txt", "Disallow: /private/\n", "Disallow: /\n"), (j) => failsOf(j, "IDX-004").length === 5);
  adhoc("IDX-004: a Disallow for another bot (GPTBot) is not an indexing problem", sub("robots.txt", "User-agent: *\n", "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\n"), (j) => failsOf(j, "IDX-004").length === 0);
  adhoc("A11-007: an area or image button named by aria-label needs no alt", (d) => { sub("index.html", ' alt="Tasting room"', ' aria-label="Tasting room"')(d); sub("index.html", ' alt="Book a tasting"', ' aria-labelledby="book"')(d); }, (j) => failsOf(j, "A11-007").length === 0);
  adhoc("A11-007: role=none marks an image decorative; a missing alt on a plain image still fails", (d) => { sub("index.html", 'role="presentation"', 'role="none"')(d); }, (j) => failsOf(j, "A11-007").length === 0);
  adhoc("LNK-002: an absolute link to the site's own host, fragments, mailto and external links are judged or ignored correctly", sub("about/index.html", "</main>", `<p><a href="${O}/tasting-room/#flight">own host</a> <a href="#top">top</a> <a href="mailto:hello@brindlewood-tea.example">mail</a> <a href="https://elsewhere.example/missing/">out</a> <a href="../tasting-room/">relative</a></p>\n</main>`), (j) => failsOf(j, "LNK-002").length === 0);
  adhoc("LNK-002: an absolute link to the site's own host that lands on no page fails", sub("about/index.html", "</main>", `<p><a href="${O}/nowhere/">own host</a></p>\n</main>`), (j) => failsOf(j, "LNK-002").length === 1);
  adhoc("SE-004: a lastmod with fractional seconds and an offset passes; one with no seconds fails", sub("sitemap.xml", "2026-10-02T08:15:00Z", "2026-10-02T08:15"), (j) => failsOf(j, "SE-004").length === 1 && failsOf(j, "SE-004")[0].what.includes("no timezone"));
  adhoc("SE-004: a sitemap entry with no lastmod at all passes", sub("sitemap.xml", "    <lastmod>2026-10-02T08:15:00Z</lastmod>\n", ""), (j) => failsOf(j, "SE-004").length === 0);
  adhoc("SCH-001: a page that is a subtype (ContactPage) with its own @id passes", sub("about/index.html", '"@type": "AboutPage"', '"@type": ["ContactPage", "Thing"]'), (j) => failsOf(j, "SCH-001").length === 0);
  adhoc("URL-009: an hreflang to another page that is that page's canonical passes", sub("about/index.html", `<link rel="alternate" hreflang="en" href="${O}/about/">`, `<link rel="alternate" hreflang="en" href="${O}/about/">\n<link rel="alternate" hreflang="fr" href="${O}/tasting-room/">`), (j) => failsOf(j, "URL-009").length === 0);
  adhoc("SCH-001: when the home page has lost its Organization node every other page's reference to it is unresolved", sub("index.html", `"@type": "Organization",\n      "@id": "${O}/#organization",`, `"@type": "Organization",\n      "@id": "${O}/#org",`), (j) => failsOf(j, "SCH-001").some((f) => f.page === "/about/" && f.what.includes("resolves to no node")));
  adhoc("IDX-001: a noindex page listed under a non-canonical URL is still a noindex finding", (d) => { sub("about/index.html", '<meta property="og:type" content="website">', '<meta property="og:type" content="website">\n<meta name="robots" content="noindex">')(d); sub("sitemap.xml", `<loc>${O}/about/</loc>`, `<loc>${O}/about.html</loc>`)(d); }, (j) => failsOf(j, "IDX-001").length === 1 && failsOf(j, "IDX-001")[0].what.includes("noindex"));
  adhoc("IDX-002: a file that is neither a urlset nor a sitemapindex fails", sub("sitemap.xml", "<urlset", "<urlsets"), (j) => failsOf(j, "IDX-002").some((f) => f.what.includes("neither a <urlset> nor a <sitemapindex>")));
  // IDX-003 on the committed bad fixture, with the sitemap written at the lastmod time or not, and with fewer than five URLs or spread lastmods
  const idx3 = (name, edit, assertion) => {
    const dir = tmp(); cpSync(join(FIX, "bad-IDX-003"), dir, { recursive: true });
    let j = null, err = "";
    try { edit(dir); j = engine.audit(dir); } catch (e) { err = String(e.stack || e); }
    let ok = false; try { ok = !!j && assertion(j); } catch (e) { err = String(e.stack || e); }
    check(name, ok, err || (j ? j.lines.filter((l) => !l.startsWith("PASS ")).join(" | ") : ""));
  };
  const stamp = (dir, iso) => { const t = new Date(iso); utimesSync(join(dir, "sitemap.xml"), t, t); };
  const warnsIdx3 = (j) => j.findings.some((f) => f.rule === "IDX-003" && f.status === "WARN");
  idx3("IDX-003: five URLs with one lastmod written at that time give the WARN", (d) => stamp(d, "2026-10-30T09:00:00Z"), warnsIdx3);
  idx3("IDX-003: the same sitemap written long after its lastmod (a real content date) gives no WARN", (d) => stamp(d, "2026-10-30T14:00:00Z"), (j) => !warnsIdx3(j));
  idx3("IDX-003: only four URLs sharing a lastmod give no WARN", (d) => { sub("sitemap.xml", `  <url>\n    <loc>${O}/contact/</loc>\n    <lastmod>2026-10-30T09:00:00Z</lastmod>\n  </url>\n`, "")(d); stamp(d, "2026-10-30T09:00:00Z"); }, (j) => !warnsIdx3(j));
  idx3("IDX-003: five URLs whose lastmods are spread over two hours give no WARN", (d) => { sub("sitemap.xml", `<loc>${O}/about/</loc>\n    <lastmod>2026-10-30T09:00:00Z`, `<loc>${O}/about/</loc>\n    <lastmod>2026-10-30T07:00:00Z`)(d); stamp(d, "2026-10-30T09:00:00Z"); }, (j) => !warnsIdx3(j));
  // ---- slice 2: snapshot mode ----
  const SG = join(FIX, "snapshot-good");
  const SO = "https://example-tea.invalid";
  const snapAdhoc = (name, edit, assertion, opts) => {
    const dir = tmp(); cpSync(SG, dir, { recursive: true });
    let j = null, err = "";
    try { edit(dir); j = engine.audit(dir, opts); } catch (e) { err = String(e.stack || e); }
    let ok = false;
    try { ok = !!j && assertion(j, dir); } catch (e) { err = String(e.stack || e); }
    check(name, ok, err || (j ? j.lines.filter((l) => !l.startsWith("PASS ")).join(" | ") : ""));
  };
  const seq = (...fns) => (dir) => fns.forEach((fn) => fn(dir));
  const jedit = (file, fn) => (dir) => { const p = join(dir, file); const o = JSON.parse(readFileSync(p, "utf8")); fn(o); writeFileSync(p, JSON.stringify(o, null, 1) + "\n", "utf8"); };
  const gzSub = (slug, from, to) => (dir) => { const p = join(dir, "pages", slug, "raw.html.gz"); const t = zlib.gunzipSync(readFileSync(p)).toString("utf8"); if (!t.includes(from)) throw new Error(`gzSub: ${slug}: text not found: ${from}`); writeFileSync(p, zlib.gzipSync(t.split(from).join(to))); };
  const addRec = (slug, url, finalUrl, status, chain, html) => (dir) => { mkdirSync(join(dir, "pages", slug), { recursive: true }); writeFileSync(join(dir, "pages", slug, "response.json"), JSON.stringify({ url, finalUrl, status, chain, headers: {}, ttfbMs: 100 }), "utf8"); if (html !== undefined) writeFileSync(join(dir, "pages", slug, "raw.html.gz"), zlib.gzipSync(html)); };
  const linkTo = (href) => gzSub("about", "</main>", `<p><a href="${href}">x</a></p>
</main>`);
  const lab = (key, v) => jedit("pages/home/browser-mobile.json", (m) => { m.vitals[key] = v; });
  const ownOf = (j, rule, status) => j.findings.filter((f) => f.rule === rule && (!status || f.status === status));
  const psiDoc = (lcpMs, strategy = "mobile", url = SO + "/") => JSON.stringify({ generatedAt: "2026-10-30T09:12:00.000Z", pages: [{ url, strategy, performance: 40, lcpMs, cls: 0.02, tbtMs: 100 }] });
  const putFile = (rel, text) => (dir) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };

  const sgJson = json([SG]);
  check("snapshot-good: exit 0, every line PASS except the one `SKIP ENV-001 / no --target` and the one `SKIP PMP-001 / no --prompt-coverage`, mode snapshot, all 30 other rules present, no folder-only line", sgJson.status === 0 && sgJson.j && sgJson.j.mode === "snapshot" && skipsOnly(sgJson.j) && rules.filter((r) => r.id !== "ENV-001" && r.id !== "PMP-001").every((r) => sgJson.j.lines.some((l) => l.startsWith(`PASS ${r.id} `))) && exceptEnvSkip(sgJson.j.lines).every((l) => l.startsWith("PASS ")) && sgJson.j.pages.length === 4, sgJson.out.slice(0, 300) + sgJson.err);
  check("--list shows SE-001, PRF-001 and PRF-016 with their severity and source", ["SE-001 P0 checklist/search-engines.md SE-001", "PRF-001 P2 checklist/performance.md PRF-001", "PRF-016 P2 checklist/performance.md PRF-016"].every((s) => listed.out.split(/\r?\n/).some((l) => l.trim().split(/\s+/).join(" ") === s)), listed.out);
  check("the good folder prints no PRF line (the speed rules need a snapshot) and its audit() result says mode static", (() => { const r = engine.audit(join(FIX, "good")); return r.mode === "static" && !r.lines.some((l) => /PRF-/.test(l)); })());

  // PRF-001: each threshold, both sides of it
  snapAdhoc("PRF-001: LCP exactly 2500 ms passes", lab("lcpMs", 2500), (j) => ownOf(j, "PRF-001").length === 0);
  snapAdhoc("PRF-001: LCP 2501 ms fails", lab("lcpMs", 2501), (j) => ownOf(j, "PRF-001", "FAIL").length === 1 && j.exit === 1);
  snapAdhoc("PRF-001: CLS exactly 0.1 passes", lab("cls", 0.1), (j) => ownOf(j, "PRF-001").length === 0);
  snapAdhoc("PRF-001: CLS 0.101 fails", lab("cls", 0.101), (j) => ownOf(j, "PRF-001", "FAIL").length === 1);
  snapAdhoc("PRF-001: TBT exactly 200 ms passes", lab("tbtMs", 200), (j) => ownOf(j, "PRF-001").length === 0);
  snapAdhoc("PRF-001: TBT 201 ms fails", lab("tbtMs", 201), (j) => ownOf(j, "PRF-001", "FAIL").length === 1);
  snapAdhoc("PRF-001: three parts over budget are three findings", seq(lab("lcpMs", 3000), lab("cls", 0.3), lab("tbtMs", 400)), (j) => ownOf(j, "PRF-001", "FAIL").length === 3);
  snapAdhoc("PRF-001: the numbers come from options.config (lcpMs 4000 lets 3100 pass)", lab("lcpMs", 3100), (j, d) => ownOf(engine.audit(d, { config: { speed: { lcpMs: 4000 } } }), "PRF-001").length === 0 && ownOf(j, "PRF-001", "FAIL").length === 1);
  snapAdhoc("PRF-001: the numbers come from audit.config.json (lcpMs 3000 fails 3100 ms with that limit in the text)", seq(lab("lcpMs", 3100), putFile("audit.config.json", '{ "speed": { "lcpMs": 3000 } }\n')), (j) => ownOf(j, "PRF-001", "FAIL").some((f) => f.what.includes("LCP 3100 ms > 3000 ms")));
  snapAdhoc("PRF-001: a flat { lcpMs, cls, tbtMs } browser file is read too", putFile("pages/home/browser-mobile.json", JSON.stringify({ lcpMs: 3100, cls: 0.02, tbtMs: 50 })), (j) => ownOf(j, "PRF-001", "FAIL").length === 1);
  snapAdhoc("PRF-001: a metric that is null is a SKIP for that metric, not a PASS and not a FAIL", lab("lcpMs", null), (j) => ownOf(j, "PRF-001", "SKIP").some((f) => f.what.includes("LCP not measured")) && ownOf(j, "PRF-001", "FAIL").length === 0 && !j.lines.includes("PASS PRF-001 /"));
  snapAdhoc("PRF-001: a page with no browser file is SKIP not measured", (d) => unlinkSync(join(d, "pages", "home", "browser-mobile.json")), (j) => j.lines.some((l) => l.startsWith("SKIP PRF-001 / not measured")) && j.exit === 0);
  // PRF-001 trust: an untrusted lab number is not a finding
  snapAdhoc("PRF-001: no speedTrust recorded is treated as untrusted (SKIP), the over-budget number is not judged", seq(lab("lcpMs", 3100), jedit("_site.json", (m) => { delete m.pages[0].speedTrust; })), (j) => ownOf(j, "PRF-001", "SKIP").some((f) => f.what.includes("no speedTrust recorded")) && ownOf(j, "PRF-001", "FAIL").length === 0);
  snapAdhoc("PRF-001: UNTRUSTED with a PSI file that holds only another page stays SKIP", seq(lab("lcpMs", 3100), jedit("_site.json", (m) => { m.pages[0].speedTrust = "UNTRUSTED: machine busy (cpu avg 80%)"; }), putFile("psi/2026-10-30.json", psiDoc(3400, "mobile", SO + "/about/"))), (j) => ownOf(j, "PRF-001", "SKIP").length === 1 && ownOf(j, "PRF-001", "FAIL").length === 1 && ownOf(j, "PRF-001", "FAIL")[0].page === "/about/");
  // PRF-001 PSI preference
  snapAdhoc("PRF-001: a PSI mobile number is judged instead of a trusted lab number, and the line says so", putFile("psi/2026-10-30.json", psiDoc(3400)), (j) => ownOf(j, "PRF-001", "FAIL").length === 1 && j.lines.some((l) => l.startsWith("FAIL PRF-001 /:1 ") && l.includes("LCP 3400 ms > 2500 ms (source: PSI 2026-10-30)")));
  snapAdhoc("PRF-001: a PSI desktop number is not used", seq(lab("lcpMs", 3100), putFile("psi/2026-10-30.json", psiDoc(1000, "desktop"))), (j) => ownOf(j, "PRF-001", "FAIL").length === 1 && !j.lines.some((l) => l.includes("source: PSI")));
  snapAdhoc("PRF-001: the newest psi/<date>.json by name is the one used", seq(putFile("psi/2026-10-29.json", psiDoc(3400)), putFile("psi/2026-10-30.json", psiDoc(1900))), (j) => ownOf(j, "PRF-001").length === 0);
  snapAdhoc("PRF-001: a PSI url on the www counterpart host matches the page", putFile("psi/2026-10-30.json", psiDoc(3400, "mobile", "https://www.example-tea.invalid/")), (j) => ownOf(j, "PRF-001", "FAIL").length === 1);
  const psiBad = tmp(); cpSync(SG, psiBad, { recursive: true }); writeFileSync(join(psiBad, "psi.json"), "{ nope", "utf8");
  check("a PSI file that is not valid JSON exits 2", cli([psiBad, "--psi", join(psiBad, "psi.json")]).status === 2);
  writeFileSync(join(psiBad, "psi-nopages.json"), '{ "generatedAt": "2026-10-30" }', "utf8");
  check("a PSI file with no pages array exits 2", cli([psiBad, "--psi", join(psiBad, "psi-nopages.json")]).status === 2);
  const psiNone = cliRaw([psiBad, "--psi"]);
  check("--psi with a missing file exits 2, and --psi with no value exits 2 naming --psi", cli([psiBad, "--psi", join(psiBad, "none.json")]).status === 2 && psiNone.status === 2 && /--psi needs/.test(psiNone.err), psiNone.err);
  writeFileSync(join(psiBad, "psi-ok.json"), psiDoc(3400), "utf8");
  const viaFlag = cli([psiBad, "--psi", join(psiBad, "psi-ok.json")]);
  check("--psi FILE is judged like psi/<date>.json: FAIL PRF-001 with the PSI source, exit 1", viaFlag.status === 1 && /^FAIL PRF-001 \/:1 .*\(source: PSI 2026-10-30\)/m.test(viaFlag.out), viaFlag.out);
  // config validation for the speed numbers
  for (const [label, cfg] of [["zero", { speed: { lcpMs: 0 } }], ["negative", { speed: { cls: -0.1 } }], ["a string", { speed: { tbtMs: "200" } }], ["zero ttfb", { speed: { ttfbMs: 0 } }]]) {
    const cd = tmp(); cpSync(SG, cd, { recursive: true }); writeFileSync(join(cd, "audit.config.json"), JSON.stringify(cfg), "utf8");
    const rr = cli([cd]);
    check(`audit.config.json with a speed number that is ${label} exits 2 naming WCF-004`, rr.status === 2 && /WCF-004/.test(rr.err), rr.err);
  }
  // PRF-016
  snapAdhoc("PRF-016: TTFB exactly 600 ms passes", jedit("pages/home/response.json", (m) => { m.ttfbMs = 600; }), (j) => ownOf(j, "PRF-016").length === 0);
  snapAdhoc("PRF-016: TTFB 601 ms is a WARN that says single cold request, and the run still exits 0", jedit("pages/home/response.json", (m) => { m.ttfbMs = 601; }), (j) => ownOf(j, "PRF-016", "WARN").length === 1 && ownOf(j, "PRF-016", "WARN")[0].what.includes("single cold request") && ownOf(j, "PRF-016", "FAIL").length === 0 && j.exit === 0);
  snapAdhoc("PRF-016: a response with no ttfbMs is SKIP not measured", jedit("pages/home/response.json", (m) => { delete m.ttfbMs; }), (j) => j.lines.some((l) => l.startsWith("SKIP PRF-016 / not measured")));
  snapAdhoc("PRF-016: speed.ttfbMs comes from options.config", jedit("pages/home/response.json", (m) => { m.ttfbMs = 900; }), (j, d) => ownOf(j, "PRF-016", "WARN").length === 1 && ownOf(engine.audit(d, { config: { speed: { ttfbMs: 1000 } } }), "PRF-016").length === 0);
  // SE-001 and the IDX-004 http part
  const robotsJson = (fn) => jedit("site/robots.json", fn);
  snapAdhoc("SE-001: exactly 512000 bytes passes", robotsJson((m) => { m.bytes = 512000; }), (j) => ownOf(j, "SE-001").length === 0);
  snapAdhoc("SE-001: 512001 bytes fails", robotsJson((m) => { m.bytes = 512001; }), (j) => ownOf(j, "SE-001", "FAIL").length === 1);
  snapAdhoc("SE-001 and IDX-004: Text/Plain; charset=UTF-8 under the header name Content-Type passes", robotsJson((m) => { m.headers = { "Content-Type": "Text/Plain; charset=UTF-8" }; }), (j) => ownOf(j, "SE-001").length === 0 && ownOf(j, "IDX-004").length === 0);
  snapAdhoc("SE-001 and IDX-004: no content-type header at all fails both", robotsJson((m) => { m.headers = {}; }), (j) => ownOf(j, "SE-001", "FAIL").length === 1 && ownOf(j, "IDX-004", "FAIL").length === 1);
  snapAdhoc("SE-001: a 503 is a FAIL, not the WARN of a 404", seq(robotsJson((m) => { m.status = 503; }), (d) => unlinkSync(join(d, "site", "robots.txt"))), (j) => ownOf(j, "SE-001", "FAIL").length === 1 && ownOf(j, "SE-001", "WARN").length === 0);
  snapAdhoc("SE-001: a redirect status (301) is a FAIL: not 200", seq(robotsJson((m) => { m.status = 301; }), (d) => unlinkSync(join(d, "site", "robots.txt"))), (j) => ownOf(j, "SE-001", "FAIL").some((f) => f.what.includes("not 200")));
  snapAdhoc("SE-001: a fetch error with no status is a FAIL", seq(robotsJson((m) => { m.status = "ECONNRESET"; }), (d) => unlinkSync(join(d, "site", "robots.txt"))), (j) => ownOf(j, "SE-001", "FAIL").some((f) => f.what.includes("could not be fetched")));
  snapAdhoc("SE-001: a U+FFFD in the saved text (what the snapshot makes of a bad byte) is invalid UTF-8 at its line", putFile("site/robots.txt", "User-agent: *\nDisallow: /private/\n# caf\uFFFD\nSitemap: " + SO + "/sitemap.xml\n"), (j) => ownOf(j, "SE-001", "FAIL").length === 1 && ownOf(j, "SE-001", "FAIL")[0].line === 3);
  snapAdhoc("SE-001: a robots.txt with valid non-ASCII UTF-8 passes", putFile("site/robots.txt", "User-agent: *\nDisallow: /private/\n# café closed on Mondays\nSitemap: " + SO + "/sitemap.xml\n"), (j) => ownOf(j, "SE-001").length === 0);
  snapAdhoc("IDX-004 (snapshot): a Disallow on a crawled page fails, as in a folder", putFile("site/robots.txt", "User-agent: *\nDisallow: /about/\nSitemap: " + SO + "/sitemap.xml\n"), (j) => ownOf(j, "IDX-004", "FAIL").length === 1 && ownOf(j, "IDX-004", "FAIL")[0].what.includes("the page /about/"));
  snapAdhoc("IDX-004 (snapshot): a Disallow on the sitemap URL path fails", putFile("site/robots.txt", "User-agent: *\nDisallow: /sitemap.xml\nSitemap: " + SO + "/sitemap.xml\n"), (j) => ownOf(j, "IDX-004", "FAIL").length === 1 && ownOf(j, "IDX-004", "FAIL")[0].what.includes("the sitemap /sitemap.xml"));
  snapAdhoc("SE-001 and IDX-004: a snapshot with robots.txt but no robots.json judges the file only (no HTTP facts)", (d) => unlinkSync(join(d, "site", "robots.json")), (j) => ownOf(j, "SE-001").length === 0 && ownOf(j, "IDX-004").length === 0);
  // folder mode of SE-001
  adhoc("SE-001 (folder): a robots.txt that is not valid UTF-8 fails at its line", (d) => writeFileSync(join(d, "robots.txt"), Buffer.concat([Buffer.from("User-agent: *\nDisallow: /private/\n# caf"), Buffer.from([0xe9]), Buffer.from("\nSitemap: " + O + "/sitemap.xml\n")])), (j) => failsOf(j, "SE-001").length === 1 && failsOf(j, "SE-001")[0].line === 3);
  adhoc("SE-001 (folder): a folder with no robots.txt says SKIP (IDX-004 fails the missing file), never PASS", (d) => unlinkSync(join(d, "robots.txt")), (j) => j.lines.some((l) => l.startsWith("SKIP SE-001 robots.txt ")) && !j.lines.some((l) => l.startsWith("PASS SE-001 ")) && failsOf(j, "IDX-004").length === 1);
  // LNK-002 status part and the crawl's sampling
  const blank = '<!doctype html><html lang="en"><head><title>x</title></head><body></body></html>';
  snapAdhoc("LNK-002: a link to a file (pdf, image) and to an external host is not judged and not a SKIP", linkTo("/files/steeping-guide.pdf"), (j) => ownOf(j, "LNK-002").length === 0);
  snapAdhoc("LNK-002: a link to a page the crawl did not visit is SKIP not-crawled, the page gets no PASS line, the run exits 0", linkTo("/wholesale/"), (j) => ownOf(j, "LNK-002", "SKIP").length === 1 && !j.lines.includes("PASS LNK-002 /about/") && ownOf(j, "LNK-002", "FAIL").length === 0 && j.exit === 0);
  snapAdhoc("LNK-002: two links to the same uncrawled page give one SKIP", seq(linkTo("/wholesale/"), linkTo("/wholesale/")), (j) => ownOf(j, "LNK-002", "SKIP").length === 1);
  snapAdhoc("LNK-002: an absolute link on the www counterpart host is internal (judged), an external host is not", seq(addRec("gone", SO + "/gone/", SO + "/gone/", 404, [{ url: SO + "/gone/", status: 404 }], blank), linkTo("https://www.example-tea.invalid/gone/"), linkTo("https://elsewhere.example/gone/")), (j) => ownOf(j, "LNK-002", "FAIL").length === 1 && ownOf(j, "LNK-002", "SKIP").length === 0);
  snapAdhoc("LNK-002: 410 and 503 targets are status-mismatch", seq(addRec("g410", SO + "/g410/", SO + "/g410/", 410, [{ url: SO + "/g410/", status: 410 }]), addRec("g503", SO + "/g503/", SO + "/g503/", 503, [{ url: SO + "/g503/", status: 503 }]), linkTo("/g410/"), linkTo("/g503/")), (j) => ownOf(j, "LNK-002", "FAIL").length === 2 && ownOf(j, "LNK-002", "FAIL").every((f) => f.what.startsWith("status-mismatch")));
  snapAdhoc("LNK-002: a record whose final status is 302 (no Location followed) is redirect-target", seq(addRec("r302", SO + "/r302/", SO + "/r302/", 302, [{ url: SO + "/r302/", status: 302 }]), linkTo("/r302/")), (j) => ownOf(j, "LNK-002", "FAIL").length === 1 && ownOf(j, "LNK-002", "FAIL")[0].what.startsWith("redirect-target"));
  snapAdhoc("LNK-002: a page that exists only as the end of a followed redirect is a page (200), and the redirecting URL is a redirect-target", seq((d) => { cpSync(join(d, "pages", "tasting-room"), join(d, "pages", "old-tea"), { recursive: true }); rmSync(join(d, "pages", "tasting-room"), { recursive: true }); }, jedit("pages/old-tea/response.json", (m) => { m.url = SO + "/old-tea/"; m.chain = [{ url: SO + "/old-tea/", status: 301, location: "/tasting-room/" }, { url: SO + "/tasting-room/", status: 200 }]; }), linkTo("/old-tea/")), (j) => j.pages.includes("/tasting-room/") && ownOf(j, "LNK-002", "FAIL").length === 1 && ownOf(j, "LNK-002", "FAIL")[0].what.startsWith("redirect-target"));
  snapAdhoc("a 404 record is not a judged page: no MET, A11, SCH or URL rule runs on it, and it is not indexable", seq(addRec("gone", SO + "/gone/", SO + "/gone/", 404, [{ url: SO + "/gone/", status: 404 }], blank), linkTo("/gone/")), (j) => !j.pages.includes("/gone/") && envLineOk(j) && j.findings.filter((f) => f.rule !== "ENV-001" && f.rule !== "PMP-001").every((f) => f.rule === "LNK-002"));
  snapAdhoc("IDX-001 (snapshot): a sitemap URL whose crawl record is 404 is a status-mismatch FAIL", seq(addRec("gone", SO + "/gone/", SO + "/gone/", 404, [{ url: SO + "/gone/", status: 404 }], blank), (d) => { const p = join(d, "site", "sitemap-1.xml"); writeFileSync(p, readFileSync(p, "utf8").replace("</urlset>", `  <url>\n    <loc>${SO}/gone/</loc>\n    <lastmod>2026-10-05T09:00:00Z</lastmod>\n  </url>\n</urlset>`)); }), (j) => ownOf(j, "IDX-001", "FAIL").length === 1 && ownOf(j, "IDX-001", "FAIL")[0].what.startsWith("status-mismatch"));
  snapAdhoc("a gzipped sitemap (site/sitemap-1.xml.gz) is read: every rule still passes", (d) => { const p = join(d, "site", "sitemap-1.xml"); writeFileSync(p + ".gz", zlib.gzipSync(readFileSync(p))); unlinkSync(p); jedit("site/sitemaps.json", (m) => { m.fetched[0].file = "site/sitemap-1.xml.gz"; })(d); }, (j) => skipsOnly(j) && j.lines.includes("PASS IDX-001 site/sitemap-1.xml.gz"));
  snapAdhoc("the site origin is the home page's final url, not _site.json.url", jedit("_site.json", (m) => { m.url = "https://elsewhere.invalid"; }), (j) => skipsOnly(j));

  snapAdhoc("URL-009 (snapshot): a home canonical on another origin than the one the page was fetched from is named", gzSub("home", `<link rel="canonical" href="${SO}/">`, `<link rel="canonical" href="https://www.example-tea.invalid/">`), (j) => ownOf(j, "URL-009", "FAIL").some((f) => f.page === "/" && f.what.includes("is not the origin")));
  // the live driver, through the stand-in for live-target.mjs (no request is made)
  const STANDIN = join(FIX, "live-target-standin.mjs");
  const live = (args, env = {}) => { const r = spawnSync(process.execPath, [join(AUDIT, "live.mjs"), ...args], { encoding: "utf8", timeout: 60000, env: { ...childEnv, OMNIKOM_AUDIT_LIVE_TARGET: STANDIN, ...env } }); return { status: r.status, out: r.stdout || "", err: r.stderr || "" }; };
  const direct = cli([SG]);
  const lv = live(["https://example-tea.invalid/"]);
  check("live.mjs with the stand-in prints exactly the lines run.mjs prints on snapshot-good and exits the same (0)", lv.status === 0 && direct.status === 0 && lv.out === direct.out && exceptEnvSkip(lv.out.split(/\r?\n/).filter(Boolean)).every((l) => l.startsWith("PASS ")) && lv.out.split(/\r?\n/).filter((l) => /ENV-001/.test(l)).length === 1 && /^SKIP ENV-001 \/ no --target/m.test(lv.out) && lv.out.split(/\r?\n/).filter((l) => /PMP-001/.test(l)).length === 1 && /^SKIP PMP-001 \/ no --prompt-coverage/m.test(lv.out) && lv.out.length > 0, lv.out.slice(0, 200) + lv.err);
  check("live.mjs: the progress lines of the child go to stderr, not stdout", /standin progress line/.test(lv.err) && /standin progress on stdout/.test(lv.err) && !/standin|REUSE/.test(lv.out) && /reusing snapshot/.test(lv.err), lv.err);
  const lvNew = live(["https://example-tea.invalid/"], { STANDIN_MODE: "new" });
  check("live.mjs: a NEW line is read the same way", lvNew.status === 0 && lvNew.out === direct.out && /new snapshot/.test(lvNew.err), lvNew.err);
  const lvFail = live(["https://example-tea.invalid/"], { STANDIN_MODE: "failed" });
  check("live.mjs: a FAILED line exits 3 and prints nothing judged on stdout", lvFail.status === 3 && lvFail.out === "" && /FAILED/.test(lvFail.err) && /nothing was judged/.test(lvFail.err), lvFail.out + lvFail.err);
  const lvSilent = live(["https://example-tea.invalid/"], { STANDIN_MODE: "silent" });
  check("live.mjs: a child that prints no REUSE, NEW or FAILED line exits 3, nothing judged", lvSilent.status === 3 && lvSilent.out === "", lvSilent.err);
  check("live.mjs: a child that exits 2 (it refused its arguments) makes the driver exit 2", live(["https://example-tea.invalid/"], { STANDIN_MODE: "usage" }).status === 2);
  check("live.mjs: no url, a url that is not http(s), an unknown option and a second url all exit 2", [[], ["example.com"], ["https://example-tea.invalid/", "--nope"], ["https://a.invalid/", "https://b.invalid/"], ["https://example-tea.invalid/", "--cwd"]].every((a) => live(a).status === 2));
  const lvArgs = live(["https://example-tea.invalid/", "--fresh", "--cwd", "somewhere", "--max-age-days", "3", "--", "--max-pages", "2"]);
  check("live.mjs: the url, --fresh, --cwd, --max-age-days and what follows -- reach live-target.mjs, in that order", lvArgs.err.includes('standin args: ["https://example-tea.invalid/","--fresh","--cwd","somewhere","--max-age-days","3","--","--max-pages","2"]'), lvArgs.err);
  const lvPlain = live(["https://example-tea.invalid/"]);
  check("live.mjs: without --fresh, --cwd and -- nothing but the url is passed on", lvPlain.err.includes('standin args: ["https://example-tea.invalid/"]'), lvPlain.err);
  const lvJson = live(["https://example-tea.invalid/", "--json"]);
  let lvj = null; try { lvj = JSON.parse(lvJson.out); } catch {}
  check("live.mjs --json prints the audit() object and nothing else", lvj && lvj.mode === "snapshot" && lvj.exit === 0 && lvj.pass === true && lvJson.status === 0, lvJson.out.slice(0, 200));
  const lvOnly = live(["https://example-tea.invalid/", "--only", "PRF-001,SE-001"]);
  check("live.mjs --only limits the rules", lvOnly.status === 0 && lvOnly.out.split(/\r?\n/).filter(Boolean).every((l) => /^PASS (PRF-001|SE-001) /.test(l)) && lvOnly.out.includes("PASS PRF-001 /"), lvOnly.out);
  check("live.mjs --only with an unknown rule id exits 2", live(["https://example-tea.invalid/", "--only", "NOPE-1"]).status === 2);
  const lvBad = live(["https://example-tea.invalid/"], { STANDIN_DIR: join(FIX, "snapshot-bad-PRF-001") });
  const directBad = cli([join(FIX, "snapshot-bad-PRF-001")]);
  check("live.mjs on a snapshot with a FAIL prints the FAIL line and exits 1, like run.mjs", lvBad.status === 1 && directBad.status === 1 && lvBad.out === directBad.out && /^FAIL PRF-001 \/:1 budget-exceeded: LCP 3100 ms > 2500 ms \(source: checklist\/performance\.md PRF-001\)$/m.test(lvBad.out), lvBad.out);
  const lvPsi = live(["https://example-tea.invalid/", "--psi", join(FIX, "snapshot-bad-PRF-001-psi-fail", "psi", "2026-10-30.json")], { STANDIN_DIR: join(FIX, "snapshot-bad-PRF-001-untrusted") });
  check("live.mjs --psi FILE reaches the audit: an untrusted page is judged on the PSI number", lvPsi.status === 1 && /source: PSI 2026-10-30/.test(lvPsi.out), lvPsi.out + lvPsi.err);

  // the live driver stops the whole process tree of its child (slice 4b.1): a stand-in target starts a long-lived grandchild (the browser's place),
  // writes its pid to a file and hangs; live.mjs runs with a 4 s limit and must exit, and the grandchild must be gone within 5 s. The test kills the
  // grandchild itself if it is not, and the run fails. On Windows the grandchild is spawned detached, which breaks it away from the kill-on-close job that
  // node gives its children (as a browser launcher does); without that it would die with live.mjs whatever live.mjs did, and the test would measure nothing.
  // A hard kill of the driver itself cannot be handled by it and is not tested.
  {
    const td = tmp("omnikom-audit-tree-");
    const grandchild = join(td, "grandchild.mjs"), standin = join(td, "standin.mjs"), pidFile = join(td, "pid.txt");
    writeFileSync(grandchild, "setInterval(() => {}, 1000);\n", "utf8");
    writeFileSync(standin, `import { spawn } from "node:child_process";\nimport { writeFileSync } from "node:fs";\nconst g = spawn(process.execPath, [${JSON.stringify(grandchild)}], { stdio: "ignore", detached: process.platform === "win32" });\nwriteFileSync(${JSON.stringify(pidFile)}, String(g.pid));\nsetInterval(() => {}, 1000);\n`, "utf8");
    const lr = spawnSync(process.execPath, [join(AUDIT, "live.mjs"), "https://example-tea.invalid/"], { encoding: "utf8", timeout: 30000, env: { ...childEnv, OMNIKOM_AUDIT_LIVE_TARGET: standin, OMNIKOM_AUDIT_LIVE_TIMEOUT_MS: "4000" } });
    const gpid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : 0;
    const alive = (p) => { try { process.kill(p, 0); return true; } catch (e) { return e.code === "EPERM"; } };
    let gone = false;
    for (let i = 0; i < 25 && gpid; i++) { if (!alive(gpid)) { gone = true; break; } await new Promise((r) => setTimeout(r, 200)); }
    if (gpid && alive(gpid)) { try { process.kill(gpid, "SIGKILL"); } catch {} }
    check("live.mjs: when its time limit fires, the child's whole process tree is stopped (the grandchild is gone within 5 s) and it exits 3", lr.status === 3 && gpid > 0 && gone, `live exit ${lr.status}; grandchild pid ${gpid || "never written"} ${gone ? "gone" : "still alive 5 s after live.mjs ended (killed by the test)"}`);
  }

  // audit() with a rules option that names nothing real is a usage error, not "zero rules ran, PASS" (a caller must not fail open)
  const throws2 = (rulesOpt, needle) => { try { engine.audit(join(FIX, "good"), { rules: rulesOpt }); return false; } catch (e) { return e && e.name !== undefined && e.exit === 2 && String(e.message).includes(needle); } };
  check("audit(good, { rules: [''] }) throws AuditError exit 2 naming the empty id", throws2([""], 'no such rule: ""'));
  check("audit(good, { rules: ['NOPE-999'] }) throws exit 2 naming NOPE-999", throws2(["NOPE-999"], 'no such rule: "NOPE-999"'));
  check("audit(good, { rules: ['MET-001', 'NOPE-999'] }) throws: one unknown id among real ones is still an error", throws2(["MET-001", "NOPE-999"], "NOPE-999"));
  check("audit(good, { rules: [] }) throws exit 2 (an empty list runs nothing)", throws2([], "no such rule"));
  check("audit(good, { rules: '' }) throws exit 2 (an empty string is not 'all rules')", throws2("", 'no such rule: ""'));
  check("audit(good) and audit(good, { rules: undefined }) and { rules: null } still run every rule", [undefined, null].every((v) => { const r = engine.audit(join(FIX, "good"), { rules: v }); return r.rules.length === rules.length && r.exit === 0; }) && engine.audit(join(FIX, "good")).rules.length === rules.length);
  check("audit(good, { rules: ['met-001'] }) still works (case is folded)", (() => { const r = engine.audit(join(FIX, "good"), { rules: ["met-001"] }); return r.rules.length === 1 && r.lines.every((l) => l.startsWith("PASS MET-001 ")); })());
  adhoc("options.rules limits the rules and the lines (library call)", () => {}, (j) => { const r = engine.audit(j.dir, { rules: ["MET-003", "met-001"] }); return r.rules.length === 2 && r.lines.every((l) => /^PASS (MET-003|MET-001) /.test(l)); });
  adhoc("audit() returns the documented shape", () => {}, (j) => ["dir", "pages", "rules", "findings", "lines", "pass", "exit"].every((k) => k in j) && j.rules.every((r) => r.id && r.severity && r.source) && j.pass === true && j.exit === 0);
  // ---- slice 4b: the DSN rules, the source wall for the new source form, and both sides of every pattern ----
  const copy2 = copy; // the copy made for the source wall above, without the planted check
  rmSync(join(copy2, "checks", "zzz-001.mjs")); rmSync(join(copy2, "rules", "ZZZ-001.md"));
  const d1src = readFileSync(join(copy2, "checks", "dsn-001.mjs"), "utf8");
  const srcLine = d1src.split("\n").find((l) => l.startsWith("export const source = dsnSource("));
  if (!srcLine) throw new Error("test setup: dsn-001.mjs has no 'export const source = dsnSource(...)' line");
  writeFileSync(join(copy2, "checks", "dsn-001.mjs"), d1src.replace(srcLine, 'export const source = "";'), "utf8");
  const noSrc = cli([join(FIX, "good")], copy2);
  check("a DSN check whose source is the empty string is refused: exit 2 and 'no source string'", noSrc.status === 2 && /no source string/.test(noSrc.err), noSrc.err + noSrc.out);
  writeFileSync(join(copy2, "checks", "dsn-001.mjs"), d1src.replace(srcLine, "export const source = 42;"), "utf8");
  const numSrc = cli([join(FIX, "good")], copy2);
  check("a DSN check whose source is not a string is refused: exit 2 and 'no source string'", numSrc.status === 2 && /no source string/.test(numSrc.err), numSrc.err + numSrc.out);
  writeFileSync(join(copy2, "checks", "dsn-001.mjs"), d1src.replace(srcLine + "\n", ""), "utf8");
  const missSrc = cli([join(FIX, "good")], copy2);
  check("a DSN check with no source export at all is refused: exit 2 and 'no source string'", missSrc.status === 2 && /no source string/.test(missSrc.err), missSrc.err + missSrc.out);
  writeFileSync(join(copy2, "checks", "dsn-001.mjs"), d1src, "utf8");
  rmSync(join(copy2, "rules", "DSN-001.md"));
  const noRule = cli([join(FIX, "good")], copy2);
  check("a DSN check with no rules/DSN-001.md is refused: exit 2 and 'admitted only with a source'", noRule.status === 2 && /admitted only with a source/.test(noRule.err), noRule.err + noRule.out);

  // the hue-family table printed in rules/DSN-002.md is the table the code uses
  const colour = await import(pathToFileURL(join(AUDIT, "lib", "colour.mjs")).href);
  const r2 = readFileSync(join(AUDIT, "rules", "DSN-002.md"), "utf8");
  check("rules/DSN-002.md prints the hue-family table of lib/colour.mjs, row for row", colour.HUE_FAMILIES.length === 8 && colour.HUE_FAMILIES.every((h) => r2.includes(`| ${h.family} | ${h.from} to ${h.to} | ${h.tailwind.join(", ")} |`)), r2.slice(0, 200));
  check("rules/DSN-002.md names the grey rule numbers the code uses", r2.includes(`saturation is under ${colour.GREY_RULE.maxSaturation}`) && r2.includes(`lightness under ${colour.GREY_RULE.maxLightness} or over ${colour.GREY_RULE.minLightness}`));
  check("every DSN rules file says what it does not judge and that a snapshot carries HTML only", rules.filter((r) => r.id.startsWith("DSN-")).every((r) => { const t = readFileSync(join(AUDIT, "rules", r.id + ".md"), "utf8"); return /A snapshot .* carries each page's HTML only/s.test(t) && t.includes("## Not judged here") && t.includes("Severity P1"); }));
  check("the DSN-010 and DSN-011 rules files say WARN and declared styles; DSN-005 says where the word list comes from and that unlock and magic may need an exception", ["DSN-010", "DSN-011"].every((id) => { const t = readFileSync(join(AUDIT, "rules", id + ".md"), "utf8"); return t.includes("WARN") && t.includes("declared styles, not computed ones"); }) && /may need a[ \n]+per-site exception/.test(readFileSync(join(AUDIT, "rules", "DSN-005.md"), "utf8")));

  // the CSS reader
  const design = await import(pathToFileURL(join(AUDIT, "lib", "design.mjs")).href);
  const css1 = design.parseCss("/* c */\n.a { color: red; background: url(data:image/png;base64,AAA=) ; }\n@media (min-width: 600px) {\n  .b { text-transform: uppercase !important }\n}\n@keyframes fade { from { opacity: 0 } }\n@-webkit-keyframes Shimmer-X { to { opacity: 1 } }\n@font-face { font-family: x; src: url(a.woff2) }\nh2, .c , a:hover { font-size: 12px; content: \"a;b\" }\n", 1);
  const sel = (s) => css1.rules.find((r) => r.selectors.includes(s)) || { decls: [{}, {}], line: -1 }; // a missing rule is a red check, never a crash
  check("parseCss: a semicolon inside url() or a string does not split a declaration, !important is dropped, line numbers are true", sel(".a").decls.length === 2 && sel(".a").decls[1].prop === "background" && sel(".a").decls[1].value.startsWith("url(data:image/png;base64,AAA=)") && sel(".b").decls[0].value === "uppercase" && sel(".b").line === 4 && sel(".b").decls[0].line === 4 && sel("h2").decls[1].value === '"a;b"' && sel("h2").line === 9, JSON.stringify(css1.rules).slice(0, 400));
  check("parseCss: rules inside @media are read, @keyframes names are listed (prefixed form too), @font-face is not a rule", css1.rules.length === 3 && css1.keyframes.length === 2 && css1.keyframes[0].name === "fade" && css1.keyframes[1].name === "Shimmer-X" && css1.keyframes[1].line === 7, JSON.stringify(css1.keyframes));
  check("plainSelectors: one class or one element only; compound, descendant, pseudo, id and attribute selectors are dropped", JSON.stringify(design.plainSelectors([".card", "H2", ".a.b", ".a .b", "a:hover", "#x", "[data-x]", "ul > li", ".c"])) === JSON.stringify([{ kind: "class", key: "card" }, { kind: "tag", key: "h2" }, { kind: "class", key: "c" }]));
  check("splitToken: variants split on a colon outside brackets; ! is stripped; lengthPx reads px and rem only", (() => { const a = design.splitToken("md:hover:!scale-105"), b = design.splitToken("[&:hover]:animate-pulse"), c = design.splitToken("tracking-[0.1em]!"); return JSON.stringify(a) === JSON.stringify({ variants: ["md", "hover"], utility: "scale-105" }) && b.variants[0] === "[&:hover]" && b.utility === "animate-pulse" && c.utility === "tracking-[0.1em]" && design.lengthPx("12px") === 12 && design.lengthPx("0.75rem") === 12 && design.lengthPx("1em") === null && design.lengthPx("0") === 0 && design.lengthPx("calc(1px)") === null; })());
  check("colour: families by hue (indigo and purple differ, two blues do not), greys and transparent are no family, oklch is unknown", (() => { const fam = (c) => colour.colourFamily(c); return fam("#6366f1").family === "blue" && fam("#a855f7").family === "purple" && fam("#3b82f6").family === fam("#1e40af").family && fam("#ff0000").family === "red" && fam("hsl(330 80% 60%)").family === "pink" && fam("#777").none && fam("white").none && fam("rgba(0,0,0,0.5)").none && fam("transparent").none && fam("oklch(0.6 0.2 260)").unknown && fam("var(--x)").unknown; })());

  const onlyOf = (j, rule) => j.findings.filter((f) => f.rule === rule);
  const homeIns = (html) => sub("index.html", "<h2>Learn to steep</h2>", html + "\n<h2>Learn to steep</h2>");
  const headIns = (html) => sub("index.html", '<meta name="viewport" content="width=device-width, initial-scale=1">', '<meta name="viewport" content="width=device-width, initial-scale=1">\n' + html);
  const putDir = (rel, text) => (dir) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text, "utf8"); };
  const linkSheet = (href = "/css/a.css") => headIns(`<link rel="stylesheet" href="${href}">`);
  const both = (...fns) => (dir) => fns.forEach((fn) => fn(dir));
  const EM = "\u{1F680}";
  // dsn(label, rule, html, n[, setup]): one snippet is added to the home page; the rule shows exactly n findings
  const dsn = (label, rule, html, n, setup) => adhoc(`${rule}: ${label}`, both(...(setup ? [setup] : []), homeIns(html)), (j) => onlyOf(j, rule).length === n);
  // batch(label, rule, [[html, n], ...][, setup][, status]): every snippet goes on its own line(s) of the home page behind a marker comment, in
  // ONE page and one audit; each snippet must show exactly n findings of the rule on its lines, and the rule none anywhere else. A failure
  // names the snippets that did not behave. status WARN also demands that the run exits 0.
  const batch = (label, rule, items, setup, status = "FAIL") => adhoc(`${rule}: ${label}`, both(...(setup ? [setup] : []), homeIns(items.map(([html], i) => `<!--b${i}-->${html}`).join("\n"))), (j) => {
    const lines = readFileSync(join(j.dir, "index.html"), "utf8").split("\n");
    const at = (i) => lines.findIndex((l) => l.includes(`<!--b${i}-->`)) + 1;
    const end = lines.findIndex((l) => l.includes("<h2>Learn to steep</h2>")) + 1;
    const own = onlyOf(j, rule);
    const wrong = items.map(([html, n], i) => { const hits = own.filter((f) => f.line >= at(i) && f.line < (i + 1 < items.length ? at(i + 1) : end)); return hits.length === n && hits.every((f) => f.status === status) ? null : `${JSON.stringify(html).slice(0, 70)} wanted ${n}, got ${hits.length}${hits.length ? " (" + hits.map((f) => f.status + ":" + f.what.slice(0, 50)).join("; ") + ")" : ""}`; }).filter(Boolean);
    const total = items.reduce((a, [, n]) => a + n, 0);
    if (own.length !== total) wrong.push(`the rule shows ${own.length} findings, the snippets want ${total}`);
    if (status === "WARN" && j.exit !== 0) wrong.push("exit is " + j.exit + ", a WARN never fails the run");
    if (wrong.length) throw new Error(wrong.join(" | "));
    return true;
  });

  // DSN-001
  batch("these classes fail (a variant prefix does not hide them)", "DSN-001", ["animate-ping", "animate-bounce", "animate-pulse", "motion-safe:animate-pulse", "group-hover:scale-110", "hover:-scale-x-100", "md:hover:scale-[1.02]", "!transition-all", "peer-hover:scale-95", "animate-shimmer", "Skeleton-Shimmer", "[&:hover]:animate-pulse", "hover:scale-100", "transition-all"].map((tok) => [`<p class="p-2 ${tok}">x</p>`, 1]));
  batch("these classes pass", "DSN-001", ["transition-colors", "transition", "transition-opacity", "hover:opacity-80", "scale-105", "hover:shadow-lg", "animate-spin", "focus:scale-105", "hover:translate-y-1", "fade-in", "transitionall"].map((tok) => [`<p class="p-2 ${tok}">x</p>`, 0]));
  dsn("a class inside an svg, a template, a noscript, a comment and a script string is not judged", "DSN-001", `<svg class="animate-pulse" viewBox="0 0 4 4"><circle class="animate-ping" r="1"/></svg><template><p class="animate-bounce">t</p></template><noscript><p class="transition-all">n</p></noscript><!-- <p class="a"><span class="animate-pulse">c</span></p> --><script>var s = '<p class="animate-pulse">';</script>`, 0);
  dsn("@keyframes fade passes; a keyframes name with shimmer in any case fails; @media nesting is read", "DSN-001", "<p>x</p>", 1, headIns("<style>\n@keyframes fade { from { opacity: 0 } }\n@media (min-width: 40em) { @keyframes Shimmer-Wide { to { opacity: 1 } } }\n</style>"));
  dsn("a shimmer @keyframes inside an HTML comment or an svg style is not judged", "DSN-001", "<p>x</p>", 0, headIns("<!-- <style>@keyframes shimmer { to { opacity: 1 } }</style> -->\n<svg><style>@keyframes shimmer { to { opacity: 1 } }</style></svg>"));
  dsn("a linked stylesheet outside the folder (another host with a file of the same name in the folder, a missing file) is not read", "DSN-001", "<p>x</p>", 0, both(putDir("css/a.css", "@keyframes shimmer { to { opacity: 1 } }\n"), linkSheet("https://cdn.example/css/a.css"), linkSheet("/css/missing.css")));
  dsn("a stylesheet linked by an absolute URL on the site's own host is read", "DSN-001", "<p>x</p>", 1, both(putDir("css/a.css", "@keyframes shimmer { to { opacity: 1 } }\n"), linkSheet("https://www.brindlewood-tea.example/css/a.css")));
  dsn("a linked stylesheet of the folder is read, relative href included, and reported once on the file", "DSN-001", "<p>x</p>", 1, both(putDir("css/a.css", "@keyframes shimmer { to { opacity: 1 } }\n"), linkSheet("css/a.css"), linkSheet("/css/a.css")));
  adhoc("DSN-001: the stylesheet finding names the file and its line", both(putDir("css/a.css", "a { color: red }\n\n@keyframes shimmer { to { opacity: 1 } }\n"), linkSheet()), (j) => j.lines.some((l) => l.startsWith("FAIL DSN-001 css/a.css:3 ")));
  snapAdhoc("DSN-001 (snapshot): a class in the HTML is judged; a stylesheet that sits in the snapshot folder and is linked is not read", seq(putFile("css/a.css", "@keyframes shimmer { to { opacity: 1 } }\n"), gzSub("home", "<h2>Learn to steep</h2>", '<p class="animate-pulse">x</p>\n<link rel="stylesheet" href="/css/a.css">\n<h2>Learn to steep</h2>')), (j) => ownOf(j, "DSN-001", "FAIL").length === 1 && j.mode === "snapshot");

  // DSN-002
  batch("Tailwind colour classes naming two hue families fail", "DSN-002", [["indigo to purple", "from-indigo-500 to-purple-600"], ["blue via purple to pink", "from-blue-500 via-purple-500 to-pink-500"], ["a variant group", "dark:from-indigo-500 dark:to-purple-600"], ["arbitrary colours", "from-[#6366f1] to-[#a855f7]"], ["green to cyan with opacity", "from-green-400/50 to-cyan-500"], ["every stop in one variant group (md:)", "md:from-red-500 md:via-white md:to-blue-500"]].map(([, cls]) => [`<div class="bg-gradient-to-r ${cls}">x</div>`, 1]));
  batch("Tailwind colour classes in one family, greys or unreadable names pass", "DSN-002", [["two blues", "from-blue-500 to-blue-800"], ["grey to white", "from-slate-100 to-white"], ["red through white to red", "from-red-500 via-white to-red-700"], ["colour to transparent", "from-red-500 to-transparent"], ["different variant groups", "from-indigo-500 dark:to-purple-600"], ["custom names", "from-brand to-accent"], ["blue to indigo (one family)", "from-blue-500 to-indigo-600"], ["a single stop", "from-purple-500"], ["arbitrary same family", "from-[#3b82f6] to-[#1e40af]"], ["a position utility", "from-10% to-90%"]].map(([, cls]) => [`<div class="bg-gradient-to-r ${cls}">x</div>`, 0]));
  batch("CSS gradients with stops in two hue families fail", "DSN-002", [["linear hue gradient", "background: linear-gradient(to right, red, blue)"], ["radial hsl", "background-image: radial-gradient(circle at top, hsl(250 80% 60%), hsl(330 80% 60%))"], ["conic", "background: conic-gradient(#ff0000, #00ff00, #0000ff)"], ["repeating", "background: repeating-linear-gradient(45deg, #f97316, #f97316 10px, #3b82f6 10px, #3b82f6 20px)"], ["rgb function with a position", "background: linear-gradient(90deg, rgb(99, 102, 241) 0%, rgb(168 85 247) 100%)"], ["a hue gradient after a grey scrim layer", "background-image: linear-gradient(rgba(0,0,0,.4), transparent), linear-gradient(red, blue)"]].map(([, style]) => [`<div style="${style}">x</div>`, 1]));
  batch("CSS gradients in one family, greys, black, white or unreadable stops pass", "DSN-002", [["dark scrim", "linear-gradient(rgba(0,0,0,.6), transparent)"], ["two blues", "linear-gradient(#3b82f6, #1d4ed8)"], ["greys", "linear-gradient(#fff, #eee, #999)"], ["oklch stops are not read", "linear-gradient(oklch(0.6 0.2 260), oklch(0.7 0.2 330))"], ["var stops are not read", "linear-gradient(var(--a), var(--b))"], ["one hue and an unreadable stop", "linear-gradient(red, oklch(0.7 0.2 330))"], ["a plain colour", "#6366f1"], ["a direction only", "linear-gradient(to right, #6366f1 20%, #6366f1)"], ["a mid grey to blue", "linear-gradient(#777, #3b82f6)"], ["black to red", "linear-gradient(black, red)"], ["white to purple", "linear-gradient(white, #a855f7)"], ["a near-white blue tint to purple", "linear-gradient(#eef2ff, #a855f7)"], ["a near-black blue to red", "linear-gradient(#020617, #ef4444)"], ["a dark blue to a light blue", "linear-gradient(#1e3a8a, #60a5fa)"]].map(([, g]) => [`<div style="background: ${g}">x</div>`, 0]));
  batch("gradient text: what passes and what fails", "DSN-002", [
    ['<p class="bg-clip-text">x</p>', 0], ['<p class="text-transparent">y</p>', 0],
    ['<p style="background-clip: padding-box; background-image: linear-gradient(#111, #999)">x</p>', 0],
    ['<p class="bg-clip-text md:text-transparent">x</p>', 1],
    ['<p style="background-clip: text; color: #222">x</p>', 0],
    ['<p style="background-clip: text; background-image: linear-gradient(#111, #999)">y</p>', 1],
    ['<p class="bg-gradient-to-b from-slate-900 to-slate-500" style="-webkit-background-clip: text">y</p>', 1],
  ]);
  dsn("a <style> rule .grad (class) with clip text and a hue gradient gives two findings on the element (text and hue)", "DSN-002", '<p class="grad">x</p>', 2, headIns("<style>.grad { background: linear-gradient(red, blue); background-clip: text }</style>"));
  dsn("a compound or descendant selector is not judged: .a .b, .a.b, p:hover", "DSN-002", '<div class="a"><p class="b">x</p></div>', 0, headIns("<style>.a .b { background: linear-gradient(red, blue) } .a.b { background: linear-gradient(red, blue) } p:hover { background: linear-gradient(red, blue) }</style>"));
  dsn("an element selector (mark) is matched, and the style attribute overrides a class rule of the same property", "DSN-002", '<mark>x</mark><mark class="plain" style="background: #fff">y</mark>', 1, headIns("<style>mark { background: linear-gradient(red, blue) } .plain { background: linear-gradient(red, blue) }</style>"));
  dsn("a rule inside @media is judged", "DSN-002", '<p class="m">x</p>', 1, headIns("<style>@media (min-width: 40em) { .m { background: linear-gradient(red, blue) } }</style>"));

  // DSN-003
  batch("an emoji in each of h3-h6, button, a, label, legend, summary, th and option fails", "DSN-003", ["h3", "h4", "h5", "h6"].map((h) => [`<${h}>${EM} a</${h}>`, 1]).concat([
    [`<button>${EM} e</button>`, 1], [`<a href="/about/">${EM} f</a>`, 1], [`<label>${EM} g</label>`, 1], [`<fieldset><legend>${EM} h</legend></fieldset>`, 1],
    [`<details><summary>${EM} i</summary><p>x</p></details>`, 1], [`<table><tr><th>${EM} j</th></tr></table>`, 1], [`<select><option>${EM} k</option></select>`, 1],
  ]));
  adhoc("DSN-003: an emoji in the h1 fails", sub("index.html", "<h1>Loose-leaf tea, blended in small batches</h1>", `<h1>Loose-leaf tea ${EM}, blended in small batches</h1>`), (j) => onlyOf(j, "DSN-003").length === 1 && onlyOf(j, "DSN-003")[0].what.includes("<h1>"));
  batch("emoji outside the label elements, in attributes, in svg or template, and text symbols pass", "DSN-003", [
    [`<p>${EM} x</p>`, 0], [`<ul><li>${EM} y</li></ul>`, 0], [`<div>${EM} z</div>`, 0], [`<span>${EM}</span>`, 0],
    [`<h3 title="${EM}" aria-label="${EM}">plain</h3>`, 0],
    ["<h3>Top 10 # tea * 3⃣</h3>", 0], ["<h4>Brindlewood™ Tea © 2026 ®</h4>", 0],
    [`<h3>Tea <svg viewBox="0 0 4 4"><title>${EM}</title></svg><template>${EM}</template></h3>`, 0],
  ]);
  // text presentation or emoji presentation: a symbol shows as an emoji only with Emoji_Presentation or with U+FE0F after it (the head's reading of DECISIONS 37)
  const SYM = (...c) => String.fromCharCode(...c), V = SYM(0xfe0f);
  batch("text-style symbols pass: the bare arrow of an external link, play, heavy check, telephone, warning, heart, copyright, registered, trade mark", "DSN-003", [
    [`<a href="/about/">Visit the shop ${SYM(0x2197)}</a>`, 0], [`<h3>Play ${SYM(0x25b6)}</h3>`, 0], [`<h3>Done ${SYM(0x2714)}</h3>`, 0], [`<button>Call ${SYM(0x260e)}</button>`, 0],
    [`<h3>Careful ${SYM(0x26a0)}</h3>`, 0], [`<h3>Love ${SYM(0x2764)}</h3>`, 0], [`<h4>Brindlewood${SYM(0x2122)} ${SYM(0xa9)} ${SYM(0xae)}</h4>`, 0],
  ]);
  batch("the same symbols with U+FE0F, and symbols with emoji presentation, fail", "DSN-003", [
    [`<a href="/about/">Visit the shop ${SYM(0x2197)}${V}</a>`, 1], [`<h3>Play ${SYM(0x25b6)}${V}</h3>`, 1], [`<h3>Done ${SYM(0x2714)}${V}</h3>`, 1], [`<button>Call ${SYM(0x260e)}${V}</button>`, 1],
    [`<h3>Careful ${SYM(0x26a0)}${V}</h3>`, 1], [`<h3>Love ${SYM(0x2764)}${V}</h3>`, 1], [`<h4>Brindlewood${SYM(0x2122)}${V}</h4>`, 1], [`<h4>${SYM(0xa9)}${V} 2026</h4>`, 1],
    [`<h3>Star ${SYM(0x2b50)}</h3>`, 1], [`<h3>Watch ${SYM(0x231a)}</h3>`, 1], [`<h3>${SYM(0xd83d, 0xde80)}</h3>`, 1],
  ]);
  batch("emoji clusters and nested label elements are reported once", "DSN-003", [
    ["<h3>Tea ™️</h3>", 1], [`<h3>Fresh <span>${EM}</span> <b>tea</b></h3>`, 1], [`<h3><a href="/about/">${EM} About</a></h3>`, 1],
    ["<h3>\u{1F469}‍\u{1F4BB} \u{1F44B}\u{1F3FD} ❤️</h3>", 1], [`<h3>${EM} tea \u{1F375}</h3>`, 1],
  ]);
  dsn("an emoji in <title> or a head comment is not judged", "DSN-003", "<p>x</p>", 0, sub("index.html", "<title>Brindlewood Tea Co.: Loose-Leaf Tea Shop</title>", "<title>Brindlewood Tea Co.: Loose-Leaf Tea Shop " + EM + "</title>\n<!-- " + EM + " -->"));
  adhoc("DSN-003: the finding names the glyph, the element and the line of the text", homeIns(`<p>x</p>\n<h3>Tea ${EM}</h3>`), (j) => j.lines.some((l) => /^FAIL DSN-003 \/:\d+ forbidden-value: emoji "\u{1F680}" in the text of <h3> "Tea \u{1F680}" \(source: skills\/unslop\/references\/signs\.md:27; planning\/DECISIONS\.md 37/u.test(l)));
  snapAdhoc("DSN-003 (snapshot): an emoji in a heading of a saved page fails", gzSub("about", "<h2>The blenders</h2>", `<h2>${EM} The blenders</h2>`), (j) => ownOf(j, "DSN-003", "FAIL").length === 1 && ownOf(j, "DSN-003", "FAIL")[0].page === "/about/");

  // DSN-004
  batch("uppercase with a positive tracking fails; everything else passes", "DSN-004", [
    ...["uppercase tracking-wide", "uppercase tracking-wider", "uppercase tracking-widest", "tracking-[0.1em] uppercase", "uppercase tracking-[2px]", "uppercase tracking-[.05em]"].map((cls) => [`<p class="${cls}">Label</p>`, 1]),
    ...["uppercase", "tracking-widest", "uppercase tracking-normal", "uppercase tracking-tight", "uppercase tracking-[-0.02em]", "uppercase tracking-[0]", "uppercase tracking-[0em]", "md:uppercase tracking-wide", "uppercase md:tracking-wide", "uppercase tracking-widest normal-case", "uppercase tracking-wide tracking-normal", "lowercase tracking-wide", "uppercase tracking-[var(--t)]"].map((cls) => [`<p class="${cls}">Label</p>`, 0]),
    ['<p class="uppercase tracking-widest"></p>', 0],
    ['<p class="uppercase"><span class="tracking-widest">Label</span></p>', 0],
  ]);
  batch("the same in a style attribute", "DSN-004", [["text-transform: uppercase; letter-spacing: 0.1em", 1], ["text-transform:UPPERCASE;letter-spacing:1px", 1], ["text-transform: uppercase; letter-spacing: normal", 0], ["text-transform: uppercase; letter-spacing: 0", 0], ["text-transform: uppercase; letter-spacing: -0.02em", 0], ["text-transform: capitalize; letter-spacing: 0.2em", 0], ["text-transform: uppercase; letter-spacing: calc(1px + 1px)", 0], ["letter-spacing: 0.2em", 0]].map(([style, n]) => [`<p style="${style}">Label</p>`, n]));
  dsn("uppercase from a class and tracking from a <style> rule on the same element fail", "DSN-004", '<p class="uppercase t">Label</p>', 1, headIns("<style>.t { letter-spacing: 0.2em }</style>"));
  dsn("uppercase from a linked stylesheet and tracking-wide from a class fail", "DSN-004", '<p class="wide tracking-wide">Label</p>', 1, both(putDir("css/a.css", ".wide { text-transform: uppercase }\n"), linkSheet()));

  // DSN-005
  batch("AI-powered copy fails", "DSN-005", ["Our AI-powered tea", "an AI powered shop", "powered by AI", "Powered By AI today", "ai-powered", "Our <b>AI</b>-powered blends", "AI&#8209;powered", "AI-\npowered", "built on AI  powered tech", "an AI\npowered shop"].map((t) => [`<p>${t}</p>`, 1]));
  batch("the hype words fail (whole words, any case)", "DSN-005", ["Supercharge your morning", "a seamless checkout", "Unlock the flavour", "pure Magic", "We revolutionize tea", "Revolutionise your shelf", "revolutionizing the cup", "a revolutionary blend", "a game-changing blend", "a game changing blend", "the Game-Changer", "Our <b>magic</b> blend"].map((tt) => [`<p>${tt}</p>`, 1]));
  batch("words that only contain a hype word pass", "DSN-005", ["a magician at the fair", "a supercharger for the car", "an unlockable level", "seamlessly", "magical", "unlocked", "revolutions per minute", "game on", "changing rooms"].map((tt) => [`<p>${tt}</p>`, 0]));
  batch("near misses and text across a block boundary pass", "DSN-005", ["maintain-powered", "AIR-powered", "AI and powered by tea", "hair powered", "Powered by AIR", "AI </p><p>powered", "AI </p>powered", "AI <div>powered</div>", "wind-powered mill"].map((t) => [`<p>${t}</p>`, 0]));
  dsn("the text of a script, style, noscript, template, comment, svg, title and meta description is not visible body text", "DSN-005", `<script>var a = "AI-powered";</script><noscript>AI-powered</noscript><template>AI-powered</template><!-- a > b AI-powered --><svg viewBox="0 0 4 4"><text>AI-powered</text></svg><style>/* AI-powered */</style>`, 0, sub("index.html", "<title>Brindlewood Tea Co.: Loose-Leaf Tea Shop</title>", "<title>AI-powered Brindlewood</title>"));
  adhoc("DSN-005: the line of a match is the line of the text it starts in, not the line of the block", homeIns("<p>first\nsecond\nthird AI-powered</p>"), (j) => { const lines = readFileSync(join(j.dir, "index.html"), "utf8").split("\n"); const want = lines.findIndex((l) => l.startsWith("third AI-powered")) + 1; return want > 0 && onlyOf(j, "DSN-005").length === 1 && onlyOf(j, "DSN-005")[0].line === want; });
  dsn("two matches in two paragraphs are two findings", "DSN-005", "<p>AI-powered one</p><p>powered by AI two</p>", 2);

  // DSN-006
  batch("an exclamation mark in a heading fails, anywhere else it passes", "DSN-006", [
    ...["h1", "h2", "h3", "h4", "h5", "h6"].map((h) => [`<${h}>Fresh stock!</${h}>`, 1]),
    ["<h3>Fresh <b>stock!</b> now! really!</h3>", 1],
    ["<p>Fresh stock!</p>", 0], ["<button>Buy now!</button>", 0], ['<h3 title="a!">plain</h3>', 0], ["<h3>Why? ¡Tea</h3>", 0],
  ]);

  // DSN-007
  batch("a greeting as the first word of a heading fails; near misses pass", "DSN-007", [
    ...["Hello", "Hi", "Hey", "Welcome", "Greetings", "Howdy", "HELLO", "welcome", "Hello,", "Hi!"].map((w) => [`<h2>${w} tea lovers</h2>`, 1]),
    ...["Hi-fi speakers", "Highlights", "Heythrop Hall", "Say hello", "Hello_world", "Welcomed guests", "Hey'day", "Hiking boots"].map((t) => [`<h2>${t}</h2>`, 0]),
    ["<h4>Hello there</h4>", 0], ["<p>Hello there</p>", 0], ["<h3><span>Welcome</span> to the shop</h3>", 1], ["<h3>Welcome in</h3>", 1],
  ]);
  adhoc("DSN-007: a greeting in the h1 is a finding", sub("index.html", "<h1>Loose-leaf tea, blended in small batches</h1>", "<h1>Hello and welcome</h1>"), (j) => onlyOf(j, "DSN-007").length === 1 && onlyOf(j, "DSN-007")[0].what.includes("<h1>"));

  // DSN-008
  batch("PRO and Beta badges fail, longer words pass", "DSN-008", [
    ...["span", "small", "sup", "div", "strong", "em", "mark", "b"].map((tag) => [`<p>Tools <${tag}>PRO</${tag}></p>`, 1]),
    ...["Beta", "beta", "BETA", " pro ", "Pro"].map((t) => [`<p>Tools <span>${t}</span></p>`, 1]),
    ...["Pro tips", "Beta feature", "Probe", "PRO+", "Alpha"].map((t) => [`<p>Tools <span>${t}</span></p>`, 0]),
    ['<button>PRO</button><a href="/about/">PRO</a><ul><li>PRO</li></ul><p>PRO</p>', 0],
    ["<div><span><b>PRO</b></span></div>", 1],
    ["<span>P<b>RO</b></span>", 1],
  ]);

  // DSN-009
  batch("unverifiable claims fail", "DSN-009", ["Loved by 10,000+ teams", "Trusted by 10,000+ teams", "trusted by 5k customers", "TRUSTED BY 2.5M readers", "loved by 5k customers", "Loved by 2.5M readers", "LOVED BY 300 tea drinkers", "Loved by <b>10,000+</b> teams", "Loved by 12 k+ people", "10x faster", "3.5x better", "2 × cheaper", "4 x more", "10X QUICKER", "5x easier", "2x smarter", "3x higher", "Steeps <b>10x</b> faster"].map((t) => [`<p>${t}</p>`, 1]));
  batch("near misses and text across a block boundary pass", "DSN-009", ["Loved by tea lovers", "trusted by our customers", "loved by us", "10 faster", "10x", "box faster", "2x slower", "10x the flavour", "v2.0x faster", "Loved by </p><p>10,000 teams", "10x </p><p>faster", "Loved by <p>10,000 teams"].map((t) => [`<p>${t}</p>`, 0]));
  dsn("a claim in a script, a comment or an attribute is not judged", "DSN-009", '<script>var a = "10x faster";</script><!-- loved by 5k teams --><p title="10x faster">plain</p>', 0);

  // DSN-010 and DSN-011 (WARN)
  const warnsOf = (j, rule) => j.findings.filter((f) => f.rule === rule && f.status === "WARN");
  batch("a heavy weight on small text warns (classes)", "DSN-010", [
    ...["text-xs font-bold", "text-xs font-extrabold", "text-xs font-black", "font-bold text-[11px]", "font-black text-[0.75rem]", "text-xs font-[700]", "text-[13px] font-[900]", "font-bold text-sm text-xs"].map((cls) => [`<p class="${cls}">Tag</p>`, 1]),
    ...["text-sm font-bold", "text-xs font-semibold", "text-xs font-medium", "text-xs", "font-bold", "text-base font-bold", "text-[14px] font-bold", "text-[0.875rem] font-bold", "text-xs font-bold text-base", "md:text-xs font-bold", "text-xs md:font-bold", "text-xs font-bold font-normal", "text-[#fff] font-bold", "font-bold text-[1em]"].map((cls) => [`<p class="${cls}">Tag</p>`, 0]),
    ['<p class="text-xs font-bold"></p>', 0],
    ['<p class="font-bold"><span class="text-xs">Tag</span></p>', 0],
  ], undefined, "WARN");
  batch("a heavy weight on small text warns (style attribute)", "DSN-010", [["font-weight: bold; font-size: 13px", 1], ["font-weight: 700; font-size: 13.9px", 1], ["font-weight: 900; font-size: .7rem", 1], ["font-weight: bolder; font-size: 10px", 1], ["font-weight: 700; font-size: 14px", 0], ["font-weight: 600; font-size: 12px", 0], ["font-weight: normal; font-size: 12px", 0], ["font-weight: 700; font-size: small", 0], ["font-weight: 700; font-size: 1em", 0], ["font-weight: 700", 0], ["font-size: 12px", 0]].map(([style, n]) => [`<p style="${style}">Tag</p>`, n]), undefined, "WARN");
  batch("weight from a class and size from a stylesheet rule on the same element warn; a style attribute size beats the rule", "DSN-010", [['<p class="small font-bold">Tag</p>', 1], ['<p class="small font-bold" style="font-size: 16px">Tag</p>', 0]], both(putDir("css/a.css", ".small { font-size: 12px }\n"), linkSheet()), "WARN");
  batch("negative letter spacing on small text warns (classes)", "DSN-011", [
    ...["text-xs tracking-tight", "text-xs tracking-tighter", "text-xs tracking-[-0.03em]", "tracking-tight text-[11px]", "tracking-tighter text-[0.7rem]"].map((cls) => [`<p class="${cls}">Tag</p>`, 1]),
    ...["text-sm tracking-tight", "text-xs tracking-wide", "text-xs tracking-normal", "text-xs", "tracking-tight", "text-xs tracking-[0.03em]", "text-xs tracking-tight tracking-normal", "md:text-xs tracking-tight", "text-xs md:tracking-tight", "text-[14px] tracking-tight"].map((cls) => [`<p class="${cls}">Tag</p>`, 0]),
    ['<p class="text-xs tracking-tight"></p>', 0],
  ], undefined, "WARN");
  batch("negative letter spacing on small text warns (style attribute)", "DSN-011", [["letter-spacing: -0.02em; font-size: 12px", 1], ["letter-spacing: -1px; font-size: 13px", 1], ["letter-spacing: -0.02em; font-size: 14px", 0], ["letter-spacing: 0; font-size: 12px", 0], ["letter-spacing: normal; font-size: 12px", 0], ["letter-spacing: 0.02em; font-size: 12px", 0], ["letter-spacing: -0.02em", 0]].map(([style, n]) => [`<p style="${style}">Tag</p>`, n]), undefined, "WARN");
  batch("negative spacing from a <style> block rule and a small size from a class warn", "DSN-011", [['<p class="tight text-xs">Tag</p>', 1]], headIns("<style>.tight { letter-spacing: -0.04em }</style>"), "WARN");
  adhoc("DSN-010 and DSN-011: the two WARN rules together on one element give two WARN lines and the run still exits 0", homeIns('<p class="text-xs font-bold tracking-tight">Tag</p>'), (j) => j.exit === 0 && j.lines.filter((l) => /^WARN DSN-01[01] /.test(l)).length === 2 && !j.lines.some((l) => l.startsWith("FAIL ")));

  // the style sources
  adhoc("DSN styles: an unreadable or missing stylesheet link, a link without a href, and a stylesheet in a subfolder resolve without a crash", both(putDir("css/sub/b.css", "p { text-transform: uppercase; letter-spacing: 1px }\n"), headIns('<link rel="stylesheet" href="css/sub/b.css">\n<link rel="stylesheet">\n<link rel="stylesheet" href="/nope.css">\n<link rel="icon" href="/img/leaf.svg">')), (j) => onlyOf(j, "DSN-004").length > 0 && envLineOk(j) && j.findings.filter((f) => f.rule !== "ENV-001" && f.rule !== "PMP-001").every((f) => f.rule === "DSN-004"));
  adhoc("DSN styles: a page in a subfolder resolves a relative stylesheet from its own folder", both(putDir("about/local.css", "h2 { font-weight: 800; font-size: 11px }\n"), sub("about/index.html", '<meta name="viewport" content="width=device-width, initial-scale=1">', '<meta name="viewport" content="width=device-width, initial-scale=1">\n<link rel="stylesheet" href="local.css">')), (j) => warnsOf(j, "DSN-010").length === 3 && warnsOf(j, "DSN-010").every((f) => f.page === "/about/"));
  adhoc("DSN styles: a CSS declaration with a nested rule or a stray brace does not crash the reader", both(putDir("css/a.css", ".a { color: red; .b { color: blue } text-transform: uppercase; letter-spacing: 1px }\n}}} .c { \n"), linkSheet(), homeIns('<p class="a">x</p>')), (j) => Array.isArray(j.findings));
  const textOfWarn = (j) => warnsOf(j, "DSN-010").map((w) => w.what);
  adhoc("DSN pages: an unclosed li closes at the next li, so its text is its own", homeIns('<ul><li class="text-xs font-bold">New<li>Other words</ul>'), (j) => textOfWarn(j).length === 1 && textOfWarn(j)[0].includes('<li> "New"'));
  adhoc("DSN pages: an unclosed p closes at the next p, so its text is its own", homeIns('<p class="text-xs font-bold">New<p>Other words</p>'), (j) => textOfWarn(j).length === 1 && textOfWarn(j)[0].includes('<p> "New"'));
  adhoc("DSN pages: an unclosed option closes at the next option", homeIns('<select><option class="text-xs font-bold">New<option>Other words</select>'), (j) => textOfWarn(j).length === 1 && textOfWarn(j)[0].includes('<option> "New"'));
  adhoc("DSN pages: a div closes an open p", homeIns('<p class="text-xs font-bold">New<div>Other words</div>'), (j) => textOfWarn(j).length === 1 && textOfWarn(j)[0].includes('<p> "New"'));
  adhoc("DSN pages: an unclosed td closes at the next td", homeIns('<table><tr><td class="text-xs font-bold">New<td>Other words</table>'), (j) => textOfWarn(j).length === 1 && textOfWarn(j)[0].includes('<td> "New"'));
  adhoc("DSN pages: an unclosed li, p and option do not swallow the text that follows (a heading emoji after them is still found)", homeIns(`<ul><li>one<li>two</ul><p>para<p>more<select><option>a<option>b</select><h3>${EM} Found</h3>`), (j) => onlyOf(j, "DSN-003").length === 1);
  adhoc("DSN pages: a lone < in the text of a page does not break the reader (the heading after it is still found)", sub("tasting-room/index.html", "<h2>Before you come</h2>", `<h2>Before you come</h2>\n<p>5 < 6 and a < b</p>\n<h3>${EM} lone</h3>`), (j) => onlyOf(j, "DSN-003").length === 1 && onlyOf(j, "DSN-003")[0].page === "/tasting-room/");
  adhoc("DSN: audit({ rules: ['dsn-003'] }) runs that rule alone, case folded", homeIns(`<h3>${EM} x</h3>`), (j) => { const r = engine.audit(j.dir, { rules: ["dsn-003"] }); return r.rules.length === 1 && r.rules[0].id === "DSN-003" && r.exit === 1; });
  adhoc("DSN: a stylesheet linked from several pages is read once and its element rules reach every page", both(putDir("css/a.css", "h2 { text-transform: uppercase; letter-spacing: 0.1em }\n"), linkSheet(), sub("about/index.html", '<meta name="viewport" content="width=device-width, initial-scale=1">', '<meta name="viewport" content="width=device-width, initial-scale=1">\n<link rel="stylesheet" href="/css/a.css">')), (j) => onlyOf(j, "DSN-004").length === 6 && onlyOf(j, "DSN-004").every((f) => f.page === "/" || f.page === "/about/") && onlyOf(j, "DSN-004").filter((f) => f.page === "/about/").length === 3);

  // ---- slice 4c: the noindex header and the build target ----
  const idxFails = (j) => ownOf(j, "IDX-001", "FAIL");
  const envFails = (j) => ownOf(j, "ENV-001", "FAIL");
  const hdrOf = (slug, v) => jedit(`pages/${slug}/response.json`, (m) => { m.headers["x-robots-tag"] = v; });
  const GOOD_DIR = join(FIX, "good");
  // 1. which x-robots-tag values make the page noindex for Google (the home page, no target: an IDX-001 FAIL on its sitemap entry)
  const HDR_CASES = [
    ["noindex", 1], ["NoIndex", 1], ["noindex, nofollow", 1], ["nofollow, noindex", 1], ["none", 1], ["googlebot: noindex", 1], ["GoogleBot: NOINDEX", 1], ["googlebot: nofollow, noindex", 1],
    ["bingbot: nofollow, googlebot: noindex", 1], ["unavailable_after: 25 Jun 2030 15:00:00 PST, noindex", 1],
    ["bingbot: noindex", 0], ["googlebot-news: noindex", 0], ["bingbot: noindex, googlebot: nofollow", 0], ["googlebot: nofollow, bingbot: noindex", 0], ["bingbot: nofollow, noindex", 0],
    ["nofollow", 0], ["max-snippet: 0", 0], ["unavailable_after: 25 Jun 2030 15:00:00 PST", 0], ["", 0],
    [["noindex"], 1], [["bingbot: nofollow", "noindex"], 1], [["bingbot: noindex", "nofollow"], 0], [["nofollow", "googlebot: noindex"], 1],
  ];
  {
    const wrong = [];
    for (const [v, want] of HDR_CASES) {
      const dir = tmp(); cpSync(SG, dir, { recursive: true });
      hdrOf("home", v)(dir);
      const got = idxFails(engine.audit(dir)).length;
      if (got !== want) wrong.push(`${JSON.stringify(v)}: want ${want} IDX-001 FAIL, got ${got}`);
    }
    check(`snapshot x-robots-tag: noindex, none and a googlebot value make the page noindex; a value for another bot, nofollow and the max-* and unavailable_after directives do not (${HDR_CASES.length} values)`, wrong.length === 0, wrong.join("; "));
  }
  snapAdhoc("snapshot x-robots-tag: the header name in any case is read (X-Robots-Tag)", jedit("pages/home/response.json", (m) => { m.headers["X-Robots-Tag"] = "noindex"; }), (j) => idxFails(j).length === 1);
  {
    const dir = tmp(); cpSync(SG, dir, { recursive: true });
    hdrOf("home", "googlebot: noindex, nofollow")(dir);
    const pg = siteLib.loadSite(dir).pages.get("/");
    check("loadSite (snapshot): the x-robots-tag header joins page.robots and page.noindex follows; the meta reading stays in metaRobots and metaNoindex", pg.noindex === true && pg.headerNoindex === true && pg.metaNoindex === false && pg.metaRobots === "" && /noindex/.test(pg.robots) && /x-robots-tag: googlebot: noindex, nofollow/.test(pg.headerSource), JSON.stringify([pg.noindex, pg.headerNoindex, pg.metaNoindex, pg.metaRobots, pg.robots, pg.headerSource]));
    const other = siteLib.loadSite(join(FIX, "snapshot-good")).pages.get("/");
    check("loadSite (snapshot): a page with no x-robots-tag header has no header noindex and no header source", other.noindex === false && other.headerNoindex === false && other.headerSource === null && other.headerRobots.length === 0);
  }
  // 2. snapshot mode and the target
  const homeHdr = hdrOf("home", "noindex");
  const metaNoindexAbout = gzSub("about", '<meta property="og:type" content="website">', '<meta property="og:type" content="website">\n<meta name="robots" content="noindex">');
  snapAdhoc("target preview (snapshot): a header noindex on one page does not feed IDX-001, and ENV-001 fails the three pages that carry none", homeHdr, (j) => idxFails(j).length === 0 && envFails(j).map((f) => f.page).sort().join() === "/about/,/journal/how-to-steep-oolong/,/tasting-room/" && j.exit === 1, { target: "preview" });
  snapAdhoc("target production (snapshot): the header noindex feeds IDX-001 and is one ENV-001 FAIL naming the page, the response header and the target", homeHdr, (j) => idxFails(j).length === 1 && envFails(j).length === 1 && envFails(j)[0].page === "/" && envFails(j)[0].what.includes("the response header x-robots-tag: noindex") && envFails(j)[0].what.includes("target production"), { target: "production" });
  snapAdhoc("no target (snapshot): the header noindex feeds IDX-001 (it is what the live site says) and ENV-001 prints exactly one SKIP no --target line", homeHdr, (j) => idxFails(j).length === 1 && envLineOk(j));
  snapAdhoc("target preview (snapshot): a meta robots noindex still feeds IDX-001 and satisfies ENV-001 for that page", metaNoindexAbout, (j) => idxFails(j).length === 1 && !envFails(j).some((f) => f.page === "/about/") && envFails(j).length === 3, { target: "preview" });
  snapAdhoc("target production (snapshot): a meta robots noindex is IDX-001's business, not ENV-001's", metaNoindexAbout, (j) => idxFails(j).length === 1 && ownOf(j, "ENV-001").length === 0, { target: "production" });
  snapAdhoc("target preview (snapshot): every page answers noindex: four PASS ENV-001 lines and a clean run", seq(...["home", "about", "tasting-room", "journal__how-to-steep-oolong"].map((s) => hdrOf(s, "noindex, nofollow"))), (j) => j.exit === 0 && j.findings.length === 1 && noCoverageSkipOnly(j) && j.lines.filter((l) => l.startsWith("PASS ENV-001 ")).length === 4, { target: "preview" });
  snapAdhoc("target preview (snapshot): a header noindex for another bot only does not make a preview safe", hdrOf("home", "bingbot: noindex"), (j) => envFails(j).length === 4, { target: "preview" });
  snapAdhoc("target preview (snapshot): a record that did not answer 200 is not judged by ENV-001", seq(addRec("gone", SO + "/gone/", SO + "/gone/", 404, [{ url: SO + "/gone/", status: 404 }], blank)), (j) => envFails(j).length === 4 && !envFails(j).some((f) => f.page === "/gone/"), { target: "preview" });
  // 3. folder mode: the _headers file
  const VP = '<meta name="viewport" content="width=device-width, initial-scale=1">';
  const envRun = (headers, target, edit) => { const dir = tmp(); cpSync(GOOD_DIR, dir, { recursive: true }); if (headers !== null) writeFileSync(join(dir, "_headers"), headers); if (edit) edit(dir); return engine.audit(dir, { rules: ["ENV-001"], target }); };
  const envPages = (j) => envFails(j).map((f) => f.page).sort().join();
  const NI = (pattern) => `${pattern}\n  X-Robots-Tag: noindex\n`;
  const ALL4 = "/,/about/,/journal/how-to-steep-oolong/,/tasting-room/";
  check("_headers splat: /journal/* reaches the page two segments down, and only it", envPages(envRun(NI("/journal/*"), "production")) === "/journal/how-to-steep-oolong/", envPages(envRun(NI("/journal/*"), "production")));
  check("_headers splat: /about/* matches /about/ itself (the splat may be empty)", envPages(envRun(NI("/about/*"), "production")) === "/about/");
  check("_headers splat: /* matches every page including the home page", envPages(envRun(NI("/*"), "production")) === ALL4);
  check("_headers placeholder: /:page/ matches one segment (/about/, /tasting-room/), not / and not the post two segments down", envPages(envRun(NI("/:page/"), "production")) === "/about/,/tasting-room/", envPages(envRun(NI("/:page/"), "production")));
  check("_headers placeholder inside a path: /journal/:slug/ matches the post and nothing else", envPages(envRun(NI("/journal/:slug/"), "production")) === "/journal/how-to-steep-oolong/");
  check("_headers exact path: / matches only the home page", envPages(envRun(NI("/"), "production")) === "/");
  check("_headers exact path: /about (no trailing slash) is not the page /about/ (a pattern is matched exactly)", envPages(envRun(NI("/about"), "production")) === "");
  check("_headers detach: ! X-Robots-Tag under /about/ takes the header off that page only", envPages(envRun("/*\n  X-Robots-Tag: noindex\n/about/\n  ! X-Robots-Tag\n", "production")) === "/,/journal/how-to-steep-oolong/,/tasting-room/", envPages(envRun("/*\n  X-Robots-Tag: noindex\n/about/\n  ! X-Robots-Tag\n", "production")));
  check("_headers detach is read in file order: a detach before the rule that sets the header takes nothing off", envPages(envRun("/about/\n  ! X-Robots-Tag\n/*\n  X-Robots-Tag: noindex\n", "production")) === ALL4);
  check("_headers: a host pattern is not judged (production: no finding), and a preview finding names it as not judged", envFails(envRun(NI("https://:project.pages.dev/*"), "production")).length === 0 && (() => { const j = envRun(NI("https://:project.pages.dev/*"), "preview"); return envFails(j).length === 4 && envFails(j).every((f) => f.what.includes("https://:project.pages.dev/*") && f.what.includes("not judged")); })());
  check("_headers: a pattern with more than one splat is not judged", envFails(envRun(NI("/*/*"), "production")).length === 0);
  check("_headers: a page built as foo.html is served at /foo (pattern /legal reaches legal.html, pattern /legal/ does not)", (() => {
    const mk = (pat) => envPages(envRun(NI(pat), "production", (d) => writeFileSync(join(d, "legal.html"), readFileSync(join(d, "about", "index.html"), "utf8"))));
    return mk("/legal") === "/legal/" && mk("/legal/") === "";
  })());
  check("_headers: comment lines, blank lines and CRLF line endings are read", envPages(envRun("# keep the preview out of the index\r\n\r\n/*\r\n  # a note\r\n  X-Robots-Tag: noindex, nofollow\r\n", "production")) === ALL4);
  check("_headers: a commented-out X-Robots-Tag line is not a header", envPages(envRun("/*\n  # X-Robots-Tag: noindex\n  X-Frame-Options: DENY\n", "production")) === "");
  check("_headers: the googlebot value counts, another bot's does not", envPages(envRun("/*\n  X-Robots-Tag: googlebot: noindex\n", "production")) === ALL4 && envPages(envRun("/*\n  X-Robots-Tag: bingbot: noindex\n", "production")) === "");
  check("_headers: two rules set the header and the FAIL names the line and pattern of the one that says noindex", (() => {
    const j = envRun("/*\n  X-Robots-Tag: nofollow\n/about/\n  X-Robots-Tag: noindex\n", "production");
    return envFails(j).length === 1 && envFails(j)[0].page === "/about/" && envFails(j)[0].what.includes("_headers line 4 (pattern /about/)");
  })());
  check("ENV-001 preview: a folder with no _headers file fails every page and says so", (() => { const j = envRun(null, "preview"); return envPages(j) === ALL4 && envFails(j).every((f) => f.what.includes("the folder has no _headers file") && f.what.includes("target preview")); })());
  check("ENV-001 preview: a meta robots noindex on every page (and no header) satisfies the rule", (() => {
    const j = envRun(null, "preview", (d) => { for (const p of ["index.html", "about/index.html", "tasting-room/index.html", "journal/how-to-steep-oolong/index.html"]) sub(p, VP, VP + '\n<meta name="robots" content="noindex">')(d); });
    return envFails(j).length === 0 && j.lines.filter((l) => l.startsWith("PASS ENV-001 ")).length === 4;
  })());
  check("ENV-001 production: a meta robots noindex on a page is not an ENV-001 finding (IDX-001 judges it)", envRun(null, "production", sub("about/index.html", VP, VP + '\n<meta name="robots" content="noindex">')).findings.length === 0);
  check("ENV-001: the root 404.html of a folder is out of scope (preview, no header: four pages fail, not five)", envPages(envRun(null, "preview", (d) => writeFileSync(join(d, "404.html"), readFileSync(join(d, "about", "index.html"), "utf8")))) === ALL4);
  // 4. the fixtures, the target on the command line, and what the other rules do under each target
  const GP = join(FIX, "good-preview");
  const allPass = (r) => r.out.split(/\r?\n/).filter(Boolean).every((l) => l.startsWith("PASS "));
  const allPassButPmpSkip = (r) => { const ls = r.out.split(/\r?\n/).filter(Boolean); return ls.filter((l) => l.startsWith("SKIP PMP-001 / no --prompt-coverage")).length === 1 && ls.filter((l) => !l.startsWith("SKIP PMP-001 / no --prompt-coverage")).every((l) => l.startsWith("PASS ")); };
  const allPassButEnvSkip = (r) => exceptEnvSkip(r.out.split(/\r?\n/).filter(Boolean)).every((l) => l.startsWith("PASS "));
  const gpPreview = cli([GP, "--target", "preview"]);
  check("good-preview with --target preview: exit 0, every line PASS but the one SKIP PMP-001, four PASS ENV-001 lines (the header noindex is expected and the other rules judge the site as it will be in production)", gpPreview.status === 0 && allPassButPmpSkip(gpPreview) && gpPreview.out.split(/\r?\n/).filter((l) => l.startsWith("PASS ENV-001 ")).length === 4, gpPreview.out + gpPreview.err);
  const gProd = cli([GOOD_DIR, "--target", "production"]);
  check("good with --target production: exit 0 and every line PASS but the one SKIP PMP-001 (four PASS ENV-001 lines)", gProd.status === 0 && allPassButPmpSkip(gProd) && gProd.out.split(/\r?\n/).filter((l) => l.startsWith("PASS ENV-001 ")).length === 4, gProd.out + gProd.err);
  const gpNone = cliRaw([GP]);
  check("good-preview with no target: a folder run is a usage error, exit 2, nothing on stdout, stderr names --target (slice 4c flip)", gpNone.status === 2 && gpNone.out === "" && /needs --target/.test(gpNone.err), gpNone.status + gpNone.out + gpNone.err);
  const bpNone = cliRaw([join(FIX, "bad-ENV-001-preview")]), bpNoneJ = cliRaw(["--json", join(FIX, "bad-ENV-001-preview")]);
  check("bad-ENV-001-preview with no target: exit 2 as well (the indexing of a build is never left unjudged), also with --json; nothing on stdout", bpNone.status === 2 && bpNone.out === "" && /needs --target/.test(bpNone.err) && bpNoneJ.status === 2 && bpNoneJ.out === "" && /needs --target/.test(bpNoneJ.err), bpNone.err);
  const gpProd = engine.audit(GP, { target: "production" });
  check("good-preview with target production (the preview's _headers shipped to production): ENV-001 fails the four pages and IDX-001 the four sitemap entries, exit 1", gpProd.exit === 1 && envFails(gpProd).length === 4 && idxFails(gpProd).length === 4 && gpProd.findings.filter((f) => f.status === "FAIL").length === 8, gpProd.lines.filter((l) => !l.startsWith("PASS")).join(" | "));
  const bProd = engine.audit(join(FIX, "bad-ENV-001-production"), { target: "production" });
  check("bad-ENV-001-production: each ENV-001 FAIL names the page, the _headers line and pattern, and the target", envFails(bProd).length === 4 && envFails(bProd).every((f) => f.what.includes("_headers line 6 (pattern /*): X-Robots-Tag: noindex, nofollow") && f.what.includes("target production") && f.line > 0), envFails(bProd).map((f) => f.what).join(" | "));
  const bPrev = engine.audit(join(FIX, "bad-ENV-001-preview"), { target: "preview" });
  check("bad-ENV-001-preview: each ENV-001 FAIL names the page and the target, and says a preview would be indexed", envFails(bPrev).length === 4 && envFails(bPrev).every((f) => f.what.includes("target preview") && f.what.includes("a preview would be indexed") && f.what.includes("_headers")), envFails(bPrev).map((f) => f.what).join(" | "));
  const sHdr = join(FIX, "snapshot-bad-IDX-001-header");
  {
    const ctx = await import(pathToFileURL(join(AUDIT, "lib", "context.mjs")).href);
    const homeOf = (dir, target) => ctx.buildSite(dir, {}, { target }).pages.get("/");
    const hp = homeOf(GP, "production"), hv = homeOf(GP, "preview"), hn = homeOf(GP, undefined), hs = homeOf(sHdr, undefined), hsp = homeOf(sHdr, "preview");
    check("buildSite: page.robots and page.noindex follow the target (production: the _headers noindex joins; preview, and no target on a folder: it does not); headerNoindex and headerSource are facts in every case",
      hp.noindex === true && /noindex/.test(hp.robots) && hv.noindex === false && hv.robots === "" && hn.noindex === false && hn.robots === "" && [hp, hv, hn].every((p) => p.headerNoindex === true && /^_headers line 6 \(pattern \/\*\)/.test(p.headerSource)),
      JSON.stringify([hp.noindex, hp.robots, hv.noindex, hv.robots, hn.noindex, hn.robots]));
    check("buildSite (snapshot): no target feeds the response header into page.robots and page.noindex; target preview does not, and still knows it (headerNoindex)", hs.noindex === true && /noindex/.test(hs.robots) && hsp.noindex === false && hsp.robots === "" && hsp.headerNoindex === true, JSON.stringify([hs.noindex, hs.robots, hsp.noindex, hsp.robots, hsp.headerNoindex]));
  }
  const shPrev = engine.audit(sHdr, { target: "preview" });
  check("snapshot-bad-IDX-001-header with target preview: the header is expected, exit 0 and no finding", shPrev.exit === 0 && shPrev.findings.length === 1 && noCoverageSkipOnly(shPrev), shPrev.lines.filter((l) => !l.startsWith("PASS")).join(" | "));
  const shProd = engine.audit(sHdr, { target: "production" });
  check("snapshot-bad-IDX-001-header with target production: four ENV-001 FAILs and four IDX-001 FAILs", shProd.exit === 1 && envFails(shProd).length === 4 && idxFails(shProd).length === 4, shProd.lines.filter((l) => !l.startsWith("PASS")).join(" | "));
  check("audit(): the result says which target was judged (null for a snapshot with none); a folder with none is a usage error (exit 2)", engine.audit(GOOD_DIR, { target: "production" }).target === "production" && engine.audit(GOOD_DIR, { target: "preview" }).target === "preview" && engineRaw.audit(SG).target === null && engineRaw.audit(SG, { target: null }).target === null && [undefined, null].every((o) => { try { engineRaw.audit(GOOD_DIR, o === undefined ? undefined : { target: o }); return false; } catch (e) { return e.exit === 2 && /needs --target/.test(e.message); } }));
  // 5. a bad --target is a usage error (exit 2)
  check("--target with a value that is not preview or production exits 2 and names the two values", ["staging", "Preview", "PRODUCTION", "", "production "].every((v) => { const r = cli([GOOD_DIR, "--target", v]); return r.status === 2 && /--target needs preview or production/.test(r.err) && r.out === ""; }));
  check("--target with no value, or followed by another option, exits 2", cli([GOOD_DIR, "--target"]).status === 2 && cli([GOOD_DIR, "--target", "--json"]).status === 2);
  check("audit(dir, { target }) throws a usage error (exit 2) for a target that is not preview or production, an empty string included", ["staging", "", "Preview", 1, true, {}].every((t) => { try { engine.audit(GOOD_DIR, { target: t }); return false; } catch (e) { return e.exit === 2 && /bad --target/.test(e.message); } }));
  check("run.mjs with --target and --only together: only that rule's lines, judged against the target", (() => { const r = json([GP, "--target", "preview", "--only", "ENV-001"]); return r.status === 0 && r.j && r.j.rules.length === 1 && r.j.lines.length === 4 && r.j.lines.every((l) => l.startsWith("PASS ENV-001 ")); })());
  // 6. live.mjs passes --target on to the audit
  {
    const lvT = live(["https://example-tea.invalid/", "--target", "production"], { STANDIN_DIR: sHdr });
    const dirT = cli([sHdr, "--target", "production"]);
    check("live.mjs --target production: the same lines and exit as run.mjs --target production (ENV-001 FAIL lines present)", lvT.status === 1 && dirT.status === 1 && lvT.out === dirT.out && /^FAIL ENV-001 \//m.test(lvT.out), lvT.out.slice(0, 300) + lvT.err);
    const lvP = live(["https://example-tea.invalid/", "--target", "preview"], { STANDIN_DIR: sHdr });
    check("live.mjs --target preview on the same snapshot: exit 0, every line PASS", lvP.status === 0 && lvP.out.split(/\r?\n/).filter(Boolean).every((l) => l.startsWith("PASS ") || l.startsWith("SKIP PMP-001 / no --prompt-coverage")) && lvP.out.length > 0, lvP.out.slice(0, 300) + lvP.err);
    const lvBadT = live(["https://example-tea.invalid/", "--target", "staging"]);
    check("live.mjs: a bad --target exits 2 and judges nothing; --target with no value exits 2", lvBadT.status === 2 && lvBadT.out === "" && /--target needs preview or production/.test(lvBadT.err) && live(["https://example-tea.invalid/", "--target"]).status === 2, lvBadT.err);
  }
  // 7. the one-line switch (slice 4c flip, true since): REQUIRE_TARGET_FOR_FOLDER in index.mjs makes a built folder without a target a usage error; a snapshot never is
  {
    const reqCopy = tmp("omnikom-audit-req-");
    // the engine in use (the copy test/mutate.mjs runs when it breaks one) has the switch on, on one line
    for (const n of ["index.mjs", "run.mjs", "live.mjs", "checks", "lib", "rules"]) cpSync(join(AUDIT, n), join(reqCopy, n), { recursive: true });
    const ix = readFileSync(join(reqCopy, "index.mjs"), "utf8");
    const flag = "export const REQUIRE_TARGET_FOR_FOLDER = true;";
    check("index.mjs has the switch REQUIRE_TARGET_FOR_FOLDER on one line, true (slice 4c flip)", ix.split(flag).length === 2 && ix.split("REQUIRE_TARGET_FOR_FOLDER = false").length === 1);
    const q1 = cliRaw([GOOD_DIR], reqCopy), q2 = cliRaw([GOOD_DIR, "--target", "production"], reqCopy), q3 = cliRaw([SG], reqCopy);
    check("with the switch true: a folder with no target exits 2 naming --target and prints nothing on stdout, a folder with a target runs, a snapshot with no target runs", q1.status === 2 && q1.out === "" && /needs --target/.test(q1.err) && q2.status === 0 && q3.status === 0, `${q1.status} ${q1.err} | ${q2.status} | ${q3.status}`);
    // the real run.mjs: the same three, on the engine under test
    const r1 = cliRaw([GOOD_DIR]), r2 = cliRaw([GOOD_DIR, "--target", "production"]), r3 = cliRaw([SG]);
    check("run.mjs on the engine under test: a folder with no target exits 2 naming --target, with --target production exits 0, a snapshot with no target exits 0", r1.status === 2 && r1.out === "" && /needs --target/.test(r1.err) && r2.status === 0 && r3.status === 0, `${r1.status} ${r1.err} | ${r2.status} | ${r3.status}`);
  }

  // ---- slice 5c: PMP-001, the publish rule of the prompt map ----
  {
    const GC = join(FIX, "good-coverage"), GC_FILE = join(GC, COVERAGE_REL);
    const BU = join(FIX, "bad-PMP-001-uncovered"), BM = join(FIX, "bad-PMP-001-missing-page");
    const pmpLines = (out) => out.split(/\r?\n/).filter((l) => /PMP-001/.test(l));
    // a coverage file written to a temp folder, audited against the good site (rules: PMP-001 only unless `all`)
    const covFile = (text) => { const p = join(tmp("omnikom-audit-cov-"), "prompt-coverage.json"); writeFileSync(p, typeof text === "string" ? text : JSON.stringify(text)); return p; };
    const rowsOf = (...rows) => ({ map: "0".repeat(64), rows });
    const run1 = (obj, dir = GOOD_DIR) => engine.audit(dir, { rules: ["PMP-001"], promptCoverage: covFile(obj) });
    const fails = (j) => j.findings.filter((f) => f.rule === "PMP-001" && f.status === "FAIL");

    // 1. the good site with its coverage file
    const gcAll = cli([GC, "--prompt-coverage", GC_FILE]);
    check("good-coverage with its coverage file: exit 0, 0 FAIL, four PASS PMP-001 lines named by row id, no SKIP line at all", gcAll.status === 0 && !/^FAIL /m.test(gcAll.out) && pmpLines(gcAll.out).join("|") === "PASS PMP-001 pm-1c2d3e4f|PASS PMP-001 pm-9a8b7c6d|PASS PMP-001 pm-3f4e5d6c|PASS PMP-001 pm-5e6f7a8b" && !/^SKIP /m.test(gcAll.out), gcAll.out + gcAll.err);
    const gcProd = cli([GC, "--prompt-coverage", GC_FILE, "--target", "production"]);
    check("good-coverage with its coverage file and --target production: exit 0 and every line PASS", gcProd.status === 0 && allPass(gcProd) && pmpLines(gcProd.out).length === 4, gcProd.out + gcProd.err);
    // 2. no file: one SKIP line, never silent, never a FAIL
    const noFile = json([GC, "--only", "PMP-001"]);
    check("PMP-001 with no --prompt-coverage (the coverage file sits in the folder but is not looked for): exactly one `SKIP PMP-001 / no --prompt-coverage` line, exit 0, the result carries no PASS and no FAIL for it", noFile.status === 0 && noFile.j && noFile.j.lines.length === 1 && noFile.j.lines[0].startsWith("SKIP PMP-001 / no --prompt-coverage") && noFile.j.findings.length === 1 && noFile.j.findings[0].page === "/" && noFile.j.findings[0].status === "SKIP", noFile.out + noFile.err);
    check("PMP-001 SKIP: the same one line in a snapshot, and with a target given", (() => { const a = json([SG, "--only", "PMP-001"]), b = json([GOOD_DIR, "--only", "PMP-001", "--target", "production"]); return a.status === 0 && b.status === 0 && a.j.lines.length === 1 && b.j.lines.length === 1 && a.j.lines[0] === b.j.lines[0] && a.j.mode === "snapshot"; })());
    // 3. the two bad fixtures through the command line: exit 1, the row id (and the path) in the FAIL line
    const bu = cli([BU, "--prompt-coverage", join(BU, COVERAGE_REL), "--only", "PMP-001"]);
    check("bad-PMP-001-uncovered: exit 1 and one FAIL line naming the row id pm-5e6f7a8b, the three answered rows PASS", bu.status === 1 && pmpLines(bu.out).filter((l) => l.startsWith("FAIL ")).length === 1 && /^FAIL PMP-001 pm-5e6f7a8b:1 /m.test(bu.out) && pmpLines(bu.out).filter((l) => l.startsWith("PASS ")).length === 3, bu.out + bu.err);
    const bm = cli([BM, "--prompt-coverage", join(BM, COVERAGE_REL), "--only", "PMP-001"]);
    check("bad-PMP-001-missing-page: exit 1 and one FAIL line naming the row id pm-1c2d3e4f and the path /tasting-room/best-chai/, the three other rows PASS", bm.status === 1 && pmpLines(bm.out).filter((l) => l.startsWith("FAIL ")).length === 1 && /^FAIL PMP-001 pm-1c2d3e4f:1 .*\/tasting-room\/best-chai\//m.test(bm.out) && pmpLines(bm.out).filter((l) => l.startsWith("PASS ")).length === 3, bm.out + bm.err);
    // 4. the judgement of one row
    const row = (o) => ({ id: "pm-aaaa0001", coveredBy: null, kind: "earn-mention", reason: "", ...o });
    check("a null page with a written reason passes; with an empty reason, a whitespace-only reason, a null reason or no reason key it fails", run1(rowsOf(row({ reason: "offsite item 1" }))).exit === 0 && [row({ reason: "" }), row({ reason: " \t\n " }), row({ reason: null }), (({ reason, ...r }) => r)(row())].every((r) => { const j = run1(rowsOf(r)); return j.exit === 1 && fails(j).length === 1 && fails(j)[0].page === "pm-aaaa0001"; }));
    check("a row whose page is not built fails even with a written reason, and names the row id and the normalised path", (() => { const j = run1(rowsOf(row({ coveredBy: "/nope", kind: "new-page", reason: "planned later" }))); return j.exit === 1 && fails(j).length === 1 && fails(j)[0].what.includes("pm-aaaa0001") && fails(j)[0].what.includes("/nope/") && fails(j)[0].what.includes("new-page"); })());
    check("a page path is matched the way page paths are (no trailing slash, /index.html, a .html file, upper case, a fragment)", ["/tasting-room", "tasting-room", "/tasting-room/index.html", "/Tasting-Room/", "/tasting-room/#book"].every((p) => run1(rowsOf(row({ coveredBy: p, kind: "improve-page" }))).exit === 0) && ["/tasting-room/x/", "/tasting", "/about/team/"].every((p) => run1(rowsOf(row({ coveredBy: p }))).exit === 1));
    check("every built page of the good site can cover a row (the home page too)", ["/", "/about/", "/tasting-room/", "/journal/how-to-steep-oolong/"].every((p) => run1(rowsOf(row({ coveredBy: p }))).exit === 0));
    check("a file with no rows is one PASS PMP-001 / line (the rule ran), exit 0", (() => { const j = run1(rowsOf()); return j.exit === 0 && j.lines.join("|") === "PASS PMP-001 /" && j.findings.length === 0; })());
    check("two failing rows are two FAIL lines, in row order, each with its own id; a passing row between them still prints PASS", (() => { const j = run1(rowsOf(row({ id: "pm-bbbb0001" }), row({ id: "pm-bbbb0002", coveredBy: "/about/" }), row({ id: "pm-bbbb0003", coveredBy: "/gone/" }))); return j.exit === 1 && j.lines.length === 3 && j.lines[0].startsWith("FAIL PMP-001 pm-bbbb0001:1 ") && j.lines[1] === "PASS PMP-001 pm-bbbb0002" && j.lines[2].startsWith("FAIL PMP-001 pm-bbbb0003:1 "); })());
    check("PMP-001 in a snapshot: the same judgement on the pages the crawl saw (a covered page passes, a page the crawl did not see fails)", (() => { const ok = engine.audit(SG, { rules: ["PMP-001"], promptCoverage: covFile(rowsOf(row({ coveredBy: "/about/" }))) }), no = engine.audit(SG, { rules: ["PMP-001"], promptCoverage: covFile(rowsOf(row({ coveredBy: "/wholesale/" }))) }); return ok.exit === 0 && ok.mode === "snapshot" && no.exit === 1 && fails(no)[0].what.includes("/wholesale/"); })());
    check("the whole rule set with a coverage file: the other 28 rules judge as before (good-coverage and snapshot-good with a covering file have 0 FAIL)", engine.audit(GC, { promptCoverage: GC_FILE }).findings.filter((f) => f.status === "FAIL").length === 0 && engine.audit(SG, { promptCoverage: covFile(rowsOf(row({ coveredBy: "/" }))) }).exit === 0);
    // 5. a bad coverage file is a usage error (exit 2), never a finding and never a pass
    const badFiles = {
      "not JSON": "{ rows: [",
      "an empty file": "",
      "JSON null": "null",
      "a JSON list": "[]",
      "no rows[]": JSON.stringify({ map: "x" }),
      "rows is not a list": JSON.stringify({ map: "x", rows: {} }),
      "a row that is not an object": JSON.stringify({ rows: ["pm-1"] }),
      "a null row": JSON.stringify({ rows: [null] }),
      "a row with no id": JSON.stringify({ rows: [{ coveredBy: "/", kind: "improve-page" }] }),
      "a row with an empty id": JSON.stringify({ rows: [{ id: " ", coveredBy: "/", kind: "improve-page" }] }),
      "a repeated id": JSON.stringify({ rows: [row(), row()] }),
      "coveredBy that is a number": JSON.stringify({ rows: [row({ coveredBy: 5 })] }),
      "coveredBy that is an empty string": JSON.stringify({ rows: [row({ coveredBy: "" })] }),
      "coveredBy that is missing": JSON.stringify({ rows: [(({ coveredBy, ...r }) => r)(row())] }),
      "kind that is a number": JSON.stringify({ rows: [row({ kind: 3 })] }),
      "reason that is a number": JSON.stringify({ rows: [row({ reason: 7 })] }),
    };
    const badCli = Object.entries(badFiles).map(([what, text]) => { const f = covFile(text); const r = cli([GOOD_DIR, "--prompt-coverage", f]); return { what, f, r }; });
    check(`a bad coverage file exits 2 through run.mjs, prints nothing on stdout and names the file (${badCli.length} shapes: ${Object.keys(badFiles).join("; ")})`, badCli.every((b) => b.r.status === 2 && b.r.out === "" && b.r.err.includes(b.f)), badCli.filter((b) => !(b.r.status === 2 && b.r.out === "" && b.r.err.includes(b.f))).map((b) => `${b.what}: ${b.r.status} ${b.r.err.slice(0, 120)}`).join(" | "));
    check("audit(dir, { promptCoverage }) throws a usage error (exit 2) for each bad file", Object.values(badFiles).every((text) => { try { engine.audit(GOOD_DIR, { promptCoverage: covFile(text) }); return false; } catch (e) { return e.exit === 2; } }));
    const missingCov = cli([GOOD_DIR, "--prompt-coverage", join(ROOT, "no-such-coverage.json")]);
    check("a coverage file that does not exist exits 2 and says not found", missingCov.status === 2 && /prompt-coverage file not found/.test(missingCov.err) && missingCov.out === "", missingCov.err);
    const pcNone = cliRaw([GOOD_DIR, "--target", "production", "--prompt-coverage"]), pcOpt = cliRaw([GOOD_DIR, "--target", "production", "--prompt-coverage", "--json"]);
    check("--prompt-coverage with no value, or followed by another option, exits 2 and judges nothing (with --target given, so the error is about the option, not the target)", pcNone.status === 2 && pcOpt.status === 2 && pcNone.out === "" && pcOpt.out === "" && /--prompt-coverage needs/.test(pcNone.err) && /--prompt-coverage needs/.test(pcOpt.err) && !/a built folder needs --target/.test(pcNone.err + pcOpt.err), pcNone.err + pcOpt.err);
    check("a folder that is given as the coverage file is a usage error too", cli([GOOD_DIR, "--prompt-coverage", GC]).status === 2);
    // 6. live.mjs passes the file on
    {
      const lvC = live(["https://example-tea.invalid/", "--prompt-coverage", covFile(rowsOf(row({ coveredBy: "/about/" }), row({ id: "pm-aaaa0002", coveredBy: "/gone/" })))]);
      check("live.mjs --prompt-coverage: the file reaches the audit (a PMP-001 FAIL line naming the missing page, exit 1, and no SKIP PMP-001 line)", lvC.status === 1 && /^FAIL PMP-001 pm-aaaa0002:1 /m.test(lvC.out) && /^PASS PMP-001 pm-aaaa0001/m.test(lvC.out) && !/SKIP PMP-001/.test(lvC.out), lvC.out.slice(0, 300) + lvC.err);
      const lvBad = live(["https://example-tea.invalid/", "--prompt-coverage"]);
      check("live.mjs: --prompt-coverage with no value exits 2; a bad coverage file exits 2 and prints nothing on stdout", lvBad.status === 2 && lvBad.out === "" && live(["https://example-tea.invalid/", "--prompt-coverage", covFile("{ nope")]).status === 2 && live(["https://example-tea.invalid/", "--prompt-coverage", covFile("{ nope")]).out === "");
    }
    // 7. the usage lines and the docs name the option
    check("the usage line of run.mjs and live.mjs names --prompt-coverage", /--prompt-coverage FILE/.test(cli([]).err) && /--prompt-coverage FILE/.test(live([]).err));
  }

  // work order 05: the summary (summary.mjs and run.mjs --summary), the small versioned object a publish job stores per site
  {
    const { summarize, MAX_BYTES } = await import(pathToFileURL(join(AUDIT, "summary.mjs")).href);
    const parse = (r) => { try { return JSON.parse(r.out); } catch { return null; } };
    const KIB = (v) => Buffer.byteLength(JSON.stringify(v), "utf8");
    const sumOf = (c) => Object.values(c).reduce((a, b) => a + b, 0);
    const sumGood = cli([GOOD_DIR, "--summary"]), sg = parse(sumGood), fullGood = json([GOOD_DIR]).j;
    check("--summary on the good site: exit 0, one JSON object and nothing else (empty stderr), v 1, pass true, exit 0, counts.FAIL 0, no fails, truncated 0",
      sumGood.status === 0 && sg && sumGood.err === "" && sumGood.out.trim().split("\n").length === 1 && sg.v === 1 && sg.pass === true && sg.exit === 0 && sg.counts.FAIL === 0 && Array.isArray(sg.fails) && sg.fails.length === 0 && sg.truncated === 0 && !("commit" in sg), sumGood.out.slice(0, 300) + sumGood.err);
    check("--summary on the good site: target, mode, pages and rules agree with --json; counts.PASS is the number of PASS lines; every status of the findings is counted",
      sg && fullGood && sg.target === fullGood.target && sg.mode === fullGood.mode && sg.pages === fullGood.pages.length && sg.rules === fullGood.rules.length && sg.counts.PASS === fullGood.lines.filter((l) => l.startsWith("PASS ")).length && sg.counts.SKIP === fullGood.findings.filter((f) => f.status === "SKIP").length && sumOf(sg.counts) === fullGood.lines.filter((l) => l.startsWith("PASS ")).length + fullGood.findings.length, JSON.stringify(sg && sg.counts));
    check("--summary on the good site: byFamily has every rule family (MET, SE, DSN) and its counts add up to counts", sg && ["MET", "SE", "DSN"].every((f) => sg.byFamily[f]) && ["PASS", "FAIL", "SKIP"].every((k) => Object.values(sg.byFamily).reduce((a, v) => a + v[k], 0) === sg.counts[k]), JSON.stringify(sg && sg.byFamily));
    const sumBad = cli([join(FIX, "bad-MET-003"), "--summary"]), sb = parse(sumBad);
    check("--summary on bad-MET-003: exit 1, pass false, exactly one MET FAIL (page /tasting-room/, line 48) with its source, counts.FAIL 1 and byFamily.MET.FAIL 1",
      sumBad.status === 1 && sb && sb.pass === false && sb.exit === 1 && sb.fails.length === 1 && sb.fails[0].rule === "MET-003" && sb.fails[0].page === "/tasting-room/" && sb.fails[0].line === 48 && sb.fails[0].source === "checklist/web-delivery.md MET-003" && /skips a level/.test(sb.fails[0].what) && sb.counts.FAIL === 1 && sb.byFamily.MET.FAIL === 1 && Object.entries(sb.byFamily).every(([f, v]) => f === "MET" || v.FAIL === 0), sumBad.out.slice(0, 400));
    const sumJson = cli([GOOD_DIR, "--summary", "--json"]), sumJson2 = cli([GOOD_DIR, "--json", "--summary"]);
    check("--summary with --json (either order) exits 2, prints nothing on stdout and says they cannot be combined", [sumJson, sumJson2].every((r) => r.status === 2 && r.out === "" && /cannot be combined/.test(r.err)), sumJson.err + sumJson2.err);
    check("the usage line of run.mjs names --summary", /--summary/.test(cli([]).err), cli([]).err);
    check("run.mjs --summary prints what summarize() returns for the same audit", sg && JSON.stringify(sg) === JSON.stringify(summarize(engine.audit(GOOD_DIR, { target: "production" }))));
    // the limits, on synthetic audit objects
    const synth = (n, whatLen, extra = {}) => ({ dir: "/x", mode: "static", target: "production", pages: ["/", "/a/"], rules: [{ id: "MET-003", severity: "P1", source: "checklist/web-delivery.md MET-003" }, { id: "SE-004", severity: "P0", source: "checklist/search-engines.md SE-004" }], findings: Array.from({ length: n }, (_, i) => ({ rule: i % 2 ? "SE-004" : "MET-003", page: `/p${i}/`, line: i + 1, what: "x".repeat(whatLen), status: "FAIL" })), lines: [], pass: false, exit: 1, ...extra });
    const small = summarize(synth(5000, 20));
    check("summarize: 5,000 FAILs with short text keep 200 fails in rule order and say truncated 4800", small.fails.length === 200 && small.truncated === 4800 && small.counts.FAIL === 5000 && small.fails.every((f, i) => f.line === i + 1) && KIB(small) < MAX_BYTES, `${small.fails.length} fails, truncated ${small.truncated}`);
    const huge = summarize(synth(5000, 2000)), hugeBytes = KIB(huge);
    check("summarize: 5,000 FAILs with 2,000-character text: at most 200 fails, fails + truncated is 5000, every what is cut to 300 characters, JSON under 60 KiB",
      huge.fails.length <= 200 && huge.fails.length > 0 && huge.fails.length + huge.truncated === 5000 && huge.fails.every((f) => f.what.length === 300 && f.what.endsWith("...")) && hugeBytes < 60 * 1024 && MAX_BYTES === 60 * 1024, `${huge.fails.length} fails, truncated ${huge.truncated}, ${hugeBytes} bytes`);
    const cutAt = summarize(synth(3, 0, { findings: [300, 301, 299].map((n, i) => ({ rule: "MET-003", page: "/", line: i + 1, what: "y".repeat(n), status: "FAIL" })) }));
    check("summarize: a what of 300 characters stays whole, one of 301 is cut to 300", cutAt.fails[0].what === "y".repeat(300) && cutAt.fails[1].what.length === 300 && cutAt.fails[1].what.endsWith("...") && cutAt.fails[2].what === "y".repeat(299), cutAt.fails.map((f) => f.what.length).join(","));
    const odd = summarize(synth(0, 0, { findings: [{ rule: "MET-003", page: "/", line: 1, what: "w", status: "WARN" }, { rule: "SE-004", page: "/", line: 2, what: "w", status: "WEIRD" }, { rule: "SE-004", page: "/a/", line: 3, what: "w", status: "WEIRD" }, { rule: "SE-004", page: "/a/", line: 4, what: "w", status: "constructor" }, { rule: "MET-003", page: "/", line: 5, what: "f", status: "FAIL" }], lines: ["PASS MET-003 /a/", "PASS SE-004 /", "WARN MET-003 / w"], pass: false }));
    check("summarize: a status that is not PASS, FAIL or SKIP is counted under its own key, in counts and in its family, and nothing is dropped",
      odd.counts.WARN === 1 && odd.counts.WEIRD === 2 && odd.counts.constructor === 1 && odd.counts.FAIL === 1 && odd.counts.PASS === 2 && odd.byFamily.SE.WEIRD === 2 && odd.byFamily.MET.WARN === 1 && sumOf(odd.counts) === 7 && odd.fails.length === 1, JSON.stringify(odd.counts));
    const many = summarize(synth(0, 0, { findings: Array.from({ length: 500 }, (_, i) => ({ rule: `F${i}-001`, page: "/", line: 1, what: "w", status: `S${i}`.repeat(30) })) }));
    check("summarize: 500 different statuses and 500 different families stay bounded (the rest is counted under OTHER) and the JSON stays under 60 KiB", sumOf(many.counts) === 500 && many.counts.OTHER > 0 && Object.keys(many.counts).length <= 3 + 40 + 1 && Object.keys(many.byFamily).length <= 40 + 1 && KIB(many) < MAX_BYTES, `${Object.keys(many.counts).length} count keys, ${Object.keys(many.byFamily).length} families, ${KIB(many)} bytes`);
    const sc = summarize(synth(1, 5, { target: null, mode: "snapshot" }), { commit: "bb60318" });
    check("summarize: commit is kept when given (cut to 64 characters), a snapshot target stays null, a finding with no line number has line null", sc.commit === "bb60318" && sc.target === null && sc.mode === "snapshot" && summarize(synth(1, 5), { commit: "c".repeat(200) }).commit.length === 64 && summarize(synth(0, 0, { findings: [{ rule: "MET-003", page: "/", what: "w", status: "FAIL" }] })).fails[0].line === null, JSON.stringify(sc).slice(0, 200));
  }

  // work order 06: the plain names (names.json, read by names.mjs) and the byTopic field of the summary
  {
    const names = await import(pathToFileURL(join(AUDIT, "names.mjs")).href);
    const { summarize } = await import(pathToFileURL(join(AUDIT, "summary.mjs")).href);
    const table = JSON.parse(readFileSync(join(AUDIT, "names.json"), "utf8"));
    const listed = cli(["--list"]).out.split(/\r?\n/).map((l) => l.split(/\s+/)[0]).filter(Boolean);
    const ORDER = [["titles", "Page titles and descriptions"], ["headings", "Headings and structure"], ["indexing", "Indexing"], ["addresses", "Addresses"], ["links", "Links"], ["accessibility", "Accessibility"], ["speed", "Speed"], ["structured-data", "Structured data"], ["ai-questions", "AI question coverage"], ["design", "Design"], ["setting", "Preview or live setting"]];
    // the words a business owner would not know (and rule ids, file names, digits); the em dash is written as an escape so this file holds none
    const EM_DASH = String.fromCharCode(0x2014);
    const JARGON = /canonical|\bh[1-6]\b|ld\+json|json-ld|\bLCP\b|\bCLS\b|\bTBT\b|\bTTFB\b|lastmod|x-robots|robots\.txt|noindex|nofollow|sitemap|hreflang|\balt\b|\bmeta\b|\bjson\b|\bhtml\b|\burl\b|\bseo\b|\bschema\b/i;
    const sentenceOk = (s) => typeof s === "string" && s.length > 0 && s.length <= 120 && s.endsWith(".") && !s.includes(EM_DASH) && !/\d/.test(s) && !JARGON.test(s) && !/[A-Z0-9]+-\d{3}/.test(s) && !/\.(mjs|json|md|html|txt|xml)\b/i.test(s);
    check("plain names: the sentence check itself refuses no final period, 121 characters, an em dash, a digit, jargon, a rule id and a file name",
      sentenceOk("A page has a problem.") && !sentenceOk("A page has a problem") && !sentenceOk("a".repeat(120) + ".") && sentenceOk("a".repeat(119) + ".") && !sentenceOk("A page " + EM_DASH + " has a problem.") && !sentenceOk("A page has 3 problems.") && !sentenceOk("The canonical link is wrong.") && !sentenceOk("See MET-003.") && !sentenceOk("See robots.txt.") && !sentenceOk(""), "");
    // 4a: every rule the engine has (as run.mjs --list prints it) has a topic and a plain sentence
    const wrong = listed.filter((id) => { const e = table.rules[id]; return !e || !table.topics.some((t) => t.id === e.topic) || !sentenceOk(e.problem) || names.topicOf(id) !== e.topic || names.problemOf(id) !== e.problem; });
    check("plain names: every rule that run.mjs --list prints has a known topic and a sentence of at most 120 characters, a final period, no digit, no em dash and no jargon",
      listed.length > 0 && JSON.stringify(listed) === JSON.stringify(engine.listRules().map((r) => r.id)) && wrong.length === 0, `no good entry for: ${wrong.join(", ")}; listed ${listed.length}`);
    // 4b: the table has no rule the engine lacks, uses every topic, and keeps the topics in the spec's order
    const extra = Object.keys(table.rules).filter((id) => !listed.includes(id));
    check("plain names: the table names no rule the engine does not have", extra.length === 0, `not in the engine: ${extra.join(", ")}`);
    const unused = table.topics.filter((t) => !Object.values(table.rules).some((e) => e.topic === t.id)).map((t) => t.id);
    check("plain names: every topic is used by at least one rule", table.topics.length > 0 && unused.length === 0, `unused: ${unused.join(", ")}`);
    check("plain names: v is 1, the topics are the spec's eleven with their names in the spec's order, and TOPICS of names.mjs is that list",
      table.v === 1 && JSON.stringify(table.topics.map((t) => [t.id, t.name])) === JSON.stringify(ORDER) && JSON.stringify(names.TOPICS) === JSON.stringify(table.topics), JSON.stringify(table.topics.map((t) => t.id)));
    // 4d: an id outside the table
    check("plain names: topicOf of an unknown id is other and problemOf of it is null (also for a name from Object.prototype)",
      names.topicOf("XYZ-999") === "other" && names.problemOf("XYZ-999") === null && names.topicOf("constructor") === "other" && names.problemOf("__proto__") === null && names.problemOf("MET-003") === "A page has no main heading, more than one, or headings that skip a level." && names.topicOf("MET-003") === "headings", `${names.topicOf("XYZ-999")} ${names.problemOf("XYZ-999")}`);
    // 4c: byTopic in the summary
    const goodSum = summarize(engine.audit(GOOD_DIR, { target: "preview" })), goodTopic = goodSum.byTopic || {};   // `|| {}`: a summary with no byTopic is a red check, not a crash
    const statuses = [...new Set([...Object.keys(goodSum.counts), ...Object.values(goodTopic).flatMap((v) => Object.keys(v))])];
    const sums = statuses.map((s) => [s, Object.values(goodTopic).reduce((a, v) => a + (v[s] || 0), 0), goodSum.counts[s] || 0]);
    check("summarize on the good site (--target preview): every topic of names.mjs is in byTopic, and the sum over byTopic equals counts for each status (PASS, FAIL, SKIP and any other)",
      names.TOPICS.every((t) => goodTopic[t.id]) && goodSum.counts.PASS > 0 && goodSum.counts.SKIP > 0 && sums.every(([, a, b]) => a === b), JSON.stringify(sums));
    const badSum = summarize(engine.audit(join(FIX, "bad-MET-003"), { target: "preview" })), badTopic = badSum.byTopic || {};
    check("summarize on bad-MET-003: byTopic.headings.FAIL is 1 or more and byTopic.titles.FAIL is 0, and the sum over byTopic equals counts.FAIL",
      badTopic.headings?.FAIL >= 1 && badTopic.titles?.FAIL === 0 && Object.values(badTopic).reduce((a, v) => a + v.FAIL, 0) === badSum.counts.FAIL, JSON.stringify(badSum.byTopic));
    const fakeAudit = { dir: "/x", mode: "static", target: "production", pages: ["/"], rules: [{ id: "MET-003", severity: "P0", source: "s" }], findings: [{ rule: "XYZ-999", page: "/", line: 1, what: "w", status: "FAIL" }, { rule: "MET-003", page: "/", line: 2, what: "w", status: "WARN" }, { rule: "MET-003", page: "/", line: 3, what: "w", status: "WEIRD" }], lines: ["PASS MET-001 /", "PASS XYZ-999 /"], pass: false, exit: 1 };
    const odd = summarize(fakeAudit), oddTopic = odd.byTopic || {};
    check("summarize: a rule id outside the table is counted under byTopic.other, a WARN or an unusual status under its own key in its topic, and a PASS line by the topic of its rule",
      oddTopic.other?.FAIL === 1 && oddTopic.other?.PASS === 1 && oddTopic.headings?.WARN === 1 && oddTopic.headings?.WEIRD === 1 && oddTopic.titles?.PASS === 1 && odd.v === 1, JSON.stringify(odd.byTopic));
    check("summarize: byTopic has no other key when every rule id is in the table", goodSum.byTopic !== undefined && !("other" in goodTopic) && !("other" in badTopic), Object.keys(goodTopic).join(","));
  }

  // work order 09: the six-question report (report.mjs): the source rule, the six headings, the order of section 6, no jargon, the CLI
  {
    const { report } = await import(pathToFileURL(join(AUDIT, "report.mjs")).href);
    const { summarize } = await import(pathToFileURL(join(AUDIT, "summary.mjs")).href);
    const names = await import(pathToFileURL(join(AUDIT, "names.mjs")).href);
    const EM = String.fromCharCode(0x2014);
    const ruleById = Object.fromEntries(engine.listRules().map((r) => [r.id, r]));
    // The test's own reader of a fact's source (it shares no code with report.mjs): a path in the summary, listRules()["ID"].severity, checkedAt, distinct(path),
    // [*] for every entry and [2,5] for the listed ones, and a sum or difference of such terms.
    // work order 25 adds the root live (the skill's report.json), a path ending .length, " (x100, rounded)" (Math.round(v * 100)) and " (day)" (the first 10 characters)
    const resolveSource = (src, summary, date, live) => {
      const split = (s) => {
        const out = []; let depth = 0, quoted = false, cur = "";
        for (let i = 0; i < s.length; i++) {
          const ch = s[i];
          if (quoted) { cur += ch; if (ch === "\\") cur += s[++i]; else if (ch === '"') quoted = false; continue; }
          if (ch === '"') quoted = true;
          if (ch === "[" || ch === "(") depth++;
          if (ch === "]" || ch === ")") depth--;
          if (depth === 0 && (s.startsWith(" + ", i) || s.startsWith(" - ", i))) { out.push(cur, s[i + 1]); cur = ""; i += 2; continue; }
          cur += ch;
        }
        out.push(cur);
        return out;
      };
      const walk = (expr) => {
        const root = /^(summary|listRules\(\)|live)/.exec(expr);
        if (!root) throw new Error("no such source root: " + expr);
        if (root[1] === "live" && live === undefined) throw new Error("no live report was given for " + expr);
        let nodes = [root[1] === "summary" ? summary : root[1] === "live" ? live : ruleById];
        const step = /\.(\w+)|\[("(?:[^"\\]|\\.)*")\]|\[(\*|\d+(?:,\d+)*)\]/y;
        step.lastIndex = root[0].length;
        while (step.lastIndex < expr.length) {
          const at = step.lastIndex, s = step.exec(expr);
          if (!s || s.index !== at) throw new Error("cannot read the source at: " + expr.slice(at));
          if (s[3] === undefined) {
            const k = s[1] ?? JSON.parse(s[2]);
            nodes = nodes.map((o) => { if (o === null || typeof o !== "object" || !Object.hasOwn(o, k)) throw new Error(`nothing at ${k} in ${expr}`); return o[k]; });
          } else {
            const idx = s[3] === "*" ? null : s[3].split(",").map(Number);
            nodes = nodes.flatMap((o) => { if (!Array.isArray(o)) throw new Error("not a list in " + expr); return idx === null ? o : idx.map((i) => { if (!(i in o)) throw new Error(`no entry ${i} in ${expr}`); return o[i]; }); });
          }
        }
        return nodes;
      };
      const term = (t) => {
        t = t.trim();
        if (/^\d+$/.test(t)) return Number(t);
        if (t === "checkedAt") { if (!date) throw new Error("checkedAt was not given"); return date; }
        const sfx = /^(.*) \((x100, rounded|day)\)$/s.exec(t);
        if (sfx) { const v = term(sfx[1]); return sfx[2] === "day" ? String(v).slice(0, 10) : Math.round(v * 100); }
        const d = /^distinct\((.*)\)$/s.exec(t);
        if (d) return new Set(walk(d[1])).size;
        const nodes = walk(t);
        if (nodes.length !== 1) throw new Error(`${t} reads ${nodes.length} values, not one`);
        return nodes[0];
      };
      const parts = split(src);
      let v = term(parts[0]);
      for (let i = 1; i < parts.length; i += 2) v = parts[i] === "+" ? v + term(parts[i + 1]) : v - term(parts[i + 1]);
      return v;
    };
    // THE SOURCE RULE, read back: what is wrong with the report of this summary (an empty list = nothing)
    const sourceProblems = (summary, date) => {
      const { md, facts } = report(summary, date ? { checkedAt: date } : {});
      const bad = [];
      let text = md.replace(/^## \d\. /gm, "## ").replace(/`[^`]*`/g, "");
      if (date) text = text.split(date).join("");   // the date is printed whole, once, and is the checkedAt fact
      const runs = text.match(/\d+/g) || [];
      const values = new Set(facts.map((f) => String(f.value)));
      if (!facts.length) bad.push("no facts at all");
      for (const r of new Set(runs)) if (!values.has(r)) bad.push(`the digits ${r} in the text are no fact`);
      for (const f of facts) {
        let got;
        try { got = resolveSource(f.source, summary, date); } catch (e) { bad.push(`${f.id}: ${e.message}`); continue; }
        if (got !== f.value) bad.push(`${f.id}: ${f.source} gives ${JSON.stringify(got)}, the fact says ${JSON.stringify(f.value)}`);
      }
      for (const f of facts) if (typeof f.value === "number" && !runs.includes(String(f.value))) bad.push(`${f.id}: the fact ${f.value} is not in the text`);
      if (date && !facts.some((f) => f.value === date && f.source === "checkedAt")) bad.push("no checkedAt fact");
      return { md, facts, bad };
    };
    // the inputs: the real summaries of fixtures (made here, never stored) and synthetic ones
    const sumGood = summarize(engine.audit(GOOD_DIR, { target: "production" }));
    const badDir = join(FIX, "bad-MET-003");
    const sumBadPreview = summarize(engine.audit(badDir, { target: "preview" }));
    const sumBadLive = summarize(engine.audit(badDir, { target: "production" }));
    const synthAudit = (findings, ids, extra = {}) => ({ dir: "/x", mode: "static", target: "production", pages: ["/", "/a/"], rules: ids.map((id) => ({ id, severity: ruleById[id].severity, source: "s" })), findings, lines: ids.map((id) => `PASS ${id} /`), pass: !findings.some((f) => f.status === "FAIL"), exit: findings.some((f) => f.status === "FAIL") ? 1 : 0, ...extra });
    const fail = (rule, page, line) => ({ rule, page, line, what: "w", status: "FAIL" });
    const manyFindings = [
      ...Array.from({ length: 20 }, (_, i) => fail("DSN-005", `/d${i}/`, i + 1)),
      ...Array.from({ length: 7 }, (_, i) => fail("MET-003", `/m${i % 6}/`, i + 1)),     // 7 findings on 6 pages
      ...Array.from({ length: 3 }, (_, i) => fail("SE-004", `/s${i}/`, i + 1)),
      { rule: "MET-004", page: "/", line: 1, what: "w", status: "WARN" },
    ];
    const sumMany = { ...summarize(synthAudit(manyFindings, ["DSN-005", "MET-003", "SE-004", "MET-004"])), truncated: 12 };
    const thirteen = engine.listRules().slice(0, 13).map((r) => r.id);
    const sumThirteen = summarize(synthAudit(thirteen.map((id, i) => fail(id, `/t${i}/`, 1)), thirteen));
    const sumWarn = summarize(synthAudit([{ rule: "DSN-010", page: "/", line: 1, what: "w", status: "WARN" }], ["DSN-010"], { pass: true, exit: 0 }));
    const inputs = [["good", sumGood, "2026-11-04"], ["good without a date", sumGood, null], ["bad-MET-003 preview", sumBadPreview, "2026-11-04"], ["bad-MET-003 live", sumBadLive, "2026-11-04"], ["30 FAILs over 3 rules", sumMany, "2026-11-04"], ["13 rules", sumThirteen, "2026-11-04"], ["a WARN only", sumWarn, "2026-11-04"]];
    const reports = Object.fromEntries(inputs.map(([name, s, date]) => [name, sourceProblems(s, date)]));
    const sections = (md) => { const out = {}; let at = null; for (const l of md.split("\n")) { const h = /^## (\d)\./.exec(l); if (h) at = out[h[1]] = []; else if (at) at.push(l); } return out; };
    const bullets = (md) => (sections(md)[6] || []).filter((l) => l.startsWith("- "));

    // 4a THE SOURCE RULE
    for (const [name, , date] of inputs) check(`report: ${name}: every number in the text is the value of a fact, every fact's source gives its value, every numeric fact is in the text`, reports[name].bad.length === 0, reports[name].bad.slice(0, 3).join(" | "));
    check("report: the source reader itself works (a sum, a difference, distinct, a list of entries, a quoted key, a severity, the date) and refuses a wrong path",
      resolveSource("summary.counts.PASS + summary.counts.FAIL", sumBadLive, null) === sumBadLive.counts.PASS + sumBadLive.counts.FAIL && resolveSource("distinct(summary.fails[*].rule) - 1", sumMany, null) === 2 && resolveSource("distinct(summary.fails[20,21,22].page)", sumMany, null) === 3
      && resolveSource('summary.byTopic["structured-data"].PASS', sumGood, null) === sumGood.byTopic["structured-data"].PASS && resolveSource('listRules()["MET-003"].severity', sumGood, null) === "P0" && resolveSource("checkedAt", sumGood, "2026-11-04") === "2026-11-04"
      && (() => { try { resolveSource("summary.counts.NOPE", sumGood, null); return false; } catch { return true; } })() && (() => { try { resolveSource("summary.fails[999].page", sumGood, null); return false; } catch { return true; } })());
    check("report: a wrong source is seen by the source check (the check itself is not blind): a printed number with no fact, and a fact read from the wrong path, both come back as problems",
      (() => { const r = report(sumBadLive, { checkedAt: "2026-11-04" }); const lie = r.facts.map((f) => (f.id === "pass" ? { ...f, source: "summary.counts.FAIL" } : f)); return lie.some((f) => f.id === "pass" && resolveSource(f.source, sumBadLive, "2026-11-04") !== f.value) && !new Set(r.facts.map((f) => String(f.value))).has(String(sumBadLive.pages + 7000)); })());

    // 4b the headings, the order, the topics
    const HEADINGS = ["## 1. Can search engines and AI crawlers reach and read the site?", "## 2. Is there a page for what people actually search?", "## 3. Is each page better than what ranks now?", "## 4. Does the site have the authority to rank?", "## 5. Is it cited by AI engines? If not, who is, and why?", "## 6. What to fix, in order"];
    for (const [name] of inputs) check(`report: ${name}: starts with "# Search check" and the short answer, then the six headings exactly as report-live.mjs words them, in order`,
      (() => { const md = reports[name].md, ls = md.split("\n"); return ls[0] === "# Search check" && ls[2].startsWith("**Short answer:** ") && JSON.stringify(ls.filter((l) => l.startsWith("## "))) === JSON.stringify(HEADINGS) && ls.filter((l) => l.startsWith("# ")).length === 1; })(), reports[name].md.slice(0, 200));
    for (const [name, s] of inputs) check(`report: ${name}: section 1 has one line per topic in the order of TOPICS, with its name and its PASS, FAIL and WARN counts from byTopic`,
      (() => { const lines = (sections(reports[name].md)[1] || []).filter((l) => l.startsWith("- ")); const want = names.TOPICS.map((t) => { const b = s.byTopic[t.id], w = b.WARN || 0; if (b.PASS + b.FAIL + w === 0) return `- ${t.name}: not checked this time`; return `- ${t.name}: ${b.PASS} pass, ${b.FAIL} ${b.FAIL === 1 ? "problem" : "problems"}, ${w ? w + " " + (w === 1 ? "warning" : "warnings") : "no warnings"}`; }); return lines.length === want.length && want.every((w, i) => lines[i].startsWith(w)); })(), (sections(reports[name].md)[1] || []).join(" | ").slice(0, 300));
    check("report: sections 2 to 5 are each a Not measured yet card with a What unblocks it line, and say nothing measured",
      ["2", "3", "4", "5"].every((k) => { const t = (sections(reports["good"].md)[k] || []).join("\n"); return t.includes("**Not measured yet.** ") && /\nWhat unblocks it: .+/.test(t) && !/\d/.test(t); }));
    check("report: bad-MET-003 (production): Speed, which a built folder never judges, reads exactly Speed: not checked this time; AI question coverage with only a SKIP reads not checked this time, 1 not run; a topic with checks still shows its counts; no report says 0 pass, 0 problems",
      (() => { const l = (sections(reports["bad-MET-003 live"].md)[1] || []).filter((x) => x.startsWith("- ")); const sumL = sumBadLive.byTopic; return sumL.speed.PASS + sumL.speed.FAIL + sumL.speed.SKIP === 0 && l.includes("- Speed: not checked this time") && l.includes("- AI question coverage: not checked this time, 1 not run") && l.some((x) => x.startsWith("- Headings and structure: ") && x.includes(" 1 problem,")) && !l.some((x) => x.startsWith("- Headings and structure: not checked")) && inputs.every(([name]) => !/\b0 pass, 0 problems/.test(reports[name].md)); })(), (sections(reports["bad-MET-003 live"].md)[1] || []).join(" | ").slice(0, 400));
    check("report: the kind of site is said in plain words: production is live, preview is preview", /on the live site:/.test(reports["good"].md) && /on the preview site:/.test(reports["bad-MET-003 preview"].md) && /^Checked the live site: /m.test(reports["good without a date"].md) && !/20\d\d-/.test(reports["good without a date"].md) && /^Checked 2026-11-04 on the live site: /m.test(reports["good"].md));

    // 4c the real fixtures
    const first = (md) => (bullets(md)[0] || "");
    check("report: bad-MET-003 (live, one FAIL): the short answer says not yet with 1 problem, and the first bullet of section 6 is MET-003's plain sentence on 1 page",
      /^\*\*Short answer:\*\* Not yet: 1 problem stops a publish\.$/m.test(reports["bad-MET-003 live"].md) && first(reports["bad-MET-003 live"].md).startsWith("- " + names.problemOf("MET-003") + " On 1 page: `/tasting-room/`.") && bullets(reports["bad-MET-003 live"].md).length === 1, first(reports["bad-MET-003 live"].md));
    check("report: bad-MET-003 (preview, which also trips ENV-001 on every page): not yet, MET-003's sentence is in section 6, and ENV-001 comes first (same severity, more pages)",
      /^\*\*Short answer:\*\* Not yet: 5 problems stop a publish\.$/m.test(reports["bad-MET-003 preview"].md) && (() => { const b = bullets(reports["bad-MET-003 preview"].md); return b.length === 2 && b[0].includes(names.problemOf("ENV-001")) && b[1].includes(names.problemOf("MET-003")); })(), bullets(reports["bad-MET-003 preview"].md).join(" | "));
    check("report: good: the short answer is yes and section 6 says there is nothing to fix and has no bullet",
      /^\*\*Short answer:\*\* Yes, nothing stops a publish\.$/m.test(reports["good"].md) && bullets(reports["good"].md).length === 0 && (sections(reports["good"].md)[6] || []).includes("Nothing to fix: no check failed.") && !/more problems? (was|were) found/.test(reports["good"].md));
    check("report: a WARN-only summary is still yes, and says the warning is worth a look (the WARN count is a fact)", /^\*\*Short answer:\*\* Yes, nothing stops a publish; 1 warning is worth a look\.$/m.test(reports["a WARN only"].md) && reports["a WARN only"].facts.some((f) => f.id === "warnings" && f.value === 1 && f.source === "summary.counts.WARN"));
    check("report: a check that did not run is said, not hidden (good: the one PMP-001 SKIP), and is not counted in the total", /checks pass on \d+ pages\. 1 check did not run\.$/m.test(reports["good"].md) && reports["good"].facts.find((f) => f.id === "total").value === sumGood.counts.PASS + sumGood.counts.FAIL);

    // 4d the synthetic summary: 30 FAILs over 3 rules, a WARN, truncated 12
    check("report: 30 FAILs over 3 rules: section 6 has 3 bullets in the order P0 first (MET-003, 6 pages), then the P1 rule with more pages (DSN-005, 20 pages), then SE-004 (3 pages)",
      (() => { const b = bullets(reports["30 FAILs over 3 rules"].md); return b.length === 3 && b[0].includes(names.problemOf("MET-003")) && b[1].includes(names.problemOf("DSN-005")) && b[2].includes(names.problemOf("SE-004")) && b[0].includes(" On 6 pages: ") && b[1].includes(" On 20 pages: ") && b[2].includes(" On 3 pages: "); })(), bullets(reports["30 FAILs over 3 rules"].md).map((l) => l.slice(0, 40)).join(" | "));
    check("report: at most 5 pages on a line, then and <k> more (20 pages: 5 and 15 more; 6 pages: 5 and 1 more; 3 pages: all three), in section 6 and in section 1",
      (() => { const md = reports["30 FAILs over 3 rules"].md; const b = bullets(md); const spans = (l) => (l.match(/`[^`]*`/g) || []).length; const s1 = (sections(md)[1] || []).filter((l) => l.startsWith("  - ")); return spans(b[1]) === 5 && b[1].includes("`/d4/` and 15 more.") && spans(b[0]) === 5 && b[0].includes("and 1 more.") && spans(b[2]) === 3 && !/ more\./.test(b[2]) && s1.length === 3 && s1.filter((l) => spans(l) === 5).length === 2 && s1.some((l) => l.includes("and 15 more")); })(), bullets(reports["30 FAILs over 3 rules"].md).join(" | "));
    check("report: summary.truncated 12 gives the line 12 more problems were found but not stored with this check; a summary with truncated 0 has no such line",
      /^12 more problems were found but not stored with this check\.$/m.test(reports["30 FAILs over 3 rules"].md) && reports["30 FAILs over 3 rules"].facts.some((f) => f.id === "truncated" && f.value === 12 && f.source === "summary.truncated") && !/not stored with this check/.test(reports["good"].md + reports["bad-MET-003 live"].md));
    check("report: more than 10 problems: 10 bullets, then And 3 more problems (the 13 rules), and no numbered list anywhere",
      bullets(reports["13 rules"].md).length === 10 && /^And 3 more problems, lower in the same order\.$/m.test(reports["13 rules"].md) && inputs.every(([name]) => !/^\s*\d+\. /m.test(reports[name].md)));
    check("report: the WARN of the synthetic summary is in section 1 (MET-004 is in the titles or headings topic) and not in section 6 (a WARN is not a fix-first problem)",
      (sections(reports["30 FAILs over 3 rules"].md)[1] || []).some((l) => l.startsWith("- " + names.TOPICS.find((t) => t.id === names.topicOf("MET-004")).name + ": ") && / 1 warning/.test(l)) && bullets(reports["30 FAILs over 3 rules"].md).every((l) => !l.includes(names.problemOf("MET-004"))));
    check("report: a rule id outside names.json is counted in an Other checks line and its problem has a fallback plain sentence, never a rule id or null",
      (() => { const a = synthAudit([fail("XYZ-999", "/x/", 1)], ["MET-003"]); const r = report(summarize(a), { checkedAt: "2026-11-04" }); return /^- Other checks: 0 pass, 1 problem, no warnings/m.test(r.md) && /A check found a problem that has no plain description yet\./.test(r.md) && !/XYZ|null|undefined/.test(r.md); })());

    check("report: a summary that says pass but carries a FAIL is not yes (the short answer needs pass and no FAIL), and a page with a backtick or a line break in its name stays inside one backtick span on one line",
      (() => { const r = report({ ...sumBadLive, pass: true }, { checkedAt: "2026-11-04" }); const odd = report(summarize(synthAudit([fail("MET-003", "/a`b\nc/", 1)], ["MET-003"])), { checkedAt: "2026-11-04" }); const b = bullets(odd.md); return /^\*\*Short answer:\*\* Not yet: 1 problem stops a publish\.$/m.test(r.md) && b.length === 1 && (b[0].match(/`/g) || []).length === 2 && b[0].includes("`/a b c/`"); })());
    // 4e no rule ids, file names, jargon or em dash; the library and the CLI refuse what is not a summary
    const JARGON = /canonical|\bh[1-6]\b|ld\+json|json-ld|\bLCP\b|\bCLS\b|\bTBT\b|\bTTFB\b|lastmod|x-robots|robots\.txt|noindex|nofollow|sitemap|hreflang|\balt\b|\bmeta\b|\bjson\b|\bhtml\b|\burl\b|\bseo\b|\bschema\b/i;
    for (const [name] of inputs) {
      const outside = reports[name].md.replace(/`[^`]*`/g, "");
      check(`report: ${name}: no rule id, file name, jargon word or em dash outside the backtick spans`, !/[A-Z]{2,3}-\d{3}/.test(outside) && !/\.(mjs|json|md|html|txt|xml)\b/i.test(outside) && !JARGON.test(outside) && !outside.includes(EM), (outside.match(/[A-Z]{2,3}-\d{3}|\.(mjs|json|md|html|txt|xml)\b|canonical|sitemap/i) || [outside.includes(EM) ? "em dash" : ""])[0]);
    }
    check("report: the lines of the text never carry a rule id even for a rule with no plain sentence (the fallback), and the pages sit in backticks only", reports["30 FAILs over 3 rules"].md.split("\n").filter((l) => l.startsWith("- ") && l.includes("Omnikom fixes this")).every((l) => /: `\/[^`]*`[^`]*$|: `\/[^`]*`(, `\/[^`]*`)*( and (`\/[^`]*`|\d+ more))?\. Omnikom fixes this; the fix ships with the next publish\.$/.test(l)));
    check("report: the same summary and date give the same text and the same facts (nothing random, nothing read from the clock)", JSON.stringify(report(sumMany, { checkedAt: "2026-11-04" })) === JSON.stringify(report(sumMany, { checkedAt: "2026-11-04" })) && report(sumMany).md === report(sumMany, { checkedAt: undefined }).md);
    const refused = (s, o) => { try { report(s, o); return null; } catch (e) { return e; } };
    const notSummaries = [null, undefined, 5, "text", [], {}, { ...sumGood, v: 2 }, { ...sumGood, v: undefined }, { ...sumGood, byTopic: undefined }, { ...sumGood, counts: { PASS: 1 } }, { ...sumGood, fails: "x" }, { ...sumGood, fails: [{ rule: 5, page: "/" }] }, { ...sumGood, pages: -1 }, { ...sumGood, pass: "yes" }, { ...sumGood, truncated: 1.5 }, { ...sumGood, byTopic: { ...sumGood.byTopic, headings: undefined } }];
    check(`report: ${notSummaries.length} things that are not a work order 05 summary with byTopic throw an AuditError with exit 2 (nothing printed)`, notSummaries.every((s) => { const e = refused(s); return e && e.exit === 2 && e instanceof engine.AuditError && !e.message.includes("\n"); }), notSummaries.map((s) => { const e = refused(s); return e ? e.exit : "no error"; }).join(","));
    check("report: a bad date (not YYYY-MM-DD, or not a real day) throws an AuditError with exit 2; null and undefined mean no date", ["2026-13-01", "2026-02-30", "2026-2-3", "yesterday", "", "20261104", 20261104].every((d) => { const e = refused(sumGood, { checkedAt: d }); return e && e.exit === 2; }) && refused(sumGood, { checkedAt: null }) === null && refused(sumGood, { checkedAt: undefined }) === null);
    // the CLI
    const sumFile = join(tmp("omnikom-audit-report-"), "summary.json");
    writeFileSync(sumFile, JSON.stringify(sumBadLive));
    const reportCli = (args) => { const r = spawnSync(process.execPath, [join(AUDIT, "report.mjs"), ...args], { encoding: "utf8", timeout: 60000, env: childEnv }); return { status: r.status, out: r.stdout || "", err: r.stderr || "" }; };
    const plain = reportCli([sumFile, "--checked-at", "2026-11-04"]), asJson = reportCli([sumFile, "--json", "--checked-at", "2026-11-04"]), noDate = reportCli([sumFile]);
    let parsed = null; try { parsed = JSON.parse(asJson.out); } catch {}
    check("report CLI: <summary.json> --checked-at prints the markdown of report() and exits 0 with nothing on stderr", plain.status === 0 && plain.err === "" && plain.out === report(sumBadLive, { checkedAt: "2026-11-04" }).md, plain.status + plain.err);
    check("report CLI: --json prints { md, facts } as one JSON object and exits 0; without --checked-at the text has no date", asJson.status === 0 && asJson.out.trim().split("\n").length === 1 && parsed && JSON.stringify(parsed) === JSON.stringify(report(sumBadLive, { checkedAt: "2026-11-04" })) && noDate.status === 0 && noDate.out === report(sumBadLive).md && !/20\d\d-\d\d-\d\d/.test(noDate.out), asJson.status + asJson.err);
    const writeBad = (name, text) => { const f = join(dirname(sumFile), name); writeFileSync(f, text); return f; };
    const oldSummary = (() => { const { byTopic, ...rest } = sumBadLive; return rest; })();
    const cliBad = [["no arguments", []], ["a missing file", [join(dirname(sumFile), "missing.json")]], ["a file that is not JSON", [writeBad("text.json", "not json")]], ["JSON that is not a summary", [writeBad("empty.json", "{}")]], ["a summary of another version", [writeBad("v2.json", JSON.stringify({ ...sumBadLive, v: 2 }))]], ["a summary with no byTopic (stored before work order 06)", [writeBad("old.json", JSON.stringify(oldSummary))]],
      ["a bad date", [sumFile, "--checked-at", "2026-02-30"]], ["a date in the wrong shape", [sumFile, "--checked-at", "4 Nov"]], ["--checked-at with no value", [sumFile, "--checked-at"]], ["an unknown option", [sumFile, "--pdf"]], ["two files", [sumFile, sumFile]]].map(([what, args]) => ({ what, r: reportCli(args) }));
    check(`report CLI: ${cliBad.length} wrong calls exit 2, print nothing on stdout and say why in one line on stderr`, cliBad.every((b) => b.r.status === 2 && b.r.out === "" && b.r.err.trim().split("\n").length === 1 && b.r.err.startsWith("report: ")), cliBad.filter((b) => !(b.r.status === 2 && b.r.out === "" && b.r.err.trim().split("\n").length === 1)).map((b) => `${b.what}: ${b.r.status} ${b.r.err.slice(0, 100)}`).join(" | "));
    check("report CLI: the usage line names --checked-at and --json", /--checked-at YYYY-MM-DD/.test(reportCli([]).err) && /--json/.test(reportCli([]).err));
    check("report CLI: the run.mjs --summary output of a fixture goes through the CLI to the same text as report()", (() => { const f = join(dirname(sumFile), "real.json"); const s = cli([badDir, "--target", "preview", "--summary"]); writeFileSync(f, s.out); const r = reportCli([f, "--checked-at", "2026-11-04"]); return s.status === 1 && r.status === 0 && r.out === reports["bad-MET-003 preview"].md; })());

    // work order 25: questions 2 to 5 from the skill's report.json (report(summary, { live }), report.mjs --live)
    const SKILL = process.env.OMNIKOM_SKILL_DIR ? resolve(process.env.OMNIKOM_SKILL_DIR) : resolve(HERE, "..", "..", "..", "skills", "programmatic-enterprise-web-performance");
    // the real one: report-live.mjs run on the skill's own fixtures in a temp folder of this run (the snapshot is the fixture site; targets.json and measure/ are the fixtures' own; no fixture holds
    // an authority.json or a competitors.json, so those two are written here in the shape authority.mjs and research.mjs write them: 4 winners, to see the cap of 3)
    const makeRealLive = () => {
      try {
        const host = "sample-valley-realty.test", root = tmp("pewp-live-"), base = join(root, "site-checks", host), sd = join(base, "snapshots", "2026-10-24"), pewp = join(base, ".pewp");
        const put = (p, o) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, typeof o === "string" ? o : JSON.stringify(o, null, 1)); };
        const site = join(SKILL, "fixtures", "site"), found = [];
        const walkSite = (d, rel = "") => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walkSite(p, rel + f + "/"); else if (f === "index.html") found.push(rel); } };
        walkSite(site);
        const pages = found.map((rel) => ({ url: `https://${host}/${rel}`, slug: rel.replace(/\/$/, "").replace(/\//g, "_") || "home", status: 200, rel }));
        put(join(sd, "_site.json"), { url: `https://${host}/`, finishedAt: "2026-10-24T10:00:00Z", runs: 1, stoppedEarly: null, machineLoad: null, pages: pages.map(({ rel, ...p }) => p) });
        put(join(sd, "site", "robots.json"), { status: 200, groups: [{ agents: ["*"], rules: [] }] });
        put(join(sd, "site", "sitemaps.json"), { urlCount: 3 });
        put(join(sd, "site", "probes.json"), { notFound: { finalStatus: 404 } });
        for (const p of pages) {
          put(join(sd, "pages", p.slug, "response.json"), { url: p.url, finalUrl: p.url, status: 200, headers: {} });
          writeFileSync(join(sd, "pages", p.slug, "raw.html.gz"), zlib.gzipSync(readFileSync(join(site, p.rel, "index.html"))));
        }
        cpSync(join(SKILL, "fixtures", "pewp"), pewp, { recursive: true });
        cpSync(join(SKILL, "fixtures", "measure", "2026-10-22"), join(pewp, "measure", "2026-10-22"), { recursive: true });
        put(join(pewp, "authority.json"), { fetchedAt: "2026-10-23T08:00:00Z", source: "Common Crawl web graph cc-main-fixture (domain level)", release: "fixture", target: host, linkGap: [{ domain: "a.test", linksToCompetitors: 2, harmonicPos: 5 }],
          results: [{ domain: host, role: "target", inGraph: true, harmonicPos: 900, linkingDomains: 14, strongestLinkingDomains: [] }, { domain: "example-competitor-one.test", role: "competitor", inGraph: true, harmonicPos: 400, linkingDomains: 120, strongestLinkingDomains: [] }, { domain: "example-competitor-two.test", role: "competitor", inGraph: false }] });
        put(join(pewp, "research", "competitors.json"), { generatedAt: "2026-10-21T09:00:00Z", sites: ["one", "two", "three", "four"].map((w, i) => ({ domain: `example-competitor-${w}.test`, status: 200, fetchedAt: "2026-10-21T09:00:00Z", page: { words: 900 + 100 * i, h2: Array.from({ length: 4 + i }, (_, k) => "h" + k) }, schema: { types: ["RealEstateAgent", "WebSite"].slice(0, 1 + (i % 2)), questions: i } })) });
        const r = spawnSync(process.execPath, [join(SKILL, "scripts", "report-live.mjs"), `https://${host}/`, "--cwd", root, "--snapshot", sd], { encoding: "utf8", timeout: 120000, env: { ...childEnv, NODE_OPTIONS: "", GSC_TOKEN_FILE: "", GSC_SERVICE_ACCOUNT_FILE: "", GSC_SERVICE_ACCOUNT_JSON_B64: "" } });
        return { status: r.status, err: String(r.stderr || "").slice(0, 300), live: JSON.parse(readFileSync(join(pewp, "report.json"), "utf8")) };
      } catch (e) { return { status: null, err: String(e.message).slice(0, 300), live: null }; }
    };
    const real = makeRealLive(), liveReal = real.live;
    // the synthetic one, in report-live.mjs's exact shape: Q2, Q4 and Q5 answered, Q3 BLOCKED (its texts carry file names and command lines, which the report never shows)
    const F = (value, extra = {}) => ({ value, source: "fixture source text", fetchedAt: "2026-10-22T09:00:00Z", cacheFile: ".pewp/fixture.json", ...extra });
    const blockedQ = (n, q) => ({ n, q, status: "BLOCKED", why: "Needs the research stage (`research.mjs`): who ranks now for each search, and their pages, to compare against.", needs: [{ id: "browser-capture", what: "the top 10 results per search", status: "needs-setup" }] });
    const liveSynth = {
      url: "https://x.test/", host: "x.test", writtenAt: "2026-11-09T04:00:00Z",
      questions: [
        { n: 1, q: "Can search engines and AI crawlers reach and read the site?", status: "answered", problems: [], facts: {} },
        { n: 2, q: "Is there a page for what people actually search?", status: "answered",
          facts: { clustersTotal: F(40, { fetchedAt: "2026-10-20T09:00:00Z" }), clustersWithPage: F(25), clustersMissingPage: F(15), pageNotInSnapshot: F(0), weakPages: F(0),
            cannibalisation: { status: "NOT CHECKED", why: "the gate has not run for this site", unblock: "node scripts/gate.mjs \".pewp\" \"snapshots/2026-10-24\"" } },
          missing: Array.from({ length: 12 }, (_, j) => ({ id: `c${j}`, search: `best agent ${j + 1} near me`, intent: "local", place: null, priority: F(4 + j), volume: F(100), closestPage: null })), weak: [], unverified: [] },
        blockedQ(3, "Is each page better than what ranks now?"),
        { n: 4, q: "Does the site have the authority to rank?", status: "answered",
          facts: { referringDomains: F(14, { fetchedAt: "2026-10-23T08:00:00Z" }), strengthRank: F(900, { fetchedAt: "2026-10-23T08:00:00Z" }),
            competitors: F(Array.from({ length: 7 }, (_, j) => ({ domain: `rival-${j}.test`, referringDomains: j === 3 ? 0 : 100 + 17 * j, strengthRank: j === 3 ? null : 10 + j })), { fetchedAt: "2026-10-23T08:00:00Z" }), linkGap: F(33, { fetchedAt: "2026-10-23T08:00:00Z" }) }, strongestLinkers: [], gapTop: [] },
        { n: 5, q: "Is it cited by AI engines? If not, who is, and why?", status: "answered",
          facts: { citedShare: F(0.666, { estimate: true, unit: "0 to 1", fetchedAt: "2026-10-22" }), answersChecked: F(30), questionsAsked: F(10), engines: F(["gemini", "chatgpt"]), rowsCitingUs: F(0),
            citedInstead: F(Array.from({ length: 8 }, (_, j) => ({ domain: `portal-${j}.test`, answers: j === 4 ? 1 : 9 - j, kind: "other" }))) }, why: [], blocked: [] },
        { n: 6, q: "What to fix, in order", status: "answered", fixes: [], plan: [] },
      ],
    };
    // the same with parts that have no value: null, missing, not a whole number; and one real zero
    const liveNulls = structuredClone(liveSynth);
    { const q = (k) => liveNulls.questions.find((x) => x.n === k).facts;
      delete q(2).clustersWithPage; q(2).weakPages.value = null; q(4).referringDomains.value = null; delete q(4).linkGap;
      q(5).citedShare.value = null; q(5).engines.value = null; q(5).questionsAsked.value = "ten"; q(5).answersChecked.value = 0; }
    // the same with sites the link graph does not hold (work order 27): the target and rival-1 are "not found in the link data" (null, inGraph false); rival-2 is in the graph (inGraph true);
    // rival-3 is a real zero with no inGraph key (an older report.json), which keeps today's behaviour
    const liveNotFound = structuredClone(liveSynth);
    { const f4 = liveNotFound.questions.find((x) => x.n === 4).facts, cs = f4.competitors.value;
      f4.referringDomains.value = null; f4.inGraph = F(false, { fetchedAt: "2026-10-23T08:00:00Z" }); f4.strengthRank.value = null;
      cs[1] = { domain: "rival-1.test", referringDomains: null, inGraph: false, strengthRank: null }; cs[2].inGraph = true; }
    const liveAllBlocked = { questions: [liveSynth.questions[0], ...[[2, "x"], [3, "x"], [4, "x"], [5, "x"]].map(([k, t]) => blockedQ(k, t)), liveSynth.questions[5]] };
    const liveInputs = [["the real report.json (report-live.mjs on the skill's fixtures) with bad-MET-003 (preview), dated", sumBadPreview, "2026-11-04", liveReal], ["the synthetic report.json (Q3 BLOCKED) with good, no date", sumGood, null, liveSynth],
      ["the synthetic report.json with parts that have no value, with 30 FAILs, dated", sumMany, "2026-11-04", liveNulls],
      ["the synthetic report.json with sites not found in the link data, with good, dated", sumGood, "2026-11-04", liveNotFound]];
    // THE SOURCE RULE over a report with live: every digit run outside the heading numbers, backtick spans and day facts is the value of a fact (and of a fact of its own card in 2 to 5),
    // every source reads back in summary, listRules() or live as exactly its value, every live fact carries fetchedAt and origin, every number and day fact is in the text
    const readBack = (summary, date, live, md, facts) => {
      const bad = [];
      const days = [...new Set(facts.filter((f) => typeof f.value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f.value)).map((f) => f.value))];
      const bare = (lines) => { let t = lines.join("\n").replace(/^## \d\. /gm, "## ").replace(/`[^`]*`/g, ""); for (const d of days) t = t.split(d).join(""); return t; };
      for (const d of days) if (!md.includes(d)) bad.push(`the day fact ${d} is not in the text`);
      const runs = bare(md.split("\n")).match(/\d+/g) || [];
      const values = new Set(facts.map((f) => String(f.value)));
      for (const r of new Set(runs)) if (!values.has(r)) bad.push(`the digits ${r} in the text are no fact`);
      for (const k of ["2", "3", "4", "5"]) {
        const own = new Set(facts.filter((f) => f.id.startsWith(`q${k}.`)).map((f) => String(f.value)));
        for (const r of new Set(bare(sections(md)[k] || []).match(/\d+/g) || [])) if (!own.has(r)) bad.push(`card ${k}: the digits ${r} are no fact of that card`);
      }
      for (const f of facts) {
        let got;
        try { got = resolveSource(f.source, summary, date, live); } catch (e) { bad.push(`${f.id}: ${e.message}`); continue; }
        if (got !== f.value) bad.push(`${f.id}: ${f.source} gives ${JSON.stringify(got)}, the fact says ${JSON.stringify(f.value)}`);
      }
      for (const f of facts) if (typeof f.value === "number" && !runs.includes(String(f.value))) bad.push(`${f.id}: the fact ${f.value} is not in the text`);
      const liveFacts = facts.filter((f) => /^q[2-5]\./.test(f.id));
      if (!liveFacts.length) bad.push("no live fact at all");
      for (const f of liveFacts) if (!("fetchedAt" in f && "origin" in f)) bad.push(`${f.id}: no fetchedAt or origin`);
      return bad;
    };
    const withLive = (summary, date, live) => report(summary, { ...(date ? { checkedAt: date } : {}), live });
    check("report --live: the skill's own fixtures run through report-live.mjs in a temp folder: exit 0 and questions 2, 3, 4 and 5 all answered (the real input of the tests below)",
      real.status === 0 && !!liveReal && [2, 3, 4, 5].every((k) => liveReal.questions.find((q) => q.n === k)?.status === "answered") && liveReal.questions.find((q) => q.n === 3).siteLevel.length === 5, `exit ${real.status}: ${real.err}`);
    for (const [name, summary, date, live] of liveInputs) {
      const r = live ? withLive(summary, date, live) : { md: "", facts: [] };
      check(`report --live: ${name}: the source rule holds over the whole report`, !!live && readBack(summary, date, live, r.md, r.facts).length === 0, live ? readBack(summary, date, live, r.md, r.facts).slice(0, 3).join(" | ") : "no input");
    }
    check("report --live: the source reader reads live (a nested value, a list length, the percentage rule, the day rule, a difference) and refuses a wrong index or a wrong path",
      (() => { const v = (s) => resolveSource(s, sumGood, null, liveSynth); return v("live.questions[3].facts.competitors.value[1].referringDomains") === 117 && v("live.questions[3].facts.competitors.value.length") === 7 && v("live.questions[4].facts.citedShare.value (x100, rounded)") === 67
        && v("live.questions[1].facts.clustersTotal.fetchedAt (day)") === "2026-10-20" && v("live.questions[1].facts.clustersMissingPage.value - 5") === 10 && v("live.questions[4].facts.engines.value[1]") === "chatgpt"
        && (() => { try { v("live.questions[9].facts.x.value"); return false; } catch { return true; } })() && (() => { try { v("live.questions[3].facts.competitors.value[7].domain"); return false; } catch { return true; } })() && (() => { try { resolveSource("live.questions[1]", sumGood, null); return false; } catch { return true; } })(); })());
    check("report --live: a wrong source and a number with no fact are seen by the check (it is not blind): a competitor read from entry 0, a dropped fact and a made-up number all come back as problems",
      (() => { const r = withLive(sumGood, null, liveSynth);
        const lie = r.facts.map((f) => (f.id === "q4.competitors.1.referringDomains" ? { ...f, source: f.source.replace("value[1]", "value[0]") } : f));
        const hole = r.facts.filter((f) => f.id !== "q4.linkGap");
        const lied = readBack(sumGood, null, liveSynth, r.md, lie), dropped = readBack(sumGood, null, liveSynth, r.md, hole), made = readBack(sumGood, null, liveSynth, r.md.replace("link to this site: 14", "link to this site: 15"), r.facts);
        return lied.some((p) => p.startsWith("q4.competitors.1.referringDomains")) && dropped.some((p) => /digits 33 /.test(p)) && made.some((p) => /digits 15 /.test(p)); })());
    // b: BLOCKED, and no live
    const plainGood = report(sumGood, { checkedAt: "2026-11-04" });
    check("report --live: a live report whose questions 2 to 5 are all BLOCKED prints exactly the report without live (text and facts), and so do live: null and live: undefined",
      (() => { const a = report(sumGood, { checkedAt: "2026-11-04", live: liveAllBlocked }); const again = (live) => { try { return report(sumGood, { checkedAt: "2026-11-04", live }); } catch { return null; } }; const b = again(null); const c = again(undefined);
        const s = JSON.stringify(plainGood); return JSON.stringify(a) === s && JSON.stringify(b) === s && JSON.stringify(c) === s; })());
    check("report --live: live: null and live: undefined do not throw (they are no live)",
      (() => { try { report(sumGood, { checkedAt: "2026-11-04", live: null }); report(sumGood, { checkedAt: "2026-11-04", live: undefined }); return true; } catch { return false; } })());
    check("report --live: a BLOCKED question 3 prints exactly the Not measured yet card of the report without live (no file name, no command line), while questions 2, 4 and 5 are answered and sections 1 and 6 do not change",
      (() => { const r = withLive(sumGood, "2026-11-04", liveSynth), a = sections(r.md), p = sections(plainGood.md);
        return JSON.stringify(a["3"]) === JSON.stringify(p["3"]) && a["3"].join("\n").includes("**Not measured yet.** ") && !r.md.includes("research.mjs") && !r.md.includes("gate.mjs") && !r.md.includes("browser-capture")
          && ["2", "4", "5"].every((k) => JSON.stringify(a[k]) !== JSON.stringify(p[k]) && !a[k].join("\n").includes("Not measured yet.")) && JSON.stringify(a["1"]) === JSON.stringify(p["1"]) && JSON.stringify(a["6"]) === JSON.stringify(p["6"]); })());
    check("report --live: each answered card ends with Measured <day> from <the plain name of the source>, the day being the oldest of the facts printed in it; a BLOCKED card has no Measured line",
      (() => { const a = sections(withLive(sumGood, null, liveSynth).md); const last = (k) => a[k].filter((l) => l.trim()).at(-1);
        return last("2") === "Measured 2026-10-20 from the research and a snapshot of the site." && last("4") === "Measured 2026-10-23 from the Common Crawl link graph." && last("5") === "Measured 2026-10-22 from AI engine answers." && !a["3"].join("\n").includes("Measured "); })());
    check("report --live: the lists are capped: 5 of 12 missing searches then and 10 more (15 need a page); 5 of 7 competitors then and 2 more; 5 of 8 cited domains then and 3 more; 3 winners of 4 per row and the line saying so",
      (() => { const a = sections(withLive(sumGood, null, liveSynth).md), t = sections(withLive(sumBadPreview, null, liveReal).md)["3"], sp = (l) => (l.match(/`[^`]*`/g) || []).length;
        const subs = (k, re) => a[k].filter((l) => re.test(l));
        return subs("2", /^ {2}- `best agent/).length === 5 && a["2"].includes("  - `best agent 1 near me`") && a["2"].includes("  - and 10 more") && subs("4", /^ {2}- `rival-/).length === 5 && a["4"].includes("  - and 2 more") && subs("5", /^ {2}- `portal-/).length === 5 && a["5"].includes("  - and 3 more")
          && t.filter((l) => l.startsWith("- ")).length === 5 && t.filter((l) => l.startsWith("- ")).every((l) => sp(l) === 3) && t.includes("Only the first three winning sites are shown."); })());
    check("report --live: a share is printed as a rounded percentage (0.666 is 67%, a fact 67 whose source ends (x100, rounded)), marked an estimate when the skill says so; 1 answer is singular; a competitor with 0 referring domains prints 0 as a fact",
      (() => { const r = withLive(sumGood, null, liveSynth), a = sections(r.md); const share = r.facts.find((f) => f.id === "q5.citedShare"), zero = r.facts.find((f) => f.id === "q4.competitors.3.referringDomains");
        return a["5"].includes("- Share of AI answers that cite this site: 67% (an estimate)") && share.value === 67 && share.source.endsWith("(x100, rounded)") && a["5"].includes("  - `portal-4.test`: 1 answer") && a["5"].includes("  - `portal-0.test`: 9 answers")
          && a["4"].includes("  - `rival-3.test`: 0") && zero.value === 0; })());
    // c2 (work order 27): a site the link graph does not hold is not found, which is not 0 and not "not measured yet"
    check("report --live: a target and a competitor the link data does not hold read 'not found in the link data' with no digit and no fact (never 0); a competitor in the link data, or with no inGraph key, keeps its number and its fact",
      (() => { const r = withLive(sumGood, null, liveNotFound), a = sections(r.md), ids = new Set(r.facts.map((f) => f.id)), NF = "not found in the link data";
        return a["4"].includes(`- Websites that link to this site: ${NF}`) && a["4"].includes(`  - \`rival-1.test\`: ${NF}`) && a["4"].filter((l) => l.includes(NF) && !l.includes("link to at least two competitors")).every((l) => !/\d/.test(l.replace(/`[^`]*`/g, "")))
          && !ids.has("q4.referringDomains") && !ids.has("q4.competitors.1.referringDomains") && a["4"].includes("  - `rival-2.test`: 134") && ids.has("q4.competitors.2.referringDomains") && a["4"].includes("  - `rival-3.test`: 0") && ids.has("q4.competitors.3.referringDomains")
          && !a["4"].some((l) => l.includes("not measured yet")); })());
    // work order 31: the gap line for a target the link data does not hold. The count of sites that link to two competitors stays a fact; "but not to this site" cannot be judged
    check("report --live: with the target not in the link data the gap line says the sites link to at least two competitors and that whether they link to this site cannot be judged (not found in the link data); the count stays a fact, and 'but not to this site' is not said",
      (() => { const r = withLive(sumGood, null, liveNotFound), a = sections(r.md), f = r.facts.find((x) => x.id === "q4.linkGap");
        return a["4"].includes("- Websites that link to at least two competitors: 33 (whether they already link to this site cannot be judged: the site is not found in the link data)") && f?.value === 33
          && !a["4"].some((l) => l.includes("but not to this site")); })());
    check("report --live: with inGraph true or absent the card is what it was: the count is printed, and 'not found in the link data' appears nowhere in the report",
      (() => { const md = withLive(sumGood, null, liveSynth).md, withTrue = structuredClone(liveSynth); withTrue.questions.find((x) => x.n === 4).facts.inGraph = F(true); const a = sections(withLive(sumGood, null, withTrue).md);
        return !md.includes("not found in the link data") && sections(md)["4"].includes("- Websites that link to this site: 14") && a["4"].includes("- Websites that link to this site: 14") && !a["4"].some((l) => l.includes("not found in the link data")); })());
    // c: a part with no value
    check("report --live: a part that is null, missing or not a whole number reads not measured yet with no digit and no fact (never 0), while a real zero is printed as 0 with its fact",
      (() => { const r = withLive(sumGood, null, liveNulls), a = sections(r.md), ids = new Set(r.facts.map((f) => f.id));
        const want = [["2", "- Searches that already have a page: not measured yet"], ["2", "- Pages that do not match their search: not measured yet"], ["4", "- Websites that link to this site: not measured yet"], ["4", "- Websites that link to at least two competitors but not to this site: not measured yet"],
          ["5", "- Share of AI answers that cite this site: not measured yet"], ["5", "- Different questions asked: not measured yet"], ["5", "- AI engines asked: not measured yet"], ["5", "- AI answers read: 0"]];
        const lines = ["2", "3", "4", "5"].flatMap((k) => a[k]).filter((l) => l.includes("not measured yet"));
        return want.every(([k, l]) => a[k].includes(l)) && lines.length >= 7 && lines.every((l) => !/\d/.test(l.replace(/`[^`]*`/g, "")))
          && ["q2.withPage", "q2.weakPages", "q4.referringDomains", "q4.linkGap", "q5.citedShare", "q5.questionsAsked", "q5.engines.0"].every((id) => !ids.has(id)) && r.facts.find((f) => f.id === "q5.answersChecked")?.value === 0; })());
    // d: the words
    for (const [name, summary, date, live] of liveInputs) {
      const md = live ? withLive(summary, date, live).md : "", outside = md.replace(/`[^`]*`/g, "");
      check(`report --live: ${name}: no rule id, file name, command line, jargon word, em dash, table or numbered list outside the backtick spans, and nothing of the BLOCKED texts`,
        md !== "" && !/[A-Z]{2,3}-\d{3}/.test(outside) && !/\.(mjs|json|md|html|txt|xml)\b/i.test(outside) && !/\bnode\b|\bnpm\b|\s--[a-z]/.test(outside) && !JARGON.test(outside) && !outside.includes(EM) && !/^\s*\|/m.test(md) && !/^\s*\d+\. /m.test(md.replace(/^## \d\. /gm, "## "))
        && !md.includes("research.mjs") && !md.includes("browser-capture"), (outside.match(/[A-Z]{2,3}-\d{3}|\.(mjs|json|md|html|txt|xml)\b|\bnode\b|canonical|sitemap|\bh2\b|robots/i) || [outside.includes(EM) ? "em dash" : "a table or list"])[0]);
    }
    // e: a live report that is not one, in the library and on the command line
    const badLives = ["text", 5, [], {}, { questions: "x" }, { questions: [] }, { questions: liveSynth.questions.filter((q) => q.n !== 4) }, { questions: [...liveSynth.questions, liveSynth.questions[1]] },
      { questions: liveSynth.questions.map((q) => (q.n === 5 ? { ...q, facts: undefined } : q)) }, { questions: liveSynth.questions.map((q) => (q.n === 2 ? { ...q, status: undefined } : q)) }, { questions: liveSynth.questions.map((q) => (q.n === 4 ? { ...q, facts: "no" } : q)) }];
    check(`report --live: ${badLives.length} things that are not a live report (not an object, no questions list, question 4 missing, question 2 twice, question 5 answered with no facts, no status) throw an AuditError with exit 2 and one line`,
      badLives.every((l) => { const e = refused(sumGood, { live: l }); return e && e.exit === 2 && e instanceof engine.AuditError && !e.message.includes("\n"); }), badLives.map((l) => { const e = refused(sumGood, { live: l }); return e ? e.exit : "no error"; }).join(","));
    const liveDir = tmp("omnikom-audit-live-"), liveFile = join(liveDir, "report.json"), blockedFile = join(liveDir, "blocked.json");
    writeFileSync(liveFile, JSON.stringify(liveReal)); writeFileSync(blockedFile, JSON.stringify(liveAllBlocked));
    const withFile = reportCli([sumFile, "--live", liveFile, "--checked-at", "2026-11-04"]), asJsonLive = reportCli([sumFile, "--live", liveFile, "--json", "--checked-at", "2026-11-04"]), blockedCli = reportCli([sumFile, "--live", blockedFile, "--checked-at", "2026-11-04"]);
    let parsedLive = null; try { parsedLive = JSON.parse(asJsonLive.out); } catch {}
    check("report CLI --live: <summary.json> --live <report.json> prints the markdown of report() with that live, exit 0, nothing on stderr; --json carries the live facts with fetchedAt and origin; all questions BLOCKED there prints the report without --live",
      withFile.status === 0 && withFile.err === "" && withFile.out === report(sumBadLive, { checkedAt: "2026-11-04", live: liveReal }).md && asJsonLive.status === 0 && parsedLive && JSON.stringify(parsedLive) === JSON.stringify(report(sumBadLive, { checkedAt: "2026-11-04", live: liveReal }))
      && parsedLive.facts.filter((f) => /^q[2-5]\./.test(f.id)).length > 20 && parsedLive.facts.filter((f) => /^q[2-5]\./.test(f.id)).every((f) => "fetchedAt" in f && "origin" in f) && blockedCli.status === 0 && blockedCli.out === plain.out, `${withFile.status} ${withFile.err}`);
    const liveBad = [["a missing live file", [sumFile, "--live", join(liveDir, "missing.json")]], ["a live file that is not JSON", [sumFile, "--live", writeBad("live-text.json", "not json")]], ["a live file that is an array", [sumFile, "--live", writeBad("live-array.json", "[]")]], ["a live file with no questions", [sumFile, "--live", writeBad("live-empty.json", "{}")]],
      ["a live file without question 4", [sumFile, "--live", writeBad("live-no4.json", JSON.stringify({ questions: liveSynth.questions.filter((q) => q.n !== 4) }))]], ["a live file whose answered question 5 has no facts", [sumFile, "--live", writeBad("live-nofacts.json", JSON.stringify({ questions: liveSynth.questions.map((q) => (q.n === 5 ? { ...q, facts: undefined } : q)) }))]],
      ["--live with no value", [sumFile, "--live"]], ["--live followed by another option", [sumFile, "--live", "--json"]], ["--live twice", [sumFile, "--live", liveFile, "--live", liveFile]]].map(([what, args]) => ({ what, r: reportCli(args) }));
    check(`report CLI --live: ${liveBad.length} wrong calls exit 2, print nothing on stdout and say why in one line on stderr`, liveBad.every((b) => b.r.status === 2 && b.r.out === "" && b.r.err.trim().split("\n").length === 1 && b.r.err.startsWith("report: ")),
      liveBad.filter((b) => !(b.r.status === 2 && b.r.out === "" && b.r.err.trim().split("\n").length === 1)).map((b) => `${b.what}: ${b.r.status} ${b.r.err.slice(0, 100)}`).join(" | "));
    check("report CLI --live: the usage line names --live", /\[--live <report\.json>\]/.test(reportCli([]).err));
  }

  // temp folders (slice 4b.1): every folder this run made is on disk inside its one root (read back from the root, not from the names kept in memory)
  const inRoot = readdirSync(ROOT);
  check("temp folders: the run has one root omnikom-audit-run-* and every temp folder it made is inside it", /^omnikom-audit-run-/.test(basename(ROOT)) && tmps.length > 0 && tmps.every((d) => inRoot.includes(basename(d)) && existsSync(d)), `root ${ROOT}; ${tmps.length} folders made; in the root: ${inRoot.length}`);
  // temp folders (slice 4b.1): a killed run leaves nothing behind. Run test/mutate.mjs as a child on one cheap mutant with a 2 s limit, so the
  // run inside it is killed and prints NOT RUN, with every temp variable pointed at a fresh empty folder; the folder must be empty afterwards.
  // OMNIKOM_AUDIT_NESTED=1 (set for that child, inherited by the runs inside it) skips this one check there, or it would start itself again.
  // It is not skipped on OMNIKOM_AUDIT_FAILFAST: a mutant of the temp-folder handling is caught only here.
  if (process.env.OMNIKOM_AUDIT_NESTED !== "1") {
    const probe = tmp("omnikom-audit-probe-");
    const r = spawnSync(process.execPath, [join(AUDIT, "test", "mutate.mjs")], { encoding: "utf8", timeout: 120000, env: { ...process.env, OMNIKOM_AUDIT_NESTED: "1", MUTATE_ONLY: "^design\\.mjs: every line of a text node is reported on its first line$", MUTATE_JOBS: "1", MUTATE_TIMEOUT_S: "2", OMNIKOM_AUDIT_TMP: probe, TMPDIR: probe, TEMP: probe, TMP: probe } });
    const left = readdirSync(probe);
    check("temp folders: a mutant run killed by its time limit prints NOT RUN and leaves no folder in the temp base", /^NOT RUN /m.test(r.stdout || "") && left.length === 0, `left behind: ${left.join(", ") || "(none)"}; exit ${r.status}; ${String(r.stdout || r.stderr).trim().split(/\r?\n/).slice(-3).join(" | ")}`);
  }
} finally {
  removeRoot();
}
void mkdirSync; void unlinkSync; void utimesSync;
console.log(failed ? `FAILED: ${failed} of ${total}` : `OK: ${total} of ${total} checks passed`);
process.exit(failed ? 1 : 0);
