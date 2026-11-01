// A fake `gh` for the tests (DECISIONS 45): it answers `gh run list` and `gh run view <id> --json jobs` from planted JSON and never touches
// GitHub. getState() is read on every call, so a test (or a fake sleep) can change the answer between two polls:
//   { fail: 'text' }                 every call fails with that stderr (gh missing, not logged in, offline)
//   { runs: [ ...run list rows... ], jobs: { <run id>: [ { name, status, conclusion } ] } }
// The fake ignores `--commit` on purpose: ciVerdict must keep only the runs whose headSha is exactly the commit, whatever the filter did.
export function makeFakeGh(getState) {
  const calls = [];
  const gh = args => {
    calls.push(args);
    const s = getState();
    if (s.fail) return { ok: false, out: '', err: String(s.fail) };
    if (args[0] === 'run' && args[1] === 'list') return { ok: true, out: JSON.stringify(s.runs || []), err: '' };
    if (args[0] === 'run' && args[1] === 'view') return { ok: true, out: JSON.stringify({ jobs: (s.jobs || {})[Number(args[2])] || [] }), err: '' };
    // gh api repos/<repo>/check-runs/<job id>/annotations (the billing line): { annotations: { <job id>: [ { message } ] } }, or { annotationsFail: 'text' }
    const an = args[0] === 'api' && /^repos\/[^/]+\/[^/]+\/check-runs\/(\d+)\/annotations$/.exec(args[1] || '');
    if (an) {
      if (s.annotationsFail) return { ok: false, out: '', err: String(s.annotationsFail) };
      return { ok: true, out: JSON.stringify((s.annotations || {})[Number(an[1])] || []), err: '' };
    }
    return { ok: false, out: '', err: `fake gh: unexpected call ${args.join(' ')}` };
  };
  gh.calls = calls;
  return gh;
}

// one row of `gh run list`
export const runRow = (sha, o = {}) => ({
  databaseId: o.id || 1, status: o.status || 'completed', conclusion: 'conclusion' in o ? o.conclusion : 'success', headSha: sha, event: 'push',
  url: `https://github.com/o/r/actions/runs/${o.id || 1}`, createdAt: '2026-10-31T10:00:00Z',
});
// the jobs of one run; `over` maps a job name to its conclusion
export const jobRows = (names, over = {}) => names.map(name => ({ name, status: 'completed', conclusion: over[name] || 'success' }));
// the jobs as `gh run view --json jobs` gives them with databaseId and steps; `ran` maps a job name to how many steps it ran (default 2)
export const stepRows = (names, over = {}, ran = {}) => names.map((name, i) => ({
  databaseId: 100 + i, name, status: 'completed', conclusion: over[name] || 'success',
  steps: Array.from({ length: name in ran ? ran[name] : 2 }, (_, k) => ({ name: `step ${k + 1}`, status: 'completed', conclusion: 'success', number: k + 1 })),
}));
