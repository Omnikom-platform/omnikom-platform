// KNOWN-6: staging applied some of migrations 15 to 20 out of file order. This proves that order is harmless: two fresh local
// clusters take the 42 migrations staging applied (every file numbered 52 or lower), one in file-name order and one with the window
// 15..20 in the order supabase/ops/order-exceptions.json records, and their schema and data dumps must be the same.
// supabase/ops/promote-check.mjs excuses the recorded rows only while this file is a gate line in CI. No account, no network.
//   node supabase/ops/test/order-proof.test.mjs              the proof
//   node supabase/ops/test/order-proof.test.mjs --mutants    the proof, then two DEPENDENT files swapped: the comparison must go red
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startCluster, SUPABASE_DIR } from './cluster.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXCEPTIONS = resolve(HERE, '..', 'order-exceptions.json');
const MIGRATIONS = join(SUPABASE_DIR, 'migrations');
const number = name => Number(name.slice(8, 14));   // yyyymmdd then the six digit migration number

// Columns whose value is set while applying (now(), a random id), as 'schema.table.column': none of the 42 files writes one into a row.
const MASK = {};

// local Postgres has no pg_cron: the stand-in of supabase/tests/run-local.mjs, so every cron.schedule call lands in a table that is compared
const CRON_STUB = `create schema cron;
create table cron.stub_jobs (jobname text primary key, schedule text not null, command text not null);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as
  $$ insert into cron.stub_jobs values (job_name, schedule, command) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;
`;
// the ledger as supabase/apply-staging.mjs creates it (its schema, ops, is the one thing left out of the dumps)
const LEDGER = `create schema if not exists ops;
create table if not exists ops.platform_migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now());
revoke all on schema ops from public; revoke all on ops.platform_migrations from public;`;

class ApplyError extends Error {}

function run(cmd, args, input) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 600000, windowsHide: true, input, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: r.stdout || '', err: String(r.stderr || (r.error && r.error.message) || '') };
}

