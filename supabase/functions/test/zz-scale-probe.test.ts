// probe [E13-a]: a measure, not a check. Ignored unless E13_PROBE=1 (CI never sets it). It seeds 5000 leads in workspace A, exports them
// through the CRM-view shape (lead-export with a workspace: 25 lead_list pages, one read, one service.leads_exported, in this process), prints
// one SCALE X2 line (rows, status, time, heap growth against its budget, never a row) and deletes them.
//   $env:E13_PROBE='1'; $env:FN_TEST_FILTER='[E13-a]'; node supabase/functions/test/run.mjs
import { handle as leadExport } from '../lead-export/index.ts';
import { call, SITE_A, WS_A, withSql } from './util.ts';

Deno.test({
  name: 'probe [E13-a]: a 5000-row export, time and heap',
  ignore: Deno.env.get('E13_PROBE') !== '1',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await withSql(sql => sql`insert into public.leads (workspace_id, site_id, form, page_path, name, email, answers, consent_text)
      select ${WS_A}::uuid, ${SITE_A}::uuid, 'contact', '/', 'Probe ' || i || repeat(' x', 50), 'probe' || i || '@test', '{}'::jsonb, 'seeded' from generate_series(1, 5000) i`);
    try {
      const before = Deno.memoryUsage().heapUsed, t0 = performance.now();
      const r = await call(leadExport, 'lead-export', { workspace: WS_A }, 'owner-a');
      const ms = Math.round(performance.now() - t0), mb = Math.round((Deno.memoryUsage().heapUsed - before) / 1048576);
      console.log(`SCALE X2 export of ${r.text.split('\r\n').length - 2} rows, status ${r.status}: ${ms} ms, heap +${mb} MB, budget 64 MB, ${mb <= 64 ? 'IN' : 'OVER'}`);
    } finally {
      // their exported events go too: lead_events cascades
      await withSql(sql => sql`delete from public.leads where workspace_id = ${WS_A}::uuid and email like 'probe%@test'`);
    }
  },
});
