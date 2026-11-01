// ONE real launch-and-stop with a Haiku session (costs a few cents, opens a window for about HOLD seconds). Run by hand, not by run.mjs.
//   node tools/departments/test/start-builder.live.mjs [hold-seconds]      exit 0 = started, registered, stopped, nothing left
// While it holds, the caller can ListAgents and SendMessage the session by name BUILDER_cli-and-testing_live-probe.
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hold = Number(process.argv[2] || 30);
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ': ' + String(detail).slice(0, 400)}`); };
const run = (script, args) => { const r = spawnSync(process.execPath, [join(TOOLS, script), ...args], { encoding: 'utf8', timeout: 150000 }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }; };

const started = run('start-builder.mjs', ['--dept', 'cli-and-testing', '--slice', 'live-probe', '--model', 'haiku']);
let s = null;
try { s = JSON.parse(started.out.trim().split(/\r?\n/).pop()); } catch { /* reported below */ }
check('start: exit 0 and one JSON line {name, pid, model, cwd}', started.status === 0 && s && s.name === 'BUILDER_cli-and-testing_live-probe' && Number.isInteger(s.pid) && s.model === 'claude-haiku-5-5', started.out);
console.log(started.out.trim());
if (s && Number.isInteger(s.pid)) {
  let alive = false;
  try { process.kill(s.pid, 0); alive = true; } catch { /* gone */ }
  check('the session process is alive after start', alive);
  console.log(`holding ${hold} s (ListAgents / SendMessage now)`);
  await new Promise(r => setTimeout(r, hold * 1000));
  const stopped = run('stop-builder.mjs', ['--pid', String(s.pid)]);
  console.log(stopped.out.trim());
  check('stop: exit 0 and nothing left', stopped.status === 0 && /"left":\[\]/.test(stopped.out), stopped.out);
  let still = false;
  try { process.kill(s.pid, 0); still = true; } catch { /* gone */ }
  check('the session process is gone after stop', !still);
  check('the launcher file is removed', !existsSync(s.launcher), s.launcher);
}
console.log(failed ? `FAILED: ${failed}` : 'OK: live launch-and-stop passed');
process.exit(failed ? 1 : 0);
