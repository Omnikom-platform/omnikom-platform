// The cleanup the staging e2e scripts share (slice 5.2b; brief factory/briefs/5-2b-e2e-cleanup-and-openapi.md).
// Why: on 2026-11-01 ten never-published listing drafts ("4.2 e2e ...", "4.3 e2e ...", "5.2 e2e ...") sat in workspace A because the scripts
// created rows and never removed them; the dashboard publishes every waiting draft, so one invalid leftover stopped every publish.
// A script calls cleanup.track(id) the moment a call answers with the id of a content row it CREATED (a save with row: null), and
// `await cleanup.run()` in its `finally`. A row the script only edited is never tracked. run() never throws and removes each id once.
// The removal is the platform's own path, as in apps/dashboard/tests/support/reset-staging-drafts.mjs: service.unpublish(claims, row, true)
// with owner-a's claims (soft delete, audit row), then a read back that deleted_at is set. Tests: supabase/tests/e2e-cleanup.test.mjs.
import { makeSql, jsonLit, uuidLit } from '../../tools/omnikom-cli/lib/sql.mjs';
import { claimsFor, parseIdentity } from '../../tools/omnikom-cli/lib/identity.mjs';

/** Refuses anything but the staging database. Returns the connection string (never printed). */
export function stagingDbUrl(env = process.env) {
  const ref = env.STAGING_SUPABASE_REF, url = env.STAGING_DB_URL;
  if (!ref) throw new Error('BLOCKED: STAGING_SUPABASE_REF is not set (read by name)');
  if (!url) throw new Error('BLOCKED: STAGING_DB_URL is not set (read by name): the script removes its rows through service.unpublish and creates none it cannot remove');
  let u; try { u = new URL(url); } catch { throw new Error('REFUSED: STAGING_DB_URL is not a connection URL'); }
  if (!u.hostname.includes(ref) && !decodeURIComponent(u.username).includes(ref)) throw new Error('REFUSED: STAGING_DB_URL does not name the staging project');
  if (env.PROD_DB_URL && env.PROD_DB_URL === url) throw new Error('REFUSED: STAGING_DB_URL equals PROD_DB_URL');
  if (env.PROD_SUPABASE_REF && env.PROD_SUPABASE_REF === ref) throw new Error('REFUSED: the staging ref equals the production ref');
  return url;
}

/** remove(id) -> { ok, message } for the staging database: soft delete through service.unpublish as owner-a, then read back. */
export function stagingRemover({ url, spawn, who = 'owner-a' }) {
  const claims = jsonLit(claimsFor(parseIdentity(who)));
  const sql = makeSql({ url, ...(spawn ? { spawn } : {}) });
  return async id => {
    const r = sql.exec(`select service.unpublish(${claims}, ${uuidLit(id)}, true);`);
    if (!r.ok) return { ok: false, message: `${r.code}: ${r.message}` };
    const back = sql.rows(`select deleted_at is not null as gone from public.content_rows where id = ${uuidLit(id)}`);
    if (!back.ok || !back.rows[0]) return { ok: false, message: 'removed, but the read back found no row' };
    return back.rows[0].gone === true ? { ok: true, message: '' } : { ok: false, message: 'service.unpublish answered, but deleted_at is still null' };
  };
}

/** The registry. remove: async id -> { ok, message }; report: (ok, name, detail) -> void (the script's `line`). */
export function createCleanup({ remove, report }) {
  const ids = [];
  let done = false;
  return {
    track(id) { if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id); return id; },
    tracked: () => [...ids],
    async run() {
      if (done) return { removed: 0, failed: 0 };
      done = true;
      let removed = 0, failed = 0;
      for (const id of [...ids].reverse()) {
        let r;
        try { r = await remove(id); } catch (e) { r = { ok: false, message: String(e && e.message || e).slice(0, 200) }; }
        const ok = Boolean(r && r.ok);
        if (ok) removed++; else failed++;
        try { report(ok, `the e2e row ${id.slice(0, 8)} was removed (soft delete through service.unpublish)`, ok ? '' : String(r && r.message || 'no answer')); } catch { /* the report must not stop the next removal */ }
      }
      return { removed, failed };
    },
  };
}

