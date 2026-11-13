// Unit test of lib/mutant-lists.mjs: each way a mutant can stop running is refused, sound lists pass, run-local.mjs calls both checks, and its --psql-timeout-s reaches psql.
//   node supabase/tests/mutant-lists.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mutantListProblems, noneRanProblem } from './lib/mutant-lists.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (name, ok, seen = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  (seen: ${String(seen).slice(0, 200)})`}`); };

const good = () => ({
  MUTANTS: [['a wall', 'find a', 'put a'], ['two places', [['find b', ''], ['find c', 'x']]]],
  PORT_MUTANTS: [['port rule', 'lib', 'find p', 'put p']],
  PORT_HARNESS_FILES: ['tests/run-local.mjs'],
  exists: f => f === 'tests/run-local.mjs',
});
const run = edit => { const l = good(); edit(l); return mutantListProblems(l); };

check('sound lists have no problem', mutantListProblems(good()).length === 0, mutantListProblems(good()).join(' | '));

// the missing comma, written the way it happens: two entries on two lines with no comma between them
const MISSING_COMMA = [
  ['first', 'find a', 'put a']
  ['second', 'find b', 'put b'],
];
let p = run(l => { l.MUTANTS = MISSING_COMMA; });
check('a missing comma between two MUTANTS entries (an index lookup, undefined) is refused', p.some(x => /MUTANTS\[0\] is undefined/.test(x)), p.join(' | '));

// Clients' 37b: mutant entries typed into PORT_HARNESS_FILES
p = run(l => { l.PORT_HARNESS_FILES = ['tests/run-local.mjs', ['erasure: a wall', 'find', 'put']]; });
check('a mutant typed into PORT_HARNESS_FILES is refused', p.some(x => /PORT_HARNESS_FILES\[1\] is .*not a file path/.test(x)), p.join(' | '));
p = run(l => { l.PORT_HARNESS_FILES = ['tests/run-local.mjs', 'tests/gone.mjs']; });
check('a PORT_HARNESS_FILES path that does not exist is refused', p.some(x => /tests\/gone\.mjs does not exist/.test(x)), p.join(' | '));

p = run(l => { l.MUTANTS.push(['a wall', 'other', 'x']); });
check('a repeated name is refused (and names the first)', p.some(x => /"a wall" repeats MUTANTS\[0\]/.test(x)), p.join(' | '));
p = run(l => { l.PORT_MUTANTS.push(['a wall', 'lib', 'x', 'y']); });
check('a name repeated across MUTANTS and PORT_MUTANTS is refused', p.some(x => /PORT_MUTANTS\[1\] "a wall" repeats MUTANTS\[0\]/.test(x)), p.join(' | '));
p = run(l => { l.MUTANTS.push(['no replace', 'find']); });
check('an entry without its replacement is refused', p.some(x => /"no replace" is not/.test(x)), p.join(' | '));
p = run(l => { l.MUTANTS.push(['', 'find', 'put']); });
check('an entry without a name is refused', p.some(x => /has no name/.test(x)), p.join(' | '));
p = run(l => { l.MUTANTS.push(['bad pairs', [['only find']]]); });
check('a pair without its replacement is refused', p.some(x => /"bad pairs" is not/.test(x)), p.join(' | '));
p = run(l => { l.PORT_MUTANTS.push(['wrong kind', 'other', 'x', 'y']); });
check("a port mutant whose kind is not 'lib' or 'harness' is refused", p.some(x => /"wrong kind" is not/.test(x)), p.join(' | '));
p = run(l => { l.PORT_MUTANTS = [['p', 'lib', 'x', 'y']['q', 'lib', 'x', 'y']]; });
check('a missing comma in PORT_MUTANTS is refused', p.some(x => /PORT_MUTANTS\[0\] is undefined/.test(x)), p.join(' | '));

check('a run in which nothing ran is a problem', noneRanProblem(0, null) === 'no mutant ran');
check('an --only that matches nothing says so', /--only "zzz" matches no mutant name/.test(noneRanProblem(0, 'zzz') ?? ''));
check('a run in which something ran is not a problem', noneRanProblem(3, 'crm') === null);
// E13-a: run-local.mjs --psql-timeout-s <n> sets each psql call's limit, 1 to 3600 s; without it 120 s; anything else is a usage error (null)
const { psqlTimeoutMs } = await import('./lib/mutant-lists.mjs');
const ms = (...a) => (typeof psqlTimeoutMs === 'function' ? psqlTimeoutMs(['node', 'run-local.mjs', ...a]) : 'no psqlTimeoutMs export');
check('--psql-timeout-s: 120 s without it, n s with it, 1 and 3600 allowed', ms() === 120000 && ms('--only', 'x') === 120000 && ms('--psql-timeout-s', '600') === 600000 && ms('--psql-timeout-s', '1') === 1000 && ms('--psql-timeout-s', '3600') === 3600000, ms('--psql-timeout-s', '600'));
check('--psql-timeout-s: anything but 1 to 3600 in digits is a usage error', ['0', '3601', '1.5', '-5', '600s', ' 600', 'abc', ''].every(v => ms('--psql-timeout-s', v) === null) && ms('--psql-timeout-s') === null, ms('--psql-timeout-s', '3601'));

// run-local.mjs uses both: the lists are checked before the first mutant, and a run of none fails
const rl = readFileSync(join(HERE, 'run-local.mjs'), 'utf8');
check('run-local.mjs checks its lists before the real migration runs', /mutantListProblems\(\{ MUTANTS, PORT_MUTANTS, PORT_HARNESS_FILES/.test(rl) && rl.indexOf('mutantListProblems({') < rl.indexOf("real = fresh('real', src)"));
check('run-local.mjs fails a run of no mutant', /noneRanProblem\(ran, ONLY\)/.test(rl));
const stop = rl.indexOf('if (PSQL_MS === null)');
check('run-local.mjs gives psql the --psql-timeout-s limit and stops on a bad one before anything runs', rl.includes('const PSQL_MS = psqlTimeoutMs(process.argv);') && rl.includes("'-f', file], { timeout: PSQL_MS });") && stop > 0 && stop < rl.indexOf('\nsweep();'));

console.log(`\n${failed ? 'FAILED' : 'OK'}: mutant lists ${failed} problem(s)`);
process.exit(failed ? 1 : 0);
