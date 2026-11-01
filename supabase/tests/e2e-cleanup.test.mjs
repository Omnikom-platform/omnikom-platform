// Unit test of the e2e cleanup (slice 5.2b), no staging, no network. Three layers, each watched red by a mutant at the end of this file:
//   A. e2e-cleanup.mjs itself: every tracked row is removed even after a thrown assertion, a failing removal does not stop the next, nothing
//      untracked is touched, the SQL is service.unpublish(.., true) as owner-a, a row that is not gone afterwards is a failure, staging only.
//   B. the three scripts that create content rows (e2e-functions, e2e-export, e2e-screens) track what their save creates and run the cleanup
//      in a finally; any e2e-*.mjs that saves with row: null must do the same.
//   C. those scripts refuse to start (exit 3, BLOCKED, before any call) when there is no staging database to clean up with.
//   node supabase/tests/e2e-cleanup.test.mjs      exit 0 = real code green AND every mutant caught
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { claimsFor, parseIdentity } from '../../tools/omnikom-cli/lib/identity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPER = join(HERE, 'e2e-cleanup.mjs');
const SCRIPTS = ['e2e-functions.mjs', 'e2e-export.mjs', 'e2e-screens.mjs'];
const ID1 = '11111111-1111-4111-8111-111111111111', ID2 = '22222222-2222-4222-8222-222222222222', ID3 = '33333333-3333-4333-8333-333333333333';

