// alerts.mjs: the alerts of 11-OPERATIONS section 1 that our own tables can answer, one query each. It READS the database (a read only
// transaction), prints what an alert would send with the name of its runbook (section 2), and can write the status page's data file.
// SENDING: with --send --to-env <VARIABLE> each firing alert is one mail through Resend (RESEND_API_KEY, LEAD_ALERT_FROM, read by name) to the
// address held by that variable, once per alert and UTC day (Resend's idempotency key). No address and no key is printed.
//
//   node supabase/ops/alerts.mjs --db <VARIABLE> [--only <name,name>] [--json <file>] [--fail-on-alert] [--send --to-env <VARIABLE>]
//
//   --db            the NAME of the variable that holds the database URL (never the URL); read by name, never printed
//   --only          run only these alerts (names below)
//   --json <file>   write the status data for sites/omnikom-status/ (schema omnikom-status/1)
//   --fail-on-alert exit 1 when any alert fires (a red GitHub job is emailed to the repository's watchers)
//   --send          mail each firing alert: one POST to Resend per alert, a 10 s time limit, no retry; a line per mail and "sent: n of m"
//   --to-env        with --send (required): the NAME of the variable that holds the address to mail (never the address)
// Exit 0 the queries ran (alerts, if any, are printed and, with --send, mailed); 1 an alert fired and --fail-on-alert was given, a query
// failed, or a mail was not sent; 2 usage; 3 a variable is not set (BLOCKED; nothing sent).
//
// The alerts (name, runbook, the rule, where the rule comes from in 11-OPERATIONS section 1):
//   publish-failed-twice     R1  a site's last two finished publish jobs both failed            ("a job failed 2 times in a row for a site")
//   job-over-30-min          R1  a publish job not done or failed 30 minutes after it was made  ("any job > 30 min")
//   lead-push-failed         R5  a lead pushed to a CRM failed 4 times and was never pushed after (the 4 retries of 14-LEAD-PATH are spent)
//   no-leads-7-days          R4  a live site, older than 7 days, with no lead for 7 days       ("0 leads for a live site ... for 7 days"; the
//                                "with traffic" half cannot be checked: no analytics table exists yet, so this over-alerts quiet sites)
//   security-not-found-burst R2  one login got 10 or more S-NOT-FOUND refusals in the last hour ("many S-NOT-FOUND from one user")
//   security-staff-after-hours R2 a staff login acted outside Mon-Fri 07:00-19:00 US Pacific in the last `--since-minutes` (default 70)
//                                (the hours are an assumption: 11-OPERATIONS 4 says "business hours (US Pacific)" without the clock)
//   function-errors          R6  a function answered the same 5xx status 5 or more times in the last 60 minutes (function_errors, migration 32;
//                                the old spec's "2% for 10 min" needs a call count we do not keep, so the numbers are a choice)
//   table-over-budget        R7  a growing table is larger than its budget_mb in public.retention_rules (migration 46; 11-rules.md rule 12)
//   login-has-password       R2  a login in auth.users holds a password (the book: email magic link only, no passwords)
// Not answerable from our tables (each needs a source that does not exist yet, so none is faked): uptime of a site / the dashboard / the form
// endpoint, site quality gates, PSI speed, database CPU and slow queries.
// Alerts that hold on every run (a failed twice site stays failed) fire on every hourly run until fixed; with --send they are mailed once per
// alert and UTC day (a new item later that day waits for the next day's mail; the hourly output still shows it).
// Printed: names, short ids (8 characters), site deploy targets, workspace slugs, counts, platform codes. Never an email, a name, a lead row.
import { spawnSync } from 'node:child_process';
import { writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NAME_RE = /^[A-Z][A-Z0-9_]*$/;
export class Stop extends Error { constructor(code, message) { super(message); this.code = code; } }

export function pgEnv(url) {
  const u = new URL(url);
  const e = {};
  if (u.hostname) e.PGHOST = u.hostname.replace(/^\[|\]$/g, '');
  if (u.port) e.PGPORT = u.port;
  if (u.username) e.PGUSER = decodeURIComponent(u.username);
  if (u.password) e.PGPASSWORD = decodeURIComponent(u.password);
  const db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (db) e.PGDATABASE = db;
  const ssl = u.searchParams.get('sslmode');
  if (ssl) e.PGSSLMODE = ssl;
  return e;
}

// ---- the thresholds, in one place
export const RULES = { jobMinutes: 30, pushFails: 4, noLeadDays: 7, notFoundBurst: 10, burstMinutes: 60, businessStartHour: 7, businessEndHour: 19, businessZone: 'America/Los_Angeles', errorAnswers: 5, errorMinutes: 60 };

// Every query returns ONE jsonb array of small objects (only the fields the message needs). `since` is whole minutes.
export const ALERTS = [
  {
    name: 'publish-failed-twice', runbook: 'R1', component: 'publishing',
    sql: () => `select coalesce(jsonb_agg(jsonb_build_object('site', s.deploy_target, 'workspace', w.slug, 'jobs', x.jobs, 'last_error', x.err) order by s.deploy_target), '[]'::jsonb)
      from (select r.site_id, array_agg(left(r.id::text, 8) order by r.created_at desc) as jobs, (array_agg(left(coalesce(r.error, ''), 80) order by r.created_at desc))[1] as err
              from (select j.*, row_number() over (partition by j.site_id order by j.created_at desc, j.id) as rn from public.publish_jobs j where j.state in ('done', 'failed')) r
             where r.rn <= 2 group by r.site_id having count(*) = 2 and bool_and(r.state = 'failed')) x
      join public.sites s on s.id = x.site_id join public.workspaces w on w.id = s.workspace_id`,
    line: i => `site ${i.site} (${i.workspace}): the last 2 publish jobs failed (${i.jobs.join(', ')})${i.last_error ? `; last error: ${i.last_error}` : ''}`,
    fix: 'open the job\'s gate report; if the runner failed, re-run once, then check token expiry and the last factory change',
  },
  {
    name: 'job-over-30-min', runbook: 'R1', component: 'publishing',
    sql: () => `select coalesce(jsonb_agg(jsonb_build_object('site', s.deploy_target, 'job', left(j.id::text, 8), 'state', j.state, 'minutes', floor(extract(epoch from now() - j.created_at) / 60)::int) order by j.created_at), '[]'::jsonb)
      from public.publish_jobs j join public.sites s on s.id = j.site_id
     where j.state not in ('done', 'failed') and j.created_at < now() - interval '${RULES.jobMinutes} minutes'`,
    line: i => `job ${i.job} of site ${i.site} is still ${i.state} after ${i.minutes} minutes`,
    fix: 'open the GitHub run of the job; the previous deploy stays live, nothing to roll back',
  },
  {
    name: 'lead-push-failed', runbook: 'R5', component: 'forms',
    sql: () => `select coalesce(jsonb_agg(jsonb_build_object('lead', left(x.lead_id::text, 8), 'site', coalesce(s.deploy_target, '(no site)'), 'fails', x.fails, 'last_code', x.code) order by x.last_fail), '[]'::jsonb)
      from (select e.lead_id, count(*) filter (where e.kind = 'push-failed') as fails, max(e.at) filter (where e.kind = 'push-failed') as last_fail,
                   max(e.at) filter (where e.kind = 'pushed') as last_ok,
                   (array_agg(left(coalesce(e.detail ->> 'code', ''), 20) order by e.at desc) filter (where e.kind = 'push-failed'))[1] as code
              from public.lead_events e where e.kind in ('push-failed', 'pushed') group by e.lead_id) x
      join public.leads l on l.id = x.lead_id left join public.sites s on s.id = l.site_id
     where x.fails >= ${RULES.pushFails} and (x.last_ok is null or x.last_ok < x.last_fail)`,
    line: i => `lead ${i.lead} of site ${i.site}: the CRM push failed ${i.fails} times and was never pushed after${i.last_code ? ` (last code ${i.last_code})` : ''}`,
    fix: '401 means the CRM secret was rotated (ask the client); 5xx means their CRM is down; the lead is in the inbox either way',
  },
  {
    name: 'no-leads-7-days', runbook: 'R4', component: 'forms',
    sql: () => `select coalesce(jsonb_agg(jsonb_build_object('site', s.deploy_target, 'workspace', w.slug, 'days_live', floor(extract(epoch from now() - s.created_at) / 86400)::int) order by s.deploy_target), '[]'::jsonb)
      from public.sites s join public.workspaces w on w.id = s.workspace_id
     where s.state = 'live' and s.created_at < now() - interval '${RULES.noLeadDays} days'
       and not exists (select 1 from public.leads l where l.site_id = s.id and l.created_at > now() - interval '${RULES.noLeadDays} days')`,
    line: i => `site ${i.site} (${i.workspace}) is live and has had no lead for ${RULES.noLeadDays} days (site is ${i.days_live} days old; traffic is not checked)`,
    fix: 'send a test submission on a test form of the site; if it fails the form endpoint is down',
  },
  {
    name: 'security-not-found-burst', runbook: 'R2', component: null,
    sql: () => `select coalesce(jsonb_agg(jsonb_build_object('actor', left(x.actor::text, 8), 'refusals', x.n, 'workspaces', x.ws) order by x.n desc), '[]'::jsonb)
      from (select e.actor, count(*)::int as n, count(distinct e.workspace_id)::int as ws from public.security_events e
             where e.code = 'S-NOT-FOUND' and e.actor is not null and e.at > now() - interval '${RULES.burstMinutes} minutes'
             group by e.actor having count(*) >= ${RULES.notFoundBurst}) x`,
    line: i => `login ${i.actor} was refused ${i.refusals} times with S-NOT-FOUND in the last hour (${i.workspaces} workspace(s) asked for)`,
    fix: 'a person probing other tenants\' ids: preserve the evidence (security_events, function logs) and see R2 before anything else',
  },
  {
    name: 'security-staff-after-hours', runbook: 'R2', component: null,
    sql: ({ since }) => `select coalesce(jsonb_agg(jsonb_build_object('actor', left(x.actor::text, 8), 'actions', x.n, 'kinds', x.kinds) order by x.n desc), '[]'::jsonb)
      from (select a.actor, count(*)::int as n, (array_agg(distinct a.action))[1:5] as kinds from public.audit_log a
             where a.actor in (select user_id from public.staff) and a.at > now() - interval '${since} minutes'
               and (extract(isodow from a.at at time zone '${RULES.businessZone}') in (6, 7)
                    or extract(hour from a.at at time zone '${RULES.businessZone}') < ${RULES.businessStartHour}
                    or extract(hour from a.at at time zone '${RULES.businessZone}') >= ${RULES.businessEndHour})
             group by a.actor) x`,
    line: i => `staff login ${i.actor} acted ${i.actions} time(s) outside business hours (Mon-Fri ${String(RULES.businessStartHour).padStart(2, '0')}:00-${RULES.businessEndHour}:00 US Pacific): ${i.kinds.join(', ')}`,
    fix: 'ask the person; if nobody did it, treat it as a stolen login (rotate, see R2)',
  },
  {
    name: 'function-errors', runbook: 'R6', component: null,
    sql: () => `select coalesce(jsonb_agg(jsonb_build_object('fn', x.fn, 'status', x.status, 'answers', x.n, 'request', left(x.req::text, 8)) order by x.fn, x.status), '[]'::jsonb)
      from (select e.fn, e.status, sum(e.n)::int as n, (array_agg(e.last_request order by e.last_at desc))[1] as req from public.function_errors e
             where e.minute > now() - interval '${RULES.errorMinutes} minutes'
             group by e.fn, e.status having sum(e.n) >= ${RULES.errorAnswers}) x`,
    line: i => `function ${i.fn} answered ${i.status} ${i.answers} times in the last hour (newest request ${i.request})`,
    fix: 'search the function logs for the newest request id; a 500 CONFIG is a missing function secret',
  },
  {
    name: 'table-over-budget', runbook: 'R7', component: null,
    sql: () => `select service.over_budget()`,
    line: i => `table ${i.table} holds ${i.mb} MB, over its budget of ${i.budget_mb} MB (public.retention_rules, book row E12)`,
    fix: 'read the table\'s rule in public.retention_rules; give it a period with a purge, partition it, or raise its budget with the reason',
  },
  {
    name: 'login-has-password', runbook: 'R2', component: null,
    sql: () => `select coalesce(jsonb_agg(jsonb_build_object('login', left(u.id::text, 8)) order by u.id), '[]'::jsonb)
      from auth.users u
     where u.encrypted_password is not null and u.encrypted_password <> ''`,
    line: i => `login ${i.login} holds a password (the book says there are none: docs/product/6-dashboard.md)`,
    fix: 'the person signs in by link and needs no password: clear it (one update of auth.users, one login), then find how it was set (the Auth dashboard, a recovery mail, an older build)',
  },
];

export function parseArgs(argv) {
  const o = { db: null, only: null, json: null, failOnAlert: false, send: false, toEnv: null, since: 70 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Stop(2, `${a} needs a value`); return v; };
    if (a === '--db') o.db = val();
    else if (a === '--only') o.only = val().split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--json') o.json = val();
    else if (a === '--since-minutes') { o.since = Number(val()); }
    else if (a === '--fail-on-alert') o.failOnAlert = true;
    else if (a === '--send') o.send = true;
    else if (a === '--to-env') o.toEnv = val();
    else throw new Stop(2, `unknown argument ${a}`);
  }
  if (o.send && (!o.toEnv || !NAME_RE.test(o.toEnv))) throw new Stop(2, '--send needs --to-env <VARIABLE>: the variable that holds the address (read by name)');
  if (!o.db) throw new Stop(2, 'usage: alerts.mjs --db <VARIABLE> [--only a,b] [--json file] [--fail-on-alert]   (the variable NAME, not the URL)');
  if (!NAME_RE.test(o.db)) throw new Stop(2, '--db takes the NAME of a variable (upper case letters, digits, underscore), not a URL');
  if (!Number.isInteger(o.since) || o.since < 1 || o.since > 1440) throw new Stop(2, '--since-minutes is a whole number from 1 to 1440');
  if (o.only) for (const n of o.only) if (!ALERTS.some(a => a.name === n)) throw new Stop(2, `unknown alert "${n}" (known: ${ALERTS.map(a => a.name).join(', ')})`);
  return o;
}

