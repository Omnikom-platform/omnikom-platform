// pg-facts: MEASURES the Postgres behaviour each lint rule rests on, on a throwaway local cluster (the CLI harness's startCluster).
//   node ~/.claude/scripts/heavy.mjs -- node tools/migration-lint/test/pg-facts.mjs        (a cluster: not part of the fast CI step)
// Table rewrite = the table's relfilenode changes; table scan = pg_stat seq_scan goes up; lock = pg_locks inside the statement's own
// transaction. Each line: `PASS|FAIL <fact> (observed: ...)`. Exit 1 on any FAIL. The server version is printed first: the book names
// Postgres 16 (CI), a local cluster may be newer, so a fact measured on 18 and not yet on 16 says so.
import { spawnSync } from 'node:child_process';
import { startCluster } from '../../omnikom-cli/test/harness.mjs';

const cluster = startCluster({ signals: true });
const base = ['-h', '127.0.0.1', '-p', String(cluster.port), '-U', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'];
const sh = (db, args, input) => spawnSync('psql', [...base, '-d', db, ...args], { encoding: 'utf8', input, timeout: 120000 });
const sql = (q, db = 'facts') => { const r = sh(db, ['-t', '-A', '-c', q]); if (r.status !== 0) throw new Error(`${q}\n${r.stderr}`); return r.stdout.trim(); };
const script = (text) => { const r = sh('facts', ['-t', '-A', '-f', '-'], text); return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr.trim() }; };
let failed = 0;
const fact = (name, ok, observed) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} (observed: ${observed})`); };

try {
  sql('create database facts', 'postgres');
  console.log(`server: ${sql('select version()').split(',')[0]}`);
  const fresh = () => { sql('drop table if exists t cascade; drop table if exists p cascade; create table p (id int primary key); insert into p select g from generate_series(1,50) g; create table t (id int primary key, a int not null, b text); insert into t select g, g, \'x\' from generate_series(1,50) g'); };
  const node = () => sql("select relfilenode from pg_class where relname='t'");
  const rewrites = ddl => { fresh(); const before = node(); sql(ddl); return node() !== before; };
  const scans = ddl => {
    fresh(); sql('select pg_stat_force_next_flush()');
    const n = () => Number(sql("select pg_stat_force_next_flush(); select seq_scan from pg_stat_user_tables where relname='t'").split('\n').pop());
    const before = n(); sql(ddl); return n() > before;
  };
  const lockOf = ddl => {   // the strongest lock this statement takes on t, read in its own transaction
    fresh();
    const r = script(`begin;\n${ddl};\nselect string_agg(distinct mode, ',' order by mode) from pg_locks where relation = 't'::regclass and pid = pg_backend_pid() and mode <> 'AccessShareLock';\nrollback;`);
    if (!r.ok) throw new Error(`${ddl}\n${r.err}`);
    return r.out.split('\n').filter(Boolean).pop();
  };

  // L5: which ADD COLUMN defaults rewrite
  fact('ADD COLUMN with a constant default does not rewrite (L5 must not flag it)', !rewrites('alter table t add column c int not null default 0'), 'relfilenode unchanged');
  fact('ADD COLUMN with default now() does not rewrite: now() is stable, so L5 must not flag it', !rewrites('alter table t add column c timestamptz not null default now()'), 'relfilenode unchanged');
  fact('ADD COLUMN with default current_timestamp does not rewrite', !rewrites('alter table t add column c timestamptz default current_timestamp'), 'relfilenode unchanged');
  fact('ADD COLUMN with default gen_random_uuid() rewrites (L5)', rewrites('alter table t add column c uuid default gen_random_uuid()'), 'relfilenode changed');
  fact('ADD COLUMN with default clock_timestamp() rewrites (L5)', rewrites('alter table t add column c timestamptz default clock_timestamp()'), 'relfilenode changed');
  fact('ADD COLUMN with default random() rewrites (L5)', rewrites('alter table t add column c float default random()'), 'relfilenode changed');
  fact('ADD COLUMN bigserial rewrites (L5)', rewrites('alter table t add column c bigserial'), 'relfilenode changed');
  fact('ADD COLUMN identity rewrites (L5)', rewrites('alter table t add column c int generated always as identity'), 'relfilenode changed');
  fact('ADD COLUMN stored generated rewrites (L5)', rewrites('alter table t add column c int generated always as (a + 1) stored'), 'relfilenode changed');
  // L4
  fact('ALTER COLUMN TYPE int to bigint rewrites (L4)', rewrites('alter table t alter column a type bigint'), 'relfilenode changed');
  // L2 / L3: scans
  fact('ADD CONSTRAINT CHECK scans the table (L2)', scans('alter table t add constraint c1 check (a > 0)'), 'seq_scan up');
  fact('ADD CONSTRAINT CHECK ... NOT VALID does not scan', !scans('alter table t add constraint c1 check (a > 0) not valid'), 'seq_scan unchanged');
  fact('ADD CONSTRAINT FOREIGN KEY scans (L2)', scans('alter table t add constraint f1 foreign key (a) references p (id)'), 'seq_scan up');
  fact('ADD CONSTRAINT FOREIGN KEY ... NOT VALID does not scan', !scans('alter table t add constraint f1 foreign key (a) references p (id) not valid'), 'seq_scan unchanged');
  fact('SET NOT NULL scans the table (L3)', scans('alter table t alter column b set not null'), 'seq_scan up');
  fact('SET NOT NULL with a VALIDATED check (b IS NOT NULL) does not scan (L3 safe path)', !(() => { fresh(); sql('alter table t add constraint nn check (b is not null) not valid; alter table t validate constraint nn'); sql('select pg_stat_force_next_flush()'); const n = () => Number(sql("select pg_stat_force_next_flush(); select seq_scan from pg_stat_user_tables where relname='t'").split('\n').pop()); const b = n(); sql('alter table t alter column b set not null'); return n() > b; })(), 'seq_scan unchanged');
  fact('ADD COLUMN with an inline CHECK on an existing table scans it (L2 variant)', scans('alter table t add column c int check (c > 0)'), 'seq_scan up');
  fact('ADD COLUMN with an inline REFERENCES on an existing table does NOT scan it (so it is not flagged)', !scans('alter table t add column c int references p (id)'), 'seq_scan unchanged');
  fact('ADD COLUMN with a plain default and no constraint does not scan (nothing to flag)', !scans('alter table t add column c int default 0'), 'seq_scan unchanged');
  // locks
  fact('CREATE INDEX holds ShareLock (blocks writes) (L1)', lockOf('create index on t (b)') === 'ShareLock', lockOf('create index on t (b)'));
  fact('ADD FOREIGN KEY holds ShareRowExclusiveLock (L2)', lockOf('alter table t add constraint f1 foreign key (a) references p (id)').includes('ShareRowExclusiveLock'), lockOf('alter table t add constraint f1 foreign key (a) references p (id)'));
  fact('ADD CHECK holds AccessExclusiveLock (L2)', lockOf('alter table t add constraint c1 check (a > 0)') === 'AccessExclusiveLock', lockOf('alter table t add constraint c1 check (a > 0)'));
  fact('SET NOT NULL holds AccessExclusiveLock (L3)', lockOf('alter table t alter column b set not null') === 'AccessExclusiveLock', lockOf('alter table t alter column b set not null'));
  fact('ADD UNIQUE constraint holds AccessExclusiveLock (L1 variant)', lockOf('alter table t add constraint u1 unique (a)').includes('AccessExclusiveLock'), lockOf('alter table t add constraint u1 unique (a)'));
  fact('CREATE TRIGGER holds ShareRowExclusiveLock (L7 touch)', lockOf('create trigger tg before insert on t for each row execute function suppress_redundant_updates_trigger()').includes('ShareRowExclusiveLock'), lockOf('create trigger tg before insert on t for each row execute function suppress_redundant_updates_trigger()'));
  fact('CREATE POLICY holds AccessExclusiveLock (so it is an L7 touch)', lockOf('create policy pol on t for select using (true)').includes('AccessExclusiveLock'), lockOf('create policy pol on t for select using (true)'));
  fact('VALIDATE CONSTRAINT holds only ShareUpdateExclusiveLock (the safe step of L2)', (() => { fresh(); sql('alter table t add constraint c1 check (a > 0) not valid'); const r = script("begin;\nalter table t validate constraint c1;\nselect string_agg(distinct mode, ',' order by mode) from pg_locks where relation = 't'::regclass and pid = pg_backend_pid() and mode <> 'AccessShareLock';\nrollback;"); return r.out.split('\n').pop() === 'ShareUpdateExclusiveLock'; })(), 'ShareUpdateExclusiveLock');
  // C1
  fresh();
  let r = script('begin;\ncreate index concurrently i1 on t (b);\ncommit;');
  fact('CREATE INDEX CONCURRENTLY inside a transaction is refused (C1)', !r.ok && /cannot run inside a transaction block/.test(r.err), r.err.split('\n')[0]);
  r = script('create index concurrently i1 on t (b);\nselect indisvalid from pg_index where indexrelid = \'i1\'::regclass;');
  fact('CREATE INDEX CONCURRENTLY as its own statement works and the index is valid', r.ok && r.out.endsWith('t'), r.out || r.err);
  r = script('create index concurrently if not exists i1 on t (b);');
  fact('CREATE INDEX CONCURRENTLY IF NOT EXISTS on an existing name is a no-op (so an INVALID leftover would be accepted: the C1 IF NOT EXISTS ban)', r.ok && /already exists, skipping/.test(r.err + r.out), (r.err || r.out).split('\n')[0] || 'silent skip');
  r = script('vacuum t;');
  fact('VACUUM works outside a transaction', r.ok, r.err || 'ok');
  r = script('begin;\nvacuum t;\ncommit;');
  fact('VACUUM inside a transaction is refused (C1)', !r.ok && /cannot run inside a transaction block/.test(r.err), r.err.split('\n')[0]);
  r = script('begin;\nreindex index concurrently i1;\ncommit;');
  fact('REINDEX CONCURRENTLY inside a transaction is refused (C1)', !r.ok && /cannot run inside a transaction block/.test(r.err), r.err.split('\n')[0]);
  r = script('begin;\ndrop index concurrently i1;\ncommit;');
  fact('DROP INDEX CONCURRENTLY inside a transaction is refused (C1)', !r.ok && /cannot run inside a transaction block/.test(r.err), r.err.split('\n')[0]);
} catch (e) {
  failed++; console.log(`FAIL probe crashed: ${String(e.message).slice(0, 400)}`);
} finally { cluster.stop(); }
console.log(`pg-facts: ${failed} FAIL`);
process.exit(failed ? 1 : 0);
