// Shared by tools/agent-anchor.mjs and tools/write-guard.mjs.
// Who is this session? The first line of its opening prompt says so: "ICM-ROLE: <role>"
// (icm/agents/boot-prompts.md). No marker = the Lead. Roles and write scopes: icm/agents/roles.json.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || path.resolve(HERE, '..');
}

export function readStdinJson() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

export function loadRoles(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'icm/agents/roles.json'), 'utf8'));
}

const MARKER_RE = /^ICM-ROLE:\s*([a-z0-9-]+)\s*$/i;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter(p => p && p.type === 'text').map(p => p.text || '').join('\n');
  return '';
}

// The marker line of the opening message, if it has one, else its first line. The app puts its own text
// ("Linked sessions…", "Background (from…)") before the prompt, so the marker is searched on every line of
// the FIRST message (outside system-reminders); later messages never count.
function firstLine(text) {
  const clean = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
  const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '' && !/^```/.test(l));
  return lines.find(l => MARKER_RE.test(l)) || lines[0] || '';
}

// The session's first real user message (not meta, not a compaction summary, not a tool result).
// Returns { found: bool, line: string }.
function firstUserLine(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return { found: false, line: '' };
  const fd = fs.openSync(transcriptPath, 'r');
  try {
    const buf = Buffer.alloc(8 * 1024 * 1024); // the opening message is near the top; 8 MB covers huge pastes
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    for (const l of buf.toString('utf8', 0, n).split('\n')) {
      if (!l.trim()) continue;
      let o; try { o = JSON.parse(l); } catch { continue; }
      if (o.type !== 'user' || o.isMeta || o.isCompactSummary || !o.message) continue;
      const c = o.message.content;
      if (Array.isArray(c) && c.some(p => p && p.type === 'tool_result')) continue;
      const t = textOf(c);
      if (!t.trim()) continue;
      return { found: true, line: firstLine(t) };
    }
  } finally { fs.closeSync(fd); }
  return { found: false, line: '' };
}

function cacheFile(root, sid) {
  return path.join(root, '.claude/state/roles', String(sid).replace(/[^A-Za-z0-9_.-]/g, '_') + '.json');
}

// Returns { role: '<name>' | 'lead' | null, fresh: bool }. null = not decidable yet (no user message).
// fresh = decided for the first time in this call (the anchor then injects the full charter).
export function detectRole(input, root, { prompt } = {}) {
  // No environment-variable override: the role comes only from the session's own opening message.
  const sid = input.session_id;
  if (sid) {
    try { return { role: JSON.parse(fs.readFileSync(cacheFile(root, sid), 'utf8')).role, fresh: false }; } catch {}
  }
  let first = firstUserLine(input.transcript_path);
  if (!first.found && typeof prompt === 'string' && prompt.trim()) first = { found: true, line: firstLine(prompt) };
  if (!first.found) return { role: null, fresh: false };
  const m = first.line.match(MARKER_RE);
  const role = m ? m[1].toLowerCase() : 'lead';
  if (sid) {
    try {
      fs.mkdirSync(path.dirname(cacheFile(root, sid)), { recursive: true });
      fs.writeFileSync(cacheFile(root, sid), JSON.stringify({ role, decidedAt: new Date().toISOString() }));
    } catch {}
  }
  return { role, fresh: true };
}

// ---- paths -------------------------------------------------------------------------------------

export function normPath(p, cwd) {
  let s = String(p).trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/');
  const drive = s.match(/^\/([a-zA-Z])(\/|$)/);
  if (drive) s = drive[1] + ':/' + s.slice(3);
  if (s === '/tmp' || s.startsWith('/tmp/')) s = os.tmpdir().replace(/\\/g, '/') + s.slice(4);
  if (!/^[a-zA-Z]:\//.test(s) && !s.startsWith('/')) s = path.resolve(cwd || projectRoot(), s).replace(/\\/g, '/');
  s = path.posix.normalize(s);
  return process.platform === 'win32' ? s.toLowerCase() : s;
}

function globRe(glob) {
  let g = glob.replace(/\\/g, '/');
  let tail = '';
  if (g.endsWith('/**')) { g = g.slice(0, -3); tail = '(?:/.*)?'; } // "dir/**" also matches "dir" itself
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += '.*'; i++; }
    else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]]/g, '\\$&');
  }
  return new RegExp('^' + re + tail + '$', process.platform === 'win32' ? 'i' : '');
}

// Is an absolute normalised path inside the project? Returns the project-relative path or null.
export function relToRoot(abs, root) {
  const r = normPath(root) + '/';
  return abs.startsWith(r) ? abs.slice(r.length) : null;
}

export function isTmp(abs) {
  const t = normPath(os.tmpdir()) + '/';
  return abs.startsWith(t);
}

export function matchesAny(rel, globs) {
  return (globs || []).some(g => globRe(g).test(rel));
}

// ---- status for the anchor -----------------------------------------------------------------------

export function gapRows(root) {
  const f = path.join(root, 'icm/work/gaps/LOG.md');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split(/\r?\n/)
    .filter(l => /^\|\s*G-[A-Z]+-\d+\s*\|/.test(l))
    .map(l => {
      const c = l.split('|').slice(1, -1).map(s => s.trim());
      return { id: c[0], date: c[1], agent: c[2], where: c[3], gap: c[4], rec: c[5], status: (c[6] || '').toUpperCase(), resolution: c[7] || '', raw: l };
    });
}

export function phaseRows(root, label) {
  const out = [];
  for (const f of ['icm/phase-0/CONTEXT.md', 'icm/phase-1/CONTEXT.md']) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    const rows = lines.filter(l => l.startsWith('|') && /\bP[01]\.\d+\b/.test(l) && l.toLowerCase().includes(label.toLowerCase()));
    if (rows.length) out.push(`From \`${f}\`:`, ...rows);
  }
  return out;
}

export function leadSessionId(root) {
  try {
    const t = fs.readFileSync(path.join(root, '.claude/POSITION.md'), 'utf8');
    const m = t.match(/\*\*Lead\*\*\s*\|\s*`([^`]+)`/);
    return m ? m[1] : null;
  } catch { return null; }
}

export function readText(root, rel) {
  try { return fs.readFileSync(path.join(root, rel), 'utf8').trim(); } catch { return `(missing: ${rel})`; }
}
