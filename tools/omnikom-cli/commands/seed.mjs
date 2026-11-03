// seed test       workspaces A and B, their sites, contracts, test logins: the fixtures of supabase/tests/tenancy.test.sql
//                 (same ids, emails and contract text; a unit test compares them with that file). Workspace A also gets the
//                 test site of sites/test-demo-a/ (contract version N+1 when the file changed, every row of rows.json, its media
//                 row, the preview host); B keeps contract version 1. Idempotent: every insert is "on conflict do nothing" or
//                 guarded by an existence check, a row is found by its key and a changed row gets a new version, so a second run
//                 changes no row (the command proves it with a fingerprint of every table before and after).
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
// where the published test site is served (the platform department's Pages project test-site-demo-a); SITE_B keeps its placeholder host
export const PREVIEW_HOST_A = 'preview.test-site-demo-a.pages.dev';
// the contract text of tenancy.test.sql, as data
export const TEST_CONTRACT = {
  collections: {
    team: {"kind":"collection","access":{"member":"own"},"ownerField":"self","fields":{"name":{"type":"text","required":true},"licence":{"type":"group","locked":{"reason":"fact"}}}},
    listings: {"kind":"collection","access":{"member":"own"},"ownerField":"agent","fields":{"street":{"type":"text","required":true},"status":{"type":"enum","options":["for-sale","sold"],"required":true},"agent":{"type":"reference","to":"team"}}},
    pages: {"kind":"collection","access":{"member":"none"},"fields":{"type":{"type":"text","required":true},"title":{"type":"text","required":true},"seo":{"type":"seo","required":true},"contact":{"type":"group","of":{"phone":{"type":"text","required":true},"hours":{"type":"text"}}},"rooms":{"type":"list","of":{"name":{"type":"text","required":true}}},"free":{"type":"group","open":true,"of":{"x":{"type":"text","required":true}}},"fact":{"type":"group","sourced":true,"of":{"n":{"type":"text","required":true}}},"sections":{"type":"sections"}}},
    settings: {"kind":"singleton","access":{"member":"none"},"fields":{"businessName":{"type":"text"},"licences":{"type":"list","locked":{"reason":"fact"}}}},
    leads: {"kind":"inbox","access":{"member":"own"},"ownerField":"owner","fields":{"status":{"type":"enum"}}},
  },
  forms: {"contact":{"fields":{"name":{"type":"text"},"email":{"type":"email"},"phone":{"type":"phone"},"topic":{"type":"text"},"message":{"type":"text","max":2000}}}},
  pageTypes: {"home":{"sections":[{"id":"hero","kind":"fields","fields":{"headline":{"type":"text","required":true}}},{"id":"extras","kind":"fields","fields":{"note":{"type":"text"}}},{"id":"feed","kind":"feed","accepts":"listings"}]}},
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

// ---------- the test site (sites/test-demo-a/): contract version 2 and the rows of workspace A ----------
// Read from the files the platform department owns (read-only here). `seedTestSql()` with no `site` keeps the earlier content (contract
// version 1, two bare team rows): supabase/functions/test/harness.mjs seeds its function tests with exactly that call and expects it.
const SITE_DIR = ['sites', 'test-demo-a'];
const SEED_ORDER = ['settings', 'team', 'areas', 'notices', 'pages', 'listings'];   // references point backwards
const AGENT_ONE = 'team-agent-one';                                                 // the symbolic id in rows.json that member A1 is linked to
// Agent Two is the CLI's fixture for member A2, not site content (it is not in rows.json)
const AGENT_TWO = { id: 'team-agent-two', collection: 'team', data: { name: 'Agent Two', slug: 'agent-two', role: 'Agent' } };

export async function loadTestSite() {
  const contract = JSON.parse(readFileSync(repoPath(...SITE_DIR, 'contract.json'), 'utf8'));
  const fileRows = JSON.parse(readFileSync(repoPath(...SITE_DIR, 'rows.json'), 'utf8'));
  const logoBytes = readFileSync(repoPath(...SITE_DIR, 'media', 'logo.png')).length;
  const { validateContract, mergeCore } = await importRepo('contracts/validate.mjs');
  const problems = validateContract(contract);
  const resolved = { ...contract, collections: mergeCore(contract) };
  const rows = SEED_ORDER.flatMap(collection => [...fileRows, AGENT_TWO].filter(r => r.collection === collection));
  return { contract, resolved, rows, logoBytes, problems, fileRows };
}

// the pg_temp helper: "ref:<id>" anywhere in a row's data becomes the database id of the row seeded for that id
// (create or replace, and dropped at the end: a transaction pooler hands the next run the same backend, and pg_temp lives as long as it does)
const REF_FUNCTION_SQL = `create or replace function pg_temp.omk_ref(v jsonb, ids jsonb) returns jsonb language plpgsql as $omk_ref$
declare r jsonb; k text; e jsonb; t text;
begin
  t := jsonb_typeof(v);
  if t = 'string' then
    if (v #>> '{}') like 'ref:%' then
      k := substr(v #>> '{}', 5);
      if ids -> k is null then raise exception 'S-SEED-REF: no row was seeded for %', k; end if;
      return ids -> k;
    end if;
    return v;
  elsif t = 'object' then
    r := '{}'::jsonb;
    for k, e in select o.key, o.value from jsonb_each(v) o loop r := r || jsonb_build_object(k, pg_temp.omk_ref(e, ids)); end loop;
    return r;
  elsif t = 'array' then
    select coalesce(jsonb_agg(pg_temp.omk_ref(x.value, ids) order by x.ord), '[]'::jsonb) into r from jsonb_array_elements(v) with ordinality x(value, ord);
    return r;
  end if;
  return v;
end $omk_ref$;`;

// Contract version N+1 when the file changed, the media row of the logo, every row of rows.json (found by its key, created once, a changed
// row gets a NEW VERSION and never a second row), the agents' links, the preview host. One script, so a refusal leaves nothing half-seeded.
function siteSql({ contract, resolved, rows, logoBytes }) {
  const staff = uuidLit(P.staff.sub), a = uuidLit(WS_A);
  const ref = lit(SEED_REF);
  const uuidRe = lit('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');
  return `${REF_FUNCTION_SQL}
do $omk_contract$
declare a uuid := ${a}; s uuid := ${staff}; cnt jsonb := ${jsonLit(contract)}; res jsonb := ${jsonLit(resolved)};
begin
  -- the active contract is compared by content, never by number: equal to the file (its core-merged form too) writes nothing
  if not exists (select 1 from site_contracts where workspace_id = a and active and contract = cnt and resolved = res) then
    update site_contracts set active = false where workspace_id = a and active;
    insert into site_contracts (workspace_id, version, contract, resolved, active, created_by)
      values (a, coalesce((select max(version) from site_contracts where workspace_id = a), 0) + 1, cnt, res, true, s);
    insert into audit_log (workspace_id, actor, action, target, detail) values (a, s, 'seed-contract', 'test-demo-a', jsonb_build_object('ref', ${ref}));
  end if;
end $omk_contract$;
do $omk_rows$
declare a uuid := ${a}; s uuid := ${staff}; want jsonb := ${jsonLit(rows)}; ids jsonb; e jsonb; coll text; keyfield text; keyval text;
  payload jsonb; hits uuid[]; rid uuid; cur jsonb; curn int; mid uuid; logo text;
begin
  -- the logo: the media row that A's settings already name when there is one (the platform's upload path makes it), else <workspace id>/logo.png, inserted once
  select l.data #>> '{logo,asset}' into logo from content_rows c join lateral (select v.data from content_versions v where v.row_id = c.id order by v.n desc limit 1) l on true
    where c.workspace_id = a and c.collection = 'settings' and c.deleted_at is null limit 1;
  mid := null;
  if logo ~ ${uuidRe} then select m.id into mid from media m where m.id = logo::uuid and m.workspace_id = a; end if;
  if mid is null then
    select m.id into mid from media m where m.workspace_id = a and m.path = a::text || '/logo.png';
    if mid is null then
      insert into media (workspace_id, path, width, height, bytes, processed, exif_stripped, rights_confirmed, uploaded_by)
        values (a, a::text || '/logo.png', 400, 400, ${Number(logoBytes)}, true, true, true, s) returning id into mid;
      insert into audit_log (workspace_id, actor, action, target, detail) values (a, s, 'seed-media', mid::text, jsonb_build_object('ref', ${ref}));
    end if;
  end if;
  ids := jsonb_build_object('media-logo', mid::text);

  for e in select x.value from jsonb_array_elements(want) with ordinality x(value, ord) order by x.ord loop
    coll := e ->> 'collection';
    payload := pg_temp.omk_ref(e -> 'data', ids);
    hits := null;
    if coll = 'settings' then
      keyval := 'the one row';
      select array_agg(c.id order by c.id) into hits from content_rows c where c.workspace_id = a and c.collection = 'settings' and c.deleted_at is null;
    else
      keyfield := case when coll = 'pages' then 'path' else 'slug' end;
      keyval := payload ->> keyfield;
      select array_agg(c.id order by c.id) into hits from content_rows c join lateral (select v.data from content_versions v where v.row_id = c.id order by v.n desc limit 1) l on true
        where c.workspace_id = a and c.collection = coll and c.deleted_at is null and l.data ->> keyfield = keyval;
      if hits is null and coll = 'team' then   -- a row of the earlier seed has no slug: it is found by name and repaired, not duplicated
        select array_agg(c.id order by c.id) into hits from content_rows c join lateral (select v.data from content_versions v where v.row_id = c.id order by v.n desc limit 1) l on true
          where c.workspace_id = a and c.collection = 'team' and l.data ->> 'slug' is null and l.data ->> 'name' = payload ->> 'name';
      end if;
    end if;
    if cardinality(hits) > 1 then raise exception 'S-SEED-AMBIGUOUS: collection % key % finds % live rows: %', coll, keyval, cardinality(hits), hits; end if;
    if hits is null then
      rid := service.seed_version(a, coll, payload, s, ${ref});
    else
      rid := hits[1];
      select v.n, v.data into curn, cur from content_versions v where v.row_id = rid order by v.n desc limit 1;
      if cur is distinct from payload then
        insert into content_versions (row_id, n, workspace_id, data, by, sign_off) values (rid, curn + 1, a, payload, s, jsonb_build_object('by', s, 'ref', ${ref}));
        insert into audit_log (workspace_id, actor, action, target, detail) values (a, s, 'seed', coll || ':' || rid, jsonb_build_object('ref', ${ref}, 'version', curn + 1));
      end if;
    end if;
    ids := ids || jsonb_build_object(e ->> 'id', rid::text);
  end loop;

  update members set team_row_id = (ids ->> ${lit(AGENT_ONE)})::uuid where workspace_id = a and user_id = ${uuidLit(P['member-a1'].sub)} and team_row_id is distinct from (ids ->> ${lit(AGENT_ONE)})::uuid;
  update members set team_row_id = (ids ->> ${lit(AGENT_TWO.id)})::uuid where workspace_id = a and user_id = ${uuidLit(P['member-a2'].sub)} and team_row_id is distinct from (ids ->> ${lit(AGENT_TWO.id)})::uuid;
  update sites set preview_host = ${lit(PREVIEW_HOST_A)} where id = ${uuidLit(SITE_A)} and preview_host is distinct from ${lit(PREVIEW_HOST_A)};
  if found then
    insert into audit_log (workspace_id, actor, action, target, detail) values (a, s, 'seed-site', 'test-site-demo-a', jsonb_build_object('preview_host', ${lit(PREVIEW_HOST_A)}));
  end if;
end $omk_rows$;
drop function pg_temp.omk_ref(jsonb, jsonb);`;
}

// the content earlier versions of this command seeded (contract version 1, two bare team rows); the function tests of the platform
// department seed with it (supabase/functions/test/harness.mjs calls seedTestSql() with no argument)
function legacyContentSql() {
  return `do $seed$
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
end $seed$;`;
}

// site: the result of loadTestSite() (the command passes it); without it the earlier content is seeded
export function seedTestSql({ alertTo = null, site = null } = {}) {
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
${site ? siteSql(site) : legacyContentSql()}
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
  const site = await loadTestSite();
  if (site.problems.length) return result(false, site.problems[0].code, { problems: site.problems.slice(0, 20), total: site.problems.length, error: 'sites/test-demo-a/contract.json does not validate (a finding for the platform department, not fixed here)' });
  if (!site.rows.some(r => r.id === AGENT_ONE)) return result(false, 'SITE-FILES', { error: `sites/test-demo-a/rows.json has no row with id ${AGENT_ONE} (member A1 is linked to it)` });
  const before = sql.fingerprint();
  const r = sql.exec(seedTestSql({ alertTo: alertTo || null, site }));
  if (!r.ok) return fromSql(r);
  const after = sql.fingerprint();
  const stats = sql.rows(`select (select version from site_contracts where workspace_id = ${uuidLit(WS_A)} and active) as "contractVersion",
      (select coalesce(jsonb_object_agg(t.collection, t.n), '{}'::jsonb) from (select collection, count(*) as n from content_rows where workspace_id = ${uuidLit(WS_A)} and deleted_at is null group by collection) t) as rows,
      (select count(*) from media where workspace_id = ${uuidLit(WS_A)}) as media`);
  const s = stats.rows[0] || {};
  const counts = Object.fromEntries(SEED_ORDER.map(c => [c, Number((s.rows || {})[c] || 0)]));
  return result(true, 'ok', {
    workspaces: { a: { id: WS_A, slug: 'test-demo-a', site: SITE_A }, b: { id: WS_B, slug: 'test-demo-b', site: SITE_B } },
    logins: LOGINS,
    testSite: { contractVersion: s.contractVersion === undefined ? null : Number(s.contractVersion), rows: counts, media: Number(s.media || 0) },
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
