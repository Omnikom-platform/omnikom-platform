// The step list of a full client audit: pipeline.json (skill root), read by `start.mjs audit-live` and by `omnikom seo run`. This file is the ONE rule engine
// both use; they keep only execution (spawning a script, printing, state files) on their own side. It runs nothing, prints nothing, never exits the process.
//
// API (named exports; plain inputs; no console, no process.exit; problems come back as values, a bad placeholder is a typed error):
//   loadManifest(file, { io })                         -> { ok, manifest, problems }          read + parse pipeline.json
//   validateManifest(manifest, { skillDir, scriptExists, io }) -> { ok, problems: [{ rule, step, detail }] }   every rule below
//   runOrder(manifestOrSteps)                          -> { ok, steps, ids, problems }        the run order (see below); a cycle is a problem
//   substitute(textOrList, vars)                       -> string | string[]                   fills {url} {client} {host} {skill} {runDir} {pewp} {work};
//                                                         throws PlaceholderError (.placeholder, .reason "unknown"|"missing") instead of returning an empty string
//   evidenceState(step, vars, { since, io })           -> { state: "done"|"stale"|"missing", problems, evidence: [{ path, state }] }
//   stepOutcome(step, { code, lastLine, output, evidence }) -> { outcome, message }           outcome: done | blocked | skipped | partial | needs-input | fail
//   stepKind(step)                                     -> "script" | "person" | "browser" | "agent"
//   stepStop(step, { now, dir, mode, isStopped })      -> null | { engine, until, reason, message }   a stop (lib-stops.mjs) in force for one of the step's `engines`
//   describe(problem)                                  -> one line ("step psi: unknown key ...")
//   globPaths(pattern, { io }), hasGlob(path), PLACEHOLDERS, PipelineError, PlaceholderError
// `io` is an injectable file system ({ existsSync, statSync, readdirSync, readFileSync }; default node:fs) so a reader can test with fake files.
//
// Validity rules (rule ids in brackets; a manifest that breaks one is invalid and neither runner runs it):
//   [top-level] only version (1), name, what, conventions, vars, steps; [vars] vars keys are placeholders
//   [step-key] a step has exactly the keys in REQUIRED, plus optionally brief and exit [required-key] [type] every value the right type
//   [id] [duplicate-id] ids unique, lower-case words with hyphens
//   [placeholder] only {url} {client} {host} {skill} {runDir} {pewp} {work}, in args, inputs, outputs, evidence and brief
//   [dependsOn] names an id that exists [self-dependency] never itself [cycle] no cycle
//   [script-missing] a step with a script: the file exists (a `repo:` path is relative to the Omnikom repository and is not looked up here)
//   [waiting] a step with script null is WAITING: it needs the owner's browser, an agent or a person, carries a brief and has no args;
//   [script-step] a step with a script never needs those
//   [exit] keys "0".."4", each a sentence (0 ok, 2 usage, 3 BLOCKED, 4 SKIPPED unless a script differs: authority-classify and authority-vet say 4 = partial)
//   [evidence] every evidence path is one of the step's outputs (or under one), or one of its inputs (a step that only checks a file)
//   [input-order] an input another step writes must be written by a step this one depends on (directly or through others)
//   [hits] none | client | third-party:<host-or-name>
//   [engines] optional: a list of engine names known to lib-stops.mjs (google, bing, commoncrawl, ...): while a stop is in force for one of them the runner marks the step
//             BLOCKED with the stop's until and reason and never starts it (psi and crux are keyed APIs outside the search stop and carry none)
// Run order: file order, except that a step never comes before a step it depends on (the first step in file order whose dependencies are all placed goes next).
// Outcome of a step that ran (stepOutcome): exit 0 = done (then its evidence must be done, else fail); 3 = blocked, and its last line must be
// `BLOCKED: <what> | unblocks: <what would>` (else fail: a broken contract); a NEEDS-INPUT line in the output = needs-input; 4 = skipped with a `SKIPPED: <reason>`
// last line, or partial when the step's own `exit` says "4": partial...; 2 = fail (usage: the manifest's args do not fit the script); anything else = fail.
// Evidence (evidenceState): every evidence path exists, is not empty, and was written at or after `since` (ms); of a pattern's matches (dated snapshot folders,
// one capture per search) the newest counts; a path that is also an input is only checked for existing and not empty. missing = absent or empty,
// stale = there but older than `since`, done = all fine.
import nodeFs from "node:fs";
import path from "node:path";
import { KNOWN_ENGINES, isStopped as realIsStopped } from "./lib-stops.mjs";

