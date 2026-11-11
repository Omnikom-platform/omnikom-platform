// Usage: node mutants-research.mjs [--only <name substring>[|<another>]] [--jobs 3]
// Watched-fail for test-research.mjs (CLAUDE.md Rule 2): for every mutant, copy the scripts to a temp folder, break ONE thing the test
// claims to guard (the patch asserts its target text exists exactly once, so "the patch never applied" cannot pass as green), run the
// test against the copy, and require that the NAMED check goes red. Baseline (unmutated copy) must be all green first.
// Exit 0 = baseline green and every mutant killed by its named check; 1 otherwise.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const jobs = args.includes("--jobs") ? Number(args[args.indexOf("--jobs") + 1]) : 3;
// What the copy needs is COMPUTED, never listed by hand: a hand list missed measure-sources.mjs once authority.mjs imported it, the
// baseline copy crashed on the missing import and 0 of 76 mutants ran. Seeds = test-research.mjs, every script it names (it starts them
// by file name), and the script families it runs; then every relative import of those, transitively (static `import ... from "./x"`,
// `export ... from "./x"`, bare `import "./x"` and literal `import("./x")`). An import that leaves this folder or names a file that does
// not exist stops the run with the importing file and the missing name, before any mutant runs.
const SEED_FAMILIES = /^(research|intake)[\w-]*\.mjs$/;
function neededFiles(dir, seeds) {
  const need = new Set(), queue = [...seeds], missing = [];
  while (queue.length) {
    const f = queue.shift();
    if (need.has(f)) continue;
    need.add(f);
    const src = fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"); // comments hold usage examples, not imports
    const specs = [...src.matchAll(/(?:^|[\s;])(?:import|export)\s[^"'`;]*?\bfrom\s*["']([^"']+)["']|(?:^|[\s;])import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gm)].map((m) => m[1] || m[2] || m[3]);
    for (const s of specs) {
      if (!/^\.\.?\//.test(s)) continue; // node: built-ins and packages
      const target = path.relative(dir, path.resolve(dir, s));
      if (target.includes(path.sep) || target.startsWith("..") || !fs.existsSync(path.join(dir, target))) { missing.push(`${f} imports "${s}"`); continue; }
      queue.push(target);
    }
  }
  if (missing.length) throw new Error(`the copy for the mutants cannot be built: ${missing.join("; ")} (not a file in ${dir})`);
  return [...need].sort();
}
const seedFiles = () => {
  const names = new Set(["test-research.mjs"]);
  for (const m of fs.readFileSync(path.join(here, "test-research.mjs"), "utf8").matchAll(/\b([a-z][\w-]*\.mjs)\b/g)) if (fs.existsSync(path.join(here, m[1]))) names.add(m[1]);
  for (const f of fs.readdirSync(here)) if (SEED_FAMILIES.test(f)) names.add(f);
  names.delete("mutants-research.mjs"); // this harness (test-research names it in a comment) is not part of what the test runs
  return [...names];
};
let NEEDED;
try { NEEDED = neededFiles(here, seedFiles()); } catch (e) { console.log(`BASELINE NOT GREEN: ${e.message}`); process.exit(1); }

// [name, file, from, to, the check that must go red (substring)]
const M = [
  ["lib: overlap threshold 0.8 -> 0.5", "research-lib.mjs", "queryOverlap(a, b) >= 0.8", "queryOverlap(a, b) >= 0.5", "lib: 80% token overlap"],
  ["kwp: ranges no longer flagged estimate", "research-kwp.mjs", "const isRange = r.range && r.range.lo !== r.range.hi;", "const isRange = false;", "kwp: UTF-16 export parsed"],
  ["kwp: no-volume row filled with 0", "research-kwp.mjs", "{ ...notMeasured(`Keyword Planner gave no volume for this row (\"${r.rawVolume}\")`), cacheFile: copy }", "f(0)", "kwp: a row without a volume stays null"],
  ["bing: call budget not enforced", "research-bing.mjs", "if (calls >= maxCalls) return null;", "if (false) return null;", "bing: the call budget is a hard stop"],
  ["gsc: a missing token no longer blocks", "lib-google-auth.mjs", "if (!t) throw new GoogleAuthBlocked(\"no-token\", `no token file at ${file} and no service account set`);", "if (!t) return { token: \"x\", source: \"token-file\", expiresAt: null };", "gsc: no token file => BLOCKED"], // the token code lives in lib-google-auth.mjs since G12
  ["gsc: positions not rounded to whole places", "research-gsc.mjs", "position: f(Math.max(1, Math.round(x.position))", "position: f(Math.round(x.position * 10) / 10", "contract: every Search Console row is a valid ranking row"],
  ["wiki: a 404 is treated as a failure", "research-wiki.mjs", "if (r.status === 404) {", "if (false) {", "wiki: average monthly views"],
  ["forums: keeps going after a 429", "research-forums.mjs", "stoppedBy = `HTTP ${r.status} on \"${q}\"`; break; }", "stoppedBy = `HTTP ${r.status} on \"${q}\"`; continue; }", "forums: the FIRST 429 stops the run"],
  ["serp: 'localized' claimed from the parameter alone", "research-serp-import.mjs", "const localized = !!(reqCity && loc.footer && loc.footer.toLowerCase().includes(reqCity));", "const localized = !!reqCity;", "serp: localized only when the footer shows the city"],
  ["serp: a capture without a device is accepted", "research-serp-import.mjs", "if (![\"mobile\", \"desktop\"].includes(cap.device)) why.push(", "if (false) why.push(", "serp: a capture with no device"],
  ["serp: a robot check is recorded as results", "research-serp-import.mjs", "if (cap.robotCheck) { cap.status = \"BLOCKED\"; }", "if (false) { cap.status = \"BLOCKED\"; }", "serp: a robot-check capture is recorded BLOCKED"],
  ["cluster: the overlap threshold is one too low (3 shared results merge)", "lib-growth.mjs", "if (n >= overlap) {", "if (n >= overlap - 1) {", "cluster: another place with its own results"],
  ["cluster: any overlap merges", "lib-growth.mjs", "if (n >= overlap) {", "if (n >= 0) {", "cluster: unrelated searches stay apart"],
  ["cluster: a query without a capture no longer joins by head term", "lib-growth.mjs", "const home = headIndex.get(headOf(r.query));", "const home = null;", "cluster: a query with no capture joins"],
  ["cluster: the head-term join ignores the place (a Manteca query joins Tracy)", "research-cluster.mjs", "|${[...new Set([...placesIn(q, { locale }), placeInQuery(q, places)?.label?.toLowerCase()].filter(Boolean))].sort().join(\",\")}`", "`", "cluster: a query with no capture does not join the cluster of another place"],
  ["targets: an existing page is matched without the plan's CTA", "research.mjs", "clicks: (p) => clicksByPath.get(p.path) || 0, cta: true }", "clicks: (p) => clicksByPath.get(p.path) || 0, cta: false }", "targets.json: an existing plain page is the target of a TRANSACTIONAL cluster"],
  ["competitors: a 429 does not stop the site", "research-competitors.mjs", "if (ref || (challenge && kind === \"html\")) halted.set(host, res.status);", "if (false) halted.set(host, res.status);", "competitors: the first 429 stops that site"],
  ["competitors: robots.txt not obeyed", "research-competitors.mjs", "if (!pathAllowed(rb0.groups, CRAWL_UA, base.pathname || \"/\"))", "if (false)", "competitors: robots.txt is obeyed"],
  ["competitors: the cache is never used", "research-competitors.mjs", "if (c.refusal ? age < 1 : age < 7) {", "if (false) {", "competitors: a re-run is served from the cache"],
  ["competitors: the old 1 s pace per site", "research-competitors.mjs", "export const SITE_GAP_MS = 4000;", "export const SITE_GAP_MS = 1000;", "competitors: a site is read at most one request every 4 s"],
  ["competitors: a fetch is paced by a literal 1 s, not the constant", "research-competitors.mjs", "  await pace(url, SITE_GAP_MS);", "  await pace(url, 1000);", "competitors: a site is read at most one request every 4 s"],
  ["competitors: audited sites taken from SERP captures by default", "research.mjs", "competitorsFromSerp: a.has(\"from-serp\")", "competitorsFromSerp: true", "guard: nothing in this whole test left the machine"],
  ["ai: citedShare taken from the last run only", "research-ai.mjs", "citedShare: f(cites / g.runs.length, {", "citedShare: f(g.runs.at(-1).ourDomainCited ? 1 : 0, {", "ai: the question is asked N times"],
  ["ai: raw Gemini answer stored", "research-ai.mjs", "doc.runs.push({ question, run: n, model, at: iso(), prompt: question,", "doc.runs.push({ raw: text, question, run: n, model, at: iso(), prompt: question,", "ai: the raw Gemini answer is never stored"],
  ["ai: paid runs asked again", "research-ai.mjs", "ageDays(r.at) < maxAgeDays)) continue;", "ageDays(r.at) < -1)) continue;", "ai: runs already paid for are not asked again"],
  ["ai: Gemini runs without the owner's terms acknowledgement", "research-ai.mjs", "if (process.env.PEWP_GEMINI_TERMS_ACK !== \"1\") throw new Blocked(UNBLOCK_TERMS);", "", "ai: Gemini is BLOCKED until the owner acknowledges its terms"],
  ["ai: samples 13 s apart (06 9.6 wants 60)", "research-ai.mjs", "export const GEMINI_GAP_MS = 60000;", "export const GEMINI_GAP_MS = 13000;", "ai: Gemini samples are spaced at least 60 s apart"],
  ["ai: measure's citedDomains captures read as zero citations", "research-ai.mjs", "(Array.isArray(c.citedDomains) ? c.citedDomains : c.sources || [])", "(c.sources || [])", "ai: an owner capture in measure's citedDomains form"],
  ["gsc: an expired token (expiry form) is sent as is", "lib-google-auth.mjs", "const exp = t.expiry_date ?? t.expiry;", "const exp = t.expiry_date;", "gsc: an expired token (measure's `expiry` form) is refreshed"],
  ["ai: an owner capture without a date is accepted", "research-ai.mjs", "if (!c.capturedAt || Number.isNaN(Date.parse(c.capturedAt))) why.push(\"no capture date\");", "", "ai: a capture without a date is rejected"],
  ["existing: nothing is ever stale", "research-existing.mjs", "stale: ageDays(updated) > maxAgeDays", "stale: false", "existing: keyword map imported with its date; stale flagged"],
  ["existing: a keyword with no tier becomes volume 0","research-existing.mjs","{ ...notMeasured(ntext || \"the imported keyword map carries no search volume\"), cacheFile: file }","{ value: 0, source: \"imported\", fetchedAt: new Date().toISOString(), cacheFile: file }","existing: a keyword with no tier stays null"],
  ["research: volumes invented for unmeasured searches", "research.mjs", "const clusters = built.filter((c) => !noDemand(c)), unmeasured", "const clusters = built.map((c) => (noDemand(c) ? { ...c, volume: { ...c.volume, value: 100, source: \"guess\" } } : c)), unmeasured0 = [], unmeasured", "targets.json: a search no source has a number for is LISTED"],
  ["research: two clusters may share one page", "research.mjs", "if (taken.has(key)) {", "if (false) {", "targets.json: one cluster = one page"],
  ["research: BLOCKED steps hide what unblocks them", "research.mjs", "| ${s.unblock || s.error || \"\"} |`);", "| |`);", "research: BLOCKED steps are listed with what unblocks them"],
  ["research: near-duplicate primary queries pass the gate", "research.mjs", "&& sameQuery(prim[i], prim[j])", "&& false", "gate: near-identical primary queries"],
  ["research: a bare number passes the gate", "research.mjs", "const isFact = (f) => f && typeof f === \"object\" && \"value\" in f && f.source && f.fetchedAt && \"cacheFile\" in f;", "const isFact = (f) => true;", "gate: a bare number (no source) is an error"],
  ["intake: goals no longer required", "intake.mjs", "if (!b.goals.length) missing.push(\"goals\");", "", "intake: what only the owner knows is asked"],
  ["intake: invalid answers accepted", "intake.mjs", "if (badGoals.length) invalid.push(", "if (false) invalid.push(", "intake: an answer outside the allowed set is rejected"],
  ["intake: preview hosts reported live", "intake.mjs", "const preview = PREVIEW_HOST.test(loc.host) || get(\"_noindex\") === true;", "const preview = false;", "intake: a preview host / noindex site is launchState preview"],
  ["existing: tiers ignored (everything NOT MEASURED)","research-existing.mjs","export function tierVolume(cell, file, st, line) {","export function tierVolume(cell, file, st, line) { return null;","existing: a Bing-autocomplete tier becomes a sourced ESTIMATE"],
  ["existing: a cell naming several tiers counts at its strongest","research-existing.mjs","(TIER_RANK[t] < TIER_RANK[lo] ? t : lo)","(TIER_RANK[t] > TIER_RANK[lo] ? t : lo)","existing: a keyword with no tier stays null"],
  ["existing: the sources: front matter is not followed","research-existing.mjs","function followSources(file, text, found) {","function followSources(file, text, found) { return;","existing: follows the sources: front matter"],
  ["universe: a measured 0 still wins over the tier","research-cluster.mjs","order.find((s) => row.volumes[s]?.value != null && row.volumes[s].value !== 0) || ","","volume: a measured 0 yields to the autocomplete tier"],
  ["volume: a measured 0 ranks as measured demand","research-cluster.mjs","(v.value > 0 ? [2, v.value] : [0.5, 0])","[2, v.value]","volume: ranking is measured >0, then a tier estimate"],
  ["universe: a tier estimate beats a measured volume","research-cluster.mjs","const order = [\"kwp\", \"bing\", \"gsc\", \"autocomplete\", \"existing\"];","const order = [\"existing\", \"autocomplete\", \"kwp\", \"bing\", \"gsc\"];","targets.json: a measured volume (Keyword Planner 320) always beats the tier"],
  ["research: tier clusters not named in report.md","research.mjs","if (tier.length) L.push(\"\", `**Clusters resting on a tier estimate","if (false) L.push(\"\", `**Clusters resting on a tier estimate","targets.json: report.md and summary.json name the clusters that rest on a tier estimate"],
  ["intake: entities left in URLs","intake.mjs",".map((m) => decode(m[1])).filter((u) => /^https?:/i.test(u));",".map((m) => m[1]).filter((u) => /^https?:/i.test(u));","intake: HTML entities in links are decoded"],
  ["serp: duplicate captures counted twice","research-serp-import.mjs","if (seen.has(k)) continue; seen.add(k); unique.push(c);","unique.push(c);","serp: the same capture saved in two folders counts once"],
  ["serp: legacy captures need --device","research-serp-import.mjs","defaultDevice: defaultDevice || (legacy ? \"desktop\" : null)","defaultDevice: defaultDevice","serp: legacy text captures need no --device"],
  ["cluster: domain-only captures treat every domain as a portal","research-cluster.mjs","portals.includes(o.domain) ? `${o.domain}|","true ? `${o.domain}|","cluster: legacy captures that hold only domains still cluster"],
  ["gate: two cities with the same words flagged as cannibalisation","research.mjs","(cls[i].location ?? null) === (cls[j].location ?? null) &&","true &&","gate: the same words for two different cities"],
  ["lib: unknown cities not inferred","research-lib.mjs","  if (!names.length) return null;","  return null;","lib: a city the lists do not know is inferred"],
  ["research: a page about another city is the target page","research.mjs","(placeInQuery(q, places)?.label || null) === (placeInQuery(text, places)?.label || null)","true","research: a page about another city is not the target page"],
  ["lib: slug may end on a hyphen","research-lib.mjs",".slice(0, 60).replace(/-+$/g, \"\")",".slice(0, 60)","lib: a slug cut at 60 characters"],
  ["existing: {city} question templates written unexpanded","research-existing.mjs","const texts = expandTemplate(r.cells[qi], cities);","const texts = [r.cells[qi]];","existing: a {city} template row expands per service-area city"],
  ["universe: templates not dropped","research-cluster.mjs","if (hasPlaceholder(q)) { dropped.push({ text: q, source: patch.source }); return; }","","cluster: the universe drops any query that still holds a placeholder"],
  ["gate: braces allowed in targets","research.mjs","if (/[{}]/.test(String(v ?? \"\"))) errs.push(","if (false) errs.push(","gate: an unfilled {placeholder}"],
  ["seeds: templates not expanded","research-seeds.mjs","const raw = String(query ?? \"\"), texts = expandTemplate(raw, places.map((p) => p.city));","const raw = String(query ?? \"\"), texts = [raw];","seeds: a {city} query expands per service-area city"],
  ["existing: a URL target falls back to the current folder","research-existing.mjs","inputs] : [inputs];","inputs] : DEFAULT_DIRS.map((d) => path.join(process.cwd(), d));","existing: a URL target never reads the current folder"],
  ["existing: files that do not name the business are imported","research-existing.mjs","const namesUs = (f) => owned.some((d) => under(f, d)) || ids.some((i) => textOf(f).includes(i));","const namesUs = (f) => true;","existing: a file that does not name this business is refused"],
  ["existing: --alias ignored","research-existing.mjs","const ids = [biz.domain, biz.name, ...aliases]","const ids = [biz.domain, biz.name]","existing: an alias the owner names"],
  ["existing: a repo's own folders must also name the business","research-existing.mjs","const owned = [ctx.loc.kind === \"repo\" ? ctx.loc.root : null, inputs].filter(Boolean);","const owned = [inputs];","existing: a repo target reads its own icm/knowledge"],
  ["winners: the page budget is not enforced","research-winners.mjs","if (fetched >= maxPages) { budgetStopped = true; continue; }","if (false) { budgetStopped = true; continue; }","winners: the page budget is a hard stop"],
  ["winners: pages fetched without --from-serp","research-winners.mjs","if (urls.length && fromSerp) {","if (urls.length) {","winners: nothing is fetched without --from-serp"],
  ["winners: cached competitor audits ignored","research-winners.mjs","const cached = fromCachedAudits(domains.map((d) => audits.get(d)).filter(Boolean),","const cached = fromCachedAudits([],","winners: a capture with domains only is served from the competitor audits already cached"],
  ["winners: one page counts as 'recurring'","research-winners.mjs","const need = Math.max(2, Math.ceil(ok.length / 2));","const need = Math.max(1, Math.ceil(ok.length / 2));","winners: 'recurring' needs 2+ pages"],
  ["winners: wordRange not marked an estimate","research-winners.mjs","{ estimate: true, location: cap.locationLabel, device: cap.device }","{ location: cap.locationLabel, device: cap.device }","winners: a SOURCED wordRange"],
  ["winners: robots.txt not obeyed","research-competitors.mjs","if (!pathAllowed(rb.groups, CRAWL_UA, u.pathname + u.search)) return done(","if (false) return done(","winners: robots.txt is obeyed"],
  ["autocomplete: a file without a date is accepted","research-autocomplete.mjs","if (!j.capturedAt || Number.isNaN(Date.parse(j.capturedAt))) why.push(\"no capture date\");","","autocomplete: saved suggestions parsed"],
  ["autocomplete: a suggestion presented as a measured count","research-autocomplete.mjs","rank: 3, estimate: true,","rank: 3, estimate: false,","autocomplete: a suggestion becomes a query with a sourced T1 ESTIMATE"],
  ["assets: one site is enough for a tool idea","research-assets.mjs","toolSites: 2","toolSites: 1","assets: a tool idea needs the same kind of tool on >= 2 different sites"],
  ["assets: ideas without enough evidence","research-assets.mjs","dataQuestions: 3","dataQuestions: 1","assets: a tool idea needs the same kind of tool on >= 2 different sites"],
  ["citations: competitor sites listed as directories","research-citations.mjs","if (!o.domain || o.domain === own || comps.has(o.domain)) continue;","if (!o.domain || o.domain === own) continue;","citations: a directory seen in 2+ captured searches"],
  ["citations: never says 'listed'","research-citations.mjs","const url = listedOn(domain);","const url = null;","citations: 'listed' only when business.json"],
  ["citations: 'not listed' claimed without a lookup","research-citations.mjs","status: url ? \"listed\" : named ? \"listed\" : \"unknown\",","status: url ? \"listed\" : named ? \"listed\" : \"not listed\",","citations: 'listed' only when business.json"],
  ["existing: sections naming only another business are imported","research-existing.mjs","if (verdict.act === \"refuse\") {","if (false) {","existing: a section heading that names this business AND another"],
  ["existing: shared sections not marked","research-existing.mjs","const shared = verdict.act === \"shared\" ? { sharedWith: verdict.sharedWith, section: sec.title } : sec ? { section: sec.title } : {};","const shared = {};","existing: a section heading that names this business AND another"],
  ["existing: a legend (T = Tracy) is not read","research-existing.mjs","legend[m[1]] = m[2];","void m;","existing: the same rule reads a legend"],
  ["cluster: sharedWith lost on the way to targets","research-cluster.mjs","byQuery.get(m.query)?.sharedWith || []","[]","targets.json: a cluster from a section shared with another business"],
  ["cluster: the token-overlap merge of serp:false singletons is off", "research-cluster.mjs", "const home = candidates.find((c) =>", "const home = undefined && candidates.find((c) =>", "cluster: validator consistency: the autocomplete-only"],
  ["cluster: a SERP-captured query is movable by tokens", "research-cluster.mjs", "const loose = raw.filter((c) => !c.serp && c.members.length === 1);", "const loose = raw.filter((c) => c.members.length === 1);", "cluster: validator consistency: a query WITH its own SERP capture is never merged"],
  ["cluster: after a token merge the primary is not the higher demand", "research-cluster.mjs", "c.members.sort((a, b) => vol(b) - vol(a) || dif(a) - dif(b) || cmpCode(a.query, b.query));", "c.members.sort((a, b) => cmpCode(a.query, b.query));", "cluster: validator consistency: two serp:false singletons that collide merge"],
  ["cluster: the token-overlap merge ignores research-lib sameQuery (T-003 exact set only)", "research-cluster.mjs", "export const collides = (a, b) => sameQuery(a, b) ||", "export const collides = (a, b) => false ||", "cluster: validator consistency: the autocomplete-only"],
  ["bing: a single-object `d` (GetKeyword) is read as no rows","research-bing.mjs","Array.isArray(d) ? d : d ? [d] : []","Array.isArray(d) ? d : []","bing: the live shapes parse"],
  ["bing: the relevance filter keeps everything","research-bing.mjs","if (v.drop) { droppedOffTopic.push(","if (false) { droppedOffTopic.push(","bing: relevance filter: the off-topic keywords"],
  ["bing: another site's name is not a reason to drop","research-bing.mjs","for (const w of words) if (brands.words.has(w) &&","for (const w of words) if (false && brands.words.has(w) &&","bing: relevance filter: a word that is another site's name"],
  ["bing: 'sale' counts as a meaningful term","research-bing.mjs","new Set([\"sale\", \"sell\", ","new Set([\"sell\", ","bing: relevance filter: the off-topic keywords"],
  ["bing: a place name alone makes a keyword relevant","research-bing.mjs","const inVocab = qt.find((t) => pool.has(t) && !placeTerms.has(t));","const inVocab = qt.find((t) => pool.has(t));","bing: relevance filter: the off-topic keywords"],
  ["bing: the business vocabulary is ignored","research-bing.mjs","[...(Array.isArray(b.vocabulary) ? b.vocabulary : []), b.offer || \"\"]","[b.offer || \"\"]","bing: relevance filter keeps the legitimate"],
  ["bing: the offer words are ignored","research-bing.mjs","[...(Array.isArray(b.vocabulary) ? b.vocabulary : []), b.offer || \"\"]","[...(Array.isArray(b.vocabulary) ? b.vocabulary : [])]","bing: relevance filter keeps the legitimate"],
  ["bing: the seed list's own terms are ignored","research-bing.mjs","const seedListTerms = new Set(seeds.flatMap(termsOf));","const seedListTerms = new Set();","bing: relevance filter keeps the legitimate"],
  ["bing: --keep-brands ignored","research-bing.mjs","if (!keepBrands) {","if (true) {","bing: --keep-brands keeps"],
  ["bing: --no-related not honoured by the CLI","research-bing.mjs","related: !a.has(\"no-related\"),","related: true,","bing: --no-related asks"],
  ["research: --no-related not passed to Bing","research.mjs","related: o.related !== false,","related: true,","research: --no-related is passed to Bing"],
  ["research: the off-topic count is not in report.md","research.mjs","if (S.bing?.status === \"ok\" && Array.isArray(S.bing.droppedOffTopic)) L.push(","if (false) L.push(","research: with the seeds approved"],
  ["research: the device mismatch line is not in report.md","research.mjs","if (dm) L.push(","if (false) L.push(","research: report.md says when the captures were taken"],
  ["seeds: queries written without `from`","research-seeds.mjs","out.set(q, { query: q, source, from, location:","out.set(q, { query: q, source, location:","seeds: every query says where it came from"],
  ["seeds: the vocabulary is not the service list","research-seeds.mjs","const svc = given.length ? given : explicit ? [] : vocab,","const svc = given.length ? given : [],","seeds: with no --service the business vocabulary"],
  ["seeds: --query seeds are widened with the vocabulary","research-seeds.mjs","explicit ? [] : vocab","vocab","seeds: seeds the caller names itself"],
  ["research: demand steps run on unapproved seeds","research.mjs","if (!o.yes) { const g = seedsApproval(ctx);","if (false) { const g = seedsApproval(ctx);","research: seeds nobody approved => exit 3"],
  ["research: --yes does not skip the seeds approval","research.mjs","if (!o.yes) { const g = seedsApproval(ctx);","if (true) { const g = seedsApproval(ctx);","research: no search has a sourced volume"],
  ["research: an approved list that differs counts as approved","research.mjs","if (!added.length && !removed.length) return {","if (true) return {","research: an approved list that differs"],
  ["research: a missing approved/seeds.json counts as approved","research.mjs","if (!ap) return { needed: true, ok: false,","if (!ap) return { needed: true, ok: true,","research: seeds nobody approved => exit 3"],
  ["research: NEEDS-APPROVAL exits 1 instead of 3","research.mjs","console.log(e.text); process.exitCode = 3; return;","console.log(e.text); process.exitCode = 1; return;","research: seeds nobody approved => exit 3"],
  ["lib: a location that is a list is expanded as a place","research-lib.mjs","if (!isPlaceLabel(loc.name)) add(loc.name, st);","add(loc.name, st);","lib: a location that is a list is a label"],
  ["lib: a service-area state gets the office state code","research-lib.mjs","const st = !m && US_STATES.has(name.toLowerCase()) ? null : (m ? m[2] : state || null);","const st = (m ? m[2] : state || null);","lib: a service-area entry that is itself a state"],
  ["lib: two commas are not a list","research-lib.mjs","(String(name ?? \"\").match(/,/g) || []).length >= 2","(String(name ?? \"\").match(/,/g) || []).length >= 3","lib: a location name that lists places"],
  ["competitors: the approved list is ignored","research-competitors.mjs","const approved = approvedFile ? approvedCompetitorRows(approvedFile) : null;","const approved = null;","competitors: with --approved-competitors"],
  ["competitors: --from-serp picks are audited in approved mode","research-competitors.mjs","const have = new Set(list.map(domainOf)); suggested = pickCompetitors(","const have = new Set(list.map(domainOf)); list.push(...pickCompetitors(ctx, { max, extra: list, fromBusiness: false }).filter((d) => !have.has(d))); suggested = pickCompetitors(","competitors: with --approved-competitors"],
  ["competitors: business.json competitors are audited in approved mode","research-competitors.mjs","list = [...new Set([...approved.domains, ...domains].map(keepPort))];","list = [...new Set([...approved.domains, ...domains, ...(b.competitors || [])].map(keepPort))];","competitors: with --approved-competitors"],
  ["research: the approved competitor file is not passed on","research.mjs","domains: o.competitors || [], approvedFile, fromSerp:","domains: o.competitors || [], fromSerp:","research: when approved/competitors.json exists"],
  ["lib: sleep() takes a negative or NaN wait as is","research-lib.mjs","Number.isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0","Number(ms)","lib: sleep(-5)"],
  ["lib: a negative PEWP_TEST_GAP_MS is accepted","research-lib.mjs","const gap = Number.isFinite(testGap) && testGap >= 0 ? testGap : own;","const gap = Number.isFinite(testGap) ? testGap : own;","lib: PEWP_TEST_GAP_MS that is not a number"],
];

const sel = M.filter((m) => !only || only.split("|").some((o) => m[0].includes(o))); // --only "a|b" runs the mutants whose name contains a or b
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), "pewp-mut-"));
function copyScripts(to) { for (const f of NEEDED) fs.copyFileSync(path.join(here, f), path.join(to, f)); }
function runTest(scriptsDir) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(scriptsDir, "test-research.mjs"), "--scripts", scriptsDir, "--json"], { env: { ...process.env, NODE_OPTIONS: "", PEWP_RULES_DIR: path.join(here, "..", "rules"), PEWP_FIXTURES_DIR: path.join(here, "..", "fixtures") } });
    let out = ""; p.stdout.on("data", (c) => (out += c)); p.stderr.on("data", (c) => (out += c));
    const t = setTimeout(() => p.kill(), 900000); // the suite takes 3 to 4 minutes on a busy laptop (3 mutants at a time): 240 s turned slow runs into NO-RESULT
    p.on("close", (code) => { clearTimeout(t); const last = out.trim().split("\n").at(-1); let j = null; try { j = JSON.parse(last); } catch {} resolve({ code, json: j, tail: out.slice(-400) }); });
  });
}

