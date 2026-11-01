// Mutants of tools/proc-guard/index.mjs: each one breaks one line of the guard in a COPY (in the temp folder, never on disk in the
// repository), runs the group of tests that covers that line, and requires the tests to go RED for the right reason (the first FAIL
// line must match `expect`). A mutant that stays green means the check measures nothing; a mutant whose target text does not occur
// exactly once is BROKEN (the patch would apply nothing, or the wrong thing).
//   node tools/proc-guard/test/mutate.mjs [name substring]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'index.mjs'), 'utf8');
const FILTER = process.argv[2] || '';
const WIN = process.platform === 'win32';

// [name, group, expect, [[find, replace], ...]]
const MUTANTS = [
  ['no cleanup at exit', 'exit', /ends normally|throws|unhandled rejection/,
    [["process.on('exit', cleanupAll);", '/* mutant: no exit hook */']]],
  ['signals not handled', 'signal', /SIG(INT|TERM|HUP): the run ends with/,
    [['process.on(sig, () => {', "process.on(sig + '-mutant', () => {"]]],
  ['processes naming the folder are not killed', 'exit', /stand-in|leaks\(\) empty/,
    [["if (kind !== 'cluster' || !c.ok) { try { killed = killFolderProcs(dir, procs); }", "if (false) { try { killed = killFolderProcs(dir, procs); }"]]],
  ['the folder is not removed', 'exit', /folder is gone/,
    [["try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* still held */ }", '/* mutant: no rmSync */']]],
  ['the time limit kills only the main process', 'limit', /nothing of the tree is left/,
    [["['/PID', String(pid), '/T', '/F']", "['/PID', String(pid), '/F']"], ["try { process.kill(-pid, 'SIGKILL'); return true; } catch { /* not a group leader */ }", '/* mutant: no group kill */']]],
  ['a process that left the tree and holds the folder survives the time limit', 'holder', /holder kill: a process that left the tree/,
    [['  if (dir) { try { killFolderProcs(dir); } catch { /* the list failed; release() looks again */ } }', '']]],
  ['owner.json gets an extra field', 'hardkill', /owner\.json is the marker/,
    [['kind, argv: process.argv }));', 'kind, argv: process.argv, label: null }));']]],
  ['a holder handed to pid 1 still has a live owner', 'owner', /owner: (a holder whose parent is pid 1|sweep\(\) removes a Playwright profile whose holder was handed to pid 1)/,
    [['  if (!(p.ppid > 1)) return false;\n', '']]],
  ['a live parent that is not node is an owner', 'owner', /not node/,
    [['  return isNodeProc(parent);', '  return true;']]],
  ['leaks() sees nothing', 'hardkill', /leaks\(\) lists the stand-in/,
    [['if (m) out.push(', 'if (false) out.push(']]],
  ['sweep() ignores a living owner', 'alive', /alive owner/,
    [['if (alive) continue;', 'if (false) continue;']]],
  ['sweep() never cleans a dead owner', 'hardkill', /sweep\(\) cleans that folder/,
    [['why = `owner process ${owner.pid} is gone`;', 'continue;']]],
  ['owner.json is never written', 'hardkill', /owner\.json is the marker|sweep\(\) cleans that folder/,
    [["writeFileSync(join(dir, 'owner.json'), JSON.stringify(", "void (("]]],
  ['a folder with no owner is cleaned at any age', 'alive', /no owner\.json, young folder/,
    [['export const NO_OWNER_MAX_AGE_MS = 6 * 60 * 60 * 1000;', 'export const NO_OWNER_MAX_AGE_MS = 0;']]],
  ['a reused pid counts as the owner', 'reuse', /pid reuse: an alive pid that runs another script/,
    [['!norm(p.cmd).includes(script)', 'false']]],
  ['a browser with a living parent is swept', 'foreign', /parent is alive/,
    [['if (roots.some(p => ownerAlive(p, list))) continue;', '']]],
  ['a browser with a dead parent is never swept', 'foreign', /parent is dead/,
    [["why = 'its browser has no live parent process';", 'continue;']]],
  ['the cluster is not stopped with pg_ctl', 'pg', /release\(\) stops it with pg_ctl/,
    [["const r = spawnSync(cmd, [...pre, '-D', data, '-m', 'immediate', '-w', 'stop'], { timeout: 90000, windowsHide: true, stdio: 'ignore' });", 'const r = { status: 1 };']]],
  ['only a folder called data is looked at for a cluster', 'pg', /a data folder called pgdata/,
    [["e.isDirectory() && existsSync(join(dir, e.name, 'postmaster.pid'))", "e.name === 'data' && existsSync(join(dir, e.name, 'postmaster.pid'))"]]],
  ['a cluster whose pg_ctl failed is not killed by command line', 'pg', /when pg_ctl fails/,
    [["const c = stopCluster(dir, pgCtl);\n  let killed = 0;", "const c = stopCluster(dir, pgCtl);\n  c.ok = true;\n  let killed = 0;"]]],
  // The brief asked for "killTree replaced by a plain kill of the main process" here. On this machine that mutant ESCAPES with a real
  // headless Edge: its renderer, GPU and utility processes end within ~300 ms of the main process (measured 2026-11-01, 17 processes).
  // The tree kill is proven with the stand-ins above instead; the real browser check is red when the time limit applies no kill at all.
  ['the time limit kills nothing (a real browser that stays up is never cut)', 'browser', /real browser: a browser that stays up is cut by a 5 s limit/,
    [['timer = setTimeout(() => { timedOut = true; stop(); }, timeout);', 'timer = setTimeout(() => { timedOut = true; }, timeout);']]],
];

