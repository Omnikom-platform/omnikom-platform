// The two router tables of the audit, and the check that they keep their rules (job J1b).
// sources.json: one row for each source that the audit may call, or may never call (its terms, its URL forms, its state).
// routes.json: one row for each fact: its sources in order, and where the route ends when no source gives the fact.
// validateSourceTables(sourcesDoc, routesDoc, { stations, exists }) returns { ok, problems: [{ rule, at, detail }] }.
// `stations` is the list of station ids; `exists(path)` says whether a file is there (path relative to the root of the skill).
// A bad table gives problems, never a throw; a missing option throws. This file imports nothing, reads nothing and prints nothing.

export const SOURCE_STATES = ["allowed", "not built", "waits", "parked", "barred"];
export const SOURCE_KINDS = ["api", "file", "reader", "site"];

const isPlain = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isText = (x) => typeof x === "string" && x !== "";
const isKeyOf = (object, key) => typeof key === "string" && Object.hasOwn(object, key);
// "a line": the host's own words, with their page and the date they were read
const isLine = (x) => isPlain(x) && typeof x.url === "string" && x.url.startsWith("https://") && isText(x.line)
  && typeof x.read === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.read);

const ENGINE = /^[a-z0-9][a-z0-9-]{0,40}$/; // the form of an engine name of lib-stops.mjs
const HOST = /^[a-z0-9][a-z0-9.-]*$/;
const DRIVER = /^scripts\/drivers\/[a-z0-9-]+\.mjs$/;
const KEY_PLACE = /\{[A-Z][A-Z0-9_]*\}/;

const formOnHost = (form, hosts) => {
  if (typeof form !== "string" || !form.startsWith("https://")) return false;
  try { return hosts.includes(new URL(form).host); } catch { return false; }
};

function checkSource(row, at, needs, exists, bad) {
  if (!SOURCE_STATES.includes(row.state)) bad("state", at, "The state is not in the list of states.");
  if (!SOURCE_KINDS.includes(row.kind)) bad("kind", at, "The kind is not in the list of kinds.");

  if (row.kind === "reader") {
    const none = (x) => Array.isArray(x) && x.length === 0;
    if (!none(row.hosts) || !none(row.urlForms) || row.robotsAtRun !== true) bad("reader", at, "The reader names no host and no URL form, and reads robots.txt at run time.");
  } else {
    if (row.robotsAtRun === true) bad("reader", at, "Only the reader reads robots.txt at run time.");

    const lineOrNull = (x) => x === null || isLine(x);
    if (!lineOrNull(row.terms) || !lineOrNull(row.robots) || (row.terms === null && (row.robots === null || row.state !== "barred"))) {
      bad("terms", at, "A terms line with its page and its read date is needed (a barred row may give a robots.txt line instead).");
    }

    const hosts = Array.isArray(row.hosts) ? row.hosts : [];
    const forms = Array.isArray(row.urlForms) ? row.urlForms : [];
    if (typeof row.engine !== "string" || !ENGINE.test(row.engine)) bad("host", at, "The engine is not an engine name.");
    if (!Array.isArray(row.hosts) || !hosts.every((h) => typeof h === "string" && HOST.test(h))) bad("host", at, "The hosts are not a list of host names.");
    if (!Array.isArray(row.urlForms) || !forms.every((f) => formOnHost(f, hosts))) bad("host", at, "A URL form is not an https URL on a host of the row.");
    if (row.kind === "site" && hosts.length === 0) bad("host", at, "A site names its host.");

    // the ledger stores a path whole and never a query value, so a key may stand only after the "?"
    if (forms.some((f) => typeof f === "string" && KEY_PLACE.test(f.split("?")[0]))) bad("key-in-path", at, "A URL form puts a key in its path.");
  }

  if (row.state === "allowed") {
    if (typeof row.driver !== "string" || !DRIVER.test(row.driver) || exists(row.driver) !== true) bad("driver", at, "An allowed source names a driver file that exists.");
  } else if (row.driver !== null) bad("driver", at, "A source that is not allowed names no driver.");

  if (!Array.isArray(row.ownerNeeds) || !row.ownerNeeds.every((id) => isKeyOf(needs, id)) || (row.state === "waits" && row.ownerNeeds.length === 0)) {
    bad("need", at, "The owner needs are not ids of the list, or a source that waits names none.");
  }
}

