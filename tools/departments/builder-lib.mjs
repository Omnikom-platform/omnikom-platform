// Shared by start-builder.mjs and stop-builder.mjs: checks, the clean launcher text, the session registry, the process tree.
// Route measured 2026-11-01 (docs/departments/briefs/brief-start-builder.md): a launcher .cmd that clears the Claude markers and
// runs claude with --name/--model/--permission-mode and no prompt, started in its own window, shows up in ~/.claude/sessions/<pid>.json
// within about 25 s and in ListAgents under its --name; the task is then sent with SendMessage. An interactive session cannot end
// itself, so it is stopped by PID (the tree, creation time checked).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT, MODELS, parseCharters } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export class BuilderError extends Error {}

export const MODEL_IDS = { fable: 'claude-fable-5-1', opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' };
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Every marker the launcher clears (measured list of the launcher that started a builder). The guard checks the first four.
export const CLEARED = ['CLAUDE_CODE_BRIDGE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENABLE_CFC', 'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_PID', 'CLAUDECODE'];
const SLICE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,39}$/;   // letters, digits, dot, hyphen: a window title and a --name hold it, and the name stays splittable on "_"

// The clean-launch guard decides what a launcher must look like; fail closed when it cannot be loaded.
let guard = null;
try { guard = await import(pathToFileURL(process.env.OMNIKOM_GUARD_PATH || join(homedir(), '.claude', 'hooks', 'clean-launch-guard.mjs')).href); } catch { guard = null; }

export const launchDir = () => {
  const d = resolve(process.env.OMNIKOM_LAUNCH_DIR || join(tmpdir(), 'omk-builders'));
  if (/claude/i.test(d)) throw new BuilderError(`the launcher folder ${d} has "claude" in its path (the clean-launch guard matches it); set OMNIKOM_LAUNCH_DIR to another folder`);
  return d;
};
export const sessionsDir = () => resolve(process.env.OMNIKOM_SESSIONS_DIR || join(homedir(), '.claude', 'sessions'));
export const claudeExe = () => {
  const p = resolve(process.env.OMNIKOM_CLAUDE_EXE || join(homedir(), '.local', 'bin', 'claude.exe'));
  if (!existsSync(p)) throw new BuilderError(`claude.exe not found at ${p} (set OMNIKOM_CLAUDE_EXE)`);
  return p;
};

// The workspace (work order 04): E:\Omnikom Platform holds code\main (the main checkout of this repository) and
// departments\<dept>\builders\<slice> (one git worktree of it per builder, removed after it lands). Found by walking up from the
// repository (code\main itself, or a builder's worktree) to the first folder whose code\main is a checkout; OMNIKOM_WORKSPACE overrides.
export function findWorkspace(from = ROOT) {
  if (process.env.OMNIKOM_WORKSPACE) return resolve(process.env.OMNIKOM_WORKSPACE);
  for (let d = resolve(from); ; d = dirname(d)) {
    if (existsSync(join(d, 'code', 'main', '.git'))) return d;
    if (dirname(d) === d) return null;
  }
}
export const builderDir = (ws, dept, slice) => join(ws, 'departments', dept, 'builders', slice);
export const BUILDER_BASE = () => process.env.OMNIKOM_BUILDER_BASE || 'backup-gh/master';

const gitIn = (dir) => (args) => {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 300000, windowsHide: true });
  return { ok: !r.error && r.status === 0, out: String(r.stdout || '').trim(), err: String(r.stderr || r.error || '').trim() };
};

/** The builder's worktree: kept when it is already a worktree of this repository (a restarted slice), refused when the folder is
 *  something else, otherwise `git worktree add --detach <dir> <base>` after a fetch of master (the builder names its own
 *  check/<dept>/<slug> branch). git: (args) => { ok, out, err }. Returns { dir, made, base }. */
export function ensureWorktree(dir, git = gitIn(ROOT)) {
  const list = git(['worktree', 'list', '--porcelain']);
  if (!list.ok) throw new BuilderError(`git worktree list failed in ${ROOT}: ${list.err.split('\n')[0]}`);
  const key = (p) => resolve(p).toLowerCase();
  if (list.out.split('\n').some(l => l.startsWith('worktree ') && key(l.slice(9).trim()) === key(dir))) return { dir, made: false, base: null };
  if (existsSync(dir)) throw new BuilderError(`${dir} exists and is not a worktree of ${ROOT}; move it away or pick another slice name`);
  const base = BUILDER_BASE();
  if (!process.env.OMNIKOM_BUILDER_BASE) {
    const fe = git(['fetch', 'backup-gh', 'master']);
    if (!fe.ok) throw new BuilderError(`BLOCKED: git fetch backup-gh master failed: ${fe.err.split('\n')[0]}`);
  }
  const add = git(['worktree', 'add', '--detach', dir, base]);
  if (!add.ok) throw new BuilderError(`git worktree add ${dir} ${base} failed: ${add.err.split('\n')[0]}`);
  return { dir, made: true, base };
}

/** Checks the arguments and returns { dept, slice, name, model, modelId, effort, cwd, worktree }; throws BuilderError on the first refusal.
 *  No --cwd: the builder works in its own worktree, departments\<dept>\builders\<slice> of the workspace (worktree: true). */
