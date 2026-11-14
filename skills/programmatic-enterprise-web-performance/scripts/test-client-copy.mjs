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
    { id: "home-city-typed", file: "client-copy-data.mjs", from: 'const home = String(area[0]).split(",")[0].trim();', to: 'const home = "Alder Bay";', red: "case 2:" },
    { id: "paid-row-filter-out", file: "client-copy-data.mjs", from: "if (isAd(name) || name === ourName) return;", to: "if (name === ourName) return;", red: "case 10:" },
    { id: "missing-lead-path-prints-zero", file: "client-copy-data.mjs", from: 'else put("formFields", null);', to: 'else put("formFields", 0);', red: "case 9:" },
    { id: "backing-id-needs-no-works", file: "client-copy-data.mjs", from: 'const works = states.every((s) => s.state === "WORKS");', to: "const works = true;", red: "case 11:" },
    { id: "address-cut-at-first-comma", file: "client-copy-data.mjs", from: 'const street = (a, home) => { const i = a.search(new RegExp(`,\\\\s*${escRe(home)}`, "i")); return (i > 0 ? a.slice(0, i) : a).trim(); };', to: 'const street = (a, home) => a.split(",")[0].trim();', red: "case 14:" },
    { id: "css-font-files-unchecked", file: "client-copy.mjs", from: 'for (const f of fontFiles) { if (!fs.existsSync(path.join(assetsDir, "fonts", f))) stop(`STOP: assets fonts/${f} is missing`); }', to: "", red: "case 13:" },
    { id: "ads-blocked-row-is-read", file: "client-copy-data.mjs", from: 'if (getMaybe("ads", `rows[advertiser=${d}&library=google-transparency].status`, "text") === "blocked") return null; ', to: "", red: "case 19:" },
    { id: "ads-no-google-row-is-read", file: "client-copy-data.mjs", from: 'if (getMaybe("ads", `rows[advertiser=${d}&library=google-transparency].library`, "text") === null) return null; ', to: "", red: "case 20:" },
    { id: "plan-row-needs-no-gets", file: "client-copy.mjs", from: '["id", "when", "fix", "gets", "who", "see"]', to: '["id", "when", "fix"]', red: "case 8:" },
    { id: "profile-rule-always-true", file: "client-copy-design.mjs", from: "profileLinkBroken: () => pr.broken.length > 0,", to: "profileLinkBroken: () => pr.broken.length >= 0,", red: "case 18:" },
    { id: "draft-contains-unchecked", file: "client-copy.mjs", from: 'if (!isTexts(std.draftContains) || std.draftContains.length !== 3) stop("STOP: how-we-work.json has no draftContains as a list of 3 texts");', to: "", red: "case 7:" },
    { id: "go-ahead-typed-in-code", file: "client-copy-design.mjs", from: "${esc(std.goAhead)}", to: "Tell us to start your draft.", red: "case 7:" },
    { id: "who-typed-in-code", file: "client-copy-design.mjs", from: "fill(f.gets, `row ${f.id} gets`), f.who, f.see]);", to: 'fill(f.gets, `row ${f.id} gets`), "Your developer", f.see]);', red: "case 8:" },
    { id: "gates-not-called", file: "client-copy.mjs", from: "gates({ html, tsv, pages, logoUrl, branches, approvedWords: approvedWords.words });", to: "", red: "case 21:" },
    { id: "gates-after-the-first-write", file: "client-copy.mjs", from: "gates({ html, tsv, pages, logoUrl, branches, approvedWords: approvedWords.words });", to: 'fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, "early.html"), html); gates({ html, tsv, pages, logoUrl, branches, approvedWords: approvedWords.words });', red: "case 21:" },
    { id: "tx-p2-8-running-head-name-row-off", file: "client-copy-design.mjs", from: "TX(\"biz\", NAME, \"business name, running head\", NAME)", to: "esc(NAME)", red: "case 22:" },
    { id: "tx-p1-cover-name-row-off", file: "client-copy-design.mjs", from: "TX(\"biz\", NAME, \"business name, cover\", NAME)", to: "esc(NAME)", red: "case 22:" },
    { id: "tx-p2-city-row-off", file: "client-copy-design.mjs", from: "city(home, \"city, spots in the top three\")", to: "esc(home)", red: "case 22:" },
    { id: "tx-p2-product-spots-row-off", file: "client-copy-design.mjs", from: "prod(f.key, f.lower, \"product, spots in the top three\")", to: "esc(plain(f.lower))", red: "case 22:" },
    { id: "tx-p2-away-city-row-off", file: "client-copy-design.mjs", from: "city(c, \"city, away spots in the top three\")", to: "esc(c)", red: "case 22:" },
    { id: "tx-p2-demand-product-row-off", file: "client-copy-design.mjs", from: "prod(d.key, d.product, \"product, what buyers search for\")", to: "esc(plain(d.product))", red: "case 22:" },
    { id: "tx-p2-note-product-row-off", file: "client-copy-design.mjs", from: "prod(topP.key, topP.product, \"most searched product, summary note\")", to: "esc(plain(topP.product))", red: "case 22:" },
    { id: "tx-p2-bing-figure-where-row-off", file: "client-copy-design.mjs", from: "TX(\"demandWhere\", D.demandWhere, \"where Bing's figure is for\")", to: "esc(plain(D.demandWhere))", red: "case 22:" },
    { id: "tx-p3-result-title-row-off", file: "client-copy-design.mjs", from: "TX(\"textSerp\", r.title, `${eng} result title, position ${r.position}`, pk(\"title\"))", to: "esc(plain(r.title))", red: "case 22:" },
    { id: "tx-p3-title-less-domain-row-off", file: "client-copy-design.mjs", from: "TX(\"textSerp\", r.domain, `${eng} result domain shown as the title, position ${r.position}`, pk(\"domain\"))", to: "esc(plain(r.domain))", red: "case 22:" },
    { id: "tx-p3-result-domain-row-off", file: "client-copy-design.mjs", from: "TX(\"textSerp\", r.domain, `${eng} result domain, position ${r.position}`, pk(\"domain\"))", to: "esc(plain(r.domain))", red: "case 22:" },
    { id: "tx-p3-name-in-list-row-off", file: "client-copy-design.mjs", from: "TX(\"biz\", NAME, `business name, your row in the ${eng} list`, NAME)", to: "esc(NAME)", red: "case 22:" },
    { id: "tx-p3-search-phrase-row-off", file: "client-copy-design.mjs", from: "TX(\"textSerp\", SL.query, \"search phrase of the two lists\", \"engine=google&device=desktop].query\")", to: "esc(plain(SL.query))", red: "case 22:" },
    { id: "tx-p3-lede-product-row-off", file: "client-copy-design.mjs", from: "prod(topP.key, topP.product, \"most searched product, results lede\")", to: "esc(plain(topP.product))", red: "case 22:" },
    { id: "tx-p3-rival-name-row-off", file: "client-copy-design.mjs", from: "rname(r, \"rival named, words in the first response\")", to: "esc(plain(r.printName))", red: "case 22:" },
    { id: "tx-p4-named-instead-row-off", file: "client-copy-design.mjs", from: "TX(\"textAi\", nm, `business named instead, question ${qi + 1}, ${E}`, `question=${x.question}&engine=${e}].competitorsNamed[name=${nm}]`)", to: "esc(plain(nm))", red: "case 22:" },
    { id: "tx-p4-question-row-off", file: "client-copy-design.mjs", from: "TX(\"textAi\", x.question, `question ${qi + 1}`, `question=${x.question}].question`)", to: "esc(plain(x.question))", red: "case 22:" },
    { id: "tx-p4-named-most-often-row-off", file: "client-copy-design.mjs", from: "TX(\"aiInstead\", a.name, \"business the assistants name instead most often\", a.name)", to: "esc(plain(a.name))", red: "case 22:" },
    { id: "tx-p5-tile-row-product-row-off", file: "client-copy-design.mjs", from: "prod(r.key, r.product, \"product, Maps tile row\")", to: "esc(plain(r.product))", red: "case 22:" },
    { id: "tx-p5-headline-city-row-off", file: "client-copy-design.mjs", from: "city(home, \"city, Maps headline\")", to: "esc(home)", red: "case 22:" },
    { id: "tx-p5-headline-away-city-row-off", file: "client-copy-design.mjs", from: "city(c, \"city, Maps headline away\")", to: "esc(c)", red: "case 22:" },
    { id: "tx-p5-maps-business-row-off", file: "client-copy-design.mjs", from: "TX(\"textMaps\", r.name, `business shown by Maps in its first three, ${ri + 1}`, `name=${r.name}]`)", to: "esc(plain(r.name))", red: "case 22:" },
    { id: "tx-p5-address-directory-row-off", file: "client-copy-design.mjs", from: "TX(\"textDirs\", w2, \"directory named beside an address\", `printed as ${w2})`)", to: "esc(plain(w2))", red: "case 22:" },
    { id: "tx-p5-review-line-city-row-off", file: "client-copy-design.mjs", from: "city(home, \"city, review line\")", to: "esc(home)", red: "case 22:" },
    { id: "tx-p5-claim-directory-row-off", file: "client-copy-design.mjs", from: "TX(\"textDirs\", r.name, \"directory to claim, Maps fix\", `printed as ${r.name})`)", to: "esc(plain(r.name))", red: "case 22:" },
    { id: "tx-p5-tile-column-city-row-off", file: "client-copy-design.mjs", from: "city(c, \"city, Maps tile column\")", to: "esc(c)", red: "case 22:" },
    { id: "tx-p5-list-product-row-off", file: "client-copy-design.mjs", from: "prod(topP.key, topP.product, \"most searched product, Maps list\")", to: "esc(plain(topP.product))", red: "case 22:" },
    { id: "tx-p5-list-city-row-off", file: "client-copy-design.mjs", from: "city(home, \"city, Maps list\")", to: "esc(home)", red: "case 22:" },
    { id: "tx-p6-headline-city-row-off", file: "client-copy-design.mjs", from: "city(home, \"city, rivals headline\")", to: "esc(home)", red: "case 22:" },
    { id: "tx-p6-name-row-off", file: "client-copy-design.mjs", from: "TX(\"biz\", NAME, \"business name, comparison table\", NAME)", to: "esc(NAME)", red: "case 22:" },
    { id: "tx-p6-rival-table-row-off", file: "client-copy-design.mjs", from: "rname(r, \"rival named, comparison table\")", to: "esc(plain(r.printName))", red: "case 22:" },
    { id: "tx-p6-rival-ads-row-off", file: "client-copy-design.mjs", from: "rname(r, \"rival named, ads line\")", to: "esc(plain(r.printName))", red: "case 22:" },
    { id: "tx-p6-advertiser-domain-row-off", file: "client-copy-design.mjs", from: "TX(\"ads\", a.domain, \"advertiser domain, ads line\", `advertiser=${a.domain}&`)", to: "esc(plain(a.domain))", red: "case 22:" },
    { id: "tx-p6-chambers-city-row-off", file: "client-copy-design.mjs", from: "city(home, \"city, chambers fix\")", to: "esc(home)", red: "case 22:" },
    { id: "tx-p7-profile-row-off", file: "client-copy-design.mjs", from: "TX(\"profiles\", nm, `profile named in the plan row, ${at}`, `\"${nm.toLowerCase()}\"`)", to: "esc(plain(nm))", red: "case 22:" },
    { id: "tx-p7-top-product-row-off", file: "client-copy-design.mjs", from: "topProduct: (at) => prod(T7.key, T7.lower, `most searched product, plan row, ${at}`)", to: "topProduct: (at) => esc(plain(T7.lower))", red: "case 22:" },
    { id: "tx-p7-second-product-row-off", file: "client-copy-design.mjs", from: "secondLower: (at) => prod(D.demand[1].key, D.demand[1].lower, `second most searched product, plan row, ${at}`)", to: "secondLower: (at) => esc(plain(D.demand[1].lower))", red: "case 22:" },
    { id: "tx-p7-city-row-off", file: "client-copy-design.mjs", from: "home: (at) => city(home, `city, plan row, ${at}`)", to: "home: (at) => esc(plain(home))", red: "case 22:" },
    { id: "tx-p7-claim-directory-row-off", file: "client-copy-design.mjs", from: "TX(\"textDirs\", r.name, `directory to claim, plan row, ${at}`, `printed as ${r.name})`)", to: "esc(plain(r.name))", red: "case 22:" },
    { id: "tx-source-lookup-wrong", file: "client-copy-design.mjs", from: "TX(\"textSerp\", SL.query, \"search phrase of the two lists\", \"engine=google&device=desktop].query\")", to: "TX(\"textSerp\", SL.query, \"search phrase of the two lists\", \"engine=google&device=desktop].qry\")", red: "case 22:" },
    { id: "tx-p7-text-drawn-once-for-two-places", file: "client-copy-design.mjs", from: "(TEXTPH.has(s.slice(1, -1)) ? PH[s.slice(1, -1)](at) : ph(s.slice(1, -1)))", to: "ph(s.slice(1, -1))", red: "case 22:" },
    { id: "f1-stars-always", file: "client-copy-rules.mjs", from: "&& Number(rating) >= STARS_MIN;", to: "&& Number(rating) >= 0;", red: "case 23:" },
    { id: "f1-stars-line-three", file: "client-copy-rules.mjs", from: "export const STARS_MIN = 4.0;", to: "export const STARS_MIN = 3.0;", red: "case 23:" },
    { id: "f1-stars-strict", file: "client-copy-rules.mjs", from: "&& Number(rating) >= STARS_MIN;", to: "&& Number(rating) > STARS_MIN;", red: "case 23:" },
    { id: "f1-stars-lede-kept", file: "client-copy-design.mjs", from: "head(\"Summary\", h, stars ? \"You are easy to trust and hard to find.\" : \"\")", to: "head(\"Summary\", h, \"You are easy to trust and hard to find.\")", red: "case 23:" },
    { id: "f1-stars-item-kept", file: "client-copy-design.mjs", from: "...(stars ? [[P(\"rating\", D.rating.rating, \"Google rating\"", to: "...(true ? [[P(\"rating\", D.rating.rating, \"Google rating\"", red: "case 23:" },
    { id: "f1-stars-headline-kept", file: "client-copy-design.mjs", from: "const h = stars ? `You have", to: "const h = true ? `You have", red: "case 23:" },
    { id: "f1-stars-row-kept", file: "client-copy-design.mjs", from: "product: esc(w.product) });", to: "product: esc(w.product), z: P(\"rating\", D.rating.rating, \"rating\") });", red: "case 23:" },
    { id: "f1-one-fix-plural", file: "client-copy-design.mjs", from: "R.length === 1 ? BR(\"rb-one-fix\"", to: "R.length === 0 ? BR(\"rb-one-fix\"", red: "case 24:" },
    { id: "f1-one-fix-lede-kept", file: "client-copy-design.mjs", from: "R.length === 1 ? \"\" : \"Start at the top.", to: "R.length === 0 ? \"\" : \"Start at the top.", red: "case 24:" },
    { id: "f1-no-row-no-stop", file: "client-copy-design.mjs", from: "if (!R.length) stop(", to: "if (false) stop(", red: "case 24:" },
    { id: "f1-top-only-never", file: "client-copy-design.mjs", from: "f.id === \"top-page\" && topOnly ?", to: "f.id === \"top-page\" && false ?", red: "case 25:" },
    { id: "f1-top-only-wrong-product", file: "client-copy-design.mjs", from: "Boolean(D.demand[1] && D.demand[1].page)", to: "Boolean(D.demand[2] && D.demand[2].page)", red: "case 25:" },
    { id: "f1-other-count-all", file: "client-copy-design.mjs", from: "P(\"demand\", D.demand.slice(2).filter((r) => !r.page).length,", to: "P(\"demand\", D.demand.length - 2,", red: "case 25:" },
    { id: "f1-listed-count-all", file: "client-copy-design.mjs", from: "const k = D.demand.slice(2).filter((r) => r.page).length;", to: "const k = D.productPages.listed;", red: "case 25:" },
    { id: "f1-noun-profile-page-4", file: "client-copy-design.mjs", from: "\"profiles to link\", \"rows (length)\")} ${noun(pr.total, \"profile\", \"profiles\")}", to: "\"profiles to link\", \"rows (length)\")} ${\"profiles\"}", red: "case 26:" },
    { id: "f1-noun-profile-plan-row", file: "client-copy-design.mjs", from: "\"profiles\", \"rows (length)\")} ${noun(pr.total, \"profile\", \"profiles\")}`;", to: "\"profiles\", \"rows (length)\")} ${\"profiles\"}`;", red: "case 26:" },
    { id: "f1-noun-place", file: "client-copy-design.mjs", from: "${noun(LP.pursue, \"place\", \"places\")} worth asking", to: "places worth asking", red: "case 26:" },
    { id: "f1-noun-helper-plural-only", file: "client-copy-design.mjs", from: "const noun = (n, one, many) => (n === 1 ? one : many);", to: "const noun = (n, one, many) => many;", red: "case 26:" },
    { id: "f1-gate-new-words-not-called", file: "client-copy.mjs", from: "gates({ html, tsv, pages, logoUrl, branches, approvedWords: approvedWords.words });", to: "gates({ html, tsv, pages, logoUrl });", red: "case 27:" },
    { id: "f1-gate-plural-rule-off", file: "client-copy-gates.mjs", from: " || ok.has(`${w}s`) || ok.has(`${w}es`) || (w.endsWith(\"es\") && ok.has(w.slice(0, -2))) || (w.endsWith(\"s\") && ok.has(w.slice(0, -1)))", to: "", red: "case 27:" },
    { id: "f1-gate-braces-read", file: "client-copy-gates.mjs", from: ".replace(/\\{[^}]*\\}/g, \" \")", to: "", red: "case 27:" },
    { id: "f1-gate-lists-two", file: "client-copy-gates.mjs", from: "bad.slice(0, 4).map(", to: "bad.slice(0, 2).map(", red: "case 27:" },
    { id: "f1-branches-file-unchecked", file: "client-copy.mjs", from: "const otherBranches = readJson(\"other-branches.json\", \"other-branches.json\");", to: "const otherBranches = { sentences: [] };", red: "case 27:" },
    { id: "f1-missing-sentence-no-stop", file: "client-copy-design.mjs", from: "if (typeof t !== \"string\") stop(", to: "if (false) stop(", red: "case 27:" },
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
  s.vol = P.map(() => u()); s.vol[P.length - 1] *= 4; // the top product holds most of the demand: the plan row "the search most buyers type" needs more than half
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
const A = (o = {}) => mk({
  seed: 1290, key: "A", name: "Alder Bay Roofing", short: "Alder", domain: "alder-bay-roofing.test", sdType: "RoofingContractor",
  products: ["roof repair", "roof replacement", "gutter installation"], cities: ["Alder Bay, WA", "Pine Hollow, WA", "Stonebrook, WA"],
  extraArea: ["Cedar Flats, WA", "Lakeview, WA"], rating: 4.8, phone: 2210, desk: 1460,
  rivals: [{ domain: "ridgeline-roofs.test", name: "Ridgeline Roofs", note: "roofing contractor; family run", status: 200 }, { domain: "harbor-gutters.test", name: "Harbor Gutters", note: "gutter shop; small", status: 200 }, { domain: "summit-shingle.test", name: "Summit Shingle Co", note: "national roofing chain; large", status: 200 }],
  rivalInGraph: [true, true, false], ourInGraph: false, body: '<html><head><script>var spoken = "one two three four five";</script><style>p { color: red }</style></head><body><div id="root"></div></body></html>',
  siteAddr: "14 Cedar Row, Alder Bay, WA", gAddr: "14 Cedar Row, Alder Bay, WA", bAddr: "9 Mill Lane, Alder Bay, WA", fAddr: "22 Harbor Street, Alder Bay, WA", hasFiling: true,
  sitemapUrls: 0, sitemapType: "text/html", notFound: 200, rangeFrom: "2026-10-15", rangeTo: "2026-11-13", seedsN: 7, rowsN: 31,
  serpProduct: [null, null, null, null, null, null], serpName: [1, 3], serpSite: [1], serpNick: [null], nick: "alder roofs", nameQ: "alder bay roofing",
  missing: ["roof repair", "roof replacement", "gutter installation"], desc: "", services: [], broken: true, social: ["instagram", "youtube", "linkedin"], sameAs: 0,
  faqHeading: true, cites: [["bing.com (Bing Places)", "listed", true], ["apple.com (Apple Maps)", "not listed"], ["yelp.com", "listed"], ["manta.com", "not listed"]],
  hands: true, mailProblem: true, qNames: ["who is alder bay roofing", "best roof repair near me", "gutter installation cost", "alder bay roofing reviews"], shares: [0.4, 0, 0, 0.2], ...o,
});
// AD: run A with a 4-digit number of its own inside every text a page draws from a file (business, cities, products, results, rivals, questions, names, directories, profiles)
const AD = () => {
  const used = [], dx = () => { const n = 7300 + 7 * (used.length + 1); used.push(String(n)); return n; };
  const t = (x) => `${x} ${dx()}`, h = (x) => `${x}${dx()}`;
  const home = t("Alder Bay"), products = [t("roof repair"), t("roof replacement"), t("gutter installation")];
  const rv = [["ridgeline-roofs", t("Ridgeline Roofs")], ["harbor-gutters", t("Harbor Gutters")], ["summit-shingle", t("Summit Shingle Co")]];
  const notes = ["roofing contractor; family run", "gutter shop; small", "national roofing chain; large"];
  return A({ dx, dxUsed: used, name: t("Alder Bay Roofing"), cities: [`${home}, WA`, `${t("Pine Hollow")}, WA`, `${t("Stonebrook")}, WA`], products, missing: products,
    rivals: rv.map(([d, name], i) => ({ domain: `${h(d)}.test`, name, note: notes[i], status: 200 })),
    siteAddr: `14 Cedar Row, ${home}, WA`, gAddr: `14 Cedar Row, ${home}, WA`, bAddr: `9 Mill Lane, ${home}, WA`, fAddr: `22 Harbor Street, ${home}, WA`,
    extraAd: `${h("big-advertiser")}.test`, social: [h("instagram"), h("youtube"), h("linkedin")],
    cites: [[`bing.com (${t("Bing Places")})`, "listed", true], [`apple.com (${t("Apple Maps")})`, "not listed"], ["yelp.com", "listed"], [`manta.com (${t("Manta")})`, "not listed"]] });
};
const B = () => mk({
  seed: 5210, key: "B", name: "Northgate Family Dental", short: "Northgate", domain: "northgate-family-dental.test", sdType: "Dentist",
  products: ["teeth cleaning", "dental implants"], cities: ["Northgate, OH", "Elm Ridge, OH"], extraArea: [], rating: 4.6, phone: 3640, desk: 1180,
  rivals: [{ domain: "brightsmile-clinic.test", name: "Bright Smile Clinic", note: "dental clinic; mid size", status: 200 }, { domain: "oakvale-dentists.test", name: "Oakvale Dentists", note: "dentist group", status: 200 }, { domain: "quiet-molar.test", name: "Quiet Molar", note: "dentist; closed site", status: 404 }],
  rivalInGraph: [true, true, false], ourInGraph: false, body: '<html><head><script>var spoken = "book a visit";</script></head><body><div id="root"></div></body></html>',
  siteAddr: "7 Birch Court, Northgate, OH", gAddr: "7 Birch Court, Northgate, OH", bAddr: "11 Birch Court, Northgate, OH", fAddr: "", hasFiling: false,
  sitemapUrls: 0, sitemapType: "text/html", notFound: 200, rangeFrom: "2026-10-01", rangeTo: "2026-10-31", seedsN: 4, rowsN: 19,
  serpProduct: [3, null, null, null], serpName: [1], serpSite: [1], serpNick: [], nick: "", nameQ: "northgate family dental",
  missing: ["dental implants"], desc: "A family practice.", services: [], broken: false, social: ["facebook"], sameAs: 0,
  faqHeading: true, cites: [["bing.com (Bing Places)", "listed", true], ["apple.com (Apple Maps)", "not listed"], ["yelp.com", "listed"], ["manta.com", "not listed"]],
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
  // s.dx (the digit run only): a function giving a new 4-digit number; every text of the run that a page prints gets one of its own
  const X = (t) => (s.dx ? `${t} ${s.dx()}` : t), H = (host) => (s.dx ? host.replace(/\./, `${s.dx()}.`) : host);
  const [CEDAR, BIRCH, MAPLE, ZINC, HOP1, HOP2] = ["Cedar Roofs", "Birch Roofs", "Maple Roofs", "Zinc Roofs", "Hilltop Roof One", "Hilltop Roof Two"].map(X);
  const BIGDIR = H("bigdirectory.test"), BLOG = H("random-blog.test"), LOC = s.dx ? `US ${s.dx()}` : "US";
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
    keywords: [...P.map((p, i) => ({ query: p, related: false, volume: { value: s.vol[i], unit, location: LOC } })), { query: `${P[0]} cost`, related: true, volume: { value: s.relatedVol[0], unit, location: LOC } }, { query: `${P[0]} near me`, related: true, volume: { value: s.relatedVol[1], unit, location: LOC } }],
    siteStats: { status: "blocked", blocked: "not a client yet" },
  });
  wp("research/index.json", { generatedAt: "2026-11-13T07:01:00.000Z", rows: [{ engine: "bing", serviceChecks: [] }, { engine: "google", serviceChecks: P.map((service) => ({ service })) }], summary: { servicesMissing: s.missing, servicesChecked: P.length, servicesListed: P.length - s.missing.length } });
  const cap = (query, engine, device, pos) => ({ query, engine, device, ourPosition: { value: pos } });
  const caps = [];
  P.forEach((p, i) => { caps.push(cap(`${p} near me`, "google", "mobile", s.serpProduct[i * 2] ?? null)); caps.push(cap(`${p} price`, "bing", "desktop", s.serpProduct[i * 2 + 1] ?? null)); });
  s.serpName.forEach((v) => caps.push(cap(s.nameQ, "google", "mobile", v)));
  s.serpSite.forEach((v) => caps.push(cap(`site:${s.domain}`, "google", "desktop", v)));
  s.serpNick.forEach((v) => caps.push(cap(s.nick, "bing", "mobile", v)));
  // the results lists of page 3: every product in the home city, on Google and on Bing, desktop, read from outside the area
  const rd = (i) => s.rivals[i].domain, ent = (n, domain, title) => ({ position: n, url: `https://${domain}/r${n}`, domain, title: title === null ? "" : title || X(`Result ${n}`) });
  const gList = [ent(1, H("county.agency.gov"), X("Roof help \u2013 County Agency")), ent(2, rd(0)), ent(3, rd(1)), ent(4, BIGDIR), ent(5, BLOG), ent(6, "extra-six.test"), ent(7, "extra-seven.test")];
  const bList = [ent(1, H("legacy.county.agency.gov")), ent(2, BLOG), ent(3, rd(1), s.dx ? null : undefined), ent(4, rd(0)), ent(5, BIGDIR), ent(6, "extra-six.test")]; // in the digit run one Bing result has no title: the page prints its domain as the title
  P.forEach((p) => ["google", "bing"].forEach((engine) => caps.push({ query: `${p} ${s.home}`, engine, device: "desktop", location: { requested: C[0], localized: false }, ourPosition: { value: null }, organic: engine === "google" ? gList : bList })));
  s.serpTotal = caps.length;
  s.serpProductN = P.length * 4; s.serpProductWithUs = caps.slice(0, P.length * 2).filter((c) => c.ourPosition.value !== null).length;
  wp("research/serp.json", { generatedAt: "2026-11-13T07:02:00.000Z", captures: caps, counts: { captures: caps.length, notLocalized: caps.length } });
  wp("research/autocomplete.json", { generatedAt: "2026-11-13T07:03:00.000Z", seeds: Array.from({ length: s.seedsN }, (_, i) => `seed ${i}`), rows: Array.from({ length: s.rowsN }, (_, i) => ({ i })) });
  const aiRows = [], q = ["buyer one", "buyer two", "about the business"].map(X);
  s.aiQuestions = 3;
  const named = { chatgpt: [true, false, true], perplexity: [false, false, true] };
  const inst = { "chatgpt-1": [[CEDAR, BIRCH], `Try ${BIRCH} first, then ${CEDAR}.`], "perplexity-0": [[MAPLE, ZINC, BIRCH, CEDAR], `${ZINC} is first; ${BIRCH} and ${CEDAR} follow; ${MAPLE} is last.`], "perplexity-1": [[CEDAR], `${CEDAR}.`] };
  for (const e of ["chatgpt", "perplexity"]) q.forEach((qq, i) => { const f = `${e}-${i}.json`, ins = inst[`${e}-${i}`] || [[], "Nothing."]; aiRows.push({ engine: e, status: "ok", file: f, type: i < 2 ? "buyer" : "brand", named: named[e][i], question: qq, competitorsNamed: ins[0] }); wp(`captures/ai/${f}`, { capturedAt: "2026-11-12T10:00:00.000Z", signedIn: true, answerText: ins[1] }); });
  for (const e of ["copilot", "gemini"]) aiRows.push({ engine: e, status: "blocked", file: `${e}.json` });
  wp("research/ai-answers.json", { generatedAt: "2026-11-13T07:04:00.000Z", summary: { engines: [{ engine: "chatgpt", status: "ok", questions: 3, named: 2 }, { engine: "perplexity", status: "ok", questions: 3, named: 1 }, { engine: "copilot", status: "blocked", questions: 0, named: 0 }, { engine: "gemini", status: "blocked", questions: 0, named: 0 }], blockedEngines: [{ engine: "copilot", reason: "asks for a sign in" }, { engine: "gemini", reason: "asks for a sign in" }], questions: 6, competitors: [{ name: s.rivals[0].name, count: 9 }, { name: s.rivals[1].name, count: 6 }, { name: s.rivals[2].name, count: 3 }] }, rows: aiRows });
  wp("research/ai-citations.json", { generatedAt: "2026-11-13T07:05:00.000Z", rows: s.qNames.map((question, i) => ({ engine: "google-ai-overview", question, ourNameMentionedShare: { value: s.shares[i] } })) });
  s.aiCitations = s.qNames.length;
  // the grid: an older one (other values) and the one the step's last evidence names
  // R3a: the pack rows of the top product in the home city (the last product: volume rises with the index); k = the point (0..8)
  const packOf = (i, j, k) => {
    if (i !== P.length - 1 || j !== 0) return [];
    const r = s.reviews, CL = s.name, rw = (position, name, reviews) => (reviews === undefined ? { position, name } : { position, name, reviews });
    if (k <= 3) return [rw(1, HOP1, r + 200), rw(2, CL, r), rw(3, HOP2, r + 77)];
    if (k <= 6) return [rw(1, CL, r), rw(2, HOP1, r + 200), rw(3, CEDAR)];
    return [rw(1, CEDAR), rw(2, HOP2, r + 77), rw(3, "Ad \u00b7 Hilltop Ads", 9999), rw(4, "Late Roofs", 5)];
  };
  const mkGrid = (shift) => ({
    date: shift ? "2026-11-12" : s.date, plan: { n: 3, spacingKm: s.key === "A" ? 2.5 : 1.5, captures: s.planCaptures }, summary: { localized: s.planCaptures },
    solv: P.flatMap((p, i) => C.map((c, j) => ({ query: `${p} ${c.split(",")[0]}`, city: c, points: 9, pointsInPack: s.grid[i][j].inPack + shift, pointsIn3Pack: s.grid[i][j].in3 + shift }))),
    points: shift ? [] : P.flatMap((p, i) => C.flatMap((c, j) => Array.from({ length: 9 }, (_, k) => ({ query: `${p} ${c.split(",")[0]}`, city: c, pointId: `${i}-${j}-${k}`, row: Math.floor(k / 3) + 1, col: (k % 3) + 1, packSize: 3, pack: packOf(i, j, k), position: { value: k < s.grid[i][j].in3 ? 1 + (k % 3) : k < s.grid[i][j].inPack ? 4 + (k % 2) : null }, ours: i === P.length - 1 && j === 0 && k >= 7 ? null : { name: s.name }, top3: i === 0 ? [{ name: s.name, reviews: s.reviews }, { name: "Hilltop Rival One", reviews: s.reviews + 200 }, { name: "Ad \u00b7 Hilltop Ads", reviews: 9999 }] : i === 1 ? [{ name: "Hilltop Rival Two", reviews: s.reviews + 77 }, { name: "Hilltop Rival Three", reviews: s.reviews - 30 }, { name: "Hilltop Rival Four" }] : [{ name: "Hilltop Rival One", reviews: s.reviews + 200 }] })))),
  });
  wp("local/2026-11-12/grid.json", mkGrid(1));
  wp(gridRel, mkGrid(0));
  wp("business.json", { name: "stale file, never read" });
  wp("approved/business.json", { name: s.name, domain: s.domain, vocabulary: P.map((p) => p[0].toUpperCase() + p.slice(1)), locations: [{ serviceArea: AREA(s) }] });
  wp("captures/local/profile.json", { capturedAt: "2026-11-12T09:00:00.000Z", name: s.name, address: s.gAddr, reviews: { rating: s.rating, count: s.reviews }, description: s.desc, services: s.services });
  wp("captures/local/citations.json", s.cites.map(([directory, status, bing]) => ({ directory, status, capturedAt: "2026-11-12T09:30:00.000Z", ...(bing ? { address: s.bAddr } : {}) })));
  const url = (p, i) => `https://${p}.test/${s.key}${i}`;
  wp("research/social.json", { generatedAt: "2026-11-13T07:06:00.000Z", rows: s.social.map((p, i) => ({ platform: p, profileUrl: url(p, i) })), summary: { linksBroken: s.broken ? [url(s.social[0], 0), url(s.social[1], 1)] : [] } });
  wp("research/ads.json", { generatedAt: "2026-11-13T07:07:00.000Z", rows: s.rivals.slice(0, 2).map((r, i) => ({ advertiser: r.domain, library: "google-transparency", url: `https://ads.test/?preset-date=Last+30+days&d=${i}`, adCount: s.adCounts[i] })).concat(s.extraAd ? [{ advertiser: s.extraAd, library: "google-transparency", url: "https://ads.test/?preset-date=Last+30+days&d=9", adCount: 11 }] : []) });
  wp("research/competitors.json", { generatedAt: "2026-11-13T07:08:00.000Z", approvedRows: s.rivals.length, sites: s.rivals.map((r, i) => (r.status === 200 ? { domain: r.domain, status: 200, page: { words: s.rivalStats[i].words }, sitemap: { pages: s.rivalStats[i].sitemap } } : { domain: r.domain, status: r.status })) });
  wp("approved/competitors.json", { generatedAt: "2026-11-13T07:09:00.000Z", rows: [...s.rivals.map((r, i) => ({ domain: r.domain, name: r.name, note: r.note, kind: ["other", "other", "publisher"][i] })), { name: "Big Directory", domain: BIGDIR, kind: "publisher" }], excluded: [{ name: "Big Directory", domain: BIGDIR, reason: "a directory" }, { name: "Tools", domain: "tools.example.gov", reason: "x" }] });
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
    contact: "none", alsoSearchedAs: [s.nick], nameWord: "alder bay roofing", labels: { "roof repair": "Roof repair and patching" }, unconfirmedNames: [s.rivals[2].domain],
    words: { buyer: "homeowner", buyers: "homeowners", applicant: "caller", application: "quote form", apply: "ask for a quote", applies: "asks for a quote", pastCustomer: "happy customer", outcome: "jobs", offers: "emails", product: "job type", products: "job types", localRivals: "roofers", optionalNote: "with or without a second contact", otherKind: "another roofer", applying: "applying" },
    rivals: [{ domain: s.rivals[0].domain, name: null, type: "local roofer", group: "local" }, { domain: s.rivals[1].domain, name: "Harbor", type: "local gutter shop", group: "local" }, { domain: s.rivals[2].domain, name: null, type: "national roofer", group: "nat" }],
    adsFor: [s.rivals[0].domain, s.rivals[1].domain].concat(s.extraAd ? [s.extraAd] : []), linkPlace: "pinehollow-chamber.test", linkCompare: { group: "nat", label: "national roofers" },
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
const allRows = (tsv) => tsv.split("\n").slice(1).filter(Boolean).map((l) => l.split("\t"));
const sheetRows = (tsv) => allRows(tsv).filter((r) => r[7] !== "text"); // the drawn values and sums; the rows of kind text (a text the page prints from a file) have case 22
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
const copyWords = (edit) => { const d = path.join(tmp, `words-${++seq}`); fs.cpSync(path.join(skill, "client-copy"), d, { recursive: true }); edit(d); return d; };
const jedit = (d, f, fn) => { const p = path.join(d, f); const j = JSON.parse(fs.readFileSync(p, "utf8")); const r = fn(j); fs.writeFileSync(p, JSON.stringify(r === undefined ? j : r, null, 1)); };
const emptyOut = (r) => r.files.length === 0;
const norm = (r) => cleanText(r.html).replace(/\s+/g, " ");
const planRows = (html) => { const t = (html.match(/<table class="plan">[\s\S]*?<\/table>/) || [""])[0]; return [...t.matchAll(/<tr[^>]*>((?:(?!<\/tr>)[\s\S])*)<\/tr>/g)].map((m) => [...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((x) => x[1])).filter((c) => c.length); };

// ---------------------------------------------------------------- the cases
try {
  const a0 = A(), b0 = B();
  const runA = makeRun(a0), runB = makeRun(b0);
  const cA = clientFor(a0), cB = { contact: "none" };
  const rA = go(runA, { client: cA }), rB = go(runB, { client: cB });
  const fmtL = (x) => x.toLowerCase();

  check("case 1: A builds whole (exit 0, the two files, 8 sections, no undefined / NaN / null / [object / braces in the text)",
    ...T(() => { const bad = wholeChecks(rA, "A"); if (!rA.files.includes("Alder-website-review-2026-11-13.html") || !rA.files.includes("numbers-2026-11-13.tsv")) bad.push(`names ${rA.files}`); return [bad.length === 0, bad.join(" | ")]; }));

  check("case 2: B (client file: only contact) STOPs on page 6 (no rivalsLede) with one line and writes nothing; a business whose home city is the first of its area builds with that city",
    ...T(() => {
      const bad = []; if (!(rB.status === 1 && rB.stderr === "STOP: page 6, the lede: the client file has no rivalsLede" && emptyOut(rB))) bad.push(`B: ${rB.status} ${JSON.stringify(rB.stderr)} ${rB.files}`);
      const r2 = go(makeRun(A({ cities: ["Pine Hollow, WA", "Alder Bay, WA", "Stonebrook, WA"] })), { client: cA }); bad.push(...wholeChecks(r2, "A2"));
      const tx = norm(r2); if (!tx.includes("18 of 18 Pine Hollow spots where Google Maps puts you in its top three") || tx.includes("Alder Bay spots where Google Maps puts you in its top three")) bad.push("the home city is not the first of the area");
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 3: the sheet names the newest plain speed file and the last grid evidence path, not an older file",
    ...T(() => {
      const bad = [], s = a0;
      s.products.forEach((p, i) => { if (!hasRow(rA.tsv, `${s.grid[i][0].in3} of 9`, ".pewp/local/2026-11-13/grid.json", `solv[query=${p} ${s.home}]`)) bad.push(`tile of ${p} (the last evidence path, not the older grid)`); });
      const slow = go(makeRun({ ...A(), phone: 3920, desk: 2110 }), { client: cA });
      if (!(slow.status === 0 && hasRow(slow.tsv, "3.9", ".pewp/psi/2026-11-13.json", "pages[strategy=mobile].lcpMs"))) bad.push(`phone seconds: ${slow.status} ${slow.stderr}`);
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

  check("case 6: contact null = draft, \"none\" or a text = final and no contact line is printed; no key or \"\" = exit 2, nothing written",
    ...T(() => {
      const bad = [], run = makeRun(A());
      const d = go(run, { client: { ...cA, contact: null } }), n = rA, t = go(run, { client: { ...cA, contact: "hello@alder-bay-roofing.test" } });
      const noKey = go(run, { client: (() => { const c = { ...cA }; delete c.contact; return c; })() }), empty = go(run, { client: { ...cA, contact: "" } });
      if (!(d.status === 0 && d.files.includes("Alder-website-review-2026-11-13-draft.html") && /<title>[^<]*\(draft\)<\/title>/.test(d.html))) bad.push(`null: ${d.status} ${d.files}`);
      if (!(n.files.includes("Alder-website-review-2026-11-13.html") && !/\(draft\)/.test(n.html) && !n.html.includes('<p class="contact">'))) bad.push("none");
      if (!(t.status === 0 && !t.html.includes("hello@alder-bay-roofing.test") && !/-draft/.test(t.files.join()))) bad.push("text");
      for (const [nm, r] of [["no key", noKey], ["empty", empty]]) if (!(r.status === 2 && r.stderr.split("\n").length === 1 && r.stderr.startsWith("client-copy: ") && emptyOut(r))) bad.push(`${nm}: ${r.status} ${JSON.stringify(r.stderr)} ${r.files}`);
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 7: the how-we-work words are data: changed in a copy of client-copy/ they change in the HTML; the real file gives the four steps, goAhead and promise; a missing key STOPs",
    ...T(() => {
      const bad = [], tx = norm(rA), std = JSON.parse(fs.readFileSync(path.join(skill, "client-copy", "how-we-work.json"), "utf8"));
      for (const [, ti, te] of std.nextSteps) { if (!tx.includes(ti)) bad.push(`title ${ti}`); if (!tx.includes(te)) bad.push(`text of ${ti}`); }
      if (!tx.includes(std.goAhead)) bad.push("goAhead"); if (!tx.includes("We can't promise a position on Google or a number of jobs.")) bad.push("promise");
      const wd = copyWords((d) => jedit(d, "how-we-work.json", (j) => { j.goAhead = "Say go and we begin."; j.nextSteps[1][1] = "You review it"; }));
      const r = go(makeRun(A()), { client: cA, words: wd }), t2 = norm(r);
      if (!(r.status === 0 && t2.includes("Say go and we begin.") && t2.includes("You review it") && !t2.includes(std.goAhead) && !t2.includes("You take a look"))) bad.push(`changed: ${r.status} ${r.stderr}`);
      const rm = go(makeRun(A()), { client: cA, words: copyWords((d) => jedit(d, "how-we-work.json", (j) => { delete j.promise; })) });
      if (!(rm.status === 1 && rm.stderr === "STOP: how-we-work.json has no promise" && emptyOut(rm))) bad.push(`no promise: ${rm.status} ${JSON.stringify(rm.stderr)}`);
      const rd = go(makeRun(A()), { client: cA, words: copyWords((d) => jedit(d, "how-we-work.json", (j) => { delete j.draftContains; })) });
      if (!(rd.status === 1 && rd.stderr === "STOP: how-we-work.json has no draftContains as a list of 3 texts" && emptyOut(rd))) bad.push(`no draftContains: ${rd.status} ${JSON.stringify(rd.stderr)}`);
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 8: who and where-told are data; a row whose rule is false is absent and the headline counts the rows printed; an unknown placeholder and a row without `gets` STOP",
    ...T(() => {
      const bad = [], base = planRows(rA.html);
      if (!norm(rA).includes("11 fixes, in the order")) bad.push("headline is not 11 fixes");
      if (rA.html.includes("Speed up the phone page")) bad.push("the phone row is printed though the phone is not slow");
      if (base.length !== 11) bad.push(`rows ${base.length}`);
      const r = go(makeRun(A()), { client: cA, words: copyWords((d) => jedit(d, "plan.json", (j) => { j.find((x) => x.id === "analytics").who = "Whoever holds the keys"; })) }), mod = planRows(r.html), diff = [];
      base.forEach((row, i) => row.forEach((cell, k) => { if (mod[i] && mod[i][k] !== cell) diff.push(`${i}:${k}`); }));
      const at = base.findIndex((row) => /visitor counter/.test(row[1]));
      if (at < 0 || diff.join() !== `${at}:3` || !mod[at] || mod[at][3] !== "Whoever holds the keys") bad.push(`diff ${diff.join()} at ${at}`);
      const rn = go(makeRun(A()), { client: cA, words: copyWords((d) => jedit(d, "plan.json", (j) => { j[1].gets = j[1].gets + " {nope}"; })) });
      if (!(rn.status === 1 && /^STOP: plan\.json row \S+ names \{nope\}$/.test(rn.stderr) && emptyOut(rn))) bad.push(`nope: ${rn.status} ${JSON.stringify(rn.stderr)} ${rn.files}`);
      const rg = go(makeRun(A()), { client: cA, words: copyWords((d) => jedit(d, "plan.json", (j) => { delete j[0].gets; })) });
      if (!(rg.status === 1 && rg.stderr === "STOP: plan.json row 1 has no gets" && emptyOut(rg))) bad.push(`no gets: ${rg.status} ${JSON.stringify(rg.stderr)}`);
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 9: hand reads missing: no plan row and no sentence for them, no 'not read' line; with all five the rows are there",
    ...T(() => {
      const bad = [], hr = { ...cA.handReads }; delete hr.leadPath; delete hr.mail;
      const r = go(makeRun(A()), { client: clientFor(a0, { handReads: hr }) }); if (r.status !== 0) bad.push(`exit ${r.status} ${r.stderr}`);
      const t = norm(r), ta = norm(rA);
      for (const x of ["Ask for less in the first step of the", "Prove your email is yours"]) { if (t.includes(x)) bad.push(`printed without its hand read: ${x}`); if (!ta.includes(x)) bad.push(`missing with all five: ${x}`); }
      if (/Today it asks \d+ to \d+ fields/.test(t)) bad.push("the fields sentence is printed"); if (/Not read in this review/.test(ta)) bad.push("a not-read line is printed");
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 10: a paid row of the map list is not among the rivals with more reviews; the sentence's two numbers are asserted",
    ...T(() => {
      const s = A(), sentence = `2 of the 3 businesses in Maps' top three around ${s.home} show more reviews than your ${fmt(a0.reviews)}.`; return [norm(rA).includes(sentence), `missing: ${sentence}`];
    }));

  check("case 11: a finding that does not hold, or a missing client word, STOPs the build with one line and writes nothing",
    ...T(() => {
      const bad = [], line = (r, l) => { if (!(r.status === 1 && r.stderr === l && emptyOut(r))) bad.push(`${l.slice(0, 40)}: ${r.status} ${JSON.stringify(r.stderr).slice(0, 120)} ${r.files}`); };
      line(go(makeRun({ ...A(), body: "<html><body><p>Roofs of every kind</p></body></html>" }), { client: cA }), "STOP: page 3, the first thing your site sends is a blank page: the home page's first response holds words");
      line(go(makeRun({ ...A(), book: { D8: "PARTLY" } }), { client: cA }), "STOP: page 8, what is in the draft: the product book rows of alert do not all read WORKS");
      line(go(makeRun(A()), { client: (() => { const c = { ...cA }; delete c.rivalsLede; return c; })() }), "STOP: page 6, the lede: the client file has no rivalsLede");
      line(go(makeRun(A()), { client: (() => { const c = { ...cA }; delete c.rivals; return c; })() }), "STOP: page 6, the headline names two Alder Bay rivals: the client file marks 0 rivals as group local");
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
  check("case 14: an address is cut only before \", <home city>\" (a line that names no city stays whole); the sheet labels name the sources",
    ...T(() => {
      const bad = [], rows = (r) => sheetRows(r.tsv);
      if (!rows(rA).some((x) => x[1] === "address shown, Your website and Google Maps")) bad.push("the sheet label changed");
      const r = go(makeRun({ ...A(), gAddr: "14 Cedar Row, Ste 4, Alder Bay, WA 00000", fAddr: "31 Quarry Lane, Ste B2 #111" }), { client: cA }); if (r.status !== 0) bad.push(`exit ${r.status} ${r.stderr}`);
      if (!rows(r).some((x) => x[1] === "address shown, State filing" && x[2] === "31 Quarry Lane, Ste B2 #111")) bad.push("the filing line is not whole");
      if (!rows(r).some((x) => x[1] === "address shown, Google Maps" && x[2] === "14 Cedar Row, Ste 4")) bad.push("the profile address");
      if (!rows(r).some((x) => x[3].endsWith("filing.md") && x[2] === "31 Quarry Lane, Ste B2 #111" && x[5] === "31 Quarry Lane, Ste B2 #111")) bad.push("the sheet's value there");
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 16: the directories follow the order of directories.json (the others after, in the capture file's order), in the page 5 fix and in the plan row",
    ...T(() => {
      const bad = [];
      const cites = [["manta.com", "not listed"], ["zzz-local.test", "not listed"], ["yelp.com", "listed"], ["apple.com (Apple Maps)", "not listed"], ["bing.com (Bing Places)", "listed", true]];
      const r = go(makeRun({ ...A(), cites }), { client: cA });
      if (r.status !== 0) bad.push(`exit ${r.status} ${r.stderr}`);
      const n = norm(r).split("claim Apple Maps, Manta and zzz-local").length - 1; if (n !== 2) bad.push(`the claim clause is in ${n} places, expected 2 (page 5 fix and plan row)`);
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 17: every printed row of the plan has at least one sheet row of its own on page 7",
    ...T(() => {
      const bad = [];
      const all = JSON.parse(fs.readFileSync(path.join(skill, "client-copy", "plan.json"), "utf8"));
      for (const row of all.filter((x) => x.id !== "speed")) {
        const wd = copyWords((d) => jedit(d, "plan.json", () => [row]));
        const r = go(makeRun(A()), { client: cA, words: wd });
        if (r.status !== 0) { bad.push(`${row.id}: exit ${r.status} ${r.stderr}`); continue; }
        if (planRows(r.html).length !== 1) bad.push(`${row.id}: printed ${planRows(r.html).length} rows`);
        else if (!sheetRows(r.tsv).some((x) => x[0] === "7" && x[1] !== "number of fixes" && x[1] !== "fixes")) bad.push(`${row.id}: no sheet row of its own on page 7`);
      }
      return [bad.length === 0, bad.join(" | ")];
    }));
  check("case 18: a row of the plan whose finding does not hold is left out (no broken link, a fast phone); the rows that hold are there; the headline counts them",
    ...T(() => {
      const bad = [], r = go(makeRun({ ...A(), broken: false, phone: 2210 }), { client: cA });
      bad.push(...wholeChecks(r, "C"));
      const rows = planRows(r.html), fixes = rows.map((x) => x[1]), has = (start) => fixes.some((f) => f.startsWith(start));
      for (const start of ["Fix the link to your site on", "Speed up the phone page"]) if (has(start)) bad.push(`printed though its finding does not hold: ${start}`);
      for (const start of ["Send the words of every public page", "Add a visitor counter", "Ask for less in the first step", "Build the gutter installation page", "Build the other 1 job type pages", "One address everywhere", "Prove your email is yours", "Publish your company history", "Join the Alder Bay chambers", "Name your 3 profiles"]) if (!has(start)) bad.push(`missing though its finding holds: ${start}`);
      if (rows.length !== 10 || !norm(r).includes("10 fixes, in the order")) bad.push(`rows ${rows.length}`);
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
  check("case 20: a rival with no Google ad library row (Meta only) is left out of the ads sentence and never stops the build",
    ...T(() => {
      const bad = [];
      const metaOnly = (j) => { j.rows[0].library = "meta-ad-library"; };
      const r = go(makeRun({ ...A(), patch: { "research/ads.json": metaOnly } }), { client: cA });
      bad.push(...wholeChecks(r, "A"));
      const text = cleanText(r.html), sentence = (text.match(/ad library shows [^.]*\./) || [""])[0];
      if (!text.includes("ad library shows none for Harbor in the last 30 days")) bad.push(`sentence: ${sentence || "(none)"}`);
      if (sentence.includes("Ridgeline Roofs")) bad.push(`the rival with no Google row is named: ${sentence}`);
      return [bad.length === 0, bad.join(" | ")];
    }));
  check("case 21: the gates run before anything is written: a how-we-work text that makes the copy print a contact line, a number past the sheet or a banned word stops the build with ONE gate line and writes nothing",
    ...T(() => {
      const bad = [];
      for (const [goAhead, re] of [["We start in 7391 days, call 555-0100.", /^STOP: gate contact line: page 8 prints "555-0100"$/], ["We start in 7391 days.", /^STOP: gate numbers: page 8 prints 7391 and no printed cell of page 8 of the sheet holds it$/], ["The next step is pending.", /^STOP: gate internal words: page 8 prints "pending"$/]]) {
        const r = go(makeRun(A()), { client: cA, words: copyWords((d) => jedit(d, "how-we-work.json", (j) => { j.goAhead = goAhead; })) });
        if (!(r.status === 1 && re.test(r.stderr) && emptyOut(r))) bad.push(`${goAhead}: ${r.status} ${JSON.stringify(r.stderr)} ${r.files}`);
      }
      return [bad.length === 0, bad.join(" | ")];
    }));
  check("case 22: a number inside every text a page draws from a file builds through the gates, and each such text has a sheet row of kind text on the page that prints it (a title, a domain, a name, a question, a city, a product, a directory)",
    ...T(() => {
      const bad = [], ad = AD(), r = go(makeRun(ad), { client: clientFor(ad) });
      if (r.status !== 0) return [false, `exit ${r.status}: ${r.stderr}`];
      const rows = allRows(r.tsv), secs = r.html.match(/<section\b[\s\S]*?<\/section>/g) || [];
      const text = (i) => cleanText(secs[i - 1].replace(/<svg[\s\S]*?<\/svg>/g, " ")).replace(/\s+/g, " ");
      for (const x of rows.filter((y) => y[7] === "text")) if (x.length !== 8 || x.some((c) => c === "")) bad.push(`an empty cell in the text row ${JSON.stringify(x)}`);
      const pages = secs.map((_, i) => i + 1);
      for (const n of ad.dxUsed) for (const p of pages) { // each place a number is printed has its own row: as many text rows hold it as the page prints it
        const re = new RegExp(`(?<![\\d.,])${n}(?![\\d])`), occ = (text(p).match(new RegExp(re.source, "g")) || []).length;
        const have = rows.filter((x) => x[0] === String(p) && x[7] === "text" && re.test(x[2])).length;
        if (occ !== have) bad.push(`${n} is printed ${occ} times on page ${p} and ${have} text rows of page ${p} hold it`);
      }
      const per = pages.map((p) => rows.filter((x) => x[0] === String(p) && x[7] === "text").length);
      if (per.slice(1).filter((c) => c > 0).length < 5) bad.push(`text rows per page: ${per.join(" ")}`);
      return [bad.length === 0, bad.join(" | ")];
    }));

  // ---------------------------------------------------------------- job F1: the sentences that printed false with no stop (every case runs the COMMAND on a made-up run on disk)
  const SENT21 = [
    ["p1-shown-your-site", "Buyers who search for what you sell are shown your site."], ["p2-headline-stars-only", "You have {rating} stars, and still {x} of {y} {product} searches show you."],
    ["p2-headline-chatgpt-only", "You have answers in ChatGPT, and still {x} of {y} {product} searches show you."], ["p2-headline-not-few", "You have {rating} stars and answers in ChatGPT, and {x} of {y} {product} searches show you."],
    ["p2-headline-no-first-part", "{x} of {y} {product} searches show you."], ["p2-perplexity-half", "Perplexity names you on {x} of {n} questions."],
    ["p3-headline-none-is-you", "For \"{q}\", none of the {m} results below is you."], ["p3-headline-among", "For \"{q}\", your site is among the {m} results below."],
    ["p3-fix-list-only", "Give Google a list of your pages. Today the list is a copy of your home page. The site we draft has one."], ["p3-fix-address-only", "Give Google a real \"page not found\". Today a wrong address does not say \"page not found\". The site we draft has one."],
    ["p5-headline-one-city", "On Google Maps you are in the top three at {x} of {y} {home} spots."], ["p5-fix-one-directory", "Fill in your Google profile and claim {name}. You are listed on Bing Places."],
    ["p5-fix-bing-not-listed", "You are listed on none of those {n}."], ["p5-fix-and-more", "Fill in your Google profile and claim {names} and {n} more."],
    ["p6-headline-two-named", "{first rival} and {second rival} send {a} and {b} words and have {c} and {d} sites linking to them. You send {x}."], ["p6-headline-one-named", "{first rival} sends {a} words and has {c} sites linking to it. You send {x}."],
    ["p7-build-top-only", "Build the {top} page."], ["p7-page-for-top", "A page for {top product}: {s}% of your demand."], ["p7-some-linked", "Today {x} of {n} are linked."],
    ["rb-one-fix", "{n} fix, in the order that decides whether a {buyer} finds you and {applies}."], ["rb-one-address", "{n} address for one business"],
  ];
  const branchesWords = (sents) => copyWords((d) => jedit(d, "other-branches.json", () => ({ note: "made up", sentences: sents.map(([id, text]) => ({ id, page: 0, text })) })));

  check("case 23: a rating under the line builds and says nothing about stars (no stars clause, no 'easy to trust', no rating item, no sheet row for it, no 4.0 printed); 4.0 and 4.8 keep today's sentences",
    ...T(() => {
      const bad = [], head = (r) => norm(r);
      const low = go(makeRun(A({ rating: 3.7 })), { client: cA });
      if (low.status !== 0) bad.push(`3.7: exit ${low.status} ${low.stderr}`);
      else {
        const t = head(low);
        if (/3\.7|\b4\.0\b/.test(t)) bad.push("a rating figure is printed at 3.7");
        if (!t.includes("You have answers in ChatGPT, and still 0 of 12 job type searches show you.")) bad.push("the headline of 3.7");
        if (t.includes("easy to trust")) bad.push("the lede is printed at 3.7");
        if (t.includes("Google rating")) bad.push("the rating item is printed at 3.7");
        if (allRows(low.tsv).some((x) => x[0] === "2" && (x[2] === "3.7" || ["rating", "Google rating", "Google reviews"].includes(x[1])))) bad.push("a sheet row of the rating at 3.7");
        bad.push(...wholeChecks(low, "3.7"));
      }
      for (const rt of [4.0, 4.8]) {
        const r = go(makeRun(A({ rating: rt })), { client: cA });
        if (r.status !== 0) { bad.push(`${rt}: exit ${r.status} ${r.stderr}`); continue; }
        const t = head(r), f = rt.toFixed(1);
        if (!t.includes(`You have ${f} stars and answers in ChatGPT, and still 0 of 12 job type searches show you.`)) bad.push(`headline at ${f}`);
        if (!t.includes("You are easy to trust and hard to find.")) bad.push(`lede at ${f}`);
        if (!t.includes(`${f} Google rating, from`)) bad.push(`item at ${f}`);
      }
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 24: a plan of one row says '1 fix' and has no lede, a plan of two says '2 fixes' with its lede, a plan with no row at all STOPs with one line and writes nothing",
    ...T(() => {
      const bad = [], plan = (n) => go(makeRun(A()), { client: cA, words: copyWords((d) => jedit(d, "plan.json", (j) => j.slice(0, n))) });
      const one = plan(1), two = plan(2), none = plan(0);
      const t1 = one.status === 0 ? norm(one) : "", t2 = two.status === 0 ? norm(two) : "";
      if (one.status !== 0) bad.push(`one row: exit ${one.status} ${one.stderr}`);
      else { if (!t1.includes("1 fix, in the order that decides whether a homeowner finds you and asks for a quote.")) bad.push("one row: the headline"); if (t1.includes("Start at the top")) bad.push("one row: the lede"); if (/1 fixes/.test(t1)) bad.push("one row: 1 fixes"); }
      if (two.status !== 0) bad.push(`two rows: exit ${two.status} ${two.stderr}`);
      else if (!t2.includes("2 fixes, in the order that decides whether a homeowner finds you and asks for a quote.") || !t2.includes("Start at the top. Each line says what you get.")) bad.push("two rows: headline or lede");
      if (!(none.status === 1 && none.stderr === "STOP: page 7, the plan: no fix holds for this run" && emptyOut(none))) bad.push(`no row: ${none.status} ${JSON.stringify(none.stderr)} ${none.files}`);
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 25: page 7 row 'Build the {top} page first, then {second}.' says only 'Build the {top} page.' when the second product has a page; row 'Build the other N pages' counts only the products past the top two that have no page, 'Today they list' counts those that have one, and the row is left out when there is none",
    ...T(() => {
      const bad = [], four = (missing) => go(makeRun(A({ products: ["roof repair", "roof replacement", "gutter installation", "chimney cleaning"], missing })), { client: cA });
      const a = four(["chimney cleaning", "roof repair"]), b = four(["chimney cleaning", "roof replacement", "roof repair"]), c = four(["chimney cleaning"]), d = four(["chimney cleaning", "gutter installation"]), e = four(["chimney cleaning", "gutter installation", "roof repair"]);
      const tx = (r, who) => { if (r.status !== 0) { bad.push(`${who}: exit ${r.status} ${r.stderr}`); return ""; } return norm(r); };
      const ta = tx(a, "a"), tb = tx(b, "b"), tc = tx(c, "c"), td = tx(d, "d"), te = tx(e, "e");
      if (ta) { if (!ta.includes("Build the chimney cleaning page.") || ta.includes("page first, then")) bad.push("a: the top-only sentence"); if (!ta.includes("Build the other 1 job type pages, each with a Alder Bay line.") || !ta.includes("Today they list 1.")) bad.push("a: the other pages row"); }
      if (tb) { if (!tb.includes("Build the other 2 job type pages") || !tb.includes("Today they list none.")) bad.push("b: the other pages row"); }
      if (tc) { if (tc.includes("Build the other") || tc.includes("A page that Google and Bing can list for each job type")) bad.push("c: the other pages row is not left out"); if (!tc.includes("Build the chimney cleaning page.")) bad.push("c: the top-only sentence"); }
      if (td) { if (!td.includes("Build the chimney cleaning page first, then gutter installation.") || td.includes("Build the chimney cleaning page.")) bad.push("d: the two-page sentence is not today's"); if (td.includes("Build the other")) bad.push("d: the other pages row is not left out"); }
      if (te) { if (!te.includes("Build the chimney cleaning page first, then gutter installation.")) bad.push("e: the two-page sentence"); if (!te.includes("Build the other 1 job type pages, each with a Alder Bay line.") || !te.includes("Today they list 1.")) bad.push("e: the other pages row"); }
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 26: a count of one is written with its singular noun: '1 profile' on page 4 and in the plan row, '1 place worth asking' on page 6 (a count of two or more keeps today's plural)",
    ...T(() => {
      const bad = [], s = A({ social: ["instagram"], sameAs: 0, broken: false });
      s.pursue = 1; s.chambers = 1;
      const r = go(makeRun(s), { client: cA });
      if (r.status !== 0) return [false, `exit ${r.status} ${r.stderr}`];
      const t = norm(r);
      if (!t.includes("Link your 1 profile in the company details your site gives Google.") || /1 profiles/.test(t)) bad.push("page 4 profile");
      if (!t.includes("Name your 1 profile in the company details your site gives Google.")) bad.push("plan row profile");
      if (!t.includes("We found 1 place worth asking, 1 of them chambers of commerce.") || /1 places/.test(t)) bad.push("page 6 place");
      const m = go(makeRun(A()), { client: cA }), tm = m.status === 0 ? norm(m) : "";
      if (!tm.includes("Link your 3 profiles in the company details") || !tm.includes("Name your 3 profiles in the company details") || !/We found [\d,]+ places worth asking/.test(tm)) bad.push("plural kept");
      return [bad.length === 0, bad.join(" | ")];
    }));

  check("case 27: the wording of the other branches is data: client-copy/other-branches.json is read by the command (missing: STOP, a sentence the page needs and the file lacks: STOP) and the new-words gate stops a sentence with a word the approved print does not use, passes the same word inside braces, passes a plural or singular of an approved word, and passes the 21 sentences of the lead's list",
    ...T(() => {
      const bad = [], line = (r, l, who) => { if (!(r.status === 1 && r.stderr === l && emptyOut(r))) bad.push(`${who}: ${r.status} ${JSON.stringify(r.stderr).slice(0, 140)} ${r.files}`); }, ok = (r, who) => { if (r.status !== 0) bad.push(`${who}: exit ${r.status} ${r.stderr}`); };
      const noFile = copyWords((d) => fs.rmSync(path.join(d, "other-branches.json")));
      line(go(makeRun(A()), { client: cA, words: noFile }), "STOP: other-branches.json is missing", "no file");
      const noWords = copyWords((d) => fs.rmSync(path.join(d, "approved-words.json")));
      line(go(makeRun(A()), { client: cA, words: noWords }), "STOP: approved-words.json is missing", "no word list");
      const lacks = copyWords((d) => { jedit(d, "other-branches.json", (j) => { j.sentences = j.sentences.filter((x) => x.id !== "rb-one-fix"); }); jedit(d, "plan.json", (j) => j.slice(0, 1)); });
      line(go(makeRun(A()), { client: cA, words: lacks }), "STOP: other-branches.json has no sentence rb-one-fix", "a sentence the page needs");
      line(go(makeRun(A()), { client: cA, words: branchesWords([["x-bad", "You have zebras and {zebra} stars."]]) }), "STOP: gate new words: \"zebras\" in x-bad is not a word of the approved print", "a new word");
      ok(go(makeRun(A()), { client: cA, words: branchesWords([["x-braces", "You have {zebras} and {zebra} stars."], ["x-plural", "You have {rating} star."]]) }), "braces and plural");
      line(go(makeRun(A()), { client: cA, words: branchesWords([["a1", "Zebra horse."], ["a2", "Camel."], ["a3", "Llama."], ["a4", "Goat."], ["a5", "Sheep."], ["a6", "Mule."]]) }), "STOP: gate new words: \"zebra\" in a1, \"horse\" in a1, \"camel\" in a2, \"llama\" in a3 and 3 more are not words of the approved print", "several new words");
      ok(go(makeRun(A()), { client: cA, words: branchesWords(SENT21) }), "the 21 sentences");
      const real = go(makeRun(A()), { client: cA }); ok(real, "the real file");
      const REAL = JSON.parse(fs.readFileSync(path.join(skill, "client-copy", "other-branches.json"), "utf8"));
      if (!REAL.sentences.every((x) => typeof x.id === "string" && typeof x.text === "string")) bad.push("the real file's shape");
      return [bad.length === 0, bad.join(" | ")];
    }));
} catch (e) {
  check("test harness ran to the end", false, e.stack || e);
}
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((f) => f.name).join(" | ") : ""}`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
