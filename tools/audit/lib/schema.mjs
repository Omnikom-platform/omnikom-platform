// JSON-LD helpers shared by SCH-001 and URL-009.

// A WebPage node or one of the subtypes the rule accepts.
export const WEBPAGE_TYPES = new Set(["WebPage", "AboutPage", "ContactPage", "CollectionPage", "FAQPage", "ItemPage", "ProfilePage", "SearchResultsPage"]);

export const typesOf = (node) => (node && typeof node === "object" ? [].concat(node["@type"] ?? []).map(String) : []);
export const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

// The top-level nodes of the page's first ld+json block: its @graph array, or [] when the block is missing, unparsed or has no @graph.
export function graphOf(page) {
  const b = page.jsonld[0];
  if (!b || !b.parsed || !isObject(b.parsed) || !Array.isArray(b.parsed["@graph"])) return [];
  return b.parsed["@graph"].filter(isObject);
}

// Every object with an "@id" anywhere under `value`: { id, ref } where ref is true when the object holds nothing but the "@id".
export function collectIds(value, out = []) {
  if (Array.isArray(value)) { for (const v of value) collectIds(v, out); return out; }
  if (!isObject(value)) return out;
  if (typeof value["@id"] === "string") out.push({ id: value["@id"], ref: Object.keys(value).length === 1 });
  for (const [k, v] of Object.entries(value)) if (k !== "@id") collectIds(v, out);
  return out;
}
