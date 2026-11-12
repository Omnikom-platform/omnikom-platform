// prove-retention: the staging proof of work order 46's purge (migration 28, product row E12). On the seeded test workspace only, it
// writes, for each table that has a retention period, one row older than the period and one younger (marked with this run's tag),
// calls service.purge_expired once (as the role the migrations were applied with, which is how pg_cron runs it), reads back what is
// left and the retention-purge audit row, removes the young rows it may remove, and prints per table "kept <n> deleted <n>", the audit
// row and a last line PASS or FAIL.
//   node tools/with-env.mjs "<env file>" -- node supabase/ops/prove-retention.mjs --target staging [--dry-run]
// The database URL is read from STAGING_DB_URL only, by name, and never printed (promote-check.mjs's round trip); no option names
// another database, --target must be staging, and a STAGING_DB_URL equal to PROD_DB_URL is refused. --dry-run makes one read-only
// transaction (the test workspace, migration 28, the rows already past their period) and prints the rows it would write.
// The test workspace is test-demo-a, made by `omnikom seed test` (tools/omnikom-cli/commands/seed.mjs: its id at line 22, its slug at
// line 218); the run stops before writing anything when that id and slug are not one workspace there.
// What a run leaves: the purge deletes every row past its period, the test rows and any others (what the daily job does anyway). The
// young test rows of webhook_events, security_event_counts and messages are deleted again. audit_log and security_events are
// append-only (the wall the purge passes only for a row past its period), so their young test rows are made one hour under the period
// and go with the first daily purge after it.
// Exit 0 PASS, 1 FAIL (a precondition missing: nothing written), 2 refused or the database could not be reached.
import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { psqlReadOnly } from './promote-check.mjs';

const WS = 'aaaaaaaa-0000-0000-0000-000000000000';   // seed.mjs WS_A
const SLUG = 'test-demo-a';
const BATCH = 5000;                                     // purge_expired's default batch (migration 28)
const WSL = `'${WS}'::uuid`;
// one entry per retention rule; `past` mirrors the purge's own condition for the rule (migration 28, service.purge_expired)
const RULES = [
  { rule: 'audit_log', table: 'audit_log', short: 'audit', col: 'action', time: 'at', appendOnly: true,
    insert: (tag, at) => `insert into public.audit_log (workspace_id, action, target, at) values (${WSL}, '${tag}', 'prove-retention', ${at});` },
  { rule: 'messages', table: 'messages', short: 'msg', col: 'template', time: 'created_at',
    insert: (tag, at) => `insert into public.messages (workspace_id, channel, template, to_text, created_at) values (${WSL}, 'email', '${tag}', 'prove-retention@test', ${at});` },
  { rule: 'security_event_counts', table: 'security_event_counts', short: 'counts', col: 'kind', time: 'last_at',
    insert: (tag, at) => `insert into public.security_event_counts (kind, workspace_id, minute, event_id, last_at) values ('${tag}', ${WSL}, date_trunc('minute', ${at}), 0, ${at});` },
  { rule: 'security_events', table: 'security_events', short: 'events', col: 'code', time: 'at', appendOnly: true,
    insert: (tag, at) => `insert into public.security_events (kind, code, workspace_id, at) values ('refused', '${tag}', ${WSL}, ${at});` },
  { rule: 'webhook_events', table: 'webhook_events', short: 'done', col: 'kind', time: 'received_at', extra: 'processed_at is not null and error is null',
    insert: (tag, at) => `insert into public.webhook_events (workspace_id, kind, received_at, processed_at) values (${WSL}, '${tag}', ${at}, ${at});` },
  { rule: 'webhook_events.unprocessed', table: 'webhook_events', short: 'open', col: 'kind', time: 'received_at', extra: '(processed_at is null or error is not null)',
    insert: (tag, at) => `insert into public.webhook_events (workspace_id, kind, received_at) values (${WSL}, '${tag}', ${at});` },
];
const keep = rule => `(select r.keep_days from public.retention_rules r where r.table_name = '${rule}')`;
const atOf = (rule, side) => (side === 'old' ? `now() - make_interval(days => ${keep(rule)} + 1)` : `now() - make_interval(days => ${keep(rule)}) + interval '1 hour'`);
const past = r => `${r.time} < now() - make_interval(days => ${keep(r.rule)})${r.extra ? ` and ${r.extra}` : ''}`;
const tagOf = (run, r, side) => `${run}-${r.short}-${side}`;
const known = RULES.map(r => `'${r.rule}'`).join(', ');

