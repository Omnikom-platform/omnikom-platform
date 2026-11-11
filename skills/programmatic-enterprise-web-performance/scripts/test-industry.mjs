// Usage: node test-industry.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of what an industry pack carries for the research steps (lib-industry.mjs; work order 41 gap list items 3 and 4):
//  - which pack a business resolves to (business.json industry, else kind, either by slug or by a pack's aliases);
//  - the topic filter on Bing's related keywords (research-bing.mjs): a pack may declare "topicFilter": "vocabulary", business.json overrides it either way, the default is off,
//    and bing.json says where the setting came from (business.json, pack, or the default): a lender gets the filter from its pack, a historic-homes business does not;
//  - licence detection on a competitor's pages (research-competitors.mjs): the kinds come from the pack (a lender: NMLS id, California Finance Lenders, DFPI; real estate: a DRE number);
//    with no pack the default looks for all of them, and the output says which kinds were looked for and where that came from.
// Fixtures only: packs in a temp folder (PEWP_INDUSTRIES_DIR), pure calls, research-bing.mjs and research-competitors.mjs against local fake servers; no network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { serve, runner, J, W, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const KEY = "INDKEY-SECRET-abc";   // gitleaks:allow (a made-up test key)
const BAD = ["summit racing equipment", "northern tool and equipment", "advance america"];
const GOOD = ["hard money lender", "bridge loan rates", "fix and flip financing"];
const VOC = ["hard money loans", "bridge loans", "fix and flip financing", "real estate investor financing"];
const SEEDS = ["--seed", "hard money loans", "--seed", "equipment financing", "--seed", "cash advance business"];
const NMLS_ONLY = [{ id: "NMLS", label: "NMLS id", pattern: "\\bNMLS\\s*(?:ID|#)?\\s*:?\\s*\\d{4,8}\\b", flags: "gi" }];
const LENDER_PACK = { slug: "lender-test", aliases: ["business-funding-broker"], topicFilter: "vocabulary", licenceDetect: NMLS_ONLY };
const HOMES_PACK = { slug: "homes-test", aliases: ["historic-homes-agent"] };
const base = { market: { country: "US", language: "en" }, offer: "x", vocabulary: VOC };
const LENDER = { ...base, name: "Lender Test", domain: "ind-test.test", kind: "business-funding-broker" };
const HOMES = { ...base, name: "Homes Test", domain: "ind-test.test", kind: "homes-test" };
const FOOT_LENDER = "<html><head><title>Funding</title></head><body><main>We match businesses with lenders.</main><footer>Paragon Funding. NMLS ID 1234567. Licensed by the California Department of Financial Protection and Innovation under the California Financing Law, License No. 60DBO-12345. Broker DRE #02236450.</footer></body></html>";

