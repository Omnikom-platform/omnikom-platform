// Usage: node test-compare.mjs [--scripts <dir>] [--quiet] [--mutants [--only <id>]]
// Self-test of `compare.mjs` and of the research / measure / gate wiring of `report-live.mjs` (Q2, Q3, Q5, "what changed since the last
// report") on FIXTURES ONLY: a temp folder with two fake snapshots (an old live site and a new preview), their checker results,
// authority, research, measure and gate files. NETWORK GUARD: every child process refuses any request that is not to 127.0.0.1 and logs
// the attempt; the last check asserts the log is empty. Every check has a stable name; `--mutants` breaks ONE thing per check in a copy
// of the scripts (the patch asserts its target text exists, so "the patch never applied" cannot pass as green) and requires the NAMED
// check to go red. Exit 0 = all pass.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : path.dirname(fileURLToPath(import.meta.url)));
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const MUT = [
    { id: "median-becomes-max", file: "compare.mjs", from: "return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };\nconst dayOf", to: "return v.length ? v[v.length - 1] : null; };\nconst dayOf", red: "compare: speed medians" },
    { id: "better-flipped", file: "compare.mjs", from: '(va < vb) === lower ? "a" : "b"', to: '(va < vb) === lower ? "b" : "a"', red: "compare: the better side" },
    { id: "fixed-match-inverted", file: "compare.mjs", from: "fixedFromA = A.causes.filter((c) => !rulesKey(c).some((r) => bRules.has(r)))", to: "fixedFromA = A.causes.filter((c) => !rulesKey(c).some((r) => !bRules.has(r)))", red: "compare: what B fixes" },
    { id: "preview-by-design-off", file: "compare.mjs", from: 'const byDesignB = B.launchState === "preview" && (', to: "const byDesignB = false && (", red: "compare: a preview's" },
    { id: "not-checked-becomes-zero", file: "compare.mjs", from: 'for (const k of [...SEV, "causes"]) m[k] = fact(null,', to: 'for (const k of [...SEV, "causes"]) m[k] = fact(0,', red: "compare: a side without checker results" },
    { id: "option-warning-off", file: "compare.mjs", from: "if ((sa.runs || 1) !== (sb.runs || 1))", to: "if (false)", red: "compare: warns when the snapshots" },
    { id: "authority-own-file-only", file: "compare.mjs", from: "for (const holder of [side, other])", to: "for (const holder of [side])", red: "compare: referring domains" },
    { id: "not-in-graph-is-zero", file: "compare.mjs", from: "fact(r.inGraph ? r.linkingDomains : null, `${src}", to: "fact(r.inGraph ? r.linkingDomains : 0, `${src}", red: "compare: a site the link graph does not hold" },
    { id: "not-in-graph-cell-says-n/a", file: "compare.mjs", from: "if (v == null) return f.notInGraph ? NOT_FOUND : \"n/a\";", to: "if (v == null) return \"n/a\";", red: "compare: a site the link graph does not hold" },
    { id: "not-in-graph-short-answer-silent", file: "compare.mjs", from: "  else for (const [x, f] of [[A, ref.a], [B, ref.b]]) if (f?.notInGraph) bits.push(", to: "  else for (const [x, f] of [[A, ref.a], [B, ref.b]]) if (false) bits.push(", red: "compare: a site the link graph does not hold" },
    { id: "not-in-graph-not-flagged", file: "compare.mjs", from: "const notIn = r.inGraph ? {} : { notInGraph: true };", to: "const notIn = {};", red: "compare: a site the link graph does not hold" },
    { id: "strict-ignored", file: "compare.mjs", from: 'if (a.includes("--strict") && warns.length)', to: "if (false)", red: "compare: --strict" },
    { id: "same-pages-not-matched", file: "compare.mjs", from: "const pb = bm.get(pa.path); if (!pb) continue;", to: "const pb = bm.get(pa.path) || pa;", red: "compare: the same pages" },
    { id: "structured-data-denominator", file: "compare.mjs", from: "Math.round((withLd.length / bp.length) * 100), `${withLd.length} of ${bp.length} rendered", to: "Math.round((withLd.length / Math.max(1, bp.length - 1)) * 100), `${withLd.length} of ${bp.length} rendered", red: "compare: structured data coverage" },
    { id: "ai-crawler-allowed-always", file: "compare.mjs", from: "const blocked = AI_BOTS.filter((b) => !allowedRoot(side.robots, b));", to: "const blocked = [];", red: "compare: AI crawler access" },
    { id: "repo-speed-invented", file: "compare.mjs", from: "for (const k of [\"lcp\", \"lcpWorst\", \"tbt\", \"cls\", \"kb\", \"kbHeaviest\", \"requests\"]) m[k] = NM(nm);", to: "for (const k of [\"lcp\", \"lcpWorst\", \"tbt\", \"cls\", \"kb\", \"kbHeaviest\", \"requests\"]) m[k] = fact(0, \"repo\", at, side.rel(side.loc.root));", red: "compare: a repo side" },
    { id: "q2-weak-page-not-flagged", file: "report-live.mjs", from: 'if (overlap(c.primaryQuery, head) < THRESHOLD) out.push({ kind: "query"', to: 'if (false) out.push({ kind: "query"', red: "report: Q2 counts" },
    { id: "q2-gate-ignored", file: "report-live.mjs", from: 'const g = gateR?.checks?.find((x) => x.id === "GT-003");', to: "const g = null;", red: "report: Q2 counts" },
    { id: "q2-new-page-counted-as-existing", file: "report-live.mjs", from: "const have = rows.filter((r) => r.page),", to: "const have = rows,", red: "report: Q2 counts" },
    { id: "q3-entities-never-missing", file: "report-live.mjs", from: "const entMissing = (c.requiredEntities || []).filter((e) => !seqContains(tokP, e));", to: "const entMissing = [];", red: "report: Q3" },
    { id: "q5-unweighted-share", file: "report-live.mjs", from: "* runsOf(r), 0) / totalRuns;", to: "* 1, 0) / rows.length;", red: "report: Q5 share" },
    { id: "q5-portal-flag-lost", file: "report-live.mjs", from: 'kind: portals.has(domain) ? "portal or directory"', to: 'kind: false ? "portal or directory"', red: "report: Q5 who is cited" },
    { id: "since-last-never-differs", file: "report-live.mjs", from: "if (b === n || noise) { same++; continue; }", to: "if (true) { same++; continue; }", red: "report: what changed" },
    { id: "q2-always-answered-without-targets", file: "report-live.mjs", from: "if (!targets?.clusters?.length) return null;", to: "if (false) return null;", red: "report: Q2, Q3 and Q5 stay BLOCKED" },
    { id: "main-check-exact-path", file: "lib-main.mjs", from: "try { return norm(fs.realpathSync(arg)) === norm(fs.realpathSync(me)); }", to: "try { return norm(arg) === norm(fs.realpathSync(me)); }", red: "compare: started through a junction" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-cmut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    // other sessions may be editing the scripts folder (editors leave temp files): skip extension-less entries and retry a racy copy
    for (let n = 0; ; n++) { try { fs.rmSync(copy, { recursive: true, force: true }); fs.cpSync(skill, copy, { recursive: true, filter: (p) => !/[\\/](runs|site-checks|fixtures|\.git)([\\/]|$)/.test(p) && !/[\\/]scripts[\\/][^\\/.]+$/.test(p) }); break; } catch (e) { if (n >= 4) throw e; } }
    const f = path.join(copy, "scripts", m.file), src = fs.readFileSync(f, "utf8");
    if (src.split(m.from).length !== 2) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY exactly once (${src.split(m.from).length - 1} matches of the target text in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, [path.join(copy, "scripts", "test-compare.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => c.kill(), 240000);
    c.on("close", (code) => {
      clearTimeout(t);
      const failed = (out.match(/^FAIL .*$/gm) || []).map((l) => l.slice(5));
      const hit = failed.some((n) => n.startsWith(m.red));
      resolve({ good: code !== 0 && hit, line: `MUTANT ${m.id}: ${code === 0 ? "STAYED GREEN (the check measures nothing)" : hit ? "red for the right reason" : "red, but NOT the expected check"} | expected "${m.red}" | failed: ${failed.map((x) => x.slice(0, 70)).join(" ; ").slice(0, 200) || "(none)"}` });
    });
  });
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const queue = MUT.filter((m) => !only || m.id === only);
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) { const r = await runOne(queue.shift()); console.log(r.line); if (r.good) ok++; else process.exitCode = 1; } }));
  console.log(`mutants: ${ok}/${only ? 1 : MUT.length} red for the right reason`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}

