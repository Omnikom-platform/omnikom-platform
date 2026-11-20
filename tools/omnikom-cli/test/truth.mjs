// Tests for `omnikom truth` (commands/truth.mjs, lib/truth-env.mjs, lib/truth-worktrees.mjs): one command that compares the books, the environment
// names, staging and the worktrees with the code. One status line per indicator (OK | DRIFT | BLOCKED); exit 0 no drift, 1 drift, 3 BLOCKED.
//   node tools/omnikom-cli/test/truth.mjs [--bail] [--time]      exit 0 = every check passed, 1 = a check failed; lines start with "ok  " or "FAIL "
// No network, no key, no real Supabase, no real gh: the secrets request is a fake fetch, gh is a fake, staging is a fake status (deps.truthStatus).
// The repository is a REAL throwaway git repository in one temp folder (worktrees too); the stand-in for tools/icm/index.mjs is a file of this test.
// The code under test is reached only through `cli`, so test/mutate.mjs can run this file against a broken COPY of the CLI.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync, existsSync, realpathSync, writeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const IDS = ['book', 'proof', 'callers', 'config', 'state', 'index', 'env', 'staging-migrations', 'staging-functions', 'worktrees'];
const DAY = 86400;
const REF = 'abcdefghijklmnopqrst';
const norm = p => resolve(String(p)).replace(/\\/g, '/').toLowerCase();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// the files of the throwaway repository (the same text in every case unless a case says)
const FILES = {
  'supabase/functions/f/index.ts': "Deno.env.get('FN_ONE');\nDeno.env.get('FN_TWO');\nDeno.env.get(computed);\nDeno.env.get('SUPABASE_URL');\n",
  '.github/workflows/w.yml': 'name: w\non: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n        env:\n          A: ${{ secrets.GH_SEC }}\n          B: ${{ vars.GH_VAR }}\n          C: ${{ secrets.GITHUB_TOKEN }}\n',
  'tools/t.mjs': "process.env.TOOL_ONE; process.env['TOOL_TWO']; env.ALIAS_ONE;\nprocess.env[name];\nconst keys = ['DOC_ONLY'];\n",
  'tools/test/t.test.mjs': 'process.env.TEST_ONLY;\n',
  '.github/production/p.yml': 'jobs:\n  j:\n    steps:\n      - run: echo ${{ secrets.PROD_SEC }}\n',
  'docs/product/4-backend.md': '# Backend\n\n## Other\n\nA name outside: `NOT_A_SECRET_EARLY`.\n\n## Secrets\n\nThe names:\n\n- `TOOL_ONE`\n- `TOOL_TWO`\n- `DOC_ONLY`\n\n## Next\n\nNot a secret: `NOT_A_SECRET`.\n',
};
const T_NO_DOC_MENTION = "process.env.TOOL_ONE; process.env['TOOL_TWO']; env.ALIAS_ONE;\nprocess.env[name];\n";
const ENV_DEFAULT = { TOOL_ONE: 'VALUE-ENV-1', TOOL_TWO: 'VALUE-ENV-2', ALIAS_ONE: 'VALUE-ENV-3', FN_TWO: 'VALUE-ENV-4' };
const STAGING_DEFAULT = [{ name: 'FN_ONE', value: 'VALUE-API-1' }, { name: 'FN_TWO', value: 'VALUE-API-2' }, { name: 'SUPABASE_URL', value: 'VALUE-API-3' }];
const CLEAN_STATUS = { ok: true, code: 'ok', data: { reachable: true, migrations: { onDisk: 3, inLedger: 3, applied: ['a', 'b', 'c'], pending: [], mismatched: [], unknownInDatabase: [] }, functions: { checked: true, f: 'deployed' } } };
const lineOf = (text, needle) => text.split('\n').findIndex(l => l.includes(needle)) + 1;

