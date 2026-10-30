// SCH-001 (P0): one <script type="application/ld+json"> per page with @graph; it parses; a WebPage node (or subtype) whose @id is
// {canonical}#webpage; a WebSite node or @id reference {origin}/#website; the home page carries the full Organization node
// {origin}/#organization; every @id reference resolves in the block or, for the organization and website ids, in the home block.
import { mk, headLine } from "../lib/check.mjs";
import { graphOf, typesOf, collectIds, WEBPAGE_TYPES } from "../lib/schema.mjs";

export const id = "SCH-001";
export const severity = "P0";
export const source = "checklist/web-delivery.md SCH-001";
const f = mk(id);

export function run(site) {
  const out = [];
  const origin = site.origin;
  const homeIds = new Set();
  const home = site.pages.get("/");
  if (home) for (const n of graphOf(home)) if (typeof n["@id"] === "string") homeIds.add(n["@id"]);
  for (const p of site.pageList) {
    const blocks = p.jsonld;
    if (blocks.length === 0) { out.push(f.fail(p.path, headLine(p), 'missing-element: the page has no <script type="application/ld+json">')); continue; }
    if (blocks.length > 1) out.push(f.fail(p.path, blocks[1].line, `duplicate-element: ${blocks.length} ld+json blocks, exactly one is allowed`));
    const b = blocks[0];
    if (b.error) { out.push(f.fail(p.path, b.line, `value-mismatch: the JSON-LD does not parse: ${b.error}`)); continue; }
    if (!b.parsed || typeof b.parsed !== "object" || !Array.isArray(b.parsed["@graph"])) { out.push(f.fail(p.path, b.line, "missing-element: the JSON-LD block has no @graph array")); continue; }
    const nodes = graphOf(p);
    const canon = site.canonicalOf(p);
    const wp = nodes.find((n) => typesOf(n).some((t) => WEBPAGE_TYPES.has(t)));
    if (!wp) out.push(f.fail(p.path, b.line, "missing-element: the @graph has no WebPage node (or subtype)"));
    else if (canon && wp["@id"] !== canon + "#webpage") out.push(f.fail(p.path, b.line, `value-mismatch: the WebPage @id "${wp["@id"]}" is not "${canon}#webpage"`));
    const ids = collectIds(b.parsed["@graph"]);
    if (origin) {
      const websiteId = origin + "/#website";
      const hasSite = nodes.some((n) => typesOf(n).includes("WebSite") && n["@id"] === websiteId) || ids.some((x) => x.id === websiteId);
      if (!hasSite) out.push(f.fail(p.path, b.line, `missing-element: no WebSite node or @id reference to ${websiteId}`));
      if (p.path === "/") {
        const org = nodes.find((n) => n["@id"] === origin + "/#organization");
        if (!org || typesOf(org).length === 0 || typeof org.name !== "string") out.push(f.fail(p.path, b.line, `missing-element: the home page carries no full Organization node with @id ${origin}/#organization`));
      }
    }
    const defined = new Set(ids.filter((x) => !x.ref).map((x) => x.id));
    const reported = new Set();
    for (const x of ids.filter((y) => y.ref)) {
      if (reported.has(x.id)) continue;
      reported.add(x.id);
      const shared = origin && (x.id === origin + "/#website" || x.id === origin + "/#organization");
      if (defined.has(x.id) || (shared && homeIds.has(x.id))) continue;
      out.push(f.fail(p.path, b.line, `value-mismatch: the @id reference "${x.id}" resolves to no node in the block${shared ? " or in the home page block" : ""}`));
    }
  }
  return out;
}
