// GitHub dispatch for the build runner (02-BACKEND section 7; slice 4.2; book row E9, H0-5). Environment, by name: GITHUB_DISPATCH_TOKEN_V2 (fine-grained,
// this repository only, Actions: read and write, nothing else) starts publish.yml or media.yml by workflow_dispatch, POST .../actions/workflows/<file>.yml/dispatches
// { ref: master, inputs } (strings only); GITHUB_DISPATCH_TOKEN (Contents: write, used only while the new one is not set; the head retires it) makes repository_dispatch,
// POST .../dispatches { event_type, client_payload }. GitHub answers 204. A dispatch that did not happen is REPORTED (dispatched: false and why), never hidden: the job stays
// queued and the reaper fails it after 24 hours (service.reap_stale_jobs). GITHUB_REPO is owner/repo; GITHUB_API_BASE is for the tests' fake server (default https://api.github.com). No token is ever printed.
export type Dispatched = { dispatched: boolean; reason: string | null };

export async function dispatch(workflow: 'publish' | 'media', inputs: Record<string, string>, fetchImpl: typeof fetch = fetch): Promise<Dispatched> {
  const v2 = Deno.env.get('GITHUB_DISPATCH_TOKEN_V2'), token = v2 || Deno.env.get('GITHUB_DISPATCH_TOKEN'), repo = Deno.env.get('GITHUB_REPO');
  if (!token) return { dispatched: false, reason: 'no dispatch token' };
  if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return { dispatched: false, reason: 'no repository configured' };
  const base = (Deno.env.get('GITHUB_API_BASE') || 'https://api.github.com').replace(/\/$/, '');
  const [path, body] = v2 ? [`actions/workflows/${workflow}.yml/dispatches`, { ref: 'master', inputs }] : ['dispatches', { event_type: workflow, client_payload: inputs }];
  try {
    const r = await fetchImpl(`${base}/repos/${repo}/${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'x-github-api-version': '2022-11-28', 'user-agent': 'omnikom-platform' },
      body: JSON.stringify(body),
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
