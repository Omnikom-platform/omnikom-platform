// Tests for tools/migration-lint (book row E19). No cluster, no network: pure functions over text, and the CLI as a child process.
//   node tools/migration-lint/test/run.mjs          exit 0 = every check PASS, 1 = any FAIL
// OMNIKOM_MIGRATIONS_DIR: the real migrations folder (the mutation runner runs a COPY of this tool, which is not inside the repo).
// OMNIKOM_LINT_FAILFAST=1: stop at the first FAIL (the mutation runner; the FAIL line is still printed).
// Fixtures (test/fixtures/<RULE>-red|green-<case>.sql): a case is linted as the second file after base.sql, which makes accounts and
// orders exist. A red fixture must produce findings of exactly its rule id; a green one none. GEN-green-*: the scanner must not read
// comments, strings or function bodies as statements.
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/scan.mjs';
import { RULE_IDS, RULES } from '../lib/rules.mjs';
import { lintAll, lintFolder, report, exitCode, checkWaivers } from '../lint.mjs';
import { TARGET, REPLACEMENT, patchApplier } from '../lib/apply-patch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = resolve(HERE, '..');
const REAL_DIR = process.env.OMNIKOM_MIGRATIONS_DIR ? resolve(process.env.OMNIKOM_MIGRATIONS_DIR) : resolve(TOOL, '..', '..', 'supabase', 'migrations');
const FIX = join(HERE, 'fixtures');
const FAILFAST = process.env.OMNIKOM_LINT_FAILFAST === '1';
let failed = 0, total = 0;
const check = (name, ok, detail = '') => {
  total++;
  if (ok) { console.log(`PASS ${name}`); return; }
  failed++; console.log(`FAIL ${name}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`);
  if (FAILFAST) { console.log(`migration-lint tests: ${failed} FAIL of ${total} (stopped at the first)`); process.exit(1); }
};
const cli = (args, opts = {}) => spawnSync(process.execPath, [join(TOOL, 'lint.mjs'), ...args], { encoding: 'utf8', timeout: 60000, ...opts });

// ---------------------------------------------------------------------------------------------------------- the scanner
{
  const st = t => { try { return scan(t).statements.map(s => s.norm); } catch (e) { return [`THROWS: ${e.message}`]; } };   // a scanner that throws must FAIL a check, not crash the run
  check('scan: a semicolon inside a string does not split', JSON.stringify(st("select 'a;b'; select 2;")) === JSON.stringify(["select ''", 'select 2']), JSON.stringify(st("select 'a;b'; select 2;")));
  check("scan: '' inside a string is an escaped quote", st("select 'it''s; fine'; select 2") .length === 2);
  check("scan: a doubled quote stays inside one string (one '' in norm, not four)", JSON.stringify(st("select 'it''s'")) === JSON.stringify(["select ''"]), JSON.stringify(st("select 'it''s'")));
  check('scan: an E string honours backslash-quote', st("select E'it\\'s; fine'; select 2").length === 2);
  check('scan: a plain string does not treat backslash as an escape', st("select 'a\\'; select 2").length === 2);
  check('scan: line and nested block comments are dropped', JSON.stringify(st('select 1 -- x;\n/* a /* b */ c; */ ; select 2')) === JSON.stringify(['select 1', 'select 2']), JSON.stringify(st('select 1 -- x;\n/* a /* b */ c; */ ; select 2')));
  check('scan: a dollar-quoted body is one token, with a tag too', st('create function f() as $a$ x; $$ y; $a$; select 2').length === 2);
  check('scan: a $1 parameter is not a dollar quote', st('select $1; select 2').length === 2);
  check('scan: the body of a dollar quote is kept for a DO block', scan('do $$ begin select 1; end $$').statements[0].dollars[0].body.includes('select 1'));
  check('scan: statement lines are the line of the first token', JSON.stringify(scan('\n\nselect 1;\n  select 2;').statements.map(s => s.line)) === '[3,4]');
  check('scan: norm is lower case with single spaces; raw keeps the literal', (() => { const s = scan("SELECT   'X'\n FROM t").statements[0]; return s.norm === "select '' from t" && s.raw.includes("'X'"); })());
  check('scan: a block comment ends the header (the applier reads only leading -- lines)', scan('/* x */\n-- no-transaction\nselect 1;').header.length === 0);
  check('scan: the header is the comment lines before the first token only', (() => { const h = scan('-- a\n\n-- b\nselect 1;\n-- c\n').header.map(x => x.text.trim()); return JSON.stringify(h) === '["a","b"]'; })());
  for (const [what, text] of [['an unterminated string', "select 'abc"], ['an unterminated block comment', 'select 1 /* x'], ['an unterminated dollar quote', 'select $$ x'], ['an unterminated quoted identifier', 'select "abc'], ['BEGIN ATOMIC', 'create function f() returns int language sql begin atomic select 1; end']]) {
    check(`scan: ${what} throws (fails closed)`, (() => { try { scan(text); return false; } catch { return true; } })());
  }
}

