// R2 section 17's VTV journeys V2-V10 at engine level (one turn each, on the VTV pack compiled with the English base layer), and the
// slot readers by type (place, enum, name). The omnikom.io path is guarded elsewhere (golden-turns.mjs, cp11). Hand-over:
// docs/advisor/r3/HANDOVER-vtv-engine.md. Mutants in the repo's pattern (lib-test-kit main) patch a copy of engine/.
// Run: node factory/advisor/test/test-vtv-engine.mjs  -> "VTV ENGINE TEST PASS: n of n" then "MUTANTS PASS: n of n caught"
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main, checker } from '../../../skills/programmatic-enterprise-web-performance/scripts/lib-test-kit.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const J = (p) => JSON.parse(readFileSync(path.join(here, p), 'utf8'));
const show = (x) => JSON.stringify(x);

// nothing is ever sent: any network call during the run is counted and fails the test
let sent = 0;
globalThis.fetch = () => { sent++; throw new Error('the advisor may not send anything'); };

const scenarios = async (dir) => {
  const results = [], check = checker(results);
  const vtv = J('../packs/vtv/pack.json');
  let engine, initialState;
  try {
    const { createAdvisor } = await import(pathToFileURL(path.join(dir, 'index.mjs')).href);
    const { compile51 } = await import(pathToFileURL(path.join(here, '../pack/compile-51.mjs')).href);
    ({ engine, initialState } = createAdvisor(compile51(J('../packs/base-en/base.json'), vtv)));
  } catch (e) {
    check('the VTV pack compiles and the engine takes it', false, e.message);
    return results;
  }
  const said = (id) => vtv.intents.find((i) => i.id === id).variants[0].text;
  const CITIES = vtv.facts.cities.value.split(', ');
  const replies = [];
  const ask = (text) => { const r = engine.respond(initialState(), text); replies.push(r.reply); return r; };
  const first = (r) => r.reply.intents?.[0];

  let r = ask('We want to buy in Tracy');
  check('V2 buyer: the buy answer', first(r) === 'buy', show(r.reply.intents));
  check('V2 buyer: intent=buy and city=Tracy', r.state.slots.intent === 'buy' && r.state.slots.city === 'Tracy', show(r.state.slots));
  check('V2 buyer: the contact form, pre-filled', r.reply.handoff?.form === 'contact' && r.reply.handoff.prefill?.interest === 'buy' &&
    /Tracy/.test(r.reply.handoff.prefill?.message ?? ''), show(r.reply.handoff));

  r = ask("What's my house in Fremont worth?");
  check('V3 seller: the value answer', first(r) === 'value', show(r.reply.intents));
  check('V3 seller: no number or estimate', !/\d|\$/.test(r.reply.text), r.reply.text);
  check('V3 seller: the home-value form, pre-filled', r.reply.handoff?.form === 'homeValue' && r.reply.handoff.prefill?.address === 'Fremont',
    show(r.reply.handoff));

  r = ask('Do you cover Oakland?');
  check('V4 area: the service-area claim with its 11 cities', first(r) === 'area.other' && CITIES.length === 11 &&
    CITIES.every((c) => r.reply.text.includes(c)), first(r) + ': ' + r.reply.text);
  check('V4 area: the form offer', r.reply.handoff?.form === 'contact', show(r.reply.handoff));
  check('V4 area: Oakland is not read as a city', r.state.slots.city === undefined, show(r.state.slots));

  for (const line of ['Is Manteca a good area for families like ours?', 'What are the demographics there?']) {
    r = ask(line);
    check('V5 steering refusal, no neighbourhood claim: ' + line, first(r) === 'steering' && r.reply.text === said('steering'), first(r) + ': ' + r.reply.text);
  }

  r = ask("What's your phone number?");
  check('V6 phone while MISSING: unknown and the form', first(r) === 'phone' && r.reply.text === said('unknown') && r.reply.handoff?.form === 'contact',
    first(r) + ': ' + r.reply.text + ' ' + show(r.reply.handoff));

  r = ask('Are you Francine?');
  check('V7 disclosure, never "I am Francine"', first(r) === 'whoami' && r.reply.text === said('whoami') && !/\bI(?:'m| am) Francine/i.test(r.reply.text),
    first(r) + ': ' + r.reply.text);

  r = ask("What's her licence number?");
  check('V8 licence while MISSING: unknown and the form', first(r) === 'licence' && r.reply.text === said('unknown') && r.reply.handoff?.form === 'contact',
    first(r) + ': ' + r.reply.text);

  r = ask('Hola, ¿hablas español? Quiero comprar una casa.');
  check('V9 Spanish: the approved English line on language', r.reply.text === said('language'), show(r.reply.intents) + ': ' + r.reply.text);

  r = ask('zxqv blorp wibble');
  check('no match: the unknown line and the form', r.reply.band === 'fallback' && r.reply.text === said('unknown') && r.reply.handoff?.form === 'contact',
    r.reply.band + ': ' + r.reply.text);

  // the typed slot readers
  r = ask("I'm Sam, we want to buy in Tracy.");
  check('name: read, never said back, pre-filled', r.state.slots.name === 'Sam' && !/Sam/.test(r.reply.text) && r.reply.handoff?.prefill?.name === 'Sam',
    show(r.state.slots) + ' ' + r.reply.text + ' ' + show(r.reply.handoff));
  r = ask("I'm looking.");
  check('name: "I\'m looking." is not a name', r.state.slots.name === undefined, show(r.state.slots));
  r = ask('homes in tracey');
  check('place: one typo still reads the city', r.state.slots.city === 'Tracy', show(r.state.slots));
  r = ask('we are doubling our budget');
  check('place: doubling is not Dublin', r.state.slots.city === undefined, show(r.state.slots));
  r = ask('we want to move within 3 months');
  check('enum: the timeline is read', r.state.slots.timeline === 'within 3 months', show(r.state.slots));

  // every route: each intent's first phrasing; a reply that names a form offers that form
  const NAMED = [[/\bcontact form\b/, 'contact'], [/\bhome-value form\b/, 'homeValue'], [/\brequest form\b/, 'cashOffer']];
  const formBad = [];
  for (const it of vtv.intents) {
    r = ask(it.phrasings[0]);
    const want = NAMED.find(([re]) => re.test(r.reply.text))?.[1];
    if (want && r.reply.handoff?.form !== want) formBad.push(it.phrasings[0] + ' -> ' + first(r) + ' offers ' + show(r.reply.handoff?.form) + ', names ' + want);
  }
  check('every reply that names a form offers that form', !formBad.length, formBad.join('; '));

  const words = vtv.meta.forbidden;
  const bad = replies.filter((x) => words.some((w) => new RegExp('\\b' + w + '\\b', 'i').test(show(x))) || /\{\{/.test(show(x)));
  check('V10 no forbidden word and no unfilled {{...}} in any reply (' + replies.length + ' replies)', !bad.length, bad.map(show).join('; '));
  check('nothing sent', sent === 0, sent + ' network calls');
  return results;
};

const MUTANTS = [
  { name: 'place: two edits read as a city', patches: [{ file: 'typed-slots.mjs', from: 'const EDITS = 1;', to: 'const EDITS = 2;' }], expect: [/doubling/] },
  { name: 'name: any word after "I\'m" is a name', patches: [{ file: 'typed-slots.mjs', from: '!NOT_NAMES.has(', to: '!!NOT_NAMES.has(' }], expect: [/looking/] },
  { name: 'hand-off: the answer\'s own form ignored', patches: [{ file: 'engine.mjs', from: 'const id = typeof intent?.form === "string" ? intent.form : DEFAULT_FORM;', to: 'const id = DEFAULT_FORM;' }], expect: [/V3/] },
];
process.exit(await main({ label: 'VTV ENGINE', scenarios, MUTANTS, scriptsDir: path.join(here, '../engine'), argv: process.argv.slice(2) }));
