// Onboard a client from an intake file (work order 36, product row C14): workspace, site row, contract and pages (through the CLI's
// `omnikom seed workspace`, called, never edited), the starting rows (business details, the owner's team profile), the owner's
// login invite (invite-member, as Omnikom staff), then the site's infrastructure (provision.mjs).
//   node tools/with-env.mjs "creds and accounts login/omnikom.env" -- node tools/client-infra/onboard.mjs --intake <file.json> [--dry-run]
// A half-filled intake is refused with every missing field named, before anything is read or written. Every step reads first and
// writes only what is missing, so a second run changes nothing ("RESULT: changed 0") and sends no second mail. Rows the client may
// already have edited are never overwritten: a difference is reported as a note. --dry-run reads and prints each write it would make.
// Exit: 0 done, 1 a step failed, 2 refused (nothing written), 3 done but waiting (the invite mail was not sent, or provision waits).
// Staging only. The invite goes only to an address in test-inboxes.json (owner rulings, each with an `until` day), never a person.
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export class Refused extends Error {}
const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..', '..');
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PROJECT_RE = /^[a-z0-9][a-z0-9-]{0,56}$/;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()0-9 .-]{7,25}$/;

export const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\x00-\x7f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Every problem of the intake at once, each naming the field: "workspace.name: missing", "owner.email: not an email address".
export function checkIntake(j, { repo = REPO } = {}) {
  const p = [];
  if (!j || typeof j !== 'object' || Array.isArray(j)) return ['the intake is not a JSON object'];
  const get = (path) => path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), j);
  const need = (path, test, what) => {
    const v = get(path);
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) p.push(`${path}: missing`);
    else if (test && !test(v)) p.push(`${path}: expected ${what}`);
  };
  need('intakeVersion', (v) => v === 1, '1');
  need('workspace.slug', (v) => typeof v === 'string' && SLUG_RE.test(v), 'lowercase words joined with dashes');
  need('workspace.name', (v) => typeof v === 'string' && v.length <= 80, 'text up to 80 characters');
  need('workspace.industry', (v) => typeof v === 'string' && SLUG_RE.test(v), 'an industry slug such as real-estate');
  need('site.deployTarget', (v) => typeof v === 'string' && PROJECT_RE.test(v), 'a Pages project name');
  need('site.previewHost', (v) => typeof v === 'string' && HOST_RE.test(v), 'a hostname');
  need('contract.file', (v) => typeof v === 'string' && existsSync(isAbsolute(v) ? v : join(repo, v)), 'an existing file (a path from the repository root)');
  need('settings.businessName', (v) => typeof v === 'string' && v.length <= 80, 'text up to 80 characters');
  need('settings.phone', (v) => typeof v === 'string' && PHONE_RE.test(v), 'a phone number');
  need('settings.email', (v) => typeof v === 'string' && EMAIL_RE.test(v), 'an email address');
  need('owner.name', (v) => typeof v === 'string' && v.length <= 80 && slugify(v) !== '', 'text up to 80 characters');
  need('owner.email', (v) => typeof v === 'string' && EMAIL_RE.test(v), 'an email address');
  need('owner.teamRole', (v) => typeof v === 'string' && v.length <= 60, 'text up to 60 characters');
  if (get('site.domain') !== undefined && get('site.domain') !== null) need('site.domain', (v) => typeof v === 'string' && HOST_RE.test(v), 'a hostname');
  if (get('settings.address') !== undefined) {
    for (const k of ['street', 'city', 'region', 'postalCode']) need(`settings.address.${k}`, (v) => typeof v === 'string', 'text');
  }
  return p;
}

// The owner's rulings: test inboxes an invite may go to; past its `until` day (UTC) an entry is ignored. The file holds the sha256
// of each lowercased address, never the address: the repository is public and a test inbox can be a person's own mailbox.
export const hashEmail = (e) => createHash('sha256').update(String(e).trim().toLowerCase()).digest('hex');
export function loadInboxes(file = join(HERE, 'test-inboxes.json'), today = new Date().toISOString().slice(0, 10)) {
  const j = JSON.parse(readFileSync(file, 'utf8'));
  return (j.inboxes || []).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.until || '') && today <= x.until && /^[0-9a-f]{64}$/.test(x.sha256 || '')).map((x) => x.sha256);
}

