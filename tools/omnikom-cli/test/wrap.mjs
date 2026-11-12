// Tests for the CLI's thin wrap (P3.3 B1): lib/wrap.mjs (mapExit, runWrapped, help) and the registry path of omnikom.mjs, over a fake script.
// The fake script lives in a temp folder that plays the repo root (deps.repo), so nothing here starts a real tool. The code under test is loaded
// ONLY through `lib`, `cli` and an import of the omnikom.mjs of CLI_ROOT: test/mutate.mjs runs this suite against a broken COPY of the CLI.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

// echo.mjs <exit code> [--skipped] [--sleep <seconds>] [--secret] [--raw-err] [--big] [more]: argv on stdout, err:fake on stderr, then the code;
// --secret also prints the variable SOME_SECRET_KEY on both streams, --raw-err ends stderr without a line end, --big first prints 2 MB of x lines;
// when the variable FAKE_MARK names a file, the first thing the script does is write the word started into it (so a test can tell that it ran)
const FAKE = String.raw`import { writeFileSync } from 'node:fs';
if (process.env.FAKE_MARK) writeFileSync(process.env.FAKE_MARK, 'started');
const a = process.argv.slice(2);
const at = a.indexOf('--sleep');
const wait = at >= 0 ? Number(a[at + 1]) * 1000 : 0;
setTimeout(() => {
  if (a.includes('--big')) process.stdout.write(('x'.repeat(1023) + '\n').repeat(2048));
  process.stdout.write('argv:' + JSON.stringify(a) + '\n');
  process.stderr.write(a.includes('--raw-err') ? 'err:fake' : 'err:fake\n');
  if (a.includes('--secret')) {
    process.stdout.write('secret:' + process.env.SOME_SECRET_KEY + '\n');
    process.stderr.write('secret:' + process.env.SOME_SECRET_KEY + '\n');
  }
  if (a.includes('--skipped')) process.stdout.write('SKIPPED: nothing to do\n');
  process.exitCode = Number(a[0]);
}, wait);
`;

