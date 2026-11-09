// GitHub workflow_dispatch for the build runner (02-BACKEND section 7; work order 17, H0-5): POST /repos/<owner>/<repo>/actions/workflows/<file>.yml/dispatches
// { ref, inputs } with Authorization: Bearer <token>; GitHub answers 204. `inputs` are strings only (GitHub refuses other types). A dispatch that
// did not happen is REPORTED (dispatched: false and why), never hidden: the job stays queued and the reaper fails it after 24 hours (service.reap_stale_jobs).
// Environment, by name: GITHUB_REPO (owner/repo), GITHUB_DISPATCH_TOKEN (fine-grained, this repository only, Actions: write and nothing else),
// GITHUB_DISPATCH_REF (the branch the workflow file is read from, default master). GITHUB_API_BASE is for the tests' fake server
// (default https://api.github.com). The token is never printed and never part of an answer.
export type Dispatched = { dispatched: boolean; reason: string | null };

export async function dispatch(workflow: 'publish' | 'media', inputs: Record<string, string>, fetchImpl: typeof fetch = fetch): Promise<Dispatched> {
  const token = Deno.env.get('GITHUB_DISPATCH_TOKEN'), repo = Deno.env.get('GITHUB_REPO');
  if (!token) return { dispatched: false, reason: 'no dispatch token' };
  if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return { dispatched: false, reason: 'no repository configured' };
  const base = (Deno.env.get('GITHUB_API_BASE') || 'https://api.github.com').replace(/\/$/, '');
  const ref = Deno.env.get('GITHUB_DISPATCH_REF') || 'master';
  try {
    const r = await fetchImpl(`${base}/repos/${repo}/actions/workflows/${workflow}.yml/dispatches`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'x-github-api-version': '2022-11-28', 'user-agent': 'omnikom-platform' },
      body: JSON.stringify({ ref, inputs }),
      signal: AbortSignal.timeout(8000),
    });
    await r.body?.cancel();
    if (r.status === 204) return { dispatched: true, reason: null };
    console.error('dispatch not accepted', workflow, r.status);
    return { dispatched: false, reason: `github ${r.status}` };
  } catch (e) {
    console.error('dispatch failed', workflow, String(e).slice(0, 120));
    return { dispatched: false, reason: 'github unreachable' };
  }
}
