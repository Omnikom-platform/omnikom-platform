// Unit test of the e2e cleanup (slice 5.2b; the flows-lead cleanup of slice 5-CL), no staging, no network. Four layers, each watched red by a mutant at the end of this file:
//   A. e2e-cleanup.mjs itself: every tracked row is removed even after a thrown assertion, a failing removal does not stop the next, nothing
//      untracked is touched, the SQL is service.unpublish(.., true) as owner-a, a row that is not gone afterwards is a failure, staging only.
//   B. the three scripts that create content rows (e2e-functions, e2e-export, e2e-screens) track what their save creates and run the cleanup
//      in a finally; any e2e-*.mjs that saves with row: null must do the same.
//   D. (5-CL) the flows leads: only leads marked test = "5.3 flows" on the test site are selected, a dry run removes nothing, --apply calls
//      service.delete_lead once per lead and reads back; apps/dashboard/tests/flows.spec.ts removes its own leads in an afterAll.
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
const FLOWS_SPEC = join(HERE, '..', '..', 'apps', 'dashboard', 'tests', 'flows.spec.ts');
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

  // slice 5-CL: the flows test's leads. A fake sql answers the one read with a mix of leads; the module must pick only the marked ones.
  const L1 = ID1, L2 = ID2, L3 = ID3, L4 = '44444444-4444-4444-8444-444444444444', L5 = '55555555-5555-4555-8555-555555555555', L6 = '66666666-6666-4666-8666-666666666666';
  const LEADS = [
    { id: L1, name: '5.3 flows abc live', answers: { test: '5.3 flows', run: 'abc' } },
    { id: L2, name: 'Journey J1 lead', answers: {} },                                  // a CLI journey lead: never
    { id: L3, name: '5.3 flows abc lookalike', answers: {} },                          // the name alone: not selected without its id
    { id: L4, name: '5.3 flows abc added by member-a1', answers: {} },                 // the browser form's lead: only when the caller names the id
    { id: L5, name: 'Journey J2 lead', answers: { test: 'some other test' } },         // another marker: never
    { id: L6, name: '5.3 flows abc for-one', answers: { test: '5.3 flows', run: 'abc' } },
  ];
  const queries = [];
  const fakeLeadsSql = { rows: q => { queries.push(q); return { ok: true, rows: LEADS }; } };
  { const s = mod.selectFlowLeads({ sql: fakeLeadsSql });
    expect(s.ok && s.selected.map(l => l.id).join() === [L1, L6].join(), `only the two leads marked in their answers are selected (got ${s.selected.map(l => l.id.slice(0, 2)).join()})`);
    expect(s.left === 4, `the other four leads are counted as left (got ${s.left})`);
    expect(!s.selected.some(l => [L2, L3, L4, L5].includes(l.id)), 'a lead without the marker (a Journey lead, a lookalike name, another marker) is never selected');
    expect(/site_id = 'aaaaaaaa-0000-0000-0000-00000000517e'::uuid/.test(queries[0] || ''), 'the read is limited to the test site of workspace A'); }
  { const s = mod.selectFlowLeads({ sql: fakeLeadsSql, ids: [L1, L4, L2, L5] });
    expect(s.selected.map(l => l.id).join() === [L1, L4].join(), `with ids: a named lead that is marked or carries the "5.3 flows " name is selected, a Journey lead named by id is not (got ${s.selected.map(l => l.id.slice(0, 2)).join()})`); }
  { const s = mod.selectFlowLeads({ sql: { rows: () => ({ ok: false, code: 'CONNECT', message: 'down', rows: [] }) } });
    expect(s.ok === false && s.selected.length === 0, 'a failed read selects nothing and says so'); }
  // dry run removes nothing; --apply removes each selected id once and reports each
  { const gone = []; const r = await mod.cleanFlowLeads({ sql: fakeLeadsSql, remove: async id => { gone.push(id); return { ok: true }; } });
    expect(gone.length === 0 && r.removed === 0 && r.selected.length === 2 && r.left === 4, `a dry run removes nothing and reports 2 to remove, 4 left (got ${JSON.stringify({ gone: gone.length, removed: r.removed, sel: r.selected.length, left: r.left })})`); }
  { const gone = [], lines = []; const r = await mod.cleanFlowLeads({ sql: fakeLeadsSql, apply: true, remove: async id => { gone.push(id); return id === L6 ? { ok: false, message: 'S-NOT-FOUND' } : { ok: true }; }, report: (ok, id) => lines.push({ ok, id }) });
    expect(gone.length === 2 && gone.includes(L1) && gone.includes(L6) && !gone.includes(L2) && !gone.includes(L3), 'apply calls remove once for each marked lead and for nothing else');
    expect(r.removed === 1 && r.failed === 1 && r.ok === false && lines.length === 2, `a failed removal is counted, reported and does not stop the next (got ${JSON.stringify({ removed: r.removed, failed: r.failed })})`); }
  { const r = await mod.cleanFlowLeads({ sql: fakeLeadsSql, apply: true, remove: async () => { throw new Error('connection lost'); } });
    expect(r.failed === 2 && r.ok === false, 'a throwing removal counts as failed and never escapes'); }
  // the staging remover: service.delete_lead as owner-a with the reason, then the read back
  { sent.length = 0;
    const spawnGone = fakeSpawn(input => ({ status: 0, stdout: /not exists \(select 1 from public\.leads/.test(input) ? '[{"gone":true}]\n' : '', stderr: '' }));
    const rm = mod.stagingLeadRemover({ url: 'postgresql://postgres.stagingref:pw@db.stagingref.supabase.co:5432/postgres', spawn: spawnGone });
    const r = await rm(L1);
    const first = sent[0] || '', second = sent[1] || '';
    expect(r.ok === true, `a lead whose read back shows it gone is ok (got ${JSON.stringify(r)})`);
    expect(first.includes('service.delete_lead(') && first.includes(`'${L1}'::uuid`) && first.includes("'test data: 5.3 flows'"), 'the statement is service.delete_lead(claims, id, \'test data: 5.3 flows\')');
    expect(first.includes(JSON.stringify(claimsFor(parseIdentity('owner-a')))), 'the lead is removed with owner-a\'s claims');
    expect(/public\.leads where id = /.test(second) && sent.length === 2, 'the read back asks the leads table for that id'); }
  { const rm = mod.stagingLeadRemover({ url: 'postgresql://u:p@h:5432/d', spawn: fakeSpawn(input => ({ status: 0, stdout: /not exists \(select 1 from public\.leads/.test(input) ? '[{"gone":false}]\n' : '', stderr: '' })) });
    const r = await rm(L1);
    expect(r.ok === false && /still there/.test(r.message), 'a lead that is still there afterwards is a failure, not a pass'); }
  { const rm = mod.stagingLeadRemover({ url: 'postgresql://u:p@h:5432/d', spawn: fakeSpawn(() => ({ status: 1, stdout: '', stderr: 'ERROR:  S-NOT-FOUND: not found' })) });
    const r = await rm(L1);
    expect(r.ok === false && /S-NOT-FOUND/.test(r.message), 'a refusal from the database comes back as a failure with its code'); }
  return bad;
}

// ---- D. the flows test removes its own leads (on source text)
function checkFlowsSpec(text) {
  const bad = [];
  const body = (text.match(/test\.afterAll\(async \(\) => \{([\s\S]*?)\n\}\);/) || [])[1] || '';
  if (!body) bad.push('flows.spec.ts has no test.afterAll');
  if (body && !/clean-flow-leads\.mjs|CLEAN_LEADS/.test(body)) bad.push('flows.spec.ts: the afterAll does not run clean-flow-leads.mjs');
  if (body && !/'--apply'/.test(body)) bad.push('flows.spec.ts: the afterAll does not pass --apply (it would only dry-run)');
  if (body && !/'--ids'/.test(body)) bad.push('flows.spec.ts: the afterAll does not pass the ids it made');
  if (body && !/toBe\(0\)/.test(body)) bad.push('flows.spec.ts: the afterAll does not fail the run when the removal fails');
  if (!/const CLEAN_LEADS = resolve\([^)]*'clean-flow-leads\.mjs'\)/.test(text)) bad.push('flows.spec.ts: CLEAN_LEADS does not point at support/clean-flow-leads.mjs');
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
const flowsText = readFileSync(FLOWS_SPEC, 'utf8');
let exit = 0;
const say = (ok, text) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${text}`); if (!ok) exit = 1; };

const real = await import(pathToFileURL(HELPER).href);
const realA = await checkModule(real), realB = checkWiring(sources), realC = checkRefusals(), realD = checkFlowsSpec(flowsText);
for (const b of [...realA, ...realB, ...realC, ...realD]) console.log(`  problem: ${b}`);
say(realA.length === 0, `A. e2e-cleanup.mjs: ${realA.length} problem(s)`);
say(realB.length === 0, `B. wiring of ${Object.keys(sources).filter(f => /row:\s*null/.test(sources[f])).length} scripts that create rows: ${realB.length} problem(s)`);
say(realC.length === 0, `C. ${SCRIPTS.length} scripts refuse to start without STAGING_DB_URL: ${realC.length} problem(s)`);
say(realD.length === 0, `D. flows.spec.ts removes its own leads in an afterAll: ${realD.length} problem(s)`);

if (realA.length + realB.length + realC.length + realD.length) { console.log('\nFAILED: the real code is red, so the mutants below would prove nothing; they were not run'); process.exit(1); }
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
  ['module', 'the marker filter is gone: an unmarked lead is selected', t => mutate(t, ' && isFlowLead(l, { named: Boolean(want) }))', ')', 'marker filter removed')],
  ['module', 'the name alone selects a lead (a lookalike name without the marker)', t => mutate(t, 'return named && typeof row.name', 'return true && typeof row.name', 'name alone')],
  ['module', 'ids are ignored: every marked lead is selected', t => mutate(t, '(want ? want.has(l.id) : true)', 'true', 'ids ignored')],
  ['module', 'the read is no longer limited to the test site', t => mutate(t, 'where site_id = ${uuidLit(FLOW_SITE)} order by', 'order by', 'site filter')],
  ['module', 'a dry run removes the leads', t => mutate(t, 'if (apply) {\n    for (const l of sel.selected)', 'if (true) {\n    for (const l of sel.selected)', 'dry run removes')],
  ['module', 'apply never calls delete_lead', t => mutate(t, 'r = await remove(l.id);', 'r = { ok: true };', 'apply removes nothing')],
  ['module', 'the lead remover calls unpublish instead of delete_lead', t => mutate(t, 'select service.delete_lead(', 'select service.unpublish(', 'wrong function')],
  ['module', 'the lead read back is not believed', t => mutate(t, 'gone !== true) return', 'gone === undefined) return', 'lead read back ignored')],
  ['module', 'no database is not BLOCKED', t => mutate(t, "if (!url) throw new Error('BLOCKED: STAGING_DB_URL is not set", "if (false) throw new Error('BLOCKED: STAGING_DB_URL is not set", 'no db ok')],
];
// script mutants: the same text patched in a copy of one script, then checkWiring on it (never run, never imported)
for (const name of SCRIPTS) {
  mutants.push(['script', `${name}: the finally no longer runs the cleanup`, null, name, s => mutate(s, 'await cleanup.run();', '/* removed */', `${name} finally`)]);
  const tracked = name === 'e2e-screens.mjs' ? 's1.json && s1.json.row' : 's.json && s.json.row';
  mutants.push(['script', `${name}: the created row is no longer tracked`, null, name, s => mutate(s, `cleanup.track(${tracked})`, `(${tracked})`, `${name} track`)]);
  mutants.push(['script', `${name}: the staging database is no longer required`, null, name, s => mutate(s, 'dbUrl = stagingDbUrl(process.env);', "dbUrl = process.env.STAGING_DB_URL || '';", `${name} guard`)]);
}
// flows.spec.ts mutants: checkFlowsSpec on a patched copy of the spec text
mutants.push(['spec', 'flows.spec.ts: the afterAll is gone', null, null, s => mutate(s, 'test.afterAll(async () => {', 'test.describe.skip(async () => {', 'afterAll removed')]);
mutants.push(['spec', 'flows.spec.ts: the afterAll only dry-runs', null, null, s => mutate(s, "[CLEAN_LEADS, '--apply', '--ids',", "[CLEAN_LEADS, '--ids',", 'no --apply')]);
mutants.push(['spec', 'flows.spec.ts: a failed removal no longer fails the run', null, null, s => mutate(s, ').toBe(0);\n});\n\nconst radio', ');\n});\n\nconst radio', 'failure ignored')]);
let caught = 0;
try {
  for (const [kind, label, patch, scriptName, scriptPatch] of mutants) {
    let failures;
    if (kind === 'module') failures = await checkModule(await loadMutantModule(patch(helperText), dir, String(caught + Math.random()).replace('.', '')));
    else if (kind === 'spec') failures = checkFlowsSpec(scriptPatch(flowsText));
    else failures = checkWiring({ ...sources, [scriptName]: scriptPatch(sources[scriptName]) });
    const red = failures.length > 0;
    if (red) caught++;
    say(red, `mutant caught: ${label}${red ? `  (red for: ${failures[0].slice(0, 90)})` : '  (STILL GREEN: the check measures nothing)'}`);
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(`\n${exit ? 'FAILED' : 'PASS'}: e2e cleanup, real code ${realA.length + realB.length + realC.length + realD.length === 0 ? 'green' : 'RED'}, ${caught} of ${mutants.length} mutants caught`);
process.exit(exit);
