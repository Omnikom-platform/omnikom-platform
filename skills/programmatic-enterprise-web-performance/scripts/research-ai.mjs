// AI citations: who do the AI engines name and cite for our target questions, and are we one of them?
// Answers vary from run to run, so every question is asked N times (default 3) and we record the SHARE of runs that cite our domain.
// Three free inputs:
//   1. Gemini API free tier with Google Search grounding ($GEMINI_API_KEY, free AI Studio key): N runs per question.
//      Stored: only DERIVED fields (cited domains, our domain cited y/n, name mentioned y/n). The raw answer and raw response are NOT
//      stored or cached: the project's 2026-10-18 terms reading (icm/work/seo-analyst/TRACKER-PROPOSAL.md, row T1b) found Gemini's terms
//      forbid caching/storing grounded results; whether storing parsed domains is allowed is UNVERIFIED, so we keep only those.
//   2. Owner-captured ChatGPT / Perplexity / Gemini / Copilot answers (the main session reads them in the owner's browser at human pace,
//      stop at the first robot check, never signs in): <pewp>/captures/ai/*.json (research's `sources` or measure's `citedDomains`),
//      or the project's AI-<ID>.<engine>.md files.
//   Gemini runs only with GEMINI_API_KEY AND PEWP_GEMINI_TERMS_ACK=1 (the owner's written confirmation; the same gate as measure.mjs),
//   and sends the samples of a question at least 60 s apart (06 section 9.6).
//   3. Google AI Overviews already inside the SERP captures (research/serp.json): one run per capture.
// Usage: node research-ai.mjs <target> [--question "q"]... [--questions-file F.json] [--gemini] [--runs 3] [--max-calls 30] [--model M]
//        [--dir DIR (owner captures, default <pewp>/captures/ai)] [--max-age-days 7] [--cwd DIR]
// Test hook: GEMINI_API_BASE, PEWP_TEST_GAP_MS. A 429 stops the Gemini part (runs done so far are kept). Output: research/ai-citations.json.
import fs from "node:fs";
import path from "node:path";
import { Blocked, J, W, stripBom, listFile, iso, ageDays, context, needBusiness, runCli, readStep, writeStep, writeBlocked, factor, domainOf, pace, normQuery } from "./research-lib.mjs";

