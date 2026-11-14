// Every number and fact of the client copy, read at build time from the run's files through ONE function, get().
// Ported from the hand-written builder of the first client copy; every business-specific value now comes from a file.
// The build STOPS (one line "STOP: <file> has no <field>" or "STOP: <file> is missing", exit 1, nothing written) when a file is
// missing, is not JSON, or a field is absent, null where a value is needed, or not of the kind expected. No default, no 0, no
// empty text, no "n/a" ever stands in for a value. A value that may honestly be absent is read through getMaybe(), and the
// sentence that prints it handles both cases. The only typed value is Google's 2.5 s mark (PINNED: a reference, not data).
// A hand read (lead path, mail, domain, licence wording, state filing) that the client file does not name is NOT READ: its values
// are null here and nothing about it is printed.
import fs from "node:fs";
import path from "node:path";

export const stop = (line) => { const e = new Error(line); e.isStop = true; throw e; };
export const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : n);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const isAd = (name) => /^(Ad|Sponsored)\s·\s/.test(name); // a paid row the map list shows: never printed as a competitor
const street = (a, home) => { const i = a.search(new RegExp(`,\\s*${escRe(home)}`, "i")); return (i > 0 ? a.slice(0, i) : a).trim(); };
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lowerFirst = (s) => s.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase());
const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// A field path: a.b[3].c, an array element by its fields: rows[engine=chatgpt&type=buyer], a nested key inside brackets with "/".
// For a text file the field is "text" (the whole file) or "match:<regex>" (group 1 if the regex has one, else the match).
function parsePath(p) {
  const segs = [];
  const re = /([^.[\]]+)|\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(p))) {
    if (m[1] !== undefined) segs.push({ key: m[1] });
    else if (/^\d+$/.test(m[2])) segs.push({ index: Number(m[2]) });
    else segs.push({ where: m[2].split("&").map((c) => { const j = c.indexOf("="); return [c.slice(0, j).split("/"), c.slice(j + 1)]; }) });
  }
  return segs;
}
function walk(root, segs) {
  let cur = root;
  for (const s of segs) {
    if (cur === null || cur === undefined) return undefined;
    if (s.key !== undefined) { if (typeof cur !== "object" || Array.isArray(cur) || !Object.prototype.hasOwnProperty.call(cur, s.key)) return undefined; cur = cur[s.key]; }
    else if (s.index !== undefined) { if (!Array.isArray(cur) || s.index >= cur.length) return undefined; cur = cur[s.index]; }
    else {
      if (!Array.isArray(cur)) return undefined;
      cur = cur.find((el) => s.where.every(([ks, v]) => { let x = el; for (const k of ks) x = x == null ? undefined : x[k]; return x !== undefined && x !== null && String(x) === v; }));
    }
  }
  return cur;
}
const KINDS = {
  number: (v) => typeof v === "number" && Number.isFinite(v),
  count: (v) => Number.isInteger(v) && v >= 0,
  string: (v) => typeof v === "string", // may be empty: used only where an empty text is itself the finding
  text: (v) => typeof v === "string" && v.trim() !== "",
  boolean: (v) => typeof v === "boolean",
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  date: (v) => typeof v === "string" && !Number.isNaN(Date.parse(v)),
};
const typeName = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

