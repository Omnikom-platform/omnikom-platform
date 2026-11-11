// Usage: node test-local-nap.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of the fix found by work order 40 C: local-nap.mjs's checkCitations counted BLOCKED and UNPROVEN directory rows as "consistent", so a run where every directory was
// walled reported full name/address/phone consistency. Those rows (and a row that holds no name, address or phone, and a directory where the business is not listed) count as
// neither consistent nor inconsistent: they are listed as NOT CHECKED with their reason, and the consistency share is over the CHECKED rows only, with the denominator printed.
// Fixture: one consistent, one inconsistent, one BLOCKED and one UNPROVEN row. No network, no browser.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { runner, J, W, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const BUSINESS = { name: "Nap Test Lending", domain: "nap-test.test", kind: "lender", market: { country: "US", language: "en" }, phone: "(916) 555-0100", locations: [{ address: "100 Main St, Sacramento, CA 95814" }] };
const row = (directory, over = {}) => ({ directory, url: `https://${directory}/nap-test`, name: "Nap Test Lending", address: "100 Main St, Sacramento, CA 95814", phone: "(916) 555-0100", capturedAt: "2026-11-10", capturedIn: "owner's Edge", ...over });
const FIX = [
  row("yelp.com"),                                                                                          // consistent
  row("bbb.org", { phone: "(916) 555-0199" }),                                                              // inconsistent: another phone
  { directory: "facebook.com", url: "https://facebook.com/nap-test", capturedAt: "2026-11-10", status: "BLOCKED", reason: "login wall" },                     // BLOCKED: nothing read
  { directory: "bing.com", url: "https://bing.com/maps", capturedAt: "2026-11-10", status: "UNPROVEN", reason: "the listing page layout was not recognised" }, // UNPROVEN
];

