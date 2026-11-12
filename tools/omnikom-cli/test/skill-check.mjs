// Tests for `omnikom skill check pewp` (P3.4 R1): commands/skill.mjs asks whether the machine's copy of the SEO skill is a junction to THIS repository's
// copy, with no change in it, at backup-gh/master (J1, J2), that no tracked file names the installed path (T12), and that the CLI accepts the repository's own
// manifest (T2). The cases S1 and S2 (seo run and seo resume run the check first; seo vantage status turns the script's exit 4 into 3) are in test/seo-run.mjs.
//   node tools/omnikom-cli/test/skill-check.mjs [--bail] [--time]      exit 0 = every check passed, 1 = a check failed; lines start with "ok  " or "FAIL "
// No database, no network, no real skills folder: every case builds a throwaway git repository (the "main checkout") and a skills folder in ONE temp folder and
// sets OMNIKOM_SKILLS_DIR to it, so nothing under the real home is read. The code under test is reached only through `cli`, so test/mutate.mjs can run this file
// against a broken COPY of the CLI.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, unlinkSync, rmdirSync, cpSync, writeSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PEWP = 'programmatic-enterprise-web-performance';
// the installed path of the skill, as a regular expression (written so that this file does not match itself)
const INSTALLED = /\.claude[\\/]+skills[\\/]+programmatic/i;

