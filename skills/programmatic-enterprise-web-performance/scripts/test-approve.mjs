// Usage: node test-approve.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>] [--group a|b|c|d]
// Proof of the overhaul's owner-approval side (contracts C1, C2, C3 and the authority gate G8):
//   A  approve.mjs business | competitors | seeds: refusals (provenance, evidence, from), diff/sign/lock, approvedMatches, --check, history
//   B  intake.mjs: answeredBy provenance, vocabulary, notOffer, editorial-media, the multi-region default (G16)
//   C  competitors-discover.mjs: the three real markdown layouts (fixtures/competitors/), evidence, closeness, merge, the discovery brief
//   D  authority.mjs: --approved-competitors, --require-approved, --download-only (tiny fake Common Crawl release on a local server)
// Fixtures only: no real network (PEWP_CC_BASE points at a closed local port or a local server), no Chrome, no model.
// Mutants: break the code each assertion guards, expect the named assertions red, restore. Exit 0 = every assertion passed and every mutant was caught.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import http from "node:http";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";

const A = process.argv.slice(2);
const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(opt("--scripts", here));
const node = process.execPath;
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof s === "string" || Buffer.isBuffer(s) ? s : JSON.stringify(s, null, 1)); };
const rj = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const CLOSED = "http://127.0.0.1:1/graph"; // nothing listens: any attempt to download fails fast and is never the real internet

