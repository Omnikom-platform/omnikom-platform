// Shared text rules for the plan stage and the S5 target gate, so both measure "carries the query" the same way.
// Query match = token overlap: lowercase, strip accents and punctuation, drop stop words, stem simply, then the share of the
// QUERY's tokens found in the text (>= 0.80 passes). Deterministic, no network, no model.
export const THRESHOLD = 0.8;
export const STOP = new Set(("a an the in on at of to for and or but with by from as is are was were be been am do does did how what why when where which who whom " +
  "can could should would will shall we you your yours our ours us my me i it its this that these those near about into over than then so if much many").split(/\s+/));

export function stem(w) {
  if (w.length <= 3 || /^\d+$/.test(w)) return w;
  if (/ies$/.test(w) && w.length > 4) w = w.slice(0, -3) + "y";
  else if (/sses$/.test(w)) w = w.slice(0, -2);
  else if (/(ches|shes|xes|zes)$/.test(w)) w = w.slice(0, -2);
  else if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 5 && /ing$/.test(w)) { w = w.slice(0, -3); if (/([^aeioulsz])\1$/.test(w)) w = w.slice(0, -1); }
  else if (w.length > 4 && /ed$/.test(w)) { w = w.slice(0, -2); if (/([^aeioulsz])\1$/.test(w)) w = w.slice(0, -1); }
  if (w.length > 3 && /e$/.test(w)) w = w.slice(0, -1);
  return w;
}
export function tokens(s) {
  return String(s ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, " ")
    .split(" ").filter((t) => t && !STOP.has(t)).map(stem);
}
export const tokenSet = (s) => new Set(tokens(s));
// Share of the query's distinct tokens that appear in the text (a string, an array of tokens, or a Set).
export function overlap(query, text) {
  const q = new Set(tokens(query));
  if (!q.size) return 0;
  const t = text instanceof Set ? text : new Set(Array.isArray(text) ? text : tokens(text));
  let hit = 0;
  for (const x of q) if (t.has(x)) hit++;
  return hit / q.size;
}
export const missing = (query, text) => { const t = new Set(tokens(text)); return [...new Set(tokens(query))].filter((x) => !t.has(x)); };
// The phrase's tokens occur next to each other (in order) in the token list.
export function seqContains(list, phrase) {
  const p = tokens(phrase);
  if (!p.length) return true;
  outer: for (let i = 0; i + p.length <= list.length; i++) { for (let j = 0; j < p.length; j++) if (list[i + j] !== p[j]) continue outer; return true; }
  return false;
}
// A question is shown by a SHORT block (heading, summary, label) that carries >= 80% of its tokens; the paragraph that answers it
// repeats its words too, so blocks much longer than the question do not count.
export function showsQuestion(question, blockSets) {
  const n = new Set(tokens(question)).size;
  return blockSets.some((t) => t.size <= n * 2 + 4 && overlap(question, t) >= THRESHOLD);
}
export const words = (s) => String(s ?? "").match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu) || [];
export const GENERIC_ANCHORS = new Set(["click here", "click", "here", "read more", "learn more", "more", "see more", "this page", "this link", "link", "read", "continue", "continue reading", "details", "info", "go", "view", "visit"]);
export const isGenericAnchor = (a) => { const t = String(a ?? "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim(); return !t || GENERIC_ANCHORS.has(t); };
export const slugify = (s) => String(s).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const titleCase = (s) => String(s).replace(/\b([a-z])([a-z']*)/g, (m, a, b) => (["in", "of", "the", "a", "an", "and", "or", "to", "for", "vs"].includes(m) ? m : a.toUpperCase() + b));
export function shingles(wordList, n = 5) { const out = []; for (let i = 0; i + n <= wordList.length; i++) out.push(wordList.slice(i, i + n).join(" ")); return out; }

// ====================================================================================================================================
// Spec-aligned text rules (shipgate web-delivery section 12 "head term", 06-growth 9.5 "terms"). Added 2026-10-22.
// The 80%-overlap helpers above stay for the plan-stage checks that were built on them (GT-001, GT-004, GT-006 ...); everything the
// growth algorithms (9.1 clusters, 9.2 intent, 9.3 page type, 9.5 terms, 9.7 page-cluster match) need is below and follows the spec.
// ====================================================================================================================================
import { loadRule, localeEntry, RuleMissing, rulesDir } from "./lib-rules.mjs";
import { stemFor } from "./lib-snowball.mjs";
import fs from "node:fs";
import path from "node:path";

// Words, UAX #29 (NFKC, lowercased). Letters/digits with an inner apostrophe or full stop between letters (don't, u.s) stay one word.
// Scripts written without spaces (Han, Kana, Thai) go through Intl.Segmenter, which implements UAX #29 word boundaries.
const WORD_RE = /[\p{L}\p{N}\p{M}]+(?:['\u2019.][\p{L}\p{N}\p{M}]+)*/gu;
const NO_SPACE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;
let SEG = null;
export function uaxWords(text) {
  const t = String(text ?? "").normalize("NFKC").toLowerCase();
  if (NO_SPACE.test(t)) { SEG ||= new Intl.Segmenter("und", { granularity: "word" }); return [...SEG.segment(t)].filter((x) => x.isWordLike).map((x) => x.segment); }
  return t.match(WORD_RE) || [];
}
export class LocaleMissing extends RuleMissing {}
export function stopWordsFor(locale) {
  const e = localeEntry(loadRule("stop-words.json"), locale);
  if (!e) throw new LocaleMissing(`ruleset stop-words.json has no entry for locale "${locale}" (shipgate 04 section 15: no silent en fallback); add the locale's list to rules/stop-words.json`);
  return new Set(e.value.map((w) => String(w).normalize("NFKC").toLowerCase()));
}
export function stemmerFor(locale) {
  const s = stemFor(locale);
  if (!s.ok) throw new LocaleMissing(s.why);
  return s.stem;
}

// Place names of the gazetteer of one country (or of every shipped gazetteer when country is null), as a Set of normalised word strings.
// RULESET DEVIATION (recorded in rules/README.md): shipgate's gazetteer is GeoNames cities1000 as is. Taken literally it makes "home", "price",
// "top", "and" and about 1,500 airport-style codes (ABE, ART, ACT) place names, so "home value" would be a local query and "home price" would have
// no head term. The effective gazetteer therefore drops (a) entries written in capitals of 2-4 letters (codes, not names), (b) single-word names
// that are stop words of the locale or words of an intent modifier, (c) the single words listed in rules/gazetteer-exceptions.json.
// PEWP_GAZETTEER_LITERAL=1 switches all three off (the spec-literal gazetteer; the tests run both).
const GAZ = new Map();
export function gazetteer(country, { locale = "en-US" } = {}) {
  const literal = process.env.PEWP_GAZETTEER_LITERAL === "1";
  const key = `${country ? String(country).toLowerCase() : "*"}|${literal ? "literal" : locale}|${rulesDir()}`;
  if (GAZ.has(key)) return GAZ.get(key);
  const dir = path.join(rulesDir(), "gazetteer");
  const files = country ? [`${String(country).toLowerCase()}.json`] : fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  const skip = new Set();
  if (!literal) {
    try { for (const w of stopWordsFor(locale)) skip.add(w); } catch {}
    try { const im = localeEntry(loadRule("intent-modifiers.json"), locale); for (const list of Object.values(im?.value || {})) for (const m of list) for (const w of uaxWords(m.term)) skip.add(w); } catch {}
    try { for (const w of loadRule("gazetteer-exceptions.json").words || []) skip.add(String(w).normalize("NFKC").toLowerCase()); } catch {}
  }
  const set = new Set(); let max = 1, found = 0;
  for (const f of files) {
    let list; try { list = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    found++;
    for (const name of list) {
      if (!literal && /^[A-Z]{2,4}$/.test(name)) continue;
      const w = uaxWords(name);
      if (!w.length || (!literal && w.length === 1 && skip.has(w[0]))) continue;
      set.add(w.join(" ")); if (w.length > max) max = w.length;
    }
  }
  if (!found) throw new RuleMissing(`no gazetteer for country "${country || "any"}" in rules/gazetteer/ (only the countries copied from shipgate are shipped; see rules/README.md)`);
  const g = { set, max };
  GAZ.set(key, g);
  return g;
}
// Longest-match place scan over a word list (as 04 section 15 swap similarity): { rest: words outside any place name, places: [matched names] }.
export function scanPlaces(wordList, gaz) {
  const rest = [], places = [];
  for (let i = 0; i < wordList.length;) {
    let hit = 0;
    for (let n = Math.min(gaz.max, wordList.length - i); n >= 1; n--) if (gaz.set.has(wordList.slice(i, i + n).join(" "))) { hit = n; break; }
    if (hit) { places.push(wordList.slice(i, i + hit).join(" ")); i += hit; } else rest.push(wordList[i++]);
  }
  return { rest, places };
}
export const removePlaces = (wordList, gaz) => scanPlaces(wordList, gaz).rest;

// Head term of a query (web-delivery section 12): the query's words minus the locale's stop words and minus gazetteer place names (longest
// match), each Snowball-stemmed. An empty head term falls back to the query's full stemmed word list. locale "en-US" -> stop words "en-US" else "en",
// gazetteer "us" (the region of the locale; no region = every gazetteer). Returns { words: [stem], fallback: bool }.
export function headTerm(query, { locale = "en-US", country } = {}) {
  const stem = stemmerFor(locale), stop = stopWordsFor(locale);
  const region = country ?? (String(locale).split(/[-_]/)[1] || null);
  const all = uaxWords(query);
  const noPlaces = removePlaces(all, gazetteer(region, { locale }));
  const words = noPlaces.filter((w) => !stop.has(w)).map(stem);
  if (words.length) return { words: [...new Set(words)], fallback: false };
  return { words: [...new Set(all.map(stem))], fallback: true };
}
// A text contains the head term when its stemmed words (same normalisation) include all of the head term's words.
export function containsHeadTerm(text, head, { locale = "en-US" } = {}) {
  if (!head.words.length) return false;
  const stem = stemmerFor(locale), have = new Set(uaxWords(text).map(stem));
  return head.words.every((w) => have.has(w));
}
// Stemmed words of a text, whole words, as a Set (used for "contains one of the cluster's queries" and similar).
export const stemSet = (text, locale = "en-US") => { const stem = stemmerFor(locale); return new Set(uaxWords(text).map(stem)); };

// ---- 9.5 terms ----
// The 1- to 3-word n-grams of each text unit (a heading, a list item, a <strong> text), UAX #29 words, NFKC, lowercased, stop words removed
// first (so "bank of america" yields the bigram "bank america": the spec does not say; see the build report). Not stemmed.
export function termsOf(units, { locale = "en-US" } = {}) {
  const stop = stopWordsFor(locale), out = new Set();
  for (const u of units) {
    const w = uaxWords(u).filter((x) => !stop.has(x));
    for (let n = 1; n <= 3; n++) for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  }
  return out;
}
// pages: [{ headings:[], listItems:[], strong:[] }] (the top 3 winners). Required = on >= 2 of the pages. Sorted by pages desc, then code point.
export function requiredTerms(pages, { locale = "en-US", minPages = 2 } = {}) {
  const count = new Map();
  for (const p of pages) for (const t of termsOf([...(p.headings || []), ...(p.listItems || []), ...(p.strong || [])], { locale })) count.set(t, (count.get(t) || 0) + 1);
  return [...count].filter(([, n]) => n >= minPages).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([t]) => t);
}
// A page covers a term when it appears in the main content (the words, stop words removed, as a run of adjacent words).
export function coversTerm(mainText, term, { locale = "en-US" } = {}) {
  const stop = stopWordsFor(locale), w = uaxWords(mainText).filter((x) => !stop.has(x)), t = uaxWords(term);
  if (!t.length) return true;
  outer: for (let i = 0; i + t.length <= w.length; i++) { for (let j = 0; j < t.length; j++) if (w[i + j] !== t[j]) continue outer; return true; }
  return false;
}
