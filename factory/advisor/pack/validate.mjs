// The pack validator (docs/advisor/R2-design.md 5.2 step 3): a pack that breaks a rule here never ships.
// validatePack(pack) -> Promise<{ errors: [{ code, at, msg }], stats }>. CLI: node factory/advisor/pack/validate.mjs <pack.json>
// Rules: schema and meta; every intent answers and links only to known ids; cue patterns compile, point at a known intent, use no back-reference,
// no look-behind and no nested unbounded repeat, and take at most 5 ms on 500-character probes (run in a worker, so a runaway pattern cannot hang
// the check); every $ amount said equals a price row; forms stay on the site, a booking link only to a listed host; links only to the site or a
// listed host; no forbidden word; every claim has a source; a required fact is never MISSING and no line uses a MISSING fact.
import { Worker } from 'node:worker_threads';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'omnikom-advisor-pack/1';
const SLOW_MS = 5;
const WATCHDOG_MS = 1000; // per pattern, armed only once the worker has started (a busy machine starts a worker slowly)
const STARTUP_MS = 20000;
const PROBES = ['a'.repeat(500), 'a'.repeat(499) + '!', ' '.repeat(500), '1'.repeat(500), 'how much '.repeat(56).slice(0, 500),
  'the quick brown fox jumps over the lazy dog, 123 4567 $1,299 a month! '.repeat(8).slice(0, 500), 'aaaa bbbb '.repeat(50)];

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const srcOk = (s) => isObj(s) && ['export', 'page', 'signoff', 'industry'].includes(s.kind) && typeof s.ref === 'string' && s.ref.length > 0 && /^\d{4}-\d{2}-\d{2}/.test(String(s.date || ''));

// the strings the assistant may say: intent labels and answers, claims, and the texts, script and refusals sections
function* spoken(p) {
  for (const [i, it] of (Array.isArray(p.intents) ? p.intents : []).entries()) {
    if (typeof it?.label === 'string') yield ['intents[' + i + '].label', it.label];
    for (const [j, v] of (Array.isArray(it?.variants) ? it.variants : []).entries()) if (typeof v?.text === 'string') yield ['intents[' + i + '].variants[' + j + ']', v.text];
  }
  for (const [i, c] of (Array.isArray(p.claims) ? p.claims : []).entries()) {
    if (typeof c?.text === 'string') yield ['claims[' + i + ']', c.text];
    for (const [j, v] of (Array.isArray(c?.variants) ? c.variants : []).entries()) if (typeof v === 'string') yield ['claims[' + i + '].variants[' + j + ']', v];
  }
  for (const k of ['texts', 'script', 'refusals']) yield* walkStrings(p[k], k);
}
function* walkStrings(x, at) {
  if (typeof x === 'string') yield [at, x];
  else if (Array.isArray(x)) for (const [i, v] of x.entries()) yield* walkStrings(v, at + '[' + i + ']');
  else if (isObj(x)) for (const [k, v] of Object.entries(x)) yield* walkStrings(v, at + '.' + k);
}
function* walkNumbers(x) {
  if (typeof x === 'number') yield x;
  else if (Array.isArray(x)) for (const v of x) yield* walkNumbers(v);
  else if (isObj(x)) for (const v of Object.values(x)) yield* walkNumbers(v);
}

