// S1 intake: builds <pewp>/business.json (schemas/targets.md) from what the site says about itself plus a JSON answers file,
// and prints the questions still missing. THIS SCRIPT NEVER PROMPTS: the main session turns each question into a pickable
// option (AskUserQuestion, recommended option first), appends the picks to <pewp>/intake-answers.json, and re-runs it.
// Usage: node intake.mjs <url | repo path> [--answers FILE] [--snapshot DIR] [--cwd DIR] [--refresh] [--require-vocabulary]
// Facts come from (1) the newest complete snapshot of a URL target, or the built index.html of a repo target, (2) the answers
// file (<pewp>/intake-answers.json is read automatically; --answers adds another). Answers win over site facts.
// Who answered (contract C2): an answer is bare (legacy: provenance "unstated") or {"value": ..., "answeredBy": "owner" | "site" | "default"}.
// business.json.provenance says, per field, owner | site | default | unstated; approve.mjs business refuses a business whose owner-only fields
// (kind, offer, audience, goals, competitors, brand.constraints, vocabulary) are not "owner". vocabulary (the words the business and its readers
// use) is asked as a question and [] is not an answer; it blocks only with --require-vocabulary (overhaul mode), otherwise approve refuses without it.
// The site's own contact block (work order 41, gap 2): when the owner has not answered phone or the address of the first location, intake reads them from the page
// (JSON-LD telephone / address, then a tel: link / an <address> element, then the visible text: a phone and a street address "100 Main St, Sacramento, CA 95814") and uses them as a
// LABELLED DEFAULT: business.phone, locations[0].address, and business.contact = { name, address, phone: { value, source, from, readAt, others? } } where source is
// "the site, not confirmed by the owner" (or "the owner" for an answered value: the answers always win). A `defaulted` row says it too. A page with no contact block gives nothing:
// nothing is invented, and the local suite stays BLOCKED for want of it, naming it.
// Outputs: business.json (only when nothing is missing), intake-facts.json (every found fact with its source, what was
// accepted, what was defaulted, the open questions), business.draft.json. Exit 0 complete, 3 questions open (BLOCKED), 2 usage.
import fs from "node:fs";
import { delegationOf } from "./lib-provenance.mjs";
import path from "node:path";
import zlib from "node:zlib";
import { rulesDir } from "./lib-rules.mjs";
import { markStage } from "./state.mjs";
import { latestComplete } from "./live-target.mjs";
import { J, W, iso, today, domainOf, slug, context, runCli, parseArgs, Usage } from "./research-lib.mjs";

const GOALS = ["leads", "calls", "bookings", "sales"];
const LAUNCH = ["live", "preview", "planned"];
const SOCIAL = /(facebook|instagram|linkedin|youtube|tiktok|twitter|x|pinterest|yelp|zillow|realtor|houzz|nextdoor|bbb)\.(com|org)/i;
const PREVIEW_HOST = /(\.pages\.dev|\.vercel\.app|\.netlify\.app|\.github\.io|\.web\.app|localhost|127\.0\.0\.1)$/i;
const KIND_BY_TYPE = { RealEstateAgent: "real-estate-agent", RealEstateOrganization: "real-estate-agent", Plumber: "plumber", Electrician: "electrician", Dentist: "dentist", InsuranceAgency: "insurance-agency", Attorney: "lawyer", LegalService: "lawyer", Restaurant: "restaurant", HVACBusiness: "hvac", RoofingContractor: "roofing-contractor", GeneralContractor: "general-contractor", AutoRepair: "auto-repair", MedicalBusiness: "medical-practice", Physician: "medical-practice", FinancialService: "financial-service", AccountingService: "accountant", HomeAndConstructionBusiness: "home-services", LocalBusiness: "local-service", ProfessionalService: "professional-service", NewsMediaOrganization: "editorial-media", Periodical: "editorial-media", Blog: "editorial-media" };

