// SERP capture importer. Google and Bing pages are NEVER fetched by code (terms, robot checks; owner decision 2026-10-22 and the
// project's 2026-10-17 precedent). The MAIN SESSION captures them in the owner's browser at human pace (one page at a time, at least
// 45 s apart, stop at the first robot check) and saves one file per query and engine; this script parses the saved files into rows.
// Usage: node research-serp-import.mjs <target> [--dir DIR (default <pewp>/captures/serp)] [--device desktop|mobile] [--max-age-days 30] [--cwd DIR]
// Accepted files in the directory:
//   *.json  one capture: { query, engine:"google|bing", capturedAt, browser, device, language, location:{requested, footer, method},
//           organic:[{position, url, title}], localPack:[{name, rating, reviews}], paa:[...], aiOverview:{present, text, sources:[domain]},
//           features:[...], robotCheck:false }
//   *.google.md / *.bing.md  the text form this project used on 2026-10-17 (icm/work/p0.2/fresh/<ID>.<engine>.md)
// --device fills a missing device (recorded as deviceSource "default"); a capture without query, engine, date, location or device is
// REJECTED with the reason (a row the next run cannot compare is worse than no row). "Localized" is claimed only when the page footer
// shows the requested city; otherwise the location reads "NOT LOCALIZED (baseline): <what the footer said>".
// Output: research/serp.json { captures:[...], rejected:[...], counts }. No directory or no files => BLOCKED (exit 3).
import fs from "node:fs";
import path from "node:path";
import { Blocked, J, stripBom, iso, context, needBusiness, runCli, writeStep, writeBlocked, factor, normQuery, domainOf, ageDays } from "./research-lib.mjs";

const UNBLOCK = "the main session captures the target queries in the owner's browser (claude-in-chrome): one page at a time, at least 45 s apart, stop at the first robot check, each saved as <pewp>/captures/serp/<id>.<engine>.json (format in stages/research.md); see research/capture-requests.json for the list";
const ROBOT = /BLOCKED:\s*(Google\s*)?robot|unusual traffic|captcha|are you a robot|verify you are (a )?human|before you continue to google/i;

const splitDot = (s) => s.split(/\s+·\s+/).map((x) => x.trim()).filter(Boolean);
const none = (s) => !s || /^(none|n\/a|-)\b/i.test(s.trim());
const domainsIn = (s) => [...new Set([...String(s || "").matchAll(/\b([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|org|net|gov|edu|io|co|us|info|biz|app|dev|me|ai|news|realty|homes|estate|house|ca|uk|au))\b/gi)].map((m) => m[1].toLowerCase().replace(/^www\./, "")))];

