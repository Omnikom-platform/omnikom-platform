// scan: SQL text -> { header, statements }. No dependencies; the part of a SQL lexer the migration lint needs.
// Comments are dropped, string literals become '' in `norm` (and stay whole in `raw`), a dollar-quoted body becomes $$ in `norm` (its text
// is kept in `dollars`, so a DO block can be read), statements split at a top-level semicolon, and `norm` is lower case with single spaces.
// header: the `--` comment lines before the first token of the file ({ line, text }): the only place a directive is read from, so a
// directive inside a string or after the first statement is not one.
const IDENT = /[A-Za-z0-9_$]/;

export function scan(src) {
  const s = String(src).replace(/^﻿/, '');
  const statements = [];
  const header = [];
  let i = 0, line = 1, cur = null, sawToken = false;
  const open = () => { if (!cur) cur = { line, norm: '', raw: '', dollars: [], tokLines: [] }; return cur; };
  const add = (st, n, r) => { if (st.norm === '' || st.norm.endsWith(' ')) st.tokLines.push(line); st.norm += n; st.raw += r; };
  const end = () => {
    if (cur && cur.norm.trim() !== '') { cur.norm = cur.norm.toLowerCase().replace(/\s+/g, ' ').trim(); statements.push(cur); }
    cur = null;
  };
  const countLines = t => { for (let k = 0; k < t.length; k++) if (t[k] === '\n') line++; };
  while (i < s.length) {
    const c = s[i];
    if (c === '\n') { line++; if (cur) { cur.norm += ' '; cur.raw += '\n'; } i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') { if (cur) { cur.norm += ' '; cur.raw += c; } i++; continue; }
    if (c === '-' && s[i + 1] === '-') {
      let j = s.indexOf('\n', i); if (j < 0) j = s.length;
      if (!sawToken) header.push({ line, text: s.slice(i + 2, j) });
      if (cur) cur.norm += ' ';
      i = j; continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      sawToken = true;   // the header is the leading `--` lines only: an applier reading it with a regex stops at a block comment too
      let depth = 1, j = i + 2;
      while (j < s.length && depth > 0) {
        if (s[j] === '/' && s[j + 1] === '*') { depth++; j += 2; } else if (s[j] === '*' && s[j + 1] === '/') { depth--; j += 2; } else j++;
      }
      if (depth > 0) throw new Error(`line ${line}: a /* comment is never closed`);
      countLines(s.slice(i, j));
      if (cur) cur.norm += ' ';
      i = j; continue;
    }
    sawToken = true;
    if (c === "'") {
      const escapes = /[eE]/.test(s[i - 1] || '') && !(i >= 2 && IDENT.test(s[i - 2]));
      let j = i + 1;
      for (;;) {
        if (j >= s.length) throw new Error(`line ${line}: a string literal is never closed`);
        if (escapes && s[j] === '\\') { j += 2; continue; }
        if (s[j] === "'") { if (s[j + 1] === "'") { j += 2; continue; } break; }
        j++;
      }
      const lit = s.slice(i, j + 1);
      add(open(), "''", lit);
      countLines(lit); i = j + 1; continue;
    }
    if (c === '$' && !(i > 0 && IDENT.test(s[i - 1]))) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(s.slice(i, i + 80));
      if (m) {
        const close = s.indexOf(m[0], i + m[0].length);
        if (close < 0) throw new Error(`line ${line}: the dollar quote ${m[0]} is never closed`);
        const body = s.slice(i + m[0].length, close);
        const st = open(); add(st, '$$', s.slice(i, close + m[0].length));
        st.dollars.push({ body, line });
        countLines(s.slice(i, close + m[0].length)); i = close + m[0].length; continue;
      }
    }
    if (c === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= s.length) throw new Error(`line ${line}: a quoted identifier is never closed`);
        if (s[j] === '"') { if (s[j + 1] === '"') { j += 2; continue; } break; }
        j++;
      }
      const id = s.slice(i, j + 1);
      add(open(), id, id); i = j + 1; continue;
    }
    if (c === ';') { end(); i++; continue; }
    add(open(), c, c); i++;
  }
  end();
  for (const st of statements) if (/\bbegin\s+atomic\b/.test(st.norm)) throw new Error(`line ${st.line}: BEGIN ATOMIC is not supported by the migration lint (its body holds semicolons it would split)`);
  return { header, statements };
}
