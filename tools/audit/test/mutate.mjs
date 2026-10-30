// Watched-fail for tools/audit: a broken COPY of tools/audit with ONE rule or wall removed, test/run.mjs run against it
// (OMNIKOM_AUDIT_DIR), the suite must go red on a named check. Pattern of tools/departments/test/mutate.mjs:
// [name, file, exactText, replacement], applied with split/join to a temp copy, one child process per mutant, 180 s timeout.
// Caught = the suite exited nonzero AND printed at least one "FAIL" line. A crash or a timeout with no FAIL line is NOT a catch
// (it would hide a broken test), and target text that is not found exactly once is counted as "target text missing".
//   node tools/audit/test/mutate.mjs      exit 0 = every mutant caught, none missing
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const AUDIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MUTANTS = [
  // the engine and the runner
  ["the exit code is always 0", "index.mjs", "exit: pass ? 0 : 1", "exit: 0"],
  ["a FAIL line carries no source", "index.mjs", "(source: ${c.source})`);\n      }", "`);\n      }"],
  ["a check is admitted without its rules file", "index.mjs", "if (!fs.existsSync(rulesFile) || !fs.readFileSync(rulesFile, \"utf8\").includes(mod.id)) throw", "if (false) throw"],
  ["--only does not limit the rules", "index.mjs", "selected = CHECKS.filter((c) => want.includes(c.id));", "selected = CHECKS;"],
  ["an unknown --only id is accepted", "index.mjs", "if (unknown.length) throw", "if (false) throw"],
  ["the length numbers are not checked (WCF-004)", "index.mjs", "|| !(warnMin < warnMax && warnMax <= hardMax)) throw", "|| false) throw"],
  ["a missing folder is not an error", "index.mjs", "if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw", "if (false) throw"],
  ["a rule with nothing to report prints no PASS line", "index.mjs", "if (!here.length) { lines.push(`PASS ${c.id} ${subject}`); continue; }", "if (!here.length) { continue; }"],
  // MET-003
  ["MET-003: a missing <main> passes", "checks/met-003.mjs", "if (p.mains.length === 0) out.push(", "if (false) out.push("],
  ["MET-003: a second <main> passes", "checks/met-003.mjs", "if (p.mains.length > 1) out.push(", "if (false) out.push("],
  ["MET-003: a missing <h1> passes", "checks/met-003.mjs", "if (h1s.length === 0) out.push(", "if (false) out.push("],
  ["MET-003: a second <h1> passes", "checks/met-003.mjs", "if (h1s.length > 1) out.push(", "if (false) out.push("],
  ["MET-003: a skipped heading level passes", "checks/met-003.mjs", "if (prev && h.level > prev.level + 1) out.push(", "if (false) out.push("],
  // more engine, reader and runner walls
  ["a WARN fails the run", "index.mjs", 'const pass = !findings.some((f) => f.status === "FAIL");', 'const pass = !findings.some((f) => f.status !== "PASS");'],
  ["audit.config.json in the folder is ignored", "index.mjs", "...(file[k] || {}), ", ""],
  ["options.config is ignored", "index.mjs", "...((override && override[k]) || {})", ""],
  ["run.mjs: --json also prints the lines", "run.mjs", "if (json) console.log(JSON.stringify(r, null, 2));", "if (json) { console.log(JSON.stringify(r, null, 2)); console.log(r.lines.join(\"\\n\")); }"],
  ["run.mjs: the exit code is always 0", "run.mjs", "process.exit(r.exit);", "process.exit(0);"],
  ["run.mjs: no folder is not a usage error", "run.mjs", "if (!folder) die(USAGE);", ""],
  ["lines.mjs: line numbers start at 0", "lib/lines.mjs", "let n = 1;\n  const end", "let n = 0;\n  const end"],
  ["site.mjs: the tokenizer never counts a newline", "lib/site.mjs", "if (html.charCodeAt(ptr++) === 10) ln++;", "ptr++;"],
  ["site.mjs: an <svg> is not stripped (its <title> counts)", "lib/site.mjs", "<(style|noscript|template|svg)\\b", "<(style|noscript|template)\\b"],
  ["context.mjs: a noindex page counts as indexable", "lib/context.mjs", "site.indexable = (p) => p.status === 200 && !p.noindex;", "site.indexable = (p) => p.status === 200;"],
  // MET-001
  ["MET-001: a missing title passes", "checks/met-001.mjs", "if (heads.length === 0) {", "if (false) {"],
  ["MET-001: a second title passes", "checks/met-001.mjs", "if (heads.length > 1) out.push(", "if (false) out.push("],
  ["MET-001: an empty title passes", "checks/met-001.mjs", "if (!t.text) {", "if (false) {"],
  ["MET-001: a title over hardMax passes", "checks/met-001.mjs", "if (len > cfg.hardMax) out.push(", "if (false) out.push("],
  ["MET-001: a duplicate title passes", "checks/met-001.mjs", "if (seen.has(key)) out.push(", "if (false) out.push("],
  ["MET-001: titles are compared across locales", "checks/met-001.mjs", 'const key = fold(p.lang) + "|" + fold(t.text);', "const key = fold(t.text);"],
  // MET-002
  ["MET-002: a missing description passes", "checks/met-002.mjs", "if (heads.length === 0) {", "if (false) {"],
  ["MET-002: an empty description passes", "checks/met-002.mjs", "if (!d.text) {", "if (false) {"],
  ["MET-002: a description over hardMax passes", "checks/met-002.mjs", "if (len > cfg.hardMax) out.push(", "if (false) out.push("],
  ["MET-002: a duplicate description passes", "checks/met-002.mjs", "if (seen.has(key)) out.push(", "if (false) out.push("],
  // MET-004
  ["MET-004: a title outside the range is not warned", "checks/met-004.mjs", "if (len < t.warnMin || len > t.warnMax) out.push(", "if (false) out.push("],
  ["MET-004: a description outside the range is not warned", "checks/met-004.mjs", "if (len < d.warnMin || len > d.warnMax) out.push(", "if (false) out.push("],
  ["MET-004: a title warning becomes a FAIL", "checks/met-004.mjs", "out.push(f.warn(p.path, title.line,", "out.push(f.fail(p.path, title.line,"],
  // SE-202
  ["SE-202: a short title passes", "checks/se-202.mjs", "if (len < minTitle) out.push(", "if (false) out.push("],
  ["SE-202: a short description passes", "checks/se-202.mjs", "if (len < minDesc) out.push(", "if (false) out.push("],
  ["SE-202: Japanese pages get the English minimums", "checks/se-202.mjs", "const minTitle = cjk ? 10 : 20, minDesc = cjk ? 25 : 50;", "const minTitle = 20, minDesc = 50;"],
  ["SE-202: the Japanese title minimum is 0", "checks/se-202.mjs", "const minTitle = cjk ? 10 : 20,", "const minTitle = cjk ? 0 : 20,"],
  // URL-009
  ["URL-009: a missing canonical passes", "checks/url-009.mjs", 'out.push(f.fail(p.path, headLine(p), "missing-element: the page has no canonical link")); continue; }', "continue; }"],
  ["URL-009: a relative or http canonical passes", "checks/url-009.mjs", "if (!u) {", 'if (!u) { u = new URL(canon, "https://x.invalid" + p.path); } if (false) {'],
  ["URL-009: a canonical path that is not the page's own passes", "checks/url-009.mjs", "if (normPath(u.pathname) !== p.path) out.push(", "if (false) out.push("],
  ["URL-009: an og:url that differs passes", "checks/url-009.mjs", "if (og.content.trim() !== canon) out.push(", "if (false) out.push("],
  ["URL-009: an hreflang that differs passes", "checks/url-009.mjs", "if (want && h.href.trim() !== want) out.push(", "if (false) out.push("],
  ["URL-009: an hreflang to another page is compared with this page's canonical", "checks/url-009.mjs", "const want = target === p ? canon : site.canonicalOf(target);", "const want = canon;"],
  ["URL-009: a WebPage.url that differs passes", "checks/url-009.mjs", "&& n.url !== canon) out.push(", "&& false) out.push("],
  ["URL-009: noindex pages are judged too", "checks/url-009.mjs", "if (!site.indexable(p)) continue;", ""],
  // SCH-001
  ["SCH-001: a page with no ld+json block passes", "checks/sch-001.mjs", `out.push(f.fail(p.path, headLine(p), 'missing-element: the page has no <script type="application/ld+json">')); continue; }`, "continue; }"],
  ["SCH-001: a second block passes", "checks/sch-001.mjs", "if (blocks.length > 1) out.push(", "if (false) out.push("],
  ["SCH-001: a parse error passes", "checks/sch-001.mjs", "if (b.error) {", "if (false) {"],
  ["SCH-001: a block with no @graph passes", "checks/sch-001.mjs", 'if (!b.parsed || typeof b.parsed !== "object" || !Array.isArray(b.parsed["@graph"])) {', "if (false) {"],
  ["SCH-001: any node counts as the WebPage", "checks/sch-001.mjs", "const wp = nodes.find((n) => typesOf(n).some((t) => WEBPAGE_TYPES.has(t)));", 'const wp = nodes[0] || { "@id": "x" };'],
  ["SCH-001: a WebPage @id that is not {canonical}#webpage passes", "checks/sch-001.mjs", 'else if (canon && wp["@id"] !== canon + "#webpage") out.push(', "else if (false) out.push("],
  ["SCH-001: a missing WebSite passes", "checks/sch-001.mjs", "if (!hasSite) out.push(", "if (false) out.push("],
  ["SCH-001: a home page with no Organization node passes", "checks/sch-001.mjs", 'if (!org || typesOf(org).length === 0 || typeof org.name !== "string") out.push(', "if (false) out.push("],
  ["SCH-001: an unresolved @id reference passes", "checks/sch-001.mjs", "if (defined.has(x.id) || (shared && homeIds.has(x.id))) continue;", "continue;"],
  ["SCH-001: a shared id resolves without the home block", "checks/sch-001.mjs", "|| (shared && homeIds.has(x.id))) continue;", "|| shared) continue;"],
  // LNK-002
  ["LNK-002: a nofollow internal link passes", "checks/lnk-002.mjs", "if (/\\bnofollow\\b/i.test(l.rel)) out.push(", "if (false) out.push("],
  ["LNK-002: a link to a missing file passes", "checks/lnk-002.mjs", "if (!site.has(r.path)) out.push(", "if (false) out.push("],
  ["LNK-002: a link to a missing page passes", "checks/lnk-002.mjs", "if (!target) { out.push(", "if (!target) { void ("],
  ["LNK-002: a link to a non-canonical form passes", "checks/lnk-002.mjs", "if (r.pathname.toLowerCase() !== target.path) out.push(", "if (false) out.push("],
  ["LNK-002: a link to a file is looked up as a page", "checks/lnk-002.mjs", 'if (r.kind === "file") {', "if (false) {"],
  // A11-007
  ["A11-007: an <img> with no alt passes", "checks/a11-007.mjs", "if (!hasAlt) {", "if (false) {"],
  ["A11-007: an image button or area with no alt passes", "checks/a11-007.mjs", "} else if (!hasAlt && !named) {", "} else if (false) {"],
  ["A11-007: alt=\"\" is not decorative", "checks/a11-007.mjs", 'if (a.alt === "") continue;', ""],
  ["A11-007: role=presentation is not decorative", "checks/a11-007.mjs", 'if (/^(presentation|none)$/i.test(a.role || "")) continue;', ""],
  ["A11-007: a file name as alt passes", "checks/a11-007.mjs", "if (FILENAME.test(t)) out.push(", "if (false) out.push("],
  ["A11-007: an alt equal to the src passes", "checks/a11-007.mjs", "else if (src && srcForms(src).includes(t.toLowerCase())) out.push(", "else if (false) out.push("],
  ["A11-007: a generic word as alt passes", "checks/a11-007.mjs", "else if (GENERIC.has(t.toLowerCase())) out.push(", "else if (false) out.push("],
  ["A11-007: a blank alt passes", "checks/a11-007.mjs", "if (!t) { if (!named) out.push(", "if (!t) { if (false) out.push("],
  ["A11-007: aria-label does not name an area", "checks/a11-007.mjs", "const named = !!(", "const named = false && !!("],
  // IDX-004
  ["IDX-004: a missing robots.txt passes", "checks/idx-004.mjs", 'if (!site.has("robots.txt")) return [', 'if (!site.has("robots.txt")) return []; if (false) return ['],
  ["IDX-004: a robots.txt with no Sitemap line passes", "checks/idx-004.mjs", "if (sitemaps.length === 0) out.push(", "if (sitemaps.length === 0) void ("],
  ["IDX-004: a Sitemap line to another file passes", "checks/idx-004.mjs", "if (!paths.includes(rootPath)) out.push(", "if (false) out.push("],
  ["IDX-004: a Disallow on a page or sitemap passes", "checks/idx-004.mjs", "if (w && !w.allow) out.push(", "if (false) out.push("],
  ["IDX-004: Allow does not beat Disallow at equal length", "checks/idx-004.mjs", "(r.pattern.length === best.pattern.length && r.allow)", "false"],
  ["IDX-004: every bot's group counts", "checks/idx-004.mjs", ".filter((x) => x.agents.some((a) => AGENTS.has(a)))", ".filter(() => true)"],
  ["IDX-004: the sitemap files are not protected", "checks/idx-004.mjs", "...files.map((s) => ({ path:", "...[].map((s) => ({ path:"],
  // IDX-001
  ["IDX-001: a URL with no page passes", "checks/idx-001.mjs", "if (!byPath) out.push(", "if (!byPath) void ("],
  ["IDX-001: a noindex page listed by its canonical passes", "checks/idx-001.mjs", "if (page) { if (page.noindex) out.push(", "if (page) { if (false) out.push("],
  ["IDX-001: a noindex page listed by another URL passes", "checks/idx-001.mjs", "else if (byPath.noindex) out.push(", "else if (false) out.push("],
  ["IDX-001: a non-canonical URL passes", "checks/idx-001.mjs", "else out.push(f.fail(s.rel, e.line, `value-mismatch: non-canonical", "else void (f.fail(s.rel, e.line, `value-mismatch: non-canonical"],
  ["IDX-001: a page missing from the sitemap passes", "checks/idx-001.mjs", "if (!listed.has(want)) out.push(", "if (false) out.push("],
  ["IDX-001: a folder with no sitemap passes", "checks/idx-001.mjs", "if (!root) return [f.fail(", "if (!root) return []; if (false) return [f.fail("],
  ["IDX-001: a noindex page must be in the sitemap too", "checks/idx-001.mjs", "if (!site.indexable(p)) continue;\n    const want", "const want"],
  // IDX-002
  ["IDX-002: invalid XML passes", "checks/idx-002.mjs", "for (const p of xmlProblems(s.text)) out.push(", "for (const p of []) out.push("],
  ["IDX-002: too many URLs pass", "checks/idx-002.mjs", "if (urls.length > maxUrlsPerFile) out.push(", "if (false) out.push("],
  ["IDX-002: too many bytes pass", "checks/idx-002.mjs", "if (s.bytes > maxBytesPerFile) out.push(", "if (false) out.push("],
  ["IDX-002: a second origin passes", "checks/idx-002.mjs", "else if (u.origin !== origin) out.push(", "else if (false) out.push("],
  ["IDX-002: a duplicate entry passes", "checks/idx-002.mjs", "if (seen.has(e.loc)) out.push(", "if (false) out.push("],
  ["IDX-002: two files without an index pass", "checks/idx-002.mjs", 'if (files.length > 1 && root.kind !== "index") out.push(', "if (false) out.push("],
  ["IDX-002: a relative <loc> passes", "checks/idx-002.mjs", "if (!u) {", 'if (!u) { u = new URL(e.loc, "https://x.invalid/"); } if (false) {'],
  ["IDX-002: a file that is no urlset passes", "checks/idx-002.mjs", 'if (s.kind === "unknown") out.push(', "if (false) out.push("],
  ["IDX-002: no sitemap is a PASS", "checks/idx-002.mjs", "if (files.length === 0) return [f.skip(", "if (files.length === 0) return []; if (false) return [f.skip("],
  ["xml.mjs: a bare & is well-formed", "lib/xml.mjs", "if (BARE_AMP.test(m[5])) out.push(", "if (false) out.push("],
  // SE-004 and IDX-003
  ["SE-004: a bad lastmod passes", "checks/se-004.mjs", "if (why) out.push(", "if (false) out.push("],
  ["SE-004: a date-only lastmod is not recognised", "lib/sitemap-lastmod.mjs", 'if (/^\\d{4}-\\d{2}-\\d{2}$/.test(s)) return "date-only";', ""],
  ["SE-004: a lastmod with no timezone is not recognised", "lib/sitemap-lastmod.mjs", 'return "no timezone";', 'return null;'],
  ["SE-004: a lastmod in the future passes", "lib/sitemap-lastmod.mjs", 'if (t > now + 86_400_000) return "in the future";', ""],
  ["SE-004: a folder with no sitemap is a PASS", "checks/se-004.mjs", "if (maps.length === 0) return [f.skip(", "if (maps.length === 0) return []; if (false) return [f.skip("],
  ["IDX-003: the build-clock signature is not warned", "checks/idx-003.mjs", "if (buildClockSignature(urls, site.mtime(m.rel))) out.push(", "if (false) out.push("],
  ["IDX-003: the write time is not compared", "lib/sitemap-lastmod.mjs", "Math.abs(hi - mtimeMs) <= 10 * 60_000", "true"],
  ["IDX-003: fewer than five URLs are enough", "lib/sitemap-lastmod.mjs", "urls.length < 5", "urls.length < 2"],
  ["IDX-003: lastmods hours apart count as one stamp", "lib/sitemap-lastmod.mjs", "hi - lo <= 60_000", "true"],
  ["IDX-003: a folder with no sitemap is a PASS", "checks/idx-003.mjs", "if (maps.length === 0) return [f.skip(", "if (maps.length === 0) return []; if (false) return [f.skip("],
];
let survived = 0, missing = 0;
for (const [name, file, find, repl] of MUTANTS) {
  const dir = mkdtempSync(join(tmpdir(), "omnikom-audit-mut-"));
  try {
    cpSync(AUDIT, dir, { recursive: true });
    const p = join(dir, file);
    const t = readFileSync(p, "utf8");
    const n = t.split(find).length - 1;
    if (n !== 1) { missing++; console.log(`MISSING  ${name} (target text found ${n} times in ${file})`); continue; }
    writeFileSync(p, t.split(find).join(repl), "utf8");
    const r = spawnSync(process.execPath, [join(dir, "test", "run.mjs")], { encoding: "utf8", timeout: 180000, env: { ...process.env, OMNIKOM_AUDIT_DIR: dir } });
    const red = ((r.stdout || "").match(/^FAIL .*$/gm) || []).map((l) => l.slice(5, 75));
    const caught = r.status !== 0 && red.length > 0;
    if (!caught) survived++;
    console.log(`${caught ? "caught  " : "SURVIVED"} ${name.padEnd(62)} ${caught ? `(${red.length} red: ${red[0]})` : `(exit ${r.status}, ${red.length} red${r.status !== 0 ? ": " + String(r.stderr || r.stdout || "").trim().split(/\r?\n/).pop().slice(0, 80) : ""})`}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(`\n${MUTANTS.length} mutants, ${MUTANTS.length - survived - missing} caught, ${survived} survived, ${missing} target text missing`);
process.exit(survived || missing ? 1 : 0);
