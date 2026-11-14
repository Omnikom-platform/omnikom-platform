// Usage: node test-profile-notread.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of local-profile.mjs, checks LOC-P01 (primary category) and LOC-P06 (website) on INVENTED businesses: a value of a manual
// capture that was NOT READ (null, or the key left out) is a BLOCKED check ("not read"), never a finding; a value that was read
// and is empty ("") stays the finding; the owner's API export is complete, so an absent value there is a finding.
// It also checks LOC-P10: a competitor's secondary categories that were NOT READ (null, or the key left out) stay null, are left out of
// the comparison, and the finding or the BLOCKED check says how many lists were compared and how many were not read.
// No network, no browser, no file is read except local-profile.mjs, local-run.mjs and their imports; the competitor and report cases write small files to a temporary folder and remove it.
// --mutants: watched-fail. Copies the skill, breaks one thing at a time, runs this test against the copy and requires the named
//   case to go red (green = the case measures nothing, or the patch never applied; a `from` that occurs twice is refused).
// Cases 11 to 17 run local-run.mjs on invented captures in a temporary folder and read the report.md it writes.
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
    { id: "not-read-lines-not-printed", file: "local-run.mjs", from: "for (const b of nr) L.push(", to: "for (const b of []) L.push(", red: "case 11:" },
    { id: "printed-for-a-profile-that-is-not-ok", file: "local-run.mjs", from: "? out.profile.blocked : [];", to: "? out.profile.blocked : [out.profile.blocked];", red: "case 15:" },
    { id: "summary-without-the-second-number", file: "local-run.mjs", from: "${nr.length ? ", to: "${false ? ", red: "case 11:" },
    { id: "summary-changed-when-there-are-none", file: "local-run.mjs", from: "${nr.length ? ", to: "${true ? ", red: "case 12:" },
    { id: "unblock-text-dropped", file: "local-run.mjs", from: '(b.unblock ? " To fix: " + b.unblock : "")', to: '""', red: "case 11:" },
    { id: "line-printed-for-a-check-that-was-judged", file: "local-run.mjs", from: "? out.profile.blocked : [];", to: "? [...out.profile.blocked, ...out.profile.findings] : [];", red: "case 11:" },
    { id: "no-unblock-prints-undefined", file: "local-run.mjs", from: '(b.unblock ? " To fix: " + b.unblock : "")', to: '" To fix: " + b.unblock', red: "case 16:" },
    { id: "reviews-unblock-from-the-profile-list-again", file: "local-run.mjs", from: '(out.profile.status !== "ok" ? out.profile.blocked : out.pack.blocked)?.unblock', to: "(out.profile.blocked || out.pack.blocked)?.unblock", red: "case 17:" },
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
const LR = await import(pathToFileURL(path.join(dir, "local-run.mjs")).href);
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
const TODAY = "2026-10-22", TITLE = "# Local search, " + TODAY, J = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const world = (n, profile, comps = []) => { const root = path.join(tmp, "w" + n), cap = path.join(root, ".pewp", "captures", "local");
  fs.mkdirSync(path.join(cap, "competitors"), { recursive: true }); fs.writeFileSync(path.join(cap, "profile.json"), JSON.stringify(profile));
  comps.forEach((c, i) => fs.writeFileSync(path.join(cap, "competitors", "c" + i + ".json"), JSON.stringify({ primaryCategory: "Loan agency", capturedAt: "2026-10-18", capturedIn: "owner phone, signed out", ...c })));
  return { root, cap }; };
const go = (w) => { const logs = []; const r = LR.runLocal(w.root, { cwd: w.root, today: TODAY, log: (s) => logs.push(s) });
  const od = path.join(w.root, ".pewp", "local", TODAY), text = fs.readFileSync(path.join(od, "report.md"), "utf8");
  return { ...w, r, od, logs, text, lines: text.split("\n") }; };
