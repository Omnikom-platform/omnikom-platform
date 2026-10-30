// omnikom: the platform CLI (docs/blueprint/26-PLATFORM-CLI.md). One Node program (20+), no dependencies, psql on the path.
//   node tools/omnikom-cli/omnikom.mjs <command> [--target staging|local|production] [--as <identity>] [--expect <code>] [--json]
// Every command prints ONE JSON object. Exit codes: 0 the result matched (ok, or the --expect code), 1 it did not,
// 2 usage (the command line is wrong), 3 BLOCKED (a key is missing by name, or the target refused the command).
// Nothing that leaves this program is unredacted (lib/redact.mjs); production runs only `status` and `apply --i-mean-production`.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

const COMMANDS = { status, apply, test: testGroup, seed: seedGroup, key: keyGroup, contract: contractGroup, lead: leadGroup, content: contentGroup, publish, job: jobGroup, verify, mfa: mfaGroup };
export const USAGE = [
  'status | apply [--dry-run] | test walls | verify --only lead|walls|people | mfa enroll-staff',
  'seed test [--alert-to <email>] [--clean] | seed workspace --slug --name --industry --deploy-target --preview-host (--contract <file> | --plan <dir> --entities <file>)',
  'key mint --site <slug> | key list [--site <slug>] | key revoke --id <uuid>',
  'contract validate --file <f> | contract place --file <f> --rows <f>',
  'lead send --site <slug> [--form contact] [--fixture <f>] [--retry] [--key <uuid>] | lead list|get|update|add|delete --as <person> ...',
  'content save|get|history --as <person> ... | publish --as <person> --site <slug> --rows <ids> | job get|wait|set --job <id>',
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
    const res = await run(ctx);
    const expect = flags.expect === undefined || flags.expect === true ? null : String(flags.expect);
    const matched = expect !== null ? res.code === expect : res.ok;
    out = { ok: res.ok, command: name(), target: ['local', 'staging', 'production'].includes(ctx.targetName) && ctxUsesTarget(command) ? ctx.targetName : undefined, code: res.code, ...(expect !== null ? { expect, matched } : {}), exit: matched ? 0 : 1, data: res.data, ...(ctx.warnings.length ? { warnings: ctx.warnings } : {}) };
  } catch (e) {
    if (e instanceof Usage) out = { ok: false, command: name(), code: 'USAGE', exit: 2, error: e.message };
    else if (e instanceof Blocked) out = { ok: false, command: name(), code: 'BLOCKED', exit: 3, error: e.message, ...(e.unblock ? { unblock: e.unblock } : {}) };
    else out = { ok: false, command: name(), code: 'INTERNAL', exit: 1, error: String(e && e.message || e).slice(0, 300) };
  }
  return finish(out);

  function finish(obj) {
    const lines = obj.data && Array.isArray(obj.data.lines) && obj.command === 'verify' ? obj.data.lines.map(l => redact(l, env)).join('\n') + '\n' : '';
    return { exit: obj.exit, stdout: render(obj, { compact: Boolean(parsed.flags.json), env }), stderr: lines };
  }
}

// only commands that talk to a target show one in their result
const ctxUsesTarget = command => command !== 'contract';

const isMain = (() => { try { return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  const r = await main(process.argv.slice(2));
  process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exitCode = r.exit;
}
