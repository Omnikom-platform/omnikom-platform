// CRM column mapper: maps the Omnikom CRM's lead fields to a client's own CRM sheet layout and back.
// Algorithm: docs/blueprint/17-EXPANSION-MAP.md section 3.3. Lead fields: 13-DATA-MODEL.md section 6.
// Pure functions. No dependencies, no network, and nothing from Node (no fs, process, fetch): it runs unchanged in a
// browser and in Node 20+. The only import is the data file next to it.
//
// A template is { columns: [{ header, field, transform? }], value_maps: { field: { ours: theirs } } }, the shape of
// crm_templates.columns / .value_maps. `field` is one of our fields, with dots for answers.* ("answers.address").
// transform is one of: first | last (split our name), street | city | state | postal_code | zip (split our address),
// e164 | us (phone), iso | us | eu (date). "us" means (xxx) xxx-xxxx on a phone field and MM/DD/YYYY on a date field.
// A value map may also be keyed "field@Header" to apply to one column only (the more specific key wins).
// A field name may not be any Object.prototype name (toString, valueOf, __proto__ ...) or "prototype": see UNSAFE_KEYS.
import { FIELDS, ABBREVIATIONS, WHOLE_HEADER, PART_TOKENS, DISQUALIFIERS, PARTS, LEAD_FIELDS } from './dictionary.mjs';

export { LEAD_FIELDS };

const MIN_SCORE = 0.5;      // a pair under this is never assigned
const TYPE_PENALTY = 0.6;   // taken off when the sample values look like the wrong type
const TYPE_SHARE = 0.6;     // share of sample values that must look alike before the type counts
const EDIT_GATE = 0.8;     // an edit-distance ratio under this counts as no match
const EDIT_CAP = 0.9;       // a fuzzy match never reaches the 1.0 of an exact synonym
const SHORT_HEADER = 12;    // edit distance is only tried on normalised headers shorter than this

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const PART_SET = new Set(PART_TOKENS);
const DQ_SET = new Set(DISQUALIFIERS);
const round3 = x => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------- normalise

// "E-mail", " Phone  Number " -> tokens joined by single spaces, abbreviations expanded: "email", "phone".
export function normaliseHeader(h) {
  if (h === null || h === undefined) return '';
  const raw = String(h).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const whole = raw.join('');
  if (has(WHOLE_HEADER, whole)) return WHOLE_HEADER[whole];
  const out = [];
  for (let i = 0; i < raw.length;) {
    let used = 1;
    let expansion = raw[i];
    for (let n = Math.min(3, raw.length - i); n >= 1; n--) {
      const glued = raw.slice(i, i + n).join('');
      if (has(ABBREVIATIONS, glued)) { expansion = ABBREVIATIONS[glued]; used = n; break; }
    }
    out.push(...expansion.split(' '));
    i += used;
  }
  return [...new Set(out)].join(' ');
}

// ---------------------------------------------------------------- score

const synCache = new Map();
function synonymsOf(field) {
  if (synCache.has(field)) return synCache.get(field);
  const def = has(FIELDS, field) ? FIELDS[field] : null;
  const names = [...(def ? def.synonyms : []), String(field).split('.').pop().replace(/_/g, ' ')];
  const list = [...new Set(names.map(normaliseHeader).filter(Boolean))];
  // list[i] is the synonym of rank i: the order the dictionary lists them in (after normalising and dropping repeats)
  const entry = { list, tokens: list.map(s => s.split(' ')), glued: list.map(s => s.replace(/ /g, '')), accepts: def ? def.accepts : null };
  synCache.set(field, entry);
  return entry;
}

const partsOf = tokens => tokens.filter(t => PART_SET.has(t)).sort().join(',');
// Could this header be about the same thing as this synonym? Same part words, and no "company"-like word it lacks.
function compatible(headerTokens, synTokens) {
  if (partsOf(headerTokens) !== partsOf(synTokens)) return false;
  return !headerTokens.some(t => DQ_SET.has(t) && !synTokens.includes(t));
}

function jaccard(a, b) {
  const sa = new Set(a), sb = new Set(b);
  let both = 0;
  for (const t of sa) if (sb.has(t)) both++;
  const all = sa.size + sb.size - both;
  return all === 0 ? 0 : both / all;
}

