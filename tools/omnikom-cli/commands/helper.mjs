// helper run <job-id> --model <id> --effort <level> --goal <exit test> [--brief <file>] [--dry-run]   one headless `claude -p` for one job row, waited for
// No target. The helper is started with its markers cleared (session.mjs CLEARED), the settings file of sessions/headless-helper.settings.json, a permission mode, a turn
// limit and a time limit (sessions/kinds.json), through the repository's time-limited runner (tools/proc-guard), so a time limit ends its whole tree. --brief only names the job's brief file in the
// prompt: nothing here reads it. --dry-run returns what would be started and starts nothing. A real run is appended to the start registry.
// Prints nothing, never exits: it returns a result (exit 0 the helper ended 0, 1 HELPER-FAILED), or throws Usage (exit 2) or Blocked (exit 3, the machine file).
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Usage } from '../lib/errors.mjs';
import { result } from '../lib/ctx.mjs';
import { machinePath } from '../lib/machine.mjs';
import { CLI_DIR, importRepo } from '../lib/repo.mjs';
import { KINDS, CLEARED, PARTS, nameOf, localStamp, recordStart } from './session.mjs';

export const HELPER_MODELS = ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
export const HELPER_EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const JOB_ID = new RegExp(`^${PARTS['job id']}$`);

export async function helperGroup(ctx) {
  const [, verb, jobId, ...rest] = ctx.positionals;
  // H1
  if (verb !== 'run') throw new Usage('helper run <job-id> --model <id> --effort <level> --goal <exit test> [--brief <file>] [--dry-run]');
  if (typeof jobId !== 'string' || !JOB_ID.test(jobId)) throw new Usage('helper run takes a job id <NN>-<slug>: two digits, a hyphen, lowercase words joined by single hyphens');
  if (rest.length > 0) throw new Usage(`helper run: unexpected argument '${rest[0]}'`);
  for (const flag of Object.keys(ctx.flags)) {
    if (!['model', 'effort', 'goal', 'brief', 'dry-run', 'json'].includes(flag)) throw new Usage(`helper run takes no --${flag}`);
  }
  const { model, effort, goal, brief } = ctx.flags;
  if (!HELPER_MODELS.includes(model)) throw new Usage(`--model is one of ${HELPER_MODELS.join(', ')}`);
  if (!HELPER_EFFORTS.includes(effort)) throw new Usage("--effort is one of low, medium, high, xhigh (max only on the owner's word: P3.2 section 5)");
  if (typeof goal !== 'string' || !/^[^\r\n]+$/.test(goal)) throw new Usage("--goal is the job's exit test, one line");
  if (brief !== undefined && (typeof brief !== 'string' || !existsSync(brief) || !statSync(brief).isFile())) throw new Usage("--brief takes an existing file: the job's brief");
  // H2
  const k = KINDS.helper;
  const name = nameOf('helper', { 'job id': jobId, HHMM: localStamp(ctx.now()).HHMM });
  const exe = machinePath('claudeExe', 'file', ctx.env);
  const cwd = machinePath('workspaceDir', 'dir', ctx.env);
  const args = ['-p', '--name', name, '--model', model, '--effort', effort, '--autocompact', String(k.window),
    '--settings', join(CLI_DIR, 'sessions', 'headless-helper.settings.json'), '--permission-mode', k.permissionMode, '--max-turns', String(k.maxTurns), '--output-format', 'json',
    `/goal ${goal} exits 0 in this session${brief ? `; the job is written in ${brief}: read it first` : ''}`];
  const timeout = k.timeoutMinutes * 60000;
  // H3
  if (ctx.flags['dry-run']) return result(true, 'ok', { dryRun: true, name, exe, cwd, args, timeout });
  const env = { ...ctx.env, OMNIKOM_SESSION_KIND: 'helper', OMNIKOM_JOB: jobId };
  for (const m of CLEARED) delete env[m];
  recordStart(ctx.env, { at: new Date(ctx.now() * 1000).toISOString(), kind: 'helper', name, resumed: false });
  const runner = ctx.run || (await importRepo('tools/proc-guard/index.mjs')).runLimited;
  const r = await runner(exe, args, { cwd, env, timeout });
  const ok = r.status === 0 && !r.timedOut;
  return result(ok, ok ? 'ok' : 'HELPER-FAILED', { name, status: r.status, timedOut: Boolean(r.timedOut), stdout: r.stdout || '' });
}
