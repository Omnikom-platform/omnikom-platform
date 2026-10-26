// Blocks an agent session from writing outside its role's paths (icm/agents/roles.json).
// Hook: PreToolUse on Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell (.claude/settings.json).
// The Lead (no ICM-ROLE marker) is never restricted. Blocked = exit 2 + a message telling the agent
// to file a gap instead. Paths after P0.1 stay closed until the backup gate file carries its marker.
// Shell commands: redirects (incl. &> >| *>), tee, sed -i, file verbs anywhere in a pipeline (with
// cd tracking), downloads to files, env persistence, git, and inline/temp-folder scripts are caught.
// It is a guard rail against drift, not a sandbox: the Lead still reviews agents' diffs.
// Test: node tools/test-agent-hooks.mjs
import fs from 'node:fs';
import path from 'node:path';
import {
  projectRoot, readStdinJson, loadRoles, detectRole, normPath, relToRoot, isTmp, matchesAny,
} from './agent-role.mjs';

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function block(msg) {
  process.stderr.write(msg + '\n');
  process.exit(2);
}

function gapHint(r) {
  return `If this change is needed, it is a GAP: append a row to icm/work/gaps/LOG.md (ID G-${r.letter}-<n>, format icm/templates/gap.md) and send the Lead one line. Do not try another way to write it.`;
}

function gateOpen(root, cfg) {
  const g = cfg.gate;
  if (!g) return true;
  try { return fs.readFileSync(path.join(root, g.signoffFile), 'utf8').includes(g.marker); } catch { return false; }
}

// Checks one absolute target path. Returns an error string or null.
function checkPath(abs, root, r, cfg) {
  if (isTmp(abs)) return null;
  const rel = relToRoot(abs, root);
  if (rel === null) return `"${abs}" is outside the project; the ${r.name} only writes inside it (or the temp folder).`;
  if (!matchesAny(rel, r.writes)) return `"${rel}" is outside the ${r.name}'s write scope (${r.writes.join(', ')}).`;
  if (cfg.gate && matchesAny(rel, cfg.gate.closedPaths) && !gateOpen(root, cfg)) {
    return `"${rel}" comes after the website backup, and the backup gate is not passed: ${cfg.gate.signoffFile} has no "${cfg.gate.marker}" line yet. Finish P0.1 and wait for the Lead.`;
  }
  return null;
}

const nl = s => String(s ?? '').replace(/\r\n/g, '\n');

function appendOnlyCheck(tool, ti, abs, root, r) {
  const rel = relToRoot(abs, root);
  if (rel === null || !matchesAny(rel, r.appendOnly || [])) return null;
  const msg = `"${rel}" is append-only: add new rows at the end, never change existing ones.`;
  let old = '';
  try { old = nl(fs.readFileSync(abs, 'utf8')); } catch { return null; }
  if (tool === 'Write') return nl(ti.content).replace(/\s+$/, '').startsWith(old.replace(/\s+$/, '')) ? null : msg;
  if (tool !== 'Edit' || ti.replace_all) return msg;
  // An Edit may only extend the file's last text: old_string must be the end of the file.
  const a = nl(ti.old_string), b = nl(ti.new_string);
  if (!a || !b.startsWith(a)) return msg;
  return old.replace(/\s+$/, '').endsWith(a.replace(/\s+$/, '')) ? null : msg;
}

// ---- shell -------------------------------------------------------------------------------------

