// Competitor discovery, step 2 of the overhaul mode (contract C3): turns what the discovery agents found into ONE sourced list the owner can read and approve.
// Usage: node competitors-discover.mjs <target> [--cwd DIR] [--candidates FILE.json] [--pewp DIR]
// Reads (all optional, at least one must exist):
//   <pewp>/inputs/competitors-*.md          markdown tables written from the agents' answers (any column layout that has a Domain or a Handle column;
//                                           other tables, such as a verdict table under "Your named candidates", are NOT competitors and are ignored)
//   <pewp>/research/competitors-candidates.json   (or --candidates FILE)  rows already in the shape below, written by an agent
// Writes <pewp>/research/competitors-proposed.json and competitors-proposed.md:
//   { step:"competitors-discover", generatedAt, business, source:[files], rows:[{ name, domain|null, handle|null, platform, kind, evidenceUrl|null,
//     closeness 1..5, note }], needsEvidence:[names], dropped:[{name, why}] }
//   platform: web | instagram | tiktok | youtube | substack | newsletter | facebook | pinterest | x | other
//   kind: publisher | social-curator | paid-media | agency | brokerage-program | design-broker | marketplace | other
// A row's evidenceUrl is the first URL in its table row; a row with none is kept with evidenceUrl null and listed in needsEvidence: approve.mjs refuses
// the list while any such row exists. A closeness that is not a whole number 1..5 becomes 3 with the note "closeness defaulted". The same account or site
// listed in two files is one row (the first file wins, the note says where else it was listed).
// Social accounts are competitors too: they stay in the list and the offsite plan; only rows WITH a domain are fed to the link comparison (authority.mjs).
// With nothing to read: prints the discovery brief for the main session and exits 3. Scripts never search the web themselves.
// Exit 0 written, 3 nothing to read (the brief is printed), 2 usage.
import fs from "node:fs";
import path from "node:path";
import { context, J, W, iso, domainOf, runCli } from "./research-lib.mjs";

export const PLATFORMS = ["web", "instagram", "tiktok", "youtube", "substack", "newsletter", "facebook", "pinterest", "x", "other"];
export const KINDS = ["publisher", "social-curator", "paid-media", "agency", "brokerage-program", "design-broker", "marketplace", "other"];
// hosts that are a platform or a link-in-bio page, never the competitor's own site (they must not reach the link comparison)
const NOT_OWN_SITE = /^(linktr\.ee|lnk\.bio|beacons\.ai|bio\.link|campsite\.bio|instagram\.com|youtube\.com|youtu\.be|tiktok\.com|facebook\.com|pinterest\.com|x\.com|twitter\.com|substack\.com|linkedin\.com)$/i;

// ---------- markdown tables ----------
const cellsOf = (line) => {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return t.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
};
const isSeparator = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const plain = (s) => String(s ?? "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*`]+/g, "").replace(/\s+/g, " ").trim();
const URL_RE = /https?:\/\/(?:[^\s()<>|;,]|\([^\s()<>|]*\))+/i;
export const firstUrl = (s) => { const m = String(s ?? "").match(URL_RE); return m ? m[0].replace(/[.,;:!?]+$/, "") : null; };

// every table that has a Domain or a Handle column: { header:[...], rows:[[cells]] }
export function tablesOf(md) {
  const lines = String(md).replace(/\r/g, "").split("\n"), out = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith("|") || !isSeparator(lines[i + 1])) continue;
    const header = cellsOf(lines[i]).map((h) => plain(h).toLowerCase());
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].trim().startsWith("|"); j++) rows.push(cellsOf(lines[j]));
    i = j - 1;
    if (header.some((h) => /^(domain|handle)\b/.test(h))) out.push({ header, rows });
  }
  return out;
}

