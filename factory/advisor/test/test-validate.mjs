// Tests of the pack validator (factory/advisor/pack/validate.mjs), with watched-fail mutants in the repo's pattern
// (skills/programmatic-enterprise-web-performance/scripts/lib-test-kit.mjs main(): each mutant must turn its named assertions red).
// Run: node factory/advisor/test/test-validate.mjs   -> "PACK VALIDATOR TEST PASS: n of n" then "MUTANTS PASS: n of n caught"
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main, checker } from '../../../skills/programmatic-enterprise-web-performance/scripts/lib-test-kit.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = { kind: 'page', ref: 'fixture/page.html', date: '2026-10-22' };
const base = () => ({
  meta: { schema: 'omnikom-advisor-pack/1', pack: 'fixture', client: 'fixture', industry: 'test', version: '0.1.0', report: false, locales: ['en'],
    domain: 'example.com', allowedHosts: ['calendly.com'], forbidden: ['eXp'] },
  prices: [{ id: 'base', amount: 1299, unit: 'USD', per: 'month', source: SRC }],
  intents: [
    { id: 'greet', label: 'Hello', next: ['price'], phrasings: ['hi there'], variants: [{ when: [], text: 'Hello. Ask me anything about the service.' }] },
    { id: 'price', label: 'Price', next: [], yes: 'greet', phrasings: ['how much is it'], variants: [{ when: [], text: 'It starts from $1,299 a month. See https://example.com/pricing.' }] },
  ],
  cues: [{ pattern: '\\bhow (?:much|many)\\b(?:\\s+\\w+){0,3}', flags: 'i', intent: 'price', delta: 0.2 }],
  forms: [{ id: 'contact', kind: 'form', path: '/contact-us/' }, { id: 'booking', kind: 'booking', url: null }],
  claims: [{ id: 'area', text: 'We serve Tracy and Manteca.', source: SRC }],
  facts: { name: { value: 'Fixture Co', required: true, source: SRC }, phone: { value: null, required: false } },
});
const scenarios = async (dir) => {
  const { validatePack } = await import(pathToFileURL(path.join(dir, 'validate.mjs')).href + '?' + Date.now());
  const results = [], check = checker(results);
  const codes = async (mut) => { const p = base(); mut(p); return (await validatePack(p)).errors.map((e) => e.code); };
  const has = async (name, code, mut) => { const c = await codes(mut); check(name + ' -> ' + code, c.includes(code), 'got: ' + JSON.stringify(c)); };
  const ok = await codes(() => {});
  check('valid fixture: no errors', ok.length === 0, 'got: ' + JSON.stringify(ok));
  await has('wrong schema', 'META_SCHEMA', (p) => { p.meta.schema = 'omnikom-advisor-pack/0'; });
  await has('report not boolean', 'META_REPORT', (p) => { p.meta.report = 'yes'; });
  await has('version not x.y.z', 'META_VERSION', (p) => { p.meta.version = 'v1'; });
  await has('duplicate intent id', 'INTENT_DUP', (p) => { p.intents.push({ ...p.intents[0] }); });
  await has('intent without answer', 'INTENT_NO_ANSWER', (p) => { p.intents[0].variants = []; });
  await has('next points at unknown id', 'INTENT_BAD_REF', (p) => { p.intents[0].next = ['nope']; });
  await has('yes points at unknown id', 'INTENT_BAD_REF', (p) => { p.intents[1].yes = 'nope'; });
  await has('cue back-reference', 'CUE_UNSAFE', (p) => { p.cues[0].pattern = '(\\w)\\1'; });
  await has('cue look-behind', 'CUE_UNSAFE', (p) => { p.cues[0].pattern = '(?<=a)b'; });
  await has('cue nested repeat', 'CUE_UNSAFE', (p) => { p.cues[0].pattern = '(?:a+)+b'; });
  await has('cue that does not compile', 'CUE_BAD_PATTERN', (p) => { p.cues[0].pattern = '(abc'; });
  await has('cue to unknown intent', 'CUE_BAD_INTENT', (p) => { p.cues[0].intent = 'nope'; });
  await has('cue slow on a 500-character probe', 'CUE_SLOW', (p) => { p.cues[0].pattern = '(a|aa)*c'; });
  await has('$ amount not in prices', 'MONEY_UNSOURCED', (p) => { p.intents[1].variants.push({ when: [], text: 'Three callers are $3,897 per month.' }); });
  await has('$ amount in a claim not in prices', 'MONEY_UNSOURCED', (p) => { p.claims[0].text = 'Homes from $500,000.'; });
  await has('form path off-site', 'FORM_OFFSITE', (p) => { p.forms[0].path = '//evil.example/x'; });
  await has('booking host not listed', 'FORM_HOST', (p) => { p.forms[1].url = 'https://evil.example/book'; });
  await has('link to an unlisted host', 'LINK_HOST', (p) => { p.claims[0].text = 'See https://evil.example/page.'; });
  await has('forbidden word', 'FORBIDDEN_WORD', (p) => { p.claims[0].text = 'We are with eXp Realty.'; });
  await has('claim without source', 'CLAIM_NO_SOURCE', (p) => { delete p.claims[0].source; });
  await has('required fact MISSING', 'FACT_MISSING', (p) => { p.facts.name.value = null; });
  await has('a line uses a MISSING fact', 'FACT_MISSING_USED', (p) => { p.claims[0].text = 'Call us on {{fact.phone}}.'; });
  await has('rx with a look-behind', 'RX_UNSAFE', (p) => { p.rx = { engine: { split: { $rx: '(?<=[.?])\\s+', flags: '' } } }; });
  await has('rx that does not compile', 'RX_BAD_PATTERN', (p) => { p.rx = { engine: { bad: { $rx: '(abc', flags: '' } } }; });
  await has('rx slow on a 500-character probe', 'RX_SLOW', (p) => { p.script = { rules: [{ rx: { $rx: '(a|aa)*c', flags: '' } }] }; });
  const okRx = await codes((p) => { p.rx = { engine: { ws: { $rx: '\\s+', flags: 'g' } } }; });
  check('a plain rx is valid', okRx.length === 0, 'got: ' + JSON.stringify(okRx));
  const ans = (id) => ({ id, label: id, next: [], phrasings: [id], variants: [{ when: [], text: 'Fine.' }] });
  await has('steer id not an intent', 'STEER_ID', (p) => { p.steer = { ids: { yes: 'nope' } }; });
  await has('steer sibling target not an intent', 'STEER_ID', (p) => { p.steer = { siblings: { team: { $rx: '^x', flags: '' }, words: [], other: 'nope' } }; });
  await has('steer next step missing', 'STEER_ID', (p) => { p.intents.push(ans('how.step1')); p.steer = { stepNext: { prefix: 'how.step', max: 2 } }; });
  await has('steer prefix starts no intent', 'STEER_PREFIX', (p) => { p.steer = { prefix: { chat: 'chat.' } }; });
  await has('steer names an unknown rx', 'STEER_RX', (p) => { p.steer = { limits: [{ last: 'i99', to: 'greet' }] }; });
  const okSteer = await codes((p) => { p.intents.push(ans('how.step1'), ans('how.step2')); p.rx = { engine: { i11: { $rx: '^pri', flags: '' } } };
    p.steer = { ids: { yes: 'greet' }, prefix: { price: 'pri' }, limits: [{ last: 'i11', to: 'price' }], stepNext: { prefix: 'how.step', max: 2 },
      siblings: { team: { $rx: '^x', flags: '' }, words: [{ word: { $rx: '^y', flags: '' }, to: 'greet' }], other: 'price' } }; });
  check('a full steer table is valid', okSteer.length === 0, 'got: ' + JSON.stringify(okSteer));
  // flows (R2 5.1, 5.6): pages, routes to known pages, only the closed list's guards and actions; their lines are spoken
  const flowFx = () => [{ id: 'guided', start: 'idle',
    routeGroup: [{ if: ['said', { $rx: 'talk to', flags: 'i' }], do: [['say', { text: 'Of course.', chips: [] }], ['offerHandoff', null]], to: 'idle' }],
    pages: {
      idle: { interest: 'x', routes: [{ if: ['said', { $rx: 'price', flags: '' }], do: [['say', { text: 'Which market?', chips: [] }]], to: 'f/1' },
        { do: [['say', { text: 'Ask me.', chips: [] }]], to: 'idle' }] },
      'f/1': { flow: 'f', step: 1, interest: 'x', routes: [{ do: [['remember', 'markets'], ['say', { text: 'Thanks.', chips: [] }], ['offerHandoff', 'x']], to: 'idle' }] },
    } }];
  const okFlow = await codes((p) => { p.flows = flowFx(); });
  check('a flow on the closed list is valid', okFlow.length === 0, 'got: ' + JSON.stringify(okFlow));
  await has('flow guard not on the closed list', 'FLOW_NAME', (p) => { p.flows = flowFx(); p.flows[0].pages.idle.routes[0].if[0] = 'eval'; });
  await has('flow action not on the closed list', 'FLOW_NAME', (p) => { p.flows = flowFx(); p.flows[0].routeGroup[0].do.push(['fetch', 'https://example.com/']); });
  await has('flow route to an unknown page', 'FLOW_ROUTE', (p) => { p.flows = flowFx(); p.flows[0].pages['f/1'].routes[0].to = 'f/2'; });
  await has('flow start that is no page', 'FLOW_START', (p) => { p.flows = flowFx(); p.flows[0].start = 'nowhere'; });
  await has('$ amount in a flow line not in prices', 'MONEY_UNSOURCED', (p) => { p.flows = flowFx(); p.flows[0].pages.idle.routes[1].do[0][1].text = 'From $999.'; });
  const okBooking = await codes((p) => { p.forms[1].url = 'https://calendly.com/someone'; });
  check('booking on a listed host is valid', okBooking.length === 0, 'got: ' + JSON.stringify(okBooking));
  return results;
};
const MUTANTS = [
  { name: 'schema check off', patches: [{ file: 'validate.mjs', from: "if (m.schema !== SCHEMA)", to: 'if (false)' }], expect: [/META_SCHEMA/] },
  { name: 'answer check off', patches: [{ file: 'validate.mjs', from: "if (!answers(it))", to: 'if (false)' }], expect: [/INTENT_NO_ANSWER/] },
  { name: 'back-reference allowed', patches: [{ file: 'validate.mjs', from: "/\\\\[1-9]|\\\\k</", to: '/(?!)/' }], expect: [/back-reference/] },
  { name: 'nested repeat allowed', patches: [{ file: 'validate.mjs', from: "if (inner && outer)", to: 'if (false)' }], expect: [/nested repeat/] },
  { name: 'no timing probe', patches: [{ file: 'validate.mjs', from: "const times = await timePatterns(compiled);", to: 'const times = compiled.map(() => 0);' }], expect: [/CUE_SLOW/] },
  { name: 'slow threshold off', patches: [{ file: 'validate.mjs', from: "if (t > SLOW_MS)", to: 'if (t === -1)' }], expect: [/CUE_SLOW/] },
  { name: 'money check off', patches: [{ file: 'validate.mjs', from: "if (!allowed.has(n))", to: 'if (false)' }], expect: [/MONEY_UNSOURCED/] },
  { name: 'booking host unchecked', patches: [{ file: 'validate.mjs', from: "if (!hostOk(u.hostname))", to: 'if (false)' }], expect: [/FORM_HOST/] },
  { name: 'forbidden word unchecked', patches: [{ file: 'validate.mjs', from: "if (re.test(s))", to: 'if (false)' }], expect: [/FORBIDDEN_WORD/] },
  { name: 'rx not walked', patches: [{ file: 'validate.mjs', from: "if (typeof x.$rx === 'string') out.push", to: 'if (false) out.push' }], expect: [/RX_UNSAFE/, /RX_BAD_PATTERN/, /RX_SLOW/] },
  { name: 'claim source unchecked', patches: [{ file: 'validate.mjs', from: "if (!srcOk(c.source))", to: 'if (false)' }], expect: [/CLAIM_NO_SOURCE/] },
  { name: 'steer ids unchecked', patches: [{ file: 'validate.mjs', from: "if (!ids.has(id)) err('STEER_ID'", to: "if (false) err('STEER_ID'" }], expect: [/steer id not an intent/, /steer sibling target/] },
  { name: 'steer steps unchecked', patches: [{ file: 'validate.mjs', from: "if (!ids.has(pre + k))", to: 'if (false)' }], expect: [/steer next step missing/] },
  { name: 'steer prefix unchecked', patches: [{ file: 'validate.mjs', from: "if (typeof pre !== 'string' || !pre || ![...ids].some((id) => id.startsWith(pre)))", to: 'if (false)' }], expect: [/STEER_PREFIX/] },
  { name: 'steer rx unchecked', patches: [{ file: 'validate.mjs', from: "if (!isObj(p?.rx?.engine) || !isObj(p.rx.engine[r?.last]))", to: 'if (false)' }], expect: [/STEER_RX/] },
  { name: 'flow closed list unchecked', patches: [{ file: 'validate.mjs', from: "if (r?.if !== undefined && !GUARDS.has(r.if?.[0]))", to: 'if (false)' }], expect: [/flow guard not on the closed list/] },
  { name: 'flow lines not spoken', patches: [{ file: 'validate.mjs', from: "for (const k of ['texts', 'script', 'refusals', 'flows'])", to: "for (const k of ['texts', 'script', 'refusals'])" }], expect: [/\$ amount in a flow line/] },
  { name: 'missing fact used unchecked', patches: [{ file: 'validate.mjs', from: "if (missing.has(k))", to: 'if (false)' }], expect: [/FACT_MISSING_USED/] },
];
process.exit(await main({ label: 'PACK VALIDATOR', scenarios, MUTANTS, scriptsDir: path.join(here, '../pack'), argv: process.argv.slice(2) }));