// ONE file, exactly as supabase/apply-staging.mjs applies it: its own transaction with the ledger row, or none when marked
function applyOne(c, name) {
  const text = readFileSync(join(MIGRATIONS, name), 'utf8');
  const noTx = /^\s*--\s*no-transaction\s*$/m.test((text.match(/^(?:[ \t\r]*(?:--[^\n]*)?\n)*/) || [''])[0]);
  const row = `insert into ops.platform_migrations (name, sha256) values ('${name}', '${createHash('sha256').update(text).digest('hex')}');\n`;
  const r = run('psql', [c.url, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-f', '-'], noTx ? `${text}\n;\n${row}` : `begin;\n${text}\n${row}commit;\n`);
  if (r.code !== 0) throw new ApplyError(`${name} did not apply: ${r.err.split(/\r?\n/).filter(l => /ERROR/.test(l)).slice(0, 2).join(' | ')}`);
}

function dump(c, what) {
  const r = run('pg_dump', [c.url, what, '--exclude-schema=ops']);
  if (r.code !== 0) throw new Error(`pg_dump ${what} failed: ${r.err.trim()}`);
  // newer pg_dump wraps its output in \restrict <random key>: the one part of a dump that differs run to run
  return r.out.split(/\r?\n/).filter(l => !/^\\(un)?restrict /.test(l));
}

// the data dump as sets of rows (a table has no order of its own), masked columns blanked
function dataLines(lines) {
  const out = [];
  let tables = 0;
  for (let i = 0; i < lines.length; i++) {
    const head = /^COPY (\S+) \((.*)\) FROM stdin;$/.exec(lines[i]);
    out.push(lines[i]);
    if (!head) continue;
    tables++;
    const cols = head[2].split(', ');
    const rows = [];
    for (i++; i < lines.length && lines[i] !== '\\.'; i++) {
      rows.push(lines[i].split('\t').map((v, k) => (MASK[`${head[1]}.${cols[k]}`] && v !== '\\N' ? '<masked>' : v)).join('\t'));
    }
    out.push(...rows.sort(), '\\.');
  }
  return { lines: out, tables };
}

function build(label, order) {
  const c = startCluster(label);
  try {
    c.file(join(SUPABASE_DIR, 'tests', 'local-shim.sql'));
    const stub = join(c.dir, 'cron-stub.sql');
    writeFileSync(stub, CRON_STUB);
    c.file(stub);
    c.sql(LEDGER);
    for (const name of order) applyOne(c, name);
    return { schema: dump(c, '--schema-only'), data: dataLines(dump(c, '--data-only')) };
  } finally { c.stop(); }
}

// null when equal, else the first differing lines of each side
function diff(what, a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const side = (mark, x) => x.slice(i, i + 4).map((l, k) => `${mark} ${i + k + 1}: ${l.slice(0, 200)}`).join('\n');
    return `${what} differs (file order <, other order >), first at line ${i + 1}:\n${side('<', a)}\n${side('>', b)}`;
  }
  return null;
}
const compare = (a, b) => [diff('schema', a.schema, b.schema), diff('data', a.data.lines, b.data.lines)].filter(Boolean);

let exit = 0;
try {
  if (!existsSync(EXCEPTIONS)) throw new Error('supabase/ops/order-exceptions.json is missing: there is no recorded order to prove');
  const ex = JSON.parse(readFileSync(EXCEPTIONS, 'utf8'));
  const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort().filter(f => number(f) <= 52);
  if (files.length !== 42) throw new Error(`staging applied 42 files numbered 52 or lower, the repository has ${files.length}`);
  const window = files.filter(f => number(f) >= 15 && number(f) <= 20);
  if (JSON.stringify([...ex.appliedOrder].sort()) !== JSON.stringify(window)) throw new Error('appliedOrder must hold exactly the six files 15 to 20');
  const rows = Object.keys(ex.rows);
  if (!rows.length || rows.some(n => !ex.appliedOrder.includes(n))) throw new Error('every excused row must be one of appliedOrder');
  const times = ex.appliedOrder.filter(n => rows.includes(n)).map(n => ex.rows[n]);
  // one shape and one offset (+00), so the text order is the time order, to the microsecond
  if (times.some((t, i) => !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{6}\+00$/.test(t) || (i && !(times[i - 1] < t)))) throw new Error(`appliedOrder does not follow the recorded times: ${times.join(' , ')}`);

  const start = files.indexOf(window[0]);
  const other = [...files.slice(0, start), ...ex.appliedOrder, ...files.slice(start + window.length)];
  const a = build('known6-file-order', files);
  const b = build('known6-applied-order', other);
  const red = compare(a, b);
  if (red.length) { console.log(`${red.join('\n')}\nORDER PROOF FAILED: the two orders do not give the same database`); exit = 1; }
  else console.log(`ORDER PROOF OK: schema identical, data identical (${a.data.tables} tables)`);

  if (process.argv.includes('--mutants') && !exit) {
    // 42 and 47 both "create or replace" service.export_bundle and no later file does: whichever runs later wins, so swapped the
    // function differs. (A pair that a later file redefines, such as 18 and 22 for service.lead_list, leaves no trace: seen 2026-11-26.)
    const [x, y] = [42, 47].map(n => other.findIndex(f => number(f) === n));
    const swapped = [...other];
    [swapped[x], swapped[y]] = [other[y], other[x]];
    let why = [];
    try { why = compare(a, build('known6-mutant', swapped)); } catch (e) { if (!(e instanceof ApplyError)) throw e; why = [e.message]; }
    if (why.length) console.log(`caught  ${other[x]} swapped with ${other[y]}:\n${why[0]}\nORDER PROOF MUTANTS: 1 of 1 caught`);
    else { console.log(`MISSED  ${other[x]} swapped with ${other[y]}: still identical\nORDER PROOF MUTANTS: 0 of 1 caught`); exit = 1; }
  }
} catch (e) {
  console.log(`ORDER PROOF FAILED: ${e.message}`);
  exit = 1;
}
process.exit(exit);
