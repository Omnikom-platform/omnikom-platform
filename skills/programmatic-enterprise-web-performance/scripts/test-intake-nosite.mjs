// Usage: node test-intake-nosite.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of AB-16: a client with NO site gets through intake. The answer "domain: not decided" ({ "value": null, "answeredBy": ... }) that is PRESENT in the answers file is an answer
// (business.domain = null, no question); an ABSENT domain is still a question; a site's own key (a url) never takes a null domain. Every step from intake to the AI texts takes
// the null: sign-by-rule business, research-seeds, sign-by-rule seeds, ai-oneshot build. Fixtures only (a temp --cwd, never a real site-checks folder); no network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./lib-main.mjs";
import { runner, J, W, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const NAME = "Sample Valley Realty", SLUG = "sample-nosite-client", KEY = "profile:" + SLUG, PLACE = "Sampleville, CA, United States";
const own = (value) => ({ value, answeredBy: "owner" });
const ANSWERS = {
  name: own(NAME), kind: own("real estate agent"), offer: own("homes"), audience: own("Households in the service area"),
  market: own({ country: "US", language: "en" }), locations: own([{ name: "Sampleville, CA", address: "1 Main St, Sampleville, CA 90000", serviceArea: ["Sampleville, CA", "Testburg, CA"] }]),
  goals: own(["leads"]), competitors: own([]), "brand.constraints": own([]), vocabulary: own(["homes for sale", "real estate agent"]),
  existing: own({ searchConsole: false, site: null, businessProfile: null }), launchState: own("planned"),
};
const withDomain = (v) => ({ ...ANSWERS, domain: v });

async function scenarios(dir) {
  const results = [], check = checker(results), tmp = mkTmp("intake-nosite"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
  fs.mkdirSync(home);
  const run = runner(dir, home, netLog);
  let n = 0;
  const world = (answers) => { const cwd = path.join(tmp, "w" + n++), pewp = path.join(cwd, "site-checks", SLUG, ".pewp"); W(path.join(pewp, "intake-answers.json"), answers); return { cwd, pewp }; };
  const d = (r) => `exit ${r.code} | ${r.out.slice(-500)}`;
  try {
    // N1: every field answered, domain answered null
    const w1 = world(withDomain(own(null))), r1 = await run("intake.mjs", [KEY, "--cwd", w1.cwd]);
    const bf = path.join(w1.pewp, "business.json"), b1 = fs.existsSync(bf) ? J(bf) : null, f1 = fs.existsSync(path.join(w1.pewp, "intake-facts.json")) ? J(path.join(w1.pewp, "intake-facts.json")) : null;
    check("N1: a client with no site (profile key) that answers domain null (not decided) passes intake: exit 0, business.json written with domain null, no domain question in intake-facts.json", r1.code === 0 && b1 && b1.domain === null && !(f1?.questions || []).some((q) => q.field === "domain") && !(f1?.missing || []).includes("domain"), d(r1) + " | " + JSON.stringify([b1?.domain, f1?.missing, f1?.invalid]));
    check("N1b: the provenance of the null domain is the answer's own (owner)", b1?.provenance?.domain === "owner", JSON.stringify(b1?.provenance));
    const w1b = world(withDomain(null)), r1b = await run("intake.mjs", [KEY, "--cwd", w1b.cwd]), b1b = fs.existsSync(path.join(w1b.pewp, "business.json")) ? J(path.join(w1b.pewp, "business.json")) : null;
    check("N1c: a bare null (not wrapped) is an answer too: exit 0, domain null", r1b.code === 0 && b1b && b1b.domain === null, d(r1b));
    // N2: the same answers with no domain key
    const w2 = world(ANSWERS), r2 = await run("intake.mjs", [KEY, "--cwd", w2.cwd]), f2 = fs.existsSync(path.join(w2.pewp, "intake-facts.json")) ? J(path.join(w2.pewp, "intake-facts.json")) : null;
    check("N2: the same answers with no domain key: the domain is still a question (exit 3, a domain question in intake-facts.json, no business.json)", r2.code === 3 && (f2?.questions || []).some((q) => q.field === "domain") && !fs.existsSync(path.join(w2.pewp, "business.json")), d(r2));
    // N3: from the business.json of N1 every step to the AI texts takes the null
    const steps = [["sign-by-rule.mjs", [KEY, "business"]], ["research-seeds.mjs", [KEY]], ["sign-by-rule.mjs", [KEY, "seeds"]], ["ai-oneshot.mjs", ["build", KEY]]];
    const outs = [];
    for (const [f, a] of steps) { const r = await run(f, [...a, "--cwd", w1.cwd]); outs.push(r); if (r.code !== 0) break; }
    check("N3a: sign-by-rule business, research-seeds, sign-by-rule seeds and ai-oneshot build all exit 0 on a business with domain null", outs.length === steps.length && outs.every((r) => r.code === 0), outs.map((r, i) => steps[i][0] + " " + d(r)).join(" || "));
    const t1f = path.join(w1.pewp, "research", "ai-oneshot-1.txt"), t1 = fs.existsSync(t1f) ? fs.readFileSync(t1f, "utf8") : "";
    check("N3b: ai-oneshot-1.txt names the place in full (" + PLACE + ") and never the business name", t1.includes(PLACE) && !t1.toLowerCase().includes(NAME.toLowerCase()), t1.slice(0, 300));
    // N4: a site's own key never takes a null domain
    const cwd4 = path.join(tmp, "w" + n++), pewp4 = path.join(cwd4, "site-checks", "sample-site.test", ".pewp");
    W(path.join(pewp4, "intake-answers.json"), withDomain(own(null)));
    const r4 = await run("intake.mjs", ["https://sample-site.test/", "--cwd", cwd4]), f4 = fs.existsSync(path.join(pewp4, "intake-facts.json")) ? J(path.join(pewp4, "intake-facts.json")) : null;
    check("N4: a url key (a site) that answers domain null is refused: exit 3, the domain named as invalid, business.json never written", r4.code === 3 && (f4?.invalid || []).some((i) => i.field === "domain") && !fs.existsSync(path.join(pewp4, "business.json")), d(r4) + " | " + JSON.stringify(f4?.invalid));
    const net = fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8").trim() : "";
    check("N5: nothing in this suite left the machine (network guard log empty)", !net, net);
  } finally { rmTmp(tmp); }
  return results;
}

const IN = "intake.mjs";
const MUTANTS = [
  { name: "null domain refused again", patches: [{ file: IN, from: 'if (c.domain === null && nullDomain === "ok") b.domain = null;', to: "if (false) b.domain = null;" }], expect: [/^N1: /, /^N1b: /, /^N1c: /, /^N3a: /] },
  { name: "a missing domain is no longer asked", patches: [{ file: IN, from: 'else b.domain = need("domain", c.domain, domainOf(c.domain || ""));', to: "else b.domain = c.domain ?? null;" }], expect: [/^N2: /] },
  { name: "a site's key accepts a null domain", patches: [{ file: IN, from: 'loc.kind === "url" ? "refuse" : "ok"', to: '"ok"' }], expect: [/^N4: /] },
  { name: "the business shape refuses a null domain again", patches: [{ file: "targets-validate.mjs", from: ' && !(k === "domain" && obj.domain === null)', to: "" }], expect: [/^N3a: /] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-intake-nosite.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "INTAKE NO SITE", scenarios, MUTANTS, scriptsDir, argv: A }));
}