// ---------------------------------------------------------------- the test
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-cmp-"));
const guardFile = path.join(tmp, "netguard.mjs"), netLog = path.join(tmp, "net-attempts.log");
fs.writeFileSync(guardFile, `import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
const log = (u) => { if (process.env.PEWP_NETGUARD_LOG) fs.appendFileSync(process.env.PEWP_NETGUARD_LOG, u + "\\n"); };
const local = (h) => /^(127\\.0\\.0\\.1|localhost|\\[::1\\])$/.test(h || "");
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => { const url = typeof input === "string" ? input : input?.url ?? String(input); let h = ""; try { h = new URL(url).hostname; } catch {} if (!local(h)) { log(url); return Promise.reject(new Error("NETWORK GUARD: refused non-local request " + url)); } return realFetch(input, init); };
for (const mod of [http, https]) for (const fn of ["request", "get"]) { const real = mod[fn]; mod[fn] = function (...a) { const o = a[0]; const h = typeof o === "string" ? (() => { try { return new URL(o).hostname; } catch { return ""; } })() : o instanceof URL ? o.hostname : (o?.hostname || o?.host || ""); if (!local(String(h).replace(/:\\d+$/, ""))) { log(fn + " " + h); throw new Error("NETWORK GUARD: refused non-local request " + h); } return real.apply(this, a); }; }
syncBuiltinESMExports();
`);
process.env.NODE_OPTIONS = `--import ${pathToFileURL(guardFile).href}`;
process.env.PEWP_NETGUARD_LOG = netLog;
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 700) });
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof s === "string" || Buffer.isBuffer(s) ? s : JSON.stringify(s, null, 1)); };
const J = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const node = (script, a, o = {}) => spawnSync(process.execPath, [path.join(dir, script), ...a], { encoding: "utf8", timeout: 120000, ...o });
const NOW = new Date().toISOString();
const isFact = (f) => f && typeof f === "object" && "value" in f && !!f.source && !!f.fetchedAt && "cacheFile" in f && !!f.cacheFile;
const facts = (o, out = []) => { if (o && typeof o === "object") { if (!Array.isArray(o) && "value" in o && "source" in o) out.push(o); else Object.values(o).forEach((v) => facts(v, out)); } return out; };
const F = (value, source, extra = {}) => ({ value, source, fetchedAt: "2026-10-17T00:00:00.000Z", cacheFile: "captures/x.json", ...extra });

