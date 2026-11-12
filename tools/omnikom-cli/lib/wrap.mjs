// The registry and the thin wrap (P3.3 B1). registry.json lists the tools the CLI wraps; this file starts a row's script with the caller's
// arguments, passes its output back untouched, maps its exit code (the table in mapExit), prints the row's own help and checks the registry.
// The wrap adds no logic of its own: whatever the script prints and exits with is the answer, except that one line is added to stderr when
// the exit code was changed or the script gave none, so the person can see why.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CLI_DIR, REPO, importRepo } from './repo.mjs';
import { Blocked } from './errors.mjs';
import { result } from './ctx.mjs';
import { parseArgs, RETIRED } from './args.mjs';

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// deps.registry when a test hands one, else registry.json beside the CLI
export function loadRegistry(deps = {}) {
  let registry = deps.registry;
  if (registry === undefined) {
    try { registry = JSON.parse(readFileSync(join(CLI_DIR, 'registry.json'), 'utf8')); } catch { registry = null; }
  }
  if (!registry || typeof registry !== 'object' || !Array.isArray(registry.engines) || !registry.commands || typeof registry.commands !== 'object' || Array.isArray(registry.commands)) {
    throw new Blocked('registry.json is not readable', 'restore tools/omnikom-cli/registry.json from git');
  }
  return registry;
}

// words: the leading tokens of the command line that are not flags. Two words are tried first, then one.
export function findRow(registry, words) {
  const rows = registry.commands;
  if (words.length >= 2) {
    const two = `${words[0]} ${words[1]}`;
    if (own(rows, two)) return { name: two, row: rows[two], used: 2 };
  }
  if (words.length >= 1 && own(rows, words[0])) return { name: words[0], row: rows[words[0]], used: 1 };
  return null;
}

// 0 ok, 1 failed, 2 usage, 3 blocked stay; 4 is "skipped" and counts as 0 only when the script says SKIPPED: on its last line; 127 (could not start) is 3
export function mapExit(childExit, lastLine) {
  if (childExit === 0 || childExit === 1 || childExit === 2 || childExit === 3) return childExit;
  if (childExit === 4) return String(lastLine || '').startsWith('SKIPPED:') ? 0 : 1;
  if (childExit === 127) return 3;
  return 1;   // everything else: a time-out (124), a stop (130, 143), any other number, no number
}

export async function runWrapped(name, row, args, { env, repo } = {}) {
  const script = join(repo || REPO, row.script);
  if (!existsSync(script)) throw new Blocked(`the script of '${name}' is not at ${row.script}`, 'restore it from git, or correct its row in tools/omnikom-cli/registry.json');
  const guard = await importRepo('tools/proc-guard/index.mjs');
  const r = await guard.runLimited(process.execPath, [script, ...args], { cwd: repo || REPO, env, timeout: (row.timeoutMinutes || 10) * 60000 });
  let childExit, why = '', gave = true;
  // the time limit is read first: on Windows the tree kill ends the script with the number 1, and that is not the script's own answer
  if (r.timedOut) { childExit = 124; why = ' (timed out)'; gave = false; }
  else if (typeof r.status === 'number') childExit = r.status;
  else {
    gave = false;
    if (r.error) { childExit = 127; why = ' (could not start)'; }
    else { childExit = 143; why = ' (stopped)'; }
  }
  const stdout = r.stdout || '';
  const lines = stdout.split(/\r?\n/).filter(l => l.trim() !== '');
  const exit = mapExit(childExit, lines.length ? lines[lines.length - 1] : '');
  const childErr = r.stderr || '';
  const stderr = childErr + (exit !== childExit || !gave ? `${childErr !== '' && !childErr.endsWith('\n') ? '\n' : ''}omnikom ${name}: the script exited ${childExit}${why}; exit ${exit}\n` : '');
  return result(exit === 0, exit === 0 ? 'ok' : `WRAP-${exit}`, { exit, childExit, stdout, stderr, raw: true });
}

export function helpText(name, row) {
  const flags = Object.entries(row.flags || {});
  return [
    `omnikom ${name}: ${row.summary}`,
    `usage: ${row.usage}`,
    `arguments: ${row.args || 'none'}`,
    'flags:',
    ...(flags.length ? flags.map(([flag, d]) => (d.value ? `  --${flag} <value>   ${d.help}` : `  --${flag}   ${d.help}`)) : ['  (none)']),
    'exits:',
    ...Object.entries(row.exits || {}).map(([code, text]) => `  ${code}  ${text}`),
    `output: ${row.output}`,
    `example: ${row.example}`,
  ].join('\n') + '\n';
}

