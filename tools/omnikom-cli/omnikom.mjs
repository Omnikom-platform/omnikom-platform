// omnikom: the platform CLI (docs/blueprint/26-PLATFORM-CLI.md). One Node program (20+), no dependencies, psql on the path.
//   node tools/omnikom-cli/omnikom.mjs <command> [--target staging|local|production] [--as <identity>] [--expect <code>] [--json]
// Every command prints ONE JSON object. Exit codes: 0 the result matched (ok, or the --expect code), 1 it did not,
// 2 usage (the command line is wrong), 3 BLOCKED (a key is missing by name, or the target refused the command).
// Nothing that leaves this program is unredacted (lib/redact.mjs); production runs only `status` and `apply --i-mean-production`.
import { realpathSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isatty } from 'node:tty';
import { parseArgs } from './lib/args.mjs';
import { Usage, Blocked } from './lib/errors.mjs';
import { guardProduction } from './lib/target.mjs';
import { makeCtx } from './lib/ctx.mjs';
import { render, redact, clearRuntimeSecrets } from './lib/redact.mjs';
import { status } from './commands/status.mjs';
import { apply, testGroup } from './commands/apply.mjs';
import { seedGroup } from './commands/seed.mjs';
import { keyGroup } from './commands/key.mjs';
import { contractGroup } from './commands/contract.mjs';
import { leadGroup } from './commands/lead.mjs';
import { contentGroup } from './commands/content.mjs';
import { publish, jobGroup } from './commands/publish.mjs';
import { verify } from './commands/verify.mjs';
import { mfaGroup } from './commands/mfa.mjs';
import { audit, gate, AuditCrash, textOutput } from './commands/audit.mjs';
import { toolsGroup } from './commands/tools.mjs';
import { ci, ciText } from './commands/ci.mjs';
import { impact, impactText } from './commands/impact.mjs';
import { land, landText } from './commands/land.mjs';
import { hooksGroup, hooksText } from './commands/hooks.mjs';
import { journeyText } from './commands/journey.mjs';

const COMMANDS = { status, apply, test: testGroup, seed: seedGroup, key: keyGroup, contract: contractGroup, lead: leadGroup, content: contentGroup, publish, job: jobGroup, verify, mfa: mfaGroup, audit, gate, tools: toolsGroup, ci, impact, land, hooks: hooksGroup };
// the commands that print text lines by default (with --json: the result object), and the ones that talk to no target
const TEXT = { impact: impactText, land: landText, hooks: hooksText };
const NO_TARGET = new Set(['impact', 'land', 'hooks']);
export const USAGE = [
  'status | apply [--dry-run] | test walls | verify --only lead|walls|people | mfa enroll-staff',
  'seed test [--alert-to <email>] [--clean] | seed workspace --slug --name --industry --deploy-target --preview-host (--contract <file> | --plan <dir> --entities <file>)',
  'key mint --site <slug> | key list [--site <slug>] | key revoke --id <uuid>',
  'contract validate --file <f> | contract place --file <f> --rows <f>',
  'lead send --site <slug> [--form contact] [--fixture <f>] [--retry] [--key <uuid>] | lead list|get|update|add|delete --as <person> ...',
  'content save|get|history --as <person> ... | publish --as <person> --site <slug> --rows <ids> | job get|wait|set --job <id>',
  'audit --dir <built site folder> [--only <rule ids>] [--target preview|production] | gate --dir <built site folder> [--target preview|production]   (text lines by default; --target is the build\'s target, not a database; exit 0 pass, 1 FAIL, 2 usage or crash)',
  'tools ensure [--only a,b] | tools list   (the binaries the checks need, from tools.json, into the git-ignored .tools/; no target)',
  'ci [--job <id>] [--root <dir>] [--install]   (every job of .github/workflows/ci.yml, locally, with those binaries; text lines by default; exit 0 all PASS, 1 FAIL, 2 usage)',
  'impact <files...> | --staged | --commit <sha>   (every tracked file that imports, reads or copies the changed files, with its owner and the gates that cover it; text lines, exit 0)',
  'land check/<department>/<slug> [--remote backup-gh] [--wait-minutes 60] [--lock-wait-minutes 30]   (waits for GitHub\'s ci run of that branch\'s commit without the land lock, refuses on any red job, then takes the lock for seconds: a master that moved is refused with "rebase", otherwise it fast-forwards master and pushes and brings this checkout\'s local master along when that is safe; no target; exit 0 landed, 1 refused, 2 usage, 3 blocked)',
  'hooks install | uninstall | status   (the pre-push hook: master takes only a commit with a green GitHub ci run, check/** branches are allowed)   |   ci --staged | --commit <sha> [--job <id>] [--install]   (ci on that exact tree, to reproduce a red GitHub job; no stamp)',
  'test journey --target staging [--only J4,J5] [--out <dir>] [--alert-to <our own email>]   (the test site end to end on staging, looked at in a browser: one line per step PASS | FAIL | BLOCKED | NOT BUILT YET | SKIPPED, then a summary; exit 0 only when no step failed; J5 and J6 send a real alert, so --alert-to is required for them; J13 runs the Settings tests and e2e-settings without SETTINGS_INVITE_EMAIL, so it sends no mail; never looped)',
  'flags: --target staging|local|production  --as <identity>  --expect <code>  --json  --fixture <file>  --real',
];

