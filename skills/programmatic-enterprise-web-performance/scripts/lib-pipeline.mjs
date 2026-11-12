// The step list of a full client audit: pipeline.json (skill root). THIS FILE IS THE ONE RULE ENGINE: `start.mjs audit-live` and `omnikom seo run` (the CLI's lib/seo-manifest.mjs only re-exports it) both take the
// manifest's rules, the variables of its paths, what "done" means for a step, what an exit code amounts to and what a stop is from here; they keep only execution (spawning, locks, printing, state files) on their own
// side. It runs nothing, prints nothing, never exits the process. Built-ins and ./lib-stops.mjs only.
//
// API (named exports; plain inputs; no console, no process.exit; problems come back as values, a bad placeholder or url is a typed error):
//   loadManifest(file, { io })                         -> { ok, manifest, problems }          read + parse pipeline.json
//   validateManifest(manifest, { skillDir, repoRoot, exists, io }) -> { ok, problems: [{ rule, step, detail }] }   every rule below
//   runOrder(manifestOrSteps)                          -> { ok, steps, ids, problems }        the run order (see below); a cycle is a problem
//   makeVars({ url, client, skillDir, data })          -> { url, client, host, skill, data, runDir, pewp, work }   the variables of a run's paths; hostOf(url) throws PipelineError
//   resolveScript(script, { skillDir, repoRoot })      -> the file a step's script is, or null when the path leaves the skill folder and the repository (`repo:` = relative to the repository)
//   substitute(textOrList, vars)                       -> string | string[]                   fills {url} {client} {host} {skill} {data} {runDir} {pewp} {work};
//                                                         throws PlaceholderError (.placeholder, .reason "unknown"|"missing") instead of returning an empty string
//   covers(a, b), globPaths(pattern, { io }), filesUnder(path, out, cap, io)                   paths and globs: `*` inside one path segment, a trailing slash is a folder
//   evidenceState(step, vars, { since, allFresh, io }) -> { state: "done"|"stale"|"missing", problems, files: [{ path, mtimeMs, glob, out }] }
//   inputNewer(step, vars, files, { io })              -> null | { input, inputMtime, evidenceMtime }   an input newer than the evidence (the step is stale)
//   adoptStep(step, { vars, now, io })                 -> { ok, ... }                          a run takes over a step's valid existing outputs
//   notCurrent(step, files, { now, io })               -> null | { rule: "over-age" | "blocked-record", message }   evidence there but no result
//   stepOutcome(step, { code, lastLine, output, evidence }) -> { outcome, message, line }      outcome: done | partial | blocked | skipped | needs-input | fail; outcomeState(o) -> RUN | PARTIAL | BLOCKED | SKIPPED | WAITING | FAILED
//   stepKind(step) -> "script" | "person" | "browser" | "agent"; isWaiting(step)
//   stepStop(step, { now, dir, mode, isStopped })      -> null | { engine, until, reason, message }   a stop (lib-stops.mjs) in force for one of the step's `engines`
//   describe(problem)                                  -> one line ("step psi: unknown key 'x'")
//   STEP_KEYS, TOP_KEYS, PLACEHOLDERS, RUN_OPTIONS, SLACK_MS, PipelineError, PlaceholderError
// `io` is an injectable file system ({ existsSync, statSync, readdirSync, readFileSync }; default node:fs) so a reader can test with fake files.
//
// Validity rules (rule ids in brackets; a manifest that breaks one is invalid and neither runner runs it):
//   [top-level] only version (1), name, what, conventions, vars, steps, coverage; a name [vars] vars keys are placeholders [steps] a non-empty list
//   [step-key] a step has exactly the keys in REQUIRED, plus optionally brief, exit and engines [required-key] [type] every value the right type (kind and maxAgeDays are required on every step)
//   [id] [duplicate-id] ids unique, lower-case words joined by single hyphens [module] the same pattern [kind] stable | time-sensitive | derived [pace] text or null
//   [placeholder] only {url} {client} {host} {skill} {data} {runDir} {pewp} {work}, in args, inputs, outputs, evidence and brief; none in the script path
//   [dependsOn] names an id that exists [self-dependency] never itself [cycle] no cycle
//   [script] a node file (.mjs, .cjs, .js) under the skill folder (or `repo:` under the repository): not absolute, no drive letter, no `..`
//   [script-missing] the file exists (a `repo:` path is looked up only when repoRoot is given) [vantage-start] a step never calls `vantage start`
//   [waiting] a step with script null is WAITING: it needs the owner's browser, an agent or a person, carries a brief and outputs and has no args; a step with a script never needs those
//   [timeout] a step a script runs has a timeout above 0 minutes
//   [exit] keys "0".."4", each a sentence that starts with that code's word (0 ok, 1 and 2 failed, 3 blocked, 4 skipped): the map says what a script says, it never decides a state
//   [evidence] not empty, no `**`, every path is inside one of the step's outputs or inputs (a step that only checks a file)
//   [input-order] an input another step writes must be written by a step this one depends on (directly or through others)
//   [hits] none | client | third-party:<host-or-name>
//   [engines] optional: a non-empty list of engine names known to lib-stops.mjs (google, bing, commoncrawl, ...): while a stop is in force for one of them the runner marks the step
//             BLOCKED with the stop's until and reason and never starts it (psi and crux are keyed APIs outside the search stop and carry none)
// Run order: file order, except that a step never comes before a step it depends on (the first step in file order whose dependencies are all placed goes next).
// Outcome of a step that ran (stepOutcome): exit 0 = done (then its evidence must be done, else fail), or partial when its last line is `PARTIAL: <what is missing>` (then run again to continue);
// 3 = blocked, and its last line must be `BLOCKED: <what> | unblocks: <what would>` (else fail: a broken contract), or needs-input when the output holds a NEEDS-INPUT line; 4 = skipped with a
// `SKIPPED: <reason>` last line (else fail); 2 = fail (usage: the manifest's args do not fit the script); anything else = fail. The step's own `exit` map is not read.
// Evidence (evidenceState): every evidence path exists, is not empty, and (when it is inside an output) was written at or after `since` (ms) less SLACK_MS; of a pattern's matches (dated snapshot
// folders, one capture per search) the newest counts; a path the step only reads (an input) is only checked for existing and not empty. missing = absent or empty, stale = there but older than
// `since`, done = all fine.
import nodeFs from "node:fs";
import path from "node:path";
import { KNOWN_ENGINES, isStopped as realIsStopped } from "./lib-stops.mjs";

