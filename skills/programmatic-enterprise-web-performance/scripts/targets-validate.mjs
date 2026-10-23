// Validator for the contract in schemas/targets.md: targets.json, business.json, ranking rows, AI-citation rows.
// Usage: node targets-validate.mjs <targets.json | pewp dir> [--business <file>] [--measure <dir>]...
// Output (check style): first line `PASS targets-valid <what>` or `FAIL targets-valid <n> error(s)`, then one line per error
// `  <rule> <json path>: <message>`. Exit 0 pass, 1 fail, 2 cannot judge (file missing or not JSON).
// Library: validate(obj), validateBusiness(obj), validateRankingRow(row, path), validateCitationRow(row, path),
//          validateMeasureDir(dir), compareMeasure(dirA, dirB), measureKey(row)
// Rules: T-001 shape · T-002 id · T-003 primaryQuery unique (cannibalisation) · T-004 sourced number · T-005 market ·
//        T-006 location on local intent · T-007 intent · T-008 targetPage · T-009 lists · T-010 priority · T-011 wordRange
//        B-001 business shape · R-001..R-005 ranking rows · C-001..C-005 AI-citation rows · M-001 measure folder
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tokens } from "./lib-text.mjs";

export const INTENTS = ["informational", "commercial", "transactional", "local", "navigational"];
export const PAGE_TYPES = ["product", "category", "local", "article", "video", "forum", "directory", "comparison", "page"]; // 06-growth 9.3
export const GOALS = ["leads", "calls", "bookings", "sales"];
const DEVICES = ["mobile", "desktop"];
const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
const nonEmpty = (x) => typeof x === "string" && x.trim().length > 0;
const isStrList = (x) => Array.isArray(x) && x.every(nonEmpty);

function Collector() {
  const errors = [];
  return { errors, add: (rule, p, message) => errors.push({ rule, path: p, message }) };
}

// A sourced number: { value, source, fetchedAt, cacheFile, estimate?, location?, device?, market? }. Never a bare number.
export function checkSourced(c, p, n, { valueKind = "number", allowNull = false, rule = "T-004", market = null, now = Date.now() } = {}) {
  if (!isObj(n)) { c.add(rule, p, "must be a sourced number {value, source, fetchedAt, cacheFile}, not a bare value"); return; }
  for (const k of ["value", "source", "fetchedAt", "cacheFile"]) if (!(k in n)) c.add(rule, `${p}.${k}`, "missing");
  if ("source" in n && !nonEmpty(n.source)) c.add(rule, `${p}.source`, "must say where the number came from");
  if ("fetchedAt" in n) {
    if (typeof n.fetchedAt !== "string" || !ISO.test(n.fetchedAt) || Number.isNaN(Date.parse(n.fetchedAt))) c.add(rule, `${p}.fetchedAt`, "must be an ISO date");
    else if (Date.parse(n.fetchedAt) > now + 86400000) c.add(rule, `${p}.fetchedAt`, "is in the future");
  }
  if ("cacheFile" in n && !(n.cacheFile === null || nonEmpty(n.cacheFile))) c.add(rule, `${p}.cacheFile`, "must be a path or null");
  if ("estimate" in n && typeof n.estimate !== "boolean") c.add(rule, `${p}.estimate`, "must be true or false");
  if ("device" in n && !DEVICES.includes(n.device)) c.add(rule, `${p}.device`, "must be mobile or desktop");
  if ("value" in n) {
    const v = n.value;
    if (v === null) { if (!allowNull) c.add(rule, `${p}.value`, "must not be null here"); }
    else if (valueKind === "number") {
      if (typeof v === "number" && Number.isFinite(v)) { /* ok */ }
      else if ((Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number" && Number.isFinite(x)) && v[0] <= v[1]) || nonEmpty(v)) {
        if (n.estimate !== true) c.add(rule, `${p}.estimate`, "a range or text value must set estimate: true");
      } else c.add(rule, `${p}.value`, "must be a number (or a [low, high] range with estimate: true)");
    } else if (valueKind === "list") { if (!isStrList(v)) c.add(rule, `${p}.value`, "must be a list of strings"); }
    // valueKind "any": the caller checks the value (wordRange)
  }
  if (market) {
    if (isObj(n.market) && n.market.country && n.market.country !== market.country) c.add("T-005", `${p}.market`, `number is for ${n.market.country}, targets.json market is ${market.country}`);
    if (typeof n.location === "string" && /^[A-Z]{2}$/.test(n.location) && n.location !== market.country) c.add("T-005", `${p}.location`, `number is for ${n.location}, targets.json market is ${market.country}`);
  }
}

const checkMarket = (c, p, m, rule = "T-001") => {
  if (!isObj(m)) { c.add(rule, p, "market {country, language} is required"); return null; }
  if (!/^[A-Z]{2}$/.test(m.country || "")) c.add(rule, `${p}.country`, "must be a two-letter country code such as US");
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(m.language || "")) c.add(rule, `${p}.language`, "must be a language code such as en");
  return m;
};

