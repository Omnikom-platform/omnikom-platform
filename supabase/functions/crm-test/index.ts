// crm-test: "Send a test" on the Settings screen (DP-1.6-06; slice 5.2). Body { workspace }; owner or staff (the database decides).
// Sends ONE signed POST to the stored CRM address with a fixed synthetic lead and tells the person, in plain words, what came back.
//   1. service.crm_target gives the stored address and its signing secret (404 S-NOT-FOUND for anyone who is not an owner or staff; 409 NO-CRM when
//      no connection is set up). The secret is used for the signature below and goes nowhere else: not into the answer, the log or the audit row.
//   2. The host is resolved (netguard.ts, A and AAAA) and the test is refused, 422 CRM-HOST with the plain reason, when any answer is private,
//      loopback, link-local or unique-local, or when the name does not resolve. SQL checked the text of the address when it was saved; only here can
//      DNS be seen. No connection is made to a refused host.
//   3. The request: POST, body {"test":true,"lead":{"name":"Test Lead","email":"test@example.com"}}, header X-Omnikom-Signature = t=<unix>,v1=<hex>
//      (HMAC-SHA256 with the stored secret; the SAME shape and canonical text as _shared/signature.ts, so a client verifies it the way it verifies
//      a site's signature), redirect: 'manual' (a redirect is reported, never followed: it could point inside), 10 second timeout. The response body is
//      never read or returned.
//   4. service.crm_tested records one audit row: the outcome, the status and the host name. Never the path, the query or the secret.
// Answers 200 { ok, status, ms, reason? }: ok is true for a 2xx; status is null when nothing answered (timeout, refused connection) and `reason` says so.
import { dashboard, badBody, type Ctx } from '../_shared/dashboard.ts';
import { Fields, json, problem } from '../_shared/http.ts';
import { hostProblem, systemResolve, type Resolve } from '../_shared/netguard.ts';
import { sign } from '../_shared/signature.ts';

export const TEST_BODY = JSON.stringify({ test: true, lead: { name: 'Test Lead', email: 'test@example.com' } });
const TIMEOUT_MS = 10_000;

export function makeHandle(deps: { resolve?: Resolve; fetchImpl?: typeof fetch } = {}) {
  const resolve = deps.resolve ?? systemResolve;
  const fetchImpl = deps.fetchImpl ?? fetch;
  return async (req: Request): Promise<Response> => await dashboard(req, 'crm-test', async (c: Ctx, d) => {
    const f = new Fields(d);
    const workspace = f.uuid('workspace');
    if (f.problems.length || !workspace) return badBody(f.problems);
    c.workspace = workspace;
    const [target] = await c.sql`select * from service.crm_target(${c.jwtClaims}::jsonb, ${workspace}::uuid)`;
    if (!target) return problem(409, 'NO-CRM', 'No CRM connection is set up yet.');
    let url: URL;
    try { url = new URL(String(target.url)); } catch { return problem(409, 'NO-CRM', 'The saved CRM address is not valid. Save it again.'); }
    const tested = (outcome: 'sent' | 'refused' | 'failed', status: number | null) =>
      c.sql`select service.crm_tested(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${outcome}, ${status}::int, ${url.hostname})`;
    const why = url.protocol === 'https:' ? await hostProblem(url.hostname, resolve) : 'The saved address does not start with https://.';
    if (why) {
      await tested('refused', null);
      return problem(422, 'CRM-HOST', why);
    }
    const started = Date.now();
    let status: number | null = null, reason: string | null = null;
    try {
      const signature = await sign(String(target.secret), 'POST', url.pathname + url.search, TEST_BODY);
      const res = await fetchImpl(url.toString(), {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), body: TEST_BODY,
        headers: { 'content-type': 'application/json', 'x-omnikom-signature': signature, 'user-agent': 'Omnikom-CRM-Test/1' },
      });
      status = res.status;
      await res.body?.cancel();
      if (status >= 300 && status < 400) reason = 'The address answered with a redirect. Use the final address, Omnikom does not follow redirects.';
      else if (status < 200 || status >= 300) reason = `The CRM answered ${status}.`;
    } catch (e) {
      reason = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'The CRM did not answer within 10 seconds.' : 'Could not reach the CRM.';
    }
    const ms = Date.now() - started;
    const ok = status !== null && status >= 200 && status < 300;
    await tested(status !== null ? 'sent' : 'failed', status);
    return json(200, { ok, status, ms, ...(reason ? { reason } : {}) });
  });
}

export const handle = makeHandle();

if (import.meta.main) Deno.serve(handle);
