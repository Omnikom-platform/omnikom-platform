// publish (slice 4.2): site_for + contract_for first (404), each pinned version validated in publish mode (422 with the row id),
// service.start_publish (walls), then the GitHub dispatch, which is REPORTED when it did not happen (202 dispatched: false).
import { handle as save } from '../save/index.ts';
import { handle } from '../publish/index.ts';
import { assert, call, eq, fake, mkMedia, newest, photoContract, securityEvents, SITE_A, SITE_B, SUB, teamRows, t, WS_A, withSql } from './util.ts';

const publish = (who: Parameters<typeof call>[3], body: Record<string, unknown>) => call(handle, 'publish', body, who);
const saveRow = async (who: Parameters<typeof call>[3], collection: string, row: string | null, data: Record<string, unknown>) => {
  const r = await call(save, 'save', { workspace: WS_A, collection, row, data, ...(row ? { base: await newest(row) } : {}) }, who);   // slice 5.2: a save of an existing row says which version it started from
  eq(r.status, 200, `save ${collection}: ${r.text}`);
  return { row: String(r.json?.row), version: Number(r.json?.version) };
};
const fullTeam = (name: string, slug: string) => ({ name, slug, role: 'Sales agent' });

t('publish [E9]: owner-a publishes a team row at its saved version: 202, a queued job, and GitHub received { job_id, site_id }', async () => {
  await fake.reset();
  const team = await teamRows();
  const v = await saveRow('owner-a', 'team', team.one, fullTeam('Agent One', 'agent-one'));
  const r = await publish('owner-a', { site: SITE_A, rows: [team.one], versions: [v.version] });
  eq(r.status, 202, 'status: ' + r.text); eq(r.json?.state, 'queued', 'state'); eq(r.json?.dispatched, true, 'dispatched');
  const job = String(r.json?.job);
  await withSql(async sql => {
    const [j] = await sql`select state, requested, site_id from public.publish_jobs where id = ${job}::uuid`;
    eq(j.state, 'queued', 'the job row is queued'); eq(j.requested[team.one], v.version, 'the job pins exactly the validated version'); eq(j.site_id, SITE_A, 'site');
  });
  const got = (await fake.recorded()).github;
  eq(got.length, 1, 'GitHub got one dispatch');
  eq(got[0].path, 'publish.yml', 'workflow_dispatch of publish.yml'); eq(got[0].token, 'v2', 'the new token was sent'); eq(got[0].body?.ref, 'master', 'ref');
  eq(Object.keys(got[0].body?.inputs ?? {}).sort().join(','), 'job_id,site_id', 'exactly these inputs'); eq(got[0].body?.inputs?.job_id, job, 'job_id'); eq(got[0].body?.inputs?.site_id, SITE_A, 'site_id'); eq(got[0].accept, 'application/vnd.github+json', 'accept header');
});

t('publish: a version that does not exist is 404 S-NOT-FOUND (the same answer as a row of another workspace)', async () => {
  const team = await teamRows();
  const before = await securityEvents({ actor: SUB['owner-a'], code: 'S-NOT-FOUND' });
  const r = await publish('owner-a', { site: SITE_A, rows: [team.one], versions: [999] });
  eq(r.status, 404, 'status'); eq(r.json?.code, 'S-NOT-FOUND', 'code');
  eq(await securityEvents({ actor: SUB['owner-a'], code: 'S-NOT-FOUND' }), before + 1, 'a security event');
});

t('publish [E9]: without GITHUB_DISPATCH_TOKEN the job is queued and the answer says dispatched: false (not a silent success)', async () => {
  await fake.reset();
  const team = await teamRows();
  const v = await saveRow('owner-a', 'team', team.one, fullTeam('Agent One', 'agent-one'));
  const token = Deno.env.get('GITHUB_DISPATCH_TOKEN'), v2 = Deno.env.get('GITHUB_DISPATCH_TOKEN_V2');
  Deno.env.delete('GITHUB_DISPATCH_TOKEN'); Deno.env.delete('GITHUB_DISPATCH_TOKEN_V2');
  try {
    const r = await publish('owner-a', { site: SITE_A, rows: [team.one], versions: [v.version] });
    eq(r.status, 202, 'status: ' + r.text); eq(r.json?.dispatched, false, 'dispatched'); eq(r.json?.reason, 'no dispatch token', 'reason'); eq(r.json?.state, 'queued', 'state');
    await withSql(async sql => { const [j] = await sql`select state from public.publish_jobs where id = ${String(r.json?.job)}::uuid`; eq(j.state, 'queued', 'the job stays queued'); });
    eq((await fake.recorded()).github.length, 0, 'nothing was sent');
  } finally { if (token) Deno.env.set('GITHUB_DISPATCH_TOKEN', token); if (v2) Deno.env.set('GITHUB_DISPATCH_TOKEN_V2', v2); }
});