export function validate(obj, { now = Date.now() } = {}) {
  const c = Collector();
  const warnings = [];
  if (!isObj(obj)) { c.add("T-001", "$", "targets.json must be an object"); return { ok: false, errors: c.errors, warnings }; }
  if (obj.version !== 1) c.add("T-001", "version", "must be 1");
  if (!nonEmpty(obj.business)) c.add("T-001", "business", "must be the business domain");
  const market = checkMarket(c, "market", obj.market);
  if (!(typeof obj.createdAt === "string" && ISO.test(obj.createdAt) && !Number.isNaN(Date.parse(obj.createdAt)))) c.add("T-001", "createdAt", "must be an ISO date");
  if (!Array.isArray(obj.clusters) || !obj.clusters.length) { c.add("T-001", "clusters", "must be a non-empty list"); return { ok: c.errors.length === 0, errors: c.errors, warnings }; }
  const ids = new Map(), queries = new Map(), pages = new Map(), qseen = new Map();
  obj.clusters.forEach((k, i) => {
    const p = `clusters[${i}]`;
    if (!isObj(k)) { c.add("T-001", p, "must be an object"); return; }
    if (!nonEmpty(k.id) || !/^c-[a-z0-9]+(-[a-z0-9]+)*$/.test(k.id)) c.add("T-002", `${p}.id`, "must look like c-<slug> (lowercase, hyphens)");
    else if (ids.has(k.id)) c.add("T-002", `${p}.id`, `duplicate id ${k.id} (also clusters[${ids.get(k.id)}])`); else ids.set(k.id, i);
    if (!nonEmpty(k.primaryQuery)) c.add("T-003", `${p}.primaryQuery`, "missing");
    else {
      const key = [...new Set(tokens(k.primaryQuery))].sort().join(" ");
      if (queries.has(key)) c.add("T-003", `${p}.primaryQuery`, `cannibalisation: "${k.primaryQuery}" is the same query as clusters[${queries.get(key)}] ("${obj.clusters[queries.get(key)].primaryQuery}"): two clusters on one primary query`);
      else queries.set(key, i);
    }
    if (!isStrList(k.queries) || !k.queries.length) c.add("T-009", `${p}.queries`, "must be a non-empty list of strings");
    else for (const q of k.queries) { const key = [...new Set(tokens(q))].sort().join(" "); if (qseen.has(key) && qseen.get(key) !== i) warnings.push(`T-003 ${p}.queries: "${q}" is also a query of clusters[${qseen.get(key)}]`); else qseen.set(key, i); }
    if (!INTENTS.includes(k.intent)) c.add("T-007", `${p}.intent`, `must be one of ${INTENTS.join(", ")}`);
    if (k.intent === "local" && !nonEmpty(k.location)) c.add("T-006", `${p}.location`, 'local intent needs a location such as "Rocklin, CA"');
    else if (k.location !== null && k.location !== undefined && !nonEmpty(k.location)) c.add("T-006", `${p}.location`, "must be a string or null");
    else if (!("location" in k)) c.add("T-006", `${p}.location`, "missing (use null when the query is not local)");
    checkSourced(c, `${p}.volume`, k.volume, { market, now });
    for (const f of ["difficulty", "value"]) { if (k[f] === null) continue; checkSourced(c, `${p}.${f}`, k[f], { allowNull: true, market, now }); }
    checkSourced(c, `${p}.serpFeatures`, k.serpFeatures, { valueKind: "list", market, now });
    if (!nonEmpty(k.winningFormat)) c.add("T-009", `${p}.winningFormat`, "missing");
    if (!Array.isArray(k.competitorsTop3) || k.competitorsTop3.length > 3) c.add("T-009", `${p}.competitorsTop3`, "must be a list of at most 3 {url, domain}");
    else k.competitorsTop3.forEach((x, j) => {
      let host = null; try { host = new URL(x?.url).hostname.replace(/^www\./, ""); } catch {}
      if (!host) c.add("T-009", `${p}.competitorsTop3[${j}].url`, "must be an absolute URL");
      else if (!nonEmpty(x.domain) || !(host === x.domain.replace(/^www\./, "") || host.endsWith("." + x.domain.replace(/^www\./, "")))) c.add("T-009", `${p}.competitorsTop3[${j}].domain`, `must be the host of the url (${host})`);
    });
    if (!Array.isArray(k.requiredEntities) || !k.requiredEntities.every(nonEmpty)) c.add("T-009", `${p}.requiredEntities`, "must be a list of strings");
    if (!Array.isArray(k.questions) || !k.questions.every(nonEmpty)) c.add("T-009", `${p}.questions`, "must be a list of strings");
    // Optional, added 2026-10-22 for shipgate 06 sections 9.3 / 9.5 and TGT-003 / TGT-011 / TGT-012.
    if ("winningPageType" in k && !PAGE_TYPES.includes(k.winningPageType)) c.add("T-012", `${p}.winningPageType`, `must be one of ${PAGE_TYPES.join(", ")} (06 section 9.3)`);
    if ("requiredTerms" in k && (!Array.isArray(k.requiredTerms) || !k.requiredTerms.every(nonEmpty))) c.add("T-012", `${p}.requiredTerms`, "must be a list of strings (06 section 9.5)");
    if ("alsoServes" in k && (!Array.isArray(k.alsoServes) || !k.alsoServes.every((x) => nonEmpty(x) && x.startsWith("/")))) c.add("T-012", `${p}.alsoServes`, "must be a list of URL paths (03 section 21.2): pages that may also serve this cluster without counting as cannibalisation");
    if (!(k.targetPage === "new" || (nonEmpty(k.targetPage) && k.targetPage.startsWith("/")))) c.add("T-008", `${p}.targetPage`, 'must be a URL path starting with "/" or "new"');
    else if (k.targetPage !== "new") {
      const key = k.targetPage.replace(/\/index\.html?$/i, "/").replace(/\/+$/, "").toLowerCase() || "/";
      if (pages.has(key)) c.add("T-008", `${p}.targetPage`, `one page for two clusters: ${k.targetPage} is also the page of clusters[${pages.get(key)}] (one cluster = one page)`); else pages.set(key, i);
    }
    if (typeof k.priority !== "number" || !Number.isFinite(k.priority)) c.add("T-010", `${p}.priority`, "must be a number (impact x effort, higher first)");
    if ("wordRange" in k) {
      checkSourced(c, `${p}.wordRange`, k.wordRange, { valueKind: "any", market, now });
      const v = k.wordRange?.value;
      if (!(Array.isArray(v) && v.length === 2 && v.every((x) => Number.isInteger(x) && x > 0) && v[0] <= v[1])) c.add("T-011", `${p}.wordRange.value`, "must be [min, max] whole words, min <= max");
    }
  });
  return { ok: c.errors.length === 0, errors: c.errors, warnings };
}

