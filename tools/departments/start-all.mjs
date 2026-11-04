// Restarts the whole build on whichever Claude account is logged in (DECISIONS 49 (e), brief docs/departments/briefs/account-switch.md).
// The owner logs in to the other account and double-clicks "Start Omnikom" (E:\Omnikom Platform\resume\start-omnikom.cmd), which runs this
// (the head of operations opens at the workspace top level, E:\Omnikom Platform, work order 04; the repository is code\main in it):
//   1. shows the logged-in account (email, organisation, plan, as `claude auth status --json` reports them; nothing else from that
//      output is ever printed); if it cannot be read, it asks the owner y/n in the window and never guesses;
//   2. lists every live session of ours (the session registry ~/.claude/sessions, one line per session id; live = its pid holds a
//      claude process created when the row says it started, anything else is "stale, ignored") and refuses while a head or a
//      builder is still live (one session per set of files), printing the command that stops each one;
//   3. starts ONE fresh head of operations (the charter's head model, bypassPermissions, the next free name
//      HEAD-OF-OPERATIONS_Omnikom_<date><letter>) through a clean launcher (start-builder.mjs launchSession), waits until it is
//      registered and sends it the takeover brief through a one-shot headless messenger (claude -p, Haiku, SendMessage only);
//   4. prints one line: name, pid, account, and that it starts the department heads from their HANDOVER blocks.
//   node tools/departments/start-all.mjs [--dry-run]
// Exit 0 = started (or a dry run with nothing in the way), 1 = refused or not started, 2 = usage.
import { readFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { BuilderError, MODEL_IDS, CLEARED, launcherText, launcherProblems, launchDir, claudeExe, readSessions, listProcesses, filetimeToMs, findWorkspace } from './builder-lib.mjs';
import { launchSession } from './start-builder.mjs';
import { CREATED_SLACK_MS } from './stop-builder.mjs';
import { ROOT, DEPT_DIR, parseCharters } from './lib.mjs';

export const BRIEF = 'docs/departments/briefs/takeover-after-account-switch.md';
export const HOO_PREFIX = 'HEAD-OF-OPERATIONS_Omnikom_';
const NAME_RE = /HEAD-OF-OPERATIONS_Omnikom_\d{4}-\d{2}-\d{2}[a-z]?(?![a-z0-9])/g;
// Anything that looks like a credential is never printed, whatever field it sits in.
const TOKENISH = /sk-ant-[A-Za-z0-9_-]*|[A-Za-z0-9_+/=-]{40,}/g;
export const scrub = (s) => String(s).replace(TOKENISH, '(hidden)');

/** The logged-in account: { known: true, loggedIn, email, org, plan } or { known: false, why }. Reads only the named fields. */
export function readAccount(deps = {}) {
  let raw, status;
  try {
    if (deps.authStatus) ({ raw, status } = deps.authStatus());
    else if (process.env.OMNIKOM_AUTH_STATUS_FILE) { raw = readFileSync(process.env.OMNIKOM_AUTH_STATUS_FILE, 'utf8'); status = 0; }
    else {
      const r = spawnSync(claudeExe(), ['auth', 'status', '--json'], { encoding: 'utf8', timeout: 30000, env: cleanEnv() });
      raw = r.stdout || ''; status = r.status;
    }
  } catch (e) { return { known: false, why: `claude auth status could not run (${e instanceof BuilderError ? e.message : e.code || 'error'})` }; }
  let j;
  try { j = JSON.parse(raw); } catch { return { known: false, why: `claude auth status gave no JSON (exit ${status})` }; }
  if (!j || typeof j !== 'object') return { known: false, why: 'claude auth status gave no JSON object' };
  if (j.loggedIn !== true) return { known: true, loggedIn: false };
  const pick = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);
  const email = pick(j.email), org = pick(j.orgName), plan = pick(j.subscriptionType);
  if (!email && !org) return { known: false, why: 'claude auth status names no email and no organisation' };
  return { known: true, loggedIn: true, email, org, plan };
}

export const accountLine = (a) => !a.known ? `account: cannot be read (${a.why})`
  : !a.loggedIn ? 'account: not logged in'
  : scrub(`account: ${a.email || '(no email)'}${a.org ? `, organisation "${a.org}"` : ''}${a.plan ? `, plan ${a.plan}` : ''}`);

