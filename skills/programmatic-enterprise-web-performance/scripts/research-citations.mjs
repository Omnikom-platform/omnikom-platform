// Local citation sources: the directories and listing sites a local business should be listed on, found in DATA: the domains that fill the
// captured local and "best/top agents" results (several different searches), and the sites that link to the competitors (Common Crawl
// link graph, <pewp>/authority.json). Each carries its evidence and whether the business is listed, when that is known.
// A domain is a directory candidate when it appears in >= 2 different captured searches AND (it is a portal that fills 25%+ of all captured
// results pages, or >= 2 of its result titles read like a list/directory/reviews page). Link-graph-only candidates need a directory-family
// name (yelp, bbb, yellowpages, mapquest, manta, chamberofcommerce, nextdoor, angi, houzz ...). Competitor sites are never candidates.
// Listed? "listed" only when the business's own socials / Business Profile links (business.json) or a captured result on that domain names the
// business; otherwise "unknown: look it up by hand". Never "not listed" without a lookup.
// Usage: node research-citations.mjs <target> [--cwd DIR]    Output: research/citations.json { sources:[{domain, searches, bestPosition, linkedCompetitors, status, evidence}] }
import path from "node:path";
import { J, context, needBusiness, runCli, readStep, writeStep, domainOf, normQuery, tokens } from "./research-lib.mjs";
import { portalDomains } from "./research-cluster.mjs";

const DIR_TITLE = /\b(best|top \d*|list of|directory|reviews?|find an?|agents? in|near me|profiles?|compare)\b/i;
const FAMILY = /(yelp|bbb\.org|yellowpages|mapquest|manta|chamberofcommerce|nextdoor|angi|homeadvisor|thumbtack|houzz|foursquare|superpages|merchantcircle|citysearch|hotfrog|facebook|linkedin|zillow|realtor\.com|trulia|redfin|homes\.com|fastexpert|expertise|upnest|homelight|clever|usnews|opendoor|ratemyagent|google\.com\/maps)/i;

// A captured URL with a broken % escape ("...%E0%A4%A") made decodeURIComponent throw and took the whole step down: read it undecoded.
const safeDecode = (u) => { try { return decodeURIComponent(u); } catch { return String(u); } };
export function deriveCitations({ captures = [], competitorsDomains = [], authority = null, business }) {
  const own = business.domain, comps = new Set(competitorsDomains.map(domainOf));
  const portals = new Set(portalDomains(captures.filter((c) => c.engine === "google")));
  const by = new Map();
  for (const c of captures) for (const o of c.organic || []) {
    if (!o.domain || o.domain === own || comps.has(o.domain)) continue;
    const r = by.get(o.domain) || { domain: o.domain, queries: new Set(), best: 99, titles: [], listTitles: 0, pages: new Set() };
    r.queries.add(normQuery(c.query)); r.best = Math.min(r.best, o.position); if (DIR_TITLE.test(o.title || "")) r.listTitles++; if (r.titles.length < 3 && o.title) r.titles.push(`${c.engine} #${o.position} "${c.query}": ${String(o.title).slice(0, 80)}`); if (o.url) r.pages.add(o.url);
    by.set(o.domain, r);
  }
  const linkers = new Map(); // domain -> competitors whose strongest linking domains include it
  for (const res of authority?.results || []) if (res.role === "competitor") for (const l of res.strongestLinkingDomains || []) linkers.set(l.domain, (linkers.get(l.domain) || 0) + 1);
  const gap = new Map((authority?.linkGap || []).map((g) => [g.domain, g.linksToCompetitors]));
  const ours = [...(business.existing?.socials || []), business.existing?.businessProfile, business.existing?.site].filter(Boolean);
  const listedOn = (d) => ours.find((u) => domainOf(u) === d || domainOf(u).endsWith("." + d));
  const out = [];
  const consider = (domain, r) => {
    const searches = r ? r.queries.size : 0;
    const serpCandidate = r && searches >= 2 && (portals.has(domain) || r.listTitles >= 2);
    const linkCandidate = !serpCandidate && (gap.has(domain) || linkers.has(domain)) && FAMILY.test(domain);
    if (!serpCandidate && !linkCandidate) return;
    const url = listedOn(domain);
    const named = r && [...r.pages].find((u) => tokens(business.name).filter((t) => t.length > 3).every((t) => tokens(safeDecode(u)).includes(t)));
    out.push({ domain, why: serpCandidate ? (portals.has(domain) ? "portal that fills many captured results pages" : "its pages read like a directory or list in several captured searches") : "a directory-family site that links to competitors (link graph)", searches, bestPosition: r ? r.best : null, linkedCompetitors: Math.max(linkers.get(domain) || 0, gap.get(domain) || 0), inLinkGap: gap.has(domain),
      status: url ? "listed" : named ? "listed" : "unknown", statusEvidence: url ? `business.json links ${url}` : named ? `a captured result on ${domain} names the business: ${named}` : "not checked: look the business up on this site by hand", evidence: r ? r.titles : [`link graph: ${linkers.get(domain) || gap.get(domain)} competitor(s)`] });
  };
  for (const [d, r] of by) consider(d, r);
  for (const d of new Set([...linkers.keys(), ...gap.keys()])) if (!by.has(d) && d !== own && !comps.has(d)) consider(d, null);
  return out.sort((a, b) => b.searches + b.linkedCompetitors - (a.searches + a.linkedCompetitors) || a.domain.localeCompare(b.domain));
}

export async function run(ctx) {
  const b = needBusiness(ctx), serp = readStep(ctx, "serp");
  const comps = [...(b.competitors || []), ...(readStep(ctx, "competitors")?.sites || []).map((s) => s.domain)];
  const sources = deriveCitations({ captures: serp?.status === "ok" ? serp.captures : [], competitorsDomains: comps, authority: J(path.join(ctx.pewp, "authority.json")), business: b });
  return writeStep(ctx, "citations", { inputs: { captures: serp?.captures?.length || 0, authority: !!J(path.join(ctx.pewp, "authority.json")) }, sources });
}

await runCli(import.meta.url, "node research-citations.mjs <target> [--cwd DIR]", [], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const r = await run(ctx);
  return `OK citations: ${r.sources.length} directory/listing candidates (${r.sources.filter((s) => s.status === "listed").length} known listed) from ${r.inputs.captures} captures${r.inputs.authority ? " + the link graph" : ""} -> ${path.join(ctx.rdir, "citations.json")}`;
});
