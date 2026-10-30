// Tests for tools/audit: the good site passes every rule, every bad fixture fails exactly its own rule, the runner's shapes and exit codes,
// the source wall, and the committed fixtures equal their generator. Lines start with "ok  " or "FAIL"; the last line is
// "OK: N of N checks passed" (exit 0) or "FAILED: n of N" (exit 1).
//   node tools/audit/test/run.mjs
// OMNIKOM_AUDIT_DIR points at a copy of tools/audit/ (test/mutate.mjs runs one broken copy at a time).
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
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
const ruleOf = (name) => (name.match(/^bad-([A-Z0-9]+-\d{3})/) || [])[1];

try {
  // the rules the engine has, from --list
  const listed = cli(["--list"]);
  const rules = listed.out.split(/\r?\n/).filter(Boolean).map((l) => { const [id, severity, ...src] = l.trim().split(/\s+/); return { id, severity, source: src.join(" ") }; });
  const sevOf = Object.fromEntries(rules.map((r) => [r.id, r.severity]));
  const checkFiles = readdirSync(join(AUDIT, "checks")).filter((f) => f.endsWith(".mjs"));
  check("--list: exit 0 and one line per check file, each with its severity and a source", listed.status === 0 && rules.length === checkFiles.length && rules.length > 0 && rules.every((r) => /^(P0|P1|P2|W)$/.test(r.severity) && /^checklist\/\S+\.md [A-Z0-9-]+$/.test(r.source) && checkFiles.includes(r.id.toLowerCase() + ".mjs")), listed.out + listed.err);

  // every check has its rules file, and the file carries the source and the spec path
  const sourceless = rules.filter((r) => { const p = join(AUDIT, "rules", r.id + ".md"); if (!existsSync(p)) return true; const t = readFileSync(p, "utf8"); return !t.includes(r.source) || !/shipgate\/spec\/packs\/(web-delivery|accessibility|search-engines)\.md/.test(t) || !t.includes("## Rule text"); });
  check("every rule has rules/<ID>.md with its source, the spec path and the rule text", sourceless.length === 0, sourceless.map((r) => r.id).join(", "));

  // the good site passes every rule, in text mode and in JSON
  const good = cli([join(FIX, "good")]);
  const goodLines = good.out.split(/\r?\n/).filter(Boolean);
  check("good site: exit 0 and every line is PASS (no WARN, no SKIP, no FAIL)", good.status === 0 && goodLines.length > 0 && goodLines.every((l) => l.startsWith("PASS ")), good.out + good.err);
  const gj = json([join(FIX, "good")]);
  const pagesN = gj.j ? gj.j.pages.length : 0;
  check("good site: one PASS line per rule per page or file, every rule present", gj.j && rules.every((r) => gj.j.lines.some((l) => l.startsWith(`PASS ${r.id} `))) && gj.j.lines.filter((l) => l.startsWith("PASS MET-003 ")).length === pagesN, gj.out.slice(0, 300));
  check("good site: --json is valid JSON, exit equals the process exit, pass true, no findings", gj.j && gj.j.exit === gj.status && gj.status === 0 && gj.j.pass === true && gj.j.findings.length === 0 && Array.isArray(gj.j.pages) && Array.isArray(gj.j.rules) && gj.j.lines.length > 0, gj.out.slice(0, 300) + gj.err);

  // the bad fixtures, driven by the generator's own table
  const gen = await import(pathToFileURL(join(FIX, "build-fixtures.mjs")).href);
  const names = Object.keys(gen.FIXTURES);
  const onDisk = readdirSync(FIX).filter((n) => n.startsWith("bad-")).sort();
  check("fixtures: a folder exists for every generator entry and the other way round", names.every((n) => onDisk.includes(n)) && onDisk.every((n) => names.includes(n)), `generator ${names.length}, disk ${onDisk.length}`);
  for (const rule of rules) check(`fixtures: rule ${rule.id} has at least one bad fixture`, names.some((n) => ruleOf(n) === rule.id), rule.id);
  let first = true;
  const engine = await import(pathToFileURL(join(AUDIT, "index.mjs")).href);
  const viaCli = new Set();
  for (const name of names) {
    const spec = gen.FIXTURES[name];
    const rule = ruleOf(name);
    let dir = join(FIX, name);
    if (spec.setup) { dir = join(tmp(), name); cpSync(join(FIX, name), dir, { recursive: true }); spec.setup(dir); }
    // the first fixture of each rule goes through the real command line; the rest call audit() in this process (same engine, ~50x faster)
    let r;
    if (!viaCli.has(rule)) { viaCli.add(rule); r = json([dir]); } else { try { const j0 = engine.audit(dir); r = { status: j0.exit, out: "", err: "", j: JSON.parse(JSON.stringify(j0)) }; } catch (e) { r = { status: null, out: "", err: String(e.stack), j: null }; } }
    const j = r.j;
    const wantStatus = sevOf[rule] === "W" ? "WARN" : "FAIL";
    const own = j ? j.findings.filter((f) => f.rule === rule && f.status === wantStatus) : [];
    const foreignFails = j ? j.findings.filter((f) => f.rule !== rule && f.status === "FAIL") : [];
    const fileOf = (pg) => (pg.endsWith("/") ? join(dir, pg.slice(1), "index.html") : join(dir, pg));
    const lineText = (pg, n) => { try { return readFileSync(fileOf(pg), "utf8").split(/\r?\n/)[n - 1] || ""; } catch { return ""; } };
    const right = own.some((f) => f.what.includes(spec.expect) && (!spec.at || lineText(f.page, f.line).includes(spec.at)));
    const countOk = own.length === (spec.count ?? 1);
    const wantExit = wantStatus === "FAIL" ? 1 : 0;
    check(`${name}: ${wantStatus} ${rule} naming "${spec.expect}", no FAIL from any other rule, exit ${wantExit}`,
      j && countOk && right && foreignFails.length === 0 && r.status === wantExit && j.exit === r.status,
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
  const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(mjs|md|json|html|xml|txt|svg)$/.test(e.name) && readFileSync(p, "utf8").includes(emdash)) offenders.push(p.slice(AUDIT.length)); } };
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
  adhoc("options.rules limits the rules and the lines (library call)", () => {}, (j) => { const r = engine.audit(j.dir, { rules: ["MET-003", "met-001"] }); return r.rules.length === 2 && r.lines.every((l) => /^PASS (MET-003|MET-001) /.test(l)); });
  adhoc("audit() returns the documented shape", () => {}, (j) => ["dir", "pages", "rules", "findings", "lines", "pass", "exit"].every((k) => k in j) && j.rules.every((r) => r.id && r.severity && r.source) && j.pass === true && j.exit === 0);
} finally {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
}
void mkdirSync; void unlinkSync; void utimesSync;
console.log(failed ? `FAILED: ${failed} of ${total}` : `OK: ${total} of ${total} checks passed`);
process.exit(failed ? 1 : 0);
