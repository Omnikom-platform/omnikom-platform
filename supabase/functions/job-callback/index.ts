// job-callback: the build runner reports where a job is (02-BACKEND sections 4, 6, 7; specs/openapi.json JobCallback; slice 4.3).
// POST { job, state, gateReport?, deployId?, error? }, X-Runner-Signature over the exact body (the frame in _shared/runner.ts: 401 + a security event
// for a bad signature, a signature older than 300 s included). The body is checked (400 { problems }): job is a uuid, state is one of
// building | gating | deploying | done | failed (a `queued` or unknown state is refused), gateReport is an object of at most 64 KiB (413 beyond),
// deployId and error are short text. Then service.set_job_state(job, state, gateReport, deployId, error): the state machine decides, not this code
// (S-JOB-STATE = 409, S-NOT-FOUND = 404). Answer 204. On `done` the database moves published_version of the job's rows; on `failed` nothing changes.
// The callback records. It does not notify the requester and does not submit the sitemap (02-BACKEND lists both; neither is part of slice 4.3).
import { runner } from '../_shared/runner.ts';
import { Fields, noContent, problem } from '../_shared/http.ts';
import { badBody } from '../_shared/dashboard.ts';

export const STATES = ['building', 'gating', 'deploying', 'done', 'failed'];
export const MAX_REPORT = 64 * 1024;

export async function handle(req: Request): Promise<Response> {
  return await runner(req, { fn: 'job-callback', method: 'POST' }, async c => {
    const f = new Fields(c.body);
    const job = f.uuid('job'), state = f.str('state', { max: 20, required: true }), deployId = f.str('deployId', { max: 200 }), error = f.str('error', { max: 2000 });
    const report = f.obj('gateReport', false);
    if (state && !STATES.includes(state)) f.problems.push({ code: 'ENUM', path: 'state', msg: 'Not a state the runner reports.' });
    if (f.problems.length || !job || !state) return badBody(f.problems);
    if (report && JSON.stringify(report).length > MAX_REPORT) return problem(413, 'SIZE', 'The gate report is too large (64 KiB at most).');
    await c.sql`select service.set_job_state(${job}::uuid, ${state}::public.job_state, ${report}::jsonb, ${deployId}, ${error})`;
    return noContent();
  });
}

if (import.meta.main) Deno.serve(handle);
