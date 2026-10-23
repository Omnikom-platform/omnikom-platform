// GT-008 schema-present: the schema.org type(s) the plan names for a page are in the page's JSON-LD (a subtype counts:
// RealEstateAgent satisfies LocalBusiness and Organization; BlogPosting satisfies Article), the JSON-LD parses, the required
// fields of those types are filled (CODE-NEEDS-SEO §2), and FAQPage questions are the questions shown on the page.
// Exit 0 PASS, 1 FAIL, 2 cannot judge.
import { tokens, showsQuestion } from "./lib-text.mjs";
import { pass, fail, error, runCli } from "./lib-plan.mjs";

export const id = "GT-008";
export const title = "schema-present";
export const plain = "Each page carries the structured data (schema) the plan named, filled in";
// child -> direct parents (the part of the schema.org tree this skill's page types use)
const PARENT = {
  RealEstateAgent: ["LocalBusiness"], InsuranceAgency: ["FinancialService"], LocalBusiness: ["Organization", "Place"], ProfessionalService: ["LocalBusiness"], HomeAndConstructionBusiness: ["LocalBusiness"],
  FinancialService: ["LocalBusiness"], Organization: ["Thing"], Person: ["Thing"], Place: ["Thing"], Service: ["Intangible"], Intangible: ["Thing"],
  BlogPosting: ["SocialMediaPosting"], SocialMediaPosting: ["Article"], NewsArticle: ["Article"], Article: ["CreativeWork"],
  FAQPage: ["WebPage"], AboutPage: ["WebPage"], ContactPage: ["WebPage"], CollectionPage: ["WebPage"], WebPage: ["CreativeWork"], WebSite: ["CreativeWork"], CreativeWork: ["Thing"],
};
export function satisfies(have, want) {
  if (have === want) return true;
  return (PARENT[have] || []).some((p) => satisfies(p, want));
}
const REQUIRED = { Article: ["headline", "author", "datePublished"], RealEstateAgent: ["name", "url"], InsuranceAgency: ["name", "url"], LocalBusiness: ["name", "url"], Organization: ["name", "url"], Service: ["name"], WebSite: ["name", "url"], FAQPage: ["mainEntity"] };
const filled = (v) => (Array.isArray(v) ? v.length > 0 : v && typeof v === "object" ? Object.keys(v).length > 0 : typeof v === "string" ? v.trim().length > 0 : v != null);
function nodes(doc) {
  const out = [];
  const walk = (n) => { if (Array.isArray(n)) return n.forEach(walk); if (!n || typeof n !== "object") return; if (n["@type"]) out.push(n); if (n["@graph"]) walk(n["@graph"]); };
  walk(doc);
  return out;
}
const typesOf = (n) => [].concat(n["@type"]);

export function run(ctx) {
  const bad = [], skipped = [];
  let checked = 0;
  for (const p of ctx.sitemap.pages) {
    const pg = ctx.pageFor(p.path);
    if (!pg) { skipped.push(p.path); continue; }
    checked++;
    const bl = ctx.briefs.get(p.path);
    const want = bl.schema.length ? bl.schema : p.schema;
    let ok = true;
    for (const [i, b] of pg.jsonld.entries()) if (!b.parsed) { bad.push(`${p.path}: JSON-LD block ${i + 1} does not parse (${b.error})`); ok = false; }
    if (!ok) continue;
    const all = pg.jsonld.flatMap((b) => nodes(b.parsed));
    const have = [...new Set(all.flatMap(typesOf))];
    for (const w of want) {
      const node = all.find((n) => typesOf(n).some((t) => satisfies(t, w)));
      if (!node) { bad.push(`${p.path}: schema type ${w} is missing (page has: ${have.join(", ") || "no JSON-LD"})`); continue; }
      const req = REQUIRED[w] || [];
      for (const f of req) if (!filled(node[f])) bad.push(`${p.path}: ${w} has no ${f}`);
      if (w === "FAQPage" && Array.isArray(node.mainEntity)) {
        const blocks = pg.blocks.filter((x) => x.text).map((x) => new Set(tokens(x.text)));
        for (const [qi, q] of node.mainEntity.entries()) {
          if (!q?.name || !filled(q?.acceptedAnswer?.text)) bad.push(`${p.path}: FAQ question ${qi + 1} lacks a name or an answer`);
          else if (!showsQuestion(q.name, blocks)) bad.push(`${p.path}: FAQ question "${q.name}" is in the JSON-LD but not shown on the page`);
        }
      }
    }
  }
  const note = skipped.length ? [`NOTE not built, skipped (see GT-002): ${skipped.join(", ")}`] : [];
  if (!checked) return error("no planned page is built, nothing to check", note);
  if (bad.length) return fail(`${bad.length} schema problem(s) on ${checked} page(s)`, [...bad, ...note]);
  return pass(`${checked} page(s) carry their planned schema`, note);
}
runCli(import.meta.url, { id, run });
