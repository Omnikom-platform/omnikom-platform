// Usage: node report-live.mjs <url> [--snapshot DIR] [--authority FILE] [--launch-state live|preview] [--cwd DIR] [--checks DIR]
// The audit-live report, for a non-technical owner: one-line answer first, then the six questions in order:
//   1 Can search engines and AI crawlers reach and read the site?   (snapshot + the checker's root causes)
//   2 Is there a page for what people actually search?              (targets.json vs the site's pages; gate data for cannibalisation)
//   3 Is each page better than what ranks now?                      (research competitor audits + SERP captures vs our pages)
//   4 Does the site have the authority to rank?                     (Common Crawl web graph, free)
//   5 Is it cited by AI engines? If not, who is, and why?           (research ai-citations + measure citations)
//   6 What to fix, in order                                         (root causes by severity x pages, then the plan from the research)
// Q2, Q3 and Q5 are BLOCKED cards (with what unblocks them) only when their data files are missing.
// Writes <pewp>/report.md and <pewp>/report.json. Every number in report.json is {value, source, fetchedAt, cacheFile}.
// A previous report.json is kept as report.prev.json and the new report says what changed since it.
// launchState "preview" (from --launch-state or <pewp>/business.json): a noindex preview is "not indexable by design".
// --checks DIR: the checker's causes.json and plan.json are read from DIR (the manifest's checker step writes {work}/checker/.checks), not from <snapshot>/.checks;
//   with --checks and no readable list of causes there: BLOCKED (exit 3) naming the checker step, and no report is written. --checks with no DIR: usage (exit 2).
// G18: the report says the date of the doctor result it used; when doctor.json's `inputs` hashes (env file, token file, service account file)
//   differ from the files now, section 2 opens with "STALE doctor result (<date>)" and the old per-source NEEDS text is not repeated.
// G9: when _site.json.machineLoad says the machine was busy and a page's speedTrust is "UNTRUSTED...", the speed line says so; when
//   <pewp>/psi/<date>.json (newest) exists, lab and PageSpeed Insights are shown side by side and PSI is named the trusted number.
// Words: the file search engines read is "the sitemap file (sitemap.xml)"; this report never calls a page plan a sitemap.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseEnv } from "./lib-env.mjs";
import { locate, load, markStage } from "./state.mjs";
import { latestComplete } from "./live-target.mjs";
import { fact } from "./cache.mjs";
import { loadSite, normPath } from "./lib-site.mjs";
import { overlap, tokens, tokenSet, seqContains, showsQuestion, THRESHOLD, words as wordsOf } from "./lib-text.mjs";

const a = process.argv.slice(2);
const opt = (k, d = null) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const url = a[0];
if (!url || !/^https?:\/\//i.test(url) || (a.includes("--checks") && !/^[^-]/.test(opt("--checks") || ""))) { console.error("usage: node report-live.mjs <url> [--snapshot DIR] [--authority FILE] [--launch-state live|preview] [--cwd DIR] [--checks DIR]"); process.exit(2); }
const loc = locate(url, { cwd: opt("--cwd", process.cwd()) });
// (a BOM, as an editor on Windows may leave in a hand-edited business.json, is not a reason to ignore the file)
const J = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };
const snapDir = opt("--snapshot") || latestComplete(loc.snapshots)?.dir;
if (!snapDir || !fs.existsSync(path.join(snapDir, "_site.json"))) { console.log(`BLOCKED: no complete snapshot for ${loc.host} | unblocks: run live-target.mjs first (the snapshot step of pipeline.json)`); process.exit(3); }
const site = J(path.join(snapDir, "_site.json"));
if (!site) { console.log(`BLOCKED: ${path.join(snapDir, "_site.json")} is not readable JSON | unblocks: take the snapshot again (live-target.mjs --fresh)`); process.exit(3); }
const business = J(path.join(loc.pewp, "business.json")) || {};
const launchState = opt("--launch-state") || business.launchState || "live";
const rel = (p) => path.relative(loc.root, p).split(path.sep).join("/");
const snapAt = site.finishedAt;
const src = (file) => `snapshot ${path.basename(snapDir)}: ${rel(file)}`;
const TODAY = new Date().toISOString().slice(0, 10);

// ---------- Q1 evidence ----------
const robots = J(path.join(snapDir, "site/robots.json")) || {};
const sitemaps = J(path.join(snapDir, "site/sitemaps.json")) || {};
const probes = J(path.join(snapDir, "site/probes.json")) || {};
const pages = (site.pages || []).filter((p) => p.status === 200).map((p) => ({ ...p, b: J(path.join(snapDir, "pages", p.slug, "browser-mobile.json")), r: J(path.join(snapDir, "pages", p.slug, "response.json")) }));
const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "ClaudeBot", "Claude-SearchBot", "Google-Extended", "CCBot", "Applebot-Extended", "Bingbot", "Googlebot"];
function allowedRoot(agent) {
  const groups = robots.groups || [];
  const g = groups.filter((x) => x.agents.includes(agent.toLowerCase()));
  const rules = (g.length ? g : groups.filter((x) => x.agents.includes("*"))).flatMap((x) => x.rules);
  const hit = rules.filter((r) => r.path && "/".startsWith(r.path.replace(/\*.*$/, "")) && (r.path === "/" || r.path === "/*")).sort((x, y) => (y.allow === true) - (x.allow === true));
  return !hit.length || hit[0].allow;
}
const robotsFile = path.join(snapDir, "site/robots.json");
const blockedBots = AI_BOTS.filter((b) => !allowedRoot(b));
const noindexPages = pages.filter((p) => (p.b?.page?.robotsMeta || []).some((m) => /noindex/i.test(m)) || /noindex/i.test(p.r?.headers?.["x-robots-tag"] || ""));
const noCanonical = pages.filter((p) => p.b && !p.b.page.canonical);
const noDesc = pages.filter((p) => p.b && !p.b.page.metaDescription);
const badH1 = pages.filter((p) => p.b && p.b.page.h1Count !== 1);
const noLd = pages.filter((p) => p.b && !(p.b.page.structuredData || []).length);
const noOg = pages.filter((p) => p.b && !p.b.page.og?.["og:title"]);
const measured = pages.filter((p) => p.b?.vitals?.lcpMs != null);
const med = (xs) => { const v = xs.filter((x) => typeof x === "number").sort((x, y) => x - y); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
const worst = (k) => measured.reduce((w, p) => (!w || (p.b.vitals[k] ?? -1) > (w.b.vitals[k] ?? -1) ? p : w), null);
const speed = {
  // no page measured = no number (never a 0 that reads as "instant")
  lcpMedianMs: measured.length ? fact(Math.round(med(measured.map((p) => p.b.vitals.lcpMs))), `${measured.length} pages, real Chrome, phone, slow 4G, 4x CPU, median of ${site.runs || 1} runs each`, snapAt, rel(path.join(snapDir, "pages"))) : fact(null, "NOT MEASURED: no page has a browser measurement in the snapshot (run without --no-browser)", snapAt, rel(path.join(snapDir, "pages"))),
  lcpWorst: measured.length ? fact(Math.round(worst("lcpMs").b.vitals.lcpMs), worst("lcpMs").url, worst("lcpMs").b.measuredAt, rel(path.join(snapDir, "pages", worst("lcpMs").slug, "browser-mobile.json"))) : null,
  tbtMedianMs: measured.length ? fact(med(measured.map((p) => p.b.vitals.tbtMs)), "same pages and runs", snapAt, rel(path.join(snapDir, "pages"))) : fact(null, "NOT MEASURED: no page has a browser measurement in the snapshot", snapAt, rel(path.join(snapDir, "pages"))),
  clsWorst: measured.length ? fact(Number((worst("cls").b.vitals.cls || 0).toFixed(3)), worst("cls").url, worst("cls").b.measuredAt, rel(path.join(snapDir, "pages", worst("cls").slug, "browser-mobile.json"))) : null,
  heaviestKb: measured.length ? (() => { const p = measured.reduce((w, x) => (!w || x.b.totals.bytes > w.b.totals.bytes ? x : w), null); return fact(Math.round(p.b.totals.bytes / 1024), p.url, p.b.measuredAt, rel(path.join(snapDir, "pages", p.slug, "browser-mobile.json"))); })() : null,
};
const checksDir = opt("--checks"), causesFile = path.join(checksDir || path.join(snapDir, ".checks"), "causes.json");   // --checks: where the manifest's checker step writes
const causes = J(causesFile);
if (checksDir && !Array.isArray(causes)) { console.log(`BLOCKED: no readable checker result at ${causesFile} (a list of root causes) | unblocks: the checker step of pipeline.json writes it there; run that step, then report-live again`); process.exit(3); }
const sev = { critical: 0, high: 1, medium: 2, low: 3 };
const RULES = (() => { try { const m = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "checklist", "INDEX.md"), "utf8").match(/shipgate spec ([\d.]+), (\d+) rules/); return m ? `${m[2]} rules, shipgate spec ${m[1]}` : "shipgate checklist"; } catch { return "shipgate checklist"; } })();
const count = (s) => (causes || []).filter((c) => c.severity === s).length;
const q1Facts = {
  pagesChecked: fact(pages.length, src(path.join(snapDir, "_site.json")), snapAt, rel(path.join(snapDir, "_site.json"))),
  robotsStatus: fact(robots.status ?? "missing", src(robotsFile), snapAt, rel(robotsFile)),
  aiCrawlersBlocked: fact(blockedBots, src(robotsFile), snapAt, rel(robotsFile)),
  sitemapUrls: fact(sitemaps.urlCount ?? 0, src(path.join(snapDir, "site/sitemaps.json")), snapAt, rel(path.join(snapDir, "site/sitemaps.json"))),
  notFoundStatus: fact(probes.notFound?.finalStatus ?? null, src(path.join(snapDir, "site/probes.json")), snapAt, rel(path.join(snapDir, "site/probes.json"))),
  pagesNoindex: fact(noindexPages.length, "rendered pages (robots meta + X-Robots-Tag)", snapAt, rel(path.join(snapDir, "pages")), { byDesign: launchState === "preview" }),
  pagesWithoutCanonical: fact(noCanonical.length, "rendered pages", snapAt, rel(path.join(snapDir, "pages"))),
  pagesWithoutDescription: fact(noDesc.length, "rendered pages", snapAt, rel(path.join(snapDir, "pages"))),
  pagesWithoutOneH1: fact(badH1.length, "rendered pages", snapAt, rel(path.join(snapDir, "pages"))),
  pagesWithoutStructuredData: fact(noLd.length, "rendered pages", snapAt, rel(path.join(snapDir, "pages"))),
  pagesWithoutSharingTags: fact(noOg.length, "rendered pages", snapAt, rel(path.join(snapDir, "pages"))),
  ...speed,
  rootCauses: causes ? fact({ total: causes.length, critical: count("critical"), high: count("high"), medium: count("medium"), low: count("low") }, `the checker's root causes (${RULES})`, J(path.join(path.dirname(causesFile), "plan.json"))?.createdAt || snapAt, rel(causesFile)) : null,
};

