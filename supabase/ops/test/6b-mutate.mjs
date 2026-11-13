// Mutation check for the 6B scripts (23-GROUND-RULES rule 10: a rule is a test with a mutant). Each mutant breaks ONE thing in a copy of
// backup.mjs, alerts.mjs or restore-drill.mjs, runs that script's test against the copy, and requires the test to go RED. The patch is
// asserted to apply (its target text must occur exactly once), so a mutant that silently changed nothing cannot "stay green" unnoticed.
// The real files are never touched. Exit 0 = every mutant was caught.
//   node supabase/ops/test/6b-mutate.mjs [--only backup|alerts|drill] [--filter <text in a mutant name>]
// The alerts mutants share ONE prepared database (a cluster with the real schema and the planted rows) instead of one cluster each.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCluster } from './6b-cluster.mjs';
import { applySchema, plant } from './6b-alerts-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OPS = resolve(HERE, '..');
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const ONLY = arg('--only'), FILTER = arg('--filter');

// [name, find (must occur once), replace]
const BACKUP = [
  ['signer: the signing key uses another region than the request', "const key = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), region), 's3'), 'aws4_request');", "const key = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), 'us-east-1'), 's3'), 'aws4_request');"],
  ['signer: the payload hash is not the body hash', "const payloadHash = body ? sha256hex(body) : sha256hex('');", "const payloadHash = sha256hex('');"],
  ['size check removed', 'if (got !== sealedBytes) throw', 'if (false) throw'],
  ['no retry: one attempt', 'for (let attempt = 1; attempt <= 3; attempt++) {', 'for (let attempt = 1; attempt <= 1; attempt++) {'],
  ['a 403 is retried like a 500', 'if (r.status < 500 && r.status !== 429) break;', ''],
  ['encryption is AES-128', "'-aes256'", "'-aes128'"],
  ['the plain dump is kept while uploading', '    rmSync(plain, { force: true });\n    if (c.status !== 0)', '    if (c.status !== 0)'],
  ['a private key in the recipient file is accepted', "if (/PRIVATE KEY/.test(text)) throw", "if (false) throw"],
  ['--db may be a URL', "if (!NAME_RE.test(o.db)) throw new Stop(2, '--db takes", "if (false) throw new Stop(2, '--db takes"],
  ['the secrets are not scrubbed from messages', "for (const v of list) t = t.split(v).join('***'); return t; };", "return t; };"],
  ['privileges are always dropped', "...(o.privileges ? [] : ['--no-privileges'])", "'--no-privileges'"],
  ['privileges are always kept', "...(o.privileges ? [] : ['--no-privileges'])", '...[]'],
  ['a missing variable is a plain failure, not BLOCKED', "throw new Stop(3, `missing variables (by name)", "throw new Stop(1, `missing variables (by name)"],
  ['a missing certificate is not reported as BLOCKED', 'if (!existsSync(path)) throw new Stop(3,', 'if (false) throw new Stop(3,'],
  ['the last target decides the exit (a failed copy is forgotten)', 'if (bad) { say(', 'if (false) { say('],
  ['media: an object that came short is kept', 'if (got.length !== size) bad++;', 'if (false) bad++;'],
  ['media: any STORAGE_API_BASE is taken', String.raw`!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw`, 'false) throw'],
  ['media: every bucket is copied', "where bucket_id = 'media';", 'where true;'],
  ['media: the plain media folder is kept while uploading', 'rmSync(mediaDir, { recursive: true, force: true });', ''],
  ['vault: the values are not copied', "'secret', decrypted_secret) order", "'secret', null) order"],
];

