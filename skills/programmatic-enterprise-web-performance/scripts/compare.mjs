// Usage: node compare.mjs <a> <b> [--cwd DIR] [--launch-state-a live|preview] [--launch-state-b live|preview] [--refresh] [--strict] [-- <snapshot-site options>]
// Old vs new site, or us vs a competitor, side by side. <a> and <b> are each a live URL or a repo folder.
//   URL side  -> its newest COMPLETE snapshot under <cwd>/site-checks/<host>/snapshots/ (what live-target.mjs REUSE returns) and the
//                checker's <snapshot>/.checks/causes.json; authority / research / measure from <cwd>/site-checks/<host>/.pewp/ when present.
//                Reading is the default: compare never crawls on its own. --refresh runs live-target.mjs first (it reuses a snapshot
//                younger than 7 days, else takes one; options after -- go to snapshot-site.mjs).
//   repo side -> its .checks/causes.json, its robots.txt, and its built HTML when the folder holds any. A repo has no measured speed.
// Writes <cwd>/site-checks/compare-<hostA>-vs-<hostB>/compare.md and compare.json. Every number is {value, source, fetchedAt, cacheFile}.
// A launch state of "preview" (--launch-state-b, or business.json) makes noindex, a blocking robots.txt, no links and no AI citations
// "by design", never a defect. Snapshots taken with different options (runs, pages, phone conditions, dates) produce warnings; --strict
// turns any warning into exit 1. Exit 0 ok, 1 a side cannot be read (or strict warnings), 2 usage.
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { locate, isUrl } from "./state.mjs";
import { latestComplete } from "./live-target.mjs";
import { fact } from "./cache.mjs";
import { loadSite, normPath } from "./lib-site.mjs";
import { overlap, THRESHOLD } from "./lib-text.mjs";
import { freshnessAcrossSnapshots } from "./lib-freshness.mjs";
import { stripBom } from "./measure-sources.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "ClaudeBot", "Claude-SearchBot", "Google-Extended", "CCBot", "Applebot-Extended", "Bingbot", "Googlebot"];
const SEV = ["critical", "high", "medium", "low"];
const J = (p) => { try { return JSON.parse(stripBom(fs.readFileSync(p, "utf8"))); } catch { return null; } };
const med = (xs) => { const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((x, y) => x - y); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
const dayOf = (iso) => String(iso || "").slice(0, 10);
const s = (n) => (n === 1 ? "" : "s");
const sec = (ms) => (ms == null ? "n/a" : `${(ms / 1000).toFixed(1)} s`);

// robots.txt text -> the { groups:[{agents:[lowercase], rules:[{allow, path}]}] } shape the snapshot stores
export function parseRobotsTxt(text) {
  const groups = []; let cur = null, lastWasAgent = false;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (cur && (k === "allow" || k === "disallow")) cur.rules.push({ allow: k === "allow", path: v });
  }
  return { status: 200, groups };
}
// Can this agent read the site root? (the most specific group wins; "/" or "/*" disallow blocks it)
export function allowedRoot(robots, agent) {
  const groups = robots.groups || [];
  const g = groups.filter((x) => x.agents.includes(agent.toLowerCase()));
  const rules = (g.length ? g : groups.filter((x) => x.agents.includes("*"))).flatMap((x) => x.rules);
  const hit = rules.filter((r) => r.path && "/".startsWith(r.path.replace(/\*.*$/, "")) && (r.path === "/" || r.path === "/*")).sort((x, y) => (y.allow === true) - (x.allow === true));
  return !hit.length || hit[0].allow;
}

function readSide(target, role, o) {
  const loc = locate(target, { cwd: o.cwd });
  const rel = (p) => { const r = path.relative(o.cwd, p); return (r.startsWith("..") || path.isAbsolute(r) ? path.resolve(p) : r).split(path.sep).join("/"); };
  const side = { role, target: loc.target, kind: loc.kind, host: loc.kind === "url" ? loc.host : path.basename(loc.root), loc, rel, errors: [] };
  const business = J(path.join(loc.pewp, "business.json")) || {};
  side.business = business;
  side.launchState = o.launch || business.launchState || "live";
  side.authFile = path.join(loc.pewp, "authority.json");
  if (loc.kind === "url") {
    const snap = latestComplete(loc.snapshots);
    if (!snap) { side.errors.push(`no complete snapshot for ${loc.host}: run live-target.mjs ${loc.target} first (compare reads snapshots, it does not crawl; --refresh takes one)`); return side; }
    side.snapDir = snap.dir; side.site = snap.site; side.at = snap.site.finishedAt;
    side.causesFile = path.join(snap.dir, ".checks", "causes.json");
    side.robotsFile = path.join(snap.dir, "site/robots.json");
    side.robots = J(side.robotsFile);
    side.pages = (snap.site.pages || []).filter((p) => p.status === 200).map((p) => ({ ...p, b: J(path.join(snap.dir, "pages", p.slug, "browser-mobile.json")), path: (() => { try { return normPath(new URL(p.finalUrl || p.url).pathname); } catch { return null; } })() }));
    side.pagesDir = path.join(snap.dir, "pages");
  } else {
    if (!fs.existsSync(loc.root)) { side.errors.push(`repo folder not found: ${loc.root}`); return side; }
    side.causesFile = path.join(loc.root, ".checks", "causes.json");
    side.at = (J(path.join(loc.root, ".checks", "plan.json"))?.createdAt) || (fs.existsSync(side.causesFile) ? fs.statSync(side.causesFile).mtime.toISOString() : new Date().toISOString());
    for (const d of ["", "public", "dist", "build", "out", "static", "_site"]) { const f = path.join(loc.root, d, "robots.txt"); if (fs.existsSync(f)) { side.robotsFile = f; side.robots = parseRobotsTxt(fs.readFileSync(f, "utf8")); break; } }
    side.pages = [];
  }
  side.causes = J(side.causesFile);
  side.causesAt = J(path.join(path.dirname(side.causesFile), "plan.json"))?.createdAt || side.at;
  side.sources = { targets: path.join(loc.pewp, "targets.json"), ai: path.join(loc.pewp, "research", "ai-citations.json") };
  return side;
}

