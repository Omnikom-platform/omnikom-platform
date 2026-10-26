// Usage: node test-rules.mjs [--scripts <dir>] [--json] [--no-mutants] [--verbose]
// Self-test of the rulesets in rules/ and of the growth algorithms of shipgate 06-growth.md section 9 (lib-snowball, lib-text, lib-growth):
//   R  rulesets: every entry names a source, the copies are byte-identical to shipgate's, the CTR curve is labelled an estimate
//   S  Snowball English stemmer vectors          H  head term (web-delivery section 12)         T  terms (9.5)
//   I  intent, ordered rules (9.2)               P  page type, ordered rules (9.3)               K  intent -> page type table (03 section 22.2)
//   C  clusters, union-find over top-10 overlap (9.1)                                            M  page-cluster match (9.7)
//   X  watched-fail mutants: each rule is broken in a copy of the scripts and this suite must go red for that rule
// Fixtures only: no network, no live site. Exit 0 = all pass.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(opt("--scripts") || HERE);
const RULES = process.env.PEWP_RULES_DIR || path.join(HERE, "..", "rules");
// machine paths live in ~/.claude/machine.local.json ("shipgate"); the literal is this machine's value, kept as the fallback
const SHIPGATE = (() => { try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", "machine.local.json"), "utf8")).shipgate || null; } catch { return null; } })() || "D:/internal building pipeline for making sure that all websites we make real enterprise grade on search engines/shipgate";
const imp = (f) => import(pathToFileURL(path.join(SCRIPTS, f)).href);
const R = [];
const check = (name, ok, detail = "") => { R.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 600) }); };
const J = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

