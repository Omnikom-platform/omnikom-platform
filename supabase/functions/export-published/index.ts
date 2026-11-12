// export-published: the build runner fetches everything one publish job needs, as one JSON document (factory/README.md section 1; 02-BACKEND
// sections 4, 6, 7; slice 4.3). GET ?job=<uuid>, X-Runner-Signature (the frame in _shared/runner.ts: 404 for a malformed id, 401 + a security
// event for a bad signature). Then, as omnikom_fn:
//   service.freeze_snapshot(job)  the first call freezes the snapshot and moves the job queued -> building; a rerun returns the same snapshot
//                                 and changes nothing; S-JOB-BUSY = 409 (another build of this site runs; the runner's queue retries), S-NOT-FOUND = 404
//   service.export_bundle(job)    the document: schema, job, site, workspace, contract, rows (exactly the snapshot), media (this workspace's only)
// The media list is made fit for the runner here (ground rule 11, decision of the head 2026-10-31: the original upload, with its GPS data, never ships):
//   * only PROCESSED media are exported (export_bundle returns every media row of the workspace; an unprocessed one is dropped here),
//   * `path` is the widest derivative slot that exists for the original (derivativeSlot in _shared/storage.ts: 2400 when the original is at least
//     2400 px wide, else 1600 when at least 1600, else 800, which always exists), `<path without extension>-<slot>.webp`, NOT the original; `original_path` is the upload's
//     storage path, for information only; `url` is a signed download URL (1 hour) for THAT derivative, made with the secret key,
//   * at most 8 files are signed at a time, each call bounded to 10 s; a file Storage would not sign gets `url: null` and `error: 'sign failed'`
//     (the runner fails the build if the file is referenced).
// Answer 200 with the document and `cache-control: no-store`.
import { runner } from '../_shared/runner.ts';
import { json, problem, serve } from '../_shared/http.ts';
import { storageCfg, signDownload, pool, derivativePath, derivativeSlot } from '../_shared/storage.ts';

export const SIGN_AT_ONCE = 8;
type MediaRow = { id: string; path: string; width: number | null; height: number | null; processed: boolean; exif_stripped: boolean; rights_confirmed: boolean };

export async function handle(req: Request): Promise<Response> {
  return await runner(req, { fn: 'export-published', method: 'GET', idParam: 'job' }, async c => {
    await c.sql`select service.freeze_snapshot(${c.id}::uuid)`;
    const [{ bundle }] = await c.sql`select service.export_bundle(${c.id}::uuid) as bundle`;
    const cfg = storageCfg();
    if (!cfg) { console.error('export-published: SUPABASE_URL or the secret key is not set'); return problem(500, 'CONFIG', 'Not configured.'); }
    const processed = (bundle.media as MediaRow[]).filter(m => m.processed === true);
    bundle.media = await pool(processed, SIGN_AT_ONCE, async m => {
      const path = derivativePath(m.path, derivativeSlot(m.width));
      const url = await signDownload(cfg, path, 3600);
      return { id: m.id, path, original_path: m.path, width: m.width, height: m.height, processed: m.processed, exif_stripped: m.exif_stripped,
        rights_confirmed: m.rights_confirmed, url, ...(url ? {} : { error: 'sign failed' }) };
    });
    return json(200, bundle);
  });
}

if (import.meta.main) serve('export-published', handle);
