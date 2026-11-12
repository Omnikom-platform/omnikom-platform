// Tests for supabase/ops/inbox-state.mjs with planted logins, workspaces, sites and members on a throwaway local cluster (the real
// migrations, so the tables are the real ones). Nothing here needs an account and nothing touches staging: the cluster's URL names host
// 127.0.0.1, which is passed as the staging ref so that stagingDbUrl (supabase/tests/e2e-cleanup.mjs) accepts it; the guard itself is
// tested in supabase/tests/e2e-cleanup.test.mjs.
//   node supabase/ops/test/inbox-state.test.mjs              the suite (10 checks)
//   node supabase/ops/test/inbox-state.test.mjs --mutants    the suite, then every MUTANT (one fault seeded in a copy): each must go red for the named check
// Exit 0 = every check passed (and, with --mutants, every mutant was caught).
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { startCluster, loadPlatform } from './cluster.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL = resolve(HERE, '..', 'inbox-state.mjs');
const IMPORTS = [   // the three imports of the script, rewritten to file URLs in a mutant copy that lives in the temp folder
  ["'./promote-check.mjs'", pathToFileURL(resolve(HERE, '..', 'promote-check.mjs')).href],
  ["'../tests/e2e-cleanup.mjs'", pathToFileURL(resolve(HERE, '..', '..', 'tests', 'e2e-cleanup.mjs')).href],
  ["'../../tools/omnikom-cli/lib/sql.mjs'", pathToFileURL(resolve(HERE, '..', '..', '..', 'tools', 'omnikom-cli', 'lib', 'sql.mjs')).href],
];
let script = REAL;
const work = mkdtempSync(join(tmpdir(), 'omnikom-inboxstate-test-'));

const ID = suffix => `00000000-0000-0000-0000-000000000${suffix}`;
const SITE_B = `insert into sites (id, workspace_id, deploy_target, preview_host, lead_alert_to) values
  ('${ID('0b1')}', '${ID('0b0')}', 'worker-b', 'b-preview.example.test', array['confirmed@example.com', 'other@example.com']);`;
const USAGE = 'usage: inbox-state.mjs --email <address> (one address; it is never printed)';

let C;
function plant() {   // once, before the first suite(): the suite and every mutant read the same rows (check 5 puts back what it removes)
  C.sql(`insert into auth.users (id, email, email_confirmed_at) values
      ('${ID('0c1')}', 'confirmed@example.com', now()),
      ('${ID('0c2')}', 'waiting@example.com', null);
    insert into workspaces (id, slug, name, industry) values
      ('${ID('0a0')}', 'test-demo-a', 'Demo A', 'test'),
      ('${ID('0b0')}', 'test-demo-b', 'Demo B', 'test'),
      ('${ID('0d0')}', 'ws-other', 'Other', 'test');
    insert into sites (id, workspace_id, deploy_target, preview_host, lead_alert_to) values
      ('${ID('0a1')}', '${ID('0a0')}', 'worker-a', 'a-preview.example.test', array['confirmed@example.com']);
    ${SITE_B}
    insert into members (workspace_id, user_id, role) values
      ('${ID('0a0')}', '${ID('0c1')}', 'owner'),
      ('${ID('0d0')}', '${ID('0c1')}', 'member'),
      ('${ID('0b0')}', '${ID('0c2')}', 'member');`);
}

const stagingEnv = () => ({ STAGING_SUPABASE_REF: '127.0.0.1', STAGING_DB_URL: C.url, PROD_DB_URL: '', PROD_SUPABASE_REF: '' });
const run = (args, caseEnv = {}) => {
  const r = spawnSync(process.execPath, [script, ...args], { env: { ...process.env, ...stagingEnv(), ...caseEnv }, timeout: 60000, windowsHide: true });
  const out = String(r.stdout || ''), err = String(r.stderr || '');
  return { code: r.status, out, err, all: out + err };
};
const lines = s => s.split(/\r?\n/).filter(Boolean);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const show = r => `exit ${r.code}\n${r.all}`;
const OK_LINE = 'OK: one address read on STAGING_DB_URL (read only)';
const body = (login, confirmed, memberships, a, b) => [`login: ${login}`, `confirmed: ${confirmed}`, `memberships: ${memberships}`, `alerts test-demo-a: ${a}`, `alerts test-demo-b: ${b}`, OK_LINE];

