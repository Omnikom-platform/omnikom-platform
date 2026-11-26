// Tests of the race scorers (factory/advisor/engine/scorers/), with watched-fail mutants in the repo's pattern
// (skills/programmatic-enterprise-web-performance/scripts/lib-test-kit.mjs main(): each mutant must turn its named assertions red).
// Run: node factory/advisor/test/test-scorers.mjs   -> "SCORERS TEST PASS: n of n" then "MUTANTS PASS: n of n caught"
// Each scorer takes its library as an argument (the mutant copy of engine/scorers/ lives in a temp folder with no node_modules).
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import MiniSearch from 'minisearch';
import { create, insert, search } from '@orama/orama';
import { main, checker } from '../../../skills/programmatic-enterprise-web-performance/scripts/lib-test-kit.mjs';
import { createAdvisor } from '../engine/index.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const pack = JSON.parse(readFileSync(path.join(here, '../packs/omnikom-io/pack.json'), 'utf8'));
// fixture documents: intents a, b, c in pack order; tokens as the matcher makes them
const DOCS = [
  { intent: 'a', tokens: ['price', 'base'] },
  { intent: 'a', tokens: ['how', 'much', '#n', 'caller'] },
  { intent: 'b', tokens: ['crm', 'hubspot'] },
  { intent: 'c', tokens: ['record', 'call', 'consent'] },
];
const QUERIES = [['crm', 'hubspot'], ['price'], ['price', 'base', 'extra', 'word'], ['crm', 'hubspot', 'price'], ['how', 'much', '#n', 'caller', 'record'], ['call']];
const TURNS = ['how much is it', 'do you work with hubspot', 'we have 5 callers', 'what states do you cover', 'thanks'];
const scenarios = async (dir) => {
  const results = [], check = checker(results);
  const url = (f) => pathToFileURL(path.join(dir, f)).href + '?' + Date.now();
  let made;
  try {
    const { minisearchScorer } = await import(url('minisearch.mjs'));
    const { oramaScorer } = await import(url('orama.mjs'));
    made = { minisearch: minisearchScorer(MiniSearch), orama: oramaScorer({ create, insert, search }) };
  } catch (e) {
    check('the scorers load', false, e.message);
    return results;
  }
  for (const [name, scorer] of Object.entries(made)) {
    const s = scorer.build(DOCS);
    const own = s.best(['crm', 'hubspot']).get('b');
    check(name + ': a phrasing queried with its own words scores its intent 1', Math.abs((own ?? 0) - 1) < 1e-9, 'got ' + own);
    const all = QUERIES.flatMap((q) => [...s.best(q).values()]);
    check(name + ': every score is between 0 and 1', all.length > 0 && all.every((v) => v >= 0 && v <= 1), 'got ' + JSON.stringify(all));
    const part = s.best(['price']).get('a');
    check(name + ': a partial match scores between 0 and 1', part > 0 && part < 1, 'got ' + part);
    const twice = JSON.stringify([...s.best(QUERIES[4])]) === JSON.stringify([...s.best(QUERIES[4])]);
    check(name + ': the same query twice gives the same scores', twice, '');
    check(name + ': no match gives no intent', s.best(['zzz']).size === 0 && s.best([]).size === 0, '');
    const order = [...s.best(['crm', 'hubspot', 'price']).keys()];
    check(name + ': intents come back in pack order', JSON.stringify(order) === '["a","b"]', 'got ' + JSON.stringify(order));
    let replies = [];
    try {
      const { engine, initialState } = createAdvisor(pack, { scorer });
      let st = initialState();
      for (const t of TURNS) { const r = engine.respond(st, t); st = r.state; replies.push(r.reply?.text ?? r.reply); }
    } catch (e) { replies = ['THROWS ' + e.message]; }
    check(name + ': the engine answers turns with this scorer', replies.length === TURNS.length && replies.every((r) => typeof r === 'string' && r.length > 0 && !r.startsWith('THROWS')), JSON.stringify(replies).slice(0, 200));
  }
  return results;
};
const MUTANTS = [
  { name: 'self-score division off', patches: [{ file: 'rank.mjs', from: 'Math.min(1, score / own)', to: 'score' }], expect: [/minisearch: every score is between 0 and 1/, /orama: every score is between 0 and 1/] },
  { name: 'pack order off', patches: [{ file: 'rank.mjs', from: '.sort((x, y) => first.get(x[0]) - first.get(y[0]))', to: '' }], expect: [/minisearch: intents come back in pack order/, /orama: intents come back in pack order/] },
];
process.exit(await main({ label: 'SCORERS', scenarios, MUTANTS, scriptsDir: path.join(here, '../engine/scorers'), argv: process.argv.slice(2) }));
