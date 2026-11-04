// Tests for supabase/ops/migration-comment-rehash.mjs (DECISIONS 47 (f)). Pure checks on the comparison, the command line, and the
// --apply path against one throwaway local cluster (cluster.mjs; no account needed).
//   node supabase/ops/test/migration-comment-rehash.test.mjs              the suite
//   node supabase/ops/test/migration-comment-rehash.test.mjs --mutants    the suite, then every MUTANT (one check broken in a copy of the script):
//                                                                         each must make a test fail, for the reason named
//   MIGRATION_REHASH_SCRIPT=<file> node ...                               run the suite against another copy of the script
// Exit 0 = every test passed (and, with --mutants, every mutant was caught).
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { startCluster } from './cluster.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL = resolve(HERE, '..', 'migration-comment-rehash.mjs');
let script = process.env.MIGRATION_REHASH_SCRIPT ? resolve(process.env.MIGRATION_REHASH_SCRIPT) : REAL;   // the script under test
const sha = t => createHash('sha256').update(t).digest('hex');

const work = mkdtempSync(join(tmpdir(), 'omnikom-rehash-test-'));
const NAME = '20260101000009_t.sql';
const OLD = [
  '-- header comment',
  'create table t (',
  '  id int primary key,   -- trailing note',
  "  note text default '-- not a comment'",
  ');',
  '/* block start',
  '   middle line',
  '   block end */',
  'create function f() returns int language sql as $$',
  '  select 1 -- inside a body',
  '$$;',
  'select 2;',
  '',
].join('\n');
const edit = (fn) => { const l = OLD.split('\n'); fn(l); return l.join('\n'); };

