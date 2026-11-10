// ci [--job <id>] [--root <dir>] [--install] [--json]
// Runs every job of .github/workflows/ci.yml locally, in file order, each step in order, with the binaries of tools.json
// (<repo>/.tools/bin first on the CHILD's PATH only). Heads verify with this, never with a tool from a scratch folder (DECISIONS 42).
// ci.yml is read by a small reader for this file's shape (no YAML dependency). Every step is mapped by NAME in ROWS below to the local
// action that stands for it; a step that is not in the table FAILS its job ("step not mapped: <name>"), and so does a step that uses a
// key the reader does not model, so ci.yml cannot grow a check that this command skips.
// Text output: one line per job `PASS|FAIL <id>  <last line>`, then `ci: <n> jobs, <p> PASS, <f> FAIL`. Exit 0 all PASS, 1 any FAIL, 2 usage.
import { readFileSync, existsSync, readdirSync, statfsSync } from 'node:fs';
import { tmpdir, freemem, totalmem } from 'node:os';
import { join, resolve, dirname, delimiter, basename } from 'node:path';
import { Usage } from '../lib/errors.mjs';
import { repoPath } from '../lib/repo.mjs';
import { redact } from '../lib/redact.mjs';
import { result } from '../lib/ctx.mjs';
import { loadManifest, toolsDir, binDirOf, platformKey, ensureTools } from '../lib/tools.mjs';
import { makeGit } from '../lib/git.mjs';
import { GATES_ROOT, treeOf, withTreeCheckout } from '../lib/checkout.mjs';

// ------------------------------------------------------------------------------------------------ the reader for ci.yml's shape
const skip = l => l.trim() === '' || /^\s*#/.test(l);
const ind = l => l.length - l.trimStart().length;

