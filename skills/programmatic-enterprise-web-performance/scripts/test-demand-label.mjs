// Usage: node test-demand-label.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of report-live.mjs (missing-searches table and report.json) on an INVENTED targets.json: a demand number is printed with its own place and what it
// counts, taken from the fact; the business's city is only the target ("Target: <city>"); the same place keeps today's row; a fact with no place says so.
// No network (netguard-import.mjs), no browser.
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
    { id: "counts-dropped", file: "report-live.mjs", from: ", volCounts(m.volume)].filter(Boolean)", to: "].filter(Boolean)", red: "case 1:" },
    { id: "city-as-the-numbers-place", file: "report-live.mjs", from: 'volWhere(m.volume) || "place of this number not recorded"', to: 'm.place || "place of this number not recorded"', red: "case 1:" },
    { id: "target-label-dropped", file: "report-live.mjs", from: "`Target: ${m.place}`", to: "m.place", red: "case 1:" },
    { id: "same-place-gets-label", file: "report-live.mjs", from: "samePlace(m) ? m.place : ", to: "false ? m.place : ", red: "case 2:" },
    { id: "same-place-demand-extended", file: "report-live.mjs", from: "m.volume?.value == null || samePlace(m) ? volTxt", to: "m.volume?.value == null ? volTxt", red: "case 2:" },
    { id: "no-place-text-changed", file: "report-live.mjs", from: '"place of this number not recorded"', to: '"-"', red: "case 3:" },
    { id: "json-number-place-dropped", file: "report-live.mjs", from: "volumeAbout: { place: volPlace(r.c.volume)", to: "volumeAbout: { place: null", red: "case 4:" },
    { id: "period-days-wrong", file: "report-live.mjs", from: "Date.parse(m[3]) - Date.parse(m[2])", to: "Date.parse(m[3]) - Date.parse(m[2]) + 86400000", red: "case 1:" },
    { id: "number-loses-its-mark", file: "report-live.mjs", from: "[volTxt(m.volume), volWhere(m.volume)", to: "[String(m.volume.value), volWhere(m.volume)", red: "case 5:" },
    { id: "country-code-printed-bare", file: "report-live.mjs", from: "? `${volPlace(v)}-wide` : volPlace(v)", to: "? volPlace(v) : volPlace(v)", red: "case 1:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "demandlabel-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-demand-label.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
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
const bing = (value, o = {}) => ({ value, source: "Bing Webmaster API GetKeyword (US, en)", fetchedAt: "2026-10-20", cacheFile: null, estimate: true, unit: "Bing impressions 2026-07-22..2026-10-20 (an estimate of demand, not a search count)", location: "US", ...o });
const cl = (id, q, city, priority, volume) => ({ id, primaryQuery: q, queries: [q], intent: "local", location: city, targetPage: "new", priority, volume, difficulty: null, value: null });
const TG = { version: 1, business: HOST, market: { country: "US", language: "en" }, createdAt: "2026-10-20T09:00:00Z", clusters: [
  cl("c-hard-money", "hard money loans in sampleville", "Sampleville, CA", 9, bing(5300)),
  cl("c-bridge", "bridge loans sampleton", "Sampleton, CA", 8, bing(1200, { location: "Sampleton, CA" })),
  cl("c-flip", "fix and flip lenders samplebury", "Samplebury, CA", 7, bing(900, { location: null })),
  cl("c-county", "private lenders sampleford", "Sampleford, CA", 6, bing(700, { location: "Sampleford County, CA" })) ] };
const HEAD = "| Search | Where | Type | Demand | Closest page today |";
const R1 = "| hard money loans in sampleville | Target: Sampleville, CA | local | 5,300 (estimate), US-wide, Bing impressions over 90 days | none |";
const R2 = "| bridge loans sampleton | Sampleton, CA | local | 1,200 (estimate) | none |";
const R3 = "| fix and flip lenders samplebury | Target: Samplebury, CA | local | 900 (estimate), place of this number not recorded, Bing impressions over 90 days | none |";
const R4 = "| private lenders sampleford | Target: Sampleford, CA | local | 700 (estimate), Sampleford County, CA, Bing impressions over 90 days | none |";
const tmp = mkTmp("demand-label"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
fs.mkdirSync(home);
const run = runner(dir, home, netLog);
const report = async () => {
  const cwd = path.join(tmp, "w0"), pewp = path.join(cwd, "site-checks", HOST, ".pewp"), sd = path.join(cwd, "site-checks", HOST, "snapshots", "2026-10-24");
  const pg = { measuredAt: "2026-10-24T10:00:00Z", vitals: { lcpMs: 1500, cls: 0.01, tbtMs: 100 }, totals: { bytes: 1024000, requests: 20 }, page: { canonical: "https://sample-valley-realty.test/", metaDescription: "d", h1Count: 1, structuredData: [{ ok: true, types: ["WebPage"] }], og: { "og:title": "t" }, robotsMeta: [] } };
  W(path.join(sd, "_site.json"), { finishedAt: "2026-10-24T10:00:00Z", runs: 1, stoppedEarly: null, machineLoad: null, pages: [{ url: SITE, slug: "home", status: 200 }] });
  W(path.join(sd, "site/robots.json"), { status: 200, groups: [{ agents: ["*"], rules: [] }] });
  W(path.join(sd, "site/sitemaps.json"), { urlCount: 3 });
  W(path.join(sd, "site/probes.json"), { notFound: { finalStatus: 404 } });
  W(path.join(sd, "pages", "home", "browser-mobile.json"), { url: SITE, ...pg });
  W(path.join(sd, "pages", "home", "response.json"), { headers: {} });
  W(path.join(pewp, "targets.json"), TG);
  const r = await run("report-live.mjs", [SITE, "--cwd", cwd, "--snapshot", sd], { env: { GSC_TOKEN_FILE: "", GSC_SERVICE_ACCOUNT_FILE: "", GSC_SERVICE_ACCOUNT_JSON_B64: "" } });
  const f = path.join(pewp, "report.md"), md = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "", jf = path.join(pewp, "report.json");
  const q2 = fs.existsSync(jf) ? (J(jf).questions || []).find((q) => q.n === 2) : null;
  return { code: r.code, md, head: md.split("\n").filter((l) => l.startsWith("| Search |")), rows: md.split("\n").filter((l) => /^\| (hard money loans|bridge loans|fix and flip|private lenders)/.test(l)), miss: q2?.missing || [] };
};
try {
  const X = await report(), d = JSON.stringify([X.code, X.head, X.rows]), by = (id) => X.miss.find((m) => m.id === id) || {};
  const ok = X.code === 0, same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check("case 1: a country-wide number for a cluster that targets a city: the row says the number's own place (US-wide) and what it counts (Bing impressions over 90 days), names the city only as Target, and never puts the city as the number's place; any other place text is printed as the fact holds it", ok && X.rows[0] === R1 && X.rows[3] === R4 && !/Sampleville/.test(X.rows[0].split(" | ")[3]), d);
  check("case 2: a number whose fact holds the same place as the cluster: today's row, the city in Where and the plain number", ok && X.rows[1] === R2, d);
  check("case 3: a fact with no place of its own: place of this number not recorded for the number, the city only as Target, never the city as the number's place", ok && X.rows[2] === R3 && !/Samplebury/.test(X.rows[2].split(" | ")[3]), d);
  check("case 4: report.json: each missing row keeps place (the target city) and carries volumeAbout with the number's own place and what it counts (null place when the fact has none)",
    ok && by("c-hard-money").place === "Sampleville, CA" && same(by("c-hard-money").volumeAbout, { place: "US", counts: "Bing impressions over 90 days" }) && by("c-bridge").volumeAbout?.place === "Sampleton, CA" && by("c-flip").volumeAbout?.place === null && by("c-flip").place === "Samplebury, CA", JSON.stringify(X.miss.map((m) => [m.id, m.place, m.volumeAbout])));
  check("case 5: nothing else changed: the header, the order (priority first), each number with its estimate mark, the intro sentence, and the numbers in report.json",
    ok && same(X.head, [HEAD]) && X.rows.length === 4 && X.rows[0].includes("5,300 (estimate)") && X.rows[1].includes("1,200 (estimate)") && X.rows[2].includes("900 (estimate)") && X.rows[3].includes("700 (estimate)") && X.md.includes("demand figures are estimates from the research; report.json gives each source") && same(X.miss.map((m) => m.volume?.value), [5300, 1200, 900, 700]), d);
} catch (e) {
  check("test harness ran to the end", false, e.stack || e);
}
rmTmp(tmp);

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
