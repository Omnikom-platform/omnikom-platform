// Tests for tools/deploy-functions.mjs (book row C15): the order of the function deploys, the exit codes, the name checks, the scrub of the
// output, the temp env file and the names-only secrets list. The Supabase CLI is a fake node script (SUPABASE_SCRIPT, for tests only) that
// records every call: nothing is deployed and nothing leaves this machine. Every value is a test string.
//   node tools/test/test-deploy-functions.mjs              the cases (the gate); DEPLOY_TEST_REPO=<folder> runs them against a copy there
//   node tools/test/test-deploy-functions.mjs --mutants    the same cases against seven broken copies; each must turn its named case red
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SELF = fileURLToPath(import.meta.url);
const HERE_REPO = resolve(dirname(SELF), '..', '..');

// [name, the case that must go red, the text that must occur exactly once in the tool, its replacement]
const MUTANTS = [
  ['B1 the CLI runs outside the repository root', 'T1', 'cwd: ROOT', 'cwd: tmpdir()'],
  ['B2 a failed deploy is not counted', 'T2', 'deploy exit $' + '{r.status}' + String.fromCharCode(96) + ');\n    if (r.status !== 0) failed++;', 'deploy exit $' + '{r.status}' + String.fromCharCode(96) + ');'],
  ['B3 any function name is taken', 'T3', 'const FN = /^[a-z0-9]+(-[a-z0-9]+)*$/;', 'const FN = /^[A-Za-z0-9_-]+$/;'],
  ['B4 the token is not scrubbed', 'T7', ".split(token).join('<token>')", ''],
  ['B5 the temp env file is left behind', 'T8', 'rmSync(dir, { recursive: true, force: true });', ''],
  ['B6 --set takes the access token', 'T5', "const SET_OK = ['GITHUB_REPO', ", "const SET_OK = ['SUPABASE_ACCESS_TOKEN', 'GITHUB_REPO', "],
  ['B7 the secrets list prints the digest', 'T9', "x.split('|')[0].trim()", 'x.trim()'],
];