function checkRoute(row, at, { sources, gaps, needs, stations }, bad) {
  if (!Array.isArray(row.sources)) bad("route-source", at, "The sources of the route are not a list.");
  else for (const entry of row.sources) {
    if (!isPlain(entry) || Object.hasOwn(entry, "id") === Object.hasOwn(entry, "local")) {
      bad("route-source", at, "An entry has exactly one of id and local.");
      continue;
    }
    if (Object.hasOwn(entry, "local")) {
      if (!isText(entry.local)) bad("route-source", at, "A local entry says what the input is.");
      continue;
    }
    const named = sources.filter((s) => s.id === entry.id);
    if (named.length === 0) bad("route-source", at, "An entry names a source that is not in the source table.");
    if (named.some((s) => s.state === "barred" || s.state === "parked")) bad("route-state", at, "The route names a barred or a parked source.");
  }

  const end = row.end;
  const isEndId = (id) => isKeyOf(gaps, id) || isKeyOf(needs, id) || (isText(id) && id === row.id);
  if (!isPlain(end) || !isText(end.text) || !Array.isArray(end.gap) || end.gap.length === 0 || !end.gap.every(isEndId)) {
    bad("route-end", at, "The route ends with a text and with ids of a gap, an owner need or the route itself.");
  }

  if (!Array.isArray(row.stations) || !row.stations.every((s) => stations.includes(s))) bad("station", at, "The stations of the route are not a list of real stations.");
  else if (row.pull !== false && row.stations.length === 0) bad("station", at, "A pull names a station.");
}

export function validateSourceTables(sourcesDoc, routesDoc, { stations, exists } = {}) {
  if (!Array.isArray(stations) || typeof exists !== "function") throw new TypeError("validateSourceTables needs stations (an array) and exists (a function)");

  const problems = [];
  const bad = (rule, at, detail) => { problems.push({ rule, at, detail }); };
  const result = () => ({ ok: problems.length === 0, problems });

  const sourcesOk = isPlain(sourcesDoc) && Array.isArray(sourcesDoc.sources) && isPlain(sourcesDoc.needs);
  const routesOk = isPlain(routesDoc) && Array.isArray(routesDoc.routes) && isPlain(routesDoc.gaps);
  if (!sourcesOk) bad("shape", "sources", "The source table is not an object with a list of sources and the needs.");
  if (!routesOk) bad("shape", "routes", "The route table is not an object with a list of routes and the gaps.");
  if (!sourcesOk || !routesOk) return result();

  // the rows of one table that are objects, each checked for its shape and its id
  const eachRow = (table, rows, check) => {
    const ids = new Set();
    for (const [i, row] of rows.entries()) {
      const place = `${table}[${i}]`;
      if (!isPlain(row)) { bad("shape", place, "The row is not an object."); continue; }
      const at = isText(row.id) ? row.id : place;
      if (!isText(row.id) || ids.has(row.id)) bad("id", at, "The id is missing or used twice.");
      ids.add(row.id);
      check(row, at);
    }
  };

  const { needs } = sourcesDoc;
  eachRow("sources", sourcesDoc.sources, (row, at) => checkSource(row, at, needs, exists, bad));

  const sources = sourcesDoc.sources.filter((s) => isPlain(s) && isText(s.id));
  const context = { sources, gaps: routesDoc.gaps, needs, stations };
  eachRow("routes", routesDoc.routes, (row, at) => checkRoute(row, at, context, bad));

  const served = new Set(routesDoc.routes.filter(isPlain).flatMap((r) => (Array.isArray(r.stations) ? r.stations : [])));
  for (const station of stations) if (!served.has(station)) bad("station", station, "No route names this station.");

  return result();
}
