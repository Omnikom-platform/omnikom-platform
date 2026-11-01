// Publishes the test site the way the dashboard does, as owner-a, through GitHub (step 4.5 done-when).
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node sites/test-demo-a/publish.mjs --rows-file <stage.mjs --out file>
//        [--hero "<text>"] [--wait]
//   ... publish.mjs --job <uuid>   only waits on that job and checks the preview (the forced-failure run is started by hand:
//        omnikom publish (SQL path, no dispatch) then gh workflow run publish.yml -f job_id -f site_id -f force_fail=heading)
// --rows-file   the rows to publish (stage.mjs --out writes it); each is published at its LATEST version, read from staging
// --hero        first saves the home page with this hero heading (the save function, owner-a): the "content change by a save" proof
// --wait        reads the job on staging every 15 s (at most 30 minutes) until done or failed, then prints its events, its error and gate
//               report, and asks the preview host for `/`: HTTP status, X-Robots-Tag, and whether the page holds the hero heading
// The publish function dispatches the job to GitHub (publish.yml); nothing here deploys. Prints ids and states, never a token, key or URL
// with a token. Exit 0 = the job ended done (or was started, without --wait); 1 = it failed or a step failed; 2 = usage; 3 = a name missing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveTarget } from '../../tools/omnikom-cli/lib/target.mjs';
import { parseIdentity, personToken } from '../../tools/omnikom-cli/lib/identity.mjs';
import { callFunction } from '../../tools/omnikom-cli/lib/fn.mjs';
import { makeSql, uuidLit } from '../../tools/omnikom-cli/lib/sql.mjs';

const WS_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const SITE_A = 'aaaaaaaa-0000-0000-0000-00000000517e';
const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const die = (code, msg) => { console.error(msg); process.exit(code); };
const rowsFile = opt('--rows-file'), hero = opt('--hero'), onlyJob = opt('--job');
const wait = argv.includes('--wait') || !!onlyJob;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (onlyJob ? !UUID.test(onlyJob) || rowsFile || hero : !rowsFile || (argv.includes('--hero') && !hero)) die(2, 'usage: publish.mjs --rows-file <file> [--hero "<text>"] [--wait] | --job <uuid>');
if (hero && (hero.length > 120 || /[<>"&]/.test(hero))) die(2, '--hero: at most 120 characters, no < > " &');

const target = resolveTarget('staging', process.env, { needDb: false });
if (!target.functionsBase) die(3, 'BLOCKED: STAGING_SUPABASE_REF is not set (read by name)');
if (!process.env.STAGING_DB_URL) die(3, 'BLOCKED: STAGING_DB_URL is not set (read by name)');
const pubKey = process.env[target.vars.publishableKey];
const sql = makeSql({ url: process.env.STAGING_DB_URL, readOnly: true });
const q = query => { const r = sql.rows(query); if (!r.ok) die(1, `FAIL database: ${r.code} ${r.message}`); return r.rows; };

let job = onlyJob;
if (!onlyJob) {
const file = JSON.parse(readFileSync(resolve(rowsFile), 'utf8'));
const listed = (file.rows || []).map(r => ({ key: r.key, id: r.id }));
if (!listed.length) die(2, `no rows in ${rowsFile}`);
const token = await personToken(parseIdentity('owner-a'), { target, env: process.env });
const call = (name, body) => callFunction({ base: target.functionsBase, name, body: JSON.stringify(body), timeoutMs: 60000, extraHeaders: { authorization: `Bearer ${token}`, ...(pubKey ? { apikey: pubKey } : {}) } });
const latest = () => new Map(q(`select row_id, max(n) as n from public.content_versions where row_id in (${listed.map(r => uuidLit(r.id)).join(',')}) group by row_id`).map(r => [r.row_id, r.n]));

if (hero) {
  const home = listed.find(r => r.key === 'page-home');
  if (!home) die(2, 'the rows file has no page-home row');
  const [cur] = q(`select n, data from public.content_versions where row_id = ${uuidLit(home.id)} order by n desc limit 1`);
  const data = structuredClone(cur.data);
  data.sections = data.sections || {};
  data.sections.hero = { ...(data.sections.hero || {}), heading: hero };
  const s = await call('save', { workspace: WS_A, collection: 'pages', row: home.id, data, base: Number(cur.n) });   // 5.2: base is the version the edit started from
  if (s.status !== 200) die(1, `FAIL save: ${s.status} ${s.json && s.json.code || s.error || ''}`);
  console.log(`save 200: page-home ${home.id} now version ${s.json.version} (hero heading changed)`);
}

const versions = latest();
const rows = listed.map(r => r.id), vers = listed.map(r => versions.get(r.id));
if (vers.some(v => !Number.isInteger(v))) die(1, 'FAIL a listed row has no version on staging (run stage.mjs first)');
const p = await call('publish', { site: SITE_A, rows, versions: vers });
if (p.status !== 202 || !p.json) die(1, `FAIL publish: ${p.status} ${p.json && p.json.code || p.error || ''} ${p.json && p.json.problems ? JSON.stringify(p.json.problems).slice(0, 400) : ''}`);
job = p.json.job;
console.log(`publish 202: job ${job}, state ${p.json.state}, dispatched ${p.json.dispatched}${p.json.reason ? ' (' + p.json.reason + ')' : ''}, ${rows.length} rows`);
if (p.json.dispatched !== true) die(1, 'FAIL the publish job was not dispatched');
if (!wait) process.exit(0);
}

const until = Date.now() + 30 * 60 * 1000;
let j;
for (;;) {
  [j] = q(`select state, error, deploy_id, gate_report from public.publish_jobs where id = ${uuidLit(job)}`);
  if (j && (j.state === 'done' || j.state === 'failed')) break;
  if (Date.now() > until) die(1, `FAIL job ${job} still ${j && j.state} after 30 minutes`);
  await new Promise(res => setTimeout(res, 15000));
}
const ev = q(`select state from public.publish_job_events where job_id = ${uuidLit(job)} order by at`).map(e => e.state);
console.log(`JOB ${job}: ${j.state}; events ${ev.join(' > ')}; deploy ${j.deploy_id || '-'}; error ${j.error || '-'}`);
if (j.gate_report) console.log(`gate report: ${JSON.stringify(j.gate_report).slice(0, 600)}`);

// The runner deploys a preview to the Pages branch `preview`, so the address is preview.<deploy_target>.pages.dev (the sites row's
// preview_host is the seed's placeholder on staging; finding sent to the CLI head).
const [s0] = q(`select deploy_target from public.sites where id = ${uuidLit(SITE_A)}`);
const site = { preview_host: `preview.${s0.deploy_target}.pages.dev` };
try {
  const r = await fetch(`https://${site.preview_host}/`, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(30000) });
  const html = await r.text();
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [, ''])[1].replace(/<[^>]+>/g, '').trim();
  console.log(`PREVIEW ${site.preview_host}/: HTTP ${r.status}; x-robots-tag "${r.headers.get('x-robots-tag') || ''}"; h1 "${h1.slice(0, 120)}"${hero ? `; holds the new heading: ${html.includes(hero)}` : ''}`);
} catch (e) { console.log(`PREVIEW ${site.preview_host}/: not reached (${String(e && e.message || e).slice(0, 80)})`); }
process.exit(j.state === 'done' ? 0 : 1);
