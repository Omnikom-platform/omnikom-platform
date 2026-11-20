// SEC-REPLAY: a verified signature is accepted once (migration 53). Each case sends ONE header twice (callRunner takes the header as given).
import { handle as exportPublished } from '../export-published/index.ts'; import { handle as jobCallback } from '../job-callback/index.ts';
import { connect } from '../_shared/db.ts'; import { sign } from '../_shared/signature.ts';
import { env, eq, securityEvents, teamRows, t, withSql } from './util.ts'; import { callRunner, jobState, runnerEvents, startJob } from './runner-util.ts';
const now = () => Math.floor(Date.now() / 1000), hdr = (method: 'GET' | 'POST', path: string, body: string, at: number) => sign(env('RUNNER_KEY'), method, path, body, at);
const newJob = async () => await startJob([(await teamRows()).two], [1]);
const exportWith = (job: string, header: string) => callRunner(exportPublished, 'export-published', { query: `?job=${job}`, header });
const finish = (job: string) => callRunner(jobCallback, 'job-callback', { method: 'POST', body: { job, state: 'failed', error: 'test cleanup', gateReport: { reason: 'test cleanup' } } });

t('replay [SEC-REPLAY] (control) one request signed in two different seconds is two signatures: both are taken', async () => {
  const job = await newJob(), T = now();
  try {
    const a = await exportWith(job, await hdr('GET', '/export-published?job=' + job, '', T));
    const b = await exportWith(job, await hdr('GET', '/export-published?job=' + job, '', T + 1));
    eq(a.status, 200, 'first second: ' + a.text); eq(b.status, 200, 'next second: ' + b.text);
  } finally { await finish(job); }
});

t('replay [SEC-REPLAY] the runner frame: a signed GET sent twice is 200 then 401 REPLAY, one event of that code, and the job is as the first call left it', async () => {
  const job = await newJob(), h = await hdr('GET', '/export-published?job=' + job, '', now() + 2);
  try {
    const before = await securityEvents({ code: 'REPLAY' });
    const a = await exportWith(job, h), b = await exportWith(job, h);
    eq(a.status, 200, 'first copy: ' + a.text); eq(b.status, 401, 'second copy: ' + b.text); eq(b.json?.code, 'REPLAY', 'the code');
    eq((await securityEvents({ code: 'REPLAY' })) - before, 1, 'one event of code REPLAY');
    eq((await jobState(job)).events.join(), 'queued,building', 'the job is as the first call left it');
  } finally { await finish(job); }
});

t('replay [SEC-REPLAY] the runner frame: a signed POST callback sent twice is 204 then 401 REPLAY, not the state machine\'s 409', async () => {
  const job = await newJob(), body = { job, state: 'building' }, header = await hdr('POST', '/job-callback', JSON.stringify(body), now());
  try {
    const a = await callRunner(jobCallback, 'job-callback', { method: 'POST', body, header });
    const b = await callRunner(jobCallback, 'job-callback', { method: 'POST', body, header });
    eq(a.status, 204, 'first copy: ' + a.text); eq(b.status, 401, 'second copy: ' + b.text); eq(b.json?.code, 'REPLAY', 'the code');
    eq((await jobState(job)).events.join(), 'queued,building', 'one transition');
  } finally { await finish(job); }
});

t('replay [SEC-REPLAY] the claim is the signature value, not the header text: the same signature with zeros in front of t is a replay', async () => {
  const job = await newJob(), h = await hdr('GET', '/export-published?job=' + job, '', now() + 3), padded = h.replace(/^t=/, 't=00');
  try {
    const a = await exportWith(job, h), b = await exportWith(job, padded);
    eq(a.status, 200, 'the header: ' + a.text); eq(b.status, 401, 'the padded copy: ' + b.text); eq(b.json?.code, 'REPLAY', 'the code');
  } finally { await finish(job); }
});

