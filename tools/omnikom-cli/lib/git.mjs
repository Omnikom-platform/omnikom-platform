// git, run for real (never through ctx.spawn, which tests replace with a recorder): impact, hooks, land and ci --staged all ask the repository
// itself. Every call has a timeout (windows-scripting rule 12); GIT_DIR and friends are removed from the environment, because git sets
// them for a hook and they would point a child git at the wrong repository.
import { spawnSync } from 'node:child_process';

const STRIP = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_NAMESPACE'];
export const ZERO_SHA = /^0+$/;

export function makeGit(cwd, spy) {   // spy: a test hands a function that sees every argument list (land never passes --force or --no-verify)
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  for (const k of STRIP) delete env[k];
  // { ok, out, err, status }: never throws
  const run = (args, { input, extraEnv, timeout = 120000, buffer = false } = {}) => {
    if (spy) spy(args);
    const r = spawnSync('git', args, { cwd, env: extraEnv ? { ...env, ...extraEnv } : env, input, timeout, maxBuffer: 1 << 29, windowsHide: true, ...(buffer ? {} : { encoding: 'utf8' }) });
    const ok = !r.error && r.status === 0;
    const text = b => (b == null ? '' : buffer ? b : String(b));
    return { ok, status: r.status, out: buffer ? r.stdout : text(r.stdout).replace(/\r?\n$/, ''), err: r.error ? String(r.error.message) : String(r.stderr || '').trim() };
  };
  // the trimmed stdout, or an Error that carries git's own words
  const out = (args, opts) => {
    const r = run(args, opts);
    if (!r.ok) throw new Error(`git ${args.slice(0, 3).join(' ')}: ${(r.err || `exit ${r.status}`).split('\n')[0].slice(0, 200)}`);
    return r.out;
  };
  return { cwd, run, out };
}