// Optimal string alignment distance (insert, delete, substitute, swap two neighbours).
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_PHONE = /^\+?[\d\s().-]+$/;
const RE_NUMBER = /^[$€£]?\s*-?\d[\d,]*(?:\.\d+)?\s*[kKmM]?$/;
const RE_DATES = [
  /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/,
  /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}(?:[ T,].*)?$/,
  /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4}/i,
];
function looksLike(v) {
  if (RE_EMAIL.test(v)) return 'email';
  if (RE_DATES.some(r => r.test(v))) return 'date';
  if (RE_PHONE.test(v)) {
    const digits = v.replace(/\D/g, '').length;
    if (digits >= 10 && digits <= 15) return 'phone';
  }
  if (RE_NUMBER.test(v)) return 'number';
  return 'text';
}
// The type most of the sample values look like, or null when blank or mixed.
function sampleType(values) {
  const vals = values.map(x => (x === null || x === undefined ? '' : String(x).trim())).filter(Boolean);
  if (!vals.length) return null;
  const counts = {};
  for (const v of vals) { const t = looksLike(v); counts[t] = (counts[t] || 0) + 1; }
  for (const t of Object.keys(counts)) if (counts[t] / vals.length >= TYPE_SHARE) return t;
  return null;
}

const NONE = { score: 0, rank: Infinity };

// One header against one field: { score 0..1, rank }. rank is the position, in the dictionary's synonym list for the
// field, of the synonym that gave the score (the first one on a tie); it only settles ties between equal scores.
function scoreOne(ourField, theirHeader, sampleValues) {
  const nh = normaliseHeader(theirHeader);
  if (!nh) return NONE;
  const syn = synonymsOf(ourField);
  const ht = nh.split(' ');
  let base = 0, rank = Infinity;
  const at = syn.glued.indexOf(nh.replace(/ /g, ''));
  if (at >= 0) {
    base = 1; rank = at;
  } else {
    let best = 0, bestAt = Infinity;
    syn.tokens.forEach((st, i) => { if (compatible(ht, st)) { const j = jaccard(ht, st); if (j > best) { best = j; bestAt = i; } } });
    if (best > 0) {
      base = best; rank = bestAt;
    } else if (nh.length < SHORT_HEADER) {
      const gh = nh.replace(/ /g, '');
      syn.list.forEach((s, i) => {
        if (!compatible(ht, syn.tokens[i])) return;
        const gs = s.replace(/ /g, '');
        const ratio = 1 - editDistance(gh, gs) / Math.max(gh.length, gs.length);
        if (ratio >= EDIT_GATE) { const capped = Math.min(ratio, EDIT_CAP); if (capped > base) { base = capped; rank = i; } }
      });
    }
  }
  if (base > 0 && Array.isArray(sampleValues) && sampleValues.length && syn.accepts) {
    const t = sampleType(sampleValues);
    if (t && t !== 'text' && !syn.accepts.includes(t)) base -= TYPE_PENALTY;
  }
  return { score: round3(Math.max(0, Math.min(1, base))), rank: base > 0 ? rank : Infinity };
}

// A compound header such as "State/Province" or "Fax | Phone" is also tried part by part; the best part counts when it
// beats the header taken whole.
const COMPOUND = /[/|]/;
function scoreDetail(ourField, theirHeader, sampleValues) {
  const whole = scoreOne(ourField, theirHeader, sampleValues);
  if (theirHeader === null || theirHeader === undefined || !COMPOUND.test(String(theirHeader))) return whole;
  let part = NONE;
  for (const piece of String(theirHeader).split(COMPOUND)) {
    const c = scoreOne(ourField, piece, sampleValues);
    if (c.score > part.score || (c.score === part.score && c.rank < part.rank)) part = c;
  }
  return part.score > whole.score ? part : whole;
}

// How well does their column fit our field? 0..1.
export function score(ourField, theirHeader, sampleValues) {
  return scoreDetail(ourField, theirHeader, sampleValues).score;
}

// ---------------------------------------------------------------- propose

// Greedy best-first: highest score first, one `a` and one `b` each. On equal scores the lower field `a` goes first and,
// for one field, the column whose header matches the synonym listed earliest in the dictionary (`r`); only then the lower column.
function assign(pairs) {
  const usedA = new Set(), usedB = new Set(), picked = [];
  pairs.sort((x, y) => y.s - x.s || x.a - y.a || x.r - y.r || x.b - y.b);
  for (const p of pairs) {
    if (usedA.has(p.a) || usedB.has(p.b)) continue;
    usedA.add(p.a); usedB.add(p.b); picked.push(p);
  }
  return picked;
}

// A row is an object keyed by header, or an array lined up with the headers.
function samplesFor(rows, header, index) {
  if (!Array.isArray(rows)) return [];
  return rows.map(r => (Array.isArray(r) ? r[index] : (r && has(r, header) ? r[header] : undefined)))
    .filter(v => v !== null && v !== undefined && String(v).trim() !== '');
}

function bestOf(list) {
  let best = null;
  for (const x of list) if (x.score > 0 && (!best || x.score > best.score)) best = x;
  return best;
}

// every word the dictionary knows, for the "does this sheet look English" test (numbers do not count)
let knownWords = null;
function dictionaryWords() {
  if (!knownWords) {
    knownWords = new Set(PART_TOKENS);
    for (const f of Object.keys(FIELDS)) for (const s of synonymsOf(f).list) for (const t of s.split(' ')) if (!/^\d+$/.test(t)) knownWords.add(t);
  }
  return knownWords;
}

