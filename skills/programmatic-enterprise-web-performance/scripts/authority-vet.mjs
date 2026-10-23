// Usage: node authority-vet.mjs <target> [--domain d]... [--limit 25] [--cwd DIR] [--industry slug] [--refresh] [--max-age-days 30]
//          [--gap-ms 4000] [--timeout-s 20] [--max-minutes 20] [--max-requests 150] [--exclude "<regex>"]... [--skip-domain d]...
//          [--cache-days 7] [--origin domain=http://127.0.0.1:PORT/path]...   (--origin: local mirrors and tests only)
// A polite, read-only visit to each opportunity (the --domain list, else the top --limit open ones of authority/opportunities.json) to
// answer, before anyone spends time or money: what is the site, can Google index it, are its outbound links followed or nofollow,
// does getting listed look free, paid or editorial, where is the listing / submit page, are there spam signals, and the verdict
// PURSUE / CHECK BY HAND / AVOID with the reasons.
// The rules of a polite visit (the same as snapshot-site.mjs where they apply): GET only, never a form, a login, a register or a
// checkout path; robots.txt first and obeyed; honest user agent (PEWP-Authority/1.0); --gap-ms between requests to one site;
// a 403 or 429 stops that site (no retry, no disguise); --exclude (path regexes) and --skip-domain cover every request, robots.txt
// and the redirect hops included; every 2xx answer is cached (cache.mjs); each request has a time limit (--timeout-s) and the run has
// a deadline (--max-minutes, exit 4) and a request budget (--max-requests). A site visited within --max-age-days is reused, not visited.
// Writes <pewp>/authority/vetting.json and howto.md (plain words for the client). Exit: 0 ok, 2 usage, 3 BLOCKED, 4 time/request cap.
import path from "node:path";
import { J, W, context, runCli, Blocked, iso } from "./research-lib.mjs";
import { loadRules, pickPack, mergedPack, classifyDomain, createClient, vetDomain, howtoMd, UA, hostOf, Stop, compileExcludes } from "./authority-lib.mjs";
import { POLITE_GAP_MS, MIN_GAP_MS } from "./lib-polite.mjs";
import { parseOrigins, refuseMangled } from "./authority-classify.mjs";