const GIT_WRITE = /\bgit\b[^|;&\n]*?\s(commit|push|reset|checkout|switch|restore|rebase|merge|stash|clean|add|rm|mv|tag|revert|cherry-pick|am|apply|config|update-ref|filter-branch)\b/i;
const ENV_PERSIST = /\bsetx\b|SetEnvironmentVariable|\bICM_ROLE\b/i;
const DOTNET_WRITE = /\[(?:System\.)?IO\.(?:File|Directory)\]::(?:Write|Append|Create|Delete|Move|Copy|Replace)/i;
const DESTRUCTIVE = /^(rm|rmdir|rd|del|erase|Remove-Item|ri|mv|move|Move-Item|mi|ren|Rename-Item|rni|truncate|Clear-Content|clc|shred|unlink)$/i;
const WRITERS = /^(pdftotext|pdftoppm|cp|copy|Copy-Item|cpi|install|touch|mkdir|md|New-Item|ni|Set-Content|sc|Add-Content|ac|Out-File|ln|chmod|xcopy|robocopy|tar|unzip|Expand-Archive|Compress-Archive|icacls|attrib|dd)$/i;
const LAST_ARG_ONLY = /^(pdftotext|pdftoppm|cp|copy|Copy-Item|cpi|install|xcopy|robocopy|ln)$/i;
const PATH_FLAGS = /^-(path|literalpath|filepath|destination|destinationpath|outfile|o|output|O)$/i;
const INTERP = /^(node|nodejs|python|python3|py|deno|bun|ruby|perl|php|pwsh|powershell|cmd|bash|sh|zsh|wsl)(\.exe)?$/i;
const INLINE_FLAG = /^(-e|--eval|-p|--print|-c|-Command|-EncodedCommand|-enc|\/c|\/k)$/i;
const SKIP = new Set(['/dev/null', '$null', 'nul']);

function tokens(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const pathLike = t => /[\/\\]/.test(t) || /\.[A-Za-z0-9]{1,8}$/.test(t);

// Returns { targets: absolute paths written, problems: strings }.
// Split a command line into segments at && || ; | and newlines, but never inside quotes (a sed script like
// 's/a/b/;s/c/d/' is one argument; G-A-2). A "|" right after ">" is the >| redirect, not a pipe.
function splitSegments(text) {
  // Drop heredoc bodies (cat >> f <<'EOF' … EOF): the body is data, not commands, so a "->" or "|" in it must
  // not be read as a redirect or a pipe. The redirect on the cat line itself is still checked.
  text = text.replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g, (m) => m.split('\n')[0]);
  const out = [];
  let cur = '', q = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], two = text.slice(i, i + 2);
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (two === '&&' || two === '||') { out.push(cur); cur = ''; i++; continue; }
    if (c === ';' || c === '\n' || c === '\r' || (c === '|' && text[i - 1] !== '>')) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function shellTargets(cmd, cwd0, root) {
  const targets = [];
  const problems = [];
  const text = String(cmd);
  if (GIT_WRITE.test(text)) problems.push('git commands that change the repo are the Lead\'s job (single writer).');
  if (ENV_PERSIST.test(text)) problems.push('changing environment variables (setx / SetEnvironmentVariable / ICM_ROLE) is not allowed for agent sessions.');
  if (DOTNET_WRITE.test(text)) problems.push('.NET file writes ([IO.File]::...) are not allowed for agent sessions; use the Write tool inside your scope.');
  let cwd = cwd0;
  const add = t => { if (t && !SKIP.has(t.toLowerCase())) targets.push(normPath(t, cwd)); };
  for (const seg of splitSegments(text)) {
    const tk = tokens(seg);
    if (!tk.length) continue;
    // cd tracking: later segments resolve relative paths from the new folder.
    if (/^(cd|Set-Location|sl|pushd|chdir)$/i.test(tk[0])) { if (tk[1]) cwd = normPath(tk[1], cwd); continue; }
    // Redirects: > >> &> &>> *> >| 1> 2>  (not >&1 style duplications).
    const redir = /(?:\d|&|\*)?>>?\|?\s*("([^"]+)"|'([^']+)'|([^\s;|&<>]+))/g;
    let m;
    while ((m = redir.exec(seg))) add(m[2] ?? m[3] ?? m[4]);
    for (let i = 0; i < tk.length; i++) {
      const w = tk[i].replace(/^.*[\\/]/, '');
      if (/^(tee|Tee-Object)$/i.test(w)) { const t = tk.slice(i + 1).find(x => !x.startsWith('-')); add(t); }
      if (/^sed$/i.test(w) && tk.slice(i + 1).some(x => /^-[a-zA-Z]*i/.test(x) || x === '--in-place')) {
        const files = tk.slice(i + 1).filter(pathLike); if (files.length) add(files[files.length - 1]);
      }
      if (/^(curl|wget|Invoke-WebRequest|iwr|Invoke-RestMethod|irm|Start-BitsTransfer)$/i.test(w)) {
        for (let j = i + 1; j < tk.length; j++) if (PATH_FLAGS.test(tk[j]) && tk[j + 1]) add(tk[j + 1]);
      }
      if (INTERP.test(w)) {
        const rest = tk.slice(i + 1);
        if (rest.some(x => INLINE_FLAG.test(x))) problems.push(`inline code (${w} ${rest.find(x => INLINE_FLAG.test(x))}) is not allowed for agent sessions; scripts run from tools/ only, with the Lead's OK.`);
        const script = rest.find(x => !x.startsWith('-'));
        if (script && pathLike(script) && w.match(/^(node|nodejs|python|python3|py|deno|bun|ruby|perl|php)/i)) {
          const rel = relToRoot(normPath(script, cwd), root);
          if (rel === null || !rel.startsWith('tools/')) problems.push(`running "${script}" is not allowed: agent sessions run scripts from tools/ only (the Lead's code).`);
        }
      }
      if (DESTRUCTIVE.test(w)) {
        // Every non-flag argument is a target, bare names included ("rm -rf knowledge").
        for (let j = i + 1; j < tk.length; j++) { if (!tk[j].startsWith('-')) add(tk[j]); }
        break;
      }
      if (WRITERS.test(w)) {
        const args = [];
        const bareOk = LAST_ARG_ONLY.test(w) || /^(mkdir|md|touch|New-Item|ni)$/i.test(w);
        for (let j = i + 1; j < tk.length; j++) {
          const a = tk[j];
          if (PATH_FLAGS.test(a) && tk[j + 1]) { args.push(tk[j + 1]); j++; continue; }
          if (/^-(value|encoding|itemtype|type|name)$/i.test(a)) { j++; continue; } // flag + its value
          if (a.startsWith('-') || /^\/[a-z]$/i.test(a)) continue;                  // other flags (incl. xcopy /E)
          if (bareOk || pathLike(a)) args.push(a);
        }
        if (LAST_ARG_ONLY.test(w)) { if (args.length) add(args[args.length - 1]); } else args.forEach(add);
        break;
      }
    }
  }
  return { targets, problems };
}

