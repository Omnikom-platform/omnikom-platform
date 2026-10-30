// seed test       workspaces A and B, their sites, contracts, test logins: the fixtures of supabase/tests/tenancy.test.sql
//                 (same ids, emails and contract text; a unit test compares them with that file). Idempotent: every insert is
//                 "on conflict do nothing" or guarded by an existence check, so a second run changes no row (the command
//                 proves it with a fingerprint of every table before and after).
// seed test --clean   removes exactly those fixtures (and the Vault secrets named site-test-demo-*), so test walls can run.
// seed workspace  a real client from an approved plan, SQL path (W1.1): workspace, site, contract (from contracts/from-plan.mjs
//                 output), the pages and the places the plan names, through service.seed_version (staff actor, plan hash as the
//                 reference).
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Usage, Blocked } from '../lib/errors.mjs';
import { need, isUuid, SLUG } from '../lib/args.mjs';
import { lit, uuidLit, jsonLit } from '../lib/sql.mjs';
import { result, fromSql } from '../lib/ctx.mjs';
import { PERSONS } from '../lib/identity.mjs';
import { importRepo, repoPath } from '../lib/repo.mjs';

export const WS_A = 'aaaaaaaa-0000-0000-0000-000000000000';
export const WS_B = 'bbbbbbbb-0000-0000-0000-000000000000';
export const SITE_A = 'aaaaaaaa-0000-0000-0000-00000000517e';
export const SITE_B = 'bbbbbbbb-0000-0000-0000-00000000517e';
// the contract text of tenancy.test.sql, as data
export const TEST_CONTRACT = {
  collections: {
    team: { kind: 'collection', access: { member: 'own' }, ownerField: 'self', fields: { name: { type: 'text' }, licence: { type: 'group', locked: { reason: 'fact' } } } },
    listings: { kind: 'collection', access: { member: 'own' }, ownerField: 'agent', fields: { street: { type: 'text' }, agent: { type: 'reference', to: 'team' } } },
    settings: { kind: 'singleton', access: { member: 'none' }, fields: { businessName: { type: 'text' }, licences: { type: 'list', locked: { reason: 'fact' } } } },
    leads: { kind: 'inbox', access: { member: 'own' }, ownerField: 'owner', fields: { status: { type: 'enum' } } },
  },
};
const P = PERSONS;
const SEED_REF = 'omnikom seed test';
export const LOGINS = ['owner-a', 'owner-b', 'member-a1', 'member-a2', 'staff', 'nobody'];

// The test logins as GoTrue expects a user row (found 2026-10-30 on staging: rows with only (id, email) have aud, role, instance_id and
// the token columns null, GoTrue filters on them and cannot find the user, so no session token can be made). Same ids and emails as the
// tenancy fixtures. A row left by an earlier seed is brought to this shape by the update below (no manual SQL).
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const TOKEN_COLUMNS = ['confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change', 'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token'];
const APP_META = '{"provider":"email","providers":["email"]}';
export function loginsSql() {
  const ids = LOGINS.map(n => uuidLit(P[n].sub)).join(', ');
  const rows = LOGINS.map(n => `(${uuidLit(ZERO_UUID)}, ${uuidLit(P[n].sub)}, 'authenticated', 'authenticated', ${lit(P[n].email)}, now(), now(), now(), ${TOKEN_COLUMNS.map(() => "''").join(', ')}, ${lit(APP_META)}::jsonb, '{}'::jsonb, false, false)`).join(',\n  ');
  return `insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at, ${TOKEN_COLUMNS.join(', ')}, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous) values
  ${rows}
  on conflict (id) do nothing;
update auth.users set instance_id = coalesce(instance_id, ${uuidLit(ZERO_UUID)}), aud = coalesce(aud, 'authenticated'), role = coalesce(role, 'authenticated'),
  email_confirmed_at = coalesce(email_confirmed_at, now()), created_at = coalesce(created_at, now()), updated_at = coalesce(updated_at, now()),
  ${TOKEN_COLUMNS.map(c => `${c} = coalesce(${c}, '')`).join(', ')},
  raw_app_meta_data = coalesce(raw_app_meta_data, ${lit(APP_META)}::jsonb), raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
  where id in (${ids});`;
}

