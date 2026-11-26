// Converts today's omnikom.io Advisor (the lovable repo's TypeScript, read-only) into one data file, the pack:
// factory/advisor/packs/omnikom-io/pack.json (format omnikom-advisor-pack/1). The engine in factory/advisor/engine/ reads
// only that file. Run: node --import ./factory/advisor/r3/ts-hook.mjs factory/advisor/pack/convert-omnikom.mjs [lovable src/lib dir]
// Deterministic: no clock, stable key order, so two runs write identical bytes.
//
// How values are obtained, so none is typed twice by hand:
//   * exported values (CUES, TUNING, FLAGS, DATA_*, STOP, ...) are imported from the lovable sources;
//   * values the sources keep private (a word list, a regex const) are read by loading a copy of the module whose text
//     gets one added line, "export const __priv = {...}" (the lovable files are never written to);
//   * regex literals written inline inside functions are found by scanning the source text; each is keyed by its order in
//     the file ("i01", "i02", ...) or, for "const NAME = /.../;", by NAME. The engine's code names them the same way
//     (R.i07), and pack.rx.<file>.<id>.line says where each one came from;
//   * reply lines that live inside functions are copied here by hand and each is checked to occur verbatim in its source file.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { applyRewrites } from './rewrites.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(process.argv[2] || process.env.LOVABLE_SRC || 'E:/omnikom-wt/lovable/lovable-app/src/lib');
const OUT = join(here, '../packs/omnikom-io/pack.json');
const FILES = {
  engine: 'advisor-engine/engine.ts', matcher: 'advisor-engine/matcher.ts', text: 'advisor-engine/text.ts', slots: 'advisor-engine/slots.ts',
  cues: 'advisor-engine/cues.ts', claims: 'claims.ts', script: 'advisor-script.ts', routing: 'helper-routing.ts',
};
const srcText = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, readFileSync(join(SRC, f), 'utf8')]));

// ---- a regex-literal scanner (checked against the TypeScript compiler's own scanner in the R3 build) ----
export function scanRegexes(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  let prev = ''; // last significant token: a punctuator char or 'id:<word>' or 'val'
  const braceStack = []; // for template literal nesting: true = a template \${ brace
  const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'instanceof', 'yield', 'await']);
  const canRegex = () => {
    if (prev === '') return true;
    if (prev.startsWith('id:')) return REGEX_AFTER_WORD.has(prev.slice(3));
    if (prev === 'val') return false;
    if (prev === ')' || prev === ']') return false;
    return true; // other punctuators, including }
  };
  const readTemplate = () => {
    // i is just after the opening backtick, or just after the closing brace of a \${ }
    while (i < n) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { i++; prev = 'val'; return; }
      if (c === '$' && src[i + 1] === '{') { i += 2; braceStack.push(true); prev = '{'; return; }
      i++;
    }
  };
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c) { if (src[i] === '\\') i++; i++; }
      i++; prev = 'val'; continue;
    }
    if (c === '`') { i++; readTemplate(); continue; }
    if (c === '/' && canRegex()) {
      const start = i;
      i++;
      let inClass = false;
      while (i < n) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '\n') throw new Error('unterminated regex at ' + start);
        if (inClass) { if (d === ']') inClass = false; }
        else if (d === '[') inClass = true;
        else if (d === '/') break;
        i++;
      }
      const source = src.slice(start + 1, i);
      i++;
      const fs = i;
      while (i < n && /[a-z]/i.test(src[i])) i++;
      out.push({ start, end: i, source, flags: src.slice(fs, i) });
      prev = 'val';
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const s = i;
      while (i < n && /[A-Za-z0-9_$]/.test(src[i])) i++;
      const w = src.slice(s, i);
      prev = REGEX_AFTER_WORD.has(w) ? 'id:' + w : 'val';
      if (w === 'else' || w === 'do') prev = 'id:' + w;
      continue;
    }
    if (/[0-9]/.test(c)) { while (i < n && /[0-9a-zA-Z_.]/.test(src[i])) i++; prev = 'val'; continue; }
    if (c === '}') {
      if (braceStack.length && braceStack[braceStack.length - 1] === true) { braceStack.pop(); i++; readTemplate(); continue; }
      braceStack.pop(); i++; prev = '}'; continue;
    }
    if (c === '{') { braceStack.push(false); i++; prev = '{'; continue; }
    if (c === ')' || c === ']') { i++; prev = c; continue; }
    i++; prev = c;
  }
  // mark direct top-level constants
  for (const r of out) {
    const before = src.slice(Math.max(0, r.start - 120), r.start);
    const m = /(?:^|\n)(?:export )?const (\w+)(?::[^=\n]+)?\s*=\s*$/.exec(before);
    const after = src.slice(r.end, r.end + 2);
    r.direct = !!m && /^\s*;|^;/.test(after + '');
    if (r.direct) r.name = m[1];
  }
  return out;
}


