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

// The names `[functions.<name>]` whose table says `enabled = false` in supabase/config.toml. A small reader for that one key (no TOML
// dependency): a table header starts a section, a key line `enabled = false` inside a functions section disables that name.
export function disabledFunctions(configText) {
  const off = new Set();
  let current = null;
  for (const raw of String(configText || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const table = /^\[(.+)\]$/.exec(line);
    if (table) { const m = /^functions\.("?)([A-Za-z0-9_-]+)\1$/.exec(table[1].trim()); current = m ? m[2] : null; continue; }
    if (current && /^enabled\s*=\s*false$/.test(line)) off.add(current);
  }
  return off;
}

// A folder under supabase/functions/ is a function only when it holds an index.ts (`_shared` and folders like `test`, which hold only
// helpers and tests, are not). A function that config.toml disables is listed as disabled, never as "not deployed".
// -> [{ name, disabled }] sorted by name
export function listFunctions(functionsDir, configText) {
  if (!existsSync(functionsDir)) return [];
  const off = disabledFunctions(configText);
  return readdirSync(functionsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(functionsDir, d.name, 'index.ts')))
    .map(d => ({ name: d.name, disabled: off.has(d.name) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function functionNames() {
  const cfg = repoPath('supabase', 'config.toml');
  return listFunctions(repoPath('supabase', 'functions'), existsSync(cfg) ? readFileSync(cfg, 'utf8') : '');
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
    for (const { name, disabled } of functionNames()) {
      if (disabled) { out[name] = 'disabled'; continue; }
      const r = await callFunction({ base: target.functionsBase, name, body: '{}', fetchImpl: ctx.fetch, timeoutMs: 15000 });
      out[name] = r.status === 0 ? 'unreachable' : (r.status === 404 && r.json && r.json.code === 'NOT_FOUND') ? 'not deployed' : 'deployed';
    }
    functions = { checked: true, ...out };
  }

  // the database role the Edge Functions step down to (migration 8); a missing role is shown, not a failure: a project that has not
  // had migration 8 yet is not broken by `status`. pg_roles is cluster-wide and readable by anyone, so this works read-only.
  const roleRow = sql.scalar("exists (select 1 from pg_roles where rolname = 'omnikom_fn')");
  const functionRole = roleRow.ok && roleRow.value === true;

  const ok = mismatched.length === 0;
  return result(ok, ok ? 'ok' : 'MIGRATION-HASH', {
    reachable: true, ledger: hasLedger.value ? 'present' : 'missing',
    functionRole, functionRoleLine: `function role omnikom_fn: ${functionRole ? 'present' : 'MISSING'}`,
    migrations: { onDisk: disk.length, inLedger: ledger.length, applied, pending, mismatched, unknownInDatabase: unknown },
    functions, keys,
  });
}