// ---------- inference ----------
export function platformOf({ platformText = "", handle = null, domain = null, url = null }) {
  const tokens = String(platformText).toLowerCase().split(/[,/;+&]|\band\b/).map((t) => t.trim()).filter(Boolean);
  for (const t of tokens) {
    if (/^(ig|instagram)\b/.test(t)) return "instagram";
    if (/^tiktok\b/.test(t)) return "tiktok";
    if (/^(youtube|yt)\b/.test(t)) return "youtube";
    if (/^substack\b/.test(t)) return "substack";
    if (/^newsletter\b/.test(t)) return "newsletter";
    if (/^(facebook|fb)\b/.test(t)) return "facebook";
    if (/^pinterest\b/.test(t)) return "pinterest";
    if (/^(x|twitter)\b/.test(t)) return "x";
    if (/^(site|web|website|portal)\b/.test(t)) return "web";
  }
  const host = (u) => { try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, ""); } catch { return ""; } };
  for (const h of [domain && host(domain), url && host(url)].filter(Boolean)) {
    if (/(^|\.)instagram\.com$/.test(h)) return "instagram";
    if (/(^|\.)youtube\.com$|^youtu\.be$/.test(h)) return "youtube";
    if (/(^|\.)tiktok\.com$/.test(h)) return "tiktok";
    if (/(^|\.)facebook\.com$/.test(h)) return "facebook";
    if (/(^|\.)pinterest\.com$/.test(h)) return "pinterest";
    if (/(^|\.)(x|twitter)\.com$/.test(h)) return "x";
    if (/(^|\.)substack\.com$/.test(h)) return "substack";
  }
  if (handle) return "other";
  return "web";
}
export function kindOf(typeText) {
  const t = String(typeText || "").toLowerCase();
  if (/paid media/.test(t)) return "paid-media";
  if (/brokerage program/.test(t)) return "brokerage-program";
  if (/agency|reseller|studio/.test(t)) return "agency";
  if (/curator|\big\b|instagram/.test(t)) return "social-curator";
  if (/publisher/.test(t)) return "publisher";
  if (/\bbroker/.test(t)) return "design-broker";
  if (/marketplace/.test(t)) return "marketplace";
  return "other";
}
const SOCIAL = new Set(["instagram", "tiktok", "youtube", "substack", "newsletter", "facebook", "pinterest", "x"]);
const domainFrom = (text) => {
  const m = plain(text).toLowerCase().match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?=[\s/,;)(]|$)/);
  if (!m) return null;
  const d = m[1];
  return NOT_OWN_SITE.test(d) ? null : d;
};
const handleFromUrl = (platform, text) => {
  const re = { instagram: /instagram\.com\/([A-Za-z0-9._]+)/i, tiktok: /tiktok\.com\/@([A-Za-z0-9._]+)/i, youtube: /youtube\.com\/@?([A-Za-z0-9._-]+)/i, x: /(?:x|twitter)\.com\/([A-Za-z0-9_]+)/i }[platform];
  const m = re && String(text).match(re);
  return m && !/^(p|reel|explore|channel|watch)$/i.test(m[1]) ? "@" + m[1] : null;
};
const closenessOf = (text) => {
  const m = plain(text).match(/^\W*([1-5])(?!\d|\.\d)/);
  return m ? Number(m[1]) : null;
};