// ---- A. the module
async function checkModule(mod) {
  const bad = [];
  const expect = (ok, what) => { if (!ok) bad.push(what); };
  const make = remove => { const lines = []; return { lines, c: mod.createCleanup({ remove, report: (ok, name, detail) => lines.push({ ok, name, detail }) }) }; };

  // the shape every script has: track after the save, assertion throws, finally runs the cleanup
  { const gone = []; const { c, lines } = make(async id => { gone.push(id); return { ok: true }; });
    try { c.track(ID1); c.track(ID2); throw new Error('an assertion threw'); } catch { /* the script's catch */ } finally { await c.run(); }
    expect(gone.length === 2 && gone.includes(ID1) && gone.includes(ID2), 'after a thrown assertion both tracked rows are removed');
    expect(lines.length === 2 && lines.every(l => l.ok), 'and each removal is reported as a PASS line'); }
  // a failing removal is reported and does not stop the next one
  { const gone = []; const { c, lines } = make(async id => { gone.push(id); return id === ID2 ? { ok: false, message: 'S-NOT-FOUND' } : { ok: true }; });
    c.track(ID1); c.track(ID2); c.track(ID3);
    const r = await c.run();
    expect(gone.length === 3, 'a failed removal does not stop the others');
    expect(r.removed === 2 && r.failed === 1, `counts are 2 removed, 1 failed (got ${JSON.stringify(r)})`);
    expect(lines.filter(l => !l.ok).length === 1 && /S-NOT-FOUND/.test(lines.find(l => !l.ok).detail), 'the failure is reported with its reason'); }
  // a removal that throws, and a report that throws
  { const { c } = make(async () => { throw new Error('connection lost'); });
    c.track(ID1);
    let threw = false, r; try { r = await c.run(); } catch { threw = true; }
    expect(!threw && r.failed === 1, 'run() never throws: a throwing removal counts as failed'); }
  { const gone = []; const c = mod.createCleanup({ remove: async id => { gone.push(id); return { ok: true }; }, report: () => { throw new Error('report broke'); } });
    c.track(ID1); c.track(ID2); await c.run();
    expect(gone.length === 2, 'a throwing report does not stop the next removal'); }
  // once only; untracked rows are never touched
  { const gone = []; const { c } = make(async id => { gone.push(id); return { ok: true }; });
    c.track(ID1); c.track(ID1); c.track(null); c.track(undefined); c.track('');
    await c.run(); await c.run();
    expect(gone.length === 1 && gone[0] === ID1, 'a row is tracked once, empty ids are ignored, a second run() removes nothing again');
    expect(!gone.includes(ID2), 'a row that was only edited (never tracked) is never removed'); }

  // the staging remover: the SQL it sends and how it judges the answer
  const sent = [];
  const fakeSpawn = answer => (cmd, args, opts) => { sent.push(String(opts && opts.input)); return answer(String(opts && opts.input)); };
  const sqlOk = fakeSpawn(input => ({ status: 0, stdout: /deleted_at is not null/.test(input) ? '[{"gone":true}]\n' : '', stderr: '' }));
  { sent.length = 0; const rm = mod.stagingRemover({ url: 'postgresql://postgres.stagingref:pw@db.stagingref.supabase.co:5432/postgres', spawn: sqlOk });
    const r = await rm(ID1);
    const first = sent[0] || '';
    expect(r.ok === true, `a removal whose read back shows deleted_at set is ok (got ${JSON.stringify(r)})`);
    expect(first.includes('service.unpublish(') && first.includes(`'${ID1}'::uuid`) && /,\s*true\)\s*;/.test(first), 'the statement is service.unpublish(claims, row, true): the soft delete, not a plain unpublish');
    expect(first.includes(JSON.stringify(claimsFor(parseIdentity('owner-a')))), 'it runs with owner-a\'s claims'); }
  { const rm = mod.stagingRemover({ url: 'postgresql://u:p@h:5432/d', spawn: fakeSpawn(input => ({ status: 0, stdout: /deleted_at is not null/.test(input) ? '[{"gone":false}]\n' : '', stderr: '' })) });
    const r = await rm(ID1);
    expect(r.ok === false && /deleted_at/.test(r.message), 'a row that is not deleted afterwards is a failure, not a pass'); }
  { const rm = mod.stagingRemover({ url: 'postgresql://u:p@h:5432/d', spawn: fakeSpawn(() => ({ status: 1, stdout: '', stderr: 'ERROR:  S-NOT-FOUND: not found' })) });
    const r = await rm(ID1);
    expect(r.ok === false && /S-NOT-FOUND/.test(r.message), 'a refusal from the database comes back as a failure with its code'); }
  { const rm = mod.stagingRemover({ url: 'postgresql://u:p@h:5432/d', spawn: sqlOk });
    const r = await rm('not-a-uuid').then(x => x, e => ({ ok: false, message: String(e.message) }));
    expect(r.ok === false, 'an id that is not a uuid never reaches the database'); }

  // staging only
  const env = { STAGING_SUPABASE_REF: 'stagingref', STAGING_DB_URL: 'postgresql://postgres.stagingref:pw@aws-0.pooler.supabase.com:5432/postgres' };
  const fails = (e, re) => { try { mod.stagingDbUrl(e); return false; } catch (x) { return re.test(String(x.message)); } };
  expect(mod.stagingDbUrl(env) === env.STAGING_DB_URL, 'the staging connection string is accepted');
  expect(fails({ STAGING_SUPABASE_REF: 'stagingref' }, /^BLOCKED.*STAGING_DB_URL/), 'no STAGING_DB_URL is BLOCKED');
  expect(fails({ ...env, STAGING_DB_URL: 'postgresql://postgres.otherref:pw@db.otherref.supabase.co:5432/postgres' }, /^REFUSED.*does not name the staging project/), 'a connection string of another project is REFUSED');
  expect(fails({ ...env, PROD_DB_URL: env.STAGING_DB_URL }, /^REFUSED.*PROD_DB_URL/), 'a staging string equal to PROD_DB_URL is REFUSED');
  return bad;
}

