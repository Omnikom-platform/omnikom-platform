// media-process-callback: the build runner says a photo has been processed (02-BACKEND section 5; ground rule 11; slice 4.3).
// POST { media, width, height, exifStripped: true, bytes, sizes: [..], skipped?: [..] }, X-Runner-Signature over the exact body (the frame in
// _shared/runner.ts). `sizes` and `skipped` (the widths made, the widths not made because the original is narrower) are accepted and ignored.
//   exifStripped must be the boolean true, or the call is refused 422 I-EXIF and the media stays unprocessed: nothing unprocessed is published.
//   width and height are whole numbers of at least 1 (422 I-MEDIA-SIZE otherwise; the size of the original after its orientation is applied).
//   { media, kind: 'document' } (a PDF) is answered 422 I-MEDIA-SIZE: service.media_processed refuses a width below 1 and the data model has no
//   document flag, so a document can never become `processed` today. Reported to the head as a finding; no migration comes from this slice.
//   service.media_processed(media, width, height, true, bytes): S-NOT-FOUND = 404. Answer 204.
import { runner } from '../_shared/runner.ts';
import { Fields, noContent, problem, serve } from '../_shared/http.ts';
import { badBody } from '../_shared/dashboard.ts';

const widthsOk = (v: unknown) => v == null || (Array.isArray(v) && v.length <= 10 && v.every(x => (typeof x === 'number' && Number.isInteger(x)) || (typeof x === 'string' && x.length <= 20)));

export async function handle(req: Request): Promise<Response> {
  return await runner(req, { fn: 'media-process-callback', method: 'POST' }, async c => {
    const f = new Fields(c.body);
    const media = f.uuid('media');
    if (f.problems.length || !media) return badBody(f.problems);
    if (c.body.kind === 'document') return problem(422, 'I-MEDIA-SIZE', 'A document has no pixel size, so it cannot be marked processed here.');
    const width = f.int('width', { required: true }), height = f.int('height', { required: true }), bytes = f.int('bytes');
    for (const k of ['sizes', 'skipped']) if (!widthsOk(c.body[k])) f.problems.push({ code: 'TYPE', path: k, msg: 'Must be a short list of widths.' });
    if (f.problems.length || width === null || height === null) return badBody(f.problems);
    if (c.body.exifStripped !== true) return problem(422, 'I-EXIF', 'Only a photo with its location data removed can be marked processed.');
    if (width < 1 || height < 1) return problem(422, 'I-MEDIA-SIZE', 'The width and height must be at least 1.');
    if (bytes !== null && bytes < 0) return badBody([{ code: 'TYPE', path: 'bytes', msg: 'Must be zero or more.' }]);
    await c.sql`select service.media_processed(${media}::uuid, ${width}::int, ${height}::int, true, ${bytes}::int)`;
    return noContent();
  });
}

if (import.meta.main) serve('media-process-callback', handle);
