// Watched-fail for start-all.mjs: a broken COPY of tools/departments with ONE rule removed, test/start-all.test.mjs against it
// (OMNIKOM_DEPT_TOOLS); a mutant is caught only when the check it was written for goes red (its name holds `expect`).
//   node tools/departments/test/start-all.mutants.mjs      exit 0 = every mutant caught (MUTANT_ONLY=<substring> runs just those)
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const A = 'start-all.mjs';
// [name, file, exact text, replacement, the check that must go red]
const MUTANTS = [
  ['a live head of operations is not a head', A, "if (n.startsWith(HOO_PREFIX)) return { role: 'head'", "if (false) return { role: 'head'", 'a live head of operations makes the dry run refuse'],
  ['a real start ignores the refusal', A, 'if (!opts.dryRun) throw new BuilderError(refusal);', '', 'a real start with a live head of operations is refused'],
  ['a department head is not a head', A, 'm = /^HEAD_([A-Za-z0-9-]+)_/.exec(n);', 'm = null;', 'a live department head is refused too'],
  ['a sidebar title is not a head', A, 'm = /^HEAD:\\s*([^,]+)/i.exec(n);', 'm = null;', 'a head named by its sidebar title'],
  ['a dead registry entry counts as live', A, "if (!p) return 'no such process';", 'if (!p) return null;', 'a registry entry whose process is gone'],
  ['a pid held by another program counts as live', A, 'if (!isClaudeProc(p)) return `pid now held by ${p.name}`;', '', 'a pid now held by another program (svchost)'],
  ['the creation time of the pid is not checked', A, 'if (!s.procStart || Math.abs(p.created - filetimeToMs(s.procStart)) > CREATED_SLACK_MS) return', 'if (false) return', 'a pid now held by a later claude.exe'],
  ['stale rows still count as live', A, 'live: rows.filter(s => s.stale === null)', 'live: rows', 'a pid now held by another program (svchost)'],
  ['the next name ignores the names taken', A, 'if (!taken.has(n)) return n;', 'return n;', 'the bare date, b and c are taken'],
  ['the registry is not read for names taken', A, "for (const s of readSessions()) texts.push(String(s.name || ''));", '', 'a name used only by a finished session'],
  ['a new date starts at b', A, "['', ...'bcdefghijklmnopqrstuvwxyz']", "[...'bcdefghijklmnopqrstuvwxyz']", 'a date nobody used starts at the bare date'],
  ['the whole auth output is printed as the email', A, 'return { known: true, loggedIn: true, email, org, plan };', 'return { known: true, loggedIn: true, email: raw, org, plan };', 'a planted secret in another field never reaches the output'],
  ['the scrub is gone', A, "export const scrub = (s) => String(s).replace(TOKENISH, '(hidden)');", 'export const scrub = (s) => String(s);', 'a token planted in the organisation field is hidden'],
  ['unreadable output is echoed in the reason', A, 'return { known: false, why: `claude auth status gave no JSON (exit ${status})` };', 'return { known: false, why: `claude auth status gave no JSON: ${raw}` };', 'output that cannot be read is named as unreadable'],
  ['an unconfirmed account still starts', A, "if (a !== 'y' && a !== 'yes') throw new BuilderError(", 'if (false) throw new BuilderError(', 'unreadable and the owner answers n'],
  ['not logged in still starts', A, 'if (acct.known && !acct.loggedIn) throw new BuilderError(', 'if (false) throw new BuilderError(', 'not logged in -> refused'],
  ['the takeover brief is never sent', A, 'const sent = (deps.send || headlessSend)(name, message);', 'const sent = { ok: true };', 'sends the takeover brief to the new name'],
  ['a brief that was not delivered is reported as fine', A, 'const tail = sent.ok ?', 'const tail = true ?', 'a brief that was not delivered is BLOCKED'],
  ['the message does not name the brief', A, 'Read ${BRIEF} and do what it says.`;', 'Carry on.`;', 'sends the takeover brief to the new name'],
];
let survived = 0, missing = 0;
const only = process.env.MUTANT_ONLY;
const RUN = MUTANTS.filter(m => !only || m[0].includes(only));
for (const [name, file, find, repl, expect] of RUN) {
  const dir = mkdtempSync(join(tmpdir(), 'omnikom-sa-mut-'));
  try {
    cpSync(TOOLS, dir, { recursive: true });
    const p = join(dir, file);
    const t = readFileSync(p, 'utf8');
    const n = t.split(find).length - 1;
    if (n !== 1) { missing++; console.log(`MISSING  ${name} (target text found ${n} times in ${file})`); continue; }
    writeFileSync(p, t.split(find).join(repl), 'utf8');
    const r = spawnSync(process.execPath, [join(dir, 'test', 'start-all.test.mjs')], { encoding: 'utf8', timeout: 120000, env: { ...process.env, OMNIKOM_DEPT_TOOLS: dir, OMNIKOM_REPO_ROOT: resolve(TOOLS, '..', '..') } });
    const red = ((r.stdout || '').match(/^FAIL .*$/gm) || []);
    const caught = r.status !== 0 && red.some(l => l.includes(expect));
    if (!caught) survived++;
    console.log(`${caught ? 'caught  ' : 'SURVIVED'} ${name.padEnd(52)} ${caught ? `(${red.length} red, incl. "${expect}")` : `(exit ${r.status}, ${red.length} red, "${expect}" not among them)`}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(`\n${RUN.length} mutants, ${RUN.length - survived - missing} caught, ${survived} survived, ${missing} target text missing`);
process.exit(survived || missing ? 1 : 0);
