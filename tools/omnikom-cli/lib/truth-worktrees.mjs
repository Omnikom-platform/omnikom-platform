// The worktrees of `omnikom truth`: which worktrees are leftovers (every commit already in master, nothing uncommitted: remove them) and which hold
// work that master does not have (listed; drift only when its last commit is older than STALE_DAYS, so a builder in flight does not turn every run red).
// The baseline is refs/remotes/backup-gh/master when it exists (what `omnikom land` moves; no fetch), else local master, else Blocked.
// "In master" is by content: `git cherry` marks a commit whose patch is already in the baseline with `-`, so a branch merged by squash is a leftover.
// Read-only: git list, rev-parse, cherry, status, log. -> { master, baseName, items: [{ what, where }], flight }
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Blocked } from './errors.mjs';
import { makeGit } from './git.mjs';
import { mainCheckoutOf } from '../commands/skill.mjs';

export const STALE_DAYS = 3;
const DAY = 86400;
const BASELINES = ['refs/remotes/backup-gh/master', 'refs/heads/master'];
const norm = p => resolve(String(p)).replace(/\\/g, '/').toLowerCase();
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;

// `git worktree list --porcelain` -> [{ path, head, branch | null }] (a bare entry is skipped)
function listBlocks(text) {
  const out = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const w = { path: '', head: '', branch: null, bare: false };
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) w.path = line.slice(9);
      else if (line.startsWith('HEAD ')) w.head = line.slice(5).trim();
      else if (line.startsWith('branch ')) w.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
      else if (line === 'bare') w.bare = true;
    }
    if (w.path && w.head && !w.bare) out.push(w);
  }
  return out;
}

export function readWorktrees({ repo, now }) {
  const git = makeGit(repo);
  let main;
  try { main = mainCheckoutOf(repo); } catch (e) { throw new Blocked(`cannot read the repository ${repo}: ${String(e.message).slice(0, 120)}`, 'run it in a checkout of the Omnikom repository'); }
  const base = BASELINES.map(ref => ({ ref, r: git.run(['rev-parse', '--verify', '--quiet', ref]) })).find(x => x.r.ok);
  if (!base) throw new Blocked('neither refs/remotes/backup-gh/master nor master exists, so there is nothing to compare the worktrees with', 'fetch backup-gh or create master');
  const baseName = base.ref.replace(/^refs\/(?:remotes|heads)\//, '');
  const listed = git.run(['worktree', 'list', '--porcelain']);
  if (!listed.ok) throw new Blocked(`git worktree list failed: ${listed.err.split('\n')[0].slice(0, 120)}`, 'run it in a checkout of the Omnikom repository');
  const items = [];
  let flight = 0;
  for (const w of listBlocks(listed.out)) {
    if (norm(w.path) === norm(main)) continue;
    const missing = !existsSync(w.path);
    const cherry = git.run(['cherry', base.ref, w.head]);
    if (!cherry.ok) throw new Blocked(`git cherry failed for ${w.path}: ${cherry.err.split('\n')[0].slice(0, 120)}`, 'run git worktree prune, then run it again');
    const notIn = cherry.out.split('\n').filter(l => l.startsWith('+')).length;
    let dirty = 0;
    if (!missing) {
      const st = makeGit(w.path).run(['status', '--porcelain']);
      if (!st.ok) throw new Blocked(`git status failed in ${w.path}: ${st.err.split('\n')[0].slice(0, 120)}`, 'check that worktree');
      dirty = st.out.split('\n').filter(l => l.trim()).length;
    }
    const branch = w.branch || '(detached)';
    const isLeftover = missing || (notIn === 0 && dirty === 0);
    if (isLeftover) {
      items.push({ what: `leftover: branch ${branch}, ${missing ? 'folder missing' : 'every commit is in master'}`, where: w.path });
      continue;
    }
    const log = git.run(['log', '-1', '--format=%ct', w.head]);
    const age = (now - Number(log.out)) / DAY;
    if (!log.ok || !Number.isFinite(age)) throw new Blocked(`git log failed for ${w.path}`, 'check that worktree');
    if (age > STALE_DAYS) {
      items.push({ what: `work not in master: branch ${branch}, ${plural(notIn, 'commit')} not in master, ${plural(dirty, 'uncommitted file')}, last commit ${Math.floor(age)} days ago`, where: w.path });
    } else flight++;
  }
  return { master: base.r.out.slice(0, 8), baseName, items, flight };
}
