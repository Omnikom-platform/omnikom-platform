// apply: a thin wrapper over supabase/apply-staging.mjs, run as a child process with the target's connection string in ITS
// environment (by name); its output is parsed into data and passed through the redaction like everything else.
// test walls: supabase/tests/tenancy.test.sql run by this program in a namespace of its own (lib/walls.mjs); run-staging.mjs
// stays the platform's script and is no longer called from here.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoPath } from '../lib/repo.mjs';
import { Blocked, Usage } from '../lib/errors.mjs';
import { result, fromSql } from '../lib/ctx.mjs';
import { pgEnv } from '../lib/sql.mjs';
import { PERSONS } from '../lib/identity.mjs';
import { mapNamespace, unmappedLiterals, complete, siteFingerprintSql, fingerprintDiff, diffLine, namespaceCountSql, failureLines, FINGERPRINT_TABLES } from '../lib/walls.mjs';
import { WS_A, WS_B, SITE_A, SITE_B, LOGINS } from './seed.mjs';
import { journeyGroup } from './journey.mjs';

const firstLine = s => String(s || '').trim().split(/\r?\n/)[0].slice(0, 300);

function childEnv(ctx, target, production) {
  return production ? { ...ctx.env, PROD_DB_URL: target.dbUrl } : { ...ctx.env, STAGING_DB_URL: target.dbUrl };
}

export async function apply(ctx) {
  const target = ctx.target();
  const production = target.name === 'production';
  const args = [repoPath('supabase', 'apply-staging.mjs')];
  if (ctx.flags['dry-run']) args.push('--dry-run');
  if (production) args.push('--url-env', 'PROD_DB_URL', '--i-mean-production');
  const r = ctx.spawn(process.execPath, args, { encoding: 'utf8', env: childEnv(ctx, target, production), timeout: 600000 });
  const lines = String(r.stdout || '').split(/\r?\n/).filter(Boolean);
  if (r.status === 2) throw new Blocked(`apply-staging refused: ${firstLine(r.stderr)}`, 'see the message');
  const applied = lines.filter(l => l.startsWith('apply ')).map(l => l.slice(6));
  const skipped = lines.filter(l => l.startsWith('skip ')).map(l => l.slice(6).replace(/ \(applied\)$/, ''));
  const wouldApply = lines.filter(l => l.startsWith('would apply ')).map(l => l.slice(12));
  const summary = lines[lines.length - 1] || '';
  if (r.status !== 0) return result(false, 'APPLY-FAILED', { applied, skipped, error: firstLine(r.stderr) || summary });
  return result(true, 'ok', { dryRun: Boolean(ctx.flags['dry-run']), applied, skipped, wouldApply, summary });
}

// test walls: tenancy.test.sql run in a namespace of this run (lib/walls.mjs maps every fixture literal of the file, in memory), on a
// database that may hold the test site. The test site is fingerprinted before and after and must not change; the run's own rows must
// be 0 after (the file's transaction rolls back). The copy lives in a temp file for the length of the psql run only.
export async function testWalls(ctx) {
  const target = ctx.target();
  const original = readFileSync(repoPath('supabase', 'tests', 'tenancy.test.sql'), 'utf8');
  const run = ctx.randomUUID().replace(/-/g, '').slice(0, 10);
  const mapped = mapNamespace(original, { run, newUuid: ctx.randomUUID });
  const unmapped = unmappedLiterals(original, mapped.text);
  if (unmapped.length) {
    return result(false, 'WALLS-UNMAPPED', { run, count: unmapped.length, left: unmapped.slice(0, 20), error: `${unmapped.length} fixture literal(s) of tenancy.test.sql are still in the namespaced copy; nothing was run` });
  }

  const sql = ctx.sql();
  const fpSql = siteFingerprintSql({ workspaces: [WS_A, WS_B], sites: [SITE_A, SITE_B], users: LOGINS.map(n => PERSONS[n].sub) });
  const before = sql.rows(fpSql);
  if (!before.ok) return fromSql(before);
  if (!complete(before.rows)) return result(false, 'WALLS-FINGERPRINT', { error: `the test site fingerprint did not name all ${FINGERPRINT_TABLES.length} tables; nothing was run`, got: JSON.stringify(before.rows).slice(0, 200) });
  const present = sql.scalar(namespaceCountSql(run));
  if (!present.ok) return fromSql(present);
  if (Number(present.value) !== 0) throw new Blocked(`the namespace walls-${run} already holds ${present.value} row(s)`, 'run it again (a new namespace is made every run)');

  // a temp file, deleted on every path: psql stops reading at its first error, and on stdin that cut the pipe and lost the error text
  const tmp = mkdtempSync(join(tmpdir(), 'omnikom-walls-'));
  let r;
  try {
    const file = join(tmp, 'tenancy.namespaced.sql');
    writeFileSync(file, mapped.text);
    r = ctx.spawn('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', file], {
      encoding: 'utf8', env: { ...ctx.env, ...pgEnv(target.dbUrl) }, timeout: 600000, maxBuffer: 64 * 1024 * 1024,
    });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  const passed = !r.error && r.status === 0 && /ALL TENANCY TESTS PASSED/.test(r.stdout || '');

  const after = sql.rows(fpSql);
  if (!after.ok) return fromSql(after);
  if (!complete(after.rows)) return result(false, 'WALLS-FINGERPRINT', { error: `the test site fingerprint after the run did not name all ${FINGERPRINT_TABLES.length} tables`, got: JSON.stringify(after.rows).slice(0, 200) });
  const left = sql.scalar(namespaceCountSql(run));
  if (!left.ok) return fromSql(left);
  const diff = fingerprintDiff(before.rows, after.rows);
  const nsLeft = Number(left.value);

  const ns = `walls-${run}`;
  const lines = [];
  const why = [...(r.error ? [`psql: ${r.error.code || r.error.message}`] : []), ...failureLines(`${r.stdout || ''}\n${r.stderr || ''}`)];
  if (!passed && !why.length) why.push(`psql exited ${r.status}: ${firstLine(r.stderr) || firstLine(r.stdout) || 'no output'}`);
  lines.push(passed ? `PASS tenancy tests (isolated namespace ${ns})` : `FAIL tenancy tests (isolated namespace ${ns})${why.length ? ':' : ''}`, ...(passed ? [] : why));
  if (diff.length) lines.push(...diff.map(diffLine));
  else lines.push(`PASS test site unchanged (${FINGERPRINT_TABLES.length} tables compared)`);
  lines.push(nsLeft === 0 ? 'OK: 0 rows of the run left' : `FAIL: ${nsLeft} row(s) of the run left`);

  const data = { lines, namespace: ns, tablesCompared: FINGERPRINT_TABLES.length, rowsPerTable: Object.fromEntries(after.rows.map(x => [x.tbl, x.n])), mapped: { uuids: mapped.uuids.size, slugs: mapped.slugs, emails: mapped.emails } };
  if (passed && !diff.length && nsLeft === 0) return result(true, 'ok', data);
  const code = !passed ? 'WALLS-FAILED' : diff.length ? 'SITE-CHANGED' : 'NAMESPACE-LEFT';
  return result(false, code, { ...data, error: lines.find(l => l.startsWith('FAIL')) });
}

export function testGroup(ctx) {
  const verb = ctx.positionals[1];
  if (verb === 'walls') return testWalls(ctx);
  if (verb === 'journey') return journeyGroup(ctx);
  throw new Usage('test <walls|journey>');
}
