// Usage: node test-prompt-plan.mjs [--scripts <dir>] [--fixtures <dir>] [--json] [--no-mutants] [--verbose]
// Self-test of the plan side of the prompt map (DECISIONS 35, slice 5b): plan-site.mjs reading research/prompt-map.json (improve-page, new-page situation and comparison,
// earn-mention), plan/prompt-coverage.json, the comparison-fact rule (a fact line needs a public source URL and a date), approve.mjs (prompt-map kind, the coverage file
// travels with the plan) and gate GT-014 (gate-prompt-coverage.mjs). SYNTHETIC input only: the fixtures' invented Sample Valley Realty, temp folders, no network, no model.
// The M part breaks the scripts one rule at a time (each patch asserts its target text exists exactly once, so "the patch never applied" cannot pass as green) and requires
// the NAMED check to go red.
//   P plan-site   F comparison facts   A approve   G gate GT-014   M mutants
// Exit 0 = all pass. --json prints {passed, total, failed:[names]} as the last line (child mode of the M part).
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(opt("--scripts") || HERE);
const FIX = path.resolve(opt("--fixtures") || path.join(HERE, "..", "fixtures"));
const VERBOSE = args.includes("--verbose");
const { PLAN_FLAGS } = await import(pathToFileURL(path.join(FIX, "build-fixtures.mjs")).href);

