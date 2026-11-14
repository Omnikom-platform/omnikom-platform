// Usage: node test-link-gap.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of authority.mjs (the link-gap list and its count before the cut) and of its readers report-live.mjs and research-assets.mjs on INVENTED data: the
// list is called "most competitors linked first"; authority.json holds linkGapTotal (the sites before the cut at 100); the report line, the plan impact and
// the assets line print it; an old file with exactly 100 entries and no total prints "at least 100 (list cut at 100)"; shorter lists print their length. No network.
// --mutants: watched-fail. Breaks one thing at a time in a copy of the skill and requires the named case to go red (green = the case
//   measures nothing, or the patch never applied; a `from` that occurs twice is refused). Exit 0 = all pass, exit 1 = a case failed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import zlib from "node:zlib";
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
    { id: "words-back", file: "report-live.mjs", from: "most competitors linked first: ${q4.gapTop", to: "strongest first: ${q4.gapTop", red: "case 1:" },
    { id: "total-ignored", file: "report-live.mjs", from: "const gapN = Number.isInteger(auth.linkGapTotal) ? auth.linkGapTotal : auth.linkGap.length;", to: "const gapN = auth.linkGap.length;", red: "case 5:" },
    { id: "old-cut-not-flagged", file: "report-live.mjs", from: " && auth.linkGap.length === GAP_CUT ? ", to: " && false ? ", red: "case 6:" },
    { id: "flagged-even-with-total", file: "report-live.mjs", from: "!Number.isInteger(auth.linkGapTotal) && auth.linkGap.length === GAP_CUT", to: "auth.linkGap.length === GAP_CUT", red: "case 8:" },
    { id: "plan-uses-list-length", file: "report-live.mjs", from: "fact(gapN, auth.source", to: "fact(auth.linkGap.length, auth.source", red: "case 5:" },
    { id: "line-prints-value", file: "report-live.mjs", from: "link gap\")}: ${q4.facts.linkGap.text} sites", to: "link gap\")}: ${q4.facts.linkGap.value} sites", red: "case 6:" },
    { id: "not-in-graph-line-prints-value", file: "report-live.mjs", from: "two or more competitors: ${q4.facts.linkGap.text}", to: "two or more competitors: ${q4.facts.linkGap.value}", red: "case 9:" },
    { id: "cut-size-mismatch", file: "report-live.mjs", from: "const GAP_CUT = 100;", to: "const GAP_CUT = 99;", red: "case 6:" },
    { id: "total-not-written", file: "authority.mjs", from: "linkGap: gap, linkGapTotal: gapFull.length,", to: "linkGap: gap,", red: "case 4:" },
    { id: "cut-moved", file: "authority.mjs", from: "const gap = gapFull.slice(0, 100);", to: "const gap = gapFull.slice(0, 120);", red: "case 3:" },
    { id: "order-by-strength-only", file: "authority.mjs", from: "b.linksToCompetitors - a.linksToCompetitors || ", to: "", red: "case 3:" },
    { id: "assets-total-ignored", file: "research-assets.mjs", from: "const gapN = Number.isInteger(auth?.linkGapTotal) ? auth.linkGapTotal : auth?.linkGap?.length || 0;", to: "const gapN = auth?.linkGap?.length || 0;", red: "case 10:" },
    { id: "assets-old-cut-not-flagged", file: "research-assets.mjs", from: " && gapN === GAP_CUT ? ", to: " && false ? ", red: "case 10:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "linkgap-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-link-gap.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
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

const SITE = "https://sample-valley-realty.test/", HOST = "sample-valley-realty.test", REL = "TEST-9";
const gz = (s) => zlib.gzipSync(Buffer.from(s));
const tmp = mkTmp("link-gap"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log"), cache = path.join(tmp, "cache");
fs.mkdirSync(home);
const run = runner(dir, home, netLog, ["PEWP_CC_BASE"]);
let n = 0;
const world = () => { const cwd = path.join(tmp, `w${n++}`); return { cwd, pewp: path.join(cwd, "site-checks", HOST, ".pewp") }; };
const IN = (domain, role, c, pos) => ({ domain, role, inGraph: true, hosts: 1, harmonicPos: pos, pageRankPos: pos, linkingDomains: c, strongestLinkingDomains: [{ domain: "l1.example", harmonicPos: 5 }] });
const OUT = (domain) => ({ domain, inGraph: false, note: "not in this Common Crawl release (too few links or not crawled)" });
const rows = (k) => Array.from({ length: k }, (_, i) => ({ domain: `gap${i + 1}.example`, linksToCompetitors: 2, harmonicPos: 100 + i }));
const doc = (results, linkGap, extra = {}) => ({ fetchedAt: "2026-10-23T08:00:00Z", source: "Common Crawl web graph cc-test (domain level)", release: "cc-test", target: HOST, results, linkGap, ...extra });
const RES = [IN(HOST, "target", 14, 900), IN("rival-a.example", "competitor", 120, 800)];
const report = async (authDoc) => {
  const w = world(), sd = path.join(w.cwd, "site-checks", HOST, "snapshots", "2026-10-24");
  W(path.join(w.pewp, "authority.json"), authDoc);
  const pg = { measuredAt: "2026-10-24T10:00:00Z", vitals: { lcpMs: 1500, cls: 0.01, tbtMs: 100 }, totals: { bytes: 1024000, requests: 20 }, page: { canonical: "https://sample-valley-realty.test/", metaDescription: "d", h1Count: 1, structuredData: [{ ok: true, types: ["WebPage"] }], og: { "og:title": "t" }, robotsMeta: [] } };
  W(path.join(sd, "_site.json"), { finishedAt: "2026-10-24T10:00:00Z", runs: 1, stoppedEarly: null, machineLoad: null, pages: [{ url: SITE, slug: "home", status: 200 }] });
  W(path.join(sd, "site/robots.json"), { status: 200, groups: [{ agents: ["*"], rules: [] }] });
  W(path.join(sd, "site/sitemaps.json"), { urlCount: 3 });
  W(path.join(sd, "site/probes.json"), { notFound: { finalStatus: 404 } });
  W(path.join(sd, "pages", "home", "browser-mobile.json"), { url: SITE, ...pg });
  W(path.join(sd, "pages", "home", "response.json"), { headers: {} });
  const r = await run("report-live.mjs", [SITE, "--cwd", w.cwd, "--snapshot", sd], { env: { GSC_TOKEN_FILE: "", GSC_SERVICE_ACCOUNT_FILE: "", GSC_SERVICE_ACCOUNT_JSON_B64: "" } });
  const f = path.join(w.pewp, "report.md"), md = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  const sec = (md.split(/^## 4\. /m)[1] || "").split(/^## \d\. /m)[0];
  const jf = path.join(w.pewp, "report.json"), js = fs.existsSync(jf) ? J(jf) : {};
  const impact = ((js.questions || []).find((x) => x.n === 6)?.plan || []).find((p) => p.kind === "links")?.impact;
  return { code: r.code, sec, impact, line: sec.split("\n").find((l) => /^- (link gap|sites that link)/.test(l)) || "" };
};
const assets = async (authDoc) => {
  const w = world(), f = path.join(w.pewp, "research", "assets.json");
  W(path.join(w.pewp, "authority.json"), authDoc);
  W(path.join(w.pewp, "business.json"), { domain: HOST, market: { country: "US", language: "en" } });
  const r = await run("research-assets.mjs", [SITE, "--cwd", w.cwd]);
  return { code: r.code, so: r.so, num: fs.existsSync(f) ? J(f).inputs?.linkGap : null };
};
const asked = async () => {
  const v = ["1\ttest.sample-valley-realty\t1", "2\ttest.rival-a\t1", "3\ttest.rival-b\t1", "4\ttest.rival-c\t1", "9\ttest.targetfan\t1"], e = ["9\t1"];
  const rk = ["#harmonicc_pos\tharmonicc_val\tpr_pos\tpr_val\thost_rev\tn_hosts", "5\t1.0\t6\t0.1\ttest.sample-valley-realty\t1"];
  for (let i = 10; i < 140; i++) { v.push(`${i}\ttest.gap${i}\t1`); e.push(`${i}\t2`, `${i}\t3`); }
  e.push("139\t4");
  fs.mkdirSync(cache, { recursive: true });
  for (const [k, t] of Object.entries({ vertices: v, edges: e, ranks: rk })) fs.writeFileSync(path.join(cache, `${REL}-domain-${k}.txt.gz`), gz(t.join("\n") + "\n"));
  const out = path.join(tmp, "auth.json");
  const x = await run("authority.mjs", [out, "--target", HOST, "--competitor", "rival-a.test", "--competitor", "rival-b.test", "--competitor", "rival-c.test", "--cache", cache, "--release", REL], { env: { PEWP_CC_BASE: "http://127.0.0.1:9" }, timeout: 240000 });
  return { x, doc: fs.existsSync(out) ? J(out) : { results: [], linkGap: [] } };
};
try {
  const R3 = await report(doc(RES, rows(3))), D = await asked();
  const R130 = await report(D.doc), R9 = await report({ ...doc(RES, rows(100)), results: [OUT(HOST), RES[1]] });
  const R100 = await report(doc(RES, rows(100))), R40 = await report(doc(RES, rows(40))), RT = await report(doc(RES, rows(100), { linkGapTotal: 100 }));
  const A130 = await assets(D.doc), A100 = await assets(doc(RES, rows(100))), A40 = await assets(doc(RES, rows(40)));
  const L = D.doc.linkGap || [], net = fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8").trim() : "";
  check("case 1: a list of 3 sites: the line says most competitors linked first, in the list's order, and the words strongest first are nowhere in section 4", R3.code === 0 && R3.line.startsWith("- link gap: 3 sites, most competitors linked first: gap1.example, gap2.example, gap3.example") && !/strongest first/.test(R3.sec), R3.line || R3.sec.slice(0, 300));
  check("case 2: a list of 3 sites: the number printed is 3 and the plan row's impact value is 3", R3.line.startsWith("- link gap: 3 sites,") && R3.impact?.value === 3, R3.line + JSON.stringify(R3.impact));
  check("case 3: authority.mjs on a graph with 130 sites linking to two or more competitors: exit 0, the list holds 100, the site linked by 3 competitors stands first, then the ones linked by 2; no request left the machine (net log empty)", D.x.code === 0 && L.length === 100 && L[0]?.domain === "gap139.test" && L[0].linksToCompetitors === 3 && L[1]?.linksToCompetitors === 2 && !net, `exit ${D.x.code} len ${L.length} first ${JSON.stringify(L[0])} net [${net}] | ${D.x.out.slice(-300)}`);
  check("case 4: authority.json writes linkGapTotal 130 (the sites before the cut) and the screen line says 130 domains", D.doc.linkGapTotal === 130 && /link gap: 130 domains/.test(D.x.so), JSON.stringify([D.doc.linkGapTotal, D.x.so.slice(-200)]));
  check("case 5: a report from that file: the line says 130 sites with the words, and the plan row's impact is value 130, text 130", R130.line.startsWith("- link gap: 130 sites, most competitors linked first: gap139.test") && R130.impact?.value === 130 && R130.impact?.text === "130", R130.line + JSON.stringify(R130.impact));
  check("case 6: an old-shape file with exactly 100 entries and no total: at least 100 (list cut at 100), in the line and in the impact text, the value stays 100", R100.line.startsWith("- link gap: at least 100 (list cut at 100) sites, most competitors linked first: gap1.example") && R100.impact?.value === 100 && R100.impact?.text === "at least 100 (list cut at 100)", R100.line + JSON.stringify(R100.impact));
  check("case 7: an old-shape file with 40 entries: 40 sites, no at least", R40.line.startsWith("- link gap: 40 sites,") && !/at least/.test(R40.line) && R40.impact?.value === 40, R40.line + JSON.stringify(R40.impact));
  check("case 8: a file with the total 100 and exactly 100 entries: 100 sites, a true count, no at least", RT.line.startsWith("- link gap: 100 sites,") && !/at least/.test(RT.line) && RT.impact?.value === 100, RT.line + JSON.stringify(RT.impact));
  check("case 9: the target not in the graph, an old-shape file with exactly 100 entries: the other line says at least 100 (list cut at 100) with the words, and the plan row's impact text says so, value 100", R9.line.startsWith("- sites that link to two or more competitors: at least 100 (list cut at 100), most competitors linked first: gap1.example") && R9.impact?.value === 100 && R9.impact?.text === "at least 100 (list cut at 100)", R9.line + JSON.stringify(R9.impact));
  check("case 10: research-assets.mjs prints the true total 130 (inputs.linkGap 130), at least 100 (list cut at 100) for an old file with exactly 100 (inputs.linkGap 100), and 40 for 40", A130.code === 0 && A130.so.includes(", 130 link-gap sites ->") && A130.num === 130 && A100.so.includes(", at least 100 (list cut at 100) link-gap sites ->") && A100.num === 100 && A40.so.includes(", 40 link-gap sites ->") && A40.num === 40, [A130, A100, A40].map((a) => a.so.slice(0, 160) + a.num).join(" | "));
} catch (e) {
  check("test harness ran to the end", false, e.stack || e);
}
rmTmp(tmp);

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