async function runScenarios(sdir, groups = ["a", "b", "c", "d"]) {
  const R = [];
  const check = (name, ok, detail = "") => R.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 900) });
  const skill = path.dirname(sdir);
  const imp = (f) => import(pathToFileURL(path.join(sdir, f)).href);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-test-approve-"));
  // cwd is the temp folder: a mutant that writes where it should not (e.g. an out file named "--download-only") lands there, never in the skill root
  const run = (script, args, env = {}) => { const r = spawnSync(node, [path.join(sdir, script), ...args], { encoding: "utf8", timeout: 120000, cwd: tmp, env: { ...process.env, PEWP_CC_BASE: CLOSED, ...env } }); return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), stdout: r.stdout || "", stderr: r.stderr || "" }; };
  const runA = (script, args, env = {}) => new Promise((resolve) => { // cwd = tmp like run(): nothing a mutant writes lands in the skill root
    const p = spawn(node, [path.join(sdir, script), ...args], { cwd: tmp, env: { ...process.env, PEWP_CC_BASE: CLOSED, ...env } });
    let stdout = "", stderr = ""; p.stdout.on("data", (c) => (stdout += c)); p.stderr.on("data", (c) => (stderr += c));
    const t = setTimeout(() => p.kill(), 120000);
    p.on("close", (code) => { clearTimeout(t); resolve({ code, out: stdout + stderr, stdout, stderr }); });
  });
  try {
    // =============================================================== A: approve.mjs business | competitors | seeds
    if (groups.includes("a")) {
      const OWNER_FIELDS = ["kind", "offer", "audience", "goals", "competitors", "brand.constraints", "vocabulary"];
      const allOwner = Object.fromEntries(OWNER_FIELDS.map((f) => [f, "owner"]));
      const bizDoc = (prov, over = {}) => ({ name: "Matter of Place", domain: "matterofplace.com", kind: "editorial-media", industry: null, offer: "An editorial real-estate media platform.", audience: "Owners and listing agents of exceptional homes", vocabulary: ["historic homes", "design-led"], market: { country: "US", language: "en" }, locations: [{ name: "California, New York and Florida", address: null, serviceArea: ["California", "New York", "Florida"] }], goals: ["leads"], competitors: ["dwell.com"], brand: { constraints: ["no hype"] }, existing: { site: "https://matterofplace.com/", searchConsole: true, businessProfile: null, socials: [] }, launchState: "live", rankTracking: { source: "search-console", locations: ["California"], devices: ["mobile"] }, provenance: prov, ...over });
      let n = 0;
      const mk = () => { const p = path.join(tmp, "a", `p${++n}`); fs.mkdirSync(p, { recursive: true }); return p; };
      const ap = (pewp, kind, ...x) => run("approve.mjs", ["--pewp", pewp, kind, ...x]);
      const M = await imp("approve.mjs");

      // business refusals
      let p = mk(); w(path.join(p, "business.json"), bizDoc({ ...allOwner, kind: "unstated", offer: "unstated" }));
      let r = ap(p, "business", "--by", "Ana");
      check("A1: business with kind and offer not answered by the owner is refused (exit 1) and says how to fix", r.code === 1 && /kind, offer were not answered by the owner \(provenance: unstated\)/.test(r.out) && /\{"value":\.\.\., "answeredBy":"owner"\} in intake-answers\.json, run intake again/.test(r.out), r.out);
      check("A1: a refused business writes nothing under approved/", !fs.existsSync(path.join(p, "approved")), fs.existsSync(path.join(p, "approved")) ? "approved/ exists" : "");
      p = mk(); w(path.join(p, "business.json"), bizDoc({ ...allOwner, audience: "site", goals: "default" }));
      r = ap(p, "business", "--by", "Ana");
      check("A1: a stamp of site or default is not the owner: each provenance is named", r.code === 1 && /audience was not answered by the owner \(provenance: site\)/.test(r.out) && /goals was not answered by the owner \(provenance: default\)/.test(r.out), r.out);
      // a delegate answered for the owner: accepted, said out loud, kept in the approved copy and the lock
      const DEL = { by: "head of operations", delegatedBy: "owner", at: "2026-11-11T08:00:00Z" };
      p = mk(); w(path.join(p, "business.json"), bizDoc({ ...allOwner, kind: "delegated", offer: "delegated" }, { delegations: { kind: DEL, offer: DEL } }));
      r = ap(p, "business", "--by", "Ana");
      const apBiz = fs.existsSync(path.join(p, "approved", "business.json")) ? rj(path.join(p, "approved", "business.json")) : null, lockDel = fs.existsSync(path.join(p, "approved", "lock.json")) ? rj(path.join(p, "approved", "lock.json")) : null;
      check("A1: owner-only fields answered by a DELEGATE (provenance delegated, with who, for whom and when) are approved (exit 0), and the run says which fields were delegated and by whom", r.code === 0 && /NOTE 2 owner-only field\(s\) were answered by a delegate for the owner, not by the owner: kind \(by head of operations, delegated by the owner, 2026-11-11T08:00:00Z\); offer/.test(r.out) && /DELEGATED: kind, offer/.test(r.out), r.out);
      check("A1: the stamp shows in the approved copy (provenance delegated, delegations.kind.by) and in the lock (delegated: kind, offer)", apBiz?.provenance?.kind === "delegated" && apBiz.delegations?.kind?.by === "head of operations" && apBiz.delegations.kind.delegatedBy === "owner" && lockDel?.business?.delegated?.map((d) => d.field).join() === "kind,offer", JSON.stringify([apBiz?.provenance?.kind, apBiz?.delegations?.kind, lockDel?.business?.delegated]));
      p = mk(); w(path.join(p, "business.json"), bizDoc({ ...allOwner, kind: "delegated" }));
      r = ap(p, "business", "--by", "Ana");
      check("A1: 'delegated' written by hand, with no record of who and when (business.delegations), proves nothing: refused (exit 1) and says so", r.code === 1 && /kind was not answered by the owner \(provenance: delegated without a record of who and when/.test(r.out) && !fs.existsSync(path.join(p, "approved")), r.out);
      p = mk(); w(path.join(p, "business.json"), bizDoc({ ...allOwner, kind: "delegated", offer: "site" }, { delegations: { kind: DEL } }));
      r = ap(p, "business", "--by", "Ana");
      check("A1: a delegated field does not excuse a site field: offer (site) is still refused while kind (delegated) is accepted", r.code === 1 && /offer was not answered by the owner \(provenance: site\)/.test(r.out) && !/kind was not answered/.test(r.out), r.out);
      p = mk(); const noProv = bizDoc(null); delete noProv.provenance; w(path.join(p, "business.json"), noProv);
      r = ap(p, "business", "--by", "Ana");
      check("A1: a business with no provenance at all (written before this check) is refused, every owner-only field unstated", r.code === 1 && /kind, offer, audience, goals, competitors, brand\.constraints, vocabulary were not answered by the owner \(provenance: unstated\)/.test(r.out), r.out);
      p = mk(); const noVocab = bizDoc(allOwner); delete noVocab.vocabulary; w(path.join(p, "business.json"), noVocab);
      r = ap(p, "business", "--by", "Ana");
      check("A1: vocabulary is owner-only: stamped owner but missing is still refused", r.code === 1 && /vocabulary was not answered by the owner/.test(r.out), r.out);
      p = mk(); const bad = bizDoc(allOwner); delete bad.launchState; w(path.join(p, "business.json"), bad);
      r = ap(p, "business", "--by", "Ana");
      check("A1: a business that fails its own shape (B-001) is refused before provenance is looked at", r.code === 1 && /B-001 launchState/.test(r.out), r.out);
      p = mk();
      r = ap(p, "business", "--by", "Ana");
      check("A1: no business.json => cannot judge (exit 2)", r.code === 2 && /business\.json not found/.test(r.out), r.out);
      r = ap(p, "targets-and-more");
      check("A1: an unknown kind is a usage error (exit 2) that lists the seven kinds (targets, plan, business, competitors, seeds, prompt-map, research-cost)", r.code === 2 && /targets, plan, business, competitors, seeds, prompt-map or research-cost/.test(r.out), r.out);

      // business sign / lock / diff / history / approvedMatches
      p = mk(); w(path.join(p, "business.json"), bizDoc(allOwner));
      check("A2: approvedMatches before any approval says not approved yet", M.approvedMatches(p, "business").ok === false && /not approved yet/.test(M.approvedMatches(p, "business").reason), JSON.stringify(M.approvedMatches(p, "business")));
      r = ap(p, "business");
      check("A2: business without --by shows the first approval and is NOT SIGNED (exit 3), nothing written", r.code === 3 && /First approval of the business/.test(r.out) && /NOT SIGNED/.test(r.out) && !fs.existsSync(path.join(p, "approved", "business.json")), r.out);
      r = ap(p, "business", "--by", "Ana");
      const lock1 = fs.existsSync(path.join(p, "approved", "lock.json")) ? rj(path.join(p, "approved", "lock.json")) : {};
      check("A2: business with --by is approved (exit 0): approved copy equals the source and lock.business carries the sha256 and the signer", r.code === 0 && /PASS approve business/.test(r.out) && fs.existsSync(path.join(p, "approved", "business.json")) && sha(path.join(p, "approved", "business.json")) === sha(path.join(p, "business.json")) && lock1.business?.files?.["business.json"] === sha(path.join(p, "business.json")) && lock1.business?.approvedBy === "Ana", r.out + JSON.stringify(lock1));
      check("A2: approvedMatches is ok right after approval", M.approvedMatches(p, "business").ok === true, JSON.stringify(M.approvedMatches(p, "business")));
      r = ap(p, "business", "--by", "Ana");
      check("A2: approving an unchanged business again is 'no change, already approved' (exit 0)", r.code === 0 && /no change, already approved/.test(r.out), r.out);
      r = run("approve.mjs", ["--pewp", p, "--check"]);
      check("A2: --check covers the business: PASS names the signer", r.code === 0 && /PASS approve-lock 1 approved file\(s\) unchanged, business by Ana/.test(r.out), r.out);
      w(path.join(p, "business.json"), bizDoc(allOwner, { offer: "A different offer" }));
      const am = M.approvedMatches(p, "business");
      check("A2: after the working business.json changes, approvedMatches is not ok and says approve again", am.ok === false && /business\.json changed since it was approved/.test(am.reason) && /approve\.mjs <target> business/.test(am.reason), JSON.stringify(am));
      r = ap(p, "business");
      check("A2: a changed business shows the diff against the approved one and is NOT SIGNED without --by", r.code === 3 && /Diff of business\.json/.test(r.out) && /~ offer:/.test(r.out) && /NOT SIGNED/.test(r.out), r.out);
      r = ap(p, "business", "--by", "Ben");
      const hist = fs.existsSync(path.join(p, "approved", "history")) ? fs.readdirSync(path.join(p, "approved", "history")) : [];
      check("A2: re-approval keeps the replaced copy in approved/history/<time>/ and moves the lock", r.code === 0 && hist.length === 1 && fs.existsSync(path.join(p, "approved", "history", hist[0], "business.json")) && rj(path.join(p, "approved", "history", hist[0], "business.json")).offer === "An editorial real-estate media platform." && rj(path.join(p, "approved", "lock.json")).business.approvedBy === "Ben" && M.approvedMatches(p, "business").ok, r.out + hist.join());
      fs.appendFileSync(path.join(p, "approved", "business.json"), " ");
      r = run("approve.mjs", ["--pewp", p, "--check"]);
      check("A2: an approved business edited by hand fails --check (exit 1) and approvedMatches", r.code === 1 && /business\.json: changed after approval/.test(r.out) && M.approvedMatches(p, "business").ok === false, r.out);

      // lock shared with targets, stray files
      p = mk(); w(path.join(p, "approved", "targets.json"), '{"clusters":[]}\n');
      w(path.join(p, "approved", "lock.json"), { formatVersion: 1, targets: { approvedAt: "2026-10-01T00:00:00Z", approvedBy: "Ana", researchRun: "r", files: { "targets.json": sha(path.join(p, "approved", "targets.json")) } } });
      w(path.join(p, "business.json"), bizDoc(allOwner));
      r = ap(p, "business", "--by", "Ana");
      const lk = rj(path.join(p, "approved", "lock.json"));
      check("A3: approving business keeps the targets entry of an existing lock", r.code === 0 && lk.targets?.approvedBy === "Ana" && lk.business && lk.targets.files["targets.json"], r.out + JSON.stringify(lk));
      r = run("approve.mjs", ["--pewp", p, "--check"]);
      check("A3: --check counts targets and business together", r.code === 0 && /PASS approve-lock 2 approved file\(s\) unchanged, targets by Ana, business by Ana/.test(r.out), r.out);
      w(path.join(p, "approved", "seeds.json"), "{}\n");
      r = run("approve.mjs", ["--pewp", p, "--check"]);
      check("A3: a seeds.json under approved/ that is not in the lock fails --check", r.code === 1 && /approved\/seeds\.json exists but is not in the lock/.test(r.out), r.out);
      p = mk(); w(path.join(p, "approved", "competitors.json"), "{}\n");
      r = run("approve.mjs", ["--pewp", p, "--check"]);
      check("A3: an approved file with no lock.json at all is a problem, not 'nothing approved'", r.code === 1 && /approved\/ has files but no lock\.json/.test(r.out), r.out);

      // competitors
      const row = (over = {}) => ({ name: "Dwell", domain: "dwell.com", handle: null, platform: "web", kind: "publisher", evidenceUrl: "https://www.dwell.com/real-estate", closeness: 4, note: "", ...over });
      const comp = (rows) => ({ step: "competitors-discover", generatedAt: "2026-10-25T00:00:00Z", business: "matterofplace.com", source: [], rows });
      p = mk(); w(path.join(p, "research", "competitors-proposed.json"), comp([row(), row({ name: "No evidence", domain: "a.com", evidenceUrl: null }), row({ name: "No kind", domain: "b.com", kind: "" }), row({ name: "Six", domain: "c.com", closeness: 6 }), row({ name: "Half", domain: "c2.com", closeness: 3.5 }), row({ name: "Nobody", domain: null, handle: null })]));
      r = ap(p, "competitors", "--by", "Ana");
      check("A4: competitors: a row without evidenceUrl is refused by name", r.code === 1 && /No evidence: no evidenceUrl/.test(r.out), r.out);
      check("A4: competitors: a row without kind is refused by name", /No kind: no kind/.test(r.out), r.out);
      check("A4: competitors: closeness 6 and 3.5 are refused (whole number 1..5)", /Six: closeness is not a whole number from 1 to 5/.test(r.out) && /Half: closeness is not a whole number/.test(r.out), r.out);
      check("A4: competitors: a row with neither domain nor handle is refused", /Nobody: neither a domain nor a handle/.test(r.out), r.out);
      check("A4: competitors: a refused list writes nothing", !fs.existsSync(path.join(p, "approved")), "approved/ exists");
      w(path.join(p, "research", "competitors-proposed.json"), comp([row(), row({ name: "@circahouses", domain: null, handle: "@circahouses", platform: "instagram", kind: "social-curator", evidenceUrl: "https://www.instagram.com/circahouses/", closeness: 4 })]));
      r = ap(p, "competitors", "--by", "Ana");
      check("A4: competitors: a valid list (a site and a social account without a domain) is approved to approved/competitors.json", r.code === 0 && /PASS approve competitors: 2 rows/.test(r.out) && rj(path.join(p, "approved", "competitors.json")).rows.length === 2 && rj(path.join(p, "approved", "lock.json")).competitors?.files?.["competitors.json"] === sha(path.join(p, "research", "competitors-proposed.json")), r.out);
      check("A4: approvedMatches(competitors) is ok, then not ok after a row is added", M.approvedMatches(p, "competitors").ok === true && (w(path.join(p, "research", "competitors-proposed.json"), comp([row()])), M.approvedMatches(p, "competitors").ok === false), JSON.stringify(M.approvedMatches(p, "competitors")));
      r = ap(p, "competitors");
      check("A4: a changed competitors list shows what was added/removed against the approved one", r.code === 3 && /- @circahouses/.test(r.out) && /NOT SIGNED/.test(r.out), r.out);

      // seeds
      p = mk(); w(path.join(p, "research", "seeds.json"), { queries: [{ query: "historic homes for sale", from: "the owner's vocabulary: historic homes" }, { query: "chosen by the main session" }] });
      r = ap(p, "seeds", "--by", "Ana");
      check("A5: seeds: a query without `from` refuses the whole file and names the query", r.code === 1 && /1 of 2 queries have no "from"/.test(r.out) && /chosen by the main session/.test(r.out) && !fs.existsSync(path.join(p, "approved")), r.out);
      w(path.join(p, "research", "seeds.json"), { queries: [{ query: "historic homes for sale", from: "the owner's vocabulary: historic homes" }] });
      r = ap(p, "seeds", "--by", "Ana");
      check("A5: seeds: every query with `from` is approved (lock.seeds, approved/seeds.json)", r.code === 0 && /PASS approve seeds: 1 queries/.test(r.out) && !!rj(path.join(p, "approved", "lock.json")).seeds && M.approvedMatches(p, "seeds").ok === true, r.out);
      w(path.join(p, "research", "seeds.json"), { status: "blocked", blocked: "no business" });
      r = ap(p, "seeds", "--by", "Ben");
      check("A5: seeds: a BLOCKED seeds.json (no queries) is refused", r.code === 1 && /BLOCKED/.test(r.out), r.out);

      // research-cost (SKILL-RESEARCHCOST-1): the owner's approval of a research plan's cost is a record, with the same diff / sign / lock as the other file kinds
      const shaOf = (x) => crypto.createHash("sha256").update(x).digest("hex");
      const SRC = "competitor sites (1 request/s each, ~14 requests)", sitesA = ["rival-one.test", "rival-two.test"];
      const costDoc = (over = {}) => ({ step: "research-cost", calls: { "Search Console": 3, "Bing Webmaster": 49, [SRC]: 28 }, total: 80, costInMoney: "$0 (free sources only)", competitors: { sites: sitesA, sha256: shaOf(JSON.stringify(sitesA)) }, ...over });
      const COSTF = (q) => path.join(q, "research", "research-cost.json");
      p = mk();
      r = ap(p, "research-cost", "--by", "Owner");
      check("A7: research-cost: no research/research-cost.json cannot be judged (exit 2) and says to run research.mjs <target> --dry", r.code === 2 && /not found \(run research\.mjs <target> --dry\)/.test(r.out) && !fs.existsSync(path.join(p, "approved")), r.out);
      w(COSTF(p), costDoc());
      r = ap(p, "research-cost", "--by", "Owner");
      const lkC = fs.existsSync(path.join(p, "approved", "lock.json")) ? rj(path.join(p, "approved", "lock.json")) : {};
      check("A7: research-cost: a well-formed cost file is approved (exit 0, PASS line with the total and the site count), the lock has the entry with approvedBy, the approved copy has the working file's bytes", r.code === 0 && /PASS approve research-cost: 80 external calls \(Search Console 3, Bing Webmaster 49, competitor sites \(1 request\/s each, ~14 requests\) 28\), \$0 \(free sources only\), 2 competitor sites/.test(r.out) && lkC["research-cost"]?.approvedBy === "Owner" && lkC["research-cost"]?.files?.["research-cost.json"] === sha(COSTF(p)) && fs.existsSync(path.join(p, "approved", "research-cost.json")) && fs.readFileSync(path.join(p, "approved", "research-cost.json")).equals(fs.readFileSync(COSTF(p))), r.out + JSON.stringify(lkC));
      const refuse = (doc) => { const q = mk(); w(COSTF(q), doc); const x = ap(q, "research-cost", "--by", "Owner"); return { x, left: fs.existsSync(path.join(q, "approved")) }; };
      let rf = refuse(costDoc({ total: 81 }));
      check("A7: research-cost refused: total is not the sum of the calls (exit 1, nothing approved, says to run research.mjs <target> --dry again)", rf.x.code === 1 && /total 81 is not the sum of the calls \(80\)/.test(rf.x.out) && /run research\.mjs <target> --dry again/.test(rf.x.out) && !rf.left, rf.x.out);
      rf = refuse(costDoc({ competitors: { sites: sitesA, sha256: shaOf(JSON.stringify([...sitesA].reverse())) } }));
      check("A7: research-cost refused: competitors.sha256 is not the sha256 of the list of sites (exit 1, nothing approved)", rf.x.code === 1 && /competitors\.sha256 is not the sha256 of competitors\.sites/.test(rf.x.out) && !rf.left, rf.x.out);
      rf = refuse(costDoc({ calls: { "Search Console": 3, "Bing Webmaster": 1.5 }, total: 4.5 }));
      check("A7: research-cost refused: a number of calls that is not a whole number of 0 or more (exit 1, nothing approved)", rf.x.code === 1 && /Bing Webmaster: 1\.5 is not a whole number of 0 or more/.test(rf.x.out) && !rf.left, rf.x.out);
      rf = refuse(costDoc({ calls: {}, total: 0 }));
      check("A7: research-cost refused: calls empty is not an object with at least one source (exit 1, nothing approved)", rf.x.code === 1 && /calls is not an object with at least one source/.test(rf.x.out) && !rf.left, rf.x.out);
      rf = refuse(costDoc({ costInMoney: " " }));
      check("A7: research-cost refused: costInMoney empty is not a text (exit 1, nothing approved)", rf.x.code === 1 && /costInMoney is not a non-empty text/.test(rf.x.out) && !rf.left, rf.x.out);
      const sitesB = ["rival-one.test", ""];
      rf = refuse(costDoc({ competitors: { sites: sitesB, sha256: shaOf(JSON.stringify(sitesB)) } }));
      check("A7: research-cost refused: a site that is not a non-empty text (exit 1, nothing approved)", rf.x.code === 1 && /competitors\.sites is not a list of non-empty texts/.test(rf.x.out) && !rf.left, rf.x.out);
      const sitesC = ["rival-one.test", "rival-three.test"];
      w(COSTF(p), costDoc({ calls: { "Search Console": 3, "Bing Webmaster": 25, [SRC]: 42 }, total: 70, costInMoney: "$0 (free sources only, changed)", competitors: { sites: sitesC, sha256: shaOf(JSON.stringify(sitesC)) } }));
      r = ap(p, "research-cost");
      check("A7: research-cost: approving again after numbers and a site changed prints one diff line per change (a source, total, cost in money, + site, - site) and is NOT SIGNED without --by (exit 3)", r.code === 3 && /~ Bing Webmaster: 49 -> 25/.test(r.out) && /~ competitor sites \(1 request\/s each, ~14 requests\): 28 -> 42/.test(r.out) && /~ total: 80 -> 70/.test(r.out) && /~ cost in money: \$0 \(free sources only\) -> \$0 \(free sources only, changed\)/.test(r.out) && /\+ rival-three\.test/.test(r.out) && /- rival-two\.test/.test(r.out) && /NOT SIGNED/.test(r.out) && !/~ Search Console/.test(r.out), r.out);
      r = ap(p, "research-cost", "--by", "Ben");
      check("A7: research-cost: the changed record is signed (exit 0) and the lock moves to the new signer", r.code === 0 && rj(path.join(p, "approved", "lock.json"))["research-cost"]?.approvedBy === "Ben" && M.approvedMatches(p, "research-cost").ok === true, r.out);
      if (fs.existsSync(path.join(p, "approved", "research-cost.json"))) fs.appendFileSync(path.join(p, "approved", "research-cost.json"), " ");
      r = run("approve.mjs", ["--pewp", p, "--check"]);
      check("A7: research-cost: an approved cost record edited by hand fails --check (exit 1)", r.code === 1 && /research-cost\.json: changed after approval/.test(r.out), r.out);

      // discover -> approve end to end on the real fixtures
      p = mk();
      for (const f of fs.readdirSync(path.join(skill, "fixtures", "competitors"))) fs.copyFileSync(path.join(skill, "fixtures", "competitors", f), (fs.mkdirSync(path.join(p, "inputs"), { recursive: true }), path.join(p, "inputs", f)));
      const d = run("competitors-discover.mjs", ["x", "--pewp", p]);
      r = ap(p, "competitors", "--by", "Ana");
      check("A6: the proposed list competitors-discover.mjs writes from the three real files is approvable as it is (every row has evidence, kind, closeness, a domain or handle)", r.code === 0 && rj(path.join(p, "approved", "competitors.json")).rows.length === rj(path.join(p, "research", "competitors-proposed.json")).rows.length, d.out.slice(0, 300) + r.out);
    }

    // =============================================================== B: intake.mjs
    if (groups.includes("b")) {
      const I = await imp("intake.mjs");
      const rules = path.join(tmp, "b", "rules"); w(path.join(rules, "industries", "editorial-media.json"), '{"industry":"editorial-media"}\n'); w(path.join(rules, "industries", "real-estate-agent.json"), "{}\n");
      const rulesNone = path.join(tmp, "b", "rules-none"); w(path.join(rulesNone, "industries", "real-estate-agent.json"), "{}\n");
      const cwd = path.join(tmp, "b");
      const home = (type) => `<!doctype html><html lang="en-US"><head><title>Matter of Place</title><meta name="description" content="An editorial platform for exceptional homes."><script type="application/ld+json">{"@context":"https://schema.org","@type":"${type}","name":"Matter of Place","sameAs":["https://www.instagram.com/matterofplace"]}</script></head><body><h1>Historic homes and architecture</h1><p>Historic homes, architecture, and every feature names the architect. Zebrafish appears once.</p><p>A roundup of historic homes.</p></body></html>`;
      const host = (h, html) => { const root = path.join(cwd, "site-checks", h); if (html) { w(path.join(root, "snapshots", "2026-10-20", "_site.json"), { finishedAt: "2026-10-20T10:00:00Z", pages: [{ url: `https://${h}/`, slug: "home", status: 200 }], stoppedEarly: null }); w(path.join(root, "snapshots", "2026-10-20", "pages", "home", "raw.html.gz"), zlib.gzipSync(html)); } return { url: `https://${h}/`, pewp: path.join(root, ".pewp") }; };
      const bare = (v) => v;
      const own = (v) => ({ value: v, answeredBy: "owner" });
      const answers = (f, over = {}) => ({ kind: f("editorial-media"), offer: f("An editorial real-estate media platform."), audience: f("Owners and listing agents of exceptional homes"), goals: f(["leads"]), competitors: f(["dwell.com"]), "brand.constraints": f(["no hype"]), "market.country": f("US"), locations: f([{ name: "California, New York and Florida", address: null, serviceArea: ["California", "New York", "Florida"] }]), "existing.searchConsole": f(true), "existing.businessProfile": f(null), ...over });
      const intake = (h, args = [], env = {}) => run("intake.mjs", [h.url, "--cwd", cwd, ...args], { PEWP_RULES_DIR: rules, ...env });
      const biz = (h) => (fs.existsSync(path.join(h.pewp, "business.json")) ? rj(path.join(h.pewp, "business.json")) : null);
      const qsOf = (out) => { const m = out.match(/QUESTIONS \d+\n([\s\S]*?)\nBLOCKED/); try { return JSON.parse(m[1]); } catch { return []; } };

      // questions first (no answers): vocabulary options from the site's own words, kind offers editorial-media
      const m1 = host("mediasite.test", home("NewsMediaOrganization"));
      let r = intake(m1); let qs = qsOf(r.out);
      const qv = qs.find((q) => q.field === "vocabulary"), qk = qs.find((q) => q.field === "kind");
      check("B1: a media site's own markup type is offered first as the business kind (editorial-media), never assumed", r.code === 3 && qk?.options[0].value === "editorial-media" && qk.options.length <= 4 && !biz(m1), r.out.slice(-600));
      check("B1: vocabulary is asked as a multi-select whose options are the words the home page repeats (and not a word seen once)", qv?.multiSelect === true && qv.optional === true && ["historic", "homes", "architecture"].every((x) => qv.options.some((o) => o.value === x)) && !qv.options.some((o) => o.value === "zebrafish") && qv.options.length === 3, JSON.stringify(qv));
      const facts = rj(path.join(m1.pewp, "intake-facts.json")).facts;
      check("B1: the repeated words are a suggestion fact (confidence suggest), not an accepted answer", facts.find((f) => f.field === "vocabulary.candidates")?.confidence === "suggest" && facts.find((f) => f.field === "vocabulary.candidates").value.includes("historic") && !rj(path.join(m1.pewp, "intake-facts.json")).accepted.some((x) => x.field === "vocabulary"), JSON.stringify(facts.find((f) => f.field === "vocabulary.candidates")));
      const m0 = host("nosnapshot.test", null);
      r = intake(m0); qs = qsOf(r.out);
      const q0v = qs.find((q) => q.field === "vocabulary"), q0k = qs.find((q) => q.field === "kind");
      check("B1: with no snapshot vocabulary is free text (one 'I will type them' option) and the kind question still offers editorial-media", q0v?.options.length === 1 && q0v.options[0].value === null && q0k?.options.some((o) => o.value === "editorial-media") && q0k.options.length <= 4, JSON.stringify([q0v, q0k]));
      check("B1: the 'answers missing' count leaves out the optional questions", /BLOCKED: \d+ answers missing \(and 2 optional, asked with them\)/.test(r.out), r.out.slice(-300));
      for (const [t, name] of [["NewsMediaOrganization", "NewsMediaOrganization"], ["Periodical", "Periodical"], ["Blog", "Blog"]]) {
        const f = I.siteFacts({ html: home(t), finishedAt: "2026-10-20T10:00:00Z" }, "t").find((x) => x.field === "kind");
        check(`B2: JSON-LD ${name} reads as kind editorial-media`, f?.value === "editorial-media", JSON.stringify(f));
      }

      // bare (legacy) answers: still COMPLETE, provenance unstated; site facts site; defaults default
      w(path.join(m1.pewp, "intake-answers.json"), answers(bare));
      r = intake(m1);
      let b = biz(m1);
      check("B3: bare legacy answers still end COMPLETE (exit 0) with business.json written", r.code === 0 && /^COMPLETE /m.test(r.out) && !!b, r.out.slice(0, 400));
      check("B3: provenance says unstated for every owner-only field a bare answer filled", ["kind", "offer", "audience", "goals", "competitors", "brand.constraints", "locations", "market.country", "existing.searchConsole"].every((f) => b?.provenance?.[f] === "unstated"), JSON.stringify(b?.provenance));
      check("B3: provenance says site for what was read from the site and default for what the script defaulted", b?.provenance?.name === "site" && b.provenance.domain === "site" && b.provenance["market.language"] === "site" && b.provenance.launchState === "site" && b.provenance["rankTracking.devices"] === "default" && b.provenance["rankTracking.source"] === "default" && b.provenance["rankTracking.locations"] === "default", JSON.stringify(b?.provenance));
      check("B3: the run says which owner-only fields have no owner answer and what approve will do about it", /NOTE no owner answer for: kind, offer, audience, goals, competitors, brand\.constraints, vocabulary\./.test(r.out) && /approve\.mjs business will refuse/.test(r.out) && /provenance: owner 0, delegated 0, site \d+, default \d+, unstated \d+/.test(r.out), r.out);
      check("B3: vocabulary missing does not block (exit 0) but is listed as an optional question; business has no vocabulary", b && !("vocabulary" in b) && /OPTIONAL QUESTIONS 2/.test(r.out), r.out.slice(-500));
      check("B3: industry follows kind editorial-media when rules/industries/editorial-media.json exists (provenance default)", b?.industry === "editorial-media" && b.provenance.industry === "default", JSON.stringify([b?.industry, b?.provenance?.industry]));
      r = intake(m1, ["--refresh"], { PEWP_RULES_DIR: rulesNone });
      check("B3: without rules/industries/editorial-media.json the industry stays null (and is not an error)", r.code === 0 && biz(m1)?.industry === null && !("industry" in biz(m1).provenance), r.out.slice(0, 300) + JSON.stringify(biz(m1)?.industry));
      // G16
      b = (intake(m1, ["--refresh"]), biz(m1));
      check("B4: G16 a location named 'California, New York and Florida' defaults rankTracking.locations to the three served states, never the label", JSON.stringify(b?.rankTracking.locations) === '["California","New York","Florida"]' && !b.rankTracking.locations.some((x) => / and |,/.test(x)), JSON.stringify(b?.rankTracking));
      r = intake(m1, ["--refresh"]);
      check("B4: G16 the printed default says why", /default\s+rankTracking\.locations: \["California","New York","Florida"\]\s+\("California, New York and Florida" lists several places/.test(r.out), r.out);
      check("B4: isRegionLabel: ' and ', '&', ';' and two commas are labels; a city and a one-comma place are not", ["A and B", "A & B", "A; B", "A, B, C"].every((x) => I.isRegionLabel(x)) && ["Tracy", "Tracy, CA", "New York"].every((x) => !I.isRegionLabel(x)), "");
      const t1 = host("tracy.test", null);
      w(path.join(t1.pewp, "intake-answers.json"), answers(bare, { name: "Tracy Homes", "market.language": "en", launchState: "live", locations: { name: "Tracy, CA", address: null, serviceArea: ["Manteca", "Lathrop"] } }));
      r = intake(t1);
      check("B4: a single-place location keeps the old default (Tracy, CA | Manteca, CA | Lathrop, CA)", r.code === 0 && biz(t1)?.rankTracking.locations.join("|") === "Tracy, CA|Manteca, CA|Lathrop, CA", r.out.slice(0, 300) + JSON.stringify(biz(t1)?.rankTracking));

      // wrapped answers
      w(path.join(m1.pewp, "intake-answers.json"), answers(own, { vocabulary: own(["historic homes", "architecture"]), notOffer: own("  not a brokerage  ") }));
      r = intake(m1, ["--refresh"]); b = biz(m1);
      check("B5: {value, answeredBy:'owner'} answers fill the business with the plain values and stamp the six owner-only fields owner", r.code === 0 && b?.kind === "editorial-media" && JSON.stringify(b.goals) === '["leads"]' && b.locations[0].serviceArea.length === 3 && ["kind", "offer", "audience", "goals", "competitors", "brand.constraints", "vocabulary", "locations", "market.country", "existing.searchConsole"].every((f) => b.provenance[f] === "owner"), r.out.slice(0, 300) + JSON.stringify(b?.provenance));
      check("B5: vocabulary is stored as the owner's list and notOffer trimmed; an owner-only NOTE is no longer printed", JSON.stringify(b?.vocabulary) === '["historic homes","architecture"]' && b.notOffer === "not a brokerage" && b.provenance.notOffer === "owner" && !/NOTE no owner answer/.test(r.out) && !/OPTIONAL QUESTIONS/.test(r.out), r.out);
      w(path.join(m1.pewp, "intake-answers.json"), answers(own, { vocabulary: own(["x"]), kind: { value: "editorial-media", answeredBy: "site" }, offer: { value: "A line.", answeredBy: "default" }, audience: { value: "Readers", answeredBy: "claude" } }));
      r = intake(m1, ["--refresh"]); b = biz(m1);
      check("B5: answeredBy site and default are kept; any other word (claude) is unstated, never owner", b?.provenance.kind === "site" && b.provenance.offer === "default" && b.provenance.audience === "unstated" && b.provenance.goals === "owner", JSON.stringify(b?.provenance));
      // a delegation object stamps "delegated"; a bare word or a half-filled object does not
      const DEL = { by: "head of operations", delegatedBy: "owner", at: "2026-11-11T08:00:00Z" };
      w(path.join(m1.pewp, "intake-answers.json"), answers(own, { vocabulary: own(["x"]), kind: { value: "editorial-media", answeredBy: DEL }, offer: { value: "A line.", answeredBy: "delegated" }, audience: { value: "Readers", answeredBy: { by: "head of operations", delegatedBy: "owner" } }, goals: { value: ["leads"], answeredBy: { by: "someone", delegatedBy: "site", at: "2026-11-11T08:00:00Z" } } }));
      r = intake(m1, ["--refresh"]); b = biz(m1);
      check("B5: answeredBy { by, delegatedBy: 'owner', at } is provenance 'delegated' and business.delegations keeps who and when", b?.provenance.kind === "delegated" && b.delegations?.kind?.by === "head of operations" && b.delegations.kind.delegatedBy === "owner" && b.delegations.kind.at === "2026-11-11T08:00:00Z" && /delegated 1/.test(r.out), JSON.stringify([b?.provenance.kind, b?.delegations, r.out.slice(0, 300)]));
      check("B5: the bare word 'delegated', an object with no date, and an object not delegated by the owner are unstated (they name nobody or nothing): no delegations entry for them", b?.provenance.offer === "unstated" && b.provenance.audience === "unstated" && b.provenance.goals === "unstated" && Object.keys(b.delegations || {}).join() === "kind", JSON.stringify([b?.provenance, b?.delegations]));
      // vocabulary rules
      w(path.join(m1.pewp, "intake-answers.json"), answers(own, { vocabulary: own([]) }));
      fs.rmSync(path.join(m1.pewp, "business.json"), { force: true });
      r = intake(m1, ["--refresh"]); qs = qsOf(r.out);
      const qi = qs.find((q) => q.field === "vocabulary");
      check("B6: vocabulary [] is not an answer: exit 3, the question comes back with the reason, business.json is not written", r.code === 3 && qi && /\[\] is not an answer/.test(qi.invalid || "") && qi.optional !== true && !biz(m1), r.out.slice(-500));
      w(path.join(m1.pewp, "intake-answers.json"), answers(own));
      r = intake(m1, ["--refresh", "--require-vocabulary"]); qs = qsOf(r.out);
      check("B6: --require-vocabulary blocks on a missing vocabulary and asks it as a required question", r.code === 3 && qs.find((q) => q.field === "vocabulary") && qs.find((q) => q.field === "vocabulary").optional !== true && /BLOCKED: 1 answers missing/.test(r.out), r.out.slice(-400));
      w(path.join(m1.pewp, "intake-answers.json"), answers(own, { vocabulary: own("historic homes, design-led") }));
      r = intake(m1, ["--refresh", "--require-vocabulary"]);
      check("B6: a typed comma list is split into the vocabulary words and --require-vocabulary completes", r.code === 0 && JSON.stringify(biz(m1)?.vocabulary) === '["historic homes","design-led"]', r.out.slice(0, 300));
      // a later --answers file wins, and its stamp with it
      w(path.join(tmp, "b", "more.json"), { offer: { value: "A newer line.", answeredBy: "owner" } });
      w(path.join(m1.pewp, "intake-answers.json"), answers(bare));
      r = intake(m1, ["--refresh", "--answers", path.join(tmp, "b", "more.json")]); b = biz(m1);
      check("B7: an --answers file overrides the value and the stamp (offer owner), the rest stays unstated", b?.offer === "A newer line." && b.provenance.offer === "owner" && b.provenance.kind === "unstated", JSON.stringify(b?.provenance));
    }

    // =============================================================== C: competitors-discover.mjs
    if (groups.includes("c")) {
      const D = await imp("competitors-discover.mjs");
      const fx = path.join(skill, "fixtures", "competitors");
      const parse = (f) => D.parseCompetitorsMd(fs.readFileSync(path.join(fx, f), "utf8"), "inputs/" + f);
      const media = parse("competitors-media-agencies.md"), social = parse("competitors-social.md"), web = parse("competitors-web-newsletters.md");
      check("C1: the three real files give 25, 25 and 30 competitor rows", media.rows.length === 25 && social.rows.length === 25 && web.rows.length === 30, [media.rows.length, social.rows.length, web.rows.length].join());
      check("C1: the 9-row verdict table under '## Your named candidates' is not imported (30 rows, nothing dropped, one table)", web.dropped.length === 0 && D.tablesOf(fs.readFileSync(path.join(fx, "competitors-web-newsletters.md"), "utf8")).length === 1 && /Your named candidates/.test(fs.readFileSync(path.join(fx, "competitors-web-newsletters.md"), "utf8")), JSON.stringify(web.dropped));
      const verdictOnly = D.parseCompetitorsMd("| Candidate | Verdict |\n|---|---|\n| a.com | Confirm |\n");
      check("C1: a table with no Domain or Handle column is ignored whole (no row, nothing even dropped)", verdictOnly.rows.length === 0 && verdictOnly.dropped.length === 0, JSON.stringify(verdictOnly));
      const find = (rows, f) => rows.find(f);
      const circa = find(social.rows, (r) => r.handle === "@circahouses");
      check("C2: @circahouses is an instagram social-curator with its domain, closeness 4 and the Instagram URL as evidence", circa && circa.platform === "instagram" && circa.kind === "social-curator" && circa.domain === "circaoldhouses.com" && circa.closeness === 4 && circa.evidenceUrl === "https://www.instagram.com/circahouses/", JSON.stringify(circa));
      const haute = find(media.rows, (r) => r.domain === "hauteliving.com");
      check("C2: hauteliving.com is paid-media (the first of two domains in its cell), closeness 4, the first URL of the row as evidence, the other domain in the note", haute && haute.kind === "paid-media" && haute.platform === "web" && haute.closeness === 4 && haute.evidenceUrl === "https://hauteliving.com/realestate/membership" && /also: hauteresidence\.com/.test(haute.note), JSON.stringify(haute));
      const tmh = find(web.rows, (r) => r.domain === "themodernhouse.com");
      check("C2: themodernhouse.com (web table, 'closeness 5 as a model') is web, design-broker, closeness 5, its source URL as evidence", tmh && tmh.platform === "web" && tmh.kind === "design-broker" && tmh.closeness === 5 && /businessofhome\.com/.test(tmh.evidenceUrl), JSON.stringify(tmh));
      check("C2: platforms: Substack rows are substack, 'IG, newsletter' is instagram, a link-in-bio is not a domain", find(social.rows, (r) => /Know a Spot/.test(r.name))?.platform === "substack" && find(social.rows, (r) => r.handle === "@takesunset")?.domain === null && find(social.rows, (r) => r.handle === "@luxury_listings")?.handle === "@luxury_listings", JSON.stringify(social.rows.filter((r) => /takesunset|luxury/.test(r.name))));
      const enes = find(social.rows, (r) => /Enes/.test(r.name));
      check("C2: a row with no domain and no @ name takes its handle from its profile URL and says so (Enes Yilmazer)", enes && enes.handle === "@enesyilmazer" && enes.domain === null && /taken from its profile URL/.test(enes.note), JSON.stringify(enes));
      const agency = find(web.rows, (r) => r.domain === "theagencyre.com");
      check("C2: an escaped pipe inside a cell (\"PROPERTY NAME \\| CITY\") does not shift the columns: closeness 3 and a source URL", agency && agency.closeness === 3 && /theagencyre\.com\/blog/.test(agency.evidenceUrl) && /PROPERTY NAME \| CITY/.test(agency.note), JSON.stringify(agency));
      const pipe = D.parseCompetitorsMd('| # | Domain | What they publish | Closeness | Source |\n|---|---|---|---|---|\n| 1 | e.com | named "A \\| B" | 4 | https://e.com/x |\n').rows[0];
      check("C2: an escaped pipe in a description keeps the columns: closeness 4 and the Source URL, with the pipe back in the text", pipe && pipe.closeness === 4 && pipe.evidenceUrl === "https://e.com/x" && /named "A \| B"/.test(pipe.note), JSON.stringify(pipe));
      check("C2: Type text maps to kind: Agency/reseller agency, Brokerage program brokerage-program", find(media.rows, (r) => r.domain === "ruhm.com")?.kind === "agency" && find(media.rows, (r) => r.domain === "luxvt.com")?.kind === "agency" && find(media.rows, (r) => r.domain === "compass.com")?.kind === "brokerage-program", "");
      check("C2: every parsed row has evidence, a kind from the list, a platform from the list and closeness 1..5", [...media.rows, ...social.rows, ...web.rows].every((r) => r.evidenceUrl && D.KINDS.includes(r.kind) && D.PLATFORMS.includes(r.platform) && Number.isInteger(r.closeness) && r.closeness >= 1 && r.closeness <= 5 && (r.domain || r.handle)), "");

      // the CLI on the fixtures
      const cwd = path.join(tmp, "c");
      const pew = path.join(cwd, "site-checks", "mediasite.test", ".pewp");
      for (const f of fs.readdirSync(fx)) { fs.mkdirSync(path.join(pew, "inputs"), { recursive: true }); fs.copyFileSync(path.join(fx, f), path.join(pew, "inputs", f)); }
      let r = run("competitors-discover.mjs", ["https://mediasite.test/", "--cwd", cwd]);
      const doc = fs.existsSync(path.join(pew, "research", "competitors-proposed.json")) ? rj(path.join(pew, "research", "competitors-proposed.json")) : null;
      check("C3: the CLI writes competitors-proposed.json: step, business, the three source files, the merged rows", r.code === 0 && doc?.step === "competitors-discover" && doc.business === "mediasite.test" && doc.source.join() === "inputs/competitors-media-agencies.md,inputs/competitors-social.md,inputs/competitors-web-newsletters.md" && doc.rows.length === 67 && doc.needsEvidence.length === 0, r.out.slice(0, 400) + (doc ? doc.rows.length : "no file"));
      check("C3: the same site listed in two files is one row, the first file wins and the note says where else it was listed", doc && doc.rows.filter((x) => x.domain === "hauteliving.com").length === 1 && doc.rows.find((x) => x.domain === "hauteliving.com").kind === "paid-media" && /also listed in inputs\/competitors-web-newsletters\.md as publisher/.test(doc.rows.find((x) => x.domain === "hauteliving.com").note) && doc.rows.filter((x) => x.handle === "@themodernhouse").length === 1 && doc.rows.filter((x) => x.domain === "themodernhouse.com").length === 2, "");
      check("C3: rows are listed closest first", doc && doc.rows.every((x, i, a) => i === 0 || a[i - 1].closeness >= x.closeness) && doc.rows[0].closeness === 5, "");
      const md = fs.existsSync(path.join(pew, "research", "competitors-proposed.md")) ? fs.readFileSync(path.join(pew, "research", "competitors-proposed.md"), "utf8") : "";
      check("C3: competitors-proposed.md is a table with name, where, kind, closeness and evidence for each row", /\| # \| Name \| Where \| Kind \| Closeness \| Evidence \|/.test(md) && /\| @circahouses \| @circahouses · circaoldhouses\.com \(instagram\) \| social-curator \| 4 \| https:\/\/www\.instagram\.com\/circahouses\/ \|/.test(md) && md.split("\n").filter((l) => /^\| \d+ \|/.test(l)).length === 67, md.slice(0, 600));
      check("C3: the run says how many rows have a domain (for the link comparison) and what comes next", /67 rows/.test(r.out) && /with a domain/.test(r.out) && /approve\.mjs .* competitors --by/.test(r.out), r.out);

      // gaps: no URL, closeness unreadable, candidates file, rows nobody can track
      const cwd2 = path.join(tmp, "c2"), pew2 = path.join(cwd2, "site-checks", "gap.test", ".pewp");
      w(path.join(pew2, "inputs", "competitors-x.md"), "| # | Domain | What they publish | Closeness | Source |\n|---|---|---|---|---|\n| 1 | nourl.com | Homes | 4 | not stated |\n| 2 | vague.com | Homes | roughly close | https://vague.com/about |\n| 3 | ok.com | Homes | **2.** fine | [page](https://ok.com/x). |\n");
      w(path.join(pew2, "research", "competitors-candidates.json"), { rows: [{ name: "Agent found", domain: "https://www.AgentFound.com/path", platform: "web", kind: "agency", evidenceUrl: "https://agentfound.com/a", closeness: 5, note: "from the agent" }, { name: "Odd kind", domain: "odd.com", kind: "unicorn", evidenceUrl: "https://odd.com", closeness: 9 }, { name: "Nobody" }, { name: "@acct", handle: "acct", platform: "tiktok", kind: "social-curator", evidenceUrl: "https://www.tiktok.com/@acct", closeness: 3 }] });
      r = run("competitors-discover.mjs", ["https://gap.test/", "--cwd", cwd2]);
      const g = rj(path.join(pew2, "research", "competitors-proposed.json"));
      const gr = (n) => g.rows.find((x) => x.name === n || x.domain === n);
      check("C4: a row with no URL is kept with evidenceUrl null, listed in needsEvidence, and the run says approve refuses until it has one", gr("nourl.com") && gr("nourl.com").evidenceUrl === null && g.needsEvidence.includes("nourl.com") && /NEEDS EVIDENCE 1: nourl\.com/.test(r.out), r.out + JSON.stringify(g.needsEvidence));
      check("C4: a closeness that is not a number is 3 with the note 'closeness defaulted'; '**2.**' reads as 2", gr("vague.com").closeness === 3 && /closeness defaulted/.test(gr("vague.com").note) && gr("ok.com").closeness === 2 && gr("ok.com").evidenceUrl === "https://ok.com/x", JSON.stringify([gr("vague.com"), gr("ok.com")]));
      check("C4: candidates JSON rows (the C3 shape) are accepted: the domain is normalised, the handle gets its @, a bad kind becomes other, closeness 9 becomes 3", gr("agentfound.com")?.kind === "agency" && gr("agentfound.com").closeness === 5 && g.rows.find((x) => x.handle === "@acct")?.platform === "tiktok" && gr("odd.com").kind === "other" && gr("odd.com").closeness === 3 && /closeness defaulted/.test(gr("odd.com").note), JSON.stringify(g.rows.filter((x) => /odd|agentfound|acct/.test(x.name + x.domain))));
      check("C4: a candidate with neither domain nor handle is left out and listed under dropped", g.dropped.some((x) => x.name === "Nobody") && !g.rows.some((x) => x.name === "Nobody"), JSON.stringify(g.dropped));
      const A1 = run("approve.mjs", ["--pewp", pew2, "competitors", "--by", "Ana"]);
      check("C4: approve.mjs competitors refuses this list while a row has no evidence URL (exit 1, names the row)", A1.code === 1 && /nourl\.com: no evidenceUrl/.test(A1.out), A1.out);
      const cf = path.join(tmp, "c2", "mine.json"); w(cf, [{ name: "Elsewhere", domain: "elsewhere.com", kind: "publisher", evidenceUrl: "https://elsewhere.com", closeness: 2 }]);
      const cwd3 = path.join(tmp, "c3");
      r = run("competitors-discover.mjs", ["https://only-json.test/", "--cwd", cwd3, "--candidates", cf]);
      const oj = rj(path.join(cwd3, "site-checks", "only-json.test", ".pewp", "research", "competitors-proposed.json"));
      check("C4: --candidates FILE alone is enough (a bare array of rows)", r.code === 0 && oj.rows.length === 1 && oj.rows[0].domain === "elsewhere.com" && oj.source.length === 1, r.out + JSON.stringify(oj));

      // nothing to read: the brief
      const cwd4 = path.join(tmp, "c4");
      r = run("competitors-discover.mjs", ["https://nothing.test/", "--cwd", cwd4]);
      check("C5: with nothing to read it exits 3 and prints the discovery brief: every kind, social accounts are competitors too, one evidence URL per row, the output file and shape", r.code === 3 && /Social accounts are competitors too/.test(r.out) && /One evidence URL per row/.test(r.out) && /competitors-proposed\.json/.test(r.out) && /paid media/i.test(r.out) && /Instagram, TikTok, YouTube, Substack/.test(r.out) && /agencies/.test(r.out) && /brokerage programs/.test(r.out) && /evidenceUrl, closeness: 1\.\.5/.test(r.out) && /BLOCKED/.test(r.out), r.out);
      check("C5: the nothing-to-read run writes no file", !fs.existsSync(path.join(cwd4, "site-checks", "nothing.test", ".pewp", "research", "competitors-proposed.json")), "");
      r = run("competitors-discover.mjs", ["--help"]);
      check("C5: --help prints the usage", /usage/i.test(r.out), r.out);
    }

    // =============================================================== D: authority.mjs (G8)
    if (groups.includes("d")) {
      const cache = path.join(tmp, "d", "cache"), REL = "TEST-1";
      const gz = (s) => zlib.gzipSync(Buffer.from(s));
      const graph = {
        vertices: "1\tcom.example\t5\n2\tcom.alpha\t3\n3\tcom.beta\t3\n4\tcom.gamma\t3\n10\tcom.linkerone\t1\n11\tcom.linkertwo\t1\n",
        edges: "10\t1\n10\t2\n10\t3\n11\t2\n11\t3\n11\t4\n",
        ranks: "#harmonicc_pos\tharmonicc_val\tpr_pos\tpr_val\thost_rev\tn_hosts\n5\t1.0\t6\t0.1\tcom.linkerone\t1\n7\t1.0\t8\t0.1\tcom.linkertwo\t1\n9\t1.0\t9\t0.1\tcom.example\t5\n",
      };
      for (const [k, v] of Object.entries(graph)) w(path.join(cache, `${REL}-domain-${k}.txt.gz`), gz(v));
      const approvedDir = path.join(tmp, "d", "pewp", "approved");
      const rows = (extra = []) => ({ step: "competitors-discover", rows: [{ name: "Alpha", domain: "alpha.com", handle: null, platform: "web", kind: "publisher", evidenceUrl: "https://alpha.com", closeness: 4 }, { name: "Beta", domain: "https://www.Beta.com/x", handle: null, platform: "web", kind: "publisher", evidenceUrl: "https://beta.com", closeness: 3 }, { name: "@insta", domain: null, handle: "@insta", platform: "instagram", kind: "social-curator", evidenceUrl: "https://www.instagram.com/insta/", closeness: 3 }, ...extra] });
      const af = path.join(approvedDir, "competitors.json");
      w(af, rows());
      const out = path.join(tmp, "d", "authority.json");
      const base = [out, "--target", "example.com", "--cache", cache, "--release", REL];
      let r = run("authority.mjs", [...base, "--require-approved", "--competitor", "gamma.com"]);
      check("D1: --require-approved without an approved file refuses (exit 3) with the unblock command, even with a guessed --competitor", r.code === 3 && /BLOCKED: competitor list not approved \| unblocks: approve\.mjs <target> competitors --by NAME/.test(r.out) && !fs.existsSync(out), r.out);
      r = run("authority.mjs", [out, "--target", "example.com", "--cache", path.join(tmp, "d", "no-such-cache"), "--require-approved"]);
      check("D1: the refusal comes before anything is read: with no cache and no release it is still the approval message, not the missing-release one", r.code === 3 && /competitor list not approved/.test(r.out) && !/no complete Common Crawl release/.test(r.out), r.out);
      r = run("authority.mjs", [...base, "--approved-competitors", af, "--competitor", "alpha.com", "--competitor", "gamma.com"]);
      check("D2: a --competitor that is not in the approved list is refused (exit 2), named, and nothing is computed", r.code === 2 && /--competitor gamma\.com is not in the approved list/.test(r.out) && !/alpha\.com is not/.test(r.out) && !fs.existsSync(out), r.out);
      r = run("authority.mjs", [...base, "--approved-competitors", af, "--require-approved"]);
      const ad = fs.existsSync(out) ? rj(out) : null;
      check("D3: the competitor domains are exactly the approved rows that have a domain (alpha.com, beta.com normalised), not the social account, not gamma.com", r.code === 0 && ad && ad.results.map((x) => x.domain).sort().join() === "alpha.com,beta.com,example.com" && /competitors: 2 domains from the approved list/.test(r.out), r.out + JSON.stringify(ad?.results?.map((x) => x.domain)));
      check("D3: the link gap was computed on the approved pair only (linkertwo links to alpha and beta: 2, and to gamma, which is not approved and is never counted)", ad && ad.linkGap.length === 1 && ad.linkGap[0].domain === "linkertwo.com" && ad.linkGap[0].linksToCompetitors === 2, JSON.stringify(ad?.linkGap));
      fs.rmSync(out); fs.rmSync(out.replace(/\.json$/, ".md"), { force: true });
      r = run("authority.mjs", [...base, "--approved-competitors", af, "--competitor", "ALPHA.com"]);
      check("D3: a --competitor in the list (any case) is accepted", r.code === 0 && fs.existsSync(out), r.out);
      fs.rmSync(out, { force: true });
      // against the lock
      w(path.join(approvedDir, "lock.json"), { formatVersion: 1, competitors: { approvedAt: "x", approvedBy: "Ana", files: { "competitors.json": sha(af) } } });
      r = run("authority.mjs", [...base, "--approved-competitors", af]);
      check("D4: a list that matches approved/lock.json is accepted", r.code === 0 && fs.existsSync(out), r.out);
      fs.rmSync(out, { force: true });
      fs.appendFileSync(af, " ");
      r = run("authority.mjs", [...base, "--approved-competitors", af]);
      check("D4: a list edited after the owner approved it is refused (exit 3): it no longer matches approved/lock.json", r.code === 3 && /changed after the owner approved it/.test(r.out) && !fs.existsSync(out), r.out);
      w(path.join(approvedDir, "lock.json"), { formatVersion: 1, targets: { files: {} } });
      r = run("authority.mjs", [...base, "--approved-competitors", af]);
      check("D4: next to a lock with no competitors entry the list counts as not approved (exit 3)", r.code === 3 && /is not in approved\/lock\.json/.test(r.out), r.out);
      fs.rmSync(path.join(approvedDir, "lock.json"));
      r = run("authority.mjs", [...base, "--approved-competitors", path.join(approvedDir, "missing.json")]);
      check("D4: a missing approved file is refused as not approved (exit 3) with the unblock command", r.code === 3 && /competitor list not approved/.test(r.out) && /unblocks: approve\.mjs <target> competitors --by NAME/.test(r.out), r.out);
      const socialOnly = path.join(approvedDir, "social.json"); w(socialOnly, { rows: [{ name: "@insta", domain: null, handle: "@insta", kind: "social-curator", evidenceUrl: "https://x.com/i", closeness: 3 }] });
      r = run("authority.mjs", [...base, "--approved-competitors", socialOnly]);
      check("D4: an approved list with only social accounts (no domain) has nothing to compare: exit 3, not a run against no one", r.code === 3 && /no competitor with a domain/.test(r.out) && !fs.existsSync(out), r.out);
      r = run("authority.mjs", [...base, "--competitor", "legacy.com"]);
      check("D5: without the new flags the old behaviour is unchanged (a --competitor is used as given)", r.code === 0 && rj(out).results.some((x) => x.domain === "legacy.com"), r.out);
      fs.rmSync(out, { force: true });

      // --download-only
      const noOut = path.join(tmp, "d", "never.json");
      r = run("authority.mjs", [noOut, "--download-only", "--release", REL, "--cache", cache, "--require-approved"]);
      check("D6: --download-only with a complete cache says 'release ready; nothing computed', exits 0, writes no authority.json (and is not stopped by --require-approved)", r.code === 0 && /release TEST-1 ready; nothing computed/.test(r.out) && !fs.existsSync(noOut) && !fs.existsSync(noOut.replace(/\.json$/, ".md")), r.out);
      r = run("authority.mjs", ["--download-only", "--release", REL, "--cache", cache]);
      check("D6: --download-only needs neither an out file nor a --target", r.code === 0 && /nothing computed/.test(r.out), r.out);
      r = run("authority.mjs", ["--download-only", "--cache", path.join(tmp, "d", "empty-cache")]);
      check("D6: --download-only with no release anywhere is BLOCKED (exit 3) like the normal run", r.code === 3 && /no complete Common Crawl release/.test(r.out), r.out);
      // a real (tiny) download from a local server
      const asked = [];
      const server = http.createServer((req, res) => {
        asked.push(req.url);
        const m = req.url.match(/\/(REL-2)\/domain\/REL-2-domain-(vertices|edges|ranks)\.txt\.gz$/);
        if (!m) { res.writeHead(404); res.end("no"); return; }
        res.writeHead(200, { "content-type": "application/gzip" }); res.end(gz(graph[m[2]]));
      });
      await new Promise((res) => server.listen(0, "127.0.0.1", res));
      const base2 = `http://127.0.0.1:${server.address().port}/graph`;
      const cache2 = path.join(tmp, "d", "cache2");
      r = await runA("authority.mjs", [path.join(tmp, "d", "nope.json"), "--download-only", "--release", "REL-2", "--cache", cache2], { PEWP_CC_BASE: base2 });
      const files = fs.existsSync(cache2) ? fs.readdirSync(cache2).sort() : [];
      check("D6: --download-only fetches the three release files into the cache (complete, no .part marker), computes nothing, exits 0", r.code === 0 && files.join() === "REL-2-domain-edges.txt.gz,REL-2-domain-ranks.txt.gz,REL-2-domain-vertices.txt.gz" && asked.length === 3 && /ready; nothing computed/.test(r.out) && !fs.existsSync(path.join(tmp, "d", "nope.json")), r.out + files.join() + asked.length);
      asked.length = 0;
      r = await runA("authority.mjs", ["--download-only", "--release", "REL-2", "--cache", cache2], { PEWP_CC_BASE: base2 });
      check("D6: a second --download-only finds the release in the cache and asks the server for nothing", r.code === 0 && asked.length === 0 && /already in the cache/.test(r.out), r.out + asked.join());
      r = await runA("authority.mjs", ["--download-only", "--release", "NOPE", "--cache", path.join(tmp, "d", "cache3")], { PEWP_CC_BASE: base2 });
      check("D6: a release the server does not have fails (exit 1, FAILED naming the file)", r.code === 1 && /FAILED: .*HTTP 404/.test(r.out), r.out);
      await new Promise((res) => server.close(res));
      r = run("authority.mjs", ["--help"]);
      check("D7: --help still prints the usage with the new flags", r.code === 2 && /usage: node authority\.mjs/.test(r.out) && /--approved-competitors/.test(r.out) && /--download-only/.test(r.out), r.out);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
  return R;
}

// ---------------- mutants: [name, file, from, to, group, expected red assertion names] ----------------
const MUTANTS = [
  // approve.mjs
  { name: "approve: owner provenance not enforced", file: "approve.mjs", from: 'if (p !== "owner") groups.set(', to: 'if (false) groups.set(', g: "a", expect: [/^A1: business with kind and offer/, /^A1: a stamp of site or default/, /^A1: a business with no provenance/] },
  { name: "approve: vocabulary is not owner-only", file: "approve.mjs", from: '"brand.constraints", "vocabulary"];', to: '"brand.constraints"];', g: "a", expect: [/^A1: vocabulary is owner-only/, /^A1: a business with no provenance/] },
  { name: "approve: business shape (B-001) not checked", file: "approve.mjs", from: "if (!v.ok) { out.push(`business.json is not a valid business", to: "if (false) { out.push(`business.json is not a valid business", g: "a", expect: [/^A1: a business that fails its own shape/] },
  { name: "approve: evidenceUrl not required", file: "approve.mjs", from: 'if (!nonEmpty(r.evidenceUrl) || !/^https?:\\/\\//i.test(r.evidenceUrl)) why.push("no evidenceUrl");', to: 'if (false) why.push("no evidenceUrl");', g: "a", expect: [/^A4: competitors: a row without evidenceUrl/] },
  { name: "approve: competitor kind not required", file: "approve.mjs", from: 'if (!nonEmpty(r.kind)) why.push("no kind");', to: 'if (false) why.push("no kind");', g: "a", expect: [/^A4: competitors: a row without kind/] },
  { name: "approve: closeness range not enforced", file: "approve.mjs", from: "r.closeness >= 1 && r.closeness <= 5)", to: "r.closeness >= 1)", g: "a", expect: [/^A4: competitors: closeness 6/] },
  { name: "approve: row identity not required", file: "approve.mjs", from: "if (!nonEmpty(r.domain) && !nonEmpty(r.handle)) why.push(", to: "if (false) why.push(", g: "a", expect: [/^A4: competitors: a row with neither/] },
  { name: "approve: seeds `from` not required", file: "approve.mjs", from: "const bad = q.filter((x) => !x || typeof x !== \"object\" || !nonEmpty(x.from));", to: "const bad = [];", g: "a", expect: [/^A5: seeds: a query without `from`/] },
  { name: "approve: signing without --by", file: "approve.mjs", from: "if (!by) { log(`NOT SIGNED: approving is the owner's act. Re-run with --by \"<owner name>\" after the owner has read ${old", to: "if (false) { log(`NOT SIGNED: approving is the owner's act. Re-run with --by \"<owner name>\" after the owner has read ${old", g: "a", expect: [/^A2: business without --by/] },
  { name: "approve: unchanged file is re-signed", file: "approve.mjs", from: "if (old && lock[kind]?.files?.[spec.dst] === sha) {", to: "if (false) {", g: "a", expect: [/^A2: approving an unchanged business again/] },
  { name: "approve: replaced copy not kept in history", file: "approve.mjs", from: "fs.copyFileSync(dstFile, path.join(h, spec.dst));", to: "", g: "a", expect: [/^A2: re-approval keeps the replaced copy/] },
  { name: "approve: lock stores a wrong sha", file: "approve.mjs", from: "files: { [spec.dst]: sha }, ...(deleg.length", to: 'files: { [spec.dst]: "0".repeat(64) }, ...(deleg.length', g: "a", expect: [/^A2: business with --by is approved/, /^A2: approvedMatches is ok right after approval/, /^A2: --check covers the business/] },
  { name: "approve: lock check misses a stray approved file", file: "approve.mjs", from: "if (!entry) { if (hasKind(k)) problems.push(", to: "if (!entry) { if (false) problems.push(", g: "a", expect: [/^A3: a seeds\.json under approved\//] },
  { name: "approve: lock check misses a hand edit of a new kind", file: "approve.mjs", from: "problems.push(`${rel}: changed after approval (sha256 differs from the lock)`);\n    }\n  }\n  const tsha", to: "void 0;\n    }\n  }\n  const tsha", g: "a", expect: [/^A2: an approved business edited by hand/] },
  { name: "approve: approvedMatches ignores a changed source", file: "approve.mjs", from: "if (now !== want) return { ok: false, reason: `${spec.src} changed since", to: "if (false) return { ok: false, reason: `${spec.src} changed since", g: "a", expect: [/^A2: after the working business\.json changes/, /^A4: approvedMatches\(competitors\)/] },
  { name: "approve: approvedMatches ignores a tampered approved copy", file: "approve.mjs", from: "if (sha256(fs.readFileSync(dstFile)) !== want) return { ok: false", to: "if (false) return { ok: false", g: "a", expect: [/^A2: an approved business edited by hand/] },
  { name: "approve: an unknown kind is not refused", file: "approve.mjs", from: '...Object.keys(FILE_KINDS)].includes(kind)) {', to: '...Object.keys(FILE_KINDS)].includes(kind) && false) {', g: "a", expect: [/^A1: an unknown kind/] },
  { name: "approve: the targets entry of the lock is dropped", file: "approve.mjs", from: "const lock = lockNow.lock || { formatVersion: 1 };", to: "const lock = { formatVersion: 1 };", g: "a", expect: [/^A3: approving business keeps the targets entry/] },
  { name: "approve: --check ignores the new kinds in its count", file: "approve.mjs", from: "+ extra.reduce((n, k) => n + Object.keys(r.lock[k].files || {}).length, 0)}", to: "+ 0}", g: "a", expect: [/^A2: --check covers the business/, /^A3: --check counts targets and business/] },
  { name: "approve: a cost record whose total is not the sum is approved", file: "approve.mjs", from: "if (!bad.length && d.total !== sum) out.push(", to: "if (false) out.push(", g: "a", expect: [/^A7: research-cost refused: total is not the sum/] },
  { name: "approve: a cost record whose list hash is wrong is approved", file: "approve.mjs", from: "if (sitesOk && d.competitors.sha256 !== sha256(JSON.stringify(d.competitors.sites))) out.push(", to: "if (false) out.push(", g: "a", expect: [/^A7: research-cost refused: competitors\.sha256/] },
  { name: "approve: a cost record with a fractional number of calls is approved", file: "approve.mjs", from: "const bad = entries.filter(([, n]) => !(Number.isInteger(n) && n >= 0));", to: "const bad = entries.filter(([, n]) => typeof n !== \"number\");", g: "a", expect: [/^A7: research-cost refused: a number of calls/] },
  // intake.mjs
  { name: "intake: every answer is stamped owner", file: "intake.mjs", from: 'out[f] = given ? answerProvOf(answerProv, f) : acc.has(f) ? "site" : def.has(f) ? "default" : "default";', to: 'out[f] = "owner";', g: "b", expect: [/^B3: provenance says unstated/, /^B3: provenance says site/, /^B5: answeredBy site and default/] },
  { name: "intake: a bare answer is stamped owner", file: "intake.mjs", from: 'else { out[k] = v; prov[p] = "unstated"; }', to: 'else { out[k] = v; prov[p] = "owner"; }', g: "b", expect: [/^B3: provenance says unstated/] },
  { name: "intake: any answeredBy word is believed", file: "intake.mjs", from: 'prov[p] = STAMPS.includes(v.answeredBy) ? v.answeredBy : "unstated";', to: "prov[p] = v.answeredBy;", g: "b", expect: [/^B5: answeredBy site and default/] },
  { name: "intake: wrapped answers are not unwrapped", file: "intake.mjs", from: "if (isWrapped(v)) { out[k] = v.value;", to: "if (false) { out[k] = v.value;", g: "b", expect: [/^B5: \{value, answeredBy/] },
  { name: "intake: an empty vocabulary is accepted", file: "intake.mjs", from: 'if (!v.length) invalid.push({ field: "vocabulary"', to: 'if (false) invalid.push({ field: "vocabulary"', g: "b", expect: [/^B6: vocabulary \[\] is not an answer/] },
  { name: "intake: --require-vocabulary does nothing", file: "intake.mjs", from: "} else if (requireVocabulary) missing.push(\"vocabulary\");", to: "} else if (false) missing.push(\"vocabulary\");", g: "b", expect: [/^B6: --require-vocabulary blocks/] },
  { name: "intake: the site's repeated words are not offered", file: "intake.mjs", from: 'add("vocabulary.candidates", siteWords(h)', to: 'add("vocabulary.candidates", []', g: "b", expect: [/^B1: vocabulary is asked as a multi-select/, /^B1: the repeated words are a suggestion fact/] },
  { name: "intake: a word seen once is offered", file: "intake.mjs", from: ".filter(([, n]) => n >= 2)", to: ".filter(([, n]) => n >= 1)", g: "b", expect: [/^B1: vocabulary is asked as a multi-select/] },
  { name: "intake: optional questions are not marked optional", file: "intake.mjs", from: "...(!asked.includes(f) ? { optional: true } : {}),", to: "", g: "b", expect: [/^B1: vocabulary is asked as a multi-select/, /^B1: the 'answers missing' count/] },
  { name: "intake: NewsMediaOrganization is not a media kind", file: "intake.mjs", from: 'NewsMediaOrganization: "editorial-media", ', to: "", g: "b", expect: [/^B1: a media site's own markup type/, /^B2: JSON-LD NewsMediaOrganization/] },
  { name: "intake: Periodical is not a media kind", file: "intake.mjs", from: 'Periodical: "editorial-media", ', to: "", g: "b", expect: [/^B2: JSON-LD Periodical/] },
  { name: "intake: Blog is not a media kind", file: "intake.mjs", from: ', Blog: "editorial-media" }', to: " }", g: "b", expect: [/^B2: JSON-LD Blog/] },
  { name: "intake: editorial-media is not offered as a kind", file: "intake.mjs", from: 'opt("editorial-media", "publisher or media platform with paid features", "editorial-media"), ', to: "", g: "b", expect: [/^B1: with no snapshot vocabulary is free text/] },
  { name: "intake: the industry rules folder is the skill's, not PEWP_RULES_DIR", file: "intake.mjs", from: 'fs.readdirSync(path.join(rulesDir(), "industries"))', to: 'fs.readdirSync(path.join(rulesDir() + "-none", "industries"))', g: "b", expect: [/^B3: industry follows kind/] },
  { name: "intake: industry does not follow kind", file: "intake.mjs", from: "industries.includes(b.kind) ? b.kind : null", to: "false ? b.kind : null", g: "b", expect: [/^B3: industry follows kind/] },
  { name: "intake: a multi-region name is not a label", file: "intake.mjs", from: "export const isRegionLabel = (name) => / and |&|;/i.test(String(name)) || (String(name).match(/,/g) || []).length >= 2;", to: "export const isRegionLabel = (name) => false;", g: "b", expect: [/^B4: G16 a location named/, /^B4: isRegionLabel/] },
  { name: "intake: default places still start with the label", file: "intake.mjs", from: "(label ? l0.serviceArea : [l0.name, ...l0.serviceArea])", to: "([l0.name, ...l0.serviceArea])", g: "b", expect: [/^B4: G16 a location named/] },
  { name: "intake: notOffer is dropped", file: "intake.mjs", from: "if (c.notOffer != null && String(c.notOffer).trim()) b.notOffer = String(c.notOffer).trim();", to: "", g: "b", expect: [/^B5: vocabulary is stored/] },
  { name: "intake: a later answers file does not win its stamp", file: "intake.mjs", from: "const answerProv = { ...parts[0].prov, ...parts[1].prov };", to: "const answerProv = { ...parts[1].prov, ...parts[0].prov };", g: "b", expect: [/^B7: an --answers file overrides/] },
  // competitors-discover.mjs
  { name: "discover: a verdict table is imported", file: "competitors-discover.mjs", from: "if (header.some((h) => /^(domain|handle)\\b/.test(h))) out.push", to: "if (true) out.push", g: "c", expect: [/^C1: the 9-row verdict table/, /^C1: a table with no Domain or Handle column/] },
  { name: "discover: escaped pipes split the cell", file: "competitors-discover.mjs", from: "t.split(/(?<!\\\\)\\|/)", to: "t.split(/\\|/)", g: "c", expect: [/^C2: an escaped pipe inside a cell/, /^C2: an escaped pipe in a description/] },
  { name: "discover: IG is not instagram", file: "competitors-discover.mjs", from: 'if (/^(ig|instagram)\\b/.test(t)) return "instagram";', to: 'if (/^(ig|instagram)\\b/.test(t)) return "web";', g: "c", expect: [/^C2: @circahouses is an instagram/] },
  { name: "discover: paid media is not paid-media", file: "competitors-discover.mjs", from: 'if (/paid media/.test(t)) return "paid-media";', to: "", g: "c", expect: [/^C2: hauteliving\.com is paid-media/] },
  { name: "discover: agency is not agency", file: "competitors-discover.mjs", from: 'if (/agency|reseller|studio/.test(t)) return "agency";', to: "", g: "c", expect: [/^C2: Type text maps to kind/] },
  { name: "discover: the evidence URL is not read", file: "competitors-discover.mjs", from: 'return m ? m[0].replace(/[.,;:!?]+$/, "") : null;', to: "return null;", g: "c", expect: [/^C2: @circahouses is an instagram/, /^C3: the CLI writes/, /^C4: a row with no URL is kept/] },
  { name: "discover: an unreadable closeness defaults to 5", file: "competitors-discover.mjs", from: "closeness: closeness ?? 3,", to: "closeness: closeness ?? 5,", g: "c", expect: [/^C4: a closeness that is not a number is 3/] },
  { name: "discover: duplicate rows are not merged", file: "competitors-discover.mjs", from: "if (!first) { seen.set(k, r); out.push(r); continue; }", to: "if (true) { seen.set(k, r); out.push(r); continue; }", g: "c", expect: [/^C3: the CLI writes/, /^C3: the same site listed in two files/] },
  { name: "discover: needsEvidence stays empty", file: "competitors-discover.mjs", from: "needsEvidence: merged.filter((r) => !r.evidenceUrl).map((r) => r.name)", to: "needsEvidence: []", g: "c", expect: [/^C4: a row with no URL is kept/] },
  { name: "discover: link-in-bio hosts count as the competitor's domain", file: "competitors-discover.mjs", from: "const NOT_OWN_SITE = /^(linktr\\.ee|", to: "const NOT_OWN_SITE = /^(zzzz\\.ee|", g: "c", expect: [/^C2: platforms: Substack rows/] },
  { name: "discover: no input still writes a file", file: "competitors-discover.mjs", from: 'if (!mds.length && !hasCand) return { status: "nothing"', to: 'if (false) return { status: "nothing"', g: "c", expect: [/^C5: with nothing to read/] },
  { name: "discover: a handle is not taken from a profile URL", file: "competitors-discover.mjs", from: "if (!handle && !domain) for (const p of", to: "if (false) for (const p of", g: "c", expect: [/^C2: a row with no domain and no @ name/] },
  { name: "discover: closest-first sort removed", file: "competitors-discover.mjs", from: ".sort((a, b) => b.closeness - a.closeness)", to: "", g: "c", expect: [/^C3: rows are listed closest first/] },
  { name: "discover: a candidate with nobody to track is kept", file: "competitors-discover.mjs", from: "if (!name || (!domain && !handle)) return { dropped: { name: name || \"(no name)\", why: \"no domain and no handle\" } };", to: "", g: "c", expect: [/^C4: a candidate with neither domain nor handle/] },
  // authority.mjs
  { name: "authority: --require-approved does nothing", file: "authority.mjs", from: "if (requireApproved && !approvedFile) {", to: "if (false) {", g: "d", expect: [/^D1: --require-approved without an approved file/] },
  { name: "authority: the approval gate is skipped", file: "authority.mjs", from: "if (!downloadOnly) {\n    if (requireApproved", to: "if (false) {\n    if (requireApproved", g: "d", expect: [/^D1:/, /^D2:/, /^D3:/] },
  { name: "authority: a --competitor outside the approved list is used", file: "authority.mjs", from: "const bad = competitors.filter((c) => !ap.domains.includes(bareDomain(c)));", to: "const bad = [];", g: "d", expect: [/^D2: a --competitor that is not in the approved list/] },
  { name: "authority: the approved domains are not used", file: "authority.mjs", from: "      competitors = ap.domains;\n", to: "", g: "d", expect: [/^D3: the competitor domains are exactly/, /^D3: the link gap/] },
  { name: "authority: social handles become domains", file: "authority.mjs", from: "r.domain.trim() ? bareDomain(r.domain) : null", to: "r.domain.trim() ? bareDomain(r.domain) : (r.handle || null)", g: "d", expect: [/^D3: the competitor domains are exactly/, /^D4: an approved list with only social accounts/] },
  { name: "authority: a hand-edited approved list passes the lock", file: "authority.mjs", from: '!== want) return { error: `${file} was changed after', to: '=== "x") return { error: `${file} was changed after', g: "d", expect: [/^D4: a list edited after the owner approved it/] },
  { name: "authority: a list absent from the lock passes", file: "authority.mjs", from: "if (!want) return { error:", to: "if (false) return { error:", g: "d", expect: [/^D4: next to a lock with no competitors entry/] },
  { name: "authority: a missing approved file is not a refusal", file: "authority.mjs", from: "if (ap.error) {", to: "if (false) {", g: "d", expect: [/^D4: a missing approved file/] },
  { name: "authority: an empty approved list runs anyway", file: "authority.mjs", from: "if (!ap.domains.length) {", to: "if (false) {", g: "d", expect: [/^D4: an approved list with only social accounts/] },
  { name: "authority: --download-only computes", file: "authority.mjs", from: "if (downloadOnly) {\n    if (!cacheDir)", to: "if (false) {\n    if (!cacheDir)", g: "d", expect: [/^D6: --download-only with a complete cache/, /^D6: --download-only needs neither/, /^D6: --download-only fetches/] },
  { name: "authority: --download-only re-downloads a cached release", file: "authority.mjs", from: "!fs.existsSync(file + \".part\")) { report.push(", to: "false) { report.push(", g: "d", expect: [/^D6: a second --download-only/] },
  { name: "authority: --download-only still demands an out file and target", file: "authority.mjs", from: "if (!downloadOnly && (!out ||", to: "if ((!out ||", g: "d", expect: [/^D6: --download-only needs neither/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-approve.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>] [--group a|b|c|d]"); process.exit(0); }
  const groups = opt("--group") ? [opt("--group")] : ["a", "b", "c", "d"];
  const main = await runScenarios(scriptsDir, groups);
  for (const r of main) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail}`}`);
  let failed = main.filter((r) => !r.ok).length;
  console.log(failed ? `APPROVE TEST FAIL: ${failed} of ${main.length}` : `APPROVE TEST PASS: ${main.length} of ${main.length}`);
  if (!failed && !A.includes("--no-mutants") && !opt("--group")) {
    console.log("\nWatched-fail mutants (each must turn the named assertions red; the unmutated tree is green above):");
    let caught = 0, ran = 0;
    for (const mu of MUTANTS.filter((m) => !opt("--mutant") || m.name.includes(opt("--mutant")))) {
      ran++;
      const mdir = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-mutant-approve-"));
      const skill = path.dirname(scriptsDir), msdir = path.join(mdir, "scripts");
      for (let t = 0; ; t++) { try { fs.mkdirSync(msdir, { recursive: true }); fs.cpSync(scriptsDir, msdir, { recursive: true }); fs.cpSync(path.join(skill, "rules"), path.join(mdir, "rules"), { recursive: true }); fs.cpSync(path.join(skill, "fixtures", "competitors"), path.join(mdir, "fixtures", "competitors"), { recursive: true }); break; } catch (e) { if (t >= 4) throw e; } }
      const target = path.join(msdir, mu.file), src = fs.readFileSync(target, "utf8"), count = src.split(mu.from).length - 1;
      if (count !== 1) { console.log(`FAIL mutant "${mu.name}": patch target found ${count} times in ${mu.file} (the patch did not apply)`); failed++; fs.rmSync(mdir, { recursive: true, force: true }); continue; }
      fs.writeFileSync(target, src.replace(mu.from, () => mu.to));
      const chk = spawnSync(node, ["--check", target], { encoding: "utf8", timeout: 60_000 });
      if (chk.status) { console.log(`FAIL mutant "${mu.name}": mutated file does not parse: ${chk.stderr.slice(0, 200)}`); failed++; fs.rmSync(mdir, { recursive: true, force: true }); continue; }
      const res = await runScenarios(msdir, [mu.g]);
      const red = res.filter((r) => !r.ok), missing = mu.expect.filter((re) => !red.some((r) => re.test(r.name)));
      const ok = red.length > 0 && !missing.length;
      if (ok) caught++; else failed++;
      console.log(`${ok ? "RED (caught)" : "FAIL (survived)"} ${mu.name}: ${red.length} assertion(s) red${red.length ? ` e.g. "${red[0].name.slice(0, 80)}"` : ""}${missing.length ? `; expected red but green: ${missing.map(String).join(" ")}` : ""}`);
      fs.rmSync(mdir, { recursive: true, force: true, maxRetries: 5 });
    }
    console.log(failed ? `MUTANTS FAIL: ${caught} of ${ran} caught` : `MUTANTS PASS: ${caught} of ${ran} caught`);
  }
  process.exit(failed ? 1 : 0);
}
