// Usage: node test-importers.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of the six capture importers (import-index, import-trends, import-ai, import-reputation, import-social, import-ads) and their shared engine
// (lib-captures.mjs): the owner-browser captures become ONE normalized JSON of numbers per module, so the report reads numbers and never raw captures.
// Fixtures only (captures written by this test in each module's documented format; dates are relative to now), no network (netguard-import.mjs refuses any
// non-local request), no browser. For every module: no capture = BLOCKED exit 3 with the 'BLOCKED: <what> | unblocks: <what would>' last line, every file
// rejected = BLOCKED naming the first reason, a file without date / browser / with a future date / not JSON is rejected, a stale file is kept and marked,
// the output has the documented shape; then the module's own numbers and rejections. Mutants: break the code each assertion guards in a copy of the scripts
// folder, expect the named assertions red. Exit 0 = every assertion passed and every mutant was caught.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./lib-main.mjs";
import { runner, J, W, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const SITE = "https://sample-valley-realty.test/";
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
const day = (days) => ago(days).slice(0, 10);
const base = { capturedAt: ago(1), browser: "owner's Edge" };

// module -> { script, out, files: valid fixture files }
const MODULES = {
  index: { script: "import-index.mjs", out: "index", dir: "index", files: {
    "google.json": { ...base, engine: "google", query: "site:sample-valley-realty.test", resultCountText: "About 1,230 results", listedUrls: ["https://sample-valley-realty.test/", "https://sample-valley-realty.test/a", "https://sample-valley-realty.test/b"], serviceChecks: [{ service: "Hard Money Loans", listed: true, url: "https://sample-valley-realty.test/a" }, { service: "bridge loans", listed: false }] },
    "bing.json": { ...base, engine: "bing", query: "site:sample-valley-realty.test", resultCount: 12, listedUrls: ["https://sample-valley-realty.test/"], serviceChecks: [{ service: "bridge loans", listed: true }] } } },
  trends: { script: "import-trends.mjs", out: "trends", dir: "trends", files: {
    "hard-money.json": { ...base, service: "Hard money loans", period: "past 12 months", geo: "US", address: "https://trends.google.com/trends/explore?q=hard%20money", regions: [{ name: "California", value: 87 }, { name: "Texas", value: 100 }, { name: "Florida", value: 61 }, { name: "New York", value: 61 }, { name: "Ohio", value: 20 }], metros: [{ name: "Sacramento CA", value: 100 }, { name: "Fresno CA", value: 55 }], client: { state: "California", metro: "Sacramento CA" } } } },
  ai: { script: "import-ai.mjs", out: "ai-answers", dir: "ai", files: {
    "chatgpt-1.json": { ...base, engine: "chatgpt", type: "buyer", question: "who lends on rentals in Sacramento", answerText: "Sample Valley Realty and Kiavi both lend on rentals.", named: true, competitorsNamed: ["Kiavi"], citedSources: ["https://www.kiavi.com/a"] },
    "chatgpt-2.json": { ...base, engine: "chatgpt", type: "brand", question: "Who is Sample Valley Realty in Sacramento?", answerText: "I could not find reliable information about that business.", named: true, competitorsNamed: [], citedSources: [] },
    "perplexity-1.json": { ...base, engine: "perplexity", type: "buyer", question: "best hard money lender Sacramento", answerText: "Lima One and Kiavi lead the list.", named: false, competitorsNamed: ["Kiavi", "Lima One"], citedSources: ["https://www.kiavi.com/b", "https://sample-valley-realty.test/x"] },
    "copilot.json": { ...base, engine: "copilot", blocked: "sign-in wall" } } },
  reputation: { script: "import-reputation.mjs", out: "reputation", dir: "reputation", files: {
    "client-google.json": { ...base, subject: "client", site: "google", listed: true, rating: 4.8, reviewCount: 100, newestReviewDate: day(20), complaintCount: null },
    "client-bbb.json": { ...base, subject: "client", site: "bbb", listed: true, rating: 4, reviewCount: 20, newestReviewDate: day(100), complaintCount: 3, accredited: true },
    "client-yelp.json": { ...base, subject: "client", site: "yelp", listed: false },
    "kiavi-trustpilot.json": { ...base, subject: "Kiavi.com", site: "trustpilot", listed: true, rating: 8.4, ratingScale: 10, reviewCount: 500, newestReviewDate: day(2), complaintCount: 0 } } },
  social: { script: "import-social.mjs", out: "social", dir: "social", files: {
    "youtube.json": { ...base, platform: "youtube", kind: "channel", handle: "@svr", profileUrl: "https://www.youtube.com/@svr", followers: "1.2K", posts: 58, postsIncludeShorts: true, newestPostDate: day(10), linkTarget: "https://sample-valley-realty.test/", linkStatus: 200 },
    "instagram.json": { ...base, platform: "instagram", handle: "svr", profileUrl: "https://www.instagram.com/svr/", followers: 300, posts: 12, newestPostDate: day(200), linkTarget: "https://sample-valley-realty.test/old", linkStatus: 404 },
    "linkedin.json": { ...base, platform: "linkedin", kind: "company", profileUrl: "https://www.linkedin.com/company/svr", blocked: "login wall" },
    "facebook.json": { ...base, platform: "facebook", profileUrl: "https://www.facebook.com/svr", followers: 50, posts: null, newestPostDate: null, linkTarget: null, linkStatus: null } } },
  ads: { script: "import-ads.mjs", out: "ads", dir: "ads", files: {
    "client-google.json": { ...base, advertiser: "client", library: "google-transparency", region: "US", running: false },
    "client-meta.json": { ...base, advertiser: "client", library: "meta-ad-library", region: "US", running: true, adCount: 3, since: day(40), formats: ["Image", "video"] },
    "kiavi-google.json": { ...base, advertiser: "Kiavi.com", library: "google-transparency", region: "US", running: true, adCount: 25 },
    "lima-meta.json": { ...base, advertiser: "limaone.com", library: "meta-ad-library", region: "US", running: false } } },
};

// the first valid file of a module, changed, as a bad file
const firstFile = (m) => Object.keys(MODULES[m].files)[0];
const bad = (m, patch) => { const o = structuredClone(MODULES[m].files[firstFile(m)]); for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete o[k]; else o[k] = v; } return o; };

