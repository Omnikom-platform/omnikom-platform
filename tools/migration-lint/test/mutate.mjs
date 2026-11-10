// Watched-fail for tools/migration-lint: a broken COPY of the tool with ONE check removed, test/run.mjs run against it, the suite must go red
// on a named check. Pattern of tools/audit/test/mutate.mjs: [name, file, exactText, replacement], applied with split/join to a temp copy, one
// child process per mutant (MUTATE_JOBS at a time, default 4), 120 s timeout.
// Caught = the suite exited nonzero AND printed a "FAIL" line. A crash or a timeout with no FAIL line is NOT a catch. Target text that is not
// found exactly once is "target text missing". A killed child (exit null) is "NOT RUN". The unmutated copy runs first and must pass.
// The real migrations folder is passed in OMNIKOM_MIGRATIONS_DIR (a copy of the tool is not inside the repo). Summary line:
// "N mutants, N caught, N survived, N not run, N target text missing".
//   node tools/migration-lint/test/mutate.mjs      exit 0 = every mutant caught, none survived, none not run, none missing
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REAL = process.env.OMNIKOM_MIGRATIONS_DIR ? resolve(process.env.OMNIKOM_MIGRATIONS_DIR) : resolve(TOOL, '..', '..', 'supabase', 'migrations');
const R = String.raw;
const MUTANTS = [
  // ---- the scanner
  ['scan: string literals are not masked', 'lib/scan.mjs', 'add(open(), "\'\'", lit);', 'add(open(), lit, lit);'],
  ['scan: -- comments are not dropped', 'lib/scan.mjs', "if (c === '-' && s[i + 1] === '-') {", 'if (false) {'],
  ['scan: /* comments are not dropped', 'lib/scan.mjs', "if (c === '/' && s[i + 1] === '*') {", 'if (false) {'],
  ['scan: block comments do not nest', 'lib/scan.mjs', "if (s[j] === '/' && s[j + 1] === '*') { depth++; j += 2; }", 'if (false) { depth++; j += 2; }'],
  ['scan: dollar quotes are not read', 'lib/scan.mjs', "if (c === '$' && !(i > 0 && IDENT.test(s[i - 1]))) {", 'if (false) {'],
  ['scan: an E string ignores backslash escapes', 'lib/scan.mjs', "const escapes = /[eE]/.test(s[i - 1] || '') && !(i >= 2 && IDENT.test(s[i - 2]));", 'const escapes = false;'],
  ['scan: a doubled quote ends the string', 'lib/scan.mjs', `if (s[j] === "'") { if (s[j + 1] === "'") { j += 2; continue; } break; }`, `if (s[j] === "'") { break; }`],
  ['scan: an unterminated string does not throw', 'lib/scan.mjs', 'if (j >= s.length) throw new Error(`line ${line}: a string literal is never closed`);', 'if (j >= s.length) break;'],
  ['scan: an unterminated block comment does not throw', 'lib/scan.mjs', 'if (depth > 0) throw new Error(`line ${line}: a /* comment is never closed`);', ''],
  ['scan: an unterminated dollar quote does not throw', 'lib/scan.mjs', 'if (close < 0) throw new Error(`line ${line}: the dollar quote ${m[0]} is never closed`);', 'if (close < 0) break;'],
  ['scan: BEGIN ATOMIC does not throw', 'lib/scan.mjs', R`if (/\bbegin\s+atomic\b/.test(st.norm)) throw`, 'if (false) throw'],
  ['scan: the header keeps collecting after the first token', 'lib/scan.mjs', 'if (!sawToken) header.push(', 'header.push('],
  ['scan: a block comment does not end the header', 'lib/scan.mjs', '      sawToken = true;   // the header', '      // the header'],
  ['scan: token lines are all line 1', 'lib/scan.mjs', 'st.tokLines.push(line)', 'st.tokLines.push(1)'],
  ['scan: norm is not lower case', 'lib/scan.mjs', 'cur.norm = cur.norm.toLowerCase().replace(', 'cur.norm = cur.norm.replace('],
  ['scan: a semicolon does not split', 'lib/scan.mjs', "if (c === ';') { end(); i++; continue; }", "if (c === ';') { i++; continue; }"],
  // ---- L1
  ['L1: CREATE INDEX is never flagged', 'lib/rules.mjs', "} else if (!newHere.has(t)) { flag('L1', st); touch(st); }", "} else if (false) { flag('L1', st); touch(st); }"],
  ['L1: an index on a table of the same file is flagged', 'lib/rules.mjs', "} else if (!newHere.has(t)) { flag('L1', st); touch(st); }", "} else if (true) { flag('L1', st); touch(st); }"],
  ['L1: CREATE INDEX CONCURRENTLY is flagged like a plain one', 'lib/rules.mjs', 'if (m[2]) {', 'if (false) {'],
  ['L1: ADD UNIQUE / PRIMARY KEY is never flagged', 'lib/rules.mjs', R`} else if (!/\busing\s+index\b/.test(a)) flag('L1'`, `} else if (false) flag('L1'`],
  ['L1: ADD UNIQUE ... USING INDEX is flagged', 'lib/rules.mjs', R`} else if (!/\busing\s+index\b/.test(a)) flag('L1'`, `} else if (true) flag('L1'`],
  // ---- L2
  ['L2: an ADD CONSTRAINT that validates is never flagged', 'lib/rules.mjs', "if (!notValid) flag('L2', st, kind);", "if (false) flag('L2', st, kind);"],
  ['L2: NOT VALID is flagged too', 'lib/rules.mjs', "if (!notValid) flag('L2', st, kind);", "if (true) flag('L2', st, kind);"],
  ['L2: a foreign key is not a constraint of the rule', 'lib/rules.mjs', "if (kind === 'check' || kind === 'foreign key') {", "if (kind === 'check') {"],
  ['L2: an inline CHECK on a new column is never flagged', 'lib/rules.mjs', R`if (/\bcheck\s*\(/.test(a)) flag('L2'`, `if (false) flag('L2'`],
  ['L7: CREATE / ALTER / DROP POLICY do not touch the table', 'lib/rules.mjs', R`(?:create|alter|drop)\\s+policy`, R`(?:xcreate|xalter|xdrop)\\s+policy`],
  ['L2: an inline REFERENCES is flagged (it does not scan: measured)', 'lib/rules.mjs', R`if (/\bcheck\s*\(/.test(a)) flag('L2'`, R`if (/\bcheck\s*\(|\breferences\b/.test(a)) flag('L2'`],
  ['lint: two hits of one rule in one statement stay two findings (a single waiver cannot cover them)', 'lib/rules.mjs', 'if (same) {', 'if (false) {'],
  // ---- L3
  ['L3: SET NOT NULL is never flagged', 'lib/rules.mjs', "if (!isProven(t, x[1].replace(/\"/g, ''))) flag('L3'", "if (false) flag('L3'"],
  ['L3: a proven column is flagged too', 'lib/rules.mjs', "if (!isProven(t, x[1].replace(/\"/g, ''))) flag('L3'", "if (true) flag('L3'"],
  ['L3: VALIDATE CONSTRAINT proves nothing', 'lib/rules.mjs', 'if (col) prove(t, col);', 'if (false) prove(t, col);'],
  ['L3: a check on any column proves every column', 'lib/rules.mjs', 'const isProven = (t, c) => (proven.get(t) || new Set()).has(c);', 'const isProven = (t, c) => (proven.get(t) || new Set()).size > 0;'],
  // ---- L4
  ['L4: ALTER COLUMN TYPE is never flagged', 'lib/rules.mjs', "            flag('L4', st);", '            ;'],
  // ---- L5
  ['L5: a volatile default is never flagged', 'lib/rules.mjs', ': dflt && VOLATILE.test(dflt[1]) ? ', ': false ? '],
  ['L5: a serial column is never flagged', 'lib/rules.mjs', "'serial type (nextval())'", "''"],
  ['L5: an identity column is never flagged', 'lib/rules.mjs', "'identity column'", "''"],
  ['L5: a stored generated column is never flagged', 'lib/rules.mjs', "'stored generated column'", "''"],
  ['L5: now() counts as volatile', 'lib/rules.mjs', '(?:gen_random_uuid|gen_random_bytes|', '(?:now|gen_random_uuid|gen_random_bytes|'],
  ['L5: clock_timestamp() is not volatile', 'lib/rules.mjs', '|clock_timestamp|', '|'],
  ['L5: a new table is not exempt', 'lib/rules.mjs', '        if (newHere.has(t)) continue;\n        touch(st);', '        touch(st);'],
  // ---- L6
  ['L6: LOCK TABLE is never flagged', 'lib/rules.mjs', "{ flag('L6', st, 'LOCK TABLE'); touch(st); }", '{ touch(st); }'],
  ['L6: VACUUM FULL is never flagged', 'lib/rules.mjs', "flag('L6', st, 'VACUUM FULL');", ''],
  ['L6: CLUSTER is never flagged', 'lib/rules.mjs', "flag('L6', st, 'CLUSTER');", ''],
  ['L6: REINDEX is never flagged', 'lib/rules.mjs', "else { otherStmts.push(st); flag('L6', st, 'REINDEX'); }", 'else { otherStmts.push(st); }'],
  ['L6: REINDEX CONCURRENTLY is flagged like a plain one', 'lib/rules.mjs', R`if (/\bconcurrently\b/.test(n)) noTxStmts.push(st); else {`, 'if (false) noTxStmts.push(st); else {'],
  // ---- L7
  ['L7: a file with no lock_timeout is never flagged', 'lib/rules.mjs', 'if (firstTouch && !(lockOrd !== null && lockOrd < firstTouch.ord))', 'if (false)'],
  ['L7: a lock_timeout set after the first touch counts', 'lib/rules.mjs', 'lockOrd < firstTouch.ord', 'true'],
  ['L7: lock_timeout = 0 counts', 'lib/rules.mjs', R`const on = v && !/^(0+(\.0+)?(ms|s|min|h|d)?|default)$/i.test(v[1]);`, 'const on = v;'],
  ['L7: SET LOCAL counts in a no-transaction file', 'lib/rules.mjs', "if (on && !(noTxDirective && m[1] && m[1].trim() === 'local') && lockOrd === null)", 'if (on && lockOrd === null)'],
  ['L7: ALTER TABLE does not touch the table', 'lib/rules.mjs', '        if (newHere.has(t)) continue;\n        touch(st);\n        for (const a of', '        if (newHere.has(t)) continue;\n        for (const a of'],
  ['L7: CREATE INDEX CONCURRENTLY does not touch the table', 'lib/rules.mjs', '          if (!newHere.has(t)) touch(st);\n        } else', '        } else'],
  ['L7: CREATE TRIGGER does not touch the table', 'lib/rules.mjs', R`trigger\\s+.*?\\bon|drop\\s+trigger`, R`triggerx\\s+.*?\\bon|drop\\s+trigger`],
  // ---- E1
  ['E1: a missing contract header is not an error', 'lib/rules.mjs', 'if (s.refused || !contractOk) flag(', 'if (s.refused) flag('],
  ['E1: a column RENAME with a header passes', 'lib/rules.mjs', 'if (s.refused || !contractOk) flag(', 'if (!contractOk) flag('],
  ['E1: DROP TABLE is not a contract step', 'lib/rules.mjs', "contractSteps.push({ st, kind: 'DROP TABLE' });", ''],
  ['E1: DROP COLUMN is not a contract step', 'lib/rules.mjs', "contractSteps.push({ st, kind: 'DROP COLUMN' });", ''],
  ['E1: a table RENAME is not a contract step', 'lib/rules.mjs', "contractSteps.push({ st, kind: 'RENAME TABLE' });", ';'],
  ['E1: a header may name a file that is not in the folder', 'lib/rules.mjs', 'names.includes(x.m[1]) && ', ''],
  ['E1: a header may name this file or a later one', 'lib/rules.mjs', 'x.m[1] < f.name', 'true'],
  ['E1: DROP TABLE of a table of the same file is a contract step', 'lib/rules.mjs', 'if (newHere.has(t)) { newHere.delete(t); continue; }', 'if (false) { newHere.delete(t); continue; }'],
  ['E1: the tables of earlier files are not tracked (DROP IF EXISTS of a known table passes)', 'lib/rules.mjs', "for (const t of newHere) if (!t.startsWith('temp:') && !newHere.has(`temp:${t}`)) existing.add(t);", ''],
  ['E1: DROP IF EXISTS of an unknown table is a contract step', 'lib/rules.mjs', 'if (ifExists && !existing.has(t)) continue;', ''],
  // ---- C1
  ['C1: a CONCURRENTLY file with no header is not an error', 'lib/rules.mjs', "if (noTxStmts.length && !noTxDirective) flag('C1'", "if (false) flag('C1'"],
  ['C1: a no-transaction file may hold any statement', 'lib/rules.mjs', "if (noTxDirective) for (const s of otherStmts) flag('C1'", "if (false) for (const s of otherStmts) flag('C1'"],
  ['C1: IF NOT EXISTS on a concurrent index is accepted', 'lib/rules.mjs', R`if (/\bif\s+not\s+exists\b/.test(n.slice(0, n.indexOf(' on '))))`, 'if (false)'],
  ['C1: VACUUM does not need the header', 'lib/rules.mjs', R`if (/^vacuum\b/.test(n)) {`, 'if (false) {'],
  ['C1: SET is not allowed in a no-transaction file', 'lib/rules.mjs', R`if (/^(set|reset)\b/.test(n)) continue;`, ''],
  ['C1: DROP INDEX CONCURRENTLY is an ordinary statement', 'lib/rules.mjs', 'if (m[1]) noTxStmts.push(st); else otherStmts.push(st);', 'otherStmts.push(st);'],
  // ---- waivers, the applier wall, the CLI
  ['lint: a waiver covers any line of its rule', 'lint.mjs', 'x.rule === f.rule && x.line === f.line', 'x.rule === f.rule'],
  ['lint: a stale waiver is not an error', 'lint.mjs', 'waivers.filter(w => !used.has(w))', '[]'],
  ['lint: an impossible date is accepted', 'lint.mjs', "new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s", 'true'],
  ['lint: a one-word reason is accepted', 'lint.mjs', 'w.reason.trim().length < 20', 'w.reason.trim().length < 1'],
  ['lint: a duplicate waiver is accepted', 'lint.mjs', 'if (seen.has(key))', 'if (false)'],
  ['lint: an unknown rule id in a waiver is accepted', 'lint.mjs', 'if (!RULE_IDS.includes(w.rule))', 'if (false)'],
  ['lint: a waiver for a file that is not there is accepted', 'lint.mjs', 'if (!fileNames.includes(w.file))', 'if (false)'],
  ['lint: an unknown key in a waiver is accepted', 'lint.mjs', 'if (extra.length)', 'if (false)'],
  ['lint: an open finding does not make the exit code 1', 'lint.mjs', 'r.errors.length ? 2 : r.open.length ||', 'r.errors.length ? 2 :'],
  ['lint: an unreadable file does not make the exit code 2', 'lint.mjs', '(r.errors.length ? 2 :', '(r.errors.length ? 1 :'],
  ['lint: the applier wall never fires', 'lint.mjs', '!APPLIER_MARKER.test(applierText)', 'false'],
  ['lint: a missing applier is a failure of the wall', 'lint.mjs', 'applierText !== null &&', 'true &&'],
  ['lint: an unknown flag is accepted', 'lint.mjs', 'else usage();', 'else {}'],
  ['lint: the waivers are read but never applied (every waiver is stale)', 'lint.mjs', 'const w = wErrors.length === 0 && waivers.find(', 'const w = false && waivers.find('],
];

