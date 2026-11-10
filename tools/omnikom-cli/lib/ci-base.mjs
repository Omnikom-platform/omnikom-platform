// ci-base.mjs: the files a change touches, for the CI scripts that decide inside the job whether to run (test/ci-heavy.mjs, test/ci-team-kit.mjs).
// `omnikom ci` models no `paths:` or `if:`, so each such job always starts and its script decides.
//   base      $OMNIKOM_CI_BASE when set; else the merge base of HEAD with refs/remotes/origin/master, then refs/remotes/backup-gh/master.
//             No base found (or an unusable one) is { ok: false }: the caller runs its work (fail safe).
//   changed   git diff --name-only base..HEAD, NUL-separated, no rename detection.
// -> { ok: true, changed } | { ok: false, reason }   (never throws)
import { makeGit } from './git.mjs';

const splitZ = s => String(s || '').split('\0').filter(Boolean);

export function changedSinceBase({ repo, env = process.env }) {
  const git = makeGit(repo);
  if (!git.run(['rev-parse', '--git-dir']).ok) return { ok: false, reason: `${repo} is not a git repository, fail safe` };
  let base = '';
  if (env.OMNIKOM_CI_BASE) {
    const r = git.run(['rev-parse', '--verify', '--quiet', `${env.OMNIKOM_CI_BASE}^{commit}`]);
    if (!r.ok) return { ok: false, reason: `OMNIKOM_CI_BASE ${env.OMNIKOM_CI_BASE} is not a commit here, fail safe` };
    base = r.out;
  } else {
    for (const ref of ['refs/remotes/origin/master', 'refs/remotes/backup-gh/master']) {
      const r = git.run(['merge-base', 'HEAD', ref]);
      if (r.ok && r.out) { base = r.out; break; }
    }
  }
  if (!base) return { ok: false, reason: 'no base commit found (no OMNIKOM_CI_BASE, no origin/master or backup-gh/master), fail safe' };
  const d = git.run(['diff', '--name-only', '-z', '--no-renames', base, 'HEAD']);
  if (!d.ok) return { ok: false, reason: `git diff ${base} HEAD failed (${(d.err || '').split('\n')[0].slice(0, 100)}), fail safe` };
  return { ok: true, changed: splitZ(d.out) };
}