async function scenarios(dir) {
  const results = [], check = checker(results);
  const tmp = mkTmp("nap"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
  fs.mkdirSync(home);
  const run = runner(dir, home, netLog);
  const nap = await import(pathToFileURL(path.join(dir, "local-nap.mjs")).href + "?" + Math.random());
  const lib = await import(pathToFileURL(path.join(dir, "local-lib.mjs")).href + "?" + Math.random());
  const canon = lib.canonicalNap(BUSINESS);
  try {
    const cc = nap.checkCitations(FIX, canon);
    check("nap: with one consistent, one inconsistent, one BLOCKED and one UNPROVEN row only the real comparison counts: consistent [yelp.com], 1 mismatch (bbb.org, phone), checked 2", cc.consistent.join() === "yelp.com" && cc.mismatches.length === 1 && cc.mismatches[0].directory === "bbb.org" && cc.mismatches[0].fields.join() === "phone" && cc.checked === 2, JSON.stringify({ consistent: cc.consistent, mismatches: cc.mismatches.map((m) => m.directory), checked: cc.checked }));
    check("nap: the BLOCKED and the UNPROVEN rows are listed as NOT CHECKED, each with its status and its own reason", Array.isArray(cc.notChecked) && cc.notChecked.length === 2 && cc.notChecked.find((x) => x.directory === "facebook.com")?.status === "BLOCKED" && cc.notChecked.find((x) => x.directory === "facebook.com")?.reason === "login wall" && cc.notChecked.find((x) => x.directory === "bing.com")?.status === "UNPROVEN" && /layout was not recognised/.test(cc.notChecked.find((x) => x.directory === "bing.com")?.reason || ""), JSON.stringify(cc.notChecked));
    check("nap: the consistency share is over the checked rows only (1 of 2 = 0.5, not 3 of 4), and the text prints the denominator ('1 of 2 checked')", cc.consistentShare === 0.5 && /^1 of 2 checked/.test(cc.consistency || ""), JSON.stringify([cc.consistentShare, cc.consistency]));
    const lower = nap.checkCitations([{ ...FIX[2], status: "blocked" }, { ...FIX[3], status: "Unproven" }], canon);
    check("nap: the status is read in any letter case (blocked, Unproven)", lower.notChecked?.length === 2 && lower.consistent.length === 0, JSON.stringify(lower));
    const empty = nap.checkCitations([{ directory: "yellowpages.com", capturedAt: "2026-11-10" }, { directory: "manta.com", capturedAt: "2026-11-10", listed: false }], canon);
    check("nap: a row that holds no name, address or phone, and a directory where the business is not listed, are not 'consistent' either: NOT CHECKED (nothing read / not listed)", empty.consistent.length === 0 && (empty.notChecked || []).map((x) => x.status).join() === "NOTHING READ,NOT LISTED" && empty.checked === 0 && empty.consistentShare === null, JSON.stringify(empty));
    const undated = nap.checkCitations([row("mapquest.com", { capturedAt: undefined })], canon);
    check("nap: an undated capture is still a mismatch (not evidence), never consistent", undated.mismatches.length === 1 && undated.consistent.length === 0 && undated.checked === 1, JSON.stringify(undated));
    const all = nap.checkCitations([FIX[2], FIX[3]], canon);
    check("nap: every directory walled: nothing is consistent, checked is 0, the share is null (not 100%) and the text says nothing was checked", all.consistent.length === 0 && all.mismatches.length === 0 && all.checked === 0 && all.consistentShare === null && /^0 of 0 checked/.test(String(all.consistency)) && /nothing was checked/.test(String(all.consistency)), JSON.stringify(all));

    // rows in the shape of WO 40 C's real citations.json: status BLOCKED | UNPROVEN | listed | not listed; the reason in blocked or note, how to unblock in unblock
    const at = "2026-11-10", goodRow = { name: BUSINESS.name, address: BUSINESS.locations[0].address, phone: BUSINESS.phone };
    const C = [
      { directory: "yelp.com", url: "https://www.yelp.com/biz/nap-test", status: "BLOCKED", blocked: "Yelp robot check at the first page", unblock: "the owner reads it by hand", capturedAt: at },
      { directory: "bbb.org", status: "UNPROVEN", note: "the page loaded but the phone was not visible", unblock: "read it again", capturedAt: at },
      { directory: "facebook.com", status: "listed", ...goodRow, capturedAt: at },
      { directory: "mapquest.com", status: "not listed", note: "searched by name and city: no listing", capturedAt: at },
      { directory: "manta.com", status: "listed", ...goodRow, name: "Other Name LLC", capturedAt: at },
    ];
    const cr = nap.checkCitations(C, canon), nc = (d) => (cr.notChecked || []).find((x) => x.directory === d);
    check("nap: rows in the shape of WO 40 C (status BLOCKED, UNPROVEN, listed, not listed): only the two 'listed' rows are compared (facebook.com consistent, manta.com a name mismatch), 3 rows are NOT CHECKED, the share is '1 of 2 checked'", cr.consistent.join() === "facebook.com" && cr.mismatches.map((m) => `${m.directory}:${m.fields}`).join() === "manta.com:name" && cr.checked === 2 && cr.notChecked?.length === 3 && /^1 of 2 checked/.test(String(cr.consistency)), JSON.stringify({ c: cr.consistent, m: cr.mismatches.map((m) => m.directory), n: cr.notChecked }));
    check("nap: the reason is read from reason, then blocked, then note (first present): 'Yelp robot check...' from blocked, 'the page loaded...' from note; a 'not listed' row is status NOT LISTED with its note, and the unblock text is passed on", nc("yelp.com")?.reason === "Yelp robot check at the first page" && nc("yelp.com")?.unblock === "the owner reads it by hand" && nc("bbb.org")?.reason === "the page loaded but the phone was not visible" && nc("mapquest.com")?.status === "NOT LISTED" && nc("mapquest.com")?.reason === "searched by name and city: no listing", JSON.stringify(cr.notChecked));
    const pr = nap.checkCitations([{ directory: "a.com", status: "BLOCKED", reason: "R", blocked: "B", note: "N" }, { directory: "b.com", status: "BLOCKED", blocked: "B", note: "N" }, { directory: "c.com", status: "not listed" }, { directory: "d.com", status: "UNPROVEN" }], canon);
    check("nap: the first present of reason, blocked, note wins (R, then B); 'not listed' with no text says 'not listed'; a BLOCKED or UNPROVEN row with no text says so", pr.notChecked?.map((x) => x.reason).join("|") === "R|B|not listed|UNPROVEN: no reason recorded", JSON.stringify(pr.notChecked));

    // the whole run (runNap) and the CLI
    const out = nap.runNap({ business: BUSINESS, citations: FIX, now: new Date("2026-11-11T00:00:00Z") });
    check("nap: runNap keeps consistentDirectories to the checked ones, adds notCheckedDirectories and consistency { consistent, inconsistent, checked, notChecked, share, text }", (out.consistentDirectories || []).join() === "yelp.com" && out.notCheckedDirectories?.length === 2 && out.consistency?.consistent === 1 && out.consistency.inconsistent === 1 && out.consistency.checked === 2 && out.consistency.notChecked === 2 && out.consistency.share === 0.5 && /^1 of 2 checked/.test(out.consistency.text) && out.parts.citations.status === "ok" && out.parts.citations.listings === 4, JSON.stringify({ c: out.consistentDirectories, n: out.notCheckedDirectories, k: out.consistency, p: out.parts.citations }));
    const outAll = nap.runNap({ business: BUSINESS, citations: [FIX[2], FIX[3]], now: new Date("2026-11-11T00:00:00Z") });
    check("nap: a run where every directory was walled is a BLOCKED citations part ('nothing was checked'), not a clean bill: no consistent directory, share null", outAll.parts.citations.status === "blocked" && /nothing was checked/.test(outAll.parts.citations.blocked?.reason || "") && outAll.consistentDirectories.length === 0 && outAll.consistency?.share === null && outAll.consistency?.checked === 0, JSON.stringify({ p: outAll.parts.citations, k: outAll.consistency }));
    const bf = path.join(tmp, "business.json"), cf = path.join(tmp, "citations.json"), of = path.join(tmp, "nap.json");
    W(bf, BUSINESS); W(cf, FIX);
    const r = await run("local-nap.mjs", ["--business", bf, "--citations", cf, "--out", of]);
    const shown = (() => { try { return JSON.parse(r.so); } catch { return null; } })();
    check("nap: the CLI prints the share with its denominator and names what was not checked (consistency '1 of 2 checked', notChecked: facebook.com BLOCKED, bing.com UNPROVEN), and nap.json holds the same", r.code === 0 && shown && /^1 of 2 checked/.test(shown.consistency) && shown.notChecked.length === 2 && /facebook\.com.*BLOCKED.*login wall/.test(shown.notChecked.join(" ")) && /bing\.com.*UNPROVEN/.test(shown.notChecked.join(" ")) && J(of).consistency.checked === 2, `exit ${r.code} ${r.out}`);
    // local-run's summary shows them too
    const net = fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8").trim() : "";
    check("nap: nothing in this suite left the machine (network guard log empty)", !net, net);
  } finally { rmTmp(tmp); }
  return results;
}

const LN = "local-nap.mjs";
const MUTANTS = [
  { name: "BLOCKED and UNPROVEN rows count as consistent again", patches: [{ file: LN, from: "if (st === \"BLOCKED\" || st === \"UNPROVEN\" || st === \"NOT LISTED\" || c.listed === false || (c.name == null && c.address == null && c.phone == null)) {", to: "if (false) {" }], expect: [/^nap: with one consistent/, /^nap: the BLOCKED and the UNPROVEN rows are listed/, /^nap: every directory walled/] },
  { name: "the status is read case-sensitively", patches: [{ file: LN, from: "const st = String(c.status || \"\").toUpperCase();", to: "const st = String(c.status || \"\");" }], expect: [/^nap: the status is read in any letter case/] },
  { name: "a row with nothing read counts as consistent", patches: [{ file: LN, from: " || (c.name == null && c.address == null && c.phone == null)) {", to: ") {" }], expect: [/^nap: a row that holds no name, address or phone/] },
  { name: "a directory where the business is not listed counts as consistent", patches: [{ file: LN, from: " || c.listed === false ||", to: " ||" }], expect: [/^nap: a row that holds no name, address or phone/] },
  { name: "the share is over all rows", patches: [{ file: LN, from: "const checked = ok.length + mismatches.length;", to: "const checked = list.length;" }], expect: [/^nap: with one consistent/, /^nap: the consistency share is over the checked rows only/] },
  { name: "the share is 100% when nothing was checked", patches: [{ file: LN, from: "consistentShare: checked ? ok.length / checked : null,", to: "consistentShare: checked ? ok.length / checked : 1," }], expect: [/^nap: every directory walled/, /^nap: a row that holds no name, address or phone/] },
  { name: "the denominator is not printed", patches: [{ file: LN, from: "consistency: `${ok.length} of ${checked} checked${checked ? \"\" : \": nothing was checked\"}", to: "consistency: `${ok.length} consistent" }], expect: [/^nap: the consistency share is over the checked rows only/] },
  { name: "the reason of a not-checked row is lost", patches: [{ file: LN, from: "const reason = c.reason || c.blocked || c.note ||", to: "const reason = undefined ||" }], expect: [/^nap: the BLOCKED and the UNPROVEN rows are listed/] },
  { name: "the reason is read from note before blocked", patches: [{ file: LN, from: "const reason = c.reason || c.blocked || c.note ||", to: "const reason = c.reason || c.note || c.blocked ||" }], expect: [/^nap: the first present of reason, blocked, note wins/] },
  { name: "a 'not listed' status is compared like a listing", patches: [{ file: LN, from: " || st === \"NOT LISTED\" || c.listed === false ||", to: " || c.listed === false ||" }], expect: [/^nap: rows in the shape of WO 40 C/, /^nap: the reason is read from reason, then blocked/] },
  { name: "an undated capture is consistent", patches: [{ file: LN, from: "if (!c.capturedAt) diffs.push(", to: "if (false) diffs.push(" }], expect: [/^nap: an undated capture is still a mismatch/] },
  { name: "a fully walled run is not BLOCKED", patches: [{ file: LN, from: "status: cc.checked ? \"ok\" : \"blocked\",", to: "status: \"ok\"," }], expect: [/^nap: a run where every directory was walled is a BLOCKED/] },
  { name: "the CLI hides what was not checked", patches: [{ file: LN, from: "notChecked: (r.notCheckedDirectories || []).map((x) => `${x.directory} ${x.status}: ${x.reason}`),", to: "notChecked: []," }], expect: [/^nap: the CLI prints the share/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-local-nap.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "LOCAL NAP", scenarios, MUTANTS, scriptsDir, argv: A }));
}
