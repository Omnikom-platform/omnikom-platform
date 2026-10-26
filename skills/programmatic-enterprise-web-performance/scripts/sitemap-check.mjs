// Check the sitemap FILE (sitemap.xml, the file search engines read) of a live site against the approved PAGE PLAN (plan/sitemap.json,
// the blueprint of which pages should exist). Two different things; this script is the bridge (overhaul step 13, contract C9, gap G10).
// Usage: node sitemap-check.mjs <live url> --plan <approved/plan/sitemap.json> [--existing <existing-pages.json>] [--sitemap <url>] [--cwd DIR] [--today YYYY-MM-DD]
//        [--gap-ms 1000] [--max-urls 500] [--exclude "<regex>"]... [--dotenv FILE] [--contact TEXT]
// Reads robots.txt (obeyed: a sitemap URL that robots.txt forbids is a finding and is not fetched), the sitemap (index or urlset; .gz
// accepted; the URL defaults to the robots.txt `Sitemap:` line(s), else <origin>/sitemap.xml), then every URL in it politely: GET, honest
// user agent `pewp-sitemap-check (+contact)`, one request per --gap-ms (never below 1000 ms for a site this machine does not serve),
// every request bounded to 30 s, a redirect followed at most one hop (same site only) and reported. Rules, each a named finding:
//   SM-IN-PLAN          every sitemap URL is a page in the approved page plan, or a page the owner approved in the existing-pages list
//                       (--existing FILE, else <pewp>/approved/plan/existing-pages.json when it exists: { "note", "pages": [{ "path", "why" }] }; every
//                       entry needs a non-empty "why", else usage error exit 2). Those pages are NOT added to the plan and are not required in the
//                       file (no SM-COVERAGE); every other rule (200, noindex, canonical, lastmod, robots) still applies to them. An UNAPPROVED
//                       <pewp>/plan/existing-pages.json is never used: a NOTE says it exists and was ignored.
//   SM-PLAN-NOINDEX     a planned page marked indexable:false or noindex:true must NOT be in the sitemap
//   SM-200              every sitemap URL answers 200 directly (a redirect, a 404, an error is a FAIL)
//   SM-NOINDEX          no sitemap URL carries noindex (meta robots / googlebot, or the X-Robots-Tag header)
//   SM-CANONICAL        the canonical of each page is the page itself (a different one = FAIL); SM-CANONICAL-MISSING = WARN
//   SM-COVERAGE         every indexable planned page is in the sitemap
//   SM-ROBOTS           no sitemap URL is forbidden by robots.txt
//   SM-LASTMOD-MISSING  lastmod present on every URL (missing = WARN)
//   SE-004              lastmod never in the future, never date-only / without seconds and timezone (FAIL; same test as lib-freshness)
//   IDX-003             lastmod is not the build clock (FAIL): every URL shares one lastmod minute, OR 5+ URLs share one minute that lies within 10 min of the
//                       sitemap's Last-Modified header or of the fetch time. SM-SHARED-LASTMOD (WARN): 5+ pages share a minute far from both (batch edit or stamp? check by hand)
//   SM-DUPLICATE        the same URL twice (WARN);  SM-LIMIT  more URLs than --max-urls were fetched (WARN: the rest were judged on the sitemap alone)
//   SM-SITEMAP          the sitemap could not be read or holds no URL (FAIL; the other rules are not judged)
// The FIRST 429 stops the run (exit 3) and concludes nothing: a STOPPED check file is written so an older same-day PASS cannot be reused.
// Writes <pewp>/sitemap/check-<date>.json { generatedAt, sitemapUrl, sitemapUrls, urls, urlCount, pages, findings:[{ id, status, what, urls }], status }
// and check-<date>.md (plain words for the owner). First stdout line: `PASS sitemap: N urls, all in the page plan` or `FAIL <id> ...` lines.
// Exit 0 PASS (WARNs allowed), 1 FAIL, 2 usage / missing plan, 3 stopped at 429. Node built-ins only; read-only on the site.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { isMain } from "./lib-main.mjs";
import { locate } from "./state.mjs";
import { envFileArg, loadEnv, EnvFileError } from "./lib-env.mjs";
import { numArg, politeMs, UsageError, MIN_GAP_MS } from "./lib-polite.mjs";
import { parseSitemap, lastmodProblem } from "./lib-freshness.mjs";