// ---- loading a lovable module together with its private top-level names ----
function resolveImport(fromRel, spec) {
  const base = resolve(dirname(join(SRC, fromRel)), spec);
  for (const c of [base + '.ts', join(base, 'index.ts')]) { try { readFileSync(c); return pathToFileURL(c).href; } catch {} }
  throw new Error('cannot resolve ' + spec + ' from ' + fromRel);
}
async function loadWithPrivates(key) {
  const rel = FILES[key];
  let js = stripTypeScriptTypes(srcText[key], { mode: 'strip' });
  js = js.replace(/(from\s+)(["'])(\.{1,2}\/[^"']+)\2/g, (_m, a, _q, spec) => a + JSON.stringify(resolveImport(rel, spec)));
  const names = [...js.matchAll(/^(?:const|let|function|class)\s+(\w+)/gm)].map((m) => m[1]);
  js += '\nexport const __priv = { ' + names.join(', ') + ' };\n';
  const ns = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
  return { ...ns, ...ns.__priv };
}
const M = {};
for (const key of ['engine', 'matcher', 'text', 'slots', 'cues', 'claims', 'script', 'routing']) M[key] = await loadWithPrivates(key);

// ---- the regex tables: pack.rx.<file>.<id> ----
const rxTable = {};
const lineOf = (src, at) => src.slice(0, at).split('\n').length;
for (const key of ['engine', 'matcher', 'text', 'slots', 'routing', 'script']) {
  const src = srcText[key];
  let ord = 0;
  rxTable[key] = {};
  for (const t of scanRegexes(src)) {
    const id = t.direct ? t.name : 'i' + String(++ord).padStart(2, '0');
    rxTable[key][id] = { source: t.source, flags: t.flags, line: lineOf(src, t.start) };
  }
}
const RX = (file, id, mustContain) => {
  const e = rxTable[file][id];
  if (!e) throw new Error('no regex ' + file + '.' + id);
  if (mustContain && !e.source.includes(mustContain)) throw new Error('regex ' + file + '.' + id + ' is not the expected one (wanted ' + mustContain + '): ' + e.source.slice(0, 60));
  return new RegExp(e.source, e.flags);
};
// cues.ts: the pay-question patterns are private consts of the module (used by payLike)
const cueRx = { PAY: M.cues.PAY, PAY_PEOPLE: M.cues.PAY_PEOPLE, PAY_WORD: M.cues.PAY_WORD, CLIENT_COST: M.cues.CLIENT_COST };
for (const [k, v] of Object.entries(cueRx)) if (!(v instanceof RegExp)) throw new Error('cues.' + k + ' is not a RegExp');

// a reply line copied by hand must occur verbatim in its source file
const lit = (file, text) => {
  if (!srcText[file].includes(JSON.stringify(text))) throw new Error('text not found verbatim in ' + FILES[file] + ': ' + text.slice(0, 60));
  return text;
};

// ---- serialisation: stable, regexes as {"$rx","flags"} ----
function ser(v) {
  if (v instanceof RegExp) return { $rx: v.source, flags: v.flags };
  if (v instanceof Set) return [...v].map(ser);
  if (v instanceof Map) return [...v.entries()].map(([k, x]) => [ser(k), ser(x)]);
  if (Array.isArray(v)) return v.map(ser);
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = ser(x); return o; }
  return v;
}

// ---- intents: today's library parsed (the engine's own parser, run here once) ----
const imp = (rel) => import(pathToFileURL(join(SRC, rel)).href);
const { parseLibrary } = await imp('advisor-engine/library.ts');
const intents = parseLibrary([
  (await imp('advisor-engine/data-price.ts')).DATA_PRICE, (await imp('advisor-engine/data-services.ts')).DATA_SERVICES,
  (await imp('advisor-engine/data-how.ts')).DATA_HOW, (await imp('advisor-engine/data-fit.ts')).DATA_FIT, (await imp('advisor-engine/data-chat.ts')).DATA_CHAT,
]);

// ---- the pack ----
const E = M.engine;

// C-26 (claims.ts: seatTotals is false): today's engine removes every sentence holding a seat total before it speaks (engine.ts scrubTotals,
// with its own two patterns i46 and i47). A pack may not carry a $ amount that is not a price row (docs/advisor/R2-design.md 5.2 step 3), so
// the same scrub runs here once, on the library lines that hold one; what the visitor sees is unchanged (the cp11 run shows 0 text diffs).
if (!E.FLAGS.seatTotals) {
  const split = new RegExp(rxTable.engine.i46.source, rxTable.engine.i46.flags), total = new RegExp(rxTable.engine.i47.source, rxTable.engine.i47.flags);
  for (const it of intents) for (const v of it.variants) {
    const other = [...v.text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)/g)].some((m) => Number(m[1].replace(/,/g, '')) !== E.CALLER_PRICE);
    if (!other) continue;
    const kept = v.text.split(split).filter((s) => !total.test(s));
    if (!kept.length) throw new Error('seat-total scrub would empty a line of ' + it.id + '; convert it by hand');
    v.text = kept.join(' ');
  }
}
const rxOut = {};
for (const [file, table] of Object.entries(rxTable)) {
  if (file === 'script') continue; // advisor-script.ts is driven by pack.script, which holds its patterns
  rxOut[file] = {};
  for (const [id, e] of Object.entries(table)) rxOut[file][id] = { $rx: e.source, flags: e.flags, line: e.line };
}
// payLike's apostrophe-normalising pattern is the one literal in payLike itself (cues.ts)
const aposEntry = scanRegexes(srcText.cues).filter((t) => t.source.includes('u2018')).map((t) => ({ source: t.source, flags: t.flags, line: lineOf(srcText.cues, t.start) }));
if (aposEntry.length !== 1) throw new Error('cues.ts: expected exactly one apostrophe pattern, found ' + aposEntry.length);
rxOut.cues = { ...ser(cueRx), APOS: { $rx: aposEntry[0].source, flags: aposEntry[0].flags, line: aposEntry[0].line } };
// not in the lovable source (R3 job 5, cp11 #887): markup is not words; a tag typed or pasted into the chat is dropped before reading
rxOut.engine.MARKUP = { $rx: '<\\/?[a-z][^<>]*>', flags: 'gi' };