// ---- leads left behind by the dashboard flows test (slice 5-CL; brief factory/briefs/5-CL-flow-leads-cleanup.md)
// apps/dashboard/tests/flows.spec.ts makes leads on the test site of workspace A marked {"test": "5.3 flows"} in their answers. They are
// removed through the platform's own path, service.delete_lead(claims, id, reason) as owner-a (the audit row and the consent record stay as
// designed), then a read back that the lead is gone. Selection is by the marker in answers on that one site, never by name alone, so the
// CLI's "Journey ..." leads stay. `ids` (the flows test's own afterAll) narrows a run to leads it names; those may also be found by the
// "5.3 flows " name prefix, because the browser's Add a lead form has no field for answers. Entry point: apps/dashboard/tests/support/clean-flow-leads.mjs.
export const FLOW_MARK = '5.3 flows';
export const FLOW_SITE = 'aaaaaaaa-0000-0000-0000-00000000517e';

/** True for a lead the flows test made: the marker in its answers (or, only when the caller named its id, the name prefix). */
export function isFlowLead(row, { named = false } = {}) {
  if (!row) return false;
  if (row.answers && typeof row.answers === 'object' && row.answers.test === FLOW_MARK) return true;
  return named && typeof row.name === 'string' && row.name.startsWith(`${FLOW_MARK} `);
}

/** Reads the leads of the test site and splits them: { ok, selected: [{ id, name }], left } (left = leads of that site that stay). Reads only. */
export function selectFlowLeads({ sql, ids = null }) {
  const r = sql.rows(`select id, name, answers from public.leads where site_id = ${uuidLit(FLOW_SITE)} order by created_at`);
  if (!r.ok) return { ok: false, message: `${r.code}: ${r.message}`, selected: [], left: 0 };
  const want = ids ? new Set(ids) : null;
  const selected = r.rows.filter(l => (want ? want.has(l.id) : true) && isFlowLead(l, { named: Boolean(want) })).map(l => ({ id: l.id, name: l.name }));
  return { ok: true, message: '', selected, left: r.rows.length - selected.length };
}

/** remove(id) -> { ok, message } for the staging database: service.delete_lead as owner-a, then a read back that the lead is gone. */
export function stagingLeadRemover({ url, spawn, who = 'owner-a' }) {
  const claims = jsonLit(claimsFor(parseIdentity(who)));
  const sql = makeSql({ url, ...(spawn ? { spawn } : {}) });
  return async id => {
    const r = sql.exec(`select service.delete_lead(${claims}, ${uuidLit(id)}, 'test data: ${FLOW_MARK}');`);
    if (!r.ok) return { ok: false, message: `delete_lead ${r.code}: ${r.message}` };
    const back = sql.rows(`select not exists (select 1 from public.leads where id = ${uuidLit(id)}) as gone`);
    if (!back.ok || !back.rows[0]) return { ok: false, message: 'removed, but the read back found no answer' };
    if (back.rows[0].gone !== true) return { ok: false, message: 'service.delete_lead answered, but the lead is still there' };
    return { ok: true, message: '' };
  };
}

/** Dry run by default. apply: removes each selected lead once through remove(id). Never throws on a removal. */
export async function cleanFlowLeads({ sql, remove, apply = false, ids = null, report = () => {} }) {
  const sel = selectFlowLeads({ sql, ids });
  if (!sel.ok) return { ok: false, message: sel.message, selected: [], left: 0, removed: 0, failed: 0 };
  let removed = 0, failed = 0;
  if (apply) {
    for (const l of sel.selected) {
      let r;
      try { r = await remove(l.id); } catch (e) { r = { ok: false, message: String(e && e.message || e).slice(0, 160) }; }
      const ok = Boolean(r && r.ok);
      if (ok) removed += 1; else failed += 1;
      try { report(ok, l.id, l.name, ok ? '' : String(r && r.message || 'no answer')); } catch { /* the report must not stop the next removal */ }
    }
  }
  return { ok: failed === 0, message: '', selected: sel.selected, left: sel.left, removed, failed };
}
