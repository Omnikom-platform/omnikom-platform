// sitemap-submit: tell the search engines a live site's sitemap changed (work order 44, C16). POST ?job=<uuid> with body {}, signed with CRON_KEY in
// X-Cron-Signature (the frame of _shared/runner.ts). job-callback does the same work itself on `done` of a production job (best effort); this entry is for
// a repeat by hand or by the head. The steps and what is BLOCKED or not sent are in _shared/sitemap.ts. 200 with the answer; 404 for a job that does not exist.
import { runner } from '../_shared/runner.ts';
import { json, problem } from '../_shared/http.ts';
import { submitForJob, type SubmitDeps } from '../_shared/sitemap.ts';

export async function handle(req: Request, deps: SubmitDeps = {}): Promise<Response> {
  return await runner(req, { fn: 'sitemap-submit', method: 'POST', idParam: 'job', keyEnv: 'CRON_KEY', header: 'x-cron-signature' }, async c => {
    const r = await submitForJob(c.sql, c.id as string, deps);
    if ('skipped' in r && r.skipped === 'there is no site for this job') return problem(404, 'S-NOT-FOUND', 'Not found.');
    return json(200, r);
  });
}

if (import.meta.main) Deno.serve(req => handle(req));