export function plan({ dept, slice, model, effort, cwd }) {
  if (!dept) throw new BuilderError('--dept is required');
  if (!slice) throw new BuilderError('--slice is required');
  const charter = parseCharters().find(c => c.slug === dept);
  if (!charter) throw new BuilderError(`no charter for department "${dept}" (docs/departments/${dept}.md); a builder starts only under a department that has one`);
  if (!SLICE_RE.test(slice)) throw new BuilderError(`slice "${slice}" has characters a window title cannot hold (allowed: letters, digits, dot, hyphen; 1 to 40; it starts with a letter or digit)`);
  const chosen = (model || charter.builderModel || '').toLowerCase();
  if (!MODELS.includes(chosen)) throw new BuilderError(`model "${chosen || '(none)'}" is not one of ${MODELS.join(', ')}${model ? '' : ` (the ${dept} charter names no valid builder model)`}`);
  if (effort && !EFFORTS.includes(effort)) throw new BuilderError(`effort "${effort}" is not one of ${EFFORTS.join(', ')}`);
  const worktree = !cwd;
  let dir;
  if (cwd) dir = resolve(cwd);
  else {
    const ws = findWorkspace();
    if (!ws) throw new BuilderError(`no workspace above ${ROOT} (a folder whose code\\main is a checkout); give --cwd or set OMNIKOM_WORKSPACE`);
    dir = builderDir(ws, dept, slice);
  }
  if (!worktree && !existsSync(dir)) throw new BuilderError(`cwd ${dir} does not exist`);
  if (/["%\r\n]|claude/i.test(dir)) throw new BuilderError(`cwd ${dir} holds a character or word a launcher cannot carry (double quote, %, line break, "claude")`);
  return { dept, slice, name: `BUILDER_${dept}_${slice}`, model: chosen, modelId: MODEL_IDS[chosen], effort: effort || null, cwd: dir, worktree };
}

/** The launcher text (CRLF): clears every marker, titles the window, claude with a name and a model and NO prompt. */
export function launcherText(p, exe) {
  return [
    '@echo off',
    `rem ${p.what || `Starts a clean builder session ${p.name} (${p.model}). Written by tools/departments/start-builder.mjs`}; the task goes in as a message.`,
    ...CLEARED.map(n => `set ${n}=`),
    `title ${p.name}`,
    `cd /d "${p.cwd}"`,
    `"${exe}" --name ${p.name} --model ${p.modelId}${p.effort ? ` --effort ${p.effort}` : ''} --permission-mode bypassPermissions`,
    '',
  ].join('\r\n');
}

/** Problems with a launcher ([] = clean): the guard's own check, the markers the guard does not look at, and the guard's verdict on starting it. */
export function launcherProblems(text, path = 'C:\\x\\launcher.cmd') {
  if (!guard) return ['the clean-launch guard (~/.claude/hooks/clean-launch-guard.mjs) cannot be loaded, so the launcher cannot be judged'];
  const out = [...guard.launcherProblems(text)];
  for (const n of CLEARED) if (!new RegExp(`^set\\s+${n}=\\s*$`, 'im').test(text) && !out.includes(`does not clear ${n}`)) out.push(`does not clear ${n}`);
  const why = guard.verdict(`Start-Process "${path}"`, () => text);
  if (why) out.push(`the guard would refuse to start it: ${why}`);
  return out;
}

export const filetimeToMs = (ft) => Number(BigInt(ft) / 10000n) - 11644473600000;
export const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/** Registered sessions: ~/.claude/sessions/<pid>.json, one per running Claude (name, cwd, procStart, startedAt, status). */
export function readSessions() {
  const dir = sessionsDir();
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir)) {
    if (!/^\d+\.json$/.test(f)) continue;
    try { const s = JSON.parse(readFileSync(join(dir, f), 'utf8')); if (s && Number.isInteger(s.pid)) out.push(s); } catch { /* half-written */ }
  }
  return out;
}

/** Every process: { pid, ppid, created (unix ms), name, cmd }. */
export function listProcesses() {
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', join(HERE, 'processes.ps1')], { encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new BuilderError(`process listing failed (exit ${r.status}): ${String(r.stderr || r.error || '').slice(0, 200)}`);
  return JSON.parse(r.stdout);
}

/** The root and its descendants, a child counting only if it is not older than its parent (Windows reuses PIDs). Deepest first. */
export function treeOf(rootPid, procs) {
  const root = procs.find(p => p.pid === rootPid);
  if (!root) return [];
  const out = [{ ...root, depth: 0 }];
  for (let i = 0; i < out.length; i++) {
    for (const c of procs) if (c.ppid === out[i].pid && c.pid !== out[i].pid && c.created >= out[i].created && !out.some(o => o.pid === c.pid)) out.push({ ...c, depth: out[i].depth + 1 });
  }
  return out.sort((a, b) => b.depth - a.depth);
}

/** Stops processes by PID (innermost first), each only if the fresh listing still shows the same creation time. Returns { stopped, skipped }. */
export function killProcs(victims, deps = {}) {
  const list = deps.list || listProcesses;
  const kill = deps.kill || ((pid) => spawnSync('taskkill', ['/PID', String(pid), '/F'], { encoding: 'utf8', timeout: 15000 }));
  const fresh = list();
  const stopped = [], skipped = [];
  for (const v of victims) {
    const now = fresh.find(p => p.pid === v.pid);
    if (!now) { skipped.push({ pid: v.pid, why: 'already gone' }); continue; }
    if (now.created !== v.created) { skipped.push({ pid: v.pid, why: 'pid reused (creation time differs)' }); continue; }
    kill(v.pid);
    stopped.push({ pid: v.pid, name: v.name });
  }
  return { stopped, skipped };
}

/** What still lives of `victims` (same pid and creation time), plus any process still carrying the session name or launcher on its command line. */
export function leftovers(victims, name, procs) {
  const left = [];
  for (const p of procs) {
    const was = victims.some(v => v.pid === p.pid && v.created === p.created);
    const carries = p.cmd.includes(`--name ${name}`) || p.cmd.includes(`${name}.cmd`);
    if (was || carries) left.push({ pid: p.pid, name: p.name, cmd: p.cmd.slice(0, 120) });
  }
  return left;
}