export async function run(ctx, o = {}) {
  const oppFile = path.join(ctx.pewp, "authority", "opportunities.json");
  const opps = J(oppFile);
  const explicit = (o.domains || []).map(hostOf);
  if (!opps && !explicit.length) throw new Blocked(`no ${oppFile}: run  node scripts/authority-classify.mjs <target>  first, or name the sites with --domain`);
  refuseMangled(o.exclude || []);
  const excludes = compileExcludes(o.exclude);
  const rules = loadRules();
  const business = ctx.business || {};
  const picked = pickPack(rules, business, o.industry);
  const pack = mergedPack(rules, picked.pack);
  const target = opps?.target || business.domain || ctx.domain;
  const cctx = { rules, pack, target, competitors: business.competitors || [] };
  const byDomain = new Map((opps?.opportunities || []).map((x) => [x.domain, x]));
  const todo = (explicit.length ? explicit : (opps.opportunities || []).slice(0, o.limit ?? 25).map((x) => x.domain));
  const prevFile = path.join(ctx.pewp, "authority", "vetting.json");
  const prev = J(prevFile);
  const prevBy = new Map((prev?.results || []).map((r) => [r.domain, r]));
  const maxAge = (o.maxAgeDays ?? 30) * 86400000;
  const client = createClient({ pewp: ctx.pewp, gapMs: o.gapMs ?? 4000, timeoutMs: (o.timeoutS ?? 20) * 1000, deadline: Date.now() + (o.maxMinutes ?? 20) * 60000, excludes, skipDomains: o.skipDomain || [], originMap: o.origins || new Map(), maxAgeDays: o.cacheDays ?? 7, maxRequests: o.maxRequests ?? 150 });
  const results = new Map(); // only the sites of this run: a site that left the list does not stay in vetting.json or howto.md
  let stopped = null;
  const reused = [];
  for (const d of todo) {
    const old = prevBy.get(d);
    // A site vetted recently is reused. --refresh re-reads everything except a site that refused us (403/429): that stop is kept until it is old.
    const refused = (old?.reasons || []).some((r) => r.code === "HOST_REFUSED");
    if (old?.verdict && (!o.refresh || refused) && Date.now() - Date.parse(old.visitedAt) < maxAge) { results.set(d, old); reused.push(d); continue; }
    if (stopped) { results.set(d, { domain: d, verdict: null, notVisited: stopped, visitedAt: null, pages: [], reasons: [] }); continue; }
    const opp = byDomain.get(d);
    const typeId = opp?.type || classifyDomain(d, cctx).type;
    try {
      const rec = await vetDomain(d, { client, typeDef: rules.tax.types[typeId], pack, checkProvider: typeId === "unclassified" });
      rec.type = typeId;
      results.set(d, rec);
    } catch (e) {
      if (e instanceof Stop) { stopped = e.message; results.set(d, { domain: d, type: typeId, verdict: null, notVisited: `stopped before this site: ${stopped}`, visitedAt: null, pages: [], reasons: [] }); }
      else throw e;
    }
  }
  const list = [...results.values()];
  const count = (v) => list.filter((r) => r.verdict === v).length;
  const doc = {
    generatedAt: iso(), target, ua: UA,
    options: { gapMs: o.gapMs ?? 4000, timeoutS: o.timeoutS ?? 20, maxMinutes: o.maxMinutes ?? 20, maxRequests: o.maxRequests ?? 150, exclude: o.exclude || [], skipDomain: o.skipDomain || [], limit: explicit.length ? null : o.limit ?? 25, maxAgeDays: o.maxAgeDays ?? 30, getOnly: true },
    summary: { PURSUE: count("PURSUE"), "CHECK BY HAND": count("CHECK BY HAND"), AVOID: count("AVOID"), "NOT AN OPPORTUNITY": count("NOT AN OPPORTUNITY"), notVisited: list.filter((r) => !r.verdict).length, reusedWithoutVisit: reused },
    requests: { network: client.stats.requests, cacheHits: client.stats.cached, stoppedHosts: client.stats.stopped, skipped: client.stats.skipped },
    stoppedRun: stopped, results: list,
  };
  const dir = path.join(ctx.pewp, "authority");
  W(path.join(dir, "vetting.json"), doc);
  W(path.join(dir, "howto.md"), howtoMd({ business, vetting: doc, opportunities: opps ? [...opps.opportunities, ...(opps.alreadyHave || []), ...(opps.notActionable || [])] : list.map((r) => ({ domain: r.domain, type: r.type, typeLabel: rules.tax.types[r.type]?.label, evidence: [] })), rules }));
  return { doc, dir, stopped };
}

await runCli(import.meta.url, 'node authority-vet.mjs <target> [--domain d]... [--limit 25] [--exclude "<regex>"]... [--skip-domain d]... [--refresh]', ["refresh"], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const { doc, dir, stopped } = await run(ctx, { domains: a.all("domain"), limit: a.num("limit", 25, { min: 1, int: true }), industry: a.get("industry"), refresh: a.has("refresh"), maxAgeDays: a.num("max-age-days", 30, { min: 0 }), gapMs: a.num("gap-ms", POLITE_GAP_MS, { min: MIN_GAP_MS }), timeoutS: a.num("timeout-s", 20, { min: 1 }), maxMinutes: a.num("max-minutes", 20), maxRequests: a.num("max-requests", 150, { min: 1, int: true }), exclude: a.all("exclude"), skipDomain: a.all("skip-domain"), cacheDays: a.num("cache-days", 7), origins: parseOrigins(a.all("origin")) });
  for (const r of doc.results) console.log(`${(r.verdict || "NOT VISITED").padEnd(13)} ${r.domain.padEnd(32)} ${(r.reasons[0]?.text || r.notVisited || "").slice(0, 90)}`);
  console.log(`OK vetted: ${doc.summary.PURSUE} pursue, ${doc.summary["CHECK BY HAND"]} check by hand, ${doc.summary.AVOID} avoid, ${doc.summary["NOT AN OPPORTUNITY"]} not an opportunity, ${doc.summary.notVisited} not visited; ${doc.requests.network} network requests, ${doc.requests.cacheHits} from cache; reused without a visit: ${doc.summary.reusedWithoutVisit.length} -> ${path.join(dir, "vetting.json")}, howto.md`);
  if (stopped) { console.log(`STOPPED: ${stopped} (what was read is kept; run again to continue, finished sites are reused)`); process.exitCode = 4; }
});
