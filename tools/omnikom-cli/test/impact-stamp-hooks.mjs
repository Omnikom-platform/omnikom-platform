// Tests for `omnikom impact` (with the laptop tests it names), `ci --staged | --commit [--job]`, the GitHub verdict of a commit (lib/ghrun.mjs), the pre-push hook and `omnikom land` (DECISIONS 43 and 45).
// Called from run.mjs (units part). Every repository here is a throwaway one under the OS temp folder, removed at the end; the real
// repository is only READ (the proof case of the brief). Nothing is committed or pushed anywhere but into those throwaway repositories.
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, cpSync, statSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeFakeGh, runRow, jobRows, stepRows } from './fake-gh.mjs';

const cleanEnv = (() => {
  const e = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  for (const k of Object.keys(e)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|OBJECT_DIRECTORY|COMMON_DIR|NAMESPACE)$/.test(k)) delete e[k];
  delete e.OMNIKOM_REPO_ROOT;                    // a hook started by the test's `git push` must see the throwaway repo, not the real one
  return e;
})();

const WORKFLOW = [
  'name: ci', 'on: [push]', 'jobs:',
  '  unit:', '    name: unit', '    runs-on: ubuntu-latest', '    timeout-minutes: 5', '    steps:',
  '      - name: Check out the repository', '        uses: actions/checkout@abc',
  '      - name: Unit', '        run: node app/gate-a.mjs',
  '  reader:', '    name: reader', '    runs-on: ubuntu-latest', '    timeout-minutes: 5', '    steps:',
  '      - name: Reader', '        run: node app/reader.mjs',
  '  secrets:', '    name: secret scan', '    runs-on: ubuntu-latest', '    timeout-minutes: 5', '    steps:',
  '      - name: Scan', '        run: gitleaks detect --source . lib/a.mjs',
  '',
].join('\n');

const PLANT = {
  'docs/departments/README.md': '# the departments\n',
  'docs/departments/alpha.md': '# Alpha\n\n## Owns\n- `lib/`\n- `app/` except `app/vendor/`\n- `shared.sql`\n- `docs/blueprint/`\n\n## Does not touch\n- `lib/special/`\n',
  'docs/departments/beta.md': '# Beta\n\n## Owns\n- `lib/special/`\n- `data/`\n- `tools/`\n\n## Does not touch\n- `lib/a.mjs`\n',
  'lib/a.mjs': "import { b } from './b.mjs';\nexport const a = b;\n",
  'lib/b.mjs': "import { c } from './special/c.mjs';\nexport const b = c;\n",
  'lib/special/c.mjs': 'export const c = 1;\n',
  'lib/twin.mjs': 'export const twin = 1;\n',
  'shared.sql': 'select 1;\n',
  'data/conf/x.json': '{"x":1}\n',
  'data/conf/y.json': '{"y":1}\n',
  'data/top.json': '{"t":1}\n',
  'app/reader.mjs': "import { join } from 'node:path';\nimport { readFileSync } from 'node:fs';\nconst REPO = process.cwd();\nexport const x = readFileSync(join(REPO, 'data', 'conf', 'x.json'), 'utf8');\n",
  'app/folder2.mjs': "import { join } from 'node:path';\nconst REPO = process.cwd();\nexport const d = join(REPO, 'data', 'conf');\n",
  'app/folder1.mjs': "import { join } from 'node:path';\nconst REPO = process.cwd();\nexport const d = join(REPO, 'data');\n",
  'app/bare.mjs': "export const p = 'data/top.json';\n",
  'app/commented.mjs': "// see 'lib/twin.mjs' and join(REPO, 'lib', 'twin.mjs')\n/* import x from './../lib/twin.mjs' */\nexport const z = 1;\n",
  'app/vendor/v.mjs': "import { c } from '../../lib/special/c.mjs';\nexport const v = c;\n",
  'app/gate-a.mjs': "import { a } from '../lib/a.mjs';\nconsole.log(a);\n",
  'notes/readme.md': 'prose\n',
  'docs/blueprint/specs/run-all-gates.mjs': "const GATES = [\n  ['alpha tests', 'app/gate-a.mjs'],\n];\nconsole.log(GATES);\n",
  '.github/workflows/ci.yml': WORKFLOW,
  'tools/omnikom-cli/impact-copies.json': JSON.stringify([
    { name: 'PAIR', files: ['shared.sql', 'lib/twin.mjs'], why: 'a copy' },
    { name: 'GONE', files: ['shared.sql', 'lib/missing.mjs'], why: 'a file that no longer exists' },
  ]),
};