const GUARD = `set client_min_messages = warning;
do $g$ begin
  if to_regclass('public.retention_rules') is null or to_regprocedure('service.purge_expired(integer)') is null then
    raise exception 'P-NO-MIGRATION-28: retention_rules or service.purge_expired is missing here';
  end if;
  if not exists (select 1 from public.workspaces where id = ${WSL} and slug = '${SLUG}') then
    raise exception 'P-NO-TEST-WORKSPACE: the seeded test workspace ${SLUG} is not here (omnikom seed test makes it)';
  end if;
  if (select count(*) from public.retention_rules where keep_days is not null and table_name in (${known})) <> ${RULES.length}
     or exists (select 1 from public.retention_rules where keep_days is not null and table_name not in (${known})) then
    raise exception 'P-RULES: the retention rules with a period are not the ${RULES.length} this proof knows';
  end if;
end $g$;
select 'PRE ' || json_build_object('periods', (select json_object_agg(table_name, keep_days) from public.retention_rules where keep_days is not null),
  'past', json_build_object(${RULES.map(r => `'${r.rule}', (select count(*) from public.${r.table} where ${past(r)})`).join(', ')}))::text;`;

const writeSql = run => `${GUARD}
${RULES.flatMap(r => ['old', 'young'].map(side => r.insert(tagOf(run, r, side), atOf(r.rule, side)))).join('\n')}
select 'RUN ' || service.purge_expired()::text;
select 'AUDIT ' || coalesce((select max(a.id)::text from public.audit_log a where a.action = 'retention-purge' and a.at = now()), 'none');`;

const readSql = (run, auditId) => `select json_build_object(
  'audit', (select json_build_object('id', a.id, 'at', a.at, 'action', a.action, 'workspace_id', a.workspace_id, 'actor', a.actor, 'target', a.target, 'detail', a.detail)
            from public.audit_log a where a.id = ${auditId}),
  'left', json_build_object(${RULES.map(r => `'${r.rule}', json_build_object(${['old', 'young'].map(side =>
    `'${side}', (select count(*) from public.${r.table} where workspace_id = ${WSL} and ${r.col} = '${tagOf(run, r, side)}')`).join(', ')})`).join(',\n    ')}))::text;`;

const cleanSql = run => {
  const del = RULES.filter(r => !r.appendOnly);
  return `${del.map((r, i) => `${i ? ', ' : 'with '}d${i} as (delete from public.${r.table} where workspace_id = ${WSL} and ${r.col} in ('${tagOf(run, r, 'old')}', '${tagOf(run, r, 'young')}') returning 1)`).join('')}
select 'GONE ' || json_build_object(${del.map((r, i) => `'${r.rule}', (select count(*) from d${i})`).join(', ')})::text;`;
};

// the same round trip as promote-check's helper (its psql arguments, time limit, and the URL and password kept out of any error),
// with a writable transaction: its spawn is handed one that opens the transaction with "begin" instead of "begin read only"
const writable = (cmd, args, opts) => spawnSync(cmd, args, { ...opts, input: String(opts.input).replace(/^begin read only;\n/, 'begin;\n') });
const psqlWrite = (url, sql) => psqlReadOnly(url, sql, writable);

const lines = out => Object.fromEntries(String(out).split(/\r?\n/).map(l => l.match(/^(PRE|RUN|AUDIT|GONE) (.*)$/)).filter(Boolean).map(m => [m[1], m[2]]));

