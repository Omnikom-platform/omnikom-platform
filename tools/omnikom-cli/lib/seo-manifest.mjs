// The manifest of `omnikom seo` (skills/programmatic-enterprise-web-performance/pipeline.json, SEO's file): its validator, the variables of
// its paths and the small path and glob helpers the runner shares. SEO can run the validator without the CLI:
//   import { validateManifest } from '<repo>/tools/omnikom-cli/lib/seo-manifest.mjs';   validateManifest(JSON.parse(text), { skillDir, repoRoot }) -> [problem, ...]
// The manifest is the contract: a step the validator does not know how to read is refused, never guessed at (exit 2, every problem listed).
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { Usage } from './errors.mjs';

export const VARS = ['url', 'client', 'host', 'skill', 'runDir', 'pewp', 'work'];
const TOP_KEYS = ['version', 'name', 'what', 'conventions', 'vars', 'steps'];
export const STEP_KEYS = ['id', 'module', 'what', 'script', 'args', 'inputs', 'outputs', 'dependsOn', 'needsBrowser', 'needsAi', 'needsPerson', 'needsKeys', 'heavy', 'hits', 'pace', 'timeoutMinutes', 'evidence', 'brief', 'exit', 'engines', 'kind', 'maxAgeDays'];
const REQUIRED = STEP_KEYS.filter(k => !['pace', 'brief', 'exit', 'engines', 'kind', 'maxAgeDays'].includes(k));
// the engines a stop file can stop (SEO head 2026-11-11: one file per engine, ~/.claude/state/omnikom-stops/<engine>.json); a step lists the ones it touches
export const KNOWN_ENGINES = ['google', 'bing', 'commoncrawl'];
export const NEEDS_BROWSER = ['none', 'headless', 'owner'];
// the first word of an `exit` map value says which state that exit code means
export const EXIT_WORDS = { ok: 'RUN', blocked: 'BLOCKED', skipped: 'SKIPPED', partial: 'PARTIAL', failed: 'FAILED' };
const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const KEY_NAME = /^[A-Z][A-Z0-9_]*$/;
const SCRIPT_EXT = /\.(mjs|cjs|js)$/;
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStrings = v => Array.isArray(v) && v.every(x => typeof x === 'string');
export const norm = p => String(p).replace(/\\/g, '/');
export const exitWord = text => String(text).trim().toLowerCase().split(/[^a-z]/)[0];

// a step nobody's script runs: it waits for the owner's browser, an AI agent or a person
export const isWaiting = s => s.needsBrowser === 'owner' || s.needsAi === true || s.needsPerson === true;

export const placeholders = text => [...String(text).matchAll(/\{([^{}]*)\}/g)].map(m => m[1]);

// `repo:<path>` is relative to the repository root, anything else to the skill folder; a path that leaves both is no script
export function resolveScript(script, { skillDir, repoRoot }) {
  const repo = script.startsWith('repo:');
  const rel = norm(repo ? script.slice(5) : script);
  if (!rel || isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.split('/').includes('..')) return null;
  return join(repo ? repoRoot : skillDir, rel);
}

// ---- paths and globs: `*` inside one path segment, nothing else; a trailing slash means a folder
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const segRe = seg => new RegExp('^' + seg.split('*').map(escapeRe).join('[^/]*') + '$', process.platform === 'win32' ? 'i' : '');
const segs = s => norm(s).split('/').filter(Boolean);
// does path pattern a name b, or a folder that holds b? (the patterns are compared as written, before the variables are filled in)
export function covers(a, b) {
  const A = segs(a), B = segs(b);
  return A.length <= B.length && A.every((x, i) => x === B[i] || segRe(x).test(B[i]));
}
export const related = (a, b) => covers(a, b) || covers(b, a);

function walk(base, parts) {
  if (!parts.length) return existsSync(base) ? [base] : [];
  const [head, ...rest] = parts;
  const at = base.endsWith('/') ? base : base + '/';
  if (!head.includes('*')) return walk(at + head, rest);
  let names;
  try { names = readdirSync(base); } catch { return []; }
  const re = segRe(head);
  return names.filter(n => re.test(n)).sort().flatMap(n => walk(at + n, rest));
}
// every existing path (file or folder) the pattern names
export function expandPath(pattern) {
  const parts = segs(pattern);
  const abs = norm(pattern);
  if (/^[A-Za-z]:$/.test(parts[0] || '')) return walk(parts[0] + '/', parts.slice(1));
  return walk(abs.startsWith('/') ? '/' : '.', parts);
}
// the non-empty files under a path (a folder is read to the bottom): { path, mtimeMs, size }
export function filesUnder(path, out = [], cap = 20000) {
  let st;
  try { st = statSync(path); } catch { return out; }
  if (st.isFile()) { if (st.size > 0) out.push({ path: norm(path), mtimeMs: st.mtimeMs, size: st.size }); return out; }
  if (!st.isDirectory()) return out;
  for (const n of readdirSync(path).sort()) { if (out.length >= cap) break; filesUnder(norm(path) + '/' + n, out, cap); }
  return out;
}
export const liveFiles = pattern => expandPath(pattern).flatMap(p => filesUnder(p));

