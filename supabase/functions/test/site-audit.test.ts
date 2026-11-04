// Work order 10 (migration 16): site-audit passes the verified claims and the site through and maps the walls to the right status. The walls and the
// answer's content are proven in tenancy.test.sql T24; these tests prove the function reaches them and answers as documented.
import { handle as siteAudit } from '../site-audit/index.ts';
import { assert, call, eq, mint, SITE_A, SITE_B, SUB, t, withSql, type Sql } from './util.ts';

type W = Parameters<typeof call>[3];
// deno-lint-ignore no-explicit-any
type Res = { status: number; text: string; json: any };
const ask = async (who: W, body: unknown): Promise<Res> => (await call(siteAudit, 'site-audit', body, who)) as unknown as Res;

const summary = (target: string, pass: boolean, fails: unknown[]) => ({ v: 1, target, mode: 'test', pass, exit: pass ? 0 : 1, pages: 3, rules: 7,
  counts: { PASS: 20, FAIL: fails.length, SKIP: 1 }, byFamily: {}, fails, truncated: 0 });
// jobs of site A made directly, finished far in the future so they are the newest whatever the other tests left behind; removed afterwards
async function withJobs<T>(fn: (ids: { preview: string; production: string; older: string }) => Promise<T>): Promise<T> {
  const made: string[] = [];
  const mk = (sql: Sql, state: string, at: string, report: unknown): Promise<string> =>
    sql`insert into public.publish_jobs (workspace_id, site_id, requested_by, rows, requested, state, gate_report, finished_at)
      values ('aaaaaaaa-0000-0000-0000-000000000000'::uuid, ${SITE_A}::uuid, ${SUB['owner-a']}::uuid, '{}', '{}', ${state}::public.job_state, ${report}::jsonb, ${at}::timestamptz) returning id`.then((r: { id: string }[]) => { made.push(r[0].id); return r[0].id; });
  try {
    const ids = await withSql(async sql => ({
      older: await mk(sql, 'done', '2098-01-01T10:00:00Z', { factory: 'pass', audit: summary('preview', true, []) }),
      preview: await mk(sql, 'failed', '2098-01-02T10:00:00Z', { reason: 'audit failed', factory: 'pass', audit: summary('preview', false, [{ rule: 'MET-003', page: '/contact/', line: 7, what: 'one heading', source: 's' }]) }),
      production: await mk(sql, 'done', '2098-01-03T10:00:00Z', { factory: 'pass', audit: summary('production', true, []) }),
    }));
    return await fn(ids);
  } finally {
    await withSql(async sql => { for (const id of made) await sql`delete from public.publish_jobs where id = ${id}::uuid`; });
  }
}

t('site-audit: the owner gets { latest: { preview, production }, history }: the newest job of each target with its summary, fails included; history without fails', async () => {
  await withJobs(async ids => {
    const r = await ask('owner-a', { site: SITE_A });
    eq(r.status, 200, 'status: ' + r.text);
    eq(Object.keys(r.json ?? {}).sort().join(), 'history,latest', 'the answer\'s keys');
    eq(r.json?.latest?.preview?.job, ids.preview, 'latest.preview is the newest preview job (a failed one counts)');
    eq(r.json?.latest?.preview?.state, 'failed', 'a failed job says it'); eq(r.json?.latest?.preview?.pass, false, 'pass false');
    eq(r.json?.latest?.preview?.summary?.fails?.[0]?.rule, 'MET-003', 'latest keeps the summary whole, fails included');
    eq(r.json?.latest?.production?.job, ids.production, 'latest.production');
    eq(r.json?.history?.[0]?.job, ids.production, 'history is newest first'); eq(r.json?.history?.[1]?.job, ids.preview, 'second');
    assert(r.json.history.length <= 10, 'at most 10');
    assert(!/"fails"/.test(JSON.stringify(r.json.history)) && r.json.history.every((h: { summary: unknown }) => h.summary === null), 'history carries no fails and no summary');
  });
});

t('site-audit: the body is checked (400 BODY, nothing asked of the database): no site, a site that is not an id', async () => {
  for (const body of [{}, { site: 'not-an-id' }, { site: 5 }, { workspace: SITE_A }]) {
    const r = await ask('owner-a', body);
    eq(r.status, 400, JSON.stringify(body) + ': ' + r.text); eq(r.json?.code, 'BODY', 'code');
  }
});

t('site-audit: a member, another workspace\'s owner, a login of nothing and a site that is not the caller\'s get 404 S-NOT-FOUND, recorded against the site; no token is 401', async () => {
  const before = await withSql(async sql => (await sql`select count(*)::int as n from public.security_events where site_id = ${SITE_A}::uuid and code = 'S-NOT-FOUND' and detail ->> 'fn' = 'site-audit'`)[0].n as number);
  for (const who of ['member-a1', 'owner-b', 'nobody'] as const) {
    const r = await ask(who, { site: SITE_A });
    eq(r.status, 404, who + ': ' + r.text); eq(r.json?.code, 'S-NOT-FOUND', who + ' code');
  }
  const mine = await ask('owner-a', { site: SITE_B }); eq(mine.status, 404, 'owner of A on B\'s site: ' + mine.text);
  const gone = await ask('owner-a', { site: '99999999-9999-4999-8999-999999999999' }); eq(gone.status, 404, 'a site that does not exist: ' + gone.text);
  const after = await withSql(async sql => (await sql`select count(*)::int as n from public.security_events where site_id = ${SITE_A}::uuid and code = 'S-NOT-FOUND' and detail ->> 'fn' = 'site-audit'`)[0].n as number);
  eq(after - before, 3, 'three refusals recorded against the site');
  eq((await ask(null, { site: SITE_A })).status, 401, 'no token');
});

t('site-audit: staff with MFA reads; staff without MFA gets 404', async () => {
  const ok = await ask({ token: await mint('staff', { aal: 'aal2' }) }, { site: SITE_A });
  eq(ok.status, 200, 'staff aal2: ' + ok.text); assert(ok.json && 'latest' in ok.json && 'history' in ok.json, 'the same answer');
  const no = await ask({ token: await mint('staff', { aal: 'aal1' }) }, { site: SITE_A });
  eq(no.status, 404, 'staff aal1: ' + no.text);
});

t('site-audit: a site with no audited publish answers null for both targets and a list for history (never an error)', async () => {
  const r = await ask('owner-b', { site: SITE_B });
  eq(r.status, 200, 'status: ' + r.text);
  eq(r.json?.latest?.preview ?? null, null, 'preview null'); eq(r.json?.latest?.production ?? null, null, 'production null');
  assert(Array.isArray(r.json?.history), 'history is a list');
});
