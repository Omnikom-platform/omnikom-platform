// Puts the waiting drafts of the test site of workspace A (staging only) back to a known state, so the publish flow starts clean.
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node apps/dashboard/tests/support/reset-staging-drafts.mjs            dry run: one line per row it would remove
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node apps/dashboard/tests/support/reset-staging-drafts.mjs --apply    removes them
// What it removes: rows of workspace A that were NEVER published (published_version is null), as a soft delete through service.unpublish(.., true)
// with owner-a's claims, exactly as the platform does it (audit row written, nothing else touched). What it never removes: a row a member points
// at as their own team row, a row a lead is assigned to, and the `team` and `settings` collections. What it cannot remove: a version newer than the
// published one on a row that WAS published: content_versions is append-only (no delete is ever granted), so such a row is listed as KEPT and stays
// a draft (the publish flow publishes the contact page's own draft itself).
// Refuses anything but staging: STAGING_SUPABASE_REF must be set, STAGING_DB_URL must name that project's host, and PROD_DB_URL must differ.
// Keys by variable name only; nothing prints a value.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeSql, jsonLit, uuidLit } from '../../../../tools/omnikom-cli/lib/sql.mjs';
import { claimsFor, parseIdentity } from '../../../../tools/omnikom-cli/lib/identity.mjs';

export const WORKSPACE_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const KEEP_COLLECTIONS = new Set(['team', 'settings']);

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`BLOCKED: ${name} is not set (read by name; run through node tools/with-env.mjs "<env file>" -- ...)`);
  return v;
}

/** Refuses any target but the staging project. Returns { base, key, dbUrl }. */
export function stagingOnly(env = process.env) {
  const ref = need('STAGING_SUPABASE_REF');
  const dbUrl = env.STAGING_DB_URL ?? '';
  if (dbUrl && !new URL(dbUrl).hostname.includes(ref) && !new URL(dbUrl).username.includes(ref)) throw new Error('REFUSED: STAGING_DB_URL does not name the staging project');
  if (dbUrl && env.PROD_DB_URL && env.PROD_DB_URL === dbUrl) throw new Error('REFUSED: STAGING_DB_URL equals PROD_DB_URL');
  if (env.PROD_SUPABASE_REF && env.PROD_SUPABASE_REF === ref) throw new Error('REFUSED: the staging ref equals the production ref');
  return { base: `https://${ref}.supabase.co`, key: need('STAGING_SUPABASE_SECRET_KEY'), dbUrl };
}

async function get(t, path) {
  const res = await fetch(`${t.base}/rest/v1${path}`, { headers: { apikey: t.key, authorization: `Bearer ${t.key}` }, signal: AbortSignal.timeout(30000) });
  if (res.status !== 200) throw new Error(`read ${path.split('?')[0]} answered ${res.status}`);
  return res.json();
}

const title = d => String(d?.street ?? d?.name ?? d?.title ?? d?.path ?? d?.question ?? d?.author ?? '').slice(0, 50);

/** What would be removed and what stays: { remove: [{ id, collection, title }], kept: [{ id, collection, title, newer }] }. Reads only. */
export async function plan() {
  const t = stagingOnly();
  const [rows, members, leads] = await Promise.all([
    get(t, `/content_rows?workspace_id=eq.${WORKSPACE_A}&deleted_at=is.null&select=id,collection,published_version,content_versions(n,data)`),
    get(t, `/members?workspace_id=eq.${WORKSPACE_A}&select=team_row_id`),
    get(t, `/leads?workspace_id=eq.${WORKSPACE_A}&owner_team_row=not.is.null&select=owner_team_row`),
  ]);
  const pointedAt = new Set([...members.map(m => m.team_row_id), ...leads.map(l => l.owner_team_row)].filter(Boolean));
  const remove = [], kept = [];
  for (const r of rows) {
    const newest = [...r.content_versions].sort((a, b) => b.n - a.n)[0];
    const row = { id: r.id, collection: r.collection, title: title(newest?.data) };
    if (r.published_version === null) {
      if (KEEP_COLLECTIONS.has(r.collection) || pointedAt.has(r.id)) kept.push({ ...row, newer: 'never published, but protected (a team row, a member\'s or a lead\'s owner)' });
      else remove.push(row);
    } else if (newest && newest.n > r.published_version) kept.push({ ...row, newer: `${newest.n - r.published_version} version(s) after the published one; versions cannot be removed` });
  }
  return { remove, kept };
}

/** Soft-deletes these rows through service.unpublish with owner-a's claims. Only ids of workspace A that are not published are accepted. */
export async function removeRows(ids) {
  const t = stagingOnly();
  if (!t.dbUrl) throw new Error('BLOCKED: STAGING_DB_URL is not set (read by name)');
  const claims = jsonLit(claimsFor(parseIdentity('owner-a')));
  const sql = makeSql({ url: t.dbUrl });
  const out = [];
  for (const id of ids) {
    const check = await get(t, `/content_rows?id=eq.${id}&workspace_id=eq.${WORKSPACE_A}&published_version=is.null&select=id`);
    if (check.length !== 1) { out.push({ id, ok: false, message: 'not a never-published row of workspace A: left alone' }); continue; }
    const r = sql.exec(`select service.unpublish(${claims}, ${uuidLit(id)}, true);`);
    out.push({ id, ok: r.ok, message: r.ok ? '' : `${r.code}: ${r.message}` });
  }
  return out;
}

const isMain = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();

if (isMain) {
  const apply = process.argv.includes('--apply');
  try {
    const { remove, kept } = await plan();
    for (const r of remove) console.log(`${apply ? 'REMOVE' : 'WOULD REMOVE'}  content_rows  ${r.id}  ${r.collection}  ${r.title}`);
    for (const k of kept) console.log(`KEPT          content_rows  ${k.id}  ${k.collection}  ${k.title}  (${k.newer})`);
    if (apply) {
      const done = await removeRows(remove.map(r => r.id));
      for (const d of done) console.log(`${d.ok ? 'removed' : 'FAILED '} ${d.id} ${d.message}`);
      const gone = done.filter(d => d.ok).map(d => d.id);
      if (gone.length) {
        const audit = await get(stagingOnly(), `/audit_log?workspace_id=eq.${WORKSPACE_A}&action=eq.delete&target=in.(${gone.join(',')})&select=target`);
        console.log(`audit_log: ${audit.length} delete row(s) for the ${gone.length} removed row(s)`);
      }
      if (done.some(d => !d.ok)) process.exitCode = 1;
    }
    console.log(`${apply ? 'applied' : 'dry run'}: ${remove.length} row(s) ${apply ? 'removed' : 'would be removed'}, ${kept.length} kept`);
  } catch (e) {
    console.log(String(e && e.message || e));
    process.exitCode = String(e && e.message).startsWith('BLOCKED') ? 3 : 1;
  }
}
