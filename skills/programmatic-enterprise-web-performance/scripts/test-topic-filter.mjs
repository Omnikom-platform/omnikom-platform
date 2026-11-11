// Usage: node test-topic-filter.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of the topic filter on Bing's related keywords (research-topic.mjs, used by research-bing.mjs and so by research.mjs before clustering): WO 40 B saw "summit racing equipment",
// "northern tool and equipment" and "advance america" among the keywords of a business lender; they share one word with a seed and passed the relevance filter. The topic filter
// judges a related keyword against the business's services (business.json vocabulary): kept when it holds a HEAD word (the thing sold: loans, financing) or at least half of its
// meaningful terms are service terms; dropped keywords are LISTED with their reason (droppedOffTopic, topicFilter), never silent; seeds are never dropped; with no vocabulary
// the filter says it did not apply. Fixtures only: pure calls and research-bing.mjs against a local fake Bing server; no network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { serve, runner, J, W, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const KEY = "TOPICKEY-SECRET-abc";   // gitleaks:allow (a made-up test key)
const LENDER = { topicFilter: "vocabulary", name: "Topic Test Capital", domain: "topic-test.test", kind: "lender", market: { country: "US", language: "en" }, offer: "short-term real estate loans for investors", vocabulary: ["hard money loans", "bridge loans", "fix and flip financing", "real estate investor loans"], locations: [{ name: "Sacramento, CA", serviceArea: ["Elk Grove, CA"] }] };
const BAD = ["summit racing equipment", "northern tool and equipment", "advance america"];
const GOOD = ["hard money lender", "bridge loan rates", "rental property loans", "fix and flip financing", "private money loans sacramento", "real estate investor loan requirements"];
const kw = (query, related = true, relatedTo = "hard money loans") => ({ query, related, relatedTo, volume: { value: 100 } });

