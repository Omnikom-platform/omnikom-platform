// Measures each session's context load so a head is swapped for a fresh one at a slice boundary (docs/departments/briefs/
// context-load-and-handover.md). Read-only over the session transcripts of this project; prints titles and numbers, never message text
// beyond the title.
//   node tools/departments/context-load.mjs [--json] [--dir <folder>] [--window-hours 36] [--now <iso|epoch-ms>]
//        [--swap-context 250000] [--swap-compactions 2] [--swap-cost 5] [--watch-context 150000] [--watch-compactions 1]
//        [--fresh-context 40000] [--last-turns 20]
// Per session (a transcript touched in the window): the last real turn's context = input + cache read + cache creation tokens
// (a <synthetic> turn or a zero-usage turn is not a turn), the model, compactions (isCompactSummary lines), turns, the title
// (custom title, else summary, else the first user line), and the cost of one turn in input-token equivalents
//   cache read x 0.1 + cache write x 1.25 + input x 1 + output x 5, averaged over the last N turns,
// next to what the same turns would cost at a fresh session's context (cache read of --fresh-context, same writes, input, output).
// Verdict: SWAP at context >= swap-context, or compactions >= swap-compactions, or cost >= swap-cost times the fresh cost;
// WATCH at context >= watch-context or compactions >= watch-compactions; else OK. Heaviest context first. Exit 0 (2 = usage).
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const DEFAULT_DIR = join(homedir(), '.claude', 'projects', 'E--Omnikom-Platform');
const NUM_FLAGS = {
  'window-hours': 36, 'swap-context': 250000, 'swap-compactions': 2, 'swap-cost': 5,
  'watch-context': 150000, 'watch-compactions': 1, 'fresh-context': 40000, 'last-turns': 20,
};
const W = { read: 0.1, write: 1.25, input: 1, output: 5 };   // price of a token in input-token equivalents

function usage(msg) { console.error(msg); process.exit(2); }

function parseArgs(argv) {
  const o = { json: false, dir: DEFAULT_DIR, now: Date.now(), ...NUM_FLAGS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) usage(`unexpected argument ${a}`);
    const k = a.slice(2);
    if (k === 'json') { o.json = true; continue; }
    const v = argv[++i];
    if (v === undefined) usage(`--${k} needs a value`);
    if (k === 'dir') o.dir = resolve(v);
    else if (k === 'now') { const t = /^\d+$/.test(v) ? Number(v) : Date.parse(v); if (!Number.isFinite(t)) usage(`--now: not a time: ${v}`); o.now = t; }
    else if (k in NUM_FLAGS) { const n = Number(v); if (!Number.isFinite(n) || n <= 0) usage(`--${k}: not a positive number: ${v}`); o[k] = n; }
    else usage(`unknown flag --${k}`);
  }
  return o;
}

const tokens = u => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
const firstText = c => typeof c === 'string' ? c : Array.isArray(c) ? (c.find(b => b && b.type === 'text' && typeof b.text === 'string') || {}).text || '' : '';

async function readSession(file) {
  const s = { title: '', summary: '', firstUser: '', compactions: 0, turns: [], model: '' };
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const l of rl) {
    if (!l) continue;
    const wantUser = !s.firstUser && l.includes('"user"');
    if (!(wantUser || l.includes('"usage"') || l.includes('isCompactSummary') || l.includes('"custom-title"') || l.includes('"summary"'))) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.type === 'custom-title') s.title = j.customTitle || s.title;
    if (j.type === 'summary') s.summary = j.summary || s.summary;
    if (j.isCompactSummary === true) s.compactions++;
    else if (!s.firstUser && j.type === 'user') s.firstUser = firstText(j.message && j.message.content).slice(0, 70);
    const u = j.message && j.message.usage;
    if (j.type === 'assistant' && u && j.message.model !== '<synthetic>' && tokens(u) > 0) {
      s.turns.push({ input: u.input_tokens || 0, read: u.cache_read_input_tokens || 0, write: u.cache_creation_input_tokens || 0, output: u.output_tokens || 0 });
      s.model = j.message.model || s.model;
    }
  }
  return s;
}

