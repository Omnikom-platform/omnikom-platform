// Apply the platform's migrations to a Supabase project over a direct database connection, in file-name order, each one once.
//   STAGING_DB_URL=postgres://... node supabase/apply-staging.mjs [--dry-run] [--url-env NAME]
// The connection string is read from the environment by NAME only (default STAGING_DB_URL) and is never printed. Applied
// migrations are recorded in public.platform_migrations (name, sha256, applied_at); a file whose recorded hash differs from the
// file on disk stops the run (a migration is never edited after it was applied: write a new one). Each file runs in its own
// transaction (psql -1). Refuses a URL that equals PROD_DB_URL unless --url-env PROD_DB_URL is given on purpose, and then asks
// for --i-mean-production as well (DECISIONS 15: production receives only migrations already proven on staging).
// Proof: supabase/tests/test-apply.mjs (a throwaway local cluster: first run applies every file, second run applies none,
// an edited applied file is refused). Status on a real project: UNPROVEN until the owner's keys exist (W0.3).
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const after = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const urlEnv = after('--url-env') || 'STAGING_DB_URL';
const url = process.env[urlEnv];
if (!url) { console.error(`set ${urlEnv} (the project's connection string; it is read by name and never printed)`); process.exit(2); }
if (urlEnv !== 'PROD_DB_URL' && process.env.PROD_DB_URL && process.env.PROD_DB_URL === url) { console.error(`refusing: ${urlEnv} equals PROD_DB_URL`); process.exit(2); }
if (urlEnv === 'PROD_DB_URL' && !flag('--i-mean-production')) { console.error('refusing: production needs --i-mean-production (and the same migrations proven on staging first)'); process.exit(2); }
const dry = flag('--dry-run');

const psql = (args, input) => spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args], { encoding: 'utf8', timeout: 600000, input });
const fail = (msg, r) => { console.error(msg); if (r) console.error((r.stderr || '').replace(url, '<db url>').trim()); process.exit(1); };

// the ledger table (idempotent)
let r = psql(['-c', 'create table if not exists public.platform_migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now())']);
if (r.status !== 0) fail('could not reach the database or create the ledger', r);
r = psql(['-t', '-A', '-c', 'select name || \' \' || sha256 from public.platform_migrations order by name']);
if (r.status !== 0) fail('could not read the ledger', r);
const applied = new Map(r.stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => l.split(' ')));   // psql on Windows ends lines with CRLF

const files = readdirSync(join(HERE, 'migrations')).filter(f => f.endsWith('.sql')).sort();
let pending = 0, done = 0;
for (const f of files) {
  const text = readFileSync(join(HERE, 'migrations', f), 'utf8');
  const sha = createHash('sha256').update(text).digest('hex');
  if (applied.has(f)) {
    if (applied.get(f) !== sha) fail(`${f} was applied with a different content (hash ${applied.get(f).slice(0, 12)}, file ${sha.slice(0, 12)}): never edit an applied migration, write a new one`);
    console.log(`skip  ${f} (applied)`);
    continue;
  }
  pending++;
  if (dry) { console.log(`would apply ${f}`); continue; }
  // one transaction per file; the ledger row is written inside it, so a failed file leaves no record
  const body = `begin;\n${text}\ninsert into public.platform_migrations (name, sha256) values ('${f}', '${sha}');\ncommit;\n`;
  r = psql(['-f', '-'], body);
  if (r.status !== 0) fail(`FAILED ${f}: nothing of it was kept (the transaction rolled back)`, r);
  console.log(`apply ${f}`);
  done++;
}
console.log(dry ? `DRY RUN: ${pending} pending of ${files.length}` : `OK: applied ${done} of ${files.length} (${files.length - done} were already applied)`);
