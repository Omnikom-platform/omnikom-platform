// Usage: node test-ads-untied.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of import-ads.mjs and of its reader report-live.mjs on INVENTED captures: an ad library Page that was found under the business's name but
// could not be tied to the business ("blocked": "page not tied to the business") is its own NOT KNOWN state. It becomes a row with status
// "blocked" (running, adCount, since null), it is never the business's ads and never "no ads", and the report prints it as not known and counts it apart.
// A capture that says blocked AND running, or blocked with no words, or with a wrong library or url or no advertiser is still rejected.
// Captures that were read keep their meaning (no status on their rows, "no ads" is false and 0).
// Cases 7 to 12 hold the library-not-read rule: a library with no accepted capture is NOT READ, never "no ads".
// No network (netguard-import.mjs refuses any non-local request), no browser; every case writes small files to a temporary folder and removes it.
// --mutants: watched-fail. Copies the skill, breaks one thing at a time, runs this test against the copy and requires the named
//   case to go red (green = the case measures nothing, or the patch never applied; a `from` that occurs twice is refused).
// Exit 0 = all pass, exit 1 = a case failed.
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
    { id: "blocked-capture-rejected", file: "import-ads.mjs", from: "if (nonEmpty(j.blocked)) {", to: "if (false) {", red: "case 1:" },
    { id: "empty-blocked-accepted", file: "import-ads.mjs", from: "if (nonEmpty(j.blocked)) {", to: "if (j.blocked != null) {", red: "case 4:" },
    { id: "blocked-and-running-accepted", file: "import-ads.mjs", from: "if (j.running != null) e.push(", to: "if (false) e.push(", red: "case 4:" },
    { id: "blocked-row-has-a-number", file: "import-ads.mjs", from: 'status: "blocked", blocked: j.blocked.trim(), running: null, adCount: null,', to: 'status: "blocked", blocked: j.blocked.trim(), running: false, adCount: 0,', red: "case 2:" },
    { id: "unknown-read-as-no-ads", file: "import-ads.mjs", from: "running: on ? true : nk || nr.length ? null : false,", to: "running: on ? true : false,", red: "case 3:" },
    { id: "unknown-counted-as-checked", file: "import-ads.mjs", from: "advertisersChecked: advertisers.filter((x) => x.running !== null).length,", to: "advertisersChecked: advertisers.length,", red: "case 3:" },
    { id: "unknown-ad-count-zero", file: "import-ads.mjs", from: "adCount: on || (!nk && !nr.length) ? ok.reduce((s, r) => s + r.adCount, 0) : null }", to: "adCount: ok.reduce((s, r) => s + r.adCount, 0) }", red: "case 3:" },
    { id: "known-no-ads-read-as-unknown", file: "import-ads.mjs", from: "running: on ? true : nk || nr.length ? null : false,", to: "running: on ? true : null,", red: "case 5:" },
    { id: "blocked-capture-not-checked", file: "import-ads.mjs", from: "if (e.length) return { errors: e }; // a blocked capture is checked like any other", to: "if (false) return { errors: e }; // a blocked capture is checked like any other", red: "case 4:" },
    { id: "blocked-bad-url-accepted", file: "import-ads.mjs", from: '!isHttp(j.url)) e.push("url is not an http(s) address (blocked)");', to: '!isHttp(j.url) && false) e.push("url is not an http(s) address (blocked)");', red: "case 4:" },
    { id: "unknown-libraries-uncounted", file: "import-ads.mjs", from: "librariesNotKnown: nk,", to: "librariesNotKnown: 0,", red: "case 3:" },
    { id: "unknown-advertisers-uncounted", file: "import-ads.mjs", from: "advertisersNotKnown: advertisers.filter((x) => x.running === null).length,", to: "advertisersNotKnown: 0,", red: "case 3:" },
    { id: "report-unknown-client-as-not-running", file: "report-live.mjs", from: '${y.clientRunning == null ? "whether', to: '${false ? "whether', red: "case 6:" },
    { id: "report-unknown-not-counted-apart", file: "report-live.mjs", from: "...(nk ? [`- Not known:", to: "...(false ? [`- Not known:", red: "case 6:" },
    { id: "not-read-counts-as-no-ads", file: "import-ads.mjs", from: "running: on ? true : nk || nr.length ? null : false,", to: "running: on ? true : nk ? null : false,", red: "case 7:" },
    { id: "not-read-ad-count-zero", file: "import-ads.mjs", from: "on || (!nk && !nr.length) ?", to: "on || !nk ?", red: "case 7:" },
    { id: "not-read-list-empty", file: "import-ads.mjs", from: "librariesNotRead: nr,", to: "librariesNotRead: [],", red: "case 7:" },
    { id: "expected-set-is-only-google", file: "import-ads.mjs", from: "nr = LIBRARIES.filter(", to: "nr = LIBRARIES.slice(0, 1).filter(", red: "case 7:" },
    { id: "ads-and-not-read-becomes-unknown", file: "import-ads.mjs", from: "running: on ? true : nk || nr.length ? null : false,", to: "running: nr.length ? null : on ? true : nk ? null : false,", red: "case 9:" },
    { id: "rejected-meta-file-accepted", file: "import-ads.mjs", from: 'if (typeof j.running !== "boolean") e.push(', to: 'if (false) e.push(', red: "case 10:" },
    { id: "report-half-sentence-dropped", file: "report-live.mjs", from: "return [half ? `", to: "return [false ? `", red: "case 11:" },
    { id: "report-both-read-sentence-lost", file: "report-live.mjs", from: '${y.clientRunning ? "" : "not "}running ads', to: '${""}running ads', red: "case 12:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "adsuntied-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-ads-untied.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
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
const base = { capturedAt: ago(1), browser: "owner's Edge" };
const UNTIED = "page not tied to the business";
const blk = (advertiser, library, o = {}) => ({ ...base, advertiser, library, region: "US", blocked: UNTIED, ...o });
const known = { "client-google.json": { ...base, advertiser: "client", library: "google-transparency", running: false },
  "client-meta.json": { ...base, advertiser: "client", library: "meta-ad-library", running: true, adCount: 3 },
  "rival-google.json": { ...base, advertiser: "rival-lender.example", library: "google-transparency", running: true, adCount: 25 },
  "other-google.json": { ...base, advertiser: "other-lender.example", library: "google-transparency", running: false },
  "other-meta.json": { ...base, advertiser: "other-lender.example", library: "meta-ad-library", running: false } };
const mixed = { "client-google.json": known["client-google.json"], "client-meta.json": blk("client", "meta-ad-library"),
  "rival-google.json": known["rival-google.json"], "rival-meta.json": blk("rival-lender.example", "meta-ad-library"),
  "other-google.json": known["other-google.json"], "other-meta.json": blk("other-lender.example", "meta-ad-library"),
  "third-meta.json": blk("third-lender.example", "meta-ad-library") };

const tmp = mkTmp("ads-untied"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
fs.mkdirSync(home);
const run = runner(dir, home, netLog);
let n = 0;
const world = (files) => {
  const cwd = path.join(tmp, `w${n++}`), pewp = path.join(cwd, "site-checks", HOST, ".pewp");
  for (const [f, body] of Object.entries(files)) W(path.join(pewp, "captures", "ads", f), body);
  const out = path.join(pewp, "research", "ads.json");
  const go = () => run("import-ads.mjs", [SITE, "--cwd", cwd]);
  // a BLOCKED exit overwrites ads.json without rows: read it only after exit 0
  const doc = (r) => (r.code === 0 && fs.existsSync(out) ? J(out) : { rows: [], summary: {}, rejected: [] });
  return { cwd, pewp, go, doc };
};
const lastLine = (s) => String(s).trim().split("\n").pop();
const G = "google-transparency", M = "meta-ad-library";
const bothNone = { "client-google.json": known["client-google.json"], "client-meta.json": { ...base, advertiser: "client", library: M, running: false } };
const half = { "client-google.json": known["client-google.json"], "rival-google.json": known["rival-google.json"], "other-google.json": known["other-google.json"] };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const adsBlock = async (files) => {
  const w = world(files), r0 = await w.go(), sd = path.join(w.cwd, "site-checks", HOST, "snapshots", "2026-10-24");
  const pg = { measuredAt: "2026-10-24T10:00:00Z", vitals: { lcpMs: 1500, cls: 0.01, tbtMs: 100 }, totals: { bytes: 1024000, requests: 20 }, page: { canonical: "https://sample-valley-realty.test/", metaDescription: "d", h1Count: 1, structuredData: [{ ok: true, types: ["WebPage"] }], og: { "og:title": "t" }, robotsMeta: [] } };
  for (const [p, b] of [["_site.json", { finishedAt: "2026-10-24T10:00:00Z", runs: 1, stoppedEarly: null, machineLoad: null, pages: [{ url: SITE, slug: "home", status: 200 }] }], ["site/robots.json", { status: 200, groups: [{ agents: ["*"], rules: [] }] }], ["site/sitemaps.json", { urlCount: 3 }], ["site/probes.json", { notFound: { finalStatus: 404 } }], ["pages/home/browser-mobile.json", { url: SITE, ...pg }], ["pages/home/response.json", { headers: {} }]]) W(path.join(sd, ...p.split("/")), b);
  const r = await run("report-live.mjs", [SITE, "--cwd", w.cwd, "--snapshot", sd], { env: { GSC_TOKEN_FILE: "", GSC_SERVICE_ACCOUNT_FILE: "", GSC_SERVICE_ACCOUNT_JSON_B64: "" } });
  const f = path.join(w.pewp, "report.md"), md = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  return { r0, r, ads: md.split("### Ads")[1] || "" };
};

try {
  // case 1: the wrong line
  {
    const w = world({ "untied-meta.json": blk("rival-lender.example", "meta-ad-library") });
    const r = await w.go(), d = w.doc(r);
    check("case 1: a Meta Ad Library capture that says the Page could not be tied to the business is accepted, not rejected",
      r.code === 0 && d.rejected.length === 0 && d.rows.length === 1, `exit ${r.code} | ${lastLine(r.so)}`);
    // case 2: the row
    const x = d.rows[0] || {};
    check("case 2: the row is its own state: blocked, never a count and never \"no ads\" (running, adCount, since null)",
      x.status === "blocked" && x.blocked === UNTIED && x.running === null && x.adCount === null && x.since === null && x.runningDays === null && Array.isArray(x.formats) && x.formats.length === 0 && x.file === "untied-meta.json" && !!x.capturedAt && /^OK ads: 1 rows from 1 files, 0 rejected/m.test(r.so),
      `${JSON.stringify(x)} | ${lastLine(r.so)}`);
  }
  // case 3: the summary
  {
    const w = world(mixed), r = await w.go(), d = w.doc(r), s = d.summary, ad = (a) => (s.advertisers || []).find((x) => x.advertiser === a) || {};
    check("case 3: a Page that was not tied is NOT KNOWN in the summary: never the client's ads, never \"no ads\", never counted as checked",
      r.code === 0 && ad("client").running === null && s.clientRunning === null
      && ad("rival-lender.example").running === true && ad("rival-lender.example").adCount === 25 && ad("rival-lender.example").librariesChecked === 1 && ad("rival-lender.example").librariesNotKnown === 1
      && ad("other-lender.example").running === null && ad("other-lender.example").adCount === null
      && ad("third-lender.example").running === null && ad("third-lender.example").librariesChecked === 0
      && s.advertisersChecked === 1 && s.advertisersNotKnown === 3 && s.advertisersRunning === 1 && s.competitorsRunning === 1,
      `exit ${r.code} | ${JSON.stringify(s)}`);
  }
  // case 4: not a loophole
  {
    const bad = {
      "r1.json": { ...blk("client", "meta-ad-library"), running: true, adCount: 2 },
      "r2.json": { ...blk("client", "meta-ad-library"), running: false },
      "r3.json": { ...base, advertiser: "client", library: "meta-ad-library" },
      "r4.json": blk("client", "meta-ad-library", { blocked: "  " }),
      "r5.json": blk("client", "meta-ad-library", { url: "not a url" }),
      "r6.json": blk("client", "bing-ads"),
      "r7.json": blk("", "meta-ad-library"),
    };
    const w = world({ "client-google.json": known["client-google.json"], ...bad }), r = await w.go(), d = w.doc(r);
    const why = (f) => (d.rejected.find((x) => x.file === f)?.reason || "");
    const want = { "r1.json": /blocked must not also say running/, "r2.json": /blocked must not also say running/, "r3.json": /running must be true or false/, "r4.json": /running must be true or false/, "r5.json": /url is not an http/, "r6.json": /library is not/, "r7.json": /no advertiser/ };
    check("case 4: blocked is not a loophole: with a running value, with no words, with a wrong library or no advertiser the file is still rejected",
      r.code === 0 && Object.entries(want).every(([f, re]) => re.test(why(f))) && d.rows.length === 1,
      `exit ${r.code} | ${Object.keys(want).map((f) => `${f}: ${why(f) || "(accepted)"}`).join(" | ")}`);
  }
  // case 5: guard, captures that were read
  {
    const w = world(known), r = await w.go(), d = w.doc(r), s = d.summary, o = (s.advertisers || []).find((x) => x.advertiser === "other-lender.example") || {};
    check("case 5: captures that were read keep their meaning: no status on the rows, \"no ads\" is false and 0, the counts as before",
      r.code === 0 && d.rows.length === 5 && d.rows.every((x) => !("status" in x)) && s.clientRunning === true && s.advertisersChecked === 3 && s.advertisersRunning === 2 && s.competitorsRunning === 1 && o.running === false && o.adCount === 0 && (s.advertisersNotKnown ?? 0) === 0,
      `exit ${r.code} | ${JSON.stringify(s)}`);
  }
  // case 6: the report reader
  {
    const w = world(mixed), r0 = await w.go();
    const sd = path.join(w.cwd, "site-checks", HOST, "snapshots", "2026-10-24");
    const pg = { measuredAt: "2026-10-24T10:00:00Z", vitals: { lcpMs: 1500, cls: 0.01, tbtMs: 100 }, totals: { bytes: 1024000, requests: 20 }, page: { canonical: "https://sample-valley-realty.test/", metaDescription: "d", h1Count: 1, structuredData: [{ ok: true, types: ["WebPage"] }], og: { "og:title": "t" }, robotsMeta: [] } };
    W(path.join(sd, "_site.json"), { finishedAt: "2026-10-24T10:00:00Z", runs: 1, stoppedEarly: null, machineLoad: null, pages: [{ url: SITE, slug: "home", status: 200 }] });
    W(path.join(sd, "site/robots.json"), { status: 200, groups: [{ agents: ["*"], rules: [] }] });
    W(path.join(sd, "site/sitemaps.json"), { urlCount: 3 });
    W(path.join(sd, "site/probes.json"), { notFound: { finalStatus: 404 } });
    W(path.join(sd, "pages", "home", "browser-mobile.json"), { url: SITE, ...pg });
    W(path.join(sd, "pages", "home", "response.json"), { headers: {} });
    const r = await run("report-live.mjs", [SITE, "--cwd", w.cwd, "--snapshot", sd], { env: { GSC_TOKEN_FILE: "", GSC_SERVICE_ACCOUNT_FILE: "", GSC_SERVICE_ACCOUNT_JSON_B64: "" } });
    const mdFile = path.join(w.pewp, "report.md"), md = fs.existsSync(mdFile) ? fs.readFileSync(mdFile, "utf8") : "";
    const ads = md.split("### Ads")[1] || "";
    check("case 6: report-live.mjs prints a Page that was not tied as not known, never as the business not running ads, and counts it apart",
      r0.code === 0 && r.code === 0 && /whether the business itself is running ads is not known/.test(ads) && !/itself is not running ads/.test(ads) && /1 of 1 advertisers are running ads/.test(ads) && /Not known: 3 advertisers/.test(ads),
      `import exit ${r0.code}, report exit ${r.code} | ${ads.slice(0, 400)} | ${lastLine(r.out)}`);
  }
  {
    const w = world(half), r = await w.go(), d = w.doc(r), s = d.summary, ad = (a) => (s.advertisers || []).find((x) => x.advertiser === a) || {};
    check("case 7: a Google capture with no ads and no Meta capture: running is null (not false), Meta is listed as not read, the rival that shows ads stays true",
      r.code === 0 && ad("client").running === null && s.clientRunning === null && ad("client").adCount === null && ad("client").librariesChecked === 1 && ad("client").librariesNotKnown === 0
      && same(ad("client").librariesRead, [G]) && same(ad("client").librariesNotRead, [M])
      && ad("rival-lender.example").running === true && ad("rival-lender.example").adCount === 25 && same(ad("rival-lender.example").librariesNotRead, [M])
      && ad("other-lender.example").running === null && s.advertisersChecked === 1 && s.advertisersNotKnown === 2 && s.advertisersRunning === 1 && s.competitorsRunning === 1,
      `exit ${r.code} | ${JSON.stringify(s)}`);
  }
  {
    const w = world(bothNone), r = await w.go(), s = w.doc(r).summary, c = (s.advertisers || [])[0] || {};
    check("case 8: both libraries read and no ads: running is false, adCount 0, nothing not known (as before)",
      r.code === 0 && c.advertiser === "client" && c.running === false && c.adCount === 0 && s.clientRunning === false && s.advertisersChecked === 1 && (s.advertisersNotKnown ?? 0) === 0, `exit ${r.code} | ${JSON.stringify(s)}`);
  }
  {
    const w = world({ "client-meta.json": known["client-meta.json"] }), r = await w.go(), s = w.doc(r).summary, c = (s.advertisers || [])[0] || {};
    check("case 9: ads shown in one library and the other not read: running stays true with its count, Google is listed as not read",
      r.code === 0 && c.running === true && c.adCount === 3 && s.clientRunning === true && same(c.librariesRead, [M]) && same(c.librariesNotRead, [G]), `exit ${r.code} | ${JSON.stringify(s)}`);
  }
  {
    const w = world({ "client-google.json": known["client-google.json"], "bad-meta.json": { ...base, advertiser: "client", library: M } }), r = await w.go(), d = w.doc(r), s = d.summary, c = (s.advertisers || [])[0] || {};
    check("case 10: a Meta file with a missing required field is rejected (and listed as rejected) and Meta counts as not read: running null, never false",
      r.code === 0 && d.rows.length === 1 && /running must be true or false/.test(d.rejected.find((x) => x.file === "bad-meta.json")?.reason || "") && c.running === null && same(c.librariesNotRead, [M]) && s.clientRunning === null,
      `exit ${r.code} | ${JSON.stringify(d.rejected)} | ${JSON.stringify(s)}`);
  }
  {
    const { r0, r, ads } = await adsBlock(half);
    check("case 11: report-live.mjs says no ads found in the Google library and Meta not read, never that the business is not running ads",
      r0.code === 0 && r.code === 0 && /the business itself: no ads found in Google's ad library; Meta's ad library: not read/.test(ads) && !/itself is not running ads/.test(ads) && !/is not known/.test(ads) && /1 of 1 advertisers are running ads/.test(ads) && /Not known: 2 advertisers/.test(ads),
      `import exit ${r0.code}, report exit ${r.code} | ${ads.slice(0, 400)}`);
  }
  {
    const { r0, r, ads } = await adsBlock(bothNone);
    check("case 12: with both libraries read and no ads the report still says the business itself is not running ads, and names nothing as not read",
      r0.code === 0 && r.code === 0 && /0 of 1 advertisers are running ads; the business itself is not running ads/.test(ads) && !/not read/.test(ads) && !/Not known/.test(ads),
      `import exit ${r0.code}, report exit ${r.code} | ${ads.slice(0, 400)}`);
  }
} catch (e) {
  check("test harness ran to the end", false, e.stack || e);
}
rmTmp(tmp);

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
