// GT-009 programmatic-quality: pages made from one template (plan/programmatic.json groups) pass the numeric gate that stops
// thin or swapped-city pages: >= minWords, >= minUniqueWords (words not inside a 5-word run found on a sibling page), >=
// minLocalFacts (record values from plan/programmatic-data.json that appear on the page, each with a source and a date), and a
// similarity (share of the page's 5-word runs found on a sibling) of at most maxSimilarity. Exit 0 PASS, 1 FAIL, 2 cannot judge.
import { words, shingles } from "./lib-text.mjs";
import { pass, fail, error, runCli } from "./lib-plan.mjs";

export const id = "GT-009";
export const title = "programmatic-quality";
export const plain = "Pages built from a template are real local pages, not the same page with the town swapped";
export function metrics(texts, n = 5) {
  const w = texts.map((t) => words(t).map((x) => x.toLowerCase()));
  const sh = w.map((list) => shingles(list, n));
  return w.map((list, i) => {
    const others = new Set(sh.flatMap((s, j) => (j === i ? [] : s)));
    const covered = new Set();
    sh[i].forEach((g, k) => { if (others.has(g)) for (let d = 0; d < n; d++) covered.add(k + d); });
    const shared = sh[i].filter((g) => others.has(g)).length;
    return { words: list.length, uniqueWords: list.length - covered.size, similarity: sh[i].length ? shared / sh[i].length : 0 };
  });
}
export function run(ctx) {
  const prog = ctx.programmatic, g = prog.gate;
  if (!prog.groups.length) return pass("no programmatic pages planned");
  const data = ctx.programmaticData.records || {};
  const bad = [], lines = [], skipped = [];
  let checked = 0;
  for (const grp of prog.groups) {
    const built = grp.pages.map((p) => ({ path: p, pg: ctx.pageFor(p) })).filter((x) => x.pg);
    for (const p of grp.pages) if (!ctx.pageFor(p)) skipped.push(p);
    const m = metrics(built.map((x) => x.pg.mainText), g.shingleSize || 5);
    built.forEach((x, i) => {
      checked++;
      const rec = data[x.path];
      const facts = rec ? (rec.facts || []).filter((f) => f.value && f.source && f.date && x.pg.mainText.toLowerCase().includes(String(f.value).toLowerCase())).length : 0;
      const r = m[i];
      lines.push(`${x.path}: ${r.words} words, ${r.uniqueWords} unique, ${facts} sourced local facts, ${Math.round(r.similarity * 100)}% similar to a sibling`);
      if (!rec) bad.push(`${x.path}: no record in plan/programmatic-data.json`);
      if (r.words < g.minWords) bad.push(`${x.path}: ${r.words} words, needs ${g.minWords}`);
      if (r.uniqueWords < g.minUniqueWords) bad.push(`${x.path}: ${r.uniqueWords} unique words, needs ${g.minUniqueWords}`);
      if (facts < g.minLocalFacts) bad.push(`${x.path}: ${facts} sourced local facts on the page, needs ${g.minLocalFacts}`);
      if (built.length > 1 && r.similarity > g.maxSimilarity) bad.push(`${x.path}: ${Math.round(r.similarity * 100)}% of its text is shared with a sibling page, at most ${Math.round(g.maxSimilarity * 100)}%`);
    });
  }
  const note = skipped.length ? [`NOTE not built, skipped (see GT-002): ${[...new Set(skipped)].join(", ")}`] : [];
  if (!checked) return error("no programmatic page is built", note);
  if (bad.length) return fail(`${bad.length} thin-page problem(s) on ${checked} page(s)`, [...bad, ...lines.map((l) => "NOTE " + l), ...note]);
  return pass(`${checked} programmatic page(s) pass the quality gate`, [...lines.map((l) => "NOTE " + l), ...note]);
}
runCli(import.meta.url, { id, run });
