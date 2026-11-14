// Usage: node test-client-copy.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of client-copy.mjs (the client's 8-page copy of a finished audit run) on two INVENTED businesses, built in a temporary folder.
// Every case starts the command as a child process. No network, no browser, no repository file is read except the skill's own
// client-copy/ folder (the wording that is data) and, for case 13 b, assets/client-copy/.
// --mutants: watched-fail. Copies the skill, breaks one thing at a time, runs this test against the copy and requires the named
//   case to go red (green = the case measures nothing, or the patch never applied; a `from` that occurs twice is refused).
// Exit 0 = all pass.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : here);
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const MUT = [
    { id: "get-returns-zero-for-missing", file: "client-copy-data.mjs", from: 'if (v === undefined || v === null) stop(`STOP: ${label(def)} has no ${field}`);', to: "if (v === undefined || v === null) return 0;", red: "case 5:" },
    { id: "none-counts-as-draft", file: "client-copy.mjs", from: "const draft = contactIn === null;", to: 'const draft = contactIn === null || contactIn === "none";', red: "case 6:" },
    { id: "go-ahead-typed-in-code", file: "client-copy-pages.mjs", from: "const goAhead = std.goAhead;", to: 'const goAhead = "Tell us to start your draft.";', red: "case 7:" },
    { id: "who-typed-in-code", file: "client-copy-pages.mjs", from: "const whoOf = (f) => f.who;", to: 'const whoOf = () => "Your developer";', red: "case 8:" },
    { id: "home-city-typed", file: "client-copy-data.mjs", from: 'const home = String(area[0]).split(",")[0].trim();', to: 'const home = "Alder Bay";', red: "case 2:" },
    { id: "paid-row-filter-out", file: "client-copy-data.mjs", from: "if (isAd(name) || name === ourName) return;", to: "if (name === ourName) return;", red: "case 10:" },
    { id: "missing-lead-path-prints-zero", file: "client-copy-data.mjs", from: 'else put("formFields", null);', to: 'else put("formFields", 0);', red: "case 9:" },
    { id: "c-adds-no-sheet-row", file: "client-copy-pages.mjs", from: "for (const s of recs) sheet.push(", to: "for (const s of recs) void (", red: "case 3:" },
    { id: "backing-id-needs-no-works", file: "client-copy-data.mjs", from: 'const works = states.every((s) => s.state === "WORKS");', to: "const works = true;", red: "case 11:" },
    { id: "address-cut-at-first-comma", file: "client-copy-data.mjs", from: 'const street = (a, home) => { const i = a.search(new RegExp(`,\\\\s*${escRe(home)}`, "i")); return (i > 0 ? a.slice(0, i) : a).trim(); };', to: 'const street = (a, home) => a.split(",")[0].trim();', red: "case 14:" },
    { id: "plan-row-without-sheet-row", file: "client-copy-pages.mjs", from: "if (sheet.length === before) c(RULES[f.when][1], why, f.why);", to: "", red: "case 17:" },
    { id: "plan-rule-always-true", file: "client-copy-pages.mjs", from: "addressesDiffer: [() => D.addresses.length > 1, \"addresses\"],", to: "addressesDiffer: [() => D.addresses.length > 0, \"addresses\"],", red: "case 18:" },
    { id: "css-font-files-unchecked", file: "client-copy.mjs", from: 'for (const f of fontFiles) { if (!fs.existsSync(path.join(assetsDir, "fonts", f))) stop(`STOP: assets fonts/${f} is missing`); }', to: "", red: "case 13:" },
    { id: "ads-blocked-row-is-read", file: "client-copy-data.mjs", from: 'if (getMaybe("ads", `rows[advertiser=${d}&library=google-transparency].status`, "text") === "blocked") return null; ', to: "", red: "case 19:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccopy-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-client-copy.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => c.kill(), 300000);
    c.on("close", (code) => {
      clearTimeout(t);
      const failed = (out.match(/^FAIL .*$/gm) || []).map((l) => l.slice(5).split(" :: ")[0]);
      const hit = failed.some((n) => n.startsWith(m.red));
      resolve({ good: code !== 0 && hit, line: `MUTANT ${m.id}: ${code === 0 ? "STAYED GREEN (case measures nothing)" : hit ? "red for the right reason" : "red, but NOT the expected case"} | expected "${m.red}" | failed: ${failed.join(" ; ").slice(0, 160) || "(none)"}` });
    });
  });
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const queue = MUT.filter((m) => !only || m.id === only);
  await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) { const r = await runOne(queue.shift()); console.log(r.line); if (r.good) ok++; else process.exitCode = 1; } }));
  console.log(`mutants: ${ok}/${MUT.length} red for the right reason`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}

// ---------------------------------------------------------------- harness
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ccopy-"));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); if (!quiet) console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " :: " + String(detail).slice(0, 400)}`); else if (!ok) console.log(`FAIL ${name} :: ${String(detail).slice(0, 200)}`); };
// T runs a case body that returns [ok, detail]; a throw is that case's failure, not the run's
const T = (fn) => { try { const r = fn(); return [r[0], r[1]]; } catch (e) { return [false, e.stack || String(e)]; } };
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof s === "string" ? s : JSON.stringify(s, null, 1)); return p; };
const fmt = (n) => n.toLocaleString("en-US");
let seq = 0;