// ---------- small HTML readers (the snapshot keeps the server's HTML) ----------
// HTML entities in text AND in every URL read from the page (`?hl&#x3D;en` is `?hl=en`); decoded once, so `&amp;#x3D;` stays literal
const decode = (s) => String(s ?? "").replace(/&(?:(amp|lt|gt|quot|apos|nbsp)|#(\d+)|#[xX]([0-9a-fA-F]+));/g, (m, n, d, h) => (n ? { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[n] : String.fromCodePoint(Number.parseInt(d || h, d ? 10 : 16)))).replace(/\s+/g, " ").trim();
const metaOf = (html, key) => { for (const m of html.matchAll(/<meta\b[^>]*>/gi)) { const t = m[0]; const k = (t.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i) || [])[1]; if (k && k.toLowerCase() === key) return decode((t.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1] || ""); } return null; };
function jsonLd(html) {
  const items = [];
  const walk = (o, d = 0) => { if (!o || typeof o !== "object" || d > 8) return; if (Array.isArray(o)) return o.forEach((x) => walk(x, d + 1)); if (o["@type"]) items.push(o); for (const [k, v] of Object.entries(o)) if (k !== "@context") walk(v, d + 1); };
  for (const m of html.matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { walk(JSON.parse(m[1].trim())); } catch {} }
  return items;
}
const types = (o) => [].concat(o["@type"]).map(String);

// The words a home page repeats (2+ times, 4+ letters, not filler): offered to the owner as options for "vocabulary", never assumed.
const WORD_STOP = new Set("about above after again also been before being below between both build cannot could does doing down during each even every from have having here home into just like make many more most much must never only other over page please quite same should since some such than that their them then there these they this those through under until very what when where which while with within without would your yours ours contact privacy policy terms cookies login sign subscribe newsletter menu skip content read more click learn follow share search copyright rights reserved".split(" "));
export function siteWords(html, limit = 12) {
  const text = decode(String(html).replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "));
  const counts = new Map();
  for (const w of text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) || []) if (!WORD_STOP.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([w]) => w);
}

export function readSite(dir) {
  let html = null, file = null;
  const tryRead = (f) => { try { html = fs.readFileSync(f, "utf8"); file = f; return true; } catch { return false; } };
  if (fs.existsSync(path.join(dir, "_site.json"))) {
    const site = J(path.join(dir, "_site.json"));
    const home = (site.pages || []).find((p) => { try { return new URL(p.url).pathname === "/"; } catch { return false; } }) || site.pages?.[0];
    if (home) {
      const raw = path.join(dir, "pages", home.slug, "raw.html.gz");
      if (fs.existsSync(raw)) { html = zlib.gunzipSync(fs.readFileSync(raw)).toString("utf8"); file = raw; }
      else tryRead(path.join(dir, "pages", home.slug, "head.html")) && (html += (fs.existsSync(path.join(dir, "pages", home.slug, "body.html")) ? fs.readFileSync(path.join(dir, "pages", home.slug, "body.html"), "utf8") : ""));
    }
    return html ? { html, file, noindexAll: (site.pages || []).length > 0 && (site.pages || []).every((p) => p.noindex === true), pages: (site.pages || []).length, finishedAt: site.finishedAt } : null;
  }
  for (const c of ["dist/index.html", "build/index.html", "public/index.html", "_site/index.html", "out/index.html", "index.html", "src/index.html"]) if (tryRead(path.join(dir, c))) break;
  return html ? { html, file, noindexAll: false, pages: null, finishedAt: null } : null;
}

// ---------- the site's own contact block (a labelled default; the owner's answers win) ----------
const SITE_UNCONFIRMED = "the site, not confirmed by the owner";
const visibleText = (h) => decode(String(h).replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const PHONE_TXT = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const digits10 = (s) => { const d = String(s).replace(/\D/g, ""); return d.length === 11 && d[0] === "1" ? d.slice(1) : d; };
const fmtUS = (s) => { const d = digits10(s); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(s).trim(); };
const streetRe = /\b\d{1,6}\s+[A-Za-z0-9][A-Za-z0-9 .'#-]{1,40}?\s(?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Ter|Terrace)\b\.?(?:,?\s*(?:Suite|Ste|Unit|#)\s*[\w-]+)?,\s*[A-Za-z][A-Za-z .'-]{1,30},\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/;
// phone: the business's own JSON-LD telephone, then tel: links, then the visible text (the first is taken, the other numbers are listed under others);
// address: the JSON-LD address, then an <address> element, then a street address in the visible text. Returns { phone, address } with value and where; null parts when the page has none.
export function contactBlock(h, biz) {
  const ld = { phone: biz?.telephone ? decode(String(biz.telephone)).trim() : null };
  const tel = [...h.matchAll(/<a\b[^>]*\bhref\s*=\s*["']tel:([^"']+)["']/gi)].map((m) => fmtUS(decode(m[1]))).filter(Boolean);
  const vis = visibleText(h);
  const visiblePhone = (vis.match(PHONE_TXT) || [])[0] || null;
  const phones = [ld.phone && { value: ld.phone, where: "JSON-LD telephone" }, ...tel.map((v) => ({ value: v, where: "tel: link" })), visiblePhone && { value: visiblePhone.trim(), where: "visible text" }].filter(Boolean);
  const phone = ld.phone || tel[0] || visiblePhone;
  const first = phones.find((p) => p.value === phone || digits10(p.value) === digits10(phone || ""));
  const others = [...new Set(phones.filter((p) => digits10(p.value) !== digits10(phone || "")).map((p) => `${p.value} (${p.where})`))];
  let address = null;
  const a = biz?.address;
  if (a && typeof a === "object") { const line = [a.streetAddress, a.addressLocality, [a.addressRegion, a.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", "); if (line) address = { value: line, where: "JSON-LD address" }; }
  else if (typeof a === "string" && a.trim()) address = { value: decode(a).trim(), where: "JSON-LD address" };
  if (!address) {
    const addrEl = h.match(/<address\b[^>]*>([\s\S]*?)<\/address>/i);
    const el = addrEl ? decode(addrEl[1].replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/\s+,/g, ",").replace(/,\s*,/g, ",").trim() : "";
    if (el) address = { value: el, where: "address element" };
    else { const m = visibleText(h).match(streetRe); if (m) address = { value: m[0].trim(), where: "visible text" }; }
  }
  return { phone: phone ? { value: phone, where: first?.where || "visible text", others } : null, address };
}

// What the home page says about the business: each entry is a fact with its source.
export function siteFacts(site, label) {
  const F = [], add = (field, value, how, confidence = "found") => { if (value != null && value !== "" && !(Array.isArray(value) && !value.length)) F.push({ field, value, source: `${label}: ${how}`, fetchedAt: site.finishedAt || iso(), confidence }); };
  const h = site.html;
  const ld = jsonLd(h);
  const biz = ld.find((o) => types(o).some((t) => KIND_BY_TYPE[t] && t !== "Organization")) || ld.find((o) => types(o).some((t) => /Organization|WebSite/.test(t)));
  const ogName = metaOf(h, "og:site_name");
  add("name", biz?.name ? decode(biz.name) : ogName, biz?.name ? `JSON-LD ${types(biz).join("/")}.name` : "meta og:site_name");
  const kind = biz ? types(biz).map((t) => KIND_BY_TYPE[t]).find(Boolean) : null;
  add("kind", kind, `JSON-LD @type ${biz ? types(biz).join("/") : ""}`, "suggest");
  add("vocabulary.candidates", siteWords(h), "words the home page repeats (a suggestion for the owner's vocabulary, not an answer)", "suggest");
  add("offer", metaOf(h, "description"), "meta description (a suggestion to confirm, not a fact about the offer)", "suggest");
  const addr = biz?.address;
  if (addr && typeof addr === "object") {
    const line = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode].filter(Boolean).join(", ");
    add("locations.address", line, "JSON-LD address");
    add("market.country", addr.addressCountry ? String(typeof addr.addressCountry === "object" ? addr.addressCountry.name : addr.addressCountry).slice(0, 2).toUpperCase() : null, "JSON-LD address.addressCountry");
    add("locations.name", addr.addressLocality ? `${addr.addressLocality}${addr.addressRegion ? ", " + addr.addressRegion : ""}` : null, "JSON-LD address.addressLocality");
  }
  const area = biz?.areaServed ? [].concat(biz.areaServed).map((a) => (typeof a === "string" ? a : a?.name)).filter(Boolean) : [];
  add("locations.serviceArea", area, "JSON-LD areaServed");
  const cb = contactBlock(h, biz);
  for (const [field, c] of [["contact.phone", cb.phone], ["contact.address", cb.address]]) if (c) F.push({ field, value: c.value, source: `${label}: ${c.where} (${SITE_UNCONFIRMED})`, fetchedAt: site.finishedAt || iso(), confidence: "found", ...(c.others?.length ? { others: c.others } : {}) });
  const lang = (h.match(/<html\b[^>]*\blang\s*=\s*["']([a-zA-Z-]+)["']/i) || [])[1];
  add("market.language", lang ? lang.slice(0, 2).toLowerCase() : null, "<html lang>");
  const hrefs = [...h.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map((m) => decode(m[1])).filter((u) => /^https?:/i.test(u));
  const sameAs = (biz?.sameAs ? [].concat(biz.sameAs) : []).map(decode);
  const socials = [...new Set([...sameAs, ...hrefs.filter((u) => SOCIAL.test(u))])].filter((u) => SOCIAL.test(u));
  add("existing.socials", socials.slice(0, 12), "JSON-LD sameAs and social links on the page");
  const gbp = [...sameAs, ...hrefs].find((u) => /(g\.page\/|maps\.app\.goo\.gl|google\.com\/maps\/place|[?&]cid=\d{6,})/i.test(u));
  add("existing.businessProfile", gbp, "link to a Google Business Profile on the page");
  const robots = metaOf(h, "robots");
  F.push({ field: "_noindex", value: /noindex|none/i.test(robots || "") || site.noindexAll, source: `${label}: robots meta on the home page`, fetchedAt: site.finishedAt || iso(), confidence: "found" });
  return F;
}

// ---------- answers ----------
function setPath(o, p, v) { const k = p.split("."); let c = o; k.slice(0, -1).forEach((x) => { c = c[x] ??= {}; }); c[k.at(-1)] = v; }
function deepMerge(a, b) { if (Array.isArray(b) || b === null || typeof b !== "object") return b; const o = { ...(a && typeof a === "object" && !Array.isArray(a) ? a : {}) }; for (const [k, v] of Object.entries(b)) o[k] = deepMerge(o[k], v); return o; }
export function normaliseAnswers(raw) { // dotted keys ("market.country") and nested objects both work
  let out = {};
  for (const [k, v] of Object.entries(raw || {})) { const piece = {}; if (k.includes(".")) setPath(piece, k, v); else piece[k] = v; out = deepMerge(out, piece); }
  return out;
}
// Contract C2: an answer is bare (legacy: "unstated") or { value, answeredBy }. unwrapAnswers returns the plain answers and, per answered field
// (dotted path), who answered. A plain object with no wrapped answer inside (a location, a credentials block) is one answer.
const STAMPS = ["owner", "site", "default"]; // plus a delegation object (lib-provenance.mjs): { by, delegatedBy: "owner", at } -> provenance "delegated"
const isWrapped = (v) => !!v && typeof v === "object" && !Array.isArray(v) && Object.hasOwn(v, "answeredBy") && Object.hasOwn(v, "value");
const hasWrapped = (v) => isWrapped(v) || (!!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).some(hasWrapped));
export function unwrapAnswers(raw) {
  const prov = {}, deleg = {};
  const walk = (o, prefix) => {
    const out = {};
    for (const [k, v] of Object.entries(o || {})) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (isWrapped(v)) { out[k] = v.value; const d = delegationOf(v.answeredBy); if (d) { prov[p] = "delegated"; deleg[p] = d; } else prov[p] = STAMPS.includes(v.answeredBy) ? v.answeredBy : "unstated"; }
      else if (hasWrapped(v)) out[k] = walk(v, p);
      else { out[k] = v; prov[p] = "unstated"; }
    }
    return out;
  };
  return { answers: walk(raw, ""), prov, deleg };
}
const getPath = (o, p) => p.split(".").reduce((c, k) => (c && typeof c === "object" ? c[k] : undefined), o);
// who answered <field>: its own entry, else the nearest parent's ("market" for "market.country"), else unstated
const answerDelegOf = (deleg, field) => { for (let p = field; ; p = p.slice(0, p.lastIndexOf("."))) { if (deleg[p]) return deleg[p]; if (!p.includes(".")) return null; } };
const answerProvOf = (prov, field) => { for (let p = field; ; p = p.slice(0, p.lastIndexOf("."))) { if (prov[p]) return prov[p]; if (!p.includes(".")) return "unstated"; } };
const PROV_FIELDS = ["name", "domain", "phone", "kind", "industry", "offer", "audience", "market.country", "market.language", "locations", "goals", "competitors", "brand.constraints", "existing.site", "existing.searchConsole", "existing.businessProfile", "existing.socials", "launchState", "vocabulary", "notOffer", "credentials", "rankTracking.source", "rankTracking.locations", "rankTracking.devices"];
export function provenanceOf(business, answers, answerProv, accepted, defaulted) {
  const out = {}, acc = new Set(accepted.map((x) => x.field)), def = new Set(defaulted.map((x) => x.field));
  for (const f of PROV_FIELDS) {
    const v = getPath(business, f), given = getPath(answers, f) !== undefined;
    if (v === undefined || (v === null && !given)) continue;
    out[f] = given ? answerProvOf(answerProv, f) : acc.has(f) ? "site" : def.has(f) ? "default" : "default";
  }
  return out;
}
// A location whose name lists several places ("California, New York and Florida") is a label, not a place (contract C2, G16).
export const isRegionLabel = (name) => / and |&|;/i.test(String(name)) || (String(name).match(/,/g) || []).length >= 2;
const list = (v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\n]/) : v == null ? null : [v]);
const clean = (v) => list(v)?.map((x) => String(x).trim()).filter(Boolean) ?? null;
const goalWord = (g) => ({ lead: "leads", leads: "leads", "lead generation": "leads", call: "calls", calls: "calls", phone: "calls", booking: "bookings", bookings: "bookings", appointments: "bookings", sale: "sales", sales: "sales", ecommerce: "sales" })[String(g).toLowerCase().trim()] || String(g).toLowerCase().trim();

// Validate + normalise a candidate business; returns { business, missing: [field...], invalid: [{field, why}] }.
export function assemble(c, { industries = null, requireVocabulary = false } = {}) {
  const missing = [], invalid = [];
  const b = {};
  const need = (field, ok, val) => { if (ok) return val; missing.push(field); return undefined; };
  b.name = need("name", c.name && String(c.name).trim(), String(c.name || "").trim());
  b.domain = need("domain", c.domain, domainOf(c.domain || ""));
  b.kind = need("kind", c.kind, slug(c.kind || ""));
  b.industry = c.industry === undefined ? (industries && b.kind && industries.includes(b.kind) ? b.kind : null) : c.industry;
  if (b.industry && industries && !industries.includes(b.industry)) { invalid.push({ field: "industry", why: `no rules/industries/${b.industry}.json (have: ${industries.join(", ") || "none"})` }); b.industry = null; }
  b.offer = need("offer", c.offer, String(c.offer || "").trim());
  b.audience = need("audience", c.audience, String(c.audience || "").trim());
  const country = String(c.market?.country || "").trim().toUpperCase(), language = String(c.market?.language || "").trim().toLowerCase();
  if (country && !/^[A-Z]{2}$/.test(country)) invalid.push({ field: "market.country", why: `"${country}" is not a 2-letter country code` });
  if (language && !/^[a-z]{2}$/.test(language)) invalid.push({ field: "market.language", why: `"${language}" is not a 2-letter language code` });
  if (!/^[A-Z]{2}$/.test(country)) missing.push("market.country");
  if (!/^[a-z]{2}$/.test(language)) missing.push("market.language");
  b.market = { country, language };
  const locIn = Array.isArray(c.locations) ? c.locations : c.locations && typeof c.locations === "object" ? [c.locations] : [];
  const locs = locIn.filter((l) => l && l.name);
  if (!locs.length) missing.push("locations");
  b.locations = locs.map((l) => ({ name: String(l.name), address: l.address ?? null, serviceArea: clean(l.serviceArea) || [] }));
  if (c.phone != null && String(c.phone).trim()) b.phone = String(c.phone).trim();
  if (c.contact && typeof c.contact === "object" && Object.keys(c.contact).length) b.contact = c.contact;
  const goals = (clean(c.goals) || []).map(goalWord);
  const badGoals = goals.filter((g) => !GOALS.includes(g));
  if (badGoals.length) invalid.push({ field: "goals", why: `${badGoals.join(", ")} not in ${GOALS.join("|")}` });
  b.goals = [...new Set(goals.filter((g) => GOALS.includes(g)))];
  if (!b.goals.length) missing.push("goals");
  if (!Array.isArray(c.competitors)) missing.push("competitors"); // [] is a valid answer: "none known"
  b.competitors = [...new Set((clean(c.competitors) || []).map(domainOf))];
  if (c.vocabulary !== undefined) { // owner-only; [] is not an answer (a business has words)
    const v = [...new Set(clean(c.vocabulary) || [])];
    if (!v.length) invalid.push({ field: "vocabulary", why: "[] is not an answer: list the words the business and its readers use for what it does" }); else b.vocabulary = v;
  } else if (requireVocabulary) missing.push("vocabulary");
  if (c.notOffer != null && String(c.notOffer).trim()) b.notOffer = String(c.notOffer).trim();
  if (!Array.isArray(c.brand?.constraints)) missing.push("brand.constraints"); // [] is valid
  b.brand = { constraints: clean(c.brand?.constraints) || [] };
  const ex = c.existing || {};
  if (typeof ex.searchConsole !== "boolean") missing.push("existing.searchConsole");
  if (ex.site === undefined) missing.push("existing.site");
  if (ex.businessProfile === undefined) missing.push("existing.businessProfile");
  b.existing = { site: ex.site ?? null, searchConsole: ex.searchConsole === true, businessProfile: ex.businessProfile ?? null, socials: clean(ex.socials) || [] };
  if (!LAUNCH.includes(c.launchState)) { if (c.launchState != null) invalid.push({ field: "launchState", why: `"${c.launchState}" not in ${LAUNCH.join("|")}` }); missing.push("launchState"); }
  b.launchState = c.launchState;
  const rt = c.rankTracking || {};
  const src = ["search-console", "browser-capture"].includes(rt.source) ? rt.source : b.existing.searchConsole ? "search-console" : "browser-capture";
  if (c.credentials && typeof c.credentials === "object") b.credentials = c.credentials; // optional: licence number, brokerage (feeds rules/industries checks)
  b.rankTracking = { source: src, locations: clean(rt.locations) || [], devices: (clean(rt.devices) || ["mobile"]).filter((d) => ["mobile", "desktop"].includes(d)) };
  if (!b.rankTracking.devices.length) b.rankTracking.devices = ["mobile"];
  return { business: b, missing: [...new Set(missing)], invalid };
}

// ---------- questions, shaped for AskUserQuestion: recommended option first, max 4 options (the tool adds "Other") ----------
const opt = (label, description, value) => ({ label, description, value });
export function questionsFor(missing, invalid, facts, cand, optional = []) {
  const fact = (f) => facts.find((x) => x.field === f);
  const why = (f) => invalid.find((i) => i.field === f)?.why;
  const Q = {
    name: () => ({ header: "Business", question: "What is the business called (the name customers know)?", options: [opt(cand.domain ? `Use "${cand.domain}"` : "Type the name", "pick Other to type the exact name", null)] }),
    domain: () => ({ header: "Website", question: "What is the website domain (no site yet: the domain it will have)?", options: [opt("Not decided yet", "research can still run; plan will need it", null)] }),
    kind: () => { const f = fact("kind"); return { header: "Business type", question: "What kind of business is it?", options: [f && opt(f.value, "found on the site's own markup", f.value), opt("real-estate-agent", "licensed agent or brokerage", "real-estate-agent"), opt("cash-home-buyer", "buys houses directly for cash", "cash-home-buyer"), opt("editorial-media", "publisher or media platform with paid features", "editorial-media"), opt("local-service", "plumber, dentist, lawyer, contractor ...", "local-service")].filter(Boolean).filter((o, i, all) => all.findIndex((x) => x.value === o.value) === i).slice(0, 4) }; }, // at most 4 pickable options (the tool adds Other)
    offer: () => { const f = fact("offer"); return { header: "Offer", question: "What does it sell, in one line?", options: [f && opt("Use the site's own description", String(f.value).slice(0, 110), f.value), opt("I will type it", "pick Other and type one line", null)].filter(Boolean) }; },
    audience: () => ({ header: "Audience", question: "Who is it for?", options: [opt("Households in the service area", "people deciding about their own home or service", "Households in the service area"), opt("Businesses (B2B)", "companies buying a service", "Businesses"), opt("Both", "households and businesses", "Households and businesses")] }),
    "market.country": () => ({ header: "Country", question: "Which country do the searchers live in? (every volume is per country)", options: [opt("US", "United States", "US"), opt("CA", "Canada", "CA"), opt("GB", "United Kingdom", "GB"), opt("AU", "Australia", "AU")] }),
    "market.language": () => ({ header: "Language", question: "Which language do the searchers use?", options: [opt("en", "English", "en"), opt("es", "Spanish", "es"), opt("fr", "French", "fr")] }),
    locations: () => { const n = fact("locations.name"), s = fact("locations.serviceArea"); return { header: "Where", question: "Where does the business work? Name the main place and the cities or areas it serves.", options: [n && opt(`Use ${n.value}${s ? " + " + s.value.length + " service-area cities found on the site" : ""}`, "found on the site", { name: n.value, address: fact("locations.address")?.value ?? null, serviceArea: s?.value || [] }), opt("I will list them", "pick Other: 'Tracy, CA; serves Manteca, Lathrop'", null)].filter(Boolean) }; },
    goals: () => ({ header: "Goals", multiSelect: true, question: "What should the website produce? (pick all that apply)", options: GOALS.map((g) => opt(g, { leads: "form fills and enquiries", calls: "phone calls", bookings: "appointments", sales: "online sales" }[g], g)) }),
    competitors: () => ({ header: "Competitors", question: "Which competitors do you already know (domains)?", options: [opt("None known: research will find them", "the search results show who wins", []), opt("I will type them", "pick Other: 'a.com, b.com'", null)] }),
    "brand.constraints": () => ({ header: "Brand limits", question: "Anything the content must or must not say (legal, tone, words to avoid)?", options: [opt("Nothing special", "no constraints beyond the industry rules", []), opt("Regulated industry", "real estate, finance, health or legal claim rules apply", ["regulated industry: follow rules/industries"]), opt("I will type them", "pick Other", null)] }),
    "existing.searchConsole": () => ({ header: "Search Console", question: "Do we have Google Search Console access for this site?", options: [opt("No", "research uses captured search results instead", false), opt("Yes", "the owner can connect it (OAuth)", true)] }),
    "existing.site": () => ({ header: "Current site", question: "Is there a current website?", options: [opt("No site yet", "a new build", null), opt("Yes, I will type the address", "pick Other", null)] }),
    "existing.businessProfile": () => ({ header: "Google profile", question: "Is there a Google Business Profile (the map listing)?", options: [opt("None / not sure", "recorded as none", null), opt("Yes, I will paste the link", "pick Other", null)] }),
    vocabulary: () => { const top = (fact("vocabulary.candidates")?.value || []).slice(0, 4); return { header: "Your words", multiSelect: true, question: "Which words do you and the people who read you use for what you do? (pick the right ones; type more under Other)", options: top.length ? top.map((w) => opt(w, "a word your own home page repeats", w)) : [opt("I will type them", "pick Other: the words, one per line", null)] }; },
    notOffer: () => ({ header: "Not this", question: "What is the business NOT? (so research does not chase the wrong searches)", options: [opt("Nothing to rule out", "no exclusions", ""), opt("I will type it", "pick Other: one line", null)] }),
    launchState: () => ({ header: "Site state", question: "Is the site live, a preview copy, or only planned?", options: [opt("live", "public and meant to be found", "live"), opt("preview", "a copy kept out of search on purpose", "preview"), opt("planned", "nothing built yet", "planned")] }),
  };
  const asked = [...missing, ...invalid.map((i) => i.field).filter((f) => !missing.includes(f))];
  return [...asked, ...optional.filter((f) => !asked.includes(f))].filter((f) => Q[f]).map((f, i) => ({ id: `q${i + 1}`, field: f, ...Q[f](), ...(why(f) ? { invalid: why(f) } : {}), ...(!asked.includes(f) ? { optional: true } : {}), recommended: 0, freeText: true }));
}

// ---------- the step ----------
export async function run(ctx, { answersFile = null, snapshotDir = null, refresh = false, requireVocabulary = false } = {}) {
  const { loc } = ctx;
  if (!refresh && ctx.business && !answersFile && !fs.existsSync(path.join(loc.pewp, "intake-answers.json"))) return { status: "complete", businessFile: path.join(loc.pewp, "business.json"), reused: true };
  let site = null, label = null;
  if (loc.kind === "url") {
    const dir = snapshotDir || latestComplete(loc.snapshots)?.dir;
    if (dir) { site = readSite(dir); label = `snapshot ${path.basename(dir)}`; }
  } else { site = readSite(loc.target); label = `repo ${path.basename(loc.target)}`; }
  const facts = site ? siteFacts(site, label) : [];
  const get = (f) => facts.find((x) => x.field === f)?.value;
  // An answers file that exists but does not parse (a hand edit), or a --answers file that is missing, used to read as "no answers" and asked
  // every question again with no hint why: say which file and stop.
  const readAnswers = (f, named) => {
    if (!fs.existsSync(f)) { if (named) throw new Usage(`--answers ${f}: file not found`); return {}; }
    const j = J(f, undefined);
    if (j === undefined || j === null || typeof j !== "object" || Array.isArray(j)) throw new Error(`${f} is not a JSON object of {"field": value} answers: fix or delete it, then re-run intake`);
    return j;
  };
  const parts = [readAnswers(path.join(loc.pewp, "intake-answers.json"), false), answersFile ? readAnswers(answersFile, true) : {}].map(unwrapAnswers);
  const answers = normaliseAnswers({ ...parts[0].answers, ...parts[1].answers });
  const answerDeleg = { ...parts[0].deleg, ...parts[1].deleg };
  const answerProv = { ...parts[0].prov, ...parts[1].prov }; // who answered each field (a later file wins, like the values)
  // merge answers (win) over accepted facts
  const accepted = [], defaulted = [];
  const take = (field, value, why) => { accepted.push({ field, value, source: facts.find((x) => x.field === field)?.source || why }); return value; };
  const cand = { ...answers };
  cand.market = { ...answers.market };
  if (!cand.name && get("name")) cand.name = take("name", get("name"));
  if (!cand.domain) cand.domain = loc.kind === "url" ? take("domain", loc.host, `target ${loc.target}`) : null;
  if (!cand.market.language && get("market.language")) cand.market.language = take("market.language", get("market.language"));
  if (!cand.market.country && get("market.country")) cand.market.country = take("market.country", get("market.country"));
  if (!cand.locations && (get("locations.name") || get("locations.serviceArea")) && get("locations.name")) cand.locations = [take("locations", { name: get("locations.name"), address: get("locations.address") ?? null, serviceArea: get("locations.serviceArea") || [] })];
  cand.existing = { ...answers.existing };
  if (cand.existing.site === undefined && loc.kind === "url") cand.existing.site = take("existing.site", loc.target, `target ${loc.target}`);
  if (!cand.existing.socials?.length && get("existing.socials")) cand.existing.socials = take("existing.socials", get("existing.socials"));
  if (cand.existing.businessProfile === undefined && get("existing.businessProfile")) cand.existing.businessProfile = take("existing.businessProfile", get("existing.businessProfile"));
  if (!cand.launchState && loc.kind === "url" && site) {
    const preview = PREVIEW_HOST.test(loc.host) || get("_noindex") === true;
    cand.launchState = take("launchState", preview ? "preview" : "live", `${preview ? "preview host or noindex on the crawled pages" : "public host, indexable"}`);
  }
  // the site's own contact block as a LABELLED default: phone and the address of the first location, only where the owner gave none (the answers win); nothing is invented
  const cf = (f) => facts.find((x) => x.field === f);
  const ownerSrc = (field) => { const p = answerProvOf(answerProv, field); return p === "site" ? SITE_UNCONFIRMED : p === "default" ? "a default, not confirmed by the owner" : "the owner"; };
  const contact = {};
  if (cand.name) contact.name = { value: String(cand.name), source: answers.name !== undefined ? ownerSrc("name") : SITE_UNCONFIRMED, ...(answers.name !== undefined || !cf("name") ? {} : { from: cf("name").source }) };
  if (answers.phone !== undefined) { cand.phone = answers.phone; contact.phone = { value: String(answers.phone), source: ownerSrc("phone") }; }
  if (answers.phone === undefined && get("contact.phone")) {
    const f = cf("contact.phone");
    cand.phone = get("contact.phone");
    contact.phone = { value: cand.phone, source: SITE_UNCONFIRMED, from: f.source, readAt: f.fetchedAt, ...(f.others?.length ? { others: f.others } : {}) };
    defaulted.push({ field: "phone", value: cand.phone, why: `from the site's contact block (${f.source}); answer phone to change it` });
  }
  if (Array.isArray(cand.locations) && cand.locations.length) {
    const l0 = cand.locations[0];
    const ownAddress = answers.locations?.[0]?.address != null;
    if (!l0.address && get("contact.address")) {
      const f = cf("contact.address");
      cand.locations = cand.locations.map((l, i) => (i === 0 ? { ...l, address: get("contact.address") } : l));
      contact.address = { value: get("contact.address"), source: SITE_UNCONFIRMED, from: f.source, readAt: f.fetchedAt };
      defaulted.push({ field: "locations.address", value: get("contact.address"), why: `from the site's contact block (${f.source}); answer the location's address to change it` });
    } else if (l0.address) contact.address = ownAddress ? { value: l0.address, source: ownerSrc("locations") } : { value: l0.address, source: SITE_UNCONFIRMED, from: cf("locations.address")?.source || "the site" };
  }
  if (Object.keys(contact).length) cand.contact = contact;
  // kind: only an answer or the site's own markup type is used, and the markup type is offered as the recommended pick, not assumed
  let industries = null;
  try { industries = fs.readdirSync(path.join(rulesDir(), "industries")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)); } catch {}
  const first = assemble(cand, { industries, requireVocabulary });
  // rank tracking defaults: the first three places, mobile (the cost stop for browser capture is 1 page / 45 s)
  const rt = cand.rankTracking || {};
  if (!rt.locations?.length && first.business.locations.length) {
    const l0 = first.business.locations[0], st = String(l0.address || "").match(/,\s*([A-Z]{2})\b\s*\d{0,5}/)?.[1] || String(l0.name).match(/,\s*([A-Z]{2})$/)?.[1] || null;
    const seen = new Set(), label = isRegionLabel(l0.name);
    // a multi-region name ("California, New York and Florida") is a label, never a place: the served regions are the places (G16)
    const places = (label ? l0.serviceArea : [l0.name, ...l0.serviceArea]).filter(Boolean).map((p) => (st && !/,\s*[A-Z]{2}$/.test(p) ? `${p}, ${st}` : p)).filter((p) => { const k = p.split(",")[0].trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3); // "city, ST" as the contract wants
    if (places.length) {
      cand.rankTracking = { ...rt, locations: places };
      defaulted.push({ field: "rankTracking.locations", value: places, why: label ? `"${l0.name}" lists several places, so the first three served places are used; change by answering rankTracking.locations` : "first three places of the first location; change by answering rankTracking.locations" });
    }
  }
  if (!rt.devices?.length) defaulted.push({ field: "rankTracking.devices", value: ["mobile"], why: "most local searches are on phones" });
  if (!rt.source) defaulted.push({ field: "rankTracking.source", value: first.business.existing.searchConsole ? "search-console" : "browser-capture", why: "Search Console when connected, else captured in the browser" });
  const { business, missing, invalid } = assemble(cand, { industries, requireVocabulary });
  const optional = [...(cand.vocabulary === undefined ? ["vocabulary"] : []), ...(cand.notOffer === undefined ? ["notOffer"] : [])]; // asked with the rest; they do not block (vocabulary blocks with requireVocabulary)
  const questions = questionsFor(missing, invalid, facts, cand, optional);
  business.provenance = provenanceOf(business, answers, answerProv, accepted, defaulted);
  const delegations = Object.fromEntries(Object.entries(business.provenance).filter(([, v]) => v === "delegated").map(([f]) => [f, answerDelegOf(answerDeleg, f)]).filter(([, d]) => d));
  if (Object.keys(delegations).length) business.delegations = delegations; // who answered for the owner, and when (approve.mjs prints it)
  const doc = { generatedAt: iso(), target: loc.target, siteSource: label, facts, accepted, defaulted, missing, invalid, questions, provenance: business.provenance };
  W(path.join(loc.pewp, "intake-facts.json"), doc);
  W(path.join(loc.pewp, "business.draft.json"), business);
  if (!missing.length && !invalid.length) {
    W(path.join(loc.pewp, "business.json"), business);
    markStage(loc, "intake", { "business.json": path.join(loc.pewp, "business.json"), "intake-facts.json": path.join(loc.pewp, "intake-facts.json") });
    return { status: "complete", businessFile: path.join(loc.pewp, "business.json"), accepted, defaulted, provenance: business.provenance, optional: questions.filter((q) => q.optional) };
  }
  return { status: "questions", questions, accepted, defaulted, invalid, factsFile: path.join(loc.pewp, "intake-facts.json") };
}

// owner-only fields (approve.mjs OWNER_ONLY) that nobody with the owner's stamp answered: said on every run so the next step is not a surprise
const OWNER_FIELDS = ["kind", "offer", "audience", "goals", "competitors", "brand.constraints", "vocabulary"];
await runCli(import.meta.url, "node intake.mjs <url | repo path> [--answers FILE] [--snapshot DIR] [--cwd DIR] [--refresh] [--require-vocabulary]", ["refresh", "require-vocabulary"], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const r = await run(ctx, { answersFile: a.get("answers"), snapshotDir: a.get("snapshot"), refresh: a.has("refresh"), requireVocabulary: a.has("require-vocabulary") });
  if (r.status === "complete") {
    console.log(`COMPLETE ${r.businessFile}${r.reused ? " (already there; --refresh rebuilds)" : ""}`); for (const x of r.accepted || []) console.log(`  accepted ${x.field}: ${JSON.stringify(x.value).slice(0, 100)}  [${x.source}]`); for (const x of r.defaulted || []) console.log(`  default  ${x.field}: ${JSON.stringify(x.value)}  (${x.why})`);
    if (r.provenance) {
      const n = (k) => Object.values(r.provenance).filter((v) => v === k).length, no = OWNER_FIELDS.filter((f) => r.provenance[f] !== "owner" && r.provenance[f] !== "delegated");
      console.log(`  provenance: owner ${n("owner")}, delegated ${n("delegated")}, site ${n("site")}, default ${n("default")}, unstated ${n("unstated")}`);
      if (no.length) console.log(`  NOTE no owner answer for: ${no.join(", ")}. approve.mjs business will refuse until the owner answers them and the answers are written as {"value":..., "answeredBy":"owner"} in ${path.join(ctx.pewp, "intake-answers.json")}, then intake runs again.`);
    }
    if (r.optional?.length) { console.log(`OPTIONAL QUESTIONS ${r.optional.length} (not blocking; ask them with the rest)`); console.log(JSON.stringify(r.optional, null, 1)); }
    return;
  }
  for (const x of r.accepted) console.log(`  accepted ${x.field}: ${JSON.stringify(x.value).slice(0, 100)}  [${x.source}]`);
  for (const x of r.defaulted) console.log(`  default  ${x.field}: ${JSON.stringify(x.value)}  (${x.why})`);
  console.log(`QUESTIONS ${r.questions.length}`);
  console.log(JSON.stringify(r.questions, null, 1));
  console.log(`BLOCKED: ${r.questions.filter((q) => !q.optional).length} answers missing${r.questions.some((q) => q.optional) ? ` (and ${r.questions.filter((q) => q.optional).length} optional, asked with them)` : ""}. The main session asks them as pickable options, appends the picks to ${path.join(ctx.pewp, "intake-answers.json")} (field -> value), then re-runs intake.`);
  // the NEEDS-INPUT line comes AFTER the old BLOCKED line (test-approve reads the question list as the JSON between QUESTIONS n and the first BLOCKED); the LAST line is the shared
  // convention (exit 3 = BLOCKED: <what> | unblocks: <what would>), so a runner can quote it; the NEEDS-INPUT line before it tells it the owner must answer
  console.log(`NEEDS-INPUT intake: ${r.questions.filter((q) => !q.optional).length} question(s) for the owner (the list above; ${path.join(ctx.pewp, "intake-facts.json")} holds them as data)`);
  console.log(`BLOCKED: intake needs the owner's answers | unblocks: answer the questions above in ${path.join(ctx.pewp, "intake-answers.json")} and run intake again`);
  process.exit(3);
});
