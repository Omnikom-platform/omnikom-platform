// Watched-fail for tools/departments/context-load.mjs: a broken COPY of tools/departments with ONE rule changed, then
// test/context-load.test.mjs against it (OMNIKOM_DEPT_TOOLS); the suite must go red on a named check.
// Pattern of test/mutate.mjs: [name, file, exactText, replacement], applied with split/join, one child process per mutant.
//   node tools/departments/test/context-load.mutants.mjs      exit 0 = every mutant caught
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const F = 'context-load.mjs', PR = 'prices.json';
const MUTANTS = [
  // the old line-count behaviour: every transcript line with usage is a call
  ['calls are not deduped by message id (the old line count)', F, '      if (seen.has(key)) continue;\n', ''],
  // the verdict edges and the compaction rules
  ['swap edge: >= becomes >', F, 'if (th && context >= th.swapAt)', 'if (th && context > th.swapAt)'],
  ['watch edge: >= becomes >', F, 'else if (context >= th.watchAt)', 'else if (context > th.watchAt)'],
  ['swap compactions edge: >= becomes >', F, "if (s.compactions >= o['swap-compactions'])", "if (s.compactions > o['swap-compactions'])"],
  ['watch compactions edge: >= becomes >', F, "if (s.compactions >= o['watch-compactions'])", "if (s.compactions > o['watch-compactions'])"],
  ['a model with no price passes as OK (its reason is dropped)', F, 'if (!th || !priced) reasons.push(`no price for', 'if (!th || !priced) (`no price for'],
  // the defaults
  ['fresh context default 132000 becomes 140000', F, "'fresh-context': 132000,", "'fresh-context': 140000,"],
  ['orient calls default 20 becomes 10', F, "'orient-calls': 20,", "'orient-calls': 10,"],
  ['orient output default 560 becomes 0', F, "'orient-output': 560,", "'orient-output': 0,"],
  ['horizon default 100 becomes 200', F, "'horizon-calls': 100,", "'horizon-calls': 200,"],
  ['swap compactions default 2 becomes 3', F, "'swap-compactions': 2,", "'swap-compactions': 3,"],
  ['watch compactions default 1 becomes 2', F, "'watch-compactions': 1,", "'watch-compactions': 2,"],
  ['window default 36 h becomes 48 h', F, "'window-hours': 36,", "'window-hours': 48,"],
  ['quality window default 100 becomes 2', F, "'quality-calls': 100,", "'quality-calls': 2,"],
  ['miss share default 0.5 becomes 0.01', F, "'miss-share': 0.5,", "'miss-share': 0.01,"],
  ['the window is not applied', F, 'if (st.mtimeMs < since) continue;', ''],
  // the start cost and the thresholds
  ['start cost leaves out writing the fresh context', F, 'const S = F * writePrice(P, b) + ', 'const S = 0 + '],
  ['start cost reads the whole fresh context per orientation call, not half', F, '(F / 2 * b.read', '(F * b.read'],
  ['start cost leaves out the orientation output', F, " + o['orient-output'] * b.output)", ')'],
  ['swapAt divides by the input price, not the read price', F, "swapAt: Math.round(F + S / (o['horizon-calls'] * b.read))", "swapAt: Math.round(F + S / (o['horizon-calls'] * b.input))"],
  ['watchAt uses three horizons, not two', F, "(2 * o['horizon-calls'] * b.read)", "(3 * o['horizon-calls'] * b.read)"],
  // prices
  ['the prices flag is ignored', F, "else if (k === 'prices') o.prices = resolve(v);", "else if (k === 'prices') {}"],
  ['a price band is always the first band', F, 'b.upTo === null || n <= b.upTo', 'true'],
  ['the band edge: <= becomes <', F, 'n <= b.upTo', 'n < b.upTo'],
  ['a 5m write is priced as a 1h write', F, 'c.w5m * b.write5m', 'c.w5m * b.write1h'],
  ['an unsplit write is priced at 5m, not the default TTL', F, 'rest * writePrice(P, b)', 'rest * b.write5m'],
  ['the [1m] suffix is not stripped', F, ".replace(/\\[[^\\]]*\\]$/, '')", ''],
  ['prices.json: opus read 0.2 becomes 0.25', PR, '"input": 4, "write5m": 5, "write1h": 8, "read": 0.2,', '"input": 4, "write5m": 5, "write1h": 8, "read": 0.25,'],
  ['prices.json: haiku band edge 100000 becomes 120000', PR, '"upTo": 100000', '"upTo": 120000'],
  ['prices.json: default write TTL 1h becomes 5m', PR, '"defaultWriteTtl": "1h"', '"defaultWriteTtl": "5m"'],
  // dollars per call
  ['dollars: not averaged over the last turns only', F, "calls.slice(-o['last-turns'])", 'calls'],
  ['dollars: the sum is not divided into an average', F, 'prices.reduce((a, b) => a + b, 0) / tail.length / 1e6', 'prices.reduce((a, b) => a + b, 0) / 1e6'],
  ['the fresh figure keeps the session read instead of the fresh context', F, "micro(P, { ...c, read: o['fresh-context'] })", 'micro(P, c)'],
  // share, misses, cold, quality
  ['cache-read share over the context leaves out writes', F, 'sum(tail, c => c.read) / sum(tail, prompt)', 'sum(tail, c => c.read) / sum(tail, c => c.read + c.input)'],
  ['the first call counts as a miss', F, 'first + i > 0 && ', ''],
  ['COLD from any age', F, 'ageMinutes > ttl && wb', 'ageMinutes >= 0 && wb'],
  ['COLD wake priced at the read price', F, 'context * writePrice(P, wb) / 1e6', 'context * wb.read / 1e6'],
  ['errors counted over the whole session', F, 's.errors.filter(k => k > qStart)', 's.errors.filter(k => k >= 0)'],
  ['is_error false counts as an error', F, "b.is_error === true) s.errors.push", "'is_error' in b) s.errors.push"],
  // the skips, the compaction count, context, order, title
  ['a <synthetic> turn counts', F, " && m.model !== '<synthetic>')", ')'],
  ['a zero-usage turn counts', F, '      if (prompt(c) === 0) continue;\n', ''],
  ['compactions are not counted', F, 'if (j.isCompactSummary === true) s.compactions++;', 'if (false) s.compactions++;'],
  ['any isCompactSummary value counts', F, 'j.isCompactSummary === true', 'j.isCompactSummary !== undefined'],
  ['context is the first call, not the last', F, 'const calls = s.calls, last = calls[calls.length - 1];', 'const calls = s.calls, last = calls[0];'],
  ['context leaves out the cache write tokens', F, 'const prompt = c => c.input + c.read + c.write;', 'const prompt = c => c.input + c.read;'],
  ['lightest session first', F, 'b.contextTokens - a.contextTokens', 'a.contextTokens - b.contextTokens'],
  ['the first user line beats the custom title', F, 's.title || s.summary || s.firstUser', 's.firstUser || s.title || s.summary'],
];
let survived = 0, missing = 0;
for (const [name, file, find, repl] of MUTANTS) {
  const dir = mkdtempSync(join(tmpdir(), 'omnikom-ctxload-mut-'));
  try {
    cpSync(TOOLS, dir, { recursive: true });
    const p = join(dir, file);
    const t = readFileSync(p, 'utf8');
    const n = t.split(find).length - 1;
    if (n !== 1) { missing++; console.log(`MISSING  ${name} (target text found ${n} times in ${file})`); continue; }
    writeFileSync(p, t.split(find).join(repl), 'utf8');
    const r = spawnSync(process.execPath, [join(dir, 'test', 'context-load.test.mjs')], { encoding: 'utf8', timeout: 180000, env: { ...process.env, OMNIKOM_DEPT_TOOLS: dir } });
    const red = ((r.stdout || '').match(/^FAIL .*$/gm) || []).map(l => l.slice(5, 70));
    // caught = the suite went red on a named check; a crash or a timeout with no FAIL line is NOT a catch (it would hide a broken test)
    const caught = r.status !== 0 && red.length > 0;
    if (!caught) survived++;
    console.log(`${caught ? 'caught  ' : 'SURVIVED'} ${name.padEnd(66)} ${caught ? `(${red.length} red: ${red[0]})` : `(exit ${r.status}, ${red.length} red${r.status !== 0 ? ': ' + String(r.stderr || r.stdout || '').trim().split(/\r?\n/).pop().slice(0, 80) : ''})`}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(`\n${MUTANTS.length} mutants, ${MUTANTS.length - survived - missing} caught, ${survived} survived, ${missing} target text missing`);
process.exit(survived || missing ? 1 : 0);