const git = spawnSync('git', ['-C', SRC, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 20000 });
if (git.status !== 0) throw new Error('git rev-parse failed in the lovable repo: ' + git.stderr);

const pack = {
  meta: {
    schema: 'omnikom-advisor-pack/1', pack: 'omnikom-io', client: 'omnikom', industry: 'cold-calling', version: '0.1.0',
    source: { repo: 'lovable', commit: git.stdout.trim() }, report: true, locales: ['en'],
  },
  // claims.ts via engine.ts FLAGS: the switches that decide whether a seat total or the records allowance may be quoted
  flags: { ...E.FLAGS },
  prices: { caller: E.CALLER_PRICE },
  // engine.ts TUNING, then the other numbers the engine's code used (named here, read by name there)
  tuning: {
    ...E.TUNING,
    boostNext: 0.04, // engine.ts contextBoost: an intent the last answer pointed to
    boostYes: 0.1, // engine.ts contextBoost: "yes" while an offer is open
    nearTie: 0.03, // engine.ts preferSlot, band, familyLead
    clarifyWindow: 0.16, // engine.ts band: how far below the top a menu option may score
    clarifyOptions: 3, // engine.ts band: most options in a menu
    nextChoices: 3, // engine.ts finish: most follow-up buttons
    slotQuestionMin: 0.4, // engine.ts respondTo: a slot statement beats a clarify menu when asked as a question at this score
    slotStatementMax: 0.55, // engine.ts respondTo: ... and when not a question below this score
    oddMin: 2, // engine.ts respondTo: odd words (repaired + unknown) needed to fall back
    oddShare: 0.7, // engine.ts respondTo: share of the words that must be odd
    thinCuedMin: 0.6, // engine.ts band: a cue-backed top score that passes thin evidence
    thinSureMin: 0.9, // engine.ts band: a clear top score that passes thin evidence
    thinGap: 0.1, // engine.ts band: ... when this far ahead
    focusLong: 140, // engine.ts focusOn: a message longer than this is matched on its questions
    clip: 300, // engine.ts focusOn, inSpanish: longest text kept
    slotWindow: 600, // engine.ts respondTo: how much of a message is read for slots
    unansweredMax: 120, // engine.ts fallback: how much of an unanswered question is remembered
    marketsKept: 4, // engine.ts mergeSlots
    marketsFound: 4, // slots.ts findMarkets
    unknownWeight: 1.1, // matcher.ts UNKNOWN_WEIGHT
    idfFloor: 0.05, // matcher.ts constructor
    domainIdf: 1.2, // matcher.ts constructor
    lexiconCount: 2, // matcher.ts constructor: weight of a lexicon word in the vocabulary
    cueFloor: 0.3, // matcher.ts rank: score of an intent only a cue named
    cueTotalFloor: 0.4, // matcher.ts rank: a positive cue lifts at least to this plus the cue
    talk: { askedLong: { words: 4, f: 0.35 }, askedMid: { words: 3, f: 0.6 }, plainLong: { words: 8, f: 0.35 }, plainMid: { words: 6, f: 0.6 } }, // matcher.ts rank: small talk inside a business message, by how many words it has
    editBudget: { zero: 4, one: 7 }, // text.ts editBudget: word lengths that get 0 / 1 edit
    distanceMax: 3, // text.ts damerau default
    messageMax: 300, // advisor-script.ts getScriptedReply
  },
  intents: ser(intents),
  cues: E_CUES(),
  lexicon: ser({
    stop: M.text.STOP, groups: M.text.LEXICON_GROUPS, raw: M.text.RAW_LEXICON, contractions: M.text.CONTRACTIONS, fillers: M.text.FILLERS,
  }),
  slots: ser({
    wordNumbers: M.slots.WORD_NUMBERS, states: M.slots.STATES, ambiguousAbbr: M.slots.AMBIGUOUS_ABBR, cities: M.slots.CITIES, crms: M.slots.CRMS,
    callerUnit: M.slots.CALLER_UNIT, teamUnit: M.slots.TEAM_UNIT,
    // slots.ts findBiz: the order matters, the first rule that matches names the business type
    bizRules: [
      { biz: 'wholesaler', rx: RX('slots', 'i28', 'wholesal') },
      { biz: 'investor', rx: RX('slots', 'i29', 'investor') },
      { biz: 'brokerage', rx: RX('slots', 'i30', 'brokerage') },
      { biz: 'team', rx: RX('slots', 'i31', 'agent') },
    ],
    // slots.ts findServices (services a visitor says they need) and namedService (a service a message names)
    serviceRules: [
      { code: 'cold-calling', rx: RX('slots', 'i38', 'cold call') }, { code: 'isa', rx: RX('slots', 'i39', 'isas') },
      { code: 'marketing', rx: RX('slots', 'i40', 'marketing') }, { code: 'transaction', rx: RX('slots', 'i41', 'transaction') },
      { code: 'production-team', rx: RX('slots', 'i42', 'production team') },
    ],
    namedRules: [
      { code: 'cold-calling', rx: RX('slots', 'i43', 'cold[- ]?call') }, { code: 'isa', rx: RX('slots', 'i44', 'inside sales') },
      { code: 'marketing', rx: RX('slots', 'i45', 'marketing') }, { code: 'transaction', rx: RX('slots', 'i46', 'transaction') },
      { code: 'production-team', rx: RX('slots', 'i47', 'production team') },
    ],
    weakRule: { code: 'cold-calling', rx: RX('slots', 'i48', 'callers') },
    money: { locale: 'en-US', symbol: '$' }, // slots.ts money()
    // slots.ts: number phrases written inside the count patterns, and Washington DC's display forms (findMarkets, ABBR_NAME)
    callerExtra: 'a couple(?: of)?|a single|single|a pair of',
    bareExtra: 'a couple|a single|single',
    dc: { abbr: 'DC', state: 'washington', raw: 'Washington Dc', display: 'Washington, DC' },
  }),
  lists: ser({
    vague: E.VAGUE, defaultMenu: E.DEFAULT_MENU, fallbackMenu: [lit('engine', 'price.base'), lit('engine', 'svc.overview'), lit('engine', 'human.talk')] /* engine.ts fallback() after the first miss */, slotFallback: E.SLOT_FALLBACK, families: E.FAMILIES, // engine.ts
    // engine.ts servicePrice: the price answer for a service asked about with a bare "how much"
    servicePrice: { 'production-team': 'price.team', isa: 'price.other_services', marketing: 'price.other_services', transaction: 'price.other_services' },
    defaultInterest: 'production-team', // engine.ts handoffFor
    numberWords: M.matcher.NUMBER_WORDS, stepNum: M.matcher.STEP_NUM, shortChat: M.matcher.SHORT_CHAT, // matcher.ts
  }),
  texts: {
    // engine.ts fallback()
    'engine.fallback.0': lit('engine', "I'm not sure I understood that one. Pick a topic below, or the Get Started form puts your question in front of the team."),
    'engine.fallback.1': lit('engine', "I'm still not catching it, sorry. Try different words, pick a topic, or email hello@omnikom.io and the team will answer directly."),
    'engine.fallback.2': lit('engine', "I can't answer that from what Omnikom has published. The team can, so the Get Started form or hello@omnikom.io is the quickest route."),
    'engine.clarify': lit('engine', 'I want to get this right. Which of these is closest to what you mean?'), // engine.ts finish()
    'engine.repeat': lit('engine', 'To repeat: '),
    'engine.basePrice': E.BASE_PRICE_LINE, // engine.ts: the published price line, the fallback for a reply that loses every sentence
    'engine.handoff.intro': lit('engine', 'From Omnikom Advisor. '), // engine.ts handoffFor(): the notes the Get Started form is filled with
    'engine.handoff.callers': lit('engine', 'Callers: '),
    'engine.handoff.team': lit('engine', 'Team size: '),
    'engine.handoff.crm': lit('engine', 'CRM: '),
    'engine.handoff.question': lit('engine', 'Question: '),
    'engine.handoff.sep': lit('engine', '. '),
    'engine.handoff.end': '.',
    'engine.fill.to': ' to ', // engine.ts fill()
    'engine.fill.orMore': ' or more',
    'engine.fill.atLeast': 'at least ',
    'engine.fill.callers': 'callers',
    'engine.fill.caller': 'caller',
    'slots.count.to': ' to ', // slots.ts countFrom()
    'slots.count.orMore': ' or more',
    'slots.count.couple': 'a couple',
    'slots.count.justMe': 'just me',
    'slots.count.one': '1', // slots.ts findCallers: "a single caller"
    'slots.team.justMe': 'just me', // slots.ts findTeamSize
    'slots.washingtonDc': 'Washington, DC', // slots.ts findMarkets
  },
  rx: rxOut,
  script: SCRIPT(),
  routing: {
    enquiryChoices: M.routing.enquiryChoices, // helper-routing.ts
    // helper-routing.ts stepAsks: what each planning step asks for, by flow
    steps: { 'cold-calling': ['business', 'markets', 'count'], 'production-team': ['count', 'markets'], support: ['chips', 'business', 'markets'] },
    marketsMaxLen: 80, // helper-routing.ts flowAccepts
  },
  // the intents engine.ts steered by inline, named here by role: the engine in factory/advisor/engine/ names no intent
  // (test/no-client-text.mjs). limits/serviceTotal name engine.ts patterns; pinRx stops the build if a name moved.
  steer: {
    ids: {
      pii: 'privacy.pii', language: 'who.international', unpublished: 'info.unpublished', yes: 'chat.yes', repeat: 'chat.repeat', basePrice: 'price.base',
      slotCount: 'slot.callers', slotTeam: 'slot.team', slotPlace: 'slot.market', slotTool: 'slot.crm', slotBiz: 'slot.biz',
      countPrice: 'price.calc', teamPrice: 'price.team_size', placeAnswer: 'mkt.state', toolAnswer: 'crm.integrate', countService: 'svc.cold',
      toolHandoff: 'crm.handoff', placeMulti: 'mkt.multi', consent: 'comp.recording', dedicated: 'svc.team_dedicated',
      teamService: 'price.team', otherServices: 'price.other_services',
    },
    prefix: { chat: 'chat.', slot: 'slot.', price: 'price.', service: 'svc.', place: 'mkt.', rules: 'comp.' },
    limits: [{ last: pinRx('i11', '^svc\\.isa'), to: 'svc.isa_limits' }, { last: pinRx('i12', '^svc\\.transaction'), to: 'svc.transaction_limits' },
      { last: pinRx('i13', '^svc\\.marketing'), to: 'svc.marketing_notincl' }],
    serviceTotal: [{ last: pinRx('i27', '^svc\\.(?:isa|marketing|transaction)'), to: 'price.other_services' },
      { last: pinRx('i28', '^svc\\.(?:production|team)'), to: 'price.team' }, { last: pinRx('i29', '^svc\\.cold'), to: 'price.base' }],
    // engine.ts followUp: the sibling-service word caught by i16
    siblings: { team: /^production/, words: [{ word: /^isa$/, to: 'svc.isa' }, { word: /^t/, to: 'svc.transaction' }, { word: /^marketing$/, to: 'svc.marketing' }],
      other: 'svc.production_team' },
    stepNext: { prefix: 'how.step', max: 5 },
  },
};

