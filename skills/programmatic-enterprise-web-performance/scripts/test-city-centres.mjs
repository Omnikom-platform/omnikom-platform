// Usage: node test-city-centres.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of local-centres.mjs (step city-centres of pipeline.json): each service-area city's centre from the COORDINATES of its Wikipedia page (Wikimedia Action API,
// prop=coordinates, one polite request per city), written as captures/local/grid/cities.json in the shape local-grid.mjs plan reads. Nothing guessed: a city whose page has no
// coordinates, or no page, is BLOCKED by name. No network: a local server answers in the documented Action API shape (formatversion 2; WIKI_ACTION_API_BASE is the test hook);
// the live Wikimedia answer is UNPROVEN here. The Sacramento fixture is the shape WO 40 B read by hand from the Wikipedia infobox: 38.58111, -121.49389.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./lib-main.mjs";
import { serve, runner, J, W, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const SITE = "https://centres-test.test/";
const lastLine = (s) => String(s).trim().split("\n").pop();

// what the fake Wikipedia knows: title -> { coordinates } | { disambiguation } ; everything else is missing
const PAGES = {
  "Sacramento, California": { coordinates: [{ lat: 38.58111, lon: -121.49389, primary: true, globe: "earth" }] },
  "Tracy, California": { coordinates: [{ lat: 37.7397, lon: -121.4252, primary: true, globe: "earth" }] },
  "Elk Grove": {},                                                                       // the plain title is a disambiguation page: no coordinates
  "Fresno": { coordinates: [{ lat: 36.7378, lon: -119.7871, primary: true, globe: "earth" }] }, // "Fresno, California" is missing here: the plain page is used
  "Calgary, Alberta": { coordinates: [{ lat: 51.0447, lon: -114.0719, primary: true, globe: "earth" }] },
  "Moonbase, California": { coordinates: [{ lat: 10, lon: 20, primary: true, globe: "moon" }] },
  "Badville, California": { coordinates: [{ lat: 999, lon: 20, primary: true, globe: "earth" }] },
};
const business = (cities) => ({ name: "Centres Test Lending", domain: "centres-test.test", market: { country: "US", language: "en" }, locations: [{ serviceArea: cities }] });

async function scenarios(dir) {
  const results = [], check = checker(results);
  const tmp = mkTmp("centres"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
  fs.mkdirSync(home);
  const run = runner(dir, home, netLog, ["WIKI_ACTION_API_BASE"]);
  const mode = { fail: null };
  const srv = await serve((r) => {
    const u = new URL(r.url, "http://x");
    if (u.pathname !== "/w/api.php") return { status: 404, body: "wrong path" };
    if (mode.fail === "429") return { status: 429, body: { error: { code: "ratelimited" } } };
    if (mode.fail === "500") return { status: 500, body: "boom" };
    const titles = (u.searchParams.get("titles") || "").split("|");
    const pages = titles.map((t) => (t in PAGES ? { pageid: 1, title: t, ...PAGES[t] } : { title: t, missing: true }));
    return { body: { batchcomplete: true, query: { pages } } };
  });
  const env = { WIKI_ACTION_API_BASE: `${srv.url}/w/api.php`, PEWP_TEST_GAP_MS: "0" };
  const fresh = (n, cities, { approved = true } = {}) => {
    const cwd = path.join(tmp, n), pewp = path.join(cwd, "site-checks", "centres-test.test", ".pewp");
    if (cities) { W(path.join(pewp, "business.json"), business(cities)); if (approved) W(path.join(pewp, "approved", "business.json"), business(cities)); }
    return { cwd, pewp, file: path.join(pewp, "captures", "local", "grid", "cities.json") };
  };
  const go = (w, extra = [], e = env) => run("local-centres.mjs", [SITE, "--cwd", w.cwd, "--today", "2026-11-11", ...extra], { env: e });
  try {
    // 1. one city: the request and the entry
    let w = fresh("one", ["Sacramento, CA"]), h = srv.reqs.length;
    let r = await go(w);
    const q = srv.reqs.slice(h), qs = q[0] ? new URL(q[0].url, "http://x").searchParams : new URLSearchParams();
    check("centres: one request per city, a GET to /w/api.php with action=query, prop=coordinates, coprimary=primary, formatversion=2, redirects=1 and BOTH candidate titles in one request ('Sacramento, California|Sacramento')", r.code === 0 && q.length === 1 && q[0].method === "GET" && qs.get("action") === "query" && qs.get("prop") === "coordinates" && qs.get("coprimary") === "primary" && qs.get("formatversion") === "2" && qs.get("redirects") === "1" && qs.get("titles") === "Sacramento, California|Sacramento", `exit ${r.code} ${q.length} requests ${q[0]?.url} ${r.out}`);
    check("centres: a descriptive User-Agent is sent (Wikimedia asks for one)", /PEWP-Research/.test(q[0]?.headers["user-agent"] || ""), JSON.stringify(q[0]?.headers));
    const cities = fs.existsSync(w.file) ? J(w.file) : [];
    const e = cities[0] || {};
    check("centres: cities.json is a list of { city, lat, lng, source, readAt, title }: Sacramento 38.58111, -121.49389, the source is the page address, readAt is the date", cities.length === 1 && e.city === "Sacramento, CA" && e.lat === 38.58111 && e.lng === -121.49389 && e.source === "https://en.wikipedia.org/wiki/Sacramento,_California" && e.readAt === "2026-11-11" && e.title === "Sacramento, California" && e.by === "wikipedia", JSON.stringify(cities));
    check('centres: the output says what was read ("centre Sacramento, CA: 38.58111, -121.49389 (Wikipedia ...)") and ends "OK centres: 1 of 1 cities with a centre -> <file>"', /^centre Sacramento, CA: 38\.58111, -121\.49389 \(Wikipedia "Sacramento, California"\)/m.test(r.so) && /^OK centres: 1 of 1 cities with a centre -> /m.test(lastLine(r.so)), r.so);
    // the file is what local-grid.mjs plan reads
    const gp = await run("local-grid.mjs", ["plan", SITE, "--cwd", w.cwd, "--query", "hard money loans {city}", "--n", "1"], { env });
    check("centres: local-grid.mjs plan accepts the file as it is: the city is planned (exit 0, a plan line for 1 city, requests.json written)", gp.code === 0 && /grid plan: 1 cities/.test(gp.so) && fs.existsSync(path.join(path.dirname(w.file), "requests.json")), `exit ${gp.code} ${gp.out}`);
    // 2. several cities: partial, the plain-title fallback, a non-US place, a state spelled out
    w = fresh("many", ["Sacramento, CA", "Elk Grove, CA", "Fresno, CA", "Calgary, Alberta", "Tracy, CA"]); h = srv.reqs.length;
    r = await go(w);
    const titles = srv.reqs.slice(h).map((x) => new URL(x.url, "http://x").searchParams.get("titles"));
    const got = J(w.file), by = (c) => got.find((x) => x.city === c);
    check("centres: one request per city (5), the state spelled out for a two-letter US state and left alone for 'Calgary, Alberta'", titles.length === 5 && titles.join(" / ") === "Sacramento, California|Sacramento / Elk Grove, California|Elk Grove / Fresno, California|Fresno / Calgary, Alberta|Calgary / Tracy, California|Tracy", titles.join(" / "));
    check("centres: a city whose page has no coordinates (Elk Grove: only a disambiguation page) is a 'BLOCKED city' line and left out, the run still exits 0 (partial), no BLOCKED last line", r.code === 0 && /^BLOCKED city Elk Grove, CA: the page has no coordinates \(Elk Grove, California \/ Elk Grove\)\. To fix: add \{ "city": "Elk Grove, CA"/m.test(r.so) && !by("Elk Grove, CA") && got.length === 4 && /^OK centres: 4 of 5 cities/.test(lastLine(r.so)) && !/^BLOCKED: /m.test(r.so), `exit ${r.code} ${r.out}`);
    check("centres: when 'City, State' has no page but the plain title has coordinates, the plain page is used and its title is kept (Fresno -> title Fresno)", by("Fresno, CA")?.title === "Fresno" && by("Fresno, CA")?.lat === 36.7378 && by("Fresno, CA")?.source === "https://en.wikipedia.org/wiki/Fresno", JSON.stringify(by("Fresno, CA")));
    // 3. kept, refreshed, rewritten
    h = srv.reqs.length; const m0 = fs.statSync(w.file).mtimeMs; await new Promise((x) => setTimeout(x, 40));
    r = await go(w);
    check("centres: a second run keeps the found cities as they are (no request for them), reads the missing one again from the 30-day cache (0 requests), and rewrites cities.json (newer file: the step evidence is written by this run)", srv.reqs.length - h === 0 && /^centre Sacramento, CA: already in cities.json/m.test(r.so) && fs.statSync(w.file).mtimeMs > m0 && J(w.file).length === 4, `${srv.reqs.length - h} requests ${r.out}`);
    const hand = J(w.file); hand.find((x) => x.city === "Sacramento, CA").lat = 38.5; hand.find((x) => x.city === "Sacramento, CA").source = "typed by hand"; W(w.file, hand);
    h = srv.reqs.length; r = await go(w, ["--cities", "Sacramento, CA"]);
    check("centres: an entry typed by hand is kept and not asked again (0 requests), but the file is still rewritten", srv.reqs.length === h && J(w.file).find((x) => x.city === "Sacramento, CA").source === "typed by hand", `${srv.reqs.length - h} requests ${JSON.stringify(J(w.file))}`);
    h = srv.reqs.length; r = await go(w, ["--cities", "Sacramento, CA", "--refresh"]);
    check("centres: --refresh asks again (1 real request, the 30-day cache is bypassed) and replaces the hand-typed entry", srv.reqs.length - h === 1 && J(w.file).find((x) => x.city === "Sacramento, CA").lat === 38.58111 && J(w.file).find((x) => x.city === "Sacramento, CA").source.startsWith("https://en.wikipedia.org/"), JSON.stringify(J(w.file)));
    check("centres: other cities already in cities.json are kept when --cities names one city (nothing lost)", J(w.file).length === 4, JSON.stringify(J(w.file).map((x) => x.city)));
    // 4. nothing found, no cities, invalid coordinates
    w = fresh("none", ["Elk Grove, CA"]);
    r = await go(w);
    check("centres: no city has a centre: BLOCKED, exit 3, the city line first and the LAST line 'BLOCKED: no service-area city has a centre (Elk Grove, CA) | unblocks: ...', cities.json not written", r.code === 3 && /^BLOCKED city Elk Grove, CA/m.test(r.so) && /^BLOCKED: no service-area city has a centre \(Elk Grove, CA\) \| unblocks: add the centres to captures\/local\/grid\/cities\.json/.test(lastLine(r.so)) && !fs.existsSync(w.file), `exit ${r.code} ${r.out}`);
    w = fresh("nocities", []);
    r = await go(w);
    check("centres: no service-area cities in the business definition is BLOCKED (exit 3, last line 'BLOCKED: business.json has no locations[].serviceArea cities | unblocks: ...'), no request", r.code === 3 && /^BLOCKED: business\.json has no locations\[\]\.serviceArea cities \| unblocks: /.test(lastLine(r.so)), `exit ${r.code} ${r.out}`);
    w = fresh("bad", ["Badville, CA", "Moonbase, CA", "Sacramento, CA"]);
    r = await go(w);
    check("centres: coordinates that are not valid numbers (latitude 999) or not on Earth (the moon) are refused for that city, never written", r.code === 0 && /^BLOCKED city Badville, CA: the page's coordinates are not valid numbers/m.test(r.so) && /^BLOCKED city Moonbase, CA: the page's coordinates are not valid numbers/m.test(r.so) && J(w.file).map((x) => x.city).join() === "Sacramento, CA", `exit ${r.code} ${r.out}`);
    // 5. refusals, failures, usage
    mode.fail = "429"; w = fresh("quota", ["Sacramento, CA", "Tracy, CA"]); h = srv.reqs.length;
    r = await go(w);
    check("centres: HTTP 429 stops at once: BLOCKED (exit 3, last line says Wikimedia rate limit and how to unblock), one request only", r.code === 3 && /^BLOCKED: Wikimedia rate limit \(HTTP 429\).* \| unblocks: wait, then run again/.test(lastLine(r.so)) && srv.reqs.length - h === 1, `exit ${r.code} ${srv.reqs.length - h} requests ${r.out}`);
    mode.fail = "500"; w = fresh("fail500", ["Sacramento, CA"]);
    r = await go(w);
    check("centres: any other failure (HTTP 500) is an error (exit 1), not a BLOCKED, and nothing is written", r.code === 1 && /HTTP 500/.test(r.out) && !/^BLOCKED/m.test(r.so) && !fs.existsSync(w.file), `exit ${r.code} ${r.out}`);
    mode.fail = null;
    const bad = [];
    for (const [label, argv, re] of [["no target", [], /usage: node local-centres\.mjs/], ["bad --today", [SITE, "--today", "yesterday"], /--today/]]) { const x = await run("local-centres.mjs", argv, { env }); if (!(x.code === 2 && re.test(x.se))) bad.push(`${label}: exit ${x.code} ${x.out}`.slice(0, 200)); }
    check("centres: usage: no target or a bad --today is exit 2 with the usage line", !bad.length, bad.join(" | "));
    const net = fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8").trim() : "";
    check("centres: nothing in this suite left the machine (network guard log empty)", !net, net);
  } finally { srv.close(); rmTmp(tmp); }
  return results;
}

const LC = "local-centres.mjs";
const MUTANTS = [
  { name: "the plain title is asked first, the state-qualified one is not asked", patches: [{ file: LC, from: "return [...new Set([`${name}, ${STATES[st.toUpperCase()] || st}`, name])];", to: "return [name];" }], expect: [/^centres: one request per city, a GET/, /^centres: one request per city \(5\)/] },
  { name: "a two-letter state is not spelled out", patches: [{ file: LC, from: "STATES[st.toUpperCase()] || st", to: "st" }], expect: [/^centres: one request per city, a GET/] },
  { name: "the primary coordinates are not asked for", patches: [{ file: LC, from: "coprimary: \"primary\", ", to: "" }], expect: [/^centres: one request per city, a GET/] },
  { name: "no User-Agent", patches: [{ file: LC, from: "init: { headers: { \"user-agent\": UA, accept: \"application/json\" } }", to: "init: { headers: { accept: \"application/json\" } }" }], expect: [/^centres: a descriptive User-Agent/] },
  { name: "the source is not the page address", patches: [{ file: LC, from: "source: wikiUrl(pick.title)", to: "source: \"wikipedia\"" }], expect: [/^centres: cities.json is a list/, /^centres: when 'City, State' has no page/] },
  { name: "a page with no coordinates is not noticed (a zero is written)", patches: [{ file: LC, from: "if (!co) continue;", to: "if (!co) return { title: p.title, lat: 0, lng: 0 };" }], expect: [/^centres: a city whose page has no coordinates/] },
  { name: "invalid coordinates are written", patches: [{ file: LC, from: "if (!valid(co)) { sawBad = true; continue; }", to: "" }], expect: [/^centres: coordinates that are not valid numbers/] },
  { name: "the globe is not checked (the moon)", patches: [{ file: LC, from: " && (!c.globe || c.globe === \"earth\")", to: "" }], expect: [/^centres: coordinates that are not valid numbers/] },
  { name: "an entry already in cities.json is asked again", patches: [{ file: LC, from: "if (!refresh && keep.has(nfkc(city)) && Number.isFinite(keep.get(nfkc(city)).lat)) {", to: "if (false) {" }], expect: [/^centres: a second run asks only/, /^centres: an entry typed by hand is kept/] },
  { name: "--refresh does nothing", patches: [{ file: LC, from: "if (!refresh && keep.has(", to: "if (keep.has(" }], expect: [/^centres: --refresh reads the city again/] },
  { name: "cities.json is not rewritten when nothing was asked", patches: [{ file: LC, from: "  W(file, [...out.values()]);\n  return { file,", to: "  if (lines.some((l) => /^centre .*: [-\\d]/.test(l))) W(file, [...out.values()]);\n  return { file," }], expect: [/^centres: a second run asks only/] },
  { name: "other cities already in the file are dropped", patches: [{ file: LC, from: "const out = new Map(keep), lines = [], blocked = [];", to: "const out = new Map(), lines = [], blocked = [];" }], expect: [/^centres: other cities already in cities.json are kept/] },
  { name: "no city found does not block", patches: [{ file: LC, from: "if (!wanted.length) throw", to: "if (false) throw" }], expect: [/^centres: no city has a centre: BLOCKED/] },
  { name: "a 429 is not BLOCKED", patches: [{ file: LC, from: "if (r.status === 429) throw new Blocked(", to: "if (false) throw new Blocked(" }], expect: [/^centres: HTTP 429 stops at once/] },
  { name: "a failure is passed off as BLOCKED", patches: [{ file: LC, from: "if (r.status !== 200) throw new Error(", to: "if (r.status !== 200) throw new Blocked(" }], expect: [/^centres: any other failure/] },
  { name: "no cities does not block", patches: [{ file: LC, from: "if (!list.length) throw new Blocked(", to: "if (false) throw new Blocked(" }], expect: [/^centres: no service-area cities in the business definition/] },
  { name: "the BLOCKED city line has no fix", patches: [{ file: LC, from: ". To fix: add { \"city\"", to: ". Nothing to do { \"city\"" }], expect: [/^centres: a city whose page has no coordinates/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-city-centres.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "CITY CENTRES", scenarios, MUTANTS, scriptsDir, argv: A }));
}
