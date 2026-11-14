// privacy open | list | move: a person's privacy request (migrations 7, 8, 43); the database decides and audits.
import { Usage } from '../lib/errors.mjs';
import { need, needUuid } from '../lib/args.mjs';
import { lit, uuidLit, jsonLit } from '../lib/sql.mjs';
import { fromSql } from '../lib/ctx.mjs';
import { parseIdentity, claimsFor } from '../lib/identity.mjs';
const person = ctx => { const id = parseIdentity(ctx.flags.as); claimsFor(id); return id; };   // a machine: usage error
const note = f => (f.note ? lit(f.note) : 'null::text');
function windowed(ctx, id, verb, run) {   // staff act only inside a window (migration 43): 5 minutes, closed after
  if (id.aal !== 'aal2') return run();
  const sql = ctx.sql();
  const w = sql.scalar(`select service.staff_open(${jsonLit(claimsFor(id))}, ${lit('omnikom privacy ' + verb)}, 5)`);
  if (!w.ok) return fromSql(w, { as: id.name });
  try { return run(); } finally {
    const end = `until = ${lit(w.value)}::timestamptz`;
    sql.exec(`update public.staff_access set until = now() where user_id = ${uuidLit(id.sub)} and ${end};`);
  }
}
function act(ctx, id, verb, fn, args, data) {   // a service function with the person's claims
  return windowed(ctx, id, verb, () => {
    const r = ctx.sql().exec(`select service.${fn}(${jsonLit(claimsFor(id))}, ${args});`);
    return fromSql(r, { as: id.name, ...data(r) });
  });
}
function open(ctx) {
  const id = person(ctx), f = ctx.flags;
  const ws = needUuid(f, 'workspace'), kind = need(f, 'kind'), subject = need(f, 'subject');
  const args = `${uuidLit(ws)}, ${lit(kind)}::public.privacy_request_kind, ${lit(subject)}, ${note(f)}`;
  const out = r => ({ request: r.ok ? r.out.split(/\r?\n/).pop() : undefined });
  return act(ctx, id, 'open', 'open_privacy_request', args, out);
}
function list(ctx) {
  const id = person(ctx), f = ctx.flags;
  const openOnly = "state not in ('done', 'refused')";
  const where = [f.state ? `state = ${lit(f.state)}::public.privacy_request_state` : openOnly];
  if (f.workspace) where.push(`workspace_id = ${uuidLit(needUuid(f, 'workspace'))}`);
  const cols = 'id, workspace_id, kind, state, received_at, due_at, cardinality(lead_ids) as leads, subject';
  const q = `select ${cols} from public.privacy_requests where ${where.join(' and ')} order by due_at, id limit 200`;
  return windowed(ctx, id, 'list', () => {
    const r = ctx.sql().rows(q, { claims: claimsFor(id) });
    return fromSql(r, { as: id.name, count: r.rows.length, requests: r.rows });
  });
}
function move(ctx) {
  const id = person(ctx), f = ctx.flags;
  const request = needUuid(f, 'request'), to = need(f, 'to');
  const args = `${uuidLit(request)}, ${lit(to)}::public.privacy_request_state, ${note(f)}`;
  return act(ctx, id, 'move', 'set_privacy_request_state', args, () => ({ request, to }));
}
export function privacyGroup(ctx) {
  const verb = ctx.positionals[1];
  if (verb === 'open') return open(ctx);
  if (verb === 'list') return list(ctx);
  if (verb === 'move') return move(ctx);
  throw new Usage('privacy <open|list|move>');
}