// ---------------------------------------------------------------- the two invented businesses
function mk(o) {
  let n = o.seed;
  const u = () => (n += 43 + (n % 9)); // strictly rising: no number repeats inside one run folder
  const P = o.products, C = o.cities;
  const s = { ...o, home: C[0].split(",")[0], date: "2026-11-13", cityNames: C.map((c) => c.split(",")[0]) };
  s.vol = P.map(() => u());
  s.relatedVol = [u(), u()];
  s.rivalStats = o.rivals.map(() => ({ words: u(), sitemap: u(), links: u() }));
  s.reviews = u();
  s.adCounts = [u(), 0];
  s.grid = P.map((_, i) => C.map((_, j) => (j === 0 ? { inPack: 11 + 5 * i, in3: 1 + i } : { inPack: 19 + 3 * i + 7 * (j - 1), in3: 0 })));
  s.per = 36;
  s.planCaptures = P.length * C.length * 36;
  s.metro = u(); s.pursue = u(); s.chambers = 4;
  s.spf = 2;
  return s;
}
const A = () => mk({
  seed: 1290, key: "A", name: "Alder Bay Roofing", short: "Alder", domain: "alder-bay-roofing.test", sdType: "RoofingContractor",
  products: ["roof repair", "roof replacement", "gutter installation"], cities: ["Alder Bay, WA", "Pine Hollow, WA", "Stonebrook, WA"],
  extraArea: ["Cedar Flats, WA", "Lakeview, WA"], rating: 4.8, phone: 2210, desk: 1460,
  rivals: [{ domain: "ridgeline-roofs.test", name: "Ridgeline Roofs", note: "roofing contractor; family run", status: 200 }, { domain: "harbor-gutters.test", name: "Harbor Gutters", note: "gutter shop; small", status: 200 }, { domain: "summit-shingle.test", name: "Summit Shingle Co", note: "national roofing chain; large", status: 200 }],
  rivalInGraph: [true, false, true], ourInGraph: false, body: '<html><head><script>var spoken = "one two three four five";</script><style>p { color: red }</style></head><body><div id="root"></div></body></html>',
  siteAddr: "14 Cedar Row, Alder Bay, WA", gAddr: "14 Cedar Row, Alder Bay, WA", bAddr: "9 Mill Lane, Alder Bay, WA", fAddr: "22 Harbor Street, Alder Bay, WA", hasFiling: true,
  sitemapUrls: 0, sitemapType: "text/html", notFound: 200, rangeFrom: "2026-10-15", rangeTo: "2026-11-13", seedsN: 7, rowsN: 31,
  serpProduct: [null, null, null, null, null, null], serpName: [1, 3], serpSite: [1], serpNick: [null], nick: "alder roofs", nameQ: "alder bay roofing",
  missing: ["roof repair", "roof replacement", "gutter installation"], desc: "", services: [], broken: true, social: ["instagram", "youtube", "linkedin"], sameAs: 1,
  faqHeading: true, cites: [["bing.com (Bing Places)", "listed", true], ["apple.com (Apple Maps)", "not listed"], ["yelp.com", "listed"], ["manta.com", "not listed"]],
  hands: true, mailProblem: true, qNames: ["who is alder bay roofing", "best roof repair near me", "gutter installation cost", "alder bay roofing reviews"], shares: [0.4, 0, 0, 0.2],
});
const B = () => mk({
  seed: 5210, key: "B", name: "Northgate Family Dental", short: "Northgate", domain: "northgate-family-dental.test", sdType: "Dentist",
  products: ["teeth cleaning", "dental implants"], cities: ["Northgate, OH", "Elm Ridge, OH"], extraArea: [], rating: 4.6, phone: 3640, desk: 1180,
  rivals: [{ domain: "brightsmile-clinic.test", name: "Bright Smile Clinic", note: "dental clinic; mid size", status: 200 }, { domain: "oakvale-dentists.test", name: "Oakvale Dentists", note: "dentist group", status: 200 }, { domain: "quiet-molar.test", name: "Quiet Molar", note: "dentist; closed site", status: 404 }],
  rivalInGraph: [true, true, false], ourInGraph: true, body: "<html><body><h1>Smile care for the whole family</h1><p>Book a visit today and meet our friendly team</p></body></html>",
  siteAddr: "7 Birch Court, Northgate, OH", gAddr: "7 Birch Court, Northgate, OH", bAddr: "7 Birch Court, Northgate, OH", fAddr: "", hasFiling: false,
  sitemapUrls: 12, sitemapType: "application/xml", notFound: 404, rangeFrom: "2026-10-01", rangeTo: "2026-10-31", seedsN: 4, rowsN: 19,
  serpProduct: [3, null, null, null], serpName: [1], serpSite: [1], serpNick: [], nick: "", nameQ: "northgate family dental",
  missing: ["dental implants"], desc: "A family practice.", services: [], broken: false, social: ["facebook"], sameAs: 1,
  faqHeading: false, cites: [["bing.com (Bing Places)", "listed", true], ["yelp.com", "listed"]],
  hands: false, mailProblem: false, qNames: ["who is northgate family dental", "best dentist near me", "dental implants cost", "northgate family dental reviews"], shares: [0, 0, 0, 0],
});
const AREA = (s) => [...s.cities, ...s.extraArea];