async function suite(scriptsDir) {
  const R = [];
  const check = (name, ok, detail = "") => R.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 900) });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-pp-"));
  const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof s === "string" ? s : JSON.stringify(s, null, 1)); };
  const J = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
  const rf = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } }; // a missing file is a red check, never a crash that hides the named one
  const cp = (a, b) => fs.cpSync(a, b, { recursive: true });
  const walk = (d, base = d, out = []) => { if (!fs.existsSync(d)) return out; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, base, out); else out.push(path.relative(base, p).split(path.sep).join("/")); } return out.sort(); };
  const imp = (f) => import(pathToFileURL(path.join(scriptsDir, f)).href);
  const node = (script, a) => spawnSync(process.execPath, [path.join(scriptsDir, script), ...a], { encoding: "utf8", timeout: 180000 });
  const lib = await imp("lib-prompt-map.mjs"), P = await imp("lib-prompt-plan.mjs"), G = await imp("gate.mjs"), AP = await imp("approve.mjs");
  let seq = 0;
  const fresh = (label = "d") => path.join(tmp, `${label}${seq++}`);
  const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex"); // the test's own hash: it must not share code with the script it checks

  // ---- the synthetic map: four rows on the fixtures' invented Sample Valley Realty (Placer County) ----
  const row = (prompt, o) => ({ id: lib.promptId(prompt), prompt, scenario: o.scenario, comparison: o.comparison, constraint: o.constraint, location: "Roseville, CA", sources: [{ kind: "forum", ref: "research/forums.json:3", seenAt: "2026-10-01", quote: "a buyer's question on a public forum" }], fix: o.fix });
  const R_IMP = row("I am selling a house in Rocklin and wonder whether an agent beats selling alone when I need the money in 60 days", { scenario: "selling a Rocklin house on a 60 day clock", comparison: "an agent versus selling alone", constraint: "the money is needed in 60 days", fix: { kind: "improve-page", target: "/rocklin-ca/", note: "add the 60 day timeline to the Rocklin page" } });
  const R_SIT = row("First time buyer in Roseville, rent for two more years or buy now with 20 percent down under 500k?", { scenario: "a first time buyer in Roseville", comparison: "renting two more years versus buying now", constraint: "20 percent down and a 500k ceiling", fix: { kind: "new-page", target: "new", pageType: "situation", note: "no page answers the first time buyer case" } });
  const R_CMP = row("Is a full service agent worth the fee compared with a flat fee listing service when I sell a Lincoln house under 600k?", { scenario: "selling a Lincoln house under 600k", comparison: "a full service agent versus a flat fee listing service", constraint: "the agent's fee against what it returns", fix: { kind: "new-page", target: "new", pageType: "comparison", note: "an honest side by side with sourced facts" } });
  const R_ERN = row("Which real estate agent in Placer County is best for relocating from out of state with a dog?", { scenario: "relocating to Placer County from another state", comparison: "which agent suits a relocation", constraint: "a dog travelling with the family", fix: { kind: "earn-mention", target: "new", note: "a relocation guide on a local blog is where this is answered" } });
  const mapDoc = (rows = [R_IMP, R_SIT, R_CMP, R_ERN]) => ({ step: "prompt-map", generatedAt: "2026-10-22", market: { country: "US", language: "en" }, rows });
  const clone = (x) => structuredClone(x);
  const withFix = (r, fix) => { const c = clone(r); c.fix = fix; return c; };

  // a planned folder: the fixtures' pewp, the map, optional hand-filled facts, and plan-site run on it
  const planned = (doc, { facts = null, keepPlan = true, mapFile = "research/prompt-map.json", raw = null } = {}) => {
    const d = fresh("pw"); cp(path.join(FIX, "pewp"), d);
    if (!keepPlan) fs.rmSync(path.join(d, "plan"), { recursive: true, force: true });
    if (doc) w(path.join(d, mapFile), raw ?? doc);
    if (facts) w(path.join(d, "plan", "comparison-facts.json"), facts);
    return { d, r: node("plan-site.mjs", [d, ...PLAN_FLAGS]) };
  };
  const untouched = (d) => !fs.existsSync(path.join(d, "plan", "sitemap.json")) && !fs.existsSync(path.join(d, "plan", "briefs")) && !fs.existsSync(path.join(d, "plan", "prompt-coverage.json"));
  const briefOf = (d, SM, p) => { const pg = SM.pages.find((x) => x.path === p); return pg ? rf(path.join(d, pg.brief)) : ""; }; // crash-safe: a missing page is an empty brief and a red check

  try {
    // ============ P: plan-site with a prompt map ============
    const base = planned(mapDoc());
    const SM = J(path.join(base.d, "plan", "sitemap.json")) || { pages: [], links: [] };
    const CV = J(path.join(base.d, "plan", "prompt-coverage.json")) || { rows: [] };
    const OF = J(path.join(base.d, "plan", "offsite.json")) || {};
    const sit = SM.pages.find((p) => p.kind === "situation"), cmp = SM.pages.find((p) => p.kind === "comparison"), rock = SM.pages.find((p) => p.path === "/rocklin-ca/");
    check("P: plan-site runs on the fixtures with a four-row map (exit 0), eight pages, the line counts the rows", base.r.status === 0 && /^PASS plan 8 pages/.test(base.r.stdout) && /prompt map 4 prompt\(s\): 1 improve a page, 2 new page\(s\), 1 off-site mention\(s\)/.test(base.r.stdout), base.r.stdout + base.r.stderr);
    if (base.r.status !== 0) return R; // nothing below can be judged without the base plan: the check above is the red one (and every later group would only crash on its missing files)
    const heading = "## Prompts this page answers";
    const withSection = SM.pages.filter((p) => briefOf(base.d, SM, p.path).includes(heading)).map((p) => p.path).sort().join();
    check("P: improve-page puts the prompt (id | prompt) under '## Prompts this page answers' in the named page's brief", briefOf(base.d, SM, "/rocklin-ca/").includes(`${heading}\n- ${R_IMP.id} | ${R_IMP.prompt}\n`) && JSON.stringify(rock?.prompts) === JSON.stringify([R_IMP.id]), briefOf(base.d, SM, "/rocklin-ca/").slice(0, 900));
    check("P: only the improved page and the two new pages carry that section (no other brief changes)", withSection === ["/rocklin-ca/", sit?.path, cmp?.path].sort().join(), withSection);
    check("P: improve-page also tells the builder what to add (the row's note) and to answer first", /- Prompt pm-[0-9a-f]{8}: add the 60 day timeline to the Rocklin page/.test(briefOf(base.d, SM, "/rocklin-ca/")) && /Answer each prompt listed above in the first paragraph/.test(briefOf(base.d, SM, "/rocklin-ca/")));
    check("P: new-page situation: a page of kind situation under /situations/, no cluster, a support page under home, schema Article, new", !!sit && sit.path.startsWith("/situations/") && sit.cluster === null && sit.role === "support" && sit.parent === "/" && sit.isNew === true && JSON.stringify(sit.schema) === JSON.stringify(["Article"]) && JSON.stringify(sit.prompts) === JSON.stringify([R_SIT.id]), JSON.stringify(sit));
    check("P: the situation page's title carries its scenario, title <= 60, description <= 160, H1 is the head", !!sit && /first time buyer/i.test(sit.title) && sit.title.length <= 60 && sit.metaDescription.length <= 160 && /^A first time buyer in Roseville: /.test(sit.h1), JSON.stringify([sit?.title, sit?.h1, sit?.metaDescription]));
    check("P: the situation brief has the situation outline, the buyer's three parts and no fact section", (() => { const b = briefOf(base.d, SM, sit?.path); return /- H2: Your situation/.test(b) && /- H2: What your limit changes/.test(b) && /## What the buyer asked\n- Scenario: a first time buyer in Roseville\n- Comparison: renting two more years versus buying now\n- Constraint: 20 percent down and a 500k ceiling\n- Location: Roseville, CA/.test(b) && !/Facts about the other option/.test(b) && /- Kind: situation/.test(b) && /- Cluster: none/.test(b); })(), briefOf(base.d, SM, sit?.path));
    check("P: new-page comparison: a page of kind comparison under /vs/, schema Article, outline side by side", !!cmp && cmp.path.startsWith("/vs/") && cmp.cluster === null && cmp.parent === "/" && JSON.stringify(cmp.schema) === JSON.stringify(["Article"]) && /- H2: The options side by side/.test(briefOf(base.d, SM, cmp?.path)) && /- Kind: comparison/.test(briefOf(base.d, SM, cmp?.path)), JSON.stringify(cmp));
    check("P: the comparison brief carries '## Facts about the other option' with no fact yet, and says no claim without a line there", (() => { const b = briefOf(base.d, SM, cmp?.path); return b.includes("## Facts about the other option\n- (no sourced facts yet: add them to plan/comparison-facts.json") && /Claims about the other option are only the lines under "Facts about the other option"/.test(b); })(), briefOf(base.d, SM, cmp?.path));
    check("P: home links to each new page and each links home; both are in the page plan's links", [sit, cmp].every((p) => p && SM.links.some((l) => l.from === "/" && l.to === p.path) && SM.links.some((l) => l.from === p.path && l.to === "/")));
    const mentionsIn = SM.pages.filter((p) => briefOf(base.d, SM, p.path).includes(R_ERN.id));
    check("P: earn-mention goes to plan/offsite.json promptMentions with the prompt id, and makes no page and no brief line", Array.isArray(OF.promptMentions) && OF.promptMentions.length === 1 && OF.promptMentions[0].promptId === R_ERN.id && OF.promptMentions[0].id === `mention-${R_ERN.id}` && OF.promptMentions[0].target === "new" && !mentionsIn.length && SM.pages.length === 8, JSON.stringify(OF.promptMentions) + mentionsIn.length);
    const mapBytes = fs.readFileSync(path.join(base.d, "research", "prompt-map.json"));
    check("P: plan/prompt-coverage.json: map is the sha256 of the map file, one row per map row in map order, keys id/coveredBy/kind/reason", CV.map === sha(mapBytes) && CV.mapFile === "research/prompt-map.json" && CV.rows.map((r) => r.id).join() === [R_IMP, R_SIT, R_CMP, R_ERN].map((r) => r.id).join() && CV.rows.every((r) => JSON.stringify(Object.keys(r)) === JSON.stringify(["id", "coveredBy", "kind", "reason"])), JSON.stringify(CV));
    check("P: coverage: improve and new rows are covered by a path of the page plan; every reason is non-empty", (() => { const by = Object.fromEntries(CV.rows.map((r) => [r.id, r])); const paths = new Set(SM.pages.map((p) => p.path)); return by[R_IMP.id]?.coveredBy === "/rocklin-ca/" && by[R_IMP.id]?.kind === "improve-page" && by[R_SIT.id]?.coveredBy === sit?.path && by[R_CMP.id]?.coveredBy === cmp?.path && CV.rows.filter((r) => r.coveredBy).every((r) => paths.has(r.coveredBy)) && CV.rows.every((r) => typeof r.reason === "string" && r.reason.trim()); })(), JSON.stringify(CV.rows));
    check("P: coverage: an earn-mention row has coveredBy null and a reason that names its item in plan/offsite.json", (() => { const e = CV.rows.find((r) => r.id === R_ERN.id); return e && e.coveredBy === null && e.kind === "earn-mention" && e.reason.includes(`mention-${R_ERN.id}`) && e.reason.includes("plan/offsite.json"); })(), JSON.stringify(CV.rows));
    const facts0 = J(path.join(base.d, "plan", "comparison-facts.json"));
    check("P: plan/comparison-facts.json is created for the comparison row only, with an empty list", facts0 && JSON.stringify(Object.keys(facts0.facts)) === JSON.stringify([R_CMP.id]) && facts0.facts[R_CMP.id].length === 0, JSON.stringify(facts0));
    {
      const p2 = planned(mapDoc());
      const same = walk(path.join(base.d, "plan")).join() === walk(path.join(p2.d, "plan")).join() && walk(path.join(base.d, "plan")).every((f) => rf(path.join(base.d, "plan", f)) === rf(path.join(p2.d, "plan", f)));
      check("P: deterministic (two runs on the same map write byte-identical plan files)", p2.r.status === 0 && same);
      const before = Object.fromEntries(walk(path.join(base.d, "plan")).map((f) => [f, rf(path.join(base.d, "plan", f))]));
      node("plan-site.mjs", [base.d, ...PLAN_FLAGS]);
      check("P: re-running over its own output changes nothing (idempotent, comparison-facts.json kept)", walk(path.join(base.d, "plan")).every((f) => before[f] === rf(path.join(base.d, "plan", f))) && walk(path.join(base.d, "plan")).length === Object.keys(before).length);
    }
    {
      const none = planned(null);
      const s = J(path.join(none.d, "plan", "sitemap.json")) || { pages: [] }, o = J(path.join(none.d, "plan", "offsite.json")) || {};
      check("P: no map: six pages, no coverage file, no promptMentions, no 'Prompts this page answers' anywhere, no facts file", none.r.status === 0 && s.pages.length === 6 && !fs.existsSync(path.join(none.d, "plan", "prompt-coverage.json")) && !("promptMentions" in o) && !fs.existsSync(path.join(none.d, "plan", "comparison-facts.json")) && !s.pages.some((p) => briefOf(none.d, s, p.path).includes(heading) || "prompts" in p) && !/prompt map/.test(none.r.stdout), none.r.stdout);
      const gone = fresh("gone"); cp(base.d, gone); fs.rmSync(path.join(gone, "research", "prompt-map.json"), { force: true });
      const rg = node("plan-site.mjs", [gone, ...PLAN_FLAGS]);
      check("P: the map removed and the plan run again: the old coverage file is deleted and the mentions are gone", rg.status === 0 && !fs.existsSync(path.join(gone, "plan", "prompt-coverage.json")) && !("promptMentions" in (J(path.join(gone, "plan", "offsite.json")) || {})) && (J(path.join(gone, "plan", "sitemap.json")) || { pages: [] }).pages.length === 6, rg.stdout);
    }
    {
      const badImp = planned(mapDoc([withFix(R_IMP, { kind: "improve-page", target: "/nowhere/", note: "n" }), R_SIT]), { keepPlan: false });
      check("P: an improve-page row whose page is not in the plan stops the plan (exit 1, names the row), nothing written", badImp.r.status === 1 && /^FAIL plan/.test(badImp.r.stdout) && badImp.r.stdout.includes(R_IMP.id) && /not a page of the plan/.test(badImp.r.stdout) && untouched(badImp.d), badImp.r.stdout);
      const badErn = planned(mapDoc([withFix(R_ERN, { kind: "earn-mention", target: "/nowhere/", note: "n" })]), { keepPlan: false });
      check("P: an earn-mention row that points at a page the plan does not have stops the plan (exit 1), nothing written", badErn.r.status === 1 && badErn.r.stdout.includes(R_ERN.id) && /earn-mention target/.test(badErn.r.stdout) && untouched(badErn.d), badErn.r.stdout);
      const badRow = planned(mapDoc([{ ...clone(R_SIT), scenario: " " }]), { keepPlan: false });
      check("P: a map row the 5a validator refuses (empty scenario) stops the plan (exit 1, PM-PARTS), nothing written", badRow.r.status === 1 && /PM-PARTS/.test(badRow.r.stdout) && /scenario is empty/.test(badRow.r.stdout) && untouched(badRow.d), badRow.r.stdout);
      const noSrc = planned(mapDoc([{ ...clone(R_SIT), sources: [] }]), { keepPlan: false });
      check("P: a row with no source stops the plan (exit 1, PM-SRC): a row without a source is not a row", noSrc.r.status === 1 && /PM-SRC/.test(noSrc.r.stdout) && untouched(noSrc.d), noSrc.r.stdout);
      const junk = planned({}, { keepPlan: false, raw: "{ not json" });
      check("P: a map that is not JSON is cannot-judge (exit 2), nothing written", junk.r.status === 2 && /^ERROR plan cannot judge/.test(junk.r.stdout) && untouched(junk.d), junk.r.stdout);
    }
    {
      const ap = fresh("apr"); cp(path.join(FIX, "pewp"), ap); w(path.join(ap, "research", "prompt-map.json"), mapDoc()); w(path.join(ap, "approved", "prompt-map.json"), mapDoc([R_SIT]));
      const ra = node("plan-site.mjs", [ap, ...PLAN_FLAGS]), cv = J(path.join(ap, "plan", "prompt-coverage.json")) || { rows: [] };
      check("P: approved/prompt-map.json is read in preference to research/prompt-map.json", ra.status === 0 && cv.mapFile === "approved/prompt-map.json" && cv.rows.length === 1 && cv.rows[0].id === R_SIT.id && cv.map === sha(fs.readFileSync(path.join(ap, "approved", "prompt-map.json"))), ra.stdout + JSON.stringify(cv));
    }
    check("P: lib routeRows sends each fix kind to its own list and names a missing page", (() => { const r = P.routeRows([R_IMP, R_SIT, R_CMP, R_ERN, withFix(R_IMP, { kind: "improve-page", target: "/x/", note: "n" })], new Set(["/rocklin-ca/"]), (x) => x); return r.improve.length === 1 && r.create.length === 2 && r.mention.length === 1 && r.problems.length === 1; })());

    // ============ F: facts about the other option (comparison pages) ============
    const GOOD = [{ fact: "A flat fee listing service charges a fee set before the sale", url: "https://example-flatfee.test/pricing", date: "2026-10-05" }, { fact: "Flat fee services do not hold open houses", url: "http://example-flatfee.test/faq", date: "2026-10-06" }];
    const fp = planned(mapDoc(), { facts: { facts: { [R_CMP.id]: GOOD } } });
    const fSM = J(path.join(fp.d, "plan", "sitemap.json")) || { pages: [] }, fcmp = fSM.pages.find((p) => p.kind === "comparison");
    check("F: facts with a URL and a date become brief lines 'fact | source: url | date: d', and the 'no sourced facts yet' line is gone", fp.r.status === 0 && briefOf(fp.d, fSM, fcmp?.path).includes(`## Facts about the other option\n- ${GOOD[0].fact} | source: ${GOOD[0].url} | date: ${GOOD[0].date}\n- ${GOOD[1].fact} | source: ${GOOD[1].url} | date: ${GOOD[1].date}\n`) && !/no sourced facts yet/.test(briefOf(fp.d, fSM, fcmp?.path)), fp.r.stdout + briefOf(fp.d, fSM, fcmp?.path));
    check("F: hand-filled comparison-facts.json is not overwritten by a second plan run", (() => { node("plan-site.mjs", [fp.d, ...PLAN_FLAGS]); const f = J(path.join(fp.d, "plan", "comparison-facts.json")); return f && f.facts[R_CMP.id].length === 2 && f.facts[R_CMP.id][0].url === GOOD[0].url; })());
    const refused = (name, facts, re) => { const x = planned(mapDoc(), { facts: { facts }, keepPlan: false }); check(`F: ${name} is refused (exit 1, nothing written)`, x.r.status === 1 && /^FAIL plan/.test(x.r.stdout) && re.test(x.r.stdout) && untouched(x.d), x.r.stdout + x.r.stderr); };
    const one = (o) => ({ [R_CMP.id]: [{ ...GOOD[0], ...o }] });
    refused("a fact with no source URL", one({ url: undefined }), /no public source URL/);
    refused("a fact whose source is not an http(s) address", one({ url: "example-flatfee.test/pricing" }), /no public source URL/);
    refused("a fact whose source URL has no real host", one({ url: "https://localhost/pricing" }), /no real host/);
    refused("a fact with no date", one({ date: undefined }), /no date/);
    refused("a fact with a date that is not a date", one({ date: "5 Oct" }), /no date/);
    refused("a fact with an impossible date (month 13)", one({ date: "2026-13-45" }), /no date/);
    refused("a fact dated in the future", one({ date: "2026-12-01" }), /in the future/);
    refused("a fact with empty text", one({ fact: "  " }), /fact text is empty/);
    refused("a fact whose text holds a '|'", one({ fact: "fees | and more" }), /holds a "\|"/);
    refused("facts for a row that is not a comparison row of the map", { [R_SIT.id]: [GOOD[0]] }, /not a new-page comparison row/);
    refused("facts that are not a list", { [R_CMP.id]: "a fee" }, /facts is a list/);
    check("F: lib briefFactProblems: a line without URL, without date, or with a bad date is a problem; a full line and the placeholder are not", (() => { try { const f = P.briefFactProblems(["x | source: https://a.test/p | date: 2026-10-05", "y | date: 2026-10-05", "z | source: https://a.test/p", "w | source: https://a.test/p | date: 2026-13-45", P.NO_FACTS], "2026-11-01"); return f.problems.length === 3 && f.facts === 1 && f.placeholder === true; } catch { return false; } })());

    // ============ A: approve.mjs ============
    {
      const ad = fresh("ap"); cp(path.join(FIX, "pewp"), ad); w(path.join(ad, "research", "prompt-map.json"), mapDoc());
      const run = (...a) => node("approve.mjs", ["--pewp", ad, ...a]);
      const unsigned = run("prompt-map");
      check("A: approve prompt-map without --by shows the rows and is NOT SIGNED (exit 3), nothing approved", unsigned.status === 3 && /NOT SIGNED/.test(unsigned.stdout) && !fs.existsSync(path.join(ad, "approved", "prompt-map.json")), unsigned.stdout);
      const bd = fresh("apb"); cp(path.join(FIX, "pewp"), bd); w(path.join(bd, "research", "prompt-map.json"), mapDoc([{ ...clone(R_SIT), constraint: "" }]));
      const refusedA = node("approve.mjs", ["--pewp", bd, "prompt-map", "--by", "Owner"]);
      check("A: approve prompt-map refuses a map the validator refuses (exit 1, PM-PARTS), nothing approved", refusedA.status === 1 && /FAIL approve prompt-map/.test(refusedA.stdout) && /PM-PARTS/.test(refusedA.stdout) && !fs.existsSync(path.join(bd, "approved")), refusedA.stdout);
      const signed = run("prompt-map", "--by", "Owner");
      const lock = J(path.join(ad, "approved", "lock.json")) || {};
      check("A: approve prompt-map --by signs it: approved/prompt-map.json is the source, the lock lists it (exit 0), --check passes", signed.status === 0 && /PASS approve prompt-map: 4 rows signed by Owner/.test(signed.stdout) && rf(path.join(ad, "approved", "prompt-map.json")) === rf(path.join(ad, "research", "prompt-map.json")) && !!lock["prompt-map"]?.files?.["prompt-map.json"] && run("--check").status === 0, signed.stdout + JSON.stringify(lock));
      // the coverage file and the comparison facts travel with the approved plan
      const tgt = run("targets", "--by", "Owner"); node("plan-site.mjs", [ad, ...PLAN_FLAGS]);
      const pl = run("plan", "--by", "Owner"), lock2 = J(path.join(ad, "approved", "lock.json")) || {};
      check("A: approve plan copies plan/prompt-coverage.json and comparison-facts.json into approved/plan and the lock lists both (exit 0)", tgt.status === 0 && pl.status === 0 && rf(path.join(ad, "approved", "plan", "prompt-coverage.json")) === rf(path.join(ad, "plan", "prompt-coverage.json")) && rf(path.join(ad, "approved", "plan", "prompt-coverage.json")) !== "" && !!lock2.plan?.files?.["plan/prompt-coverage.json"] && !!lock2.plan?.files?.["plan/comparison-facts.json"] && run("--check").status === 0, tgt.stdout + pl.stdout);
      // GT-014 reads the approved plan, not the working copy
      const site = fresh("site"); cp(path.join(FIX, "site-clean"), site);
      const sm = J(path.join(ad, "plan", "sitemap.json")) || { pages: [] };
      for (const p of sm.pages.filter((x) => x.kind === "situation" || x.kind === "comparison")) w(path.join(site, p.path, "index.html"), rf(path.join(site, "index.html")));
      w(path.join(ad, "plan", "prompt-coverage.json"), { map: "0".repeat(64), rows: [] }); // wreck the working copy
      const g = G.gate(ad, site, { only: ["GT-014"] }).results[0] || { status: "MISSING", summary: "GT-014 is not in the gate", details: [] };
      check("A: GT-014 reads the approved plan's coverage file when the plan is approved (a wrecked working copy changes nothing)", g.status === "PASS", `${g.status} ${g.summary} ${g.details.join(" | ")}`);
    }

    // ============ G: gate GT-014 ============
    const siteBase = fresh("sitebase"); cp(path.join(FIX, "site-clean"), siteBase);
    for (const p of [sit, cmp]) if (p) w(path.join(siteBase, p.path, "index.html"), rf(path.join(siteBase, "index.html")));
    const gate14 = (d, site = siteBase) => G.gate(d, site, { only: ["GT-014"] }).results[0] || { status: "MISSING", summary: "GT-014 is not in the gate", details: [] };
    const txt = (r) => `${r.summary}\n${r.details.join("\n")}`;
    const variant = (edit) => { const d = fresh("gv"); cp(base.d, d); edit(d); return d; };
    const jedit = (d, rel, fn) => { const f = path.join(d, rel); const o = J(f); if (!o) return; fn(o); w(f, o); }; // a file the plan did not write is left alone: the check that needs it goes red
    const covRow = (o, id) => (o.rows || []).find((r) => r.id === id) || {};
    const g0 = gate14(base.d);
    check("G: GT-014 PASS on the planned four-row map with the built pages: 3 by a built page, 1 with a written reason", g0.status === "PASS" && /4 prompt row\(s\) covered: 3 by a built page, 1 with a written reason/.test(g0.summary), txt(g0));
    check("G: the comparison page with no sourced fact yet is a WARN, not a failure", g0.status === "PASS" && g0.details.some((l) => /^WARN .*comparison page with no sourced fact/.test(l)), txt(g0));
    {
      const none = planned(null), r = gate14(none.d, path.join(FIX, "site-clean"));
      check("G: GT-014 PASS and says so when the project has no prompt map", r.status === "PASS" && /no prompt map in this project/.test(r.summary), txt(r));
    }
    for (const [name, reason] of [["empty", ""], ["blank", "   "]]) {
      const d = variant((x) => jedit(x, "plan/prompt-coverage.json", (o) => { Object.assign(covRow(o, R_IMP.id), { coveredBy: null, reason }); }));
      const r = gate14(d);
      check(`G: GT-014 FAIL a row with neither a page nor a reason (reason ${name})`, r.status === "FAIL" && new RegExp(`${R_IMP.id}.*no page and no reason`).test(txt(r)), txt(r));
    }
    {
      const d = variant((x) => jedit(x, "plan/prompt-coverage.json", (o) => { Object.assign(covRow(o, R_IMP.id), { coveredBy: null, reason: "the owner decided the Rocklin page stays as it is" }); }));
      const r = gate14(d);
      check("G: GT-014 PASS a row with no page but a written reason, listed as a WARN", r.status === "PASS" && r.details.some((l) => /^WARN pm-.*written reason: the owner decided/.test(l)), txt(r));
    }
    {
      const d = variant((x) => jedit(x, "plan/prompt-coverage.json", (o) => { covRow(o, R_IMP.id).coveredBy = "/nowhere/"; }));
      const r = gate14(d);
      check("G: GT-014 FAIL a row covered by a path that is not a page of the plan", r.status === "FAIL" && /covered by \/nowhere\/, which is not a page of the plan/.test(txt(r)), txt(r));
    }
    {
      const s = fresh("s6"); cp(siteBase, s); fs.rmSync(path.join(s, "rocklin-ca", "index.html"), { force: true });
      const r = gate14(base.d, s);
      check("G: GT-014 FAIL a row covered by a planned page that is not built", r.status === "FAIL" && /covered by \/rocklin-ca\/, but no page is built there/.test(txt(r)), txt(r));
    }
    {
      const d = variant((x) => jedit(x, "plan/prompt-coverage.json", (o) => { o.rows = o.rows.filter((r) => r.id !== R_SIT.id); }));
      const r = gate14(d);
      check("G: GT-014 FAIL a map row that the coverage file does not list", r.status === "FAIL" && new RegExp(`${R_SIT.id}.*not in plan/prompt-coverage.json`).test(txt(r)), txt(r));
    }
    {
      const d = variant((x) => fs.appendFileSync(path.join(x, "research", "prompt-map.json"), "\n"));
      const r = gate14(d);
      check("G: GT-014 FAIL a coverage file made for another version of the map (STALE, run plan-site again)", r.status === "FAIL" && /STALE plan\/prompt-coverage.json was made for research\/prompt-map.json/.test(txt(r)), txt(r));
    }
    {
      const d = variant((x) => fs.rmSync(path.join(x, "plan", "prompt-coverage.json"), { force: true }));
      const r = gate14(d);
      check("G: GT-014 FAIL a prompt map with no coverage file (the plan has not answered it)", r.status === "FAIL" && /plan\/prompt-coverage.json does not exist/.test(txt(r)), txt(r));
    }
    {
      const d = variant((x) => fs.rmSync(path.join(x, "research", "prompt-map.json"), { force: true }));
      const r = gate14(d);
      check("G: GT-014 ERROR (cannot judge) a coverage file with no map to compare it with", r.status === "ERROR" && /no research\/prompt-map.json or approved\/prompt-map.json/.test(txt(r)), txt(r));
    }
    {
      const d = variant((x) => jedit(x, "plan/prompt-coverage.json", (o) => { o.rows.push({ id: "pm-00000000", coveredBy: "/", kind: "improve-page", reason: "left over" }); }));
      const r = gate14(d);
      check("G: GT-014 FAIL a coverage row whose id is not in the map", r.status === "FAIL" && /pm-00000000: in plan\/prompt-coverage.json but not in research\/prompt-map.json/.test(txt(r)), txt(r));
    }
    {
      const d = variant((x) => { const f = path.join(x, "plan", "briefs", path.basename(SM.pages.find((p) => p.path === "/rocklin-ca/").brief)); w(f, rf(f).split(`- ${R_IMP.id} | ${R_IMP.prompt}\n`).join("")); });
      const r = gate14(d);
      check("G: GT-014 FAIL a covering page whose brief does not list the row id", r.status === "FAIL" && new RegExp(`${R_IMP.id}.*its brief does not list ${R_IMP.id} under "Prompts this page answers"`).test(txt(r)), txt(r));
    }
    {
      const d = variant((x) => jedit(x, "plan/offsite.json", (o) => { delete o.promptMentions; }));
      const r = gate14(d);
      check("G: GT-014 FAIL an earn-mention row whose item is missing from plan/offsite.json", r.status === "FAIL" && /an earn-mention row, but plan\/offsite.json has no item for it/.test(txt(r)), txt(r));
    }
    {
      const cmpBrief = (x, fn) => { const f = path.join(x, SM.pages.find((p) => p.kind === "comparison").brief); const before = rf(f); const after = fn(before); if (after === before) { check("G: test patch applied to the comparison brief (the brief has the text the edit changes)", false, f); return; } w(f, after); };
      const NF = `- ${P.NO_FACTS}`;
      for (const [name, line, re] of [["no date", "- a flat fee service lists for less | source: https://example-flatfee.test/pricing", /fact line without a public source URL and a date/], ["no URL", "- a flat fee service lists for less | date: 2026-10-05", /fact line without a public source URL and a date/], ["a source that is not a web address", "- a flat fee service lists for less | source: pricing page | date: 2026-10-05", /fact line without a public source URL and a date/]]) {
        const d = variant((x) => cmpBrief(x, (b) => b.split(NF).join(line))), r = gate14(d);
        check(`G: GT-014 FAIL a comparison brief line with ${name}`, r.status === "FAIL" && re.test(txt(r)), txt(r));
      }
      const dGood = variant((x) => cmpBrief(x, (b) => b.split(NF).join("- a flat fee service lists for less | source: https://example-flatfee.test/pricing | date: 2026-10-05"))), rGood = gate14(dGood);
      check("G: GT-014 PASS a comparison brief whose fact line has a URL and a date (and no longer WARNs)", rGood.status === "PASS" && !rGood.details.some((l) => /comparison page with no sourced fact/.test(l)), txt(rGood));
      const dNo = variant((x) => cmpBrief(x, (b) => b.split("## Facts about the other option\n").join("## Something else\n"))), rNo = gate14(dNo);
      check("G: GT-014 FAIL a comparison page whose brief has no 'Facts about the other option' section", rNo.status === "FAIL" && /no "Facts about the other option" section/.test(txt(rNo)), txt(rNo));
    }
    check("G: GT-014 is wired into gate.mjs and prints its line from the CLI", G.CHECKS.some((c) => c.id === "GT-014") && (() => { const r = node("gate.mjs", [base.d, siteBase, "--only", "GT-014", "--no-report"]); return r.status === 0 && /^PASS GT-014 4 prompt row\(s\) covered/m.test(r.stdout); })());
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
  return R;
}

// child mode: one mutant's suite in its own process, so mutants run in parallel
if (args.includes("--suite-json")) {
  const rs = await suite(path.resolve(opt("--suite-json")));
  process.stdout.write(JSON.stringify(rs.map((r) => ({ name: r.name, ok: r.ok }))));
  process.exit(0);
}
const t0 = Date.now();
const main = await suite(SCRIPTS);
const group = (r) => (r.name.match(/^([A-Z]):/) || [, "?"])[1];
const names = { P: "plan-site", F: "comparison facts", A: "approve", G: "gate GT-014" };
const out = [];
for (const g of Object.keys(names)) { const rs = main.filter((r) => group(r) === g); out.push(`${g} ${names[g]}: ${rs.filter((r) => r.ok).length}/${rs.length}`); }
for (const r of main) if (VERBOSE || !r.ok) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${r.ok ? "" : "\n     " + r.detail.replace(/\n/g, "\n     ")}`);
console.log(out.join("\n"));
let failed = main.filter((r) => !r.ok).length;
console.log(`${failed ? "FAIL" : "PASS"} test-prompt-plan ${main.filter((r) => r.ok).length}/${main.length} checks (${Math.round((Date.now() - t0) / 1000)} s)`);
if (args.includes("--json")) console.log(JSON.stringify({ passed: main.filter((r) => r.ok).length, total: main.length, failed: main.filter((r) => !r.ok).map((r) => r.name) }));

// ---------- M: watched-fail mutants ----------
if (!args.includes("--no-mutants") && !opt("--scripts")) {
  const MUTANTS = [
    ["lib-prompt-plan.mjs", "if (!planned.has(p)) problems.push(", "if (false) problems.push(", /P: an improve-page row whose page is not in the plan/, "an improve-page row naming a page the plan lacks is accepted"],
    ["lib-prompt-plan.mjs", 'if (f.target !== "new" && !planned.has(norm(f.target))) problems.push(', "if (false) problems.push(", /P: an earn-mention row that points at a page/, "an earn-mention row pointing at a page the plan lacks is accepted"],
    ["lib-prompt-plan.mjs", "if (u) out.push(u);", "", /F: a fact (with no source URL|whose source is not an http|whose source URL has no real host)/, "a fact needs no source URL"],
    ["lib-prompt-map.mjs", "return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;", "return d.toISOString().slice(0, 10) === s;", /F: (a fact with an impossible date|lib briefFactProblems)/, "an impossible date (month 13) crashes instead of being refused"],
    ["lib-prompt-plan.mjs", "if (!isIsoDate(f.date)) out.push(", "if (false) out.push(", /F: a fact with (no date|a date that is not a date)/, "a fact needs no date"],
    ["lib-prompt-plan.mjs", "else if (today && f.date > today) out.push(", "else if (false) out.push(", /F: a fact dated in the future/, "a fact may be dated in the future"],
    ["lib-prompt-plan.mjs", "if (!nonEmpty(f.fact)) out.push(", "if (false) out.push(", /F: a fact with empty text/, "a fact may be empty text"],
    ["lib-prompt-plan.mjs", 'else if (String(f.fact).includes("|")) out.push(', "else if (false) out.push(", /F: a fact whose text holds a/, "a fact text may hold the | separator"],
    ["lib-prompt-plan.mjs", "if (!comparisonIds.has(id)) { lines.push(", "if (false) { lines.push(", /F: facts for a row that is not a comparison row/, "facts for an unknown or non-comparison row are accepted"],
    ["lib-prompt-plan.mjs", "if (!v.ok) throw new PromptMapError(", "if (false) throw new PromptMapError(", /P: a map row the 5a validator refuses/, "an invalid map row is planned"],
    ["lib-prompt-plan.mjs", 'if (fs.existsSync(a)) return { file: a, rel: "approved/prompt-map.json", approved: true };', "", /P: approved\/prompt-map.json is read in preference/, "the approved map is ignored"],
    ["lib-prompt-plan.mjs", 'export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");', 'export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex").toUpperCase();', /P: plan\/prompt-coverage.json: map is the sha256/, "coverage.map is not the sha256 of the map file"],
    ["lib-prompt-plan.mjs", "off-site item ${mentionId(r)} in plan/offsite.json: ", "", /P: coverage: an earn-mention row has coveredBy null/, "an earn-mention reason no longer names its off-site item"],
    ["lib-prompt-plan.mjs", "coveredBy: pathOf.get(r.id) ?? null,", "coveredBy: null,", /P: coverage: improve and new rows are covered/, "no row is covered by a page in the coverage file"],
    ["plan-site.mjs", "if (route) for (const { row, path: p } of route.improve) (byPath.get(p).prompts ||= []).push(row);", "", /P: improve-page puts the prompt/, "improve-page no longer adds the prompt to the brief"],
    ["plan-site.mjs", "if (pm) offsite.promptMentions = ", "if (false) offsite.promptMentions = ", /P: earn-mention goes to plan\/offsite.json/, "earn-mention rows are not written to offsite.json"],
    ["plan-site.mjs", "} else fs.rmSync(coveragePath, { force: true });", "} else void 0;", /P: the map removed and the plan run again/, "a stale coverage file is kept when the map is gone"],
    ["plan-site.mjs", "if (comparisonRows.length && !fs.existsSync(path.join(pewp, FACTS_FILE))) writeJson(", "if (comparisonRows.length) writeJson(", /F: hand-filled comparison-facts.json is not overwritten/, "comparison-facts.json is overwritten on every plan run"],
    ["plan-site.mjs", 'if (pg.promptRow) { pg.parent = "/"; continue; }', "", /P: plan-site runs on the fixtures with a four-row map/, "a prompt page is compared with clusters it does not have"],
    ["plan-site.mjs", 'if (pg.kind === "comparison") { const fl = factsOf.get(pg.promptRow.id) || [];', 'if (false) { const fl = factsOf.get(pg.promptRow.id) || [];', /P: the comparison brief carries/, "a comparison brief has no section of facts about the other option"],
    ["plan-site.mjs", 'case "situation": case "comparison": return ["Article", ...faq];', 'case "situation": case "comparison": return ["WebPage", ...faq];', /P: new-page (situation|comparison)/, "situation and comparison pages get the wrong schema"],
    ["plan-site.mjs", ": pg.promptRow ? pg.head : pg.kind === \"hub\"", ": pg.kind === \"hub\"", /P: the situation page's title carries its scenario/, "a prompt page is titled with the brand name only"],
    ["plan-site.mjs", '? "vs" : "situations"', '? "situations" : "situations"', /P: new-page comparison/, "a comparison page is put under /situations/"],
    ["gate-prompt-coverage.mjs", "if (!nonEmpty(c.reason)) { bad.push(", "if (false) { bad.push(", /G: GT-014 FAIL a row with neither a page nor a reason/, "a row with no page and no reason passes"],
    ["gate-prompt-coverage.mjs", "if (!pg) { bad.push(", "if (false) { bad.push(", /G: GT-014 FAIL a row covered by a path that is not a page of the plan/, "a covering path that is not a planned page passes"],
    ["gate-prompt-coverage.mjs", "if (!listed.includes(r.id)) {", "if (false) {", /G: GT-014 FAIL a covering page whose brief does not list/, "a covering page whose brief lacks the row id passes"],
    ["gate-prompt-coverage.mjs", "if (!built1) {", "if (false) {", /G: GT-014 FAIL a row covered by a planned page that is not built/, "a covering page that is not built passes"],
    ["gate-prompt-coverage.mjs", "if (!c) { bad.push(", "if (false) { bad.push(", /G: GT-014 FAIL a map row that the coverage file does not list/, "a map row missing from the coverage file passes"],
    ["gate-prompt-coverage.mjs", "if (cov.map !== sha) bad.push(", "if (false) bad.push(", /G: GT-014 FAIL a coverage file made for another version/, "a stale coverage file passes"],
    ["gate-prompt-coverage.mjs", "if (!hasCov) return fail(", "if (false) return fail(", /G: GT-014 FAIL a prompt map with no coverage file/, "a map with no coverage file passes or crashes"],
    ["gate-prompt-coverage.mjs", "if (!(offsite.promptMentions || []).some(", "if (false && !(offsite.promptMentions || []).some(", /G: GT-014 FAIL an earn-mention row whose item is missing/, "an earn-mention row with no off-site item passes"],
    ["gate-prompt-coverage.mjs", "for (const pr of f.problems) bad.push(", "for (const pr of f.problems) void (", /G: GT-014 FAIL a comparison brief line with/, "a comparison fact line with no URL or date passes"],
    ["gate-prompt-coverage.mjs", "if (!lines) { bad.push(", "if (false) { bad.push(", /G: GT-014 FAIL a comparison page whose brief has no/, "a comparison brief without the facts section passes"],
    ["gate-prompt-coverage.mjs", "for (const c of cov.rows) if (c && !rows.some(", "for (const c of cov.rows) if (false && !rows.some(", /G: GT-014 FAIL a coverage row whose id is not in the map/, "a coverage row for a row that is gone passes"],
    ["gate-prompt-coverage.mjs", "if (!src) return cannot(", "if (!src) return pass(", /G: GT-014 ERROR \(cannot judge\) a coverage file with no map/, "a coverage file with no map passes"],
    ["gate-prompt-coverage.mjs", "if (!src && !hasCov) return pass(", "if (false) return pass(", /G: GT-014 PASS and says so when the project has no prompt map/, "a project with no prompt map is judged"],
    ["gate.mjs", "freshness, promptCoverage];", "freshness];", /G: GT-014 is wired into gate.mjs/, "GT-014 is not wired into the gate"],
    ["approve.mjs", "if (!v.ok) return [`prompt-map.json is not a valid prompt map", "if (false) return [`prompt-map.json is not a valid prompt map", /A: approve prompt-map refuses a map the validator refuses/, "approve signs a prompt map the validator refuses"],
    ["approve.mjs", 'const EXCLUDE_PLAN = new Set(["programmatic-data.json"]);', 'const EXCLUDE_PLAN = new Set(["programmatic-data.json", "prompt-coverage.json"]);', /A: approve plan copies plan\/prompt-coverage.json/, "approve plan does not copy the coverage file"],
  ];
  const results = new Array(MUTANTS.length), jobs = [];
  for (const [i, [file, from, to, expectRe, why]] of MUTANTS.entries()) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-ppm-"));
    fs.cpSync(SCRIPTS, path.join(root, "scripts"), { recursive: true });
    fs.cpSync(path.join(SCRIPTS, "..", "rules"), path.join(root, "rules"), { recursive: true });
    const f = path.join(root, "scripts", file), src = fs.readFileSync(f, "utf8"), n = src.split(from).length - 1;
    if (n !== 1) { results[i] = { i, file, why, status: n ? "PATCH-AMBIGUOUS" : "PATCH-NEVER-APPLIED", detail: `${n} x ${from}` }; continue; }
    fs.writeFileSync(f, src.split(from).join(to));
    jobs.push({ i, file, why, expectRe, root });
  }
  const runJob = (j) => new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(j.root, "scripts", "test-prompt-plan.mjs"), "--suite-json", path.join(j.root, "scripts"), "--fixtures", FIX], { stdio: ["ignore", "pipe", "pipe"] });
    let o = ""; c.stdout.on("data", (d) => (o += d));
    const t = setTimeout(() => c.kill(), 15 * 60_000); // a mutant that hangs is killed and reported, never waited on forever
    c.on("close", () => {
      clearTimeout(t);
      let rs; try { rs = JSON.parse(o); } catch { rs = [{ name: "mutant suite did not finish", ok: false }]; }
      const red = rs.filter((r) => !r.ok), right = red.filter((r) => j.expectRe.test(r.name));
      results[j.i] = { i: j.i, file: j.file, why: j.why, status: right.length ? "RED (right reason)" : red.length ? "RED (other reason only)" : "GREEN (survived)", red: red.length, detail: (right[0] || red[0] || {}).name };
      try { fs.rmSync(j.root, { recursive: true, force: true }); } catch {}
      resolve();
    });
  });
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(4, os.cpus().length) }, async () => { while (queue.length) await runJob(queue.shift()); }));
  for (const r of results) console.log(`M mutant ${String(r.i + 1).padStart(2)} ${r.file}: ${r.why} -> ${r.status}${r.red ? ` (${r.red} failing; e.g. ${r.detail})` : r.detail ? ` ${r.detail}` : ""}`);
  const ok = results.filter((r) => r.status === "RED (right reason)").length;
  console.log(`${ok === results.length ? "PASS" : "FAIL"} mutants ${ok}/${results.length} went red for the right reason`);
  if (ok !== results.length) failed++;
}
process.exit(failed ? 1 : 0);