// a quantifier starting at i: { len, unbounded } or null
function quantAt(s, i) {
  const c = s[i];
  let len = 0, unbounded = false;
  if (c === '*' || c === '+') { len = 1; unbounded = true; }
  else if (c === '?') len = 1;
  else if (c === '{') { const m = /^\{(\d+)(,(\d*))?\}/.exec(s.slice(i)); if (!m) return null; len = m[0].length; unbounded = m[2] !== undefined && m[3] === ''; }
  else return null;
  if (s[i + len] === '?') len++;
  return { len, unbounded };
}
// true when a group holding an unbounded repeat is itself repeated without bound, as in (a+)+ or (?:\w*\s)*
export function nestedRepeat(s) {
  const stack = [{ inner: false }];
  let i = 0, lastGroup = null;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { i += 2; lastGroup = null; continue; }
    if (c === '[') {
      i++; if (s[i] === '^') i++; if (s[i] === ']') i++;
      while (i < s.length && s[i] !== ']') { if (s[i] === '\\') i++; i++; }
      i++; lastGroup = null; continue;
    }
    if (c === '(') {
      stack.push({ inner: false }); i++;
      if (s[i] === '?') { const m = /^\?(:|=|!|<=|<!|<[A-Za-z_][\w]*>)/.exec(s.slice(i)); i += m ? m[0].length : 1; }
      lastGroup = null; continue;
    }
    if (c === ')') { const g = stack.length > 1 ? stack.pop() : { inner: false }; if (g.inner) stack[stack.length - 1].inner = true; lastGroup = g; i++; continue; }
    const q = quantAt(s, i);
    if (q) {
      const inner = !!lastGroup && lastGroup.inner, outer = q.unbounded;
      if (inner && outer) return true;
      if (q.unbounded) stack[stack.length - 1].inner = true;
      i += q.len; lastGroup = null; continue;
    }
    lastGroup = null; i++;
  }
  return false;
}
export function unsafePattern(s) {
  if (/\\[1-9]|\\k</.test(s)) return 'back-reference';
  if (/\(\?<[=!]/.test(s)) return 'look-behind';
  if (nestedRepeat(s)) return 'nested repeat';
  return null;
}

// worst time in ms of each pattern over the probes (best of 3 runs each); a pattern that runs away is stopped by the watchdog and gets Infinity
const WORKER = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { list, probes, from } = workerData;
for (let i = from; i < list.length; i++) {
  parentPort.postMessage({ i, start: true });
  let worst = 0;
  try {
    const re = new RegExp(list[i].pattern, String(list[i].flags || '').replace(/[gy]/g, ''));
    for (const p of probes) { let best = Infinity; for (let r = 0; r < 3; r++) { const t = performance.now(); re.test(p); best = Math.min(best, performance.now() - t); } worst = Math.max(worst, best); }
  } catch { worst = 0; }
  parentPort.postMessage({ i, ms: worst });
}
parentPort.postMessage({ done: true });
`;
export function timePatterns(list) {
  const ms = new Array(list.length).fill(0);
  return new Promise((resolve, reject) => {
    const start = (from) => {
      if (from >= list.length) return resolve(ms);
      const w = new Worker(WORKER, { eval: true, workerData: { list, probes: PROBES, from } });
      let current = from, timer = null;
      const arm = (limit) => { clearTimeout(timer); timer = setTimeout(() => { w.terminate(); ms[current] = Infinity; start(current + 1); }, limit); };
      arm(STARTUP_MS);
      w.on('message', (m) => { if (m.done) { clearTimeout(timer); w.terminate(); resolve(ms); return; } current = m.i; if (!m.start) ms[m.i] = m.ms; arm(m.start ? WATCHDOG_MS : STARTUP_MS); });
      w.on('error', (e) => { clearTimeout(timer); reject(e); });
    };
    start(0);
  });
}

export async function validatePack(p) {
  const errors = [], err = (code, at, msg) => errors.push({ code, at, msg });
  const m = isObj(p?.meta) ? p.meta : {};
  if (m.schema !== SCHEMA) err('META_SCHEMA', 'meta.schema', 'must be ' + SCHEMA);
  for (const k of ['pack', 'client']) if (typeof m[k] !== 'string' || !m[k]) err('META_FIELD', 'meta.' + k, 'required');
  if (!/^\d+\.\d+\.\d+$/.test(String(m.version))) err('META_VERSION', 'meta.version', 'must be x.y.z');
  if ('report' in m && typeof m.report !== 'boolean') err('META_REPORT', 'meta.report', 'must be true or false (off by default)');
  const hosts = (Array.isArray(m.allowedHosts) ? m.allowedHosts : []).map((h) => String(h).toLowerCase());
  const site = String(m.domain || '').toLowerCase();
  const under = (h, d) => !!d && (h === d || h.endsWith('.' + d));
  const hostOk = (h) => under(h.toLowerCase(), site) || hosts.some((d) => under(h.toLowerCase(), d));

  // intents
  const intents = Array.isArray(p?.intents) ? p.intents : [];
  if (!intents.length) err('INTENTS_EMPTY', 'intents', 'a pack needs intents');
  const ids = new Set(), claimIds = new Set((Array.isArray(p?.claims) ? p.claims : []).map((c) => c?.id));
  const answers = (it) => (Array.isArray(it.variants) && it.variants.some((v) => typeof v?.text === 'string' && v.text.trim())) || (typeof it.answer === 'string' && claimIds.has(it.answer));
  for (const [i, it] of intents.entries()) {
    if (typeof it?.id !== 'string' || !it.id) { err('INTENT_ID', 'intents[' + i + ']', 'no id'); continue; }
    if (ids.has(it.id)) err('INTENT_DUP', 'intents[' + i + ']', 'duplicate id ' + it.id);
    ids.add(it.id);
  }
  for (const [i, it] of intents.entries()) {
    if (!it || typeof it.id !== 'string') continue;
    if (!answers(it)) err('INTENT_NO_ANSWER', 'intents[' + i + ']', it.id + ' has no answer');
    for (const n of [...(Array.isArray(it.next) ? it.next : []), ...(it.yes ? [it.yes] : [])]) if (!ids.has(n)) err('INTENT_BAD_REF', 'intents[' + i + ']', it.id + ' points at unknown id ' + n);
  }

  // steer: the intents the engine steers by, named by role (the engine names none: test/no-client-text.mjs). Optional.
  const st = isObj(p?.steer) ? p.steer : null;
  if (st) {
    const refs = Object.entries(isObj(st.ids) ? st.ids : {}).map(([k, v]) => ['steer.ids.' + k, v]);
    for (const key of ['limits', 'serviceTotal']) for (const [i, r] of (Array.isArray(st[key]) ? st[key] : []).entries()) {
      refs.push(['steer.' + key + '[' + i + '].to', r?.to]);
      if (!isObj(p?.rx?.engine) || !isObj(p.rx.engine[r?.last])) err('STEER_RX', 'steer.' + key + '[' + i + ']', 'no rx.engine pattern named ' + r?.last);
    }
    if (isObj(st.siblings)) {
      for (const [i, w] of (Array.isArray(st.siblings.words) ? st.siblings.words : []).entries()) refs.push(['steer.siblings.words[' + i + '].to', w?.to]);
      refs.push(['steer.siblings.other', st.siblings.other]);
    }
    for (const [at, id] of refs) if (!ids.has(id)) err('STEER_ID', at, 'not an intent of this pack: ' + id);
    const prefixes = Object.entries(isObj(st.prefix) ? st.prefix : {}).map(([k, v]) => ['steer.prefix.' + k, v]);
    if (isObj(st.stepNext)) {
      const pre = st.stepNext.prefix;
      prefixes.push(['steer.stepNext.prefix', pre]);
      for (let k = 2; k <= Number(st.stepNext.max); k++) if (!ids.has(pre + k)) err('STEER_ID', 'steer.stepNext', 'no intent ' + pre + k);
    }
    for (const [at, pre] of prefixes) if (typeof pre !== 'string' || !pre || ![...ids].some((id) => id.startsWith(pre))) err('STEER_PREFIX', at, 'starts no intent of this pack: ' + pre);
  }

  // cues
  const cues = Array.isArray(p?.cues) ? p.cues : [];
  const compiled = [];
  for (const [i, c] of cues.entries()) {
    const at = 'cues[' + i + ']';
    if (c?.intent !== undefined && c.intent !== null && !ids.has(c.intent)) err('CUE_BAD_INTENT', at, 'unknown intent ' + c.intent);
    try { new RegExp(c.pattern, c.flags || ''); } catch (e) { err('CUE_BAD_PATTERN', at, e.message); continue; }
    const why = unsafePattern(String(c.pattern));
    if (why) { err('CUE_UNSAFE', at, why + ': ' + c.pattern); continue; }
    compiled.push({ i, pattern: c.pattern, flags: c.flags || '' });
  }
  const times = await timePatterns(compiled);
  for (const [k, t] of times.entries()) if (t > SLOW_MS) err('CUE_SLOW', 'cues[' + compiled[k].i + ']', (t === Infinity ? 'ran away' : t.toFixed(2) + ' ms') + ' on a 500-character probe: ' + compiled[k].pattern);

  // every other regex the pack carries, written {"$rx": source, "flags": f} anywhere in it, runs in the browser too: the same rules
  const rxs = [];
  (function walkRx(x, at, out) {
    if (Array.isArray(x)) x.forEach((v, i) => walkRx(v, at + '[' + i + ']', out));
    else if (isObj(x)) { if (typeof x.$rx === 'string') out.push({ at, pattern: x.$rx, flags: x.flags || '' }); else for (const [k, v] of Object.entries(x)) walkRx(v, at + '.' + k, out); }
  })(p, 'pack', rxs);
  const rxOk = [];
  for (const r of rxs) {
    try { new RegExp(r.pattern, r.flags); } catch (e) { err('RX_BAD_PATTERN', r.at, e.message); continue; }
    const why = unsafePattern(r.pattern);
    if (why) { err('RX_UNSAFE', r.at, why + ': ' + r.pattern); continue; }
    rxOk.push(r);
  }
  const rxTimes = await timePatterns(rxOk);
  for (const [k, rt] of rxTimes.entries()) if (rt > SLOW_MS) err('RX_SLOW', rxOk[k].at, (rt === Infinity ? 'ran away' : rt.toFixed(2) + ' ms') + ' on a 500-character probe: ' + rxOk[k].pattern);

  // what the assistant says: money, links, forbidden words, MISSING facts
  const allowed = new Set([...walkNumbers(p?.prices)]);
  const forbidden = (Array.isArray(m.forbidden) ? m.forbidden : []).map((w) => new RegExp('(^|[^A-Za-z0-9])' + String(w).replace(/[.*+?^$()|[\]\\{}]/g, '\\$&') + '($|[^A-Za-z0-9])'));
  const facts = isObj(p?.facts) ? p.facts : {};
  const missing = new Set(Object.entries(facts).filter(([, f]) => !isObj(f) || f.value === null || f.value === undefined || f.value === 'MISSING').map(([k]) => k));
  for (const [k, f] of Object.entries(facts)) if (missing.has(k) && isObj(f) && f.required) err('FACT_MISSING', 'facts.' + k, 'a required fact is MISSING');
  for (const [at, s] of spoken(p || {})) {
    for (const mm of s.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g)) {
      const n = Number(mm[1].replace(/,/g, '') + (mm[2] ? '.' + mm[2] : ''));
      if (!allowed.has(n)) err('MONEY_UNSOURCED', at, '$ amount ' + mm[0] + ' is not a price row');
    }
    for (const mm of s.matchAll(/https?:\/\/[^\s)"'<>]+/g)) {
      let h = ''; try { h = new URL(mm[0]).hostname; } catch { h = ''; }
      if (!h || !hostOk(h)) err('LINK_HOST', at, 'link to a host the pack does not list: ' + mm[0]);
    }
    for (const re of forbidden) if (re.test(s)) err('FORBIDDEN_WORD', at, 'forbidden word ' + re.source);
    for (const mm of s.matchAll(/\{\{\s*fact\.([\w-]+)\s*\}\}/g)) { const k = mm[1]; if (missing.has(k)) err('FACT_MISSING_USED', at, 'uses MISSING fact ' + k); }
  }

  // claims and forms
  for (const [i, c] of (Array.isArray(p?.claims) ? p.claims : []).entries()) if (!srcOk(c.source)) err('CLAIM_NO_SOURCE', 'claims[' + i + ']', (c?.id || '?') + ' has no source {kind, ref, date}');
  for (const [i, f] of (Array.isArray(p?.forms) ? p.forms : []).entries()) {
    const at = 'forms[' + i + ']';
    if (f?.kind === 'form') { if (typeof f.path !== 'string' || !f.path.startsWith('/') || f.path.startsWith('//') || f.path.includes('\\')) err('FORM_OFFSITE', at, 'a form path must be on the same site: ' + f.path); }
    else if (f?.kind === 'booking') {
      if (f.url === null || f.url === undefined) continue;
      let u = null; try { u = new URL(f.url); } catch { u = null; }
      if (!u || u.protocol !== 'https:') { err('FORM_HOST', at, 'a booking link must be https: ' + f.url); continue; }
      if (!hostOk(u.hostname)) err('FORM_HOST', at, 'booking host not in meta.allowedHosts: ' + u.hostname);
    } else err('FORM_KIND', at, 'kind must be form or booking');
  }
  return { errors, stats: { intents: intents.length, cues: cues.length, claims: (p?.claims || []).length, regexes: rxs.length, slowestRxMs: Math.max(0, ...rxTimes.filter((t) => t !== Infinity)), slowestCueMs: Math.max(0, ...times.filter((t) => t !== Infinity)) } };
}

const isMain = (() => { if (!process.argv[1]) return false; try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return resolvePath(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })();
if (isMain) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node factory/advisor/pack/validate.mjs <pack.json>'); process.exit(2); }
  const pack = JSON.parse(readFileSync(file, 'utf8'));
  const { errors, stats } = await validatePack(pack);
  for (const e of errors.slice(0, 50)) console.log('ERROR ' + e.code + ' ' + e.at + ': ' + e.msg);
  if (errors.length > 50) console.log('... and ' + (errors.length - 50) + ' more');
  const tally = {}; for (const e of errors) tally[e.code] = (tally[e.code] || 0) + 1;
  console.log(JSON.stringify(stats) + (errors.length ? ' errors by code ' + JSON.stringify(tally) : ''));
  console.log(errors.length ? 'PACK INVALID: ' + errors.length + ' error(s) in ' + file : 'PACK VALID: ' + pack.meta.pack + ' ' + pack.meta.version);
  process.exit(errors.length ? 1 : 0);
}
