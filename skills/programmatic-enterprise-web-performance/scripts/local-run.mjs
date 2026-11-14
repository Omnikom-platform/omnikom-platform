// local: run the four local checks for a target and write <pewp>/local/<date>/{profile,pack,nap,reviews,summary}.json + report.md.
// Re-runnable, no model. Inputs under <pewp>/ (all optional; each missing one makes its part BLOCKED with the unblock step):
//   business.json                      canonical name / address / phone
//   captures/local/profile.json        the owner's Business Profile API export or a dated manual capture
//   captures/local/competitors/*.json  competitor listings read by hand
//   captures/local/pack/*.json         local-pack captures per query, city and device
//   captures/local/citations.json      directory listings read by hand
// Usage: node local-run.mjs <url|repo> [--site <snapshot dir or built folder>] [--today YYYY-MM-DD] [--cwd DIR]
import fs from "node:fs";
import { isMain } from "./lib-main.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { locate, markStage } from "./state.mjs";
import { readJson, writeJson, ymd } from "./local-lib.mjs";
import { importProfile, auditProfile, loadCompetitors } from "./local-profile.mjs";
import { importPackCaptures } from "./local-pack.mjs";
import { runNap } from "./local-nap.mjs";
import { reviewGap } from "./local-reviews.mjs";
import { latestComplete } from "./live-target.mjs";
import { runGridImport } from "./local-grid.mjs";
import { isDay } from "./measure-sources.mjs";

