// Watched-fail for tools/audit: a broken COPY of tools/audit with ONE rule or wall removed, test/run.mjs run against it
// (OMNIKOM_AUDIT_DIR), the suite must go red on a named check. Pattern of tools/departments/test/mutate.mjs:
// [name, file, exactText, replacement], applied with split/join to a temp copy, one child process per mutant (MUTATE_JOBS at a time, default 4), 180 s timeout.
// Caught = the suite exited nonzero AND printed at least one "FAIL" line. A crash or a timeout with no FAIL line is NOT a catch
// (it would hide a broken test), and target text that is not found exactly once is counted as "target text missing". A mutant whose process
// was killed (exit null: the timeout, a laptop sleep) is "NOT RUN", a third class that also makes the exit 1, so a killed run never reads as clean.
// The child runs with OMNIKOM_AUDIT_FAILFAST=1: test/run.mjs stops at its first red check (still printing that FAIL line and exiting 1), so a caught mutant costs
// only the checks up to its first failure; a mutant that survives runs the whole suite as before.
// Temp folders (slice 4b.1): one root, omnikom-audit-mutate-*, under OMNIKOM_AUDIT_TMP or the system temp folder; each mutant's copy lives inside it, and
// the child gets OMNIKOM_AUDIT_TMP, TMPDIR, TEMP and TMP pointed at <copy>/.tmp, so whatever a killed child made goes when its copy goes. The root is
// removed at the end and on SIGINT/SIGTERM (the children still running are stopped first, by their PID). A child that hits the time limit is killed with SIGKILL
// (what a laptop sleep amounts to: it can run no handler), so a run that leaks a folder outside its own root is seen by the check in test/run.mjs.
// Summary line: "N mutants, N caught, N survived, N not run, N target text missing".
//   node tools/audit/test/mutate.mjs      exit 0 = every mutant caught, none survived, none not run, none missing
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, cpSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const AUDIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = process.env.OMNIKOM_SKILL_DIR ? resolve(process.env.OMNIKOM_SKILL_DIR) : resolve(AUDIT, "..", "..", "skills", "programmatic-enterprise-web-performance");   // the skill's own fixtures (work order 25); a mutant's copy of tools/audit/ is not inside the repo
const MUTANTS = [
  // the engine and the runner
  ["the exit code is always 0", "index.mjs", "exit: pass ? 0 : 1", "exit: 0"],
  ["a FAIL line carries no source", "index.mjs", "(source: ${c.source})`);\n      }", "`);\n      }"],
  ["a check is admitted without its rules file", "index.mjs", "if (!fs.existsSync(rulesFile) || !fs.readFileSync(rulesFile, \"utf8\").includes(mod.id)) throw", "if (false) throw"],
  ["--only does not limit the rules", "index.mjs", "selected = CHECKS.filter((c) => want.includes(c.id));", "selected = CHECKS;"],
  ["an unknown --only id is accepted", "index.mjs", "if (unknown.length) throw", "if (false) throw"],
  ["index.mjs: an empty rules list runs nothing and passes", "index.mjs", "if (list.length === 0) throw", "if (false) throw"],
  ["index.mjs: an empty-string rules option means all rules", "index.mjs", "if (options.rules !== undefined && options.rules !== null) {", "if (options.rules) {"],
  ["index.mjs: an unknown rule id among real ones is dropped", "index.mjs", "const want = list.map((r) => String(r).trim().toUpperCase());", "const want = list.map((r) => String(r).trim().toUpperCase()).filter((r) => CHECKS.some((c) => c.id === r));"],
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
  // the summary (work order 05)
  ["summary.mjs: the 200-fail cap is removed", "summary.mjs", "out.fails.length >= MAX_FAILS || size + b > MAX_BYTES", "size + b > MAX_BYTES"],
  ["summary.mjs: the 300-character cut of a what is removed", "summary.mjs", "what: cut(f.what, MAX_WHAT)", "what: String(f.what)"],
  ["summary.mjs: a status that is not PASS, FAIL or SKIP is dropped, not counted", "summary.mjs", "else bump(target, status, MAX_KEYS + BASE.length);", ";"],
  ["summary.mjs: the 60 KiB byte budget is removed", "summary.mjs", "out.fails.length >= MAX_FAILS || size + b > MAX_BYTES", "out.fails.length >= MAX_FAILS"],
  ["summary.mjs: truncated always says 0", "summary.mjs", "out.truncated = allFails.length - out.fails.length;", "out.truncated = 0;"],
  ["run.mjs: --summary together with --json is accepted", "run.mjs", "if (json && summary) die(", "if (false) die("],
  ["summary.mjs: the PASS lines are not counted", "summary.mjs", 'counts.PASS++; family(String(l).split(" ")[1])["PASS"]++;', ""],
  ["summary.mjs: the commit is dropped", "summary.mjs", "if (commit) out.commit = cut(commit, 64);", ""],
  ["summary.mjs: the family is the whole rule id", "summary.mjs", 'String(id).split("-")[0]', "String(id)"],
  ["run.mjs: --summary prints the whole audit object", "run.mjs", 'JSON.stringify((await import(new URL("./summary.mjs", import.meta.url).href)).summarize(r))', "JSON.stringify(r)"],
  ["run.mjs: the usage line does not name --summary", "run.mjs", "[--json | --summary]", "[--json]"],
  // the plain names (work order 06)
  ["names.json: the MET-003 entry is dropped", "names.json", '    "MET-003": { "topic": "headings", "problem": "A page has no main heading, more than one, or headings that skip a level." },\n', ""],
  ["names.json: MET-003 points at the titles topic", "names.json", '"MET-003": { "topic": "headings"', '"MET-003": { "topic": "titles"'],
  ["summary.mjs: byTopic skips a status", "summary.mjs", "    add(topic(f.rule), status);\n", ""],
  ["names.mjs: topicOf returns the family prefix, not the topic", "names.mjs", "(has(ruleId) ? NAMES.rules[ruleId].topic : \"other\")", "String(ruleId).split(\"-\")[0]"],
  // the six-question report (work order 09)
  ["report.mjs: section 1 prints a number that is no fact (pages + 1)", "report.mjs", "`${n(`s1.${id}.PASS`, b.PASS, `${at}.PASS`)} pass`", "`${summary.pages + 1} pass`"],
  ["report.mjs: the pass count fact is read from counts.FAIL", "report.mjs", "n(\"pass\", c.PASS, \"summary.counts.PASS\")", "n(\"pass\", c.PASS, \"summary.counts.FAIL\")"],
  ["report.mjs: section 6 ignores severity", "report.mjs", "(rank(x) - rank(y)) || (y.pages.length - x.pages.length)", "(y.pages.length - x.pages.length)"],
  ["report.mjs: the truncated line is dropped", "report.mjs", "if (summary.truncated > 0) md.push(", "if (false) md.push("],
  // questions 2 to 5 from the skill's report.json (work order 25)
  ["report.mjs: question 4 prints a live number that is no fact (referring domains + 1)", "report.mjs", "num(\"q4.referringDomains\", f.referringDomains, `${base}.facts.referringDomains`)", "String((f.referringDomains?.value ?? 0) + 1)"],
  ["report.mjs: a flattened competitor source points at entry 0 for every competitor", "report.mjs", "`${cPath}.value[${j}].referringDomains`", "`${cPath}.value[0].referringDomains`"],
  ["report.mjs: a live number with no value is printed as 0", "report.mjs", "{ if (!isCount(v)) return NOT; emit(id, v, source, node, path); return String(v); }", "{ if (!isCount(v)) return \"0\"; emit(id, v, source, node, path); return String(v); }"],
  ["report.mjs: a BLOCKED live question is rendered as answered", "report.mjs", "lq && lq.q.status !== \"BLOCKED\"", "lq"],
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
  ["IDX-004: a missing robots.txt passes", "checks/idx-004.mjs", "if (!rb.present) return [...out, f.fail(", "if (!rb.present) return out; if (false) return [...out, f.fail("],
  ["IDX-004: a robots.txt with no Sitemap line passes", "checks/idx-004.mjs", "if (sitemaps.length === 0) out.push(", "if (sitemaps.length === 0) void ("],
  ["IDX-004: a Sitemap line to another file passes", "checks/idx-004.mjs", "if (!paths.includes(rootPath)) out.push(", "if (false) out.push("],
  ["IDX-004: a Disallow on a page or sitemap passes", "checks/idx-004.mjs", "if (w && !w.allow) out.push(", "if (false) out.push("],
  ["IDX-004: Allow does not beat Disallow at equal length", "checks/idx-004.mjs", "(r.pattern.length === best.pattern.length && r.allow)", "false"],
  ["IDX-004: every bot's group counts", "checks/idx-004.mjs", ".filter((x) => x.agents.some((a) => AGENTS.has(a)))", ".filter(() => true)"],
  ["IDX-004: the sitemap files are not protected", "checks/idx-004.mjs", "...files.filter((s) => s.urlPath).map((s) => ({ path:", "...[].filter((s) => s.urlPath).map((s) => ({ path:"],
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
  // slice 2: snapshot input (reader and context)
  ["context.mjs: the snapshot origin is not used", "lib/context.mjs", "site.origin = loaded.origin || site.origin;", "site.origin = site.origin;"],
  ["context.mjs: a 404 or redirect record is a judged page", "lib/context.mjs", ".filter((p) => !snap || p.status === 200)", ".filter(() => true)"],
  ["context.mjs: a gzipped sitemap is not unpacked", "lib/context.mjs", "(/\\.gz$/i.test(rel) ? zlib.gunzipSync(b) : b)", "b"],
  ["context.mjs: robots.json header names are case-sensitive", "lib/context.mjs", "headers[k.toLowerCase()] = String(v)", "headers[k] = String(v)"],
  ["context.mjs: the robots.json facts are ignored", "lib/context.mjs", "measured: !!j }", "measured: false }"],
  ["context.mjs: the robots size is the saved file's, not the size sent", "lib/context.mjs", "bytes: j && typeof j.bytes === \"number\" ? j.bytes : buf ? buf.length : null,", "bytes: buf ? buf.length : null,"],
  ["context.mjs: a snapshot sitemap URL path is its file path", "lib/context.mjs", "if (f) urlPath = new URL(f.url).pathname;", "if (f) urlPath = \"/\" + rel;"],
  ["context.mjs: psi/<date>.json in the folder is not looked for", "lib/context.mjs", "if (fs.existsSync(d) && fs.statSync(d).isDirectory()) { const names", "if (false) { const names"],
  ["context.mjs: the oldest PSI file is used", "lib/context.mjs", "file = path.join(d, names[names.length - 1])", "file = path.join(d, names[0])"],
  ["site.mjs: a followed redirect with no direct record is not a page", "lib/site.mjs", "for (const r of recs) if (r.crawledPath !== r.finalPath && !pages.has(r.finalPath)) add(r);", ""],
  ["site.mjs: a record with no body crashes the reader", "lib/site.mjs", "const html = fs.existsSync(r.gz) ? zlib.gunzipSync(fs.readFileSync(r.gz)).toString(\"utf8\") : \"\";", "const html = zlib.gunzipSync(fs.readFileSync(r.gz)).toString(\"utf8\");"],
  ["site.mjs: a 3xx first hop is not a redirect", "lib/site.mjs", "first >= 300 && first < 400", "first >= 300 && first < 300"],
  ["site.mjs: every snapshot is a complete crawl", "lib/site.mjs", "complete: meta.complete === true", "complete: true"],
  ["index.mjs: audit() ignores options.psi", "index.mjs", "buildSite(dir, config, { psi: options.psi, target: options.target || null, promptCoverage", "buildSite(dir, config, { target: options.target || null, promptCoverage"],
  ["index.mjs: the speed numbers are not validated", "index.mjs", "|| !Number.isFinite(v) || v <= 0) throw new AuditError(`WCF-004: speed.", "|| false) throw new AuditError(`WCF-004: speed."],
  ["index.mjs: the default lcpMs is 2400", "index.mjs", "lcpMs: 2500,", "lcpMs: 2400,"],
  ["index.mjs: the default cls is 0.2", "index.mjs", "cls: 0.1,", "cls: 0.2,"],
  ["index.mjs: the default tbtMs is 300", "index.mjs", "tbtMs: 200,", "tbtMs: 300,"],
  ["index.mjs: the default ttfbMs is 700", "index.mjs", "ttfbMs: 600 }", "ttfbMs: 700 }"],
  ["run.mjs: --psi is ignored", "run.mjs", "engine.audit(folder, { rules: only || undefined, psi: psi || undefined, target: target || undefined, promptCoverage", "engine.audit(folder, { rules: only || undefined, target: target || undefined, promptCoverage"],
  // slice 2: IDX-001, IDX-002, URL-009, IDX-004 in snapshot mode
  ["IDX-001: a snapshot is always a complete crawl", "checks/idx-001.mjs", "const partial = site.mode === \"snapshot\" && !site.complete;", "const partial = false;"],
  ["IDX-001: a snapshot is never a complete crawl", "checks/idx-001.mjs", "const partial = site.mode === \"snapshot\" && !site.complete;", "const partial = site.mode === \"snapshot\";"],
  ["IDX-001: extra is judged on a partial crawl", "checks/idx-001.mjs", "if (!byPath && partial) {", "if (false) {"],
  ["IDX-001: missing is judged on a partial crawl", "checks/idx-001.mjs", "if (partial && !listed.has(want)) {", "if (false) {"],
  ["IDX-001: a listed URL the crawl saw as 404 passes", "checks/idx-001.mjs", "if (byPath && byPath.status !== 200) {", "if (false) {"],
  ["IDX-002: the snapshot origin is the first URL's", "checks/idx-002.mjs", "let origin = site.mode === \"snapshot\" && site.origin ? site.origin : null;", "let origin = null;"],
  ["URL-009: a canonical on another origin than the fetch passes", "checks/url-009.mjs", "if (site.mode === \"snapshot\" && site.origin && u.origin !== site.origin) out.push(", "if (false) out.push("],
  ["IDX-004: a robots.txt status other than 200 passes", "checks/idx-004.mjs", "if (rb.status !== 200) return [", "if (false) return ["],
  ["IDX-004: a robots.txt content type other than text/plain passes", "checks/idx-004.mjs", "if (!/^text\\/plain\\b/i.test(rb.headers[\"content-type\"] || \"\")) out.push(", "if (false) out.push("],
  // slice 2: SE-001
  ["SE-001: a 404 is a FAIL, not a WARN", "checks/se-001.mjs", "if (s === 404) return [f.warn(", "if (s === 404) return [f.fail("],
  ["SE-001: a 5xx or 429 is treated as any other status", "checks/se-001.mjs", "if (s >= 500 || s === 429) return [", "if (false) return ["],
  ["SE-001: a 429 is not a server error", "checks/se-001.mjs", "if (s >= 500 || s === 429) return [", "if (s >= 500) return ["],
  ["SE-001: a status other than 200 passes", "checks/se-001.mjs", "if (s !== 200) return [", "if (false) return ["],
  ["SE-001: a fetch error with no status passes as a status", "checks/se-001.mjs", "if (typeof s !== \"number\") return [", "if (false) return ["],
  ["SE-001: a content type other than text/plain passes", "checks/se-001.mjs", "if (rb.measured && !/^text\\/plain\\b/i.test(", "if (false && !/^text\\/plain\\b/i.test("],
  ["SE-001: a robots.txt over 512,000 bytes passes", "checks/se-001.mjs", "if (rb.bytes !== null && rb.bytes > MAX_BYTES) out.push(", "if (false) out.push("],
  ["SE-001: exactly 512,000 bytes fails", "checks/se-001.mjs", "rb.bytes > MAX_BYTES) out.push(", "rb.bytes >= MAX_BYTES) out.push("],
  ["SE-001: a byte that is not UTF-8 passes", "checks/se-001.mjs", "} catch { return n; }", "} catch { }"],
  ["SE-001: a U+FFFD in the saved text passes", "checks/se-001.mjs", "if (dec.decode(chunk).includes(\"\\uFFFD\")) return n;", "if (false) return n;"],
  ["SE-001: a folder with no robots.txt is a PASS", "checks/se-001.mjs", "if (!rb.measured && !rb.present) return [f.skip(", "if (false) return [f.skip("],
  // slice 2: LNK-002 status part
  ["LNK-002: a snapshot target the crawl saw as 404 passes", "checks/lnk-002.mjs", "if (seen.status !== 200) { out.push(", "if (false) { out.push("],
  ["LNK-002: a target the crawl saw redirect passes", "checks/lnk-002.mjs", "if (!seen) { out.push(f.fail(p.path, l.line, `redirect-target:", "if (false) { out.push(f.fail(p.path, l.line, `redirect-target:"],
  ["LNK-002: a target whose final status is 3xx is a plain status mismatch", "checks/lnk-002.mjs", "if (seen.status >= 300 && seen.status < 400) {", "if (false) {"],
  ["LNK-002: a target the crawl did not visit is a FAIL", "checks/lnk-002.mjs", "out.push(f.skip(p.path, `not-crawled:", "out.push(f.fail(p.path, l.line, `not-crawled:"],
  ["LNK-002: a target the crawl did not visit is a PASS", "checks/lnk-002.mjs", "if (!skipped.has(r.path)) out.push(f.skip(", "if (false) out.push(f.skip("],
  ["LNK-002: every uncrawled link is its own SKIP", "checks/lnk-002.mjs", "          skipped.add(r.path);\n", ""],
  ["LNK-002: a link to a file is judged in a snapshot", "checks/lnk-002.mjs", "        if (r.kind === \"file\") continue;\n", ""],
  // slice 2: PRF-001
  ["PRF-001: an LCP over the budget passes", "checks/prf-001.mjs", "[\"LCP\", \"lcpMs\", \"ms\", speed.lcpMs]", "[\"LCP\", \"lcpMs\", \"ms\", Infinity]"],
  ["PRF-001: a CLS over the budget passes", "checks/prf-001.mjs", "[\"CLS\", \"cls\", \"\", speed.cls]", "[\"CLS\", \"cls\", \"\", Infinity]"],
  ["PRF-001: a TBT over the budget passes", "checks/prf-001.mjs", "[\"TBT\", \"tbtMs\", \"ms\", speed.tbtMs]", "[\"TBT\", \"tbtMs\", \"ms\", Infinity]"],
  ["PRF-001: a value equal to the budget fails", "checks/prf-001.mjs", "else if (v > limit) out.push(", "else if (v >= limit) out.push("],
  ["PRF-001: a metric that is null passes", "checks/prf-001.mjs", "if (v === null) out.push(f.skip(", "if (false) out.push(f.skip("],
  ["PRF-001: an UNTRUSTED lab number is judged", "checks/prf-001.mjs", "if (trust !== \"trusted\") {", "if (false) {"],
  ["PRF-001: only a missing speedTrust is untrusted", "checks/prf-001.mjs", "if (trust !== \"trusted\") {", "if (trust === null) {"],
  ["PRF-001: PSI numbers are not preferred", "checks/prf-001.mjs", "if (psi) { judge(", "if (false) { judge("],
  ["PRF-001: the PSI source is not named", "checks/prf-001.mjs", " (source: PSI ${site.psi.date})`", "`"],
  ["PRF-001: a PSI desktop number is used", "checks/prf-001.mjs", "String(e.strategy).toLowerCase() === \"mobile\" &&", "true &&"],
  ["PRF-001: a page with no browser file is judged", "checks/prf-001.mjs", "if (!m) { out.push(f.skip(", "if (false) { out.push(f.skip("],
  ["PRF-001: a flat browser file is not read", "checks/prf-001.mjs", "? m.vitals : m || {};", "? m.vitals : {};"],
  // slice 2: PRF-016
  ["PRF-016: a slow response passes", "checks/prf-016.mjs", "if (p.ttfbMs > limit) out.push(", "if (false) out.push("],
  ["PRF-016: a response equal to the budget warns", "checks/prf-016.mjs", "if (p.ttfbMs > limit) out.push(", "if (p.ttfbMs >= limit) out.push("],
  ["PRF-016: the WARN becomes a FAIL", "checks/prf-016.mjs", "out.push(f.warn(p.path, 1,", "out.push(f.fail(p.path, 1,"],
  ["PRF-016: a response with no ttfbMs passes", "checks/prf-016.mjs", "if (p.ttfbMs === null) {", "if (false) {"],
  // slice 2: the live driver
  ["live.mjs: a FAILED line exits 0", "live.mjs", "nothing was judged`, 3);\nconst m", "nothing was judged`, 0);\nconst m"],
  ["live.mjs: no verdict line is not an error", "live.mjs", "if (!verdict) die(", "if (false) die("],
  ["live.mjs: a child that exits 2 gives 3", "live.mjs", "see its message above\\n${USAGE}`, 2);", "see its message above\\n${USAGE}`, 3);"],
  ["live.mjs: the audit exit is ignored", "live.mjs", "process.exit(res.exit);", "process.exit(0);"],
  ["live.mjs: the child's progress lines go to stdout", "live.mjs", "else if (l) console.error(l);", "else if (l) console.log(l);"],
  ["live.mjs: --fresh is not passed on", "live.mjs", "if (fresh) childArgs.push(\"--fresh\");", ""],
  ["live.mjs: --cwd is not passed on", "live.mjs", "if (cwd) childArgs.push(\"--cwd\", cwd);", ""],
  ["live.mjs: --max-age-days is not passed on", "live.mjs", "if (maxAge !== null) childArgs.push(\"--max-age-days\", maxAge);", ""],
  ["live.mjs: the snapshot options after -- are not passed on", "live.mjs", "if (dd >= 0) childArgs.push(\"--\", ...pass);", ""],
  ["live.mjs: --psi is not passed to the audit", "live.mjs", "engine.audit(dir, { rules: only || undefined, psi: psi || undefined, target: buildTarget || undefined, promptCoverage", "engine.audit(dir, { rules: only || undefined, target: buildTarget || undefined, promptCoverage"],
  ["live.mjs: --only is not passed to the audit", "live.mjs", "engine.audit(dir, { rules: only || undefined,", "engine.audit(dir, { rules: undefined,"],
  ["live.mjs: a url that is not http(s) is accepted", "live.mjs", "if (!url || !/^https?:\\/\\//i.test(url)) die(", "if (!url) die("],
  ["live.mjs: the (finished ...) suffix of a REUSE line stays in the folder name", "live.mjs", "(?: \\(finished [^)]*\\))?$/.exec(verdict)", "$/.exec(verdict)"],
  // slice 4b: the source wall for a check that exports no source, and the DSN design tells
  ["index.mjs: a check with no source string is admitted", "index.mjs", 'if (typeof mod.source !== "string" || !mod.source) throw', "if (false) throw"],
  // each DSN check emptied (its run() returns no finding): the watched-red of the rule, the first red line names its fixture
  ...["001", "002", "003", "004", "005", "006", "007", "008", "009", "010", "011"].map((n) => [`DSN-${n}: the check is emptied`, `checks/dsn-${n}.mjs`, "export function run(site) {\n  const out = [];", "export function run(site) {\n  return [];\n  const out = [];"]),
  // DSN-001
  ["DSN-001: animate-pulse passes", "checks/dsn-001.mjs", 'new Set(["animate-pulse", "animate-ping", "animate-bounce", "transition-all"])', 'new Set(["animate-ping", "animate-bounce", "transition-all"])'],
  ["DSN-001: animate-ping passes", "checks/dsn-001.mjs", 'new Set(["animate-pulse", "animate-ping", "animate-bounce", "transition-all"])', 'new Set(["animate-pulse", "animate-bounce", "transition-all"])'],
  ["DSN-001: animate-bounce passes", "checks/dsn-001.mjs", 'new Set(["animate-pulse", "animate-ping", "animate-bounce", "transition-all"])', 'new Set(["animate-pulse", "animate-ping", "transition-all"])'],
  ["DSN-001: transition-all passes", "checks/dsn-001.mjs", 'new Set(["animate-pulse", "animate-ping", "animate-bounce", "transition-all"])', 'new Set(["animate-pulse", "animate-ping", "animate-bounce"])'],
  ["DSN-001: hover:scale passes", "checks/dsn-001.mjs", "else if (variants.some((v) => HOVER.test(v)) && /^-?scale(-|$)/.test(utility)) why", "else if (false) why"],
  ["DSN-001: group-hover and peer-hover are not hover", "checks/dsn-001.mjs", String.raw`const HOVER = /^(?:(?:group|peer)-)?hover(?:\/.+)?$/;`, "const HOVER = /^hover$/;"],
  ["DSN-001: a negative scale is not a scale", "checks/dsn-001.mjs", String.raw`/^-?scale(-|$)/.test(utility)`, String.raw`/^scale(-|$)/.test(utility)`],
  ["DSN-001: a shimmer class passes", "checks/dsn-001.mjs", 'else if (tok.toLowerCase().includes("shimmer")) why', "else if (false) why"],
  ["DSN-001: shimmer in a class is case-sensitive", "checks/dsn-001.mjs", 'tok.toLowerCase().includes("shimmer")', 'tok.includes("shimmer")'],
  ["DSN-001: a variant prefix hides a token", "checks/dsn-001.mjs", "const { variants, utility } = splitToken(tok);", "const { variants, utility } = { variants: [], utility: tok };"],
  ["DSN-001: a shimmer @keyframes passes", "checks/dsn-001.mjs", "if (!/shimmer/i.test(k.name)) continue;", "continue;"],
  ["DSN-001: a stylesheet is reported once per page that links it", "checks/dsn-001.mjs", "if (seen.has(key)) continue;", ""],
  ["DSN-001: a stylesheet finding is put on the page, not on the file", "checks/dsn-001.mjs", "out.push(f.fail(k.file || p.path, k.line,", "out.push(f.fail(p.path, k.line,"],
  // DSN-002
  ["DSN-002: gradient text by classes passes", "checks/dsn-002.mjs", 'if (toks.some((t) => t.utility === "bg-clip-text") && toks.some((t) => t.utility === "text-transparent")) textWhy', "if (false) textWhy"],
  ["DSN-002: bg-clip-text alone is gradient text", "checks/dsn-002.mjs", '&& toks.some((t) => t.utility === "text-transparent")', ""],
  ["DSN-002: gradient text by a CSS clip passes", "checks/dsn-002.mjs", "if (clip.length && (gradDecls.length || gradClass)) {", "if (false) {"],
  ["DSN-002: a CSS clip without a gradient is gradient text", "checks/dsn-002.mjs", "if (clip.length && (gradDecls.length || gradClass)) {", "if (clip.length) {"],
  ["DSN-002: any background-clip value is text", "checks/dsn-002.mjs", String.raw` && /\btext\b/i.test(d.value)`, ""],
  ["DSN-002: a Tailwind hue gradient passes", "checks/dsn-002.mjs", "if (fams.length >= 2) out.push(", "if (false) out.push("],
  ["DSN-002: one family is a Tailwind hue gradient", "checks/dsn-002.mjs", "if (fams.length >= 2) out.push(", "if (fams.length >= 1) out.push("],
  ["DSN-002: variant groups are one group", "checks/dsn-002.mjs", 'const key = t.variants.join(":");', 'const key = "";'],
  ["DSN-002: a colour with no family counts as a family", "checks/dsn-002.mjs", "if (!sf.family) continue;", "if (sf.unknown) continue;"],
  ["DSN-002: a CSS hue gradient passes", "checks/dsn-002.mjs", "if (fams.length >= 2) { out.push(", "if (false) { out.push("],
  ["DSN-002: one family is a CSS hue gradient", "checks/dsn-002.mjs", "if (fams.length >= 2) { out.push(", "if (fams.length >= 1) { out.push("],
  ["DSN-002: background-image is not read", "checks/dsn-002.mjs", '["background", "background-image"].map(', '["background"].map('],
  ["DSN-002: an arbitrary Tailwind colour is not read", "checks/dsn-002.mjs", String.raw`if ((m = /^\[(.+)\]$/.exec(s))) return colourFamily(`, "if (false) return colourFamily("],
  ["DSN-002: an opacity suffix hides a Tailwind colour", "checks/dsn-002.mjs", String.raw`const s = rest.replace(/\/[\w.%[\]]+$/, "");`, "const s = rest;"],
  ["colour.mjs: indigo is not in the blue family", "lib/colour.mjs", 'tailwind: ["sky", "blue", "indigo"]', 'tailwind: ["sky", "blue"]'],
  ["colour.mjs: the red hue range does not wrap", "lib/colour.mjs", "f.from < f.to ? x >= f.from && x < f.to : x >= f.from || x < f.to", "x >= f.from && x < f.to"],
  ["colour.mjs: a grey is a family", "lib/colour.mjs", "if (s < GREY_RULE.maxSaturation || l < GREY_RULE.maxLightness || l > GREY_RULE.minLightness) return { none: true };", ""],
  ["colour.mjs: a very light tint is a family", "lib/colour.mjs", "minLightness: 0.96", "minLightness: 1.1"],
  ["colour.mjs: a very dark tint is a family", "lib/colour.mjs", "maxLightness: 0.05", "maxLightness: 0"],
  ["colour.mjs: a short hex colour is not expanded", "lib/colour.mjs", 'if (h.length <= 4) h = h.split("").map((c) => c + c).join("");', ""],
  ["colour.mjs: parentheses inside a gradient are not balanced", "lib/colour.mjs", 'if (value[i] === "(") depth++; else if (value[i] === ")") depth--;', 'if (value[i] === ")") depth--;'],
  ["colour.mjs: a comma inside a colour function splits a stop", "lib/colour.mjs", 'if (ch === "," && depth === 0) {', 'if (ch === ",") {'],
  ["colour.mjs: hsl colours are not read", "lib/colour.mjs", String.raw`if ((m = /^hsla?\(([^)]*)\)$/.exec(s))) {`, "if (false) {"],
  // DSN-003
  ["DSN-003: an emoji in a label passes", "checks/dsn-003.mjs", "if (found.length) out.push(", "if (false) out.push("],
  ["DSN-003: h1 is not a label", "checks/dsn-003.mjs", '"h1", "h2", "h3", "h4", "h5", "h6", "button"', '"h2", "h3", "h4", "h5", "h6", "button"'],
  ["DSN-003: a link is not a label", "checks/dsn-003.mjs", '"button", "a", "label"', '"button", "label"'],
  ["DSN-003: label, legend and th are not labels", "checks/dsn-003.mjs", '"label", "legend", "summary", "th", "option"', '"summary", "option"'],
  ["DSN-003: summary and option are not labels", "checks/dsn-003.mjs", '"summary", "th", "option"', '"th"'],
  ["DSN-003: the U+FE0F branch is dropped (a text symbol with the selector passes)", "checks/dsn-003.mjs", " || PICTOGRAPH_WITH_SELECTOR.test(cluster)", ""],
  ["DSN-003: the Emoji_Presentation branch is dropped (a plain emoji passes)", "checks/dsn-003.mjs", "/\\p{Emoji_Presentation}/u.test(cluster) || ", ""],
  ["DSN-003: every pictograph is an emoji (a bare arrow or play sign fails)", "checks/dsn-003.mjs", ".filter(showsAsEmoji)", ".filter(() => true)"],
  ["DSN-003: the emoji selector is not part of an emoji", "checks/dsn-003.mjs", String.raw`const EMOJI = /\p{Extended_Pictographic}[️⃣\u{1F3FB}-\u{1F3FF}]*(?:‍\p{Extended_Pictographic}[️\u{1F3FB}-\u{1F3FF}]*)*/gu;`, String.raw`const EMOJI = /\p{Extended_Pictographic}/gu;`],
  ["DSN-003: the nearest label is not searched for", "checks/dsn-003.mjs", "while (el && !LABELS.has(el.tag)) el = el.parent >= 0 ? sc.elements[el.parent] : null;", "if (el && !LABELS.has(el.tag)) el = null;"],
  // DSN-004
  ["DSN-004: a lowercase element counts as uppercase", "checks/dsn-004.mjs", "if (!up || !up.upper) continue;", "if (!up) continue;"],
  ["DSN-004: zero tracking counts as tracked", "checks/dsn-004.mjs", "if (!tr || tr.sign <= 0) continue;", "if (!tr || tr.sign < 0) continue;"],
  ["DSN-004: negative tracking counts as tracked", "checks/dsn-004.mjs", "if (!tr || tr.sign <= 0) continue;", "if (!tr || tr.sign >= 0) continue;"],
  ["DSN-004: a label with no text is judged", "checks/dsn-004.mjs", "if (!text) continue;", ""],
  ["typography.mjs: a class with a variant prefix is read", "lib/typography.mjs", ".filter((t) => t.variants.length === 0)", ".filter(() => true)"],
  ["typography.mjs: normal-case does not turn uppercase off", "lib/typography.mjs", 'else if (utility === "lowercase" || utility === "capitalize" || utility === "normal-case") cand.push', "else if (false) cand.push"],
  ["typography.mjs: the style attribute text-transform is not read", "lib/typography.mjs", 'inlineDecls(sc, el, ["text-transform"])', "[]"],
  ["typography.mjs: the style attribute letter-spacing is not read", "lib/typography.mjs", 'inlineDecls(sc, el, ["letter-spacing"])', "[]"],
  ["typography.mjs: the style attribute font-size is not read", "lib/typography.mjs", 'inlineDecls(sc, el, ["font-size"])', "[]"],
  ["typography.mjs: the style attribute font-weight is not read", "lib/typography.mjs", 'inlineDecls(sc, el, ["font-weight"])', "[]"],
  ["typography.mjs: a stylesheet text-transform is not read", "lib/typography.mjs", 'sheetDecls(sc, el, ["text-transform"])', "[]"],
  ["typography.mjs: a stylesheet letter-spacing is not read", "lib/typography.mjs", 'sheetDecls(sc, el, ["letter-spacing"])', "[]"],
  ["typography.mjs: a stylesheet font-size is not read", "lib/typography.mjs", 'sheetDecls(sc, el, ["font-size"])', "[]"],
  ["typography.mjs: a stylesheet font-weight is not read", "lib/typography.mjs", 'sheetDecls(sc, el, ["font-weight"])', "[]"],
  ["typography.mjs: zero letter spacing is positive", "lib/typography.mjs", "return n > 0 ? 1 : n < 0 ? -1 : 0;", "return n >= 0 ? 1 : -1;"],
  ["typography.mjs: tracking-normal is wide", "lib/typography.mjs", "normal: 0, wide: 1", "normal: 1, wide: 1"],
  ["typography.mjs: tracking-tight is not negative", "lib/typography.mjs", "tighter: -1, tight: -1", "tighter: -1, tight: 0"],
  ["typography.mjs: text-xs is 14 px", "lib/typography.mjs", "{ xs: 12, sm: 14,", "{ xs: 14, sm: 14,"],
  ["typography.mjs: text-sm is under 14 px", "lib/typography.mjs", "xs: 12, sm: 14,", "xs: 12, sm: 13,"],
  ["typography.mjs: an arbitrary font size is not read", "lib/typography.mjs", String.raw`else if ((m = /^text-\[(?:length:)?(.+)\]$/.exec(utility)))`, "else if (false)"],
  ["typography.mjs: bold and bolder are not 700", "lib/typography.mjs", 'if (s === "bold" || s === "bolder") return 700;', ""],
  ["typography.mjs: an arbitrary font weight is not read", "lib/typography.mjs", String.raw`else if ((m = /^font-\[(\d{3})\]$/.exec(utility)))`, "else if (false)"],
  ["typography.mjs: font-bold is 600", "lib/typography.mjs", "bold: 700, extrabold", "bold: 600, extrabold"],
  ["typography.mjs: font-black is 600", "lib/typography.mjs", "black: 900", "black: 600"],
  ["typography.mjs: the first declaration wins, not the last", "lib/typography.mjs", "return l.length ? l[l.length - 1] : null;", "return l.length ? l[0] : null;"],
  // DSN-005
  ["DSN-005: AI powered with a space passes", "checks/dsn-005.mjs", "AI[-‐‑ ]+powered", "AI-powered"],
  ["DSN-005: powered by AI passes", "checks/dsn-005.mjs", "|powered +by +AI", ""],
  ["DSN-005: the match is case-sensitive", "checks/dsn-005.mjs", "\"gi\");", "\"g\");"],
  ["DSN-005: the non-breaking hyphen is not a hyphen", "checks/dsn-005.mjs", "AI[-‐‑ ]+powered", "AI[- ]+powered"],
  ["DSN-005: supercharge is no hype word", "checks/dsn-005.mjs", "|supercharge", ""],
  ["DSN-005: seamless is no hype word", "checks/dsn-005.mjs", "|seamless", ""],
  ["DSN-005: unlock is no hype word", "checks/dsn-005.mjs", "|unlock", ""],
  ["DSN-005: magic is no hype word", "checks/dsn-005.mjs", "|magic", ""],
  ["DSN-005: revolutionize is no hype word", "checks/dsn-005.mjs", "|revolutioni[sz](?:e|es|ed|ing)", ""],
  ["DSN-005: revolutionary is no hype word", "checks/dsn-005.mjs", "|revolutionary", ""],
  ["DSN-005: game-changing is no hype word", "checks/dsn-005.mjs", "|game[-‐‑ ]chang(?:ing|er|ers)", ""],
  ["DSN-009: trusted-by claims pass", "checks/dsn-009.mjs", "(?:loved|trusted) +by", "loved +by"],
  // DSN-006, DSN-007, DSN-008, DSN-009
  ["DSN-006: an exclamation mark outside a heading is a finding", "checks/dsn-006.mjs", "if (!HEADINGS.has(el.tag)) continue;", ""],
  ["DSN-006: h6 is not a heading", "checks/dsn-006.mjs", 'new Set(["h1", "h2", "h3", "h4", "h5", "h6"])', 'new Set(["h1", "h2", "h3", "h4", "h5"])'],
  ["DSN-006: an exclamation mark passes", "checks/dsn-006.mjs", "sc.textMatches(el, /!/)[0]", "sc.textMatches(el, /!!/)[0]"],
  ["DSN-007: Howdy is no greeting", "checks/dsn-007.mjs", "|greetings|howdy)", "|greetings)"],
  ["DSN-007: Hi-fi is a greeting", "checks/dsn-007.mjs", String.raw`(?![\p{L}\p{N}_'’-])`, String.raw`(?![\p{L}\p{N}])`],
  ["DSN-007: a greeting anywhere in the heading counts", "checks/dsn-007.mjs", "/^(?:hello|hi|hey|welcome|greetings|howdy)", "/(?:hello|hi|hey|welcome|greetings|howdy)"],
  ["DSN-007: the greeting match is case-sensitive", "checks/dsn-007.mjs", "/iu;", "/u;"],
  ["DSN-007: h3 is not judged", "checks/dsn-007.mjs", 'new Set(["h1", "h2", "h3"])', 'new Set(["h1", "h2"])'],
  ["DSN-007: h4 is judged", "checks/dsn-007.mjs", 'new Set(["h1", "h2", "h3"])', 'new Set(["h1", "h2", "h3", "h4"])'],
  ["DSN-008: mark is no badge tag", "checks/dsn-008.mjs", '"em", "mark", "b"]', '"em", "b"]'],
  ["DSN-008: a button is a badge tag", "checks/dsn-008.mjs", '"em", "mark", "b"]', '"em", "mark", "b", "button"]'],
  ["DSN-008: Pro tips is a badge", "checks/dsn-008.mjs", "const WORD = /^(?:pro|beta)$/i;", "const WORD = /^(?:pro|beta)/i;"],
  ["DSN-008: the badge match is case-sensitive", "checks/dsn-008.mjs", "|beta)$/i;", "|beta)$/;"],
  ["DSN-008: nested badges are all reported", "checks/dsn-008.mjs", "if (hits.some((o) => o !== el && o.parent === el.i)) continue;", ""],
  ["DSN-009: loved-by claims pass", "checks/dsn-009.mjs", "for (const re of [LOVED, TIMES])", "for (const re of [TIMES])"],
  ["DSN-009: times claims pass", "checks/dsn-009.mjs", "for (const re of [LOVED, TIMES])", "for (const re of [LOVED])"],
  ["DSN-009: higher is no comparative", "checks/dsn-009.mjs", "|smarter|higher)", "|smarter)"],
  ["DSN-009: the multiplication sign is no x", "checks/dsn-009.mjs", String.raw`[x×]`, "[x]"],
  ["DSN-009: a number inside a word starts a claim", "checks/dsn-009.mjs", String.raw`(?<![\p{L}\p{N}.])`, ""],
  ["DSN-009: M is no multiplier", "checks/dsn-009.mjs", String.raw`(?: *[km])?`, String.raw`(?: *[k])?`],
  ["DSN-009: a plus sign ends the claim", "checks/dsn-009.mjs", String.raw`\+? +\p{L}+`, String.raw` +\p{L}+`],
  // DSN-010, DSN-011
  ["DSN-010: heavy small text passes", "checks/dsn-010.mjs", "if (!w || w.weight < 700) continue;", "if (true) continue;"],
  ["DSN-010: 600 is heavy", "checks/dsn-010.mjs", "w.weight < 700", "w.weight < 600"],
  ["DSN-010: 700 is not heavy enough", "checks/dsn-010.mjs", "w.weight < 700", "w.weight < 800"],
  ["DSN-010: 14 px is small", "checks/dsn-010.mjs", "!(s.px < 14)", "!(s.px <= 14)"],
  ["DSN-010: 13 px is not small", "checks/dsn-010.mjs", "!(s.px < 14)", "!(s.px < 13)"],
  ["DSN-010: an element with no text is judged", "checks/dsn-010.mjs", "if (!text) continue;", ""],
  ["DSN-010: the WARN becomes a FAIL", "checks/dsn-010.mjs", "out.push(f.warn(", "out.push(f.fail("],
  ["DSN-011: negative spacing on small text passes", "checks/dsn-011.mjs", "if (!t || t.sign >= 0) continue;", "if (true) continue;"],
  ["DSN-011: zero spacing is negative", "checks/dsn-011.mjs", "t.sign >= 0", "t.sign > 0"],
  ["DSN-011: positive spacing is negative", "checks/dsn-011.mjs", "if (!t || t.sign >= 0) continue;", "if (!t) continue;"],
  ["DSN-011: 14 px is small", "checks/dsn-011.mjs", "!(s.px < 14)", "!(s.px <= 14)"],
  ["DSN-011: an element with no text is judged", "checks/dsn-011.mjs", "if (!text) continue;", ""],
  ["DSN-011: the WARN becomes a FAIL", "checks/dsn-011.mjs", "out.push(f.warn(", "out.push(f.fail("],
  // the DSN reader (lib/design.mjs)
  ["design.mjs: an open block tag does not end a run of text", "lib/design.mjs", 'if (BLOCKY.has(tag)) pushNode("\\n", line, true);\n      if (VOID.has(tag)', "if (VOID.has(tag)"],
  ["design.mjs: a close block tag does not end a run of text", "lib/design.mjs", 'if (e.tag === "title") titleDepth--; }\n      if (BLOCKY.has(tag)) pushNode("\\n", line, true);', 'if (e.tag === "title") titleDepth--; }'],
  ["design.mjs: nothing closes by itself (li, p, option, td)", "lib/design.mjs", "if (closers) while (", "if (false) while ("],
  ["design.mjs: a block tag does not close an open p", "lib/design.mjs", 'const closers = P_CLOSERS.has(tag) ? ["p"] : IMPLIED[tag];', "const closers = IMPLIED[tag];"],
  ["design.mjs: an li does not close an open li", "lib/design.mjs", 'li: ["li", "p"],', 'li: ["p"],'],
  ["design.mjs: an option does not close an open option", "lib/design.mjs", 'option: ["option"],', "option: [],"],
  ["design.mjs: a td does not close an open td", "lib/design.mjs", 'td: ["td", "th", "p"], th:', 'td: ["p"], th:'],
  ["design.mjs: svg text is visible", "lib/design.mjs", String.raw`<(script|template|noscript|svg)\b`, String.raw`<(script|template|noscript)\b`],
  ["design.mjs: template text is visible", "lib/design.mjs", String.raw`<(script|template|noscript|svg)\b`, String.raw`<(script|noscript|svg)\b`],
  ["design.mjs: noscript text is visible", "lib/design.mjs", String.raw`<(script|template|noscript|svg)\b`, String.raw`<(script|template|svg)\b`],
  ["design.mjs: script text is visible", "lib/design.mjs", String.raw`<(script|template|noscript|svg)\b`, String.raw`<(template|noscript|svg)\b`],
  ["design.mjs: comments are visible", "lib/design.mjs", String.raw`let html = before0.replace(/<!--[\s\S]*?-->/g, (m) => " " + nl(m));`, "let html = before0;"],
  ["design.mjs: the head text is visible", "lib/design.mjs", "if (inHead || titleDepth > 0) continue;", "if (false) continue;"],
  ["design.mjs: a style block is not read", "lib/design.mjs", 'styleBlocks.push({ text: css, line: lineAt(beforeStyle, off + m.indexOf(">") + 1) });', 'styleBlocks.push({ text: "", line: 1 });'],
  ["design.mjs: a style block starts at line 1", "lib/design.mjs", "parsed: parseCss(b.text, b.line)", "parsed: parseCss(b.text, 1)"],
  ["design.mjs: a snapshot's linked stylesheet is read", "lib/design.mjs", 'if (site.mode !== "static") return null;', ""],
  ["design.mjs: a stylesheet on another host is read", "lib/design.mjs", String.raw`if (u.hostname !== "site.invalid" && !(site.hosts || []).map((x) => x.replace(/^www\./, "")).includes(u.hostname.replace(/^www\./, ""))) return null;`, ""],
  ["design.mjs: the site's own host is not recognised", "lib/design.mjs", 'if (u.hostname !== "site.invalid" && !(site.hosts || [])', 'if (u.hostname !== "site.invalid" && ![]'],
  ["design.mjs: rules inside @media are not read", "lib/design.mjs", '["media", "supports", "layer", "container", "document", "scope"].includes(name)', "false"],
  ["design.mjs: prefixed keyframes are not listed", "lib/design.mjs", String.raw`/keyframes$/.test(name)`, String.raw`/^keyframes$/.test(name)`],
  ["design.mjs: !important stays in the value", "lib/design.mjs", String.raw`.replace(/!\s*important/i, "")`, ""],
  ["design.mjs: a semicolon inside parentheses splits a declaration", "lib/design.mjs", 'if (ch === "(") depth++; else if (ch === ")") depth--;\n      if (ch === "{") {', 'if (ch === ")") depth--;\n      if (ch === "{") {'],
  ["design.mjs: a compound selector matches its first class", "lib/design.mjs", String.raw`/^\.(-?[_a-zA-Z][\w-]*)$/`, String.raw`/^\.(-?[_a-zA-Z][\w-]*)/`],
  ["design.mjs: the style attribute is not read", "lib/design.mjs", "if (el.attrs.style) for (const d of parseInlineStyle(el.attrs.style, el.line)) out.push(", "if (false) for (const d of parseInlineStyle(el.attrs.style, el.line)) out.push("],
  ["design.mjs: the first declaration wins, not the last", "lib/design.mjs", "return l.length ? l[l.length - 1] : null; };", "return l.length ? l[0] : null; };"],
  ["design.mjs: a colon inside brackets splits a Tailwind token", "lib/design.mjs", 'if (ch === "[") depth++; else if (ch === "]") depth--;', ""],
  ["design.mjs: a leading ! stays in the utility", "lib/design.mjs", String.raw`.replace(/^!/, "")`, ""],
  ["design.mjs: rem is read as px", "lib/design.mjs", 'return m[2] === "rem" ? n * 16 : n;', "return n;"],
  ["design.mjs: a line break in text is not a space", "lib/design.mjs", 'if (k > 0) s = " " + s;', ""],
  ["design.mjs: every line of a text node is reported on its first line", "lib/design.mjs", "pushNode(s, line + k)", "pushNode(s, line)"],
  // temp folders (slice 4b.1): these are seen by the check in test/run.mjs that runs this harness as a child on one mutant with a 2 s limit
  ["temp folders: mutate.mjs gives the child no temp base inside its copy", "test/mutate.mjs", "OMNIKOM_AUDIT_" + "TMP: tmpIn, TMPDIR: tmpIn, TEMP: tmpIn, TMP: tmpIn", ""],
  ["temp folders: mutate.mjs points the child's temp base at the shared base, not its copy", "test/mutate.mjs", "OMNIKOM_AUDIT_" + "TMP: tmpIn,", "OMNIKOM_AUDIT_" + "TMP: TMP_BASE,"],
  ["temp folders: mutate.mjs leaves its root behind at the end", "test/mutate.mjs", "removeRoot();\n" + "process.exit(survived", "process.exit(survived"],
  ["temp folders: run.mjs makes its folders beside its root, not inside it", "test/run.mjs", "const d = mkdtempSync(join(ROOT, p)); tmps.push(d);", "const d = mkdtempSync(join(TMP_BASE, p)); tmps.push(d);"],
  ["live.mjs: the time limit stops only the child, not its tree", "live.mjs", "const timer = setTimeout(() => { killTree(child); }, TIMEOUT_MS);", "const timer = setTimeout(() => { child.kill(); }, TIMEOUT_MS);"],
  // slice 4c: the noindex header and the build target. Each is seen by the checks added in test/run.mjs under "slice 4c".
  ["site.mjs: a value for another bot (bingbot:) counts as noindex", "lib/site.mjs", 'if (tok && (scope === null || scope === "googlebot")) out.push(tok);', "if (tok) out.push(tok);"],
  ["site.mjs: a googlebot-prefixed value does not count as noindex", "lib/site.mjs", 'if (tok && (scope === null || scope === "googlebot")) out.push(tok);', "if (tok && scope === null) out.push(tok);"],
  ["site.mjs: a bot name stops holding after its own first value", "lib/site.mjs", "{ scope = m[1]; tok = m[2].trim(); }", "{ scope = m[1]; tok = m[2].trim(); } else { scope = null; }"],
  ["site.mjs: unavailable_after is read as a bot name", "lib/site.mjs", "if (m && !ROBOTS_VALUE_DIRECTIVES.has(m[1])) {", "if (m) {"],
  ["site.mjs: none does not mean noindex", "lib/site.mjs", 'd === "noindex" || d === "none"', 'd === "noindex"'],
  ["site.mjs: several x-robots-tag lines are one value (a bot name holds across them)", "lib/site.mjs", "for (const line of Array.isArray(value) ? value : [value]) {", 'for (const line of [Array.isArray(value) ? value.join(",") : value]) {'],
  ["site.mjs: the x-robots-tag header name is case sensitive", "lib/site.mjs", 'k.toLowerCase() === "x-robots-tag"', 'k === "x-robots-tag"'],
  ["site.mjs: a snapshot page's header noindex is never read", "lib/site.mjs", "pg.headerNoindex = robotsNoindex(pg.headerRobots);", "pg.headerNoindex = false;"],
  ["site.mjs: a snapshot page's noindex is the meta reading only", "lib/site.mjs", "pg.noindex = pg.metaNoindex || pg.headerNoindex;", "pg.noindex = pg.metaNoindex;"],
  ["site.mjs: a snapshot page's robots is the meta reading only", "lib/site.mjs", 'pg.robots = [pg.metaRobots, ...pg.headerRobots].filter(Boolean).join(", ");', "pg.robots = pg.metaRobots;"],
  ["context.mjs: with no target a snapshot ignores the header noindex", "lib/context.mjs", 'const headerFeeds = site.target === "production" || (!site.target && snap);', 'const headerFeeds = site.target === "production";'],
  ["context.mjs: with no target a folder feeds the _headers noindex", "lib/context.mjs", 'const headerFeeds = site.target === "production" || (!site.target && snap);', 'const headerFeeds = site.target === "production" || !site.target;'],
  ["context.mjs: target preview feeds the header noindex into page.noindex", "lib/context.mjs", 'const headerFeeds = site.target === "production" || (!site.target && snap);', "const headerFeeds = !!site.target || snap;"],
  ["context.mjs: a meta robots noindex does not feed when the header does not", "lib/context.mjs", "p.noindex = p.metaNoindex || (headerFeeds && p.headerNoindex);", "p.noindex = headerFeeds && (p.metaNoindex || p.headerNoindex);"],
  ["context.mjs: the _headers file is not read", "lib/context.mjs", "site.headersFile = snap ? null : applyHeadersFile(site);", "site.headersFile = null;"],
  ["context.mjs: page.robots never takes the header", "lib/context.mjs", 'p.robots = [p.metaRobots, ...(headerFeeds ? p.headerRobots : [])].filter(Boolean).join(", ");', "p.robots = p.metaRobots;"],
  ["headers.mjs: a splat matches only within one path segment", "lib/headers.mjs", 'if (ch === "*") { re += ".*"; i++; continue; }', 'if (ch === "*") { re += "[^/]*"; i++; continue; }'],
  ["headers.mjs: a placeholder matches across path segments", "lib/headers.mjs", 'if (ph) { re += "[^/]+"; i += ph[0].length; continue; }', 'if (ph) { re += ".+"; i += ph[0].length; continue; }'],
  ["headers.mjs: a detach (! Name) takes nothing off", "lib/headers.mjs", "if (h.detach) lines = []; else lines.push(", "if (h.detach) { /* ignored */ } else lines.push("],
  ["headers.mjs: a pattern with two splats is matched anyway", "lib/headers.mjs", String.raw`if ((pattern.match(/\*/g) || []).length > 1) return null;`, ""],
  ["headers.mjs: a pattern that cannot be matched is not listed as not judged", "lib/headers.mjs", 'if (!compiled[i] && r.headers.some((h) => h.name === "x-robots-tag")) out.skipped.push(r.pattern);', "if (false) out.skipped.push(r.pattern);"],
  ["headers.mjs: a host pattern is compiled as a path pattern", "lib/headers.mjs", 'if (!pattern.startsWith("/")) return null;', ""],
  ["headers.mjs: foo.html is served at /foo.html", "lib/headers.mjs", String.raw`return p.replace(/\.html?$/i, "");`, "return p;"],
  ["headers.mjs: index.html is served at /index.html", "lib/headers.mjs", String.raw`if (/\/index\.html?$/i.test(p)) return p.replace(/index\.html?$/i, "");`, "if (false) return p;"],
  ["ENV-001: a preview page with no noindex passes", "checks/env-001.mjs", "if (p.metaNoindex || p.headerNoindex) continue;", "if (true) continue;"],
  ["ENV-001: a preview page's meta noindex is not accepted", "checks/env-001.mjs", "if (p.metaNoindex || p.headerNoindex) continue;", "if (p.headerNoindex) continue;"],
  ["ENV-001: a preview page's header noindex is not accepted", "checks/env-001.mjs", "if (p.metaNoindex || p.headerNoindex) continue;", "if (p.metaNoindex) continue;"],
  ["ENV-001: a production page with a header noindex passes", "checks/env-001.mjs", "} else if (p.headerNoindex) {", "} else if (false) {"],
  ["ENV-001: a production page with only a meta noindex fails", "checks/env-001.mjs", "} else if (p.headerNoindex) {", "} else if (p.noindex) {"],
  ["ENV-001: no target prints nothing (the SKIP no --target line is removed)", "checks/env-001.mjs", 'if (!site.target) return [f.skip("/", "no --target, so indexing is not judged (give --target preview|production)")];', "if (!site.target) return [];"],
  ["ENV-001: no target is judged as production", "checks/env-001.mjs", 'if (!site.target) return [f.skip("/", "no --target, so indexing is not judged (give --target preview|production)")];', 'if (!site.target) site.target = "production";'],
  ["ENV-001: no target is judged as preview", "checks/env-001.mjs", 'if (!site.target) return [f.skip("/", "no --target, so indexing is not judged (give --target preview|production)")];', 'if (!site.target) site.target = "preview";'],
  ["ENV-001: no target prints the SKIP as a second line (once per page)", "checks/env-001.mjs", 'if (!site.target) return [f.skip("/", "no --target, so indexing is not judged (give --target preview|production)")];', 'if (!site.target) return judged(site).map((p) => f.skip("/", "no --target, so the build\'s indexing is not judged"));'],
  ["ENV-001: with no target a PASS line is printed per page", "checks/env-001.mjs", "site.target ? judged(site).map((p) => p.path) : []", "judged(site).map((p) => p.path)"],
  ["ENV-001: the root 404.html is judged", "checks/env-001.mjs", 'site.pageList.filter((p) => !(site.mode === "static" && p.file === "404.html"))', "site.pageList"],
  ["ENV-001: the production finding does not name the _headers pattern and line", "checks/env-001.mjs", "${p.headerSource} puts noindex", "a header puts noindex"],
  ["ENV-001: the production finding does not name the target", "checks/env-001.mjs", "forbidden-value: target production, but", "forbidden-value: but"],
  ["ENV-001: the preview finding does not name the target", "checks/env-001.mjs", "missing-element: target preview, but the page", "missing-element: but the page"],
  ["index.mjs: any target word is accepted", "index.mjs", "!TARGETS.includes(options.target)) throw", "false) throw"],
  ["index.mjs: an empty-string target means no target", "index.mjs", "if (options.target !== undefined && options.target !== null && !TARGETS", "if (options.target && !TARGETS"],
  ["index.mjs: the target is not passed to the site", "index.mjs", "target: options.target || null, promptCoverage", "target: null, promptCoverage"],
  ["index.mjs: the switch refuses a snapshot with no target too", "index.mjs", 'if (REQUIRE_TARGET_FOR_FOLDER && site.mode === "static" && !site.target) throw', "if (REQUIRE_TARGET_FOR_FOLDER && !site.target) throw"],
  ["index.mjs: the switch is back to false (slice 4c flip; a folder with no target runs again)", "index.mjs", "export const REQUIRE_TARGET_FOR_FOLDER = true;", "export const REQUIRE_TARGET_FOR_FOLDER = false;"],
  ["index.mjs: the switch is ignored", "index.mjs", 'if (REQUIRE_TARGET_FOR_FOLDER && site.mode === "static" && !site.target) throw', 'if (false && site.mode === "static" && !site.target) throw'],
  ["index.mjs: the result does not say the target", "index.mjs", "mode: site.mode, target: site.target, pages:", "mode: site.mode, pages:"],
  ["run.mjs: --target is not passed to the engine", "run.mjs", "target: target || undefined", "target: undefined"],
  ["run.mjs: the runner accepts any --target value", "run.mjs", 'if (target !== "preview" && target !== "production") die(', "if (false) die("],
  ["live.mjs: --target is not passed to the engine", "live.mjs", "target: buildTarget || undefined", "target: undefined"],
  ["live.mjs: the driver accepts any --target value", "live.mjs", 'if (buildTarget !== "preview" && buildTarget !== "production") die(', "if (false) die("],
  // PMP-001 (slice 5c): the publish rule of the prompt map
  ["PMP-001: no coverage file prints nothing (the SKIP line is removed)", "checks/pmp-001.mjs", 'if (!cov) return [f.skip("/", "no --prompt-coverage, so the prompt map is not judged (give --prompt-coverage plan/prompt-coverage.json)")];', "if (!cov) return [];"],
  ["PMP-001: no coverage file also prints a PASS line per page", "checks/pmp-001.mjs", "export const subjects = (site) => (site.promptCoverage ?", "export const subjects = (site) => (!site.promptCoverage ? site.pageList.map((p) => p.path) : site.promptCoverage ?"],
  ["PMP-001: no coverage file is a FAIL, not a SKIP", "checks/pmp-001.mjs", 'if (!cov) return [f.skip("/", "no --prompt-coverage, so', 'if (!cov) return [f.fail("/", 1, "no --prompt-coverage, so'],
  ["PMP-001: a row with no page and no reason passes", "checks/pmp-001.mjs", "if (!row.reason.trim()) out.push(", "if (false) out.push("],
  ["PMP-001: a whitespace-only reason counts as a reason", "checks/pmp-001.mjs", "if (!row.reason.trim()) out.push(", "if (!row.reason) out.push("],
  ["PMP-001: a row with no page fails even with a written reason", "checks/pmp-001.mjs", "if (!row.reason.trim()) out.push(", "if (true) out.push("],
  ["PMP-001: a row whose page is not built passes", "checks/pmp-001.mjs", "} else if (!built.has(normPath(row.coveredBy))) {", "} else if (false) {"],
  ["PMP-001: a written reason excuses a page that is not built", "checks/pmp-001.mjs", "} else if (!built.has(normPath(row.coveredBy))) {", "} else if (!row.reason.trim() && !built.has(normPath(row.coveredBy))) {"],
  ["PMP-001: the page path is not normalised before it is compared", "checks/pmp-001.mjs", "} else if (!built.has(normPath(row.coveredBy))) {", "} else if (!built.has(row.coveredBy)) {"],
  ["PMP-001: the missing-page finding does not name the path", "checks/pmp-001.mjs", "but the build has no page at ${normPath(row.coveredBy)}`", "but the build has no page`"],
  ["PMP-001: the uncovered finding does not name the row id", "checks/pmp-001.mjs", "missing-element: row ${row.id} (${row.kind}) has no page", "missing-element: a row (${row.kind}) has no page"],
  ["PMP-001: a file with no rows prints no line", "checks/pmp-001.mjs", "site.promptCoverage.rows.length ? site.promptCoverage.rows.map((r) => r.id) : [\"/\"]", "site.promptCoverage.rows.map((r) => r.id)"],
  ["PMP-001: the source is not DECISIONS 35", "checks/pmp-001.mjs", 'export const source = "planning/DECISIONS.md 35 (the prompt map; owner, 2026-10-31)";', 'export const source = "planning/DECISIONS.md 36 (the prompt map; owner, 2026-10-31)";'],
  ["context.mjs: the coverage file is ignored", "lib/context.mjs", "site.promptCoverage = loadPromptCoverage(options.promptCoverage);", "site.promptCoverage = null;"],
  ["context.mjs: a coverage file that is not found is not an error", "lib/context.mjs", "if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw bad(", "if (false) throw bad("],
  ["context.mjs: a coverage file that is not JSON reads as no rows", "lib/context.mjs", "catch (e) { throw bad(`prompt coverage file ${file} is not valid JSON", "catch (e) { j = { rows: [] }; void (`prompt coverage file ${file} is not valid JSON"],
  ["context.mjs: a coverage file with the wrong top-level shape is accepted", "lib/context.mjs", '|| Array.isArray(j) || !Array.isArray(j.rows)) throw bad(', "|| false) throw bad("],
  ["context.mjs: a coverage row that is not an object is accepted", "lib/context.mjs", "if (!r || typeof r !== \"object\" || Array.isArray(r)) throw bad(", "if (false) throw bad("],
  ["context.mjs: a coverage row with no id is accepted", "lib/context.mjs", "if (typeof r.id !== \"string\" || !r.id.trim()) throw bad(", "if (false) throw bad("],
  ["context.mjs: a repeated row id is accepted", "lib/context.mjs", "if (seen.has(r.id)) throw bad(", "if (false) throw bad("],
  ["context.mjs: a coveredBy that is not a path or null is accepted", "lib/context.mjs", "if (r.coveredBy !== null && (typeof r.coveredBy !== \"string\" || !r.coveredBy.trim())) throw bad(", "if (false) throw bad("],
  ["context.mjs: a row kind that is not a string is accepted", "lib/context.mjs", "if (typeof r.kind !== \"string\") throw bad(", "if (false) throw bad("],
  ["context.mjs: a row reason that is not a string is accepted", "lib/context.mjs", "if (r.reason !== undefined && r.reason !== null && typeof r.reason !== \"string\") throw bad(", "if (false) throw bad("],
  ["index.mjs: the coverage file is not passed to the site", "index.mjs", "promptCoverage: options.promptCoverage || null }", "promptCoverage: null }"],
  ["run.mjs: --prompt-coverage is not passed to the engine", "run.mjs", "promptCoverage: promptCoverage || undefined", "promptCoverage: undefined"],
  ["run.mjs: --prompt-coverage with no value is accepted", "run.mjs", 'if (!promptCoverage || promptCoverage.startsWith("--")) die(', "if (false) die("],
  ["live.mjs: --prompt-coverage is not passed to the engine", "live.mjs", "promptCoverage: promptCoverage || undefined", "promptCoverage: undefined"],
  ["live.mjs: --prompt-coverage with no value is accepted", "live.mjs", 'promptCoverage = value(i, a); i++;', "promptCoverage = args[i + 1]; i++;"],
];
let survived = 0, missing = 0, notRun = 0;
const TMP_BASE = process.env.OMNIKOM_AUDIT_TMP ? resolve(process.env.OMNIKOM_AUDIT_TMP) : tmpdir();
mkdirSync(TMP_BASE, { recursive: true });
const ROOT = mkdtempSync(join(TMP_BASE, "omnikom-audit-mutate-"));
const kids = new Set();
const removeRoot = () => { try { rmSync(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (e) { console.error(`could not remove ${ROOT}: ${e.message}`); } };
const onSignal = (code) => { for (const k of kids) { try { k.kill("SIGKILL"); } catch {} } removeRoot(); process.exit(code); };
process.on("SIGINT", () => onSignal(130));
process.on("SIGTERM", () => onSignal(143));
// MUTATE_JOBS mutants run at the same time (default 4); each is its own copy in its own temp folder, so they cannot disturb each other.
const JOBS = Math.max(1, Number(process.env.MUTATE_JOBS) || 4);
function runOne([name, file, find, repl]) {
  return new Promise((done) => {
    const dir = mkdtempSync(join(ROOT, "mut-"));
    const finish = (line) => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (e) { console.error(`could not remove ${dir}: ${e.message}`); } console.log(line); done(); };
    try {
      for (const n of readdirSync(AUDIT)) if (n !== ".tmp") cpSync(join(AUDIT, n), join(dir, n), { recursive: true });
      const p = join(dir, file);
      const t = readFileSync(p, "utf8");
      const n = t.split(find).length - 1;
      if (n !== 1) { missing++; finish(`MISSING  ${name} (target text found ${n} times in ${file})`); return; }
      writeFileSync(p, t.split(find).join(repl), "utf8");
      const tmpIn = join(dir, ".tmp");
      const child = spawn(process.execPath, [join(dir, "test", "run.mjs")], { env: { ...process.env, OMNIKOM_AUDIT_DIR: dir, OMNIKOM_SKILL_DIR: SKILL, OMNIKOM_AUDIT_FAILFAST: "1", OMNIKOM_AUDIT_TMP: tmpIn, TMPDIR: tmpIn, TEMP: tmpIn, TMP: tmpIn }, timeout: (Number(process.env.MUTATE_TIMEOUT_S) || 180) * 1000, killSignal: "SIGKILL" });
      kids.add(child);
      let out = "", err = "";
      child.stdout.on("data", (c) => { out += c; });
      child.stderr.on("data", (c) => { err += c; });
      child.on("close", (status) => {
        kids.delete(child);
        // status null = the process was killed (the timeout, a laptop sleep): the suite did not finish, so this is neither a catch nor a survivor
        if (status === null) { notRun++; finish(`NOT RUN  ${name.padEnd(62)} (killed, exit null)`); return; }
        const red = (out.match(/^FAIL .*$/gm) || []).map((l) => l.slice(5, 75));
        const caught = status !== 0 && red.length > 0;
        if (!caught) survived++;
        finish(`${caught ? "caught  " : "SURVIVED"} ${name.padEnd(62)} ${caught ? `(${red.length} red: ${red[0]})` : `(exit ${status}, ${red.length} red${status !== 0 ? ": " + String(err || out).trim().split(/\r?\n/).pop().slice(0, 80) : ""})`}`);
      });
    } catch (e) { survived++; finish(`SURVIVED ${name} (the harness itself threw: ${String(e.message).slice(0, 120)})`); }
  });
}
// MUTATE_ONLY=<regex> runs only the mutants whose name matches (a re-run of a few); MUTATE_TIMEOUT_S raises the 180 s limit on a loaded machine
const PICK = process.env.MUTATE_ONLY ? MUTANTS.filter((m) => new RegExp(process.env.MUTATE_ONLY).test(m[0])) : [...MUTANTS];
// MUTATE_FIRST=<regex> starts the mutants whose name matches before the others (the order of the list is otherwise kept), so a new family shows its survivors first
if (process.env.MUTATE_FIRST) { const first = new RegExp(process.env.MUTATE_FIRST); PICK.sort((a, b) => Number(first.test(b[0])) - Number(first.test(a[0]))); }
let next = 0;
await Promise.all(Array.from({ length: JOBS }, async () => { while (next < PICK.length) await runOne(PICK[next++]); }));
console.log(`\n${PICK.length} mutants, ${PICK.length - survived - notRun - missing} caught, ${survived} survived, ${notRun} not run, ${missing} target text missing`);
removeRoot();
process.exit(survived || notRun || missing ? 1 : 0);
