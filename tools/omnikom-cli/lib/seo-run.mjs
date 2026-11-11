// The engine of `omnikom seo run | resume | status` (work order 41): every mechanical step of a client SEO audit, in the order SEO's manifest says.
// The manifest (lib/seo-manifest.mjs) is the only source of steps. This file adds no step, rewrites no reason a script gave and swallows no exit
// code, the same principle as commands/audit.mjs. What it adds is the order (a step runs after what it dependsOn is RUN), the pre-checks that never
// start a script (a missing dependency, key or input file is BLOCKED, by name), the two locks (a host is hit by one step at a time, heavy steps run
// one at a time through heavy.mjs) and the run log {pewp}/seo-run.json, from which the coverage table is read.
// States: RUN (exit 0 AND every evidence glob holds a non-empty file written after the step started, and no input is newer: otherwise the step
// re-runs), SKIPPED (exit 4, the script's own `SKIPPED: <reason>` line), BLOCKED (exit 3 with the script's `BLOCKED: <what> | unblocks: <what>` line,
// or a pre-check), WAITING (an owner-browser, AI or person step: it never runs; it is WAITING with its brief until its outputs are written after
// the run began), PARTIAL (an `exit` override of the manifest says so), FAILED (any other exit, a timeout, exit 0 without evidence). NOT RUN is the
// seventh label: a step no run has reached (filtered out by --only/--from/--module, or never started).
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { Usage } from './errors.mjs';
import { importRepo, repoPath } from './repo.mjs';
import { redact } from './redact.mjs';
import { isWaiting, makeVars, expand, covers, related, resolveScript, liveFiles, expandPath, filesUnder, topoOrder, norm, exitWord, EXIT_WORDS } from './seo-manifest.mjs';

export const STATES = ['RUN', 'SKIPPED', 'BLOCKED', 'WAITING', 'PARTIAL', 'FAILED'];
export const NOT_RUN = 'NOT RUN';
export const SLACK_MS = 2000;      // file times are compared with this much give (FAT keeps two seconds; two clocks differ by milliseconds)
export const MAX_PARALLEL = 4;     // independent steps in flight at once
export const GRACE_MS = 15000;     // after a timeout kill, how long to wait for the process to be gone before naming it and going on
const MAX_LINE = 2000;
const MAX_EVIDENCE = 50;           // evidence paths kept per step in the log (the count is kept whole)

const uniq = list => [...new Set(list)];
const iso = ms => new Date(ms).toISOString();
const lastLine = s => String(s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean).at(-1) ?? null;
const clip = s => (s !== null && s.length > MAX_LINE ? s.slice(0, MAX_LINE) + ' [cut]' : s);

// One step's process, with a limit that cannot hang the run. stdout and stderr are kept apart. At `timeout` the tree is killed (`kill`, proc-guard's killTree); then
// we wait at most `graceMs` for the exit. A process still alive then is NAMED (its pid and its children's), killed once more, and the step settles anyway:
// -> { status, signal, stdout, stderr, timedOut, error, leftover: [pid] } (leftover is empty unless the tree did not exit after the kill)
export function runStep(guard, argv, { cwd, env, timeout, graceMs, kill, maxBuffer = 64 * 1024 * 1024 }) {
  return new Promise(resolve => {
    const out = [], err = [], timers = [];
    let child, size = 0, timedOut = false, settled = false, error = null;
    const finish = (status, signal, leftover = []) => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      resolve({ status, signal, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), timedOut, error, leftover });
    };
    try { child = spawn(argv[0], argv.slice(1), { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { error = e; finish(null, null); return; }
    const take = list => d => { size += d.length; if (size > maxBuffer) { error = new Error('the step printed more than 64 MB'); kill(child.pid); return; } list.push(d); };
    child.stdout.on('data', take(out));
    child.stderr.on('data', take(err));
    timers.push(setTimeout(() => {
      timedOut = true;
      kill(child.pid);
      timers.push(setTimeout(() => {
        let left = [];
        try {
          if (guard.isAlive(child.pid)) {
            const procs = guard.listProcs();
            left = [child.pid];
            for (let grew = true; grew;) { grew = false; for (const p of procs) if (!left.includes(p.pid) && left.includes(p.ppid)) { left.push(p.pid); grew = true; } }
          }
        } catch { left = guard.isAlive(child.pid) ? [child.pid] : []; }
        for (const pid of left) { try { guard.killTree(pid); } catch { /* named below; nothing more to do */ } }
        finish(null, null, left);
      }, graceMs));
    }, timeout));
    child.on('error', e => { error = e; finish(null, null); });
    child.on('exit', (code, signal) => { timers.push(setTimeout(() => finish(code, signal), 5000)); });   // a survivor holding a pipe must not hold the run: 5 s after the exit we go on
    child.on('close', (code, signal) => finish(code, signal));
  });
}

// ---- the run log
export function readLog(file) {
  if (!existsSync(file)) return { log: null };
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    if (j && j.version === 1 && Array.isArray(j.steps)) return { log: j };
  } catch { /* below */ }
  return { log: null, error: `the run log ${norm(file)} is not readable (delete it, or run with --fresh)` };
}
function writeLog(file, log) {
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(log, null, 1) + '\n');
  renameSync(tmp, file);   // a reader never sees half a log
}

