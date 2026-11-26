// splitKeep(text, re): text cut at each match of the global pattern re, with re's capture group 1 (when it took part) kept at
// the end of the left piece. text.split(/(?<=[.?])\s+/) and splitKeep(text, /([.?])\s+/g) give the same pieces; packs may not
// carry a look-behind (docs/advisor/R2-design.md 5.2), so a converted pack uses the second form
// (factory/advisor/pack/rewrites.mjs, proven by factory/advisor/test/test-rewrites.mjs).
export function splitKeep(text, re) {
  if (!re.global) throw new Error("splitKeep: the pattern needs the g flag: " + re.source);
  const out = [];
  let from = 0;
  for (const m of text.matchAll(re)) {
    out.push(text.slice(from, m.index + (m[1] ?? "").length));
    from = m.index + m[0].length;
  }
  out.push(text.slice(from));
  return out;
}