function pinRx(name, source) {
  if (rxTable.engine[name]?.source !== source) throw new Error('steer: engine.ts pattern ' + name + ' is no longer /' + source + '/; re-pin it by hand');
  return name;
}

function E_CUES() {
  return M.cues.CUES.map(([re, intent, delta]) => ({ pattern: re.source, flags: re.flags, intent, delta }));
}

function SCRIPT() {
  const S = (t) => lit('script', t);
  return {
    faqChoices: M.script.faqChoices, // advisor-script.ts
    menuReplies: M.script.menuReplies,
    // advisor-script.ts businessTypeOf: the form's business-type value, first match wins
    businessTypes: [
      { biz: 'wholesaler', rx: RX0('script', 'i01', 'wholesal') }, { biz: 'investor', rx: RX0('script', 'i02', 'investor') },
      { biz: 'brokerage', rx: RX0('script', 'i03', 'brokerage') }, { biz: 'team', rx: RX0('script', 'i04', 'realtor') },
    ],
    patterns: {
      human: RX0('script', 'i05', 'talk to'), askAnother: RX0('script', 'i06', 'ask another'), buildTeam: RX0('script', 'i07', 'build my team'),
    },
    defaultInterest: 'production-team', // advisor-script.ts getScriptedReply: a handoff that names no service
    interestOfFlow: { 'cold-calling': 'cold-calling', 'production-team': 'production-team' },
    interestOther: 'not-sure',
    notes: { intro: S('From Omnikom Advisor. '), callers: S('Callers: '), teamSize: S('Team size: '), support: S('Support: '), sep: S('. '), end: '.' },
    again: ['Ask another question'],
    humanText: S('Of course. Share a few details on the Get Started form and our team will contact you to talk it through.'),
    buildText: S('Great. Use the button below to open the Get Started form. Anything you told me here is already filled in.'),
    askAnotherText: S('Sure. What would you like to know about our pricing or services?'),
    // the guided flows: on the visitor's answer at step N, store it as answers[store], then say text (with chips);
    // a step with final: {interest} ends the flow with the Get Started link and a handoff naming that service
    flows: {
      'cold-calling': [
        { store: 'businessType', text: S('Which state or markets are you targeting?'), chips: [] },
        { store: 'markets', text: S('Are you thinking about one caller, two to four, or five or more?'), chips: ['One caller', 'Two to four callers', 'Five or more', 'Not sure'] },
        { store: 'callers', text: S('Our dedicated caller service starts at $1,299 per month for one caller, with calling infrastructure and management included. Send your details and our team will scope the calling plan for your market. Your answers are already filled in.'), chips: ['Ask another question'], final: { interest: 'cold-calling' } },
      ],
      'production-team': [
        { store: 'teamSize', text: S('What U.S. markets do you work in?'), chips: [] },
        { store: 'markets', text: S('A Production Team is scoped around your existing people and processes; there is no flat package price. Send your details and our team will put together a plan for your business. Your answers are already filled in.'), chips: ['Ask another question'], final: { interest: 'production-team' } },
      ],
      support: [
        { store: 'scope', text: S('Are you an agent team, brokerage, investor or acquisition company, or wholesaler?'), chips: ['Agent team', 'Brokerage', 'Investor or acquisition company', 'Wholesaler'] },
        { store: 'businessType', text: S('Which state or markets are you targeting?'), chips: [] },
        { store: 'markets', text: S('Your support mix is scoped to your operation rather than a fixed package. Send your details and our team will suggest a starting point. Your answers are already filled in.'), chips: ['Ask another question'], final: { interest: 'not-sure' } },
      ],
    },
    // advisor-script.ts getScriptedReply: what is said to a line that is not part of a flow, first match wins;
    // start: begins that flow at step 1
    rules: [
      { rx: RX0('script', 'i08', 'price'), text: S('Pricing starts at $1,299 per month for one dedicated caller. Larger teams and a managed Production Team are quoted around the roles and support you need. Would you like help choosing a starting point?'), chips: ['Find more sellers', 'Build a complete team', 'Talk to someone'] },
      { rx: RX0('script', 'i09', 'crm'), text: S('Omnikom works with your existing CRM and agreed handoffs. Your business keeps ownership of its records and client relationships.'), chips: M.script.menuReplies },
      { rx: RX0('script', 'i10', 'guarantee'), text: S('Omnikom provides managed execution and activity reporting, not guaranteed leads, appointments, or deals. Results depend on your market, prospect quality, follow-up, and other factors.'), chips: M.script.menuReplies },
      { rx: RX0('script', 'i11', 'sellers'), text: S('We provide dedicated, managed real estate callers for property-owner prospecting. Are you an agent team, brokerage, investor, or wholesaler?'), chips: ['Agent team', 'Brokerage', 'Investor or acquisition company', 'Wholesaler'], start: 'cold-calling' },
      { rx: RX0('script', 'i12', 'complete team'), text: S('We can connect prospecting, ISA follow-up, marketing execution, and transaction administration. How many agents or acquisition professionals are on your team, roughly?'), chips: ['Just me', '2 to 4', '5 or more', 'Not sure'], start: 'production-team' },
      { rx: RX0('script', 'i13', 'follow'), text: S('We support lead qualification and follow-up, marketing execution, and administrative transaction coordination. Are you looking for one function or several together?'), chips: ['One function', 'Several functions', 'Talk to someone'], start: 'support' },
    ],
    fallback: {
      text: S('I can help with seller prospecting, lead follow-up, marketing, transaction support, or a complete Production Team. What would you like to focus on?'),
      chips: ['Find more sellers', 'Follow up with leads', 'Marketing & transactions', 'Build a complete team'],
    },
  };
}
function RX0(file, id, must) { const r = RX(file, id, must); return r; }

mkdirSync(dirname(OUT), { recursive: true });
// patterns that break R2 5.2 are replaced by their proven equivalents (pack/rewrites.mjs, test/test-rewrites.mjs)
const json = JSON.stringify(applyRewrites(ser(pack)), null, 1) + '\n';
writeFileSync(OUT, json);
console.log('wrote ' + OUT + ' (' + json.length + ' bytes, ' + intents.length + ' intents, ' + pack.cues.length + ' cues, commit ' + pack.meta.source.commit.slice(0, 8) + ')');
