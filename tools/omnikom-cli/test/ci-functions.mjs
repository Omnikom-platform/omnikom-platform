// ci-functions.mjs: the step "Function mutants, one shard" of the four jobs functions-mutants-1..4.
//   node tools/omnikom-cli/test/ci-functions.mjs --shard i/N    decide, then node supabase/functions/test/mutate.mjs --shard i/N (or skip and succeed)
// The function mutants run only when the change can move their verdict: the functions themselves, or what their tests or their mutate
// copy read (head of operations 2026-11-10 23:18; they ran on every push, 4 jobs and about 65 runner minutes, while most pushes are CLI,
// SEO or client files). The platform department owns supabase/functions/test/mutate.mjs; this script only decides whether to call it,
// unchanged. A skipped shard is a green job (lib/ghrun.mjs needs every job of ci.yml green).
//   base      lib/ci-base.mjs, the same as test/ci-heavy.mjs: no usable base means run (fail safe); master itself has nothing changed.
//   needed    any changed file under one of FUNCTION_INPUTS (below). Measured from the imports of supabase/functions and its test
//             harness on 2026-11-10: _shared libs and the functions (inside the folder), contracts/ (validate, place), tools/crm-map/,
//             tools/proc-guard/, the shard planner tools/omnikom-cli/test/mutate-run.mjs, the migrations and seeds the harness applies
//             (supabase/migrations/, supabase/tests/), deno.json and deno.lock, ci.yml and this file. The harness seeds its database with
//             the CLI's commands/seed.mjs (seedTestSql), which imports most of lib/ and reads sites/test-demo-a/ (contract, rows, logo):
//             both are inputs (platform head, 2026-11-10 23:29, who also agreed to the skip).
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { changedSinceBase } from '../lib/ci-base.mjs';
import { parseShard } from './mutate-run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// a path that is, or sits under, one of these moves the function mutants' verdict
export const FUNCTION_INPUTS = ['supabase/functions/', 'supabase/migrations/', 'supabase/tests/', 'contracts/', 'tools/crm-map/', 'tools/proc-guard/',
  'tools/omnikom-cli/test/mutate-run.mjs', 'tools/omnikom-cli/test/ci-functions.mjs', 'tools/omnikom-cli/commands/seed.mjs', 'tools/omnikom-cli/lib/',
  'sites/test-demo-a/', 'deno.json', 'deno.lock', '.github/workflows/ci.yml'];
export const isFunctionInput = f => FUNCTION_INPUTS.some(p => (p.endsWith('/') ? f.startsWith(p) : f === p));

// -> { needed, reason }   (never throws: anything unreadable means needed)
export function decideFunctions({ repo, env = process.env }) {
  const c = changedSinceBase({ repo, env });
  if (!c.ok) return { needed: true, reason: c.reason };
  const hit = c.changed.filter(isFunctionInput);
  if (hit.length) return { needed: true, reason: hit.slice(0, 5).join(', ') };
  return { needed: false, reason: `${c.changed.length} changed files, none read by the function mutants` };
}

// -> the exit code. `spawn` runs the child (a test hands a fake); `log` prints a line. argv must be --shard i/N; anything else is exit 2.
export function ciFunctions({ repo, env = process.env, spawn = spawnSync, log = console.log, argv = [] } = {}) {
  let shard = null;
  try { shard = parseShard(argv); } catch (e) { log(`ci-functions: ${e.message}`); return 2; }
  const stray = argv.filter((a, k) => a !== '--shard' && argv[k - 1] !== '--shard');
  if (!shard || stray.length) { log(`ci-functions: usage: --shard i/N (got ${argv.join(' ') || 'nothing'})`); return 2; }
  const v = decideFunctions({ repo, env });
  if (!v.needed) { log(`ci-functions: not needed (${v.reason})`); log(`ci-functions: shard ${shard.i}/${shard.n} skipped: the change does not reach the function mutants`); return 0; }
  log(`ci-functions: needed (${v.reason})`);
  const r = spawn(process.execPath, [join(repo, 'supabase', 'functions', 'test', 'mutate.mjs'), '--shard', `${shard.i}/${shard.n}`], { cwd: repo, env, stdio: 'inherit', timeout: 6 * 3600 * 1000, windowsHide: true });
  const code = r.error ? 1 : (r.status === null || r.status === undefined ? 1 : r.status);
  log(code === 0 ? 'ci-functions: mutate.mjs passed' : `ci-functions: mutate.mjs failed (exit ${code})`);
  return code;
}

const isMain = (() => { try { return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) process.exitCode = ciFunctions({ repo: resolve(HERE, '..', '..', '..'), argv: process.argv.slice(2) });