// ---------- metrics of one side: every value a sourced number ----------
function metricsOf(side) {
  const m = {}, rel = side.rel, at = side.at;
  const NM = (why) => fact(null, `NOT MEASURED: ${why}`, at, side.causesFile ? rel(side.causesFile) : rel(side.loc.root));
  if (side.kind === "url") {
    const pg = side.pages, measured = pg.filter((p) => p.b?.vitals?.lcpMs != null);
    const runs = side.site.runs || 1;
    const cond = `${measured.length} pages, real Chrome, phone, slow 4G, 4x CPU, median of ${runs} run${s(runs)} each (snapshot ${path.basename(side.snapDir)})`;
    const dir = rel(side.pagesDir);
    const wp = (k) => measured.reduce((w, p) => (!w || (p.b.vitals[k] ?? -1) > (w.b.vitals[k] ?? -1) ? p : w), null);
    m.lcp = measured.length ? fact(Math.round(med(measured.map((p) => p.b.vitals.lcpMs))), cond, at, dir) : NM("no page was measured in the snapshot");
    m.lcpWorst = measured.length ? fact(Math.round(wp("lcpMs").b.vitals.lcpMs), `${wp("lcpMs").url}, ${cond}`, wp("lcpMs").b.measuredAt || at, rel(path.join(side.pagesDir, wp("lcpMs").slug, "browser-mobile.json"))) : NM("no page was measured");
    m.tbt = measured.length ? fact(med(measured.map((p) => p.b.vitals.tbtMs)), cond, at, dir) : NM("no page was measured");
    m.cls = measured.length ? fact(Number((wp("cls").b.vitals.cls || 0).toFixed(3)), `worst page ${wp("cls").url}, ${cond}`, wp("cls").b.measuredAt || at, rel(path.join(side.pagesDir, wp("cls").slug, "browser-mobile.json"))) : NM("no page was measured");
    const withBytes = measured.filter((p) => p.b.totals?.bytes != null);
    m.kb = withBytes.length ? fact(Math.round(med(withBytes.map((p) => p.b.totals.bytes)) / 1024), `median page weight over ${withBytes.length} pages (everything the phone downloads), ${cond}`, at, dir) : NM("no page weight in the snapshot");
    const heavy = withBytes.reduce((w, p) => (!w || p.b.totals.bytes > w.b.totals.bytes ? p : w), null);
    m.kbHeaviest = heavy ? fact(Math.round(heavy.b.totals.bytes / 1024), `${heavy.url}, ${cond}`, heavy.b.measuredAt || at, rel(path.join(side.pagesDir, heavy.slug, "browser-mobile.json"))) : NM("no page weight in the snapshot");
    m.requests = withBytes.length ? fact(Math.round(med(withBytes.map((p) => p.b.totals.requests))), `median requests per page, ${cond}`, at, dir) : NM("no request counts in the snapshot");
    const bp = pg.filter((p) => p.b);
    const withLd = bp.filter((p) => (p.b.page?.structuredData || []).length);
    m.ldPct = bp.length ? fact(Math.round((withLd.length / bp.length) * 100), `${withLd.length} of ${bp.length} rendered pages carry JSON-LD structured data (snapshot ${path.basename(side.snapDir)})`, at, dir, { counts: { with: withLd.length, of: bp.length } }) : NM("no rendered page in the snapshot");
    m.ldTypes = bp.length ? fact([...new Set(bp.flatMap((p) => (p.b.page?.structuredData || []).flatMap((x) => x.types || [])))].sort(), `schema types found in the rendered pages (snapshot ${path.basename(side.snapDir)})`, at, dir) : NM("no rendered page in the snapshot");
    const noidx = bp.filter((p) => (p.b.page?.robotsMeta || []).some((x) => /noindex/i.test(x)));
    m.noindex = bp.length ? fact(noidx.length, `rendered pages carrying a noindex robots tag (snapshot ${path.basename(side.snapDir)})`, at, dir, { byDesign: side.launchState === "preview" }) : NM("no rendered page in the snapshot");
  } else {
    const nm = "a repo has no running site: audit its preview or live URL for speed and weight";
    for (const k of ["lcp", "lcpWorst", "tbt", "cls", "kb", "kbHeaviest", "requests"]) m[k] = NM(nm);
    let ld = null;
    try { ld = loadSite(side.loc.root); } catch {}
    const pgs = ld ? [...ld.pages.values()] : [];
    if (pgs.length) {
      const withLd = pgs.filter((p) => (p.jsonld || []).some((j) => j.parsed));
      m.ldPct = fact(Math.round((withLd.length / pgs.length) * 100), `${withLd.length} of ${pgs.length} built HTML pages in the repo carry JSON-LD`, at, side.rel(side.loc.root), { counts: { with: withLd.length, of: pgs.length } });
      const types = new Set(); const walk = (o) => { if (!o || typeof o !== "object") return; if (Array.isArray(o)) return o.forEach(walk); if (o["@type"]) [].concat(o["@type"]).forEach((t) => types.add(t)); walk(o["@graph"]); };
      pgs.forEach((p) => (p.jsonld || []).forEach((j) => walk(j.parsed)));
      m.ldTypes = fact([...types].sort(), "schema types in the repo's built HTML", at, side.rel(side.loc.root));
      m.noindex = fact(pgs.filter((p) => p.noindex).length, "built HTML pages with a noindex robots tag", at, side.rel(side.loc.root), { byDesign: side.launchState === "preview" });
    } else { m.ldPct = NM("the repo holds no built HTML (build it, or audit the deployed URL)"); m.ldTypes = m.ldPct; m.noindex = m.ldPct; }
  }
  // root causes by severity
  if (side.causes) {
    const c = (sv) => side.causes.filter((x) => x.severity === sv).length;
    for (const sv of SEV) m[sv] = fact(c(sv), `the checker's root causes (${side.kind === "url" ? `snapshot ${path.basename(side.snapDir)}` : "repo .checks"})`, side.causesAt, side.rel(side.causesFile));
    m.causes = fact(side.causes.length, "the checker's root causes, all severities", side.causesAt, side.rel(side.causesFile));
  } else for (const k of [...SEV, "causes"]) m[k] = fact(null, `NOT CHECKED: no .checks/causes.json for ${side.host}; run the checker on ${side.kind === "url" ? "the snapshot folder" : "the repo"}`, at, side.rel(side.causesFile));
  // AI crawler access
  if (side.robots) {
    const blocked = AI_BOTS.filter((b) => !allowedRoot(side.robots, b));
    m.aiBlocked = fact(blocked, `robots.txt of ${side.host} (${side.rel(side.robotsFile)}): crawlers it refuses at the site root, from ${AI_BOTS.length} checked`, at, side.rel(side.robotsFile), { byDesign: side.launchState === "preview" && blocked.length === AI_BOTS.length });
  } else m.aiBlocked = fact(null, `NOT FOUND: no robots.txt for ${side.host}`, at, side.rel(side.loc.root));
  return m;
}

