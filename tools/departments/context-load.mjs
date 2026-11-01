// Measures each session's context load and what it costs, so a head is swapped for a fresh one at a slice boundary when the swap
// pays for itself (skills/context-economics/SKILL.md has the math and its sources). Read-only over the session transcripts of
// this project; prints titles and numbers, never message text beyond the title.
//   node tools/departments/context-load.mjs [--json] [--dir <folder>] [--prices <file>] [--window-hours 36] [--now <iso|epoch-ms>]
//        [--fresh-context 132000] [--orient-calls 20] [--orient-output 560] [--horizon-calls 100]
//        [--swap-compactions 2] [--watch-compactions 1] [--last-turns 20] [--quality-calls 100] [--miss-share 0.5]
// A call is one API response: Claude Code writes one transcript line per content block, each repeating the message id and the
// usage, so calls are counted once per message id (a <synthetic> or zero-usage line is not a call).
// Per session: context = input + cache read + cache write of the last call; dollars per call from prices.json (per model, per
// prompt-length band, cache writes split by TTL); cache-read share; the fresh-session start cost
//   S = F x write + orient-calls x (F/2 x read + orient-output x output)      (F = --fresh-context)
// and the context at which swapping pays back within --horizon-calls calls: swapAt = F + S / (horizon x read); watchAt uses
// twice the horizon. Verdict: SWAP at context >= swapAt or compactions >= swap-compactions; WATCH at context >= watchAt,
// compactions >= watch-compactions, or a model with no price; else OK. Also: cache misses (a call after the first whose read
// share is below --miss-share), COLD (idle longer than the cache TTL: the next turn rewrites the whole context), and tool
// errors per 100 calls over the last --quality-calls calls. Heaviest context first. Exit 0 (2 = usage).
import { createReadStream, readdirSync, statSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIR = join(homedir(), '.claude', 'projects', 'E--Omnikom-Platform');
const DEFAULT_PRICES = join(dirname(fileURLToPath(import.meta.url)), 'prices.json');
const NUM_FLAGS = {
  'window-hours': 36, 'swap-compactions': 2, 'watch-compactions': 1, 'fresh-context': 132000, 'orient-calls': 20,
  'orient-output': 560, 'horizon-calls': 100, 'last-turns': 20, 'quality-calls': 100, 'miss-share': 0.5,
};

function usage(msg) { console.error(msg); process.exit(2); }

function parseArgs(argv) {
  const o = { json: false, dir: DEFAULT_DIR, prices: DEFAULT_PRICES, now: Date.now(), ...NUM_FLAGS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) usage(`unexpected argument ${a}`);
    const k = a.slice(2);
    if (k === 'json') { o.json = true; continue; }
    const v = argv[++i];
    if (v === undefined) usage(`--${k} needs a value`);
    if (k === 'dir') o.dir = resolve(v);
    else if (k === 'prices') o.prices = resolve(v);
    else if (k === 'now') { const t = /^\d+$/.test(v) ? Number(v) : Date.parse(v); if (!Number.isFinite(t)) usage(`--now: not a time: ${v}`); o.now = t; }
    else if (k in NUM_FLAGS) { const n = Number(v); if (!Number.isFinite(n) || n < 0 || (n === 0 && k !== 'orient-output')) usage(`--${k}: not a positive number: ${v}`); o[k] = n; }
    else usage(`unknown flag --${k}`);
  }
  return o;
}

function loadPrices(file) {
  let p; try { p = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { usage(`cannot read prices ${file}: ${e.code || e.message}`); }
  if (!p || !p.models || !p.cache || !p.cache.ttlMinutes || !(p.cache.defaultWriteTtl in p.cache.ttlMinutes)) usage(`prices ${file}: needs models and cache.defaultWriteTtl / ttlMinutes`);
  return p;
}
// the price band of a model for a prompt of n tokens (input + cache read + cache write); null = no price for that model
function band(P, model, n) {
  const m = P.models[String(model).replace(/\[[^\]]*\]$/, '')];
  return m ? m.bands.find(b => b.upTo === null || n <= b.upTo) || null : null;
}
const writePrice = (P, b) => P.cache.defaultWriteTtl === '5m' ? b.write5m : b.write1h;
const prompt = c => c.input + c.read + c.write;
// a call's price in micro-dollars (tokens x $ per million): writes split by TTL, unsplit writes at the default TTL
function micro(P, c) {
  const b = band(P, c.model, prompt(c)); if (!b) return null;
  const rest = Math.max(0, c.write - c.w5m - c.w1h);
  return c.input * b.input + c.read * b.read + c.w5m * b.write5m + c.w1h * b.write1h + rest * writePrice(P, b) + c.output * b.output;
}
// the swap thresholds for one model: start cost S of a fresh session and the contexts at which it pays back
function thresholds(P, model, o) {
  const F = o['fresh-context'], b = band(P, model, F); if (!b) return null;
  const S = F * writePrice(P, b) + o['orient-calls'] * (F / 2 * b.read + o['orient-output'] * b.output);
  return { startUsd: S / 1e6, swapAt: Math.round(F + S / (o['horizon-calls'] * b.read)), watchAt: Math.round(F + S / (2 * o['horizon-calls'] * b.read)), read: b.read, S };
}

