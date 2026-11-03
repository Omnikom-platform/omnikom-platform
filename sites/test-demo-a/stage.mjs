// Put the test site's contract (version N+1 when it changed) and its content rows on a database: the platform's own test site,
// workspace A of `omnikom seed test`. Written by the platform build head for step 4 slice 4.5 (2026-10-31); the CLI's `seed test`
// takes this over later (head of operations: it reads this file and the versions this run wrote, PROGRESS.md "4.5").
//
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node sites/test-demo-a/stage.mjs --logo-media <uuid> [--dry-run]
//        [--db-url-env STAGING_DB_URL] [--out <file.json>]
//
// What it does, in order, idempotent (a re-run writes nothing when nothing changed, a changed row gets a NEW VERSION, never a duplicate):
// 1. contract: `contract.json` (validated, core merged) becomes the active site_contracts row of workspace A as version max+1, unless the
//    active one already holds exactly this contract. SQL, the same statements as `omnikom seed workspace` (no service function writes a
//    contract; the CLI path is the precedent).
// 2. rows: every row of `rows.json` is resolved ("ref:<id>" -> the staging row id, "ref:media-logo" -> --logo-media) and validated for
//    PUBLISH (contracts/validate.mjs validateItem, media facts read from the media table) BEFORE anything is written; one problem = exit 1,
//    nothing written. Then, per row: no row yet -> service.seed_version (the staff actor, ref = rows.json sha256); a row whose latest
//    version differs -> service.save_as as owner-a (a new version of the same row); equal -> nothing.
//    A row is found by: settings = the one row; pages = data.path; other collections = data.slug, and for team also data.name (the seed's
//    "Agent One" row has no slug: it gets a new version with slug and role, not a second team row).
// 3. a PUBLISHED row of workspace A that is not in rows.json is unpublished through service.unpublish as owner-a (kept, never deleted):
//    every publish snapshots all published rows, so a leftover bare test row would fail every build (seen on job e29fb962, 4.5).
// 4. prints one line per row and, with --out, writes { contractVersion, rows: [{ key, collection, id, version }] } for the publish step.
// The values of secrets never print: the database URL is read by NAME and handed to psql as PG* variables (tools/omnikom-cli/lib/sql.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract, validateItem, mergeCore, leadColumns } from '../../contracts/validate.mjs';
import { makeSql, lit, uuidLit, jsonLit } from '../../tools/omnikom-cli/lib/sql.mjs';
import { PERSONS } from '../../tools/omnikom-cli/lib/identity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WS = 'aaaaaaaa-0000-0000-0000-000000000000';   // workspace A of `omnikom seed test` (slug test-demo-a)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OWNER = { sub: PERSONS['owner-a'].sub, aal: PERSONS['owner-a'].aal, role: 'authenticated' };

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const die = (code, msg) => { console.error(msg); process.exit(code); };
const dry = flag('dry-run') === true;
const logo = flag('logo-media');
const urlVar = typeof flag('db-url-env') === 'string' ? flag('db-url-env') : 'STAGING_DB_URL';
if (!dry && (typeof logo !== 'string' || !UUID.test(logo))) die(2, 'usage: stage.mjs --logo-media <uuid of a processed media row of workspace A> [--dry-run] [--db-url-env NAME] [--out file]');
if (!process.env[urlVar]) die(2, `${urlVar} is not set (load the env file by name with tools/with-env.mjs)`);
const sql = makeSql({ url: process.env[urlVar] });
const q = (query) => { const r = sql.rows(query); if (!r.ok) die(1, `database: ${r.code} ${r.message}`); return r.rows; };
const ex = (script) => { const r = sql.exec(script); if (!r.ok) die(1, `database: ${r.code} ${r.message}`); return r.out; };

// ---- inputs
const contract = JSON.parse(readFileSync(join(HERE, 'contract.json'), 'utf8'));
const rowsText = readFileSync(join(HERE, 'rows.json'), 'utf8');
const wanted = JSON.parse(rowsText);
const ref = `sites/test-demo-a/rows.json sha256 ${createHash('sha256').update(rowsText).digest('hex').slice(0, 16)}`;
const cProblems = validateContract(contract);
if (cProblems.length) die(1, `contract.json does not validate: ${cProblems[0].code} ${cProblems[0].msg || ''}`);
// leadColumns: the CRM's industry columns in form order, as an array (jsonb keeps no key order; migration 14 reads the order from here)
const resolved = { ...contract, collections: mergeCore(contract), leadColumns: leadColumns(contract) };

