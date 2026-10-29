// publish --as <person> --site <slug|uuid> --rows <uuid,uuid> [--versions 1,2]   start a publish job (service.start_publish):
//        the same checks as the publish function (every row in this site's workspace, members only their own items). Without
//        --versions each row is pinned at its latest version, as the publish function pins what it validated.
// job get --job <uuid> [--as <person>]            the job and its state events (as a person: row-level security applies)
// job wait --job <uuid> [--state done] [--timeout 30]   poll until the job reaches the state (or fails, or the time is up)
// job set --job <uuid> --state building|gating|deploying|done|failed [--error text]   stand-in for the build runner on the SQL
//        path: `building` freezes the snapshot (service.freeze_snapshot), the others call service.set_job_state.
import { Usage } from '../lib/errors.mjs';
import { need, needUuid, isUuid } from '../lib/args.mjs';
import { lit, uuidLit, jsonLit } from '../lib/sql.mjs';
import { result, fromSql } from '../lib/ctx.mjs';
import { parseIdentity, claimsFor } from '../lib/identity.mjs';

const STATES = ['queued', 'building', 'gating', 'deploying', 'done', 'failed'];
const TERMINAL = ['done', 'failed'];
const uuidList = (s, what) => {
  const list = String(s).split(',').map(x => x.trim()).filter(Boolean);
  if (!list.length || !list.every(isUuid)) throw new Usage(`${what} must be a comma-separated list of uuids`);
  return list;
};

export function publish(ctx) {
  const f = ctx.flags;
  const id = parseIdentity(f.as); claimsFor(id);
  const site = ctx.site(need(f, 'site'));
  const rows = uuidList(need(f, 'rows'), '--rows');
  let versions;
  if (f.versions) {
    versions = String(f.versions).split(',').map(Number);
    if (versions.length !== rows.length || !versions.every(n => Number.isInteger(n) && n >= 1)) throw new Usage('--versions needs one whole number per row');
  }
  const rowsSql = `array[${rows.map(uuidLit).join(',')}]`;
  const versionsSql = versions ? `array[${versions.join(',')}]::int[]`
    : `array(select (select max(n) from content_versions v where v.row_id = x.r) from unnest(${rowsSql}) with ordinality x(r, i) order by i)`;
  const r = ctx.sql().rows(`select service.start_publish(${jsonLit(claimsFor(id))}, ${uuidLit(site.id)}, ${rowsSql}, ${versionsSql}) as job`);
  if (!r.ok) return fromSql(r, { as: id.name });
  return result(true, 'ok', { as: id.name, job: r.rows[0].job, state: 'queued' });
}

const readJob = (ctx, job, identity) => {
  const claims = identity ? { claims: claimsFor(identity) } : {};
  const j = ctx.sql().rows(`select id, state, site_id, rows, requested, snapshot, gate_report, deploy_id, error, created_at, finished_at from publish_jobs where id = ${uuidLit(job)}`, claims);
  if (!j.ok || !j.rows.length) return { ...j, job: null };
  const e = ctx.sql().rows(`select state, at from publish_job_events where job_id = ${uuidLit(job)} order by at, state`, claims);
  return { ...j, job: j.rows[0], events: e.rows };
};

function jobGet(ctx) {
  const job = needUuid(ctx.flags, 'job');
  const identity = ctx.flags.as ? parseIdentity(ctx.flags.as) : null;
  const r = readJob(ctx, job, identity);
  if (!r.ok) return fromSql(r);
  if (!r.job) return result(false, 'S-NOT-FOUND', { error: 'not found' });
  return result(true, 'ok', { job: r.job, events: r.events });
}

async function jobWait(ctx) {
  const f = ctx.flags;
  const job = needUuid(f, 'job');
  const want = f.state || 'done';
  if (!STATES.includes(want)) throw new Usage(`--state must be one of ${STATES.join(', ')}`);
  const timeout = f.timeout ? Number(f.timeout) : 30;
  if (!(timeout >= 0)) throw new Usage('--timeout is in seconds');
  const identity = f.as ? parseIdentity(f.as) : null;
  const deadline = ctx.now() + timeout;
  for (;;) {
    const r = readJob(ctx, job, identity);
    if (!r.ok) return fromSql(r);
    if (!r.job) return result(false, 'S-NOT-FOUND', { error: 'not found' });
    const state = r.job.state;
    if (state === want) return result(true, 'ok', { job: job, state });
    if (TERMINAL.includes(state)) return result(false, 'JOB-' + state.toUpperCase(), { job, state, error: r.job.error });
    if (ctx.now() >= deadline) return result(false, 'TIMEOUT', { job, state, waitedSeconds: timeout });
    await ctx.sleep(1000);
  }
}

function jobSet(ctx) {
  const f = ctx.flags;
  const job = needUuid(f, 'job');
  const state = need(f, 'state');
  if (!STATES.includes(state) || state === 'queued') throw new Usage(`--state must be one of ${STATES.slice(1).join(', ')}`);
  const sql = state === 'building'
    ? `select service.freeze_snapshot(${uuidLit(job)});`
    : `select service.set_job_state(${uuidLit(job)}, ${lit(state)}::job_state, null, null, ${f.error ? lit(f.error) : 'null'});`;
  const r = ctx.sql().exec(sql);
  return fromSql(r, { job, state });
}

export function jobGroup(ctx) {
  const verb = ctx.positionals[1];
  if (verb === 'get') return jobGet(ctx);
  if (verb === 'wait') return jobWait(ctx);
  if (verb === 'set') return jobSet(ctx);
  throw new Usage('job <get|wait|set>');
}