const baseDir = mk(); copyScripts(baseDir);
console.log(`baseline: unmutated copy of the scripts (${NEEDED.length} files from the import graph; ${sel.length} mutants to run, ${jobs} at a time)`);
const base = await runTest(baseDir);
fs.rmSync(baseDir, { recursive: true, force: true });
if (!base.json || base.json.failed.length) { console.log(`BASELINE NOT GREEN: ${base.json ? base.json.failed.join(" | ") : base.tail}`); process.exit(1); }
console.log(`baseline: ${base.json.passed}/${base.json.total} green\n`);

const rows = [];
let next = 0;
async function worker() {
  while (next < sel.length) {
    const [name, file, from, to, expect] = sel[next++];
    const dir = mk(); copyScripts(dir);
    const fp = path.join(dir, file), src = fs.readFileSync(fp, "utf8"), n = src.split(from).length - 1;
    if (n !== 1) { rows.push({ name, status: "PATCH-NOT-APPLIED", detail: `target text found ${n}x in ${file}` }); fs.rmSync(dir, { recursive: true, force: true }); continue; }
    fs.writeFileSync(fp, src.replace(from, () => to));
    const r = await runTest(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    if (!r.json) { rows.push({ name, status: "NO-RESULT", detail: r.tail }); continue; }
    const killed = r.json.failed.some((f) => f.includes(expect));
    rows.push({ name, status: killed ? "RED (killed)" : r.json.failed.length ? "WRONG-CHECK" : "STAYED GREEN", expect, failed: r.json.failed });
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
rows.sort((a, b) => M.findIndex((m) => m[0] === a.name) - M.findIndex((m) => m[0] === b.name));
for (const r of rows) console.log(`${r.status.padEnd(18)} ${r.name}${r.status === "RED (killed)" ? `\n${" ".repeat(19)}-> red: ${r.expect}${r.failed.length > 1 ? `  (+${r.failed.length - 1} more red: ${r.failed.filter((f) => !f.includes(r.expect)).map((f) => f.slice(0, 40)).join(" | ").slice(0, 160)})` : ""}` : `\n${" ".repeat(19)}${r.detail || `wanted red: ${r.expect}; red were: ${(r.failed || []).join(" | ").slice(0, 200) || "none"}`}`}`);
const bad = rows.filter((r) => r.status !== "RED (killed)");
console.log(`\n${rows.length - bad.length}/${rows.length} mutants killed by the check that names them${bad.length ? `; NOT killed: ${bad.map((r) => r.name).join("; ")}` : ""}`);
process.exit(bad.length ? 1 : 0);
