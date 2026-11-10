// The staging proof of work order 37 (E14), on the test client test-wo37 only (made first with
// onboard.mjs --intake work/37-offboard/test-wo37.intake.json --no-invite).
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/client-infra/proof-offboard.mjs --seed
//        gives test-wo37 what an offboarding has to deal with, each only when missing (twice = no change):
//        two leads (erase-me-wo37@example.com with a note, keep-me-wo37@example.com) through service.add_lead as staff; one
//        Storage file <workspace id>/wo37-test.png (a 1x1 PNG); sites.domain wo37-test.example.com (the database only; a Pages custom
//        domain only with --pages-domain <host>, a ruling: Cloudflare refuses example.com as reserved); a privacy delete request for
//        erase-me-wo37@example.com through service.open_privacy_request as staff. Prints the request id.
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/client-infra/proof-offboard.mjs --check --out <dir>
//        checks the outcome with its own queries, not offboard.mjs's: the state, the request, the leads, the keys, the domain, the
//        Pages project, and the export file (its hash, its row counts against the database, its Storage file, no erased person).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveTarget } from '../omnikom-cli/lib/target.mjs';
import { parseIdentity, claimsFor } from '../omnikom-cli/lib/identity.mjs';
import { contentHash } from './offboard.mjs';

const SLUG = 'test-wo37', SITE = 'test-site-wo37', HOST = 'wo37-test.example.com';
const ERASE = 'erase-me-wo37@example.com', KEEP = 'keep-me-wo37@example.com', FILE = 'wo37-test.png';
const need = (n) => { const v = process.env[n]; if (!v) throw new Error(`set ${n} (read by name, never printed)`); return v; };
const dbUrl = need('STAGING_DB_URL'), pagesToken = need('CLOUDFLARE_PAGES_TOKEN'), account = need('CLOUDFLARE_ACCOUNT_ID');
const target = resolveTarget('staging', process.env, { needDb: false });
const secret = need(target.vars.secretKey);
const claims = JSON.stringify(claimsFor(parseIdentity('staff')));
const scrub = (s) => [dbUrl, pagesToken, account, secret].reduce((t, x) => t.split(x).join('[hidden]'), String(s));

const quote = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/\r?\n/g, '\\n')}'`;
const psql = (sql, vars = {}) => {
  const head = Object.entries(vars).map(([k, v]) => `\\set ${k} ${quote(v)}\n`).join('');
  const r = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'], { encoding: 'utf8', input: head + sql, timeout: 120000, windowsHide: true });
  if (r.status !== 0) throw new Error(scrub(`psql exit ${r.status}: ${(r.stderr || '').split('\n').slice(0, 3).join(' ')}`));
  return (r.stdout || '').trim();
};
const pages = async (method, rest, body) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects${rest}`, {
    method, headers: { authorization: `Bearer ${pagesToken}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => null);
  return { status: r.status, j };
};
const storageUrl = (name) => `https://${target.ref}.supabase.co/storage/v1/object/media/${name.split('/').map(encodeURIComponent).join('/')}`;
const sHeaders = { apikey: secret, authorization: `Bearer ${secret}` };

const ws = JSON.parse(psql(`select row_to_json(x) from (select w.id, w.state::text as state, s.id as site_id, s.domain from public.workspaces w join public.sites s on s.workspace_id = w.id
  where w.slug = :'slug' and s.deploy_target = :'site') x;`, { slug: SLUG, site: SITE }) || 'null');
if (!ws) { console.error(`FAIL: ${SLUG} with site ${SITE} is not on staging (run onboard.mjs first)`); process.exit(1); }

const mode = process.argv[2];
let bad = 0;
const say = (ok, what) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); };

