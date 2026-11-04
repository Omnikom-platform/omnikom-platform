// Watched-fail for start-builder.mjs / stop-builder.mjs / builder-lib.mjs: a broken COPY of tools/departments with ONE rule removed,
// test/start-builder.test.mjs against it (OMNIKOM_DEPT_TOOLS), the suite must go red. Same method as test/mutate.mjs.
//   node ~/.claude/scripts/heavy.mjs -- node tools/departments/test/start-builder.mutants.mjs      exit 0 = every mutant caught
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const L = 'builder-lib.mjs', S = 'start-builder.mjs', X = 'stop-builder.mjs';
const MUTANTS = [
  // start: the refusals
  ['a department with no charter is accepted', L, 'if (!charter) throw new BuilderError(', 'if (false) throw new BuilderError('],
  ['any slice is accepted', L, 'if (!SLICE_RE.test(slice)) throw new BuilderError(', 'if (false) throw new BuilderError('],
  ['a slice may hold an underscore', L, '[A-Za-z0-9.-]{0,39}$/;', '[A-Za-z0-9._-]{0,39}$/;'],
  ['a slice may be 400 characters', L, '[A-Za-z0-9.-]{0,39}$/;', '[A-Za-z0-9.-]{0,399}$/;'],
  ['an unknown model is accepted', L, 'if (!MODELS.includes(chosen)) throw new BuilderError(', 'if (false) throw new BuilderError('],
  ['an unknown effort is accepted', L, 'if (effort && !EFFORTS.includes(effort)) throw new BuilderError(', 'if (false) throw new BuilderError('],
  ['the model ignores the charter', L, "const chosen = (model || charter.builderModel || '').toLowerCase();", "const chosen = (model || 'haiku').toLowerCase();"],
  ['a launcher folder with "claude" in it is accepted', L, 'if (/claude/i.test(d)) throw new BuilderError(', 'if (false) throw new BuilderError('],
  ['a cwd with a % or a quote is accepted', L, 'if (/["%\\r\\n]|claude/i.test(dir)) throw new BuilderError(', 'if (false) throw new BuilderError('],
  ['a cwd that does not exist is accepted', L, 'if (!worktree && !existsSync(dir)) throw new BuilderError(', 'if (false) throw new BuilderError('],
  // the builder's worktree (work order 04)
  ['without --cwd the builder starts in the repository again', L, 'dir = builderDir(ws, dept, slice);', 'dir = ROOT;'],
  ['without --cwd no worktree is asked for', L, 'const worktree = !cwd;', 'const worktree = false;'],
  ['the worktree is not made before the launch', S, 'if (p.worktree) (deps.worktree || ensureWorktree)(p.cwd);', ''],
  ['the workspace is not found by walking up', L, "if (existsSync(join(d, 'code', 'main', '.git'))) return d;", 'return null;'],
  ['an existing worktree is added again', L, 'key(dir))) return { dir, made: false, base: null };', 'key(dir))) { /* mutant */ }'],
  ['a folder that is not a worktree is taken over', L, 'if (existsSync(dir)) throw new BuilderError(`${dir} exists', 'if (false) throw new BuilderError(`${dir} exists'],
  ['master is not fetched before the worktree is made', L, 'if (!process.env.OMNIKOM_BUILDER_BASE) {', 'if (false) {'],
  ['a failed fetch still makes the worktree', L, 'if (!fe.ok) throw new BuilderError(`BLOCKED: git fetch', 'if (false) throw new BuilderError(`BLOCKED: git fetch'],
  ['the worktree is not detached', L, "'worktree', 'add', '--detach', dir, base]", "'worktree', 'add', dir, base]"],
  // the launcher
  ['the launcher clears one marker too few (own check gone)', L, 'for (const n of CLEARED) if (!new RegExp(', 'for (const n of CLEARED.slice(0, 0)) if (!new RegExp('],
  ['the launcher never clears CLAUDE_PID', L, "'CLAUDE_CODE_SESSION_ID', 'CLAUDE_PID', 'CLAUDECODE'];", "'CLAUDE_CODE_SESSION_ID', 'CLAUDECODE'];"],
  // two layers ask the guard (launcherProblems and verdict, which calls it); either alone is an equivalent mutant, so both go
  ['the guard is not asked about the launcher', L, ['const out = [...guard.launcherProblems(text)];', 'const why = guard.verdict(`Start-Process "${path}"`, () => text);'], ['const out = [];', 'const why = null;']],
  ['a launcher with a prompt is still started', L, '--permission-mode bypassPermissions`,', '"do the task now please" --permission-mode bypassPermissions`,'],
  ['the launcher drops the window title', L, '`title ${p.name}`,', "'rem',"],
  ['the launcher drops the permission mode', L, ' --permission-mode bypassPermissions`,', '`,'],
  // start: the run
  ['--dry-run still writes the launcher folder', S, 'if (opts.dryRun) return {', 'if (opts.dryRun) mkdirSync(launchDir(), { recursive: true });\n  if (opts.dryRun) return {'],
  ['a second session with a live name is started', S, 'if (twin) throw new BuilderError(', 'if (false) throw new BuilderError('],
  ['a launcher that never registered is left behind', S, "  rmSync(path, { force: true });\n  throw new BuilderError(`BLOCKED", "  throw new BuilderError(`BLOCKED"],
  // stop
  ['a pid with no registry file is stopped', X, 'if (!s) throw new BuilderError(', 'if (false) throw new BuilderError('],
  ['any session name may be stopped', X, 'if (!String(s.name || \'\').startsWith(namePrefix)) throw new BuilderError(', 'if (false) throw new BuilderError('],
  ['the creation time of the pid is not checked', X, 'if (!s.procStart || Math.abs(root.created - filetimeToMs(s.procStart)) > CREATED_SLACK_MS) throw new BuilderError(', 'if (false) throw new BuilderError('],
  ['a pid that is not positive is accepted', X, 'if (!Number.isInteger(pid) || pid <= 0) throw new BuilderError(', 'if (false) throw new BuilderError('],
  ['a session already gone is not noticed', X, "if (!root) return { name: s.name, pid, stopped: [], left: [], note: 'already gone' };", ''],
  ['the tree is killed outermost first', L, '.sort((a, b) => b.depth - a.depth)', '.sort((a, b) => a.depth - b.depth)'],
  ['a child older than its parent joins the tree', L, 'c.created >= out[i].created &&', 'true &&'],
  ['every process is a child of the session', L, 'if (c.ppid === out[i].pid &&', 'if (true &&'],
  ['the fresh listing does not re-check the creation time', L, 'if (now.created !== v.created) {', 'if (false) {'],
  ['what is left after the kill is not reported', L, 'if (was || carries) left.push(', 'if (false) left.push('],
];
let survived = 0, missing = 0;
const only = process.env.MUTANT_ONLY;   // a substring of a mutant name: re-run just those (the default is all)
const RUN = MUTANTS.filter(m => !only || m[0].includes(only));
for (const [name, file, find, repl] of RUN) {
  const dir = mkdtempSync(join(tmpdir(), 'omnikom-sb-mut-'));
  try {
    cpSync(TOOLS, dir, { recursive: true });
    const p = join(dir, file);
    const t = readFileSync(p, 'utf8');
    const finds = [].concat(find), repls = [].concat(repl);
    const counts = finds.map(f => t.split(f).length - 1);
    if (counts.some(n => n !== 1)) { missing++; console.log(`MISSING  ${name} (target text found ${counts.join('/')} times in ${file})`); continue; }
    writeFileSync(p, finds.reduce((acc, f, i) => acc.split(f).join(repls[i]), t), 'utf8');
    const r = spawnSync(process.execPath, [join(dir, 'test', 'start-builder.test.mjs')], { encoding: 'utf8', timeout: 240000, env: { ...process.env, OMNIKOM_DEPT_TOOLS: dir, OMNIKOM_REPO_ROOT: resolve(TOOLS, '..', '..') } });
    const red = ((r.stdout || '').match(/^FAIL .*$/gm) || []).map(l => l.slice(5, 70));
    // caught = the suite went red on a named check; a crash or a timeout with no FAIL line is NOT a catch (it would hide a broken test)
    const caught = r.status !== 0 && red.length > 0;
    if (!caught) survived++;
    console.log(`${caught ? 'caught  ' : 'SURVIVED'} ${name.padEnd(60)} ${caught ? `(${red.length} red: ${red[0]})` : `(exit ${r.status}, ${red.length} red${r.status !== 0 ? ': ' + String(r.stderr || r.stdout || '').trim().split(/\r?\n/).pop().slice(0, 80) : ''})`}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(`\n${RUN.length} mutants, ${RUN.length - survived - missing} caught, ${survived} survived, ${missing} target text missing`);
process.exit(survived || missing ? 1 : 0);