export function main(argv, env = process.env, log = console.log, err = console.error, db = { read: psqlReadOnly, write: psqlWrite }) {
  const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  if (opt('--target') !== 'staging') { err('refused: --target staging is required (this proof runs on staging only, never anywhere else)'); return 2; }
  const url = env.STAGING_DB_URL;
  if (!url) { err('set STAGING_DB_URL (the staging database URL; read by name, never printed)'); return 2; }
  if (env.PROD_DB_URL && env.PROD_DB_URL === url) { err('refused: STAGING_DB_URL is the same as PROD_DB_URL'); return 2; }
  const stop = e => {
    const m = String(e && e.message || e);
    if (/P-[A-Z0-9-]+:/.test(m)) { log(`FAIL: ${m.match(/P-[A-Z0-9-]+:.*/)[0]} (nothing was written)`); return 1; }
    err(`cannot work on STAGING_DB_URL: ${m}`); return 2;
  };
  const run = `prove-retention-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;

  if (argv.includes('--dry-run')) {
    let pre;
    try { pre = JSON.parse(lines(db.read(url, GUARD)).PRE); } catch (e) { return stop(e); }
    log(`DRY RUN: nothing is written. The test workspace ${SLUG} and migration 28 are here; periods ${JSON.stringify(pre.periods)}; rows already past their period ${JSON.stringify(pre.past)}`);
    for (const r of RULES) for (const side of ['old', 'young']) {
      log(`would write ${r.table} ${r.col} = ${tagOf(run, r, side)}, ${r.time} = ${side === 'old' ? 'one day past' : 'one hour under'} the ${r.rule} period (${pre.periods[r.rule]} days)`);
    }
    log(`would call service.purge_expired() once (batch ${BATCH}), read back the test rows and the retention-purge audit row, then delete the test rows of ${RULES.filter(r => !r.appendOnly).map(r => r.table).filter((t, i, a) => a.indexOf(t) === i).join(', ')}`);
    return 0;
  }

  let w;
  try { w = lines(db.write(url, writeSql(run))); } catch (e) { return stop(e); }
  const problems = [];
  let pre = { periods: {}, past: {} }, counts = {}, back = { audit: null, left: {} }, gone = null;
  try { pre = JSON.parse(w.PRE); counts = JSON.parse(w.RUN); } catch { problems.push('the run printed no counts (its PRE or RUN line is missing)'); }
  const auditId = w.AUDIT;
  if (!/^\d+$/.test(auditId || '')) problems.push('no retention-purge audit row was made by this run');
  try { back = JSON.parse(db.read(url, readSql(run, /^\d+$/.test(auditId || '') ? auditId : 'null'))); } catch (e) { problems.push(`the read-back failed: ${String(e.message || e)}`); }
  try { gone = JSON.parse(lines(db.write(url, cleanSql(run))).GONE); } catch (e) { problems.push(`removing the test rows failed: ${String(e.message || e)}`); }

  for (const r of RULES) {
    const p = Number(pre.past[r.rule]), d = Number(counts[r.rule]), left = back.left[r.rule] || {};
    log(`${r.rule}: kept ${left.young ?? '?'} deleted ${d} (period ${pre.periods[r.rule]} days; deleted = the test row past it and ${p} other row(s) already past it)`);
    if (left.old !== 0) problems.push(`${r.rule}: the test row past the period is still there (${left.old ?? '?'})`);
    if (left.young !== 1) problems.push(`${r.rule}: the test row under the period was not kept (${left.young ?? '?'})`);
    if (p + 1 > BATCH) problems.push(`${r.rule}: ${p} rows were already past the period, more than one batch of ${BATCH}; run again after the daily purge`);
    else if (d !== p + 1) problems.push(`${r.rule}: deleted ${d}, expected ${p + 1}`);
  }
  const a = back.audit;
  log(`audit row: ${a ? JSON.stringify(a) : 'none read back'}`);
  if (a) {
    const sameCounts = RULES.every(r => Number((a.detail && a.detail.deleted || {})[r.rule]) === Number(counts[r.rule]));
    if (a.action !== 'retention-purge' || a.workspace_id !== null || a.actor !== null) problems.push('the audit row is not a system retention-purge row (no workspace, no actor)');
    if (!sameCounts) problems.push(`the audit row's counts ${JSON.stringify(a.detail && a.detail.deleted)} differ from what the purge returned ${JSON.stringify(counts)}`);
  } else problems.push('the retention-purge audit row could not be read back');
  log(`test rows removed again: ${gone ? JSON.stringify(gone) : 'none (see above)'}; audit_log and security_events keep their young test rows (append-only) until the first daily purge after their period`);
  for (const p of problems) log(`  ${p}`);
  const total = RULES.reduce((s, r) => s + Number(counts[r.rule]), 0);
  log(problems.length
    ? `FAIL: ${problems.length} problem(s), the first: ${problems[0]}`
    : `PASS: one purge deleted exactly the rows past their periods (${RULES.length} test rows and ${total - RULES.length} other), kept the ${RULES.length} test rows under them, and wrote one retention-purge audit row with the same counts`);
  return problems.length ? 1 : 0;
}

if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exit(main(process.argv.slice(2)));
