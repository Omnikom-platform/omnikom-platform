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