// ---- fixture: a snapshot ----
function snapshot(host, o) {
  const sd = path.join(tmp, "site-checks", host, "snapshots", (o.date || NOW.slice(0, 10)));
  const pages = o.pages.map((p, i) => ({ url: `https://${host}${p.path}`, finalUrl: `https://${host}${p.path}`, slug: p.slug, status: 200 }));
  w(path.join(sd, "_site.json"), { url: `https://${host}/`, finishedAt: o.finishedAt || NOW, runs: o.runs ?? 3, ignoreRobots: !!o.ignoreRobots, excludes: [], include: [], browser: o.browser || "Chrome/155.0", stoppedEarly: null, pages });
  w(path.join(sd, "site/robots.json"), { status: 200, groups: o.robots });
  w(path.join(sd, "site/sitemaps.json"), { urlCount: o.pages.length });
  w(path.join(sd, "site/probes.json"), { notFound: { finalStatus: 404 } });
  for (const p of o.pages) {
    w(path.join(sd, "pages", p.slug, "browser-mobile.json"), { url: `https://${host}${p.path}`, measuredAt: NOW, conditions: o.conditions || { width: 412, cpu: 4, latency: 150 },
      vitals: { lcpMs: p.lcp, tbtMs: p.tbt, cls: p.cls ?? 0.01 }, totals: { bytes: p.kb * 1024, requests: p.req ?? 30 },
      page: { canonical: `https://${host}${p.path}`, metaDescription: "d", h1Count: 1, structuredData: p.ld ? [{ ok: true, types: p.ld }] : [], og: { "og:title": "t" }, robotsMeta: o.noindex ? ["robots: noindex, nofollow"] : [] } });
    w(path.join(sd, "pages", p.slug, "response.json"), { url: `https://${host}${p.path}`, finalUrl: `https://${host}${p.path}`, status: 200, headers: {} });
    w(path.join(sd, "pages", p.slug, "raw.html.gz"), zlib.gzipSync(`<!doctype html><html><head><title>${p.title}</title></head><body><main><h1>${p.h1}</h1><p>${p.body || "We help local businesses get found online with clear honest work every single week."}</p></main></body></html>`));
  }
  if (o.causes) w(path.join(sd, ".checks", "causes.json"), o.causes);
  return sd;
}
const pg = (slug, p, lcp, tbt, kb, ld, title, h1) => ({ slug, path: p, lcp, tbt, kb, ld, title, h1 });
const ROBOTS_A = [{ agents: ["*"], rules: [] }, { agents: ["gptbot"], rules: [{ allow: false, path: "/" }] }, { agents: ["ccbot"], rules: [{ allow: false, path: "/" }] }];
const ROBOTS_ALL = [{ agents: ["*"], rules: [{ allow: false, path: "/" }] }];
const cause = (id, severity, rules, problem, pages = 1) => ({ id, severity, rules, problem, fix: `fix ${id}`, pages, fixAt: ["lib.mjs"], scripts: ["check-1.mjs"] });
const CAUSES_A = [cause("a1", "high", ["URL-004"], "no canonical tag", 5), cause("a2", "high", ["SCH-001"], "no structured data", 4), cause("a3", "medium", ["PRF-001"], "slow LCP", 5), cause("a4", "low", ["MET-004"], "long title", 2), cause("a5", "critical", ["IDX-009"], "sitemap lists 404 pages", 1)];
const CAUSES_B = [cause("b1", "medium", ["PRF-001", "PRF-002"], "slow LCP on two pages", 2), cause("b2", "high", ["A11-003"], "form fields labelled only by placeholder", 3), cause("b3", "low", ["NEW-001"], "missing favicon", 1)];
const SRC = (p) => p;

const PAGES_A = [pg("home", "/", 4000, 900, 3000, ["WebPage"], "Old Co home", "Welcome"), pg("about", "/about", 4500, 800, 2900, null, "About Old Co", "About us"), pg("services", "/services", 5000, 1200, 3100, null, "Web Design Services | Old Co", "Web Design Services"),
  pg("blog", "/blog/post-1", 5200, 700, 3300, null, "Post one", "Post one"), pg("contact", "/contact", 6000, 1500, 3000, null, "Contact", "Contact")];
const PAGES_B = [pg("home", "/", 1800, 100, 800, ["WebPage", "Organization"], "New Co home", "Welcome"), pg("about", "/about", 2000, 120, 700, ["WebPage"], "About New Co", "About us"), pg("services", "/services", 2100, 150, 900, ["WebPage", "Service"], "Web Design Services | New Co", "Web Design Services"),
  pg("blog", "/blog/post-1", 2200, 90, 850, ["BlogPosting"], "Post one", "Post one"), pg("pricing", "/pricing", 2400, 200, 950, ["WebPage"], "Pricing plans", "Pricing plans")];

