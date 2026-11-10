// ELEV8 copy of the Francine & Eli hook test (layout adapted 2026-10-26).
// Proves tools/agent-anchor.mjs and tools/write-guard.mjs behave, then breaks copies of them on purpose
// and proves the checks go red (watched-fail). Runs in a throwaway root under .claude/state/hooktest/,
// never touches the real gap log or session cache. Usage: node tools/test-agent-hooks.mjs
// Inside the platform kit: node tools/team-kit/test-agent-hooks.mjs (tests the kit's own files against test-fixture/).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Two homes. In a client project (tools/test-agent-hooks.mjs) it tests that project's icm/ and tools/. In the platform kit
// (tools/team-kit/, beside roles.example.json, no icm/ above it) it tests the kit's files against test-fixture/. Fixed 2026-11-10:
// in the kit it looked for tools/icm/agents/roles.json, which never existed there, and stopped on ENOENT.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = !fs.existsSync(path.join(HERE, '..', 'icm/agents/roles.json')) && fs.existsSync(path.join(HERE, 'roles.example.json'));
const REAL = KIT ? path.resolve(HERE, '../..') : path.resolve(HERE, '..');
// The throwaway root must not sit in the temp folder: the guard lets every role write there, so the checks would pass for the wrong reason.
const T = KIT ? path.join(os.homedir(), '.cache', 'team-kit-hooktest', String(process.pid)) : path.join(REAL, '.claude/state/hooktest');
const FIXTURE_NAME = { 'CLAUDE.md': 'CLAUDE.fixture.md', '.claude/POSITION.md': 'POSITION.fixture.md' };
function source(f) {
  if (!KIT) return path.join(REAL, f);
  if (f === 'icm/agents/roles.json') return path.join(HERE, 'roles.example.json');
  if (f.startsWith('tools/')) return path.join(HERE, path.basename(f));
  return path.join(HERE, 'test-fixture', FIXTURE_NAME[f] || f);
}
const COPY =['icm/agents/roles.json', 'icm/agents/_common.md', 'icm/agents/researcher.md', 'icm/agents/seo-analyst.md',
  'icm/agents/reviewer.md', 'icm/agents/lead.md', 'icm/phase-0/CONTEXT.md', 'icm/work/gaps/LOG.md', '.claude/POSITION.md', 'CLAUDE.md',
  'tools/agent-role.mjs', 'tools/agent-anchor.mjs', 'tools/write-guard.mjs'];

function setup() {
  fs.rmSync(T, { recursive: true, force: true });
  for (const f of COPY) {
    fs.mkdirSync(path.dirname(path.join(T, f)), { recursive: true });
    fs.copyFileSync(source(f), path.join(T, f));
  }
  const logF = path.join(T, 'icm/work/gaps/LOG.md'); // start from the header only: real agents' rows must not change the test
  fs.writeFileSync(logF, fs.readFileSync(logF, 'utf8').split('\n').filter(l => !/^\| G-/.test(l)).join('\n'));
  fs.appendFileSync(path.join(T, 'icm/work/gaps/LOG.md'),
    '| G-R-1 | 2026-10-17 | researcher | icm/phase-0/CONTEXT.md:12 | test gap | test rec | OPEN | |\n');
  fs.mkdirSync(path.join(T, 'transcripts'), { recursive: true });
  fs.mkdirSync(path.join(T, 'icm/gate'), { recursive: true });
}

let sidN = 0;
function session(firstText, { summaryFirst } = {}) {
  const sid = `test-${process.pid}-${++sidN}`;
  const tp = path.join(T, 'transcripts', sid + '.jsonl');
  const lines = [{ type: 'queue-operation' }, { type: 'user', isMeta: true, message: { role: 'user', content: 'ICM-ROLE: architect' } }];
  if (summaryFirst) lines.push({ type: 'user', isCompactSummary: true, message: { role: 'user', content: summaryFirst } });
  if (firstText !== null) lines.push({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: firstText }] } });
  if (firstText !== null) lines.push({ type: 'user', message: { role: 'user', content: 'ICM-ROLE: researcher' } }); // a later message never counts
  fs.writeFileSync(tp, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  return { session_id: sid, transcript_path: tp, cwd: T };
}