const USAGE = "usage: node sitemap-check.mjs <live url> --plan <approved/plan/sitemap.json> [--existing <existing-pages.json>] [--sitemap <url>] [--cwd DIR] [--today YYYY-MM-DD] [--gap-ms 1000] [--max-urls 500] [--exclude <regex>]... [--dotenv FILE] [--contact TEXT]";
const VALUE_OPTS = new Set(["--plan", "--existing", "--sitemap", "--cwd", "--today", "--gap-ms", "--max-urls", "--exclude", "--dotenv", "--env-file", "--contact"]);
const TIMEOUT_MS = 30000;
const MAX_SITEMAP_FILES = 25;
const MAX_HTML = 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Stop429 extends Error { constructor(url) { super(`429 from ${url}`); this.url = url; } }

export function parseArgs(argv, valueOpts = VALUE_OPTS) {
  const pos = [], opts = {}, excludes = [];
  for (let i = 0; i < argv.length; i++) {
    let t = argv[i], inline = null;
    const eq = t.startsWith("--") ? t.indexOf("=") : -1;
    if (eq > 0) { inline = t.slice(eq + 1); t = t.slice(0, eq); }
    if (!t.startsWith("--")) { pos.push(t); continue; }
    if (t === "--help") { opts.help = true; continue; }
    if (!valueOpts.has(t)) throw new UsageError(`unknown option ${t}`);
    const v = inline ?? argv[++i];
    if (v === undefined || (inline === null && String(v).startsWith("--"))) throw new UsageError(`${t} needs a value`);
    if (t === "--exclude") excludes.push(v); else opts[t.slice(2)] = v;
  }
  return { pos, opts, excludes };
}

// robots.txt rules for user agent * (the same reading the snapshot uses)
export function parseRobots(txt) {
  const groups = [];
  let g = null;
  for (const line of txt.split(/\r?\n/)) {
    const m = line.replace(/#.*/, "").match(/^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), v = m[2];
    if (key === "user-agent") { if (!g || g.rules.length) { g = { agents: [], rules: [] }; groups.push(g); } g.agents.push(v.toLowerCase()); }
    else if ((key === "allow" || key === "disallow") && g) g.rules.push({ allow: key === "allow", path: v });
  }
  return { starRules: groups.filter((x) => x.agents.includes("*")).flatMap((x) => x.rules), sitemaps: [...txt.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]) };
}
export function robotsAllows(rules, p) {
  let best = null;
  for (const r of rules) {
    if (!r.path) continue;
    const re = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(p) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

// ---- reading one page ----
const attrOf = (tag, name) => (tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")) || []).slice(2).find((x) => x != null);
const NOINDEX = /(?:^|[\s,:])(?:noindex|none)(?:[\s,]|$)/i;
export function readPage(html, headers, url) {
  const out = { noindex: false, noindexBy: null, canonical: null };
  const xrt = headers["x-robots-tag"];
  if (xrt && NOINDEX.test(String(xrt))) { out.noindex = true; out.noindexBy = "X-Robots-Tag header"; }
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const name = (attrOf(m[0], "name") || "").toLowerCase();
    if ((name === "robots" || name === "googlebot") && NOINDEX.test(attrOf(m[0], "content") || "")) { out.noindex = true; out.noindexBy = out.noindexBy || `meta ${name}`; }
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    if (/\bcanonical\b/i.test(attrOf(m[0], "rel") || "")) {
      const href = attrOf(m[0], "href");
      if (href) { try { out.canonical = new URL(href.replace(/&amp;/g, "&"), url).href; } catch { out.canonical = href; } }
      break;
    }
  }
  return out;
}

// ---- URL keys ----
const strict = (u) => { try { const x = new URL(u); x.hash = ""; return x.href; } catch { return String(u); } };
// the comparison key for "is this the same page": host/scheme case-insensitive, no fragment, a trailing slash does not make a new page
export const pageKey = (u) => { try { const x = new URL(u); const p = x.pathname.length > 1 ? x.pathname.replace(/\/+$/, "") : x.pathname; return `${x.origin}${p}${x.search}`; } catch { return String(u); } };

// ---- the existing-pages list: pages that are on the site, are not planned for a search cluster, and may sit in the sitemap file ----
export function readExisting(file, origin) {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch (e) { throw new UsageError(`the existing-pages list ${file} cannot be read (${e.code || e.message})`); }
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.pages)) throw new UsageError(`${file} has no "pages" list: it is not an existing-pages list ({ "note": ..., "pages": [{ "path": "/about", "why": "..." }] })`);
  const bad = [], pages = [];
  doc.pages.forEach((p, i) => {
    if (!p || typeof p.path !== "string" || !p.path.trim()) { bad.push(`entry ${i + 1} has no path`); return; }
    if (typeof p.why !== "string" || !p.why.trim()) { bad.push(`${p.path} has no "why" (say in a sentence why this page may be offered to search engines)`); return; }
    let url; try { url = new URL(p.path.trim(), origin).href; } catch { bad.push(`${p.path} is not a valid path`); return; }
    pages.push({ path: p.path.trim(), why: p.why.trim(), url, key: pageKey(url) });
  });
  if (bad.length) throw new UsageError(`${file}: ${bad.slice(0, 5).join("; ")}${bad.length > 5 ? `; and ${bad.length - 5} more` : ""}`);
  return pages;
}