const jobs = Number(process.env.MUTATE_JOBS) || 4;
const root = mkdtempSync(join(tmpdir(), 'migration-lint-mutate-'));
const cleanup = () => rmSync(root, { recursive: true, force: true });
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

const copyOf = id => { const d = join(root, id, 'migration-lint'); cpSync(TOOL, d, { recursive: true }); return d; };
function runCopy(dir) {
  return new Promise(done => {
    const child = spawn(process.execPath, [join(dir, 'test', 'run.mjs')], { env: { ...process.env, OMNIKOM_MIGRATIONS_DIR: REAL, OMNIKOM_LINT_FAILFAST: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.on('close', code => { clearTimeout(timer); done({ code, out }); });
  });
}

const base = await runCopy(copyOf('baseline'));
if (base.code !== 0) { console.log(`FAIL baseline: the unmutated copy does not pass:\n${base.out.slice(-600)}`); cleanup(); process.exit(1); }
console.log('baseline: the unmutated copy passes');

let caught = 0, survived = 0, notRun = 0, missing = 0, next = 0;
async function worker() {
  while (next < MUTANTS.length) {
    const i = next++;
    const [name, file, target, repl] = MUTANTS[i];
    const dir = copyOf(`m${i}`);
    const path = join(dir, file);
    const text = readFileSync(path, 'utf8');
    const parts = text.split(target);
    if (parts.length !== 2) { missing++; console.log(`MISSING  ${name}: target text found ${parts.length - 1} times (expected 1)`); rmSync(join(root, `m${i}`), { recursive: true, force: true }); continue; }
    writeFileSync(path, parts.join(repl));
    const r = await runCopy(dir);
    rmSync(join(root, `m${i}`), { recursive: true, force: true });
    const fail = (r.out.split('\n').find(l => l.startsWith('FAIL ')) || '').slice(0, 150);
    if (r.code === null) { notRun++; console.log(`NOT RUN  ${name}`); }
    else if (r.code !== 0 && fail) { caught++; console.log(`CAUGHT   ${name}  <- ${fail}`); }
    else { survived++; console.log(`SURVIVED ${name} (exit ${r.code}, ${fail ? 'a FAIL line' : 'no FAIL line'})`); }
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
cleanup();
console.log(`${MUTANTS.length} mutants, ${caught} caught, ${survived} survived, ${notRun} not run, ${missing} target text missing`);
process.exit(caught === MUTANTS.length ? 0 : 1);
