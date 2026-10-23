// Shared helpers for the local-search scripts (local-profile, local-pack, local-nap, local-reviews, local-run).
// Local search is its own channel (UPGRADE-PROMPT "Added in review" 2): Business Profile, local-pack rank per city and
// device, citation consistency, review gap. Free sources only: the owner's Business Profile API export (OAuth, needs
// Google approval) or a DATED MANUAL CAPTURE; local-pack results from owner-supervised browser captures at human pace.
// A missing source is BLOCKED with its unblock step, never filled in.
import fs from "node:fs";
import path from "node:path";
import { nfkc, words, readJson, writeJson, blocked, domainOf, loadCaptures } from "./measure-sources.mjs";

export { nfkc, words, readJson, writeJson, blocked, domainOf, loadCaptures };
export const ymd = (d = new Date()) => new Date(d).toISOString().slice(0, 10);

// ---------- normalisation (exact match after normalisation; E.164 libphonenumber is not available here: US/NANP rule) ----------
export function normPhone(p) {
  let d = String(p ?? "").replace(/(ext|x)\.?\s*\d+$/i, "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length >= 7 ? d : "";
}
const ABBR = { street: "st", avenue: "ave", boulevard: "blvd", road: "rd", drive: "dr", lane: "ln", court: "ct", place: "pl", highway: "hwy", parkway: "pkwy", suite: "ste", apartment: "apt", unit: "unit", north: "n", south: "s", east: "e", west: "w", northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw", california: "ca" };
export function normAddress(s) {
  if (s && typeof s === "object") s = [s.streetAddress || (s.addressLines || []).join(" "), s.addressLocality || s.locality, s.addressRegion || s.administrativeArea, s.postalCode].filter(Boolean).join(" ");
  return nfkc(s).replace(/#/g, " ste ").replace(/[.,]/g, " ").split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => ABBR[w] || w).join(" ").replace(/\b(\d{5})\s?\d{4}\b/, "$1").trim();
}
export const normName = (s) => nfkc(s).replace(/&/g, " and ").split(/[^\p{L}\p{N}]+/u).filter((w) => w && !["llc", "inc", "corp", "co", "ltd", "the"].includes(w)).join(" ");

// business.json is the canonical NAP. Needs name, an address and a phone (the schema should carry `phone`; see the stage doc).
export function canonicalNap(b) {
  if (!b) return { ok: false, missing: ["business.json"] };
  const loc = (b.locations || []).find((l) => l.address) || {};
  const nap = { name: b.legalName || b.name, displayName: b.name, address: loc.address || b.address || null, phone: b.phone || loc.phone || null };
  const missing = ["name", "address", "phone"].filter((k) => !nap[k]);
  return { ok: !missing.length, missing, nap, norm: { name: normName(nap.name), address: normAddress(nap.address), phone: normPhone(nap.phone) } };
}

