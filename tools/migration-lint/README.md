# migration-lint

Book row E19 (hardening step H2-14): a static lock lint over `supabase/migrations/*.sql`. No dependencies. It READS the folder and
never edits it (`supabase/` is the platform department's). Owner: CLI and testing.

```
node tools/migration-lint/lint.mjs [--dir <folder>] [--waivers <file>] [--applier <apply-staging.mjs>] [--json]
```

Exit 0: every finding has a waiver and no waiver is stale. Exit 1: a finding with no waiver, a stale or malformed waiver, or a
`-- no-transaction` file while the applier cannot run it. Exit 2: the folder or a file could not be read or scanned (an unclosed string,
comment or dollar quote, or `BEGIN ATOMIC`): it fails closed, never passes. Output is one line per finding: `FAIL <file>:<line> <rule> <reason>.
Safe: <alternative>.` then the statement; a waived one prints `WAIVED`.

It runs in CI in the `departments` job (steps "Migration lint (the real folder)", "Migration lint tests", "Migration lint mutants"), mapped
in `tools/omnikom-cli/commands/ci.mjs`, so `omnikom ci` and `omnikom land` read it.

## What counts as an existing table

Files are read in name order. A table (or materialized view) created in an EARLIER file is existing; one created in the SAME file is new and
exempt from the lock rules (nothing reads or writes it yet). A table the folder never created (a vendor table such as `auth.users`) counts as
existing: the statement could not run otherwise. A temporary table is never existing. `DROP TABLE IF EXISTS` of a table no earlier file made is
a no-op, not a contract step. Unqualified names are `public.`.

## The rules

| Id | Flags, on an existing table | Postgres behaviour (16) | Safe alternative |
|---|---|---|---|
| L1 | `CREATE [UNIQUE] INDEX` without `CONCURRENTLY`; `ADD CONSTRAINT UNIQUE / PRIMARY KEY / EXCLUDE` without `USING INDEX` | a plain build holds a SHARE lock (writes wait); a unique constraint builds its index under ACCESS EXCLUSIVE | `CREATE INDEX CONCURRENTLY` in a `-- no-transaction` file, then `ADD CONSTRAINT ... USING INDEX` |
| L2 | `ADD CONSTRAINT` foreign key or check without `NOT VALID`; an inline `CHECK` in `ADD COLUMN` | scans every row; ACCESS EXCLUSIVE for a check, SHARE ROW EXCLUSIVE for a foreign key | `NOT VALID`, then `VALIDATE CONSTRAINT` (SHARE UPDATE EXCLUSIVE) in a later statement or file |
| L3 | `ALTER COLUMN ... SET NOT NULL` | scans the table under ACCESS EXCLUSIVE, UNLESS a validated `CHECK (col IS NOT NULL)` exists (PG 12+) | `ADD CONSTRAINT c CHECK (col IS NOT NULL) NOT VALID`, `VALIDATE CONSTRAINT c`, then `SET NOT NULL`: this exact sequence (any earlier file counts) passes |
| L4 | `ALTER COLUMN ... TYPE` | rewrites the table and its indexes | expand-contract: new column, batch backfill, switch readers, drop the old one |
| L5 | `ADD COLUMN` with a volatile default (`gen_random_uuid`, `clock_timestamp`, `random`, `nextval`, `uuid_generate_*`, ...), a `serial`, an identity column, a stored generated column | computed per row, so the table is rewritten. A constant default and a STABLE one such as `now()` are NOT rewritten (PG 11+): not flagged | no default or a constant, batch backfill, then `SET DEFAULT` |
| L6 | `LOCK TABLE`, `VACUUM FULL`, `CLUSTER`, `REINDEX` without `CONCURRENTLY` | ACCESS EXCLUSIVE for the whole run | `REINDEX CONCURRENTLY` in a `-- no-transaction` file; the others by hand in a window |
| L7 | a file whose first table-locking statement has no earlier non-zero `SET [LOCAL] lock_timeout` | a statement waiting for a lock queues every later query on the table behind it | `SET lock_timeout = '5s';` at the top |
| E1 | `DROP COLUMN`, `DROP TABLE`, `RENAME TO` (table) without a contract header; `RENAME COLUMN` always | breaks the code that still reads the old name | header `-- contract: expanded in <earlier file>`; for a column rename: add, backfill, switch, drop |
| C1 | `CREATE/DROP INDEX CONCURRENTLY`, `REINDEX CONCURRENTLY`, `VACUUM` without the `-- no-transaction` header; a `-- no-transaction` file holding anything else (only `SET` besides); `CREATE INDEX CONCURRENTLY IF NOT EXISTS` | none of them runs inside a transaction block, and the applier wraps every file in one. `IF NOT EXISTS` skips an INVALID leftover of a failed build and the file would be recorded as applied | a file of its own with the header; no `IF NOT EXISTS` (write it to be re-run: `drop index concurrently if exists x;` then create) |

"Touches a table" (L7): `ALTER TABLE`, `CREATE INDEX` (concurrent too), `DROP TABLE`, `DROP INDEX`, `LOCK`, `TRUNCATE`, `VACUUM FULL`, `CLUSTER`,
`REINDEX`, `CREATE TRIGGER`, `DROP TRIGGER`, `CREATE/ALTER/DROP POLICY` (measured: it holds ACCESS EXCLUSIVE).
Statements inside a `DO $$ ... $$` block are read (they run at migration time; the body's wrapper words `begin`, `if ... then` are skipped, a literal
`execute '...'` is read as a statement); the body of a `CREATE FUNCTION` is not (it does not run).

Every number in the "behaviour" column is measured by `test/pg-facts.mjs` on a throwaway cluster (table rewrite = relfilenode changes, scan =
`pg_stat` seq_scan goes up, lock = `pg_locks` in the statement's own transaction); the work order's list called `now()` volatile, which Postgres
contradicts (it is STABLE), so it is not flagged.

## Directives (the header)

The header is the leading lines of the file that are blank or `--` comments; a `/* */` comment or the first statement ends it. A directive
anywhere else (after a statement, inside a string) is not one. This is the rule the applier uses too (`FINDING-apply-staging.md`).

- `-- no-transaction`: the applier runs the file statement by statement outside a transaction (needed for `CONCURRENTLY` and `VACUUM`).
- `-- contract: expanded in 20261029000002_crm.sql`: the file names an EARLIER migration of this folder that added what replaces the dropped or
  renamed thing. A name that does not exist, or that sorts at or after this file, does not count.

## Waivers

`waivers.json`: a list of `{ "file", "rule", "line", "date", "reason" }`, ONE per finding (a migration is immutable once applied: the ledger refuses an
edited file, so the line is stable). `reason` must say why in at least 20 characters. A waiver that matches no finding, repeats another, names a file
that is not in the folder, an unknown rule, an impossible date or any other key is itself an error: there is no blanket waiver and no wildcard. The 37
waivers of 2026-11-10 cover migrations 1, 2, 3, 4, 7, 11, 12, 21 and 22, all applied to staging before the lint reached master (22 on 2026-11-10 10:28 UTC, from the staging ledger); each reason states when the file was first
applied (with the line of `docs/blueprint/PROGRESS.md`) and what the table held. A NEW migration that needs an exception adds a waiver in the same commit;
that is a reviewed line, not a comment in the file.

## The applier wall

`apply-staging.mjs` wraps every file in `begin; ... commit;`, so a `-- no-transaction` file cannot run. The change it needs is a finding for the
platform department (`FINDING-apply-staging.md`, with the exact block). Until it lands, the lint refuses a `-- no-transaction` file ("applier
problem", exit 1): a `CONCURRENTLY` migration cannot reach master by accident. No applier in this department's files applies migrations (`omnikom apply`
calls `apply-staging.mjs`).

## Not covered (known gaps, none hidden)

Anything inline in a column definition other than CHECK (an inline REFERENCES does not scan the table: measured); `DROP INDEX`/`DROP CONSTRAINT` as contract steps; `TRUNCATE` and data-changing statements on large
tables; the lock a `CREATE TABLE ... REFERENCES` takes on the parent; dynamic SQL built with `format()` or `||` inside `EXECUTE`; a user-defined function
used as a default (its volatility is unknown, so it is not flagged); `ALTER COLUMN TYPE` that Postgres can do without a rewrite (varchar widening) is
still flagged (waive it with the reason); partitioned tables (`CREATE INDEX CONCURRENTLY` is not allowed on them); statements after `BEGIN ATOMIC`
(the lint refuses such a file rather than mis-split it).

## Tests, mutants, probes

```
node tools/migration-lint/test/run.mjs          fixtures (one red and one green per rule), the scanner, the real folder and each waiver removed, the CLI
node tools/migration-lint/test/mutate.mjs       one check removed per mutant, the suite must go red on a named check (seconds)
node ~/.claude/scripts/heavy.mjs -- node tools/migration-lint/test/pg-facts.mjs      the Postgres behaviour above, on a throwaway cluster
node ~/.claude/scripts/heavy.mjs -- node tools/migration-lint/test/apply-proof.mjs   the apply-staging change, on a throwaway cluster
```

Fixtures: `test/fixtures/<RULE>-red-<case>.sql` must produce findings of exactly that rule; `-green-` none; `GEN-green-` are the scanner's traps
(statements in comments, strings and function bodies). Each case is linted as the second file after `base.sql`, which makes `accounts` and `orders` exist.