// ---- the manifest's steps with their paths filled in
function prepare(manifest, vars) {
  return topoOrder(manifest.steps.map(s => ({
    id: s.id, module: s.module, what: s.what, script: s.script, waiting: isWaiting(s), heavy: s.heavy, hits: s.hits,
    needsKeys: s.needsKeys, dependsOn: s.dependsOn, timeoutMinutes: s.timeoutMinutes, exit: s.exit || {},
    needsBrowser: s.needsBrowser, needsAi: s.needsAi, needsPerson: s.needsPerson, engines: Array.isArray(s.engines) ? s.engines : [],
    args: s.args.map(x => expand(x, vars)),
    inputs: s.inputs.map(x => expand(x, vars)), outputs: s.outputs.map(x => expand(x, vars)),
    brief: s.brief ? expand(s.brief, vars) : null,
    evidence: s.evidence.map(e => ({ glob: expand(e, vars), isOutput: s.outputs.some(o => covers(o, e)) })),
    rawInputs: s.inputs, rawOutputs: s.outputs,
  })));
}

// the evidence of a step: every glob needs a non-empty file; a glob inside an output also needs one written after `since` (a glob that is only
// an input, like targets-validate's targets.json, cannot be written by the step). -> { ok, files: [{ path, mtimeMs, out }], missing: [text] }
function checkEvidence(step, since, allFresh = false) {
  const files = [], missing = [];
  for (const e of step.evidence) {
    const paths = expandPath(e.glob);
    const empty = paths.filter(p => { try { const st = statSync(p); return st.isFile() && st.size === 0; } catch { return false; } });
    const found = paths.flatMap(p => filesUnder(p));
    const need = e.isOutput || allFresh;
    // every match must be non-empty; the NEWEST match must be newer than the step's start (an older sibling from an earlier run does not matter)
    if (paths.length === 0) missing.push(`${e.glob} (no non-empty file)`);
    else if (empty.length) missing.push(`${e.glob} (${empty.length} empty file${empty.length === 1 ? '' : 's'}: ${norm(empty[0])})`);
    else if (found.length === 0) missing.push(`${e.glob} (no non-empty file)`);
    else if (need && Math.max(...found.map(f => f.mtimeMs)) < since - SLACK_MS) missing.push(`${e.glob} (only files older than the step started)`);
    files.push(...found.map(f => ({ ...f, out: need, glob: e.glob })));
  }
  return { ok: missing.length === 0, files, missing };
}
// an input newer than the evidence: newest input file against the oldest of the globs' newest files
function isStale(step, ev) {
  const newestOf = new Map();
  for (const f of ev.files) if (f.out) newestOf.set(f.glob, Math.max(newestOf.get(f.glob) || 0, f.mtimeMs));
  if (newestOf.size === 0) return false;
  const evidenceAt = Math.min(...newestOf.values());
  const inputAt = Math.max(0, ...step.inputs.flatMap(i => liveFiles(i)).map(f => f.mtimeMs));
  return inputAt - evidenceAt > SLACK_MS;
}

