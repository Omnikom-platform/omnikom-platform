// The change supabase/apply-staging.mjs needs so that a file whose header holds `-- no-transaction` runs outside a transaction (rule C1).
// supabase/ is the platform's, so this is a FINDING (tools/migration-lint/FINDING-apply-staging.md quotes TARGET and REPLACEMENT verbatim;
// test/run.mjs checks that it does), and test/apply-proof.mjs applies it to a COPY of the script and runs that against a throwaway cluster.
// patchApplier asserts its target is in the text exactly once: a patch that did not apply must not read as a pass.
export const TARGET = `  // one transaction per file; the ledger row is written inside it, so a failed file leaves no record
  const body = \`begin;\\n\${text}\\ninsert into ops.platform_migrations (name, sha256) values ('\${f}', '\${sha}');\\ncommit;\\n\`;
  r = psql(['-f', '-'], body);
  if (r.status !== 0) fail(\`FAILED \${f}: nothing of it was kept (the transaction rolled back)\`, r);
`;

export const REPLACEMENT = `  // one transaction per file; the ledger row is written inside it, so a failed file leaves no record. A file whose header (the comment lines
  // before its first statement) holds the line \`-- no-transaction\` (migration-lint rule C1: CREATE INDEX CONCURRENTLY and VACUUM cannot run
  // inside a transaction) runs outside one: psql sends each statement on its own, in the one session, and the ledger row is written after the
  // last. A failure part way keeps what the earlier statements did (a failed CONCURRENTLY build leaves an INVALID index): the file is not
  // recorded and a re-run starts it again, so such a file is written to be re-run (drop index concurrently if exists, then create).
  const noTx = /^\\s*--\\s*no-transaction\\s*$/m.test((text.match(/^(?:[ \\t\\r]*(?:--[^\\n]*)?\\n)*/) || [''])[0]);
  const ledgerRow = \`insert into ops.platform_migrations (name, sha256) values ('\${f}', '\${sha}');\\n\`;
  const body = noTx ? \`\${text}\\n;\\n\${ledgerRow}\` : \`begin;\\n\${text}\\n\${ledgerRow}commit;\\n\`;
  r = psql(['-f', '-'], body);
  if (r.status !== 0) fail(noTx ? \`FAILED \${f}: it runs outside a transaction, so what ran before the failing statement is kept and the file is not recorded (a re-run starts it again)\` : \`FAILED \${f}: nothing of it was kept (the transaction rolled back)\`, r);
`;

export function patchApplier(text) {
  const n = text.split(TARGET).length - 1;
  if (n !== 1) throw new Error(`the patch target is in the applier ${n} times (expected exactly 1)`);
  return text.replace(TARGET, () => REPLACEMENT);
}
