// Tests for the CLI's thin wrap (P3.3 B1): lib/wrap.mjs (mapExit, runWrapped, help) and the registry path of omnikom.mjs, over a fake script.
// The fake script lives in a temp folder that plays the repo root (deps.repo), so nothing here starts a real tool. The code under test is loaded
// ONLY through `lib`, `cli` and an import of the omnikom.mjs of CLI_ROOT: test/mutate.mjs runs this suite against a broken COPY of the CLI.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

// echo.mjs <exit code> [--skipped] [--sleep <seconds>] [--secret] [--raw-err] [more]: argv on stdout, err:fake on stderr, then the code;
// --secret also prints the variable SOME_SECRET_KEY on both streams, --raw-err ends stderr without a line end
const FAKE = String.raw`const a = process.argv.slice(2);
const at = a.indexOf('--sleep');
const wait = at >= 0 ? Number(a[at + 1]) * 1000 : 0;
setTimeout(() => {
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
    const r10a = await cli(['fake', 'run', '0', '--nope', '1'], {}, DEPS), r10b = await cli(['fake', 'run', '0', '--dry'], {}, DEPS);
    check('wrap: an undeclared flag is a usage error (exit 2), a retired one names its new spelling, and the script is not started',
      r10a.exit === 2 && r10a.json && r10a.json.code === 'USAGE' && r10a.json.error === 'unknown flag --nope' && r10b.exit === 2 && r10b.json && r10b.json.code === 'USAGE' && r10b.json.error === 'unknown flag --dry; the spelling is --dry-run' && !r10a.all.includes('argv:') && !r10b.all.includes('argv:'), `${r10a.all} ${r10b.all}`);

    // W11 the row's own help, two ways
    const h1 = await cli(['fake', 'run', '--help'], {}, DEPS), h2 = await cli(['help', 'fake', 'run'], {}, DEPS);
    const holds = out => [ROW.usage, '--out', '--skipped', ...Object.values(ROW.exits), ROW.example].every(t => out.includes(t));
    check('wrap: --help and help <name> print the row\'s help (the same text, its summary first, usage, flags, exits, example), not JSON, and start nothing',
      h1.exit === 0 && h2.exit === 0 && h1.stdout === h2.stdout && h1.stdout.split('\n')[0] === 'omnikom fake run: A fake tool for the wrap tests' && holds(h1.stdout) && h1.json === null && h2.json === null && !h1.all.includes('argv:') && !h2.all.includes('argv:'), h1.all);

    // W12 the global help lists the rows
    const g1 = await cli([], {}, DEPS), g2 = await cli([], {}, withRows({}));
    check('wrap: the global help lists a line per row (usage and summary) after the engine\'s lines, and no row adds no line',
      g1.json && g1.json.usage.length === USAGE.length + 3 && g1.json.usage.some(l => l.includes('omnikom fake run <code>') && l.includes('A fake tool for the wrap tests')) && g2.json && g2.json.usage.length === USAGE.length, JSON.stringify([g1.json && g1.json.usage.length, g2.json && g2.json.usage.length, USAGE.length]));

    // W13 a two-word row wins over an engine command, an engine verb that is no row still reaches the engine
    const r13a = await cli(['seo', 'fake', '0'], {}, DEPS), r13b = await cli(['seo', 'status', '--json'], {}, DEPS);
    check('wrap: a two-word row under an engine word is run, and an engine verb that is no row still reaches the engine', r13a.stdout.startsWith('argv:') && r13b.json && r13b.json.code === 'USAGE' && String(r13b.json.error).includes('needs the site\'s url'), `${r13a.all} ${r13b.all}`);

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
    const r16 = await cli(['fake', 'run', '0', '--target', 'production'], {}, DEPS);
    check('wrap: --target production on a wrapped tool is BLOCKED (exit 3) and the script is not started', r16.exit === 3 && r16.json && r16.json.code === 'BLOCKED' && !r16.stdout.includes('argv:'), r16.all);

    // W17 the wrapped output is redacted: a secret the script prints on either stream is masked
    const S = randomBytes(24).toString('hex');
    const r17 = await cli(['fake', 'run', '0', '--secret'], { SOME_SECRET_KEY: S }, DEPS);
    check('wrap: a secret variable the script prints on stdout and on stderr never comes out of the CLI', r17.exit === 0 && r17.stdout.includes('secret:') && !r17.stdout.includes(S) && !r17.stderr.includes(S), `${r17.exit} ${r17.stdout.includes('secret:')} ${r17.stdout.includes(S)} ${r17.stderr.includes(S)}`);

    // W18 a wrapped tool's own errors print as the CLI's JSON object, also under an engine word that prints text lines
    const r18 = await cli(['seo', 'fake', '0', '--nope', '1'], {}, DEPS);
    check('wrap: a usage error of a wrapped tool under an engine word (seo fake) is the JSON object, exit 2, not a text line', r18.exit === 2 && r18.json !== null && r18.json.code === 'USAGE' && r18.json.error === 'unknown flag --nope', r18.all);

    // W19 the line the wrap adds starts on a line of its own, also when the script's stderr has no line end
    const d19 = await run(['4', '--raw-err']);
    check('wrap: when the script\'s stderr does not end with a line end, the line the wrap adds still starts on its own line', d19.stderr === 'err:fake\nomnikom fake run: the script exited 4; exit 1\n', JSON.stringify(d19));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