// ---- state
const staff = q('select user_id from staff');
if (staff.length !== 1) die(1, `seeding needs exactly one staff actor; ${staff.length} staff logins exist`);
const actor = staff[0].user_id;
const ws = q(`select id, slug from workspaces where id = ${uuidLit(WS)}`);
if (ws.length !== 1) die(1, 'workspace A is not on this database (run `omnikom seed test` first)');
const active = q(`select version, contract = ${jsonLit(contract)} as same from site_contracts where workspace_id = ${uuidLit(WS)} and active`);
const existing = q(`select c.id, c.collection, v.n, v.data from content_rows c
  join lateral (select n, data from content_versions where row_id = c.id order by n desc limit 1) v on true
  where c.workspace_id = ${uuidLit(WS)} and c.deleted_at is null`);
let mediaFacts;
if (typeof logo === 'string') {
  const m = q(`select id, width, processed, exif_stripped, rights_confirmed from media where id = ${uuidLit(logo)} and workspace_id = ${uuidLit(WS)}`);
  if (m.length !== 1) die(1, `--logo-media ${logo} is not a media row of workspace A`);
  mediaFacts = { width: m[0].width, exifStripped: m[0].exif_stripped === true, rightsConfirmed: m[0].rights_confirmed === true, processed: m[0].processed === true };
}

// ---- plan: match, resolve, validate (nothing written yet)
const keyOf = (collection, data) => collection === 'settings' ? 'settings' : collection === 'pages' ? `pages:${data.path}` : `${collection}:${data.slug}`;
const findRow = (collection, data) => existing.find((r) => r.collection === collection && (
  collection === 'settings' || (collection === 'pages' ? r.data.path === data.path : r.data.slug === data.slug)))
  || (collection === 'team' ? existing.find((r) => r.collection === 'team' && !r.data.slug && r.data.name === data.name) : undefined);
const ids = new Map();   // rows.json id -> database row id (known now for matched rows, after seeding for new ones)
for (const w of wanted) { const hit = findRow(w.collection, w.data); if (hit) ids.set(w.id, hit.id); }
const resolveRefs = (v) => {
  if (typeof v === 'string' && v.startsWith('ref:')) {
    const k = v.slice(4);
    if (k === 'media-logo') return typeof logo === 'string' ? logo : '00000000-0000-0000-0000-000000000000';
    if (!wanted.some((w) => w.id === k)) die(1, `rows.json refers to unknown id "${k}"`);
    return ids.get(k) || `pending:${k}`;
  }
  if (Array.isArray(v)) return v.map(resolveRefs);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveRefs(x)]));
  return v;
};
const exists = (collection, id) => (typeof id === 'string' && id.startsWith('pending:')) || existing.some((r) => r.id === id && r.collection === collection);
const media = (asset) => (asset === logo ? mediaFacts : undefined);
const problems = [];
for (const w of wanted) {
  for (const p of validateItem(resolved, w.collection, resolveRefs(w.data), { mode: 'publish', exists, media })) problems.push(`${w.id}: ${p.code} ${p.path || ''} ${p.msg || ''}`);
}
const contractLine = active.length && active[0].same ? `CONTRACT active version ${active[0].version} already holds contract.json (unchanged)` :
  `CONTRACT version ${active.length ? '(max)+1' : 1} to be written (active now: ${active.length ? active[0].version : 'none'})`;
if (dry) {
  console.log(contractLine);
  for (const w of wanted) { const hit = findRow(w.collection, w.data); console.log(`${hit ? `MATCH ${hit.id} v${hit.n}` : 'NEW'}  ${keyOf(w.collection, w.data)}`); }
  console.log(problems.length ? `PROBLEMS (${problems.length}):\n  ${problems.join('\n  ')}` : 'no problems (publish mode)');
  console.log('DRY RUN: nothing written');
  process.exit(problems.length && typeof logo === 'string' ? 1 : 0);
}
if (problems.length) die(1, `nothing written: ${problems.length} row(s) do not validate for publish:\n  ${problems.join('\n  ')}`);