// cfg: { pewp, snapAbs, snapRel, client, hand: {leadPath, mail, domain, trust, filing: {abs, label} | null}, bookAbs, backingAbs }
export function collect(cfg) {
  const { pewp, snapAbs, snapRel, client, hand } = cfg;
  const defs = {};
  const label = (def) => def.label;
  const P = (id, rel, kind, date, text) => (defs[id] = { abs: path.join(pewp, rel), label: `.pewp/${rel}`, kind, date, text: !!text });
  const Sn = (id, rel, kind, date, text) => (defs[id] = { abs: path.join(snapAbs, rel), label: `${snapRel}/${rel}`, kind, date, text: !!text });
  const X = (id, abs, lab, kind, date, text) => (defs[id] = { abs, label: lab, kind, date, text: !!text });
  const cache = new Map();
  function load(id) {
    if (cache.has(id)) return cache.get(id);
    const def = defs[id];
    if (!def) throw new Error(`data file: no file id ${id}`); // a mistake in this code, not in the run's
    const file = def.abs;
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) stop(`STOP: ${label(def)} is missing`);
    const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
    let root = text;
    if (!def.text) { try { root = JSON.parse(text); } catch { stop(`STOP: ${label(def)} is not JSON`); } }
    const entry = { def, root, mtime: fs.statSync(file).mtime.toISOString() };
    cache.set(id, entry);
    return entry;
  }
  function lookup(id, field) {
    const { def, root } = load(id);
    if (!def.text) return field === "$" ? root : walk(root, parsePath(field));
    if (field === "text") return root;
    if (field.startsWith("match:")) { const m = root.match(new RegExp(field.slice(6), "m")); return m ? (m[1] !== undefined ? m[1] : m[0]) : undefined; }
    throw new Error(`data file: bad text field ${field}`);
  }
  // THE one reader: names the file and the field, stops the build when either is not there or not of the kind expected.
  function get(id, field, kind) {
    const v = lookup(id, field);
    const def = defs[id];
    if (v === undefined || v === null) stop(`STOP: ${label(def)} has no ${field}`);
    if (!KINDS[kind](v)) stop(`STOP: ${label(def)} has no ${field} as ${kind} (found ${typeName(v)})`);
    return v;
  }
  // The second reader, for a value that may honestly be absent: null when absent; still stops on a missing file or a wrong kind.
  function getMaybe(id, field, kind) {
    const v = lookup(id, field);
    if (v === undefined || v === null) return null;
    if (!KINDS[kind](v)) stop(`STOP: ${label(defs[id])} has no ${field} as ${kind} (found ${typeName(v)})`);
    return v;
  }
  function measuredOf(id) {
    const def = defs[id];
    if (def.date === "@mtime") return `${load(id).mtime} (file written)`;
    if (def.date.startsWith("@")) return measuredOf(def.date.slice(1));
    return String(get(id, def.date, "text"));
  }
  const kindOf = (id) => { const k = defs[id].kind; return k === "HAND" ? `HAND ${measuredOf(id).slice(0, 10)}` : k; };
  const src = (id, where, value, measured) => ({ file: label(defs[id]), where, value: typeof value === "string" ? value : JSON.stringify(value), measured: measured || measuredOf(id), kind: kindOf(id) });
  const D = {}, S = {};
  const put = (key, value, ...sources) => { D[key] = value; S[key] = sources; };

  // ---- the run: report.json names the snapshot (the caller read it); the files of the run
  Sn("site", "_site.json", "RUN", "finishedAt");
  Sn("body", "pages/home/body.html", "RUN", "@site", true);
  Sn("resp", "pages/home/response.json", "RUN", "fetchedAt");
  Sn("sitemaps", "site/sitemaps.json", "RUN", "@site");
  Sn("probes", "site/probes.json", "RUN", "@site");
  Sn("mobile", "pages/home/browser-mobile.json", "RUN", "measuredAt");
  P("bing", "research/bing.json", "RUN", "generatedAt");
  P("index", "research/index.json", "CAPTURE", "generatedAt");
  P("serp", "research/serp.json", "CAPTURE", "generatedAt");
  P("auto", "research/autocomplete.json", "CAPTURE", "generatedAt");
  P("ai", "research/ai-answers.json", "CAPTURE", "generatedAt");
  P("aicit", "research/ai-citations.json", "CAPTURE", "generatedAt");
  P("business", "approved/business.json", "APPROVED", "@mtime");
  P("profile", "captures/local/profile.json", "CAPTURE", "capturedAt");
  P("cites", "captures/local/citations.json", "CAPTURE", "@mtime");
  P("social", "research/social.json", "CAPTURE", "generatedAt");
  P("ads", "research/ads.json", "CAPTURE", "generatedAt");
  P("comp", "research/competitors.json", "RUN", "generatedAt");
  P("approved", "approved/competitors.json", "RUN", "generatedAt");
  P("auth", "authority.json", "RUN", "fetchedAt");
  P("vet", "authority/vetting.json", "RUN", "generatedAt");
  P("opp", "authority/opportunities.json", "RUN", "generatedAt");
  P("seorun", "seo-run.json", "RUN", "@mtime");
  X("backing", cfg.backingAbs, "client-copy/backing.json", "STANDARD COPY", "@mtime");
  X("book", cfg.bookAbs, path.basename(cfg.bookAbs), "PRODUCT BOOK", "@mtime", true);
  if (client.promisePattern) Sn("rendered", "pages/home/rendered-text.txt", "RUN", "@site", true);
  const handDef = { leadPath: ["lead", "capturedAtUtc", false], mail: ["email", "queriedAt", false], domain: ["rdap", "queriedAt", false], trust: ["trust", "@mtime", false], filing: ["filing", "@mtime", true] };
  for (const [k, [id, date, text]] of Object.entries(handDef)) if (hand[k]) X(id, hand[k].abs, hand[k].label, "HAND", date, text);
  const aicap = (file) => { const id = `aicap:${file}`; if (!defs[id]) P(id, `captures/ai/${file}`, "CAPTURE", "capturedAt"); return id; };

  // the newest speed file: <yyyy-mm-dd>.json in psi/ (a name with anything after the date is not one)
  const newest = (sub) => {
    const d = path.join(pewp, sub);
    const names = fs.existsSync(d) ? fs.readdirSync(d).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort() : [];
    if (!names.length) stop(`STOP: .pewp/${sub}/<yyyy-mm-dd>.json is missing`);
    return names[names.length - 1];
  };
  const psiName = newest("psi");
  P("psi", `psi/${psiName}`, "RUN", "generatedAt");
  // the grid: the LAST evidence path of the step local-grid-import in seo-run.json (the list is oldest date first)
  const evidence = get("seorun", "steps[id=local-grid-import].evidence", "array");
  if (!evidence.length) stop(`STOP: ${label(defs.seorun)} has no steps[id=local-grid-import].evidence`);
  const rawEv = String(evidence[evidence.length - 1]).replace(/\\/g, "/");
  const evCands = [rawEv, path.join(path.dirname(pewp), rawEv), path.join(pewp, rawEv)];
  const evAbs = evCands.find((p) => fs.existsSync(p) && fs.statSync(p).isFile()) || evCands[0];
  const evRel = path.relative(pewp, evAbs).replace(/\\/g, "/");
  const evLabel = !evRel.startsWith("..") && !path.isAbsolute(evRel) ? `.pewp/${evRel}` : path.basename(rawEv);
  X("grid", evAbs, evLabel, "CAPTURE", "date");

  // ---- the business (approved file): name, domain, vocabulary, service area
  const name = get("business", "name", "text");
  const domain = get("business", "domain", "text");
  const vocab = get("business", "vocabulary", "array").map((v) => String(v).toLowerCase());
  const area = get("business", "locations[0].serviceArea", "array");
  if (!area.length) stop(`STOP: ${label(defs.business)} has no locations[0].serviceArea entry`);
  const home = String(area[0]).split(",")[0].trim();
  const shortName = client.shortName || name.split(/\s+/)[0];
  const nameWord = (client.nameWord || shortName).toLowerCase();
  const nicknames = (client.alsoSearchedAs || []).map((x) => String(x).toLowerCase());
  put("biz", { name, domain, home, shortName }, src("business", "name, domain, locations[0].serviceArea[0]", `${name}, ${domain}, ${area[0]}`));
  put("serviceCities", area.length, src("business", "locations[0].serviceArea (length)", area.length));

  // ---- date of the audit (the newest speed read) and speed
  const psiAt = get("psi", "generatedAt", "date");
  const d0 = new Date(psiAt);
  D.fileDate = psiName.slice(0, 10);
  put("month", `${MONTHS[d0.getUTCMonth()]} ${d0.getUTCFullYear()}`, src("psi", "generatedAt", psiAt));
  const lcpPhone = get("psi", "pages[strategy=mobile].lcpMs", "number");
  const lcpDesk = get("psi", "pages[strategy=desktop].lcpMs", "number");
  const runs = get("psi", "pages[strategy=mobile].medianOf", "count");
  put("lcpS", (lcpPhone / 1000).toFixed(1), src("psi", "pages[strategy=mobile].lcpMs (median of medianOf runs)", `${lcpPhone} ms, medianOf ${runs}`));
  put("lcpDeskS", (lcpDesk / 1000).toFixed(1), src("psi", "pages[strategy=desktop].lcpMs", lcpDesk));
  put("goodLcpS", "2.5", { file: "web.dev/articles/lcp (Google's own guidance)", where: "a reference, not data", value: "2.5 s", measured: "2026-11-10", kind: "PINNED reference" });

  // ---- what the server sends (the snapshot)
  const bodyText = get("body", "text", "string");
  const visible = bodyText.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  const words = (visible.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []).length; // no match = no word in the served body
  put("wordsSent", words, src("body", "words outside the tags of the served body", `${words} words (${bodyText.trim().replace(/\s+/g, " ").slice(0, 200)})`));
  const smCount = get("sitemaps", "urlCount", "count");
  const smType = get("sitemaps", "fetched[0].contentType", "text");
  const smBytes = get("sitemaps", "fetched[0].bytes", "count");
  const homeBytes = get("resp", "htmlBytes", "count");
  put("sitemapPages", smCount, src("sitemaps", "urlCount", smCount));
  put("sitemapIsHome", /html/i.test(smType) && smBytes === homeBytes, src("sitemaps", "fetched[0].contentType, fetched[0].bytes", `${smType}, ${smBytes} bytes`), src("resp", "htmlBytes (the home page)", homeBytes));
  const nf = get("probes", "notFound.finalStatus", "count");
  put("notFoundStatus", nf, src("probes", "notFound.finalStatus", nf));
  const hosts = Object.keys(get("mobile", "totals.thirdPartyHosts", "object"));
  put("outsideOnlyFonts", hosts.every((h) => /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(h)), src("mobile", "totals.thirdPartyHosts (keys)", hosts));
  const headings = get("mobile", "page.headings", "array");
  const faqAt = headings.findIndex((h) => /^H2 .*(frequently asked|faq)/i.test(h));
  if (faqAt < 0) put("faq", null);
  else {
    let faqShown = 0;
    for (let i = faqAt + 1; i < headings.length && !/^H2 /.test(headings[i]); i++) if (/^H3 /.test(headings[i])) faqShown++;
    const marked = getMaybe("mobile", "page.structuredData[json/@type=FAQPage].json.mainEntity", "array");
    put("faq", { marked: marked ? marked.length : 0, of: faqShown }, src("mobile", "page.structuredData[json/@type=FAQPage].json.mainEntity (length)", marked ? marked.length : 0), src("mobile", "page.headings (H3 under the FAQ heading)", faqShown));
  }
  const blocks = get("mobile", "page.structuredData", "array");
  const sdAt = blocks.findIndex((b) => b && b.json && (b.json.address || b.json.sameAs));
  if (sdAt < 0) stop(`STOP: ${label(defs.mobile)} has no page.structuredData block with json.address or json.sameAs`);
  const sameAs = get("mobile", `page.structuredData[${sdAt}].json.sameAs`, "array").length;
  const siteAddr = get("mobile", `page.structuredData[${sdAt}].json.address.streetAddress`, "text");
  if (client.promisePattern) {
    const takes = get("rendered", `match:(${client.promisePattern})`, "text");
    put("takes", takes, src("rendered", `the line holding the promise ${client.promisePattern}`, takes));
  } else put("takes", null);

  // ---- the application (a hand read: no step of the run walks the lead path)
  if (hand.leadPath) {
    const key = getMaybe("lead", "jotformFields", "object") ? "jotformFields" : "formFields";
    const obj = get("lead", key, "object");
    const groups = Object.keys(obj).filter((k) => Array.isArray(obj[k]));
    if (!groups.length) stop(`STOP: ${label(defs.lead)} has no ${key} group that is a list`);
    const sum = (ks) => ks.reduce((t, k) => t + obj[k].length, 0);
    const optional = groups.filter((k) => /Optional$/.test(k));
    const fields = sum(groups);
    const all = groups.flatMap((k) => obj[k].map(String));
    const taxId = all.some((f) => /tax id/i.test(f)), ssn = all.some((f) => /ssn|social security/i.test(f));
    put("formFields", fields, src("lead", `${key} (group lengths)`, groups.map((k) => `${k} ${obj[k].length}`).join(" + ") + ` = ${fields}`));
    put("formFieldsOne", fields - sum(optional), src("lead", `${key} (group lengths, without the groups ending in Optional)`, `${fields - sum(optional)}`));
    put("formAsks", { taxId, ssn, optional: optional.length > 0 }, src("lead", `${key} (a field naming a tax ID or an SSN; a group ending in Optional)`, { taxId, ssn, optional: optional.length > 0 }));
  } else put("formFields", null);

  // ---- products, demand (Bing) and whether a page is listed for each (index)
  const checks = get("index", "rows[engine=google].serviceChecks", "array");
  const products = checks.map((_, i) => get("index", `rows[engine=google].serviceChecks[${i}].service`, "text"));
  if (!products.length) stop(`STOP: ${label(defs.index)} has no rows[engine=google].serviceChecks entry`);
  for (const p of products) if (!vocab.includes(p.toLowerCase())) stop(`STOP: ${label(defs.business)} has no vocabulary entry ${p}`);
  const labelOf = (p) => (client.labels && client.labels[p]) || upperFirst(p);
  const missing = get("index", "summary.servicesMissing", "array");
  const checked = get("index", "summary.servicesChecked", "count");
  const listed = get("index", "summary.servicesListed", "count");
  put("productPages", { listed, of: checked }, src("index", "summary.servicesListed / servicesChecked", `${listed} / ${checked}`));
  const first = products[0];
  const unit = get("bing", `keywords[query=${first}&related=false].volume.unit`, "text");
  const span = unit.match(/(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/);
  if (!span) stop(`STOP: ${label(defs.bing)} has no keywords[query=${first}&related=false].volume.unit date range`);
  const days = Math.round((Date.parse(span[2]) - Date.parse(span[1])) / 86400000);
  const where = get("bing", `keywords[query=${first}&related=false].volume.location`, "text");
  put("demandDays", days, src("bing", `keywords[query=${first}&related=false].volume.unit`, unit));
  put("demandWhere", where === "US" ? "the US" : where, src("bing", `keywords[query=${first}&related=false].volume.location`, where));
  const demand = products.map((p) => {
    const v = get("bing", `keywords[query=${p}&related=false].volume.value`, "number");
    const lab = labelOf(p);
    return { key: p, product: lab, lower: lowerFirst(lab), value: v, page: !missing.includes(p) };
  }).sort((a, b) => b.value - a.value);
  const total = demand.reduce((t, r) => t + r.value, 0);
  put("demand", demand, ...demand.map((r) => src("bing", `keywords[query=${r.key}&related=false].volume.value`, r.value)), src("index", "summary.servicesMissing", missing));
  const top = demand[0];
  put("topDemand", { key: top.key, product: top.product, lower: top.lower, value: top.value, share: Math.round((100 * top.value) / total), second: demand[1] ? demand[1].lower : null, products: demand.length, page: top.page },
    src("bing", `keywords[query=${top.key}&related=false].volume.value / sum of the ${demand.length} products`, `${top.value} / ${total}`));
  const kwLen = get("bing", "keywords", "array").length;
  put("keywordsRead", kwLen, src("bing", "keywords (length)", kwLen));

  // ---- results pages (read from outside the area)
  const captures = get("serp", "captures", "array");
  const total2 = get("serp", "counts.captures", "count");
  const notLoc = get("serp", "counts.notLocalized", "count");
  const caps = captures.map((_, i) => {
    const q = get("serp", `captures[${i}].query`, "text");
    get("serp", `captures[${i}].ourPosition`, "object");
    const pos = getMaybe("serp", `captures[${i}].ourPosition.value`, "number"); // null = not among the results read
    return { q, pos, engine: get("serp", `captures[${i}].engine`, "text"), device: get("serp", `captures[${i}].device`, "text") };
  });
  const isSite = (q) => /^site:/i.test(q);
  const isShort = (q) => nicknames.some((n) => q.toLowerCase().includes(n));
  const isName = (q) => q.toLowerCase().includes(nameWord);
  const named = caps.filter((c) => !isSite(c.q) && !isShort(c.q) && isName(c.q));
  const short = caps.filter((c) => !isSite(c.q) && isShort(c.q));
  const prod = caps.filter((c) => !isSite(c.q) && !isShort(c.q) && !isName(c.q));
  put("serp", {
    total: total2, outside: notLoc === total2, engines: [...new Set(caps.map((c) => c.engine))], devices: [...new Set(caps.map((c) => c.device))],
    product: prod.length, productWithUs: prod.filter((c) => c.pos !== null).length,
    name: named.length, nameFirst: named.filter((c) => c.pos === 1).length, short: short.length, shortWithUs: short.filter((c) => c.pos !== null).length,
  }, src("serp", "counts.captures, counts.notLocalized", `${total2}, ${notLoc}`),
  src("serp", "captures[*].ourPosition.value where the query is a product search", `${prod.filter((c) => c.pos !== null).length} of ${prod.length} not null`),
  src("serp", "captures[*].ourPosition.value where the query holds the business's name", named.map((c) => c.pos)),
  src("serp", "captures[*].ourPosition.value where the query is a nickname", short.map((c) => c.pos)));
  const seeds = get("auto", "seeds", "array").length, arows = get("auto", "rows", "array").length;
  put("suggest", { seeds, rows: arows }, src("auto", "seeds (length), rows (length)", `${seeds}, ${arows}`));

  // ---- AI assistants
  const eng = {};
  for (const e of ["chatgpt", "perplexity", "copilot", "gemini"]) {
    eng[e] = { status: get("ai", `summary.engines[engine=${e}].status`, "text"), questions: get("ai", `summary.engines[engine=${e}].questions`, "count"), named: get("ai", `summary.engines[engine=${e}].named`, "count") };
  }
  const aiRows = get("ai", "rows", "array").map((_, i) => {
    const status = get("ai", `rows[${i}].status`, "text");
    const r = { engine: get("ai", `rows[${i}].engine`, "text"), status, file: get("ai", `rows[${i}].file`, "text") };
    if (status === "ok") { r.type = get("ai", `rows[${i}].type`, "text"); r.named = get("ai", `rows[${i}].named`, "boolean"); r.question = get("ai", `rows[${i}].question`, "text"); r.signedIn = get(aicap(r.file), "signedIn", "boolean"); }
    return r;
  });
  for (const e of ["chatgpt", "perplexity"]) {
    const ok = aiRows.filter((r) => r.engine === e && r.status === "ok");
    eng[e].buyer = ok.filter((r) => r.type === "buyer").length;
    eng[e].buyerNamed = ok.filter((r) => r.type === "buyer" && r.named).length;
    eng[e].brandNamed = ok.filter((r) => r.type === "brand" && r.named).length;
    eng[e].questions_ = ok.map((r) => r.question).sort().join("|");
  }
  const okRows = aiRows.filter((r) => r.status === "ok");
  if (!okRows.length) stop(`STOP: ${label(defs.ai)} has no rows[status=ok]`);
  const blockedWhy = ["copilot", "gemini"].map((e) => get("ai", `summary.blockedEngines[engine=${e}].reason`, "text"));
  const aiAnswers = get("ai", "summary.questions", "count");
  put("ai", {
    chat: eng.chatgpt, perp: eng.perplexity, sameQuestions: eng.chatgpt.questions_ === eng.perplexity.questions_,
    allSignedIn: okRows.every((r) => r.signedIn), blockedBySignIn: ["copilot", "gemini"].every((e) => eng[e].status === "blocked") && blockedWhy.every((x) => /sign/i.test(x)),
    answers: aiAnswers,
  }, src("ai", "summary.engines[engine=chatgpt].questions/named", `${eng.chatgpt.questions}/${eng.chatgpt.named}`),
  src("ai", "summary.engines[engine=perplexity].questions/named", `${eng.perplexity.questions}/${eng.perplexity.named}`),
  src("ai", "rows[type=buyer].named by engine", `chatgpt ${eng.chatgpt.buyerNamed}/${eng.chatgpt.buyer}, perplexity ${eng.perplexity.buyerNamed}/${eng.perplexity.buyer}`),
  src("ai", "summary.engines[engine=copilot|gemini].status, summary.blockedEngines[*].reason", ["copilot", "gemini"].map((e) => eng[e].status)),
  src("ai", "summary.questions (answers from both assistants)", aiAnswers),
  { ...src(aicap(okRows[0].file), `signedIn, in each of the ${okRows.length} answer captures named by research/ai-answers.json rows[*].file`, `${okRows.filter((r) => r.signedIn).length} of ${okRows.length} true`, okRows.map((r) => measuredOf(aicap(r.file))).sort().filter((x, i, a) => i === 0 || i === a.length - 1).join(" to ")), file: ".pewp/captures/ai/*.json" });
  const comps = get("ai", "summary.competitors", "array");
  const instead = comps.slice(0, 5).map((_, i) => ({ name: get("ai", `summary.competitors[${i}].name`, "text"), count: get("ai", `summary.competitors[${i}].count`, "count") }));
  put("aiInstead", instead, src("ai", "summary.competitors[0..4]", instead.map((x) => `${x.name} ${x.count}`)));
  const citRows = get("aicit", "rows", "array").map((_, i) => ({ engine: get("aicit", `rows[${i}].engine`, "text"), i }));
  const gRows = citRows.filter((r) => r.engine === "google-ai-overview").map((r) => ({ q: get("aicit", `rows[${r.i}].question`, "text"), share: get("aicit", `rows[${r.i}].ourNameMentionedShare.value`, "number") }));
  const gNamed = gRows.filter((r) => r.share > 0);
  put("googleAi", { total: gRows.length, named: gNamed.length, namedForName: gNamed.filter((r) => r.q.toLowerCase().includes(nameWord)).length, namedOther: [...new Set(gNamed.filter((r) => !r.q.toLowerCase().includes(nameWord)).map((r) => r.q))] },
    src("aicit", "rows[engine=google-ai-overview].ourNameMentionedShare.value > 0", `${gNamed.length} of ${gRows.length}: ${gNamed.map((r) => r.q).join("; ")}`));

  // ---- Google Maps grid (each point is what Maps lists centred there)
  const n = get("grid", "plan.n", "count");
  const spacing = get("grid", "plan.spacingKm", "number");
  const planned = get("grid", "plan.captures", "count");
  const localized = get("grid", "summary.localized", "count");
  const solv = get("grid", "solv", "array").map((_, i) => {
    const query = get("grid", `solv[${i}].query`, "text"), city = get("grid", `solv[${i}].city`, "text");
    const cityName = city.split(",")[0].trim();
    const key = query.replace(new RegExp(`\\s+${escRe(cityName)}$`, "i"), "").toLowerCase();
    if (!products.includes(key)) stop(`STOP: ${label(defs.grid)} has no solv[${i}].query for one of the ${products.length} products (${query})`);
    return { key, city, cityName, points: get("grid", `solv[${i}].points`, "count"), inPack: get("grid", `solv[${i}].pointsInPack`, "count"), in3: get("grid", `solv[${i}].pointsIn3Pack`, "count") };
  });
  const pts = get("grid", "points", "array").map((_, i) => ({ city: get("grid", `points[${i}].city`, "text"), i }));
  const cities = [...new Set(solv.map((s) => s.cityName))].sort((a, b) => (a === home ? -1 : b === home ? 1 : 0));
  if (!cities.includes(home)) stop(`STOP: ${label(defs.grid)} has no solv[city=${home}]`);
  const per = n * n;
  if (solv.some((s) => s.points !== per)) stop(`STOP: ${label(defs.grid)} has no solv[*].points equal to plan.n x plan.n for every search`);
  const cell = (key, cityName) => { const s = solv.find((x) => x.key === key && x.cityName === cityName); if (!s) stop(`STOP: ${label(defs.grid)} has no solv[query=${key} ${cityName}]`); return s; };
  const gridRows = demand.map((r) => ({ key: r.key, product: r.product, lower: r.lower, value: r.value, cells: cities.map((c) => cell(r.key, c)) }));
  const away = solv.filter((s) => s.cityName !== home);
  put("grid", { per, spacing, cities, captures: planned, localizedAll: localized === planned, products: products.length, rows: gridRows, awayBest: away.length ? Math.max(...away.map((s) => s.in3)) : null, awayCities: [...new Set(away.map((s) => s.cityName))] },
    src("grid", "plan.n, plan.spacingKm, plan.captures, summary.localized", `${n}, ${spacing}, ${planned}, ${localized}`),
    ...solv.map((s) => src("grid", `solv[query=${s.key} ${s.cityName}].pointsInPack / pointsIn3Pack`, `${s.inPack} / ${s.in3}`)));

  // ---- the Google listing, other directories, addresses
  const rating = get("profile", "reviews.rating", "number"), reviews = get("profile", "reviews.count", "count");
  const ourName = get("profile", "name", "text");
  put("rating", { rating: rating.toFixed(1), reviews }, src("profile", "reviews.rating, reviews.count", `${rating}, ${reviews}`));
  const desc = get("profile", "description", "string"), services = get("profile", "services", "array");
  put("profileEmpty", { description: desc.trim() === "", services: services.length === 0 }, src("profile", "description, services", { description: desc, services }));
  // businesses Maps put in the first three around the home city: how many show more reviews than this listing
  const seen = new Map();
  for (const p of pts.filter((x) => x.city.split(",")[0].trim() === home)) {
    const t3 = get("grid", `points[${p.i}].top3`, "array");
    t3.forEach((_, j) => {
      const name = get("grid", `points[${p.i}].top3[${j}].name`, "text");
      if (isAd(name) || name === ourName) return;
      const rv = getMaybe("grid", `points[${p.i}].top3[${j}].reviews`, "count"); // a card may show no review count
      if (!seen.has(name) || (rv !== null && (seen.get(name) === null || rv > seen.get(name)))) seen.set(name, rv);
    });
  }
  const withCount = [...seen.values()].filter((v) => v !== null);
  put("rivalReviews", { more: withCount.filter((v) => v > reviews).length, of: withCount.length, ours: reviews },
    src("grid", `points[city=${home}].top3[*].name/reviews (distinct names, ads left out, our listing left out)`, `${withCount.filter((v) => v > reviews).length} of ${withCount.length} above ${reviews}`));
  const dirNames = cfg.dirNames || {};
  const citeRows = get("cites", "$", "array").map((_, i) => ({ i, directory: get("cites", `[${i}].directory`, "text"), status: get("cites", `[${i}].status`, "text"), at: get("cites", `[${i}].capturedAt`, "date") }));
  const printedName = (d) => dirNames[d] || (d.match(/\(([^)]+)\)/) || [])[1] || d.split(/[ (]/)[0].split(".")[0];
  const dirRows = citeRows.filter((r) => r.status === "listed" || r.status === "not listed").map((r) => ({ name: printedName(r.directory), status: r.status, at: r.at, directory: r.directory }));
  const rank = (d) => { const k = Object.keys(dirNames).indexOf(d); return k < 0 ? Infinity : k; }; // directories.json's order first, the others after in capture order (stable sort)
  dirRows.sort((a, b) => (rank(a.directory) === rank(b.directory) ? 0 : rank(a.directory) < rank(b.directory) ? -1 : 1));
  put("directories", dirRows, ...dirRows.map((r) => src("cites", `[directory=${r.directory}].status (${r.name})`, r.status, r.at)));
  const gAddr = street(get("profile", "address", "text"), home);
  const bingRow = citeRows.find((r) => /bing/i.test(r.directory) && getMaybe("cites", `[${r.i}].address`, "text") !== null);
  const bAddr = bingRow ? street(get("cites", `[${bingRow.i}].address`, "text"), home) : null;
  const fAddr = hand.filing ? street(get("filing", "match:^\\| State filing \\| ([^|]+?) \\|", "text"), home) : null;
  const wAddr = street(siteAddr, home);
  const addrRows = [];
  const add = (w2, a) => { const r = addrRows.find((x) => x.address.toLowerCase() === a.toLowerCase()); if (r) r.where.push(w2); else addrRows.push({ where: [w2], address: a }); };
  const addSrc = [src("mobile", `page.structuredData[${sdAt}].json.address.streetAddress`, wAddr), src("profile", "address", gAddr)];
  add("Your website", wAddr); add("Google Maps", gAddr);
  if (bingRow) { add(printedName(bingRow.directory), bAddr); addSrc.push(src("cites", `[directory=${bingRow.directory}].address`, bAddr, bingRow.at)); }
  if (fAddr !== null) { add("State filing", fAddr); addSrc.push(src("filing", 'the line "| State filing | ... |"', fAddr)); }
  put("addresses", addrRows, ...addSrc);

  // ---- profiles on other sites
  const socialRows = get("social", "rows", "array").map((_, i) => ({ platform: get("social", `rows[${i}].platform`, "text"), url: get("social", `rows[${i}].profileUrl`, "text") }));
  const broken = get("social", "summary.linksBroken", "array");
  const NAMES = { instagram: "Instagram", youtube: "YouTube", linkedin: "LinkedIn", tiktok: "TikTok", facebook: "Facebook", x: "X", twitter: "Twitter", pinterest: "Pinterest" };
  const pName = (p) => NAMES[p] || upperFirst(p);
  const brokenNames = socialRows.filter((r) => broken.includes(r.url)).map((r) => pName(r.platform));
  put("profiles", { total: socialRows.length, names: socialRows.map((r) => pName(r.platform)), inCard: sameAs, broken: brokenNames },
    src("social", "rows (length), rows[*].platform", socialRows.map((r) => r.platform)), src("social", "summary.linksBroken", broken),
    src("mobile", `page.structuredData[${sdAt}].json.sameAs (length)`, sameAs));

  // ---- competitors and links
  const approvedRows = get("comp", "approvedRows", "count");
  const sites = get("comp", "sites", "array").map((_, i) => { const status = get("comp", `sites[${i}].status`, "count"); return { status, words: status === 200 ? get("comp", `sites[${i}].page.words`, "count") : null }; });
  const read = sites.filter((s) => s.status === 200);
  put("sitesRead", { read: read.length, of: approvedRows, allSend: read.length > 0 && read.every((s) => s.words > 0) }, src("comp", "approvedRows; sites[*].status == 200; sites[*].page.words > 0", `${read.length} of ${approvedRows}; ${read.filter((s) => s.words > 0).length} with words`));
  let list = client.rivals;
  if (!list) {
    const rowsN = get("approved", "rows", "array").length;
    list = [];
    for (let i = 0; i < rowsN && list.length < 9; i++) {
      const d = get("approved", `rows[${i}].domain`, "text");
      if (getMaybe("comp", `sites[domain=${d}].status`, "count") !== 200) continue;
      list.push({ domain: d, name: null, type: get("approved", `rows[${i}].note`, "text").split(";")[0].trim(), group: "other" });
    }
  }
  const rivals = list.map((r) => {
    const d = r.domain;
    const inGraph = get("auth", `results[domain=${d}].inGraph`, "boolean");
    return { domain: d, name: r.name || get("approved", `rows[domain=${d}].name`, "text"), type: r.type, group: r.group,
      words: get("comp", `sites[domain=${d}].page.words`, "count"), sitemap: get("comp", `sites[domain=${d}].sitemap.pages`, "count"), links: inGraph ? get("auth", `results[domain=${d}].linkingDomains`, "count") : null };
  });
  const ourGraph = get("auth", `results[domain=${domain}].inGraph`, "boolean");
  put("rivals", rivals, ...rivals.flatMap((r) => [src("comp", `sites[domain=${r.domain}].page.words, .sitemap.pages`, `${r.words}, ${r.sitemap}`), src("auth", `results[domain=${r.domain}].linkingDomains`, r.links === null ? "not in graph" : r.links), src("approved", `rows[domain=${r.domain}] (the name, the type)`, r.type)]));
  put("ourLinks", ourGraph, src("auth", `results[domain=${domain}].inGraph`, ourGraph));
  const adRow = (d) => { if (getMaybe("ads", `rows[advertiser=${d}&library=google-transparency].status`, "text") === "blocked") return null; if (getMaybe("ads", `rows[advertiser=${d}&library=google-transparency].library`, "text") === null) return null; const url = get("ads", `rows[advertiser=${d}&library=google-transparency].url`, "text"); const w3 = url.match(/preset-date=Last\+(\d+)\+days/i); const rv = rivals.find((r) => r.domain === d); return { domain: d, name: rv ? rv.name : d, count: get("ads", `rows[advertiser=${d}&library=google-transparency].adCount`, "count"), days: w3 ? Number(w3[1]) : null }; };
  const ads = (client.adsFor || []).map(adRow).filter((a) => a && a.days !== null); // only a count with its window; a rival whose Google page was not tied is left out
  put("ads", ads, ...ads.map((a) => src("ads", `rows[advertiser=${a.domain}&library=google-transparency].adCount, .url (window)`, `${a.count}, last ${a.days} days`)));
  const pursue = get("vet", "summary.PURSUE", "count");
  const vres = get("vet", "results", "array").map((_, i) => ({ verdict: get("vet", `results[${i}].verdict`, "text"), type: get("vet", `results[${i}].type`, "text") }));
  const chambers = vres.filter((r) => r.verdict === "PURSUE" && r.type === "chamber-local");
  const metro = client.linkPlace ? get("opp", `opportunities[domain=${client.linkPlace}].linksToCompetitors`, "count") : null;
  put("linkPlaces", { pursue, chambers: chambers.length, metro }, src("vet", "summary.PURSUE; results[verdict=PURSUE&type=chamber-local] (count)", `${pursue}; ${chambers.length}`),
    ...(metro === null ? [] : [src("opp", `opportunities[domain=${client.linkPlace}].linksToCompetitors`, metro)]));

  // ---- older hand work: mail records, domain renewal, licence wording
  if (hand.mail) {
    const spf = get("email", "spfRecordCount", "count");
    const dmarcMissing = getMaybe("email", "dmarc.notFound", "text") !== null;
    const sel = Object.keys(get("email", "dkimSelectors", "object"));
    const dkimFound = sel.some((k) => getMaybe("email", `dkimSelectors.${k}.txt`, "text") !== null || getMaybe("email", `dkimSelectors.${k}.cname`, "text") !== null);
    put("mail", { spf, dmarcMissing, dkimFound }, src("email", "spfRecordCount, dmarc.notFound, dkimSelectors[*].txt/cname", { spf, dmarcMissing, dkimFound }));
  } else put("mail", null);
  if (hand.domain) {
    const exp = new Date(get("rdap", "events.expiration", "date"));
    put("renewBy", `${exp.getUTCDate()} ${SHORT[exp.getUTCMonth()]} ${exp.getUTCFullYear()}`, src("rdap", "events.expiration", exp.toISOString()));
  } else put("renewBy", null);
  if (hand.trust) {
    const lic = get("trust", `${client.handReads.trustKey}.licenceTermsInRenderedText`, "array").length;
    put("licenceWords", lic, src("trust", `${client.handReads.trustKey}.licenceTermsInRenderedText (length)`, lic));
  } else put("licenceWords", null);
  const gscStatus = get("bing", "siteStats.status", "text");
  put("gscBlocked", gscStatus === "blocked", src("bing", "siteStats.status, siteStats.blocked", `${gscStatus}: ${getMaybe("bing", "siteStats.blocked", "text")}`));

  // ---- page 8: a line stays only if backing.json names its rows and every one of them reads WORKS in the product book
  const backing = get("backing", "$", "object");
  for (const k of Object.keys(backing)) {
    const ids = get("backing", k, "array");
    const states = ids.map((id) => ({ id, state: get("book", `match:^\\| ${escRe(String(id))} [^|]*\\| ([A-Z]+) \\|`, "text") }));
    const works = states.every((s) => s.state === "WORKS");
    put(`v2_${k}`, works, src("backing", k, ids), ...states.map((s) => src("book", `the row "| ${s.id} ... |" state`, s.state)));
  }
  return { D, S, fmt, labelOf };
}
