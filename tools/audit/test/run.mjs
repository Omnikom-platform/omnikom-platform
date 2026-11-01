// Tests for tools/audit: the good site passes every rule, every bad fixture fails exactly its own rule, the runner's shapes and exit codes,
// the source wall, and the committed fixtures equal their generator. Lines start with "ok  " or "FAIL"; the last line is
// "OK: N of N checks passed" (exit 0) or "FAILED: n of N" (exit 1).
//   node tools/audit/test/run.mjs
// OMNIKOM_AUDIT_DIR points at a copy of tools/audit/ (test/mutate.mjs runs one broken copy at a time).
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync, utimesSync } from "node:fs";
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
const cli = (args, audit = AUDIT) => { const r = spawnSync(process.execPath, [join(audit, "run.mjs"), ...args], { encoding: "utf8", timeout: 60000, env: childEnv }); return { status: r.status, out: r.stdout || "", err: r.stderr || "" }; };
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

try {
  // the rules the engine has, from --list
  const listed = cli(["--list"]);
  const rules = listed.out.split(/\r?\n/).filter(Boolean).map((l) => { const [id, severity, ...src] = l.trim().split(/\s+/); return { id, severity, source: src.join(" ") }; });
  const sevOf = Object.fromEntries(rules.map((r) => [r.id, r.severity]));
  const checkFiles = readdirSync(join(AUDIT, "checks")).filter((f) => f.endsWith(".mjs"));
  // a source is either a shipgate checklist line (checklist/<file>.md <ID>) or, for the DSN family, DECISIONS 37 with its origin credit (slice 4b)
  // the source of each DSN rule: the line(s) of the unslop copy in skills/unslop/ that the head named, then DECISIONS 37 and the credit
  const SGN = "skills/unslop/references/signs.md", SKM = "skills/unslop/SKILL.md", TAIL = "; planning/DECISIONS.md 37 (owner, 2026-10-31); unslop by Damir Sokolovsky, CC BY 4.0";
  const DSN_SOURCES = { "DSN-001": `${SGN}:85-86 and ${SKM}:170-171`, "DSN-002": `${SGN}:7-8 and ${SKM}:89`, "DSN-003": `${SGN}:27`, "DSN-004": `${SGN}:19`, "DSN-005": `${SGN}:47 and ${SKM}:110`, "DSN-006": `${SGN}:44 and ${SKM}:105`, "DSN-007": `${SGN}:43 and ${SKM}:106`, "DSN-008": `${SGN}:54 and ${SKM}:113`, "DSN-009": `${SGN}:71 and ${SKM}:111`, "DSN-010": `${SKM}:118`, "DSN-011": `${SGN}:22 and ${SKM}:121` };
  const sourceOk = (r) => (r.id.startsWith("DSN-") ? r.source === DSN_SOURCES[r.id] + TAIL : /^checklist\/\S+\.md [A-Z0-9-]+$/.test(r.source));
  check("--list: exit 0 and one line per check file, each with its severity and a source", listed.status === 0 && rules.length === checkFiles.length && rules.length > 0 && rules.every((r) => /^(P0|P1|P2|W)$/.test(r.severity) && sourceOk(r) && checkFiles.includes(r.id.toLowerCase() + ".mjs")), listed.out + listed.err);
  check("--list: 28 rules, the 11 DSN rules among them, each P1 with the DECISIONS 37 source and the unslop credit", rules.length === 28 && rules.filter((r) => r.id.startsWith("DSN-")).length === 11 && Array.from({ length: 11 }, (_, i) => "DSN-" + String(i + 1).padStart(3, "0")).every((id) => rules.some((r) => r.id === id && r.severity === "P1" && r.source === DSN_SOURCES[id] + TAIL)), listed.out);

  // every check has its rules file, and the file carries the source and the spec path (a DSN rule: DECISIONS 37 and the unslop credit)
  const sourceless = rules.filter((r) => { const p = join(AUDIT, "rules", r.id + ".md"); if (!existsSync(p)) return true; const t = readFileSync(p, "utf8"); const specOk = r.id.startsWith("DSN-") ? t.includes("skills/unslop/") && t.includes("CC BY 4.0") && t.includes("Damir Sokolovsky") : /shipgate\/spec\/packs\/(web-delivery|accessibility|search-engines|performance)\.md/.test(t); return !t.includes(r.source) || !specOk || !t.includes("## Rule text") || !t.includes("## Judged here") || !t.includes("## Not judged here"); });
  check("every rule has rules/<ID>.md with its source, the spec path (a DSN rule: the unslop credit) and the rule text", sourceless.length === 0, sourceless.map((r) => r.id).join(", "));

  // the good site passes every rule, in text mode and in JSON
  const good = cli([join(FIX, "good")]);
  const goodLines = good.out.split(/\r?\n/).filter(Boolean);
  check("good site: exit 0 and every line is PASS (no WARN, no SKIP, no FAIL)", good.status === 0 && goodLines.length > 0 && goodLines.every((l) => l.startsWith("PASS ")), good.out + good.err);
  const gj = json([join(FIX, "good")]);
  const pagesN = gj.j ? gj.j.pages.length : 0;
  check("good site: one PASS line per rule per page or file, every rule present", gj.j && rules.filter((r) => !SNAPSHOT_ONLY.has(r.id)).every((r) => gj.j.lines.some((l) => l.startsWith(`PASS ${r.id} `))) && !gj.j.lines.some((l) => /^\w+ PRF-/.test(l)) && gj.j.lines.filter((l) => l.startsWith("PASS MET-003 ")).length === pagesN, gj.out.slice(0, 300));
  check("good site: --json is valid JSON, exit equals the process exit, pass true, no findings", gj.j && gj.j.exit === gj.status && gj.status === 0 && gj.j.pass === true && gj.j.findings.length === 0 && Array.isArray(gj.j.pages) && Array.isArray(gj.j.rules) && gj.j.lines.length > 0, gj.out.slice(0, 300) + gj.err);

  // the bad fixtures, driven by the generator's own table
  const gen = await import(pathToFileURL(join(FIX, "build-fixtures.mjs")).href);
  const ALL = { ...gen.FIXTURES, ...gen.SNAPSHOT_FIXTURES };
  const names = Object.keys(ALL);
  const onDisk = readdirSync(FIX).filter((n) => n.startsWith("bad-") || n.startsWith("snapshot-bad-")).sort();
  const siteLib = await import(pathToFileURL(join(AUDIT, "lib", "site.mjs")).href);
  check("fixtures: a folder exists for every generator entry and the other way round", names.every((n) => onDisk.includes(n)) && onDisk.every((n) => names.includes(n)), `generator ${names.length}, disk ${onDisk.length}`);
  for (const rule of rules) check(`fixtures: rule ${rule.id} has at least one bad fixture`, names.some((n) => ruleOf(n) === rule.id), rule.id);
  let first = true;
  const engine = await import(pathToFileURL(join(AUDIT, "index.mjs")).href);
  const viaCli = new Set();
  for (const name of names) {
    const spec = ALL[name];
    // a fixture that carries several rules' tells (bad-DSN) lists every expected rule and its status; the check is exact in both directions:
    // each listed rule shows its status, no other rule shows anything, the exit is 1 (it is never a way to loosen a one-rule fixture)
    if (spec.multi) {
      const mr = engine.audit(join(FIX, name));
      const want = Object.entries(spec.multi);
      const missing = want.filter(([id, st]) => !mr.findings.some((f) => f.rule === id && f.status === st)).map(([id, st]) => `${id} ${st}`);
      const stray = mr.findings.filter((f) => !(f.rule in spec.multi) || f.status === "SKIP").map((f) => `${f.rule} ${f.status} ${f.page}:${f.line}`);
      const wrongStatus = mr.findings.filter((f) => f.rule in spec.multi && f.status !== spec.multi[f.rule]).map((f) => `${f.rule} ${f.status}`);
      const cl = cli([join(FIX, name)]);
      const shown = cl.out.split(/\r?\n/).filter((l) => /^(FAIL|WARN) /.test(l)).map((l) => l.split(" ")[1]);
      check(`${name}: names all ${want.length} rules (${want.map(([id]) => id.slice(4)).join(",")}) with FAIL or WARN lines as listed, nothing else, exit 1`, missing.length === 0 && stray.length === 0 && wrongStatus.length === 0 && mr.exit === 1 && cl.status === 1 && want.every(([id]) => shown.includes(id)) && cl.out.split(/\r?\n/).filter((l) => /^(FAIL|WARN) /.test(l)).every((l) => FAIL_SHAPE.test(l.replace(/^WARN /, "FAIL "))), `missing ${missing.join(", ")}; stray ${stray.join(" | ")}; wrong ${wrongStatus.join(", ")}; exit ${mr.exit}/${cl.status}`);
      continue;
    }
    const rule = ruleOf(name);
    const snap = name.startsWith("snapshot-");
    let dir = join(FIX, name);
    if (spec.setup) { dir = join(tmp(), name); cpSync(join(FIX, name), dir, { recursive: true }); spec.setup(dir); }
    // the first fixture of each rule goes through the real command line; the rest call audit() in this process (same engine, ~50x faster)
    let r;
    if (!viaCli.has(rule)) { viaCli.add(rule); r = json([dir]); } else { try { const j0 = engine.audit(dir); r = { status: j0.exit, out: "", err: "", j: JSON.parse(JSON.stringify(j0)) }; } catch (e) { r = { status: null, out: "", err: String(e.stack), j: null }; } }
    const j = r.j;
    // status: the status of the rule's own finding (FAIL, WARN, SKIP, or PASS = none); also: rules whose findings are expected too
    // (one fact breaks two rules). A snapshot fixture must give exactly its rule's finding and nothing else, of any status.
    const wantStatus = spec.status || (sevOf[rule] === "W" ? "WARN" : "FAIL");
    const own = j ? j.findings.filter((f) => f.rule === rule && f.status === wantStatus) : [];
    const allowed = new Set([rule, ...(spec.also || [])]);
    // the DSN fixtures are held to the strict form (no finding of any status from another rule), in folder mode as well
    const strict = snap || /^DSN-/.test(rule);
    const foreignFails = j ? (strict ? j.findings.filter((f) => !allowed.has(f.rule)) : j.findings.filter((f) => f.rule !== rule && f.status === "FAIL")) : [];
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
      j && countOk && right && foreignFails.length === 0 && ownOther === 0 && r.status === wantExit && j.exit === r.status,
      j ? `own ${own.map((f) => f.what).join(" | ")}; foreign ${foreignFails.map((f) => f.rule + " " + f.page + ":" + f.line + " " + f.what).join(" | ")}; exit ${r.status}` : r.out + r.err);
    if (j) {
      const failLines = j.lines.filter((l) => l.startsWith("FAIL "));
      check(`${name}: every FAIL line is "FAIL <rule> <page>:<line> <what> (source: <checklist file>)"`, failLines.every((l) => FAIL_SHAPE.test(l)) && (wantStatus !== "FAIL" || failLines.length > 0), failLines.filter((l) => !FAIL_SHAPE.test(l)).join(" | "));
    }
    if (first && wantStatus === "FAIL") { // text mode prints the same lines as --json, and exits 1
      first = false;
      const t = cli([dir]);
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
  check("snapshot-good: exit 0, every line PASS, mode snapshot, all 28 rules present, no folder-only line", sgJson.status === 0 && sgJson.j && sgJson.j.mode === "snapshot" && sgJson.j.findings.length === 0 && rules.every((r) => sgJson.j.lines.some((l) => l.startsWith(`PASS ${r.id} `))) && sgJson.j.lines.every((l) => l.startsWith("PASS ")) && sgJson.j.pages.length === 4, sgJson.out.slice(0, 300) + sgJson.err);
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
  check("--psi with a missing file exits 2, and --psi with no value exits 2", cli([psiBad, "--psi", join(psiBad, "none.json")]).status === 2 && cli([psiBad, "--psi"]).status === 2);
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
  snapAdhoc("a 404 record is not a judged page: no MET, A11, SCH or URL rule runs on it, and it is not indexable", seq(addRec("gone", SO + "/gone/", SO + "/gone/", 404, [{ url: SO + "/gone/", status: 404 }], blank), linkTo("/gone/")), (j) => !j.pages.includes("/gone/") && j.findings.every((f) => f.rule === "LNK-002"));
  snapAdhoc("IDX-001 (snapshot): a sitemap URL whose crawl record is 404 is a status-mismatch FAIL", seq(addRec("gone", SO + "/gone/", SO + "/gone/", 404, [{ url: SO + "/gone/", status: 404 }], blank), (d) => { const p = join(d, "site", "sitemap-1.xml"); writeFileSync(p, readFileSync(p, "utf8").replace("</urlset>", `  <url>\n    <loc>${SO}/gone/</loc>\n    <lastmod>2026-10-05T09:00:00Z</lastmod>\n  </url>\n</urlset>`)); }), (j) => ownOf(j, "IDX-001", "FAIL").length === 1 && ownOf(j, "IDX-001", "FAIL")[0].what.startsWith("status-mismatch"));
  snapAdhoc("a gzipped sitemap (site/sitemap-1.xml.gz) is read: every rule still passes", (d) => { const p = join(d, "site", "sitemap-1.xml"); writeFileSync(p + ".gz", zlib.gzipSync(readFileSync(p))); unlinkSync(p); jedit("site/sitemaps.json", (m) => { m.fetched[0].file = "site/sitemap-1.xml.gz"; })(d); }, (j) => j.findings.length === 0 && j.lines.includes("PASS IDX-001 site/sitemap-1.xml.gz"));
  snapAdhoc("the site origin is the home page's final url, not _site.json.url", jedit("_site.json", (m) => { m.url = "https://elsewhere.invalid"; }), (j) => j.findings.length === 0);

  snapAdhoc("URL-009 (snapshot): a home canonical on another origin than the one the page was fetched from is named", gzSub("home", `<link rel="canonical" href="${SO}/">`, `<link rel="canonical" href="https://www.example-tea.invalid/">`), (j) => ownOf(j, "URL-009", "FAIL").some((f) => f.page === "/" && f.what.includes("is not the origin")));
  // the live driver, through the stand-in for live-target.mjs (no request is made)
  const STANDIN = join(FIX, "live-target-standin.mjs");
  const live = (args, env = {}) => { const r = spawnSync(process.execPath, [join(AUDIT, "live.mjs"), ...args], { encoding: "utf8", timeout: 60000, env: { ...childEnv, OMNIKOM_AUDIT_LIVE_TARGET: STANDIN, ...env } }); return { status: r.status, out: r.stdout || "", err: r.stderr || "" }; };
  const direct = cli([SG]);
  const lv = live(["https://example-tea.invalid/"]);
  check("live.mjs with the stand-in prints exactly the lines run.mjs prints on snapshot-good and exits the same (0)", lv.status === 0 && direct.status === 0 && lv.out === direct.out && lv.out.split(/\r?\n/).filter(Boolean).every((l) => l.startsWith("PASS ")) && lv.out.length > 0, lv.out.slice(0, 200) + lv.err);
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
  adhoc("DSN styles: an unreadable or missing stylesheet link, a link without a href, and a stylesheet in a subfolder resolve without a crash", both(putDir("css/sub/b.css", "p { text-transform: uppercase; letter-spacing: 1px }\n"), headIns('<link rel="stylesheet" href="css/sub/b.css">\n<link rel="stylesheet">\n<link rel="stylesheet" href="/nope.css">\n<link rel="icon" href="/img/leaf.svg">')), (j) => onlyOf(j, "DSN-004").length > 0 && j.findings.every((f) => f.rule === "DSN-004"));
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