// what exit code means which state: the step's own `exit` map first, then 0 ok, 3 BLOCKED, 4 SKIPPED, anything else FAILED
export function classifyExit(step, code) {
  const own = step.exit[String(code)];
  if (own !== undefined) return { state: EXIT_WORDS[exitWord(own)], why: own };
  if (code === 0) return { state: 'RUN' };
  if (code === 3) return { state: 'BLOCKED' };
  if (code === 4) return { state: 'SKIPPED' };
  return { state: 'FAILED', why: code === 2 ? 'usage' : undefined };
}

function envFileVars(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { throw new Usage(`--env-file is not readable: ${norm(file)}`); }
  const out = {};
  for (const l of text.split(/\r?\n/)) { const m = l.match(/^([A-Z][A-Z0-9_]*)=(.*)$/); if (m) out[m[1]] = m[2]; }
  return out;
}

// the state of the steps a filter keeps: --only (ids), --from (the step and everything that depends on it), --module; all of them must hold
export function selectSteps(steps, { only, from, module }) {
  const ids = steps.map(s => s.id);
  for (const id of only || []) if (!ids.includes(id)) throw new Usage(`--only: there is no step '${id}' (the steps: ${ids.join(', ')})`);
  if (from !== undefined && !ids.includes(from)) throw new Usage(`--from: there is no step '${from}' (the steps: ${ids.join(', ')})`);
  const modules = uniq(steps.map(s => s.module));
  if (module !== undefined && !modules.includes(module)) throw new Usage(`--module: there is no module '${module}' (the modules: ${modules.join(', ')})`);
  const down = new Set(from !== undefined ? [from] : []);
  for (let grew = from !== undefined; grew;) {
    grew = false;
    for (const s of steps) if (!down.has(s.id) && s.dependsOn.some(d => down.has(d))) { down.add(s.id); grew = true; }
  }
  const picked = steps.filter(s => (!only || only.includes(s.id)) && (from === undefined || down.has(s.id)) && (module === undefined || s.module === module));
  if (picked.length === 0) throw new Usage('--only, --from and --module together select no step');
  return new Set(picked.map(s => s.id));
}

// ---- one row of the table, from a step and its log entry (shared by run and status)
const where = (skillDir, p) => { const r = relative(skillDir, p).split(sep).join('/'); return r.startsWith('..') ? norm(p) : r; };
export function rowOf(step, entry, skillDir, how) {
  const base = { id: step.id, module: step.module };
  if (!entry) return { ...base, state: NOT_RUN, detail: 'not run yet', more: [] };
  const ev = (entry.evidence || []).map(p => where(skillDir, p));
  let state = entry.state, detail = '', more = [];
  if (state === 'RUNNING') { state = 'FAILED'; detail = `interrupted: started ${entry.startedAt}, no end was recorded; resume runs it again`; }
  else if (state === 'RUN') detail = `${ev[0] || '(no evidence recorded)'}${(entry.evidenceCount || ev.length) > 1 ? ` (+${(entry.evidenceCount || ev.length) - 1} more)` : ''}${how ? ` [${how}]` : ''}`;
  else if (state === 'WAITING') {
    const w = entry.waiting;
    detail = `needs ${w.who.join(' and ')}`;
    more = [`do: ${w.brief}`, `reads: ${w.inputs.length ? w.inputs.map(p => where(skillDir, p)).join(', ') : '(nothing)'}`, `write: ${w.outputs.map(p => where(skillDir, p)).join(', ')}`,
      `done when: ${w.evidence.map(p => where(skillDir, p)).join(', ')} hold non-empty files written after ${w.runStartedAt}`];
  } else if (state === 'PARTIAL') detail = `exit ${entry.exit}: ${entry.line ?? '(no output)'}${entry.reason ? ` [manifest: ${entry.reason}]` : ''}`;
  else if (state === 'FAILED') detail = entry.timedOut ? `${entry.reason}${entry.line ? `; last line: ${entry.line}` : ''}` : entry.exit !== undefined && entry.exit !== null ? `exit ${entry.exit}${entry.line === null && entry.reason ? '' : `: ${entry.line ?? '(no output)'}`}${entry.reason ? ` [${entry.reason}]` : ''}` : (entry.reason || 'failed');
  else detail = entry.line ?? entry.reason ?? '';   // SKIPPED, BLOCKED: the script's own line, else the pre-check's sentence
  return { ...base, state, detail, more, exit: entry.exit, line: entry.line ?? null, reason: entry.reason ?? null, evidence: ev, evidenceCount: entry.evidenceCount ?? ev.length, startedAt: entry.startedAt, endedAt: entry.endedAt, ...(entry.leftover ? { leftover: entry.leftover } : {}), logFile: entry.logFile ? where(skillDir, entry.logFile) : undefined, ...(entry.waiting ? { waiting: { ...entry.waiting, inputs: entry.waiting.inputs.map(p => where(skillDir, p)), outputs: entry.waiting.outputs.map(p => where(skillDir, p)) } } : {}), ...(how ? { how } : {}) };
}

