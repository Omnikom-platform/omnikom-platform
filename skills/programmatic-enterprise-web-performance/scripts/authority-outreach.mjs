// Usage: node authority-outreach.mjs <target> <command> [options]       [--cwd DIR]
//   add     --domain d [--type t] [--owner NAME] [--status planned] [--date YYYY-MM-DD] [--note "..."] [--url listing-page-url]
//   set     --domain d --status planned|asked|listed|refused [--date YYYY-MM-DD] [--evidence URL] [--owner NAME] [--note "..."]
//   seed    [--verdict PURSUE] [--owner NAME] [--limit 20]       adds the vetted PURSUE sites (authority/vetting.json) as planned
//   list    [--status s]
//   report                                                       counts, follow-ups due, writes authority/outreach.md
//   explain --gained a.com,b.com [--lost c.com]                  which referring-domain gains / losses our own work explains
// The outreach tracker: <pewp>/authority/outreach.json. One row per site: target domain, owner, status (planned / asked / listed /
// refused), date, evidence URL. measure.mjs reads it (readOutreach / explainReferringDomains) to explain referring-domain gains.
// Rules (checked in code, not by hand): a site appears once; "listed" needs an evidence URL on that site (a page a person can open),
// "asked" needs a date; dates are real and not in the future; an owner is needed before asking. A row never turns "listed" without
// proof, so the count of listed rows is a count of things somebody could check.
import path from "node:path";
import { J, W, context, runCli, Blocked, Usage, iso } from "./research-lib.mjs";
import { hostOf, hostIs, ymd } from "./authority-lib.mjs";

export const STATUSES = ["planned", "asked", "listed", "refused"];
export const FOLLOW_UP_DAYS = 21;
export const outreachFile = (pewp) => path.join(pewp, "authority", "outreach.json");
export const readOutreach = (pewp) => J(outreachFile(pewp), null);
export class Invalid extends Error {}
export function emptyOutreach(target) { return { version: 1, target: target || null, updatedAt: iso(), entries: [] }; }

