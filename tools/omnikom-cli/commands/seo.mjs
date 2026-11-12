// seo run <url> --client <slug> [--only id,id] [--from id] [--module name] [--fresh] [--env-file <f>] [--json]   every mechanical step of a client SEO audit
// seo resume <url> [--only ..] [--from ..] [--module ..] [--env-file <f>] [--json]                                the same run, from its log (the client is read from it, nothing is redone)
// seo status <url> [--json]                                                                                       the coverage table from the run log; runs nothing
// seo vantage status [--json] [--pewp <dir>]                                                                      SEO's vantage.mjs status, its output unchanged; its exit code too, except 4 (SKIPPED) comes back as 3
// The steps come ONLY from SEO's manifest (skills/programmatic-enterprise-web-performance/pipeline.json, read from this repository, never from ~/.claude):
// lib/seo-manifest.mjs validates it (a bad manifest is exit 2 with every problem listed) and lib/seo-run.mjs runs it. This file adds no step, rewrites no
// reason and swallows no exit code, like commands/audit.mjs. Nothing here touches a client's site except what a manifest step does, and a run never
// calls `vantage start`. Exit: 0 when no step FAILED (a BLOCKED, WAITING or SKIPPED step is a state, not a failure), 1 when any step FAILED, 2 usage or an
// invalid manifest; seo vantage status returns the script's own lines and exit code (0 ok, 2 usage, 3 BLOCKED) except that its 4 (SKIPPED: no allowed US egress) comes
// back as 3, and a missing script is BLOCKED (3) naming it. seo run and seo resume run the skill check (commands/skill.mjs) first: a skill that is not the repository's copy is exit 2.
// In text mode (no --json) omnikom.mjs prints seoText() instead of the JSON object; vantage always prints the script's own output.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Usage, Blocked } from '../lib/errors.mjs';
import { SLUG } from '../lib/args.mjs';
import { importRepo, repoPath } from '../lib/repo.mjs';
import { redact } from '../lib/redact.mjs';
import { result } from '../lib/ctx.mjs';
import { validateManifest, parseManifest, hostOf, norm } from '../lib/seo-manifest.mjs';
import { runSeo, statusSeo, STATES, NOT_RUN } from '../lib/seo-run.mjs';
import { skillCheck } from './skill.mjs';

const VERBS = ['run', 'resume', 'status', 'vantage'];
const VANTAGE_VERBS = ['status'];
const VANTAGE_MINUTES = 10;
export const SKILL = ['skills', 'programmatic-enterprise-web-performance'];

// the skill folder of THIS repository (a test hands its own through deps.seo.skillDir)
export const skillDirOf = ctx => (ctx.seo && ctx.seo.skillDir ? resolve(ctx.seo.skillDir) : repoPath(...SKILL));

function loadManifest(ctx, skillDir) {
  const file = join(skillDir, 'pipeline.json');
  if (!existsSync(file)) throw new Usage(`the manifest is not at ${norm(file)} (SEO's skills/programmatic-enterprise-web-performance/pipeline.json, in this repository)`);
  const manifest = parseManifest(readFileSync(file, 'utf8'), norm(file));
  const problems = validateManifest(manifest, { skillDir, repoRoot: ctx.repo });
  if (problems.length) throw new Usage(`the manifest ${norm(file)} is invalid (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n${problems.map(x => `- ${x}`).join('\n')}`);
  return manifest;
}

const list = (name, v) => {
  if (v === undefined) return undefined;
  const ids = String(v).split(',').map(s => s.trim()).filter(Boolean);
  if (ids.length === 0) throw new Usage(`--${name} needs at least one id`);
  return ids;
};

async function vantage(ctx, skillDir) {
  const f = ctx.flags;
  const verb = ctx.positionals[2];
  if (!VANTAGE_VERBS.includes(verb)) throw new Usage(`seo vantage takes ${VANTAGE_VERBS.join(' | ')}`);
  if (ctx.positionals.length > 3) throw new Usage(`seo vantage: unexpected argument '${ctx.positionals[3]}'`);
  for (const k of Object.keys(f)) if (!['json', 'pewp'].includes(k)) throw new Usage(`seo vantage takes only --json and --pewp <dir> (got --${k})`);
  if (f.pewp !== undefined && (f.pewp === true || f.pewp === '')) throw new Usage('--pewp needs a folder');
  const script = join(skillDir, 'scripts', 'vantage.mjs');
  if (!existsSync(script)) throw new Blocked(`vantage.mjs is not at ${norm(script)}`, "SEO's scripts/vantage.mjs (work order 43) being in the repository");
  const args = [script, verb, ...(f.json ? ['--json'] : []), ...(f.pewp !== undefined ? ['--pewp', String(f.pewp)] : [])];
  const guard = await importRepo('tools/proc-guard/index.mjs');
  const r = await guard.runLimited(process.execPath, args, { cwd: skillDir, env: ctx.env, timeout: VANTAGE_MINUTES * 60000 });
  const code = typeof r.status === 'number' ? r.status : 1;
  const exit = code === 4 ? 3 : code;   // the script's 4 (SKIPPED: no allowed US egress) is BLOCKED here: a caller sees 3, the script's lines stay as they are
  const stderr = r.status === null ? `${r.stderr || ''}${r.timedOut ? `seo vantage ${verb}: stopped after ${VANTAGE_MINUTES} minutes\n` : `seo vantage ${verb}: could not run: ${String((r.error && r.error.message) || r.signal || 'no exit code')}\n`}` : r.stderr || '';
  return result(exit === 0, exit === 0 ? 'ok' : `VANTAGE-${exit}`, { exit, stdout: r.stdout || '', stderr, raw: true });
}

