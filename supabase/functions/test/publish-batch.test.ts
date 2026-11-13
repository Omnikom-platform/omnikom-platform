// publish [E13-d]: a publish validates its rows in at most 3 statements whatever their number (every pinned version at once, then every reference
// and every photo the rows mention), and a publish of 200 rows that each have their own photo is not refused for a photo that was never asked.
import { handle as save } from '../save/index.ts';
import { handle } from '../publish/index.ts';
import { assert, call, eq, fake, mkMedia, newest, photoContract, SITE_A, SUB, teamRows, t, WS_A, withSql } from './util.ts';

const publish = (who: Parameters<typeof call>[3], body: Record<string, unknown>) => call(handle, 'publish', body, who);
const saveRow = async (who: Parameters<typeof call>[3], collection: string, row: string | null, data: Record<string, unknown>) => {
  const r = await call(save, 'save', { workspace: WS_A, collection, row, data, ...(row ? { base: await newest(row) } : {}) }, who);   // slice 5.2: a save of an existing row says which version it started from
  eq(r.status, 200, `save ${collection}: ${r.text}`);
  return { row: String(r.json?.row), version: Number(r.json?.version) };
};
/** n processed photos of workspace A, in one statement */
const photos = (n: number): Promise<string[]> => withSql(async sql => (await sql`insert into public.media (workspace_id, path, width, processed, exif_stripped, rights_confirmed, uploaded_by)
  select ${WS_A}::uuid, ${WS_A}::text || '/' || gen_random_uuid()::text || '.jpg', 2400, true, true, true, ${SUB['owner-a']}::uuid from generate_series(1, ${n}::int) returning id`).map((m: { id: string }) => String(m.id)));
const listing = (i: number, photo: string, agent: string) => ({ street: `${i} Batch Road`, status: 'for-sale', agent, photo: { asset: photo, alt: 'The front of the house', width: 5000, exifStripped: true, rightsConfirmed: true } });

t('publish [E13-d]: 3 rows and 30 rows are validated in the same 3 statements, and a problem names its own row', async () => {
  await photoContract();
  const team = await teamRows();
  const good = await photos(29), bad = await mkMedia(WS_A, { width: null, processed: false });
  const rows: string[] = [], versions: number[] = [];
  try {
    for (let i = 0; i < 30; i++) { const s = await saveRow('owner-a', 'listings', null, listing(i, i === 17 ? bad : good[i < 17 ? i : i - 1], team.one)); rows.push(s.row); versions.push(s.version); }
    const mod = await import('../publish/index.ts') as Record<string, unknown>;
    assert(typeof mod.problemsOf === 'function', 'publish/index.ts exports problemsOf');
    const problemsOf = mod.problemsOf as (sql: unknown, jwtClaims: object, ws: string, contract: unknown, rows: string[], versions: number[]) => Promise<{ code: string; row?: string }[]>;
    await withSql(async sql => {
      const seen = { n: 0 };
      const counted = Object.assign((s: TemplateStringsArray, ...v: unknown[]) => { seen.n++; return sql(s, ...v); }, { array: (x: unknown[]) => sql.array(x) });
      const claims = { sub: SUB['owner-a'], aal: 'aal1', role: 'authenticated', email: null };
      const [{ contract }] = await sql`select service.contract_for(${claims}::jsonb, ${WS_A}::uuid) as contract`;
      seen.n = 0;
      const three = await problemsOf(counted, claims, WS_A, contract, rows.slice(0, 3), versions.slice(0, 3));
      eq(seen.n, 3, 'statements for 3 rows'); eq(three.length, 0, 'problems of rows 0-2: ' + JSON.stringify(three));
      seen.n = 0;
      const all = await problemsOf(counted, claims, WS_A, contract, rows, versions);
      eq(seen.n, 3, 'statements for 30 rows');
      assert(all.length > 0 && all.every(p => p.row === rows[17]), 'every problem names row 17: ' + JSON.stringify(all));
    });
  } finally {
    await withSql(async sql => {
      await sql`update public.content_rows set deleted_at = now() where id = any(${rows}::uuid[])`;
      await sql`delete from public.media where id = any(${[...good, bad]}::uuid[])`;
    });
  }
});

t('publish [E13-d]: 200 rows, each with its own photo, publish (202); before, the 200th photo was never asked (422 I-MEDIA-UNKNOWN)', async () => {
  await photoContract();
  await fake.reset();
  const team = await teamRows();
  const media = await photos(200);
  const rows: string[] = [], versions: number[] = [];
  try {
    for (let i = 0; i < 200; i++) { const s = await saveRow('owner-a', 'listings', null, listing(i, media[i], team.one)); rows.push(s.row); versions.push(s.version); }
    const r = await publish('owner-a', { site: SITE_A, rows, versions });
    eq(r.status, 202, 'status: ' + r.text); eq(r.json?.dispatched, true, 'dispatched');
  } finally {
    await withSql(async sql => {
      await sql`update public.content_rows set deleted_at = now() where id = any(${rows}::uuid[])`;
      await sql`delete from public.media where id = any(${media}::uuid[])`;
    });
  }
});