// ---------------------------------------------------------------------------------------------------------- the fixtures
const all = readdirSync(FIX).filter(f => f.endsWith('.sql')).sort();
const baseText = readFileSync(join(FIX, 'base.sql'), 'utf8');
const BASE_NAME = '20260101000001_base.sql';
const lintCase = (name, text, waivers = []) => lintAll([{ name: BASE_NAME, text: baseText }, { name: `20260102000000_${name}.sql`, text }], waivers);
{
  const b = lintAll([{ name: BASE_NAME, text: baseText }], []);
  check('fixtures: base.sql alone has no finding and creates accounts and orders', b.open.length === 0 && b.existing.includes('public.accounts') && b.existing.includes('public.orders'), JSON.stringify(b.existing));
  const cases = all.filter(f => f !== 'base.sql').map(f => f.replace(/\.sql$/, ''));
  for (const id of RULE_IDS) {
    check(`fixtures: rule ${id} has at least one red and one green fixture`, cases.some(c => c.startsWith(`${id}-red-`)) && cases.some(c => c.startsWith(`${id}-green-`)), cases.filter(c => c.startsWith(id)).join(' '));
  }
  for (const c of cases) {
    const m = /^(L[1-7]|E1|C1|GEN)-(red|green)-/.exec(c);
    if (!m) { check(`fixtures: ${c} is named <RULE>-red|green-<case>`, false); continue; }
    const r = lintCase(c, readFileSync(join(FIX, `${c}.sql`), 'utf8'));
    const rules = [...new Set(r.open.map(f => f.rule))].sort();
    if (m[2] === 'red') {
      check(`${c}: RED with exactly ${m[1]} (${r.open.map(f => `${f.rule}@${f.line}`).join(' ')})`, r.errors.length === 0 && JSON.stringify(rules) === JSON.stringify([m[1]]), `${rules.join(',') || 'no finding'} ${r.errors.join(' ')}`);
    } else {
      check(`${c}: GREEN, no finding`, r.errors.length === 0 && r.open.length === 0, r.open.map(f => `${f.rule}@${f.line} ${f.detail}`).join('; ') + r.errors.join(' '));
    }
  }
}

