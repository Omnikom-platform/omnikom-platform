// Tests for `omnikom session start head|lane` and `omnikom helper run <job-id>` (P3.2 B3): commands/session.mjs (the CRLF launcher of a head or a lane,
// its window, the start registry, the name forms) and commands/helper.mjs (one headless `claude -p` for one job row, waited for, its markers cleared).
//   node tools/omnikom-cli/test/session.mjs [--bail] [--time]      exit 0 = every check passed, 1 = a check failed; lines start with "ok  " or "FAIL "
// No database, no network, no window, no claude: every case hands the CLI a fake `open` and a fake `run` (deps), so no case and no seeded fault can open a window or
// start a process. claudeExe is an empty file in the temp root, and every machine file, launch folder and start file is this test's own (OMNIKOM_MACHINE_FILE,
// OMNIKOM_LAUNCH_DIR, OMNIKOM_STARTS_FILE), all in one temp folder removed in a finally. The code under test is reached only through `cli` (and one import
// for the name patterns), so test/mutate.mjs can run this file against a broken COPY of the CLI.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, realpathSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function sessionTests({ check, cli, CLI_ROOT, REPO_ROOT, lib }) {
  void REPO_ROOT; void lib;
  const root = mkdtempSync(join(tmpdir(), 'omnikom-session-'));
  try {
    // local 09:05 on 2026-11-12, in seconds (the CLI's clock is deps.now)
    const NOW = Math.floor(new Date(2026, 10, 12, 9, 5).getTime() / 1000);
    const exe = join(root, 'claude.exe'), ws = join(root, 'ws'), brief = join(root, 'brief.json');
    writeFileSync(exe, '');
    mkdirSync(ws);
    writeFileSync(brief, '{}');
    const machine = join(root, 'machine.json');
    writeFileSync(machine, JSON.stringify({ claudeExe: exe, workspaceDir: ws }));
    const machineOf = (name, obj) => { const f = join(root, `${name}.json`); writeFileSync(f, JSON.stringify(obj)); return f; };

    // the launch folder is never made by the test: the code makes it (S5 is the one case that reaches it; every other case has its own, so one case's fault cannot show in another)
    const launchOf = id => join(root, id === 'S5' ? 'launch' : `launch-${id}`);
    const startsOf = id => join(root, `${id}.jsonl`);
    const E = id => ({ OMNIKOM_MACHINE_FILE: machine, OMNIKOM_LAUNCH_DIR: launchOf(id), OMNIKOM_STARTS_FILE: startsOf(id) });

    // one run of the CLI with a fake open (name, launcher) and a fake run (cmd, args, opts) that answers `answer`
    const go = async (id, argv, { env = {}, answer = { status: 0, stdout: '' } } = {}) => {
      const opened = [], ran = [];
      const deps = { now: () => NOW, open: (name, launcher) => { opened.push([name, launcher]); }, run: async (cmd, args, opts) => { ran.push({ cmd, args, opts }); return answer; } };
      const r = await cli(argv, { ...E(id), ...env }, deps);
      return { r, opened, ran, id };
    };
    const shown = ({ r }) => ({ exit: r.exit, code: r.json && r.json.code, error: r.json && r.json.error, data: r.json && r.json.data, target: r.json && r.json.target });
    // nothing opened, nothing run, nothing written
    const idle = ({ opened, ran, id }) => opened.length === 0 && ran.length === 0 && !existsSync(launchOf(id)) && !existsSync(startsOf(id));
    const nothingStarted = ({ ran, id }) => ran.length === 0 && !existsSync(startsOf(id));
    const diffAt = (a, b) => {
      const x = String(a).split('\r\n'), y = String(b).split('\r\n');
      const i = x.findIndex((l, k) => l !== y[k]);
      return i < 0 ? `lengths ${x.length}/${y.length}` : `line ${i + 1}: got ${JSON.stringify(x[i])}, want ${JSON.stringify(y[i])}`;
    };

    // sc: one case in a try; fn returns [true | false, what was found]
    const sc = async (name, fn) => {
      let ok = false, detail = '';
      try {
        const [good, info] = await fn();
        ok = good === true;
        detail = ok ? '' : JSON.stringify(info === undefined ? null : info);
      } catch (e) { detail = `threw ${e && e.name}: ${e && e.message}`; }
      check(`session: ${name}`, ok, detail);
    };
    // parts: [what, held][] -> [every part held, the names of the parts that did not]
    const parts = list => { const bad = list.filter(([, held]) => !held).map(([what]) => what); return [bad.length === 0, bad]; };

    // the ten markers a child must not inherit, in the launcher's order (written out here, not read from the code)
    const TEN = ['CLAUDE_CODE_BRIDGE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENABLE_CFC', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_MESSAGING_SOCKET',
      'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_PID', 'CLAUDECODE'];
    const HEAD_NAME = 'HEAD-OF-OPERATIONS_Fable_2026-11-12';
    const HEAD_TEXT = [
      '@echo off',
      `rem Written by omnikom session start: ${HEAD_NAME}`,
      ...TEN.map(m => `set ${m}=`),
      'set OMNIKOM_SESSION_KIND=head',
      `title ${HEAD_NAME}`,
      `cd /d "${ws}"`,
      `"${exe}" --name ${HEAD_NAME} --model claude-fable-5-2 --effort xhigh --autocompact 600000 --remote-control --permission-mode bypassPermissions "/goal node code/main/tools/omnikom-cli/omnikom.mjs work status exits 0 in this session"`,
      '',
    ].join('\r\n');
    const U = '11111111-2222-3333-4444-555555555555';
    const LANE_NAME = 'LANE_seo-and-audits_2026-11-12';
    // the lane's launcher: the head's, with the lane's name (three places), its kind, its area line after the kind, and its goal
    const LANE_TEXT = HEAD_TEXT.split(HEAD_NAME).join(LANE_NAME)
      .replace('set OMNIKOM_SESSION_KIND=head', 'set OMNIKOM_SESSION_KIND=lane\r\nset OMNIKOM_AREA=seo-and-audits')
      .replace('omnikom.mjs work status exits', 'omnikom.mjs work check --area seo-and-audits exits');
    const JOB_NAME = 'JOB_07-seo-findings_0905';
    const GOAL = 'node tools/x/test/y.mjs';
    const HARGS = ['-p', '--name', JOB_NAME, '--model', 'claude-sonnet-5-5', '--effort', 'medium', '--autocompact', '600000', '--settings', join(CLI_ROOT, 'sessions', 'headless-helper.settings.json'),
      '--permission-mode', 'bypassPermissions', '--max-turns', '200', '--output-format', 'json', `/goal ${GOAL} exits 0 in this session`];
    // HRUN: the helper run of S6 to S8 and S12 (a case adds --dry-run or --brief)
    const HRUN = ['helper', 'run', '07-seo-findings', '--model', 'claude-sonnet-5-5', '--effort', 'medium', '--goal', GOAL];
    const claudeLine = text => text.split('\r\n').find(l => l.startsWith('"'));

    await sc('S1 start head --dry-run: the head\'s CRLF launcher, nothing written, nothing opened (T1; L2, L3)', async () => {
      const g = await go('S1', ['session', 'start', 'head', '--dry-run']);
      const d = g.r.json && g.r.json.data;
      return parts([['exit 0', g.r.exit === 0], ['data.name', d && d.name === HEAD_NAME], [`data.text (${d ? diffAt(d.text, HEAD_TEXT) : 'no data'})`, d && d.text === HEAD_TEXT],
        ['json.target undefined', g.r.json && g.r.json.target === undefined], ['nothing opened, run, or written', idle(g)]]);
    });

    await sc('S2 start lane --area seo-and-audits --dry-run: the head\'s text with the lane\'s name, kind, area line and goal (T1; L2)', async () => {
      const g = await go('S2', ['session', 'start', 'lane', '--area', 'seo-and-audits', '--dry-run']);
      const d = g.r.json && g.r.json.data;
      return parts([['exit 0', g.r.exit === 0], ['data.name', d && d.name === LANE_NAME], [`data.text (${d ? diffAt(d.text, LANE_TEXT) : 'no data'})`, d && d.text === LANE_TEXT],
        ['nothing opened, run, or written', idle(g)]]);
    });

    await sc('S3 --resume: the claude line ends with --resume <id> and the text holds no /goal (T1)', async () => {
      const a = await go('S3', ['session', 'start', 'head', '--resume', U, '--dry-run']);
      const b = await go('S3', ['session', 'start', 'lane', '--area', 'seo', '--resume', U, '--dry-run']);
      const tail = `--autocompact 600000 --remote-control --permission-mode bypassPermissions --resume ${U}`;
      const ta = a.r.json && a.r.json.data && a.r.json.data.text, tb = b.r.json && b.r.json.data && b.r.json.data.text;
      return parts([['head exit 0', a.r.exit === 0], ['lane exit 0', b.r.exit === 0], ['head claude line', typeof ta === 'string' && claudeLine(ta).endsWith(tail)],
        ['lane claude line', typeof tb === 'string' && claudeLine(tb).endsWith(tail)], ['head text has no /goal', typeof ta === 'string' && !ta.includes('/goal')],
        ['lane text has no /goal', typeof tb === 'string' && !tb.includes('/goal')]]);
    });

    await sc('S4 session start: ten wrong command lines, each exit 2 with its text, nothing written or opened (L1)', async () => {
      const VERB = 'session start head|lane [--area <a>] [--resume <session id>] [--dry-run]';
      const KIND = 'session start takes head or lane; a one-row headless process is started by omnikom helper run <job-id>';
      const AREA = 'a lane needs --area <a>: lowercase letters and digits in words joined by single hyphens';
      const wrong = [
        [['session'], VERB], [['session', 'stop', 'head'], VERB],
        [['session', 'start'], KIND], [['session', 'start', 'job'], KIND],
        [['session', 'start', 'lane'], AREA], [['session', 'start', 'lane', '--area', 'Seo'], AREA],
        [['session', 'start', 'head', '--area', 'seo'], 'the head takes no --area'],
        [['session', 'start', 'head', '--resume', '12'], '--resume takes a session id (a uuid)'],
        [['session', 'start', 'head', '--model', 'x'], 'session start takes no --model'],
        [['session', 'start', 'head', 'extra'], "session start head: unexpected argument 'extra'"],
      ];
      const got = [];
      for (const [argv, text] of wrong) {
        const g = await go('S4', argv);
        const j = g.r.json;
        if (!(g.r.exit === 2 && j && j.code === 'USAGE' && j.error === text && idle(g))) got.push({ argv: argv.join(' '), want: text, ...shown(g), idle: idle(g) });
      }
      return [got.length === 0, got];
    });

    await sc('S5 start head: the launcher file is HEAD_TEXT, opened once, one start line (L3, R)', async () => {
      const g = await go('S5', ['session', 'start', 'head']);
      const file = join(launchOf('S5'), `${HEAD_NAME}.cmd`);
      const text = existsSync(file) ? readFileSync(file, 'utf8') : null;
      const line = JSON.stringify({ at: new Date(NOW * 1000).toISOString(), kind: 'head', name: HEAD_NAME, resumed: false }) + '\n';
      const starts = existsSync(startsOf('S5')) ? readFileSync(startsOf('S5'), 'utf8') : null;
      return parts([['exit 0', g.r.exit === 0], [`launcher file (${text === null ? 'missing' : diffAt(text, HEAD_TEXT)})`, text === HEAD_TEXT],
        ['opened once with the name and the path', same(g.opened, [[HEAD_NAME, file]])], ['run not called', g.ran.length === 0], [`start file (${JSON.stringify(starts)})`, starts === line]]);
    });

    await sc('S6 helper run --dry-run: the name, exe, cwd, args and time limit, nothing run or written (T1; H2, H3)', async () => {
      const g = await go('S6', [...HRUN, '--dry-run']);
      const d = g.r.json && g.r.json.data;
      return parts([['exit 0', g.r.exit === 0], ['data.name', d && d.name === JOB_NAME], ['data.exe', d && d.exe === exe], ['data.cwd', d && d.cwd === ws],
        ['data.args', d && same(d.args, HARGS)], ['data.timeout', d && d.timeout === 7200000], ['nothing run or written', nothingStarted(g)]]);
    });

    await sc('S7 helper run: runs once with the markers gone from its environment, answers its stdout, one start line (H3, R)', async () => {
      const env = { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_PID: '9', KEEP_ME: 'y' };
      const g = await go('S7', HRUN, { env, answer: { status: 0, stdout: '{"result":"done"}' } });
      const d = g.r.json && g.r.json.data;
      const c = g.ran[0];
      const starts = existsSync(startsOf('S7')) ? readFileSync(startsOf('S7'), 'utf8').split('\n').filter(Boolean) : [];
      let kind = null;
      try { kind = JSON.parse(starts[0]).kind; } catch { /* reported below */ }
      return parts([['exit 0', g.r.exit === 0], ['run called once', g.ran.length === 1], ['cmd', c && c.cmd === exe], ['args', c && same(c.args, HARGS)], ['opts.cwd', c && c.opts.cwd === ws],
        ['opts.timeout', c && c.opts.timeout === 7200000], ['no marker in opts.env', c && TEN.every(m => !(m in c.opts.env))],
        ['OMNIKOM_SESSION_KIND helper', c && c.opts.env.OMNIKOM_SESSION_KIND === 'helper'], ['OMNIKOM_JOB', c && c.opts.env.OMNIKOM_JOB === '07-seo-findings'],
        ['KEEP_ME kept', c && c.opts.env.KEEP_ME === 'y'], ['data.stdout', d && d.stdout === '{"result":"done"}'], ['one start line of kind helper', starts.length === 1 && kind === 'helper']]);
    });

    await sc('S8 helper run: a failed or timed out helper is exit 1, HELPER-FAILED (H3)', async () => {
      const a = await go('S8', HRUN, { answer: { status: 1 } });
      const b = await go('S8', HRUN, { answer: { status: null, timedOut: true } });
      return parts([['failed: exit 1', a.r.exit === 1], ['failed: code', a.r.json && a.r.json.code === 'HELPER-FAILED'], ['timed out: exit 1', b.r.exit === 1],
        ['timed out: code', b.r.json && b.r.json.code === 'HELPER-FAILED'], ['timed out: data.timedOut', b.r.json && b.r.json.data && b.r.json.data.timedOut === true]]);
    });

    await sc('S9 helper run: twelve wrong command lines, each exit 2 with its text, nothing run or written (H1)', async () => {
      const RUN = 'helper run <job-id> --model <id> --effort <level> --goal <exit test> [--brief <file>] [--dry-run]';
      const ID = 'helper run takes a job id <NN>-<slug>: two digits, a hyphen, lowercase words joined by single hyphens';
      const MODEL = '--model is one of claude-fable-5-2, claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5';
      const EFFORT = "--effort is one of low, medium, high, xhigh (max only on the owner's word: P3.2 section 5)";
      const GOALTEXT = "--goal is the job's exit test, one line";
      const flags = (o = {}) => ['--model', o.model || 'claude-sonnet-5-5', '--effort', o.effort || 'medium', ...(o.goal === null ? [] : ['--goal', o.goal || GOAL]), ...(o.extra || [])];
      const wrong = [
        [['helper', 'start', '07-x'], RUN],
        [['helper', 'run', '7-x', ...flags()], ID], [['helper', 'run', '07_x', ...flags()], ID], [['helper', 'run', '07-X', ...flags()], ID], [['helper', 'run', ...flags()], ID],
        [['helper', 'run', '07-x', ...flags({ model: 'opus' })], MODEL], [['helper', 'run', '07-x', ...flags({ model: 'claude-opus-5-1' })], MODEL],
        [['helper', 'run', '07-x', ...flags({ effort: 'max' })], EFFORT],
        [['helper', 'run', '07-x', ...flags({ goal: null })], GOALTEXT], [['helper', 'run', '07-x', ...flags({ goal: 'node a.mjs\nnode b.mjs' })], GOALTEXT],
        [['helper', 'run', '07-x', ...flags({ extra: ['--resume', 'x'] })], 'helper run takes no --resume'],
        [['helper', 'run', '07-x', 'y', ...flags()], "helper run: unexpected argument 'y'"],
      ];
      const got = [];
      for (const [argv, text] of wrong) {
        const g = await go('S9', argv);
        const j = g.r.json;
        if (!(g.r.exit === 2 && j && j.code === 'USAGE' && j.error === text && nothingStarted(g))) got.push({ argv: argv.join(' '), want: text, ...shown(g), started: !nothingStarted(g) });
      }
      return [wrong.length === 12 && got.length === 0, got];
    });

    await sc('S10 a machine file without claudeExe or workspaceDir is exit 3 naming the key (K, H2)', async () => {
      const none = machineOf('machine-empty', {}), onlyExe = machineOf('machine-only-exe', { claudeExe: exe });
      const a = await go('S10', ['session', 'start', 'head', '--dry-run'], { env: { OMNIKOM_MACHINE_FILE: none } });
      const b = await go('S10', [...HRUN, '--dry-run'], { env: { OMNIKOM_MACHINE_FILE: none } });
      const c = await go('S10', ['session', 'start', 'head', '--dry-run'], { env: { OMNIKOM_MACHINE_FILE: onlyExe } });
      const err = g => String(g.r.json && g.r.json.error);
      return parts([['session, empty file: exit 3', a.r.exit === 3], ['session, empty file: has no "claudeExe"', err(a).includes('has no "claudeExe"')],
        ['helper, empty file: exit 3', b.r.exit === 3], ['helper, empty file: has no "claudeExe"', err(b).includes('has no "claudeExe"')],
        ['claudeExe only: exit 3', c.r.exit === 3], ['claudeExe only: has no "workspaceDir"', err(c).includes('has no "workspaceDir"')]]);
    });

    await sc('S11 NAME_PATTERNS: head, lane and helper match their forms and not the near misses (N)', async () => {
      const m = await import(pathToFileURL(join(CLI_ROOT, 'commands', 'session.mjs')).href);
      const P = m.NAME_PATTERNS;
      const keys = Object.keys(P);
      return parts([[`keys head, lane, helper (${keys.join(', ')})`, same(keys, ['head', 'lane', 'helper'])],
        ['head matches the head name', P.head.test(HEAD_NAME)], ['head refuses HEAD_Platform-build_2026-11-04', !P.head.test('HEAD_Platform-build_2026-11-04')],
        ['head refuses a lower-case model', !P.head.test('HEAD-OF-OPERATIONS_fable_2026-11-12')],
        ['lane matches the lane name', P.lane.test(LANE_NAME)], ['lane refuses LANE_Fable_2026-11-12', !P.lane.test('LANE_Fable_2026-11-12')],
        ['helper matches the job name', P.helper.test(JOB_NAME)], ['helper refuses HELPER_07-x_0905', !P.helper.test('HELPER_07-x_0905')], ['helper refuses JOB_7-x_0905', !P.helper.test('JOB_7-x_0905')]]);
    });

    await sc('S12 helper run --brief: the prompt names the file; a file that does not exist is exit 2 (H1, H2)', async () => {
      const a = await go('S12', [...HRUN, '--brief', brief, '--dry-run']);
      const b = await go('S12', [...HRUN, '--brief', join(root, 'none.json'), '--dry-run']);
      const d = a.r.json && a.r.json.data;
      const want = [...HARGS.slice(0, -1), `/goal ${GOAL} exits 0 in this session; the job is written in ${brief}: read it first`];
      return parts([['exit 0', a.r.exit === 0], [`data.args (${d ? JSON.stringify(d.args.slice(-1)) : 'no data'})`, d && same(d.args, want)], ['missing file: exit 2', b.r.exit === 2],
        ['missing file: its text', b.r.json && b.r.json.error === "--brief takes an existing file: the job's brief"], ['run never called', a.ran.length === 0 && b.ran.length === 0]]);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

// run alone: node tools/omnikom-cli/test/session.mjs [--bail] [--time]   (OMNIKOM_CLI_DIR points it at a copy of the CLI, as for run.mjs)
const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })();
if (isMain) {
  const cliDir = process.env.OMNIKOM_CLI_DIR ? resolve(process.env.OMNIKOM_CLI_DIR) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  process.env.OMNIKOM_CLI_DIR = cliDir;
  const repoRoot = process.env.OMNIKOM_REPO_ROOT ? resolve(process.env.OMNIKOM_REPO_ROOT) : resolve(cliDir, '..', '..');
  const at = f => import(pathToFileURL(join(cliDir, f)).href);
  const { makeCheck } = await at('test/mutate-run.mjs');
  const { cli } = await at('test/harness.mjs');
  // every line is written synchronously: a piped stdout on Windows is async and process.exit would cut the last lines
  const say = text => { try { writeSync(1, text); } catch { process.stdout.write(text); } };
  const { check, counts } = makeCheck({ bail: process.argv.includes('--bail'), timed: process.argv.includes('--time'), out: line => say(`${line}\n`) });
  await sessionTests({ check, cli, CLI_ROOT: cliDir, REPO_ROOT: repoRoot, lib: f => at(join('lib', f)) });
  const c = counts();
  say(`${c.total - c.failed} of ${c.total} checks passed, ${c.failed} FAILED\n`);
  process.exit(c.failed ? 1 : 0);
}