export const PLACEHOLDERS = ["url", "client", "host", "skill", "runDir", "pewp", "work"];
export const TOP_KEYS = ["version", "name", "what", "conventions", "vars", "steps"];
export const REQUIRED = ["id", "module", "what", "script", "args", "inputs", "outputs", "dependsOn", "needsBrowser", "needsAi", "needsPerson", "needsKeys", "heavy", "hits", "pace", "timeoutMinutes", "evidence"];
export const OPTIONAL = ["brief", "exit", "engines"];
export const BROWSER = ["none", "headless", "owner"];

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
  try { return { ok: true, manifest: JSON.parse(String(text).replace(/^\uFEFF/, "")), problems: [] }; } catch (e) { return { ok: false, manifest: null, problems: [problem("load", null, `${file} is not valid JSON: ${e.message}`)] }; }
}

export const placeholdersIn = (s) => [...String(s).matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((m) => m[1]);
export function substitute(x, vars) {
  if (Array.isArray(x)) return x.map((s) => substitute(s, vars));
  return String(x).replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (all, k) => {
    if (!PLACEHOLDERS.includes(k)) throw new PlaceholderError(k, "unknown");
    if (vars?.[k] == null || vars[k] === "") throw new PlaceholderError(k, "missing");
    return vars[k];
  });
}

const isStr = (x) => typeof x === "string" && x.length > 0;
const strList = (x) => Array.isArray(x) && x.every(isStr);
const norm = (p) => String(p).replace(/\\/g, "/");
const under = (p, base) => { const a = norm(p), b = norm(base); return a === b || (b.endsWith("/") && a.startsWith(b)); };
const writes = (outs, inp) => outs.some((o) => { const a = norm(o), b = norm(inp); return a === b || (a.endsWith("/") && b.startsWith(a)) || (b.endsWith("/") && a.startsWith(b)); });
const wild = (p) => new RegExp("^" + norm(p).split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "$");