// one table row -> a normalised row, or { dropped } when it names nobody
export function rowFromTable(header, cells, file) {
  const col = (re) => header.findIndex((h) => re.test(h));
  const at = (i) => (i >= 0 ? cells[i] ?? "" : "");
  const iHandle = col(/^handle\b/), iDomain = col(/^domain\b/), iName = col(/^name\b/), iType = col(/^type\b/), iClose = col(/closeness/), iPlatform = col(/^platform\b/), iDesc = col(/^what (they|the)\b/);
  const rowText = cells.join(" | ");
  const nameCell = plain(at(iName >= 0 ? iName : iHandle >= 0 ? iHandle : iDomain));
  const domain = domainFrom(at(iDomain >= 0 ? iDomain : -1));
  const handleCell = at(iHandle);
  let handle = (plain(handleCell).match(/^@[\w.]+/) || [null])[0];
  const rawDomain = plain(at(iDomain));
  let platform = platformOf({ platformText: plain(at(iPlatform)), handle, domain: domain || rawDomain, url: domain || rawDomain ? null : firstUrl(rowText) });
  let platformNote = null;
  if (!handle && SOCIAL.has(platform)) {
    handle = handleFromUrl(platform, rowText);
    if (!handle && !domain) for (const p of ["instagram", "tiktok", "youtube", "x"]) { const h = handleFromUrl(p, rowText); if (h) { handle = h; platform = p; platformNote = `platform ${p} taken from its profile URL`; break; } }
  }
  const typeText = iType >= 0 ? plain(at(iType)) : "";
  let kind, kindNote = null;
  if (iType >= 0) kind = kindOf(typeText);
  else if (SOCIAL.has(platform) || handle) kind = "social-curator";
  else { // a table with no Type column (websites): a publisher unless the row says it is a brokerage or an agency selling editorial
    const desc = plain(at(iDesc >= 0 ? iDesc : 1)).toLowerCase();
    kind = /\b(brokerage|brokers?|compass-licensed|agency)\b/.test(desc) && /editorial/.test(desc) ? "design-broker" : "publisher";
    kindNote = `kind inferred from the description (${file} has no Type column)`;
  }
  const closeness = closenessOf(at(iClose));
  const descCell = plain(at(iDesc >= 0 ? iDesc : iType >= 0 ? iType + 1 : 1));
  const name = nameCell || domain || handle;
  if (!name || (!domain && !handle)) return { dropped: { name: name || "(no name)", why: "no domain and no handle (an account or a site must be named to be tracked)" } };
  const extra = (plain(at(iDomain)).match(/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi) || []).filter((d) => d.toLowerCase() !== domain && !NOT_OWN_SITE.test(d));
  return {
    row: {
      name, domain: domain ? domainOf(domain) : null, handle: handle || null, platform, kind, evidenceUrl: firstUrl(rowText), closeness: closeness ?? 3,
      note: [descCell.slice(0, 160), kindNote, platformNote, extra.length ? `also: ${extra.join(", ")}` : null, closeness == null ? "closeness defaulted" : null, `from ${file}`].filter(Boolean).join("; "),
    },
  };
}

export function parseCompetitorsMd(md, file = "inputs/competitors.md") {
  const rows = [], dropped = [];
  for (const t of tablesOf(md)) for (const cells of t.rows) { const r = rowFromTable(t.header, cells, file); if (r.row) rows.push(r.row); else dropped.push(r.dropped); }
  return { rows, dropped };
}

// rows already in the C3 shape (an agent wrote them): validated and normalised the same way
export function normaliseCandidate(c, file = "competitors-candidates.json") {
  if (!c || typeof c !== "object") return { dropped: { name: "(not an object)", why: "a row must be an object" } };
  const domain = c.domain ? domainOf(String(c.domain)) : null, handle = c.handle ? (String(c.handle).startsWith("@") ? String(c.handle) : "@" + c.handle) : null;
  const name = String(c.name || domain || handle || "").trim();
  if (!name || (!domain && !handle)) return { dropped: { name: name || "(no name)", why: "no domain and no handle" } };
  const closeOk = Number.isInteger(c.closeness) && c.closeness >= 1 && c.closeness <= 5;
  const url = typeof c.evidenceUrl === "string" && /^https?:\/\//i.test(c.evidenceUrl.trim()) ? c.evidenceUrl.trim() : null;
  const platform = PLATFORMS.includes(c.platform) ? c.platform : platformOf({ handle, domain, url });
  const kind = KINDS.includes(c.kind) ? c.kind : "other";
  return { row: { name, domain, handle, platform, kind, evidenceUrl: url, closeness: closeOk ? c.closeness : 3, note: [c.note && String(c.note).slice(0, 200), !KINDS.includes(c.kind) ? `kind "${c.kind ?? ""}" is not one of ${KINDS.join("|")}: set to other` : null, !closeOk ? "closeness defaulted" : null, `from ${file}`].filter(Boolean).join("; ") } };
}

