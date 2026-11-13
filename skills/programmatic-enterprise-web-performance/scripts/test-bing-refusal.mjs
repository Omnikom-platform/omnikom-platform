// Usage: node test-bing-refusal.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of the work order 40 gap: research-bing.mjs (and so research.mjs, which calls its run() with siteStats) must not fail when Bing refuses the
// client's OWN site statistics (GetQueryStats answers "ERROR!!! NotAuthorized" until the client adds us as a user in Bing Webmaster Tools).
// The keyword estimates go on; the site statistics are BLOCKED with what unblocks them, in bing.json (siteStats?.status "blocked") and in the
// last line. Any other failure of that call is still a failure, and a refused KEY (HTTP 401/403 on a keyword call) still blocks the whole step.
// No network: a local server answers in the shapes of fixtures/bing-junk and tools/audit/metrics/fixtures/bing.json (the refusal body is the real one:
// {"Message":"ERROR!!! NotAuthorized"}; which HTTP status Bing puts on it is UNPROVEN, so 400, 200, 401 and 403 are all covered).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./lib-main.mjs";
import { serve, runner, J, W, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const KEY = "BINGKEY-SECRET-xyz";   // gitleaks:allow (a made-up test key)
const UNBLOCK = "the client adds us as a user in Bing Webmaster Tools";
const SITE = "https://bing-refusal-test.test/";

async function scenarios(dir) {
  const results = [], check = checker(results);
  const tmp = mkTmp("bing-refusal"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
  fs.mkdirSync(home);
  const run = runner(dir, home, netLog, ["BING_WEBMASTER_KEY", "BING_API_BASE"]);
  const mode = { stats: "ok", keywords: "ok" };
  const srv = await serve((r) => {
    const u = new URL(r.url, "http://x"), m = u.pathname.split("/").pop();
    if (u.searchParams.get("apikey") !== KEY) return { status: 401, body: { Message: "ERROR!!! InvalidApiKey" } };
    if (m === "GetKeyword") {
      if (mode.keywords === "401") return { status: 401, body: { Message: "ERROR!!! InvalidApiKey" } };
      return { body: { d: [{ Query: u.searchParams.get("q"), Impressions: 700, BroadImpressions: 2100, Date: "/Date(1760000000000)/" }, { Query: u.searchParams.get("q"), Impressions: 300, BroadImpressions: 900, Date: "/Date(1760600000000)/" }] } };
    }
    if (m === "GetQueryStats") {
      const refused = { Message: "ERROR!!! NotAuthorized" };
      if (mode.stats === "400") return { status: 400, body: refused };
      if (mode.stats === "200") return { status: 200, body: refused };
      if (mode.stats === "403") return { status: 403, body: refused };
      if (mode.stats === "500") return { status: 500, body: { Message: "ERROR!!! InternalError" } };
      return { body: { d: [{ Query: "tracy homes realty", Impressions: 50, Clicks: 20, AvgImpressionPosition: 1.5, AvgClickPosition: 1.2, Date: "/Date(1760000000000)/" }] } };
    }
    return { status: 404, body: {} };
  });
  const env = { BING_API_BASE: `${srv.url}/webmaster/api.svc/json`, BING_WEBMASTER_KEY: KEY, PEWP_TEST_GAP_MS: "0", PEWP_RULES_DIR: path.join(here, "..", "rules") };
  const fresh = (n) => {
    const cwd = path.join(tmp, n), pewp = path.join(cwd, "site-checks", "bing-refusal-test.test", ".pewp");
    W(path.join(pewp, "business.json"), { name: "Refusal Test Realty", domain: "bing-refusal-test.test", market: { country: "US", language: "en" }, vocabulary: ["homes"], offer: "homes" });
    return { cwd, pewp, bing: () => { const f = path.join(pewp, "research", "bing.json"); return fs.existsSync(f) ? J(f) : { keywords: [], siteQueries: [], siteStats: null, missing: true }; } };
  };
  const go = (w, extra = [], e = env) => run("research-bing.mjs", [SITE, "--seed", "homes for sale in tracy", "--no-related", "--cwd", w.cwd, ...extra], { env: e });
  const statsHits = () => srv.reqs.filter((q) => /GetQueryStats/.test(q.url)).length;
  try {
    for (const [label, stats] of [["HTTP 400", "400"], ["HTTP 200", "200"], ["HTTP 403", "403"]]) {
      mode.stats = stats; const w = fresh(`refused-${stats}`);
      const r = await go(w, ["--site-stats"]);
      const b = fs.existsSync(path.join(w.pewp, "research", "bing.json")) ? w.bing() : null;
      check(`refusal: own-site stats refused (${label} NotAuthorized): the step still exits 0 with the keyword estimates`, r.code === 0 && b && b.status === "ok" && b.keywords.length === 1 && b.keywords[0].volume.value === 1000, `exit ${r.code} ${r.out}`);
      check(`refusal: (${label}) the site stats are BLOCKED in bing.json with what unblocks them, and no own queries are invented`, b && b.siteStats?.status === "blocked" && b.siteStats?.blocked === UNBLOCK && Array.isArray(b.siteQueries) && b.siteQueries.length === 0, JSON.stringify(b?.siteStats));
      check(`refusal: (${label}) the output says it: "site stats BLOCKED: ${UNBLOCK}"`, r.so.includes(`site stats BLOCKED: ${UNBLOCK}`), r.out);
    }
    // the refused answer must not be cached: after the client adds us, the next run asks again and gets the numbers
    mode.stats = "200"; const wc = fresh("recover");
    await go(wc, ["--site-stats"]);
    const before = statsHits();
    mode.stats = "ok";
    const r2 = await go(wc, ["--site-stats"]);
    const b2 = wc.bing();
    check("refusal: a refused answer is not kept in the cache: once the client has added us the next run asks again and reads the own queries", r2.code === 0 && statsHits() === before + 1 && b2.siteStats?.status === "ok" && b2.siteQueries?.length === 1 && b2.siteQueries?.[0]?.query === "tracy homes realty", `${statsHits() - before} new requests; ${JSON.stringify(b2.siteStats)} ${r2.out}`);
    mode.stats = "ok"; const wo = fresh("ok");
    const ro = await go(wo, ["--site-stats"]);
    check("refusal: when the stats are allowed nothing is blocked (status ok, the line has no BLOCKED)", ro.code === 0 && wo.bing().siteStats?.status === "ok" && !/BLOCKED/.test(ro.so), `${ro.out} ${JSON.stringify(wo.bing().siteStats)}`);
    const wn = fresh("notasked"), before3 = statsHits();
    const rn = await go(wn, []);
    check("refusal: without --site-stats the call is not made and siteStats says 'not asked'", rn.code === 0 && statsHits() === before3 && wn.bing().siteStats?.status === "not asked", `${rn.out} ${JSON.stringify(wn.bing().siteStats)}`);
    mode.stats = "500"; const w5 = fresh("fail500");
    const r5 = await go(w5, ["--site-stats"]);
    check("refusal: any OTHER failure of the site-stats call (HTTP 500) is still an error (exit 1), never passed off as a refusal", r5.code === 1 && /GetQueryStats HTTP 500/.test(r5.out) && !/site stats BLOCKED/.test(r5.out), `exit ${r5.code} ${r5.out}`);
    mode.stats = "ok"; mode.keywords = "401"; const w6 = fresh("keyrefused");
    const r6 = await go(w6, ["--site-stats"]);
    check("refusal: a refused KEY on a keyword call still blocks the whole step (exit 3, BLOCKED: Bing refused the key)", r6.code === 3 && /^BLOCKED: Bing refused the key/m.test(r6.so), `exit ${r6.code} ${r6.out}`);
    mode.keywords = "ok";
    // SKILL-ADOPT-1 R4: a refusal never replaces the data of an earlier run; with no data yet it leaves its BLOCKED record
    const wk = fresh("keep"), bf = path.join(wk.pewp, "research", "bing.json"), bytes = () => (fs.existsSync(bf) ? fs.readFileSync(bf, "utf8") : null);
    await go(wk); const okBytes = bytes();
    mode.keywords = "401"; const rk = await go(wk, ["--seed", "a seed not in the cache"]); mode.keywords = "ok";
    check("refusal: a refused key never replaces the data of an earlier run: bing.json keeps its bytes (exit 3, BLOCKED: Bing refused the key)", okBytes !== null && rk.code === 3 && /^BLOCKED: Bing refused the key/m.test(rk.so) && bytes() === okBytes, `exit ${rk.code} ${rk.out}`);
    const rn0 = await go(wk, [], { ...env, BING_WEBMASTER_KEY: "" });
    check("refusal: no key never replaces the data of an earlier run either: bing.json keeps its bytes (exit 3, BLOCKED: ... BING_WEBMASTER_KEY)", okBytes !== null && rn0.code === 3 && /^BLOCKED: .*BING_WEBMASTER_KEY/m.test(rn0.so) && bytes() === okBytes, `exit ${rn0.code} ${rn0.out}`);
    check("refusal: with no data yet a refused key leaves its BLOCKED record with the unblock text (control)", w6.bing().status === "blocked" && /Bing refused the key/.test(String(w6.bing().blocked)), JSON.stringify(w6.bing()).slice(0, 300));
    const net = fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8").trim() : "";
    check("refusal: nothing in this suite left the machine (network guard log empty) and the key is in no output file", !net && !fs.readdirSync(tmp, { recursive: true }).some((f) => { const p = path.join(tmp, String(f)); return fs.statSync(p).isFile() && /bing\.json$/.test(p) && fs.readFileSync(p, "utf8").includes(KEY); }), net);
  } finally { srv.close(); rmTmp(tmp); }
  return results;
}

const RB = "research-bing.mjs";
const MUTANTS = [
  { name: "a refused site-stats call is not tolerated", patches: [{ file: RB, from: "if (tolerateRefusal && refusal)", to: "if (false)" }], expect: [/^refusal: own-site stats refused \(HTTP 400/, /^refusal: \(HTTP 200\) the site stats are BLOCKED/, /^refusal: own-site stats refused \(HTTP 403/] },
  { name: "the refused answer stays in the cache", patches: [{ file: RB, from: "if (r.cacheFile) fs.rmSync(r.cacheFile, { force: true });", to: "" }], expect: [/^refusal: a refused answer is not kept in the cache/] },
  { name: "every failure of the site-stats call counts as a refusal", patches: [{ file: RB, from: "const refusal = r.status === 401 || r.status === 403 || /NotAuthorized/i.test(r.text);", to: "const refusal = r.status !== 200;" }], expect: [/^refusal: any OTHER failure/] },
  { name: "bing.json says ok for blocked site stats", patches: [{ file: RB, from: "status: !siteStats || !siteStatsAsked ? \"not asked\" : siteStatsBlocked ? \"blocked\" : \"ok\"", to: "status: \"ok\"" }], expect: [/^refusal: \(HTTP 400\) the site stats are BLOCKED/, /^refusal: \(HTTP 200\) the site stats are BLOCKED/] },
  { name: "the unblock text is not the client's step", patches: [{ file: RB, from: "const SITE_STATS_UNBLOCK = \"the client adds us as a user in Bing Webmaster Tools\";", to: "const SITE_STATS_UNBLOCK = \"try again later\";" }], expect: [/^refusal: \(HTTP 400\) the site stats are BLOCKED/, /^refusal: \(HTTP 400\) the output says it/] },
  { name: "the last line does not mention the blocked site stats", patches: [{ file: RB, from: "${r.siteStats.blocked ? ` (site stats BLOCKED: ${r.siteStats.blocked})` : \"\"}", to: "" }], expect: [/^refusal: \(HTTP 400\) the output says it/] },
  { name: "a refused key on a keyword call is tolerated", patches: [{ file: RB, from: "const r = await call(\"GetKeyword\", params);", to: "const r = await call(\"GetKeyword\", params, { tolerateRefusal: true });" }], expect: [/^refusal: a refused KEY/] },
  { name: "the own-site call is made without --site-stats", patches: [{ file: RB, from: "if (siteStats) {", to: "if (true) {" }], expect: [/^refusal: without --site-stats/] },
  { name: "[adopt] a refusal replaces earlier data", patches: [{ file: RB, from: "if (readStep(ctx, \"bing\")?.status !== \"ok\") writeBlocked(ctx, \"bing\", unblock);", to: "writeBlocked(ctx, \"bing\", unblock);" }], expect: [/^refusal: a refused key never replaces/, /^refusal: no key never replaces/] },
  { name: "[adopt] a refusal leaves no record", patches: [{ file: RB, from: "if (readStep(ctx, \"bing\")?.status !== \"ok\") writeBlocked(ctx, \"bing\", unblock);", to: "if (false) writeBlocked(ctx, \"bing\", unblock);" }], expect: [/^refusal: with no data yet/] },
  { name: "[adopt] a refused key overwrites as before", patches: [{ file: RB, from: "} catch (e) { if (e instanceof Blocked) blockedRecord(ctx, e.unblock); throw e; }", to: "} catch (e) { if (e instanceof Blocked) writeBlocked(ctx, \"bing\", e.unblock); throw e; }" }], expect: [/^refusal: a refused key never replaces/] },
  { name: "[adopt] no key overwrites as before", patches: [{ file: RB, from: "if (!key) { blockedRecord(ctx, UNBLOCK); throw new Blocked(UNBLOCK); }", to: "if (!key) { writeBlocked(ctx, \"bing\", UNBLOCK); throw new Blocked(UNBLOCK); }" }], expect: [/^refusal: no key never replaces/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-bing-refusal.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "BING REFUSAL", scenarios, MUTANTS, scriptsDir, argv: A }));
}
