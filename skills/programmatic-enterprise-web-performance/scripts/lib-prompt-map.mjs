// The prompt map (DECISIONS 35): the row, its validator, and the pure helpers the research step, the planner and the measure stage share.
// A prompt is a whole situation a buyer types into an AI engine (scenario + comparison + constraint). A row without a source is not a row,
// a row's parts are never empty, its fix is exactly one of three kinds, and personal data never enters the map. Schema: schemas/prompt-map.md.
// Node built-ins only (no network, no model API), so plan-site.mjs and measure.mjs can import it without pulling in the research steps.
import crypto from "node:crypto";

export const QUOTE_MAX = 300;
export const MIN_WORDS = 4; // a lead answer shorter than this is a pick-list value ("Buying a home"), not the buyer's words
export const ENGINES = ["chatgpt", "perplexity", "gemini"];
export const FIX_KINDS = ["new-page", "improve-page", "earn-mention"];
export const SOURCE_KINDS = ["lead", "review", "forum", "existing", "owner"];
export const NEW_PAGE_TYPES = ["situation", "comparison"];

export const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
export const promptId = (prompt) => "pm-" + crypto.createHash("sha256").update(String(prompt)).digest("hex").slice(0, 8);
export const cutQuote = (s) => squash(s).slice(0, QUOTE_MAX).trim();
// (5b: "2026-13-45" is an Invalid Date, whose toISOString() throws; it is not a date, so the answer is false, not a crash)
export const isIsoDate = (s) => { if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
const nonEmpty = (s) => typeof s === "string" && squash(s) !== "";

// ---- personal data: an email address or a phone number never goes into a quote or a prompt ----
export const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
// US-formatted numbers, 10 or more digits in a row, and international numbers with a plus. A year range ("2005-2015") is not a phone number.
export const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}|\b\d{10,}\b|\+\d[\d\s().-]{8,}\d/;
export const hasPersonalData = (s) => EMAIL_RE.test(String(s ?? "")) || PHONE_RE.test(String(s ?? ""));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Who a lead is, read from the export's own columns for ONE comparison and never written anywhere: a free-text answer that names the person
// ("Hi, I'm Priya") is dropped whole. A first name that is also a city is a false positive we accept: dropping a quote costs less than a leak.
export function personOf(row) {
  const names = squash(row.name).toLowerCase().split(/[^a-zÀ-ɏ]+/i).filter((t) => t.length >= 3);
  const email = squash(row.email).toLowerCase(), digits = String(row.phone ?? "").replace(/\D/g, "");
  return { names: names.map((t) => new RegExp(`(^|[^a-z])${esc(t)}([^a-z]|$)`, "i")), email: email || null, digits: digits.length >= 7 ? digits.slice(-7) : null };
}
export function namesPerson(text, p) {
  const t = String(text ?? "");
  return p.names.some((re) => re.test(t)) || (p.email && t.toLowerCase().includes(p.email)) || (p.digits && t.replace(/\D/g, "").includes(p.digits));
}