t('publish: when GitHub refuses, the job stays queued and the answer says dispatched: false with the status', async () => {
  await fake.reset(); await fake.githubStatus(500);
  try {
    const team = await teamRows();
    const v = await saveRow('owner-a', 'team', team.one, fullTeam('Agent One', 'agent-one'));
    const r = await publish('owner-a', { site: SITE_A, rows: [team.one], versions: [v.version] });
    eq(r.status, 202, 'status'); eq(r.json?.dispatched, false, 'dispatched'); eq(r.json?.reason, 'github 500', 'reason');
  } finally { await fake.reset(); }
});

t('publish: an item that is not ready is 422 and every problem carries its row id; no job is made', async () => {
  const team = await teamRows();
  const before = await withSql(async sql => (await sql`select count(*)::int as n from public.publish_jobs`)[0].n);
  const r = await publish('owner-a', { site: SITE_A, rows: [team.two], versions: [1] });   // the seeded Agent Two has a name and nothing else
  eq(r.status, 422, 'status: ' + r.text);
  const problems = r.json?.problems as { code: string; path: string; row: string }[];
  assert(problems.some(p => p.code === 'I-REQUIRED' && p.row === team.two), 'I-REQUIRED with the row id: ' + r.text);
  eq(await withSql(async sql => (await sql`select count(*)::int as n from public.publish_jobs`)[0].n), before, 'no job was made');
});

t('publish: someone outside the workspace gets 404 (a login of nothing, and B\'s owner)', async () => {
  const team = await teamRows();
  const a = await publish('nobody', { site: SITE_A, rows: [team.one], versions: [1] });
  eq(a.status, 404, 'nobody');
  const b = await publish('owner-b', { site: SITE_A, rows: [team.one], versions: [1] });
  eq(b.status, 404, 'owner of B');
  const c = await publish('owner-a', { site: SITE_B, rows: [team.one], versions: [1] });
  eq(c.status, 404, 'owner of A on B\'s site');
  assert(!a.text.includes('team') && !a.text.includes('slug'), 'no field names to an outsider');
});

t('publish: a member publishes only their own item: agent one publishing agent two\'s row is 403 S-OWN-ONLY', async () => {
  const team = await teamRows();
  const v = await saveRow('owner-a', 'team', team.two, fullTeam('Agent Two', 'agent-two'));
  const r = await publish('member-a1', { site: SITE_A, rows: [team.two], versions: [v.version] });
  eq(r.status, 403, 'status: ' + r.text); eq(r.json?.code, 'S-OWN-ONLY', 'code');
});

t('publish: the body must be the PublishRequest: one version per row (400)', async () => {
  const team = await teamRows();
  const r = await publish('owner-a', { site: SITE_A, rows: [team.one, team.two], versions: [1] });
  eq(r.status, 400, 'status: ' + r.text);
  const r2 = await publish('owner-a', { site: 'x', rows: [], versions: [] });
  eq(r2.status, 400, 'empty');
});

t('publish: a suspended workspace publishes nothing (409 S-WORKSPACE-STATE)', async () => {
  const team = await teamRows();
  const v = await saveRow('owner-a', 'team', team.one, fullTeam('Agent One', 'agent-one'));
  const prev = await withSql(async sql => { const [w] = await sql`select state from public.workspaces where id = ${WS_A}::uuid`; await sql`update public.workspaces set state = 'suspended' where id = ${WS_A}::uuid`; return w.state; });
  try {
    const r = await publish('owner-a', { site: SITE_A, rows: [team.one], versions: [v.version] });
    eq(r.status, 409, 'status: ' + r.text); eq(r.json?.code, 'S-WORKSPACE-STATE', 'code');
  } finally { await withSql(sql => sql`update public.workspaces set state = ${prev}::public.workspace_state where id = ${WS_A}::uuid`); }
});

t('publish: a photo must be processed, rights-ticked and wide enough in the media RECORD (422), then it publishes (202)', async () => {
  await photoContract();
  await fake.reset();
  const team = await teamRows();
  const m = await mkMedia(WS_A, { width: null, processed: false });
  const v1 = await saveRow('owner-a', 'listings', null, { street: '9 Photo Close', status: 'for-sale', agent: team.one, photo: { asset: m, alt: 'The front of the house', width: 5000, exifStripped: true, rightsConfirmed: true } });
  const refused = await publish('owner-a', { site: SITE_A, rows: [v1.row], versions: [v1.version] });
  eq(refused.status, 422, 'not processed: ' + refused.text);
  const codes = (refused.json?.problems as { code: string }[]).map(p => p.code);
  assert(codes.includes('I-EXIF') && codes.includes('I-RIGHTS') && codes.includes('I-MEDIA-SIZE'), 'the record, not the row JSON, decides: ' + codes.join());
  await withSql(sql => sql`update public.media set width = 2400, processed = true, exif_stripped = true, rights_confirmed = true where id = ${m}::uuid`);
  const ok = await publish('owner-a', { site: SITE_A, rows: [v1.row], versions: [v1.version] });
  eq(ok.status, 202, 'processed: ' + ok.text); eq(ok.json?.dispatched, true, 'dispatched');
});