export async function wrapTests({ check, cli, CLI_ROOT, REPO_ROOT, lib }) {
  const { mapExit, runWrapped } = await lib('wrap.mjs');
  const { parseArgs } = await lib('args.mjs');
  const { Usage } = await lib('errors.mjs');
  const { USAGE } = await import(pathToFileURL(join(CLI_ROOT, 'omnikom.mjs')).href);
  const engines = JSON.parse(readFileSync(join(CLI_ROOT, 'registry.json'), 'utf8')).engines;
  const root = mkdtempSync(join(tmpdir(), 'omnikom-wrap-'));
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };
  const throws = (fn, cls) => { try { fn(); return false; } catch (e) { return e instanceof cls; } };
  const ROW = {
    script: 'tools/fake/echo.mjs', test: 'tools/fake/echo.mjs', summary: 'A fake tool for the wrap tests',
    usage: 'omnikom fake run <code> [--out <dir>] [--skipped] [--sleep <seconds>]', args: '<code>: the exit code the fake ends with',
    flags: {
      out: { value: true, help: 'where output goes' }, skipped: { value: false, help: 'end with a SKIPPED: line' }, sleep: { value: true, help: 'seconds to wait first' },
      target: { value: true, help: 'the target' }, secret: { value: false, help: 'print the secret variable' }, 'raw-err': { value: false, help: 'stderr without a line end' },
    },
    exits: { 0: 'ok', 1: 'failed', 2: 'usage', 3: 'blocked' }, output: 'its arguments as one JSON line', example: 'omnikom fake run 0 --out x', timeoutMinutes: 0.05,
  };
  const renamed = to => ({ ...ROW, usage: ROW.usage.replace('omnikom fake run', to), example: ROW.example.replace('omnikom fake run', to) });
  const FIX = { schema: 1, engines, commands: { 'fake run': ROW, 'seo fake': renamed('omnikom seo fake'), solo: renamed('omnikom solo') } };
  const DEPS = { registry: FIX, repo: root };
  const withRows = commands => ({ registry: { ...FIX, commands }, repo: root });
  try {
    mkdirSync(join(root, 'tools', 'fake'), { recursive: true });
    writeFileSync(join(root, 'tools', 'fake', 'echo.mjs'), FAKE);
    const run = async args => (await runWrapped('fake run', ROW, args, { env, repo: root })).data;
    const argvLine = a => `argv:${JSON.stringify(a)}\n`;
    // a call of the CLI with FAKE_MARK in its environment: the marker file is removed first, and `started` says afterwards whether the fake script ran
    const MARK = join(root, 'started.txt');
    const go = async (argv, deps) => { rmSync(MARK, { force: true }); const r = await cli(argv, { FAKE_MARK: MARK }, deps); return { ...r, started: existsSync(MARK) }; };

    // W1 the exit table
    const m = [[0, ''], [1, ''], [2, ''], [3, ''], [4, 'SKIPPED: x'], [4, 'done'], [124, ''], [127, ''], [130, ''], [143, ''], [9, ''], [null, '']].map(([c, l]) => mapExit(c, l));
    check('wrap: mapExit keeps 0 to 3, 4 is 0 only after a SKIPPED: line, 127 is 3, everything else is 1', JSON.stringify(m) === JSON.stringify([0, 1, 2, 3, 0, 1, 1, 3, 1, 1, 1, 1]), JSON.stringify(m));

    // W2 the output is the child's, exact
    const d2 = await run(['0', '--out', 'x']);
    check('wrap: runWrapped passes the child\'s stdout and stderr back exactly, with its exit codes and raw: true', d2.stdout === argvLine(['0', '--out', 'x']) && d2.stderr === 'err:fake\n' && d2.exit === 0 && d2.childExit === 0 && d2.raw === true, JSON.stringify(d2));

    // W3 codes 1, 2, 3 stay, and the wrap adds no line to stderr
    const d3 = [];
    for (const c of [1, 2, 3]) d3.push(await run([String(c)]));
    check('wrap: the exit codes 1, 2 and 3 stay, the child\'s stderr and stdout are exact', d3.every((d, i) => d.exit === i + 1 && d.childExit === i + 1 && d.stderr === 'err:fake\n' && d.stdout === argvLine([String(i + 1)])), JSON.stringify(d3));

    // W4 a 4 after a SKIPPED: line is a 0, and the one added line says so
    const d4 = await run(['4', '--skipped']);
    check('wrap: exit 4 after a SKIPPED: line is exit 0, and stderr gets one line saying so', d4.exit === 0 && d4.childExit === 4 && d4.stdout.endsWith('SKIPPED: nothing to do\n') && d4.stderr === 'err:fake\nomnikom fake run: the script exited 4; exit 0\n', JSON.stringify(d4));

    // W5 the other codes
    const codes = ['4', '124', '127', '130', '143', '9'], want = [1, 1, 3, 1, 1, 1];
    const d5 = [];
    for (const c of codes) d5.push(await run([c]));
    check('wrap: 4 without SKIPPED, 124, 130, 143 and 9 are exit 1, 127 is exit 3, each with the one line and the child\'s exit', d5.every((d, i) => d.exit === want[i] && d.childExit === Number(codes[i]) && d.stdout === argvLine([codes[i]]) && d.stderr.endsWith(`omnikom fake run: the script exited ${codes[i]}; exit ${want[i]}\n`)), JSON.stringify(d5));

    // W6 a row whose script is not there is BLOCKED and says which file
    const r6 = await cli(['fake', 'run', '0'], {}, withRows({ 'fake run': { ...ROW, script: 'tools/fake/none.mjs' } }));
    check('wrap: a script that is not there is BLOCKED (exit 3) and the message names it', r6.exit === 3 && r6.json && r6.json.code === 'BLOCKED' && String(r6.json.error).includes('tools/fake/none.mjs'), r6.all);

    // W7 the time limit of the row
    const t0 = Date.now();
    const d7 = await run(['0', '--sleep', '30']);
    const took = Date.now() - t0;
    check('wrap: a script past the row\'s time limit is stopped: childExit 124, exit 1, the line says timed out, within 20 seconds', d7.exit === 1 && d7.childExit === 124 && d7.stderr.endsWith('omnikom fake run: the script exited 124 (timed out); exit 1\n') && took < 20000, `${took} ms ${JSON.stringify(d7)}`);

    // W8 through the CLI, the output is the script's and nothing else
    const r8 = await cli(['fake', 'run', '0', '--out', 'x'], {}, DEPS);
    check('wrap: omnikom fake run prints the script\'s stdout and stderr exactly and exits 0', r8.exit === 0 && r8.stdout === argvLine(['0', '--out', 'x']) && r8.stderr === 'err:fake\n', r8.all);

    // W9 the CLI's exit is the mapped one
    const r9a = await cli(['fake', 'run', '3'], {}, DEPS), r9b = await cli(['fake', 'run', '124'], {}, DEPS);
    check('wrap: the CLI exits with the mapped code (3 stays, 124 is 1)', r9a.exit === 3 && r9b.exit === 1, `${r9a.exit} ${r9b.exit}`);

    // W10 a flag the row does not declare is refused before the script starts
    const r10a = await go(['fake', 'run', '0', '--nope', '1'], DEPS), r10b = await go(['fake', 'run', '0', '--dry'], DEPS);
    check('wrap: an undeclared flag is a usage error (exit 2), a retired one names its new spelling, and the script is not started',
      r10a.exit === 2 && r10a.json && r10a.json.code === 'USAGE' && r10a.json.error === 'unknown flag --nope' && r10b.exit === 2 && r10b.json && r10b.json.code === 'USAGE' && r10b.json.error === 'unknown flag --dry; the spelling is --dry-run' && !r10a.all.includes('argv:') && !r10b.all.includes('argv:') && !r10a.started && !r10b.started, `${r10a.all} ${r10b.all} ${r10a.started} ${r10b.started}`);

    // W11 the row's own help, two ways
    const h1 = await cli(['fake', 'run', '--help'], {}, DEPS), h2 = await cli(['help', 'fake', 'run'], {}, DEPS);
    const holds = out => [ROW.usage, '--out', '--skipped', ...Object.values(ROW.exits), ROW.example].every(t => out.includes(t));
    check('wrap: --help and help <name> print the row\'s help (the same text, its summary first, usage, flags, exits, example), not JSON, and start nothing',
      h1.exit === 0 && h2.exit === 0 && h1.stdout === h2.stdout && h1.stdout.split('\n')[0] === 'omnikom fake run: A fake tool for the wrap tests' && holds(h1.stdout) && h1.json === null && h2.json === null && !h1.all.includes('argv:') && !h2.all.includes('argv:'), h1.all);

    // W12 the global help lists the rows
    const g1 = await cli([], {}, DEPS), g2 = await cli([], {}, withRows({}));
    check('wrap: the global help lists a line per row (usage and summary) after the engine\'s lines, and no row adds no line',
      g1.json && g1.json.usage.length === USAGE.length + 3 && g1.json.usage.some(l => l.includes('omnikom fake run <code>') && l.includes('A fake tool for the wrap tests')) && g2.json && g2.json.usage.length === USAGE.length, JSON.stringify([g1.json && g1.json.usage.length, g2.json && g2.json.usage.length, USAGE.length]));

    // W13 a row under an engine's first word is never taken, the engine answers (also for an engine verb that is no row)
    const r13a = await go(['seo', 'fake', '0'], DEPS), r13b = await cli(['seo', 'status', '--json'], {}, DEPS);
    check('wrap: a row under an engine\'s first word is never taken, the engine answers', !r13a.stdout.startsWith('argv:') && !r13a.started && r13b.json && r13b.json.code === 'USAGE' && String(r13b.json.error).includes('needs the site\'s url'), `${r13a.all} ${r13a.started} ${r13b.all}`);

    // W14 a one-word row runs, but an engine word wins over a one-word row
    const r14a = await cli(['solo', '0'], {}, DEPS);
    const r14b = await cli(['status', '--help'], {}, withRows({ status: { ...ROW, usage: 'omnikom status', example: 'omnikom status 0' } }));
    check('wrap: a one-word row is run, and an engine command of the same name wins over it', r14a.stdout.startsWith('argv:') && r14b.json && r14b.json.command === 'help', `${r14a.all} ${r14b.all}`);

    // W15 parseArgs with and without the declared flags
    const p0 = parseArgs(['lead', 'send', '--site', 'x', '--retry']);
    const p1 = parseArgs(['x', '--out', 'd', '--json'], { out: { value: true }, json: { value: false } });
    const p2 = parseArgs(['x', '--help'], {});
    check('wrap: parseArgs without declared flags is as before; with them a valued flag, a switch, --help and a missing value behave as declared',
      p0.flags.site === 'x' && p0.flags.retry === true && p1.flags.out === 'd' && p1.flags.json === true && throws(() => parseArgs(['x', '--out'], { out: { value: true } }), Usage) && p2.flags.help === true, JSON.stringify([p0, p1, p2]));

    // W16 the production guard stands before a wrapped script: --target production is BLOCKED and the script is not started
    const r16 = await go(['fake', 'run', '0', '--target', 'production'], DEPS);
    check('wrap: --target production on a wrapped tool is BLOCKED (exit 3) and the script is not started', r16.exit === 3 && r16.json && r16.json.code === 'BLOCKED' && !r16.stdout.includes('argv:') && !r16.started, `${r16.all} ${r16.started}`);

    // W17 the wrapped output is redacted: a secret the script prints on either stream is masked
    const S = randomBytes(24).toString('hex');
    const r17 = await cli(['fake', 'run', '0', '--secret'], { SOME_SECRET_KEY: S }, DEPS);
    check('wrap: a secret variable the script prints on stdout and on stderr never comes out of the CLI', r17.exit === 0 && r17.stdout.includes('secret:') && !r17.stdout.includes(S) && !r17.stderr.includes(S), `${r17.exit} ${r17.stdout.includes('secret:')} ${r17.stdout.includes(S)} ${r17.stderr.includes(S)}`);

    // W18 a valued flag given twice is refused: the guard reads the last --target, a script may read the first
    const r18 = await go(['fake', 'run', '0', '--target', 'staging', '--target', 'production'], DEPS);
    check('wrap: a valued flag given twice (--target staging --target production) is a usage error (exit 2), and the script is not started', r18.exit === 2 && r18.json !== null && r18.json.code === 'USAGE' && r18.json.error === '--target is given twice' && !r18.started, `${r18.all} ${r18.started}`);

    // W19 the line the wrap adds starts on a line of its own, also when the script's stderr has no line end
    const d19 = await run(['4', '--raw-err']);
    check('wrap: when the script\'s stderr does not end with a line end, the line the wrap adds still starts on its own line', d19.stderr === 'err:fake\nomnikom fake run: the script exited 4; exit 1\n', JSON.stringify(d19));

    // W20 the control for the "script not started" checks: the marker does appear when the script starts
    const r20 = await go(['fake', 'run', '0'], DEPS);
    check('wrap: a plain call starts the script, and the marker file shows it (the control of the checks that say the script was not started)', r20.exit === 0 && r20.started, `${r20.all} ${r20.started}`);

    // W21 --target must be exactly staging, production or local, as written: no change of case, no trimming, no short form
    const r21 = [];
    for (const t of ['PRODUCTION', ' production ', 'prod']) r21.push(await go(['fake', 'run', '0', '--target', t], DEPS));
    const r21s = await go(['fake', 'run', '0', '--target', 'staging'], DEPS);
    check('wrap: a --target that is not exactly staging, production or local (PRODUCTION, " production ", prod) is a usage error and the script is not started; staging runs',
      r21.every(r => r.exit === 2 && r.json && r.json.code === 'USAGE' && r.json.error === '--target must be one of staging, production, local' && !r.started) && r21s.exit === 0 && r21s.started, JSON.stringify([r21.map(r => [r.exit, r.all, r.started]), r21s.exit, r21s.started]));

    // W22 output past proc-guard's cap: the run is stopped, and the line says so
    const d22 = (await runWrapped('fake run', ROW, ['0', '--big'], { env, repo: root, maxBuffer: 1024 * 1024 })).data;
    check('wrap: a script whose output passes the limit is stopped: childExit 143, exit 1, and the line says the output passed the limit',
      d22.exit === 1 && d22.childExit === 143 && d22.stderr.endsWith('omnikom fake run: the script exited 143 (stopped: its output passed the limit); exit 1\n'), JSON.stringify({ exit: d22.exit, childExit: d22.childExit, stdoutLength: d22.stdout.length, stderr: d22.stderr }));

    // W23 help alone is the global help, as --help is, and --json is honoured
    const h23a = await cli(['help'], {}, DEPS), h23b = await cli(['help', '--json'], {}, DEPS);
    check('wrap: help alone is the global help (exit 0, command help, a line per row), also with --json, which prints it on one line',
      [h23a, h23b].every(r => r.exit === 0 && r.json && r.json.command === 'help' && r.json.usage.length === USAGE.length + 3) && h23b.stdout.trim().split('\n').length === 1, `${h23a.all} ${h23b.all}`);

    // W24 help <words>: an unknown name is a usage error, an engine word is the global help
    const h24a = await cli(['help', 'nope'], {}, DEPS), h24b = await cli(['help', 'status'], {}, DEPS);
    check('wrap: help nope is a usage error (unknown command \'nope\'), help status (an engine word) is the global help', h24a.exit === 2 && h24a.json && h24a.json.code === 'USAGE' && h24a.json.error === 'unknown command \'nope\'' && h24b.exit === 0 && h24b.json && h24b.json.command === 'help', `${h24a.all} ${h24b.all}`);

    // W24b the command table has only its own names: a word every object answers to (constructor, toString, __proto__) is an unknown command, alone and under help
    const h24c = [];
    for (const a of [['constructor'], ['toString'], ['__proto__'], ['help', 'constructor']]) {
      try { h24c.push(await cli(a, {}, DEPS)); } catch (e) { h24c.push({ exit: -1, json: null, all: `threw: ${e.message}` }); }   // a table that inherits makes the CLI itself throw
    }
    check('wrap: constructor, toString and __proto__ are unknown commands (a usage error), alone and under help', h24c.every(r => r.exit === 2 && r.json && r.json.code === 'USAGE' && /^unknown command '/.test(r.json.error)), h24c.map(r => r.all).join(' '));

    // W25 a row's help is redacted like all output (the secret sits in the row's own summary)
    const S25 = randomBytes(24).toString('hex');
    const rows25 = withRows({ 'fake run': { ...ROW, summary: 'Fake ' + S25 } });
    const h25a = await cli(['help', 'fake', 'run'], { SOME_SECRET_KEY: S25 }, rows25), h25b = await cli(['fake', 'run', '--help'], { SOME_SECRET_KEY: S25 }, rows25);
    check('wrap: a secret in a row\'s help text never comes out of help <name> or --help', [h25a, h25b].every(r => r.exit === 0 && r.stdout.includes('usage:') && !r.stdout.includes(S25)), JSON.stringify([h25a, h25b].map(r => [r.exit, r.stdout.includes('usage:'), r.stdout.includes(S25)])));

    // W26 a script that is a folder is BLOCKED, like a script that is not there
    const r26 = await cli(['fake', 'run', '0'], {}, withRows({ 'fake run': { ...ROW, script: 'tools/fake' } }));
    check('wrap: a row whose script is a folder is BLOCKED (exit 3) and the message names it', r26.exit === 3 && r26.json && r26.json.code === 'BLOCKED' && String(r26.json.error).includes('tools/fake'), r26.all);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
