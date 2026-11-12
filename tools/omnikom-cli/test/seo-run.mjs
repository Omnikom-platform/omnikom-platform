// Tests for `omnikom seo run | resume | status | vantage` (work order 41): the manifest validator, the six states, the pre-checks, waiting steps, what "done" means,
// timeouts, the parallel / same-host / heavy rules, resume after a stop, --only/--from/--module/--fresh, the env file, and the vantage pass-through.
// Everything runs real child processes against fake step scripts (test/fixtures/seo/skill/scripts: one tiny script per behaviour) and a fake HTTP server
// that counts the requests open at once; nothing touches a real site, ~/.claude or the real heavy.mjs (a stand-in that takes no lock is used, so the
// serialisation seen here is the runner's own). Each check below has a mutant in test/mutate.mjs tagged [seo-run].
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync, mkdirSync, utimesSync, statSync, symlinkSync, unlinkSync, rmdirSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import { pidAlive } from './harness.mjs';

export async function seoRunTests({ check, cli, CLI_ROOT, REPO_ROOT, lib }) {
  const { validateManifest, covers, describe } = await lib('seo-manifest.mjs');
  const { skillDirOf, SKILL } = await import(pathToFileURL(join(CLI_ROOT, 'commands', 'seo.mjs')).href);
  const guard = await import(pathToFileURL(join(REPO_ROOT, 'tools', 'proc-guard', 'index.mjs')).href);
  const FIX = join(CLI_ROOT, 'test', 'fixtures', 'seo');
  const heavyScript = join(FIX, 'fake-heavy.mjs');
  const root = mkdtempSync(join(tmpdir(), 'omnikom-seo-'));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (fn()) return true; await sleep(100); } return fn(); };
  const norm = p => String(p).replace(/\\/g, '/');

  // the fake client site: every request waits 250 ms and the server remembers how many were open at once
  let open = 0, max = 0;
  const server = http.createServer((req, res) => { open++; max = Math.max(max, open); setTimeout(() => { res.end('ok'); open--; }, 250); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const URL_ = `http://127.0.0.1:${server.address().port}/`;
  const HOST = '127.0.0.1';

  // manifest builders: a runnable step (S), a waiting step (W), a manifest (M); kind and maxAgeDays are required on every step (P3.4 R2)
  const S = (id, over = {}) => ({ id, module: 'm', what: `step ${id}`, script: 'scripts/ok.mjs', args: ['--id', id, '--out', `{pewp}/${id}.json`], inputs: [], outputs: [`{pewp}/${id}.json`], dependsOn: [], needsBrowser: 'none', needsAi: false, needsPerson: false, needsKeys: [], heavy: false, hits: 'none', pace: null, timeoutMinutes: 1, evidence: [`{pewp}/${id}.json`], kind: 'derived', maxAgeDays: null, ...over });
  const W = (id, over = {}) => S(id, { script: null, args: [], needsBrowser: 'owner', brief: 'do it for {host}', timeoutMinutes: 0, outputs: [`{pewp}/captures/${id}.json`], evidence: [`{pewp}/captures/${id}.json`], ...over });
  const M = (...steps) => ({ version: 1, name: 't', what: 't', steps });
  const base = JSON.parse(readFileSync(join(FIX, 'skill', 'pipeline.json'), 'utf8'));

  // a fresh skill folder (a copy of the fixture one) with this manifest
  let n = 0;
  function site(manifest) {
    const dir = join(root, `s${++n}`), skill = join(dir, 'skill');
    cpSync(join(FIX, 'skill'), skill, { recursive: true });
    if (manifest) writeFileSync(join(skill, 'pipeline.json'), JSON.stringify(manifest, null, 1));
    return { dir, skill, record: join(dir, 'record.jsonl'), pewp: join(skill, 'site-checks', HOST, '.pewp'), work: join(skill, 'site-checks', HOST, 'work') };
  }
  // No command may hang the file: one that does not return within the deadline ends the file with a FAIL line naming it (see the catch at the bottom)
  const DEADLINE_MS = 150000;
  const bounded = (what, p) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error(`${what} did not return in ${DEADLINE_MS / 1000} s`), { seoDeadline: true })), DEADLINE_MS); })]).finally(() => clearTimeout(t)); };
  // seo run and seo resume run the skill check first (P3.4 R1): a test never reads the real skills folder, it hands a check that passes (a case may hand its own in `seo`)
  const PASS = () => ({ ok: true, problems: [] });
  const go = (s, argv, env = {}, seo = {}) => bounded(`omnikom seo ${argv.join(' ')}`, cli(['seo', ...argv], { SEO_FIXTURE_RECORD: s.record, ...env }, { seo: { skillDir: s.skill, heavyScript, skillCheck: PASS, ...seo } }));
  const run = (s, extra = [], env, seo) => go(s, ['run', URL_, '--client', 'demo', '--json', ...extra], env, seo);
  const resume = (s, extra = [], env, seo) => go(s, ['resume', URL_, '--json', ...extra], env, seo);
  const status = (s, extra = []) => go(s, ['status', URL_, '--json', ...extra]);
  const rec = s => (existsSync(s.record) ? readFileSync(s.record, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
  const starts = (s, id) => rec(s).filter(r => r.id === id && r.event === 'start').length;
  const row = (r, id) => r.json.data.steps.find(x => x.id === id);
  const states = r => Object.fromEntries(r.json.data.steps.map(x => [x.id, x.state]));
  const span = (s, id) => { const x = rec(s).filter(r => r.id === id); return { a: x.find(r => r.event === 'start').t, b: x.find(r => r.event === 'end').t }; };
  const overlap = (x, y) => x.a < y.b && y.a < x.b;
  const touch = (file, msFromNow) => { const t = new Date(Date.now() + msFromNow); utimesSync(file, t, t); };
  const has = (problems, text) => problems.some(p => p.includes(text));

  try {
    // ================================================================ the validator (the skill's engine: seo-manifest.mjs only re-exports it)
    const vopts = { skillDir: join(FIX, 'skill'), repoRoot: REPO_ROOT };
    const vsentences = (m, o = vopts) => { try { return validateManifest(m, o).problems.map(describe); } catch (e) { return [`threw: ${e.message}`]; } };   // a throw is a red check, not a crash
    check('seo validator: the fixture manifest is valid', vsentences(base).length === 0, vsentences(base).join(' | '));
    const broke = fn => { const m = structuredClone(base); fn(m); return vsentences(m); };
    const step = (m, id) => m.steps.find(x => x.id === id);
    let p;
    p = broke(m => { m.extra = 1; });
    check('seo validator: an unknown key at the top is refused', has(p, "unknown key 'extra'"), p.join(' | '));
    p = broke(m => { step(m, 'fx-ok').colour = 'red'; });
    check('seo validator: an unknown key in a step is refused', has(p, "unknown key 'colour'"), p.join(' | '));
    p = broke(m => { step(m, 'fx-ok').args.push('{nope}'); });
    check('seo validator: an unknown placeholder is refused', has(p, '{nope}'), p.join(' | '));
    p = broke(m => { step(m, 'fx-wait').brief = 'go to {where}'; });
    check('seo validator: an unknown placeholder in a brief is refused', has(p, '{where}'), p.join(' | '));
    p = broke(m => { step(m, 'fx-read').dependsOn = ['ghost']; });
    check('seo validator: a dependsOn id that is no step is refused', has(p, "dependsOn 'ghost' is not a step"), p.join(' | '));
    p = broke(m => { step(m, 'fx-ok').engines = ['google', 'bing', 'commoncrawl']; });
    check('seo validator: engines naming known engines (google, bing, commoncrawl) are accepted [stops]', p.length === 0, p.join(' | '));
    p = broke(m => { step(m, 'fx-ok').engines = ['yahoo']; });
    check('seo validator: an unknown engine is refused and named [stops]', has(p, "engines holds 'yahoo'"), p.join(' | '));
    p = broke(m => { step(m, 'fx-ok').engines = 'google'; });
    check('seo validator: engines must be a list [stops]', has(p, 'engines must be a list of strings'), p.join(' | '));
    p = broke(m => { step(m, 'fx-ok').dependsOn = ['fx-read']; });
    check('seo validator: a dependency cycle is refused and named', has(p, 'dependency cycle: fx-ok -> fx-read -> fx-ok') || has(p, 'dependency cycle: fx-read -> fx-ok -> fx-read'), p.join(' | '));
    p = broke(m => { step(m, 'fx-ok').dependsOn = ['fx-ok']; });
    check('seo validator: a step that depends on itself is a cycle', has(p, 'dependency cycle: fx-ok -> fx-ok'), p.join(' | '));
    p = broke(m => { step(m, 'fx-ok').script = 'scripts/nope.mjs'; });
    check('seo validator: a script that does not exist is refused', has(p, "script 'scripts/nope.mjs' does not exist"), p.join(' | '));
    p = broke(m => { step(m, 'fx-wait').script = 'scripts/ok.mjs'; });
    check('seo validator: a script on a waiting step is refused', has(p, 'waiting step') && has(p, 'script null'), p.join(' | '));
    p = broke(m => { step(m, 'fx-ok').script = null; });
    check('seo validator: a runnable step with no script is refused', has(p, 'needs a script'), p.join(' | '));
    p = broke(m => { step(m, 'fx-ok').needsBrowser = 'robot'; });
    check('seo validator: a bad needsBrowser is refused', has(p, 'needsBrowser must be one of'), p.join(' | '));
    p = broke(m => { step(m, 'fx-ok').hits = 'everyone'; });
    check('seo validator: a bad hits value is refused', has(p, 'hits must be client, none or third-party:<name>'), p.join(' | '));
    p = broke(m => { delete step(m, 'fx-ok').timeoutMinutes; });
    check('seo validator: a missing timeout is refused', has(p, 'timeoutMinutes is missing'), p.join(' | '));
    p = broke(m => { step(m, 'fx-ok').timeoutMinutes = 0; });
    check('seo validator: a timeout of 0 on a step a script runs is refused', has(p, 'timeout above 0'), p.join(' | '));
    p = broke(m => { step(m, 'fx-ok').evidence = ['{pewp}/elsewhere.json']; });
    check('seo validator: evidence that is neither inside an output nor an input is refused', has(p, 'neither inside an output nor an input'), p.join(' | '));
    p = broke(m => { m.steps.push({ ...step(m, 'fx-ok') }); });
    check('seo validator: a step id used twice is refused', has(p, "step id 'fx-ok' is used twice"), p.join(' | '));
    p = broke(m => { step(m, 'fx-partial').exit = { 4: 'maybe' }; });
    check('seo validator: an exit override that names no state is refused', has(p, 'exit 4 must start with'), p.join(' | '));
    p = broke(m => { m.steps.push(S('vant', { script: 'scripts/vantage.mjs', args: ['start'], outputs: ['{pewp}/vantage.json'], evidence: ['{pewp}/vantage.json'] })); });
    check('seo validator: a step that calls vantage start is refused (a run only reads its status)', has(p, 'never call vantage start'), p.join(' | '));
    p = broke(m => { step(m, 'fx-wait').brief = ''; });
    check('seo validator: a waiting step needs a brief', has(p, 'needs a brief'), p.join(' | '));
    p = broke(m => { step(m, 'fx-ok').colour = 1; step(m, 'fx-read').dependsOn = ['ghost']; delete step(m, 'fx-fail').timeoutMinutes; });
    check('seo validator: three faults are three problems, all listed', p.length === 3 && has(p, 'colour') && has(p, 'ghost') && has(p, 'timeoutMinutes'), p.join(' | '));
    check('seo covers: a folder covers what is inside it, a glob names its files, and a sibling is not covered', covers('{pewp}/a/', '{pewp}/a/*.json') && covers('{pewp}/*/x.json', '{pewp}/a/x.json') && !covers('{pewp}/a/', '{pewp}/b/x.json'));

    // ---- the command refuses a bad or missing manifest before it starts anything
    let s = site(); let r;
    writeFileSync(join(s.skill, 'pipeline.json'), JSON.stringify((() => { const m = structuredClone(base); m.steps[0].colour = 1; m.steps[1].dependsOn = ['ghost']; delete m.steps[5].timeoutMinutes; return m; })()));
    r = await go(s, ['run', URL_, '--client', 'demo']);
    check('seo run: an invalid manifest exits 2 and lists every problem, and no step starts', r.exit === 2 && r.stdout.startsWith('ERROR the manifest ') && r.stdout.includes('invalid (3 problems)') && r.stdout.includes('colour') && r.stdout.includes('ghost') && r.stdout.includes('timeoutMinutes') && rec(s).length === 0 && !existsSync(s.pewp), r.all.slice(0, 500));
    r = await go(s, ['status', URL_]);
    check('seo status: an invalid manifest exits 2 as well', r.exit === 2 && r.stdout.includes('invalid'), r.all.slice(0, 300));
    s = site(); rmSync(join(s.skill, 'pipeline.json'));
    r = await go(s, ['status', URL_]);
    check('seo status: no manifest exits 2 and names where it looked', r.exit === 2 && r.stdout.includes('the manifest is not at') && r.stdout.includes('pipeline.json') && r.stdout.includes(norm(s.skill)), r.all.slice(0, 300));

    // ---- the manifest is the repository's copy: the default skill folder is <repo>/skills/programmatic-enterprise-web-performance, never ~/.claude
    const def = norm(skillDirOf({}));
    check('seo: the default skill folder is the repository\'s, not under ~/.claude', def === norm(join(REPO_ROOT, ...SKILL)) && !def.includes('/.claude/') && !def.toLowerCase().startsWith(norm(homedir()).toLowerCase() + '/.claude'), def);
    const fakeRepo = join(root, 'repo');
    mkdirSync(join(fakeRepo, 'skills', SKILL[1], 'scripts'), { recursive: true });
    writeFileSync(join(fakeRepo, 'skills', SKILL[1], 'scripts', 'ok.mjs'), '// x\n');
    const withLeadEndpoint = dir => { mkdirSync(join(dir, 'factory', 'worker'), { recursive: true }); cpSync(join(REPO_ROOT, 'factory', 'worker', 'lead-endpoint.mjs'), join(dir, 'factory', 'worker', 'lead-endpoint.mjs')); };   // lib/sign.mjs imports it from the repository at load
    withLeadEndpoint(fakeRepo);
    for (const f of ['lib-pipeline.mjs', 'lib-stops.mjs', 'lib-run.mjs']) cpSync(join(REPO_ROOT, ...SKILL, 'scripts', f), join(fakeRepo, 'skills', SKILL[1], 'scripts', f));   // the CLI takes the rule engine from the repository at load
    writeFileSync(join(fakeRepo, 'skills', SKILL[1], 'pipeline.json'), JSON.stringify(M(S('only-in-repo-copy'))));
    const sub = await new Promise(res => {
      const c = spawn(process.execPath, [join(CLI_ROOT, 'omnikom.mjs'), 'seo', 'status', URL_, '--json'], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, OMNIKOM_REPO_ROOT: fakeRepo }, windowsHide: true });
      let out = ''; c.stdout.on('data', d => { out += d; }); c.on('close', code => res({ code, out }));
      setTimeout(() => c.kill(), 30000);
    });
    let subJson = null; try { subJson = JSON.parse(sub.out); } catch { /* reported below */ }
    check('seo status: with OMNIKOM_REPO_ROOT the manifest is that repository\'s copy (its only step, none of the ~/.claude draft)', subJson && subJson.data.steps.map(x => x.id).join() === 'only-in-repo-copy' && !subJson.data.steps.some(x => x.id === 'doctor'), sub.out.slice(0, 300));

    // ================================================================ the six states, quoting and the log
    s = site();
    r = await run(s);
    const st = states(r);
    check('seo run: each of the six states appears (RUN, SKIPPED, BLOCKED, WAITING, PARTIAL, FAILED) and dependents of a stopped step are BLOCKED', JSON.stringify(st) === JSON.stringify({ 'fx-ok': 'RUN', 'fx-read': 'RUN', 'fx-blocked': 'BLOCKED', 'fx-skipped': 'SKIPPED', 'fx-partial': 'PARTIAL', 'fx-fail': 'FAILED', 'fx-wait': 'WAITING', 'fx-after': 'BLOCKED', 'fx-after-fail': 'BLOCKED' }), JSON.stringify(st));
    check('seo run: exit 1 when a step FAILED, code SEO-FAILED, failed 1', r.exit === 1 && r.json.code === 'SEO-FAILED' && r.json.data.failed === 1, r.all.slice(0, 300));
    check('seo run: a BLOCKED exit 3 quotes the script\'s last line verbatim', row(r, 'fx-blocked').line === 'BLOCKED: the client has not added us | unblocks: the client adds us as a user' && row(r, 'fx-blocked').detail === row(r, 'fx-blocked').line && row(r, 'fx-blocked').exit === 3, JSON.stringify(row(r, 'fx-blocked')));
    check('seo run: a SKIPPED exit 4 quotes the script\'s last line verbatim', row(r, 'fx-skipped').line === 'SKIPPED: nothing to compare against yet' && row(r, 'fx-skipped').detail === row(r, 'fx-skipped').line, JSON.stringify(row(r, 'fx-skipped')));
    check('seo run: a step that exits 0 with a PARTIAL: last line is PARTIAL (no exit map: the manifest\'s exit is not read), with the script\'s own last line', row(r, 'fx-partial').exit === 0 && row(r, 'fx-partial').line === 'PARTIAL: read 10 of 25' && row(r, 'fx-partial').detail.includes('read 10 of 25'), JSON.stringify(row(r, 'fx-partial')));
    check('seo run: FAILED says the exit and the last line', row(r, 'fx-fail').exit === 1 && row(r, 'fx-fail').detail === 'exit 1: boom: the page did not load', JSON.stringify(row(r, 'fx-fail')));
    check('seo run: a step whose dependency FAILED is BLOCKED by it and its script never starts', row(r, 'fx-after-fail').detail.startsWith('BLOCKED: waits for fx-fail (FAILED)') && starts(s, 'fx-after-fail') === 0, JSON.stringify(row(r, 'fx-after-fail')));
    check('seo run: the evidence of a RUN step is its file, relative to the skill folder', row(r, 'fx-ok').detail === `site-checks/${HOST}/.pewp/fx-ok.json` && row(r, 'fx-ok').exit === 0, JSON.stringify(row(r, 'fx-ok')));
    check('seo run: counts per state and per module', r.json.data.counts.RUN === 2 && r.json.data.counts.BLOCKED === 3 && r.json.data.counts.SKIPPED === 1 && r.json.data.counts.PARTIAL === 1 && r.json.data.counts.FAILED === 1 && r.json.data.counts.WAITING === 1 && r.json.data.modules.alpha.RUN === 2 && r.json.data.modules.beta.total === 3 && r.json.data.modules.gamma.WAITING === 1, JSON.stringify(r.json.data.counts));
    const logFile = join(s.pewp, 'seo-run.json');
    const log = JSON.parse(readFileSync(logFile, 'utf8'));
    const lb = log.steps.find(x => x.id === 'fx-blocked');
    check('seo run: the run log {pewp}/seo-run.json holds start, end, exit, state, the quoted line and the evidence paths', log.client === 'demo' && lb.state === 'BLOCKED' && lb.exit === 3 && lb.startedAt && lb.endedAt && lb.line.startsWith('BLOCKED:') && log.steps.find(x => x.id === 'fx-ok').evidence[0].endsWith('/fx-ok.json'), JSON.stringify(lb));
    r = await go(s, ['status', URL_]);
    check('seo status: text table with the brief, the inputs and the outputs under a WAITING row, and the counts line', r.exit === 1 && /^WAITING +fx-wait +gamma +needs the owner's browser$/m.test(r.stdout) && r.stdout.includes(`do: Open ${URL_} in the owner's browser`) && r.stdout.includes('write: site-checks/127.0.0.1/.pewp/captures/fx-wait.json') && r.stdout.includes('counts: RUN 2, SKIPPED 1, BLOCKED 3, WAITING 1, PARTIAL 1, FAILED 1, NOT RUN 0 (of 9 steps)'), r.stdout);
    check('seo status: a module line per module', r.stdout.includes('module alpha: 2 RUN (of 2)') && r.stdout.includes('module beta: 1 SKIPPED, 1 BLOCKED, 1 PARTIAL (of 3)'), r.stdout);

    // ---- a missing BLOCKED line is said, never invented; a stray exit 2 is FAILED (usage)
    s = site(M(S('nl', { script: 'scripts/blocked-noline.mjs' }), S('snl', { script: 'scripts/skipped-noline.mjs' }), S('sk', { script: 'scripts/skipped.mjs' }), S('after-sk', { dependsOn: ['sk'] }), S('after-nl', { dependsOn: ['nl'] })));
    r = await run(s);
    check('seo run: exit 3 without its BLOCKED line is FAILED (a contract break) naming the missing line, and quotes nothing', row(r, 'nl').state === 'FAILED' && row(r, 'nl').line === null && row(r, 'nl').detail === "exit 3 [contract break: exit 3 (BLOCKED) without a 'BLOCKED: <what> | unblocks: <what>' line]" && r.exit === 1, JSON.stringify(row(r, 'nl')));
    check('seo run: exit 4 without its SKIPPED line is FAILED (a contract break) naming the missing line', row(r, 'snl').state === 'FAILED' && row(r, 'snl').detail === "exit 4 [contract break: exit 4 (SKIPPED) without a 'SKIPPED: <reason>' line]", JSON.stringify(row(r, 'snl')));
    check('seo run: a SKIPPED step is settled, so its dependent runs', row(r, 'sk').state === 'SKIPPED' && row(r, 'after-sk').state === 'RUN' && starts(s, 'after-sk') === 1, JSON.stringify([row(r, 'sk').state, row(r, 'after-sk')]));
    check('seo run: the dependent of a contract-break step is BLOCKED by it, and its independent steps went on', row(r, 'after-nl').state === 'BLOCKED' && row(r, 'after-nl').detail.includes('waits for nl (FAILED)') && row(r, 'sk').state === 'SKIPPED', JSON.stringify(row(r, 'after-nl')));
    s = site(M(S('u', { script: 'scripts/fail.mjs', args: ['--id', 'u', '--code', '2'] }), S('seven', { script: 'scripts/fail.mjs', args: ['--id', 'seven', '--code', '7'] })));
    r = await run(s);
    check('seo run: exit 2 is FAILED (usage) and any other exit is FAILED', row(r, 'u').state === 'FAILED' && row(r, 'u').detail.endsWith('[usage]') && row(r, 'seven').state === 'FAILED' && row(r, 'seven').exit === 7, JSON.stringify(r.json.data.steps));
    s = site(M(S('b1', { script: 'scripts/blocked.mjs' }), S('s1', { script: 'scripts/skipped.mjs' }), W('w1'), S('ni', { script: 'scripts/needs-input.mjs' })));
    r = await run(s);
    check('seo run: only BLOCKED, SKIPPED and WAITING steps exit 0 (they are states, not failures); a script that asks for input (NEEDS-INPUT, exit 3) is WAITING, with the owner\'s answers named', r.exit === 0 && r.json.ok === true && r.json.data.failed === 0 && row(r, 'ni').state === 'WAITING' && row(r, 'ni').detail === 'needs the owner\'s answers' && row(r, 'ni').exit === 3 && row(r, 'ni').line === 'BLOCKED: answers | unblocks: y', r.all.slice(0, 300) + JSON.stringify(row(r, 'ni')));

    // ================================================================ pre-checks never start the script
    const KEY = randomBytes(12).toString('hex');
    s = site(M(S('needs-key', { script: 'scripts/keys.mjs', needsKeys: ['FIXTURE_KEY', 'FIXTURE_OTHER'] })));
    r = await run(s);
    check('seo run: a missing key is BLOCKED by name (all missing names), the script never starts', row(r, 'needs-key').state === 'BLOCKED' && row(r, 'needs-key').detail.startsWith('BLOCKED: keys FIXTURE_KEY, FIXTURE_OTHER not set |') && starts(s, 'needs-key') === 0, JSON.stringify(row(r, 'needs-key')));
    r = await run(s, [], { FIXTURE_KEY: KEY, FIXTURE_OTHER: KEY + 'x' });
    check('seo run: with the keys in the environment the step runs, and no key value is printed', row(r, 'needs-key').state === 'RUN' && !r.all.includes(KEY), r.all.slice(0, 300));
    s = site(M(S('maker', { script: 'scripts/skipped.mjs', outputs: ['{pewp}/made.json'], evidence: ['{pewp}/made.json'] }), S('consumer', { inputs: ['{pewp}/made.json'], dependsOn: ['maker'] }), S('lonely', { inputs: ['{pewp}/ghost.json'] })));   // the validator's input-order rule: a reader of another step's output depends on it; a SKIPPED maker is settled, so the reader's own input check is what says the file is missing
    r = await run(s);
    check('seo run: a missing input file is BLOCKED naming the file and the step that writes it; the script never starts', row(r, 'consumer').state === 'BLOCKED' && row(r, 'consumer').detail.includes(`site-checks/${HOST}/.pewp/made.json (written by maker)`) && starts(s, 'consumer') === 0, JSON.stringify(row(r, 'consumer')));
    check('seo run: an input no step writes says so', row(r, 'lonely').detail.includes('ghost.json (no step of the manifest writes it)') && starts(s, 'lonely') === 0, JSON.stringify(row(r, 'lonely')));
    s = site(M(S('hv', { heavy: true })));
    r = await run(s, [], {}, { heavyScript: join(root, 'no-such-heavy.mjs') });
    check('seo run: a heavy step with no heavy.mjs is BLOCKED naming it, and never starts', row(r, 'hv').state === 'BLOCKED' && row(r, 'hv').detail.includes('heavy.mjs') && starts(s, 'hv') === 0, JSON.stringify(row(r, 'hv')));

    // ================================================================ waiting steps
    s = site();
    await run(s);
    mkdirSync(join(s.pewp, 'captures'), { recursive: true });
    writeFileSync(join(s.pewp, 'captures', 'fx-wait.json'), '{"page":"seen"}\n');
    r = await resume(s);
    check('seo resume: a waiting step whose outputs now exist (written after the run began) is RUN with that evidence, and its dependent goes on', row(r, 'fx-wait').state === 'RUN' && row(r, 'fx-wait').evidence[0].endsWith('captures/fx-wait.json') && row(r, 'fx-after').state === 'RUN' && starts(s, 'fx-after') === 1, JSON.stringify([row(r, 'fx-wait'), row(r, 'fx-after')]));
    check('seo resume: what was RUN is not run again (fx-ok, fx-read started once)', starts(s, 'fx-ok') === 1 && starts(s, 'fx-read') === 1 && row(r, 'fx-ok').how === 'already done', JSON.stringify(row(r, 'fx-ok')));
    s = site();
    mkdirSync(join(s.pewp, 'captures'), { recursive: true });
    writeFileSync(join(s.pewp, 'captures', 'fx-wait.json'), '{"page":"from an older run"}\n');
    touch(join(s.pewp, 'captures', 'fx-wait.json'), -3600 * 1000);
    r = await run(s);
    check('seo run: outputs written BEFORE the run began do not count: still WAITING', row(r, 'fx-wait').state === 'WAITING' && row(r, 'fx-after').state === 'BLOCKED', JSON.stringify(row(r, 'fx-wait')));
    s = site(M(W('cap-google', { outputs: ['{pewp}/captures/serp/'], evidence: ['{pewp}/captures/serp/*.google.json'] }), W('cap-bing', { outputs: ['{pewp}/captures/serp/'], evidence: ['{pewp}/captures/serp/*.bing.json'] })));
    await run(s);
    mkdirSync(join(s.pewp, 'captures', 'serp'), { recursive: true });
    writeFileSync(join(s.pewp, 'captures', 'serp', 'a.google.json'), '{}\n');
    r = await resume(s);
    check('seo resume: two waiting steps sharing an output folder are told apart by their evidence globs', row(r, 'cap-google').state === 'RUN' && row(r, 'cap-bing').state === 'WAITING', JSON.stringify(states(r)));
    const hourAgo = new Date(Date.now() - 3600 * 1000);
    utimesSync(join(s.pewp, 'captures', 'serp', 'a.google.json'), hourAgo, hourAgo);
    writeFileSync(join(s.pewp, 'captures', 'serp', 'b.bing.json'), '{}\n');
    r = await resume(s);
    check('seo resume: a waiting step whose OWN evidence is older than the run stays WAITING although its output folder holds a fresh file (the other step\'s)', row(r, 'cap-google').state === 'WAITING' && row(r, 'cap-bing').state === 'RUN', JSON.stringify(states(r)));
    s = site(M(W('wt', { needsAi: true, needsBrowser: 'none', needsPerson: true })));
    r = await run(s);
    check('seo run: a WAITING row says who is needed (AI agent and a person) and what to write', row(r, 'wt').detail === 'needs an AI agent and a person' && row(r, 'wt').waiting.outputs[0].endsWith('captures/wt.json') && row(r, 'wt').waiting.brief === `do it for ${HOST}`, JSON.stringify(row(r, 'wt')));

    // ================================================================ what "done" means
    s = site(M(S('ne', { script: 'scripts/noevidence.mjs' }), S('old', { script: 'scripts/stale.mjs', args: ['--id', 'old', '--out', '{pewp}/old.json'] })));
    r = await run(s);
    check('seo run: exit 0 with no evidence file is FAILED, not RUN', row(r, 'ne').state === 'FAILED' && row(r, 'ne').detail.includes('exit 0 but evidence missing') && row(r, 'ne').detail.includes('no non-empty file'), JSON.stringify(row(r, 'ne')));
    check('seo run: exit 0 whose evidence was written before the step started is FAILED', row(r, 'old').state === 'FAILED' && row(r, 'old').detail.includes('only files older than the step started'), JSON.stringify(row(r, 'old')));
    // evidence globs: every match non-empty, the NEWEST match newer than the step's start (an older sibling from an earlier run does not matter)
    s = site(M(S('ns', { args: ['--id', 'ns', '--out', '{pewp}/ns/new.json'], outputs: ['{pewp}/ns/'], evidence: ['{pewp}/ns/*.json'] }), S('em', { args: ['--id', 'em', '--out', '{pewp}/em/a.json'], outputs: ['{pewp}/em/'], evidence: ['{pewp}/em/*.json'] })));
    mkdirSync(join(s.pewp, 'ns'), { recursive: true }); mkdirSync(join(s.pewp, 'em'), { recursive: true });
    writeFileSync(join(s.pewp, 'ns', 'old.json'), '{"from":"an earlier run"}\n'); utimesSync(join(s.pewp, 'ns', 'old.json'), hourAgo, hourAgo);
    writeFileSync(join(s.pewp, 'em', 'empty.json'), '');
    r = await run(s, ['--fresh']);   // --fresh: a plain run would adopt the old file (the RESUME default) instead of running the step
    check('seo run: the NEWEST match of an evidence glob decides: a step whose glob also matches an older file from an earlier run is RUN', row(r, 'ns').state === 'RUN' && row(r, 'ns').evidenceCount === 2, JSON.stringify(row(r, 'ns')));
    check('seo run: every match of an evidence glob must be non-empty: one empty file among the matches is FAILED', row(r, 'em').state === 'FAILED' && row(r, 'em').detail.includes('1 empty file: ') && row(r, 'em').detail.includes('empty.json'), JSON.stringify(row(r, 'em')));
    s = site(M(S('p'), S('q', { inputs: ['{pewp}/p.json'], dependsOn: ['p'], args: ['--id', 'q', '--read', '{pewp}/p.json', '--out', '{pewp}/q.json'] })));
    await run(s);
    r = await run(s);
    check('seo run: run again skips what is done (each started once)', starts(s, 'p') === 1 && starts(s, 'q') === 1 && row(r, 'q').how === 'already done' && r.exit === 0, JSON.stringify(row(r, 'q')));
    touch(join(s.pewp, 'p.json'), 3600 * 1000);
    r = await run(s);
    check('seo run: an input newer than the evidence makes the step stale, so it runs again (and p, with no newer input, does not)', starts(s, 'q') === 2 && starts(s, 'p') === 1 && row(r, 'q').state === 'RUN', JSON.stringify([starts(s, 'p'), starts(s, 'q')]));
    const began = JSON.parse(readFileSync(join(s.pewp, 'seo-run.json'), 'utf8')).runStartedAt;
    await sleep(30);
    r = await run(s, ['--fresh']);
    check('seo run --fresh redoes everything and starts a new run (every step started twice, run start moved)', starts(s, 'p') === 2 && starts(s, 'q') === 3 && r.json.data.runStartedAt !== began, JSON.stringify([starts(s, 'p'), starts(s, 'q'), began, r.json.data.runStartedAt]));

    // ================================================================ timeouts stop the whole tree
    s = site(M(S('hang', { script: 'scripts/hang.mjs', args: ['--id', 'hang', '--pidfile', '{work}/pid'], timeoutMinutes: 0.08 })));
    const t0 = Date.now();
    r = await run(s);
    const gpid = Number(existsSync(join(s.work, 'pid')) ? readFileSync(join(s.work, 'pid'), 'utf8') : 0);
    check('seo run: a step past its timeout is FAILED (timeout) and the run goes on within seconds', row(r, 'hang').state === 'FAILED' && row(r, 'hang').detail.startsWith('timeout after 0.08 min') && Date.now() - t0 < 20000, JSON.stringify(row(r, 'hang')) + ` ${Date.now() - t0}ms`);
    check('seo run: the timeout kills the whole child tree (the grandchild is gone)', gpid > 0 && await until(() => !pidAlive(gpid), 6000), `grandchild pid ${gpid}`);
    if (gpid > 0 && pidAlive(gpid)) guard.killTree(gpid);
    // a process that survives the kill (a killer that does nothing stands for it: a real process cannot ignore taskkill /F): after the grace the step settles
    // as FAILED naming the pids that did not exit, the log records them, and the independent step goes on
    s = site(M(S('stuck', { script: 'scripts/hang.mjs', args: ['--id', 'stuck', '--pidfile', '{work}/pid'], timeoutMinutes: 0.05 }), S('goes-on')));
    const tStuck = Date.now();
    r = await run(s, [], {}, { killTree: () => false, graceMs: 3000 });
    const stuckMs = Date.now() - tStuck;
    const stuckPid = Number(existsSync(join(s.work, 'pid')) ? readFileSync(join(s.work, 'pid'), 'utf8') : 0);
    const stuckLog = JSON.parse(readFileSync(join(s.pewp, 'seo-run.json'), 'utf8')).steps.find(x => x.id === 'stuck');
    check('seo run: a process that survives the kill settles the step as FAILED within timeout + grace (not at the 90 s the process lives), naming its pids; the independent step goes on', row(r, 'stuck').state === 'FAILED' && row(r, 'stuck').detail.startsWith('timeout after 0.05 min; the process tree did not exit after the kill (pids ') && stuckMs < 45000 && stuckPid > 0 && row(r, 'stuck').leftover.includes(stuckPid) && row(r, 'goes-on').state === 'RUN' && r.exit === 1, JSON.stringify([row(r, 'stuck'), stuckMs, stuckPid]));
    check('seo run: the run log records the pids that did not exit', stuckLog && JSON.stringify(stuckLog.leftover) === JSON.stringify(row(r, 'stuck').leftover) && stuckLog.state === 'FAILED', JSON.stringify(stuckLog));
    for (const p of row(r, 'stuck').leftover || []) if (pidAlive(p)) guard.killTree(p);

    // ================================================================ order, parallel, one step per host, heavy one at a time
    // The first step of a pair marks its start and PEEKS (up to 2.5 s) for its partner's mark: a runner that serialises never lets it see one; the pairs of the
    // control RENDEZVOUS (each waits for the other's mark, up to 20 s). Neither depends on how long node takes to start.
    const A = (id, ...more) => ['--id', id, '--hit', `{url}${id}`, '--out', `{pewp}/${id}.json`, ...more];
    const mk = id => ['--mark', `{work}/${id}.s`];
    const peeked = (st, id) => (rec(st).find(x => x.id === id && x.event === 'peek') || {}).sawOther;
    s = site(M(S('c1', { hits: 'client', args: A('c1', ...mk('c1'), '--peek', '{work}/c2.s') }), S('c2', { hits: 'client', args: A('c2', ...mk('c2')) }), S('c3', { hits: 'client', args: A('c3') })));
    max = 0;
    r = await run(s);
    check('seo run: three steps that hit the client never overlap (c1 never saw c2 start while it ran, the site never saw two requests at once, the spans are disjoint)', r.exit === 0 && peeked(s, 'c1') === false && max === 1 && !overlap(span(s, 'c1'), span(s, 'c2')) && !overlap(span(s, 'c1'), span(s, 'c3')) && !overlap(span(s, 'c2'), span(s, 'c3')), `peeked ${peeked(s, 'c1')}, max open ${max}`);
    s = site(M(S('t1', { hits: 'third-party:same.example', args: A('t1', ...mk('t1'), '--peek', '{work}/t2.s') }), S('t2', { hits: 'third-party:same.example', args: A('t2', ...mk('t2')) })));
    r = await run(s);
    check('seo run: two steps that hit the same third-party host never overlap either (t1 never saw t2 start while it ran)', r.exit === 0 && peeked(s, 't1') === false && !overlap(span(s, 't1'), span(s, 't2')), JSON.stringify([peeked(s, 't1'), span(s, 't1'), span(s, 't2')]));
    s = site(M(S('d1', { hits: 'third-party:one.example', args: A('d1', ...mk('d1'), '--rendezvous', '{work}/d2.s') }), S('d2', { hits: 'third-party:two.example', args: A('d2', ...mk('d2'), '--rendezvous', '{work}/d1.s') }), S('n1', { args: A('n1', ...mk('n1'), '--rendezvous', '{work}/n2.s') }), S('n2', { args: A('n2', ...mk('n2'), '--rendezvous', '{work}/n1.s') })));
    r = await run(s);
    check('seo run: steps that hit different hosts, or none, run in parallel (each pair waited for the other to start, so both were running at once: the control that makes the checks above able to fail)', r.exit === 0 && ['d1', 'd2', 'n1', 'n2'].every(id => row(r, id).state === 'RUN'), JSON.stringify(r.json.data.steps.map(x => [x.id, x.state, x.detail])));   // a barrier that never opened says so in its step's detail
    s = site(M(S('h1', { heavy: true, args: ['--id', 'h1', ...mk('h1'), '--peek', '{work}/h2.s', '--out', '{pewp}/h1.json'] }), S('h2', { heavy: true, args: ['--id', 'h2', ...mk('h2'), '--out', '{pewp}/h2.json'] }), S('o1', { args: ['--id', 'o1', '--out', '{pewp}/o1.json'] })));
    r = await run(s);
    const hv = rec(s).filter(x => x.id === 'heavy');
    const hs = ['h1', 'h2'].map(id => span(s, id));
    check('seo run: heavy steps run one at a time (h1 never saw h2 start while it ran, the spans are disjoint)', r.exit === 0 && peeked(s, 'h1') === false && !overlap(hs[0], hs[1]), JSON.stringify([peeked(s, 'h1'), hs]));
    check('seo run: every heavy step goes through heavy.mjs with the label "SEO run <client>: <id>"', hv.filter(x => x.event === 'start').map(x => x.label).sort().join('|') === 'SEO run demo: h1|SEO run demo: h2', JSON.stringify(hv));
    check('seo run: a step that is not heavy does not go through heavy.mjs (o1 ran, and no heavy.mjs call carries its label)', starts(s, 'o1') === 1 && !hv.some(x => String(x.label).includes('o1')), JSON.stringify(hv));

    // ================================================================ resume after a stop (the CLI process is killed in the middle of a step)
    const stopRepo = join(root, 'stop-repo');
    const stopSkill = join(stopRepo, ...SKILL);
    cpSync(join(FIX, 'skill'), stopSkill, { recursive: true });
    for (const f of ['lib-pipeline.mjs', 'lib-stops.mjs', 'lib-run.mjs']) cpSync(join(REPO_ROOT, ...SKILL, 'scripts', f), join(stopSkill, 'scripts', f));   // this child is a whole CLI process: it takes the rule engine from its repository at load
    withLeadEndpoint(stopRepo);
    cpSync(join(REPO_ROOT, 'tools', 'proc-guard'), join(stopRepo, 'tools', 'proc-guard'), { recursive: true, filter: f => !/[\\/]test([\\/]|$)/.test(f) });
    const stopManifest = slow => M(S('first'), S('slow', slow ? { script: 'scripts/hang.mjs', args: ['--id', 'slow', '--pidfile', '{work}/pid'], timeoutMinutes: 5, dependsOn: ['first'] } : { dependsOn: ['first'] }));
    writeFileSync(join(stopSkill, 'pipeline.json'), JSON.stringify(stopManifest(true)));
    const stopS = { skill: stopSkill, record: join(root, 'stop-record.jsonl'), pewp: join(stopSkill, 'site-checks', HOST, '.pewp'), work: join(stopSkill, 'site-checks', HOST, 'work') };
    // this child is a whole CLI process, so it runs the real skill check (P3.4 R1, no seam): stop-repo is a git checkout with its skill committed, at backup-gh/master,
    // and a skills folder of this test holds a junction to its copy of the skill
    const stopSkills = join(root, 'stop-skills');
    mkdirSync(stopSkills, { recursive: true });
    const stopGit = (...a) => { const x = spawnSync('git', ['-c', 'user.name=seotest', '-c', 'user.email=seotest@example.invalid', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${join(root, 'no-hooks')}`, ...a], { cwd: stopRepo, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|OBJECT_DIRECTORY|COMMON_DIR|NAMESPACE)$/.test(k))), encoding: 'utf8', timeout: 60000, windowsHide: true }); if (x.status !== 0) throw new Error(`git ${a.join(' ')}: ${x.error ? x.error.message : String(x.stderr).trim().split('\n')[0]}`); };
    stopGit('init', '-q'); stopGit('config', 'core.autocrlf', 'false'); stopGit('add', 'skills'); stopGit('commit', '-q', '-m', 'the skill'); stopGit('update-ref', 'refs/remotes/backup-gh/master', 'HEAD');
    symlinkSync(stopSkill, join(stopSkills, SKILL[1]), 'junction');
    const child = spawn(process.execPath, [join(CLI_ROOT, 'omnikom.mjs'), 'seo', 'run', URL_, '--client', 'demo', '--json'], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, OMNIKOM_REPO_ROOT: stopRepo, OMNIKOM_SKILLS_DIR: stopSkills, SEO_FIXTURE_RECORD: stopS.record }, windowsHide: true, stdio: 'ignore' });
    const reached = await until(() => starts(stopS, 'slow') === 1 && existsSync(join(stopS.work, 'pid')), 30000);
    const stopPid = Number(existsSync(join(stopS.work, 'pid')) ? readFileSync(join(stopS.work, 'pid'), 'utf8') : 0);
    guard.killTree(child.pid);
    await until(() => !pidAlive(child.pid), 6000);
    try { unlinkSync(join(stopSkills, SKILL[1])); } catch { rmdirSync(join(stopSkills, SKILL[1])); }   // the junction goes as a link, never through its target
    if (stopPid > 0) { await until(() => !pidAlive(stopPid), 6000); if (pidAlive(stopPid)) guard.killTree(stopPid); }
    check('seo resume: the run reached the slow step before it was stopped', reached, `slow started ${starts(stopS, 'slow')} times`);
    r = await go(stopS, ['status', URL_, '--json']);
    check('seo status after a stop: the finished step is RUN, the one that was running is FAILED (interrupted, no end recorded), nothing is started', row(r, 'first').state === 'RUN' && row(r, 'slow').state === 'FAILED' && row(r, 'slow').detail.includes('interrupted') && starts(stopS, 'slow') === 1, JSON.stringify(row(r, 'slow')));
    writeFileSync(join(stopSkill, 'pipeline.json'), JSON.stringify(stopManifest(false)));
    r = await resume(stopS);
    check('seo resume after a stop: the finished step is not run again, the interrupted one runs and the run ends clean', r.exit === 0 && starts(stopS, 'first') === 1 && starts(stopS, 'slow') === 2 && row(r, 'slow').state === 'RUN' && row(r, 'first').how === 'already done', JSON.stringify(states(r)));

    // ================================================================ --only, --from, --module, --fresh
    const chain = () => site(M(S('a'), S('b', { dependsOn: ['a'], inputs: ['{pewp}/a.json'] }), S('c', { dependsOn: ['b'], inputs: ['{pewp}/b.json'] }), S('d', { module: 'other' })));
    s = chain();
    r = await run(s);
    check('seo run: steps run in dependency order (b after a ended, c after b ended)', r.exit === 0 && span(s, 'a').b <= span(s, 'b').a && span(s, 'b').b <= span(s, 'c').a, JSON.stringify(rec(s)));
    const topo = site(M(S('late', { dependsOn: ['early'], inputs: ['{pewp}/early.json'], args: ['--id', 'late', '--read', '{pewp}/early.json', '--out', '{pewp}/late.json'] }), S('free'), S('early')));
    r = await run(topo);
    check('seo run: a manifest whose file order is not topological runs in a stable topological order (the first step in file order whose dependencies are placed), in the table too', r.exit === 0 && r.json.data.order.join() === 'free,early,late' && r.json.data.steps.map(x => x.id).join() === 'free,early,late' && span(topo, 'early').b <= span(topo, 'late').a && row(r, 'late').state === 'RUN', JSON.stringify([r.json.data.order, states(r)]));
    r = await run(s, ['--only', 'b', '--fresh']);
    check('seo run --only b --fresh: only b is redone', starts(s, 'a') === 1 && starts(s, 'b') === 2 && starts(s, 'c') === 1 && starts(s, 'd') === 1 && row(r, 'a').state === 'RUN', JSON.stringify([starts(s, 'a'), starts(s, 'b'), starts(s, 'c'), starts(s, 'd')]));
    r = await run(s, ['--only', 'b']);
    check('seo run --only b with b done does nothing (done is skipped) and still lists every step', starts(s, 'b') === 2 && r.json.data.steps.length === 4, JSON.stringify(starts(s, 'b')));
    r = await run(s, ['--from', 'b']);   // the same site: counts carry on (a 1, b 2, c 1, d 1 so far)
    check('seo run --from b: b and what depends on it run again, a and d do not', starts(s, 'a') === 1 && starts(s, 'b') === 3 && starts(s, 'c') === 2 && starts(s, 'd') === 1, JSON.stringify([starts(s, 'a'), starts(s, 'b'), starts(s, 'c'), starts(s, 'd')]));
    r = await run(s, ['--module', 'other', '--fresh']);
    check('seo run --module other --fresh: only the steps of that module are redone', starts(s, 'd') === 2 && starts(s, 'a') === 1 && starts(s, 'b') === 3 && starts(s, 'c') === 2, JSON.stringify([starts(s, 'a'), starts(s, 'b'), starts(s, 'c'), starts(s, 'd')]));
    s = chain();
    r = await run(s, ['--only', 'c']);
    check('seo run --only c on a new site: a and b are not selected, show NOT RUN, and c is BLOCKED by b (NOT RUN)', row(r, 'a').state === 'NOT RUN' && row(r, 'b').state === 'NOT RUN' && row(r, 'c').state === 'BLOCKED' && row(r, 'c').detail.includes('waits for b (NOT RUN)') && starts(s, 'a') === 0 && starts(s, 'd') === 0, JSON.stringify(states(r)));
    s = chain();
    r = await run(s, ['--only', 'a,d', '--module', 'other']);
    check('seo run: --only and --module together keep only the steps that satisfy both', starts(s, 'd') === 1 && starts(s, 'a') === 0, JSON.stringify([starts(s, 'a'), starts(s, 'd')]));
    r = await run(s, ['--only', 'zz']);
    check('seo run --only with an unknown id exits 2 and lists the steps', r.exit === 2 && r.json.error.includes("no step 'zz'") && r.json.error.includes('a, b, c, d'), r.all.slice(0, 300));
    r = await run(s, ['--from', 'zz']);
    check('seo run --from with an unknown id exits 2', r.exit === 2 && r.json.error.includes("no step 'zz'"), r.all.slice(0, 300));
    r = await run(s, ['--module', 'zz']);
    check('seo run --module with an unknown module exits 2 and lists the modules', r.exit === 2 && r.json.error.includes("no module 'zz'") && r.json.error.includes('m, other'), r.all.slice(0, 300));
    r = await run(s, ['--only', 'a', '--module', 'other']);
    check('seo run: filters that select no step exit 2', r.exit === 2 && r.json.error.includes('select no step'), r.all.slice(0, 300));

    // ================================================================ status runs nothing; usage rules
    s = site();
    r = await status(s);
    check('seo status with no run log: every step is NOT RUN, exit 0, and nothing is created or started', r.exit === 0 && r.json.data.hasLog === false && r.json.data.counts['NOT RUN'] === 9 && !existsSync(s.pewp) && rec(s).length === 0, r.all.slice(0, 300));
    r = await go(s, ['status', URL_]);
    check('seo status: text says there is no run log yet', r.stdout.includes('no run log yet') && /^NOT RUN +fx-ok /m.test(r.stdout), r.stdout.slice(0, 400));
    await run(s);
    const before = statSync(join(s.pewp, 'seo-run.json')).mtimeMs, recBefore = rec(s).length;
    await sleep(30);
    await status(s);
    check('seo status after a run starts nothing and does not write the log', rec(s).length === recBefore && statSync(join(s.pewp, 'seo-run.json')).mtimeMs === before, `${recBefore} -> ${rec(s).length}`);
    s = site(M(S('x')));
    r = await resume(s);
    check('seo resume with no run log exits 2 and says how to start one', r.exit === 2 && r.json.error.includes('no run log') && r.json.error.includes('omnikom seo run'), r.all.slice(0, 300));
    await run(s);
    r = await go(s, ['run', URL_, '--client', 'other', '--json']);
    check('seo run for another client than the log\'s exits 2 (a new run needs --fresh)', r.exit === 2 && r.json.error.includes("belongs to client 'demo'"), r.all.slice(0, 300));
    r = await go(s, ['resume', URL_, '--client', 'other', '--json']);
    check('seo resume --client that is not the run\'s exits 2', r.exit === 2 && r.json.error.includes('is not the client of this run'), r.all.slice(0, 300));
    r = await resume(s, ['--fresh']);
    check('seo resume --fresh exits 2 (a resume redoes nothing)', r.exit === 2 && r.json.error.includes('--fresh'), r.all.slice(0, 300));
    r = await go(s, ['run', URL_, '--json']);
    check('seo run without --client exits 2', r.exit === 2 && r.json.error.includes('--client'), r.all.slice(0, 300));
    r = await go(s, ['run', URL_, '--client', 'Bad Slug', '--json']);
    check('seo run with a client that is not a slug exits 2', r.exit === 2, r.all.slice(0, 300));
    r = await go(s, ['run', 'not a url', '--client', 'demo', '--json']);
    check('seo run with something that is not a url exits 2', r.exit === 2 && r.json.error.includes('not a url'), r.all.slice(0, 300));
    r = await go(s, ['run', '--client', 'demo', '--json']);
    check('seo run with no url exits 2', r.exit === 2 && r.json.error.includes('needs the site'), r.all.slice(0, 300));
    r = await go(s, ['run', URL_, '--client', 'demo', '--expect', 'ok', '--json']);
    check('seo run takes no --expect', r.exit === 2, r.all.slice(0, 300));
    r = await go(s, ['status', URL_, '--only', 'x', '--json']);
    check('seo status takes no --only (it runs and filters nothing)', r.exit === 2, r.all.slice(0, 300));
    r = await go(s, ['dance', URL_]);
    check('seo with an unknown verb exits 2', r.exit === 2 && r.stdout.includes('seo takes run | resume | status | vantage'), r.all.slice(0, 300));
    r = await go(s, ['run', URL_, '--client', 'demo', '--env-file', join(root, 'no-such.env'), '--json']);
    check('seo run with an --env-file that cannot be read exits 2', r.exit === 2 && r.json.error.includes('--env-file is not readable'), r.all.slice(0, 300));
    r = await go(s, ['run', URL_, '--client', 'demo']);
    check('seo run text mode: a header line, the table and the counts', r.exit === 0 && r.stdout.startsWith('mode RESUME: ') && r.stdout.split('\n')[1].startsWith(`seo run: ${URL_}  client demo  host ${HOST}`) && r.stdout.includes('STATE    STEP MODULE DETAIL') && r.stdout.includes('counts: RUN 1,'), r.stdout.slice(0, 400));

    // ================================================================ keys: only through with-env, only to the steps that name them, never printed
    const envFile = join(root, 'fixture.env');
    writeFileSync(envFile, `FIXTURE_KEY=${KEY}\nFIXTURE_OTHER=${KEY}2\n`);
    s = site(M(S('with-key', { script: 'scripts/keys.mjs', needsKeys: ['FIXTURE_KEY'] }), S('no-key', { script: 'scripts/keys.mjs' }), S('leaky', { script: 'scripts/leak.mjs', needsKeys: ['FIXTURE_KEY'] })));
    r = await run(s, ['--env-file', envFile]);
    const seen = id => JSON.parse(readFileSync(join(s.pewp, `${id}.json`), 'utf8'));
    check('seo run --env-file: a step that names a key gets the file\'s variables (through with-env), the key check passes', row(r, 'with-key').state === 'RUN' && seen('with-key').FIXTURE_KEY === true && seen('with-key').OMNIKOM_ENV_FILE === true, JSON.stringify(row(r, 'with-key')));
    check('seo run --env-file: a step that names no key does not get them', row(r, 'no-key').state === 'RUN' && seen('no-key').FIXTURE_KEY === false && seen('no-key').OMNIKOM_ENV_FILE === false, JSON.stringify(seen('no-key')));
    const everything = r.all + readFileSync(join(s.pewp, 'seo-run.json'), 'utf8') + readFileSync(join(s.pewp, 'seo-run', 'leaky.log'), 'utf8');
    check('seo run: a key a script prints is masked in the quoted line, the log and the step log', row(r, 'leaky').state === 'BLOCKED' && row(r, 'leaky').line.includes('<redacted:FIXTURE_KEY>') && !everything.includes(KEY), row(r, 'leaky').line);
    r = await go(s, ['status', URL_]);
    check('seo status text never shows a key either', !r.all.includes(KEY), r.all.slice(0, 200));

    // ================================================================ vantage: a pass-through
    s = site();
    r = await go(s, ['vantage', 'status', '--json', '--pewp', 'some/dir']);
    check('seo vantage status: the script\'s own stdout and stderr, unchanged (not wrapped), exit 0', r.exit === 0 && r.stdout === 'vantage-args ["status","--json","--pewp","some/dir"]\n' && r.stderr === 'vantage-stderr line\n', JSON.stringify([r.stdout, r.stderr, r.exit]));
    r = await go(s, ['vantage', 'start']);
    check('seo vantage start is refused (status only)', r.exit === 2 && r.stdout.includes('seo vantage takes status'), r.all.slice(0, 200));
    r = await go(s, ['vantage', 'stop']);
    check('seo vantage stop is refused (status only)', r.exit === 2 && r.stdout.includes('seo vantage takes status'), r.all.slice(0, 200));
    r = await go(s, ['vantage', 'status'], { FIXTURE_VANTAGE_EXIT: '3' });
    check('seo vantage: exit 3 comes back as 3 with the script\'s BLOCKED line unchanged', r.exit === 3 && r.stdout.endsWith('BLOCKED: the owner browser is not open | unblocks: omnikom seo vantage start\n'), JSON.stringify([r.stdout, r.exit]));
    r = await go(s, ['vantage', 'status'], { FIXTURE_VANTAGE_EXIT: '2' });
    check('seo vantage: exit 2 comes back as 2', r.exit === 2, JSON.stringify([r.stdout, r.exit]));
    // S1: seo run and seo resume run the skill check first; a failing one is exit 2 and no step starts
    {
      const sk = site();
      const failing = { skillCheck: () => ({ ok: false, problems: ['p1'] }) };
      const ra = await run(sk, [], {}, failing);
      const rb = await resume(sk, [], {}, failing);
      check('seo run and seo resume: a failing skill check is exit 2, "skill check pewp failed: p1", and no step started (S1)', ra.exit === 2 && ra.json.error === 'skill check pewp failed: p1' && rb.exit === 2 && rb.json.error === 'skill check pewp failed: p1' && rec(sk).length === 0, JSON.stringify([ra.exit, ra.json && ra.json.error, rb.exit, rb.json && rb.json.error, rec(sk).length]));
    }
    // S2: the script's exit 4 (SKIPPED: no allowed US egress) comes back as 3, with the script's own lines
    r = await go(s, ['vantage', 'status'], { FIXTURE_VANTAGE_EXIT: '4' });
    check('seo vantage: exit 4 (SKIPPED: no allowed US egress) comes back as 3, the script\'s SKIPPED line is the last line (S2)', r.exit === 3 && r.stdout.endsWith('SKIPPED: no allowed US egress\n'), JSON.stringify([r.stdout, r.exit]));
    rmSync(join(s.skill, 'scripts', 'vantage.mjs'));
    r = await go(s, ['vantage', 'status']);
    check('seo vantage: a missing script is BLOCKED (exit 3) and names it', r.exit === 3 && r.stdout.startsWith('ERROR vantage.mjs is not at ') && r.stdout.includes('scripts/vantage.mjs') && r.stdout.includes('unblocks:'), r.all.slice(0, 300));
    r = await go(s, ['vantage', 'dance']);
    check('seo vantage with an unknown verb exits 2', r.exit === 2 && r.stdout.includes('seo vantage takes status'), r.all.slice(0, 200));
    r = await go(s, ['vantage', 'status', '--fresh']);
    check('seo vantage takes only --json and --pewp', r.exit === 2 && r.stdout.includes('only --json and --pewp'), r.all.slice(0, 200));
    s = site(M(S('vantage', { script: 'scripts/vantage.mjs', args: ['status', '--pewp', '{pewp}'], outputs: ['{pewp}/vantage.json'], evidence: ['{pewp}/vantage.json'] }), S('after-vantage', { dependsOn: ['vantage'] })));
    writeFileSync(join(s.skill, 'scripts', 'vantage.mjs'), readFileSync(join(FIX, 'skill', 'scripts', 'vantage.mjs'), 'utf8').replace("console.log(`vantage-args", "(await import('node:fs')).mkdirSync(process.argv[4], { recursive: true }); (await import('node:fs')).writeFileSync(process.argv[4] + '/vantage.json', '{\"checks\":[]}'); console.log(`vantage-args"));
    r = await run(s);
    check('seo run: a vantage step is an ordinary step (its status is read, its dependents go on) and the run never calls start', row(r, 'vantage').state === 'RUN' && row(r, 'after-vantage').state === 'RUN' && rec(s).filter(x => x.id === 'vantage').every(x => x.args[0] === 'status') && rec(s).filter(x => x.id === 'vantage').length === 1, JSON.stringify(rec(s)));
    // ================================================================ engine stops (a robot check on google, a ban): the step never starts [stops]
    {
      const stops = join(root, 'stops');
      mkdirSync(stops, { recursive: true });
      const stopFile = (engine, until, reason = 'robot check: unusual traffic') => writeFileSync(join(stops, `${engine}.json`), JSON.stringify({ engine, hosts: [`${engine}.com`], until, reason, setBy: 'test', setAt: new Date().toISOString(), evidence: 'x' }));
      const live = new Date(Date.now() + 3600000).toISOString();
      stopFile('google', live);
      let s2 = site(M(S('g', { engines: ['google'] }), S('g-after', { dependsOn: ['g'] }), S('free'), W('cap-g', { engines: ['google'] }), S('cc', { engines: ['commoncrawl'] })));
      let r2 = await run(s2, [], {}, { stopsDir: stops });
      check('seo run: a live google stop BLOCKS the google step, which never starts, and names the engine, the end time and the reason [stops]',
        row(r2, 'g').state === 'BLOCKED' && starts(s2, 'g') === 0 && row(r2, 'g').detail.includes(`google is stopped until ${live}`) && row(r2, 'g').detail.includes('robot check: unusual traffic') && row(r2, 'g').detail.includes('unblocks: wait until then'), JSON.stringify(row(r2, 'g')));
      check('seo run: a waiting step on a stopped engine is BLOCKED, not handed to an agent as WAITING [stops]', row(r2, 'cap-g').state === 'BLOCKED' && row(r2, 'cap-g').detail.includes('google is stopped'), JSON.stringify(row(r2, 'cap-g')));
      check('seo run: the stopped step\'s dependents are BLOCKED by it; steps on other engines or none run [stops]',
        row(r2, 'g-after').state === 'BLOCKED' && starts(s2, 'g-after') === 0 && row(r2, 'free').state === 'RUN' && row(r2, 'cc').state === 'RUN', JSON.stringify(states(r2)));
      writeFileSync(join(stops, 'google.json'), JSON.stringify({ engine: 'google', hosts: ['google.com'], until: live, reason: 'robot check', setBy: 'test', setAt: new Date().toISOString(), evidence: 'x', lift: { mode: 'desktop', by: 'owner', at: new Date().toISOString(), note: 'his own Edge, human pace' } }));
      s2 = site(M(S('g', { engines: ['google'] }), W('cap-g', { engines: ['google'] }), W('cap-ai', { engines: ['google'], needsBrowser: 'none', needsAi: true })));
      r2 = await run(s2, [], {}, { stopsDir: stops });
      check('seo run: a stop lifted for desktop frees only the owner-browser capture (WAITING); the script step stays BLOCKED until the stop ends, and so does a non-browser waiting step [stops]',
        row(r2, 'cap-g').state === 'WAITING' && row(r2, 'g').state === 'BLOCKED' && starts(s2, 'g') === 0 && row(r2, 'g').detail.includes(`google is stopped until ${live}`) && row(r2, 'cap-ai').state === 'BLOCKED', JSON.stringify(states(r2)));
      stopFile('google', new Date(Date.now() - 60000).toISOString());
      s2 = site(M(S('g', { engines: ['google'] })));
      r2 = await run(s2, [], {}, { stopsDir: stops });
      check('seo run: an expired stop counts as absent: the step runs, and the stop file stays as a record [stops]', row(r2, 'g').state === 'RUN' && starts(s2, 'g') === 1 && existsSync(join(stops, 'google.json')), JSON.stringify(row(r2, 'g')));
      writeFileSync(join(stops, 'google.json'), '{ not json');
      s2 = site(M(S('g', { engines: ['google'] })));
      r2 = await run(s2, [], {}, { stopsDir: stops });
      check('seo run: an unreadable stop file stops the engine (fail closed) and says so [stops]', row(r2, 'g').state === 'BLOCKED' && starts(s2, 'g') === 0 && row(r2, 'g').detail.includes('google is stopped') && row(r2, 'g').detail.includes('unreadable'), JSON.stringify(row(r2, 'g')));
      writeFileSync(join(stops, 'google.json'), JSON.stringify({ engine: 'google', reason: 'x' }));
      s2 = site(M(S('g', { engines: ['google'] })));
      r2 = await run(s2, [], {}, { stopsDir: stops });
      check('seo run: a stop file with no valid until stops the engine (fail closed) [stops]', row(r2, 'g').state === 'BLOCKED' && starts(s2, 'g') === 0 && row(r2, 'g').detail.includes('google is stopped') && row(r2, 'g').detail.includes('unreadable'), JSON.stringify(row(r2, 'g')));
      rmSync(join(stops, 'google.json'));
      stopFile('bing', live, 'bing said no');
      s2 = site(M(S('ab', { engines: ['google', 'bing'] })));
      r2 = await run(s2, [], {}, { stopsDir: stops });
      check('seo run: a step on two engines is stopped when either one is [stops]', row(r2, 'ab').state === 'BLOCKED' && starts(s2, 'ab') === 0 && row(r2, 'ab').detail.includes('bing is stopped'), JSON.stringify(row(r2, 'ab')));
    }
    // ================================================================ modes: RESUME (default, adopts) and FRESH (owner 2026-11-11) [modes]
    {
      p = broke(m => { step(m, 'fx-ok').kind = 'stable'; step(m, 'fx-ok').maxAgeDays = 90; step(m, 'fx-read').kind = 'derived'; step(m, 'fx-read').maxAgeDays = null; step(m, 'fx-wait').kind = 'time-sensitive'; step(m, 'fx-wait').maxAgeDays = 0; });
      check('seo validator: kind (stable | time-sensitive | derived) and maxAgeDays (a number of 0 or more, or null) are accepted [modes]', p.length === 0, p.join(' | '));
      p = broke(m => { step(m, 'fx-ok').kind = 'sometimes'; step(m, 'fx-read').maxAgeDays = -1; });
      check('seo validator: another kind and a maxAgeDays below 0 are refused [modes]', has(p, 'kind must be stable, time-sensitive or derived') && has(p, 'maxAgeDays must be null or a number of 0 or more'), p.join(' | '));
      // evidence already on disk from an earlier run that left no log (a manual run, an older tool): a plain run adopts it and never starts the step
      const sa = site(M(S('a1'), S('a2', { dependsOn: ['a1'] }), S('a3')));
      mkdirSync(sa.pewp, { recursive: true });
      writeFileSync(join(sa.pewp, 'a1.json'), '{"done":true}');
      writeFileSync(join(sa.pewp, 'a3.json'), '');   // empty: not valid evidence, so a3 runs
      let ra = await run(sa);
      check('seo run: with valid evidence already there and no log, a plain run ADOPTS the step (RUN, adopted) and never starts it; its dependent runs; an empty file is not adopted [modes]',
        row(ra, 'a1').state === 'RUN' && starts(sa, 'a1') === 0 && ra.json.data.steps.find(x => x.id === 'a1') && row(ra, 'a2').state === 'RUN' && starts(sa, 'a2') === 1 && starts(sa, 'a3') === 1, JSON.stringify({ states: states(ra), a1: starts(sa, 'a1'), a3: starts(sa, 'a3') }));
      check('seo run: the mode is RESUME by default and is the first line of the text output [modes]', ra.json.data.mode === 'RESUME', JSON.stringify(ra.json.data.mode));
      const text = await go(sa, ['run', URL_, '--client', 'demo']);
      check('seo run (text): the first line names the mode RESUME [modes]', /^mode RESUME: finishing the existing run/.test(text.stdout), text.stdout.split('\n')[0]);
      ra = await run(sa);
      check('seo run: a second plain run re-runs nothing (adopted and done steps stay done) [modes]', starts(sa, 'a1') === 0 && starts(sa, 'a2') === 1 && starts(sa, 'a3') === 1, JSON.stringify(rec(sa).filter(x => x.event === 'start').map(x => x.id)));
      const rf = await run(sa, ['--fresh']);
      check('seo run --fresh: the mode is FRESH, it names what it discards, and every step runs again [modes]',
        rf.json.data.mode === 'FRESH' && ['a1', 'a2', 'a3'].every(id => rf.json.data.discarded.includes(id)) && starts(sa, 'a1') === 1 && starts(sa, 'a2') === 2, JSON.stringify({ mode: rf.json.data.mode, discarded: rf.json.data.discarded }));
      const tf = await go(sa, ['run', URL_, '--client', 'demo', '--fresh']);
      check('seo run --fresh (text): the first line says FRESH and lists the discarded steps [modes]', /^mode FRESH: starting over \(--fresh\); discarded 3 step\(s\) done before: a1, a2, a3/.test(tf.stdout), tf.stdout.split('\n')[0]);
      // a failure the log knows is not adopted away, even when a file is there
      const sb = site(M(S('b1', { script: 'scripts/fail.mjs' })));
      await run(sb);
      mkdirSync(sb.pewp, { recursive: true }); writeFileSync(join(sb.pewp, 'b1.json'), '{"x":1}');
      const rb = await run(sb);
      check('seo run: a step the log records as FAILED is not adopted from a file that appeared later; it runs again [modes]', starts(sb, 'b1') === 2 && !(rb.json.data.steps.find(x => x.id === 'b1') || {}).adopted, JSON.stringify(states(rb)));
    }
    // ================================================================ one engine (P3.4 R2) [engine]
    // The skill's lib-pipeline.mjs is the ONE rule engine; seo-manifest.mjs only re-exports it. L(m) is the engine's problems for a manifest, C(m) is `seo status <URL_> --json` on site(m):
    // a refused manifest has its rule in L and is exit 2 with that problem's describe in C; an accepted one is ok in L and exit 0 in C.
    {
      const LIB = await import(pathToFileURL(join(REPO_ROOT, ...SKILL, 'scripts', 'lib-pipeline.mjs')).href);
      const L = m => { try { return LIB.validateManifest(m, vopts).problems; } catch (e) { return [{ rule: 'threw', step: null, detail: e.message }]; } };
      const C = m => go(site(m), ['status', URL_, '--json']);
      const BASE = () => M(S('a'), S('b', { dependsOn: ['a'] }), W('w'));
      const hit = (m, id) => m.steps.find(x => x.id === id);
      const TABLE = [
        [1, "a's exit {4: partial}", m => { hit(m, 'a').exit = { 4: 'partial: r' }; }, 'exit'],
        [2, "a's exit {5: failed}", m => { hit(m, 'a').exit = { 5: 'failed: x' }; }, 'exit'],
        [3, "a's exit {3: blocked, 4: skipped}", m => { hit(m, 'a').exit = { 3: 'blocked: x', 4: 'skipped: n' }; }, 'ok'],
        [4, 'a without kind', m => { delete hit(m, 'a').kind; }, 'required-key'],
        [5, 'a maxAgeDays of 0', m => { hit(m, 'a').maxAgeDays = 0; }, 'ok'],
        [6, 'a maxAgeDays of -1', m => { hit(m, 'a').maxAgeDays = -1; }, 'type'],
        [7, "a's script repo:tools/nope.mjs", m => { hit(m, 'a').script = 'repo:tools/nope.mjs'; }, 'script-missing'],
        [8, "a's script repo:tools/with-env.mjs", m => { hit(m, 'a').script = 'repo:tools/with-env.mjs'; }, 'ok'],
        [9, "b's id b--x", m => { hit(m, 'b').id = 'b--x'; }, 'id'],
        [10, "a's module Alpha", m => { hit(m, 'a').module = 'Alpha'; }, 'module'],
        [11, 'a without pace', m => { delete hit(m, 'a').pace; }, 'required-key'],
        [12, 'no top name', m => { delete m.name; }, 'top-level'],
        [13, 'vars with a name that is no placeholder', m => { m.vars = { nope: 'x' }; }, 'vars'],
        [14, 'a top key extra', m => { m.extra = 1; }, 'top-level'],
        [15, 'a top key coverage', m => { m.coverage = {}; }, 'ok'],
        [16, "a's hits third-party:A B", m => { hit(m, 'a').hits = 'third-party:A B'; }, 'hits'],
        [17, "a's engines []", m => { hit(m, 'a').engines = []; }, 'engines'],
        [18, "a's engines [yahoo]", m => { hit(m, 'a').engines = ['yahoo']; }, 'engines'],
        [19, "a's engines [trustpilot]", m => { hit(m, 'a').engines = ['trustpilot']; }, 'ok'],
        [20, "a's evidence []", m => { hit(m, 'a').evidence = []; }, 'evidence'],
        [21, "a's evidence with **", m => { hit(m, 'a').evidence = ['{pewp}/**/a.json']; }, 'evidence'],
        [22, "a's evidence outside every output and input", m => { hit(m, 'a').evidence = ['{pewp}/z/a.json']; }, 'evidence'],
        [23, "a's evidence a glob inside its output folder", m => { hit(m, 'a').outputs = ['{pewp}/d/']; hit(m, 'a').evidence = ['{pewp}/d/*.json']; }, 'ok'],
        [24, "a's script scripts/x.py", m => { hit(m, 'a').script = 'scripts/x.py'; }, 'script'],
        [25, "a's script ../x.mjs", m => { hit(m, 'a').script = '../x.mjs'; }, 'script'],
        [26, "a's script with a placeholder", m => { hit(m, 'a').script = 'scripts/{host}.mjs'; }, 'placeholder'],
        [27, 'w with args', m => { hit(m, 'w').args = ['x']; }, 'waiting'],
        [28, 'w with no outputs', m => { hit(m, 'w').outputs = []; }, 'waiting'],
        [29, 'a with a timeout of 0', m => { hit(m, 'a').timeoutMinutes = 0; }, 'timeout'],
      ];
      for (const [n, what, change, verdict] of TABLE) {
        const m = BASE(); change(m);
        const problems = L(m), r = await C(m);
        const want = verdict === 'ok' ? null : problems.find(p => p.rule === verdict);
        const ok = verdict === 'ok' ? problems.length === 0 && r.exit === 0 : Boolean(want) && r.exit === 2 && Boolean(r.json) && String(r.json.error).includes(LIB.describe(want));
        check(`seo one engine: case ${n}, ${what}: ${verdict === 'ok' ? 'accepted' : `refused, rule ${verdict}`} [engine]`, ok, JSON.stringify({ rules: problems.map(p => p.rule), exit: r.exit, error: r.json && r.json.error }).slice(0, 600));
      }
      // 30: the variables of a run (the golden), and a script path resolved against the repository or the skill
      let vars30 = null, script30 = null;
      try {
        const E = await lib('seo-manifest.mjs');
        const data = '/m/clients/demo/private/pewp/example.com/2026-01-01-1';
        vars30 = E.makeVars({ url: 'https://www.example.com/x', client: 'demo', skillDir: '/s', data });
        script30 = E.resolveScript('repo:tools/site-backup/backup.mjs', { skillDir: '/s', repoRoot: '/r' });
      } catch (e) { vars30 = { threw: e.message }; }
      const data30 = '/m/clients/demo/private/pewp/example.com/2026-01-01-1';
      const golden30 = { url: 'https://www.example.com/x', client: 'demo', host: 'example.com', skill: '/s', data: data30, runDir: `${data30}/site-checks/example.com`, pewp: `${data30}/site-checks/example.com/.pewp`, work: `${data30}/site-checks/example.com/work` };
      check('seo one engine: case 30, makeVars gives the golden variables ({data} is the run, work under its site folder) and resolveScript puts a repo: script under the repository [engine]', JSON.stringify(Object.entries(vars30 || {}).sort()) === JSON.stringify(Object.entries(golden30).sort()) && script30 === join('/r', 'tools/site-backup/backup.mjs'), JSON.stringify([vars30, script30]));
      // 31: the options of seo run are the engine's list; an option outside it is refused
      const runOptions = ['client', 'only', 'from', 'module', 'fresh', 'env-file', 'json'];
      const stage = await go(site(), ['run', URL_, '--client', 'demo', '--stage', 'x', '--json']);
      check('seo one engine: case 31, RUN_OPTIONS is client, only, from, module, fresh, env-file, json and seo run takes no other (--stage is exit 2) [engine]', JSON.stringify(LIB.RUN_OPTIONS) === JSON.stringify(runOptions) && stage.exit === 2 && Boolean(stage.json) && stage.json.error === 'seo run takes no --stage', JSON.stringify([LIB.RUN_OPTIONS, stage.exit, stage.json && stage.json.error]));
      // 32: T3, the CLI holds no copy of a rule: seo-manifest.mjs is the engine's names (the same objects), and no other CLI lib file (the stop code apart) defines a key list or a word table
      const reexport = await lib('seo-manifest.mjs');
      const names = Object.keys(reexport);
      const notSame = names.filter(k => reexport[k] !== LIB[k]);
      const libDir = join(CLI_ROOT, 'lib');
      const copies = readdirSync(libDir).filter(f => f.endsWith('.mjs') && f !== 'stops.mjs').filter(f => /\b(STEP_KEYS|TOP_KEYS|EXIT_WORDS|KNOWN_ENGINES)\s*=/.test(readFileSync(join(libDir, f), 'utf8')));
      check('seo one engine: case 32, every export of seo-manifest.mjs is the engine\'s own object and no CLI lib file (stops.mjs apart) defines STEP_KEYS, TOP_KEYS, EXIT_WORDS or KNOWN_ENGINES [engine]', names.length > 0 && notSame.length === 0 && copies.length === 0, JSON.stringify({ names: names.length, notSame, copies }));
    }
    // ================================================================ what a resume takes over (SKILL-ADOPT-1) [adopt]
    {
      const D = 86400000, H = 3600000, REC = '{"step":"x","status":"blocked","blocked":"set FIXTURE_KEY"}', how = (r, id) => String((row(r, id) || {}).how || '');
      const put = (s, rel, body, ms) => { const f = join(s.pewp, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, body); if (ms) touch(f, ms); return f; };
      const sg = site(M(S('old', { kind: 'time-sensitive', maxAgeDays: 1 }), S('young', { kind: 'time-sensitive', maxAgeDays: 1 }), S('free'), S('v0', { kind: 'time-sensitive', maxAgeDays: 0 })));
      put(sg, 'old.json', '{"x":1}', -2 * D - H); put(sg, 'young.json', '{"x":1}', -H); put(sg, 'free.json', '{"x":1}', -10 * D); put(sg, 'v0.json', '{"x":1}', -H);
      let r = await run(sg);
      check('seo adopt: C1 evidence older than its maxAgeDays is not adopted: the step runs, its row says "over age: 2.0 days, limit 1" [adopt]', starts(sg, 'old') === 1 && row(r, 'old').state === 'RUN' && how(r, 'old') === 'over age: 2.0 days, limit 1', JSON.stringify(row(r, 'old')));
      check('seo adopt: C2 within the limit (1 hour of 1 day) or with no limit (null, 10 days) the step is adopted, not run [adopt]', starts(sg, 'young') === 0 && starts(sg, 'free') === 0 && how(r, 'young') === 'adopted' && how(r, 'free') === 'adopted', JSON.stringify(states(r)));
      check('seo adopt: C3 maxAgeDays 0 adopts nothing from before the run: the step runs [adopt]', starts(sg, 'v0') === 1, JSON.stringify(row(r, 'v0')));
      touch(join(sg.pewp, 'young.json'), -2 * D - H); r = await run(sg);
      check('seo adopt: C4 a step the log holds as adopted runs again once its evidence is over age [adopt]', starts(sg, 'young') === 1 && how(r, 'young') === 'over age: 2.0 days, limit 1', JSON.stringify(row(r, 'young')));
      const AP = (id, over = {}) => W(id, { needsBrowser: 'none', needsPerson: true, inputs: [`{pewp}/${id}-src.json`], outputs: [`{pewp}/approved/${id}.json`], evidence: [`{pewp}/approved/${id}.json`], ...over });
      const sp = site(M(AP('same'), AP('diff'), AP('cap', { needsPerson: false, needsBrowser: 'owner' })));
      for (const id of ['same', 'diff', 'cap']) { put(sp, `approved/${id}.json`, '{"q":1}', -2 * H); put(sp, `${id}-src.json`, id === 'diff' ? '{"q":2}' : '{"q":1}', -H); }
      r = await run(sp);
      check('seo adopt: C5 an approval whose newer input has the approved copy\'s own bytes is adopted [adopt]', row(r, 'same').state === 'RUN' && how(r, 'same') === 'adopted', JSON.stringify(row(r, 'same')));
      check('seo adopt: C6 an approval whose newer input has other bytes is WAITING [adopt]', row(r, 'diff').state === 'WAITING', JSON.stringify(row(r, 'diff')));
      check('seo adopt: C7 an owner capture with a newer input of the same bytes is WAITING (only an approval compares bytes) [adopt]', row(r, 'cap').state === 'WAITING', JSON.stringify(row(r, 'cap')));
      r = await run(sp);
      check('seo adopt: C8 on the next run the adopted approval stays RUN (already done), not WAITING [adopt]', row(r, 'same').state === 'RUN' && how(r, 'same') === 'already done', JSON.stringify(row(r, 'same')));
      const sk = site(M(S('bl', { needsKeys: ['FIXTURE_KEY'] }), S('bl2'), W('caps', { outputs: ['{pewp}/captures/caps/'], evidence: ['{pewp}/captures/caps/*.json'] }), S('was')));
      put(sk, 'bl.json', REC); put(sk, 'bl2.json', REC); put(sk, 'captures/caps/a.json', REC, -H); put(sk, 'captures/caps/b.json', '{"rows":1}', -H);
      r = await run(sk);
      check('seo adopt: C9 a BLOCKED record is not adopted: BLOCKED by its key, nothing started, the row quotes the record\'s unblock text [adopt]', row(r, 'bl').state === 'BLOCKED' && starts(sk, 'bl') === 0 && row(r, 'bl').detail.includes('holds only BLOCKED records: set FIXTURE_KEY'), JSON.stringify(row(r, 'bl')));
      check('seo adopt: C10 a step whose evidence is a BLOCKED record runs [adopt]', starts(sk, 'bl2') === 1 && row(r, 'bl2').state === 'RUN', JSON.stringify(row(r, 'bl2')));
      check('seo adopt: C11 one BLOCKED record among real files is still a result: the capture is adopted [adopt]', row(r, 'caps').state === 'RUN' && how(r, 'caps') === 'adopted', JSON.stringify(row(r, 'caps')));
      writeFileSync(join(sk.pewp, 'was.json'), REC); r = await run(sk);
      check('seo adopt: C12 a step the log holds as RUN whose evidence became a BLOCKED record runs again [adopt]', starts(sk, 'was') === 2 && how(r, 'was').includes('holds only BLOCKED records'), JSON.stringify(row(r, 'was')));
    }
  } catch (e) {
    if (!(e && e.seoDeadline)) throw e;
    try { guard.killFolderProcs(root); } catch { /* the list of processes failed; the folder removal below may then fail too */ }   // whatever the command left running under the test folder
    check(`seo: every command returns in time (${e.message})`, false, 'the step or barrier it was waiting for never finished; the processes under the test folder were stopped and the file ends here');
  } finally {
    server.close();
    try { rmSync(root, { recursive: true, force: true }); } catch { /* a process of a failed test may still hold a file; the OS temp cleanup takes it */ }
  }
}