// Equal regardless of object key order: Postgres jsonb stores keys in its own order (staging run 2, 2026-11-10: a false "differs").
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// o: { intake, dryRun, inboxes }   d: { cli, db, invite, provision, log }   (onboard-live.mjs builds the real ones, test/fakes.mjs the others)
// The refusals that need nothing but the intake and the rulings: run before any connection is made.
export function precheck(o) {
  const problems = checkIntake(o.intake);
  if (problems.length) throw new Refused(`the intake is not complete (${problems.length}): ${problems.join('; ')}`);
  const email = o.intake.owner.email.toLowerCase();
  if (!(o.inboxes || []).includes(hashEmail(email))) throw new Refused(`owner.email ${email} is not in test-inboxes.json: on staging the invite goes to a test inbox only, never a person`);
}

export async function onboard(o, d) {
  precheck(o);
  const j = o.intake, email = j.owner.email.toLowerCase();
  const out = { changed: 0, waiting: [], failed: [] };
  const log = d.log, would = (what, call) => log(`would  ${what}  [${call}]`), did = (what) => { out.changed++; log(`done   ${what}`); };
  const ref = `intake sha256 ${createHash('sha256').update(JSON.stringify(j)).digest('hex').slice(0, 16)}`;

  // 1 workspace, site row, contract, pages: the CLI's own command (it reads first and reports whether anything changed)
  const seed = await d.cli.seedWorkspace({ slug: j.workspace.slug, name: j.workspace.name, industry: j.workspace.industry, deployTarget: j.site.deployTarget,
    previewHost: j.site.previewHost, contract: isAbsolute(j.contract.file) ? j.contract.file : join(REPO, j.contract.file) }, o.dryRun);
  if (!seed.ok) throw new Error(`omnikom seed workspace: ${seed.code}${seed.detail ? ` (${seed.detail})` : ''}`);
  if (o.dryRun) would(`seed workspace ${j.workspace.slug}: workspace, site ${j.site.deployTarget}, contract, ${seed.pages ?? '?'} pages, ${seed.places ?? '?'} places (when missing)`, 'omnikom seed workspace --target staging');
  else if (seed.changed) did(`seeded workspace ${j.workspace.slug} (contract version ${seed.contractVersion}, ${seed.pagesStored} pages; omnikom seed workspace)`);
  else log(`ok     workspace ${j.workspace.slug}, site ${j.site.deployTarget}, contract version ${seed.contractVersion}, ${seed.pagesStored} pages (omnikom seed workspace: changed nothing)`);

  const ws = await d.db.getWorkspace(j.workspace.slug);
  if (!ws && !o.dryRun) throw new Error(`workspace ${j.workspace.slug} is not there after the seed`);
  if (ws && ws.deploy_target !== j.site.deployTarget) throw new Refused(`workspace ${j.workspace.slug} has site ${ws.deploy_target}, the intake says ${j.site.deployTarget}`);

  // 2 business details (the settings row): created once; later the client owns it
  const settings = { businessName: j.settings.businessName, phone: j.settings.phone, email: j.settings.email, ...(j.settings.address ? { address: j.settings.address } : {}) };
  const s = ws ? await d.db.rows(ws.id, 'settings') : [];
  if (s.length > 1) throw new Error(`workspace ${j.workspace.slug} has ${s.length} settings rows`);
  if (!s.length) {
    if (o.dryRun) would(`create the business details row (${Object.keys(settings).join(', ')})`, `psql: service.seed_version(settings), ref "${ref}"`);
    else { await d.db.seedRow(ws.id, 'settings', settings, ref); did(`created the business details row (${Object.keys(settings).join(', ')})`); }
  } else {
    const diff = Object.keys(settings).filter((k) => !same(s[0].data[k], settings[k]));
    log(diff.length ? `note   business details exist and differ from the intake in ${diff.join(', ')}: not overwritten (the client edits them in the dashboard)` : 'ok     business details');
  }

  // 3 the owner's team profile, found by its slug
  const teamSlug = slugify(j.owner.name);
  const team = { name: j.owner.name, slug: teamSlug, role: j.owner.teamRole };
  const t = ws ? (await d.db.rows(ws.id, 'team')).filter((r) => r.data && r.data.slug === teamSlug) : [];
  if (t.length > 1) throw new Error(`workspace ${j.workspace.slug} has ${t.length} team rows with slug ${teamSlug}`);
  let teamRow = t[0] ? t[0].id : null;
  if (!teamRow) {
    if (o.dryRun) would(`create the owner's team profile ${teamSlug} (${j.owner.teamRole})`, `psql: service.seed_version(team), ref "${ref}"`);
    else { teamRow = await d.db.seedRow(ws.id, 'team', team, ref); did(`created the owner's team profile ${teamSlug} (${j.owner.teamRole})`); }
  } else {
    const diff = Object.keys(team).filter((k) => !same(t[0].data[k], team[k]));
    log(diff.length ? `note   team profile ${teamSlug} differs from the intake in ${diff.join(', ')}: not overwritten` : `ok     team profile ${teamSlug}`);
  }

  // 4 the owner's login: a member already = nothing to do and no mail; otherwise invite-member (one mail, to the test inbox)
  const m = ws ? await d.db.memberByEmail(ws.id, email) : null;
  if (m) log(m.role === 'owner' ? `ok     ${email} is an owner of ${j.workspace.slug} (no mail sent)` : `note   ${email} is a ${m.role} of ${j.workspace.slug}, not an owner: changing a role is the owner's call (no mail sent)`);
  else if (o.dryRun) would(`invite ${email} as owner of ${j.workspace.slug}, linked to team profile ${teamSlug} (ONE real mail, from Auth, to that test inbox)`, 'POST <functions>/invite-member as Omnikom staff');
  else {
    const r = await d.invite({ workspace: ws.id, email, role: 'owner', team_row: teamRow });
    if (r.status !== 200 || !r.json || r.json.invited !== true) throw new Error(`invite-member answered ${r.status} ${String(r.text || '').slice(0, 160)}`);
    did(`invited ${email} as owner (invite-member 200, email_sent ${r.json.email_sent})`);
    if (r.json.email_sent !== true) { out.waiting.push('mail'); log('WAIT   Auth did not send the invite mail: the person is a member and can ask for a sign-in link at /login'); }
  }

  // 5 the site's infrastructure: provision.mjs, its own lines indented
  if (o.dryRun && !ws) would(`provision ${j.site.deployTarget}: Pages project, signing key, lead settings${j.site.domain ? `, domain ${j.site.domain}` : ''} (its own dry run needs the site row first)`, 'node tools/client-infra/provision.mjs');
  else {
    const p = await d.provision({ site: j.site.deployTarget, domain: j.site.domain || null, dryRun: o.dryRun });
    for (const l of String(p.stdout || '').trim().split(/\r?\n/).filter(Boolean)) log(`  provision: ${l}`);
    const n = Number(((p.stdout || '').match(/^(?:RESULT|DRY RUN): changed (\d+)/m) || [])[1]);
    if (p.status === 1 || p.status === 2 || Number.isNaN(n)) { out.failed.push('provision'); log(`FAIL   provision.mjs exit ${p.status}${p.stderr ? `: ${String(p.stderr).trim().split('\n').pop()}` : ''}`); }
    else { out.changed += n; if (p.status === 3) out.waiting.push('provision'); }
  }

  log(`${o.dryRun ? 'DRY RUN' : 'RESULT'}: changed ${out.changed}${out.waiting.length ? `, waiting on ${out.waiting.join(', ')}` : ''}${out.failed.length ? `, FAILED ${out.failed.join(', ')}` : ''}`);
  return out;
}

