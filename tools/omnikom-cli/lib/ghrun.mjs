// The verdict of ONE commit on GitHub (DECISIONS 45): the evidence that a tree passed is the ci run GitHub made for exactly that commit, read
// with `gh`. There is no local stamp. The pre-push hook (commands/hooks.mjs) and `omnikom land` (commands/land.mjs) both ask this module and
// fail CLOSED: a `gh` that is missing, not logged in or offline is Blocked, never "no problem".
//   ciVerdict(ctx, { repo, sha, jobNames }) -> { state: 'green' | 'red' | 'pending' | 'none', runs, lines }
// `jobNames` is the `name:` of every job of ci.yml AT THAT COMMIT (jobNamesAt); a run that lacks one of them is not green, so a job added to
// ci.yml cannot be skipped by an old run. ctx.gh(args) -> { ok, out, err } is the one place `gh` is spawned; tests hand a fake.
import { spawnSync } from 'node:child_process';
import { Blocked } from './errors.mjs';
import { parseJobs } from './graph.mjs';

const WITHOUT_USER = url => String(url).replace(/\/\/[^@/\s]*@/, '//');
const OWNER = '[A-Za-z0-9](?:[A-Za-z0-9-]*)';
const NAME = '[A-Za-z0-9._-]+';
const URL_FORMS = [
  new RegExp(`^https://(?:[^@/\\s]+@)?github\\.com/(${OWNER})/(${NAME}?)(?:\\.git)?/?$`),
  new RegExp(`^(?:ssh://)?git@github\\.com[:/](${OWNER})/(${NAME}?)(?:\\.git)?/?$`),
];

// owner/name from a github.com remote url (https or ssh form, with or without .git); anything else is Blocked, naming the url
export function repoFromUrl(url) {
  const u = String(url || '').trim();
  for (const re of URL_FORMS) { const m = re.exec(u); if (m) return `${m[1]}/${m[2]}`; }
  throw new Blocked(`the remote url ${WITHOUT_USER(u) || '(none)'} is not a github.com repository, so its ci runs cannot be read`, 'push to the github.com remote (backup-gh)');
}

// gh, run for real (a test replaces it through ctx.gh). Never throws.
export function defaultGh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 1 << 26, windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' } });
  if (r.error) return { ok: false, out: '', err: r.error.code === 'ENOENT' ? 'gh is not installed (not found on PATH)' : String(r.error.message) };
  return { ok: r.status === 0, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() };
}

// the `name:` of every job of .github/workflows/ci.yml at that commit; a commit with no ci.yml is Blocked
export function jobNamesAt(git, sha) {
  const r = git.run(['show', `${sha}:.github/workflows/ci.yml`]);
  if (!r.ok) throw new Blocked(`${sha} has no .github/workflows/ci.yml, so there is no ci run to wait for`, 'push a commit that holds the workflow');
  const jobs = parseJobs(r.out);
  if (jobs.length === 0) throw new Blocked(`.github/workflows/ci.yml at ${sha} has no jobs`, 'check the workflow file');
  return jobs.map(j => j.name);
}

// When EVERY failed job has zero steps, GitHub never started them (the Actions minutes or the spending limit, as on 2026-11-01 ~10:00): one
// extra line says so, with the first annotation message of one failed job when `gh api` gives one. Information only: the verdict stays red,
// and a gh call that fails here never turns into a Blocked. Jobs whose step list is unknown (steps null) are never read as "no step".
async function noStepNote(gh, repo, runs) {
  const failed = runs.flatMap(r => r.jobs).filter(j => j.conclusion !== 'success');
  if (failed.length === 0 || !failed.every(j => j.steps === 0)) return '';
  const fallback = 'ci: no job ran a step (GitHub did not start them; check the Actions minutes and billing)';
  const id = failed.find(j => Number.isInteger(j.id));
  if (!id) return fallback;
  let msg = '';
  try {
    const r = await gh(['api', `repos/${repo}/check-runs/${id.id}/annotations`]);
    const list = r && r.ok ? JSON.parse(r.out) : [];
    msg = Array.isArray(list) && list[0] ? String(list[0].message || '').split('\n')[0].trim().slice(0, 200) : '';
  } catch { msg = ''; }
  return msg ? `ci: no job ran a step; GitHub says: ${msg}` : fallback;
}

export async function ciVerdict(ctx, { repo, sha, jobNames }) {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(String(repo))) throw new Blocked(`'${repo}' is not an owner/name repository`, 'the remote must be a github.com repository');
  const gh = ctx.gh;
  const ask = async args => {
    const r = await gh(args);
    if (!r || !r.ok) throw new Blocked(`gh ${args.slice(0, 2).join(' ')} failed: ${String((r && (r.err || r.out)) || 'no answer').split('\n')[0].slice(0, 200)}`, 'install gh and run gh auth login, or check the network; a push to master and omnikom land fail closed without it');
    try { return JSON.parse(r.out); } catch { throw new Blocked(`gh ${args.slice(0, 2).join(' ')} did not answer JSON`, 'update gh'); }
  };
  const listed = await ask(['run', 'list', '--repo', repo, '--commit', sha, '--workflow', 'ci.yml', '--json', 'databaseId,status,conclusion,headSha,event,url,createdAt', '--limit', '50']);
  if (!Array.isArray(listed)) throw new Blocked('gh run list did not answer a list', 'update gh');
  // the filter alone is never trusted: the run must be of exactly this commit; a cancelled run is a superseded one (ci.yml cancels in progress)
  const kept = listed.filter(r => String(r.headSha).toLowerCase() === String(sha).toLowerCase() && r.conclusion !== 'cancelled');
  const runs = kept.map(r => ({ id: r.databaseId, url: r.url, status: r.status, conclusion: r.conclusion || '', jobs: [] }));
  if (runs.length === 0) return { state: 'none', runs, lines: [`no ci run for ${sha}`] };
  const waiting = runs.filter(r => r.status !== 'completed');
  if (waiting.length) return { state: 'pending', runs, lines: waiting.map(r => `${r.url}  ci run ${r.status}`) };

  const bad = [];
  let jobCount = 0;
  const badRuns = new Set();
  for (const run of runs) {
    const view = await ask(['run', 'view', String(run.id), '--repo', repo, '--json', 'jobs']);
    run.jobs = Array.isArray(view && view.jobs) ? view.jobs.map(j => ({ name: j.name, status: j.status, conclusion: j.conclusion || '', id: j.databaseId, steps: Array.isArray(j.steps) ? j.steps.length : null })) : [];
    jobCount += run.jobs.length;
    if (run.conclusion !== 'success') { bad.push(`${run.url}  (run)  ${run.conclusion || run.status}`); badRuns.add(run.id); }
    for (const j of run.jobs) if (j.conclusion !== 'success') { bad.push(`${run.url}  ${j.name}  ${j.conclusion || j.status}`); badRuns.add(run.id); }
    for (const name of jobNames) if (!run.jobs.some(j => j.name === name)) { bad.push(`${run.url}  ${name}  missing`); badRuns.add(run.id); }
  }
  // a failure on this commit is a signal even when another run of it passed; a flake is fixed by re-running that job on GitHub
  if (badRuns.size > 0) {
    const note = await noStepNote(gh, repo, runs);
    return { state: 'red', runs, lines: note ? [...bad, note] : bad };
  }
  return { state: 'green', runs, lines: [`ci green: ${sha} run ${runs.map(r => r.id).join(', ')}, ${jobCount} of ${jobCount} jobs success`] };
}
