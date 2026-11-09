// lead-task: the CRM adds a task to a lead or marks one done (work order 18; migration 22 service.task_add / service.task_done).
// Body { lead, text, due? } adds (201 { task }); body { task, done } marks it finished or reopens it (200 { task, done }). Exactly one of the two shapes:
// both or neither is 400. Steps: the user's JWT -> body (400: text 1 to 500 characters, due a date and time with an offset or null, done yes or no) -> the
// service function, which writes the task and its timeline event in one transaction. 404 S-NOT-FOUND for a lead or task the caller may not act on (a member:
// only leads assigned to them), also for another workspace's.
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, json } from '../_shared/http.ts';

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'lead-task', async (c, d) => {
    const f = new Fields(d);
    const lead = f.uuid('lead', false), task = f.uuid('task', false);
    const adding = d.lead != null || d.text != null || d.due != null, marking = d.task != null || d.done != null;
    if (adding === marking) f.problems.push({ code: 'BODY', path: adding ? 'lead' : 'task', msg: 'Send lead and text to add a task, or task and done to mark one.' });
    const text = adding ? f.str('text', { max: 500, required: true }) : null, due = adding ? f.instant('due') : null;
    const done = marking ? f.bool('done', true) : null;
    if (adding && !lead && !f.problems.some(p => p.path === 'lead')) f.problems.push({ code: 'REQUIRED', path: 'lead', msg: 'This is needed.' });
    if (marking && !task && !f.problems.some(p => p.path === 'task')) f.problems.push({ code: 'REQUIRED', path: 'task', msg: 'This is needed.' });
    if (f.problems.length) return badBody(f.problems);
    if (adding) {
      const [{ created }] = await c.sql`select service.task_add(${c.jwtClaims}::jsonb, ${lead}::uuid, ${text}, ${due}::timestamptz) as created`;
      return json(201, { task: created });
    }
    await c.sql`select service.task_done(${c.jwtClaims}::jsonb, ${task}::uuid, ${done}::boolean)`;
    return json(200, { task, done });
  });
}

if (import.meta.main) Deno.serve(handle);
