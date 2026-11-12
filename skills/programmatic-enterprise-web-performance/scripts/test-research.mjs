// Usage: node test-research.mjs [--scripts <dir>] [--json]
// Stage S1 (intake) and S2 (research) self-test on FIXTURES ONLY: a temp folder, local http servers standing in for every API and
// for competitor sites, saved SERP captures, a sample Keyword Planner CSV, a fake snapshot. No live site, no Google, no paid API.
// Every check has a stable name; mutants-research.mjs breaks one thing per check and requires that check (and only it) to go red.
// Exit 0 = all pass. --json prints {passed, failed:[names]} as the last line (for the mutant runner).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : path.dirname(fileURLToPath(import.meta.url)));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-s12-"));
const results = [];
// NETWORK GUARD: every child process (and this one) refuses any request that is not to 127.0.0.1/localhost and logs the attempt, so a
// fixture run can never touch a live site, Google or a paid API. The last check asserts the log is empty.
const guardFile = path.join(tmp, "netguard.mjs"), netLog = path.join(tmp, "net-attempts.log");
fs.writeFileSync(guardFile, `import fs from "node:fs";
const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  let host = ""; try { host = new URL(url).hostname; } catch {}
  if (!/^(127\\.0\\.0\\.1|localhost|\\[::1\\])$/.test(host)) { if (process.env.PEWP_NETGUARD_LOG) fs.appendFileSync(process.env.PEWP_NETGUARD_LOG, url + "\\n"); return Promise.reject(new Error("NETWORK GUARD: refused non-local request " + url)); }
  return real(input, init);
};
`);
process.env.NODE_OPTIONS = `--import ${pathToFileURL(guardFile).href}`;
process.env.PEWP_NETGUARD_LOG = netLog;
await import(pathToFileURL(guardFile).href);
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, process.env.PEWP_TEST_VERBOSE ? 30000 : 600) });
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof s === "string" || Buffer.isBuffer(s) ? s : JSON.stringify(s, null, 1)); };
const J = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
// A DECOY: the current folder holds another client's research. A URL target reads only the folders it is given, so every script must ignore this.
// The whole suite runs with this as its working directory (children inherit it), so a script that falls back to the current folder goes red.
const decoy = path.join(tmp, "decoy-cwd");
fs.mkdirSync(path.join(decoy, "icm/knowledge/seo"), { recursive: true });
fs.writeFileSync(path.join(decoy, "icm/knowledge/seo/keywords.md"), "---\ntitle: Keyword map\nupdated: 2026-10-01\nclient: Decoy Plumbing Co (decoyplumbing.test)\n---\n| ID | Keyword | City | Difficulty | Demand signal |\n|---|---|---|---|---|\n| K-01 | emergency plumber austin tx | Austin | Hard | T1 SG-01 |\n");
process.chdir(decoy);
const BASE_ENV = { ...process.env, PEWP_TEST_GAP_MS: "0", GSC_TOKEN_FILE: path.join(tmp, "no-such-token.json"), BING_WEBMASTER_KEY: "", GEMINI_API_KEY: "", PEWP_GEMINI_TERMS_ACK: "", REDDIT_TOKEN: "", GSC_API_BASE: "", BING_API_BASE: "", GEMINI_API_BASE: "", REDDIT_BASE: "", WIKI_API_BASE: "" };
// async on purpose: the local test servers live in THIS process, so a blocking spawnSync would starve them
const node = (script, a, env = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(dir, script), ...a], { env: { ...BASE_ENV, ...env } });
  let stdout = "", stderr = ""; p.stdout.on("data", (c) => (stdout += c)); p.stderr.on("data", (c) => (stderr += c));
  const t = setTimeout(() => p.kill(), 120000);
  p.on("close", (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
});
const imp = (f) => import(pathToFileURL(path.join(dir, f)).href);
function serve(handler) {
  const reqs = [];
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      const r = { method: req.method, url: req.url, headers: req.headers, body }; reqs.push(r);
      const out = handler(r, reqs) || { status: 404, body: "not found" };
      res.writeHead(out.status || 200, { "content-type": out.type || "application/json", ...(out.headers || {}) });
      res.end(typeof out.body === "string" || Buffer.isBuffer(out.body) ? out.body : JSON.stringify(out.body));
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ port: server.address().port, url: `http://127.0.0.1:${server.address().port}`, reqs, close: () => server.close() })));
}
const isFact = (f) => f && typeof f === "object" && "value" in f && !!f.source && !!f.fetchedAt && "cacheFile" in f;

const HOST = "tracyhomes.test", URLT = `https://${HOST}/`;
const loc = { pewp: path.join(tmp, "site-checks", HOST, ".pewp"), snaps: path.join(tmp, "site-checks", HOST, "snapshots") };
const rd = (name) => J(path.join(loc.pewp, "research", `${name}.json`));
const T = (script, a, env) => node(script, [URLT, "--cwd", tmp, ...a], env);