const NOT_FOUND = "not found in the link data"; // the Common Crawl graph does not hold the site: that is not a count of 0

function authorityOf(side, other) {
  for (const holder of [side, other]) {
    const f = holder.authFile, a = J(f);
    const r = a?.results?.find((x) => String(x.domain).replace(/^www\./, "") === side.host);
    if (r) {
      const via = holder === side ? "" : ` (found in ${holder.host}'s authority run)`;
      const src = `${a.source}${via}`;
      // a site the graph does not hold has no count: null (never 0), flagged so the table says "not found in the link data"; nothing is computed with it
      const notIn = r.inGraph ? {} : { notInGraph: true };
      return { referring: fact(r.inGraph ? r.linkingDomains : null, `${src}${r.inGraph ? "" : `; ${NOT_FOUND}`}`, a.fetchedAt, side.rel(f), { byDesign: side.launchState === "preview", ...notIn }), strength: fact(r.inGraph ? (r.harmonicPos ?? null) : null, `${src}: harmonic-centrality rank, 1 = strongest`, a.fetchedAt, side.rel(f), notIn) };
    }
  }
  const nm = fact(null, `NOT MEASURED: run authority.mjs --target ${side.host} (free, reads the Common Crawl graph on disk)`, side.at, side.rel(side.authFile));
  return { referring: nm, strength: nm };
}