async function scenarios(dir) {
  const results = [], check = checker(results);
  const tmp = mkTmp("importers"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
  fs.mkdirSync(home);
  const run = runner(dir, home, netLog);
  let n = 0;
  // a fresh run folder with captures written from `files` (object -> JSON, string -> raw); returns the run function and readers
  const world = (mod, files, { business = true } = {}) => {
    const cwd = path.join(tmp, `w${n++}`), pewp = path.join(cwd, "site-checks", "sample-valley-realty.test", ".pewp");
    if (business) W(path.join(pewp, "business.json"), { name: "Sample Valley Realty", domain: "sample-valley-realty.test", market: { country: "US", language: "en" } });
    for (const [f, body] of Object.entries(files || {})) W(path.join(pewp, "captures", MODULES[mod].dir, f), body);
    const out = path.join(pewp, "research", `${MODULES[mod].out}.json`);
    return { cwd, pewp, out, go: (extra = []) => run(MODULES[mod].script, [SITE, "--cwd", cwd, ...extra]), doc: () => (fs.existsSync(out) ? J(out) : { rows: [], summary: {}, rejected: [], missing: true }) };
  };
  try {
    for (const [mod, M] of Object.entries(MODULES)) {
      const L = `${mod}:`;
      // ---- common: BLOCKED, rejections, stale, shape ----
      let w = world(mod, {}), r = await w.go();
      check(`${L} no capture files: BLOCKED, exit 3, last line 'BLOCKED: no capture files in <dir> | unblocks: <what would>', the output file says status blocked`, r.code === 3 && /^BLOCKED: no capture files in .* \| unblocks: .*scripts\/import-/.test(r.so.trim().split("\n").pop()) && w.doc().status === "blocked", `exit ${r.code} ${r.out}`);
      w = world(mod, M.files); r = await w.go(); let d = r.code === 0 ? w.doc() : null;
      check(`${L} the valid captures give exit 0 and the documented shape (step, module, files, rows, summary, rejected, staleCount) with a source file and date on every row`, r.code === 0 && d && d.step === M.out && d.module === mod && d.files === Object.keys(M.files).length && d.rows.length === Object.keys(M.files).length && Array.isArray(d.rejected) && d.rejected.length === 0 && d.summary && d.staleCount === 0 && d.rows.every((x) => x.file && x.capturedAt && typeof x.ageDays === "number" && x.stale === false), `exit ${r.code} ${r.out} ${JSON.stringify(d).slice(0, 300)}`);
      check(`${L} the last output is the one-line "OK ${mod}: N rows from M files, R rejected, S stale -> <file>"`, new RegExp(`^OK ${mod}: ${Object.keys(M.files).length} rows from ${Object.keys(M.files).length} files, 0 rejected, 0 stale`, "m").test(r.so), r.so);
      const broken = { "bad-notjson.json": "{ not json", "bad-nodate.json": bad(mod, { capturedAt: undefined }), "bad-nobrowser.json": bad(mod, { browser: undefined }), "bad-future.json": bad(mod, { capturedAt: ago(-10) }) };
      w = world(mod, { ...M.files, ...broken }); r = await w.go(); d = r.code === 0 ? w.doc() : null;
      const rej = (f) => d?.rejected.find((x) => x.file === f)?.reason || "";
      check(`${L} a file that is not JSON, has no capture date, no browser or a date in the future is REJECTED with the reason; the good files still count`, d && d.rows.length === Object.keys(M.files).length && /not a JSON object/.test(rej("bad-notjson.json")) && /capturedAt/.test(rej("bad-nodate.json")) && /no browser/.test(rej("bad-nobrowser.json")) && /in the future/.test(rej("bad-future.json")) && /rejected bad-future\.json: /.test(r.so), `exit ${r.code} ${JSON.stringify(d?.rejected)} ${r.out.slice(-300)}`);
      w = world(mod, broken); r = await w.go();
      check(`${L} every file rejected: BLOCKED (exit 3) naming the first reason and the format to follow`, r.code === 3 && /^BLOCKED: every capture file was rejected \(4; first: bad-future\.json: .*\) \| unblocks: capture again in the format at the top of scripts\/import-/m.test(r.so), `exit ${r.code} ${r.out}`);
      const old = structuredClone(M.files[firstFile(mod)]); old.capturedAt = ago(60);
      w = world(mod, { ...M.files, [firstFile(mod)]: old }); r = await w.go(); d = r.code === 0 ? w.doc() : null;
      check(`${L} a capture older than --max-age-days (30) is kept and marked stale, counted in staleCount; --max-age-days 90 makes it fresh`, d && d.staleCount === 1 && d.rows.find((x) => x.file === firstFile(mod))?.stale === true && /1 stale/.test(r.so) && (await w.go(["--max-age-days", "90"]), w.doc().staleCount === 0), `exit ${r.code} ${JSON.stringify(d?.rows.map((x) => [x.file, x.stale]))}`);
      const u1 = await run(M.script, []), u2 = await run(M.script, [SITE, "--max-age-days", "abc"]);
      check(`${L} usage: no target is exit 2 with the usage line; a --max-age-days that is not a number is exit 2`, u1.code === 2 && /usage: node import-/.test(u1.se) && u2.code === 2 && /--max-age-days/.test(u2.se), `${u1.code} ${u1.se} | ${u2.code} ${u2.se}`);
    }

    // ---- index ----
    let r, w = world("index", MODULES.index.files); await w.go(); let s = w.doc().summary;
    check("index: counts are read from the text ('About 1,230 results' -> 1230) or the number (12); listed addresses are counted", s.google?.indexedCount === 1230 && s.google?.listedUrls === 3 && s.bing?.indexedCount === 12 && s.bing?.listedUrls === 1, JSON.stringify(s));
    check("index: a service counts as listed when ANY engine lists it (hard money loans on Google, bridge loans on Bing only): 2 checked, 2 listed, none missing; names are lower-cased", s.servicesChecked === 2 && s.servicesListed === 2 && s.servicesMissing?.length === 0, JSON.stringify(s));
    w = world("index", { "google.json": MODULES.index.files["google.json"] }); await w.go(); s = w.doc().summary;
    check("index: with only Google, 'bridge loans' is listed nowhere: named under servicesMissing; the missing Bing engine is null, not a zero", s.servicesMissing?.join() === "bridge loans" && s.servicesListed === 1 && s.bing === null, JSON.stringify(s));
    w = world("index", { "g1.json": bad("index", { resultCountText: "No results found for site:x", resultCount: undefined }), "g2.json": { ...MODULES.index.files["bing.json"], resultCount: undefined, resultCountText: undefined, countShown: false }, "g3.json": bad("index", { resultCountText: "0 results", resultCount: undefined }) }); await w.go(); let rows = w.doc().rows;
    check("index: 'No results' and '0 results' are 0 (and '1,230 results' is not); an engine that shows no count (countShown false) is null ('not shown'), never guessed", rows.find((x) => x.file === "g1.json")?.resultCount === 0 && rows.find((x) => x.file === "g3.json")?.resultCount === 0 && rows.find((x) => x.file === "g2.json")?.resultCount === null && rows.find((x) => x.file === "g2.json")?.countShown === false, JSON.stringify(rows));
    w = world("index", { ...MODULES.index.files, "r1.json": bad("index", { query: "example.com" }), "r2.json": bad("index", { engine: "yahoo" }), "r3.json": bad("index", { listedUrls: undefined }), "r4.json": bad("index", { resultCountText: undefined, resultCount: undefined }) }); await w.go(); let rj = w.doc().rejected;
    check("index: a query that is not site:<host>, an engine that is not google|bing, no listedUrls, and no count without countShown:false are each rejected for their own reason", rj.length === 4 && /not a "site:<host>"/.test(rj.find((x) => x.file === "r1.json").reason) && /engine is not google\|bing/.test(rj.find((x) => x.file === "r2.json").reason) && /no listedUrls/.test(rj.find((x) => x.file === "r3.json").reason) && /countShown/.test(rj.find((x) => x.file === "r4.json").reason), JSON.stringify(rj));

    // ---- trends ----
    w = world("trends", MODULES.trends.files); await w.go(); let t = w.doc().rows[0] || {};
    check("trends: California at 87 among 5 states with Texas at 100 above it is rank 2 of 5; Sacramento at 100 in the metro table is rank 1 of 2; the top 3 are listed", t.stateRank === 2 && t.stateValue === 87 && t.statesCount === 5 && t.metroRank === 1 && t.metroValue === 100 && t.metrosCount === 2 && t.top3States.join() === "Texas 100,California 87,Florida 61", JSON.stringify(t));
    check("trends: the service is lower-cased and the summary says the scale is relative interest, not a search count", t.service === "hard money loans" && /not a search count/.test(w.doc().summary.scale) && w.doc().summary.bestRank?.stateRank === 2, JSON.stringify(w.doc().summary));
    w = world("trends", { "a.json": bad("trends", { client: { state: "New York" } }), "b.json": bad("trends", { client: { state: "Florida" } }) }); await w.go(); rows = w.doc().rows;
    check("trends: equal values share a rank (Florida and New York at 61 are both rank 3 of 5); a client with no metro has metroRank null", rows.every((x) => x.stateRank === 3 && x.metroRank === null), JSON.stringify(rows.map((x) => [x.stateRank, x.metroRank])));
    w = world("trends", { ...MODULES.trends.files, "r1.json": bad("trends", { client: { state: "Narnia" } }), "r2.json": bad("trends", { regions: [{ name: "California", value: 130 }] }), "r3.json": bad("trends", { address: undefined }), "r4.json": bad("trends", { client: { state: "California", metro: "Atlantis" } }) }); await w.go(); rj = w.doc().rejected;
    check("trends: a client state that is not in the table, a value above 100, no address and a metro that is not in its table are each rejected for their own reason", rj.length === 4 && /not one of the regions/.test(rj.find((x) => x.file === "r1.json").reason) && /0 to 100/.test(rj.find((x) => x.file === "r2.json").reason) && /no Trends address/.test(rj.find((x) => x.file === "r3.json").reason) && /not one of the metros/.test(rj.find((x) => x.file === "r4.json").reason), JSON.stringify(rj));

    // ---- ai ----
    w = world("ai", MODULES.ai.files); await w.go(); s = w.doc().summary; rows = w.doc().rows;
    const cg = s.engines.find((x) => x.engine === "chatgpt"), pp = s.engines.find((x) => x.engine === "perplexity");
    check("ai: 'named' is checked against the answer text (business name or domain): chatgpt named once of two (the second answer says nothing of the business although the capture says named), perplexity 0 of 1, shares 0.5 and 0", cg.questions === 2 && cg.named === 1 && cg.shareNamed === 0.5 && pp.named === 0 && pp.shareNamed === 0 && s.questions === 3 && s.namedAnswers === 1, JSON.stringify(s.engines));
    check("ai: where the capture and the text disagree the file is listed (disagreements: chatgpt-2.json) and the row keeps both values", s.disagreements.join() === "chatgpt-2.json" && rows.find((x) => x.file === "chatgpt-2.json").namedByCapture === true && rows.find((x) => x.file === "chatgpt-2.json").namedByText === false, JSON.stringify([s.disagreements, rows.find((x) => x.file === "chatgpt-2.json")]));
    check("ai: an engine that could not be read is a BLOCKED engine with its reason (copilot: sign-in wall), never a zero, and it is not counted in the questions", s.blockedEngines.length === 1 && s.blockedEngines[0].engine === "copilot" && s.blockedEngines[0].reason === "sign-in wall" && s.engines.find((x) => x.engine === "copilot")?.status === "blocked" && s.engines.find((x) => x.engine === "copilot").questions === 0, JSON.stringify([s.blockedEngines, s.engines]));
    check("ai: competitors and cited domains are counted (kiavi.com cited twice, www removed; Kiavi named in two answers), and the client's own domain cited once is ownDomainCited 1", s.competitors.find((x) => x.name === "Kiavi")?.count === 2 && s.citedDomains.find((x) => x.name === "kiavi.com")?.count === 2 && s.ownDomainCited === 1, JSON.stringify([s.competitors, s.citedDomains, s.ownDomainCited]));
    w = world("ai", { ...MODULES.ai.files, "r1.json": bad("ai", { type: "other" }), "r2.json": bad("ai", { answerText: undefined }), "r3.json": bad("ai", { competitorsNamed: "Kiavi" }), "r4.json": bad("ai", { engine: "gemini" }), "r5.json": bad("ai", { engine: "bard" }), "r6.json": bad("ai", { named: undefined }) }); await w.go(); rj = w.doc().rejected;
    check("ai: a bad type, no answer text, a competitor list that is not a list, a gemini answer that was not signed in, an unknown engine and a missing named are each rejected for their own reason", rj.length === 6 && /type is not buyer\|brand/.test(rj.find((x) => x.file === "r1.json").reason) && /no answerText/.test(rj.find((x) => x.file === "r2.json").reason) && /competitorsNamed/.test(rj.find((x) => x.file === "r3.json").reason) && /signedIn: true/.test(rj.find((x) => x.file === "r4.json").reason) && /engine is not chatgpt/.test(rj.find((x) => x.file === "r5.json").reason) && /named must be true or false/.test(rj.find((x) => x.file === "r6.json").reason), JSON.stringify(rj));
    w = world("ai", { "chatgpt-1.json": MODULES.ai.files["chatgpt-1.json"] }, { business: false }); r = await w.go();
    check("ai: without business.json the text check is skipped (namedByText null, agrees null) and the capture's own 'named' counts, said plainly", r.code === 0 && w.doc().rows[0].namedByText === null && w.doc().rows[0].agrees === null && w.doc().rows[0].named === true, `exit ${r.code} ${r.out}`);

    // ---- reputation ----
    w = world("reputation", MODULES.reputation.files); await w.go(); s = w.doc().summary; rows = w.doc().rows;
    const cl = s.subjects.find((x) => x.subject === "client"), ki = s.subjects.find((x) => x.subject === "kiavi.com");
    check("reputation: the client is first; 3 sites checked, 2 listed (Yelp: not listed), 120 reviews, the rating weighted by review count ((4.8*100 + 4*20)/120 = 4.67), 3 complaints, newest review date the latest", s.subjects[0].subject === "client" && cl.sitesChecked === 3 && cl.sitesListed === 2 && cl.totalReviews === 120 && cl.weightedRating === 4.67 && cl.complaints === 3 && cl.newestReviewDate === day(20), JSON.stringify(cl));
    check("reputation: a rating on another scale is converted to 5 (8.4 of 10 -> 4.2); the subject is lower-cased (Kiavi.com -> kiavi.com); a site where the business is not listed has no numbers and accredited null", ki.weightedRating === 4.2 && rows.find((x) => x.file === "client-yelp.json").rating === null && rows.find((x) => x.file === "client-yelp.json").accredited === null && rows.find((x) => x.file === "client-bbb.json").accredited === true, JSON.stringify([ki, rows.find((x) => x.file === "client-yelp.json")]));
    check("reputation: days since the newest review are computed (20 for the Google review)", Math.round(rows.find((x) => x.file === "client-google.json").daysSinceNewest) === 20, JSON.stringify(rows.find((x) => x.file === "client-google.json")));
    w = world("reputation", { ...MODULES.reputation.files, "r1.json": bad("reputation", { reviews: [{ author: "Jane Doe", text: "great" }] }), "r2.json": bad("reputation", { rating: 6 }), "r3.json": bad("reputation", { reviewCount: 1.5 }), "r4.json": bad("reputation", { listed: undefined }), "r5.json": bad("reputation", { reviewer: "John Roe" }) }); await w.go(); rj = w.doc().rejected;
    const raw = fs.readFileSync(w.out, "utf8");
    check("reputation: a file that holds reviewer names or review text is REJECTED and none of it is stored (the output has no 'Jane Doe' or 'John Roe'); a rating above the scale, a fractional count and a missing listed are rejected too", rj.length === 5 && /reviewer names or review text \(reviews\)/.test(rj.find((x) => x.file === "r1.json").reason) && /reviewer names or review text \(reviewer\)/.test(rj.find((x) => x.file === "r5.json").reason) && !/Jane Doe|John Roe/.test(raw) && /outside 0 to 5/.test(rj.find((x) => x.file === "r2.json").reason) && /whole number/.test(rj.find((x) => x.file === "r3.json").reason) && /listed must be true or false/.test(rj.find((x) => x.file === "r4.json").reason), JSON.stringify(rj));

    // ---- social ----
    w = world("social", MODULES.social.files); await w.go(); s = w.doc().summary; rows = w.doc().rows;
    const yt = rows.find((x) => x.file === "youtube.json"), ig = rows.find((x) => x.file === "instagram.json");
    check("social: '1.2K' followers is 1200; a post 10 days ago is active, one 200 days ago is not (active = within 90 days); the link status 200 works, 404 does not", yt.followers === 1200 && yt.active === true && yt.linkWorks === true && ig.active === false && ig.linkWorks === false && yt.postsIncludeShorts === true, JSON.stringify([yt, ig]));
    check("social: a login wall is a BLOCKED row (no number), not a zero; the summary counts profiles read (3), blocked (1), followers (1200+300+50), active platforms, and names the broken link", s.profilesRead === 3 && s.blocked === 1 && s.totalFollowers === 1550 && s.platformsActive.join() === "youtube" && s.linksBroken.join() === "https://www.instagram.com/svr/" && rows.find((x) => x.file === "linkedin.json").status === "blocked" && rows.find((x) => x.file === "linkedin.json").followers === undefined, JSON.stringify(s));
    check("social: a profile with no post date and no link has nulls (daysSinceNewest null, active false, linkWorks null)", (() => { const f = rows.find((x) => x.file === "facebook.json"); return f.daysSinceNewest === null && f.active === false && f.linkWorks === null && f.linkTarget === null; })(), JSON.stringify(rows.find((x) => x.file === "facebook.json")));
    w = world("social", { ...MODULES.social.files, "r1.json": bad("social", { platform: "myspace" }), "r2.json": bad("social", { followers: "abc" }), "r3.json": bad("social", { linkStatus: 200.5 }), "r4.json": bad("social", { profileUrl: undefined }), "r5.json": bad("social", { newestPostDate: "someday" }) }); await w.go(); rj = w.doc().rejected;
    check("social: an unknown platform, followers that are not a number, a link status that is not an HTTP status, no profile address and a bad post date are each rejected for their own reason", rj.length === 5 && /platform is not youtube/.test(rj.find((x) => x.file === "r1.json").reason) && /followers must be a number/.test(rj.find((x) => x.file === "r2.json").reason) && /linkStatus must be an HTTP status/.test(rj.find((x) => x.file === "r3.json").reason) && /no profileUrl/.test(rj.find((x) => x.file === "r4.json").reason) && /newestPostDate is not a date/.test(rj.find((x) => x.file === "r5.json").reason), JSON.stringify(rj));

    // ---- ads ----
    w = world("ads", MODULES.ads.files); await w.go(); s = w.doc().summary; rows = w.doc().rows;
    const cm = rows.find((x) => x.file === "client-meta.json");
    check("ads: the client runs ads on Meta only (3 ads since 40 days ago, formats lower-cased), Google shows none: clientRunning true, 3 advertisers checked, 2 running, 1 competitor running", cm.running === true && cm.adCount === 3 && cm.runningDays === 40 && cm.formats.join() === "image,video" && s.clientRunning === true && s.advertisersChecked === 3 && s.advertisersRunning === 2 && s.competitorsRunning === 1, JSON.stringify([cm, s]));
    check("ads: an advertiser that is not running has adCount 0 and no formats, never null; the client comes first in the summary", rows.find((x) => x.file === "client-google.json").adCount === 0 && rows.find((x) => x.file === "client-google.json").formats.length === 0 && s.advertisers[0].advertiser === "client" && s.advertisers[0].adCount === 3 && s.advertisers[0].librariesChecked === 2, JSON.stringify(s.advertisers));
    w = world("ads", { ...MODULES.ads.files, "r1.json": bad("ads", { running: true, adCount: undefined }), "r2.json": bad("ads", { library: "bing-ads" }), "r3.json": bad("ads", { running: true, adCount: 2, since: "x" }), "r4.json": bad("ads", { running: undefined }), "r5.json": bad("ads", { running: true, adCount: 2, formats: "image" }) }); await w.go(); rj = w.doc().rejected;
    check("ads: a running advertiser with no ad count, an unknown library, a bad since date, no running flag and formats that are not a list are each rejected for their own reason", rj.length === 5 && /needs adCount/.test(rj.find((x) => x.file === "r1.json").reason) && /library is not google-transparency/.test(rj.find((x) => x.file === "r2.json").reason) && /since is not a date/.test(rj.find((x) => x.file === "r3.json").reason) && /running must be true or false/.test(rj.find((x) => x.file === "r4.json").reason) && /formats must be a list/.test(rj.find((x) => x.file === "r5.json").reason), JSON.stringify(rj));

    const net = fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8").trim() : "";
    check("importers: nothing in this suite left the machine (network guard log empty)", !net, net);
  } finally { rmTmp(tmp); }
  return results;
}

const LC = "lib-captures.mjs";
const MUTANTS = [
  { name: "no capture files does not block", patches: [{ file: LC, from: "if (!files.length) {", to: "if (false) {" }], expect: [/^index: no capture files: BLOCKED/, /^ads: no capture files: BLOCKED/] },
  { name: "every file rejected is not BLOCKED", patches: [{ file: LC, from: "if (!rows.length) {", to: "if (false) {" }], expect: [/^index: every file rejected/, /^social: every file rejected/] },
  { name: "nothing is ever stale", patches: [{ file: LC, from: "stale: age > maxAgeDays", to: "stale: false" }], expect: [/^index: a capture older than --max-age-days/, /^reputation: a capture older/] },
  { name: "a capture without a date is accepted", patches: [{ file: LC, from: "if (!j.capturedAt || Number.isNaN(at))", to: "if (false)" }], expect: [/^index: a file that is not JSON, has no capture date/, /^ai: a file that is not JSON/] },
  { name: "a capture without a browser is accepted", patches: [{ file: LC, from: "if (!nonEmpty(j.browser))", to: "if (false)" }], expect: [/^trends: a file that is not JSON, has no capture date/] },
  { name: "a capture dated in the future is accepted", patches: [{ file: LC, from: "else if (at > Date.now() + 86400000)", to: "else if (false)" }], expect: [/^ads: a file that is not JSON, has no capture date/] },
  { name: "K and M suffixes are not read", patches: [{ file: LC, from: "(m[2] ? (/[Kk]/.test(m[2]) ? 1e3 : 1e6) : 1)", to: "1" }], expect: [/^social: '1\.2K' followers is 1200/] },
  { name: "index: the count in the text is not read", patches: [{ file: "import-index.mjs", from: "n = countFromText(j.resultCountText);", to: "n = null;" }], expect: [/^index: counts are read from the text/] },
  { name: "index: 'No results' is not zero", patches: [{ file: "import-index.mjs", from: "if (/no results|did not match any|(^|[^\\d,.])0\\s+results/i.test(s)) return 0;", to: "" }], expect: [/^index: 'No results' and '0 results' are 0/] },
  { name: "index: missing services are the listed ones", patches: [{ file: "import-index.mjs", from: ".filter(([, v]) => !v).map(([k]) => k).sort()", to: ".filter(([, v]) => v).map(([k]) => k).sort()" }], expect: [/^index: with only Google/] },
  { name: "index: an engine that shows no count is a zero", patches: [{ file: "import-index.mjs", from: "countShown: n != null,", to: "countShown: true," }, { file: "import-index.mjs", from: "if (n == null && j.countShown !== false) e.push(", to: "if (n == null) n = 0; if (false) e.push(" }], expect: [/^index: 'No results' and '0 results' are 0/] },
  { name: "trends: equal values do not share a rank", patches: [{ file: "import-trends.mjs", from: "rank: 1 + table.filter((r) => r.value > hit.value).length", to: "rank: 1 + table.filter((r) => r.value >= hit.value).length" }], expect: [/^trends: California at 87/, /^trends: equal values share a rank/] },
  { name: "trends: a client state outside the table is accepted", patches: [{ file: "import-trends.mjs", from: "else if (regions && regions.length && !st) e.push(", to: "else if (false) e.push(" }], expect: [/^trends: a client state that is not in the table/] },
  { name: "ai: the answer text is not checked, the capture's 'named' is believed", patches: [{ file: "import-ai.mjs", from: "named: byText ?? j.named,", to: "named: j.named," }], expect: [/^ai: 'named' is checked against the answer text/] },
  { name: "ai: disagreements are not reported", patches: [{ file: "import-ai.mjs", from: "agrees: byText == null ? null : byText === j.named,", to: "agrees: null," }], expect: [/^ai: where the capture and the text disagree/] },
  { name: "ai: a blocked engine is not recorded", patches: [{ file: "import-ai.mjs", from: "if (nonEmpty(j.blocked)) return {", to: "if (false) return {" }], expect: [/^ai: an engine that could not be read is a BLOCKED engine/] },
  { name: "ai: an unsigned gemini answer is accepted", patches: [{ file: "import-ai.mjs", from: "if (engine === \"gemini\" && j.signedIn !== true) e.push(", to: "if (false) e.push(" }], expect: [/^ai: a bad type, no answer text/] },
  { name: "reputation: reviewer names are accepted", patches: [{ file: "import-reputation.mjs", from: "if (leaked.length) e.push(", to: "if (false) e.push(" }], expect: [/^reputation: a file that holds reviewer names/] },
  { name: "reputation: the rating is not weighted by review count", patches: [{ file: "import-reputation.mjs", from: "rated.reduce((a, r) => a + (r.rating / r.ratingScale) * 5 * r.reviewCount, 0) / w", to: "rated.reduce((a, r) => a + (r.rating / r.ratingScale) * 5, 0) / rated.length" }], expect: [/^reputation: the client is first/] },
  { name: "reputation: another scale is not converted", patches: [{ file: "import-reputation.mjs", from: "(r.rating / r.ratingScale) * 5 * r.reviewCount", to: "r.rating * r.reviewCount" }], expect: [/^reputation: a rating on another scale is converted/] },
  { name: "social: a post of any age is active", patches: [{ file: "import-social.mjs", from: "active: d != null && d <= 90", to: "active: d != null" }], expect: [/^social: '1\.2K' followers is 1200/] },
  { name: "social: a 404 link counts as working", patches: [{ file: "import-social.mjs", from: "linkWorks: j.linkStatus == null ? null : j.linkStatus >= 200 && j.linkStatus < 300", to: "linkWorks: j.linkStatus == null ? null : true" }], expect: [/^social: '1\.2K' followers is 1200/, /^social: a login wall/] },
  { name: "social: a login wall is not recorded as blocked", patches: [{ file: "import-social.mjs", from: "if (nonEmpty(j.blocked)) return {", to: "if (false) return {" }], expect: [/^social: a login wall is a BLOCKED row/] },
  { name: "ads: competitors running counts the client too", patches: [{ file: "import-ads.mjs", from: "competitorsRunning: advertisers.filter((x) => x.advertiser !== \"client\" && x.running).length", to: "competitorsRunning: advertisers.filter((x) => x.running).length" }], expect: [/^ads: the client runs ads on Meta only/] },
  { name: "ads: a running advertiser needs no ad count", patches: [{ file: "import-ads.mjs", from: "if (n == null || n < 1 || !Number.isInteger(n)) e.push(", to: "if (false) e.push(" }], expect: [/^ads: a running advertiser with no ad count/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-importers.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "IMPORTERS", scenarios, MUTANTS, scriptsDir, argv: A }));
}