// ---- CSV (RFC 4180: quoted cells, "" inside quotes, line breaks inside quotes) ----
export function parseCsv(text) {
  const t = String(text).replace(/^﻿/, ""), rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ---- the free text of a lead's `answers` cell: string values of any key that is not about a person ----
const PERSON_KEY = /name|e-?mail|phone|mobile|\bcell\b|\btel\b|fax|address|street|\bzip|postal|ssn|birth|\bdob\b|token|password|(^|[_\s-])ip($|[_\s-])|(^|[_\s-])id$|[a-z]Id$|uuid/i;
export function freeTexts(answers, depth = 0, out = []) {
  if (typeof answers === "string") { const s = squash(answers); if (s.split(" ").length >= MIN_WORDS) out.push(s); }
  else if (Array.isArray(answers)) { if (depth < 3) for (const x of answers) freeTexts(x, depth + 1, out); }
  else if (isObj(answers)) { if (depth < 3) for (const [k, v] of Object.entries(answers)) if (!PERSON_KEY.test(k)) freeTexts(v, depth + 1, out); }
  return out;
}

// ---- validation ----
const err = (rule, message) => ({ rule, message });
export function validateFix(fix) {
  const e = [];
  if (!isObj(fix)) return [err("PM-FIX", "fix must be ONE object { kind, target, note }, not a list and not missing")];
  if (typeof fix.kind !== "string" || !FIX_KINDS.includes(fix.kind)) { e.push(err("PM-FIX", `fix.kind must be exactly one of ${FIX_KINDS.join(", ")} (got ${JSON.stringify(fix.kind)})`)); return e; }
  if (!nonEmpty(fix.target)) e.push(err("PM-FIX", "fix.target is empty"));
  else if (fix.kind === "new-page" && fix.target !== "new") e.push(err("PM-FIX", `a new-page fix has target "new" (got ${JSON.stringify(fix.target)})`));
  else if (fix.kind === "improve-page" && !/^\//.test(fix.target)) e.push(err("PM-FIX", `an improve-page fix names the page's path, starting with "/" (got ${JSON.stringify(fix.target)})`));
  else if (fix.kind === "earn-mention" && fix.target !== "new" && !/^\//.test(fix.target)) e.push(err("PM-FIX", `an earn-mention fix has target "new" or a page path (got ${JSON.stringify(fix.target)})`));
  if (fix.kind === "new-page" && !NEW_PAGE_TYPES.includes(fix.pageType)) e.push(err("PM-FIX", `a new-page fix needs pageType ${NEW_PAGE_TYPES.join(" or ")} (got ${JSON.stringify(fix.pageType)})`));
  if (fix.pageType !== undefined && !nonEmpty(fix.pageType)) e.push(err("PM-FIX", "fix.pageType is empty"));
  if (!nonEmpty(fix.note)) e.push(err("PM-FIX", "fix.note is empty: say why this fix answers the prompt"));
  return e;
}
export function validateEngines(engines, today) {
  const e = [];
  if (!isObj(engines)) return [err("PM-ENG", "engines must be an object keyed by engine")];
  for (const [name, v] of Object.entries(engines)) {
    if (!ENGINES.includes(name)) { e.push(err("PM-ENG", `unknown engine "${name}" (known: ${ENGINES.join(", ")})`)); continue; }
    if (!isObj(v)) { e.push(err("PM-ENG", `engines.${name} must be an object`)); continue; }
    for (const k of ["named", "cited"]) if (v[k] !== null && typeof v[k] !== "boolean") e.push(err("PM-ENG", `engines.${name}.${k} is true, false or null (null = not checked), got ${JSON.stringify(v[k])}`));
    for (const k of ["pageCited", "source"]) if (v[k] !== null && !nonEmpty(v[k])) e.push(err("PM-ENG", `engines.${name}.${k} is a string or null`));
    if (v.at !== null && !(isIsoDate(v.at) && v.at <= today)) e.push(err("PM-ENG", `engines.${name}.at is a date (YYYY-MM-DD, not in the future) or null`));
    if ((v.named === true || v.named === false || v.cited === true || v.cited === false) && (v.at == null || v.source == null)) e.push(err("PM-ENG", `engines.${name} holds an observed value with no date or no source: an unsourced value is a guess, use null`));
    if (v.pageCited != null && v.cited !== true) e.push(err("PM-ENG", `engines.${name}.pageCited is set but cited is not true`));
  }
  return e;
}
export function validateRow(row, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const e = [];
  if (!isObj(row)) return [err("PM-SHAPE", "a row is an object")];
  if (!nonEmpty(row.prompt)) e.push(err("PM-PROMPT", "prompt is empty: the row is the buyer's whole sentence"));
  else {
    if (/[{}]/.test(row.prompt)) e.push(err("PM-PROMPT", "prompt holds an unfilled { } placeholder"));
    if (hasPersonalData(row.prompt)) e.push(err("PM-PII", "prompt holds an email address or a phone number: personal data never enters the map"));
    if (row.id !== promptId(row.prompt)) e.push(err("PM-ID", `id ${JSON.stringify(row.id)} is not pm-<8 hex of sha256(prompt)>: expected ${promptId(row.prompt)}`));
  }
  for (const k of ["scenario", "comparison", "constraint"]) if (!nonEmpty(row[k])) e.push(err("PM-PARTS", `${k} is empty: split the buyer's words into scenario, comparison and constraint (a prompt that has no ${k} is not a prompt-map row)`));
  if (typeof row.location !== "string") e.push(err("PM-PARTS", "location must be a string (empty when the buyer names no place)"));
  const src = row.sources;
  if (!Array.isArray(src) || !src.length) e.push(err("PM-SRC", "no source: a row without at least one source is not a row, move it to research/prompt-unsourced.json"));
  else src.forEach((s, i) => {
    const at = `sources[${i}]`;
    if (!isObj(s)) { e.push(err("PM-SRC", `${at} must be an object`)); return; }
    if (!SOURCE_KINDS.includes(s.kind)) e.push(err("PM-SRC", `${at}.kind must be one of ${SOURCE_KINDS.join(", ")} (got ${JSON.stringify(s.kind)})`));
    if (!nonEmpty(s.ref)) e.push(err("PM-SRC", `${at}.ref is empty: name the file:row, url or capture file`));
    if (!(isIsoDate(s.seenAt) && s.seenAt <= today)) e.push(err("PM-SRC", `${at}.seenAt must be a date (YYYY-MM-DD, not in the future), got ${JSON.stringify(s.seenAt)}`));
    if (s.kind === "lead") { if (s.quote !== undefined) e.push(err("PM-SRC", `${at} is a lead source and carries a quote: lead text never reaches a file a repo target commits, so a lead source has ref and seenAt only`)); }
    else if (!nonEmpty(s.quote)) e.push(err("PM-SRC", `${at}.quote is empty`));
    else {
      if (s.quote.length > QUOTE_MAX) e.push(err("PM-QUOTE", `${at}.quote is ${s.quote.length} characters; the buyer's words are cut to ${QUOTE_MAX}`));
      if (hasPersonalData(s.quote)) e.push(err("PM-PII", `${at}.quote holds an email address or a phone number: personal data never enters the map`));
    }
  });
  if (row.engines !== undefined) e.push(...validateEngines(row.engines, today));
  e.push(...validateFix(row.fix));
  return e;
}
export function rowsOf(doc) { return Array.isArray(doc) ? doc : Array.isArray(doc?.rows) ? doc.rows : null; }
export function validateMap(doc, opts = {}) {
  const rows = rowsOf(doc);
  if (!rows) return { ok: false, rows: 0, errors: [{ id: null, rule: "PM-SHAPE", message: "prompt-map.json is a list of rows or an object with a \"rows\" list" }] };
  const errors = [], ids = new Map(), prompts = new Map();
  rows.forEach((r, i) => {
    const id = isObj(r) && r.id ? r.id : `#${i + 1}`;
    for (const x of validateRow(r, opts)) errors.push({ id, ...x });
    if (isObj(r)) {
      if (r.id && ids.has(r.id)) errors.push({ id, rule: "PM-DUP", message: `id ${r.id} appears twice (rows ${ids.get(r.id)} and ${i + 1})` }); else ids.set(r.id, i + 1);
      const p = squash(r.prompt).toLowerCase();
      if (p && prompts.has(p)) errors.push({ id, rule: "PM-DUP", message: `the same prompt appears twice (rows ${prompts.get(p)} and ${i + 1})` }); else if (p) prompts.set(p, i + 1);
    }
  });
  return { ok: !errors.length, rows: rows.length, errors };
}
// Lead wording must not be copied into the map: a row's prompt and parts are committed, the lead's text is not. A row whose prompt, scenario, comparison or
// constraint holds LEAD_RUN or more consecutive words of any lead quote (lower case, punctuation stripped) is refused. The refusal names the row id, the field
// and the quote's ref, never the lead's words.
export const LEAD_RUN = 8;
export const LEAD_FIELDS = ["prompt", "scenario", "comparison", "constraint"];
export const wordsOf = (s) => String(s ?? "").toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
const grams = (words) => { const g = []; for (let i = 0; i + LEAD_RUN <= words.length; i++) g.push(words.slice(i, i + LEAD_RUN).join(" ")); return g; };
// the lead quotes of research/private/prompt-candidates.json as [{ ref, grams: Set }]
export function leadQuotesOf(candidatesDoc) {
  const out = [];
  for (const c of candidatesDoc?.candidates || []) for (const s of c?.sources || []) if (s?.kind === "lead" && typeof s.quote === "string") out.push({ ref: String(s.ref ?? "?"), grams: new Set(grams(wordsOf(s.quote))) });
  return out;
}
export function checkLeadWording(rows, leadQuotes) {
  const errors = [];
  rows.forEach((r, i) => {
    if (!isObj(r)) return;
    const id = r.id ? r.id : `#${i + 1}`;
    for (const f of LEAD_FIELDS) {
      const g = grams(wordsOf(r[f]));
      const refs = [...new Set(leadQuotes.filter((q) => g.some((x) => q.grams.has(x))).map((q) => q.ref))].sort();
      if (refs.length) errors.push({ id, rule: "PM-LEAD", message: `${f} repeats ${LEAD_RUN} or more consecutive words of a lead quote (${refs.join(", ")}): reword it in the buyer's terms, never copy a lead's sentence` });
    }
  });
  return errors;
}
// research/prompt-unsourced.json: what the session found with no source. Never a row; it must not also sit in the map.
export function validateUnsourced(doc, mapRows = []) {
  const list = rowsOf(doc), errors = [];
  if (!list) return [{ id: null, rule: "PM-UNS", message: "prompt-unsourced.json is a list or an object with a \"rows\" list" }];
  const inMap = new Set(mapRows.map((r) => r?.id));
  list.forEach((r, i) => {
    const id = isObj(r) && nonEmpty(r.prompt) ? promptId(r.prompt) : `#${i + 1}`;
    if (!isObj(r) || !nonEmpty(r.prompt)) errors.push({ id, rule: "PM-UNS", message: "an unsourced entry needs a prompt" });
    else if (!nonEmpty(r.why)) errors.push({ id, rule: "PM-UNS", message: "an unsourced entry says why it has no source (why)" });
    else if (inMap.has(id)) errors.push({ id, rule: "PM-UNS", message: "this prompt is in prompt-map.json too: a row is either sourced (map) or not (this file)" });
    if (isObj(r) && Array.isArray(r.sources) && r.sources.length) errors.push({ id, rule: "PM-UNS", message: "it carries a source, so it belongs in prompt-map.json, not here" });
  });
  return errors;
}

// ---- engines: what an AI engine said about a prompt, from files that already exist (never from a call made here) ----
export const normEngine = (e) => { const s = String(e || "").toLowerCase(); return s === "gemini-grounded" || s === "gemini" ? "gemini" : ENGINES.includes(s) ? s : null; };
const domainOfUrl = (u) => { try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
export const hitsDomain = (domain, own) => !!domain && !!own && (domain === own || domain.endsWith("." + own));
// One observation per ai-citations row (engine, prompt text, named?, cited?) or per owner capture file (adds the cited page of ours).
export function observationsFrom({ aiRows = [], captures = [], domain, name }) {
  const own = domainOfUrl(domain), nameRe = name ? new RegExp(esc(String(name)), "i") : null, out = [];
  for (const r of aiRows) {
    const engine = normEngine(r?.engine), dates = (r?.dates || []).filter(isIsoDate).sort(), at = dates.at(-1);
    if (!engine || !at) continue;
    const share = r.ourNameMentionedShare?.value;
    out.push({ engine, promptId: r.promptId || null, keys: [r.prompt, r.question], named: typeof share === "number" ? share > 0 : null, cited: typeof r.ourDomainCited === "boolean" ? r.ourDomainCited : null, pageCited: null, at, source: "research/ai-citations.json", capture: false });
  }
  for (const { file, doc: c } of captures) {
    const engine = normEngine(c?.engine), at = String(c?.capturedAt || "").slice(0, 10);
    if (!engine || !isIsoDate(at)) continue;
    const srcs = Array.isArray(c.citedDomains) ? c.citedDomains : Array.isArray(c.sources) ? c.sources : null;
    const items = srcs ? srcs.map((s) => (typeof s === "string" ? s : s?.url || s?.domain || "")).filter(Boolean) : null;
    const cited = items ? items.some((s) => hitsDomain(domainOfUrl(s), own)) : null;
    const page = items ? items.find((s) => /^https?:\/\//i.test(s) && hitsDomain(domainOfUrl(s), own)) || null : null;
    out.push({ engine, promptId: c.promptId || null, keys: [c.prompt, c.question], named: nameRe && typeof c.answer === "string" ? nameRe.test(c.answer) : null, cited, pageCited: cited ? page : null, at, source: `captures/ai/${file}`, capture: true });
  }
  return out;
}
const nullEngine = () => ({ named: null, cited: null, pageCited: null, at: null, source: null });
const anyOf = (list, k) => (list.some((o) => o[k] === true) ? true : list.some((o) => o[k] === false) ? false : null);
// Fills rows[].engines in place (only that key). An engine with no matching observation keeps what the row already held; else it is all null.
export function fillEngines(rows, obs) {
  const matched = new Set(), tally = Object.fromEntries(ENGINES.map((e) => [e, 0]));
  for (const row of rows) {
    if (!isObj(row) || !nonEmpty(row.prompt)) continue;
    const mine = obs.filter((o) => o.promptId === row.id || o.keys.some((k) => nonEmpty(k) && squash(k) === squash(row.prompt)));
    mine.forEach((o) => matched.add(o));
    const prev = isObj(row.engines) ? row.engines : {}, next = {};
    for (const e of ENGINES) {
      const list = mine.filter((o) => o.engine === e).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) || Number(b.capture) - Number(a.capture));
      if (!list.length) { next[e] = isObj(prev[e]) ? prev[e] : nullEngine(); continue; }
      next[e] = { named: anyOf(list, "named"), cited: anyOf(list, "cited"), pageCited: list.find((o) => o.pageCited)?.pageCited || null, at: list[0].at, source: list[0].source };
      tally[e]++;
    }
    row.engines = next;
  }
  return { tally, unmatched: obs.filter((o) => !matched.has(o)).length };
}
