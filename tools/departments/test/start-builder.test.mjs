// Tests for start-builder.mjs and stop-builder.mjs. Nothing real is started or stopped here: the launcher goes to a temp folder,
// the session registry is a temp folder, claude.exe is a dummy file, and the process list and the kill are fakes. The one real
// launch-and-stop is test/start-builder.live.mjs (run once by hand, it costs a Haiku session).
//   node tools/departments/test/start-builder.test.mjs      exit 0 = every check passed. Lines start with "ok  " or "FAIL ".
// OMNIKOM_DEPT_TOOLS points at a copy of the tools (test/start-builder.mutants.mjs runs one broken copy at a time).
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = process.env.OMNIKOM_DEPT_TOOLS ? resolve(process.env.OMNIKOM_DEPT_TOOLS) : resolve(HERE, '..');
const REPO = process.env.OMNIKOM_REPO_ROOT ? resolve(process.env.OMNIKOM_REPO_ROOT) : resolve(HERE, '..', '..', '..');
let failed = 0, total = 0, skipped = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ': ' + String(detail).slice(0, 300)}`); };
// Off the owner's machine (CI on ubuntu-latest) two things are missing: Windows (processes.ps1, cmd launch) and the clean-launch guard
// (~/.claude/hooks/clean-launch-guard.mjs is not in the repo; builder-lib fails closed without it, so everything that reaches the launcher
// check needs it). Those checks print one SKIP line by name; the refusals, the launcher text and the fake-process-table stop checks still run.
const WIN = process.platform === 'win32';
const NEED_WIN = 'needs Windows', NEED_GUARD = 'needs the clean-launch guard (~/.claude/hooks, not in the repo)';
const gate = (cond, why, name) => { if (cond) return true; skipped++; console.log(`SKIP ${name}: ${why}`); return false; };

const root = mkdtempSync(join(tmpdir(), 'omnikom-sb-'));
const DEPTS = join(root, 'depts'), LAUNCH = join(root, 'launch'), SESSIONS = join(root, 'sessions');
cpSync(join(REPO, 'docs', 'departments'), DEPTS, { recursive: true });
writeFileSync(join(root, 'claude-dummy.exe'), '', 'utf8');
const EXE = join(root, 'claude-dummy.exe');
Object.assign(process.env, { OMNIKOM_REPO_ROOT: REPO, OMNIKOM_DEPT_DIR: DEPTS, OMNIKOM_LAUNCH_DIR: LAUNCH, OMNIKOM_SESSIONS_DIR: SESSIONS, OMNIKOM_CLAUDE_EXE: EXE });
mkdirSync(SESSIONS);

const cli = (script, args, env = {}) => { const r = spawnSync(process.execPath, [join(TOOLS, script), ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ...env } }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const lib = await import(pathToFileURL(join(TOOLS, 'builder-lib.mjs')).href);
const start = await import(pathToFileURL(join(TOOLS, 'start-builder.mjs')).href);
const stop = await import(pathToFileURL(join(TOOLS, 'stop-builder.mjs')).href);
const guard = await import(pathToFileURL(join(homedir(), '.claude', 'hooks', 'clean-launch-guard.mjs')).href).catch(() => null);
const GUARD = guard !== null;
const filetime = (ms) => String((BigInt(ms) + 11644473600000n) * 10000n);
const putSession = (s) => writeFileSync(join(SESSIONS, `${s.pid}.json`), JSON.stringify(s), 'utf8');
const clearSessions = () => { for (const f of readdirSync(SESSIONS)) rmSync(join(SESSIONS, f), { force: true }); };
const MARKERS = ['CLAUDE_CODE_BRIDGE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENABLE_CFC', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_PID', 'CLAUDECODE'];

try {
  // --- dry run: the launcher is printed, nothing is written or started
  let r = cli('start-builder.mjs', ['--dept', 'cli-and-testing', '--slice', 'slice-1', '--dry-run']);
  if (gate(GUARD, NEED_GUARD, 'start: --dry-run prints the launcher and the JSON, exit 0')) check('start: --dry-run prints the launcher and the JSON, exit 0', r.status === 0 && /DRY RUN/.test(r.out) && r.out.includes('--name BUILDER_cli-and-testing_slice-1') && r.out.includes('"name":"BUILDER_cli-and-testing_slice-1"'), r.out);
  check('start: --dry-run writes no launcher and creates no folder', !existsSync(LAUNCH), readdirSync(root).join(','));
  if (gate(GUARD, NEED_GUARD, 'start: the model defaults to the charter builder model (cli-and-testing = sonnet)')) check('start: the model defaults to the charter builder model (cli-and-testing = sonnet)', r.out.includes('--model claude-sonnet-5-5') && r.out.includes('--permission-mode bypassPermissions'), r.out);
  r = cli('start-builder.mjs', ['--dept', 'cli-and-testing', '--slice', 'slice-1', '--model', 'haiku', '--effort', 'high', '--dry-run']);
  if (gate(GUARD, NEED_GUARD, 'start: --model and --effort reach the claude command line')) check('start: --model and --effort reach the claude command line', r.status === 0 && r.out.includes('--model claude-haiku-5-5 --effort high --permission-mode'), r.out);

  // --- the launcher text, judged by the real guard (not by builder-lib)
  const p = lib.plan({ dept: 'seo-and-audits', slice: 'audit-4c' });
  const text = lib.launcherText(p, EXE);
  if (gate(GUARD, NEED_GUARD, 'launcher: the real clean-launch guard finds no problem')) check('launcher: the real clean-launch guard finds no problem', JSON.stringify(guard.launcherProblems(text)) === '[]', JSON.stringify(guard.launcherProblems(text)));
  if (gate(GUARD, NEED_GUARD, 'launcher: the guard lets Start-Process start it')) check('launcher: the guard lets Start-Process start it', guard.verdict(`Start-Process "${join(LAUNCH, 'x.cmd')}"`, () => text) === null);
  const missing = MARKERS.filter(n => !new RegExp(`^set ${n}=\\r?$`, 'm').test(text));
  check('launcher: every one of the 10 markers is cleared', missing.length === 0, missing.join(','));
  check('launcher: CRLF lines, a title, a cd, the claude line with a name and no prompt', /\r\n/.test(text) && text.includes('title BUILDER_seo-and-audits_audit-4c') && /cd \/d "/.test(text) && / --name BUILDER_seo-and-audits_audit-4c --model claude-sonnet-5-5 --permission-mode bypassPermissions\r\n$/.test(text), JSON.stringify(text.slice(-200)));
  const stripped = text.replace(/^set CLAUDE_PID=\r?$/m, '');   // a marker the guard does not look at: only our own check can catch it
  if (gate(GUARD, NEED_GUARD, 'launcher: a launcher that keeps one marker is a problem (the check itself works)')) check('launcher: a launcher that keeps one marker is a problem (the check itself works)', stripped !== text && lib.launcherProblems(stripped).some(x => /CLAUDE_PID/.test(x)), JSON.stringify(lib.launcherProblems(stripped)));
  if (gate(GUARD, NEED_GUARD, 'launcher: a launcher that carries a prompt is a problem')) check('launcher: a launcher that carries a prompt is a problem', lib.launcherProblems(text.replace('--permission-mode', '"do the task now please" --permission-mode')).length > 0);

  // --- refusals
  r = cli('start-builder.mjs', ['--dept', 'no-such-dept', '--slice', 'a', '--dry-run']);
  check('start: a department with no charter is refused (exit 1)', r.status === 1 && /no charter for department "no-such-dept"/.test(r.out), r.out);
  r = cli('start-builder.mjs', ['--dept', 'README', '--slice', 'a', '--dry-run']);
  check('start: README is not a department', r.status === 1 && /no charter/.test(r.out), r.out);
  for (const bad of ['bad slice', 'a&b', 'a"b', 'x_y', '..\\x', '-lead', 'a'.repeat(41), 'a|b', 'a%b']) {
    r = cli('start-builder.mjs', ['--dept', 'cli-and-testing', '--slice', bad, '--dry-run']);
    check(`start: the slice ${JSON.stringify(bad.length > 20 ? bad.slice(0, 8) + '...' : bad)} is refused`, r.status === 1 && /window title cannot hold/.test(r.out), r.out);
  }
  r = cli('start-builder.mjs', ['--dept', 'cli-and-testing', '--slice', 'a', '--model', 'gpt', '--dry-run']);
  check('start: an unknown model is refused', r.status === 1 && /model "gpt"/.test(r.out), r.out);
  r = cli('start-builder.mjs', ['--dept', 'cli-and-testing', '--slice', 'a', '--effort', 'turbo', '--dry-run']);
  check('start: an unknown effort is refused', r.status === 1 && /effort "turbo"/.test(r.out), r.out);
  r = cli('start-builder.mjs', ['--dept', 'cli-and-testing', '--slice', 'a', '--dry-run'], { OMNIKOM_LAUNCH_DIR: join(root, 'claude-launch') });
  check('start: a launcher folder with "claude" in its path is refused', r.status === 1 && /has "claude" in its path/.test(r.out), r.out);
  mkdirSync(join(root, 'cwd%x'));
  r = cli('start-builder.mjs', ['--dept', 'cli-and-testing', '--slice', 'a', '--cwd', join(root, 'cwd%x'), '--dry-run']);
  check('start: a cwd holding a % is refused (cmd would expand it)', r.status === 1 && /cannot carry/.test(r.out), r.out);
  r = cli('start-builder.mjs', ['--dept', 'cli-and-testing', '--slice', 'a', '--cwd', join(root, 'nowhere'), '--dry-run']);
  check('start: a cwd that does not exist is refused', r.status === 1 && /does not exist/.test(r.out), r.out);
  r = cli('start-builder.mjs', ['--slice', 'a']);
  check('start: no --dept is a refusal', r.status === 1 && /--dept is required/.test(r.out), r.out);
  r = cli('start-builder.mjs', ['--bogus']);
  check('start: an unknown flag is a usage error (exit 2)', r.status === 2, r.out);
  r = cli('stop-builder.mjs', []);
  check('stop: no --pid is a usage error (exit 2)', r.status === 2, r.out);

  // --- start with a fake window: the session is registered a moment after the launcher is opened
  let opened = null;
  const fakeOpen = (name, path) => { opened = { name, path }; putSession({ pid: process.pid, name, cwd: REPO, startedAt: Date.now(), procStart: filetime(Date.now()), status: 'idle' }); };
  let err = null;
  const N = { ret: 'start: returns {name, pid, model, cwd} once the session is registered', file: 'start: the launcher file was written, opened by that path, and is CRLF',
    twin: 'start: a second session with a live name is refused', dry: 'start: a dry run never opens a window', never: 'start: a session that never registers is BLOCKED and its launcher is removed' };
  if (GUARD) {
    const res = await start.startBuilder({ dept: 'platform-build', slice: 'step-7' }, { open: fakeOpen, wait: async () => {} });
    check(N.ret, res.name === 'BUILDER_platform-build_step-7' && res.pid === process.pid && res.model === 'claude-sonnet-5-5' && res.cwd === resolve(REPO), JSON.stringify(res));
    check(N.file, opened && opened.path === join(LAUNCH, 'BUILDER_platform-build_step-7.cmd') && existsSync(opened.path) && /\r\n/.test(readFileSync(opened.path, 'utf8')), JSON.stringify(opened));
    try { await start.startBuilder({ dept: 'platform-build', slice: 'step-7' }, { open: () => { throw new Error('must not open'); }, wait: async () => {} }); } catch (e) { err = e; }
    check(N.twin, err && /already running/.test(err.message), err && err.message);
    clearSessions();
    err = null;
    try { await start.startBuilder({ dept: 'platform-build', slice: 'dry', dryRun: true }, { open: () => { throw new Error('must not open'); } }); } catch (e) { err = e; }
    check(N.dry, err === null && !existsSync(join(LAUNCH, 'BUILDER_platform-build_dry.cmd')), err && err.message);
  } else for (const k of ['ret', 'file', 'twin', 'dry']) gate(false, NEED_GUARD, N[k]);
  if (gate(GUARD && WIN, WIN ? NEED_GUARD : NEED_WIN, N.never)) {   // the cleanup after a timeout lists processes through processes.ps1
    err = null;
    try { await start.startBuilder({ dept: 'platform-build', slice: 'never' }, { open: () => {}, wait: async () => {}, waitMs: 2000 }); } catch (e) { err = e; }
    check(N.never, err && /BLOCKED: no session named BUILDER_platform-build_never/.test(err.message) && !existsSync(join(LAUNCH, 'BUILDER_platform-build_never.cmd')), err && err.message);
  }

  // --- the real process list parses and holds this process
  if (gate(WIN, NEED_WIN, 'processes: the real listing parses and holds this process with a creation time')) {
    const procs = lib.listProcesses();
    const me = procs.find(x => x.pid === process.pid);
    check('processes: the real listing parses and holds this process with a creation time', Array.isArray(procs) && me && me.name.toLowerCase() === 'node.exe' && Math.abs(me.created - (Date.now() - process.uptime() * 1000)) < 5000, JSON.stringify(me));
  }

  // --- stop, on a fake process table (nothing real is killed)
  const T0 = Date.UTC(2026, 10, 1, 5, 0, 0);
  const table = () => [
    { pid: 900, ppid: 1, created: T0 - 5000, name: 'explorer.exe', cmd: '' },
    { pid: 1000, ppid: 900, created: T0, name: 'claude.exe', cmd: 'claude.exe --name BUILDER_x_y' },
    { pid: 1001, ppid: 1000, created: T0 + 100, name: 'node.exe', cmd: 'node mcp.mjs' },
    { pid: 1002, ppid: 1001, created: T0 + 200, name: 'conhost.exe', cmd: '' },
    { pid: 1003, ppid: 1000, created: T0 - 50, name: 'old.exe', cmd: 'a pid that is older than its parent' },
    { pid: 2000, ppid: 1, created: T0, name: 'other.exe', cmd: 'unrelated' },
  ];
  const fake = (procsNow, { keep = [] } = {}) => { const killed = []; return { killed, deps: { list: () => procsNow.map(x => ({ ...x })), kill: (pid) => { killed.push(pid); if (!keep.includes(pid)) { const i = procsNow.findIndex(x => x.pid === pid); if (i >= 0) procsNow.splice(i, 1); } }, wait: async () => {} } }; };
  clearSessions();
  err = null;
  try { await stop.stopBuilder({ pid: 1000 }, fake(table()).deps); } catch (e) { err = e; }
  check('stop: a pid with no registry file is refused', err && /not a registered Claude session/.test(err.message), err && err.message);
  putSession({ pid: 1000, name: 'HEAD_Platform-build_2026-11-01', procStart: filetime(T0) });
  let f = fake(table());
  err = null;
  try { await stop.stopBuilder({ pid: 1000 }, f.deps); } catch (e) { err = e; }
  check('stop: a session that is not a BUILDER_ is refused and nothing is killed', err && /does not start with BUILDER_/.test(err.message) && f.killed.length === 0, err && err.message);
  putSession({ pid: 1000, name: 'BUILDER_x_y', procStart: filetime(T0 + 60000) });
  f = fake(table());
  err = null;
  try { await stop.stopBuilder({ pid: 1000 }, f.deps); } catch (e) { err = e; }
  check('stop: a pid whose creation time is not the session start (reused) is refused, nothing killed', err && /reused/.test(err.message) && f.killed.length === 0, err && err.message);
  putSession({ pid: 1000, name: 'BUILDER_x_y', procStart: filetime(T0) });
  f = fake(table());
  let out = await stop.stopBuilder({ pid: 1000 }, f.deps);
  check('stop: kills the tree innermost first and nothing else', JSON.stringify(f.killed) === '[1002,1001,1000]' && out.left.length === 0, JSON.stringify({ killed: f.killed, out }));
  check('stop: a child older than its parent and an unrelated process are left alone', !f.killed.includes(1003) && !f.killed.includes(2000) && !f.killed.includes(900));
  f = fake(table(), { keep: [1001] });
  out = await stop.stopBuilder({ pid: 1000 }, f.deps);
  check('stop: a process that survives the kill is reported in "left"', out.left.some(x => x.pid === 1001), JSON.stringify(out.left));
  // the listing taken just before the kills shows a different creation time for the pid: skipped, not killed
  let calls = 0;
  const base = table();
  const reused = { killed: [], deps: { list: () => (++calls <= 1 ? base.map(x => ({ ...x })) : base.map(x => ({ ...x, created: x.pid === 1000 ? T0 + 99999 : x.created }))), kill: (pid) => reused.killed.push(pid), wait: async () => {} } };
  out = await stop.stopBuilder({ pid: 1000 }, reused.deps);
  check('stop: a pid whose creation time changed since the first listing is skipped, not killed', !reused.killed.includes(1000) && out.skipped.some(x => x.pid === 1000 && /reused/.test(x.why)), JSON.stringify({ killed: reused.killed, skipped: out.skipped }));
  const gone = fake(table().filter(x => x.pid !== 1000));
  out = await stop.stopBuilder({ pid: 1000 }, gone.deps).catch(e => ({ note: `threw: ${e.message}`, left: [], skipped: [] }));
  check('stop: a session whose process is already gone is reported as such, exit-clean', out.note === 'already gone' && out.left.length === 0 && gone.killed.length === 0, JSON.stringify(out));
  err = null;
  try { await stop.stopBuilder({ pid: -3 }, f.deps); } catch (e) { err = e; }
  check('stop: a non-positive pid is refused', err && /positive whole number/.test(err.message), err && err.message);
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (skipped) console.log(`SKIPPED: ${skipped} (not counted below; need Windows or the clean-launch guard)`);
console.log(failed ? `FAILED: ${failed} of ${total}` : `OK: ${total} of ${total} checks passed`);
process.exit(failed ? 1 : 0);