// The stop in force for a step, or null. `mode` is lib-stops': "script" (default: a stop holds until its `until`, nothing frees a script) or "desktop" (a person-paced capture in the owner's
// own browser: a stop that carries a desktop lift does not hold it). isStopped is injectable (default lib-stops.mjs's, which reads OMNIKOM_STOPS_DIR); pure given that.
export function stepStop(step, { now = Date.now(), dir, mode = "script", isStopped = realIsStopped } = {}) {
  for (const engine of step?.engines || []) {
    const stop = isStopped(engine, now, dir, mode);
    if (stop) return { engine, until: stop.until, reason: stop.reason, message: `${engine} is stopped until ${stop.until} (${stop.reason}) | unblocks: wait until then${mode === "script" ? " (a stop is never lifted for a script)" : ", or a person lifts it for a desktop capture"}` };
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

export function validateManifest(m, { skillDir = null, scriptExists = null, io } = {}) {
  const P = [], bad = (rule, step, detail) => P.push(problem(rule, step, detail)), fs = ioOf(io);
  const done = () => ({ ok: P.length === 0, problems: P });
  if (!m || typeof m !== "object" || Array.isArray(m)) { bad("top-level", null, "the manifest is not an object"); return done(); }
  for (const k of Object.keys(m)) if (!TOP_KEYS.includes(k)) bad("top-level", null, `unknown top-level key "${k}"`);
  if (m.version !== 1) bad("top-level", null, `version must be 1 (got ${JSON.stringify(m.version)})`);
  if (!isStr(m.name)) bad("top-level", null, "name must be a non-empty string");
  if (m.vars && typeof m.vars === "object") for (const k of Object.keys(m.vars)) if (!PLACEHOLDERS.includes(k)) bad("vars", null, `vars: "${k}" is not a placeholder`);
  if (!Array.isArray(m.steps) || !m.steps.length) { bad("steps", null, "steps must be a non-empty list"); return done(); }
  const ids = new Map();
  for (const [i, s] of m.steps.entries()) {
    if (!s || typeof s !== "object" || Array.isArray(s)) { bad("type", `#${i + 1}`, "not an object"); continue; }
    if (!isStr(s.id) || !/^[a-z][a-z0-9-]*$/.test(s.id)) { bad("id", s.id || `#${i + 1}`, "id must be lower-case words with hyphens"); continue; }
    if (ids.has(s.id)) bad("duplicate-id", s.id, `duplicate id "${s.id}"`);
    ids.set(s.id, s);
  }
  for (const s of m.steps) {
    if (!s || !isStr(s.id)) continue;
    const at = s.id;
    for (const k of Object.keys(s)) if (![...REQUIRED, ...OPTIONAL].includes(k)) bad("step-key", at, `unknown key "${k}"`);
    const missing = REQUIRED.filter((k) => !(k in s));
    if (missing.length) { bad("required-key", at, `missing key(s) ${missing.join(", ")}`); continue; }
    if (!isStr(s.module)) bad("type", at, "module must be a non-empty string");
    if (!isStr(s.what)) bad("type", at, "what must be a non-empty string");
    if (!(s.script === null || isStr(s.script))) bad("type", at, "script must be a path or null");
    for (const k of ["args", "inputs", "outputs", "dependsOn", "needsKeys", "evidence"]) if (!strList(s[k])) bad("type", at, `${k} must be a list of non-empty strings`);
    if (!BROWSER.includes(s.needsBrowser)) bad("type", at, `needsBrowser must be one of ${BROWSER.join(", ")}`);
    for (const k of ["needsAi", "needsPerson", "heavy"]) if (typeof s[k] !== "boolean") bad("type", at, `${k} must be true or false`);
    if (!(typeof s.timeoutMinutes === "number" && s.timeoutMinutes >= 0)) bad("type", at, "timeoutMinutes must be a number of 0 or more");
    if (!(s.pace === null || isStr(s.pace))) bad("type", at, "pace must be text or null");
    if (!(isStr(s.hits) && /^(none|client|third-party:[a-z0-9.-]+)$/.test(s.hits))) bad("hits", at, `hits must be none, client or third-party:<name> (got ${JSON.stringify(s.hits)})`);
    if (Array.isArray(s.needsKeys)) for (const k of s.needsKeys) if (!/^[A-Z][A-Z0-9_]*$/.test(k)) bad("type", at, `needsKeys names a variable in capitals (got ${JSON.stringify(k)})`);
    if ("brief" in s && !isStr(s.brief)) bad("type", at, "brief must be a non-empty string");
    if ("engines" in s) {
      if (!Array.isArray(s.engines) || !s.engines.length) bad("engines", at, "engines must be a list of engine names");
      else for (const e of s.engines) if (!Object.hasOwn(KNOWN_ENGINES, e)) bad("engines", at, `engines: "${e}" is not a known engine (${Object.keys(KNOWN_ENGINES).join(", ")})`);
    }
    if ("exit" in s) {
      if (!s.exit || typeof s.exit !== "object" || Array.isArray(s.exit)) bad("exit", at, "exit must be an object {\"4\": \"what it means\"}");
      else for (const [k, v] of Object.entries(s.exit)) if (!/^[0-4]$/.test(k) || !isStr(v)) bad("exit", at, `exit key "${k}" must be a digit 0 to 4 with a sentence`);
    }
    for (const k of ["args", "inputs", "outputs", "evidence"]) if (Array.isArray(s[k])) for (const x of s[k]) for (const p of placeholdersIn(x)) if (!PLACEHOLDERS.includes(p)) bad("placeholder", at, `unknown placeholder {${p}} in ${k}`);
    if (isStr(s.brief)) for (const p of placeholdersIn(s.brief)) if (!PLACEHOLDERS.includes(p)) bad("placeholder", at, `unknown placeholder {${p}} in brief`);
    if (isStr(s.script) && placeholdersIn(s.script).length) bad("placeholder", at, "the script path takes no placeholder");
    if (Array.isArray(s.dependsOn)) for (const d of s.dependsOn) { if (d === s.id) bad("self-dependency", at, "depends on itself"); else if (!ids.has(d)) bad("dependsOn", at, `dependsOn "${d}" is not a step id`); }
    const waits = s.needsBrowser === "owner" || s.needsAi === true || s.needsPerson === true;
    if (s.script === null) {
      if (!waits) bad("waiting", at, "script is null, so it must be WAITING (needsBrowser \"owner\", needsAi true or needsPerson true)");
      if (!isStr(s.brief)) bad("waiting", at, "a WAITING step carries a brief");
      if (Array.isArray(s.args) && s.args.length) bad("waiting", at, "a WAITING step has no args");
    } else if (isStr(s.script)) {
      if (waits) bad("script-step", at, "a step with a script never needs the owner's browser, an agent or a person");
      if (!s.script.startsWith("repo:") && (scriptExists ? !scriptExists(s.script) : skillDir && !fs.existsSync(path.join(skillDir, s.script)))) bad("script-missing", at, `the script ${s.script} does not exist in the skill folder`);
    }
    if (strList(s.evidence) && strList(s.outputs) && strList(s.inputs)) for (const e of s.evidence) if (!s.outputs.some((o) => under(e, o)) && !s.inputs.some((i) => under(e, i))) bad("evidence", at, `evidence ${e} is neither under an output nor an input of the step`);
  }
  if (!P.some((b) => ["dependsOn", "duplicate-id", "self-dependency"].includes(b.rule))) {
    const ro = runOrder(m.steps);
    for (const p of ro.problems) P.push(p);
    if (ro.ok) {
      for (const s of m.steps) {
        if (!strList(s.inputs)) continue;
        const anc = ancestors(s.id, ids);
        for (const inp of s.inputs) {
          const makers = m.steps.filter((w) => w.id !== s.id && strList(w.outputs) && writes(w.outputs, inp));
          if (makers.length && !makers.some((w) => anc.has(w.id))) bad("input-order", s.id, `input ${inp} is written by step ${makers.map((w) => w.id).join(", ")}, which it does not depend on`);
        }
      }
    }
  }
  return done();
}

// ---------------------------------------------------------------- paths on disk: * inside one name, nothing deeper
export const hasGlob = (p) => /\*/.test(p);
export function globPaths(pattern, { io } = {}) {
  const fs = ioOf(io);
  const parts = norm(pattern).split("/");
  const first = parts.findIndex((x) => x.includes("*"));
  if (first < 0) return fs.existsSync(pattern) ? [path.normalize(pattern)] : [];
  let level = [parts.slice(0, first).join("/") || "/"];
  for (let i = first; i < parts.length; i++) {
    const seg = parts[i]; if (seg === "") continue;
    const re = wild(seg), next = [];
    for (const base of level) {
      let es; try { es = fs.readdirSync(base); } catch { continue; }
      for (const e of es) if (re.test(e)) next.push(base.replace(/\/$/, "") + "/" + e);
    }
    level = next;
  }
  return level.map((p) => path.normalize(p));
}
function newestFile(p, fs) {
  let st; try { st = fs.statSync(p); } catch { return null; }
  if (!st.isDirectory()) return { size: st.size, mtime: st.mtimeMs };
  let best = null;
  const walk = (d, depth) => { if (depth > 6) return; let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f, depth + 1); else { let s; try { s = fs.statSync(f); } catch { continue; } if (s.size > 0 && (!best || s.mtimeMs > best.mtime)) best = { size: s.size, mtime: s.mtimeMs }; } } };
  walk(p, 0);
  return best || { size: 0, mtime: st.mtimeMs };
}
// Evidence of one step (paths filled from vars). `since`: ms; evidence not newer than that is stale. A path that is also an input is not checked for age.
export function evidenceState(step, vars, { since = 0, io } = {}) {
  const fs = ioOf(io);
  const paths = substitute(step.evidence, vars), readOnly = new Set(substitute(step.inputs, vars).map(norm));
  const evidence = [], problems = [];
  for (const p of paths) {
    const hits = hasGlob(p) ? globPaths(p, { io }) : fs.existsSync(p) ? [p] : [];
    if (!hits.length) { evidence.push({ path: norm(p), state: "missing" }); problems.push(`missing: ${norm(p)}`); continue; }
    let newest = null, empty = false;
    for (const h of hits) {
      const f = newestFile(h, fs);
      if (!f || f.size === 0) { empty = true; problems.push(`empty: ${norm(h)}`); } else if (!newest || f.mtime > newest.mtime) newest = { mtime: f.mtime, path: h };
    }
    if (empty) { evidence.push({ path: norm(p), state: "missing" }); continue; }
    if (!readOnly.has(norm(p)) && newest.mtime < since) { evidence.push({ path: norm(p), state: "stale" }); problems.push(`older than the step: ${norm(newest.path)}`); continue; }
    evidence.push({ path: norm(p), state: "done" });
  }
  const state = evidence.some((e) => e.state === "missing") ? "missing" : evidence.some((e) => e.state === "stale") ? "stale" : "done";
  return { state, problems, evidence };
}