function scalar(raw, at) {
  const s = raw.trim();
  if (s === '') return '';
  if (s[0] === "'") {
    let out = '', i = 1;
    for (; i < s.length; i++) {
      if (s[i] === "'") { if (s[i + 1] === "'") { out += "'"; i++; continue; } break; }
      out += s[i];
    }
    if (i >= s.length) throw new Error(`${at}: unterminated quote`);
    const rest = s.slice(i + 1).trim();
    if (rest && !rest.startsWith('#')) throw new Error(`${at}: text after a quoted value`);
    return out;
  }
  if (s[0] === '"') {
    let i = 1;
    for (; i < s.length; i++) { if (s[i] === '\\') { i++; continue; } if (s[i] === '"') break; }
    if (i >= s.length) throw new Error(`${at}: unterminated quote`);
    try { return JSON.parse(s.slice(0, i + 1)); } catch { throw new Error(`${at}: bad double-quoted value`); }
  }
  if (/^[\[{&*!>]/.test(s)) throw new Error(`${at}: this value shape is not modelled (${s.slice(0, 20)})`);
  return s.replace(/\s+#.*$/, '').trim();
}

// the lines after line i that are blank or indented deeper than `col`
function block(lines, i, col) {
  const out = [];
  let j = i;
  while (j < lines.length && (lines[j].trim() === '' || ind(lines[j]) > col)) { out.push(lines[j]); j++; }
  return { out, next: j };
}

function blockScalar(rows, chomp) {
  const first = rows.find(l => l.trim() !== '');
  if (!first) return '';
  const d = ind(first);
  let text = rows.map(l => (l.trim() === '' ? '' : l.slice(d))).join('\n');
  text = text.replace(/\n+$/, '');
  return chomp === '-' ? text : text + '\n';
}

export function parseWorkflow(text) {
  const lines = String(text).split(/\r?\n/);
  const fail = (i, why) => { throw new Error(`ci.yml line ${i + 1}: ${why}`); };
  const topKeys = [];
  let jobsAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (skip(lines[i]) || ind(lines[i]) > 0) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_-]*):/.exec(lines[i]);
    if (!m) fail(i, 'not a top-level key');
    topKeys.push(m[1]);
    if (m[1] === 'jobs') jobsAt = i;
  }
  if (jobsAt < 0) throw new Error('ci.yml has no jobs: key');
  const jobs = [];
  let i = jobsAt + 1;
  while (i < lines.length) {
    if (skip(lines[i])) { i++; continue; }
    if (ind(lines[i]) === 0) break;
    const m = /^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(lines[i]);
    if (!m) fail(i, 'expected a job id at indent 2');
    const job = { id: m[1], name: m[1], runsOn: '', timeoutMinutes: null, extra: [], steps: [] };
    i++;
    while (i < lines.length) {
      if (skip(lines[i])) { i++; continue; }
      const d = ind(lines[i]);
      if (d <= 2) break;
      if (d !== 4) fail(i, 'expected a job key at indent 4');
      const km = /^ {4}([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/.exec(lines[i]);
      if (!km) fail(i, 'expected key: value');
      const key = km[1], val = km[2] === undefined ? '' : km[2];
      if (key === 'steps') {
        if (val.trim() !== '' && !val.trim().startsWith('#')) fail(i, 'steps: must be a block list');
        i = parseSteps(lines, i + 1, job, fail);
        continue;
      }
      if (['name', 'runs-on', 'timeout-minutes'].includes(key) && val.trim() !== '' && !/^[|>]/.test(val.trim())) {
        const v = scalar(val, `ci.yml line ${i + 1}`);
        if (key === 'name') job.name = v;
        else if (key === 'runs-on') job.runsOn = v;
        else job.timeoutMinutes = Number(v);
        i++;
        continue;
      }
      job.extra.push(key);
      i = block(lines, i + 1, 4).next;
    }
    jobs.push(job);
  }
  return { topKeys, jobs };
}

function parseSteps(lines, i, job, fail) {
  let step = null;
  while (i < lines.length) {
    if (skip(lines[i])) { i++; continue; }
    const d = ind(lines[i]);
    if (d <= 4) break;
    let text;
    if (d === 6 && lines[i].startsWith('- ', 6)) {
      step = { name: '', uses: '', with: {}, run: '', if: '', extra: [], line: i + 1 };
      job.steps.push(step);
      text = lines[i].slice(8);
    } else if (d === 8 && step) text = lines[i].slice(8);
    else fail(i, 'a step key must sit at indent 8 under a "- " at indent 6');
    const km = /^([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/.exec(text);
    if (!km) fail(i, 'expected key: value in a step');
    const key = km[1], val = km[2] === undefined ? '' : km[2];
    const at = `ci.yml line ${i + 1}`;
    let value;
    const bs = /^([|>])([+-]?)\s*(?:#.*)?$/.exec(val.trim());
    if (bs) {
      if (bs[1] === '>') fail(i, 'a folded block (>) is not modelled');
      const b = block(lines, i + 1, 8);
      value = blockScalar(b.out, bs[2]);
      i = b.next;
    } else if (val.trim() === '' || val.trim().startsWith('#')) {
      const b = block(lines, i + 1, 8);
      value = {};
      for (const l of b.out) {
        if (skip(l)) continue;
        const nm = /^ {10}([A-Za-z0-9_-]+):(?:[ \t]+(.*))?$/.exec(l);
        if (!nm) fail(i, `a nested value of '${key}' is not a plain key: value pair at indent 10`);
        value[nm[1]] = scalar(nm[2] === undefined ? '' : nm[2], at);
      }
      i = b.next;
    } else { value = scalar(val, at); i++; }
    if (['name', 'uses', 'run', 'if'].includes(key)) {
      if (typeof value !== 'string') fail(i - 1, `${key} must be text`);
      step[key] = value;
    } else if (key === 'with') {
      if (typeof value !== 'object') fail(i - 1, 'with must be a map');
      step.with = value;
    } else step.extra.push(key);
  }
  return i;
}

// ------------------------------------------------------------------------------------------------ running things
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');   // eslint-disable-line no-control-regex
const splitLines = s => String(s || '').split(/\r?\n/).map(l => stripAnsi(l).trimEnd()).filter(l => l.trim() !== '');

// .tools/bin first on the CHILD's PATH only (the Windows variable may be spelled Path)
function childEnvOf(env, binDir) {
  const key = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
  return { ...env, [key]: binDir + delimiter + (env[key] || '') };
}

// one command; stdout and stderr are separate, so a failing command's last line is the last line of stderr when it has any
function exec(st, cmd, args) {
  const left = Math.max(1000, st.deadline - Date.now());
  const r = st.ctx.spawn(cmd, args, { cwd: st.root, env: st.childEnv, encoding: 'utf8', timeout: left, maxBuffer: 1 << 29, windowsHide: true });
  const out = splitLines(r.stdout), err = splitLines(r.stderr);
  const failed = Boolean(r.error) || r.status !== 0;
  const lines = failed ? [...out, ...err] : [...err, ...out];
  if (r.error) lines.push(r.error.code === 'ETIMEDOUT' ? `${basename(String(cmd))}: timed out (ci.yml's timeout-minutes)` : `could not run ${basename(String(cmd))}: ${String(r.error.message).slice(0, 160)}`);
  else if (r.status === null) lines.push(`${basename(String(cmd))}: killed (${r.signal || 'no exit code'})`);
  else if (failed && lines.length === 0) lines.push(`${basename(String(cmd))}: exit ${r.status}`);
  return { ok: !failed, lines };
}

// a command line in a run: words and quotes only; shell syntax is refused, because this runner does not run a shell
function tokenize(line) {
  const toks = [];
  let cur = '', has = false, q = null;
  for (const c of line) {
    if (q) { if (c === q) q = null; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
    if (/\s/.test(c)) { if (has) { toks.push(cur); cur = ''; has = false; } continue; }
    if ('|&;<>`(){}\\!'.includes(c)) throw new Error(`shell syntax '${c}' in a run line (omnikom ci does not run a shell)`);
    cur += c; has = true;
  }
  if (q) throw new Error('unterminated quote in a run line');
  if (has) toks.push(cur);
  return toks;
}

const oneLine = (step) => {
  const ls = step.run.split('\n').filter(l => l.trim() !== '');
  if (ls.length !== 1) throw new Error('the step is not a single command line');
  return ls[0].trim();
};

const toolBin = (st, tool) => {
  const e = st.manifest.tools[tool];
  const b = e && e.bin && e.bin[st.platKey];
  return b ? join(st.binDir, b) : null;
};
const missing = (tool) => ({ ok: false, lines: [`${tool} is not in .tools/bin: run omnikom tools ensure --only ${tool}`] });

const versionOf = (text, re) => { const m = re.exec(text); return m ? m[1] : null; };

// ------------------------------------------------------------------------------------------------ the table: step name -> local action
const actions = {
  checkout: async (step, st) => {
    if (!step.uses.startsWith('actions/checkout@')) return { ok: false, lines: [`expected uses: actions/checkout, found '${step.uses}'`] };
    return { ok: true, lines: [`checkout: the working tree at ${st.root} stands for the clean checkout (this run does not start from a fresh clone)`] };
  },
  'setup-node': async (step, st) => {
    if (!step.uses.startsWith('actions/setup-node@')) return { ok: false, lines: [`expected uses: actions/setup-node, found '${step.uses}'`] };
    const want = step.with['node-version'];
    const pinned = st.manifest.tools.node && st.manifest.tools.node.version;
    const r = exec(st, process.execPath, ['--version']);
    const have = versionOf(r.lines.join('\n'), /v?(\d+\.\d+\.\d+)/);
    if (!r.ok || !have) return { ok: false, lines: ['node --version gave no version', ...r.lines] };
    const same = have === want && have === pinned;
    return { ok: same, lines: [same ? `node ${have} (ci.yml ${want}, tools.json ${pinned})` : `node ${have} is running, ci.yml wants ${want}, tools.json says ${pinned}`] };
  },
  'setup-deno': async (step, st) => {
    if (!step.uses.startsWith('denoland/setup-deno@')) return { ok: false, lines: [`expected uses: denoland/setup-deno, found '${step.uses}'`] };
    const bin = toolBin(st, 'deno');
    if (!bin || !existsSync(bin)) return missing('deno');
    const want = step.with['deno-version'];
    const pinned = st.manifest.tools.deno && st.manifest.tools.deno.version;
    const r = exec(st, bin, ['--version']);
    const have = versionOf(r.lines.join('\n'), /\bdeno (\d+\.\d+\.\d+)/) || versionOf(r.lines.join('\n'), /(\d+\.\d+\.\d+)/);
    if (!r.ok || !have) return { ok: false, lines: ['deno --version gave no version', ...r.lines] };
    const same = have === want && have === pinned;
    return { ok: same, lines: [same ? `deno ${have} from .tools/bin (ci.yml ${want}, tools.json ${pinned})` : `deno ${have} is in .tools/bin, ci.yml wants ${want}, tools.json says ${pinned}`] };
  },
  'pg-path': async (step, st) => {
    const r = exec(st, 'initdb', ['--version']);
    if (!r.ok) return { ok: false, lines: ['initdb not found on PATH (the CLI tests and the walls need PostgreSQL binaries)', ...r.lines] };
    // not a failure, but said out loud: the database walls run on whatever initdb is first on PATH, and CI runs the major in the step's name
    const line = r.lines[r.lines.length - 1];
    const wantMajor = (/PostgreSQL (\d+)/.exec(step.name) || [])[1], haveMajor = (/\)\s*(\d+)/.exec(line) || [])[1];
    return { ok: true, lines: [`${line} (initdb found${wantMajor && haveMajor && wantMajor !== haveMajor ? `; CI runs PostgreSQL ${wantMajor}, this machine ${haveMajor}` : ''})`] };
  },
  disk: async (step, st) => {
    if (!/^df\b/.test(step.run.trim())) return { ok: false, lines: ['expected a df command'] };
    const where = [tmpdir(), st.root];
    const lines = where.map(w => { try { const s = statfsSync(w); return `disk free ${(s.bavail * s.bsize / 2 ** 30).toFixed(1)} GiB of ${(s.blocks * s.bsize / 2 ** 30).toFixed(1)} GiB at ${w}`; } catch (e) { return `disk free at ${w}: not readable`; } });
    if (/\bfree -m\b/.test(step.run)) lines.push(`memory free ${(freemem() / 2 ** 20).toFixed(0)} MiB of ${(totalmem() / 2 ** 20).toFixed(0)} MiB`);
    return { ok: true, lines };
  },
  node: async (step, st) => {
    const toks = tokenize(oneLine(step));
    if (toks[0] !== 'node') return { ok: false, lines: [`expected a node command, found '${toks[0]}'`] };
    if (toks.some(t => /[$*?]/.test(t))) return { ok: false, lines: ['a variable or a wildcard in a node command is not modelled'] };
    return exec(st, process.execPath, toks.slice(1));
  },
  'npm-ci': async (step, st) => {
    const toks = tokenize(oneLine(step));
    if (toks[0] !== 'npm' || toks[1] !== 'ci') return { ok: false, lines: [`expected npm ci, found '${toks.slice(0, 2).join(' ')}'`] };
    const at = toks.indexOf('--prefix');
    const prefix = at >= 0 ? toks[at + 1] : '.';
    if (!st.flags.install) {
      return existsSync(join(st.root, prefix, 'node_modules'))
        ? { ok: true, lines: [`SKIP npm ci: ${prefix}/node_modules exists (add --install to run it as written)`] }
        : { ok: false, lines: [`npm ci: ${prefix}/node_modules is missing; run with --install`] };
    }
    const cli = [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].find(existsSync);
    if (!cli) return { ok: false, lines: ['npm-cli.js was not found next to node'] };
    return exec(st, process.execPath, [cli, ...toks.slice(1)]);
  },
  download: async (step, st, m) => {
    const [, tool, version] = m;
    const entry = st.manifest.tools[tool];
    if (!entry) return { ok: false, lines: [`${tool} is not in tools.json`] };
    if (version !== entry.version) return { ok: false, lines: [`ci.yml names ${tool} ${version} but tools.json has ${entry.version}`] };
    const url = (/https:\/\/github\.com\/\S+/.exec(step.run) || [])[0];
    const sha = (/\b([0-9a-f]{64})\s/.exec(step.run) || [])[1];
    const linux = entry.platforms && entry.platforms['linux-amd64'];
    if (!linux || url !== linux.url || sha !== linux.sha256) return { ok: false, lines: [`ci.yml's url or sha256 for ${tool} differs from tools.json`] };
    const [r] = await ensureTools(st.ctx, [tool]);
    return r.status === 'refused' ? { ok: false, lines: [`tools ensure ${tool}: refused: ${r.reason}`] } : { ok: true, lines: [`tools ensure ${tool} ${r.version}: ${r.status}`] };
  },
  'tool-run': async (step, st) => {
    const toks = tokenize(oneLine(step));
    const fromTemp = t => { const m = /^\$RUNNER_TEMP\/[^/]+\/([A-Za-z0-9_.-]+)$/.exec(t); return m ? m[1] : null; };
    const first = fromTemp(toks[0]);
    if (!first) return { ok: false, lines: [`expected "$RUNNER_TEMP/<dir>/<tool>" first, found '${toks[0]}'`] };
    const args = [];
    for (const t of toks.slice(1)) {
      const tool = fromTemp(t);
      if (tool) { const b = toolBin(st, tool); if (!b) return { ok: false, lines: [`${tool} is not in tools.json`] }; args.push(b); continue; }
      if (t.includes('$')) return { ok: false, lines: [`a variable in '${t}' is not modelled`] };
      if (t.includes('*')) {
        const dir = dirname(t), re = new RegExp(`^${basename(t).split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
        let hits = [];
        try { hits = readdirSync(join(st.root, dir)).filter(n => re.test(n)).sort(); } catch { hits = []; }
        if (hits.length === 0) return { ok: false, lines: [`no file matches ${t}`] };
        args.push(...hits.map(n => `${dir}/${n}`));
        continue;
      }
      args.push(t);
    }
    const bin = toolBin(st, first);
    if (!bin) return { ok: false, lines: [`${first} is not in tools.json`] };
    if (!existsSync(bin)) return missing(first);
    let note = '';
    if (first === 'actionlint') {
      // actionlint must find shellcheck (DECISIONS 42): the pinned one, given explicitly, before the file arguments
      const shell = toolBin(st, 'shellcheck');
      if (!shell || !existsSync(shell)) return missing('shellcheck');
      const at = args.indexOf('-shellcheck');
      if (at >= 0) args.splice(at, 2);
      args.splice(0, 0, '-shellcheck', shell);
      const sv = exec(st, shell, ['--version']);
      const have = versionOf(sv.lines.join('\n'), /version:\s*(\S+)/);
      const pinned = st.manifest.tools.shellcheck.version;
      if (!sv.ok || have !== pinned) return { ok: false, lines: [`shellcheck ${have || 'gave no version'} is in .tools/bin, tools.json says ${pinned}`] };
      note = ` [shellcheck ${have}]`;
    }
    const r = exec(st, bin, args);
    const lines = r.lines.length ? [...r.lines] : [`${first}: no findings`];
    lines[lines.length - 1] += note;
    return { ok: r.ok, lines };
  },
};

const NODE_STEPS = ['ICM index is fresh', 'All blueprint gates', 'Factory tests', 'Factory mutants', 'Runner tests', 'Runner mutants', 'Function tests', 'Function mutants',
  'Audit tests', 'Audit mutants', 'CLI unit tests', 'CLI full suite (when the change reaches it)', 'CLI mutants, one shard (when the change reaches them)', 'One owner per path', 'Department tool tests', 'crm-map tests and mutants', 'Client record tests', 'ICM tests', 'ICM mutants', 'Lead endpoint tests', 'Lead endpoint mutants', 'Secret receiver tests', 'Secret receiver mutants', 'Site backup URL tests', 'Client files', 'Dashboard tests'];
const DEP_SCAN_STEPS = ['Dependency scan tests', 'Dependency scan mutants', 'Dependency scan'];   // H2-10: tools/test/dep-scan.mjs finds .tools/bin/osv-scanner itself
const ROWS = [
  { name: /^Check out the repository( with its whole history)?$/, run: actions.checkout },
  { name: 'Set up Node', run: actions['setup-node'] },
  { name: 'Set up Deno', run: actions['setup-deno'] },
  { name: /^PostgreSQL 16 binaries on PATH/, run: actions['pg-path'] },
  { name: /^Free disk (before|after) the gates$/, run: actions.disk },
  { name: /^Install the runner's pinned dependency/, run: actions['npm-ci'] },
  { name: /^Download (actionlint|gitleaks|osv-scanner|shellcheck) (\d+\.\d+\.\d+) and check its sha256/, run: actions.download },
  { name: 'Scan the history and the tree', run: actions['tool-run'] },
  { name: 'Lint every workflow (with the pinned shellcheck)', run: actions['tool-run'] },
  ...[...NODE_STEPS, ...DEP_SCAN_STEPS].map(name => ({ name, run: actions.node })),
];

async function runStep(step, st) {
  let m = null;
  const row = ROWS.find(r => { if (typeof r.name === 'string') return r.name === step.name; m = r.name.exec(step.name); return Boolean(m); });
  if (!row) return { ok: false, lines: [`step not mapped: ${step.name || step.uses || '(unnamed)'}`] };
  if (step.extra.length) return { ok: false, lines: [`step '${step.name}' uses ${step.extra.join(', ')}, which omnikom ci does not model`] };
  if (step.if && step.if !== 'always()') return { ok: false, lines: [`step '${step.name}' has if: ${step.if}, which omnikom ci does not model`] };
  try { return await row.run(step, st, m); } catch (e) { return { ok: false, lines: [`${step.name}: ${String((e && e.message) || e).slice(0, 200)}`] }; }
}

async function runJob(job, st0) {
  const st = { ...st0, deadline: Date.now() + (job.timeoutMinutes > 0 ? job.timeoutMinutes : 360) * 60000 };
  const steps = [];
  let broken = job.extra.length ? `job keys not modelled: ${job.extra.join(', ')}` : '';
  if (broken) steps.push({ name: '(job)', status: 'FAIL', lines: [broken] });
  for (const step of job.steps) {
    const name = step.name || step.uses || '(unnamed)';
    const failedBefore = steps.some(s => s.status === 'FAIL');
    if (failedBefore && step.if !== 'always()') { steps.push({ name, status: 'SKIP', lines: ['skipped: an earlier step failed'] }); continue; }
    const r = await runStep(step, st);
    steps.push({ name, status: r.ok ? 'PASS' : 'FAIL', lines: r.lines.slice(-60) });
  }
  const status = steps.some(s => s.status === 'FAIL') ? 'FAIL' : 'PASS';
  const pool = status === 'FAIL' ? steps.filter(s => s.status === 'FAIL') : steps.filter(s => s.status !== 'SKIP' && s.lines.length);
  const from = status === 'FAIL' ? pool[0] : pool[pool.length - 1];
  const last = from && from.lines.length ? from.lines[from.lines.length - 1] : '(no output)';
  return { id: job.id, name: job.name, status, last, steps };
}

// ci [--staged | --commit <sha>] [--job <id>]: the same jobs on a throwaway checkout of that exact tree, to reproduce a red GitHub job on the
// tree GitHub ran (DECISIONS 45). It is NOT the gate and writes no stamp: the gate is the green GitHub run (lib/ghrun.mjs, `omnikom land`).
// Without those flags ci runs on the working tree as before.
export async function ci(ctx) {
  const f = ctx.flags;
  if (f.staged !== true && f.commit === undefined) return ciRun(ctx, null);
  if (f.staged === true && f.commit !== undefined) throw new Usage('ci takes --staged or --commit <sha>, not both');
  if (f.root !== undefined) throw new Usage('ci --staged / --commit runs on its own checkout of the tree: --root cannot be combined with it');
  const git = makeGit(ctx.repo);
  if (!git.run(['rev-parse', '--git-dir']).ok) throw new Usage(`${ctx.repo} is not a git repository`);
  const tree = treeOf(git, { commit: f.commit });
  const info = {};
  const res = await withTreeCheckout(git, { tree, root: ctx.gatesRoot || GATES_ROOT, info }, dir => ciRun(ctx, dir));
  return { ...res, data: { ...res.data, tree, checkoutRemoved: info.removed === true } };
}

async function ciRun(ctx, checkout) {
  const f = ctx.flags;
  if (ctx.positionals.length > 1) throw new Usage(`ci: unexpected argument '${ctx.positionals[1]}'`);
  if (f.target !== undefined) throw new Usage('ci takes no --target: it runs the jobs of ci.yml on this checkout');
  if (f.expect !== undefined) throw new Usage('ci takes no --expect: a verdict that can be told to match a failure is not a gate');
  const root = checkout || (f.root !== undefined ? resolve(f.root) : repoPath());
  const wf = join(root, '.github', 'workflows', 'ci.yml');
  if (!existsSync(wf)) throw new Usage(`no .github/workflows/ci.yml under ${root}`);
  const fail1 = error => result(false, 'CI-UNREADABLE', { root, error, jobs: [], total: 0, pass: 0, fail: 1 });
  let parsed;
  try { parsed = parseWorkflow(readFileSync(wf, 'utf8')); } catch (e) { return fail1(String(e.message).slice(0, 300)); }
  const known = ['name', 'on', 'permissions', 'concurrency', 'jobs'];
  const odd = parsed.topKeys.filter(k => !known.includes(k));
  if (odd.length) return fail1(`ci.yml top-level keys not modelled: ${odd.join(', ')}`);
  if (parsed.jobs.length === 0) return fail1('ci.yml has no jobs');
  let jobs = parsed.jobs;
  if (f.job !== undefined) {
    jobs = parsed.jobs.filter(j => j.id === f.job);
    if (jobs.length === 0) throw new Usage(`no job '${f.job}' in ci.yml (jobs: ${parsed.jobs.map(j => j.id).join(', ')})`);
  }
  const manifest = loadManifest(ctx);
  const dir = toolsDir(ctx), binDir = binDirOf(dir);
  const st = { ctx, root, manifest, platKey: ctx.platform || platformKey(), binDir, childEnv: childEnvOf(ctx.env, binDir), flags: f };
  const out = [];
  for (const job of jobs) out.push(await runJob(job, st));
  const failed = out.filter(j => j.status === 'FAIL').length;
  return result(failed === 0, failed === 0 ? 'ok' : 'CI-FAILED', { root, jobs: out, total: out.length, pass: out.length - failed, fail: failed });
}

// What text mode prints (instead of the JSON object); every line passes through redact (section 5 rule 1).
export function ciText(obj, env) {
  const d = obj.data;
  const out = [];
  if (obj.error || !d) out.push(redact(`ERROR ${obj.error || obj.code}`, env));
  else if (d.error) out.push(redact(`FAIL ci.yml  ${d.error}`, env), `ci: ${d.total} jobs, ${d.pass} PASS, ${d.fail} FAIL`);
  else {
    for (const j of d.jobs) out.push(redact(`${j.status} ${j.id}  ${j.last}`, env));
    out.push(`ci: ${d.total} jobs, ${d.pass} PASS, ${d.fail} FAIL`);
  }
  if (d && d.tree && d.checkoutRemoved === false) out.push('warning: the checkout could not be removed; delete it by hand');
  return out.join('\n') + '\n';
}
