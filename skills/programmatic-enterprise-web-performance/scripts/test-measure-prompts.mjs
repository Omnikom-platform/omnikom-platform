// Usage: node test-measure-prompts.mjs [--scripts <dir>] [--verbose] [--no-mutants] [--json]
// Self-test of the monthly prompt-map re-run (DECISIONS 35, slice 5d): measure.mjs reading the (approved) prompt map, asking its rows under the same cost stop, writing
// measure/<date>/prompt-map.json (each row's engines block for that month) and the diff against the last month (named flips, cited flips, cited-page changes), and the
// report that lists rows per prompt. SYNTHETIC input only: an invented tea shop (kettleleaf), temp folders, a local fake Gemini server, no real network, no model.
// The M part breaks measure.mjs one rule at a time (each patch asserts its target text exists exactly once, so "the patch never applied" cannot pass as green) and
// requires the NAMED check to go red.
//   U pure functions   R runMeasure on a temp site   M mutants
// Exit 0 = all pass. --json prints {passed, total, failed:[names]} as the last line.
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(opt("--scripts") || HERE);
const VERBOSE = args.includes("--verbose");

// the test's own day arithmetic: it must not share code with the script it checks
const dayAdd = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const D2 = new Date().toISOString().slice(0, 10); // the Gemini answers carry the real clock, so the second month is today
const D1 = dayAdd(D2, -31); // the first month, exactly one window earlier
const BIZ = "Kettle & Leaf Tea";