// ---------------------------------------------------------------- ADOPT (work order 41): a run takes over a step's valid existing outputs instead of running it again
// The owner's rule: once an audit has started, a run resumes from where it is, never from scratch. A step is adopted when its evidence exists and is not empty AND every input
// is older than the evidence (an input exactly as old counts as not newer). With several evidence files the inputs are compared with the OLDEST one (any older evidence file would
// be stale against a newer input); the step's date is the NEWEST evidence mtime: the evidence's own date, never now. A path that is both an input and the evidence is not compared
// with itself; an input that does not exist cannot be newer and is listed under missingInputs. Waiting steps (script null: an owner capture, an approval) are adopted the same way.
// Pure: values, never an exception, no output. io (existsSync, statSync, readdirSync) and stat (statSync alone) are injectable for the CLI's tests.
// -> { ok: true, id, outcome: "adopted", exit: 0, at: <evidence mtime, ISO>, adoptedAt: <now, ISO>, evidence: [{ path, mtime }], inputsChecked, missingInputs }
//  | { ok: false, id, rule: "placeholder" | "no-evidence" | "evidence" | "input-newer", reason, input?, inputMtime?, evidenceMtime? }
function newestMtime(p, fs) {
  const hits = hasGlob(p) ? globPaths(p, { io: fs }) : fs.existsSync(p) ? [p] : [];
  let best = null;
  for (const h of hits) { const f = newestFile(h, fs); if (f && (best === null || f.mtime > best)) best = f.mtime; }
  return best;
}
export function adoptStep(step, { vars = {}, now = Date.now(), stat = null, io } = {}) {
  const base = ioOf(io), fs = stat ? { ...base, statSync: stat } : base, id = step?.id ?? null;
  const refuse = (rule, reason, extra = {}) => ({ ok: false, id, rule, reason, ...extra });
  let evPaths, inputs;
  try { evPaths = substitute(step?.evidence || [], vars); inputs = substitute(step?.inputs || [], vars); } catch (e) { return refuse("placeholder", e.message); }
  if (!evPaths.length) return refuse("no-evidence", `step ${id} names no evidence, so there is nothing to adopt`);
  const state = evidenceState(step, vars, { since: 0, io: fs });
  if (state.state !== "done") return refuse("evidence", `the evidence of step ${id} is not valid: ${state.problems.join("; ")}`);
  const iso = (ms) => new Date(ms).toISOString();
  const ev = evPaths.map((p) => ({ path: norm(p), mtimeMs: newestMtime(p, fs) }));
  const oldest = Math.min(...ev.map((e) => e.mtimeMs)), newest = Math.max(...ev.map((e) => e.mtimeMs));
  const own = new Set(ev.map((e) => e.path)), missingInputs = [];
  let checked = 0;
  for (const p of inputs) {
    if (own.has(norm(p))) continue;
    const m = newestMtime(p, fs);
    if (m === null) { missingInputs.push(norm(p)); continue; }
    checked++;
    if (m > oldest) return refuse("input-newer", `input ${norm(p)} (${iso(m)}) is newer than the evidence of step ${id} (${iso(oldest)})`, { input: norm(p), inputMtime: iso(m), evidenceMtime: iso(oldest) });
  }
  return { ok: true, id, outcome: "adopted", exit: 0, at: iso(newest), adoptedAt: iso(now), evidence: ev.map((e) => ({ path: e.path, mtime: iso(e.mtimeMs) })), inputsChecked: checked, missingInputs };
}
// The default of a resumed run, for start.mjs and the CLI's `seo run`: adopt unless the step is to be run fresh (--fresh, --fresh <step>). -> { adopt: boolean, result }
export function adoptDefault(step, { fresh = false, ...opts } = {}) {
  if (fresh) return { adopt: false, result: { ok: false, id: step?.id ?? null, rule: "fresh", reason: "--fresh: discard and run again" } };
  const result = adoptStep(step, opts);
  return { adopt: result.ok, result };
}

