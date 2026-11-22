// Usage: node test-sign-by-rule.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of the owner's ruling of 2026-11-21 (item 22): the head signs the business, the seeds, the competitors and any research plan up to 150
// requests BY A WRITTEN RULE (scripts/sign-off-rule.json), and sign-by-rule.mjs is the one program that writes that stamp (job 7, part AU.D-8).
//   1 to 3  business: every owner-only field with a value is stamped delegated, a field with no value stops for the owner, the owner's own answer is kept
//   4 and 5 seeds and competitors: approve.mjs decides
//   6       research-cost: the ceiling (150 requests; money is always 0)
//   7 and 8 a kind outside the rule is refused; a second run changes nothing
//   9       the rule file is pinned
//   10      approve.mjs refuses a business for another reason: the working file is put back
//   11 12   the real pipeline.json steps, and the NEEDS-INPUT line is read as WAITING by the same function seo-run.mjs and start.mjs use
// Fixtures only: a folder under the temp folder, the netguard for every run, no network, no browser, no model.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { runner, W, J, walk, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const skillDir = path.dirname(here); // the real skill: the manifest and lib-pipeline are read from it, also in a mutant's copy of scripts/
const OWNER_FIELDS = ["kind", "offer", "audience", "goals", "competitors", "brand.constraints", "vocabulary"];
const RULE = { ruledBy: "owner", ruledOn: "2026-11-21", signer: "head of operations", kinds: ["business", "seeds", "competitors", "research-cost"], costCeiling: 150 };
const BY = "head of operations, by the owner's rule of 2026-11-21";
const sha = (x) => crypto.createHash("sha256").update(x).digest("hex");
const bytes = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);
const same = (a, b) => a !== null && b !== null && Buffer.compare(a, b) === 0;
const lastLine = (s) => s.trim().split(/\r?\n/).pop();
const bizDoc = (prov, over = {}) => ({ name: "Matter of Place", domain: "matterofplace.com", kind: "editorial-media", industry: null, offer: "An editorial real-estate media platform.", audience: "Owners and listing agents of exceptional homes", vocabulary: ["historic homes", "design-led"], market: { country: "US", language: "en" }, locations: [{ name: "California, New York and Florida", address: null, serviceArea: ["California", "New York", "Florida"] }], goals: ["leads"], competitors: ["dwell.com"], brand: { constraints: ["no hype"] }, existing: { site: "https://matterofplace.com/", searchConsole: true, businessProfile: null, socials: [] }, launchState: "live", rankTracking: { source: "search-console", locations: ["California"], devices: ["mobile"] }, provenance: prov, ...over });
const allSite = Object.fromEntries(OWNER_FIELDS.map((f) => [f, "site"]));
const compRow = (over = {}) => ({ name: "Dwell", domain: "dwell.com", handle: null, platform: "web", kind: "publisher", evidenceUrl: "https://www.dwell.com/real-estate", closeness: 4, note: "", ...over });
const SRC = "competitor sites (1 request/s each, ~14 requests)", SITES = ["rival-one.test", "rival-two.test"];
const costDoc = (total) => ({ step: "research-cost", calls: { "Search Console": 3, "Bing Webmaster": 49, [SRC]: total - 52 }, total, costInMoney: "$0 (free sources only)", competitors: { sites: SITES, sha256: sha(JSON.stringify(SITES)) } });