// a few reds pinned to the line and the message, so a rule that flags the wrong statement is caught too
{
  const one = (c) => lintCase(c, readFileSync(join(FIX, `${c}.sql`), 'utf8')).open;
  const at = (c, rule) => one(c).filter(f => f.rule === rule).map(f => f.line);
  check('L1-red-index: the finding is on line 2, the CREATE INDEX', JSON.stringify(at('L1-red-index', 'L1')) === '[2]', JSON.stringify(at('L1-red-index', 'L1')));
  check('L7-red-timeout-after: the finding is on the first touching statement (line 1)', JSON.stringify(at('L7-red-timeout-after', 'L7')) === '[1]');
  check('L7-red-in-do-block: the finding is inside the DO block (line 2)', JSON.stringify(at('L7-red-in-do-block', 'L7')) === '[2]', JSON.stringify(at('L7-red-in-do-block', 'L7')));
  check('L5-red-uuid-default: the message names the volatile function', one('L5-red-uuid-default')[0].detail.includes('gen_random_uuid'));
  check('E1-red-drop-column-and-more: E1-green-with-header would report 3 contract steps if the header were removed', (() => {
    const t = readFileSync(join(FIX, 'E1-green-with-header.sql'), 'utf8').split('\n').slice(1).join('\n');
    return lintCase('x', t).open.filter(f => f.rule === 'E1').length === 3;
  })());
  check('E1-red-rename-column-even-with-header: the message says it is refused outright', one('E1-red-rename-column-even-with-header')[0].detail.includes('refused outright'));
  check('L3-green-validated-check: without the VALIDATE statement the SET NOT NULL is flagged (the proof of the scan-skip is the validate)', (() => {
    const t = readFileSync(join(FIX, 'L3-green-validated-check.sql'), 'utf8').replace('alter table accounts validate constraint accounts_email_nn;\n', '');
    return lintCase('x', t).open.some(f => f.rule === 'L3');
  })());
  check('L3-green-validated-check: a check on another column proves nothing', (() => {
    const t = readFileSync(join(FIX, 'L3-green-validated-check.sql'), 'utf8').replace('(email is not null)', '(note is not null)');
    return lintCase('x', t).open.some(f => f.rule === 'L3');
  })());
  check('tables: a table dropped in one migration and created again in a later one is existing again, not new', (() => {
    const r = lintAll([{ name: BASE_NAME, text: baseText }, { name: '20260102000000_a.sql', text: `${'set lock_timeout = \'5s\';'}\ndrop table orders;\n` }, { name: '20260103000000_b.sql', text: 'create table orders (id int);\n' }, { name: '20260104000000_c.sql', text: "set lock_timeout = '5s';\ncreate index on orders (id);\n" }], []);
    return r.open.some(f => f.file === '20260104000000_c.sql' && f.rule === 'L1');
  })());
  check('tables: a vendor table the folder never created counts as existing (L1 on auth.users)', lintCase('x', "set lock_timeout = '5s';\ncreate index on auth.users (email);\n").open.some(f => f.rule === 'L1'));
  check('tables: a temporary table is never existing in a later file', (() => {
    const r = lintAll([{ name: BASE_NAME, text: baseText }, { name: '20260102000000_a.sql', text: 'create temp table tmp1 (id int);\ncreate index on tmp1 (id);\n' }], []);
    return r.open.length === 0 && !r.existing.includes('public.tmp1');
  })());
}

