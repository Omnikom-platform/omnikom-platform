// The throwaway checkout of ONE exact tree (DECISIONS 45): `omnikom ci --staged | --commit <sha>` reproduces a red GitHub job on the tree GitHub
// ran, so it never runs on the working tree (other sessions' unfinished files sit there): it runs in a checkout of exactly the tree
// (`git write-tree` of the index, or a commit's tree). There is no local stamp any more: the evidence that a tree passed is the green GitHub
// run of its commit, read with `gh` (lib/ghrun.mjs).
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { Usage } from './errors.mjs';

// One constant: the throwaway checkouts live on D: (E: is nearly full) and never under a path containing "claude" (a local guard refuses it).
export const GATES_ROOT = 'D:/omk-gates';
const TREE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export function checkRoot(root) {
  const norm = resolve(String(root)).replace(/\\/g, '/');
  if (/^[eE]:/.test(norm) || /^[eE]:/.test(String(root))) throw new Usage(`the checkout root ${norm} is on E: (almost full); use a folder on D: or C:`);
  if (/claude/i.test(norm)) throw new Usage(`the checkout root ${norm} contains "claude", which a local guard refuses; use another folder`);
  return norm;
}

// --commit <sha> -> that commit's tree; otherwise the tree of the index (what a commit made now would hold)
export function treeOf(git, { commit } = {}) {
  if (commit !== undefined) {
    const r = git.run(['rev-parse', '--verify', '--quiet', `${commit}^{tree}`]);
    if (!r.ok || !TREE.test(r.out)) throw new Usage(`--commit ${commit}: no such commit`);
    return r.out;
  }
  const r = git.run(['write-tree']);
  if (!r.ok || !TREE.test(r.out)) throw new Usage(`git write-tree failed (${(r.err || 'no output').split('\n')[0].slice(0, 160)}); resolve the index first`);
  return r.out;
}

// the .git folder shared by every worktree of this repository, absolute
export function commonDirOf(git) {
  const out = git.out(['rev-parse', '--git-common-dir']);
  return resolve(git.cwd, out).replace(/\\/g, '/');
}

const IDENT = { GIT_AUTHOR_NAME: 'omnikom', GIT_AUTHOR_EMAIL: 'omnikom@localhost', GIT_COMMITTER_NAME: 'omnikom', GIT_COMMITTER_EMAIL: 'omnikom@localhost' };

// remove the checkout: git first, then the folder itself if git left it, then prune; true when the folder is gone
export function removeCheckout(git, dir) {
  git.run(['worktree', 'remove', '--force', dir]);
  if (existsSync(dir)) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* reported by the caller through info.removed */ } }
  git.run(['worktree', 'prune']);
  return !existsSync(dir);
}

// Check out exactly `tree` (a dangling commit made for it, never a ref) in <root>/<tree>, run fn(dir), and always remove the checkout again,
// whatever fn returned or threw. `info.removed` says whether the folder is gone afterwards.
export async function withTreeCheckout(git, { tree, root, info = {} }, fn) {
  const base = checkRoot(root);
  mkdirSync(base, { recursive: true });
  const dir = `${base}/${tree}`;
  if (existsSync(dir)) removeCheckout(git, dir);            // a leftover of a crashed run
  const commit = git.out(['commit-tree', tree, '-m', 'omnikom ci'], { extraEnv: IDENT });
  const add = git.run(['worktree', 'add', '--detach', dir, commit], { timeout: 600000 });
  if (!add.ok) { removeCheckout(git, dir); throw new Error(`could not check out tree ${tree} in ${dir}: ${(add.err || '').split('\n')[0].slice(0, 200)}`); }
  let value;
  try { value = await fn(dir); return value; }
  finally { info.removed = removeCheckout(git, dir); }
}