// ---- lastmod rules ----
export const BUILD_CLOCK_MIN_URLS = 5;
export const BUILD_CLOCK_WINDOW_MS = 60_000;
export const BUILD_CLOCK_NEAR_MS = 10 * 60_000;
export function buildClockCluster(entries, now = Date.now()) {
  const dated = entries.map((e) => ({ e, t: Date.parse(e.lastmod) })).filter((x) => x.e.lastmod && Number.isFinite(x.t) && x.t <= now + 86_400_000);
  if (!dated.length) return [];
  const newest = Math.max(...dated.map((x) => x.t));
  return dated.filter((x) => newest - x.t <= BUILD_CLOCK_WINDOW_MS).map((x) => x.e);
}

// ---- the findings (pure: rows in, findings out) ----
export function judge({ sitemapUrls, planPages, existingPages = [], existingFile = null, rows, fetchedCount, limit, now = Date.now(), lastModified = [] }) {
  const F = [];
  const add = (id, status, what, urls = [], extra = {}) => F.push({ id, status, what, urls: [...new Set(urls)], ...extra });
  const planKeys = new Map(planPages.map((p) => [p.key, p]));
  const smKeys = new Set(sitemapUrls.map((e) => pageKey(e.loc)));

  const existingKeys = new Set(existingPages.map((p) => p.key));
  const viaExisting = [...new Set(sitemapUrls.filter((e) => { const k = pageKey(e.loc); return !planKeys.has(k) && existingKeys.has(k); }).map((e) => e.loc))];
  const notInPlan = [...new Set(sitemapUrls.filter((e) => { const k = pageKey(e.loc); return !planKeys.has(k) && !existingKeys.has(k); }).map((e) => e.loc))];
  const viaWord = viaExisting.length ? ` (${viaExisting.length} of them by the approved existing-pages list ${existingFile})` : "";
  add("SM-IN-PLAN", notInPlan.length ? "FAIL" : "PASS", notInPlan.length ? `${notInPlan.length} URL(s) in the sitemap file are not pages of the approved page plan${existingFile ? " or of the existing-pages list" : ""}` : `every sitemap URL is a page of the approved page plan${viaWord}`, notInPlan,
    existingFile ? { existing: { file: existingFile, listed: existingPages.length, matched: viaExisting.length, urls: viaExisting } } : {});

  const plannedNoindex = sitemapUrls.filter((e) => { const p = planKeys.get(pageKey(e.loc)); return p && p.noindex; }).map((e) => e.loc);
  add("SM-PLAN-NOINDEX", plannedNoindex.length ? "FAIL" : "PASS", plannedNoindex.length ? `${plannedNoindex.length} page(s) the page plan says must not be indexed are in the sitemap file` : "no page marked not-indexable in the page plan is in the sitemap file", plannedNoindex);

  const notOk = rows.filter((r) => !r.skipped && (r.status !== 200 || r.error));
  add("SM-200", notOk.length ? "FAIL" : "PASS", notOk.length ? `${notOk.length} sitemap URL(s) do not answer 200 directly (${[...new Set(notOk.map((r) => r.error ? `error: ${r.error}` : r.redirectedTo ? `${r.status} redirect` : `HTTP ${r.status}`))].slice(0, 4).join(", ")})` : "every fetched sitemap URL answers 200 directly", notOk.map((r) => r.url));

  const noindexed = rows.filter((r) => r.status === 200 && r.noindex);
  add("SM-NOINDEX", noindexed.length ? "FAIL" : "PASS", noindexed.length ? `${noindexed.length} sitemap URL(s) tell search engines not to index them (noindex)` : "no sitemap URL carries noindex", noindexed.map((r) => r.url));

  const analysed = rows.filter((r) => r.status === 200 && r.html);
  const wrongCanon = analysed.filter((r) => r.canonical && strict(r.canonical) !== strict(r.url));
  add("SM-CANONICAL", wrongCanon.length ? "FAIL" : "PASS", wrongCanon.length ? `${wrongCanon.length} sitemap URL(s) name a different page as their canonical` : "every fetched page names itself as its canonical", wrongCanon.map((r) => r.url));
  const noCanon = analysed.filter((r) => !r.canonical);
  add("SM-CANONICAL-MISSING", noCanon.length ? "WARN" : "PASS", noCanon.length ? `${noCanon.length} sitemap URL(s) have no canonical link` : "every fetched page has a canonical link", noCanon.map((r) => r.url));

  const missing = [...planKeys.values()].filter((p) => !p.noindex && !smKeys.has(p.key)).map((p) => p.url);
  add("SM-COVERAGE", missing.length ? "FAIL" : "PASS", missing.length ? `${missing.length} indexable page(s) of the page plan are not in the sitemap file` : "every indexable page of the page plan is in the sitemap file", missing);

  const forbidden = rows.filter((r) => r.robotsBlocked);
  add("SM-ROBOTS", forbidden.length ? "FAIL" : "PASS", forbidden.length ? `${forbidden.length} sitemap URL(s) are forbidden by robots.txt (they were not fetched)` : "no sitemap URL is forbidden by robots.txt", forbidden.map((r) => r.url));

  const noMod = sitemapUrls.filter((e) => !e.lastmod || !String(e.lastmod).trim()).map((e) => e.loc);
  add("SM-LASTMOD-MISSING", noMod.length ? "WARN" : "PASS", noMod.length ? `${noMod.length} sitemap URL(s) have no lastmod date` : "every sitemap URL has a lastmod date", noMod);

  const badMod = sitemapUrls.filter((e) => e.lastmod && String(e.lastmod).trim()).map((e) => ({ e, why: lastmodProblem(e.lastmod, now) })).filter((x) => x.why);
  add("SE-004", badMod.length ? "FAIL" : "PASS", badMod.length ? `${badMod.length} lastmod value(s) are not a real full date and time (${[...new Set(badMod.map((x) => x.why))].slice(0, 4).join("; ")})` : "every lastmod is a full date and time with timezone, none in the future", badMod.map((x) => x.e.loc),
    { details: badMod.slice(0, 50).map((x) => ({ url: x.e.loc, lastmod: x.e.lastmod, why: x.why })) });

  // IDX-003 (the builtin's signature): FAIL when EVERY URL shares one lastmod minute, or when 5+ URLs share one minute AND that minute lies within
  // 10 min of the sitemap's own Last-Modified header or of the fetch time (the build clock stamp). 5+ pages sharing a minute far from both is a WARN.
  const cluster = buildClockCluster(sitemapUrls, now);
  const newest = cluster.length ? Math.max(...cluster.map((e) => Date.parse(e.lastmod))) : null;
  const allOne = sitemapUrls.length >= BUILD_CLOCK_MIN_URLS && cluster.length === sitemapUrls.length;
  const nearClock = newest != null && [now, ...lastModified].some((t) => Math.abs(newest - t) <= BUILD_CLOCK_NEAR_MS);
  const clock = allOne || (cluster.length >= BUILD_CLOCK_MIN_URLS && nearClock);
  add("IDX-003", clock ? "FAIL" : "PASS", clock ? `${cluster.length} URLs share one lastmod time (all within one minute of ${cluster.map((e) => e.lastmod).sort().pop()})${allOne ? ", every URL of the sitemap" : ", right at the time of the build / fetch"}: that is the clock of the build, not the date each page really changed` : "lastmod dates are not one build-clock time", clock ? cluster.map((e) => e.loc) : []);
  const shared = !clock && cluster.length >= BUILD_CLOCK_MIN_URLS;
  add("SM-SHARED-LASTMOD", shared ? "WARN" : "PASS", shared ? `${cluster.length} pages share one lastmod minute; real edits or a batch stamp? check by hand` : "no group of pages shares one lastmod minute", shared ? cluster.map((e) => e.loc) : []);

  const seen = new Set(), dup = [];
  for (const e of sitemapUrls) { const k = pageKey(e.loc); if (seen.has(k)) dup.push(e.loc); seen.add(k); }
  add("SM-DUPLICATE", dup.length ? "WARN" : "PASS", dup.length ? `${dup.length} URL(s) are listed more than once` : "no URL is listed twice", dup);

  const beyond = rows.filter((x) => /^beyond/.test(x.skipped || ""));
  add("SM-LIMIT", beyond.length ? "WARN" : "PASS", beyond.length ? `only the first ${fetchedCount} of ${rows.length} URLs were fetched (--max-urls ${limit}); the rest were judged on the sitemap file alone` : "every sitemap URL was looked at", beyond.map((x) => x.url));
  return F;
}