// A stable topological order: the next step is the first, in file order, whose dependsOn are all placed already (a manifest whose file order is not
// topological is read the same way). On a cycle (the validator refuses one) the steps left over follow in file order, so this never loops.
export function topoOrder(steps) {
  const placed = new Set(), out = [], left = [...steps];
  while (left.length) {
    const at = left.findIndex(s => s.dependsOn.every(d => placed.has(d) || !steps.some(t => t.id === d)));
    const [s] = left.splice(at < 0 ? 0 : at, 1);
    placed.add(s.id); out.push(s);
  }
  return out;
}

// ---- the variables
export function hostOf(url) {
  let u;
  try { u = new URL(url); } catch { throw new Usage(`the url is not a url: ${url}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Usage(`the url must be http or https: ${url}`);
  return u.hostname.toLowerCase().replace(/^www\./, '');
}
export function makeVars({ url, client, skillDir }) {
  const skill = norm(skillDir);
  const host = hostOf(url);
  const runDir = `${skill}/site-checks/${host}`;
  return { url, client, host, skill, runDir, pewp: `${runDir}/.pewp`, work: `${runDir}/work` };
}
export const expand = (text, vars) => String(text).replace(/\{([A-Za-z]+)\}/g, (m, name) => (Object.hasOwn(vars, name) ? vars[name] : m));

// ---- the validator: every problem, as a list of sentences (empty = valid)
export function validateManifest(m, { skillDir, repoRoot, exists = existsSync } = {}) {
  const p = [];
  if (!isObj(m)) return ['the manifest is not a JSON object'];
  for (const k of Object.keys(m)) if (!TOP_KEYS.includes(k)) p.push(`unknown key '${k}' at the top level`);
  if (m.version !== 1) p.push(`version must be 1 (got ${JSON.stringify(m.version)})`);
  if (!Array.isArray(m.steps) || m.steps.length === 0) return [...p, 'steps must be a non-empty array'];
  const known = new Set();
  const dup = new Set();
  for (const s of m.steps) if (isObj(s) && typeof s.id === 'string') (known.has(s.id) ? dup : known).add(s.id);
  for (const id of dup) p.push(`step id '${id}' is used twice`);
  const graph = new Map();
  m.steps.forEach((s, i) => {
    if (!isObj(s)) { p.push(`steps[${i}] is not an object`); return; }
    const w = typeof s.id === 'string' && s.id ? `step '${s.id}'` : `steps[${i}]`;
    for (const k of Object.keys(s)) if (!STEP_KEYS.includes(k)) p.push(`${w}: unknown key '${k}'`);
    for (const k of REQUIRED) if (!(k in s) && k !== 'timeoutMinutes') p.push(`${w}: missing '${k}'`);   // a missing timeout has its own sentence below
    if ('id' in s && !(typeof s.id === 'string' && ID.test(s.id))) p.push(`${w}: id must be lowercase words joined by hyphens`);
    if ('module' in s && !(typeof s.module === 'string' && ID.test(s.module))) p.push(`${w}: module must be lowercase words joined by hyphens`);
    if ('what' in s && !(typeof s.what === 'string' && s.what.trim())) p.push(`${w}: what must say, in words, what the step does`);
    for (const k of ['args', 'inputs', 'outputs', 'dependsOn', 'needsKeys', 'evidence']) if (k in s && !isStrings(s[k])) p.push(`${w}: ${k} must be a list of strings`);
    for (const k of ['needsAi', 'needsPerson', 'heavy']) if (k in s && typeof s[k] !== 'boolean') p.push(`${w}: ${k} must be true or false`);
    if ('needsBrowser' in s && !NEEDS_BROWSER.includes(s.needsBrowser)) p.push(`${w}: needsBrowser must be one of ${NEEDS_BROWSER.join(', ')} (got ${JSON.stringify(s.needsBrowser)})`);
    if ('hits' in s && !(s.hits === 'client' || s.hits === 'none' || (typeof s.hits === 'string' && /^third-party:\S+$/.test(s.hits)))) p.push(`${w}: hits must be client, none or third-party:<name> (got ${JSON.stringify(s.hits)})`);
    if ('pace' in s && s.pace !== null && typeof s.pace !== 'string') p.push(`${w}: pace must be a string or null`);
    if ('brief' in s && typeof s.brief !== 'string') p.push(`${w}: brief must be a string`);
    if ('kind' in s && !['stable', 'time-sensitive', 'derived'].includes(s.kind)) p.push(`${w}: kind must be stable, time-sensitive or derived`);
    if ('maxAgeDays' in s && s.maxAgeDays !== null && !(typeof s.maxAgeDays === 'number' && Number.isFinite(s.maxAgeDays) && s.maxAgeDays > 0)) p.push(`${w}: maxAgeDays must be null or a number above 0`);
    if ('engines' in s) { if (!isStrings(s.engines)) p.push(`${w}: engines must be a list of strings`); else for (const e of s.engines) if (!KNOWN_ENGINES.includes(e)) p.push(`${w}: engines holds '${e}', which is not a known engine (${KNOWN_ENGINES.join(', ')})`); }
    if (Array.isArray(s.needsKeys)) for (const k of s.needsKeys) if (typeof k === 'string' && !KEY_NAME.test(k)) p.push(`${w}: needsKeys holds '${k}', which is not a variable name`);
    for (const k of ['script', 'args', 'inputs', 'outputs', 'evidence', 'brief']) {
      for (const text of [].concat(s[k] ?? []).filter(x => typeof x === 'string')) {
        for (const name of placeholders(text)) if (!VARS.includes(name)) p.push(`${w}: ${k} uses the placeholder {${name}}, which is not one of ${VARS.map(v => `{${v}}`).join(' ')}`);
      }
    }
    const waiting = isWaiting(s);
    const timeout = s.timeoutMinutes;
    if (!('timeoutMinutes' in s) || typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout < 0) p.push(`${w}: timeoutMinutes is missing or not a number of minutes`);
    else if (!waiting && timeout === 0) p.push(`${w}: a step a script runs needs a timeout above 0 minutes`);
    if ('script' in s) {
      if (waiting) { if (s.script !== null) p.push(`${w}: a waiting step (owner browser, AI or person) must have script null, not a script`); }
      else if (typeof s.script !== 'string' || !s.script) p.push(`${w}: a step the runner runs needs a script`);
      else if (!SCRIPT_EXT.test(s.script)) p.push(`${w}: script '${s.script}' is not a node file (.mjs, .cjs or .js)`);
      else {
        const at = resolveScript(s.script, { skillDir, repoRoot });
        if (!at) p.push(`${w}: script '${s.script}' leaves the skill folder and the repository`);
        else if (!exists(at)) p.push(`${w}: script '${s.script}' does not exist (${norm(at)})`);
      }
    }
    // `vantage start` opens the owner's browser session: only a person or `omnikom seo vantage start` does that, never a run
    if (typeof s.script === 'string' && /(^|\/)vantage\.mjs$/.test(norm(s.script)) && Array.isArray(s.args) && s.args.some(a => /^start$/i.test(String(a)))) p.push(`${w}: a step must never call vantage start (a run only reads its status)`);
    if (waiting) {
      if (typeof s.brief !== 'string' || !s.brief.trim()) p.push(`${w}: a waiting step needs a brief that says what the agent must do`);
      if (Array.isArray(s.outputs) && s.outputs.length === 0) p.push(`${w}: a waiting step needs outputs: nothing else tells the runner it is done`);
    }
    if (isObj(s.exit)) {
      for (const [code, text] of Object.entries(s.exit)) {
        if (!/^\d+$/.test(code) || Number(code) > 255) p.push(`${w}: exit key '${code}' is not an exit code`);
        else if (typeof text !== 'string' || !Object.hasOwn(EXIT_WORDS, exitWord(text))) p.push(`${w}: exit ${code} must start with ${Object.keys(EXIT_WORDS).join(', ')} (got ${JSON.stringify(text)})`);
      }
    } else if ('exit' in s) p.push(`${w}: exit must be an object of exit code -> text`);
    if (Array.isArray(s.evidence)) {
      if (s.evidence.length === 0) p.push(`${w}: evidence is empty: nothing would show the step did its work`);
      for (const e of s.evidence) {
        if (e.includes('**')) p.push(`${w}: evidence '${e}' uses **, only * inside one path segment is read`);
        else if (!(s.outputs || []).some(o => covers(o, e)) && !(s.inputs || []).some(o => covers(o, e))) p.push(`${w}: evidence '${e}' is neither inside an output nor an input of the step`);
      }
    }
    if (Array.isArray(s.dependsOn)) {
      for (const d of s.dependsOn) if (!known.has(d)) p.push(`${w}: dependsOn '${d}' is not a step`);
      if (typeof s.id === 'string') graph.set(s.id, s.dependsOn.filter(d => known.has(d)));
    }
  });
  // a cycle: depth-first, reporting each loop once, as a -> b -> a
  const state = new Map();
  const loops = new Set();
  const visit = (id, trail) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { const loop = trail.slice(trail.indexOf(id)); loops.add([...loop, id].join(' -> ')); return; }
    state.set(id, 1);
    for (const d of graph.get(id) || []) visit(d, [...trail, id]);
    state.set(id, 2);
  };
  for (const id of graph.keys()) visit(id, []);
  for (const l of loops) p.push(`dependency cycle: ${l}`);
  return p;
}

// the manifest file -> the parsed manifest; a file that is missing or not JSON is refused like an invalid one
export function parseManifest(text, file) {
  try { return JSON.parse(text); } catch (e) { throw new Usage(`the manifest ${file} is not valid JSON: ${String(e.message).slice(0, 200)}`); }
}