// makeRun(spec): writes every file the builder reads. spec.omit = paths under .pewp not written; spec.patch = {path: fn(json)}.
function makeRun(s) {
  const root = path.join(tmp, `run-${s.key}-${++seq}`);
  const pewp = path.join(root, ".pewp"), snap = path.join(root, "snapshots", "2026-11-10-2"), client = path.join(root, "client"), assets = path.join(root, "assets");
  const omit = s.omit || [], patch = s.patch || {};
  const wp = (rel, j) => { if (omit.includes(rel)) return; if (patch[rel]) { const r = patch[rel](j); if (r !== undefined) j = r; } w(path.join(pewp, rel), j); };
  const ws = (rel, j) => { if (omit.includes("snap:" + rel)) return; w(path.join(snap, rel), j); };
  const P = s.products, C = s.cities;
  const unit = `impressions ${s.rangeFrom}..${s.rangeTo}`;
  w(path.join(pewp, "report.json"), { snapshot: "snapshots/2026-11-10-2" });
  const gridRel = `local/${s.date}/grid.json`;
  w(path.join(pewp, "seo-run.json"), { steps: [{ id: "local-grid-import", evidence: [path.join(pewp, "local/2026-11-12/grid.json").replace(/\\/g, "/"), path.join(pewp, gridRel).replace(/\\/g, "/")] }] });
  // psi: the newest plain <date>.json, an older one, and a name with something after the date (not one)
  const psi = (phone, desk, at) => ({ generatedAt: at, pages: [{ strategy: "mobile", lcpMs: phone, medianOf: 3 }, { strategy: "desktop", lcpMs: desk, medianOf: 3 }] });
  wp("psi/2026-11-13.json", psi(s.phone, s.desk, "2026-11-13T08:00:00.000Z"));
  wp("psi/2026-11-01.json", psi(9100, 8700, "2026-11-01T08:00:00.000Z"));
  wp("psi/2026-11-14-run1.json", psi(7700, 7300, "2026-11-14T08:00:00.000Z"));
  // snapshot
  ws("_site.json", { finishedAt: "2026-11-10T10:00:00.000Z" });
  ws("pages/home/body.html", s.body);
  const htmlBytes = s.body.length + 1000;
  ws("pages/home/response.json", { fetchedAt: "2026-11-10T10:00:01.000Z", htmlBytes });
  ws("site/sitemaps.json", { urlCount: s.sitemapUrls, fetched: [{ contentType: s.sitemapType, bytes: s.sitemapType === "text/html" ? htmlBytes : htmlBytes + 77 }] });
  ws("site/probes.json", { notFound: { finalStatus: s.notFound } });
  const sd = [{ json: { "@type": "WebSite", name: "x" } }, { json: { "@type": s.sdType, address: { streetAddress: s.siteAddr }, sameAs: Array.from({ length: s.sameAs }, (_, i) => `https://social.test/${s.key}${i}`) } }];
  ws("pages/home/browser-mobile.json", { measuredAt: "2026-11-10T10:00:02.000Z", totals: { thirdPartyHosts: { "fonts.googleapis.com": 2, "fonts.gstatic.com": 4 } }, page: { headings: s.faqHeading ? ["H1 Welcome", "H2 Frequently Asked Questions", "H3 First question", "H3 Second question", "H2 Contact"] : ["H1 Welcome", "H2 Contact"], structuredData: sd } });
  ws("pages/home/rendered-text.txt", s.hands ? "Welcome. Quotes in 5 days or less.\n" : "Welcome.\n");
  // research
  wp("research/bing.json", {
    generatedAt: "2026-11-13T07:00:00.000Z",
    keywords: [...P.map((p, i) => ({ query: p, related: false, volume: { value: s.vol[i], unit, location: "US" } })), { query: `${P[0]} cost`, related: true, volume: { value: s.relatedVol[0], unit, location: "US" } }, { query: `${P[0]} near me`, related: true, volume: { value: s.relatedVol[1], unit, location: "US" } }],
    siteStats: { status: "blocked", blocked: "not a client yet" },
  });
  wp("research/index.json", { generatedAt: "2026-11-13T07:01:00.000Z", rows: [{ engine: "bing", serviceChecks: [] }, { engine: "google", serviceChecks: P.map((service) => ({ service })) }], summary: { servicesMissing: s.missing, servicesChecked: P.length, servicesListed: P.length - s.missing.length } });
  const cap = (query, engine, device, pos) => ({ query, engine, device, ourPosition: { value: pos } });
  const caps = [];
  P.forEach((p, i) => { caps.push(cap(`${p} near me`, "google", "mobile", s.serpProduct[i * 2] ?? null)); caps.push(cap(`${p} price`, "bing", "desktop", s.serpProduct[i * 2 + 1] ?? null)); });
  s.serpName.forEach((v) => caps.push(cap(s.nameQ, "google", "mobile", v)));
  s.serpSite.forEach((v) => caps.push(cap(`site:${s.domain}`, "google", "desktop", v)));
  s.serpNick.forEach((v) => caps.push(cap(s.nick, "bing", "mobile", v)));
  s.serpTotal = caps.length;
  s.serpProductN = P.length * 2; s.serpProductWithUs = caps.slice(0, P.length * 2).filter((c) => c.ourPosition.value !== null).length;
  wp("research/serp.json", { generatedAt: "2026-11-13T07:02:00.000Z", captures: caps, counts: { captures: caps.length, notLocalized: caps.length } });
  wp("research/autocomplete.json", { generatedAt: "2026-11-13T07:03:00.000Z", seeds: Array.from({ length: s.seedsN }, (_, i) => `seed ${i}`), rows: Array.from({ length: s.rowsN }, (_, i) => ({ i })) });
  const aiRows = [], q = ["buyer one", "buyer two", "about the business"];
  s.aiQuestions = 12;
  const named = { chatgpt: [true, false, true], perplexity: [false, false, true] };
  for (const e of ["chatgpt", "perplexity"]) q.forEach((qq, i) => { const f = `${e}-${i}.json`; aiRows.push({ engine: e, status: "ok", file: f, type: i < 2 ? "buyer" : "brand", named: named[e][i], question: qq }); wp(`captures/ai/${f}`, { capturedAt: "2026-11-12T10:00:00.000Z", signedIn: true }); });
  for (const e of ["copilot", "gemini"]) aiRows.push({ engine: e, status: "blocked", file: `${e}.json` });
  wp("research/ai-answers.json", { generatedAt: "2026-11-13T07:04:00.000Z", summary: { engines: [{ engine: "chatgpt", status: "ok", questions: 12, named: 5 }, { engine: "perplexity", status: "ok", questions: 12, named: 2 }, { engine: "copilot", status: "blocked", questions: 0, named: 0 }, { engine: "gemini", status: "blocked", questions: 0, named: 0 }], blockedEngines: [{ engine: "copilot", reason: "asks for a sign in" }, { engine: "gemini", reason: "asks for a sign in" }], questions: 24, competitors: [{ name: s.rivals[0].name, count: 9 }, { name: s.rivals[1].name, count: 6 }, { name: s.rivals[2].name, count: 3 }] }, rows: aiRows });
  wp("research/ai-citations.json", { generatedAt: "2026-11-13T07:05:00.000Z", rows: s.qNames.map((question, i) => ({ engine: "google-ai-overview", question, ourNameMentionedShare: { value: s.shares[i] } })) });
  s.aiCitations = s.qNames.length;
  // the grid: an older one (other values) and the one the step's last evidence names
  const mkGrid = (shift) => ({
    date: shift ? "2026-11-12" : s.date, plan: { n: 6, spacingKm: s.key === "A" ? 2.5 : 1.5, captures: s.planCaptures }, summary: { localized: s.planCaptures },
    solv: P.flatMap((p, i) => C.map((c, j) => ({ query: `${p} ${c.split(",")[0]}`, city: c, points: 36, pointsInPack: s.grid[i][j].inPack + shift, pointsIn3Pack: s.grid[i][j].in3 + shift }))),
    points: P.map((p, i) => ({ query: `${p} ${s.home}`, city: C[0], packSize: 3, top3: i === 0 ? [{ name: s.name, reviews: s.reviews }, { name: "Hilltop Rival One", reviews: s.reviews + 200 }, { name: "Ad · Hilltop Ads", reviews: 9999 }] : i === 1 ? [{ name: "Hilltop Rival Two", reviews: s.reviews + 77 }, { name: "Hilltop Rival Three", reviews: s.reviews - 30 }, { name: "Hilltop Rival Four" }] : [{ name: "Hilltop Rival One", reviews: s.reviews + 200 }] })),
  });
  wp("local/2026-11-12/grid.json", mkGrid(1));
  wp(gridRel, mkGrid(0));
  wp("business.json", { name: "stale file, never read" });
  wp("approved/business.json", { name: s.name, domain: s.domain, vocabulary: P.map((p) => p[0].toUpperCase() + p.slice(1)), locations: [{ serviceArea: AREA(s) }] });
  wp("captures/local/profile.json", { capturedAt: "2026-11-12T09:00:00.000Z", name: s.name, address: s.gAddr, reviews: { rating: s.rating, count: s.reviews }, description: s.desc, services: s.services });
  wp("captures/local/citations.json", s.cites.map(([directory, status, bing]) => ({ directory, status, capturedAt: "2026-11-12T09:30:00.000Z", ...(bing ? { address: s.bAddr } : {}) })));
  const url = (p, i) => `https://${p}.test/${s.key}${i}`;
  wp("research/social.json", { generatedAt: "2026-11-13T07:06:00.000Z", rows: s.social.map((p, i) => ({ platform: p, profileUrl: url(p, i) })), summary: { linksBroken: s.broken ? [url("instagram", 0), url("youtube", 1)] : [] } });
  wp("research/ads.json", { generatedAt: "2026-11-13T07:07:00.000Z", rows: s.rivals.slice(0, 2).map((r, i) => ({ advertiser: r.domain, library: "google-transparency", url: `https://ads.test/?preset-date=Last+30+days&d=${i}`, adCount: s.adCounts[i] })) });
  wp("research/competitors.json", { generatedAt: "2026-11-13T07:08:00.000Z", approvedRows: s.rivals.length, sites: s.rivals.map((r, i) => (r.status === 200 ? { domain: r.domain, status: 200, page: { words: s.rivalStats[i].words }, sitemap: { pages: s.rivalStats[i].sitemap } } : { domain: r.domain, status: r.status })) });
  wp("approved/competitors.json", { generatedAt: "2026-11-13T07:09:00.000Z", rows: s.rivals.map((r) => ({ domain: r.domain, name: r.name, note: r.note })) });
  wp("authority.json", { fetchedAt: "2026-11-13T07:10:00.000Z", results: [{ domain: s.domain, inGraph: s.ourInGraph, ...(s.ourInGraph ? { linkingDomains: 3 } : {}) }, ...s.rivals.map((r, i) => ({ domain: r.domain, inGraph: s.rivalInGraph[i], ...(s.rivalInGraph[i] ? { linkingDomains: s.rivalStats[i].links } : {}) }))] });
  wp("authority/vetting.json", { generatedAt: "2026-11-13T07:11:00.000Z", summary: { PURSUE: s.pursue }, results: [...Array.from({ length: s.chambers }, (_, i) => ({ verdict: "PURSUE", type: "chamber-local", domain: `chamber${i}.test` })), { verdict: "SKIP", type: "chamber-local", domain: "skip.test" }, { verdict: "PURSUE", type: "directory", domain: "dir.test" }] });
  wp("authority/opportunities.json", { generatedAt: "2026-11-13T07:12:00.000Z", opportunities: [{ domain: "pinehollow-chamber.test", linksToCompetitors: s.metro }] });
  // hand reads
  const lead = { capturedAtUtc: "2026-11-11T10:00:00Z", jotformFields: { business: ["Business name", "Federal Tax ID*", "b3", "b4", "b5", "b6", "b7", "b8"], owner1: ["Owner name", "SSN*", "o3", "o4", "o5", "o6"], owner2Optional: ["p1", "p2", "p3", "p4", "p5"], uploads: ["u1", "u2", "u3"], closing: ["c1", "c2"] } };
  s.fields = 24; s.fieldsOne = 19;
  wp("captures/reputation/lead.json", lead);
  wp("b/mail.json", { queriedAt: "2026-11-11T11:00:00Z", spfRecordCount: s.spf, dmarc: { notFound: "no record" }, dkimSelectors: { s1: {}, s2: {} } });
  w(path.join(client, "domain.json"), { queriedAt: "2026-11-11T12:00:00Z", events: { expiration: "2027-03-09T00:00:00Z" } });
  wp("b/trust.json", { alderbay: { licenceTermsInRenderedText: [] } });
  w(path.join(client, "filing.md"), `# filing\n| State filing | ${s.fAddr} |\n`);
  // assets: a 1 x 1 PNG and a css that names one font file
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  w(path.join(assets, "omnikom-logo-full.png"), png);
  w(path.join(assets, "fonts", "fonts.css"), '@font-face { font-family: "Test"; src: url("Test-400.ttf"); }\n');
  w(path.join(assets, "fonts", "Test-400.ttf"), "font");
  // the product book: the ids of backing.json read WORKS
  const state = (id) => (s.book && s.book[id]) || "WORKS";
  w(path.join(root, "book.md"), ["D3", "D4", "A1", "D6", "D10", "D8", "D1", "A20", "E14"].map((id) => `| ${id} | ${state(id)} | text |`).join("\n") + "\n");
  return { root, pewp, client, assets, book: path.join(root, "book.md"), spec: s };
}

