// The desktop adapter: runs one of the machine's desktop scripts (the folder is "agentDesktopDir" in machine.local.json) under powershell, without
// a profile and without a prompt (measured: the folder's run.mjs starts them as `powershell -NoProfile -File`). Only the four scripts below can be
// named; the file is looked for in that folder and nowhere else. `run` is the tests' seam; its result is returned unchanged.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { Blocked, Usage } from './errors.mjs';
import { importRepo } from './repo.mjs';
import { machinePath } from './machine.mjs';

export const DESKTOP_SCRIPTS = ['shot', 'click', 'type-into', 'edge'];

export async function runDesktop(script, args = [], { timeoutMs, env = process.env, run } = {}) {
  if (!DESKTOP_SCRIPTS.includes(script)) throw new Usage(`desktop scripts are shot, click, type-into, edge; not ${script}`);
  if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) throw new Usage('desktop arguments must be a list of words');
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Usage('a desktop step needs a time limit in milliseconds, above 0');
  const file = join(machinePath('agentDesktopDir', 'dir', env), script + '.ps1');
  let isFile = false;
  try { isFile = statSync(file).isFile(); } catch { isFile = false; }
  if (!isFile) throw new Blocked(`the desktop script ${script}.ps1 is not in the agentDesktopDir folder`, 'correct "agentDesktopDir" in machine.local.json');
  const runner = run || (await importRepo('tools/proc-guard/index.mjs')).runLimited;
  return runner('powershell', ['-NoProfile', '-NonInteractive', '-File', file, ...args], { env, timeout: timeoutMs });
}