export function validateBusiness(obj) {
  const c = Collector();
  if (!isObj(obj)) { c.add("B-001", "$", "business.json must be an object"); return { ok: false, errors: c.errors, warnings: [] }; }
  for (const k of ["name", "domain", "kind", "offer", "audience"]) if (!nonEmpty(obj[k])) c.add("B-001", k, "missing");
  if (!(obj.industry === null || nonEmpty(obj.industry))) c.add("B-001", "industry", "must be a rules/industries slug or null");
  checkMarket(c, "market", obj.market, "B-001");
  if (!Array.isArray(obj.locations)) c.add("B-001", "locations", "must be a list");
  else obj.locations.forEach((l, i) => { if (!nonEmpty(l?.name)) c.add("B-001", `locations[${i}].name`, "missing"); if (!Array.isArray(l?.serviceArea)) c.add("B-001", `locations[${i}].serviceArea`, "must be a list"); });
  if (!Array.isArray(obj.goals) || !obj.goals.length || !obj.goals.every((g) => GOALS.includes(g))) c.add("B-001", "goals", `must be a non-empty list of ${GOALS.join(" | ")}`);
  if (!isStrList(obj.competitors)) c.add("B-001", "competitors", "must be a list of domains");
  if (!isObj(obj.brand) || !Array.isArray(obj.brand.constraints)) c.add("B-001", "brand.constraints", "must be a list");
  if (!isObj(obj.existing)) c.add("B-001", "existing", "missing");
  if (!["live", "preview", "planned"].includes(obj.launchState)) c.add("B-001", "launchState", "must be live | preview | planned");
  if ("rankTracking" in obj) {
    const r = obj.rankTracking;
    if (!isObj(r) || !["search-console", "browser-capture"].includes(r.source) || !isStrList(r.locations) || !isStrList(r.devices) || !r.devices.every((d) => DEVICES.includes(d))) c.add("B-001", "rankTracking", "needs source (search-console | browser-capture), locations[], devices[]");
  }
  if ("credentials" in obj) { // optional, used by the industry rules (licence number, brokerage name)
    const r = obj.credentials;
    if (!isObj(r)) c.add("B-001", "credentials", "must be an object");
    else {
      if ("state" in r && !/^[A-Z]{2}$/.test(r.state || "")) c.add("B-001", "credentials.state", "must be a two-letter state code");
      for (const k of ["licenseNumber", "brokerage", "agencyLegalName"]) if (k in r && !nonEmpty(r[k])) c.add("B-001", `credentials.${k}`, "must be text");
      if ("licensed" in r && typeof r.licensed !== "boolean") c.add("B-001", "credentials.licensed", "must be true or false");
    }
  }
  return { ok: c.errors.length === 0, errors: c.errors, warnings: [] };
}

