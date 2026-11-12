// upload-finish: the dashboard says the file is uploaded and ticks the rights box (specs/openapi.json UploadFinishRequest; 02-BACKEND
// section 5; slice 4.2). Steps: the user's JWT -> the body shape (400; `alt` is at most 150 characters and lives in the row, not here)
// -> service.finish_media (the uploader, an owner or staff; it sets the rights tick and NOTHING the processor owns; 404 for anyone else)
// -> the media job is dispatched to the runner (GitHub dispatch (`_shared/dispatch.ts`: workflow_dispatch with the new token, repository_dispatch
// while only the old one is set) of { media_id, workspace_id }; `dispatched` is reported honestly) -> 200 { media, processed, dispatched }. processed stays false until the runner's callback says otherwise.
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, json, serve } from '../_shared/http.ts';
import { dispatch } from '../_shared/dispatch.ts';

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'upload-finish', async (c, d) => {
    const f = new Fields(d);
    const media = f.uuid('media'), rights = f.bool('rightsConfirmed', true);
    f.str('alt', { max: 150 });
    if (f.problems.length || !media || rights === null) return badBody(f.problems);
    await c.sql`select service.finish_media(${c.jwtClaims}::jsonb, ${media}::uuid, ${rights})`;
    const [m] = await c.sql`select * from service.media_for_runner(${media}::uuid)`;
    c.workspace = m.workspace_id;
    const sent = await dispatch('media', { media_id: media, workspace_id: m.workspace_id });
    return json(200, { media, processed: m.processed === true, dispatched: sent.dispatched, ...(sent.reason ? { reason: sent.reason } : {}) });
  });
}

if (import.meta.main) serve('upload-finish', handle);
