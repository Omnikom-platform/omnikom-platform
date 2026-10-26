// Usage: node test-plan-gate.mjs [--scripts <dir>] [--fixtures <dir>] [--verbose] [--no-mutants]
// Self-test of the S3 plan stage, the targets.json validator and the S5 target gate, on the fixtures only (no network, no real site):
//   V  validator: the fixtures pass, every rule rejects its broken input for its own reason, ranking and citation rows, the measure pair
//   P  plan-site: one cluster = one page, hubs and spokes, briefs, links, programmatic.json, off-site, priorities, determinism, bad input
//   G  gate: a clean 6-page site passes all twelve checks; the faulty site (cannibalisation, missing cluster page, orphan, wrong schema type,
//      missing licence number) fails exactly the checks that own those faults; every check is also driven both ways by small mutations
//   S  snapshot input, CLI exit codes, the stale-fixture guard
//   M  watched-fail mutants: the scripts themselves are broken one rule at a time and this suite must turn red for that reason
// Exit 0 = all pass.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const SCRIPTS = path.resolve(opt("--scripts") || path.dirname(fileURLToPath(import.meta.url)));
const FIX = path.resolve(opt("--fixtures") || path.join(SCRIPTS, "..", "fixtures"));
const VERBOSE = args.includes("--verbose");
const { PLAN_FLAGS } = await import(pathToFileURL(path.join(FIX, "build-fixtures.mjs")).href);
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const walkFiles = (d, base = d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkFiles(p, base, out); else out.push(path.relative(base, p).split(path.sep).join("/")); } return out.sort(); };

