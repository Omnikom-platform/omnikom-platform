// Tests for supabase/ops/key-ages.mjs with planted api_keys rows on a throwaway local cluster (the real migrations, so the table
// is the real one). Nothing here needs an account.
//   node supabase/ops/test/key-ages.test.mjs              the suite
//   node supabase/ops/test/key-ages.test.mjs --mutants    the suite, then every MUTANT (one check broken in a copy): each must go red for the named reason
// Exit 0 = every test passed (and, with --mutants, every mutant was caught).
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { startCluster, loadPlatform } from './cluster.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL = resolve(HERE, '..', 'key-ages.mjs');
const PROMOTE = pathToFileURL(resolve(HERE, '..', 'promote-check.mjs')).href;
let script = process.env.KEY_AGES_SCRIPT ? resolve(process.env.KEY_AGES_SCRIPT) : REAL;
const work = mkdtempSync(join(tmpdir(), 'omnikom-keyages-test-'));

const HASH = 'ab12'.repeat(16);                 // a planted key hash: it must never appear in any output
const VAULT = 'vault-name-must-not-print';       // a planted vault_ref
const SCOPE_SECRET = 'scope-value-must-not-print';

let C;
function plant() {
  C.sql(`truncate api_keys cascade; delete from sites; delete from workspaces;
    insert into workspaces (id, slug, name, industry) values ('00000000-0000-0000-0000-0000000000a1', 'ws-a', 'Workspace A', 'test');
    insert into sites (id, workspace_id, deploy_target, preview_host, domain) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'worker-a', 'a-preview.example.test', 'a.example.test');`);
  const row = (kind, label, { site = false, created, used = 'null', expires = 'null', revoked = 'null', hash = true }) =>
    `insert into api_keys (kind, label, site_id, workspace_id, key_hash, vault_ref, scope, created_at, last_used_at, expires_at, revoked_at) values
     ('${kind}', '${label}', ${site ? "'00000000-0000-0000-0000-0000000000b1'" : 'null'}, ${site ? "'00000000-0000-0000-0000-0000000000a1'" : 'null'},
      ${hash ? `'${HASH}'` : 'null'}, '${VAULT}', '{"note":"${SCOPE_SECRET}"}', now() - interval '${created}', ${used}, ${expires}, ${revoked});`;
  C.sql([
    row('site-signing', 'fresh site key', { site: true, created: '10 days', used: "now() - interval '1 day'" }),
    row('runner', 'edge of the age rule', { created: '90 days 1 hour' }),
    row('cron', 'old cron key', { created: '91 days' }),
    row('deploy-token', 'expires soon', { created: '5 days', expires: "now() + interval '10 days'" }),
    row('crm-webhook', 'expires later', { created: '5 days', expires: "now() + interval '20 days'" }),
    row('omnisuite', 'expired not revoked', { created: '30 days', expires: "now() - interval '1 day'" }),
    row('client-api', 'old but revoked', { created: '200 days', revoked: "now() - interval '3 days'", hash: true }),
    row('runner', 'pipe | in label', { created: '1 day' }),
  ].join('\n'));
}
function onlyFresh() { C.sql("delete from api_keys where label <> 'fresh site key'"); }