async function suite() {
  process.env.PEWP_RULES_DIR = RULES;
  const TX = await imp("lib-text.mjs"), SB = await imp("lib-snowball.mjs"), G = await imp("lib-growth.mjs"), RL = await imp("lib-rules.mjs");

  // ------------------------------------------------ R: rulesets
  const IM = J(path.join(RULES, "intent-modifiers.json")), DD = J(path.join(RULES, "directory-domains.json")), CS = J(path.join(RULES, "citation-sources.json")), CTR = J(path.join(RULES, "ctr-curve.json"));
  const entryHasSource = (list, src) => list.every((e) => e.source && src[e.source]?.title && src[e.source]?.basis);
  const en = IM["en-US"];
  check("R: intent-modifiers.json en-US has local, transactional and commercial lists, every entry names a source that _sources describes", ["local", "transactional", "commercial"].every((k) => en[k]?.length >= 5 && entryHasSource(en[k], IM._sources)), JSON.stringify(Object.keys(en)));
  check("R: the five commercial modifiers 06 9.2 names (best, vs, review, top, price) are in the ruleset", ["best", "vs", "review", "top", "price"].every((t) => en.commercial.some((e) => e.term === t)));
  const hosts = new Set(DD.domains.map((d) => d.host));
  check("R: directory-domains.json holds the real-estate portals and the review/pro directories the task names", ["zillow.com", "realtor.com", "redfin.com", "trulia.com", "homes.com", "yelp.com", "bbb.org", "angi.com", "houzz.com", "nextdoor.com", "reddit.com"].every((h) => hosts.has(h)));
  check("R: directory-domains.json: every entry has host, brand, kind (directory|marketplace|forum) and a described source; no host twice", DD.domains.every((d) => d.host && d.brand && ["directory", "marketplace", "forum"].includes(d.kind) && DD._sources[d.source]?.title) && hosts.size === DD.domains.length);
  const listed = Object.keys(CS).filter((k) => !k.startsWith("_")).flatMap((k) => CS[k]);
  const E = CS._entries;
  check("R: citation-sources.json: the shape local-nap.mjs reads (US -> hosts, US:real-estate -> hosts); Google, Bing, Apple, Yelp, BBB, Yellow Pages and the zillow/realtor/homes/redfin/trulia agent profiles are in it", Array.isArray(CS.US) && Array.isArray(CS["US:real-estate"]) && ["google.com (Google Business Profile)", "bing.com (Bing Places)", "apple.com (Apple Business Connect)", "yelp.com", "bbb.org", "yellowpages.com"].every((h) => CS.US.includes(h)) && ["zillow.com", "realtor.com", "homes.com", "redfin.com", "trulia.com"].every((h) => CS["US:real-estate"].includes(h)));
  check("R: citation-sources.json: every listed directory has _entries with name, type and a described source (entry-level provenance)", listed.every((h) => E[h]?.name && E[h]?.type && CS._sources[E[h].source]?.title && CS._sources[E[h].source]?.basis) && CS["US:aggregators"].length >= 2);
  const pos = (CTR.positions || []).map((v, i) => [i + 1, v]);
  check("R: ctr-curve.json: positions[] 1-10 (the shape measure.mjs reads), strictly falling, labelled an industry-average ESTIMATE, with study name, url, date and what was verified", pos.length === 10 && pos.every(([, v], i) => i === 0 || v < pos[i - 1][1]) && CTR.estimate === true && /estimate/i.test(CTR.label) && CTR.study.name && /^https:\/\//.test(CTR.study.url) && CTR.study.retrieved && /UNPROVEN/.test(CTR.study.verification) && CTR.verifiedPositions.length >= 1);
  const sg = (f) => path.join(SHIPGATE, "rules", f);
  if (fs.existsSync(sg("stop-words.json")) && !process.env.PEWP_RULES_DIR_IS_COPY) {
    check("R: gazetteer/us.json and stop-words.json are byte-identical to shipgate's (sha256)", sha(path.join(RULES, "gazetteer", "us.json")) === sha(sg("gazetteer/us.json")) && sha(path.join(RULES, "stop-words.json")) === sha(sg("stop-words.json")));
  } else check("R: (skipped: shipgate not on this machine) copies compared", true);
  check("R: README records the source path and the date of the copies", /gazetteer\/us\.json/.test(fs.readFileSync(path.join(RULES, "README.md"), "utf8")) && /2026-10-22/.test(fs.readFileSync(path.join(RULES, "README.md"), "utf8")) && /shipgate/.test(fs.readFileSync(path.join(RULES, "README.md"), "utf8")));
  let missing = null; process.env.PEWP_RULES_DIR = path.join(os.tmpdir(), "pewp-no-such-rules"); RL.clearRuleCache();
  try { RL.loadRule("stop-words.json"); } catch (e) { missing = e; }
  process.env.PEWP_RULES_DIR = RULES; RL.clearRuleCache();
  check("R: a missing ruleset is a RuleMissing error that says where it ships, never a silent empty list", missing?.name === "RuleMissing" && /ships with the skill/.test(missing.message), String(missing));
  const bomDir = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-bom-rules-")); let bomRule = null;
  fs.writeFileSync(path.join(bomDir, "bom-rule.json"), String.fromCharCode(0xfeff) + JSON.stringify({ en: ["a"] })); // as PowerShell 5.1 / Notepad save it
  process.env.PEWP_RULES_DIR = bomDir; RL.clearRuleCache();
  try { bomRule = RL.loadRule("bom-rule.json"); } catch (e) { bomRule = e; }
  process.env.PEWP_RULES_DIR = RULES; RL.clearRuleCache(); fs.rmSync(bomDir, { recursive: true, force: true });
  check("R: a ruleset saved with a UTF-8 BOM loads (a BOM is not a JSON error)", Array.isArray(bomRule?.en) && bomRule.en[0] === "a", String(bomRule));
  let noLocale = null; try { TX.headTerm("hello world", { locale: "xx-XX" }); } catch (e) { noLocale = e; }
  check("R: a locale with no stop-word entry is a LocaleMissing error (04 section 15: no silent en fallback)", noLocale?.name === "LocaleMissing" || noLocale instanceof TX.LocaleMissing, String(noLocale));
  let noStem = null; try { TX.headTerm("hallo welt", { locale: "de-DE" }); } catch (e) { noStem = e; }
  check("R: a language with a Snowball stemmer that is not built here (de) says so instead of comparing unstemmed", /not built/.test(String(noStem)), String(noStem));
  check("R: a language with no Snowball stemmer (ja) is compared after NFKC and case folding only", (() => { try { return TX.headTerm("東京 ホテル", { locale: "ja-JP", country: "us" }).words.length >= 1; } catch (e) { return String(e); } })() === true);

  // ------------------------------------------------ S: stemmer
  const V = { caresses: "caress", ponies: "poni", ties: "tie", cats: "cat", feed: "feed", agreed: "agre", plastered: "plaster", motoring: "motor", sing: "sing", conflated: "conflat", troubled: "troubl", sized: "size", hopping: "hop", falling: "fall", hissing: "hiss", failing: "fail", filing: "file", happy: "happi", sky: "sky", skies: "sky", dying: "die", relational: "relat", conditional: "condit", rational: "ration", digitizer: "digit", differentli: "differ", operator: "oper", feudalism: "feudal", decisiveness: "decis", hopefulness: "hope", formaliti: "formal", electrical: "electr", hopeful: "hope", goodness: "good", revival: "reviv", allowance: "allow", inference: "infer", airliner: "airlin", adjustable: "adjust", irritant: "irrit", replacement: "replac", adjustment: "adjust", dependent: "depend", adoption: "adopt", activate: "activ", effective: "effect", probate: "probat", cease: "ceas", controll: "control", roll: "roll", houses: "hous", buyers: "buyer", consign: "consign", consigned: "consign", consigning: "consign", consignment: "consign", consist: "consist", consisted: "consist", consistency: "consist", consolation: "consol", news: "news", proceed: "proceed", running: "run", generously: "generous", gas: "gas", kiwis: "kiwi", gaps: "gap", cries: "cri", skis: "ski", inning: "inning", agent: "agent", selling: "sell", homes: "home", value: "valu", valuation: "valuat", realtors: "realtor", realtor: "realtor", ghastli: "ghast", deadli: "dead" };
  const wrong = Object.entries(V).filter(([w, s]) => SB.stemEnglish(w) !== s).map(([w, s]) => `${w}->${SB.stemEnglish(w)} (want ${s})`);
  check(`S: Snowball English stemmer: ${Object.keys(V).length} word vectors`, wrong.length === 0, wrong.join("; "));
  check("S: stemFor: en builds, ja/zh/ko/th stem nothing, an unbuilt Snowball language is refused", SB.stemFor("en-US").ok && SB.stemFor("ja").stem("abc") === "abc" && SB.stemFor("fr").ok === false);

  // ------------------------------------------------ H: head term
  const ht = (q, o) => TX.headTerm(q, o).words.join(" ");
  check("H: words are UAX #29 (NFKC, lowercased); an inner apostrophe stays in the word", TX.uaxWords("Don\u2019t Buy ＨＯＵＳＥＳ, Tracy!").join("|") === "don\u2019t|buy|houses|tracy");
  check("H: head term = stemmed words minus stop words minus gazetteer places (longest match)", ht("We buy the houses in Tracy") === "buy hous", ht("We buy the houses in Tracy"));
  check("H: a multi-word place is removed whole (longest match): 'new york' and 'new york city' do not leave 'new'", ht("plumber in new york city") === "plumber" && ht("plumber new york") === "plumber", `${ht("plumber in new york city")} / ${ht("plumber new york")}`);
  check("H: an empty head term falls back to the query's full stemmed word list", (() => { const h = TX.headTerm("in the", { locale: "en-US" }); return h.fallback === true && h.words.join(" ") === "in the"; })());
  check("H: containsHeadTerm: stemmed whole words, all of them (Houses = house; a missing word fails)", TX.containsHeadTerm("We Buy Houses Fast", TX.headTerm("buy house")) === true && TX.containsHeadTerm("We buy cars", TX.headTerm("buy house")) === false && TX.containsHeadTerm("househunting buy", TX.headTerm("buy house")) === false);
  check("H: effective gazetteer: 'home' and 'price' are not places, so 'home price' keeps its head term", ht("home price in Tracy") === "home price", ht("home price in Tracy"));
  check("H: airport-style codes in the file (ABQ) are not places in the effective gazetteer: a query word 'abq' stays in the head term", ht("flights abq") === "flight abq", ht("flights abq"));
  process.env.PEWP_GAZETTEER_LITERAL = "1";
  check("H: ... but they are places in the spec-literal gazetteer", ht("flights abq") === "flight", ht("flights abq"));
  check("H: PEWP_GAZETTEER_LITERAL=1 gives the spec-literal gazetteer, where 'home' and 'price' ARE places (their head term is empty and falls back)", TX.headTerm("home price", { locale: "en-US" }).fallback === true);
  delete process.env.PEWP_GAZETTEER_LITERAL;
  check("H: back to the effective gazetteer after the literal run", TX.headTerm("home price", { locale: "en-US" }).fallback === false);

  // ------------------------------------------------ T: terms (9.5)
  const t1 = TX.termsOf(["Cash offer for the house", "Fast closing"]);
  check("T: terms are the 1- to 3-word n-grams of each unit, stop words removed first", t1.has("cash") && t1.has("cash offer") && t1.has("cash offer house") && !t1.has("the") && !t1.has("cash offer for") && !t1.has("offer house fast") && t1.has("fast closing"), [...t1].join(","));
  const pages3 = [{ headings: ["Cash offer process"], listItems: ["No repairs needed"], strong: ["Close in 7 days"] }, { headings: ["How the cash offer works"], listItems: ["No repairs"], strong: [] }, { headings: ["Our team"], listItems: ["Free quote"], strong: ["no repairs"] }];
  const req = TX.requiredTerms(pages3);
  check("T: a required term is on >= 2 of the 3 winning pages (headings, list items and <strong> all count)", req.includes("cash offer") && req.includes("repairs") && !req.includes("no repairs") && !req.includes("free quote") && !req.includes("team") && req.length === 4, req.join(","));
  check("T: required terms are sorted (pages desc, then code point), so a re-run gives the same list", JSON.stringify(req) === JSON.stringify(TX.requiredTerms(pages3)) && req[0] === "repairs", req.join(","));
  check("T: equal counts are ordered by code point, not by first appearance (zeta alpha -> alpha, zeta, zeta alpha)", TX.requiredTerms([{ headings: ["zeta alpha"] }, { headings: ["zeta alpha"] }]).join(",") === "alpha,zeta,zeta alpha");
  check("T: a page covers a term when it is in the main content as adjacent words (stop words ignored)", TX.coversTerm("We make a cash offer for your house in days.", "cash offer") === true && TX.coversTerm("an offer of cash", "cash offer") === false);

  // ------------------------------------------------ I: intent (9.2)
  const org = (urls, types = []) => urls.map((u, i) => ({ url: u, schemaTypes: types[i] || [] }));
  const dom = (host, n) => Array.from({ length: n }, (_, i) => `https://${host}/p${i}/`);
  const mixed = (n) => org(Array.from({ length: 10 }, (_, i) => `https://s${i}.test/a/`));
  const int = (q, serp, o = {}) => G.intentDetail(q, { serp, ...o });
  check("I rule 1: a local pack in the SERP -> local", int("plumber", { features: ["local_pack"], organic: mixed() }).intent === "local" && int("plumber", { features: ["local_pack"], organic: mixed() }).rule === 1);
  check("I rule 1: a gazetteer place in the query -> local; a local modifier ('near me') -> local", int("pizza tracy").intent === "local" && int("pizza near me").intent === "local" && int("pizza near me").rule === 1);
  check("I rule 2: >= 3 of the top 10 are product or category pages -> transactional", int("wireless headphones", { features: [], organic: org([...dom("a.test", 3), ...dom("b.test", 7)], [["Product"], ["Product"], ["ItemList"]]) }).intent === "transactional");
  check("I rule 2: only 2 product pages is not enough", int("wireless headphones", { features: [], organic: org(dom("b.test", 10).map((u, i) => u.replace("b.test", `b${i}.test`)), [["Product"], ["Product"]]) }).intent === "informational");
  check("I rule 2: shopping results in the SERP -> transactional", int("wireless headphones", { features: ["shopping"], organic: mixed() }).intent === "transactional");
  check("I rule 2: a transactional modifier (buy) -> transactional", int("buy wireless headphones").intent === "transactional");
  check("I rule 3: a commercial modifier (best, vs, review, top, price) -> commercial", ["best crm", "crm a vs crm b", "crm review", "top crm", "crm price"].every((q) => int(q).intent === "commercial"));
  check("I rule 3: >= 3 of the top 10 are comparison or review pages -> commercial", int("crm software", { features: [], organic: org(["https://x1.test/a-vs-b/", "https://x2.test/c-vs-d/", "https://x3.test/e-vs-f/", ...Array.from({ length: 7 }, (_, i) => `https://y${i}.test/`)]) }).intent === "commercial");
  check("I rule 4: >= 5 of the top 10 on one domain -> navigational", int("kestrel homes", { features: [], organic: org([...dom("kestrel.test", 5), ...dom("z.test", 1).map((u, i) => `https://z${i}.test/`), "https://q1.test/", "https://q2.test/", "https://q3.test/", "https://q4.test/"]) }).intent === "navigational");
  check("I rule 4: 4 of 10 on one domain is not enough", int("kestrel homes", { features: [], organic: org([...dom("kestrel.test", 4), ...Array.from({ length: 6 }, (_, i) => `https://q${i}.test/`)]) }).intent === "informational");
  check("I rule 4: a query EQUAL to a directory brand (zillow) or an intake brand -> navigational; merely containing it is not", int("zillow").intent === "navigational" && int("kestrel homes", null, { brands: ["kestrel homes"] }).intent === "navigational" && int("zillow guide").intent === "informational");
  check("I rule 5: otherwise informational", int("what is a cash offer").intent === "informational" && int("what is a cash offer").rule === 5);
  check("I order: rule 1 beats rule 3 ('best pizza near me' is local) and rule 2 beats rule 3 ('buy best shoes' is transactional)", int("best pizza near me").intent === "local" && int("buy best shoes").intent === "transactional");
  check("I: a locale with no intent-modifiers entry is refused, not defaulted", (() => { try { G.intentOf("x", { locale: "xx-XX" }); return false; } catch (e) { return /intent-modifiers/.test(String(e)); } })());
  check("I: extra modifiers (intake) can add a transactional phrase ('sell my house' is informational without it)", int("sell my house fast").intent === "informational" && int("sell my house fast", null, { extraModifiers: { transactional: ["sell my house"] } }).intent === "transactional");

  // ------------------------------------------------ P: page type (9.3)
  const pt = (o) => G.pageTypeOf(o);
  check("P 1: Product or Offer -> product (beats everything below)", pt({ schemaTypes: ["Product", "LocalBusiness"] }) === "product" && pt({ schemaTypes: ["Offer"] }) === "product" && pt({ schemaTypes: ["IndividualProduct"] }) === "product");
  check("P 2: ItemList, or a path ending in a category segment -> category (beats local)", pt({ schemaTypes: ["ItemList", "LocalBusiness"] }) === "category" && pt({ path: "/collections/shoes" }) === "category" && pt({ path: "/product-category/shoes/" }) === "category" && pt({ path: "/collections/shoes/red-shoe" }) === "page");
  check("P 2b: a BreadcrumbList (an ItemList subtype) is navigation, not a listing: an Article with breadcrumbs is an article", pt({ schemaTypes: ["WebPage", "BreadcrumbList", "Article"] }) === "article" && pt({ schemaTypes: ["BreadcrumbList", "Service"] }) === "page" && pt({ schemaTypes: ["BreadcrumbList", "ItemList"] }) === "category");
  check("P 3: LocalBusiness or a subtype -> local", pt({ schemaTypes: ["RealEstateAgent"] }) === "local" && pt({ schemaTypes: ["Dentist"] }) === "local" && pt({ schemaTypes: ["LocalBusiness"] }) === "local");
  check("P 4: Article, BlogPosting, NewsArticle -> article", ["Article", "BlogPosting", "NewsArticle"].every((t) => pt({ schemaTypes: [t] }) === "article"));
  check("P 5: VideoObject counts only as the main entity", pt({ schemaTypes: ["VideoObject"] }) === "video" && pt({ schemaTypes: ["WebPage", "VideoObject"], mainEntityType: "WebPage" }) === "page" && pt({ schemaTypes: ["WebPage", "VideoObject"], mainEntityType: "VideoObject" }) === "video");
  check("P 6: QAPage or a forum host -> forum; P 7: a directory host -> directory (subdomains match)", pt({ schemaTypes: ["QAPage"] }) === "forum" && pt({ host: "www.reddit.com" }) === "forum" && pt({ host: "m.zillow.com" }) === "directory" && pt({ host: "yelp.com" }) === "directory" && pt({ host: "example.com" }) === "page");
  check("P 8: a path segment 'vs' or containing '-vs-', or Review as the main entity -> comparison", pt({ path: "/crm-a-vs-crm-b/" }) === "comparison" && pt({ path: "/vs/hubspot" }) === "comparison" && pt({ schemaTypes: ["Review"] }) === "comparison" && pt({ path: "/canvas/" }) === "page");
  check("P 9: otherwise page; and the order is the spec's (a directory host with Product schema is a product)", pt({}) === "page" && pt({ schemaTypes: ["Product"], host: "zillow.com" }) === "product" && pt({ schemaTypes: ["QAPage"], host: "zillow.com" }) === "forum");
  check("P: pageTypeOfPage reads the JSON-LD @graph of a built page (main entity from WebPage.mainEntity)", G.pageTypeOfPage({ path: "/x/", jsonld: [{ parsed: { "@graph": [{ "@type": "WebPage", mainEntity: { "@type": "VideoObject" } }, { "@type": "VideoObject" }] } }] }) === "video" && G.pageTypeOfPage({ path: "/x/", jsonld: [{ parsed: { "@type": "RealEstateAgent" } }] }) === "local");

  // ------------------------------------------------ K: intent -> compatible types (03 section 22.2)
  const K = { informational: ["article", "page", "video", "comparison"], commercial: ["comparison", "article", "category", "page"], transactional: ["product", "category", "local"], local: ["local", "page", "category"], navigational: ["page", "home"] };
  check("K: the 03 section 22.2 table, every intent", Object.entries(K).every(([i, t]) => JSON.stringify(G.compatibleTypes(i)) === JSON.stringify(t)), JSON.stringify(Object.keys(K).map((i) => G.compatibleTypes(i))));
  check("K: a transactional cluster also accepts a plain page when the brief has a cta", !G.isCompatible("transactional", "page") && G.isCompatible("transactional", "page", { cta: true }) && !G.isCompatible("informational", "product") && !G.isCompatible("informational", "category"));

  // ------------------------------------------------ C: clusters (9.1)
  const U = (n, p = "u") => Array.from({ length: n }, (_, i) => `https://${p}${i}.test/page`);
  const mk = (query, volume, top10, difficulty = null) => ({ query, volume, difficulty, top10 });
  const headOf = (q) => TX.headTerm(q, { locale: "en-US" }).words.slice().sort().join(" ");
  const cl = (rows, o = {}) => G.clusterByOverlap(rows, { overlap: 4, headOf, ...o });
  const shared = (a, b, n) => [...a.slice(0, n), ...b];
  const A = U(10, "a"), Bx = U(10, "b");
  let r = cl([mk("alpha", 100, A), mk("beta", 90, shared(A, U(6, "x"), 4)), mk("gamma", 80, U(10, "g"))]);
  check("C: 4 shared results link two queries (clusterOverlap 4); 3 do not", r.length === 2 && r[0].members.length === 2 && cl([mk("alpha", 100, A), mk("beta", 90, shared(A, U(7, "x"), 3))]).length === 2, JSON.stringify(r.map((c) => c.members.map((m) => m.query))));
  const chain = cl([mk("q1", 100, [...U(4, "p"), ...U(6, "r")]), mk("q2", 90, [...U(4, "p"), ...U(4, "s"), ...U(2, "t")]), mk("q3", 80, [...U(4, "s"), ...U(6, "w")])]);
  check("C: clusters are connected components (q1-q2 and q2-q3 linked, q1-q3 not: ONE cluster), the chaining the old version guarded against", chain.length === 1 && chain[0].members.length === 3, JSON.stringify(chain.map((c) => c.members.map((m) => m.query))));
  check("C: results are compared after URL normalisation (www, query, fragment, trailing slash)", cl([mk("n1", 10, ["https://www.Site.test/a/", "https://site.test/b?x=1", "https://site.test/c#top", "https://site.test/d/", ...U(6, "o")]), mk("n2", 9, ["https://site.test/a", "https://www.site.test/b", "https://site.test/c", "https://site.test/d", ...U(6, "q")])]).length === 1);
  check("C: primary = highest volume; ties -> lower difficulty, then code point", cl([mk("zebra", 50, A, 40), mk("apple", 50, shared(A, U(6, "x"), 4), 40), mk("mango", 50, shared(A, U(6, "y"), 4), 20)])[0].primary === "mango" && cl([mk("zebra", 50, A, 40), mk("apple", 50, shared(A, U(6, "x"), 4), 40)])[0].primary === "apple" && cl([mk("big", 500, shared(A, U(6, "x"), 4)), mk("small", 5, A)])[0].primary === "big");
  const noserp = cl([mk("we buy houses", 100, A), mk("buy houses", 5, null), mk("sell cars", 7, null)]);
  check("C: a query without SERP data joins the captured query with the same head term; else it is a cluster of one marked serp:false", noserp.length === 2 && noserp[0].members.length === 2 && noserp[0].members[1].via === "head-term" && noserp[1].serp === false && noserp[1].members[0].serp === false, JSON.stringify(noserp));
  check("C: two queries without SERP and the same head term do NOT join each other (only a captured query is joined)", cl([mk("buy houses", 5, null), mk("we buy houses", 4, null)]).length === 2);
  const ord = cl([mk("b", 10, A), mk("a", 10, shared(A, U(6, "x"), 4)), mk("c", 10, U(10, "c"))]);
  check("C: equal volume is ordered by code point, so the run is deterministic", ord.map((c) => c.primary).join() === "a,c", ord.map((c) => c.primary).join());
  check("C: the same input in another row order gives the same clusters", JSON.stringify(cl([mk("gamma", 80, U(10, "g")), mk("beta", 90, shared(A, U(6, "x"), 4)), mk("alpha", 100, A)])) === JSON.stringify(cl([mk("alpha", 100, A), mk("beta", 90, shared(A, U(6, "x"), 4)), mk("gamma", 80, U(10, "g"))])));

  // ------------------------------------------------ M: page-cluster match (9.7)
  const pg = (p, title, h1, type) => ({ path: p, title, h1: [h1], pageType: type });
  const cluster = { primaryQuery: "we buy houses", intent: "transactional" };
  const m1 = G.matchPages(cluster, [pg("/a/", "We Buy Houses", "x", "local"), pg("/b/", "Cars", "y", "local")]);
  check("M: a page matches when its title OR h1 contains the primary query's head term and its type fits the intent", m1.match?.path === "/a/" && G.matchPages(cluster, [pg("/c/", "Cars", "We buy houses fast", "product")]).match?.path === "/c/");
  check("M: a page of an incompatible type does not match (an article for a transactional cluster)", G.matchPages(cluster, [pg("/a/", "We buy houses", "x", "article")]).match === null);
  check("M: several matches -> the one with the most Search Console clicks, the others are cannibalisation candidates", (() => { const r = G.matchPages(cluster, [pg("/short/", "We buy houses", "x", "local"), pg("/a-longer-path/", "We buy houses", "x", "local")], { clicks: (p) => (p.path === "/a-longer-path/" ? 9 : 0) }); return r.match.path === "/a-longer-path/" && r.others.map((p) => p.path).join() === "/short/"; })());
  check("M: no clicks anywhere -> the shortest URL path wins", G.matchPages(cluster, [pg("/long/path/here/", "We buy houses", "x", "local"), pg("/s/", "We buy houses", "x", "local")]).match.path === "/s/");
  check("M: a page for another place is not a match (skill choice, recorded): 'realtor in manteca' does not take the Tracy page", G.matchPages({ primaryQuery: "realtor manteca", intent: "local" }, [pg("/", "Realtor in Tracy", "Realtor in Tracy", "local")]).match === null && G.matchPages({ primaryQuery: "realtor manteca", intent: "local" }, [pg("/m/", "Realtor in Manteca", "x", "local")]).match?.path === "/m/");
  check("M: carriesQuery = head term OR one of the cluster's queries as whole words (TGT-004)", G.carriesQuery("Sell your house fast", { primaryQuery: "we buy houses", queries: ["sell house fast"] }) === false && G.carriesQuery("Quick sell house fast guide", { primaryQuery: "we buy houses", queries: ["sell house fast"] }) === true && G.carriesQuery("We buy houses", { primaryQuery: "we buy houses", queries: [] }) === true);
  await editorial();
}

// ------------------------------------------------ E: the editorial-media industry pack (rules/industries/editorial-media.json + rules/link-sources/editorial-media.json)
// The gate checks run the real GT-010 code (gate-industry.mjs) on small built sites written to a temp folder; every assertion has a mutant below.
async function editorial() {
  const GI = await imp("gate-industry.mjs"), LS = await imp("lib-site.mjs"), LP = await imp("lib-plan.mjs"), RS = await imp("research-seeds.mjs"), AL = await imp("authority-lib.mjs");
  const IND = path.join(RULES, "industries"), PACKFILE = path.join(IND, "editorial-media.json");
  const pack = J(PACKFILE), items = pack.items, pt = pack.pageTypes, itemIds = new Set(items.map((i) => i.id));
  const KNOWN = new Set(["licence-on-every-page", "business-text-on-every-page", "forbidden-phrases", "required-pages", "required-when-present", "forbidden-schema"]);
  const problems = (p) => { // the same item schema test-plan-gate.mjs applies to every pack
    const out = [], ids = new Set(), rx = (s, w) => { try { new RegExp(s, "i"); } catch (e) { out.push(`${w}: ${e.message}`); } };
    for (const k of ["slug", "title", "jurisdiction", "notes"]) if (typeof p[k] !== "string" || !p[k].trim()) out.push(`pack.${k} missing`);
    if (!Array.isArray(p.sources) || !p.sources.length) out.push("pack.sources missing");
    for (const it of p.items || []) {
      const w = it.id || "(no id)";
      if (!/^[A-Z]{2,3}(?:-[A-Z0-9]+)+-\d{3}$/.test(it.id || "")) out.push(`${w}: bad id`);
      if (ids.has(it.id)) out.push(`${w}: duplicate id`); ids.add(it.id);
      if (!KNOWN.has(it.type)) out.push(`${w}: unknown type ${it.type}`);
      if (!["fail", "warn"].includes(it.severity)) out.push(`${w}: severity`);
      if (typeof it.description !== "string" || it.description.length < 15) out.push(`${w}: description`);
      if (typeof it.source !== "string" || it.source.length < 20) out.push(`${w}: source`);
      if (it.type === "forbidden-phrases") { if (!Array.isArray(it.patterns) || !it.patterns.length) out.push(`${w}: patterns`); else it.patterns.forEach((x) => rx(x, w)); }
      if (it.type === "required-pages" && !(Array.isArray(it.anyOf) && it.anyOf.length && it.anyOf.every((g) => Array.isArray(g) && g.length && g.every((x) => /^\/.*\/$/.test(x))))) out.push(`${w}: anyOf`);
      if (it.type === "forbidden-schema" && !(Array.isArray(it.types) && it.types.length && it.types.every((t) => /^[A-Z][A-Za-z]+$/.test(t)))) out.push(`${w}: types`);
      if (it.type === "required-when-present") {
        if (!Array.isArray(it.require) || !it.require.length) out.push(`${w}: require`); else for (const r of it.require) { if (!r.label || !r.pattern) out.push(`${w}: require entry`); else rx(r.pattern, w); }
        if (it.trigger) rx(it.trigger, w);
        if (it.pathPattern) rx(it.pathPattern, w);
        if (it.nearChars !== undefined && !(Number.isInteger(it.nearChars) && it.nearChars > 0 && it.trigger)) out.push(`${w}: nearChars needs a trigger and a positive integer`);
        if (!it.trigger && !it.pageHasForm && !it.pathPattern) out.push(`${w}: applies to every page without saying so`);
      }
    }
    return out;
  };
  check("E: editorial-media.json validates against the item schema every pack must meet (known types, id format, severity, description, source, compiling regexes, nothing that silently applies to every page)", problems(pack).length === 0, problems(pack).join("; "));
  const loaded = LP.loadIndustry("editorial-media", IND);
  check("E: the pack loads through loadIndustry and is named editorial-media with 15+ items, 14+ page types and 30+ seed queries", loaded.slug === "editorial-media" && loaded.items.length >= 15 && loaded.pageTypes.length >= 14 && loaded.seeds.queries.length >= 30, `${loaded.slug} ${loaded.items.length} ${loaded.pageTypes.length} ${loaded.seeds.queries.length}`);
  const schemaOf = (id) => pt.find((t) => t.id === id)?.schema || [];
  const has = (id, ...types) => types.every((t) => schemaOf(id).includes(t));
  check("E: the page types competitors use are all there with the schema each needs: feature Article, news NewsArticle, roundup CollectionPage+ItemList, house-of-the-day Article, market-guide Article, style and architect landing CollectionPage, newsletter-issue Article, author ProfilePage+Person, submit-a-listing WebPage, pricing WebPage+Offer",
    has("feature", "Article") && has("news", "NewsArticle") && has("roundup", "CollectionPage", "ItemList") && has("house-of-the-day", "Article") && has("market-guide", "Article") && has("style-landing", "CollectionPage") && has("architect-landing", "CollectionPage") && has("newsletter-issue", "Article") && has("author", "ProfilePage", "Person") && has("submit-a-listing", "WebPage") && has("pricing", "WebPage", "Offer"), pt.map((t) => `${t.id}:${t.schema}`).join(" "));
  check("E: every collection page type (roundup, style, architect, city, hub) plans an ItemList of its own next to CollectionPage, so an empty or missing list is a missing planned type", ["roundup", "style-landing", "architect-landing", "city-landing", "hub"].every((id) => has(id, "CollectionPage", "ItemList")), pt.map((t) => `${t.id}:${t.schema}`).join(" "));
  check("E: news plans Article as well as NewsArticle (GT-008 only checks the required fields of the planned type name Article)", has("news", "NewsArticle", "Article"));
  const kinds = pt.map((t) => t.plannerKind).filter(Boolean), PLANNER = new Set(["home", "money", "city-landing", "guide", "hub"]);
  check("E: every plannerKind is one plan-site.mjs makes (home, money, city-landing, guide, hub), no kind is claimed twice, and every `requires` names an item of the pack", kinds.every((k) => PLANNER.has(k)) && new Set(kinds).size === kinds.length && pt.every((t) => t.requires.every((r) => itemIds.has(r))), `${kinds} ${pt.flatMap((t) => t.requires.filter((r) => !itemIds.has(r)))}`);
  check("E: a publisher plan never asks for RealEstateAgent, RealEstateListing, Product or Review schema", pt.every((t) => t.schema.length && !t.schema.some((s) => ["RealEstateAgent", "RealEstateListing", "Product", "AggregateOffer", "Review", "AggregateRating"].includes(s))), JSON.stringify(pt.map((t) => t.schema)));
  const legalNeedle = /Business and Professions Code|Fair Housing Act|Civil Code|Bus\. & Prof|Native Advertising|TCPA|Deceptively Formatted/;
  const legal = items.filter((i) => legalNeedle.test(i.source)), legalSrc = pack.sources.filter((s) => legalNeedle.test(s));
  check("E: every item or source that cites a statute section or an FTC/HUD document from memory says UNVERIFIED (nothing legal is presented as confirmed)", legal.length >= 8 && legal.every((i) => /UNVERIFIED/.test(i.source)) && legalSrc.every((s) => /UNVERIFIED/.test(s)) && /UNVERIFIED/.test(pack.sources.at(-1)), legal.filter((i) => !/UNVERIFIED/.test(i.source)).map((i) => i.id).join());
  check("E: the pack says plainly what no item can enforce (an empty ItemList, JSON-LD author and dates, roundup links), so no reader thinks they are gated", /NOT ENFORCED/.test(pack.notes) && /numberOfItems 0/.test(pack.notes) && /linking each featured property page/.test(pack.notes), pack.notes.slice(0, 80));
  check("E: every item gives a why in plain words (the source or description says why the rule exists)", items.every((i) => /\bWhy:/.test(i.source) || /^EDM-(?:PLACEHOLDER|SCHEMA-002|FH|FREE|FORM|DISC)/.test(i.id)) && items.filter((i) => /\bWhy:/.test(i.source)).length >= 12, items.filter((i) => !/\bWhy:/.test(i.source)).map((i) => i.id).join());
  check("E: the pack names no client, business or person (it is for any editorial media platform)", !/\b(?:matter of place|matterofplace|omnikom|francine|elibuyshomes|valley to valley|abdo)\b/i.test(fs.readFileSync(PACKFILE, "utf8")));
  const Q = pack.seeds.queries, ok = (q) => q.query && q.productLine && ["informational", "commercial", "transactional", "local"].includes(q.intent) && ["national", "local"].includes(q.scope);
  check("E: every seed query has a product line, an intent and a scope; {city} appears only in local queries and every local query without {city} is a plain 'near me' style; no volume or rank field", Q.every(ok) && Q.every((q) => (q.scope === "local") === /\{city\}/.test(q.query)) && Q.every((q) => !("volume" in q) && !("rank" in q)) && new Set(Q.map((q) => q.query)).size === Q.length, Q.filter((q) => !ok(q) || (q.scope === "local") !== /\{city\}/.test(q.query)).map((q) => q.query).join());
  const want = ["historic homes for sale", "architect designed homes for sale", "mid century modern homes for sale {city}", "houses with history", "unique homes for sale", "old houses for sale", "modern houses for sale", "luxury real estate news", "homes for sale on the market this week", "sponsored listing real estate media", "feature my listing", "how to get a home featured in"];
  check("E: the seed queries include the editorial searches the brief names (historic, architect designed, mid century {city}, houses with history, unique, old, modern, luxury news, on the market this week, sponsored listing, how to get a home featured in, feature my listing)", want.every((w) => Q.some((q) => q.query === w || q.query.startsWith(w + " "))), want.filter((w) => !Q.some((q) => q.query === w || q.query.startsWith(w + " "))).join(" | "));
  const ps = RS.packSeeds("editorial-media", IND);
  check("E: research-seeds.mjs --industry editorial-media reads every seed query of the pack and names the pack as the source", ps.length === Q.length && ps.every((x) => /industry pack editorial-media: /.test(x.source)), `${ps.length}/${Q.length}`);

  // ---- the gate on built sites
  const eHtml = (title, body, head = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body><header><nav><a href="/">Sample Journal</a></nav></header><main><h1>${title}</h1>${body}</main><footer><p>Sample Journal, 2026.</p></footer></body></html>`;
  const ld = (o) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", ...o })}</script>`;
  const BYL = "By Jane Doe | Published October 24, 2026 | Updated October 25, 2026";
  const LABEL = "SPONSORED LISTING. Listing agent: Alex Sample, Sample Realty.";
  const STANDARD = 'Payment does not buy acceptance; see our <a href="/editorial-standard/">editorial standard</a>.';
  const AS_OF = "Prices and availability are as of October 24, 2026 and may change.";
  const art = { "@type": "Article", headline: "A stone house", author: { "@type": "Person", name: "Jane Doe" }, datePublished: "2026-10-24", dateModified: "2026-10-25" };
  const base = {
    "index.html": eHtml("Sample Journal", "<p>Stories about notable houses and the people who made them.</p>", ld({ "@graph": [{ "@type": ["NewsMediaOrganization", "Organization"], name: "Sample Journal", url: "https://example.test/", logo: "https://example.test/logo.png" }, { "@type": "WebSite", name: "Sample Journal", url: "https://example.test/" }] })),
    "stories/stone-house/index.html": eHtml("A stone house in the hills", `<p>${BYL}</p><p>${LABEL}</p><p>A stone house on two acres with a restored barn.</p><p>${STANDARD}</p><p><a href="/on-the-market/2026-10-24/">More homes in this week's roundup</a></p>`, ld(art)),
    "on-the-market/index.html": eHtml("On the Market", `<p>Weekly roundups of notable homes. ${AS_OF}</p><ul><li><a href="/on-the-market/2026-10-24/">October 24, 2026</a></li></ul>`, ld({ "@graph": [{ "@type": "CollectionPage", name: "On the Market" }, { "@type": "ItemList", numberOfItems: 1, itemListElement: [{ "@type": "ListItem", position: 1, url: "https://example.test/on-the-market/2026-10-24/" }] }] })),
    "on-the-market/2026-10-24/index.html": eHtml("On the Market, October 24", `<p>${BYL}</p><p>${AS_OF}</p><h2>A stone house in the hills</h2><p>${LABEL}</p><h2>A shingle-style cottage</h2><p>Selected by our editors; no payment was made. Listing agent: Sam Example, Example Homes.</p><p>${STANDARD}</p><ul><li><a href="/stories/stone-house/">A stone house in the hills</a></li></ul>`, ld({ "@graph": [{ "@type": "CollectionPage", name: "On the Market, October 24" }, { "@type": "ItemList", numberOfItems: 2, itemListElement: [{ "@type": "ListItem", position: 1, url: "https://example.test/stories/stone-house/" }, { "@type": "ListItem", position: 2, url: "https://example.test/stories/cottage/" }] }] })),
    "submit-a-listing/index.html": eHtml("Submit a listing", '<p>Sample Journal is an independent publisher. It is not a brokerage and does not represent anyone in a sale.</p><p>The Feature is $295. Submission is free, and review comes before payment.</p><form action="/thanks/" method="post"><label>Email <input name="e"></label><button>Send</button></form><p>By submitting this form you agree to be contacted by email about your property. See our <a href="/privacy/">privacy policy</a>.</p>'),
    "editorial-standard/index.html": eHtml("Editorial standard", "<p>Payment does not buy acceptance. Editors choose what runs.</p>"),
    "privacy/index.html": eHtml("Privacy policy", "<p>How we handle what you send us.</p>"),
    "accessibility/index.html": eHtml("Accessibility", "<p>How to reach us about access.</p>"),
    "authors/jane-doe/index.html": eHtml("Jane Doe", "<p>Jane Doe writes about houses.</p>", ld({ "@type": "ProfilePage", mainEntity: { "@type": "Person", name: "Jane Doe" } })),
  };
  const SF = "stories/stone-house/index.html", RU = "on-the-market/2026-10-24/index.html", HUB = "on-the-market/index.html", SUB = "submit-a-listing/index.html";
  const runE = (edit = {}, o = {}) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-edm-"));
    try {
      const files = { ...base }; for (const [k, v] of Object.entries(edit)) { if (v === null) delete files[k]; else files[k] = typeof v === "function" ? v(files[k]) : v; }
      for (const [k, v] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, k)), { recursive: true }); fs.writeFileSync(path.join(dir, k), v); }
      const site = LS.loadSite(dir);
      return GI.run({ rules: o.rules || pack, business: o.business || { name: "Sample Journal" }, site, indexable: (p) => !p.noindex, waive: new Set(o.waive || []), strict: !!o.strict, noindexNote: [] });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  const L = (r) => (r.details || []).join("\n");
  const hit = (r, lvl, id, p = "") => new RegExp(`^${lvl} ${id} ${p.replace(/\//g, "\\/")}`, "m").test(L(r));
  const swap = (a, b) => (h) => { if (!h.includes(a)) throw new Error(`fixture text not found: ${a}`); return h.replace(a, b); };
  const add = (html) => (h) => h.replace("</main>", `${html}</main>`);
  const bad = (name, r, id, p, lvl = "FAIL") => check(name, r.status === "FAIL" && hit(r, lvl, id, p), `${r.status} ${r.summary}\n${L(r).slice(0, 400)}`);

  const clean = runE(), cleanStrict = runE({}, { strict: true });
  check("E: a clean editorial site PASSes, with no FAIL or WARN line, also under --strict (nine pages: home, feature, roundup issue and index, submit page, standard, privacy, accessibility, author)", clean.status === "PASS" && cleanStrict.status === "PASS" && !/^(?:FAIL|WARN|ERROR)/m.test(L(cleanStrict)) && new RegExp(`^${items.length} industry rule item`).test(cleanStrict.summary), `${cleanStrict.status} ${cleanStrict.summary}\n${L(cleanStrict).slice(0, 500)}`);
  check("E: a labelled sponsored listing PASSes (the 'SPONSORED LISTING' label sits by the agent credit), and so does an unpaid pick that says it was chosen by the editors", !hit(clean, "FAIL", "EDM-SPON-001") && !/EDM-SPON-001/.test(L(clean)) && !/EDM-SPON-001/.test(L(runE({ [SF]: swap(LABEL, "Selected by our editors; no payment was made. Listing agent: Alex Sample, Sample Realty.") }))));
  bad("E: a listing credit with no paid-or-not label FAILs (EDM-SPON-001)", runE({ [SF]: swap("SPONSORED LISTING. ", "") }), "EDM-SPON-001", "/stories/stone-house/");
  bad("E: a Sponsored label more than 2500 characters from the agent credit does not count (nearChars)", runE({ [SF]: swap(LABEL, `Listing agent: Alex Sample, Sample Realty.</p><p>${"The barn was restored in 1998. ".repeat(110)}</p><p>SPONSORED`) }), "EDM-SPON-001", "/stories/stone-house/");
  bad("E: a sponsored page that never says payment does not buy acceptance is flagged (EDM-SPON-002, FAIL under --strict)", runE({ [SF]: swap(`<p>${STANDARD}</p>`, "") }, { strict: true }), "EDM-SPON-002", "/stories/stone-house/");
  bad("E: an article with no named author FAILs (EDM-BYLINE-001)", runE({ [SF]: swap("By Jane Doe | ", "") }), "EDM-BYLINE-001", "/stories/stone-house/");
  bad("E: an article with no publication date FAILs (EDM-DATE-001)", runE({ [SF]: swap("Published October 24, 2026", "") }), "EDM-DATE-001", "/stories/stone-house/");
  bad("E: an article with no last-updated date FAILs (EDM-DATE-002)", runE({ [SF]: swap(" | Updated October 25, 2026", "") }), "EDM-DATE-002", "/stories/stone-house/");
  const scoped = runE({ [SF]: swap("By Jane Doe | ", "") });
  const flaggedPaths = [...L(scoped).matchAll(/^(?:FAIL|WARN) EDM-(?:BYLINE|DATE)-00\d (\S+)/gm)].map((m) => m[1]);
  check("E: only article pages are asked for a byline and dates (the home page, the author page, the submit page, the roundup index and a dated roundup issue that has them are not flagged)", flaggedPaths.length >= 1 && flaggedPaths.every((p) => p === "/stories/stone-house/"), flaggedPaths.join());
  bad("E: 'guaranteed exposure' FAILs (EDM-OUTCOME-001)", runE({ [SF]: add("<p>Your property gets guaranteed exposure to buyers.</p>") }), "EDM-OUTCOME-001", "/stories/stone-house/");
  bad("E: 'sells in days' FAILs (EDM-OUTCOME-001)", runE({ [SF]: add("<p>This is a house that sells in days.</p>") }), "EDM-OUTCOME-001", "/stories/stone-house/");
  bad("E: 'we will sell your home' FAILs (EDM-OUTCOME-001)", runE({ [SF]: add("<p>We will sell your home.</p>") }), "EDM-OUTCOME-001", "/stories/stone-house/");
  bad("E: 'your home will sell' FAILs (EDM-OUTCOME-001)", runE({ [SF]: add("<p>With this feature your home will sell.</p>") }), "EDM-OUTCOME-001", "/stories/stone-house/");
  bad("E: 'we guarantee a sale' FAILs (EDM-OUTCOME-001)", runE({ [SF]: add("<p>We guarantee a sale with every feature.</p>") }), "EDM-OUTCOME-001", "/stories/stone-house/");
  const honest = runE({ [SF]: add("<p>We do not guarantee buyers or a sale. There is no guaranteed exposure, and nobody can promise results.</p>") });
  check("E: an honest disclaimer ('we do not guarantee buyers or a sale', 'no guaranteed exposure') is not flagged as a promise", !/EDM-OUTCOME-001/.test(L(honest)) && honest.status === "PASS", L(honest));
  const lic = { name: "Sample Journal", credentials: { licensed: true, licenseNumber: "01234567" } };
  bad("E: RealEstateAgent schema on the publisher's page FAILs without credentials (EDM-SCHEMA-001)", runE({ [SF]: swap("</head>", `${ld({ "@type": "RealEstateAgent", name: "Sample Journal" })}</head>`) }), "EDM-SCHEMA-001", "/stories/stone-house/");
  bad("E: RealEstateListing schema inside an @graph on the publisher's page FAILs (EDM-SCHEMA-001)", runE({ [SF]: swap("</head>", `${ld({ "@graph": [{ "@type": "WebPage" }, { "@type": "RealEstateListing", name: "A stone house" }] })}</head>`) }), "EDM-SCHEMA-001", "/stories/stone-house/");
  const asLicensed = runE({ [SF]: swap("</head>", `${ld({ "@type": "RealEstateAgent", name: "Sample Journal" })}</head>`) }, { business: lic });
  check("E: with credentials.licensed = true the RealEstateAgent item is skipped and says so (NOTE ... not applicable)", asLicensed.status === "PASS" && /NOTE EDM-SCHEMA-001 not applicable/.test(L(asLicensed)), L(asLicensed));
  bad("E: 'we represent buyers and sellers' FAILs without credentials (EDM-BROKER-001)", runE({ [SF]: add("<p>We represent buyers and sellers.</p>") }), "EDM-BROKER-001", "/stories/stone-house/");
  bad("E: 'ask our agents' FAILs without credentials (EDM-BROKER-001)", runE({ [SF]: add("<p>Ask our agents about this house.</p>") }), "EDM-BROKER-001", "/stories/stone-house/");
  const asBroker = runE({ [SF]: add("<p>We represent buyers and sellers. Ask our agents.</p>") }, { business: lic });
  check("E: a licensed business (credentials.licensed) may say it represents clients; crediting someone else's listing agent and 'we are not a brokerage' never trip the rule", asBroker.status === "PASS" && /NOTE EDM-BROKER-001 not applicable/.test(L(asBroker)) && !/EDM-BROKER-001/.test(L(runE({ [SF]: add("<p>We are not a brokerage and we do not represent anyone in a sale.</p>") })).replace(/NOTE.*/g, "")), L(asBroker));
  bad("E: a submit page that does not say the publisher is not a brokerage is flagged (EDM-ROLE-001, FAIL under --strict)", runE({ [SUB]: swap("Sample Journal is an independent publisher. It is not a brokerage and does not represent anyone in a sale.", "Send us your house.") }, { strict: true }), "EDM-ROLE-001", "/submit-a-listing/");
  const emptyPage = runE({ [HUB]: add("<p>No stories yet. Check back soon.</p>") });
  check("E: an indexable page that says 'no stories yet' is a WARN (EDM-EMPTY-001) now and a FAIL under --strict", emptyPage.status === "PASS" && hit(emptyPage, "WARN", "EDM-EMPTY-001", "/on-the-market/") && hit(runE({ [HUB]: add("<p>No stories yet.</p>") }, { strict: true }), "FAIL", "EDM-EMPTY-001", "/on-the-market/"), L(emptyPage));
  const noidx = runE({ [HUB]: (h) => add("<p>No stories yet. Check back soon.</p>")(h.replace("</head>", '<meta name="robots" content="noindex"></head>')) });
  check("E: the same empty collection page kept noindex is not judged (an empty page stays out of the index until it lists something)", noidx.status === "PASS" && !/EDM-EMPTY-001 \/on-the-market\//.test(L(noidx)), L(noidx));
  bad("E: fair-housing steering ('perfect for young professionals') FAILs (EDM-FH-001)", runE({ [SF]: add("<p>Perfect for young professionals.</p>") }), "EDM-FH-001", "/stories/stone-house/");
  bad("E: a roundup with no 'prices and availability as of' line is flagged (EDM-ROUNDUP-001, FAIL under --strict)", runE({ [RU]: swap(`<p>${AS_OF}</p>`, "") }, { strict: true }), "EDM-ROUNDUP-001", "/on-the-market/2026-10-24/");
  bad("E: 'free feature' for a paid feature is flagged (EDM-FREE-001, FAIL under --strict), while 'submission is free' passes", runE({ [SUB]: add("<p>Get a free feature today.</p>") }, { strict: true }), "EDM-FREE-001", "/submit-a-listing/");
  bad("E: an unsubstantiated reach claim ('reaching 2 million affluent buyers') is flagged (EDM-CLAIM-001, FAIL under --strict)", runE({ [SUB]: add("<p>Reaching 2 million affluent buyers every week.</p>") }, { strict: true }), "EDM-CLAIM-001", "/submit-a-listing/");
  bad("E: a form page with no privacy-policy mention is flagged (EDM-FORM-001, FAIL under --strict)", runE({ [SUB]: swap(" See our <a href=\"/privacy/\">privacy policy</a>.", "") }, { strict: true }), "EDM-FORM-001", "/submit-a-listing/");
  bad("E: a site with no editorial standard page is flagged (EDM-DISC-001, FAIL under --strict)", runE({ "editorial-standard/index.html": null }, { strict: true }), "EDM-DISC-001", "none of /editorial-standard/");
  bad("E: an unfilled {{PLACEHOLDER}} on a page FAILs (EDM-PLACEHOLDER-001)", runE({ [SF]: add("<p>Asking {{PRICE}}.</p>") }), "EDM-PLACEHOLDER-001", "/stories/stone-house/");
  bad("E: Review or AggregateRating markup is flagged (EDM-SCHEMA-002, FAIL under --strict)", runE({ [SF]: swap("</head>", `${ld({ "@type": "AggregateRating", ratingValue: 5, reviewCount: 1 })}</head>`) }, { strict: true }), "EDM-SCHEMA-002", "/stories/stone-house/");

  // ---- the link-sources pack (authority lane)
  const lr = AL.loadRules(path.join(RULES, "link-sources")), picks = (b) => AL.pickPack(lr, b).pack.slug;
  check("E: the link-source pack editorial-media is picked by slug and by the alias real-estate-media, and has the fields the authority lane needs (UNVERIFIED basis, 3+ angles, 2+ things to avoid, hosts clean with a cost, types in the taxonomy)",
    picks({ industry: "editorial-media" }) === "editorial-media" && picks({ industry: "real-estate-media" }) === "editorial-media" && picks({ kind: "editorial-media" }) === "editorial-media" && (() => { const p = lr.packs.get("editorial-media"); return !!p && /UNVERIFIED/.test(p.basis) && p.angles.length >= 3 && p.avoid.length >= 2 && Array.isArray(p.providerPatterns) && Array.isArray(p.providerText) && p.domainTypes.every((e) => e.host === e.host.toLowerCase() && !/^www\.|\//.test(e.host) && e.cost && lr.tax.types[e.type]) && p.patterns.every((e) => lr.tax.types[e.type] && new RegExp(e.re, "i")); })(), `${picks({ industry: "real-estate-media" })}`);
  const mp = AL.mergedPack(lr, lr.packs.get("editorial-media")), cls = (d) => AL.classifyDomain(d, { rules: lr, pack: mp, target: "example.test", competitors: [] }).type;
  check("E: the link-source pack names a design-press host as editorial-list, a preservation group as professional-association, a local news host as local-news and a brokerage-looking domain as a partner", cls("dezeen.com") === "editorial-list" && cls("docomomo-us.org") === "professional-association" && cls("patch.com") === "local-news" && cls("harborrealty.com") === "partner-supplier", [cls("dezeen.com"), cls("docomomo-us.org"), cls("patch.com"), cls("harborrealty.com")].join());
  const aliases = lr.packs.get("editorial-media").aliases.map(AL.norm), others = [...lr.packs.values()].filter((p) => p.slug !== "editorial-media").flatMap((p) => [p.slug, ...p.aliases].map(AL.norm));
  check("E: no alias of the link-source pack belongs to another pack", aliases.every((a) => !others.includes(a)), aliases.filter((a) => others.includes(a)).join());
}

const mutants = [
  // [file, from, to, name of the check that must go red (substring), why]
  ["lib-snowball.mjs", 'const LI_END = new Set("cdeghkmnrt");', 'const LI_END = new Set("cdeghkmnr");', "S: Snowball English stemmer", "li-ending t dropped"],
  ["lib-snowball.mjs", "if (inR1(s)) cut(s.length, \"ee\");", "cut(s.length, \"ee\");", "S: Snowball English stemmer", "step 1b eed ignores R1"],
  ["lib-text.mjs", "for (let n = Math.min(gaz.max, wordList.length - i); n >= 1; n--)", "for (let n = 1; n <= Math.min(gaz.max, wordList.length - i); n++)", "H: a multi-word place is removed whole", "shortest place match instead of longest"],
  ["lib-text.mjs", "const words = noPlaces.filter((w) => !stop.has(w)).map(stem);", "const words = noPlaces.map(stem);", "H: head term = stemmed words minus stop words", "stop words kept in the head term"],
  ["lib-text.mjs", "if (words.length) return { words: [...new Set(words)], fallback: false };", "if (words.length) return { words: [...new Set(words)].slice(0, 1), fallback: false };", "H: head term = stemmed words minus stop words", "head term cut to one word"],
  ["lib-text.mjs", "return head.words.every((w) => have.has(w));", "return head.words.some((w) => have.has(w));", "H: containsHeadTerm", "any word instead of all words"],
  ["lib-text.mjs", "if (!literal && /^[A-Z]{2,4}$/.test(name)) continue;", "", "H: airport-style codes in the file", "airport-style codes stay places"],
  ["lib-text.mjs", "for (let n = 1; n <= 3; n++) for (let i = 0; i + n <= w.length; i++)", "for (let n = 1; n <= 2; n++) for (let i = 0; i + n <= w.length; i++)", "T: terms are the 1- to 3-word n-grams", "trigrams dropped"],
  ["lib-text.mjs", "filter(([, n]) => n >= minPages)", "filter(([, n]) => n >= 1)", "T: a required term is on >= 2", "one page is enough for a required term"],
  ["lib-text.mjs", "(a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)", "0", "T: equal counts are ordered by code point", "no code-point tie order"],
  ["lib-growth.mjs", 'if (rankFeature(serp?.features, "local_pack", "localpack")) return', 'if (false) return', "I rule 1: a local pack", "local pack ignored"],
  ["lib-growth.mjs", 'if (count("product", "category") >= 3)', 'if (count("product", "category") >= 2)', "I rule 2: only 2 product pages", "threshold 3 -> 2"],
  ["lib-growth.mjs", 'if (rankFeature(serp?.features, "shopping"))', 'if (false)', "I rule 2: shopping results", "shopping results ignored"],
  ["lib-growth.mjs", "if (mods.transactional) return", "if (false) return", "I rule 2: a transactional modifier", "transactional modifier ignored"],
  ["lib-growth.mjs", "if (mods.commercial) return", "if (false) return", "I rule 3: a commercial modifier", "commercial modifier ignored"],
  ["lib-growth.mjs", 'if (count("comparison") >= 3)', 'if (count("comparison") >= 4)', "I rule 3: >= 3 of the top 10 are comparison", "comparison threshold 3 -> 4"],
  ["lib-growth.mjs", "if (maxHost && maxHost[1] >= 5)", "if (maxHost && maxHost[1] >= 4)", "I rule 4: 4 of 10 on one domain is not enough", "same-domain threshold 5 -> 4"],
  ["lib-growth.mjs", "if (brandNames.includes(q))", "if (brandNames.some((b) => q.includes(b)))", "I rule 4: a query EQUAL to a directory brand", "brand contained instead of equal"],
  ["lib-growth.mjs", 'if (mods.local) return { intent: "local", rule: 1,', 'if (false) return { intent: "local", rule: 1,', "I rule 1: a gazetteer place", "local modifier ignored"],
  ["lib-growth.mjs", 'const listTypes = types.filter((t) => t !== "BreadcrumbList");', "const listTypes = types;", "P 2b: a BreadcrumbList", "breadcrumbs count as a list again"],
  ["lib-growth.mjs", 'if (hasType(types, "Product", "Offer")) return "product";\n  if (hasType(listTypes, "ItemList") || categoryPath(urlPath)) return "category";\n  if (hasType(types, "LocalBusiness")) return "local";', 'if (hasType(types, "LocalBusiness")) return "local";\n  if (hasType(types, "Product", "Offer")) return "product";\n  if (hasType(listTypes, "ItemList") || categoryPath(urlPath)) return "category";', "P 1: Product or Offer", "local before product"],
  ["lib-growth.mjs", 'if (main && isSchemaType(main, "VideoObject")) return "video";', 'if (hasType(types, "VideoObject")) return "video";', "P 5: VideoObject counts only", "video not required to be the main entity"],
  ["lib-growth.mjs", 'if (hasType(types, "QAPage") || dir?.kind === "forum") return "forum";', 'if (hasType(types, "QAPage")) return "forum";', "P 6: QAPage or a forum host", "forum host ignored"],
  ["lib-growth.mjs", 'segs.some((s) => s === "vs" || s.includes("-vs-"))', 'segs.some((s) => s === "vs")', "P 8: a path segment 'vs'", "-vs- path ignored"],
  ["lib-growth.mjs", "(i === segs.length - 1 || i === segs.length - 2)", "(i === segs.length - 1)", "P 2: ItemList, or a path ending in a category segment", "category handle segment ignored"],
  ["lib-growth.mjs", '  transactional: ["product", "category", "local"],', '  transactional: ["product", "category", "local", "article"],', "K: the 03 section 22.2 table", "article accepted for transactional"],
  ["lib-growth.mjs", "if (n >= overlap) {", "if (n >= overlap + 1) {", "C: 4 shared results link two queries", "overlap threshold off by one"],
  ["lib-growth.mjs", "const ra = find(a), rb = find(b); if (ra !== rb) { parent.set(rb, ra); }", "const ra = find(a), rb = find(b); if (ra !== rb && ra === a) { parent.set(rb, ra); }", "C: clusters are connected components", "no transitive merge"],
  ["lib-growth.mjs", "vol(b) - vol(a) || dif(a) - dif(b) || cmp(a.query, b.query)); // primary", "vol(b) - vol(a) || cmp(a.query, b.query)); // primary", "C: primary = highest volume", "difficulty tie-break dropped"],
  ["lib-growth.mjs", "const home = headIndex.get(headOf(r.query));", "const home = null;", "C: a query without SERP data joins", "head-term join dropped"],
  ["lib-growth.mjs", "(clicks(b) - clicks(a)) || (String(a.path).length - String(b.path).length)", "(String(a.path).length - String(b.path).length)", "M: several matches", "clicks ignored"],
  ["lib-growth.mjs", "(String(a.path).length - String(b.path).length) || cmp(String(a.path), String(b.path))", "cmp(String(a.path), String(b.path))", "M: no clicks anywhere", "shortest path rule dropped"],
  ["lib-growth.mjs", "&& isCompatible(cluster.intent, p.pageType, { cta })", "", "M: a page of an incompatible type", "page type ignored in the match"],
  ["lib-growth.mjs", "&& !namesOtherPlace(cluster.primaryQuery, `${p.title || \"\"} ${h1}`, { locale })", "", "M: a page for another place", "place guard dropped"],
  ["lib-growth.mjs", "return [cluster.primaryQuery, ...(cluster.queries || [])].some((q) => containsPhrase(text, q));", "return false;", "M: carriesQuery", "cluster queries ignored"],
];

// E: watched-fail mutants for the editorial-media pack. A function in the second slot edits the parsed JSON of the named ruleset in a copy of rules/ (the first slot is its path under rules/); a string in the second slot patches a script as above.
{
  const EP = "industries/editorial-media.json", LK = "link-sources/editorial-media.json", GIF = "gate-industry.mjs";
  const I = (d, id) => d.items.find((i) => i.id === id), T = (d, id) => d.pageTypes.find((t) => t.id === id), NEVER = "^\\/zz-never\\/", ZZ = "zzzz-never";
  mutants.push(
    [EP, (d) => { d.items[2].severity = "bogus"; }, null, "E: editorial-media.json validates against the item schema", "an item with a severity the gate does not know"],
    [EP, (d) => { d.slug = "x"; }, null, "E: the pack loads through loadIndustry", "wrong slug"],
    [EP, (d) => { d.pageTypes = d.pageTypes.filter((t) => t.id !== "author"); }, null, "E: the page types competitors use", "author page type dropped"],
    [EP, (d) => { T(d, "roundup").schema = ["CollectionPage"]; }, null, "E: every collection page type", "roundup plans no ItemList"],
    [EP, (d) => { T(d, "news").schema = ["NewsArticle"]; }, null, "E: news plans Article as well", "news plans NewsArticle only"],
    [EP, (d) => { T(d, "hub").plannerKind = "money"; }, null, "E: every plannerKind is one", "a planner kind claimed twice"],
    [EP, (d) => { T(d, "feature").requires.push("EDM-NOPE-001"); }, null, "E: every plannerKind is one", "a page type requires an item that does not exist"],
    [EP, (d) => { T(d, "home").schema.push("RealEstateAgent"); }, null, "E: a publisher plan never asks", "the home plans RealEstateAgent"],
    [EP, (d) => { I(d, "EDM-OUTCOME-001").source = I(d, "EDM-OUTCOME-001").source.replace(/UNVERIFIED/g, "checked"); }, null, "E: every item or source that cites", "a statute section presented as confirmed"],
    [EP, (d) => { d.notes = d.notes.replace("NOT ENFORCED", "ENFORCED"); }, null, "E: the pack says plainly", "the notes claim the JSON-LD checks are enforced"],
    [EP, (d) => { I(d, "EDM-OUTCOME-001").source = I(d, "EDM-OUTCOME-001").source.replace(/Why:/g, "Because:"); }, null, "E: every item gives a why", "an item with no why"],
    [EP, (d) => { d.notes += " Written for Matter of Place."; }, null, "E: the pack names no client", "a client name in the pack"],
    [EP, (d) => { delete d.seeds.queries[3].productLine; }, null, "E: every seed query has a product line", "a seed without a product line"],
    [EP, (d) => { d.seeds.queries.find((q) => q.scope === "local").scope = "national"; }, null, "E: every seed query has a product line", "a {city} query marked national"],
    [EP, (d) => { d.seeds.queries = d.seeds.queries.filter((q) => q.query !== "houses with history"); }, null, "E: the seed queries include", "a named editorial search dropped"],
    ["research-seeds.mjs", "return qs.map((x) => ({ query: x.query, source:", "return qs.slice(1).map((x) => ({ query: x.query, source:", "E: research-seeds.mjs --industry editorial-media", "the first pack query is not read"],
    [EP, (d) => { I(d, "EDM-PLACEHOLDER-001").patterns.push("Sample Journal"); }, null, "E: a clean editorial site PASSes", "a banned phrase that the clean site contains"],
    [EP, (d) => { I(d, "EDM-SPON-001").require[0].pattern = ZZ; }, null, "E: a labelled sponsored listing PASSes", "no label can satisfy the rule"],
    [EP, (d) => { I(d, "EDM-SPON-001").trigger = ZZ; }, null, "E: a listing credit with no paid-or-not label FAILs", "the listing credit no longer triggers the rule"],
    [EP, (d) => { delete I(d, "EDM-SPON-001").nearChars; }, null, "E: a Sponsored label more than 2500", "the label may sit anywhere on the page"],
    [GIF, 'if (item.nearChars && hits.length) {', "if (false) {", "E: a Sponsored label more than 2500", "gate ignores nearChars"],
    [EP, (d) => { I(d, "EDM-SPON-002").trigger = ZZ; }, null, "E: a sponsored page that never says payment", "sponsored pages need no editorial statement"],
    [EP, (d) => { I(d, "EDM-BYLINE-001").require[0].pattern = ".*"; }, null, "E: an article with no named author", "any text counts as a byline"],
    [EP, (d) => { I(d, "EDM-DATE-001").pathPattern = NEVER; }, null, "E: an article with no publication date", "no page is asked for a publication date"],
    [EP, (d) => { I(d, "EDM-DATE-002").pathPattern = NEVER; }, null, "E: an article with no last-updated date", "no page is asked for an updated date"],
    [EP, (d) => { I(d, "EDM-BYLINE-001").pathPattern = ".*"; }, null, "E: only article pages are asked", "every page is asked for a byline"],
    [GIF, "if (inScope && !inScope.test(pg.path)) continue;", "", "E: only article pages are asked", "gate ignores pathPattern"],
    [EP, (d) => { I(d, "EDM-OUTCOME-001").patterns[0] = ZZ; }, null, "E: 'guaranteed exposure' FAILs", "guaranteed-exposure pattern removed"],
    [EP, (d) => { I(d, "EDM-OUTCOME-001").patterns[1] = ZZ; }, null, "E: 'we guarantee a sale' FAILs", "we-guarantee pattern removed"],
    [EP, (d) => { I(d, "EDM-OUTCOME-001").patterns[2] = ZZ; }, null, "E: 'sells in days' FAILs", "sells-in-days pattern removed"],
    [EP, (d) => { I(d, "EDM-OUTCOME-001").patterns[4] = ZZ; I(d, "EDM-OUTCOME-001").patterns[5] = ZZ; }, null, "E: 'we will sell your home' FAILs", "we-will-sell patterns removed"],
    [EP, (d) => { I(d, "EDM-OUTCOME-001").patterns[3] = ZZ; }, null, "E: 'your home will sell' FAILs", "your-home-will-sell pattern removed"],
    [EP, (d) => { I(d, "EDM-OUTCOME-001").patterns[0] = "guaranteed (?:sale|exposure)"; }, null, "E: an honest disclaimer", "the negation guard is gone, so 'no guaranteed exposure' is flagged"],
    [EP, (d) => { I(d, "EDM-SCHEMA-001").types = ["Zzz"]; }, null, "E: RealEstateAgent schema on the publisher's page FAILs", "RealEstateAgent no longer forbidden"],
    [EP, (d) => { I(d, "EDM-SCHEMA-001").types = ["RealEstateAgent"]; }, null, "E: RealEstateListing schema inside an @graph", "RealEstateListing no longer forbidden"],
    [GIF, "if (found.length) report(item,", "if (false) report(item,", "E: RealEstateAgent schema on the publisher's page FAILs", "gate does not report forbidden JSON-LD types"],
    [EP, (d) => { I(d, "EDM-SCHEMA-001").unlessField = "credentials.never"; }, null, "E: with credentials.licensed = true the RealEstateAgent item is skipped", "the licence switch does not turn the schema rule off"],
    [GIF, "if (item.unlessField && get(biz, item.unlessField))", "if (false)", "E: with credentials.licensed = true the RealEstateAgent item is skipped", "gate ignores unlessField"],
    [EP, (d) => { I(d, "EDM-BROKER-001").patterns[0] = ZZ; }, null, "E: 'we represent buyers and sellers' FAILs", "we-represent pattern removed"],
    [EP, (d) => { I(d, "EDM-BROKER-001").patterns[1] = ZZ; }, null, "E: 'ask our agents' FAILs", "our-agents pattern removed"],
    [EP, (d) => { I(d, "EDM-BROKER-001").unlessField = "credentials.never"; }, null, "E: a licensed business (credentials.licensed) may say", "the licence switch does not turn the brokerage rule off"],
    [EP, (d) => { I(d, "EDM-BROKER-001").patterns.push("not a brokerage"); }, null, "E: a licensed business (credentials.licensed) may say", "'we are not a brokerage' is flagged"],
    [EP, (d) => { I(d, "EDM-ROLE-001").pathPattern = NEVER; }, null, "E: a submit page that does not say", "no page is asked for a role statement"],
    [EP, (d) => { I(d, "EDM-EMPTY-001").patterns = [ZZ]; }, null, "E: an indexable page that says 'no stories yet'", "empty-page wording no longer found"],
    [GIF, 'const sev = level === "FAIL" && item.severity === "warn" && !ctx.strict ? "WARN" : level;', "const sev = level;", "E: an indexable page that says 'no stories yet'", "warn items fail without --strict"],
    [GIF, "const biz = ctx.business, pages = [...ctx.site.pages.values()].filter((p) => ctx.indexable(p));", "const biz = ctx.business, pages = [...ctx.site.pages.values()];", "E: the same empty collection page kept noindex", "noindex pages are judged"],
    [EP, (d) => { I(d, "EDM-FH-001").patterns = [ZZ]; }, null, "E: fair-housing steering", "fair-housing wording no longer found"],
    [EP, (d) => { I(d, "EDM-ROUNDUP-001").pathPattern = NEVER; }, null, "E: a roundup with no", "no page is asked for the as-of line"],
    [EP, (d) => { I(d, "EDM-FREE-001").patterns = [ZZ]; }, null, "E: 'free feature' for a paid feature", "free-feature wording no longer found"],
    [EP, (d) => { I(d, "EDM-CLAIM-001").patterns = [ZZ]; }, null, "E: an unsubstantiated reach claim", "reach claims no longer found"],
    [EP, (d) => { I(d, "EDM-FORM-001").require[1].pattern = ".*"; }, null, "E: a form page with no privacy-policy", "any text counts as a privacy mention"],
    [EP, (d) => { I(d, "EDM-DISC-001").anyOf[2] = ["/"]; }, null, "E: a site with no editorial standard page", "the home page counts as an editorial standard"],
    [EP, (d) => { I(d, "EDM-PLACEHOLDER-001").patterns = [ZZ]; }, null, "E: an unfilled {{PLACEHOLDER}}", "placeholders no longer found"],
    [EP, (d) => { I(d, "EDM-SCHEMA-002").types = ["Zzz"]; }, null, "E: Review or AggregateRating markup", "review markup no longer found"],
    [LK, (d) => { d.aliases = d.aliases.filter((a) => a !== "real-estate-media"); }, null, "E: the link-source pack editorial-media is picked", "the alias real-estate-media dropped"],
    [LK, (d) => { d.domainTypes.find((e) => e.host === "dezeen.com").type = "directory"; }, null, "E: the link-source pack names a design-press host", "design press typed as a directory"],
    [LK, (d) => { d.aliases.push("realtor"); }, null, "E: no alias of the link-source pack belongs to another pack", "an alias that belongs to the realtor pack"],
  );
}

if (args.includes("--child") || !args.includes("--run-mutants-only")) {
  try { await suite(); } catch (e) { check("test harness ran to the end", false, e.stack || e); }
}
if (args.includes("--json")) { console.log(JSON.stringify({ total: R.length, passed: R.filter((x) => x.ok).length, failed: R.filter((x) => !x.ok).map((x) => x.name), detail: R.filter((x) => !x.ok) })); process.exit(R.every((x) => x.ok) ? 0 : 1); }
for (const x of R) console.log(`${x.ok ? "PASS" : "FAIL"}  ${x.name}${x.ok || !x.detail ? "" : "\n      " + x.detail}`);
const bad = R.filter((x) => !x.ok);
console.log(`\n${R.length - bad.length}/${R.length} rule checks passed`);

let code = bad.length ? 1 : 0;
if (!args.includes("--no-mutants") && !opt("--scripts") && !bad.length) {
  const NEEDED = /^(?!test-).*\.mjs$/; // the whole script folder: the editorial-media checks run gate-industry.mjs, which imports most of it
  const REAL_RULES = path.join(HERE, "..", "rules");
  const run = (dir, rulesDir = REAL_RULES) => new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(HERE, "test-rules.mjs"), "--scripts", dir, "--json", "--no-mutants"], { env: { ...process.env, PEWP_RULES_DIR: rulesDir } });
    let out = ""; p.stdout.on("data", (c) => (out += c)); p.stderr.on("data", (c) => (out += c));
    const t = setTimeout(() => p.kill(), 180000);
    p.on("close", () => { clearTimeout(t); try { resolve(JSON.parse(out.trim().split("\n").at(-1))); } catch { resolve(null); } });
  });
  const results = new Array(mutants.length);
  let next = 0;
  const worker = async () => {
    while (next < mutants.length) {
      const i = next++, [file, from, to, expect, why] = mutants[i];
      if (typeof from === "function") { // a ruleset mutant: `from` edits the parsed JSON of rules/<file> in a copy of the rules folder (scripts stay as they are)
        const rdir = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-mrr-")), target = path.join(rdir, file);
        fs.cpSync(REAL_RULES, rdir, { recursive: true });
        let doc, before, after, applied = true;
        try { doc = JSON.parse(fs.readFileSync(target, "utf8")); before = JSON.stringify(doc); from(doc); after = JSON.stringify(doc); } catch (e) { applied = false; after = String(e.message); }
        if (!applied || before === after) { results[i] = { file, why, status: "PATCH-NOT-APPLIED", detail: applied ? "the edit changed nothing" : after }; fs.rmSync(rdir, { recursive: true, force: true }); continue; }
        fs.writeFileSync(target, JSON.stringify(doc, null, 1) + "\n");
        const jr = await run(HERE, rdir);
        fs.rmSync(rdir, { recursive: true, force: true });
        results[i] = !jr ? { file, why, status: "NO-RESULT" } : jr.failed.some((f) => f.includes(expect)) ? { file, why, status: "RED (right reason)", detail: `${jr.failed.length} failing; e.g. ${jr.failed[0].slice(0, 70)}` } : { file, why, status: jr.failed.length ? "WRONG-CHECK" : "STAYED GREEN", detail: jr.failed.join(" | ").slice(0, 200) };
        continue;
      }
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-mr-"));
      for (const f of fs.readdirSync(HERE).filter((x) => NEEDED.test(x))) fs.copyFileSync(path.join(HERE, f), path.join(dir, f));
      const src = fs.readFileSync(path.join(dir, file), "utf8"), n = src.split(from).length - 1;
      if (n !== 1) { results[i] = { file, why, status: "PATCH-NOT-APPLIED", detail: `target text found ${n}x` }; fs.rmSync(dir, { recursive: true, force: true }); continue; }
      fs.writeFileSync(path.join(dir, file), src.replace(from, () => to));
      const j = await run(dir);
      fs.rmSync(dir, { recursive: true, force: true });
      results[i] = !j ? { file, why, status: "NO-RESULT" } : j.failed.some((f) => f.includes(expect)) ? { file, why, status: "RED (right reason)", detail: `${j.failed.length} failing; e.g. ${j.failed[0].slice(0, 70)}` } : { file, why, status: j.failed.length ? "WRONG-CHECK" : "STAYED GREEN", detail: j.failed.join(" | ").slice(0, 200) };
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  results.forEach((r, i) => console.log(`X mutant ${String(i + 1).padStart(2)} ${r.file}: ${r.why} -> ${r.status}${r.detail ? ` (${r.detail})` : ""}`));
  const ok = results.filter((r) => r.status === "RED (right reason)").length;
  console.log(`${ok === results.length ? "PASS" : "FAIL"} mutants ${ok}/${results.length} went red for the right reason`);
  if (ok !== results.length) code = 1;
}
process.exit(code);