const clientFor = (s, over = {}) => {
  const c = {
    contact: "none", alsoSearchedAs: [s.nick], nameWord: "alder bay", labels: { "roof repair": "Roof repair and patching" },
    words: { buyer: "homeowner", buyers: "homeowners", applicant: "caller", application: "quote form", apply: "ask for a quote", applies: "asks for a quote", pastCustomer: "happy customer", outcome: "jobs", offers: "emails", product: "job type", products: "job types", localRivals: "roofers", optionalNote: "with or without a second contact" },
    rivals: [{ domain: s.rivals[0].domain, name: null, type: "local roofer", group: "local" }, { domain: s.rivals[1].domain, name: "Harbor", type: "local gutter shop", group: "local" }, { domain: s.rivals[2].domain, name: null, type: "national roofer", group: "nat" }],
    adsFor: [s.rivals[0].domain, s.rivals[1].domain], linkPlace: "pinehollow-chamber.test", linkCompare: { group: "nat", label: "national roofers" },
    rivalsLede: "Alder Bay roofers and one national chain, then the rest.", promisePattern: "Quotes in \\d+ days?",
    handReads: { leadPath: "pewp:captures/reputation/lead.json", mail: "pewp:b/mail.json", domain: "here:domain.json", trust: "pewp:b/trust.json", trustKey: "alderbay", filing: "here:filing.md" },
  };
  const r = { ...c, ...over };
  for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
  return r;
};