// run the chosen queries in ONE read only transaction; returns Map name -> array of items
export function runQueries(url, alerts, { since = 70, spawn = spawnSync } = {}) {
  const script = ['begin transaction read only;', ...alerts.map(a => `select '${a.name}' || '|' || (${a.sql({ since }).replace(/;\s*$/, '')})::text;`), 'commit;'].join('\n');
  const r = spawn('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { env: { ...process.env, ...pgEnv(url) }, input: script, encoding: 'utf8', timeout: 120000, windowsHide: true });
  if (r.error) throw new Stop(1, `could not run psql: ${r.error.code || r.error.message}`);
  if (r.status !== 0) {
    const line = String(r.stderr || '').split(/\r?\n/).find(l => /ERROR:|could not|connection|password|timeout/i.test(l)) || 'psql failed';
    let msg = line.replace(/^psql:[^:]*:\d+: /, '');
    for (const s of [url, pgEnv(url).PGPASSWORD, pgEnv(url).PGHOST].filter(x => x && x.length >= 4)) msg = msg.split(s).join('***');
    throw new Stop(1, `a query failed: ${msg.slice(0, 200)}`);
  }
  const out = new Map();
  for (const l of String(r.stdout).split(/\r?\n/)) {
    const m = /^([a-z0-9-]+)\|(\[.*\])$/.exec(l.trim());
    if (m) out.set(m[1], JSON.parse(m[2]));
  }
  for (const a of alerts) if (!out.has(a.name)) throw new Stop(1, `the query of ${a.name} gave no answer`);
  return out;
}

export function render(alert, items) {
  if (!items.length) return [`quiet  ${alert.name}`];
  const lines = [`ALERT  ${alert.name}  (runbook ${alert.runbook}, 11-OPERATIONS section 2)`];
  for (const i of items) lines.push(`         ${alert.line(i)}`);
  lines.push(`         first step: ${alert.fix}.`);
  return lines;
}

// the data the status page reads: one line per component with its last check time. A component none of our tables can measure says so.
export const environmentOf = db => (db === 'STAGING_DB_URL' ? 'staging' : db === 'PROD_DB_URL' ? 'production' : String(db).toLowerCase());
export function statusData(results, now = new Date(), environment = 'unknown') {
  const at = now.toISOString().replace(/\.\d+Z$/, 'Z');
  const of = c => ALERTS.filter(a => a.component === c && results.has(a.name));
  const state = (c, okNote, badNote, noneNote) => {
    const list = of(c);
    if (!list.length) return { status: 'unknown', checked_at: null, note: noneNote };
    const fired = list.filter(a => results.get(a.name).length);
    return fired.length ? { status: 'degraded', checked_at: at, note: `${badNote}: ${fired.map(a => a.name).join(', ')}` } : { status: 'operational', checked_at: at, note: okNote };
  };
  return {
    schema: 'omnikom-status/1',
    environment,
    generated_at: at,
    components: [
      { id: 'dashboard', name: 'Dashboard', status: 'unknown', checked_at: null, note: 'not measured yet: an external uptime checker does not exist' },
      { id: 'forms', name: "Client sites' forms", ...state('forms', 'no lead push is stuck and no live site has been silent for 7 days (this is not a live form test)', 'needs a look', 'not measured in this run') },
      { id: 'publishing', name: 'Publishing', ...state('publishing', 'no site has two failed publishes in a row and no job is stuck', 'needs a look', 'not measured in this run') },
    ],
  };
}

export function main(argv, env = process.env, deps = {}) {
  const out = [];
  try {
    const o = parseArgs(argv);
    const url = env[o.db];
    if (!url) throw new Stop(3, `${o.db} is not set (read by name)`);
    try { new URL(url); } catch { throw new Stop(3, `${o.db} is not a connection URL`); }
    if (o.send) {
      const missing = ['RESEND_API_KEY', 'LEAD_ALERT_FROM', o.toEnv].filter(n => !env[n]);
      if (missing.length) throw new Stop(3, `${missing.join(', ')} not set (read by name); nothing sent`);
    }
    const chosen = ALERTS.filter(a => !o.only || o.only.includes(a.name));
    const results = runQueries(url, chosen, { since: o.since, spawn: deps.spawn });
    let fired = 0;
    for (const a of chosen) { const items = results.get(a.name); if (items.length) fired++; out.push(...render(a, items)); }
    out.push(`alerts: ${chosen.length} checked, ${fired} firing, ${chosen.length - fired} quiet.${o.send ? '' : ' Nothing sent (no --send).'}`);
    if (o.json) { writeFileSync(o.json, JSON.stringify(statusData(results, new Date(), environmentOf(o.db)), null, 2) + '\n'); out.push(`status data written to ${o.json}`); }
    const send = o.send ? { toEnv: o.toEnv, environment: environmentOf(o.db), firing: chosen.filter(a => results.get(a.name).length).map(a => ({ alert: a, items: results.get(a.name) })) } : null;
    return { exit: fired && o.failOnAlert ? 1 : 0, lines: out, results, send };
  } catch (e) {
    if (!(e instanceof Stop)) { out.push(`alerts crashed: ${e && e.message}`); return { exit: 1, lines: out }; }
    out.push(`${e.code === 3 ? 'BLOCKED' : e.code === 2 ? 'usage' : 'alerts failed'}: ${e.message}`);
    return { exit: e.code, lines: out };
  }
}

// D: one mail per firing alert through Resend. The idempotency key is the environment, the alert and the UTC day: Resend answers a repeated key
// without sending (resend.com/docs/dashboard/emails/idempotency-keys), so an alert that holds all day is one mail. No retry; no address is printed.
export async function deliver(r, env, fetchImpl = fetch, now = new Date(), timeoutMs = 10000) {
  let ok = 0, failed = 0;
  for (const { alert, items } of r.send.firing) {
    const key = `alerts-${r.send.environment}-${alert.name}-${now.toISOString().slice(0, 10)}`;
    try {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify({ from: env.LEAD_ALERT_FROM, to: env[r.send.toEnv], subject: `[${r.send.environment}] ${alert.name} (runbook ${alert.runbook})`, text: render(alert, items).join('\n') }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      // 409 invalid_idempotent_request: today's key was used already (the body changed since), so this alert was mailed today; no retry
      const before = res.status === 409 && (await res.json().catch(() => null))?.name === 'invalid_idempotent_request';
      if (res.ok) { ok++; r.lines.push(`sent    ${alert.name} to ${r.send.toEnv}`); }
      else if (before) { ok++; r.lines.push(`sent before ${alert.name}: already mailed today under today's key; no new mail`); }
      else { failed++; r.lines.push(`FAILED  send ${alert.name}: resend ${res.status}`); }
    } catch (e) {
      failed++;
      r.lines.push(`FAILED  send ${alert.name}: ${e && e.name === 'TimeoutError' ? 'no answer in 10 s' : 'resend unreachable'}`);
    }
  }
  r.lines.push(`sent: ${ok} of ${r.send.firing.length}`);
  return failed ? 1 : 0;
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isMain()) {
  const r = main(process.argv.slice(2));
  if (r.send) r.exit = Math.max(r.exit, await deliver(r, process.env));
  for (const l of r.lines) (r.results ? console.log : console.error)(l);
  process.exit(r.exit);
}