/** The role of a session by its name: { role: 'head'|'builder'|'other', charter, prefix }. */
export function roleOf(name, slugs) {
  const n = String(name || '');
  if (n.startsWith(HOO_PREFIX)) return { role: 'head', charter: 'head-of-operations', prefix: 'HEAD-OF-OPERATIONS_' };
  let m = /^HEAD_([A-Za-z0-9-]+)_/.exec(n);
  if (m) { const slug = m[1].toLowerCase(); return { role: 'head', charter: slugs.includes(slug) ? slug : `${slug} (no such charter)`, prefix: 'HEAD_' }; }
  m = /^BUILDER_([a-z0-9-]+)_/.exec(n);
  if (m) return { role: 'builder', charter: m[1], prefix: 'BUILDER_' };
  // the sidebar titles of docs/departments/README.md: "HEAD OF OPERATIONS: ...", "HEAD: <department>", "BUILDER (<department>): ...", "STEP <n> (platform build): ..."
  if (/^HEAD OF OPERATIONS\b/i.test(n)) return { role: 'head', charter: 'head-of-operations', prefix: 'HEAD OF OPERATIONS' };
  const slugOf = (t) => t.trim().toLowerCase().replace(/\s+department$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  m = /^HEAD:\s*([^,]+)/i.exec(n);
  if (m) { const slug = slugOf(m[1]); return { role: 'head', charter: slugs.includes(slug) ? slug : `${slug} (no such charter)`, prefix: 'HEAD:' }; }
  m = /^BUILDER \(([^)]+)\)/i.exec(n);
  if (m) return { role: 'builder', charter: slugOf(m[1]), prefix: 'BUILDER (' };
  if (/^STEP \d+/i.test(n)) return { role: 'builder', charter: 'platform-build', prefix: 'STEP ' };
  return { role: 'other', charter: null, prefix: null };
}

const sameDir = (a, b) => { try { return resolve(a).toLowerCase() === resolve(b).toLowerCase(); } catch { return false; } };
// where the head of operations opens: the workspace top level when there is one (work order 04), else the repository
export const headCwd = () => findWorkspace() || ROOT;
// the takeover brief as the head reads it from there (code/main/docs/... at the workspace top level)
export const briefFrom = (cwd) => relative(cwd, join(ROOT, BRIEF)).split(sep).join('/');

/** The process table: builder-lib listProcesses, or a fixture file in the same shape (OMNIKOM_PROCESSES_FILE, tests only). */
const processTable = () => process.env.OMNIKOM_PROCESSES_FILE ? JSON.parse(readFileSync(process.env.OMNIKOM_PROCESSES_FILE, 'utf8')) : listProcesses();
const isClaudeProc = (p) => /^claude(\.exe)?$/i.test(p.name) || (/^node(\.exe)?$/i.test(p.name) && /claude/i.test(p.cmd || ''));

/** Why a registry row is not a live session (null = live): its pid must hold a claude process created when the row says the
 *  session started (Windows reuses pids: measured 2026-11-01, the row pid 7304 "HEAD: SEO and audits department" was svchost). */
export function staleWhy(s, procs) {
  const p = procs.find(x => x.pid === s.pid);
  if (!p) return 'no such process';
  if (!isClaudeProc(p)) return `pid now held by ${p.name}`;
  if (!s.procStart || Math.abs(p.created - filetimeToMs(s.procStart)) > CREATED_SLACK_MS) return 'pid reused (creation time differs)';
  return null;
}

/** Sessions of ours, one per session id (newest registry entry kept), heads first: { live, stale }. A session is ours if it carries
 *  a role name or runs in the repository. Stale rows are only listed: never refused on, never given a stop command. */
export function liveSessions(deps = {}) {
  const slugs = parseCharters().map(c => c.slug);
  const procs = (deps.list || processTable)();
  const byId = new Map();
  for (const s of readSessions()) {
    const key = s.sessionId || `pid-${s.pid}`;
    const had = byId.get(key);
    if (!had || (s.updatedAt || 0) > (had.updatedAt || 0)) byId.set(key, s);
  }
  const order = { head: 0, builder: 1, other: 2 };
  const rows = [...byId.values()]
    .map(s => ({ name: s.name || '(unnamed)', pid: s.pid, cwd: s.cwd || '', status: s.status || '', stale: staleWhy(s, procs), ...roleOf(s.name, slugs) }))
    .filter(s => s.role !== 'other' || sameDir(s.cwd, ROOT) || sameDir(s.cwd, headCwd()))
    .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
  return { live: rows.filter(s => s.stale === null), stale: rows.filter(s => s.stale !== null) };
}

