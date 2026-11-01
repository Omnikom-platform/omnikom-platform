// The prompt map (DECISIONS 35), research side: draft candidates from the buyers' own words, check the map the session wrote, fill the engines.
// Usage: node research-prompts.mjs <target> [--leads FILE.csv] [--reviews FILE.json] [--max-candidates 200] [--cwd DIR]   -> <pewp>/private/prompt-candidates.json (git-ignored)
//        node research-prompts.mjs <target> --check [--map FILE]                                                        -> exit 0 valid, 1 refused rows
//        node research-prompts.mjs <target> --engines                                                                    -> fills engines in research/prompt-map.json
// Inputs: --leads is the CSV of the dashboard lead-export of ONE workspace (the owner saves it): only the free text of the `answers` cell is read;
//   name, email, phone and ids are dropped on read and never written, and an answer that names the person or holds an email or phone is dropped whole.
//   --reviews is a JSON list the owner saved of public reviews: [{ "text", "url", "date", "platform" }]. research/forums.json and research/existing.json
//   are read when present. The scripts only draft: splitting a sentence into scenario, comparison and constraint is the session's judgement
//   (stages/research.md, "Prompt map"); this file refuses a row whose parts are empty, whose source is missing or whose fix is not exactly one kind.
// Engines come from research/ai-citations.json and owner captures (captures/ai/*.json), matched by prompt id or the exact prompt text. This script
// makes no request of any kind: Gemini answers exist only when research-ai.mjs ran under its own gate (GEMINI_API_KEY and PEWP_GEMINI_TERMS_ACK=1).
import fs from "node:fs";
import path from "node:path";
import { Blocked, Usage, J, W, stripBom, today, context, needBusiness, runCli, readStep, writeStep, writeBlocked, listFile, sameQuery, hasPlaceholder } from "./research-lib.mjs";
import { MIN_WORDS, promptId, cutQuote, isIsoDate, hasPersonalData, personOf, namesPerson, parseCsv, freeTexts, validateMap, validateUnsourced, rowsOf, observationsFrom, fillEngines, leadQuotesOf, checkLeadWording } from "./lib-prompt-map.mjs";

const UNBLOCK_NONE = "no buyer words to draft from: pass --leads FILE.csv (the lead-export CSV of ONE workspace), --reviews FILE.json (public reviews the owner saved), or run research-forums.mjs / research-existing.mjs first";

