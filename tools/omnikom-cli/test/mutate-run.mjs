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
  for (const n of [1, 2, 3, 6, 8]) {
    const seen = new Map();
    for (let i = 1; i <= n; i++) {
      const s = listOf(['--shard', `${i}/${n}`]);
      if (s.status !== 0 || s.rows.length === 0) realBad.push(`${i}/${n}: exit ${s.status}, ${s.rows.length} mutants`);
      for (const x of s.rows) seen.set(x, (seen.get(x) || 0) + 1);
    }
    if (seen.size !== total || [...seen.values()].some(c => c !== 1)) realBad.push(`N=${n}: ${seen.size} different mutants of ${total}, ${[...seen.values()].filter(c => c !== 1).length} run more than once`);
  }
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
export function shardJobsProblems(ciText) {
  const lines = String(ciText).split(/\r?\n/);
  const at = lines.findIndex(l => /^jobs:\s*$/.test(l));
  const blocks = [];
  let cur = null;
  if (at >= 0) for (let i = at + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i]) && !/^\s*#/.test(lines[i])) break;
    const m = /^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(lines[i]);
    if (m) { cur = { id: m[1], lines: [] }; blocks.push(cur); } else if (cur && lines[i].trim() !== '' && !/^\s*#/.test(lines[i])) cur.lines.push(lines[i]);
  }
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