export function summarize(steps, rows) {
  const counts = Object.fromEntries([...STATES, NOT_RUN].map(s => [s, 0]));
  const modules = {};
  for (const r of rows) {
    counts[r.state]++;
    const m = (modules[r.module] ||= { total: 0, ...Object.fromEntries([...STATES, NOT_RUN].map(s => [s, 0])) });
    m.total++; m[r.state]++;
  }
  return { counts, modules, total: rows.length };
}

// ---- status: the table from the run log, runs nothing
export function statusSeo({ manifest, skillDir, url, client }) {
  const vars = makeVars({ url, client: client || '', skillDir });
  const steps = prepare(manifest, vars);
  const logFile = `${vars.pewp}/seo-run.json`;
  const { log, error } = readLog(logFile);
  if (error) throw new Usage(error);
  const entries = new Map((log ? log.steps : []).map(e => [e.id, e]));
  const rows = steps.map(s => rowOf(s, entries.get(s.id), skillDir));
  return { url, client: log ? log.client : null, host: vars.host, runStartedAt: log ? log.runStartedAt : null, updatedAt: log ? log.updatedAt : null, logFile, hasLog: Boolean(log), order: steps.map(s => s.id), steps: rows, ...summarize(steps, rows), failed: rows.filter(r => r.state === 'FAILED').length };
}

// ---- run and resume
// o: { manifest, skillDir, repoRoot, url, client, resume, only, from, module, fresh, envFile, env, heavyScript }
// An engine's stop file (SEO head 2026-11-11): {engine, hosts, until (ISO UTC), reason, setBy, setAt, evidence}. Active while `until` is in the
// future; an expired one counts as absent (it stays as a record). A file that cannot be read or has no valid `until` stops the engine (fail closed).
export const STOPS_DIR = join(homedir(), '.claude', 'state', 'omnikom-stops');
// A stop may carry "lift": {mode: "desktop", by, at, note} (the owner, 2026-11-11 04:44): it frees only a person-paced capture in the owner's
// own browser. `mode` is "desktop" for an owner-browser waiting step and "script" for everything else, so a script never passes a lifted stop.
export function activeStop(dir, engine, now = Date.now(), mode = 'script') {
  const file = join(dir, `${engine}.json`);
  if (!existsSync(file)) return null;
  let s;
  try { s = JSON.parse(readFileSync(file, 'utf8')); } catch { return { engine, until: null, reason: `stop file ${norm(file)} cannot be read` }; }
  const until = Date.parse(s && s.until);
  if (!Number.isFinite(until)) return { engine, until: null, reason: `stop file ${norm(file)} has no valid until` };
  if (s.lift && typeof s.lift === 'object' && s.lift.mode === mode && mode === 'desktop') return null;
  return until > now ? { engine, until: new Date(until).toISOString(), reason: String(s.reason || 'no reason given') } : null;
}