function readLeads(file, tally) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { throw new Usage(`${file}: ${e.code === "ENOENT" ? "file not found" : e.message}`); }
  const rows = parseCsv(text), head = (rows[0] || []).map((h) => h.trim().toLowerCase()), ix = (k) => head.indexOf(k);
  if (ix("answers") < 0) throw new Usage(`${file}: not a lead-export CSV (no "answers" column; the header is ${head.join(", ") || "empty"})`);
  const base = path.basename(file), items = [];
  rows.slice(1).forEach((cells, i) => {
    const get = (k) => (ix(k) >= 0 ? cells[ix(k)] ?? "" : ""), n = i + 2; // n is the row number in a spreadsheet: the header is row 1
    tally.rows++;
    const cell = get("answers").trim();
    if (!cell) { tally.noAnswers++; return; }
    let answers; try { answers = JSON.parse(cell); } catch { tally.unreadable++; return; }
    const who = personOf({ name: get("name"), email: get("email"), phone: get("phone") }); // read for one comparison, never written
    const received = get("received").slice(0, 10), seenAt = isIsoDate(received) ? received : today();
    const texts = freeTexts(answers);
    if (!texts.length) { tally.noText++; return; }
    for (const t of texts) {
      if (hasPersonalData(t) || namesPerson(t, who)) { tally.personalDataDropped++; continue; }
      tally.used++;
      items.push({ text: t, source: { kind: "lead", ref: `${base}:${n}`, seenAt, quote: cutQuote(t) } });
    }
  });
  return items;
}
function readReviews(file, tally) {
  const items = [];
  for (const r of listFile(file, "reviews")) {
    tally.items++;
    const text = r && typeof r === "object" ? String(r.text ?? "").trim() : "", date = String(r?.date ?? "").slice(0, 10), url = String(r?.url ?? "").trim();
    if (!text || !/^https?:\/\//i.test(url) || !isIsoDate(date)) { tally.bad++; continue; }
    if (hasPersonalData(text)) { tally.personalDataDropped++; continue; }
    if (text.split(/\s+/).length < MIN_WORDS) { tally.noText++; continue; }
    tally.used++;
    items.push({ text, source: { kind: "review", ref: url, seenAt: date, quote: cutQuote(text) } });
  }
  return items;
}
const dateOr = (d, fallback) => (isIsoDate(String(d ?? "").slice(0, 10)) ? String(d).slice(0, 10) : fallback);

// Lead text never reaches a file a repo target commits: the candidates (which hold lead quotes) are written ONLY under <pewp>/private/, and that
// folder's own .gitignore (`*`) is written first, on every run, before anything else goes there.
export function privateCtx(ctx) {
  const dir = path.join(ctx.pewp, "private");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".gitignore"), "*\n");
  return { ...ctx, rdir: dir };
}
export function buildCandidates(ctx, { leadsFile = null, reviewsFile = null, maxCandidates = 200 } = {}) {
  needBusiness(ctx);
  const priv = privateCtx(ctx);
  const inputs = {}, items = [];
  if (leadsFile) { const t = inputs.leads = { file: path.basename(leadsFile), rows: 0, used: 0, noAnswers: 0, unreadable: 0, noText: 0, personalDataDropped: 0 }; items.push(...readLeads(leadsFile, t)); }
  if (reviewsFile) { const t = inputs.reviews = { file: path.basename(reviewsFile), items: 0, used: 0, bad: 0, noText: 0, personalDataDropped: 0 }; items.push(...readReviews(reviewsFile, t)); }
  const forums = readStep(ctx, "forums");
  if (forums?.status === "ok") {
    const t = inputs.forums = { questions: 0, used: 0 }, on = dateOr(forums.generatedAt, today());
    for (const q of forums.questions || []) { t.questions++; const text = String(q.question ?? "").trim(); if (!text || hasPlaceholder(text) || hasPersonalData(text) || !/^https?:\/\//i.test(q.url || "")) continue; t.used++; items.push({ text, source: { kind: "forum", ref: q.url, seenAt: on, quote: cutQuote(text) } }); }
  }
  const existing = readStep(ctx, "existing");
  if (existing?.status === "ok") {
    const t = inputs.existing = { questions: 0, used: 0 }, on = dateOr(existing.generatedAt, today());
    for (const q of existing.questions || []) { t.questions++; const text = String(q.question ?? "").trim(); if (!text || hasPlaceholder(text) || hasPersonalData(text) || !q.imported?.file) continue; t.used++; items.push({ text, source: { kind: "existing", ref: `${path.basename(q.imported.file)}:${q.imported.line ?? "?"}`, seenAt: dateOr(q.imported.updated, on), quote: cutQuote(text) } }); }
  }
  if (!items.length) { writeBlocked(priv, "prompt-candidates", UNBLOCK_NONE); throw new Blocked(UNBLOCK_NONE); }
  // near-identical wording (80% of the words, research-lib sameQuery) is ONE prompt with several sources; the longest wording is the draft prompt
  const groups = [];
  for (const it of items) {
    const g = groups.find((x) => sameQuery(x.first, it.text));
    const dup = g?.items.some((x) => x.source.kind === it.source.kind && x.source.ref === it.source.ref && x.source.quote === it.source.quote);
    if (g) { if (!dup) g.items.push(it); } else groups.push({ first: it.text, items: [it] });
  }
  let cands = groups.map((g) => {
    const prompt = cutQuote(g.items.map((x) => x.text).sort((a, b) => b.length - a.length || (a < b ? -1 : 1))[0]);
    return { id: promptId(prompt), prompt, scenario: "", comparison: "", constraint: "", location: "", sources: g.items.map((x) => x.source), fix: null };
  }).sort((a, b) => b.sources.length - a.sources.length || (a.prompt < b.prompt ? -1 : a.prompt > b.prompt ? 1 : 0));
  const truncated = Math.max(0, cands.length - maxCandidates);
  cands = cands.slice(0, maxCandidates);
  return writeStep(priv, "prompt-candidates", { note: "PRIVATE: this folder is git-ignored and holds lead text. Drafts only: scenario, comparison, constraint, location and fix are the session's to fill (stages/research.md, Prompt map). Quotes are the buyers' words, cut to 300 characters; no name, email, phone or id is read into this file. A lead source keeps its quote ONLY here: in prompt-map.json it carries ref and seenAt and no quote. One workspace only: never copy a candidate into another client's map.", inputs, truncated, candidates: cands });
}

function checkMap(ctx, mapFile) {
  if (!fs.existsSync(mapFile)) throw new Blocked(`no ${mapFile}: the session writes it from research/prompt-candidates.json (stages/research.md, Prompt map)`);
  let doc; try { doc = JSON.parse(stripBom(fs.readFileSync(mapFile, "utf8"))); } catch (e) { process.exitCode = 1; return `FAIL PM-SHAPE ${mapFile} is not valid JSON (${e.message})`; }
  const v = validateMap(doc), rows = rowsOf(doc) || [], lines = v.errors.map((e) => `FAIL ${e.rule} ${e.id ?? "-"} ${e.message}`);
  const uf = path.join(ctx.rdir, "prompt-unsourced.json");
  if (fs.existsSync(uf)) {
    let u; try { u = JSON.parse(stripBom(fs.readFileSync(uf, "utf8"))); } catch (e) { u = null; lines.push(`FAIL PM-UNS - ${uf} is not valid JSON (${e.message})`); }
    if (u) for (const e of validateUnsourced(u, rows)) lines.push(`FAIL ${e.rule} ${e.id ?? "-"} ${e.message}`);
  }
  // lead wording: against the lead quotes in <pewp>/private/prompt-candidates.json; never silent when that file is not there
  const pc = J(path.join(ctx.pewp, "private", "prompt-candidates.json")), leadQuotes = pc?.status === "ok" && Array.isArray(pc.candidates) ? leadQuotesOf(pc) : null;
  if (leadQuotes) for (const e of checkLeadWording(rows, leadQuotes)) lines.push(`FAIL ${e.rule} ${e.id} ${e.message}`);
  const note = leadQuotes ? `lead wording checked against ${leadQuotes.length} lead quote(s) (private/prompt-candidates.json)` : "lead wording not checked: no private candidates";
  if (lines.length) { process.exitCode = 1; return `${lines.join("\n")}\nFAIL prompt-map ${lines.length} problem(s) in ${v.rows} row(s) of ${mapFile}\n${note}`; }
  return `PASS prompt-map ${v.rows} row(s) valid (${mapFile})\n${note}`;
}

function fillMapEngines(ctx, mapFile) {
  const b = needBusiness(ctx);
  if (!fs.existsSync(mapFile)) throw new Blocked(`no ${mapFile}: the session writes it from research/prompt-candidates.json (stages/research.md, Prompt map)`);
  let doc; try { doc = JSON.parse(stripBom(fs.readFileSync(mapFile, "utf8"))); } catch (e) { throw new Usage(`${mapFile}: not valid JSON (${e.message})`); }
  const rows = rowsOf(doc);
  if (!rows) throw new Usage(`${mapFile}: a list of rows or an object with a "rows" list`);
  const capDir = path.join(ctx.pewp, "captures", "ai");
  const captures = fs.existsSync(capDir) ? fs.readdirSync(capDir).filter((f) => /\.json$/i.test(f)).sort().map((f) => ({ file: f, doc: J(path.join(capDir, f)) })).filter((c) => c.doc) : [];
  const ai = readStep(ctx, "ai-citations");
  const obs = observationsFrom({ aiRows: ai?.status === "ok" ? ai.rows || [] : [], captures, domain: b.domain, name: b.name });
  const r = fillEngines(rows, obs);
  W(mapFile, doc);
  return `OK engines: ${rows.length} row(s) (chatgpt ${r.tally.chatgpt}, perplexity ${r.tally.perplexity}, gemini ${r.tally.gemini} filled from ${obs.length} observation(s); ${r.unmatched} matched no row: engines only match by prompt id or the exact prompt text) -> ${mapFile}`;
}

await runCli(import.meta.url, "node research-prompts.mjs <target> [--leads FILE.csv] [--reviews FILE.json] [--max-candidates 200] | --check [--map FILE] | --engines [--map FILE] [--cwd DIR]", ["check", "engines"], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const mapFile = a.get("map") || path.join(ctx.rdir, "prompt-map.json");
  if (a.has("check")) return checkMap(ctx, mapFile);
  if (a.has("engines")) return fillMapEngines(ctx, mapFile);
  const r = buildCandidates(ctx, { leadsFile: a.get("leads"), reviewsFile: a.get("reviews"), maxCandidates: a.num("max-candidates", 200, { min: 1, int: true }) });
  const i = r.inputs;
  return `OK prompt-candidates: ${r.candidates.length} candidate(s)${r.truncated ? ` (+${r.truncated} past --max-candidates, not written)` : ""}; leads ${i.leads ? `${i.leads.used} of ${i.leads.rows} rows used, ${i.leads.personalDataDropped} dropped for personal data` : "not given"}; reviews ${i.reviews ? `${i.reviews.used} of ${i.reviews.items}` : "not given"}; forums ${i.forums ? i.forums.used : "none"}; existing ${i.existing ? i.existing.used : "none"} -> ${path.join(ctx.pewp, "private", "prompt-candidates.json")} (git-ignored)`;
});