const ALERTS = [
  ['failed twice: bool_and becomes bool_or', 'bool_and(r.state = \'failed\')', 'bool_or(r.state = \'failed\')'],
  ['failed twice: a done job no longer counts as a finished job', "where j.state in ('done', 'failed')) r", "where j.state in ('failed')) r"],
  ['failed twice: one failure is enough', 'having count(*) = 2 and', 'having count(*) >= 1 and'],
  ['job over 30 minutes: the limit is 60', 'jobMinutes: 30', 'jobMinutes: 60'],
  ['job over 30 minutes: the limit is 20', 'jobMinutes: 30', 'jobMinutes: 20'],
  ['job over 30 minutes: finished jobs count too', "where j.state not in ('done', 'failed') and", 'where true and'],
  ['push failed: 5 failures needed', 'pushFails: 4', 'pushFails: 5'],
  ['push failed: 3 failures are enough', 'pushFails: 4', 'pushFails: 3'],
  ['push failed: a later success does not clear it', 'and (x.last_ok is null or x.last_ok < x.last_fail)', 'and (x.last_ok is null)'],
  ['push failed: every event counts as a failure', "count(*) filter (where e.kind = 'push-failed') as fails", 'count(*) as fails'],
  ['no leads: preview sites count', "where s.state = 'live' and s.created_at", "where s.state in ('live', 'preview') and s.created_at"],
  ['no leads: a young site counts', "and s.created_at < now() - interval '${RULES.noLeadDays} days'", ''],
  ['no leads: the window is 14 days', 'noLeadDays: 7', 'noLeadDays: 14'],
  ['burst: 9 refusals are enough', 'notFoundBurst: 10', 'notFoundBurst: 9'],
  ['burst: 11 refusals needed', 'notFoundBurst: 10', 'notFoundBurst: 11'],
  ['burst: refusals with no login are grouped and counted', "and e.actor is not null and", 'and'],
  ['burst: any code counts', "where e.code = 'S-NOT-FOUND' and", 'where true and'],
  ['burst: the window is two hours', 'burstMinutes: 60', 'burstMinutes: 120'],
  ['after hours: 19:00 sharp counts as in hours', ">= ${RULES.businessEndHour}", "> ${RULES.businessEndHour}"],
  ['after hours: 07:00 sharp counts as out of hours', "< ${RULES.businessStartHour}", "<= ${RULES.businessStartHour}"],
  ['after hours: weekends are working days', "in (6, 7)\n                    or", "in (0)\n                    or"],
  ['after hours: any login counts, not only staff', 'a.actor in (select user_id from public.staff) and', ''],
  ['read only transaction removed', "'begin transaction read only;', ", ''],
  ['the runbook name is not printed', '(runbook ${alert.runbook}, 11-OPERATIONS section 2)', '(11-OPERATIONS section 2)'],
  ['--fail-on-alert is ignored', 'exit: fired && o.failOnAlert ? 1 : 0', 'exit: 0'],
  ['an unreachable database leaks the password', "for (const s of [url, pgEnv(url).PGPASSWORD, pgEnv(url).PGHOST].filter(x => x && x.length >= 4)) msg = msg.split(s).join('***');", ''],
  ['status: the dashboard is claimed operational', "{ id: 'dashboard', name: 'Dashboard', status: 'unknown', checked_at: null,", "{ id: 'dashboard', name: 'Dashboard', status: 'operational', checked_at: at,"],
  ['status: a firing alert leaves the component operational', "return fired.length ? { status: 'degraded'", "return false ? { status: 'degraded'"],
  ['send: the idempotency key is missing', "'idempotency-key': key", "'x-none': key"],
  ['send: the mail goes to the sender', 'to: env[r.send.toEnv]', 'to: env.LEAD_ALERT_FROM'],
  ['send: a failed send exits 0', 'return failed ? 1 : 0;', 'return 0;'],
  ['send: no time limit', 'signal: AbortSignal.timeout(timeoutMs)', 'signal: undefined'],
  ['send: every 409 is taken as sent before', "const before = res.status === 409 && (await res.json().catch(() => null))?.name === 'invalid_idempotent_request';", 'const before = res.status === 409;'],
  ['function-errors: 4 answers are enough', 'errorAnswers: 5', 'errorAnswers: 4'],
  ['function-errors: the window is two hours', 'errorMinutes: 60', 'errorMinutes: 120'],
  ['budget: the alert asks nothing', "sql: () => `select service.over_budget()`,", "sql: () => `select '[]'::jsonb`,"],
];

const DRILL = [
  ['errors: every restore error is excused', 'expected: EXPECTED.test(msg) || EXPECTED.test(cmd) }', 'expected: true }'],
  ['errors: the schema "net" excuse matches any word', 'const EXPECTED = /\\b(pg_cron|pg_net|pgmq|supabase_vault)\\b|\\b(cron|vault|net|pgmq)\\.|', 'const EXPECTED = /\\b(pg_cron|pg_net|pgmq|supabase_vault)\\b|(cron|vault|net|pgmq)|'],
  ['counts: fewer rows than the source passes', 'if (r < b) fewer.push(`${t} ${r} of ${b}`);', 'if (false) fewer.push(`${t} ${r} of ${b}`);'],
  ['counts: a missing table passes', 'if (r === undefined) { fewer.push(`${t} missing`); continue; }', 'if (r === undefined) { continue; }'],
  ['counts: more rows than the source passes', 'else if (r > a) more.push(', 'else if (false) more.push('],
  ['roles: REVOKE lines are not read', '^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES)', '^(GRANT|ALTER DEFAULT PRIVILEGES)'],
  ['roles: postgres is created as a role',"for (const r of ['public', 'current_user', 'session_user', 'current_role', 'postgres']) found.delete(r);", ''],
  ['export: unprocessed media is shipped', 'const processed = (bundle.media || []).filter(m => m.processed === true);', 'const processed = (bundle.media || []);'],
  ['export: the 1600 slot is skipped', "typeof w === 'number' && w >= 1600 ? 1600 : 800", '800'],
  ['phases: a failed phase does not make the drill fail', 'if (!res.ok) failures.push(name);', ''],
  ['the walls phase passes whatever the tests say', 'const passed = r.status === 0 && /ALL TENANCY TESTS PASSED/.test(r.out);', 'const passed = true;'],
  ['the time limit is not enforced', 'if (total > o.limit * 60) failures.push(', 'if (false) failures.push('],
  ['--db may be a URL', "if (o.db && !NAME_RE.test(o.db)) throw", 'if (false) throw'],
  ['vault: an empty value counts as present', "typeof e.secret === 'string' && e.secret.length > 0", 'true'],
  ['vault: the gaps are never looked for', 'const gaps = vaultGaps(refs, entries);', 'const gaps = [];'],
  ['media: a file the copy lacks is taken from the copy anyway', 'return exists(p) ? p : null;', 'return p;'],
  ['--media and --vault without --dump are taken', 'if ((o.media || o.vault) && !o.dump) throw', 'if (false) throw'],
];

