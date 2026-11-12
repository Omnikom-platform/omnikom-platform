// Tests for the registry's own check (P3.3 B1): lib/wrap.mjs checkRegistry over the real registry.json and over a fixture registry whose
// rows are broken one way at a time. A folder in one temp folder plays the repo root for the fixture rows' script and test files. The code under test is
// loaded ONLY through `lib` and an import of the omnikom.mjs of CLI_ROOT (test/mutate.mjs runs this suite against a broken COPY of the CLI).
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function registryTests({ check, cli, CLI_ROOT, REPO_ROOT, lib }) {
  const { checkRegistry } = await lib('wrap.mjs');
  const { COMMAND_NAMES } = await import(pathToFileURL(join(CLI_ROOT, 'omnikom.mjs')).href);
  const real = JSON.parse(readFileSync(join(CLI_ROOT, 'registry.json'), 'utf8'));
  const commandFiles = readdirSync(join(CLI_ROOT, 'commands')).filter(f => f.endsWith('.mjs')).map(f => f.slice(0, -'.mjs'.length)).sort();
  const root = mkdtempSync(join(tmpdir(), 'omnikom-wrap-'));
  const ROW = {
    script: 'tools/fake/echo.mjs', test: 'tools/fake/echo.mjs', summary: 'A fake tool for the wrap tests',
    usage: 'omnikom fake run <code> [--out <dir>] [--skipped] [--sleep <seconds>]', args: '<code>: the exit code the fake ends with',
    flags: { out: { value: true, help: 'where output goes' }, skipped: { value: false, help: 'end with a SKIPPED: line' }, sleep: { value: true, help: 'seconds to wait first' } },
    exits: { 0: 'ok', 1: 'failed', 2: 'usage', 3: 'blocked' }, output: 'its arguments as one JSON line', example: 'omnikom fake run 0 --out x', timeoutMinutes: 0.05,
  };
  const renamed = to => ({ ...ROW, usage: ROW.usage.replace('omnikom fake run', to), example: ROW.example.replace('omnikom fake run', to) });
  const named = name => renamed(`omnikom ${name}`);
  const FIX = { schema: 1, engines: real.engines, commands: { 'fake run': ROW, 'seo fake': renamed('omnikom seo fake'), solo: renamed('omnikom solo') } };
  const repo = join(root, 'repo');   // the fixture repo root; the folder above it holds x.mjs, so only the .. rule can refuse '../x.mjs'
  const OPTS = { repo, commandFiles: real.engines, engineCommands: COMMAND_NAMES };
  const one = (problems, word) => problems.length === 1 && problems[0].startsWith(word);
  // the fixture with one row, `fake run`, changed
  const with1 = (over, rest) => checkRegistry({ ...FIX, commands: { 'fake run': { ...ROW, ...over } } }, rest || OPTS);
  const seen = (...lists) => JSON.stringify(lists);
  try {
    mkdirSync(join(repo, 'tools', 'fake'), { recursive: true });
    writeFileSync(join(repo, 'tools', 'fake', 'echo.mjs'), '// a file for the registry check to find\n');
    writeFileSync(join(root, 'x.mjs'), '// a file outside the repo root\n');

    // R1 the real registry against the real commands folder
    const p1 = checkRegistry(real, { repo: REPO_ROOT, commandFiles, engineCommands: COMMAND_NAMES });
    check('registry: the real registry.json is clean and its engines are the commands/*.mjs files', p1.length === 0 && JSON.stringify(real.engines) === JSON.stringify(commandFiles), seen(p1, real.engines, commandFiles));

    // R2 a command file the registry does not list
    const p2 = checkRegistry(FIX, { ...OPTS, commandFiles: [...real.engines, 'zzz'] });
    check('registry: a commands/ file that engines does not list is an ENGINES problem', one(p2, 'ENGINES'), seen(p2));

    // R3 a script or a test that is not under the repo
    const p3a = with1({ script: 'tools/fake/none.mjs' }), p3b = with1({ test: 'tools/fake/none.mjs' });
    check('registry: a script that is not a file under the repo is a SCRIPT problem, a test a TEST problem', one(p3a, 'SCRIPT fake run') && one(p3b, 'TEST fake run'), seen(p3a, p3b));

    // R4 the help parts
    const bad = [{ summary: undefined }, { summary: 'x'.repeat(101) }, { usage: 'fake run' }, { output: undefined }, { exits: undefined }, { exits: { ...ROW.exits, 4: 'extra' } }, { exits: { 1: 'failed' } }, { example: 'fake run 0' }];
    const p4 = bad.map(over => with1(over));
    check('registry: no summary, a long summary, a usage or example not starting omnikom <name>, no output, no exits, a key 4 or no key 0 is one HELP problem each', p4.every(p => one(p, 'HELP fake run')), seen(p4));

    // R5 a retired flag
    const p5 = with1({ flags: { ...ROW.flags, dry: { value: false, help: 'the old spelling' } } });
    check('registry: a declared flag that is retired (dry) is a RETIRED-FLAG problem', one(p5, 'RETIRED-FLAG fake run'), seen(p5));

    // R6 names
    const p6a = checkRegistry({ ...FIX, commands: { status: named('status') } }, OPTS), p6b = checkRegistry({ ...FIX, commands: { 'Bad Name': named('Bad Name') } }, OPTS);
    check('registry: a one-word row named like an engine command, and a name that is not lowercase words, are NAME problems', one(p6a, 'NAME status') && one(p6b, 'NAME Bad Name'), seen(p6a, p6b));

    // R7 script paths
    const p7 = ['C:/Users/x/y.mjs', '../x.mjs', 'tools\\fake\\echo.mjs'].map(script => with1({ script }));
    check('registry: an absolute path, a .. part and a backslash path are SCRIPT problems', p7.every(p => one(p, 'SCRIPT fake run')), seen(p7));

    // R8 an example the row's own flags do not accept
    const p8 = with1({ example: 'omnikom fake run 0 --nope 1' });
    check('registry: an example that parseArgs refuses with the row\'s flags is an EXAMPLE problem', one(p8, 'EXAMPLE fake run'), seen(p8));

    // R9 the clean fixture
    const p9 = checkRegistry(FIX, OPTS);
    check('registry: the clean fixture registry has no problem', p9.length === 0, seen(p9));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
