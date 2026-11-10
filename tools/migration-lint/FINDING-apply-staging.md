# Finding for the platform department: `supabase/apply-staging.mjs` cannot run a CREATE INDEX CONCURRENTLY file

From: CLI and testing (work order 34, book row E19, migration lock lint). Not applied by us: `supabase/` is the platform's.

## The problem (measured)

`apply-staging.mjs` sends every migration as `begin; <file> insert into ops.platform_migrations ...; commit;`. Postgres refuses
`CREATE INDEX CONCURRENTLY`, `DROP INDEX CONCURRENTLY`, `REINDEX ... CONCURRENTLY` and `VACUUM` inside a transaction block, so a
migration holding one fails on staging and on production, whatever its content. `tools/migration-lint/test/pg-facts.mjs` measures the
error ("cannot run inside a transaction block"), and `tools/migration-lint/test/apply-proof.mjs` runs the ORIGINAL script on a
throwaway cluster and watches it fail on exactly such a file (lines pasted in the work order report).

Why it matters: lint rule L1 (a plain CREATE INDEX on an existing table blocks every write until it ends) has one safe alternative,
CONCURRENTLY, and without this change there is no way to ship it. Until the change lands, the lint refuses (exit 1, "applier
problem") any migration whose header carries `-- no-transaction`, so a CONCURRENTLY migration cannot reach master by accident.

## The exact change (one block, `supabase/apply-staging.mjs`, inside the `for (const f of files)` loop)

Replace this block (it occurs once):

````js
  // one transaction per file; the ledger row is written inside it, so a failed file leaves no record
  const body = `begin;\n${text}\ninsert into ops.platform_migrations (name, sha256) values ('${f}', '${sha}');\ncommit;\n`;
  r = psql(['-f', '-'], body);
  if (r.status !== 0) fail(`FAILED ${f}: nothing of it was kept (the transaction rolled back)`, r);
````

with this:

````js
  // one transaction per file; the ledger row is written inside it, so a failed file leaves no record. A file whose header (the comment lines
  // before its first statement) holds the line `-- no-transaction` (migration-lint rule C1: CREATE INDEX CONCURRENTLY and VACUUM cannot run
  // inside a transaction) runs outside one: psql sends each statement on its own, in the one session, and the ledger row is written after the
  // last. A failure part way keeps what the earlier statements did (a failed CONCURRENTLY build leaves an INVALID index): the file is not
  // recorded and a re-run starts it again, so such a file is written to be re-run (drop index concurrently if exists, then create).
  const noTx = /^\s*--\s*no-transaction\s*$/m.test((text.match(/^(?:[ \t\r]*(?:--[^\n]*)?\n)*/) || [''])[0]);
  const ledgerRow = `insert into ops.platform_migrations (name, sha256) values ('${f}', '${sha}');\n`;
  const body = noTx ? `${text}\n;\n${ledgerRow}` : `begin;\n${text}\n${ledgerRow}commit;\n`;
  r = psql(['-f', '-'], body);
  if (r.status !== 0) fail(noTx ? `FAILED ${f}: it runs outside a transaction, so what ran before the failing statement is kept and the file is not recorded (a re-run starts it again)` : `FAILED ${f}: nothing of it was kept (the transaction rolled back)`, r);
````

The header rule is the same one the lint uses: the `-- no-transaction` line must be among the leading lines of the file that are blank or
`--` comments (a line after the first statement, or after a `/* */` comment, is not a header: the file stays wrapped and fails loudly).
Nothing is imported: `supabase/tests/test-apply.mjs` copies `supabase/` alone to a temp folder, so an import from `tools/` would break it.

What the proof shows (`node tools/migration-lint/test/apply-proof.mjs`, a throwaway cluster, supabase/ untouched):
the original script fails on a CONCURRENTLY file; the patched copy applies it, the index is valid, a second run skips it, an edited
file is still refused by the hash, an ordinary file that fails midway is still rolled back whole, a no-transaction file that fails
midway is not recorded (and keeps what ran before, which the message says), a CRLF file works, a late `-- no-transaction` line is not a header.

## What to add to your own tests (your files, your call)

`supabase/tests/test-apply.mjs`: one fixture migration with the header and a CONCURRENTLY index, applied twice (second run applies 0),
plus the partial-failure case; `supabase/ops/test/apply-dry.test.mjs`: the dry run lists the file as "would apply" and writes nothing.

## Connection note

A no-transaction file runs statement by statement in one psql session. Use a session connection (`STAGING_DB_URL_DIRECT`, the session
pooler on 5432, and the production equivalent), never the transaction pooler: a `SET lock_timeout` at the top of the file must still
be in force for the statement after it. Also: a failed CONCURRENTLY build leaves an INVALID index, so a no-transaction file is written
to be re-run (`drop index concurrently if exists x;` then `create index concurrently x ...`); the lint refuses `IF NOT EXISTS` on
such an index for that reason.

## The other places that apply migrations (read, none needs a change)

| Applier | How it applies | Wraps a file in a transaction? | Action |
|---|---|---|---|
| `supabase/apply-staging.mjs` | one psql per file, `begin; ...; commit;` | YES | the change above |
| `omnikom apply` (`tools/omnikom-cli/commands/apply.mjs`) | child process of apply-staging | inherits | none (its output parsing reads only `apply ` / `skip ` lines) |
| `.github/production/promote.yml` | `node supabase/apply-staging.mjs --url-env PROD_DB_URL --i-mean-production` | inherits | none; optional: run `node tools/migration-lint/lint.mjs` in Gate 1 beside the read-only checks |
| `supabase/ops/test/cluster.mjs` (promote-check, apply-dry, alerts, key-ages tests) | calls apply-staging | inherits | none |
| `supabase/tests/test-apply.mjs` | copy of apply-staging | inherits | add the fixture above |
| `supabase/tests/run-local.mjs` and `publish-parity.mjs` | every migration concatenated into one file, `psql -f` (no `-1`) | no, each statement autocommits | none; the header is just a comment there |
| `supabase/functions/test/harness.mjs`, `supabase/ops/test/6b-cluster.mjs`, `6b-alerts-fixture.mjs` | `psql -f <file>` per migration (no `-1`) | no | none |
| `supabase/ops/promote-check.mjs` | reads and hashes the files, compares ledgers | writes nothing | none |

Verified by: a search of supabase, tools and .github for `single-transaction` and `'-1'` lists only `tools/omnikom-cli/commands/land.mjs` and
two CLI tests (`git log -1` and a flag test value, not psql); the one `begin;` that wraps a migration is the line in apply-staging.mjs above.