// ---------------------------------------------------------------------------------------------------------- the real folder and its waivers
const WAIVERS = join(TOOL, 'waivers.json');
const waivers = JSON.parse(readFileSync(WAIVERS, 'utf8'));
const realFiles = readdirSync(REAL_DIR).filter(f => f.endsWith('.sql')).sort().map(name => ({ name, text: readFileSync(join(REAL_DIR, name), 'utf8') }));
{
  const r = lintAll(realFiles, waivers);
  check(`real folder: ${realFiles.length} migrations scan without error`, r.errors.length === 0, r.errors.join('; '));
  check(`real folder: every finding is waived (${r.waived.length} waived), none open, no waiver problem`, r.open.length === 0 && r.waiverErrors.length === 0, [...r.open.map(f => `${f.file}:${f.line} ${f.rule}`), ...r.waiverErrors].join('; '));
  check('real folder: the waivers are exactly the findings (as many waivers as findings)', r.waived.length === waivers.length, `${r.waived.length} waived, ${waivers.length} waivers`);
  const bare = lintAll(realFiles, []);
  check('real folder: with no waiver at all the lint is red (it finds something)', bare.open.length > 0 && bare.open.length === waivers.length, `${bare.open.length} findings, ${waivers.length} waivers`);
  for (let i = 0; i < waivers.length; i++) {
    const w = waivers[i];
    const without = lintAll(realFiles, waivers.filter((_, j) => j !== i));
    check(`waiver ${w.file}:${w.line} ${w.rule}: removed, exactly that finding goes red`, without.open.length === 1 && without.open[0].file === w.file && without.open[0].line === w.line && without.open[0].rule === w.rule, without.open.map(f => `${f.file}:${f.line} ${f.rule}`).join(' '));
  }
  check('waivers: each has a real date, a reason of at least 20 characters, and the file exists', checkWaivers(waivers, realFiles.map(f => f.name)).length === 0, checkWaivers(waivers, realFiles.map(f => f.name)).join('; '));
  check('waivers: no waiver is dated in the future', waivers.every(w => w.date <= new Date().toISOString().slice(0, 10)));
  const w0 = waivers[0];
  const bad = (mut) => lintAll(realFiles, [{ ...w0, ...mut }, ...waivers.slice(1)]);
  check('waivers: a stale waiver (matches no finding) is an error', lintAll(realFiles, [...waivers, { file: realFiles[0].name, rule: 'L7', line: 1, date: '2026-11-10', reason: 'nothing matches this one at all' }]).waiverErrors.some(e => /stale waiver/.test(e)));
  check('waivers: a waiver on the wrong line does not cover the finding', (() => { const r = bad({ line: w0.line + 1 }); return r.open.some(f => f.file === w0.file && f.line === w0.line); })());
  check('waivers: a waiver for another rule does not cover the finding', (() => { const r = bad({ rule: w0.rule === 'L7' ? 'L1' : 'L7' }); return r.open.some(f => f.file === w0.file && f.line === w0.line); })());
  check('waivers: a short reason is refused', bad({ reason: 'ok' }).waiverErrors.some(e => /reason/.test(e)));
  check('waivers: an impossible date is refused', bad({ date: '2026-02-31' }).waiverErrors.some(e => /date/.test(e)));
  check('waivers: an unknown rule id is refused', bad({ rule: 'L99' }).waiverErrors.some(e => /not a rule id/.test(e)));
  check('waivers: a file that is not in the folder is refused', bad({ file: '20990101000000_none.sql' }).waiverErrors.some(e => /not in the migrations folder/.test(e)));
  check('waivers: an extra key is refused', bad({ blanket: true }).waiverErrors.some(e => /unknown key/.test(e)));
  check('waivers: a duplicate is refused', lintAll(realFiles, [...waivers, w0]).waiverErrors.some(e => /second waiver/.test(e)));
  check('waivers: a wildcard line is refused (a waiver is one finding)', bad({ line: '*' }).waiverErrors.some(e => /line/.test(e)));
  check('waivers: a file that is not an array is refused', checkWaivers({}, []).length === 1);
}