export async function runSeo(o) {
  const stopsDir = o.stopsDir || STOPS_DIR;
  const { skillDir, url } = o;
  const env = o.env || process.env;
  const logFile0 = makeVars({ url, client: 'x', skillDir }).pewp + '/seo-run.json';
  const read = readLog(logFile0);
  if (read.error && !o.fresh) throw new Usage(read.error);
  let prior = read.log;
  let client = o.client;
  if (o.resume) {
    if (!prior) throw new Usage(`there is no run log for ${url} (${norm(logFile0)}); start with: omnikom seo run ${url} --client <slug>`);
    if (client !== undefined && client !== prior.client) throw new Usage(`--client ${client} is not the client of this run (${prior.client})`);
    client = prior.client;
  } else if (prior && prior.client !== client && !o.fresh) throw new Usage(`the run log of ${url} belongs to client '${prior.client}', not '${client}' (run with --fresh to start a new run)`);
  const vars = makeVars({ url, client, skillDir });
  const steps = prepare(o.manifest, vars);
  const byId = new Map(steps.map(s => [s.id, s]));
  const selected = selectSteps(steps, o);
  const wholeFresh = o.fresh && !o.only && o.from === undefined && o.module === undefined;
  // the mode (owner 2026-11-11): RESUME by default (an existing run is finished, never restarted); FRESH only with --fresh, saying what it discards
  const mode = wholeFresh ? 'FRESH' : 'RESUME';
  const discarded = wholeFresh ? steps.filter(s => (prior && prior.steps.some(e => e.id === s.id && e.state === 'RUN')) || checkEvidence(s, 0, s.waiting).ok).map(s => s.id) : [];
  if (wholeFresh) prior = null;
  const forced = o.fresh || o.from !== undefined;
  const fileVars = o.envFile ? envFileVars(o.envFile) : {};
  const secrets = { ...env, ...fileVars };   // for redaction only: a value of the env file is masked like one of the environment
  const keyPresent = n => { const v = Object.hasOwn(fileVars, n) ? fileVars[n] : env[n]; return typeof v === 'string' && v !== ''; };
  const pewp = vars.pewp, logFile = `${pewp}/seo-run.json`;
  mkdirSync(`${pewp}/seo-run`, { recursive: true });
  mkdirSync(vars.work, { recursive: true });
  const runStartMs = prior && Date.parse(prior.runStartedAt) ? Date.parse(prior.runStartedAt) : Date.now();
  const entries = new Map((prior ? prior.steps : []).map(e => [e.id, e]));
  const log = { version: 1, url, client, host: vars.host, runStartedAt: iso(runStartMs), updatedAt: iso(Date.now()), steps: [] };
  const save = () => { log.updatedAt = iso(Date.now()); log.steps = steps.filter(s => entries.has(s.id)).map(s => entries.get(s.id)); writeLog(logFile, log); };
  const guard = await importRepo('tools/proc-guard/index.mjs');
  const withEnv = repoPath('tools', 'with-env.mjs');
  const kill = o.kill || guard.killTree;                      // a test hands one that does nothing, to stand for a process that survives the kill
  const graceMs = o.graceMs === undefined ? GRACE_MS : o.graceMs;
  const settled = new Map();   // id -> { entry, how }
  const stateOf = id => (settled.get(id).entry ? settled.get(id).entry.state : NOT_RUN);

  const writersOf = raw => steps.filter(t => t.rawOutputs.some(x => related(x, raw))).map(t => t.id);
  const inputsMissing = step => step.inputs.map((p, i) => ({ p, raw: step.rawInputs[i] })).filter(({ p }) => liveFiles(p).length === 0);

  // a runnable step that an earlier run finished: exit 0 in the log AND the evidence, still current
  function doneBefore(step) {
    const e = entries.get(step.id);
    if (!e || e.state !== 'RUN') return null;
    if (!e.adopted && (!e.startedAt || classifyExit(step, e.exit).state !== 'RUN')) return null;
    const ev = checkEvidence(step, e.adopted ? 0 : Date.parse(e.startedAt), e.adopted && step.waiting);   // an adopted step never started: its evidence counts at any age
    return ev.ok && !isStale(step, ev) ? ev : null;
  }
  // a waiting step whose outputs and evidence were all written after the run began
  function waitingDone(step) {
    for (const out of step.outputs) if (!liveFiles(out).some(f => f.mtimeMs >= runStartMs - SLACK_MS)) return null;
    const ev = checkEvidence(step, runStartMs, true);
    return ev.ok ? ev : null;
  }
  // a step the log does not know whose outputs and evidence are already there and not older than its inputs: adopted, not run again
  function adoptable(step) {
    if (entries.has(step.id)) return null;   // the log knows it (a failure stays a failure)
    for (const out of step.outputs) if (!liveFiles(out).length) return null;
    const ev = checkEvidence(step, 0, step.waiting);
    if (!ev.ok || isStale(step, ev)) return null;
    return ev;
  }
  const evidenceOf = ev => uniq(ev.files.map(f => f.path));
  const runEntry = (step, ev, extra = {}) => { const all = evidenceOf(ev); return { ...extra, id: step.id, module: step.module, state: 'RUN', evidence: all.slice(0, MAX_EVIDENCE), evidenceCount: all.length }; };
  const blocked = (step, reason) => ({ id: step.id, module: step.module, state: 'BLOCKED', exit: undefined, line: null, reason, endedAt: iso(Date.now()) });

  // the decision for a step whose dependencies are all settled: { final: { entry, how, store } } or { launch: true }
  function decide(step) {
    if (!selected.has(step.id)) {
      const ev = step.waiting ? waitingDone(step) : doneBefore(step);
      if (ev) return { final: { entry: runEntry(step, ev, entries.get(step.id) || {}), how: 'not selected, already done', store: false } };
      return { final: { entry: entries.get(step.id) || null, how: null, store: false } };
    }
    if (step.waiting) {
      const ev = waitingDone(step);
      if (ev) return { final: { entry: runEntry(step, ev, { startedAt: iso(runStartMs), endedAt: iso(Date.now()) }), how: 'outputs written', store: true } };
    } else if (!forced) {
      const ev = doneBefore(step);
      if (ev) return { final: { entry: runEntry(step, ev, entries.get(step.id)), how: 'already done', store: false } };
    }
    if (!forced) {
      const ev = adoptable(step);
      if (ev) return { final: { entry: runEntry(step, ev, { adopted: true, adoptedAt: iso(Date.now()) }), how: 'adopted', store: true } };
    }
    const notRun = step.dependsOn.filter(d => stateOf(d) !== 'RUN' && stateOf(d) !== 'SKIPPED');   // a SKIPPED step is settled: its dependents run (what they need from it is checked as an input)
    if (notRun.length) {
      const what = notRun.map(d => `${d} (${stateOf(d)})`).join(', ');
      return { final: { entry: blocked(step, `BLOCKED: waits for ${what} | unblocks: ${notRun.join(', ')} reaching RUN`), store: true } };
    }
    // an engine stop (a robot check, a ban): the step never starts and a waiting one is not handed to an agent either
    const stopMode = step.waiting && step.needsBrowser === 'owner' ? 'desktop' : 'script';
    const stops = step.engines.map(e => activeStop(stopsDir, e, Date.now(), stopMode)).filter(Boolean);
    if (stops.length) {
      const what = stops.map(s => `${s.engine} stopped ${s.until ? `until ${s.until}` : '(no end time)'} (${s.reason})`).join('; ');
      const ends = stops.map(s => s.until).filter(Boolean).sort();
      return { final: { entry: blocked(step, `BLOCKED: ${what} | unblocks: ${stops.some(s => !s.until) ? 'a readable stop file with a valid until, or its owner lifting the stop' : `the stop ending at ${ends[ends.length - 1]}, or its owner lifting it`}`), store: true } };
    }
    if (!step.waiting) {
      const lacking = step.needsKeys.filter(k => !keyPresent(k));
      if (lacking.length) return { final: { entry: blocked(step, `BLOCKED: ${lacking.length === 1 ? 'key' : 'keys'} ${lacking.join(', ')} not set | unblocks: set ${lacking.length === 1 ? 'it' : 'them'} in the environment or pass --env-file with ${lacking.length === 1 ? 'it' : 'them'}`), store: true } };
    }
    const gone = inputsMissing(step);
    if (gone.length) {
      const text = gone.map(({ p, raw }) => { const w = writersOf(raw).filter(id => id !== step.id); return `${where(skillDir, p)} (${w.length ? `written by ${w.join(', ')}` : 'no step of the manifest writes it'})`; }).join('; ');
      const unblock = uniq(gone.flatMap(({ raw }) => writersOf(raw)).filter(id => id !== step.id));
      return { final: { entry: blocked(step, `BLOCKED: missing input ${text} | unblocks: ${unblock.length ? `${unblock.join(', ')} writing it` : 'the file being put there'}`), store: true } };
    }
    if (step.waiting) {
      const who = [step.needsBrowser === 'owner' && "the owner's browser", step.needsAi && 'an AI agent', step.needsPerson && 'a person'].filter(Boolean);
      const waiting = { who, brief: step.brief, inputs: step.inputs, outputs: step.outputs, evidence: step.evidence.map(e => e.glob), runStartedAt: iso(runStartMs) };
      return { final: { entry: { id: step.id, module: step.module, state: 'WAITING', waiting, endedAt: iso(Date.now()) }, store: true } };
    }
    if (step.heavy && !existsSync(o.heavyScript)) return { final: { entry: blocked(step, `BLOCKED: heavy steps run through heavy.mjs, which is not at ${norm(o.heavyScript)} | unblocks: install it there`), store: true } };
    return { launch: true };
  }

  // run the script; -> the entry
  async function execute(step) {
    const script = resolveScript(step.script, { skillDir, repoRoot: o.repoRoot });
    let argv = [process.execPath, script, ...step.args];
    const childEnv = { ...env };
    if (o.envFile && step.needsKeys.length) { argv = [process.execPath, withEnv, o.envFile, '--', ...argv]; childEnv.WITH_ENV_TIMEOUT_MIN = '0'; }   // keys reach only the steps that name them; the limit is ours
    if (step.heavy) argv = [process.execPath, o.heavyScript, '--label', `SEO run ${client}: ${step.id}`, '--', ...argv];
    const startMs = Date.now();
    const base = { id: step.id, module: step.module, startedAt: iso(startMs), timeoutMinutes: step.timeoutMinutes };
    entries.set(step.id, { ...base, state: 'RUNNING' });
    save();
    const r = await runStep(guard, argv, { cwd: skillDir, env: childEnv, timeout: Math.round(step.timeoutMinutes * 60000), graceMs, kill });
    const out = redact(r.stdout || '', secrets), err = redact(r.stderr || '', secrets);
    const logPath = `${pewp}/seo-run/${step.id}.log`;
    writeFileSync(logPath, `$ ${argv.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n--- stdout\n${out}\n--- stderr\n${err}\n`);
    const done = { ...base, endedAt: iso(Date.now()), logFile: logPath };
    if (r.error && r.status === null && !r.timedOut) return { ...done, state: 'FAILED', exit: null, line: null, reason: `could not run: ${redact(String(r.error.message || r.error), secrets).slice(0, 300)}` };
    if (r.timedOut) return { ...done, state: 'FAILED', exit: r.status, timedOut: true, line: clip(redact(lastLine(err) || lastLine(out) || '', secrets) || null), ...(r.leftover.length ? { leftover: r.leftover } : {}), reason: r.leftover.length ? `timeout after ${step.timeoutMinutes} min; the process tree did not exit after the kill (pids ${r.leftover.join(', ')})` : `timeout after ${step.timeoutMinutes} min, the process tree was stopped` };
    const code = r.status === null ? -1 : r.status;
    const c = classifyExit(step, code);
    const want = c.state === 'BLOCKED' ? /^BLOCKED:/ : c.state === 'SKIPPED' ? /^SKIPPED:/ : null;
    const cands = [lastLine(err), lastLine(out)].filter(Boolean);
    const line = clip(want ? cands.find(x => want.test(x)) ?? null : cands[0] ?? null);
    if (c.state === 'RUN') {
      const ev = checkEvidence(step, startMs);
      if (!ev.ok) return { ...done, state: 'FAILED', exit: code, line, reason: `exit 0 but evidence missing: ${ev.missing.join('; ')}` };
      return { ...runEntry(step, ev, done), exit: code, line };
    }
    // exit 3 or 4 without its prefix line breaks the contract: FAILED, naming the line that is missing (never a made-up reason)
    if ((c.state === 'BLOCKED' || c.state === 'SKIPPED') && line === null) return { ...done, state: 'FAILED', exit: code, line: null, reason: `contract break: exit ${code} (${c.state}) without a '${c.state}: <${c.state === 'BLOCKED' ? 'what> | unblocks: <what' : 'reason'}>' line` };
    if (c.state === 'BLOCKED' || c.state === 'SKIPPED') return { ...done, state: c.state, exit: code, line };
    return { ...done, state: c.state, exit: code, line, reason: c.why };
  }

  // ---- the scheduler: topological, independent steps in parallel, one step per host, one heavy step at a time
  const pending = new Set(steps.map(s => s.id));
  const flying = new Map();   // id -> promise
  const hostsBusy = new Set();
  let heavyBusy = false;
  const hostKey = s => (s.hits === 'none' ? null : s.hits);
  const settle = (step, final) => {
    settled.set(step.id, final);
    if (final.store && final.entry) entries.set(step.id, final.entry);
    pending.delete(step.id);
    save();
  };
  save();
  while (pending.size || flying.size) {
    let progressed = false;
    for (const step of steps) {
      if (!pending.has(step.id) || flying.has(step.id) || !step.dependsOn.every(d => settled.has(d))) continue;
      const d = decide(step);
      if (d.final) { settle(step, d.final); progressed = true; continue; }
      const key = hostKey(step);
      if (flying.size >= MAX_PARALLEL || (key && hostsBusy.has(key)) || (step.heavy && heavyBusy)) continue;
      if (key) hostsBusy.add(key);
      if (step.heavy) heavyBusy = true;
      const p = execute(step).catch(e => ({ id: step.id, module: step.module, state: 'FAILED', exit: null, line: null, reason: `the runner failed: ${String(e && e.message || e).slice(0, 300)}` })).then(entry => {
        if (key) hostsBusy.delete(key);
        if (step.heavy) heavyBusy = false;
        flying.delete(step.id);
        settle(step, { entry, how: null, store: true });
      });
      flying.set(step.id, p);
      progressed = true;
    }
    if (progressed) continue;
    if (flying.size) await Promise.race(flying.values());
    else break;   // nothing can start and nothing is running: the validator rules out a cycle, so this never happens
  }
  for (const id of pending) settle(byId.get(id), { entry: { id, module: byId.get(id).module, state: 'FAILED', reason: 'the runner could not schedule this step' }, how: null, store: true });
  const rows = steps.map(s => { const f = settled.get(s.id); return rowOf(s, f.entry, skillDir, f.how); });
  return { mode, discarded, url, client, host: vars.host, runStartedAt: log.runStartedAt, updatedAt: log.updatedAt, logFile, hasLog: true, order: steps.map(s => s.id), steps: rows, ...summarize(steps, rows), failed: rows.filter(r => r.state === 'FAILED').length };
}
