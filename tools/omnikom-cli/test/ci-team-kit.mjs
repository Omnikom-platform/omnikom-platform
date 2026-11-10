// ci-team-kit.mjs: the step of the ci.yml job team-kit-hooks: the team kit's hook test, when the change touches the kit.
//   node tools/omnikom-cli/test/ci-team-kit.mjs
// tools/team-kit/test-agent-hooks.mjs (51 checks, 10 mutants, about 8 minutes) runs in its own parallel job so it never adds to the land wait
// for everything else. The job always starts (`omnikom ci` models no `paths:` or `if:`; land expects every ci.yml job by name); this script
// decides, the way test/ci-heavy.mjs does, from the change's files (lib/ci-base.mjs: the merge base with origin/master, fetch-depth 0).
//   needed    any changed file under tools/team-kit/, or .github/workflows/ci.yml, or this script, or lib/ci-base.mjs (what it decides with).
//             No base found (or an unusable one) means run: fail safe. On master itself the diff is empty, so it skips.
//   then      node tools/team-kit/test-agent-hooks.mjs as a child; its exit code is this script's (a child that cannot start is 1).
//   otherwise prints "ci-team-kit: not needed (<reason>)" and exits 0 at once.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedSinceBase } from '../lib/ci-base.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_DIR = 'tools/team-kit/';
const CI_YML = '.github/workflows/ci.yml';
const OWN = ['tools/omnikom-cli/test/ci-team-kit.mjs', 'tools/omnikom-cli/lib/ci-base.mjs'];
const HOOK_TEST = ['tools', 'team-kit', 'test-agent-hooks.mjs'];

// -> { needed, reason, changed }   (never throws: anything unreadable means needed)
export function decide({ repo, env = process.env }) {
  const c = changedSinceBase({ repo, env });
  if (!c.ok) return { needed: true, reason: c.reason, changed: [] };
  const hit = c.changed.filter(f => f.startsWith(KIT_DIR) || f === CI_YML || OWN.includes(f));
  if (hit.length) return { needed: true, reason: hit.slice(0, 5).join(', '), changed: c.changed };
  return { needed: false, reason: `${c.changed.length} changed files, none under ${KIT_DIR}`, changed: c.changed };
}

// -> the exit code. `spawn` runs the child (a test hands a fake); `log` prints a line. Any argument is a usage error (exit 2, nothing runs).
export function ciTeamKit({ repo, env = process.env, spawn = spawnSync, log = console.log, argv = [] } = {}) {
  if (argv.length) { log(`ci-team-kit: usage: no arguments (got ${argv.join(' ')})`); return 2; }
  const v = decide({ repo, env });
  if (!v.needed) { log(`ci-team-kit: not needed (${v.reason})`); return 0; }
  log(`ci-team-kit: needed (${v.reason})`);
  const r = spawn(process.execPath, [join(repo, ...HOOK_TEST)], { cwd: repo, env, stdio: 'inherit', timeout: 3600 * 1000, windowsHide: true });
  const code = r.error ? 1 : (r.status === null || r.status === undefined ? 1 : r.status);
  if (code !== 0) { log(`ci-team-kit: test-agent-hooks.mjs failed (exit ${code})`); return code; }
  log('ci-team-kit: test-agent-hooks.mjs passed');
  return 0;
}

const isMain = (() => { try { return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) process.exitCode = ciTeamKit({ repo: resolve(HERE, '..', '..', '..'), argv: process.argv.slice(2) });