async function suite() {
  const results = [];
  const t = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: ok ? '' : String(detail).slice(0, 900) });

  const r1 = run(['--email', ' Confirmed@Example.com ']);
  t('1 a confirmed login, the address in other case and with spaces round it', r1.code === 0 && same(lines(r1.out), body('yes', 'yes', 2, 'yes', 'no')), show(r1));
  const r2 = run(['--email', 'waiting@example.com']);
  t('2 an unconfirmed login', r2.code === 0 && same(lines(r2.out), body('yes', 'no', 1, 'no', 'no')), show(r2));
  const r3 = run(['--email', 'nobody@example.com']);
  t('3 no login at all', r3.code === 0 && same(lines(r3.out), body('no', '-', 0, 'no', 'no')), show(r3));
  const r4 = run(['--email', "o'brien@example.com"]);
  t('4 a quote in the address is a literal, not SQL', r4.code === 0 && lines(r4.out)[0] === 'login: no', show(r4));
  let r5;
  C.sql(`delete from sites where id = '${ID('0b1')}'`);
  try { r5 = run(['--email', 'confirmed@example.com']); } finally { C.sql(SITE_B); }
  t('5 a missing site reads as "no site"', r5.code === 0 && lines(r5.out).includes('alerts test-demo-b: no site') && lines(r5.out).includes('alerts test-demo-a: yes'), show(r5));

  const blob = [r1, r2, r3, r4, r5].map(r => r.all).join('\n').toLowerCase();
  const never = ['confirmed@', 'waiting@', 'other@', 'nobody@', "o'brien@example.com", ID('0c1'), ID('0c2'), '0000000000c1', '0000000000c2', C.url.toLowerCase(), String(C.port)];
  t('6 runs 1 to 5 all exited 0 and printed no address, no id, no URL, no port', [r1, r2, r3, r4, r5].every(r => r.code === 0) && never.every(x => !blob.includes(x)), `${[r1, r2, r3, r4, r5].map(r => r.code).join(',')}\n${never.filter(x => blob.includes(x)).join(' | ')}`);

  const wrong = [[], ['--email'], ['--email', 'not-an-address'], ['--email', 'a@example.com', 'extra'], ['--mail', 'a@example.com']].map(a => run(a));
  t('7 wrong use is exit 2 with the usage line and echoes nothing it was given',
    wrong.every(r => r.code === 2 && r.err.trim() === USAGE && !r.all.toLowerCase().includes('not-an-address') && !r.all.toLowerCase().includes('a@example.com')),
    wrong.map(show).join('\n--\n'));

  const e1 = run(['--email', 'a@example.com'], { STAGING_DB_URL: 'postgres://postgres@127.0.0.2:1/postgres' });   // names no ref; a refused port, so even a broken guard reaches no server
  const e2 = run(['--email', 'a@example.com'], { PROD_DB_URL: C.url });
  const e3 = run(['--email', 'a@example.com'], { STAGING_DB_URL: '' });
  t('8 production and anything but the staging ref are refused; unset is BLOCKED',
    e1.code === 2 && e1.err.trim() === 'REFUSED: STAGING_DB_URL does not name the staging project'
    && e2.code === 2 && e2.err.trim() === 'REFUSED: STAGING_DB_URL equals PROD_DB_URL'
    && e3.code === 3 && e3.err.trim() === 'BLOCKED: set STAGING_SUPABASE_REF and STAGING_DB_URL (read by name)',
    [e1, e2, e3].map(show).join('\n--\n'));

  const u = run(['--email', 'a@example.com'], { STAGING_DB_URL: 'postgres://postgres:zz-pw-9@127.0.0.1:1/postgres' });
  t('9 an unreadable database is exit 2 (not green) and does not print the password', u.code === 2 && /cannot read STAGING_DB_URL/.test(u.err) && !u.all.includes('zz-pw-9'), show(u));

  let ten = 'not run';
  try {
    const mod = await import(`${pathToFileURL(script).href}?x=${Math.random()}`);
    const errs = [];
    const code = mod.main(['--email', 'leak@example.com'], { ...stagingEnv() }, () => {}, m => errs.push(String(m)),
      () => { throw new Error("LINE 1: ... lower('leak@example.com')"); });
    const text = errs.join('\n');
    ten = `returned ${code}: ${text}`;
    t('10 an error that quotes the SQL does not carry the address out', code === 2 && text.includes('<the address>') && !text.includes('leak@example.com'), ten);
  } catch (e) { t('10 an error that quotes the SQL does not carry the address out', false, `could not run main: ${String((e && e.message) || e).slice(0, 300)}`); }
  return results;
}

