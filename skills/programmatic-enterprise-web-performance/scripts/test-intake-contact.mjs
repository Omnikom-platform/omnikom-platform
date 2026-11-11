// Usage: node test-intake-contact.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of the intake default found by work order 40 (gap list item 2): when the owner has not answered, intake takes the site's OWN contact block (name, address, phone)
// from the page as a labelled default, so the local suite (local-nap, local-grid) is not BLOCKED for want of an address and a phone. Every value carries
// "source": "the site, not confirmed by the owner" in business.json's contact block and a `defaulted` row in intake-facts.json; the owner's answers still win, and nothing is
// invented when the page has no contact block. Fixtures only: small home pages in a repo-style folder (index.html), complete owner answers for everything else; no network.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { runner, J, W, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const SITE_LABEL = "the site, not confirmed by the owner";
const ADDR = "100 Main St, Sacramento, CA 95814", PHONE = "(916) 555-0100";

const page = (head, body) => `<!doctype html><html lang="en"><head><title>Contact Test Lending</title><meta name="description" content="Loans for investors"><meta property="og:site_name" content="Contact Test Lending">${head}</head><body>${body}</body></html>`;
const LD = (extra = {}) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "RealEstateAgent", name: "Contact Test Lending", telephone: PHONE, address: { "@type": "PostalAddress", streetAddress: "100 Main St", addressLocality: "Sacramento", addressRegion: "CA", postalCode: "95814", addressCountry: "US" }, ...extra })}</script>`;
const PAGES = {
  jsonld: page(LD(), "<h1>Contact Test Lending</h1><p>Hard money loans.</p>"),
  tel_address: page("", `<header><a href="tel:+19165550100">Call us ${PHONE}</a></header><h1>Contact Test Lending</h1><footer><address>100 Main St<br>Sacramento, CA 95814</address></footer>`),
  visible: page("", `<h1>Contact Test Lending</h1><footer><p>Visit us at ${ADDR} or call ${PHONE}.</p></footer>`),
  none: page("", "<h1>Contact Test Lending</h1><p>Loans for investors. Ask us anything.</p>"),
  two_phones: page(LD(), `<header><a href="tel:+18885550199">Call (888) 555-0199</a></header><h1>Contact Test Lending</h1>`),
};
const ANSWERS = { domain: "contact-test.test", kind: "lender", offer: "hard money loans", audience: "investors", market: { country: "US", language: "en" }, locations: [{ name: "Sacramento, CA", serviceArea: ["Elk Grove, CA"] }], goals: ["leads"], competitors: [], brand: { constraints: [] }, existing: { searchConsole: false, site: null, businessProfile: null }, launchState: "preview" };

async function scenarios(dir) {
  const results = [], check = checker(results);
  const tmp = mkTmp("intake-contact"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
  fs.mkdirSync(home);
  const run = runner(dir, home, netLog);
  const lib = await import(pathToFileURL(path.join(dir, "local-lib.mjs")).href + "?" + Math.random());
  let n = 0;
  const intake = async (pageKey, answers = ANSWERS) => {
    const folder = path.join(tmp, `s${n++}`);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "index.html"), PAGES[pageKey]);
    W(path.join(folder, ".pewp", "intake-answers.json"), answers);
    const r = await run("intake.mjs", [folder, "--cwd", tmp]);
    const bf = path.join(folder, ".pewp", "business.json"), ff = path.join(folder, ".pewp", "intake-facts.json");
    return { r, b: fs.existsSync(bf) ? J(bf) : null, facts: fs.existsSync(ff) ? J(ff) : null };
  };
  try {
    // 1. JSON-LD
    let x = await intake("jsonld");
    check("contact: from the page's JSON-LD (telephone, address) intake fills business.phone and locations[0].address when the owner gave neither, and the run is complete (exit 0)", x.r.code === 0 && x.b?.phone === PHONE && x.b?.locations?.[0]?.address === ADDR, `exit ${x.r.code} ${x.r.out.slice(-400)} ${JSON.stringify([x.b?.phone, x.b?.locations])}`);
    check(`contact: business.contact says where each value came from: phone, address and name each carry "source": "${SITE_LABEL}" and where on the page it was read`, x.b?.contact?.phone?.source === SITE_LABEL && x.b.contact.address?.source === SITE_LABEL && x.b.contact.name?.source === SITE_LABEL && /JSON-LD/.test(x.b.contact.phone.from || "") && x.b.contact.phone.value === PHONE && x.b.contact.address.value === ADDR, JSON.stringify(x.b?.contact));
    check("contact: intake-facts.json lists phone and locations.address under `defaulted` with the reason, and the provenance of phone is 'default' (never 'owner')", (x.facts?.defaulted || []).some((d) => d.field === "phone" && d.value === PHONE && /not confirmed by the owner/.test(d.why)) && (x.facts?.defaulted || []).some((d) => d.field === "locations.address" && /not confirmed by the owner/.test(d.why)) && x.b?.provenance?.phone === "default", JSON.stringify([x.facts?.defaulted, x.b?.provenance]));
    const firstB = x.b;
    const canon = lib.canonicalNap(x.b);
    check("contact: with it the local suite has what it needs: canonicalNap (name, address, phone) is ok, not BLOCKED", canon.ok === true && canon.nap.phone === PHONE && canon.nap.address === ADDR, JSON.stringify(canon));
    check("contact: the run's last output names the defaults (a line 'default  phone: ...')", /^\s*default\s+phone: /m.test(x.r.so) && /^\s*default\s+locations\.address: /m.test(x.r.so), x.r.so.slice(-600));
    // 2. a tel: link and an <address> element
    x = await intake("tel_address");
    check("contact: without JSON-LD the phone is read from the page's tel: link and the address from its <address> element (the 'from' says tel: link and address element)", x.b?.phone === PHONE && x.b?.locations?.[0]?.address === ADDR && /tel: link/.test(x.b?.contact?.phone?.from || "") && /address element/.test(x.b?.contact?.address?.from || ""), JSON.stringify([x.b?.phone, x.b?.locations, x.b?.contact]));
    // 3. visible text only
    x = await intake("visible");
    check("contact: with neither, a street address ('100 Main St, Sacramento, CA 95814') and a phone in the visible text are read, said to be from the visible text", x.b?.phone === PHONE && x.b?.locations?.[0]?.address === ADDR && /visible text/.test(x.b?.contact?.phone?.from || "") && /visible text/.test(x.b?.contact?.address?.from || ""), JSON.stringify([x.b?.phone, x.b?.locations, x.b?.contact]));
    // 4. the owner's answers win
    x = await intake("jsonld", { ...ANSWERS, name: "Contact Test Lending", phone: "(916) 555-0999", locations: [{ name: "Sacramento, CA", address: "9 Other Rd, Sacramento, CA 95815", serviceArea: ["Elk Grove, CA"] }] });
    check("contact: the owner's answers win: the phone and the address the owner gave are used, their source is 'the owner' (not the site's), and there is no `defaulted` row for them", x.b?.phone === "(916) 555-0999" && x.b?.locations?.[0]?.address === "9 Other Rd, Sacramento, CA 95815" && x.b?.contact?.phone?.source === "the owner" && x.b?.contact?.address?.source === "the owner" && x.b?.contact?.name?.source === "the owner" && !(x.facts?.defaulted || []).some((d) => d.field === "phone" || d.field === "locations.address"), JSON.stringify([x.b?.phone, x.b?.locations, x.b?.contact, x.facts?.defaulted]));
    x = await intake("jsonld", { ...ANSWERS, phone: "(916) 555-0999" });
    check("contact: answering only the phone: the phone is the owner's, the address still comes from the site as a labelled default", x.b?.phone === "(916) 555-0999" && x.b?.contact?.phone?.source === "the owner" && x.b?.locations?.[0]?.address === ADDR && x.b?.contact?.address?.source === SITE_LABEL, JSON.stringify([x.b?.phone, x.b?.locations, x.b?.contact]));
    // 5. nothing invented
    x = await intake("none");
    check("contact: a page with no contact block gives no phone and no address (nothing is invented), no contact entry for them, no `defaulted` row, and the address stays null", x.r.code === 0 && x.b && !("phone" in x.b) && x.b.locations[0].address === null && !x.b.contact?.phone && !x.b.contact?.address && !(x.facts?.defaulted || []).some((d) => d.field === "phone" || d.field === "locations.address") && lib.canonicalNap(x.b).ok === false, JSON.stringify([x.b?.phone, x.b?.locations, x.b?.contact]));
    // 6. two phones: the JSON-LD one wins, the other is listed
    x = await intake("two_phones");
    check("contact: with two phones on the page the business's own JSON-LD number wins over a tel: link and the other number is listed under 'others' (a tracking number is not taken)", x.b?.phone === PHONE && (x.b?.contact?.phone?.others || []).some((o) => /888.*555.*0199/.test(o)), JSON.stringify([x.b?.phone, x.b?.contact?.phone]));
    // 7. the business still passes its own shape check
    const tvLib = await import(pathToFileURL(path.join(dir, "targets-validate.mjs")).href + "?" + Math.random());
    const vb = tvLib.validateBusiness(firstB || {});
    check("contact: business.json with the contact block still passes the business shape check (B-001, targets-validate.validateBusiness)", vb.ok === true, JSON.stringify(vb.errors));
    const net = fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8").trim() : "";
    check("contact: nothing in this suite left the machine (network guard log empty)", !net, net);
  } finally { rmTmp(tmp); }
  return results;
}

const IN = "intake.mjs";
const MUTANTS = [
  { name: "the site's contact block is not used", patches: [{ file: IN, from: "if (answers.phone === undefined && get(\"contact.phone\")) {", to: "if (false) {" }], expect: [/^contact: from the page's JSON-LD/, /^contact: business.contact says where/] },
  { name: "the site's number overrides the owner's answer", patches: [{ file: IN, from: "if (answers.phone === undefined && get(\"contact.phone\")) {", to: "if (get(\"contact.phone\")) {" }], expect: [/^contact: the owner's answers win/, /^contact: answering only the phone/] },
  { name: "the default is not labelled as unconfirmed", patches: [{ file: IN, from: "const SITE_UNCONFIRMED = \"the site, not confirmed by the owner\";", to: "const SITE_UNCONFIRMED = \"the site\";" }], expect: [/^contact: business.contact says where/, /^contact: answering only the phone/] },
  { name: "the tel: link is not read", patches: [{ file: IN, from: "const tel = [...h.matchAll(/<a\\b[^>]*\\bhref\\s*=\\s*[\"']tel:([^\"']+)[\"']/gi)]", to: "const tel = [...\"\".matchAll(/x/g)]" }], expect: [/^contact: without JSON-LD the phone is read from the page's tel: link/] },
  { name: "the <address> element is not read", patches: [{ file: IN, from: "const addrEl = h.match(/<address\\b[^>]*>([\\s\\S]*?)<\\/address>/i);", to: "const addrEl = null;" }], expect: [/^contact: without JSON-LD the phone is read/] },
  { name: "a street address in the visible text is not read", patches: [{ file: IN, from: "const streetRe =", to: "const streetRe0 = /$^/; const streetRe =" }, { file: IN, from: "visibleText(h).match(streetRe)", to: "null" }], expect: [/^contact: with neither, a street address/] },
  { name: "a tracking tel: link beats the JSON-LD number", patches: [{ file: IN, from: "const phone = ld.phone || tel[0] || visiblePhone;", to: "const phone = tel[0] || ld.phone || visiblePhone;" }], expect: [/^contact: with two phones on the page/] },
  { name: "an address is invented when the page has none", patches: [{ file: IN, from: "if (!l0.address && get(\"contact.address\")) {", to: "if (!l0.address) { cand.contact = { ...(cand.contact || {}) }; l0.address = ADDR_GUESS; } if (!l0.address && get(\"contact.address\")) {" }, { file: IN, from: "const SITE_UNCONFIRMED =", to: "const ADDR_GUESS = \"1 Unknown Way\"; const SITE_UNCONFIRMED =" }], expect: [/^contact: a page with no contact block gives no phone/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-intake-contact.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "INTAKE CONTACT", scenarios, MUTANTS, scriptsDir, argv: A }));
}
