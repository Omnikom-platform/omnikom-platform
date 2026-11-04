// land <branch> [--remote <name>] [--wait-minutes <n>] [--json]   (DECISIONS 45)
// Moves master to the commit of a check branch, and only when GitHub's ci run of the PUBLIC COPY of that exact commit had every ci.yml job green
// (DECISIONS 46: the private org repo has no Actions minutes; the copy under the owner's account is code only, lib/copy.mjs):
//   1. <branch> is check/<department>/<slug> (the department is a charter in docs/departments/, read at run time, or a prefix of one that
//      ends at a '-' and names only that charter: cli -> cli-and-testing; the output says which charter it resolved to); its commit is what the
//      REMOTE holds (git ls-remote), fetched when it is not local;
//   2. the LAND LOCK (the landing queue): refs/heads/land-lock on the remote. Two heads must never both move master. The lock is a ROOT commit
//      (no parent) pushed with a plain `git push`: a root commit is never a fast-forward of another root, so git itself refuses a second
//      creator. A lock held by another is LAND-LOCKED (exit 1) naming who and since when; one whose committer date is more than 90 minutes
//      old is broken (deleted with a lease on that exact sha) and taken. It is released after the fast-forward and on EVERY refusal or
//      Blocked after it was taken, with a lease on OUR lock's sha, so a lock broken and taken by someone else is never deleted by us;
//   2b. the copy: the public repository's branch of the same name must stand for exactly this commit (its tip's TREE equals the expected copy
//      tree and its message names the private sha; else BLOCKED: run omnikom copy push); the verdict is read from the PUBLIC repo's run of the
//      copy commit, with the job names of the copy's ci.yml; jobs in jobsNotOnCopy are listed as not run there;
//   2c. jobs in jobsNotOnCopy (they need files the copy never holds) run on the LAPTOP for the exact private sha, through heavy.mjs
//      (omnikom ci --commit <sha> --job <id>), after the copy's run is green and before master is touched; any failure is LAND-REFUSED naming
//      the job (DECISIONS 47). The report says "<job>: laptop, not GitHub (DECISIONS 47): PASS|FAIL";
//   3. wait for the ci run (every 30 s; no run at all for more than 5 minutes is Blocked: was it pushed?; still running after
//      --wait-minutes, default 60, is Blocked naming the run);
//   4. any red job: refused (exit 1, LAND-REFUSED), nothing is pushed;
//   5. green: master must fast-forward to the commit (land never rebases, merges or forces); `git push <remote> <sha>:refs/heads/master`,
//      no --force and no --no-verify (the installed pre-push hook checks the run again, on purpose). --force-with-lease is used ONLY for
//      the lock delete (and, in lib/copy.mjs, for the replacement of the PUBLIC master by the copy of the new private master).
// land never touches this checkout's working tree, its index or its refs/heads/master: heads share one checkout and master may be checked
// out with other heads' unfinished files. It says in its output whether the local master contains the commit. All dates come from ctx.now.
import { existsSync, readdirSync } from 'node:fs';
import { hostname, homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Usage, Blocked } from '../lib/errors.mjs';
import { result } from '../lib/ctx.mjs';
import { makeGit } from '../lib/git.mjs';
import { redact } from '../lib/redact.mjs';
import { ciVerdict, jobNamesAt } from '../lib/ghrun.mjs';
import { mapToPublic, publishCopy } from '../lib/copy.mjs';
import { CLI_DIR } from '../lib/repo.mjs';
import { LOCK_BRANCH, LOCK_REF, STALE_LOCK_MINUTES } from '../lib/landlock.mjs';

export const DEFAULT_REMOTE = 'backup-gh';               // DECISIONS 24
export const POLL_MS = 30000;
const HEAVY_REFUSED = 75, HEAVY_RETRIES = 2, HEAVY_RETRY_MS = 5000;
export const NONE_LIMIT_MS = 5 * 60000;
export const DEFAULT_WAIT_MINUTES = 60;
export { LOCK_BRANCH, LOCK_REF, STALE_LOCK_MINUTES };

const BRANCH = /^check\/([^/]+)\/([a-z0-9][a-z0-9._-]*)$/;
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const IDENT = { GIT_AUTHOR_NAME: 'omnikom', GIT_AUTHOR_EMAIL: 'omnikom@localhost', GIT_COMMITTER_NAME: 'omnikom', GIT_COMMITTER_EMAIL: 'omnikom@localhost' };

