// The staging proof of work order 35 (E15), on a test client only.
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/client-infra/proof-staging.mjs --seed
//        makes the test client if missing: workspace test-wo35 ("WO35 test client"), site test-site-wo35 (preview). Twice = no change.
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/client-infra/proof-staging.mjs --run --out <dir>
//        1. saves the omnikom.io record list (name, type, proxied, sha256 of the content) to <dir>/zone-before.txt
//        2. provision.mjs --site test-site-wo35 --domain wo35-test.omnikom.io --write-dns --tls-wait-min 15   (the real run)
//        3. one noindex placeholder page deployed to the project, then HTTPS must return it (12 tries, 15 s apart)
//        4. the same provision command again: it must say "changed 0"
//        finally: deletes the CNAME of the host (re-read by id first), the Pages custom domain, sites.domain; then lists the zone
//        again to <dir>/zone-after.txt and prints the diff, which must be empty. One run, never a loop.
// The test client's Pages project, key and site row stay on staging for later runs. Owner ruling 2026-11-10 15:27 (dns-allowed.json).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveDeps } from './live.mjs';
import { loadAllowed } from './provision.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = 'test-site-wo35', HOST = 'wo35-test.omnikom.io', ZONE = 'omnikom.io';
const WRANGLER_VERSION = '4.152.0';   // the pin of factory/runner/publish.mjs and tools/pages-project.mjs
const argv = process.argv.slice(2);
const outDir = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null;
const say = (l) => console.log(l);

