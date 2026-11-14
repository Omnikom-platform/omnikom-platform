// Usage: node test-no-capture.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of report-live.mjs question 3 on INVENTED targets.json files: a search with no results-page capture is counted apart from a capture
// that holds no page addresses, each sentence said only when its count is above 0; a row whose search nothing was read for says its required
// entities were not judged, never that all are present; a judged row keeps today's words. No network, no browser.
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
    { id: "nocapture-counted-as-noaddresses", file: "report-live.mjs", from: "&& !captured.includes(c)).length", to: ").length", red: "case 2:" },
    { id: "noaddresses-counts-uncaptured", file: "report-live.mjs", from: "&& captured.includes(c)).length", to: "&& !captured.includes(c)).length", red: "case 1:" },
    { id: "zero-sentence-printed", file: "report-live.mjs", from: "[uk.notCaptured ? ", to: "[true ? ", red: "case 3:" },
    { id: "singular-lost", file: "report-live.mjs", from: "search${uk.notCaptured === 1 ? \" has\" : \"es have\"}", to: "search${\"es have\"}", red: "case 8:" },
    { id: "uncaptured-row-says-all-present", file: "report-live.mjs", from: ": \"required entities not judged (no capture of this search)\")", to: ": \"all required entities present\")", red: "case 4:" },
    { id: "captured-flag-always-true", file: "report-live.mjs", from: "captured: !!(c.serpFeatures && !/NOT CAPTURED/i.test(c.serpFeatures.source || \"\"))", to: "captured: true", red: "case 4:" },
    { id: "empty-list-guard-out", file: "report-live.mjs", from: "${!r.requiredCount ? (", to: "${false ? (", red: "case 4:" },
    { id: "judged-row-text-changed", file: "report-live.mjs", from: ": \"all required entities present\"}", to: ": \"no required entity is missing\"}", red: "case 5:" },
    { id: "missing-branch-dropped", file: "report-live.mjs", from: ": r.entitiesMissing.value.length ? ", to: ": false ? ", red: "case 6:" },
    { id: "other-said-with-no-format", file: "report-live.mjs", from: "oth = fm.length ? \"other \" : \"\"", to: "oth = \"other \"", red: "case 9:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nocapture-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-no-capture.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
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

import zlib from "node:zlib";
const SITE = "https://sample-valley-realty.test/", HOST = "sample-valley-realty.test", AT = "2026-10-24T10:00:00.000Z";
const HTML = "<html lang=\"en\"><head><title>Bridge loans in Sampleville</title></head><body><main><h1>Bridge loans in Sampleville</h1><p>Sample Valley Realty arranges bridge loans for investors across Sampleville. Our team knows the title office and the county recorder.</p></main></body></html>";
const sf = (cap) => ({ value: cap ? ["paa"] : [], source: cap ? "invented results page captured in the browser" : "NOT CAPTURED: no browser capture of this query yet (invented)", fetchedAt: AT, cacheFile: null });
const FMT = { none: "unknown (no capture yet)", noaddr: "unknown (the capture holds no page addresses)" };
const cl = (id, q, kind, ents = []) => ({ id, primaryQuery: q, queries: [q], intent: "commercial", location: null, volume: { value: 100, source: "invented", fetchedAt: AT, cacheFile: null }, difficulty: null, value: null, serpFeatures: sf(kind !== "none"), winningFormat: FMT[kind] || kind, winningPageType: "page", requiredTerms: [], competitorsTop3: [], requiredEntities: ents, questions: [], targetPage: "/", priority: 5 });
const Q = { c1: "bridge loans sampleville", c2: "rental loan rates sampleville", c3: "fix and flip lender sampleville", c4: "hard money terms sampleville", c5: "land loans sampleville" };
const tmp = mkTmp("no-capture"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
fs.mkdirSync(home);
const run = runner(dir, home, netLog);
let n = 0;
const rep = async (clusters, comp) => {
  const cwd = path.join(tmp, `w${n++}`), pewp = path.join(cwd, "site-checks", HOST, ".pewp"), sd = path.join(cwd, "site-checks", HOST, "snapshots", "2026-10-24");
  const pg = { measuredAt: "2026-10-24T10:00:00Z", vitals: { lcpMs: 1500, cls: 0.01, tbtMs: 100 }, totals: { bytes: 1024000, requests: 20 }, page: { canonical: "https://sample-valley-realty.test/", metaDescription: "d", h1Count: 1, structuredData: [{ ok: true, types: ["WebPage"] }], og: { "og:title": "t" }, robotsMeta: [] } };
  W(path.join(sd, "_site.json"), { finishedAt: "2026-10-24T10:00:00Z", runs: 1, stoppedEarly: null, machineLoad: null, pages: [{ url: SITE, slug: "home", status: 200 }] });
  W(path.join(sd, "site/robots.json"), { status: 200, groups: [{ agents: ["*"], rules: [] }] });
  W(path.join(sd, "site/sitemaps.json"), { urlCount: 3 });
  W(path.join(sd, "site/probes.json"), { notFound: { finalStatus: 404 } });
  W(path.join(sd, "pages", "home", "browser-mobile.json"), { url: SITE, ...pg });
  W(path.join(sd, "pages", "home", "response.json"), { url: SITE, finalUrl: SITE, status: 200, headers: {} });
  fs.writeFileSync(path.join(sd, "pages", "home", "raw.html.gz"), zlib.gzipSync(HTML));
  W(path.join(pewp, "targets.json"), { createdAt: AT, clusters });
  if (comp) W(path.join(pewp, "research", "competitors.json"), comp);
  const r = await run("report-live.mjs", [SITE, "--cwd", cwd, "--snapshot", sd], { env: { GSC_TOKEN_FILE: "", GSC_SERVICE_ACCOUNT_FILE: "", GSC_SERVICE_ACCOUNT_JSON_B64: "" } });
  const f = path.join(pewp, "report.md"), md = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  const sec = (md.split("## 3. Is each page better than what ranks now?")[1] || "").split("\n## ")[0];
  const lines = sec.split("\n").filter((l) => l.startsWith("- "));
  return { code: r.code, err: String(r.stderr || "").slice(0, 200), lines, fmt: lines.find((l) => l.startsWith("- What wins the results pages we could read:") || l.startsWith("- The format of the winning pages")) || "", row: (q) => lines.find((l) => l.includes(`for "${q}"`)) || "" };
};
const ok = (x) => x.code === 0 && x.fmt !== "", d = (x) => `exit ${x.code} ${x.err} | ${x.fmt} | ${x.lines.length} lines`;
const COMP = { generatedAt: AT, sites: [{ domain: "rival-lender.test", status: 200, fetchedAt: AT, page: { words: 900, h2: ["Rates"] }, schema: { types: [], questions: 0 } }] };
const WORDS = (k) => `${k} other searches have no results-page capture yet, so their format is unknown`;
try {
  const WA = await rep([cl("c1", Q.c1, "guide"), cl("c2", Q.c2, "tool"), cl("c3", Q.c3, "none"), cl("c4", Q.c4, "none"), cl("c5", Q.c5, "none")]);
  const WB = await rep([cl("c1", Q.c1, "guide"), cl("c2", Q.c2, "noaddr")]);
  const WC = await rep([cl("c1", Q.c1, "guide"), cl("c2", Q.c2, "tool")]);
  const WD = await rep([cl("c1", Q.c1, "guide", ["Sampleville", "title office"]), cl("c2", Q.c2, "guide", ["Sampleville", "county assessor"]), cl("c3", Q.c3, "none"), cl("c4", Q.c4, "tool", [])]);
  const WE = await rep([cl("c1", Q.c1, "none"), cl("c2", Q.c2, "none")], COMP);
  check("case 1: two searches captured with formats and three never captured: the sentence names 3 other searches with no results-page capture and does not say any capture holds no page addresses", ok(WA) && WA.fmt.includes(WORDS(3)) && !/no page addresses/.test(WA.fmt) && WA.fmt.includes("guide (1 search), tool (1 search)"), d(WA));
  check("case 2: one search captured with a format and one whose capture holds no page addresses: the sentence says 1 capture holds no page addresses and does not say a search has no results-page capture", ok(WB) && WB.fmt.includes("1 capture holds no page addresses") && !/no results-page capture/.test(WB.fmt), d(WB));
  check("case 3: every search captured with a format: the line is exactly the formats and neither sentence is said", ok(WC) && WC.fmt === "- What wins the results pages we could read: guide (1 search), tool (1 search).", d(WC));
  check("case 4: a row for a never-captured search says required entities not judged (no capture of this search) and never all required entities present", ok(WD) && WD.row(Q.c3).includes("required entities not judged (no capture of this search)") && !/all required entities present/.test(WD.row(Q.c3)), WD.row(Q.c3) || d(WD));
  check("case 5: a row for a captured search with two required entities both present still says all required entities present", ok(WD) && WD.row(Q.c1).includes(": all required entities present;") && !/not judged/.test(WD.row(Q.c1)), WD.row(Q.c1) || d(WD));
  check("case 6: a row with one required entity missing still names it, and does not say all present", ok(WD) && /missing .*county assessor/.test(WD.row(Q.c2)) && !/all required entities present|not judged/.test(WD.row(Q.c2)), WD.row(Q.c2) || d(WD));
  check("case 7: a row for a captured search whose list of required entities is empty says no required entities listed for this search, never all present", ok(WD) && WD.row(Q.c4).includes("no required entities listed for this search") && !/all required entities present|not judged/.test(WD.row(Q.c4)), WD.row(Q.c4) || d(WD));
  check("case 8: exactly one never-captured search is said in the singular: 1 other search has no results-page capture yet", ok(WD) && WD.fmt.includes("1 other search has no results-page capture yet, so their format is unknown") && !/no page addresses/.test(WD.fmt), d(WD));
  check("case 9: no search has a known format (a winner site was audited): the line says the format could not be read and that 2 searches have no results-page capture yet, without the word other", ok(WE) && WE.fmt === "- The format of the winning pages could not be read: 2 searches have no results-page capture yet, so their format is unknown.", d(WE));
} catch (e) {
  check("test harness ran to the end", false, e.stack || e);
}
rmTmp(tmp);

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