const NAME = /^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)?$/;
const PART = /^[A-Za-z0-9._-]+$/;
const isPath = p => typeof p === 'string' && p.split('/').every(x => PART.test(x) && x !== '..');
const isText = t => typeof t === 'string' && t.trim() !== '';
const isObject = o => Boolean(o) && typeof o === 'object' && !Array.isArray(o);

// An array of problem strings, empty when the registry is clean: the engines list matches commands/, and each row names itself properly,
// points at tracked files, carries the help text, declares flags that parseArgs accepts, and has an example that parses.
export function checkRegistry(registry, { repo, commandFiles, engineCommands }) {
  const problems = [];
  const listed = (Array.isArray(registry.engines) ? registry.engines.map(String) : []).sort();
  const held = [...commandFiles].sort();
  if (JSON.stringify(listed) !== JSON.stringify(held)) problems.push(`ENGINES: registry.json lists ${listed.join(', ')} but commands/ holds ${held.join(', ')}`);
  for (const [name, row] of Object.entries(registry.commands || {})) {
    const p = (kind, why) => problems.push(`${kind} ${name}: ${why}`);
    if (!NAME.test(name)) p('NAME', 'the name must be one or two lowercase words (letters, digits, hyphens)');
    else if (!name.includes(' ') && (engineCommands || []).includes(name)) p('NAME', 'an engine command has this name, and the engine wins over a one-word row');
    if (!isObject(row)) { p('HELP', 'the row is not an object'); continue; }
    const fileProblem = field => {
      if (!isPath(row[field])) return `${field} must be a repo-relative path of letters, digits, . _ - joined by /, with no .. part`;
      let isFile = false;
      try { isFile = statSync(join(repo, row[field])).isFile(); } catch { isFile = false; }
      return isFile ? null : `${row[field]} is not a file under the repo`;
    };
    const s = fileProblem('script'); if (s) p('SCRIPT', s);
    const t = fileProblem('test'); if (t) p('TEST', t);
    const usageBad = typeof row.usage !== 'string' || !row.usage.startsWith(`omnikom ${name}`);
    const exampleBad = typeof row.example !== 'string' || !row.example.startsWith(`omnikom ${name}`);
    const exits = row.exits;
    const exitsBad = !isObject(exits) || !own(exits, '0') || !Object.keys(exits).every(k => ['0', '1', '2', '3'].includes(k) && isText(exits[k]));
    const help = [
      [typeof row.summary !== 'string' || row.summary.trim().length < 1 || row.summary.length > 100 || /[\r\n]/.test(row.summary), 'summary must be one line of 1 to 100 characters'],
      [usageBad, `usage must start with 'omnikom ${name}'`],
      [exampleBad, `example must start with 'omnikom ${name}'`],
      [!isText(row.output), 'output must say what the tool prints'],
      [row.args !== undefined && typeof row.args !== 'string', 'args must be text'],
      [exitsBad, 'exits must be an object with a key 0, only keys 0 to 3, and a text for each'],
    ].find(([bad]) => bad);
    if (help) p('HELP', help[1]);
    let flagsBad = false;
    if (row.flags !== undefined) {
      flagsBad = !isObject(row.flags) || !Object.values(row.flags).every(d => isObject(d) && typeof d.value === 'boolean' && isText(d.help));
      if (flagsBad) p('FLAGS', 'flags must be an object of { value: <true or false>, help: <text> }');
    }
    if (isObject(row.flags)) {
      const old = Object.keys(row.flags).find(f => own(RETIRED, f));
      if (old) p('RETIRED-FLAG', `--${old} is retired; the spelling is --${RETIRED[old]}`);
    }
    if (!usageBad && !exampleBad && !flagsBad) {
      try { parseArgs(row.example.slice(`omnikom ${name}`.length).split(/\s+/).filter(Boolean), isObject(row.flags) ? row.flags : {}); } catch (e) { p('EXAMPLE', `the example does not parse with the row's flags: ${e.message}`); }
    }
  }
  return problems;
}
