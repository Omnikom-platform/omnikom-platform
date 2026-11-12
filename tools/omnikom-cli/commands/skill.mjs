// skill check pewp                      is the machine's copy of the SEO skill a junction to THIS repository's copy, with no change in it, at backup-gh/master?
// The skill lives in the repository (skills/programmatic-enterprise-web-performance); the skills folder of the machine holds a junction to the main checkout's copy, so
// there is one copy and a session that edits the skill edits the repository. This check reads the three things that make that true and never fixes any of them:
//   the entry is a junction (not a second real folder), it points to the main checkout's copy, the main checkout has no change in that folder (an edit came through
//   the junction, nobody committed it), and the main checkout is at backup-gh/master (a stale checkout serves an old skill). No fetch: backup-gh/master is the ref as it stands.
// The main checkout is found from any worktree of the repository (mainCheckoutOf), so a builder's worktree asks about the same junction. Exit 0 when no problem, 1 with
// one sentence per problem, 2 usage (anything but `skill check pewp` and --json); a checkout git cannot read is BLOCKED (exit 3). Nothing here prints.
// seo run and seo resume call skillCheck first (commands/seo.mjs); a test hands them its own through deps.seo.skillCheck, so no test reads the real skills folder.
import { lstatSync, realpathSync as fsRealpath } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Usage, Blocked } from '../lib/errors.mjs';
import { result } from '../lib/ctx.mjs';
import { makeGit } from '../lib/git.mjs';
import { commonDirOf } from '../lib/checkout.mjs';

export const PEWP = 'programmatic-enterprise-web-performance';

// the native form: the final path with the folder's real spelling, so one folder in two spellings (letter case, short names) is one folder
const realpathSync = p => fsRealpath.native(p);

// the main checkout of the repository that `repo` belongs to (`repo` may be a worktree of it)
export const mainCheckoutOf = repo => dirname(commonDirOf(makeGit(repo)));

// -> { ok, problems, entry, target, head }; never prints; a checkout git cannot read is Blocked
export function skillCheck({ repo, skillsDir }) {
  let main;
  try { main = mainCheckoutOf(repo); } catch (e) { throw new Blocked(`cannot read the checkout ${repo}: ${e.message}`, 'run it in a checkout of the Omnikom repository'); }
  const target = join(main, 'skills', PEWP);
  const entry = join(skillsDir, PEWP);
  const problems = [];
  let st = null;
  try { st = lstatSync(entry); } catch { /* no entry: said just below */ }
  if (!st) problems.push(`no ${PEWP} entry in the skills folder (${entry})`);
  else if (!st.isSymbolicLink()) problems.push(`${entry} is a real folder, not a junction to ${target}`);
  else if (realpathSync(entry) !== realpathSync(target)) problems.push(`${entry} points to ${realpathSync(entry)}, not to ${target}`);
  const git = makeGit(main);
  const dirty = git.out(['status', '--porcelain', '--', `skills/${PEWP}`]).split('\n').filter(Boolean);
  if (dirty.length) problems.push(`the main checkout has changes in skills/${PEWP} (an edit came through the junction): ${dirty.slice(0, 5).join('; ')}`);
  const head = git.out(['rev-parse', 'HEAD']);
  const found = git.run(['rev-parse', '--verify', '--quiet', 'refs/remotes/backup-gh/master']);
  const tip = found.out;
  if (!found.ok) problems.push('the main checkout has no backup-gh/master');
  else if (head !== tip) problems.push(`the main checkout is at ${head.slice(0, 7)}, not at backup-gh/master ${tip.slice(0, 7)}: the junction serves an old skill`);
  return { ok: problems.length === 0, problems, entry, target, head };
}

export const skillGroup = async ctx => {
  const words = ctx.positionals.slice(1);
  const flags = Object.keys(ctx.flags).filter(k => k !== 'json');
  if (words.length !== 2 || words[0] !== 'check' || words[1] !== 'pewp' || flags.length) throw new Usage('skill takes: check pewp');
  const skillsDir = ctx.env.OMNIKOM_SKILLS_DIR || join(homedir(), '.claude', 'skills');
  const r = skillCheck({ repo: ctx.repo, skillsDir });
  return result(r.ok, r.ok ? 'ok' : 'SKILL-CHECK-FAILED', r);
};