if (argv.includes('--seed')) {
  const sql = `insert into public.workspaces (slug, name, industry) values ('test-wo35', 'WO35 test client', 'real-estate') on conflict (slug) do nothing;
insert into public.sites (workspace_id, deploy_target, preview_host)
  select id, '${SITE}', 'preview.${SITE}.pages.dev' from public.workspaces where slug = 'test-wo35' on conflict (deploy_target) do nothing;
select s.deploy_target || ' ' || s.id || ' workspace ' || w.slug from public.sites s join public.workspaces w on w.id = s.workspace_id where s.deploy_target = '${SITE}';`;
  const r = spawnSync('psql', [process.env.STAGING_DB_URL, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'], { encoding: 'utf8', input: sql, timeout: 60000, windowsHide: true });
  if (r.status !== 0) { console.error(`FAIL seed: psql exit ${r.status}: ${(r.stderr || '').split('\n')[0].split(process.env.STAGING_DB_URL || '\0').join('[db]')}`); process.exit(1); }
  say(`test client: ${r.stdout.trim()}`);
  process.exit(0);
}
if (!argv.includes('--run') || !outDir) { console.error('usage: --seed | --run --out <dir>'); process.exit(2); }
if (!loadAllowed().some((a) => a.host === HOST && a.zone === ZONE)) { console.error(`REFUSED: ${HOST} is not (or no longer) in dns-allowed.json`); process.exit(2); }
mkdirSync(outDir, { recursive: true });

const d = liveDeps({ log: say, allowed: loadAllowed() });
const sha = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const snapshot = async (file) => {
  const recs = await d.cf.zoneRecords(ZONE);
  const lines = recs.map((r) => `${r.name}\t${r.type}\tproxied=${r.proxied}\t${sha(r.content)}`).sort();
  writeFileSync(file, lines.join('\n') + '\n');
  return lines;
};
const provision = (label) => {
  const r = spawnSync(process.execPath, [join(HERE, 'provision.mjs'), '--site', SITE, '--domain', HOST, '--write-dns', '--tls-wait-min', '15'], { encoding: 'utf8', timeout: 20 * 60000, windowsHide: true });
  say(`--- ${label}: exit ${r.status}`);
  say(d.scrub(`${r.stdout || ''}${r.stderr || ''}`).trimEnd());
  return r;
};

let code = 1;
const before = await snapshot(join(outDir, 'zone-before.txt'));
say(`zone ${ZONE} before: ${before.length} records (saved to zone-before.txt); ${before.filter((l) => l.startsWith(HOST + '\t')).length} on ${HOST}`);
if (before.some((l) => l.startsWith(HOST + '\t'))) { console.error(`REFUSED: ${HOST} already has a record before the proof; nothing was done`); process.exit(2); }
try {
  const first = provision('run 1 (real)');
  // A project with no deployment has nothing to serve (first proof 2026-11-10 15:45: TLS active per the API, the HTTPS request
  // timed out). One noindex placeholder page goes to the production branch, then HTTPS must answer with it: that is the TLS check.
  const marker = `wo35-proof-${Date.now()}`;
  const page = join(outDir, 'placeholder');
  mkdirSync(page, { recursive: true });
  writeFileSync(join(page, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>test</title><p>${marker}</p>\n`);
  const win = process.platform === 'win32';
  const w = spawnSync(win ? 'npx.cmd' : 'npx', ['--yes', `wrangler@${WRANGLER_VERSION}`, 'pages', 'deploy', page, '--project-name', SITE, '--branch', 'main', '--commit-dirty=true'],
    { encoding: 'utf8', timeout: 420000, shell: win, windowsHide: true, env: { ...process.env, CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_PAGES_TOKEN, WRANGLER_SEND_METRICS: 'false', CI: 'true', npm_config_ignore_scripts: 'true' } });
  say(`placeholder deploy: exit ${w.status}${w.status ? ' ' + d.scrub(`${w.stdout || ''}${w.stderr || ''}`).trim().split('\n').slice(-3).join(' | ') : ''}`);
  let https = false;
  for (let n = 1; n <= 12 && !https && w.status === 0; n++) {   // bounded: 12 tries, 15 s apart (about 4 minutes)
    try {
      const res = await fetch(`https://${HOST}/`, { redirect: 'manual', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
      const body = await res.text();
      https = res.status === 200 && body.includes(marker);
      say(`HTTPS https://${HOST}/ try ${n}: TLS handshake ok, HTTP ${res.status}${https ? ', the placeholder page' : ''}`);
    } catch (e) { say(`HTTPS https://${HOST}/ try ${n}: FAILED ${e.cause ? e.cause.code || e.cause.message : e.message}`); }
    if (!https && n < 12) await new Promise((r) => setTimeout(r, 15000));
  }
  const second = provision('run 2 (must change nothing)');
  const idem = /RESULT: changed 0$/m.test(second.stdout || '');
  say(`idempotent: ${idem ? 'yes (changed 0)' : 'NO'}; HTTPS with TLS: ${https ? 'yes' : 'NO'}`);
  code = first.status === 0 && second.status === 0 && idem && https ? 0 : 1;
} finally {
  say('--- clean-up (finally)');
  try {
    const recs = (await d.cf.dnsRecords(ZONE, HOST)).filter((r) => r.name === HOST && r.type === 'CNAME');
    for (const r of recs) { await d.cf.deleteCname(ZONE, HOST, r.id); say(`deleted DNS CNAME ${HOST} (record ${r.id.slice(0, 8)})`); }
    if (!recs.length) say(`no CNAME on ${HOST} to delete`);
  } catch (e) { code = 1; say(`FAIL clean-up DNS: ${d.scrub(e.message)}`); }
  try {
    const doms = await d.cf.listDomains(SITE).catch(() => []);
    if (doms.some((x) => x.name === HOST)) { await d.cf.deleteDomain(SITE, HOST); say(`deleted Pages custom domain ${HOST} from ${SITE}`); } else say('no Pages custom domain to delete');
  } catch (e) { code = 1; say(`FAIL clean-up Pages domain: ${d.scrub(e.message)}`); }
  try {
    const site = await d.db.getSite(SITE);
    if (site && site.domain) { await d.db.clearDomain(site.id, HOST); say(`cleared sites.domain of ${SITE}`); }
  } catch (e) { code = 1; say(`FAIL clean-up sites.domain: ${d.scrub(e.message)}`); }
  const after = await snapshot(join(outDir, 'zone-after.txt'));
  const gone = before.filter((l) => !after.includes(l)), added = after.filter((l) => !before.includes(l));
  say(`zone ${ZONE} after: ${after.length} records (saved to zone-after.txt)`);
  say(`diff before/after: ${gone.length + added.length === 0 ? 'EMPTY' : `${gone.length} gone, ${added.length} added`}`);
  for (const l of gone) say(`  - ${l.split('\t').slice(0, 2).join(' ')}`);
  for (const l of added) say(`  + ${l.split('\t').slice(0, 2).join(' ')}`);
  if (gone.length + added.length) code = 1;
}
say(code === 0 ? 'PROOF PASS' : 'PROOF FAIL');
process.exit(code);
