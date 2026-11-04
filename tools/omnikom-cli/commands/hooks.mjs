// hooks install | uninstall | status | pre-push   (DECISIONS 45, which amends 43 part 5; DECISIONS 46 moves the verdict to the public copy)
// `install` writes <git common dir>/hooks/pre-push, a three-line shell shim that runs `hooks pre-push`; git calls that with the remote's name
// and url as arguments and, on stdin, one line per pushed ref: "<local ref> <local sha> <remote ref> <remote sha>".
// `pre-push` decides by the REMOTE ref:
//   refs/heads/check/**   allowed (create, update or delete): a head pushes its commit there and GitHub runs ci on it;
//   refs/heads/land-lock  allowed (create and delete): the landing queue of `omnikom land` (commands/land.mjs);
//   refs/heads/master     only a fast-forward to a commit whose PUBLIC COPY had a ci run on GitHub with every ci.yml job green (lib/ghrun.mjs, read
//                         with gh, from the public repository named in public-copy.json). The copy commit is a function of the pushed commit
//                         (lib/copy.mjs: same tree minus the denylist, same author and dates, root commit), so the commit whose run is read is
//                         COMPUTED here, never looked up by a branch name or a message: a run of a copy with another tree is another commit.
//                         A delete is refused; no gh answer, no rules file and no public repository is a refusal (fail closed);
//   any other ref         refused: master is reached only through `omnikom land`, work goes to check/**.
// The impact graph has known gaps (runtime-built paths, import maps), so it cannot be the judge of "prose only": there is no prose exception.
// `git push --no-verify` skips every hook. It is the owner's override alone; no session, head or builder ever uses it.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Usage, Blocked } from '../lib/errors.mjs';
import { result } from '../lib/ctx.mjs';
import { makeGit, ZERO_SHA } from '../lib/git.mjs';
import { redact } from '../lib/redact.mjs';
import { commonDirOf } from '../lib/checkout.mjs';
import { ciVerdict, jobNamesAt, repoFromUrl } from '../lib/ghrun.mjs';
import { expectedCopyCommit, publicRepoOf } from '../lib/copy.mjs';
import { LOCK_REF } from '../lib/landlock.mjs';

export const HOOK_MARK = '# omnikom pre-push';
export const HOOK_TEXT = `#!/bin/sh\n${HOOK_MARK} (DECISIONS 45)\nexec node tools/omnikom-cli/omnikom.mjs hooks pre-push "$@"\n`;
export const NO_VERIFY_LINE = "pre-push: --no-verify is the owner's alone; no session uses it.";

const isOurs = text => /^# omnikom pre-push/m.test(text);

function hookFile(git) {
  const hp = git.run(['config', '--get', 'core.hooksPath']);
  return { file: join(commonDirOf(git), 'hooks', 'pre-push'), hooksPath: hp.ok && hp.out ? hp.out : '' };
}

function install(ctx, git) {
  const { file, hooksPath } = hookFile(git);
  if (hooksPath) throw new Blocked(`core.hooksPath is set to ${hooksPath}; git would not run ${file}`, 'unset core.hooksPath, or put the shim in that folder by hand');
  let action = 'installed';
  if (existsSync(file)) {
    const have = readFileSync(file, 'utf8');
    if (!isOurs(have)) throw new Blocked(`${file} is a pre-push hook that is not omnikom's; it is left as it is`, 'merge the omnikom line into it by hand, or remove it yourself');
    if (have === HOOK_TEXT) return result(true, 'ok', { state: 'installed', action: 'unchanged', path: file });
    action = 'updated';
  }
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, HOOK_TEXT);
  try { chmodSync(file, 0o755); } catch { /* not every file system keeps a mode */ }
  return result(true, 'ok', { state: 'installed', action, path: file });
}

function uninstall(ctx, git) {
  const { file } = hookFile(git);
  if (!existsSync(file)) return result(true, 'ok', { state: 'not installed', action: 'nothing to remove', path: file });
  if (!isOurs(readFileSync(file, 'utf8'))) throw new Blocked(`${file} is a pre-push hook that is not omnikom's; it is left as it is`, 'remove it yourself if you want it gone');
  rmSync(file);
  return result(true, 'ok', { state: 'not installed', action: 'removed', path: file });
}

function status(ctx, git) {
  const { file, hooksPath } = hookFile(git);
  let state = 'not installed';
  if (existsSync(file)) state = isOurs(readFileSync(file, 'utf8')) ? 'installed' : 'foreign';
  return result(true, 'ok', { state, path: file, ...(hooksPath ? { hooksPath, note: `core.hooksPath is set to ${hooksPath}: git does not run ${file}` } : {}) });
}

// the github repository of the remote being pushed to: the url git passes (second argument), else the remote's own url. ctx.ghRepo is a
// test's way to name it (a throwaway bare remote is not on github.com); it is not an environment variable, so no session can point the
// hook at another repository's runs.
export function repoOfRemote(ctx, git, name, url) {
  if (ctx.ghRepo) return ctx.ghRepo;
  let u = url;
  if (!u && name) { const r = git.run(['remote', 'get-url', name]); if (r.ok) u = r.out; }
  return repoFromUrl(u);
}