try {
  // ============================ lib: words, ranges, intent ============================
  const lib = await imp("research-lib.mjs");
  check("lib: 80% token overlap is a match, 67% is not", lib.sameQuery("realtor in Tracy CA", "realtors in tracy ca") && !lib.sameQuery("realtor tracy ca", "realtor tracy") && !lib.sameQuery("realtor in tracy ca", "real estate agent tracy ca"));
  const r1 = lib.parseRange("1K – 10K"), r2 = lib.parseRange("320"), r3 = lib.parseRange("10K-100K");
  check("lib: a slug cut at 60 characters never ends on a hyphen (cluster ids must match c-<slug>)", lib.slug("a".repeat(59) + " bbb") === "a".repeat(59) && /^c-[a-z0-9]+(-[a-z0-9]+)*$/.test("c-" + lib.slug("sell house fast pre-foreclosure cash buyer in san jose california today")));
  check("lib: volume ranges parsed (1K - 10K, exact, no spaces)", r1.lo === 1000 && r1.hi === 10000 && r2.lo === 320 && r2.hi === 320 && r3.hi === 100000, JSON.stringify([r1, r2, r3]));
  const pl = [{ city: "Tracy", state: "CA", label: "Tracy, CA" }];
  check("lib: intent classes (local, informational, navigational, transactional)", lib.classifyIntent("realtor in tracy ca", { places: pl }) === "local" && lib.classifyIntent("what is a cash offer", { places: pl }) === "informational" && lib.classifyIntent("kestrel homes", { places: [], brand: ["kestrel homes"] }) === "navigational" && lib.classifyIntent("kestrel homes login", { places: [], brand: ["kestrel homes"] }) === "informational" && lib.classifyIntent("we buy houses fast", { places: [] }) === "transactional" && lib.classifyIntent("best home loans", { places: [] }) === "commercial");
  const caPlaces = [{ city: "Tracy", state: "CA", label: "Tracy, CA" }];
  check("lib: a city the lists do not know is inferred from '... <city> ca'; service words are not cities", lib.inferPlace("we buy houses oakland ca", caPlaces)?.label === "Oakland, CA" && lib.inferPlace("realtor in san ramon ca", caPlaces)?.label === "San Ramon, CA" && lib.inferPlace("sell house fast ca", caPlaces) === null && lib.inferPlace("we buy houses oakland ca", []) === null, JSON.stringify([lib.inferPlace("we buy houses oakland ca", caPlaces), lib.inferPlace("sell house fast ca", caPlaces)]));

  // ---- G16: a location whose name is a list is a label, not a place; the Matter of Place shape ----
  const MOP = {
    name: "Matter of Place", domain: "mop.test", kind: "real-estate-media", industry: null,
    offer: "An editorial real-estate media platform for exceptional residential property in California, New York and Florida.",
    audience: "Owners and listing agents of exceptional existing homes, and the buyers and readers who follow considered residential property",
    market: { country: "US", language: "en" },
    locations: [{ name: "California, New York and Florida", address: null, serviceArea: ["California", "New York", "Florida"] }],
    goals: ["leads"], competitors: ["dwell.test"], vocabulary: ["old houses", "victorian", "architecture"], brand: { constraints: [] },
    existing: { site: "https://mop.test/", searchConsole: false, businessProfile: null, socials: [] }, launchState: "live",
    rankTracking: { source: "browser-capture", locations: ["California", "New York", "Florida"], devices: ["mobile"] },
  };
  const MOPP = path.join(tmp, "site-checks", "mop.test", ".pewp");
  w(path.join(MOPP, "business.json"), MOP);
  check("lib: a location name that lists places (' and ', '&', ';', two commas) is a label; 'Tracy, CA', 'Tracy' and 'San Luis Obispo' are places", ["California, New York and Florida", "Tracy & Manteca", "Tracy; Manteca", "Oakland, Berkeley, Alameda"].every((x) => lib.isPlaceLabel(x)) && !["Tracy, CA", "Tracy", "San Luis Obispo", "Brandon, FL"].some((x) => lib.isPlaceLabel(x)), JSON.stringify(["California, New York and Florida", "Tracy & Manteca", "Tracy; Manteca", "Oakland, Berkeley, Alameda", "Tracy, CA"].map((x) => lib.isPlaceLabel(x))));
  const mopPlaces = lib.knownPlaces(MOP), mopNoRt = lib.knownPlaces({ locations: MOP.locations });
  check("lib: a location that is a list is a label, not a place: the Matter of Place shape gives the three states, never 'California, New York and Florida'", mopPlaces.map((p) => p.label).sort().join("|") === "California|Florida|New York" && mopNoRt.map((p) => p.label).sort().join("|") === "California|Florida|New York" && ![...mopPlaces, ...mopNoRt].some((p) => /,| and /.test(p.city)), JSON.stringify([mopPlaces, mopNoRt]));
  const miami = lib.knownPlaces({ locations: [{ name: "Miami", address: "1 Main St, Miami, FL 33101", serviceArea: ["Florida", "Tampa", "New York"] }] }).map((p) => p.label).sort();
  check("lib: a service-area entry that is itself a state gets no state code ('Florida', never 'Florida, FL'); a city keeps the office state", miami.join("|") === "Florida|Miami, FL|New York|Tampa, FL", miami.join("|"));

  // ---- G19: no negative timeout (research.mjs printed `TimeoutNegativeWarning: -1 is a negative number` during the Matter of Place run) ----
  {
    const warns = [], onWarn = (x) => warns.push(`${x.name}: ${x.message}`);
    process.on("warning", onWarn);
    await lib.sleep(-5); await lib.sleep(NaN); await lib.sleep(undefined); await lib.sleep("soon");
    await new Promise((r) => setTimeout(r, 40));
    check("lib: sleep(-5), sleep(NaN), sleep(undefined) resolve at once without a timeout warning (a wait is never negative or NaN)", warns.length === 0, warns.join(" | "));
    // pace() computes "when I may go" minus "now"; when the clock ticks between the two readings the wait is -1. Make that happen on every call.
    const realNow = Date.now, base = realNow(), prevGap = process.env.PEWP_TEST_GAP_MS;
    let tick = 0; process.env.PEWP_TEST_GAP_MS = "0"; Date.now = () => base + tick++;
    try { for (let i = 0; i < 25; i++) await lib.pace("http://127.0.0.1:59998/x", 1000); } finally { Date.now = realNow; if (prevGap == null) delete process.env.PEWP_TEST_GAP_MS; else process.env.PEWP_TEST_GAP_MS = prevGap; }
    await new Promise((r) => setTimeout(r, 40));
    check("lib: pace() never asks for a negative wait (no TimeoutNegativeWarning when the clock ticks between its two readings)", warns.length === 0 && tick >= 50, `${tick} clock reads; ${warns.join(" | ")}`);
    // PEWP_TEST_GAP_MS that is not a number of ms >= 0 must not shorten the real gap, and must not reach setTimeout
    const gapTimes = [];
    for (const bad of ["-5", "abc"]) {
      process.env.PEWP_TEST_GAP_MS = bad; const t0 = realNow();
      try { await lib.pace(`http://127.0.0.1:5999${bad === "-5" ? 7 : 6}/x`, 200); await lib.pace(`http://127.0.0.1:5999${bad === "-5" ? 7 : 6}/x`, 200); } finally { if (prevGap == null) delete process.env.PEWP_TEST_GAP_MS; else process.env.PEWP_TEST_GAP_MS = prevGap; }
      gapTimes.push(realNow() - t0);
    }
    await new Promise((r) => setTimeout(r, 40)); process.off("warning", onWarn);
    check("lib: PEWP_TEST_GAP_MS that is not a number of ms (>= 0) is ignored: the real gap still applies and no timeout warning appears", gapTimes.every((t) => t >= 150) && warns.length === 0, `${gapTimes.join(",")} ms; ${warns.join(" | ")}`);
  }

  // ============================ S1 intake ============================
  const snap = path.join(loc.snaps, "2026-10-20");
  const html = `<!doctype html><html lang="en-US"><head><title>Tracy Homes Realty | Realtor in Tracy CA</title><meta name="description" content="Residential real estate agents serving Tracy, Manteca and Lathrop."><meta name="robots" content="index,follow">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"RealEstateAgent","name":"Tracy Homes Realty","address":{"@type":"PostalAddress","streetAddress":"1 Main St","addressLocality":"Tracy","addressRegion":"CA","postalCode":"95376","addressCountry":"US"},"areaServed":["Tracy","Manteca","Lathrop"],"sameAs":["https://www.facebook.com/tracyhomes","https://g.page/tracy-homes"]}</script></head><body><h1>Realtor in Tracy, CA</h1><a href="https://www.instagram.com/tracyhomes?hl&#x3D;en&amp;x&#61;1">ig</a><p>Welcome</p></body></html>`;
  w(path.join(snap, "_site.json"), { finishedAt: "2026-10-20T10:00:00Z", pages: [{ url: URLT, slug: "home", status: 200 }, { url: `${URLT}we-buy-houses-tracy`, slug: "we-buy-houses-tracy", status: 200 }], stoppedEarly: null });
  w(path.join(snap, "pages/home/raw.html.gz"), zlib.gzipSync(html));
  w(path.join(snap, "pages/home/head.html"), `<title>Tracy Homes Realty | Real Estate Agent in Tracy CA</title>`);
  w(path.join(snap, "pages/home/body.html"), `<h1>Realtor in Tracy, CA</h1>`);
  w(path.join(snap, "pages/we-buy-houses-tracy/head.html"), `<title>We buy houses in Tracy CA | Tracy Homes</title>`);
  w(path.join(snap, "pages/we-buy-houses-tracy/body.html"), `<h1>We buy houses Tracy CA</h1>`);
  const i1 = await T("intake.mjs", []);
  const qs = (() => { const m = i1.stdout.match(/QUESTIONS \d+\n([\s\S]*?)\nBLOCKED/); try { return JSON.parse(m[1]); } catch { return []; } })();
  const qf = qs.map((q) => q.field);
  check("intake: open questions => exit 3 BLOCKED, scripts never prompt", i1.status === 3 && /BLOCKED: \d+ answers missing/.test(i1.stdout), i1.stdout + i1.stderr);
  check("intake: facts found on the site are not asked again (name, domain, language, country, locations, launch state)", qs.length > 3 && !["name", "domain", "market.language", "market.country", "locations", "launchState", "existing.site"].some((f) => qf.includes(f)), qf.join(","));
  check("intake: what only the owner knows is asked", ["goals", "audience", "offer", "competitors", "existing.searchConsole"].every((f) => qf.includes(f)), qf.join(","));
  check("intake: each question is pickable (<= 4 options, recommended first, goals multi-select)", qs.every((q) => q.options.length >= 1 && q.options.length <= 4 && q.recommended === 0 && q.question && q.header) && qs.find((q) => q.field === "goals")?.multiSelect === true);
  check("intake: the site's own description is only a suggestion for the offer", qs.find((q) => q.field === "offer")?.options[0].value?.includes("Manteca") && !fs.existsSync(path.join(loc.pewp, "business.json")));
  const answers = { kind: "real-estate-agent", offer: "Residential real estate in the Tracy area", audience: "Home buyers and sellers", goals: ["Leads", "phone"], competitors: [], "brand.constraints": [], "existing.searchConsole": false };
  w(path.join(loc.pewp, "intake-answers.json"), { ...answers, goals: ["fame"] });
  const iBad = await T("intake.mjs", []);
  check("intake: an answer outside the allowed set is rejected and asked again", iBad.status === 3 && /"field": "goals"/.test(iBad.stdout) && /not in leads\|calls/.test(iBad.stdout), iBad.stdout.slice(-500));
  w(path.join(loc.pewp, "intake-answers.json"), answers);
  const i2 = await T("intake.mjs", []);
  const bz = J(path.join(loc.pewp, "business.json"));
  check("intake: complete => business.json in the schemas/targets.md shape", i2.status === 0 && bz && bz.name === "Tracy Homes Realty" && bz.domain === HOST && bz.market.country === "US" && bz.market.language === "en" && JSON.stringify(bz.goals) === '["leads","calls"]' && bz.locations[0].serviceArea.join() === "Tracy,Manteca,Lathrop" && bz.launchState === "live" && bz.existing.site === URLT && bz.existing.socials.length >= 2 && bz.existing.businessProfile === "https://g.page/tracy-homes" && ["name", "domain", "kind", "industry", "offer", "audience", "market", "locations", "goals", "competitors", "brand", "existing", "launchState", "rankTracking"].every((k) => k in bz), i2.stdout + i2.stderr + JSON.stringify(bz));
  check("intake: rankTracking defaults are applied and shown, not asked", bz?.rankTracking.source === "browser-capture" && bz.rankTracking.devices[0] === "mobile" && bz.rankTracking.locations.join("|") === "Tracy, CA|Manteca, CA|Lathrop, CA" && /default\s+rankTracking/.test(i2.stdout), i2.stdout);
  check("intake: HTML entities in links are decoded (`?hl&#x3D;en` is `?hl=en`) in socials and the Business Profile link", bz?.existing.socials.includes("https://www.instagram.com/tracyhomes?hl=en&x=1") && !bz.existing.socials.some((u) => /&#|&amp;|&quot;/.test(u)) && !/&#|&amp;/.test(bz.existing.businessProfile || ""), JSON.stringify(bz?.existing));
  check("intake: stage recorded in state.json", !!J(path.join(loc.pewp, "state.json"))?.stages?.intake?.doneAt);
  const pv = path.join(tmp, "site-checks", "preview-x.pages.dev");
  w(path.join(pv, "snapshots/2026-10-20/_site.json"), { finishedAt: "2026-10-20T10:00:00Z", pages: [{ url: "https://preview-x.pages.dev/", slug: "home", status: 200 }] });
  w(path.join(pv, "snapshots/2026-10-20/pages/home/raw.html.gz"), zlib.gzipSync(`<html lang="en"><head><meta name="robots" content="noindex"><title>x</title></head><body></body></html>`));
  const ip = await node("intake.mjs", ["https://preview-x.pages.dev/", "--cwd", tmp]);
  check("intake: a preview host / noindex site is launchState preview (not indexable by design)", /accepted launchState: "preview"/.test(ip.stdout), ip.stdout.slice(0, 600));

  // ============================ seeds ============================
  const sdi = await T("research-seeds.mjs", ["--industry", "insurance-agency"]);
  const seedInd = { queries: [], ...rd("seeds") }; // a run that wrote a BLOCKED file has no queries: the check below goes red instead of the harness crashing
  check("seeds: --industry insurance-agency adds the pack's queries (national as they are, a {city} query once per service-area city), each naming the pack as its source", sdi.status === 0 && seedInd.queries.some((q) => q.query === "fixed indexed annuity vs fixed annuity" && /industry pack insurance-agency: annuities \/ informational \/ national/.test(q.source)) && ["mortgage protection insurance in tracy", "mortgage protection insurance in manteca", "annuity advisor in lathrop"].every((x) => seedInd.queries.some((q) => q.query === x && /, CA$/.test(q.location))) && !seedInd.queries.some((q) => /[{}]/.test(q.query)) && seedInd.queries.every((q) => /industry pack insurance-agency/.test(q.source)), sdi.stdout + sdi.stderr + JSON.stringify(seedInd.queries.slice(0, 3)));
  const sdBad = await T("research-seeds.mjs", ["--industry", "no-such-pack"]);
  check("seeds: --industry with an unknown pack is a usage error (exit 2) that names the file, and writes nothing new", sdBad.status === 2 && /no rules\/industries\/no-such-pack\.json/.test(sdBad.stdout + sdBad.stderr), sdBad.stdout + sdBad.stderr);
  const sd = await T("research-seeds.mjs", ["--service", "realtor", "--service", "we buy houses", "--query", "what is a cash offer on a house", "--query", "homes in {city}", "--query", "bad {thing} query"]);
  const seedDoc = rd("seeds");
  check("seeds: service x place x pattern, with the place label and a source on each", sd.status === 0 && seedDoc.queries.some((q) => q.query === "best realtor in manteca" && q.location === "Manteca, CA" && q.source) && seedDoc.queries.length >= 14, sd.stdout + sd.stderr);
  check("seeds: a {city} query expands per service-area city; an unfillable one is dropped and listed, never written", ["homes in tracy", "homes in manteca", "homes in lathrop"].every((q) => seedDoc.queries.some((s) => s.query === q && /, CA$/.test(s.location))) && !seedDoc.queries.some((s) => /[{}]/.test(s.query)) && seedDoc.droppedTemplates.some((d) => d.text === "bad {thing} query"), JSON.stringify(seedDoc.droppedTemplates));

  check("seeds: every query says where it came from (`from`): the service list, the --query, the pack", seedDoc.queries.length >= 14 && seedDoc.queries.every((q) => typeof q.from === "string" && q.from.length > 0) && seedDoc.queries.some((q) => q.from === "service list (--service)") && seedDoc.queries.some((q) => /^--query/.test(q.from)) && seedInd.queries.every((q) => q.from === "industry pack insurance-agency") && seedDoc.serviceListFrom === "service list (--service)", JSON.stringify(seedDoc.queries.slice(0, 2)) + JSON.stringify(seedDoc.queries.at(-1)));
  // G16 + G3 on the Matter of Place business: a location that is a list, and a vocabulary instead of --service
  const mopSd = await node("research-seeds.mjs", ["https://mop.test/", "--cwd", tmp, "--service", "historic homes for sale", "--pattern", "{service} in {city}", "--pattern", "best {service} in {city} {st}"]);
  const mopSeedDoc = J(path.join(MOPP, "research", "seeds.json")), mopQ = (mopSeedDoc?.queries || []).map((q) => q.query);
  check("seeds: a business whose one location is the list 'California, New York and Florida' gets one query per state, never the combined name and no 'Florida FL' (a location name is not expanded as a place)", mopSd.status === 0 && ["historic homes for sale in california", "historic homes for sale in new york", "historic homes for sale in florida", "best historic homes for sale in florida"].every((q) => mopQ.includes(q)) && !mopQ.some((q) => /california, new york|new york and florida/.test(q)) && !mopQ.some((q) => / (fl|ny|ca)$/.test(q)) && mopSeedDoc.placesUsed.slice().sort().join("|") === "California|Florida|New York", mopSd.stdout + mopSd.stderr + mopQ.join(" | "));
  const mopVoc = await node("research-seeds.mjs", ["https://mop.test/", "--cwd", tmp]);
  const mopVocDoc = J(path.join(MOPP, "research", "seeds.json")), mopVocQ = (mopVocDoc?.queries || []);
  check("seeds: with no --service the business vocabulary is the service list, and the file says so (from: definition vocabulary)", mopVoc.status === 0 && mopVocDoc.serviceListFrom === "definition vocabulary" && ["old houses", "victorian in florida", "best architecture in new york"].every((q) => mopVocQ.some((x) => x.query === q && x.from === "definition vocabulary")) && mopVocQ.every((x) => x.from === "definition vocabulary"), mopVoc.stdout + mopVoc.stderr + JSON.stringify(mopVocQ.slice(0, 3)));
  const mopQ1 = await node("research-seeds.mjs", ["https://mop.test/", "--cwd", tmp, "--query", "castle tours"]), mopQ1d = J(path.join(MOPP, "research", "seeds.json"));
  check("seeds: seeds the caller names itself (--query) are not widened with the vocabulary", mopQ1.status === 0 && mopQ1d.queries.length === 1 && mopQ1d.queries[0].query === "castle tours" && mopQ1d.queries[0].from.startsWith("--query") && mopQ1d.serviceListFrom === null, mopQ1.stdout + JSON.stringify(mopQ1d.queries));
  check("seeds: --service wins over the vocabulary (the vocabulary words are not added to an explicit service list)", !mopQ.includes("old houses") && !mopQ.includes("victorian") && mopSeedDoc.serviceListFrom === "service list (--service)", mopQ.join(" | "));

  // ============================ Keyword Planner CSV ============================
  const csv = ["Keyword Stats 2026-10-15 to 2026-10-15", "", ["Keyword", "Currency", "Avg. monthly searches", "Three month change", "YoY change", "Competition", "Competition (indexed value)", "Top of page bid (low range)", "Top of page bid (high range)", "Account Status"].join("\t"),
    ["real estate agent tracy ca", "USD", "1K – 10K", "0%", "0%", "High", "81", "2.10", "6.30", ""].join("\t"), ["realtor in tracy ca", "USD", "100 – 1K", "0%", "0%", "High", "77", "1.00", "3.00", ""].join("\t"),
    ["we buy houses tracy ca", "USD", "320", "0%", "0%", "Medium", "50", "", "", ""].join("\t"), ["odd row", "USD", "", "", "", "", "", "", "", ""].join("\t"), ["tracy home value", "USD", "100 - 1K", "", "", "Low", "10", "", "", ""].join("\t"), ["realtor in manteca ca", "USD", "10 - 100", "", "", "Low", "20", "0.80", "1.60", ""].join("\t"), ["what is a cash offer on a house", "USD", "100 - 1K", "", "", "Low", "10", "", "", ""].join("\t")].join("\r\n");
  const csvFile = path.join(tmp, "kwp-export.csv");
  fs.writeFileSync(csvFile, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv, "utf16le")]));
  const kw = await T("research-kwp.mjs", ["--file", csvFile]);
  const kwd = rd("kwp"), kk = (q) => kwd?.keywords.find((k) => k.query === q);
  check("kwp: UTF-16 export parsed; a range becomes an ESTIMATE (midpoint, range kept)", kw.status === 0 && kk("real estate agent tracy ca")?.volume.value === 5500 && kk("real estate agent tracy ca").volume.estimate === true && kk("real estate agent tracy ca").volume.range.join() === "1000,10000", kw.stdout + kw.stderr);
  check("kwp: an exact number is not an estimate; CPC is the bid midpoint with its range", kk("we buy houses tracy ca")?.volume.value === 320 && kk("we buy houses tracy ca").volume.estimate === false && kk("real estate agent tracy ca").value.value === 4.2 && kk("real estate agent tracy ca").value.estimate === true);
  check("kwp: every number sourced (file, date from the export, cached copy, market)", isFact(kk("realtor in tracy ca").volume) && kk("realtor in tracy ca").volume.fetchedAt.startsWith("2026-10-15") && fs.existsSync(kk("realtor in tracy ca").volume.cacheFile) && kk("realtor in tracy ca").volume.location === "US");
  check("kwp: a row without a volume stays null, never invented", kk("odd row")?.volume.value === null && /^NOT MEASURED/.test(kk("odd row").volume.source));
  const kb = await T("research-kwp.mjs", ["--dir", path.join(tmp, "empty-dir")]);
  check("kwp: no file => BLOCKED exit 3 with the export steps", kb.status === 3 && /BLOCKED: .*Keyword Planner/.test(kb.stdout), kb.stdout + kb.stderr);

  // ============================ Search Console ============================
  const gs = await serve((r, reqs) => {
    if (r.url === "/token") return { body: { access_token: "FRESH-TOKEN-1" } };
    if (r.url.startsWith("/webmasters/v3/sites?") || r.url === "/webmasters/v3/sites") return { body: { siteEntry: [{ siteUrl: "sc-domain:other.test" }, { siteUrl: `sc-domain:${HOST}` }] } };
    if (r.url.includes("/searchAnalytics/query")) return { body: { rows: [
      { keys: ["we buy houses tracy ca", `https://${HOST}/we-buy-houses-tracy`, "usa", "MOBILE"], clicks: 12, impressions: 340, ctr: 0.0353, position: 8.46 },
      { keys: ["tracy homes realty", `https://${HOST}/`, "usa", "DESKTOP"], clicks: 40, impressions: 90, ctr: 0.44, position: 1.2 },
      { keys: ["tracy homes realty", `https://${HOST}/`, "usa", "TABLET"], clicks: 1, impressions: 3, ctr: 0.3, position: 2.2 }] } };
  });
  const tokF = path.join(tmp, "gsc-token.json");
  w(tokF, { access_token: "ACCESS-TOKEN-SECRET", expiry_date: Date.now() + 3600000 });
  const genv = { GSC_API_BASE: gs.url, GSC_TOKEN_FILE: tokF };
  const g1 = await T("research-gsc.mjs", [], genv), n1 = gs.reqs.length;
  const gd = rd("gsc");
  check("gsc: queries/pages/country/device fetched; position, clicks, impressions are sourced numbers with location and device", g1.status === 0 && gd.rows.length === 2 && gd.skippedTabletRows === 1 && isFact(gd.rows[0].position) && gd.rows[0].position.value === 8 && gd.rows[0].averagePosition.value === 8.5 && gd.rows[0].url === `https://${HOST}/we-buy-houses-tracy` && gd.rows[0].position.device === "mobile" && gd.rows[0].position.location === "USA" && gd.rows[0].engine === "google" && gd.rows[0].language === "en" && isFact(gd.rows[0].impressions), g1.stdout + g1.stderr);
  const g2 = await T("research-gsc.mjs", [], genv);
  check("gsc: a second run is served from the cache (no new requests)", g2.status === 0 && gs.reqs.length === n1, `${n1} -> ${gs.reqs.length}`);
  const cacheText = fs.readdirSync(path.join(loc.pewp, "cache", "gsc")).map((f) => fs.readFileSync(path.join(loc.pewp, "cache", "gsc", f), "utf8")).join("");
  check("gsc: the access token never lands in the cache", !cacheText.includes("ACCESS-TOKEN-SECRET") && !cacheText.includes("FRESH-TOKEN-1"));
  const rt = path.join(tmp, "gsc-refresh.json"); w(rt, { refresh_token: "r", client_id: "c", client_secret: "s" });
  fs.rmSync(path.join(loc.pewp, "cache", "gsc"), { recursive: true });
  const g3 = await T("research-gsc.mjs", [], { ...genv, GSC_TOKEN_FILE: rt, GSC_TOKEN_URL: `${gs.url}/token` });
  check("gsc: a refresh token is exchanged for an access token", g3.status === 0 && gs.reqs.some((q) => q.headers.authorization === "Bearer FRESH-TOKEN-1"), g3.stdout + g3.stderr);
  // measure-sources.mjs writes the refreshed token back with `expiry` (ISO); research must read that form too, never send a stale token
  const rt2 = path.join(tmp, "gsc-stale.json"); w(rt2, { access_token: "STALE-TOKEN", expiry: new Date(Date.now() - 3600000).toISOString(), refresh_token: "r", client_id: "c", client_secret: "s" });
  fs.rmSync(path.join(loc.pewp, "cache", "gsc"), { recursive: true });
  const nBefore = gs.reqs.length;
  const g3b = await T("research-gsc.mjs", [], { ...genv, GSC_TOKEN_FILE: rt2, GSC_TOKEN_URL: `${gs.url}/token` });
  check("gsc: an expired token (measure's `expiry` form) is refreshed, never sent stale", g3b.status === 0 && !gs.reqs.slice(nBefore).some((q) => q.headers.authorization === "Bearer STALE-TOKEN") && gs.reqs.slice(nBefore).some((q) => q.headers.authorization === "Bearer FRESH-TOKEN-1"), g3b.stdout + g3b.stderr + JSON.stringify(gs.reqs.slice(nBefore).map((q) => q.headers.authorization)));
  const g4 = await T("research-gsc.mjs", []);
  check("gsc: no token file => BLOCKED exit 3 with the owner step", g4.status === 3 && /BLOCKED: .*Search Console property/.test(g4.stdout) && rd("gsc").status === "blocked", g4.stdout + g4.stderr);
  gs.close();

  // ============================ Bing Webmaster ============================
  const bg = await serve((r) => {
    const u = new URL(r.url, "http://x"), m = u.pathname.split("/").pop();
    if (u.searchParams.get("apikey") !== "BING-KEY-SECRET") return { status: 401, body: {} };
    if (m === "GetKeyword") return { body: { d: [{ Query: u.searchParams.get("q"), Impressions: 700, BroadImpressions: 2100, Date: "/Date(1760000000000)/" }, { Query: u.searchParams.get("q"), Impressions: 300, BroadImpressions: 900, Date: "/Date(1760600000000)/" }] } };
    if (m === "GetRelatedKeywords") return { body: { d: [{ Query: `${u.searchParams.get("q")} near me`, Impressions: 90, BroadImpressions: 120, Date: "/Date(1760000000000)/" }] } };
    if (m === "GetQueryStats") return { body: { d: [{ Query: "tracy homes realty", Impressions: 50, Clicks: 20, AvgImpressionPosition: 1.5, AvgClickPosition: 1.2, Date: "/Date(1760000000000)/" }] } };
  });
  const benv = { BING_API_BASE: bg.url, BING_WEBMASTER_KEY: "BING-KEY-SECRET" };
  const b1 = await T("research-bing.mjs", ["--seed", "realtor in tracy ca", "--site-stats"], benv);
  const bd = rd("bing");
  check("bing: keyword volumes are ESTIMATES (impressions summed over the dates), related keywords found, our own queries read", b1.status === 0 && bd.keywords[0].volume.value === 1000 && bd.keywords[0].volume.estimate === true && bd.keywords[0].volume.location === "US" && bd.keywords.some((k) => k.related && k.query === "realtor in tracy ca near me") && bd.siteQueries[0].position.value === 1.5, b1.stdout + b1.stderr);
  const b2 = await T("research-bing.mjs", ["--seed", "a one", "--seed", "b two", "--seed", "c three", "--no-related", "--max-calls", "2"], benv);
  check("bing: the call budget is a hard stop (3 seeds, budget 2 => 2 calls, 1 seed reported unasked)", b2.status === 0 && rd("bing").calls === 2 && rd("bing").skippedSeeds.length === 1 && rd("bing").budgetStopped === true, b2.stdout + b2.stderr);
  const bc = fs.readdirSync(path.join(loc.pewp, "cache", "bing")).map((f) => fs.readFileSync(path.join(loc.pewp, "cache", "bing", f), "utf8")).join("");
  check("bing: the API key never lands in the cache", !bc.includes("BING-KEY-SECRET") && bc.includes("apikey=REDACTED"));
  const b3 = await T("research-bing.mjs", ["--seed", "x"]);
  check("bing: no key => BLOCKED exit 3", b3.status === 3 && /BLOCKED: .*BING_WEBMASTER_KEY/.test(b3.stdout), b3.stdout + b3.stderr);
  bg.close();

  // ---- G4: the parser against the LIVE response shapes (fixtures/bing-junk = answers of 2026-10-25), and the relevance filter against that day's junk ----
  const FIX = path.resolve(process.env.PEWP_FIXTURES_DIR || path.join(dir, "..", "fixtures"), "bing-junk");
  const fxBody = (n) => JSON.parse(J(path.join(FIX, n)).text);
  const junkRows = J(path.join(FIX, "junk-rows.json")).rows, manhole = junkRows.find((x) => /manhole/.test(x.Query));
  const relHist = fxBody("getrelatedkeywords-historic-homes-for-sale.json").d, relFl = fxBody("getrelatedkeywords-luxury-homes-for-sale-in-florida.json").d;
  const synthRow = (Query, n) => ({ __type: "Keyword:#Microsoft.Bing.Webmaster.Api", BroadImpressions: n, Impressions: n, Query });
  const SYNTH = [synthRow("used boats for sale", 300), synthRow("luxury penthouses", 200), synthRow("historic houses for sale florida", 150)]; // SYNTHETIC rows (not from the live answers)
  const mopSeedsB = ["historic homes for sale", "luxury homes for sale in florida", "historic homes for sale in new york"];
  const mb = await serve((r) => {
    const u = new URL(r.url, "http://x"), m = u.pathname.split("/").pop(), q = u.searchParams.get("q");
    if (u.searchParams.get("apikey") !== "MOP-KEY-SECRET") return { status: 401, body: {} };
    if (m === "GetQueryStats") return { body: { d: [] } };
    if (m === "GetKeyword") return { body: fxBody(q === mopSeedsB[0] ? "getkeyword-single-object-historic-homes-for-sale.json" : "getkeyword-single-object-null-query.json") };
    if (m === "GetRelatedKeywords") return { body: { d: q === mopSeedsB[0] ? [...relHist, ...junkRows.filter((x) => x !== manhole), ...SYNTH] : q === mopSeedsB[1] ? relFl : [manhole] } };
  });
  const menv = { BING_API_BASE: mb.url, BING_WEBMASTER_KEY: "MOP-KEY-SECRET" };
  const bseeds = mopSeedsB.flatMap((s) => ["--seed", s]);
  const mbRun = await node("research-bing.mjs", ["https://mop.test/", "--cwd", tmp, ...bseeds], menv);
  const mbd = J(path.join(MOPP, "research", "bing.json")) || { keywords: [], droppedOffTopic: [] };
  const kwOf = (d, q) => d.keywords.find((k) => k.query === q), dropOf = (d, q) => d.droppedOffTopic.find((x) => x.query === q);
  check("bing: the live shapes parse: GetKeyword answers ONE object in `d` (644 impressions, broad 665; another answers Query null and 0), GetRelatedKeywords an array", mbRun.status === 0 && relHist.length === 110 && relFl.length === 53 && kwOf(mbd, mopSeedsB[0])?.volume.value === 644 && kwOf(mbd, mopSeedsB[0]).broad.value === 665 && kwOf(mbd, mopSeedsB[0]).volume.estimate === true && kwOf(mbd, mopSeedsB[1])?.volume.value === 0 && isFact(kwOf(mbd, mopSeedsB[1]).volume) && mbd.calls === 6, mbRun.stdout + mbRun.stderr + JSON.stringify(mbd.keywords.slice(0, 2)));
  const expectRel = new Set([...relHist, ...junkRows, ...SYNTH, ...relFl].map((x) => x.Query.toLowerCase().trim()).filter((x) => !mopSeedsB.includes(x)));
  check("bing: every related row of the live answers is either kept or dropped with a reason (the counts add up)", mbd.keywords.filter((k) => k.related).length + mbd.droppedOffTopic.length === expectRel.size && mbd.droppedOffTopic.length > 0 && mbd.keywords.filter((k) => k.related).length > 20, `${mbd.keywords.filter((k) => k.related).length} kept + ${mbd.droppedOffTopic.length} dropped vs ${expectRel.size}`);
  const JUNKQ = ["how to find my windows product key site microsoft.com", "how to find slope from a graph", "cars for sale", "how to clear cache", "five people emerge from manhole in new york", "used boats for sale"], BRANDQ = ["zillow homes for sale", "redfin homes for sale"];
  check("bing: relevance filter: the off-topic keywords of the real run (windows key site:microsoft.com, slope, cars, cache, manhole) are dropped with a reason and the seed they came from", JUNKQ.every((q) => { const x = dropOf(mbd, q); return x && x.reason && mopSeedsB.includes(x.relatedTo) && !kwOf(mbd, q); }) && /"site:" search on another website \(microsoft\.com\)/.test(dropOf(mbd, JUNKQ[0])?.reason) && /place name/.test(dropOf(mbd, JUNKQ[4])?.reason || "") && /no meaningful term/.test(dropOf(mbd, "how to clear cache")?.reason || ""), JSON.stringify(JUNKQ.map((q) => dropOf(mbd, q))));
  check("bing: relevance filter: a word that is another site's name (zillow, redfin, realtor) or a web address drops the keyword as navigational", BRANDQ.every((q) => /navigational/.test(dropOf(mbd, q)?.reason || "") && !kwOf(mbd, q)) && /"zillow" is the name of another site \(zillow\.com\)/.test(dropOf(mbd, "zillow homes for sale").reason) && /web address/.test(dropOf(mbd, "zillow.com")?.reason || "") && !mbd.keywords.some((k) => /zillow|redfin|realtor|trulia/.test(k.query)), JSON.stringify(BRANDQ.map((q) => dropOf(mbd, q))));
  check("bing: relevance filter keeps the legitimate related keywords (victorian houses, circa old houses for sale, historic houses for sale florida, luxury penthouses, real estate) and says why", ["victorian houses", "circa old houses for sale", "historic houses for sale florida", "luxury penthouses", "real estate"].every((q) => kwOf(mbd, q)?.related === true && /^shares "/.test(kwOf(mbd, q).relevance || "") && !dropOf(mbd, q)), JSON.stringify(["victorian houses", "luxury penthouses", "real estate"].map((q) => kwOf(mbd, q) || dropOf(mbd, q))));
  const mbKeep = await node("research-bing.mjs", ["https://mop.test/", "--cwd", tmp, ...bseeds, "--keep-brands"], menv);
  const mbd2 = J(path.join(MOPP, "research", "bing.json"));
  check("bing: --keep-brands keeps keywords that name another site (zillow homes for sale); a keyword with no term of the business is still dropped", mbKeep.status === 0 && mbd2.keepBrands === true && kwOf(mbd2, "zillow homes for sale")?.related === true && !!dropOf(mbd2, JUNKQ[0]) && !!dropOf(mbd2, "how to clear cache") && mbd2.droppedOffTopic.every((x) => !/^navigational/.test(x.reason)), mbKeep.stdout + mbKeep.stderr);
  const mbNo = await node("research-bing.mjs", ["https://mop.test/", "--cwd", tmp, ...bseeds, "--no-related"], menv);
  const mbd3 = J(path.join(MOPP, "research", "bing.json"));
  check("bing: --no-related asks for the seeds' own volumes only (no related keywords, nothing dropped)", mbNo.status === 0 && mbd3.relatedAsked === false && mbd3.keywords.length === 3 && mbd3.keywords.every((k) => k.related === false) && mbd3.droppedOffTopic.length === 0 && mbd3.calls === 3, mbNo.stdout + mbNo.stderr);

  // ============================ Wikipedia pageviews ============================
  const wk = await serve((r) => {
    if (r.url.includes("Tracy%2C_California")) return { body: { items: [{ timestamp: "2026090100", views: 9000 }, { timestamp: "2026100100", views: 11000 }] } };
    return { status: 404, body: { detail: "no data" } };
  });
  const k1 = await T("research-wiki.mjs", ["--title", "Tracy, California", "--title", "Nonesuch Place"], { WIKI_API_BASE: wk.url });
  const wd = rd("wiki");
  check("wiki: average monthly views, sourced; a missing article is a result (article:false), not a failure", k1.status === 0 && wd.entities[0].monthlyViews.value === 10000 && isFact(wd.entities[0].monthlyViews) && wd.entities[1].article === false && wd.entities[1].monthlyViews.value === null, k1.stdout + k1.stderr);
  check("wiki: sends a descriptive User-Agent", wk.reqs.every((q) => /PEWP-Research/.test(q.headers["user-agent"] || "")));
  wk.close();

  // ============================ Reddit / forums ============================
  let rn = 0;
  const rdt = await serve((r) => {
    rn++;
    if (rn >= 2) return { status: 429, body: {} };
    return { body: { data: { children: [{ data: { title: "How do I sell my house fast in Tracy?", subreddit: "Tracy", permalink: "/r/Tracy/comments/1/x/", score: 12, num_comments: 5, created_utc: 1760000000 } }, { data: { title: "Tracy farmers market opens", subreddit: "Tracy", permalink: "/r/Tracy/comments/2/y/", score: 1, num_comments: 0, created_utc: 1760000001 } }, { data: { title: "Is 3% commission normal", subreddit: "Tracy", permalink: "/r/Tracy/comments/3/z/", score: 4, num_comments: 9, created_utc: 1760000002 } }] } } };
  });
  const f1 = await T("research-forums.mjs", ["--query", "sell house fast", "--query", "second query", "--query", "third query"], { REDDIT_BASE: rdt.url });
  const fd = rd("forums");
  check("forums: only real questions kept, each with its permalink (seen at) and sourced score", f1.status === 0 && fd.questions.length === 2 && fd.questions.every((q) => q.seenAt.startsWith("https://www.reddit.com/r/") && isFact(q.score)), f1.stdout + f1.stderr);
  check("forums: the FIRST 429 stops the run, no retry loop (project rule 3)", fd.stoppedBy && /429/.test(fd.stoppedBy) && fd.partial === true && rn === 2, `${rn} requests; ${fd.stoppedBy}`);
  rdt.close();
  const rd429 = await serve(() => ({ status: 429, body: {} }));
  const f2 = await T("research-forums.mjs", ["--query", "q one"], { REDDIT_BASE: rd429.url });
  check("forums: refused from the start => BLOCKED exit 3 with the owner step", f2.status === 3 && /BLOCKED: .*Reddit/.test(f2.stdout), f2.stdout + f2.stderr);
  rd429.close();

  // ============================ SERP capture import ============================
  const U = (...p) => p.map((x) => `https://${x}`);
  const org = (urls) => urls.map((url, i) => ({ position: i + 1, url, title: `Result ${i + 1}` }));
  const q1urls = U("zillow.com/professionals/tracy-ca", "realtor.com/realestateagents/tracy_ca", "yelp.com/search?find=agents&loc=tracy", `${HOST}/`, "a1.test/tracy-realtors", "a2.test/tracy-agents", "a3.test/tracy-homes", "a4.test/about-tracy", "a5.test/tracy-sell", "a6.test/tracy-buy");
  const q2urls = [q1urls[2], q1urls[0], q1urls[1], q1urls[4], q1urls[5], q1urls[6], ...U("b1.test/x", "b2.test/y", "b3.test/z", "b4.test/w")];
  const q3urls = [...q1urls.slice(0, 3), ...U("zillow.com/professionals/manteca-ca-2", "zillow.com/professionals/manteca-ca", "m1.test/manteca", "m2.test/manteca-agents", "m3.test/m", "m4.test/n")];
  const q4urls = U("zillow.com/sell-fast", "webuyhouses.com/tracy", "c1.test/we-buy-tracy", "c2.test/cash-offers", "c3.test/tracy-cash", "c4.test/sell-now", "c5.test/z", "c6.test/y", "c7.test/x", "c8.test/w");
  const q5urls = U("zillow.com/learn/cash-offer", "investopedia.com/cash-offer", "d1.test/what-is-a-cash-offer", "d2.test/cash-offer-guide", "d3.test/a", "d4.test/b", "d5.test/c", "d6.test/d", "d7.test/e", "d8.test/f");
  const capDir = path.join(loc.pewp, "captures", "serp");
  const cap = (id, query, urls, extra = {}) => w(path.join(capDir, `${id}.google.json`), { query, engine: "google", capturedAt: "2026-10-21T15:00:00Z", browser: "owner's Edge", device: "mobile", language: "en", location: { requested: "Tracy, CA", footer: "Tracy, California - From your device", method: "uule parameter" }, organic: org(urls), localPack: [], paa: [], aiOverview: { present: false, text: null, sources: [] }, ...extra });
  cap("q1", "realtor in tracy ca", q1urls, { localPack: [{ name: "Tracy Pros", rating: 5, reviews: 120 }], paa: ["How much does a realtor cost?"], aiOverview: { present: true, text: "Several agents serve Tracy.", sources: ["zillow.com", HOST] } });
  cap("q2", "real estate agent tracy ca", q2urls, { localPack: [{ name: "Tracy Pros", rating: 5, reviews: 120 }] });
  cap("q3", "realtor in manteca ca", q3urls, { location: { requested: "Manteca, CA", footer: "Egypt - From your device", method: "uule parameter" } });
  cap("q4", "we buy houses tracy ca", q4urls, { paa: ["Is it safe to sell to a cash buyer?"] });
  cap("q5", "what is a cash offer on a house", q5urls, { location: { requested: null, footer: "Tracy, California" } });
  w(path.join(capDir, "bad-no-location.google.json"), { query: "x y z", engine: "google", capturedAt: "2026-10-21T15:00:00Z", device: "mobile", language: "en", organic: [] });
  w(path.join(capDir, "robot.google.json"), { query: "robot query", engine: "google", capturedAt: "2026-10-21T15:00:00Z", device: "mobile", language: "en", location: { footer: "x" }, organic: [], robotCheck: true });
  w(path.join(capDir, "A01.google.md"), `## UPDATE 2026-10-17 (night, fresh run): Google web READ in the OWNER'S EDGE (signed-in profile)\nQuery A01: legacy format query\nLocation: Google location set to Elk Grove, California with the uule parameter; footer location shown: "Kafr Tohormos /B, Egypt - From your device"\n**GOOGLE AI OVERVIEW: NOT PRESENT**\nAI answer text (verbatim, full):\nnone\nNamed in the AI answer (in order): none\nSources shown with the AI answer: none\nLocal / Places pack: Elizabeth Velasco, REALTOR RE/MAX 5.0 (189) — 9355 E Stockton Blvd · LUANN SHIKASHO, REALTOR 5.0 (181) — 3125 Dwight Rd\nOrganic top 10: 1 zillow.com (Elk Grove agents) · 2 realtor.com (Elk Grove homes) · 3 yelp.com (best agents)\nPeople also ask: How much would a real estate agent make? · Is it worth paying an agent?\n`);
  const s1 = await T("research-serp-import.mjs", ["--device", "desktop"]);
  const sp = rd("serp"), capOf = (id) => sp?.captures.find((c) => path.basename(c.file).startsWith(id));
  check("serp: saved captures parsed into rows with query, engine, date, device, language, location", s1.status === 0 && capOf("q1").organic.length === 10 && capOf("q1").query === "realtor in tracy ca" && capOf("q1").device === "mobile" && capOf("q1").language === "en" && capOf("q1").capturedAt.startsWith("2026-10-21") && capOf("q1").source === "captured in browser", s1.stdout + s1.stderr);
  check("serp: localized only when the footer shows the city; otherwise NOT LOCALIZED (baseline)", capOf("q1").location.localized === true && capOf("q1").locationLabel === "Tracy, CA" && capOf("q3").location.localized === false && /^NOT LOCALIZED \(baseline\): Egypt/.test(capOf("q3").locationLabel), `${capOf("q1")?.locationLabel} | ${capOf("q3")?.locationLabel}`);
  const oth = path.join(tmp, "site-checks", "other.test", ".pewp");
  w(path.join(oth, "business.json"), { ...bz, domain: "other.test", name: "Other Co" });
  w(path.join(oth, "captures", "serp", "bad-no-device.google.json"), { query: "x y z", engine: "google", capturedAt: "2026-10-21T15:00:00Z", language: "en", location: { footer: "Tracy" }, organic: [] });
  await node("research-serp-import.mjs", ["https://other.test/", "--cwd", tmp]);
  const spo = J(path.join(oth, "research", "serp.json"));
  check("serp: a capture with no device or no location is REJECTED with the reason", spo?.rejected.some((x) => /bad-no-device/.test(x.file) && /no device/.test(x.reason)) && sp.rejected.some((x) => /bad-no-location/.test(x.file) && /no location/.test(x.reason)) && !capOf("bad-no"), JSON.stringify([spo?.rejected, sp.rejected]));
  check("serp: a robot-check capture is recorded BLOCKED, not as results", capOf("robot")?.status === "BLOCKED" && sp.counts.blocked === 1);
  check("serp: the project's 2026-10-17 text format is read (organic, pack, People-also-ask, AI Overview)", capOf("A01")?.organic.length === 3 && capOf("A01").localPack[0].reviews === 189 && capOf("A01").paa.length === 2 && capOf("A01").aiOverview.present === false && capOf("A01").deviceSource.startsWith("default") && capOf("A01").locationLabel.startsWith("NOT LOCALIZED"), JSON.stringify(capOf("A01")));
  check("serp: our position is a sourced number with location and device (or null when not in the results)", capOf("q1").ourPosition.value === 4 && isFact(capOf("q1").ourPosition) && capOf("q1").ourPosition.device === "mobile" && capOf("q2").ourPosition.value === null);
  const s0 = await node("research-serp-import.mjs", ["https://other.test/", "--cwd", tmp, "--dir", path.join(tmp, "no-captures")]);
  check("serp: no captures => BLOCKED exit 3 with the capture rules (human pace, 45 s, stop at robot check)", s0.status === 3 && /BLOCKED: .*45 s/.test(s0.stdout), s0.stdout + s0.stderr);
  const legacy = path.join(tmp, "legacy-p02"), fresh2 = path.join(legacy, "fresh"), copy2 = path.join(legacy, "fresh-copy");
  w(path.join(legacy, "captures/A01.md"), "# A01 — \"realtor in Elk Grove CA\" — 2026-10-17 — query-text city");
  for (const eng of ["google", "bing"]) w(path.join(fresh2, `A01.${eng}.md`), ["## UPDATE 2026-10-17 (night): READ in the OWNER'S EDGE", "Location: Google location set to Elk Grove, California with the uule parameter; footer location shown: \"Egypt\"", "Organic top 10: 1 zillow.com (a) · 2 redfin.com (b) · 3 agent1.test (c) · 4 agent2.test (d) · 5 agent3.test (e)", ""].join("\n"));
  w(path.join(fresh2, "A01.google.pilot-egypt.md"), "pilot, must not count");
  fs.cpSync(fresh2, copy2, { recursive: true });
  const serpLib = await imp("research-serp-import.mjs"), libm = await imp("research-lib.mjs");
  const ctxO = libm.context("https://other.test/", { cwd: tmp });
  const lg = await serpLib.run(ctxO, { dirs: [fresh2, copy2] });
  check("serp: legacy text captures need no --device: desktop is ASSUMED and labelled, the location stays NOT LOCALIZED, the query comes from captures/<ID>.md", lg.captures.length === 2 && lg.rejected.length === 0 && lg.captures.every((c) => c.device === "desktop" && /^assumed desktop/.test(c.deviceSource) && /^NOT LOCALIZED/.test(c.locationLabel) && c.query === "realtor in Elk Grove CA") && !lg.captures.some((c) => /pilot/.test(c.file)), JSON.stringify(lg.captures.map((c) => [c.engine, c.device, c.deviceSource, c.locationLabel, c.query])));
  check("serp: the same capture saved in two folders counts once", lg.counts.files === 4 && lg.counts.captures === 2 && lg.counts.duplicates === 2, JSON.stringify(lg.counts));

  // ============================ clustering ============================
  const cl = await imp("research-cluster.mjs");
  const caps = sp.captures.filter((c) => c.status !== "BLOCKED");
  const uni = (q, v, o) => ({ query: q, volume: { value: v, source: "t", fetchedAt: "t", cacheFile: null }, order: o, sources: ["t"] });
  const universe = [uni("realtor in tracy ca", 550, 0), uni("real estate agent tracy ca", 5500, 1), uni("realtor in manteca ca", 90, 2), uni("we buy houses tracy ca", 320, 3), uni("what is a cash offer on a house", 40, 4), uni("realtors tracy ca", null, 5)];
  const places = [{ city: "Tracy", state: "CA", label: "Tracy, CA" }, { city: "Manteca", state: "CA", label: "Manteca, CA" }];
  const clusters = cl.clusterQueries({ universe, captures: caps, engine: "google", shared: 4, maxClusters: 50, places });
  const cOf = (q) => clusters.find((c) => c.queries.some((m) => m.query === q));
  check("cluster: queries whose top-10 share >= 4 results become ONE cluster, headed by the biggest volume", cOf("realtor in tracy ca") === cOf("real estate agent tracy ca") && cOf("realtor in tracy ca").head === "real estate agent tracy ca" && /serp-overlap \(6 shared/.test(cOf("realtor in tracy ca").queries.find((m) => m.query === "realtor in tracy ca").basis), JSON.stringify(clusters.map((c) => [c.head, c.queries])));
  check("cluster: another place with its own results (only 3 shared, below clusterOverlap 4) stays a cluster of its own (a page per city); 06 9.1 has no place rule", cOf("realtor in manteca ca") !== cOf("realtor in tracy ca") && cOf("realtor in manteca ca").place === "Manteca, CA");
  check("cluster: unrelated searches stay apart", new Set([cOf("we buy houses tracy ca"), cOf("what is a cash offer on a house"), cOf("realtor in tracy ca")]).size === 3);
  check("cluster: a query with no capture joins the cluster of the captured query with the same head term and the same place (06 9.1)", cOf("realtors tracy ca") === cOf("realtor in tracy ca") && /^head term/.test(cOf("realtors tracy ca").queries.find((m) => m.query === "realtors tracy ca").basis) && cOf("realtors tracy ca").serp === true);
  check("cluster: portals found from the captures (domains in 25%+ of results pages)", cl.portalDomains(caps.filter((c) => c.engine === "google")).includes("zillow.com") && !cl.portalDomains(caps).includes("c1.test"), JSON.stringify(cl.portalDomains(caps)));
  const cNone = cl.clusterQueries({ universe, captures: [], engine: "google", places });
  check("cluster: no captures => no SERP overlap is guessed (no cluster has a capture, all serp:false; only the one pair the validator would reject, 'realtor in tracy ca' + 'realtors tracy ca', merges by tokens)", cNone.length === 5 && cNone.every((c) => c.captureOfHead === null && c.serp === false) && cNone.filter((c) => c.queries.length > 1).length === 1 && cNone.find((c) => c.queries.length > 1).queries.length === 2 && cNone.find((c) => c.queries.length > 1).head === "realtor in tracy ca", JSON.stringify(cNone.map((c) => [c.head, c.queries])));
  // 9.1: a query with no capture joins the captured query with the same head term; this skill also requires the same place (a page per city)
  const uniPlace = [...universe, uni("realtors manteca ca", null, 6)];
  const clPlace = cl.clusterQueries({ universe: uniPlace, captures: caps, engine: "google", shared: 4, maxClusters: 50, places });
  const cP = (q) => clPlace.find((c) => c.queries.some((m) => m.query === q));
  check("cluster: a query with no capture does not join the cluster of another place (head term + place), it joins its own place's cluster", cP("realtors manteca ca") !== cP("realtor in tracy ca") && cP("realtors manteca ca") === cP("realtor in manteca ca") && /^head term/.test(cP("realtors manteca ca").queries.find((m) => m.query === "realtors manteca ca").basis), JSON.stringify(clPlace.map((c) => [c.head, c.queries.map((m) => m.query)])));
  w(path.join(oth, "research", "seeds.json"), { step: "seeds", status: "ok", queries: [{ query: "leaky {city} query", source: "x" }, { query: "clean query here", source: "x" }] });
  const uniO = cl.buildUniverse(ctxO);
  check("cluster: the universe drops any query that still holds a placeholder and lists it", uniO.some((r) => r.query === "clean query here") && !uniO.some((r) => /[{}]/.test(r.query)) && uniO.dropped.some((d) => /leaky/.test(d.text)), JSON.stringify([uniO.map((r) => r.query), uniO.dropped]));
  const domCap = (q, doms) => ({ query: q, engine: "google", device: "desktop", status: "CAPTURED", capturedAt: "2026-10-17", organic: doms.map((d, i) => ({ position: i + 1, url: null, domain: d, title: `${d} page about ${q}` })), file: q });
  const portalsDoc = ["zillow.com", "realtor.com"];
  const mkc = (q, niche) => domCap(q, ["zillow.com", "realtor.com", ...niche]);
  const legacyCaps = [mkc("realtor in elk grove ca", ["a1.test", "a2.test", "a3.test", "a4.test", "a5.test"]), mkc("real estate agent elk grove ca", ["a1.test", "a2.test", "a3.test", "a4.test", "a6.test"]), mkc("we buy houses elk grove ca", ["b1.test", "b2.test", "b3.test", "b4.test"]), mkc("sell my house fast elk grove ca", ["c1.test", "c2.test", "c3.test", "c4.test"]), mkc("what is a cash offer", ["d1.test", "d2.test", "d3.test", "d4.test"])];
  const legacyUni = legacyCaps.map((c, i) => uni(c.query, null, i));
  const legacyCl = cl.clusterQueries({ universe: legacyUni, captures: legacyCaps, engine: "google", places: [{ city: "Elk Grove", state: "CA", label: "Elk Grove, CA" }] });
  const legacyOf = (q) => legacyCl.find((c) => c.queries.some((m) => m.query === q));
  check("cluster: legacy captures that hold only domains still cluster: niche domains identify a page, portals (zillow, realtor.com) do not make unrelated searches one cluster", legacyOf("realtor in elk grove ca") === legacyOf("real estate agent elk grove ca") && /serp-overlap/.test(legacyOf("real estate agent elk grove ca").queries[1].basis) && legacyOf("we buy houses elk grove ca") !== legacyOf("realtor in elk grove ca") && legacyOf("sell my house fast elk grove ca") !== legacyOf("we buy houses elk grove ca") && /no URLs/.test(legacyOf("realtor in elk grove ca").identity), JSON.stringify(legacyCl.map((c) => [c.head, c.queries.map((m) => m.basis)])));
  void portalsDoc;

  // ============================ existing research ============================
  const exDir = path.join(tmp, "old-research");
  const today = new Date().toISOString().slice(0, 10);
  w(path.join(exDir, "keywords.md"), `---\ntitle: Keyword map\nupdated: 2026-01-05\nclient: Tracy Homes Realty\nstatus: confirmed (rows labelled DRAFT are not)\n---\nVolumes: NOT MEASURED (no SEO tool connected)\n\n| ID | Keyword | City | Difficulty (basis) | Demand signal (source) |\n|---|---|---|---|---|\n| K-01 | realtor in elk grove ca | Elk Grove | Hard: portals fill the top 5 | T1 SG-05 |\n| K-02 | we buy houses lathrop ca | Lathrop | Medium | T0: PAA |\n| K-03 | we buy houses tracy ca | Tracy | Medium | T2 SG-04 (broader phrases only) |\n| K-04 | odd tierless keyword | Tracy | Medium | not collected |\n| K-05 | home value {city} ca | Elk Grove (V-01), Lathrop (V-02) | Hard | T0: LP |\n| K-06 | weird {pattern} without cities | - | Hard | T1 |\n\n| ID | Keyword (query text used) | Place | Difficulty (basis) | Demand (source) |\n|---|---|---|---|---|\n| K-20 | sell house fast probate tracy ca | Tracy | Medium | T1 for Tracy (SG-1); T0 for Manteca |\n\n## B. Cash sale (Pat; also Tracy's /cash-offer)\n\n| ID | Keyword | City | Difficulty | Demand signal |\n|---|---|---|---|---|\n| K-30 | cash shared keyword | Tracy | Hard | T1 |\n\n## C. Pat's own area\n\n| ID | Keyword | City | Difficulty | Demand signal |\n|---|---|---|---|---|\n| K-31 | pat only keyword | X | Hard | T1 |\n\n## D. Tracy-only searches (Tracy)\n\n| ID | Keyword | City | Difficulty | Demand signal |\n|---|---|---|---|---|\n| K-32 | tracy only keyword | Tracy | Hard | T2 |\n`);
  w(path.join(exDir, "question-bank.md"), `---\nupdated: ${today}\nclient: tracyhomes.test\n---\n**Audience:** T = Tracy, P = Pat, B = both\n\n| Question | City | Intent | Seen at |\n|---|---|---|---|\n| Is 3% normal for a real estate agent? | Tracy | cost | Q1-01 |\n| How is the housing market in {city}? | all | market | Q1-09 |\n| Odd {thing} question | - | x | y |\n\n## A. Choosing an agent (T)\n\n| Question | City | Intent | Seen at |\n|---|---|---|---|\n| qb agent question | Tracy | agent | Q9 |\n\n## B. Cash questions (P)\n\n| Question | City | Intent | Seen at |\n|---|---|---|---|\n| qb cash question | Tracy | cash | Q10 |\n\n## C. Costs (B)\n\n| Question | City | Intent | Seen at |\n|---|---|---|---|\n| qb shared question | Tracy | cost | Q11 |\n\n## D. Selling fast and what you keep (P, T)\n\n| Question | City | Intent | Seen at |\n|---|---|---|---|\n| qb two-tag question | Tracy | cash | Q12 |\n`);
  w(path.join(exDir, "entities.md"), `---\nupdated: ${today}\nclient: tracyhomes.test\n---\n| # | Fact | Known so far | Source of truth | Consistent? |\n|---|---|---|---|---|\n| 1 | Francine's licence number | DRE 02236450 | DRE look-up | Yes |\n`);
  const compPort = await serve((r) => {
    if (r.url === "/robots.txt") return { type: "text/plain", body: `User-agent: *\nAllow: /\nUser-agent: GPTBot\nDisallow: /\nSitemap: http://127.0.0.1:${compPort.port}/sitemap.xml\n` };
    if (r.url === "/sitemap.xml") return { type: "application/xml", body: `<urlset><url><loc>http://127.0.0.1:${compPort.port}/realtors-in-tracy</loc><lastmod>2026-09-01</lastmod></url><url><loc>http://127.0.0.1:${compPort.port}/blog/how-to-sell</loc></url></urlset>` };
    if (r.url === "/") return { type: "text/html", body: `<!doctype html><html><head><title>Comp Realty | Tracy</title><meta name="description" content="d"><link rel="canonical" href="http://127.0.0.1/"><script type="application/ld+json">{"@type":"RealEstateAgent","name":"Comp Realty","mainEntity":[{"@type":"Question","name":"q1"}]}</script></head><body><main><h1>Comp Realty</h1><p>${"word ".repeat(200)}</p></main></body></html>` };
    if (r.url === "/realtors-in-tracy") return { type: "text/html", body: `<html><head><title>Realtors in Tracy</title></head><body><main><h1>Realtors in Tracy</h1><p>${"x ".repeat(300)}</p></main></body></html>` };
    return { status: 404, body: "no" };
  });
  const audJson = { date: today, target: "tracyhomes.test", results: [{ input: "oldcomp.test", finalUrl: "https://oldcomp.test/", status: 200, page: { words: 900, platform: "WordPress" }, schema: { questions: 3, types: ["RealEstateAgent"] }, sitemap: { pages: 40, medianLastmodDays: 10, byKind: { city: 5 } }, crawlers: { "OAI-SearchBot": "allowed", Bingbot: "allowed" } }] };
  w(path.join(exDir, "COMPETITOR-AUDIT.json"), audJson);
  w(path.join(exDir, "fresh/A01.google.md"), "Our clients: tracyhomes.test"); w(path.join(exDir, "ai/AI-A01.chatgpt.md"), "answer about tracyhomes.test");
  const e1 = await T("research-existing.mjs", ["--dir", exDir, "--max-age-days", "30"]);
  const ed = rd("existing");
  check("existing: keyword map imported with its date; stale flagged; row line kept; a {pattern} row without cities is skipped", e1.status === 0 && ed.keywords.length === 9 && ed.keywords[0].imported.updated === "2026-01-05" && ed.files.find((f) => /keywords/.test(f.file)).stale === true && ed.keywords[0].imported.line > 0 && !ed.keywords.some((k) => /pattern/.test(k.query)) && !ed.keywords.some((k) => /pat only/.test(k.query)), e1.stdout + JSON.stringify(ed.keywords.map((k) => k.query)));
  const kq = (q) => ed.keywords.find((k) => k.query === q);
  check("existing: a Bing-autocomplete tier becomes a sourced ESTIMATE: tier label, numeric rank, the file and its date as source", kq("realtor in elk grove ca")?.volume.value === "T1 (Bing autocomplete tier)" && kq("realtor in elk grove ca").volume.rank === 3 && kq("realtor in elk grove ca").volume.estimate === true && /keywords\.md \(updated 2026-01-05\)/.test(kq("realtor in elk grove ca").volume.source) && kq("realtor in elk grove ca").volume.fetchedAt.startsWith("2026-01-05") && kq("we buy houses lathrop ca").volume.rank === 1 && kq("we buy houses tracy ca").volume.rank === 2, JSON.stringify(kq("realtor in elk grove ca")?.volume));
  check("existing: a keyword with no tier stays null, NOT MEASURED; a cell naming several tiers counts at its weakest; a {city} pattern row expands per city", kq("odd tierless keyword")?.volume.value === null && /^NOT MEASURED/.test(kq("odd tierless keyword").volume.source) && kq("sell house fast probate tracy ca")?.volume.value === "T0 (Bing autocomplete tier)" && kq("home value elk grove ca")?.volume.rank === 1 && kq("home value lathrop ca")?.location === "Lathrop", JSON.stringify(ed.keywords.map((k) => [k.query, k.volume.value])));
  const qex = ed.questions.map((q) => q.question);
  check("existing: a {city} template row expands per service-area city (business.json), an unfillable one is dropped and listed, nothing with braces is written", ["How is the housing market in Tracy?", "How is the housing market in Manteca?", "How is the housing market in Lathrop?"].every((q) => qex.includes(q)) && !qex.some((q) => /[{}]/.test(q)) && !ed.keywords.some((k) => /[{}]/.test(k.query)) && ed.droppedTemplates.some((d) => d.text === "Odd {thing} question") && ed.droppedTemplates.some((d) => /weird \{pattern\}/.test(d.text)), JSON.stringify([qex, ed.droppedTemplates]));
  check("existing: a section heading that names this business AND another is imported as SHARED (sharedWith on its rows); one that names only another business is refused and listed; unlabelled and own-business tables are imported", kq("cash shared keyword")?.sharedWith?.join() === "Pat" && !ed.keywords.some((k) => k.query === "pat only keyword") && kq("tracy only keyword") && !kq("tracy only keyword").sharedWith && kq("realtor in elk grove ca") && !kq("realtor in elk grove ca").sharedWith && ed.refused.some((r) => /Pat's own area/.test(r.section) && /only another business/.test(r.why)) && ed.sharedRows === 1, JSON.stringify([ed.keywords.map((k) => [k.query, k.sharedWith]), ed.refused]));
  const qq = (q) => ed.questions.find((x) => x.question === q), exm = await imp("research-existing.mjs");
  check("existing: the same rule reads a legend (T = Tracy, P = Pat, B = both) in a question bank: own section imported, the other business's refused, 'both' shared", !!qq("qb agent question") && !qq("qb agent question").sharedWith && !qq("qb cash question") && qq("qb shared question")?.sharedWith?.length === 1 && ed.refused.some((r) => /Cash questions/.test(r.section)) && !!qq("Is 3% normal for a real estate agent?") && qq("qb two-tag question")?.sharedWith?.join() === "Pat" && JSON.stringify(exm.partyTags("## D. Selling fast (E, F)", { E: "Eli", F: "Francine" })) === '["Eli","Francine"]' && JSON.stringify(exm.partyTags('## A. Agent intent: "realtor in {city} ca" (Francine). Variants', {})) === '["Francine"]' && exm.partyTags("## C. Valuation (V captures: Zillow Google #1 11/11)", {}).length === 0, JSON.stringify([ed.questions.map((x) => [x.question, x.sharedWith]).slice(-5), ed.refused.map((r) => r.section)]));
  check("existing: fresh files not stale; questions and entity facts imported with their source line", ed.files.find((f) => /question-bank/.test(f.file)).stale === false && ed.questions[0].question.startsWith("Is 3%") && ed.entities[0].sourceOfTruth === "DRE look-up", JSON.stringify(ed.files.map((f) => [path.basename(f.file), f.stale])));
  check("existing: a seo-kit competitor audit is imported by domain with sourced facts; capture folders are reported", ed.competitorAudits["oldcomp.test"]?.facts.homeWords.value === 900 && isFact(ed.competitorAudits["oldcomp.test"].facts.homeWords) && ed.serpDirs.length === 1 && ed.aiDirs.length === 1, JSON.stringify(Object.keys(ed.competitorAudits)));
  const repo2 = path.join(tmp, "repo2");
  w(path.join(repo2, "icm/knowledge/seo/keywords.md"), `---\nupdated: ${today}\nclient: other.test\nsources:\n  - icm/work/p0.3/KEYWORDS.md (analyst)\n  - Lead re-check: \`ls fresh/*.google.md\` = 2 · \`ls ai-answers/*.md\` = 1\n  - icm/work/p0.2/fresh/<ID>.google.md\n---\n| ID | Keyword | City | Difficulty | Demand signal |\n|---|---|---|---|---|\n| K-01 | realtor in elk grove ca | Elk Grove | Hard | T1 SG-05 |\n`);
  w(path.join(repo2, "icm/work/p0.3/KEYWORDS.md"), "draft");
  w(path.join(repo2, "icm/work/p0.2/captures/A01.md"), '# A01 — "realtor in Elk Grove CA" — 2026-10-17 — query-text city');
  for (const eng of ["google", "bing"]) w(path.join(repo2, `icm/work/p0.2/fresh/A01.${eng}.md`), "## UPDATE 2026-10-17 (night): READ in the OWNER'S EDGE\nOur clients: other.test\nLocation: Google location set to Elk Grove, California with the uule parameter; footer location shown: \"Egypt\"\nOrganic top 10: 1 zillow.com (a) · 2 redfin.com (b) · 3 agent1.test (c) · 4 agent2.test (d)\n");
  w(path.join(repo2, "icm/work/p0.2/ai-answers/AI-A01.chatgpt.md"), "answer about other.test");
  w(path.join(repo2, "icm/work/p0.2/fresh/A01.google.pilot-egypt.md"), "pilot, must not count");
  const e2 = await node("research-existing.mjs", ["https://other.test/", "--cwd", tmp, "--dir", path.join(repo2, "icm/knowledge/seo")]);
  const ed2 = J(path.join(oth, "research", "existing.json"));
  check("existing: follows the sources: front matter of a knowledge file to the capture folders (SERP and AI answers) it was built from", e2.status === 0 && ed2.serpDirs.map((d) => path.basename(d)).join() === "fresh" && ed2.aiDirs.map((d) => path.basename(d)).join() === "ai-answers" && ed2.discoveredVia.some((x) => /fresh/.test(x.ref)) && ed2.discoveredVia.some((x) => /ai-answers/.test(x.ref)) && ed2.keywords[0].volume.rank === 3, e2.stdout + JSON.stringify([ed2.serpDirs, ed2.aiDirs]));
  // ---- isolation: only the folders a target is given; every file must name the business ----
  const noDir = await node("research-existing.mjs", ["https://other.test/", "--cwd", tmp]);
  const edNo = J(path.join(oth, "research", "existing.json"));
  check("existing: a URL target never reads the current folder's icm/knowledge (the decoy there is ignored, not even listed)", noDir.status === 3 && edNo?.status === "blocked" && !JSON.stringify(edNo).includes("Decoy") && !JSON.stringify(edNo).includes("austin"), noDir.stdout + noDir.stderr + JSON.stringify(edNo)?.slice(0, 300));
  const foreign = path.join(tmp, "old-foreign");
  w(path.join(foreign, "keywords.md"), "---\nupdated: 2026-10-01\nclient: Other Business LLC\n---\n| ID | Keyword | City | Difficulty | Demand signal |\n|---|---|---|---|---|\n| K-01 | foreign business keyword | X | Hard | T1 |\n");
  const e3 = await T("research-existing.mjs", ["--dir", exDir, "--dir", foreign]);
  const ed3 = rd("existing");
  check("existing: a file that does not name this business is refused and listed, never imported", e3.status === 0 && ed3.refused.some((x) => /old-foreign/.test(x.file) && /does not name/.test(x.why)) && !ed3.keywords.some((k) => /foreign/.test(k.query)) && ed3.keywords.some((k) => k.query === "realtor in elk grove ca") && /refused/.test(e3.stdout), e3.stdout + JSON.stringify(ed3.refused));
  const aliasDir = path.join(tmp, "old-alias");
  w(path.join(aliasDir, "keywords.md"), "---\nupdated: 2026-10-01\nclient: Mr Alias Owner\n---\n| ID | Keyword | City | Difficulty | Demand signal |\n|---|---|---|---|---|\n| K-01 | alias keyword | X | Hard | T2 |\n");
  await node("research-existing.mjs", ["https://other.test/", "--cwd", tmp, "--dir", aliasDir]);
  const edA = J(path.join(oth, "research", "existing.json"));
  await node("research-existing.mjs", ["https://other.test/", "--cwd", tmp, "--dir", aliasDir, "--alias", "Alias Owner"]);
  const edB = J(path.join(oth, "research", "existing.json"));
  check("existing: an alias the owner names (--alias) makes a file that names only the owner acceptable; without it the file is refused", edA.refused?.length === 1 && !edA.keywords?.length && edB.keywords.length === 1 && edB.keywords[0].query === "alias keyword", JSON.stringify([edA.refused, edB.keywords?.length]));
  const repoX = path.join(tmp, "repoX");
  w(path.join(repoX, ".pewp/business.json"), { ...bz, domain: "repox.test", name: "Repo X" });
  w(path.join(repoX, "icm/knowledge/seo/keywords.md"), "---\nupdated: 2026-10-01\n---\n| ID | Keyword | City | Difficulty | Demand signal |\n|---|---|---|---|---|\n| K-01 | repo only keyword | Tracy | Hard | T2 |\n");
  const eR = await node("research-existing.mjs", [repoX]);
  const edR = J(path.join(repoX, ".pewp/research/existing.json"));
  check("existing: a repo target reads its own icm/knowledge without having to name the business, and nothing from the current folder", eR.status === 0 && edR?.keywords.length === 1 && edR.keywords[0].query === "repo only keyword" && !JSON.stringify(edR).includes("austin"), eR.stdout + eR.stderr + JSON.stringify(edR)?.slice(0, 300));

  // ============================ competitors (polite crawler) ============================
  let blocked429 = 0;
  const comp429 = await serve(() => { blocked429++; return { status: 429, body: "slow down" }; });
  let hitRoot = 0;
  const compRobots = await serve((r) => { if (r.url === "/robots.txt") return { type: "text/plain", body: "User-agent: *\nDisallow: /\n" }; if (r.url === "/") hitRoot++; return { type: "text/html", body: "<html></html>" }; });
  const c1 = await T("research-competitors.mjs", ["--domain", compPort.url, "--domain", comp429.url, "--domain", compRobots.url, "--domain", "oldcomp.test", "--max", "6"], {});
  const cd = rd("competitors"), site = (d) => cd?.sites.find((s) => s.domain === d);
  check("competitors: a site is read like a crawler (schema, FAQ, city pages, sitemap, AI bots blocked), numbers sourced", c1.status === 0 && site(compPort.url)?.facts.faqQuestions.value === 1 && site(compPort.url).facts.cityPages.value >= 1 && site(compPort.url).facts.sitemapPages.value === 2 && site(compPort.url).facts.aiSearchBotsBlocked.value.join() === "" && site(compPort.url).crawlers.GPTBot.startsWith("BLOCKED") && isFact(site(compPort.url).facts.homeWords) && fs.existsSync(site(compPort.url).facts.homeWords.cacheFile), c1.stdout + c1.stderr + JSON.stringify(site(compPort.url))?.slice(0, 400));
  check("competitors: the first 429 stops that site for the run, no retry, reported BLOCKED", /^BLOCKED/.test(site(comp429.url)?.error || "") && blocked429 === 1 && cd.blockedSites.includes(comp429.url), `${blocked429} requests; ${site(comp429.url)?.error}`);
  check("competitors: robots.txt is obeyed: a disallowed site's pages are never fetched", /robots\.txt disallows/.test(site(compRobots.url)?.error || "") && hitRoot === 0, `${hitRoot} hits; ${site(compRobots.url)?.error}`);
  const before = compPort.reqs.length;
  await T("research-competitors.mjs", ["--domain", compPort.url, "--max", "1"]);
  check("competitors: a re-run is served from the cache (no new requests to the site)", compPort.reqs.length === before, `${before} -> ${compPort.reqs.length}`);
  check("competitors: an honest user agent, one attempt per URL", compPort.reqs.every((q) => /PEWP-SiteResearch/.test(q.headers["user-agent"])) && new Set(compPort.reqs.map((q) => q.url)).size === compPort.reqs.length, JSON.stringify(compPort.reqs.map((q) => q.url)));
  check("competitors: a fresh audit imported from earlier research is reused, not fetched again", site("oldcomp.test")?.reused === true && site("oldcomp.test").facts.homeWords.value === 900, JSON.stringify(site("oldcomp.test"))?.slice(0, 200));
  const brokenCtx = { business: { domain: HOST, name: "Tracy Homes Realty", competitors: [] }, market: { country: "US", language: "en" }, domain: HOST, loc: { kind: "url" }, pewp: loc.pewp, rdir: path.join(loc.pewp, "research") };
  // authority on a tiny fake Common Crawl graph (same layout as test-phase1)
  const comp = await imp("research-competitors.mjs");
  // Politeness (Omnikom rule, 2026-11-11): a third-party site gets at most one request every 4 s, and every fetch is paced by that constant.
  const compSrc = fs.readFileSync(path.join(dir, "research-competitors.mjs"), "utf8");
  check("competitors: a site is read at most one request every 4 s (SITE_GAP_MS >= 4000, and the fetch is paced by it)", comp.SITE_GAP_MS >= 4000 && /await pace\(url, SITE_GAP_MS\);/.test(compSrc) && !/await pace\(url, \d+\)/.test(compSrc) && /1 request per 4 s per site/.test(comp.CRAWL_UA), `${comp.SITE_GAP_MS} ms; ${comp.CRAWL_UA}`);
  const cc = path.join(tmp, "cc"), rel = "cc-test-rel";
  const gz = (name, lines) => w(path.join(cc, `${rel}-domain-${name}.txt.gz`), zlib.gzipSync(lines.join("\n") + "\n"));
  gz("vertices", [["com.target", 0], ["com.c1", 1], ["com.c2", 2], ["com.a", 3], ["com.b", 4]].map(([d, id]) => `${id}\t${d}\t1`));
  gz("edges", ["4\t0", "4\t1", "3\t1", "3\t2"]);
  gz("ranks", ["#harmonicc_pos\t#harmonicc_val\t#pr_pos\t#pr_val\t#host_rev\t#n_hosts", "1\t9\t1\t9\tcom.a\t1", "2\t8\t2\t8\tcom.b\t1", "3\t7\t3\t7\tcom.target\t1", "4\t6\t4\t6\tcom.c1\t1", "5\t5\t5\t5\tcom.c2\t1"]);
  const origLog = console.log; console.log = () => {};
  const aNo = await comp.runAuthority(brokenCtx, { target: "target.com", competitors: ["c1.com", "c2.com"], cache: cc, release: rel, run: false });
  const aRun = await comp.runAuthority(brokenCtx, { target: "target.com", competitors: ["c1.com", "c2.com"], cache: cc, release: rel, run: true });
  const aReuse = await comp.runAuthority(brokenCtx, { target: "target.com", competitors: ["c1.com", "c2.com"], cache: cc, release: rel, run: true });
  const aBlocked = await comp.runAuthority({ ...brokenCtx, pewp: path.join(tmp, "other-pewp") }, { target: "target.com", competitors: [], cache: path.join(tmp, "empty-cc"), release: null, run: true });
  console.log = origLog;
  check("authority: costly disk read only on request; with a cached release it runs authority.mjs, then reuses its dated file", aNo.status === "not-run" && aRun.status === "ran" && aRun.doc.linkGap[0].domain === "a.com" && aRun.doc.results[0].linkingDomains === 1 && aReuse.status === "reused", JSON.stringify([aNo.status, aRun.status, aReuse.status, aRun.doc?.linkGap]));
  check("authority: no cached Common Crawl release => blocked with what unblocks it", aBlocked.status === "blocked" && /release/.test(aBlocked.why), JSON.stringify(aBlocked));
  compPort.close(); comp429.close(); compRobots.close();

  // ---- G7: the audited competitors are exactly the owner-approved list (contract C3: approved/competitors.json) ----
  const csA = await serve((r) => (r.url === "/robots.txt" ? { type: "text/plain", body: "User-agent: *\nAllow: /\n" } : r.url === "/" ? { type: "text/html", body: `<html><head><title>Rival A</title></head><body><main><h1>Rival A</h1>${"w ".repeat(200)}</main></body></html>` } : { status: 404, body: "" }));
  const apprFile = path.join(MOPP, "approved", "competitors.json");
  w(apprFile, { step: "competitors-discover", business: "mop.test", rows: [
    { name: "Rival A", domain: csA.url, handle: null, platform: "web", kind: "publisher", evidenceUrl: "https://example.test/a", closeness: 4, note: "" },
    { name: "Circa", domain: null, handle: "@circahouses", platform: "instagram", kind: "social-curator", evidenceUrl: "https://example.test/ig", closeness: 5, note: "" }] });
  w(path.join(MOPP, "research", "serp.json"), { step: "serp", status: "ok", captures: [{ organic: [{ domain: "suggested.test", position: 1, url: "https://suggested.test/x" }] }] }); // a results page won by a site nobody approved
  const mc = await node("research-competitors.mjs", ["https://mop.test/", "--cwd", tmp, "--approved-competitors", apprFile, "--from-serp"]);
  const mcd = J(path.join(MOPP, "research", "competitors.json"));
  check("competitors: with --approved-competitors the audited sites are exactly the approved rows that have a domain; business.json competitors are not audited; the handle-only row is listed, not audited; --from-serp picks are only suggested", mc.status === 0 && JSON.stringify(mcd.audited) === JSON.stringify([csA.url]) && mcd.sites.length === 1 && !!mcd.sites[0].facts && JSON.stringify(mcd.suggested) === '["suggested.test"]' && mcd.withoutDomain.length === 1 && mcd.withoutDomain[0].handle === "@circahouses" && mcd.approvedRows === 2 && csA.reqs[0]?.url === "/robots.txt", mc.stdout + mc.stderr + JSON.stringify(mcd).slice(0, 500));
  w(path.join(MOPP, "approved", "handles-only.json"), { rows: [{ name: "Circa", domain: null, handle: "@circahouses" }] });
  const mcH = await node("research-competitors.mjs", ["https://mop.test/", "--cwd", tmp, "--approved-competitors", path.join(MOPP, "approved", "handles-only.json")]);
  const mcMissing = await node("research-competitors.mjs", ["https://mop.test/", "--cwd", tmp, "--approved-competitors", path.join(MOPP, "approved", "nope.json")]);
  check("competitors: an approved list with no website is BLOCKED (exit 3, says why) and a missing file is a usage error (exit 2), neither falls back to business.json", mcH.status === 3 && /no row with a domain/.test(mcH.stdout) && mcMissing.status === 2 && /file not found/.test(mcMissing.stderr), mcH.stdout + mcMissing.stderr);

  // ============================ AI citations ============================
  let gcalls = 0, gstop = 99;
  const gem = await serve((r) => {
    gcalls++;
    if (r.headers["x-goog-api-key"] !== "GEM-KEY") return { status: 403, body: {} };
    if (gcalls > gstop) return { status: 429, body: {} };
    const ours = gcalls === 1;
    return { body: { candidates: [{ content: { parts: [{ text: ours ? "SECRET-ANSWER-TEXT Tracy Homes Realty is a good choice." : "SECRET-ANSWER-TEXT Try zillow." }] }, groundingMetadata: { webSearchQueries: ["best realtor tracy"], groundingChunks: [{ web: { uri: "https://vertexaisearch.example/x", title: ours ? HOST : "zillow.com" } }, { web: { uri: "https://vertexaisearch.example/y", title: "yelp.com" } }] } }] } };
  });
  const aenv = { GEMINI_API_BASE: gem.url, GEMINI_API_KEY: "GEM-KEY", PEWP_GEMINI_TERMS_ACK: "1" };
  fs.rmSync(path.join(loc.pewp, "captures", "ai"), { recursive: true, force: true });
  const a0 = await T("research-ai.mjs", ["--gemini", "--question", "best realtor in tracy ca", "--runs", "3"], { ...aenv, PEWP_GEMINI_TERMS_ACK: "" });
  const ad0 = rd("ai-citations");
  check("ai: Gemini is BLOCKED until the owner acknowledges its terms (PEWP_GEMINI_TERMS_ACK, the same gate as measure and doctor): no call is made", a0.status === 0 && ad0?.gemini?.status === "blocked" && /PEWP_GEMINI_TERMS_ACK/.test(ad0.gemini.unblock || "") && !ad0.rows.some((r) => r.engine === "gemini-grounded") && gcalls === 0, a0.stdout + a0.stderr + ` calls ${gcalls} ` + JSON.stringify(ad0?.gemini));
  const aiMod = await import(pathToFileURL(path.join(dir, "research-ai.mjs")).href);
  check("ai: Gemini samples are spaced at least 60 s apart (06 section 9.6; the declared pacing constant, PEWP_TEST_GAP_MS shortens it for local servers only)", aiMod.GEMINI_GAP_MS >= 60000, String(aiMod.GEMINI_GAP_MS));
  const a1 = await T("research-ai.mjs", ["--gemini", "--question", "best realtor in tracy ca", "--runs", "3"], aenv);
  const ad = rd("ai-citations"), row = ad?.rows.find((r) => r.engine === "gemini-grounded");
  check("ai: the question is asked N times; citedShare = share of runs citing our domain (1 of 3), sourced, with prompt, model, runs, location", a1.status === 0 && gcalls === 3 && row.runs === 3 && Math.abs(row.citedShare.value - 1 / 3) < 0.001 && isFact(row.citedShare) && row.prompt === "best realtor in tracy ca" && !!row.model && !!row.location && row.ourDomainCited === true && row.citedSources[0] === "yelp.com" && row.citedSources.includes("zillow.com") && row.citedSources.includes(HOST), a1.stdout + a1.stderr + JSON.stringify(row));
  check("ai: the raw Gemini answer is never stored (grounded results may not be kept; only derived fields)", !fs.readFileSync(path.join(loc.pewp, "research", "ai-gemini-runs.json"), "utf8").includes("SECRET-ANSWER-TEXT") && !fs.readFileSync(path.join(loc.pewp, "research", "ai-citations.json"), "utf8").includes("SECRET-ANSWER-TEXT") && !fs.existsSync(path.join(loc.pewp, "cache", "gemini")));
  const a2 = await T("research-ai.mjs", ["--gemini", "--question", "best realtor in tracy ca", "--runs", "3"], aenv);
  check("ai: runs already paid for are not asked again", a2.status === 0 && gcalls === 3, `${gcalls} calls`);
  gstop = 4; fs.rmSync(path.join(loc.pewp, "research", "ai-gemini-runs.json"));
  const a3 = await T("research-ai.mjs", ["--gemini", "--question", "second question here", "--runs", "3"], aenv);
  const d3 = rd("ai-citations");
  check("ai: a 429 stops the Gemini part and keeps the runs already done (partial, not failed)", a3.status === 0 && d3.gemini.status === "partial" && /429/.test(d3.gemini.stoppedBy) && d3.rows.find((r) => r.engine === "gemini-grounded").runs === 1, a3.stdout + a3.stderr + JSON.stringify(d3.gemini));
  const a4 = await node("research-ai.mjs", ["https://other.test/", "--cwd", tmp, "--gemini", "--question", "q"], { GEMINI_API_KEY: "" });
  check("ai: no key and no captures => BLOCKED exit 3 with both ways out", a4.status === 3 && /GEMINI_API_KEY/.test(a4.stdout) && /owner'?s browser/.test(a4.stdout), a4.stdout + a4.stderr);
  gem.close();
  const aiDir = path.join(loc.pewp, "captures", "ai");
  for (let n = 1; n <= 3; n++) w(path.join(aiDir, `chatgpt-${n}.json`), { engine: "ChatGPT", question: "best realtor in tracy ca", prompt: "best realtor in tracy ca", capturedAt: `2026-10-2${n}`, browser: "owner's Edge", answer: n < 3 ? "Tracy Homes Realty is recommended" : "Try Zillow", sources: n < 3 ? [{ url: `https://${HOST}/about` }, { url: "https://yelp.com/x" }] : [{ url: "https://zillow.com/y" }] });
  w(path.join(aiDir, "perplexity-nodate.json"), { engine: "perplexity", question: "best realtor in tracy ca", sources: [] });
  w(path.join(aiDir, "copilot-1.json"), { engine: "copilot", question: "best realtor in tracy ca", capturedAt: "2026-10-21", capturedIn: "owner's Edge", citedDomains: [HOST, "redfin.com"] }); // measure's capture format, same folder
  w(path.join(aiDir, "AI-A01.gemini.md"), `# AI-A01.gemini — "best realtor in Elk Grove, CA" — Google Gemini — 2026-10-17 (night) — owner's Edge\nLocation the assistant assumed or stated: Elk Grove, California\n\n## Answer (verbatim, full)\nSuneet Agarwal is highly recommended.\n\n## Sources cited (domains)\nfastexpert.com (cited inline). zillow.com\n`);
  const a5 = await T("research-ai.mjs", []);
  const d5 = rd("ai-citations"), cg = d5?.rows.find((r) => r.engine === "chatgpt");
  check("ai: owner-captured ChatGPT answers (3 runs) give a share of runs citing us (2 of 3), with who is cited instead", a5.status === 0 && cg.runs === 3 && Math.abs(cg.citedShare.value - 2 / 3) < 0.001 && cg.citedSources.includes("yelp.com") && cg.capturedBy.includes("owner") && isFact(cg.citedShare), a5.stdout + a5.stderr + JSON.stringify(cg));
  check("ai: a capture without a date is rejected; the project's AI-<ID>.<engine>.md format is read", d5.owner.rejected.some((x) => /perplexity-nodate/.test(x.file) && /date/.test(x.reason)) && d5.rows.some((r) => r.engine === "gemini" && r.question === "best realtor in Elk Grove, CA" && r.citedSources.includes("fastexpert.com")), JSON.stringify(d5.owner.rejected));
  const cp = d5?.rows.find((r) => r.engine === "copilot");
  check("ai: an owner capture in measure's citedDomains form (the same captures/ai folder) counts its citations, not zero", !!cp && cp.citedShare.value === 1 && cp.ourDomainCited === true && cp.citedSources.includes("redfin.com"), JSON.stringify(cp));
  check("ai: Google AI Overviews inside SERP captures become rows (we are cited: the capture lists our domain)", d5.rows.some((r) => r.engine === "google-ai-overview" && r.question === "realtor in tracy ca" && r.citedShare.value === 1), JSON.stringify(d5.rows.map((r) => r.engine)));

  // ============================ research.mjs end to end ============================
  const e2eEnv = { GSC_API_BASE: "", GSC_TOKEN_FILE: tokF };
  const gs2 = await serve((r) => {
    if (r.url.includes("/searchAnalytics/query")) return { body: { rows: [{ keys: ["we buy houses tracy ca", `https://${HOST}/we-buy-houses-tracy`, "usa", "MOBILE"], clicks: 12, impressions: 340, ctr: 0.0353, position: 8.46 }, { keys: ["tracy home value", `https://${HOST}/we-buy-houses-tracy`, "usa", "MOBILE"], clicks: 1, impressions: 20, ctr: 0.05, position: 30.2 }] } };
    if (r.url.startsWith("/webmasters/v3/sites")) return { body: { siteEntry: [{ siteUrl: `sc-domain:${HOST}` }] } };
  });
  const cs = await serve((r) => (r.url === "/robots.txt" ? { type: "text/plain", body: "User-agent: *\nAllow: /\n" } : r.url === "/" ? { type: "text/html", body: `<html><head><title>Rival</title></head><body><main><h1>Rival</h1>${"w ".repeat(200)}</main></body></html>` } : { status: 404, body: "" }));
  const common = ["--query", "realtor in tracy ca", "--query", "real estate agent tracy ca", "--query", "realtor in manteca ca", "--query", "we buy houses tracy ca", "--query", "what is a cash offer on a house", "--query", "realtors tracy ca", "--kwp-file", csvFile, "--competitor", cs.url, "--max-competitors", "3", "--device", "mobile", "--existing-dir", exDir];
  const dry = await T("research.mjs", [...common, "--dry"], { ...e2eEnv, GSC_API_BASE: gs2.url });
  check("research: --dry prints the plan (stages, 0 workers, calls, $0) and fetches nothing", dry.status === 0 && /PLAN research/.test(dry.stdout) && /workers: 0/.test(dry.stdout) && /\$0/.test(dry.stdout) && /seeds: \d+ in research\/seeds.json, NOT approved/.test(dry.stdout) && !fs.existsSync(path.join(loc.pewp, "targets.json")) && gs2.reqs.length === 0 && cs.reqs.length === 0, dry.stdout + dry.stderr);
  const big = await T("research.mjs", [...common, "--confirm-above", "1"], { ...e2eEnv, GSC_API_BASE: gs2.url });
  check("research: a plan above the call limit needs the owner's OK (exit 3), nothing fetched", big.status === 3 && /BLOCKED: .*approves/.test(big.stdout) && gs2.reqs.length === 0, big.stdout + big.stderr);
  // G3: the seeds are a proposal; Bing, forums and the capture list wait for the owner's approval (approved/seeds.json equal to research/seeds.json) or --yes
  const ng = await T("research.mjs", common, { ...e2eEnv, GSC_API_BASE: gs2.url });
  check("research: seeds nobody approved => exit 3 with `NEEDS-APPROVAL seeds:` (show research/seeds.json, run approve.mjs <target> seeds --by NAME, or --yes), nothing fetched, no targets.json", ng.status === 3 && /^NEEDS-APPROVAL seeds: the 6 seed queries in research\/seeds.json have not been approved/m.test(ng.stdout) && /approve\.mjs https:\/\/tracyhomes\.test\/ seeds --by NAME/.test(ng.stdout) && /re-run with --yes/.test(ng.stdout) && gs2.reqs.length === 0 && cs.reqs.length === 0 && !fs.existsSync(path.join(loc.pewp, "targets.json")), ng.stdout.slice(-700) + ng.stderr);
  const seedsProposed = J(path.join(loc.pewp, "research", "seeds.json"));
  w(path.join(loc.pewp, "approved", "seeds.json"), { ...seedsProposed, queries: seedsProposed.queries.slice(1).concat([{ query: "something the owner added", from: "owner" }]) });
  const ng2 = await T("research.mjs", common, { ...e2eEnv, GSC_API_BASE: gs2.url });
  check("research: an approved list that differs from research/seeds.json (one query not approved, one approved query gone) still blocks, and says how many", ng2.status === 3 && /^NEEDS-APPROVAL seeds: .*differ from the approved list: 1 not approved yet \(realtor in tracy ca\), 1 approved but no longer/m.test(ng2.stdout) && gs2.reqs.length === 0, ng2.stdout.slice(-700));
  fs.copyFileSync(path.join(loc.pewp, "research", "seeds.json"), path.join(loc.pewp, "approved", "seeds.json")); // the owner approved exactly this list (approve.mjs seeds copies the file)
  const rs = await T("research.mjs", common, { ...e2eEnv, GSC_API_BASE: gs2.url });
  const tg = J(path.join(loc.pewp, "targets.json"));
  check("research: runs end to end on fixtures and writes targets.json (exit 0)", rs.status === 0 && tg && tg.version === 1 && tg.business === HOST && tg.market.country === "US" && tg.clusters.length >= 4 && /targets-validate.mjs exit 0/.test(rs.stdout), rs.stdout + rs.stderr);
  const collectStrings = (o, keys, out = []) => { if (Array.isArray(o)) o.forEach((x) => collectStrings(x, keys, out)); else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (keys.includes(k)) [].concat(v).forEach((x) => typeof x === "string" && out.push(x)); collectStrings(v, keys, out); } return out; };
  const QKEYS = ["query", "primaryQuery", "queries", "head", "question", "questions", "requiredEntities", "location"];
  const written = ["existing", "seeds", "clusters", "unmeasured", "forums", "serp", "ai-citations"].map((n) => [n, rd(n)]).concat([["targets", tg]]);
  const braceHits = written.flatMap(([n, d]) => (d ? collectStrings(d, QKEYS).filter((s) => /[{}]/.test(s)).map((s) => n + ": " + s) : []));
  check("research: no written query, cluster or target contains { or } (templates are expanded or dropped and listed)", braceHits.length === 0 && written.filter(([, d]) => d).length >= 5, braceHits.join(" | "));
  const SCHEMA_KEYS = ["id", "primaryQuery", "queries", "intent", "location", "volume", "difficulty", "value", "serpFeatures", "winningFormat", "winningPageType", "requiredTerms", "competitorsTop3", "requiredEntities", "questions", "targetPage", "priority"].sort().join();
  check("targets.json: exactly the schemas/targets.md fields; unique ids; unique primary queries (no cannibalisation)", tg.clusters.every((c) => Object.keys(c).filter((k) => k !== "wordRange" && k !== "sharedWith").sort().join() === SCHEMA_KEYS) && new Set(tg.clusters.map((c) => c.id)).size === tg.clusters.length && new Set(tg.clusters.map((c) => c.primaryQuery)).size === tg.clusters.length && Object.keys(tg).sort().join() === "business,clusters,createdAt,market,version", Object.keys(tg.clusters[0]).join());
  check("targets.json: every number is a sourced number (value, source, fetchedAt, cacheFile); market on the file", tg.clusters.every((c) => isFact(c.volume) && isFact(c.serpFeatures) && (c.difficulty === null || isFact(c.difficulty)) && (c.value === null || isFact(c.value)) && typeof c.priority === "number"));
  const cc1 = (q) => tg.clusters.find((c) => c.queries.includes(q));
  check("targets.json: the cluster is headed by the best-sourced volume (Keyword Planner estimate), the other variants are inside it", cc1("realtor in tracy ca").primaryQuery === "real estate agent tracy ca" && cc1("realtor in tracy ca").volume.estimate === true && cc1("realtor in tracy ca").volume.range.join() === "1000,10000" && cc1("realtors tracy ca") === cc1("realtor in tracy ca"), JSON.stringify(cc1("realtor in tracy ca")));
  const unm = J(path.join(loc.pewp, "research", "unmeasured.json"));
  check("targets.json: a search no source has a number for is LISTED as unmeasured, not given a made-up volume", tg.clusters.every((c) => typeof c.volume.value === "number" || (typeof c.volume.value === "string" && c.volume.estimate === true && c.volume.rank > 0)) && unm.searches.some((s) => s.primaryQuery === "odd row" && s.volume.value === null && /^NOT MEASURED/.test(s.volume.source)) && unm.searches.some((s) => s.primaryQuery === "odd tierless keyword") && !tg.clusters.some((c) => c.queries.includes("odd row")), JSON.stringify(unm.searches.map((s) => s.primaryQuery)));
  const tierC = cc1("realtor in elk grove ca"), wbhC = cc1("we buy houses tracy ca");
  check("targets.json: with no measured volume the cluster carries the tier estimate (label, estimate:true, rank, file + date as source)", tierC?.volume.value === "T1 (Bing autocomplete tier)" && tierC.volume.estimate === true && tierC.volume.rank === 3 && /keywords\.md \(updated 2026-01-05\)/.test(tierC.volume.source) && tierC.volume.fetchedAt.startsWith("2026-01-05") && tierC.location === "Elk Grove, CA", JSON.stringify(tierC));
  check("targets.json: a measured volume (Keyword Planner 320) always beats the tier estimate (T2) the keyword map also has", wbhC?.volume.value === 320 && !wbhC.volume.rank && !/tier/.test(wbhC.volume.source), JSON.stringify(wbhC?.volume));
  const shC = cc1("cash shared keyword"), repShared = fs.readFileSync(path.join(loc.pewp, "research", "report.md"), "utf8");
  check("targets.json: a cluster from a section shared with another business carries sharedWith; report.md lists it as 'owner decides' and says which section was not imported; the other business's own keywords never become clusters", JSON.stringify(shC?.sharedWith) === '["Pat"]' && !tg.clusters.some((c) => c.queries.some((q) => /pat only/.test(q))) && /Shared with another business: owner decides/.test(repShared) && /cash shared keyword/.test(repShared.split("Shared with another business")[1] || "") && /Not imported \(a section that names only another business\).*Pat's own area/.test(repShared) && !cc1("tracy only keyword")?.sharedWith, JSON.stringify(shC) + repShared.slice(0, 300));
  let rep0;
  const smry = J(path.join(loc.pewp, "research", "summary.json"));
  check("targets.json: report.md and summary.json name the clusters that rest on a tier estimate, and only those", /Clusters resting on a tier estimate/.test(rep0 = fs.readFileSync(path.join(loc.pewp, "research", "report.md"), "utf8")) && rep0.split("Clusters resting on a tier estimate")[1].split("\n")[0].includes("realtor in elk grove ca") && !rep0.split("Clusters resting on a tier estimate")[1].split("\n")[0].includes("we buy houses tracy ca") && smry.tierEstimateClusters.includes("realtor in elk grove ca") && !smry.tierEstimateClusters.includes("we buy houses tracy ca") && /rest on a free demand-tier estimate/.test(rep0), String(rep0).slice(0, 700));
  check("targets.json: local intent has a location; places are 'city, ST'", tg.clusters.filter((c) => c.intent === "local").every((c) => /^[A-Z][A-Za-z .'-]+, [A-Z]{2}$/.test(c.location || "")) && cc1("realtor in manteca ca").location === "Manteca, CA" && cc1("what is a cash offer on a house").intent === "informational" && cc1("what is a cash offer on a house").location === null, JSON.stringify(tg.clusters.map((c) => [c.primaryQuery, c.intent, c.location])));
  check("targets.json: target page = an existing page that answers it, else the page Search Console shows, else new", cc1("realtor in tracy ca").targetPage === "/" && cc1("we buy houses tracy ca").targetPage === "/we-buy-houses-tracy" && cc1("realtor in manteca ca").targetPage === "new", JSON.stringify(tg.clusters.map((c) => [c.primaryQuery, c.targetPage])));
  check("targets.json: one cluster = one page: when two clusters map to the same existing page the higher priority keeps it, the other becomes a new page", tg.clusters.filter((c) => c.targetPage === "/we-buy-houses-tracy").length === 1 && cc1("we buy houses tracy ca").targetPage === "/we-buy-houses-tracy" && cc1("tracy home value").targetPage === "new", JSON.stringify(tg.clusters.map((c) => [c.primaryQuery, c.targetPage, c.priority])));
  check("targets.json: SERP features, top-3 competitors (not us), PAA questions and the winning format come from the capture", cc1("realtor in tracy ca").serpFeatures.value.includes("ai_overview") && cc1("realtor in tracy ca").serpFeatures.value.includes("local_pack") && cc1("realtor in tracy ca").competitorsTop3.length === 3 && cc1("realtor in tracy ca").competitorsTop3.every((x) => x.domain !== HOST) && cc1("we buy houses tracy ca").questions.includes("Is it safe to sell to a cash buyer?") && /page|guide|listing|directory|home/.test(cc1("realtor in tracy ca").winningFormat), JSON.stringify(cc1("realtor in tracy ca")).slice(0, 600));
  check("targets.json: a query with no capture says NOT CAPTURED (no invented SERP)", tg.clusters.filter((c) => /^NOT CAPTURED/.test(c.serpFeatures.source)).length >= 1 && tg.clusters.every((c) => /^NOT CAPTURED/.test(c.serpFeatures.source) ? c.serpFeatures.value.length === 0 && /UNKNOWN/.test(c.serpFeatures.source) && c.winningFormat.startsWith("unknown") : c.serpFeatures.device && c.serpFeatures.location), JSON.stringify(tg.clusters.map((c) => [c.primaryQuery, c.serpFeatures.source.slice(0, 30)])));
  check("targets.json: priority orders the list, highest first", tg.clusters.every((c, i) => i === 0 || tg.clusters[i - 1].priority >= c.priority), JSON.stringify(tg.clusters.map((c) => c.priority)));
  const rep = fs.readFileSync(path.join(loc.pewp, "research", "report.md"), "utf8"), sm = J(path.join(loc.pewp, "research", "summary.json"));
  check("research: BLOCKED steps are listed with what unblocks them (Bing key, ...), never silently dropped", rep.split("\n").some((l) => /^\| Bing Webmaster \| BLOCKED/.test(l) && /BING_WEBMASTER_KEY/.test(l)) && sm.steps.find((s) => s.step === "Bing Webmaster").status === "blocked" && sm.steps.find((s) => s.step === "Search Console").status === "ok", rep.slice(0, 900));
  check("research: report.md is plain words: short answer first, the numbered sections, terms explained once", /^# Research: .*\n\n\*\*Short answer:\*\*/.test(rep) && ["## 1. Demand", "## 2. What the results pages", "## 3. Competitors", "## 4. Adjacent", "## 5. AI answers", "## 6. Linkable asset ideas", "## 7. Local citation sources", "## 8. Still to do"].every((h) => rep.includes(h)) && rep.split("**cluster**").length === 2 && rep.split("**SERP**").length === 2);
  const cr = J(path.join(loc.pewp, "research", "capture-requests.json"));
  check("research: lists the results pages still to capture (human pace 45 s) and the AI questions for the owner's browser", cr.paceSeconds === 45 && /stop at the first robot check/.test(cr.rules) && cr.items.some((i) => i.engine === "bing") && !cr.items.some((i) => i.engine === "google" && i.query === "realtor in tracy ca" && i.device === "mobile") && cr.aiRequests.some((x) => x.engine === "perplexity" && x.runs === 3), JSON.stringify(cr).slice(0, 500));
  const asj = rd("assets"), ctj = rd("citations");
  check("research: every asset idea carries its evidence; every citation source says why it is listed, and whether the business is listed (listed|unknown); report.md has both sections", asj?.ideas.length >= 1 && asj.ideas.every((i) => i.evidence.length > 0 && i.title && i.why) && ctj?.sources.length >= 1 && ctj.sources.every((c) => ["listed", "unknown"].includes(c.status) && c.evidence.length > 0 && c.why) && /## 6\. Linkable asset ideas/.test(rep) && /## 7\. Local citation sources/.test(rep), JSON.stringify([asj?.ideas.map((i) => i.id), ctj?.sources.map((c) => c.domain)]));
  check("research: the capture list asks for autocomplete too (seed, engine, location, how), because scripts never fetch it", cr.autocompleteRequests?.length > 0 && cr.autocompleteRequests.every((x) => x.seed && x.engine && x.language && /Enter|press/.test(x.how) && /captures\/autocomplete/.test(x.saveAs)), JSON.stringify(cr.autocompleteRequests?.slice(0, 2)));
  const st = J(path.join(loc.pewp, "state.json"));
  check("research: stage recorded in state.json with partial + the blocked steps", st.stages.research?.partial === true && st.stages.research.blocked.includes("Bing Webmaster") && !!st.stages.research.outputs["targets.json"], JSON.stringify(st.stages.research));
  check("research: the competitor named in the answers was audited politely (robots first)", cs.reqs[0]?.url === "/robots.txt" && cs.reqs.every((q) => /PEWP-SiteResearch/.test(q.headers["user-agent"])) && !!J(path.join(loc.pewp, "research", "competitors.json")).sites.find((s) => s.domain === cs.url)?.facts, cs.reqs.map((q) => q.url).join());
  const bad = await node("research.mjs", [URLT, "--cwd", path.join(tmp, "no-intake-here")]);
  check("research: no business.json (intake not done) => BLOCKED exit 3", bad.status === 3 && /BLOCKED: .*S1 intake/.test(bad.stdout), bad.stdout + bad.stderr);
  gs2.close(); cs.close();
  // ---- the Matter of Place shape end to end: seeds the owner approves, approved competitors, Bing with the relevance filter, a location that is a list ----
  const mopArgs = ["https://mop.test/", "--cwd", tmp, ...mopSeedsB.flatMap((s) => ["--query", s]), "--device", "mobile"];
  const mopReqs0 = mb.reqs.length;
  const m0 = await node("research.mjs", mopArgs, menv);
  check("research: seeds nobody approved block Bing, forums and the capture list: exit 3, `NEEDS-APPROVAL seeds:` says to show research/seeds.json and run approve.mjs <target> seeds --by NAME (or --yes), and not one request is made", m0.status === 3 && /^NEEDS-APPROVAL seeds: /m.test(m0.stdout) && /research[\\/]seeds\.json/.test(m0.stdout) && /approve\.mjs https:\/\/mop\.test\/ seeds --by NAME/.test(m0.stdout) && /--yes/.test(m0.stdout) && mb.reqs.length === mopReqs0 && !fs.existsSync(path.join(MOPP, "targets.json")), m0.stdout.slice(-700) + m0.stderr);
  fs.copyFileSync(path.join(MOPP, "research", "seeds.json"), path.join(MOPP, "approved", "seeds.json")); // what approve.mjs <target> seeds does (the lock is its job)
  const m1 = await node("research.mjs", mopArgs, menv);
  const mt = J(path.join(MOPP, "targets.json")), mbEnd = J(path.join(MOPP, "research", "bing.json")), mrep = fs.existsSync(path.join(MOPP, "research", "report.md")) ? fs.readFileSync(path.join(MOPP, "research", "report.md"), "utf8") : "";
  check("research: with the seeds approved (approved/seeds.json lists the same queries) the run goes on; Bing's off-topic keywords never reach targets.json and report.md counts them", m1.status === 0 && mt?.clusters.length >= 3 && mbEnd.droppedOffTopic.length > 20 && mrep.includes(`Bing related keywords dropped as off-topic: ${mbEnd.droppedOffTopic.length} (see research/bing.json droppedOffTopic)`) && !mt.clusters.some((c) => c.queries.some((q) => /zillow|redfin|realtor|manhole|slope|clear cache|windows product|cars for sale|boats/.test(q))), m1.stdout.slice(-900) + m1.stderr + mrep.slice(0, 300));
  check("targets.json: a business whose one location is the list 'California, New York and Florida' never gets that combined name as a place or a location", !/california, new york( and|,)/i.test(JSON.stringify(mt)) && !/california, new york/i.test(fs.readFileSync(path.join(MOPP, "research", "capture-requests.json"), "utf8")) && mt.clusters.every((c) => c.location === null || ["California", "New York", "Florida"].includes(c.location)), JSON.stringify(mt.clusters.map((c) => [c.primaryQuery, c.location])));
  const mcd2 = J(path.join(MOPP, "research", "competitors.json"));
  check("research: when approved/competitors.json exists research.mjs audits exactly its rows with a domain (not business.json's), keeps the handle-only row in the report", JSON.stringify(mcd2.audited) === JSON.stringify([csA.url]) && !mcd2.sites.some((s) => /dwell/.test(s.domain || "")) && /owner-approved list \(1 websites from 2 rows\)\. Kept for the report and the offsite plan, not audited \(no website\): @circahouses/.test(mrep), JSON.stringify(mcd2.audited) + mrep.split("## 3.")[1]?.slice(0, 400));
  const m2 = await node("research.mjs", [...mopArgs, "--no-related"], menv);
  const mbNo2 = J(path.join(MOPP, "research", "bing.json"));
  check("research: --no-related is passed to Bing (seed volumes only, no related keywords, no dropped list)", m2.status === 0 && mbNo2.relatedAsked === false && mbNo2.keywords.every((k) => k.related === false) && mbNo2.keywords.length === 3, m2.stdout.slice(-500) + m2.stderr);
  mb.close(); csA.close();
  // report.md lines that depend on other steps: the device mismatch of the captures (set by the serp step), the off-topic count
  {
    const rctx = { business: { name: "X", domain: "x.test", market: { country: "US", language: "en" } }, market: { country: "US", language: "en" } };
    const rr = (await imp("research.mjs")).reportMd(rctx, { serp: { captures: [], deviceMismatch: { captured: ["desktop"], wanted: ["mobile"], count: 24 } }, bing: { status: "ok", droppedOffTopic: [{}, {}, {}] }, competitors: null }, { clusters: [] }, [], { items: [] }, {}, []);
    const rr0 = (await imp("research.mjs")).reportMd(rctx, { serp: { captures: [] } }, { clusters: [] }, [], { items: [] }, {}, []);
    check("research: report.md says when the captures were taken on another device than rankTracking.devices (baseline only, no device claim) and says nothing when they match", /Captures taken on desktop while rankTracking\.devices is mobile: baseline only, no device claim \(24 captures\)\./.test(rr) && /Bing related keywords dropped as off-topic: 3 \(see research\/bing\.json droppedOffTopic\)/.test(rr) && !/Captures taken on/.test(rr0) && !/Bing related keywords dropped/.test(rr0), rr.slice(0, 600));
  }

  // ============================ the checks on targets.json ============================
  const rsm = await imp("research.mjs");
  // 06 9.7 + 03 22.2: a plain page (no schema type, so page type "page") fits a TRANSACTIONAL cluster only "with a brief cta"; the plan gives every planned page a cta, so research matches with cta: true.
  {
    const tcl = [{ id: "c-buy-cars-online", head: "buy cars online", queries: [{ query: "buy cars online", basis: "head" }], captureOfHead: null, place: null, volume: { value: 100, source: "t", fetchedAt: "2026-10-22T00:00:00.000Z", cacheFile: null }, value: null, sources: ["t"], volumeSource: "t" }];
    const pagesT = [{ path: "/buy-cars-online/", title: "Buy Cars Online | Other Co", h1: "Buy cars online", jsonld: [], snapshot: "2026-10-20" }];
    const bt = rsm.buildTargets(ctxO, { clusters: tcl, captures: [], portals: [], wikiDoc: null, forumsDoc: null, gscDoc: null, pages: pagesT, winnersDoc: null })[0];
    const bl = rsm.buildTargets(ctxO, { clusters: tcl, captures: [], portals: [], wikiDoc: null, forumsDoc: null, gscDoc: null, pages: [{ ...pagesT[0], jsonld: [{ parsed: { "@type": "Article" } }] }], winnersDoc: null })[0];
    check("targets.json: an existing plain page is the target of a TRANSACTIONAL cluster (the plan gives it a cta); a page that is an Article is not (9.7 page type)", bt.intent === "transactional" && bt.targetPage === "/buy-cars-online/" && bl.targetPage === "new", JSON.stringify([bt.intent, bt.targetPage, bl.intent, bl.targetPage]));
  }
  const good = JSON.parse(JSON.stringify(tg));
  check("gate: our own targets.json passes the checks", rsm.checkTargets(good).length === 0, rsm.checkTargets(good).join("; "));
  const dup = JSON.parse(JSON.stringify(tg)); dup.clusters[1].primaryQuery = dup.clusters[0].primaryQuery;
  check("gate: two clusters on one primary query (cannibalisation) is an error", rsm.checkTargets(dup).some((e) => /share primaryQuery/.test(e)));
  const near = JSON.parse(JSON.stringify(tg)); near.clusters[1].primaryQuery = near.clusters[0].primaryQuery + " the";
  check("gate: near-identical primary queries (>= 80% token overlap) are an error", rsm.checkTargets(near).some((e) => /cannibalisation/.test(e)));
  const bare = JSON.parse(JSON.stringify(tg)); bare.clusters[0].volume = 1200;
  check("gate: a bare number (no source) is an error", rsm.checkTargets(bare).some((e) => /not a sourced number/.test(e)));
  const nolocal = JSON.parse(JSON.stringify(tg)); const lc = nolocal.clusters.find((c) => c.intent === "local"); lc.location = null;
  check("gate: local intent without a location is an error", rsm.checkTargets(nolocal).some((e) => /no location/.test(e)));
  const badTp = JSON.parse(JSON.stringify(tg)); badTp.clusters[0].targetPage = "tracy/homes";
  check("gate: targetPage must be a path or 'new'", rsm.checkTargets(badTp).some((e) => /targetPage/.test(e)));
  const braced = JSON.parse(JSON.stringify(tg)); braced.clusters[0].queries.push("home value {city} ca"); braced.clusters[1].questions = ["What is the price in {city}?"];
  check("gate: an unfilled {placeholder} in a query, question or location is an error", rsm.checkTargets(braced).filter((e) => /unfilled placeholder/.test(e)).length === 2 && rsm.checkTargets(good).length === 0, JSON.stringify(rsm.checkTargets(braced)));
  const mkCl = (id, q, locn) => ({ ...JSON.parse(JSON.stringify(tg.clusters[0])), id, primaryQuery: q, queries: [q], location: locn, targetPage: "new" });
  const twoCities = { ...tg, clusters: [mkCl("c-a", "we buy houses tracy ca", "Tracy, CA"), mkCl("c-b", "we buy houses oakland ca", "Oakland, CA")] };
  const oneCity = { ...tg, clusters: [mkCl("c-a", "we buy houses tracy ca", "Tracy, CA"), mkCl("c-b", "we buy houses tracy california", "Tracy, CA")] };
  check("gate: the same words for two different cities are two searches, not cannibalisation (a page per city)", rsm.checkTargets(twoCities).length === 0 && rsm.checkTargets(oneCity).some((e) => /cannibalisation/.test(e)), JSON.stringify(rsm.checkTargets(twoCities)));
  const plc = [{ city: "Tracy", state: "CA", label: "Tracy, CA" }, { city: "Livermore", state: "CA", label: "Livermore, CA" }];
  check("research: a page about another city is not the target page (We buy houses Livermore CA is not 'we buy houses tracy ca')", rsm.queryMatchesPage("we buy houses tracy ca", "We buy houses Tracy CA", plc) === true && rsm.queryMatchesPage("we buy houses tracy ca", "We buy houses Livermore CA", plc) === false);
  const noNum = JSON.parse(JSON.stringify(tg)); noNum.clusters[0].volume.value = null;
  check("gate: a cluster whose volume has no number is an error (an unmeasured search stays out of targets.json)", rsm.checkTargets(noNum).some((e) => /no number/.test(e)));
  const V = fs.existsSync(path.join(dir, "targets-validate.mjs")) ? await imp("targets-validate.mjs") : null;
  const vt = V?.validate(tg);
  check("contract: targets.json passes the shared validator (targets-validate.mjs T-001..T-011)", !!vt?.ok, V ? JSON.stringify(vt.errors.slice(0, 5)) : "targets-validate.mjs missing");
  const ordBad = JSON.parse(JSON.stringify(tg)); const ordC = ordBad.clusters.find((c) => typeof c.volume.value === "string"); ordC.volume.estimate = false;
  check("contract: the ordinal (tier) estimate is accepted by the validator only with estimate:true", !!V && V.validate(tg).ok && ordC && !V.validate(ordBad).ok && V.validate(ordBad).errors.some((e) => /estimate: true/.test(e.message)), V ? JSON.stringify(V.validate(ordBad).errors.slice(0, 2)) : "missing");
  check("contract: business.json from intake passes the shared validator (B-001)", !!V?.validateBusiness(bz).ok, V ? JSON.stringify(V.validateBusiness(bz).errors) : "missing");
  // ---- validator consistency (2026-10-23): research must never emit clusters its own checks reject. The queries below are the Rainmaker collisions (autocomplete-only, no SERP of their own).
  {
    const ids = (cs) => cs.map((c) => c.queries.map((m) => m.query));
    const urlCap = (q, tag) => ({ query: q, engine: "google", device: "desktop", status: "CAPTURED", capturedAt: "2026-10-23", organic: Array.from({ length: 10 }, (_, i) => ({ position: i + 1, url: `https://${tag}${i}.test/p`, domain: `${tag}${i}.test`, title: `${tag} ${i}` })), file: `${tag}.json` });
    const asTargets = (cs) => ({ ...tg, clusters: cs.map((c) => ({ ...JSON.parse(JSON.stringify(tg.clusters[0])), id: c.id, primaryQuery: c.head, queries: c.queries.map((m) => m.query), location: c.place, targetPage: "new" })) });
    const tokenErrs = (cs) => [...rsm.checkTargets(asTargets(cs)).filter((e) => /cannibalisation|share primaryQuery/.test(e)), ...(V ? V.validate(asTargets(cs)).errors.filter((e) => e.rule === "T-003").map((e) => e.message) : ["targets-validate.mjs missing"])];
    const run = (rows, captures = []) => cl.clusterQueries({ universe: rows.map(([q, v], i) => uni(q, v, i)), captures, engine: "google", shared: 4, maxClusters: 50, places: [] });
    const life = run([["how much do life insurance agents make", 880], ["how much do life insurance agents make a year", 320], ["how much do life insurance agents make commission", 210], ["how much do life insurance agents make in texas", 140], ["term life insurance quotes", 500]]);
    const lifeC = life.find((c) => c.queries.some((m) => m.query === "how much do life insurance agents make"));
    check("cluster: validator consistency: the autocomplete-only 'how much do life insurance agents make' + 'a year' + 'commission' + 'in texas' are ONE cluster, the biggest demand is the head, and an unrelated search stays apart", lifeC.queries.length === 4 && lifeC.head === "how much do life insurance agents make" && life.length === 2 && lifeC.serp === false && lifeC.queries.filter((m) => m.basis === "token-overlap (no SERP of its own)").length === 3, JSON.stringify(ids(life)));
    check("cluster: validator consistency: research's own checkTargets and targets-validate T-003 find no cannibalisation among clusters built from those queries", tokenErrs(life).length === 0, JSON.stringify(tokenErrs(life)));
    const ann = run([["fixed indexed annuity with income rider", 40], ["fixed indexed annuity with lifetime income rider", 90]]);
    check("cluster: validator consistency: two serp:false singletons that collide merge into one cluster whose primary is the higher-demand one", ann.length === 1 && ann[0].head === "fixed indexed annuity with lifetime income rider" && ann[0].queries.length === 2 && ann[0].queries[1].basis === "token-overlap (no SERP of its own)" && tokenErrs(ann).length === 0, JSON.stringify(ids(ann)));
    const tie = run([["fixed indexed annuity with lifetime income rider", 50], ["fixed indexed annuity with income rider", 50]]);
    check("cluster: validator consistency: equal demand ties by code point (the primary is 'fixed indexed annuity with income rider')", tie.length === 1 && tie[0].head === "fixed indexed annuity with income rider", JSON.stringify(ids(tie)));
    const mp = run([["how much does mortgage protection insurance cost", 800], ["how much do mortgage protection insurance cost", 300], ["how much does mortgage protection insurance cost monthly", 100]], [urlCap("how much does mortgage protection insurance cost", "mp")]);
    const mpC = mp.find((c) => c.queries.some((m) => m.query === "how much does mortgage protection insurance cost monthly"));
    check("cluster: validator consistency: a serp:false query that collides with a member of a SERP-captured cluster joins it (basis token-overlap), the captured query stays the head", mp.length === 1 && mpC.head === "how much does mortgage protection insurance cost" && mpC.serp === true && mpC.queries.find((m) => m.query === "how much does mortgage protection insurance cost monthly").basis === "token-overlap (no SERP of its own)" && tokenErrs(mp).length === 0, JSON.stringify(mp.map((c) => [c.head, c.queries])));
    const two = run([["how much does mortgage protection insurance cost", 800], ["how much do mortgage protection insurance cost", 300]], [urlCap("how much does mortgage protection insurance cost", "mpa"), urlCap("how much do mortgage protection insurance cost", "mpb")]);
    check("cluster: validator consistency: a query WITH its own SERP capture is never merged by tokens (two captured near-identical queries stay two clusters; checkTargets still reports them)", two.length === 2 && two.every((c) => c.serp === true && c.queries.length === 1) && rsm.checkTargets(asTargets(two)).some((e) => /cannibalisation/.test(e)), JSON.stringify(ids(two)));
  }
  check("contract: every Search Console row is a valid ranking row (whole position, location, device, language, url)", !!V && gd.rows.length > 0 && gd.rows.every((r, k) => V.validateRankingRow(r, "row" + k).length === 0), V ? JSON.stringify(gd.rows.map((r, k) => V.validateRankingRow(r, "row" + k))) : "missing");
  check("contract: every AI row is a valid citation row (model, prompt, location, whole number of runs, share)", !!V && d5.rows.length >= 3 && d5.rows.every((r, k) => V.validateCitationRow(r, "row" + k).length === 0), V ? JSON.stringify(d5.rows.map((r, k) => V.validateCitationRow(r, "row" + k))) : "missing");
  const nov0 = await node("research.mjs", ["https://other.test/", "--cwd", tmp, "--query", "foo bar baz"]);
  check("research: the same run without approval and without --yes stops at NEEDS-APPROVAL (exit 3)", nov0.status === 3 && /^NEEDS-APPROVAL seeds: the 1 seed queries/m.test(nov0.stdout), nov0.stdout.slice(-500));
  const nov = await node("research.mjs", ["https://other.test/", "--cwd", tmp, "--query", "foo bar baz", "--yes"]);
  check("research: no search has a sourced volume => BLOCKED exit 3, targets.json NOT written, nothing invented", nov.status === 3 && /BLOCKED: none of the \d+ searches has a sourced volume/.test(nov.stdout) && !fs.existsSync(path.join(oth, "targets.json")), nov.stdout + nov.stderr);

  // ============================ no direct Google fetching, no paid API ============================
  // ============================ extras: winner pages, autocomplete, linkable-asset ideas, citation sources ============================
  const wmod = await imp("research-winners.mjs"), amod = await imp("research-assets.mjs"), cmod = await imp("research-citations.mjs"), acm = await imp("research-autocomplete.mjs");
  const winSrv = await serve((r) => {
    if (r.url === "/robots.txt") return { type: "text/plain", body: "User-agent: *\nAllow: /\nDisallow: /private/\n" };
    const pg = (title, h2s, words) => ({ type: "text/html", body: `<!doctype html><html><head><title>${title}</title></head><body><main><h1>${title}</h1>${h2s.map((h) => `<h2>${h}</h2>`).join("")}<p>${"word ".repeat(words)}</p></main></body></html>` });
    if (r.url === "/blog/closing-costs") return pg("Closing costs explained", ["Agent commission fees", "Title insurance", "Tracy market trends"], 1000);
    if (r.url === "/blog/agent-fees") return pg("What agent fees cover", ["Agent commission fees", "Title insurance", "Negotiating the listing agreement"], 1400);
    if (r.url === "/blog/market") return pg("Tracy market update", ["Tracy market trends", "Agent commission fees", "Seller costs"], 1200);
    if (r.url === "/private/x") return pg("Private", [], 10);
    return { status: 404, body: "no" };
  });
  const rlSrv = await serve(() => ({ status: 429, body: "slow down" }));
  const mkHost = (host, caps, extra = {}) => {
    const pewp = path.join(tmp, "site-checks", host, ".pewp");
    w(path.join(pewp, "business.json"), { ...bz, domain: host, name: "Win Realty", competitors: [] });
    caps.forEach((c, i) => w(path.join(pewp, "captures", "serp", `w${i}.google.json`), { query: c.query, engine: "google", capturedAt: "2026-10-21T15:00:00Z", browser: "owner's Edge", device: "mobile", language: "en", location: { requested: "Tracy, CA", footer: "Tracy, California" }, organic: c.organic, ...extra }));
    return pewp;
  };
  const organicOf = (base, paths) => paths.map((p, i) => ({ position: i + 1, url: base + p, title: `Result ${i + 1}` }));
  const winPewp = mkHost("win.test", [
    { query: "how much does a realtor cost in tracy", organic: organicOf(winSrv.url, ["/blog/closing-costs", "/blog/agent-fees", "/blog/market"]) },
    { query: "tracy realtor private page", organic: organicOf(winSrv.url, ["/private/x"]) },
    { query: "tracy realtor rate limited", organic: organicOf(rlSrv.url, ["/a"]) },
    { query: "tracy realtor cached audit", organic: [{ position: 1, domain: "comp1.test", title: "Comp1 Tracy homes" }] },
  ]);
  w(path.join(winPewp, "research", "competitors.json"), { step: "competitors", status: "ok", sites: [{ domain: "comp1.test", input: "comp1.test", fetchedAt: "2026-10-20T00:00:00.000Z", page: { words: 900, title: "Comp1", h1: ["Comp1"], h2: [] }, schema: { types: [] }, samples: [{ kind: "city", path: "/tracy", status: 200, title: "Homes in Tracy", h1: "Homes in Tracy", words: 1150, mainWords: 1100, h2: ["Tracy schools", "Tracy market trends"] }] }] });
  const WU = "https://win.test/";
  await node("research-serp-import.mjs", [WU, "--cwd", tmp]);
  await node("research-cluster.mjs", [WU, "--cwd", tmp]);
  const wj = () => J(path.join(winPewp, "research", "winners.json")), wc = (q) => wj()?.clusters.find((c) => c.head === q);
  await node("research-winners.mjs", [WU, "--cwd", tmp]);
  check("winners: nothing is fetched without --from-serp; the winning pages are named as not fetched", winSrv.reqs.length === 0 && rlSrv.reqs.length === 0 && /^not fetched/.test(wc("how much does a realtor cost in tracy")?.basis || ""), JSON.stringify(wc("how much does a realtor cost in tracy")?.basis));
  const wr = await node("research-winners.mjs", [WU, "--cwd", tmp, "--from-serp"]);
  const w1 = wc("how much does a realtor cost in tracy");
  check("winners: with --from-serp each winning page is fetched once, robots.txt first, honest user agent", wr.status === 0 && winSrv.reqs[0].url === "/robots.txt" && ["/blog/closing-costs", "/blog/agent-fees", "/blog/market"].every((u) => winSrv.reqs.filter((q) => q.url === u).length === 1) && winSrv.reqs.every((q) => /PEWP-SiteResearch/.test(q.headers["user-agent"])), wr.stdout + wr.stderr + winSrv.reqs.map((q) => q.url).join());
  const winBefore = winSrv.reqs.length;
  await node("research-winners.mjs", [WU, "--cwd", tmp, "--from-serp"]);
  check("winners: a second run is served from the cache (no new request to a winner site)", winSrv.reqs.length === winBefore, `${winBefore} -> ${winSrv.reqs.length}`);
  check("winners: requiredEntities are the heading terms recurring across the winners (not the query's own words); the format is the winners' page type", w1.pages.length === 3 && w1.entities.includes("commission") && w1.entities.includes("insurance") && !w1.entities.includes("tracy") && w1.format === "guide", JSON.stringify([w1.entities, w1.format]));
  check("winners: a SOURCED wordRange [min, max] of visible words (3 pages: min to max), an estimate, with location and device", JSON.stringify(w1.wordRange?.value) === "[1000,1400]" && w1.wordRange.estimate === true && isFact(w1.wordRange) && /3 winning page\(s\)/.test(w1.wordRange.source) && fs.existsSync(w1.wordRange.cacheFile) && w1.wordRange.device === "mobile", JSON.stringify(w1.wordRange));
  check("winners: robots.txt is obeyed (a disallowed page is never fetched)", /robots\.txt disallows/.test(wc("tracy realtor private page").pages[0].error || "") && !winSrv.reqs.some((q) => q.url === "/private/x"), JSON.stringify(wc("tracy realtor private page").pages));
  check("winners: a 429 stops that site (one request, no retry) and is reported BLOCKED", rlSrv.reqs.length === 1 && /^BLOCKED/.test(wc("tracy realtor rate limited").pages[0].error || "") && wj().blockedHosts.length === 1, `${rlSrv.reqs.length} requests; ` + JSON.stringify(wc("tracy realtor rate limited").pages[0]));
  const wcache = wc("tracy realtor cached audit");
  check("winners: a capture with domains only is served from the competitor audits already cached (no request), basis said", /already cached/.test(wcache.basis) && JSON.stringify(wcache.wordRange?.value) === "[1100,1100]" && /cached competitor audits/.test(wcache.wordRange.source) && wcache.pages[0].via, JSON.stringify(wcache));
  const libW = await imp("research-lib.mjs"), ctxW = libW.context(WU, { cwd: tmp });
  const wb = await wmod.run(ctxW, { fromSerp: true, maxPages: 1 });
  check("winners: the page budget is a hard stop (3 URLs wanted, --max-pages 1 => 1 page fetched, budgetStopped)", wb.pagesFetched === 1 && wb.budgetStopped === true, JSON.stringify([wb.pagesFetched, wb.budgetStopped]));
  const one = wmod.deriveFromPages([{ url: "https://x.test/blog/a", h2: ["Closing costs", "Agent fees"], mainWords: 900 }], "q");
  const two = wmod.deriveFromPages([{ url: "https://x.test/blog/a", h2: ["Closing costs", "Agent fees"], mainWords: 900 }, { url: "https://y.test/blog/b", h2: ["Closing costs", "Taxes"], mainWords: 1100 }], "q");
  check("winners: 'recurring' needs 2+ pages (one page gives no entities); two pages give the shared heading term", one.entities.length === 0 && two.entities.includes("closing") && !two.entities.includes("taxes") && !two.entities.includes("fees") && two.format === "guide", JSON.stringify([one.entities, two.entities]));
  // integration: the whole run puts winners into targets.json
  const csvW = path.join(tmp, "win-kwp.csv");
  fs.writeFileSync(csvW, ["Keyword\tAvg. monthly searches", "how much does a realtor cost in tracy\t100 - 1K", "tracy realtor private page\t10 - 100", "tracy realtor rate limited\t10 - 100"].join("\n"));
  const win2 = mkHost("win2.test", [{ query: "how much does a realtor cost in tracy", organic: organicOf(winSrv.url, ["/blog/closing-costs", "/blog/agent-fees", "/blog/market"]) }]);
  const rw = await node("research.mjs", ["https://win2.test/", "--cwd", tmp, "--from-serp", "--kwp-file", csvW, "--yes"]);
  const tw = J(path.join(win2, "targets.json")), cw = tw?.clusters.find((c) => c.primaryQuery === "how much does a realtor cost in tracy");
  check("research: with --from-serp the winners fill wordRange, requiredEntities and winningFormat in targets.json, and the shared validator accepts it", rw.status === 0 && JSON.stringify(cw?.wordRange?.value) === "[1000,1400]" && cw.requiredEntities.includes("commission") && cw.winningFormat === "guide" && !!V?.validate(tw).ok, rw.stdout + rw.stderr + JSON.stringify(V?.validate(tw)?.errors?.slice(0, 3)));
  const dry2 = await node("research.mjs", ["https://win2.test/", "--cwd", tmp, "--from-serp", "--dry", "--kwp-file", csvW]);
  // gap 3 (a skill run): --dry returned before the capture list was written, so the research-plan step's evidence (research/capture-requests.json) could never be satisfied on a re-run
  const crFile = path.join(win2, "research", "capture-requests.json");
  fs.rmSync(crFile, { force: true });
  const crT0 = Date.now() - 1000;
  const dry3 = await node("research.mjs", ["https://win2.test/", "--cwd", tmp, "--from-serp", "--dry", "--kwp-file", csvW]);
  const crSt = fs.existsSync(crFile) ? fs.statSync(crFile) : null, crIn = ["seeds.json", "clusters.json"].map((f) => { try { return fs.statSync(path.join(win2, "research", f)).mtimeMs; } catch { return 0; } });
  let crDoc = null; try { crDoc = J(crFile); } catch { /* not written */ }
  check("research: --dry fetches nothing but WRITES research/capture-requests.json from what is already on disk (the evidence of the research-plan step on a re-run): the file exists, is newer than seeds.json and clusters.json and than the start of the run, and lists what is still to capture", dry3.status === 0 && /DRY RUN/.test(dry3.stdout) && !!crSt && crSt.mtimeMs >= crT0 && crIn.every((m) => crSt.mtimeMs > m) && Array.isArray(crDoc?.items), JSON.stringify([dry3.status, dry3.stdout.slice(-120), !!crSt, crSt && crSt.mtimeMs - crT0, crIn.map((m) => crSt && crSt.mtimeMs - m), Array.isArray(crDoc?.items)]));
  check("research: the plan lists the winner pages it will fetch (so the owner sees them first)", /winner pages to audit/.test(dry2.stdout) && /blog\/closing-costs/.test(dry2.stdout) && /DRY RUN/.test(dry2.stdout), dry2.stdout);

  // autocomplete: saved by the main session, parsed here, never fetched
  const acDir = path.join(oth, "captures", "autocomplete");
  w(path.join(acDir, "a1.google.json"), { seed: "Realtor in Tracy", engine: "google", capturedAt: "2026-10-21T10:00:00Z", browser: "owner's Edge", language: "en", location: { requested: "Tracy, CA", footer: "Tracy, California" }, suggestions: ["realtor in tracy ca", "realtor in tracy california reviews", "realtor in {city}"] });
  w(path.join(acDir, "bad-nodate.json"), { seed: "x y", engine: "bing", language: "en", location: { footer: "Egypt" }, suggestions: ["x y z"] });
  w(path.join(acDir, "bad-empty.json"), { seed: "x y", engine: "bing", capturedAt: "2026-10-21", language: "en", location: { footer: "Egypt" }, suggestions: [] });
  const ar = await node("research-autocomplete.mjs", ["https://other.test/", "--cwd", tmp]);
  const adj = J(path.join(oth, "research", "autocomplete.json"));
  check("autocomplete: saved suggestions parsed into rows (seed, engine, position, location label); a {placeholder} suggestion is dropped; files missing a date or a list are REJECTED with the reason", ar.status === 0 && adj.rows.length === 2 && adj.rows[1].suggestion === "realtor in tracy california reviews" && adj.rows[1].position === 2 && adj.rows[0].locationLabel === "Tracy, CA" && adj.rejected.some((x) => /bad-nodate/.test(x.file) && /no capture date/.test(x.reason)) && adj.rejected.some((x) => /bad-empty/.test(x.file) && /no suggestions list/.test(x.reason)), ar.stdout + ar.stderr + JSON.stringify(adj?.rejected));
  const uniA = cl.buildUniverse(libW.context("https://other.test/", { cwd: tmp })), sug = uniA.find((r) => r.query === "realtor in tracy california reviews");
  check("autocomplete: a suggestion becomes a query with a sourced T1 ESTIMATE (rank 3, estimate:true, the capture file as source); it is never a count", sug?.volume.value === "T1 (autocomplete suggestion)" && sug.volume.rank === 3 && sug.volume.estimate === true && /autocomplete captured in the browser/.test(sug.volume.source) && sug.volume.cacheFile.endsWith("a1.google.json"), JSON.stringify(sug?.volume));
  // a measured 0 is "no demand seen": it yields to an autocomplete tier for the same query, and ranks below any tier (ELEV8, 2026-10-27)
  const bingZ = path.join(oth, "research", "bing.json"), bingKeep = fs.existsSync(bingZ) ? fs.readFileSync(bingZ) : null;
  w(bingZ, { step: "bing", status: "ok", generatedAt: "2026-10-21T10:00:00Z", market: { country: "US", language: "en" }, keywords: [{ query: "realtor in tracy ca", volume: { value: 0, estimate: true, source: "fixture Bing GetKeyword 0", fetchedAt: "2026-10-21T10:00:00Z" } }, { query: "best realtor zero only", volume: { value: 0, estimate: true, source: "fixture Bing GetKeyword 0", fetchedAt: "2026-10-21T10:00:00Z" } }] });
  const uniZ = cl.buildUniverse(libW.context("https://other.test/", { cwd: tmp })), zt = uniZ.find((r) => r.query === "realtor in tracy ca"), zo = uniZ.find((r) => r.query === "best realtor zero only");
  if (bingKeep) fs.writeFileSync(bingZ, bingKeep); else fs.rmSync(bingZ);
  check("volume: a measured 0 yields to the autocomplete tier for the same query; a query with only a 0 keeps its 0", zt?.volumeSource === "autocomplete" && zt.volume.rank === 3 && zo?.volumeSource === "bing" && zo.volume.value === 0, JSON.stringify([zt?.volumeSource, zt?.volume?.value, zo?.volumeSource, zo?.volume?.value]));
  const vk = (v) => cl.volKey(v), gt = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);
  check("volume: ranking is measured >0, then a tier estimate, then a measured 0, then nothing", gt(vk({ value: 5 }), vk({ value: "T1", rank: 3 })) && gt(vk({ value: "T1", rank: 3 }), vk({ value: 0 })) && gt(vk({ value: 0 }), vk({ value: null })), JSON.stringify([vk({ value: 5 }), vk({ value: "T1", rank: 3 }), vk({ value: 0 }), vk({ value: null })]));
  const arB = await T("research-autocomplete.mjs", []);
  check("autocomplete: no captures => BLOCKED exit 3 with how to capture (type the seed, do not press Enter)", arB.status === 3 && /BLOCKED: .*Enter/.test(arB.stdout), arB.stdout + arB.stderr);

  // linkable-asset ideas: only from evidence
  const capA = (q, items) => ({ query: q, engine: "google", organic: items.map((it, i) => ({ position: i + 1, domain: it[0], title: it[1], url: `https://${it[0]}/x` })) });
  const toolCaps = [capA("what is my home worth tracy", [["a.test", "Home value calculator"], ["b.test", "Free home value estimator"], ["c.test", "Tracy homes"]]), capA("sell house tracy", [["a.test", "Home value calculator"]])];
  const q3 = [{ question: "How much does an agent cost?", seenAt: "PAA1" }, { question: "What is the median home price in Tracy?", seenAt: "PAA2" }, { question: "Is 3% commission normal?", seenAt: "PAA3" }];
  const placesT = [{ city: "Tracy", state: "CA", label: "Tracy, CA" }];
  const iA = amod.deriveIdeas({ captures: toolCaps, questions: q3, competitors: [{ domain: "comp.test", sitemap: { byKind: { situation: 2 } } }], linkGap: [{ domain: "g1.test", linksToCompetitors: 2 }, { domain: "g2.test", linksToCompetitors: 2 }, { domain: "g3.test", linksToCompetitors: 3 }], places: placesT, ownDomain: "own.test" });
  check("assets: data idea needs >= 3 real price/cost questions, situation guides need an audited competitor, outreach needs >= 3 link-gap sites; every idea carries evidence", iA.some((i) => i.id === "a-data-local-numbers" && i.evidence.length === 3) && iA.some((i) => i.id === "a-guide-situations") && iA.some((i) => i.id === "a-outreach-link-gap" && i.evidence.length === 3) && iA.every((i) => i.evidence.length > 0 && i.title && i.why), JSON.stringify(iA.map((i) => [i.id, i.evidence.length])));
  const tool2 = amod.deriveIdeas({ captures: [capA("q", [["a.test", "Home value calculator"], ["b.test", "Home value calculator pro"]])], places: placesT, ownDomain: "own.test" });
  const tool1 = amod.deriveIdeas({ captures: [capA("q", [["a.test", "Home value calculator"]]), capA("q2", [["a.test", "Home value calculator"]])], places: placesT, ownDomain: "own.test" });
  const thin = amod.deriveIdeas({ questions: q3.slice(0, 2), linkGap: [{ domain: "g1.test", linksToCompetitors: 2 }, { domain: "g2.test", linksToCompetitors: 2 }], places: placesT, ownDomain: "own.test" });
  check("assets: a tool idea needs the same kind of tool on >= 2 different sites; below the thresholds there is NO idea (nothing invented)", tool2.some((i) => i.type === "tool" && i.evidence.length === 2) && tool1.length === 0 && thin.length === 0, JSON.stringify([tool2.map((i) => i.id), tool1.length, thin.length]));

  // local citation sources: from captured results and the link graph, listed-or-unknown
  const dirCap = (q) => ({ query: q, engine: "google", organic: [{ position: 2, domain: "yelp.com", title: "THE BEST 10 REAL ESTATE AGENTS IN TRACY", url: "https://yelp.com/search?x=" + q }, { position: 5, domain: "lonesite.test", title: "Some blog", url: "https://lonesite.test/" + q }, { position: 1, domain: "rival.test", title: "Best agents rival", url: "https://rival.test/" }] });
  const authT = { results: [{ role: "competitor", domain: "rival.test", strongestLinkingDomains: [{ domain: "bbb.org" }, { domain: "random-blog.test" }] }], linkGap: [{ domain: "bbb.org", linksToCompetitors: 2 }, { domain: "yellowpages.com", linksToCompetitors: 2 }, { domain: "random-blog.test", linksToCompetitors: 2 }] };
  const cbiz = { name: "Win Realty", domain: "own.test", existing: { socials: ["https://www.yelp.com/biz/win-realty-tracy"], businessProfile: null, site: "https://own.test/" } };
  const cs1 = cmod.deriveCitations({ captures: ["a b", "c d", "e f"].map(dirCap), competitorsDomains: ["rival.test"], authority: authT, business: cbiz });
  const csOf = (d) => cs1.find((s) => s.domain === d);
  check("citations: a directory seen in 2+ captured searches with list-style titles is a source; a one-off blog and a competitor site are not; a link-graph-only site needs a directory-family name", csOf("yelp.com")?.searches === 3 && csOf("yelp.com").bestPosition === 2 && !csOf("lonesite.test") && !csOf("rival.test") && !!csOf("bbb.org") && !!csOf("yellowpages.com") && !csOf("random-blog.test") && cs1.every((s) => s.evidence.length > 0), JSON.stringify(cs1.map((s) => [s.domain, s.searches, s.linkedCompetitors])));
  check("citations: 'listed' only when business.json's own links prove it; otherwise 'unknown: look it up by hand' (never 'not listed' without a lookup)", csOf("yelp.com").status === "listed" && /business\.json links/.test(csOf("yelp.com").statusEvidence) && csOf("bbb.org").status === "unknown" && !cs1.some((s) => s.status === "not listed") && csOf("bbb.org").linkedCompetitors === 2 && csOf("bbb.org").inLinkGap === true, JSON.stringify(cs1.map((s) => [s.domain, s.status])));
  // ============================ Windows robustness (script pass 2026-10-23) ============================
  const win = path.join(tmp, "win"); fs.mkdirSync(win, { recursive: true });
  const BOM = String.fromCharCode(0xfeff); // a UTF-8 BOM as Windows PowerShell 5.1 / Notepad write it
  const bomJ = path.join(win, "bom.json"); fs.writeFileSync(bomJ, BOM + JSON.stringify({ queries: ["sell house fast"] }));
  let lfMissing = null, lfBom = null; try { lib.listFile(path.join(win, "nope.json"), "queries"); } catch (e) { lfMissing = e; } try { lfBom = lib.listFile(bomJ, "queries")[0]; } catch (e) { lfBom = e; }
  check("win: a JSON file saved with a BOM is read (J, listFile); a named list file that is missing is a usage error, not an empty list", lib.J(bomJ)?.queries?.[0] === "sell house fast" && lfBom === "sell house fast" && lfMissing instanceof lib.Usage && /not found/.test(lfMissing.message), JSON.stringify({ J: lib.J(bomJ), lfBom: String(lfBom), lfMissing: String(lfMissing) }));
  const exw = await imp("research-existing.mjs");
  check("win: front matter of a CRLF or BOM knowledge file is read (git checks .md out as CRLF here)", exw.frontMatter("---\r\nupdated: 2026-10-01\r\nstatus: confirmed\r\n---\r\n| a |\r\n").updated === "2026-10-01" && exw.frontMatter(BOM + "---\nupdated: 2026-10-02\n---\n").updated === "2026-10-02", JSON.stringify([exw.frontMatter("---\r\nupdated: 2026-10-01\r\n---\r\n"), exw.frontMatter(BOM + "---\nupdated: 2026-10-02\n---\n")]));
  const aiw = await imp("research-ai.mjs");
  check("win: an owner AI capture saved with a BOM keeps its question line", aiw.parseOwnerMarkdown(BOM + '# AI-01 — "sell my house fast tracy" — ChatGPT — 2026-10-17\n## Answer\nx\n', "AI-01.chatgpt.md").question === "sell my house fast tracy");
  let badEsc; try { badEsc = cmod.deriveCitations({ captures: ["a b", "c d"].map((q) => ({ engine: "google", query: q, organic: [{ domain: "dir.test", position: 1, title: "Best agents in Tracy", url: "https://dir.test/x%E0%A4%A" }, { domain: "dir.test", position: 2, title: "Top 10 directory of agents", url: "https://dir.test/y" }] })), business: { name: "Win Realty", domain: "own.test", existing: {} } }); } catch (e) { badEsc = e; }
  check("win: citations survive a captured URL with a broken % escape (was: URIError, the whole step failed)", Array.isArray(badEsc) && badEsc.some((s) => s.domain === "dir.test"), String(badEsc?.stack || JSON.stringify(badEsc)).slice(0, 300));
  const closed = await serve(() => ({ status: 200, body: "x" })); closed.close(); await new Promise((r) => setTimeout(r, 50));
  const cpewp = path.join(win, "pewp"), robotsUrl = `${closed.url}/robots.txt`;
  const { createHash } = await import("node:crypto");
  w(path.join(cpewp, "cache", "competitors", `${createHash("sha256").update(`GET ${robotsUrl} `).digest("hex").slice(0, 24)}.json`), "{ half-written by a killed run");
  let au1, au2; try { au1 = await comp.auditUrl(cpewp, `${closed.url}/page`); } catch (e) { au1 = { threw: e.message }; } try { au2 = await comp.auditUrl(cpewp, "https://exa mple.test/x"); } catch (e) { au2 = { threw: e.message }; }
  check("win: a half-written competitor cache file is fetched again, not a crash; a malformed winner URL is an error row, not a crash", au1 && !au1.threw && /NOT READ/.test(au1.error || "") && au2 && !au2.threw && /not a valid URL/.test(au2.error || ""), JSON.stringify([au1, au2]).slice(0, 300));
  const missingSeeds = await T("research-bing.mjs", ["--seeds-file", path.join(win, "nope.json")], { BING_WEBMASTER_KEY: "k" });
  check("win: research-bing --seeds-file that does not exist stops with a usage error (exit 2), it does not run with no seeds", missingSeeds.status === 2 && /nope\.json: file not found/.test(missingSeeds.stderr), JSON.stringify(missingSeeds).slice(0, 300));
  const link = path.join(win, "scripts-link"); let linked = true; try { fs.symlinkSync(dir, link, "junction"); } catch { linked = false; }
  const viaLink = linked ? await new Promise((resolve) => { const p = spawn(process.execPath, [path.join(link, "research-seeds.mjs")], { env: BASE_ENV }); let o = ""; p.stdout.on("data", (c) => (o += c)); p.stderr.on("data", (c) => (o += c)); const t = setTimeout(() => p.kill(), 60000); p.on("close", (status) => { clearTimeout(t); resolve({ status, o }); }); }) : null;
  check("win: a research script started through a junction still runs its CLI (was: exit 0, no output: skipped silently)", linked && viaLink.status === 2 && /^usage: node research-seeds\.mjs/m.test(viaLink.o), linked ? JSON.stringify(viaLink) : "could not create a junction");
  try { if (linked) fs.rmdirSync(link); } catch {} // removes the junction only, never the scripts it points at
  const code = fs.readdirSync(dir).filter((f) => /^(research|intake)[\w-]*\.mjs$/.test(f)).map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]);
  const live = code.flatMap(([f, s]) => s.split("\n").filter((l) => !/^\s*\/\//.test(l)).filter((l) => /(google\.com\/search|bing\.com\/search|duckduckgo\.com\/\?q|google\.com\/maps\/search|suggestqueries\.google|osjson\.aspx|google\.com\/complete\/search|bing\.com\/AS\/Suggestions)/i.test(l)).map((l) => `${f}: ${l.trim().slice(0, 100)}`));
  check("guard: no script fetches Google, Bing or DuckDuckGo result pages (captured in the owner's browser only)", live.length === 0, live.join("\n"));
  const paid = code.flatMap(([f, s]) => s.split("\n").filter((l) => !/^\s*\/\//.test(l)).filter((l) => /(api\.ahrefs|dataforseo|serpapi|api\.openai\.com|api\.perplexity|similarweb\.com\/v)/i.test(l)).map((l) => `${f}: ${l.trim().slice(0, 100)}`));
  check("guard: no paid API (Ahrefs, DataForSEO, SerpApi, OpenAI, Perplexity, Similarweb) is called", paid.length === 0, paid.join("\n"));
  const attempts = fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8").trim() : "";
  check("guard: nothing in this whole test left the machine (no live site, no Google, no paid API): the network guard saw no non-local request", attempts === "", attempts);
  const crlf = code.filter(([, s]) => /\r\n/.test(s)).map(([f]) => f);
  check("guard: every script has LF line endings", crlf.length === 0, crlf.join());
} catch (e) {
  check("test harness did not crash", false, e.stack || String(e));
}

const failed = results.filter((r) => !r.ok);
// Leave the decoy folder first: Windows cannot delete a folder that is a process's working directory, so the swallowed EBUSY left every
// run's temp folder behind (hundreds of pewp-s12-* in %TEMP%). A failed cleanup is now said, not swallowed (it never fails the suite).
// Done before the result lines so the --json line stays the last line (mutants-research.mjs parses it).
process.chdir(os.tmpdir());
let cleanupNote = "";
if (process.env.PEWP_TEST_KEEP) cleanupNote = `kept ${tmp}`; else try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { cleanupNote = `NOTE temp folder not removed: ${tmp} (${e.code || e.message})`; }
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `\n      ${r.detail}`}`);
if (cleanupNote) console.log(cleanupNote);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (args.includes("--json")) console.log(JSON.stringify({ passed: results.length - failed.length, total: results.length, failed: failed.map((r) => r.name) }));
process.exit(failed.length ? 1 : 0);