function run(script, payload, env = {}) {
  const r = spawnSync(process.execPath, [path.join(T, 'tools', script)], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 30000, env: { ...process.env, CLAUDE_PROJECT_DIR: T, ICM_ROLE: '', ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const guard = (s, tool, input) => run('write-guard.mjs', { ...s, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
const anchor = (s, ev, extra = {}) => run('agent-anchor.mjs', { ...s, hook_event_name: ev, ...extra });
const P = rel => path.join(T, rel);
const LOG = P('icm/work/gaps/LOG.md');

// Each check returns true when the behaviour is right.
function checks() {
  const lead = session('hi');
  const res = session('ICM-ROLE: researcher\nRun P0.5.');
  const resWin = session('<system-reminder>x</system-reminder>\r\nICM-ROLE: Researcher\r\n');
  const unknown = session('ICM-ROLE: hacker');
  const sumOnly = session('just a question', { summaryFirst: 'ICM-ROLE: researcher' });
  const oldLog = fs.readFileSync(LOG, 'utf8');
  const lastRow = oldLog.trimEnd().split('\n').pop();
  return {
    'lead may write CLAUDE.md': () => guard(lead, 'Write', { file_path: P('CLAUDE.md'), content: 'x' }).code === 0,
    'researcher may write its work folder': () => guard(res, 'Write', { file_path: P('icm/work/p0.1/NOTES.md'), content: 'x' }).code === 0,
    'researcher may write its folder itself (cp dest)': () => guard(res, 'Bash', { command: 'cp a.txt icm/work/p0.1/' }).code === 0,
    'researcher blocked from facts/': () => { const r = guard(res, 'Write', { file_path: P('facts/x.md'), content: 'x' }); return r.code === 2 && /WRITE BLOCKED/.test(r.err) && /GAP/.test(r.err); },
    'researcher blocked from CLAUDE.md (Edit, backslash path)': () => guard(res, 'Edit', { file_path: P('CLAUDE.md').replace(/\//g, '\\'), old_string: 'a', new_string: 'b' }).code === 2,
    'researcher blocked outside the project': () => guard(res, 'Write', { file_path: path.join(REAL, 'BRIEF.md'), content: 'x' }).code === 2,
    'researcher may write the temp folder': () => guard(res, 'Write', { file_path: path.join(os.tmpdir(), 'x.txt'), content: 'x' }).code === 0,
    'marker with reminder + CRLF + capitals still found': () => guard(resWin, 'Write', { file_path: P('facts/x.md'), content: 'x' }).code === 2,
    'gap log: appending a row is allowed': () => guard(res, 'Edit', { file_path: LOG, old_string: lastRow, new_string: lastRow + '\n| G-R-2 | x |' }).code === 0,
    'gap log: changing a row is blocked': () => guard(res, 'Edit', { file_path: LOG, old_string: '| OPEN |', new_string: '| RESOLVED |' }).code === 2,
    'gap log: rewriting it is blocked': () => guard(res, 'Write', { file_path: LOG, content: '# empty\n' }).code === 2,
    'gap log: Write that only appends is allowed': () => guard(res, 'Write', { file_path: LOG, content: oldLog + '| G-R-3 | x |\n' }).code === 0,
    'shell: redirect into facts/ blocked': () => guard(res, 'Bash', { command: 'echo hi > facts/a.md' }).code === 2,
    'shell: script output into own folder allowed': () => guard(res, 'Bash', { command: 'node tools/x.mjs 2>&1 > icm/work/p0.1/out.txt' }).code === 0,
    'shell: reading is allowed': () => guard(res, 'Bash', { command: 'cat CLAUDE.md | head -5 > /dev/null' }).code === 0,
    'shell: git commit blocked': () => guard(res, 'Bash', { command: 'git add -A && git commit -m x' }).code === 2,
    'shell: rm of a rules file blocked': () => guard(res, 'Bash', { command: 'rm BRIEF.md' }).code === 2,
    'G-A-2: sed with ; inside the quoted script, own file, allowed': () => guard(res, 'Bash', { command: "sed -i 's/answered none/answered/;s/a|b/c/' icm/work/p0.1/NOTES.md" }).code === 0,
    'heredoc append to the gap log with -> and | in the body allowed': () => guard(res, 'Bash', { command: "cat >> icm/work/gaps/LOG.md <<'EOF'\n| G-R-9 | 2026-10-17 | Researcher | a -> b | x > y | rec | OPEN | |\nEOF" }).code === 0,
    'heredoc into facts/ still blocked': () => guard(res, 'Bash', { command: "cat > facts/x.md <<'EOF'\nhello -> world\nEOF" }).code === 2,
    'G-A-2: same sed shape on a protocol still blocked': () => guard(res, 'Bash', { command: "sed -i 's/a/b/;s/c/d/' icm/phase-0/CONTEXT.md" }).code === 2,
    'shell: sed -i on a protocol blocked': () => guard(res, 'Bash', { command: "sed -i 's/a/b/' icm/phase-0/CONTEXT.md" }).code === 2,
    'powershell: Set-Content on CLAUDE.md blocked': () => guard(res, 'PowerShell', { command: `Set-Content -Path "${P('CLAUDE.md')}" -Value "x"` }).code === 2,
    'unknown role blocked everywhere': () => guard(unknown, 'Write', { file_path: P('icm/work/p0.1/a.md'), content: 'x' }).code === 2,
    'marker only in a compaction summary = Lead': () => guard(sumOnly, 'Write', { file_path: P('CLAUDE.md'), content: 'x' }).code === 0,
    'non-write tool ignored': () => guard(res, 'Read', { file_path: P('CLAUDE.md') }).code === 0,
    // Round E holes (icm/work/librarian/AUDIT-E-adversarial.md)
    'E3: cd then rm of a bare folder name blocked': () => guard(res, 'Bash', { command: 'cd icm && rm -rf facts' }).code === 2,
    'E3: rm of a bare name inside own folder allowed': () => guard(res, 'Bash', { command: 'cd icm/work/p0.1 && rm -f scratch' }).code === 0,
    'E7: &> redirect blocked': () => guard(res, 'Bash', { command: 'echo x &> facts/x.md' }).code === 2,
    'E7: >| redirect blocked': () => guard(res, 'Bash', { command: 'echo x >| facts/x.md' }).code === 2,
    'E8: Set-Content after a pipe blocked': () => guard(res, 'PowerShell', { command: '"x" | Set-Content facts/a.md' }).code === 2,
    'E8: curl -o into facts blocked': () => guard(res, 'Bash', { command: 'curl -s https://example.com -o facts/page.html' }).code === 2,
    'E8: curl -o into own folder allowed': () => guard(res, 'Bash', { command: 'curl -s https://example.com -o icm/work/p0.1/page.html' }).code === 0,
    'E8: git -C commit blocked': () => guard(res, 'Bash', { command: 'git -C . commit -m x' }).code === 2,
    'E8: .NET file write blocked': () => guard(res, 'PowerShell', { command: '[IO.File]::WriteAllText("icm/work/p0.1/a.md","x")' }).code === 2,
    'E9: inline node -e blocked': () => guard(res, 'Bash', { command: 'node -e "require(\'fs\').writeFileSync(\'facts/a.md\',\'x\')"' }).code === 2,
    'E9: script from the temp folder blocked': () => guard(res, 'Bash', { command: `node "${path.join(os.tmpdir(), 'p.mjs')}"` }).code === 2,
    'pdftotext writing into facts/ blocked': () => guard(res, 'Bash', { command: 'pdftotext a.pdf facts/a.txt' }).code === 2,
    'pdf-text.mjs output into own folder allowed': () => guard(res, 'Bash', { command: 'node tools/pdf-text.mjs "C:/x/a.pdf" > icm/work/p0.1/a.txt' }).code === 0,
    'E9: script from tools/ allowed': () => guard(res, 'Bash', { command: 'node tools/site-backup/summarize.mjs --out x' }).code === 0,
    'E10: Edit extending a middle row blocked': () => guard(res, 'Edit', { file_path: LOG, old_string: '| Status |', new_string: '| Status | x' }).code === 2,
    'E10: MultiEdit on the gap log blocked': () => guard(res, 'MultiEdit', { file_path: LOG, edits: [{ old_string: lastRow, new_string: lastRow + '\nx' }] }).code === 2,
    'app-shaped opening message (reminder + Background + marker) found': () => guard(session('<system-reminder>\nLinked sessions now: x\n</system-reminder>\n\nBackground (from the session that started this one): project text.\n\nICM-ROLE: researcher\nYou are the Researcher.'), 'Write', { file_path: P('facts/x.md'), content: 'x' }).code === 2,
    'E11: marker after a ``` fence still found': () => guard(session('```\nICM-ROLE: researcher\nhi\n```'), 'Write', { file_path: P('facts/x.md'), content: 'x' }).code === 2,
    'E12: setx / ICM_ROLE blocked': () => guard(res, 'Bash', { command: 'setx ICM_ROLE lead' }).code === 2,
    'E12: ICM_ROLE env cannot make an agent the Lead': () => run('write-guard.mjs', { ...res, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: P('facts/x.md'), content: 'x' } }, { ICM_ROLE: 'lead' }).code === 2,
    'E39: post-backup folder closed before the gate': () => guard(session('ICM-ROLE: researcher'), 'Write', { file_path: P('icm/work/p0.3/REPORT.md'), content: 'x' }).code === 2,
    'E39: post-backup folder open after the gate marker': () => {
      fs.writeFileSync(P('icm/gate/BACKUP-GATE.md'), '# Backup gate\nBACKUP VERIFIED 2026-10-26, Lead\n');
      const ok = guard(session('ICM-ROLE: researcher'), 'Write', { file_path: P('icm/work/p0.3/REPORT.md'), content: 'x' }).code === 0;
      fs.rmSync(P('icm/gate/BACKUP-GATE.md'));
      return ok;
    },
    'anchor at resume: charter, scope, protocols, open gap': () => {
      const s = session('ICM-ROLE: researcher\ngo');
      const r = anchor(s, 'SessionStart', { source: 'compact' });
      const t = JSON.parse(r.out).hookSpecificOutput.additionalContext;
      return r.code === 0 && /ANCHOR: you are the Researcher/.test(t) && /session compact/.test(t) && /You may write ONLY/.test(t)
        && /\| P0\.5 \|/.test(t) && /G-R-1/.test(t) && /Every agent on this project/.test(t) && /Writes only/.test(t);
    },
    'anchor from the opening prompt, then cached for the guard': () => {
      const s = session(null);
      const r1 = anchor(s, 'UserPromptSubmit', { prompt: 'ICM-ROLE: seo-analyst\nStart P0.7' });
      const r2 = anchor(s, 'UserPromptSubmit', { prompt: 'next' });
      const g = guard(s, 'Write', { file_path: P('facts/x.md'), content: 'x' });
      return /ANCHOR: you are the SEO analyst/.test(JSON.parse(r1.out).hookSpecificOutput.additionalContext)
        && /^ROLE SEO analyst:/.test(JSON.parse(r2.out).hookSpecificOutput.additionalContext) && g.code === 2;
    },
    'lead gets one line about open gaps': () => {
      const r = anchor(lead, 'SessionStart', { source: 'startup' });
      return /Gap log: 1 OPEN \(G-R-1\)/.test(JSON.parse(r.out).hookSpecificOutput.additionalContext);
    },
  };
}

function runAll(label) {
  const res = {};
  for (const [name, fn] of Object.entries(checks())) {
    let ok = false;
    try { ok = fn(); } catch { ok = false; }
    res[name] = ok;
  }
  if (label) {
    for (const [n, ok] of Object.entries(res)) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}`);
  }
  return res;
}

function edit(rel, fn) { const f = P(rel); fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8'))); }
function must(cond, what) { if (!cond) throw new Error(`patch did not apply: ${what}`); }

setup();
const base = runAll('baseline');
let failed = Object.values(base).filter(v => !v).length;
console.log(`baseline: ${Object.keys(base).length - failed}/${Object.keys(base).length} PASS`);

// Watched-fail: each mutant must turn the named checks red.
const MUTANTS = [
  ['researcher scope widened to **', () => edit('icm/agents/roles.json', t => { const o = JSON.parse(t); o.roles.researcher.writes = ['**']; return JSON.stringify(o); }),
    ['researcher blocked from facts/', 'shell: redirect into facts/ blocked']],
  ['append-only removed', () => edit('icm/agents/roles.json', t => { const o = JSON.parse(t); o.roles.researcher.appendOnly = []; return JSON.stringify(o); }),
    ['gap log: changing a row is blocked', 'gap log: rewriting it is blocked']],
  ['marker regex broken', () => edit('tools/agent-role.mjs', t => { must(t.includes('/^ICM-ROLE:'), 'marker'); return t.split('/^ICM-ROLE:').join('/^XICM-ROLE:'); }),
    ['researcher blocked from facts/', 'anchor at resume: charter, scope, protocols, open gap']],
  ['shell parsing off', () => edit('tools/write-guard.mjs', t => { const a = 'const { targets, problems } = shellTargets(ti.command || \'\', cwd, root);'; must(t.includes(a), 'shell'); return t.split(a).join('const targets = [], problems = [];'); }),
    ['shell: git commit blocked', 'shell: rm of a rules file blocked', 'powershell: Set-Content on CLAUDE.md blocked']],
  ['gate check off', () => edit('tools/write-guard.mjs', t => { const a = 'if (cfg.gate && matchesAny(rel, cfg.gate.closedPaths) && !gateOpen(root, cfg)) {'; must(t.includes(a), 'gate'); return t.split(a).join('if (false) {'); }),
    ['E39: post-backup folder closed before the gate']],
  ['cd tracking off', () => edit('tools/write-guard.mjs', t => { const a = 'if (tk[1]) cwd = normPath(tk[1], cwd); continue;'; must(t.includes(a), 'cd'); return t.split(a).join('continue;'); }),
    ['E3: rm of a bare name inside own folder allowed']], // without tracking, "scratch" resolves to the root and is (wrongly) blocked
  ['append-only position check off', () => edit('tools/write-guard.mjs', t => { const a = "return old.replace(/\\s+$/, '').endsWith(a.replace(/\\s+$/, '')) ? null : msg;"; must(t.includes(a), 'pos'); return t.split(a).join('return null;'); }),
    ['E10: Edit extending a middle row blocked']],
  ['quote-aware split off', () => edit('tools/write-guard.mjs', t => { const a = 'for (const seg of splitSegments(text)) {'; must(t.includes(a), 'split'); return t.split(a).join('for (const seg of text.split(/&&|\\|\\||;|(?<!>)\\||\\r?\\n/)) {'); }),
    ['G-A-2: sed with ; inside the quoted script, own file, allowed']],
  ['heredoc body skipping off', () => edit('tools/write-guard.mjs', t => { const a = "text = text.replace(/<<-?"; must(t.includes(a), 'heredoc'); return t.split(a).join("text = text; void (/<<-?"); }),
    ['heredoc append to the gap log with -> and | in the body allowed']],
  ['compaction summary counted', () => edit('tools/agent-role.mjs', t => { must(t.includes('o.isCompactSummary || '), 'summary'); return t.split('o.isCompactSummary || ').join(''); }),
    ['marker only in a compaction summary = Lead']],
];
for (const [name, mutate, expectRed] of MUTANTS) {
  setup();
  mutate();
  const r = runAll();
  const stillGreen = expectRed.filter(n => r[n]);
  const ok = stillGreen.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  watched-fail "${name}": ${ok ? 'went red as expected' : 'STAYED GREEN: ' + stillGreen.join('; ')}`);
}

fs.rmSync(T, { recursive: true, force: true });
console.log(failed ? `RESULT: ${failed} FAILED` : 'RESULT: ALL PASS');
process.exit(failed ? 1 : 0);
