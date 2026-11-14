// Usage: node test-profile-notread.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of local-profile.mjs, checks LOC-P01 (primary category) and LOC-P06 (website) on INVENTED businesses: a value of a manual
// capture that was NOT READ (null, or the key left out) is a BLOCKED check ("not read"), never a finding; a value that was read
// and is empty ("") stays the finding; the owner's API export is complete, so an absent value there is a finding.
// It also checks LOC-P10: a competitor's secondary categories that were NOT READ (null, or the key left out) stay null, are left out of
// the comparison, and the finding or the BLOCKED check says how many lists were compared and how many were not read.
// No network, no browser, no file is read except local-profile.mjs and its imports; the competitor cases write four small files to a temporary folder and remove it.
// --mutants: watched-fail. Copies the skill, breaks one thing at a time, runs this test against the copy and requires the named
//   case to go red (green = the case measures nothing, or the patch never applied; a `from` that occurs twice is refused).
// Exit 0 = all pass, exit 1 = a case failed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : here);
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const MUT = [
    { id: "primary-unread-is-a-finding", file: "local-profile.mjs", from: 'if (p.primaryCategory == null) notRead("LOC-P01", "primary category", UNREAD_LISTING); else ', to: "", red: "case 2:" },
    { id: "website-unread-is-a-finding", file: "local-profile.mjs", from: 'if (p.website == null) notRead("LOC-P06", "website", UNREAD_LISTING); else ', to: "", red: "case 2:" },
    { id: "primary-null-read-as-empty", file: "local-profile.mjs", from: 'primaryCategory: typeof j.primaryCategory === "string" ? j.primaryCategory : null,', to: 'primaryCategory: j.primaryCategory || "",', red: "case 1:" },
    { id: "website-null-read-as-empty", file: "local-profile.mjs", from: 'website: typeof j.website === "string" ? j.website : null,', to: 'website: j.website || "",', red: "case 1:" },
    { id: "primary-empty-read-as-unread", file: "local-profile.mjs", from: 'primaryCategory: typeof j.primaryCategory === "string" ? j.primaryCategory : null,', to: "primaryCategory: j.primaryCategory || null,", red: "case 3:" },
    { id: "website-empty-read-as-unread", file: "local-profile.mjs", from: 'website: typeof j.website === "string" ? j.website : null,', to: "website: j.website || null,", red: "case 3:" },
    { id: "api-no-primary-is-unread", file: "local-profile.mjs", from: 'primaryCategory: cats.primaryCategory?.displayName || "",', to: "primaryCategory: cats.primaryCategory?.displayName || null,", red: "case 5:" },
    { id: "api-no-website-is-unread", file: "local-profile.mjs", from: 'website: L.websiteUri || "",', to: "website: L.websiteUri || null,", red: "case 5:" },
    { id: "competitor-null-read-as-empty", file: "local-profile.mjs", from: 'secondaryCategories: Array.isArray(c.secondaryCategories) ? c.secondaryCategories : null,', to: "secondaryCategories: c.secondaryCategories || [],", red: "case 6:" },
    { id: "competitor-empty-read-as-unread", file: "local-profile.mjs", from: 'secondaryCategories: Array.isArray(c.secondaryCategories) ? c.secondaryCategories : null,', to: "secondaryCategories: c.secondaryCategories?.length ? c.secondaryCategories : null,", red: "case 6:" },
    { id: "competitor-unread-counted-as-checked", file: "local-profile.mjs", from: 'competitorsChecked: cs(catsRead.length), competitorsNotRead: catsNotRead }', to: "competitorsChecked: cs(competitors.length), competitorsNotRead: catsNotRead }", red: "case 7:" },
    { id: "competitor-not-read-count-hidden", file: "local-profile.mjs", from: '${catsNotRead ? " " + catsWords : ""}', to: '${""}', red: "case 7:" },
    { id: "competitor-unread-silent", file: "local-profile.mjs", from: "else if (catsNotRead) blockedChecks.push(", to: "else if (false) blockedChecks.push(", red: "case 8:" },
    { id: "competitor-empty-list-counted-unread", file: "local-profile.mjs", from: "competitors.filter((c) => Array.isArray(c.secondaryCategories))", to: "competitors.filter((c) => c.secondaryCategories?.length)", red: "case 9:" },
    { id: "competitor-unread-primary-dropped", file: "local-profile.mjs", from: "const used = new Set(competitors.flatMap(", to: "const used = new Set(catsRead.flatMap(", red: "case 10:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "profnr-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-profile-notread.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
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
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); if (!quiet) console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " :: " + String(detail).slice(0, 400)}`); else if (!ok) console.log(`FAIL ${name} :: ${String(detail).slice(0, 200)}`); };

const LP = await import(pathToFileURL(path.join(dir, "local-profile.mjs")).href);
const man = (o) => LP.importProfile({ kind: "manual-capture", capturedAt: "2026-10-20", name: "Sample Lender", primaryCategory: "Loan agency", website: "https://sample-lender.example/", ...o }, { file: "profile.json" });
const api = (loc) => LP.importProfile({ exportedAt: "2026-10-20", location: { title: "Sample Lender", ...loc }, reviews: { totalReviewCount: 3, averageRating: 4.5, reviews: [] } }, { file: "export.json" });
const d22 = { now: new Date("2026-10-22T12:00:00Z") }, audit = (p) => LP.auditProfile(p, [], d22);
const fids = (a) => a.findings.map((f) => f.id), bids = (a) => a.blocked.map((b) => b.id), both = ["LOC-P01", "LOC-P06"];
const mNull = man({ primaryCategory: null, website: null }), mGone = man({ primaryCategory: undefined, website: undefined }), mEmpty = man({ primaryCategory: "", website: "" }), mFull = man({});
const aNull = audit(mNull), aGone = audit(mGone), aEmpty = audit(mEmpty), aFull = audit(mFull);
const mApi = api({}), aApi = audit(mApi), aApiFull = audit(api({ categories: { primaryCategory: { displayName: "Loan agency" } }, websiteUri: "https://sample-lender.example/" }));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "profile-notread-")), cdir = path.join(tmp, "competitors"); fs.mkdirSync(cdir);
const wc = (n, o) => fs.writeFileSync(path.join(cdir, n), JSON.stringify({ capturedAt: "2026-10-18", capturedIn: "owner phone, signed out", ...o }));
wc("a.json", { name: "Maple Loans", primaryCategory: "Loan agency", secondaryCategories: ["Mortgage broker"] });
wc("b.json", { name: "Cedar Credit", primaryCategory: "Loan agency", secondaryCategories: null });
wc("c.json", { name: "Birch Finance", primaryCategory: "Loan agency" });
wc("d.json", { name: "Elm Lending", primaryCategory: "Loan agency", secondaryCategories: [] });
wc("e.json", { name: "Willow Credit", primaryCategory: "Credit union", secondaryCategories: null });
const lc = LP.loadCompetitors(cdir), by = (n) => lc.find((c) => c.name === n);
const four = ["Maple Loans", "Cedar Credit", "Birch Finance", "Elm Lending"].map(by);
const mine = man({ secondaryCategories: [] });
const p10 = (comps) => { const a = LP.auditProfile(mine, comps, d22); return { f: a.findings.find((x) => x.id === "LOC-P10"), b: a.blocked.filter((x) => x.id === "LOC-P10") }; };

check("case 1: a primary category and a website that were not read (null, or the key left out) stay null at import",
  [mNull, mGone].every((m) => m.primaryCategory === null && m.website === null),
  [mNull.primaryCategory, mNull.website, mGone.primaryCategory, mGone.website].map((v) => JSON.stringify(v)).join(" "));
check("case 2: a primary category or a website that was not read is never a finding: LOC-P01 and LOC-P06 are BLOCKED checks",
  both.every((id) => !fids(aNull).includes(id) && !fids(aGone).includes(id) && aNull.blocked.some((b) => b.id === id && /not read/.test(b.reason) && b.unblock) && bids(aGone).includes(id)),
  `${fids(aNull).join()} | ${bids(aNull).join()}`);
check("case 3: a primary category or a website read and found empty is the finding, not a BLOCKED check",
  mEmpty.primaryCategory === "" && mEmpty.website === "" && both.every((id) => fids(aEmpty).includes(id) && !bids(aEmpty).includes(id)),
  `${JSON.stringify(mEmpty.primaryCategory)} ${JSON.stringify(mEmpty.website)} | ${fids(aEmpty).join()} | ${bids(aEmpty).join()}`);
check("case 4: a primary category and a website that were read give neither a finding nor a BLOCKED check",
  mFull.website === "https://sample-lender.example/" && both.every((id) => !fids(aFull).includes(id) && !bids(aFull).includes(id)),
  `${fids(aFull).join()} | ${bids(aFull).join()}`);
check("case 5: the owner's API export is complete: an absent primary category or website is a finding, never not read",
  both.every((id) => fids(aApi).includes(id) && !bids(aApi).includes(id)) && both.every((id) => !fids(aApiFull).includes(id) && !bids(aApiFull).includes(id)),
  `${fids(aApi).join()} | ${bids(aApi).join()} | ${fids(aApiFull).join()} | ${bids(aApiFull).join()}`);
check("case 6: a competitor's secondary categories that were not read (null, or the key left out) stay null at import; read and empty stays an empty list",
  by("Cedar Credit").secondaryCategories === null && by("Birch Finance").secondaryCategories === null && Array.isArray(by("Elm Lending").secondaryCategories) && by("Elm Lending").secondaryCategories.length === 0 && by("Maple Loans").secondaryCategories.join() === "Mortgage broker",
  ["Maple Loans", "Cedar Credit", "Birch Finance", "Elm Lending"].map((n) => JSON.stringify(by(n).secondaryCategories)).join(" "));
{
  const r = p10(four);
  check("case 7: LOC-P10 counts the competitors whose secondary categories were read and says how many were not",
    r.f && r.f.evidence.competitorsChecked.value === 2 && r.f.evidence.competitorsNotRead === 2 && /2 of 4/.test(r.f.detail) && /not read/.test(r.f.detail) && r.f.evidence.missing.join() === "Mortgage broker",
    `${r.f?.detail} | checked ${r.f?.evidence.competitorsChecked?.value} | not read ${r.f?.evidence.competitorsNotRead}`);
}
{
  const r = p10([by("Cedar Credit"), by("Birch Finance")]);
  check("case 8: with no competitor list read and nothing missing, LOC-P10 is a BLOCKED check that says how many were not read, never silence",
    !r.f && r.b.length === 1 && /not read/.test(r.b[0].reason) && /0 of 2/.test(r.b[0].reason) && r.b[0].unblock,
    JSON.stringify(r));
}
{
  const r = p10([by("Maple Loans"), by("Elm Lending")]);
  check("case 9: a competitor list that was read, empty or not, counts as read: nothing is said to be not read",
    r.f && r.f.evidence.competitorsChecked.value === 2 && !/not read/.test(r.f.detail) && r.b.length === 0,
    JSON.stringify(r));
}
{
  const r = p10([by("Willow Credit")]);
  check("case 10: an unread secondary list does not remove that competitor's primary category from the comparison",
    r.f && r.f.evidence.missing.join() === "Credit union" && r.f.evidence.competitorsChecked.value === 0 && r.f.evidence.competitorsNotRead === 1 && /0 of 1/.test(r.f.detail),
    JSON.stringify(r));
}
fs.rmSync(tmp, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
