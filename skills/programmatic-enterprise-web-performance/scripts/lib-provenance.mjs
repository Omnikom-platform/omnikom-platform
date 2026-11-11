// Who answered a business question (contract C2), shared by intake.mjs (writes provenance) and approve.mjs (checks it).
// answeredBy is "owner" | "site" | "default" (a string), or a DELEGATION: an object { by, delegatedBy: "owner", at } for an answer a delegate gave for the owner (a head of operations,
// an agent the owner told to go on). The object must say WHO ("by"), that the owner delegated it ("delegatedBy": "owner") and WHEN ("at", a date): the bare word "delegated" names
// nobody, so it is not a stamp. intake records such a field as provenance "delegated" and keeps the record in business.delegations[<field>]; approve.mjs business accepts "owner" or
// "delegated" for the owner-only fields and says which; "site" and "default" are still refused.
export function delegationOf(x) {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const by = typeof x.by === "string" ? x.by.trim() : "", at = typeof x.at === "string" ? x.at.trim() : "";
  if (!by || x.delegatedBy !== "owner" || !at || !Number.isFinite(Date.parse(at))) return null;
  return { by, delegatedBy: "owner", at };
}
