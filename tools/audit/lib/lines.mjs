// Line numbers for the audit: every FAIL names <page>:<line>, the 1-based line of the tag (or text) that is wrong.

// 1-based line of the character at `index` in `text`.
export function lineAt(text, index) {
  let n = 1;
  const end = Math.min(index, text.length);
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// 1-based line of the `nth` (1-based) match of a RegExp in `text`; 1 when there is no such match.
export function lineOfNth(text, re, nth = 1) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m, k = 0;
  while ((m = g.exec(text))) { if (++k === nth) return lineAt(text, m.index); if (m[0] === "") g.lastIndex++; }
  return 1;
}

// 1-based line of the first occurrence of the literal string `needle` at or after `from`; 1 when absent.
export function lineOfText(text, needle, from = 0) {
  const i = text.indexOf(needle, from);
  return i < 0 ? 1 : lineAt(text, i);
}
