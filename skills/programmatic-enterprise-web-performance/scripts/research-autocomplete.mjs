// Autocomplete suggestions, captured by the MAIN SESSION in the owner's browser (a person types the seed slowly into the search box, does not
// press Enter, and saves the list the engine shows). NO script ever fetches an autocomplete endpoint: this only parses the saved files.
// A suggestion is the free demand signal "people type this phrase": each becomes a sourced ESTIMATE (T1 tier, rank 3) for that exact phrase
// and a new query for the cluster step. It is never a search count.
// Usage: node research-autocomplete.mjs <target> [--dir DIR (default <pewp>/captures/autocomplete)] [--max-age-days 30] [--cwd DIR]
// One file per seed and engine: { "seed":"realtor in tracy", "engine":"google|bing", "capturedAt":"ISO", "browser":"owner's Edge",
//   "language":"en", "location":{"requested":"Tracy, CA","footer":"..."}, "suggestions":["realtor in tracy ca", ...] }
// A file without seed, engine, date, language, location or a suggestions list is REJECTED with the reason. No files => BLOCKED (exit 3).
// Output: research/autocomplete.json { rows:[{seed, suggestion, position, engine, ...}], rejected }.
import fs from "node:fs";
import path from "node:path";
import { Blocked, J, ageDays, context, needBusiness, runCli, writeStep, writeBlocked, normQuery, hasPlaceholder } from "./research-lib.mjs";

const UNBLOCK = "the main session captures autocomplete in the owner's browser: type each seed from research/capture-requests.json (autocompleteRequests) slowly into the search box, do not press Enter, save the suggestion list as <pewp>/captures/autocomplete/<id>.<engine>.json (format in stages/research.md); at least 45 s between seeds, stop at the first robot check";

export function tierFromSuggestion(row) {
  return { value: "T1 (autocomplete suggestion)", rank: 3, estimate: true,
    source: `${row.engine} autocomplete captured in the browser (${row.browser || "browser"}) ${row.capturedAt.slice(0, 10)}: "${row.suggestion}" is suggested for the seed "${row.seed}", position ${row.position}; people type this phrase, it is not a search count`,
    fetchedAt: row.capturedAt.length === 10 ? `${row.capturedAt}T00:00:00.000Z` : row.capturedAt, cacheFile: row.file, location: row.locationLabel,
    unit: "ordinal demand tier from autocomplete: T1 = the engine suggests the phrase" };
}

export async function run(ctx, { dir = null, maxAgeDays = 30 } = {}) {
  needBusiness(ctx);
  const d = dir || path.join(ctx.pewp, "captures", "autocomplete");
  const files = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /\.json$/i.test(f)).sort() : [];
  if (!files.length) { writeBlocked(ctx, "autocomplete", UNBLOCK); throw new Blocked(UNBLOCK); }
  const rows = [], rejected = [];
  for (const f of files) {
    const file = path.join(d, f), j = J(file);
    const why = [];
    if (!j) why.push("not valid JSON");
    else {
      if (!j.seed) why.push("no seed");
      if (!["google", "bing"].includes(String(j.engine || "").toLowerCase())) why.push("engine is not google|bing");
      if (!j.capturedAt || Number.isNaN(Date.parse(j.capturedAt))) why.push("no capture date");
      if (!j.language) why.push("no language");
      if (!(j.location && (j.location.footer || j.location.requested))) why.push("no location (write location.footer or location.requested; NOT LOCALIZED is an honest label)");
      if (!Array.isArray(j.suggestions) || !j.suggestions.length) why.push("no suggestions list");
    }
    if (why.length) { rejected.push({ file, reason: why.join("; ") }); continue; }
    const req = j.location.requested ? j.location.requested.split(",")[0].trim().toLowerCase() : null;
    const localized = !!(req && j.location.footer && j.location.footer.toLowerCase().includes(req));
    const locationLabel = localized ? j.location.requested : `NOT LOCALIZED (baseline): ${j.location.footer || "no footer location recorded"}`;
    j.suggestions.forEach((s, i) => { const q = normQuery(s); if (q && !hasPlaceholder(q)) rows.push({ seed: normQuery(j.seed), suggestion: q, position: i + 1, engine: String(j.engine).toLowerCase(), language: j.language, capturedAt: j.capturedAt, browser: j.browser || null, locationLabel, localized, file, ageDays: Math.round(ageDays(j.capturedAt) * 10) / 10, stale: ageDays(j.capturedAt) > maxAgeDays }); });
  }
  return writeStep(ctx, "autocomplete", { dir: d, maxAgeDays, files: files.length, seeds: [...new Set(rows.map((r) => r.seed))], rejected, rows });
}

await runCli(import.meta.url, "node research-autocomplete.mjs <target> [--dir DIR] [--max-age-days 30] [--cwd DIR]", [], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const r = await run(ctx, { dir: a.get("dir"), maxAgeDays: a.num("max-age-days", 30) });
  return `OK autocomplete: ${r.rows.length} suggestions for ${r.seeds.length} seeds, ${r.rejected.length} files rejected${r.rejected.map((x) => `\n  rejected ${path.basename(x.file)}: ${x.reason}`).join("")}\n  -> ${path.join(ctx.rdir, "autocomplete.json")}`;
});