export function notReadLine(b) { return "- NOT READ, " + b.id + ": " + String(b.reason).replace(/[.\s]+$/, "") + "." + (b.unblock ? " To fix: " + b.unblock : ""); }
export function runLocal(target, { cwd = process.cwd(), site = null, today = null, log = console.log } = {}) {
  const loc = locate(target, { cwd }); const now = today ? new Date(`${today}T12:00:00Z`) : new Date(); const date = ymd(now);
  const dir = path.join(loc.pewp, "local", date); fs.mkdirSync(dir, { recursive: true });
  const cap = path.join(loc.pewp, "captures", "local"); const business = readJson(path.join(loc.pewp, "business.json"));
  const out = { date, parts: {} };
  // profile
  const pf = path.join(cap, "profile.json");
  if (fs.existsSync(pf)) {
    const p = importProfile(readJson(pf), { file: pf });
    if (p.ok) { const au = auditProfile(p, loadCompetitors(path.join(cap, "competitors")), { now }); out.profile = { status: "ok", profile: p, ...au }; } else out.profile = { status: "blocked", blocked: p.blocked };
  } else out.profile = { status: "blocked", blocked: { source: "business-profile", reason: `no profile file at ${pf}`, unblock: "Give the owner's Business Profile API export (needs the owner's OAuth and Google's API approval) or a dated manual capture of the public listing." } };
  // pack
  const pk = path.join(cap, "pack");
  if (fs.existsSync(pk) && fs.readdirSync(pk).some((f) => f.endsWith(".json"))) { const r = importPackCaptures(pk, { name: business?.name, domain: business?.domain, phone: business?.phone }); out.pack = { status: "ok", ...r }; }
  else out.pack = { status: "blocked", blocked: { source: "local-pack captures", reason: `no captures in ${pk}`, unblock: "The owner searches '<service> <city>' on a phone in each city (or a confirmed-location browser), one page at a time, at least 45 s apart, and saves each result as JSON (see local-pack.mjs header)." } };
  // nap
  const citationsFile = path.join(cap, "citations.json");
  let siteDir = site; if (!siteDir && loc.kind === "url") { const l = latestComplete(loc.snapshots); siteDir = l?.dir || null; }
  out.nap = runNap({ business, siteDir, citations: readJson(citationsFile), sources: readJson(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rules", "citation-sources.json")), now });
  // reviews
  out.reviews = out.profile.status === "ok" && out.pack.status === "ok" ? reviewGap(out.profile.profile, out.pack.rows) : { status: "blocked", blocked: { source: out.profile.status !== "ok" ? "business-profile" : "local-pack captures", reason: "needs both our profile and local-pack captures", unblock: (out.profile.status !== "ok" ? out.profile.blocked : out.pack.blocked)?.unblock } };
  for (const k of ["profile", "pack", "nap", "reviews"]) { writeJson(path.join(dir, `${k}.json`), out[k]); out.parts[k] = out[k].status === "ok" ? "ok" : "BLOCKED"; }
  // the local grid: captures per grid point (local-grid.mjs plan writes the requests, a person captures them, this imports them)
  const gr = runGridImport(target, { cwd, today, log: () => {} });
  out.grid = gr.status === "ok" ? gr : { status: "blocked", blocked: gr.blocked }; out.parts.grid = gr.status === "ok" ? "ok" : "BLOCKED";
  const nr = out.profile.status === "ok" ? out.profile.blocked : []; const L = [`# Local search, ${date}`, "", `**${out.parts.profile === "ok" ? `${out.profile.findings.length} profile findings${nr.length ? `, ${nr.length} profile checks not read` : ""}` : "Business Profile not measured"}; ${out.parts.pack === "ok" ? `in the map pack for ${out.pack.summary.inPack} of ${out.pack.summary.localized} confirmed city/device searches` : "map pack not measured"}; ${out.parts.nap === "ok" ? `${out.nap.mismatches.length} listing mismatches, ${out.nap.missingDirectories.length} directories without a listing` : "name/address/phone not checked"}.**`, ""];
  for (const k of ["profile", "pack", "nap", "reviews"]) if (out[k].status !== "ok") L.push(`- NOT MEASURED, ${k}: ${out[k].blocked.reason}. To fix: ${out[k].blocked.unblock}`);
  if (out.profile.status === "ok") for (const f of out.profile.findings) L.push(`- ${f.id} ${f.title}: ${f.detail} Fix: ${f.fix}`);
  for (const b of nr) L.push(notReadLine(b));
  if (out.nap.status === "ok") { for (const m of out.nap.mismatches) L.push(`- Listing differs: ${m.detail}`); if (out.nap.consistency) L.push(`- Listings consistent with the business record: ${out.nap.consistency.text}`); for (const x of out.nap.notCheckedDirectories || []) L.push(`- NOT CHECKED, ${x.directory} (${x.status}): ${x.reason}`); for (const i of (out.nap.site?.issues || []).filter((x) => !x.lowConfidence).slice(0, 20)) L.push(`- Site ${i.page}: ${i.field} is "${i.found}", the business record says "${i.expected}" (${i.where})`); }
  if (out.reviews.status === "ok") for (const r of out.reviews.rows) L.push(`- ${r.city} (${r.device}): ${r.ourReviews.value} reviews against ${r.packThirdPlaceReviews.value ?? "?"} for 3rd place in the pack.`);
  if (out.grid.status !== "ok") L.push(`- NOT MEASURED, grid: ${out.grid.blocked.reason}. To fix: ${out.grid.blocked.unblock}`);
  else for (const s of out.grid.solv) L.push(`- Grid, "${s.query}" around ${s.city}: in the 3-pack at ${s.pointsIn3Pack} of ${s.localizedPoints} points${s.solv3.value != null ? ` (${Math.round(s.solv3.value * 100)}%)` : ""}. Heat map: ${path.join(out.grid.dir, "grid.html")}`);
  fs.writeFileSync(path.join(dir, "report.md"), L.join("\n") + "\n");
  writeJson(path.join(dir, "summary.json"), { date, parts: out.parts });
  markStage(loc, "local", { "local dir": dir }, { date });
  log(`local ${date}: ${Object.entries(out.parts).map(([k, v]) => `${k}=${v}`).join(" ")}; wrote ${dir}`);
  return { dir, ...out };
}
if (isMain(import.meta.url)) {
  const a = process.argv.slice(2); const opt = (k, d = null) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  if (!a[0] || a[0].startsWith("--")) { console.error("usage: node local-run.mjs <url|repo> [--site <dir>] [--today YYYY-MM-DD] [--cwd DIR]"); process.exit(2); }
  if (opt("--today") && !isDay(opt("--today"))) { console.error(`--today must be a real day as YYYY-MM-DD (got ${opt("--today")})`); process.exit(2); }
  runLocal(a[0], { cwd: opt("--cwd", process.cwd()), site: opt("--site"), today: opt("--today") });
}
