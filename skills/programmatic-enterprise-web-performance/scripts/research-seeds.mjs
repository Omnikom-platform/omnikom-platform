// Seed queries for the research stage: the starting list that every demand source expands.
// Usage: node research-seeds.mjs <target> --service "realtor" [--service "we buy houses"]... [--pattern "{service} in {city} {st}"]...
//        [--query "raw query"]... [--file seeds.json|.txt] [--no-places] [--cwd DIR]
// service x place x pattern is the method this project used by hand on 2026-10-17 (11 cities x intents); the services and patterns come
// from the owner's answers (the main session passes them), the places from business.json. Default patterns: "{service} in {city}",
// "best {service} in {city}"; one bare "{service}" query per service. Nothing here is a volume or a ranking.
// --industry SLUG adds the seed queries of rules/industries/<slug>.json (seeds.queries: product line, intent, local or national; recalled, no volume).
// Output: research/seeds.json { queries:[{query, source, location}] }. No service and no query => BLOCKED (exit 3).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Blocked, Usage, stripBom, context, needBusiness, runCli, writeStep, writeBlocked, knownPlaces, normQuery, expandTemplate } from "./research-lib.mjs";

const RULES_INDUSTRIES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rules", "industries");
// The seed queries an industry pack ships (rules/industries/<slug>.json seeds.queries): recalled demand, no volume. A {city} template expands per service-area city.
export function packSeeds(slug, dir = RULES_INDUSTRIES) {
  if (!/^[a-z0-9-]+$/.test(String(slug))) throw new Usage(`--industry ${slug}: not a pack slug`);
  const f = path.join(dir, `${slug}.json`);
  let pack; try { pack = JSON.parse(stripBom(fs.readFileSync(f, "utf8"))); } catch (e) { throw new Usage(`--industry ${slug}: ${e.code === "ENOENT" ? "no rules/industries/" + slug + ".json" : e.message}`); }
  const qs = pack.seeds?.queries;
  if (!Array.isArray(qs) || !qs.length) throw new Usage(`--industry ${slug}: the pack has no seeds.queries`);
  return qs.map((x) => ({ query: x.query, source: `industry pack ${slug}: ${x.productLine || "general"} / ${x.intent || "?"} / ${x.scope || "?"} (recalled demand, no volume)` }));
}

export async function run(ctx, { services = [], patterns = [], raw = [], file = null, noPlaces = false, industry = null } = {}) {
  const b = needBusiness(ctx);
  const pats = patterns.length ? patterns : ["{service} in {city}", "best {service} in {city}"];
  const out = new Map();
  const places = knownPlaces(b), dropped = [];
  const add = (query, source, location = null) => { // a {city} template is expanded per service-area city; anything else unfilled is dropped and listed
    const raw = String(query ?? ""), texts = expandTemplate(raw, places.map((p) => p.city));
    if (!texts.length) { if (raw.trim()) dropped.push({ text: raw, source, why: "an unfilled placeholder and no service-area city to fill it" }); return; }
    texts.forEach((t, i) => { const q = normQuery(t); if (q && !out.has(q)) out.set(q, { query: q, source, location: /\{city\}/i.test(raw) ? places[i].label : location }); });
  };
  for (const s of services.map((x) => x.trim()).filter(Boolean)) {
    add(s, "template: bare service (owner-approved service list)");
    if (!noPlaces) for (const p of places) for (const pat of pats) add(pat.replaceAll("{service}", s).replaceAll("{city}", p.city).replaceAll("{st}", p.state || "").replace(/\s+/g, " "), `template: service x place x pattern "${pat}" (owner-approved lists)`, p.label);
  }
  for (const q of raw) add(q, "given by the main session");
  if (industry) for (const x of packSeeds(industry)) add(x.query, x.source);
  if (file) {
    let txt; try { txt = stripBom(fs.readFileSync(file, "utf8")); } catch (e) { throw new Usage(`--file ${file}: ${e.code === "ENOENT" ? "file not found" : e.message}`); }
    let j = null; if (/\.json$/i.test(file)) { try { j = JSON.parse(txt); } catch (e) { throw new Usage(`--file ${file}: not valid JSON (${e.message})`); } }
    for (const x of j ? (j.queries || j) : txt.split(/\r?\n/)) add(typeof x === "string" ? x : x.query, `file ${path.basename(file)}`, x?.location || null);
  }
  if (!out.size) { const m = "no seeds: pass --service \"<what customers search for>\" (with the places from business.json), --query, or --file; the owner approves the list in the main session"; writeBlocked(ctx, "seeds", m); throw new Blocked(m); }
  return writeStep(ctx, "seeds", { placesUsed: noPlaces ? [] : places.map((p) => p.label), patterns: pats, droppedTemplates: dropped, queries: [...out.values()] });
}

await runCli(import.meta.url, "node research-seeds.mjs <target> --service S [--pattern P]... [--query Q]... [--file F] [--industry SLUG] [--no-places] [--cwd DIR]", ["no-places"], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const r = await run(ctx, { services: a.all("service"), patterns: a.all("pattern"), raw: a.all("query"), file: a.get("file"), noPlaces: a.has("no-places"), industry: a.get("industry") });
  return `OK seeds: ${r.queries.length} queries (${r.placesUsed.length} places) -> ${path.join(ctx.rdir, "seeds.json")}`;
});
