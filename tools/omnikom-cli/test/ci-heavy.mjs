// ci-heavy.mjs: the cli job's step "CLI full suite (when the change reaches it)" and the steps of the six jobs cli-mutants-1..6.
//   node tools/omnikom-cli/test/ci-heavy.mjs               run.mjs, then mutate.mjs (all mutants): what a person runs, and what omnikom ci runs for a job with neither flag
//   node tools/omnikom-cli/test/ci-heavy.mjs --suite       run.mjs only: the cli job (the mutants run in the shard jobs, in parallel)
//   node tools/omnikom-cli/test/ci-heavy.mjs --shard i/N   mutate.mjs --shard i/N only: the job cli-mutants-i of N (53 to 78 minutes in one job, runs 42680701873, 42688877100, 42693457902)
// The CLI's unit run stays on every push; its full suite (test/run.mjs: units plus the database part) and its mutants (test/mutate.mjs) take
// long and cost Actions minutes, so they run only when the change can reach them (DECISIONS 45, head of operations). The script decides, not
// ci.yml (`omnikom ci` does not model `if:`).
//   base      $OMNIKOM_CI_BASE when set; else the merge base of HEAD with refs/remotes/origin/master, then refs/remotes/backup-gh/master.
//             No base found (or an unusable one) means run heavy: fail safe. On master itself the diff against origin/master is empty, so
//             it skips: master only takes a commit that was already green on a check branch.
//   needed    any changed file under tools/omnikom-cli/, or .github/workflows/ci.yml, or a file that `omnikom impact` (analyse of
//             commands/impact.mjs: the one graph) says the `cli` job reaches (seed.mjs, tenancy.test.sql, apply-staging.mjs, whatever the graph sees).
//   then      node test/run.mjs, then node test/mutate.mjs, as children, one after the other; the exit code is the first failure's (a failed
//             run.mjs stops there: the mutants' baseline would fail the same way). --suite and --shard run one of the two.
//   Every shard decides for itself: a change that does not reach the CLI makes each shard say so in its log and succeed (a skipped shard is a green job).
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGit } from '../lib/git.mjs';
import { treeSource } from '../lib/graph.mjs';
import { analyse } from '../commands/impact.mjs';
import { parseShard } from './mutate-run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_DIR = 'tools/omnikom-cli/';
const CI_YML = '.github/workflows/ci.yml';
const splitZ = s => String(s || '').split('\0').filter(Boolean);

// -> { needed, reason, changed }   (never throws: anything unreadable means needed)
export function decide({ repo, env = process.env }) {
  const git = makeGit(repo);
  if (!git.run(['rev-parse', '--git-dir']).ok) return { needed: true, reason: `${repo} is not a git repository, fail safe`, changed: [] };
  let base = '';
  if (env.OMNIKOM_CI_BASE) {
    const r = git.run(['rev-parse', '--verify', '--quiet', `${env.OMNIKOM_CI_BASE}^{commit}`]);
    if (!r.ok) return { needed: true, reason: `OMNIKOM_CI_BASE ${env.OMNIKOM_CI_BASE} is not a commit here, fail safe`, changed: [] };
    base = r.out;
  } else {
    for (const ref of ['refs/remotes/origin/master', 'refs/remotes/backup-gh/master']) {
      const r = git.run(['merge-base', 'HEAD', ref]);
      if (r.ok && r.out) { base = r.out; break; }
    }
  }
  if (!base) return { needed: true, reason: 'no base commit found (no OMNIKOM_CI_BASE, no origin/master or backup-gh/master), fail safe', changed: [] };
  const d = git.run(['diff', '--name-only', '-z', '--no-renames', base, 'HEAD']);
  if (!d.ok) return { needed: true, reason: `git diff ${base} HEAD failed (${(d.err || '').split('\n')[0].slice(0, 100)}), fail safe`, changed: [] };
  const changed = splitZ(d.out);
  const direct = changed.filter(f => f.startsWith(CLI_DIR) || f === CI_YML);
  if (direct.length) return { needed: true, reason: direct.slice(0, 5).join(', '), changed };
  if (changed.length === 0) return { needed: false, reason: '0 changed files, none read by the CLI suite', changed };
  let reached;
  try {
    const a = analyse({ git, source: treeSource(git, 'HEAD'), changed, extraPaths: changed });
    reached = a.changed.filter(c => c.gates.includes('job cli')).map(c => c.path);
  } catch (e) { return { needed: true, reason: `impact could not be computed (${String(e && e.message).slice(0, 100)}), fail safe`, changed }; }
  if (reached.length) return { needed: true, reason: reached.slice(0, 5).join(', '), changed };
  return { needed: false, reason: `${changed.length} changed files, none read by the CLI suite`, changed };
}

// -> the exit code. `spawn` runs a child (a test hands a fake); `log` prints a line.
// argv: the flags after the script name (--suite, --shard i/N); a bad flag is exit 2 and nothing runs.
export function ciHeavy({ repo, env = process.env, spawn = spawnSync, log = console.log, cliDir = HERE, argv = [] } = {}) {
  let shard = null;
  try { shard = parseShard(argv); } catch (e) { log(`ci-heavy: ${e.message}`); return 2; }
  const suite = argv.includes('--suite');
  const stray = argv.filter((a, k) => a !== '--suite' && a !== '--shard' && argv[k - 1] !== '--shard');
  if (stray.length || (suite && shard)) { log(`ci-heavy: usage: [--suite | --shard i/N] (got ${argv.join(' ') || 'nothing'})`); return 2; }
  const v = decide({ repo, env });
  if (!v.needed) { log(`ci-heavy: not needed (${v.reason})`); if (suite || shard) log(`ci-heavy: ${shard ? `shard ${shard.i}/${shard.n}` : 'the full suite'} skipped: the change does not reach the CLI suite`); return 0; }
  log(`ci-heavy: needed (${v.reason})`);
  const plan = shard ? [['mutate.mjs', ['--shard', `${shard.i}/${shard.n}`]]] : suite ? [['run.mjs', []]] : [['run.mjs', []], ['mutate.mjs', []]];
  for (const [script, args] of plan) {
    const r = spawn(process.execPath, [join(cliDir, script), ...args], { cwd: repo, env, stdio: 'inherit', timeout: 6 * 3600 * 1000, windowsHide: true });
    const code = r.error ? 1 : (r.status === null || r.status === undefined ? 1 : r.status);
    if (code !== 0) { log(`ci-heavy: ${script} failed (exit ${code})${script === 'run.mjs' ? '; mutate.mjs not run' : ''}`); return code; }
    log(`ci-heavy: ${script} passed`);
  }
  return 0;
}

const isMain = (() => { try { return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) process.exitCode = ciHeavy({ repo: resolve(HERE, '..', '..', '..'), argv: process.argv.slice(2) });