export async function impactStampHooksTests({ check, cli, CLI_ROOT, REPO_ROOT, lib }) {
  const work = mkdtempSync(join(tmpdir(), 'omnikom-ish-'));
  try { await body(); } finally { rmSync(work, { recursive: true, force: true }); }

  async function body() {
    const git = (cwd, ...args) => {
      const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 120000, env: cleanEnv });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.error}`);
      return r.stdout.trim();
    };
    const put = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
    let n = 0;
    const mkRepo = (files = PLANT) => {
      const dir = join(work, `r${++n}`);
      mkdirSync(dir);
      git(dir, 'init', '-q', '-b', 'master');
      for (const [k, v] of [['user.name', 'tester'], ['user.email', 't@example.invalid'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(dir, 'config', k, v);
      for (const [rel, text] of Object.entries(files)) put(dir, rel, text);
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'init');
      return dir;
    };
    const imp = async (dir, args) => { const r = await cli(['impact', '--json', ...args], {}, { repo: dir }); return { ...r, d: r.json && r.json.data }; };
    const row = (d, path) => d.rows.find(r => r.path === path);
    const { buildGraph, scanJs, parseGates, parseJobs, tokenize } = await lib('graph.mjs');
    const { ciVerdict, jobNamesAt, repoFromUrl } = await lib('ghrun.mjs');
    const { treeOf } = await lib('checkout.mjs');
    const { makeGit } = await lib('git.mjs');
    const impactMod = await import(pathToFileURL(join(CLI_ROOT, 'commands', 'impact.mjs')).href);
    const { HOOK_TEXT, NO_VERIFY_LINE } = await import(pathToFileURL(join(CLI_ROOT, 'commands', 'hooks.mjs')).href);

    // ============================================================================ the scanner
    const harnessLine = "const { seedTestSql } = await import(pathToFileURL(join(REPO, 'tools', 'omnikom-cli', 'commands', 'seed.mjs')).href);";
    const s1 = scanJs(harnessLine);
    check('impact: the scanner finds the join(REPO, ...) form of supabase/functions/test/harness.mjs line 43 as a read from the repo root',
      s1.paths.length === 1 && s1.paths[0].base === 'root' && s1.paths[0].rel === 'tools/omnikom-cli/commands/seed.mjs', JSON.stringify(s1.paths));
    const s2 = scanJs("import a from './x.mjs';\nexport { b } from '../y.mjs';\nconst c = await import('./z.mjs');\nconst d = require('./w.cjs');\nimport './side.mjs';\n");
    check('impact: the scanner finds import, export from, import(), require() and a side-effect import', s2.imports.join(' ') === './x.mjs ../y.mjs ./z.mjs ./w.cjs ./side.mjs', s2.imports.join(' '));
    const s3 = scanJs("// join(REPO, 'a', 'b.mjs')\n/* 'c/d.mjs' */\nconst re = /['\"]e\\/f\\.mjs/; const t = `g/h.mjs`; const u = 'i/j.mjs'; const w = new URL('./k.json', import.meta.url);\n");
    check('impact: a comment and a regex literal give no edge; a template without interpolation, a bare literal and new URL(..., import.meta.url) do',
      s3.paths.length === 1 && s3.paths[0].base === 'file' && s3.paths[0].rel === './k.json' && s3.lits.join(' ') === 'g/h.mjs i/j.mjs', JSON.stringify(s3));
    const s4 = scanJs("const p = repoPath('supabase', 'tests'); const q = await importRepo('tools/x.mjs'); const r = path.join(HERE, '..', 'z'); const w = join(REPO, 'a', `b/${name}.sql`);");
    check('impact: repoPath(), importRepo(), path.join(HERE, ...) and a template with an interpolation (its folder part only)',
      s4.paths.length === 4 && s4.paths[0].rel === 'supabase/tests' && s4.paths[1].rel === 'tools/x.mjs' && s4.paths[2].base === 'anc' && s4.paths[3].rel === 'a/b/', JSON.stringify(s4.paths));
    const real = (() => { try { return readFileSync(join(REPO_ROOT, 'docs', 'blueprint', 'specs', 'run-all-gates.mjs'), 'utf8'); } catch { return ''; } })();
    const gatesRows = parseGates(real);
    check('impact: the GATES table of run-all-gates.mjs is read as data (the file is not imported)',
      gatesRows.length >= 5 && gatesRows.some(([name, script]) => name === 'function tests (Deno)' && script === 'supabase/functions/test/run.mjs'), JSON.stringify(gatesRows.slice(0, 2)));
    const ciReal = (() => { try { return readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'); } catch { return ''; } })();
    const jobsReal = parseJobs(ciReal);
    check('impact: the jobs of ci.yml are read with their run lines and timeout-minutes',
      jobsReal.some(j => j.id === 'functions' && /supabase\/functions\/test\/run\.mjs/.test(j.run)) && jobsReal.some(j => j.id === 'gates' && j.timeoutMinutes > 0), JSON.stringify(jobsReal.map(j => j.id)));
    check('impact: the tokenizer drops a regex literal that holds a quote (the string after it is still a string)', tokenize("const r = /'/g; const s = 'lib/x.mjs';").filter(t => t.t === 'str').map(t => t.v).join(',') === 'lib/x.mjs');

    // ============================================================================ impact on a planted repository
    const R = mkRepo();
    let r = await imp(R, ['lib/b.mjs']);
    check('impact: a static import (lib/a.mjs imports lib/b.mjs), with its owner', r.exit === 0 && row(r.d, 'lib/a.mjs') && row(r.d, 'lib/a.mjs').why === 'imports lib/b.mjs' && row(r.d, 'lib/a.mjs').owner === 'alpha', JSON.stringify(r.d && r.d.rows));
    r = await imp(R, ['lib/special/c.mjs']);
    check('impact: a transitive import is followed (a imports b, which imports c) and says through whom',
      row(r.d, 'lib/a.mjs') && row(r.d, 'lib/a.mjs').why === 'imports lib/b.mjs, which imports lib/special/c.mjs' && row(r.d, 'app/gate-a.mjs') && /^imports lib\/a\.mjs, which imports lib\/b\.mjs, which imports lib\/special\/c\.mjs$/.test(row(r.d, 'app/gate-a.mjs').why), JSON.stringify(r.d && r.d.rows.map(x => [x.path, x.why])));
    check('impact: the owner is the longest matching path of the charters (lib/special/ is beta, lib/ is alpha); the changed file shows its owner',
      r.d.changed[0].owner === 'beta' && row(r.d, 'lib/b.mjs').owner === 'alpha');
    check('impact: a bullet\'s "except" path is not that charter\'s own, so the file is "unowned" and is a finding line',
      row(r.d, 'app/vendor/v.mjs') && row(r.d, 'app/vendor/v.mjs').owner === 'unowned' && r.d.unowned.includes('app/vendor/v.mjs'));
    check('impact: gates: the GATES row and the CI job that reach a file are named; the secret scan job is never named',
      row(r.d, 'lib/a.mjs').gates.includes('gate alpha tests') && row(r.d, 'lib/a.mjs').gates.includes('job unit') && !JSON.stringify(r.d).includes('secrets'), JSON.stringify(row(r.d, 'lib/a.mjs').gates));
    check('impact: a changed file with a gate says which; the summary names the gates to run', r.d.changed[0].gates.includes('job unit') && r.d.gatesToRun.includes('gate alpha tests'));
    const txt = await cli(['impact', 'lib/special/c.mjs'], {}, { repo: R });
    const lines = txt.stdout.trim().split('\n');
    check('impact: text output is one line per file, then "changed", then a finding line, and "impact:" is the last line',
      txt.exit === 0 && /^alpha {2}lib\/a\.mjs {2}imports lib\/b\.mjs, which imports lib\/special\/c\.mjs {2}job unit; gate alpha tests$/m.test(txt.stdout)
      && lines.some(l => l === 'changed  lib/special/c.mjs  beta  job unit, reader; gate alpha tests' || /^changed {2}lib\/special\/c\.mjs {2}beta {2}/.test(l))
      && lines.some(l => l.startsWith('finding: app/vendor/v.mjs is unowned')) && /^impact: \d+ files outside beta; gates to run: /.test(lines.filter(l => !l.startsWith('laptop:') && !l.startsWith('  ')).pop()), txt.stdout);
    r = await imp(R, ['data/conf/x.json']);
    check('impact: a path built with join(REPO, "data", "conf", "x.json") is a read from the repo root', row(r.d, 'app/reader.mjs') && row(r.d, 'app/reader.mjs').why === 'reads data/conf/x.json', JSON.stringify(r.d && r.d.rows.map(x => x.path)));
    check('impact: a folder named by two segments (join(REPO, "data", "conf")) reads every file under it; one segment ("data") reads nothing', !!row(r.d, 'app/folder2.mjs') && !row(r.d, 'app/folder1.mjs'), JSON.stringify(r.d.rows.map(x => x.path)));
    check('impact: the job that runs the reader is named for the file it reads', r.d.changed[0].gates.includes('job reader'), JSON.stringify(r.d.changed[0]));
    r = await imp(R, ['data/top.json']);
    check('impact: a bare string literal with a "/" that names a tracked file is a read', !!row(r.d, 'app/bare.mjs') && !row(r.d, 'app/folder1.mjs'), JSON.stringify(r.d.rows.map(x => x.path)));
    r = await imp(R, ['lib/twin.mjs']);
    check('impact: a path mentioned only in a comment gives no edge', !row(r.d, 'app/commented.mjs'), JSON.stringify(r.d.rows.map(x => x.path)));
    check('impact: a named literal copy (impact-copies.json) lists the other file of the entry; an entry whose other file is gone adds nothing',
      row(r.d, 'shared.sql') && row(r.d, 'shared.sql').why === 'copy PAIR of lib/twin.mjs' && r.d.rows.length === 1, JSON.stringify(r.d.rows.map(x => [x.path, x.why])));
    r = await imp(R, ['notes/readme.md']);
    const proseTxt = await cli(['impact', 'notes/readme.md'], {}, { repo: R });
    check('impact: a prose file no gate reads says "no gate reads it" and the last line says prose only',
      r.d.proseOnly === true && r.d.rows.length === 0 && /^changed {2}notes\/readme\.md {2}unowned {2}no gate reads it$/m.test(proseTxt.stdout) && proseTxt.stdout.trim().split('\n').pop() === 'impact: prose only, no gate reads these files', proseTxt.stdout);
    check('impact: a path that is not tracked and does not exist is a usage error (exit 2); so is a call with nothing to do',
      (await cli(['impact', 'no/such/file.mjs'], {}, { repo: R })).exit === 2 && (await cli(['impact'], {}, { repo: R })).exit === 2 && (await cli(['impact', '--staged', 'lib/a.mjs'], {}, { repo: R })).exit === 2);
    check('impact: it informs and does not judge (exit 0), and --commit with an unknown sha is a usage error',
      (await cli(['impact', 'lib/b.mjs'], {}, { repo: R })).exit === 0 && (await cli(['impact', '--commit', 'deadbeefdeadbeef'], {}, { repo: R })).exit === 2);
    // --staged and --commit
    put(R, 'lib/special/c.mjs', 'export const c = 2;\n');
    git(R, 'add', 'lib/special/c.mjs');
    r = await imp(R, ['--staged']);
    check('impact: --staged takes the files of the index', r.d && r.d.changed.length === 1 && r.d.changed[0].path === 'lib/special/c.mjs' && !!row(r.d, 'lib/a.mjs'), JSON.stringify(r.d && r.d.changed));
    git(R, 'commit', '-q', '-m', 'c two');
    r = await imp(R, ['--commit', 'HEAD']);
    check('impact: --commit <sha> takes that commit against its first parent', r.d && r.d.changed.length === 1 && r.d.changed[0].path === 'lib/special/c.mjs' && !!row(r.d, 'lib/a.mjs'), JSON.stringify(r.d && r.d.changed));
    check('impact: it prints the laptop tests it names: per ci.yml job, the ci --job command for that commit and the job\'s own run: commands (the secret scan job stays out); the JSON carries laptop: [{ job, command, steps }]',
      r.d && r.d.laptop.map(l => l.job).join(',') === 'unit' && r.d.laptop[0].command === 'node tools/omnikom-cli/omnikom.mjs ci --job unit --commit HEAD' && r.d.laptop[0].steps.join('|') === 'node app/gate-a.mjs',
      JSON.stringify(r.d && r.d.laptop));
    const laptopTxt = await cli(['impact', '--commit', 'HEAD'], {}, { repo: R });
    check('impact: the text has "laptop: node tools/omnikom-cli/omnikom.mjs ci --job unit --commit HEAD" then "  node app/gate-a.mjs", after the impact line',
      laptopTxt.stdout.includes('laptop: node tools/omnikom-cli/omnikom.mjs ci --job unit --commit HEAD\n  node app/gate-a.mjs\n') && laptopTxt.stdout.indexOf('impact:') < laptopTxt.stdout.indexOf('laptop:') && !/gitleaks/.test(laptopTxt.stdout), laptopTxt.stdout);
    const pathLaptop = await imp(R, ['data/conf/x.json']);
    check('impact: file arguments name the jobs with --staged in the command (the reader job here, with its own run: command)',
      pathLaptop.d.laptop.length === 1 && pathLaptop.d.laptop[0].job === 'reader' && pathLaptop.d.laptop[0].command === 'node tools/omnikom-cli/omnikom.mjs ci --job reader --staged' && pathLaptop.d.laptop[0].steps.join('|') === 'node app/reader.mjs', JSON.stringify(pathLaptop.d.laptop));
    check('impact: a prose file names no laptop test (laptop: [])', (await imp(R, ['notes/readme.md'])).d.laptop.length === 0);
    git(R, 'rm', '-q', 'lib/b.mjs');
    git(R, 'commit', '-q', '-m', 'b gone');
    r = await imp(R, ['--commit', 'HEAD']);
    check('impact: a file the commit deleted is a changed file, and the importer that still names it is listed', r.d && r.d.changed[0].path === 'lib/b.mjs' && !!row(r.d, 'lib/a.mjs'), JSON.stringify(r.d && r.d.rows.map(x => x.path)));

    // the owners and their "except", on the real charters
    {
      const g = makeGit(REPO_ROOT);
      const files = g.out(['ls-files', '-z']).split('\0').filter(Boolean);
      const owners = impactMod.parseOwners(files, p => { try { return readFileSync(join(REPO_ROOT, p), 'utf8'); } catch { return null; } });
      const o = p => impactMod.ownerOf(p, owners);
      check('impact: the real charters give platform-build supabase/ and docs/blueprint/ but not docs/blueprint/26-PLATFORM-CLI.md (the CLI department) or 22-SEARCH... (SEO)',
        o('supabase/functions/test/harness.mjs') === 'platform-build' && o('docs/blueprint/25-BUILD-SEQUENCE.md') === 'platform-build' && o('docs/blueprint/26-PLATFORM-CLI.md') === 'cli-and-testing'
        && o('docs/blueprint/22-SEARCH-AND-ANALYTICS.md') === 'seo-and-audits' && o('tools/omnikom-cli/lib/graph.mjs') === 'cli-and-testing' && o('sops/clients/x.md') === 'clients' && o('planning/DECISIONS.md') === 'head-of-operations', owners.length + ' bullets');
    }

    // ============================================================================ the proof case, on the real repository
    {
      const z = await cli(['impact', '--json', 'tools/omnikom-cli/commands/seed.mjs'], {});
      const d = z.json && z.json.data;
      const h = d && d.rows.find(x => x.path === 'supabase/functions/test/harness.mjs');
      const t = d && d.rows.find(x => x.path === 'supabase/tests/tenancy.test.sql');
      check('impact (real repo): changing commands/seed.mjs names supabase/functions/test/harness.mjs, owner platform-build, the functions job and the gate "function tests (Deno)"',
        z.exit === 0 && !!h && h.owner === 'platform-build' && h.gates.includes('job functions') && h.gates.includes('gate function tests (Deno)'), JSON.stringify(h));
      check('impact (real repo): and supabase/tests/tenancy.test.sql as a copy (TEST_CONTRACT), with the walls gate',
        !!t && /^copy TEST_CONTRACT of tools\/omnikom-cli\/commands\/seed\.mjs/.test(t.why) && t.gates.includes('gate database walls + mutants'), JSON.stringify(t));
      const om = d && d.rows.find(x => x.path === 'tools/omnikom-cli/omnikom.mjs');
      check('impact (real repo): omnikom.mjs, which imports commands/seed.mjs, is listed as an importer (the import scan, not a path read)', !!om && om.why === 'imports tools/omnikom-cli/commands/seed.mjs' && om.owner === 'cli-and-testing', JSON.stringify(om));
      const have = spawnSync('git', ['cat-file', '-e', 'eeb8431^{commit}'], { cwd: REPO_ROOT, env: cleanEnv, timeout: 30000 }).status === 0;
      if (have) {
        const c = await cli(['impact', '--json', '--commit', 'eeb8431'], {});
        const ch = c.json && c.json.data && c.json.data.rows.find(x => x.path === 'supabase/functions/test/harness.mjs');
        check('impact (real repo): --commit eeb8431 names the same harness.mjs and the functions job', c.exit === 0 && !!ch && ch.owner === 'platform-build' && ch.gates.includes('job functions') && ch.gates.includes('gate function tests (Deno)'), JSON.stringify(ch));
        const ct = c.json && c.json.data && c.json.data.rows.find(x => x.path === 'supabase/tests/tenancy.test.sql');
        const lap = c.json && c.json.data && c.json.data.laptop && c.json.data.laptop.find(x => x.job === 'functions');
        const cText = await cli(['impact', '--commit', 'eeb8431'], {});
        check('impact (real repo): --commit eeb8431 also prints "laptop: ... ci --job functions --commit eeb8431" and the functions job\'s own steps',
          !!lap && lap.command === 'node tools/omnikom-cli/omnikom.mjs ci --job functions --commit eeb8431' && lap.steps.includes('node supabase/functions/test/run.mjs') && lap.steps.includes('node supabase/functions/test/mutate.mjs')
          && cText.stdout.includes('laptop: node tools/omnikom-cli/omnikom.mjs ci --job functions --commit eeb8431\n') && cText.stdout.includes('\n  node supabase/functions/test/run.mjs\n'), JSON.stringify(lap));
        check('impact (real repo): --commit eeb8431 names tenancy.test.sql as the copy TEST_CONTRACT (that commit predates the registry: the working tree\'s registry is used)', !!ct && /^copy TEST_CONTRACT of /.test(ct.why), JSON.stringify(ct));
      } else check('impact (real repo): --commit eeb8431 (SKIPPED here: that commit is not in this clone, a shallow checkout; the changed-file form above is the same case)', true);
      const reg = JSON.parse(readFileSync(join(CLI_ROOT, 'impact-copies.json'), 'utf8'));
      const gone = reg.flatMap(e => e.files).filter(f => !existsSync(join(REPO_ROOT, f)));
      check('impact: every file named by impact-copies.json exists (a rename must update the registry)', reg.length >= 5 && reg[0].name === 'TEST_CONTRACT' && gone.length === 0, gone.join(', '));
      const pr = await cli(['impact', '--json', 'docs/departments/README.md'], {});
      check('impact (real repo): docs/departments/README.md says what reads it', pr.exit === 0 && pr.json.data.rows.length > 0 && pr.json.data.changed[0].gates.length > 0, JSON.stringify(pr.json && pr.json.data.rows.map(x => x.path)));
    }

    // ============================================================================ ghrun: the verdict of one commit (DECISIONS 45)
    const SHA = 'c'.repeat(40), OTHER = 'd'.repeat(40);
    const NAMES = ['unit', 'reader', 'secret scan'];
    const RUN1 = 'https://github.com/o/r/actions/runs/1';
    const verdict = async (state, { sha = SHA, names = NAMES } = {}) => {
      const gh = makeFakeGh(() => state);
      try { return { v: await ciVerdict({ gh }, { repo: 'o/r', sha, jobNames: names }), gh }; } catch (e) { return { err: e, gh }; }
    };
    let q = await verdict({ runs: [runRow(SHA)], jobs: { 1: jobRows(NAMES) } });
    check('ghrun: every job of a completed run success is green, and the green line says commit, run and job count', q.v && q.v.state === 'green' && q.v.lines.join('|') === `ci green: ${SHA} run 1, 3 of 3 jobs success`, JSON.stringify(q.v || q.err));
    check('ghrun: the calls are gh run list (--repo --commit --workflow ci.yml --json ... --limit 50) and gh run view <id> --repo --json jobs',
      q.gh.calls[0].join(' ') === `run list --repo o/r --commit ${SHA} --workflow ci.yml --json databaseId,status,conclusion,headSha,event,url,createdAt --limit 50` && q.gh.calls[1].join(' ') === 'run view 1 --repo o/r --json jobs', JSON.stringify(q.gh.calls));
    for (const c of ['skipped', 'failure', 'cancelled', 'timed_out', 'neutral', 'action_required']) {
      q = await verdict({ runs: [runRow(SHA)], jobs: { 1: jobRows(NAMES, { reader: c }) } });
      check(`ghrun: one job ${c} makes the commit red, with the line <run url>  <job name>  <conclusion>`, q.v && q.v.state === 'red' && q.v.lines.join('|') === `${RUN1}  reader  ${c}`, JSON.stringify(q.v || q.err));
    }
    q = await verdict({ runs: [runRow(SHA)], jobs: { 1: jobRows(['unit', 'reader']) } });
    check('ghrun: a job of ci.yml that the run does not have is red ("missing"): a job added to ci.yml is not skipped by an old run', q.v && q.v.state === 'red' && q.v.lines.join('|') === `${RUN1}  secret scan  missing`, JSON.stringify(q.v || q.err));
    q = await verdict({ runs: [runRow(SHA, { id: 9, conclusion: 'cancelled' }), runRow(SHA)], jobs: { 1: jobRows(NAMES) } });
    check('ghrun: a cancelled run (ci.yml cancels in progress) is ignored: the other run decides and the cancelled run\'s jobs are never asked for', q.v && q.v.state === 'green' && !q.gh.calls.some(c => c.includes('9')), JSON.stringify(q.v || q.err));
    q = await verdict({ runs: [runRow(SHA, { id: 9, conclusion: 'cancelled' })], jobs: {} });
    check('ghrun: only a cancelled run is "none"', q.v && q.v.state === 'none' && q.v.lines[0] === `no ci run for ${SHA}`, JSON.stringify(q.v || q.err));
    q = await verdict({ runs: [runRow(SHA, { id: 1 }), runRow(SHA, { id: 2 })], jobs: { 1: jobRows(NAMES), 2: jobRows(NAMES, { unit: 'failure' }) } });
    check('ghrun: one green run and one red run of the same commit is red (a failure on the same sha is a signal), and only the red run is listed',
      q.v && q.v.state === 'red' && q.v.lines.join('|') === 'https://github.com/o/r/actions/runs/2  unit  failure', JSON.stringify(q.v || q.err));
    q = await verdict({ runs: [runRow(OTHER)], jobs: { 1: jobRows(NAMES) } });
    check('ghrun: a run whose headSha is not exactly the commit is ignored (the --commit filter is never trusted): none, and no job is read', q.v && q.v.state === 'none' && q.gh.calls.length === 1, JSON.stringify(q.v || q.err));
    q = await verdict({ runs: [runRow(SHA, { status: 'in_progress', conclusion: null })], jobs: {} });
    check('ghrun: a run that is not completed is pending, with the run url', q.v && q.v.state === 'pending' && q.v.lines[0] === `${RUN1}  ci run in_progress`, JSON.stringify(q.v || q.err));
    q = await verdict({ runs: [runRow(SHA, { conclusion: 'failure' })], jobs: { 1: jobRows(NAMES) } });
    check('ghrun: a completed run whose own conclusion is not success is red even when every job listed passed', q.v && q.v.state === 'red' && q.v.lines.join('|') === `${RUN1}  (run)  failure`, JSON.stringify(q.v || q.err));
    q = await verdict({ runs: [], jobs: {} });
    check('ghrun: no run at all is "none"', q.v && q.v.state === 'none', JSON.stringify(q.v || q.err));
    q = await verdict({ fail: 'gh: To get started with GitHub CLI, please run: gh auth login (not logged in)' });
    check('ghrun: a failed gh call is Blocked and carries the cause (the hook and land fail closed)', q.err && q.err.name === 'Blocked' && /not logged in/.test(q.err.message) && !!q.err.unblock, String(q.err && q.err.message));
    q = await verdict({ fail: 'gh is not installed (not found on PATH)' });
    check('ghrun: gh not installed is Blocked, not "no run"', q.err && q.err.name === 'Blocked' && /not installed/.test(q.err.message), String(q.err && q.err.message));
    {
      let bad;
      try { bad = await ciVerdict({ gh: () => ({ ok: true, out: 'not json', err: '' }) }, { repo: 'o/r', sha: SHA, jobNames: NAMES }); } catch (e) { bad = e; }
      check('ghrun: an answer that is not JSON is Blocked', bad && bad.name === 'Blocked', String(bad && bad.message));
    }
    // the billing line: GitHub never started the jobs (every failed job has zero steps), 2026-11-01 ~10:00
    {
      const BILL = 'The job was not started because recent account payments have failed or your spending limit needs to be increased.';
      const dead = { unit: 'failure', reader: 'failure', 'secret scan': 'failure' };
      const noRan = { unit: 0, reader: 0, 'secret scan': 0 };
      const redLines = `${RUN1}  unit  failure|${RUN1}  reader  failure|${RUN1}  secret scan  failure`;
      const apiCalls = x => x.gh.calls.filter(c => c[0] === 'api');
      q = await verdict({ runs: [runRow(SHA, { conclusion: 'failure' })], jobs: { 1: stepRows(NAMES, dead, noRan) }, annotations: { 100: [{ message: `${BILL}\nsecond line` }] } });
      check('ghrun: red and EVERY failed job has zero steps: one line after the red lines, "ci: no job ran a step; GitHub says: <first line of the first annotation>", the verdict stays red',
        q.v && q.v.state === 'red' && q.v.lines.slice(0, -1).filter(l => l.startsWith(RUN1)).length >= 3 && q.v.lines.at(-1) === `ci: no job ran a step; GitHub says: ${BILL}` && q.v.lines.includes(`${RUN1}  unit  failure`), JSON.stringify(q.v || q.err));
      check('ghrun: the billing line costs exactly one more gh call: gh api repos/<repo>/check-runs/<id of a failed job>/annotations',
        q.gh.calls.length === 3 && apiCalls(q).length === 1 && apiCalls(q)[0].join(' ') === 'api repos/o/r/check-runs/100/annotations', JSON.stringify(q.gh.calls));
      q = await verdict({ runs: [runRow(SHA)], jobs: { 1: stepRows(NAMES, dead, noRan) }, annotations: { 100: [{ message: `${'x'.repeat(300)}` }] } });
      check('ghrun: the annotation message is cut to 200 characters', q.v && q.v.lines.at(-1) === `ci: no job ran a step; GitHub says: ${'x'.repeat(200)}`, JSON.stringify(q.v || q.err));
      q = await verdict({ runs: [runRow(SHA)], jobs: { 1: stepRows(NAMES, dead, noRan) }, annotationsFail: 'gh: HTTP 403' });
      const fallback = 'ci: no job ran a step (GitHub did not start them; check the Actions minutes and billing)';
      check('ghrun: when the annotation call fails the line is the fallback, and the verdict is still red (a failed extra call is never Blocked)', q.v && q.v.state === 'red' && q.v.lines.at(-1) === fallback, JSON.stringify(q.v || q.err));
      q = await verdict({ runs: [runRow(SHA)], jobs: { 1: stepRows(NAMES, dead, noRan) }, annotations: { 100: [] } });
      check('ghrun: when the job has no annotation the line is the fallback', q.v && q.v.state === 'red' && q.v.lines.at(-1) === fallback, JSON.stringify(q.v || q.err));
      q = await verdict({ runs: [runRow(SHA)], jobs: { 1: stepRows(NAMES, dead, { unit: 0, reader: 0 }) }, annotations: { 100: [{ message: BILL }] } });
      check('ghrun: one failed job that DID run its steps means no billing line (and no extra gh call)', q.v && q.v.state === 'red' && !q.v.lines.some(l => l.startsWith('ci: no job')) && apiCalls(q).length === 0 && q.v.lines.join('|') === redLines, JSON.stringify(q.v || q.err));
      q = await verdict({ runs: [runRow(SHA)], jobs: { 1: stepRows(NAMES, { reader: 'failure' }, { reader: 3 }) }, annotations: { 101: [{ message: BILL }] } });
      check('ghrun: an ordinary red job (steps ran) has no billing line', q.v && q.v.state === 'red' && q.v.lines.join('|') === `${RUN1}  reader  failure` && apiCalls(q).length === 0, JSON.stringify(q.v || q.err));
      q = await verdict({ runs: [runRow(SHA)], jobs: { 1: stepRows(NAMES, {}, noRan) } });
      check('ghrun: a green run whose jobs list no steps is still green, with no extra call', q.v && q.v.state === 'green' && q.gh.calls.length === 2, JSON.stringify(q.v || q.err));
      q = await verdict({ runs: [runRow(SHA)], jobs: { 1: jobRows(NAMES, dead) }, annotations: { 100: [{ message: BILL }] } });
      check('ghrun: jobs whose step list is not given (an older gh) are never read as "no step"', q.v && q.v.state === 'red' && !q.v.lines.some(l => l.startsWith('ci: no job')) && apiCalls(q).length === 0, JSON.stringify(q.v || q.err));
    }
    const rf = u => { try { return repoFromUrl(u); } catch (e) { return e; } };
    check('ghrun: repoFromUrl reads https and ssh forms, with and without .git, and a user in the url',
      rf('https://github.com/o/r') === 'o/r' && rf('https://github.com/o/r.git') === 'o/r' && rf('git@github.com:o/r.git') === 'o/r' && rf('git@github.com:o/r') === 'o/r'
      && rf('ssh://git@github.com/o/r.git') === 'o/r' && rf('https://x-access-token:abc@github.com/Omni-kom/my.repo.git') === 'Omni-kom/my.repo', [rf('https://github.com/o/r.git'), rf('git@github.com:o/r')].join(' '));
    const rfBad = rf('https://tok123@gitlab.com/o/r.git');
    check('ghrun: a url that is not github.com is Blocked, names the url and never prints a user from it', rfBad.name === 'Blocked' && rfBad.message.includes('gitlab.com/o/r.git') && !rfBad.message.includes('tok123')
      && rf('/tmp/some/bare.git').name === 'Blocked' && rf('https://github.com.evil.example/o/r').name === 'Blocked' && rf('').name === 'Blocked', rfBad.message);
    {
      const JR = mkRepo();
      const jg = makeGit(JR);
      check('ghrun: jobNamesAt reads the name: of every job of ci.yml at that commit', jobNamesAt(jg, 'HEAD').join('|') === 'unit|reader|secret scan', jobNamesAt(jg, 'HEAD').join('|'));
      const NOWF = mkRepo({ 'a.txt': 'x\n' });
      let nb; try { jobNamesAt(makeGit(NOWF), 'HEAD'); } catch (e) { nb = e; }
      check('ghrun: a commit with no ci.yml is Blocked', nb && nb.name === 'Blocked' && /no \.github\/workflows\/ci\.yml/.test(nb.message), String(nb && nb.message));
      const realNames = jobsReal.map(j => j.name);
      check('ghrun: the job names of the real ci.yml are read (the gates job has the long display name, not its id)', realNames.length >= 5 && realNames.every(n => n) && realNames.some(n => /^gates \(/.test(n)), realNames.join(' | '));
    }

    // ============================================================================ ci --staged / --commit [--job]: reproduce a red GitHub job (no stamp)
    const gRoot = join(work, 'gates-root');
    const CIWF = job => `  ${job[0]}:\n    name: ${job[0]}\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - name: Check out the repository\n        uses: actions/checkout@abc\n      - name: Client files\n        run: node ${job[1]}\n`;
    const CIR = mkRepo({
      'ok.mjs': "console.log('fine');\n",
      'bad.mjs': "console.log('this job is red'); process.exit(1);\n",
      '.github/workflows/ci.yml': `name: ci\non: [push]\njobs:\n${CIWF(['one', 'ok.mjs'])}${CIWF(['two', 'bad.mjs'])}`,
    });
    const cdeps = { repo: CIR, gatesRoot: gRoot, now: () => 1800000000, manifest: { schema: 1, tools: { node: { version: process.version.slice(1) } } }, platform: 'linux-amd64' };
    const cenv = { OMNIKOM_TOOLS_DIR: join(work, 'tools-dir') };
    put(CIR, 'ok.mjs', "console.log('staged fine');\n");
    git(CIR, 'add', 'ok.mjs');
    const CT = git(CIR, 'write-tree');
    put(CIR, 'ok.mjs', 'process.exit(1); // unstaged, must not be what runs\n');
    let c = await cli(['ci', '--staged', '--job', 'one'], cenv, cdeps);
    check('ci: --staged --job one runs only that job, in the checkout of the INDEX tree (the unstaged change is not what ran), and removes the checkout',
      c.exit === 0 && /^PASS one {2}staged fine$/m.test(c.stdout) && !/\btwo\b/.test(c.stdout) && /^ci: 1 jobs, 1 PASS, 0 FAIL$/m.test(c.stdout) && !existsSync(join(gRoot, CT)) && !git(CIR, 'worktree', 'list', '--porcelain').includes('gates-root'), c.all);
    check('ci: it writes no stamp anywhere (no omnikom-gates folder in the git dir) and prints no stamp line', !existsSync(join(CIR, '.git', 'omnikom-gates')) && !/stamp/i.test(c.stdout), c.all);
    c = await cli(['ci', '--commit', 'HEAD', '--job', 'two'], cenv, cdeps);
    check('ci: --commit <sha> --job two reproduces the red job on that commit\'s tree (exit 1, FAIL two with its last line)', c.exit === 1 && /^FAIL two {2}this job is red$/m.test(c.stdout) && !/stamp/i.test(c.stdout) && !existsSync(join(CIR, '.git', 'omnikom-gates')), c.all);
    c = await cli(['ci', '--staged'], cenv, cdeps);
    check('ci: --staged without --job runs every job of that tree: one PASS, one FAIL, exit 1, no stamp', c.exit === 1 && /^PASS one /m.test(c.stdout) && /^FAIL two /m.test(c.stdout) && /^ci: 2 jobs, 1 PASS, 1 FAIL$/m.test(c.stdout) && !/stamp/i.test(c.stdout)
      && !existsSync(join(gRoot, CT)) && !git(CIR, 'worktree', 'list', '--porcelain').includes('gates-root'), c.all);
    c = await cli(['ci', '--staged', '--job', 'nope'], cenv, cdeps);
    check('ci: an unknown --job with --staged is a usage error (exit 2) and the checkout is removed', c.exit === 2 && /no job 'nope'/.test(c.all) && !existsSync(join(gRoot, CT)), c.all);
    check('ci: --staged cannot be combined with --root or --commit', (await cli(['ci', '--staged', '--root', CIR], cenv, cdeps)).exit === 2 && (await cli(['ci', '--staged', '--commit', 'HEAD'], cenv, cdeps)).exit === 2);
    c = await cli(['ci', '--root', CIR, '--job', 'one'], cenv, cdeps);
    check('ci: without --staged / --commit it runs on the working tree as before (the unstaged change is what ran: FAIL)', c.exit === 1 && /^FAIL one /m.test(c.stdout) && !existsSync(join(CIR, '.git', 'omnikom-gates')), c.all);
    c = await cli(['ci', '--commit', 'deadbeefdeadbeef'], cenv, cdeps);
    check('ci: --commit with an unknown sha is a usage error (exit 2) and runs nothing', c.exit === 2, c.all);
    {
      const heavyJob = "  cli:\n    name: cli\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - name: Check out the repository with its whole history\n        uses: actions/checkout@abc\n        with:\n          persist-credentials: false\n          fetch-depth: 0\n      - name: CLI full suite and mutants (when the change reaches them)\n        run: node ok.mjs\n";
      const HV = mkRepo({ 'ok.mjs': "console.log('heavy step ran');\n", '.github/workflows/ci.yml': `name: ci\non: [push]\njobs:\n${heavyJob}` });
      const hv = await cli(['ci', '--commit', 'HEAD', '--job', 'cli'], cenv, { ...cdeps, repo: HV });
      check('ci: the step "CLI full suite and mutants (when the change reaches them)" is mapped, and a checkout step with fetch-depth: 0 under with: is accepted', hv.exit === 0 && /^PASS cli {2}heavy step ran$/m.test(hv.stdout) && !/not mapped/.test(hv.all), hv.all);
    }
    const bad = join(work, 'Claude-Gates');
    const eRoot = (await cli(['ci', '--staged'], cenv, { ...cdeps, gatesRoot: 'E:/omk-gates-test' }));
    const cRoot = (await cli(['ci', '--staged'], cenv, { ...cdeps, gatesRoot: bad }));
    check('ci: a checkout root on E: is refused (exit 2) before anything runs', eRoot.exit === 2 && /E:/.test(eRoot.all), eRoot.all);
    check('ci: a checkout root whose path contains "claude" is refused (exit 2), whatever the case, and nothing is created', cRoot.exit === 2 && /claude/i.test(cRoot.all) && !existsSync(bad), cRoot.all);
    {
      const stagedOnly = mkRepo({ 'ok.mjs': "console.log('fine');\n", '.github/workflows/ci.yml': `name: ci\non: [push]\njobs:\n${CIWF(['one', 'ok.mjs'])}` });
      put(stagedOnly, 'ok.mjs', "console.log('index tree');\n");
      git(stagedOnly, 'add', 'ok.mjs');
      const headTree = git(stagedOnly, 'rev-parse', 'HEAD^{tree}'), idxTree = git(stagedOnly, 'write-tree');
      const t = treeOf(makeGit(stagedOnly), {});
      check('ci: --staged is the tree of the INDEX (git write-tree), not HEAD\'s tree; --commit <sha> is that commit\'s tree', t === idxTree && t !== headTree && treeOf(makeGit(stagedOnly), { commit: 'HEAD' }) === headTree, `${t} ${idxTree} ${headTree}`);
    }

    // ============================================================================ hooks install / uninstall / status
    const H = mkRepo();
    const hookFile = join(H, '.git', 'hooks', 'pre-push');
    let h = await cli(['hooks', 'status', '--json'], {}, { repo: H });
    check('hooks: status of a fresh repository is "not installed"', h.exit === 0 && h.json.data.state === 'not installed', h.all);
    h = await cli(['hooks', 'install', '--json'], {}, { repo: H });
    const bytes = readFileSync(hookFile);
    check('hooks: install writes <git dir>/hooks/pre-push: the three-line shim, LF line endings, no BOM',
      h.exit === 0 && bytes.toString('utf8') === HOOK_TEXT && !bytes.includes(13) && bytes[0] === 0x23 && HOOK_TEXT === '#!/bin/sh\n# omnikom pre-push (DECISIONS 45)\nexec node tools/omnikom-cli/omnikom.mjs hooks pre-push "$@"\n', h.all);
    const m1 = statSync(hookFile).mtimeMs;
    h = await cli(['hooks', 'install', '--json'], {}, { repo: H });
    check('hooks: installing twice changes nothing (same bytes, same file, action "unchanged")', h.exit === 0 && h.json.data.action === 'unchanged' && readFileSync(hookFile).equals(bytes) && statSync(hookFile).mtimeMs === m1, h.all);
    check('hooks: status of an installed repository is "installed"', (await cli(['hooks', 'status', '--json'], {}, { repo: H })).json.data.state === 'installed');
    h = await cli(['hooks', 'uninstall', '--json'], {}, { repo: H });
    check('hooks: uninstall removes our file', h.exit === 0 && !existsSync(hookFile) && (await cli(['hooks', 'status', '--json'], {}, { repo: H })).json.data.state === 'not installed', h.all);
    check('hooks: uninstall with nothing installed is a no-op (exit 0)', (await cli(['hooks', 'uninstall'], {}, { repo: H })).exit === 0);
    const foreign = '#!/bin/sh\necho "somebody else\'s hook"\nexit 0\n';
    writeFileSync(hookFile, foreign);
    const fb = readFileSync(hookFile);
    h = await cli(['hooks', 'install', '--json'], {}, { repo: H });
    check('hooks: a pre-push hook that is not ours is never overwritten: BLOCKED (exit 3) and the file is left byte for byte', h.exit === 3 && h.json.code === 'BLOCKED' && readFileSync(hookFile).equals(fb), h.all);
    check('hooks: status calls it "foreign"', (await cli(['hooks', 'status', '--json'], {}, { repo: H })).json.data.state === 'foreign');
    h = await cli(['hooks', 'uninstall', '--json'], {}, { repo: H });
    check('hooks: uninstall removes only our file: a foreign hook stays (BLOCKED, exit 3)', h.exit === 3 && readFileSync(hookFile).equals(fb), h.all);
    rmSync(hookFile);
    git(H, 'config', 'core.hooksPath', 'custom-hooks');
    h = await cli(['hooks', 'install', '--json'], {}, { repo: H });
    check('hooks: with core.hooksPath set, install is BLOCKED (exit 3), names the setting and writes nothing', h.exit === 3 && /core\.hooksPath is set to custom-hooks/.test(h.json.error) && !existsSync(hookFile), h.all);
    git(H, 'config', '--unset', 'core.hooksPath');
    check('hooks: an unknown verb is a usage error', (await cli(['hooks', 'frobnicate'], {}, { repo: H })).exit === 2);

    // ============================================================================ pre-push (DECISIONS 45): master only takes a green GitHub run
    const P = mkRepo();
    const remote = join(work, 'remote.git');
    git(work, 'init', '-q', '--bare', '-b', 'master', remote);
    git(P, 'remote', 'add', 'origin', remote);
    git(P, 'push', '-q', 'origin', 'master');
    const base0 = git(P, 'rev-parse', 'HEAD');
    const zeros = '0'.repeat(40);
    const commitFile = (dir, rel, text, msg) => { put(dir, rel, text); git(dir, 'add', rel); git(dir, 'commit', '-q', '-m', msg); return git(dir, 'rev-parse', 'HEAD'); };
    const tip = commitFile(P, 'lib/b.mjs', "import { c } from './special/c.mjs';\nexport const b = c + 1;\n", 'a gated change');
    const RUNS = (sha, over = {}) => ({ runs: [runRow(sha)], jobs: { 1: jobRows(NAMES, over) } });
    const pp = async (stdin, state, extra = {}) => {
      const gh = makeFakeGh(() => state);
      const r = await cli(['hooks', 'pre-push', 'origin', remote, '--json'], {}, { repo: P, ghRepo: 'o/r', gh, stdin, ...extra });
      return { ...r, gh, text: r.json && r.json.data ? r.json.data.lines.join('\n') : r.all };
    };
    const masterLine = (sha, rsha = base0) => `refs/heads/master ${sha} refs/heads/master ${rsha}\n`;
    let p = await pp(masterLine(tip), { runs: [] });
    check('pre-push: master with NO ci run is REFUSED (exit 1) with the check-branch and land command line, the verdict line and the --no-verify line last',
      p.exit === 1 && p.text.includes(`pre-push: REFUSED refs/heads/master: ${tip} has no green ci run; push it to check/<department>/<slug> and run: node tools/omnikom-cli/omnikom.mjs land check/<department>/<slug>`)
      && p.text.includes(`pre-push: no ci run for ${tip}`) && p.json.data.lines[p.json.data.lines.length - 1] === NO_VERIFY_LINE && NO_VERIFY_LINE === "pre-push: --no-verify is the owner's alone; no session uses it.", p.text);
    const textRun = await cli(['hooks', 'pre-push', 'origin', remote], {}, { repo: P, ghRepo: 'o/r', gh: makeFakeGh(() => ({ runs: [] })), stdin: masterLine(tip) });
    check('pre-push: the refusal is plain text lines (not the JSON object) and its last line is the --no-verify line', textRun.exit === 1 && textRun.stdout.trim().split('\n').pop() === NO_VERIFY_LINE && !textRun.stdout.startsWith('{'), textRun.stdout);
    p = await pp(masterLine(tip), RUNS(tip, { reader: 'failure' }));
    check('pre-push: master with a RED ci run is refused, and the failing job is named with the run url', p.exit === 1 && p.text.includes(`pre-push: ${RUN1}  reader  failure`) && p.text.includes('REFUSED refs/heads/master'), p.text);
    p = await pp(masterLine(tip), { runs: [runRow(tip, { status: 'in_progress', conclusion: null })], jobs: {} });
    check('pre-push: master with a ci run still in progress is refused (pending is not green)', p.exit === 1 && p.text.includes('ci run in_progress'), p.text);
    p = await pp(masterLine(tip), RUNS(tip));
    check('pre-push: master with a GREEN ci run (every ci.yml job success) is allowed, and the line is the green line', p.exit === 0 && p.text === `pre-push: ci green: ${tip} run 1, 3 of 3 jobs success`, p.text);
    p = await pp(masterLine(tip), RUNS(OTHER));
    check('pre-push: a green run of ANOTHER commit does not allow this one (the commit sha names the exact tree)', p.exit === 1, p.text);
    p = await pp(masterLine(tip), { fail: 'To use GitHub CLI, run: gh auth login' });
    check('pre-push: no gh answer is a refusal (fail closed), with the cause', p.exit === 1 && p.text.includes('REFUSED refs/heads/master') && /gh auth login/.test(p.text), p.text);
    p = await pp(`refs/heads/check/cli-and-testing/x ${tip} refs/heads/check/cli-and-testing/x ${zeros}\n`, { fail: 'offline' });
    check('pre-push: a check/** branch is allowed (create), with no gh call at all', p.exit === 0 && p.text === 'pre-push: refs/heads/check/cli-and-testing/x is a check branch, allowed' && p.gh.calls.length === 0, p.text);
    p = await pp(`refs/heads/check/cli-and-testing/x ${zeros} refs/heads/check/cli-and-testing/x ${tip}\n`, { fail: 'offline' });
    check('pre-push: deleting a check/** branch is allowed', p.exit === 0 && /check branch, allowed/.test(p.text), p.text);
    p = await pp(`refs/heads/master ${zeros} refs/heads/master ${base0}\n`, RUNS(tip));
    check('pre-push: deleting master is refused', p.exit === 1 && /REFUSED refs\/heads\/master: deleting master/.test(p.text), p.text);
    const sideP = (() => { git(P, 'checkout', '-q', '-b', 'side', base0); const s = commitFile(P, 'lib/twin.mjs', 'export const twin = 2;\n', 'side'); git(P, 'checkout', '-q', 'master'); return s; })();
    p = await pp(masterLine(sideP, tip), RUNS(sideP));
    check('pre-push: a push to master that is not a fast-forward of the remote master is refused even with a green run', p.exit === 1 && /not a fast-forward of the remote master/.test(p.text) && p.gh.calls.length === 0, p.text);
    p = await pp(masterLine(tip, '1'.repeat(40)), RUNS(tip));
    check('pre-push: a remote master this clone does not have cannot be shown to be an ancestor: refused (fail closed)', p.exit === 1 && /not in this clone/.test(p.text), p.text);
    p = await pp(`refs/heads/master ${tip} refs/heads/master ${zeros}\n`, RUNS(tip));
    check('pre-push: a new remote master (remote sha all zeros) needs only the green run', p.exit === 0, p.text);
    p = await pp(`refs/heads/feature ${tip} refs/heads/feature ${zeros}\n`, RUNS(tip));
    check('pre-push: another branch is refused, naming the rule (master through land, work to check/**), even with a green run', p.exit === 1 && /master is reached only through land/.test(p.text) && /check\/<department>\/<slug>/.test(p.text), p.text);
    p = await pp(`refs/tags/v1 ${tip} refs/tags/v1 ${zeros}\n`, RUNS(tip));
    check('pre-push: a tag is refused', p.exit === 1, p.text);
    p = await pp(`refs/heads/other-local ${tip} refs/heads/master ${base0}\n`, RUNS(tip));
    check('pre-push: the REMOTE ref decides (any local branch pushed to master needs the green run: allowed here)', p.exit === 0, p.text);
    p = await pp(`refs/heads/check/cli-and-testing/x ${tip} refs/heads/feature ${zeros}\n`, RUNS(tip));
    check('pre-push: a local check/** branch pushed to a remote branch that is not check/** is refused (the remote ref decides)', p.exit === 1, p.text);
    p = await pp('', { runs: [] });
    check('pre-push: nothing on stdin is nothing to check (exit 0)', p.exit === 0 && p.json.data.lines[0] === 'pre-push: nothing to check', p.text);
    {
      const gh = makeFakeGh(() => RUNS(tip));
      const viaUrl = await cli(['hooks', 'pre-push', 'origin', 'https://github.com/Omnikom-IO/platform.git', '--json'], {}, { repo: P, gh, stdin: masterLine(tip) });
      check('pre-push: without a test override the repository comes from the remote url git passes (github.com/<owner>/<name>.git)', viaUrl.exit === 0 && gh.calls[0].includes('Omnikom-IO/platform'), viaUrl.all + JSON.stringify(gh.calls[0]));
      const notGh = await cli(['hooks', 'pre-push', 'origin', remote, '--json'], {}, { repo: P, gh: makeFakeGh(() => RUNS(tip)), stdin: masterLine(tip) });
      check('pre-push: a remote that is not on github.com is refused for master (no run can be read), never allowed', notGh.exit === 1 && /not a github\.com repository/.test(notGh.all), notGh.all);
    }
    p = await pp(masterLine(tip) + `refs/heads/check/cli-and-testing/y ${tip} refs/heads/check/cli-and-testing/y ${zeros}\n`, { runs: [] });
    check('pre-push: one refused ref refuses the whole push, and the check branch beside it is still reported as allowed', p.exit === 1 && /check branch, allowed/.test(p.text) && /REFUSED refs\/heads\/master/.test(p.text), p.text);

    // the shim itself: a real `git push` from a throwaway repository to a bare throwaway remote, through the installed hook
    const S = mkRepo();
    const sremote = join(work, 'sremote.git');
    git(work, 'init', '-q', '--bare', '-b', 'master', sremote);
    git(S, 'remote', 'add', 'origin', sremote);
    git(S, 'push', '-q', 'origin', 'master');
    const sbase = git(S, 'rev-parse', 'HEAD');
    const stateFile = join(work, 'gh-state.json');
    const setState = o => writeFileSync(stateFile, JSON.stringify(o));
    setState({ runs: [] });
    // The hook runs tools/omnikom-cli/omnikom.mjs of THIS repository. The throwaway one has no platform files for the CLI to import, so that
    // file (untracked, not part of the pushed tree) is a launcher: it runs the CLI under test (CLI_ROOT, a mutant's copy in a mutation run)
    // with this repository as the one to ask git about, a fake gh that reads its answers from a state file the test changes between pushes,
    // and git's stdin and arguments passed through. The repository the runs belong to is named here, in the test, not in the environment.
    put(S, 'tools/omnikom-cli/omnikom.mjs', [
      `process.env.OMNIKOM_REPO_ROOT = ${JSON.stringify(REPO_ROOT)};`,
      "import { readFileSync } from 'node:fs';",
      `const { makeFakeGh } = await import(${JSON.stringify(pathToFileURL(join(CLI_ROOT, 'test', 'fake-gh.mjs')).href)});`,
      `const { main } = await import(${JSON.stringify(pathToFileURL(join(CLI_ROOT, 'omnikom.mjs')).href)});`,
      `const gh = makeFakeGh(() => JSON.parse(readFileSync(${JSON.stringify(stateFile)}, 'utf8')));`,
      "const r = await main(process.argv.slice(2), { repo: process.cwd(), gh, ghRepo: 'o/r' });",
      'process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr); process.exitCode = r.exit;',
      '',
    ].join('\n'));
    const ih = await cli(['hooks', 'install'], {}, { repo: S });
    const stip = commitFile(S, 'lib/b.mjs', 'export const b = 7;\n', 'a gated change');
    const push = (...args) => spawnSync('git', ['push', ...args], { cwd: S, encoding: 'utf8', timeout: 180000, env: cleanEnv });
    const said = r => r.stdout + r.stderr;
    const remoteMaster = () => git(sremote, 'rev-parse', 'master');
    let pr1 = push('origin', 'master');
    check('pre-push: a real `git push origin master` through the installed hook is REFUSED when the commit has no ci run, and the remote did not move',
      ih.exit === 0 && pr1.status !== 0 && /REFUSED refs\/heads\/master/.test(said(pr1)) && remoteMaster() === sbase, `${ih.all} ${pr1.status} ${said(pr1)}`.slice(0, 600));
    setState(RUNS(stip, { unit: 'failure' }));
    pr1 = push('origin', 'master');
    check('pre-push: the same push is REFUSED when a job of the run is red', pr1.status !== 0 && /unit {2}failure/.test(said(pr1)) && remoteMaster() === sbase, `${pr1.status} ${said(pr1)}`.slice(0, 600));
    setState(RUNS(stip));
    pr1 = push('origin', 'master');
    check('pre-push: the same push goes through when the run is green, and the remote has the tip', pr1.status === 0 && remoteMaster() === stip && /ci green/.test(said(pr1)), `${pr1.status} ${said(pr1)}`.slice(0, 600));
    setState({ fail: 'offline' });
    pr1 = push('origin', 'HEAD:refs/heads/check/cli-and-testing/x');
    check('pre-push: a real push of the commit to check/cli-and-testing/x is allowed (no gh needed)', pr1.status === 0 && git(sremote, 'rev-parse', 'refs/heads/check/cli-and-testing/x') === stip, `${pr1.status} ${said(pr1)}`.slice(0, 600));
    pr1 = push('origin', 'HEAD:refs/heads/feature');
    check('pre-push: a real push to another branch is REFUSED and the branch is not created', pr1.status !== 0 && /master is reached only through land/.test(said(pr1)) && !git(sremote, 'branch', '--list', 'feature'), `${pr1.status} ${said(pr1)}`.slice(0, 600));
    pr1 = push('origin', ':master');
    check('pre-push: a real push that deletes master is REFUSED and master is still there', pr1.status !== 0 && remoteMaster() === stip, `${pr1.status} ${said(pr1)}`.slice(0, 600));
    git(S, 'reset', '-q', '--hard', sbase);                       // a throwaway repository: history that diverges from the remote master
    const diverged = commitFile(S, 'lib/b.mjs', 'export const b = 8;\n', 'diverges');
    setState(RUNS(diverged));
    pr1 = push('--force', 'origin', 'master');
    check('pre-push: a real forced push of a commit that does not fast-forward master is REFUSED even with a green run (the hook, not git, says no)', pr1.status !== 0 && /not a fast-forward/.test(said(pr1)) && remoteMaster() === stip, `${pr1.status} ${said(pr1)}`.slice(0, 600));

    // ============================================================================ land (DECISIONS 45)
    const LWF = job => `  ${job}:\n    name: job ${job}\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - name: Check out the repository\n        uses: actions/checkout@abc\n      - name: Client files\n        run: node ok.mjs\n`;
    const LFILES = {
      'docs/departments/README.md': '# departments\n', 'docs/departments/TEMPLATE.md': '# template\n', 'docs/departments/cli-and-testing.md': '# CLI\n\n## Owns\n- `tools/`\n',
      'docs/departments/platform-build.md': '# Platform build\n', 'docs/departments/platform-web.md': '# Platform web\n', 'docs/departments/clients.md': '# Clients\n',
      '.github/workflows/ci.yml': `name: ci\non: [push]\njobs:\n${LWF('one')}${LWF('two')}`, 'ok.mjs': "console.log('ok');\n", 'marker.txt': 'base\n',
    };
    const LNAMES = ['job one', 'job two'];
    const LRUN = 'https://github.com/o/r/actions/runs/1';
    const scenario = () => {
      const bare = join(work, `lb${++n}.git`);
      git(work, 'init', '-q', '--bare', '-b', 'master', bare);
      const Pu = mkRepo(LFILES);                                         // the pusher: the head that made the commit
      git(Pu, 'remote', 'add', 'backup-gh', bare);
      git(Pu, 'push', '-q', 'backup-gh', 'master');
      const L = join(work, `lc${++n}`);                                  // the checkout land runs in: it has not fetched anything the pusher pushes later
      git(work, 'clone', '-q', '-o', 'backup-gh', bare, L);
      const base = git(Pu, 'rev-parse', 'HEAD');
      const branchAt = (name, from, text) => { git(Pu, 'checkout', '-q', '-B', 'topic', from); const s = commitFile(Pu, 'marker.txt', text, `commit for ${name}`); git(Pu, 'push', '-q', 'backup-gh', `topic:refs/heads/${name}`); return s; };
      const remoteMasterOf = () => git(bare, 'rev-parse', 'master');
      return { bare, Pu, L, base, branchAt, remoteMasterOf };
    };
    const LB = 'check/cli-and-testing/slice';
    const T0 = 1800000000;                                              // every land date comes through ctx.now: no test waits
    const isoOf = secs => new Date(secs * 1000).toISOString();
    const lockSha = sc => { const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/land-lock'], { cwd: sc.bare, encoding: 'utf8', timeout: 60000, env: cleanEnv }); return r.status === 0 ? r.stdout.trim() : ''; };
    const masterPushes = calls => calls.filter(a => a[0] === 'push' && a.some(x => /:refs\/heads\/master$/.test(x)));
    const gitIn = (cwd, input, extra, ...args) => { const r = spawnSync('git', args, { cwd, input, encoding: 'utf8', timeout: 120000, env: { ...cleanEnv, ...extra } }); if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`); return r.stdout.trim(); };
    // a lock somebody else took ageMin minutes before T0: a root commit on the empty tree, dated then, as land makes it
    const plantLock = (sc, ageMin, { branch = 'check/cli-and-testing/old', who = 'platform-build (zed@ZED-PC)' } = {}) => {
      const date = `${T0 - ageMin * 60} +0000`;
      const tree = gitIn(sc.bare, '', {}, 'hash-object', '-t', 'tree', '-w', '--stdin');
      const c = gitIn(sc.bare, '', { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 'zed', GIT_AUTHOR_EMAIL: 'z@example.invalid', GIT_COMMITTER_NAME: 'zed', GIT_COMMITTER_EMAIL: 'z@example.invalid' },
        'commit-tree', tree, '-m', `land-lock: ${branch} ${'e'.repeat(40)} by ${who} at ${isoOf(T0 - ageMin * 60)}`);
      git(sc.bare, 'update-ref', 'refs/heads/land-lock', c);
      return c;
    };
    const lrun = async (sc, args, state, { onSleep } = {}) => {
      const calls = [], sleeps = [];
      const st = { v: state };
      const gh = makeFakeGh(() => st.v);
      const r = await cli(['land', ...args, '--json'], {}, { repo: sc.L, ghRepo: 'o/r', gh, gitSpy: a => calls.push(a), now: () => T0, sleep: async ms => { sleeps.push(ms); if (onSleep) await onSleep(sleeps.length, st); } });
      return { ...r, calls, sleeps, gh, st, d: r.json && r.json.data, text: r.json && r.json.data ? r.json.data.lines.join('\n') : r.all };
    };
    const landRuns = (sha, over = {}) => ({ runs: [runRow(sha)], jobs: { 1: jobRows(LNAMES, over) } });
    {
      const sc = scenario();
      const s1 = sc.branchAt(LB, sc.base, 'one');
      const usage = async args => lrun(sc, args, landRuns(s1));
      const u = [await usage(['master']), await usage(['check/nodept/slice']), await usage(['check/cli-and-testing/Bad_Slug']), await usage(['check/cli-and-testing/']), await usage(['check/cli-and-testing/a..b']), await usage([]), await usage([LB, 'extra']),
        await usage(['check/README/slice']), await usage(['check/TEMPLATE/slice']), await usage(['check/cli-and-testing/missing-branch']), await usage([LB, '--remote', 'nowhere']), await usage([LB, '--wait-minutes', '0'])];
      check('land: a branch that is not check/<department>/<slug> is Usage (exit 2): master, an unknown department, README and TEMPLATE, a bad slug, an empty slug, "..", no branch, two branches',
        u.slice(0, 9).every(x => x.exit === 2), u.map(x => x.exit).join(','));
      check('land: a branch the remote does not have, an unknown --remote and a bad --wait-minutes are Usage (exit 2); none of these asked GitHub anything', u.slice(9).every(x => x.exit === 2) && /no branch/.test(u[9].all) && u.every(x => x.gh.calls.length === 0), u.map(x => x.exit).join(','));
      // the department is a charter basename or a prefix of one that ends at a '-' and names only that charter
      const { charterOf } = await import(pathToFileURL(join(CLI_ROOT, 'commands', 'land.mjs')).href);
      const co = (d, l) => { try { return charterOf(d, l); } catch (e) { return e.name; } };
      const real5 = ['cli-and-testing', 'clients', 'head-of-operations', 'platform-build', 'seo-and-audits'];
      check('land: charterOf: the basename itself, or a prefix ending at a "-" that names exactly one charter (platform, cli, seo, head); clients matches exactly',
        co('cli-and-testing', real5) === 'cli-and-testing' && co('cli', real5) === 'cli-and-testing' && co('platform', real5) === 'platform-build' && co('seo', real5) === 'seo-and-audits' && co('head', real5) === 'head-of-operations' && co('clients', real5) === 'clients');
      check('land: charterOf: no match is Usage, a prefix not ending at a "-" boundary is Usage (plat, cli-an; cli-and is whole segments and resolves), two matches is Usage, and an exact name wins over longer names it prefixes',
        co('nodept', real5) === 'Usage' && co('plat', real5) === 'Usage' && co('cli-an', real5) === 'Usage' && co('cli-and', real5) === 'cli-and-testing' && co('platform', [...real5, 'platform-web']) === 'Usage' && co('clients', ['clients', 'clients-x']) === 'clients');
      const dsc = scenario();
      const sShort = dsc.branchAt('check/cli/short', dsc.base, 'short name');
      const short = await lrun(dsc, ['check/cli/short'], landRuns(sShort, { 'job two': 'failure' }));
      check('land: check/cli/short resolves to the charter cli-and-testing, and the output says so', short.exit === 1 && short.text.includes('land: department cli is the charter cli-and-testing') && short.d.charter === 'cli-and-testing', short.text);
      const amb = await lrun(dsc, ['check/platform/x'], landRuns(sShort));
      const none = await lrun(dsc, ['check/plat/x'], landRuns(sShort));
      check('land: a department prefix that matches two charters (platform: platform-build, platform-web) or none (plat) is Usage (exit 2), naming the candidates',
        amb.exit === 2 && /platform-build, platform-web/.test(amb.all) && none.exit === 2 && amb.gh.calls.length === 0 && none.gh.calls.length === 0, amb.all + none.all);
    }
    {
      const sc = scenario();
      const s1 = sc.branchAt(LB, sc.base, 'red');
      const r = await lrun(sc, [LB], landRuns(s1, { 'job two': 'failure' }));
      check('land: a red job is refused (exit 1, LAND-REFUSED) with the verdict line, and NOTHING is pushed (the remote master is unchanged)',
        r.exit === 1 && r.json.code === 'LAND-REFUSED' && r.text.includes(`${LRUN}  job two  failure`) && sc.remoteMasterOf() === sc.base && masterPushes(r.calls).length === 0 && r.d.pushed === false && lockSha(sc) === '' && r.text.endsWith('land: lock released'), r.text + r.all.slice(0, 200));
    }
    {
      const sc = scenario();
      const s2 = sc.branchAt(LB, sc.base, 'green after a wait');
      git(sc.L, 'config', 'user.name', 'tester'); git(sc.L, 'config', 'user.email', 't@example.invalid');
      put(sc.L, 'marker.txt', 'modified in the checkout\n');          // other heads' unfinished files sit in the shared checkout
      put(sc.L, 'untracked.txt', 'not mine\n');
      put(sc.L, 'staged.txt', 'staged\n'); git(sc.L, 'add', 'staged.txt');
      const snap = () => [git(sc.L, 'rev-parse', 'refs/heads/master'), git(sc.L, 'rev-parse', 'HEAD'), git(sc.L, 'write-tree'), git(sc.L, 'status', '--porcelain'), readFileSync(join(sc.L, 'marker.txt'), 'utf8'), readFileSync(join(sc.L, 'untracked.txt'), 'utf8')].join('\n--\n');
      const before = snap();
      const hadObject = spawnSync('git', ['cat-file', '-e', `${s2}^{commit}`], { cwd: sc.L, env: cleanEnv, timeout: 60000 }).status === 0;
      const pend = { runs: [runRow(s2, { status: 'in_progress', conclusion: null })], jobs: {} };
      const r = await lrun(sc, [LB], pend, { onSleep: (k, st) => { if (k === 2) st.v = landRuns(s2); } });
      const pushes = masterPushes(r.calls);
      check('land: pending then green (a fake sleep, no real waiting): it polls every 30 s, prints one progress line per change of state, pushes the commit to master and says so (exit 0)',
        r.exit === 0 && r.sleeps.join(',') === '30000,30000' && r.text.split('\n').filter(l => l.startsWith('land: ci pending')).length === 1 && r.text.split('\n').filter(l => l === 'land: ci green').length === 1
        && r.text.includes(`land: master is ${s2}`) && sc.remoteMasterOf() === s2 && r.d.pushed === true && lockSha(sc) === '' && r.text.split('\n').pop() === 'land: lock released' && r.text.split('\n').indexOf('land: lock released') > r.text.split('\n').findIndex(l => l.startsWith('land: master is ')), r.text + r.all.slice(0, 300));
      check('land: the commit was not local and was fetched; the master push is exactly <sha>:refs/heads/master, and no git call carries --force, -f, --no-verify, --mirror or --delete; --force-with-lease appears only in the lock delete, with a lease on the lock\'s sha',
        !hadObject && pushes.length === 1 && pushes[0].join(' ') === `push backup-gh ${s2}:refs/heads/master` && r.calls.filter(a => a.some(x => /^(--force|-f|--force-with-lease.*|--no-verify|--mirror|--delete|-d)$/.test(x))).every(a => a.length === 4 && a[0] === 'push' && /^--force-with-lease=refs\/heads\/land-lock:[0-9a-f]{40}$/.test(a[1]) && a[3] === ':refs/heads/land-lock') && r.calls.some(a => a[1] && a[1].startsWith('--force-with-lease')), JSON.stringify(pushes) + JSON.stringify(r.calls.filter(a => a[0] === 'fetch')));
      check('land: marker.txt differs between the local master and the commit and is modified in this checkout, so the local move is refused for that path: working tree, index, HEAD and refs/heads/master are untouched, the land is still exit 0',
        snap() === before && r.exit === 0 && r.json.code === 'ok' && r.d.localMaster === 'not-moved'
        && r.text.includes(`land: the local master of this checkout was not moved: 1 path that differs between it and ${s2} is staged, modified or untracked here: marker.txt`), `${snap()}\n!!\n${before}\n${r.text}`.slice(0, 700));
    }
    {
      const sc = scenario();
      const s3 = sc.branchAt(LB, sc.base, 'nobody ran ci');
      const r = await lrun(sc, [LB], { runs: [] });
      check('land: no ci run for more than 5 minutes is Blocked (exit 3): "no ci run for <sha>; was it pushed?" after 11 polls, nothing pushed',
        r.exit === 3 && r.sleeps.length === 11 && r.json.error === `no ci run for ${s3}; was it pushed?` && sc.remoteMasterOf() === sc.base && lockSha(sc) === '', `${r.sleeps.length} ${r.all.slice(0, 300)}`);
    }
    {
      const sc = scenario();
      const s = sc.branchAt(LB, sc.base, 'slow ci');
      const r2 = await lrun(sc, [LB, '--wait-minutes', '1'], { runs: [runRow(s, { status: 'in_progress', conclusion: null })], jobs: {} });
      check('land: still pending after --wait-minutes is Blocked (exit 3) naming the run url, nothing pushed', r2.exit === 3 && r2.sleeps.length === 2 && r2.json.error.includes(LRUN) && /still pending after 1 minutes/.test(r2.json.error) && sc.remoteMasterOf() === sc.base && lockSha(sc) === '', r2.all.slice(0, 300));
    }
    {
      const sc = scenario();
      const old = sc.branchAt(LB, sc.base, 'already there');
      git(sc.Pu, 'checkout', '-q', '-B', 'master', old);
      const m2 = commitFile(sc.Pu, 'marker.txt', 'master moved on', 'master on');
      git(sc.Pu, 'push', '-q', 'backup-gh', 'master');
      const r = await lrun(sc, [LB], landRuns(old));
      check('land: a commit already in master (an ancestor of it) pushes nothing and says so (exit 0), without waiting for ci: right after the lock, GitHub is asked nothing', r.exit === 0 && r.text.includes(`land: ${old} is already in master`) && masterPushes(r.calls).length === 0 && sc.remoteMasterOf() === m2 && r.d.pushed === false && lockSha(sc) === '' && r.gh.calls.length === 0 && r.sleeps.length === 0, r.text);
      check('land: ... and the local master of this checkout (clean, behind) is moved to that commit', r.text.includes(`land: the local master of this checkout moved ${sc.base}..${old}`) && git(sc.L, 'rev-parse', 'master') === old && r.d.localMaster === 'moved', r.text);
      const sc2 = scenario();
      const eq = sc2.branchAt(LB, sc2.base, 'equal');
      git(sc2.Pu, 'push', '-q', 'backup-gh', `${eq}:refs/heads/master`);
      const r2 = await lrun(sc2, [LB], landRuns(eq));
      check('land: a commit equal to master pushes nothing either', r2.exit === 0 && r2.text.includes('is already in master') && masterPushes(r2.calls).length === 0, r2.text);
    }
    {
      const sc = scenario();
      const s4 = sc.branchAt(LB, sc.base, 'cut from the old master');
      git(sc.Pu, 'checkout', '-q', '-B', 'master', sc.base);
      const m3 = commitFile(sc.Pu, 'other.txt', 'master moved on', 'master on');
      git(sc.Pu, 'push', '-q', 'backup-gh', 'master');
      const r = await lrun(sc, [LB], landRuns(s4));
      check('land (early fast-forward check): master that is not an ancestor of the commit is refused right after the lock ("not a fast-forward: rebase onto master <short> and push it again"), BEFORE the ci wait: GitHub is asked nothing, nothing is pushed, rebased or merged, the lock is released',
        r.exit === 1 && r.json.code === 'LAND-REFUSED' && r.text.includes(`not a fast-forward: rebase onto master ${m3.slice(0, 7)} and push it again`) && r.gh.calls.length === 0 && r.sleeps.length === 0 && masterPushes(r.calls).length === 0 && !r.calls.some(a => a[0] === 'rebase' || a[0] === 'merge') && sc.remoteMasterOf() === m3 && lockSha(sc) === '' && r.text.endsWith('land: lock released'), r.text);
    }
    {
      // master can still move during the ci wait: the post-ci check stays
      const sc = scenario();
      const s5 = sc.branchAt(LB, sc.base, 'cut from master, which then moves');
      let m5 = '';
      const r = await lrun(sc, [LB], { runs: [runRow(s5, { status: 'in_progress', conclusion: null })], jobs: {} },
        { onSleep: (k, st) => { if (k === 1) { git(sc.Pu, 'checkout', '-q', '-B', 'master', sc.base); m5 = commitFile(sc.Pu, 'other.txt', 'moved during the wait', 'master on'); git(sc.Pu, 'push', '-q', 'backup-gh', 'master'); st.v = landRuns(s5); } } });
      check('land (post-ci fast-forward check): master that moved DURING the ci wait is refused as not a fast-forward ("rebase <branch> onto master and push it again"), nothing is pushed, the lock is released',
        r.exit === 1 && r.json.code === 'LAND-REFUSED' && r.text.includes(`not a fast-forward: rebase ${LB} onto master and push it again`) && r.gh.calls.length > 0 && masterPushes(r.calls).length === 0 && sc.remoteMasterOf() === m5 && m5 !== '' && lockSha(sc) === '' && r.text.endsWith('land: lock released'), r.text);
    }
    {
      // ... and the same commit can reach master by another hand during the wait: the post-ci "already in master" path pushes nothing
      const sc = scenario();
      const s6 = sc.branchAt(LB, sc.base, 'lands by another hand during the wait');
      const r = await lrun(sc, [LB], { runs: [runRow(s6, { status: 'in_progress', conclusion: null })], jobs: {} },
        { onSleep: (k, st) => { if (k === 1) { git(sc.Pu, 'push', '-q', 'backup-gh', `${s6}:refs/heads/master`); st.v = landRuns(s6); } } });
      check('land (post-ci already in master): the commit reached master during the ci wait: nothing is pushed, "is already in master", exit 0, the lock is released',
        r.exit === 0 && r.text.includes(`land: ${s6} is already in master`) && r.gh.calls.length > 0 && masterPushes(r.calls).length === 0 && r.d.pushed === false && r.d.state === 'green' && sc.remoteMasterOf() === s6 && lockSha(sc) === '' && r.text.endsWith('land: lock released'), r.text);
    }
    {
      const sc = scenario();
      sc.branchAt(LB, sc.base, 'gh down');
      const r = await lrun(sc, [LB], { fail: 'gh: not logged in' });
      check('land: gh failing is Blocked (exit 3) with the cause and nothing is pushed (fail closed)', r.exit === 3 && /not logged in/.test(r.json.error) && sc.remoteMasterOf() === sc.base && masterPushes(r.calls).length === 0 && lockSha(sc) === '', r.all.slice(0, 300));
    }

    // ============================================================================ land: the local master of this checkout (brief small-cli-fixes, part a)
    {
      const { dirtyPaths, DEFAULT_LOCK_WAIT_MINUTES, MAX_LOCK_WAIT_MINUTES } = await import(pathToFileURL(join(CLI_ROOT, 'commands', 'land.mjs')).href);
      const dp = [...dirtyPaths('R  new name.txt\0old name.txt\0 M x.txt\0?? y.txt\0C  copy.txt\0src.txt\0D  gone.txt\0')].sort();
      check('land: dirtyPaths reads git status --porcelain -z: staged, modified and untracked paths, and BOTH paths of a rename or copy line (spaces kept)',
        dp.join('|') === ['copy.txt', 'gone.txt', 'new name.txt', 'old name.txt', 'src.txt', 'x.txt', 'y.txt'].sort().join('|'), dp.join('|'));
      check('land: the lock wait defaults to 30 minutes and is capped at 180', DEFAULT_LOCK_WAIT_MINUTES === 30 && MAX_LOCK_WAIT_MINUTES === 180);
      const moves = calls => calls.filter(a => a[0] === 'merge' || a[0] === 'update-ref');
      const treeOf = L => [git(L, 'rev-parse', 'HEAD'), git(L, 'status', '--porcelain'), git(L, 'branch', '--show-current')].join('\n');
      {
        // clean checkout, master checked out: git merge --ff-only
        const sc = scenario();
        const s = sc.branchAt(LB, sc.base, 'clean move');
        const r = await lrun(sc, [LB], landRuns(s));
        check('land: a clean checkout with master checked out: the local master is fast-forwarded by `git merge --ff-only <sha>`, the working tree follows, the output says moved <old>..<sha>, exit 0',
          r.exit === 0 && r.json.code === 'ok' && r.text.includes(`land: the local master of this checkout moved ${sc.base}..${s}`) && git(sc.L, 'rev-parse', 'master') === s && git(sc.L, 'rev-parse', 'HEAD') === s
          && readFileSync(join(sc.L, 'marker.txt'), 'utf8') === 'clean move' && git(sc.L, 'status', '--porcelain') === '' && r.d.localMaster === 'moved'
          && moves(r.calls).length === 1 && moves(r.calls)[0].join(' ') === `merge --ff-only ${s}`, r.text);
      }
      {
        // dirty paths OUTSIDE the diff do not block, and are not touched
        const sc = scenario();
        const s = sc.branchAt(LB, sc.base, 'move around dirty files');
        put(sc.L, 'untracked.txt', 'not mine\n');
        put(sc.L, 'staged.txt', 'staged\n'); git(sc.L, 'add', 'staged.txt');
        put(sc.L, 'docs/departments/README.md', '# departments, edited here\n');
        const status0 = git(sc.L, 'status', '--porcelain');
        const r = await lrun(sc, [LB], landRuns(s));
        check('land: staged, modified and untracked paths that are NOT in the diff do not block the move, and stay exactly as they were',
          r.exit === 0 && git(sc.L, 'rev-parse', 'master') === s && readFileSync(join(sc.L, 'marker.txt'), 'utf8') === 'move around dirty files' && git(sc.L, 'status', '--porcelain') === status0
          && readFileSync(join(sc.L, 'untracked.txt'), 'utf8') === 'not mine\n' && readFileSync(join(sc.L, 'staged.txt'), 'utf8') === 'staged\n' && readFileSync(join(sc.L, 'docs/departments/README.md'), 'utf8') === '# departments, edited here\n', `${r.text}\n${status0}`);
      }
      {
        // master not checked out: update-ref with the old value as a lease, and the checked-out branch is not touched
        const sc = scenario();
        const s = sc.branchAt(LB, sc.base, 'master is not checked out');
        git(sc.L, 'checkout', '-q', '-b', 'work');
        put(sc.L, 'untracked.txt', 'mine\n');
        const before = treeOf(sc.L);
        const r = await lrun(sc, [LB], landRuns(s));
        check('land: master not checked out here: `git update-ref refs/heads/master <sha> <old>` (the old value as a lease), HEAD, the index and the working tree of the checked-out branch untouched, no merge',
          r.exit === 0 && r.text.includes(`land: the local master of this checkout moved ${sc.base}..${s}`) && git(sc.L, 'rev-parse', 'master') === s && treeOf(sc.L) === before
          && moves(r.calls).length === 1 && moves(r.calls)[0].join(' ') === `update-ref refs/heads/master ${s} ${sc.base}` && readFileSync(join(sc.L, 'marker.txt'), 'utf8') !== 'master is not checked out', r.text);
      }
      {
        // the local master has a commit the landed commit does not contain: nothing is lost, nothing moves
        const sc = scenario();
        const s = sc.branchAt(LB, sc.base, 'local master diverged');
        git(sc.L, 'config', 'user.name', 'tester'); git(sc.L, 'config', 'user.email', 't@example.invalid');
        const mine = commitFile(sc.L, 'mine.txt', 'a local commit', 'local only');
        const r = await lrun(sc, [LB], landRuns(s));
        check('land: a local master with a commit of its own (not an ancestor of the landed commit) is not moved, and the line says why; the land is exit 0',
          r.exit === 0 && git(sc.L, 'rev-parse', 'master') === mine && r.text.includes(`land: the local master of this checkout was not moved: it has commits that ${s} does not contain`) && moves(r.calls).length === 0 && r.d.localMaster === 'not-moved', r.text);
      }
      {
        // master is checked out in another worktree: its files are not ours to move
        const sc = scenario();
        const s = sc.branchAt(LB, sc.base, 'master elsewhere');
        git(sc.L, 'checkout', '-q', '--detach');
        const W = join(work, `wt${++n}`);
        git(sc.L, 'worktree', 'add', '-q', W, 'master');
        const r = await lrun(sc, [LB], landRuns(s));
        check('land: master checked out in another worktree is not moved (update-ref would leave that worktree\'s index behind); the line names the worktree; exit 0',
          r.exit === 0 && git(sc.L, 'rev-parse', 'master') === sc.base && git(W, 'status', '--porcelain') === '' && r.text.includes('land: the local master of this checkout was not moved: master is checked out in ') && moves(r.calls).length === 0 && sc.remoteMasterOf() === s, r.text);
      }
      {
        // git itself refuses (a locked index): reported, never forced, and the land stays a success
        const sc = scenario();
        const s = sc.branchAt(LB, sc.base, 'git refuses');
        writeFileSync(join(sc.L, '.git', 'index.lock'), '');
        const r = await lrun(sc, [LB], landRuns(s));
        rmSync(join(sc.L, '.git', 'index.lock'), { force: true });
        check('land: when `git merge --ff-only` refuses, the refusal is reported ("was not moved: git merge --ff-only refused: ...") and the land is still exit 0, code ok, master pushed',
          r.exit === 0 && r.json.code === 'ok' && sc.remoteMasterOf() === s && git(sc.L, 'rev-parse', 'master') === sc.base && /was not moved: git merge --ff-only refused: .*index\.lock/.test(r.text) && !r.calls.some(a => a.some(x => /^(--force|-f)$/.test(x) && a[0] === 'merge')), r.text);
      }
      {
        // a staged rename: both paths count, so the orig path (in the diff) blocks
        const sc = scenario();
        const s = sc.branchAt(LB, sc.base, 'rename in the way');
        git(sc.L, 'mv', 'marker.txt', 'moved.txt');
        const r = await lrun(sc, [LB], landRuns(s));
        check('land: a staged rename (R  moved.txt, marker.txt) blocks on the path it came from, marker.txt, which is in the diff', r.exit === 0 && git(sc.L, 'rev-parse', 'master') === sc.base && r.text.includes(`is staged, modified or untracked here: marker.txt`) && moves(r.calls).length === 0, r.text);
      }
      {
        // more than 10 blocking paths: ten named, then "+N more"
        const sc = scenario();
        const names = Array.from({ length: 12 }, (_, i) => `many/f${String(i + 1).padStart(2, '0')}.txt`);
        git(sc.Pu, 'checkout', '-q', '-B', 'topic', sc.base);
        for (const p of names) put(sc.Pu, p, `from the branch ${p}\n`);
        git(sc.Pu, 'add', '-A'); git(sc.Pu, 'commit', '-q', '-m', 'twelve files');
        const s = git(sc.Pu, 'rev-parse', 'HEAD');
        git(sc.Pu, 'push', '-q', 'backup-gh', `topic:refs/heads/${LB}`);
        for (const p of names) put(sc.L, p, `untracked here ${p}\n`);
        const r = await lrun(sc, [LB], landRuns(s));
        const said = r.text.split('\n').find(l => l.includes('was not moved')) || '';
        check('land: twelve blocking paths: the line names ten of them and says "(+2 more)"; none of the files was touched',
          r.exit === 0 && git(sc.L, 'rev-parse', 'master') === sc.base && /^land: the local master of this checkout was not moved: 12 paths that differ between it and \w+ are staged, modified or untracked here: /.test(said)
          && names.slice(0, 10).every(p => said.includes(p)) && !said.includes(names[10]) && said.endsWith('(+2 more)') && readFileSync(join(sc.L, names[11]), 'utf8') === `untracked here ${names[11]}\n`, said);
      }
      {
        // the local master already has the commit; and a checkout without a local master
        const sc = scenario();
        const s = sc.branchAt(LB, sc.base, 'already local');
        git(sc.L, 'fetch', '-q', 'backup-gh');
        git(sc.L, 'merge', '-q', '--ff-only', s);
        const r = await lrun(sc, [LB], landRuns(s));
        check('land: a local master that already contains the commit says so and moves nothing', r.exit === 0 && r.text.includes(`land: the local master of this checkout contains ${s}`) && moves(r.calls).length === 0 && r.d.localMaster === 'contains', r.text);
        const sc2 = scenario();
        const s2 = sc2.branchAt(LB, sc2.base, 'no local master');
        git(sc2.L, 'checkout', '-q', '-b', 'other');
        git(sc2.L, 'branch', '-q', '-D', 'master');
        const r2 = await lrun(sc2, [LB], landRuns(s2));
        check('land: a checkout with no local master says so and creates none', r2.exit === 0 && r2.text.includes('land: this checkout has no local master; it was not touched') && !git(sc2.L, 'branch', '--list', 'master') && r2.d.localMaster === 'none', r2.text);
      }
    }

    // ============================================================================ land waits in line for a held lock (brief small-cli-fixes, part d)
    {
      const holderLines = text => text.split('\n').filter(l => / holds the land lock since /.test(l));
      {
        // the default wait: a fresh lock held by somebody else, freed during the second poll
        const sc = scenario();
        const s = sc.branchAt(LB, sc.base, 'waits in line');
        plantLock(sc, 5);
        const r = await lrun(sc, [LB], landRuns(s), { onSleep: (k) => { if (k === 2) git(sc.bare, 'update-ref', '-d', 'refs/heads/land-lock'); } });
        const lines = r.text.split('\n');
        check('land lock wait (default 30 min): a lock held by another is re-read every 30 s through ctx.sleep, the holder line is printed ONCE, the lock is taken as soon as it is free, and the land goes through',
          r.exit === 0 && r.sleeps.slice(0, 2).join(',') === '30000,30000' && r.sleeps.length === 2 && holderLines(r.text).length === 1 && lines.findIndex(l => / holds the land lock since /.test(l)) < lines.findIndex(l => l.startsWith('land: took the land lock'))
          && sc.remoteMasterOf() === s && lockSha(sc) === '' && r.text.endsWith('land: lock released'), `${r.sleeps} ${r.text}`);
      }
      {
        // the holder changes while we wait: the new holder is printed too
        const sc = scenario();
        const s = sc.branchAt(LB, sc.base, 'holder changes');
        plantLock(sc, 5, { who: 'platform-build (zed@ZED-PC)' });
        const r = await lrun(sc, [LB], landRuns(s), { onSleep: (k) => {
          if (k === 1) git(sc.bare, 'update-ref', '-d', 'refs/heads/land-lock');
          if (k === 1) plantLock(sc, 2, { branch: 'check/platform-build/next', who: 'platform-web (carol@CAROL-PC)' });
          if (k === 3) git(sc.bare, 'update-ref', '-d', 'refs/heads/land-lock');
        } });
        const hl = holderLines(r.text);
        check('land lock wait: the holder line is printed again only when the holder changes (two holders, two lines, none repeated)',
          r.exit === 0 && hl.length === 2 && hl[0].includes('platform-build (zed@ZED-PC)') && hl[1].includes('platform-web (carol@CAROL-PC)') && r.sleeps.length === 3 && sc.remoteMasterOf() === s, `${r.sleeps} ${r.text}`);
      }
      {
        // the limit: still held after --lock-wait-minutes -> LAND-LOCKED, naming how long it waited
        const sc = scenario();
        sc.branchAt(LB, sc.base, 'never free');
        const kept = plantLock(sc, 5);
        const r = await lrun(sc, [LB, '--lock-wait-minutes', '1'], { runs: [] });
        check('land lock wait: still held after --lock-wait-minutes 1 is LAND-LOCKED (exit 1) after exactly 2 polls, the line names how long it waited, the holder is printed once, nothing is asked of GitHub or pushed, the other lock is untouched',
          r.exit === 1 && r.json.code === 'LAND-LOCKED' && r.sleeps.join(',') === '30000,30000' && holderLines(r.text).length === 1 && /land: waited 1 minutes for the land lock; it is still held/.test(r.text) && r.gh.calls.length === 0 && masterPushes(r.calls).length === 0 && lockSha(sc) === kept, `${r.sleeps} ${r.text}`);
        const r0 = await lrun(sc, [LB, '--lock-wait-minutes', '0'], { runs: [] });
        check('land lock wait: --lock-wait-minutes 0 refuses at once as before (no sleep, no "waited" line)', r0.exit === 1 && r0.json.code === 'LAND-LOCKED' && r0.sleeps.length === 0 && !r0.text.includes('waited') && holderLines(r0.text).length === 1 && lockSha(sc) === kept, `${r0.sleeps} ${r0.text}`);
      }
      {
        const sc = scenario();
        const s = sc.branchAt(LB, sc.base, 'usage');
        const bad = [];
        for (const v of ['181', '-1', 'abc', '']) { const r = await lrun(sc, [LB, `--lock-wait-minutes=${v}`], landRuns(s)); bad.push(r.exit); }
        check('land: --lock-wait-minutes outside 0..180 or not a number is Usage (exit 2): 181, -1, abc and empty', bad.join(',') === '2,2,2,2', bad.join(','));
        const ok = await lrun(sc, [LB, '--lock-wait-minutes', '180'], landRuns(s));
        check('land: --lock-wait-minutes 180 (the maximum) is accepted', ok.exit === 0 && ok.sleeps.length === 0, ok.text);
      }
    }

    // ============================================================================ the billing line, seen by land and by the pre-push hook
    {
      const BILL = 'The job was not started because recent account payments have failed or your spending limit needs to be increased.';
      const sc = scenario();
      const s = sc.branchAt(LB, sc.base, 'billing');
      const dead = { 'job one': 'failure', 'job two': 'failure' };
      const state = { runs: [runRow(s, { conclusion: 'failure' })], jobs: { 1: stepRows(LNAMES, dead, { 'job one': 0, 'job two': 0 }) }, annotations: { 100: [{ message: BILL }] } };
      const r = await lrun(sc, [LB], state);
      const at = r.text.split('\n');
      check('land: when GitHub never started the jobs the output has the red lines, then "ci: no job ran a step; GitHub says: ...", then the REFUSED line; exit 1, nothing pushed',
        r.exit === 1 && r.json.code === 'LAND-REFUSED' && at.indexOf(`ci: no job ran a step; GitHub says: ${BILL}`) > at.findIndex(l => l.endsWith('  job two  failure')) && at.indexOf(`ci: no job ran a step; GitHub says: ${BILL}`) < at.findIndex(l => l.startsWith('land: REFUSED')) && masterPushes(r.calls).length === 0, r.text);
      const hookState = { runs: [runRow(tip, { conclusion: 'failure' })], jobs: { 1: stepRows(NAMES, { unit: 'failure', reader: 'failure', 'secret scan': 'failure' }, { unit: 0, reader: 0, 'secret scan': 0 }) }, annotations: { 100: [{ message: BILL }] } };
      const p3 = await pp(masterLine(tip), hookState);
      check('pre-push: the same red run shows the billing line too (it shares ciVerdict), prefixed like every hook line, and the push is refused', p3.exit === 1 && p3.text.includes(`pre-push: ci: no job ran a step; GitHub says: ${BILL}`), p3.text);
    }

    // ============================================================================ the land lock: the landing queue (refs/heads/land-lock)
    {
      const { LOCK_BRANCH, LOCK_REF } = await lib('landlock.mjs');
      check('land lock: the lock is refs/heads/<one constant> (lib/landlock.mjs)', LOCK_BRANCH === 'land-lock' && LOCK_REF === `refs/heads/${LOCK_BRANCH}`);
      // two landers, one bare remote: A waits for ci; while A waits, B (another checkout, another person) tries to land
      const sc = scenario();
      const sA = sc.branchAt('check/cli-and-testing/a', sc.base, 'lander a');
      const sB = sc.branchAt('check/cli-and-testing/b', sc.base, 'lander b');
      const L2 = join(work, `lc${++n}`);
      git(work, 'clone', '-q', '-o', 'backup-gh', sc.bare, L2);
      git(sc.L, 'config', 'user.name', 'alice');
      git(L2, 'config', 'user.name', 'bob');
      const scB = { ...sc, L: L2 };
      let rb;
      const ra = await lrun(sc, ['check/cli-and-testing/a'], { runs: [runRow(sA, { status: 'in_progress', conclusion: null })], jobs: {} },
        { onSleep: async (k, st) => { if (k === 1) { rb = await lrun(scB, ['check/cli-and-testing/b', '--lock-wait-minutes', '0'], landRuns(sB)); st.v = landRuns(sA); } } });
      check('land lock: two landers race on one bare remote: exactly one takes the lock (A); the other (B) gets LAND-LOCKED (exit 1) with the holder\'s line, asks GitHub nothing and pushes nothing',
        ra.exit === 0 && ra.text.includes('land: took the land lock') && rb.exit === 1 && rb.json.code === 'LAND-LOCKED' && !rb.text.includes('took the land lock') && rb.gh.calls.length === 0 && masterPushes(rb.calls).length === 0
        && new RegExp(`^land: cli-and-testing \\(alice@.+\\) holds the land lock since ${isoOf(T0).replace(/\./g, '\\.')} \\(0 min\\) for check/cli-and-testing/a$`, 'm').test(rb.text), `${ra.text}\n--\n${rb && rb.text}`);
      const movedTo = sc.remoteMasterOf();
      check('land lock: master is moved once (to A\'s commit; B\'s commit is not in it), and the lock is released after the success, last line "land: lock released"',
        movedTo === sA && spawnSync('git', ['merge-base', '--is-ancestor', sB, movedTo], { cwd: sc.bare, env: cleanEnv, timeout: 60000 }).status !== 0 && masterPushes(ra.calls).length === 1 && lockSha(sc) === '' && ra.text.split('\n').pop() === 'land: lock released' && ra.d.lockReleased === true, ra.text);
      const lockPush = ra.calls.find(a => a[0] === 'push' && /:refs\/heads\/land-lock$/.test(a[a.length - 1]) && !a[1].startsWith('--'));
      check('land lock: the lock is a plain git push of a root commit (no --force, no parent) before the ci wait', !!lockPush && lockPush.length === 3 && ra.calls.indexOf(lockPush) < ra.calls.findIndex(a => a[0] === 'fetch' && a[2] === 'master'), JSON.stringify(ra.calls.filter(a => a[0] === 'push')));
    }
    {
      // the lock after a red verdict, a not-fast-forward refusal and a Blocked is covered in the land tests above (lockSha(sc) === ''); here the stale bound
      const sc = scenario();
      const s = sc.branchAt(LB, sc.base, 'behind a stale lock');
      const old = plantLock(sc, 91);
      const r = await lrun(sc, [LB], landRuns(s));
      check('land lock: a lock dated 91 minutes old is broken with the line "land: breaking a stale land lock held by <holder> since <time> (91 min)", by a delete with a lease on that exact sha, and then ours is taken and the land goes through',
        r.exit === 0 && r.text.includes(`land: breaking a stale land lock held by platform-build (zed@ZED-PC) since ${isoOf(T0 - 91 * 60)} (91 min)`)
        && r.calls.some(a => a.join(' ') === `push --force-with-lease=refs/heads/land-lock:${old} backup-gh :refs/heads/land-lock`) && sc.remoteMasterOf() === s && lockSha(sc) === '', r.text);
    }
    {
      const sc = scenario();
      const s = sc.branchAt(LB, sc.base, 'behind a fresh lock');
      const fresh = plantLock(sc, 89);
      const r = await lrun(sc, [LB, '--lock-wait-minutes', '0'], landRuns(s));
      check('land lock: a lock dated 89 minutes old is not broken: LAND-LOCKED (exit 1) with "land: <holder> holds the land lock since <time> (89 min) for <branch>", the lock is still there, nothing is deleted, pushed or asked of GitHub',
        r.exit === 1 && r.json.code === 'LAND-LOCKED' && r.text.includes(`land: platform-build (zed@ZED-PC) holds the land lock since ${isoOf(T0 - 89 * 60)} (89 min) for check/cli-and-testing/old`) && !r.text.includes('breaking')
        && lockSha(sc) === fresh && !r.calls.some(a => a[0] === 'push' && a.some(x => x.startsWith('--force'))) && masterPushes(r.calls).length === 0 && r.gh.calls.length === 0 && sc.remoteMasterOf() === sc.base, r.text);
      const sc2 = scenario();
      sc2.branchAt(LB, sc2.base, 'exactly ninety');
      const ninety = plantLock(sc2, 90);
      const r90 = await lrun(sc2, [LB, '--lock-wait-minutes', '0'], landRuns(sc2.Pu ? git(sc2.Pu, 'rev-parse', 'HEAD') : ''));
      check('land lock: a lock exactly 90 minutes old is not "more than 90": not broken', r90.exit === 1 && r90.json.code === 'LAND-LOCKED' && lockSha(sc2) === ninety, r90.text);
    }
    {
      // a release never deletes a lock that is not ours: while A waits, its lock is replaced by somebody else's
      const sc = scenario();
      const s = sc.branchAt(LB, sc.base, 'lock replaced');
      let foreign = '';
      const r = await lrun(sc, [LB], { runs: [runRow(s, { status: 'in_progress', conclusion: null })], jobs: {} },
        { onSleep: (k, st) => { if (k === 1) { foreign = plantLock(sc, 1, { branch: 'check/platform-build/theirs', who: 'platform-build (carol@CAROL-PC)' }); st.v = landRuns(s); } } });
      check('land lock: a release never deletes a lock that is not ours: the lock was replaced during the wait, the land still succeeds (exit 0), the foreign lock is still on the remote, and the output warns with the manual command',
        r.exit === 0 && sc.remoteMasterOf() === s && lockSha(sc) === foreign && foreign !== '' && r.d.lockReleased === false && /land: WARNING the land lock was not released/.test(r.text) && r.text.includes('git push --force-with-lease=refs/heads/land-lock:') && !r.text.includes('land: lock released')
        && r.sleeps.length === 1 && r.calls.filter(a => a.some(x => x.startsWith('--force-with-lease'))).length === 1 && !/after \d+ tries/.test(r.text), r.text);
    }
    {
      // part (e): a lock delete that fails on the NETWORK is tried again (10 s, then 30 s through ctx.sleep); the bare remote's pre-receive hook
      // plays the network: it refuses the first N deletes of the lock with the words git printed on 2026-11-01 19:14
      const netHook = (sc, failMax) => {
        const hook = join(sc.bare, 'hooks', 'pre-receive');
        mkdirSync(join(sc.bare, 'hooks'), { recursive: true });
        writeFileSync(hook, [
          '#!/bin/sh', 'while read old new ref; do',
          '  if [ "$ref" = "refs/heads/land-lock" ] && [ "$new" = "0000000000000000000000000000000000000000" ]; then',
          '    n=$(cat "$GIT_DIR/fail-count" 2>/dev/null || echo 0); max=$(cat "$GIT_DIR/fail-max" 2>/dev/null || echo 0)',
          '    if [ "$n" -lt "$max" ]; then echo $((n+1)) > "$GIT_DIR/fail-count"; echo "fatal: unable to access \'https://github.com/o/r.git/\': Failed to connect to github.com port 443 after 21179 ms" >&2; exit 1; fi',
          '  fi', 'done', 'exit 0', '',
        ].join('\n'), { mode: 0o755 });
        writeFileSync(join(sc.bare, 'fail-max'), String(failMax));
        return () => Number(readFileSync(join(sc.bare, 'fail-count'), 'utf8'));
      };
      const leaseDeletes = calls => calls.filter(a => a[0] === 'push' && a.some(x => x.startsWith('--force-with-lease')));
      {
        const sc = scenario();
        const s = sc.branchAt(LB, sc.base, 'release retried');
        const failed = netHook(sc, 2);
        const r = await lrun(sc, [LB], landRuns(s));
        check('land release (e): two network failures of the lock delete, then success: three deletes, waits of exactly 10 s then 30 s, the lock is gone, "land: lock released (after 3 tries)", the land is exit 0',
          r.exit === 0 && sc.remoteMasterOf() === s && failed() === 2 && leaseDeletes(r.calls).length === 3 && r.sleeps.join(',') === '10000,30000' && lockSha(sc) === '' && r.d.lockReleased === true && r.text.endsWith('land: lock released (after 3 tries)'), `${r.sleeps} ${r.text}`);
      }
      {
        const sc = scenario();
        const s = sc.branchAt(LB, sc.base, 'release never works');
        netHook(sc, 99);
        const r = await lrun(sc, [LB], landRuns(s));
        check('land release (e): every try fails on the network: exactly three tries (no more), the WARNING says "after 3 tries" and keeps the hand-release command, the lock is still there, and the land that moved master is still exit 0',
          r.exit === 0 && sc.remoteMasterOf() === s && leaseDeletes(r.calls).length === 3 && r.sleeps.join(',') === '10000,30000' && lockSha(sc) !== '' && r.d.lockReleased === false
          && /land: WARNING the land lock was not released after 3 tries \(.*443/.test(r.text) && r.text.includes('git push --force-with-lease=refs/heads/land-lock:'), `${r.sleeps} ${r.text}`);
      }
      {
        const sc = scenario();
        const s = sc.branchAt(LB, sc.base, 'blocked release retried');
        netHook(sc, 1);
        const r = await lrun(sc, [LB, '--wait-minutes', '1'], { runs: [runRow(s, { status: 'in_progress', conclusion: null })], jobs: {} });
        check('land release (e): the release after a Blocked (ci still pending) is retried the same way and the lock is gone', r.exit === 3 && leaseDeletes(r.calls).length === 2 && lockSha(sc) === '' && r.sleeps.slice(-1).join() === '10000', `${r.sleeps} ${r.all.slice(0, 300)}`);
      }
      const { looksLikeNetworkFailure } = await import(pathToFileURL(join(CLI_ROOT, 'commands', 'land.mjs')).href);
      check('land release (e): the classifier: connect, TLS, timeout, 443, HTTP 408 and "unable to access" are network failures; a lease refusal (stale info, [rejected]) and a plain refusal are not, even with a network word in it',
        ['fatal: unable to access \'https://github.com/o/r.git/\': Failed to connect to github.com port 443 after 21179 ms', 'Connection timed out', 'error: RPC failed; HTTP 408 curl 22', 'SSL_ERROR_SYSCALL', 'gnutls TLS handshake failed'].every(looksLikeNetworkFailure)
        && !looksLikeNetworkFailure(' ! [rejected]        land-lock (stale info)\nerror: failed to push some refs to \'https://github.com/o/r.git\'') && !looksLikeNetworkFailure('stale info while talking to github.com:443') && !looksLikeNetworkFailure('error: no such remote') && !looksLikeNetworkFailure(''));
    }
    {
      // the hook lets the queue through: create and delete of refs/heads/land-lock, with no gh call
      const zeros2 = '0'.repeat(40);
      let p2 = await pp(`refs/heads/land-lock ${tip} refs/heads/land-lock ${zeros2}\n`, { fail: 'offline' });
      check('pre-push: refs/heads/land-lock (create) is the land queue: allowed, with its line and no gh call', p2.exit === 0 && p2.text === 'pre-push: refs/heads/land-lock is the land queue, allowed' && p2.gh.calls.length === 0, p2.text);
      p2 = await pp(`refs/heads/land-lock ${zeros2} refs/heads/land-lock ${tip}\n`, { fail: 'offline' });
      check('pre-push: refs/heads/land-lock (delete) is allowed too', p2.exit === 0 && /land queue, allowed/.test(p2.text), p2.text);
      p2 = await pp(`refs/heads/land-lock2 ${tip} refs/heads/land-lock2 ${zeros2}\n`, RUNS(tip));
      check('pre-push: a branch merely named like the lock is refused', p2.exit === 1, p2.text);
    }

    // ============================================================================ the cluster guard (test/harness.mjs): a run leaves no cluster behind
    {
      const h = await import(pathToFileURL(join(CLI_ROOT, 'test', 'harness.mjs')).href);
      const mk = join(work, 'cluster-markers');
      mkdirSync(mk);
      const mkDir = name => { const d = join(work, `omnikom-cli-pg-${name}`); mkdirSync(join(d, 'data'), { recursive: true }); writeFileSync(join(d, 'data', 'PG_VERSION'), '16\n'); return d; };
      const deadPid = spawnSync(process.execPath, ['--version'], { encoding: 'utf8', timeout: 60000 }).pid;     // a process that has ended
      const plant = (name, pid, dir, port) => { const f = join(mk, `${pid}-${port}.json`); writeFileSync(f, JSON.stringify({ pid, dir, data: join(dir, 'data'), port })); return f; };
      const calls = [];
      const fakeRun = (cmd, args) => { calls.push([cmd, ...args]); return { status: 0, stdout: '', stderr: '' }; };
      const dirDead = mkDir('dead'), dirLive = mkDir('live'), dirAway = join(work, 'precious-not-a-cluster');
      mkdirSync(dirAway); writeFileSync(join(dirAway, 'keep.txt'), 'do not delete\n');
      const mDead = plant('dead', deadPid, dirDead, 57001), mLive = plant('live', process.pid, dirLive, 57002), mAway = plant('away', deadPid + 1000000, dirAway, 57003);
      writeFileSync(join(mk, 'corrupt.json'), '{ not json');
      const swept = h.sweepClusters({ markerDir: mk, run: fakeRun });
      const stopDead = ['pg_ctl', '-D', join(dirDead, 'data'), '-m', 'immediate', 'stop'].join(' ');
      check('cluster guard: a cluster whose owning process is dead is swept: pg_ctl stop -m immediate on its data dir, its folder and its marker removed',
        calls.some(c => c.join(' ') === stopDead) && !existsSync(dirDead) && !existsSync(mDead) && swept.some(s => s.swept && s.port === 57001), JSON.stringify({ calls, swept }));
      check('cluster guard: a cluster whose owning process is alive is left alone (no pg_ctl call, folder and marker still there)',
        existsSync(dirLive) && existsSync(mLive) && !calls.some(c => c.join(' ').includes(dirLive)), JSON.stringify(calls));
      check('cluster guard: a planted marker cannot aim the sweep at a folder this guard did not make (nothing stopped, nothing deleted; the marker is dropped); a corrupt marker is dropped',
        existsSync(join(dirAway, 'keep.txt')) && !existsSync(mAway) && !calls.some(c => c.join(' ').includes('precious')) && !existsSync(join(mk, 'corrupt.json')), JSON.stringify(calls));
      check('cluster guard: pidAlive tells this process from an ended one', h.pidAlive(process.pid) === true && h.pidAlive(deadPid) === false && h.pidAlive(0) === false && h.pidAlive(NaN) === false);

      // startCluster, with a fake initdb / pg_ctl: it sweeps first, records its marker, and stops cleanly
      const savedPort = process.env.OMNIKOM_TEST_CLUSTER_PORT;
      delete process.env.OMNIKOM_TEST_CLUSTER_PORT;                       // a mutation run shares its parent's cluster; this test is about starting one
      try {
        const dirDead2 = mkDir('dead2');
        const mDead2 = plant('dead2', deadPid, dirDead2, 57004);
        calls.length = 0;
        const listeners = () => ['exit', 'SIGINT', 'SIGTERM'].map(s => process.listenerCount(s)).join(',');
        const before = listeners();
        const fakeStart = (cmd, args) => {
          calls.push([cmd, ...args]);
          if (cmd === 'initdb') mkdirSync(args[1], { recursive: true });
          return { status: 0, stdout: '', stderr: '' };
        };
        const c1 = h.startCluster({ markerDir: mk, run: fakeStart });
        const info = (() => { try { return JSON.parse(readFileSync(c1.marker, 'utf8')); } catch { return null; } })();
        check('cluster guard: startCluster first sweeps the clusters of dead owners (the dead one is stopped and removed before the new one starts)',
          calls.findIndex(c => c.join(' ') === ['pg_ctl', '-D', join(dirDead2, 'data'), '-m', 'immediate', 'stop'].join(' ')) >= 0
          && calls.findIndex(c => c[0] === 'pg_ctl' && c.includes('immediate')) < calls.findIndex(c => c[0] === 'initdb') && !existsSync(dirDead2) && !existsSync(mDead2), JSON.stringify(calls));
        check('cluster guard: startCluster records { pid of this process, data dir, port } in a marker file under the marker folder, and registers exit and signal handlers',
          !!info && info.pid === process.pid && info.data === join(c1.dir, 'data') && String(info.port) === String(c1.port) && c1.marker.startsWith(mk) && listeners() !== before, JSON.stringify(info));
        calls.length = 0;
        h.sweepClusters({ markerDir: mk, run: fakeRun });
        check('cluster guard: the sweep leaves a running run\'s own cluster alone (its owner is this live process)', existsSync(c1.dir) && existsSync(c1.marker) && calls.length === 0, JSON.stringify(calls));
        c1.stop();
        c1.stop();
        check('cluster guard: a normal stop stops the cluster (pg_ctl stop -m fast) once, removes its folder and marker, and removes its handlers',
          calls.filter(c => c[0] === 'pg_ctl' && c.includes('fast')).length === 1 && !existsSync(c1.dir) && !existsSync(c1.marker) && listeners() === before, `${JSON.stringify(calls)} ${listeners()} ${before}`);
        let failed = null;
        let initDir = null;
        const c2 = (() => { try { return h.startCluster({ markerDir: mk, run: (cmd, args) => { if (cmd === 'initdb') { initDir = dirname(args[1]); return { status: 1, stderr: 'no space left' }; } return fakeStart(cmd, args); } }); } catch (e) { failed = e; return null; } })();
        check('cluster guard: a start that fails (initdb) cleans up after itself: no folder, no marker, no handler left', c2 === null && !!failed && /initdb failed/.test(failed.message) && listeners() === before
          && !!initDir && !existsSync(initDir) && readdirSync(mk).filter(f => f.endsWith('.json') && f.startsWith(`${process.pid}-`) && !mLive.endsWith(f)).length === 0, String(failed && failed.message));

        // the port: a block below both ephemeral ranges, the server pinned to 127.0.0.1, a failed bind walks to the next port with a printed line
        const startArgs = () => calls.filter(c => c[0] === 'pg_ctl' && c.includes('start'));
        const portOf = c => Number((/-p (\d+)/.exec(c[c.indexOf('-o') + 1]) || [])[1]);
        const logOf = c => c[c.indexOf('-l') + 1];
        const P = h.CLUSTER_PORTS;
        const fakeBind = (nBind, text = 'LOG:  could not bind IPv4 address "127.0.0.1": Address already in use') => (cmd, args) => {
          calls.push([cmd, ...args]);
          if (cmd === 'initdb') mkdirSync(args[1], { recursive: true });
          if (cmd === 'pg_ctl' && args.includes('start')) {
            if (startArgs().length <= nBind) { writeFileSync(logOf(['pg_ctl', ...args]), text + '\n'); return { status: 1, stdout: '', stderr: 'pg_ctl: could not start server' }; }
          }
          return { status: 0, stdout: '', stderr: '' };
        };
        calls.length = 0;
        const c3 = h.startCluster({ markerDir: mk, run: fakeStart, signals: false });
        const first = startArgs()[0];
        check('cluster guard: a cluster takes a port from the 21000-21899 block (outside the Linux and Windows ephemeral ranges) and the server listens on 127.0.0.1 only',
          P.first === 21000 && P.count === 900 && portOf(first) >= 21000 && portOf(first) <= 21899 && String(portOf(first)) === String(c3.port) && first[first.indexOf('-o') + 1].includes('-c listen_addresses=127.0.0.1'), JSON.stringify(first));
        c3.stop();
        calls.length = 0;
        let said = [];
        const c4 = h.startCluster({ markerDir: mk, run: fakeBind(2), signals: false, firstPort: 21500, say: l => said.push(l) });
        const marker4 = JSON.parse(readFileSync(c4.marker, 'utf8'));
        const mine = () => readdirSync(mk).filter(f => f.startsWith(`${process.pid}-215`));   // marker files of this walk (the file is named by its port)
        const before4 = mine();
        c4.stop();
        check('cluster guard: a failed bind named in the server log walks to the next port of the block, one printed line per try, and the marker follows the port (one file, removed by stop)',
          startArgs().map(portOf).join() === '21500,21501,21502' && String(c4.port) === '21502' && String(marker4.port) === '21502' && before4.join() === `${process.pid}-21502.json` && mine().length === 0
          && JSON.stringify(said) === JSON.stringify(['cluster: port 21500 in use (could not bind), trying 21501', 'cluster: port 21501 in use (could not bind), trying 21502']), JSON.stringify({ ports: startArgs().map(portOf), said, marker4, before4, after: mine() }));
        // a mutate.mjs copy has OMNIKOM_TEST_CLUSTER_PORT set (the parent's shared cluster): a start that names its port (firstPort) is a request for
        // a cluster of its own and must not be answered with the shared one
        process.env.OMNIKOM_TEST_CLUSTER_PORT = '55555';
        calls.length = 0;
        const sharedOnly = h.startCluster({ markerDir: mk, run: fakeStart, signals: false });
        const calls1 = calls.length;
        const own = h.startCluster({ markerDir: mk, run: fakeStart, signals: false, firstPort: 21500 });
        delete process.env.OMNIKOM_TEST_CLUSTER_PORT;
        check('cluster guard: with a shared cluster in the environment (a mutate copy) a start that names its port still starts its own cluster on that port; one that does not name it gets the shared one',
          sharedOnly.shared === true && String(sharedOnly.port) === '55555' && calls1 === 0 && !own.shared && String(own.port) === '21500' && calls.some(c => c[0] === 'initdb'), JSON.stringify({ sharedOnly: sharedOnly.port, calls1, own: own.port, shared: own.shared }));
        own.stop();
        calls.length = 0; said = [];
        let e5 = null;
        try { h.startCluster({ markerDir: mk, run: fakeBind(99, 'FATAL:  data directory "x" has wrong ownership'), signals: false, firstPort: 21500, say: l => said.push(l) }); } catch (e) { e5 = e; }
        check('cluster guard: a start that fails for any other reason stops at once (one pg_ctl start, no port line) and the error carries the data folder, the postmaster state and the log tail',
          !!e5 && startArgs().length === 1 && said.length === 0 && /port 21500/.test(e5.message) && /postmaster/.test(e5.message) && /data/.test(e5.message) && /server log, last 20 lines/.test(e5.message) && /wrong ownership/.test(e5.message), String(e5 && e5.message));
        calls.length = 0; said = [];
        let e6 = null;
        try { h.startCluster({ markerDir: mk, run: fakeBind(99), signals: false, firstPort: 21898, say: l => said.push(l) }); } catch (e) { e6 = e; }
        const tried = startArgs().map(portOf);
        check('cluster guard: a bind that never works is tried on 5 ports at most, wraps inside the block (never outside 21000-21899), says so 4 times, then fails naming the log',
          !!e6 && tried.join() === '21898,21899,21000,21001,21002' && said.length === 4 && tried.every(p => p >= 21000 && p <= 21899) && /could not bind/.test(e6.message), JSON.stringify({ tried, said, msg: String(e6 && e6.message).slice(0, 200) }));
      } finally { if (savedPort !== undefined) process.env.OMNIKOM_TEST_CLUSTER_PORT = savedPort; }
      check('cluster guard: the cli tests start no browser (nothing under test/, commands/ or lib/ names one)',
        ![...readdirSync(join(CLI_ROOT, 'test')).map(f => join(CLI_ROOT, 'test', f)), ...readdirSync(join(CLI_ROOT, 'commands')).map(f => join(CLI_ROOT, 'commands', f)), ...readdirSync(join(CLI_ROOT, 'lib')).map(f => join(CLI_ROOT, 'lib', f))]
          .filter(f => /\.mjs$/.test(f) && !f.endsWith('impact-stamp-hooks.mjs')).some(f => /\b(puppeteer|playwright|msedge|chromium|chrome\.exe|--remote-debugging)/i.test(readFileSync(f, 'utf8'))));
    }

    // ============================================================================ ci-heavy: the full suite and mutants run only when the change reaches them
    {
      const heavy = await import(pathToFileURL(join(CLI_ROOT, 'test', 'ci-heavy.mjs')).href);
      const HFILES = {
        'tools/omnikom-cli/test/run.mjs': "import { dep } from '../../../shared/dep.mjs';\nexport const r = dep;\n",
        'tools/omnikom-cli/lib/x.mjs': 'export const x = 1;\n',
        'shared/dep.mjs': 'export const dep = 1;\n',
        'other/unrelated.mjs': 'export const u = 1;\n',
        'notes/readme.md': 'prose\n',
        '.github/workflows/ci.yml': 'name: ci\non: [push]\njobs:\n  cli:\n    name: cli\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - name: CLI unit tests\n        run: node tools/omnikom-cli/test/run.mjs --unit\n',
      };
      const HR = mkRepo(HFILES);
      const hBase = git(HR, 'rev-parse', 'HEAD');
      const hCommit = (files, msg) => { for (const [k, v] of Object.entries(files)) put(HR, k, v); git(HR, 'add', '-A'); git(HR, 'commit', '-q', '-m', msg); return git(HR, 'rev-parse', 'HEAD'); };
      const runHeavy = (env, fails = {}) => {
        const lines = [], spawned = [];
        const spawn = (cmd, args) => { const name = args[0].split(/[\\/]/).pop(); spawned.push(name); return { status: fails[name] || 0 }; };
        const code = heavy.ciHeavy({ repo: HR, env, spawn, log: l => lines.push(l), cliDir: join(CLI_ROOT, 'test') });
        return { code, lines, spawned };
      };
      const E = { OMNIKOM_CI_BASE: hBase };
      hCommit({ 'tools/omnikom-cli/lib/x.mjs': 'export const x = 2;\n' }, 'cli change');
      let q1 = runHeavy(E);
      check('ci-heavy: a change under tools/omnikom-cli/ is needed: the reason line names the file, then run.mjs and mutate.mjs run, one after the other (exit 0)',
        q1.code === 0 && q1.lines[0] === 'ci-heavy: needed (tools/omnikom-cli/lib/x.mjs)' && q1.spawned.join() === 'run.mjs,mutate.mjs', JSON.stringify(q1));
      git(HR, 'checkout', '-q', '-B', 'work2', hBase);
      hCommit({ 'shared/dep.mjs': 'export const dep = 3;\n' }, 'dep only');
      q1 = runHeavy(E);
      check('ci-heavy: a file the cli job reads through impact (shared/dep.mjs, imported by the suite) is needed, even when no file under tools/omnikom-cli/ changed',
        q1.lines[0] === 'ci-heavy: needed (shared/dep.mjs)' && q1.spawned.join() === 'run.mjs,mutate.mjs', JSON.stringify(q1));
      git(HR, 'checkout', '-q', '-B', 'work3', hBase);
      hCommit({ 'notes/readme.md': 'more prose\n', 'other/unrelated.mjs': 'export const u = 2;\n' }, 'prose and an unrelated file');
      q1 = runHeavy(E);
      check('ci-heavy: prose and an unrelated file are not needed: "ci-heavy: not needed (2 changed files, none read by the CLI suite)", exit 0, and the children are never spawned',
        q1.code === 0 && q1.lines.join('|') === 'ci-heavy: not needed (2 changed files, none read by the CLI suite)' && q1.spawned.length === 0, JSON.stringify(q1));
      q1 = runHeavy({});
      check('ci-heavy: no base (no OMNIKOM_CI_BASE, no origin/master, no backup-gh/master) is needed: fail safe', q1.lines[0].startsWith('ci-heavy: needed (no base commit found') && q1.spawned.join() === 'run.mjs,mutate.mjs', JSON.stringify(q1));
      q1 = runHeavy({ OMNIKOM_CI_BASE: 'deadbeefdeadbeefdeadbeef' });
      check('ci-heavy: a base that is not a commit here is needed too (fail safe)', q1.lines[0].includes('is not a commit here') && q1.spawned.length === 2, JSON.stringify(q1));
      git(HR, 'update-ref', 'refs/remotes/origin/master', hBase);
      q1 = runHeavy({});
      check('ci-heavy: without OMNIKOM_CI_BASE the base is the merge base with refs/remotes/origin/master (a prose-only change is not needed)', q1.lines[0].startsWith('ci-heavy: not needed (2 changed files') && q1.spawned.length === 0, JSON.stringify(q1));
      git(HR, 'update-ref', '-d', 'refs/remotes/origin/master');
      git(HR, 'update-ref', 'refs/remotes/backup-gh/master', hBase);
      q1 = runHeavy({});
      check('ci-heavy: ... and falls back to refs/remotes/backup-gh/master', q1.lines[0].startsWith('ci-heavy: not needed (2 changed files') && q1.spawned.length === 0, JSON.stringify(q1));
      q1 = runHeavy({ OMNIKOM_CI_BASE: git(HR, 'rev-parse', 'HEAD') });
      check('ci-heavy: nothing changed since the base (master itself) is not needed', q1.lines.join('|') === 'ci-heavy: not needed (0 changed files, none read by the CLI suite)' && q1.spawned.length === 0, JSON.stringify(q1));
      git(HR, 'checkout', '-q', '-B', 'work4', hBase);
      hCommit({ '.github/workflows/ci.yml': HFILES['.github/workflows/ci.yml'] + '# edited\n' }, 'ci.yml');
      q1 = runHeavy(E);
      check('ci-heavy: a change to .github/workflows/ci.yml is needed', q1.lines[0] === 'ci-heavy: needed (.github/workflows/ci.yml)', JSON.stringify(q1));
      git(HR, 'checkout', '-q', '-B', 'work5', hBase);
      hCommit(Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(i => [`tools/omnikom-cli/lib/f${i}.mjs`, `export const f = ${i};\n`])), 'seven files');
      q1 = runHeavy(E);
      check('ci-heavy: the reason line lists the first 5 triggering files', q1.lines[0].split(', ').length === 5 && q1.lines[0].startsWith('ci-heavy: needed (tools/omnikom-cli/lib/f1.mjs'), JSON.stringify(q1));
      q1 = runHeavy(E, { 'run.mjs': 3 });
      check('ci-heavy: a failing run.mjs gives its exit code (3) and mutate.mjs is not run', q1.code === 3 && q1.spawned.join() === 'run.mjs' && q1.lines.some(l => l.includes('run.mjs failed (exit 3)')), JSON.stringify(q1));
      q1 = runHeavy(E, { 'mutate.mjs': 5 });
      check('ci-heavy: run.mjs passing and a failing mutate.mjs gives its exit code (5)', q1.code === 5 && q1.spawned.join() === 'run.mjs,mutate.mjs', JSON.stringify(q1));
      const crash = heavy.ciHeavy({ repo: HR, env: E, spawn: () => ({ error: new Error('spawn failed'), status: null }), log: () => {}, cliDir: join(CLI_ROOT, 'test') });
      check('ci-heavy: a child that cannot start is a failure (exit 1), not a pass', crash === 1, String(crash));
    }

    // ============================================================================ ci.yml must not run on pushes of the land lock
    {
      const { LOCK_BRANCH } = await lib('landlock.mjs');
      const onBlock = text => {
        const ls = String(text).split(/\r?\n/);
        const i = ls.findIndex(l => /^on:/.test(l));
        if (i < 0) return null;
        const block = [];
        for (let j = i + 1; j < ls.length && (ls[j].trim() === '' || /^\s/.test(ls[j])); j++) block.push(ls[j]);
        return { first: ls[i].slice(3).trim(), block };
      };
      const triggers = text => {
        const o = onBlock(text);
        if (!o) return [];
        if (o.first) { const m = /^\[(.*)\]$/.exec(o.first); return (m ? m[1].split(',') : [o.first]).map(x => x.trim()).filter(Boolean); }
        return o.block.map(l => /^ {2}([A-Za-z_]+):/.exec(l)).filter(Boolean).map(m => m[1]);
      };
      const pushIgnored = text => {
        const o = onBlock(text);
        if (!o || o.first) return null;
        const i = o.block.findIndex(l => /^ {2}push:/.test(l));
        if (i < 0) return null;
        for (let j = i + 1; j < o.block.length && /^ {4}/.test(o.block[j]); j++) {
          const m = /^ {4}branches-ignore:\s*(.*)$/.exec(o.block[j]);
          if (!m) continue;
          const unq = x => x.trim().replace(/^['"]|['"]$/g, '');
          if (m[1].trim().startsWith('[')) return m[1].replace(/[[\]]/g, '').split(',').map(unq).filter(Boolean);
          const items = [];
          for (let k = j + 1; k < o.block.length && /^ {6}- /.test(o.block[k]); k++) items.push(unq(o.block[k].replace(/^\s*- /, '')));
          return items;
        }
        return null;
      };
      const good = `name: ci\non:\n  push:\n    branches-ignore: [${LOCK_BRANCH}]\n  pull_request:\njobs:\n  a:\n    name: a\n`;
      const goodList = `name: ci\non:\n  push:\n    branches-ignore:\n      - ${LOCK_BRANCH}\n  pull_request:\njobs:\n`;
      check('ci.yml check (the reader itself): a planted ci.yml with push: branches-ignore: [land-lock] (inline or list) reads as exactly the constant; `on: [push, pull_request]`, a missing list or another name does not',
        pushIgnored(good).join() === LOCK_BRANCH && pushIgnored(goodList).join() === LOCK_BRANCH && pushIgnored('name: ci\non: [push, pull_request]\njobs:\n') === null
        && pushIgnored('name: ci\non:\n  push:\n  pull_request:\njobs:\n') === null && pushIgnored(good.replace(LOCK_BRANCH, 'other')).join() !== LOCK_BRANCH && pushIgnored(good.replace(`[${LOCK_BRANCH}]`, `[${LOCK_BRANCH}, extra]`)).join() !== LOCK_BRANCH);
      const realCi = (() => { try { return readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'); } catch { return ''; } })();
      const got = pushIgnored(realCi);
      check(`ci.yml check: the repository's .github/workflows/ci.yml has push: branches-ignore: [${LOCK_BRANCH}] (a push of the land lock must not start a ci run); expected red until the head's ci.yml line`,
        !!got && got.length === 1 && got[0] === LOCK_BRANCH, `branches-ignore under push: ${JSON.stringify(got)}, triggers ${JSON.stringify(triggers(realCi))}`);
      const others = (() => { try { return readdirSync(join(REPO_ROOT, '.github', 'workflows')).filter(x => /\.ya?ml$/.test(x) && x !== 'ci.yml'); } catch { return []; } })();
      const pushers = others.filter(x => triggers(readFileSync(join(REPO_ROOT, '.github', 'workflows', x), 'utf8')).includes('push'));
      check('ci.yml check: ci.yml is the only workflow triggered on push (the others are schedule, dispatch or repository_dispatch)', others.length > 0 && pushers.length === 0, `triggered on push: ${pushers.join(', ')}`);
    }
  }
}
