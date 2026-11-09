// Helpers for the runner function tests (slice 4.3): a signed call the way the build runner makes it, a publish job started in SQL the way
// service.start_publish is called with owner-a's claims, and a reading of what the fake Storage was asked to sign.
import { sign } from '../_shared/signature.ts';
import { env, SITE_A, SUB, withSql, type Answer, type Handle } from './util.ts';

export type RunnerOpts = {
  method?: 'GET' | 'POST';
  query?: string;                    // "?job=<id>"
  body?: unknown;                    // an object (sent as JSON) for a POST
  raw?: string;                      // an exact body text, when the test wants it not to be JSON
  key?: string;                      // the key to sign with (default: the run's RUNNER_KEY)
  t?: number;                        // the signed time (default: now)
  unsigned?: boolean;                // send no signature header at all
  header?: string;                   // send this exact header value
  signedBody?: string;               // sign THIS text instead of the body that is sent
  signedPath?: string;               // sign this path (with its query) instead of the one that is called
  prefix?: string;                   // "/functions/v1" as the gateway may present it
};

export async function callRunner(handle: Handle, name: string, o: RunnerOpts = {}): Promise<Answer> {
  const method = o.method ?? 'GET';
  const query = o.query ?? '';
  const text = method === 'POST' ? (o.raw ?? JSON.stringify(o.body ?? {})) : '';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!o.unsigned) headers['x-runner-signature'] = o.header ?? await sign(o.key ?? env('RUNNER_KEY'), method, o.signedPath ?? `/${name}${query}`, o.signedBody ?? text, o.t);
  const res = await handle(new Request(`http://localhost${o.prefix ?? ''}/${name}${query}`, { method, headers, body: method === 'GET' ? undefined : text }));
  const body = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(body); } catch { /* 204 or not JSON */ }
  return { status: res.status, json, text: body };
}

/** A publish job of site A for these rows at these versions, started the way the dashboard's publish does (owner-a's claims), without the GitHub dispatch. */
export async function startJob(rows: string[], versions: number[], site: string = SITE_A): Promise<string> {
  return await withSql(async sql => {
    const claims = { sub: SUB['owner-a'], aal: 'aal1', role: 'authenticated', email: 'owner-a@test' };
    const [r] = await sql`select service.start_publish(${claims}::jsonb, ${site}::uuid, ${rows}::uuid[], ${versions}::int[]) as job`;
    return r.job as string;
  });
}

export async function jobState(job: string): Promise<{ state: string; events: string[]; gate: unknown; deploy: string | null; error: string | null }> {
  return await withSql(async sql => {
    const [j] = await sql`select state::text as state, gate_report, deploy_id, error from public.publish_jobs where id = ${job}::uuid`;
    const ev = await sql`select state::text as state from public.publish_job_events where job_id = ${job}::uuid order by at`;
    return { state: j.state, events: ev.map((e: { state: string }) => e.state), gate: j.gate_report, deploy: j.deploy_id, error: j.error };
  });
}

export async function publishedVersion(row: string): Promise<number | null> {
  return await withSql(async sql => { const [r] = await sql`select published_version from public.content_rows where id = ${row}::uuid`; return r.published_version; });
}

type Recorded = { signed: { path: string; authorized: boolean; expiresIn: number | null }[]; storage: { path: string; authorized: boolean; upsert: string | null }[]; maxInflight: number };
export const storageLog = async (): Promise<Recorded> => await (await fetch(`${env('TEST_FAKE_BASE')}/__recorded`)).json();
export const storageBehaviour = async (fail: string, delayMs: number) => { await (await fetch(`${env('TEST_FAKE_BASE')}/__sign?fail=${encodeURIComponent(fail)}&delay=${delayMs}`, { method: 'POST' })).text(); };

/** a security event of the runner's bad-signature kind, counted by function */
export async function runnerEvents(fn: string): Promise<number> {
  return await withSql(async sql => {
    // events, not rows (migration 20): n of every bucket of this function; the runner marks its first event's detail kind = 'runner'
    const [r] = await sql`select coalesce(sum(c.n), 0)::int as n from public.security_event_counts c join public.security_events e on e.id = c.event_id
      where c.kind = 'bad-signature' and c.code = 'SIGNATURE' and c.fn = ${fn} and e.detail ->> 'kind' = 'runner'`;
    return r.n;
  });
}
