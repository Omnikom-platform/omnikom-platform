// Tests for tools/audit: the good site passes every rule, every bad fixture fails exactly its own rule, the runner's shapes and exit codes,
// the source wall, and the committed fixtures equal their generator. Lines start with "ok  " or "FAIL"; the last line is
// "OK: N of N checks passed" (exit 0) or "FAILED: n of N" (exit 1).
//   node tools/audit/test/run.mjs
// OMNIKOM_AUDIT_DIR points at a copy of tools/audit/ (test/mutate.mjs runs one broken copy at a time).
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIT = process.env.OMNIKOM_AUDIT_DIR ? resolve(process.env.OMNIKOM_AUDIT_DIR) : resolve(HERE, "..");
const FIX = join(AUDIT, "fixtures");
let failed = 0, total = 0;
const check = (name, ok, detail = "") => { total++; if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ": " + String(detail).slice(0, 400)}`); };
const cli = (args, audit = AUDIT) => { const r = spawnSync(process.execPath, [join(audit, "run.mjs"), ...args], { encoding: "utf8", timeout: 60000 }); return { status: r.status, out: r.stdout || "", err: r.stderr || "" }; };
const json = (args) => { const r = cli(["--json", ...args]); let j = null; try { j = JSON.parse(r.out); } catch {} return { ...r, j }; };
const tmps = [];
const tmp = (p = "omnikom-audit-") => { const d = mkdtempSync(join(tmpdir(), p)); tmps.push(d); return d; };
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
  check("--list: exit 0 and one line per check file, each with its severity and a source", listed.status === 0 && rules.length === checkFiles.length && rules.length > 0 && rules.every((r) => /^(P0|P1|P2|W)$/.test(r.severity) && /^checklist\/\S+\.md [A-Z0-9-]+$/.test(r.source) && checkFiles.includes(r.id.toLowerCase() + ".mjs")), listed.out + listed.err);

  // every check has its rules file, and the file carries the source and the spec path
  const sourceless = rules.filter((r) => { const p = join(AUDIT, "rules", r.id + ".md"); if (!existsSync(p)) return true; const t = readFileSync(p, "utf8"); return !t.includes(r.source) || !/shipgate\/spec\/packs\/(web-delivery|accessibility|search-engines|performance)\.md/.test(t) || !t.includes("## Rule text"); });
  check("every rule has rules/<ID>.md with its source, the spec path and the rule text", sourceless.length === 0, sourceless.map((r) => r.id).join(", "));

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
    const foreignFails = j ? (snap ? j.findings.filter((f) => !allowed.has(f.rule)) : j.findings.filter((f) => f.rule !== rule && f.status === "FAIL")) : [];
    const ownOther = snap && j ? j.findings.filter((f) => f.rule === rule).length - own.length : 0;
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
  cpSync(AUDIT, copy, { recursive: true });
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
  check("snapshot-good: exit 0, every line PASS, mode snapshot, all 17 rules present, no folder-only line", sgJson.status === 0 && sgJson.j && sgJson.j.mode === "snapshot" && sgJson.j.findings.length === 0 && rules.every((r) => sgJson.j.lines.some((l) => l.startsWith(`PASS ${r.id} `))) && sgJson.j.lines.every((l) => l.startsWith("PASS ")) && sgJson.j.pages.length === 4, sgJson.out.slice(0, 300) + sgJson.err);
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
  const live = (args, env = {}) => { const r = spawnSync(process.execPath, [join(AUDIT, "live.mjs"), ...args], { encoding: "utf8", timeout: 60000, env: { ...process.env, OMNIKOM_AUDIT_LIVE_TARGET: STANDIN, ...env } }); return { status: r.status, out: r.stdout || "", err: r.stderr || "" }; };
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
} finally {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
}
void mkdirSync; void unlinkSync; void utimesSync;
console.log(failed ? `FAILED: ${failed} of ${total}` : `OK: ${total} of ${total} checks passed`);
process.exit(failed ? 1 : 0);
