// copy build <sha|ref> [--dry-run] | copy push check/<department>/<slug> [--remote <name>]   (DECISIONS 46)
//   build   the copy of a private commit and the gate over it, in this repository's object store only: nothing is pushed, nothing leaves
//           the machine (--dry-run says so out loud; the two do the same). Prints the copy commit, the file and dropped counts, the gate result.
//   push    reads the private branch's sha from the private remote (as `land` does), builds and gates the copy, and pushes it to the SAME
//           branch name of the public repository (lib/copy.mjs pushCopy), then prints the public run url once GitHub lists it.
// Exit: 0 built / pushed, 1 the gate refused (COPY-REFUSED), 2 usage, 3 blocked.
import { Usage, Blocked } from '../lib/errors.mjs';
import { result } from '../lib/ctx.mjs';
import { makeGit } from '../lib/git.mjs';
import { redact } from '../lib/redact.mjs';
import { buildCopy, publishCopy, publicRepoOf, loadRules, clientNames, pathMasker } from '../lib/copy.mjs';

const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const BRANCH = /^check\/([^/]+)\/([a-z0-9][a-z0-9._-]*)$/;
const DEFAULT_REMOTE = 'backup-gh';   // DECISIONS 24 (the same default as land)
const firstLine = s => String(s || '').split('\n')[0].slice(0, 200);

async function build(ctx, git) {
  if (ctx.positionals.length !== 3) throw new Usage('copy build takes one commit: copy build <sha|ref> [--dry-run]');
  const rulesFile = ctx.flags.rules === undefined ? undefined : String(ctx.flags.rules);
  if (rulesFile && !ctx.flags['dry-run']) throw new Usage('--rules (rules not committed yet) is for --dry-run only');
  const { built, commit, gate } = await buildCopy(ctx, git, ctx.positionals[2], rulesFile);
  const data = { privateSha: built.sha, privateTree: built.privateTree, copySha: commit, copyTree: built.tree, rulesSha256: built.rulesSha, files: built.files, dropped: built.dropped.length, droppedPaths: built.dropped.map(pathMasker(clientNames(git, built.sha))), transformed: built.transformed, clients: gate.clients, gate: gate.ok ? 'pass' : 'refused', problems: gate.problems, pushed: false, dryRun: Boolean(ctx.flags['dry-run']) };
  const lines = [
    `copy: ${built.sha} -> ${commit} (${built.files} files, ${built.dropped.length} dropped, ${built.transformed.length} transformed)`,
    `copy: tree ${built.tree}; rules sha256 ${built.rulesSha.slice(0, 16)}...; ${gate.clients} client folder(s) checked by name`,
    `copy: nothing was pushed${ctx.flags['dry-run'] ? ' (--dry-run)' : ''}; the commit exists only in this repository's object store`,
  ];
  if (gate.ok) { lines.push('copy: gate PASS'); return result(true, 'ok', { ...data, lines }); }
  lines.push(`copy: gate REFUSED: ${gate.problems.length} problem(s)`, ...gate.problems.map(p => `copy: ${p}`));
  return result(false, 'COPY-REFUSED', { ...data, lines });
}

async function push(ctx, git) {
  const f = ctx.flags;
  if (ctx.positionals.length !== 3) throw new Usage('copy push takes one branch: copy push check/<department>/<slug> [--remote <name>]');
  const branch = ctx.positionals[2];
  if (!BRANCH.test(branch)) throw new Usage(`'${branch}' is not check/<department>/<slug>`);
  const remote = f.remote === undefined ? DEFAULT_REMOTE : String(f.remote);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) throw new Usage(`--remote '${remote}' is not a remote name`);
  if (!git.run(['remote', 'get-url', remote]).ok) throw new Usage(`no remote named '${remote}' in ${ctx.repo}`);
  const ref = `refs/heads/${branch}`;
  const ls = git.run(['ls-remote', remote, ref], { timeout: 180000 });
  if (!ls.ok) throw new Blocked(`could not read ${remote}: ${firstLine(ls.err || `exit ${ls.status}`)}`, 'check the network and the remote');
  const sha = (ls.out.split('\n').map(l => l.trim().split(/\s+/)).find(p => p[1] === ref) || [])[0] || '';
  if (!SHA.test(sha)) throw new Usage(`no branch ${branch} on ${remote}; push the commit there first: git push ${remote} <sha>:${ref}`);
  if (!git.run(['cat-file', '-e', `${sha}^{commit}`]).ok) {
    const fe = git.run(['fetch', remote, branch], { timeout: 600000 });
    if (!fe.ok || !git.run(['cat-file', '-e', `${sha}^{commit}`]).ok) throw new Blocked(`could not fetch ${branch} from ${remote}: ${firstLine(fe.err || 'the commit is still missing')}`, 'check the network and the remote');
  }
  const lines = [`copy: ${branch} is ${sha} on ${remote}`];
  const res = await publishCopy(ctx, git, { sha, branch });
  lines.push(...res.lines);
  if (!res.ok) return result(false, res.code, { ...res.data, lines });
  // the public run, once GitHub lists it (a few tries; a missing run is not a failure of the push)
  const repo = publicRepoOf(ctx, loadRules(git, sha).rules);
  let runUrl = '';
  for (let i = 0; i < 6 && !runUrl; i++) {
    const r = await ctx.gh(['run', 'list', '--repo', repo, '--commit', res.data.copySha, '--workflow', 'ci.yml', '--json', 'url,headSha', '--limit', '5']);
    if (r && r.ok) { try { const hit = JSON.parse(r.out).find(x => String(x.headSha).toLowerCase() === res.data.copySha); if (hit) runUrl = hit.url; } catch { /* asked again */ } }
    if (!runUrl && i < 5) await ctx.sleep(5000);
  }
  lines.push(runUrl ? `copy: public run ${runUrl}` : `copy: GitHub lists no ci run for ${res.data.copySha} yet; check: gh run list --repo ${repo} --commit ${res.data.copySha}`);
  return result(true, 'ok', { ...res.data, runUrl, lines });
}

export async function copyGroup(ctx) {
  const verb = ctx.positionals[1];
  if (!['build', 'push'].includes(verb)) throw new Usage('copy needs one of: build | push');
  if (ctx.flags.target !== undefined || ctx.flags.expect !== undefined) throw new Usage('copy takes no --target and no --expect');
  const git = makeGit(ctx.repo, ctx.gitSpy);
  if (!git.run(['rev-parse', '--git-dir']).ok) throw new Usage(`${ctx.repo} is not a git repository`);
  return verb === 'build' ? build(ctx, git) : push(ctx, git);
}

export function copyText(obj, env) {
  const d = obj.data;
  if (obj.error || !d) return redact(`ERROR ${obj.error || obj.code}`, env) + '\n' + (obj.unblock ? redact(`  to unblock: ${obj.unblock}`, env) + '\n' : '');
  return d.lines.map(l => redact(l, env)).join('\n') + '\n';
}
