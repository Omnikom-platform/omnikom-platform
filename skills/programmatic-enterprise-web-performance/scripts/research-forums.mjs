// Reddit / forum questions (public JSON endpoints, at their rate limits): the real questions people ask around a topic.
// Usage: node research-forums.mjs <target> --query "sell house fast" [--query ...] [--queries-file FILE.json] [--subreddit ElkGrove]...
//        [--limit 25] [--period year] [--max-calls 12] [--cwd DIR]
// Pace: one request per 7 s (Reddit allows about 10 a minute without a login). The FIRST 429 or 403 stops the run: no retry loop,
// no disguise (project rule 3). $REDDIT_TOKEN (an app token the owner creates) switches to oauth.reddit.com for a higher limit.
// Test hook: REDDIT_BASE. Output: research/forums.json { questions:[{question, query, subreddit, score, comments, created, url}] }.
// A question is a title that ends in "?" or starts with a question word; the permalink is the "seen at" source of every row.
import path from "node:path";
import { Blocked, listFile, UA, context, needBusiness, runCli, writeStep, writeBlocked, cachedFetch, factor, pace, normQuery } from "./research-lib.mjs";

const BASE = () => (process.env.REDDIT_BASE || (process.env.REDDIT_TOKEN ? "https://oauth.reddit.com" : "https://www.reddit.com")).replace(/\/$/, "");
const UNBLOCK = "Reddit refused unauthenticated JSON (HTTP 403/429). The owner creates a Reddit app token and we set REDDIT_TOKEN, or the main session reads the threads in the browser at human pace and saves the questions into research/forums.json by hand";
export const isQuestion = (t) => /\?\s*$/.test(t) || /^(how|what|why|when|where|which|who|can|could|should|do|does|is|are|will|would|am i|anyone)\b/i.test(t.trim());

export async function run(ctx, { queries = [], subreddits = [], limit = 25, period = "year", maxCalls = 12 } = {}) {
  needBusiness(ctx);
  const qs = [...new Set(queries.map(normQuery).filter(Boolean))];
  if (!qs.length) { const m = "no forum queries: pass --query \"...\" or --queries-file"; writeBlocked(ctx, "forums", m); throw new Blocked(m); }
  const jobs = qs.flatMap((q) => (subreddits.length ? subreddits.map((s) => ({ q, s })) : [{ q, s: null }]));
  const out = new Map(); let calls = 0, stoppedBy = null;
  for (const { q, s } of jobs) {
    if (calls >= maxCalls) { stoppedBy = `call budget ${maxCalls}`; break; }
    calls++;
    const url = `${BASE()}${s ? `/r/${encodeURIComponent(s)}` : ""}/search.json?${new URLSearchParams({ q, limit: String(limit), sort: "relevance", t: period, ...(s ? { restrict_sr: "1" } : {}), raw_json: "1" })}`;
    await pace(url, 7000);
    const headers = { "user-agent": UA, accept: "application/json", ...(process.env.REDDIT_TOKEN ? { authorization: `bearer ${process.env.REDDIT_TOKEN}` } : {}) };
    const r = await cachedFetch(ctx.pewp, "reddit", url, { maxAgeDays: 7, init: { headers } });
    if (r.status === 429 || r.status === 403 || r.status === 401) { stoppedBy = `HTTP ${r.status} on "${q}"`; break; }
    if (r.status !== 200) throw new Error(`Reddit HTTP ${r.status} for "${q}"`);
    const f = factor(`Reddit public search JSON ${s ? "r/" + s : "site-wide"} (${period})`, r.fetchedAt, r.cacheFile);
    for (const c of r.json().data?.children || []) {
      const d = c.data || {};
      if (!d.title || !isQuestion(d.title) || /[{}]/.test(d.title)) continue;
      const key = normQuery(d.title);
      if (out.has(key)) continue;
      out.set(key, { question: d.title.trim(), query: q, subreddit: d.subreddit, url: `https://www.reddit.com${d.permalink}`, created: d.created_utc ? new Date(d.created_utc * 1000).toISOString().slice(0, 10) : null, score: f(d.score ?? null), comments: f(d.num_comments ?? null), seenAt: `https://www.reddit.com${d.permalink}` });
    }
  }
  if (stoppedBy && !out.size) { writeBlocked(ctx, "forums", `${UNBLOCK} (stopped by ${stoppedBy})`); throw new Blocked(`${UNBLOCK} (stopped by ${stoppedBy})`); }
  return writeStep(ctx, "forums", { calls, stoppedBy, partial: !!stoppedBy, questions: [...out.values()] });
}

await runCli(import.meta.url, "node research-forums.mjs <target> --query \"...\" [--queries-file FILE] [--subreddit NAME]... [--limit 25] [--period year] [--max-calls 12] [--cwd DIR]", [], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const qf = a.get("queries-file");
  const fileQ = qf ? listFile(qf, "queries").map((x) => (typeof x === "string" ? x : x?.query)) : []; // a named file that is missing is a usage error, not "no queries"
  const r = await run(ctx, { queries: [...a.all("query"), ...fileQ], subreddits: a.all("subreddit"), limit: a.num("limit", 25), period: a.get("period", "year"), maxCalls: a.num("max-calls", 12) });
  return `OK forums: ${r.questions.length} questions, ${r.calls} calls${r.stoppedBy ? `, STOPPED by ${r.stoppedBy} (partial)` : ""} -> ${path.join(ctx.rdir, "forums.json")}`;
});