function mutants() {
  const source = readFileSync(join(HERE_REPO, 'tools', 'deploy-functions.mjs'), 'utf8').replace(/\r\n/g, '\n');
  const scratch = mkdtempSync(join(tmpdir(), 'omnikom-deploy-mutant-'));
  const survivors = [];
  try {
    mkdirSync(join(scratch, 'tools'), { recursive: true });
    mkdirSync(join(scratch, 'supabase', 'auth-emails'), { recursive: true });
    copyFileSync(join(HERE_REPO, 'supabase', 'auth-emails', 'emails.json'), join(scratch, 'supabase', 'auth-emails', 'emails.json'));
    const runCopy = text => {
      writeFileSync(join(scratch, 'tools', 'deploy-functions.mjs'), text, 'utf8');
      const r = spawnSync(process.execPath, ['--max-old-space-size=256', SELF], { encoding: 'utf8', timeout: 200000, windowsHide: true, env: { ...process.env, DEPLOY_TEST_REPO: scratch } });
      return { code: r.status, lines: String(r.stdout).split(/\r?\n/) };
    };
    // control: the unbroken copy is green, so a red below comes from the break and not from the copy
    const control = runCopy(source);
    if (control.code !== 0) { console.log(control.lines.join('\n')); console.log('DEPLOY FUNCTIONS MUTANTS: the unbroken copy is not green, nothing was measured'); return 1; }
    for (const [name, wanted, from, to] of MUTANTS) {
      const count = source.split(from).length - 1;
      if (count !== 1) { console.log('SURVIVED ' + name + ': its target text occurs ' + count + ' times, not once'); survivors.push(name); continue; }
      const r = runCopy(source.replace(from, () => to));
      const at = r.lines.findIndex(l => l.startsWith('FAIL ' + wanted + ' '));
      if (r.code === 1 && at >= 0) console.log('caught ' + name + ': ' + r.lines[at].slice(0, 90) + ' | ' + (r.lines[at + 1] || '').trim().slice(0, 120));
      else { console.log('SURVIVED ' + name + ': ' + wanted + ' did not go red (exit ' + r.code + ')'); survivors.push(name); }
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  console.log('DEPLOY FUNCTIONS MUTANTS: ' + (MUTANTS.length - survivors.length) + ' of ' + MUTANTS.length + ' caught' + (survivors.length ? '; survived: ' + survivors.join(', ') : ''));
  return survivors.length ? 1 : 0;
}

function cases() {
  const REPO = resolve(process.env.DEPLOY_TEST_REPO || HERE_REPO);
  const TOOL = join(REPO, 'tools', 'deploy-functions.mjs');
  const REF = 'abcdefghijklmnopqrst', TOKEN = 'sbp_test_token_not_real', SECRET = 'secret-value-123456';
  const work = mkdtempSync(join(tmpdir(), 'omnikom-deploy-fn-'));
  const toolTmp = join(work, 'tmp');   // the tool's own temp folder, so a file it leaves behind goes away with the work folder
  mkdirSync(toolTmp);
  const FAKE = join(work, 'fake-supabase.mjs');
  writeFileSync(FAKE, [
    "import { appendFileSync, readFileSync, existsSync } from 'node:fs';",
    'const argv = process.argv.slice(2);',
    "const i = argv.indexOf('--env-file');",
    'const envFilePath = i >= 0 ? argv[i + 1] : null;',
    'const envFileExisted = envFilePath !== null && existsSync(envFilePath);',
    "const envFile = envFileExisted ? readFileSync(envFilePath, 'utf8') : null;",
    'const token = process.env.SUPABASE_ACCESS_TOKEN;',
    "const printed = process.env.FAKE_LEAK === '1' ? ['token ' + token, 'ref ' + process.env.STAGING_SUPABASE_REF, (envFile || '').trim()].filter(Boolean).join('\\n') : '';",
    "appendFileSync(process.env.FAKE_RECORD, JSON.stringify({ argv, cwd: process.cwd(), token, envFile, envFilePath, envFileExisted, printed }) + '\\n');",
    'if (printed) console.log(printed);',
    "if (argv[0] === 'secrets' && argv[1] === 'list') console.log('GITHUB_REPO | 0123abcd0123abcd');",
    "process.exit(process.env.FAKE_FAIL_ON && argv.join(' ').startsWith(process.env.FAKE_FAIL_ON) ? 3 : 0);"].join('\n') + '\n');

  let n = 0;
  const every = [];   // every call of every run, for T10
  // env: values for this run; a name given as undefined is taken out
  const run = (args, env = {}) => {
    const rec = join(work, 'record-' + (++n) + '.jsonl');
    const full = { ...process.env };
    for (const k of ['GITHUB_REPO', 'GITHUB_DISPATCH_TOKEN', 'LEAD_ALERT_FROM', 'FAKE_FAIL_ON', 'FAKE_LEAK']) delete full[k];
    Object.assign(full, { STAGING_SUPABASE_REF: REF, SUPABASE_ACCESS_TOKEN: TOKEN, SUPABASE_SCRIPT: FAKE, FAKE_RECORD: rec, TMP: toolTmp, TEMP: toolTmp, TMPDIR: toolTmp }, env);
    for (const k of Object.keys(full)) if (full[k] === undefined) delete full[k];
    const r = spawnSync(process.execPath, ['--max-old-space-size=256', TOOL, ...args], { encoding: 'utf8', timeout: 60000, windowsHide: true, env: full });
    const calls = existsSync(rec) ? readFileSync(rec, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
    every.push(...calls);
    const out = String(r.stdout).replace(/\r\n/g, '\n'), err = String(r.stderr).replace(/\r\n/g, '\n');
    return { code: r.status, out, err, all: out + err, lines: out.split('\n'), calls, set: calls.find(c => c.argv[0] === 'secrets' && c.argv[1] === 'set') };
  };
  const results = [];
  const t = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: ok ? '' : String(detail).slice(0, 800) });
  const show = r => 'exit ' + r.code + ', calls ' + JSON.stringify(r.calls.map(c => c.argv.join(' '))) + '\n' + r.all;
  const refused = r => r.code === 2 && r.calls.length === 0;
  const real = p => realpathSync.native(p);
  const envLines = r => (r.set && r.set.envFile ? r.set.envFile.split('\n') : []);
  const deploy = f => 'functions deploy ' + f + ' --project-ref ' + REF;

  try {
    const one = run(['--functions', 'save,publish', '--deploy-only']);
    t('T1 --deploy-only: each named function is deployed in order from the repository root with the token, and no secrets call is made',
      one.code === 0 && JSON.stringify(one.calls.map(c => c.argv.join(' '))) === JSON.stringify([deploy('save'), deploy('publish')])
      && one.lines.includes('OK: save deployed') && one.lines.includes('OK: publish deployed')
      && one.calls.every(c => real(c.cwd) === real(REPO) && c.token === TOKEN),
      'cwd ' + JSON.stringify(one.calls.map(c => c.cwd)) + ', ' + show(one));

    const two = run(['--functions', 'save,publish,lead-update', '--deploy-only'], { FAKE_FAIL_ON: 'functions deploy publish' });
    t('T2 one failed deploy: the run exits 1 and names it, and the others are still deployed',
      two.code === 1 && two.lines.includes('FAIL: publish deploy exit 3') && two.lines.includes('OK: save deployed') && two.lines.includes('OK: lead-update deployed') && two.calls.length === 3, show(two));

    const taken = ['Save', 'save_it', '../x', 'a b', 'save;x', '-x', 'x-', 'a--b'].map(name => [name, run(['--functions', name, '--deploy-only'])])
      .filter(([name, r]) => !(refused(r) && r.err.trim() === 'not a function name: ' + name));
    const good = run(['--functions', 'lead-update', '--deploy-only']);
    t('T3 a wrong function name is refused (exit 2, named, the CLI never called); lead-update is taken',
      taken.length === 0 && good.code === 0 && good.calls.length === 1, taken.map(([name, r]) => name + ': ' + show(r)).join('\n') + '\ncontrol ' + show(good));

    const bare = run(['--deploy-only']);
    const noRef = run(['--functions', 'save'], { STAGING_SUPABASE_REF: undefined });
    const noToken = run(['--functions', 'save'], { SUPABASE_ACCESS_TOKEN: undefined });
    t('T4 no functions named, or the ref or the token missing: exit 2, the CLI never called, neither value printed',
      refused(bare) && bare.err.startsWith('usage:') && [noRef, noToken].every(r => refused(r) && !r.all.includes(REF) && !r.all.includes(TOKEN)),
      show(bare) + '\n' + show(noRef) + '\n' + show(noToken));

    const wrongSet = ['SUPABASE_ACCESS_TOKEN=x', 'github_repo=x', 'GITHUB_REPO'].map(v => [v, run(['--secrets-only', '--set', v])]).filter(([, r]) => !refused(r));
    const wins = run(['--secrets-only', '--secrets', 'GITHUB_REPO', '--set', 'GITHUB_REPO=cli/value'], { GITHUB_REPO: 'env/value' });
    t('T5 --set takes only the listed non-secret names as NAME=value, and the command line wins over the environment',
      wrongSet.length === 0 && wins.code === 0 && envLines(wins).includes('GITHUB_REPO=cli/value'),
      wrongSet.map(([v, r]) => v + ': ' + show(r)).join('\n') + '\ncontrol ' + JSON.stringify(wins.set) + ' ' + show(wins));

    const badNames = ['lower', 'A B'].map(v => run(['--secrets-only', '--secrets', v]));
    const partly = run(['--secrets-only'], { GITHUB_REPO: 'env/value' });
    t('T6 a wrong secret name is refused; a secret missing in the environment is named NOT SET and left out, never invented',
      badNames.every(refused) && partly.code === 0 && partly.lines.includes('NOT SET (missing in the env): GITHUB_DISPATCH_TOKEN')
      && envLines(partly).includes('GITHUB_REPO=env/value') && !envLines(partly).some(l => l.startsWith('GITHUB_DISPATCH_TOKEN=')),
      badNames.map(show).join('\n') + '\n' + JSON.stringify(partly.set) + ' ' + show(partly));

    const leak = run(['--functions', 'save', '--secrets', 'GITHUB_DISPATCH_TOKEN'], { FAKE_LEAK: '1', GITHUB_DISPATCH_TOKEN: SECRET });
    const printed = leak.calls.map(c => c.printed).join('\n');
    t('T7 what the CLI prints is scrubbed of the token, the project ref and the secret value',
      [TOKEN, REF, SECRET].every(v => printed.includes(v) && !leak.all.includes(v)) && ['<token>', '<project ref>', '<value>'].every(v => leak.out.includes(v)), show(leak));

    const sent = run(['--secrets-only', '--secrets', 'GITHUB_DISPATCH_TOKEN'], { GITHUB_DISPATCH_TOKEN: SECRET });
    const broke = run(['--secrets-only', '--secrets', 'GITHUB_DISPATCH_TOKEN'], { GITHUB_DISPATCH_TOKEN: SECRET, FAKE_FAIL_ON: 'secrets set' });
    const gone = r => Boolean(r.set) && r.set.envFileExisted && !existsSync(r.set.envFilePath);
    t('T8 the temp env file is there while the CLI runs and gone afterwards, after a failed set too (exit 1)',
      sent.code === 0 && gone(sent) && broke.code === 1 && broke.lines.includes('FAIL: secrets exit 3') && gone(broke),
      'left behind: ' + [sent, broke].map(r => r.set && existsSync(r.set.envFilePath)).join(' ') + ', ' + show(sent) + '\n' + show(broke));

    t('T9 the secrets list shows names only, never the digest',
      sent.out.includes('secrets on the project (names only):\n  GITHUB_REPO\n') && !sent.all.includes('0123abcd0123abcd'), show(sent));

    const carried = every.filter(c => c.argv.some(a => a.includes(TOKEN) || a.includes(SECRET)));
    t('T10 no secret travels on a command line: no argument of any call holds the token or the secret value',
      every.length > 0 && carried.length === 0, every.length + ' calls, ' + carried.length + ' with a secret');
  } finally { rmSync(work, { recursive: true, force: true }); }
  for (const r of results) console.log((r.ok ? 'ok   ' : 'FAIL ') + r.name + (r.ok ? '' : '\n     ' + r.detail.replace(/\n/g, '\n     ')));
  const failed = results.filter(r => !r.ok).length;
  console.log(failed ? 'DEPLOY FUNCTIONS TOOL TESTS FAILED: ' + failed + ' of ' + results.length : 'DEPLOY FUNCTIONS TOOL TESTS OK: ' + results.length + ' checks');
  return failed ? 1 : 0;
}

process.exit(process.argv.includes('--mutants') ? mutants() : cases());
