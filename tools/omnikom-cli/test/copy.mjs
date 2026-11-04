// Tests for the public, code-only copy (DECISIONS 46): lib/copy.mjs (the copy, the gate) and commands/copy.mjs. Called from run.mjs (units part).
// Every repository here is a throwaway one under the OS temp folder, removed at the end. No network: the public repository is a bare repository
// on this disk, `gh` is a fake. The client names below are invented (none is a real client), and the real clients' names are written nowhere.
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeFakeGh } from './fake-gh.mjs';

const cleanEnv = (() => {
  const e = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  for (const k of Object.keys(e)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|OBJECT_DIRECTORY|COMMON_DIR|NAMESPACE)$/.test(k)) delete e[k];
  delete e.OMNIKOM_REPO_ROOT;
  return e;
})();

const WF = id => `  ${id}:\n    name: job ${id}\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - name: Check out the repository\n        uses: actions/checkout@abc\n      - name: Run\n        run: node app/code.mjs\n`;
export const CI_TEXT = `# the workflow\nname: ci\n\non:\n  push:\n    branches-ignore: [land-lock]\n  pull_request:\n\njobs:\n${WF('one')}  # two is a job\n${WF('two')}${WF('three')}`;
export const RULES = (o = {}) => JSON.stringify({
  deny: ['clients/', 'planning/', 'docs/offer/', 'CLAUDE.md'],
  why: { 'clients/': 'client records', 'planning/': 'business text', 'docs/offer/': 'offers', 'CLAUDE.md': 'rules for sessions' },
  workflowsKept: ['ci.yml'],
  jobsNotOnCopy: {},
  ...o,
}, null, 2) + '\n';
// the invented client: slug "acme"; business "Acme Plumbing Co"; person "Jane Doe"
export const PLANT = (rules = RULES()) => ({
  'tools/omnikom-cli/public-copy.json': rules,
  '.github/workflows/ci.yml': CI_TEXT,
  '.github/workflows/alerts.yml': 'name: alerts\non:\n  schedule:\n    - cron: "0 * * * *"\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n',
  'app/code.mjs': "console.log('code');\n",
  'app/delivery.mjs': "export const note = 'delivery of the parcel';\n",
  'docs/guide.md': '# guide\n\nplain product text\n',
  'clients/acme/profile.md': '# Acme Plumbing Co (Jane Doe): profile\n\nprivate record\n',
  'clients/acme/status.md': 'status of the client\n',
  'clients/TEMPLATE/profile.md': '# <Client name>: profile\n',
  'clients/test/run.mjs': "console.log('test');\n",
  'planning/x.md': 'a decision\n',
  'bin.dat': Buffer.concat([Buffer.from('Acme Plumbing Co '), Buffer.from([0, 1, 2, 3])]),
});

