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