async function scenarios(dir) {
  const results = [], check = checker(results);
  const tmp = mkTmp("industry"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log"), packs = path.join(tmp, "packs");
  fs.mkdirSync(home);
  W(path.join(packs, "lender-test.json"), LENDER_PACK);
  W(path.join(packs, "homes-test.json"), HOMES_PACK);
  W(path.join(packs, "broken.json"), "{ not json");
  const run = runner(dir, home, netLog, ["BING_WEBMASTER_KEY", "BING_API_BASE", "PEWP_INDUSTRIES_DIR"]);
  const li = await import(pathToFileURL(path.join(dir, "lib-industry.mjs")).href + "?" + Math.random());
  const comp = await import(pathToFileURL(path.join(dir, "research-competitors.mjs")).href + "?" + Math.random());
  try {
    // ---- which pack a business resolves to ----
    const rp = (b) => li.resolvePack(b, { dir: packs });
    check("pack: a business resolves to its pack by industry, by kind, and by a pack's alias (via says which)", rp({ industry: "lender-test" })?.via === "industry" && rp({ kind: "homes-test" })?.via === "kind" && rp({ kind: "business-funding-broker" })?.slug === "lender-test" && /alias/.test(rp({ kind: "business-funding-broker" })?.via || ""), JSON.stringify([rp({ industry: "lender-test" })?.via, rp({ kind: "business-funding-broker" })?.via]));
    check("pack: industry wins over kind; an unknown kind, no kind, and an unreadable pack file give no pack, never an error", rp({ industry: "homes-test", kind: "business-funding-broker" })?.slug === "homes-test" && rp({ kind: "plumber" }) === null && rp({}) === null && rp(null) === null);
    // ---- the topic filter setting ----
    const ts = (b) => li.topicSetting(b, { dir: packs });
    check("pack topic: a lender with no setting of its own gets the filter from its pack, and says so", ts(LENDER).value === "vocabulary" && /industry pack lender-test/.test(ts(LENDER).from), JSON.stringify(ts(LENDER)));
    check("pack topic: a business whose pack sets nothing (historic homes) stays off, and says it is the default", ts(HOMES).value === "off" && /default/.test(ts(HOMES).from) && ts({ kind: "plumber" }).value === "off", JSON.stringify(ts(HOMES)));
    check("pack topic: business.json overrides the pack either way (a lender can turn it off; a homes business can turn it on)", ts({ ...LENDER, topicFilter: "off" }).value === "off" && ts({ ...LENDER, topicFilter: "off" }).from === "business.json" && ts({ ...HOMES, topicFilter: "vocabulary" }).value === "vocabulary" && ts({ ...HOMES, topicFilter: "vocabulary" }).from === "business.json");
    check("pack topic: a setting that is neither 'vocabulary' nor 'off' is ignored (the pack or the default applies)", ts({ ...LENDER, topicFilter: "yes" }).from.startsWith("industry pack") && ts({ ...HOMES, topicFilter: 1 }).value === "off");
    // ---- licence detection: the pure functions ----
    const names = (t, d) => li.detectLicences(t, d).map((x) => x.id);
    const lend = names("NMLS ID 1234567. California Finance Lenders Law licence 60DBO-12345. DFPI. DRE #02236450.", li.LICENCE_DEFAULT);
    check("licence: the default looks for a real-estate licence AND the lender kinds: NMLS id, California Finance Lenders, DFPI", ["DRE", "NMLS", "CFL", "DFPI"].every((k) => lend.includes(k)), lend.join());
    check("licence: a licence the page does not state is not reported (nothing invented): a page with no licence text gives none", li.detectLicences("We buy houses fast. Licensed and insured.", li.LICENCE_DEFAULT).length === 0 && li.detectLicences("", li.LICENCE_DEFAULT).length === 0 && li.detectLicences(null, li.LICENCE_DEFAULT).length === 0);
    check("licence: the NMLS id is read with its number ('NMLS #1234567' and 'NMLS ID: 998877'), the matched text is kept", names("NMLS #1234567 and NMLS ID: 998877", NMLS_ONLY).length === 2 && li.detectLicences("NMLS ID: 998877", NMLS_ONLY)[0].text === "NMLS ID: 998877", JSON.stringify(li.detectLicences("NMLS ID: 998877", NMLS_ONLY)));
    check("licence: at most 3 matches per kind (a footer repeated in the text does not flood the file)", li.detectLicences("NMLS 11111 NMLS 22222 NMLS 33333 NMLS 44444 NMLS 55555", NMLS_ONLY).length === 3);
    check("licence: a pattern that is not a regular expression is skipped, the others still run (never a throw)", names("NMLS 123456", [{ id: "BAD", pattern: "(" }, ...NMLS_ONLY]).join() === "NMLS");
    const lf = (b) => li.licenceDetectFor(b, { dir: packs });
    check("licence: a pack's licenceDetect replaces the default (the lender pack looks for NMLS only) and says which pack", lf(LENDER).detect.length === 1 && lf(LENDER).detect[0].id === "NMLS" && /industry pack lender-test/.test(lf(LENDER).from), JSON.stringify(lf(LENDER)));
    check("licence: a business with no pack, or a pack that says nothing about licences, gets the default and the 'from' says so", lf(HOMES).detect === li.LICENCE_DEFAULT && /default/.test(lf(HOMES).from) && lf({}).detect === li.LICENCE_DEFAULT);
    // ---- licence detection on a page (research-competitors.mjs page()) ----
    const pg = comp.page(FOOT_LENDER, "https://paragon.test/");
    check("licence: page() with the default kinds reads NMLS, California Finance Lenders, DFPI and the DRE number from a lender's footer", ["NMLS", "CFL", "DFPI", "DRE"].every((k) => (pg.licences || []).some((l) => l.id === k)), JSON.stringify(pg.licences));
    const pgPack = comp.page(FOOT_LENDER, "https://paragon.test/", NMLS_ONLY);
    check("licence: page() with the lender pack's kinds reads only the NMLS id (the pack decides what is looked for)", pgPack.licences?.length === 1 && pgPack.licences[0].id === "NMLS" && /1234567/.test(pgPack.licences[0].text), JSON.stringify(pgPack.licences));
    check("licence: page() still reports the old real-estate 'licence' field (the DRE number) for readers of competitors.json", Array.isArray(pg.licence) && pg.licence.some((x) => /02236450/.test(x)), JSON.stringify(pg.licence));

    let sumErr = null, sum = null; // an audit imported from an older file (research-existing.mjs) has no licences field
    try { sum = comp.summarise({ page: { words: 900 }, sitemap: { pages: 1, byKind: {} }, schema: { questions: 0, types: [] }, crawlers: null }, (value) => ({ value })); } catch (e) { sumErr = e.message; }
    check("licence: summarise() reads an older audit with no licences field (research-existing.mjs imports them) and reports none, no throw", !sumErr && Array.isArray(sum?.licences?.value) && sum.licences.value.length === 0, sumErr || JSON.stringify(sum?.licences));

    // ---- through research-bing.mjs: the topic setting and where it came from ----
    const bing = await serve((rq) => {
      const u = new URL(rq.url, "http://x"), m = u.pathname.split("/").pop(), q = u.searchParams.get("q");
      if (u.searchParams.get("apikey") !== KEY) return { status: 401, body: {} };
      if (m === "GetKeyword") return { body: { d: [{ Query: q, Impressions: 500, BroadImpressions: 900, Date: "/Date(1760000000000)/" }] } };
      if (m === "GetRelatedKeywords") return { body: { d: [...BAD, ...GOOD].map((x) => ({ Query: x, Impressions: 80, BroadImpressions: 120, Date: "/Date(1760000000000)/" })) } };
      return { status: 404, body: {} };
    });
    const env = { BING_API_BASE: `${bing.url}/webmaster/api.svc/json`, BING_WEBMASTER_KEY: KEY, PEWP_TEST_GAP_MS: "0", PEWP_INDUSTRIES_DIR: packs };
    const world = (n, business) => {
      const cwd = path.join(tmp, n), pewp = path.join(cwd, "site-checks", "ind-test.test", ".pewp");
      W(path.join(pewp, "business.json"), business);
      return { cwd, pewp, bing: () => { const f = path.join(pewp, "research", "bing.json"); return fs.existsSync(f) ? J(f) : { keywords: [], droppedOffTopic: [], topicFilter: null, missing: true }; }, comp: () => { const f = path.join(pewp, "research", "competitors.json"); return fs.existsSync(f) ? J(f) : { sites: [], licenceDetect: null, missing: true }; } };
    };
    const bingRun = async (n, business) => { const w = world(n, business); const x = await run("research-bing.mjs", ["https://ind-test.test/", ...SEEDS, "--cwd", w.cwd], { env }); return { x, b: w.bing() }; };
    let r = await bingRun("b-lender", LENDER);
    check("pack topic: a lender with no setting in business.json gets the filter from its pack: the three WO 40 B keywords are dropped and listed, and bing.json says the setting came from the pack", r.x.code === 0 && r.b.topicFilter?.applied === true && /industry pack lender-test/.test(r.b.topicFilter.settingFrom || "") && BAD.every((q) => !r.b.keywords.some((k) => k.query === q) && r.b.droppedOffTopic.some((d) => d.query === q && /^topic: /.test(d.reason))), JSON.stringify(r.b.topicFilter));
    r = await bingRun("b-homes", HOMES);
    check("pack topic: the historic-homes style business (pack sets nothing) does NOT get the filter: the same keywords stay, bing.json says applied false from the default", r.x.code === 0 && r.b.topicFilter?.applied === false && /default/.test(r.b.topicFilter.settingFrom || "") && BAD.every((q) => r.b.keywords.some((k) => k.query === q)), JSON.stringify(r.b.topicFilter));
    r = await bingRun("b-lender-off", { ...LENDER, topicFilter: "off" });
    check("pack topic: business.json 'off' overrides the lender pack: nothing dropped, bing.json says the setting came from business.json", r.x.code === 0 && r.b.topicFilter?.applied === false && r.b.topicFilter.settingFrom === "business.json" && BAD.every((q) => r.b.keywords.some((k) => k.query === q)), JSON.stringify(r.b.topicFilter));
    r = await bingRun("b-homes-on", { ...HOMES, topicFilter: "vocabulary" });
    check("pack topic: business.json 'vocabulary' overrides a pack that sets nothing: the filter applies, from business.json", r.x.code === 0 && r.b.topicFilter?.applied === true && r.b.topicFilter.settingFrom === "business.json" && BAD.every((q) => !r.b.keywords.some((k) => k.query === q)), JSON.stringify(r.b.topicFilter));
    bing.close();

    // ---- through research-competitors.mjs: which licence kinds were looked for, and what was read ----
    const site = await serve((rq) => (rq.url === "/" ? { headers: { "content-type": "text/html" }, body: FOOT_LENDER } : { status: 404, body: "no" }));
    const cenv = { PEWP_TEST_GAP_MS: "0", PEWP_INDUSTRIES_DIR: packs };
    const compRun = async (n, business) => { const w = world(n, business); const x = await run("research-competitors.mjs", ["https://ind-test.test/", "--domain", site.url, "--cwd", w.cwd], { env: cenv }); return { x, c: w.comp() }; };
    const lic = (c) => (c.sites?.[0]?.page?.licences || []).map((l) => l.id).join();
    let c = await compRun("c-lender", LENDER);
    check("licence: research-competitors.mjs for a lender looks for the lender pack's kinds only (NMLS): the competitor's NMLS id is read, DFPI/DRE are not looked for, and competitors.json names the pack and the kinds", c.x.code === 0 && lic(c.c) === "NMLS" && /industry pack lender-test/.test(c.c.licenceDetect?.from || "") && c.c.licenceDetect.kinds.join() === "NMLS" && c.c.sites[0].facts?.licences?.value?.some((v) => /^NMLS: /.test(v)), JSON.stringify([lic(c.c), c.c.licenceDetect, c.x.out.slice(0, 200)]));
    c = await compRun("c-homes", HOMES);
    check("licence: for a business whose pack names no licence kinds the default applies: NMLS, California Finance Lenders, DFPI and DRE are all read, and competitors.json says it is the default", c.x.code === 0 && ["NMLS", "CFL", "DFPI", "DRE"].every((k) => lic(c.c).split(",").includes(k)) && /default/.test(c.c.licenceDetect?.from || "") && c.c.licenceDetect.kinds.includes("DFPI"), JSON.stringify([lic(c.c), c.c.licenceDetect]));
    site.close();
    const net = fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8").trim() : "";
    check("industry: nothing in this suite left the machine (network guard log empty)", !net, net);
  } finally { rmTmp(tmp); }
  return results;
}

const LI = "lib-industry.mjs", RB = "research-bing.mjs", RC = "research-competitors.mjs";
const MUTANTS = [
  { name: "business.json does not override the pack", patches: [{ file: LI, from: "if (own === \"vocabulary\" || own === \"off\") return { value: own, from: \"business.json\" };", to: "" }], expect: [/^pack topic: business.json overrides the pack either way/, /^pack topic: business.json 'off' overrides the lender pack/, /^pack topic: business.json 'vocabulary' overrides/] },
  { name: "the pack's topicFilter is ignored", patches: [{ file: LI, from: "if (r && (r.pack.topicFilter === \"vocabulary\"", to: "if (false && (r.pack.topicFilter === \"vocabulary\"" }], expect: [/^pack topic: a lender with no setting of its own gets the filter from its pack/, /^pack topic: a lender with no setting in business.json gets the filter from its pack/] },
  { name: "a pack is not found by its alias", patches: [{ file: LI, from: "if (byAlias) return", to: "if (false) return" }], expect: [/^pack: a business resolves to its pack/, /^pack topic: a lender with no setting of its own/] },
  { name: "business.json industry is not consulted", patches: [{ file: LI, from: "[[\"industry\", \"industry\"], [\"kind\", \"kind\"]]", to: "[[\"kind\", \"kind\"]]" }], expect: [/^pack: a business resolves to its pack/, /^pack: industry wins over kind/] },
  { name: "the filter is on for every business", patches: [{ file: LI, from: "return { value: \"off\", from: \"the default (off)", to: "return { value: \"vocabulary\", from: \"the default (off)" }], expect: [/^pack topic: a business whose pack sets nothing/, /^pack topic: the historic-homes style business/] },
  { name: "bing.json does not say where the setting came from", patches: [{ file: RB, from: "settingFrom: tf.settingFrom,", to: "settingFrom: null," }], expect: [/^pack topic: a lender with no setting in business.json/, /^pack topic: the historic-homes style/, /^pack topic: business.json 'off' overrides/] },
  { name: "research-bing.mjs reads only business.json, not the pack", patches: [{ file: RB, from: "const setting = topicSetting(b);", to: "const setting = { value: b.topicFilter === \"vocabulary\" ? \"vocabulary\" : \"off\", from: \"business.json\" };" }], expect: [/^pack topic: a lender with no setting in business.json gets the filter from its pack/] },
  { name: "the pack's licenceDetect is ignored", patches: [{ file: LI, from: "if (r && Array.isArray(r.pack.licenceDetect)", to: "if (false && Array.isArray(r.pack.licenceDetect)" }], expect: [/^licence: a pack's licenceDetect replaces the default/, /^licence: research-competitors.mjs for a lender looks for the lender pack's kinds only/] },
  { name: "the default has no NMLS kind", patches: [{ file: LI, from: "id: \"NMLS\", label: \"NMLS id (mortgage", to: "id: \"NMLSX\", label: \"NMLS id (mortgage" }], expect: [/^licence: the default looks for a real-estate licence AND the lender kinds/, /^licence: page\(\) with the default kinds/] },
  { name: "the default has no DFPI kind", patches: [{ file: LI, from: "id: \"DFPI\", label:", to: "id: \"DFPIX\", label:" }], expect: [/^licence: the default looks for a real-estate licence AND the lender kinds/] },
  { name: "no cap on matches per kind", patches: [{ file: LI, from: ".slice(0, max)", to: "" }], expect: [/^licence: at most 3 matches per kind/] },
  { name: "a bad pattern throws instead of being skipped", patches: [{ file: LI, from: "catch { continue; }", to: "catch (e) { throw e; }" }], expect: [/^licence: a pattern that is not a regular expression is skipped/] },
  { name: "page() ignores the kinds it is given", patches: [{ file: RC, from: "licences: detectLicences(t.withChrome, detect),", to: "licences: detectLicences(t.withChrome)," }], expect: [/^licence: page\(\) with the lender pack's kinds reads only the NMLS id/, /^licence: research-competitors.mjs for a lender looks for the lender pack's kinds only/] },
  { name: "licences are read from the text without the footer (the old blind spot)", patches: [{ file: RC, from: "licences: detectLicences(t.withChrome, detect),", to: "licences: detectLicences(t.all, detect)," }], expect: [/^licence: page() with the default kinds/, /^licence: page() with the lender pack/] },
  { name: "summarise() trusts every audit to have licences", patches: [{ file: RC, from: "...(r.page.licences || [])", to: "...r.page.licences" }], expect: [/^licence: summarise\(\) reads an older audit/] },
  { name: "the run does not pass the pack's kinds to the audit", patches: [{ file: RC, from: "{ pages, detect: lic.detect }", to: "{ pages }" }], expect: [/^licence: research-competitors.mjs for a lender looks for the lender pack's kinds only/] },
  { name: "competitors.json does not name the pack or the kinds", patches: [{ file: RC, from: "licenceDetect: { from: lic.from, kinds: lic.detect.map((d) => d.id) }, ", to: "" }], expect: [/^licence: research-competitors.mjs for a lender looks for/, /^licence: for a business whose pack names no licence kinds/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-industry.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "INDUSTRY", scenarios, MUTANTS, scriptsDir, argv: A }));
}