// ---- write: contract
ex(`begin;
do $w$ begin
  if not exists (select 1 from site_contracts where workspace_id = ${uuidLit(WS)} and active and contract = ${jsonLit(contract)}) then
    update site_contracts set active = false where workspace_id = ${uuidLit(WS)} and active;
    insert into site_contracts (workspace_id, version, contract, resolved, active, created_by)
      values (${uuidLit(WS)}, coalesce((select max(version) from site_contracts where workspace_id = ${uuidLit(WS)}), 0) + 1, ${jsonLit(contract)}, ${jsonLit(resolved)}, true, ${uuidLit(actor)});
    insert into audit_log (workspace_id, actor, action, target, detail) values (${uuidLit(WS)}, ${uuidLit(actor)}, 'seed-contract', 'test-demo-a', jsonb_build_object('ref', 'sites/test-demo-a/stage.mjs'));
  end if;
end $w$;
commit;`);
const contractVersion = q(`select version from site_contracts where workspace_id = ${uuidLit(WS)} and active`)[0].version;
console.log(active.length && active[0].same ? `CONTRACT version ${contractVersion} unchanged` : `CONTRACT version ${contractVersion} written and active`);

// jsonb keeps object keys in its own order (shorter keys first), so rows are compared with every object's keys sorted
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.fromEntries(Object.keys(x).sort().map(n => [n, x[n]])) : x);
// ---- write: rows (rows without pending refs first; a row whose refs are still pending waits for the next pass)
const out = [];
const left = [...wanted];
for (let pass = 0; left.length && pass < 5; pass++) {
  for (let i = 0; i < left.length; i++) {
    const w = left[i];
    const data = resolveRefs(w.data);
    if (JSON.stringify(data).includes('"pending:')) continue;
    const hit = findRow(w.collection, w.data);
    let id, version, what;
    if (!hit) {
      id = q(`select service.seed_version(${uuidLit(WS)}, ${lit(w.collection)}, ${jsonLit(data)}, ${uuidLit(actor)}, ${lit(ref)}) as id`)[0].id;
      version = 1; what = 'NEW';
    } else if (canon(hit.data) === canon(data)) {
      id = hit.id; version = hit.n; what = 'SAME';
    } else {
      const s = q(`select * from service.save_as(${jsonLit(OWNER)}, ${uuidLit(WS)}, ${lit(w.collection)}, ${uuidLit(hit.id)}, ${jsonLit(data)}, null)`)[0];
      id = s.row_id; version = s.version; what = 'VERSION';
    }
    ids.set(w.id, id);
    out.push({ key: w.id, collection: w.collection, id, version });
    console.log(`${what.padEnd(7)} ${keyOf(w.collection, w.data).padEnd(28)} ${id} v${version}`);
    left.splice(i, 1); i--;
  }
}
if (left.length) die(1, `rows left with unresolved references: ${left.map((w) => w.id).join(', ')}`);
// ---- the site holds exactly rows.json: a PUBLISHED row of workspace A that is not one of them is unpublished (kept, never deleted).
// Every later publish snapshots all published rows, so one bare test row (an e2e listing with only `street`) fails every build.
const mine = new Set(out.map((r) => r.id));
for (const r of q(`select id, collection, published_version as pub from public.content_rows where workspace_id = ${uuidLit(WS)} and deleted_at is null and published_version is not null order by collection, id`)) {
  if (mine.has(r.id)) continue;
  ex(`select service.unpublish(${jsonLit(OWNER)}, ${uuidLit(r.id)}, false);`);
  console.log(`${'UNPUB'.padEnd(7)} ${(r.collection + ' (not in rows.json)').padEnd(28)} ${r.id} was v${r.pub}`);
}
const file = flag('out');
if (typeof file === 'string') { writeFileSync(resolve(file), JSON.stringify({ contractVersion, rows: out }, null, 2) + '\n'); console.log(`wrote ${file}`); }
console.log(`OK: contract version ${contractVersion}, ${out.length} rows (${out.filter((r) => r.version === 1).length} at version 1)`);