const why = (got, want) => { const g = got.split("\n"), w = want.split("\n"); let i = w.findIndex((l, k) => l !== g[k]); if (i < 0) i = g.length === w.length ? -1 : w.length; return i < 0 ? "same" : "line " + (i + 1) + ": got " + JSON.stringify(g[i]) + " | want " + JSON.stringify(w[i]); };
const ent = (a, i) => a[i] || { id: "none", reason: "", unblock: "" }; // a missing entry fails the case, it does not throw
const BASE = { kind: "manual-capture", capturedAt: "2026-10-20", name: "Sample Lender", primaryCategory: "Loan agency", secondaryCategories: ["Mortgage broker"], services: ["Home loans"], description: "A family lender.", website: "https://sample-lender.example/", hours: "present", photosCount: 12, postsLast90d: 2, reviews: { count: 20, rating: 4.8, lastReviewDate: "2026-10-10", ownerReplyRate: 1 } };
const W1 = go(world(1, { ...BASE, primaryCategory: null, website: null, services: [] }));
const W2 = go(world(2, BASE, [{ name: "Maple Loans", secondaryCategories: ["Mortgage broker"] }, { name: "Elm Lending", secondaryCategories: [] }]));
const W3 = go(world(3, BASE, [{ name: "Maple Loans", secondaryCategories: ["Mortgage broker"] }, { name: "Cedar Credit", secondaryCategories: null }]));
const W4 = go(world(4, { ...BASE, capturedAt: undefined }));
const whole = (...ls) => ls.join("\n") + "\n";
const PACKFIX = "The owner searches '<service> <city>' on a phone in each city (or a confirmed-location browser), one page at a time, at least 45 s apart, and saves each result as JSON (see local-pack.mjs header).";
const packLine = (w) => "- NOT MEASURED, pack: no captures in " + path.join(w.cap, "pack") + ". To fix: " + PACKFIX;
const NAP = "- NOT MEASURED, nap: business.json lacks business.json: there is no canonical name/address/phone to compare against. To fix: Add name, locations[0].address and phone (string) to business.json; the owner confirms the exact wording once.";
const REV = "- NOT MEASURED, reviews: needs both our profile and local-pack captures. To fix: " + PACKFIX;
const gridLine = (w) => "- NOT MEASURED, grid: no grid captures in " + path.join(w.cap, "grid") + ". To fix: Run `local-grid.mjs plan`, then capture requests.json at human pace (45 s apart, stop at the first robot check) into that folder.";
const nline = (b) => "- NOT READ, " + b.id + ": " + b.reason.replace(/\.$/, "") + ". To fix: " + b.unblock;
{
  const bl = J(path.join(W1.od, "profile.json")).blocked, [b1, b6, b10] = [ent(bl, 0), ent(bl, 1), ent(bl, 2)];
  const F3 = "- LOC-P03 No services listed: The profile lists no services. Fix: List each service with a short description.";
  const SUMMARY = "**1 profile findings, 3 profile checks not read; map pack not measured; name/address/phone not checked.**";
  const want = whole(TITLE, "", SUMMARY, "", packLine(W1), NAP, REV, F3, nline(b1), nline(b6), nline(b10), gridLine(W1));
  check("case 11: an ok profile whose primary category and website were not read: the report lists each as a NOT READ line and the summary says both numbers",
    W1.text === want && bl.map((b) => b.id).join() === "LOC-P01,LOC-P06,LOC-P10..P13"
      && b1.reason.startsWith("primary category not read: the capture holds no value for it (null)") && b6.reason.startsWith("website not read: the capture holds no value for it (null)")
      && b10.reason.startsWith("no competitor profile captures: category, photo, review count")
      && b1.unblock.startsWith("Read the primary category and the website link on the public listing") && b6.unblock.startsWith("Read the primary category and the website link on the public listing")
      && b10.unblock.startsWith("Read the top 3 local-pack businesses' public listings once by hand") && !/NOT READ, LOC-P03/.test(W1.text),
    why(W1.text, want) + " | " + bl.map((b) => b.id).join());
}
{
  const want = whole(TITLE, "", "**0 profile findings; map pack not measured; name/address/phone not checked.**", "", packLine(W2), NAP, REV, gridLine(W2));
  check("case 12: an ok profile with everything read: no NOT READ line and the summary line is today's text", W2.text === want && !/NOT READ/.test(W2.text), why(W2.text, want));
}
{
  const b = J(path.join(W3.od, "profile.json")).blocked, N10 = nline(ent(b, 0));
  const want = whole(TITLE, "", "**0 profile findings, 1 profile checks not read; map pack not measured; name/address/phone not checked.**", "", packLine(W3), NAP, REV, N10, gridLine(W3));
  check("case 13: a competitor capture whose secondary categories were not read: the LOC-P10 not-read entry is a NOT READ line with its counts",
    W3.text === want && b.length === 1 && ent(b, 0).id === "LOC-P10"
      && N10.startsWith("- NOT READ, LOC-P10: Compared the secondary categories of 1 of 2 competitors; 1 not read. Nothing is concluded about the unread ones. To fix: Read the secondary categories on each competitor's listing") && !/ones\.\./.test(W3.text),
    why(W3.text, want));
}
{
  const pj = J(path.join(W1.od, "profile.json")), sj = J(path.join(W1.od, "summary.json"));
  const parts = { profile: "ok", pack: "BLOCKED", nap: "BLOCKED", reviews: "BLOCKED", grid: "BLOCKED" };
  const logWant = "local 2026-10-22: profile=ok pack=BLOCKED nap=BLOCKED reviews=BLOCKED grid=BLOCKED; wrote " + path.join(W1.root, ".pewp", "local", TODAY);
  check("case 14: nothing else changes: profile.json, summary.json, the returned parts and the log line are as before",
    Object.keys(pj).join() === "status,profile,findings,blocked" && pj.blocked.length === 3 && pj.findings.length === 1
      && JSON.stringify(sj) === JSON.stringify({ date: TODAY, parts }) && JSON.stringify(W1.r.parts) === JSON.stringify(parts) && W1.logs.length === 1 && W1.logs[0] === logWant,
    Object.keys(pj).join() + " | " + JSON.stringify(sj) + " | " + JSON.stringify(W1.logs));
}
{
  const DATEFIX = "Add the date the listing was read: a capture without a date is not evidence.";
  const PROF = "- NOT MEASURED, profile: the manual capture has no capturedAt date. To fix: " + DATEFIX;
  const REV2 = REV.replace("To fix: " + PACKFIX, "To fix: " + DATEFIX);
  const want = whole(TITLE, "", "**Business Profile not measured; map pack not measured; name/address/phone not checked.**", "", PROF, packLine(W4), NAP, REV2, gridLine(W4));
  check("case 15: a profile that was not read at all (undated capture) gets no NOT READ line: the report is today's", W4.text === want && !/NOT READ/.test(W4.text), why(W4.text, want));
}
{
  const bare = { id: "LOC-X1", source: "invented source", reason: "the invented field was not read" };
  const full = { id: "LOC-X2", source: "invented source", reason: "an invented check could not run.", unblock: "Read it once by hand." };
  let a = "", b = "", err = "";
  try { a = LR.notReadLine(bare); b = LR.notReadLine(full); } catch (e) { err = String(e); }
  check("case 16: a not-read entry without a way to unblock ends after its reason, one with it ends with To fix; no full stop is doubled",
    !err && a === "- NOT READ, LOC-X1: the invented field was not read." && b === "- NOT READ, LOC-X2: an invented check could not run. To fix: Read it once by hand." && !/undefined/.test(a + b),
    err || a + " | " + b);
}
{
  const line = W2.lines.find((l) => l.startsWith("- NOT MEASURED, reviews:")) || "", un = J(path.join(W2.od, "reviews.json")).blocked?.unblock;
  check("case 17: an ok profile with no map pack capture: the reviews line and reviews.json carry the pack's own way to unblock, never undefined",
    line === REV && un === PACKFIX && !/undefined/.test(W2.text), line + " | " + un);
}
fs.rmSync(tmp, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