async function scenarios(dir) {
  const results = [], check = checker(results);
  const tmp = mkTmp("topic"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
  fs.mkdirSync(home);
  const run = runner(dir, home, netLog, ["BING_WEBMASTER_KEY", "BING_API_BASE"]);
  const tf = await import(pathToFileURL(path.join(dir, "research-topic.mjs")).href + "?" + Math.random());
  try {
    // ---- the pure filter ----
    const all = [kw("hard money loans", false), ...BAD.map((q) => kw(q)), ...GOOD.map((q) => kw(q))];
    const r = tf.topicFilter(all, LENDER, { placeTerms: new Set(["sacramento", "california"]) });
    check("topic: the three keywords WO 40 B saw for a business lender are dropped (summit racing equipment, northern tool and equipment, advance america), applied true", r.applied === true && BAD.every((q) => r.dropped.some((d) => d.query === q)) && r.dropped.length === 3, JSON.stringify(r.dropped.map((d) => d.query)));
    check("topic: the on-topic related keywords stay (hard money lender, bridge loan rates, rental property loans, fix and flip financing, private money loans sacramento, real estate investor loan requirements)", GOOD.every((q) => r.kept.some((k) => k.query === q)), JSON.stringify(r.kept.map((k) => k.query)));
    check("topic: a seed (related false) is kept whatever it says: the owner approved it", r.kept.some((k) => k.query === "hard money loans" && k.related === false) && tf.topicFilter([kw("zebra stripes", false)], LENDER).kept.length === 1, "");
    check("topic: every dropped keyword carries its reason (the terms it has, how many are services, the head words) and what it was related to; none is dropped silently (kept + dropped = all)", r.dropped.every((d) => /^topic: \d+ of its \d+ meaningful term\(s\) \(.+\) are among the business's services \(.+\) and none is a head word \(.+\)$/.test(d.reason) && d.relatedTo === "hard money loans") && r.kept.length + r.dropped.length === all.length, JSON.stringify(r.dropped[0]));
    check("topic: the head words are the LAST meaningful term of each vocabulary phrase (loan, financ) and the topic terms are all of them", r.headTerms.join() === "loan,financ" && ["hard", "money", "loan", "bridge", "flip", "financ", "real", "estate", "investor"].every((t) => r.topicTerms.includes(t)), JSON.stringify([r.headTerms, r.topicTerms]));
    const none = tf.topicFilter(all, { ...LENDER, vocabulary: undefined });
    check("topic: with no vocabulary the filter does not apply and says why (applied false, a reason), and drops nothing", none.applied === false && /no vocabulary/.test(none.reason) && none.kept.length === all.length && none.dropped.length === 0, JSON.stringify([none.applied, none.reason]));
    const generic = tf.topicFilter([kw("best near me")], LENDER);
    check("topic: a keyword with no meaningful term (only generic words) is dropped with that reason", generic.dropped.length === 1 && /no meaningful term/.test(generic.dropped[0].reason), JSON.stringify(generic.dropped));
    const place = tf.topicFilter([kw("sacramento hard money")], LENDER, { placeTerms: new Set(["sacramento"]) });
    check("topic: place names do not count as service terms (but 'sacramento hard money' stays: hard and money do)", place.kept.length === 1, JSON.stringify(place));

    // ---- through research-bing.mjs: what research.mjs clusters ----
    const mode = {};
    const srv = await serve((rq) => {
      const u = new URL(rq.url, "http://x"), m = u.pathname.split("/").pop(), q = u.searchParams.get("q");
      if (u.searchParams.get("apikey") !== KEY) return { status: 401, body: {} };
      if (m === "GetKeyword") return { body: { d: [{ Query: q, Impressions: 500, BroadImpressions: 900, Date: "/Date(1760000000000)/" }] } };
      if (m === "GetRelatedKeywords") return { body: { d: [...BAD, ...GOOD].map((x) => ({ Query: x, Impressions: 80, BroadImpressions: 120, Date: "/Date(1760000000000)/" })) } };
      return { status: 404, body: {} };
    });
    const env = { BING_API_BASE: `${srv.url}/webmaster/api.svc/json`, BING_WEBMASTER_KEY: KEY, PEWP_TEST_GAP_MS: "0" };
    const world = (n, business) => {
      const cwd = path.join(tmp, n), pewp = path.join(cwd, "site-checks", "topic-test.test", ".pewp");
      W(path.join(pewp, "business.json"), business);
      return { cwd, out: () => { const f = path.join(pewp, "research", "bing.json"); return fs.existsSync(f) ? J(f) : { keywords: [], droppedOffTopic: [], topicFilter: null, missing: true }; } };
    };
    let w = world("lender", LENDER);
    let x = await run("research-bing.mjs", ["https://topic-test.test/", "--seed", "hard money loans", "--seed", "equipment financing", "--seed", "cash advance business", "--cwd", w.cwd], { env });
    let b = w.out();
    check("topic: research-bing.mjs (what research.mjs clusters) keeps no off-topic related keyword: none of the three is in keywords, the seed and the on-topic ones are", x.code === 0 && BAD.every((q) => !b.keywords.some((k) => k.query === q)) && GOOD.every((q) => b.keywords.some((k) => k.query === q)) && b.keywords.some((k) => k.query === "hard money loans" && k.related === false), `exit ${x.code} ${x.out.slice(-300)} ${JSON.stringify(b.keywords.map((k) => k.query))}`);
    check("topic: the dropped ones are LISTED in bing.json droppedOffTopic with the reason 'topic: ...', and bing.json says topicFilter { applied true, topicTerms, headTerms, dropped 3 }", BAD.every((q) => b.droppedOffTopic.some((d) => d.query === q && /^topic: /.test(d.reason))) && b.topicFilter?.applied === true && b.topicFilter.dropped === 3 && b.topicFilter.headTerms?.join() === "loan,financ", JSON.stringify([b.droppedOffTopic?.filter((d) => /^topic/.test(d.reason)).map((d) => d.query), b.topicFilter]));
    check("topic: the last line counts them with the other off-topic drops ('... related dropped as off topic')", /related dropped as off topic/.test(x.so) && new RegExp(`\\(${b.droppedOffTopic.length} related dropped as off topic\\)`).test(x.so), x.so);
    w = world("novocab", { ...LENDER, vocabulary: undefined });
    x = await run("research-bing.mjs", ["https://topic-test.test/", "--seed", "hard money loans", "--seed", "equipment financing", "--seed", "cash advance business", "--cwd", w.cwd], { env });
    b = w.out();
    check("topic: with no vocabulary bing.json says topicFilter applied false with the reason, and the three stay (the relevance filter alone passed them: they are not dropped for a topic nobody defined)", b.topicFilter?.applied === false && /no vocabulary/.test(b.topicFilter.reason || "") && BAD.every((q) => b.keywords.some((k) => k.query === q)), JSON.stringify(b.topicFilter));
    w = world("default", { ...LENDER, topicFilter: undefined });
    x = await run("research-bing.mjs", ["https://topic-test.test/", "--seed", "hard money loans", "--seed", "equipment financing", "--seed", "cash advance business", "--cwd", w.cwd], { env });
    b = w.out();
    check("topic: the filter is OFF unless business.json says \"topicFilter\": \"vocabulary\" (a pending decision of the head of SEO): bing.json says applied false and why, and nothing is dropped for its topic", b.topicFilter?.applied === false && /is off/.test(b.topicFilter.reason || "") && BAD.every((q) => b.keywords.some((k) => k.query === q)) && !b.droppedOffTopic.some((d) => /^topic/.test(d.reason)), JSON.stringify(b.topicFilter));
    srv.close();
    const net = fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8").trim() : "";
    check("topic: nothing in this suite left the machine (network guard log empty)", !net, net);
  } finally { rmTmp(tmp); }
  return results;
}

const RT = "research-topic.mjs", RB = "research-bing.mjs";
const MUTANTS = [
  { name: "no topic filtering at all", patches: [{ file: RT, from: "if (head.length || (t.length && hit.length / t.length > 0.5)) { kept.push(k); continue; }", to: "{ kept.push(k); continue; }" }], expect: [/^topic: the three keywords WO 40 B saw/, /^topic: research-bing.mjs \(what research.mjs clusters\) keeps no off-topic/] },
  { name: "a related keyword is kept when it shares ONE term (the old behaviour)", patches: [{ file: RT, from: "(t.length && hit.length / t.length > 0.5)", to: "(hit.length >= 1)" }], expect: [/^topic: the three keywords WO 40 B saw/] },
  { name: "the head word does not rescue a keyword", patches: [{ file: RT, from: "if (head.length || (t.length", to: "if ((t.length" }], expect: [/^topic: the on-topic related keywords stay/] },
  { name: "a seed can be dropped", patches: [{ file: RT, from: "if (!k.related) { kept.push(k); continue; } // a seed: the owner approved it", to: "" }], expect: [/^topic: a seed \(related false\) is kept/] },
  { name: "a dropped keyword has no reason", patches: [{ file: RT, from: "reason: `topic: ${t.length ?", to: "reason: `${t.length ?" }], expect: [/^topic: every dropped keyword carries its reason/, /^topic: the dropped ones are LISTED/] },
  { name: "no vocabulary: the filter drops everything related", patches: [{ file: RT, from: "if (!phrases.length) return { applied: false,", to: "if (false) return { applied: false," }], expect: [/^topic: with no vocabulary the filter does not apply/] },
  { name: "the head is the first word of a phrase, not the last", patches: [{ file: RT, from: "heads.add(t.at(-1))", to: "heads.add(t[0])" }], expect: [/^topic: the head words are the LAST meaningful term/, /^topic: the on-topic related keywords stay/] },
  { name: "place names count as service terms", patches: [{ file: RT, from: "&& !placeTerms.has(t));", to: ");" }], expect: [/^topic: place names do not count/] },
  { name: "research-bing.mjs does not apply the filter", patches: [{ file: RB, from: "const tf = { ...(setting.value === \"vocabulary\" ? topicFilter(keywords, b, { placeTerms }) : topicOff(keywords)), setting: setting.value, settingFrom: setting.from };", to: "const tf = { applied: false, reason: \"off\", kept: keywords, dropped: [], topicTerms: [], headTerms: [], setting: setting.value, settingFrom: setting.from };" }], expect: [/^topic: research-bing.mjs \(what research.mjs clusters\) keeps no off-topic/, /^topic: the dropped ones are LISTED/] },
  { name: "the filter is on without being asked for", patches: [{ file: RB, from: "setting.value === \"vocabulary\" ? topicFilter(", to: "true ? topicFilter(" }], expect: [/^topic: the filter is OFF unless business.json says/] },
  { name: "the dropped keywords are not listed", patches: [{ file: RB, from: "droppedOffTopic.push(...tf.dropped.map(({ query, relatedTo, reason }) => ({ query, relatedTo, reason })));", to: "" }], expect: [/^topic: the dropped ones are LISTED/, /^topic: the last line counts them/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-topic-filter.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "TOPIC FILTER", scenarios, MUTANTS, scriptsDir, argv: A }));
}