// main never touches process.exit or the console, so a test can call it directly: it returns what would be printed.
export async function main(argv, deps = {}) {
  const env = deps.env || process.env;
  clearRuntimeSecrets();
  let out;
  let parsed = { positionals: [], flags: {} };
  const name = () => [parsed.positionals[0], parsed.positionals[1]].filter(Boolean).join(' ');
  try {
    parsed = parseArgs(argv);
    const { positionals, flags } = parsed;
    if (flags.help || positionals.length === 0) return finish({ ok: true, command: 'help', code: 'ok', exit: 0, usage: USAGE });
    const command = positionals[0];
    const run = COMMANDS[command];
    if (!run) throw new Usage(`unknown command '${command}'`);
    guardProduction(flags.target, command, flags);
    const ctx = makeCtx({ command, positionals, flags, deps });
    if (NO_TARGET.has(command)) ctx.targetName = 'none';
    if (command === 'hooks' && positionals[1] === 'pre-push' && ctx.stdin === undefined) ctx.stdin = readStdin();
    if (deps.auditLib) ctx.auditLib = deps.auditLib;   // a test hands audit/gate a library that throws
    const res = await run(ctx);
    const expect = flags.expect === undefined || flags.expect === true ? null : String(flags.expect);
    const matched = expect !== null ? res.code === expect : res.ok;
    out = { ok: res.ok, command: name(), target: ['local', 'staging', 'production'].includes(ctx.targetName) && ctxUsesTarget(command) && command !== 'tools' && command !== 'ci' ? ctx.targetName : undefined, code: res.code, ...(expect !== null ? { expect, matched } : {}), exit: matched ? 0 : 1, data: res.data, ...(ctx.warnings.length ? { warnings: ctx.warnings } : {}) };
  } catch (e) {
    if (e instanceof Usage) out = { ok: false, command: name(), code: 'USAGE', exit: 2, error: e.message };
    else if (e instanceof AuditCrash) out = { ok: false, command: name(), code: 'AUDIT-CRASH', exit: 2, error: e.message };
    else if (e instanceof Blocked) out = { ok: false, command: name(), code: 'BLOCKED', exit: 3, error: e.message, ...(e.unblock ? { unblock: e.unblock } : {}) };
    else out = { ok: false, command: name(), code: 'INTERNAL', exit: 1, error: String(e && e.message || e).slice(0, 300) };
  }
  return finish(out);

  function finish(obj) {
    // audit and gate print their lines, not the JSON object (unless --json); a usage error or a crash is one ERROR line
    const first = parsed.positionals[0] || argv.find(a => !a.startsWith('--'));
    if (first === 'ci' && obj.command !== 'help' && !parsed.flags.json && !argv.includes('--json')) return { exit: obj.exit, stdout: ciText(obj, env), stderr: '' };
    if ((first === 'audit' || first === 'gate') && obj.command !== 'help' && !parsed.flags.json && !argv.includes('--json')) return { exit: obj.exit, stdout: textOutput(first, obj, env), stderr: '' };
    if (first === 'test' && parsed.positionals[1] === 'journey' && obj.data && obj.data.steps && !parsed.flags.json && !argv.includes('--json')) return { exit: obj.exit, stdout: journeyText(obj, env), stderr: '' };
    if (TEXT[first] && obj.command !== 'help' && !parsed.flags.json && !argv.includes('--json')) return { exit: obj.exit, stdout: TEXT[first](obj, env), stderr: '' };
    const lines = obj.data && Array.isArray(obj.data.lines) && obj.command === 'verify' ? obj.data.lines.map(l => redact(l, env)).join('\n') + '\n' : '';
    return { exit: obj.exit, stdout: render(obj, { compact: Boolean(parsed.flags.json), env }), stderr: lines };
  }
}

// what git sends a pre-push hook on stdin (nothing when a person runs it by hand in a terminal)
function readStdin() {
  if (isatty(0)) return '';
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

// only commands that talk to a target show one in their result
const ctxUsesTarget = command => !['contract', 'audit', 'gate'].includes(command);

const isMain = (() => { try { return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  const r = await main(process.argv.slice(2));
  process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exitCode = r.exit;
}