// ourFields: the field names to map; theirHeaders: their column headers; sampleRows: a few of their rows (optional).
// Returns { columns, unmapped, splits, warnings }. unmapped.headers[].best is the best field for that header among ALL
// the fields, taken or not, so a header that lost a tie shows what it lost. warnings are plain sentences.
export function proposeMap(ourFields, theirHeaders, sampleRows) {
  const fields = [...new Set(ourFields)];
  const headers = theirHeaders.map(h => (h === null || h === undefined ? '' : String(h)));
  const samples = headers.map((h, i) => samplesFor(sampleRows, h, i));
  const taken = new Set();
  const cols = [];
  const splits = [];
  const splitFields = new Set();
  const warnings = [];

  // 1. composites first: name <- First Name + Last Name, address <- street + city + state + zip
  for (const field of fields) {
    if (!has(PARTS, field)) continue;
    const def = PARTS[field];
    const pairs = [];
    def.parts.forEach((part, a) => headers.forEach((h, b) => {
      if (taken.has(b)) return;
      const d = scoreDetail(part.key, h, samples[b]);
      if (d.score >= MIN_SCORE) pairs.push({ a, b, s: d.score, r: d.rank });
    }));
    const picked = assign(pairs);
    const got = new Set(picked.map(p => def.parts[p.a].transform));
    if (picked.length < def.min || !def.required.every(t => got.has(t))) continue;
    picked.sort((x, y) => x.b - y.b);
    splits.push({ field, into: picked.map(p => ({ header: headers[p.b], transform: def.parts[p.a].transform, score: p.s })) });
    for (const p of picked) {
      taken.add(p.b);
      cols.push({ i: p.b, header: headers[p.b], field, transform: def.parts[p.a].transform, score: p.s });
    }
    splitFields.add(field);
  }

  // 2. the rest: greedy best-first, one column per field, one field per column, nothing under MIN_SCORE
  const pairs = [];
  fields.forEach((f, a) => headers.forEach((h, b) => {
    if (taken.has(b)) return;
    const d = scoreDetail(f, h, samples[b]);
    if (d.score >= MIN_SCORE) pairs.push({ a, b, s: d.score, r: d.rank });
  }));
  const single = assign(pairs);
  const mappedFields = new Set(), mappedHeaders = new Set();
  for (const p of single) {
    mappedFields.add(p.a); mappedHeaders.add(p.b);
    cols.push({ i: p.b, header: headers[p.b], field: fields[p.a], score: p.s });
  }

  // 3. what is left, each with its best candidate (for the wizard)
  const freeH = headers.map((_, b) => b).filter(b => !taken.has(b) && !mappedHeaders.has(b));
  const freeF = fields.filter((f, a) => !mappedFields.has(a) && !splitFields.has(f));
  const fit = (f, b) => Math.max(score(f, headers[b], samples[b]), ...(has(PARTS, f) ? PARTS[f].parts.map(p => score(p.key, headers[b], samples[b])) : [0]));
  const unmapped = {
    headers: freeH.map(b => ({ header: headers[b], best: bestOf(fields.map(f => ({ field: f, score: fit(f, b) }))) })),
    fields: freeF.map(f => ({ field: f, best: bestOf(freeH.map(b => ({ header: headers[b], score: fit(f, b) }))) })),
  };

  // 4. warnings
  if (headers.length === 1 && headers[0].includes(';')) {
    warnings.push('only one column was found and its header holds semicolons: the file may be separated by semicolons, read it with parseCsv(text, { delimiter: ";" })');
  }
  const named = headers.map(h => normaliseHeader(h)).filter(Boolean);
  const known = named.filter(nh => nh.split(' ').some(t => dictionaryWords().has(t)));
  const nothing = unmapped.headers.map(u => u.header).filter(h => h.trim());
  if (nothing.length && known.length * 2 < named.length) {
    const shown = nothing.slice(0, 10).map(h => JSON.stringify(h)).join(', ') + (nothing.length > 10 ? `, and ${nothing.length - 10} more` : '');
    warnings.push(`the sheet looks non-English: only ${known.length} of ${named.length} headers hold a word the dictionary knows, and ${nothing.length} mapped nothing (${shown}); map those by hand`);
  }

  cols.sort((x, y) => x.i - y.i);
  return { columns: cols.map(({ i, ...rest }) => rest), unmapped, splits, warnings };
}

// ---------------------------------------------------------------- values

