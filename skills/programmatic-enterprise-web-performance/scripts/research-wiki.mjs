// Wikipedia pageviews (free Wikimedia REST API): demand for ENTITIES (a city, a legal term, a product type), not for keywords.
// Also answers "does this entity have a Wikipedia article" (Wikipedia/Wikidata eligibility for the AI-visibility plan).
// Usage: node research-wiki.mjs <target> --title "Tracy, California" [--title ...] [--titles-file FILE.json] [--months 12] [--project en.wikipedia] [--cwd DIR]
// Titles are never guessed (a bare city name is ambiguous: "Tracy, California" vs "Tracy"); the main session supplies exact titles.
// Test hook: WIKI_API_BASE. Output: research/wiki.json { entities:[{title, article:true|false, monthlyViews: sourced number}] }.
// A title with no article is a RESULT (article:false), not a failure. Wikimedia asks for a descriptive User-Agent: sent.
import path from "node:path";
import { Blocked, listFile, UA, context, needBusiness, runCli, writeStep, writeBlocked, cachedFetch, factor, notMeasured, pace } from "./research-lib.mjs";

const BASE = () => (process.env.WIKI_API_BASE || "https://wikimedia.org/api/rest_v1").replace(/\/$/, "");
const ym = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}0100`;

export async function run(ctx, { titles = [], months = 12, project = "en.wikipedia" } = {}) {
  needBusiness(ctx);
  const list = [...new Set(titles.map((t) => String(t).trim()).filter(Boolean))];
  if (!list.length) { const m = "no entity titles: pass --title \"Tracy, California\" (exact Wikipedia article titles) or --titles-file"; writeBlocked(ctx, "wiki", m); throw new Blocked(m); }
  const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)); // first of this month (month not complete: excluded by the API)
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, 1));
  const entities = [];
  for (const title of list) {
    const art = encodeURIComponent(title.replace(/ /g, "_"));
    const url = `${BASE()}/metrics/pageviews/per-article/${project}/all-access/user/${art}/monthly/${ym(start)}/${ym(end)}`;
    await pace(url, 250); // Wikimedia allows far more; we stay polite
    const r = await cachedFetch(ctx.pewp, "wikipedia", url, { maxAgeDays: 30, init: { headers: { "user-agent": UA, accept: "application/json" } } });
    if (r.status === 429) { writeBlocked(ctx, "wiki", "Wikimedia rate limit (HTTP 429): re-run later"); throw new Blocked("Wikimedia rate limit (HTTP 429): re-run later; answered titles are cached"); }
    if (r.status === 404) { entities.push({ title, project, article: false, monthlyViews: notMeasured(`no ${project} article (or no views) titled "${title}"`) }); continue; }
    if (r.status !== 200) throw new Error(`Wikipedia pageviews HTTP ${r.status} for ${title}`);
    const items = r.json().items || [];
    const total = items.reduce((s, x) => s + x.views, 0);
    const f = factor(`Wikimedia pageviews API ${project} user traffic, ${items.length} months`, r.fetchedAt, r.cacheFile, { location: "global (language edition)" });
    entities.push({ title, project, article: true, months: items.length, monthlyViews: f(items.length ? Math.round(total / items.length) : null, { unit: "views per month (average of the months returned)" }), series: items.map((x) => [x.timestamp.slice(0, 6), x.views]) });
  }
  return writeStep(ctx, "wiki", { project, entities });
}

await runCli(import.meta.url, "node research-wiki.mjs <target> --title \"Tracy, California\" [--titles-file FILE] [--months 12] [--project en.wikipedia] [--cwd DIR]", [], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const tf = a.get("titles-file");
  const r = await run(ctx, { titles: [...a.all("title"), ...(tf ? listFile(tf, "titles") : [])], months: a.num("months", 12), project: a.get("project", "en.wikipedia") });
  return `OK wiki: ${r.entities.length} titles, ${r.entities.filter((e) => e.article).length} with an article -> ${path.join(ctx.rdir, "wiki.json")}`;
});
