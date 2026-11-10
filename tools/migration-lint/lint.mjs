// migration-lint (book row E19): a static lock lint over supabase/migrations/*.sql. READS the folder, never edits it.
//   node tools/migration-lint/lint.mjs [--dir <migrations folder>] [--waivers <file>] [--json]
// Exit 0 = every finding is waived and no waiver is stale; 1 = a finding with no waiver, or a stale or malformed waiver; 2 = the folder or
// a file could not be read or scanned (fails closed, never a pass). Rules, their reasons and the safe alternatives: lib/rules.mjs, README.md.
// Waivers (waivers.json): one entry per finding { file, rule, line, date, reason }; a waiver that matches no finding is itself an error.
import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintFiles, RULES, RULE_IDS } from './lib/rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DIR = resolve(HERE, '..', '..', 'supabase', 'migrations');
export const DEFAULT_WAIVERS = join(HERE, 'waivers.json');
const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export function checkWaivers(list, fileNames) {
  const errors = [];
  if (!Array.isArray(list)) return ['waivers: the file is not a JSON array'];
  const seen = new Set();
  list.forEach((w, i) => {
    const at = `waivers[${i}]`;
    if (!w || typeof w !== 'object' || Array.isArray(w)) { errors.push(`${at}: not an object`); return; }
    const extra = Object.keys(w).filter(k => !['file', 'rule', 'line', 'date', 'reason'].includes(k));
    if (extra.length) errors.push(`${at}: unknown key ${extra.join(', ')}`);
    if (!fileNames.includes(w.file)) errors.push(`${at}: file ${JSON.stringify(w.file)} is not in the migrations folder`);
    if (!RULE_IDS.includes(w.rule)) errors.push(`${at}: rule ${JSON.stringify(w.rule)} is not a rule id (${RULE_IDS.join(' ')})`);
    if (!Number.isInteger(w.line) || w.line < 1) errors.push(`${at}: line must be a positive integer`);
    if (!validDate(w.date)) errors.push(`${at}: date must be a real YYYY-MM-DD`);
    if (typeof w.reason !== 'string' || w.reason.trim().length < 20) errors.push(`${at}: reason must say why, in at least 20 characters`);
    const key = `${w.file}|${w.rule}|${w.line}`;
    if (seen.has(key)) errors.push(`${at}: a second waiver for ${w.file}:${w.line} ${w.rule}`);
    seen.add(key);
  });
  return errors;
}

// files: [{ name, text }]; waivers: the parsed waivers list. Pure: no disk.
// applierText: the text of the script that applies the folder (supabase/apply-staging.mjs), or null when there is none to check. A file
// that carries `-- no-transaction` is a problem while the applier does not handle that header: it would wrap the file in begin/commit and
// CREATE INDEX CONCURRENTLY would fail on every database (finding: tools/migration-lint/FINDING-apply-staging.md).
export const APPLIER_MARKER = /no-transaction/;
export function lintAll(files, waivers, applierText = null) {
  const { findings, errors, existing, noTxFiles } = lintFiles(files);
  const applierProblems = applierText !== null && noTxFiles.length && !APPLIER_MARKER.test(applierText)
    ? noTxFiles.map(f => `C1 ${f} carries "-- no-transaction" but the applier (supabase/apply-staging.mjs) does not handle that header: it would wrap the file in begin/commit and the statement would fail; see tools/migration-lint/FINDING-apply-staging.md`) : [];
  const names = files.map(f => f.name);
  const wErrors = checkWaivers(waivers, names);
  const used = new Set();
  const open = [], waived = [];
  for (const f of findings) {
    const w = wErrors.length === 0 && waivers.find(x => x.file === f.file && x.rule === f.rule && x.line === f.line);
    if (w) { used.add(w); waived.push({ ...f, waiver: w }); } else open.push(f);
  }
  const stale = wErrors.length ? [] : waivers.filter(w => !used.has(w)).map(w => `stale waiver: ${w.file}:${w.line} ${w.rule} (${w.date}) matches no finding; delete it`);
  return { files: names.length, open, waived, errors, waiverErrors: [...wErrors, ...stale], applierProblems, existing };
}

export function lintFolder(dir, waiversFile, applierFile = join(dir, '..', 'apply-staging.mjs')) {
  if (!existsSync(dir)) throw new Error(`no migrations folder at ${dir}`);
  const names = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  if (names.length === 0) throw new Error(`no .sql files in ${dir}`);
  const files = names.map(name => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
  let waivers = [];
  if (waiversFile && existsSync(waiversFile)) {
    try { waivers = JSON.parse(readFileSync(waiversFile, 'utf8')); } catch (e) { throw new Error(`waivers file is not JSON: ${e.message}`); }
  }
  return lintAll(files, waivers, applierFile && existsSync(applierFile) ? readFileSync(applierFile, 'utf8') : null);
}

export function report(r) {
  const lines = [];
  const msg = f => `${f.file}:${f.line} ${f.rule} ${f.detail ? `${f.detail}: ` : ''}${RULES[f.rule].reason}. Safe: ${RULES[f.rule].safe}.`;
  for (const f of r.open) lines.push(`FAIL ${msg(f)}\n     statement: ${f.text}`);
  for (const w of r.waived) lines.push(`WAIVED ${w.file}:${w.line} ${w.rule} (waiver ${w.waiver.date})`);
  for (const e of r.errors) lines.push(`ERROR ${e}`);
  for (const e of r.waiverErrors) lines.push(`FAIL ${e}`);
  for (const e of r.applierProblems) lines.push(`FAIL ${e}`);
  lines.push(`migration-lint: ${r.files} files, ${r.open.length} finding(s), ${r.waived.length} waived, ${r.waiverErrors.length} waiver problem(s), ${r.applierProblems.length} applier problem(s), ${r.errors.length} unreadable`);
  return lines.join('\n') + '\n';
}

export const exitCode = r => (r.errors.length ? 2 : r.open.length || r.waiverErrors.length || r.applierProblems.length ? 1 : 0);

const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = { dir: DEFAULT_DIR, waivers: DEFAULT_WAIVERS, applier: undefined, json: false };
  const usage = () => { console.error('usage: node tools/migration-lint/lint.mjs [--dir <folder>] [--waivers <file>] [--applier <apply-staging.mjs>] [--json]'); process.exit(2); };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') opt.json = true;
    else if (['--dir', '--waivers', '--applier'].includes(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('--')) opt[argv[i].slice(2)] = resolve(argv[++i]);
    else usage();
  }
  try {
    const r = lintFolder(opt.dir, opt.waivers, opt.applier);
    process.stdout.write(opt.json ? JSON.stringify(r, null, 2) + '\n' : report(r));
    process.exit(exitCode(r));
  } catch (e) { console.error(`migration-lint: ${e.message}`); process.exit(2); }
}