export function parseArgs(argv) {
  const o = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--intake') { o.intakeFile = argv[++i]; if (!o.intakeFile) throw new Refused('--intake needs a file'); }
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--target') { if (argv[++i] !== 'staging') throw new Refused(`--target ${argv[i]}: only staging is built (work order 36); production is the owner's click`); }
    else throw new Refused(`unknown argument ${a}`);
  }
  if (!o.intakeFile) throw new Refused('usage: --intake <file.json> [--dry-run]');
  return o;
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
    try { o.intake = JSON.parse(readFileSync(o.intakeFile, 'utf8')); } catch (e) { throw new Refused(`--intake ${o.intakeFile}: ${e.code === 'ENOENT' ? 'no such file' : 'not JSON'}`); }
    o.inboxes = loadInboxes();
    precheck(o);
    const { onboardDeps } = await import('./onboard-live.mjs');
    const r = await onboard(o, onboardDeps({ log: (l) => console.log(l), repo: REPO, inboxes: o.inboxes }));
    code = r.failed.length ? 1 : r.waiting.length ? 3 : 0;
  } catch (e) {
    console.error(`${e instanceof Refused ? 'REFUSED' : 'FAIL'}: ${e.message}`);
    code = e instanceof Refused ? 2 : 1;
  }
  process.exit(code);
}
