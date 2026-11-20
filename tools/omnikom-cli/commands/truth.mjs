// truth: one command that compares the books, the environment names, staging and the worktrees with the code. One line per indicator, OK | DRIFT | BLOCKED:
//   book proof callers config state index   (the repository's own `tools/icm/index.mjs --check`, one child run; its lines go to the indicator of their first word)
//   env                  the names the code reads against where each is set, PER SURFACE (lib/truth-env.mjs)
//   staging-migrations   from the existing `status` command on staging: pending, differing and unknown migrations
//   staging-functions    the same answer: functions in the tree that are not deployed
//   worktrees            leftovers and unlanded work (lib/truth-worktrees.mjs)
// Exit 0 no indicator drifts, 1 one does, 3 one is BLOCKED (a key that is missing or a host that did not answer is BLOCKED, never OK; 3 outranks 1).
// Staging only; reads only: no file is written, no value is kept (names and counts only). The command never prints and never exits; omnikom.mjs does.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Usage, Blocked } from '../lib/errors.mjs';
import { redact } from '../lib/redact.mjs';
import { makeGit } from '../lib/git.mjs';
import { CLI_DIR } from '../lib/repo.mjs';
import { mainCheckoutOf } from './skill.mjs';
import { readNamesByCode, readApiKeyNames, readBookSecrets, readEnvFileNames, readStagingSecrets, actionsRepoOf, readActionsNames, compareEnv } from '../lib/truth-env.mjs';
import { readWorktrees } from '../lib/truth-worktrees.mjs';
import { status } from './status.mjs';

const MAX_ITEMS = 20;
const SIX = ['book', 'proof', 'callers', 'config', 'state', 'index'];
// the first word of a line of `index.mjs --check` -> its indicator; any other word is an index line
const FAMILY = {
  __proto__: null,
  BOOK: 'book',
  PROOF: 'proof',
  CALLERS: 'callers',
  CONFIG: 'config',
  STATE: 'state',
};

const ok = (id, summary) => ({ id, state: 'OK', summary, items: [] });
const drift = (id, summary, items) => ({ id, state: 'DRIFT', summary, items });
const blocked = (id, summary, unblock) => ({ id, state: 'BLOCKED', summary, items: [], unblock: unblock || 'fix the cause named above and run it again' });
const fromError = (id, e) => (e instanceof Blocked ? blocked(id, e.message, e.unblock) : blocked(id, String((e && e.message) || e).split('\n')[0].slice(0, 200), 'fix the cause named above and run it again'));
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---- the six checks of the repository: one child run of its own tools/icm/index.mjs --check
function indexIndicators(ctx) {
  const script = join(ctx.repo, 'tools', 'icm', 'index.mjs');
  const down = why => SIX.map(id => blocked(id, `tools/icm/index.mjs --check did not run: ${why}`, 'run it in a checkout that holds tools/icm/index.mjs, with node 20 or later'));
  if (!existsSync(script)) return down('tools/icm/index.mjs is missing');
  const limit = ctx.truthTimeoutMs || 120000;
  const r = spawnSync(process.execPath, [script, '--check', '--root', ctx.repo], { cwd: ctx.repo, encoding: 'utf8', timeout: limit, windowsHide: true, maxBuffer: 1 << 26 });
  if (r.error) return down(r.error.code === 'ETIMEDOUT' ? `it did not end within ${Math.round(limit / 1000)} seconds` : String(r.error.message).split('\n')[0].slice(0, 160));
  if (r.status !== 0 && r.status !== 1) return down(r.status === null ? `it was stopped by ${r.signal}` : `it exited ${r.status}`);
  const found = new Map(SIX.map(id => [id, []]));
  if (r.status === 1) {
    for (const line of String(r.stdout).split(/\r?\n/)) {
      if (!line.trim() || line.startsWith('OK:')) continue;
      const word = /^([A-Za-z]+)/.exec(line);
      found.get((word && FAMILY[word[1]]) || 'index').push({ what: line, where: '' });
    }
    if (![...found.values()].some(l => l.length)) found.get('index').push({ what: 'tools/icm/index.mjs --check exited 1 and printed no problem line', where: '' });
  }
  return SIX.map(id => (found.get(id).length ? drift(id, count(found.get(id).length, 'problem', 'problems'), found.get(id)) : ok(id, 'no problem')));
}