/** Every head-of-operations name ever used: the registry (live or not), the position file, the department docs, the launcher folder. */
export function takenNames(dir = launchDir()) {
  const texts = [];
  for (const s of readSessions()) texts.push(String(s.name || ''));
  const pos = join(ROOT, '.claude', 'POSITION.md');
  if (existsSync(pos)) texts.push(readFileSync(pos, 'utf8'));
  const walk = (d) => { if (!existsSync(d)) return; for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.md')) texts.push(readFileSync(p, 'utf8')); } };
  walk(DEPT_DIR);
  if (existsSync(dir)) for (const f of readdirSync(dir)) texts.push(f);
  return new Set(texts.flatMap(t => t.match(NAME_RE) || []));
}

/** The first free name for that date: the bare date first (as 2026-11-01 was), then b, c, ... z. */
export function nextName(date, taken) {
  for (const suffix of ['', ...'bcdefghijklmnopqrstuvwxyz']) {
    const n = `${HOO_PREFIX}${date}${suffix}`;
    if (!taken.has(n)) return n;
  }
  throw new BuilderError(`every head-of-operations name for ${date} is taken (a to z)`);
}

const localDate = (ms) => { const d = new Date(ms); const z = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };

function cleanEnv() { const e = { ...process.env }; for (const n of CLEARED) delete e[n]; return e; }

export const briefMessage = (name, acct, brief = BRIEF) => `You are ${name}, the head of operations of the Omnikom Platform, started by tools/departments/start-all.mjs after a Claude account switch (${acct}). Read ${brief} and do what it says.`;

/** Default messenger: a one-shot headless Haiku session whose only job is one SendMessage. Returns { ok, detail }. */
export function headlessSend(to, text) {
  const prompt = [
    'Your only job is to deliver one message to another Claude Code session on this machine.',
    'If the SendMessage tool is not loaded, load it with ToolSearch (query "select:SendMessage").',
    `Call SendMessage once, with "to" set to exactly ${to} and "message" set to exactly the text between the two lines of dashes below.`,
    'Do not read files, run commands or do anything else. Then print one line: SENT, or FAILED: <the reason>.',
    '-----', text, '-----',
  ].join('\n');
  const r = spawnSync(claudeExe(), ['-p', '--model', MODEL_IDS.haiku, '--permission-mode', 'bypassPermissions', '--max-budget-usd', '0.30'],
    { input: prompt, encoding: 'utf8', timeout: 180000, cwd: ROOT, env: cleanEnv(), maxBuffer: 4 * 1024 * 1024 });
  const all = scrub(((r.stdout || '') + (r.stderr || '')).trim());
  const out = (/^(SENT|FAILED)\b.*$/m.exec(all) || [])[0] || all.split(/\r?\n/).pop() || `(no output, exit ${r.status})`;
  return { ok: r.status === 0 && /^SENT\b/m.test(r.stdout || ''), detail: out.slice(0, 200) };
}

async function askYesNo(question, deps) {
  if (deps.ask) return deps.ask(question);
  process.stdout.write(`${question} (y/n) `);
  const rl = createInterface({ input: process.stdin });
  const line = await new Promise(res => { rl.once('line', res); rl.once('close', () => res('')); });
  rl.close();
  return line;
}

/** deps: { authStatus(), ask(q), open(name, path), wait(ms), now(), waitMs, send(to, text), log(line) } so tests start nothing. */
export async function startAll(opts = {}, deps = {}) {
  const log = deps.log || ((l) => console.log(l));
  const acct = readAccount(deps);
  log(accountLine(acct));
  if (acct.known && !acct.loggedIn) throw new BuilderError('no Claude account is logged in; run `claude auth login`, pick the account, then start again');
  if (!acct.known) {
    if (opts.dryRun) log('would ask: "The Claude account could not be read. Start the head of operations on the account this window is logged in to? (y/n)"');
    else {
      const a = String(await askYesNo('The Claude account could not be read. Start the head of operations on the account this window is logged in to?', deps)).trim().toLowerCase();
      if (a !== 'y' && a !== 'yes') throw new BuilderError('the account was not confirmed; nothing started');
    }
  }

  const { live, stale } = liveSessions(deps);
  log(`live sessions of ours: ${live.length}`);
  for (const s of live) log(`  ${s.role.padEnd(7)} ${s.name} pid ${s.pid}${s.charter ? ` (${s.charter})` : ''}${s.status ? ` ${s.status}` : ''}`);
  for (const s of stale) log(`  stale, ignored: ${s.name} pid ${s.pid} (${s.stale}; the registry row outlived its session)`);
  const blocking = live.filter(s => s.role === 'head' || s.role === 'builder');
  let refusal = null;
  if (blocking.length) {
    refusal = `${blocking.length} head or builder session(s) of ours are still live; a second session on the same charter would edit the same files. Stop each one first (after its HANDOVER is written), then start again:\n`
      + blocking.map(s => `  node tools/departments/stop-builder.mjs --pid ${s.pid}${s.prefix === 'BUILDER_' ? '' : ` --name-prefix ${/[\s(]/.test(s.prefix) ? `"${s.prefix}"` : s.prefix}`}    (${s.name})`).join('\n');
    if (!opts.dryRun) throw new BuilderError(refusal);
    log(`refusing: ${refusal}`);
  }

  const charter = parseCharters().find(c => c.slug === 'head-of-operations');
  if (!charter || !MODEL_IDS[charter.headModel]) throw new BuilderError('the head-of-operations charter names no valid head model');
  if (!existsSync(join(ROOT, BRIEF))) throw new BuilderError(`the takeover brief ${BRIEF} is missing`);
  const dir = launchDir();
  const name = nextName(localDate((deps.now || Date.now)()), takenNames(dir));
  const cwd = headCwd();
  const brief = briefFrom(cwd);
  const p = { name, model: charter.headModel, modelId: MODEL_IDS[charter.headModel], effort: null, cwd,
    what: `Starts a clean, independent ${MODEL_IDS[charter.headModel]} session: Head of operations of the Omnikom Platform, named ${name}. Written by tools/departments/start-all.mjs` };
  const text = launcherText(p, claudeExe());
  const path = join(dir, `${name}.cmd`);
  const problems = launcherProblems(text, path);
  if (problems.length) throw new BuilderError(`the launcher is not clean: ${problems.join('; ')}`);
  const message = briefMessage(name, accountLine(acct), brief);
  if (opts.dryRun) {
    log(`DRY RUN: nothing written, nothing started${refusal ? ' (and it would refuse, above)' : ''}`);
    log(`launcher it would write${refusal ? ' once those are stopped' : ''}: ${path}`);
    log(text.trimEnd());
    log(`message it would send to ${name}: ${message}`);
    return { dryRun: true, refused: !!refusal, name, launcher: path };
  }
  const s = await launchSession({ name, path, text }, deps);
  const sent = (deps.send || headlessSend)(name, message);
  const tail = sent.ok ? 'it starts the department heads from their HANDOVER blocks'
    : `BLOCKED: the takeover brief was not delivered (${sent.detail}); type in its window: Read ${brief} and do what it says`;
  log(`started ${name} pid ${s.pid} on ${accountLine(acct).replace(/^account: /, 'account ')}; ${tail}`);
  return { name, pid: s.pid, sent: sent.ok };
}

const isMain = process.argv[1] && (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return process.argv[1].toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })();
if (isMain) {
  const args = process.argv.slice(2);
  const bad = args.find(a => a !== '--dry-run');
  if (bad) { console.error(`unknown argument ${bad}\nusage: node tools/departments/start-all.mjs [--dry-run]`); process.exitCode = 2; }
  else {
    try {
      const r = await startAll({ dryRun: args.includes('--dry-run') });
      if (r.dryRun && r.refused) process.exitCode = 1;
      else if (r.sent === false) process.exitCode = 1;
    } catch (e) {
      if (!(e instanceof BuilderError)) throw e;
      console.error(`refusing: ${e.message}`);
      process.exitCode = 1;
    }
  }
}