function analyse(id, st, s, o) {
  const last = s.turns[s.turns.length - 1];
  const context = last.input + last.read + last.write;
  const tail = s.turns.slice(-o['last-turns']);
  const avg = f => tail.reduce((a, t) => a + f(t), 0) / tail.length;
  const costPerTurn = avg(t => t.read * W.read + t.write * W.write + t.input * W.input + t.output * W.output);
  const freshCostPerTurn = o['fresh-context'] * W.read + avg(t => t.write * W.write + t.input * W.input + t.output * W.output);
  const costRatio = costPerTurn / freshCostPerTurn;
  const reasons = [];
  let verdict = 'OK';
  if (context >= o['swap-context']) reasons.push(`context ${context} >= ${o['swap-context']}`);
  if (s.compactions >= o['swap-compactions']) reasons.push(`compactions ${s.compactions} >= ${o['swap-compactions']}`);
  if (costRatio >= o['swap-cost']) reasons.push(`cost ${costRatio.toFixed(1)}x fresh >= ${o['swap-cost']}x`);
  if (reasons.length) verdict = 'SWAP';
  else {
    if (context >= o['watch-context']) reasons.push(`context ${context} >= ${o['watch-context']}`);
    if (s.compactions >= o['watch-compactions']) reasons.push(`compactions ${s.compactions} >= ${o['watch-compactions']}`);
    if (reasons.length) verdict = 'WATCH';
  }
  return {
    id: id.slice(0, 8), file: id, verdict, reasons, model: s.model, contextTokens: context, compactions: s.compactions, turns: s.turns.length,
    title: (s.title || s.summary || s.firstUser).replace(/\s+/g, ' ').slice(0, 60), ageMinutes: Math.max(0, Math.round((o.now - st.mtimeMs) / 60000)),
    cacheReadTotal: s.turns.reduce((a, t) => a + t.read, 0), cacheWriteTotal: s.turns.reduce((a, t) => a + t.write, 0),
    costPerTurn: Math.round(costPerTurn), freshCostPerTurn: Math.round(freshCostPerTurn), costRatio: Math.round(costRatio * 10) / 10,
  };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  let names;
  try { names = readdirSync(o.dir).filter(f => f.endsWith('.jsonl')); } catch (e) { console.error(`cannot read ${o.dir}: ${e.code || e.message}`); process.exit(2); }
  const since = o.now - o['window-hours'] * 3600e3;
  const rows = [];
  for (const f of names) {
    const p = join(o.dir, f);
    const st = statSync(p);
    if (st.mtimeMs < since) continue;
    const s = await readSession(p);
    if (s.turns.length === 0) continue;
    rows.push(analyse(f.replace(/\.jsonl$/, ''), st, s, o));
  }
  rows.sort((a, b) => b.contextTokens - a.contextTokens);
  if (o.json) {
    const thresholds = Object.fromEntries(Object.keys(NUM_FLAGS).map(k => [k, o[k]]));
    console.log(JSON.stringify({ dir: o.dir, now: new Date(o.now).toISOString(), thresholds, sessions: rows }, null, 2));
    return;
  }
  const k = n => (n / 1000).toFixed(1) + 'k';
  for (const r of rows) {
    console.log(`${r.verdict.padEnd(5)} ${r.id} ctx=${String(r.contextTokens).padStart(7)} comp=${r.compactions} turns=${String(r.turns).padStart(5)} cost/turn=${k(r.costPerTurn)} (${r.costRatio}x fresh) cacheRead=${(r.cacheReadTotal / 1e6).toFixed(1)}M ${r.ageMinutes}m ${r.model} | ${r.title}`);
  }
  console.log(`${rows.length} session(s) active in the last ${o['window-hours']} h; SWAP at ctx>=${o['swap-context']} or comp>=${o['swap-compactions']} or cost>=${o['swap-cost']}x fresh (${o['fresh-context']} tokens); WATCH at ctx>=${o['watch-context']} or comp>=${o['watch-compactions']}`);
}

main().catch(e => { console.error(e && e.stack || String(e)); process.exitCode = 1; });
