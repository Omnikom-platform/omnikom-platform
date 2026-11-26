// The guided script runs on XState (docs/advisor/r3/HANDOVER-xstate.md; ruled A by the head 2026-11-27 01:01): one machine built
// from pack.flows, answering byte for byte as today's interpreter did. The reference is test/script-oracle.mjs with
// fixtures/script-37fac63.json, both frozen at 37fac63b. The paths come from @xstate/graph (dev only): the shortest path to every
// page, then every line of the corpus from there. The corpus: the script's own chips and buttons, golden's 431 messages and one
// plain line per pattern.
// Run: node factory/advisor/test/test-flows.mjs  -> "FLOWS TEST PASS: n of n" then "MUTANTS PASS: n of n caught"
import './deps-hook.mjs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getShortestPaths } from '@xstate/graph';
import { main, checker } from '../../../skills/programmatic-enterprise-web-performance/scripts/lib-test-kit.mjs';
import { createScript as createOracle } from './script-oracle.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const J = (p) => JSON.parse(readFileSync(path.join(here, p), 'utf8'));
const revive = (x) => Array.isArray(x) ? x.map(revive) : x && typeof x === 'object'
  ? (typeof x.$rx === 'string' ? new RegExp(x.$rx, x.flags ?? '') : Object.fromEntries(Object.entries(x).map(([k, v]) => [k, revive(v)]))) : x;
const PACK = J('../packs/omnikom-io/pack.json');
const OLD = revive(J('fixtures/script-37fac63.json'));
const oracle = createOracle(OLD, PACK.tuning).getScriptedReply;
const OWN = ['how much does it cost', 'is my data safe in your crm', 'do you guarantee deals', 'I need more sellers', 'we want a full team',
  'help with follow up', 'talk to a person', 'ask another question', 'Build my team', 'request my team plan', 'hello', 'Texas and Florida', '12', ''];
const chips = [OLD.faqChoices, OLD.menuReplies, OLD.again, OLD.fallback.chips, ...OLD.rules.map((r) => r.chips),
  ...Object.values(OLD.flows).flat().map((s) => s.chips)].flat();
const CORPUS = [...new Set([...chips, ...J('golden-turns.json').pool, ...OWN])];
const same = (a, b) => isDeepStrictEqual(a, b) && JSON.stringify(a) === JSON.stringify(b);
const START = { flow: 'idle', step: 0 };

const scenarios = async (dir) => {
  const results = [], check = checker(results);
  const { createAdvisor } = await import(pathToFileURL(path.join(dir, 'index.mjs')).href);
  const { flow } = createAdvisor(PACK);
  const pages = Object.keys(PACK.flows?.[0]?.pages ?? {});
  check('the guided script runs on an XState machine built from pack.flows', typeof flow.machine?.transition === 'function' && pages.length > 1 &&
    Object.keys(flow.machine.root?.states ?? {}).sort().join() === [...pages].sort().join(), 'machine ' + typeof flow.machine + ', pages ' + pages.length);
  if (typeof flow.machine?.transition !== 'function') return results;

  // the shortest path to every page, each step a line of the corpus
  const paths = getShortestPaths(flow.machine, { events: CORPUS.map((text) => ({ type: 'TEXT', text })), serializeState: (s) => JSON.stringify(s.value) });
  const reached = new Set(paths.map((p) => JSON.stringify(p.state.value)));
  check('@xstate/graph reaches every page', pages.every((p) => reached.has(JSON.stringify(p))), [...reached].join(' '));

  let compared = 0;
  const diffs = [], said = new Map();
  for (const p of paths) {
    let po = START, pn = START;
    for (const step of p.steps) {
      if (!step.event?.text && step.event?.text !== '') continue;
      const o = oracle(step.event.text, po), n = flow.scripted(step.event.text, pn);
      compared++;
      if (!same(o, n)) diffs.push({ path: p.steps.map((s) => s.event?.text), o, n });
      po = o.progress; pn = n.progress;
    }
    const page = JSON.stringify(p.state.value);
    for (const text of CORPUS) {
      const o = oracle(text, po), n = flow.scripted(text, pn);
      compared++;
      if (!same(o, n)) diffs.push({ at: page, text, o, n });
      const seen = said.get(page) ?? new Set();
      seen.add(o.text + ' -> ' + JSON.stringify(o.progress.flow + o.progress.step));
      said.set(page, seen);
    }
  }
  check('every path answers byte-equal to today\'s interpreter (' + compared + ' replies compared)', compared > 1000 && diffs.length === 0,
    diffs.length + ' differ; first: ' + JSON.stringify(diffs.slice(0, 2)));
  const routes = (id) => (PACK.flows[0].routeGroup?.length ?? 0) + PACK.flows[0].pages[id].routes.length;
  const short = pages.filter((id) => (said.get(JSON.stringify(id))?.size ?? 0) !== routes(id));
  check('every route of every page is taken by the corpus', short.length === 0, short.map((id) => id + ' ' + (said.get(JSON.stringify(id))?.size ?? 0) + ' of ' + routes(id)).join('; '));

  // the saved position: a round trip, and a stale or tampered one starts fresh
  const mid = flow.scripted('Brokerage', flow.scripted('I need more sellers', START).progress).progress;
  const saved = flow.save(mid);
  check('save then load gives the same position', mid.flow !== 'idle' && same(flow.load(saved), mid), saved);
  const bad = (f) => { const s = JSON.parse(saved); f(s); return flow.load(JSON.stringify(s)); };
  check('another engine or pack version starts fresh', same(bad((s) => { s.v += 'x'; }), START));
  check('a page the machine does not have starts fresh', same(bad((s) => { s.at.step = 99; }), START));
  check('an answer that is not a short string starts fresh', same(bad((s) => { s.at.answers = { ...s.at.answers, businessType: { x: 1 } }; }), START));
  check('an unreadable save starts fresh', same(flow.load('{not json'), START));
  return results;
};
const MUTANTS = [
  { name: 'remember dropped', patches: [{ file: 'flows.mjs', from: 'answers: ({ context, event }, { arg }) => ({ ...context.answers, [arg]: event.text })', to: 'answers: ({ context }) => context.answers' }], expect: [/byte-equal/] },
  { name: 'route group last', patches: [{ file: 'flows.mjs', from: '[...group, ...page.routes]', to: '[...page.routes, ...group]' }], expect: [/byte-equal/] },
  { name: 'guards ignored', patches: [{ file: 'flows.mjs', from: 'rx.test(raw ? event.text : event.text.toLowerCase())', to: 'true' }], expect: [/byte-equal/] },
  { name: 'stale save kept', patches: [{ file: 'flows.mjs', from: 'if (s?.v !== TAG) return fresh();', to: '' }], expect: [/another engine or pack version/] },
];
process.exit(await main({ label: 'FLOWS', scenarios, MUTANTS, scriptsDir: path.join(here, '../engine'), argv: process.argv.slice(2) }));