function runTest(testFile, envName, mutantPath, extraEnv = {}) {
  const r = spawnSync(process.execPath, [join(HERE, testFile)], { env: { ...process.env, [envName]: mutantPath, ...extraEnv }, encoding: 'utf8', timeout: 25 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const fails = out.split(/\r?\n/).filter(l => /^FAIL /.test(l)).map(l => l.slice(0, 150));
  return { status: r.status, fails, tail: out.trim().split(/\r?\n/).slice(-14).join(' / ').slice(0, 1500) };
}

const work = mkdtempSync(join(tmpdir(), 'omnikom-6b-mutants-'));
let escaped = 0, caught = 0, broken = 0;
function mutate(suite, file, testFile, envName, list, extraEnv) {
  const src = readFileSync(join(OPS, file), 'utf8');
  list.forEach(([name, find, replace], i) => {
    if (FILTER && !name.includes(FILTER)) return;
    const hits = src.split(find).length - 1;
    if (hits !== 1) { broken++; console.log(`BROKEN MUTANT ${suite}: ${name}: its target text occurs ${hits} times (needs exactly 1)`); return; }
    const path = join(work, `${suite}-${i}-${file}`);
    writeFileSync(path, src.replace(find, () => replace));
    const r = runTest(testFile, envName, path, typeof extraEnv === 'function' ? extraEnv() : extraEnv);
    if (r.status === 0) { escaped++; console.log(`ESCAPED ${suite}: ${name} (the test stayed green)`); }
    else if (r.fails.length) { caught++; console.log(`caught  ${suite}: ${name}\n          by: ${r.fails[0]}${r.fails.length > 1 ? ` (+${r.fails.length - 1} more)` : ''}`); }
    else { broken++; console.log(`UNCLEAR ${suite}: ${name}: exit ${r.status} with no FAIL line: ${r.tail}`); }
  });
}

let cluster = null;
try {
  if (!ONLY || ONLY === 'backup') mutate('backup', 'backup.mjs', 'backup.test.mjs', 'OMNIKOM_6B_BACKUP', BACKUP);
  if (!ONLY || ONLY === 'drill') mutate('drill', 'restore-drill.mjs', '6b-drill.test.mjs', 'OMNIKOM_6B_DRILL', DRILL, { OMNIKOM_6B_REPO: resolve(OPS, '..', '..') });
  if (!ONLY || ONLY === 'alerts') {
    cluster = startCluster({ label: '6b-mutants' });
    // The planted rows age with the clock (a job planted 25 minutes old is 30 after five minutes), so a database older than 3 minutes is replaced
    // by a freshly planted one: the planted margins are 5 minutes.
    let n = 0, plantedAt = 0, db = null;
    const fresh = () => {
      if (db && Date.now() - plantedAt < 3 * 60 * 1000) return { OMNIKOM_6B_ALERTS_URL: cluster.url(db) };
      db = `al${++n}`;
      cluster.createDb(db);
      const s = applySchema(cluster, db);
      if (!s.ok) throw new Error(`schema: ${s.err}`);
      plant(cluster, db);
      plantedAt = Date.now();
      return { OMNIKOM_6B_ALERTS_URL: cluster.url(db) };
    };
    mutate('alerts', 'alerts.mjs', 'alerts.test.mjs', 'OMNIKOM_6B_ALERTS', ALERTS, fresh);
  }
} finally {
  if (cluster) cluster.stop();
  rmSync(work, { recursive: true, force: true });
}
console.log(`mutants: ${caught} caught, ${escaped} escaped, ${broken} broken or unclear`);
process.exit(escaped || broken ? 1 : 0);
