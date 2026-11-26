// Proves each pattern rewrite of factory/advisor/pack/rewrites.mjs answers exactly as the pattern it replaces: a seeded
// fast-check differential over lines built from each pattern's own words (plus random strings), and every string in the
// omnikom.io pack. Mutants in the repo's pattern (lib-test-kit main) show that a wrong rewrite turns it red.
// Run: node factory/advisor/test/test-rewrites.mjs  -> "PATTERN REWRITES TEST PASS: n of n" then "MUTANTS PASS: n of n caught"
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fc from 'fast-check';
import { main, checker } from '../../../skills/programmatic-enterprise-web-performance/scripts/lib-test-kit.mjs';
import { splitKeep } from '../engine/split.mjs';
import { doubledEnd } from '../engine/text.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));

// every string in the pack (phrasings, answers, labels), as written and lower-cased
const strings = [];
(function walk(x) { if (typeof x === 'string') strings.push(x); else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') Object.values(x).forEach(walk); })(
  JSON.parse(readFileSync(path.join(here, '../packs/omnikom-io/pack.json'), 'utf8')));
const corpus = [...new Set([...strings, ...strings.map((s) => s.toLowerCase())])];

const SEP = [' ', '  ', ',', '.', '?', '!', ';', '-', '\t', 'x', 'é', '_', '1'];
const GREET = ['hi', 'hii', 'hey', 'hello', 'yo', 'good morning', 'to ', 'the ', 'you ', 'all ', 'all', 'team', 'teams', 'omnikom', 'there', 'people', 'folks'];
const TOKENS = {
  'cue chat.offtopic': ['code', 'codes', 'coding', 'zip', 'postal', 'area', 'promo', 'coupon', 'discount', 'unzip', 'zipcode', 'zip code', 'postal code', 'area code', 'promo-code', 'coupon code', 'discount code', 'python', 'write a', 'write me some', 'script', 'joke'],
  'cue chat.greeting': GREET,
  'cue trust.what (greeting)': GREET,
  'cue "um, what?" (12 rows)': ['um', 'umm', 'm', 'u', 'uh', 'h', 'er', 'r', 'e', 'erm', 'sorry', 'pardon', 'wait', 'say', 'huh', 'eh', 'what', 'wha', 'wut', 'wat', 'whut', 't'],
  'cue "like what?" (11 rows)': ['like', 'such as', 'for example', 'for instance', 'what', 'exactly', 'specifically', 'then', 'though', 'for'],
  'rx.engine.i16': ['ok', 'okay', 'and', 'so', 'then', 'what about ', 'how about ', 'for ', 'about ', 'the ', 'a ', 'an ', 'isa', 'tc', 'transaction coordinator', 'marketing', 'production team', 'production', 'one', 'price'],
  'rx.engine.i19': ['ok', 'okay', 'and', 'so', 'then', 'the ', "what's ", 'whats ', 'next', 'one', 'step', 'after that', 'then what', 'what next', 'what happens next'],
  split: ['a', 'b', 'and also', 'also', 'plus', 'and then', 'as well as', 'and', 'what', "what's", 'how', 'do', 'is there', '\n'],
  'rx.matcher.i06': ['1', '2', '-', '--', 'a'],
  'rx.text.i14': ['a', 'aa', 'b', 's', 'ss', '\n', '\r'],
};
const line = (toks) => fc.oneof(
  { weight: 4, arbitrary: fc.array(fc.constantFrom(...toks, ...SEP), { maxLength: 12 }).map((a) => a.join('')) },
  { weight: 1, arbitrary: fc.string({ maxLength: 24 }) });
const ex = (m) => (m ? JSON.stringify([m.index, ...m]) : 'null');
function sameFn(r, flags) {
  const o = new RegExp(r.old, flags);
  if (r.kind === 'code') return (s) => o.test(s) === doubledEnd(s);
  if (r.kind === 'split') { const n = new RegExp(r.new, flags + 'g'); return (s) => JSON.stringify(s.split(o)) === JSON.stringify(splitKeep(s, n)); }
  const n = new RegExp(r.new, flags);
  if (r.kind === 'exec') return (s) => ex(o.exec(s)) === ex(n.exec(s));
  return (s) => o.test(s) === n.test(s);
}

const scenarios = async (dir) => {
  const { REWRITES } = await import(pathToFileURL(path.join(dir, 'rewrites.mjs')).href + '?' + Date.now());
  const { unsafePattern } = await import(pathToFileURL(path.join(dir, 'validate.mjs')).href + '?' + Date.now());
  const results = [], check = checker(results);
  for (const r of REWRITES) {
    check('needed: ' + r.label, unsafePattern(r.old) !== null, 'the old pattern already passes the rules');
    if (r.kind !== 'code') check('rule-clean: ' + r.label, unsafePattern(r.new) === null, 'got: ' + unsafePattern(r.new));
    const toks = TOKENS[r.kind === 'split' && r.label !== 'rx.matcher.i06' ? 'split' : r.label];
    if (!toks) throw new Error('no tokens for ' + r.label);
    for (const flags of r.at === 'cues' ? ['', 'i'] : [r.flags]) {
      const eq = sameFn(r, flags);
      const bad = corpus.find((s) => !eq(s));
      let err = bad === undefined ? '' : 'pack line differs: ' + JSON.stringify(bad);
      if (!err) {
        try { fc.assert(fc.property(line(toks), eq), { numRuns: 4000, seed: 20261126 }); }
        catch (e) { err = String(e.message).split('\n').slice(0, 3).join(' | '); }
      }
      check('same answers: ' + r.label + ' [flags "' + flags + '"]', !err, err);
    }
  }
  return results;
};
const MUTANTS = [
  { name: 'offtopic: postal code no longer excluded', patches: [{ file: 'rewrites.mjs', from: '(?!(?:zip|postal|', to: '(?!(?:zip|' }], expect: [/offtopic/] },
  { name: 'greeting: a filler may end the line', patches: [{ file: 'rewrites.mjs', from: '(?:${F}(?=${F}|${N})|', to: '(?:${F}|' }], expect: [/greeting/] },
  { name: 'um-what: no check of the first word', patches: [{ file: 'rewrites.mjs', from: '^\\W*(?=${U0}|${W0})', to: '^\\W*' }], expect: [/um, what/] },
  { name: 'like-what: a word without a separator', patches: [{ file: 'rewrites.mjs', from: '(?:[\\s,]|[\\s,](?:exactly', to: '(?:[\\s,]|(?:exactly' }], expect: [/like what/] },
  { name: 'lead: a line may start with a space', patches: [{ file: 'rewrites.mjs', from: '^(?!\\s)(?:', to: '^(?:' }], expect: [/rx\.engine\.i1[69]/] },
  { name: 'split: the punctuation is not kept', patches: [{ file: 'rewrites.mjs', from: '([?.!;])\\s+|', to: '(?:[?.!;])\\s+|' }], expect: [/SPLIT/] },
];
process.exit(await main({ label: 'PATTERN REWRITES', scenarios, MUTANTS, scriptsDir: path.join(here, '../pack'), argv: process.argv.slice(2) }));
