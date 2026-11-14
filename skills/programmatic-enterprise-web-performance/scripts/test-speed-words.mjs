// Usage: node test-speed-words.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of report-live.mjs on an INVENTED snapshot (one page, a busy-computer lab run or a quiet one, with or without a PageSpeed Insights file):
// the "lab speed not trusted" fact is a printed note and not one of the counted problems; a page with an untrusted lab run says its PageSpeed
// Insights load time (named so) or nothing, never the lab number; a trusted page and its count are as before; the winners sentence claims no reason.
// --mutants: watched-fail. Breaks one thing at a time in a copy of the skill and requires the named case to go red (green = the case
//   measures nothing, or the patch never applied; a `from` that occurs twice is refused). Exit 0 = all pass, exit 1 = a case failed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { runner, W, J, mkTmp, rmTmp } from "./lib-test-kit.mjs";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : here);
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const MUT = [
    { id: "busy-computer-counted-again", file: "report-live.mjs", from: "  // the busy computer is a note (speedTrustLines, labSpeedTrust), never one of the counted problems of the site", to: "  problemsQ1.push(`the phone speed measured here is not trusted (this computer was busy)`);", red: "case 1:" },
    { id: "note-dropped", file: "report-live.mjs", from: "if (labUntrusted) speedTrustLines.push(", to: "if (false) speedTrustLines.push(", red: "case 1:" },
    { id: "lab-figure-back", file: "report-live.mjs", from: "const lcp = untrusted ? pr?.lcpMs : pb?.b?.vitals?.lcpMs;", to: "const lcp = pb?.b?.vitals?.lcpMs;", red: "case 2:" },
    { id: "psi-desktop-row", file: "report-live.mjs", from: 'x.strategy === "mobile" && x.lcpMs != null', to: 'x.strategy === "desktop" && x.lcpMs != null', red: "case 2:" },
    { id: "psi-label-dropped", file: "report-live.mjs", from: "{ psi: true }", to: "{}", red: "case 2:" },
    { id: "psi-source-wrong", file: "report-live.mjs", from: "in PageSpeed Insights (Google's servers), phone", to: "in real Chrome, phone, slow 4G", red: "case 2:" },
    { id: "no-psi-prints-lab", file: "report-live.mjs", from: "untrusted ? pr?.lcpMs :", to: "untrusted ? (pr?.lcpMs ?? pb?.b?.vitals?.lcpMs) :", red: "case 3:" },
    { id: "trusted-lab-dropped", file: "report-live.mjs", from: " : pb?.b?.vitals?.lcpMs;", to: " : null;", red: "case 4:" },
    { id: "winners-old-sentence", file: "report-live.mjs", from: "were not measured; only ours are.", to: "are not measured (no free source); only ours are.", red: "case 5:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "speedwords-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-speed-words.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
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

const SITE = "https://sample-valley-realty.test/", HOST = "sample-valley-realty.test", PAGE = SITE + "faq";
const tmp = mkTmp("speed-words"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
fs.mkdirSync(home);
const run = runner(dir, home, netLog);
let n = 0;
const BUSY = "UNTRUSTED: machine busy (cpu avg 62%)", LOAD = { cpuPctAvg: 62.5, cpuPctMax: 91, samples: 20, thresholdPct: 35 };
const HTML = "<html><head><title>Sample FAQ help</title></head><body><h1>Sample FAQ help</h1><p>Invented words about sample faq help in Sampleville.</p></body></html>";
const ROW0 = '- /faq/ for "sample faq help": required entities not judged (no capture of this search); questions not shown as headings: 0 of 0';
const NOTE = "The speed and page weight of the winning sites were not measured; only ours are.";
const world = async ({ trust, lcp, psiLcp, urlCount }) => {
  const cwd = path.join(tmp, `w${n++}`), base = path.join(cwd, "site-checks", HOST), sd = path.join(base, "snapshots", "2026-10-24"), pewp = path.join(base, ".pewp");
  const pg = { measuredAt: "2026-10-24T10:00:00Z", vitals: { lcpMs: lcp, cls: 0.01, tbtMs: 100 }, totals: { bytes: 1024000, requests: 20 }, page: { canonical: PAGE, metaDescription: "d", h1Count: 1, structuredData: [{ ok: true, types: ["WebPage"] }], og: { "og:title": "t" }, robotsMeta: [] } };
  W(path.join(sd, "_site.json"), { finishedAt: "2026-10-24T10:00:00Z", runs: 1, stoppedEarly: null, machineLoad: trust === "trusted" ? null : LOAD, pages: [{ url: PAGE, slug: "faq", status: 200, speedTrust: trust }] });
  W(path.join(sd, "site/robots.json"), { status: 200, groups: [{ agents: ["*"], rules: [] }] });
  W(path.join(sd, "site/sitemaps.json"), { urlCount });
  W(path.join(sd, "site/probes.json"), { notFound: { finalStatus: 404 } });
  W(path.join(sd, "pages", "faq", "browser-mobile.json"), { url: PAGE, ...pg });
  W(path.join(sd, "pages", "faq", "response.json"), { url: PAGE, finalUrl: PAGE, status: 200, headers: {} });
  fs.writeFileSync(path.join(sd, "pages", "faq", "raw.html.gz"), zlib.gzipSync(HTML));
  W(path.join(pewp, "targets.json"), { createdAt: "2026-10-20T10:00:00Z", clusters: [{ id: "c-faq", primaryQuery: "sample faq help", queries: ["sample faq help"], intent: "informational", location: null, winningFormat: "city page", competitorsTop3: [], requiredEntities: [], questions: [], targetPage: "/faq/", priority: 5 }] });
  if (psiLcp != null) W(path.join(pewp, "psi", "2026-10-25.json"), { pages: [
    { url: PAGE, strategy: "mobile", performance: 94, lcpMs: psiLcp, cls: 0.01, tbtMs: 120, fetchedAt: "2026-10-25T20:00:00Z" },
    { url: PAGE, strategy: "desktop", performance: 99, lcpMs: 900, cls: 0, tbtMs: 10, fetchedAt: "2026-10-25T20:00:00Z" }] });
  const r = await run("report-live.mjs", [SITE, "--cwd", cwd, "--snapshot", sd], { env: { GSC_TOKEN_FILE: "", GSC_SERVICE_ACCOUNT_FILE: "", GSC_SERVICE_ACCOUNT_JSON_B64: "" } });
  const f = path.join(pewp, "report.md"), md = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  const jf = path.join(pewp, "report.json"), json = fs.existsSync(jf) ? J(jf) : null;
  return { code: r.code, md, json, problems: json?.questions?.[0]?.problems || [], lcpFact: json?.questions?.[2]?.clusterRows?.[0]?.lcpMs ?? null, row: md.split("\n").find((l) => l.startsWith('- /faq/ for "sample faq help"')) || "" };
};
const d = (x) => `exit ${x.code} | problems ${JSON.stringify(x.problems)} | row ${JSON.stringify(x.row)}`;
try {
  const U0 = await world({ trust: BUSY, lcp: 7700, psiLcp: null, urlCount: 0 });
  const U1 = await world({ trust: BUSY, lcp: 7700, psiLcp: 2800, urlCount: 3 });
  const T0 = await world({ trust: "trusted", lcp: 2100, psiLcp: 2800, urlCount: 0 });
  check("case 1: a busy-computer lab run and one real site problem: the count is 1 (short answer, Mostly yes line, questions[0].problems), the problem is the sitemap, the UNTRUSTED note is still printed and is not a listed problem",
    U0.code === 0 && U0.problems.length === 1 && /no sitemap file/.test(U0.problems[0]) && U0.md.includes("1 thing holds it back") && U0.md.includes("Mostly yes, with 1 problem:") && /Lab speed UNTRUSTED\*\* on 1 page/.test(U0.md) && !/measured here is not trusted/.test(U0.md), d(U0));
  check("case 2: an untrusted lab run with a PageSpeed Insights figure: the page's row says the PSI seconds and (PageSpeed Insights) and never the lab seconds",
    U1.code === 0 && U1.row === ROW0 + "; loads in 2.8 s on a phone (PageSpeed Insights)" && !U1.row.includes("7.7") && U1.lcpFact?.value === 2800 && /PageSpeed Insights/.test(U1.lcpFact.source), d(U1));
  check("case 3: an untrusted lab run with no PageSpeed Insights figure: the page's row has no load clause at all",
    U0.code === 0 && U0.row === ROW0 && !U0.row.includes("7.7") && !U0.row.includes("loads in") && U0.lcpFact === null, d(U0));
  check("case 4: a trusted lab run: the row and the count are exactly today's (loads in 2.1 s on a phone, no PSI words; 1 problem, the sitemap; no UNTRUSTED anywhere)",
    T0.code === 0 && T0.row === ROW0 + "; loads in 2.1 s on a phone" && T0.lcpFact?.value === 2100 && /real Chrome/.test(T0.lcpFact.source) && T0.problems.length === 1 && /no sitemap file/.test(T0.problems[0]) && T0.md.includes("1 thing holds it back") && !/UNTRUSTED/.test(T0.md), d(T0));
  check("case 5: the winners sentence is the new text and no longer claims no free source", U0.code === 0 && U0.md.includes(NOTE) && !/no free source/.test(U0.md), U0.md.slice(-400));
  check("case 6: untrusted lab run with PSI: the real PSI slow-phone problem is the only one counted, and report.json still carries the labSpeedTrust fact as not trusted",
    U1.code === 0 && U1.problems.length === 1 && /slow on phones according to PageSpeed Insights/.test(U1.problems[0]) && U1.json?.questions?.[0]?.facts?.labSpeedTrust?.value?.trusted === false && /Lab speed UNTRUSTED/.test(U1.md), d(U1));
} catch (e) {
  check("test harness ran to the end", false, e.stack || e);
}
rmTmp(tmp);

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