const cli = (args, { env = {}, newText = null, oldText = OLD } = {}) => {
  const dir = join(work, 'mig-' + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, NAME), newText ?? OLD);
  writeFileSync(join(dir, 'old.sql'), oldText);
  const r = spawnSync(process.execPath, [script, NAME, '--dir', dir, '--old-file', join(dir, 'old.sql'), ...args], { encoding: 'utf8', timeout: 60000, env: { ...process.env, STAGING_DB_URL: '', PROD_DB_URL: '', ...env } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

async function suite({ integration }) {
  const results = [];
  const t = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });
  const mod = await import(pathToFileURL(script).href + '?v=' + Math.random().toString(36).slice(2));
  const cmp = newText => mod.compare(OLD, newText);
  const refused = (name, newText, lineRe) => { const v = cmp(newText); t(name, v.ok === false && lineRe.test(`line ${v.line}`), JSON.stringify(v)); };

  // passes
  let v = cmp(edit(l => { l[0] = '-- a different header comment'; }));
  t('a comment-only change passes (line 1)', v.ok && v.changed.join() === '1', JSON.stringify(v));
  v = cmp(edit(l => { l[6] = '   another middle line'; }));
  t('a change inside a /* */ block passes', v.ok && v.changed.join() === '7', JSON.stringify(v));
  v = cmp(edit(l => { l[0] = '-- one'; l[6] = '   two'; }));
  t('two comment lines changed pass together', v.ok && v.changed.join() === '1,7', JSON.stringify(v));

  // refusals, each a different way to change more than a comment
  refused('a changed statement is refused', edit(l => { l[11] = 'select 3;'; }), /^line 12$/);
  refused('a whitespace change inside a statement is refused', edit(l => { l[1] = 'create  table t ('; }), /^line 2$/);
  refused('a trailing-comment edit on a code line is refused (the line holds code)', edit(l => { l[2] = '  id int primary key,   -- other note'; }), /^line 3$/);
  refused('a changed string literal that looks like a comment is refused', edit(l => { l[3] = "  note text default '-- other text'"; }), /^line 4$/);
  refused('a changed line inside a dollar-quoted body is refused (the body is stored text)', edit(l => { l[9] = '  select 1 -- inside another body'; }), /^line 10$/);
  refused('an added statement is refused (line count)', OLD + 'select 9;\n', /^line 14$/);
  refused('a removed line is refused (line count)', edit(l => { l.splice(0, 1); }), /^line 13$/);
  refused('a blank line swapped for a comment is refused', edit(l => { l[12] = '-- new last line'; }), /^line 13$/);
  refused('a statement turned into a comment line is refused', edit(l => { l[11] = '-- select 2;'; }), /^line 12$/);
  refused('an opening /* in front of code (a comment that swallows it) is refused', edit(l => { l[0] = '/* header'; }), /^line 2$/);
  refused('a moved line (comment and code swapped) is refused', edit(l => { const a = l[0]; l[0] = l[11]; l[11] = a; }), /^line (1|12)$/);
  refused('a statement hidden after a comment on the same line is refused', edit(l => { l[0] = '-- header comment'; l[11] = '/* x */ select 2;'; }), /^line 12$/);
  v = mod.compare("select 'a\nb' -- note\n", "select 'a\nb' -- other\n");
  t('a trailing comment after the end of a multi-line string is refused (the line holds string text)', v.ok === false && v.line === 2, JSON.stringify(v));
  v = mod.compare(OLD, OLD);
  t('identical texts are refused (nothing to rehash)', v.ok === false && v.line === 0, JSON.stringify(v));
  t('the hash is sha256 of the file text', mod.sha256(OLD) === sha(OLD));
  t('the hash is the one apply-staging.mjs computes', /createHash\('sha256'\)\.update\(text\)\.digest\('hex'\)/.test(readFileSync(resolve(HERE, '..', '..', 'apply-staging.mjs'), 'utf8')));

  // command line
  const good = edit(l => { l[0] = '-- a different header comment'; });
  let r = cli([], { newText: good });
  t('dry run prints both sha256 and comment-only: yes, exit 0', r.code === 0 && r.out.includes(`old sha256:   ${sha(OLD)}`) && r.out.includes(`new sha256:   ${sha(good)}`) && /comment-only: yes/.test(r.out), r.out);
  r = cli([], { newText: edit(l => { l[11] = 'select 3;'; }) });
  t('a refused change exits 1 and names the line, not its text', r.code === 1 && /REFUSED line 12:/.test(r.out) && !r.out.includes('select 3'), r.out);
  r = cli(['--apply'], { newText: good });
  t('--apply without --target staging is refused and writes nothing', r.code === 2 && /--target staging/.test(r.out), r.out);
  r = cli(['--apply', '--target', 'production'], { newText: good });
  t('--target production is refused', r.code === 2 && /--target staging/.test(r.out), r.out);
  r = cli(['--apply', '--target', 'staging'], { newText: good });
  t('--apply without STAGING_DB_URL is refused', r.code === 2 && /STAGING_DB_URL/.test(r.out), r.out);
  r = cli(['--apply', '--target', 'staging'], { newText: good, env: { STAGING_DB_URL: 'postgres://x@127.0.0.1:1/p', PROD_DB_URL: 'postgres://x@127.0.0.1:1/p' } });
  t('a STAGING_DB_URL equal to PROD_DB_URL is refused', r.code === 2 && /PROD_DB_URL/.test(r.out) && !r.out.includes('127.0.0.1:1'), r.out);

  if (integration) {
    const c = startCluster('rehash');
    try {
      c.sql('create schema ops; create table ops.platform_migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now());');
      const row = () => c.scalar(`select sha256 from ops.platform_migrations where name = '${NAME}'`);
      const env = { STAGING_DB_URL: c.url };
      r = cli(['--apply', '--target', 'staging'], { newText: good, env });
      t('--apply on a ledger with no row for the file is refused', r.code === 2 && /no row for/.test(r.out) && row() === '', r.out);
      c.sql(`insert into ops.platform_migrations (name, sha256) values ('${NAME}', '${sha(OLD)}');`);
      r = cli(['--apply', '--target', 'staging'], { newText: edit(l => { l[11] = 'select 3;'; }), env });
      t('--apply with a statement change leaves the ledger alone', r.code === 1 && row() === sha(OLD), r.out + row());
      r = cli(['--apply', '--target', 'staging'], { newText: good, env });
      t('--apply on a comment-only change updates the one row to the new sha256', r.code === 0 && row() === sha(good) && /ledger updated/.test(r.out) && !r.out.includes(c.url), r.out + row());
      r = cli(['--apply', '--target', 'staging'], { newText: good, env });
      t('--apply again says the ledger already holds the new sha256', r.code === 0 && /already holds/.test(r.out) && row() === sha(good), r.out);
      c.sql(`update ops.platform_migrations set sha256 = '${sha('something else')}' where name = '${NAME}';`);
      r = cli(['--apply', '--target', 'staging'], { newText: good, env });
      t('--apply on a ledger that holds neither the old nor the new hash is refused', r.code === 1 && /neither the old/.test(r.out) && row() === sha('something else'), r.out);
    } finally { c.stop(); }
  }
  return results;
}