// researched searches that have a page on this side, and AI answers that cite it
function researchOf(side, targetsFile, targets) {
  const out = {};
  if (targets?.clusters?.length && (side.kind === "url" || side.kind === "repo")) {
    let sm = null;
    try { sm = loadSite(side.kind === "url" ? side.snapDir : side.loc.root); } catch {}
    if (sm && sm.pages.size) {
      const pages = [...sm.pages.values()].filter((p) => p.status === 200);
      const have = targets.clusters.filter((c) => pages.some((p) => Math.min(overlap(c.primaryQuery, p.title), overlap(c.primaryQuery, p.h1[0] || "")) >= THRESHOLD));
      out.searchesWithPage = fact(have.length, `of ${targets.clusters.length} researched searches, those where a page's title and main heading carry >= 80% of the search words (targets.json ${dayOf(targets.createdAt)}, pages of ${side.host})`, targets.createdAt || side.at, side.rel(targetsFile), { of: targets.clusters.length });
    }
  }
  const ai = J(side.sources.ai);
  const measureDirs = fs.existsSync(path.join(side.loc.pewp, "measure")) ? fs.readdirSync(path.join(side.loc.pewp, "measure")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse() : [];
  const cm = measureDirs.length ? J(path.join(side.loc.pewp, "measure", measureDirs[0], "citations.json")) : null;
  const rows = [...(cm?.citations || []), ...(ai?.rows || [])];
  if (rows.length) {
    const runs = (r) => Math.max(1, Number(r.runs) || 1), total = rows.reduce((n, r) => n + runs(r), 0);
    const share = rows.reduce((n, r) => n + (Number(r.citedShare?.value) || 0) * runs(r), 0) / total;
    const file = cm?.citations?.length ? path.join(side.loc.pewp, "measure", measureDirs[0], "citations.json") : side.sources.ai;
    out.aiCited = fact(Number(share.toFixed(3)), `share of ${total} AI answers (${rows.length} question x engine rows) that cite ${side.host}; weighted by how often each was asked`, ai?.generatedAt || cm?.date || side.at, side.rel(file), { estimate: true });
  }
  return out;
}

// ---------- compare ----------
const GLOSSARY = {
  LCP: "how long a phone takes to show the biggest thing on the screen; Google wants under 2.5 seconds",
  TBT: "how long the phone is too busy to react to taps while the page loads; under 0.2 seconds is good",
  CLS: "how much the page jumps around while loading; under 0.1 is good",
  "structured data": "hidden labels that tell search engines what a page is (a business, an article, a listing)",
  "AI crawler": "the robots ChatGPT, Perplexity, Google and others use to read sites for their answers",
  "referring domain": "another website that links to this one; more and stronger ones help a site rank",
  "root cause": "one underlying problem, often in a template, that shows up on many pages",
  noindex: "a tag that asks search engines to leave a page out of their results",
  "robots.txt": "a small file that tells search engines and AI crawlers which pages they may read",
};
const rulesKey = (c) => (c.rules && c.rules.length ? c.rules : [`problem:${String(c.problem || c.id).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60)}`]);
const plainProblem = (p) => String(p).replace(/^[A-Z]{2,5}-\d+:\s*/, "").replace(/\s+/g, " ").slice(0, 160);
const sevRank = (x) => { const i = SEV.indexOf(x.severity); return i < 0 ? 9 : i; };

export function compare(A, B, o) {
  const warnings = [];
  const warn = (code, text, level = "warn") => warnings.push({ code, level, text });
  const mA = metricsOf(A), mB = metricsOf(B);
  const authA = authorityOf(A, B), authB = authorityOf(B, A);
  mA.referring = authA.referring; mA.strength = authA.strength; mB.referring = authB.referring; mB.strength = authB.strength;
  // research: one targets.json, from the side that has it (A first)
  const tSide = [A, B].find((x) => J(x.sources.targets)?.clusters?.length);
  const targets = tSide ? J(tSide.sources.targets) : null;
  const rA = researchOf(A, tSide?.sources.targets, targets), rB = researchOf(B, tSide?.sources.targets, targets);
  if (tSide && (rA.searchesWithPage || rB.searchesWithPage)) warn("targets-shared", `The researched searches come from ${tSide.host}'s targets.json and are matched against both sides' pages.`, "info");
  // same options?
  const sa = A.site, sb = B.site;
  if (sa && sb) {
    if ((sa.runs || 1) !== (sb.runs || 1)) warn("runs", `Speed was measured with ${sa.runs || 1} run${s(sa.runs || 1)} per page on ${A.host} but ${sb.runs || 1} on ${B.host}: the medians are not comparable. Re-take one snapshot with the same --runs.`);
    if (sa.maxPages != null && sb.maxPages != null && sa.maxPages !== sb.maxPages) warn("max-pages", `The page limit differed (${sa.maxPages} vs ${sb.maxPages}).`);
    const na = A.pages.length, nb = B.pages.length;
    if (Math.abs(na - nb) > Math.max(2, 0.25 * Math.max(na, nb))) warn("page-count", `${A.host} was measured on ${na} pages and ${B.host} on ${nb}: the medians cover different page sets. The "same pages on both sites" table compares only pages both have.`);
    if ((sa.browser || "") !== (sb.browser || "")) warn("browser", `Different Chrome versions measured the sides (${sa.browser || "unknown"} vs ${sb.browser || "unknown"}): small speed differences may be the browser.`);
    const ca = A.pages.find((p) => p.b?.conditions)?.b.conditions, cb = B.pages.find((p) => p.b?.conditions)?.b.conditions;
    if (ca && cb && JSON.stringify(ca) !== JSON.stringify(cb)) warn("conditions", `The phone and network conditions differ between the snapshots (${JSON.stringify(ca)} vs ${JSON.stringify(cb)}): speed is not comparable.`);
    if (!!sa.ignoreRobots !== !!sb.ignoreRobots) warn("ignore-robots", `One snapshot ignored robots.txt (a preview you own) and the other obeyed it: normal for a preview, listed so the page sets are read with that in mind.`, "info");
    if (JSON.stringify((sa.include || []).slice().sort()) !== JSON.stringify((sb.include || []).slice().sort())) warn("include", `The snapshots forced different extra pages (--include), so the page sets differ.`, "info");
  }
  const ageDays = (x) => (Date.now() - Date.parse(x.at)) / 86400000;
  for (const x of [A, B]) if (x.kind === "url" && ageDays(x) > 7) warn("stale", `The ${x.host} snapshot is ${Math.round(ageDays(x))} days old (taken ${dayOf(x.at)}): re-take it (live-target.mjs --fresh) if the site changed.`);
  if (A.kind === "url" && B.kind === "url" && Math.abs(Date.parse(A.at) - Date.parse(B.at)) > 7 * 86400000) warn("dates-apart", `The two snapshots were taken ${Math.round(Math.abs(Date.parse(A.at) - Date.parse(B.at)) / 86400000)} days apart.`);
  for (const x of [A, B]) {
    if (x.kind === "repo") warn("repo-side", `${x.host} is a repo: it has no measured speed or page weight (n/a in the table); audit its preview URL for those.`, "info");
    if (!x.causes) warn("not-checked", `${x.host} has no checker results (.checks/causes.json): its root causes are NOT CHECKED, so "what B fixes" and "what B still lacks" cannot be judged for it.`);
  }

  const rows = [];
  const nums = (f) => (f && typeof f.value === "number" ? f.value : Array.isArray(f?.value) ? f.value.length : null);
  const row = (group, measure, key, { lower = true, tol = 0, unit = "", note = null, aOverride, bOverride } = {}) => {
    const fa = aOverride || mA[key], fb = bOverride || mB[key];
    const va = nums(fa), vb = nums(fb);
    let better = null;
    if (va != null && vb != null) { const d = Math.abs(va - vb); const same = va === vb || (tol && Math.max(va, vb) > 0 && d / Math.max(va, vb) <= tol); better = same ? "same" : (va < vb) === lower ? "a" : "b"; }
    rows.push({ group, measure, key, lowerIsBetter: lower, unit, a: fa, b: fb, better, note });
  };
  row("1 speed", "typical phone load time, LCP (median of pages)", "lcp", { tol: 0.1, unit: "ms" });
  row("1 speed", "slowest page, LCP", "lcpWorst", { tol: 0.1, unit: "ms" });
  row("1 speed", "typical TBT", "tbt", { tol: 0.1, unit: "ms" });
  row("1 speed", "worst CLS", "cls", { tol: 0.1 });
  row("2 page weight", "typical page weight", "kb", { tol: 0.05, unit: "KB" });
  row("2 page weight", "heaviest page", "kbHeaviest", { tol: 0.05, unit: "KB" });
  row("2 page weight", "requests per page (median)", "requests", { tol: 0.05 });
  row("3 structured data", "pages with structured data (%)", "ldPct", { lower: false, unit: "%" });
  row("3 structured data", "kinds of structured data found", "ldTypes", { lower: false });
  for (const sv of SEV) row("4 root causes", `${sv} root causes`, sv);
  row("4 root causes", "root causes in total", "causes");
  row("5 AI crawler access", "AI and search crawlers refused by robots.txt", "aiBlocked");
  row("6 referring domains", "referring domains (Common Crawl)", "referring", { lower: false });
  row("6 referring domains", "strength rank (1 = strongest site on the web)", "strength", { tol: 0 });
  row("extra", "pages that ask to be left out of search (noindex)", "noindex");
  if (rA.searchesWithPage || rB.searchesWithPage) row("extra", "researched searches that have a page", "searchesWithPage", { lower: false, aOverride: rA.searchesWithPage, bOverride: rB.searchesWithPage });
  if (rA.aiCited || rB.aiCited) row("extra", "AI answers that cite the site", "aiCited", { lower: false, aOverride: rA.aiCited, bOverride: rB.aiCited });
  // a "better" on a by-design cell is not a gap
  for (const r of rows) {
    const byDesignB = B.launchState === "preview" && (["referring", "strength", "aiCited", "noindex"].includes(r.key) || (r.key === "aiBlocked" && r.b.byDesign));
    const byDesignA = A.launchState === "preview" && (["referring", "strength", "aiCited", "noindex"].includes(r.key) || (r.key === "aiBlocked" && r.a.byDesign));
    if (byDesignA || byDesignB) { r.byDesign = true; r.note = `${[byDesignA && A.host, byDesignB && B.host].filter(Boolean).join(" and ")} is a preview: this is by design, not a defect`; }
  }

  // same page on both sites
  const matched = [];
  if (A.kind === "url" && B.kind === "url") {
    const bm = new Map(B.pages.filter((p) => p.path && p.b?.vitals?.lcpMs != null).map((p) => [p.path, p]));
    for (const pa of A.pages.filter((p) => p.path && p.b?.vitals?.lcpMs != null)) {
      const pb = bm.get(pa.path); if (!pb) continue;
      const fa = (p, side, k, v, what) => fact(v, `${what} ${p.url}, ${side.host} snapshot ${path.basename(side.snapDir)}`, p.b.measuredAt || side.at, side.rel(path.join(side.pagesDir, p.slug, "browser-mobile.json")));
      matched.push({ path: pa.path, lcpA: fa(pa, A, "lcp", Math.round(pa.b.vitals.lcpMs), "LCP of"), lcpB: fa(pb, B, "lcp", Math.round(pb.b.vitals.lcpMs), "LCP of"), kbA: fa(pa, A, "kb", Math.round((pa.b.totals?.bytes || 0) / 1024), "page weight of"), kbB: fa(pb, B, "kb", Math.round((pb.b.totals?.bytes || 0) / 1024), "page weight of"),
        ldA: (pa.b.page?.structuredData || []).length > 0, ldB: (pb.b.page?.structuredData || []).length > 0 });
    }
  }
  const mp = matched.length ? (() => {
    const pa = med(matched.map((x) => x.lcpA.value)), pb = med(matched.map((x) => x.lcpB.value));
    return { n: matched.length, medianLcpA: fact(pa, `median LCP of the ${matched.length} pages both sites have`, A.at, A.rel(A.pagesDir)), medianLcpB: fact(pb, `median LCP of the ${matched.length} pages both sites have`, B.at, B.rel(B.pagesDir)) };
  })() : null;

  // what B fixes from A, what B still lacks
  let fixedFromA = null, stillInB = null, newInB = null;
  if (A.causes && B.causes) {
    const bRules = new Set(B.causes.flatMap(rulesKey)), aRules = new Set(A.causes.flatMap(rulesKey));
    const view = (c) => ({ id: c.id, severity: c.severity, rules: c.rules, problem: c.problem, fix: c.fix, pages: c.pages ?? null });
    const bySev = (x, y) => sevRank(x) - sevRank(y) || (y.pages || 0) - (x.pages || 0);
    fixedFromA = A.causes.filter((c) => !rulesKey(c).some((r) => bRules.has(r))).sort(bySev).map(view);
    stillInB = A.causes.filter((c) => rulesKey(c).some((r) => bRules.has(r))).sort(bySev).map(view);
    newInB = B.causes.filter((c) => !rulesKey(c).some((r) => aRules.has(r))).sort(bySev).map(view);
  }
  // B still lacks: B's serious open causes, plus where A beats B (by-design cells excluded)
  const lacking = [];
  if (B.causes) for (const c of B.causes.slice().sort((x, y) => sevRank(x) - sevRank(y) || (y.pages || 0) - (x.pages || 0)).filter((c) => c.severity === "critical" || c.severity === "high")) lacking.push({ kind: "root cause", severity: c.severity, what: c.problem, fix: c.fix, rules: c.rules, inA: A.causes ? rulesKey(c).some((r) => new Set(A.causes.flatMap(rulesKey)).has(r)) : null });
  for (const r of rows.filter((x) => x.better === "a" && !x.byDesign && !["critical", "high", "medium", "low", "causes"].includes(x.key))) lacking.push({ kind: "behind A", what: `${r.measure}: ${fmtCell(r.b, r)} on ${B.host} against ${fmtCell(r.a, r)} on ${A.host}`, evidence: { a: r.a, b: r.b } });
  if (!B.causes) lacking.push({ kind: "not checked", what: `${B.host} has not been through the checker: its root causes are unknown (UNPROVEN)` });
  const byDesign = rows.filter((r) => r.byDesign).map((r) => ({ measure: r.measure, note: r.note }));

  return { warnings, rows, matched, matchedSummary: mp, fixedFromA, stillInB, newInB, lacking, byDesign, mA, mB, rA, rB };
}

function fmtCell(f, r) {
  if (!f) return "n/a";
  const v = f.value;
  if (v == null) return f.notInGraph ? NOT_FOUND : "n/a";
  if (Array.isArray(v)) return v.length ? `${v.length} (${v.slice(0, 4).join(", ")}${v.length > 4 ? ", ..." : ""})` : "0";
  if (r?.unit === "ms") return sec(v);
  if (r?.unit === "KB") return v >= 1024 ? `${(v / 1024).toFixed(1)} MB` : `${v} KB`;
  if (r?.unit === "%") return `${v}%`;
  if (r?.key === "aiCited") return `${Math.round(v * 100)}%`;
  if (r?.key === "searchesWithPage") return `${v} of ${f.of}`;
  return typeof v === "number" ? v.toLocaleString("en-US") : String(v);
}

// ---------- AEO-012 across time: two snapshots of ONE host ----------
// node compare.mjs --freshness <url> [--cwd DIR]            the two newest complete snapshots of that host (older = before)
// node compare.mjs --freshness <snapshot dir A> <snapshot dir B>
// A page whose sitemap lastmod moved while its normalised main text (mainTextHash) did not = fake freshness (FAIL). Writes
// <host>/.pewp/freshness/<A>-vs-<B>.json for a URL. Exit 0 PASS, 1 FAIL, 2 cannot judge (fewer than two snapshots, nothing comparable).
function freshnessMode(a, opt) {
  const pos = a.filter((x, i) => !x.startsWith("--") && a[i - 1] !== "--cwd");
  const cwd = path.resolve(opt("--cwd", process.cwd()));
  let dirA, dirB, out = null;
  if (pos.length === 1 && isUrl(pos[0])) {
    const loc = locate(pos[0], { cwd });
    const done = (fs.existsSync(loc.snapshots) ? fs.readdirSync(loc.snapshots) : []).filter((d) => /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(d)).sort()
      .filter((d) => { const s = J(path.join(loc.snapshots, d, "_site.json")); return s && !s.stoppedEarly && s.finishedAt && s.pages?.length; });
    if (done.length < 2) { console.log(`ERROR AEO-012 cannot judge: ${done.length} complete snapshot(s) of ${loc.host}; fake freshness needs two (take another with live-target.mjs --fresh on a later day)`); process.exit(2); }
    [dirA, dirB] = done.slice(-2).map((d) => path.join(loc.snapshots, d));
    out = path.join(loc.pewp, "freshness", `${path.basename(dirA)}-vs-${path.basename(dirB)}.json`);
  } else if (pos.length === 2) [dirA, dirB] = pos.map((p) => path.resolve(p));
  else { console.error("usage: node compare.mjs --freshness <url> [--cwd DIR] | --freshness <snapshot dir A> <snapshot dir B>"); process.exit(2); }
  const r = freshnessAcrossSnapshots(dirA, dirB);
  if (r.status === "ERROR") { console.log(`ERROR AEO-012 cannot judge: ${r.why}`); process.exit(2); }
  console.log(r.status === "FAIL" ? `FAIL AEO-012 ${r.findings.length} page(s) moved their sitemap lastmod without changing their main text (fake freshness: search engines learn to ignore the field)` : `PASS AEO-012 no page moved its lastmod without a content change (${r.compared} compared, ${r.changedText} changed text)`);
  for (const f of r.findings.slice(0, 40)) console.log(`  ${f.url} lastmod ${f.lastmodA} -> ${f.lastmodB}, main text unchanged`);
  for (const n of r.notes) console.log(`  NOTE ${n}`);
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify({ a: dirA, b: dirB, ...r }, null, 1) + "\n"); console.log(`  wrote ${out}`); }
  process.exit(r.status === "FAIL" ? 1 : 0);
}

