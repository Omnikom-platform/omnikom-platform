// Tests for tools/departments/context-load.mjs on small SYNTHETIC transcripts in a temp folder (--dir); no real transcript is read.
//   node tools/departments/test/context-load.test.mjs      exit 0 = every check passed. Lines start with "ok  " or "FAIL ".
// OMNIKOM_DEPT_TOOLS points at a copy of the tools (test/context-load.mutants.mjs runs one broken copy at a time).
// Cost arithmetic used below (input-token equivalents): cost = read x 0.1 + write x 1.25 + input + output x 5;
// fresh cost = 40000 x 0.1 + the same write/input/output terms. A turn {read 50000, write 1000, input 10, output 500} costs
// 5000 + 1250 + 10 + 2500 = 8760 and a fresh session 4000 + 1250 + 10 + 2500 = 7760.
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = process.env.OMNIKOM_DEPT_TOOLS ? resolve(process.env.OMNIKOM_DEPT_TOOLS) : resolve(HERE, '..');
const NOW = Date.parse('2026-11-01T12:00:00Z');
let failed = 0, total = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ': ' + String(detail).slice(0, 300)}`); };

const turn = (read, write = 0, input = 10, output = 100, model = 'claude-opus-5-5') =>
  ({ type: 'assistant', message: { model, role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: write, output_tokens: output } } });
const user = text => ({ type: 'user', message: { role: 'user', content: text } });
const compact = () => ({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'summary of the earlier work' } });
const title = t => ({ type: 'custom-title', customTitle: t });

const dir = mkdtempSync(join(tmpdir(), 'omnikom-ctxload-'));
let n = 0;
// writes one transcript; ageH = hours before NOW that the file was last touched. Returns the 8-letter id used in the output.
function session(lines, ageH = 1) {
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

try {
  // verdicts, one trigger each (default thresholds); the other triggers stay below theirs
  const ok = session([title('T ok'), user('hi'), turn(50000, 1000, 10, 500)]);
  const watchCtx = session([title('T watch context'), turn(158000, 2000)]);                              // 160,010 tokens
  const watchComp = session([title('T watch compaction'), turn(50000), compact(), turn(50000)]);           // 1 compaction
  const swapCtx = session([title('T swap context'), turn(258000, 2000)]);                                  // 260,010 tokens, cost 4.1x
  const swapComp = session([title('T swap compactions'), turn(50000), compact(), turn(50000), compact(), turn(50000)]);
  const swapCost = session([title('T swap cost'), turn(100000, 0, 0, 0)]);                                 // 100,000 tokens: 10000 per turn, 2.5x fresh; 10x with --fresh-context 10000
  let r = run();
  check('default run: exit 0, one line per session', r.status === 0 && /6 session\(s\)/.test(r.out), r.out);
  check('verdict OK below every threshold', /^OK /.test(rowOf(r.out, ok)), rowOf(r.out, ok));
  check('verdict WATCH at context 150,000 or more', /^WATCH /.test(rowOf(r.out, watchCtx)), rowOf(r.out, watchCtx));
  check('verdict WATCH at one compaction', /^WATCH /.test(rowOf(r.out, watchComp)) && /comp=1 /.test(rowOf(r.out, watchComp)), rowOf(r.out, watchComp));
  check('verdict SWAP at context 250,000 or more', /^SWAP /.test(rowOf(r.out, swapCtx)), rowOf(r.out, swapCtx));
  check('verdict SWAP at two compactions', /^SWAP /.test(rowOf(r.out, swapComp)) && /comp=2 /.test(rowOf(r.out, swapComp)), rowOf(r.out, swapComp));
  check('cost alone does not swap at the defaults (100k context is 2.5x)', !/^SWAP /.test(rowOf(r.out, swapCost)), rowOf(r.out, swapCost));
  // the threshold edges
  check('context exactly at the swap edge swaps, one below does not', (() => {
    const e = json(['--swap-context', '260010']); const b = json(['--swap-context', '260011']);
    return byId(e, swapCtx).verdict === 'SWAP' && byId(b, swapCtx).verdict === 'WATCH';
  })());
  check('context exactly at the watch edge watches, one below does not', (() => {
    const e = json(['--watch-context', '160010']); const b = json(['--watch-context', '160011']);
    return byId(e, watchCtx).verdict === 'WATCH' && byId(b, watchCtx).verdict === 'OK';
  })());
  check('compactions at the edges: swap at 2, watch at 1 (flags move them)', (() => {
    const a = json(['--swap-compactions', '3']); const b = json(['--watch-compactions', '2']);
    return byId(a, swapComp).verdict === 'OK' ? false : byId(a, swapComp).verdict === 'WATCH' && byId(b, watchComp).verdict === 'OK';
  })());
  check('cost swaps at the flag: 10x fresh at --fresh-context 10000, and not at the default', (() => {
    const c = json(['--fresh-context', '10000']); const d = json();
    const s = byId(c, swapCost);
    return s.verdict === 'SWAP' && s.costRatio === 10 && /cost 10\.0x/.test(s.reasons.join(' ')) && byId(d, swapCost).verdict === 'OK';
  })());
  check('cost edge: swap-cost 10 swaps, 10.1 does not', byId(json(['--fresh-context', '10000', '--swap-cost', '10']), swapCost).verdict === 'SWAP'
    && byId(json(['--fresh-context', '10000', '--swap-cost', '10.1']), swapCost).verdict === 'OK');

  // heaviest first
  const order = json().sessions.map(s => s.contextTokens);
  check('sessions are sorted by context, heaviest first', order.every((v, i) => i === 0 || order[i - 1] >= v) && order[0] === 260010, order.join(','));

  // the cost figure: exact numbers
  const j = json();
  const o = byId(j, ok);
  check('cost figure: 8760 per turn against 7760 fresh, ratio 1.1', o.costPerTurn === 8760 && o.freshCostPerTurn === 7760 && o.costRatio === 1.1, JSON.stringify(o));
  check('cost figure is printed in the default line', /cost\/turn=8\.8k \(1\.1x fresh\)/.test(rowOf(run().out, ok)), rowOf(run().out, ok));
  const avgS = session([title('T average'), turn(100000, 0, 0, 0), turn(200000, 0, 0, 0)]);               // (10000 + 20000) / 2, fresh 4000
  const av = byId(json(), avgS);
  check('cost is the average over the turns, context is the last turn', av.costPerTurn === 15000 && av.freshCostPerTurn === 4000 && av.contextTokens === 200000 && av.turns === 2, JSON.stringify(av));
  const win = session([title('T window'), turn(100000, 0, 0, 0), turn(200000, 0, 0, 0)]);
  check('--last-turns 1 averages only the last turn', byId(json(['--last-turns', '1']), win).costPerTurn === 20000);
  const outS = session([title('T output'), turn(0, 0, 1000, 200)]);                                       // input 1x, output 5x
  check('cost: input counts 1, output counts 5, a write counts 1.25', byId(json(), outS).costPerTurn === 2000 && (() => {
    const w = session([title('T write'), turn(0, 1000, 0, 0)]); return byId(json(), w).costPerTurn === 1250;
  })());

  // <synthetic> and zero-usage turns are not turns
  const syn = session([title('T synthetic'), turn(60000), turn(900000, 0, 0, 0, '<synthetic>'), turn(0, 0, 0, 0)]);
  const sy = byId(json(), syn);
  check('a <synthetic> turn and a zero-usage turn are skipped: one turn, context 60,010', sy.turns === 1 && sy.contextTokens === 60010 && sy.verdict === 'OK', JSON.stringify(sy));
  const onlySyn = session([title('T only synthetic'), turn(900000, 0, 0, 0, '<synthetic>'), turn(0, 0, 0, 0)]);
  check('a session with no real turn is not listed', !byId(json(), onlySyn) && !rowOf(run().out, onlySyn));

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
  check('--json carries the thresholds and the model', (() => { const q = json(); return q.thresholds['swap-context'] === 250000 && q.thresholds['window-hours'] === 36 && byId(q, ok).model === 'claude-opus-5-5'; })());
  check('no message text beyond the title in the output', !/summary of the earlier work|a normal user line/.test(run().out + run(['--json']).out));
  check('a bad number is a usage error (exit 2)', run(['--swap-context', 'lots']).status === 2 && run(['--swap-context', '0']).status === 2);
  check('an unknown flag is a usage error (exit 2)', run(['--nope']).status === 2 && run(['stray']).status === 2);
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