// The charter a <department> names: the basename itself, or a prefix of one that ends at a '-' boundary (platform -> platform-build,
// cli -> cli-and-testing). An exact basename wins over longer names it prefixes. No match, or two or more prefix matches, is Usage.
export function charterOf(dept, departments) {
  if (departments.includes(dept)) return dept;
  const hits = departments.filter(d => d.startsWith(`${dept}-`));
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) throw new Usage(`'${dept}' is not a department (charters in docs/departments/: ${departments.join(', ') || 'none found'})`);
  throw new Usage(`'${dept}' matches more than one charter (${hits.join(', ')}); use a longer name`);
}

// the basenames of the charters in docs/departments/, except README and TEMPLATE
export function departmentsOf(repo) {
  const dir = join(repo, 'docs', 'departments');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.md') && !['README.md', 'TEMPLATE.md'].includes(f)).map(f => f.slice(0, -3)).sort();
}

// the sha git ls-remote printed for exactly that ref ('' when it printed none)
const refOf = (out, ref) => { for (const l of String(out).split('\n')) { const [sha, name] = l.trim().split(/\s+/); if (name === ref) return sha; } return ''; };
const firstLine = s => String(s || '').split('\n')[0].slice(0, 200);
const iso = secs => new Date(secs * 1000).toISOString();

// ------------------------------------------------------------------------------------------------ jobs that run on the laptop (DECISIONS 47)
// One jobsNotOnCopy job, for the exact private commit, through heavy.mjs (one heavy job at a time on this machine). -> { ok, tail }. A test hands
// ctx.laptop instead. heavy.mjs lives in the user's .claude folder; without it the land is Blocked (a check that runs nowhere proves nothing).
export function defaultLaptop(ctx, { job, sha }) {
  const heavy = join(homedir(), '.claude', 'scripts', 'heavy.mjs');
  if (!existsSync(heavy)) throw new Blocked(`${heavy} not found, so the laptop job ${job} cannot be run`, 'install the heavy-job gate, or ask the head of operations');
  const r = spawnSync(process.execPath, [heavy, '--wait-min', '120', '--label', `land ${job} ${sha.slice(0, 8)}`, '--', process.execPath, join(CLI_DIR, 'omnikom.mjs'), 'ci', '--commit', sha, '--job', job],
    { cwd: ctx.repo, encoding: 'utf8', timeout: 4 * 3600000, maxBuffer: 1 << 28, windowsHide: true, env: { ...process.env, OMNIKOM_REPO_ROOT: ctx.repo } });
  const tail = `${r.stdout || ''}${r.stderr || ''}`.split('\n').map(l => l.trim()).filter(Boolean).slice(-6);
  // exit 75 is heavy.mjs refusing to start the job (EX_TEMPFAIL, e.g. "cannot read this process's creation time"): not the job's verdict
  return { ok: !r.error && r.status === 0, blocked: !r.error && r.status === HEAVY_REFUSED, tail: r.error ? [String(r.error.message)] : tail };
}

// One laptop job with the heavy.mjs refusal retried: a refusal (blocked) is retried up to HEAVY_RETRIES more times, HEAVY_RETRY_MS apart; still
// refused -> Blocked (not LAND-REFUSED: the job never ran), with heavy's own line in the detail. A real failure is returned at once, never retried.
async function runLaptopJob(ctx, job, sha) {
  let run;
  for (let attempt = 0; attempt <= HEAVY_RETRIES; attempt++) {
    if (attempt > 0) await ctx.sleep(HEAVY_RETRY_MS);
    run = await (ctx.laptop || defaultLaptop)(ctx, { job, sha });
    if (!run.blocked) return run;
  }
  const why = (run.tail || []).filter(l => /^heavy:/.test(l)).pop() || (run.tail || []).slice(-1)[0] || 'heavy.mjs exited 75';
  throw new Blocked(`heavy.mjs refused to start the laptop job ${job} ${HEAVY_RETRIES + 1} times (exit 75): ${firstLine(why)}`, 'run omnikom land again; nothing was pushed');
}

// ------------------------------------------------------------------------------------------------ the land lock
const leaseDelete = (git, remote, lockSha) => git.run(['push', `--force-with-lease=${LOCK_REF}:${lockSha}`, remote, `:${LOCK_REF}`], { timeout: 180000 });

