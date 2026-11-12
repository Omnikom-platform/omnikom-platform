// The one reader of machine.local.json (this machine's own paths: the heavy-job script, the desktop scripts, the reaper), and the reaper adapter.
// There is never a default path: a key that is not in the file, or that does not name what it should, is BLOCKED with the key and the fix named.
// Nothing here prints or exits; the caller's input is Usage (exit 2), a machine that refuses is Blocked (exit 3) of lib/errors.mjs.
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { Blocked } from './errors.mjs';
import { importRepo } from './repo.mjs';

// The reaper bounds itself (25 s as a hook, 90 s as the task, since the fix of 2026-11-11): this is the outer limit of the dry run.
export const REAP_TIMEOUT_MS = 120000;

export function machineFilePath(env = process.env) {
  return env.OMNIKOM_MACHINE_FILE || join(homedir(), '.claude', 'machine.local.json');
}

// the value of `key` in the machine file; kind is 'file' or 'dir'
export function machinePath(key, kind, env = process.env) {
  const file = machineFilePath(env);
  let json = null;
  try { json = JSON.parse(readFileSync(file, 'utf8')); } catch { json = null; }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) throw new Blocked(`${file} is not readable`, `make ${file} a JSON object of this machine's paths`);
  const value = json[key];
  if (typeof value !== 'string' || value === '') throw new Blocked(`${file} has no "${key}"`, `add "${key}": "<absolute path>" to ${file}`);
  if (!isAbsolute(value)) throw new Blocked(`${file}: "${key}" must be an absolute path`, `correct "${key}" in ${file}`);
  let st = null;
  try { st = statSync(value); } catch { st = null; }
  const right = Boolean(st) && (kind === 'dir' ? st.isDirectory() : st.isFile());
  if (!right) throw new Blocked(`${file}: "${key}" is not ${kind === 'dir' ? 'a folder' : 'a file'}: ${value}`, `correct "${key}" in ${file}`);
  return value;
}

// The dry run of the reaper: it lists what it would end and ends nothing. Only this reaches the reaper from the CLI.
// `run` is the tests' seam; its result is returned unchanged.
export async function reapDry({ env = process.env, run } = {}) {
  const script = machinePath('reaperScript', 'file', env);
  const runner = run || (await importRepo('tools/proc-guard/index.mjs')).runLimited;
  return runner(process.execPath, [script, '--dry', '--no-stdin'], { env, timeout: REAP_TIMEOUT_MS });
}
