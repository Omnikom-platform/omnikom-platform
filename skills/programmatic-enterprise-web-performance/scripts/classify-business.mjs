// classify: one screen that says what the business IS before anything is researched or planned (overhaul step 3; research mode too).
// Reads <pewp>/business.json (written by intake.mjs) and writes <pewp>/business-definition.md for the owner to read and approve:
//   the kind of business, which industry pack applies (rules/industries/<slug>.json: its page types and rules) or that none does,
//   what it is and what it is not, who pays, who reads, the markets it serves, the words it uses (vocabulary), and who answered each field.
// Deterministic, no network, no model. It never fills a field: a missing owner field is listed as MISSING with the question to ask.
// Usage: node classify-business.mjs <url|repo> [--cwd DIR] [--pewp DIR]
// Exit 0 written; 2 usage; 3 business.json missing (run intake first) or an owner-only field missing / not answered by the owner.
import fs from "node:fs";
import path from "node:path";
import { isMain } from "./lib-main.mjs";
import { locate } from "./state.mjs";
import { rulesDir } from "./lib-rules.mjs";

export const OWNER_FIELDS = ["kind", "offer", "audience", "goals", "competitors", "brand.constraints", "vocabulary"];
const get = (o, dotted) => dotted.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
const list = (v) => (Array.isArray(v) ? (v.length ? v.map((x) => (typeof x === "string" ? x : x?.domain || x?.name || JSON.stringify(x))).join(", ") : "(none)") : v == null ? "" : String(v));

export function industryPack(slug) {
  if (!slug) return null;
  const f = path.join(rulesDir(), "industries", `${slug}.json`);
  try { const p = JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")); return { slug, file: f, pageTypes: (p.pageTypes || []).map((t) => t.id || t.kind || t.name).filter(Boolean), rules: (p.gate || p.items || p.rules || []).length, seeds: (p.seeds?.queries || []).length }; } catch { return null; }
}

export function classify(b) {
  const prov = b.provenance || {};
  const missing = OWNER_FIELDS.filter((f) => { const v = get(b, f); return v == null || (Array.isArray(v) && f !== "competitors" && f !== "brand.constraints" && !v.length) || (typeof v === "string" && !v.trim()); });
  const notOwner = OWNER_FIELDS.filter((f) => !missing.includes(f) && prov[f] !== "owner");
  const pack = industryPack(b.industry);
  const places = (b.locations || []).flatMap((l) => [...(l.serviceArea || []), ...(/\band\b|&|;|,.*,/.test(String(l.name || "")) ? [] : [l.name])]).filter(Boolean);
  const lines = [`# What ${b.name || b.domain || "this business"} is (the definition the owner approves)`, "",
    `- Kind of business: ${b.kind || "MISSING"}${b.industry ? ` (industry pack: ${b.industry})` : " (no industry pack: generic rules only)"}`,
    pack ? `- Industry pack ${pack.slug}: ${pack.pageTypes.length ? `page types ${pack.pageTypes.join(", ")}` : "no page types"}; ${pack.rules} rules; ${pack.seeds} seed searches` : `- Industry pack: none applies${b.kind ? ` (no rules/industries/${b.kind}.json)` : ""}; the plan uses the built-in page kinds`,
    `- What it is (the offer): ${b.offer || "MISSING"}`,
    `- What it is not: ${b.notOffer || "(not stated)"}`,
    `- Who pays: ${b.payer || b.audience || "MISSING"}`,
    `- Who reads: ${b.reader || b.audience || "MISSING"}`,
    `- Goals: ${list(b.goals) || "MISSING"}`,
    `- Markets: ${b.market?.country || "?"} / ${b.market?.language || "?"}; places: ${places.length ? places.join(", ") : "(none)"}${(b.locations || []).some((l) => /\band\b|&|;|,.*,/.test(String(l.name || ""))) ? " (a multi-region business: each state or metro is its own place)" : ""}`,
    `- Vocabulary (the words it and its readers use): ${list(b.vocabulary) || "MISSING"}`,
    `- Competitors named by the owner: ${list(b.competitors)}`,
    `- What the content must not say: ${list(get(b, "brand.constraints"))}`,
    `- Site state: ${b.launchState || "?"}`, "",
    "## Who answered", ...OWNER_FIELDS.map((f) => `- ${f}: ${missing.includes(f) ? "MISSING" : prov[f] || "unstated"}`), ""];
  if (missing.length || notOwner.length) lines.push("## Not ready for approval", ...missing.map((f) => `- ${f} is missing: ask the owner (intake question for ${f}), write the answer as {\"value\": ..., \"answeredBy\": \"owner\"} in intake-answers.json, run intake again`), ...notOwner.map((f) => `- ${f} was answered by ${prov[f] || "nobody on record"}, not the owner: the owner confirms it (same file, answeredBy owner), then intake again`), "");
  else lines.push("Ready: the owner reads this screen and approves it (approve.mjs <target> business --by NAME).", "");
  return { text: lines.join("\n"), missing, notOwner, pack: pack ? pack.slug : null, ready: !missing.length && !notOwner.length };
}

if (isMain(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
  if (!a[0] || a[0].startsWith("--") || a.includes("--help")) { console.log("usage: node classify-business.mjs <url|repo> [--cwd DIR] [--pewp DIR]"); process.exit(a.includes("--help") ? 0 : 2); }
  const pewp = opt("--pewp") ? path.resolve(opt("--pewp")) : locate(a[0], { cwd: opt("--cwd") || process.cwd() }).pewp;
  let b; try { b = JSON.parse(fs.readFileSync(path.join(pewp, "business.json"), "utf8").replace(/^﻿/, "")); } catch { console.log(`BLOCKED: no business.json in ${pewp}. Unblocks: run intake.mjs first.`); process.exit(3); }
  const r = classify(b);
  fs.writeFileSync(path.join(pewp, "business-definition.md"), r.text);
  console.log(r.text.split("\n").slice(0, 16).join("\n"));
  console.log(`wrote ${path.join(pewp, "business-definition.md")}; kind=${b.kind || "MISSING"} pack=${r.pack || "none"}`);
  if (!r.ready) { console.log(`NEEDS-INPUT classify: ${[...r.missing.map((f) => `${f} missing`), ...r.notOwner.map((f) => `${f} not answered by the owner`)].join("; ")}. See business-definition.md "Not ready for approval".`); process.exit(3); }
  console.log("READY for the owner's approval");
}