export async function skillCheckTests({ check, cli, CLI_ROOT, REPO_ROOT, lib }) {
  void CLI_ROOT; void lib;
  const root = mkdtempSync(join(tmpdir(), 'omnikom-skillcheck-'));
  const junctions = [];   // every link made here, removed as a link before the folder goes
  const worktrees = [];   // [main, worktree] pairs, removed through git first
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_NAMESPACE']) delete env[k];
  const git = (cwd, args) => {
    const r = spawnSync('git', ['-c', 'user.name=skillcheck', '-c', 'user.email=skillcheck@example.invalid', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${join(root, 'no-hooks')}`, ...args], { cwd, env, encoding: 'utf8', timeout: 60000, windowsHide: true });
    if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.error ? r.error.message : String(r.stderr).trim().split('\n')[0]}`);
    return String(r.stdout).trim();
  };
  const unlink = p => { try { unlinkSync(p); } catch { rmdirSync(p); } };   // a junction is removed as a link, never through its target
  const link = (entry, target) => { symlinkSync(target, entry, 'junction'); junctions.push(entry); };
  const unlinked = entry => { unlink(entry); const i = junctions.indexOf(entry); if (i >= 0) junctions.splice(i, 1); };

  // FX: a git repository `main` with one commit that holds skills/<PEWP>/SKILL.md, backup-gh/master at that commit, and a skills folder beside it
  // holding a junction to main's copy of the skill
  const fx = name => {
    const dir = join(root, name), main = join(dir, 'main'), skills = join(dir, 'skills');
    mkdirSync(join(main, 'skills', PEWP), { recursive: true });
    mkdirSync(skills, { recursive: true });
    writeFileSync(join(main, 'skills', PEWP, 'SKILL.md'), '# the skill\n');
    git(main, ['init', '-q']);
    git(main, ['config', 'core.autocrlf', 'false']);
    git(main, ['add', '.']);
    git(main, ['commit', '-q', '-m', 'one']);
    git(main, ['update-ref', 'refs/remotes/backup-gh/master', 'HEAD']);
    const target = join(main, 'skills', PEWP), entry = join(skills, PEWP);
    link(entry, target);
    return { dir, main, skills, target, entry, head: git(main, ['rev-parse', 'HEAD']) };
  };
  // K: `omnikom skill <args> --json` against that fixture (or over.repo)
  const K = (f, args, over) => cli(['skill', ...args, '--json'], { OMNIKOM_SKILLS_DIR: f.skills }, { repo: f.main, ...over });
  const shown = r => ({ exit: r.exit, code: r.json && r.json.code, error: r.json && r.json.error, data: r.json && r.json.data });
  const problemsOf = r => (r.json && r.json.data && Array.isArray(r.json.data.problems) ? r.json.data.problems : null);

  // sc: one case in a try; fn returns [true | false, what was found]
  const sc = async (name, fn) => {
    let ok = false, detail = '';
    try {
      const [good, info] = await fn();
      ok = good === true;
      detail = ok ? '' : JSON.stringify(info === undefined ? null : info);
    } catch (e) { detail = `threw ${e && e.name}: ${e && e.message}`; }
    check(`skill check: ${name}`, ok, detail);
  };

  try {
    await sc('C1 a junction to this checkout, nothing changed, at backup-gh/master: exit 0, ok true, no problem (the control of C2 to C8) (J1)', async () => {
      const f = fx('c1');
      const r = await K(f, ['check', 'pewp']);
      const p = problemsOf(r);
      return [r.exit === 0 && r.json.data.ok === true && p !== null && p.length === 0, shown(r)];
    });

    await sc('C2 no entry in the skills folder: exit 1, the one problem names the entry (J1)', async () => {
      const f = fx('c2');
      unlinked(f.entry);
      const r = await K(f, ['check', 'pewp']);
      const p = problemsOf(r);
      return [r.exit === 1 && r.json.data.ok === false && p !== null && p.length === 1 && p[0] === `no ${PEWP} entry in the skills folder (${f.entry})`, shown(r)];
    });

    await sc('C3 a real copy of the folder in place of the junction: exit 1, "is a real folder, not a junction to <target>" (J1)', async () => {
      const f = fx('c3');
      unlinked(f.entry);
      cpSync(f.target, f.entry, { recursive: true });
      const r = await K(f, ['check', 'pewp']);
      const p = problemsOf(r);
      return [r.exit === 1 && p !== null && p.length === 1 && p[0].endsWith(`is a real folder, not a junction to ${f.target}`), shown(r)];
    });

    await sc('C4 a junction to a copy elsewhere: exit 1, "points to" and "not to <target>" (J1)', async () => {
      const f = fx('c4');
      const elsewhere = join(f.dir, 'elsewhere', PEWP);
      mkdirSync(dirname(elsewhere), { recursive: true });
      cpSync(f.target, elsewhere, { recursive: true });
      unlinked(f.entry);
      link(f.entry, elsewhere);
      const r = await K(f, ['check', 'pewp']);
      const p = problemsOf(r);
      return [r.exit === 1 && p !== null && p.length === 1 && p[0].includes('points to') && p[0].includes(`not to ${f.target}`), shown(r)];
    });

    await sc('C5 an untracked file in the main checkout\'s copy (an edit came through the junction): exit 1, the problem names it (J1)', async () => {
      const f = fx('c5');
      writeFileSync(join(f.target, 'extra.md'), 'an edit\n');
      const r = await K(f, ['check', 'pewp']);
      const p = problemsOf(r);
      return [r.exit === 1 && p !== null && p.length === 1 && p[0].startsWith(`the main checkout has changes in skills/${PEWP}`) && p[0].includes('extra.md'), shown(r)];
    });

    await sc('C6 SKILL.md edited and not committed: exit 1, the same problem naming SKILL.md (J1)', async () => {
      const f = fx('c6');
      writeFileSync(join(f.target, 'SKILL.md'), '# the skill, edited\n');
      const r = await K(f, ['check', 'pewp']);
      const p = problemsOf(r);
      return [r.exit === 1 && p !== null && p.length === 1 && p[0].startsWith(`the main checkout has changes in skills/${PEWP}`) && p[0].includes('SKILL.md'), shown(r)];
    });

    await sc('C7 backup-gh/master moved on to a newer commit (T28): exit 1, "the main checkout is at <7>, not at backup-gh/master <7>" (J1)', async () => {
      const f = fx('c7');
      const two = git(f.main, ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'two']);
      git(f.main, ['update-ref', 'refs/heads/side', two]);
      git(f.main, ['update-ref', 'refs/remotes/backup-gh/master', two]);
      const r = await K(f, ['check', 'pewp']);
      const p = problemsOf(r);
      return [r.exit === 1 && p !== null && p.length === 1 && p[0].startsWith(`the main checkout is at ${f.head.slice(0, 7)}, not at backup-gh/master ${two.slice(0, 7)}: `), shown(r)];
    });

    await sc('C8 run from a git worktree the main checkout is found (exit 0); the junction re-pointed to the worktree\'s copy is "points to" (exit 1) (J1)', async () => {
      const f = fx('c8');
      const wt = join(f.dir, 'wt');
      git(f.main, ['worktree', 'add', '--detach', '-q', wt]);
      worktrees.push([f.main, wt]);
      const first = await K(f, ['check', 'pewp'], { repo: wt });
      unlinked(f.entry);
      link(f.entry, join(wt, 'skills', PEWP));
      const second = await K(f, ['check', 'pewp'], { repo: wt });
      const p = problemsOf(second);
      return [first.exit === 0 && first.json.data.ok === true && second.exit === 1 && p !== null && p.some(x => x.includes('points to')), { first: shown(first), second: shown(second) }];
    });

    await sc('C9 anything but "skill check pewp" and --json is exit 2 "skill takes: check pewp": no word, another name, another verb, an extra word, another flag (J2)', async () => {
      const f = { skills: join(root, 'c9-skills'), main: join(root, 'c9-main') };
      const cases = [['check'], ['check', 'other'], ['frob', 'pewp'], ['check', 'pewp', 'x'], ['check', 'pewp', '--all', 'x']];   // --all is no switch in lib/args.mjs, so it takes a value
      const seen = [];
      for (const args of cases) seen.push({ args, ...shown(await K(f, args)) });
      return [seen.every(s => s.exit === 2 && s.error === 'skill takes: check pewp'), seen];
    });

    await sc('C10 no tracked file of the skill (its runs/ folder apart) or of the CLI names the installed path of the skill (T12)', async () => {
      const r = spawnSync('git', ['-C', REPO_ROOT, 'ls-files', '-z', '--', `skills/${PEWP}`, 'tools/omnikom-cli'], { env, encoding: 'utf8', timeout: 60000, maxBuffer: 1 << 28, windowsHide: true });
      if (r.error || r.status !== 0) return [false, { git: r.error ? r.error.message : String(r.stderr).trim().split('\n')[0] }];
      const files = String(r.stdout).split('\0').filter(Boolean).filter(x => !x.startsWith(`skills/${PEWP}/runs/`));
      const hit = files.find(x => { try { return INSTALLED.test(readFileSync(join(REPO_ROOT, x), 'utf8')); } catch { return false; } });
      return [files.length > 0 && hit === undefined, hit === undefined ? { files: files.length } : { firstFileThatNamesIt: hit }];
    });

    await sc('C11 seo status accepts this repository\'s own manifest (exit 0) and lists the steps in the skill\'s own run order (T2)', async () => {
      const lp = await import(pathToFileURL(join(REPO_ROOT, 'skills', PEWP, 'scripts', 'lib-pipeline.mjs')).href);
      const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'skills', PEWP, 'pipeline.json'), 'utf8'));
      const want = lp.runOrder(manifest).ids;
      const r = await cli(['seo', 'status', 'https://example.com/', '--json'], {});
      const got = r.json && r.json.data && r.json.data.order;
      return [r.exit === 0 && Array.isArray(got) && got.length > 0 && JSON.stringify(got) === JSON.stringify(want), { exit: r.exit, error: r.json && r.json.error, order: Array.isArray(got) ? got.length : got, want: want.length }];
    });
  } finally {
    for (const j of junctions) { try { unlink(j); } catch { /* gone already */ } }
    for (const [main, wt] of worktrees) { try { git(main, ['worktree', 'remove', '--force', wt]); } catch { /* the folder removal below takes it */ } }
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

// run alone: node tools/omnikom-cli/test/skill-check.mjs [--bail] [--time]   (OMNIKOM_CLI_DIR points it at a copy of the CLI, OMNIKOM_REPO_ROOT at the repository, as for run.mjs)
const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase(); } })();
if (isMain) {
  const cliDir = process.env.OMNIKOM_CLI_DIR ? resolve(process.env.OMNIKOM_CLI_DIR) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  process.env.OMNIKOM_CLI_DIR = cliDir;
  const at = f => import(pathToFileURL(join(cliDir, f)).href);
  const { cli, CLI_ROOT, REPO_ROOT } = await at('test/harness.mjs');
  const { makeCheck } = await at('test/mutate-run.mjs');
  // every line is written synchronously: a piped stdout on Windows is async and process.exit would cut the last lines
  const say = text => { try { writeSync(1, text); } catch { process.stdout.write(text); } };
  const { check, counts } = makeCheck({ bail: process.argv.includes('--bail'), timed: process.argv.includes('--time'), out: line => say(`${line}\n`) });
  await skillCheckTests({ check, cli, CLI_ROOT, REPO_ROOT, lib: f => at(join('lib', f)) });
  const c = counts();
  say(`${c.total - c.failed} of ${c.total} checks passed, ${c.failed} FAILED\n`);
  process.exit(c.failed ? 1 : 0);
}