const MUTANTS = [
  ['confirmed ignores the column', [['bool_or(me.email_confirmed_at is not null)', 'bool_or(true)']], /^2 /],
  ['two addresses count as exactly this one', [['array_length(s.lead_alert_to, 1) = 1 and ', '']], /^1 /],
  ["the stored address's case is not folded", [['where lower(u.email) = lower(', 'where u.email = (']], /^1 /],
  ['every member is counted', [['where m.user_id in (select id from me)', 'where true']], /^1 /],
  ['the address is printed', [['log(`login: ${yn(r.login)}`);', 'log(`login: ${yn(r.login)} ${email}`);']], /^6 /],
  ['production is not refused', [['try { url = stagingDbUrl(env); }', 'try { url = env.STAGING_DB_URL; }']], /^8 /],
  ['an unreadable database is green', [['.slice(0, 300)}`); return 2; }', '.slice(0, 300)}`); return 0; }']], /^9 /],
  ['a bad address is taken', [['if (!EMAIL.test(email)) {', 'if (false) {']], /^7 /],
  ['the address leaks through an error', [[".split(email).join('<the address>')", '']], /^10 /],
  ['a missing site shows as no', [["s in r.alerts ? yn(r.alerts[s]) : 'no site'", 'yn(r.alerts[s])']], /^5 /],
];

let exit = 0;
try {
  C = startCluster('inbox');
  loadPlatform(C);
  plant();
  const base = await suite();
  for (const r of base) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : '\n     ' + r.detail.replace(/\n/g, '\n     ')}`);
  const failed = base.filter(r => !r.ok).length;
  console.log(failed ? `\nINBOX-STATE TESTS FAILED: ${failed} of ${base.length}` : `\nINBOX-STATE TESTS OK: ${base.length} checks`);
  if (failed) exit = 1;

  if (process.argv.includes('--mutants') && !exit) {
    const source = readFileSync(REAL, 'utf8');
    let caught = 0, n = 0;
    for (const [name, pairs, expectRed] of MUTANTS) {
      let text = source, applied = true;
      for (const [from, to] of pairs) {
        if (text.split(from).length !== 2) { console.log(`MISSED  ${name}: the patch did not apply (target text found ${text.split(from).length - 1} times, not once: ${from.slice(0, 50)})`); applied = false; break; }
        text = text.split(from).join(to);
      }
      if (applied) for (const [quoted, url] of IMPORTS) {
        if (!text.includes(quoted)) { console.log(`MISSED  ${name}: the import ${quoted} was not found to rewrite`); applied = false; break; }
        text = text.split(quoted).join(`'${url}'`);
      }
      if (!applied) { exit = 1; continue; }
      const copy = join(work, `mutant-${n++}.mjs`);
      writeFileSync(copy, text);
      script = copy;
      let res;
      try { res = await suite(); } finally { script = REAL; }
      const red = res.filter(r => !r.ok);
      const nums = red.map(r => r.name.split(' ')[0]);
      if (red.some(r => expectRed.test(r.name))) { caught++; console.log(`caught  ${name}  [first FAIL: check ${nums[0]}; all red: ${nums.join(',')}]`); }
      else { exit = 1; console.log(`MISSED  ${name}  (${red.length ? 'red, but not the expected check: ' + red[0].name : 'still green'})`); }
    }
    console.log(exit ? `\nMUTANTS: not all caught (${caught} of ${MUTANTS.length})` : `\nMUTANTS OK: ${caught} of ${MUTANTS.length} caught, each red for the named reason`);
  }
} catch (e) {
  console.error(`test run crashed: ${(e && e.stack) || e}`);
  exit = 2;
} finally {
  try { if (C) C.stop(); } catch { /* already gone */ }
  rmSync(work, { recursive: true, force: true });
}
process.exit(exit);
