// Golden multi-turn conversations for the omnikom-io pack: the engine's replies, turn by turn, pinned as hashes.
// cp11 is mostly single turns; this file pins the follow-up paths (a bare number after a price, "and the isa?", "next",
// "do you cover it", consent after the recording answer, yes/repeat) so a refactor of the engine shows any change.
// Run: node factory/advisor/test/golden-turns.mjs          -> "GOLDEN TURNS PASS: n of n turns" (exit 1 on any change)
//      node factory/advisor/test/golden-turns.mjs --write  -> writes golden-turns.json from the engine as it is now
// The conversations are drawn by a seeded generator from the pack's own labels, phrasings and next-buttons, plus FOLLOW.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createAdvisor } from '../engine/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PACK = join(here, '../packs/omnikom-io/pack.json');
const OUT = join(here, 'golden-turns.json');
const SEED = 20261126, CONVERSATIONS = 700, H = 8;
// the grid: every intent of the families the follow-up rules read, opened by its button, then every FOLLOW line
const GRID = /^(?:svc|price|how|crm|mkt|comp|slot)\./;
// hand-written paths the grid cannot reach: a slot filled first, then a question about it
const SCRIPTS = [['we use hubspot', 'does that integrate'], ['we use hubspot', 'will it work with it?'], ['salesforce', 'the leads go there'],
  ['we use follow up boss', 'can the data go in it'], ['we have 10 callers', 'how much would that come to'], ['5 callers', 'what would it total'],
  ['texas', 'do you cover it'], ["we're in texas", 'do you work there?'], ['we are in florida', 'can you work there?', 'and ohio'],
  ['how much', '3', 'next'], ['what states do you cover', 'texas', 'florida and ohio'], ['do you record calls', 'do i need consent', 'two party?'],
  ['we have 4 agents', 'how much would that cost'], ['production team', 'is it dedicated', 'how much is that'], ['isa', 'what are the limits', 'price?'],
  ['hablas espanol?'], ['do you speak spanish?'], ['¿hablan español?', 'ok']];

// short follow-ups a visitor types after an answer; no real personal data (example.com, 555-01xx)
const FOLLOW = ['5', '12', 'twenty', '50 callers', '3 people', 'we have 8 agents', '2', 'the first one', 'and isa?', 'what about the isa',
  'tc', 'transaction coordinator', 'marketing', 'production team', 'and production?', 'what about marketing then', 'isa price',
  'what are the limits', "what's not included", "what can't it do", 'is it dedicated', 'just for us?', 'exclusive?', 'next', 'next step',
  'what next', 'ok then what', 'what happens next', 'how much is that', 'what does that cost', 'and the price?', 'how much would that come to',
  'what would it total', 'what about the cost', 'does that integrate', 'will it work with hubspot', 'can it sync', 'does it connect',
  'do you cover it', 'do you serve that', 'can you work there?', 'texas', 'florida and ohio', 'california', 'what about new york and texas',
  'in phoenix', 'we use hubspot', 'salesforce', 'follow up boss', 'the leads go there', 'can the data go in it', 'put my sellers into it',
  'do i need consent', 'two party?', 'does everyone have to agree', 'yes', 'no', 'ok', 'sure', 'say that again', 'what?', 'huh',
  'hola', 'cuanto cuesta?', 'my email is me@example.com', 'call me at 555-0100', 'we are a real estate team', 'solo agent',
  'how much', 'price?', 'how much per caller', 'is that included', 'can u do that for me', 'thanks', 'bye'];

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const stable = (v) => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
  : JSON.stringify(v ?? null);
const hash = (x) => createHash('sha256').update(stable(x)).digest('hex').slice(0, H);

const pack = JSON.parse(readFileSync(PACK, 'utf8'));
const { engine, initialState } = createAdvisor(pack);
const labels = pack.intents.map((i) => i.label).filter(Boolean);
const phrasings = pack.intents.map((i) => i.phrasings?.[0]).filter(Boolean);