export async function truthTests({ check, cli, CLI_ROOT, REPO_ROOT, lib }) {
  void REPO_ROOT; void lib;
  const root = mkdtempSync(join(tmpdir(), 'omnikom-truth-'));
  const ceiling = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = root;   // a folder that is no repository must not find one above the temp folder
  try {
    const GITENV = { ...process.env, GIT_AUTHOR_NAME: 'truth test', GIT_AUTHOR_EMAIL: 'truth@localhost', GIT_COMMITTER_NAME: 'truth test', GIT_COMMITTER_EMAIL: 'truth@localhost', GIT_TERMINAL_PROMPT: '0' };
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR']) delete GITENV[k];
    const git = (cwd, args, extra = {}) => {
      const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, env: { ...GITENV, ...extra }, encoding: 'utf8', timeout: 60000, windowsHide: true });
      if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.error ? r.error.message : r.stderr}`);
      return r.stdout.trim();
    };
    const put = (dir, rel, text) => { const f = join(dir, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); return f; };
    const at = epoch => ({ GIT_AUTHOR_DATE: `${epoch} +0000`, GIT_COMMITTER_DATE: `${epoch} +0000` });
    const NOW = Math.floor(Date.now() / 1000);

    // the stand-in for tools/icm/index.mjs: prints the lines and exits with the code (or hangs, or exits 2)
    const stubText = ({ lines = ['OK: icm index is fresh (stub)'], code = 0, hang = false } = {}) => (hang
      ? 'setInterval(() => {}, 1000);\n'
      : `for (const l of ${JSON.stringify(lines)}) console.log(l);\nprocess.exit(${code});\n`);

    // a REAL throwaway repository: one commit, the remote backup-gh and its master ref; opts: files (a path to null drops it), stub (false = no index script), remote, branch, date
    let repoCount = 0;
    const makeRepo = (opts = {}) => {
      const dir = join(root, `repo${++repoCount}`);
      mkdirSync(dir, { recursive: true });
      git(dir, ['init', '-q', '-b', opts.branch || 'master']);
      const files = { ...FILES, ...(opts.stub === false ? {} : { 'tools/icm/index.mjs': stubText() }), ...(opts.files || {}) };
      for (const [rel, text] of Object.entries(files)) if (text !== null) put(dir, rel, text);
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', 'init'], opts.date ? at(opts.date) : {});
      if (opts.remote !== false) git(dir, ['remote', 'add', 'backup-gh', 'https://github.com/acme/widgets.git']);
      if ((opts.branch || 'master') === 'master' && opts.ref !== false) git(dir, ['update-ref', 'refs/remotes/backup-gh/master', 'master']);
      return dir;
    };
    const base = makeRepo();
    put(base, 'tools/untracked.mjs', 'process.env.UNTRACKED_ONE;\n');   // never git-added
    const baseSha8 = git(base, ['rev-parse', 'refs/remotes/backup-gh/master']).slice(0, 8);

    // one run of `omnikom truth` over fakes. o: repo, env (name -> value of the master env file) | envFile: false | envPath, staging (the secrets), secrets, vars, fetchStatus, fetchThrows, fetchBody,
    // ghFail ('secret' | 'variable'), ghBody, ghExtra, token: false, ref: false, status (the fake status) | realStatus, stub, timeout, now, text, args
    let seq = 0;
    const go = async (o = {}) => {
      const dir = o.repo || base;
      if (existsSync(join(dir, 'tools', 'icm'))) put(dir, 'tools/icm/index.mjs', stubText(o.stub));
      const env = {};
      if (o.envFile !== false) {
        if (o.envPath) env.OMNIKOM_ENV_FILE = o.envPath;
        else {
          const f = join(root, `env-${++seq}.env`);
          writeFileSync(f, ['# the master env file of this case', ...Object.entries(o.env || ENV_DEFAULT).map(([k, v]) => `${k}=${v}`), ''].join('\n'));
          env.OMNIKOM_ENV_FILE = f;
        }
      }
      if (o.apiKeys) put(dir, '.secrets/api-keys.env', ['# the API keys file of this case', ...o.apiKeys.map(n => `${n}=VALUE-KEYFILE-1`), ''].join('\n'));
      else rmSync(join(dir, '.secrets'), { recursive: true, force: true });
      if (o.token !== false) env.SUPABASE_ACCESS_TOKEN = 'sbp_TESTTOKEN_0123456789';
      if (o.ref !== false) env.STAGING_SUPABASE_REF = REF;
      const calls = { fetch: [], gh: [] };
      const fetch = async (url, init = {}) => {
        calls.fetch.push({ url: String(url), auth: init.headers && (init.headers.Authorization || init.headers.authorization) });
        if (o.fetchThrows) throw new Error('network down');
        const body = o.fetchBody !== undefined ? o.fetchBody : JSON.stringify(o.staging || STAGING_DEFAULT);
        return new Response(body, { status: o.fetchStatus || 200 });
      };
      const asNames = (list, extra) => list.map(n => (typeof n === 'string' ? { name: n, ...extra } : n));
      const gh = async args => {
        calls.gh.push(args);
        const kind = args[0] === 'secret' ? 'secret' : 'variable';
        if (o.ghFail === kind) return { ok: false, out: '', err: 'gh is not installed (not found on PATH)' };
        if (o.ghBody) return { ok: true, out: o.ghBody, err: '' };
        const list = kind === 'secret' ? (o.secrets || ['GH_SEC']) : (o.vars || ['GH_VAR']);
        return { ok: true, out: JSON.stringify(asNames(list, o.ghExtra)), err: '' };
      };
      const deps = { repo: dir, fetch, gh, now: () => (o.now || NOW) };
      if (!o.realStatus) deps.truthStatus = typeof o.status === 'function' ? o.status : async () => o.status || CLEAN_STATUS;
      if (o.timeout) deps.truthTimeoutMs = o.timeout;
      const args = o.args || ['truth', ...(o.text ? [] : ['--json'])];
      const r = await cli(args, env, deps);
      const ind = id => (r.json && r.json.data && r.json.data.indicators || []).find(x => x.id === id);
      return { r, calls, ind, env, dir };
    };
    const states = g => (g.r.json && g.r.json.data ? g.r.json.data.indicators.map(x => `${x.id}=${x.state}`).join(' ') : 'no data');
    const statusLines = g => g.r.stdout.split('\n').filter(l => /^(OK|DRIFT|BLOCKED) /.test(l));
    const othersOk = (g, ...skip) => (g.r.json.data.indicators || []).filter(x => !skip.includes(x.id)).every(x => x.state === 'OK');
    const items = (g, id) => (g.ind(id) ? g.ind(id).items : null);

    // tc: one case in a try; fn returns [true | false, what was found]
    const tc = async (name, fn) => {
      let ok = false, detail = '';
      try {
        const [good, info] = await fn();
        ok = good === true;
        detail = ok ? '' : JSON.stringify(info === undefined ? null : info);
      } catch (e) { detail = `threw ${e && e.name}: ${e && e.message}`; }
      check(`truth: ${name}`, ok, detail);
    };
    const shown = g => ({ exit: g.r.exit, code: g.r.json && g.r.json.code, error: g.r.json && g.r.json.error, states: states(g), env: g.ind && g.ind('env'), stdout: g.r.json ? undefined : g.r.stdout.slice(0, 300) });

    // ---------------- T1 usage
    await tc('T1 usage: an argument, --target local and --expect are exit 2, --target production is exit 3 (the guard, before anything is read)', async () => {
      const a = await go({ args: ['truth', 'extra', '--json'], envFile: false });
      const b = await go({ args: ['truth', '--target', 'local', '--json'], envFile: false });
      const c = await go({ args: ['truth', '--target', 'production', '--json'], envFile: false });
      const d = await go({ args: ['truth', '--expect', '0', '--json'], envFile: false });
      const e = await go({ args: ['truth', '--bogus', '1', '--json'], envFile: false });
      const f = await go({ args: ['truth', 'extra'], envFile: false });
      const ok = a.r.exit === 2 && b.r.exit === 2 && String(b.r.json.error).includes('truth reads staging only') && c.r.exit === 3 && c.r.json.code === 'BLOCKED' && d.r.exit === 2 && e.r.exit === 2
        && f.r.exit === 2 && f.r.stdout.trim() === 'ERROR USAGE: truth takes no argument'
        && a.calls.fetch.length === 0 && c.calls.fetch.length === 0 && c.calls.gh.length === 0;
      return [ok, [a, b, c, d, e, f].map(shown)];
    });

    // ---------------- T2 clean
    await tc('T2 clean: ten OK lines in order, exit 0; JSON ok true code ok exit 0, no items; the env line ends with (2 computed reads not checked)', async () => {
      const g = await go({});
      const t = await go({ text: true });
      const d = g.r.json && g.r.json.data;
      const ids = d && d.indicators.map(x => x.id);
      const lines = statusLines(t);
      const textOk = t.r.exit === 0 && lines.length === 10 && lines.every((l, i) => l.startsWith(`OK ${IDS[i]}: `)) && t.r.stdout.trim().split('\n').length === 10 && lines[6].includes('(2 computed reads not checked)') && lines[6].endsWith(', 1 names of .github/production not checked (no production repository yet), no API keys file');
      const jsonOk = g.r.exit === 0 && g.r.json.ok === true && g.r.json.code === 'ok' && g.r.json.exit === 0 && same(ids, IDS) && d.indicators.every(x => x.state === 'OK' && same(x.items, []));
      const wire = g.calls.fetch.length === 1 && g.calls.fetch[0].url === `https://api.supabase.com/v1/projects/${REF}/secrets` && g.calls.fetch[0].auth === 'Bearer sbp_TESTTOKEN_0123456789'
        && same(g.calls.gh.map(a => a.join(' ')).sort(), [`secret list --json name -R acme/widgets`, `variable list --json name -R acme/widgets`]);
      return [textOk && jsonOk && wire, { text: lines, json: shown(g), calls: g.calls }];
    });

    // ---------------- T3 the repository's checks
    await tc('T3 the checks: each family of lines goes to its own indicator as one item (where \'\'), exit 1; a PROOF line is never in book', async () => {
      const lines = ['PROOF line 3: x', 'CALLERS: y', 'CONFIG: z', 'STATE: s', 'BOOK COUNTS: b', 'STALE icm/index.json: i'];
      const g = await go({ stub: { lines, code: 1 } });
      const want = { proof: lines[0], callers: lines[1], config: lines[2], state: lines[3], book: lines[4], index: lines[5] };
      const ok = g.r.exit === 1 && g.r.json.code === 'DRIFT' && Object.entries(want).every(([id, what]) => g.ind(id).state === 'DRIFT' && same(g.ind(id).items, [{ what, where: '' }]))
        && othersOk(g, ...Object.keys(want));
      return [ok, shown(g)];
    });
    await tc('T3 a stub that exits 0 gives six OK', async () => {
      const g = await go({ stub: { lines: ['OK: icm index is fresh (stub)'], code: 0 } });
      return [g.r.exit === 0 && ['book', 'proof', 'callers', 'config', 'state', 'index'].every(id => g.ind(id).state === 'OK'), shown(g)];
    });
    await tc('T3 more than 20 items: the text shows 20 and "... and 5 more", the JSON has all 25', async () => {
      const lines = Array.from({ length: 25 }, (_, i) => `PROOF line ${i + 2}: bad ${i}`);
      const g = await go({ stub: { lines, code: 1 } });
      const t = await go({ text: true, stub: { lines, code: 1 } });
      const shownItems = t.r.stdout.split('\n').filter(l => l.startsWith('  - ')).length;
      return [g.ind('proof').items.length === 25 && shownItems === 20 && t.r.stdout.split('\n').includes('  ... and 5 more'), { shownItems, tail: t.r.stdout.slice(-200) }];
    });
    const noIndex = makeRepo({ stub: false });
    for (const [label, o] of [['no tools/icm/index.mjs', { repo: noIndex }], ['an index that exits 2', { stub: { code: 2, lines: ['boom'] } }], ['an index that never ends (1 second limit)', { stub: { hang: true }, timeout: 1000 }]]) {
      await tc(`T3 ${label}: the six indicators are BLOCKED, exit 3, the other four still show their state`, async () => {
        const g = await go(o);
        const six = ['book', 'proof', 'callers', 'config', 'state', 'index'];
        const ok = g.r.exit === 3 && g.r.json.code === 'BLOCKED' && six.every(id => g.ind(id).state === 'BLOCKED' && typeof g.ind(id).unblock === 'string' && g.ind(id).unblock !== '') && othersOk(g, ...six);
        return [ok, shown(g)];
      });
    }
    await tc('T3 an index that exits 1 and prints no problem line is drift in index, never OK', async () => {
      const g = await go({ stub: { lines: [], code: 1 } });
      return [g.r.exit === 1 && g.ind('index').state === 'DRIFT' && g.ind('book').state === 'OK', shown(g)];
    });

    // ---------------- T4 the environment, per surface
    const FN1 = 'supabase/functions/f/index.ts:1';
    const wfLine = needle => `.github/workflows/w.yml:${lineOf(FILES['.github/workflows/w.yml'], needle)}`;
    const drift = async (name, o, want, summary) => tc(`T4 ${name}`, async () => {
      const g = await go(o);
      const ok = g.r.exit === 1 && g.ind('env').state === 'DRIFT' && same(g.ind('env').items, want) && othersOk(g, 'env') && (summary === undefined || g.ind('env').summary.includes(summary));
      return [ok, { items: items(g, 'env'), summary: g.ind('env') && g.ind('env').summary, ...shown(g) }];
    });
    const noFn1 = STAGING_DEFAULT.filter(s => s.name !== 'FN_ONE');
    const FN1_ITEM = { what: 'FN_ONE read in supabase/functions, not a staging function secret', where: FN1 };
    await drift('(a) FN_ONE missing from staging secrets is drift, with the counts in the summary', { staging: noFn1 }, [FN1_ITEM], '1 read and not set, 0 set and not read');
    await drift('(a) control: FN_ONE in the master env file does not excuse a function read', { staging: noFn1, env: { ...ENV_DEFAULT, FN_ONE: 'VALUE-ENV-5' } }, [FN1_ITEM]);
    await drift('(b) GH_SEC missing from the Actions secrets', { secrets: [] }, [{ what: 'GH_SEC read as secrets.GH_SEC, not an Actions secret', where: wfLine('secrets.GH_SEC') }]);
    await drift('(b) GH_VAR missing from the Actions variables', { vars: [] }, [{ what: 'GH_VAR read as vars.GH_VAR, not an Actions variable', where: wfLine('vars.GH_VAR') }]);
    await drift('(b) control: GH_SEC in the master env file does not excuse a workflow read', { secrets: [], env: { ...ENV_DEFAULT, GH_SEC: 'VALUE-ENV-5' } }, [{ what: 'GH_SEC read as secrets.GH_SEC, not an Actions secret', where: wfLine('secrets.GH_SEC') }]);
    const { TOOL_TWO, ...noTool2 } = ENV_DEFAULT; void TOOL_TWO;
    const { ALIAS_ONE, ...noAlias } = ENV_DEFAULT; void ALIAS_ONE;
    await drift('(c) TOOL_TWO missing from the env file (and set nowhere)', { env: noTool2 }, [{ what: 'TOOL_TWO read by code, set nowhere', where: 'tools/t.mjs:1' }]);
    // round 2 changed this case: ALIAS_ONE is not in the book's Secrets, so it is counted in the summary, never listed (rule 1)
    await tc('T4 (c) ALIAS_ONE missing (the env.X form is scanned) and not in the book: no item, the summary counts 1 optional name', async () => {
      const g = await go({ env: noAlias });
      return [g.r.exit === 0 && g.ind('env').state === 'OK' && g.ind('env').summary.includes(", 1 optional names read by scripts not in the book's Secrets list"), shown(g)];
    });
    await tc('T4 (c) a script name present only as an Actions secret is OK', async () => {
      const g = await go({ env: noTool2, secrets: ['GH_SEC', 'TOOL_TWO'] });
      return [g.r.exit === 0 && g.ind('env').state === 'OK', shown(g)];
    });
    await drift('(d) NOBODY set in the master env file, read nowhere', { env: { ...ENV_DEFAULT, NOBODY: '1' } }, [{ what: 'NOBODY set in the master env file, read nowhere', where: 'OMNIKOM_ENV_FILE' }], '0 read and not set, 1 set and not read');
    await drift('(d) STALE_SEC set as a staging function secret, read nowhere', { staging: [...STAGING_DEFAULT, { name: 'STALE_SEC', value: 'VALUE-API-4' }] }, [{ what: 'STALE_SEC set as a staging function secret, read nowhere', where: 'staging function secrets' }]);
    await drift('(d) OLD_SEC and OLD_VAR set in the Actions stores, read nowhere', { secrets: ['GH_SEC', 'OLD_SEC'], vars: ['GH_VAR', 'OLD_VAR'] },
      [{ what: 'OLD_SEC set as an Actions secret, read nowhere', where: 'Actions secrets' }, { what: 'OLD_VAR set as an Actions variable, read nowhere', where: 'Actions variables' }]);
    await tc('T4 (e) a provided name (SUPABASE_URL) is never an item: not set on staging, read in code; or set on staging, read nowhere', async () => {
      const provided = JSON.parse(readFileSync(join(CLI_ROOT, 'env-provided.json'), 'utf8'));
      const a = await go({ staging: STAGING_DEFAULT.filter(s => s.name !== 'SUPABASE_URL') });
      const noRead = makeRepo({ files: { 'supabase/functions/f/index.ts': "Deno.env.get('FN_ONE');\nDeno.env.get('FN_TWO');\nDeno.env.get(computed);\n" } });
      const b = await go({ repo: noRead });
      const ok = Array.isArray(provided.functions) && provided.functions.includes('SUPABASE_URL') && Array.isArray(provided.workflows) && provided.workflows.includes('GITHUB_TOKEN') && Array.isArray(provided.scripts)
        && a.r.exit === 0 && a.ind('env').state === 'OK' && b.r.exit === 0 && b.ind('env').state === 'OK';
      return [ok, [shown(a), shown(b), Object.keys(provided)]];
    });
    await drift('(e) TEST_ONLY (read only in a test path) and UNTRACKED_ONE (an untracked file) are not reads', { env: { ...ENV_DEFAULT, TEST_ONLY: '1', UNTRACKED_ONE: '1' } },
      [{ what: 'TEST_ONLY set in the master env file, read nowhere', where: 'OMNIKOM_ENV_FILE' }, { what: 'UNTRACKED_ONE set in the master env file, read nowhere', where: 'OMNIKOM_ENV_FILE' }]);
    // (f) archive/, docs/, icm/ and .md never count; comments never count; a /* inside a string hides nothing; a multi-line comment keeps the line numbers
    const extras = makeRepo({ files: {
      'archive/old.mjs': 'process.env.ARCHIVE_ONLY;\n',
      'docs/d.mjs': 'process.env.DOCS_ONLY;\n',
      'icm/i.mjs': 'process.env.ICM_ONLY;\n',
      'docs/x.md': 'process.env.MD_ONLY and Deno.env.get("MD_TWO")\n',
      'tools/win.mjs': 'const r = process.env.SystemRoot || process.env.ComSpec || process.env.Path;\n',   // mixed-case names are not read as their capitals (S, C, P)
      'tools/multi.mjs': '/* a\n   process.env.BLOCK_ONLY\n   comment */\nprocess.env.MULTI_LINE_ONE;\n// process.env.LINE_ONLY\n',
      'tools/t.mjs': "const a = '/* not a comment';\nprocess.env.TOOL_ONE; process.env['TOOL_TWO']; env.ALIAS_ONE;\nconst b = '*/';\nprocess.env[name];\nconst keys = ['DOC_ONLY'];\n",
      // round 2: MULTI_LINE_ONE is named in this repository's book, so that its line number is still checked
      'docs/product/4-backend.md': `${FILES['docs/product/4-backend.md'].replace('- `DOC_ONLY`\n', '- `DOC_ONLY`\n- `MULTI_LINE_ONE`\n')}`,
      '.github/workflows/w.yml': `${FILES['.github/workflows/w.yml']}# \${{ secrets.YAML_COMMENT }}\n`,
    } });
    await tc('T4 (f) archive/, docs/, icm/, .md files and comments never count; a /* inside a string does not hide the TOOL_ONE read; the line number survives a multi-line comment', async () => {
      const { TOOL_ONE, ...noTool1 } = ENV_DEFAULT; void TOOL_ONE;
      const g = await go({ repo: extras, env: noTool1 });
      const want = [{ what: 'MULTI_LINE_ONE read by code, set nowhere', where: 'tools/multi.mjs:4' }, { what: 'TOOL_ONE read by code, set nowhere', where: 'tools/t.mjs:2' }];
      const got = (items(g, 'env') || []).slice().sort((x, y) => (x.what < y.what ? -1 : 1));
      // round 2: the mixed-case reads of tools/win.mjs would be counted as optional names (S, C, P) if they were cut to their capitals
      return [g.r.exit === 1 && same(got, want) && !g.ind('env').summary.includes('optional names'), { got, summary: g.ind('env') && g.ind('env').summary }];
    });

    // ---------------- T4 round 2: the book decides, the API keys file, the production templates, mentions, optional function reads
    const BOOK = 'docs/product/4-backend.md';
    const noDocMention = makeRepo({ files: { 'tools/t.mjs': T_NO_DOC_MENTION } });
    const OPT = ", 1 optional names read by scripts not in the book's Secrets list";
    await tc('T4 R1 TOOL_TWO (in the book) removed from the env file is an item, ALIAS_ONE (not in the book) is counted and not listed, both removed: one item and 1 optional name', async () => {
      const { TOOL_TWO: a, ALIAS_ONE: b, ...none } = ENV_DEFAULT; void a; void b;
      const g = await go({ env: none });
      const e = g.ind('env');
      return [g.r.exit === 1 && same(e.items, [{ what: 'TOOL_TWO read by code, set nowhere', where: 'tools/t.mjs:1' }]) && e.summary.includes(OPT), { items: e.items, summary: e.summary }];
    });
    await tc('T4 R2 a name only in the API keys file satisfies a documented script read; an unread name there is set in the API keys file, read nowhere', async () => {
      const a = await go({ env: noTool2, apiKeys: ['TOOL_TWO'] });
      const b = await go({ apiKeys: ['API_ONLY'] });
      const ok = a.r.exit === 0 && a.ind('env').state === 'OK' && !a.ind('env').summary.includes('no API keys file')
        && b.r.exit === 1 && same(b.ind('env').items, [{ what: 'API_ONLY set in the API keys file, read nowhere', where: '.secrets/api-keys.env' }]);
      return [ok, [shown(a), shown(b)]];
    });
    await tc('T4 R2 no API keys file: the store is empty, the summary says no API keys file, never BLOCKED', async () => {
      const g = await go({});
      const w = await go({ env: noTool2 });
      return [g.ind('env').state === 'OK' && g.ind('env').summary.endsWith('no API keys file') && w.ind('env').state === 'DRIFT' && w.r.exit === 1, [shown(g), shown(w)]];
    });
    await tc('T4 R3 a name of the book Secrets that no code mentions is an item with the book line; a name outside the section is none', async () => {
      const g = await go({ repo: noDocMention });
      const e = g.ind('env');
      const line = lineOf(FILES[BOOK], 'DOC_ONLY');
      return [g.r.exit === 1 && same(e.items, [{ what: `DOC_ONLY is in ${BOOK} Secrets, mentioned by no code`, where: `${BOOK}:${line}` }]), { items: e.items, summary: e.summary }];
    });
    await tc('T4 R3 a book without a Secrets heading, or no book: BLOCKED for env', async () => {
      const a = await go({ repo: makeRepo({ files: { [BOOK]: '# Backend\n\n`TOOL_ONE`\n' } }) });
      const b = await go({ repo: makeRepo({ files: { [BOOK]: null } }) });
      const ok = [a, b].every(g => g.r.exit === 3 && g.ind('env').state === 'BLOCKED' && g.ind('env').summary.includes(BOOK) && g.ind('env').unblock) && a.ind('env').summary.includes('Secrets');
      return [ok, [shown(a), shown(b)]];
    });
    await tc('T4 R4 a name of .github/production is not an item and the summary counts it', async () => {
      const a = await go({});
      const b = await go({ repo: makeRepo({ files: { '.github/production/p.yml': 'jobs:\n  j:\n    steps:\n      - run: echo ${{ secrets.PROD_SEC }} ${{ vars.PROD_VAR }}\n' } }) });
      const ok = a.ind('env').state === 'OK' && a.ind('env').summary.includes(', 1 names of .github/production not checked (no production repository yet)')
        && b.ind('env').state === 'OK' && b.ind('env').summary.includes(', 2 names of .github/production not checked (no production repository yet)');
      return [ok, [a.ind('env'), b.ind('env')]];
    });
    await tc('T4 R5 a set name mentioned only as a quoted string in tracked code is not read nowhere; only in a comment, it is', async () => {
      const quoted = makeRepo({ files: { 'tools/m.mjs': "const list = ['MENTIONED_ONE'];\n" } });
      const commented = makeRepo({ files: { 'tools/m.mjs': '// MENTIONED_ONE\nconst x = 1;\n' } });
      const env = { ...ENV_DEFAULT, MENTIONED_ONE: '1' };
      const a = await go({ repo: quoted, env });
      const b = await go({ repo: commented, env });
      const ok = a.r.exit === 0 && a.ind('env').state === 'OK' && b.r.exit === 1 && same(b.ind('env').items, [{ what: 'MENTIONED_ONE set in the master env file, read nowhere', where: 'OMNIKOM_ENV_FILE' }]);
      return [ok, [shown(a), shown(b)]];
    });
    await tc('T4 R6 a function read listed in optional.functions (with a reason) is not an item; one not listed is; the three platform names are provided', async () => {
      const provided = JSON.parse(readFileSync(join(CLI_ROOT, 'env-provided.json'), 'utf8'));
      const opt = provided.optional && provided.optional.functions;
      const fn = `${FILES['supabase/functions/f/index.ts']}Deno.env.get('GITHUB_API_BASE');\nDeno.env.get('RESEND_WEBHOOK_SECRET');\n`;
      const g = await go({ repo: makeRepo({ files: { 'supabase/functions/f/index.ts': fn } }) });
      const shape = opt && typeof opt === 'object' && ['GITHUB_API_BASE', 'GITHUB_DISPATCH_TOKEN_V2', 'JWKS_URL', 'SUPABASE_SECRET_KEY'].every(n => typeof opt[n] === 'string' && opt[n].length > 10)
        && !('RESEND_WEBHOOK_SECRET' in opt) && !('GOOGLE_SERVICE_ACCOUNT_JSON' in opt) && ['SUPABASE_JWKS', 'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_SECRET_KEYS'].every(n => provided.functions.includes(n));
      const ok = shape && g.r.exit === 1 && same(g.ind('env').items, [{ what: 'RESEND_WEBHOOK_SECRET read in supabase/functions, not a staging function secret', where: 'supabase/functions/f/index.ts:6' }]);
      return [ok, { shape: !!shape, items: g.ind('env').items }];
    });

    // ---------------- T5 BLOCKED
    const blocked = async (name, o, mustSay) => tc(`T5 ${name}`, async () => {
      const g = await go({ stub: { lines: ['PROOF line 3: x'], code: 1 }, ...o });
      const e = g.ind('env');
      const ok = g.r.exit === 3 && g.r.json.code === 'BLOCKED' && e.state === 'BLOCKED' && typeof e.unblock === 'string' && e.unblock !== '' && String(e.summary).includes(mustSay)
        && g.ind('proof').state === 'DRIFT' && othersOk(g, 'env', 'proof');
      return [ok, { env: e, states: states(g), exit: g.r.exit }];
    });
    await tc('T5 no OMNIKOM_ENV_FILE: the exact BLOCKED line, the other nine shown, exit 3 although proof drifts', async () => {
      const g = await go({ envFile: false, stub: { lines: ['PROOF line 3: x'], code: 1 }, text: true });
      const lines = statusLines(g);
      return [g.r.exit === 3 && lines.length === 10 && lines[6] === 'BLOCKED env: OMNIKOM_ENV_FILE is not set (unblocks: run it through tools/with-env.mjs with the master env file)' && lines[1].startsWith('DRIFT proof: '), { lines, exit: g.r.exit }];
    });
    await blocked('the env file named is absent', { envPath: join(root, 'no-such.env') }, 'OMNIKOM_ENV_FILE');
    await blocked('the env file named is a folder', { envPath: root }, 'OMNIKOM_ENV_FILE');
    await blocked('no SUPABASE_ACCESS_TOKEN', { token: false }, 'SUPABASE_ACCESS_TOKEN');
    await blocked('no STAGING_SUPABASE_REF', { ref: false }, 'STAGING_SUPABASE_REF');
    await blocked('the secrets request answers 500', { fetchStatus: 500, fetchBody: 'boom' }, '500');
    await blocked('the secrets request throws', { fetchThrows: true }, 'network down');
    await blocked('the secrets answer is not a list of names', { fetchBody: '{"message":"no"}' }, 'secrets');
    await blocked('gh is not installed (the secret list)', { ghFail: 'secret' }, 'gh is not installed');
    await blocked('gh is not installed (the variable list)', { ghFail: 'variable' }, 'gh is not installed');
    await blocked('gh answers something that is not a list', { ghBody: '{"x":1}' }, 'gh');
    await blocked('no backup-gh remote to name the repository', { repo: makeRepo({ remote: false }) }, 'backup-gh');
    await tc('T5 a folder that is no repository: git ls-files fails, env, worktrees and the six checks are BLOCKED, the staging pair is still read', async () => {
      const bare = join(root, 'not-a-repo');
      mkdirSync(bare, { recursive: true });
      const g = await go({ repo: bare });
      const blockedIds = ['book', 'proof', 'callers', 'config', 'state', 'index', 'env', 'worktrees'];
      return [g.r.exit === 3 && blockedIds.every(id => g.ind(id).state === 'BLOCKED') && g.ind('staging-migrations').state === 'OK' && g.ind('staging-functions').state === 'OK', shown(g)];
    });
    await tc('T5 exit: DRIFT with a BLOCKED env is 3, the same DRIFT with nothing BLOCKED is 1', async () => {
      const a = await go({ envFile: false, stub: { lines: ['PROOF line 3: x'], code: 1 } });
      const b = await go({ stub: { lines: ['PROOF line 3: x'], code: 1 } });
      return [a.r.exit === 3 && b.r.exit === 1 && b.r.json.code === 'DRIFT', [shown(a), shown(b)]];
    });

    // ---------------- T6 staging
    const withMig = m => ({ ...CLEAN_STATUS, data: { ...CLEAN_STATUS.data, migrations: { ...CLEAN_STATUS.data.migrations, ...m } } });
    const withFn = f => ({ ...CLEAN_STATUS, data: { ...CLEAN_STATUS.data, functions: f } });
    const stagingCase = (name, status, id, state, wantItems, say) => tc(`T6 ${name}`, async () => {
      const g = await go({ status });
      const x = g.ind(id);
      const exit = state === 'DRIFT' ? 1 : state === 'BLOCKED' ? 3 : 0;
      const ok = g.r.exit === exit && x.state === state && (wantItems === undefined || same(x.items, wantItems)) && (say === undefined || String(x.summary).includes(say));
      return [ok, { x, exit: g.r.exit, states: states(g) }];
    });
    await stagingCase('a pending migration is drift', withMig({ pending: ['m4'] }), 'staging-migrations', 'DRIFT', [{ what: 'm4 is pending on staging', where: 'supabase/migrations/m4' }]);
    await stagingCase('a migration that differs from the ledger is drift', withMig({ mismatched: ['m2'] }), 'staging-migrations', 'DRIFT', [{ what: 'm2 differs from the ledger', where: 'supabase/migrations/m2' }]);
    await stagingCase('a migration in the database and not in the tree is drift', withMig({ unknownInDatabase: ['m9'] }), 'staging-migrations', 'DRIFT', [{ what: 'm9 is in the database and not in the tree', where: 'staging ledger' }]);
    await stagingCase('a function not deployed is drift', withFn({ checked: true, f: 'not deployed' }), 'staging-functions', 'DRIFT', [{ what: 'f is in the tree and not deployed', where: 'supabase/functions/f' }]);
    await stagingCase('an unreachable function is BLOCKED, never OK', withFn({ checked: true, f: 'unreachable' }), 'staging-functions', 'BLOCKED');
    await stagingCase('a disabled function is ignored', withFn({ checked: true, f: 'disabled' }), 'staging-functions', 'OK', []);
    await stagingCase('functions not checked is BLOCKED', withFn({ checked: false, reason: 'no functions URL' }), 'staging-functions', 'BLOCKED', undefined, 'no functions URL');
    await tc('T6 a staging that did not answer: both indicators BLOCKED with the error text, exit 3', async () => {
      const g = await go({ status: { ok: false, code: 'CONNECT', data: { reachable: false, error: 'connection refused by host x' } } });
      const both = ['staging-migrations', 'staging-functions'].every(id => g.ind(id).state === 'BLOCKED' && g.ind(id).summary.includes('connection refused by host x') && g.ind(id).unblock);
      return [g.r.exit === 3 && both && othersOk(g, 'staging-migrations', 'staging-functions'), shown(g)];
    });
    await tc('T6 a status that throws Blocked: both BLOCKED with its message and its unblock', async () => {
      const { Blocked } = await import(pathToFileURL(join(CLI_ROOT, 'lib', 'errors.mjs')).href);
      const g = await go({ status: async () => { throw new Blocked('STAGING_DB_URL is not set (planted)', 'set STAGING_DB_URL (planted)'); } });
      const both = ['staging-migrations', 'staging-functions'].every(id => g.ind(id).state === 'BLOCKED' && g.ind(id).summary.includes('STAGING_DB_URL is not set (planted)') && g.ind(id).unblock === 'set STAGING_DB_URL (planted)');
      return [g.r.exit === 3 && both, shown(g)];
    });
    await tc('T6 without the fake, the real status is used: no STAGING_DB_URL gives both BLOCKED naming it (no spawn)', async () => {
      const g = await go({ realStatus: true });
      const both = ['staging-migrations', 'staging-functions'].every(id => g.ind(id).state === 'BLOCKED' && g.ind(id).summary.includes('STAGING_DB_URL'));
      return [g.r.exit === 3 && both, shown(g)];
    });

    // ---------------- T7 worktrees, against real git
    const addWt = (repo, name, detach = false) => {
      const p = join(root, `${repo.slice(-6)}-wt-${name}`);
      git(repo, detach ? ['worktree', 'add', '-q', '--detach', p] : ['worktree', 'add', '-q', '-b', name, p]);
      return p;
    };
    const commitIn = (dir, file, text, epoch, msg = 'work') => { put(dir, file, text); git(dir, ['add', '-A']); git(dir, ['commit', '-q', '-m', msg], at(epoch)); };
    const wItems = g => (items(g, 'worktrees') || []).map(i => i.what).sort();
    const OLD = NOW - 10 * DAY;
    const w1 = makeRepo({ date: OLD });
    const dirs1 = { leftover: addWt(w1, 'leftover'), fresh: addWt(w1, 'fresh'), old: addWt(w1, 'old'), dirty: addWt(w1, 'dirty'), gone: addWt(w1, 'gone'), det: addWt(w1, 'det', true) };
    commitIn(dirs1.fresh, 'f.txt', 'fresh\n', NOW);
    commitIn(dirs1.old, 'o.txt', 'old\n', OLD);
    put(dirs1.dirty, 'u.txt', 'uncommitted\n');
    rmSync(dirs1.gone, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    await tc('T7 leftovers, old work, a dirty worktree, a missing folder and a detached one are drift; fresh work is not; the main checkout is never listed', async () => {
      const g = await go({ repo: w1 });
      const want = [
        'leftover: branch (detached), every commit is in master',
        'leftover: branch gone, folder missing',
        'leftover: branch leftover, every commit is in master',
        'work not in master: branch dirty, 0 commits not in master, 1 uncommitted file, last commit 10 days ago',
        'work not in master: branch old, 1 commit not in master, 0 uncommitted files, last commit 10 days ago',
      ].sort();
      const wheres = (items(g, 'worktrees') || []).filter(i => i.what.includes('branch leftover') || i.what.includes('branch old')).map(i => norm(i.where)).sort();
      const ok = g.r.exit === 1 && g.ind('worktrees').state === 'DRIFT' && same(wItems(g), want) && same(wheres, [norm(dirs1.leftover), norm(dirs1.old)].sort())
        && g.ind('worktrees').summary.includes('1 worktree with work in flight') && !wItems(g).some(w => w.includes('fresh')) && !(items(g, 'worktrees') || []).some(i => norm(i.where) === norm(w1));
      return [ok, { items: items(g, 'worktrees'), summary: g.ind('worktrees') && g.ind('worktrees').summary }];
    });
    const w2 = makeRepo();
    commitIn(addWt(w2, 'fresh'), 'f.txt', 'fresh\n', NOW);
    await tc('T7 only a fresh worktree: OK, and the summary says 1 worktree with work in flight', async () => {
      const g = await go({ repo: w2 });
      return [g.r.exit === 0 && g.ind('worktrees').state === 'OK' && g.ind('worktrees').summary.includes('1 worktree with work in flight') && same(items(g, 'worktrees'), []), shown(g)];
    });
    const w3 = makeRepo();
    commitIn(addWt(w3, 'sq'), 's.txt', 'same\n', NOW, 'sq work');
    put(w3, 's.txt', 'same\n'); git(w3, ['add', '-A']); git(w3, ['commit', '-q', '-m', 'squash land'], at(NOW));
    git(w3, ['update-ref', 'refs/remotes/backup-gh/master', 'master']);
    await tc('T7 a branch merged by squash (same patch, another commit) is a leftover', async () => {
      const g = await go({ repo: w3 });
      return [g.r.exit === 1 && same(wItems(g), ['leftover: branch sq, every commit is in master']), { items: items(g, 'worktrees') }];
    });
    const w4 = makeRepo();
    const bx = addWt(w4, 'bx');
    commitIn(bx, 'b.txt', 'b\n', OLD);
    const bxSha = git(bx, ['rev-parse', 'HEAD']);
    git(w4, ['update-ref', 'refs/remotes/backup-gh/master', bxSha]);
    await tc('T7 the baseline is backup-gh/master: a commit in it but not in local master is in master; its sha is data.master; move the ref and the verdict changes', async () => {
      const a = await go({ repo: w4 });
      git(w4, ['update-ref', '-d', 'refs/remotes/backup-gh/master']);
      const b = await go({ repo: w4 });
      const ok = same(wItems(a), ['leftover: branch bx, every commit is in master']) && a.r.json.data.master === bxSha.slice(0, 8)
        && same(wItems(b), ['work not in master: branch bx, 1 commit not in master, 0 uncommitted files, last commit 10 days ago']) && b.ind('worktrees').summary.includes('baseline master') && !b.ind('worktrees').summary.includes('backup-gh')
        && b.r.json.data.master === git(w4, ['rev-parse', 'master']).slice(0, 8);
      return [ok, { a: wItems(a), b: wItems(b), summary: b.ind('worktrees').summary }];
    });
    await tc('T7 neither backup-gh/master nor master: BLOCKED, data.master null', async () => {
      const g = await go({ repo: makeRepo({ branch: 'trunk' }) });
      return [g.r.exit === 3 && g.ind('worktrees').state === 'BLOCKED' && g.r.json.data.master === null, shown(g)];
    });

    // ---------------- T8 no value is ever printed
    await tc('T8 no value (master env file, staging secrets, gh updated_at) reaches any output, JSON or text, in a clean, a drift and a BLOCKED run', async () => {
      const planted = JSON.stringify(STAGING_DEFAULT);
      const control = planted.includes('VALUE-API-1') && planted.includes('VALUE-API-3') && Object.values(ENV_DEFAULT).every(v => /^VALUE-ENV-\d$/.test(v));
      const runs = [];
      for (const text of [false, true]) {
        const extra = { ghExtra: { updated_at: 'UPDATED-AT-XYZ' }, text };
        runs.push(await go({ ...extra }));
        runs.push(await go({ ...extra, staging: noFn1, env: { ...ENV_DEFAULT, NOBODY: 'VALUE-ENV-9' } }));
        runs.push(await go({ ...extra, fetchStatus: 500, fetchBody: JSON.stringify(STAGING_DEFAULT) }));
        runs.push(await go({ ...extra, envFile: false }));
      }
      const all = runs.map(g => g.r.all).join('\n');
      const leaked = /VALUE-ENV-|VALUE-API-|UPDATED-AT-XYZ/.exec(all);
      const gotData = runs.every(g => (g.r.json ? Array.isArray(g.r.json.data && g.r.json.data.indicators) : statusLines(g).length === 10));   // a run that printed an error proves nothing
      return [control && !leaked && gotData && !all.includes('sbp_TESTTOKEN'), { leaked: leaked && leaked[0], control }];
    });

    // ---------------- T9 shape
    await tc('T9 shape: a DRIFT run has ok false, command truth, code DRIFT, exit 1, data.master (8 characters), items with what and where, unblock only on BLOCKED; text and JSON carry the same items', async () => {
      const lines = ['PROOF line 3: x', 'STALE icm/index.json: i'];
      const g = await go({ stub: { lines, code: 1 }, staging: noFn1 });
      const t = await go({ text: true, stub: { lines, code: 1 }, staging: noFn1 });
      const d = g.r.json.data;
      const shape = g.r.json.ok === false && g.r.json.command === 'truth' && g.r.json.code === 'DRIFT' && g.r.json.exit === 1 && d.master === baseSha8 && /^[0-9a-f]{8}$/.test(d.master)
        && d.indicators.every(x => typeof x.id === 'string' && ['OK', 'DRIFT', 'BLOCKED'].includes(x.state) && typeof x.summary === 'string' && Array.isArray(x.items) && x.items.every(i => typeof i.what === 'string' && typeof i.where === 'string') && !('unblock' in x));
      const count = d.indicators.reduce((n, x) => n + x.items.length, 0);
      const textItems = t.r.stdout.split('\n').filter(l => l.startsWith('  - ')).length;
      return [shape && count === 3 && textItems === count && t.r.exit === 1, { shape, count, textItems }];
    });

    // ---------------- T10 an exit with data
    await tc('T10 a result that carries exit 3 keeps its data in the JSON object (the one line in omnikom.mjs)', async () => {
      const g = await go({ envFile: false });
      return [g.r.exit === 3 && g.r.json.exit === 3 && Array.isArray(g.r.json.data && g.r.json.data.indicators) && g.r.json.data.indicators.length === 10, shown(g)];
    });

    // ---------------- T11 wiring
    await tc('T11 wiring: help lists the truth usage line; registry.json engines equals the commands/*.mjs files and holds truth', async () => {
      const h = await cli(['help', '--json'], {});
      const reg = JSON.parse(readFileSync(join(CLI_ROOT, 'registry.json'), 'utf8'));
      const files = readdirSync(join(CLI_ROOT, 'commands')).filter(f => f.endsWith('.mjs')).map(f => f.slice(0, -4)).sort();
      const ok = h.json.usage.some(l => l.startsWith('truth [--json]')) && same([...reg.engines].sort(), files) && reg.engines.includes('truth');
      return [ok, { engines: reg.engines.length, files: files.length }];
    });
  } finally {
    if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = ceiling;
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

// run alone: node tools/omnikom-cli/test/truth.mjs [--bail] [--time]   (OMNIKOM_CLI_DIR points it at a copy of the CLI, as for run.mjs)
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
  await truthTests({ check, cli, CLI_ROOT: cliDir, REPO_ROOT: repoRoot, lib: f => at(join('lib', f)) });
  const c = counts();
  say(`${c.total - c.failed} of ${c.total} checks passed, ${c.failed} FAILED\n`);
  process.exit(c.failed ? 1 : 0);
}