const BASE = () => (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
const UNBLOCK_KEY = "aistudio.google.com: create a free API key and set GEMINI_API_KEY (then pass --gemini)";
// The same gate measure.mjs and doctor.mjs apply: the Gemini API terms forbid storing or monitoring grounded results (project research,
// TRACKER-PROPOSAL T1b, 2026-10-18); only derived fields are kept, and only once the owner has confirmed that in writing.
const UNBLOCK_TERMS = "Gemini terms not acknowledged: the owner confirms in writing that derived fields (cited domains, whether we are cited) may be kept from grounded answers, then set PEWP_GEMINI_TERMS_ACK=1 (see doctor.mjs, source gemini-terms)";
// 06 section 9.6: the samples of one question are sent at least 60 s apart (a shorter gap would give correlated answers, not samples).
export const GEMINI_GAP_MS = 60000;
const LOC = "unspecified (API call: Google Search grounding uses the server's location; the city is only in the question text)";
const isDomain = (s) => /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/i.test(String(s || "").trim());
const hit = (domains, own) => domains.some((d) => d === own || d.endsWith("." + own));

// ---------- 1. Gemini with Google Search grounding ----------
export async function geminiRuns(ctx, { questions, runs = 3, model = process.env.GEMINI_MODEL || "gemini-2.5-flash", maxCalls = 30, maxAgeDays = 7 }) {
  const key = (process.env.GEMINI_API_KEY || "").trim();
  if (!key) throw new Blocked(UNBLOCK_KEY);
  if (process.env.PEWP_GEMINI_TERMS_ACK !== "1") throw new Blocked(UNBLOCK_TERMS);
  const b = ctx.business, own = b.domain, nameRe = new RegExp(b.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const store = path.join(ctx.rdir, "ai-gemini-runs.json");
  const doc = J(store, { note: "DERIVED fields only; raw Gemini answers are not stored (terms UNVERIFIED, see research-ai.mjs)", runs: [] });
  let calls = 0, stopped = null;
  outer: for (const question of questions) {
    for (let n = 1; n <= runs; n++) {
      if (doc.runs.some((r) => r.question === question && r.run === n && r.model === model && ageDays(r.at) < maxAgeDays)) continue; // already paid for
      if (calls >= maxCalls) { stopped = `call budget ${maxCalls} reached`; break outer; }
      calls++;
      const url = `${BASE()}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      await pace(url, GEMINI_GAP_MS); // 06 section 9.6: samples at least 60 s apart (the free tier also allows only a few requests a minute)
      let res;
      try { res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: question }] }], tools: [{ google_search: {} }] }), signal: AbortSignal.timeout(60000) }); }
      catch (e) { stopped = `network: ${e.message}`; break outer; }
      if (res.status === 429 || res.status === 403) { stopped = `HTTP ${res.status} (free-tier quota or key refused)`; break outer; }
      if (res.status !== 200) { stopped = `HTTP ${res.status}`; break outer; }
      const j = await res.json();
      const cand = j.candidates?.[0] || {};
      const text = (cand.content?.parts || []).map((p) => p.text || "").join(" ");
      const chunks = cand.groundingMetadata?.groundingChunks || [];
      const cited = [...new Set(chunks.map((c) => c.web).filter(Boolean).map((w) => (isDomain(w.title) ? domainOf(w.title) : domainOf(w.uri || ""))).filter(Boolean))];
      doc.runs.push({ question, run: n, model, at: iso(), prompt: question, groundedSearches: (cand.groundingMetadata?.webSearchQueries || []).length, citedSources: cited, ourDomainCited: hit(cited, own), nameMentioned: nameRe.test(text), answered: text.length > 0 });
      W(store, doc); // saved after every call: a stop loses nothing
    }
  }
  W(store, doc);
  return { doc, store, calls, stopped, model };
}

function rowsFromRuns(ctx, engine, model, groups, source, fetchedAt, cacheFile, extra = {}) {
  const own = ctx.business.domain;
  return groups.map((g) => {
    const f = factor(source, fetchedAt, cacheFile, { location: g.location || LOC });
    const counts = new Map(); g.runs.forEach((r) => r.citedSources.forEach((d) => counts.set(d, (counts.get(d) || 0) + 1)));
    const cites = g.runs.filter((r) => r.ourDomainCited).length, names = g.runs.filter((r) => r.nameMentioned).length;
    return { question: g.question, engine, model: model || g.model || "model not shown by the app", prompt: g.prompt || g.question, runs: g.runs.length, citedShare: f(cites / g.runs.length, { unit: `share of ${g.runs.length} run(s) whose cited sources include ${own}` }),
      citedSources: [...counts].sort((a, b) => b[1] - a[1]).map(([d]) => d), sourceCounts: Object.fromEntries(counts), ourDomainCited: cites > 0, ourNameMentionedShare: f(names / g.runs.length, { unit: "share of runs whose answer text names the business (not necessarily a cited link)" }),
      location: g.location || LOC, lowRuns: g.runs.length < 3, dates: [...new Set(g.runs.map((r) => String(r.at).slice(0, 10)))], ...extra };
  });
}

// ---------- 2. owner-captured answers ----------
const domainsIn = (s) => [...new Set([...String(s || "").matchAll(/\b([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|org|net|gov|edu|io|co|us|info|biz|app|dev|ai|news|realty|homes))\b/gi)].map((m) => m[1].toLowerCase().replace(/^www\./, "")))];
export function parseOwnerMarkdown(text, file) {
  const t = stripBom(text).replace(/\r/g, ""); // a BOM in front of line 1 hid the question line
  const head = t.split("\n")[0];
  const m = head.match(/^#\s*\S+\s+[—-]\s+"([^"]+)"\s+[—-]\s+([^—-]+?)\s+[—-]\s+(\d{4}-\d{2}-\d{2})/);
  const engine = (path.basename(file).match(/\.(chatgpt|gemini|perplexity|copilot)\.md$/i) || [])[1]?.toLowerCase() || (m ? m[2].toLowerCase().replace(/^google /, "") : null);
  const ans = (t.match(/##\s*Answer[^\n]*\n([\s\S]*?)(?=\n##\s|$)/) || [])[1] || "";
  const srcSec = (t.match(/##\s*Sources cited[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i) || [])[1] || "";
  const loc = (t.match(/Location the assistant assumed or stated:\s*([^\n]+)/i) || [])[1];
  return { question: m?.[1] || null, engine, capturedAt: m?.[3] || null, browser: /Edge/i.test(head) ? "owner's Edge" : null, location: loc ? `assistant-stated: ${loc.trim().slice(0, 120)}` : null, answer: ans.trim(), sources: domainsIn(srcSec), file };
}
export function importOwner(ctx, dir) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.json$|\.(chatgpt|gemini|perplexity|copilot)\.md$/i.test(f)).sort() : [];
  const own = ctx.business.domain, nameRe = new RegExp(ctx.business.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const runs = [], rejected = [];
  for (const f of files) {
    const file = path.join(dir, f);
    let c; try { c = /\.json$/i.test(f) ? { ...J(file), file } : parseOwnerMarkdown(fs.readFileSync(file, "utf8"), file); } catch (e) { rejected.push({ file, reason: e.message }); continue; }
    const why = [];
    if (!c.question) why.push("no question"); if (!c.engine) why.push("no engine"); if (!c.capturedAt || Number.isNaN(Date.parse(c.capturedAt))) why.push("no capture date");
    if (why.length) { rejected.push({ file, reason: why.join("; ") }); continue; }
    // two capture formats, one folder: research's `sources` (domains or {url|domain}) and measure's `citedDomains` (domains)
    const srcs = (Array.isArray(c.citedDomains) ? c.citedDomains : c.sources || []).map((s) => domainOf(typeof s === "string" ? s : s.url || s.domain || "")).filter(Boolean);
    runs.push({ question: c.question, engine: String(c.engine).toLowerCase(), model: c.model || null, prompt: c.prompt || c.question, at: c.capturedAt, location: c.location || "unspecified (consumer app in the owner's browser; the assistant's own location guess is not recorded)", citedSources: [...new Set(srcs)], ourDomainCited: hit(srcs, own), nameMentioned: nameRe.test(c.answer || ""), file, browser: c.browser || null });
  }
  const groups = new Map();
  for (const r of runs) { const k = `${r.engine}|${normQuery(r.question)}`; (groups.get(k) || groups.set(k, { question: r.question, engine: r.engine, model: r.model, prompt: r.prompt, location: r.location, runs: [] }).get(k)).runs.push(r); }
  const rows = [];
  for (const g of groups.values()) {
    const last = g.runs.map((r) => r.at).sort().at(-1);
    rows.push(...rowsFromRuns(ctx, g.engine, g.model, [g], `${g.engine} answer captured in the owner's browser (${g.runs.length} capture(s))`, `${String(last).slice(0, 10)}T00:00:00.000Z`, g.runs[0].file, { capturedBy: "owner-supervised browser capture" }));
  }
  return { rows, rejected, files: files.length };
}

// ---------- 3. Google AI Overviews inside the SERP captures ----------
export function fromSerp(ctx) {
  const serp = readStep(ctx, "serp"); if (serp?.status !== "ok") return [];
  const own = ctx.business.domain, nameRe = new RegExp(ctx.business.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const groups = new Map();
  for (const c of serp.captures.filter((c) => c.engine === "google" && c.aiOverview?.present)) {
    const k = `${normQuery(c.query)}|${c.locationLabel}`;
    const run = { at: c.capturedAt, citedSources: c.aiOverview.sources || [], ourDomainCited: hit(c.aiOverview.sources || [], own), nameMentioned: nameRe.test(`${c.aiOverview.text || ""} ${c.aiOverview.named || ""}`), file: c.file };
    (groups.get(k) || groups.set(k, { question: c.query, location: c.locationLabel, runs: [] }).get(k)).runs.push(run);
  }
  return [...groups.values()].flatMap((g) => rowsFromRuns(ctx, "google-ai-overview", "Google AI Overview (not versioned)", [g], "Google AI Overview captured in the browser (inside a SERP capture)", `${String(g.runs.map((r) => r.at).sort().at(-1)).slice(0, 10)}T00:00:00.000Z`, g.runs[0].file, { capturedBy: "owner-supervised browser capture", note: "sources are the domains the capture lists; an AI Overview that cites no domain counts as 0 citations" }));
}

export async function run(ctx, { questions = [], gemini = false, runs = 3, maxCalls = 30, model, dir = null, maxAgeDays = 7 } = {}) {
  const b = needBusiness(ctx);
  const out = { rows: [], gemini: { status: "not-run" }, owner: { files: 0, rejected: [] }, serpOverviews: 0 };
  if (gemini) {
    try {
      const qs = [...new Set(questions.map((q) => q.trim()).filter(Boolean))];
      if (!qs.length) throw new Blocked("no questions for Gemini: pass --question or --questions-file (the main session picks the target questions from the clusters)");
      const g = await geminiRuns(ctx, { questions: qs, runs, model, maxCalls, maxAgeDays });
      const wanted = qs.map((q) => ({ question: q, prompt: q, runs: g.doc.runs.filter((r) => r.question === q && r.model === g.model && r.answered), location: LOC }));
      const done = wanted.filter((w) => w.runs.length);
      const last = g.doc.runs.map((r) => r.at).sort().at(-1);
      out.rows.push(...rowsFromRuns(ctx, "gemini-grounded", g.model, done, `Gemini API ${g.model} with Google Search grounding (free tier), ${runs} runs asked per question`, last, g.store, { capturedBy: "API" }));
      out.gemini = { status: g.stopped ? "partial" : "ok", model: g.model, calls: g.calls, stoppedBy: g.stopped, questionsAnswered: done.length, questionsAsked: qs.length };
    } catch (e) { if (!(e instanceof Blocked)) throw e; out.gemini = { status: "blocked", unblock: e.unblock }; }
  }
  const owner = importOwner(ctx, dir || path.join(ctx.pewp, "captures", "ai"));
  out.rows.push(...owner.rows); out.owner = { files: owner.files, rejected: owner.rejected };
  const ov = fromSerp(ctx); out.rows.push(...ov); out.serpOverviews = ov.length;
  if (!out.rows.length) { const m = `${out.gemini.unblock || "Gemini not run (pass --gemini with GEMINI_API_KEY set)"}; or the main session captures ChatGPT/Perplexity answers in the owner's browser (human pace, no sign-in by agents) into <pewp>/captures/ai/*.json (format in stages/research.md)`; writeBlocked(ctx, "ai-citations", m); throw new Blocked(m); }
  const instead = new Map();
  for (const r of out.rows) for (const d of r.citedSources) if (d !== b.domain) instead.set(d, (instead.get(d) || 0) + 1);
  return writeStep(ctx, "ai-citations", { ...out, citedInstead: [...instead].sort((a, c) => c[1] - a[1]).slice(0, 25).map(([domain, answers]) => ({ domain, answers })) });
}

await runCli(import.meta.url, "node research-ai.mjs <target> [--question q]... [--questions-file F] [--gemini] [--runs 3] [--max-calls 30] [--model M] [--dir DIR] [--max-age-days 7] [--cwd DIR]", ["gemini"], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const qf = a.get("questions-file");
  const fileQ = qf ? listFile(qf, "questions").map((x) => (typeof x === "string" ? x : x?.question)) : []; // a named file that is missing is a usage error, not "no questions"
  const r = await run(ctx, { questions: [...a.all("question"), ...fileQ], gemini: a.has("gemini"), runs: a.num("runs", 3), maxCalls: a.num("max-calls", 30), model: a.get("model") || undefined, dir: a.get("dir"), maxAgeDays: a.num("max-age-days", 7) });
  return `OK ai-citations: ${r.rows.length} rows (gemini: ${r.gemini.status}${r.gemini.stoppedBy ? ", stopped by " + r.gemini.stoppedBy : ""}; owner captures: ${r.owner.files} files, ${r.owner.rejected.length} rejected; AI Overviews in SERP captures: ${r.serpOverviews}) -> ${path.join(ctx.rdir, "ai-citations.json")}`;
});