export function checkDate(date, today = ymd()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new Invalid(`date "${date}" must be YYYY-MM-DD`);
  const t = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== date) throw new Invalid(`date "${date}" is not a real day`);
  if (date > today) throw new Invalid(`date ${date} is in the future (today is ${today})`);
  return date;
}
export function checkEvidence(domain, url) {
  let u; try { u = new URL(url); } catch { throw new Invalid(`evidence "${url}" is not a web address`); }
  if (!/^https?:$/.test(u.protocol)) throw new Invalid("evidence must be an http(s) page address a person can open");
  if (!hostIs(hostOf(url), domain)) throw new Invalid(`evidence ${url} is not on ${domain}: it must be the page on that site that shows the listing`);
  return url;
}
export function addEntry(doc, { domain, type = null, owner = null, status = "planned", date = null, note = null, url = null, source = "manual" }, today = ymd()) {
  const d = hostOf(domain || "");
  if (!d || !d.includes(".")) throw new Invalid(`"${domain}" is not a domain`);
  if (doc.entries.some((e) => e.domain === d)) throw new Invalid(`${d} is already in the tracker; use set to change its status`);
  if (!STATUSES.includes(status)) throw new Invalid(`status "${status}" must be one of ${STATUSES.join(", ")}`);
  if (status === "listed" || status === "refused") throw new Invalid(`add ${d} as planned or asked, then use set ${status}${status === "listed" ? " with --evidence" : ""}`);
  if (status === "asked") { if (!owner) throw new Invalid("an owner is needed before a site is asked"); checkDate(date, today); }
  const e = { domain: d, type, owner: owner || "unassigned", status, date: date || today, evidenceUrl: null, listingUrl: url, note, source, history: [{ status, date: date || today }] };
  doc.entries.push(e); doc.updatedAt = iso();
  return e;
}
export function setStatus(doc, { domain, status, date = null, evidence = null, owner = null, note = null }, today = ymd()) {
  const d = hostOf(domain || "");
  const e = doc.entries.find((x) => x.domain === d);
  if (!e) throw new Invalid(`${d} is not in the tracker; use add first`);
  if (!STATUSES.includes(status)) throw new Invalid(`status "${status}" must be one of ${STATUSES.join(", ")}`);
  if (owner) e.owner = owner;
  if ((status === "asked" || status === "listed") && (!e.owner || e.owner === "unassigned")) throw new Invalid(`give ${d} an owner (--owner) before it is ${status}`);
  const when = date || today;
  checkDate(when, today);
  if (status === "listed") { if (!evidence) throw new Invalid(`${d} cannot be "listed" without --evidence: the address of the page on ${d} that shows the listing`); e.evidenceUrl = checkEvidence(d, evidence); }
  else if (evidence) e.evidenceUrl = checkEvidence(d, evidence);
  e.status = status; e.date = when; if (note) e.note = note;
  e.history.push({ status, date: when, ...(evidence ? { evidenceUrl: evidence } : {}) });
  doc.updatedAt = iso();
  return e;
}
export function seedFromVetting(doc, vetting, { verdict = "PURSUE", owner = null, limit = 20, types = {} } = {}, today = ymd()) {
  let n = 0;
  for (const r of vetting?.results || []) {
    if (n >= limit) break;
    if (r.verdict !== verdict || doc.entries.some((e) => e.domain === r.domain)) continue;
    addEntry(doc, { domain: r.domain, type: r.type || types[r.domain] || null, owner, status: "planned", url: r.listing?.submitUrl || null, note: `vetted ${String(vetting.generatedAt).slice(0, 10)}: ${r.reasons?.[0]?.text || r.verdict}`, source: "vetting.json" }, today);
    n++;
  }
  return n;
}
export function followUps(doc, today = ymd(), days = FOLLOW_UP_DAYS) {
  return doc.entries.filter((e) => e.status === "asked" && (Date.parse(today) - Date.parse(e.date)) / 86400000 >= days).map((e) => ({ domain: e.domain, owner: e.owner, askedOn: e.date, daysWaiting: Math.round((Date.parse(today) - Date.parse(e.date)) / 86400000) }));
}
// What our own outreach explains in a referring-domain change (measure.mjs calls this with the diff's gained / lost lists).
export function explainReferringDomains(doc, gained = [], lost = []) {
  const by = new Map((doc?.entries || []).map((e) => [e.domain, e]));
  const one = (d, dir) => {
    const e = by.get(hostOf(d));
    if (!e) return { domain: hostOf(d), explained: "no", text: dir === "gained" ? "no outreach recorded for this site: earned on its own, or a change in what the web graph saw" : "no outreach recorded for this site" };
    if (dir === "gained") {
      if (e.status === "listed") return { domain: e.domain, explained: "outreach-listed", owner: e.owner, date: e.date, evidenceUrl: e.evidenceUrl, text: `we got ${e.domain} listed (${e.owner}, ${e.date}); proof: ${e.evidenceUrl}` };
      if (e.status === "asked") return { domain: e.domain, explained: "asked-not-confirmed", owner: e.owner, date: e.date, text: `we asked ${e.domain} on ${e.date} but no proof of a listing is recorded: the gain may be ours, record the page address` };
      return { domain: e.domain, explained: "planned-only", text: `${e.domain} is only planned in the tracker (status ${e.status}); the gain is not shown to be ours` };
    }
    if (e.status === "listed") return { domain: e.domain, explained: "lost-our-listing", owner: e.owner, date: e.date, evidenceUrl: e.evidenceUrl, text: `${e.domain} was a listing we earned (${e.date}); check ${e.evidenceUrl} and ask ${e.owner} to restore it` };
    return { domain: e.domain, explained: "no", text: `${e.domain} is in the tracker as ${e.status}, not as a listing we hold` };
  };
  const g = gained.map((d) => one(d, "gained")), l = lost.map((d) => one(d, "lost"));
  return { gained: g, lost: l, gainedExplainedByOutreach: g.filter((x) => x.explained === "outreach-listed").length, gainedTotal: g.length, lostOurListings: l.filter((x) => x.explained === "lost-our-listing").length, lostTotal: l.length };
}
export function reportMd(doc, today = ymd()) {
  const c = Object.fromEntries(STATUSES.map((s) => [s, doc.entries.filter((e) => e.status === s).length]));
  const fu = followUps(doc, today);
  const L = [`# Outreach tracker: ${doc.target || ""}`, "", `As of ${today}: ${doc.entries.length} sites. Planned ${c.planned}, asked ${c.asked}, listed ${c.listed}, refused ${c.refused}.`, "", "| Site | Kind | Owner | Status | Date | Proof |", "|---|---|---|---|---|---|"];
  for (const e of doc.entries) L.push(`| ${e.domain} | ${e.type || ""} | ${e.owner} | ${e.status} | ${e.date} | ${e.evidenceUrl || ""} |`);
  if (fu.length) L.push("", `## Follow up (asked ${FOLLOW_UP_DAYS}+ days ago, no answer recorded)`, "", ...fu.map((f) => `- ${f.domain}: asked ${f.askedOn} by ${f.owner}, ${f.daysWaiting} days`));
  L.push("", "A site counts as listed only with a proof address. The next measure run shows which listings the link data has seen yet (Common Crawl is about a quarter behind).");
  return L.join("\n") + "\n";
}

