// Small helpers every check file uses: finding constructors (so a check cannot misspell a status) and body line lookup.
import { lineOfNth } from "./lines.mjs";

export function mk(rule) {
  const one = (what) => String(what).replace(/\s+/g, " ").trim();
  return {
    fail: (page, line, what) => ({ rule, page, line: Math.max(1, line | 0), what: one(what), status: "FAIL" }),
    warn: (page, line, what) => ({ rule, page, line: Math.max(1, line | 0), what: one(what), status: "WARN" }),
    skip: (page, what) => ({ rule, page, line: 0, what: one(what), status: "SKIP" }),
  };
}

// Line of the <body> tag (1 when the page has none): where a "this page has no X" finding points.
export const bodyLine = (page) => lineOfNth(page.raw, /<body\b/i);
export const headLine = (page) => lineOfNth(page.raw, /<head\b/i);

// Unicode code points of the NFC form of a string, whitespace collapsed and trimmed (MET-001 length).
export const codePoints = (s) => [...String(s).normalize("NFC").replace(/\s+/g, " ").trim()].length;
