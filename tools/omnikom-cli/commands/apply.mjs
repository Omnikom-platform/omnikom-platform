// apply and test walls: thin wrappers over the existing staff scripts (supabase/apply-staging.mjs and
// supabase/tests/run-staging.mjs). They are run as child processes with the target's connection string in THEIR environment
// (by name); their output is parsed into data and passed through the redaction like everything else.
import { repoPath } from '../lib/repo.mjs';
import { Blocked, Usage } from '../lib/errors.mjs';
import { result } from '../lib/ctx.mjs';

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

export async function testWalls(ctx) {
  const target = ctx.target();
  const r = ctx.spawn(process.execPath, [repoPath('supabase', 'tests', 'run-staging.mjs')], { encoding: 'utf8', env: childEnv(ctx, target, false), timeout: 600000 });
  const lines = String(r.stdout || '').split(/\r?\n/).filter(Boolean);
  if (r.status === 2) throw new Blocked(`run-staging refused: ${firstLine(r.stderr)}`, 'see the message');
  const passed = r.status === 0 && lines.some(l => l.startsWith('PASS tenancy tests'));
  if (passed) return result(true, 'ok', { lines });
  const leftovers = /already holds \d+ test fixture/.test(r.stderr || '');
  return result(false, leftovers ? 'FIXTURES-PRESENT' : 'WALLS-FAILED', {
    lines, error: firstLine(r.stderr), hint: leftovers ? 'run: omnikom seed test --clean (the walls test needs a database without the seeded test fixtures)' : undefined,
  });
}

export function testGroup(ctx) {
  const verb = ctx.positionals[1];
  if (verb === 'walls') return testWalls(ctx);
  throw new Usage('test <walls>');
}
