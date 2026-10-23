// NAP consistency (name, address, phone) across (1) the site's own pages and (2) captured directory listings (citations),
// against business.json as the one canonical record. Exact match after normalisation (TR-218). Feeds measure rule MSR-010.
// Inputs: a site folder (a live-site snapshot `pages/*/{head,body}.html`, or a built folder of .html files),
//         <pewp>/captures/local/citations.json  [{ directory, url, name, address, phone, capturedAt, capturedIn }]  (owner read the listing by hand)
//         business.json: name (legalName), locations[0].address, phone  (phone is a new field: see the stage doc)
//         citation-sources: the directories a business of this market should be listed on (rules/citation-sources.json if present, else a built-in
//         default marked UNVERIFIED).
// A source that is not there is BLOCKED with its unblock step.
// Usage: node local-nap.mjs --business business.json --site <folder> [--citations citations.json] [--sources file.json] [--out nap.json]
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import path from "node:path";
import { readJson, writeJson, canonicalNap, normName, normAddress, normPhone, blocked, ymd } from "./local-lib.mjs";
import { htmlInfo, domainOf, fact } from "./measure-sources.mjs";

export const DEFAULT_CITATION_SOURCES = { _note: "built-in default, UNVERIFIED; replace with the ruleset citation-sources.json (per country and industry)",
  US: ["yelp.com", "bing.com (Bing Places)", "apple.com (Apple Business Connect)", "facebook.com", "bbb.org", "yellowpages.com", "mapquest.com", "nextdoor.com", "foursquare.com"],
  "US:real-estate": ["zillow.com", "realtor.com", "homes.com", "redfin.com", "trulia.com"] };
