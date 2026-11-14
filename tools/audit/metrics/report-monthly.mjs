// The monthly report in plain words, built only from metrics_snapshots rows: monthlyReport({ rows, month: "2026-10", site: { name, domain } }) -> markdown.
// For a business owner: no jargon ("people who saw you in Google", "how fast your pages open on a phone", "AI assistants that named you"). Compares with the
// previous month's rows when they exist. A BLOCKED or missing source says "not connected yet: <what unblocks it>". Every number in the text is a value of a
// row or a sum, average, percentage or seconds figure worked out from rows here (a test traces each one). No em dash ever leaves this file. Deno-loadable.
import { isObj } from "./util.mjs";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DEFAULT_UNBLOCK = {
  "search-console": "our Search Console account holds the site's domain and is connected",
  pagespeed: "the PageSpeed key is set and the site is live",
  bing: "the site is verified in Bing Webmaster Tools and the Bing key is set",
  "ai-answers": "the AI-answer check of our research skill is run for this site, or answers captured from ChatGPT or Perplexity are added",
};
const EM = String.fromCharCode(0x2014);
const cond = (s) => clean(s).replace(/^([A-Z])([a-z])/, (m, a, b) => a.toLowerCase() + b).replace(/[.\s]+$/, "");
const clean = (s) => String(s ?? "").split(EM).join(" - ").replace(/\s+/g, " ").replace(/[<>`]/g, "").trim();
const int = (n) => Math.round(n).toLocaleString("en-US");
const one = (n) => (Math.round(n * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const seconds = (ms) => one(ms / 1000);
export const monthName = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const prevMonth = (m) => { const y = Number(m.slice(0, 4)), k = Number(m.slice(5, 7)); return k === 1 ? `${y - 1}-12` : `${y}-${String(k - 1).padStart(2, "0")}`; };

const inMonth = (rows, source, month) => rows.filter((r) => isObj(r) && r.source === source && typeof r.day === "string" && r.day.startsWith(month) && isObj(r.data)).sort((a, b) => (a.day < b.day ? -1 : 1));
const okRows = (rs) => rs.filter((r) => r.data.blocked === undefined);
const why = (rs, source) => cond(rs.filter((r) => r.data.blocked).at(-1)?.data.blocked.unblock || DEFAULT_UNBLOCK[source]);
const notConnected = (rs, source) => `This part is not connected yet: ${why(rs, source)}.`;
const change = (cur, prev, label) => {
  if (!(prev > 0)) return "";
  const pct = Math.round(((cur - prev) / prev) * 100);
  return pct === 0 ? ` That is about the same as ${label}.` : ` That is ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% on ${label}.`;
};

// Clicks, impressions and the average spot of a month. One-day windows are summed; a row that covers several days is used only when the month has no
// one-day row (then the newest such row stands alone). Position is weighted by impressions.
function searchTotals(rs) {
  const ok = okRows(rs); if (!ok.length) return null;
  const single = ok.filter((r) => r.data.window?.start === r.data.window?.end);
  const used = single.length ? single : [ok.at(-1)];
  const sum = { clicks: 0, impressions: 0, posW: 0, days: used.length, queries: new Map(), pages: new Map() };
  for (const r of used) {
    sum.clicks += r.data.totals.clicks; sum.impressions += r.data.totals.impressions; sum.posW += (r.data.totals.position ?? 0) * r.data.totals.impressions;
    for (const [list, into] of [[r.data.queries, sum.queries], [r.data.pages, sum.pages]]) for (const x of list || []) into.set(x.key, (into.get(x.key) || 0) + x.clicks);
  }
  return { ...sum, position: sum.impressions ? sum.posW / sum.impressions : null, window: used.length === 1 && single.length === 0 ? used[0].data.window : null };
}
const top = (m, n) => [...m.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
const clicksWord = (n) => (n === 1 ? "click" : "clicks");

function googleSection(rows, month, prev) {
  const rs = inMonth(rows, "search-console", month), cur = searchTotals(rs), old = searchTotals(inMonth(rows, "search-console", prev));
  const L = ["## People who saw you in Google", ""];
  if (!cur) return [...L, notConnected(rs, "search-console"), ""];
  L.push(`Google showed your site ${int(cur.impressions)} times${cur.window ? ` (from ${cur.window.start} to ${cur.window.end})` : ""}, and ${int(cur.clicks)} ${cur.clicks === 1 ? "person" : "people"} clicked through to it.${change(cur.impressions, old?.impressions, monthName(prev))}`);
  if (cur.position != null) L.push(`On average your site appeared at spot ${one(cur.position)} in the results (the lower the number, the closer to the top).`);
  const q = top(cur.queries, 3), p = top(cur.pages, 3);
  if (q.length) L.push("", "Searches that brought the most people:", ...q.map(([k, c]) => `- "${clean(k)}": ${int(c)} ${clicksWord(c)}`));
  if (p.length) L.push("", "Pages people reached from Google most:", ...p.map(([k, c]) => `- ${clean(k)}: ${int(c)} ${clicksWord(c)}`));
  return [...L, ""];
}

const avgScore = (r) => r.data.pages.reduce((s, p) => s + p.performance, 0) / r.data.pages.length;
function speedSection(rows, month, prev) {
  const rs = inMonth(rows, "pagespeed", month), ok = okRows(rs), L = ["## How fast your pages open on a phone", ""];
  if (!ok.length) return [...L, notConnected(rs, "pagespeed"), ""];
  const r = ok.at(-1), avg = avgScore(r), oldRows = okRows(inMonth(rows, "pagespeed", prev)), old = oldRows.at(-1);
  const n = r.data.pages.length;
  L.push(`We tested ${n} ${n === 1 ? "page" : "pages"} the way a phone sees them. The average speed score is ${int(avg)} (higher is faster; a perfect page gets the top mark).`
    + (old ? (Math.round(avgScore(old)) === Math.round(avg) ? ` Last month it was the same.` : ` Last month it was ${int(avgScore(old))}.`) : ""));
  const slow = r.data.pages.slice().sort((a, b) => a.performance - b.performance)[0];
  L.push(`The slowest page is ${clean(slow.url)} with a score of ${int(slow.performance)}${slow.lcpMs != null ? `; its main content appears after about ${seconds(slow.lcpMs)} seconds` : ""}.`);
  const c = r.data.crux;
  if (c.none) L.push("Google has no data from real visitors on phones yet: too few people have visited the site.");
  else if (c.blocked) L.push(`The real-visitor numbers are not connected yet: ${cond(c.blocked.unblock)}.`);
  else if (c.lcpMs != null) L.push(`Real visitors on phones (Google's own data, ${c.collectionPeriod.first} to ${c.collectionPeriod.last}): the main content appears after about ${seconds(c.lcpMs)} seconds for most of them.`);
  return [...L, ""];
}

function bingSection(rows, month, prev) {
  const rs = inMonth(rows, "bing", month), cur = searchTotals(rs), old = searchTotals(inMonth(rows, "bing", prev));
  const pings = rs.flatMap((r) => (Array.isArray(r.data.indexnow) ? r.data.indexnow : []));
  const L = ["## People who found you on Bing", ""];
  if (!cur) L.push(notConnected(rs, "bing"));
  else L.push(`Bing showed your site ${int(cur.impressions)} times, and ${int(cur.clicks)} ${cur.clicks === 1 ? "person" : "people"} clicked through to it.${change(cur.impressions, old?.impressions, monthName(prev))}`);
  if (pings.length) L.push(`Each time the site was published, we told Bing and the other search engines that pages had changed: ${int(pings.length)} ${pings.length === 1 ? "time" : "times"} this month, ${int(pings.reduce((s, p) => s + p.urls.length, 0))} pages in all.`);
  return [...L, ""];
}

function answerCounts(r) {
  const rows = r.data.rows, named = rows.filter((x) => x.named !== null), cited = rows.filter((x) => x.cited !== null);
  return { asked: new Set(rows.map((x) => x.promptId)).size, answers: rows.length, named: named.filter((x) => x.named).length, ofNamed: named.length, cited: cited.filter((x) => x.cited).length, ofCited: cited.length, engines: [...new Set(rows.map((x) => x.engine))].sort() };
}
function aiSection(rows, month, prev) {
  const rs = inMonth(rows, "ai-answers", month), ok = okRows(rs), L = ["## AI assistants that named you", ""];
  if (!ok.length) return [...L, notConnected(rs, "ai-answers"), ""];
  const a = answerCounts(ok.at(-1)), oldRows = okRows(inMonth(rows, "ai-answers", prev)), o = oldRows.length ? answerCounts(oldRows.at(-1)) : null;
  L.push(`We asked ${int(a.asked)} ${a.asked === 1 ? "question" : "questions"} the way a customer would and collected ${int(a.answers)} ${a.answers === 1 ? "answer" : "answers"} from AI assistants (${a.engines.join(", ")}). They named you in ${int(a.named)} of ${int(a.ofNamed)} answers and linked to your site in ${int(a.cited)} of ${int(a.ofCited)}.`);
  if (o) L.push(`Last month they named you in ${int(o.named)} of ${int(o.ofNamed)} answers and linked to your site in ${int(o.cited)} of ${int(o.ofCited)}.`);
  return [...L, ""];
}

export function monthlyReport({ rows, month, site }) {
  if (!Array.isArray(rows)) throw new TypeError("monthlyReport needs rows (an array of metrics_snapshots rows)");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) throw new TypeError('monthlyReport needs month as "YYYY-MM"');
  const prev = prevMonth(month);
  const L = [`# How ${clean(site?.name || "your site")} did in ${monthName(month)}`, ""];
  if (site?.domain) L.push(`Website: ${clean(site.domain)}`, "");
  L.push(...googleSection(rows, month, prev), ...speedSection(rows, month, prev), ...bingSection(rows, month, prev), ...aiSection(rows, month, prev));
  return L.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