export function seedTestSql({ alertTo = null } = {}) {
  return `begin;
set client_min_messages = warning;
${loginsSql()}
insert into staff values (${uuidLit(P.staff.sub)}) on conflict do nothing;
insert into workspaces (id, slug, name, industry) values
  (${uuidLit(WS_A)}, 'test-demo-a', 'Demo A', 'real-estate-agent'), (${uuidLit(WS_B)}, 'test-demo-b', 'Demo B', 'real-estate-agent') on conflict (id) do nothing;
insert into sites (id, workspace_id, deploy_target, preview_host) values
  (${uuidLit(SITE_A)}, ${uuidLit(WS_A)}, 'test-site-demo-a', 'demo-a.preview.test'),
  (${uuidLit(SITE_B)}, ${uuidLit(WS_B)}, 'test-site-demo-b', 'demo-b.preview.test') on conflict (id) do nothing;
insert into site_contracts (workspace_id, version, contract, resolved, active)
  select v.ws, 1, '{}'::jsonb, ${jsonLit(TEST_CONTRACT)}, true from (values (${uuidLit(WS_A)}), (${uuidLit(WS_B)})) v(ws)
  where not exists (select 1 from site_contracts c where c.workspace_id = v.ws);
insert into members (workspace_id, user_id, role) values
  (${uuidLit(WS_A)}, ${uuidLit(P['owner-a'].sub)}, 'owner'), (${uuidLit(WS_B)}, ${uuidLit(P['owner-b'].sub)}, 'owner'),
  (${uuidLit(WS_A)}, ${uuidLit(P['member-a1'].sub)}, 'member'), (${uuidLit(WS_A)}, ${uuidLit(P['member-a2'].sub)}, 'member')
  on conflict (workspace_id, user_id) do nothing;
do $seed$
declare t1 uuid; t2 uuid; a uuid := ${uuidLit(WS_A)};
begin
  select c.id into t1 from content_rows c join content_versions v on v.row_id = c.id and v.n = 1
    where c.workspace_id = a and c.collection = 'team' and v.data ->> 'name' = 'Agent One';
  if t1 is null then t1 := service.seed_version(a, 'team', '{"name":"Agent One"}', ${uuidLit(P.staff.sub)}, ${lit(SEED_REF)}); end if;
  select c.id into t2 from content_rows c join content_versions v on v.row_id = c.id and v.n = 1
    where c.workspace_id = a and c.collection = 'team' and v.data ->> 'name' = 'Agent Two';
  if t2 is null then t2 := service.seed_version(a, 'team', '{"name":"Agent Two"}', ${uuidLit(P.staff.sub)}, ${lit(SEED_REF)}); end if;
  update members set team_row_id = t1 where workspace_id = a and user_id = ${uuidLit(P['member-a1'].sub)} and team_row_id is distinct from t1;
  update members set team_row_id = t2 where workspace_id = a and user_id = ${uuidLit(P['member-a2'].sub)} and team_row_id is distinct from t2;
end $seed$;
${alertTo ? `update sites set lead_alert_to = array[${lit(alertTo)}] where id in (${uuidLit(SITE_A)}, ${uuidLit(SITE_B)}) and lead_alert_to is distinct from array[${lit(alertTo)}];` : ''}
commit;`;
}

