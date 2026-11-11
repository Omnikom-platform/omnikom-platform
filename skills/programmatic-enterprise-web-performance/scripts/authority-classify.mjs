// Usage: node authority-classify.mjs <target> [--cwd DIR] [--industry <pack slug>] [--fetch] [--max-fetch 25]
//          [--gap-ms 4000] [--timeout-s 20] [--max-minutes 10] [--exclude "<regex>"]... [--skip-domain d]... [--cache-days 7]
//          [--origin domain=http://127.0.0.1:PORT/path]...     (--origin: local mirrors and tests only; refuses a non-local address)
// Turns the link data into a ranked list of places to earn links, mentions and citations (stages/authority.md).
// Reads  <pewp>/authority.json (authority.mjs: Common Crawl, domain level; its linkGap), <pewp>/research/citations.json and
//        research/ai-citations.json (optional: directories in the captured searches; sources the AI engines cited instead of the business),
//        <pewp>/business.json (industry, competitors; optional), rules/link-sources/ (taxonomy + the industry pack).
// Writes <pewp>/authority/opportunities.json and opportunities.md.
// Every linking domain of every competitor is classified into the taxonomy by its NAME (ordered rules + the pack). A domain no rule
// matches stays "unclassified": nothing is invented. With --fetch, an unclassified domain's home page is read ONCE (robots.txt first,
// honest user agent, a gap per host, stop at 403/429) and its title / description are run through the text rules; if those do not
// decide either, it stays unclassified. Order: link gap first, then sources the AI engines cited instead of the business, then one competitor, then
// search-result directories, then the pack's usual places; inside a group by kind value x ease (value * (6 - effort)), then number of competitors, then link-graph strength.
// Exit: 0 ok, 2 usage, 3 BLOCKED (no authority.json), 4 time cap reached.
import path from "node:path";
import { J, W, context, runCli, Blocked, iso } from "./research-lib.mjs";
import { POLITE_GAP_MS, MIN_GAP_MS } from "./lib-polite.mjs";
import { loadRules, pickPack, buildOpportunities, aiCitedFor, opportunitiesMd, createClient, analyzeHtml, UA, hostOf, mergedPack, Stop, compileExcludes } from "./authority-lib.mjs";

export function parseOrigins(list) {
  const m = new Map();
  for (const x of list) { const i = String(x).indexOf("="); if (i < 1) throw new Error(`--origin needs domain=url (got ${x})`); m.set(x.slice(0, i).toLowerCase().replace(/^www\./, ""), x.slice(i + 1)); }
  return m;
}
export function refuseMangled(list) {
  const bad = list.filter((a) => /^\^?[A-Za-z]:[\\/]/.test(a) || /[\\/]Program Files[\\/]Git[\\/]/i.test(a));
  if (bad.length) throw new Error(`REFUSED: these paths were rewritten by the shell (Git Bash turns "/x" into a Windows path): ${bad.join(" | ")}. Run from PowerShell or prefix with MSYS_NO_PATHCONV=1. Nothing was fetched.`);
}

