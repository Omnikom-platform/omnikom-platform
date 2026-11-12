// The heavy-job adapter: hands one job to the machine's own heavy.mjs (its path is "heavyScript" in machine.local.json). heavy.mjs holds the
// machine's lock, the RAM check and the queue; this adapter has no lock, queue, cap or wait of its own, and starts the child only through
// proc-guard's runLimited so that a time limit ends its whole tree. `run` is the tests' seam; its result is returned unchanged.
import { Blocked, Usage } from './errors.mjs';
import { importRepo } from './repo.mjs';
import { machinePath } from './machine.mjs';

const isMs = n => typeof n === 'number' && Number.isFinite(n) && n > 0;

export async function runHeavy({ label, command, waitMin, timeoutMs, env = process.env, cwd, run } = {}) {
  if (typeof label !== 'string' || !/^[^\r\n]{1,100}$/.test(label)) throw new Usage('a heavy job needs a label of one line, 1 to 100 characters');
  if (!Array.isArray(command) || command.length === 0 || command.some(w => typeof w !== 'string' || w === '')) throw new Usage('a heavy job needs a command: a list of words after --');
  if (waitMin !== undefined && !(typeof waitMin === 'number' && Number.isFinite(waitMin) && waitMin >= 0)) throw new Usage('--wait-min must be a number of minutes, 0 or more');
  if (!isMs(timeoutMs)) throw new Usage('a heavy job needs a time limit in milliseconds, above 0');
  const script = machinePath('heavyScript', 'file', env);
  const runner = run || (await importRepo('tools/proc-guard/index.mjs')).runLimited;
  const args = [script, ...(waitMin === undefined ? [] : ['--wait-min', String(waitMin)]), '--label', label, '--', ...command];
  const r = await runner(process.execPath, args, { cwd, env, timeout: timeoutMs });
  // heavy.mjs ends 75 when its wait ran out and says so on stderr; only that is BLOCKED, any other result is the caller's to read
  const line = /^heavy: ((?:gave up after|refused:) .*Nothing was run\.)$/m.exec(r.stderr || '');
  if (r.status === 75 && line) throw new Blocked(`the heavy job '${label}' did not start: ${line[1]}`, 'run it again when the machine is free, or give a longer --wait-min');
  return r;
}