const PLAIN = {
  "SM-IN-PLAN": "These addresses are in the sitemap file but are not pages of the approved page plan or of the approved existing-pages list. Either the page should be in the plan, or (a page that already exists and is fine to offer, such as an about or legal page) it goes in the existing-pages list with a reason and is approved with the plan, or it should not be offered to search engines.",
  "SM-PLAN-NOINDEX": "The page plan says these pages must not appear in search, yet the sitemap file offers them.",
  "SM-200": "These addresses do not open directly. A sitemap file must list only addresses that answer with the page itself (not a redirect, not a missing page).",
  "SM-NOINDEX": "These pages tell search engines not to index them, yet the sitemap file asks search engines to index them. The two messages contradict each other.",
  "SM-CANONICAL": "These pages say another address is their main version, so search engines would ignore the address listed in the sitemap file.",
  "SM-CANONICAL-MISSING": "These pages do not name their main address. Not fatal, but a canonical link avoids duplicate-page confusion.",
  "SM-COVERAGE": "These pages are planned and should be found in search, but the sitemap file does not list them, so search engines learn about them only by chance.",
  "SM-ROBOTS": "robots.txt forbids these addresses while the sitemap file offers them. They were not opened.",
  "SM-LASTMOD-MISSING": "These addresses carry no last-changed date. Not fatal, but the date helps search engines decide when to come back.",
  "SE-004": "These last-changed dates are not a real full date and time (or are in the future). Search engines learn to ignore dates they cannot trust.",
  "IDX-003": "Many addresses carry the same last-changed time within one minute: that is the moment the site was built, not the day each page was edited. Search engines learn to ignore dates like that. Each page should carry the date its own content last changed.",
  "SM-DUPLICATE": "These addresses are listed more than once.",
  "SM-LIMIT": "To stay polite to the site, not every address was opened.",
  "SM-SITEMAP": "The sitemap file could not be read, so nothing else could be judged.",
};

