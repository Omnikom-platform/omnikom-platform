// lead send     a lead exactly as a website sends it: signed with the site's key, with an idempotency key, over the
//               capture-lead function. --retry sends the SAME body (same key) a second time and, when the target's database is
//               reachable, counts the rows for that key (must be 1).
// lead list | get | update | add | delete   what the dashboard will do. Slice 1: reads run as the `authenticated` role with
//               the person's claims (row-level security decides what they see); writes call the service.* functions with the
//               same claims, as the Edge Functions do. Slice 2 moves them to the functions.
import { Usage } from '../lib/errors.mjs';
import { need, needUuid, isUuid } from '../lib/args.mjs';
import { lit, uuidLit, jsonLit } from '../lib/sql.mjs';
import { result, fromSql } from '../lib/ctx.mjs';
import { parseIdentity, claimsFor, machineKey } from '../lib/identity.mjs';
import { callFunction } from '../lib/fn.mjs';
import { loadFixture } from '../lib/fixtures.mjs';

// a status is a key of the business's own list (its contract's crm.statuses, migration 23): the database checks it, the CLI keeps no list of its own
const person = ctx => { const id = parseIdentity(ctx.flags.as); claimsFor(id); return id; };   // throws for a machine identity

async function send(ctx) {
  const f = ctx.flags;
  const siteArg = need(f, 'site');
  const site = ctx.site(siteArg, { needDb: false });
  const identity = parseIdentity(f.as || (site.slug ? `site:${site.slug}` : null));
  if (identity.kind !== 'site') throw new Usage('lead send is a website call: --as must be site:<slug>');
  const key = machineKey(identity, ctx.env);
  const { data: fixture, warnings } = loadFixture(f.fixture || 'lead-contact.json', { real: Boolean(f.real) });
  ctx.warnings.push(...warnings);
  const idempotencyKey = f.key || fixture.idempotencyKey || ctx.randomUUID();
  if (!isUuid(idempotencyKey)) throw new Usage('--key must be a uuid');
  const body = JSON.stringify({ ...fixture, form: f.form || fixture.form || 'contact', idempotencyKey });
  const target = ctx.target({ needDb: false });
  const attempts = [];
  for (let i = 0; i < (f.retry ? 2 : 1); i++) {
    const r = await callFunction({ base: target.functionsBase, name: 'capture-lead', query: `?site=${site.id}`, body, identity, key, t: ctx.now(), fetchImpl: ctx.fetch });
    attempts.push({ status: r.status, answer: r.json || r.snippet, ...(r.error ? { error: r.error } : {}) });
  }
  const allOk = attempts.every(a => a.status >= 200 && a.status < 300);
  let stored = null;
  if (target.dbUrl && allOk) {
    const c = ctx.sql().scalar(`select count(*) from leads where site_id = ${uuidLit(site.id)} and idempotency_key = ${uuidLit(idempotencyKey)}`);
    if (c.ok) stored = Number(c.value);
  }
  const duplicate = f.retry && stored !== null && stored !== 1;
  const first = attempts[0].status;
  return result(allOk && !duplicate, duplicate ? 'RETRY-STORED-' + stored : first === 0 ? 'NETWORK' : first, { site: site.id, idempotencyKey, attempts, stored });
}

function list(ctx) {
  const id = person(ctx);
  const where = ctx.flags.status ? `where status = ${lit(ctx.flags.status)}` : '';   // text since migration 23: no cast, an unknown key matches nothing
  const limit = Math.min(Number(ctx.flags.limit) || 50, 500);
  const r = ctx.sql().rows(`select id, status, name, form, flow, page_path, owner_team_row, created_at from leads ${where} order by created_at desc limit ${limit}`, { claims: claimsFor(id) });
  return fromSql(r, { as: id.name, count: r.rows.length, leads: r.rows });
}

function get(ctx) {
  const id = person(ctx);
  const lead = needUuid(ctx.flags, 'lead');
  const claims = claimsFor(id);
  const l = ctx.sql().rows(`select id, workspace_id, site_id, status, name, email, phone, form, flow, cta, page_path, owner_team_row, answers, consent_text, created_at from leads where id = ${uuidLit(lead)}`, { claims });
  if (!l.ok) return fromSql(l);
  if (!l.rows.length) return result(false, 'S-NOT-FOUND', { as: id.name, error: 'not found' });
  const e = ctx.sql().rows(`select kind, by, detail, at from lead_events where lead_id = ${uuidLit(lead)} order by at, id`, { claims });
  return result(true, 'ok', { as: id.name, lead: l.rows[0], events: e.rows });
}

function update(ctx) {
  const id = person(ctx);
  const f = ctx.flags;
  const lead = needUuid(f, 'lead');
  if (f.owner && !isUuid(f.owner)) throw new Usage('--owner must be a team row uuid');
  const r = ctx.sql().exec(`select service.lead_update(${jsonLit(claimsFor(id))}, ${uuidLit(lead)}, ${f.status ? lit(f.status) : 'null'}::text, ${f.owner ? uuidLit(f.owner) : 'null::uuid'}, ${f.note ? lit(f.note) : 'null::text'}, ${f.unassign ? 'true' : 'false'});`);
  return fromSql(r, { as: id.name, lead });
}

function add(ctx) {
  const id = person(ctx);
  const f = ctx.flags;
  const site = ctx.site(need(f, 'site'));
  let src = { name: f.name, email: f.email, phone: f.phone, answers: {}, consentText: f.consent };
  if (f.fixture) {
    const { data, warnings } = loadFixture(f.fixture, { real: Boolean(f.real) });
    ctx.warnings.push(...warnings);
    src = { ...data, ...Object.fromEntries(Object.entries({ name: f.name, email: f.email, phone: f.phone, consentText: f.consent }).filter(([, v]) => v !== undefined)) };
  }
  if (!src.consentText) throw new Usage('a lead needs its consent wording: --consent <text> or a fixture with consentText');
  const owner = f.owner ? uuidLit(f.owner) : 'null::uuid';
  const r = ctx.sql().exec(`select service.add_lead(${jsonLit(claimsFor(id))}, ${uuidLit(site.id)}, ${lit(src.name)}, ${lit(src.email)}, ${lit(src.phone)}, ${jsonLit(src.answers || {})}, ${lit(src.consentText)}, 'manual', ${owner});`);
  return fromSql(r, { as: id.name, lead: r.ok ? r.out.split(/\r?\n/).pop() : undefined });
}

function del(ctx) {
  const id = person(ctx);
  const lead = needUuid(ctx.flags, 'lead');
  const r = ctx.sql().exec(`select service.delete_lead(${jsonLit(claimsFor(id))}, ${uuidLit(lead)}, ${ctx.flags.reason ? lit(ctx.flags.reason) : 'null::text'});`);
  return fromSql(r, { as: id.name, deleted: lead });
}

export function leadGroup(ctx) {
  const verb = ctx.positionals[1];
  if (verb === 'send') return send(ctx);
  if (verb === 'list') return list(ctx);
  if (verb === 'get') return get(ctx);
  if (verb === 'update') return update(ctx);
  if (verb === 'add') return add(ctx);
  if (verb === 'delete') return del(ctx);
  throw new Usage('lead <send|list|get|update|add|delete>');
}