// the verdict of one pushed ref: { allowed, lines }
export async function checkRef(ctx, git, where, [lref, lsha, rref, rsha]) {
  const ref = rref || lref;
  const isDelete = !lsha || ZERO_SHA.test(lsha);
  if (/^refs\/heads\/check\/.+/.test(ref)) return { allowed: true, lines: [`pre-push: ${ref} is a check branch, allowed`] };
  if (ref === LOCK_REF) return { allowed: true, lines: [`pre-push: ${ref} is the land queue, allowed`] };   // omnikom land's lock (create and delete)
  if (ref !== 'refs/heads/master') {
    return { allowed: false, lines: [`pre-push: REFUSED ${ref}: master is reached only through land, and work goes to a check branch; push to refs/heads/check/<department>/<slug> instead`] };
  }
  if (isDelete) return { allowed: false, lines: [`pre-push: REFUSED ${ref}: deleting master is not allowed`] };
  if (rsha && !ZERO_SHA.test(rsha)) {
    const known = git.run(['cat-file', '-e', `${rsha}^{commit}`]).ok;
    if (!known) return { allowed: false, lines: [`pre-push: REFUSED ${ref}: the remote master ${rsha} is not in this clone, so a fast-forward cannot be shown; fetch first`] };
    if (!git.run(['merge-base', '--is-ancestor', rsha, lsha]).ok) return { allowed: false, lines: [`pre-push: REFUSED ${ref}: ${lsha} is not a fast-forward of the remote master ${rsha}; rebase onto master and land again`] };
  }
  let v, repo, copySha;
  try {
    const exp = expectedCopyCommit(git, lsha);
    copySha = exp.copySha;
    repo = publicRepoOf(ctx, exp.built.rules);
    v = await ciVerdict(ctx, { repo, sha: copySha, jobNames: jobNamesAt(git, copySha) });
  } catch (e) {
    if (!(e instanceof Blocked)) throw e;
    return { allowed: false, lines: [`pre-push: REFUSED ${ref}: ${e.message}`, ...(e.unblock ? [`pre-push: to unblock: ${e.unblock}`] : [])] };
  }
  if (v.state === 'green') return { allowed: true, lines: [`pre-push: ${v.lines[0]}`, `pre-push: verdict from ${repo} of the copy ${copySha} of ${lsha}`] };
  return { allowed: false, lines: [`pre-push: REFUSED ${ref}: ${lsha} has no green ci run on the public copy ${copySha} (${repo}); push it to check/<department>/<slug>, run: node tools/omnikom-cli/omnikom.mjs copy push check/<department>/<slug>, then: node tools/omnikom-cli/omnikom.mjs land check/<department>/<slug>`, ...v.lines.map(l => `pre-push: ${l}`)] };
}

async function prePush(ctx, git) {
  const where = { name: ctx.positionals[2] || '', url: ctx.positionals[3] || '' };
  const input = ctx.stdin === undefined ? '' : String(ctx.stdin);
  const lines = [];
  let refused = false;
  for (const raw of input.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const parts = raw.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const v = await checkRef(ctx, git, where, parts);
    lines.push(...v.lines);
    if (!v.allowed) refused = true;
  }
  if (lines.length === 0) lines.push('pre-push: nothing to check');
  if (refused) lines.push(NO_VERIFY_LINE);
  return result(!refused, refused ? 'PUSH-REFUSED' : 'ok', { refused, lines });
}

export async function hooksGroup(ctx) {
  const verb = ctx.positionals[1];
  if (!['install', 'uninstall', 'status', 'pre-push'].includes(verb)) throw new Usage('hooks needs one of: install | uninstall | status | pre-push');
  if (ctx.flags.target !== undefined || ctx.flags.expect !== undefined) throw new Usage('hooks takes no --target and no --expect');
  if (verb !== 'pre-push' && ctx.positionals.length > 2) throw new Usage(`hooks ${verb}: unexpected argument '${ctx.positionals[2]}'`);
  const git = makeGit(ctx.repo);
  if (!git.run(['rev-parse', '--git-dir']).ok) throw new Usage(`${ctx.repo} is not a git repository`);
  if (verb === 'install') return install(ctx, git);
  if (verb === 'uninstall') return uninstall(ctx, git);
  if (verb === 'status') return status(ctx, git);
  return prePush(ctx, git);
}

export function hooksText(obj, env) {
  const d = obj.data;
  if (obj.error || !d) return redact(`ERROR ${obj.error || obj.code}`, env) + '\n' + (obj.unblock ? redact(`  to unblock: ${obj.unblock}`, env) + '\n' : '');
  if (Array.isArray(d.lines)) return d.lines.map(l => redact(l, env)).join('\n') + '\n';
  const out = [`pre-push hook: ${d.state}${d.action && d.action !== d.state ? ` (${d.action})` : ''}`, `  ${d.path}`];
  if (d.note) out.push(`  ${d.note}`);
  return out.join('\n') + '\n';
}
