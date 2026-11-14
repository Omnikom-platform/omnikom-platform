// Usage: node test-reputation-notread.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of import-reputation.mjs and of its reader report-live.mjs on INVENTED captures: a complaint count that no listed site gave is null in the
// summary and the report says "complaints not read", never 0. A count read as 0 stays 0 and prints 0; the review count and its text stay as they are.
// Counts that were read, and a summary written by the old importer, print as before. No network (netguard-import.mjs), no browser.
// --mutants: watched-fail. Breaks one thing at a time in a copy of the skill and requires the named case to go red (green = the case
//   measures nothing, or the patch never applied; a `from` that occurs twice is refused). Exit 0 = all pass, exit 1 = a case failed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runner, W, J, mkTmp, rmTmp } from "./lib-test-kit.mjs";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : here);
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const MUT = [
    { id: "complaints-null-summed-as-0", file: "import-reputation.mjs", from: 'complaints: sumRead(listed, "complaintCount"),', to: 'complaints: sumRead(listed, "complaintCount") ?? 0,', red: "case 1:" },
    { id: "read-zero-complaints-becomes-null", file: "import-reputation.mjs", from: 'complaints: sumRead(listed, "complaintCount"),', to: 'complaints: sumRead(listed.filter((r) => r.complaintCount), "complaintCount"),', red: "case 2:" },
    { id: "only-the-first-site-counted", file: "import-reputation.mjs", from: "rows.map((r) => r[k])", to: "rows.slice(0, 1).map((r) => r[k])", red: "case 3:" },
    { id: "null-read-as-zero-inside-the-sum", file: "import-reputation.mjs", from: ".filter((x) => x != null)", to: ".map((x) => x ?? 0)", red: "case 1:" },
    { id: "review-count-turned-null-again", file: "import-reputation.mjs", from: "totalReviews: listed.reduce((a, r) => a + (r.reviewCount || 0), 0),", to: 'totalReviews: sumRead(listed, "reviewCount"),', red: "case 5:" },
    { id: "report-prints-0-complaints-again", file: "report-live.mjs", from: 'x.complaints == null ? "complaints not read" : ', to: 'x.complaints == null ? "0 complaints" : ', red: "case 8:" },
    { id: "report-prints-a-read-zero-as-not-read", file: "report-live.mjs", from: 'x.complaints == null ? "complaints not read" : ', to: '!x.complaints ? "complaints not read" : ', red: "case 2:" },
    { id: "report-takes-an-absent-key-for-a-number", file: "report-live.mjs", from: 'x.complaints == null ? "complaints not read" : ', to: 'x.complaints === null ? "complaints not read" : ', red: "case 8:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repnotread-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-reputation-notread.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
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

const SITE = "https://sample-valley-realty.test/", HOST = "sample-valley-realty.test";
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
const cap = (subject, site, o) => ({ capturedAt: ago(1), browser: "owner's Edge", subject, site, ...o });
const FILES = {
  "client-google.json": cap("client", "google", { listed: true, rating: 4.8, reviewCount: 100, newestReviewDate: "2026-10-01", complaintCount: null }),
  "client-bbb.json": cap("client", "bbb", { listed: true, rating: 4, reviewCount: 20, newestReviewDate: "2026-09-20" }),
  "aaa-google.json": cap("aaa-read-zero.example", "google", { listed: true, rating: 4, reviewCount: 10, newestReviewDate: "2026-09-01", complaintCount: 0 }),
  "bbb-google.json": cap("bbb-mixed.example", "google", { listed: true, rating: 4, reviewCount: 30, newestReviewDate: "2026-08-01", complaintCount: 3 }),
  "bbb-trustpilot.json": cap("bbb-mixed.example", "trustpilot", { listed: true, rating: 4, reviewCount: 7, newestReviewDate: "2026-07-15", complaintCount: 2 }),
  "bbb-yelp.json": cap("bbb-mixed.example", "yelp", { listed: true, rating: 4, reviewCount: 5, newestReviewDate: "2026-07-01" }),
  "ccc-google.json": cap("ccc-unlisted.example", "google", { listed: false }),
  "ddd-google.json": cap("ddd-zero-reviews.example", "google", { listed: true, rating: null, reviewCount: 0, complaintCount: 0 }) };
const L = {
  client: "- client: listed on 2 of 2 review sites, 120 reviews, rating 4.67 (weighted), complaints not read, newest 2026-10-01",
  aaa: "- aaa-read-zero.example: listed on 1 of 1 review sites, 10 reviews, rating 4 (weighted), 0 complaints, newest 2026-09-01",
  bbb: "- bbb-mixed.example: listed on 3 of 3 review sites, 42 reviews, rating 4 (weighted), 5 complaints, newest 2026-08-01",
  ccc: "- ccc-unlisted.example: listed on 0 of 1 review sites, 0 reviews, rating n/a (weighted), complaints not read",
  ddd: "- ddd-zero-reviews.example: listed on 1 of 1 review sites, 0 reviews, rating n/a (weighted), 0 complaints",
  x1: "- x1.example: listed on 2 of 3 review sites, 41 reviews, rating 4.6 (weighted), 1 complaint, newest 2026-10-01",
  y2: "- y2.example: listed on 1 of 1 review sites, 0 reviews, rating n/a (weighted), 0 complaints",
  z3: "- z3.example: listed on 1 of 1 review sites, 5 reviews, rating n/a (weighted), complaints not read" };
const tmp = mkTmp("rep-notread"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
fs.mkdirSync(home);
const run = runner(dir, home, netLog);
let n = 0;
const world = () => { const cwd = path.join(tmp, `w${n++}`); return { cwd, pewp: path.join(cwd, "site-checks", HOST, ".pewp") }; };
const report = async (w) => {
  const sd = path.join(w.cwd, "site-checks", HOST, "snapshots", "2026-10-24");
  const pg = { measuredAt: "2026-10-24T10:00:00Z", vitals: { lcpMs: 1500, cls: 0.01, tbtMs: 100 }, totals: { bytes: 1024000, requests: 20 }, page: { canonical: "https://sample-valley-realty.test/", metaDescription: "d", h1Count: 1, structuredData: [{ ok: true, types: ["WebPage"] }], og: { "og:title": "t" }, robotsMeta: [] } };
  W(path.join(sd, "_site.json"), { finishedAt: "2026-10-24T10:00:00Z", runs: 1, stoppedEarly: null, machineLoad: null, pages: [{ url: SITE, slug: "home", status: 200 }] });
  W(path.join(sd, "site/robots.json"), { status: 200, groups: [{ agents: ["*"], rules: [] }] });
  W(path.join(sd, "site/sitemaps.json"), { urlCount: 3 });
  W(path.join(sd, "site/probes.json"), { notFound: { finalStatus: 404 } });
  W(path.join(sd, "pages", "home", "browser-mobile.json"), { url: SITE, ...pg });
  W(path.join(sd, "pages", "home", "response.json"), { headers: {} });
  const r = await run("report-live.mjs", [SITE, "--cwd", w.cwd, "--snapshot", sd], { env: { GSC_TOKEN_FILE: "", GSC_SERVICE_ACCOUNT_FILE: "", GSC_SERVICE_ACCOUNT_JSON_B64: "" } });
  const f = path.join(w.pewp, "report.md"), md = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  const sec = (md.split("### Reviews")[1] || "").split("\n### ")[0];
  return { code: r.code, sec, line: (s) => sec.split("\n").find((l) => l.startsWith("- " + s)) || "(no line for " + s + ")" };
};
try {
  const A = world();
  for (const [f, b] of Object.entries(FILES)) W(path.join(A.pewp, "captures", "reputation", f), b);
  const ri = await run("import-reputation.mjs", [SITE, "--cwd", A.cwd]), oa = path.join(A.pewp, "research", "reputation.json");
  const subs = (ri.code === 0 && fs.existsSync(oa) ? J(oa) : { summary: { subjects: [] } }).summary.subjects;
  const sm = (p) => subs.find((x) => x.subject.startsWith(p)) || {};
  const ra = await report(A);
  const O = world();
  W(path.join(O.pewp, "research", "reputation.json"), { rows: [{ capturedAt: "2026-10-20T10:00:00Z" }], staleCount: 0, summary: { subjects: [
    { subject: "x1.example", sitesChecked: 3, sitesListed: 2, totalReviews: 41, weightedRating: 4.6, complaints: 1, newestReviewDate: "2026-10-01" },
    { subject: "y2.example", sitesChecked: 1, sitesListed: 1, totalReviews: 0, weightedRating: null, complaints: 0, newestReviewDate: null },
    { subject: "z3.example", sitesChecked: 1, sitesListed: 1, totalReviews: 5, weightedRating: null, newestReviewDate: null }] } });
  const ro = await report(O);
  const ok = ri.code === 0 && ra.code === 0, d = (p) => `import exit ${ri.code}, report exit ${ra.code} | ${JSON.stringify(sm(p))} | ${ra.line(p)}`;
  const nc = (p) => JSON.stringify({ ...sm(p), complaints: undefined });
  check("case 1: no listed site gave a complaint count: the summary says null and the report says complaints not read, never 0 complaints", ok && sm("client").complaints === null && ra.line("client") === L.client && !/\b0 complaint/.test(ra.line("client")), d("client"));
  check("case 2: a complaint count read as 0 stays 0: the summary says 0 and the report says 0 complaints", ok && sm("aaa").complaints === 0 && ra.line("aaa") === L.aaa, d("aaa"));
  check("case 3: complaint counts of several sites are added and a site that gave none is skipped: 3 and 2 make 5", ok && sm("bbb").complaints === 5 && ra.line("bbb") === L.bbb, d("bbb"));
  check("case 4: a subject listed on no site has no complaint count read: null, and the report says complaints not read next to today's 0 reviews", ok && sm("ccc").complaints === null && ra.line("ccc") === L.ccc, d("ccc"));
  check("case 5: the review count is as before: read ones are added, none read stays 0, the line prints it as today, never review count not read", ok && sm("client").totalReviews === 120 && sm("bbb").totalReviews === 42 && sm("ccc").totalReviews === 0 && sm("ddd").totalReviews === 0 && ra.line("ddd") === L.ddd && /, 120 reviews, rating 4\.67 /.test(ra.line("client")) && !/review count/.test(ra.sec), d("ddd") + " | " + ra.line("ccc"));
  check("case 6: nothing else in the summary changes: sites, review counts, weighted rating and newest date as before",
    ok && nc("aaa") === '{"subject":"aaa-read-zero.example","sitesChecked":1,"sitesListed":1,"totalReviews":10,"weightedRating":4,"newestReviewDate":"2026-09-01"}'
    && nc("bbb") === '{"subject":"bbb-mixed.example","sitesChecked":3,"sitesListed":3,"totalReviews":42,"weightedRating":4,"newestReviewDate":"2026-08-01"}'
    && nc("client") === '{"subject":"client","sitesChecked":2,"sitesListed":2,"totalReviews":120,"weightedRating":4.67,"newestReviewDate":"2026-10-01"}'
    && nc("ccc") === '{"subject":"ccc-unlisted.example","sitesChecked":1,"sitesListed":0,"totalReviews":0,"weightedRating":null,"newestReviewDate":null}'
    && nc("ddd") === '{"subject":"ddd-zero-reviews.example","sitesChecked":1,"sitesListed":1,"totalReviews":0,"weightedRating":null,"newestReviewDate":null}', JSON.stringify(subs));
  check("case 7: a summary written by the old importer, with numbers, prints as today", ro.code === 0 && ro.line("x1") === L.x1 && ro.line("y2") === L.y2, `report exit ${ro.code} | ${ro.line("x1")} | ${ro.line("y2")}`);
  check("case 8: a summary with no complaints key prints complaints not read, never 0, and its review count as today", ro.code === 0 && ro.line("z3") === L.z3 && !/\b0 complaint/.test(ro.line("z3")), `report exit ${ro.code} | ${ro.line("z3")}`);
} catch (e) {
  check("test harness ran to the end", false, e.stack || e);
}
rmTmp(tmp);

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