// go(run, opts): starts the command as a child. opts.client = the client file's object (or a raw string), opts.words, opts.book, opts.assets (false = no argument)
function go(run, opts = {}) {
  const out = path.join(tmp, `out-${++seq}`);
  const cf = path.join(run.client, `client-copy-${seq}.json`);
  const content = opts.client === undefined ? { contact: "none" } : opts.client;
  w(cf, typeof content === "string" ? content : JSON.stringify(content, null, 1));
  const a = ["--max-old-space-size=256", path.join(dir, "client-copy.mjs"), `https://${run.spec.domain}/`, "--pewp", run.pewp, "--client-file", cf, "--out", out, "--book", opts.book || run.book];
  if (opts.assets !== false) a.push("--assets", opts.assets || run.assets);
  if (opts.words) a.push("--words", opts.words);
  if (opts.extra) a.push(...opts.extra);
  const r = spawnSync(process.execPath, a, { encoding: "utf8", timeout: 120000 });
  const files = fs.existsSync(out) ? fs.readdirSync(out) : [];
  const read = (re) => { const f = files.find((x) => re.test(x)); return f ? fs.readFileSync(path.join(out, f), "utf8") : ""; };
  return { status: r.status, stderr: r.stderr.trim(), stdout: r.stdout, out, files, html: read(/\.html$/), tsv: read(/\.tsv$/) };
}
const textOf = (html) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
const cleanText = (h) => h.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "");
const sheetRows = (tsv) => tsv.split("\n").slice(1).filter(Boolean).map((l) => l.split("\t"));
// a sheet row with this printed text, from a file ending so, whose "where in the file" holds this
const hasRow = (tsv, printed, fileEnd, where) => sheetRows(tsv).some((r) => r[2] === printed && r[3].endsWith(fileEnd) && r[4].includes(where));
const wholeChecks = (r, who) => {
  const bad = [];
  if (r.status !== 0) bad.push(`${who}: exit ${r.status}: ${r.stderr}`);
  if (!r.files.some((f) => /\.html$/.test(f)) || !r.files.some((f) => /^numbers-.*\.tsv$/.test(f))) bad.push(`${who}: files ${r.files}`);
  if ((r.html.match(/<section/g) || []).length !== 8) bad.push(`${who}: sections ${(r.html.match(/<section/g) || []).length}`);
  const m = /undefined|NaN|null|\[object|[{}]/.exec(cleanText(r.html));
  if (m) bad.push(`${who}: text holds ${m[0]} near ${JSON.stringify(cleanText(r.html).slice(Math.max(0, m.index - 40), m.index + 40))}`);
  if (!/sections: 8/.test(r.stdout) || !/wrote /.test(r.stdout)) bad.push(`${who}: stdout ${r.stdout}`);
  return bad;
};
const wordsOf = (s) => [s.name, s.short, s.domain, ...s.products, ...s.cityNames, ...s.rivals.flatMap((r) => [r.name, r.domain]), ...(s.nick ? [s.nick] : [])];
const copyWords = (edit) => { const d = path.join(tmp, `words-${++seq}`); fs.cpSync(path.join(skill, "client-copy"), d, { recursive: true }); edit(d); return d; };
const jedit = (d, f, fn) => { const p = path.join(d, f); const j = JSON.parse(fs.readFileSync(p, "utf8")); const r = fn(j); fs.writeFileSync(p, JSON.stringify(r === undefined ? j : r, null, 1)); };
const emptyOut = (r) => r.files.length === 0;
const planRows = (html) => { const t = (html.match(/<table class="plan">[\s\S]*?<\/table>/) || [""])[0]; return [...t.matchAll(/<tr[^>]*>((?:(?!<\/tr>)[\s\S])*)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((x) => x[1])).filter((c) => c.length); };

// ---------------------------------------------------------------- the 13 cases
try {
  const a0 = A(), b0 = B();
  const runA = makeRun(a0), runB = makeRun(b0);
  const cA = clientFor(a0), cB = { contact: "none" };
  const rA = go(runA, { client: cA }), rB = go(runB, { client: cB });
  const fmtL = (x) => x.toLowerCase();

  check("case 1: A builds whole (exit 0, the two files, 8 sections, no undefined / NaN / null / [object / braces in the text)",
    ...T(() => { const bad = wholeChecks(rA, "A"); if (!rA.files.includes("Alder-website-review-2026-11-13.html") || !rA.files.includes("numbers-2026-11-13.tsv")) bad.push(`names ${rA.files}`); return [bad.length === 0, bad.join(" | ")]; }));

  check("case 2: B (client file: only contact) builds whole, and nothing of one business is in the other's HTML or sheet",
    ...T(() => {
      const bad = wholeChecks(rB, "B");
      if (!rB.files.includes("Northgate-website-review-2026-11-13.html")) bad.push(`B names ${rB.files}`);
      const aAll = fmtL(rA.html + rA.tsv), bAll = fmtL(rB.html + rB.tsv);
      for (const x of wordsOf(a0)) if (bAll.includes(fmtL(x))) bad.push(`A's "${x}" is in B's output`);
      for (const x of wordsOf(b0)) if (aAll.includes(fmtL(x))) bad.push(`B's "${x}" is in A's output`);
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 3: the numbers of A are in the HTML by value and each has its sheet row naming the file and the field makeRun wrote",
    ...T(() => {
      const bad = [], h = rA.html, t = rA.tsv, s = a0;
      const expect = (cond, what) => { if (!cond) bad.push(what); };
      const label = { "roof repair": "Roof repair and patching", "roof replacement": "Roof replacement", "gutter installation": "Gutter installation" };
      expect(h.includes('<div class="num"><b>0 words</b>'), "cover words");
      expect(h.includes(`<div class="num"><b>${s.serpProductWithUs} of ${s.serpProductN}</b>`), "cover product searches");
      expect(h.includes('<div class="num"><b>0 of 36</b>'), "cover map points");
      expect(hasRow(t, "0 words", "pages/home/body.html", "words outside the tags"), "sheet: cover words");
      expect(hasRow(t, `${s.serpProductWithUs} of ${s.serpProductN}`, ".pewp/research/serp.json", "ourPosition"), "sheet: cover product searches");
      expect(hasRow(t, "0 of 36", ".pewp/local/2026-11-13/grid.json", "pointsIn3Pack"), "sheet: cover map points (the last evidence path, not the older grid)");
      // page 2
      expect(h.includes(`<b>${s.serpTotal}</b> results pages on Google and Bing`), "p2 results pages");
      expect(h.includes(`<b>${fmt(s.products.length + 2)}</b> searches with Bing's own estimate`), "p2 keywords");
      expect(h.includes(`<b>3</b> of 3 competitor sites read`), "p2 competitor sites");
      expect(h.includes(`<b>${s.planCaptures}</b> Google Maps points: 3 cities, 3 ${"job types"}, 36 points each`), "p2 map points");
      expect(h.includes(`<b>2</b> AI assistants asked the same 12 questions, plus <b>`) || h.includes(`<b>2</b> AI assistants asked the same 12 questions, plus ${s.aiCitations} `) || /<b>2<\/b> AI assistants asked the same 12 questions, plus/.test(h), "p2 ai");
      expect(hasRow(t, String(s.serpTotal), ".pewp/research/serp.json", "counts"), "sheet: p2 results pages");
      expect(hasRow(t, String(s.seedsN), ".pewp/research/autocomplete.json", "seeds"), "sheet: p2 seeds");
      // page 3: demand per product, biggest first
      const order = s.products.map((p, i) => ({ p, v: s.vol[i] })).sort((x, y) => y.v - x.v);
      for (const { p, v } of order) {
        expect(h.includes(`<tr><td>${label[p]}</td><td class="r">${fmt(v)}</td><td class="r state">None</td></tr>`), `p3 demand ${p}`);
        expect(hasRow(t, fmt(v), ".pewp/research/bing.json", `keywords[query=${p}&related=false].volume.value`), `sheet: demand ${p}`);
      }
      // page 5: grid cells (home: listed, first three; then each away city: first three)
      s.products.forEach((p, i) => {
        const cells = s.grid[i];
        const row = `<tr><td style="white-space:nowrap">${label[p]}</td><td class="r">${cells[0].inPack}</td><td class="r">${cells[0].in3}</td><td class="r">${cells[1].in3}</td><td class="r">${cells[2].in3}</td></tr>`;
        expect(h.includes(row), `p5 grid row ${p}`);
        expect(hasRow(t, String(cells[0].inPack), ".pewp/local/2026-11-13/grid.json", `solv[query=${p} ${s.home}].pointsInPack`), `sheet: grid ${p} listed`);
        expect(hasRow(t, String(cells[0].in3), ".pewp/local/2026-11-13/grid.json", `solv[query=${p} ${s.home}]`), `sheet: grid ${p} first three`);
      });
      // page 6: words, sitemap pages and linking sites per rival
      const shown = [["Ridgeline Roofs", 0, "local roofer"], ["Harbor", 1, "local gutter shop"], ["Summit Shingle Co", 2, "national roofer"]];
      for (const [name, i, type] of shown) {
        const st = s.rivalStats[i], links = s.rivalInGraph[i] ? fmt(st.links) : "none found";
        expect(h.includes(`<tr><td>${name}</td><td>${type}</td><td class="r">${fmt(st.words)}</td><td class="r">${fmt(st.sitemap)}</td><td class="r">${links}</td></tr>`), `p6 row ${name}`);
        expect(hasRow(t, fmt(st.words), ".pewp/research/competitors.json", `sites[domain=${s.rivals[i].domain}]`), `sheet: words ${name}`);
        expect(hasRow(t, fmt(st.sitemap), ".pewp/research/competitors.json", `sites[domain=${s.rivals[i].domain}]`), `sheet: sitemap ${name}`);
        expect(hasRow(t, links, ".pewp/authority.json", `results[domain=${s.rivals[i].domain}]`), `sheet: links ${name}`);
      }
      // page 3's phone seconds are the newest plain psi file's (A is not slow: a slow variant of A prints them)
      const slow = go(makeRun({ ...A(), phone: 3920, desk: 2110 }), { client: cA });
      expect(slow.status === 0 && slow.html.includes("appears after 3.9 s in Google's phone test (2.1 s on a computer)"), `p3 phone seconds from the newest plain file: ${slow.status} ${slow.stderr}`);
      expect(hasRow(slow.tsv, "3.9", ".pewp/psi/2026-11-13.json", "pages[strategy=mobile].lcpMs"), "sheet: phone seconds");
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 4: with research/bing.json removed: exit 1, the one STOP line, --out empty",
    ...T(() => { const r = go(makeRun({ ...A(), omit: ["research/bing.json"] }), { client: cA }); return [r.status === 1 && r.stderr === "STOP: .pewp/research/bing.json is missing" && emptyOut(r), `${r.status} ${JSON.stringify(r.stderr)} ${r.files}`]; }));

  check("case 5: a missing field and a product outside vocabulary each STOP with exit 1 and one line, --out empty",
    ...T(() => {
      const r1 = go(makeRun({ ...A(), patch: { "psi/2026-11-13.json": (j) => { delete j.pages[0].lcpMs; } } }), { client: cA });
      const r2 = go(makeRun({ ...A(), patch: { "approved/business.json": (j) => { j.vocabulary = ["roof repair", "roof replacement"]; } } }), { client: cA });
      const bad = [];
      if (!(r1.status === 1 && r1.stderr === "STOP: .pewp/psi/2026-11-13.json has no pages[strategy=mobile].lcpMs" && emptyOut(r1))) bad.push(`field: ${r1.status} ${JSON.stringify(r1.stderr)} ${r1.files}`);
      if (!(r2.status === 1 && r2.stderr === "STOP: .pewp/approved/business.json has no vocabulary entry gutter installation" && emptyOut(r2))) bad.push(`vocabulary: ${r2.status} ${JSON.stringify(r2.stderr)} ${r2.files}`);
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 6: contact null = draft, \"none\" = final and no contact line, text = printed in the dark box; no key or \"\" = exit 2, nothing written",
    ...T(() => {
      const bad = [], run = makeRun(A());
      const d = go(run, { client: { ...cA, contact: null } }), n = rA, t = go(run, { client: { ...cA, contact: "hello@alder-bay-roofing.test" } });
      const noKey = go(run, { client: (() => { const c = { ...cA }; delete c.contact; return c; })() }), empty = go(run, { client: { ...cA, contact: "" } });
      if (!(d.status === 0 && d.files.includes("Alder-website-review-2026-11-13-draft.html") && /<title>[^<]*\(draft\)<\/title>/.test(d.html))) bad.push(`null: ${d.status} ${d.files}`);
      if (!(n.files.includes("Alder-website-review-2026-11-13.html") && !/\(draft\)/.test(n.html) && !n.html.includes('<p class="contact">'))) bad.push("none");
      if (!(t.status === 0 && t.html.includes('<p class="contact">hello@alder-bay-roofing.test</p>') && !/-draft/.test(t.files.join()))) bad.push("text");
      for (const [nm, r] of [["no key", noKey], ["empty", empty]]) if (!(r.status === 2 && r.stderr.split("\n").length === 1 && r.stderr.startsWith("client-copy: ") && emptyOut(r))) bad.push(`${nm}: ${r.status} ${JSON.stringify(r.stderr)} ${r.files}`);
      return [bad.length === 0, bad.join(" | ")];
    }));

  const STEPS = [["Next", "We draft your website", "The whole site, built the right way for search, with everything in this review in place."], ["Then", "You take a look", "We send you the draft on a private link. Nothing on your current site changes."], ["Then", "It goes live", "Once you have looked it over, it goes live on your domain."], ["Then", "12 months", "We keep everything in place, check the numbers and report them to you."]];
  check("case 7: the standard copy is data: changed in a copy of client-copy/ it changes in the HTML; the real folder gives the four steps, goAhead and noOwnStatistics word for word",
    ...T(() => {
      const bad = [], h = rA.html;
      for (const [l, ti, tx] of STEPS) if (!h.includes(`<div><p class="label">${l}</p><b>${ti}</b><p>${tx}</p></div>`)) bad.push(`step ${ti}`);
      if (!h.includes('<p class="big">Tell us to start your draft.</p>')) bad.push("goAhead");
      if (!h.includes("Your own search statistics are not in this review. Once your domain is with us, we add it to our Search Console and report them to you.")) bad.push("noOwnStatistics");
      if (!h.includes("We can't promise a position on Google or a number of jobs.")) bad.push("promise");
      const wd = copyWords((d) => jedit(d, "standard-copy.json", (j) => { j.goAhead = "Say go and we begin."; j.nextSteps[1][1] = "You review it"; }));
      const r = go(makeRun(A()), { client: cA, words: wd });
      if (!(r.status === 0 && r.html.includes("Say go and we begin.") && r.html.includes("<b>You review it</b>") && !r.html.includes("Tell us to start your draft.") && !r.html.includes("You take a look"))) bad.push(`changed: ${r.status} ${r.stderr}`);
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 8: who and time are data; a row whose rule is false is absent and the headline counts the rows printed; an unknown placeholder STOPs",
    ...T(() => {
      const bad = [];
      const base = planRows(rA.html);
      if (!rA.html.includes("11 fixes, in the order")) bad.push("headline is not 11 fixes");
      if (rA.html.includes("Speed up the phone page")) bad.push("the phone row is printed though the phone is not slow");
      if (base.length !== 11) bad.push(`rows ${base.length}`);
      const wd = copyWords((d) => jedit(d, "fixes.json", (j) => { const row = j.find((x) => x.id === "analytics"); row.who = "Whoever holds the keys"; row.time = "A fortnight"; }));
      const r = go(makeRun(A()), { client: cA, words: wd });
      const mod = planRows(r.html), diff = [];
      base.forEach((row, i) => row.forEach((cell, k) => { if (mod[i] && mod[i][k] !== cell) diff.push(`${i}:${k}`); }));
      const at = base.findIndex((row) => /analytics tag/.test(row[1]));
      if (at < 0 || diff.join() !== `${at}:3,${at}:4` || !mod[at] || mod[at][3] !== "A fortnight" || mod[at][4] !== "Whoever holds the keys") bad.push(`diff ${diff.join()} at ${at}`);
      const wn = copyWords((d) => jedit(d, "fixes.json", (j) => { j[1].why = j[1].why + " {nope}"; }));
      const rn = go(makeRun(A()), { client: cA, words: wn });
      if (!(rn.status === 1 && /^STOP: fixes\.json row \S+ names \{nope\}$/.test(rn.stderr) && emptyOut(rn))) bad.push(`nope: ${rn.status} ${JSON.stringify(rn.stderr)} ${rn.files}`);
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 9: hand reads missing: no tile, sentence or plan row for them and one more line on page 2; with all five the line is absent and the fields tile shows the range",
    ...T(() => {
      const bad = [];
      const hr = { ...cA.handReads }; delete hr.leadPath; delete hr.mail;
      const r = go(makeRun(A()), { client: clientFor(a0, { handReads: hr }) });
      if (r.status !== 0) bad.push(`exit ${r.status} ${r.stderr}`);
      if (!r.html.includes("<li class=\"wide\">Not read in this review: the application form and mail records.</li>")) bad.push("the not-read line");
      if (/quote form/.test(r.html) || /sender record/.test(r.html) || /first step of the/.test(r.html)) bad.push("a sentence about the application or the mail records is printed");
      if (/<b>\d+ to \d+<\/b>/.test(r.html)) bad.push("the fields tile is printed");
      if (/Not read in this review/.test(rA.html)) bad.push("with all five the line is present");
      if (!rA.html.includes(`<div class="stat"><b>${a0.fieldsOne} to ${a0.fields}</b>`)) bad.push("the range");
      const rb = rB;
      if (!rb.html.includes("Not read in this review: the application form, mail records, the domain record, licence wording and the state filing.")) bad.push("B: all five missing");
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 10: a paid row of the map list is not among the rivals with more reviews; the sentence's two numbers are asserted",
    ...T(() => {
      const s = A(), h = rA.html, bad = [];
      const sentence = `2 of the 3 businesses Google Maps put in its first three around ${s.home} show more reviews`;
      if (!h.includes(sentence)) bad.push("p2 sentence");
      if (!h.includes(`2 of the 3 businesses in Maps' first three around ${s.home} show more reviews than your ${a0.reviews}.`)) bad.push("p5 sentence");
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 11: sentences picked by a rule keep their fallback (words sent, no broken link, away grid point, no rivals key, a book row PARTLY)",
    ...T(() => {
      const bad = [];
      const words = go(makeRun({ ...A(), body: "<html><body><p>Roofs of every kind</p></body></html>" }), { client: cA });
      if (!words.html.includes('<p class="lead">Your website is hard for search tools to read.</p>')) bad.push("plain cover sentence");
      if (!words.html.includes("<b>What it means:</b> some homeowners who search for your job types are shown other companies. <b>The fix</b> starts on your website.")) bad.push("cover what it means");
      const unbroken = go(makeRun({ ...A(), broken: false }), { client: cA });
      if (!unbroken.html.includes("<h2>Your site is hard for search tools to read.</h2>")) bad.push("plain summary headline");
      const awayRun = makeRun({ ...A(), patch: { "local/2026-11-13/grid.json": (j) => { j.solv[1].pointsIn3Pack = 5; } } });
      const away = go(awayRun, { client: cA });
      if (!away.html.includes("On Google Maps you are near the top for some job types and missing for others.") || away.html.includes("only, not for every product")) bad.push("page 5 fallback headline");
      const norivals = go(makeRun(A()), { client: (() => { const c = { ...cA }; delete c.rivals; delete c.rivalsLede; return c; })() });
      const need = ["Ridgeline Roofs", "Harbor Gutters", "Summit Shingle Co", "<td>roofing contractor</td>", "<td>gutter shop</td>", "The companies that show for your job types, the ones near you first."];
      for (const x of need) if (!norivals.html.includes(x)) bad.push(`no rivals key: lacks ${x}`);
      const partly = go(makeRun({ ...A(), book: { D8: "PARTLY" } }), { client: cA });
      const forms = "Your forms work without a script, and every enquiry lands in your lead list, with an email to the person who should act.";
      if (!rA.html.includes(forms)) bad.push("forms line missing in the normal run");
      if (partly.html.includes(forms)) bad.push("forms line printed with D8 PARTLY");
      if (!partly.html.includes("Each product gets its own page") && !partly.html.includes("Your site is built so every page sends its words")) bad.push("the other page 8 lines are gone");
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 12: an unknown key in the client file and an unknown argument are usage faults: exit 2, one line, nothing written",
    ...T(() => {
      const bad = [], run = makeRun(A());
      const r1 = go(run, { client: { ...cA, shoeSize: 9 } }), r2 = go(run, { client: cA, extra: ["--colour", "red"] }), r3 = go(run, { client: "{ not json" });
      for (const [nm, r] of [["unknown key", r1], ["unknown argument", r2], ["not JSON", r3]]) if (!(r.status === 2 && r.stderr.split("\n").length === 1 && r.stderr.startsWith("client-copy: ") && emptyOut(r))) bad.push(`${nm}: ${r.status} ${JSON.stringify(r.stderr)} ${r.files}`);
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 13: the assets folder: a font file the css names must exist (STOP, exit 1); with no --assets the skill's own assets/client-copy/ is used",
    ...T(() => {
      const bad = [], run = makeRun(A());
      fs.writeFileSync(path.join(run.assets, "fonts", "fonts.css"), '@font-face { src: url("Test-400.ttf"); }\n@font-face { src: url("Missing-700.ttf"); }\n');
      const a = go(run, { client: cA });
      if (!(a.status === 1 && a.stderr === "STOP: assets fonts/Missing-700.ttf is missing" && emptyOut(a))) bad.push(`(a) ${a.status} ${JSON.stringify(a.stderr)} ${a.files}`);
      const b = go(makeRun(A()), { client: cA, assets: false });
      if (!(b.status === 0 && /assets\/client-copy\/fonts\/fonts\.css/.test(b.html))) bad.push(`(b) ${b.status} ${JSON.stringify(b.stderr)} (red for this reason only if ${path.join(skill, "assets", "client-copy")} is not there yet: ${fs.existsSync(path.join(skill, "assets", "client-copy", "fonts", "fonts.css"))})`);
      return [bad.length === 0, bad.join(" | ")];
    }));
  check("case 14: an address is cut only before \", <home city>\" (a line that names no city stays whole), and the sentence after \"Show one address everywhere.\" names the sources short",
    ...T(() => {
      const bad = [], h = rA.html;
      if (!h.includes("Tell us the right one, then make the website, Google, Bing and the state filing agree.")) bad.push(`sentence: ${(h.match(/Tell us the right one[^<]*/) || ["none"])[0]}`);
      if (!h.includes("<td>Your website and Google Maps</td>")) bad.push("the table labels changed");
      const r = go(makeRun({ ...A(), gAddr: "14 Cedar Row, Ste 4, Alder Bay, WA 00000", fAddr: "31 Quarry Lane, Ste B2 #111" }), { client: cA });
      if (r.status !== 0) bad.push(`exit ${r.status} ${r.stderr}`);
      if (!r.html.includes("<td>State filing</td><td>31 Quarry Lane, Ste B2 #111</td>")) bad.push("the filing line is not whole on page 5");
      if (!r.html.includes("<td>Google Maps</td><td>14 Cedar Row, Ste 4</td>")) bad.push("the profile address");
      if (!sheetRows(r.tsv).some((x) => x[3].endsWith("filing.md") && x[2] === "31 Quarry Lane, Ste B2 #111" && x[5] === "31 Quarry Lane, Ste B2 #111")) bad.push("the sheet's value there");
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 15: page 6 says \"rivals\" in the small-rivals bullet (localRivals only in the plan line) and the compared group ends with \"above\"",
    ...T(() => {
      const h = rA.html, bad = [];
      if (!h.includes("Your Alder Bay rivals are small: Ridgeline Roofs and Harbor send")) bad.push("rivals word, the colon, one space and the first name");
      if (h.includes("Your Alder Bay roofers are small")) bad.push("localRivals in the bullet");
      if (!h.includes("link to the 1 national roofers above.")) bad.push("above");
      if (!h.includes("level with the Alder Bay roofers within weeks")) bad.push("localRivals in the plan line");
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 16: the directories follow the order of directories.json (the others after, in the capture file's order), in the table and in both claim clauses",
    ...T(() => {
      const bad = [];
      const cites = [["manta.com", "not listed"], ["zzz-local.test", "not listed"], ["yelp.com", "listed"], ["apple.com (Apple Maps)", "not listed"], ["bing.com (Bing Places)", "listed", true]];
      const r = go(makeRun({ ...A(), cites }), { client: cA });
      if (r.status !== 0) bad.push(`exit ${r.status} ${r.stderr}`);
      const at = ["Bing Places", "Apple Maps", "Yelp", "Manta", "zzz-local"].map((n) => r.html.indexOf(`<tr><td>${n}</td><td class="r state">`));
      if (at.some((x) => x < 0) || at.some((x, i) => i && x < at[i - 1])) bad.push(`table order ${at}`);
      if (!r.html.includes("then claim Apple Maps, Manta and zzz-local.")) bad.push("page 5 clause");
      if (!r.html.includes("; claim Apple Maps, Manta and zzz-local")) bad.push("plan clause");
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 17: every printed row of the plan has at least one sheet row of page 7",
    ...T(() => {
      const bad = [];
      const all = JSON.parse(fs.readFileSync(path.join(skill, "client-copy", "fixes.json"), "utf8"));
      for (const row of all.filter((x) => x.id !== "speed")) {
        const wd = copyWords((d) => jedit(d, "fixes.json", () => [row]));
        const r = go(makeRun(A()), { client: cA, words: wd });
        if (r.status !== 0) { bad.push(`${row.id}: exit ${r.status} ${r.stderr}`); continue; }
        if (planRows(r.html).length !== 1) bad.push(`${row.id}: printed ${planRows(r.html).length} rows`);
        else if (!sheetRows(r.tsv).some((x) => x[0] === "7")) bad.push(`${row.id}: no sheet row of page 7`);
      }
      return [bad.length === 0, bad.join(" | ")];
    }));
  check("case 18: a row of the plan whose finding does not hold is left out (one address, words sent, a fast phone, no broken link); the rows that hold are there; the headline counts them",
    ...T(() => {
      const bad = [];
      const one = "14 Cedar Row, Alder Bay, WA";
      const r = go(makeRun({ ...A(), siteAddr: one, gAddr: one, bAddr: one, fAddr: one, body: "<html><body><p>Roofs of every kind</p></body></html>", broken: false, phone: 2210 }), { client: cA });
      bad.push(...wholeChecks(r, "C"));
      const rows = planRows(r.html), fixes = rows.map((x) => x[1]);
      const has = (start) => fixes.some((f) => f.startsWith(start));
      for (const start of ["Send the words in the first response", "One address everywhere", "Speed up the phone page", "Fix the link to your site on"]) if (has(start)) bad.push(`printed though its finding does not hold: ${start}`);
      for (const start of ["Add one analytics tag", "Ask for less in the first step", "Build the gutter installation page", "Build the other 1 job type pages", "Fix the email records", "Publish your company history", "Join the Alder Bay chambers", "Name your 3 profiles"]) if (!has(start)) bad.push(`missing though its finding holds: ${start}`);
      const n = (r.html.match(/<h2>(\d+) fixes?, in the order/) || [])[1];
      if (Number(n) !== rows.length || rows.length !== 8) bad.push(`headline ${n}, table rows ${rows.length}`);
      if (r.html.includes("Show one address everywhere.")) bad.push("page 5 prints the one-address fix");
      return [bad.length === 0, bad.join(" | ")];
    }));
  check("case 19: a rival whose Google ad library page was not tied to it is left out of the ads sentence and never stops the build",
    ...T(() => {
      const bad = [];
      const untied = (j) => { j.rows[0] = { advertiser: j.rows[0].advertiser, library: "google-transparency", status: "blocked", blocked: "page not tied to the business", running: null, adCount: null, since: null, runningDays: null, formats: [], url: j.rows[0].url }; };
      const r = go(makeRun({ ...A(), patch: { "research/ads.json": untied } }), { client: cA });
      bad.push(...wholeChecks(r, "A"));
      const text = cleanText(r.html), sentence = (text.match(/ad library shows [^.]*\./) || [""])[0];
      if (!text.includes("ad library shows none for Harbor in the last 30 days")) bad.push(`sentence: ${sentence || "(none)"}`);
      if (sentence.includes("Ridgeline Roofs")) bad.push(`the rival whose page was not tied is named: ${sentence}`);
      return [bad.length === 0, bad.join(" | ")];
    }));
} catch (e) {
  check("test harness ran to the end", false, e.stack || e);
}
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((f) => f.name).join(" | ") : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