try {
  const A = "old.test", B = "new.test";
  snapshot(A, { pages: PAGES_A, robots: ROBOTS_A, causes: CAUSES_A });
  snapshot(B, { pages: PAGES_B, robots: ROBOTS_ALL, causes: CAUSES_B, noindex: true, ignoreRobots: true });
  const pa = path.join(tmp, "site-checks", A, ".pewp"), pb = path.join(tmp, "site-checks", B, ".pewp");
  w(path.join(pb, "business.json"), { name: "New Co", domain: B, launchState: "preview" });
  w(path.join(pa, "authority.json"), { fetchedAt: "2026-10-22T07:00:00.000Z", source: "Common Crawl web graph cc-test (domain level)", results: [{ domain: A, role: "target", inGraph: true, linkingDomains: 12, harmonicPos: 1000, strongestLinkingDomains: [{ domain: "big.test" }] }, { domain: B, inGraph: false, note: "not in this Common Crawl release (too few links or not crawled)" }], linkGap: [{ domain: "gap.test", linksToCompetitors: 2, harmonicPos: 50 }] });
  // research, gate, measure for A (also used by the report-live checks)
  w(path.join(pa, "targets.json"), { version: 1, business: A, market: { country: "US", language: "en" }, createdAt: "2026-10-18T00:00:00.000Z", clusters: [
    { id: "c-web-design-services", primaryQuery: "web design services", queries: ["web design services"], intent: "commercial", location: null, volume: F(900, "Keyword Planner export", { estimate: true }), difficulty: null, value: null, serpFeatures: F(["paa"], "browser capture"), winningFormat: "service or city landing page", competitorsTop3: [{ url: "https://rival.test/web-design", domain: "rival.test" }], requiredEntities: ["Seattle", "WordPress"], questions: ["How much does web design cost?"], targetPage: "/services", priority: 6 },
    { id: "c-emergency-plumber-seattle", primaryQuery: "emergency plumber seattle", queries: ["emergency plumber seattle"], intent: "local", location: "Seattle, WA", volume: F(300, "Bing"), difficulty: null, value: null, serpFeatures: F([], "NOT CAPTURED"), winningFormat: "unknown (no capture yet)", competitorsTop3: [], requiredEntities: [], questions: [], targetPage: "/about", priority: 4 },
    { id: "c-pricing-plans", primaryQuery: "pricing plans", queries: ["pricing plans"], intent: "transactional", location: null, volume: F(500, "Keyword Planner export", { estimate: true }), difficulty: null, value: null, serpFeatures: F([], "NOT CAPTURED"), winningFormat: "unknown", competitorsTop3: [], requiredEntities: [], questions: [], targetPage: "new", priority: 7 }] });
  w(path.join(pa, "gate", "report.json"), { ranAt: "2026-10-20T00:00:00.000Z", status: "FAIL", checks: [{ id: "GT-003", name: "no-cannibalisation", status: "FAIL", summary: "1 cannibalisation problem(s)", details: ['"web design services" (c-web-design-services) is targeted by 2 pages: /services, /web-design'] }] });
  w(path.join(pa, "research", "competitors.json"), { step: "competitors", status: "ok", generatedAt: "2026-10-17T00:00:00.000Z", sites: [{ domain: "rival.test", status: 200, fetchedAt: "2026-10-17T00:00:00.000Z", page: { words: 2100, h2: new Array(12).fill("h") }, schema: { types: ["LocalBusiness", "FAQPage"], questions: 4 }, facts: { homeWords: F(2100, "seo-kit audit of rival.test"), schemaTypes: F(["LocalBusiness", "FAQPage"], "seo-kit audit of rival.test"), faqQuestions: F(4, "seo-kit audit of rival.test"), aiSearchBotsBlocked: F([], "seo-kit audit of rival.test") } }, { domain: "blocked.test", status: 403 }] });
  w(path.join(pa, "research", "clusters.json"), { step: "clusters", status: "ok", portals: ["portal.test"], clusters: [] });
  w(path.join(pa, "research", "serp.json"), { step: "serp", status: "ok", generatedAt: "2026-10-17T00:00:00.000Z", counts: { captures: 10, notLocalized: 9 } });
  w(path.join(pa, "research", "ai-citations.json"), { step: "ai-citations", status: "ok", generatedAt: "2026-10-17T00:00:00.000Z", rows: [
    { question: "best web designer", engine: "chatgpt", runs: 3, citedShare: F(1 / 3, "owner capture"), citedSources: ["portal.test", "rival.test"], sourceCounts: { "portal.test": 3, "rival.test": 1, "accounts.google.com": 2 }, ourDomainCited: true, lowRuns: false },
    { question: "web design cost", engine: "gemini", runs: 1, citedShare: F(0, "owner capture"), citedSources: ["portal.test"], sourceCounts: { "portal.test": 1 }, ourDomainCited: false, lowRuns: true }] });
  w(path.join(pa, "measure", "2026-10-20", "report.json"), { sources: { "Search Console": { status: "BLOCKED", reason: "no token", unblock: "add a token" } } });

  // ================= compare.mjs: old (live) vs new (preview) =================
  const run = (extra = []) => node("compare.mjs", [`https://${A}/`, `https://${B}/`, "--cwd", tmp, "--launch-state-b", "preview", ...extra]);
  const r1 = run();
  const cdir = path.join(tmp, "site-checks", `compare-${A}-vs-${B}`);
  const md = fs.existsSync(path.join(cdir, "compare.md")) ? fs.readFileSync(path.join(cdir, "compare.md"), "utf8") : "";
  const cj = J(path.join(cdir, "compare.json"));
  const rowOf = (key) => cj?.rows.find((r) => r.key === key);
  check("compare: writes compare.md and compare.json under site-checks/compare-<a>-vs-<b>", r1.status === 0 && md.startsWith("# Compare: old.test (A) vs new.test (B)") && cj?.rows?.length > 15, r1.stdout + r1.stderr);
  const groups = [...new Set(cj?.rows.map((r) => r.group))];
  check("compare: the side-by-side table covers speed, weight, structured data, root causes by severity, AI crawler access, referring domains", ["1 speed", "2 page weight", "3 structured data", "4 root causes", "5 AI crawler access", "6 referring domains"].every((g) => groups.includes(g)) && ["critical", "high", "medium", "low"].every((sv) => rowOf(sv)) && /\| Measure \| A \| B \| Better \|/.test(md), groups.join(","));
  check("compare: speed medians are the median of the page values (A 5000 ms, B 2100 ms)", rowOf("lcp")?.a.value === 5000 && rowOf("lcp")?.b.value === 2100 && rowOf("tbt")?.a.value === 900 && rowOf("lcpWorst")?.a.value === 6000, JSON.stringify([rowOf("lcp")?.a.value, rowOf("lcp")?.b.value, rowOf("tbt")?.a.value]));
  check("compare: the better side (lower wins for times and problems, higher for coverage)", rowOf("lcp")?.better === "b" && rowOf("kb")?.better === "b" && rowOf("ldPct")?.better === "b" && rowOf("causes")?.better === "b" && rowOf("referring")?.better === null && rowOf("strength")?.better === null, JSON.stringify(["lcp", "kb", "ldPct", "causes", "referring", "strength"].map((k) => [k, rowOf(k)?.better])));
  check("compare: page weight is the median page weight in KB", rowOf("kb")?.a.value === 3000 && rowOf("kb")?.b.value === 850 && rowOf("kbHeaviest")?.a.value === 3300, JSON.stringify([rowOf("kb")?.a.value, rowOf("kb")?.b.value]));
  check("compare: structured data coverage = pages with JSON-LD over pages rendered (A 1 of 5 = 20%, B 100%)", rowOf("ldPct")?.a.value === 20 && rowOf("ldPct")?.b.value === 100 && rowOf("ldPct")?.a.counts.with === 1 && rowOf("ldTypes")?.b.value.includes("BlogPosting"), JSON.stringify([rowOf("ldPct")?.a, rowOf("ldPct")?.b]));
  check("compare: root causes counted by severity", ["critical", "high", "medium", "low"].every((sv, i) => rowOf(sv)?.a.value === [1, 2, 1, 1][i] && rowOf(sv)?.b.value === [0, 1, 1, 1][i]) && rowOf("causes")?.a.value === 5, JSON.stringify(["critical", "high", "medium", "low"].map((sv) => [rowOf(sv)?.a.value, rowOf(sv)?.b.value])));
  check("compare: AI crawler access lists what robots.txt refuses; a preview's blanket block is by design", JSON.stringify(rowOf("aiBlocked")?.a.value) === JSON.stringify(["GPTBot", "CCBot"]) && rowOf("aiBlocked")?.b.value.length === 11 && rowOf("aiBlocked")?.b.byDesign === true && rowOf("aiBlocked")?.byDesign === true, JSON.stringify([rowOf("aiBlocked")?.a.value, rowOf("aiBlocked")?.b.value?.length]));
  check("compare: referring domains come from the authority run, also when only the other side's file holds the domain", rowOf("referring")?.a.value === 12 && rowOf("referring")?.b.value === null && /found in old\.test's authority run/.test(rowOf("referring")?.b.source) && rowOf("strength")?.a.value === 1000, JSON.stringify([rowOf("referring")?.a.value, rowOf("referring")?.b.value, rowOf("referring")?.b.source]));
  // work order 28: new.test is a site the Common Crawl graph does not hold (authority.mjs gives it only domain, inGraph:false, note): "not found in the link data", never 0, and nothing is computed with it
  const refMd = md.split("\n").find((l) => l.startsWith("| referring domains (Common Crawl)")) || "", strMd = md.split("\n").find((l) => l.startsWith("| strength rank")) || "";
  check("compare: a site the link graph does not hold is 'not found in the link data' (value null, never 0): in the table cells, in the facts and in the short answer, with no better side and no difference", rowOf("referring")?.b.value === null && rowOf("referring")?.b.notInGraph === true && rowOf("strength")?.b.value === null && rowOf("strength")?.b.notInGraph === true && rowOf("referring")?.a.notInGraph == null && / \| 12 \| not found in the link data \| - \(by design\) \|$/.test(refMd) && / \| 1,000 \| not found in the link data \| - \(by design\) \|$/.test(strMd) && /new\.test is not found in the link data/.test(cj?.shortAnswer || "") && !/websites link to B against/.test(cj?.shortAnswer || "") && !/0 websites/.test(cj?.shortAnswer || ""), refMd + " | " + strMd + " | " + cj?.shortAnswer + " | " + JSON.stringify(rowOf("referring")?.b));
  const ids = (xs) => (xs || []).map((x) => x.id).sort().join(",");
  check("compare: what B fixes from A is matched by checklist rule id (fixed / still there / new)", ids(cj?.fixedFromA) === "a1,a2,a4,a5" && ids(cj?.stillInB) === "a3" && ids(cj?.newInB) === "b2,b3" && /## What B fixes from A\n\n4 of A's 5 /.test(md), `${ids(cj?.fixedFromA)} | ${ids(cj?.stillInB)} | ${ids(cj?.newInB)}`);
  const lack = cj?.stillLacking || [];
  check("compare: what B still lacks = B's serious open root causes (with the fix), nothing by design", lack.some((x) => x.kind === "root cause" && /placeholder/.test(x.what) && x.fix) && !lack.some((x) => /referring|noindex|crawler/.test(x.what || "")) && !lack.some((x) => x.severity === "low"), JSON.stringify(lack.map((x) => x.what)));
  check("compare: a preview's noindex and missing links are by design, not a defect", cj?.byDesign.some((d) => /referring/.test(d.measure)) && cj?.byDesign.some((d) => /left out of search/.test(d.measure)) && rowOf("noindex")?.b.value === 5 && /By design, not counted/.test(md), JSON.stringify(cj?.byDesign));
  const allFacts = facts(cj);
  check("compare: every number is {value, source, fetchedAt, cacheFile}", allFacts.length >= 40 && allFacts.every(isFact), `${allFacts.length} facts; bad: ${JSON.stringify(allFacts.find((f) => !isFact(f)))?.slice(0, 300)}`);
  check("compare: the same pages on both sites are matched by path (4 of 5)", cj?.sameParts?.summary.n === 4 && cj.sameParts.pages.every((p) => p.lcpA.value > p.lcpB.value) && /## The same pages on both sites/.test(md), JSON.stringify(cj?.sameParts?.summary));
  check("compare: research coverage when targets.json exists (A 1 of 3 searches has a page, B 2 of 3)", rowOf("searchesWithPage")?.a.value === 1 && rowOf("searchesWithPage")?.b.value === 2 && rowOf("aiCited")?.a.value > 0 && rowOf("aiCited")?.b == null, JSON.stringify([rowOf("searchesWithPage")?.a?.value, rowOf("searchesWithPage")?.b?.value, rowOf("aiCited")?.a?.value]));
  const words = md.split("## Words used")[1] || "";
  const terms = Object.keys(cj?.glossary || {});
  check("compare: plain words: short answer first, each term explained exactly once", /^# [^\n]+\n\n\*\*Short answer:\*\* A is old\.test, B is new\.test \(a preview\)/.test(md) && terms.length >= 6 && terms.every((t) => words.split(`**${t}**`).length === 2) && (md.split("## Words used")[0].match(/\*\*LCP\*\*/g) || []).length === 0, terms.join(","));
  check("compare: launch state of B comes from business.json when no flag is given", /\| B \| new\.test \| live URL snapshot \| [^|]+\| preview \|/.test((() => { node("compare.mjs", [`https://${A}/`, `https://${B}/`, "--cwd", tmp]); return fs.readFileSync(path.join(cdir, "compare.md"), "utf8"); })()));
  run();

  // ---- options that differ => warnings; --strict => exit 1 ----
  snapshot("slow.test", { pages: PAGES_B.slice(0, 2), robots: ROBOTS_A, causes: CAUSES_B, runs: 1, browser: "Chrome/150.0", conditions: { width: 412, cpu: 6, latency: 300 } });
  const rw = node("compare.mjs", [`https://${A}/`, "https://slow.test/", "--cwd", tmp]);
  const cw = J(path.join(tmp, "site-checks", `compare-${A}-vs-slow.test`, "compare.json"));
  const codes = (cw?.warnings || []).filter((x) => x.level === "warn").map((x) => x.code);
  check("compare: warns when the snapshots were taken with different options (runs, pages, browser, phone conditions)", ["runs", "page-count", "browser", "conditions"].every((c) => codes.includes(c)) && /## Read this first/.test(fs.readFileSync(path.join(tmp, "site-checks", `compare-${A}-vs-slow.test`, "compare.md"), "utf8")), JSON.stringify(cw?.warnings.map((x) => x.code)) + rw.stderr);
  const rs = node("compare.mjs", [`https://${A}/`, "https://slow.test/", "--cwd", tmp, "--strict"]);
  const rsOk = run(["--strict"]);
  check("compare: --strict turns a warning into exit 1 and a clean pair stays exit 0", rs.status === 1 && /--strict: \d+ warning/.test(rs.stderr) && rsOk.status === 0, `${rs.status} ${rs.stderr} | ${rsOk.status} ${rsOk.stderr}`);

  // ---- a side without checker results ----
  snapshot("nocheck.test", { pages: PAGES_B, robots: ROBOTS_A });
  const rn = node("compare.mjs", [`https://${A}/`, "https://nocheck.test/", "--cwd", tmp]);
  const cn = J(path.join(tmp, "site-checks", `compare-${A}-vs-nocheck.test`, "compare.json"));
  const mdn = fs.readFileSync(path.join(tmp, "site-checks", `compare-${A}-vs-nocheck.test`, "compare.md"), "utf8");
  const rn1 = cn?.rows.find((r) => r.key === "high");
  check("compare: a side without checker results is NOT CHECKED, never counted as zero problems", rn.status === 0 && rn1?.b.value === null && /^NOT CHECKED/.test(rn1.b.source) && cn.fixedFromA === null && /NOT CHECKED: nocheck\.test has no checker results/.test(mdn) && /has not been through the checker/.test(mdn) && rn1.better === null, `${JSON.stringify(rn1?.b)} ${rn.stderr}`);

  // ---- a repo side ----
  const repo = path.join(tmp, "repo-new");
  w(path.join(repo, ".checks", "causes.json"), CAUSES_B);
  w(path.join(repo, "robots.txt"), "User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n");
  w(path.join(repo, "index.html"), `<!doctype html><html><head><title>Repo home</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script></head><body><main><h1>Hi</h1></main></body></html>`);
  w(path.join(repo, "about", "index.html"), `<!doctype html><html><head><title>About</title></head><body><main><h1>About</h1></main></body></html>`);
  const rr = node("compare.mjs", [`https://${A}/`, repo, "--cwd", tmp]);
  const cr = J(path.join(tmp, "site-checks", `compare-${A}-vs-repo-new`, "compare.json"));
  const rrow = (k) => cr?.rows.find((r) => r.key === k);
  check("compare: a repo side reads .checks, robots.txt and built HTML; speed and weight are n/a, never invented", rr.status === 0 && rrow("lcp")?.b.value === null && /^NOT MEASURED/.test(rrow("lcp").b.source) && rrow("kb")?.b.value === null && JSON.stringify(rrow("aiBlocked")?.b.value) === JSON.stringify(["GPTBot"]) && rrow("ldPct")?.b.value === 50 && rrow("causes")?.b.value === 3 && cr.sameParts === null, `${rr.stderr} ${JSON.stringify([rrow("lcp")?.b, rrow("aiBlocked")?.b?.value, rrow("ldPct")?.b?.value])}`);

  // ---- reading, not crawling ----
  const rx = node("compare.mjs", [`https://${A}/`, "https://nosnap.test/", "--cwd", tmp]);
  check("compare: a URL with no snapshot exits 1 and says to run live-target (it never crawls by itself)", rx.status === 1 && /no complete snapshot for nosnap\.test: run live-target\.mjs/.test(rx.stderr) && !fs.existsSync(path.join(tmp, "site-checks", "nosnap.test")), rx.stderr);
  const rf = node("compare.mjs", [`https://${A}/`, `https://${B}/`, "--cwd", tmp, "--refresh"]);
  check("compare: --refresh goes through live-target and REUSES a snapshot younger than 7 days (no request leaves the machine)", rf.status === 0 && (rf.stdout.match(/^REUSE /gm) || []).length === 2, rf.stdout + rf.stderr);
  check("compare: usage error exits 2", node("compare.mjs", [`https://${A}/`, "--cwd", tmp]).status === 2);

  // ================= report-live.mjs: research / measure / gate wiring =================
  const snapA = path.join(tmp, "site-checks", A, "snapshots", NOW.slice(0, 10));
  const rep = (host = A, snap = snapA, extra = []) => node("report-live.mjs", [`https://${host}/`, "--cwd", tmp, "--snapshot", snap, ...extra]);
  const r0 = rep();
  const rj = J(path.join(pa, "report.json")), rmd = fs.existsSync(path.join(pa, "report.md")) ? fs.readFileSync(path.join(pa, "report.md"), "utf8") : "";
  const Q = (n) => rj?.questions.find((x) => x.n === n);
  const q2 = Q(2);
  check("report: Q2 counts searches with a page vs new, a page that does not match its search, and reads cannibalisation from the gate", q2?.status === "answered" && q2.facts.clustersTotal.value === 3 && q2.facts.clustersWithPage.value === 2 && q2.facts.clustersMissingPage.value === 1 && q2.facts.weakPages.value === 1 && q2.weak[0].page === "/about/" && q2.weak[0].issues.some((i) => i.kind === "place") && q2.weak[0].issues.some((i) => i.kind === "query" && /missing: emergency, plumber, seattle\)/.test(i.text)) && q2.facts.cannibalisation.value === 1 && q2.missing[0].search === "pricing plans" && q2.missing[0].volume.value === 500, r0.stderr + JSON.stringify(q2?.facts).slice(0, 500));
  check("report: Q2 cannibalisation says NOT CHECKED when the gate has not run", (() => { const g = path.join(pa, "gate", "report.json"); const keep = fs.readFileSync(g, "utf8"); fs.rmSync(g); rep(); const q = J(path.join(pa, "report.json")).questions[1]; fs.writeFileSync(g, keep); return q.facts.cannibalisation.status === "NOT CHECKED" && /gate\.mjs/.test(q.facts.cannibalisation.unblock); })());
  const q3 = Q(3);
  const home = q3?.siteLevel?.find((r) => /words of text/.test(r.measure));
  const cr1 = q3?.clusterRows?.find((r) => r.id === "c-web-design-services");
  check("report: Q3 sets our pages against the audited winners (depth, schema, entities, questions) and says what is not measured", q3?.status === "answered" && q3.facts.winnersAudited.value.join() === "rival.test" && home?.winners[0].value === 2100 && cr1?.entitiesMissing.value.join() === "Seattle,WordPress" && cr1.questionsNotShown.value.notShown === 1 && cr1.winnersAudited.join() === "rival.test" && /winning sites are not measured/.test(q3.notMeasured) && /Our pages against their searches/.test(rmd), JSON.stringify(q3?.clusterRows?.[0]).slice(0, 400) + r0.stderr);
  const q5 = Q(5);
  check("report: Q5 share is weighted by how often each question was asked (4 answers: 1 of 4 cite us = 25%)", q5?.status === "answered" && q5.facts.citedShare.value === 0.25 && q5.facts.answersChecked.value === 4 && q5.facts.rowsCitingUs.value === 1, JSON.stringify(q5?.facts?.citedShare));
  check("report: Q5 who is cited instead, portals flagged, sign-in links left out", q5?.facts.citedInstead.value[0].domain === "portal.test" && q5.facts.citedInstead.value[0].answers === 4 && q5.facts.citedInstead.value[0].kind === "portal or directory" && !q5.facts.citedInstead.value.some((x) => x.domain === "accounts.google.com") && /2 of 2 rows were asked fewer than 3 times|rows were asked fewer than 3 times/.test(rmd), JSON.stringify(q5?.facts?.citedInstead?.value));
  const nums = facts(rj?.questions);
  check("report: every number in the new answers is {value, source, fetchedAt, cacheFile}", nums.length >= 40 && nums.every(isFact), `${nums.length}; bad: ${JSON.stringify(nums.find((f) => !isFact(f)))?.slice(0, 300)}`);
  check("report: the six questions stay in order and Q6 adds the plan from the research", [...rmd.matchAll(/^## (\d)\. /gm)].map((m) => m[1]).join("") === "123456" && Q(6).plan.some((p) => p.kind === "new page" && /pricing plans/.test(p.what) && p.impact?.value === 7 && /GT-002/.test(p.provedBy)) && Q(6).plan.some((p) => p.kind === "wrong match") && /Then the plan from the research/.test(rmd));
  // site with no research files: all three stay BLOCKED with what unblocks them
  const snapB = path.join(tmp, "site-checks", B, "snapshots", NOW.slice(0, 10));
  const rb = rep(B, snapB, ["--launch-state", "preview"]);
  const rjb = J(path.join(pb, "report.json"));
  check("report: Q2, Q3 and Q5 stay BLOCKED (with what unblocks them) only when their data is missing", [1, 2, 4].every((i) => rjb?.questions[i].status === "BLOCKED" && rjb.questions[i].needs.length) && /BLOCKED, see 2, 3 and 5/.test(rjb.shortAnswer), rb.stderr + JSON.stringify(rjb?.questions.map((x) => x.status)));
  // what changed since the last report
  const first = J(path.join(pa, "report.json"));
  const au = J(path.join(pa, "authority.json")); au.results[0].linkingDomains = 15; w(path.join(pa, "authority.json"), au);
  rep();
  const second = J(path.join(pa, "report.json")), md2 = fs.readFileSync(path.join(pa, "report.md"), "utf8");
  const ch = second.sinceLast?.changes?.find((c) => c.metric === "refdom");
  check("report: what changed since the last report (referring domains 12 to 15; unchanged figures not listed; previous report kept)", ch && ch.before.value === 12 && ch.after.value === 15 && second.sinceLast.changes.length === 1 && isFact(ch.before) && /\*\*Since the last report \(\d{4}-\d{2}-\d{2}\):\*\* referring domains: 12 to 15\./.test(md2) && J(path.join(pa, "report.prev.json"))?.writtenAt === first.writtenAt && !rj.sinceLast, JSON.stringify(second.sinceLast).slice(0, 400));
  check("report: a first report has no 'since' line; a second identical run says nothing changed", (() => { const md3 = (rep(), fs.readFileSync(path.join(pa, "report.md"), "utf8")); return /nothing measured has changed/.test(md3) && !/Since the last report/.test(rmd); })());
  // started through a junction (a linked skill folder): argv[1] keeps the link path while import.meta.url is the real file; the old exact
  // compare skipped main() and exited 0 with no output
  const jx = path.join(tmp, "jx-scripts"); fs.symlinkSync(dir, jx, "junction");
  const ju = spawnSync(process.execPath, [path.join(jx, "compare.mjs")], { encoding: "utf8", timeout: 60000 });
  check("compare: started through a junction it still runs its CLI (no arguments: usage, exit 2), not a silent exit 0", ju.status === 2 && /usage: node compare\.mjs/.test(ju.stderr), `exit ${ju.status} ${ju.stderr.slice(0, 200)}`);
  fs.rmSync(jx, { recursive: true, force: true }); // the link only
  const gl = path.join(tmp, "guard-selftest.log");
  const gs = spawnSync(process.execPath, ["-e", 'fetch("https://example.invalid/x").then(() => process.exit(0), (e) => { console.log(e.message); process.exit(3); });'], { encoding: "utf8", timeout: 60000, env: { ...process.env, PEWP_NETGUARD_LOG: gl } });
  check("guard: the network guard itself refuses a non-local request and logs it (self-test, separate log)", gs.status === 3 && /NETWORK GUARD/.test(gs.stdout) && fs.readFileSync(gl, "utf8").includes("example.invalid"), gs.stdout + gs.stderr);
  check("guard: nothing in this whole test left the machine (network guard log is empty)", !fs.existsSync(netLog) || fs.readFileSync(netLog, "utf8").trim() === "", fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8") : "");
} finally {
  const keep = args.includes("--keep");
  if (!keep) fs.rmSync(tmp, { recursive: true, force: true });
}
for (const r of results) if (!quiet || !r.ok) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `  ${r.detail}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `COMPARE TEST FAIL: ${failed} of ${results.length}` : `COMPARE TEST PASS: ${results.length} of ${results.length}`);
process.exit(failed ? 1 : 0);
