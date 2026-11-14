// Offboard a client workspace (work order 37, product row E14): set its state to offboarding, carry out a privacy delete request
// end to end, take down what provision.mjs set up (--teardown: custom domains, signing keys, the Pages project), and export all of
// its data (every row and its Storage files) to a folder outside any git checkout.
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/client-infra/offboard.mjs --workspace <slug> --out <dir>
//        [--erase <privacy request id>] [--teardown] [--delete] [--dry-run]
// Only a workspace listed in offboard-marked.json (a ruling with an `until` day) is touched; any other is refused before a
// connection is made. Order: state, erasure, teardown, export, and with --delete (work order 37b, migration 26) the Storage files deleted
// and the state deleted; the export never holds an erased person and is made before the files go. The erasure
// uses the database's own functions (set_privacy_request_state, delete_lead) as Omnikom staff, then scans every table of the
// workspace for the person's address: the request is marked done only when nothing is left (privacy_requests keeps the address,
// needed to answer the person). The export file holds personal data: it is never written inside a git checkout (this repository
// is public). Every step reads first, so a second run changes nothing ("RESULT: changed 0").
// DNS records are never touched (the owner's click). The workspace's rows stay (the state deleted ends the offboarding; removing
// the rows is not decided).
// Staff act only inside a window (migration 43): withWindows opens one of 1 minute around each staff call; a dry run opens one only for the
// Storage list of --delete on an offboarding workspace (a staff_access row and its audit row: the one write a dry run makes).
// Exit: 0 done, 1 a step failed, 2 refused (nothing written). Staging only.
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export class Refused extends Error {}
const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..');
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SCHEMA = 'omnikom-workspace-export/1';

const sha = (b) => createHash('sha256').update(b).digest('hex');
// Same JSON regardless of object key order (Postgres jsonb keeps keys in its own order).
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
export const contentHash = (doc) => sha(JSON.stringify(canon(doc)));

// The rulings: workspaces marked for offboarding; past its `until` day (UTC) an entry is ignored.
export function loadMarked(file = join(HERE, 'offboard-marked.json'), today = new Date().toISOString().slice(0, 10)) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  return (j.workspaces || []).filter((x) => SLUG_RE.test(x.slug || '') && /^\d{4}-\d{2}-\d{2}$/.test(x.until || '') && today <= x.until && String(x.ruling || '').trim())
    .map((x) => ({ slug: x.slug, ruling: x.ruling }));
}

// The person's address: an email (lowercased) or a number (its digits, 7 or more; of a longer number the last 10, so "+1 555 555
// 0137" also finds "(555) 555-0137": service.open_privacy_request compares all digits and would miss it, a finding for platform).
export function subjectKey(subject) {
  const s = String(subject || '').trim();
  if (s.includes('@')) return { email: s.toLowerCase() };
  const digits = s.replace(/[^0-9]/g, '');
  return digits.length >= 7 ? { digits: digits.slice(-10) } : null;
}

// o: { slug, outDir, erase, dryRun, marked, insideGit }   d: { db, storage, fs, log }   (offboard-live.mjs builds the real ones)
// The refusals that need nothing but the arguments and the rulings: run before any connection is made.
export function precheck(o) {
  if (!SLUG_RE.test(o.slug || '')) throw new Refused(`--workspace ${o.slug}: expected a workspace slug`);
  const m = (o.marked || []).find((x) => x.slug === o.slug);
  if (!m) throw new Refused(`${o.slug} is not marked for offboarding (offboard-marked.json): nothing is touched`);
  if (!o.outDir) throw new Refused('--out <dir> is needed: the export goes to a folder outside any git checkout');
  if (o.insideGit) throw new Refused(`--out ${o.outDir} is inside a git checkout: the export holds personal data and this repository is public`);
  if (o.erase != null && !UUID_RE.test(o.erase)) throw new Refused(`--erase ${o.erase}: expected a privacy request id`);
  if (o.del && !o.teardown) throw new Refused('--delete needs --teardown: the database refuses the state deleted while a key is not revoked');
  return m;
}

