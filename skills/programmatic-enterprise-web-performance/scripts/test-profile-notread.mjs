// Usage: node test-profile-notread.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of local-profile.mjs, checks LOC-P01 (primary category) and LOC-P06 (website) on INVENTED businesses: a value of a manual
// capture that was NOT READ (null, or the key left out) is a BLOCKED check ("not read"), never a finding; a value that was read
// and is empty ("") stays the finding; the owner's API export is complete, so an absent value there is a finding.
// No network, no browser, no file is read except local-profile.mjs and its imports, no temporary folder in the cases.
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

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