// A ranking row: rejected if location, device, language, source or fetchedAt is missing.
export function validateRankingRow(row, p = "row", { now = Date.now() } = {}) {
  const c = Collector();
  if (!isObj(row)) { c.add("R-001", p, "must be an object"); return c.errors; }
  if (!nonEmpty(row.query)) c.add("R-001", `${p}.query`, "missing");
  for (const k of ["location", "language"]) if (!nonEmpty(row[k])) c.add("R-001", `${p}.${k}`, "missing: rankings differ by place and language, a row without it cannot be compared");
  if (!DEVICES.includes(row.device)) c.add("R-001", `${p}.device`, "must be mobile or desktop");
  if (!["google", "bing"].includes(row.engine)) c.add("R-003", `${p}.engine`, "must be google or bing");
  if (!(row.url === null || nonEmpty(row.url))) c.add("R-001", `${p}.url`, "must be the ranking URL or null when not ranking");
  if (!isObj(row.position)) c.add("R-002", `${p}.position`, "must be a sourced number {value, source, fetchedAt, cacheFile}");
  else {
    checkSourced(c, `${p}.position`, row.position, { allowNull: true, rule: "R-002", now });
    const v = row.position.value;
    if (v !== null && v !== undefined && !(Number.isInteger(v) && v >= 1)) c.add("R-002", `${p}.position.value`, "must be a whole position >= 1 or null (not found in the tracked range)");
    if (v !== null && v !== undefined && row.url === null) c.add("R-001", `${p}.url`, "a ranking position needs the URL that ranks");
  }
  return c.errors;
}