export const seoGroup = async ctx => {
  const f = ctx.flags;
  const verb = ctx.positionals[1];
  if (!VERBS.includes(verb)) throw new Usage(`seo takes ${VERBS.join(' | ')}`);
  const skillDir = skillDirOf(ctx);
  if (verb === 'vantage') return vantage(ctx, skillDir);
  if (ctx.positionals.length < 3) throw new Usage(`seo ${verb} needs the site's url`);
  if (ctx.positionals.length > 3) throw new Usage(`seo ${verb}: unexpected argument '${ctx.positionals[3]}'`);
  const url = ctx.positionals[2];
  hostOf(url);
  if (f.expect !== undefined) throw new Usage('seo takes no --expect: a run that can be told to match a failure is not a coverage table');
  const allowed = { run: ['client', 'only', 'from', 'module', 'fresh', 'env-file', 'json'], resume: ['only', 'from', 'module', 'env-file', 'json', 'client'], status: ['json'] }[verb];
  for (const k of Object.keys(f)) if (!allowed.includes(k)) throw new Usage(`seo ${verb} takes no --${k}${k === 'fresh' ? ' (a resume redoes nothing; use seo run --fresh)' : ''}`);
  if (verb === 'run' && (f.client === undefined || f.client === true || f.client === '')) throw new Usage('--client <slug> is required');
  if (f.client !== undefined && !SLUG.test(String(f.client))) throw new Usage('--client must be a slug (lowercase words joined by hyphens)');
  for (const k of ['from', 'module', 'env-file']) if (f[k] !== undefined && (f[k] === true || f[k] === '')) throw new Usage(`--${k} needs a value`);
  if (verb === 'run' || verb === 'resume') {
    const sc = ((ctx.seo && ctx.seo.skillCheck) || (() => skillCheck({ repo: ctx.repo, skillsDir: ctx.env.OMNIKOM_SKILLS_DIR || join(homedir(), '.claude', 'skills') })))();
    if (!sc.ok) throw new Usage(`skill check pewp failed: ${sc.problems.join('; ')}`);
  }
  const manifest = loadManifest(ctx, skillDir);
  if (verb === 'status') return fromData(statusSeo({ manifest, skillDir, url, client: undefined }));
  const data = await runSeo({
    manifest, skillDir, repoRoot: ctx.repo, url, client: f.client, resume: verb === 'resume', only: list('only', f.only), from: f.from, module: f.module,
    fresh: Boolean(f.fresh), envFile: f['env-file'] === undefined ? undefined : resolve(f['env-file']), env: ctx.env,
    heavyScript: (ctx.seo && ctx.seo.heavyScript) || join(homedir(), '.claude', 'scripts', 'heavy.mjs'),
    kill: ctx.seo && ctx.seo.killTree, graceMs: ctx.seo && ctx.seo.graceMs,   // tests only: a killer that does nothing, a short grace
    stopsDir: ctx.seo && ctx.seo.stopsDir,   // tests only: their own stop folder (else ~/.claude/state/omnikom-stops)
  });
  return fromData(data);
};
const fromData = d => result(d.failed === 0, d.failed === 0 ? 'ok' : 'SEO-FAILED', d);

// What text mode prints (instead of the JSON object); every line passes through redact (section 5 rule 1):
//   seo <run|status>: <url>  client <slug>  host <host>
//   run began <time>, log <path>
//   STATE  STEP  MODULE  DETAIL            one row per step of the manifest, in its order; a WAITING row has its brief, inputs and outputs under it
//   counts: RUN n, SKIPPED n, BLOCKED n, WAITING n, PARTIAL n, FAILED n, NOT RUN n (of N steps)   then one line per module
//   an error or a stop before any table: one line   ERROR <message>   (and `unblocks: ...` for a BLOCKED)
export function seoText(obj, env) {
  const d = obj.data;
  const out = [];
  if (obj.error || !d) {
    out.push(`ERROR ${obj.error || obj.code}`);
    if (obj.unblock) out.push(`unblocks: ${obj.unblock}`);
  } else {
    const idw = Math.max(4, ...d.steps.map(r => r.id.length)), mw = Math.max(6, ...d.steps.map(r => r.module.length));
    if (d.mode === 'RESUME') out.push('mode RESUME: finishing the existing run for this client (steps already done are adopted; only missing or stale steps run)');
    if (d.mode === 'FRESH') out.push(`mode FRESH: starting over (--fresh); discarded ${d.discarded.length} step(s) done before${d.discarded.length ? `: ${d.discarded.join(', ')}` : ''}`);
    out.push(`seo ${obj.command.split(' ')[1]}: ${d.url}  client ${d.client || '(no run yet)'}  host ${d.host}`);
    out.push(d.hasLog ? `run began ${d.runStartedAt}, last written ${d.updatedAt}, log ${norm(d.logFile)}` : `no run log yet (${norm(d.logFile)})`);
    out.push(`${'STATE'.padEnd(8)} ${'STEP'.padEnd(idw)} ${'MODULE'.padEnd(mw)} DETAIL`);
    for (const r of d.steps) {
      out.push(`${r.state.padEnd(8)} ${r.id.padEnd(idw)} ${r.module.padEnd(mw)} ${r.detail}`);
      for (const m of r.more) out.push(`${' '.repeat(8 + 1 + idw + 1 + mw + 1)}${m}`);
    }
    out.push(`counts: ${[...STATES, NOT_RUN].map(s => `${s} ${d.counts[s]}`).join(', ')} (of ${d.total} steps)`);
    for (const [name, m] of Object.entries(d.modules)) out.push(`module ${name}: ${[...STATES, NOT_RUN].filter(s => m[s]).map(s => `${m[s]} ${s}`).join(', ')} (of ${m.total})`);
  }
  return redact(out.join('\n'), env) + '\n';
}