// ---- main --------------------------------------------------------------------------------------

let isAgent = false;
try {
  const input = readStdinJson();
  const root = projectRoot();
  const tool = input.tool_name || '';
  if (!FILE_TOOLS.has(tool) && tool !== 'Bash' && tool !== 'PowerShell') process.exit(0);

  const { role } = detectRole(input, root);
  if (!role || role === 'lead') process.exit(0);
  isAgent = true;

  const cfg = loadRoles(root);
  const r = cfg.roles[role];
  if (!r) block(`WRITE BLOCKED: this session's ICM-ROLE "${role}" is not in icm/agents/roles.json. Tell the Lead.`);

  const ti = input.tool_input || {};
  const cwd = input.cwd || root;

  if (FILE_TOOLS.has(tool)) {
    const p = ti.file_path || ti.notebook_path;
    if (!p) process.exit(0);
    const abs = normPath(p, cwd);
    const err = checkPath(abs, root, r, cfg) || appendOnlyCheck(tool, ti, abs, root, r);
    if (err) block(`WRITE BLOCKED (${r.name}): ${err}\n${gapHint(r)}`);
    process.exit(0);
  }

  const { targets, problems } = shellTargets(ti.command || '', cwd, root);
  const errs = [...problems];
  for (const abs of targets) {
    const e = checkPath(abs, root, r, cfg);
    if (e) errs.push(e);
  }
  if (errs.length) block(`WRITE BLOCKED (${r.name}, shell): ${errs.join(' ')}\n${gapHint(r)}`);
  process.exit(0);
} catch (e) {
  // A broken guard must not silently allow everything for agents: fail closed for role sessions,
  // open for the Lead (who has to be able to fix it).
  process.stderr.write(`write-guard error: ${e.message}.${isAgent ? ' Tell the Lead; do not work around it.' : ''}\n`);
  process.exit(isAgent ? 2 : 0);
}