export const PLACEHOLDERS = ["url", "client", "host", "skill", "data", "runDir", "pewp", "work"];
export const TOP_KEYS = ["version", "name", "what", "conventions", "vars", "steps", "coverage"];
export const REQUIRED = ["id", "module", "what", "script", "args", "inputs", "outputs", "dependsOn", "needsBrowser", "needsAi", "needsPerson", "needsKeys", "heavy", "hits", "pace", "timeoutMinutes", "evidence", "kind", "maxAgeDays"];
export const OPTIONAL = ["brief", "exit", "engines"];
export const STEP_KEYS = [...REQUIRED, ...OPTIONAL];
export const BROWSER = ["none", "headless", "owner"];
export const KINDS = ["stable", "time-sensitive", "derived"];
// the options of `omnikom seo run` (the CLI's allow-list IS this list)
export const RUN_OPTIONS = ["client", "only", "from", "module", "fresh", "env-file", "json"];
export const SLACK_MS = 2000;   // file times are compared with this much give (FAT keeps two seconds; two clocks differ by milliseconds)
const EXIT_FOR = { 0: "ok", 1: "failed", 2: "failed", 3: "blocked", 4: "skipped" };
const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const KEY_NAME = /^[A-Z][A-Z0-9_]*$/;
const SCRIPT_EXT = /\.(mjs|cjs|js)$/;

export class PipelineError extends Error {}
export class PlaceholderError extends PipelineError {
  constructor(placeholder, reason) {
    super(reason === "unknown" ? `unknown placeholder {${placeholder}}` : `the placeholder {${placeholder}} has no value for this run${placeholder === "client" ? " (pass --client <slug>)" : ""}`);
    this.placeholder = placeholder; this.reason = reason;
  }
}
const IO = { existsSync: nodeFs.existsSync, statSync: nodeFs.statSync, readdirSync: nodeFs.readdirSync, readFileSync: nodeFs.readFileSync };
const ioOf = (io) => ({ ...IO, ...(io || {}) });
const problem = (rule, step, detail) => ({ rule, step: step ?? null, detail });
export const describe = (p) => (p.step ? `step ${p.step}: ${p.detail}` : p.detail);