async function suite(scriptsDir) {
  const R = [];
  const check = (name, ok, detail = "") => R.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 900) });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-mp-"));
  const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof s === "string" ? s : JSON.stringify(s, null, 1)); };
  const J = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
  const rf = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } }; // a missing file is a red check, never a crash that hides the named one
  const imp = (f) => import(pathToFileURL(path.join(scriptsDir, f)).href);
  const M = await imp("measure.mjs"), lib = await imp("lib-prompt-map.mjs");

  // ---- the fake Gemini: records what it was asked, cites kettleleaf only for the office question ----
  const asked = [];
  const server = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      let j = {}; try { j = JSON.parse(b); } catch {}
      const q = j.contents?.[0]?.parts?.[0]?.text || "";
      asked.push({ url: req.url, q, parts: j.contents?.[0]?.parts?.length, contents: j.contents?.length, system: !!j.systemInstruction, grounded: !!j.tools?.[0]?.google_search });
      const ours = /office/.test(q);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: "SECRET_ANSWER_TEXT a tea answer" }] }, groundingMetadata: { groundingChunks: [{ web: { title: ours ? "kettleleaf.example" : "teablog.example", uri: "https://x.example/r" } }], webSearchQueries: ["tea"] } }] }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const API = `http://127.0.0.1:${server.address().port}`;
  const dead = "http://127.0.0.1:1"; // refused at once: a run that is not meant to call anything cannot reach any host
  const noEndpoints = { gsc: dead, inspect: dead, token: dead, bing: dead, crux: dead, gemini: dead };
  const fakeEndpoints = { ...noEndpoints, gemini: API };

  // ---- the synthetic map: three rows on the invented tea shop ----
  const T1 = "Is loose leaf green tea worth the price compared with bagged tea for someone who drinks two cups a day on a student budget?";
  const T2 = "First time buying matcha, ceremonial or culinary grade for lattes when I spend under 30 dollars a month?";
  const T3 = "Which tea subscription suits an office of ten people who want caffeine free options and one delivery a month?";
  const forum = { kind: "forum", ref: "research/forums.json:3", seenAt: "2026-01-05", quote: "a regular asked which tea to buy for a small budget" };
  const lead = { kind: "lead", ref: "leads-export.csv:7", seenAt: "2026-01-05" };
  const row = (prompt, o = {}) => ({ id: lib.promptId(prompt), prompt, scenario: o.scenario ?? "a tea drinker on a budget", comparison: o.comparison ?? "one kind of tea against another", constraint: o.constraint ?? "a monthly spend limit", location: "Portland, OR", sources: o.sources ?? [forum], fix: { kind: "improve-page", target: "/green-tea/", note: "answer the price question first" }, ...(o.engines ? { engines: o.engines } : {}) });
  const staleEngines = { gemini: { named: true, cited: true, pageCited: null, at: "2026-01-02", source: "research/ai-citations.json" } }; // an old observation the map itself carries
  const R1 = row(T1, { sources: [forum, lead] }), R2 = row(T2), R3 = row(T3, { engines: staleEngines });
  const mapDoc = (rows = [R1, R2, R3]) => ({ step: "prompt-map", generatedAt: "2026-01-06", market: { country: "US", language: "en" }, rows });
  const cap = (engine, prompt, at, o = {}) => ({ engine, question: prompt, prompt, model: "test", capturedAt: `${at}T10:00:00Z`, capturedIn: "owner browser", location: "Portland, OR", answer: o.answer ?? "A general answer about tea.", sources: o.sources ?? [{ url: "https://teablog.example/post" }] });
  let seq = 0;
  // a temp site: host, business, the map, the captures; returns { url, pewp, host }
  const mk = ({ rows = mapDoc(), captures = {}, host = `tea${seq++}.example`, aiCitations = null } = {}) => {
    const pewp = path.join(tmp, "site-checks", host, ".pewp");
    w(path.join(pewp, "business.json"), { name: BIZ, domain: host });
    if (rows) w(path.join(pewp, "research", "prompt-map.json"), rows);
    for (const [f, c] of Object.entries(captures)) w(path.join(pewp, "captures", "ai", f), c);
    if (aiCitations) w(path.join(pewp, "research", "ai-citations.json"), aiCitations);
    return { url: `https://${host}/`, pewp, host, ours: (p) => `https://${host}${p}` };
  };
  const run = async (s, today, { gemini = false, config = {}, plan = false } = {}) => {
    try {
      return await M.runMeasure(s.url, { cwd: tmp, today, log: () => {}, plan, env: gemini ? { GEMINI_API_KEY: "TESTKEY" } : {}, tokenFile: path.join(tmp, "none.json"),
        config: { endpoints: gemini ? fakeEndpoints : noEndpoints, authority: { cache: path.join(tmp, "nocc") }, ...config, ai: { gapMs: 0, geminiTermsAcknowledged: gemini, ...(config.ai || {}) } } });
    } catch (e) { return { crashed: e.message }; }
  };
  const dirOf = (s, d) => path.join(s.pewp, "measure", d);
  const eng = (doc, id, e) => (doc?.rows || []).find((r) => r.id === id)?.engines?.[e];
  const none = { named: null, cited: null, pageCited: null, at: null, source: null };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  try {
    // ============ U: pure functions ============
    {
      const o = (engine, promptId, at, v = {}) => ({ engine, promptId, keys: [], named: null, cited: null, pageCited: null, at, source: "s", capture: true, ...v });
      const date = "2026-11-01", from = "2026-10-01"; // window of 31 days: (from, date]
      const obs = [o("chatgpt", "a", from, { named: true }), o("chatgpt", "b", dayAdd(from, 1), { named: true }), o("chatgpt", "c", date, { named: true }), o("chatgpt", "d", dayAdd(date, 1), { named: true })];
      const rows = ["a", "b", "c", "d", "e"].map((id) => ({ id, prompt: `prompt ${id}`, location: "", fix: { kind: "new-page" }, engines: { chatgpt: { named: true, cited: true, pageCited: "https://x/", at: "2026-01-01", source: "old" } } }));
      const m = M.promptMonth(rows, obs, date, 31);
      const e = (id) => m.rows.find((r) => r.id === id)?.engines?.chatgpt;
      check("U: promptMonth: the day exactly one window back is out, the day after is in", m.from === from && e("a")?.named === null && e("b")?.named === true, JSON.stringify([m.from, e("a"), e("b")]));
      check("U: promptMonth: the run date is in, a day after it is out", e("c")?.named === true && e("d")?.named === null, JSON.stringify([e("c"), e("d")]));
      check("U: promptMonth: the engines block the map carries is never copied (no observation in the window is all null, not the old value)", same(e("e"), none) && same(e("a"), none) && m.rows.every((r) => !("sources" in r)), JSON.stringify([e("e"), e("a")]));
      check("U: promptMonth: counts what fell outside the window", m.observations === 2 && m.outsideWindow === 2, JSON.stringify([m.observations, m.outsideWindow]));
    }
    {
      const E = (v) => ({ named: null, cited: null, pageCited: null, at: "2026-10-01", source: "s", ...v });
      const doc = (date, rows) => ({ step: "prompt-map", date, rows: rows.map(([id, engines]) => ({ id, prompt: `prompt ${id}`, engines: { chatgpt: E(), perplexity: E(), gemini: E(), ...engines } })) });
      const P = "https://x.example/a/", Q = "https://x.example/b/";
      const prev = doc("2026-10-01", [["flip", { chatgpt: E({ named: true, cited: false }), perplexity: E({ named: false, cited: true, pageCited: P }) }], ["page", { chatgpt: E({ named: true, cited: true, pageCited: P }), perplexity: E({ named: true, cited: true, pageCited: P }) }], ["look", { chatgpt: E({ named: true, cited: true, pageCited: P }) }], ["old", { chatgpt: E({ named: true, cited: true }) }], ["part", { gemini: E({ named: null, cited: true }) }]]);
      const cur = doc("2026-11-01", [["flip", { chatgpt: E({ named: false, cited: true, pageCited: P }), perplexity: E({ named: true, cited: false }) }], ["page", { chatgpt: E({ named: true, cited: true, pageCited: Q }), perplexity: E({ named: true, cited: true, pageCited: P }) }], ["look", { perplexity: E({ named: false, cited: false }) }], ["new", { chatgpt: E({ named: true, cited: true }) }], ["part", { gemini: E({ named: true, cited: true }) }]]);
      const d = M.diffPromptMonths(prev, cur);
      const has = (id, engine, field, from, to) => d.changes.some((c) => c.id === id && c.engine === engine && c.field === field && c.from === from && c.to === to);
      check("U: diff: named flips are named lost / named gained, per prompt and engine", has("flip", "chatgpt", "named", true, false) && has("flip", "perplexity", "named", false, true) && d.counts.namedLost === 1 && d.counts.namedGained === 1, JSON.stringify(d.changes));
      check("U: diff: cited flips are cited gained / cited lost", has("flip", "chatgpt", "cited", false, true) && has("flip", "perplexity", "cited", true, false) && d.counts.citedGained === 1 && d.counts.citedLost === 1, JSON.stringify(d.counts));
      check("U: diff: a different cited page (cited both months) is a page change, the same page is not", d.changes.filter((c) => c.field === "pageCited").length === 1 && has("page", "chatgpt", "pageCited", P, Q) && !d.changes.some((c) => c.id === "page" && c.engine === "perplexity") && d.counts.pageChanged === 1, JSON.stringify(d.changes.filter((c) => c.id === "page")));
      check("U: diff: not checked -> observed is a first look, never a change", d.firstLooks.some((x) => x.id === "look" && x.engine === "perplexity") && !d.changes.some((c) => c.id === "look" && c.engine === "perplexity"), JSON.stringify(d.firstLooks));
      check("U: diff: observed -> not checked is listed as not checked this month, never as named/cited lost", d.lostLooks.some((x) => x.id === "look" && x.engine === "chatgpt" && x.named === true) && !d.changes.some((c) => c.id === "look" && c.engine === "chatgpt"), JSON.stringify(d.lostLooks));
      check("U: diff: a field that was null on one side is not a flip (named null -> true while cited stayed true)", !d.changes.some((c) => c.id === "part"), JSON.stringify(d.changes.filter((c) => c.id === "part")));
      check("U: diff: rows added to and gone from the map are listed", d.rowsAdded.map((r) => r.id).join() === "new" && d.rowsRemoved.map((r) => r.id).join() === "old", JSON.stringify([d.rowsAdded, d.rowsRemoved]));
      check("U: diff: no earlier month is a baseline, with no change listed", M.diffPromptMonths(null, cur).baseline === true && !M.diffPromptMonths(null, cur).changes && M.diffPromptMonths(cur, cur).changes.length === 0);
    }
    {
      // the ai-answers snapshot rows: a row without any of promptId, engine, named, cited, asked_at, evidence is refused (the platform CHECK says the same)
      const good = { promptId: "pm-1", prompt: "p", engine: "chatgpt", named: true, cited: false, pageCited: null, asked_at: "2026-10-20", evidence_url: "https://x.example/a/", evidence_excerpt: null };
      check("U: ai-answers: a complete row passes the validator, an excerpt can stand in for the URL", M.validateAiAnswerRow(good).length === 0 && M.validateAiAnswerRow({ ...good, evidence_url: null, evidence_excerpt: "captures/ai/c1.json, seen 2026-10-20" }).length === 0, JSON.stringify(M.validateAiAnswerRow(good)));
      const cases = [["promptId", { promptId: "" }], ["engine", { engine: "bing" }], ["named", { named: undefined }], ["cited", { cited: undefined }], ["asked_at", { asked_at: null }], ["asked_at", { asked_at: "last week" }], ["evidence", { evidence_url: null, evidence_excerpt: null }], ["evidence", { evidence_url: "not a url", evidence_excerpt: " " }]];
      const bad = cases.filter(([k, o]) => { const r = { ...good, ...o }; if (r[Object.keys(o)[0]] === undefined) delete r[Object.keys(o)[0]]; const p = M.validateAiAnswerRow(r); return !(p.length && p.some((x) => x.startsWith(k))); });
      check("U: ai-answers: a row missing promptId, engine, named, cited, asked_at or evidence is refused, each by name", bad.length === 0, JSON.stringify(bad.map((b) => b[0])));
      check("U: ai-answers: a row with neither named nor cited observed is refused", M.validateAiAnswerRow({ ...good, named: null, cited: null }).length > 0);
      const E = (v) => ({ named: null, cited: null, pageCited: null, at: null, source: null, ...v });
      const doc = { map: { sha256: "abc" }, rows: [{ id: "a", prompt: "pa", engines: { chatgpt: E({ named: true, cited: true, pageCited: "https://x.example/a/", at: "2026-10-20", source: "captures/ai/c1.json" }), perplexity: E({ named: false, cited: false, at: "2026-10-21", source: "captures/ai/c2.json" }), gemini: E() } }, { id: "b", prompt: "pb", engines: { chatgpt: E({ named: true, at: null, source: "captures/ai/c3.json" }), perplexity: E({ cited: true, at: "2026-10-22", source: null }), gemini: E() } }] };
      const s2 = M.aiAnswersSnapshot(doc, "2026-11-01");
      check("U: ai-answers: one snapshot per run day, source ai-answers, the rows inside data, a row only for an observed pair", s2.source === "ai-answers" && s2.day === "2026-11-01" && s2.data.date === "2026-11-01" && s2.data.mapSha256 === "abc" && s2.data.rows.length === 2 && s2.data.rows.every((r) => !M.validateAiAnswerRow(r).length) && !s2.data.rows.some((r) => r.engine === "gemini") && !s2.refused.some((x) => x.engine === "gemini"), JSON.stringify(s2).slice(0, 500));
      check("U: ai-answers: an observed pair without asked_at or without evidence is refused by the writer, never written", s2.refused.length === 2 && s2.refused.some((x) => x.promptId === "b" && x.engine === "chatgpt" && x.problems.some((p) => /asked_at/.test(p))) && s2.refused.some((x) => x.promptId === "b" && x.engine === "perplexity" && x.problems.some((p) => /evidence/.test(p))) && !s2.data.rows.some((r) => r.promptId === "b"), JSON.stringify(s2.refused));
      check("U: ai-answers: the page of ours that was cited is the evidence URL, a capture file with its day is the dated excerpt otherwise", s2.data.rows.find((r) => r.engine === "chatgpt")?.evidence_url === "https://x.example/a/" && s2.data.rows.find((r) => r.engine === "perplexity")?.evidence_excerpt === "captures/ai/c2.json, seen 2026-10-21", JSON.stringify(s2.data.rows));
    }

    // ============ R: runMeasure on a temp site ============
    // month 1 (D1): chatgpt and perplexity captured by the owner, one research/ai-citations row; month 2 (D2): new captures and the fake Gemini
    const s = mk({
      host: "kettleleaf.example", // the fake Gemini cites this host for the office prompt
      captures: {
        "c1.json": cap("chatgpt", T1, dayAdd(D1, -3), { answer: `We like ${BIZ} for loose leaf.`, sources: [{ url: "https://kettleleaf.example/green-tea/" }, { url: "https://teablog.example/post" }] }),
        "c2.json": cap("perplexity", T1, dayAdd(D1, -2)),
        "c3.json": cap("chatgpt", T2, dayAdd(D1, -4), { answer: `${BIZ} sells both grades.` }),
      },
      aiCitations: { step: "ai-citations", status: "ok", rows: [{ engine: "gemini-grounded", question: T2, prompt: T2, dates: [dayAdd(D1, -5)], ourNameMentionedShare: { value: 0.33 }, ourDomainCited: false }] },
    });
    const r1 = await run(s, D1);
    const d1 = dirOf(s, D1), pm1 = J(path.join(d1, "prompt-map.json"));
    check("R: month 1 runs (exit 0) and writes measure/<date>/prompt-map.json with one row per prompt", !r1.crashed && pm1?.step === "prompt-map" && pm1.rows?.length === 3 && same(pm1.rows.map((r) => r.id), [R1.id, R2.id, R3.id]), r1.crashed || JSON.stringify(pm1).slice(0, 300));
    check("R: month 1: chatgpt on prompt 1 is named, cited, with the page of ours and the capture file as its source", same(eng(pm1, R1.id, "chatgpt"), { named: true, cited: true, pageCited: s.ours("/green-tea/"), at: dayAdd(D1, -3), source: "captures/ai/c1.json" }), JSON.stringify(eng(pm1, R1.id, "chatgpt")));
    check("R: month 1: perplexity on prompt 1 was seen and is neither named nor cited (false, not null)", same(eng(pm1, R1.id, "perplexity"), { named: false, cited: false, pageCited: null, at: dayAdd(D1, -2), source: "captures/ai/c2.json" }), JSON.stringify(eng(pm1, R1.id, "perplexity")));
    check("R: month 1: prompt 2 takes chatgpt from a capture and gemini from research/ai-citations.json (named true, cited false)", same(eng(pm1, R2.id, "chatgpt"), { named: true, cited: false, pageCited: null, at: dayAdd(D1, -4), source: "captures/ai/c3.json" }) && same(eng(pm1, R2.id, "gemini"), { named: true, cited: false, pageCited: null, at: dayAdd(D1, -5), source: "research/ai-citations.json" }), JSON.stringify([eng(pm1, R2.id, "chatgpt"), eng(pm1, R2.id, "gemini")]));
    check("R: month 1: an engine nobody looked at is all null; the old engines block in the map row is not this month's", same(eng(pm1, R1.id, "gemini"), none) && same(eng(pm1, R3.id, "gemini"), none) && same(eng(pm1, R3.id, "chatgpt"), none), JSON.stringify([eng(pm1, R3.id, "gemini"), eng(pm1, R1.id, "gemini")]));
    check("R: month 1 is the baseline: the diff says so", r1.diff?.promptMap?.baseline === true && J(path.join(d1, "diff.json"))?.promptMap?.baseline === true, JSON.stringify(r1.diff?.promptMap));
    check("R: month 1: summary.json lists the prompt map as partial (prompt 3 has no observation), with the step that unblocks it", r1.summary?.parts?.promptMap?.status === "partial" && /1 of 3 prompts have no observation/.test(r1.summary.parts.promptMap.reason || "") && /captures\/ai/.test(r1.summary.parts.promptMap.unblock || ""), JSON.stringify(r1.summary?.parts?.promptMap));
    const rep1 = rf(path.join(d1, "report.md"));
    check("R: month 1: report.md lists every prompt id and its prompt, and says 'not checked' for what nobody looked at", [R1, R2, R3].every((r) => rep1.includes(`${r.id} "${r.prompt}"`)) && /perplexity not checked this month/.test(rep1) && /## Prompts/.test(rep1), rep1.slice(rep1.indexOf("## Prompts"), rep1.indexOf("## Prompts") + 900));
    const out1 = rf(path.join(d1, "prompt-map.json"));
    check("R: the month's file carries no source, no quote and no lead reference of the map", !/leads-export|a regular asked|"sources"|"quote"/.test(out1), out1.slice(0, 400));

    // month 2
    w(path.join(s.pewp, "captures", "ai", "c4.json"), cap("chatgpt", T1, dayAdd(D2, -4), { answer: "A general answer without the shop.", sources: [{ url: s.ours("/loose-leaf/") }] }));
    w(path.join(s.pewp, "captures", "ai", "c5.json"), cap("perplexity", T1, dayAdd(D2, -3), { answer: `${BIZ} is often recommended.`, sources: [{ url: s.ours("/green-tea/") }] }));
    w(path.join(s.pewp, "captures", "ai", "c6.json"), cap("perplexity", T2, dayAdd(D2, -2)));
    const before = asked.length;
    const r2 = await run(s, D2, { gemini: true });
    const d2 = dirOf(s, D2), pm2 = J(path.join(d2, "prompt-map.json")), dif = J(path.join(d2, "diff.json"))?.promptMap;
    const mine = asked.slice(before);
    check("R: month 2: Gemini is asked each prompt of the map, alone, three times, with grounding on and no system prompt", !r2.crashed && [T1, T2, T3].every((t) => mine.filter((a) => a.q === t).length === 3) && mine.length === 9 && mine.every((a) => a.parts === 1 && a.contents === 1 && !a.system && a.grounded), r2.crashed || JSON.stringify(mine.map((a) => a.q.slice(0, 20))));
    check("R: month 2: the Gemini answer on the office prompt is cited (cited true, named null: the answer text is not kept), the others cited false", same(eng(pm2, R3.id, "gemini"), { named: null, cited: true, pageCited: null, at: D2, source: `measure/${D2}/ai.json (Gemini API)` }) && eng(pm2, R1.id, "gemini")?.cited === false && eng(pm2, R2.id, "gemini")?.cited === false, JSON.stringify([eng(pm2, R3.id, "gemini"), eng(pm2, R1.id, "gemini")]));
    check("R: month 2: the grounded answer text is stored nowhere", !fs.readdirSync(d2).some((f) => rf(path.join(d2, f)).includes("SECRET_ANSWER_TEXT")), "");
    check("R: month 2: the last month's captures are outside the window, the new ones are in", eng(pm2, R1.id, "chatgpt")?.source === "captures/ai/c4.json" && eng(pm2, R1.id, "perplexity")?.source === "captures/ai/c5.json" && pm2.observationsOutsideWindow >= 3, JSON.stringify([eng(pm2, R1.id, "chatgpt"), pm2?.observationsOutsideWindow]));
    check("R: diff: chatgpt on prompt 1 lost its name (true -> false)", dif?.changes?.some((c) => c.id === R1.id && c.engine === "chatgpt" && c.field === "named" && c.from === true && c.to === false), JSON.stringify(dif?.changes));
    check("R: diff: perplexity on prompt 1 gained its name and its citation", dif?.changes?.some((c) => c.id === R1.id && c.engine === "perplexity" && c.field === "named" && c.to === true) && dif.changes.some((c) => c.id === R1.id && c.engine === "perplexity" && c.field === "cited" && c.to === true), JSON.stringify(dif?.changes));
    check("R: diff: chatgpt on prompt 1 is cited both months but by another page of ours", dif?.changes?.some((c) => c.id === R1.id && c.engine === "chatgpt" && c.field === "pageCited" && c.from === s.ours("/green-tea/") && c.to === s.ours("/loose-leaf/")), JSON.stringify(dif?.changes));
    check("R: diff: first looks (prompt 1 gemini, prompt 2 perplexity, prompt 3 gemini) and the pair nobody checked this month (prompt 2 chatgpt) are not changes", [[R1.id, "gemini"], [R2.id, "perplexity"], [R3.id, "gemini"]].every(([id, e]) => dif?.firstLooks?.some((x) => x.id === id && x.engine === e)) && dif.lostLooks.some((x) => x.id === R2.id && x.engine === "chatgpt") && !dif.changes.some((c) => c.id === R2.id) , JSON.stringify([dif?.firstLooks?.length, dif?.lostLooks, dif?.changes?.filter((c) => c.id === R2.id)]));
    check("R: diff counts: named 1 gained 1 lost, cited 1 gained 0 lost, 1 page change", same(dif?.counts && { ng: dif.counts.namedGained, nl: dif.counts.namedLost, cg: dif.counts.citedGained, cl: dif.counts.citedLost, pc: dif.counts.pageChanged }, { ng: 1, nl: 1, cg: 1, cl: 0, pc: 1 }), JSON.stringify(dif?.counts));
    const rep2 = rf(path.join(d2, "report.md")), dmd = rf(path.join(d2, "diff.md"));
    check("R: report.md lists the rows per prompt with named/cited per engine, and the flips since the last month", [R1, R2, R3].every((r) => rep2.includes(`${r.id} "${r.prompt}"`)) && /chatgpt named no, cited yes/.test(rep2) && new RegExp(`Since ${D1}: named gained 1, named lost 1, cited gained 1, cited lost 0, cited page changed 1`).test(rep2), rep2.slice(rep2.indexOf("## Prompts"), rep2.indexOf("## Prompts") + 1200));
    check("R: diff.md has the prompt-map section with the page change", /## Prompt map/.test(dmd) && dmd.includes(`${s.ours("/green-tea/")} -> ${s.ours("/loose-leaf/")}`), dmd.slice(-600));
    const rj = J(path.join(d2, "report.json"));
    check("R: report.json carries the prompt-map summary (rows, observed rows, counts)", rj?.promptMap?.rows === 3 && rj.promptMap.observedRows === 3 && rj.promptMap.changes?.pageChanged === 1, JSON.stringify(rj?.promptMap));
    const cit = J(path.join(d2, "citations.json"));
    check("R: citations.json (the contract pair) carries the prompt rows with their prompt id", [R1, R2, R3].every((r) => cit?.citations?.some((c) => c.promptId === r.id && c.prompt === r.prompt && c.engine === "gemini")), JSON.stringify(cit?.citations?.map((c) => c.promptId)));
    {
      const aa = J(path.join(d2, "ai-answers.json")), pairs = [R1, R2, R3].flatMap((r) => lib.ENGINES.map((e) => [r.id, e])).filter(([id, e]) => eng(pm2, id, e).named !== null || eng(pm2, id, e).cited !== null);
      check("R: ai-answers.json: one snapshot for the run day (source ai-answers), one inner row per observed prompt and engine, all valid, none refused", aa?.source === "ai-answers" && aa.day === D2 && aa.data?.date === D2 && aa.data.mapSha256 === pm2.map.sha256 && aa.data.rows.length === pairs.length && pairs.length >= 5 && pairs.every(([id, e]) => aa.data.rows.some((x) => x.promptId === id && x.engine === e)) && aa.data.rows.every((x) => !M.validateAiAnswerRow(x).length) && aa.refused.length === 0, JSON.stringify(aa).slice(0, 500));
      const x = aa?.data?.rows?.find((q) => q.promptId === R1.id && q.engine === "chatgpt");
      check("R: ai-answers.json: chatgpt on prompt 1 carries named false, cited true, the day it was captured and our cited page as evidence", x?.named === false && x.cited === true && x.asked_at === dayAdd(D2, -4) && x.evidence_url === s.ours("/loose-leaf/"), JSON.stringify(x));
      check("R: ai-answers.json: a pair nobody looked at has no row, and the Gemini answer text is not in it", !aa?.data?.rows?.some((q) => q.promptId === R2.id && q.engine === "chatgpt") && !JSON.stringify(aa).includes("SECRET_ANSWER_TEXT"), JSON.stringify(aa?.data?.rows?.map((q) => [q.promptId, q.engine])));
    }
    const r2b = await run(s, D2, { gemini: true }), dif2 = J(path.join(d2, "diff.json"))?.promptMap;
    check("R: running the same day again still diffs against the last month, not against itself", !r2b.crashed && dif2?.previousDate === D1 && dif2.changes?.length === dif.changes.length && dif2.changes.length > 0, JSON.stringify([dif2?.previousDate, dif2?.changes?.length]));

    // plan and the cost stop
    {
      const p = await run(s, D2, { gemini: true, plan: true });
      check("R: the plan counts the map's prompts as questions (3 prompts x 3 runs = 9 answers) and names the map", !p.crashed && p.plan?.aiAnswers === 9 && p.plan.lines.some((l) => /3 of them prompts from the prompt map/.test(l)), JSON.stringify(p.plan?.lines));
      const t = mk({ captures: {} }), c0 = asked.length;
      const q = await run(t, D2, { gemini: true, config: { budgets: { ai: 4 } } });
      check("R: prompts are under the same cost stop: 9 answers over a cap of 4 asks Gemini nothing and says why", !q.crashed && asked.length === c0 && /over the cost stop/.test(q.cur?.ai?.gemini?.blocked?.reason || q.cur?.ai?.blocked?.reason || ""), JSON.stringify(q.cur?.ai?.blocked || q.cur?.ai?.gemini));
    }

    // no map, an invalid map, no observation, selection, approval
    {
      const n = mk({ rows: null, captures: { "c1.json": cap("chatgpt", T1, dayAdd(D2, -3)) } }), rn = await run(n, D2);
      check("R: no prompt map: no prompt-map.json, summary says none (not silently nothing), report says there is no map", !rn.crashed && !fs.existsSync(path.join(dirOf(n, D2), "prompt-map.json")) && rn.summary?.promptMap?.status === "none" && !rn.summary.parts.promptMap && /No prompt map yet/.test(rf(path.join(dirOf(n, D2), "report.md"))), JSON.stringify(rn.summary?.promptMap));
      w(path.join(n.pewp, "research", "prompt-map.json"), mapDoc([R1])); await run(n, D2);
      const there = fs.existsSync(path.join(dirOf(n, D2), "prompt-map.json"));
      fs.rmSync(path.join(n.pewp, "research", "prompt-map.json"));
      const thereAa = fs.existsSync(path.join(dirOf(n, D2), "ai-answers.json"));
      await run(n, D2);
      check("R: a map that is gone takes last run's prompt-map.json of the same day with it", there && !fs.existsSync(path.join(dirOf(n, D2), "prompt-map.json")), String(there));
      check("R: a map that is gone takes last run's ai-answers.json of the same day with it", thereAa && !fs.existsSync(path.join(dirOf(n, D2), "ai-answers.json")), String(thereAa));
    }
    {
      const bad = mk({ rows: mapDoc([{ ...R1, constraint: "" }, R2]) }), c0 = asked.length, rb = await run(bad, D2, { gemini: true });
      const f = J(path.join(dirOf(bad, D2), "prompt-map.json"));
      check("R: an invalid map is BLOCKED with the validator's reason, no row is measured and Gemini is asked nothing", !rb.crashed && f?.status === "blocked" && f.rows.length === 0 && /invalid/.test(f.blocked?.reason || "") && rb.summary?.parts?.promptMap?.status === "BLOCKED" && asked.length === c0, JSON.stringify([f?.status, f?.blocked?.reason, asked.length - c0]));
      check("R: an invalid map shows in the report as NOT MEASURED with the step that fixes it", /NOT MEASURED\. .*invalid/.test(rf(path.join(dirOf(bad, D2), "report.md"))) && /Prompt map\*\*: .*invalid/.test(rf(path.join(dirOf(bad, D2), "report.md"))), rf(path.join(dirOf(bad, D2), "report.md")).slice(-900));
    }
    {
      const e = mk({}), re = await run(e, D2), f = J(path.join(dirOf(e, D2), "prompt-map.json"));
      const allNull = f?.rows?.every((r) => lib.ENGINES.every((x) => same(r.engines[x], none)));
      check("R: a map with no observation in the window is BLOCKED (with the capture step) and every engine stays null: nothing is guessed", !re.crashed && allNull && f.status === "blocked" && re.summary?.parts?.promptMap?.status === "BLOCKED" && /3 of 3 prompts have no observation/.test(re.summary.parts.promptMap.reason), JSON.stringify([f?.status, re.summary?.parts?.promptMap]));
    }
    {
      const sel = mk({ captures: { "c1.json": cap("chatgpt", T2, dayAdd(D2, -3)) } }), rs = await run(sel, D2, { config: { ai: { prompts: [R2.id, "pm-deadbeef"] } } });
      const f = J(path.join(dirOf(sel, D2), "prompt-map.json"));
      check("R: ai.prompts lists row ids: only those rows are measured and an id that is not in the map is named", !rs.crashed && same(f?.rows?.map((r) => r.id), [R2.id]) && same(f.unknownIds, ["pm-deadbeef"]), JSON.stringify([f?.rows?.map((r) => r.id), f?.unknownIds]));
    }
    {
      const ap = mk({ captures: { "c1.json": cap("chatgpt", T1, dayAdd(D2, -3)) } });
      const signed = spawnSync(process.execPath, [path.join(scriptsDir, "approve.mjs"), "--pewp", ap.pewp, "prompt-map", "--by", "Owner"], { encoding: "utf8", timeout: 60000 });
      w(path.join(ap.pewp, "research", "prompt-map.json"), mapDoc([R1])); // the working copy moves on after the signature
      const ra = await run(ap, D2), f = J(path.join(dirOf(ap, D2), "prompt-map.json"));
      check("R: the approved map is read, not the working copy (3 signed rows, the working copy has 1)", signed.status === 0 && !ra.crashed && f?.map?.approved === true && f.map.file === "approved/prompt-map.json" && f.rows?.length === 3 && /signed by the owner/.test(rf(path.join(dirOf(ap, D2), "report.md"))), signed.stdout + JSON.stringify(f?.map));
      fs.appendFileSync(path.join(ap.pewp, "approved", "prompt-map.json"), "\n"); // changed after the signature
      const rt = await run(ap, D2), g = J(path.join(dirOf(ap, D2), "prompt-map.json"));
      check("R: an approved map changed after the signature is not trusted: BLOCKED, no row measured", !rt.crashed && g?.status === "blocked" && g.rows.length === 0 && /cannot be trusted/.test(g.blocked?.reason || ""), JSON.stringify(g?.blocked));
    }
  } finally {
    server.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
  return R;
}

// child mode: one mutant's suite in its own process, so mutants run in parallel
if (args.includes("--suite-json")) {
  const rs = await suite(path.resolve(opt("--suite-json")));
  process.stdout.write(JSON.stringify(rs.map((r) => ({ name: r.name, ok: r.ok }))));
  process.exit(0);
}
const t0 = Date.now();
const main = await suite(SCRIPTS);
const group = (r) => (r.name.match(/^([A-Z]):/) || [, "?"])[1];
const names = { U: "pure functions", R: "runMeasure" };
const out = [];
for (const g of Object.keys(names)) { const rs = main.filter((r) => group(r) === g); out.push(`${g} ${names[g]}: ${rs.filter((r) => r.ok).length}/${rs.length}`); }
for (const r of main) if (VERBOSE || !r.ok) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${r.ok ? "" : "\n     " + r.detail.replace(/\n/g, "\n     ")}`);
console.log(out.join("\n"));
let failed = main.filter((r) => !r.ok).length;
console.log(`${failed ? "FAIL" : "PASS"} test-measure-prompts ${main.filter((r) => r.ok).length}/${main.length} checks (${Math.round((Date.now() - t0) / 1000)} s)`);
if (args.includes("--json")) console.log(JSON.stringify({ passed: main.filter((r) => r.ok).length, total: main.length, failed: main.filter((r) => !r.ok).map((r) => r.name) }));

// ---------- M: watched-fail mutants ----------
if (!args.includes("--no-mutants") && !opt("--scripts")) {
  const MUTANTS = [
    ["measure.mjs", "o.at <= date && o.at > from);", "o.at <= date && o.at >= from);", /U: promptMonth: the day exactly one window back is out/, "an observation from the day the window starts counts as this month's"],
    ["measure.mjs", "o.at <= date && o.at > from);", "o.at > from);", /U: promptMonth: the run date is in, a day after it is out/, "an observation dated after the run counts as this month's"],
    ["measure.mjs", "fix: r.fix?.kind || null })); // engines are NOT copied from the map", "fix: r.fix?.kind || null, engines: r.engines })); // engines ARE copied", /U: promptMonth: the engines block the map carries is never copied/, "the map's old engines block passes for this month's"],
    ["measure.mjs", "const f = fillEngines(out, inWin);", "const f = fillEngines(out, obs);", /U: promptMonth: the day exactly one window back is out/, "the window is ignored when the engines are filled"],
    ["measure.mjs", "fix: r.fix?.kind || null })); // engines", "fix: r.fix?.kind || null, sources: r.sources })); // engines", /R: the month's file carries no source, no quote and no lead reference/, "the month's file copies the map's sources (lead references, forum quotes)"],
    ["measure.mjs", "if (a[f] != null && b[f] != null && a[f] !== b[f]) d.changes.push(", "if (a[f] !== b[f]) d.changes.push(", /U: diff: a field that was null on one side is not a flip/, "a field that was not checked counts as a flip"],
    ["measure.mjs", "a.pageCited && b.pageCited && a.pageCited !== b.pageCited) d.changes.push(", "a.pageCited && b.pageCited) d.changes.push(", /U: diff: a different cited page \(cited both months\) is a page change, the same page is not/, "the same cited page counts as a page change"],
    ["measure.mjs", "if (!sawA && sawB) {", "if (false) {", /U: diff: not checked -> observed is a first look/, "a first look is not listed"],
    ["measure.mjs", "if (sawA && !sawB) {", "if (false) {", /U: diff: observed -> not checked is listed as not checked this month/, "an engine nobody checked this month is not listed"],
    ["measure.mjs", "for (const r of prev.rows || []) if (!now.has(r.id)) d.rowsRemoved.push(", "for (const r of prev.rows || []) if (false) d.rowsRemoved.push(", /U: diff: rows added to and gone from the map are listed/, "a row gone from the map is not listed"],
    ["measure.mjs", "if (pm.approved && lock.exists && !lock.ok) return", "if (false) return", /R: an approved map changed after the signature is not trusted/, "a tampered approved map is trusted"],
    ["measure.mjs", "rows: want ? pm.rows.filter((r) => want.includes(r.id)) : pm.rows,", "rows: pm.rows,", /R: ai\.prompts lists row ids/, "ai.prompts is ignored"],
    ["measure.mjs", "tInfo.questions.slice(0, cfg.ai.maxQuestions)), ...pq];", "tInfo.questions.slice(0, cfg.ai.maxQuestions))];", /R: (month 2: Gemini is asked each prompt|the plan counts the map's prompts)/, "the prompts are not asked and not counted under the cost stop"],
    ["measure.mjs", 'if (r.method !== "api" || !r.promptId) continue;', "continue;", /R: month 2: the Gemini answer on the office prompt is cited/, "this run's Gemini answers never reach the month's file"],
    ["measure.mjs", "cited: r.ourDomainCited, pageCited: null, at, source: runSource", "cited: null, pageCited: null, at, source: runSource", /R: month 2: the Gemini answer on the office prompt is cited/, "a Gemini citation is recorded as not checked"],
    ["measure.mjs", "&& x < date).sort().reverse()", "&& x <= date).sort().reverse()", /R: running the same day again still diffs against the last month/, "a same-day re-run diffs against itself"],
    ["measure.mjs", 'seen === 0 ? "blocked"', 'seen === 0 ? "ok"', /R: a map with no observation in the window is BLOCKED/, "a map nobody looked at is reported ok"],
    ["measure.mjs", "catch (e) { if (e instanceof PromptMapError) return { present: true, ok: false, reason: e.message, lines: e.lines, rows: [], unknownIds: [] }; throw e; }", "catch (e) { if (e instanceof PromptMapError) return none; throw e; }", /R: an invalid map is BLOCKED with the validator's reason/, "an invalid map is silently treated as no map"],
    ["measure.mjs", "for (const r of rs.slice(0, 40)) L.push(", "for (const r of []) L.push(", /R: (month 1: report\.md lists every prompt id|report\.md lists the rows per prompt)/, "the report does not list the rows per prompt"],
    ["measure.mjs", "else summary.promptMap = {", "else void {", /R: no prompt map: no prompt-map\.json, summary says none/, "a site with no map leaves no word in summary.json"],
    ["measure.mjs", "if (!pinfo.present) fs.rmSync(promptFile, { force: true });", "if (!pinfo.present) void 0;", /R: a map that is gone takes last run's prompt-map\.json/, "a stale prompt-map.json of a removed map stays"],
    ["measure.mjs", "if (prompts.doc) diff.promptMap = diffPromptMonths(", "if (false) diff.promptMap = diffPromptMonths(", /R: diff: chatgpt on prompt 1 lost its name/, "the month is not diffed against the last"],
    ["measure.mjs", "if (pinfo.present) summary.parts.promptMap = {", "if (false) summary.parts.promptMap = {", /R: month 1: summary\.json lists the prompt map as partial/, "summary.json does not list the prompt map part"],
    ["measure.mjs", "const m = promptMonth(pinfo.rows, obs, date, cfg.ai.promptWindowDays);", "const m = promptMonth(pinfo.rows, obs, date, 400);", /R: month 2: the last month's captures are outside the window/, "the window is a year, last month's captures pass for this month's"],
    ["measure.mjs", 'if (typeof r.asked_at !== "string" || !isIsoDate(r.asked_at)) p.push("asked_at missing");', 'if (false) p.push("asked_at missing");', /U: ai-answers: a row missing promptId, engine, named, cited, asked_at or evidence is refused/, "a snapshot row without asked_at passes the validator"],
    ["measure.mjs", 'p.push("evidence (a URL or a dated excerpt) missing");', "void 0;", /U: ai-answers: a row missing promptId, engine, named, cited, asked_at or evidence is refused/, "a snapshot row without evidence passes the validator"],
    ["measure.mjs", 'if (!ENGINES.includes(r.engine)) p.push("engine missing or unknown");', "void 0;", /U: ai-answers: a row missing promptId, engine, named, cited, asked_at or evidence is refused/, "a snapshot row without an engine passes the validator"],
    ["measure.mjs", 'if (r.named == null && r.cited == null) p.push("neither named nor cited was observed");', "void 0;", /U: ai-answers: a row with neither named nor cited observed is refused/, "a row nobody observed passes the validator"],
    ["measure.mjs", "if (problems.length) refused.push({ promptId: r.id, engine, problems }); else rows.push(row);", "rows.push(row);", /U: ai-answers: an observed pair without asked_at or without evidence is refused by the writer/, "the writer writes a row the validator refused"],
    ["measure.mjs", "if (!x || (x.named == null && x.cited == null)) continue;", "if (!x) continue;", /U: ai-answers: one snapshot per run day/, "a pair nobody looked at gets a row"],
    ["measure.mjs", "return { source: AI_ANSWERS_SOURCE, day: date,", 'return { source: "ai-answer", day: date,', /U: ai-answers: one snapshot per run day/, "the snapshot carries another source name than the platform's CHECK allows"],
    ["measure.mjs", "evidence_url: url, evidence_excerpt: url || !x.source || !x.at ? null : `${x.source}, seen ${x.at}` };", "evidence_url: url, evidence_excerpt: null };", /U: ai-answers: the page of ours that was cited is the evidence URL/, "a capture without a cited page has no dated excerpt"],
    ["measure.mjs", "if (snap.data.rows.length || snap.refused.length) writeJson(aiFile, snap);", "void 0;", /R: ai-answers\.json: one snapshot for the run day/, "the snapshot file is never written"],
    ["measure.mjs", "fs.rmSync(aiFile, { force: true }); // a stale", "void 0; // a stale", /R: a map that is gone takes last run's ai-answers\.json/, "a stale ai-answers.json of an earlier run stays"],
  ];
  const results = new Array(MUTANTS.length), jobs = [];
  for (const [i, [file, from, to, expectRe, why]] of MUTANTS.entries()) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-mpm-"));
    fs.cpSync(SCRIPTS, path.join(root, "scripts"), { recursive: true });
    fs.cpSync(path.join(SCRIPTS, "..", "rules"), path.join(root, "rules"), { recursive: true });
    const f = path.join(root, "scripts", file), src = fs.readFileSync(f, "utf8"), n = src.split(from).length - 1;
    if (n !== 1) { results[i] = { i, file, why, status: n ? "PATCH-AMBIGUOUS" : "PATCH-NEVER-APPLIED", detail: `${n} x ${from}` }; continue; }
    fs.writeFileSync(f, src.split(from).join(to));
    jobs.push({ i, file, why, expectRe, root });
  }
  const runJob = (j) => new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(j.root, "scripts", "test-measure-prompts.mjs"), "--suite-json", path.join(j.root, "scripts")], { stdio: ["ignore", "pipe", "pipe"] });
    let o = ""; c.stdout.on("data", (d) => (o += d));
    const t = setTimeout(() => c.kill(), 10 * 60_000); // a mutant that hangs is killed and reported, never waited on forever
    c.on("close", () => {
      clearTimeout(t);
      let rs; try { rs = JSON.parse(o); } catch { rs = [{ name: "mutant suite did not finish", ok: false }]; }
      const red = rs.filter((r) => !r.ok), right = red.filter((r) => j.expectRe.test(r.name));
      results[j.i] = { i: j.i, file: j.file, why: j.why, status: right.length ? "RED (right reason)" : red.length ? "RED (other reason only)" : "GREEN (survived)", red: red.length, detail: (right[0] || red[0] || {}).name };
      try { fs.rmSync(j.root, { recursive: true, force: true }); } catch {}
      resolve();
    });
  });
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(4, os.cpus().length) }, async () => { while (queue.length) await runJob(queue.shift()); }));
  for (const r of results) console.log(`M mutant ${String(r.i + 1).padStart(2)} ${r.file}: ${r.why} -> ${r.status}${r.red ? ` (${r.red} failing; e.g. ${r.detail})` : r.detail ? ` ${r.detail}` : ""}`);
  const ok = results.filter((r) => r.status === "RED (right reason)").length;
  console.log(`${ok === results.length ? "PASS" : "FAIL"} mutants ${ok}/${results.length} went red for the right reason`);
  if (ok !== results.length) failed++;
}
process.exit(failed ? 1 : 0);
