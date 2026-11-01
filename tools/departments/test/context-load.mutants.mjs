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
const F = 'context-load.mjs';
const MUTANTS = [
  // one per threshold: the comparison edge, and the default value
  ['swap context edge: >= becomes >', F, "if (context >= o['swap-context'])", "if (context > o['swap-context'])"],
  ['swap compactions edge: >= becomes >', F, "if (s.compactions >= o['swap-compactions'])", "if (s.compactions > o['swap-compactions'])"],
  ['swap cost edge: >= becomes >', F, "if (costRatio >= o['swap-cost'])", "if (costRatio > o['swap-cost'])"],
  ['watch context edge: >= becomes >', F, "if (context >= o['watch-context'])", "if (context > o['watch-context'])"],
  ['watch compactions edge: >= becomes >', F, "if (s.compactions >= o['watch-compactions'])", "if (s.compactions > o['watch-compactions'])"],
  ['swap context default 250000 becomes 300000', F, "'swap-context': 250000,", "'swap-context': 300000,"],
  ['swap compactions default 2 becomes 3', F, "'swap-compactions': 2,", "'swap-compactions': 3,"],
  ['swap cost default 5 becomes 50', F, "'swap-cost': 5,", "'swap-cost': 50,"],
  ['watch context default 150000 becomes 170000', F, "'watch-context': 150000,", "'watch-context': 170000,"],
  ['watch compactions default 1 becomes 2', F, "'watch-compactions': 1,", "'watch-compactions': 2,"],
  ['fresh context default 40000 becomes 50000', F, "'fresh-context': 40000,", "'fresh-context': 50000,"],
  ['window default 36 h becomes 48 h', F, "'window-hours': 36,", "'window-hours': 48,"],
  ['the window is not applied', F, 'if (st.mtimeMs < since) continue;', ''],
  // the skips
  ['a <synthetic> turn counts', F, "j.message.model !== '<synthetic>' && ", ''],
  ['a zero-usage turn counts', F, ' && tokens(u) > 0)', ')'],
  // the compaction count
  ['compactions are not counted', F, 'if (j.isCompactSummary === true) s.compactions++;', 'if (false) s.compactions++;'],
  ['any isCompactSummary value counts', F, 'j.isCompactSummary === true', 'j.isCompactSummary !== undefined'],
  // the cost formula
  ['cost: a cache read costs 1 instead of 0.1', F, 'read: 0.1,', 'read: 1,'],
  ['cost: a cache write costs 1 instead of 1.25', F, 'write: 1.25,', 'write: 1,'],
  ['cost: an input token costs 2 instead of 1', F, 'input: 1,', 'input: 2,'],
  ['cost: an output token costs 1 instead of 5', F, 'output: 5 }', 'output: 1 }'],
  ['cost: the fresh figure prices its context as input, not cache read', F, "o['fresh-context'] * W.read", "o['fresh-context'] * W.input"],
  ['cost: not averaged over the last turns only', F, "s.turns.slice(-o['last-turns'])", 's.turns'],
  ['cost: the sum is not divided into an average', F, 'reduce((a, t) => a + f(t), 0) / tail.length', 'reduce((a, t) => a + f(t), 0)'],
  // context, order, title
  ['context is the first turn, not the last', F, 'const last = s.turns[s.turns.length - 1];', 'const last = s.turns[0];'],
  ['context leaves out the cache write tokens', F, 'last.input + last.read + last.write', 'last.input + last.read'],
  ['context leaves out the cache read tokens', F, 'last.input + last.read + last.write', 'last.input + last.write'],
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
