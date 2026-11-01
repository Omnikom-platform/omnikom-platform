// audit --dir <folder> [--json] [--only <ids>] [--target preview|production]   the audit engine over a built folder (tools/audit), its lines printed as the engine made them
// gate  --dir <folder> [--json] [--target preview|production]                  the publish gate: every rule, only the FAIL lines and one verdict line (23-GROUND-RULES rule 7)
// Both are thin: the engine judges, this file adds no rule, rewrites no line and swallows no exit code. Both read a folder and write
// nothing: no network, no database, no environment. --dir is required (a gate that runs on the wrong folder passes silently).
// --target is the BUILD target (the engine's ENV-001 judges indexing against it), passed through as { target }; with none the engine
// passes nothing on to ENV-001 (it prints its one SKIP line). lib/target.mjs exempts exactly these two commands from the production guard.
// Exit: 0 no FAIL, 1 at least one FAIL (main derives both from result.ok), 2 usage, bad rule id, or a crash inside the engine
// (a crash is never a pass and never a plain FAIL). In text mode (no --json) omnikom.mjs prints textOutput() instead of the JSON object.
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Usage, Blocked } from '../lib/errors.mjs';
import { need } from '../lib/args.mjs';
import { importRepo } from '../lib/repo.mjs';
import { redact } from '../lib/redact.mjs';
import { result } from '../lib/ctx.mjs';

// the engine (or this wiring) broke: exit 2, code AUDIT-CRASH, never 0 and never 1
export class AuditCrash extends Error {
  constructor(message) { super(message); this.name = 'AuditCrash'; }
}

const BUILD_TARGETS = ['preview', 'production'];
const isFail = line => /^FAIL /.test(line);
const message = e => String((e && e.message) || e).slice(0, 300);

function inputs(ctx, name, { only }) {
  const f = ctx.flags;
  if (ctx.positionals.length > 1) throw new Usage(`${name}: unexpected argument '${ctx.positionals[1]}' (the folder goes in --dir)`);
  // --target here is the BUILD target the engine judges ENV-001 against, never a database environment (these two commands talk to none)
  if (f.target !== undefined && !BUILD_TARGETS.includes(f.target)) throw new Usage(`${name} takes --target preview|production (the build's target); it talks to no environment`);
  if (f.expect !== undefined) throw new Usage(`${name} takes no --expect: a verdict that can be told to match a failure is not a gate`);
  if (!only && f.only !== undefined) throw new Usage(`${name} takes no --only: a gate with fewer rules is a weaker gate`);
  const dir = resolve(need(f, 'dir'));
  let isDir = false;
  try { isDir = existsSync(dir) && statSync(dir).isDirectory(); } catch { isDir = false; }
  if (!isDir) throw new Usage(`--dir is not a folder: ${f.dir}`);
  let rules;
  if (only && f.only !== undefined) {
    rules = String(f.only).split(',').map(s => s.trim()).filter(Boolean);
    if (rules.length === 0) throw new Usage('--only needs at least one rule id');
  }
  return { dir, rules, target: f.target };
}

// the library call; a refusal of the engine (AuditError: unknown rule id, bad config) is usage, any other throw is a crash
async function runLib(ctx, dir, options) {
  let lib;
  let r;
  try {
    lib = ctx.auditLib || await importRepo('tools/audit/index.mjs');
    r = lib.audit(dir, options);
  } catch (e) {
    if (lib && typeof lib.AuditError === 'function' && e instanceof lib.AuditError) throw new Usage(message(e));
    throw new AuditCrash(`audit crashed: ${message(e)}`);
  }
  const shaped = r && typeof r === 'object' && typeof r.pass === 'boolean' && Array.isArray(r.lines) && Array.isArray(r.pages) && Array.isArray(r.rules);
  if (!shaped) throw new AuditCrash('audit crashed: the library returned an unreadable result');
  if (r.pass && r.lines.some(isFail)) throw new AuditCrash('audit crashed: the library says pass but returned FAIL lines');
  return r;
}

// anything unexpected inside a command becomes a crash (exit 2), not an INTERNAL exit 1 that reads like a FAIL
const guarded = fn => async ctx => {
  try { return await fn(ctx); } catch (e) {
    if (e instanceof Usage || e instanceof Blocked || e instanceof AuditCrash) throw e;
    throw new AuditCrash(`audit crashed: ${message(e)}`);
  }
};

export const audit = guarded(async ctx => {
  const { dir, rules, target } = inputs(ctx, 'audit', { only: true });
  const r = await runLib(ctx, dir, { ...(rules ? { rules } : {}), ...(target ? { target } : {}) });
  return result(r.pass, r.pass ? 'ok' : 'AUDIT-FAILED', r);
});

export const gate = guarded(async ctx => {
  const { dir, target } = inputs(ctx, 'gate', { only: false });
  const r = await runLib(ctx, dir, target ? { target } : {});
  const fails = r.lines.filter(isFail);
  const pass = r.pass && fails.length === 0;
  const data = { pass, exit: pass ? 0 : 1, fails, pages: r.pages.length, rules: r.rules.length };
  return result(data.pass, data.pass ? 'ok' : 'AUDIT-FAILED', data);
});

// What text mode prints for audit and gate (instead of the JSON object). Every line passes through redact (section 5 rule 1).
//   audit: the engine's lines unchanged, then   audit: <pages> pages, <rules> rules, <n> FAIL, <n> WARN, <n> SKIP
//   gate:  GATE PASS <pages> pages, <rules> rules      or      GATE FAIL <n> finding(s)  then the FAIL lines
//   anything that stopped before an answer (usage, crash): one line   ERROR <message>
export function textOutput(command, obj, env) {
  const d = obj.data;
  const out = [];
  if (obj.error || !d) out.push(redact(`ERROR ${obj.error || obj.code}`, env));
  else if (command === 'audit') {
    const shown = d.lines.map(l => redact(l, env));
    const n = prefix => d.lines.filter(l => l.startsWith(prefix + ' ')).length;
    out.push(...shown, `audit: ${d.pages.length} pages, ${d.rules.length} rules, ${n('FAIL')} FAIL, ${n('WARN')} WARN, ${n('SKIP')} SKIP`);
  } else {
    out.push(d.pass ? `GATE PASS ${d.pages} pages, ${d.rules} rules` : `GATE FAIL ${d.fails.length} finding(s)`);
    out.push(...d.fails.map(l => redact(l, env)));
  }
  return out.join('\n') + '\n';
}
