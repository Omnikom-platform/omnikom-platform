// Stops one builder session by PID: its whole process tree (innermost first, creation time checked against the session registry
// and a fresh listing), the window's cmd.exe wrapper, then proves nothing is left. An interactive session cannot end itself.
//   node tools/departments/stop-builder.mjs --pid <n> [--name-prefix BUILDER_]
// The registry file ~/.claude/sessions/<pid>.json must name a session that starts with the prefix (default BUILDER_), so a department
// head cannot stop another head by a wrong number. Exit 0 = stopped and nothing left (or already gone), 1 = refused or something left, 2 = usage.
import { rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BuilderError, readSessions, listProcesses, treeOf, killProcs, leftovers, filetimeToMs, launchDir } from './builder-lib.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const CREATED_SLACK_MS = 2000;

/** deps: { list(), kill(pid), wait(ms) } so tests stop nothing. */
export async function stopBuilder({ pid, namePrefix = 'BUILDER_' }, deps = {}) {
  if (!Number.isInteger(pid) || pid <= 0) throw new BuilderError('--pid must be a positive whole number');
  const list = deps.list || listProcesses;
  const wait = deps.wait || sleep;
  const s = readSessions().find(x => x.pid === pid);
  if (!s) throw new BuilderError(`pid ${pid} is not a registered Claude session (no ~/.claude/sessions/${pid}.json), so it is not stopped`);
  if (!String(s.name || '').startsWith(namePrefix)) throw new BuilderError(`pid ${pid} is the session "${s.name}", which does not start with ${namePrefix}; not stopped`);
  const procs = list();
  const root = procs.find(p => p.pid === pid);
  if (!root) return { name: s.name, pid, stopped: [], left: [], note: 'already gone' };
  if (!s.procStart || Math.abs(root.created - filetimeToMs(s.procStart)) > CREATED_SLACK_MS) throw new BuilderError(`pid ${pid} was not created when the session "${s.name}" started (the number was reused); not stopped`);
  const tree = treeOf(pid, procs);
  const wrapper = procs.filter(p => p.pid === root.ppid && p.name.toLowerCase() === 'cmd.exe' && p.created <= root.created && p.cmd.includes(`${s.name}.cmd`));
  const victims = [...tree, ...wrapper];
  const { stopped, skipped } = killProcs(victims, { list, kill: deps.kill });
  let left = [];
  for (let i = 0; i < 10; i++) {
    await wait(1000);
    left = leftovers(victims, s.name, list());
    if (!left.length) break;
  }
  if (!left.length) rmSync(join(launchDir(), `${s.name}.cmd`), { force: true });
  return { name: s.name, pid, stopped, skipped, left };
}

const isMain = process.argv[1] && (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return process.argv[1].toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })();
if (isMain) {
  const a = process.argv.slice(2);
  const o = {};
  let usage = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--pid' && a[i + 1] !== undefined) o.pid = /^\d+$/.test(a[++i]) ? Number(a[i]) : NaN;
    else if (a[i] === '--name-prefix' && a[i + 1] !== undefined) o.namePrefix = a[++i];
    else { usage = `unknown or incomplete argument ${a[i]}`; break; }
  }
  if (usage || o.pid === undefined) { console.error(`${usage || '--pid is required'}\nusage: node tools/departments/stop-builder.mjs --pid <n> [--name-prefix BUILDER_]`); process.exitCode = 2; }
  else {
    try {
      const r = await stopBuilder(o);
      console.log(JSON.stringify(r));
      if (r.left.length) process.exitCode = 1;
    } catch (e) {
      if (!(e instanceof BuilderError)) throw e;
      console.error(`refusing: ${e.message}`);
      process.exitCode = 1;
    }
  }
}
