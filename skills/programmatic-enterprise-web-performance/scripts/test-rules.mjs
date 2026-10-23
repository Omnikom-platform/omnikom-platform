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
  ["lib-growth.mjs", 'if (hasType(types, "Product", "Offer")) return "product";\n  if (hasType(types, "ItemList") || categoryPath(urlPath)) return "category";\n  if (hasType(types, "LocalBusiness")) return "local";', 'if (hasType(types, "LocalBusiness")) return "local";\n  if (hasType(types, "Product", "Offer")) return "product";\n  if (hasType(types, "ItemList") || categoryPath(urlPath)) return "category";', "P 1: Product or Offer", "local before product"],
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

if (args.includes("--child") || !args.includes("--run-mutants-only")) {
  try { await suite(); } catch (e) { check("test harness ran to the end", false, e.stack || e); }
}
if (args.includes("--json")) { console.log(JSON.stringify({ total: R.length, passed: R.filter((x) => x.ok).length, failed: R.filter((x) => !x.ok).map((x) => x.name), detail: R.filter((x) => !x.ok) })); process.exit(R.every((x) => x.ok) ? 0 : 1); }
for (const x of R) console.log(`${x.ok ? "PASS" : "FAIL"}  ${x.name}${x.ok || !x.detail ? "" : "\n      " + x.detail}`);
const bad = R.filter((x) => !x.ok);
console.log(`\n${R.length - bad.length}/${R.length} rule checks passed`);

let code = bad.length ? 1 : 0;
if (!args.includes("--no-mutants") && !opt("--scripts") && !bad.length) {
  const NEEDED = /^(lib-text|lib-snowball|lib-growth|lib-rules)\.mjs$/;
  const run = (dir) => new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(HERE, "test-rules.mjs"), "--scripts", dir, "--json", "--no-mutants"], { env: { ...process.env, PEWP_RULES_DIR: path.join(HERE, "..", "rules") } });
    let out = ""; p.stdout.on("data", (c) => (out += c)); p.stderr.on("data", (c) => (out += c));
    const t = setTimeout(() => p.kill(), 180000);
    p.on("close", () => { clearTimeout(t); try { resolve(JSON.parse(out.trim().split("\n").at(-1))); } catch { resolve(null); } });
  });
  const results = new Array(mutants.length);
  let next = 0;
  const worker = async () => {
    while (next < mutants.length) {
      const i = next++, [file, from, to, expect, why] = mutants[i];
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
