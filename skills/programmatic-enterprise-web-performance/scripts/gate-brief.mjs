// GT-005 brief-covered: what the brief asked for is on the built page: every outline heading is a heading on the page (>= 80% of
// its tokens), every required entity appears as a phrase in the page text, every question is a heading or a block of text, and
// the page has at least the minimum word count of the brief. Exit 0 PASS, 1 FAIL, 2 cannot judge.
import { overlap, tokens, seqContains, showsQuestion, coversTerm, THRESHOLD } from "./lib-text.mjs";
import { pass, fail, error, runCli } from "./lib-plan.mjs";

export const id = "GT-005";
export const title = "brief-covered";
export const plain = "Each page contains the sections, names and questions its brief asked for";
export function run(ctx) {
  const bad = [], skipped = [], warn = [], minCov = Number(ctx.business.targeting?.minTermCoverage ?? 0.6);
  let checked = 0;
  for (const p of ctx.sitemap.pages) {
    const pg = ctx.pageFor(p.path);
    if (!pg) { skipped.push(p.path); continue; }
    checked++;
    const b = ctx.briefs.get(p.path);
    const heads = pg.headings.filter((h) => h.level === 2).map((h) => new Set(tokens(h.text)));
    const plainText = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    for (const h of b.outline) {
      // a heading made only of stop words ("Who we are") has no tokens: match its plain text instead
      const hit = tokens(h).length ? heads.some((t) => overlap(h, t) >= THRESHOLD) : pg.headings.some((x) => x.level === 2 && plainText(x.text) === plainText(h));
      if (!hit) bad.push(`${p.path}: no heading "${h}"`);
    }
    const seq = tokens(pg.text);
    for (const e of b.entities) if (!seqContains(seq, e)) bad.push(`${p.path}: entity "${e}" is not on the page`);
    const blocks = pg.blocks.filter((x) => x.text).map((x) => new Set(tokens(x.text)));
    for (const q of b.questions) if (!showsQuestion(q, blocks)) bad.push(`${p.path}: question "${q}" is not on the page`);
    // 06 section 9.5 / TGT-005 (W): the page covers a required term when it appears in its main content; fewer than targeting.minTermCoverage (0.6) covered is a warning, a FAIL under --strict.
    if (b.requiredTerms?.length) {
      const miss = b.requiredTerms.filter((t) => !coversTerm(pg.mainText, t, { locale: ctx.locale })), cov = 1 - miss.length / b.requiredTerms.length;
      if (cov < minCov) { const msg = `${p.path}: covers ${Math.round(cov * 100)}% of the ${b.requiredTerms.length} required terms (needs ${Math.round(minCov * 100)}%); missing: ${miss.slice(0, 12).join(", ")}${miss.length > 12 ? ", ..." : ""}`; if (ctx.strict) bad.push(`TGT-005 ${msg}`); else warn.push(`WARN TGT-005 ${msg}`); }
    }
    if (b.wordRange && pg.wordCount < b.wordRange.min) bad.push(`${p.path}: ${pg.wordCount} words, the brief needs at least ${b.wordRange.min}`);
  }
  const note = skipped.length ? [`NOTE not built, skipped (see GT-002): ${skipped.join(", ")}`] : [];
  if (!checked) return error("no planned page is built, nothing to check", note);
  if (bad.length) return fail(`${bad.length} brief item(s) missing on ${checked} page(s)`, [...bad, ...warn, ...note]);
  return pass(`${checked} page(s) cover their briefs`, [...warn, ...note]);
}
runCli(import.meta.url, { id, run });
