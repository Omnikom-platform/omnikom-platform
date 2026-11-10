// lead-update: the dashboard changes a lead's status, owner or notes, unassigns it, or marks it read (slice 4.2; 14-LEAD-PATH; migration 4 service.lead_update).
// Steps: the user's JWT -> body { lead, status?, owner?, note?, unassign?, read? } (400) -> service.lead_update (it writes the timeline event;
// 404 S-NOT-FOUND for a lead the caller cannot see, also for another workspace's lead; 403 S-OWN-ONLY when a member hands a lead on) -> 204.
// Slice 5.2: `read: true` calls service.mark_lead_read (migration 12: the lead is bold in the caller's list until they open it), alone or together
// with the other fields. Together, both run in ONE transaction: a refused change marks nothing. `read: false` does nothing (there is no "unread").
// Work order 01: `fields: { name?, email?, phone?, status?, owner?, <industry key>? }` calls service.lead_set_fields (migration 14) in that same
// transaction: one `edited` event per changed field, typed as the contract says (400 I-ANSWER naming the field, 400 I-UNKNOWN, 403 S-LOCKED for a
// field the contract marks not editable, 403 S-CONSENT for the consent record, 403 S-OWN-ONLY when a member changes the owner). 200 { changed }.
// Work order 20 (migration 23): the status is one of THIS business's own (its contract's crm.statuses, or spam): a key, up to 40 characters, and the database decides
// whether the business has it (400 I-ANSWER status). `status_date` (2026-11-20), `status_who` (a member's user id) and `status_text` (up to 200) go with it: a status that
// needs a date without one is 400 I-ANSWER status_date; a person who is not a member is 400 I-ANSWER status_who. A note carries its author (detail.author).
// Work order 18 (migration 22): `follow_up: "2026-11-20T10:00:00Z"` sets the lead's follow-up date, `follow_up: null` clears it (400 for anything else, also
// a date without a time); service.lead_follow_up writes one `follow-up` event with old and new, in the same transaction as the other changes. Answers 204.
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, noContent, json, SLUG } from '../_shared/http.ts';

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'lead-update', async (c, d) => {
    const f = new Fields(d);
    const lead = f.uuid('lead'), owner = f.uuid('owner', false), note = f.str('note', { max: 2000 }), unassign = f.bool('unassign'), status = f.str('status', { max: 40 });
    const statusDate = f.day('status_date'), statusWho = f.uuid('status_who', false), statusText = f.str('status_text', { max: 200 });
    const read = f.bool('read'), fields = f.obj('fields', false);
    // work order 18: `follow_up` is a date and time with an offset, or null to clear it; absent leaves it alone
    const setFollowUp = 'follow_up' in d && d.follow_up !== undefined, followUp = f.instant('follow_up');
    if (fields && Object.keys(fields).length > 50) f.problems.push({ code: 'LENGTH', path: 'fields', msg: 'At most 50 fields.' });
    if (status && !SLUG.test(status)) f.problems.push({ code: 'ENUM', path: 'status', msg: 'Not a lead status.' });
    if (f.problems.length || !lead) return badBody(f.problems);
    let changed: number | null = null;
    await c.sql.begin(async (tx: typeof c.sql) => {
      // lead_update with nothing to change still checks the lead (404 for one the caller cannot see), as it did before 5.2
      await tx`select service.lead_update(${c.jwtClaims}::jsonb, ${lead}::uuid, ${status}::text, ${owner}::uuid, ${note}, ${unassign === true}, ${statusDate}::date, ${statusWho}::uuid, ${statusText}::text)`;
      if (fields) changed = (await tx`select service.lead_set_fields(${c.jwtClaims}::jsonb, ${lead}::uuid, ${fields}::jsonb) as n`)[0].n as number;
      if (setFollowUp) await tx`select service.lead_follow_up(${c.jwtClaims}::jsonb, ${lead}::uuid, ${followUp}::timestamptz)`;
      if (read === true) await tx`select service.mark_lead_read(${c.jwtClaims}::jsonb, ${lead}::uuid)`;
    });
    return changed === null ? noContent() : json(200, { changed });
  });
}

if (import.meta.main) Deno.serve(handle);