// Field names are used as property names on plain objects, so every name an object already has (toString, valueOf,
// hasOwnProperty, __proto__, constructor ...) is refused, and "prototype" with them.
const UNSAFE_KEYS = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
function pathKeys(path) {
  const keys = String(path).split('.');
  if (keys.some(k => !k || UNSAFE_KEYS.has(k))) throw new Error(`T-FIELD: bad field "${path}"`);
  return keys;
}
function getPath(obj, path) {
  if (obj !== null && typeof obj === 'object' && has(obj, path)) return obj[path];
  let cur = obj;
  for (const k of pathKeys(path)) {
    if (cur === null || typeof cur !== 'object' || !has(cur, k)) return undefined;
    cur = cur[k];
  }
  return cur;
}
function setPath(obj, path, value) {
  const keys = pathKeys(path);
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    if (!has(cur, k) || cur[k] === null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}
function toText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  if (Array.isArray(v)) return v.map(toText).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// name: the last word is the last name, with the particles before it ("van der", "de la", "St.") and the suffix after it
// ("Jr.", "III") kept on that side; "Smith, John" is John / Smith; join with one space. Judged on words, not on a name list,
// so "Mary Ann Smith" is Mary Ann / Smith.
const PARTICLES = ['van der', 'van den', 'de la', 'van', 'de', 'del', 'della', 'di', 'da', 'dos', 'du', 'le', 'la', 'von', 'bin', 'al', 'el', 'st.', 'st'];
const PARTICLE_PHRASES = PARTICLES.map(p => p.split(' ')).sort((a, b) => b.length - a.length);
const SUFFIXES = new Set(['jr.', 'jr', 'sr.', 'sr', 'ii', 'iii', 'iv']);
const isSuffix = w => SUFFIXES.has(w.toLowerCase());

function splitWords(w) {
  if (w.length < 2) return { first: w[0] || '', last: '' };
  let core = w.length - 1;
  while (core > 1 && isSuffix(w[core])) core--;
  let k = core;
  for (;;) {
    const hit = PARTICLE_PHRASES.find(p => k - p.length >= 1 && p.join(' ') === w.slice(k - p.length, k).join(' ').toLowerCase());
    if (!hit) break;
    k -= hit.length;
  }
  return { first: w.slice(0, k).join(' '), last: w.slice(k).join(' ') };
}
function splitName(text) {
  const parts = text.split(',').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
  if (!parts.length) return { first: '', last: '' };
  const tail = [];
  while (parts.length > 1 && parts[parts.length - 1].split(' ').every(isSuffix)) tail.unshift(parts.pop());
  if (parts.length === 2) {
    const first = parts[1].split(' ');
    while (first.length > 1 && isSuffix(first[first.length - 1])) tail.unshift(first.pop());
    return { first: first.join(' '), last: [parts[0], ...tail].join(' ') };
  }
  return splitWords([parts.join(' '), ...tail].join(' ').split(' '));
}
const joinName = (first, last) => [first, last].filter(Boolean).join(' ');

// address: "123 Main St, Oakland, CA 94612" -> street, city, state, postal_code (missing parts stay empty)
function splitAddress(text) {
  const out = { street: '', city: '', state: '', postal_code: '' };
  const segs = text.trim().replace(/\s+/g, ' ').split(',').map(s => s.trim()).filter(Boolean);
  if (!segs.length) return out;
  const ZIP = /^\d{5}(?:-\d{4})?$/, ST = /^[A-Za-z]{2}$/, ST_ZIP = /^([A-Za-z]{2})\.?\s+(\d{5}(?:-\d{4})?)$/;
  const tail = () => segs[segs.length - 1];
  if (ST_ZIP.test(tail())) {
    const m = ST_ZIP.exec(segs.pop());
    out.state = m[1]; out.postal_code = m[2];
  } else if (segs.length > 1 && ZIP.test(tail())) {
    out.postal_code = segs.pop();
    if (segs.length > 1 && ST.test(tail())) out.state = segs.pop();
  } else if (segs.length > 1 && ST.test(tail())) {
    out.state = segs.pop();
  }
  if (segs.length >= 2) out.city = segs.pop();
  out.street = segs.join(', ');
  return out;
}
const joinAddress = p => [p.street, p.city, [p.state, p.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');

// phone. A US number is 10 digits (area code 2-9), or 11 with a leading 1 / +1. Without a "+", a number is read as US only
// when the default country is US (the default); with a "+1" it is US whatever the default. Any other number that already
// starts with "+" and has 8 to 15 digits (the E.164 limit) is kept as "+" and its digits when the target is E.164.
// Nothing else is formatted: no other country's rules are built in.
const countryOf = options => {
  const c = options && typeof options.defaultCountry === 'string' ? options.defaultCountry.trim().toUpperCase() : '';
  return c || 'US';
};
function parsePhone(text, country) {
  const t = text.trim();
  if (!/^\+?[\d\s().-]+$/.test(t)) return null;
  const digits = t.replace(/\D/g, '');
  const plus = t.startsWith('+');
  if (digits.length === 11 && digits[0] === '1' && /[2-9]/.test(digits[1]) && (plus || country === 'US')) return digits.slice(1);
  if (digits.length === 10 && !plus && country === 'US' && /[2-9]/.test(digits[0])) return digits;
  return null;
}
function plusNumber(text) {
  const t = text.trim();
  if (!/^\+[\d\s().-]+$/.test(t)) return null;
  const digits = t.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}
// E.164 text for a number, or null
function leadPhone(text, fmt, country) {
  const n = parsePhone(text, country);
  if (n) return `+1${n}`;
  return fmt === 'e164' ? plusNumber(text) : null;
}
// -> { value, ok }; a number that cannot be formatted comes back as it was, with ok false
function formatPhone(text, fmt, country) {
  if (fmt === 'us') {
    const n = parsePhone(text, country);
    return n ? { value: `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`, ok: true } : { value: text, ok: false };
  }
  const v = leadPhone(text, 'e164', country);
  return v === null ? { value: text, ok: false } : { value: v, ok: true };
}
const PHONE_HELP = 'a bare number needs defaultCountry US, any other number needs a leading + and its country code';

// dates: kept in UTC unless options.timezone names an IANA zone, so the same text comes out in every browser and every time zone
const pad = (n, w = 2) => String(n).padStart(w, '0');
function validYmd(y, m, d) {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const zoneFormats = new Map();
function zoneFormat(tz) {
  let f = zoneFormats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    zoneFormats.set(tz, f);
  }
  return f;
}
// options.timezone -> a zone name that Intl accepts ('UTC' when none is given); an unknown name is an error, not a silent UTC
function zoneOf(options) {
  const tz = String((options && options.timezone) || 'UTC');
  if (tz === 'UTC') return tz;
  try { zoneFormat(tz); } catch { throw new Error(`T-TIMEZONE: unknown time zone "${tz}"`); }
  return tz;
}
// the clock and calendar parts of an instant (ms since 1970, UTC) as a wall clock in the zone
function wallParts(ms, tz) {
  if (tz === 'UTC') {
    const t = new Date(ms);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds() };
  }
  const o = {};
  for (const p of zoneFormat(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = +p.value;
  return { y: o.year, m: o.month, d: o.day, h: o.hour % 24, mi: o.minute, s: o.second };
}
// a wall clock in the zone -> the instant it names (ms since 1970, UTC). The offset is read at the guess and again at the corrected
// instant, so a time near a daylight-saving change still lands on a real instant.
function wallToMs(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (tz === 'UTC') return guess;
  const offsetAt = ms => { const w = wallParts(ms, tz); return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - ms; };
  return guess - offsetAt(guess - offsetAt(guess));
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;
// A timestamp with Z or an offset names its own instant. One with neither is read as UTC, or as `tz` when a zone is given.
function parseIso(text, tz = 'UTC') {
  const m = ISO_RE.exec(text.trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (!validYmd(y, mo, d)) return null;
  if (m[4] === undefined) return { y, m: mo, d, time: false };
  const h = +m[4], mi = +m[5], s = m[6] === undefined ? 0 : +m[6];
  if (h > 23 || mi > 59 || s > 59) return null;
  let offset = 0;
  if (m[7] && m[7].toUpperCase() !== 'Z') {
    const o = m[7].replace(':', '');
    offset = (o[0] === '-' ? -1 : 1) * (+o.slice(1, 3) * 60 + +o.slice(3, 5));
  }
  const t = new Date(m[7] === undefined ? wallToMs(y, mo, d, h, mi, s, tz) : Date.UTC(y, mo - 1, d, h, mi, s) - offset * 60000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds(), time: true };
}
const SLASH_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T,].*)?$/;
// text -> parts, from ISO, or from MM/DD/YYYY or DD/MM/YYYY. `order` is 'us' or 'eu'; when the text itself settles it
// (a first number over 12 is a day, a second over 12 is a day) the text wins; a real tie goes to `order`.
function parseDate(text, order, tz) {
  const iso = parseIso(text, tz);
  if (iso) return iso;
  const m = SLASH_RE.exec(text.trim());
  if (!m) return null;
  const a = +m[1], b = +m[2], y = +m[3];
  const eu = a > 12 ? true : b > 12 ? false : order === 'eu';
  const mo = eu ? b : a, d = eu ? a : b;
  return validYmd(y, mo, d) ? { y, m: mo, d, time: false } : null;
}
// ISO text: a date alone stays a date; a timestamp becomes UTC "YYYY-MM-DDTHH:MM:SSZ"
function isoOf(p) {
  const day = `${pad(p.y, 4)}-${pad(p.m)}-${pad(p.d)}`;
  return p.time ? `${day}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}Z` : day;
}
// MM/DD/YYYY and DD/MM/YYYY carry the date only (no time). The day of a timestamp is the day in `tz`; a date with no time has no zone to move.
// Our leads are UTC, so on export a timestamp with no offset is read as UTC.
function formatDate(text, fmt, tz) {
  const p = parseIso(text);
  if (!p) return text;
  const q = p.time && tz !== 'UTC' ? wallParts(Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s), tz) : p;
  if (fmt === 'us') return `${pad(q.m)}/${pad(q.d)}/${pad(q.y, 4)}`;
  if (fmt === 'eu') return `${pad(q.d)}/${pad(q.m)}/${pad(q.y, 4)}`;
  return isoOf(p);
}

// enum value maps: { field: { ours: theirs } }, or { "field@Header": {...} } for one column
function pickMap(valueMaps, col) {
  const specific = `${col.field}@${col.header}`;
  if (has(valueMaps, specific)) return valueMaps[specific];
  if (has(valueMaps, col.field)) return valueMaps[col.field];
  return null;
}
function lookup(map, key) {
  if (has(map, key)) return String(map[key]);
  const low = key.toLowerCase();
  for (const k of Object.keys(map)) if (k.toLowerCase() === low) return String(map[k]);
  return undefined;
}
function reverseLookup(map, key) {
  const rev = new Map();
  for (const [ours, theirs] of Object.entries(map)) if (!rev.has(String(theirs))) rev.set(String(theirs), ours);
  if (rev.has(key)) return rev.get(key);
  const low = key.toLowerCase();
  for (const [theirs, ours] of rev) if (theirs.toLowerCase() === low) return ours;
  return undefined;
}

// ---------------------------------------------------------------- templates

const lastSegment = f => String(f).split('.').pop();
function fieldKind(field) {
  const s = lastSegment(field);
  if (s === 'phone' || s.endsWith('_phone')) return 'phone';
  if (s === 'date' || s.endsWith('_at') || s.endsWith('_date')) return 'date';
  return 'plain';
}

// Problems with a template, as a list of strings (empty = fine). The same rules as service.save_crm_template.
export function validateTemplate(template) {
  const problems = [];
  if (!template || typeof template !== 'object') return ['T-COLUMNS: the template is missing'];
  const cols = template.columns;
  if (!Array.isArray(cols) || cols.length < 1 || cols.length > 200) return ['T-COLUMNS: columns must be a list of 1 to 200'];
  const seen = new Set();
  cols.forEach((c, i) => {
    if (!c || typeof c.header !== 'string' || !c.header || typeof c.field !== 'string' || !c.field) {
      problems.push(`T-COLUMNS: column ${i + 1} needs a header and a field`); return;
    }
    if (seen.has(c.header)) problems.push(`T-COLUMNS: two columns have the same header "${c.header}"`);
    seen.add(c.header);
    try { pathKeys(c.field); } catch { problems.push(`T-FIELD: column "${c.header}" has a bad field "${c.field}"`); }
    if (c.transform !== undefined && c.transform !== null && typeof c.transform !== 'string') problems.push(`T-TRANSFORM: column "${c.header}" transform must be text`);
  });
  const vm = template.value_maps;
  if (vm !== undefined && vm !== null && (typeof vm !== 'object' || Array.isArray(vm))) problems.push('T-VALUE-MAPS: value_maps must be an object');
  return problems;
}
function assertTemplate(template) {
  const problems = validateTemplate(template);
  if (problems.length) throw new Error(problems.join('; '));
}

// What one column does, from its transform and field.
function planOf(col, options) {
  const t = col.transform ? String(col.transform) : '';
  const kind = fieldKind(col.field);
  if (!t) {
    if (kind === 'phone') return { op: 'phone', fmt: options.phone === 'us' ? 'us' : 'e164' };
    if (kind === 'date') return { op: 'date', fmt: ['us', 'eu'].includes(options.date) ? options.date : 'iso' };
    return { op: 'plain' };
  }
  if (t === 'first' || t === 'last') return { op: 'namepart', part: t };
  if (t === 'street' || t === 'city' || t === 'state') return { op: 'addrpart', part: t };
  if (t === 'postal_code' || t === 'zip') return { op: 'addrpart', part: 'postal_code' };
  if (t === 'e164') return { op: 'phone', fmt: 'e164' };
  if (t === 'iso' || t === 'eu') return { op: 'date', fmt: t };
  if (t === 'us' && kind === 'phone') return { op: 'phone', fmt: 'us' };
  if (t === 'us' && kind === 'date') return { op: 'date', fmt: 'us' };
  throw new Error(`T-TRANSFORM: unknown transform "${t}" on column "${col.header}" (field ${col.field})`);
}

// ---------------------------------------------------------------- export

// Our leads -> rows keyed by their headers, in the template's column order.
// options: { phone: 'e164' | 'us', date: 'iso' | 'us' | 'eu' } fill in for columns with no transform;
// { defaultCountry: 'US' } the country a bare phone number is read in (only US is built in);
// { timezone: 'UTC' } an IANA zone name (America/Los_Angeles): the day printed by the us and eu date formats.
// The returned array carries a non-enumerable `warnings` list, [{ row, header, message }], one per phone cell that could
// not be formatted (the cell is written as it was).
export function exportRows(template, leads, options) {
  assertTemplate(template);
  const opts = options || {};
  const zone = zoneOf(opts), country = countryOf(opts);
  const valueMaps = template.value_maps || {};
  const plans = template.columns.map(c => planOf(c, opts));
  const warnings = [];
  const rows = leads.map((lead, r) => Object.fromEntries(template.columns.map((col, i) => {
    const text = toText(getPath(lead, col.field));
    if (!text.trim()) return [col.header, ''];
    const p = plans[i];
    let cell;
    if (p.op === 'namepart') cell = splitName(text)[p.part];
    else if (p.op === 'addrpart') cell = splitAddress(text)[p.part];
    else if (p.op === 'phone') {
      const f = formatPhone(text, p.fmt, country);
      if (!f.ok) warnings.push({ row: r, header: col.header, message: `phone could not be formatted as ${p.fmt === 'us' ? 'a US number' : 'E.164'} (${PHONE_HELP}), left as it was` });
      cell = f.value;
    }
    else if (p.op === 'date') cell = formatDate(text, p.fmt, zone);
    else {
      const map = pickMap(valueMaps, col);
      const mapped = map ? lookup(map, text) : undefined;
      cell = mapped === undefined ? text : mapped;
    }
    return [col.header, cell];
  })));
  Object.defineProperty(rows, 'warnings', { value: warnings, enumerable: false });
  return rows;
}

// ---------------------------------------------------------------- import

const emailKey = e => (typeof e === 'string' && e.includes('@') ? e.trim().toLowerCase() : null);
function phoneKey(p) {
  if (typeof p !== 'string') return null;
  const n = parsePhone(p, 'US');
  if (n) return n;
  const digits = p.replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
}

// Their rows (objects keyed by their headers, as parseCsv gives) -> our lead objects.
// Returns { leads, duplicates, sourceRows, warnings }: sourceRows[i] is the index in `rows` that leads[i] came from;
// duplicates are groups of lead indexes sharing an email or a phone; warnings are { row, header, message } and name values
// left as they were, or (row null) a header the file repeated, which parseCsv renamed to "Phone (2)".
// options: { date: 'us' | 'eu' } settles a date like 03/04/2026 that could be either;
// { defaultCountry: 'US' } as in exportRows; { timezone: 'UTC' } the zone a timestamp with no offset is read in.
export function importRows(template, rows, options) {
  assertTemplate(template);
  const opts = options || {};
  const zone = zoneOf(opts), country = countryOf(opts);
  const valueMaps = template.value_maps || {};
  const plans = template.columns.map(c => planOf(c, opts));
  const order = opts.date === 'eu' ? 'eu' : 'us';
  const leads = [], sourceRows = [], warnings = [];

  const headersInFile = new Set();
  for (const row of rows) if (row !== null && typeof row === 'object') for (const k of Object.keys(row)) headersInFile.add(k);
  for (const k of headersInFile) {
    const renamed = /^(.*) \((\d+)\)$/.exec(k);
    if (renamed && +renamed[2] >= 2 && headersInFile.has(renamed[1])) {
      warnings.push({ row: null, header: k, message: `duplicate header in the file: "${renamed[1]}" appears more than once, and this copy was renamed "${k}"; it is read only if the template names it` });
    }
  }

  rows.forEach((row, r) => {
    const lead = {}, names = new Map(), addrs = new Map();
    const put = (field, value) => { if (!toText(getPath(lead, field)).trim()) setPath(lead, field, value); };
    const part = (into, field, key, text) => { if (!into.has(field)) into.set(field, {}); const o = into.get(field); o[key] = o[key] || text; };
    template.columns.forEach((col, i) => {
      const text = row !== null && typeof row === 'object' && has(row, col.header) ? toText(row[col.header]).trim() : '';
      if (!text) return;
      const p = plans[i];
      if (p.op === 'namepart') part(names, col.field, p.part, text);
      else if (p.op === 'addrpart') part(addrs, col.field, p.part, text);
      else if (p.op === 'phone') {
        const e164 = leadPhone(text, p.fmt, country);
        if (e164 === null) warnings.push({ row: r, header: col.header, message: `phone could not be turned into E.164 (${PHONE_HELP}), left as it was` });
        put(col.field, e164 === null ? text : e164);
      } else if (p.op === 'date') {
        const parts = parseDate(text, p.fmt === 'eu' || p.fmt === 'us' ? p.fmt : order, zone);
        if (!parts) warnings.push({ row: r, header: col.header, message: 'date not recognised, left as it was' });
        put(col.field, parts ? isoOf(parts) : text);
      } else {
        const map = pickMap(valueMaps, col);
        const ours = map ? reverseLookup(map, text) : undefined;
        put(col.field, ours === undefined ? text : ours);
      }
    });
    for (const [field, n] of names) put(field, joinName(n.first, n.last));
    for (const [field, a] of addrs) put(field, joinAddress(a));
    if (!Object.keys(lead).length) return;
    leads.push(lead); sourceRows.push(r);
  });

  const duplicates = [];
  for (const [by, keyOf] of [['email', emailKey], ['phone', phoneKey]]) {
    const groups = new Map();
    leads.forEach((lead, i) => {
      const k = keyOf(lead[by]);
      if (k === null) return;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    });
    for (const [value, indexes] of groups) if (indexes.length > 1) duplicates.push({ by, value, indexes });
  }
  return { leads, duplicates, sourceRows, warnings };
}

// ---------------------------------------------------------------- csv (RFC 4180)

// A cell that starts with = + - @ can run as a formula when a spreadsheet opens it. Leads are typed by strangers,
// so such a cell gets a leading apostrophe, except plain numbers and phone numbers (+1510...).
function defuse(s) {
  if (!/^[=+\-@\t\r]/.test(s)) return s;
  if (/^[+-]?\d[\d\s().,-]*$/.test(s)) return s;
  return `'${s}`;
}

// rows: objects keyed by header. headers: the column order (default: every key, first seen first).
// options: { formulaGuard: false } turns the formula guard off; { bom: true } writes a UTF-8 byte order mark.
// Records end with CRLF as RFC 4180 says.
export function toCsv(rows, headers, options) {
  const opts = options || {};
  const cols = headers || [...new Set(rows.flatMap(r => Object.keys(r)))];
  const guard = opts.formulaGuard !== false;
  const cell = v => {
    let s = toText(v);
    if (guard) s = defuse(s);
    if (/[",\r\n]/.test(s) || (cols.length === 1 && s === '')) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.map(cell).join(','), ...rows.map(r => cols.map(h => cell(r !== null && typeof r === 'object' && has(r, h) ? r[h] : '')).join(','))];
  return (opts.bom ? String.fromCharCode(0xFEFF) : '') + lines.join('\r\n') + '\r\n';
}

// The separator a file most likely uses: ';' when its header line has more semicolons than commas (outside quotes), else ','.
function guessDelimiter(s) {
  let inQuotes = false, semicolons = 0, commas = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (c === '\r' || c === '\n') break;
      if (c === ';') semicolons++; else if (c === ',') commas++;
    }
  }
  return semicolons > commas ? ';' : ',';
}

// text -> { headers, rows, warnings }. rows are objects keyed by header (a repeated header becomes "Phone (2)").
// Accepts a byte order mark, CRLF, LF or a lone CR, quoted fields with commas, quotes ("") and line breaks,
// and a last line with no line break. options: { delimiter: ';' } fixes the separator. Without it the separator is guessed
// from the header line (more semicolons than commas, as a European Excel saves, means ';') and a warning says so.
export function parseCsv(text, options) {
  let s = String(text === null || text === undefined ? '' : text);
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  const records = [], warnings = [];
  let delim = options && options.delimiter;
  if (!delim) {
    delim = guessDelimiter(s);
    if (delim === ';') warnings.push('the header line has more semicolons than commas, so ";" was read as the separator (pass { delimiter: "," } to read it with commas)');
  }
  let rec = [], field = '', inQuotes = false, atStart = true, recQuoted = false;
  const endField = () => { rec.push(field); field = ''; atStart = true; };
  const endRecord = () => {
    endField();
    if (!(rec.length === 1 && rec[0] === '' && !recQuoted)) records.push(rec);
    rec = []; recQuoted = false;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && atStart) {
      inQuotes = true; recQuoted = true; atStart = false;
    } else if (c === delim) {
      endField();
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      endRecord();
    } else {
      field += c; atStart = false;
    }
  }
  if (inQuotes) warnings.push('a quoted field was never closed; the rest of the file went into it');
  if (field !== '' || rec.length > 0 || recQuoted) endRecord();
  if (!records.length) return { headers: [], rows: [], warnings };

  const seen = new Map();
  const headers = records[0].map(h => {
    const n = (seen.get(h) || 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h} (${n})`;
  });
  const rows = records.slice(1).map((r, i) => {
    if (r.length !== headers.length) warnings.push(`row ${i + 2} has ${r.length} fields, the header has ${headers.length}`);
    return Object.fromEntries(headers.map((h, j) => [h, j < r.length ? r[j] : '']));
  });
  return { headers, rows, warnings };
}
