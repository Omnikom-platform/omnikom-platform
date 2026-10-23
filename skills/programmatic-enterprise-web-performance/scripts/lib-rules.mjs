// Loads the rulesets in rules/ (copied from shipgate or built here; see rules/README.md). Cached per process.
// PEWP_RULES_DIR overrides the folder (tests use it to plant a broken or minimal ruleset).
// A per-locale ruleset is an object keyed by BCP 47 tag; keys that start with "_" are metadata. localeEntry() looks up the full tag, then
// the primary subtag, and returns null when the locale has no entry: the caller must say so (shipgate 04 section 15 "Page locale": no silent en fallback).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_RULES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rules");
export class RuleMissing extends Error { constructor(msg) { super(msg); this.name = "RuleMissing"; } }
const cache = new Map();
const noBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s); // a UTF-8 BOM (PowerShell 5.1, Notepad) is not a JSON error
export const rulesDir = () => process.env.PEWP_RULES_DIR || SKILL_RULES;
export function loadRule(name) {
  const f = path.join(rulesDir(), name);
  if (cache.has(f)) return cache.get(f);
  let doc;
  try { doc = JSON.parse(noBom(fs.readFileSync(f, "utf8"))); } catch (e) { throw new RuleMissing(`ruleset rules/${name} is not readable (${e.code || e.message}); it ships with the skill (see rules/README.md)`); }
  cache.set(f, doc);
  return doc;
}
export const clearRuleCache = () => cache.clear();
export function localeEntry(doc, locale) {
  const tag = String(locale || ""), prim = tag.split(/[-_]/)[0];
  const keys = Object.keys(doc).filter((k) => !k.startsWith("_"));
  const hit = keys.find((k) => k.toLowerCase() === tag.toLowerCase()) || keys.find((k) => k.toLowerCase() === prim.toLowerCase());
  return hit ? { key: hit, value: doc[hit] } : null;
}
export const localeOf = (market) => `${String(market?.language || "en").toLowerCase()}${market?.country ? "-" + String(market.country).toUpperCase() : ""}`;
