// Tests for start-all.mjs. Nothing real is started: the repository is a temp copy (docs/departments and a fixture POSITION.md),
// the session registry and the launcher folder are temp folders, claude.exe is a dummy file, the account comes from a fixture
// file or a fake, and the window, the wait and the messenger are fakes.
//   node tools/departments/test/start-all.test.mjs      exit 0 = every check passed. Lines start with "ok  ", "FAIL " or "SKIP ".
// OMNIKOM_DEPT_TOOLS points at a copy of the tools (test/start-all.mutants.mjs runs one broken copy at a time).
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, dirname, relative, sep } from 'node:path';
delete process.env.OMNIKOM_WORKSPACE;   // the workspace checks below set it themselves
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = process.env.OMNIKOM_DEPT_TOOLS ? resolve(process.env.OMNIKOM_DEPT_TOOLS) : resolve(HERE, '..');
const REPO = process.env.OMNIKOM_REPO_ROOT ? resolve(process.env.OMNIKOM_REPO_ROOT) : resolve(HERE, '..', '..', '..');
let failed = 0, total = 0;
const check = (name, ok, detail = '') => { total++; if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ': ' + String(detail).slice(-700)}`); };
// Without the clean-launch guard (~/.claude/hooks, not in the repo: CI) builder-lib refuses every launcher, so the checks that
// get as far as the launcher print one SKIP line each; the account, refusal and naming checks still run.
const GUARD = existsSync(join(homedir(), '.claude', 'hooks', 'clean-launch-guard.mjs'));
const gated = (name, fn) => { if (GUARD) return fn(); console.log(`SKIP ${name}: needs the clean-launch guard (~/.claude/hooks, not in the repo)`); };

const tmp = mkdtempSync(join(tmpdir(), 'omnikom-sa-'));
const ROOT = join(tmp, 'repo'), DEPTS = join(ROOT, 'docs', 'departments'), SESSIONS = join(tmp, 'sessions'), LAUNCH = join(tmp, 'launch');
cpSync(join(REPO, 'docs', 'departments'), DEPTS, { recursive: true });
mkdirSync(join(ROOT, '.claude'), { recursive: true });
writeFileSync(join(ROOT, '.claude', 'POSITION.md'), '- 09:00 TAKEOVER HEAD-OF-OPERATIONS_Omnikom_2099-01-01, then HEAD-OF-OPERATIONS_Omnikom_2099-01-01b.\n', 'utf8');
writeFileSync(join(DEPTS, 'briefs', 'fixture-note.md'), 'handed to HEAD-OF-OPERATIONS_Omnikom_2099-01-01c\n', 'utf8');
mkdirSync(SESSIONS);
writeFileSync(join(tmp, 'claude-dummy.exe'), '', 'utf8');
const AUTH = join(tmp, 'auth.json');
// the planted secrets: a short one that only the field whitelist keeps out, a token-shaped one that only the scrub keeps out
const PLANT = 'PLANTEDsecretVALUE';
const TOKEN = 'sk-ant-oat01-PLANTEDTOKENabcdefghijklmnopqrstuvwxyz0123456789';
const auth = (o) => writeFileSync(AUTH, typeof o === 'string' ? o : JSON.stringify(o), 'utf8');
const GOOD = { loggedIn: true, authMethod: 'claude.ai', email: 'owner@example.com', orgName: 'Example Org', subscriptionType: 'max', accessToken: PLANT, oauthAccount: { refreshToken: PLANT } };
Object.assign(process.env, { OMNIKOM_REPO_ROOT: ROOT, OMNIKOM_DEPT_DIR: DEPTS, OMNIKOM_SESSIONS_DIR: SESSIONS, OMNIKOM_LAUNCH_DIR: LAUNCH,
  OMNIKOM_CLAUDE_EXE: join(tmp, 'claude-dummy.exe'), OMNIKOM_AUTH_STATUS_FILE: AUTH, OMNIKOM_PROCESSES_FILE: join(tmp, 'processes.json') });

const cli = (args) => { const r = spawnSync(process.execPath, [join(TOOLS, 'start-all.mjs'), ...args], { encoding: 'utf8', timeout: 60000, env: process.env, input: '' }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const sa = await import(pathToFileURL(join(TOOLS, 'start-all.mjs')).href);
// The process table is a fixture too (OMNIKOM_PROCESSES_FILE, the shape of builder-lib listProcesses): putSession registers a
// session and, unless `proc` says otherwise, the claude.exe process it names, created when the registry says it started.
// proc: null = no such process; an object overrides fields of that process (another program, another creation time).
const PROCS = process.env.OMNIKOM_PROCESSES_FILE;
let procs = [];
const filetime = (ms) => String((BigInt(ms) + 11644473600000n) * 10000n);
const T0 = Date.now() - 3600e3;
const putSession = (s, proc) => {
  writeFileSync(join(SESSIONS, `${s.pid}.json`), JSON.stringify({ cwd: ROOT, startedAt: Date.now(), updatedAt: Date.now(), status: 'idle', procStart: filetime(T0), ...s }), 'utf8');
  procs = procs.filter(p => p.pid !== s.pid);
  if (proc !== null) procs.push({ pid: s.pid, ppid: 1, created: T0, name: 'claude.exe', cmd: `claude.exe --name ${s.name}`, ...(proc || {}) });
  writeFileSync(PROCS, JSON.stringify(procs), 'utf8');
};
const clearSessions = () => { for (const f of readdirSync(SESSIONS)) rmSync(join(SESSIONS, f), { force: true }); procs = []; writeFileSync(PROCS, '[]', 'utf8'); };
writeFileSync(PROCS, '[]', 'utf8');
const deadPid = spawnSync(process.execPath, ['--version'], { timeout: 30000 }).pid;
const quiet = { log: () => {} };
const attempt = async (opts, deps) => { try { return { r: await sa.startAll(opts, { ...quiet, ...deps }) }; } catch (e) { return { err: e }; } };
const mustNotOpen = () => { throw new Error('must not open a window'); };
// The refusal these checks are about: a live head or builder. Without the clean-launch guard (CI) the dry run also ends with
// "refusing: the launcher is not clean", which says nothing about stale registry rows, so a bare /refusing/ would be red there.
const SESSION_REFUSAL = /refusing: \d+ head or builder session/;

try {
  // --- the refusal: a live head (or builder) of ours blocks the start
  auth(GOOD); clearSessions();
  putSession({ pid: process.pid, sessionId: 's-hoo', name: 'HEAD-OF-OPERATIONS_Omnikom_2099-01-01c' });
  let r = cli(['--dry-run']);
  check('refuse: a live head of operations makes the dry run refuse (exit 1) and print the stop command', r.status === 1 && /refusing: 1 head or builder session/.test(r.out) && r.out.includes(`stop-builder.mjs --pid ${process.pid} --name-prefix HEAD-OF-OPERATIONS_`) && /head\s+HEAD-OF-OPERATIONS_Omnikom_2099-01-01c pid/.test(r.out), r.out);
  let a = await attempt({}, { open: mustNotOpen, send: () => ({ ok: true }) });
  check('refuse: a real start with a live head of operations is refused before any window opens', a.err && /still live/.test(a.err.message), a.err ? a.err.message : JSON.stringify(a.r));
  clearSessions(); putSession({ pid: process.pid, sessionId: 's-cli', name: 'HEAD_CLI-and-testing_2099-01-01' });
  a = await attempt({}, { open: mustNotOpen });
  check('refuse: a live department head is refused too', a.err && /still live/.test(a.err.message) && a.err.message.includes('--name-prefix HEAD_'), a.err ? a.err.message : 'started');
  clearSessions(); putSession({ pid: process.pid, sessionId: 's-seo', name: 'HEAD: SEO and audits department' });
  r = cli(['--dry-run']);
  check('refuse: a head named by its sidebar title ("HEAD: SEO and audits department") is refused, charter seo-and-audits', r.status === 1 && /head\s+HEAD: SEO and audits department pid \d+ \(seo-and-audits\)/.test(r.out) && r.out.includes('--name-prefix HEAD:    (HEAD: SEO'), r.out);
  clearSessions(); putSession({ pid: deadPid, sessionId: 's-dead', name: 'HEAD-OF-OPERATIONS_Omnikom_2099-01-01c' }, null);
  r = cli(['--dry-run']);
  check('refuse: a registry entry whose process is gone does not block', !SESSION_REFUSAL.test(r.out) && /live sessions of ours: 0/.test(r.out), r.out);
  // a pid Windows gave to another program (measured 2026-11-01: the registry row pid 7304 "HEAD: SEO and audits department" was svchost).
  // Same creation time on purpose, so only the program check tells it apart (the next case covers the creation time alone).
  clearSessions(); putSession({ pid: process.pid, sessionId: 's-reused', name: 'HEAD: SEO and audits department' }, { name: 'svchost.exe', cmd: 'svchost.exe -k netsvcs' });
  r = cli(['--dry-run']);
  check('stale: a pid now held by another program (svchost) is listed as stale, never refused, never given a stop command', !SESSION_REFUSAL.test(r.out) && /live sessions of ours: 0/.test(r.out) && /stale, ignored: HEAD: SEO and audits department pid \d+/.test(r.out) && !r.out.includes(`--pid ${process.pid}`), r.out);
  clearSessions(); putSession({ pid: process.pid, sessionId: 's-reused2', name: 'HEAD_CLI-and-testing_2099-01-01' }, { created: T0 + 600e3 });
  r = cli(['--dry-run']);
  check('stale: a pid now held by a later claude.exe (creation time differs) is stale, not refused', !SESSION_REFUSAL.test(r.out) && /stale, ignored: HEAD_CLI-and-testing_2099-01-01 pid \d+/.test(r.out), r.out);

  // --- the next free name
  clearSessions();
  check('name: the bare date, b and c are taken (position file, a brief) -> d', sa.nextName('2099-01-01', sa.takenNames(LAUNCH)) === 'HEAD-OF-OPERATIONS_Omnikom_2099-01-01d', [...sa.takenNames(LAUNCH)].join(','));
  putSession({ pid: deadPid, sessionId: 's-old', name: 'HEAD-OF-OPERATIONS_Omnikom_2099-01-01d' });
  check('name: a name used only by a finished session in the registry counts as taken -> e', sa.nextName('2099-01-01', sa.takenNames(LAUNCH)) === 'HEAD-OF-OPERATIONS_Omnikom_2099-01-01e', [...sa.takenNames(LAUNCH)].join(','));
  clearSessions();
  check('name: a date nobody used starts at the bare date', sa.nextName('2099-01-02', sa.takenNames(LAUNCH)) === 'HEAD-OF-OPERATIONS_Omnikom_2099-01-02');

  // --- the account: shown, never a token
  auth(GOOD);
  r = cli(['--dry-run']);
  gated('account: the dry run shows email, organisation and plan, and none of the planted secret fields', () => check('account: the dry run shows email, organisation and plan, and none of the planted secret fields', r.status === 0 && r.out.includes('account: owner@example.com, organisation "Example Org", plan max') && !r.out.includes(PLANT), r.out));
  check('account: a planted secret in another field never reaches the output (whitelist)', !r.out.includes(PLANT) && r.out.includes('owner@example.com'), r.out);
  auth({ ...GOOD, orgName: `Org ${TOKEN}` });
  r = cli(['--dry-run']);
  check('account: a token planted in the organisation field is hidden (scrub)', !r.out.includes('PLANTEDTOKEN') && r.out.includes('(hidden)'), r.out);
  auth(`not json at all ${PLANT} ${TOKEN}`);
  r = cli(['--dry-run']);
  check('account: output that cannot be read is named as unreadable, asks y/n, and prints none of it', /account: cannot be read/.test(r.out) && /would ask: .*\(y\/n\)/.test(r.out) && !r.out.includes(PLANT) && !r.out.includes('PLANTEDTOKEN'), r.out);
  a = await attempt({}, { authStatus: () => ({ raw: 'garbage', status: 1 }), ask: () => 'n', open: mustNotOpen });
  check('account: unreadable and the owner answers n -> nothing started', a.err && /not confirmed; nothing started/.test(a.err.message), a.err ? a.err.message : 'started');
  a = await attempt({}, { authStatus: () => ({ raw: JSON.stringify({ loggedIn: false }), status: 1 }), open: mustNotOpen });
  check('account: not logged in -> refused with the login command', a.err && /claude auth login/.test(a.err.message), a.err ? a.err.message : 'started');

  // --- the dry run writes nothing; the launcher is clean
  auth(GOOD); clearSessions();
  r = cli(['--dry-run']);
  check('dry run: no launcher folder is created', !existsSync(LAUNCH), r.out);
  gated('launcher: name, the charter head model (opus), bypassPermissions, no prompt; passes the clean-launch guard', () => check('launcher: name, the charter head model (opus), bypassPermissions, no prompt; passes the clean-launch guard', r.status === 0 && /--name HEAD-OF-OPERATIONS_Omnikom_\d{4}-\d{2}-\d{2}[a-z]? --model claude-opus-5-5 --permission-mode bypassPermissions\s*$/m.test(r.out) && /^set CLAUDE_CODE_CHILD_SESSION=$/m.test(r.out) && r.out.includes(sa.BRIEF), r.out));

  // --- the workspace (work order 04): the head opens at its top level, a session there is ours, the brief is named from there
  {
    const WSP = join(tmp, 'ws'), REPO2 = join(WSP, 'code', 'main');
    mkdirSync(REPO2, { recursive: true });
    process.env.OMNIKOM_WORKSPACE = WSP;
    putSession({ pid: process.pid, sessionId: 's-top', name: 'a chat at the top', cwd: WSP });
    r = cli(['--dry-run']);
    delete process.env.OMNIKOM_WORKSPACE;
    clearSessions();
    const want = relative(WSP, join(ROOT, sa.BRIEF)).split(sep).join('/');
    gated('workspace: the head\'s launcher cds to the workspace top level and the message names the brief as read from there', () => check('workspace: the head\'s launcher cds to the workspace top level and the message names the brief as read from there',
      r.status === 0 && r.out.includes(`cd /d "${WSP}"`) && r.out.includes(`Read ${want} and do what it says`) && want.endsWith(sa.BRIEF) && want !== sa.BRIEF, r.out));
    check('workspace: an unnamed session at the workspace top level is listed as ours (not blocking)', /^ {2}other {3}a chat at the top pid \d+/m.test(r.out), r.out);
  }

  // --- the whole run with fakes: window, registration, messenger
  await gated('run: opens the launcher, waits for the session, sends the takeover brief to the new name, prints one line', async () => {
    clearSessions();
    const sent = [], lines = [];
    let opened = null;
    const res = await sa.startAll({}, {
      log: (l) => lines.push(l), wait: async () => {},
      open: (name, path) => { opened = { name, path, text: readFileSync(path, 'utf8') }; putSession({ pid: process.pid, sessionId: 's-new', name, startedAt: Date.now() }); },
      send: (to, text) => { sent.push({ to, text }); return { ok: true, detail: 'SENT' }; },
    });
    const last = lines[lines.length - 1] || '';
    check('run: opens the launcher, waits for the session, sends the takeover brief to the new name, prints one line',
      opened && res.name === opened.name && res.pid === process.pid && sent.length === 1 && sent[0].to === res.name && sent[0].text.includes(sa.BRIEF)
      && last.startsWith(`started ${res.name} pid ${process.pid} on account owner@example.com`) && last.includes('it starts the department heads from their HANDOVER blocks') && !lines.join('\n').includes(PLANT),
      JSON.stringify({ opened: opened && opened.name, res, sent, last }));
    clearSessions(); rmSync(LAUNCH, { recursive: true, force: true });
    const lines2 = [];
    const res2 = await sa.startAll({}, { log: (l) => lines2.push(l), wait: async () => {},
      open: (name) => putSession({ pid: process.pid, sessionId: 's-new2', name, startedAt: Date.now() }),
      send: () => ({ ok: false, detail: 'FAILED: no such session' }) });
    const last2 = lines2[lines2.length - 1] || '';
    check('run: a brief that was not delivered is BLOCKED on the last line, with what to type', res2.sent === false && /BLOCKED: the takeover brief was not delivered \(FAILED: no such session\)/.test(last2) && last2.includes(`Read ${sa.BRIEF}`), last2);
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `FAILED: ${failed} of ${total}` : `OK: ${total} of ${total} checks passed`);
process.exit(failed ? 1 : 0);