// the same account or site in two files is one row; the first file wins
export function mergeRows(rows) {
  const seen = new Map(), out = [];
  for (const r of rows) {
    const k = `${r.platform}|${String(r.handle || r.domain).toLowerCase()}`;
    const first = seen.get(k);
    if (!first) { seen.set(k, r); out.push(r); continue; }
    first.note += `; also listed in ${(r.note.match(/from (\S+)$/) || [])[1] || "another file"} as ${r.kind}, closeness ${r.closeness}`;
    if (!first.evidenceUrl && r.evidenceUrl) first.evidenceUrl = r.evidenceUrl;
  }
  return out;
}

export function brief(ctx, outFile) {
  const b = ctx.business;
  return [
    `Competitor discovery is the main session's job (scripts never search). Nothing to read yet: no inputs/competitors-*.md and no research/competitors-candidates.json under ${ctx.pewp}.`,
    b ? `The business: ${b.name} (${b.kind}). Offer: ${b.offer}.${b.notOffer ? ` NOT: ${b.notOffer}.` : ""}${b.vocabulary?.length ? ` Its own words: ${b.vocabulary.join(", ")}.` : ""}` : `No business.json yet: run intake first so the search is aimed at the right business.`,
    ``,
    `Search EVERY kind, in this order, and write the answers as markdown tables in ${path.join(ctx.pewp, "inputs")}/competitors-<group>.md (a Domain or a Handle column, a Closeness column 1 to 5, one source URL in each row), or as ${path.join(ctx.rdir, "competitors-candidates.json")}:`,
    `  1. websites that rank for the business's searches and publish the same kind of thing (publisher)`,
    `  2. social accounts that do the same: Instagram, TikTok, YouTube, Substack and other newsletters (social-curator). Social accounts are competitors too; they are not optional.`,
    `  3. paid media and listing portals that sell the same exposure (paid-media)`,
    `  4. agencies and resellers that sell the same bundle as a service (agency)`,
    `  5. brokerage programs and design-led brokers that market the same thing (brokerage-program, design-broker)`,
    ``,
    `Shape of each row: { name, domain|null, handle|null, platform: ${PLATFORMS.join("|")}, kind: ${KINDS.join("|")}, evidenceUrl, closeness: 1..5, note }.`,
    `One evidence URL per row (a page that shows the competitor does this). A row with no URL is kept but the owner cannot approve the list until it has one.`,
    `Then run: node competitors-discover.mjs <target> ; it writes ${outFile} (and .md). The owner reads the table and approves: node approve.mjs <target> competitors --by "<owner name>".`,
  ].join("\n");
}

export function table(doc) {
  const esc = (s) => String(s ?? "").replace(/\|/g, "\\|");
  const L = [`# Competitors proposed for ${doc.business || "the business"} (${doc.generatedAt.slice(0, 10)})`, "",
    `${doc.rows.length} rows from ${doc.source.length ? doc.source.join(", ") : "no file"}. Closeness 5 = nearest. Read it, strike out what is wrong, then approve: ${"`"}node approve.mjs <target> competitors --by "<owner name>"${"`"}.`, ""];
  if (doc.needsEvidence.length) L.push(`**Needs an evidence URL before it can be approved (${doc.needsEvidence.length}):** ${doc.needsEvidence.join("; ")}`, "");
  if (doc.dropped.length) L.push(`Left out (nobody to track): ${doc.dropped.map((d) => `${d.name} (${d.why})`).join("; ")}`, "");
  L.push("| # | Name | Where | Kind | Closeness | Evidence |", "|---|---|---|---|---|---|");
  doc.rows.forEach((r, i) => L.push(`| ${i + 1} | ${esc(r.name)} | ${esc([r.handle, r.domain].filter(Boolean).join(" · ") + ` (${r.platform})`)} | ${r.kind} | ${r.closeness} | ${r.evidenceUrl ? esc(r.evidenceUrl) : "**none**"} |`));
  return L.join("\n") + "\n";
}