async function suite(scriptsDir, { full }) {
  const R = [];
  const check = (name, ok, detail = "") => R.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 700) });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-pg-"));
  const imp = (f) => import(pathToFileURL(path.join(scriptsDir, f)).href);
  const node = (script, a, o = {}) => spawnSync(process.execPath, [path.join(scriptsDir, script), ...a], { encoding: "utf8", timeout: 120000, ...o });
  const cp = (a, b) => fs.cpSync(a, b, { recursive: true });
  let seq = 0;
  const fresh = (label = "d") => path.join(tmp, `${label}${seq++}`);
  try {
    // ======================= V: validator =======================
    const V = await imp("targets-validate.mjs");
    const T0 = J(path.join(FIX, "pewp", "targets.json"));
    const clone = () => structuredClone(T0);
    const vErr = (mut) => { try { const t = clone(); mut(t); return V.validate(t).errors; } catch (e) { return [{ rule: "CRASH", path: "", message: String(e.message) }]; } };
    const has = (errs, rule, re) => errs.some((e) => e.rule === rule && re.test(`${e.path} ${e.message}`));
    check("V: fixture targets.json is valid", V.validate(T0).ok, JSON.stringify(V.validate(T0).errors));
    check("V: fixture business.json is valid", V.validateBusiness(J(path.join(FIX, "pewp", "business.json"))).ok);
    const cases = [
      ["duplicate cluster id", (t) => { t.clusters[1].id = t.clusters[0].id; }, "T-002", /duplicate id/],
      ["bad cluster id shape", (t) => { t.clusters[1].id = "Rocklin Agent"; }, "T-002", /c-<slug>/],
      ["two clusters on one primary query (word order and plural differ)", (t) => { t.clusters[1].primaryQuery = "Real Estate Agents Roseville CA"; }, "T-003", /cannibalisation/],
      ["bare number instead of a sourced number", (t) => { t.clusters[0].volume = 320; }, "T-004", /bare value/],
      ["sourced number without fetchedAt", (t) => { delete t.clusters[0].difficulty.fetchedAt; }, "T-004", /fetchedAt/],
      ["sourced number without source", (t) => { t.clusters[0].difficulty.source = ""; }, "T-004", /source/],
      ["sourced number without cacheFile key", (t) => { delete t.clusters[0].value.cacheFile; }, "T-004", /cacheFile/],
      ["fetchedAt in the future", (t) => { t.clusters[0].difficulty.fetchedAt = "2099-01-01"; }, "T-004", /future/],
      ["fetchedAt not a date", (t) => { t.clusters[0].difficulty.fetchedAt = "last week"; }, "T-004", /ISO/],
      ["a range without estimate: true", (t) => { t.clusters[0].volume.estimate = false; }, "T-004", /estimate: true/],
      ["volume value null", (t) => { t.clusters[3].volume.value = null; }, "T-004", /must not be null/],
      ["serpFeatures not a list", (t) => { t.clusters[0].serpFeatures.value = "paa"; }, "T-004", /list of strings/],
      ["number measured for another market", (t) => { t.clusters[0].difficulty.market = { country: "GB" }; }, "T-005", /GB/],
      ["number located in another country", (t) => { t.clusters[0].difficulty.location = "GB"; }, "T-005", /GB/],
      ["market missing", (t) => { delete t.market; }, "T-001", /market/],
      ["market malformed", (t) => { t.market = { country: "usa", language: "en" }; }, "T-001", /two-letter/],
      ["local intent without a location", (t) => { t.clusters[1].location = null; }, "T-006", /local intent needs a location/],
      ["location key missing", (t) => { delete t.clusters[3].location; }, "T-006", /missing/],
      ["unknown intent", (t) => { t.clusters[0].intent = "buying"; }, "T-007", /one of/],
      ["targetPage neither a path nor new", (t) => { t.clusters[1].targetPage = "rocklin"; }, "T-008", /"\/" or "new"/],
      ["one page for two clusters", (t) => { t.clusters[2].targetPage = t.clusters[1].targetPage; }, "T-008", /one cluster = one page/],
      ["queries empty", (t) => { t.clusters[0].queries = []; }, "T-009", /queries/],
      ["competitor domain does not match its url", (t) => { t.clusters[0].competitorsTop3[0].domain = "other.test"; }, "T-009", /host of the url/],
      ["more than 3 competitors", (t) => { t.clusters[0].competitorsTop3 = [1, 2, 3, 4].map(() => t.clusters[0].competitorsTop3[0]); }, "T-009", /at most 3/],
      ["priority not a number", (t) => { t.clusters[0].priority = "high"; }, "T-010", /number/],
      ["wordRange not [min, max]", (t) => { t.clusters[0].wordRange.value = [900, 100]; }, "T-011", /min <= max/],
      ["no clusters", (t) => { t.clusters = []; }, "T-001", /non-empty/],
    ];
    for (const [name, mut, rule, re] of cases) { const e = vErr(mut); check(`V: rejects ${name}`, has(e, rule, re), `${rule} ${re}: ${JSON.stringify(e)}`); }
    const BZ = J(path.join(FIX, "pewp", "business.json"));
    const bErr = (mut) => { try { const b = structuredClone(BZ); mut(b); return V.validateBusiness(b).errors; } catch (e) { return [{ rule: "CRASH", path: "", message: String(e.message) }]; } };
    check("V: rejects business.json without launchState", has(bErr((b) => { delete b.launchState; }), "B-001", /launchState/));
    check("V: rejects business.json without market", has(bErr((b) => { delete b.market; }), "B-001", /market/));
    check("V: rejects bad credentials.state", has(bErr((b) => { b.credentials.state = "California"; }), "B-001", /two-letter/));
    check("V: rejects bad rankTracking source", has(bErr((b) => { b.rankTracking.source = "ahrefs"; }), "B-001", /rankTracking/));
    // ranking and citation rows
    const rk = J(path.join(FIX, "measure", "2026-09-22", "rankings.json")).rankings[0];
    const ct = J(path.join(FIX, "measure", "2026-10-22", "citations.json")).citations[1];
    const rErr = (mut) => { try { const r = structuredClone(rk); mut(r); return V.validateRankingRow(r, "row"); } catch (e) { return [{ rule: "CRASH", path: "", message: String(e.message) }]; } };
    const cErr = (mut) => { try { const r = structuredClone(ct); mut(r); return V.validateCitationRow(r, "row"); } catch (e) { return [{ rule: "CRASH", path: "", message: String(e.message) }]; } };
    check("V: a ranking row from the fixtures is valid", V.validateRankingRow(rk).length === 0);
    check("V: a citation row from the fixtures is valid", V.validateCitationRow(ct).length === 0);
    for (const [name, mut, rule, re] of [
      ["location missing", (r) => { delete r.location; }, "R-001", /location/], ["device missing", (r) => { delete r.device; }, "R-001", /device/],
      ["language missing", (r) => { delete r.language; }, "R-001", /language/], ["position source missing", (r) => { delete r.position.source; }, "R-002", /source/],
      ["position fetchedAt missing", (r) => { delete r.position.fetchedAt; }, "R-002", /fetchedAt/], ["bare position number", (r) => { r.position = 9; }, "R-002", /sourced number/],
      ["engine not google or bing", (r) => { r.engine = "duckduckgo"; }, "R-003", /google or bing/], ["position 0", (r) => { r.position.value = 0; }, "R-002", /position >= 1/],
      ["a position without a url", (r) => { r.url = null; }, "R-001", /needs the URL/],
    ]) check(`V: ranking row rejected: ${name}`, has(rErr(mut), rule, re), JSON.stringify(rErr(mut)));
    for (const [name, mut, rule, re] of [
      ["runs missing", (r) => { delete r.runs; }, "C-002", /runs/], ["share not a whole number of runs", (r) => { r.citedShare.value = 0.5; }, "C-003", /whole number/],
      ["share above 1", (r) => { r.citedShare.value = 1.5; }, "C-003", /between 0 and 1/], ["ourDomainCited disagrees with the share", (r) => { r.ourDomainCited = false; }, "C-004", /exactly when/],
      ["prompt missing", (r) => { delete r.prompt; }, "C-001", /prompt/], ["model missing", (r) => { r.model = ""; }, "C-001", /model/], ["bare share", (r) => { r.citedShare = 0.6667; }, "C-003", /sourced number/],
      ["citedSources not a list", (r) => { r.citedSources = "a.test"; }, "C-005", /list of domains/],
    ]) check(`V: citation row rejected: ${name}`, has(cErr(mut), rule, re), JSON.stringify(cErr(mut)));
    const mA = path.join(FIX, "measure", "2026-09-22"), mB = path.join(FIX, "measure", "2026-10-22");
    check("V: both measure dates are valid", V.validateMeasureDir(mA).length === 0 && V.validateMeasureDir(mB).length === 0, JSON.stringify([...V.validateMeasureDir(mA), ...V.validateMeasureDir(mB)]));
    const badM = fresh("m"); cp(mA, path.join(badM, "2026-09-22"));
    const bm = path.join(badM, "2026-09-22"); const bdoc = J(path.join(bm, "rankings.json")); bdoc.rankings.push(structuredClone(bdoc.rankings[0])); fs.writeFileSync(path.join(bm, "rankings.json"), JSON.stringify(bdoc));
    check("V: a duplicate ranking row in a measure folder is rejected", V.validateMeasureDir(bm).some((e) => e.rule === "R-004"), JSON.stringify(V.validateMeasureDir(bm)));
    const cmp = V.compareMeasure(mA, mB), exp = J(path.join(FIX, "measure", "expected-diff.json")).rankings;
    check("V: compareMeasure pairs only rows measured in the same place/device/language", JSON.stringify(cmp.comparable) === JSON.stringify(exp.comparable) && JSON.stringify(cmp.notComparable) === JSON.stringify(exp.notComparable) && JSON.stringify(cmp.newInB) === JSON.stringify(exp.newInB) && JSON.stringify(cmp.goneInB) === JSON.stringify(exp.goneInB), JSON.stringify(cmp));
    {
      const ok = node("targets-validate.mjs", [path.join(FIX, "pewp")]);
      check("V: CLI passes on the fixtures (exit 0, first line PASS)", ok.status === 0 && /^PASS targets-valid/.test(ok.stdout), ok.stdout + ok.stderr);
      const badT = fresh("bt"); fs.mkdirSync(badT); const t = clone(); t.clusters[1].primaryQuery = t.clusters[0].primaryQuery; fs.writeFileSync(path.join(badT, "targets.json"), JSON.stringify(t));
      const f = node("targets-validate.mjs", [badT]);
      check("V: CLI fails on a cannibalising file (exit 1, rule and path printed)", f.status === 1 && /^FAIL targets-valid/.test(f.stdout) && /T-003 clusters\[1\]\.primaryQuery/.test(f.stdout), f.stdout);
      const miss = node("targets-validate.mjs", [path.join(tmp, "nope.json")]);
      check("V: CLI says cannot judge for a missing file (exit 2)", miss.status === 2 && /^ERROR/.test(miss.stdout), miss.stdout);
      const ms = node("targets-validate.mjs", ["--measure", mA, "--measure", mB]);
      check("V: CLI validates measure folders", ms.status === 0 && /measure 2026-10-22/.test(ms.stdout), ms.stdout);
    }

    // ======================= P: plan-site =======================
    const pewp = fresh("pewp"); cp(path.join(FIX, "pewp"), pewp);
    const pr = node("plan-site.mjs", [pewp, ...PLAN_FLAGS]);
    check("P: plan-site runs on the fixtures (exit 0, PASS line)", pr.status === 0 && /^PASS plan 6 pages/.test(pr.stdout), pr.stdout + pr.stderr);
    const SM = J(path.join(pewp, "plan", "sitemap.json"));
    check("P: one cluster = one page (6 clusters, 6 pages, each cluster once)", SM.pages.length === 6 && T0.clusters.every((c) => SM.pages.filter((p) => p.cluster === c.id).length === 1));
    check("P: an existing targetPage keeps its URL, a new page gets its slug path under /guides/", SM.pages.find((p) => p.cluster === "c-agent-rocklin").path === "/rocklin-ca/" && SM.pages.find((p) => p.cluster === "c-sell-without-agent").path === "/guides/sell-my-house-without-a-realtor-california/" && SM.pages.find((p) => p.cluster === "c-agent-roseville").path === "/");
    const { overlap, isGenericAnchor } = await imp("lib-text.mjs");
    check("P: every planned title, H1 and description carries the primary query (>= 80%), title <= 60, description <= 160", SM.pages.every((p) => { const c = T0.clusters.find((x) => x.id === p.cluster); return overlap(c.primaryQuery, p.title) >= 0.8 && overlap(c.primaryQuery, p.h1) >= 0.8 && overlap(c.primaryQuery, p.metaDescription) >= 0.8 && p.title.length <= 60 && p.metaDescription.length <= 160; }), JSON.stringify(SM.pages.map((p) => [p.title.length, p.metaDescription.length])));
    check("P: schema types by page kind (home RealEstateAgent+WebSite, guide Article+FAQPage, tool Service+FAQPage, city WebPage+FAQPage)", (() => { const s = (c) => SM.pages.find((p) => p.cluster === c).schema.join("+"); return s("c-agent-roseville") === "RealEstateAgent+WebSite" && s("c-cost-of-realtor") === "Article+FAQPage" && s("c-home-value") === "Service+FAQPage" && s("c-agent-rocklin") === "WebPage+FAQPage"; })());
    const briefs = SM.pages.map((p) => fs.readFileSync(path.join(pewp, p.brief), "utf8"));
    check("P: every brief has the sections the builder needs", briefs.every((b) => ["## Outline", "## Entities to cover", "## Questions to answer", "## Proof and statistics to include", "## Links out", "## Links in", "## Industry rules that apply"].every((h) => b.includes(h)) && /- Primary query: /.test(b) && /- Word range: \d+-\d+ \(/.test(b) && /- CTA: /.test(b)));
    check("P: briefs list the industry rule ids and a proof item that needs a source", briefs.every((b) => /RE-LIC-001/.test(b) && /with source and date/.test(b)));
    check("P: every planned link has a descriptive anchor sharing a content token with the target query", SM.links.every((l) => { const t = SM.pages.find((p) => p.path === l.to); return !isGenericAnchor(l.anchor) && overlap(t.primaryQuery, l.anchor) > 0; }), JSON.stringify(SM.links.filter((l) => isGenericAnchor(l.anchor))));
    check("P: no orphan in the plan (every page except home has an inbound link) and home links to every page", SM.pages.filter((p) => p.path !== "/").every((p) => SM.links.some((l) => l.to === p.path)) && SM.pages.filter((p) => p.path !== "/").every((p) => SM.links.some((l) => l.from === "/" && l.to === p.path)));
    check("P: the two city pages link each other (siblings) and each links home", SM.links.some((l) => l.from === "/rocklin-ca/" && l.to === "/lincoln-ca/") && SM.links.some((l) => l.from === "/lincoln-ca/" && l.to === "/rocklin-ca/") && SM.links.some((l) => l.from === "/lincoln-ca/" && l.to === "/"));
    const PG = J(path.join(pewp, "plan", "programmatic.json"));
    check("P: programmatic.json carries the gate numbers from the options and the two city pages", PG.gate.minWords === 250 && PG.gate.minUniqueWords === 150 && PG.gate.minLocalFacts === 4 && PG.gate.maxSimilarity === 0.4 && PG.groups.length === 1 && PG.groups[0].pages.join() === "/rocklin-ca/,/lincoln-ca/" && PG.source.status === "chosen", JSON.stringify(PG));
    check("P: programmatic-data.json supplied by the builder is not overwritten", J(path.join(pewp, "plan", "programmatic-data.json")).records["/rocklin-ca/"].facts.length === 6);
    const OF = J(path.join(pewp, "plan", "offsite.json"));
    check("P: off-site plan without authority.json says BLOCKED and gives the command; local and AI-visibility plans exist", /^BLOCKED/.test(OF.links.status) && /authority\.mjs/.test(OF.links.unblock) && OF.local.nap.name === "Sample Valley Realty" && OF.local.businessProfile.categories.primary === "Real estate agent" && /UNVERIFIED/.test(OF.local.businessProfile.categories.note) && OF.aiVisibility.sameAs.length === 1 && /OAI-SearchBot/.test(OF.aiVisibility.robots) && /NOT MEASURED/.test(OF.aiVisibility.sourcesEnginesCite.status));
    check("P: link-gap outreach list per guide: linkable assets name the informational pages", OF.linkableAssets.length === 2 && OF.linkableAssets.every((a) => /^\/(sell|guides)\//.test(a.page)));
    const PR = J(path.join(pewp, "plan", "priorities.json"));
    const firstSlow = PR.items.findIndex((i) => !i.quickWin);
    check("P: priorities ranked 1..n, quick wins first, then by impact / effort", PR.items.every((i, k) => i.rank === k + 1) && PR.items.slice(0, firstSlow).every((i) => i.quickWin) && PR.items.slice(firstSlow).every((i) => !i.quickWin) && PR.items.slice(firstSlow).every((i, k, a) => k === 0 || a[k - 1].score >= i.score), JSON.stringify(PR.items.map((i) => [i.rank, i.id, i.score, i.quickWin])));
    {
      const authority = path.join(tmp, "authority.json");
      fs.writeFileSync(authority, JSON.stringify({ source: "Common Crawl web graph fixture (domain level)", fetchedAt: "2026-10-21T00:00:00Z", linkGap: [{ domain: "example-directory.test", linksToCompetitors: 2, harmonicPos: 12 }] }));
      const cites = path.join(tmp, "cites.json");
      fs.writeFileSync(cites, JSON.stringify({ citations: [{ citedSources: ["example-listing-portal.test", "example-directory.test"] }, { citedSources: ["example-listing-portal.test"] }] }));
      const p2 = fresh("pewp"); cp(path.join(FIX, "pewp"), p2);
      const r2 = node("plan-site.mjs", [p2, ...PLAN_FLAGS, "--authority", authority, "--citations", cites]);
      const o2 = r2.status === 0 ? J(path.join(p2, "plan", "offsite.json")) : null;
      check("P: with authority.json the link gap becomes an outreach list; with a citations file the cited sources are listed by count", o2 && o2.links.gap[0].domain === "example-directory.test" && o2.links.source.includes("Common Crawl") && o2.aiVisibility.sourcesEnginesCite.domains[0].domain === "example-listing-portal.test" && o2.aiVisibility.sourcesEnginesCite.domains[0].questions === 2, r2.stdout + r2.stderr);
    }
    {
      const p3 = fresh("pewp"); cp(path.join(FIX, "pewp"), p3); node("plan-site.mjs", [p3, ...PLAN_FLAGS]);
      const same = walkFiles(path.join(pewp, "plan")).join() === walkFiles(path.join(p3, "plan")).join() && walkFiles(path.join(pewp, "plan")).every((f) => fs.readFileSync(path.join(pewp, "plan", f), "utf8") === fs.readFileSync(path.join(p3, "plan", f), "utf8"));
      check("P: deterministic (two runs write byte-identical plan files)", same);
      node("plan-site.mjs", [p3, ...PLAN_FLAGS]);
      check("P: re-running over its own output changes nothing (idempotent)", walkFiles(path.join(pewp, "plan")).every((f) => fs.readFileSync(path.join(pewp, "plan", f), "utf8") === fs.readFileSync(path.join(p3, "plan", f), "utf8")));
    }
    {
      const bad = fresh("badpewp"); cp(path.join(FIX, "pewp"), bad); fs.rmSync(path.join(bad, "plan"), { recursive: true, force: true });
      const t = J(path.join(bad, "targets.json")); t.clusters[1].primaryQuery = t.clusters[0].primaryQuery; fs.writeFileSync(path.join(bad, "targets.json"), JSON.stringify(t));
      const r = node("plan-site.mjs", [bad, ...PLAN_FLAGS]);
      check("P: invalid targets.json stops the plan (exit 1) and writes nothing", r.status === 1 && /^FAIL plan/.test(r.stdout) && /T-003/.test(r.stdout) && !fs.existsSync(path.join(bad, "plan")), r.stdout);
      const nb = fresh("nobiz"); cp(path.join(FIX, "pewp"), nb); fs.rmSync(path.join(nb, "business.json"));
      const r2 = node("plan-site.mjs", [nb, ...PLAN_FLAGS]);
      check("P: missing business.json is cannot-judge (exit 2)", r2.status === 2 && /^ERROR plan/.test(r2.stdout), r2.stdout);
      const ui = fresh("ind"); cp(path.join(FIX, "pewp"), ui); const b = J(path.join(ui, "business.json")); b.industry = "no-such-industry"; fs.writeFileSync(path.join(ui, "business.json"), JSON.stringify(b));
      const r3 = node("plan-site.mjs", [ui, ...PLAN_FLAGS]);
      check("P: an unknown industry slug is cannot-judge (exit 2)", r3.status === 2 && /no-such-industry/.test(r3.stdout), r3.stdout);
    }
    {
      // hub: 5 city clusters add an /areas-we-serve/ hub that is the parent of the city pages and is linked from home
      const hp = fresh("hub"); cp(path.join(FIX, "pewp"), hp); fs.rmSync(path.join(hp, "plan", "programmatic-data.json"));
      const t = J(path.join(hp, "targets.json"));
      for (const [i, city] of ["Auburn", "Loomis", "Newcastle"].entries()) { const c = structuredClone(t.clusters[1]); c.id = `c-agent-${city.toLowerCase()}`; c.primaryQuery = `real estate agent ${city.toLowerCase()} ca`; c.queries = [c.primaryQuery, `realtor ${city.toLowerCase()} ca`]; c.location = `${city}, CA`; c.targetPage = "new"; c.priority = 3 - i; c.questions = []; c.requiredEntities = [city]; t.clusters.push(c); }
      fs.writeFileSync(path.join(hp, "targets.json"), JSON.stringify(t));
      const r = node("plan-site.mjs", [hp, ...PLAN_FLAGS]); const sm = r.status === 0 ? J(path.join(hp, "plan", "sitemap.json")) : { pages: [], links: [] };
      const hub = sm.pages.find((p) => p.path === "/areas-we-serve/");
      check("P: 5 city clusters add a hub page whose children are the city pages, linked from home and back", r.status === 0 && hub && hub.role === "hub" && hub.cluster === null && hub.children.length === 5 && sm.pages.filter((p) => p.kind === "city-landing").every((p) => p.parent === "/areas-we-serve/") && sm.links.some((l) => l.from === "/" && l.to === "/areas-we-serve/") && sm.links.some((l) => l.from === "/real-estate-agent-auburn-ca/" && l.to === "/areas-we-serve/"), r.stdout + JSON.stringify(sm.pages.map((p) => [p.path, p.parent])));
      check("P: the hub page has its own brief and no primary query", hub && /- Primary query: none/.test(fs.readFileSync(path.join(hp, hub.brief), "utf8")) && sm.pages.length === 10);
      // subset hub: "real estate agent" is the hub of the "real estate agent <city>" spokes
      const sp = fresh("sub"); cp(path.join(FIX, "pewp"), sp); const t2 = J(path.join(sp, "targets.json"));
      const g = structuredClone(t2.clusters[3]); g.id = "c-agent-general"; g.primaryQuery = "real estate agent"; g.queries = ["real estate agent", "best real estate agent"]; g.intent = "commercial"; g.winningFormat = "service page"; g.targetPage = "/agents/"; g.questions = []; g.requiredEntities = []; t2.clusters.push(g);
      fs.writeFileSync(path.join(sp, "targets.json"), JSON.stringify(t2));
      const r2 = node("plan-site.mjs", [sp, ...PLAN_FLAGS]); const sm2 = r2.status === 0 ? J(path.join(sp, "plan", "sitemap.json")) : { pages: [] };
      check("P: a query that is a subset of others' becomes their hub (spokes get it as parent)", r2.status === 0 && sm2.pages.find((p) => p.path === "/agents/")?.role === "hub" && sm2.pages.find((p) => p.path === "/rocklin-ca/")?.parent === "/agents/" && sm2.pages.find((p) => p.path === "/agents/").children.includes("/lincoln-ca/"), r2.stdout);
    }

    // ======================= G: the gate =======================
    const G = await imp("gate.mjs");
    const SITE = path.join(FIX, "site"), CLEAN = path.join(FIX, "site-clean");
    const one = (id, site, o = {}, pw = pewp) => G.gate(pw, site, { only: [id], ...o }).results[0];
    const text = (r) => `${r.summary}\n${r.details.join("\n")}`;
    const expectFail = (name, id, site, re, o, pw) => { const r = one(id, site, o, pw); check(`G: ${id} FAIL ${name}`, r.status === "FAIL" && re.test(text(r)), `${r.status} ${text(r)}`); };
    const expectPass = (name, id, site, o, pw) => { const r = one(id, site, o, pw); check(`G: ${id} PASS ${name}`, r.status === "PASS", `${r.status} ${text(r)}`); };
    const expectErr = (name, id, site, re, o, pw) => { const r = one(id, site, o, pw); check(`G: ${id} ERROR ${name}`, r.status === "ERROR" && re.test(text(r)), `${r.status} ${text(r)}`); };
    const variant = (edits, { base = CLEAN, remove = [], add = {} } = {}) => {
      const d = fresh("v"); cp(base, d);
      for (const [rel, fn] of edits) { const f = path.join(d, rel); const before = fs.readFileSync(f, "utf8"); const after = fn(before); if (after === before) throw new Error(`test patch never applied: ${rel} (${String(fn).slice(0, 90)})`); fs.writeFileSync(f, after); }
      for (const rel of remove) fs.rmSync(path.join(d, rel));
      for (const [rel, html] of Object.entries(add)) { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), html); }
      return d;
    };
    const sub = (from, to) => (h) => (typeof from === "string" ? h.split(from).join(to) : h.replace(from, to));
    const pewpVariant = (edit) => { const d = fresh("pw"); cp(pewp, d); edit(d); return d; };
    const jedit = (d, rel, fn) => { const f = path.join(d, rel); const o = J(f); fn(o); fs.writeFileSync(f, JSON.stringify(o, null, 1)); };
    const ALL = G.CHECKS.map((c) => c.id);

    // the clean site passes everything, and the faulty one fails exactly what it plants
    const clean = G.gate(pewp, CLEAN);
    check("G: clean 6-page site passes all thirteen checks (GT-001..GT-013)", clean.status === "PASS" && clean.results.length === 13 && clean.results.every((r) => r.status === "PASS"), clean.results.map((r) => `${r.id} ${r.status} ${text(r)}`).join("\n"));
    check("G: clean site still carries the disclosure-page WARNs (not failures)", /WARN RE-DISC-001/.test(text(clean.results[9])));
    const bad = G.gate(pewp, SITE);
    const st = Object.fromEntries(bad.results.map((r) => [r.id, r]));
    const want = { "GT-001": "PASS", "GT-002": "FAIL", "GT-003": "FAIL", "GT-004": "PASS", "GT-005": "PASS", "GT-006": "FAIL", "GT-007": "FAIL", "GT-008": "FAIL", "GT-009": "PASS", "GT-010": "FAIL", "GT-011": "PASS", "GT-012": "FAIL", "GT-013": "PASS" };
    check("G: faulty site: statuses are exactly the planted faults", ALL.every((id) => st[id].status === want[id]), ALL.map((id) => `${id}=${st[id].status}`).join(" "));
    check("G: planted missing cluster page is named (GT-002)", /c-sell-without-agent \/guides\/sell-my-house-without-a-realtor-california\//.test(text(st["GT-002"])));
    check("G: planted cannibalisation is named with the cluster, its planned page and the rival page (GT-003)", /"how much does a realtor cost in california" \(c-cost-of-realtor, informational\) is planned for \/sell\/cost-of-a-realtor\/ but 1 other page\(s\) have its head term .* \/blog\/realtor-fees-california\/ \(article\)/.test(text(st["GT-003"])));
    check("G: the planted wrong schema type (Article on a local page) is also an intent-fit failure (GT-012), and the unbuilt guide is a priority-coverage WARN (GT-011)", /\/home-value\/: .*is local but the page is of type article/.test(text(st["GT-012"])) && /WARN unbuilt priority cluster #6 .*sell my house without a realtor california/.test(text(st["GT-011"])));
    check("G: planted orphan is named (GT-007) and its missing planned links are named (GT-006)", /\/lincoln-ca\/: no page links to it/.test(text(st["GT-007"])) && /\/ -> \/lincoln-ca\/: planned link/.test(text(st["GT-006"])) && /\/rocklin-ca\/ -> \/lincoln-ca\//.test(text(st["GT-006"])));
    check("G: planted wrong schema type is named (GT-008)", /\/home-value\/: schema type Service is missing \(page has: Article\)/.test(text(st["GT-008"])));
    check("G: planted missing licence number is named (GT-010) and is the only FAIL there", /FAIL RE-LIC-001 \/rocklin-ca\/ no licence number shown/.test(text(st["GT-010"])) && (text(st["GT-010"]).match(/^FAIL /gm) || []).length === 1);
    check("G: links skipped because an end is not built are noted, not failed twice", /planned links skipped because an end is not built/.test(text(st["GT-006"])) && !/sell-my-house[^\n]*not on the page/.test(text(st["GT-006"])));

    // GT-001 targets-and-plan
    {
      const pv = (edit) => pewpVariant((d) => edit(d));
      let p = pv((d) => jedit(d, "targets.json", (t) => { t.clusters[0].volume = 5; }));
      expectFail("invalid targets.json is a gate failure", "GT-001", CLEAN, /T-004/, {}, p);
      p = pv((d) => jedit(d, "plan/sitemap.json", (s) => { s.pages = s.pages.filter((x) => x.cluster !== "c-home-value"); }));
      expectFail("a cluster with no planned page", "GT-001", CLEAN, /P-002 cluster c-home-value has 0 planned pages/, {}, p);
      p = pv((d) => jedit(d, "plan/sitemap.json", (s) => { s.pages.push({ ...s.pages[1] }); }));
      expectFail("two planned pages at one path / one cluster on two pages", "GT-001", CLEAN, /P-001 two pages planned/, {}, p);
      p = pv((d) => { const f = path.join(d, "plan/briefs/rocklin-ca.md"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("- Primary query: real estate agent rocklin ca", "- Primary query: houses in rocklin")); });
      expectFail("a brief that repeats a different query", "GT-001", CLEAN, /P-004/, {}, p);
      p = pv((d) => { const f = path.join(d, "plan/briefs/rocklin-ca.md"); fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("- Placer County (in: How we help in Rocklin)\n", "")); });
      expectFail("a brief missing a required entity", "GT-001", CLEAN, /P-005 \/rocklin-ca\/: brief lacks required entity "Placer County"/, {}, p);
      p = pv((d) => jedit(d, "plan/sitemap.json", (s) => { s.links[0].anchor = "click here"; }));
      expectFail("a planned link with a generic anchor", "GT-001", CLEAN, /P-009 .*generic anchor/, {}, p);
      p = pv((d) => jedit(d, "plan/sitemap.json", (s) => { s.links[0].anchor = "our latest news"; }));
      expectFail("a planned anchor sharing no word with its target", "GT-001", CLEAN, /P-009 .*shares no content word/, {}, p);
      p = pv((d) => jedit(d, "plan/sitemap.json", (s) => { s.pages.find((x) => x.path === "/rocklin-ca/").title = "Great Homes"; }));
      expectFail("a planned title that does not carry the query", "GT-001", CLEAN, /P-006 .*planned title/, {}, p);
      p = pv((d) => jedit(d, "plan/sitemap.json", (s) => { s.links = s.links.filter((l) => l.to !== "/home-value/"); }));
      expectFail("a page with no planned inbound link", "GT-001", CLEAN, /P-010 \/home-value\//, {}, p);
      p = pv((d) => fs.rmSync(path.join(d, "plan"), { recursive: true }));
      expectErr("no plan yet", "GT-001", CLEAN, /sitemap\.json/, {}, p);
    }
    // GT-002 clusters-have-pages
    expectFail("a page removed from the site", "GT-002", variant([], { remove: ["lincoln-ca/index.html"] }), /lincoln-ca/);
    expectFail("a noindex page on a live site", "GT-002", variant([["home-value/index.html", sub('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="robots" content="noindex">')]]), /home-value.*noindex/);
    {
      const pl = pewpVariant((d) => jedit(d, "business.json", (b) => { b.launchState = "preview"; }));
      const r = one("GT-002", variant([["home-value/index.html", sub('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="robots" content="noindex">')]]), {}, pl);
      check("G: GT-002 PASS noindex is expected while the business is not live (noted, not a defect)", r.status === "PASS" && /NOTE .*noindex, expected/.test(text(r)), text(r));
    }
    expectFail("a canonical pointing at another page", "GT-002", variant([["home-value/index.html", sub('href="https://sample-valley-realty.test/home-value/"', 'href="https://sample-valley-realty.test/rocklin-ca/"')]]), /canonical points at \/rocklin-ca\//);
    // GT-003 no-cannibalisation
    expectFail("a second page with another cluster's title and H1", "GT-003", variant([["guides/sell-my-house-without-a-realtor-california/index.html", (h) => h.replace(/<title>[^<]*<\/title>/, "<title>How Much Does a Realtor Cost in California?</title>").replace(/<h1>[^<]*<\/h1>/, "<h1>How Much Does a Realtor Cost in California?</h1>")]]), /1 other page\(s\) have its head term .*sell-my-house-without-a-realtor-california\//);
    expectFail("two pages with the same title", "GT-003", variant([["home-value/index.html", (h) => h.replace(/<title>[^<]*<\/title>/, "<title>Real Estate Agent in Lincoln, CA | Sample Valley Realty</title>")]]), /same title on/);
    expectPass("neighbouring city pages (80% word overlap) are not cannibalisation", "GT-003", CLEAN);
    // GT-004 query in title / h1 / first paragraph
    expectFail("a title that does not carry the query", "GT-004", variant([["home-value/index.html", (h) => h.replace(/<title>[^<]*<\/title>/, "<title>Home Value Guide | Sample Valley Realty</title>")]]), /home-value.*title does not contain the head term of "home value roseville ca"/);
    expectFail("the wrong town in title and H1 (still 80% of the words)", "GT-004", variant([["rocklin-ca/index.html", (h) => h.replace(/<title>[^<]*<\/title>/, "<title>Real Estate Agent in Lincoln, CA | Sample Valley Realty</title>").replace(/<h1>[^<]*<\/h1>/, "<h1>Real Estate Agent in Lincoln, CA</h1>")]]), /rocklin-ca.*does not name the place "Rocklin"/);
    expectFail("two H1 headings", "GT-004", variant([["rocklin-ca/index.html", sub("<h1>Real Estate Agent in Rocklin, CA</h1>", "<h1>Real Estate Agent in Rocklin, CA</h1><h1>Second</h1>")]]), /2 H1 headings/);
    expectFail("a first paragraph about something else", "GT-004", variant([["sell/cost-of-a-realtor/index.html", (h) => h.replace(/(<h1>[^<]*<\/h1>\n<p>)[^<]*(<\/p>)/, "$1Welcome to our wonderful website where we love gardens and sunshine every day.$2")]]), /cost-of-a-realtor.*first paragraph does not contain the head term/);
    expectFail("no meta description", "GT-004", variant([["home-value/index.html", (h) => h.replace(/<meta name="description"[^>]*>/, "")]]), /home-value.*no meta description/);
    expectPass("plural 'Agents' still carries the query (stemming)", "GT-004", variant([["rocklin-ca/index.html", (h) => h.replace(/<title>[^<]*<\/title>/, "<title>Real Estate Agents in Rocklin, CA | Sample Valley Realty</title>").replace(/<h1>[^<]*<\/h1>/, "<h1>Real Estate Agents in Rocklin, CA</h1>")]]));
    // GT-004 (TGT-004) additions: the meta description and the cluster's other queries count
    expectFail("a meta description that does not carry the query", "GT-004", variant([["home-value/index.html", (h) => h.replace(/<meta name="description" content="[^"]*"/, '<meta name="description" content="A lovely page about nothing in particular."')]]), /home-value.*meta description does not contain the head term/);
    expectPass("a first paragraph that carries another query of the cluster, not the head term (TGT-004 'or one of the cluster's queries')", "GT-004", variant([["sell/cost-of-a-realtor/index.html", (h) => h.replace(/(<h1>[^<]*<\/h1>\n<p>)[^<]*(<\/p>)/, "$1Realtor commission california is the fee most sellers ask about first, so we explain it here.$2")]]));
    // GT-003 (TGT-003 + 06 9.7) additions
    expectPass("a page the cluster lists in alsoServes is not cannibalisation", "GT-003", variant([["guides/sell-my-house-without-a-realtor-california/index.html", (h) => h.replace(/<title>[^<]*<\/title>/, "<title>Realtor Cost in California: What You Pay | Sample Valley Realty</title>").replace(/<h1>[^<]*<\/h1>/, "<h1>How Much Does a Realtor Cost in California?</h1>")]]), {}, pewpVariant((d) => jedit(d, "targets.json", (t) => { t.clusters.find((c) => c.id === "c-cost-of-realtor").alsoServes = ["/guides/sell-my-house-without-a-realtor-california/"]; })));
    expectPass("a page of a type that does not fit the intent is not a rival (a Product page for an informational search)", "GT-003", variant([["guides/sell-my-house-without-a-realtor-california/index.html", (h) => ((h) => h.replace(/<title>[^<]*<\/title>/, "<title>Realtor Cost in California: What You Pay | Sample Valley Realty</title>").replace(/<h1>[^<]*<\/h1>/, "<h1>How Much Does a Realtor Cost in California?</h1>"))(h).replace("</head>", '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Report"}</script></head>')]]));
    expectPass("a city page for another place (same head term, other place) is not a rival (a page per city)", "GT-003", CLEAN);
    // GT-003-SUBTOPIC: a planned page of a narrower or local sibling cluster is a deliberate sub-topic page, not a rival
    {
      // a planned cluster+page is [id, query, intent, url path, (unused), title]; built() adds the page to the site, plannedSet() adds the cluster and sitemap entry
      const COST = "sell/cost-of-a-realtor/index.html"; // every added cluster and page is a copy of the fixture's cost-of-a-realtor cluster, page and brief
      const plannedSet = (list, alsoServes = {}) => pewpVariant((d) => {
        jedit(d, "targets.json", (t) => { const tpl = t.clusters.find((x) => x.id === "c-cost-of-realtor"); for (const [id, q, intent] of list) t.clusters.push(Object.assign(structuredClone(tpl), { id, primaryQuery: q, queries: [q], intent, targetPage: "new", questions: [], requiredEntities: [] })); for (const c of t.clusters) if (alsoServes[c.id]) c.alsoServes = alsoServes[c.id]; });
        jedit(d, "plan/sitemap.json", (m) => { const tpl = m.pages.find((x) => x.cluster === "c-cost-of-realtor"); for (const [id, , , p] of list) m.pages.push({ ...tpl, path: p, cluster: id }); });
      });
      const built = (list) => variant([], { add: Object.fromEntries(list.map(([, , , p, , ttl]) => [p.slice(1) + "index.html", fs.readFileSync(path.join(CLEAN, COST), "utf8").replace(/<title>[^<]*<\/title>/, "<title>" + ttl + "</title>").replace(/<h1>[^<]*<\/h1>/, "<h1>" + ttl + "</h1>")])) });
      const narrow = [["c-luxury-cost", "how much does a luxury realtor cost in california", "informational", "/guides/luxury-realtor-cost/", COST, "How Much Does a Luxury Realtor Cost in California?"]];
      expectPass("a planned page of a narrower cluster (all the head-term words plus one more) is a sub-topic page, not a rival", "GT-003", built(narrow), {}, plannedSet(narrow));
      expectFail("the same narrower page when no cluster of the plan owns it (unplanned) is still a rival", "GT-003", built(narrow), /1 other page\(s\) have its head term .*\/guides\/luxury-realtor-cost\//);
      const dup = [["c-cost-dup", "realtor cost in california how much does it", "informational", "/guides/realtor-cost-california/", COST, "How Much a Realtor Costs in California"]];
      expectFail("a planned page of a cluster with the same head term, no extra word and the same places is a true duplicate and still a rival", "GT-003", built(dup), /"how much does a realtor cost in california".*\/guides\/realtor-cost-california\//, {}, plannedSet(dup));
      // the head term is the same, only the places differ: "how much does a realtor cost in california" (the fixture's cluster) and the general "how much does a realtor cost"
      const general = [["c-cost-general", "how much does a realtor cost", "informational", "/guides/realtor-cost-general/", COST, "How Much Does a Realtor Cost?"]];
      expectPass("a planned general page is not a rival of the place-named cluster (same head term, the page names no place, the cluster does)", "GT-003", built(general), {}, plannedSet(general, { "c-cost-general": ["/sell/cost-of-a-realtor/"] }));
      expectPass("a planned place-named page is not a rival of the general cluster (same head term, the page names a place, the cluster does not)", "GT-003", built(general), {}, plannedSet(general, { "c-cost-of-realtor": ["/guides/realtor-cost-general/"] }));
      expectPass("a general and its place-named sibling together: neither direction is a rival", "GT-003", built(general), {}, plannedSet(general));
      expectPass("an UNPLANNED page for another place (Loomis) is still not a rival of the place-named clusters (the old page-for-another-place guard)", "GT-003", variant([], { add: { "loomis-ca/index.html": fs.readFileSync(path.join(CLEAN, "rocklin-ca/index.html"), "utf8").replace(/<title>[^<]*<\/title>/, "<title>Real Estate Agent in Loomis, CA | Sample Valley Realty</title>").replace(/<h1>[^<]*<\/h1>/, "<h1>Real Estate Agent in Loomis, CA</h1>") } }));
    }
    // GT-011 priority-demand-covered (TGT-011, W)
    {
      const noGuide = variant([], { remove: ["guides/sell-my-house-without-a-realtor-california/index.html"] });
      const r = one("GT-011", noGuide);
      check("G: GT-011 an unbuilt priority cluster is a WARN that names the cluster and its value, not a FAIL (W)", r.status === "PASS" && /WARN unbuilt priority cluster #6 "sell my house without a realtor california" \(c-sell-without-agent, priority 4, commercial, value 4\.5/.test(text(r)) && /no page built at/.test(text(r)), text(r));
      expectFail("the same gap under --strict (a launch blocker)", "GT-011", noGuide, /1 of the top 6 priority cluster\(s\) have no built page/, { strict: true });
      const top5 = one("GT-011", noGuide, { priorityPages: 5 });
      check("G: GT-011 only the top targeting.priorityPages clusters count (5: the unbuilt priority-4 cluster is outside)", top5.status === "PASS" && !/WARN/.test(text(top5)) && /top 5/.test(top5.summary), text(top5));
      const viaPolicy = one("GT-011", noGuide, {}, pewpVariant((d) => jedit(d, "business.json", (b) => { b.targeting = { priorityPages: 5 }; })));
      check("G: GT-011 business.json targeting.priorityPages is read when --priority-pages is not given", viaPolicy.status === "PASS" && !/WARN/.test(text(viaPolicy)), text(viaPolicy));
      expectErr("a bad priorityPages", "GT-011", CLEAN, /priorityPages must be a whole number/, { priorityPages: 0 });
      expectPass("every priority cluster built", "GT-011", CLEAN);
      const noPlan = one("GT-011", CLEAN, {}, pewpVariant((d) => jedit(d, "plan/sitemap.json", (s) => { s.pages = s.pages.filter((x) => x.cluster !== "c-home-value"); })));
      check("G: GT-011 a cluster the plan has no page for counts as unbuilt", /WARN unbuilt priority cluster .*home value roseville ca.*the plan has no page for it/.test(text(noPlan)), text(noPlan));
      const noCost = variant([], { remove: ["sell/cost-of-a-realtor/index.html"] });
      const byPrio = one("GT-011", noCost, { priorityPages: 2 });
      check("G: GT-011 the top clusters are chosen by priority, not by file order (priority 8 is #2 although it is the 4th cluster in targets.json)", byPrio.status === "PASS" && /WARN unbuilt priority cluster #2 "how much does a realtor cost in california" \(c-cost-of-realtor, priority 8/.test(text(byPrio)) && !/#1 /.test(text(byPrio)), text(byPrio));
      const notOk = G.gate(pewp, CLEAN, { only: ["GT-011"] });
      check("G: GT-011 on the clean site names the top 6", /top 6/.test(notOk.results[0].summary), notOk.results[0].summary);
    }
    // GT-012 intent-fit (TGT-012, P1)
    expectFail("an informational cluster whose page is a Product page", "GT-012", variant([["sell/cost-of-a-realtor/index.html", (h) => h.replace("</head>", '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Realtor"}</script></head>')]]), /\/sell\/cost-of-a-realtor\/: the cluster "how much does a realtor cost in california" \(c-cost-of-realtor\) is informational but the page is of type product; informational searches are answered by pages of type article, page, video, comparison/);
    expectFail("a local cluster whose page is an Article (the planted wrong schema)", "GT-012", SITE, /\/home-value\/: .*is local but the page is of type article/);
    expectFail("a local cluster whose page is a Product page", "GT-012", variant([["rocklin-ca/index.html", (h) => h.replace("</head>", '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"x"}</script></head>')]]), /\/rocklin-ca\/: .*is local but the page is of type product/);
    expectPass("a local cluster served by a LocalBusiness-subtype page (RealEstateAgent) or a plain page", "GT-012", CLEAN);
    expectPass("a Product page for a transactional cluster is fine", "GT-012", variant([["sell/cost-of-a-realtor/index.html", (h) => h.replace("</head>", '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"x"}</script></head>')]]), {}, pewpVariant((d) => jedit(d, "targets.json", (t) => { t.clusters.find((c) => c.id === "c-cost-of-realtor").intent = "transactional"; })));
    expectFail("a transactional cluster whose brief has no CTA accepts only product, category or local pages", "GT-012", CLEAN, /is transactional but the page is of type article; transactional searches are answered by pages of type product, category, local \(or a page with a call to action in its brief; this brief has none\)/, {}, pewpVariant((d) => { jedit(d, "targets.json", (t) => { t.clusters.find((c) => c.id === "c-cost-of-realtor").intent = "transactional"; }); const f = path.join(d, "plan/briefs/sell-cost-of-a-realtor.md"); const before = fs.readFileSync(f, "utf8"); fs.writeFileSync(f, before.replace(/^- CTA:.*\n/m, "")); if (before === fs.readFileSync(f, "utf8")) throw new Error("test patch never applied: CTA line"); }));
    expectErr("no page of the plan is built", "GT-012", variant([], { remove: ["home-value/index.html", "lincoln-ca/index.html", "rocklin-ca/index.html", "sell/cost-of-a-realtor/index.html", "guides/sell-my-house-without-a-realtor-california/index.html", "index.html"] }), /no cluster page is built/);
    // GT-005 required terms (TGT-005, W)
    {
      const withTerms = pewpVariant((d) => { const f = path.join(d, "plan/briefs/rocklin-ca.md"); const before = fs.readFileSync(f, "utf8"); fs.writeFileSync(f, before.replace("## Entities to cover", "## Required terms\n- escrow timeline\n- title company\n- lockbox\n- staging plan\n\n## Entities to cover")); if (before === fs.readFileSync(f, "utf8")) throw new Error("test patch never applied: Entities heading"); });
      const w = one("GT-005", CLEAN, {}, withTerms);
      check("G: GT-005 fewer than 60% of a brief's required terms on the page is a WARN (W), not a FAIL", w.status === "PASS" && /WARN TGT-005 \/rocklin-ca\/: covers 0% of the 4 required terms \(needs 60%\); missing: escrow timeline, title company, lockbox, staging plan/.test(text(w)), text(w));
      expectFail("the same gap under --strict", "GT-005", CLEAN, /TGT-005 \/rocklin-ca\/: covers 0%/, { strict: true }, withTerms);
      const covered = variant([["rocklin-ca/index.html", sub("</main>", "<p>Your escrow timeline, the title company and a staging plan are agreed up front.</p></main>")]]);
      const okc = one("GT-005", covered, {}, withTerms);
      check("G: GT-005 3 of 4 required terms (75%) covered: no warning", okc.status === "PASS" && !/TGT-005/.test(text(okc)), text(okc));
    }
    // GT-005 brief covered
    expectFail("an outline heading renamed away", "GT-005", variant([["rocklin-ca/index.html", sub("<h2>What it costs</h2>", "<h2>Pricing</h2>")]]), /rocklin-ca.*no heading "What it costs"/);
    expectFail("a required entity removed", "GT-005", variant([["rocklin-ca/index.html", (h) => h.split("Placer County").join("the region")]]), /entity "Placer County" is not on the page/);
    expectFail("an entity only present as scattered words does not count (phrase must be contiguous)", "GT-005", variant([["rocklin-ca/index.html", (h) => h.split("Placer County").join("the region").replace("</main>", "<p>The county is lovely. Each placer of gold is a rare find.</p></main>")]]), /entity "Placer County"/);
    expectFail("a brief question removed from the page", "GT-005", variant([["rocklin-ca/index.html", sub("<h3>How long does a home take to sell in Rocklin?</h3>", "<h3>Timing</h3>")]]), /question "How long does a home take to sell in Rocklin\?" is not on the page/);
    expectFail("a page thinner than the brief's minimum", "GT-005", variant([["home-value/index.html", (h) => h.replace(/<p>[^<]{60,}<\/p>/g, "<p>Short.</p>")]]), /home-value.*words, the brief needs at least 200/);
    // GT-006 internal links
    expectFail("a generic footer anchor 'read more' to a planned page", "GT-006", variant([["index.html", sub("</footer>", '<a href="/rocklin-ca/">read more</a></footer>')]]), /generic anchor "read more"/);
    expectFail("a planned body link turned into 'click here'", "GT-006", variant([["index.html", sub('<a href="/lincoln-ca/">real estate agent lincoln ca</a>', '<a href="/lincoln-ca/">click here</a>')]]), /generic anchor "click here"/);
    expectFail("a body anchor sharing no word with the target's query", "GT-006", variant([["index.html", sub('<a href="/lincoln-ca/">real estate agent lincoln ca</a>', '<a href="/lincoln-ca/">our latest news</a>')]]), /anchor "our latest news" shares no content word/);
    expectFail("a planned link removed", "GT-006", variant([["index.html", sub('<li><a href="/home-value/">home value roseville ca</a></li>', "")]]), /\/ -> \/home-value\/: planned link .* is not on the page/);
    expectFail("a broken internal link", "GT-006", variant([["sell/cost-of-a-realtor/index.html", sub("</main>", '<p><a href="/nope/">a missing page</a></p></main>')]]), /broken internal link \/nope\//);
    expectPass("different but descriptive anchors, external, mailto and in-page links are fine", "GT-006", variant([["index.html", sub('<a href="/lincoln-ca/">real estate agent lincoln ca</a>', '<a href="/lincoln-ca/">our Lincoln agent</a><a href="https://elsewhere.test/">Elsewhere</a> <a href="mailto:a@b.test">mail</a> <a href="#top">top</a>')]]));
    // GT-007 orphans
    const dropGuide = [["index.html", sub(/<li><a href="\/guides\/[^"]*">[^<]*<\/a><\/li>/, "")], ["sell/cost-of-a-realtor/index.html", sub(/<li><a href="\/guides\/[^"]*">[^<]*<\/a><\/li>/, "")]];
    expectFail("a page nobody links to", "GT-007", variant(dropGuide), /guides\/sell-my-house[^\n]*no page links to it/);
    expectPass("a noindex page with no inbound link is not an orphan problem", "GT-007", variant([...dropGuide, ["guides/sell-my-house-without-a-realtor-california/index.html", sub('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="robots" content="noindex">')]]));
    expectFail("two pages that only link to each other (an island)", "GT-007", variant([["index.html", sub(/<li><a href="\/(?:sell\/cost-of-a-realtor|guides\/[^"]*)\/">[^<]*<\/a><\/li>/g, "")]]), /cannot be reached from the home page/);
    expectErr("a site without a home page", "GT-007", variant([], { remove: ["index.html"] }), /no home page/);
    // GT-008 schema
    expectFail("invalid JSON-LD", "GT-008", variant([["rocklin-ca/index.html", sub("}]}</script>", "}]</script>")]]), /rocklin-ca.*does not parse/);
    expectFail("Article without an author", "GT-008", variant([["sell/cost-of-a-realtor/index.html", sub('"author":{"@type":"Person","name":"Jane Sample"},', "")]]), /Article has no author/);
    expectFail("a FAQ question in the JSON-LD that the page does not show", "GT-008", variant([["sell/cost-of-a-realtor/index.html", sub("<h3>Is 3% a normal real estate commission?</h3>", "<h3>Fees</h3>")]]), /FAQ question "Is 3% a normal real estate commission\?" is in the JSON-LD but not shown/);
    expectFail("the planned type missing altogether", "GT-008", variant([["home-value/index.html", sub('"@type":"Service"', '"@type":"Thing"')]]), /schema type Service is missing/);
    expectPass("a subtype satisfies the planned type (BlogPosting for Article)", "GT-008", variant([["sell/cost-of-a-realtor/index.html", sub('"@type":"Article"', '"@type":"BlogPosting"')]]));
    {
      const { satisfies } = await imp("gate-schema.mjs");
      check("G: schema.org subtype table (RealEstateAgent is a LocalBusiness and an Organization; Service is not an Article)", satisfies("RealEstateAgent", "LocalBusiness") && satisfies("RealEstateAgent", "Organization") && satisfies("BlogPosting", "Article") && satisfies("FAQPage", "WebPage") && !satisfies("Service", "Article") && !satisfies("Organization", "LocalBusiness"));
    }
    // GT-009 programmatic
    expectFail("a town page that is the neighbour's text with the name swapped", "GT-009", variant([["lincoln-ca/index.html", () => fs.readFileSync(path.join(CLEAN, "rocklin-ca", "index.html"), "utf8").split("Rocklin").join("Lincoln").split("rocklin").join("lincoln")]]), /shared with a sibling page/);
    expectFail("a town page without its local facts", "GT-009", variant([["lincoln-ca/index.html", (h) => h.replace(/Twelve Bridges|Joiner Parkway|Coyote Creek Park|Lincoln Crossing/g, "the area")]]), /lincoln-ca.*sourced local facts on the page, needs 4/);
    expectFail("a thin town page", "GT-009", variant([["lincoln-ca/index.html", (h) => h.replace(/<p>[^<]{60,}<\/p>/g, "<p>Short.</p>")]]), /lincoln-ca.*words, needs 250/);
    expectFail("local facts that carry no source do not count", "GT-009", CLEAN, /lincoln-ca.*sourced local facts on the page, needs 4/, {}, pewpVariant((d) => jedit(d, "plan/programmatic-data.json", (o) => { o.records["/lincoln-ca/"].facts.forEach((f) => { delete f.source; }); })));
    expectFail("a template page with no data record", "GT-009", CLEAN, /no record in plan\/programmatic-data\.json/, {}, pewpVariant((d) => jedit(d, "plan/programmatic-data.json", (o) => { delete o.records["/lincoln-ca/"]; })));
    expectErr("the data file is missing", "GT-009", CLEAN, /programmatic-data\.json/, {}, pewpVariant((d) => fs.rmSync(path.join(d, "plan/programmatic-data.json"))));
    expectPass("no programmatic pages planned", "GT-009", CLEAN, {}, pewpVariant((d) => jedit(d, "plan/programmatic.json", (o) => { o.groups = []; })));
    {
      const { metrics } = await imp("gate-programmatic.mjs");
      const a = "alpha beta gamma delta epsilon zeta eta theta iota kappa", b = "alpha beta gamma delta epsilon zeta eta theta iota kappa", c = "one two three four five six seven eight nine ten";
      const m = metrics([a, b, c]);
      check("G: GT-009 metrics: identical texts are 100% similar with 0 unique words, a different text 0% and fully unique", m[0].similarity === 1 && m[0].uniqueWords === 0 && m[2].similarity === 0 && m[2].uniqueWords === 10, JSON.stringify(m));
    }
    // GT-010 industry rules
    expectFail("a page without the licence number", "GT-010", variant([["index.html", sub(" DRE #01234567.", "")]]), /RE-LIC-001 \/ no licence number shown/);
    expectFail("a licence number that is not the business's", "GT-010", variant([["sell/cost-of-a-realtor/index.html", sub("01234567", "07654321")]]), /RE-LIC-001 \/sell\/cost-of-a-realtor\/ shows a licence number that is not 01234567/);
    expectFail("the brokerage name missing on a page", "GT-010", variant([["rocklin-ca/index.html", sub("Broker: Sample Valley Brokerage Inc. ", "")]]), /RE-BRK-001 \/rocklin-ca\/ does not show "Sample Valley Brokerage Inc\."/);
    expectFail("fair-housing wording", "GT-010", variant([["home-value/index.html", sub("</main>", "<p>This home is perfect for young families.</p></main>")]]), /RE-FH-001 \/home-value\/ contains "perfect for young families"/);
    expectFail("an unfilled placeholder", "GT-010", variant([["home-value/index.html", sub("</main>", "<p>Broker: {{BROKER_NAME}}</p></main>")]]), /RE-PLACEHOLDER-001 \/home-value\/ contains "\{\{BROKER_NAME\}\}"/);
    {
      const fc = variant([["home-value/index.html", sub("</main>", "<p>We offer foreclosure help.</p></main>")]]);
      expectFail("foreclosure copy while DEF-05 binds", "GT-010", fc, /RE-DEF05-001 \/home-value\//);
      expectPass("the same page once the sign-off lifts DEF-05 (--waive)", "GT-010", fc, { waive: ["RE-DEF05-001"] });
    }
    {
      const warnSite = variant([["home-value/index.html", sub("</main>", "<p>A guaranteed sale for every seller.</p></main>")]]);
      const r = one("GT-010", warnSite);
      check("G: GT-010 a substantiation claim is a WARN, not a FAIL, until --strict", r.status === "PASS" && /WARN RE-ADV-001/.test(text(r)), text(r));
      expectFail("the same claim under --strict", "GT-010", warnSite, /FAIL RE-ADV-001/, { strict: true });
    }
    {
      expectFail("--strict makes the missing disclosure pages a launch blocker", "GT-010", CLEAN, /FAIL RE-DISC-001 none of \/privacy\//, { strict: true });
      const page = (t) => `<!doctype html><html><head><title>${t}</title></head><body><main><h1>${t}</h1><p>Plain words.</p></main><footer><p>DRE #01234567. Broker: Sample Valley Brokerage Inc.</p></footer></body></html>`;
      expectPass("--strict passes once the privacy and accessibility pages exist", "GT-010", variant([], { add: { "privacy/index.html": page("Privacy"), "accessibility/index.html": page("Accessibility") } }), { strict: true });
    }
    {
      const ch = pewpVariant((d) => jedit(d, "business.json", (b) => { b.industry = "cash-home-buyer"; b.credentials.licensed = false; }));
      expectFail("a principal cash buyer must not show a licence claim", "GT-010", CLEAN, /CH-NOLIC-001 \/ contains "DRE #01234567"/, {}, ch);
      const chLic = pewpVariant((d) => jedit(d, "business.json", (b) => { b.industry = "cash-home-buyer"; b.credentials.licensed = true; }));
      const r = one("GT-010", CLEAN, {}, chLic);
      check("G: GT-010 the licence-claim rules switch off when the buyer is licensed", r.status === "PASS" && /CH-NOLIC-001 not applicable/.test(text(r)), text(r));
      for (const [phrase, id] of [["We are a licensed real estate agent.", "CH-NOAGENT-001"], ["We pay full market value for every home.", "CH-VALUE-001"], ["We buy mortgage notes too.", "CH-NOTES-001"]])
        expectFail(`cash-buyer wording '${phrase}'`, "GT-010", variant([["home-value/index.html", sub("</main>", `<p>${phrase}</p></main>`)]]), new RegExp(`${id} /home-value/`), {}, ch);
      const noInd = pewpVariant((d) => jedit(d, "business.json", (b) => { b.industry = null; }));
      expectPass("no industry selected means no industry rules", "GT-010", SITE, {}, noInd);
      expectErr("an unknown industry slug", "GT-010", CLEAN, /no-such/, {}, pewpVariant((d) => jedit(d, "business.json", (b) => { b.industry = "no-such"; })));
      expectErr("the brokerage value is missing from business.json", "GT-010", CLEAN, /credentials\.brokerage/, {}, pewpVariant((d) => jedit(d, "business.json", (b) => { b.credentials = { state: "CA" }; })));
    }

    // GT-010 insurance-agency pack (rules/industries/insurance-agency.json): loads, validates against the same item schema as every pack, and drives the gate
    {
      const { loadIndustry } = await imp("lib-plan.mjs");
      const INDDIR = path.join(scriptsDir, "..", "rules", "industries");
      const KNOWN = new Set(["licence-on-every-page", "business-text-on-every-page", "forbidden-phrases", "required-pages", "required-when-present", "forbidden-schema"]);
      const itemProblems = (pack) => {
        const out = [], ids = new Set(), rx = (s, w) => { try { new RegExp(s, "i"); } catch (e) { out.push(`${w}: ${e.message}`); } };
        for (const k of ["slug", "title", "jurisdiction", "notes"]) if (typeof pack[k] !== "string" || !pack[k].trim()) out.push(`pack.${k} missing`);
        if (!Array.isArray(pack.sources) || !pack.sources.length) out.push("pack.sources missing");
        for (const it of pack.items || []) {
          const w = it.id || "(no id)";
          if (!/^[A-Z]{2,3}(?:-[A-Z0-9]+)+-\d{3}$/.test(it.id || "")) out.push(`${w}: bad id`);
          if (ids.has(it.id)) out.push(`${w}: duplicate id`); ids.add(it.id);
          if (!KNOWN.has(it.type)) out.push(`${w}: unknown type ${it.type}`);
          if (!["fail", "warn"].includes(it.severity)) out.push(`${w}: severity`);
          if (typeof it.description !== "string" || it.description.length < 15) out.push(`${w}: description`);
          if (typeof it.source !== "string" || it.source.length < 20) out.push(`${w}: source`);
          if (it.type === "forbidden-phrases") { if (!Array.isArray(it.patterns) || !it.patterns.length) out.push(`${w}: patterns`); else it.patterns.forEach((p) => rx(p, w)); }
          if (it.type === "required-pages" && !(Array.isArray(it.anyOf) && it.anyOf.length && it.anyOf.every((g) => Array.isArray(g) && g.length && g.every((x) => /^\/.*\/$/.test(x))))) out.push(`${w}: anyOf`);
          if (it.type === "licence-on-every-page") { if (!it.licencePatterns?.default || !it.stateField || !it.numberField) out.push(`${w}: licence fields`); else rx(it.licencePatterns.default, w); }
          if (it.type === "business-text-on-every-page" && !it.field) out.push(`${w}: field`);
          if (it.type === "forbidden-schema" && !(Array.isArray(it.types) && it.types.length && it.types.every((t) => /^[A-Z][A-Za-z]+$/.test(t)))) out.push(`${w}: types`);
          if (it.type === "required-when-present") {
            if (!Array.isArray(it.require) || !it.require.length) out.push(`${w}: require`); else for (const r of it.require) { if (!r.label || !r.pattern) out.push(`${w}: require entry`); else rx(r.pattern, w); }
            if (it.trigger) rx(it.trigger, w);
            if (it.pathPattern) rx(it.pathPattern, w);
            if (it.nearChars !== undefined && !(Number.isInteger(it.nearChars) && it.nearChars > 0 && it.trigger)) out.push(`${w}: nearChars needs a trigger and a positive integer`);
            if (!it.trigger && !it.pageHasForm && !it.pathPattern && !/^INS-STATE-/.test(it.id)) out.push(`${w}: applies to every page without saying so`);
          }
        }
        return out;
      };
      const allPacks = fs.readdirSync(INDDIR).filter((f) => f.endsWith(".json")).map((f) => J(path.join(INDDIR, f)));
      check("G: every rules/industries pack (real-estate-agent, cash-home-buyer, insurance-agency) validates against the item schema", allPacks.length >= 3 && allPacks.every((p) => itemProblems(p).length === 0) , allPacks.map((p) => `${p.slug}: ${itemProblems(p).join("; ")}`).join(" | "));
      check("G: the validator itself refuses a broken pack (unknown type, bad regex, duplicate id, missing source, nearChars without a trigger)", (() => { const bad = { slug: "x", title: "x", jurisdiction: "x", notes: "x", sources: ["x"], items: [{ id: "XX-A-001", type: "nope", severity: "fail", description: "long enough text here", source: "short" }, { id: "XX-A-001", type: "forbidden-phrases", severity: "warn", description: "long enough text here", source: "a source that is long enough", patterns: ["("] }, { id: "XX-A-002", type: "required-when-present", severity: "warn", description: "long enough text here", source: "a source that is long enough", nearChars: 10, trigger: undefined, require: [{ label: "l", pattern: "a" }] }] }; const p = itemProblems(bad).join("|"); return /unknown type/.test(p) && /duplicate id/.test(p) && /: source/.test(p) && /Invalid regular expression/.test(p) && /nearChars needs a trigger/.test(p); })());
      const ins = loadIndustry("insurance-agency", INDDIR);
      check("G: insurance-agency pack loads through loadIndustry (slug, 30+ items, 7+ page types, 50+ seed queries)", ins.slug === "insurance-agency" && ins.items.length >= 30 && ins.pageTypes.length >= 7 && ins.seeds.queries.length >= 50, `${ins.slug} ${ins.items.length}`);
      check("G: insurance-agency covers every area asked for: licence, state notice, FDIC and PMI wording, income promises, consent, E-E-A-T, schema, disclosure pages", ["INS-LIC-001", "INS-STATE-001", "INS-ANN-001", "INS-MP-001", "INS-INCOME-001", "INS-REC-001", "INS-FORM-001", "INS-EEAT-001", "INS-SCHEMA-001", "INS-SCHEMA-002", "INS-DISC-001", "INS-GUAR-001", "INS-FREE-001", "INS-MISL-001"].every((id) => ins.items.some((i) => i.id === id)));
      check("G: insurance-agency has no client-specific facts (no business, person or place names)", !/\b(?:francine|masudi|omnikom|valley to valley|valleytovalley|elibuyshomes|abdo|tracy|manteca)\b/i.test(fs.readFileSync(path.join(INDDIR, "insurance-agency.json"), "utf8")));
      check("G: every insurance-agency rule cites an authority, and each NAIC number or section is marked UNVERIFIED", ins.items.every((i) => /NAIC|FTC|Google|TCPA|IRC|FINRA|Gramm|state|Bus\. & Prof|policy|Interagency|CAN-SPAM|Nothing that needs/i.test(i.source)) && ins.items.filter((i) => /NAIC/.test(i.source)).every((i) => /UNVERIFIED/.test(i.source)), ins.items.filter((i) => /NAIC/.test(i.source) && !/UNVERIFIED/.test(i.source)).map((i) => i.id).join(","));
      check("G: insurance-agency never plans Product or Offer markup and gives every planner kind a schema", ins.pageTypes.every((t) => t.schema.length && !t.schema.some((s) => ["Product", "Offer", "AggregateOffer", "Review", "AggregateRating"].includes(s))) && ["home", "money", "city-landing", "guide", "hub"].every((k) => ins.pageTypes.some((t) => t.plannerKind === k)), JSON.stringify(ins.pageTypes.map((t) => [t.id, t.plannerKind, t.schema])));
      {
        const { satisfies } = await imp("gate-schema.mjs");
        check("G: schema table: InsuranceAgency is a FinancialService, a LocalBusiness and an Organization; Service is not an InsuranceAgency", satisfies("InsuranceAgency", "FinancialService") && satisfies("InsuranceAgency", "LocalBusiness") && satisfies("InsuranceAgency", "Organization") && !satisfies("Service", "InsuranceAgency"));
        const S = await imp("research-seeds.mjs");
        const sq = S.packSeeds("insurance-agency", INDDIR);
        check("G: research-seeds --industry insurance-agency: product line, intent and scope on every seed; national and {city} local queries; fixed vs fixed indexed annuity, mortgage protection and recruiting present", sq.length >= 50 && ins.seeds.queries.every((q) => q.productLine && q.intent && ["national", "local"].includes(q.scope) && q.query === q.query.toLowerCase() && (q.scope === "local") === (/\{city\}|near me/.test(q.query) || q.intent === "local")) && sq.some((q) => q.query === "fixed indexed annuity vs fixed annuity") && sq.some((q) => q.query === "mortgage protection insurance") && sq.some((q) => q.query === "become a life insurance agent") && sq.some((q) => /\{city\}/.test(q.query)) && ["mortgage-protection", "life-insurance", "annuities", "recruiting"].every((l) => ins.seeds.queries.some((q) => q.productLine === l)), JSON.stringify(sq.slice(0, 2)));
        let thrown = ""; try { S.packSeeds("../escape", INDDIR); } catch (e) { thrown = e.message; }
        let none = ""; try { S.packSeeds("real-estate-agent", INDDIR); } catch (e) { none = e.message; }
        check("G: research-seeds --industry refuses a path-like slug and a pack without seeds", /not a pack slug/.test(thrown) && /no seeds\.queries/.test(none), `${thrown} | ${none}`);
      }

      // plan-site: the pack names the schema per page kind
      {
        const ip = fresh("insplan"); cp(path.join(FIX, "pewp"), ip);
        jedit(ip, "business.json", (b) => { b.industry = "insurance-agency"; b.kind = "insurance-agency"; b.name = "Sample Coverage Group"; b.credentials = { state: "CA", licenseNumber: "0A12345", agencyLegalName: "Sample Coverage Group LLC" }; });
        const r = node("plan-site.mjs", [ip, ...PLAN_FLAGS]);
        const sm = r.status === 0 ? J(path.join(ip, "plan", "sitemap.json")) : { pages: [] };
        const s = (c) => (sm.pages.find((p) => p.cluster === c)?.schema || []).join("+");
        check("P: insurance-agency plan: home InsuranceAgency+WebSite, guide Article+FAQPage, product page Service+FAQPage, city Service+FAQPage (the pack's pageTypes, not the real-estate defaults)", r.status === 0 && s("c-agent-roseville") === "InsuranceAgency+WebSite" && s("c-cost-of-realtor") === "Article+FAQPage" && s("c-home-value") === "Service+FAQPage" && s("c-agent-rocklin") === "Service+FAQPage", r.stdout + r.stderr + JSON.stringify(sm.pages.map((p) => [p.cluster, p.schema])));
        const brief = r.status === 0 ? fs.readFileSync(path.join(ip, sm.pages[0].brief), "utf8") : "";
        check("P: insurance-agency briefs list its rule ids and the licence proof item", /INS-ANN-001/.test(brief) && /INS-REC-001/.test(brief) && /National Producer Number/.test(brief), brief.slice(-600));
        const re = node("plan-site.mjs", [pewp, ...PLAN_FLAGS]);
        const smRe = J(path.join(pewp, "plan", "sitemap.json"));
        check("P: a pack without pageTypes (real-estate-agent) keeps the built-in schema choice", re.status === 0 && smRe.pages.find((p) => p.cluster === "c-agent-roseville").schema.join("+") === "RealEstateAgent+WebSite");
        check("V: business.json credentials.agencyLegalName must be text when present", V.validateBusiness({ ...J(path.join(FIX, "pewp", "business.json")), credentials: { agencyLegalName: "" } }).errors.some((e) => e.path === "credentials.agencyLegalName") && V.validateBusiness({ ...J(path.join(FIX, "pewp", "business.json")), credentials: { agencyLegalName: "Sample Coverage Group LLC" } }).ok);
      }

      // the gate: a generated clean insurance site passes, and each planted fault is named
      const FOOTER = "Sample Coverage Group LLC. Jane Sample, licensed insurance producer, license 0A12345, NPN 1234567. Licensed in California; products and features vary by state. Annuities are not a bank deposit and are not FDIC insured. <a href=\"/privacy/\">Privacy policy</a> <a href=\"/licensing/\">Licensing and disclosures</a>";
      const iPage = (title, body, head = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body><header><nav><a href="/">Sample Coverage Group</a></nav></header><main><h1>${title}</h1>${body}</main><footer><p>${FOOTER}</p></footer></body></html>`;
      const FILLER = `<p>${"Plain words about how this works. ".repeat(80)}</p>`;
      const INSFILES = {
        "index.html": iPage("Independent insurance agency", "<p>An independent agency helping homeowners and families with life insurance and annuities. Request a free quote today.</p>", '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"InsuranceAgency","name":"Sample Coverage Group","url":"https://insurance.example/"},{"@type":"WebSite","name":"Sample Coverage Group","url":"https://insurance.example/"}]}</script>'),
        "mortgage-protection/index.html": iPage("Mortgage protection insurance", "<p>Mortgage protection is a life insurance policy that helps your family keep the home. The benefit is paid directly to your named beneficiary, not to the lender. Mortgage protection is not PMI (private mortgage insurance) and does not replace it. Coverage is subject to underwriting and eligibility.</p>", '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Service","name":"Mortgage protection life insurance","serviceType":"Life insurance"}</script>'),
        "annuities/fixed-indexed/index.html": iPage("Fixed indexed annuity", "<p>A fixed indexed annuity credits interest based on an index, with a minimum interest rate set in the contract. Guarantees are backed by the claims-paying ability of the issuing insurance company. These annuities are not a bank deposit and not FDIC insured. Surrender charges apply to early withdrawals. Growth is tax-deferred; gains are taxed as ordinary income when withdrawn, and withdrawals before age 59 1/2 may carry an additional tax.</p>" + FILLER),
        "life-insurance/indexed-universal/index.html": iPage("Indexed universal life", "<p>Indexed universal life (IUL) is permanent life insurance whose cash value is credited with interest linked to an index, up to a cap and a participation rate, with a floor. Policy loans and withdrawals reduce the death benefit and cash value and can cause the policy to lapse. An illustration is hypothetical and not guaranteed. Coverage is subject to underwriting and eligibility. No medical exam options are available for some applicants.</p>"),
        "become-an-agent/index.html": iPage("Become an insurance agent", "<p>Become a licensed insurance agent with our independent agency. A state insurance license is required before you can sell. Agents are independent contractors paid on commission only; there are no upfront fees, and the costs of licensing and training are paid by the agent. Income depends on your own work and is not guaranteed; results vary.</p>"),
        "guides/mortgage-protection-vs-pmi/index.html": iPage("Mortgage protection vs PMI", "<p>Written by Jane Sample. Reviewed by John Reviewer, licensed insurance producer. Last reviewed: 2026-10-01.</p><p>Mortgage protection is not PMI (private mortgage insurance). PMI protects your lender; mortgage protection is life insurance paid to your named beneficiary.</p>"),
        "get-a-quote/index.html": iPage("Get a quote", '<form action="/thanks/" method="post"><label>Name <input name="n"></label><label>Phone <input name="p"></label><button>Get my quote</button></form><p>By submitting this form you agree that Sample Coverage Group LLC may contact you by phone call, text message or email about insurance. Consent is not a condition of purchase. Message and data rates may apply; reply STOP to opt out. See our <a href="/privacy/">privacy policy</a>.</p>'),
        "privacy/index.html": iPage("Privacy", "<p>How we handle your information.</p>"),
        "accessibility/index.html": iPage("Accessibility", "<p>How to reach us if a page does not work for you.</p>"),
        "licensing/index.html": iPage("Licensing and disclosures", "<p>The states where we are licensed and what we disclose.</p>"),
      };
      const INS = fresh("inssite");
      for (const [rel, html] of Object.entries(INSFILES)) { fs.mkdirSync(path.dirname(path.join(INS, rel)), { recursive: true }); fs.writeFileSync(path.join(INS, rel), html); }
      const insPewp = pewpVariant((d) => jedit(d, "business.json", (b) => { b.industry = "insurance-agency"; b.kind = "insurance-agency"; b.credentials = { state: "CA", licenseNumber: "0A12345", agencyLegalName: "Sample Coverage Group LLC" }; }));
      const iv = (edits, o = {}) => variant(edits, { base: INS, ...o });
      expectPass(`a clean ${Object.keys(INSFILES).length}-page insurance site (every disclosure present, allowed schema only)`, "GT-010", INS, {}, insPewp);
      expectPass("the same clean site under --strict (no warning left)", "GT-010", INS, { strict: true }, insPewp);
      check("G: GT-010 insurance-agency reports its whole rule count on the clean site", /^\d+ industry rule item\(s\) on 10 page\(s\) \(insurance-agency\)$/.test(one("GT-010", INS, {}, insPewp).summary) && one("GT-010", INS, {}, insPewp).summary.startsWith(`${ins.items.length} `), one("GT-010", INS, {}, insPewp).summary);
      // banned and flagged phrases: each appended to the mortgage protection page
      const addP = (phrase) => iv([["mortgage-protection/index.html", sub("</main>", `<p>${phrase}</p></main>`)]]);
      for (const [phrase, id] of [
        ["Guaranteed returns of 8% every year.", "INS-GUAR-001"], ["This plan is risk-free.", "INS-GUAR-001"], ["Best rates guaranteed.", "INS-GUAR-001"], ["You can never lose money.", "INS-GUAR-001"],
        ["Get free life insurance today.", "INS-FREE-001"], ["Your lender requires this coverage.", "INS-MISL-001"], ["Important notice regarding your mortgage.", "INS-MISL-001"],
        ["Earn $10,000 a month as an agent.", "INS-INCOME-001"], ["Build a six-figure income.", "INS-INCOME-001"], ["No license needed to start.", "INS-REC-LIC-001"],
        ["Add your license {{LICENSE_NUMBER}} here.", "INS-PLACEHOLDER-001"],
      ]) expectFail(`insurance wording '${phrase}'`, "GT-010", addP(phrase), new RegExp(`FAIL ${id} /mortgage-protection/ contains`), {}, insPewp);
      for (const [phrase, id] of [
        ["We offer guaranteed lifetime income.", "INS-GUAR-002"], ["Mortgage insurance for your family.", "INS-MISL-002"], ["Enjoy tax-free retirement income.", "INS-TAX-001"],
        ["Ask about variable annuities.", "INS-INV-001"], ["We are the #1 life insurance agency.", "INS-CLAIM-001"], ["Build your downline today.", "INS-MLM-001"],
      ]) {
        const site = addP(phrase);
        const r = one("GT-010", site, {}, insPewp);
        check(`G: GT-010 '${phrase}' is a WARN (${id}) and not a failure before launch`, r.status === "PASS" && new RegExp(`WARN ${id} /mortgage-protection/ contains`).test(text(r)), `${r.status} ${text(r)}`);
        expectFail(`'${phrase}' under --strict`, "GT-010", site, new RegExp(`FAIL ${id} /mortgage-protection/ contains`), { strict: true }, insPewp);
      }
      expectPass("clean wording that only sounds close ('not risk-free', 'free quote', 'free coverage review', 'not mortgage insurance')", "GT-010", iv([["mortgage-protection/index.html", sub("</main>", "<p>This policy is not risk-free. Ask for a free quote or a free coverage review. It is not mortgage insurance (PMI).</p></main>")]]), { strict: true }, insPewp);
      expectPass("a banned phrase is waived once a sign-off lifts the rule (--waive)", "GT-010", addP("Get free life insurance today."), { waive: ["INS-FREE-001"] }, insPewp);
      // required elements
      expectFail("mortgage protection page without the 'not PMI' statement", "GT-010", iv([["mortgage-protection/index.html", sub(" Mortgage protection is not PMI (private mortgage insurance) and does not replace it.", "")]]), /FAIL INS-MP-001 \/mortgage-protection\/ is missing: a statement that mortgage protection is not PMI/, {}, insPewp);
      expectFail("mortgage protection page without the beneficiary statement, under --strict", "GT-010", iv([["mortgage-protection/index.html", sub(" The benefit is paid directly to your named beneficiary, not to the lender.", "")]]), /FAIL INS-MP-002 \/mortgage-protection\/ is missing: the benefit is paid to the named beneficiary \(within 1500 characters/, { strict: true }, insPewp);
      expectFail("annuity page without any 'not a bank deposit / not FDIC insured' wording", "GT-010", iv([["annuities/fixed-indexed/index.html", sub(/(?:These a|A)nnuities are not a bank deposit[^.]*\./g, "")]]), /FAIL INS-ANN-001 \/annuities\/fixed-indexed\/ is missing: 'not a bank deposit/, {}, insPewp);
      {
        const far = iv([["annuities/fixed-indexed/index.html", sub(" These annuities are not a bank deposit and not FDIC insured.", "")]]);
        const r = one("GT-010", far, {}, insPewp);
        check("G: GT-010 the FDIC wording only in the footer, far from the annuity rate claim, is a WARN (INS-ANN-002) before launch and passes INS-ANN-001", r.status === "PASS" && /WARN INS-ANN-002 \/annuities\/fixed-indexed\/ is missing/.test(text(r)) && !/INS-ANN-001/.test(text(r)), `${r.status} ${text(r)}`);
        expectFail("the same distance under --strict", "GT-010", far, /FAIL INS-ANN-002 \/annuities\/fixed-indexed\/ is missing: 'not a bank deposit \/ not FDIC insured' \(within 1500 characters of/, { strict: true }, insPewp);
      }
      expectFail("annuity page without surrender-charge wording, under --strict", "GT-010", iv([["annuities/fixed-indexed/index.html", sub(" Surrender charges apply to early withdrawals.", "")]]), /FAIL INS-ANN-003 \/annuities\/fixed-indexed\//, { strict: true }, insPewp);
      expectFail("a guarantee with no claims-paying-ability statement, under --strict", "GT-010", iv([["annuities/fixed-indexed/index.html", sub(" Guarantees are backed by the claims-paying ability of the issuing insurance company.", " Guarantees apply.")]]), /FAIL INS-ANN-004 \/annuities\/fixed-indexed\//, { strict: true }, insPewp);
      expectFail("tax deferral without the early-withdrawal tax, under --strict", "GT-010", iv([["annuities/fixed-indexed/index.html", sub(", and withdrawals before age 59 1/2 may carry an additional tax", "")]]), /FAIL INS-ANN-005 \/annuities\/fixed-indexed\//, { strict: true }, insPewp);
      expectFail("indexed universal life without its crediting limits, under --strict", "GT-010", iv([["life-insurance/indexed-universal/index.html", sub(", up to a cap and a participation rate, with a floor", "")]]), /FAIL INS-IUL-001 \/life-insurance\/indexed-universal\//, { strict: true }, insPewp);
      expectFail("policy loans without the lapse warning, under --strict", "GT-010", iv([["life-insurance/indexed-universal/index.html", sub(" reduce the death benefit and cash value and can cause the policy to lapse", " are available")]]), /FAIL INS-IUL-002 \/life-insurance\/indexed-universal\//, { strict: true }, insPewp);
      expectFail("an illustration that is not called hypothetical, under --strict", "GT-010", iv([["life-insurance/indexed-universal/index.html", sub("An illustration is hypothetical and not guaranteed.", "An illustration is shown here.")]]), /FAIL INS-IUL-003 \/life-insurance\/indexed-universal\//, { strict: true }, insPewp);
      expectFail("'no medical exam' without 'subject to underwriting', under --strict", "GT-010", iv([["life-insurance/indexed-universal/index.html", sub(" Coverage is subject to underwriting and eligibility.", "")]]), /FAIL INS-UW-001 \/life-insurance\/indexed-universal\//, { strict: true }, insPewp);
      // recruiting pages
      expectFail("recruiting page without an earnings disclaimer", "GT-010", iv([["become-an-agent/index.html", sub(" Income depends on your own work and is not guaranteed; results vary.", "")]]), /FAIL INS-REC-001 \/become-an-agent\/ is missing: an earnings disclaimer/, {}, insPewp);
      expectFail("recruiting page that does not say a licence is required, under --strict", "GT-010", iv([["become-an-agent/index.html", sub(" A state insurance license is required before you can sell.", "")]]), /FAIL INS-REC-002 \/become-an-agent\//, { strict: true }, insPewp);
      expectFail("recruiting page that hides how agents are paid and what they pay, under --strict", "GT-010", iv([["become-an-agent/index.html", sub(" Agents are independent contractors paid on commission only; there are no upfront fees, and the costs of licensing and training are paid by the agent.", "")]]), /FAIL INS-REC-003 \/become-an-agent\/ is missing: independent contractor[\s\S]*FAIL INS-REC-003 \/become-an-agent\/ is missing: costs the agent pays/, { strict: true }, insPewp);
      // forms and consent
      expectFail("a page with a form and no consent language or privacy link", "GT-010", iv([["get-a-quote/index.html", sub(/<p>By submitting[\s\S]*?<\/p>/, "")]]), /FAIL INS-FORM-001 \/get-a-quote\/ is missing: consent wording/, {}, insPewp);
      expectFail("a page with a form that never mentions the privacy policy", "GT-010", iv([["get-a-quote/index.html", sub(/[Pp]rivacy policy/g, "terms")]]), /FAIL INS-FORM-001 \/get-a-quote\/ is missing: a link or mention of the privacy policy/, {}, insPewp);
      expectPass("the same text on a page that has no form is not asked for consent language", "GT-010", iv([["get-a-quote/index.html", sub(/<form[\s\S]*?<\/form>/, "")], ["get-a-quote/index.html", sub(/<p>By submitting[\s\S]*?<\/p>/, "<p>Call us.</p>")]]), {}, insPewp);
      expectFail("a form whose consent says nothing about 'not a condition of purchase' or opt-out, under --strict", "GT-010", iv([["get-a-quote/index.html", sub(" Consent is not a condition of purchase. Message and data rates may apply; reply STOP to opt out.", "")]]), /FAIL INS-FORM-002 \/get-a-quote\//, { strict: true }, insPewp);
      // E-E-A-T
      expectFail("a guide with no named reviewer, under --strict", "GT-010", iv([["guides/mortgage-protection-vs-pmi/index.html", sub(" Reviewed by John Reviewer, licensed insurance producer.", "")]]), /FAIL INS-EEAT-001 \/guides\/mortgage-protection-vs-pmi\/ is missing: a named reviewer/, { strict: true }, insPewp);
      expectFail("a guide with no last-reviewed date, under --strict", "GT-010", iv([["guides/mortgage-protection-vs-pmi/index.html", sub(" Last reviewed: 2026-10-01.", "")]]), /FAIL INS-EEAT-001 \/guides\/mortgage-protection-vs-pmi\/ is missing: a last-reviewed or last-updated date/, { strict: true }, insPewp);
      expectFail("a guide whose author is only 'the team', under --strict", "GT-010", iv([["guides/mortgage-protection-vs-pmi/index.html", sub("Written by Jane Sample.", "Written by the team.")]]), /FAIL INS-EEAT-001 \/guides\/mortgage-protection-vs-pmi\/ is missing: a named author/, { strict: true }, insPewp);
      // identity and licence
      expectFail("a page without the licence number, under --strict", "GT-010", iv([["licensing/index.html", sub("license 0A12345, NPN 1234567", "licensed")]]), /FAIL INS-LIC-001 \/licensing\/ no licence number shown/, { strict: true }, insPewp);
      expectFail("a licence number that is not the business's, under --strict", "GT-010", iv([["licensing/index.html", sub("0A12345", "0A99999")]]), /FAIL INS-LIC-001 \/licensing\/ shows a licence number that is not 0A12345/, { strict: true }, insPewp);
      expectFail("the agency name missing on a page", "GT-010", iv([["accessibility/index.html", sub("Sample Coverage Group LLC", "Sample Coverage")]]), /FAIL INS-AGENCY-001 \/accessibility\/ does not show "Sample Coverage Group LLC"/, {}, insPewp);
      expectErr("the agency name is missing from business.json", "GT-010", INS, /credentials\.agencyLegalName/, {}, pewpVariant((d) => jedit(d, "business.json", (b) => { b.industry = "insurance-agency"; b.credentials = { state: "CA", licenseNumber: "0A12345" }; })));
      expectFail("a page without the state availability notice, under --strict", "GT-010", iv([["privacy/index.html", sub("Licensed in California; products and features vary by state. ", "")]]), /FAIL INS-STATE-001 \/privacy\/ is missing: a state availability/, { strict: true }, insPewp);
      expectFail("a site without its licensing and disclosures page, under --strict", "GT-010", iv([], { remove: ["licensing/index.html"] }), /FAIL INS-DISC-001 none of \/licensing\//, { strict: true }, insPewp);
      // structured data
      expectFail("Product and Offer markup on an insurance page", "GT-010", iv([["index.html", sub("</head>", '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Term life","offers":{"@type":"Offer","price":"20","priceCurrency":"USD"}}</script></head>')]]), /FAIL INS-SCHEMA-001 \/ has JSON-LD type Product, Offer/, {}, insPewp);
      {
        const rv = iv([["index.html", sub("</head>", '<script type="application/ld+json">{"@context":"https://schema.org","@type":"InsuranceAgency","name":"Sample Coverage Group","aggregateRating":{"@type":"AggregateRating","ratingValue":"5","reviewCount":"3"}}</script></head>')]]);
        const r = one("GT-010", rv, {}, insPewp);
        check("G: GT-010 AggregateRating markup is a WARN (INS-SCHEMA-002) before launch", r.status === "PASS" && /WARN INS-SCHEMA-002 \/ has JSON-LD type AggregateRating/.test(text(r)), `${r.status} ${text(r)}`);
        expectFail("AggregateRating markup under --strict", "GT-010", rv, /FAIL INS-SCHEMA-002 \/ has JSON-LD type AggregateRating/, { strict: true }, insPewp);
      }
      // a license-only business that is not insurance: the real-estate pack is untouched by the new item types
      expectPass("the real-estate fixture still passes its own pack after the gate gained two item types", "GT-010", CLEAN);
    }

    // ======================= R: defects found by the build-mode end-to-end run =======================
    {
      const NOIDX = '<meta charset="utf-8"><meta name="robots" content="noindex">';
      const FILES = ["index.html", "rocklin-ca/index.html", "lincoln-ca/index.html", "sell/cost-of-a-realtor/index.html", "home-value/index.html", "guides/sell-my-house-without-a-realtor-california/index.html"];
      const noindexAll = variant(FILES.map((f) => [f, sub('<meta charset="utf-8">', NOIDX)]));
      const planned = pewpVariant((d) => jedit(d, "business.json", (b) => { b.launchState = "planned"; }));
      for (const id of ["GT-003", "GT-007", "GT-010"]) {
        const r = one(id, noindexAll, {}, planned);
        check("R: " + id + " a planned site with noindex on every page is judged as if indexable, with one note (no 'no indexable pages' error)", r.status === "PASS" && (text(r).match(/NOTE noindex by design \(launchState "planned"\)/g) || []).length === 1, r.status + " " + text(r));
      }
      const whole = G.gate(planned, noindexAll);
      check("R: the whole gate passes on a planned all-noindex site that matches its plan", whole.status === "PASS", whole.results.map((r) => r.id + r.status + (r.status === "PASS" ? "" : text(r))).join("\n"));
      expectFail("a LIVE site that is noindex everywhere stays a failure (GT-003)", "GT-003", noindexAll, /business is live/);
      expectFail("a LIVE site that is noindex everywhere stays a failure (GT-010)", "GT-010", noindexAll, /business is live/);
      expectFail("a LIVE site that is noindex everywhere stays a failure (GT-002)", "GT-002", noindexAll, /noindex but the business is live/);
      expectFail("the launch gate (--strict) never accepts noindex, even before launchState is switched to live", "GT-002", noindexAll, /--strict is the launch gate/, { strict: true }, planned);
      expectFail("an orphan is still caught on a planned site (noindex by design excuses indexability, not orphans)", "GT-007", variant([...dropGuide]), /guides\/sell-my-house[^\n]*no page links to it/, {}, planned);

      // "near me": a query with no place has no location
      const nm = fresh("nm"); cp(path.join(FIX, "pewp"), nm);
      const tt = J(path.join(nm, "targets.json"));
      const mk = (id, q, loc) => { const c = structuredClone(tt.clusters[1]); Object.assign(c, { id, primaryQuery: q, queries: [q], location: loc, targetPage: "new", questions: [], requiredEntities: [], priority: 2 }); return c; };
      tt.clusters.push(mk("c-open-house-near-me", "open house near me", "Sample Valley Realty"), mk("c-sell-my-home-near-me", "sell my home near me", "Rocklin, CA"), mk("c-open-house-tours", "open house tours", "Sample Valley Realty"));
      fs.writeFileSync(path.join(nm, "targets.json"), JSON.stringify(tt));
      const rn = node("plan-site.mjs", [nm, ...PLAN_FLAGS]);
      const smn = rn.status === 0 ? J(path.join(nm, "plan", "sitemap.json")) : { pages: [] };
      const A = smn.pages.find((p) => p.cluster === "c-open-house-near-me"), B = smn.pages.find((p) => p.cluster === "c-sell-my-home-near-me");
      check("R: a 'near me' query whose location is the business name has no location: H1 and title carry no business name in the H1", rn.status === 0 && A && A.location === null && A.h1 === "Open House Near Me" && A.title === "Open House Near Me | Sample Valley Realty" && /- Location: none/.test(fs.readFileSync(path.join(nm, A.brief), "utf8")), rn.stdout + JSON.stringify(A));
      check("R: a 'near me' query with a real-looking place still has no location (the query names no place)", B && B.location === null && /- Location: none/.test(fs.readFileSync(path.join(nm, B.brief), "utf8")) && B.h1 === "Sell My Home Near Me", JSON.stringify(B));
      const C = smn.pages.find((p) => p.cluster === "c-open-house-tours");
      check("R: a location that is only the business name is not a place, whatever the query says", C && C.location === null && /- Location: none/.test(fs.readFileSync(path.join(nm, C.brief), "utf8")) && !/Sample Valley Realty/.test(C.h1), JSON.stringify(C));
      const nmPage = (t) => '<!doctype html><html lang="en"><head><title>' + t + ' | Sample Valley Realty</title><meta name="description" content="' + t + ': Sample Valley Realty."></head><body><main><h1>' + t + '</h1><p>' + t + ': this page lists what to expect and how to book a visit with us today.</p></main></body></html>';
      const siteNM = variant([], { add: { "open-house-near-me/index.html": nmPage("Open House Near Me"), "sell-my-home-near-me/index.html": nmPage("Sell My Home Near Me") } });
      const rq = one("GT-004", siteNM, {}, nm);
      check("R: GT-004 does not demand a place in the H1 of a 'near me' page (and checks them: 8 pages)", rq.status === "PASS" && /8 page/.test(rq.summary), text(rq));

      // home title: the brand is never appended to a title that already is the brand
      const hp = fresh("home"); cp(path.join(FIX, "pewp"), hp);
      const ht = J(path.join(hp, "targets.json")); ht.clusters[0].targetPage = "new"; fs.writeFileSync(path.join(hp, "targets.json"), JSON.stringify(ht));
      node("plan-site.mjs", [hp, ...PLAN_FLAGS]);
      const home1 = J(path.join(hp, "plan", "sitemap.json")).pages.find((p) => p.path === "/");
      check("R: a home page with no cluster is titled with the brand once, and its description does not stutter", home1.title === "Sample Valley Realty" && home1.h1 === "Sample Valley Realty" && !/Sample Valley Realty: Sample Valley Realty/.test(home1.metaDescription) && /^Sample Valley Realty helps/.test(home1.metaDescription), JSON.stringify(home1));
      const hp2 = fresh("home"); cp(hp, hp2); jedit(hp2, "business.json", (b) => { b.offer = "home sales"; });
      node("plan-site.mjs", [hp2, ...PLAN_FLAGS]);
      check("R: a short offer makes a descriptive brand title for a cluster-less home (Brand | Offer)", J(path.join(hp2, "plan", "sitemap.json")).pages.find((p) => p.path === "/").title === "Sample Valley Realty | Home Sales");
      const hp3 = fresh("home"); cp(path.join(FIX, "pewp"), hp3); const t3 = J(path.join(hp3, "targets.json")); t3.clusters[1].primaryQuery = "sample valley realty rocklin ca"; t3.clusters[1].queries = [t3.clusters[1].primaryQuery]; fs.writeFileSync(path.join(hp3, "targets.json"), JSON.stringify(t3));
      node("plan-site.mjs", [hp3, ...PLAN_FLAGS]);
      const rk = J(path.join(hp3, "plan", "sitemap.json")).pages.find((p) => p.cluster === "c-agent-rocklin");
      check("R: a query that already contains the brand does not get the brand appended to its title", rk.title === "Sample Valley Realty in Rocklin, CA" && rk.h1 === rk.title, JSON.stringify(rk.title));
      const dup = pewpVariant((d) => jedit(d, "plan/sitemap.json", (m) => { m.pages.find((p) => p.path === "/lincoln-ca/").title = "Real Estate Agent in Lincoln, CA | Real Estate Agent in Lincoln, CA"; }));
      expectFail("a planned title that repeats a segment ('X | X')", "GT-001", CLEAN, /P-011 \/lincoln-ca\/: planned title repeats a segment/, {}, dup);
      const dup2 = pewpVariant((d) => jedit(d, "plan/sitemap.json", (m) => { m.pages.find((p) => p.path === "/").h1 = "Sample Valley Realty: Sample Valley Realty"; }));
      expectFail("a planned H1 that repeats a segment ('X: X')", "GT-001", CLEAN, /P-011 \/: planned H1 repeats a segment/, {}, dup2);

      // the gate report goes where the caller says and leaves state.json alone (a builder may write only site/ and .pewp/builder/)
      const root = fresh("emit"), pw = path.join(root, ".pewp"); cp(pewp, pw); fs.writeFileSync(path.join(pw, "state.json"), JSON.stringify({ mode: "build", stages: {} }));
      const gg = G.gate(pw, CLEAN), st0 = fs.readFileSync(path.join(pw, "state.json"), "utf8"), out = path.join(pw, "builder", "gate");
      G.emit(gg, pw, CLEAN, { out });
      check("R: gate --out writes report.md and report.json there, not to <pewp>/gate, and leaves state.json byte-identical", fs.existsSync(path.join(out, "report.md")) && fs.existsSync(path.join(out, "report.json")) && !fs.existsSync(path.join(pw, "gate")) && fs.readFileSync(path.join(pw, "state.json"), "utf8") === st0);
      G.emit(gg, pw, CLEAN, { noState: true });
      check("R: gate --no-state writes the default report folder but leaves state.json alone", fs.existsSync(path.join(pw, "gate", "report.md")) && fs.readFileSync(path.join(pw, "state.json"), "utf8") === st0);
      G.emit(gg, pw, CLEAN, {});
      check("R: the default gate run records the gate stage in state.json", J(path.join(pw, "state.json")).stages.gate?.status === "PASS" || J(path.join(pw, "state.json")).stages.gate?.doneAt !== undefined, fs.readFileSync(path.join(pw, "state.json"), "utf8"));
    }

    // ======================= S: snapshot input, CLI, fixtures =======================
    const snapOf = (srcDir, omit = []) => {
      const d = fresh("snap"); const pages = [];
      for (const rel of walkFiles(srcDir)) {
        const p = rel === "index.html" ? "/" : "/" + rel.replace(/index\.html$/, "");
        if (omit.includes(p)) continue;
        const slug = (p === "/" ? "home" : p.replace(/\W+/g, "-").replace(/^-|-$/g, ""));
        const base = path.join(d, "pages", slug); fs.mkdirSync(base, { recursive: true });
        fs.writeFileSync(path.join(base, "response.json"), JSON.stringify({ url: `https://sample-valley-realty.test${p}`, finalUrl: `https://sample-valley-realty.test${p}`, status: 200 }));
        fs.writeFileSync(path.join(base, "raw.html.gz"), zlib.gzipSync(fs.readFileSync(path.join(srcDir, rel))));
        pages.push(p);
      }
      fs.writeFileSync(path.join(d, "_site.json"), JSON.stringify({ url: "https://sample-valley-realty.test/", finishedAt: "2026-10-22T00:00:00Z", pages }));
      return d;
    };
    const snap = snapOf(CLEAN);
    expectPass("snapshot input: pages are read from raw.html.gz", "GT-004", snap);
    expectPass("snapshot input: planned links and schema read the same way", "GT-006", snap);
    expectErr("snapshot input: orphans cannot be judged from a sample", "GT-007", snap, /snapshot sample/);
    expectErr("snapshot input: a planned page missing from the sample is cannot-judge, never a failure", "GT-002", snapOf(CLEAN, ["/home-value/"]), /not in the snapshot sample/);
    const gs = G.gate(pewp, snap);
    check("G: whole gate on a snapshot sample never FAILs a clean site (exit status ERROR at worst)", gs.results.every((r) => r.status !== "FAIL"), gs.results.map((r) => `${r.id} ${r.status}`).join(" "));
    check("G: whole-gate status is FAIL when any check fails, ERROR when only cannot-judge remain, PASS when all pass", bad.status === "FAIL" && gs.status === "ERROR" && clean.status === "PASS", `${bad.status} ${gs.status} ${clean.status}`);
    if (full) {
      const cli = (script, a) => node(script, a);
      let r = cli("gate-orphans.mjs", [pewp, CLEAN]);
      check("S: gate-orphans.mjs CLI on the clean site: exit 0, first line PASS GT-007", r.status === 0 && /^PASS GT-007 /.test(r.stdout), r.stdout + r.stderr);
      r = cli("gate-orphans.mjs", [pewp, SITE]);
      check("S: gate-orphans.mjs CLI on the faulty site: exit 1, first line FAIL GT-007", r.status === 1 && /^FAIL GT-007 /.test(r.stdout) && /lincoln-ca/.test(r.stdout), r.stdout + r.stderr);
      r = cli("gate-orphans.mjs", [pewp, variant([], { remove: ["index.html"] })]);
      check("S: gate-orphans.mjs CLI without a home page: exit 2, first line ERROR GT-007", r.status === 2 && /^ERROR GT-007 cannot judge/.test(r.stdout), r.stdout + r.stderr);
      r = cli("gate-clusters.mjs", [pewp, SITE]);
      check("S: gate-clusters.mjs CLI on the faulty site: exit 1", r.status === 1 && /^FAIL GT-002 /.test(r.stdout), r.stdout);
      r = cli("gate-industry.mjs", [pewp, CLEAN, "--strict"]);
      check("S: gate-industry.mjs CLI --strict on the clean site: exit 1 (disclosure pages)", r.status === 1 && /RE-DISC-001/.test(r.stdout), r.stdout);
      r = cli("gate-industry.mjs", [pewp, SITE, "--waive", "RE-LIC-001"]);
      check("S: gate-industry.mjs CLI --waive RE-LIC-001 clears the planted licence fault: exit 0", r.status === 0 && /^PASS GT-010/.test(r.stdout), r.stdout);
      // ---- Windows robustness (script pass 2026-10-23) ----
      r = cli("gate-industry.mjs", [pewp, SITE, "--waive"]);
      check("S: a gate check CLI given --waive with no ids: usage, exit 2 (was: a TypeError crash, exit 1)", r.status === 2 && /--waive needs a list/.test(r.stderr), r.stdout + r.stderr);
      const BOM = String.fromCharCode(0xfeff), pwb = fresh("bom"); cp(pewp, pwb);
      for (const f of ["targets.json", "business.json"]) fs.writeFileSync(path.join(pwb, f), BOM + fs.readFileSync(path.join(pwb, f), "utf8"));
      const rv = cli("targets-validate.mjs", [pwb]), rp = cli("plan-site.mjs", [pwb, ...PLAN_FLAGS]);
      const LP = await imp("lib-plan.mjs");
      let lpBom; try { lpBom = LP.readJson(path.join(pwb, "business.json"))?.name; } catch (e) { lpBom = `threw ${e.message}`; }
      check("S: targets.json / business.json saved with a BOM (PowerShell 5.1, Notepad) validate, plan and load like the plain files", rv.status === 0 && /^PASS targets-valid/.test(rv.stdout) && rp.status === 0 && /^PASS plan /.test(rp.stdout) && typeof lpBom === "string" && !/^threw/.test(lpBom), JSON.stringify({ validate: rv.stdout + rv.stderr, plan: (rp.stdout + rp.stderr).slice(0, 300), lpBom }));
      const jl = path.join(tmp, "scripts-junction"); let jok = true; try { fs.symlinkSync(scriptsDir, jl, "junction"); } catch { jok = false; }
      const viaJ = (s) => spawnSync(process.execPath, [path.join(jl, s)], { encoding: "utf8", timeout: 60000 });
      const jr = jok ? ["gate.mjs", "targets-validate.mjs", "gate-orphans.mjs"].map((s) => [s, viaJ(s)]) : [];
      check("S: gate.mjs, targets-validate.mjs and a gate-*.mjs started through a junction still run their CLI (was: exit 0, no output, a silent pass)", jok && jr.every(([, x]) => x.status === 2 && /usage: node/.test(x.stderr)), jok ? JSON.stringify(jr.map(([s, x]) => [s, x.status, (x.stdout + x.stderr).slice(0, 80)])) : "could not create a junction");
      try { if (jok) fs.rmdirSync(jl); } catch {} // removes the junction only, never the scripts it points at
      const pw1 = fresh("gp"); cp(pewp, pw1);
      r = cli("gate.mjs", [pw1, SITE]);
      const rep = path.join(pw1, "gate", "report.md"), repj = path.join(pw1, "gate", "report.json");
      check("S: gate.mjs on the faulty site: exit 1, 13 check lines, report.md and report.json written", r.status === 1 && (r.stdout.match(/^(PASS|FAIL|ERROR) GT-0\d\d /gm) || []).length === 13 && /^FAIL gate 13 checks: 6 PASS, 7 FAIL, 0 ERROR/m.test(r.stdout) && fs.existsSync(rep) && fs.existsSync(repj), r.stdout);
      const md = fs.existsSync(rep) ? fs.readFileSync(rep, "utf8") : "";
      check("S: report.md leads with the one-line answer, names what to fix, explains terms once", /^# Site gate: the built site does not match the plan \(7 checks failed\)/.test(md) && /### GT-007 no-orphans/.test(md) && /lincoln-ca/.test(md) && (md.match(/- cannibalisation: /g) || []).length === 1 && (md.match(/- orphan page: /g) || []).length === 1, md.slice(0, 600));
      const js = fs.existsSync(repj) ? J(repj) : null;
      check("S: report.json has every check with status and details", js && js.status === "FAIL" && js.checks.length === 13 && js.checks.every((c) => c.id && c.status && Array.isArray(c.details)));
      const pw2 = fresh("gp"); cp(pewp, pw2);
      r = cli("gate.mjs", [pw2, CLEAN]);
      check("S: gate.mjs on the clean site: exit 0, report says the site matches the plan", r.status === 0 && /^PASS gate 13 checks: 13 PASS/m.test(r.stdout) && /^# Site gate: the built site matches the plan/.test(fs.readFileSync(path.join(pw2, "gate", "report.md"), "utf8")), r.stdout);
      r = cli("gate.mjs", [pw2, CLEAN, "--strict", "--no-report"]);
      check("S: gate.mjs --strict on the clean site: exit 1", r.status === 1 && /FAIL GT-010/.test(r.stdout), r.stdout);
      const pwo = fresh("gp"); cp(pewp, pwo); const outd = path.join(pwo, "builder", "gate");
      r = cli("gate.mjs", [pwo, CLEAN, "--out", outd]);
      check("S: gate.mjs --out DIR writes the report there and nothing under <pewp>/gate", r.status === 0 && fs.existsSync(path.join(outd, "report.md")) && !fs.existsSync(path.join(pwo, "gate")), r.stdout);
      const pw3 = fresh("gp"); cp(pewp, pw3);
      r = cli("gate.mjs", [pw3, snap]);
      check("S: gate.mjs on a snapshot sample: exit 2 (cannot judge orphans), no FAIL line", r.status === 2 && !/^FAIL GT/m.test(r.stdout), r.stdout);
      // the committed fixtures are what the builder + planner write today
      const regen = fresh("regen");
      const fb = spawnSync(process.execPath, [path.join(FIX, "build-fixtures.mjs"), "--out", regen], { encoding: "utf8", timeout: 600_000 });
      // freshness-sites.mjs is a generator (test-freshness), not output; bing-junk/ and competitors/ are copies of real responses and reports
      // (evidence fixtures of the 2026-10-25 overhaul: test-research, test-approve), hand-made, never generated here
      const HAND_MADE = /^(bing-junk|competitors|serp-html)[\\/]/; // serp-html: reduced real result pages (test-capture, G23)
      const files = walkFiles(FIX).filter((f) => f !== "build-fixtures.mjs" && f !== "freshness-sites.mjs" && !HAND_MADE.test(f));
      const stale = files.filter((f) => !fs.existsSync(path.join(regen, f)) || fs.readFileSync(path.join(regen, f), "utf8") !== fs.readFileSync(path.join(FIX, f), "utf8"));
      check("S: committed fixtures equal what build-fixtures.mjs writes now (none stale)", fb.status === 0 && stale.length === 0 && walkFiles(regen).length === files.length, `${fb.stderr} stale: ${stale.join(", ")}`);
    }
  } catch (e) {
    check("suite crashed", false, e.stack || e);
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  return R;
}

// ---------- run ----------
// child mode: one mutant's suite in its own process, so mutants run in parallel
if (args.includes("--suite-json")) {
  const rs = await suite(path.resolve(opt("--suite-json")), { full: false });
  process.stdout.write(JSON.stringify(rs.map((r) => ({ name: r.name, ok: r.ok }))));
  process.exit(0);
}
const t0 = Date.now();
const main = await suite(SCRIPTS, { full: true });
const group = (r) => (r.name.match(/^([A-Z]):/) || [, "?"])[1];
const names = { V: "validator", P: "plan-site", G: "gate", R: "end-to-end regressions", S: "snapshot / CLI / fixtures" };
const out = [];
for (const g of Object.keys(names)) { const rs = main.filter((r) => group(r) === g); out.push(`${g} ${names[g]}: ${rs.filter((r) => r.ok).length}/${rs.length}`); }
for (const r of main) if (VERBOSE || !r.ok) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${r.ok ? "" : "\n     " + r.detail.replace(/\n/g, "\n     ")}`);
console.log(out.join("\n"));
let failed = main.filter((r) => !r.ok).length;
console.log(`${failed ? "FAIL" : "PASS"} test-plan-gate ${main.filter((r) => r.ok).length}/${main.length} checks (${Math.round((Date.now() - t0) / 1000)} s)`);

// ---------- M: watched-fail mutants of the scripts themselves ----------
if (!args.includes("--no-mutants") && !opt("--scripts")) {
  const MUTANTS = [
    ["lib-text.mjs", "export const THRESHOLD = 0.8;", "export const THRESHOLD = 0.0;", /G: GT-005 FAIL an outline heading renamed away/, "token-overlap threshold (GT-005 headings) lowered to 0%"],
    ["gate-query-match.mjs", "if (!carriesQuery(text, c, { locale }))", "if (false)", /G: GT-004 FAIL a title that does not carry/, "TGT-004: the query is no longer required in title, H1, description or first paragraph"],
    ["gate-query-match.mjs", '["meta description", pg.metaDescription || ""], ', "", /G: GT-004 FAIL a meta description that does not carry/, "TGT-004: the meta description is not checked"],
    ["lib-growth.mjs", "return [cluster.primaryQuery, ...(cluster.queries || [])].some((q) => containsPhrase(text, q));", "return false;", /G: GT-004 PASS a first paragraph that carries another query/, "TGT-004: only the head term counts, not the cluster's other queries"],
    ["gate-cannibalisation.mjs", "if (rivals.length) bad.push(", "if (false) bad.push(", /G: GT-003 FAIL a second page/, "TGT-003: a rival page is no longer flagged"],
    ["gate-cannibalisation.mjs", "if (isSubTopicOf(c, head, myPlaces, clusterOfPlanned.get(pg.path), locale)) continue;", "", /G: GT-003 PASS a planned (page of a narrower|general page|place-named page|general and)/, "GT-003-SUBTOPIC: a planned page of a narrower or local sibling cluster is accused of cannibalising again"],
    ["gate-cannibalisation.mjs", "return dHead.words.length > head.words.length || !samePlaces;", "return !samePlaces;", /G: GT-003 PASS a planned page of a narrower cluster/, "GT-003-SUBTOPIC: an extra word in the sibling's head term no longer makes it a sub-topic"],
    ["gate-cannibalisation.mjs", "return dHead.words.length > head.words.length || !samePlaces;", "return dHead.words.length > head.words.length;", /G: GT-003 PASS a planned (general page|place-named page|general and)/, "GT-003-SUBTOPIC: a different set of place names (general against local, either direction) no longer makes it a sub-topic"],
    ["gate-cannibalisation.mjs", "return dHead.words.length > head.words.length || !samePlaces;", "return true;", /G: GT-003 FAIL a planned page of a cluster with the same head term/, "GT-003-SUBTOPIC: a true duplicate (same head term, same places) is exempted"],
    ["gate-cannibalisation.mjs", "if (!d || d.id === c.id) return false;", "if (d && d.id === c.id) return false; if (!d) return true;", /G: GT-003 FAIL the same narrower page when no cluster/, "GT-003-SUBTOPIC: an unplanned page is exempted"],
    ["gate-cannibalisation.mjs", "if (pg.path === mine || exempt.has(pg.path)) continue;", "if (pg.path === mine) continue;", /G: GT-003 PASS a page the cluster lists in alsoServes/, "TGT-003: alsoServes no longer exempts a page"],
    ["gate-cannibalisation.mjs", 'if (!isCompatible(c.intent, ctx.pageTypeOf(pg), { cta: hasCta(pg.path) }) && !(pg.path === "/" && isCompatible(c.intent, "home"))) continue;', "", /G: GT-003 PASS a page of a type that does not fit/, "9.7: the page type is ignored when matching a rival"],
    ["gate-cannibalisation.mjs", "if (namesOtherPlace(c.primaryQuery, `${pg.title} ${pg.h1[0] || \"\"}`, { locale })) continue; // a page for another place", "", /G: GT-003 PASS an UNPLANNED page for another place/, "skill choice: the page-for-another-place exemption is gone, so sibling city pages accuse each other"],
    ["gate-coverage.mjs", "if (ctx.strict) return fail(", "if (false) return fail(", /G: GT-011 FAIL the same gap under --strict/, "TGT-011: --strict no longer turns the warning into a failure"],
    ["gate-coverage.mjs", "const top = ranked.slice(0, n)", "const top = ranked", /G: GT-011 only the top/, "TGT-011: every cluster counts, not the top priorityPages"],
    ["gate-coverage.mjs", "(b.priority ?? 0) - (a.priority ?? 0) ||", "", /G: GT-011 the top clusters are chosen by priority/, "TGT-011: clusters taken in file order, not by priority"],
    ["gate-intent-fit.mjs", "const ok = isCompatible(c.intent, type, { cta }) ||", "const ok = true ||", /G: GT-012 FAIL an informational cluster whose page is a Product page/, "TGT-012: any page type fits any intent"],
    ["gate-intent-fit.mjs", "cta = !!brief?.fields?.cta;", "cta = true;", /G: GT-012 FAIL a transactional cluster whose brief has no CTA/, "TGT-012: a brief without a CTA is treated as having one"],
    ["gate-brief.mjs", "if (cov < minCov) {", "if (false) {", /G: GT-005 fewer than 60% of a brief's required terms/, "TGT-005: required-term coverage not checked"],
    ["gate.mjs", "industry, coverage, intentFit, freshness];", "industry];", /G: clean 6-page site passes all thirteen checks/, "GT-011, GT-012 and GT-013 not wired into the gate"],
    ["gate-orphans.mjs", "if (!inbound.get(pg.path).size)", "if (false)", /G: GT-007 FAIL a page nobody links to/, "orphans no longer detected"],
    ["gate-orphans.mjs", "else if (!seen.has(pg.path))", "else if (false)", /G: GT-007 FAIL two pages that only link to each other/, "unreachable islands no longer detected"],
    ["lib-text.mjs", '"click here", "click", "here", "read more", ', "", /G: GT-006 FAIL a generic footer anchor/, "generic anchors allowed"],
    ["gate-links.mjs", "&& overlap(to.primaryQuery, a.text) === 0)", "&& false)", /G: GT-006 FAIL a body anchor sharing no word/, "anchor/query token rule removed"],
    ["gate-schema.mjs", "if (!node) {", "if (false) {", /G: GT-008 FAIL the planned type missing/, "planned schema type no longer required"],
    ["gate-schema.mjs", "if (have === want) return true;", "return false;", /G: GT-008 PASS a subtype satisfies|G: GT-008 subtype table/, "subtypes no longer satisfy a parent type"],
    ["gate-programmatic.mjs", "r.similarity > g.maxSimilarity", "r.similarity > 2", /G: GT-009 FAIL a town page that is the neighbour/, "similarity limit disabled"],
    ["gate-programmatic.mjs", "f.value && f.source && f.date &&", "f.value &&", /G: GT-009 FAIL local facts that carry no source/, "facts without a source counted"],
    ["gate-industry.mjs", "if (!re.test(pg.text))", "if (false)", /G: GT-010 FAIL a page without the licence number/, "licence number no longer required"],
    ["gate-industry.mjs", "report(item, \"FAIL\", `${pg.path} contains", "void (`${pg.path} contains", /G: GT-010 FAIL fair-housing wording/, "forbidden phrases no longer reported"],
    ["gate-industry.mjs", "if (!ok) report(item, \"FAIL\", `${pg.path} is missing:", "if (false) report(item, \"FAIL\", `${pg.path} is missing:", /G: GT-010 FAIL mortgage protection page without the 'not PMI' statement/, "required-when-present statements no longer enforced"],
    ["gate-industry.mjs", "if (item.nearChars && hits.length) {", "if (false) {", /G: GT-010 the FDIC wording only in the footer, far from the annuity rate claim/, "a disclosure far from the claim counts as next to it"],
    ["gate-industry.mjs", "if (item.pageHasForm && !(pg.forms > 0)) continue;", "", /G: GT-010 PASS the same text on a page that has no form/, "form-only items apply to every page"],
    ["gate-industry.mjs", "if (inScope && !inScope.test(pg.path)) continue;", "", /G: GT-010 PASS clean wording that only sounds close|G: GT-010 PASS a clean/, "path-scoped items apply to every page"],
    ["gate-industry.mjs", "if (found.length) report(item,", "if (false) report(item,", /G: GT-010 FAIL Product and Offer markup on an insurance page/, "forbidden JSON-LD types no longer reported"],
    ["lib-site.mjs", "if (tag === \"form\") page.forms++;", "", /G: GT-010 FAIL a page with a form and no consent language/, "forms on a page are not counted"],
    ["plan-site.mjs", "const packed = industry?.pageTypes?.find((t) => t.plannerKind === kind)?.schema;", "const packed = null;", /P: insurance-agency plan: home InsuranceAgency\+WebSite/, "the industry pack's page types are ignored by the planner"],
    ["research-seeds.mjs", "if (!/^[a-z0-9-]+$/.test(String(slug)))", "if (false)", /G: research-seeds --industry refuses a path-like slug/, "a path-like --industry slug is read as a file name"],
    ["gate-schema.mjs", "InsuranceAgency: [\"FinancialService\"], ", "", /G: schema table: InsuranceAgency is a FinancialService/, "InsuranceAgency no longer known as a FinancialService"],
    ["targets-validate.mjs", "if (queries.has(key))", "if (false)", /V: rejects two clusters on one primary query/, "validator accepts two clusters on one primary query"],
    ["targets-validate.mjs", "if (!isObj(n)) {", "if (false) {", /V: rejects bare number/, "validator accepts a bare number"],
    ["targets-validate.mjs", "for (const k of [\"location\", \"language\"]) if (!nonEmpty(row[k]))", "for (const k of [\"language\"]) if (!nonEmpty(row[k]))", /V: ranking row rejected: location missing/, "ranking row without a location accepted"],
    ["gate-clusters.mjs", "(site.complete ? bad : notSeen).push(", "(notSeen).push(", /G: GT-002 FAIL a page removed/, "a missing cluster page becomes cannot-judge instead of FAIL"],
    ["gate-brief.mjs", "if (!seqContains(seq, e))", "if (false)", /G: GT-005 FAIL a required entity removed/, "required entities no longer checked"],
    ["gate-brief.mjs", "if (!showsQuestion(q, blocks))", "if (false)", /G: GT-005 FAIL a brief question removed/, "brief questions no longer checked"],
    ["lib-text.mjs", "return blockSets.some((t) => t.size <= n * 2 + 4 && overlap", "return blockSets.some((t) => overlap", /G: GT-005 FAIL a brief question removed/, "an answer paragraph counts as the question (short-block rule removed)"],
    ["gate-query-match.mjs", "if (lack.length)", "if (false)", /G: GT-004 FAIL the wrong town/, "place name no longer required"],
    ["plan-site.mjs", "pg.title = title;", "pg.title = brand;", /P: every planned title/, "planner writes titles without the query"],
    ["plan-site.mjs", "return cands[hash(from.path) % cands.length].toLowerCase();", "return \"click here\";", /P: every planned link has a descriptive anchor/, "planner writes generic anchors"],
    ["plan-site.mjs", "minUniqueWords: OPTS.progMinUnique,", "minUniqueWords: 1,", /P: programmatic\.json carries the gate numbers/, "programmatic gate number ignored"],
    ["plan-site.mjs", "addLink(pg, byPath.get(pg.parent), \"up\");", "", /P: the two city pages link each other/, "child pages no longer link back to their parent"],
    ["lib-plan.mjs", 'ctx.business.launchState !== "live" && ctx.site.pages.size > 0 &&', "false &&", /R: GT-003 a planned site with noindex/, "noindex by design no longer recognised"],
    ["lib-plan.mjs", 'ctx.business.launchState !== "live" && ctx.site.pages.size > 0 &&', "ctx.site.pages.size > 0 &&", /R: GT-003 a planned site with noindex|a LIVE site that is noindex everywhere/, "a LIVE site's blanket noindex excused"],
    ["gate-clusters.mjs", "if (ctx.strict && !live) bad.push(", "if (false) bad.push(", /G: GT-002 FAIL the launch gate/, "--strict accepts noindex before launch"],
    ["plan-site.mjs", "/\\b(near me|nearby|close to me)\\b/i.test(c.primaryQuery) || ", "", /R: a 'near me' query with a real-looking place/, "near-me queries keep a location"],
    ["plan-site.mjs", "normName(c.location) === normName(business.name) ? null", "false ? null", /R: a location that is only the business name/, "a location equal to the business name is kept"],
    ["gate-query-match.mjs", "if (tokens(city).every((t) => new Set(tokens(q)).has(t))) {", "if (true) {", /R: GT-004 does not demand a place in the H1 of a 'near me' page/, "GT-004 demands a place the query does not name"],
    ["plan-site.mjs", "let title = hasBrand(headForTitle) ? headForTitle : ", "let title = false ? headForTitle : ", /R: a (home page with no cluster|query that already contains the brand)/, "the brand is appended to a title that already has it"],
    ["plan-site.mjs", "`${brand} | ${titleCase(business.offer)}`.length <= 60) title =", "false) title =", /R: a short offer makes a descriptive brand title/, "no descriptive home title"],
    ["gate-targets.mjs", "if (new Set(seg).size < seg.length)", "if (false)", /G: GT-001 FAIL a planned (title|H1) that repeats a segment/, "repeated title segments not detected"],
    ["gate.mjs", "const dir = out ? path.resolve(out) :", "const dir = false ? 0 :", /R: gate --out writes report/, "--out ignored"],
    ["gate.mjs", "if (!out && !noState && fs.existsSync", "if (!noState && fs.existsSync", /R: gate --out writes report/, "--out still writes state.json"],
    ["gate.mjs", "if (!out && !noState && fs.existsSync", "if (!out && fs.existsSync", /R: gate --no-state/, "--no-state ignored"],
    ["gate.mjs", 'const status = results.some((r) => r.status === "FAIL") ? "FAIL"', 'const status = results.some((r) => r.status === "NEVER") ? "FAIL"', /G: whole-gate status/, "gate runner reports PASS when a check failed"],
  ];
  const results = new Array(MUTANTS.length), jobs = [];
  for (const [i, [file, from, to, expectRe, why]] of MUTANTS.entries()) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-mut-"));
    fs.cpSync(SCRIPTS, path.join(root, "scripts"), { recursive: true });
    fs.cpSync(path.join(SCRIPTS, "..", "rules"), path.join(root, "rules"), { recursive: true });
    const f = path.join(root, "scripts", file), src = fs.readFileSync(f, "utf8");
    if (!src.includes(from)) { results[i] = { i, file, why, status: "PATCH-NEVER-APPLIED", detail: from }; continue; }
    fs.writeFileSync(f, src.replace(from, to));
    jobs.push({ i, file, why, expectRe, root });
  }
  const runJob = (j) => new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(j.root, "scripts", "test-plan-gate.mjs"), "--suite-json", path.join(j.root, "scripts"), "--fixtures", FIX], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.on("data", (d) => (out += d));
    const t = setTimeout(() => c.kill(), 15 * 60_000); // a mutant that hangs is killed and reported (no JSON -> "did not finish"), never waited on forever
    c.on("close", () => {
      clearTimeout(t);
      let rs; try { rs = JSON.parse(out); } catch { rs = [{ name: "mutant suite did not finish", ok: false }]; }
      const red = rs.filter((r) => !r.ok), right = red.filter((r) => j.expectRe.test(r.name));
      results[j.i] = { i: j.i, file: j.file, why: j.why, status: right.length ? "RED (right reason)" : red.length ? "RED (other reason only)" : "GREEN (survived)", red: red.length, detail: (right[0] || red[0] || {}).name };
      try { fs.rmSync(j.root, { recursive: true, force: true }); } catch {}
      resolve();
    });
  });
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(6, os.cpus().length) }, async () => { while (queue.length) await runJob(queue.shift()); }));
  for (const r of results) console.log(`M mutant ${String(r.i + 1).padStart(2)} ${r.file}: ${r.why} -> ${r.status}${r.red ? ` (${r.red} failing; e.g. ${r.detail})` : r.detail ? ` ${r.detail}` : ""}`);
  const ok = results.filter((r) => r.status === "RED (right reason)").length;
  console.log(`${ok === results.length ? "PASS" : "FAIL"} mutants ${ok}/${results.length} went red for the right reason`);
  if (ok !== results.length) failed++;
}
process.exit(failed ? 1 : 0);