export async function run(ctx, o = {}) {
  const authority = J(path.join(ctx.pewp, "authority.json"));
  if (!authority) throw new Blocked(`no ${path.join(ctx.pewp, "authority.json")} | unblocks: run  node scripts/authority.mjs ${path.join(ctx.pewp, "authority.json")} --target <domain> --competitor <domain>...  first (Common Crawl, free, 15 to 30 minutes)`);
  const citations = J(path.join(ctx.rdir, "citations.json"));
  const ai = J(path.join(ctx.rdir, "ai-citations.json"));
  const business = ctx.business || {};
  const rules = loadRules();
  const picked = pickPack(rules, business, o.industry);
  const target = authority.target || business.domain || ctx.domain;
  const targets = J(path.join(ctx.pewp, "targets.json"));
  const aiScoped = ai?.citedInstead ? aiCitedFor(ai, { targets, business, own: authority.target || business.domain, vocab: picked.via === "fallback" ? [] : picked.pack.aliases || [] }) : null;
  const base = { authority, citations: citations?.status === "ok" || citations?.sources ? citations : null, aiCitations: aiScoped ? { citedInstead: aiScoped.citedInstead } : null, business, rules, pickedPack: picked, target };
  let fetched = {}, client = null, fetchLog = [];
  let doc = buildOpportunities({ ...base, fetched });
  let stopped = null;
  if (o.fetch) {
    refuseMangled(o.exclude || []);
    client = createClient({ pewp: ctx.pewp, gapMs: o.gapMs ?? 4000, timeoutMs: (o.timeoutS ?? 20) * 1000, deadline: Date.now() + (o.maxMinutes ?? 10) * 60000, excludes: compileExcludes(o.exclude), skipDomains: o.skipDomain || [], originMap: o.origins || new Map(), maxAgeDays: o.cacheDays ?? 7, maxRequests: 150 });
    const todo = [...doc.open.filter((x) => x.type === "unclassified"), ...doc.unclassified].slice(0, o.maxFetch ?? 25);
    try {
      for (const x of todo) {
        const r = await client.get(`https://${x.domain}/`);
        const info = { fetchedAt: iso(), status: r.status ?? null, skipped: r.skipped || null, error: r.error || null };
        if (r.status >= 200 && r.status < 300 && r.text) { const a = analyzeHtml(r.text, r.finalUrl); Object.assign(info, { title: a.title, description: a.description, h1: a.h1, finalUrl: r.finalUrl }); }
        fetched[x.domain] = info; fetchLog.push({ domain: x.domain, ...info });
      }
    } catch (e) { if (e instanceof Stop) stopped = e.message; else throw e; }
    doc = buildOpportunities({ ...base, fetched });
  }
  const out = {
    generatedAt: iso(), target: doc.targetDomain, business: { name: business.name || null, domain: business.domain || null, industry: business.industry || business.kind || null },
    pack: { slug: doc.pack.slug, title: doc.pack.title, chain: doc.pack.chain, via: picked.via, asked: picked.asked, note: picked.note || null },
    inputs: { authority: { release: authority.release, fetchedAt: authority.fetchedAt, source: authority.source, file: path.join(ctx.pewp, "authority.json") }, citations: !!base.citations, aiCitations: !!base.aiCitations, businessJson: !!ctx.business },
    options: { fetch: !!o.fetch, maxFetch: o.maxFetch ?? 25, userAgent: o.fetch ? UA : null },
    fetch: o.fetch ? { requests: client.stats.requests, cachedHits: client.stats.cached, stoppedHosts: client.stats.stopped, skipped: client.stats.skipped, pages: fetchLog, stoppedRun: stopped } : null,
    aiFilter: aiScoped ? aiScoped.filter : null, summary: doc.summary, opportunities: doc.open, unclassified: doc.unclassified, alreadyHave: doc.alreadyHave, notActionable: doc.notActionable, notes: doc.notes,
    angles: doc.pack.angles, avoid: doc.pack.avoid,
  };
  const dir = path.join(ctx.pewp, "authority");
  W(path.join(dir, "opportunities.json"), out);
  W(path.join(dir, "opportunities.md"), opportunitiesMd(out, rules));
  return { out, dir, stopped };
}

await runCli(import.meta.url, 'node authority-classify.mjs <target> [--cwd DIR] [--industry slug] [--fetch] [--max-fetch 25] [--exclude "<regex>"]...', ["fetch"], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const { out, dir, stopped } = await run(ctx, { industry: a.get("industry"), fetch: a.has("fetch"), maxFetch: a.num("max-fetch", 25, { min: 0, int: true }), gapMs: a.num("gap-ms", POLITE_GAP_MS, { min: MIN_GAP_MS }), timeoutS: a.num("timeout-s", 20, { min: 1 }), maxMinutes: a.num("max-minutes", 10), exclude: a.all("exclude"), skipDomain: a.all("skip-domain"), cacheDays: a.num("cache-days", 7, { min: 0 }), origins: parseOrigins(a.all("origin")) });
  const s = out.summary;
  console.log(`pack ${out.pack.slug} (${out.pack.via}${out.pack.note ? ": " + out.pack.note : ""})`);
  console.log(`OK ${s.open} open opportunities: ${s.gap} link gap, ${s.ai} AI-cited, ${s.competitor} one competitor, ${s.serp} from searches, ${s.baseline} usual places; ${s.alreadyHave} already ours; ${s.notActionable} not actionable; ${s.unclassified} unclassified (${s.providers} competing or unrelated businesses set aside) -> ${path.join(dir, "opportunities.json")}`);
  for (const o of out.opportunities.slice(0, 10)) console.log(`  ${String(o.rank).padStart(2)} ${o.domain.padEnd(30)} ${o.typeLabel} [${o.tier}]`);
  if (stopped) { console.log(`STOPPED: ${stopped} (what was read is kept)`); process.exitCode = 4; }
});
