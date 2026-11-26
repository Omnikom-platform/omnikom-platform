// The 5.1 compiler (pack/compile-51.mjs) and the English base layer (packs/base-en/base.json): the base holds no trade or client
// word and no intent id, and every entry it shares with omnikom.io's pack is the same entry (one English); the compiled VTV
// runtime pack holds none of omnikom.io's words; each answer keeps its claim's source; a line that uses a MISSING fact becomes
// the unknown line with the form; no claim may say a slot back. Hand-over: docs/advisor/r3/HANDOVER-vtv-engine.md.
// Run: node factory/advisor/test/test-compile-51.mjs  -> "COMPILE 51 TEST PASS: n of n" then "MUTANTS PASS: n of n caught"
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main, checker } from '../../../skills/programmatic-enterprise-web-performance/scripts/lib-test-kit.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const J = (p) => JSON.parse(readFileSync(path.join(here, p), 'utf8'));
const show = (x) => JSON.stringify(x);
const OFF = '(?!)';

/** Leaves of b that differ from the same leaf of o; an entry o does not have, or one the base turns off ((?!), "" or null), is skipped. */
function differs(b, o, at, out) {
  if (o === undefined) return out;
  if (b && typeof b === 'object' && b.$rx !== undefined) {
    if (b.$rx !== OFF && (b.$rx !== o?.$rx || (b.flags ?? '') !== (o?.flags ?? ''))) out.push(at);
  } else if (Array.isArray(b)) {
    const has = new Set((Array.isArray(o) ? o : []).map(show));
    for (const x of b) if (!has.has(show(x))) out.push(at + ' ' + show(x).slice(0, 60));
  } else if (b && typeof b === 'object') {
    for (const k of Object.keys(b)) differs(b[k], o?.[k], at + '.' + k, out);
  } else if (b !== o && b !== '' && b !== null) out.push(at);
  return out;
}

const scenarios = async (dir) => {
  const results = [], check = checker(results);
  const omni = J('../packs/omnikom-io/pack.json');
  const vtv = J('../packs/vtv/pack.json');
  let base;
  try { base = J('../packs/base-en/base.json'); } catch (e) { check('the base layer exists', false, e.message); return results; }

  const TRADE = ['omnikom', 'caller', 'callers', 'isa', 'isas', 'dnc', 'tcpa', 'crm', 'cold call', 'telemarket', 'skiptrace', 'wholesal',
    'prospecting', 'fub', '1,299', 'upwork', 'fiverr', ...omni.slots.crms.map(([w]) => w)];
  const CLIENT = [vtv.meta.client, vtv.meta.domain, 'francine', 'valley to valley',
    ...Object.values(vtv.facts).map((f) => f.value).filter((v) => typeof v === 'string').flatMap((v) => v.split(', '))];
  const esc = (s) => s.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
  const found = (text, words) => words.filter((w) => new RegExp('(?<![a-z])' + esc(w.toLowerCase()) + '(?![a-z])').test(text));
  const ids = [...omni.intents, ...vtv.intents].map((i) => i.id).filter((id) => id.includes('.'));

  const b = show(base).toLowerCase();
  check('base-en: no trade word', !found(b, TRADE).length, found(b, TRADE).join(', '));
  check('base-en: no client word', !found(b, CLIENT).length, found(b, CLIENT).join(', '));
  check('base-en: no intent id', !ids.some((id) => show(base).includes('"' + id)), ids.filter((id) => show(base).includes('"' + id)).join(', '));
  const d = differs(base, omni, 'base', []);
  check('base-en: every entry shared with omnikom.io is the same entry', !d.length, d.slice(0, 12).join('; '));

  let compile51;
  try { ({ compile51 } = await import(pathToFileURL(path.join(dir, 'compile-51.mjs')).href)); }
  catch (e) { check('the compiler exists', false, e.message); return results; }
  let rt;
  try { rt = compile51(base, vtv); } catch (e) { check('the VTV pack compiles', false, e.message); return results; }
  // the schema id (omnikom-advisor-pack/1) is the platform's format name, not omnikom.io's words
  const t = show({ ...rt, meta: { ...rt.meta, schema: undefined } }).toLowerCase();
  check('VTV runtime: no omnikom.io word', !found(t, TRADE).length, found(t, TRADE).join(', '));
  const omniIds = omni.intents.map((i) => i.id).filter((id) => id.includes('.'));
  check('VTV runtime: no omnikom.io intent id', !omniIds.some((id) => show(rt).includes('"' + id + '"')), omniIds.filter((id) => show(rt).includes('"' + id + '"')).join(', '));

  const claims = new Map(vtv.claims.map((c) => [c.id, c]));
  const lost = rt.intents.filter((it) => {
    const c = claims.get(vtv.intents.find((x) => x.id === it.id)?.answer);
    return c && !it.variants.every((v) => show(v.source) === show(c.source));
  }).map((it) => it.id);
  check('each answer keeps its claim\'s source', !lost.length, lost.join(', '));

  const unknown = vtv.intents.find((i) => i.id === vtv.refusals.unknown);
  const withLine = structuredClone(vtv);
  withLine.claims.push({ id: 'licenceLine', text: 'Her licence number is {{fact.licence}}.', source: { kind: 'page', ref: 'test', date: '2026-11-26' } });
  const lic = withLine.intents.find((i) => i.id === 'licence');
  lic.answer = 'licenceLine';
  lic.variants = [{ when: [], text: 'Her licence number is {{fact.licence}}.' }];
  delete lic.form;
  const got = compile51(base, withLine).intents.find((i) => i.id === 'licence');
  check('a line that uses a MISSING fact becomes the unknown line with the form',
    got.variants.length === 1 && got.variants[0].text === unknown.variants[0].text && got.form === unknown.form, show(got.variants) + ' form ' + got.form);

  const echo = structuredClone(vtv);
  echo.claims.find((c) => c.id === 'greet').text = 'Hello {{slot.name}}.';
  let threw = '';
  try { compile51(base, echo); } catch (e) { threw = e.message; }
  check('no claim may say a slot back (the name is never reflected)', /slot/.test(threw), threw || 'compiled without an error');
  return results;
};

const MUTANTS = [
  { name: 'compiler: the claim source dropped', patches: [{ file: 'compile-51.mjs', from: 'source: claim.source', to: 'source: undefined' }], expect: [/source/] },
  { name: 'compiler: a MISSING fact answered', patches: [{ file: 'compile-51.mjs', from: 'if (variants.some((v) => MISSING.test(v.text)))', to: 'if (false)' }], expect: [/MISSING/] },
  { name: 'compiler: a slot said back', patches: [{ file: 'compile-51.mjs', from: 'if (SLOT.test(said))', to: 'if (false)' }], expect: [/slot back/] },
];
process.exit(await main({ label: 'COMPILE 51', scenarios, MUTANTS, scriptsDir: path.join(here, '../pack'), argv: process.argv.slice(2) }));
