// Which industry pack a business resolves to, and the research settings a pack carries (work order 41, gap list items 3 and 4).
// A pack is rules/industries/<slug>.json. It is chosen by business.json `industry` (the slug intake sets when kind names a pack), else `kind`; a pack may also list `aliases`
// (other kind words that mean it: "business-funding-broker" for the lender pack). No pack = no setting from a pack: the default applies and the output says so.
// Settings a pack may declare (all optional; a business.json field of the same name overrides the pack):
//   topicFilter    "vocabulary" | "off"   research-bing.mjs's topic filter on related keywords (research-topic.mjs); default off
//   licenceDetect  [{ id, label, pattern, flags? }]   the licence numbers research-competitors.mjs looks for on a competitor's pages (NMLS and California lender licences for a lender,
//                  a DRE number for real estate); a business with no pack gets the real-estate default, as before
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// PEWP_INDUSTRIES_DIR points the tests at a fixture folder of packs; nothing else sets it
export const INDUSTRIES_DIR = process.env.PEWP_INDUSTRIES_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rules", "industries");
// What a competitor's page may state, when no pack says which kind applies: a real-estate licence (what research-competitors.mjs always looked for) AND the lender kinds
// (WO 40: a business-funding competitor states an NMLS id, a California Finance Lenders licence, DFPI). A pack's licenceDetect replaces this list.
export const LICENCE_DEFAULT = [
  { id: "DRE", label: "real-estate licence number (DRE, BRE, CalDRE)", pattern: "\\b(?:DRE|BRE|CalDRE|licen[sc]e)\\s*(?:Lic(?:ense)?\\.?\\s*)?#?\\s*:?\\s*\\d{6,8}\\b", flags: "gi" },
  { id: "NMLS", label: "NMLS id (mortgage and lender licensing)", pattern: "\\bNMLS\\s*(?:Consumer Access\\s*)?(?:ID|I\\.D\\.|#|No\\.?|Number)?\\s*[:#]?\\s*\\d{4,8}\\b", flags: "gi" },
  { id: "CFL", label: "California Finance Lenders licence (CFL, California Financing Law)", pattern: "\\b(?:California Finance Lenders?(?:\\s+(?:Law|Act))?|California Financing Law|CFL)\\b(?:\\s*(?:License|Licence|Lic\\.?))?(?:\\s*(?:#|No\\.?|Number))?\\s*:?\\s*(?:\\d{5,8}\\b)?", flags: "gi" },
  { id: "DFPI", label: "DFPI (California Department of Financial Protection and Innovation)", pattern: "\\b(?:DFPI|Department of Financial Protection (?:and|&) Innovation)\\b(?:\\s*(?:License|Licence|Lic\\.?))?(?:\\s*(?:#|No\\.?|Number))?\\s*:?\\s*(?:\\d{5,8}\\b)?", flags: "gi" },
];

const readPacks = (dir) => {
  let names = []; try { names = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort(); } catch { return []; }
  const out = [];
  for (const f of names) { try { out.push(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8").replace(/^﻿/, ""))); } catch { /* an unreadable pack is not a pack */ } }
  return out.filter((p) => p && typeof p.slug === "string");
};
const slugOf = (x) => String(x || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// -> { slug, pack, via: "industry" | "kind" | "alias of industry" | "alias of kind" } or null
export function resolvePack(business, { dir = INDUSTRIES_DIR } = {}) {
  const packs = readPacks(dir);
  for (const [field, label] of [["industry", "industry"], ["kind", "kind"]]) {
    const s = slugOf(business?.[field]);
    if (!s) continue;
    const bySlug = packs.find((p) => p.slug === s);
    if (bySlug) return { slug: bySlug.slug, pack: bySlug, via: label };
    const byAlias = packs.find((p) => (p.aliases || []).map(slugOf).includes(s));
    if (byAlias) return { slug: byAlias.slug, pack: byAlias, via: `alias of ${label}` };
  }
  return null;
}

// The topic filter setting for a business: business.json wins either way, then the pack, then off. -> { value: "vocabulary" | "off", from }
export function topicSetting(business, { dir } = {}) {
  const own = business?.topicFilter;
  if (own === "vocabulary" || own === "off") return { value: own, from: "business.json" };
  const r = resolvePack(business, { dir });
  if (r && (r.pack.topicFilter === "vocabulary" || r.pack.topicFilter === "off")) return { value: r.pack.topicFilter, from: `industry pack ${r.slug} (${r.via})` };
  return { value: "off", from: "the default (off): neither business.json nor an industry pack sets it" };
}

// The licence patterns for a business: its pack's licenceDetect, else the real-estate default. -> { detect, from }
export function licenceDetectFor(business, { dir } = {}) {
  const r = resolvePack(business, { dir });
  if (r && Array.isArray(r.pack.licenceDetect) && r.pack.licenceDetect.length) return { detect: r.pack.licenceDetect, from: `industry pack ${r.slug} (${r.via})` };
  return { detect: LICENCE_DEFAULT, from: "the default (a real-estate licence number): no industry pack with licenceDetect" };
}

// Every licence the text states: [{ id, label, text }], at most `max` per pattern, in the order of the patterns. A pattern that is not a regex is skipped, never thrown.
export function detectLicences(text, detect = LICENCE_DEFAULT, { max = 3 } = {}) {
  const out = [];
  for (const d of detect) {
    let re; try { re = new RegExp(d.pattern, (d.flags || "gi").includes("g") ? d.flags || "gi" : `${d.flags}g`); } catch { continue; }
    for (const m of [...String(text || "").matchAll(re)].slice(0, max)) out.push({ id: d.id, label: d.label || d.id, text: m[0].replace(/\s+/g, " ").trim() });
  }
  return out;
}
