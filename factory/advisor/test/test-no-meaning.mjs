// cp11's 3 inputs with no meaning that still got an answer (#902, #887, #873), first turn, on omnikom.io's pack. The grader's
// rule (the head's harness, read-only): a case with no expected intent is FAIL when the band is "answer" or "flow".
// Hand-over: docs/advisor/r3/HANDOVER-cp11-fail-rows.md (#873 ruled A by the head, 2026-11-26 23:56).
// Run: node factory/advisor/test/test-no-meaning.mjs  -> "NO MEANING TEST PASS: n of n" then "MUTANTS PASS: n of n caught"
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { main, checker } from '../../../skills/programmatic-enterprise-web-performance/scripts/lib-test-kit.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const show = (x) => JSON.stringify(x);
// #873's reply as cp11 recorded it on today's engine (checkpoints/cp11-results.jsonl, row 873): the words stay byte-equal
const UNPUBLISHED = 'That is not on our pages. The Get Started form puts your question in front of the team.';
const scenarios = async (dir) => {
  const results = [], check = checker(results);
  const { createAdvisor } = await import(pathToFileURL(path.join(dir, 'index.mjs')).href);
  const { engine, initialState } = createAdvisor(JSON.parse(readFileSync(path.join(here, '../packs/omnikom-io/pack.json'), 'utf8')));
  const say = (lines) => { let s = initialState(), r; for (const t of lines) { r = engine.respond(s, t); s = r.state; } return r.reply; };
  const next = (r) => (r.choices ?? []).length > 0 || !!r.showContactLink;
  const unanswered = (r) => r.band !== 'answer' && r.band !== 'flow' && next(r);
  let r = say(['123']);
  check('#902 "123" on the first turn is not answered', unanswered(r), show(r));
  r = say(['<script>alert(1)</script>']);
  check('#887 markup is not words', unanswered(r), show(r));
  r = say(["what's the caller's salary"]);
  check('#873 the not-published reply abstains, with the form', r.band === 'abstain' && r.showContactLink, show(r));
  check('#873 its words are byte-equal to today\'s', r.text === UNPUBLISHED, r.text);
  // meaning in context stays: a number right after a price, a question about scripts
  r = say(['how much', '3']);
  check('a number right after the price still answers', r.band === 'answer', show(r));
  r = say(['there are 4 of us']);
  check('a sentence with a number is not a bare number (cp11 #467)', r.band === 'answer' && r.intents.includes('slot.team'), show(r));
  r = say(['New agents', 'will it work with hubspot', '3 people', '12']);
  check('a number later in a chat still refines the team (golden)', r.band === 'answer' && r.intents.includes('slot.team'), show(r));
  r = say(['do you write the calling scripts']);
  check('a question about scripts still answers', r.band === 'answer' && r.intents.includes('svc.cold_scripts'), show(r));
  return results;
};
const MUTANTS = [
  { name: 'a bare number answered', patches: [{ file: 'engine.mjs', from: 'if (state.turns === 1 && bareCount(message) && ranking.tokens.every((t) => t === "#n"))', to: 'if (false)' }], expect: [/#902/] },
  { name: 'markup read as words', patches: [{ file: 'engine.mjs', from: 'rawMessage.replace(R.MARKUP, " ")', to: 'rawMessage' }], expect: [/#887/] },
  { name: 'not published answers', patches: [{ file: 'engine.mjs', from: 'return { ...out, reply: { ...out.reply, band: "abstain" } };', to: 'return out;' }], expect: [/#873/] },
];
process.exit(await main({ label: 'NO MEANING', scenarios, MUTANTS, scriptsDir: path.join(here, '../engine'), argv: process.argv.slice(2) }));
