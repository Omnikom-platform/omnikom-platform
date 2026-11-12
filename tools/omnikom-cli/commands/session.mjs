// session start head|lane [--area <a>] [--resume <session id>] [--dry-run]   a head or a lane: writes its CRLF launcher and opens it in a window
// No target. The launcher clears every marker of the session that is running this command (CLEARED), titles the window, goes to the workspace and starts claude with its
// name, model, effort, window, Remote Control and permission mode (sessions/kinds.json), then the /goal prompt, or --resume <session id> and no prompt.
// The paths come only from the machine file (lib/machine.mjs: "claudeExe", "workspaceDir"); a real start is appended to the start registry (recordStart).
// --dry-run returns the launcher text and writes and opens nothing. Prints nothing, never exits: it returns a result, or throws Usage (exit 2) or Blocked (exit 3).
// A one-row headless process is not started here but by `omnikom helper run` (commands/helper.mjs, which shares these names and markers).
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { Usage } from '../lib/errors.mjs';
import { result } from '../lib/ctx.mjs';
import { isUuid } from '../lib/args.mjs';
import { machinePath } from '../lib/machine.mjs';
import { CLI_DIR } from '../lib/repo.mjs';

export const KINDS = JSON.parse(readFileSync(join(CLI_DIR, 'sessions', 'kinds.json'), 'utf8'));
// every marker of a running session that a child must not inherit (the measured list of tools/departments/builder-lib.mjs)
export const CLEARED = ['CLAUDE_CODE_BRIDGE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENABLE_CFC', 'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_PID', 'CLAUDECODE'];

// the name forms of sessions/kinds.json: a <part> is one of PARTS, any other text is itself
export const PARTS = { Model: '[A-Z][A-Za-z0-9.-]*', date: '\\d{4}-\\d{2}-\\d{2}', area: '[a-z0-9]+(?:-[a-z0-9]+)*', 'job id': '\\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*', HHMM: '\\d{4}' };
const AREA = new RegExp(`^${PARTS.area}$`);
const patternOf = form => new RegExp('^' + form.split(/(<[^>]+>)/).map(p => (p.startsWith('<') && p.endsWith('>') ? PARTS[p.slice(1, -1)] : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('') + '$');
export const NAME_PATTERNS = { head: patternOf(KINDS.head.nameForm), lane: patternOf(KINDS.lane.nameForm), helper: patternOf(KINDS.helper.nameForm) };
export const nameOf = (kind, values) => KINDS[kind].nameForm.replace(/<([^>]+)>/g, (_, k) => values[k]);

// local { date: 'YYYY-MM-DD', HHMM: 'hhmm' } of a time in seconds
export function localStamp(seconds) {
  const d = new Date(seconds * 1000);
  const two = n => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`, HHMM: `${two(d.getHours())}${two(d.getMinutes())}` };
}

// the start registry: one line per real start, appended to OMNIKOM_STARTS_FILE or ~/.claude/state/omnikom-starts.jsonl
export function recordStart(env, entry) {
  const file = env.OMNIKOM_STARTS_FILE || join(homedir(), '.claude', 'state', 'omnikom-starts.jsonl');
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(entry) + '\n');
}

// a window of its own, titled with the session's name (the convention of tools/departments/start-builder.mjs)
const openWindow = (name, path) => spawn('cmd.exe', ['/d', '/s', '/c', `start "${name}" "${path}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();

export async function sessionGroup(ctx) {
  const [, verb, kind, ...rest] = ctx.positionals;
  // L1
  if (verb !== 'start') throw new Usage('session start head|lane [--area <a>] [--resume <session id>] [--dry-run]');
  if (kind !== 'head' && kind !== 'lane') throw new Usage('session start takes head or lane; a one-row headless process is started by omnikom helper run <job-id>');
  if (rest.length > 0) throw new Usage(`session start ${kind}: unexpected argument '${rest[0]}'`);
  for (const flag of Object.keys(ctx.flags)) {
    if (!['area', 'resume', 'dry-run', 'json'].includes(flag)) throw new Usage(`session start takes no --${flag}`);
  }
  const { area, resume } = ctx.flags;
  if (kind === 'lane' && (typeof area !== 'string' || !AREA.test(area))) throw new Usage('a lane needs --area <a>: lowercase letters and digits in words joined by single hyphens');
  if (kind === 'head' && area !== undefined) throw new Usage('the head takes no --area');
  if (resume !== undefined && !isUuid(resume)) throw new Usage('--resume takes a session id (a uuid)');
  // L2: the launcher
  const k = KINDS[kind];
  const word = k.model.split('-')[1];
  const Model = word[0].toUpperCase() + word.slice(1);
  const name = nameOf(kind, { Model, date: localStamp(ctx.now()).date, area });
  const exe = machinePath('claudeExe', 'file', ctx.env);
  const cwd = machinePath('workspaceDir', 'dir', ctx.env);
  const goal = kind === 'head' ? 'node code/main/tools/omnikom-cli/omnikom.mjs work status' : `node code/main/tools/omnikom-cli/omnikom.mjs work check --area ${area}`;
  const args = ['--name', name, '--model', k.model, '--effort', k.effort, '--autocompact', String(k.window), ...(k.remoteControl ? ['--remote-control'] : []), '--permission-mode', k.permissionMode];
  // the prompt never follows --remote-control, which takes an optional name: so a --resume or the prompt comes after the permission mode
  const claude = `"${exe}" ${args.join(' ')}` + (resume ? ` --resume ${resume}` : ` "/goal ${goal} exits 0 in this session"`);
  const text = [
    '@echo off',
    `rem Written by omnikom session start: ${name}`,
    ...CLEARED.map(m => `set ${m}=`),
    `set OMNIKOM_SESSION_KIND=${kind}`,
    ...(kind === 'lane' ? [`set OMNIKOM_AREA=${area}`] : []),
    `title ${name}`,
    `cd /d "${cwd}"`,
    claude,
    '',
  ].join('\r\n');
  const launcher = join(ctx.env.OMNIKOM_LAUNCH_DIR || join(tmpdir(), 'omnikom-launchers'), `${name}.cmd`);
  // L3
  if (ctx.flags['dry-run']) return result(true, 'ok', { dryRun: true, name, launcher, text });
  mkdirSync(dirname(launcher), { recursive: true });
  writeFileSync(launcher, text);
  recordStart(ctx.env, { at: new Date(ctx.now() * 1000).toISOString(), kind, name, resumed: Boolean(resume) });
  (ctx.open || openWindow)(name, launcher);
  return result(true, 'ok', { name, launcher });
}