async function scenarios(sdir) {
  const R = [], check = checker(R), tmp = mkTmp("sign-by-rule"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
  fs.mkdirSync(home, { recursive: true });
  const run = runner(sdir, home, netLog);
  let n = 0;
  const mk = () => { const cwd = path.join(tmp, "case" + ++n); fs.mkdirSync(cwd, { recursive: true }); return { cwd, pewp: path.join(cwd, "site-checks", "acme", ".pewp") }; };
  const KEY = "profile:acme";
  const sign = (c, kind, extra = []) => run("sign-by-rule.mjs", [KEY, kind, "--cwd", c.cwd, ...extra]);
  const approveCheck = (c) => run("approve.mjs", [KEY, "--check", "--cwd", c.cwd]);
  const lockOf = (c) => (fs.existsSync(path.join(c.pewp, "approved", "lock.json")) ? J(path.join(c.pewp, "approved", "lock.json")) : null);
  const approvedDir = (c) => path.join(c.pewp, "approved");
  const nothingApproved = (c) => !fs.existsSync(approvedDir(c));
  const needs = (out) => out.split(/\r?\n/).filter((l) => /^NEEDS-INPUT/.test(l));
  try {
    // ---------------------------------------------------------------- 1 to 3 and 10: business
    let c = mk(); const B1 = path.join(c.pewp, "business.json"); W(B1, bizDoc(allSite));
    let r = await sign(c, "business"), lk = lockOf(c), ap = fs.existsSync(path.join(approvedDir(c), "business.json")) ? J(path.join(approvedDir(c), "business.json")) : null, wk = J(B1);
    check("case 1: a business read from the site only is signed by the rule: exit 0 and the SIGNED BY RULE line last", r.code === 0 && lastLine(r.out) === "SIGNED BY RULE: business (head of operations, owner's rule of 2026-11-21)", r.out);
    check("case 1: approved/business.json is there; the lock's business entry has approvedBy with the signer and the date of the rule, delegated naming every owner-only field, and byRule", !!ap && lk?.business?.approvedBy === BY && lk.business.delegated?.map((d) => d.field).join() === OWNER_FIELDS.join() && lk.business.delegated.every((d) => d.by === "head of operations" && d.delegatedBy === "owner") && JSON.stringify(lk.business.byRule) === JSON.stringify({ ruledBy: "owner", ruledOn: "2026-11-21", signer: "head of operations" }), JSON.stringify(lk?.business));
    check("case 1: in the working file every owner-only field is delegated with from: site and a record of who and when", OWNER_FIELDS.every((f) => wk.provenance?.[f] === "delegated" && wk.delegations?.[f]?.from === "site" && wk.delegations[f].by === "head of operations" && wk.delegations[f].delegatedBy === "owner" && Number.isFinite(Date.parse(wk.delegations[f].at))), JSON.stringify([wk.provenance, wk.delegations]));
    const chk = await approveCheck(c);
    check("case 1: approve.mjs --check still passes after the signature (exit 0)", chk.code === 0 && /^PASS approve-lock/m.test(chk.out), chk.out);

    c = mk(); const B2 = path.join(c.pewp, "business.json"); W(B2, bizDoc({ ...allSite, competitors: "default" }, { competitors: [] }));
    let before = bytes(B2); r = await sign(c, "business");
    check("case 2: an owner-only field with no value stops: exit 3, ONE NEEDS-INPUT line, last, naming it", r.code === 3 && needs(r.out).length === 1 && /^NEEDS-INPUT/.test(lastLine(r.out)) && /competitors has no value/.test(lastLine(r.out)) && !/\b(kind|offer|audience|goals|vocabulary)\b/.test(lastLine(r.out).replace(/ask the owner.*$/i, "")), r.out);
    check("case 2: nothing under approved/ and the working file byte for byte as before", nothingApproved(c) && same(bytes(B2), before), r.out);
    c = mk(); const B2b = path.join(c.pewp, "business.json"); W(B2b, bizDoc({ ...allSite, competitors: "default", vocabulary: "unstated" }, { competitors: [], vocabulary: [] }));
    before = bytes(B2b); r = await sign(c, "business");
    check("case 2: two fields with no value are named in the same ONE line (a value is never invented)", r.code === 3 && needs(r.out).length === 1 && /competitors, vocabulary have no value/.test(lastLine(r.out)) && nothingApproved(c) && same(bytes(B2b), before), r.out);

    c = mk(); const B3 = path.join(c.pewp, "business.json"); W(B3, bizDoc({ ...allSite, audience: "owner" }));
    r = await sign(c, "business"); wk = J(B3); lk = lockOf(c);
    check("case 3: a field the owner answered keeps owner and has no delegation; the six others are stamped", r.code === 0 && wk.provenance.audience === "owner" && !(wk.delegations && "audience" in wk.delegations) && OWNER_FIELDS.filter((f) => f !== "audience").every((f) => wk.provenance[f] === "delegated" && wk.delegations[f]?.from === "site") && lk.business.delegated.map((d) => d.field).join() === OWNER_FIELDS.filter((f) => f !== "audience").join(), r.out + JSON.stringify(wk.provenance));
    c = mk(); const B3b = path.join(c.pewp, "business.json"); W(B3b, bizDoc(Object.fromEntries(OWNER_FIELDS.map((f) => [f, "owner"]))));
    before = bytes(B3b); r = await sign(c, "business");
    check("case 3: a business every field of which the owner answered is signed with no stamp written into the working file", r.code === 0 && same(bytes(B3b), before) && !lockOf(c).business.delegated, r.out);

    c = mk(); const B10 = path.join(c.pewp, "business.json"); const bad = bizDoc(allSite); delete bad.launchState; W(B10, bad);
    before = bytes(B10); r = await sign(c, "business");
    check("case 10: approve.mjs refuses the business for another reason (no launchState): exit 3, NEEDS-INPUT with approve's own first line, last", r.code === 3 && needs(r.out).length === 1 && /^NEEDS-INPUT/.test(lastLine(r.out)) && /FAIL approve business: business\.json cannot be approved yet, nothing approved/.test(lastLine(r.out)), r.out);
    check("case 10: nothing approved and the working file put back byte for byte (no stamp left in it)", nothingApproved(c) && same(bytes(B10), before), r.out);

    // ---------------------------------------------------------------- 4 and 5: seeds, competitors
    c = mk(); W(path.join(c.pewp, "research", "seeds.json"), { queries: [{ query: "historic homes", from: "site" }] });
    r = await sign(c, "seeds"); lk = lockOf(c);
    check("case 4: seeds that approve.mjs accepts are signed: exit 0, the SIGNED BY RULE line, approvedBy and byRule in the lock, --check passes", r.code === 0 && lastLine(r.out) === "SIGNED BY RULE: seeds (head of operations, owner's rule of 2026-11-21)" && lk?.seeds?.approvedBy === BY && lk.seeds.byRule?.ruledOn === "2026-11-21" && lk.seeds.byRule.signer === "head of operations" && (await approveCheck(c)).code === 0, r.out + JSON.stringify(lk));
    c = mk(); W(path.join(c.pewp, "research", "seeds.json"), { queries: [{ query: "historic homes" }] });
    r = await sign(c, "seeds");
    check("case 4: seeds that approve.mjs refuses (a query with no from): exit 3, NEEDS-INPUT with approve's line, nothing approved", r.code === 3 && needs(r.out).length === 1 && /^NEEDS-INPUT/.test(lastLine(r.out)) && /FAIL approve seeds: research\/seeds\.json cannot be approved yet/.test(lastLine(r.out)) && nothingApproved(c), r.out);

    c = mk(); W(path.join(c.pewp, "research", "competitors-proposed.json"), { rows: [compRow()] });
    r = await sign(c, "competitors"); lk = lockOf(c);
    check("case 5: competitors that approve.mjs accepts are signed: exit 0, the SIGNED BY RULE line, byRule in the lock, --check passes", r.code === 0 && lastLine(r.out) === "SIGNED BY RULE: competitors (head of operations, owner's rule of 2026-11-21)" && lk?.competitors?.approvedBy === BY && lk.competitors.byRule?.signer === "head of operations" && fs.existsSync(path.join(approvedDir(c), "competitors.json")) && (await approveCheck(c)).code === 0, r.out + JSON.stringify(lk));
    c = mk(); W(path.join(c.pewp, "research", "competitors-proposed.json"), { rows: [compRow({ evidenceUrl: "" })] });
    r = await sign(c, "competitors");
    check("case 5: competitors that approve.mjs refuses (a row with no evidenceUrl): exit 3, NEEDS-INPUT with approve's line, nothing approved", r.code === 3 && needs(r.out).length === 1 && /^NEEDS-INPUT/.test(lastLine(r.out)) && /FAIL approve competitors: research\/competitors-proposed\.json cannot be approved yet/.test(lastLine(r.out)) && nothingApproved(c), r.out);

    // a file the step needs is not there: BLOCKED with what unblocks it
    const gone = [];
    for (const kind of ["business", "seeds", "competitors"]) { c = mk(); r = await sign(c, kind); if (!(r.code === 3 && /^BLOCKED: .+ \| unblocks: .+/.test(lastLine(r.out)) && nothingApproved(c))) gone.push(kind + ": " + r.code + " " + r.out); }
    check("case 5: no business.json, no seeds, no proposed competitors: exit 3, BLOCKED with its unblocks, nothing approved", !gone.length, gone.join(" | "));

    // ---------------------------------------------------------------- 6: research-cost
    c = mk(); W(path.join(c.pewp, "research", "research-cost.json"), costDoc(150));
    r = await sign(c, "research-cost"); lk = lockOf(c);
    check("case 6: a plan of 150 requests (the ceiling) is signed: exit 0, the SIGNED BY RULE line, byRule in the lock, --check passes", r.code === 0 && lastLine(r.out) === "SIGNED BY RULE: research-cost (head of operations, owner's rule of 2026-11-21)" && lk?.["research-cost"]?.byRule?.ruledBy === "owner" && fs.existsSync(path.join(approvedDir(c), "research-cost.json")) && (await approveCheck(c)).code === 0, r.out);
    c = mk(); W(path.join(c.pewp, "research", "research-cost.json"), costDoc(151));
    r = await sign(c, "research-cost");
    check("case 6: a plan of 151 stops: exit 3, ONE NEEDS-INPUT line naming 151, the ceiling 150 and the owner's own command, nothing approved", r.code === 3 && needs(r.out).length === 1 && /^NEEDS-INPUT/.test(lastLine(r.out)) && /\b151\b/.test(lastLine(r.out)) && /\b150\b/.test(lastLine(r.out)) && /node approve\.mjs profile:acme research-cost --by "<name>"/.test(lastLine(r.out)) && nothingApproved(c), r.out);
    c = mk(); r = await sign(c, "research-cost");
    check("case 6: no cost plan: exit 3, BLOCKED with its unblocks (the plan step), nothing approved", r.code === 3 && /^BLOCKED: .+ \| unblocks: .+/.test(lastLine(r.out)) && nothingApproved(c), r.out);

    // ---------------------------------------------------------------- 7: a kind outside the rule
    const outside = [];
    for (const kind of ["plan", "targets", "prompt-map"]) { c = mk(); r = await sign(c, kind); if (!(r.code === 2 && /the rule signs only business, seeds, competitors, research-cost/.test(r.out) && walk(c.cwd).length === 0)) outside.push(kind + ": " + r.code + " " + r.out + " " + walk(c.cwd).join()); }
    check("case 7: a kind outside the rule (plan, targets, prompt-map): exit 2 and the sentence, nothing written", !outside.length, outside.join(" | "));
    c = mk(); r = await sign(c, "seeds", ["--yes"]);
    check("case 7: a flag that would loosen the rule does not exist: --yes is usage (exit 2), nothing written", r.code === 2 && walk(c.cwd).length === 0, r.out);

    // ---------------------------------------------------------------- 8: run twice, and a signature that is not the rule's
    c = mk(); W(path.join(c.pewp, "business.json"), bizDoc(allSite)); await sign(c, "business");
    const lockA = bytes(path.join(approvedDir(c), "lock.json")), bizA = bytes(path.join(approvedDir(c), "business.json")), workA = bytes(path.join(c.pewp, "business.json"));
    if (fs.existsSync(path.join(approvedDir(c), "business.json"))) fs.utimesSync(path.join(approvedDir(c), "business.json"), new Date("2020-01-01"), new Date("2020-01-01"));
    r = await sign(c, "business");
    check("case 8: run twice: the second run exits 0, says already signed (last line), and lock.json, the approved copy and the working file are byte for byte the same", r.code === 0 && /^ALREADY SIGNED BY RULE: business\b/.test(lastLine(r.out)) && same(bytes(path.join(approvedDir(c), "lock.json")), lockA) && same(bytes(path.join(approvedDir(c), "business.json")), bizA) && same(bytes(path.join(c.pewp, "business.json")), workA), r.out);
    const bizP = path.join(approvedDir(c), "business.json");
    check("case 8: the approved copy is touched (its time only), so a run reads it as written by this step", fs.existsSync(bizP) && fs.statSync(bizP).mtimeMs > Date.parse("2021-01-01"), fs.existsSync(bizP) ? String(fs.statSync(bizP).mtime) : "no approved copy");
    c = mk(); W(path.join(c.pewp, "research", "seeds.json"), { queries: [{ query: "historic homes", from: "site" }] });
    r = await run("approve.mjs", [KEY, "seeds", "--by", "Abdo", "--cwd", c.cwd]); const lockP = bytes(path.join(approvedDir(c), "lock.json"));
    r = await sign(c, "seeds");
    check("case 8: seeds the owner signed himself are left as they are: exit 0, the line names his signature, no byRule written, lock.json byte for byte the same", r.code === 0 && /^ALREADY SIGNED: seeds \(by Abdo\b/.test(lastLine(r.out)) && same(bytes(path.join(approvedDir(c), "lock.json")), lockP) && !lockOf(c).seeds.byRule, r.out);

    // ---------------------------------------------------------------- 9: the rule file
    const rf = path.join(sdir, "sign-off-rule.json");
    check("case 9: the rule file holds exactly the object of the owner's ruling (ruledBy owner, 2026-11-21, the head, the four kinds, the ceiling 150)", fs.existsSync(rf) && JSON.stringify(J(rf)) === JSON.stringify(RULE), fs.existsSync(rf) ? fs.readFileSync(rf, "utf8") : "no file");

    // ---------------------------------------------------------------- 11: the real manifest
    const L = await import(pathToFileURL(path.join(skillDir, "scripts", "lib-pipeline.mjs")).href);
    const lm = L.loadManifest(path.join(skillDir, "pipeline.json")), steps = lm.manifest?.steps || [], by = (id) => steps.find((s) => s.id === id);
    const prog = (id, kind) => { const s = by(id); return !!s && s.script === "scripts/sign-by-rule.mjs" && JSON.stringify(s.args) === JSON.stringify(["{key}", kind, "--cwd", "{skill}"]) && s.needsPerson === false && s.needsAi === false && s.needsBrowser === "none" && !L.isWaiting(s) && s.timeoutMinutes > 0 && /by rule|by the rule|written by rule/i.test(s.brief || ""); };
    check("case 11: approve-business, approve-seeds and approve-competitors are program steps (sign-by-rule.mjs with their kind), not waiting steps, with a timeout and a brief that says the stamp is written by rule", prog("approve-business", "business") && prog("approve-seeds", "seeds") && prog("approve-competitors", "competitors"), JSON.stringify(["approve-business", "approve-seeds", "approve-competitors"].map((i) => by(i))));
    const ac = by("approve-cost"), ids = steps.map((s) => s.id);
    check("case 11: approve-cost stands right after research-plan (its station), depends on it, writes approved/research-cost.json and is a program step; research depends on it", !!ac && ids.indexOf("approve-cost") === ids.indexOf("research-plan") + 1 && ac.station === by("research-plan").station && JSON.stringify(ac.dependsOn) === JSON.stringify(["research-plan"]) && JSON.stringify(ac.outputs) === JSON.stringify(["{pewp}/approved/research-cost.json"]) && prog("approve-cost", "research-cost") && by("research").dependsOn.includes("approve-cost"), JSON.stringify(ac));
    const vp = lm.ok ? L.validateManifest(lm.manifest, { skillDir }).problems : lm.problems;
    check("case 11: validateManifest gives no problem for the real pipeline.json", vp.length === 0, vp.map((p) => L.describe(p)).join("\n     "));

    // ---------------------------------------------------------------- 12: the lines are read as WAITING and BLOCKED by the function seo-run.mjs and start.mjs use (lib-pipeline.mjs stepOutcome)
    c = mk(); W(path.join(c.pewp, "business.json"), bizDoc({ ...allSite, vocabulary: "unstated" }, { vocabulary: [] }));
    const rn = await sign(c, "business"); c = mk(); W(path.join(c.pewp, "research", "research-cost.json"), costDoc(151)); const rc = await sign(c, "research-cost"); c = mk(); const rb = await sign(c, "research-cost");
    const oc = (x) => L.stepOutcome(by("approve-business"), { code: x.code, lastLine: [lastLine(x.out)], output: x.out });
    check("case 12: the NEEDS-INPUT lines of case 2 and case 6 are read as needs-input, a WAITING state; the BLOCKED line of a missing plan as blocked (stepOutcome of lib-pipeline.mjs, the function tools/omnikom-cli/lib/seo-run.mjs:328 and scripts/start.mjs:324 call)", oc(rn).outcome === "needs-input" && oc(rc).outcome === "needs-input" && L.outcomeState(oc(rn)) === "WAITING" && L.outcomeState(oc(rc)) === "WAITING" && oc(rb).outcome === "blocked", JSON.stringify([oc(rn), oc(rc), oc(rb)]));
  } catch (e) {
    check("test harness ran to the end", false, e.stack || e);
  } finally {
    rmTmp(tmp);
  }
  return R;
}

// ---------------------------------------------------------------- seeded faults: each patch is applied to a copy of scripts/ and must turn its own case red
const MUTANTS = [
  { name: "sign: the ceiling is not looked at", patches: [{ file: "sign-by-rule.mjs", from: "total > rule.costCeiling", to: "total > Infinity" }], expect: [/^case 6: a plan of 151/] },
  { name: "sign: a field with no value is stamped", patches: [{ file: "sign-by-rule.mjs", from: "if (!hasValue(valueOf(b, f))) { empty.push(f); continue; }", to: "if (false) { empty.push(f); continue; }" }], expect: [/^case 2: an owner-only field with no value/, /^case 2: two fields/] },
  { name: "sign: the owner's own answer is restamped", patches: [{ file: "sign-by-rule.mjs", from: "if (p === \"owner\") continue;", to: "if (false) continue;" }], expect: [/^case 3: a field the owner answered/] },
  { name: "sign: byRule is not written", patches: [{ file: "sign-by-rule.mjs", from: "lock[kind].byRule = { ruledBy: rule.ruledBy, ruledOn: rule.ruledOn, signer: rule.signer };", to: "void 0;" }], expect: [/^case 1: approved\/business\.json is there/, /^case 4: seeds that approve\.mjs accepts/] },
  { name: "sign: a kind outside the rule is signed", patches: [{ file: "sign-by-rule.mjs", from: "if (!rule.kinds.includes(kind)) usage(", to: "if (false) usage(" }], expect: [/^case 7: a kind outside the rule/] },
  { name: "sign: approve's refusal is ignored", patches: [{ file: "sign-by-rule.mjs", from: "if (res.status !== 0) {", to: "if (false) {" }], expect: [/^case 4: seeds that approve\.mjs refuses/, /^case 5: competitors that approve\.mjs refuses/, /^case 10: approve\.mjs refuses/] },
  { name: "sign: the working file is not put back", patches: [{ file: "sign-by-rule.mjs", from: "if (original) fs.writeFileSync(workFile, original);", to: "void 0;" }], expect: [/^case 10: nothing approved and the working file put back/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-sign-by-rule.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "SIGN BY RULE", scenarios, MUTANTS, scriptsDir, argv: A }));
}