// ---- the environment names
function loadProvided() {
  let raw;
  try { raw = JSON.parse(readFileSync(join(CLI_DIR, 'env-provided.json'), 'utf8')); } catch { throw new Blocked('env-provided.json is not readable', 'restore tools/omnikom-cli/env-provided.json from git'); }
  const sets = {};
  for (const k of ['functions', 'workflows', 'scripts']) {
    if (!Array.isArray(raw[k]) || raw[k].some(n => typeof n !== 'string')) throw new Blocked(`env-provided.json has no list of names under "${k}"`, 'restore tools/omnikom-cli/env-provided.json from git');
    sets[k] = new Set(raw[k]);
  }
  const optional = raw.optional && raw.optional.functions;
  if (!optional || typeof optional !== 'object' || Object.values(optional).some(v => typeof v !== 'string' || !v)) throw new Blocked('env-provided.json has no "optional": { "functions": { name: reason } }', 'restore tools/omnikom-cli/env-provided.json from git');
  sets.optionalFunctions = new Set(Object.keys(optional));
  return sets;
}

async function envIndicator(ctx) {
  try {
    const provided = loadProvided();
    const git = makeGit(ctx.repo);
    const env = readEnvFileNames(ctx.env.OMNIKOM_ENV_FILE);
    const staging = await readStagingSecrets(ctx);
    const repoName = actionsRepoOf(git);
    const secrets = await readActionsNames(ctx, repoName, 'secret');
    const vars = await readActionsNames(ctx, repoName, 'variable');
    const keys = readApiKeyNames(mainCheckoutOf(ctx.repo));
    const book = readBookSecrets(ctx.repo);
    const { reads, computed, mentioned } = await readNamesByCode(ctx.repo, git);
    const r = compareEnv({ reads, stores: { env, staging, secrets, vars, apiKeys: keys.names }, provided, book, mentioned });
    let summary = `${r.unset} read and not set, ${r.unread} set and not read (${computed} computed reads not checked)`;
    if (r.bookOnly) summary += `, ${r.bookOnly} in the book's Secrets and mentioned by no code`;
    if (r.optional) summary += `, ${r.optional} optional names read by scripts not in the book's Secrets list`;
    if (r.production) summary += `, ${r.production} names of .github/production not checked (no production repository yet)`;
    if (!keys.present) summary += ', no API keys file';
    return r.items.length ? drift('env', summary, r.items) : ok('env', summary);
  } catch (e) { return fromError('env', e); }
}

// ---- staging, from the answer of the status command
const arr = x => (Array.isArray(x) ? x : []);