// who holds the lock the remote has now: { sha, holder, branch, since, minutes } (sha '' when there is none)
function readLock(ctx, git, remote) {
  const ls = git.run(['ls-remote', remote, LOCK_REF], { timeout: 180000 });
  if (!ls.ok) throw new Blocked(`could not read the land lock on ${remote}: ${firstLine(ls.err || `exit ${ls.status}`)}`, 'check the network and the remote');
  const sha = refOf(ls.out, LOCK_REF);
  if (!SHA.test(sha || '')) return { sha: '' };
  const fe = git.run(['fetch', remote, LOCK_REF], { timeout: 180000 });
  const info = fe.ok ? git.run(['log', '-1', '--format=%ct%n%B', sha]) : { ok: false };
  if (!info.ok) throw new Blocked(`the land lock ${sha} on ${remote} could not be read (${firstLine(fe.err)})`, 'check the network and the remote');
  const [ct, ...msg] = info.out.split('\n');
  const m = /^land-lock: (\S+) (\S+) by (.+) at (\S+)\s*$/.exec(msg.join('\n').trim());
  const since = Number(ct);
  return { sha, holder: m ? m[3] : 'an unknown holder', branch: m ? m[1] : 'an unknown branch', since, seconds: ctx.now() - since, minutes: Math.floor((ctx.now() - since) / 60) };
}

// Take the lock, or say who has it. -> { sha } (ours), or { refused: result }
function takeLock(ctx, git, remote, { branch, sha, department }, lines) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const empty = git.run(['hash-object', '-t', 'tree', '-w', '--stdin'], { input: '' });
    if (!empty.ok) throw new Blocked(`could not build the land lock: ${firstLine(empty.err)}`, 'check the repository');
    const user = git.run(['config', 'user.name']);
    const message = `land-lock: ${branch} ${sha} by ${department} (${(user.ok && user.out) || 'unknown'}@${(ctx.hostname || hostname)()}) at ${iso(ctx.now())}`;
    const date = `${ctx.now()} +0000`;
    const made = git.run(['commit-tree', empty.out, '-m', message], { extraEnv: { ...IDENT, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
    if (!made.ok) throw new Blocked(`could not build the land lock: ${firstLine(made.err)}`, 'check the repository');
    const push = git.run(['push', remote, `${made.out}:${LOCK_REF}`], { timeout: 180000 });
    if (push.ok) { lines.push(`land: took the land lock ${made.out}`); return { sha: made.out }; }
    const held = readLock(ctx, git, remote);
    if (!held.sha) throw new Blocked(`could not take the land lock on ${remote}: ${firstLine(push.err || `exit ${push.status}`)}`, 'check the network and the remote');
    const since = iso(held.since);
    if (held.seconds > STALE_LOCK_MINUTES * 60 && attempt === 0) {
      lines.push(`land: breaking a stale land lock held by ${held.holder} since ${since} (${held.minutes} min)`);
      const del = leaseDelete(git, remote, held.sha);
      if (!del.ok) lines.push(`land: the stale lock could not be deleted (${firstLine(del.err)}); somebody else may have broken it first`);
      continue;
    }
    lines.push(`land: ${held.holder} holds the land lock since ${since} (${held.minutes} min) for ${held.branch}`);
    return { refused: result(false, 'LAND-LOCKED', { branch, department, sha, remote, state: 'locked', pushed: false, lines, holder: held.holder, lockSince: since, lockMinutes: held.minutes }) };
  }
  throw new Blocked(`could not take the land lock on ${remote} after breaking a stale one`, 'run land again');
}

// delete OUR lock (a lease on its sha: a lock broken and taken by somebody else is never deleted by us)
function releaseLock(git, remote, lockSha) {
  const del = leaseDelete(git, remote, lockSha);
  if (del.ok) return { line: 'land: lock released' };
  return { line: `land: WARNING the land lock was not released (${firstLine(del.err || `exit ${del.status}`)}); if it is still yours, release it by hand: git push --force-with-lease=${LOCK_REF}:${lockSha} ${remote} :${LOCK_REF}` };
}

// ------------------------------------------------------------------------------------------------ the command
export async function land(ctx) {
  const f = ctx.flags;
  if (ctx.positionals.length !== 2) throw new Usage('land takes exactly one branch: land check/<department>/<slug> [--remote <name>] [--wait-minutes <n>]');
  if (f.target !== undefined || f.expect !== undefined) throw new Usage('land takes no --target and no --expect: a verdict that can be told to match a failure is not a gate');
  const branch = ctx.positionals[1];
  const m = BRANCH.exec(branch);
  if (!m || m[2].includes('..') || m[2].endsWith('.') || m[2].endsWith('.lock')) throw new Usage(`'${branch}' is not check/<department>/<slug> (the slug is lower-case letters, digits, '.', '_' and '-', starting with a letter or digit)`);
  const departments = departmentsOf(ctx.repo);
  const charter = charterOf(m[1], departments);
  const remote = f.remote === undefined ? DEFAULT_REMOTE : String(f.remote);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) throw new Usage(`--remote '${remote}' is not a remote name`);
  let waitMinutes = DEFAULT_WAIT_MINUTES;
  if (f['wait-minutes'] !== undefined) {
    waitMinutes = Number(f['wait-minutes']);
    if (!(waitMinutes > 0) || waitMinutes > 600) throw new Usage('--wait-minutes must be a number between 0 and 600');
  }
  const git = makeGit(ctx.repo, ctx.gitSpy);
  if (!git.run(['rev-parse', '--git-dir']).ok) throw new Usage(`${ctx.repo} is not a git repository`);
  const url = git.run(['remote', 'get-url', remote]);
  if (!url.ok) throw new Usage(`no remote named '${remote}' in ${ctx.repo}`);

  // the commit the REMOTE holds for the branch
  const ls = git.run(['ls-remote', remote, `refs/heads/${branch}`], { timeout: 180000 });
  if (!ls.ok) throw new Blocked(`could not read ${remote}: ${firstLine(ls.err || `exit ${ls.status}`)}`, 'check the network and the remote');
  const sha = refOf(ls.out, `refs/heads/${branch}`);
  if (!SHA.test(sha || '')) throw new Usage(`no branch ${branch} on ${remote}; push the commit there first: git push ${remote} <sha>:refs/heads/${branch}`);
  if (!git.run(['cat-file', '-e', `${sha}^{commit}`]).ok) {
    const fe = git.run(['fetch', remote, branch], { timeout: 600000 });
    if (!fe.ok || !git.run(['cat-file', '-e', `${sha}^{commit}`]).ok) throw new Blocked(`could not fetch ${branch} from ${remote}: ${firstLine(fe.err || 'the commit is still missing')}`, 'check the network and the remote');
  }

  // the copy: the public branch of the same name must stand for exactly this commit (Blocked otherwise), before the queue is entered
  const mapped = mapToPublic(ctx, git, { sha, branch });
  const lines = [`land: department ${m[1]} is the charter ${charter}`, `land: ${branch} is ${sha} on ${remote}`, `land: the copy of ${sha} is ${mapped.copySha} on the public repository ${mapped.repo}`];
  for (const [job, why] of Object.entries(mapped.expected.rules.jobsNotOnCopy)) lines.push(`not run on the copy (DECISIONS 46): ${job}: ${why.reason}`);
  // the queue: the lock first, before the ci wait
  const lock = takeLock(ctx, git, remote, { branch, sha, department: charter }, lines);
  if (lock.refused) return lock.refused;
  let res;
  try {
    res = await landLocked(ctx, git, { branch, department: m[1], charter, sha, remote, mapped, waitMinutes, lines });
  } catch (e) {
    // every Blocked (or crash) after the lock was taken releases it
    const rel = releaseLock(git, remote, lock.sha);
    if (e && typeof e.message === 'string' && rel.line.includes('WARNING')) e.message += ` (${rel.line})`;
    throw e;
  }
  // after the fast-forward and after every refusal: release; a failed release never turns a successful land into a failure
  const rel = releaseLock(git, remote, lock.sha);
  res.data.lines.push(rel.line);
  res.data.lockReleased = !rel.line.includes('WARNING');
  return res;
}