const dirKey = (d) => domainOf(String(d).replace(/\s*\(.*$/, "")) || String(d).toLowerCase();

const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (/^(node_modules|\.git|\.pewp|\.checks)$/.test(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
export function sitePages(dir) {
  if (fs.existsSync(path.join(dir, "_site.json"))) { // a snapshot
    const site = readJson(path.join(dir, "_site.json")); const rd = (s, f) => { try { return fs.readFileSync(path.join(dir, "pages", s, f), "utf8"); } catch { return ""; } };
    return (site.pages || []).filter((p) => p.slug).map((p) => ({ page: new URL(p.url).pathname, html: rd(p.slug, "head.html") + rd(p.slug, "body.html") }));
  }
  return walk(dir).filter((f) => /\.html?$/i.test(f)).map((f) => ({ page: "/" + path.relative(dir, f).split(path.sep).join("/"), html: fs.readFileSync(f, "utf8") }));
}
const nodeTypes = (n) => [].concat(n["@type"] || []);
const STRONG = /LocalBusiness|RealEstateAgent|Store|ProfessionalService|HomeAndConstructionBusiness|Realtor/i;
// A business node: a LocalBusiness-type with a name, phone or address, or a generic Organization carrying a phone or address
// (a bare Organization name is often a publisher or a partner, so it is not compared).
const isBiz = (n) => (nodeTypes(n).some((t) => STRONG.test(t)) && (n.name || n.telephone || n.address)) || (nodeTypes(n).some((t) => /Organization/i.test(t)) && (n.telephone || n.address));

export function checkSiteNap(pages, canon) {
  const issues = [], seen = { names: new Map(), phones: new Map(), addresses: new Map() }; let withNap = 0;
  const bump = (m, k, page) => { if (!k) return; (m.get(k) || m.set(k, []).get(k)).push(page); };
  for (const p of pages) {
    const info = htmlInfo(p.html); let found = false;
    for (const n of info.jsonld.filter(isBiz)) {
      found = true;
      if (n.name) { bump(seen.names, normName(n.name), p.page); if (normName(n.name) !== canon.norm.name) issues.push({ page: p.page, field: "name", found: n.name, expected: canon.nap.name, where: "JSON-LD" }); }
      if (n.telephone) { bump(seen.phones, normPhone(n.telephone), p.page); if (normPhone(n.telephone) !== canon.norm.phone) issues.push({ page: p.page, field: "phone", found: n.telephone, expected: canon.nap.phone, where: "JSON-LD" }); }
      if (n.address) { const a = normAddress(n.address); bump(seen.addresses, a, p.page); if (a !== canon.norm.address) issues.push({ page: p.page, field: "address", found: typeof n.address === "string" ? n.address : [n.address.streetAddress, n.address.addressLocality, n.address.addressRegion, n.address.postalCode].filter(Boolean).join(", "), expected: canon.nap.address, where: "JSON-LD" }); }
    }
    for (const t of info.tel) { found = true; bump(seen.phones, normPhone(t), p.page); if (normPhone(t) !== canon.norm.phone) issues.push({ page: p.page, field: "phone", found: t, expected: canon.nap.phone, where: "tel: link" }); }
    const other = [...new Set((info.text.match(PHONE_RE) || []).map(normPhone).filter((x) => x && x !== canon.norm.phone))];
    if (other.length) issues.push({ page: p.page, field: "phone", found: other.join(", "), expected: canon.nap.phone, where: "visible text", lowConfidence: true, note: "may be a tracking number or a partner's number; check" });
    if (info.text && normAddress(info.text).includes(canon.norm.address.split(" ").slice(0, 3).join(" ")) && canon.norm.address) found = true;
    if (found) withNap++;
  }
  return { pages: pages.length, pagesWithNap: withNap, distinct: { names: seen.names.size, phones: seen.phones.size, addresses: seen.addresses.size }, issues };
}

export function checkCitations(list, canon) {
  const mismatches = [], ok = [];
  for (const c of list) {
    const diffs = [];
    if (c.name != null && normName(c.name) !== canon.norm.name) diffs.push({ field: "name", found: c.name, expected: canon.nap.name });
    if (c.address != null && normAddress(c.address) !== canon.norm.address) diffs.push({ field: "address", found: c.address, expected: canon.nap.address });
    if (c.phone != null && normPhone(c.phone) !== canon.norm.phone) diffs.push({ field: "phone", found: c.phone, expected: canon.nap.phone });
    if (!c.capturedAt) diffs.push({ field: "capturedAt", found: null, expected: "a date", note: "undated capture is not evidence" });
    if (diffs.length) mismatches.push({ directory: c.directory, url: c.url || null, fields: diffs.map((d) => d.field), diffs, detail: `${c.directory}: ${diffs.map((d) => `${d.field} is "${d.found}", expected "${d.expected}"`).join("; ")}`, capturedAt: c.capturedAt || null });
    else ok.push(c.directory);
  }
  return { mismatches, consistent: ok };
}
export function missingDirectories(listed, { country = "US", industry = null, sources = DEFAULT_CITATION_SOURCES } = {}) {
  const want = [...(sources[country] || []), ...(industry ? sources[`${country}:${industry}`] || [] : [])];
  const have = new Set(listed.map((d) => dirKey(d)));
  return want.filter((w) => !have.has(dirKey(w)));
}

export function runNap({ business, siteDir = null, citations = null, sources = null, now = new Date() }) {
  const canon = canonicalNap(business);
  if (!canon.ok) return { status: "blocked", blocked: { source: "business.json", reason: `business.json lacks ${canon.missing.join(", ")}: there is no canonical name/address/phone to compare against`, unblock: "Add name, locations[0].address and phone (string) to business.json; the owner confirms the exact wording once." }, checkedAt: now.toISOString() };
  const out = { status: "ok", checkedAt: now.toISOString(), canonical: canon.nap, normalised: canon.norm, mismatches: [], missingDirectories: [], parts: {} };
  if (siteDir && fs.existsSync(siteDir)) { out.site = checkSiteNap(sitePages(siteDir), canon); out.parts.site = { status: "ok", source: `site folder ${siteDir}`, pages: out.site.pages }; }
  else out.parts.site = { status: "blocked", blocked: { source: "site", reason: "no site folder or snapshot given", unblock: "Pass --site <snapshot dir or built folder>." } };
  if (citations && citations.length) {
    const cc = checkCitations(citations, canon); out.mismatches = cc.mismatches; out.consistentDirectories = cc.consistent;
    out.parts.citations = { status: "ok", source: "owner-read directory listings (dated captures)", listings: citations.length, latest: citations.map((c) => c.capturedAt).filter(Boolean).sort().at(-1) || null };
    const srcDoc = sources || DEFAULT_CITATION_SOURCES;
    out.missingDirectories = missingDirectories(citations.map((c) => c.directory), { country: (business.market?.country || "US").toUpperCase(), industry: /real.?estate/i.test(business.kind || business.industry || "") ? "real-estate" : null, sources: srcDoc });
    out.citationSourcesNote = srcDoc._note || "ruleset citation-sources.json";
  } else out.parts.citations = { status: "blocked", blocked: { source: "citations", reason: "no directory listing captures", unblock: "Read the business's listing on each directory by hand (owner, human pace) and save [{directory, url, name, address, phone, capturedAt}] to captures/local/citations.json." } };
  return out;
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2); const opt = (k, d = null) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  if (!opt("--business")) { console.error("usage: node local-nap.mjs --business business.json [--site <dir>] [--citations citations.json] [--sources file.json] [--out nap.json]"); process.exit(2); }
  const r = runNap({ business: readJson(opt("--business")), siteDir: opt("--site"), citations: opt("--citations") ? readJson(opt("--citations")) : null, sources: opt("--sources") ? readJson(opt("--sources")) : null });
  if (opt("--out")) writeJson(opt("--out"), r);
  console.log(r.status === "blocked" ? `BLOCKED: ${r.blocked.reason}. To fix: ${r.blocked.unblock}` : JSON.stringify({ siteIssues: r.site?.issues.length ?? "not checked", mismatches: r.mismatches.length, missingDirectories: r.missingDirectories }, null, 1));
}