// An AI citation row: share of runs that cite us; the share must be a whole number of runs out of `runs`.
export function validateCitationRow(row, p = "row", { now = Date.now() } = {}) {
  const c = Collector();
  if (!isObj(row)) { c.add("C-001", p, "must be an object"); return c.errors; }
  for (const k of ["question", "engine", "model", "prompt", "location"]) if (!nonEmpty(row[k])) c.add("C-001", `${p}.${k}`, "missing (AI answers vary by engine, model, prompt and place)");
  if (!(Number.isInteger(row.runs) && row.runs >= 1)) c.add("C-002", `${p}.runs`, "must be a whole number of runs >= 1");
  if (!isObj(row.citedShare)) c.add("C-003", `${p}.citedShare`, "must be a sourced number {value 0..1, source, fetchedAt, cacheFile}");
  else {
    checkSourced(c, `${p}.citedShare`, row.citedShare, { rule: "C-003", now });
    const v = row.citedShare.value;
    if (typeof v === "number") {
      if (v < 0 || v > 1) c.add("C-003", `${p}.citedShare.value`, "must be between 0 and 1");
      else if (Number.isInteger(row.runs) && Math.abs(v * row.runs - Math.round(v * row.runs)) > 1e-3) c.add("C-003", `${p}.citedShare.value`, `${v} is not a whole number of ${row.runs} runs`);
      if (typeof row.ourDomainCited === "boolean" && row.ourDomainCited !== v > 0) c.add("C-004", `${p}.ourDomainCited`, "must be true exactly when citedShare > 0");
    }
  }
  if (!isStrList(row.citedSources)) c.add("C-005", `${p}.citedSources`, "must be a list of domains");
  if (typeof row.ourDomainCited !== "boolean") c.add("C-004", `${p}.ourDomainCited`, "must be true or false");
  return c.errors;
}

const noBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s); // a UTF-8 BOM (PowerShell 5.1, Notepad) is not a JSON error
const readJson = (f) => JSON.parse(noBom(fs.readFileSync(f, "utf8")));
// <dir>/rankings.json = { date, rankings: [row] }, <dir>/citations.json = { date, citations: [row] }
export function validateMeasureDir(dir) {
  const errors = [];
  const seen = new Set();
  const date = path.basename(path.resolve(dir));
  for (const [file, key, fn] of [["rankings.json", "rankings", validateRankingRow], ["citations.json", "citations", validateCitationRow]]) {
    const f = path.join(dir, file);
    if (!fs.existsSync(f)) { errors.push({ rule: "M-001", path: file, message: "missing" }); continue; }
    let doc; try { doc = readJson(f); } catch (e) { errors.push({ rule: "M-001", path: file, message: `not JSON: ${e.message}` }); continue; }
    if (doc.date !== date) errors.push({ rule: "M-001", path: `${file}.date`, message: `must equal the folder name ${date}` });
    if (!Array.isArray(doc[key]) || !doc[key].length) { errors.push({ rule: "M-001", path: `${file}.${key}`, message: "must be a non-empty list" }); continue; }
    doc[key].forEach((r, i) => {
      errors.push(...fn(r, `${file}.${key}[${i}]`));
      const k = key === "rankings" ? measureKey(r) : [r.question, r.engine, r.model, r.location].join("|");
      if (seen.has(key + k)) errors.push({ rule: key === "rankings" ? "R-004" : "C-006", path: `${file}.${key}[${i}]`, message: "duplicate row for the same query/place/device/language/engine (or question/engine/model/place)" });
      seen.add(key + k);
    });
  }
  return errors;
}