// ---- B. the scripts' wiring (on source text)
// The text of every `finally { ... }` block, by counting braces (the scripts keep no unbalanced brace inside a finally).
function finallyBlocks(text) {
  const out = [];
  for (const m of text.matchAll(/\bfinally\s*\{/g)) {
    let depth = 1, i = m.index + m[0].length;
    for (; i < text.length && depth > 0; i++) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; }
    out.push(text.slice(m.index + m[0].length, i - 1));
  }
  return out;
}
function checkWiring(sources) {
  const bad = [];
  for (const [name, text] of Object.entries(sources)) {
    const creates = /row:\s*null/.test(text);
    if (SCRIPTS.includes(name) && !creates) bad.push(`${name}: no longer saves a new row; update this test's list`);
    if (!creates) continue;
    if (!/from '\.\/e2e-cleanup\.mjs'/.test(text)) bad.push(`${name}: does not import e2e-cleanup.mjs`);
    if (!/cleanup\.track\(/.test(text)) bad.push(`${name}: saves a new row (row: null) and never tracks it`);
    if (!/stagingDbUrl\(process\.env\)/.test(text)) bad.push(`${name}: does not require the staging database before creating a row`);
    if (!finallyBlocks(text).some(b => /\bawait cleanup\.run\(\)/.test(b))) bad.push(`${name}: does not run the cleanup (await cleanup.run()) inside a finally block`);
    // the track must come right where the save answers, before the first assertion line about it
    const t = text.search(/cleanup\.track\(/), a = text.search(/stagingRemover\(/);
    if (a < 0 || t < a) bad.push(`${name}: the cleanup is not created before the first track`);
  }
  return bad;
}

// ---- C. the scripts refuse to start without a database (really run, the unmutated files only: a mutant must never reach the network)
function checkRefusals() {
  const bad = [];
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, STAGING_SUPABASE_REF: 'e2etestref', RUNNER_KEY: 'x' };
  for (const name of SCRIPTS) {
    const r = spawnSync(process.execPath, [join(HERE, name)], { env, encoding: 'utf8', timeout: 30000, cwd: resolve(HERE, '..', '..') });
    if (r.status !== 3 || !/BLOCKED.*STAGING_DB_URL/.test(r.stderr || '')) bad.push(`${name}: without STAGING_DB_URL expected exit 3 and BLOCKED, got exit ${r.status}: ${String(r.stderr || r.stdout).trim().slice(0, 160)}`);
  }
  return bad;
}

// ---- mutants
function mutate(text, from, to, what) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`mutant "${what}": the target text was found ${n} times (the patch would not apply): ${from.slice(0, 50)}`);
  return text.split(from).join(to);
}
async function loadMutantModule(text, dir, tag) {
  const abs = rel => pathToFileURL(resolve(HERE, rel)).href;
  const fixed = text.split("'../../tools/omnikom-cli/lib/sql.mjs'").join(`'${abs('../../tools/omnikom-cli/lib/sql.mjs')}'`)
    .split("'../../tools/omnikom-cli/lib/identity.mjs'").join(`'${abs('../../tools/omnikom-cli/lib/identity.mjs')}'`);
  const file = join(dir, `mutant-${tag}.mjs`);
  writeFileSync(file, fixed);
  return import(pathToFileURL(file).href);
}

