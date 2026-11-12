// drafts: the rows with changes waiting to be published ("Publish 3 changes", DP-1.4-04 and the change list DP-1.4c-01). Read-only (slice 5.2).
// Steps: the user's JWT -> body { site } (400) -> service.drafts_waiting (migration 12: owner and staff see every waiting row, an agent only the
// rows they could publish themselves, inbox rows and deleted rows never; 404 S-NOT-FOUND for a site the caller cannot see) -> 200
// { drafts: [{ row, collection, newest, published, editedBy, editedAt }] }, newest edit first. `published` is null for a row never published.
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, json, serve } from '../_shared/http.ts';

type Row = { row_id: string; collection: string; newest_version: number; published_version: number | null; edited_by: string | null; edited_at: Date | string };

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'drafts', async (c, d) => {
    const f = new Fields(d);
    const site = f.uuid('site');
    if (f.problems.length || !site) return badBody(f.problems);
    c.site = site;
    const rows: Row[] = await c.sql`select * from service.drafts_waiting(${c.jwtClaims}::jsonb, ${site}::uuid)`;
    return json(200, { drafts: rows.map(r => ({
      row: r.row_id, collection: r.collection, newest: r.newest_version, published: r.published_version, editedBy: r.edited_by,
      editedAt: r.edited_at instanceof Date ? r.edited_at.toISOString() : r.edited_at,
    })) });
  });
}

if (import.meta.main) serve('drafts', handle);
