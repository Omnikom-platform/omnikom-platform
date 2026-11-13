// media-manage (book row B14; migration 44), body { media, action: 'replace' | 'delete', with? }. Replace: service.replace_media (the file's owner or staff,
// a file of the same workspace, else 404), then in its transaction the save's own checks (save/index.ts) on each changed item: a problem rolls all back
// (422) -> 200 { versions }; the old file and its bytes stay, unused. Delete, one act: in one transaction service.delete_media (404; 409 in use), then
// Storage removes the four objects (secret key, 10 s); only then the commit -> 200 { deleted }; a refusal or no answer rolls back -> 502 STORAGE.
import { dashboard, badBody } from '../_shared/dashboard.ts';
import { Fields, json, problem, serve, type FieldProblem } from '../_shared/http.ts';
import { storageCfg } from '../_shared/storage.ts';
import { RowValidator } from '../_shared/validate.ts';

export async function handle(req: Request): Promise<Response> {
  return await dashboard(req, 'media-manage', async (c, d) => {
    const f = new Fields(d);
    const media = f.uuid('media'), action = f.str('action', { max: 10, required: true }), other = f.uuid('with', action === 'replace');
    if (action && action !== 'replace' && action !== 'delete') f.problems.push({ code: 'ENUM', path: 'action', msg: 'Replace or delete.' });
    if (other && other === media) f.problems.push({ code: 'SAME', path: 'with', msg: 'Choose another file.' });
    if (f.problems.length || !media || !action) return badBody(f.problems);
    if (action === 'replace') {
      const problems: FieldProblem[] = [];
      let versions = 0;
      try {
        await c.sql.begin(async (tx: typeof c.sql) => {
          const changed = await tx`select * from service.replace_media(${c.jwtClaims}::jsonb, ${media}::uuid, ${other}::uuid)`;
          versions = changed.length;
          if (!versions) return;
          const ws = changed[0].item_workspace;
          const [{ contract }] = await tx`select service.contract_for(${c.jwtClaims}::jsonb, ${ws}::uuid) as contract`;
          const validator = new RowValidator(tx, c.jwtClaims, ws, contract);
          for (const it of changed) for (const p of await validator.check(it.item_collection, it.item_data, 'draft')) problems.push({ ...p, row: it.item_row });
          if (problems.length) throw new Error('media-manage: a replaced item fails the save checks; rolled back');
        });
      } catch (e) { if (!problems.length) throw e; }
      if (problems.length) return problem(422, 'VALIDATION', 'Some fields need attention.', problems);
      return json(200, { versions });
    }
    const cfg = storageCfg();
    if (!cfg) { console.error('media-manage: SUPABASE_URL or the secret key is not set'); return problem(500, 'CONFIG', 'Not configured.'); }
    const { base, key } = cfg;
    let refused = '';
    try {
      await c.sql.begin(async (tx: typeof c.sql) => {
        const paths = (await tx`select p from service.delete_media(${c.jwtClaims}::jsonb, ${media}::uuid) p`).map((x: { p: string }) => x.p);
        try {
          const r = await fetch(`${base}/storage/v1/object/media`, { method: 'DELETE', headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: paths }), signal: AbortSignal.timeout(10000) });
          await r.body?.cancel();
          if (!r.ok) refused = `storage answered ${r.status}`;
        } catch (e) { refused = `storage not reached: ${String(e).slice(0, 120)}`; }
        if (refused) throw new Error('media-manage: Storage did not remove the files; rolled back');
      });
    } catch (e) { if (!refused) throw e; }
    if (refused) { console.error('media-manage:', media, refused); return problem(502, 'STORAGE', 'Nothing was changed. Try again.'); }
    return json(200, { deleted: true });
  });
}

if (import.meta.main) serve('media-manage', handle);
