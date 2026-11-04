// The body of tools/with-env.mjs (that file only calls main): run a command with the variables of an env file loaded, by name, never
// printed. Lives here so the CLI's mutation runner can break it (it copies only this tree). Sets OMNIKOM_ENV_FILE to the file.
//   node tools/with-env.mjs "<env file>" -- <command> [args...]
// Lines are NAME=value; blank lines and # comments are skipped; the file's names win over the caller's environment.
// The child is stopped after WITH_ENV_TIMEOUT_MIN minutes (read from the caller's environment at the moment the child starts, never from
// the env file; default 10; 0 = no limit; a fraction is fine). A timeout is its own outcome: one line on stderr and exit 124 (the
// coreutils timeout code), and the whole process tree is stopped, not only the child (browsers outlive a killed node on Windows).
// Exit codes: the child's own status; 124 timed out; 127 the command could not start; 2 bad usage or a bad WITH_ENV_TIMEOUT_MIN.
import { readFileSync, writeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { importRepo } from './repo.mjs';

export const DEFAULT_MIN = 10;
export const TIMEOUT_EXIT = 124;
const MAX_MS = 2 ** 31 - 1;   // setTimeout fires at once above this
const USAGE = 'usage: [WITH_ENV_TIMEOUT_MIN=<minutes, default 10, 0 = no limit>] node tools/with-env.mjs <env file> -- <command> [args...]';

// the value of WITH_ENV_TIMEOUT_MIN -> { min } (0 = no limit) or { bad: true }. Unset or empty is the default.
export function parseMinutes(raw) {
  if (raw === undefined || raw === '') return { min: DEFAULT_MIN };
  const s = String(raw).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return { bad: true };
  return { min: Number(s) };
}

// minutes -> milliseconds for the timer; 0 means no timer
export const limitMs = min => (min === 0 ? 0 : Math.min(Math.max(1, Math.round(min * 60000)), MAX_MS));

const errLine = s => { try { writeSync(2, s + '\n'); } catch { /* stderr closed */ } };   // sync: the caller may exit at once

async function stopTree(pid) {
  const { killTree } = await importRepo('tools/proc-guard/index.mjs');   // taskkill /T /F on Windows, a process-group kill elsewhere
  killTree(pid);
}

// -> the exit code. opts (tests only): procEnv, err, timers { set, clear }
export async function main(argv, { procEnv = process.env, err = errLine, timers = { set: setTimeout, clear: clearTimeout } } = {}) {
  const sep = argv.indexOf('--');
  const file = argv[0];
  if (!file || sep < 1 || sep === argv.length - 1) { err(USAGE); return 2; }
  const env = { ...procEnv, OMNIKOM_ENV_FILE: file };
  for (const l of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  const [cmd, ...args] = argv.slice(sep + 1);
  const t = parseMinutes(procEnv.WITH_ENV_TIMEOUT_MIN);   // read as late as possible; the caller's value, not the file's (env has the file's)
  if (t.bad) { err('with-env: WITH_ENV_TIMEOUT_MIN is not a number of minutes (0 = no limit)'); err(USAGE); return 2; }
  const ms = limitMs(t.min);
  const win = process.platform === 'win32';

  return new Promise(resolve => {
    let child, timer = null, over = false, done = false;
    const finish = code => { if (done) return; done = true; if (timer !== null) timers.clear(timer); for (const [s, f] of sigs) process.removeListener(s, f); resolve(code); };
    const sigs = [];
    try {
      child = spawn(cmd, args, { stdio: 'inherit', env, shell: false, windowsHide: true, detached: !win });   // detached: its own process group to kill
    } catch (e) { err(`could not start ${cmd}: ${e.message}`); finish(127); return; }
    child.on('error', e => { err(`could not start ${cmd}: ${e.message}`); finish(127); });
    child.on('exit', (code, signal) => finish(over ? TIMEOUT_EXIT : code ?? 1));
    if (ms > 0) {
      timer = timers.set(async () => {
        if (done) return;
        over = true;
        err(`with-env: ${cmd} timed out after ${t.min} min and was stopped (set WITH_ENV_TIMEOUT_MIN, 0 = no limit)`);
        await stopTree(child.pid);
        finish(TIMEOUT_EXIT);
      }, ms);
    }
    if (!win) {
      // detached, so the terminal's Ctrl-C no longer reaches the child: pass INT and TERM on to the whole group
      for (const [s, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
        const f = async () => { await stopTree(child.pid); finish(code); };
        sigs.push([s, f]); process.once(s, f);
      }
    }
  });
}
