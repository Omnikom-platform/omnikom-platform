// Tests for tools/departments/context-load.mjs on small SYNTHETIC transcripts in a temp folder (--dir); no real transcript is read.
//   node tools/departments/test/context-load.test.mjs      exit 0 = every check passed. Lines start with "ok  " or "FAIL ".
// OMNIKOM_DEPT_TOOLS points at a copy of the tools (test/context-load.mutants.mjs runs one broken copy at a time).
// Prices come from the tools' own prices.json (Opus 5.5: input 4, 5m write 5, 1h write 8, read 0.2, output 20 $/MTok). Arithmetic,
// in micro-dollars (tokens x $/MTok), at the default flags (fresh 132000, orient 20 calls x 560 output, horizon 100 calls):
//   start S = 132000 x 8 + 20 x (66000 x 0.2 + 560 x 20) = 1,056,000 + 488,000 = 1,544,000 ($1.54)
//   swapAt = 132000 + S / (100 x 0.2) = 209,200;  watchAt = 132000 + S / (200 x 0.2) = 170,600
//   a turn {read 50000, 1h write 1000, input 10, output 500} = 10000 + 8000 + 40 + 10000 = 28,040 ($0.028); fresh: read 132000 =
//   26400 + 8000 + 40 + 10000 = 44,440, ratio 0.6; as input-token equivalents (/ 4): 7010 against 11110.
import { mkdtempSync, writeFileSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = process.env.OMNIKOM_DEPT_TOOLS ? resolve(process.env.OMNIKOM_DEPT_TOOLS) : resolve(HERE, '..');
const NOW = Date.parse('2026-11-01T12:00:00Z');
let failed = 0, total = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ': ' + String(detail).slice(0, 300)}`); };

let mid = 0;
// one API call; ttl '1h' (default) or '5m' splits the write, 'none' leaves no split (priced at the default TTL); id = message id
const turn = (read, write = 0, input = 10, output = 100, model = 'claude-opus-5-5', { id, ttl = '1h' } = {}) => {
  const usage = { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: write, output_tokens: output };
  if (ttl !== 'none') usage.cache_creation = { ephemeral_5m_input_tokens: ttl === '5m' ? write : 0, ephemeral_1h_input_tokens: ttl === '1h' ? write : 0 };
  return { type: 'assistant', message: { id: id || `msg_${++mid}`, model, role: 'assistant', content: [{ type: 'text', text: 'x' }], usage } };
};
const user = text => ({ type: 'user', message: { role: 'user', content: text } });
const toolErr = (isErr = true) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', is_error: isErr, content: 'boom' }] } });
const compact = () => ({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'summary of the earlier work' } });
const title = t => ({ type: 'custom-title', customTitle: t });

const dir = mkdtempSync(join(tmpdir(), 'omnikom-ctxload-'));
let n = 0;
// writes one transcript; ageH = hours before NOW that the file was last touched. Returns the 8-letter id used in the output.
function session(lines, ageH = 0.5) {
  const id = String(++n).padStart(8, '0');
  const f = join(dir, id + '-0000-0000-0000-000000000000.jsonl');
  writeFileSync(f, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  const t = new Date(NOW - ageH * 3600e3);
  utimesSync(f, t, t);
  return id;
}
const run = (args = []) => {
  const r = spawnSync(process.execPath, [join(TOOLS, 'context-load.mjs'), '--dir', dir, '--now', String(NOW), ...args], { encoding: 'utf8', timeout: 60000 });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
};
const rowOf = (out, id) => out.split(/\r?\n/).find(l => l.includes(` ${id} `)) || '';
const json = (args = []) => JSON.parse(run(['--json', ...args]).stdout);
const byId = (j, id) => j.sessions.find(s => s.id === id);
const opus = j => j.thresholds.perModel['claude-opus-5-5'];

try {
  // the thresholds, from prices.json and the flags
  let j = json();
  check('thresholds at the defaults: opus start $1.54, SWAP at 209,200, WATCH at 170,600', opus(j).startUsd === 1.54 && opus(j).swapAt === 209200 && opus(j).watchAt === 170600, JSON.stringify(opus(j)));
  check('every model in prices.json gets thresholds (fable 273,200 / 202,600; haiku in its over-100k band 177,200 / 154,600)',
    j.thresholds.perModel['claude-fable-5-1'].swapAt === 273200 && j.thresholds.perModel['claude-fable-5-1'].watchAt === 202600
    && j.thresholds.perModel['claude-haiku-5-5'].swapAt === 177200 && j.thresholds.perModel['claude-haiku-5-5'].watchAt === 154600
    && j.thresholds.perModel['claude-sonnet-5-5'].swapAt === 209200, JSON.stringify(j.thresholds.perModel));
  check('the flags move the thresholds: horizon 50 -> 286,400; fresh 100000 -> 161,200; orient-output 0 -> 198,000; orient-calls 10 -> 197,000',
    opus(json(['--horizon-calls', '50'])).swapAt === 286400 && opus(json(['--fresh-context', '100000'])).swapAt === 161200
    && opus(json(['--orient-output', '0'])).swapAt === 198000 && opus(json(['--orient-calls', '10'])).swapAt === 197000);
  check('WATCH uses twice the horizon: horizon 50 gives WATCH at 209,200', opus(json(['--horizon-calls', '50'])).watchAt === 209200);

  // verdicts at the edges (opus, one call each, all of it cache read)
  const ok = session([title('T ok'), user('hi'), turn(50000, 1000, 10, 500)]);
  const swapEdge = session([title('T swap edge'), turn(209200, 0, 0, 0)]);
  const swapBelow = session([title('T swap below'), turn(209199, 0, 0, 0)]);
  const watchEdge = session([title('T watch edge'), turn(170600, 0, 0, 0)]);
  const watchBelow = session([title('T watch below'), turn(170599, 0, 0, 0)]);
  const watchComp = session([title('T watch compaction'), turn(50000), compact(), turn(50000)]);
  const swapComp = session([title('T swap compactions'), turn(50000), compact(), turn(50000), compact(), turn(50000)]);
  let r = run();
  check('default run: exit 0, one line per session', r.status === 0 && /7 session\(s\)/.test(r.out), r.out);
  check('verdict OK below every threshold', /^OK /.test(rowOf(r.out, ok)), rowOf(r.out, ok));
  check('context exactly at swapAt swaps, one token below watches', /^SWAP /.test(rowOf(r.out, swapEdge)) && /^WATCH /.test(rowOf(r.out, swapBelow)), rowOf(r.out, swapEdge) + ' / ' + rowOf(r.out, swapBelow));
  check('context exactly at watchAt watches, one token below is OK', /^WATCH /.test(rowOf(r.out, watchEdge)) && /^OK /.test(rowOf(r.out, watchBelow)), rowOf(r.out, watchEdge) + ' / ' + rowOf(r.out, watchBelow));
  check('the SWAP reason names the start cost and the payback (100 calls at the edge)', byId(json(), swapEdge).reasons.join(' ') === 'context 209200 >= 209200: a fresh start ($1.54) pays back in 100 calls' && byId(json(), swapEdge).paybackCalls === 100, JSON.stringify(byId(json(), swapEdge).reasons));
  check('verdict WATCH at one compaction, SWAP at two', /^WATCH /.test(rowOf(r.out, watchComp)) && /comp=1 /.test(rowOf(r.out, watchComp)) && /^SWAP /.test(rowOf(r.out, swapComp)) && /comp=2 /.test(rowOf(r.out, swapComp)), rowOf(r.out, swapComp));
  check('compaction flags move the edges', byId(json(['--swap-compactions', '3']), swapComp).verdict === 'WATCH' && byId(json(['--watch-compactions', '2']), watchComp).verdict === 'OK');
  check('a longer horizon swaps earlier: the swap-below session swaps at horizon 101', byId(json(['--horizon-calls', '101']), swapBelow).verdict === 'SWAP');

  // per-model prices decide the verdict: the same context is SWAP on sonnet, WATCH on fable
  const son = session([title('T sonnet'), turn(209200, 0, 0, 0, 'claude-sonnet-5-5')]);
  const fab = session([title('T fable'), turn(209200, 0, 0, 0, 'claude-fable-5-1')]);
  j = json();
  check('per-model thresholds: 209,200 is SWAP on sonnet and WATCH on fable', byId(j, son).verdict === 'SWAP' && byId(j, fab).verdict === 'WATCH' && byId(j, fab).swapAt === 273200, `${byId(j, son).verdict} ${byId(j, fab).verdict}`);
  const unk = session([title('T unknown model'), turn(50000, 0, 0, 0, 'claude-unknown-9')]);
  const uk = byId(json(), unk);
  check('a model with no price is WATCH, says so, and has no dollar figure', uk.verdict === 'WATCH' && /no price for claude-unknown-9 in prices\.json/.test(uk.reasons.join(' ')) && uk.usdPerCall === null && uk.swapAt === null, JSON.stringify(uk));
  const bracket = session([title('T bracket model'), turn(50000, 0, 0, 0, 'claude-opus-5-5[1m]')]);
  check('a [1m] suffix on the model id is priced as the bare model', byId(json(), bracket).usdPerCall === 0.01, JSON.stringify(byId(json(), bracket)));

  // dollars per call: exact
  j = json();
  const o = byId(j, ok);
  check('dollars: $0.028 per call against $0.0444 fresh, ratio 0.6; input equivalents 7010 / 11110', o.usdPerCall === 0.028 && o.freshUsdPerCall === 0.0444 && o.costRatio === 0.6 && o.costPerTurn === 7010 && o.freshCostPerTurn === 11110, JSON.stringify(o));
  check('the default line carries the old and the new columns', /cost\/turn=7\.0k \(0\.6x fresh\) cacheRead=0\.1M read=98% \$0\.028\/turn swapAt=209\.2k payback=- miss=0 err\/100=0 /.test(rowOf(run().out, ok)), rowOf(run().out, ok));
  const w5 = session([title('T 5m write'), turn(0, 1000, 0, 0, 'claude-opus-5-5', { ttl: '5m' })]);
  const w1 = session([title('T 1h write'), turn(0, 1000, 0, 0, 'claude-opus-5-5', { ttl: '1h' })]);
  const wn = session([title('T unsplit write'), turn(0, 1000, 0, 0, 'claude-opus-5-5', { ttl: 'none' })]);
  const io = session([title('T input output'), turn(0, 0, 1000, 200)]);
  j = json();
  check('a 5m write costs 5, a 1h write 8, an unsplit write the default TTL (1h, 8) per MTok', byId(j, w5).usdPerCall === 0.005 && byId(j, w1).usdPerCall === 0.008 && byId(j, wn).usdPerCall === 0.008, `${byId(j, w5).usdPerCall} ${byId(j, w1).usdPerCall} ${byId(j, wn).usdPerCall}`);
  check('input costs 4 and output 20 per MTok: 1000 in + 200 out = $0.008', byId(j, io).usdPerCall === 0.008, String(byId(j, io).usdPerCall));
  const hLo = session([title('T haiku low band'), turn(100000, 0, 0, 0, 'claude-haiku-5-5')]);
  const hHi = session([title('T haiku high band'), turn(100001, 0, 0, 0, 'claude-haiku-5-5')]);
  j = json();
  check('haiku band by prompt length: 100,000 tokens read at 0.01 ($0.001), 100,001 at 0.05 ($0.005)', byId(j, hLo).usdPerCall === 0.001 && byId(j, hHi).usdPerCall === 0.005, `${byId(j, hLo).usdPerCall} ${byId(j, hHi).usdPerCall}`);
  const avgS = session([title('T average'), turn(100000, 0, 0, 0), turn(200000, 0, 0, 0)]);
  const av = byId(json(), avgS);
  check('dollars are the average over the turns, context is the last turn', av.usdPerCall === 0.03 && av.contextTokens === 200000 && av.turns === 2, JSON.stringify(av));
  check('--last-turns 1 averages only the last turn', byId(json(['--last-turns', '1']), avgS).usdPerCall === 0.04);
  const pfile = join(dir, 'prices-test.json');
  const pj = JSON.parse(readFileSync(join(TOOLS, 'prices.json'), 'utf8'));
  pj.models['claude-opus-5-5'].bands[0].read = 0.4;
  writeFileSync(pfile, JSON.stringify(pj), 'utf8');
  check('prices come from the file: --prices with opus read 0.4 doubles a read-only call ($0.02 to $0.04) and moves swapAt to 170,600',
    byId(json(['--prices', pfile]), avgS).usdPerCall === 0.06 && opus(json(['--prices', pfile])).swapAt === 132000 + Math.round((1056000 + 20 * (66000 * 0.4 + 11200)) / 40), JSON.stringify(opus(json(['--prices', pfile]))));
  check('a missing prices file is a usage error (exit 2)', run(['--prices', join(dir, 'nope.json')]).status === 2);

  // dedupe: one API call written on several lines (one per content block) is one call
  const dup = session([title('T duplicate lines'), turn(50000, 0, 0, 0, 'claude-opus-5-5', { id: 'm1' }), turn(50000, 0, 0, 0, 'claude-opus-5-5', { id: 'm1' }),
    turn(50000, 0, 0, 0, 'claude-opus-5-5', { id: 'm1' }), turn(60000, 0, 0, 0, 'claude-opus-5-5', { id: 'm2' })]);
  const du = byId(json(), dup);
  check('lines with one message id are one call: 2 calls, cache read 110,000 (not 4 and 210,000)', du.turns === 2 && du.cacheReadTotal === 110000, JSON.stringify(du));

  // cache-read share and cache misses
  const sh = session([title('T share'), turn(90000, 10000, 0, 0)]);
  check('cache-read share = read / (read + write + input): 0.9', byId(json(), sh).cacheReadShare === 0.9);
  const miss = session([title('T miss'), turn(0, 50000, 0, 0), turn(50000, 1000, 0, 0), turn(1000, 60000, 0, 0)]);
  check('a call after the first with read share under 0.5 is a miss; the first call is not (miss=1)', byId(json(), miss).cacheMisses === 1 && /miss=1 /.test(rowOf(run().out, miss)), JSON.stringify(byId(json(), miss)));
  check('--miss-share moves the edge: 0.01 counts no miss', byId(json(['--miss-share', '0.01']), miss).cacheMisses === 0);

  // COLD: idle longer than the cache TTL (60 min from prices.json): the next turn rewrites the context at the write price
  const cold = session([title('T cold'), turn(100000, 0, 0, 0)], 61 / 60);
  const warm = session([title('T warm'), turn(100000, 0, 0, 0)], 59 / 60);
  j = json();
  check('COLD after 61 idle minutes: wake = 100,000 x $8/MTok = $0.80; 59 minutes is not cold', byId(j, cold).coldWakeUsd === 0.8 && byId(j, warm).coldWakeUsd === null && / COLD wake=\$0\.80 /.test(rowOf(run().out, cold)), `${byId(j, cold).coldWakeUsd} ${byId(j, warm).coldWakeUsd}`);

  // quality proxy: tool errors per 100 calls over the last --quality-calls calls
  const er = session([title('T errors'), turn(50000), toolErr(), turn(50000), toolErr(false), turn(50000), turn(50000)]);
  check('err/100: one error in 4 calls = 25; is_error false does not count', byId(json(), er).errPer100 === 25, String(byId(json(), er).errPer100));
  check('--quality-calls 2 looks at the last 2 calls only: 0', byId(json(['--quality-calls', '2']), er).errPer100 === 0);

  // heaviest first
  const order = json().sessions.map(s => s.contextTokens);
  check('sessions are sorted by context, heaviest first', order.every((v, i) => i === 0 || order[i - 1] >= v) && order[0] === 209200, order.join(','));

  // <synthetic> and zero-usage turns are not turns
  const syn = session([title('T synthetic'), turn(60000), turn(900000, 0, 0, 0, '<synthetic>'), turn(0, 0, 0, 0)]);
  const sy = byId(json(), syn);
  check('a <synthetic> turn and a zero-usage turn are skipped: one turn, context 60,010', sy.turns === 1 && sy.contextTokens === 60010 && sy.verdict === 'OK', JSON.stringify(sy));
  const onlySyn = session([title('T only synthetic'), turn(900000, 0, 0, 0, '<synthetic>'), turn(0, 0, 0, 0)]);
  check('a session with no real turn is not listed', !byId(json(), onlySyn) && !rowOf(run().out, onlySyn));
  const ctxS = session([title('T ctx'), turn(158000, 2000)]);
  check('context counts the cache write and the cache read: turn(158000, 2000) is 160,010', byId(json(), ctxS).contextTokens === 160010);

  // compactions: counted from isCompactSummary lines only
  const cmp = session([title('T compactions'), user('a normal user line'), turn(50000), compact(), compact(), compact(), turn(50000)]);
  check('compactions are the isCompactSummary lines (3), not other user lines', byId(json(), cmp).compactions === 3);
  const cmpFalse = session([title('T no compactions'), { type: 'user', isCompactSummary: false, message: { role: 'user', content: 'x' } }, turn(50000)]);
  check('isCompactSummary false is not a compaction', byId(json(), cmpFalse).compactions === 0);

  // title: custom title, else summary, else the first user line
  const t1 = session([user('first user line'), { type: 'summary', summary: 'The summary' }, title('The custom title'), turn(50000)]);
  const t2 = session([user('first user line two'), { type: 'summary', summary: 'The summary two' }, turn(50000)]);
  const t3 = session([user('first user line three  with   spaces'), turn(50000)]);
  const tj = json();
  check('title: the custom title wins over the summary and the first user line', byId(tj, t1).title === 'The custom title');
  check('title: a summary is used when there is no custom title', byId(tj, t2).title === 'The summary two');
  check('title: the first user line, whitespace collapsed, when nothing else', byId(tj, t3).title === 'first user line three with spaces');

  // the 36 h window (by the file's last write) and its flag
  const inEdge = session([title('T in window'), turn(50000)], 35.9);
  const outEdge = session([title('T out of window'), turn(50000)], 36.1);
  check('36 h window: a file touched 35.9 h ago is listed, 36.1 h ago is not', !!byId(json(), inEdge) && !byId(json(), outEdge));
  check('--window-hours widens the window', !!byId(json(['--window-hours', '40']), outEdge) && !byId(json(['--window-hours', '35']), inEdge));
  check('age in minutes is measured from --now', byId(json(), inEdge).ageMinutes === 2154, String(byId(json(), inEdge).ageMinutes));

  // output shape and usage errors
  check('--json carries the flags, the per-model thresholds and the model', (() => { const q = json(); return q.thresholds['horizon-calls'] === 100 && q.thresholds['fresh-context'] === 132000 && q.thresholds['window-hours'] === 36 && byId(q, ok).model === 'claude-opus-5-5'; })());
  check('the footer prints the thresholds in plain numbers', /opus-5-5 SWAP>=209200 WATCH>=170600 \(start \$1\.54\)/.test(run().out), run().out.split(/\r?\n/).slice(-3).join(' | '));
  check('no message text beyond the title in the output', !/summary of the earlier work|a normal user line|boom/.test(run().out + run(['--json']).out));
  check('a bad number is a usage error (exit 2)', run(['--horizon-calls', 'lots']).status === 2 && run(['--fresh-context', '0']).status === 2);
  check('an unknown flag is a usage error (exit 2)', run(['--nope']).status === 2 && run(['stray']).status === 2 && run(['--swap-context', '250000']).status === 2);
  check('a missing folder is a usage error (exit 2)', (() => { const q = spawnSync(process.execPath, [join(TOOLS, 'context-load.mjs'), '--dir', join(dir, 'nope')], { encoding: 'utf8', timeout: 60000 }); return q.status === 2; })());
  // a garbage line does not stop the run
  const bad = session([title('T garbage'), turn(50000)]);
  writeFileSync(join(dir, bad + '-0000-0000-0000-000000000000.jsonl'), '{"type":"assistant","message":{"usage": not json\n' + JSON.stringify(turn(50000)) + '\n', 'utf8');
  check('a line that is not JSON is skipped', byId(json(), bad)?.turns === 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `FAILED: ${failed} of ${total}` : `OK: ${total} of ${total} checks passed`);
process.exit(failed ? 1 : 0);