t('replay [SEC-REPLAY] claimSignature: of two copies sent together exactly one wins in each of five rounds; a header with no 64-hex v1, and no header, are never taken', async () => {
  const { claimSignature } = await import('../_shared/db.ts') as unknown as { claimSignature: (sql: unknown, header: string | null) => Promise<boolean> };
  const a = await connect(), b = await connect();
  try {
    for (let i = 0; i < 5; i++) {
      const h = `t=${now()},v1=${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
      eq((await Promise.all([claimSignature(a, h), claimSignature(b, h)])).sort().join(), 'false,true', 'round ' + i);
    }
    eq(await claimSignature(a, 't=1,v1=00'), false, 'a v1 that is not 64 hex'); eq(await claimSignature(a, null), false, 'no header');
  } finally { await a.end({ timeout: 2 }); await b.end({ timeout: 2 }); }
});

t('replay [SEC-REPLAY] the claim store failing is a 500 and nothing is taken on trust', async () => {
  const job = await newJob(), path = '/export-published?job=' + job;
  const rename = (from: string, to: string) => withSql(async sql => { await sql.unsafe(`do $$ begin if to_regprocedure('service.${from}(text)') is not null then alter function service.${from}(text) rename to ${to}; end if; end $$`); });
  await rename('claim_signature', 'claim_signature_off');
  try {
    const a = await exportWith(job, await hdr('GET', path, '', now() + 4));
    eq(a.status, 500, 'the claim store is down: ' + a.text);
    eq((await jobState(job)).state, 'queued', 'nothing was read or changed');
  } finally { await rename('claim_signature_off', 'claim_signature'); await finish(job); }
});

// CI 43663036477: more than 10 anonymous bad-signature buckets in one minute fold the next into an overflow bucket whose event row carries no detail kind, so a counter that joins on it read 0
t('replay [SEC-REPLAY] the counter of the runner tests still sees a refusal that folded into the overflow bucket of a full minute', async () => {
  const id = crypto.randomUUID();
  await withSql(async sql => {
    for (let i = 0; i < 12; i++) await sql`select service.record_security_event('bad-signature', 'FILL', null, null, null, ${'fill-' + i}, ${{ fn: 'fill' }}::jsonb)`;
    await sql`delete from public.security_event_counts where kind = 'bad-signature' and code = 'SIGNATURE' and fn = 'export-published' and minute = date_trunc('minute', now())`;
  });
  const before = await runnerEvents('export-published');
  const a = await callRunner(exportPublished, 'export-published', { query: `?job=${id}`, unsigned: true });
  eq(a.status, 401, 'unsigned: ' + a.text);
  eq((await runnerEvents('export-published')) - before, 1, 'the refusal is counted although it folded into the overflow bucket');
});

const claimRows = () => withSql(async sql => (await sql`select count(*)::int as n from private.signature_seen`)[0].n as number);

t('replay [SEC-REPLAY] a signature that does not verify (wrong key, or outside the 300 s window) is answered 401 SIGNATURE and leaves no claim', async () => {
  const id = crypto.randomUUID(), path = '/export-published?job=' + id, before = await claimRows();
  const wrong = await exportWith(id, await sign('not-the-runner-key', 'GET', path, '', now() + 5));
  eq(wrong.status, 401, 'wrong key: ' + wrong.text); eq(wrong.json?.code, 'SIGNATURE', 'wrong key: the code');
  const old = await exportWith(id, await hdr('GET', path, '', now() - 400));
  eq(old.status, 401, 'outside the window: ' + old.text); eq(old.json?.code, 'SIGNATURE', 'outside the window: the code');
  eq(await claimRows(), before, 'no claim was taken by a call that did not verify');
});

// ---- round 2 (five gaps a fresh reviewer found) ----
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), b => b.toString(16).padStart(2, '0')).join('');

t('replay [SEC-REPLAY] the runner frame: the replay event carries the caller\'s address hash (the hash the first call would have had)', async () => {
  const job = await newJob(), ip = '203.0.113.' + (1 + Math.floor(Math.random() * 250)), want = await sha('export-published:' + ip);
  const h = await hdr('GET', '/export-published?job=' + job, '', now() + 6), headers = { 'cf-connecting-ip': ip };
  // more than 10 anonymous buckets of one kind in a minute fold into an overflow bucket with no address (the test above fills it): start this minute empty
  await withSql(sql => sql`delete from public.security_event_counts where kind = 'bad-signature' and minute = date_trunc('minute', now())`);
  try {
    const a = await callRunner(exportPublished, 'export-published', { query: `?job=${job}`, header: h, headers });
    const b = await callRunner(exportPublished, 'export-published', { query: `?job=${job}`, header: h, headers });
    eq(a.status, 200, 'first copy: ' + a.text); eq(b.json?.code, 'REPLAY', 'second copy: ' + b.text);
    const rows = await withSql(sql => sql`select ip_hash from public.security_events where code = 'REPLAY' and ip_hash = ${want}`) as unknown[];
    eq(rows.length, 1, 'one REPLAY event row carries the hash of the caller');
  } finally { await finish(job); }
});

t('replay [SEC-REPLAY] the runner frame: a signed call whose body the frame refuses (400) spends no signature: the same call again is 400 again, never REPLAY, and no claim row is left', async () => {
  // the signature covers the body, so "the same header with a correct body" cannot be built: the test is that a 400 leaves no claim row
  const job = await newJob(), body = [1, 2], text = JSON.stringify(body), h = await hdr('POST', '/job-callback', text, now() + 7), before = await claimRows();
  try {
    const a = await callRunner(jobCallback, 'job-callback', { method: 'POST', raw: text, header: h });
    const b = await callRunner(jobCallback, 'job-callback', { method: 'POST', raw: text, header: h });
    eq(a.status, 400, 'first: ' + a.text); eq(b.status, 400, 'again: ' + b.text); eq(b.json?.code, 'BODY', 'the same refusal, not REPLAY');
    eq(await claimRows(), before, 'a refused body took no claim');
  } finally { await finish(job); }
});

t('replay [SEC-REPLAY] the claim outlives the signature window by at least the window plus a minute: both numbers read from their source files', async () => {
  const sig = await Deno.readTextFile(new URL('../_shared/signature.ts', import.meta.url));
  const mig = await Deno.readTextFile(new URL('../../migrations/20261120000053_signature_once.sql', import.meta.url));
  const win = Number(/const WINDOW_SECONDS = (\d+);/.exec(sig)?.[1]), life = Number(/now\(\) \+ interval '(\d+) minutes'/.exec(mig)?.[1]) * 60;
  eq(Number.isFinite(win) && win > 0, true, 'the window constant was found'); eq(Number.isFinite(life) && life > 0, true, 'the claim life was found');
  eq(life >= 2 * win + 60, true, `a signature lives ${2 * win} s (the window each way); its claim must live at least ${2 * win + 60} s, it lives ${life} s`);
});