// What a step that ran amounts to. `evidence` (optional) is evidenceState's answer, looked at only for exit 0. Pure.
export function stepOutcome(step, { code, lastLine = "", output = "", evidence = null }) {
  const ll = String(lastLine || "").trim(), partial = /^partial/i.test(step?.exit?.["4"] || "");
  if (code === 0) {
    if (evidence && evidence.state !== "done") return { outcome: "fail", message: `the script exited 0 but its evidence is not there: ${evidence.problems.join("; ")}` };
    return { outcome: "done", message: ll };
  }
  if (code === 3 && /^NEEDS-INPUT/m.test(output)) return { outcome: "needs-input", message: ll };
  if (code === 3) return /^BLOCKED:/.test(ll) ? { outcome: "blocked", message: ll.replace(/^BLOCKED:\s*/, "") } : { outcome: "fail", message: `exit 3 means BLOCKED but the last line is not "BLOCKED: <what> | unblocks: <what would>": ${ll || "(no output)"}` };
  if (code === 4 && partial) return { outcome: "partial", message: ll };
  if (code === 4) return /^SKIPPED:/.test(ll) ? { outcome: "skipped", message: ll.replace(/^SKIPPED:\s*/, "") } : { outcome: "fail", message: `exit 4 means SKIPPED but the last line is not "SKIPPED: <reason>": ${ll || "(no output)"}` };
  if (code === 2) return { outcome: "fail", message: `usage error (exit 2): the manifest's args do not fit the script: ${ll}` };
  return { outcome: "fail", message: `exit ${code}: ${ll || "(no output)"}` };
}
