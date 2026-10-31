// upload-start: the dashboard asks where to put a photo or a PDF (specs/openapi.json UploadStartRequest; 02-BACKEND section 5; slice 4.2).
// Steps: the user's JWT -> the body shape (400) -> the cap (413, over 25 MB) and the type list (415) BEFORE the database -> service.record_media
// (a media row under <workspace_id>/<uuid>.<ext>, unprocessed; 404 for a non-member) -> a signed upload URL from Storage for the private
// bucket `media` (POST <SUPABASE_URL>/storage/v1/object/upload/sign/media/<path> with the secret key answers { url, token }; the dashboard
// uploads to <SUPABASE_URL>/storage/v1<url>) -> 200 { media, uploadUrl, path }. The secret key never leaves this function.
// Environment, by name: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (the default name Supabase sets in functions) or SUPABASE_SECRET_KEY.
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, json, problem } from '../_shared/http.ts';

export const MAX_BYTES = 26214400;
export const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'upload-start', async (c, d) => {
    const f = new Fields(d);
    const workspace = f.uuid('workspace'), filename = f.str('filename', { max: 200, required: true }), bytes = f.int('bytes', { required: true }), mime = f.str('mime', { max: 100, required: true });
    if (f.problems.length || !workspace || !filename || bytes === null || !mime) return badBody(f.problems);
    if (bytes > MAX_BYTES) return problem(413, 'SIZE', 'This file is too large (25 MB at most).');
    if (bytes < 1) return badBody([{ code: 'SIZE', path: 'bytes', msg: 'The file is empty.' }]);
    if (!MIMES.includes(mime)) return problem(415, 'MIME', 'Use a jpg, png, webp, heic or pdf file.');
    c.workspace = workspace;
    const [m] = await c.sql`select * from service.record_media(${c.jwtClaims}::jsonb, ${workspace}::uuid, ${filename}, ${bytes}::int, ${mime})`;
    const base = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
    if (!base || !key) { console.error('upload-start: SUPABASE_URL or the secret key is not set'); return problem(500, 'CONFIG', 'Not configured.'); }
    let signed: { url?: string } | null = null;
    try {
      const r = await fetch(`${base}/storage/v1/object/upload/sign/media/${m.path}`, {
        method: 'POST', headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000),
      });
      if (r.ok) signed = await r.json(); else { console.error('upload-start: storage answered', r.status); await r.body?.cancel(); }
    } catch (e) { console.error('upload-start: storage unreachable', String(e).slice(0, 120)); }
    if (!signed || typeof signed.url !== 'string') return problem(502, 'STORAGE', 'Uploads are not available right now. Please try again.');
    return json(200, { media: m.id, uploadUrl: `${base}/storage/v1${signed.url}`, path: m.path });
  });
}

if (import.meta.main) Deno.serve(handle);