// Each staff call of the database gets a window of its own (migration 43): 1 minute, the least it takes (private.is_staff() reads the clock
// once, when the call's transaction starts), a reason that names this tool and the call, closed after the call whatever happened. The reads
// and the direct updates of offboard-live.mjs use the connection's own rights, not the staff claims: no window.
const STAFF_CALLS = ['setState', 'setTicket', 'deleteLead', 'offboardingStorage'];
function withWindows(db) {
  const wrapped = { ...db };
  for (const name of STAFF_CALLS) {
    wrapped[name] = async (...args) => {
      const until = await db.staffOpen(`tools/client-infra/offboard.mjs ${name}`, 1);
      try { return await db[name](...args); } finally { await db.staffClose(until); }
    };
  }
  return wrapped;
}

export async function offboard(o, deps) {
  const mark = precheck(o);
  const d = { ...deps, db: withWindows(deps.db) };
  const out = { changed: 0, failed: [] };
  const log = d.log, would = (what, call) => log(`would  ${what}  [${call}]`), did = (what) => { out.changed++; log(`done   ${what}`); };
  const fail = (what, msg) => { out.failed.push(what); log(`FAIL   ${msg}`); };

  // 0 the workspace and the staff identity that acts
  const ws = await d.db.workspace(o.slug);
  if (!ws) throw new Refused(`workspace ${o.slug} does not exist`);
  if (!(await d.db.staffOk())) throw new Error('the staff test identity is not in public.staff: the database functions would refuse it');

  // 1 the state: active or suspended -> offboarding (the only legal moves into it); offboarding already = nothing to do; deleted (with
  // --delete) = an earlier run finished: only the checks run
  const gone = ws.state === 'deleted' && o.del;
  if (gone) log(`ok     ${o.slug} is deleted (since ${ws.state_changed_at || '?'})`);
  else if (ws.state === 'offboarding') log(`ok     ${o.slug} is offboarding (since ${ws.state_changed_at || '?'})`);
  else if (ws.state === 'active' || ws.state === 'suspended') {
    if (o.dryRun) would(`set ${o.slug} ${ws.state} -> offboarding, reason "${mark.ruling}"`, 'psql: service.set_workspace_state as staff');
    else {
      await d.db.setState(ws.id, 'offboarding', mark.ruling);
      const after = await d.db.workspace(o.slug);
      if (!after || after.state !== 'offboarding') throw new Error(`the state is ${after && after.state} after set_workspace_state, expected offboarding`);
      did(`set ${o.slug} ${ws.state} -> offboarding`);
    }
  } else throw new Refused(`${o.slug} is ${ws.state}: only an active or suspended workspace moves to offboarding`);

  // 2 the privacy delete request, end to end
  let key = null;
  if (o.erase) {
    const t = await d.db.ticket(o.erase);
    if (!t || t.workspace_id !== ws.id) throw new Refused(`privacy request ${o.erase} is not one of ${o.slug}'s`);
    if (t.kind !== 'delete') throw new Refused(`privacy request ${o.erase} is a ${t.kind} request, not delete`);
    if (t.state === 'refused') throw new Refused(`privacy request ${o.erase} was refused: nothing to carry out`);
    key = subjectKey(t.subject);
    if (!key) throw new Refused(`privacy request ${o.erase}: its subject is neither an email nor a number`);
    const leads = await d.db.subjectLeads(ws.id, t.subject, t.lead_ids || []);
    if (t.state === 'done') {
      const left = await d.db.scan(ws.id, key);
      if (leads.length || left.length) fail('erasure', `privacy request ${o.erase} is done but the person is still found: ${[...(leads.length ? [`${leads.length} lead(s)`] : []), ...left.map((x) => `${x.table} ${x.n}`)].join(', ')}`);
      else log(`ok     privacy request ${o.erase} done; the person is found nowhere in ${o.slug}`);
    } else if (o.dryRun) {
      if (t.state !== 'in-progress') would(`move privacy request ${o.erase} ${t.state} -> in-progress`, 'psql: service.set_privacy_request_state as staff');
      would(`delete ${leads.length} lead(s) of the person (their events, tasks, bookings and reads go with them)`, 'psql: service.delete_lead as staff');
      would(`scan every table of ${o.slug} for the person; mark the request done only if nothing is left`, 'psql: read-only scan, then service.set_privacy_request_state');
    } else {
      if (t.state !== 'in-progress') { await d.db.setTicket(o.erase, 'in-progress', null); did(`privacy request ${o.erase} ${t.state} -> in-progress`); }
      for (const id of leads) { await d.db.deleteLead(id, `privacy request ${o.erase}`); did(`deleted lead ${id} (service.delete_lead)`); }
      const left = await d.db.scan(ws.id, key);
      const again = await d.db.subjectLeads(ws.id, t.subject, []);
      if (left.length || again.length) fail('erasure', `the person is still found after the deletes: ${[...(again.length ? [`${again.length} lead(s)`] : []), ...left.map((x) => `${x.table} ${x.n}`)].join(', ')}; the request stays in-progress (finding for platform: no function erases these)`);
      else {
        await d.db.setTicket(o.erase, 'done', `carried out by tools/client-infra/offboard.mjs: ${leads.length} lead(s) deleted with service.delete_lead; a scan of every table of the workspace found the person nowhere`);
        did(`privacy request ${o.erase} -> done (${leads.length} lead(s) deleted, scan clean)`);
      }
    }
  }

  // 3 teardown (--teardown), per site of the workspace: the Pages custom domains detached and sites.domain cleared, the site's
  // signing keys revoked, the Pages project deleted. Before the export, so the export is the final state and a second run equals it.
  // DNS records are not touched (the owner's click); Storage files and the deleted state need database functions (H2-6, open).
  if (o.teardown) {
    for (const s of await d.db.sites(ws.id)) {
      const name = s.deploy_target;
      const project = name ? await d.cf.getProject(name) : null;
      const hosts = project ? (await d.cf.listDomains(name)).map((x) => x.name) : [];
      for (const h of hosts) {
        if (o.dryRun) would(`detach custom domain ${h} from Pages project ${name}`, 'Cloudflare DELETE pages/projects/<name>/domains/<host>');
        else {
          await d.cf.detachDomain(name, h);
          if ((await d.cf.listDomains(name)).some((x) => x.name === h)) fail('teardown', `${h} is still on ${name} after the delete`);
          else did(`detached custom domain ${h} from ${name}`);
        }
      }
      if (s.domain) {
        if (o.dryRun) would(`clear sites.domain ${s.domain} of ${name} (that one row)`, 'psql: update by the site id, exactly 1 row, audit_log');
        else { await d.db.clearSiteDomain(s.id, s.domain); did(`cleared sites.domain ${s.domain} of ${name}`); }
        log(`note   a DNS record for ${s.domain}, if there is one, is left as it is: DNS is the owner's click`);
      }
      const keys = await d.db.activeKeys(s.id);
      for (const k of keys) {
        if (o.dryRun) would(`revoke signing key ${k.vault_ref || k.id} of ${name}`, 'psql: api_keys.revoked_at by the key id, exactly 1 row, audit_log');
        else { await d.db.revokeKey(s.id, k.id); did(`revoked signing key ${k.vault_ref || k.id} of ${name}`); }
      }
      if (!o.dryRun && keys.length && (await d.db.activeKeys(s.id)).length) fail('teardown', `${name} still has an active signing key after the revoke`);
      if (!keys.length) log(`ok     ${name || s.id}: no active signing key`);
      if (!project) log(`ok     ${name || s.id}: no Pages project`);
      else if (o.dryRun) would(`delete Pages project ${name} (its deployments and settings go with it)`, 'Cloudflare DELETE pages/projects/<name>');
      else {
        await d.cf.deleteProject(name);
        if (await d.cf.getProject(name)) fail('teardown', `Pages project ${name} is still there after the delete`);
        else { await d.db.audit(ws.id, 'pages-project-delete', name); did(`deleted Pages project ${name}`); }
      }
    }
  }

  if (!o.teardown) log('skip   teardown (runs with --teardown)');

  // 4 the export: every row of every table of the workspace, the logins, and the Storage files. A deleted workspace's export is the one
  // made before its files went: it is checked to be there, never made again.
  let exportOk = false;
  if (gone) {
    const file = join(o.outDir, o.slug, 'export.json');
    let prev = null;
    try { prev = d.fs.exists(file) ? JSON.parse(d.fs.read(file).toString('utf8')) : null; } catch { prev = null; }
    if (!prev || prev.schema !== SCHEMA) fail('export', `${o.slug} is deleted but ${file} is not its export`);
    else log(`ok     ${file} is the export made before the deletion (content sha256 ${String(prev.content_sha256).slice(0, 16)})`);
  } else if (o.dryRun) {
    const plan = await d.db.exportPlan(ws.id);
    would(`export ${plan.rows} rows from ${plan.tables} tables, ${plan.logins} login(s) and ${plan.files} Storage file(s) to ${join(o.outDir, o.slug)}`, 'psql: read-only; Storage REST GET');
  } else if (!out.failed.includes('erasure')) {
    const data = await d.db.exportData(ws.id);
    const short = Object.keys(data.counts).filter((t) => (data.tables[t] || []).length !== data.counts[t]);
    if (short.length) fail('export', `the export does not match the row counts in ${short.map((t) => `${t} (${(data.tables[t] || []).length} of ${data.counts[t]})`).join(', ')}`);
    else {
      const dir = join(o.outDir, o.slug);
      const files = [];
      for (const ob of await d.storage.list(ws.id)) {
        const rel = ob.name.slice(ws.id.length + 1);
        if (!ob.name.startsWith(`${ws.id}/`) || !rel || rel.split('/').some((p) => p === '' || p === '.' || p === '..')) { fail('export', `Storage object ${ob.name} is not a plain path under the workspace folder`); continue; }
        const body = await d.storage.get(ob.name);
        if (ob.size != null && body.length !== Number(ob.size)) { fail('export', `Storage object ${ob.name}: got ${body.length} bytes, Storage says ${ob.size}`); continue; }
        const target = join(dir, 'files', ...rel.split('/'));
        const h = sha(body);
        if (!(d.fs.exists(target) && sha(d.fs.read(target)) === h)) { d.fs.write(target, body); did(`saved Storage file ${rel} (${body.length} bytes)`); }
        files.push({ path: rel, bytes: body.length, sha256: h });
      }
      const doc = { schema: SCHEMA, workspace: data.workspace, tables: data.tables, logins: data.logins, files };
      const h = contentHash(doc);
      const file = join(dir, 'export.json');
      let prev = null;
      try { prev = d.fs.exists(file) ? JSON.parse(d.fs.read(file).toString('utf8')) : null; } catch { prev = null; }
      const nRows = Object.values(data.tables).reduce((a, r) => a + r.length, 0);
      if (prev && prev.content_sha256 === h) log(`ok     ${file} is current (${nRows} rows, ${files.length} files, content sha256 ${h.slice(0, 16)})`);
      else {
        d.fs.write(file, Buffer.from(JSON.stringify({ exported_at: new Date().toISOString(), content_sha256: h, ...doc }, null, 1) + '\n'));
        did(`exported ${nRows} rows from ${Object.keys(data.tables).length} tables, ${data.logins.length} login(s), ${files.length} file(s) to ${file}`);
      }
      // read back: the file on disk is the export, and an erased person is not in it
      const back = JSON.parse(d.fs.read(file).toString('utf8'));
      const { exported_at: _a, content_sha256: _c, ...body } = back;
      if (contentHash(body) !== h || back.content_sha256 !== h) fail('export', `${file} does not read back as the export`);
      // privacy_requests keeps the address of each request (needed to answer the person); everywhere else it must be gone
      const { privacy_requests: _p, ...rest } = body.tables || {};
      if (key && hasSubject(JSON.stringify({ ...body, tables: rest }), key)) fail('export', `${file} still holds the erased person outside privacy_requests`);
      else { exportOk = !out.failed.includes('export'); log(`ok     ${file} reads back (content sha256 ${h.slice(0, 16)})${key ? '; the erased person is not in it (privacy_requests keeps the request)' : ''}`); }
    }
  } else log('skip   the export: the erasure failed, and an export must never hold the person');

  // 5 the end (--delete, with --teardown): the workspace's files deleted through the Storage API (Supabase refuses a SQL delete), from the
  // list service.offboarding_storage gives staff for an offboarding workspace; then offboarding -> deleted, which the database refuses
  // while a file or an unrevoked key is left (migration 26). Only after this run's export read back and nothing failed.
  if (o.del && !gone) {
    if (o.dryRun) {
      const paths = ws.state === 'offboarding' ? await d.db.offboardingStorage(ws.id) : null;
      would(`delete ${paths ? paths.length : 'the'} Storage file(s) of ${o.slug}, then set it offboarding -> deleted`, 'psql: service.offboarding_storage as staff; Storage REST DELETE; service.set_workspace_state');
    } else if (out.failed.length || !exportOk) log('skip   the deletion: an earlier step failed or the export is not confirmed');
    else {
      const paths = await d.db.offboardingStorage(ws.id);
      if (paths.some((p) => !p.startsWith(`${ws.id}/`))) fail('delete', 'service.offboarding_storage listed a path outside the workspace folder; nothing deleted');
      else {
        if (paths.length) { await d.storage.remove(paths); did(`deleted ${paths.length} Storage file(s) of ${o.slug} (Storage API)`); }
        const left = await d.db.offboardingStorage(ws.id);
        if (left.length) fail('delete', `${left.length} Storage file(s) are still there after the delete; the state stays offboarding`);
        else {
          await d.db.setState(ws.id, 'deleted', `${mark.ruling}; export ${join(o.outDir, o.slug, 'export.json')}`);
          const after = await d.db.workspace(o.slug);
          if (!after || after.state !== 'deleted') fail('delete', `the state is ${after && after.state} after set_workspace_state, expected deleted`);
          else did(`set ${o.slug} offboarding -> deleted`);
        }
      }
    }
  } else if (!o.del) log('next   the end runs with --delete (with --teardown): the Storage files deleted, then the state deleted');
  log(`${o.dryRun ? 'DRY RUN' : 'RESULT'}: changed ${out.changed}${out.failed.length ? `, FAILED ${out.failed.join(', ')}` : ''}`);
  return out;
}

