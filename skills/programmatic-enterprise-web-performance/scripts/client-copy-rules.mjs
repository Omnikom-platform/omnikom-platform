// client-copy-rules.mjs: the rulings on the client copy, as pure functions (no file, no network, no state).
// Used by client-copy-data.mjs and the pages of the copy. A function that cannot answer from its input throws an Error; the caller turns it into a STOP.
export const DIRECT_KIND = "direct"; // the one kind of an approved row that says a direct competitor (today's vocabulary has none)
export const OTHER_WORD = "another business";
export const PLAIN_KIND = { publisher: "a publisher", "social-curator": "a social account", "paid-media": "a paid media company", agency: "an agency", "brokerage-program": "a brokerage program", "design-broker": "a design broker", marketplace: "a marketplace" };
export const isAdName = (name) => /^(Ad|Sponsored)\s\xb7\s/.test(name); // a paid row of the map list: never a business
export const hostOf = (d) => String(d || "").trim().toLowerCase().replace(/^www\./, "");
export const isGovernment = (d) => { const h = hostOf(d); return h === "gov" || h.endsWith(".gov"); };
const onList = (list, h) => (list || []).some((x) => hostOf(x.domain) === h);

// 1. The tag printed beside a result's domain: a text, or null (no tag at all).
export function tagOf(domain, approved, otherWord = OTHER_WORD) {
  const h = hostOf(domain);
  if (!h) return null;
  if (isGovernment(h)) return "government";
  if (onList(approved.excluded, h)) return null;
  const row = (approved.rows || []).find((x) => x.domain && hostOf(x.domain) === h);
  if (!row) return null;
  if (row.kind === DIRECT_KIND) return "your rival";
  if (row.kind === "other") return otherWord;
  if (Object.prototype.hasOwnProperty.call(PLAIN_KIND, row.kind)) return PLAIN_KIND[row.kind];
  throw new Error(`approved row ${row.domain} has kind "${row.kind}", which has no plain word`);
}

// 2. Who Maps shows in its first three for one query: from the pack rows at position 1 to 3 of every point, never from top3.
export function mapsFirstThree(points, query, clientName) {
  const mine = points.filter((p) => p.query === query);
  if (!mine.length) throw new Error(`no point for the query "${query}"`);
  const by = new Map();
  for (const p of mine) {
    if (!Array.isArray(p.pack)) throw new Error(`a point of "${query}" has no pack`);
    const seen = new Set();
    for (const r of p.pack) {
      if (!Number.isInteger(r.position) || r.position < 1) throw new Error(`a pack row of "${query}" has no position`);
      if (r.position > 3 || isAdName(r.name) || seen.has(r.name)) continue;
      seen.add(r.name);
      const e = by.get(r.name) || { name: r.name, inThree: 0, first: 0, reviews: null, isTheClient: r.name === clientName };
      e.inThree++;
      if (r.position === 1) e.first++;
      if (Number.isFinite(r.reviews) && (e.reviews === null || r.reviews > e.reviews)) e.reviews = r.reviews;
      by.set(r.name, e);
    }
  }
  const rows = [...by.values()].sort((a, b) => b.inThree - a.inThree || b.first - a.first || a.name.localeCompare(b.name, "en"));
  return { points: mine.length, rows };
}

// 3. The tile of one query: its nine points' own states by row and column, with the counts.
export function mapsTile(points, query) {
  const mine = points.filter((p) => p.query === query);
  const tile = [[null, null, null], [null, null, null], [null, null, null]];
  const counts = { "top three": 0, listed: 0, absent: 0 };
  for (const p of mine) {
    const r = p.row - 1, c = p.col - 1;
    if (!(Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < 3 && c >= 0 && c < 3)) throw new Error(`a point of "${query}" has no row and column from 1 to 3`);
    if (tile[r][c] !== null) throw new Error(`"${query}" has two points at row ${p.row}, column ${p.col}`);
    const v = p.position && p.position.value;
    if (v !== null && !(Number.isInteger(v) && v >= 1)) throw new Error(`a point of "${query}" has a position that is neither a number nor null`);
    const s = v === null ? "absent" : v <= 3 ? "top three" : "listed";
    tile[r][c] = s;
    counts[s]++;
  }
  if (mine.length !== 9) throw new Error(`"${query}" has ${mine.length} points, the tile needs 9`);
  return { points: 9, tile, counts };
}

// 4. The businesses an answer names, in the order of their first mention in the answer's text; a name the text does not hold is `unfound`.
const squash = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
export function namesByFirstMention(text, names) {
  const t = squash(text), found = [], unfound = [];
  names.forEach((n, i) => { const at = t.indexOf(squash(n)); if (at < 0) unfound.push(n); else found.push({ n, at, i }); });
  found.sort((a, b) => a.at - b.at || a.i - b.i);
  return { names: found.map((x) => x.n), unfound };
}

// 5. The name to print for a domain: its approved name, or the domain itself when the client file lists it as unconfirmed or no name is known.
export function nameToPrint(domain, name, unconfirmed = []) {
  const h = hostOf(domain);
  if (unconfirmed.some((u) => hostOf(u) === h) || typeof name !== "string" || name.trim() === "") return h;
  return name;
}

// 6. The client file's rivals that stand on the approved excluded list (the build STOPs on any): their domains as the client file wrote them.
export const excludedRivals = (clientRivals, approved) => clientRivals.filter((r) => onList(approved.excluded, hostOf(r.domain))).map((r) => r.domain);