async function stagingIndicators(ctx) {
  const down = (why, unblock) => ['staging-migrations', 'staging-functions'].map(id => blocked(id, why, unblock));
  let st;
  try { st = await (ctx.truthStatus ? ctx.truthStatus(ctx) : status(ctx)); } catch (e) {
    const b = fromError('staging', e);
    return down(b.summary, b.unblock);
  }
  const d = st && st.data;
  if (!d || st.code === 'CONNECT' || d.reachable !== true) return down(`staging did not answer: ${(d && d.error) || (st && st.code) || 'no answer'}`, 'check STAGING_DB_URL and the network, then run it again');
  const out = [];
  const mig = d.migrations;
  if (!mig || typeof mig !== 'object') out.push(blocked('staging-migrations', 'the status answer holds no migrations', 'run omnikom status --target staging and read its answer'));
  else {
    const items = [];
    for (const m of arr(mig.pending)) items.push({ what: `${m} is pending on staging`, where: `supabase/migrations/${m}` });
    for (const m of arr(mig.mismatched)) items.push({ what: `${m} differs from the ledger`, where: `supabase/migrations/${m}` });
    for (const m of arr(mig.unknownInDatabase)) items.push({ what: `${m} is in the database and not in the tree`, where: 'staging ledger' });
    const summary = `${arr(mig.applied).length} applied, ${arr(mig.pending).length} pending, ${arr(mig.mismatched).length} differ, ${arr(mig.unknownInDatabase).length} not in the tree`;
    out.push(items.length ? drift('staging-migrations', summary, items) : ok('staging-migrations', summary));
  }
  const fn = d.functions;
  if (!fn || fn.checked !== true) out.push(blocked('staging-functions', `the functions were not checked${fn && fn.reason ? `: ${fn.reason}` : ''}`, 'set STAGING_SUPABASE_REF so staging can be asked'));
  else {
    const items = [], unreachable = [];
    let deployed = 0;
    for (const [name, v] of Object.entries(fn).filter(([k]) => k !== 'checked' && k !== 'reason')) {
      if (v === 'not deployed') items.push({ what: `${name} is in the tree and not deployed`, where: `supabase/functions/${name}` });
      if (v === 'unreachable') unreachable.push(name);
      if (v === 'deployed') deployed++;
    }
    if (unreachable.length) out.push({ ...blocked('staging-functions', `${unreachable.join(', ')} did not answer`, 'check the network and STAGING_SUPABASE_REF, then run it again'), items });
    else out.push(items.length ? drift('staging-functions', `${deployed} deployed, ${items.length} not deployed`, items) : ok('staging-functions', `${deployed} deployed`));
  }
  return out;
}

// ---- worktrees
function worktreesIndicator(ctx) {
  try {
    const w = readWorktrees({ repo: ctx.repo, now: ctx.now() });
    const summary = `${w.items.length} to clean up, ${count(w.flight, 'worktree', 'worktrees')} with work in flight (baseline ${w.baseName} ${w.master})`;
    return { master: w.master, indicator: w.items.length ? drift('worktrees', summary, w.items) : ok('worktrees', summary) };
  } catch (e) { return { master: null, indicator: fromError('worktrees', e) }; }
}

export async function truth(ctx) {
  if (ctx.positionals.length > 1) throw new Usage('truth takes no argument');
  for (const k of Object.keys(ctx.flags)) if (k !== 'json' && k !== 'target') throw new Usage(`truth takes no --${k}`);
  if (ctx.flags.target !== undefined && ctx.flags.target !== 'staging') throw new Usage('truth reads staging only');
  ctx.targetName = 'staging';
  const idx = indexIndicators(ctx);
  const env = await envIndicator(ctx);
  const stg = await stagingIndicators(ctx);
  const wt = worktreesIndicator(ctx);
  const indicators = [...idx, env, ...stg, wt.indicator];
  const blockedAny = indicators.some(x => x.state === 'BLOCKED');
  const driftAny = indicators.some(x => x.state === 'DRIFT');
  const exit = blockedAny ? 3 : driftAny ? 1 : 0;
  return { ok: exit === 0, code: exit === 3 ? 'BLOCKED' : exit === 1 ? 'DRIFT' : 'ok', data: { master: wt.master, indicators }, exit };
}

// the text form: one line per indicator, a BLOCKED line ends with what unblocks it, a DRIFT line is followed by its items (20 at most)
export function truthText(obj, env) {
  if (!obj.data) return redact(`ERROR ${obj.code}: ${obj.error}`, env) + '\n';
  const lines = [];
  for (const x of obj.data.indicators) {
    lines.push(`${x.state} ${x.id}: ${x.summary}${x.state === 'BLOCKED' && x.unblock ? ` (unblocks: ${x.unblock})` : ''}`);
    if (x.state !== 'DRIFT') continue;
    for (const i of x.items.slice(0, MAX_ITEMS)) lines.push(`  - ${i.what}${i.where ? ` (${i.where})` : ''}`);
    if (x.items.length > MAX_ITEMS) lines.push(`  ... and ${x.items.length - MAX_ITEMS} more`);
  }
  return redact(lines.join('\n'), env) + '\n';
}
