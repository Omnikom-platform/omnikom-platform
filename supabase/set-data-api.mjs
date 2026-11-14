// Sets the staging project's Data API exposed schemas to `public` only (security review 2026-11-14, TABLE row 12; staging read 2026-11-14:
// public,graphql_public): PATCH /v1/projects/{ref}/postgrest with ONLY { db_schema: 'public' }, between two reads of GET /v1/projects/{ref}/postgrest.
// Prints key names, the db_schema text, the other non-secret numbers and, after the change, which other keys changed (names only): the answer
// holds a JWT secret and no other value is ever printed. It reads first: when db_schema is already public it sends nothing.
//   node tools/with-env.mjs "<env file>" -- node supabase/set-data-api.mjs [--dry-run]
// Needs SUPABASE_ACCESS_TOKEN (read by name, never printed) and STAGING_SUPABASE_REF; staging only (no option names another project).
// SUPABASE_API_BASE exists for the tests' local fake server only. Exit 0 ok, already done or dry run; 1 failed; 2 refused (nothing sent).
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SCHEMAS_WANT, schemaIsWanted } from './check-auth-settings.mjs';

export const dataApiBody = () => ({ db_schema: SCHEMAS_WANT });
export const diffKeys = (before, after, except) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => k !== except && JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort();
const SAFE = ['db_extra_search_path', 'db_pool', 'db_pool_acquisition_timeout', 'db_pool_max_idletime', 'db_pool_max_lifetime', 'max_rows'];   // the names whose value is printed: short settings, no secret
const show = v => (v === undefined ? '(not returned)' : v === null ? 'null' : typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && /^[A-Za-z0-9_, ]{1,200}$/.test(v) ? v : `(a ${typeof v}, not printed)`);

// run only as the script itself: importing the file (body.test.mjs) runs nothing
if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const refuse = why => { console.log(`REFUSED: ${why}; nothing sent`); process.exit(2); };
  if (argv.some(a => a !== '--dry-run')) refuse('usage: set-data-api.mjs [--dry-run]');
  const dry = argv.includes('--dry-run');
  const ref = process.env.STAGING_SUPABASE_REF, token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!ref || !token) refuse('set STAGING_SUPABASE_REF and SUPABASE_ACCESS_TOKEN (by name)');
  if (!/^[a-z0-9]{10,40}$/.test(ref)) refuse('STAGING_SUPABASE_REF is not a project ref');
  if (process.env.PROD_SUPABASE_REF && process.env.PROD_SUPABASE_REF === ref) refuse('STAGING_SUPABASE_REF holds the production ref; staging only');
  const base = process.env.SUPABASE_API_BASE || 'https://api.supabase.com';
  if (base !== 'https://api.supabase.com' && !/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) refuse("SUPABASE_API_BASE may only name the tests' local fake server");
  const mark = base === 'https://api.supabase.com' ? '' : '  [LOCAL FAKE SERVER, NOT THE PROVIDER]';
  const url = `${base}/v1/projects/${ref}/postgrest`;
  const call = async (method, body) => {
    const headers = { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) };
    const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    if (!r.ok) { await r.body?.cancel(); console.log(`FAIL: ${method} /postgrest answered ${r.status} ${r.statusText}; the answer is not printed${mark}`); process.exit(1); }
    if (method !== 'GET') { await r.body?.cancel(); return null; }
    return r.json();
  };
  const before = await call('GET');
  console.log(`db_schema now: ${show(before.db_schema)}`);
  console.log(`other settings now: ${SAFE.filter(k => k in before).map(k => `${k}=${show(before[k])}`).join(', ')}`);
  if (schemaIsWanted(before.db_schema)) { console.log(`OK: db_schema is already ${SCHEMAS_WANT}; nothing sent${mark}`); process.exit(0); }
  const body = dataApiBody();
  console.log(`${dry ? 'would send' : 'send'} PATCH /postgrest ${JSON.stringify(body)}`);
  if (dry) { console.log(`dry run: nothing sent${mark}`); process.exit(0); }
  await call('PATCH', body);
  const after = await call('GET');
  const changed = diffKeys(before, after, 'db_schema');
  const ok = schemaIsWanted(after.db_schema) && changed.length === 0;
  console.log(`${ok ? 'OK' : 'FAIL'}: db_schema is ${show(after.db_schema)}; other settings ${changed.length ? `CHANGED: ${changed.join(', ')}` : 'all same'}${mark}`);
  process.exit(ok ? 0 : 1);
}
