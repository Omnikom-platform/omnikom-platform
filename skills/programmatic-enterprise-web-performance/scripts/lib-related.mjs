// lib-related.mjs: the businesses the owner declared RELATED to the client: a teammate (an agent on the same team) or the brokerage.
// A related business is never a competitor: not in a competitor table, bar, link list, ad line or review comparison, never called "your rival".
// Declared ONCE, in the business record (intake answer `related`: [{ relation, domain, name }], domain or name or both, owner-only), and written by
// competitors-discover.mjs, or by `approve.mjs <target> competitors --exclude <domain> --as teammate|brokerage`, into excluded[] of the competitors
// file with the relation in each row: { domain|null, name|null, relation, reason, by?, at? }. The readers ask relatedOf(pewp); a row of excluded[]
// with no `relation` (an aggregator, a government site) is the older list and is not read here.
import fs from "node:fs";
import path from "node:path";

export const RELATIONS = ["teammate", "brokerage"];
export const hostOf = (d) => String(d || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/^www\./, "");
export const nameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); // case and punctuation aside
const J = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };
const text = (x) => typeof x === "string" && x.trim() !== "";

// the reasons a declared list is not valid (empty = valid): each row has a relation and a domain or a name
export function relatedErrors(list) {
  if (!Array.isArray(list)) return ["related must be a list of { relation, domain, name }"];
  const out = [];
  list.forEach((x, i) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) out.push(`related[${i}] must be an object { relation, domain, name }`);
    else {
      if (!RELATIONS.includes(x.relation)) out.push(`related[${i}].relation must be ${RELATIONS.join(" or ")}`);
      if (!text(x.domain) && !text(x.name)) out.push(`related[${i}] needs a domain or a name`);
    }
  });
  return out;
}
export const normalRelated = (list) => list.map((x) => ({ relation: x.relation, domain: text(x.domain) ? hostOf(x.domain) : null, name: text(x.name) ? x.name.trim() : null }));

// the valid declarations of one business record
export const declaredOf = (b) => normalRelated((Array.isArray(b?.related) ? b.related : []).filter((x) => x && typeof x === "object" && RELATIONS.includes(x.relation) && (text(x.domain) || text(x.name))));

// every related business of a run (a folder .pewp): the business record, then the competitors file (proposed, approved)
export function relatedOf(pewp) {
  const rows = [];
  const add = (list) => {
    for (const x of Array.isArray(list) ? list : []) {
      if (!x || typeof x !== "object" || !RELATIONS.includes(x.relation) || !(text(x.domain) || text(x.name))) continue;
      const n = normalRelated([x])[0];
      if (!rows.some((r) => r.domain === n.domain && nameKey(r.name) === nameKey(n.name))) rows.push(n);
    }
  };
  for (const f of ["business.json", "approved/business.json"]) add(J(path.join(pewp, f))?.related);
  for (const f of ["research/competitors-proposed.json", "approved/competitors.json"]) add(J(path.join(pewp, f))?.excluded);
  return {
    rows,
    byDomain: (d) => (hostOf(d) ? rows.find((r) => r.domain && r.domain === hostOf(d)) || null : null),
    byName: (n) => (nameKey(n) ? rows.find((r) => r.name && nameKey(r.name) === nameKey(n)) || null : null),
  };
}
export const leftOutLine = (r) => `${r.name || r.domain}${r.name && r.domain ? ` (${r.domain})` : ""} is a ${r.relation} of the business: left out of every competitor table, list and count`;