// the step: returns { status:"written", doc, files } or { status:"nothing", brief }
export function run(ctx, { candidatesFile = null } = {}) {
  const inputsDir = path.join(ctx.pewp, "inputs"), outJson = path.join(ctx.rdir, "competitors-proposed.json"), outMd = path.join(ctx.rdir, "competitors-proposed.md");
  const mds = fs.existsSync(inputsDir) ? fs.readdirSync(inputsDir).filter((f) => /^competitors-.+\.md$/i.test(f)).sort() : [];
  const candFile = candidatesFile ? path.resolve(candidatesFile) : path.join(ctx.rdir, "competitors-candidates.json");
  const hasCand = fs.existsSync(candFile);
  if (!mds.length && !hasCand) return { status: "nothing", brief: brief(ctx, outJson) };
  const rows = [], dropped = [], source = [], perFile = {};
  for (const f of mds) {
    const r = parseCompetitorsMd(fs.readFileSync(path.join(inputsDir, f), "utf8"), `inputs/${f}`);
    rows.push(...r.rows); dropped.push(...r.dropped); source.push(`inputs/${f}`); perFile[`inputs/${f}`] = r.rows.length;
  }
  if (hasCand) {
    const j = J(candFile, undefined), list = Array.isArray(j) ? j : Array.isArray(j?.rows) ? j.rows : null;
    if (!list) throw new Error(`${candFile} is not a list of rows (an array, or {"rows":[...]}): fix it, then run again`);
    const rel = path.isAbsolute(candidatesFile || "") ? candFile : `research/${path.basename(candFile)}`;
    for (const c of list) { const r = normaliseCandidate(c, path.basename(candFile)); if (r.row) rows.push(r.row); else dropped.push(r.dropped); }
    source.push(rel); perFile[rel] = list.length;
  }
  const merged = mergeRows(rows).sort((a, b) => b.closeness - a.closeness); // stable: file order within a closeness
  const doc = { step: "competitors-discover", generatedAt: iso(), business: ctx.domain || null, source, rows: merged, needsEvidence: merged.filter((r) => !r.evidenceUrl).map((r) => r.name), dropped, readPerFile: perFile };
  W(outJson, doc);
  W(outMd, table(doc));
  return { status: "written", doc, files: [outJson, outMd] };
}

await runCli(import.meta.url, "node competitors-discover.mjs <target> [--cwd DIR] [--candidates FILE.json] [--pewp DIR]", [], async (a) => {
  let ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  if (a.get("pewp")) { // --pewp names the state folder directly (like approve.mjs)
    const pewp = path.resolve(a.get("pewp")), business = J(path.join(pewp, "business.json"));
    ctx = { ...ctx, pewp, rdir: path.join(pewp, "research"), business, domain: business?.domain || ctx.domain };
  }
  const r = run(ctx, { candidatesFile: a.get("candidates") });
  if (r.status === "nothing") { console.log(r.brief); console.log(`BLOCKED: no competitor files to read. The main session runs the discovery above, saves the answers, then runs this again.`); process.exitCode = 3; return; }
  const d = r.doc;
  const by = {}; for (const x of d.rows) by[x.kind] = (by[x.kind] || 0) + 1;
  console.log(`WROTE ${r.files[0]}`);
  console.log(`  ${d.rows.length} rows (${Object.entries(by).map(([k, n]) => `${k} ${n}`).join(", ")}); ${d.rows.filter((x) => x.domain).length} with a domain (fed to the link comparison), ${d.rows.filter((x) => !x.domain).length} without (kept for the report and the offsite plan)`);
  for (const [f, n] of Object.entries(d.readPerFile)) console.log(`  read ${f}: ${n} rows`);
  if (d.dropped.length) console.log(`  left out ${d.dropped.length}: ${d.dropped.map((x) => x.name).join("; ")}`);
  if (d.needsEvidence.length) console.log(`NEEDS EVIDENCE ${d.needsEvidence.length}: ${d.needsEvidence.join("; ")}. approve.mjs competitors refuses until each has a URL.`);
  console.log(`Next: the owner reads ${r.files[1]} and approves: node approve.mjs ${a._[0]} competitors --by "<owner name>"`);
});
