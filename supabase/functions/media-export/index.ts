// media-export: the build runner's media job asks where one uploaded file is and where to put its sizes (02-BACKEND section 5; slice 4.3).
// GET ?media=<uuid>, X-Runner-Signature (the frame in _shared/runner.ts). service.media_for_runner(media) (404 for an unknown id), then:
//   200 { id, workspace_id, path, processed, url, uploads: { "2400": <signed upload URL>, "1600": ..., "800": ... } }
//   url      a signed download URL (1 hour) for the ORIGINAL upload at `path`
//   uploads  one signed upload URL for each of `<path without extension>-<width>.webp`, in the same workspace folder (the path starts with
//            <workspace_id>/, which media_path_in_workspace requires); the signing asks for upsert, so a rerun can write the same size again
// A file Storage will not sign (the upload never arrived, Storage is down) is a 502 STORAGE: the runner retries and then fails the media job.
// The secret key never leaves this function.
import { runner } from '../_shared/runner.ts';
import { json, problem, serve } from '../_shared/http.ts';
import { storageCfg, signDownload, signUpload, derivativePath, SLOTS } from '../_shared/storage.ts';

export const WIDTHS = [...SLOTS];

export async function handle(req: Request): Promise<Response> {
  return await runner(req, { fn: 'media-export', method: 'GET', idParam: 'media' }, async c => {
    const [m] = await c.sql`select * from service.media_for_runner(${c.id}::uuid)`;
    const cfg = storageCfg();
    if (!cfg) { console.error('media-export: SUPABASE_URL or the secret key is not set'); return problem(500, 'CONFIG', 'Not configured.'); }
    const [url, ...ups] = await Promise.all([signDownload(cfg, m.path, 3600), ...WIDTHS.map(w => signUpload(cfg, derivativePath(m.path, w)))]);
    if (!url || ups.some(u => !u)) return problem(502, 'STORAGE', 'Files are not available right now. Please try again.');
    const uploads: Record<string, string> = {};
    WIDTHS.forEach((w, i) => { uploads[String(w)] = ups[i] as string; });
    return json(200, { id: m.id, workspace_id: m.workspace_id, path: m.path, processed: m.processed === true, url, uploads });
  });
}

if (import.meta.main) serve('media-export', handle);