// Each mutant breaks ONE check in a copy of the script. `from` must exist in the script (a patch that never applied proves nothing).
// The 4th element says the mutant needs the cluster part of the suite (the --apply path).
const MUTANTS = [
  ['the comment test always says comment', [['out.push({ comment: comment && !code });', 'out.push({ comment: true });']], /a changed statement is refused|whitespace change inside a statement|opening \/\* in front of code|statement turned into a comment/],
  ['text inside a string is no longer code (a multi-line string line with a trailing comment)', [['      if (str) {\n        code = true;', '      if (str) {\n        code = false;']], /trailing comment after the end of a multi-line string/],
  ['the line count is not compared', [['if (a.length !== b.length) return', 'if (false) return']], /added statement|removed line/],
  ['an unchanged line is no longer skipped (everything is compared as a comment edit)', [['if (a[i] === b[i]) continue;', '']], /a comment-only change passes|statement is refused/],
  ['a changed code line is let through', [["if (!ka[i].comment) return { ok: false, line: i + 1, why: 'a line that holds code was changed' };", '']], /a changed statement is refused|whitespace change inside a statement/],
  ['the line kind is not compared (a swallowed statement or a statement turned comment is let through)', [['if (ka[i].comment !== kb[i].comment) return', 'if (false) return']], /opening \/\* in front of code|statement turned into a comment|blank line swapped/],
  ['identical texts pass', [['if (changed.length === 0) return', 'if (false) return']], /identical texts are refused/],
  ['-- is not a line comment', [["if (c === '-' && d === '-') { comment = true; i = n; continue; }", '']], /a comment-only change passes/],
  ['/* */ blocks are not comments', [["if (c === '/' && d === '*') { comment = true; depth = 1; i += 2; continue; }", '']], /change inside a \/\* \*\/ block passes/],
  ['the production target is accepted', [["if (after('--target') !== 'staging')", 'if (false)']], /--target production is refused/],
  ['the PROD_DB_URL guard is dropped', [['process.env.PROD_DB_URL && process.env.PROD_DB_URL === url', 'false']], /equal to PROD_DB_URL/],
  ['the ledger hash is not compared with the old hash', [['if (have !== oldSha) {', 'if (false) {']], /neither the old nor the new/, true],
  ['the already-updated case is not recognised', [['if (have === newSha) {', 'if (false) {']], /says the ledger already holds|neither the old nor the new/, true],
  ['a missing ledger row is not refused', [['if (!have) {', 'if (false) {']], /no row for the file is refused/, true],
];

let exit = 0;
try {
  const base = await suite({ integration: true });
  for (const r of base) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : '\n     ' + r.detail.replace(/\n/g, '\n     ')}`);
  const failed = base.filter(r => !r.ok).length;
  console.log(failed ? `\nMIGRATION-COMMENT-REHASH TESTS FAILED: ${failed} of ${base.length}` : `\nMIGRATION-COMMENT-REHASH TESTS OK: ${base.length} checks`);
  if (failed) exit = 1;

  if (process.argv.includes('--mutants') && !exit) {
    const source = readFileSync(script, 'utf8');
    let caught = 0, n = 0;
    for (const [name, pairs, expectRed, needsCluster] of MUTANTS) {
      let text = source, applied = true;
      for (const [from, to] of pairs) {
        if (!text.includes(from)) { console.log(`MISSED  ${name}: the patch did not apply (target text not found: ${from.slice(0, 50)})`); applied = false; break; }
        text = text.split(from).join(to);
      }
      if (!applied) { exit = 1; continue; }
      const copy = join(work, `mutant-${n++}.mjs`);
      writeFileSync(copy, text);
      const real = script; script = copy;
      const res = await suite({ integration: !!needsCluster });
      script = real;
      const red = res.filter(r => !r.ok);
      if (red.some(r => expectRed.test(r.name))) { caught++; console.log(`caught  ${name}  [red: ${red.map(r => r.name.slice(0, 60)).slice(0, 2).join(' | ')}]`); }
      else { exit = 1; console.log(`MISSED  ${name}  (${red.length ? 'red, but not the expected test: ' + red[0].name : 'still green'})`); }
    }
    console.log(exit ? `\nMUTANTS: not all caught (${caught} of ${MUTANTS.length})` : `\nMUTANTS OK: ${caught} of ${MUTANTS.length} caught, each red for the named reason`);
  }
} catch (e) {
  console.error(`test run crashed: ${(e && e.stack) || e}`);
  exit = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(exit);