// Rows are comparable only when every one of these matches: never compare numbers measured from different places.
export const measureKey = (r) => [r.query, r.location, r.device, r.language, r.engine].map((x) => String(x ?? "").toLowerCase()).join("|");

// Pair two dates: which rankings can be diffed, and which cannot because the measuring place/device changed.
export function compareMeasure(dirA, dirB) {
  const a = readJson(path.join(dirA, "rankings.json")).rankings, b = readJson(path.join(dirB, "rankings.json")).rankings;
  const mapA = new Map(a.map((r) => [measureKey(r), r]));
  const out = { comparable: [], newInB: [], goneInB: [], notComparable: [] };
  for (const r of b) {
    const prev = mapA.get(measureKey(r));
    if (prev) out.comparable.push({ query: r.query, from: prev.position.value, to: r.position.value, change: prev.position.value !== null && r.position.value !== null ? prev.position.value - r.position.value : null });
    else if (a.some((x) => x.query.toLowerCase() === r.query.toLowerCase() && x.engine === r.engine)) out.notComparable.push({ query: r.query, why: "measured from a different location, device or language than the earlier run" });
    else out.newInB.push(r.query);
  }
  const keysB = new Set(b.map(measureKey));
  for (const r of a) if (!keysB.has(measureKey(r)) && !out.notComparable.some((x) => x.query.toLowerCase() === r.query.toLowerCase())) out.goneInB.push(r.query);
  return out;
}

function main() {
  const a = process.argv.slice(2);
  const optAll = (k) => a.flatMap((x, i) => (x === k ? [a[i + 1]] : []));
  const pos = a.filter((x, i) => !x.startsWith("--") && !["--business", "--measure"].includes(a[i - 1]));
  if (!pos.length && !optAll("--measure").length && !optAll("--business").length) { console.error("usage: node targets-validate.mjs <targets.json | pewp dir> [--business <file>] [--measure <dir>]..."); process.exit(2); }
  const errors = [], what = [];
  const load = (f) => { try { return readJson(f); } catch (e) { console.log(`ERROR targets-valid cannot judge: ${f}: ${e.code === "ENOENT" ? "file not found" : e.message}`); process.exit(2); } };
  if (pos[0]) {
    let f = path.resolve(pos[0]);
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "targets.json");
    const t = load(f); const r = validate(t);
    errors.push(...r.errors); what.push(`${t?.clusters?.length ?? 0} clusters`);
    const bf = optAll("--business")[0] || path.join(path.dirname(f), "business.json");
    if (optAll("--business")[0] || fs.existsSync(bf)) { errors.push(...validateBusiness(load(bf)).errors.map((e) => ({ ...e, path: "business." + e.path }))); what.push("business.json"); }
  } else for (const bf of optAll("--business")) { errors.push(...validateBusiness(load(bf)).errors); what.push("business.json"); }
  for (const d of optAll("--measure")) { errors.push(...validateMeasureDir(path.resolve(d)).map((e) => ({ ...e, path: `${path.basename(d)}/${e.path}` }))); what.push(`measure ${path.basename(d)}`); }
  if (errors.length) {
    console.log(`FAIL targets-valid ${errors.length} error(s)`);
    for (const e of errors) console.log(`  ${e.rule} ${e.path}: ${e.message}`);
    process.exit(1);
  }
  console.log(`PASS targets-valid ${what.join(", ")}`);
}
if (isMain(import.meta.url)) main(); // lib-main.mjs: real paths, junction/symlink safe
