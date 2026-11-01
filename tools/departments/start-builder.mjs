// Starts one builder session for a department head: a clean launcher .cmd in a temp folder, its own window, then waits until the
// session is registered and prints one JSON line {name, pid, model, cwd, launcher}. The head sends the task with SendMessage.
//   node tools/departments/start-builder.mjs --dept <slug> --slice <name> [--model fable|opus|sonnet|haiku] [--effort low|medium|high|xhigh|max]
//        [--cwd <dir>] [--dry-run]
// The model defaults to the department charter's builder model. Exit 0 = started (or dry run), 1 = refused or not listed in 90 s, 2 = usage.
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BuilderError, plan, launcherText, launcherProblems, launchDir, claudeExe, readSessions, listProcesses, treeOf, killProcs, pidAlive } from './builder-lib.mjs';

export const WAIT_MS = 90000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const defaultOpen = (name, path) => spawn('cmd.exe', ['/d', '/s', '/c', `start "${name}" "${path}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();

/** deps: { open(name, path), wait(ms), now(), waitMs } so tests start nothing. */
export async function startBuilder(opts, deps = {}) {
  const p = plan(opts);
  const exe = claudeExe();
  const text = launcherText(p, exe);
  const path = join(launchDir(), `${p.name}.cmd`);
  const problems = launcherProblems(text, path);
  if (problems.length) throw new BuilderError(`the launcher is not clean: ${problems.join('; ')}`);
  if (opts.dryRun) return { dryRun: true, name: p.name, model: p.modelId, effort: p.effort, cwd: p.cwd, launcher: path, text };
  const s = await launchSession({ name: p.name, path, text, twinHint: ' or pick another slice name' }, deps);
  return { name: p.name, pid: s.pid, model: p.modelId, cwd: p.cwd, launcher: path };
}

/** Writes the launcher, opens it, waits until a session with that name registers; returns its registry entry. Shared with start-all.mjs.
 *  deps: { open(name, path), wait(ms), now(), waitMs }. */
export async function launchSession({ name, path, text, twinHint = '' }, deps = {}) {
  const twin = readSessions().find(s => s.name === name && pidAlive(s.pid));
  if (twin) throw new BuilderError(`a session named ${name} is already running (pid ${twin.pid}); stop it with stop-builder.mjs --pid ${twin.pid}${twinHint}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
  const t0 = (deps.now || Date.now)();
  (deps.open || defaultOpen)(name, path);
  const waitMs = deps.waitMs ?? WAIT_MS;
  const wait = deps.wait || sleep;
  for (let waited = 0; waited <= waitMs; waited += 1000) {
    const s = readSessions().find(x => x.name === name && x.startedAt >= t0 - 5000 && pidAlive(x.pid));
    if (s) return s;
    await wait(1000);
  }
  // Not listed in time: do not leave a half-started window behind.
  let note = 'no process found';
  try {
    const procs = listProcesses();
    const mine = procs.filter(x => x.name.toLowerCase() === 'claude.exe' && x.cmd.includes(`--name ${name}`));
    const victims = mine.flatMap(m => treeOf(m.pid, procs));
    const wrapper = procs.filter(x => x.name.toLowerCase() === 'cmd.exe' && x.cmd.includes(`${name}.cmd`));
    if (victims.length || wrapper.length) { const r = killProcs([...victims, ...wrapper]); note = `stopped ${r.stopped.length} process(es)`; }
  } catch (e) { note = `cleanup failed: ${e.message}`; }
  rmSync(path, { force: true });
  throw new BuilderError(`BLOCKED: no session named ${name} was registered within ${waitMs / 1000} s (${note}); the launcher was ${path}`);
}

function parse(argv) {
  const known = new Set(['dept', 'slice', 'model', 'effort', 'cwd', 'dry-run']);
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z-]+)$/.exec(argv[i]);
    if (!m || !known.has(m[1])) return { usage: `unknown argument ${argv[i]}` };
    if (m[1] === 'dry-run') { o.dryRun = true; continue; }
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) return { usage: `--${m[1]} needs a value` };
    o[m[1]] = argv[++i];
  }
  return { opts: o };
}

const isMain = process.argv[1] && (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return process.argv[1].toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })();
if (isMain) {
  const { opts, usage } = parse(process.argv.slice(2));
  if (usage) { console.error(`${usage}\nusage: node tools/departments/start-builder.mjs --dept <slug> --slice <name> [--model fable|opus|sonnet|haiku] [--effort low|medium|high|xhigh|max] [--cwd <dir>] [--dry-run]`); process.exitCode = 2; }
  else {
    try {
      const r = await startBuilder(opts);
      if (r.dryRun) console.log(`DRY RUN: nothing written, nothing started\nlauncher would be ${r.launcher}\n${r.text}\n${JSON.stringify({ name: r.name, model: r.model, cwd: r.cwd })}`);
      else console.log(JSON.stringify(r));
    } catch (e) {
      if (!(e instanceof BuilderError)) throw e;
      console.error(`refusing: ${e.message}`);
      process.exitCode = 1;
    }
  }
}
