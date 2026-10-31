// Watched-fail for tools/audit: a broken COPY of tools/audit with ONE rule or wall removed, test/run.mjs run against it
// (OMNIKOM_AUDIT_DIR), the suite must go red on a named check. Pattern of tools/departments/test/mutate.mjs:
// [name, file, exactText, replacement], applied with split/join to a temp copy, one child process per mutant (MUTATE_JOBS at a time, default 4), 180 s timeout.
// Caught = the suite exited nonzero AND printed at least one "FAIL" line. A crash or a timeout with no FAIL line is NOT a catch
// (it would hide a broken test), and target text that is not found exactly once is counted as "target text missing". A mutant whose process
// was killed (exit null: the timeout, a laptop sleep) is "NOT RUN", a third class that also makes the exit 1, so a killed run never reads as clean.
// Summary line: "N mutants, N caught, N survived, N not run, N target text missing".
//   node tools/audit/test/mutate.mjs      exit 0 = every mutant caught, none survived, none not run, none missing
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const AUDIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
  ["index.mjs: audit() ignores options.psi", "index.mjs", "buildSite(dir, config, { psi: options.psi })", "buildSite(dir, config, {})"],
  ["index.mjs: the speed numbers are not validated", "index.mjs", "|| !Number.isFinite(v) || v <= 0) throw new AuditError(`WCF-004: speed.", "|| false) throw new AuditError(`WCF-004: speed."],
  ["index.mjs: the default lcpMs is 2400", "index.mjs", "lcpMs: 2500,", "lcpMs: 2400,"],
  ["index.mjs: the default cls is 0.2", "index.mjs", "cls: 0.1,", "cls: 0.2,"],
  ["index.mjs: the default tbtMs is 300", "index.mjs", "tbtMs: 200,", "tbtMs: 300,"],
  ["index.mjs: the default ttfbMs is 700", "index.mjs", "ttfbMs: 600 }", "ttfbMs: 700 }"],
  ["run.mjs: --psi is ignored", "run.mjs", "engine.audit(folder, { rules: only || undefined, psi: psi || undefined })", "engine.audit(folder, { rules: only || undefined })"],
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
  ["live.mjs: --psi is not passed to the audit", "live.mjs", "engine.audit(dir, { rules: only || undefined, psi: psi || undefined })", "engine.audit(dir, { rules: only || undefined })"],
  ["live.mjs: --only is not passed to the audit", "live.mjs", "engine.audit(dir, { rules: only || undefined,", "engine.audit(dir, { rules: undefined,"],
  ["live.mjs: a url that is not http(s) is accepted", "live.mjs", "if (!url || !/^https?:\\/\\//i.test(url)) die(", "if (!url) die("],
  ["live.mjs: the (finished ...) suffix of a REUSE line stays in the folder name", "live.mjs", "(?: \\(finished [^)]*\\))?$/.exec(verdict)", "$/.exec(verdict)"],
];
let survived = 0, missing = 0, notRun = 0;
// MUTATE_JOBS mutants run at the same time (default 4); each is its own copy in its own temp folder, so they cannot disturb each other.
const JOBS = Math.max(1, Number(process.env.MUTATE_JOBS) || 4);
function runOne([name, file, find, repl]) {
  return new Promise((done) => {
    const dir = mkdtempSync(join(tmpdir(), "omnikom-audit-mut-"));
    const finish = (line) => { rmSync(dir, { recursive: true, force: true }); console.log(line); done(); };
    try {
      cpSync(AUDIT, dir, { recursive: true });
      const p = join(dir, file);
      const t = readFileSync(p, "utf8");
      const n = t.split(find).length - 1;
      if (n !== 1) { missing++; finish(`MISSING  ${name} (target text found ${n} times in ${file})`); return; }
      writeFileSync(p, t.split(find).join(repl), "utf8");
      const child = spawn(process.execPath, [join(dir, "test", "run.mjs")], { env: { ...process.env, OMNIKOM_AUDIT_DIR: dir }, timeout: (Number(process.env.MUTATE_TIMEOUT_S) || 180) * 1000 });
      let out = "", err = "";
      child.stdout.on("data", (c) => { out += c; });
      child.stderr.on("data", (c) => { err += c; });
      child.on("close", (status) => {
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
const PICK = process.env.MUTATE_ONLY ? MUTANTS.filter((m) => new RegExp(process.env.MUTATE_ONLY).test(m[0])) : MUTANTS;
let next = 0;
await Promise.all(Array.from({ length: JOBS }, async () => { while (next < PICK.length) await runOne(PICK[next++]); }));
console.log(`\n${PICK.length} mutants, ${PICK.length - survived - notRun - missing} caught, ${survived} survived, ${notRun} not run, ${missing} target text missing`);
process.exit(survived || notRun || missing ? 1 : 0);
