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

/** Checks the arguments and returns { dept, slice, name, model, modelId, effort, cwd }; throws BuilderError on the first refusal. */
export function plan({ dept, slice, model, effort, cwd }) {
  if (!dept) throw new BuilderError('--dept is required');
  if (!slice) throw new BuilderError('--slice is required');
  const charter = parseCharters().find(c => c.slug === dept);
  if (!charter) throw new BuilderError(`no charter for department "${dept}" (docs/departments/${dept}.md); a builder starts only under a department that has one`);
  if (!SLICE_RE.test(slice)) throw new BuilderError(`slice "${slice}" has characters a window title cannot hold (allowed: letters, digits, dot, hyphen; 1 to 40; it starts with a letter or digit)`);
  const chosen = (model || charter.builderModel || '').toLowerCase();
  if (!MODELS.includes(chosen)) throw new BuilderError(`model "${chosen || '(none)'}" is not one of ${MODELS.join(', ')}${model ? '' : ` (the ${dept} charter names no valid builder model)`}`);
  if (effort && !EFFORTS.includes(effort)) throw new BuilderError(`effort "${effort}" is not one of ${EFFORTS.join(', ')}`);
  const dir = resolve(cwd || ROOT);
  if (!existsSync(dir)) throw new BuilderError(`cwd ${dir} does not exist`);
  if (/["%\r\n]|claude/i.test(dir)) throw new BuilderError(`cwd ${dir} holds a character or word a launcher cannot carry (double quote, %, line break, "claude")`);
  return { dept, slice, name: `BUILDER_${dept}_${slice}`, model: chosen, modelId: MODEL_IDS[chosen], effort: effort || null, cwd: dir };
}

/** The launcher text (CRLF): clears every marker, titles the window, claude with a name and a model and NO prompt. */
export function launcherText(p, exe) {
  return [
    '@echo off',
    `rem Starts a clean builder session ${p.name} (${p.model}). Written by tools/departments/start-builder.mjs; the task goes in as a message.`,
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