export function seedCleanSql() {
  return `begin;
do $v$ begin
  if to_regclass('vault.secrets') is not null then
    begin delete from vault.secrets where name like 'site-test-demo-%'; exception when others then null; end;
  end if;
end $v$;
delete from workspaces where slug in ('test-demo-a', 'test-demo-b');
-- a login that real content still references (the staff actor of a seeded workspace) cannot go; it is kept and reported
do $u$ declare e text; begin
  foreach e in array array[${LOGINS.map(n => lit(P[n].email)).join(', ')}] loop
    begin delete from auth.users where email = e; exception when foreign_key_violation then null; end;
  end loop;
end $u$;
commit;`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function seedTest(ctx) {
  const sql = ctx.sql();
  if (ctx.flags.clean) {
    const r = sql.exec(seedCleanSql());
    if (!r.ok) return fromSql(r);
    const kept = sql.rows(`select email from auth.users where email in (${LOGINS.map(n => lit(P[n].email)).join(', ')})`);
    return result(true, 'ok', { removed: ['workspaces test-demo-a, test-demo-b', 'their sites, contracts, members, content', 'Vault secrets site-test-demo-*', 'the test logins nothing references'], keptLogins: kept.rows.map(x => x.email) });
  }
  const alertTo = ctx.flags['alert-to'];
  if (alertTo && !EMAIL.test(alertTo)) throw new Usage('--alert-to must be an email address');
  const before = sql.fingerprint();
  const r = sql.exec(seedTestSql({ alertTo: alertTo || null }));
  if (!r.ok) return fromSql(r);
  const after = sql.fingerprint();
  return result(true, 'ok', {
    workspaces: { a: { id: WS_A, slug: 'test-demo-a', site: SITE_A }, b: { id: WS_B, slug: 'test-demo-b', site: SITE_B } },
    logins: LOGINS,
    changed: before === null || before !== after,
  });
}

// ---------- seed workspace ----------
const title = slug => slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

async function loadContract(ctx) {
  const f = ctx.flags;
  if (f.contract) return JSON.parse(readFileSync(f.contract, 'utf8'));
  if (!f.plan) throw new Usage('seed workspace needs --contract <contract.json> (the output of contracts/from-plan.mjs) or --plan <approved dir> --entities <entities.json>');
  const entities = need(f, 'entities');
  const tmp = mkdtempSync(join(tmpdir(), 'omnikom-plan-'));
  try {
    const out = join(tmp, 'contract.json');
    const r = ctx.spawn(process.execPath, [repoPath('contracts', 'from-plan.mjs'), '--plan', f.plan, '--entities', entities, '--out', out], { encoding: 'utf8', timeout: 120000 });
    if (r.status !== 0) throw new Usage(`from-plan.mjs failed: ${String(r.stdout || r.stderr || '').trim().split(/\r?\n/).pop().slice(0, 200)}`);
    return JSON.parse(readFileSync(out, 'utf8'));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

async function seedWorkspace(ctx) {
  const f = ctx.flags;
  const slug = need(f, 'slug'), name = need(f, 'name'), industry = need(f, 'industry');
  const deployTarget = need(f, 'deploy-target'), previewHost = need(f, 'preview-host');
  if (!SLUG.test(slug)) throw new Usage('--slug must be lowercase words joined with dashes');
  const contract = await loadContract(ctx);
  const { validateContract, mergeCore } = await importRepo('contracts/validate.mjs');
  const problems = validateContract(contract);
  if (problems.length) return result(false, problems[0].code, { problems: problems.slice(0, 20), total: problems.length });

  const resolved = { ...contract, collections: mergeCore(contract) };
  const ref = `plan sitemap sha256 ${(contract.site && contract.site.generatedFrom && contract.site.generatedFrom.sitemapSha256) || createHash('sha256').update(JSON.stringify(contract)).digest('hex').slice(0, 16)}`;
  const seeds = contract.pageSeeds || {};
  const pages = contract.pages.map(p => ({ path: p.path, type: p.type, ...(seeds[p.path] ? { title: seeds[p.path].title, seo: seeds[p.path].seo } : {}) }));
  const places = Object.entries(contract.seeds || {}).flatMap(([collection, list]) => list.map(s => ({ collection, data: { name: title(s), slug: s } })));
  const plan = { pages: pages.length, places: places.length };
  if (f['dry-run']) return result(true, 'ok', { dryRun: true, workspace: slug, ...plan, contractCollections: Object.keys(contract.collections).length });

  const sql = ctx.sql();
  let actor = f.actor;
  if (actor) { if (!isUuid(actor)) throw new Usage('--actor must be a uuid'); }
  else {
    const s = sql.rows('select user_id from staff');
    if (!s.ok) return fromSql(s);
    if (s.rows.length !== 1) throw new Blocked(`seeding needs a staff actor: ${s.rows.length} staff logins exist`, 'pass --actor <staff user uuid>');
    actor = s.rows[0].user_id;
  }
  const before = sql.fingerprint();
  const script = `begin;
set client_min_messages = warning;
insert into workspaces (slug, name, industry) values (${lit(slug)}, ${lit(name)}, ${lit(industry)}) on conflict (slug) do nothing;
do $w$
declare ws uuid; p jsonb; s record;
begin
  select id into ws from workspaces where slug = ${lit(slug)};
  insert into sites (workspace_id, deploy_target, preview_host) values (ws, ${lit(deployTarget)}, ${lit(previewHost)}) on conflict (deploy_target) do nothing;
  if not exists (select 1 from sites where deploy_target = ${lit(deployTarget)} and workspace_id = ws) then raise exception 'S-SEED-SITE: deploy target % belongs to another workspace', ${lit(deployTarget)}; end if;
  if not exists (select 1 from site_contracts where workspace_id = ws and active and contract = ${jsonLit(contract)}) then
    update site_contracts set active = false where workspace_id = ws and active;
    insert into site_contracts (workspace_id, version, contract, resolved, active, created_by)
      values (ws, coalesce((select max(version) from site_contracts where workspace_id = ws), 0) + 1, ${jsonLit(contract)}, ${jsonLit(resolved)}, true, ${uuidLit(actor)});
    insert into audit_log (workspace_id, actor, action, target, detail) values (ws, ${uuidLit(actor)}, 'seed-contract', ${lit(slug)}, jsonb_build_object('ref', ${lit(ref)}));
  end if;
  for p in select * from jsonb_array_elements(${jsonLit(pages)}) loop
    if not exists (select 1 from content_rows c join content_versions v on v.row_id = c.id and v.n = 1 where c.workspace_id = ws and c.collection = 'pages' and v.data ->> 'path' = p ->> 'path') then
      perform service.seed_version(ws, 'pages', p, ${uuidLit(actor)}, ${lit(ref)});
    end if;
  end loop;
  for s in select e ->> 'collection' as coll, e -> 'data' as data from jsonb_array_elements(${jsonLit(places)}) e loop
    if not exists (select 1 from content_rows c join content_versions v on v.row_id = c.id and v.n = 1 where c.workspace_id = ws and c.collection = s.coll and v.data ->> 'slug' = s.data ->> 'slug') then
      perform service.seed_version(ws, s.coll, s.data, ${uuidLit(actor)}, ${lit(ref)});
    end if;
  end loop;
end $w$;
commit;`;
  const r = sql.exec(script);
  if (!r.ok) return fromSql(r);
  const counts = sql.rows(`select (select version from site_contracts c where c.workspace_id = w.id and c.active) as contract_version,
      (select count(*) from content_rows c where c.workspace_id = w.id and c.collection = 'pages') as pages,
      (select count(*) from content_rows c where c.workspace_id = w.id and c.collection <> 'pages') as other_rows from workspaces w where w.slug = ${lit(slug)}`);
  const after = sql.fingerprint();
  return result(true, 'ok', { workspace: slug, planned: plan, stored: counts.rows[0] || null, changed: before === null || before !== after });
}

export function seedGroup(ctx) {
  const verb = ctx.positionals[1];
  if (verb === 'test') return seedTest(ctx);
  if (verb === 'workspace') return seedWorkspace(ctx);
  throw new Usage('seed <test|workspace>');
}
