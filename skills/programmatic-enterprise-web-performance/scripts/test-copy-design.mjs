// Usage: node test-copy-design.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of client-copy-design.mjs (the approved design of the client copy: frame, cover, page 2) and of what it reads, on two INVENTED
// businesses built in a temporary folder: the new data keys of client-copy-data.mjs behind cfg.newCopy, the two new client-file keys of
// client-copy.mjs, the pages in process. No network, no browser, no repository file is read except the skill's own client-copy/ folder.
// --mutants: watched-fail. Copies the skill, breaks one thing at a time, runs this test against the copy and requires the named
//   case to go red (green = the case measures nothing, or the patch never applied; a `from` that occurs other than once is refused).
// Exit 0 = all pass.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : here);
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const MUT = [
    { id: "f01-outside-guard-off", file: "client-copy-design.mjs", from: 'if (!sv.outside || ', to: "if (false || ", red: "case 9:" },
    { id: "f02-engines-guard-off", file: "client-copy-design.mjs", from: ' || [...sv.engines].sort().join() !== "bing,google")', to: ")", red: "case 9:" },
    { id: "f03-verdict-guard-off", file: "client-copy-design.mjs", from: "if (!(sv.productWithUs < sv.product))", to: "if (false)", red: "case 9:" },
    { id: "f04-rival-sites-guard-off", file: "client-copy-design.mjs", from: "if (D.sitesRead.read === 0)", to: "if (false)", red: "case 9:" },
    { id: "f05-chatgpt-guard-off", file: "client-copy-design.mjs", from: "if (!(chat.named > 0))", to: "if (false)", red: "case 9:" },
    { id: "f06-works-already-guard-off", file: "client-copy-design.mjs", from: "if (!F.length)", to: "if (false)", red: "case 9:" },
    { id: "f07-bing-guard-off", file: "client-copy-design.mjs", from: 'if (!bing || bing.status !== "listed")', to: "if (false)", red: "case 9:" },
    { id: "f08-every-page-guard-off", file: "client-copy-design.mjs", from: "if (pp.listed >= pp.of)", to: "if (false)", red: "case 9:" },
    { id: "f09-ai-every-question-guard-off", file: "client-copy-design.mjs", from: "if (perp.named >= perp.questions || D.googleAi.named >= D.googleAi.total)", to: "if (false)", red: "case 9:" },
    { id: "f10-away-guard-off", file: "client-copy-design.mjs", from: "if (!away.length || awayTop >= awayOf)", to: "if (false)", red: "case 9:" },
    { id: "f11-two-products-guard-off", file: "client-copy-design.mjs", from: "if (D.demand.length < 2)", to: "if (false)", red: "case 9:" },
    { id: "f12-page-gets-sheet-class", file: "client-copy-design.mjs", from: 'class="pg" id="p${n}"', to: 'class="pg sheet" id="p${n}"', red: "case 5:" },
    { id: "f13-cite-keeps-every-source", file: "client-copy-design.mjs", from: ".filter((s) => !pick || s.where.includes(pick) || s.value.includes(pick))", to: ".filter(() => true)", red: "case 7:" },
    { id: "f14-sum-has-no-total-row", file: "client-copy-design.mjs", from: "calc(fmt(t), label, ", to: "void (fmt(t), label, ", red: "case 7:" },
    { id: "f15-works-already-too-wide", file: "client-copy-design.mjs", from: 'const F = T.rows.filter((r) => r.cells[0].counts["top three"] === r.cells[0].points);', to: 'const F = T.rows.filter((r) => r.cells[0].counts["top three"] > 0);', red: "case 7:" },
    { id: "f16-plan-n-unchecked", file: "client-copy-data.mjs", from: "if (n !== 3) stop(", to: "if (false) stop(", red: "case 4:" },
    { id: "f17-top-three-unchecked", file: "client-copy-data.mjs", from: 'if (t.counts["top three"] !== s.in3) stop(', to: "if (false) stop(", red: "case 4:" },
    { id: "f18-in-list-unchecked", file: "client-copy-data.mjs", from: 'if (t.counts["top three"] + t.counts.listed !== s.inPack) stop(', to: "if (false) stop(", red: "case 4:" },
    { id: "f19-flag-always-on", file: "client-copy-data.mjs", from: "if (cfg.newCopy) {", to: "if (true) {", red: "case 2:" },
    { id: "f20-client-key-not-accepted", file: "client-copy.mjs", from: '"handReads", "unconfirmedNames"];', to: '"handReads"];', red: "case 1:" },
    { id: "f21-other-kind-word-not-accepted", file: "client-copy.mjs", from: ', otherKind: "another business" };', to: " };", red: "case 1:" },
    { id: "f22-unconfirmed-names-unchecked", file: "client-copy.mjs", from: '"adsFor", "unconfirmedNames"]) if', to: '"adsFor"]) if', red: "case 1:" },
    { id: "f23-missing-value-printed", file: "client-copy-design.mjs", from: "const P = (key, shown, label, pick) => { if (miss(shown)) stop(", to: "const P = (key, shown, label, pick) => { if (false) stop(", red: "case 9:" },
    { id: "f24-missing-addend-summed", file: "client-copy-design.mjs", from: "if (miss(v)) stop(", to: "if (false) stop(", red: "case 9:" },
    { id: "f25-assistant-not-ok-unchecked", file: "client-copy-data.mjs", from: 'if (!["chatgpt", "perplexity"].every(', to: 'if (false && !["chatgpt", "perplexity"].every(', red: "case 4:" },
    // @@MUT (job R2b adds its seeded faults above this line; keep it verbatim)
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
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-copy-design.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
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
  s.grid = P.map((_, i) => C.map((_, j) => (j === 0 ? [{ inPack: 9, in3: 9 }, { inPack: 7, in3: 4 }, { inPack: 9, in3: 9 }][i % 3] : { inPack: 2 * j + i, in3: 0 })));
  s.per = 9;
  s.planCaptures = P.length * C.length * 9;
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
  s.aiQuestions = 3;
  const named = { chatgpt: [true, false, true], perplexity: [false, false, true] };
  for (const e of ["chatgpt", "perplexity"]) q.forEach((qq, i) => { const f = `${e}-${i}.json`; aiRows.push({ engine: e, status: "ok", file: f, type: i < 2 ? "buyer" : "brand", named: named[e][i], question: qq }); wp(`captures/ai/${f}`, { capturedAt: "2026-11-12T10:00:00.000Z", signedIn: true }); });
  for (const e of ["copilot", "gemini"]) aiRows.push({ engine: e, status: "blocked", file: `${e}.json` });
  wp("research/ai-answers.json", { generatedAt: "2026-11-13T07:04:00.000Z", summary: { engines: [{ engine: "chatgpt", status: "ok", questions: 3, named: 2 }, { engine: "perplexity", status: "ok", questions: 3, named: 1 }, { engine: "copilot", status: "blocked", questions: 0, named: 0 }, { engine: "gemini", status: "blocked", questions: 0, named: 0 }], blockedEngines: [{ engine: "copilot", reason: "asks for a sign in" }, { engine: "gemini", reason: "asks for a sign in" }], questions: 6, competitors: [{ name: s.rivals[0].name, count: 9 }, { name: s.rivals[1].name, count: 6 }, { name: s.rivals[2].name, count: 3 }] }, rows: aiRows });
  wp("research/ai-citations.json", { generatedAt: "2026-11-13T07:05:00.000Z", rows: s.qNames.map((question, i) => ({ engine: "google-ai-overview", question, ourNameMentionedShare: { value: s.shares[i] } })) });
  s.aiCitations = s.qNames.length;
  // the grid: an older one (other values) and the one the step's last evidence names
  const mkGrid = (shift) => ({
    date: shift ? "2026-11-12" : s.date, plan: { n: 3, spacingKm: s.key === "A" ? 2.5 : 1.5, captures: s.planCaptures }, summary: { localized: s.planCaptures },
    solv: P.flatMap((p, i) => C.map((c, j) => ({ query: `${p} ${c.split(",")[0]}`, city: c, points: 9, pointsInPack: s.grid[i][j].inPack + shift, pointsIn3Pack: s.grid[i][j].in3 + shift }))),
    points: shift ? [] : P.flatMap((p, i) => C.flatMap((c, j) => Array.from({ length: 9 }, (_, k) => ({ query: `${p} ${c.split(",")[0]}`, city: c, pointId: `${i}-${j}-${k}`, row: Math.floor(k / 3) + 1, col: (k % 3) + 1, packSize: 3, position: { value: k < s.grid[i][j].in3 ? 1 + (k % 3) : k < s.grid[i][j].inPack ? 4 + (k % 2) : null }, ours: { name: s.name }, top3: i === 0 ? [{ name: s.name, reviews: s.reviews }, { name: "Hilltop Rival One", reviews: s.reviews + 200 }, { name: "Ad \u00b7 Hilltop Ads", reviews: 9999 }] : i === 1 ? [{ name: "Hilltop Rival Two", reviews: s.reviews + 77 }, { name: "Hilltop Rival Three", reviews: s.reviews - 30 }, { name: "Hilltop Rival Four" }] : [{ name: "Hilltop Rival One", reviews: s.reviews + 200 }] })))),
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

// ---------------------------------------------------------------- what the cases need: words, the data layer's config, the pages, two runs
const W0 = { buyer: "buyer", buyers: "buyers", applicant: "enquirer", application: "enquiry form", apply: "get in touch", applies: "gets in touch", pastCustomer: "past customer", outcome: "customers", offers: "messages", product: "service", products: "services", localRivals: "businesses", optionalNote: "with or without its optional part", otherKind: "another business" };
const cfgOf = (run, client, newCopy) => ({ pewp: run.pewp, snapAbs: path.join(path.dirname(run.pewp), "snapshots", "2026-11-10-2"), snapRel: "snapshots/2026-11-10-2", client, hand: { leadPath: null, mail: null, domain: null, trust: null, filing: null }, bookAbs: run.book, backingAbs: path.join(skill, "client-copy", "backing.json"), dirNames: JSON.parse(fs.readFileSync(path.join(skill, "client-copy", "directories.json"), "utf8")), newCopy });
const std = JSON.parse(fs.readFileSync(path.join(skill, "client-copy", "standard-copy.json"), "utf8"));
const ctxOf = (col, client) => ({ D: col.D, S: col.S, fmt: col.fmt, w: { ...W0, ...(client.words || {}) }, std, client, draft: true, contact: null, notRead: [], fixes: [], logoUrl: "file:///logo.png", fontsUrl: "file:///fonts.css" });
const { collect } = await import(pathToFileURL(path.join(dir, "client-copy-data.mjs")).href + "?" + Math.random());
let DM = null;
try { DM = await import(pathToFileURL(path.join(dir, "client-copy-design.mjs")).href + "?" + Math.random()); } catch {}
const bp = (col, client) => DM.buildPages(ctxOf(col, client));
const stopOf = (fn) => { try { fn(); return ""; } catch (e) { return e.isStop ? e.message : "NOT A STOP: " + e.message; } };
const built = (col, client) => { try { return { r: bp(col, client) }; } catch (e) { return { err: e.stack || String(e) }; } };

const runA = makeRun(A()), sA = runA.spec, clientA = clientFor(sA);
const runB = makeRun(B()), sB = runB.spec;
const clientB = clientFor(sB, { rivals: undefined, adsFor: undefined, linkPlace: undefined, linkCompare: undefined, rivalsLede: undefined, promisePattern: undefined, handReads: undefined, alsoSearchedAs: undefined, nameWord: "northgate family dental", labels: undefined });
let colA = null, colB = null;
try { colA = collect(cfgOf(runA, clientA, true)); colB = collect(cfgOf(runB, clientB, true)); } catch (e) { console.log("SETUP: " + e.message); }
const bA = built(colA, clientA), bB = built(colB, clientB);
const WA = clientA.words;
const lowerFirst = (s) => s.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase());
const upFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const andL = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
// the products in the order of demand (Bing volume, highest first), with the label the client file gives
const order = (s, client) => s.products.map((p, i) => { const lab = (client.labels && client.labels[p]) || upFirst(p); return { p, i, lab, lower: lowerFirst(lab), vol: s.vol[i] }; }).sort((a, b) => b.vol - a.vol);
const pageRows = (tsv, n) => sheetRows(tsv).filter((r) => r[0] === String(n));
// the [label, printed] list that page 2 must put on the sheet, in the order of the calls, from the spec alone
const rows2 = (s, client) => {
  const d = order(s, client), F = d.filter((x) => s.grid[x.i][0].in3 === 9), away = s.cityNames.slice(1), home = s.home, R = [];
  const Fl = andL(F.map((f) => f.lower)), al = andL(away);
  const sumRows = (label, parts) => { for (const [pl, v] of parts) R.push([`${label} (addend: ${pl})`, fmt(v)]); R.push([label, fmt(parts.reduce((t, x) => t + x[1], 0))]); };
  sumRows(`${home} spots in the top three, ${Fl}`, F.map((f) => [f.lower, s.grid[f.i][0].in3]));
  sumRows(`${home} spots read, ${Fl}`, F.map((f) => [f.lower, 9]));
  R.push(["Google rating", s.rating.toFixed(1)], ["Google reviews", fmt(s.reviews)]);
  R.push([`${home} spots in the top three (sum)`, `${F.reduce((t, f) => t + s.grid[f.i][0].in3, 0)} of ${F.length * 9}`]);
  R.push(["ChatGPT questions that name you", "2 of 3"], ["searches for your name where your site is first", `${s.serpName.filter((x) => x === 1).length} of ${s.serpName.length}`], ["Bing Places", "Listed"]);
  const aw = d.flatMap((x) => away.map((c, j) => [`${x.lab}, ${c}`, s.grid[x.i][j + 1].in3]));
  sumRows(`${al} spots in the top three`, aw);
  sumRows(`${al} spots read`, aw.map((x) => [x[0], 9]));
  const listed = s.products.length - s.missing.length;
  if (listed > 0) R.push([`${WA.products} listed`, fmt(listed)]);
  R.push([WA.products, fmt(s.products.length)], ["Perplexity questions that name you", "1 of 3"], ["Google AI answers that name you", `${s.shares.filter((x) => x > 0).length} of ${s.shares.length}`]);
  R.push(["away spots in the top three", `${aw.reduce((t, x) => t + x[1], 0)} of ${fmt(away.length * d.length * 9)}`]);
  for (const x of d) R.push([`Bing demand, ${x.lab}`, fmt(x.vol)], [`page of its own, ${x.lab}`, s.missing.includes(x.p) ? "No page" : "Listed"]);
  const days = Math.round((Date.parse(s.rangeTo) - Date.parse(s.rangeFrom)) / 86400000);
  R.push(["rating", s.rating.toFixed(1)], [`${WA.product} searches that show you`, `${s.serpProductWithUs} of ${s.serpProductN}`], ["days", fmt(days)], [`share of demand, ${d[0].lab}`, `${Math.round((100 * Math.max(...s.vol)) / s.vol.reduce((a, b) => a + b, 0))}%`]);
  return R;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- the 9 cases
{ const [ok, detail] = T(() => {
  const bad = [];
  const good = go(runA, { client: clientFor(sA, { words: { ...clientFor(sA).words, otherKind: "another roofer" }, unconfirmedNames: ["x.test"] }) });
  if (good.status !== 0) bad.push(`good file: exit ${good.status}: ${good.stderr}`);
  const no = (name, over) => { const r = go(runA, { client: clientFor(sA, over) }); if (r.status !== 2) bad.push(`${name}: exit ${r.status}: ${r.stderr}`); };
  no("otherKind empty", { words: { ...clientFor(sA).words, otherKind: "" } });
  no("unconfirmedNames a text", { unconfirmedNames: "x.test" });
  no("unconfirmedNames [1]", { unconfirmedNames: [1] });
  return [bad.length === 0, bad.join(" | ")];
}); check("case 1: THE COMMAND takes words.otherKind and unconfirmedNames (a text and a list of texts), refuses an empty one, a text and a list of numbers", ok, detail); }

{ const [ok, detail] = T(() => {
  const off = collect(cfgOf(runA, clientA, false)), bad = [];
  for (const k of ["nPages", "nPoints", "aiAsked", "mapTiles"]) if (k in off.D) bad.push(`flag off: D.${k} is there`);
  const on = collect(cfgOf(runA, clientA, true));
  if (on.D.nPages !== sA.serpTotal) bad.push(`nPages ${on.D.nPages}`);
  if (on.D.nPoints !== 81) bad.push(`nPoints ${on.D.nPoints}`);
  if (on.D.aiAsked !== 2) bad.push(`aiAsked ${on.D.aiAsked}`);
  const ends = { nPages: ".pewp/research/serp.json", nPoints: ".pewp/local/2026-11-13/grid.json", aiAsked: ".pewp/research/ai-answers.json", mapTiles: ".pewp/local/2026-11-13/grid.json" };
  for (const [k, e] of Object.entries(ends)) if (!(on.S[k] || []).some((x) => x.file.endsWith(e))) bad.push(`S.${k} has no source ending ${e}`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 2: THE FLAG: cfg.newCopy false adds no new key; true adds nPages, nPoints, aiAsked and mapTiles, each with a source in its file", ok, detail); }

{ const [ok, detail] = T(() => {
  const bad = [], M = colA.D.mapTiles, ord = order(sA, clientA).map((x) => x.p);
  if (!same(M.rows.map((r) => r.key), ord)) bad.push(`rows ${M.rows.map((r) => r.key)}`);
  if (!same(M.cities, sA.cityNames)) bad.push(`cities ${M.cities}`);
  M.rows.forEach((r) => { const i = sA.products.indexOf(r.key); r.cells.forEach((c, j) => { const g = sA.grid[i][j]; if (c.counts["top three"] !== g.in3 || c.counts.listed !== g.inPack - g.in3 || c.counts.absent !== 9 - g.inPack) bad.push(`${r.key}/${c.city} ${JSON.stringify(c.counts)}`); }); });
  const h1 = M.rows.find((r) => r.key === sA.products[1]).cells[0];
  if (!same(h1.tile, [["top three", "top three", "top three"], ["top three", "listed", "listed"], ["listed", "absent", "absent"]])) bad.push(`tile ${JSON.stringify(h1.tile)}`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 3: THE TILES: rows in the order of demand, the home city first, every cell's counts equal the run's, the home tile of product 1 is the one its points draw", ok, detail); }

{ const [ok, detail] = T(() => {
  const bad = [];
  const stopRun = (patch) => { const r = makeRun({ ...A(), patch: { "local/2026-11-13/grid.json": patch } }); return stopOf(() => collect(cfgOf(r, clientFor(r.spec), true))); };
  const want = (name, got, text) => { if (!got.startsWith("STOP: ") || !got.includes(text)) bad.push(`${name}: ${got || "(built)"}`); };
  want("plan.n 4", stopRun((j) => { j.plan.n = 4; j.solv.forEach((x) => { x.points = 16; }); }), "has plan.n 4");
  want("pointsIn3Pack", stopRun((j) => { j.solv[0].pointsIn3Pack += 1; }), "pointsIn3Pack is");
  want("pointsInPack", stopRun((j) => { j.solv[0].pointsInPack += 1; }), "pointsInPack is");
  want("no position", stopRun((j) => { delete j.points[3].position; }), "STOP: .pewp/local/2026-11-13/grid.json has no points[3].position");
  want("row 4", stopRun((j) => { j.points[3].row = 4; }), "row and column");
  const r = makeRun({ ...A(), patch: { "research/ai-answers.json": (j) => { j.summary.engines[1].status = "blocked"; } } });
  want("perplexity not ok", stopOf(() => collect(cfgOf(r, clientFor(r.spec), true))), "has no summary.engines with status ok for both chatgpt and perplexity");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 4: THE DATA STOPS: plan.n 4, a solv count that its points do not show (top three, in the list), a point without position, a point outside the 3 by 3, an assistant not ok", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  const { html, pages } = bA.r, bad = [], css = (html.match(/<style>([\s\S]*?)<\/style>/) || ["", ""])[1];
  const n = (re) => (html.match(re) || []).length;
  if (n(/<section class="cover" id="p1">/g) !== 1) bad.push("cover");
  if (n(/<section class="pg" id="p2">/g) !== 1) bad.push("page 2");
  if (n(/<section class="(?:cover|pg)"/g) !== 2 || pages !== 2) bad.push(`count ${n(/<section class="(?:cover|pg)"/g)} / ${pages}`);
  if (html.includes('class="cover sheet"')) bad.push("cover sheet");
  if (html.includes("@@")) bad.push("an anchor in the html");
  if (n(/<img/g) !== 1 || !html.includes('<img class="logo"')) bad.push("images");
  for (const t of ['<link href="file:///fonts.css"', "Prepared by Omnikom", "2 / 2", "SEO, AI search and local audit, November 2026", "section.cover{"]) if (!html.includes(t)) bad.push(`no ${t}`);
  if (/[\u2014\u2013]/.test(html)) bad.push("a dash");
  if (/\.sheet\b/.test(css)) bad.push(".sheet in the css");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 5: THE FRAME: a cover and a page, the pdf script's section count, no sheet class, no anchor, one image, the font link, the footer, no dash", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  const rows = pageRows(bA.r.tsv, 1), got = rows.map((r) => [r[1], r[2]]);
  const want = [[`${WA.product} searches that show your site (of the results pages read)`, `${sA.serpProductWithUs} of ${sA.serpProductN}`], [`${WA.products} with a page of their own`, "0 of 3"], ["words in the first response", "0 words"], ["results pages read", fmt(sA.serpTotal)], ["Maps spots read", "81"], ["rival sites read", "3"], ["AI assistants asked", "2"], ["month of the audit", "November 2026"]];
  const bad = [];
  if (!same(got, want)) bad.push(`rows ${JSON.stringify(got)}`);
  if (rows.some((r) => r.length !== 8 || r.some((c) => c === ""))) bad.push("a row has an empty cell");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 6: PAGE 1 ROWS: the 8 values of the cover, one row each, in order, 8 filled cells", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  const rows = pageRows(bA.r.tsv, 2), got = rows.map((r) => [r[1], r[2]]), want = rows2(sA, clientA), bad = [];
  if (!same(got, want)) bad.push(`rows ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  const groups = {};
  rows.forEach((r) => { const m = /^(.*) \(addend: /.exec(r[1]); if (m) groups[m[1]] = (groups[m[1]] || 0) + 1; });
  if (!same(Object.values(groups), [2, 2, 6, 6])) bad.push(`addends ${JSON.stringify(groups)}`);
  const totals = new Set([...Object.keys(groups), `${sA.home} spots in the top three (sum)`, "away spots in the top three"]);
  rows.forEach((r) => { if (totals.has(r[1]) !== (r[3] === "(computed)")) bad.push(`file of ${r[1]}: ${r[3]}`); });
  const chat = rows.find((r) => r[1] === "ChatGPT questions that name you");
  if (!chat || chat[4] !== "summary.engines[engine=chatgpt].questions/named") bad.push(`chatgpt where ${chat && chat[4]}`);
  const keys = rows.map((r) => [r[1], r[2], r[4]].join("|"));
  if (new Set(keys).size !== keys.length) bad.push("two rows alike");
  if (rows.some((r) => r.length !== 8 || r.some((c) => c === ""))) bad.push("a row has an empty cell");
  return [bad.length === 0, bad.join(" | ")];
}); check("case 7: PAGE 2 ROWS: every drawn value one row in the order of the calls, a sum one row per addend and a total from (computed), the pick keeps one source, no two rows alike", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  if (bB.err) return [false, bB.err];
  const bad = [], tA = cleanText(bA.r.html), tB = cleanText(bB.r.html);
  if (!tA.includes("job types") || /product/i.test(tA)) bad.push("the words on run A");
  if (!tA.includes("for gutter installation and for roof repair and patching")) bad.push("the F line of run A");
  if (!tA.includes("Pine Hollow and Stonebrook")) bad.push("the away list of run A");
  if (!tB.includes("for teeth cleaning") || tB.includes(" and for ")) bad.push("the F line of run B");
  if (!tB.includes("Elm Ridge")) bad.push("the away list of run B");
  const got = pageRows(bB.r.tsv, 2).map((r) => [r[1], r[2]]);
  if (!same(got, rows2(sB, clientB))) bad.push(`rows of run B ${JSON.stringify(got)}`);
  const adds = got.filter((r) => /\(addend: /.test(r[0])).length;
  if (adds !== 1 + 1 + 2 + 2) bad.push(`addends ${adds}`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 8: WORDS AND THE OTHER RUN: the client's words, the two products that work, the away cities; run B gives 1, 1, 2 and 2 addends", ok, detail); }

{ const [ok, detail] = T(() => {
  if (bA.err) return [false, bA.err];
  const bad = [];
  const g = (name, col, client, edit, text) => { const D2 = structuredClone(col.D); edit(D2); const got = stopOf(() => bp({ ...col, D: D2 }, client)); if (!got.startsWith("STOP: ") || !got.includes(text)) bad.push(`${name}: ${got || "(built)"}`); };
  g("g1a", colA, clientA, (D) => { D.serp.outside = false; }, "read from outside your area");
  g("g1b", colA, clientA, (D) => { D.serp.engines = ["google", "bing", "x"]; }, "read from outside your area");
  g("g2", colA, clientA, (D) => { D.serp.productWithUs = D.serp.product; }, "shown other companies");
  g("g3", colA, clientA, (D) => { D.sitesRead.read = 0; }, "no rival site was read");
  g("g4", colA, clientA, (D) => { D.ai.chat.named = 0; }, "names the business on no question");
  g("g5", colA, clientA, (D) => { D.mapTiles.rows.forEach((r) => { r.cells[0].counts["top three"] = 0; }); }, `has every ${sA.home} spot`);
  g("g6", colA, clientA, (D) => { D.directories.find((r) => /bing/i.test(r.directory)).status = "not listed"; }, "Bing directory is not listed");
  g("g7", colA, clientA, (D) => { D.productPages.listed = D.productPages.of; }, "has a page");
  g("g8", colA, clientA, (D) => { D.ai.perp.named = D.ai.perp.questions; }, "names the business on every question");
  g("g9", colA, clientA, (D) => { D.mapTiles.cities = [D.mapTiles.cities[0]]; }, "there is none");
  g("g10", colA, clientA, (D) => { D.demand = D.demand.slice(0, 1); }, "fewer than two products");
  g("g11", colA, clientA, (D) => { D.rating.reviews = null; }, "Google reviews: the value is missing");
  g("g12", colA, clientA, (D) => { D.mapTiles.rows[0].cells[1].counts["top three"] = null; }, "is missing");
  const clean = stopOf(() => bp(colA, clientA));
  if (clean !== "") bad.push(`the unedited run: ${clean}`);
  return [bad.length === 0, bad.join(" | ")];
}); check("case 9: THE GUARDS: each sentence that states a finding STOPs the build with its line when the finding does not hold (12 edits: 10 guards, a missing value, a missing addend), and the unedited run builds", ok, detail); }
// @@CASES (job R2b adds its cases above this line; keep it verbatim)
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
