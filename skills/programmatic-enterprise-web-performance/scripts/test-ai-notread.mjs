// Usage: node test-ai-notread.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of import-ai.mjs and of its reader report-live.mjs on INVENTED captures: an AI engine from which no answer was read is named only in the
// "Not read" line, never as "named in 0 of 0 answers"; with no answer read at all the block is "No AI answer was read" and the Not read line and
// concludes nothing from answers; a real zero still prints; with answers read every line is as before. No network (netguard-import.mjs), no browser.
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
    { id: "blocked-engine-line-back", file: "report-live.mjs", from: ".filter((x) => x.questions > 0)) L.push(", to: ".filter((x) => x)) L.push(", red: "case 1:" },
    { id: "filter-cuts-answered-zero-named-engine", file: "report-live.mjs", from: ".filter((x) => x.questions > 0)) L.push(", to: ".filter((x) => x.named > 0)) L.push(", red: "case 4:" },
    { id: "first-line-guard-out", file: "report-live.mjs", from: "y.questions > 0 ? ", to: "true ? ", red: "case 2:" },
    { id: "first-line-says-zero-of-zero", file: "report-live.mjs", from: '"- No AI answer was read"', to: '"- 0 of 0 answers name the business (0%)"', red: "case 2:" },
    { id: "not-read-line-dropped", file: "report-live.mjs", from: "if ((y.blockedEngines || []).length) L.push(", to: "if (false) L.push(", red: "case 1:" },
    { id: "first-line-text-changed", file: "report-live.mjs", from: "answers name the business (", to: "answers named the business (", red: "case 1:" },
    { id: "no-answer-block-still-concludes", file: "report-live.mjs", from: "if (!(y.questions > 0)) return L;", to: "if (false) return L;", red: "case 2:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ainotread-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-ai-notread.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
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
const cap = (o) => ({ capturedAt: ago(1), browser: "owner's Edge", ...o });
const ans = (engine, type, question, named, o = {}) => cap({ engine, type, question, answerText: "Invented answer text for " + question, named, competitorsNamed: [], citedSources: [], ...o });
const FA = {
  "chatgpt-1.json": ans("chatgpt", "buyer", "who lends on rental homes in Sampleville", true),
  "chatgpt-2.json": ans("chatgpt", "brand", "Who is Sample Valley Realty in Sampleville?", false),
  "perplexity-1.json": ans("perplexity", "buyer", "best bridge loan lender in Sampleville", true),
  "copilot.json": cap({ engine: "copilot", blocked: "sign-in wall" }) };
const FB = {
  "chatgpt-blocked.json": cap({ engine: "chatgpt", blocked: "sign-in wall" }),
  "copilot-blocked.json": cap({ engine: "copilot", blocked: "sign-in wall" }),
  "gemini-blocked.json": cap({ engine: "gemini", blocked: "robot check" }) };
const FC = {
  "chatgpt-1.json": ans("chatgpt", "buyer", "who lends on rental homes in Sampleville", true, { competitorsNamed: ["Alpha Lending"], citedSources: ["https://www.alpha-lending.test/a"] }),
  "chatgpt-2.json": ans("chatgpt", "brand", "Who is Sample Valley Realty in Sampleville?", false),
  "perplexity-1.json": ans("perplexity", "buyer", "best bridge loan lender in Sampleville", true, { competitorsNamed: ["Alpha Lending"] }),
  "copilot-1.json": ans("copilot", "buyer", "who funds fix and flip loans in Sampleville", false),
  "gemini-1.json": ans("gemini", "buyer", "top hard money lenders near Sampleville", true, { signedIn: true }) };
const OWN = "- The business's own domain is not among the sources the answers cite";
const LA = ["- 2 of 3 answers name the business (67%)", "- chatgpt: named in 1 of 2 answers (50%)", "- perplexity: named in 1 of 1 answers (100%)", "- Not read: copilot (sign-in wall)", OWN];
const LB = ["- No AI answer was read", "- Not read: chatgpt (sign-in wall), copilot (sign-in wall), gemini (robot check)"];
const LC = ["- 3 of 5 answers name the business (60%)", "- chatgpt: named in 1 of 2 answers (50%)", "- perplexity: named in 1 of 1 answers (100%)", "- copilot: named in 0 of 1 answers (0%)", "- gemini: named in 1 of 1 answers (100%)", "- Named most often instead: Alpha Lending (2)", OWN];
const tmp = mkTmp("ai-notread"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
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
  const sec = (md.split("### AI answers")[1] || "").split("\n### ")[0];
  return { code: r.code, sec, lines: sec.split("\n").filter((l) => l.startsWith("- ")) };
};
const imp = async (files) => {
  const w = world();
  for (const [f, b] of Object.entries(files)) W(path.join(w.pewp, "captures", "ai", f), b);
  const ri = await run("import-ai.mjs", [SITE, "--cwd", w.cwd]), of = path.join(w.pewp, "research", "ai-answers.json");
  const sum = ri.code === 0 && fs.existsSync(of) ? J(of).summary : {};
  return { ri, sum, rp: await report(w) };
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
try {
  const A = await imp(FA), B = await imp(FB), C = await imp(FC);
  const ok = (x) => x.ri.code === 0 && x.rp.code === 0, d = (x) => `import exit ${x.ri.code}, report exit ${x.rp.code} | ${JSON.stringify(x.rp.lines)}`;
  check("case 1: two engines answered and one only blocked: the blocked engine has no named in 0 of 0 line and is named in Not read with its reason; the other lines are as before", ok(A) && same(A.rp.lines, LA) && !A.rp.lines.some((l) => /of 0 answers|^- copilot:/.test(l)), d(A));
  check("case 2: every capture blocked: the block is exactly the line No AI answer was read and the Not read line naming each engine with its reason, no line holds 0 of 0 or (0%), and nothing is said of what the answers hold", ok(B) && same(B.rp.lines, LB) && !B.rp.lines.some((l) => /0 of 0|\(0%\)/.test(l)), d(B));
  check("case 3: every engine answered: the block is byte for byte today's text", ok(C) && same(C.rp.lines, LC), d(C));
  check("case 4: an engine answered and never naming the business still says so: named in 0 of 1 answers (0%), a real zero", ok(C) && C.rp.lines.some((l) => /^- copilot: named in 0 of [1-9]\d* answers \(0%\)$/.test(l)), d(C));
  check("case 5: the summary is unchanged: the blocked engine stays an engine entry with questions 0 and status blocked, blockedEngines names it, the totals count answers only",
    ok(A) && same(A.sum.engines?.find((e) => e.engine === "copilot"), { engine: "copilot", status: "blocked", questions: 0, named: 0, shareNamed: null }) && same(A.sum.blockedEngines, [{ engine: "copilot", reason: "sign-in wall" }]) && A.sum.engines.length === 3 && A.sum.questions === 3 && A.sum.namedAnswers === 2, JSON.stringify(A.sum).slice(0, 300));
} catch (e) {
  check("test harness ran to the end", false, e.stack || e);
}
rmTmp(tmp);

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