const firstText = c => typeof c === 'string' ? c : Array.isArray(c) ? (c.find(b => b && b.type === 'text' && typeof b.text === 'string') || {}).text || '' : '';

async function readSession(file) {
  const s = { title: '', summary: '', firstUser: '', compactions: 0, calls: [], errors: [], model: '' };
  const seen = new Set(); let anon = 0;
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const l of rl) {
    if (!l) continue;
    const wantUser = !s.firstUser && l.includes('"user"');
    if (!(wantUser || l.includes('"usage"') || l.includes('isCompactSummary') || l.includes('"custom-title"') || l.includes('"summary"') || l.includes('"is_error":true'))) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.type === 'custom-title') s.title = j.customTitle || s.title;
    if (j.type === 'summary') s.summary = j.summary || s.summary;
    if (j.isCompactSummary === true) s.compactions++;
    else if (!s.firstUser && j.type === 'user') s.firstUser = firstText(j.message && j.message.content).slice(0, 70);
    const m = j.message;
    if (j.type === 'user' && m && Array.isArray(m.content)) for (const b of m.content) if (b && b.type === 'tool_result' && b.is_error === true) s.errors.push(s.calls.length);
    const u = m && m.usage;
    if (j.type === 'assistant' && u && m.model !== '<synthetic>') {
      const c = { model: m.model || '', input: u.input_tokens || 0, read: u.cache_read_input_tokens || 0, write: u.cache_creation_input_tokens || 0, output: u.output_tokens || 0,
        w5m: (u.cache_creation && u.cache_creation.ephemeral_5m_input_tokens) || 0, w1h: (u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0 };
      if (prompt(c) === 0) continue;
      const key = m.id || j.requestId || `anon-${++anon}`;
      if (seen.has(key)) continue;
      seen.add(key);
      s.calls.push(c);
      s.model = c.model || s.model;
    }
  }
  return s;
}

const r1 = x => Math.round(x * 10) / 10;

