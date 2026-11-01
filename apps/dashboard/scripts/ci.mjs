// The dashboard's CI step (ci.yml job `dashboard`): a locked install with install scripts off, the type check, and the unit tests,
// which include the DECISIONS 44 plan gate (tests/plan-gate.test.mjs: every element carries its plan id, no invented copy, no dead
// controls, no placeholder data), then the Auth email templates against their plan rows (supabase/auth-emails/check.mjs and its
// mutants). No network to staging and no secret: the Playwright flows run by hand against staging.
//   node apps/dashboard/scripts/ci.mjs        exit 0 = every step passed
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(APP, '..', '..');
const win = process.platform === 'win32';
const bin = (name) => join(APP, 'node_modules', '.bin', win ? `${name}.cmd` : name);
// a path with a space (a checkout under "Program Files" or "Omnikom Platform") must be quoted for the Windows shell
const quote = (p) => (win && /\s/.test(p) ? `"${p}"` : p);
const steps = [
  ['install', win ? 'npm.cmd' : 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']],
  ['type check', bin('tsc'), ['--noEmit']],
  ['unit tests and the plan gate', bin('vitest'), ['run']],
  ['Auth email plan check', process.execPath, [join(ROOT, 'supabase', 'auth-emails', 'check.mjs')]],
  ['Auth email mutants', process.execPath, [join(ROOT, 'supabase', 'auth-emails', 'mutate.mjs')]],
];
for (const [name, cmd, args] of steps) {
  const t0 = Date.now();
  const r = spawnSync(quote(cmd), args.map(quote), { cwd: APP, encoding: 'utf8', timeout: 900000, shell: win });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split(/\r?\n/);
  const secs = Math.round((Date.now() - t0) / 1000);
  if (r.status !== 0) {
    console.log(`FAIL ${name} (exit ${r.status}${r.error ? `, ${r.error.code || r.error.message}` : ''}, ${secs} s)`);
    console.log(out.slice(-25).map((l) => `  ${l}`).join('\n'));
    process.exit(1);
  }
  console.log(`PASS ${name} (${secs} s): ${out.filter(Boolean).slice(-1)[0] || ''}`);
}
console.log('OK: dashboard install, type check, unit tests, plan gate and Auth email checks passed');
