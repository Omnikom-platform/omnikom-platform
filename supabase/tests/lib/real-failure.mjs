// Where the real migration failed, in words a CI log keeps (the gates job shows only the last lines): the migration file and its own line,
// and the database's whole error (ERROR plus its DETAIL, HINT, CONTEXT and LINE lines). Head of operations finding, Clients' 37b,
// 2026-11-11: the walls printed "real migration fails; 626 mutants" and nobody could see which statement failed or why.
// psql reports `psql:<file>:<line>: ERROR: ...` with the line in the file it ran. run-local.mjs runs every migration as one file, each
// one after a marker line `-- >>> <name>`, so the marker before that line names the migration.

const ERR = /psql:(.+?\.sql):(\d+): (ERROR:[^\n]*(?:\r?\n(?:DETAIL|HINT|CONTEXT|LINE \d+|QUERY|WHERE):[^\n]*(?:\r?\n {2,}[^\n]*)*)*)/;
const base = p => p.split(/[\\/]/).pop();

// out: psql's output. files: { '<basename psql ran>': { label, src } }; src is that file's text when it holds `-- >>> <name>` markers.
export function whereFailed(out, files) {
  const text = String(out ?? '');
  const m = ERR.exec(text);
  if (!m) return { where: 'setup', line: null, error: text.trim().split(/\r?\n/).filter(Boolean).slice(-6).join('\n') || '(no output)' };
  const f = files[base(m[1])] ?? { label: base(m[1]), src: null };
  const at = Number(m[2]);
  const error = m[3].trim();
  if (f.src) {
    const lines = String(f.src).split('\n');
    for (let i = Math.min(at, lines.length) - 1; i >= 0; i--) {
      const mk = /^-- >>> (.+)$/.exec(lines[i]);
      if (mk) return { where: mk[1].trim(), line: at - 1 - i, error };   // the line after the marker is that file's line 1
    }
  }
  return { where: f.label, line: at, error };
}

// One line for the summary: the name, the line and the first line of the error.
export const failedLine = f => `${f.where}${f.line ? `:${f.line}` : ''}: ${f.error.split(/\r?\n/)[0]}`;