const opener = (i) => i.label || i.phrasings?.[0];
function grid(starts, follows) {
  return starts.map((s) => { const one = engine.respond(initialState(), s);
    return hash({ reply: one.reply, state: one.state }) + follows.map((f) => { const two = engine.respond(one.state, f); return hash({ reply: two.reply, state: two.state }); }).join(''); });
}
function play(msgs) { let state = initialState(); return msgs.map((m) => { const out = engine.respond(state, m); state = out.state; return hash({ reply: out.reply, state }); }); }

if (process.argv.includes('--write')) {
  const r = rng(SEED), pick = (xs) => xs[Math.floor(r() * xs.length)];
  const pool = [], at = new Map(), idx = (m) => { if (!at.has(m)) { at.set(m, pool.length); pool.push(m); } return at.get(m); };
  const convs = [];
  for (let c = 0; c < CONVERSATIONS; c++) {
    const n = 2 + Math.floor(r() * 5), msgs = [];
    let state = initialState(), choices = [];
    for (let t = 0; t < n; t++) {
      const x = r();
      const m = t === 0 ? (x < 0.4 ? pick(phrasings) : x < 0.7 ? pick(labels) : pick(FOLLOW))
        : choices.length && x < 0.35 ? pick(choices) : x < 0.75 ? pick(FOLLOW) : x < 0.9 ? pick(phrasings) : pick(labels);
      const out = engine.respond(state, m); state = out.state;
      choices = (out.reply.choices || []).map((ch) => typeof ch === 'string' ? ch : ch.label).filter(Boolean);
      msgs.push(m);
    }
    const hs = play(msgs);
    convs.push(msgs.map((m, i) => [idx(m), hs[i]]));
  }
  for (const s of SCRIPTS) { const hs = play(s); convs.push(s.map((m, i) => [idx(m), hs[i]])); }
  const starts = [...new Set(pack.intents.filter((i) => GRID.test(i.id)).map(opener).filter(Boolean))];
  const g = { starts: starts.map(idx), follows: FOLLOW.map(idx), hashes: grid(starts, FOLLOW) };
  writeFileSync(OUT, JSON.stringify({ note: 'written by golden-turns.mjs --write; pack ' + pack.meta.pack + ' ' + pack.meta.version, seed: SEED, pool, convs, grid: g }) + '\n');
  console.log('GOLDEN TURNS WRITTEN: ' + convs.length + ' conversations, ' + convs.reduce((s, c) => s + c.length, 0) + ' turns, grid ' + starts.length + ' x ' + FOLLOW.length + ', ' + pool.length + ' distinct messages');
} else {
  const g = JSON.parse(readFileSync(OUT, 'utf8'));
  let turns = 0; const bad = [];
  for (const [ci, conv] of g.convs.entries()) {
    const msgs = conv.map(([i]) => g.pool[i]);
    const hs = play(msgs);
    conv.forEach(([, h], ti) => { turns++; if (hs[ti] !== h) bad.push('conversation ' + ci + ' turn ' + (ti + 1) + ': ' + JSON.stringify(msgs.slice(0, ti + 1))); });
  }
  const gh = grid(g.grid.starts.map((i) => g.pool[i]), g.grid.follows.map((i) => g.pool[i]));
  g.grid.hashes.forEach((want, si) => { for (let k = 0; k < want.length / H; k++) { turns++; if (gh[si].slice(k * H, k * H + H) !== want.slice(k * H, k * H + H))
    bad.push('grid: ' + JSON.stringify(g.pool[g.grid.starts[si]]) + (k ? ' then ' + JSON.stringify(g.pool[g.grid.follows[k - 1]]) : ' (first turn)')); } });
  if (bad.length) { console.log(bad.slice(0, 15).join('\n')); console.log('GOLDEN TURNS FAIL: ' + bad.length + ' of ' + turns + ' turns changed'); process.exit(1); }
  console.log('GOLDEN TURNS PASS: ' + turns + ' of ' + turns + ' turns');
}