if (mode === '--seed') {
  for (const [name, email, phone] of [['Erase Me WO37', ERASE, '(555) 555-0137'], ['Keep Me WO37', KEEP, '(555) 555-0138']]) {
    const has = psql(`select id from public.leads where workspace_id = :'ws'::uuid and lower(email) = :'e' limit 1;`, { ws: ws.id, e: email });
    if (has) { console.log(`ok   lead ${email} is there`); continue; }
    const id = psql(`select service.add_lead(:'c'::jsonb, :'site'::uuid, :'n', :'e', :'p', '{"message":"work order 37 test lead"}'::jsonb, 'Test consent text (work order 37).', 'manual', null);`,
      { c: claims, site: ws.site_id, n: name, e: email, p: phone });
    if (email === ERASE) psql(`select service.lead_update(:'c'::jsonb, :'id'::uuid, null::public.lead_status, null::uuid, 'work order 37 note: called, left a message', false);`, { c: claims, id });
    console.log(`done lead ${email} (${id})`);
  }
  const objName = `${ws.id}/${FILE}`;
  if (psql(`select count(*) from storage.objects where bucket_id = 'media' and name = :'n';`, { n: objName }) === '1') console.log(`ok   Storage file ${FILE} is there`);
  else {
    // the media bucket takes images only (text/plain: HTTP 415, 2026-11-10): a 1x1 PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const r = await fetch(storageUrl(objName), { method: 'POST', headers: { ...sHeaders, 'content-type': 'image/png' }, body: png, signal: AbortSignal.timeout(30000) });
    if (r.status !== 200) throw new Error(scrub(`Storage upload: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`));
    console.log(`done Storage file ${FILE}`);
  }
  // the Pages custom domain only with --pages-domain <host> (a ruling): Cloudflare refuses example.com as reserved (8000015, 2026-11-10)
  const pd = process.argv.indexOf('--pages-domain') > 0 ? process.argv[process.argv.indexOf('--pages-domain') + 1] : null;
  const dl = pd ? await pages('GET', `/${SITE}/domains`) : null;
  if (!pd) console.log('skip Pages custom domain: no --pages-domain host given (example.com is refused by Cloudflare as reserved)');
  else if (dl.status !== 200) throw new Error(`Pages domains list: HTTP ${dl.status}`);
  else if ((dl.j.result || []).some((d) => d.name === pd)) console.log(`ok   custom domain ${pd} is on ${SITE}`);
  else {
    const HOST = pd;
    const a = await pages('POST', `/${SITE}/domains`, { name: HOST });
    if (a.status !== 200) throw new Error(`Pages add domain ${HOST}: HTTP ${a.status} ${((a.j && a.j.errors) || []).map((e) => `${e.code} ${e.message}`).join('; ')}`);
    console.log(`done custom domain ${HOST} on ${SITE} (status ${a.j.result.status}; no DNS record is made anywhere)`);
  }
  if (ws.domain === HOST) console.log(`ok   sites.domain is ${HOST}`);
  else if (ws.domain) throw new Error(`sites.domain of ${SITE} is ${ws.domain}, not ${HOST}`);
  else {
    const n = psql(`with c as (update public.sites set domain = :'d' where id = :'id'::uuid and domain is null returning 1) select count(*) from c;`, { d: HOST, id: ws.site_id });
    if (n !== '1') throw new Error(`setting sites.domain changed ${n} rows`);
    console.log(`done sites.domain ${HOST}`);
  }
  let req = psql(`select id from public.privacy_requests where workspace_id = :'ws'::uuid and kind = 'delete' and lower(subject) = :'e' order by received_at limit 1;`, { ws: ws.id, e: ERASE });
  if (req) console.log(`ok   privacy request ${req} is there`);
  else { req = psql(`select service.open_privacy_request(:'c'::jsonb, :'ws'::uuid, 'delete', :'e', 'work order 37 test request');`, { c: claims, ws: ws.id, e: ERASE.toUpperCase() }); console.log(`done privacy request ${req} (subject in capitals on purpose)`); }
  console.log(`REQUEST ${req}`);
} else if (mode === '--check') {
  const out = process.argv[4];
  if (process.argv[3] !== '--out' || !out) throw new Error('usage: --check --out <dir>');
  const st = JSON.parse(psql(`select json_build_object(
    'state', (select state::text from public.workspaces where id = :'ws'::uuid),
    'req', (select json_build_object('state', state::text, 'notes', notes) from public.privacy_requests where workspace_id = :'ws'::uuid and kind = 'delete' and lower(subject) = :'e' order by received_at limit 1),
    'erase', (select count(*) from public.leads where workspace_id = :'ws'::uuid and lower(email) = :'e'),
    'keep', (select count(*) from public.leads where workspace_id = :'ws'::uuid and lower(email) = :'k'),
    'active_keys', (select count(*) from public.api_keys where site_id = :'site'::uuid and kind = 'site-signing' and revoked_at is null),
    'revoked_keys', (select count(*) from public.api_keys where site_id = :'site'::uuid and kind = 'site-signing' and revoked_at is not null),
    'domain', (select domain from public.sites where id = :'site'::uuid),
    'audit', (select json_agg(action order by at) from public.audit_log where workspace_id = :'ws'::uuid and action in ('workspace-offboarding', 'privacy-request-in-progress', 'privacy-request-done', 'lead-delete', 'site-domain-detach', 'key-revoke', 'pages-project-delete')));`,
  { ws: ws.id, site: ws.site_id, e: ERASE, k: KEEP }));
  console.log(`state: ${JSON.stringify(st)}`);
  say(st.state === 'offboarding', 'the workspace is offboarding');
  say(st.req && st.req.state === 'done', `the privacy request is done (${st.req && st.req.notes})`);
  say(st.erase === 0 && st.keep === 1, 'the erased lead is gone, the other lead is there');
  say(st.active_keys === 0 && st.revoked_keys >= 1, `no active signing key (${st.revoked_keys} revoked)`);
  say(st.domain === null, 'sites.domain is cleared');
  const p = await pages('GET', `/${SITE}`);
  say(p.status === 404, `Pages project ${SITE}: HTTP ${p.status} (404 = deleted)`);
  const file = join(out, SLUG, 'export.json');
  say(existsSync(file), `the export file is there`);
  if (existsSync(file)) {
    const raw = readFileSync(file, 'utf8');
    const ex = JSON.parse(raw);
    const { exported_at, content_sha256, ...body } = ex;
    say(contentHash(body) === content_sha256, `the content hash matches (${content_sha256.slice(0, 16)}), exported ${exported_at}`);
    const { privacy_requests: kept, ...rest } = body.tables;
    say(!JSON.stringify({ ...body, tables: rest }).toLowerCase().includes(ERASE) && !/555[-. ()+]{0,3}0137/.test(JSON.stringify({ ...body, tables: rest })), 'the erased person is in no table of the export but privacy_requests');
    say(JSON.stringify(body.tables.leads).includes(KEEP), 'the other lead is in the export');
    const counts = JSON.parse(psql(`select json_build_object('leads', (select count(*) from public.leads where workspace_id = :'ws'::uuid), 'content_rows', (select count(*) from public.content_rows where workspace_id = :'ws'::uuid),
      'audit_log', (select count(*) from public.audit_log where workspace_id = :'ws'::uuid), 'api_keys', (select count(*) from public.api_keys where workspace_id = :'ws'::uuid));`, { ws: ws.id }));
    for (const [t, n] of Object.entries(counts)) say((body.tables[t] || []).length === n, `${t}: ${(body.tables[t] || []).length} rows in the export, ${n} in the database`);
    say(!JSON.stringify(body.tables.api_keys || []).includes('key_hash'), 'api_keys are exported without key_hash');
    const f = (body.files || []).find((x) => x.path === FILE);
    const local = join(out, SLUG, 'files', FILE);
    const r = await fetch(storageUrl(`${ws.id}/${FILE}`), { headers: sHeaders, signal: AbortSignal.timeout(30000) });
    const fresh = Buffer.from(await r.arrayBuffer());
    say(f && existsSync(local) && createHash('sha256').update(readFileSync(local)).digest('hex') === f.sha256 && createHash('sha256').update(fresh).digest('hex') === f.sha256,
      `Storage file ${FILE}: the saved copy, the export's sha256 and a fresh download agree`);
    say(Object.keys(body.tables).length >= 25, `${Object.keys(body.tables).length} tables in the export`);
  }
  console.log(`${bad ? 'CHECK FAIL' : 'CHECK PASS'}: ${bad} problem(s)`);
} else { console.error('usage: --seed | --check --out <dir>'); process.exit(2); }
process.exit(bad ? 1 : 0);