// ---------------------------------------------------------------------------------------------------------- the CLI
{
  const tmp = mkdtempSync(join(tmpdir(), 'migration-lint-test-'));
  try {
    const put = (dir, files) => { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, n), t); return dir; };
    const red = put(join(tmp, 'red'), { [BASE_NAME]: baseText, '20260102000000_x.sql': readFileSync(join(FIX, 'L1-red-index.sql'), 'utf8') });
    const green = put(join(tmp, 'green'), { [BASE_NAME]: baseText, '20260102000000_x.sql': readFileSync(join(FIX, 'L1-green-concurrently.sql'), 'utf8') });
    const broken = put(join(tmp, 'broken'), { [BASE_NAME]: baseText, '20260102000000_x.sql': "select 'never closed;" });
    const none = join(tmp, 'waivers-none.json'); writeFileSync(none, '[]');
    const waive = join(tmp, 'waivers-one.json'); writeFileSync(waive, JSON.stringify([{ file: '20260102000000_x.sql', rule: 'L1', line: 2, date: '2026-11-10', reason: 'a test waiver that is long enough' }]));
    let r = cli(['--dir', red, '--waivers', none]);
    check('cli: a red folder exits 1 and prints FAIL <file>:<line> <rule> with the safe alternative', r.status === 1 && /^FAIL 20260102000000_x\.sql:2 L1 /m.test(r.stdout) && /Safe: CREATE \[UNIQUE\] INDEX CONCURRENTLY/.test(r.stdout), r.stdout + r.stderr);
    r = cli(['--dir', green, '--waivers', none]);
    check('cli: a green folder exits 0', r.status === 0 && /0 finding\(s\)/.test(r.stdout), r.stdout + r.stderr);
    r = cli(['--dir', red, '--waivers', waive]);
    check('cli: a waived finding exits 0 and prints WAIVED', r.status === 0 && /^WAIVED 20260102000000_x\.sql:2 L1 \(waiver 2026-11-10\)/m.test(r.stdout), r.stdout + r.stderr);
    r = cli(['--dir', green, '--waivers', waive]);
    check('cli: a waiver that matches nothing exits 1 (stale)', r.status === 1 && /stale waiver/.test(r.stdout), r.stdout + r.stderr);
    r = cli(['--dir', broken, '--waivers', none]);
    check('cli: a file that cannot be scanned exits 2 (fails closed, not a pass)', r.status === 2 && /ERROR 20260102000000_x\.sql: line 1: a string literal is never closed/.test(r.stdout), r.stdout + r.stderr);
    r = cli(['--dir', join(tmp, 'nope')]);
    check('cli: a missing folder exits 2', r.status === 2 && /no migrations folder/.test(r.stderr), r.stderr);
    r = cli(['--bogus']);
    check('cli: an unknown flag exits 2 with the usage line', r.status === 2 && /usage:/.test(r.stderr), r.stderr);
    r = cli(['--dir']);
    check('cli: --dir without a value exits 2', r.status === 2, r.stderr);
    r = cli(['--dir', red, '--waivers', none, '--json']);
    check('cli: --json prints the open findings as JSON and still exits 1', (() => { try { const j = JSON.parse(r.stdout); return r.status === 1 && j.open.length === 1 && j.open[0].rule === 'L1'; } catch { return false; } })(), r.stdout.slice(0, 200));
    // the applier wall: a "-- no-transaction" file while apply-staging.mjs cannot run it
    const nt = put(join(tmp, 'notx'), { [BASE_NAME]: baseText, '20260102000000_x.sql': readFileSync(join(FIX, 'L1-green-concurrently.sql'), 'utf8') });
    const oldApplier = join(tmp, 'apply-old.mjs'); writeFileSync(oldApplier, "// begin;\\n${text}\\ncommit;\n");
    const newApplier = join(tmp, 'apply-new.mjs'); writeFileSync(newApplier, "// a file whose header holds `-- no-transaction` runs outside a transaction\n");
    r = cli(['--dir', nt, '--waivers', none, '--applier', oldApplier]);
    check('applier: a no-transaction file with an applier that cannot run it exits 1 and names the file', r.status === 1 && /^FAIL C1 20260102000000_x\.sql carries "-- no-transaction" but the applier/m.test(r.stdout), r.stdout + r.stderr);
    r = cli(['--dir', nt, '--waivers', none, '--applier', newApplier]);
    check('applier: the same folder with an applier that handles the header exits 0', r.status === 0 && /0 applier problem\(s\)/.test(r.stdout), r.stdout + r.stderr);
    const plain = put(join(tmp, 'plain'), { [BASE_NAME]: baseText, '20260102000000_x.sql': readFileSync(join(FIX, 'L2-green-not-valid.sql'), 'utf8') });
    r = cli(['--dir', plain, '--waivers', none, '--applier', oldApplier]);
    check('applier: a folder with no no-transaction file does not care about the applier', r.status === 0, r.stdout + r.stderr);
    r = cli(['--dir', nt, '--waivers', none]);
    check('applier: no applier next to the folder (and none given) means the wall is not checked, not failed', r.status === 0, r.stdout + r.stderr);
    r = cli(['--dir', REAL_DIR]);
    check('cli: the real folder with the real waivers exits 0', r.status === 0 && new RegExp(`${realFiles.length} files, 0 finding\\(s\\), ${waivers.length} waived, 0 waiver problem\\(s\\), 0 applier problem\\(s\\), 0 unreadable`).test(r.stdout), r.stdout.split('\n').slice(-3).join(' | ') + r.stderr);
    check('cli: lintFolder and report agree with the CLI on the real folder', (() => { const x = lintFolder(REAL_DIR, WAIVERS); return exitCode(x) === 0 && report(x).trim().split('\n').pop() === cli(['--dir', REAL_DIR]).stdout.trim().split('\n').pop(); })());
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
// ---------------------------------------------------------------------------------------------------------- the applier finding
{
  const finding = readFileSync(join(TOOL, 'FINDING-apply-staging.md'), 'utf8');
  check('finding: FINDING-apply-staging.md quotes the patch target and replacement verbatim (the doc and the proof cannot drift)', finding.includes(TARGET) && finding.includes(REPLACEMENT));
  const applier = join(REAL_DIR, '..', 'apply-staging.mjs');
  if (existsSync(applier)) {
    const text = readFileSync(applier, 'utf8');
    if (/no-transaction/.test(text)) check('finding: apply-staging.mjs already handles -- no-transaction', true);
    else {
      let patched = null, err = '';
      try { patched = patchApplier(text); } catch (e) { err = e.message; }
      check('finding: the patch applies to the real apply-staging.mjs exactly once, and the result parses', (() => {
        if (patched === null) return false;
        const d = mkdtempSync(join(tmpdir(), 'migration-lint-patch-'));
        try { writeFileSync(join(d, 'apply.mjs'), patched); return spawnSync(process.execPath, ['--check', join(d, 'apply.mjs')], { timeout: 30000 }).status === 0; } finally { rmSync(d, { recursive: true, force: true }); }
      })(), err || 'node --check failed');
      console.log('NOTE apply-staging.mjs does not run "-- no-transaction" files yet: the lint refuses such a file until the platform department lands tools/migration-lint/FINDING-apply-staging.md');
    }
  }
  check('finding: patchApplier refuses a text that does not hold its target exactly once (a patch that did not apply is not a pass)', (() => { try { patchApplier('nothing here'); return false; } catch { return true; } })() && (() => { try { patchApplier(TARGET + TARGET); return false; } catch { return true; } })());
  check('finding: the patched block is the header rule of the lint (a regex over the leading -- lines)', (() => {
    const re = /^\s*--\s*no-transaction\s*$/m, lead = t => (t.match(/^(?:[ \t\r]*(?:--[^\n]*)?\n)*/) || [''])[0];
    const yes = ['-- no-transaction\nselect 1;', '-- a\n\n-- no-transaction\r\nselect 1;', '\n-- no-transaction\nselect 1;'];
    const no = ['select 1;\n-- no-transaction\n', '/* x */\n-- no-transaction\nselect 1;', '-- no-transactions\nselect 1;', '-- no-transaction: because\nselect 1;'];
    return yes.every(t => re.test(lead(t)) && scan(t).header.some(h => /^\s*no-transaction\s*$/.test(h.text))) && no.every(t => !re.test(lead(t)) && !scan(t).header.some(h => /^\s*no-transaction\s*$/.test(h.text)));
  })());
}
check('rules: every rule states a reason and a safe alternative (the message teaches the fix)', RULE_IDS.every(id => RULES[id].reason.length > 30 && RULES[id].safe.length > 30));
check('no em dash in this tool (CLAUDE.md)', (() => {
  const dash = String.fromCharCode(0x2014);
  const files = [join(TOOL, 'lint.mjs'), join(TOOL, 'lib', 'scan.mjs'), join(TOOL, 'lib', 'rules.mjs'), WAIVERS, join(TOOL, 'README.md'), ...all.map(f => join(FIX, f))].filter(existsSync);
  return files.every(f => !readFileSync(f, 'utf8').includes(dash));
})());

console.log(`migration-lint tests: ${failed} FAIL of ${total}`);
process.exit(failed ? 1 : 0);