export async function copyTests({ check, cli, CLI_ROOT, REPO_ROOT, lib }) {
  const work = mkdtempSync(join(tmpdir(), 'omnikom-copytest-'));
  try { await body(); } finally { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }

  async function body() {
    const git = (cwd, ...args) => {
      const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 120000, env: cleanEnv });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.error}`);
      return r.stdout.trim();
    };
    const put = (dir, rel, data) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), data); };
    let n = 0;
    const mkRepo = (files = PLANT()) => {
      const dir = join(work, `r${++n}`);
      mkdirSync(dir);
      git(dir, 'init', '-q', '-b', 'master');
      for (const [k, v] of [['user.name', 'tester'], ['user.email', 't@example.invalid'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(dir, 'config', k, v);
      for (const [rel, data] of Object.entries(files)) put(dir, rel, data);
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'init');
      return dir;
    };
    const { makeGit } = await lib('git.mjs');
    const copyLib = await lib('copy.mjs');
    const { parseJobs } = await lib('graph.mjs');
    const { parseWorkflow } = await import(pathToFileURL(join(CLI_ROOT, 'commands', 'ci.mjs')).href);
    const ctxFor = dir => ({ repo: dir, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }, gitleaks: undefined, now: () => 1800000000, sleep: async () => {}, gh: async () => ({ ok: false, out: '', err: 'no gh' }) });
    const lsNames = (dir, treeish) => git(dir, 'ls-tree', '-r', '--name-only', treeish).split('\n').filter(Boolean).sort();
    const R1 = mkRepo();
    const G1 = makeGit(R1);
    const head1 = git(R1, 'rev-parse', 'HEAD');

    // ============================================================================ Part A: the copy
    const built = copyLib.copyTree(G1, head1);
    const droppedWant = ['.github/workflows/alerts.yml', 'clients/TEMPLATE/profile.md', 'clients/acme/profile.md', 'clients/acme/status.md', 'clients/test/run.mjs', 'planning/x.md'];
    check('copy: drops exactly the denylisted paths and the workflow files the rules do not keep (and nothing else)', JSON.stringify(built.dropped) === JSON.stringify(droppedWant), JSON.stringify(built.dropped));
    const planted = Object.keys(PLANT()).sort();
    check('copy: the copy tree holds every other planted file (an oracle written here, not the code under test)',
      JSON.stringify(lsNames(R1, built.tree)) === JSON.stringify(planted.filter(p => !droppedWant.includes(p))), lsNames(R1, built.tree).join(' '));
    check('copy: nothing is transformed when jobsNotOnCopy is empty, and the ci.yml blob is the private one, byte for byte',
      built.transformed.length === 0 && git(R1, 'rev-parse', `${built.tree}:.github/workflows/ci.yml`) === git(R1, 'rev-parse', 'HEAD:.github/workflows/ci.yml'));
    const c1 = copyLib.copyCommit(G1, built);
    const parents = git(R1, 'rev-list', '--parents', '-n', '1', c1).split(' ');
    check('copy: the copy commit is a ROOT commit (no parent) of the copy tree', parents.length === 1 && git(R1, 'rev-parse', `${c1}^{tree}`) === built.tree, parents.join(' '));
    const rulesSha = createHash('sha256').update(readFileSync(join(R1, 'tools/omnikom-cli/public-copy.json'))).digest('hex');
    const ptree = git(R1, 'rev-parse', 'HEAD^{tree}');
    check('copy: the message is "copy of <sha>" with the Private-Commit, Private-Tree and Copy-Rules (sha256 of the rules file) trailers',
      git(R1, 'log', '-1', '--format=%B', c1) === `copy of ${head1}\n\nPrivate-Commit: ${head1}\nPrivate-Tree: ${ptree}\nCopy-Rules: ${rulesSha}`, git(R1, 'log', '-1', '--format=%B', c1));
    check('copy: author, committer and both dates are the private commit\'s',
      git(R1, 'log', '-1', '--format=%an|%ae|%aI|%cn|%ce|%cI', c1) === git(R1, 'log', '-1', '--format=%an|%ae|%aI|%cn|%ce|%cI', head1));
    const again = copyLib.copyCommit(G1, copyLib.copyTree(G1, head1));
    check('copy: the same input gives the same copy commit (deterministic, built twice)', again === c1, `${again} ${c1}`);
    const R1b = join(work, 'clone1');
    git(work, 'clone', '-q', R1, R1b);
    check('copy: and the same commit in a fresh clone (another object store, another run) gives the same copy commit', copyLib.copyCommit(makeGit(R1b), copyLib.copyTree(makeGit(R1b), head1)) === c1);

    // jobsNotOnCopy removes the job from the copy's ci.yml
    const RJ = mkRepo(PLANT(RULES({ jobsNotOnCopy: { two: { reason: 'needs a secret', files: ['planning/x.md'] } } })));
    const GJ = makeGit(RJ);
    const builtJ = copyLib.copyTree(GJ, git(RJ, 'rev-parse', 'HEAD'));
    const ciJ = git(RJ, 'show', `${builtJ.tree}:.github/workflows/ci.yml`);
    check('copy: a job in jobsNotOnCopy is removed from the copy\'s ci.yml (the other jobs and the comment of the next job stay), the file is "transformed"',
      builtJ.transformed.join() === '.github/workflows/ci.yml' && parseJobs(ciJ).map(j => j.id).join() === 'one,three' && ciJ.includes('# two is a job') && ciJ.includes('# the workflow') && !ciJ.includes('job two'), ciJ);
    let parsedOk = true;
    try { parseWorkflow(ciJ); } catch { parsedOk = false; }
    check('copy: the transformed ci.yml still parses with parseJobs and parseWorkflow', parsedOk && parseJobs(ciJ).length === 2);
    check('copy: dropJobs on an id the file does not have is an error (never a silent no-op), also for the first, the middle and the last job', (() => {
      let threw = false; try { copyLib.dropJobs(CI_TEXT, ['nope']); } catch { threw = true; }
      return threw && ['one', 'two', 'three'].every(id => { const out = copyLib.dropJobs(CI_TEXT, [id]); return parseJobs(out).map(j => j.id).join() === ['one', 'two', 'three'].filter(x => x !== id).join(); });
    })());
    check('copy: dropJobs with no ids returns the text as it is', copyLib.dropJobs(CI_TEXT, []) === CI_TEXT);

    // the real ci.yml and the real rules file
    const realCi = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    const realRulesText = readFileSync(join(CLI_ROOT, 'public-copy.json'), 'utf8');
    const realRules = copyLib.parseRules(realRulesText);
    const realIds = parseJobs(realCi).map(j => j.id);
    const realOut = copyLib.dropJobs(realCi, Object.keys(realRules.jobsNotOnCopy));
    let realParsed = true; try { parseWorkflow(realOut); } catch { realParsed = false; }
    check('copy: the REAL ci.yml with the REAL rules\' jobsNotOnCopy removed parses with both readers and keeps every other job',
      realParsed && parseJobs(realOut).map(j => j.id).join() === realIds.filter(i => !(i in realRules.jobsNotOnCopy)).join() && Object.keys(realRules.jobsNotOnCopy).every(i => realIds.includes(i)), realIds.join());
    check('copy: the real rules deny the client, listing, planning and offer folders, keep only ci.yml, and name no client',
      ['clients/', 'planning/', 'docs/listings/', 'sops/clients/', 'docs/offer/', 'CLAUDE.md', '.claude/'].every(p => realRules.deny.includes(p)) && realRules.workflowsKept.join() === 'ci.yml');
    check('copy: the real rules file has no em dash (project rule)', !realRulesText.includes('\u2014'));
    check('copy: rules that are not an object, have no deny list, or a deny prefix with ".." or a leading "/" are Blocked', (() => {
      const bad = ['[]', '{}', JSON.stringify({ deny: ['../x'], workflowsKept: [], jobsNotOnCopy: {} }), JSON.stringify({ deny: ['/x'], workflowsKept: [], jobsNotOnCopy: {} }), JSON.stringify({ deny: ['a/'], workflowsKept: ['a/b.yml'], jobsNotOnCopy: {} }), 'not json'];
      return bad.every(t => { try { copyLib.parseRules(t); return false; } catch (e) { return e.name === 'Blocked'; } });
    })());

    // ============================================================================ Part B: the gate
    const gate = async (dir, commit, tree, rules) => copyLib.checkCopy(ctxFor(dir), makeGit(dir), { commit, tree, rules });
    const okRules = built.rules;
    let g = await gate(R1, head1, built.tree, okRules);
    check('gate: a clean copy passes (denylist, client names, gitleaks and ci.yml all checked)', g.ok && g.problems.length === 0 && g.clients === 1, JSON.stringify(g.problems));

    // a tree built by hand (not by copyTree) that holds a denylisted path
    const handTree = (dir, base, add) => {
      const idx = join(dir, '.git', `idx-${++n}`);
      const env = { ...cleanEnv, GIT_INDEX_FILE: idx };
      const run = (args, input) => { const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env, input, timeout: 120000 }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
      run(['read-tree', base]);
      for (const [rel, text] of Object.entries(add)) {
        const blob = run(['hash-object', '-w', '--stdin'], text);
        run(['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`]);
      }
      const t = run(['write-tree']);
      rmSync(idx, { force: true });
      return t;
    };
    const dirty = handTree(R1, built.tree, { 'planning/leak.md': 'a decision\n' });
    g = await gate(R1, head1, dirty, okRules);
    check('gate: a denylisted path planted in a hand-built tree is refused, by path, with the reason', !g.ok && g.problems.length === 1 && g.problems[0] === 'planning/leak.md is on the copy but is denylisted planning/', JSON.stringify(g.problems));
    const wfTree = handTree(R1, built.tree, { '.github/workflows/alerts.yml': 'name: alerts\n' });
    g = await gate(R1, head1, wfTree, okRules);
    check('gate: a workflow file the rules do not keep is refused', !g.ok && g.problems.some(p => /alerts\.yml is on the copy but is a workflow file the copy does not keep/.test(p)), JSON.stringify(g.problems));
    const upper = handTree(R1, built.tree, { 'Planning/x.md': 'a\n' });
    g = await gate(R1, head1, upper, okRules);
    check('gate: the denylist is matched without regard to case (a Windows checkout would merge Planning/ and planning/)', !g.ok && g.problems.some(p => p.startsWith('Planning/x.md ')), JSON.stringify(g.problems));

    // client names
    const named = handTree(R1, built.tree, {
      'app/names-slug.mjs': "const x = 1;\n// the ACME account\n",
      'app/names-business.mjs': "const y = 2;\nconst who = 'acme   plumbing co';\n",
      'app/names-person.md': 'line one\nask Jane Doe about it\n',
    });
    g = await gate(R1, head1, named, okRules);
    const wantLines = ['app/names-business.mjs:2 names client 0', 'app/names-person.md:2 names client 0', 'app/names-slug.mjs:2 names client 0'];
    check('gate: a file naming a client by slug, by business name (mixed case, extra spaces) or by person is refused as "<path>:<line> names client <n>"',
      !g.ok && JSON.stringify(g.problems.slice().sort()) === JSON.stringify(wantLines), JSON.stringify(g.problems));
    check('gate: the refusal never prints a client name (slug, business or person), in any case', !/acme|plumbing|jane|doe/i.test(g.problems.join('\n')), g.problems.join('\n'));
    const ELI = mkRepo({ ...PLANT(), 'clients/eli/profile.md': '# Eli Buys Nothing (Eli Doe): profile\n' });
    const GE = makeGit(ELI), headE = git(ELI, 'rev-parse', 'HEAD'), builtE = copyLib.copyTree(GE, headE);
    g = await gate(ELI, headE, builtE.tree, builtE.rules);
    check('gate: a word that merely contains a slug passes (the slug "eli" and the file app/delivery.mjs: "delivery" holds "eli")', g.ok && lsNames(ELI, builtE.tree).includes('app/delivery.mjs') && g.clients === 2, JSON.stringify(g.problems));
    const eliNamed = handTree(ELI, builtE.tree, { 'app/real.mjs': '// ask eli about it\n', 'app/mid.mjs': 'const believing = 1;\nconst deli_cious = 2;\n' });
    g = await gate(ELI, headE, eliNamed, builtE.rules);
    check('gate: and the real slug as a whole word is still refused (word boundaries are not dropped), while "believing" and "deli_cious" pass beside it',
      !g.ok && g.problems.length === 1 && g.problems[0] === 'app/real.mjs:1 names client 1', JSON.stringify(g.problems));
    const pathNamed = handTree(R1, built.tree, { 'app/acme/thing.mjs': 'x\n' });
    g = await gate(R1, head1, pathNamed, okRules);
    check('gate: a path that holds a client name is refused, printed with the name masked', !g.ok && g.problems.length === 1 && g.problems[0] === 'app/[client 0]/thing.mjs: the path names client 0', JSON.stringify(g.problems));
    check('gate: a binary file that holds a client name is skipped (a NUL byte in the first 8 KB); the planted bin.dat is on the clean copy', lsNames(R1, built.tree).includes('bin.dat'));
    const noClients = mkRepo({ ...PLANT(), 'clients/TEMPLATE/x.md': 'x\n' });
    check('gate: the TEMPLATE and test folders of clients/ are not clients (the planted repo has one client: acme)', copyLib.clientNames(makeGit(noClients), git(noClients, 'rev-parse', 'HEAD')).length === 1);

    // gitleaks
    const fakeSecret = `AKIA${'QYLPMN5HHHFPZAM2'}`;
    const leaky = handTree(R1, built.tree, { 'app/aws.mjs': `const key = "${fakeSecret}";\nconst secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYzXOEXAMPLEKEY";\n` });
    g = await gate(R1, head1, leaky, okRules);
    check('gate: a file gitleaks flags is refused (<path>:<line> gitleaks <rule>) and the secret is not printed', !g.ok && g.problems.some(p => /^app\/aws\.mjs:\d+ gitleaks /.test(p)) && !g.problems.join('\n').includes(fakeSecret), JSON.stringify(g.problems));
    const scanDirs = () => readdirSync(tmpdir()).filter(x => x.startsWith('omnikom-copy-') && !x.startsWith('omnikom-copy-push-')).length;
    const before = scanDirs();
    await gate(R1, head1, built.tree, okRules);
    await gate(R1, head1, leaky, okRules);
    check('gate: the temp folder of the gitleaks scan is removed on a pass and on a refusal', scanDirs() === before, `${before} -> ${scanDirs()}`);
    // the repo's .gitleaksignore: its fingerprints are <private commit>:<path>:<rule>:<line>; the copy's scan has no commits, so it gets them without the sha
    const flagged = g.problems.map(p => /^(.+):(\d+) gitleaks (.+)$/.exec(p)).filter(Boolean);
    const ignoreText = flagged.map(m => `${'a'.repeat(40)}:${m[1]}:${m[3]}:${m[2]}`).join('\n') + '\n';
    const leakyIgnored = handTree(R1, built.tree, { 'app/aws.mjs': `const key = "${fakeSecret}";\nconst secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYzXOEXAMPLEKEY";\n`, '.gitleaksignore': ignoreText });
    const gi = await gate(R1, head1, leakyIgnored, okRules);
    check('gate: the repository\'s .gitleaksignore is honoured, its private commit sha taken off each fingerprint (the findings it lists are not refused; the same file without the entries is)', flagged.length >= 1 && gi.ok, JSON.stringify({ ignoreText, problems: gi.problems }));

    // ci.yml
    const noCiTree = (() => { const idx = join(R1, '.git', `idx-${++n}`); const env = { ...cleanEnv, GIT_INDEX_FILE: idx }; const run = args => { const r = spawnSync('git', args, { cwd: R1, encoding: 'utf8', env, timeout: 120000 }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); }; run(['read-tree', built.tree]); run(['update-index', '--force-remove', '.github/workflows/ci.yml']); const t = run(['write-tree']); rmSync(idx, { force: true }); return t; })();
    g = await gate(R1, head1, noCiTree, okRules);
    check('gate: a copy without ci.yml is refused', !g.ok && g.problems.some(p => /the copy has no ci\.yml/.test(p)), JSON.stringify(g.problems));
    const brokenCi = handTree(R1, built.tree, { '.github/workflows/ci.yml': 'name: ci\njobs:\n  a:\n   bad indent: [\n' });
    g = await gate(R1, head1, brokenCi, okRules);
    check('gate: a ci.yml that does not parse is refused', !g.ok && g.problems.some(p => /ci\.yml: does not parse/.test(p) || /has no jobs/.test(p)), JSON.stringify(g.problems));
    const ghostRules = { ...okRules, jobsNotOnCopy: { ghost: { reason: 'a job the private ci.yml lacks', files: [] } } };
    g = await gate(R1, head1, built.tree, ghostRules);
    check('gate: jobsNotOnCopy naming a job the private ci.yml lacks is refused', !g.ok && g.problems.some(p => /names ghost, which the private ci\.yml does not have/.test(p)), JSON.stringify(g.problems));
    const stillThere = { ...okRules, jobsNotOnCopy: { two: { reason: 'needs a secret', files: ['planning/x.md'] } } };
    g = await gate(R1, head1, built.tree, stillThere);
    check('gate: a job that jobsNotOnCopy removes but the copy still has is refused', !g.ok && g.problems.some(p => /still has the job two/.test(p)), JSON.stringify(g.problems));
    const NEEDS = mkRepo({ ...PLANT(RULES({ jobsNotOnCopy: { one: { reason: 'x', files: ['planning/x.md'] } } })), '.github/workflows/ci.yml': CI_TEXT.replace('  three:\n    name: job three\n', '  three:\n    name: job three\n    needs: one\n') });
    const bN = copyLib.copyTree(makeGit(NEEDS), git(NEEDS, 'rev-parse', 'HEAD'));
    g = await gate(NEEDS, git(NEEDS, 'rev-parse', 'HEAD'), bN.tree, bN.rules);
    check('gate: a job that needs a removed job is refused (the copy\'s ci.yml would not run)', !g.ok && g.problems.some(p => /a job needs one, which is not on the copy/.test(p)), JSON.stringify(g.problems));

    // ============================================================================ the command

    // ---- DECISIONS 47: client-named files denied by name (denyNamed), jobsNotOnCopy with the files that keep a job off the copy
    {
      const DN = mkRepo(PLANT(RULES({ denyNamed: ['docs/guide.md'] })));
      const bDN = copyLib.copyTree(makeGit(DN), git(DN, 'rev-parse', 'HEAD'));
      check('copy: denyNamed files are dropped like deny prefixes (DECISIONS 47)', bDN.dropped.includes('docs/guide.md') && !lsNames(DN, bDN.tree).includes('docs/guide.md'), bDN.dropped.join());
      const NF = mkRepo(PLANT(RULES({ jobsNotOnCopy: { two: { reason: 'r', files: ['app/code.mjs'] } } })));
      const bNF = copyLib.copyTree(makeGit(NF), git(NF, 'rev-parse', 'HEAD'));
      const gNF = await copyLib.checkCopy(ctxFor(NF), makeGit(NF), { commit: bNF.sha, tree: bNF.tree, rules: bNF.rules });
      check('gate: a file jobsNotOnCopy lists as keeping a job off the copy, but that the copy does not deny, is refused', !gNF.ok && gNF.problems.some(p => /jobsNotOnCopy two lists app\/code\.mjs .* does not deny it/.test(p)), JSON.stringify(gNF.problems));
      const old = [JSON.stringify({ deny: ['a/'], workflowsKept: [], jobsNotOnCopy: { j: 'a reason' } }), JSON.stringify({ deny: ['a/'], workflowsKept: [], jobsNotOnCopy: { j: { reason: 'r' } } }), JSON.stringify({ deny: ['a/'], workflowsKept: [], jobsNotOnCopy: { j: { reason: '', files: [] } } }), JSON.stringify({ deny: ['a/'], denyNamed: 'x', workflowsKept: [], jobsNotOnCopy: {} })];
      check('copy: the old jobsNotOnCopy shape (job: reason), a job without files, an empty reason and a denyNamed that is not a list are Blocked', old.every(x => { try { copyLib.parseRules(x); return false; } catch (e) { return e.name === 'Blocked'; } }));
      const RN = mkRepo(PLANT(RULES({ deny: ['clients/', 'planning/', 'docs/offer/', 'CLAUDE.md', 'contracts/examples/acme/'] })));
      const bRN = copyLib.copyTree(makeGit(RN), git(RN, 'rev-parse', 'HEAD'));
      const gRN = await copyLib.checkCopy(ctxFor(RN), makeGit(RN), { commit: bRN.sha, tree: bRN.tree, rules: bRN.rules });
      check('gate: a rules file that itself names a client (a deny prefix that holds a client slug) is refused by the name scan, so the rules file can never leak one', !gRN.ok && gRN.problems.some(p => /^tools\/omnikom-cli\/public-copy\.json:\d+ names client 0$/.test(p)), JSON.stringify(gRN.problems));
      // the REAL rules file against the REAL clients of this repository, and against the real ci.yml
      const realClients = copyLib.clientNames(makeGit(REPO_ROOT), 'HEAD');
      const hit = realClients.filter(c => copyLib.nameRegex(c.terms).test(realRulesText)).length;
      check(`rules: the real public-copy.json passes the gate's own name scan (${realClients.length} client folders in this repository's HEAD; none named in the file)`, hit === 0, String(hit));
      const realJobs = Object.entries(realRules.jobsNotOnCopy);
      check('rules: every file the real jobsNotOnCopy lists is denied by the real rules, and every listed job is a job of the real ci.yml', realJobs.every(([id, v]) => realIds.includes(id) && v.files.every(p => copyLib.deniedReason(p, realRules))), JSON.stringify(realJobs.map(([id, v]) => [id, v.files.filter(p => !copyLib.deniedReason(p, realRules))])));
    }

    {
      const AK = mkRepo({ ...PLANT(), 'clients/acme/profile.md': '# Acme Plumbing Co (Jane Doe): profile\n\nprivate record\n\n- Also known as: Zed Pipes,  Quux Group , ,\n' });
      const GA = makeGit(AK), headA = git(AK, 'rev-parse', 'HEAD'), bA = copyLib.copyTree(GA, headA);
      const aClean = await copyLib.checkCopy(ctxFor(AK), GA, { commit: headA, tree: bA.tree, rules: bA.rules });
      const terms = copyLib.clientNames(GA, headA)[0].terms.map(x => x.toLowerCase());
      check('gate: "Also known as: a, b" in a profile adds the terms (trimmed, empty ones ignored) to the client\'s names, on a clean copy it still passes', aClean.ok && terms.includes('zed pipes') && terms.includes('quux group') && !terms.includes('') && terms.length === 5, JSON.stringify(terms));
      const aNamed = handTree(AK, bA.tree, { 'app/aka-a.mjs': 'const a = 1;\n// built by the ZED   pipes crew\n', 'app/aka-b.md': 'one\ntwo\nquux group says hi\n', 'app/fine.mjs': 'const quuxes = 1;\n' });
      const gA2 = await copyLib.checkCopy(ctxFor(AK), GA, { commit: headA, tree: aNamed, rules: bA.rules });
      check('gate: a file naming ONLY an also-known-as term is refused as "names client <n>", whole word and any case, and the term is in no output; a word that merely contains one passes',
        !gA2.ok && JSON.stringify(gA2.problems.slice().sort()) === JSON.stringify(['app/aka-a.mjs:2 names client 0', 'app/aka-b.md:3 names client 0']) && !/zed|quux/i.test(gA2.problems.join('\n')), JSON.stringify(gA2.problems));
    }
    const outRepo = R1;
    const b = await cli(['copy', 'build', 'HEAD', '--dry-run', '--json'], {}, { repo: outRepo });
    check('copy build --dry-run: prints the copy commit, the counts and "gate PASS", exit 0, and pushes nothing', b.exit === 0 && b.json.data.copySha === c1 && b.json.data.files === planted.length - droppedWant.length && b.json.data.dropped === droppedWant.length && b.json.data.gate === 'pass' && b.json.data.pushed === false, b.all.slice(0, 400));
    const bt = await cli(['copy', 'build', 'HEAD', '--dry-run'], {}, { repo: outRepo });
    check('copy build: the text form has the "<private> -> <copy> (n files, m dropped" line', bt.exit === 0 && bt.stdout.includes(`copy: ${head1} -> ${c1} (${planted.length - droppedWant.length} files, ${droppedWant.length} dropped`), bt.stdout.slice(0, 300));
    const dirtyHead = (() => { put(ELI, 'app/real.mjs', '// ask eli about it\n'); git(ELI, 'add', '-A'); git(ELI, 'commit', '-q', '-m', 'names a client'); return git(ELI, 'rev-parse', 'HEAD'); })();
    const bad = await cli(['copy', 'build', dirtyHead, '--dry-run', '--json'], {}, { repo: ELI });
    check('copy build: a gate failure is COPY-REFUSED, exit 1, with every offending path and no client name in the output', bad.exit === 1 && bad.json.code === 'COPY-REFUSED' && bad.json.data.problems.join() === 'app/real.mjs:1 names client 1', bad.all.slice(0, 400));
    check('copy build: the refusal text lines carry no client name', bad.exit === 1 && !/(acme|jane|plumbing|buys nothing|\beli\b)/i.test(bad.all), bad.all.slice(0, 400));

    // ============================================================================ Part D mechanics: copy push (a local bare repository stands in for the public one)
    {
      const pubBare = join(work, 'pub.git'), privBare = join(work, 'priv.git');
      git(work, 'init', '-q', '--bare', '-b', 'master', pubBare);
      git(work, 'init', '-q', '--bare', '-b', 'master', privBare);
      const PU = mkRepo();                                                  // the pusher: makes the commits and pushes them to the private remote
      git(PU, 'remote', 'add', 'backup-gh', privBare);
      git(PU, 'push', '-q', 'backup-gh', 'master');
      const PR = join(work, 'prclone');                                     // the clone copy push runs in: it has the pre-push hook installed and has fetched nothing the pusher pushes later
      git(work, 'clone', '-q', '-o', 'backup-gh', privBare, PR);
      const hooked = await cli(['hooks', 'install'], {}, { repo: PR });
      const GU = makeGit(PU);
      const BR = 'check/cli-and-testing/slice';
      git(PU, 'push', '-q', 'backup-gh', `HEAD:refs/heads/${BR}`);
      const head = git(PU, 'rev-parse', 'HEAD');
      const copyOf = sha => copyLib.copyCommit(GU, copyLib.copyTree(GU, sha));
      const pubRef = ref => { const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: pubBare, encoding: 'utf8', env: cleanEnv, timeout: 60000 }); return r.status === 0 ? r.stdout.trim() : ''; };
      const RUN7 = 'https://github.com/pub/checks/actions/runs/7';
      const ghFor = sha => makeFakeGh(() => ({ runs: [{ databaseId: 7, status: 'completed', conclusion: 'success', headSha: sha, event: 'push', url: RUN7, createdAt: '2026-11-01T10:00:00Z' }] }));
      const push = async (branch, sha) => { const spied = []; const r = await cli(['copy', 'push', branch, '--json'], {}, { repo: PR, copyRepo: 'pub/checks', copyUrl: pubBare, gh: ghFor(sha), sleep: async () => {}, copyPushSpy: a => spied.push(a) }); return { ...r, spied, pushes: spied.filter(a => a.includes('push')) }; };
      const cs = copyOf(head);
      let r = await push(BR, cs);
      check('copy push: reads the private branch from the private remote, builds and gates the copy and pushes it to the SAME branch name of the public repository; the public tip is the copy commit',
        hooked.exit === 0 && r.exit === 0 && pubRef(`refs/heads/${BR}`) === cs && r.json.data.copySha === cs && r.json.data.pushed === true, r.all.slice(0, 500));
      check('copy push: the public branch is a ROOT commit whose tree is the copy tree (no history reaches the public repository), and the public repo holds no other branch',
        git(pubBare, 'rev-list', '--parents', '-n', '1', cs).split(' ').length === 1 && git(pubBare, 'rev-parse', `${cs}^{tree}`) === copyLib.copyTree(GU, head).tree && git(pubBare, 'for-each-ref', '--format=%(refname)') === `refs/heads/${BR}`);
      check('copy push: it prints "copy: <private sha> -> <copy sha> (<n> files, <m> dropped)" and the public run url once GitHub lists it',
        r.json.data.lines.some(l => l === `copy: ${head} -> ${cs} (${r.json.data.files} files, ${r.json.data.dropped} dropped)`) && r.json.data.lines.includes(`copy: public run ${RUN7}`) && r.json.data.runUrl === RUN7, r.json.data.lines.join('\n'));
      const first = r.pushes[0] || [];
      check('copy push: the push runs from a temporary bare repository with hooks switched off, replaces a check branch with --force, and never names refs/heads/master',
        r.pushes.length === 1 && first.includes('-c') && first.some(a => /^core\.hooksPath=/.test(a)) && first.includes('--force') && !first.some(a => /refs\/heads\/master$/.test(a)), JSON.stringify(r.spied));
      check('copy push: the clone\'s own pre-push hook is installed (exit 0 above) and was not in the way: a direct push of the copy to the public repository from that clone is refused by it',
        (() => { const p = spawnSync('git', ['push', '-q', pubBare, `${cs}:refs/heads/direct`], { cwd: PR, encoding: 'utf8', env: cleanEnv, timeout: 120000 }); return p.status !== 0 && pubRef('refs/heads/direct') === ''; })());
      r = await push(BR, cs);
      check('copy push: the same private sha gives the same copy commit and nothing is pushed twice (idempotent): "already is", no push call', r.exit === 0 && r.json.data.pushed === false && r.json.data.lines.some(l => l.includes('already is ' + cs)) && r.pushes.length === 0, r.all.slice(0, 400));
      put(PU, 'app/code.mjs', "console.log('second');\n"); git(PU, 'add', '-A'); git(PU, 'commit', '-q', '-m', 'second');
      git(PU, 'push', '-q', 'backup-gh', `HEAD:refs/heads/${BR}`);
      const head2 = git(PU, 'rev-parse', 'HEAD'), cs2 = copyOf(head2);
      r = await push(BR, cs2);
      check('copy push: a new private commit on the same branch REPLACES the public branch (a root commit is never a fast-forward)', r.exit === 0 && pubRef('refs/heads/' + BR) === cs2 && cs2 !== cs && r.pushes.length === 1, r.all.slice(0, 400));
      // a gate refusal pushes nothing and creates nothing
      const BR2 = 'check/cli-and-testing/names-a-client';
      put(PU, 'app/leak.mjs', '// ask Acme Plumbing Co\n'); git(PU, 'add', '-A'); git(PU, 'commit', '-q', '-m', 'names a client');
      git(PU, 'push', '-q', 'backup-gh', `HEAD:refs/heads/${BR2}`);
      r = await push(BR2, 'f'.repeat(40));
      check('copy push: a gate refusal is COPY-REFUSED (exit 1), names the file without the client, pushes nothing and creates no public branch',
        r.exit === 1 && r.json.code === 'COPY-REFUSED' && r.pushes.length === 0 && pubRef('refs/heads/' + BR2) === '' && r.json.data.problems.join() === 'app/leak.mjs:1 names client 0' && !/acme|plumbing/i.test(r.all), r.all.slice(0, 500));
      // master: a lease on the tip that was read; the first write needs none
      const ctxM = extra => ({ ...ctxFor(PR), copyRepo: 'pub/checks', copyUrl: pubBare, ...extra });
      const GM = makeGit(PR);
      const mSpy = [];
      let pm = await copyLib.publishCopy(ctxM({ copyPushSpy: a => mSpy.push(a) }), GM, { sha: head2, branch: 'master' });
      const mPush = mSpy.filter(a => a.includes('push'));
      check('copy push (master): the first write of the public master has no lease to take and is not forced; it goes through although the clone has a pre-push hook', pm.ok && pubRef('refs/heads/master') === cs2 && mPush.length === 1 && !mPush[0].some(a => a.startsWith('--force')), JSON.stringify(mPush));
      git(PU, 'rm', '-q', 'app/leak.mjs');                                  // the file that named a client is gone again
      put(PU, 'app/code.mjs', "console.log('third');\n"); git(PU, 'add', '-A'); git(PU, 'commit', '-q', '-m', 'third');
      const head3 = git(PU, 'rev-parse', 'HEAD');
      git(PU, 'push', '-q', 'backup-gh', `HEAD:refs/heads/check/cli-and-testing/third`);
      git(PR, 'fetch', '-q', 'backup-gh', 'refs/heads/check/cli-and-testing/third');
      const mSpy2 = [];
      pm = await copyLib.publishCopy(ctxM({ copyPushSpy: a => mSpy2.push(a) }), GM, { sha: head3, branch: 'master' });
      const mPush2 = mSpy2.filter(a => a.includes('push'));
      check('copy push (master): replacing the public master takes a --force-with-lease on the tip just read, never a plain --force',
        pm.ok && pubRef('refs/heads/master') === copyOf(head3) && mPush2.length === 1 && mPush2[0].includes(`--force-with-lease=refs/heads/master:${cs2}`) && !mPush2[0].includes('--force'), JSON.stringify(mPush2));
      let notAllowed = null;
      try { await copyLib.publishCopy(ctxM({}), GM, { sha: head3, branch: 'feature' }); } catch (e) { notAllowed = e; }
      check('copy push: only check/** and master are ever written to the public repository (any other branch is Blocked)', notAllowed && notAllowed.name === 'Blocked', String(notAllowed));
      let noRepo = null;
      try { await copyLib.publishCopy({ ...ctxFor(PR) }, GM, { sha: head3, branch: 'check/a/b' }); } catch (e) { noRepo = e; }
      check('copy push: with no public repository named anywhere (rules or test override) nothing is pushed: Blocked', noRepo && noRepo.name === 'Blocked' && /names no public "repo"/.test(noRepo.message), String(noRepo));
    }

    const nr = await cli(['copy', 'build', 'HEAD', '--rules', 'x.json', '--json'], {}, { repo: outRepo });
    check('copy build: --rules (uncommitted rules) without --dry-run is Usage (exit 2)', nr.exit === 2, nr.all.slice(0, 200));
    const noRules = mkRepo({ 'a.txt': 'x\n' });
    const nrr = await cli(['copy', 'build', 'HEAD', '--json'], {}, { repo: noRules });
    check('copy build: a commit without the rules file is Blocked (exit 3), naming the file', nrr.exit === 3 && /public-copy\.json/.test(nrr.all), nrr.all.slice(0, 300));
    const un = [await cli(['copy', '--json'], {}, { repo: outRepo }), await cli(['copy', 'nope', '--json'], {}, { repo: outRepo }), await cli(['copy', 'build', '--json'], {}, { repo: outRepo }), await cli(['copy', 'push', 'master', '--json'], {}, { repo: outRepo }), await cli(['copy', 'push', '--json'], {}, { repo: outRepo }), await cli(['copy', 'build', 'HEAD', '--target', 'local', '--json'], {}, { repo: outRepo })];
    check('copy: no verb, an unknown verb, no commit, a push of master or of no branch, and --target are Usage (exit 2)', un.every(x => x.exit === 2), un.map(x => x.exit).join());
  }
}