// The text holds the person's email (any case) or their number (digits with up to 3 of " -.()+" between them).
export function hasSubject(text, key) {
  if (key.email) return String(text).toLowerCase().includes(key.email);
  return new RegExp(key.digits.split('').join('[-. ()+]{0,3}')).test(String(text));
}

export function parseArgs(argv) {
  const o = { dryRun: false, erase: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--workspace') { o.slug = argv[++i]; if (!o.slug) throw new Refused('--workspace needs a slug'); }
    else if (a === '--out') { o.outDir = argv[++i]; if (!o.outDir) throw new Refused('--out needs a folder'); }
    else if (a === '--erase') { o.erase = argv[++i]; if (!o.erase) throw new Refused('--erase needs a privacy request id'); }
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--teardown') o.teardown = true;
    else if (a === '--delete') o.del = true;
    else if (a === '--target') { if (argv[++i] !== 'staging') throw new Refused(`--target ${argv[i]}: only staging is built (work order 37); production is the owner's click`); }
    else throw new Refused(`unknown argument ${a}`);
  }
  if (!o.slug || !o.outDir) throw new Refused('usage: --workspace <slug> --out <dir> [--erase <privacy request id>] [--teardown] [--delete] [--dry-run]');
  if (!isAbsolute(o.outDir)) o.outDir = resolve(o.outDir);
  return o;
}

// The folder (or its nearest existing parent) is inside a git working tree, or inside this repository.
export function insideGit(dir, gitTop, repo = REPO) {
  const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const d = norm(resolve(dir)), r = norm(resolve(repo));
  if (d === r || d.startsWith(r + sep)) return true;
  return gitTop(dir) !== null;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); }
})();
if (isMain) {
  let code = 0;
  try {
    const o = parseArgs(process.argv.slice(2));
    o.marked = loadMarked();
    const { gitTop, offboardDeps } = await import('./offboard-live.mjs');
    o.insideGit = insideGit(o.outDir, gitTop);
    precheck(o);
    const r = await offboard(o, offboardDeps({ log: (l) => console.log(l) }));
    code = r.failed.length ? 1 : 0;
  } catch (e) {
    console.error(`${e instanceof Refused ? 'REFUSED' : 'FAIL'}: ${e.message}`);
    code = e instanceof Refused ? 2 : 1;
  }
  process.exit(code);
}
