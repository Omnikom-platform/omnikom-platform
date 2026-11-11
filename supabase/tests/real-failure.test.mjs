// Unit test of lib/real-failure.mjs: a failing real migration is named by its file and line, with the whole database error.
//   node supabase/tests/real-failure.test.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { whereFailed, failedLine } from './lib/real-failure.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let failed = 0;
const check = (name, ok, seen = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  (seen: ${JSON.stringify(seen).slice(0, 300)})`}`); };

// the joined migrations, as run-local.mjs builds them: a marker line, then the file
const src = ['-- >>> 20260101000001_a.sql', 'create table a (id int);', 'create table b (id int);',
  '-- >>> 20260101000002_b.sql', '-- a comment', 'create function f() returns int language sql as $$ select 1 $$;', 'alter table a add column by text;'].join('\n');
const files = { 'real.sql': { label: 'the migrations', src }, 'tests.sql': { label: 'the tenancy tests', src: null } };

// line 7 of the joined file is line 3 of 20260101000002_b.sql
let out = 'psql:C:/Users/x/AppData/Local/Temp/omnikom-pg-abc/real.sql:7: ERROR:  syntax error at or near "by"\nLINE 1: alter table a add column by text;\n                                 ^\n';
let f = whereFailed(out, files);
check('a migration error names the migration file (Windows path with a drive colon)', f.where === '20260101000002_b.sql', f);
check('and its own line in that file', f.line === 3, f);
check('and keeps the LINE part of the error', /syntax error at or near "by"/.test(f.error) && /LINE 1: alter table a add column by text;/.test(f.error), f.error);
check('the summary line carries name, line and the first error line', failedLine(f) === '20260101000002_b.sql:3: ERROR:  syntax error at or near "by"', failedLine(f));

out = 'NOTICE:  something\npsql:/tmp/omnikom-pg-x/real.sql:2: ERROR:  relation "b" already exists\nDETAIL:  a detail\nHINT:  a hint\nCONTEXT:  SQL statement "create table b (id int)"\nPL/pgSQL function inline_code_block line 3 at SQL statement\n';
f = whereFailed(out, files);
check('a POSIX path works too; joined line 2 is line 1 of the first file (the line after its marker)', f.where === '20260101000001_a.sql' && f.line === 1, f);
check('DETAIL, HINT and CONTEXT stay with the error', /DETAIL:  a detail/.test(f.error) && /HINT:  a hint/.test(f.error) && /CONTEXT:  SQL statement/.test(f.error), f.error);
check('a NOTICE before the error is not part of it', !/NOTICE/.test(f.error), f.error);

out = 'psql:C:/t/omnikom-pg-y/tests.sql:4120: ERROR:  T31d EXPECTED 0 rows, got 1\n';
f = whereFailed(out, files);
check('a tenancy test failure is named as the tenancy tests, with the test file line', f.where === 'the tenancy tests' && f.line === 4120 && /T31d EXPECTED/.test(f.error), f);

f = whereFailed('psql: error: connection to server failed\nis the server running?', files);
check('output with no psql ERROR line still says something (its last lines)', f.where === 'setup' && f.line === null && /connection to server failed/.test(f.error), f);
check('empty output says so', whereFailed('', files).error === '(no output)');

// run-local.mjs uses it and prints it last, next to the summary
const rl = readFileSync(join(HERE, 'run-local.mjs'), 'utf8');
check('run-local.mjs names a failing real migration with whereFailed', /realFail = whereFailed\(real\.out, \{ 'real\.sql': \{ label: 'the migrations', src \}/.test(rl));
check('run-local.mjs prints it after every other line, in the summary too', rl.lastIndexOf('FAIL real migration in ') > rl.lastIndexOf("left = (q.stdout ?? '').trim();") && /fails\$\{realFail \? ` \(\$\{failedLine\(realFail\)\}\)` : ''\}/.test(rl));

console.log(`\n${failed ? 'FAILED' : 'OK'}: real-failure ${failed} problem(s)`);
process.exit(failed ? 1 : 0);
