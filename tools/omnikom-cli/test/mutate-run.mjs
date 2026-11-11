// The parts of test/mutate.mjs that can be tested without running a mutant: how a mutant's suite is started, how its result is read, and the
// sweep of the tree copies a killed run left behind (briefs/mutate-parallel.md); and the check function of test/run.mjs with its --bail.
import { readdirSync, readFileSync, writeFileSync, writeSync, rmSync, existsSync, mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

// A copy is made by proc-guard's guardedTemp (removed on every exit path of the process that made it, and its owner.json names that
// process, read by the sweep below). The name is exactly <prefix><6 characters> with no pid in it: proc-guard counts a folder against a PREFIXES
// entry only in that shape (tools/proc-guard/index.mjs:22), so a future 'omnikom-cli-mut-' entry there matches these copies.
export const COPY_PREFIX = 'omnikom-cli-mut-';

// One copy of the CLI tree for one mutant (or the baseline): the guarded folder, filled. -> { dir, release }
export function makeCopy(guard, from, opts = {}) {
  const g = guard.guardedTemp(COPY_PREFIX, 'cli-mutant', opts);
  cpSync(from, g.dir, { recursive: true });
  return g;
}

// A mutant's suite stops at its first FAIL (--bail): a caught mutant needs one red check, and 259 of the 261 caught unit mutants in run
// 41453440713 failed before the first real-browser check. A suite with no FAIL (a survivor) is not affected by --bail: it runs everything.
// The baseline (the unbroken copy) is started without --bail.
export const suiteArgs = (runPath, suite, { bail = true } = {}) => [runPath, suite === 'unit' ? '--unit' : '--db', ...(bail ? ['--bail'] : [])];

// --only may be given more than once: one run (one baseline, ~20-30 min on the laptop) can pick the mutants of several tags. A mutant is run when
// its name holds any of the texts; with none given, all of them.
export const onlyFilters = argv => argv.flatMap((a, i) => (a === '--only' && argv[i + 1] !== undefined ? [argv[i + 1]] : []));
export const pickMutants = (list, only) => (only.length ? list.filter(m => only.some(o => m[0].includes(o))) : list);

// --shard i/N (1 <= i <= N): the ci.yml jobs cli-mutants-1..N each run one share of the list (53 to 78 minutes in one job became N jobs).
// Share i holds every mutant whose index in the FULL list is i-1 modulo N: round-robin, because the slow mutants sit side by side in the list
// (run 42688877100: a contiguous split gave 22.6 minutes for the slowest of 5 shards against 2.0 for the fastest, round-robin 11.2 against 8.7),
// and a mutant added anywhere lands in exactly one share with no table to keep. -> null (no --shard) or { i, n }; a bad value throws.
export function parseShard(argv) {
  const at = argv.indexOf('--shard');
  if (at < 0) return null;
  const m = /^([1-9]\d*)\/([1-9]\d*)$/.exec(String(argv[at + 1] ?? ''));
  if (!m || Number(m[1]) > Number(m[2])) throw new Error(`--shard needs i/N with 1 <= i <= N (got '${argv[at + 1] ?? ''}')`);
  return { i: Number(m[1]), n: Number(m[2]) };
}
export const shardMutants = (list, shard) => (shard ? list.filter((_, idx) => idx % shard.n === shard.i - 1) : list);

// The functions mutants (supabase/functions/test/mutate.mjs, the jobs functions-mutants-1..N): [name, file, find, to, scope]. A mutant with no `scope` (index 4)
// runs the whole Deno test folder, about 10 times the cost of one that names its test file (38 of them; work order 18 adds more), so a plain index modulo N could
// hand one shard most of them. The rule: deal the unscoped mutants round-robin on their own (the k-th unscoped one, by list order, goes to shard (k mod N) + 1),
// then the scoped ones round-robin on their own, the same way. Share i keeps the list order; a mutant added anywhere lands in exactly one share with no table.
export function shardBalanced(list, shard, heavy = m => !m[4]) {
  if (!shard) return list;
  let h = 0, l = 0;
  return list.filter(m => (heavy(m) ? h++ : l++) % shard.n === shard.i - 1);
}

// What supabase/functions/test/mutate.mjs does with its arguments, here so that it is tested (and mutated, in test/mutate.mjs [functions-shards]) with the CLI:
// that file lives outside the CLI tree the mutants copy. `only` is its --only text (a|b), or null. -> { list, label, lines, exit }: print `lines`; a non-null `exit` ends the
// process with it (2 a bad --shard, 1 a share with no mutant, 0 for --list, which prints the selected mutants and stops), null means run `list`.
export function planShard(argv, mutants, only) {
  let shard = null;
  try { shard = parseShard(argv); } catch (e) { return { list: [], label: '', lines: [`mutate: ${e.message}`], exit: 2 }; }
  const list = shardBalanced(mutants.filter(([name]) => !only || only.split('|').some(s => name.includes(s))), shard);
  const label = shard ? `shard ${shard.i}/${shard.n}: ` : '';
  const lines = shard ? [`${label}${list.length} of ${mutants.length} mutants${only ? ' (after --only)' : ''}`] : [];
  if (shard && list.length === 0) return { list, label, lines: [...lines, `${label}FAIL: no mutant is assigned to this shard (${mutants.length} mutants, ${shard.n} shards): a job that ran nothing is not a pass`], exit: 1 };
  if (argv.includes('--list')) return { list, label, lines: [...lines, ...list.map(m => `mutant ${mutants.indexOf(m)}\t${m[4] ? 'scoped' : 'whole'}\t${m[0]}`)], exit: 0 };
  return { list, label, lines, exit: null };
}

// r = { status, out, err } of one suite run. Caught = the process did not exit 0 (a hang cut off by the timeout is caught too), or it printed a
// FAIL line whatever it exited with: a run that saw a red check and still exited 0 (a --bail stop that exits 0 was a survivor in the first
// version of this runner's own mutant list) has been caught by that check.
export function classify(r) {
  const fails = String(r.out || '').split('\n').filter(l => l.startsWith('FAIL '));   // a check line; the summary line starts with FAILED
  const caught = r.status !== 0 || fails.length > 0;
  const why = fails[0] ? fails[0].slice(5, 100) : String(r.err || '').split('\n').find(Boolean) || 'non-zero exit, no FAIL line';
  return { caught, fails: fails.length, why };
}

// Remove every copy whose owner process is dead. A copy whose owner is alive is never touched; a folder with the prefix but no readable
// owner.json (a copy of an older run, which had no marker) is not touched either: nothing says whose it is. -> [{ dir, pid, removed, why? }]
export function sweepCopies({ tmp = tmpdir(), alive, remove = dir => rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }), list = dir => readdirSync(dir) } = {}) {
  const done = [];
  let names = [];
  try { names = list(tmp).filter(n => n.startsWith(COPY_PREFIX)); } catch { return done; }
  for (const n of names) {
    const dir = join(tmp, n);
    let pid = null;
    try { pid = Number(JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8')).pid); } catch { /* no marker */ }
    if (!Number.isInteger(pid) || pid <= 0) { done.push({ dir, pid: null, removed: false, why: 'no owner.json: not ours to judge' }); continue; }
    if (alive(pid)) { done.push({ dir, pid, removed: false, why: 'owner alive' }); continue; }
    try { remove(dir); done.push({ dir, pid, removed: !existsSync(dir) }); } catch (e) { done.push({ dir, pid, removed: false, why: `could not remove: ${e.code || e.message}` }); }
  }
  return done;
}

// ---- the check function of test/run.mjs. Pulled out so its stop-at-the-first-FAIL can be tested with a fake exit and a fake output.
// bail: the first FAIL ends the run (exit 1) after a last line with the counts; a run with no FAIL is the same with or without bail.
// stopOut writes synchronously: a piped stdout on Windows is async and process.exit would cut the last lines.
export function makeCheck({ bail = false, timed = false, now = Date.now, out = line => console.log(line), stopOut = text => writeSync(1, text), exit = code => process.exit(code) } = {}) {
  const t0 = now();
  const s = { total: 0, failed: 0 };
  const check = (name, ok, detail = '') => {
    s.total++; if (!ok) s.failed++;
    const line = `${ok ? 'ok  ' : 'FAIL'}${timed ? ` [${((now() - t0) / 1000).toFixed(0)}s]` : ''} ${name}${ok || !detail ? '' : ': ' + String(detail).slice(0, 300)}`;
    if (ok || !bail) { out(line); return; }
    stopOut(`${line}\n\nFAILED: ${s.total - s.failed} of ${s.total} checks passed, ${s.failed} FAILED (--bail: stopped at the first FAIL)\n`);
    exit(1);
  };
  return { check, counts: () => ({ ...s }) };
}

// ---- the checks of this file (run by test/run.mjs, units part)
export async function mutateRunTests({ check, CLI_ROOT, REPO_ROOT }) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // how a mutant's suite is started
  check('mutate run: a mutant\'s suite is started with --bail, the baseline without', same(suiteArgs('r.mjs', 'unit'), ['r.mjs', '--unit', '--bail']) && same(suiteArgs('r.mjs', 'db'), ['r.mjs', '--db', '--bail']) && same(suiteArgs('r.mjs', 'unit', { bail: false }), ['r.mjs', '--unit']),
    JSON.stringify([suiteArgs('r.mjs', 'unit'), suiteArgs('r.mjs', 'db'), suiteArgs('r.mjs', 'unit', { bail: false })]));

  // how its result is read: only a run that exits 0 is a survivor
  const c0 = classify({ status: 0, out: 'ok   a\nok   b\n', err: '' });
  const c1 = classify({ status: 1, out: 'ok   a\nFAIL the rule: detail\n\nFAILED: 1 of 2 checks passed, 1 FAILED (--bail: stopped at the first FAIL)\n', err: '' });
  const c2 = classify({ status: 1, out: '', err: 'boom: could not start\nmore\n' });
  const c3 = classify({ status: null, out: 'ok   a\n', err: '' });   // cut off by the timeout: a hang counts as caught
  const c4 = classify({ status: 0, out: 'ok   a\nFAIL the rule: detail\n\nFAILED: 1 of 2 checks passed, 1 FAILED (--bail: stopped at the first FAIL)\n', err: '' });   // saw a red check, exited 0 anyway
  check('mutate run: a suite that exits 0 with no FAIL line is a survivor; any other exit (a FAIL, a crash, a hang cut off) is caught, and so is an exit 0 that printed a FAIL line',
    c0.caught === false && c0.fails === 0 && c1.caught === true && c1.fails === 1 && c1.why === 'the rule: detail' && c2.caught === true && c2.why === 'boom: could not start' && c3.caught === true && c3.why === 'non-zero exit, no FAIL line' && c4.caught === true && c4.fails === 1, JSON.stringify([c0, c1, c2, c3, c4]));

  // which mutants a run picks
  const list = [['a [x] one'], ['b [y] two'], ['c [z] three']];
  const picked = (argv) => pickMutants(list, onlyFilters(argv)).map(m => m[0][0]).join('');
  check('mutate run: --only may be repeated: a mutant is run when its name holds any of the texts; none given runs all; an --only with no text after it adds nothing',
    picked([]) === 'abc' && picked(['--only', '[x]']) === 'a' && picked(['n', 'm', '--only', '[x]', '--only', '[z]']) === 'ac' && picked(['--only', '[nope]']) === '' && picked(['--only']) === 'abc', JSON.stringify([picked([]), picked(['--only', '[x]']), picked(['--only', '[x]', '--only', '[z]']), picked(['--only', '[nope]']), picked(['--only'])]));

  // --shard i/N: every mutant in exactly one shard, the shards together the whole list, for N = 1..8 and for lists shorter and longer than N
  const items = len => Array.from({ length: len }, (_, k) => [`mutant ${k}`]);
  const coverage = (len, n, shardFn) => {
    const all = items(len), seen = new Map();
    for (let i = 1; i <= n; i++) for (const m of shardFn(all, { i, n })) seen.set(m[0], (seen.get(m[0]) || 0) + 1);
    const once = all.every(m => seen.get(m[0]) === 1);
    return { once, union: seen.size === all.length && [...seen.keys()].every(k => all.some(m => m[0] === k)) };
  };
  const lens = [0, 1, 5, 6, 7, 8, 9, 37, 549];
  const bad = [];
  for (let n = 1; n <= 8; n++) for (const len of lens) { const c = coverage(len, n, shardMutants); if (!c.once || !c.union) bad.push(`${len}/${n}`); }
  check('mutate shard: for N = 1..8 and lists of 0, 1, 5, 6, 7, 8, 9, 37 and 549 mutants every mutant is in exactly one shard and the union of the shards is the whole list', bad.length === 0, bad.join());
  const dropLast = (all, s) => shardMutants(all, s).slice(0, -1);   // the watched red: one mutant dropped from every shard
  const redDrop = []; for (let n = 1; n <= 8; n++) { const c = coverage(37, n, dropLast); if (c.once && c.union) redDrop.push(n); }
  const dupe = (all, s) => [...shardMutants(all, s), ...(s.i === 1 ? shardMutants(all, { i: 2, n: s.n }) : [])];   // shard 1 also runs shard 2's mutants
  const redDupe = []; for (let n = 2; n <= 8; n++) { const c = coverage(37, n, dupe); if (c.once) redDupe.push(n); }
  check('mutate shard: the coverage check goes red when one mutant is dropped from every shard, and when two shards run the same mutant (a check that cannot fail proves nothing)', redDrop.length === 0 && redDupe.length === 0, JSON.stringify({ redDrop, redDupe }));
  const sh37 = shardMutants(items(37), { i: 2, n: 6 }).map(m => m[0].slice(7)).join();
  check('mutate shard: share i holds the indexes i-1, i-1+N, ... of the whole list (shard 2 of 6 of 37 mutants: 1,7,13,19,25,31), the order kept; no --shard is the whole list', sh37 === '1,7,13,19,25,31' && shardMutants(items(5), null).length === 5, sh37);
  const ps = a => { try { return JSON.stringify(parseShard(a)); } catch (e) { return `throws: ${e.message}`; } };
  check('mutate shard: parseShard reads --shard i/N (anywhere in argv), is null with no --shard, and refuses 0/N, i greater than N, N of 0, a word, a missing value, a decimal',
    ps(['a', '--shard', '3/6', '--only', 'x']) === '{"i":3,"n":6}' && ps(['--only', 'x']) === 'null' && ['0/6', '7/6', '1/0', 'two', '1.5/6', '-1/6', '3/6x'].every(v => ps(['--shard', v]).startsWith('throws: --shard needs i/N')) && ps(['--shard']).startsWith('throws: ') && ps(['--shard', '6/6']) === '{"i":6,"n":6}',
    JSON.stringify([ps(['--shard', '3/6']), ps(['--shard', '7/6']), ps(['--shard'])]));

  // the REAL list, through the real mutate.mjs --list (it stops before any cluster or run): the shards of N = 1, 2, 3, 6, 8 are disjoint and add up to every mutant;
  // a shard with nothing to run, and a bad --shard, stop the real script with a non-zero exit
  const listOf = args => {
    const r = spawnSync(process.execPath, [join(CLI_ROOT, 'test', 'mutate.mjs'), '--list', ...args], { encoding: 'utf8', timeout: 90000, env: { ...process.env, OMNIKOM_REPO_ROOT: REPO_ROOT } });
    const out = String(r.stdout || '');
    return { status: r.status, out: out + String(r.stderr || ''), rows: out.split('\n').filter(l => /^mutant \d+\t/.test(l)).map(l => Number(/^mutant (\d+)\t/.exec(l)[1])) };
  };
  const whole = listOf([]), total = whole.rows.length;
  const realBad = [];
  let cliOne = -1;   // rows of --shard 1/1
  for (const n of [1, 2, 3, 6, 8]) {
    const seen = new Map();
    for (let i = 1; i <= n; i++) {
      const s = listOf(['--shard', `${i}/${n}`]);
      if (s.status !== 0 || s.rows.length === 0) realBad.push(`${i}/${n}: exit ${s.status}, ${s.rows.length} mutants`);
      for (const x of s.rows) seen.set(x, (seen.get(x) || 0) + 1);
    }
    if (n === 1) cliOne = seen.size;
    if (seen.size !== total || [...seen.values()].some(c => c !== 1)) realBad.push(`N=${n}: ${seen.size} different mutants of ${total}, ${[...seen.values()].filter(c => c !== 1).length} run more than once`);
  }
  check(`mutate shard: the whole --list arrives complete (${total} rows = ${cliOne} rows in --shard 1/1; cut short it read 308 of 611 in CI 42935935825)`, total > 0 && total === cliOne, JSON.stringify({ total, cliOne }));
  check('mutate shard: the real mutant list (mutate.mjs --list) split by --shard i/N for N = 1, 2, 3, 6, 8: every shard has mutants, no mutant is in two shards, the shards add up to the whole list',
    whole.status === 0 && total > 500 && whole.rows.every((x, k) => x === k) && realBad.length === 0, JSON.stringify({ total, status: whole.status, realBad }));
  const empty = listOf(['--shard', `${total + 1}/${total + 1}`]), badShards = [['--shard', '0/3'], ['--shard', '4/3'], ['--shard']].map(a => ({ a: a.join(' '), s: listOf(a) }));
  check('mutate shard: a shard that is assigned no mutant (shard 550/550 of 549) is exit 1 with a FAIL line, never a pass; a bad --shard value is exit 2',
    empty.status === 1 && /shard \d+\/\d+: FAIL: no mutant is assigned/.test(empty.out) && badShards.every(b => b.s.status === 2 && /--shard needs i\/N/.test(b.s.out)), JSON.stringify({ empty: [empty.status, empty.out.slice(0, 160)], badShards: badShards.map(b => [b.a, b.s.status]) }));

  // the shard jobs of the real ci.yml, and the land verdict over them: land reads each job by its own name, so a shard that is red or missing is red
  const ciReal = (() => { try { return readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'); } catch { return ''; } })();
  const real = shardJobsProblems(ciReal);
  const numberOf = ciReal.split(/\r?\n/).filter(l => /^ {2}cli-mutants-\d+:/.test(l)).length;
  check('mutate shard: ci.yml has the jobs cli-mutants-1..N, identical apart from their number, each running ci-heavy.mjs --shard i/N with N the job count; the cli job runs --suite; no ci-heavy.mjs line is bare', real.length === 0 && numberOf >= 2, JSON.stringify({ problems: real, shardJobs: numberOf }));
  const jobBlock = n => { const m = new RegExp(`^  cli-mutants-${n}:\\n(?:(?: {3,}.*|\\s*)\\n)*`, 'm').exec(ciReal); return m ? m[0] : ''; };
  const wrong = {
    'a shard job is missing (3 of 6)': ciReal.replace(jobBlock(3), ''),
    'a shard job is a copy of another (job 4 runs 3/6)': ciReal.replace(jobBlock(4), jobBlock(4).replace(/--shard 4\//, '--shard 3/')),
    'N differs from the job count (every run line says /7)': ciReal.replace(/(ci-heavy\.mjs --shard \d+)\/6/g, '$1/7'),
    'a shard job has an extra step': ciReal.replace(jobBlock(5), jobBlock(5) + '      - name: Extra\n        run: node x.mjs\n'),
    'a shard job has another timeout': ciReal.replace(jobBlock(2), jobBlock(2).replace('timeout-minutes: 45', 'timeout-minutes: 99')),
    'the cli job runs every mutant too (a bare ci-heavy.mjs)': ciReal.replace('ci-heavy.mjs --suite', 'ci-heavy.mjs'),
    'a shard job runs a bare ci-heavy.mjs': ciReal.replace(/ci-heavy\.mjs --shard 1\/6/, 'ci-heavy.mjs'),
    'no shard job at all': ciReal.replace(/cli-mutants-\d+/g, 'cli-other'),
  };
  const missed = Object.entries(wrong).filter(([k, t]) => t === ciReal || shardJobsProblems(t).length === 0).map(([k]) => k);
  check('mutate shard: the ci.yml check goes red on each broken copy (a missing shard, a duplicated shard number, N that differs from the job count, an extra step, another timeout, a bare ci-heavy line in the cli job or a shard, no shard job)', missed.length === 0, `not caught: ${missed.join('; ')}`);
  const { ciVerdict } = await import(pathToFileURL(join(CLI_ROOT, 'lib', 'ghrun.mjs')).href);
  const { parseJobs } = await import(pathToFileURL(join(CLI_ROOT, 'lib', 'graph.mjs')).href);
  const { makeFakeGh, runRow, jobRows } = await import(pathToFileURL(join(CLI_ROOT, 'test', 'fake-gh.mjs')).href);
  const names = parseJobs(ciReal).map(j => j.name);
  const SHA = 'a'.repeat(40);
  const verdict = async (shown, over = {}) => ciVerdict({ gh: makeFakeGh(() => ({ runs: [runRow(SHA)], jobs: { 1: jobRows(shown, over) } })) }, { repo: 'o/r', sha: SHA, jobNames: names });
  const shardNames = names.filter(n => /^platform CLI mutants, shard \d+ of \d+$/.test(n));
  const vGreen = await verdict(names), vMissing = await verdict(names.filter(n => n !== shardNames[2])), vRed = await verdict(names, { [shardNames[4]]: 'failure' });
  const vSkipped = await verdict(names, { [shardNames[1]]: 'skipped' }), vOld = await verdict(names.filter(n => !shardNames.includes(n)));
  check('land verdict over the real ci.yml names: all jobs green (shards included) is green and counts them; one shard missing, red or skipped, or a run from before the shards existed, is red and names it',
    shardNames.length === numberOf && vGreen.state === 'green' && vGreen.lines[0].endsWith(`${names.length} of ${names.length} jobs success`) &&
    vMissing.state === 'red' && vMissing.lines.some(l => l.includes(`${shardNames[2]}  missing`)) &&
    vRed.state === 'red' && vRed.lines.some(l => l.includes(`${shardNames[4]}  failure`)) &&
    vSkipped.state === 'red' && vSkipped.lines.some(l => l.includes(`${shardNames[1]}  skipped`)) &&
    vOld.state === 'red' && shardNames.every(n => vOld.lines.some(l => l.includes(`${n}  missing`))),
    JSON.stringify({ shardNames, g: vGreen.state, m: vMissing.lines, r: vRed.lines, s: vSkipped.lines, o: vOld.state }));

  // ---- the function mutants' shards [functions-shards]: shardBalanced (the unscoped mutants dealt on their own, then the scoped ones), planShard (the arguments of
  // supabase/functions/test/mutate.mjs), the real list through that script's --list, and the jobs functions-mutants-1..N of ci.yml
  const mixed = (len, every = 3) => Array.from({ length: len }, (_, k) => [`m${k}`, 'f.ts', 'a', 'b', k % every === 0 ? undefined : 'x.test.ts']);   // no scope = the whole folder (the expensive class)
  const idsOf = (all, s, fn = shardBalanced) => fn(all, s).map(m => m[0]);
  const fcov = (all, n, fn) => { const seen = new Map(); for (let i = 1; i <= n; i++) for (const id of idsOf(all, { i, n }, fn)) seen.set(id, (seen.get(id) || 0) + 1); return all.every(m => seen.get(m[0]) === 1) && seen.size === all.length; };
  const badCov = [];
  for (let n = 1; n <= 8; n++) for (const len of [0, 1, 5, 9, 38, 250]) for (const every of [1, 2, 3, 7]) if (!fcov(mixed(len, every), n, shardBalanced)) badCov.push(`${len}/${n}/${every}`);
  check('functions shard: for N = 1..8 and lists of 0, 1, 5, 9, 38 and 250 mutants (all unscoped, half, a third, a seventh) every mutant is in exactly one share and the shares add up to the list', badCov.length === 0, badCov.join());
  // the rule, by hand: list H S S H S H H S S H (H = no scope), N = 3: the H's (indexes 0 3 5 6 9) go to shards 1 2 3 1 2, the S's (1 2 4 7 8) to 1 2 3 1 2, the list order kept
  const rule = ['H', 'S', 'S', 'H', 'S', 'H', 'H', 'S', 'S', 'H'].map((c, k) => [`m${k}`, 'f.ts', 'a', 'b', c === 'S' ? 'x.test.ts' : '']);
  const ruled = [1, 2, 3].map(i => idsOf(rule, { i, n: 3 }).join(' ')).join(' | ');
  check('functions shard: the unscoped mutants are dealt round-robin on their own and then the scoped ones, the list order kept (H S S H S H H S S H over 3: "m0 m1 m6 m7 | m2 m3 m8 m9 | m4 m5"); no shard is the whole list', ruled === 'm0 m1 m6 m7 | m2 m3 m8 m9 | m4 m5' && shardBalanced(rule, null) === rule, ruled);
  // the case a plain index modulo gets wrong: every 4th mutant is unscoped and N = 4, so the index rule gives shard 1 all of them
  const every4 = mixed(80, 4).map((m, k) => (k % 4 === 0 ? [m[0], m[1], m[2], m[3], ''] : m));
  const spread = (fn, n) => { const w = [], s = []; for (let i = 1; i <= n; i++) { const r = fn(every4, { i, n }); w.push(r.filter(m => !m[4]).length); s.push(r.filter(m => m[4]).length); } return { w, s }; };
  const even = ({ w, s }) => Math.max(...w) - Math.min(...w) <= 1 && Math.max(...s) - Math.min(...s) <= 1;
  const balOk = [2, 3, 4, 5, 6, 8].filter(n => !even(spread(shardBalanced, n)));
  const plainIndex = (all, s) => shardMutants(all, s);   // the watched red: one index modulo N over the whole list, the unscoped class not dealt on its own
  check('functions shard: each share gets the same number of unscoped mutants (to within one) and the same number of scoped ones, also when every 4th mutant is unscoped (N = 2, 3, 4, 5, 6, 8)', balOk.length === 0, JSON.stringify({ balOk, w4: spread(shardBalanced, 4) }));
  check('functions shard: the balance check goes red for a plain index modulo N (every unscoped mutant in one share), a dropped mutant and a mutant run in two shares (a check that cannot fail proves nothing)',
    !even(spread(plainIndex, 4)) && !fcov(mixed(37), 4, (all, s) => shardBalanced(all, s).slice(0, -1)) && !fcov(mixed(37), 4, (all, s) => [...shardBalanced(all, s), ...(s.i === 1 ? shardBalanced(all, { i: 2, n: s.n }) : [])]),
    JSON.stringify(spread(plainIndex, 4)));
  // planShard: what the script's arguments do, with a fake list
  const fm = mixed(9), pl = (args, only = null) => planShard(args, fm, only);
  const p1 = pl(['--shard', '2/3']), p2 = pl(['--shard', '4/3']), p3 = pl(['--shard', '0/3']), p4 = pl(['--shard', '1/20']), p5 = pl(['--shard', '2/3', '--list']), p6 = pl([]), p7 = pl(['--shard', '3/3'], 'm1|m2');   // m1 and m2 are scoped: ranks 0 and 1 of the scoped class, so shard 3 of 3 has nothing
  check('functions shard: --shard i/N selects its share and says so (label "shard 2/3: ", first line "shard 2/3: 3 of 9 mutants"); no flag runs the whole list with no label; --only narrows after the split ("(after --only)")',
    p1.exit === null && p1.list.length === 3 && p1.label === 'shard 2/3: ' && p1.lines[0] === 'shard 2/3: 3 of 9 mutants' && p6.exit === null && p6.list.length === 9 && p6.label === '' && p6.lines.length === 0 && p7.exit === 1 && /\(after --only\)/.test(p7.lines[0]), JSON.stringify([p1, p6, p7]));
  check('functions shard: a bad --shard value (4/3, 0/3, a word, no value) is exit 2 and nothing is selected; a share assigned no mutant (shard 1/20 of 9 has mutants, 10/20 has none) is exit 1 with a FAIL line, never a pass',
    p2.exit === 2 && p3.exit === 2 && pl(['--shard', 'two']).exit === 2 && pl(['--shard']).exit === 2 && p2.list.length === 0 && /--shard needs i\/N/.test(p2.lines[0]) && p4.exit === null && pl(['--shard', '10/20']).exit === 1 && /FAIL: no mutant is assigned/.test(pl(['--shard', '10/20']).lines.join('\n')), JSON.stringify([p2.exit, p3.exit, p4.exit, pl(['--shard', '10/20'])]));
  check('functions shard: --list prints one "mutant <index in the whole list><TAB>whole|scoped<TAB><name>" line per selected mutant and ends with exit 0, run nothing',
    p5.exit === 0 && p5.lines.slice(1).join('|') === pl(['--shard', '2/3']).list.map(m => `mutant ${fm.indexOf(m)}\t${m[4] ? 'scoped' : 'whole'}\t${m[0]}`).join('|') && p5.lines.length === 4, JSON.stringify(p5.lines));
  // the REAL function mutant list, through supabase/functions/test/mutate.mjs --list (it stops before any harness or run)
  const fnScript = join(REPO_ROOT, 'supabase', 'functions', 'test', 'mutate.mjs');
  const fnList = args => {
    const r = spawnSync(process.execPath, [fnScript, '--list', ...args], { encoding: 'utf8', timeout: 90000 });
    const out = String(r.stdout || '') + String(r.stderr || '');
    return { status: r.status, out, rows: out.split('\n').filter(l => /^mutant \d+\t/.test(l)).map(l => { const [a, b] = l.split('\t'); return { idx: Number(a.slice(7)), whole: b === 'whole' }; }) };
  };
  const fnWhole = fnList([]), fnTotal = fnWhole.rows.length;
  const fnBad = [];
  let fnOne = -1;   // rows of --shard 1/1: the whole list read a second way
  for (const n of [1, 2, 4, 6]) {
    const seen = new Map(), W = [], S = [];
    for (let i = 1; i <= n; i++) {
      const s = fnList(['--shard', `${i}/${n}`]);
      if (s.status !== 0 || s.rows.length === 0) fnBad.push(`${i}/${n}: exit ${s.status}, ${s.rows.length} mutants`);
      W.push(s.rows.filter(x => x.whole).length); S.push(s.rows.filter(x => !x.whole).length);
      for (const x of s.rows) seen.set(x.idx, (seen.get(x.idx) || 0) + 1);
    }
    if (n === 1) fnOne = seen.size;
    if (seen.size !== fnTotal || [...seen.values()].some(c => c !== 1)) fnBad.push(`N=${n}: ${seen.size} different mutants of ${fnTotal}, ${[...seen.values()].filter(c => c !== 1).length} run more than once`);
    if (Math.max(...W) - Math.min(...W) > 1 || Math.max(...S) - Math.min(...S) > 1) fnBad.push(`N=${n}: unscoped ${W.join('/')}, scoped ${S.join('/')}`);
  }
  check('functions shard: the real mutant list (functions/test/mutate.mjs --list) split by --shard i/N for N = 1, 2, 4, 6: every share has mutants, none is in two shares, the shares add up to the whole list, and the unscoped and the scoped mutants are each spread to within one',
    fnWhole.status === 0 && fnTotal > 150 && fnWhole.rows.every((x, k) => x.idx === k) && fnWhole.rows.some(x => x.whole) && fnBad.length === 0, JSON.stringify({ fnTotal, status: fnWhole.status, fnBad }));
  check(`functions shard: the whole --list arrives complete (${fnTotal} rows = ${fnOne} rows in --shard 1/1; a list cut short by an exit before the flush read 189 of 255 in CI 42950225902)`, fnTotal > 0 && fnTotal === fnOne, JSON.stringify({ fnTotal, fnOne }));
  const fnEmpty = fnList(['--shard', `${fnTotal + 1}/${fnTotal + 1}`]), fnBadArgs = [['--shard', '0/3'], ['--shard', '4/3'], ['--shard']].map(a => ({ a: a.join(' '), s: fnList(a) }));
  check('functions shard: the real script ends with exit 1 and a FAIL line for a share with no mutant, and with exit 2 for a bad --shard value',
    fnEmpty.status === 1 && /shard \d+\/\d+: FAIL: no mutant is assigned/.test(fnEmpty.out) && fnBadArgs.every(b => b.s.status === 2 && /--shard needs i\/N/.test(b.s.out)), JSON.stringify({ empty: [fnEmpty.status, fnEmpty.out.slice(0, 160)], bad: fnBadArgs.map(b => [b.a, b.s.status]) }));
  // the run path cannot be run here (it needs Deno and a cluster), so its two lines are read as text: the plan comes from the real argv and list, and the loop walks the plan's list
  const fnText = (() => { try { return readFileSync(fnScript, 'utf8'); } catch { return ''; } })();
  check('functions shard: the script plans from process.argv and its own MUTANTS, exits with the plan\'s exit code, and its loop walks the planned list (not MUTANTS), so a --shard cannot run every mutant',
    /const plan = planShard\(process\.argv, MUTANTS, only\);/.test(fnText) && /if \(plan\.exit !== null\) process\.exit\(plan\.exit\);/.test(fnText) && /const \{ list, label \} = plan;/.test(fnText) &&
    /for \(const \[name, file, find, to, scope\] of list\) \{/.test(fnText) && !/of MUTANTS\) \{/.test(fnText), 'supabase/functions/test/mutate.mjs');
  // the jobs of the real ci.yml
  const fnReal = functionsShardJobsProblems(ciReal);
  const fnNumber = ciReal.split(/\r?\n/).filter(l => /^ {2}functions-mutants-\d+:/.test(l)).length;
  check('functions shard: ci.yml has the jobs functions-mutants-1..N, identical apart from their number, each running test/ci-functions.mjs --shard i/N with N the job count (never mutate.mjs itself); the functions job runs the Deno tests and no mutants; no mutate.mjs line is bare', fnReal.length === 0 && fnNumber >= 2, JSON.stringify({ fnReal, fnNumber }));
  const fnBlock = n => { const m = new RegExp(`^  functions-mutants-${n}:\\n(?:(?: {3,}.*|\\s*)\\n)*`, 'm').exec(ciReal); return m ? m[0] : ''; };
  const fnWrong = {
    'a shard job is missing (3 of 4)': ciReal.replace(fnBlock(3), ''),
    'a shard job is a copy of another (job 4 runs 3/4)': ciReal.replace(fnBlock(4), fnBlock(4).replace(/--shard 4\//, '--shard 3/')),
    'N differs from the job count (every run line says /5)': ciReal.replace(/(test\/ci-functions\.mjs --shard \d+)\/4/g, '$1/5'),
    'a shard job has an extra step': ciReal.replace(fnBlock(2), fnBlock(2) + '      - name: Extra\n        run: node x.mjs\n'),
    'a shard job has another timeout': ciReal.replace(fnBlock(2), fnBlock(2).replace('timeout-minutes: 45', 'timeout-minutes: 99')),
    'a shard job runs ci-functions.mjs with no --shard': ciReal.replace(/test\/ci-functions\.mjs --shard 1\/4/, 'test/ci-functions.mjs'),
    'a shard job calls mutate.mjs itself (no scope check) [ci-runners]': ciReal.replace(/tools\/omnikom-cli\/test\/ci-functions\.mjs --shard 2\/4/, 'supabase/functions/test/mutate.mjs --shard 2/4'),
    'every shard job also calls mutate.mjs itself, the same way (only the direct-call rule sees it) [ci-runners]': [1, 2, 3, 4].reduce((c, n) => c.replace(fnBlock(n), fnBlock(n) + `      - name: Again\n        run: node supabase/functions/test/mutate.mjs --shard ${n}/4\n`), ciReal),
    'a shard job calls both (the wrapper and mutate.mjs) [ci-runners]': ciReal.replace(fnBlock(3), fnBlock(3) + '      - name: Again\n        run: node supabase/functions/test/mutate.mjs --shard 3/4\n'),
    'the functions job runs the mutants too': ciReal.replace('        run: node supabase/functions/test/run.mjs\n', '        run: node supabase/functions/test/run.mjs\n      - name: Function mutants\n        run: node supabase/functions/test/mutate.mjs\n'),
    'the functions job no longer runs the Deno tests': ciReal.replace('        run: node supabase/functions/test/run.mjs\n', '        run: node supabase/functions/test/other.mjs\n'),
    'no shard job at all': ciReal.replace(/functions-mutants-\d+/g, 'functions-other'),
  };
  const fnMissed = Object.entries(fnWrong).filter(([k, t]) => t === ciReal || functionsShardJobsProblems(t).length === 0).map(([k]) => k);
  check('functions shard: the ci.yml check goes red on each broken copy (a missing shard, a duplicated shard number, N that differs from the job count, an extra step, another timeout, a bare mutate.mjs line, the functions job running the mutants or not the tests, no shard job)', fnMissed.length === 0 && !fnWrong['a shard job is missing (3 of 4)'].includes('functions-mutants-3:'), fnMissed.join());
  const fnNames = parseJobs(ciReal).map(j => j.name);
  const fnShardNames = fnNames.filter(n => /^functions mutants, shard \d+ of \d+$/.test(n));
  const fvMissing = await verdict(fnNames.filter(n => n !== fnShardNames[1])), fvRed = await verdict(fnNames, { [fnShardNames[3]]: 'failure' }), fvOld = await verdict(fnNames.filter(n => !fnShardNames.includes(n)));
  check('land verdict over the real ci.yml names: a functions mutant shard that is missing or red, or a run from before the shards existed, is red and names it',
    fnShardNames.length === fnNumber && fvMissing.state === 'red' && fvMissing.lines.some(l => l.includes(`${fnShardNames[1]}  missing`)) && fvRed.state === 'red' && fvRed.lines.some(l => l.includes(`${fnShardNames[3]}  failure`)) &&
    fvOld.state === 'red' && fnShardNames.every(n => fvOld.lines.some(l => l.includes(`${n}  missing`))), JSON.stringify({ fnShardNames, m: fvMissing.lines, r: fvRed.lines }));

  // stop at the first FAIL, with a fake exit and a fake output
  const run = (bail, results) => {
    const said = [], stopped = [], exits = []; let ran = 0;
    const m = makeCheck({ bail, out: l => said.push(l), stopOut: t => stopped.push(t), exit: code => { exits.push(code); throw new Error('exit'); } });
    try { for (const ok of results) { ran++; m.check(`c${ran}`, ok, ok ? '' : 'why'); } } catch (e) { if (e.message !== 'exit') throw e; }
    return { said, stopped, exits, ran, counts: m.counts() };
  };
  const b1 = run(true, [true, true, false, true, false]);
  check('mutate run: with --bail the first FAIL ends the run: exit 1 once, the FAIL line and the counts written, the checks after it never run',
    same(b1.exits, [1]) && b1.ran === 3 && b1.said.length === 2 && b1.stopped.length === 1 && b1.stopped[0].startsWith('FAIL c3: why\n') && b1.stopped[0].includes('FAILED: 2 of 3 checks passed, 1 FAILED (--bail: stopped at the first FAIL)'), JSON.stringify(b1));
  const b2 = run(true, [true, true, true, true]);
  check('mutate run: with --bail a run with no FAIL (a survivor) still runs every check and never exits early',
    b2.exits.length === 0 && b2.ran === 4 && b2.said.length === 4 && b2.stopped.length === 0 && b2.counts.total === 4 && b2.counts.failed === 0, JSON.stringify(b2));
  const b3 = run(false, [true, false, true, false]);
  check('mutate run: without --bail every FAIL is printed and the run goes on to the end (the full run and the baseline are unchanged)',
    b3.exits.length === 0 && b3.ran === 4 && b3.said.filter(l => l.startsWith('FAIL')).length === 2 && b3.counts.failed === 2, JSON.stringify(b3));

  // the real run.mjs on a broken copy: one FAIL line and the stop line, long before the end of the suite. Not in the child itself (it would run this test again).
  // (and only when the fake-exit checks above showed a stop at all: a --bail that never stops would send the child through the whole suite)
  if (!process.env.OMNIKOM_BAIL_TEST_CHILD && same(b1.exits, [1]) && b2.exits.length === 0) {
    const dir = mkdtempSync(join(tmpdir(), 'omnikom-cli-baileval-'));
    try {
      cpSync(CLI_ROOT, dir, { recursive: true });
      const file = join(dir, 'lib', 'redact.mjs'), src = readFileSync(file, 'utf8'), find = 'PASSWD|DB_URL|SIGNING';
      const hits = src.split(find).length - 1;   // the patch must apply, or a green run below would prove nothing
      if (hits === 1) writeFileSync(file, src.split(find).join('PASSWD|SIGNING'));
      const r = hits === 1 ? spawnSync(process.execPath, [join(dir, 'test', 'run.mjs'), '--unit', '--bail'], { env: { ...process.env, OMNIKOM_CLI_DIR: dir, OMNIKOM_REPO_ROOT: REPO_ROOT, OMNIKOM_BAIL_TEST_CHILD: '1' }, encoding: 'utf8', timeout: 240000 }) : { status: null, stdout: '', stderr: '' };
      const lines = String(r.stdout).split('\n'), fails = lines.filter(l => l.startsWith('FAIL ')), oks = lines.filter(l => l.startsWith('ok  ')).length;
      const last = lines.filter(Boolean).pop() || '';
      check('mutate run: the real run.mjs --unit --bail on a broken copy exits 1 at its first FAIL (one FAIL line, the stop line last, most of the suite not run)',
        hits === 1 && r.status === 1 && fails.length === 1 && /--bail: stopped at the first FAIL/.test(last) && oks < 300, JSON.stringify({ hits, status: r.status, fails: fails.length, oks, last: last.slice(0, 120), err: String(r.stderr).slice(0, 120) }));
    } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
  }

  // the copies themselves, made the way mutate.mjs makes them (makeCopy through the real proc-guard), and the sweep of those a killed run left behind
  const guard = await import(pathToFileURL(join(REPO_ROOT, 'tools', 'proc-guard', 'index.mjs')).href);
  const tmp = mkdtempSync(join(tmpdir(), 'omnikom-cli-sweeptest-'));
  const src = mkdtempSync(join(tmpdir(), 'omnikom-cli-sweepsrc-'));
  const made = [];
  try {
    writeFileSync(join(src, 'tree.txt'), 'a copy of this');
    const copy = () => { const g = makeCopy(guard, src, { tmp }); made.push(g); return g.dir; };
    const owner = dir => JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8')).pid;
    const setOwner = (dir, pid) => writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid }));
    const dead = copy(), live = copy();
    check('mutate run: a copy is named omnikom-cli-mut- plus exactly 6 characters (no pid: proc-guard counts a folder against a PREFIXES entry only in that shape), carries the tree and names its owner process',
      /^omnikom-cli-mut-.{6}$/.test(basename(dead)) && /^omnikom-cli-mut-.{6}$/.test(basename(live)) && readFileSync(join(dead, 'tree.txt'), 'utf8') === 'a copy of this' && owner(dead) === process.pid,
      JSON.stringify({ name: basename(dead), owner: owner(dead), pid: process.pid }));
    setOwner(dead, 999991); setOwner(live, 999992);   // what a killed run leaves (a dead pid) and a run still going (alive here by the fake)
    const mk = (name, withOwner) => { const d = join(tmp, name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'x.txt'), 'x'); if (withOwner) setOwner(d, 999991); return d; };
    const old = mk(COPY_PREFIX + 'cccccc', false), other = mk('some-other-folder-999991', true);
    const res = sweepCopies({ tmp, alive: pid => pid === 999992 });
    check('mutate run: the sweep removes the copy of a dead owner, never the copy of a live owner, a copy with no owner marker, or a folder with another name',
      !existsSync(dead) && existsSync(live) && existsSync(old) && existsSync(other) && res.filter(s => s.removed).length === 1 && res.find(s => s.dir === live).why === 'owner alive', JSON.stringify(res));
    const again = sweepCopies({ tmp, alive: pid => pid === 999992 });
    check('mutate run: a second sweep finds nothing more to remove (the dead owner\'s copy is gone, the live one still there)', again.every(s => !s.removed) && existsSync(live), JSON.stringify(again));
  } finally {
    for (const g of made) { try { g.release(); } catch { /* removed below */ } }
    rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    rmSync(src, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

// ---- the six shard jobs of ci.yml (cli-mutants-1..N), read as text. Problems found, [] when the shape is right. The jobs are written out, not a
// matrix: omnikom ci (commands/ci.mjs parseWorkflow) models no `strategy`, and land's verdict (lib/ghrun.mjs) wants every job's own name in the run, so
// each shard is a named job that land reads as success, red or missing. What keeps six copies honest is this check: the numbers are 1..N, N is the job
// count and the one in every run line, and the jobs are identical apart from their number. Every ci-heavy.mjs line carries --suite or --shard (a bare
// one would run every mutant in that job again).
function ciJobBlocks(ciText) {
  const lines = String(ciText).split(/\r?\n/);
  const at = lines.findIndex(l => /^jobs:\s*$/.test(l));
  const blocks = [];
  let cur = null;
  if (at >= 0) for (let i = at + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i]) && !/^\s*#/.test(lines[i])) break;
    const m = /^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(lines[i]);
    if (m) { cur = { id: m[1], lines: [] }; blocks.push(cur); } else if (cur && lines[i].trim() !== '' && !/^\s*#/.test(lines[i])) cur.lines.push(lines[i]);
  }
  return blocks;
}
export function shardJobsProblems(ciText) {
  const blocks = ciJobBlocks(ciText);
  const shards = blocks.filter(b => /^cli-mutants-\d+$/.test(b.id));
  const k = shards.length;
  if (k === 0) return ['ci.yml has no cli-mutants-<n> job'];
  const problems = [];
  const nums = shards.map(b => Number(b.id.slice('cli-mutants-'.length)));
  if (nums.join() !== Array.from({ length: k }, (_, j) => j + 1).join()) problems.push(`the shard jobs are numbered ${nums.join(',')}, not 1..${k}`);
  const norm = (b, n) => b.lines.join('\n').split(`shard ${n} of`).join('shard # of').split(`--shard ${n}/`).join('--shard #/');
  shards.forEach((b, j) => {
    if (norm(b, nums[j]) !== norm(shards[0], nums[0])) problems.push(`${b.id} differs from ${shards[0].id} by more than its number`);
    const r = [...b.lines.join('\n').matchAll(/ci-heavy\.mjs --shard (\d+)\/(\d+)/g)];
    if (r.length !== 1 || Number(r[0][1]) !== nums[j] || Number(r[0][2]) !== k) problems.push(`${b.id} must run ci-heavy.mjs --shard ${nums[j]}/${k} exactly once`);
  });
  for (const b of blocks) for (const l of b.lines) if (/ci-heavy\.mjs/.test(l) && !/ci-heavy\.mjs --(suite|shard \d+\/\d+)\s*$/.test(l)) problems.push(`${b.id}: ci-heavy.mjs without --suite or --shard (it would run every mutant in this job)`);
  const cli = blocks.find(b => b.id === 'cli');
  if (!cli || !cli.lines.some(l => /ci-heavy\.mjs --suite\s*$/.test(l))) problems.push('the cli job must run ci-heavy.mjs --suite (the mutants belong to the shard jobs)');
  return problems;
}

// ---- the shard jobs of the Deno function mutants (functions-mutants-1..N), the twin of the check above: the same shape (numbers 1..N, N the job count and the one in
// every run line, the jobs identical apart from their number; written out because omnikom ci models no `strategy`) and the two other ways the split goes wrong:
// the functions job still running the mutants (every one twice, 40 minutes again) and a bare mutate.mjs line (every mutant in that job).
export function functionsShardJobsProblems(ciText) {
  const blocks = ciJobBlocks(ciText);
  const shards = blocks.filter(b => /^functions-mutants-\d+$/.test(b.id));
  const k = shards.length;
  if (k === 0) return ['ci.yml has no functions-mutants-<n> job'];
  const problems = [];
  const nums = shards.map(b => Number(b.id.slice('functions-mutants-'.length)));
  if (nums.join() !== Array.from({ length: k }, (_, j) => j + 1).join()) problems.push(`the functions shard jobs are numbered ${nums.join(',')}, not 1..${k}`);
  const norm = (b, n) => b.lines.join('\n').split(`shard ${n} of`).join('shard # of').split(`--shard ${n}/`).join('--shard #/');
  shards.forEach((b, j) => {
    if (norm(b, nums[j]) !== norm(shards[0], nums[0])) problems.push(`${b.id} differs from ${shards[0].id} by more than its number`);
    const r = [...b.lines.join('\n').matchAll(/test\/ci-functions\.mjs --shard (\d+)\/(\d+)\s*$/gm)];
    if (r.length !== 1 || Number(r[0][1]) !== nums[j] || Number(r[0][2]) !== k) problems.push(`${b.id} must run tools/omnikom-cli/test/ci-functions.mjs --shard ${nums[j]}/${k} exactly once`);
    if (b.lines.some(l => /functions\/test\/mutate\.mjs/.test(l))) problems.push(`${b.id} calls functions/test/mutate.mjs itself, past the scope check of ci-functions.mjs`);
  });
  for (const b of blocks) for (const l of b.lines) if (/ci-functions\.mjs/.test(l) && !/ci-functions\.mjs --shard \d+\/\d+\s*$/.test(l)) problems.push(`${b.id}: ci-functions.mjs without --shard (a usage error, exit 2)`);
  for (const b of blocks) for (const l of b.lines) if (/functions\/test\/mutate\.mjs/.test(l) && !/mutate\.mjs --shard \d+\/\d+\s*$/.test(l)) problems.push(`${b.id}: functions/test/mutate.mjs without --shard (it would run every function mutant in this job)`);
  const fn = blocks.find(b => b.id === 'functions');
  if (!fn || !fn.lines.some(l => /functions\/test\/run\.mjs\s*$/.test(l))) problems.push('the functions job must run functions/test/run.mjs (the Deno tests)');
  return problems;
}