const helperText = readFileSync(HELPER, 'utf8');
const sources = Object.fromEntries(readdirSync(HERE).filter(f => /^e2e-.*\.mjs$/.test(f) && !/cleanup/.test(f)).map(f => [f, readFileSync(join(HERE, f), 'utf8')]));
let exit = 0;
const say = (ok, text) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${text}`); if (!ok) exit = 1; };

const real = await import(pathToFileURL(HELPER).href);
const realA = await checkModule(real), realB = checkWiring(sources), realC = checkRefusals();
for (const b of [...realA, ...realB, ...realC]) console.log(`  problem: ${b}`);
say(realA.length === 0, `A. e2e-cleanup.mjs: ${realA.length} problem(s)`);
say(realB.length === 0, `B. wiring of ${Object.keys(sources).filter(f => /row:\s*null/.test(sources[f])).length} scripts that create rows: ${realB.length} problem(s)`);
say(realC.length === 0, `C. ${SCRIPTS.length} scripts refuse to start without STAGING_DB_URL: ${realC.length} problem(s)`);

if (realA.length + realB.length + realC.length) { console.log('\nFAILED: the real code is red, so the mutants below would prove nothing; they were not run'); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), 'omnikom-e2e-cleanup-'));
const mutants = [
  ['module', 'run() removes nothing', t => mutate(t, 'r = await remove(id);', 'r = { ok: true };', 'run removes nothing')],
  ['module', 'run() can run twice', t => mutate(t, '      done = true;\n', '', 'run twice')],
  ['module', 'a failure is counted as removed', t => mutate(t, 'if (ok) removed++; else failed++;', 'removed++;', 'failure counted as removed')],
  ['module', 'a throwing removal escapes run()', t => mutate(t, "catch (e) { r = { ok: false, message: String(e && e.message || e).slice(0, 200) }; }", "catch (e) { throw e; }", 'throw escapes')],
  ['module', 'every id is removed, tracked or not (a track of anything)', t => mutate(t, "if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id);", "ids.push(id);", 'track anything')],
  ['module', 'a plain unpublish instead of the soft delete', t => mutate(t, ', true);`);', ', false);`);', 'unpublish without delete')],
  ['module', 'the read back is not believed', t => mutate(t, 'back.rows[0].gone === true ?', 'back.rows[0].gone !== undefined ?', 'read back ignored')],
  ['module', 'a database refusal is a pass', t => mutate(t, "if (!r.ok) return { ok: false, message: `${r.code}: ${r.message}` };", "if (!r.ok) return { ok: true, message: '' };", 'refusal passes')],
  ['module', 'any project\'s database is accepted', t => mutate(t, "if (!u.hostname.includes(ref) && !decodeURIComponent(u.username).includes(ref)) throw new Error('REFUSED: STAGING_DB_URL does not name the staging project');", '', 'any project')],
  ['module', 'production is accepted', t => mutate(t, "if (env.PROD_DB_URL && env.PROD_DB_URL === url) throw new Error('REFUSED: STAGING_DB_URL equals PROD_DB_URL');", '', 'prod accepted')],
  ['module', 'no database is not BLOCKED', t => mutate(t, "if (!url) throw new Error('BLOCKED: STAGING_DB_URL is not set", "if (false) throw new Error('BLOCKED: STAGING_DB_URL is not set", 'no db ok')],
];
// script mutants: the same text patched in a copy of one script, then checkWiring on it (never run, never imported)
for (const name of SCRIPTS) {
  mutants.push(['script', `${name}: the finally no longer runs the cleanup`, null, name, s => mutate(s, 'await cleanup.run();', '/* removed */', `${name} finally`)]);
  const tracked = name === 'e2e-screens.mjs' ? 's1.json && s1.json.row' : 's.json && s.json.row';
  mutants.push(['script', `${name}: the created row is no longer tracked`, null, name, s => mutate(s, `cleanup.track(${tracked})`, `(${tracked})`, `${name} track`)]);
  mutants.push(['script', `${name}: the staging database is no longer required`, null, name, s => mutate(s, 'dbUrl = stagingDbUrl(process.env);', "dbUrl = process.env.STAGING_DB_URL || '';", `${name} guard`)]);
}
let caught = 0;
try {
  for (const [kind, label, patch, scriptName, scriptPatch] of mutants) {
    let failures;
    if (kind === 'module') failures = await checkModule(await loadMutantModule(patch(helperText), dir, String(caught + Math.random()).replace('.', '')));
    else failures = checkWiring({ ...sources, [scriptName]: scriptPatch(sources[scriptName]) });
    const red = failures.length > 0;
    if (red) caught++;
    say(red, `mutant caught: ${label}${red ? `  (red for: ${failures[0].slice(0, 90)})` : '  (STILL GREEN: the check measures nothing)'}`);
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(`\n${exit ? 'FAILED' : 'PASS'}: e2e cleanup, real code ${realA.length + realB.length + realC.length === 0 ? 'green' : 'RED'}, ${caught} of ${mutants.length} mutants caught`);
process.exit(exit);