// everything after the lock: the ci wait, the verdict, the fast-forward of master
async function landLocked(ctx, git, { branch, department, charter, sha, remote, mapped, waitMinutes, lines }) {
  const repo = mapped.repo, copySha = mapped.copySha;
  const jobNames = jobNamesAt(git, copySha);

  // wait for the ci run
  const waitMs = waitMinutes * 60000;
  let elapsed = 0, noneMs = 0, last = '', v;
  for (;;) {
    v = await ciVerdict(ctx, { repo, sha: copySha, jobNames });
    if (v.state !== last) { last = v.state; lines.push(`land: ci ${v.state}${v.state === 'green' ? '' : `: ${v.lines[0]}`}`); }
    if (v.state === 'green' || v.state === 'red') break;
    if (v.state === 'none' && noneMs > NONE_LIMIT_MS) throw new Blocked(`no ci run for the copy ${copySha} on ${repo}; was it pushed?`, `run: node tools/omnikom-cli/omnikom.mjs copy push ${branch}, then run land again`);
    if (elapsed >= waitMs) throw new Blocked(`ci for the copy ${copySha} is still ${v.state} after ${waitMinutes} minutes: ${v.lines[0]}`, 'run land again when the run has finished');
    await ctx.sleep(POLL_MS);
    elapsed += POLL_MS;
    noneMs = v.state === 'none' ? noneMs + POLL_MS : 0;
  }
  const data = { branch, department, charter, sha, remote, copySha, copyRepo: repo, state: v.state, pushed: false, lines };

  // red: refused, nothing pushed
  if (v.state === 'red') {
    lines.push(...v.lines);
    lines.push(`land: REFUSED ${branch}: ci is red on the copy ${copySha} of ${sha}; master is not touched`);
    return result(false, 'LAND-REFUSED', data);
  }
  lines.push(v.lines[0], `land: verdict from ${repo} run ${v.runs.map(r => r.id).join(', ')} of copy ${copySha}`);

  // the jobs that cannot run on the copy run here, for the exact commit, before master is touched (DECISIONS 47)
  for (const job of Object.keys(mapped.expected.rules.jobsNotOnCopy)) {
    const run = await runLaptopJob(ctx, job, sha);
    lines.push(`${job}: laptop, not GitHub (DECISIONS 47): ${run.ok ? 'PASS' : 'FAIL'}`);
    if (!run.ok) {
      lines.push(...(run.tail || []).map(l => `  ${l}`), `land: REFUSED ${branch}: the laptop job ${job} failed on ${sha} (DECISIONS 47); master is not touched`);
      return result(false, 'LAND-REFUSED', data);
    }
  }

  // green: fast-forward master only
  const fm = git.run(['fetch', remote, 'master'], { timeout: 600000 });
  if (!fm.ok) throw new Blocked(`could not fetch master from ${remote}: ${firstLine(fm.err || `exit ${fm.status}`)}`, 'check the network and the remote');
  const lm = git.run(['ls-remote', remote, 'refs/heads/master'], { timeout: 180000 });
  if (!lm.ok) throw new Blocked(`could not read master of ${remote}: ${firstLine(lm.err || `exit ${lm.status}`)}`, 'check the network and the remote');
  const master = refOf(lm.out, 'refs/heads/master');
  const hasMaster = SHA.test(master || '');
  data.master = hasMaster ? master : null;
  const localNote = () => {
    const lo = git.run(['rev-parse', '--verify', '--quiet', 'refs/heads/master']);
    if (!lo.ok) return 'land: this checkout has no local master; it was not touched';
    return git.run(['merge-base', '--is-ancestor', sha, lo.out]).ok
      ? `land: the local master of this checkout contains ${sha}`
      : `land: the local master of this checkout does not contain ${sha}; land does not touch it (fast-forward it yourself in a clean checkout)`;
  };
  if (hasMaster && git.run(['merge-base', '--is-ancestor', sha, master]).ok) {
    lines.push(`land: ${sha} is already in master`, localNote());
    return result(true, 'ok', data);
  }
  if (hasMaster && !git.run(['merge-base', '--is-ancestor', master, sha]).ok) {
    lines.push(`land: REFUSED ${branch}: not a fast-forward: rebase ${branch} onto master and push it again`);
    return result(false, 'LAND-REFUSED', data);
  }
  const push = git.run(['push', remote, `${sha}:refs/heads/master`], { timeout: 600000 });
  const said = `${push.err}\n${push.out}`.split('\n').map(l => l.trim()).filter(Boolean).slice(-40);
  lines.push(...said.map(l => `git: ${l}`));
  if (!push.ok) {
    lines.push(`land: the push of ${sha} to master of ${remote} failed (exit ${push.status}); master is not moved`);
    return result(false, 'LAND-PUSH-FAILED', data);
  }
  data.pushed = true;
  lines.push(`land: master is ${sha}`, localNote());
  // the public master is the copy of the private master (DECISIONS 46). The private master has moved: a failure here is reported, not a failed land
  try {
    const pub = await publishCopy(ctx, git, { sha, branch: 'master' });
    data.copyMaster = pub.ok ? 'pushed' : 'refused';
    lines.push(...pub.lines.map(l => `land: ${l}`));
  } catch (e) {
    data.copyMaster = 'failed';
    lines.push(`land: WARNING the public master was not updated to the copy of ${sha}: ${firstLine(e && e.message)}; run it again by hand: node tools/omnikom-cli/omnikom.mjs copy push master`);
  }
  return result(true, 'ok', data);
}

export function landText(obj, env) {
  const d = obj.data;
  if (obj.error || !d) return redact(`ERROR ${obj.error || obj.code}`, env) + '\n' + (obj.unblock ? redact(`  to unblock: ${obj.unblock}`, env) + '\n' : '');
  return d.lines.map(l => redact(l, env)).join('\n') + '\n';
}