export function renderMd(rep) {
  const L = [];
  const word = rep.status === "PASS" ? "PASSED" : rep.status === "FAIL" ? "FAILED" : "STOPPED";
  L.push(`# Sitemap file check: ${word}`, "", `Date: ${rep.date}. Site: ${rep.site}. Sitemap file read: ${rep.sitemapUrl}`, "",
    "This checks the sitemap file (sitemap.xml, the list search engines read), not the page plan (the approved blueprint of which pages should exist). Nothing is sent to Google or Bing until this check passes.", "");
  if (rep.status === "STOPPED") { L.push(`The site answered "too many requests" (429) at ${rep.stoppedAt}. The check stopped at once and concluded nothing. Wait, then run it again.`, ""); return L.join("\n") + "\n"; }
  L.push(`${rep.urlCount} address(es) in the sitemap file; ${rep.requests} request(s) made, one at a time with a pause between them.`, "");
  for (const n of rep.notes || []) L.push(`Note: ${n}`, "");
  if (rep.existing) L.push(`Existing-pages list: ${rep.existing.file} (${rep.existing.listed} page(s) approved for the sitemap file without being in the page plan). ${rep.existing.matched} address(es) of this sitemap file were matched by it: they count as planned for the plan rule, and still have to answer 200, be indexable, name themselves as canonical and carry a real lastmod.`, "");
  const bad = rep.findings.filter((f) => f.status !== "PASS");
  if (!bad.length) L.push("Every rule passed: every address in the sitemap file is a planned page, opens directly, can be indexed, names itself as its main version, every indexable planned page is listed, and the last-changed dates look real.", "");
  for (const f of bad) {
    L.push(`## ${f.status}: ${f.what} (${f.id})`, "", PLAIN[f.id] || "", "");
    for (const u of f.urls.slice(0, 50)) L.push(`- ${u}`);
    if (f.urls.length > 50) L.push(`- ... and ${f.urls.length - 50} more (all in the .json file)`);
    L.push("");
  }
  const ok = rep.findings.filter((f) => f.status === "PASS");
  if (ok.length) L.push("## Passed", "", ...ok.map((f) => `- ${f.what}`), "");
  L.push(rep.status === "PASS" ? "Next: the sitemap file may be submitted to Search Console and Bing (sitemap-submit.mjs)." : "Next: fix the items above in the site's own code, rebuild, deploy, and run this check again. Nothing is submitted before it passes.");
  return L.join("\n") + "\n";
}