// ---------- main ----------
function main() {
  const all = process.argv.slice(2);
  const dd = all.indexOf("--");
  const a = dd >= 0 ? all.slice(0, dd) : all, pass = dd >= 0 ? all.slice(dd + 1) : [];
  const opt = (k, d = null) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  if (a.includes("--freshness")) return freshnessMode(a, opt);
  const pos = a.filter((x, i) => !x.startsWith("--") && !["--cwd", "--launch-state-a", "--launch-state-b"].includes(a[i - 1]));
  if (pos.length !== 2) { console.error("usage: node compare.mjs <a> <b> [--cwd DIR] [--launch-state-a live|preview] [--launch-state-b live|preview] [--refresh] [--strict] [-- <snapshot-site options>]"); process.exit(2); }
  const cwd = path.resolve(opt("--cwd", process.cwd()));
  for (const k of ["--launch-state-a", "--launch-state-b"]) if (opt(k) && !["live", "preview", "planned"].includes(opt(k))) { console.error(`${k} must be live, preview or planned`); process.exit(2); }
  if (a.includes("--refresh")) for (const t of pos.filter(isUrl)) {
    const r = spawnSync(process.execPath, [path.join(HERE, "live-target.mjs"), t, "--cwd", cwd, ...pass], { encoding: "utf8", timeout: 4 * 3600_000 + 300_000, maxBuffer: 64 * 1024 * 1024 });
    if (r.error?.code === "ETIMEDOUT") { console.error(`live-target timed out for ${t} (over 4 h 5 min): stopped`); process.exit(1); }
    process.stdout.write(r.stdout || ""); if (r.status !== 0) { console.error(`live-target failed for ${t} (${r.error ? r.error.code || r.error.message : r.signal ? `killed by ${r.signal}` : `exit ${r.status}`}): ${r.stderr || r.stdout}`); process.exit(1); }
  }
  const A = readSide(pos[0], "A", { cwd, launch: opt("--launch-state-a") }), B = readSide(pos[1], "B", { cwd, launch: opt("--launch-state-b") });
  const errs = [...A.errors, ...B.errors];
  if (errs.length) { for (const e of errs) console.error(e); process.exit(1); }
  const c = compare(A, B, { cwd });
  const outDir = path.join(cwd, "site-checks", `compare-${A.host}-vs-${B.host}`);

  // ----- plain words -----
  const get = (k) => c.rows.find((r) => r.key === k);
  const bits = [];
  const lcp = get("lcp");
  if (lcp.a.value != null && lcp.b.value != null) bits.push(lcp.better === "same" ? `phone speed is about the same (typical page ${sec(lcp.a.value)} on A, ${sec(lcp.b.value)} on B)` : `${lcp.better === "b" ? "B" : "A"} is faster on phones (typical page ${sec(lcp.b.value)} on B, ${sec(lcp.a.value)} on A)`);
  if (c.mA.causes.value != null && c.mB.causes.value != null) bits.push(`B has ${c.mB.causes.value} root causes against A's ${c.mA.causes.value}`);
  if (c.fixedFromA) bits.push(`B fixes ${c.fixedFromA.length} of A's ${A.causes.length}, still has ${c.stillInB.length} of them and adds ${c.newInB.length} new`);
  const ld = get("ldPct");
  if (ld.a.value != null && ld.b.value != null) bits.push(`structured data covers ${ld.b.value}% of B's pages against ${ld.a.value}% of A's`);
  const ref = get("referring");
  if (ref.a.value != null && ref.b.value != null) bits.push(`${ref.b.value} websites link to B against ${ref.a.value} to A${ref.byDesign ? " (a preview, by design)" : ""}`);
  else for (const [x, f] of [[A, ref.a], [B, ref.b]]) if (f?.notInGraph) bits.push(`${x.host} is ${NOT_FOUND}, so the links to the two sites cannot be compared`);
  const shortAnswer = `A is ${A.host}${A.launchState === "preview" ? " (a preview)" : ""}, B is ${B.host}${B.launchState === "preview" ? " (a preview)" : ""}: ${bits.length ? bits.join("; ") : "not enough measured data on both sides to compare"}.${c.warnings.some((w) => w.level === "warn") ? ` ${c.warnings.filter((w) => w.level === "warn").length} warning${s(c.warnings.filter((w) => w.level === "warn").length)}: read them before trusting a difference.` : ""}`;

  const who = (x) => `| ${x.role} | ${x.host} | ${x.kind === "url" ? "live URL snapshot" : "repo"} | ${x.kind === "url" ? `${dayOf(x.at)}, ${x.pages.length} pages, ${x.site.runs || 1} run${s(x.site.runs || 1)} each` : `checked ${dayOf(x.causesAt)}`} | ${x.launchState} |`;
  const mdRows = [];
  let lastGroup = null;
  for (const r of c.rows) {
    if (r.group !== lastGroup) { mdRows.push(`| **${r.group.replace(/^\d /, "").replace(/^./, (ch) => ch.toUpperCase())}** | | | |`); lastGroup = r.group; }
    mdRows.push(`| ${r.measure} | ${fmtCell(r.a, r)} | ${fmtCell(r.b, r)} | ${r.better === "a" ? "A" : r.better === "b" ? "B" : r.better === "same" ? "same" : "-"}${r.byDesign ? " (by design)" : ""} |`);
  }
  const L = [];
  const warns = c.warnings.filter((w) => w.level === "warn"), infos = c.warnings.filter((w) => w.level !== "warn");
  const list = (xs, n, fmt) => xs.slice(0, n).map(fmt).concat(xs.length > n ? [`- ... and ${xs.length - n} more (all in compare.json)`] : []);
  L.push(`# Compare: ${A.host} (A) vs ${B.host} (B)`, "", `**Short answer:** ${shortAnswer}`, "");
  if (warns.length) L.push("## Read this first", "", ...warns.map((w) => `- ${w.text}`), "");
  L.push("## Who is who", "", "| | Site | Kind | Snapshot | Launch state |", "|---|---|---|---|---|", who(A), who(B), "",
    infos.length ? `Notes: ${infos.map((w) => w.text).join(" ")}` : "", "",
    `## Side by side`, "", `Lower is better for times, weights and problems; higher is better for coverage and links. "n/a" means not measured, with the reason in compare.json.`, "",
    "| Measure | A | B | Better |", "|---|---|---|---|", ...mdRows, "");
  if (c.matchedSummary) L.push("## The same pages on both sites", "", `${c.matchedSummary.n} page${s(c.matchedSummary.n)} exist on both. Typical LCP on those: A ${sec(c.matchedSummary.medianLcpA.value)}, B ${sec(c.matchedSummary.medianLcpB.value)}.`, "", "| Page | A load | B load | A weight | B weight | Structured data A / B |", "|---|---|---|---|---|---|",
    ...c.matched.slice(0, 15).map((m) => `| ${m.path} | ${sec(m.lcpA.value)} | ${sec(m.lcpB.value)} | ${m.kbA.value} KB | ${m.kbB.value} KB | ${m.ldA ? "yes" : "no"} / ${m.ldB ? "yes" : "no"} |`), c.matched.length > 15 ? `| ... ${c.matched.length - 15} more in compare.json | | | | | |` : "", "");
  L.push("## What B fixes from A", "");
  if (c.fixedFromA) {
    L.push(c.fixedFromA.length ? `${c.fixedFromA.length} of A's ${A.causes.length} root causes no longer show up in B (matched by checklist rule id):` : "None of A's root causes is gone in B.", ...list(c.fixedFromA, 12, (f) => `- [${f.severity}] ${f.rules?.join(", ") || f.id}: ${plainProblem(f.problem)}`), "",
      `${c.stillInB.length} are still present in B${c.stillInB.length ? ", for example:" : "."}`, ...list(c.stillInB, 6, (f) => `- [${f.severity}] ${f.rules?.join(", ") || f.id}: ${plainProblem(f.problem)}`), "");
    if (c.newInB.length) L.push(`${c.newInB.length} root cause${s(c.newInB.length)} appear only in B (new problems):`, ...list(c.newInB, 8, (f) => `- [${f.severity}] ${f.rules?.join(", ") || f.id}: ${plainProblem(f.problem)}`), "");
  } else L.push(`NOT CHECKED: ${!A.causes ? A.host : B.host} has no checker results, so which problems B fixes cannot be judged (UNPROVEN). Run the checker on its snapshot folder, then run compare again.`, "");
  L.push("## What B still lacks", "");
  if (c.lacking.length) L.push(...list(c.lacking, 15, (x) => `- ${x.kind === "root cause" ? `[${x.severity}] ${String(x.what).replace(/\s+/g, " ").slice(0, 170)}${x.fix ? ` Fix: ${String(x.fix).replace(/\s+/g, " ").slice(0, 140)}` : ""}${x.inA ? " (A has it too)" : ""}` : x.what}`), "");
  else L.push("Nothing measured puts B behind A, and B has no critical or high root cause.", "");
  if (c.byDesign.length) L.push("## By design, not counted", "", ...c.byDesign.map((d) => `- ${d.measure}: ${d.note}`), "");
  const body = L.join("\n");
  const used = new Set(Object.keys(GLOSSARY).filter((t) => (/^[A-Z]+$/.test(t) ? new RegExp(`\\b${t}\\b`) : new RegExp(t.replace(/\./g, "\\."), "i")).test(body)));
  L.push("## Words used", "", ...Object.entries(GLOSSARY).filter(([t]) => used.has(t)).map(([t, d]) => `- **${t}**: ${d}`), "");

  const side = (x) => ({ role: x.role, target: x.target, kind: x.kind, host: x.host, launchState: x.launchState, snapshot: x.snapDir ? x.rel(x.snapDir) : null, takenAt: x.at,
    pagesMeasured: x.kind === "url" ? fact(x.pages.length, `snapshot ${path.basename(x.snapDir)} _site.json`, x.at, x.rel(path.join(x.snapDir, "_site.json"))) : null,
    runsPerPage: x.kind === "url" ? fact(x.site.runs || 1, `snapshot ${path.basename(x.snapDir)} _site.json`, x.at, x.rel(path.join(x.snapDir, "_site.json"))) : null,
    checker: x.causes ? x.rel(x.causesFile) : "NOT CHECKED" });
  const usedGlossary = Object.fromEntries(Object.entries(GLOSSARY).filter(([t]) => used.has(t)));
  const json = { writtenAt: new Date().toISOString(), a: side(A), b: side(B), shortAnswer, warnings: c.warnings, rows: c.rows, sameParts: c.matchedSummary ? { summary: c.matchedSummary, pages: c.matched } : null,
    fixedFromA: c.fixedFromA, stillInB: c.stillInB, newInB: c.newInB, stillLacking: c.lacking, byDesign: c.byDesign, glossary: usedGlossary };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "compare.md"), L.join("\n"));
  fs.writeFileSync(path.join(outDir, "compare.json"), JSON.stringify(json, null, 1) + "\n");
  console.log(shortAnswer);
  console.log(`wrote ${path.join(outDir, "compare.md")} and compare.json`);
  if (a.includes("--strict") && warns.length) { console.error(`--strict: ${warns.length} warning(s)`); process.exit(1); }
}
if (isMain(import.meta.url)) main();
