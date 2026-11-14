// Usage: node test-ai-capture-form.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of research-ai.mjs importOwner (and its caller run) and of the report's AI citations question on INVENTED captures in the form of import-ai.mjs:
// citedSources are the sources, answerText is searched for the business's name, a blocked capture is no run and its engine is named as not read;
// the older forms (sources, citedDomains, answer) give what they always gave. No network (no Gemini call: run without --gemini), no browser.
// --mutants: watched-fail. Breaks one thing at a time in a copy of the skill and requires the named case to go red (green = the case
//   measures nothing, or the patch never applied; a `from` that occurs twice is refused). Exit 0 = all pass, exit 1 = a case failed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runner, W, J, mkTmp, rmTmp } from "./lib-test-kit.mjs";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : here);
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const MUT = [
    { id: "cited-sources-form-dropped", file: "research-ai.mjs", from: '["citedDomains", "sources", "citedSources"]', to: '["citedDomains", "sources"]', red: "case 1:" },
    { id: "answertext-not-read", file: "research-ai.mjs", from: 'c.answer || c.answerText || ""', to: 'c.answer || ""', red: "case 2:" },
    { id: "blocked-counted-as-run", file: "research-ai.mjs", from: 'typeof c.blocked === "string" && c.blocked.trim() && c.engine', to: "false", red: "case 4:" },
    { id: "blocked-engine-with-answer-listed", file: "research-ai.mjs", from: "!answered.has(b.engine) && ", to: "", red: "case 5:" },
    { id: "blocked-list-not-written", file: "research-ai.mjs", from: "rejected: owner.rejected, blocked: owner.blocked }", to: "rejected: owner.rejected }", red: "case 8:" },
    { id: "report-not-naming-not-read", file: "report-live.mjs", from: "(aiR?.owner?.blocked || [])", to: "[]", red: "case 7:" },
    { id: "older-form-sources-broken", file: "research-ai.mjs", from: '["citedDomains", "sources", "citedSources"]', to: '["citedDomains", "citedSources"]', red: "case 3:" },
    { id: "older-form-order-broken", file: "research-ai.mjs", from: '["citedDomains", "sources", "citedSources"]', to: '["citedSources", "citedDomains", "sources"]', red: "case 3:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aicapform-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-ai-capture-form.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
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
const FD = { // import-ai.mjs's form
  "chatgpt-1.json": ans("chatgpt", "buyer", "who lends on rental homes in Sampleville", true, { answerText: "Sample Valley Realty is one option for rental loans in Sampleville.", citedSources: ["https://www.sample-valley-realty.test/rentals", "https://www.alpha-lending.test/a", "https://beta-loans.test/b"] }),
  "perplexity-1.json": ans("perplexity", "buyer", "best bridge loan lender in Sampleville", false, { answerText: "Alpha Lending leads the list for bridge loans.", citedSources: ["https://www.alpha-lending.test/b"] }) };
const FE = { // the older forms; perplexity holds all three lists and both answer fields: the first list and `answer` win
  "chatgpt-1.json": { engine: "chatgpt", question: "fix and flip lender in Sampleville", capturedAt: ago(1), citedDomains: ["epsilon-credit.test", HOST], answer: "Epsilon Credit and Sample Valley Realty both lend." },
  "copilot-1.json": { engine: "copilot", question: "rental loan help near Sampleville", capturedAt: ago(1), answer: "No business is named here.", sources: [{ url: "https://sample-valley-realty.test/about" }, { domain: "delta-capital.test" }] },
  "gemini-1.json": { engine: "gemini", question: "cheap rental loan lender in Sampleville", capturedAt: ago(1), answer: "Sample Valley Realty is mentioned.", sources: ["https://www.alpha-lending.test/c", "gamma-funds.test"] },
  "perplexity-1.json": { engine: "perplexity", question: "hard money lender list for Sampleville", capturedAt: ago(1), answer: "Zeta News lists many lenders.", answerText: "Sample Valley Realty is listed.", citedDomains: ["zeta-news.test"], sources: ["https://ignored.test/x"], citedSources: ["https://also-ignored.test/y"] } };
const EXP_E = { chatgpt: { runs: 1, citedSources: ["epsilon-credit.test", HOST], cites: true, share: 1, name: 1 }, copilot: { runs: 1, citedSources: [HOST, "delta-capital.test"], cites: true, share: 1, name: 0 },
  gemini: { runs: 1, citedSources: ["alpha-lending.test", "gamma-funds.test"], cites: false, share: 0, name: 1 }, perplexity: { runs: 1, citedSources: ["zeta-news.test"], cites: false, share: 0, name: 0 } };
const FF = { // sorted: chatgpt answered + blocked, copilot blocked twice (no question), gemini blocked WITH a question, perplexity answered
  "chatgpt-1.json": ans("chatgpt", "buyer", "who lends on rental homes in Sampleville", true, { answerText: "Sample Valley Realty is one option for rental loans in Sampleville.", citedSources: ["https://www.sample-valley-realty.test/a"] }),
  "chatgpt-blocked.json": cap({ engine: "chatgpt", blocked: "sign-in wall" }), "copilot-blocked-1.json": cap({ engine: "copilot", blocked: "sign-in wall" }),
  "copilot-blocked-2.json": cap({ engine: "copilot", blocked: "sign-in wall" }), "gemini-blocked.json": cap({ engine: "gemini", question: "top hard money lenders near Sampleville", blocked: "robot check" }),
  "perplexity-1.json": ans("perplexity", "buyer", "best bridge loan lender in Sampleville", false, { answerText: "Alpha Lending leads the list for bridge loans.", citedSources: ["https://www.alpha-lending.test/b"] }) };
const FG = { "chatgpt-noq.json": cap({ engine: "chatgpt", answerText: "Invented text", citedSources: ["https://www.alpha-lending.test/a"] }), "orphan-blocked.json": cap({ blocked: "sign-in wall" }) };
const AI = await import(pathToFileURL(path.join(dir, "research-ai.mjs")).href);
const tmp = mkTmp("ai-capform"), home = path.join(tmp, "home"), netLog = path.join(tmp, "net.log");
fs.mkdirSync(home);
const run = runner(dir, home, netLog);
let n = 0;
const world = () => { const cwd = path.join(tmp, `w${n++}`); return { cwd, pewp: path.join(cwd, "site-checks", HOST, ".pewp") }; };
const ctxOf = (w) => ({ business: { name: "Sample Valley Realty", domain: HOST }, market: { country: "US", language: "en" }, pewp: w.pewp, rdir: path.join(w.pewp, "research") });
const put = (w, files) => { for (const [f, b] of Object.entries(files)) W(path.join(w.pewp, "captures", "ai", f), b); return path.join(w.pewp, "captures", "ai"); };
const imp = (files) => { const w = world(); return AI.importOwner(ctxOf(w), put(w, files)); };
const view = (r) => r && { runs: r.runs, citedSources: r.citedSources, cites: r.ourDomainCited, share: r.citedShare.value };
const nameOf = (r) => r?.ourNameMentionedShare?.value, full = (r) => r && { ...view(r), name: nameOf(r) }, byEng = (o, e) => o.rows.find((r) => r.engine === e);
const bl = (o) => (o.blocked || []).map((b) => [b.engine, b.reason, path.basename(b.file)]), same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const q5Of = async (w) => {
  const sd = path.join(w.cwd, "site-checks", HOST, "snapshots", "2026-10-24");
  const pg = { measuredAt: "2026-10-24T10:00:00Z", vitals: { lcpMs: 1500, cls: 0.01, tbtMs: 100 }, totals: { bytes: 1024000, requests: 20 }, page: { canonical: SITE, metaDescription: "d", h1Count: 1, structuredData: [{ ok: true, types: ["WebPage"] }], og: { "og:title": "t" }, robotsMeta: [] } };
  W(path.join(sd, "_site.json"), { finishedAt: "2026-10-24T10:00:00Z", runs: 1, stoppedEarly: null, machineLoad: null, pages: [{ url: SITE, slug: "home", status: 200 }] });
  W(path.join(sd, "site/robots.json"), { status: 200, groups: [{ agents: ["*"], rules: [] }] }); W(path.join(sd, "site/sitemaps.json"), { urlCount: 3 }); W(path.join(sd, "site/probes.json"), { notFound: { finalStatus: 404 } });
  W(path.join(sd, "pages", "home", "browser-mobile.json"), { url: SITE, ...pg }); W(path.join(sd, "pages", "home", "response.json"), { headers: {} });
  const r = await run("report-live.mjs", [SITE, "--cwd", w.cwd, "--snapshot", sd], { env: { GSC_TOKEN_FILE: "", GSC_SERVICE_ACCOUNT_FILE: "", GSC_SERVICE_ACCOUNT_JSON_B64: "" } });
  const f = path.join(w.pewp, "report.json");
  return { code: r.code, q: fs.existsSync(f) ? J(f).questions.find((x) => x.n === 5) : null };
};
try {
  const D = imp(FD), E = imp(FE), F = imp(FF), G = imp(FG);
  const w7 = world(), out = await AI.run(ctxOf(w7), { dir: put(w7, FF) }), rp = await q5Of(w7);
  const doc = J(path.join(w7.pewp, "research", "ai-citations.json")), fa = rp.q?.facts || {};
  check("case 1: a capture in import-ai's form: its citedSources are the row's cited sources (own domain first, www removed), the site is cited, share 1; the other row holds its one source, share 0", same(view(byEng(D, "chatgpt")), { runs: 1, citedSources: [HOST, "alpha-lending.test", "beta-loans.test"], cites: true, share: 1 }) && same(view(byEng(D, "perplexity")), { runs: 1, citedSources: ["alpha-lending.test"], cites: false, share: 0 }) && D.rejected.length === 0, JSON.stringify(D.rows.map(view)));
  check("case 2: its answerText is searched for the business's name: the answer that names it gives name share 1, the one that does not gives 0", nameOf(byEng(D, "chatgpt")) === 1 && nameOf(byEng(D, "perplexity")) === 0, JSON.stringify(D.rows.map(nameOf)));
  check("case 3: the older forms (citedDomains with answer; sources as texts, as {url}, as {domain}; all three lists plus both answer fields) give exactly today's rows", E.rows.length === 4 && E.rejected.length === 0 && bl(E).length === 0 && Object.keys(EXP_E).every((e) => same(full(byEng(E, e)), EXP_E[e])), JSON.stringify(E.rows.map(full)));
  check("case 4: blocked captures (copilot twice with no question, gemini with a question) make no row and no run, nothing is rejected, blocked names each engine once with its reason and first file", F.rows.length === 2 && F.rows.every((r) => r.runs === 1) && !F.rows.some((r) => ["copilot", "gemini"].includes(r.engine)) && F.rejected.length === 0 && F.files === 6 && same(bl(F), [["copilot", "sign-in wall", "copilot-blocked-1.json"], ["gemini", "robot check", "gemini-blocked.json"]]), JSON.stringify([F.rows.map((r) => r.engine), F.rejected, bl(F)]));
  check("case 5: an engine with one answered and one blocked capture keeps one row with 1 run and is NOT in blocked", Array.isArray(F.blocked) && same(view(byEng(F, "chatgpt")), { runs: 1, citedSources: [HOST], cites: true, share: 1 }) && !bl(F).some((b) => b[0] === "chatgpt"), JSON.stringify([view(byEng(F, "chatgpt")), bl(F)]));
  check("case 6: a capture with no question is still rejected, and a blocked capture with no engine: today's reasons", same(G.rejected.map((x) => [path.basename(x.file), x.reason]), [["chatgpt-noq.json", "no question"], ["orphan-blocked.json", "no question; no engine"]]) && G.rows.length === 0, JSON.stringify(G.rejected));
  check("case 7: the report on the caller's own file: AI answers read counts the 2 answered runs, engines read are chatgpt and perplexity only, the not-read engines are named with their reason, shares 0.5", out.status === "ok" && rp.code === 0 && fa.answersChecked?.value === 2 && same(fa.engines?.value, ["chatgpt", "perplexity"]) && fa.citedShare?.value === 0.5 && fa.nameMentioned?.value === 0.5 && same(rp.q?.blocked, ["copilot: not read (sign-in wall)", "gemini: not read (robot check)"]), JSON.stringify([rp.code, fa.answersChecked?.value, fa.engines?.value, rp.q?.blocked]));
  check("case 8: the caller writes the list where it writes the owner part of ai-citations.json: owner.blocked names copilot and gemini with their reasons, files 6, rejected empty", doc.owner?.files === 6 && doc.owner.rejected.length === 0 && same((doc.owner.blocked || []).map((b) => [b.engine, b.reason]), [["copilot", "sign-in wall"], ["gemini", "robot check"]]), JSON.stringify(doc.owner));
} catch (e) {
  check("test harness ran to the end", false, e.stack || e);
}
rmTmp(tmp);

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);