await runCli(import.meta.url, "node authority-outreach.mjs <target> add|set|seed|list|report|explain [options]", [], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const cmd = a._[1];
  const file = outreachFile(ctx.pewp);
  const doc = readOutreach(ctx.pewp) || emptyOutreach(ctx.domain);
  const save = () => { W(file, doc); W(path.join(ctx.pewp, "authority", "outreach.md"), reportMd(doc)); };
  try {
    if (cmd === "add") { const e = addEntry(doc, { domain: a.get("domain"), type: a.get("type"), owner: a.get("owner"), status: a.get("status", "planned"), date: a.get("date"), note: a.get("note"), url: a.get("url") }); save(); return `OK added ${e.domain} (${e.status})`; }
    if (cmd === "set") { const e = setStatus(doc, { domain: a.get("domain"), status: a.get("status"), date: a.get("date"), evidence: a.get("evidence"), owner: a.get("owner"), note: a.get("note") }); save(); return `OK ${e.domain} is now ${e.status} (${e.date})${e.evidenceUrl ? ", proof " + e.evidenceUrl : ""}`; }
    if (cmd === "seed") { const v = J(path.join(ctx.pewp, "authority", "vetting.json")); if (!v) throw new Blocked("no authority/vetting.json: run authority-vet.mjs first"); const n = seedFromVetting(doc, v, { verdict: a.get("verdict", "PURSUE"), owner: a.get("owner"), limit: a.num("limit", 20) }); save(); return `OK seeded ${n} ${a.get("verdict", "PURSUE")} sites as planned`; }
    if (cmd === "list") return doc.entries.filter((e) => !a.get("status") || e.status === a.get("status")).map((e) => `${e.status.padEnd(8)} ${e.domain.padEnd(30)} ${e.owner.padEnd(12)} ${e.date} ${e.evidenceUrl || ""}`).join("\n") || "(empty)";
    if (cmd === "report") { save(); return reportMd(doc); }
    if (cmd === "explain") { const split = (k) => String(a.get(k, "")).split(",").map((x) => x.trim()).filter(Boolean); return JSON.stringify(explainReferringDomains(doc, split("gained"), split("lost")), null, 1); }
  } catch (e) { if (e instanceof Invalid) { console.error(`REFUSED: ${e.message}`); process.exit(2); } throw e; }
  throw new Usage("node authority-outreach.mjs <target> add|set|seed|list|report|explain [options]");
});
