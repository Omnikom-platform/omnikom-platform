// lead-update: the dashboard changes a lead's status, owner or notes, unassigns it, or marks it read (slice 4.2; 14-LEAD-PATH; migration 4 service.lead_update).
// Steps: the user's JWT -> body { lead, status?, owner?, note?, unassign?, read? } (400) -> service.lead_update (it writes the timeline event;
// 404 S-NOT-FOUND for a lead the caller cannot see, also for another workspace's lead; 403 S-OWN-ONLY when a member hands a lead on) -> 204.
// Slice 5.2: `read: true` calls service.mark_lead_read (migration 12: the lead is bold in the caller's list until they open it), alone or together
// with the other fields. Together, both run in ONE transaction: a refused change marks nothing. `read: false` does nothing (there is no "unread").
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, noContent } from '../_shared/http.ts';

const STATUS = ['new', 'contacted', 'qualified', 'closed', 'spam'];

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'lead-update', async (c, d) => {
    const f = new Fields(d);
    const lead = f.uuid('lead'), owner = f.uuid('owner', false), note = f.str('note', { max: 2000 }), unassign = f.bool('unassign'), status = f.str('status', { max: 20 });
    const read = f.bool('read');
    if (status && !STATUS.includes(status)) f.problems.push({ code: 'ENUM', path: 'status', msg: 'Not a lead status.' });
    if (f.problems.length || !lead) return badBody(f.problems);
    await c.sql.begin(async (tx: typeof c.sql) => {
      // lead_update with nothing to change still checks the lead (404 for one the caller cannot see), as it did before 5.2
      await tx`select service.lead_update(${c.jwtClaims}::jsonb, ${lead}::uuid, ${status}::public.lead_status, ${owner}::uuid, ${note}, ${unassign === true})`;
      if (read === true) await tx`select service.mark_lead_read(${c.jwtClaims}::jsonb, ${lead}::uuid)`;
    });
    return noContent();
  });
}

if (import.meta.main) Deno.serve(handle);
