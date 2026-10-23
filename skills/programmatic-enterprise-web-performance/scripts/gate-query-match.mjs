// GT-004 query-in-title-h1-meta-first-paragraph = shipgate TGT-004 (packs/targeting.md): the planned page carries its query where engines and people look
// first. The <title>, the <h1>, the meta description and the first paragraph of the main content each contain the primary query's head term (stemmed words,
// web-delivery section 12) or one of the cluster's queries as whole words (NFKC, case-folded). Pages the plan lists but the site lacks are GT-002's finding.
// Exit 0 PASS, 1 FAIL, 2 cannot judge.
// CHANGED 2026-10-22 (was: >= 80% token overlap of the primary query in title, H1 and first paragraph; the meta description only had to exist). Kept as clearly
// labelled EXTRAS that are not in TGT-004: exactly one H1, a local cluster's place named in title and H1, title > 60 / description > 160 characters (WARN).
import { carriesQuery } from "./lib-growth.mjs";
import { tokens } from "./lib-text.mjs";
import { pass, fail, error, runCli } from "./lib-plan.mjs";

export const id = "GT-004";
export const title = "query-in-title-h1-first-paragraph";
export const plain = "Each page says what it is about in its title, heading, description and first paragraph";
export function run(ctx) {
  const bad = [], warn = [], skipped = [], locale = ctx.locale;
  let checked = 0;
  for (const p of ctx.sitemap.pages) {
    const c = p.cluster && ctx.clusterById(p.cluster);
    if (!c) continue;
    const pg = ctx.pageFor(p.path);
    if (!pg) { skipped.push(p.path); continue; }
    checked++;
    const q = c.primaryQuery;
    const fields = [["title", pg.title], ["H1", pg.h1[0] || ""], ["meta description", pg.metaDescription || ""], ["first paragraph", pg.firstParagraph]];
    for (const [name, text] of fields) {
      if (!String(text).trim()) { bad.push(`${p.path}: missing-element: no ${name} (TGT-004 needs the query there)`); continue; }
      if (!carriesQuery(text, c, { locale })) bad.push(`${p.path}: ${name} does not contain the head term of "${q}" or any of the cluster's queries: "${String(text).slice(0, 80)}"`);
    }
    // extras (not in TGT-004)
    if (pg.h1.length !== 1) bad.push(`${p.path}: EXTRA (not TGT-004) ${pg.h1.length} H1 headings (needs exactly one)`);
    if (c.location) {
      const city = c.location.split(",")[0];
      // "near me" and other place-less queries demand no place
      if (tokens(city).every((t) => new Set(tokens(q)).has(t))) {
        for (const [name, text] of [["title", pg.title], ["H1", pg.h1[0] || ""]]) {
          const lack = tokens(city).filter((t) => !new Set(tokens(text)).has(t));
          if (lack.length) bad.push(`${p.path}: EXTRA (not TGT-004) ${name} does not name the place "${city}"`);
        }
      }
    }
    if (pg.title.length > 60) warn.push(`WARN ${p.path}: title is ${pg.title.length} characters (over 60)`);
    if (pg.metaDescription.length > 160) warn.push(`WARN ${p.path}: meta description is ${pg.metaDescription.length} characters (over 160)`);
  }
  const note = skipped.length ? [`NOTE not built, skipped (see GT-002): ${skipped.join(", ")}`] : [];
  if (!checked) return error("no cluster page is built, nothing to check", note);
  if (bad.length) return fail(`${bad.length} problem(s) on ${checked} page(s)`, [...bad, ...warn, ...note]);
  return pass(`${checked} page(s) carry their query`, [...warn, ...note]);
}
runCli(import.meta.url, { id, run });