const run = (extra = [], env = {}) => {
  const r = spawnSync(process.execPath, [script, '--db', 'KA_DB_URL', ...extra], { encoding: 'utf8', timeout: 60000, windowsHide: true, env: { ...process.env, KA_DB_URL: C.url, GITHUB_STEP_SUMMARY: '', ...env } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const dueLines = out => out.split(/\r?\n/).filter(l => l.startsWith('DUE '));

async function suite() {
  const results = [];
  const t = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: ok ? '' : String(detail).slice(0, 900) });
  plant();
  let r = run();
  t('planted rows: exit 1 (red)', r.code === 1, r.out);
  t('the table has the columns kind, label, site, age, last used, expires, revoked', /\| kind \| label \| site \| age \(days\) \| last used \| expires \| revoked \|/.test(r.out), r.out);
  t('a key older than 90 days is due (age rule)', dueLines(r.out).some(l => /old cron key/.test(l) && /older than 90 days/.test(l)), r.out);
  t('exactly 90 days and an hour is not due (whole days, due only over 90)', !dueLines(r.out).some(l => /edge of the age rule/.test(l)) && /edge of the age rule \| \(platform\) \| 90 \|/.test(r.out), r.out);
  t('a key expiring in 10 days is due (expiry rule)', dueLines(r.out).some(l => /expires soon/.test(l) && /expires in 10 days/.test(l)), r.out);
  t('a key expiring in 20 days is not due', !dueLines(r.out).some(l => /expires later/.test(l)), r.out);
  t('a key past its expiry and not revoked is due', dueLines(r.out).some(l => /expired not revoked/.test(l) && /expired and not revoked/.test(l)), r.out);
  t('a revoked key, however old, is not due', !dueLines(r.out).some(l => /old but revoked/.test(l)) && /old but revoked/.test(r.out), r.out);
  t('a fresh key is not due', !dueLines(r.out).some(l => /fresh site key/.test(l)), r.out);
  t('the site shows as its domain; a platform key as (platform)', /fresh site key \| a\.example\.test \| 10/.test(r.out) && /old cron key \| \(platform\) \| 91/.test(r.out), r.out);
  t('last used and expires are dates, or "never"', /fresh site key \|[^\n]*\| \d{4}-\d\d-\d\d \| never \| no \|/.test(r.out), r.out);
  t('no hash, vault name or scope value is ever printed', !r.out.includes(HASH) && !r.out.includes(VAULT) && !r.out.includes(SCOPE_SECRET) && !/[0-9a-f]{64}/.test(r.out) && !/0000000000b1/.test(r.out), r.out);
  t('a pipe in a label cannot break the table', /pipe \/ in label/.test(r.out), r.out);
  t('the connection string is never printed', !r.out.includes(C.url) && !r.out.includes(String(C.port)), r.out);

  const sum = join(work, 'summary.md');
  rmSync(sum, { force: true });
  run(['--summary', sum]);
  t('--summary writes the table to the file (the job summary)', existsSync(sum) && /### API key ages \(8 keys, 3 due\)/.test(readFileSync(sum, 'utf8')), existsSync(sum) ? readFileSync(sum, 'utf8').slice(0, 200) : 'no file');
  rmSync(sum, { force: true });
  run([], { GITHUB_STEP_SUMMARY: sum });
  t('$GITHUB_STEP_SUMMARY is used when set', existsSync(sum) && /API key ages/.test(readFileSync(sum, 'utf8')), 'no file');

  r = run(['--max-age-days', '365', '--warn-days', '1']);
  t('thresholds are options: 365 days and 1 day leave only the expired key due', r.code === 1 && dueLines(r.out).length === 1 && /expired not revoked/.test(dueLines(r.out)[0]), r.out);

  onlyFresh();
  r = run();
  t('only a fresh key: exit 0, "none due"', r.code === 0 && /OK: 1 keys, none due/.test(r.out) && dueLines(r.out).length === 0, r.out);
  C.sql('delete from api_keys');
  r = run();
  t('no rows at all: exit 0 and says so', r.code === 0 && /No api_keys rows/.test(r.out), r.out);

  r = run([], { KA_DB_URL: '' });
  t('a missing variable is exit 2 and named', r.code === 2 && /set KA_DB_URL/.test(r.out), r.out);
  r = run([], { KA_DB_URL: 'postgres://postgres:zz-pw-9@127.0.0.1:1/postgres' });
  t('an unreachable database is exit 2 (not green) and prints neither the URL nor the password', r.code === 2 && /cannot read api_keys/.test(r.out) && !r.out.includes('zz-pw-9'), r.out);

  const mod = await import(`${pathToFileURL(script).href}?x=${Math.random()}`);
  let refused = false;
  try { await import(PROMOTE).then(m => m.psqlReadOnly(C.url, 'delete from api_keys')); } catch (e) { refused = /read-only/.test(e.message); }
  t('the connection is read-only: a delete is refused', refused, 'not refused');
  t('assess() counts whole days from created_at', mod.assess([{ kind: 'runner', label: 'x', created: '2026-01-01T00:00:00Z', revoked: null, expires: null }], { now: new Date('2026-04-01T00:00:00Z') })[0].age === 90, 'age');
  t('assess() flags 91 days and not 90', mod.assess([{ kind: 'runner', label: 'x', created: '2026-01-01T00:00:00Z' }], { now: new Date('2026-04-02T00:00:00Z') })[0].flags.length === 1
    && mod.assess([{ kind: 'runner', label: 'x', created: '2026-01-01T00:00:00Z' }], { now: new Date('2026-04-01T00:00:00Z') })[0].flags.length === 0, 'flags');
  return results;
}

const MUTANTS = [
  ['the age rule is dropped', [['if (age > maxAgeDays)', 'if (false)']], /age rule/],
  ['the age rule is off by one (>= 90)', [['if (age > maxAgeDays)', 'if (age >= maxAgeDays)']], /exactly 90 days and an hour is not due/],
  ['the expiry rule is dropped', [['else if (left <= warnDays * DAY)', 'else if (false)']], /expiry rule/],
  ['an expired key that was never revoked is let through', [['if (left <= 0) flags.push', 'if (false) flags.push']], /past its expiry/],
  ['a revoked key is still judged', [['if (!r.revoked) {', 'if (true) {']], /revoked key, however old, is not due/],
  ['the exit code is always green', [['return due.length ? 1 : 0;', 'return 0;']], /exit 1 \(red\)/],
  ['the key hash is appended to the site column', [["coalesce(s.domain, s.preview_host),", "coalesce(s.domain, s.preview_host) || k.key_hash,"]], /ever printed/],
  ['the vault name leaks through the site column', [["coalesce(s.domain, s.preview_host),", "coalesce(s.domain, s.preview_host, k.vault_ref),"]], /ever printed/],
  ['the summary is not written', [['if (summary) {', 'if (false) {']], /--summary writes/],
  ['a database that cannot be read is green', [['catch (e) { err(`cannot read api_keys from ${dbVar}: ${String(e.message).slice(0, 300)}`); return 2; }', 'catch (e) { err(`cannot read`); return 0; }']], /unreachable database/],
  ['a pipe in a label is not escaped', [[".replace(/\\|/g, '/')", '']], /pipe in a label/],
  ['the thresholds ignore the options', [["opt('--max-age-days') === null ? 90 : Number(opt('--max-age-days'))", '90'], ["opt('--warn-days') === null ? 14 : Number(opt('--warn-days'))", '14']], /thresholds are options/],
];

let exit = 0;
try {
  C = startCluster('keys');
  loadPlatform(C);
  const base = await suite();
  for (const r of base) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : '\n     ' + r.detail.replace(/\n/g, '\n     ')}`);
  const failed = base.filter(r => !r.ok).length;
  console.log(failed ? `\nKEY-AGES TESTS FAILED: ${failed} of ${base.length}` : `\nKEY-AGES TESTS OK: ${base.length} checks`);
  if (failed) exit = 1;

  if (process.argv.includes('--mutants') && !exit) {
    const source = readFileSync(script, 'utf8');
    let caught = 0, n = 0;
    for (const [name, pairs, expectRed] of MUTANTS) {
      let text = source, applied = true;
      for (const [from, to] of pairs) {
        if (!text.includes(from)) { console.log(`MISSED  ${name}: the patch did not apply (target text not found: ${from.slice(0, 50)})`); applied = false; break; }
        text = text.split(from).join(to);
      }
      if (!applied) { exit = 1; continue; }
      text = text.split("'./promote-check.mjs'").join(`'${PROMOTE}'`);   // the copy lives in the temp folder
      const copy = join(work, `mutant-${n++}.mjs`);
      writeFileSync(copy, text);
      const real = script; script = copy;
      const res = await suite();
      script = real;
      const red = res.filter(r => !r.ok);
      if (red.some(r => expectRed.test(r.name))) { caught++; console.log(`caught  ${name}  [red: ${red.map(r => r.name.slice(0, 60)).slice(0, 2).join(' | ')}]`); }
      else { exit = 1; console.log(`MISSED  ${name}  (${red.length ? 'red, but not the expected test: ' + red[0].name : 'still green'})`); }
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