// ---------- G9: how far to trust the lab speed, and what PageSpeed Insights (Google's servers) says ----------
const machineLoad = site.machineLoad && typeof site.machineLoad === "object" ? site.machineLoad : null;
const isUntrusted = (p) => /^UNTRUSTED/i.test(String(p?.speedTrust || ""));
const untrustedPages = measured.filter(isUntrusted);
const labUntrusted = untrustedPages.length > 0;
const psiDir = path.join(loc.pewp, "psi");
const psiDates = fs.existsSync(psiDir) ? fs.readdirSync(psiDir).map((x) => x.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1]).filter(Boolean).sort().reverse() : [];
const psiFile = psiDates.length ? path.join(psiDir, psiDates[0] + ".json") : null;
const psiRows = ((psiFile && J(psiFile))?.pages || []).filter((r) => r && r.url);
const urlPath = (u) => { try { return normPath(new URL(u).pathname); } catch { return null; } };
const labFor = (u) => measured.find((p) => urlPath(p.finalUrl || p.url) === urlPath(u));
const secOf = (ms) => (ms == null ? "n/a" : `${(ms / 1000).toFixed(1)} s`);
const cell = (x) => String(x ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ");
const psiMedianLcp = med(psiRows.filter((r) => r.strategy === "mobile").map((r) => r.lcpMs));
const speedTrustLines = [];
if (machineLoad) speedTrustLines.push(`- Machine load while the lab speed was measured: CPU use ${machineLoad.cpuPctAvg ?? "n/a"}% on average (highest ${machineLoad.cpuPctMax ?? "n/a"}%, ${machineLoad.samples ?? 0} samples); lab speed is only trusted up to ${machineLoad.thresholdPct ?? 35}%.`);
if (labUntrusted) speedTrustLines.push(`- **Lab speed UNTRUSTED** on ${untrustedPages.length} page${untrustedPages.length === 1 ? "" : "s"} (${untrustedPages.slice(0, 5).map((p) => `${urlPath(p.finalUrl || p.url) || p.url}: ${p.speedTrust}`).join("; ")}): this computer was busy, so those lab numbers are not findings.${psiRows.length ? " The PageSpeed Insights numbers below (Google's own test, run on Google's servers) are the trusted ones." : " Run psi.mjs (needs PSI_API_KEY, free) to get the trusted number."}`);
if (psiRows.length) {
  speedTrustLines.push("", `PageSpeed Insights of ${psiDates[0]} next to the lab run (${labUntrusted ? "PSI is the trusted number: the lab run was UNTRUSTED" : "both are shown"}):`, "",
    "| Page | Device | Lab (this computer) | PageSpeed Insights (Google) | Trusted number |", "|---|---|---|---|---|",
    ...psiRows.slice(0, 40).map((r) => {
      const lab = r.strategy === "mobile" ? labFor(r.url) : null;
      const labTxt = lab ? `LCP ${secOf(lab.b.vitals.lcpMs)}, TBT ${lab.b.vitals.tbtMs ?? "n/a"} ms${isUntrusted(lab) ? ` (${lab.speedTrust})` : ""}` : r.strategy === "mobile" ? "not measured" : "lab runs are phone only";
      const trusted = lab && !isUntrusted(lab) ? "lab and PSI" : "PSI";
      return `| ${cell(urlPath(r.url) || r.url)} | ${r.strategy === "mobile" ? "phone" : r.strategy === "desktop" ? "desktop" : cell(r.strategy)} | ${cell(labTxt)} | score ${r.performance ?? "n/a"}, LCP ${secOf(r.lcpMs)}, CLS ${r.cls ?? "n/a"}, TBT ${r.tbtMs ?? "n/a"} ms | ${trusted} |`;
    }), "");
}
if (machineLoad || labUntrusted) q1Facts.labSpeedTrust = fact({ trusted: !labUntrusted, untrustedPages: untrustedPages.map((p) => p.url), machineLoad }, src(path.join(snapDir, "_site.json")), snapAt, rel(path.join(snapDir, "_site.json")));
if (psiRows.length) q1Facts.psiSpeed = fact({ date: psiDates[0], pages: psiRows.length, typicalPhoneLcpMs: psiMedianLcp == null ? null : Math.round(psiMedianLcp), trustedNumber: labUntrusted ? "PSI" : "lab and PSI" }, "PageSpeed Insights API (Google's servers), psi.mjs", psiRows[0].fetchedAt || psiDates[0], rel(psiFile));

// ---------- Q4 authority ----------
const authFile = opt("--authority") || path.join(loc.pewp, "authority.json");
const auth = J(authFile);
let q4;
if (auth) {
  // a site the link graph does not hold has no role and no count in authority.json: it is "not found in the link data" (null, inGraph false), never 0
  const me = auth.results.find((r) => r.role === "target") || auth.results[0];
  const comps = auth.results.filter((r) => r !== me);
  const f = (v) => fact(v, auth.source, auth.fetchedAt, rel(path.resolve(authFile)));
  q4 = { status: "answered", facts: { referringDomains: f(me.inGraph ? me.linkingDomains : null), inGraph: f(!!me.inGraph), strengthRank: f(me.harmonicPos ?? null),
    competitors: f(comps.map((c) => ({ domain: c.domain, referringDomains: c.inGraph ? c.linkingDomains : null, inGraph: !!c.inGraph, strengthRank: c.harmonicPos ?? null }))), linkGap: f(auth.linkGap.length) },
    strongestLinkers: me.inGraph ? me.strongestLinkingDomains.slice(0, 10).map((l) => l.domain) : [], gapTop: auth.linkGap.slice(0, 15) };
} else q4 = { status: "BLOCKED", why: "the authority step has not run for this site", unblock: `node scripts/authority.mjs "${rel(path.join(loc.pewp, "authority.json"))}" --target ${loc.host} --competitor <competitor domain>... (free, reads the Common Crawl graph on disk; about 15 to 30 minutes)` };

const NOT_IN_GRAPH = "not found in the link data"; // question 4: Common Crawl's link graph does not hold the site; this is not a count of 0
const inGraphQ4 = q4.status === "answered" && q4.facts.inGraph.value !== false; // false only when the graph does not hold the target
const gapTop8 = q4.status === "answered" && q4.gapTop.length ? `, strongest first: ${q4.gapTop.slice(0, 8).map((g) => g.domain).join(", ")}` : "";

// ---------- research and measure outputs (Q2, Q3, Q5) ----------
const doctor = J(path.join(loc.pewp, "doctor.json"));
// G18: is the doctor result still current? Hash the env, token and service account files the way doctor.mjs did and compare with doctor.inputs.
const doctorDate = doctor?.checkedAt ? String(doctor.checkedAt).slice(0, 10) : null;
const doctorCheck = (() => {
  const inp = doctor?.inputs;
  if (!inp || typeof inp !== "object") return { stale: false, hashed: false, why: [] };
  const sha1Of = (p) => { try { return p && fs.statSync(p).isFile() ? crypto.createHash("sha1").update(fs.readFileSync(p)).digest("hex") : "absent"; } catch { return "absent"; } };
  const envFile = doctor.env?.file || null;
  let fromFile = new Map();
  try { if (envFile) fromFile = parseEnv(fs.readFileSync(envFile, "utf8")); } catch {}
  const val = (k) => (process.env[k] && process.env[k].trim()) || (fromFile.get(k) && fromFile.get(k).trim()) || null; // like doctor: a name already in the environment wins
  const now = { envFileSha1: sha1Of(envFile), tokenFileSha1: sha1Of(val("GSC_TOKEN_FILE") || path.join(os.homedir(), ".config", "pewp", "gsc-token.json")), serviceAccountFileSha1: sha1Of(val("GSC_SERVICE_ACCOUNT_FILE")) };
  const why = Object.keys(now).filter((k) => k in inp && inp[k] !== now[k]);
  return { stale: why.length > 0, hashed: true, why };
})();
const doctorStale = doctorCheck.stale;
const srcStatus = (id) => (doctorStale ? `unknown (the doctor result of ${doctorDate} is STALE: run doctor again)` : doctor?.sources?.find((s) => s.id === id)?.status || "unknown (run doctor.mjs)");
const blocked = (why, needs) => ({ status: "BLOCKED", why, needs: needs.map((n) => ({ ...n, status: srcStatus(n.id) })) });
const targetsFile = path.join(loc.pewp, "targets.json");
const targets = J(targetsFile);
const rdir = path.join(loc.pewp, "research");
const compFile = path.join(rdir, "competitors.json"), aiFile = path.join(rdir, "ai-citations.json"), serpFile = path.join(rdir, "serp.json"), clustersFile = path.join(rdir, "clusters.json");
const compR = J(compFile), aiR = J(aiFile), serpR = J(serpFile), clustersR = J(clustersFile);
const gateFile = path.join(loc.pewp, "gate", "report.json");
const gateR = J(gateFile);
const measureDirs = fs.existsSync(path.join(loc.pewp, "measure")) ? fs.readdirSync(path.join(loc.pewp, "measure")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse() : [];
const measureDir = measureDirs.length ? path.join(loc.pewp, "measure", measureDirs[0]) : null;
const rankingsFile = measureDir && path.join(measureDir, "rankings.json"), citationsFile = measureDir && path.join(measureDir, "citations.json"), measureReportFile = measureDir && path.join(measureDir, "report.json");
const rankingsM = rankingsFile && J(rankingsFile), citationsM = citationsFile && J(citationsFile), measureRep = measureReportFile && J(measureReportFile);
const lazy = (fn) => { let v, d = false; return () => (d ? v : ((d = true), (v = fn()))); };
const siteModel = lazy(() => { try { return loadSite(snapDir); } catch { return null; } });
const pathOfUrl = (u) => { try { return normPath(new URL(u).pathname); } catch { return null; } };
const bByPath = new Map(pages.map((p) => [pathOfUrl(p.finalUrl || p.url), p]));
const dayOf = (iso) => String(iso || "").slice(0, 10);
const tf = (value, what, file, at, extra = {}) => fact(value, what, at || TODAY, rel(file), extra);
const asFact = (f, file) => (f && typeof f === "object" && "value" in f ? { ...f, source: f.source || "targets.json", fetchedAt: f.fetchedAt || targets?.createdAt || TODAY, cacheFile: f.cacheFile || rel(file) } : f);
const used = new Set();
const term = (t) => { used.add(t); return t; };
const s = (n) => (n === 1 ? "" : "s");
const sec = (ms) => (ms == null ? "n/a" : `${(ms / 1000).toFixed(1)} s`);
const cityOf = (c) => String(c.location || "").split(",")[0].trim();
const esc = (x) => String(x ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ");

// ---- Q2: is there a page for what people search? ----
function pageFor(c, sm) {
  const all = [...sm.pages.values()].filter((p) => p.status === 200);
  if (c.targetPage && c.targetPage !== "new") {
    const p = sm.pages.get(normPath(c.targetPage));
    if (p && p.status === 200) return { page: p, how: "the page targets.json names" };
    const best = bestMatch(c, all);
    return best ? { ...best, how: "title and main heading match the search" } : { page: null, unverified: true };
  }
  const best = bestMatch(c, all);
  return best ? { ...best, how: "title and main heading match the search (targets.json said no page yet)" } : { page: null };
}
function bestMatch(c, all) {
  let best = null;
  for (const p of all) { const sc = Math.min(overlap(c.primaryQuery, p.title), overlap(c.primaryQuery, p.h1[0] || "")); if (sc >= THRESHOLD && (!best || sc > best.sc)) best = { page: p, sc }; }
  return best;
}
function closestPage(c, sm) {
  let best = null;
  for (const p of sm.pages.values()) { if (p.status !== 200) continue; const sc = overlap(c.primaryQuery, `${p.title} ${p.h1[0] || ""}`); if (sc >= 0.4 && (!best || sc > best.sc)) best = { path: p.path, sc }; }
  return best;
}
// the search's own words (not stems) that the text lacks, for plain-words output
function missingWords(query, text) {
  const have = new Set(tokens(text));
  return String(query).split(/[^\p{L}\p{N}]+/u).filter((w) => { const k = tokens(w)[0]; return k && !have.has(k); });
}
function pageIssues(c, p) {
  const out = [];
  const head = `${p.title} ${p.h1[0] || ""}`;
  if (overlap(c.primaryQuery, head) < THRESHOLD) out.push({ kind: "query", text: `the title and main heading do not carry the search words (missing: ${missingWords(c.primaryQuery, head).join(", ")})`, rule: "GT-004" });
  if (c.intent === "local" && c.location && overlap(cityOf(c), head) < 1) out.push({ kind: "place", text: `the search is local (${c.location}) but the title and heading do not name the place`, rule: "GT-004" });
  const fmt = String(c.winningFormat || "").toLowerCase();
  const isPost = /^\/(blog|news|articles?|posts?)\//.test(p.path);
  if (/landing|city page|service page|listing/.test(fmt) && isPost) out.push({ kind: "format", text: `searchers are shown "${c.winningFormat}", but this page is a blog post`, rule: "GT-003" });
  if (/guide|article|blog|how-to/.test(fmt) && !isPost && p.wordCount < 400) out.push({ kind: "format", text: `the winning pages are guides ("${c.winningFormat}"), this page has only ${p.wordCount} words`, rule: "GT-005" });
  return out;
}
function computeQ2() {
  if (!targets?.clusters?.length) return null;
  const sm = siteModel();
  if (!sm) return null;
  const T = (v, what, extra) => tf(v, `${what} (targets.json made ${dayOf(targets.createdAt)}, matched to snapshot ${path.basename(snapDir)})`, targetsFile, targets.createdAt, extra);
  const rows = targets.clusters.map((c) => {
    const m = pageFor(c, sm);
    return { c, page: m.page, how: m.how, unverified: !!m.unverified, issues: m.page ? pageIssues(c, m.page) : [], closest: m.page ? null : closestPage(c, sm) };
  });
  const have = rows.filter((r) => r.page), missingRows = rows.filter((r) => !r.page && !r.unverified), unver = rows.filter((r) => r.unverified);
  const weak = have.filter((r) => r.issues.length);
  const byPriority = (x, y) => (y.c.priority ?? 0) - (x.c.priority ?? 0);
  const g = gateR?.checks?.find((x) => x.id === "GT-003");
  let cannibal;
  if (g && g.status !== "ERROR") { const det = (g.details || []).filter((d) => !/^(NOTE|WARN)/.test(d)); cannibal = { ...tf(g.status === "PASS" ? 0 : det.length, `the gate check GT-003 (no two pages go after one search): ${g.summary}`, gateFile, gateR.ranAt, {}), details: det.slice(0, 10) }; }
  else cannibal = { status: g ? "NOT JUDGED" : "NOT CHECKED", why: g ? `the gate could not judge it: ${g.summary}` : "the gate has not run for this site", unblock: `node scripts/gate.mjs "${rel(loc.pewp)}" "${rel(snapDir)}"` };
  const rk = rankingsM?.rankings;
  const ranking = rk?.length ? tf({ queriesTracked: rk.length, withAPosition: rk.filter((r) => r.position?.value != null).length, localized: rk.filter((r) => r.localized).length }, `measure ${path.basename(measureDir)}: rankings.json (${rankingsM.status || "ok"})`, rankingsFile, rankingsM.date) : null;
  const notLoc = serpR?.counts ? tf({ captures: serpR.counts.captures, notLocalized: serpR.counts.notLocalized }, "research/serp.json: results pages captured in the owner's browser", serpFile, serpR.generatedAt) : null;
  return {
    status: "answered",
    facts: {
      clustersTotal: T(rows.length, "searches worth a page"),
      clustersWithPage: T(have.length, "of them already have a page"),
      clustersMissingPage: T(missingRows.length, "of them have no page yet"),
      pageNotInSnapshot: T(unver.length, "searches whose named page is not in the snapshot sample (cannot judge)"),
      weakPages: T(weak.length, "existing pages that do not match their search"),
      cannibalisation: cannibal,
      ...(ranking ? { ranking } : {}), ...(notLoc ? { resultsPagesCaptured: notLoc } : {}),
    },
    missing: missingRows.sort(byPriority).slice(0, 12).map((r) => ({ id: r.c.id, search: r.c.primaryQuery, intent: r.c.intent, place: r.c.location, priority: T(r.c.priority ?? null, "priority (demand x value x ease, higher first; orders the work, not a forecast)"), volume: asFact(r.c.volume, targetsFile), closestPage: r.closest ? { path: r.closest.path, searchWordsCovered: Number(r.closest.sc.toFixed(2)) } : null })),
    weak: weak.map((r) => ({ id: r.c.id, search: r.c.primaryQuery, page: r.page.path, matchedBy: r.how, issues: r.issues })),
    unverified: unver.map((r) => ({ id: r.c.id, search: r.c.primaryQuery, page: r.c.targetPage })),
    _rows: rows,
  };
}
const q2c = computeQ2();
const q2 = q2c ? (({ _rows, ...rest }) => rest)(q2c) : blocked("Needs the research stage's targets.json (`research.mjs`): real search demand mapped to pages.", [
  { id: "search-console", what: "real searches people already find the site with" }, { id: "keyword-planner", what: "how often each search happens" },
  { id: "bing-webmaster", what: "Bing keyword volumes" }, { id: "browser-capture", what: "Google's results and questions for each search, captured at human pace" }]);

// ---- Q3: is each page better than what ranks now? ----
const ownSchemaTypes = (p) => [...new Set((p.jsonld || []).flatMap((j) => { const t = []; const walk = (o) => { if (!o || typeof o !== "object") return; if (Array.isArray(o)) return o.forEach(walk); if (o["@type"]) t.push(...[].concat(o["@type"])); walk(o["@graph"]); }; walk(j.parsed); return t; }))];
const faqCount = (p) => (p.jsonld || []).reduce((n, j) => { let c = 0; const walk = (o) => { if (!o || typeof o !== "object") return; if (Array.isArray(o)) return o.forEach(walk); if (/FAQPage/.test([].concat(o["@type"] || []).join(" "))) c += [].concat(o.mainEntity || []).length; walk(o["@graph"]); }; walk(j.parsed); return n + c; }, 0);
function computeQ3() {
  const winners = (compR?.sites || []).filter((x) => x.page && x.status === 200);
  const clusters = targets?.clusters || [];
  const fmtKnown = clusters.filter((c) => c.winningFormat && !/^unknown/i.test(c.winningFormat));
  if (!winners.length && !fmtKnown.length) return null;
  const sm = siteModel();
  const home = sm?.pages.get("/");
  const CF = (v, what, file, at, extra) => tf(v, what, file, at, extra);
  const siteLevel = [];
  if (winners.length && home) {
    const mine = (v, what) => fact(v, `${what} (our home page in snapshot ${path.basename(snapDir)})`, snapAt, rel(path.join(snapDir, "pages")));
    const wf = (x, key, v, what) => (x.facts?.[key] ? asFact(x.facts[key], compFile) : fact(v, `${what} (research/competitors.json, ${x.domain})`, x.fetchedAt || compR.generatedAt, rel(compFile)));
    const ourBots = fact(blockedBots.length, `robots.txt of ${loc.host}: AI search crawlers blocked`, snapAt, rel(robotsFile));
    const row = (label, ours, theirs, note) => siteLevel.push({ measure: label, ours, winners: theirs.map(([d, f]) => ({ domain: d, ...f })), note });
    row("words of text on the home page", mine(wordsOf(home.text).length, "visible words"), winners.map((x) => [x.domain, wf(x, "homeWords", x.page.words, "words")]), "each tool counts words its own way; read it as a rough size");
    row("sections (H2 headings) on the home page", mine(home.headings.filter((h) => h.level === 2).length, "H2 headings"), winners.map((x) => [x.domain, fact(Array.isArray(x.page.h2) ? x.page.h2.length : null, `research/competitors.json, ${x.domain} (capped at 12 by the audit)`, x.fetchedAt || compR.generatedAt, rel(compFile))]), "the audit lists at most 12");
    row("kinds of structured data on the home page", mine(ownSchemaTypes(home).length, "schema types"), winners.map((x) => [x.domain, wf(x, "schemaTypes", (x.schema?.types || []).length, "schema types")]), null);
    row("FAQ questions marked up in structured data", mine(faqCount(home), "FAQ questions"), winners.map((x) => [x.domain, wf(x, "faqQuestions", x.schema?.questions ?? 0, "FAQ questions")]), null);
    row("AI search crawlers blocked by robots.txt", ourBots, winners.map((x) => [x.domain, wf(x, "aiSearchBotsBlocked", null, "AI crawlers blocked")]), "fewer is better; a blocked crawler cannot cite the site");
  }
  const formats = {}; for (const c of fmtKnown) formats[c.winningFormat] = (formats[c.winningFormat] || 0) + 1;
  const captured = clusters.filter((c) => c.serpFeatures && !/NOT CAPTURED/i.test(c.serpFeatures.source || ""));
  const feats = {}; for (const c of captured) for (const f of c.serpFeatures.value || []) feats[f] = (feats[f] || 0) + 1;
  const clusterRows = [];
  const q2rows = q2c?._rows || [];
  for (const r of q2rows.filter((x) => x.page).slice(0, 40)) {
    const p = r.page, c = r.c;
    const tokP = tokens(p.text);
    const entMissing = (c.requiredEntities || []).filter((e) => !seqContains(tokP, e));
    const blockSets = p.blocks.map((b) => tokenSet(b.text));
    const qNot = (c.questions || []).filter((q) => !showsQuestion(q, blockSets));
    const wdomains = (c.competitorsTop3 || []).map((x) => x.domain);
    const audited = wdomains.filter((d) => winners.some((w) => w.domain === d));
    const lcp = bByPath.get(p.path)?.b?.vitals?.lcpMs;
    clusterRows.push({ id: c.id, search: c.primaryQuery, page: p.path, winningFormat: c.winningFormat, winnersNamed: wdomains, winnersAudited: audited,
      entitiesMissing: CF(entMissing, `required entities not found on ${p.path} (targets.json requiredEntities vs the snapshot page text)`, targetsFile, targets.createdAt),
      questionsNotShown: CF({ notShown: qNot.length, asked: (c.questions || []).length, list: qNot.slice(0, 5) }, `questions from the research (People Also Ask, forums) not shown as headings on ${p.path}`, targetsFile, targets.createdAt),
      schemaTypes: fact(ownSchemaTypes(p), `JSON-LD on ${p.path}`, snapAt, rel(path.join(snapDir, "pages"))),
      lcpMs: lcp != null ? fact(Math.round(lcp), `${p.path} in real Chrome, phone, slow 4G`, snapAt, rel(path.join(snapDir, "pages"))) : null });
  }
  return {
    status: "answered",
    scope: winners.length ? `Winners audited: ${winners.map((x) => x.domain).join(", ")} (home page level). ` : "No winner pages were audited yet. " + (clusterRows.length ? "" : "No existing page matches a researched search, so there is nothing page-to-page to compare. "),
    facts: {
      winnersAudited: CF(winners.map((x) => x.domain), "competitor sites audited (raw HTML as a crawler sees it)", compFile, compR?.generatedAt),
      winningFormats: CF(formats, `what the captured top results look like, counted per researched search (${fmtKnown.length} of ${clusters.length} searches have a readable format)`, targetsFile, targets?.createdAt),
      resultFeatures: CF({ capturedSearches: captured.length, features: feats }, "features seen on the captured results pages (AI answer box, map pack, People Also Ask)", targetsFile, targets?.createdAt),
      ...(serpR?.counts ? { notLocalized: CF({ captures: serpR.counts.captures, notLocalized: serpR.counts.notLocalized }, "results pages captured, and how many were NOT from the asked place (so no city ranking claim is made)", serpFile, serpR.generatedAt) } : {}),
    },
    siteLevel, clusterRows,
    notMeasured: "The speed and page weight of the winning sites are not measured (no free source); only ours are.",
  };
}
const q3c = computeQ3();
const q3 = q3c || blocked("Needs the research stage (`research.mjs`): who ranks now for each search, and their pages, to compare against.", [
  { id: "browser-capture", what: "the top 10 results per search" }, { id: "commoncrawl-graph", what: "the winners' authority" }]);

// ---- Q5: is it cited by AI engines? ----
const NOISE_DOMAINS = new Set(["accounts.google.com", "google.com", "support.google.com", "gstatic.com", "maps.google.com"]);
function computeQ5() {
  const keyOf = (r) => `${String(r.question).toLowerCase().trim()}|${r.engine}`;
  const rowsM = (citationsM?.citations || []).map((r) => ({ ...r, _from: "measure" }));
  const seen = new Set(rowsM.map(keyOf));
  const rowsR = (aiR?.rows || []).filter((r) => !seen.has(keyOf(r))).map((r) => ({ ...r, _from: "research" }));
  const rows = [...rowsM, ...rowsR];
  if (!rows.length) return null;
  const runsOf = (r) => Math.max(1, Number(r.runs) || 1);
  const totalRuns = rows.reduce((n, r) => n + runsOf(r), 0);
  const shareW = rows.reduce((n, r) => n + (Number(r.citedShare?.value) || 0) * runsOf(r), 0) / totalRuns;
  const engines = [...new Set(rows.map((r) => r.engine))];
  const questions = [...new Set(rows.map((r) => String(r.question).toLowerCase().trim()))];
  const ourCited = rows.filter((r) => r.ourDomainCited).length;
  const lowRuns = rows.filter((r) => r.lowRuns || r.lowSample || runsOf(r) < 3).length;
  const counts = new Map();
  for (const r of rows) for (const [d, n] of Object.entries(r.sourceCounts || Object.fromEntries((r.citedSources || []).map((d) => [d, 1])))) if (!NOISE_DOMAINS.has(d) && d !== loc.host) counts.set(d, (counts.get(d) || 0) + n);
  const portals = new Set([...(clustersR?.portals || [])]);
  const comps = new Set((business.competitors || []).map((d) => String(d).replace(/^www\./, "")));
  const top = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 10);
  const totalCites = [...counts.values()].reduce((n, v) => n + v, 0);
  const portalCites = [...counts.entries()].filter(([d]) => portals.has(d)).reduce((n, [, v]) => n + v, 0);
  const file = rowsM.length ? citationsFile : aiFile;
  const dates = rows.flatMap((r) => r.dates || [dayOf(r.citedShare?.fetchedAt)]).filter(Boolean).sort();
  const at = dates.at(-1) || TODAY;
  const mine = (v, what, extra = {}) => fact(v, `${what}: ${rows.length} question x engine rows (${rowsM.length ? `measure ${path.basename(measureDir)}/citations.json` : ""}${rowsM.length && rowsR.length ? " + " : ""}${rowsR.length ? "research/ai-citations.json" : ""})`, at, rel(file), extra);
  const nameShare = rowsR.filter((r) => r.ourNameMentionedShare?.value != null);
  const why = [];
  if (blockedBots.length) why.push(`our robots.txt blocks ${blockedBots.join(", ")}, so those engines cannot read the site at all`);
  if (portals.size && totalCites && portalCites / totalCites >= 0.3) why.push(`${Math.round((portalCites / totalCites) * 100)}% of the sources the engines cite are big portals and directories (${[...portals].slice(0, 4).join(", ")}); a local site is cited when it is the clearest local source`);
  if (!ourCited) why.push("no answer cites this site: it has too few other sites linking to or mentioning it for the engines to treat it as a source" + (q4.status !== "answered" ? "" : inGraphQ4 ? ` (${q4.facts.referringDomains.value} referring domain${s(q4.facts.referringDomains.value)} in Common Crawl)` : ` (the site is ${NOT_IN_GRAPH}, in Common Crawl)`));
  if (lowRuns) why.push(`${lowRuns} of ${rows.length} rows were asked fewer than 3 times, so read the shares as hints, not rates`);
  const blockedParts = [citationsM?.blocked && `${citationsM.blocked.source}: ${citationsM.blocked.reason} (unblock: ${citationsM.blocked.unblock})`, aiR?.gemini?.status === "blocked" && `gemini: ${aiR.gemini.blocked || "blocked"}`, ...(aiR?.owner?.blocked || []).map((b) => `${b.engine}: not read (${b.reason})`)].filter(Boolean);
  return {
    status: "answered",
    facts: {
      citedShare: mine(Number(shareW.toFixed(3)), "share of AI answers that cite this site, weighted by how often each question was asked", { estimate: true, unit: "0 to 1" }),
      answersChecked: mine(totalRuns, "AI answers read"),
      questionsAsked: mine(questions.length, "different questions"),
      engines: mine(engines, "engines"),
      rowsCitingUs: mine(ourCited, "rows whose cited sources include this site"),
      ...(nameShare.length ? { nameMentioned: mine(Number((nameShare.reduce((n, r) => n + r.ourNameMentionedShare.value * runsOf(r), 0) / nameShare.reduce((n, r) => n + runsOf(r), 0)).toFixed(3)), "share of answers that name the business even without a link", { estimate: true }) } : {}),
      citedInstead: mine(top.map(([domain, answers]) => ({ domain, answers, kind: portals.has(domain) ? "portal or directory" : comps.has(domain) ? "named competitor" : "other" })), "who is cited instead (answers that cite each domain; sign-in and Google service links left out)"),
    },
    why, blocked: blockedParts,
  };
}
const q5c = computeQ5();
const q5 = q5c || blocked("Needs the AI citation check (research step 7 or `measure`): ask AI engines the target questions several times and record who they cite.", [
  { id: "gemini", what: "Gemini with Google Search grounding (free tier)" }, { id: "browser-capture", what: "ChatGPT and Perplexity answers, owner-supervised" }]);

// ---------- Q6 fix order ----------
const fixes = (causes || []).slice().sort((x, y) => (sev[x.severity] ?? 9) - (sev[y.severity] ?? 9) || (y.pages || 0) - (x.pages || 0)).slice(0, 15)
  .map((c, i) => ({ order: i + 1, cause: c.id, severity: c.severity, rules: c.rules, problem: c.problem, fix: c.fix, pagesAffected: c.pages || null, fixAt: c.fixAt, provedBy: c.scripts?.length ? `node .checks/run-all.mjs (checks: ${c.scripts.slice(0, 3).join(", ")}${c.scripts.length > 3 ? ", ..." : ""})` : "manual review (no check script)" }));
// The plan from the research: effort is a judgement by kind of work, not a measurement; impact is the research's own priority number.
const plan = [];
if (q2c) {
  for (const m of q2.missing.slice(0, 5)) plan.push({ kind: "new page", what: `Build a page for "${m.search}"${m.place ? ` (${m.place})` : ""}`, effort: "medium (one page: brief, writing, build)", impact: m.priority, provedBy: `gate GT-002 (the page exists and is indexable), GT-004 (title, heading and first paragraph carry the search), then its rank in the next measure run` });
  for (const w of q2.weak.slice(0, 5)) plan.push({ kind: "wrong match", what: `Fix ${w.page} for "${w.search}": ${w.issues[0].text}`, effort: "small (title, heading, first paragraph)", impact: null, provedBy: `gate ${[...new Set(w.issues.map((i) => i.rule))].join(", ")}` });
  const cn = q2.facts.cannibalisation;
  if (cn?.value > 0) plan.push({ kind: "cannibalisation", what: `Merge or re-aim the pages that compete for one search (${cn.details?.[0] || "see the gate report"})`, effort: "medium", impact: cn, provedBy: "gate GT-003 passes" });
}
if (q5c && q5c.facts.rowsCitingUs.value === 0) plan.push({ kind: "AI citations", what: "Get named by the sources the AI engines already cite: " + q5c.facts.citedInstead.value.slice(0, 3).map((x) => x.domain).join(", "), effort: "large (outreach, profiles, consistent business facts)", impact: q5c.facts.citedShare, provedBy: "the share of AI answers that cite the site rises in the next measure run (MSR-005)" });
// the link gap is "links to 2+ competitors, not to you"; for a target the graph does not hold the second half cannot be judged, so the row neither says it nor is proved by a count that does not exist
if (q4.status === "answered" && q4.gapTop.length) plan.push(inGraphQ4
  ? { kind: "links", what: `Ask the sites that link to two or more competitors but not to you: ${q4.gapTop.slice(0, 5).map((g) => g.domain).join(", ")}`, effort: "large (outreach)", impact: q4.facts.linkGap, provedBy: "referring domains rise in the next authority run" }
  : { kind: "links", what: `Ask the sites that link to two or more competitors (whether they already link to this site cannot be judged: the site is ${NOT_IN_GRAPH}): ${q4.gapTop.slice(0, 5).map((g) => g.domain).join(", ")}`, effort: "large (outreach)", impact: q4.facts.linkGap, provedBy: "this site appears in the next authority run (it is found in the link data)" });
plan.forEach((p, i) => (p.order = i + 1));

// ---------- plain words ----------
const GLOSSARY = {
  "robots.txt": "a small file that tells search engines and AI crawlers which pages they may read",
  "sitemap file": "the file (sitemap.xml) that lists the site's pages for search engines to read",
  noindex: "a tag that asks search engines to leave a page out of their results",
  canonical: "a tag naming the one official address of a page, so copies don't compete with it",
  "structured data": "hidden labels that tell search engines what a page is (a business, an article, a listing)",
  LCP: "how long a phone takes to show the biggest thing on the screen; Google wants under 2.5 seconds",
  TBT: "how long the phone is too busy to react to taps while the page loads; under 0.2 seconds is good",
  CLS: "how much the page jumps around while loading; under 0.1 is good",
  "AI crawler": "the robots ChatGPT, Perplexity, Google and others use to read sites for their answers",
  "referring domain": "another website that links to this one; more and stronger ones help a site rank",
  "link gap": "sites that link to two or more competitors but not to you: the first ones to ask for a link",
  "root cause": "one underlying problem, often in a template, that shows up on many pages",
  cannibalisation: "two pages of one site going after the same search, so neither ranks well",
  "search intent": "what the person typing wants: to learn, to compare, to buy, or to find something nearby",
  portal: "a big site such as a listings marketplace or directory that fills many results pages",
  "AI citation": "an AI engine naming a site as a source for its answer",
  entity: "a named thing a page should mention to be complete on a topic, such as a town or a program",
};
const problemsQ1 = [];
if (robots.status !== 200) problemsQ1.push(`the robots.txt file is missing or broken (status ${robots.status ?? "none"})`);
if (blockedBots.length) problemsQ1.push(`robots.txt blocks ${blockedBots.join(", ")}`);
if (!sitemaps.urlCount) problemsQ1.push("no sitemap file (sitemap.xml) was found");
if (noindexPages.length && launchState !== "preview") problemsQ1.push(`${noindexPages.length} page${s(noindexPages.length)} ask${noindexPages.length === 1 ? "s" : ""} to be left out of search results (noindex)`);
if (noCanonical.length) problemsQ1.push(`${noCanonical.length} page${s(noCanonical.length)} have no canonical tag`);
if (noLd.length) problemsQ1.push(`${noLd.length} page${s(noLd.length)} have no structured data`);
if (labUntrusted) {
  problemsQ1.push(`the phone speed measured here is not trusted (this computer was busy while it ran), so it is not counted as a finding${psiRows.length ? "; PageSpeed Insights is the trusted number" : "; run psi.mjs for the trusted number"}`);
  if (psiMedianLcp != null && psiMedianLcp > 2500) problemsQ1.push(`pages are slow on phones according to PageSpeed Insights (Google's own test): the typical page takes ${sec(psiMedianLcp)} to show its main content (LCP)`);
} else {
  if ((speed.lcpMedianMs.value || 0) > 2500) problemsQ1.push(`pages are slow on phones: the typical page takes ${sec(speed.lcpMedianMs.value)} to show its main content (LCP), the slowest ${sec(speed.lcpWorst?.value)}`);
  if ((speed.tbtMedianMs.value || 0) > 200) problemsQ1.push(`phones are blocked ${sec(speed.tbtMedianMs.value)} while a typical page loads (TBT)`);
}
const highCauses = causes ? count("critical") + count("high") : null;
const pctTxt = (v) => `${Math.round(v * 100)}%`;
const blockedQs = [[2, q2], [3, q3], [5, q5]].filter(([, q]) => q.status === "BLOCKED").map(([n]) => n);
const researchBits = [];
if (q2.status === "answered") researchBits.push(`${q2.facts.clustersMissingPage.value} of the ${q2.facts.clustersTotal.value} searches that matter have no page yet${q2.facts.weakPages.value ? ` and ${q2.facts.weakPages.value} page${s(q2.facts.weakPages.value)} do not match their search` : ""}`);
if (q5.status === "answered") researchBits.push(`AI engines cite it in ${pctTxt(q5.facts.citedShare.value)} of the ${q5.facts.answersChecked.value} answers read${q5.facts.rowsCitingUs.value === 0 ? " (none)" : ""}`);
const tail = blockedQs.length ? `${researchBits.length ? `${researchBits.join("; ")}. ` : ""}Whether it ranks${blockedQs.includes(5) ? " and gets cited by AI" : ""} is not fully measured yet (BLOCKED, see ${blockedQs.length === 1 ? blockedQs[0] : blockedQs.slice(0, -1).join(", ") + " and " + blockedQs.at(-1)}).` : `${researchBits.join("; ")}.`;
const oneLine = `${loc.host}: ${problemsQ1.length ? `search engines can reach it, but ${problemsQ1.length} thing${s(problemsQ1.length)} hold${problemsQ1.length === 1 ? "s" : ""} it back` : "search engines and AI crawlers can reach and read it"}${causes ? `; the checker found ${causes.length} root causes (${highCauses} serious)` : ""}${q4.status !== "answered" ? "" : inGraphQ4 ? `; ${q4.facts.referringDomains.value} other websites link to it (Common Crawl)` : `; the site is ${NOT_IN_GRAPH} (Common Crawl)`}. ${tail}`;

const doctorLines = doctorStale ? [`**STALE doctor result (${doctorDate}): the env or token files changed since; run doctor again.**`, ""]
  : doctorDate ? [`Source status below is from the doctor result of ${doctorDate}${doctorCheck.hashed ? "" : " (it records no file hashes, so it cannot show whether the env or token files changed since)"}.`, ""] : [];
const card = (q) => [`**BLOCKED.** ${q.why}`, "", `What unblocks it${doctorDate && !doctorStale ? ` (source status from the doctor result of ${doctorDate})` : ""}:`,...q.needs.map((n) => `- ${n.what}: ${n.status === "connected" ? "connected" : `${n.status}${doctor ? ` (doctor: ${doctor.sources.find((x) => x.id === n.id)?.unblock || "-"})` : ""}`}`)];
const volTxt = (v) => (v?.value == null ? "not measured" : `${typeof v.value === "number" ? v.value.toLocaleString("en-US") : v.value}${v.estimate ? " (estimate)" : ""}`);

function q2Lines() {
  if (q2.status === "BLOCKED") return card(q2);
  const f = q2.facts;
  const L = [`The research found ${f.clustersTotal.value} searches worth a page. **${f.clustersWithPage.value} have a page, ${f.clustersMissingPage.value} need a new one**${f.pageNotInSnapshot.value ? `, ${f.pageNotInSnapshot.value} cannot be judged because the page is not in the snapshot sample` : ""}. ${f.weakPages.value ? `${f.weakPages.value} existing page${s(f.weakPages.value)} do${f.weakPages.value === 1 ? "es" : ""} not clearly match the search (wrong ${term("search intent")} or missing words).` : "No existing page is a wrong match for its search."}`, ""];
  if (q2.missing.length) L.push(`Searches with no page yet, most valuable first (demand figures are estimates from the research; report.json gives each source):`, "", "| Search | Where | Type | Demand | Closest page today |", "|---|---|---|---|---|", ...q2.missing.map((m) => `| ${esc(m.search)} | ${esc(m.place || "-")} | ${esc(m.intent)} | ${esc(volTxt(m.volume))} | ${m.closestPage ? `${m.closestPage.path} (${Math.round(m.closestPage.searchWordsCovered * 100)}% of the search words)` : "none"} |`), "");
  const tpl = targets.clusters.filter((c) => /[{}]/.test(c.primaryQuery));
  if (tpl.length) L.push(`Note: ${tpl.length} research row${s(tpl.length)} (${tpl.map((c) => '"' + c.primaryQuery + '"').join(", ")}) ${tpl.length === 1 ? "is" : "are"} a template with an unfilled placeholder, not a real search: expand ${tpl.length === 1 ? "it" : "them"} per town before building.`, "");
  if (q2.weak.length) L.push("Pages that exist but do not match their search:", ...q2.weak.slice(0, 10).map((w) => `- ${w.page} (for "${w.search}"): ${w.issues.map((i) => i.text).join("; ")}`), "");
  const cn = f.cannibalisation;
  if (cn.status) L.push(`- ${term("cannibalisation")}: not checked (${cn.why}). To check: \`${cn.unblock}\``);
  else L.push(`- ${term("cannibalisation")}: ${cn.value ? `${cn.value} problem${s(cn.value)} found by the gate (${cn.details.slice(0, 3).join("; ")})` : "none found by the gate"}`);
  if (f.ranking) L.push(`- Where the site shows up today: ${f.ranking.value.withAPosition} of ${f.ranking.value.queriesTracked} tracked searches have a position in the captured results (${f.ranking.value.localized} were captured for the right place)`);
  if (f.resultsPagesCaptured) L.push(`- ${f.resultsPagesCaptured.value.notLocalized} of ${f.resultsPagesCaptured.value.captures} results pages were captured from a different place than asked, so no city ranking is claimed from them`);
  return L;
}
function q3Lines() {
  if (q3.status === "BLOCKED") return card(q3);
  const L = [q3.scope.trim(), ""];
  if (q3.siteLevel.length) {
    const doms = q3.siteLevel[0].winners.map((w) => w.domain);
    L.push(`| What we compare | Us | ${doms.join(" | ")} |`, `|---|---|${doms.map(() => "---|").join("")}`,
      ...q3.siteLevel.map((r) => `| ${r.measure} | ${r.ours.value} | ${r.winners.map((w) => (Array.isArray(w.value) ? w.value.length : w.value ?? "n/a")).join(" | ")} |`), "", "These are home page figures; the winners' deeper pages are not audited.", "");
  }
  const fm = Object.entries(q3.facts.winningFormats.value).sort((x, y) => y[1] - x[1]);
  L.push(fm.length ? `- What wins the results pages we could read: ${fm.map(([k, n]) => `${k} (${n} search${s(n)})`).join(", ")}. The other searches' captures hold no page addresses, so their format is unknown.` : "- The format of the winning pages could not be read from the captures (they hold no page addresses).");
  const ft = q3.facts.resultFeatures.value;
  if (ft.capturedSearches) L.push(`- On the ${ft.capturedSearches} searches whose results page was captured: ${Object.entries(ft.features).map(([k, n]) => `${k.replace(/_/g, " ")} on ${n}`).join(", ") || "no special results features seen"}.`);
  if (q3.facts.notLocalized) L.push(`- ${q3.facts.notLocalized.value.notLocalized} of ${q3.facts.notLocalized.value.captures} captured results pages were not from the asked place: they show who wins and in what format, not a city ranking.`);
  if (q3.clusterRows.length) {
    L.push("", "Our pages against their searches:");
    for (const r of q3.clusterRows.slice(0, 8)) L.push(`- ${r.page} for "${r.search}": ${r.entitiesMissing.value.length ? `missing ${term("entity")} mentions: ${r.entitiesMissing.value.join(", ")}` : "all required entities present"}; questions not shown as headings: ${r.questionsNotShown.value.notShown} of ${r.questionsNotShown.value.asked}${r.lcpMs ? `; loads in ${sec(r.lcpMs.value)} on a phone` : ""}`);
  } else L.push("", "No existing page matches a researched search yet, so there is no page-to-page comparison; the missing pages are listed in question 2.");
  L.push("", q3.notMeasured);
  return L;
}
function q5Lines() {
  if (q5.status === "BLOCKED") return card(q5);
  const f = q5.facts;
  const L = [`Cited in **${pctTxt(f.citedShare.value)}** of the ${f.answersChecked.value} AI answers read (${f.questionsAsked.value} questions on ${f.engines.value.join(", ")}). ${f.rowsCitingUs.value ? `${f.rowsCitingUs.value} question${s(f.rowsCitingUs.value)} cite${f.rowsCitingUs.value === 1 ? "s" : ""} the site.` : `No question cites the site.`}${f.nameMentioned ? ` It is named without a link in ${pctTxt(f.nameMentioned.value)} of answers.` : ""} An ${term("AI citation")} is an engine naming a site as a source.`, "",
    "Cited instead, most often:", ...f.citedInstead.value.slice(0, 8).map((x) => `- ${x.domain}: ${x.answers} answer${s(x.answers)} (${x.kind === "portal or directory" ? term("portal") + " or directory" : x.kind})`), ""];
  if (q5.why.length) L.push("Why, as far as the data shows:", ...q5.why.map((w) => `- ${w}`), "");
  if (q5.blocked.length) L.push("Not measured yet:", ...q5.blocked.map((b) => `- ${b}`), "");
  return L;
}

// ---------- what changed since the last report ----------
const reportFile = path.join(loc.pewp, "report.json"), prevFile = path.join(loc.pewp, "report.prev.json");
const prevReport = J(reportFile);
const valOf = (f) => (f == null ? null : Array.isArray(f.value) ? f.value.length : typeof f.value === "number" ? f.value : null);
function metricsOf(rep) {
  const out = {}, qn = (n) => rep?.questions?.find((x) => x.n === n);
  const add = (key, label, f, o = {}) => { const v = valOf(f); if (v != null) out[key] = { label, fact: f, v, ...o }; };
  const f1 = qn(1)?.facts || {};
  add("pages", "pages checked", f1.pagesChecked);
  if (f1.rootCauses?.value) { out.causes = { label: "root causes", fact: f1.rootCauses, v: f1.rootCauses.value.total }; out.serious = { label: "serious root causes (critical + high)", fact: f1.rootCauses, v: f1.rootCauses.value.critical + f1.rootCauses.value.high }; }
  add("lcp", "typical phone load time (LCP) in ms", f1.lcpMedianMs, { noise: 0.1 });
  add("aiBlocked", "AI crawlers blocked", f1.aiCrawlersBlocked);
  add("noLd", "pages without structured data", f1.pagesWithoutStructuredData);
  add("noCanon", "pages without a canonical tag", f1.pagesWithoutCanonical);
  const f4 = qn(4)?.facts || {};
  add("refdom", "referring domains", f4.referringDomains); if (f4.inGraph?.value === false) out.refdom = { label: "referring domains", fact: f4.referringDomains, v: null, notFound: true }; add("linkgap", "link gap (sites to ask for a link)", f4.linkGap);
  const f2 = qn(2)?.facts || {};
  add("missing", "searches with no page yet", f2.clustersMissingPage); add("weak", "pages that do not match their search", f2.weakPages); add("cannibal", "pages competing for one search", f2.cannibalisation);
  const f5 = qn(5)?.facts || {};
  add("cited", "share of AI answers that cite the site", f5.citedShare, { pct: true });
  return out;
}
const show = (m, v) => (m.notFound ? NOT_IN_GRAPH : m.pct ? pctTxt(v) : String(v));

// ---------- write ----------
const q6 = { n: 6, q: "What to fix, in order", status: fixes.length || plan.length ? "answered" : "partial", fixes, plan };
const notMeasured = Object.entries(measureRep?.sources || {}).filter(([, v]) => v.status === "BLOCKED").map(([name, v]) => ({ part: name, reason: v.reason, unblock: v.unblock }));
// ---- section 7: the Chrome UX Report and the six importers' files (work order 41, gap list item 5). A source with data gets a block (figures, the file, the capture date, how many captures are stale);
// a source without gets one BLOCKED line saying what unblocks it. Never a zero: a source that was not read is not shown as 0. These sit beside the five questions, they do not change them.
const dayTxt = (iso) => String(iso || "").slice(0, 10) || "date unknown";
const nTxt = (v) => (v == null ? "not shown" : typeof v === "number" ? v.toLocaleString("en-US") : String(v));
const cruxLine = (r) => {
  const m = r.metrics, who = `${r.scope === "origin" ? "the whole site" : "this page"} (${r.target}), ${String(r.formFactor || "").toLowerCase()}`;
  if (r.status !== "data" || !m) return `- ${who}: no data (Google's Chrome UX Report has none: too little traffic; a result, not a failure)`;
  const bits = [m.lcp?.p75 != null && `LCP ${sec(m.lcp.p75)}`, m.inp?.p75 != null && `INP ${Math.round(m.inp.p75)} ms`, m.cls?.p75 != null && `CLS ${m.cls.p75}`].filter(Boolean);
  return `- ${who}: ${bits.join(", ") || "no figures"} for real visitors, 75th percentile${r.collectionPeriod ? ` (collected ${r.collectionPeriod.first} to ${r.collectionPeriod.last})` : ""}`;
};
const EXTRA_IMPORTERS = [
  { id: "index", title: "Pages in the search index", file: "index.json", script: "import-index.mjs", dir: "index", what: "how many pages each engine lists for the site", lines: (d) => {
    const y = d.summary || {}, g = y.google || {}, b = y.bing || {};
    return [`- Google lists ${nTxt(g.indexedCount)} pages for the site (the engine's own count); Bing lists ${nTxt(b.indexedCount)}`,
      `- ${y.servicesListed ?? 0} of ${y.servicesChecked ?? 0} services have a listed page${(y.servicesMissing || []).length ? ` (none for: ${y.servicesMissing.join(", ")})` : ""}`];
  } },
  { id: "trends", title: "Search interest", file: "trends.json", script: "import-trends.mjs", dir: "trends", what: "how much interest there is in each service (Google Trends)", lines: (d) => {
    const y = d.summary || {};
    return [`- ${y.services ?? 0} services compared (${y.scale || "scale not stated"}); strongest: ${y.bestRank?.service ?? "n/a"} (rank ${y.bestRank?.stateRank ?? "n/a"}), weakest: ${y.worstRank?.service ?? "n/a"} (rank ${y.worstRank?.stateRank ?? "n/a"}); rank 1 = most interest`];
  } },
  { id: "ai", title: "AI answers", file: "ai-answers.json", script: "import-ai.mjs", dir: "ai", what: "what AI engines answer to the buyer and brand questions", lines: (d) => {
    const y = d.summary || {}, L = [y.questions > 0 ? `- ${y.namedAnswers ?? 0} of ${y.questions} answers name the business (${pctTxt(y.shareNamed ?? 0)})` : "- No AI answer was read"];
    for (const e of (y.engines || []).filter((x) => x.questions > 0)) L.push(`- ${e.engine}: named in ${e.named} of ${e.questions} answers (${pctTxt(e.shareNamed ?? 0)})`);
    if ((y.blockedEngines || []).length) L.push(`- Not read: ${y.blockedEngines.map((e) => `${e.engine} (${e.reason})`).join(", ")}`);
    if (!(y.questions > 0)) return L;
    if ((y.competitors || []).length) L.push(`- Named most often instead: ${y.competitors.slice(0, 5).map((c) => `${c.name} (${c.count})`).join(", ")}`);
    L.push(`- The business's own domain is ${y.ownDomainCited ? "" : "not "}among the sources the answers cite`);
    return L;
  } },
  { id: "reputation", title: "Reviews", file: "reputation.json", script: "import-reputation.mjs", dir: "reputation", what: "reviews and ratings on the review sites", lines: (d) => (d.summary?.subjects || []).map((x) => `- ${x.subject}: listed on ${x.sitesListed} of ${x.sitesChecked} review sites, ${x.totalReviews} reviews, rating ${x.weightedRating ?? "n/a"} (weighted), ${x.complaints == null ? "complaints not read" : `${x.complaints} complaint${s(x.complaints)}`}${x.newestReviewDate ? `, newest ${x.newestReviewDate}` : ""}`) },
  { id: "social", title: "Social profiles", file: "social.json", script: "import-social.mjs", dir: "social", what: "the business's social profiles", lines: (d) => {
    const y = d.summary || {};
    return [`- ${y.profilesRead ?? 0} profile${s(y.profilesRead ?? 0)} read${y.blocked ? `, ${y.blocked} not readable` : ""}; ${nTxt(y.totalFollowers)} followers in total; active on: ${(y.platformsActive || []).join(", ") || "none"}`,
      `- Links from the site that do not work: ${(y.linksBroken || []).join(", ") || "none"}`];
  } },
  { id: "ads", title: "Ads", file: "ads.json", script: "import-ads.mjs", dir: "ads", what: "which advertisers are running ads (the ad libraries)", lines: (d) => {
    const y = d.summary || {}, nk = y.advertisersNotKnown ?? 0;
    return [`- ${y.advertisersRunning ?? 0} of ${y.advertisersChecked ?? 0} advertisers are running ads; ${y.clientRunning == null ? "whether the business itself is running ads is not known" : `the business itself is ${y.clientRunning ? "" : "not "}running ads`}; competitors running: ${y.competitorsRunning ?? 0}`, ...(nk ? [`- Not known: ${nk} advertiser${s(nk)} whose ad library page could not be read or tied to the business (not counted above, and not "no ads")`] : [])];
  } },
];
function computeExtras() {
  const out = [], blockedOf = (id, title, why, unblock) => ({ id, title, status: "BLOCKED", why, unblock });
  // crux: the newest dated file in <pewp>/crux/
  const cdir = path.join(loc.pewp, "crux");
  const cfile = fs.existsSync(cdir) ? fs.readdirSync(cdir).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().at(-1) : null;
  const cdoc = cfile ? J(path.join(cdir, cfile)) : null;
  if (!cdoc || !Array.isArray(cdoc.rows) || !cdoc.rows.length) out.push(blockedOf("crux", "Real-visitor speed (Chrome UX Report)", "no Chrome UX Report file for this site (crux.mjs has not run, or every request failed)", `set CRUX_API_KEY (a free Google Cloud key with the Chrome UX Report API enabled), then run node scripts/crux.mjs ${loc.target}`));
  else {
    const data = cdoc.rows.some((r) => r.status === "data");
    out.push({ id: "crux", title: "Real-visitor speed (Chrome UX Report)", status: data ? "answered" : "no data", source: rel(path.join(cdir, cfile)), capturedAt: cdoc.generatedAt || null, lines: [...cdoc.rows.map(cruxLine), ...((cdoc.failures || []).length ? [`- ${cdoc.failures.length} request${s(cdoc.failures.length)} failed and ${cdoc.failures.length === 1 ? "is" : "are"} not counted`] : [])] });
  }
  for (const imp of EXTRA_IMPORTERS) {
    const file = path.join(rdir, imp.file), doc = fs.existsSync(file) ? J(file) : null;
    if (!doc || !Array.isArray(doc.rows) || !doc.rows.length) { out.push(blockedOf(imp.id, imp.title, doc ? `${imp.file} holds no usable capture (${(doc.rejected || []).length} rejected)` : `no ${imp.file}: ${imp.what} was not captured`, `capture it in the owner's browser into ${rel(path.join(loc.pewp, "captures", imp.dir))}/ (stages/research.md), then run node scripts/${imp.script} ${loc.target}`)); continue; }
    const at = doc.rows.map((r) => r.capturedAt).filter(Boolean).sort().at(-1) || null, stale = doc.staleCount ?? doc.rows.filter((r) => r.stale).length;
    out.push({ id: imp.id, title: imp.title, status: "answered", source: rel(file), capturedAt: at, stale, lines: imp.lines(doc), summary: doc.summary ?? null });
  }
  return out;
}
const extras = computeExtras();
const extraLines = extras.flatMap((x) => [`### ${x.title}`, "",
  ...(x.status === "BLOCKED" ? [`**BLOCKED.** ${x.why} | unblocks: ${x.unblock}`] : [...x.lines, "", `Source: ${x.source}, captured ${dayTxt(x.capturedAt)}${x.stale ? `; ${x.stale} capture${s(x.stale)} stale (older than the freshness limit: capture again)` : ""}.`]), ""]);
const report = { url: loc.target, host: loc.host, writtenAt: new Date().toISOString(), snapshot: rel(snapDir), launchState, shortAnswer: oneLine,
  doctor: doctor ? { checkedAt: doctor.checkedAt || null, stale: doctorStale, staleBecause: doctorCheck.why, hasInputHashes: doctorCheck.hashed } : null,
  inputs: { targets: targets ? rel(targetsFile) : null, research: fs.existsSync(rdir) ? rel(rdir) : null, measure: measureDir ? rel(measureDir) : null, gate: gateR ? rel(gateFile) : null, authority: auth ? rel(path.resolve(authFile)) : null },
  questions: [
    { n: 1, q: "Can search engines and AI crawlers reach and read the site?", status: "answered", problems: problemsQ1, facts: q1Facts },
    { n: 2, q: "Is there a page for what people actually search?", ...q2 },
    { n: 3, q: "Is each page better than what ranks now?", ...q3 },
    { n: 4, q: "Does the site have the authority to rank?", ...q4 },
    { n: 5, q: "Is it cited by AI engines? If not, who is, and why?", ...q5 },
    q6,
  ], extras: Object.fromEntries(extras.map(({ id, lines, ...rest }) => [id, rest])), notMeasured };
let sinceLine = null;
if (prevReport?.writtenAt && prevReport.questions) {
  const pm = metricsOf(prevReport), cm = metricsOf(report);
  const changes = [], statusChanges = [];
  let same = 0;
  for (const key of Object.keys(cm)) {
    if (!pm[key]) continue;
    const b = pm[key].v, n = cm[key].v;
    const noise = cm[key].noise && b ? Math.abs(n - b) / b < cm[key].noise : false;
    if (b === n || noise) { same++; continue; }
    changes.push({ metric: key, label: cm[key].label, before: fact(b, `previous report.json written ${dayOf(prevReport.writtenAt)}`, prevReport.writtenAt, rel(prevFile)), after: cm[key].fact, afterValue: n, beforeText: show(pm[key], b), afterText: show(cm[key], n) });
  }
  for (const q of report.questions) { const was = prevReport.questions.find((x) => x.n === q.n)?.status; if (was && q.status !== was) statusChanges.push({ n: q.n, before: was, after: q.status }); }
  report.sinceLast = { since: prevReport.writtenAt, previousSnapshot: prevReport.snapshot, changes, statusChanges, unchangedMetrics: same };
  const bits = [...statusChanges.map((c) => `question ${c.n} went from ${c.before} to ${c.after}`), ...changes.map((c) => `${c.label}: ${c.beforeText} to ${c.afterText}`)];
  sinceLine = `**Since the last report (${dayOf(prevReport.writtenAt)}):** ${bits.length ? bits.join("; ") + "." : `nothing measured has changed (${same} figure${s(same)} compared).`}`;
}

const md = [
  `# Search check: ${loc.host}`,
  "",
  `**Short answer:** ${oneLine}`,
  "",
  ...(sinceLine ? [sinceLine, ""] : []),
  `Checked ${TODAY} from a snapshot taken ${String(snapAt).slice(0, 16).replace("T", " ")} UTC (${pages.length} pages). Site state: ${launchState}.${launchState === "preview" ? " A preview hides itself from search on purpose, so its noindex is not counted as a problem." : ""}`,
  "",
  "## 1. Can search engines and AI crawlers reach and read the site?",
  "",
  problemsQ1.length ? `Mostly yes, with ${problemsQ1.length} problem${s(problemsQ1.length)}:` : "Yes.",
  ...problemsQ1.map((p) => `- ${p}`),
  "",
  `- ${term("robots.txt")}: status ${robots.status ?? "none"}; ${term("AI crawler")}s blocked: ${blockedBots.length ? blockedBots.join(", ") : "none"}`,
  `- ${term("sitemap file")}: ${sitemaps.urlCount ?? 0} addresses listed`,
  `- Pages left out of search (${term("noindex")}): ${noindexPages.length}${launchState === "preview" ? " (by design: preview)" : ""}`,
  `- Pages without a ${term("canonical")} tag: ${noCanonical.length}; without a description: ${noDesc.length}; without exactly one main heading: ${badH1.length}`,
  `- Pages without ${term("structured data")}: ${noLd.length}; without sharing tags: ${noOg.length}`,
  `- Phone speed (lab): typical ${term("LCP")} ${sec(speed.lcpMedianMs.value)} (slowest ${sec(speed.lcpWorst?.value)}, ${speed.lcpWorst?.source || "-"}); typical ${term("TBT")} ${sec(speed.tbtMedianMs.value)}; worst ${term("CLS")} ${speed.clsWorst?.value ?? "n/a"}; heaviest page ${speed.heaviestKb ? `${(speed.heaviestKb.value / 1024).toFixed(1)} MB` : "n/a"}${labUntrusted ? " (UNTRUSTED, see below)" : ""}`,
  ...speedTrustLines,
  causes ? `- The checklist (${RULES}) found ${causes.length} ${term("root cause")}s: ${count("critical")} critical, ${count("high")} high, ${count("medium")} medium, ${count("low")} low (fix order in section 6)` : `- The shipgate checklist (${RULES}) has not run on this snapshot yet: run the skill's checker on the snapshot folder.`,
  "",
  "## 2. Is there a page for what people actually search?",
  "",
  ...doctorLines,
  ...q2Lines(),
  "",
  "## 3. Is each page better than what ranks now?",
  "",
  ...q3Lines(),
  "",
  "## 4. Does the site have the authority to rank?",
  "",
  ...(q4.status === "answered"
    ? [inGraphQ4 ? `- ${term("referring domain")}s: ${q4.facts.referringDomains.value} (strength rank ${q4.facts.strengthRank.value?.toLocaleString("en-US") ?? "not ranked"}; 1 = strongest site on the web)` : `- ${term("referring domain")}s: ${NOT_IN_GRAPH} (the link data holds no record of this site; that is not the same as 0)`,
       ...q4.facts.competitors.value.map((c) => c.inGraph === false ? `- Competitor ${c.domain}: ${NOT_IN_GRAPH}` : `- Competitor ${c.domain}: ${c.referringDomains} referring domains, strength rank ${c.strengthRank?.toLocaleString("en-US") ?? "not ranked"}`),
       inGraphQ4 ? `- ${term("link gap")}: ${q4.facts.linkGap.value} sites${gapTop8}` : `- sites that link to two or more competitors: ${q4.facts.linkGap.value}${gapTop8}; whether they already link to this site cannot be judged (the site is ${NOT_IN_GRAPH})`,
       `- Strongest sites linking here: ${inGraphQ4 ? q4.strongestLinkers.join(", ") || "none" : NOT_IN_GRAPH}`,
       "", `Source: ${auth.source}, ${auth.fetchedAt.slice(0, 10)}. Common Crawl sees fewer links than paid tools: compare sites with each other, not as absolute numbers.`]
    : [`**BLOCKED.** ${q4.why}.`, "", `What unblocks it: ${q4.unblock}`]),
  "",
  "## 5. Is it cited by AI engines? If not, who is, and why?",
  "",
  ...q5Lines(),
  "",
  "## 6. What to fix, in order",
  "",
  ...(fixes.length ? ["| # | Severity | Problem | Fix | Pages | Proved by |", "|---|---|---|---|---|---|", ...fixes.map((f) => `| ${f.order} | ${f.severity} | ${String(f.problem).replace(/\|/g, "\\|").slice(0, 220)} | ${String(f.fix).replace(/\|/g, "\\|").slice(0, 220)} | ${f.pagesAffected ?? "-"} | ${f.provedBy} |`)] : ["No checker results yet (see section 1)."]),
  ...(plan.length ? ["", "Then the plan from the research (effort is a judgement by kind of work; the impact figure is the research's own priority number, higher first):", "", "| # | What | Effort | Proved by |", "|---|---|---|---|", ...plan.map((p) => `| ${p.order} | ${esc(p.what)} | ${esc(p.effort)} | ${esc(p.provedBy)} |`)] : []),
  "",
  blockedQs.length ? `Then, to answer question${s(blockedQs.length)} ${blockedQs.join(", ")}: connect the sources listed there (all free).` : "Every question above has data behind it.",
  ...(notMeasured.length ? ["", "Not measured yet (the sources are not connected):", ...notMeasured.map((n) => `- ${n.part}: ${n.reason}. To unblock: ${n.unblock}`)] : []),
  "",
  "## 7. What else was measured",
  "",
  "Sources beside the five questions: real visitors' speed and what the owner's browser captured. A source with no data is listed with what would unblock it; none is shown as zero.",
  "",
  ...extraLines,
  "## Words used",
  "",
  ...Object.entries(GLOSSARY).filter(([t]) => used.has(t)).map(([t, d]) => `- **${t}**: ${d}`),
  "",
];
report.glossary = Object.fromEntries(Object.entries(GLOSSARY).filter(([t]) => used.has(t)));
fs.mkdirSync(loc.pewp, { recursive: true });
if (prevReport?.writtenAt) fs.copyFileSync(reportFile, prevFile);
fs.writeFileSync(path.join(loc.pewp, "report.md"), md.join("\n"));
fs.writeFileSync(reportFile, JSON.stringify(report, null, 1) + "\n");
if (load(loc)) markStage(loc, "report", { "report.md": path.join(loc.pewp, "report.md"), "report.json": reportFile });
console.log(oneLine);
console.log(`wrote ${path.join(loc.pewp, "report.md")} and report.json`);
