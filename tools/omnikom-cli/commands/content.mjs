// content save | get | history: the content path, slice 1 over SQL. `save` does what the save function does: load the contract the
// caller may see (service.contract_for: an outsider gets S-NOT-FOUND before any field name is revealed), validate the row as a
// draft (contracts/validate.mjs validateItem), then service.save_as with the caller's claims (members: own items only, locked
// fields refused without a staff sign-off). `get` and `history` read as the `authenticated` role, so row-level security decides.
import { readFileSync } from 'node:fs';
import { Usage } from '../lib/errors.mjs';
import { need, needUuid, isUuid, SLUG } from '../lib/args.mjs';
import { lit, uuidLit, jsonLit } from '../lib/sql.mjs';
import { result, fromSql } from '../lib/ctx.mjs';
import { parseIdentity, claimsFor } from '../lib/identity.mjs';
import { importRepo } from '../lib/repo.mjs';

const person = ctx => { const id = parseIdentity(ctx.flags.as); claimsFor(id); return id; };
const readJson = (p, what) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { throw new Usage(`${what} is not readable JSON: ${p}`); } };

async function save(ctx) {
  const f = ctx.flags;
  const id = person(ctx);
  const collection = need(f, 'collection');
  if (!SLUG.test(collection)) throw new Usage('--collection must be a collection name');
  const data = readJson(need(f, 'file'), '--file');
  const signOff = f['sign-off'] ? readJson(f['sign-off'], '--sign-off') : null;
  if (f.row && !isUuid(f.row)) throw new Usage('--row must be a uuid');
  const ws = ctx.workspace(f.workspace, id);
  const claims = jsonLit(claimsFor(id));
  const sql = ctx.sql();

  const c = sql.rows(`select service.contract_for(${claims}, ${uuidLit(ws.id)}) as contract`);
  if (!c.ok) return fromSql(c, { as: id.name });
  const contract = c.rows[0] && c.rows[0].contract;
  if (!contract) return result(false, 'S-NO-CONTRACT', { as: id.name, error: 'the workspace has no active contract' });
  const { validateItem } = await importRepo('contracts/validate.mjs');
  const problems = validateItem(contract, collection, data, { mode: 'draft' });
  if (problems.length) return result(false, problems[0].code, { as: id.name, problems: problems.slice(0, 20), stored: false });

  const r = sql.rows(`select * from service.save_as(${claims}, ${uuidLit(ws.id)}, ${lit(collection)}, ${f.row ? uuidLit(f.row) : 'null::uuid'}, ${jsonLit(data)}, ${signOff ? jsonLit(signOff) : 'null::jsonb'})`);
  if (!r.ok) return fromSql(r, { as: id.name });
  return result(true, 'ok', { as: id.name, workspace: ws.slug, row: r.rows[0] && r.rows[0].row_id, version: r.rows[0] && r.rows[0].version });
}

function get(ctx) {
  const id = person(ctx);
  const row = needUuid(ctx.flags, 'row');
  const version = ctx.flags.version ? Number(ctx.flags.version) : null;
  if (version !== null && (!Number.isInteger(version) || version < 1)) throw new Usage('--version must be a positive whole number');
  const v = version === null ? '(select max(n) from content_versions x where x.row_id = r.id)' : String(version);
  const r = ctx.sql().rows(`select r.id, r.collection, r.published_version, r.owner_team_row, v.n as version, v.data, v.at from content_rows r join content_versions v on v.row_id = r.id and v.n = ${v} where r.id = ${uuidLit(row)}`, { claims: claimsFor(id) });
  if (!r.ok) return fromSql(r);
  if (!r.rows.length) return result(false, 'S-NOT-FOUND', { as: id.name, error: 'not found' });
  return result(true, 'ok', { as: id.name, row: r.rows[0] });
}

function history(ctx) {
  const id = person(ctx);
  const row = needUuid(ctx.flags, 'row');
  const r = ctx.sql().rows(`select n as version, by, at, sign_off is not null as signed_off, md5(data::text) as data_md5 from content_versions where row_id = ${uuidLit(row)} order by n`, { claims: claimsFor(id) });
  if (!r.ok) return fromSql(r);
  if (!r.rows.length) return result(false, 'S-NOT-FOUND', { as: id.name, error: 'not found' });
  return result(true, 'ok', { as: id.name, versions: r.rows });
}

export function contentGroup(ctx) {
  const verb = ctx.positionals[1];
  if (verb === 'save') return save(ctx);
  if (verb === 'get') return get(ctx);
  if (verb === 'history') return history(ctx);
  throw new Usage('content <save|get|history>');
}
