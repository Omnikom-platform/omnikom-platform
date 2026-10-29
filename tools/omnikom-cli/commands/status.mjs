// status: is the project reachable, which migrations are applied (the platform_migrations ledger vs the files on disk), which
// functions answer, which keys are present BY NAME (never a value). Read-only: the connection itself is opened read-only, which
// is why it is the one command that is allowed against production.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { repoPath } from '../lib/repo.mjs';
import { keyPresence } from '../lib/target.mjs';
import { callFunction } from '../lib/fn.mjs';
import { result } from '../lib/ctx.mjs';

export function migrationsOnDisk() {
  const dir = repoPath('supabase', 'migrations');
  return readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    .map(f => ({ name: f, sha: createHash('sha256').update(readFileSync(join(dir, f), 'utf8')).digest('hex') }));
}

export function functionNames() {
  const dir = repoPath('supabase', 'functions');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('_')).map(d => d.name).sort();
}

export async function status(ctx) {
  const target = ctx.target();
  const sql = ctx.sql({ readOnly: true });
  const keys = keyPresence(target.name, ctx.env);
  const reach = sql.exec('select 1');
  if (!reach.ok) return result(false, 'CONNECT', { reachable: false, error: reach.message, keys });

  const disk = migrationsOnDisk();
  // the ledger lives in ops.platform_migrations (apply-staging.mjs, 2026-10-30); a project applied before that still has it in public
  const ledgerTable = sql.scalar("coalesce(to_regclass('ops.platform_migrations')::text, to_regclass('public.platform_migrations')::text)").value;
  const hasLedger = { value: Boolean(ledgerTable) };
  const ledger = ledgerTable ? sql.rows(`select name, sha256 from ${ledgerTable} order by name`).rows : [];
  const have = new Map(ledger.map(r => [r.name, r.sha256]));
  const applied = disk.filter(m => have.has(m.name) && have.get(m.name) === m.sha).map(m => m.name);
  const mismatched = disk.filter(m => have.has(m.name) && have.get(m.name) !== m.sha).map(m => m.name);
  const pending = disk.filter(m => !have.has(m.name)).map(m => m.name);
  const unknown = ledger.filter(r => !disk.some(m => m.name === r.name)).map(r => r.name);

  // functions: a function that is not deployed answers { code: 'NOT_FOUND' } from the gateway; anything else means it is there
  let functions;
  if (!target.functionsBase) functions = { checked: false, reason: 'no functions URL for this target (set the project ref, or LOCAL_FUNCTIONS_BASE)' };
  else {
    const out = {};
    for (const name of functionNames()) {
      const r = await callFunction({ base: target.functionsBase, name, body: '{}', fetchImpl: ctx.fetch, timeoutMs: 15000 });
      out[name] = r.status === 0 ? 'unreachable' : (r.status === 404 && r.json && r.json.code === 'NOT_FOUND') ? 'not deployed' : 'deployed';
    }
    functions = { checked: true, ...out };
  }

  const ok = mismatched.length === 0;
  return result(ok, ok ? 'ok' : 'MIGRATION-HASH', {
    reachable: true, ledger: hasLedger.value ? 'present' : 'missing',
    migrations: { applied, pending, mismatched, unknownInDatabase: unknown },
    functions, keys,
  });
}