export function loadManifest(file, { io } = {}) {
  let text;
  try { text = ioOf(io).readFileSync(file, "utf8"); } catch (e) { return { ok: false, manifest: null, problems: [problem("load", null, `cannot read ${file}: ${e.code || e.message}`)] }; }
  try { return { ok: true, manifest: JSON.parse(String(text).replace(/^﻿/, "")), problems: [] }; } catch (e) { return { ok: false, manifest: null, problems: [problem("load", null, `${file} is not valid JSON: ${e.message}`)] }; }
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (x) => typeof x === "string" && x.length > 0;
const isStrings = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
export const norm = (p) => String(p).replace(/\\/g, "/");
const exitWord = (text) => String(text).trim().toLowerCase().split(/[^a-z]/)[0];
// a step nobody's script runs: it waits for the owner's browser, an AI agent or a person
export const isWaiting = (s) => s.needsBrowser === "owner" || s.needsAi === true || s.needsPerson === true;

export const placeholdersIn = (s) => [...String(s).matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((m) => m[1]);
export function substitute(x, vars) {
  if (Array.isArray(x)) return x.map((s) => substitute(s, vars));
  return String(x).replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (all, k) => {
    if (!PLACEHOLDERS.includes(k)) throw new PlaceholderError(k, "unknown");
    if (vars?.[k] == null || vars[k] === "") throw new PlaceholderError(k, "missing");
    return vars[k];
  });
}

// ---------------------------------------------------------------- the variables of a run
export function hostOf(url) {
  let u;
  try { u = new URL(url); } catch { throw new PipelineError(`the url is not a url: ${url}`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new PipelineError(`the url must be http or https: ${url}`);
  return u.hostname.toLowerCase().replace(/^www\./, "");
}
// {data} is the run's data folder (until the run record moves, the skill folder); {runDir} is under it by host, {pewp} and {work} under {runDir} (one site's evidence is never another's)
export function makeVars({ url, client, skillDir, data }) {
  const host = hostOf(url);
  if (!data) throw new PipelineError("makeVars needs data, the run's data folder");
  const skill = norm(skillDir);
  data = norm(data);
  const runDir = `${data}/site-checks/${host}`;
  return { url, client, host, skill, data, runDir, pewp: `${runDir}/.pewp`, work: `${runDir}/work` };
}

// `repo:<path>` is relative to the repository root, anything else to the skill folder; a path that leaves both is no script
const scriptRel = (script) => {
  const repo = script.startsWith("repo:"), rel = norm(repo ? script.slice(5) : script);
  return !rel || path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.split("/").includes("..") ? null : { repo, rel };
};
export function resolveScript(script, { skillDir, repoRoot }) {
  const r = scriptRel(script);
  return r ? path.join(r.repo ? repoRoot : skillDir, r.rel) : null;
}

// ---------------------------------------------------------------- paths and globs: `*` inside one path segment, nothing deeper; a trailing slash means a folder
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const segRe = (seg) => new RegExp("^" + seg.split("*").map(escapeRe).join("[^/]*") + "$", process.platform === "win32" ? "i" : "");
const segs = (s) => norm(s).split("/").filter(Boolean);
// does path pattern a name b, or a folder that holds b? (the patterns are compared as written, before the variables are filled in)
export function covers(a, b) {
  const A = segs(a), B = segs(b);
  return A.length <= B.length && A.every((x, i) => x === B[i] || segRe(x).test(B[i]));
}
export const hasGlob = (p) => /\*/.test(p);
function walk(base, parts, fs) {
  if (!parts.length) return fs.existsSync(base) ? [base] : [];
  const [head, ...rest] = parts;
  const at = base.endsWith("/") ? base : base + "/";
  if (!head.includes("*")) return walk(at + head, rest, fs);
  let names;
  try { names = fs.readdirSync(base); } catch { return []; }
  const re = segRe(head);
  return names.filter((n) => re.test(n)).sort().flatMap((n) => walk(at + n, rest, fs));
}
// every existing path (file or folder) the pattern names
export function globPaths(pattern, { io } = {}) {
  const fs = ioOf(io), parts = segs(pattern), abs = norm(pattern);
  if (/^[A-Za-z]:$/.test(parts[0] || "")) return walk(parts[0] + "/", parts.slice(1), fs);
  return walk(abs.startsWith("/") ? "/" : ".", parts, fs);
}
// the non-empty files under a path (a folder is read to the bottom): { path, mtimeMs, size }
export function filesUnder(p, out = [], cap = 20000, io) {
  const fs = ioOf(io);
  let st;
  try { st = fs.statSync(p); } catch { return out; }
  if (!st.isDirectory()) { if (st.size > 0) out.push({ path: norm(p), mtimeMs: st.mtimeMs, size: st.size }); return out; }
  let names;
  try { names = fs.readdirSync(p).sort(); } catch { return out; }
  for (const n of names) { if (out.length >= cap) break; filesUnder(norm(p) + "/" + n, out, cap, fs); }
  return out;
}
const liveFiles = (pattern, fs) => globPaths(pattern, { io: fs }).flatMap((p) => filesUnder(p, [], 20000, fs));

// The stop in force for a step, or null. `mode` is lib-stops': "script" (default: a stop holds until its `until`, nothing frees a script) or "desktop" (a person-paced capture in the owner's
// own browser: a stop that carries a desktop lift does not hold it). isStopped is injectable (default lib-stops.mjs's, which reads OMNIKOM_STOPS_DIR); pure given that.
export function stepStop(step, { now = Date.now(), dir, mode = "script", isStopped = realIsStopped } = {}) {
  for (const engine of step?.engines || []) {
    const stop = isStopped(engine, now, dir, mode);
    if (stop) {
      const tail = mode === "script" ? " (a stop is never lifted for a script)" : ", or a person lifts it for a desktop capture";
      const unblock = stop.until ? `wait until then${tail}` : mode === "script" ? "its owner removing the stop file (a stop is never lifted for a script)" : "its owner lifting it for a desktop capture";
      return { engine, until: stop.until, reason: stop.reason, message: `${engine} is stopped ${stop.until ? `until ${stop.until}` : "(no end time)"} (${stop.reason}) | unblocks: ${unblock}` };
    }
  }
  return null;
}

export const stepKind = (s) => (s.script !== null ? "script" : s.needsPerson ? "person" : s.needsBrowser === "owner" ? "browser" : "agent");

// The steps in run order. A cycle (or an id that does not exist) is a problem, not an exception.
export function runOrder(m) {
  const steps = Array.isArray(m) ? m : m?.steps;
  if (!Array.isArray(steps)) return { ok: false, steps: [], ids: [], problems: [problem("steps", null, "steps must be a list")] };
  const ids = new Set(steps.map((s) => s.id)), placed = new Set(), out = [], left = [...steps];
  while (left.length) {
    const i = left.findIndex((s) => (s.dependsOn || []).every((d) => placed.has(d) || !ids.has(d)));
    if (i < 0) return { ok: false, steps: out, ids: out.map((s) => s.id), problems: [problem("cycle", null, `cycle among: ${left.map((s) => s.id).join(", ")}`)] };
    const [s] = left.splice(i, 1); placed.add(s.id); out.push(s);
  }
  return { ok: true, steps: out, ids: out.map((s) => s.id), problems: [] };
}
const ancestors = (id, byId, seen = new Set()) => { for (const d of byId.get(id)?.dependsOn || []) if (!seen.has(d)) { seen.add(d); ancestors(d, byId, seen); } return seen; };
const writes = (outs, inp) => outs.some((o) => { const a = norm(o), b = norm(inp); return a === b || (a.endsWith("/") && b.startsWith(a)) || (b.endsWith("/") && a.startsWith(b)); });

// Every rule of both engines, as { rule, step, detail }. `exists` (default: the file system of `io`) says whether a script file is there; `scriptExists(script)` (start.mjs's) replaces the lookup for
// every script (it knows its own stage folder); a `repo:` script is looked up only when repoRoot is given.
export function validateManifest(m, { skillDir = null, repoRoot = null, scriptExists = null, exists, io } = {}) {
  const P = [], bad = (rule, step, detail) => P.push(problem(rule, step, detail)), ex = exists || ioOf(io).existsSync;
  const done = () => ({ ok: P.length === 0, problems: P });
  if (!isObj(m)) { bad("top-level", null, "the manifest is not a JSON object"); return done(); }
  for (const k of Object.keys(m)) if (!TOP_KEYS.includes(k)) bad("top-level", null, `unknown key '${k}' at the top level`);
  if (m.version !== 1) bad("top-level", null, `version must be 1 (got ${JSON.stringify(m.version)})`);
  if (!isStr(m.name)) bad("top-level", null, "name must be a non-empty string");
  if (isObj(m.vars)) for (const k of Object.keys(m.vars)) if (!PLACEHOLDERS.includes(k)) bad("vars", null, `vars: '${k}' is not a placeholder`);
  if (!Array.isArray(m.steps) || m.steps.length === 0) { bad("steps", null, "steps must be a non-empty array"); return done(); }
  const known = new Set(), dup = new Set();
  for (const s of m.steps) if (isObj(s) && typeof s.id === "string") (known.has(s.id) ? dup : known).add(s.id);
  for (const id of dup) bad("duplicate-id", id, `step id '${id}' is used twice`);
  const graph = new Map();
  m.steps.forEach((s, i) => {
    if (!isObj(s)) { bad("type", `#${i + 1}`, `steps[${i}] is not an object`); return; }
    const at = isStr(s.id) ? s.id : `#${i + 1}`;
    for (const k of Object.keys(s)) if (!STEP_KEYS.includes(k)) bad("step-key", at, `unknown key '${k}'`);
    for (const k of REQUIRED) if (!(k in s) && k !== "timeoutMinutes") bad("required-key", at, `missing '${k}'`);   // a missing timeout has its own sentence below
    if ("id" in s && !(typeof s.id === "string" && ID.test(s.id))) bad("id", at, "id must be lowercase words joined by hyphens");
    if ("module" in s && !(typeof s.module === "string" && ID.test(s.module))) bad("module", at, "module must be lowercase words joined by hyphens");
    if ("what" in s && !(typeof s.what === "string" && s.what.trim())) bad("type", at, "what must say, in words, what the step does");
    for (const k of ["args", "inputs", "outputs", "dependsOn", "needsKeys", "evidence"]) if (k in s && !isStrings(s[k])) bad("type", at, `${k} must be a list of strings`);
    for (const k of ["needsAi", "needsPerson", "heavy"]) if (k in s && typeof s[k] !== "boolean") bad("type", at, `${k} must be true or false`);
    if ("needsBrowser" in s && !BROWSER.includes(s.needsBrowser)) bad("type", at, `needsBrowser must be one of ${BROWSER.join(", ")} (got ${JSON.stringify(s.needsBrowser)})`);
    if ("hits" in s && !(typeof s.hits === "string" && /^(none|client|third-party:[a-z0-9.-]+)$/.test(s.hits))) bad("hits", at, `hits must be client, none or third-party:<name> (got ${JSON.stringify(s.hits)})`);
    if ("pace" in s && s.pace !== null && typeof s.pace !== "string") bad("pace", at, "pace must be a string or null");
    if ("brief" in s && typeof s.brief !== "string") bad("type", at, "brief must be a string");
    if ("kind" in s && !KINDS.includes(s.kind)) bad("kind", at, "kind must be stable, time-sensitive or derived");
    if ("maxAgeDays" in s && s.maxAgeDays !== null && !(typeof s.maxAgeDays === "number" && Number.isFinite(s.maxAgeDays) && s.maxAgeDays >= 0)) bad("type", at, "maxAgeDays must be null or a number of 0 or more");
    if ("engines" in s) {
      if (!Array.isArray(s.engines) || !s.engines.length) bad("engines", at, "engines must be a list of strings (at least one engine name)");
      else for (const e of s.engines) if (!Object.hasOwn(KNOWN_ENGINES, e)) bad("engines", at, `engines holds '${e}', which is not a known engine (${Object.keys(KNOWN_ENGINES).join(", ")})`);
    }
    if (Array.isArray(s.needsKeys)) for (const k of s.needsKeys) if (!KEY_NAME.test(k)) bad("type", at, `needsKeys holds '${k}', which is not a variable name`);
    for (const k of ["args", "inputs", "outputs", "evidence"]) for (const text of Array.isArray(s[k]) ? s[k] : []) for (const name of placeholdersIn(text)) if (!PLACEHOLDERS.includes(name)) bad("placeholder", at, `${k} uses the placeholder {${name}}, which is not one of ${PLACEHOLDERS.map((v) => `{${v}}`).join(" ")}`);
    if (typeof s.brief === "string") for (const name of placeholdersIn(s.brief)) if (!PLACEHOLDERS.includes(name)) bad("placeholder", at, `brief uses the placeholder {${name}}, which is not one of ${PLACEHOLDERS.map((v) => `{${v}}`).join(" ")}`);
    if (typeof s.script === "string" && placeholdersIn(s.script).length) bad("placeholder", at, "the script path takes no placeholder");
    if ("exit" in s) {
      if (!isObj(s.exit)) bad("exit", at, "exit must be an object of exit code -> text");
      else for (const [k, v] of Object.entries(s.exit)) {
        if (!/^[0-4]$/.test(k)) bad("exit", at, `exit key '${k}' is not an exit code`);
        else if (exitWord(v) !== EXIT_FOR[k]) bad("exit", at, `exit ${k} must start with ${EXIT_FOR[k]} (got ${JSON.stringify(v)})`);
      }
    }
    const waiting = isWaiting(s), timeout = s.timeoutMinutes;
    if (!("timeoutMinutes" in s) || typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 0) bad("timeoutMinutes" in s ? "type" : "required-key", at, "timeoutMinutes is missing or not a number of minutes");
    else if (!waiting && timeout === 0) bad("timeout", at, "a step a script runs needs a timeout above 0 minutes");
    if ("script" in s) {
      if (waiting) { if (s.script !== null) bad("waiting", at, "a waiting step (owner browser, AI or person) must have script null, not a script"); }
      else if (typeof s.script !== "string" || !s.script) bad("script", at, "a step the runner runs needs a script");
      else if (!SCRIPT_EXT.test(s.script)) bad("script", at, `script '${s.script}' is not a node file (.mjs, .cjs or .js)`);
      else {
        const r = scriptRel(s.script);
        if (!r) bad("script", at, `script '${s.script}' leaves the skill folder and the repository`);
        else if (!placeholdersIn(s.script).length) {
          const base = r.repo ? repoRoot : skillDir, file = base == null ? null : path.join(base, r.rel);
          const gone = scriptExists ? !scriptExists(s.script) : file !== null && !ex(file);
          if (gone) bad("script-missing", at, `script '${s.script}' does not exist${file ? ` (${norm(file)})` : ""}`);
        }
      }
    }
    // `vantage start` opens the owner's browser session: only a person running `node scripts/vantage.mjs start` does that, never a run (the CLI wraps `seo vantage status` only)
    if (typeof s.script === "string" && /(^|\/)vantage\.mjs$/.test(norm(s.script)) && Array.isArray(s.args) && s.args.some((a) => /^start$/i.test(String(a)))) bad("vantage-start", at, "a step must never call vantage start (a run only reads its status)");
    if (waiting) {
      if (typeof s.brief !== "string" || !s.brief.trim()) bad("waiting", at, "a waiting step needs a brief that says what the agent must do");
      if (Array.isArray(s.outputs) && s.outputs.length === 0) bad("waiting", at, "a waiting step needs outputs: nothing else tells the runner it is done");
      if (Array.isArray(s.args) && s.args.length) bad("waiting", at, "a WAITING step has no args");
    }
    if (Array.isArray(s.evidence)) {
      if (s.evidence.length === 0) bad("evidence", at, "evidence is empty: nothing would show the step did its work");
      for (const e of s.evidence) {
        if (typeof e !== "string") continue;
        if (e.includes("**")) bad("evidence", at, `evidence '${e}' uses **, only * inside one path segment is read`);
        else if (!(s.outputs || []).some((o) => covers(o, e)) && !(s.inputs || []).some((o) => covers(o, e))) bad("evidence", at, `evidence '${e}' is neither inside an output nor an input of the step`);
      }
    }
    if (Array.isArray(s.dependsOn)) {
      for (const d of s.dependsOn) { if (d === s.id) bad("self-dependency", at, `dependency cycle: ${d} -> ${d}`); else if (!known.has(d)) bad("dependsOn", at, `dependsOn '${d}' is not a step`); }
      if (isStr(s.id)) graph.set(s.id, s.dependsOn.filter((d) => known.has(d) && d !== s.id));
    }
  });
  // a cycle: depth-first, reporting each loop once, as a -> b -> a
  const state = new Map(), loops = new Set();
  const visit = (id, trail) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { const loop = trail.slice(trail.indexOf(id)); loops.add([...loop, id].join(" -> ")); return; }
    state.set(id, 1);
    for (const d of graph.get(id) || []) visit(d, [...trail, id]);
    state.set(id, 2);
  };
  for (const id of graph.keys()) visit(id, []);
  for (const l of loops) bad("cycle", null, `dependency cycle: ${l}`);
  if (!P.some((b) => ["dependsOn", "duplicate-id", "self-dependency", "cycle"].includes(b.rule))) {
    const byId = new Map(m.steps.filter((s) => isObj(s) && isStr(s.id)).map((s) => [s.id, s]));
    for (const s of byId.values()) {
      if (!isStrings(s.inputs)) continue;
      const anc = ancestors(s.id, byId);
      for (const inp of s.inputs) {
        const makers = [...byId.values()].filter((w) => w.id !== s.id && isStrings(w.outputs) && writes(w.outputs, inp));
        if (makers.length && !makers.some((w) => anc.has(w.id))) bad("input-order", s.id, `input ${inp} is written by step ${makers.map((w) => w.id).join(", ")}, which it does not depend on`);
      }
    }
  }
  return done();
}

// ---------------------------------------------------------------- evidence
// Evidence of one step (paths filled from vars). `since`: ms; the evidence a step WRITES (a pattern inside an output, or every pattern with allFresh) must be newer than that, less the slack; a pattern
// that is only an input (a step that only checks a file) need only exist. Every match must be non-empty; the NEWEST match is the one that is dated (an older sibling from an earlier run does not matter).
export function evidenceState(step, vars, { since = 0, allFresh = false, io } = {}) {
  const fs = ioOf(io), files = [], problems = [];
  let missing = false, stale = false;
  for (const raw of step.evidence || []) {
    const glob = substitute(raw, vars), need = allFresh || (step.outputs || []).some((o) => covers(o, raw));
    const paths = globPaths(glob, { io: fs });
    const empty = paths.filter((p) => { try { const st = fs.statSync(p); return !st.isDirectory() && st.size === 0; } catch { return false; } });
    const found = paths.flatMap((p) => filesUnder(p, [], 20000, fs));
    if (paths.length === 0) { missing = true; problems.push(`${glob} (no non-empty file)`); }
    else if (empty.length) { missing = true; problems.push(`${glob} (${empty.length} empty file${empty.length === 1 ? "" : "s"}: ${norm(empty[0])})`); }
    else if (found.length === 0) { missing = true; problems.push(`${glob} (no non-empty file)`); }
    else if (need && Math.max(...found.map((f) => f.mtimeMs)) < since - SLACK_MS) { stale = true; problems.push(`${glob} (only files older than the step started)`); }
    files.push(...found.map((f) => ({ ...f, out: need, glob })));
  }
  return { state: missing ? "missing" : stale ? "stale" : "done", problems, files };
}

// An input newer than the evidence: the newest input file against the oldest of the patterns' newest files (only the evidence the step writes counts), by more than the slack. For a person approval an input with the bytes of one of the step's evidence files is not newer (SKILL-ADOPT-1).
// `files` is evidenceState's. -> null | { input, inputMtime, evidenceMtime } (ISO times)
export function inputNewer(step, vars, files, { io } = {}) {
  const fs = ioOf(io), newestOf = new Map();
  for (const f of files) if (f.out) newestOf.set(f.glob, Math.max(newestOf.get(f.glob) || 0, f.mtimeMs));
  if (newestOf.size === 0) return null;
  const evidenceAt = Math.min(...newestOf.values());
  const approved = step.needsPerson === true ? files.filter((f) => f.out) : [];   // a person approval: an input with the approved copy's own bytes is not newer
  let newest = null;
  for (const i of step.inputs || []) for (const f of liveFiles(substitute(i, vars), fs)) if ((!newest || f.mtimeMs > newest.mtimeMs) && !approved.some((e) => sameBytes(e.path, f.path, fs))) newest = f;
  if (!newest || newest.mtimeMs - evidenceAt <= SLACK_MS) return null;
  return { input: newest.path, inputMtime: new Date(newest.mtimeMs).toISOString(), evidenceMtime: new Date(evidenceAt).toISOString() };
}

// Evidence that is there but is no result (SKILL-ADOPT-1): its newest file is older than the step's maxAgeDays (null: no limit; 0: nothing written before now counts, so verify
// checks its own run), or every file of one evidence pattern is a BLOCKED record ({ status: "blocked", blocked: "<unblock>" | { unblock } }). `files` is evidenceState's. Pure.
export function notCurrent(step, files, { now = Date.now(), io } = {}) {
  const fs = ioOf(io), newest = Math.max(...files.map((f) => f.mtimeMs));
  if (typeof step.maxAgeDays === "number" && now - newest > step.maxAgeDays * 86400000) return { rule: "over-age", message: `over age: ${(Math.floor((now - newest) / 8640000) / 10).toFixed(1)} days, limit ${step.maxAgeDays}` };
  for (const glob of new Set(files.map((f) => f.glob))) {
    const mine = files.filter((f) => f.glob === glob);
    if (mine.every((f) => blockedText(f.path, fs) !== null)) return { rule: "blocked-record", message: `${glob} holds only BLOCKED records: ${blockedText(mine[0].path, fs)}` };
  }
  return null;
}
const blockedText = (p, fs) => { try { const j = JSON.parse(String(fs.readFileSync(p, "utf8")).replace(/^\uFEFF/, "")); return j?.status === "blocked" ? (typeof j.blocked === "string" ? j.blocked : j.blocked?.unblock ?? "no unblock text") : null; } catch { return null; } };
const sameBytes = (a, b, fs) => { try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch { return false; } };

// ---------------------------------------------------------------- ADOPT (work order 41): a run takes over a step's valid existing outputs instead of running it again
// The owner's rule: once an audit has started, a run resumes from where it is, never from scratch. A step is adopted when its evidence exists and is not empty, every output holds a non-empty file AND
// no input is newer than the evidence (more than the slack: an input exactly as old counts as not newer). With several evidence files the inputs are compared with the OLDEST of their newest
// files; the step's date is the NEWEST evidence mtime: the evidence's own date, never now. A path that is both an input and the evidence is not compared with itself; an input that holds no file
// cannot be newer and is listed under missingInputs. Waiting steps (script null: an owner capture, an approval) are adopted the same way. notCurrent refuses evidence over the step's maxAgeDays or holding only BLOCKED records.
// Pure: values, never an exception, no output. io (existsSync, statSync, readdirSync) and stat (statSync alone) are injectable for tests.
// -> { ok: true, id, outcome: "adopted", exit: 0, at: <evidence mtime, ISO>, adoptedAt: <now, ISO>, evidence: [{ path, mtime }], inputsChecked, missingInputs }
//  | { ok: false, id, rule: "placeholder" | "no-evidence" | "evidence" | "output-missing" | "input-newer" | "over-age" | "blocked-record", reason, input?, inputMtime?, evidenceMtime?, notCurrent? }
export function adoptStep(step, { vars = {}, now = Date.now(), stat = null, io } = {}) {
  const base = ioOf(io), fs = stat ? { ...base, statSync: stat } : base, id = step?.id ?? null;
  const refuse = (rule, reason, extra = {}) => ({ ok: false, id, rule, reason, ...extra });
  let evPaths, inputs, outputs;
  try { evPaths = substitute(step?.evidence || [], vars); inputs = substitute(step?.inputs || [], vars); outputs = substitute(step?.outputs || [], vars); } catch (e) { return refuse("placeholder", e.message); }
  if (!evPaths.length) return refuse("no-evidence", `step ${id} names no evidence, so there is nothing to adopt`);
  const state = evidenceState(step, vars, { since: 0, io: fs });
  if (state.state !== "done") return refuse("evidence", `the evidence of step ${id} is not valid: ${state.problems.join("; ")}`);
  const outputsEmpty = outputs.filter((o) => liveFiles(o, fs).length === 0);
  if (outputsEmpty.length) return refuse("output-missing", `an output of step ${id} holds no non-empty file (${outputsEmpty.map(norm).join(", ")}), so there is nothing to adopt`);
  const newer = inputNewer(step, vars, state.files, { io: fs });
  if (newer) return refuse("input-newer", `input ${newer.input} (${newer.inputMtime}) is newer than the evidence of step ${id} (${newer.evidenceMtime})`, newer);
  const nc = notCurrent(step, state.files, { now, io: fs });
  if (nc) return refuse(nc.rule, nc.message, { notCurrent: true });
  const iso = (ms) => new Date(ms).toISOString(), byGlob = new Map();
  for (const f of state.files) byGlob.set(f.glob, Math.max(byGlob.get(f.glob) || 0, f.mtimeMs));
  const ev = [...byGlob].map(([p, mtimeMs]) => ({ path: norm(p), mtimeMs })), own = new Set(ev.map((e) => e.path)), missingInputs = [];
  let checked = 0;
  for (const p of inputs) {
    if (own.has(norm(p))) continue;
    if (liveFiles(p, fs).length === 0) missingInputs.push(norm(p)); else checked++;
  }
  return { ok: true, id, outcome: "adopted", exit: 0, at: iso(Math.max(...ev.map((e) => e.mtimeMs))), adoptedAt: iso(now), evidence: ev.map((e) => ({ path: e.path, mtime: iso(e.mtimeMs) })), inputsChecked: checked, missingInputs };
}
// The default of a resumed run, for start.mjs and the CLI's `seo run`: adopt unless the step is to be run fresh (--fresh, --fresh <step>). -> { adopt: boolean, result }
export function adoptDefault(step, { fresh = false, ...opts } = {}) {
  if (fresh) return { adopt: false, result: { ok: false, id: step?.id ?? null, rule: "fresh", reason: "--fresh: discard and run again" } };
  const result = adoptStep(step, opts);
  return { adopt: result.ok, result };
}

// ---------------------------------------------------------------- what a step that ran amounts to
// The line an outcome is read from: of the candidate lines (one line, or a list: the CLI hands the last stderr line, then the last stdout line) the first that starts with the prefix of its exit
// (3 BLOCKED:, 4 SKIPPED:, 0 PARTIAL:), else the first. `evidence` (optional) is evidenceState's answer, looked at only for exit 0. The step's own `exit` map is not read. Pure.
const PREFIX_OF = { 0: /^PARTIAL:/, 3: /^BLOCKED:/, 4: /^SKIPPED:/ };
export function stepOutcome(step, { code, lastLine = "", output = "", evidence = null } = {}) {
  const cands = (Array.isArray(lastLine) ? lastLine : [lastLine]).map((x) => String(x ?? "").trim()).filter(Boolean);
  const want = PREFIX_OF[code];
  const ll = (want && cands.find((x) => want.test(x))) || cands[0] || "";
  return { ...judge(code, ll, String(output || ""), evidence), line: ll || null };
}
function judge(code, ll, output, evidence) {
  const noEvidence = () => ({ outcome: "fail", message: `exit 0 but evidence missing: ${evidence.problems.join("; ")}` });
  if (code === 0 && /^PARTIAL:/.test(ll)) return evidence && evidence.state !== "done" ? noEvidence() : { outcome: "partial", message: ll.replace(/^PARTIAL:\s*/, "") };
  if (code === 0) {
    if (evidence && evidence.state !== "done") return noEvidence();
    return { outcome: "done", message: ll };
  }
  if (code === 3 && /^NEEDS-INPUT/m.test(output)) return { outcome: "needs-input", message: ll };
  if (code === 3) return /^BLOCKED:/.test(ll) ? { outcome: "blocked", message: ll.replace(/^BLOCKED:\s*/, "") } : { outcome: "fail", message: `exit 3 means BLOCKED but the last line is not "BLOCKED: <what> | unblocks: <what would>": ${ll || "(no output)"}` };
  if (code === 4) return /^SKIPPED:/.test(ll) ? { outcome: "skipped", message: ll.replace(/^SKIPPED:\s*/, "") } : { outcome: "fail", message: `exit 4 means SKIPPED but the last line is not "SKIPPED: <reason>": ${ll || "(no output)"}` };
  if (code === 2) return { outcome: "fail", message: `usage error (exit 2): the manifest's args do not fit the script: ${ll}` };
  return { outcome: "fail", message: `exit ${code}: ${ll || "(no output)"}` };
}
// the state a runner shows for an outcome
const STATE_OF = { done: "RUN", partial: "PARTIAL", blocked: "BLOCKED", skipped: "SKIPPED", "needs-input": "WAITING", fail: "FAILED" };
export const outcomeState = (o) => STATE_OF[o?.outcome] ?? "FAILED";