function analyse(id, st, s, o, P) {
  const calls = s.calls, last = calls[calls.length - 1];
  const context = prompt(last);
  const tail = calls.slice(-o['last-turns']);
  const sum = (a, f) => a.reduce((x, t) => x + f(t), 0);
  const avg = f => sum(tail, f) / tail.length;
  const prices = tail.map(c => micro(P, c));
  const priced = prices.every(x => x !== null);
  const usdPerCall = priced ? prices.reduce((a, b) => a + b, 0) / tail.length / 1e6 : null;
  const freshUsdPerCall = priced ? avg(c => micro(P, { ...c, read: o['fresh-context'] })) / 1e6 : null;
  const cacheReadShare = sum(tail, c => c.read) / sum(tail, prompt);
  const first = calls.length - tail.length;
  const cacheMisses = tail.filter((c, i) => first + i > 0 && c.read / prompt(c) < o['miss-share']).length;
  const qStart = Math.max(0, calls.length - o['quality-calls']);
  const errPer100 = r1(100 * s.errors.filter(k => k > qStart).length / (calls.length - qStart));
  const th = thresholds(P, s.model, o);
  const ageMinutes = Math.max(0, Math.round((o.now - st.mtimeMs) / 60000));
  const ttl = P.cache.ttlMinutes[P.cache.defaultWriteTtl];
  const wb = band(P, s.model, context);
  const coldWakeUsd = ageMinutes > ttl && wb ? context * writePrice(P, wb) / 1e6 : null;
  const paybackCalls = th && context > o['fresh-context'] ? th.S / ((context - o['fresh-context']) * th.read) : null;
  const reasons = [];
  let verdict = 'OK';
  if (th && context >= th.swapAt) reasons.push(`context ${context} >= ${th.swapAt}: a fresh start ($${th.startUsd.toFixed(2)}) pays back in ${Math.round(paybackCalls)} calls`);
  if (s.compactions >= o['swap-compactions']) reasons.push(`compactions ${s.compactions} >= ${o['swap-compactions']}`);
  if (reasons.length) verdict = 'SWAP';
  else {
    if (!th || !priced) reasons.push(`no price for ${[...new Set(tail.filter(c => micro(P, c) === null).map(c => c.model).concat(th ? [] : [s.model]))].join(', ')} in prices.json`);
    else if (context >= th.watchAt) reasons.push(`context ${context} >= ${th.watchAt}: a fresh start pays back in ${Math.round(paybackCalls)} calls`);
    if (s.compactions >= o['watch-compactions']) reasons.push(`compactions ${s.compactions} >= ${o['watch-compactions']}`);
    if (reasons.length) verdict = 'WATCH';
  }
  const fb = band(P, s.model, o['fresh-context']);
  const inputEq = x => (x === null || !fb ? null : Math.round(x * 1e6 / fb.input));   // dollars as input-token equivalents (the old column)
  return {
    id: id.slice(0, 8), file: id, verdict, reasons, model: s.model, contextTokens: context, compactions: s.compactions, turns: calls.length,
    title: (s.title || s.summary || s.firstUser).replace(/\s+/g, ' ').slice(0, 60), ageMinutes,
    cacheReadTotal: sum(calls, c => c.read), cacheWriteTotal: sum(calls, c => c.write),
    costPerTurn: inputEq(usdPerCall), freshCostPerTurn: inputEq(freshUsdPerCall), costRatio: priced ? r1(usdPerCall / freshUsdPerCall) : null,
    usdPerCall: usdPerCall === null ? null : Math.round(usdPerCall * 1e4) / 1e4, freshUsdPerCall: freshUsdPerCall === null ? null : Math.round(freshUsdPerCall * 1e4) / 1e4,
    cacheReadShare: Math.round(cacheReadShare * 1000) / 1000, cacheMisses, errPer100,
    startUsd: th ? Math.round(th.startUsd * 100) / 100 : null, swapAt: th ? th.swapAt : null, watchAt: th ? th.watchAt : null,
    paybackCalls: paybackCalls === null ? null : Math.round(paybackCalls), coldWakeUsd: coldWakeUsd === null ? null : Math.round(coldWakeUsd * 100) / 100,
  };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const P = loadPrices(o.prices);
  let names;
  try { names = readdirSync(o.dir).filter(f => f.endsWith('.jsonl')); } catch (e) { console.error(`cannot read ${o.dir}: ${e.code || e.message}`); process.exit(2); }
  const since = o.now - o['window-hours'] * 3600e3;
  const rows = [];
  for (const f of names) {
    const p = join(o.dir, f);
    const st = statSync(p);
    if (st.mtimeMs < since) continue;
    const s = await readSession(p);
    if (s.calls.length === 0) continue;
    rows.push(analyse(f.replace(/\.jsonl$/, ''), st, s, o, P));
  }
  rows.sort((a, b) => b.contextTokens - a.contextTokens);
  const perModel = Object.fromEntries(Object.keys(P.models).map(m => { const t = thresholds(P, m, o); return [m, { startUsd: Math.round(t.startUsd * 100) / 100, swapAt: t.swapAt, watchAt: t.watchAt }]; }));
  if (o.json) {
    const flags = Object.fromEntries(Object.keys(NUM_FLAGS).map(k => [k, o[k]]));
    console.log(JSON.stringify({ dir: o.dir, now: new Date(o.now).toISOString(), prices: o.prices, thresholds: { ...flags, perModel }, sessions: rows }, null, 2));
    return;
  }
  const k = n => (n === null ? '?' : (n / 1000).toFixed(1) + 'k');
  const usd = n => (n === null ? '?' : '$' + n.toFixed(3));
  for (const r of rows) {
    console.log(`${r.verdict.padEnd(5)} ${r.id} ctx=${String(r.contextTokens).padStart(7)} comp=${r.compactions} turns=${String(r.turns).padStart(5)} cost/turn=${k(r.costPerTurn)} (${r.costRatio === null ? '?' : r.costRatio}x fresh) cacheRead=${(r.cacheReadTotal / 1e6).toFixed(1)}M`
      + ` read=${Math.round(r.cacheReadShare * 100)}% ${usd(r.usdPerCall)}/turn swapAt=${k(r.swapAt)} payback=${r.paybackCalls === null ? '-' : r.paybackCalls} miss=${r.cacheMisses} err/100=${r.errPer100}`
      + `${r.coldWakeUsd === null ? '' : ` COLD wake=$${r.coldWakeUsd.toFixed(2)}`} ${r.ageMinutes}m ${r.model} | ${r.title}`);
  }
  console.log(`${rows.length} session(s) active in the last ${o['window-hours']} h. A fresh start is ${o['fresh-context']} tokens; SWAP when it pays back within ${o['horizon-calls']} calls, WATCH within ${2 * o['horizon-calls']}, or at comp>=${o['swap-compactions']} / comp>=${o['watch-compactions']}:`);
  console.log('  ' + Object.entries(perModel).map(([m, t]) => `${m.replace(/^claude-/, '')} SWAP>=${t.swapAt} WATCH>=${t.watchAt} (start $${t.startUsd.toFixed(2)})`).join('; '));
}

main().catch(e => { console.error(e && e.stack || String(e)); process.exitCode = 1; });
