// Removes the leftover "5.3 flows" test leads from the test site of workspace A (staging only). Logic and tests: supabase/tests/e2e-cleanup.mjs.
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node apps/dashboard/tests/support/clean-flow-leads.mjs            dry run: the count, the ids, how many stay
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node apps/dashboard/tests/support/clean-flow-leads.mjs --apply    removes them
//   ... --ids id1,id2   only these leads (the flows test's afterAll passes the ids it made; still limited to that site and to the marker or the name prefix)
// Selects leads of the test site whose answers carry test = "5.3 flows", never by name alone. Removal is service.delete_lead as owner-a, then a read back.
// Refuses anything but staging (stagingDbUrl). Keys by variable name only; nothing prints a value. Exit 0 ok, 1 a removal failed, 3 BLOCKED/REFUSED.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeSql } from '../../../../tools/omnikom-cli/lib/sql.mjs';
import { stagingDbUrl, stagingLeadRemover, cleanFlowLeads } from '../../../../supabase/tests/e2e-cleanup.mjs';

const isMain = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();

if (isMain) {
  const apply = process.argv.includes('--apply');
  const at = process.argv.indexOf('--ids');
  const ids = at >= 0 ? String(process.argv[at + 1] || '').split(',').filter(Boolean) : null;
  try {
    const url = stagingDbUrl(process.env);
    const r = await cleanFlowLeads({
      sql: makeSql({ url, readOnly: true }), remove: apply ? stagingLeadRemover({ url }) : async () => ({ ok: false, message: 'dry run' }), apply, ids,
      report: (ok, id, name, detail) => console.log(`${ok ? 'removed' : 'FAILED '} ${id}  ${name ?? ''}${detail ? `  ${detail}` : ''}`),
    });
    if (!r.ok && r.message) throw new Error(r.message);
    if (!apply) for (const l of r.selected) console.log(`WOULD REMOVE  leads  ${l.id}  ${l.name ?? ''}`);
    console.log(`${apply ? 'applied' : 'dry run'}: ${apply ? `${r.removed} removed, ${r.failed} failed` : `${r.selected.length} lead(s) would be removed`}, ${r.left} lead(s) of the test site ${apply ? 'left' : 'would be left'}`);
    if (r.failed) process.exitCode = 1;
  } catch (e) {
    console.log(String(e && e.message || e));
    process.exitCode = /^(BLOCKED|REFUSED)/.test(String(e && e.message)) ? 3 : 1;
  }
}