// ---- the polite client ----
export function makeClient({ gapMs, ua }) {
  let last = 0, requests = 0;
  const log = [];
  async function get(url) {
    const wait = last + gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now(); requests++; log.push(last);
    let res;
    try { res = await fetch(url, { redirect: "manual", headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
    catch (e) { last = Date.now(); return { url, error: String(e.cause?.code || e.message || e).slice(0, 160) }; }
    if (res.status === 429) { await res.arrayBuffer().catch(() => {}); throw new Stop429(url); }
    let body = Buffer.alloc(0);
    try { body = Buffer.from(await res.arrayBuffer()); }
    catch (e) { last = Date.now(); return { url, status: res.status, headers: Object.fromEntries(res.headers.entries()), error: `body not received: ${String(e.cause?.code || e.message || e).slice(0, 120)}` }; }
    last = Date.now();
    return { url, status: res.status, headers: Object.fromEntries(res.headers.entries()), body };
  }
  return { get, get requests() { return requests; }, log };
}

async function readSitemaps(client, startUrls) {
  const entries = [], files = [], problems = [], lastModified = [];
  const queue = [...startUrls], seen = new Set();
  while (queue.length && seen.size < MAX_SITEMAP_FILES) {
    const u = queue.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    const r = await client.get(u);
    if (r.error || r.status !== 200) { problems.push(`${u}: ${r.error || `HTTP ${r.status}`}`); continue; }
    let xml;
    try { xml = r.body[0] === 0x1f && r.body[1] === 0x8b ? zlib.gunzipSync(r.body).toString("utf8") : r.body.toString("utf8"); }
    catch (e) { problems.push(`${u}: could not unpack (${String(e.message).slice(0, 80)})`); continue; }
    files.push(u);
    { const lm = Date.parse(r.headers["last-modified"] || ""); if (Number.isFinite(lm)) lastModified.push(lm); }
    const items = parseSitemap(xml);
    if (!items.length && !/<(urlset|sitemapindex)\b/i.test(xml)) problems.push(`${u}: not a sitemap (no urlset or sitemapindex)`);
    for (const it of items) {
      if (!it.loc) continue;
      if (it.kind === "sitemap") { let abs = it.loc; try { abs = new URL(it.loc, u).href; } catch {} queue.push(abs); }
      else entries.push({ loc: it.loc, lastmod: it.lastmod, file: u });
    }
  }
  return { entries, files, problems, lastModified };
}

export async function run(argv, out = (s) => console.log(s)) {
  let args;
  try { args = parseArgs(argv); } catch (e) { if (e instanceof UsageError) { console.error(`usage error: ${e.message}\n${USAGE}`); return 2; } throw e; }
  const { pos, opts, excludes } = args;
  if (opts.help) { out(USAGE); return 0; }
  if (pos.length !== 1 || !/^https?:\/\//i.test(pos[0])) { console.error(`usage error: give the live site address (http:// or https://)\n${USAGE}`); return 2; }
  if (!opts.plan) { console.error(`usage error: --plan <approved/plan/sitemap.json> is required (the page plan the sitemap file is checked against)\n${USAGE}`); return 2; }
  let gapMs, maxUrls, exclRes;
  const target = pos[0];
  const cwd = path.resolve(opts.cwd || process.cwd());
  try {
    gapMs = politeMs("--gap-ms", numArg("--gap-ms", opts["gap-ms"], { def: MIN_GAP_MS, min: 0 }), [target, opts.sitemap], MIN_GAP_MS);
    maxUrls = numArg("--max-urls", opts["max-urls"], { def: 500, min: 1, int: true });
    exclRes = excludes.map((e) => { try { return new RegExp(e); } catch { throw new UsageError(`--exclude is not a valid regular expression: ${e}`); } });
    if (opts.today && !/^\d{4}-\d{2}-\d{2}$/.test(opts.today)) throw new UsageError(`--today must be YYYY-MM-DD (got ${opts.today})`);
    if (opts.sitemap && !/^https?:\/\//i.test(opts.sitemap)) throw new UsageError("--sitemap must be a full address (http:// or https://)");
  } catch (e) { if (e instanceof UsageError) { console.error(`usage error: ${e.message}\n${USAGE}`); return 2; } throw e; }
  const planFile = path.resolve(cwd, opts.plan);
  let plan;
  try { plan = JSON.parse(fs.readFileSync(planFile, "utf8").replace(/^﻿/, "")); }
  catch (e) { console.error(`usage error: the page plan ${planFile} cannot be read (${e.code || e.message}). Plan the pages and get them approved first (plan-site.mjs, approve.mjs).`); return 2; }
  if (!plan || !Array.isArray(plan.pages) || !plan.pages.length) { console.error(`usage error: ${planFile} has no "pages" list: it is not a page plan`); return 2; }
  const loc = locate(target, { cwd });
  try { loadEnv({ envFile: envFileArg(argv), pewp: loc.pewp, cwd }); } catch (e) { if (e instanceof EnvFileError) { console.error(`usage error: ${e.message}`); return 2; } throw e; }

  const origin = new URL(target).origin;
  const notes = [];
  let existingPages = [], existingFile = null;
  try {
    if (opts.existing) existingFile = path.resolve(cwd, opts.existing);
    else {
      const approvedList = path.join(loc.pewp, "approved", "plan", "existing-pages.json");
      const workingList = path.join(loc.pewp, "plan", "existing-pages.json");
      if (fs.existsSync(approvedList)) existingFile = approvedList;
      else if (fs.existsSync(workingList)) notes.push(`${workingList} exists but is NOT approved (there is no approved/plan/existing-pages.json), so it was ignored. Approve the plan (approve.mjs <target> plan) to sign it, or pass --existing FILE.`);
    }
    if (existingFile) existingPages = readExisting(existingFile, origin);
  } catch (e) { if (e instanceof UsageError) { console.error(`usage error: ${e.message}\n${USAGE}`); return 2; } throw e; }
  const date = opts.today || new Date().toISOString().slice(0, 10);
  const ua = `pewp-sitemap-check (+${opts.contact || process.env.PEWP_CONTACT || "contact"})`;
  const planPages = plan.pages.filter((p) => p && typeof p.path === "string").map((p) => {
    const url = new URL(p.path, origin).href;
    return { url, key: pageKey(url), noindex: p.indexable === false || p.noindex === true };
  });
  const outDir = path.join(loc.pewp, "sitemap");
  const base = path.join(outDir, `check-${date}`);
  const client = makeClient({ gapMs, ua });
  const write = (rep) => {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(`${base}.json`, JSON.stringify(rep, null, 1) + "\n");
    fs.writeFileSync(`${base}.md`, renderMd(rep));
  };
  const rep = { generatedAt: new Date().toISOString(), date, site: origin + "/", plan: planFile, existingPages: existingFile, notes, sitemapUrl: null, sitemapUrls: [], urls: [], urlCount: 0, requests: 0, pages: [], findings: [], status: "FAIL" };
  try {
    // robots.txt
    const rob = await client.get(`${origin}/robots.txt`);
    let robots = { starRules: [], sitemaps: [] };
    if (rob.error || rob.status >= 500) {
      rep.findings = [{ id: "SM-SITEMAP", status: "FAIL", what: `robots.txt could not be read (${rob.error || `HTTP ${rob.status}`}); with no readable robots.txt nothing was fetched`, urls: [`${origin}/robots.txt`] }];
      rep.requests = client.requests; write(rep);
      out(`FAIL SM-SITEMAP ${rep.findings[0].what}`); out(`sitemap: wrote ${base}.json`); return 1;
    }
    if (rob.status === 200) robots = parseRobots(rob.body.toString("utf8"));
    const startUrls = opts.sitemap ? [opts.sitemap] : robots.sitemaps.length ? robots.sitemaps : [`${origin}/sitemap.xml`];
    const sm = await readSitemaps(client, startUrls);
    rep.sitemapUrl = startUrls[0]; rep.sitemapUrls = [...new Set([...startUrls, ...sm.files])];
    if (!sm.entries.length || sm.problems.length && !sm.files.length) {
      const what = sm.problems.length ? `the sitemap file could not be read: ${sm.problems.slice(0, 3).join("; ")}` : "the sitemap file holds no URL";
      rep.findings = [{ id: "SM-SITEMAP", status: "FAIL", what, urls: startUrls }];
      rep.requests = client.requests; write(rep);
      out(`FAIL SM-SITEMAP ${what}`); out(`sitemap: wrote ${base}.json`); return 1;
    }
    // every URL, politely
    const unique = [];
    const seenLoc = new Set();
    for (const e of sm.entries) if (!seenLoc.has(e.loc)) { seenLoc.add(e.loc); unique.push(e); }
    const rows = [];
    let fetched = 0;
    for (const e of unique) {
      const row = { url: e.loc, lastmod: e.lastmod ?? null };
      let u; try { u = new URL(e.loc); } catch { row.skipped = "not a valid address"; row.status = null; rows.push(row); continue; }
      if (exclRes.some((re) => re.test(u.pathname))) { row.skipped = "excluded by --exclude"; rows.push(row); continue; }
      if (u.origin.toLowerCase() !== origin.toLowerCase()) { row.skipped = "another site (not fetched)"; rows.push(row); continue; }
      if (!robotsAllows(robots.starRules, u.pathname + u.search)) { row.robotsBlocked = true; row.skipped = "forbidden by robots.txt"; rows.push(row); continue; }
      if (fetched >= maxUrls) { row.skipped = `beyond --max-urls ${maxUrls}`; rows.push(row); continue; }
      fetched++;
      let r = await client.get(e.loc);
      row.status = r.status ?? null;
      if (r.error) row.error = r.error;
      if (r.status >= 300 && r.status < 400) {
        const to = r.headers.location ? (() => { try { return new URL(r.headers.location, e.loc).href; } catch { return r.headers.location; } })() : null;
        row.redirectedTo = to;
        if (to && /^https?:/i.test(to) && new URL(to).origin.toLowerCase() === origin.toLowerCase()) {
          const hop = await client.get(to); // at most one hop, reported
          row.redirectFinalStatus = hop.status ?? hop.error ?? null;
        }
      } else if (r.status === 200 && r.body) {
        const html = /html|^$/i.test(r.headers["content-type"] || "") ? r.body.subarray(0, MAX_HTML).toString("utf8") : "";
        Object.assign(row, readPage(html, r.headers, e.loc), { html: !!html });
      }
      rows.push(row);
    }
    const findings = judge({ sitemapUrls: sm.entries, planPages, existingPages, existingFile, rows, fetchedCount: fetched, limit: maxUrls, lastModified: sm.lastModified });
    rep.findings = findings;
    { const x = (findings.find((f) => f.id === "SM-IN-PLAN") || {}).existing; if (x) rep.existing = x; }
    rep.urls = unique.map((e) => e.loc); rep.urlCount = unique.length; rep.requests = client.requests;
    rep.pages = rows.map(({ url, lastmod, status, error, skipped, robotsBlocked, redirectedTo, redirectFinalStatus, noindex, noindexBy, canonical }) => ({ url, lastmod, status: status ?? null, ...(error ? { error } : {}), ...(skipped ? { skipped } : {}), ...(robotsBlocked ? { robotsBlocked } : {}), ...(redirectedTo !== undefined ? { redirectedTo, redirectFinalStatus: redirectFinalStatus ?? null } : {}), ...(noindex ? { noindex, noindexBy } : {}), ...(canonical ? { canonical } : {}) }));
    const fails = findings.filter((f) => f.status === "FAIL");
    rep.status = fails.length ? "FAIL" : "PASS";
    write(rep);
    for (const n of notes) out(`NOTE ${n}`);
    if (!fails.length) out(`PASS sitemap: ${rep.urlCount} urls, all in the page plan${rep.existing && rep.existing.matched ? ` (${rep.existing.matched} by the existing-pages list ${rep.existing.file})` : ""}`);
    for (const f of fails) out(`FAIL ${f.id} ${f.what}${f.urls.length ? ` (e.g. ${f.urls.slice(0, 3).join(", ")}${f.urls.length > 3 ? ", ..." : ""})` : ""}`);
    for (const f of findings.filter((x) => x.status === "WARN")) out(`WARN ${f.id} ${f.what}`);
    out(`sitemap: ${rep.urlCount} urls, ${rep.requests} request(s); wrote ${base}.json and ${base}.md`);
    return fails.length ? 1 : 0;
  } catch (e) {
    if (e instanceof Stop429) {
      rep.status = "STOPPED"; rep.stoppedAt = e.url; rep.requests = client.requests; rep.findings = [];
      write(rep);
      out(`STOP 429 ${e.url}: the site asked us to slow down; the check stopped at the first 429 and concluded nothing (exit 3). Wait, then run it again.`);
      out(`sitemap: wrote ${base}.json`);
      return 3;
    }
    throw e;
  }
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(`ERROR sitemap-check crashed: ${String(e && e.stack || e).slice(0, 600)}`); process.exit(1); });
}