const work = mkdtempSync(join(os.tmpdir(), 'proc-guard-mut-'));
let caught = 0, escaped = 0, broken = 0;
try {
  // The unmutated guard must pass every group first: a mutant measured against a red baseline proves nothing (on a Linux runner this
  // script once reported every mutant caught while the baseline was red).
  const env0 = { ...process.env }; delete env0.PROC_GUARD_SUT; delete env0.PROC_GUARD_ONLY;
  const base = spawnSync(process.execPath, [join(HERE, 'run.mjs')], { env: env0, encoding: 'utf8', timeout: 20 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 });
  if (base.status !== 0) {
    const bout = `${base.stdout || ''}${base.stderr || ''}`;
    console.log(bout.trim().split(/\r?\n/).filter(l => /^FAIL |^proc-guard tests:/.test(l)).join('\n'));
    console.log('FAILED: the unmutated copy does not pass; nothing to measure');
    rmSync(work, { recursive: true, force: true });
    process.exit(1);
  }
  console.log('baseline: the unmutated guard passes every group');
  MUTANTS.forEach(([name, group, expect, edits], i) => {
    if (FILTER && !name.includes(FILTER)) return;
    let text = SRC;
    for (const [find, replace] of edits) {
      const hits = text.split(find).length - 1;
      // an edit that only exists for the other platform is allowed to be a no-op there, but its text must still be in the file once
      if (hits !== 1) { broken++; console.log(`BROKEN  ${name}: the target text occurs ${hits} times (needs exactly 1): ${find.slice(0, 70)}`); return; }
      text = text.split(find).join(replace);
    }
    if (text === SRC) { broken++; console.log(`BROKEN  ${name}: the patch changed nothing`); return; }
    const file = join(work, `m${i}.mjs`);
    writeFileSync(file, text);
    const r = spawnSync(process.execPath, [join(HERE, 'run.mjs')], { env: { ...process.env, PROC_GUARD_SUT: file, PROC_GUARD_ONLY: group }, encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const fails = out.split(/\r?\n/).filter(l => /^FAIL /.test(l));
    if (r.status === 0) { escaped++; console.log(`ESCAPED ${name} (group ${group} stayed green)`); }
    else if (!fails.length) { broken++; console.log(`UNCLEAR ${name}: exit ${r.status}, no FAIL line: ${out.trim().split(/\r?\n/).slice(-4).join(' / ').slice(0, 400)}`); }
    else if (!expect.test(fails[0])) { broken++; console.log(`WRONG REASON ${name}: first FAIL is "${fails[0].slice(0, 200)}" (wanted ${expect})`); }
    else { caught++; console.log(`caught  ${name}\n          by: ${fails[0].slice(0, 170)}${fails.length > 1 ? ` (+${fails.length - 1} more)` : ''}`); }
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`mutants: ${caught} caught, ${escaped} escaped, ${broken} broken, wrong or unclear${WIN ? '' : ' (non-Windows: the taskkill half of a two-part mutant is a no-op here)'}`);
process.exit(escaped || broken ? 1 : 0);