// Many 2026-10-17 files carry no query line; the query is line 1 of captures/<ID>.md next to the fresh/ folder: `# A01 — "realtor in Elk Grove CA" — ...`.
function queryFromSibling(file, name) {
  const id = name.replace(/\.(google|bing)\.md$/i, "").replace(/\.md$/i, "");
  for (const p of [path.join(path.dirname(path.dirname(file)), "captures", `${id}.md`), path.join(path.dirname(file), `${id}.md`)]) {
    try { const m = stripBom(fs.readFileSync(p, "utf8")).split("\n")[0].match(/^#\s*\S+\s+[—-]\s+"([^"]+)"/); if (m) return m[1]; } catch {}
  }
  return null;
}

export function parseMarkdownCapture(text, file) {
  const t = stripBom(text).replace(/\r/g, "");
  const name = path.basename(file);
  const engine = /\.bing\./i.test(name) ? "bing" : /\.google\./i.test(name) ? "google" : /BING AI ANSWER|bing\.com/i.test(t) ? "bing" : "google";
  const line = (re) => { const m = t.match(re); return m ? m[1].trim() : null; };
  const query = line(/^Query(?:\s+\(?[\w-]+\)?)?:\s*(.+?)(?:\s+—\s+https?:\/\/\S+)?\s*$/m) || queryFromSibling(file, name);
  const capturedAt = line(/^##\s*UPDATE\s+(\d{4}-\d{2}-\d{2})/m) || line(/\b(\d{4}-\d{2}-\d{2})\b/);
  const browser = line(/READ in the ([^(—\n]+?)(?:\s*\(|\s+—|\n)/) || (/EDGE/i.test(t.split("\n")[0]) ? "owner's Edge" : null);
  const locLine = line(/^Location:\s*(.+)$/m);
  const requested = locLine ? (locLine.match(/set to ([A-Z][A-Za-z .'-]+,\s*[A-Za-z ]+?)(?:\s+with|\s+using|\.|;|,\s*footer)/) || locLine.match(/set to ([A-Z][A-Za-z .'-]+,\s*[A-Za-z]+)/) || [])[1]?.trim() || null : null;
  const footer = locLine ? (locLine.match(/footer location shown:\s*"([^"]+)"/i) || locLine.match(/footer (?:location )?(?:shows?|shown)[: ]+"?([^"]+?)"?(?:\s|$)/i) || [])[1] || (/none/i.test(locLine) ? "none" : null) : null;
  const sec = (label) => { const m = t.match(new RegExp(`^${label}[^:\\n]*:\\s*(.*)$`, "mi")); return m ? m[1].trim() : null; };
  const aiHead = t.match(/\*\*(?:GOOGLE AI OVERVIEW|BING AI ANSWER[^:]*):\s*(PRESENT|NOT PRESENT)/i);
  const aiText = (t.match(/AI answer text \(verbatim, full\):\s*\n([\s\S]*?)\n(?:Named in the AI answer|Sources shown)/i) || [])[1]?.trim() || null;
  const named = sec("Named in the AI answer");
  const srcLine = sec("Sources shown with the AI answer");
  const pack = sec("Local / Places pack");
  const org = sec("Organic top 10");
  const paa = sec("People also ask");
  const cap = {
    id: name.replace(/\.(google|bing)\.md$/i, "").replace(/\.md$/i, ""), file, engine, query, capturedAt, browser, device: null, language: null,
    location: { requested, footer, method: locLine ? locLine.slice(0, 200) : null },
    organic: org && !none(org) ? splitDot(org).map((seg) => { const m = seg.match(/^(\d+)\s+([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(\/\S*)?\s*(?:\((.*)\))?\s*(.*)$/i); return m ? { position: Number(m[1]), url: m[3] ? `https://${m[2].toLowerCase()}${m[3]}` : null, domain: m[2].toLowerCase().replace(/^www\./, ""), title: (m[4] || m[5] || "").trim() || null } : null; }).filter(Boolean) : [],
    localPack: pack && !none(pack) ? splitDot(pack.replace(/\s*·\s*"More businesses" link/i, "")).map((seg) => { const m = seg.match(/^(.*?)\s+(\d(?:\.\d)?)\s*\((\d[\d,]*)\)/); return m ? { name: m[1].trim(), rating: Number(m[2]), reviews: Number(m[3].replace(/,/g, "")) } : { name: seg.slice(0, 80), rating: null, reviews: null }; }) : [],
    paa: paa && !none(paa) ? splitDot(paa).map((q) => q.replace(/^"|"$/g, "")) : [],
    aiOverview: { present: aiHead ? /^PRESENT$/i.test(aiHead[1]) : null, text: aiText && !none(aiText) ? aiText : null, sources: srcLine && !none(srcLine) ? domainsIn(srcLine) : [], named: named && !none(named) ? named.slice(0, 600) : null },
    robotCheck: ROBOT.test(t),
  };
  return cap;
}

// Normalise one capture, apply the rejection rules, compute the location label and the features.
export function finish(cap, { defaultDevice = null, defaultLanguage = null, file, deviceLabel = null }) {
  const why = [];
  if (!cap.query) why.push("no query");
  if (!["google", "bing"].includes(cap.engine)) why.push(`engine "${cap.engine}" is not google|bing`);
  if (!cap.capturedAt || Number.isNaN(Date.parse(cap.capturedAt))) why.push("no capture date");
  cap.deviceSource = cap.device ? "capture" : null;
  if (!cap.device && defaultDevice) { cap.device = defaultDevice; cap.deviceSource = deviceLabel || "default (--device)"; }
  if (!["mobile", "desktop"].includes(cap.device)) why.push("no device (mobile|desktop): pass --device or write it in the capture");
  cap.language = cap.language || defaultLanguage;
  if (!cap.language) why.push("no language");
  const loc = cap.location || {};
  if (loc.footer && /^none$/i.test(loc.footer.trim())) loc.footer = null;
  const reqCity = loc.requested ? loc.requested.split(",")[0].trim().toLowerCase() : null;
  const localized = !!(reqCity && loc.footer && loc.footer.toLowerCase().includes(reqCity));
  cap.location = { ...loc, localized };
  cap.locationLabel = localized ? loc.requested : loc.footer || loc.requested ? `NOT LOCALIZED (baseline): ${loc.footer || "no footer location recorded"}${loc.requested ? ` (asked for ${loc.requested})` : ""}` : null;
  if (!cap.locationLabel && cap.engine === "bing") cap.locationLabel = "NOT LOCALIZED (baseline): Bing has no location setting; the machine's own location applies";
  if (!cap.locationLabel) why.push("no location (write location.footer or location.requested; 'NOT LOCALIZED' is a valid, honest label)");
  if (cap.robotCheck) { cap.status = "BLOCKED"; }
  else cap.status = cap.organic.length >= 1 ? (cap.organic.length >= 5 ? "CAPTURED" : "PARTIAL") : "PARTIAL";
  cap.organic = (cap.organic || []).map((o, i) => ({ position: o.position ?? i + 1, url: o.url || null, domain: o.domain || domainOf(o.url || ""), title: o.title || null }));
  cap.features = [...new Set([...(cap.features || []), ...(cap.aiOverview?.present ? ["ai_overview"] : []), ...(cap.localPack?.length ? ["local_pack"] : []), ...(cap.paa?.length ? ["paa"] : [])])];
  cap.source = "captured in browser";
  return why.length ? { rejected: { file, reason: why.join("; ") } } : { capture: cap };
}

export function ourPosition(cap, domain) {
  const hit = cap.organic.find((o) => o.domain === domain || o.domain.endsWith("." + domain));
  const f = factor(`${cap.engine} results captured in browser (${cap.browser || "browser"}) ${cap.capturedAt}`, `${cap.capturedAt.slice(0, 10)}T00:00:00.000Z`, cap.file, { location: cap.locationLabel, device: cap.device });
  return f(hit ? hit.position : null, hit ? {} : { unit: `not in the ${cap.organic.length} organic results captured` });
}

export async function run(ctx, { dir = null, dirs = [], defaultDevice = null, maxAgeDays = 30 } = {}) {
  const b = needBusiness(ctx);
  const roots = [...(dir ? [dir] : []), ...dirs];
  if (!roots.length) roots.push(path.join(ctx.pewp, "captures", "serp"));
  const files = roots.flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /\.json$|\.(google|bing)\.md$/i.test(f)).sort().map((f) => path.join(d, f)) : []));
  if (!files.length) { writeBlocked(ctx, "serp", UNBLOCK); throw new Blocked(UNBLOCK); }
  const captures = [], rejected = [];
  for (const file of files) {
    const f = path.basename(file);
    let cap;
    try {
      if (/\.json$/i.test(f)) { const j = J(file); if (!j) throw new Error("not valid JSON"); cap = { id: f.replace(/\.json$/i, ""), file, ...j, engine: String(j.engine || "").toLowerCase(), query: j.query, location: j.location || {}, organic: j.organic || [], localPack: j.localPack || [], paa: j.paa || [], aiOverview: j.aiOverview || { present: null, text: null, sources: [] }, robotCheck: !!j.robotCheck || ROBOT.test(JSON.stringify(j.notes || "")) }; }
      else cap = parseMarkdownCapture(fs.readFileSync(file, "utf8"), file);
    } catch (e) { rejected.push({ file, reason: `unreadable: ${e.message}` }); continue; }
    // legacy text captures never recorded the device; they were read in desktop browsers (the owner's Edge, the built-in browser), so desktop is
    // assumed for THEM ONLY, labelled as an assumption. A JSON capture must carry its own device.
    const legacy = !/\.json$/i.test(f), assumed = legacy && !defaultDevice;
    const r = finish(cap, { defaultDevice: defaultDevice || (legacy ? "desktop" : null), defaultLanguage: ctx.market.language, file, deviceLabel: assumed ? "assumed desktop: legacy text capture, device not recorded (read in the owner's Edge / built-in browser)" : null });
    if (r.rejected) rejected.push(r.rejected); else captures.push(r.capture);
  }
  // the same capture saved in two folders counts once
  const seen = new Set(), unique = [];
  for (const c of captures) { const k = [c.engine, normQuery(c.query), c.device, c.capturedAt, c.locationLabel].join("|"); if (seen.has(k)) continue; seen.add(k); unique.push(c); }
  const duplicates = captures.length - unique.length;
  captures.length = 0; captures.push(...unique);
  for (const c of captures) { c.ourPosition = ourPosition(c, b.domain); c.ageDays = Math.round(ageDays(c.capturedAt) * 10) / 10; c.stale = c.ageDays > maxAgeDays; }
  const counts = { files: files.length, duplicates, captures: captures.length, rejected: rejected.length, blocked: captures.filter((c) => c.status === "BLOCKED").length, partial: captures.filter((c) => c.status === "PARTIAL").length, stale: captures.filter((c) => c.stale).length, notLocalized: captures.filter((c) => !c.location.localized).length };
  return writeStep(ctx, "serp", { dirs: roots, maxAgeDays, counts, captures, rejected });
}

await runCli(import.meta.url, "node research-serp-import.mjs <target> [--dir DIR] [--device desktop|mobile] [--max-age-days 30] [--cwd DIR]", [], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const r = await run(ctx, { dir: a.get("dir"), defaultDevice: a.get("device"), maxAgeDays: a.num("max-age-days", 30) });
  return `OK serp: ${JSON.stringify(r.counts)} -> ${path.join(ctx.rdir, "serp.json")}${r.rejected.length ? "\nREJECTED:\n" + r.rejected.map((x) => `  ${path.basename(x.file)}: ${x.reason}`).join("\n") : ""}`;
});
