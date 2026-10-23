// Reuse research that already exists (UPGRADE-PROMPT review item 6): import keyword maps, question banks, entity tables, competitor
// audits and the location of saved SERP/AI captures, each with its own date, so the stage fetches only what is missing or stale.
// Usage: node research-existing.mjs <target> [--dir DIR]... [--max-age-days 30] [--cwd DIR]
// Without --dir it looks in the target repo: icm/knowledge/seo, icm/knowledge/market, docs/research, research, <pewp>/inputs/existing.
// Understood (by content, not only by name):
//   *.md  with front matter (`updated:`, `status:`) and tables whose header has a Keyword / Question / Fact column
//         (this project's icm/knowledge/seo/keywords.md, question-bank.md, entities.md)
//   *.json  an audit written by tools/seo-kit/audit.mjs ({date, results:[{input, page, schema, ...}]})
//   folders of *.google.md / *.bing.md (SERP captures) and AI-*.<engine>.md (AI answers): reported as dirs for the capture importers
// Imported numbers keep their source file and date. A volume the old file says was NOT MEASURED stays null: nothing is filled in.
// Output: research/existing.json. Nothing found => BLOCKED (exit 3) for the CLI; research.mjs treats that as "nothing to reuse".
import fs from "node:fs";
import path from "node:path";
import { Blocked, J, stripBom, ageDays, context, needBusiness, runCli, writeStep, writeBlocked, factor, notMeasured, normQuery, domainOf, knownPlaces, expandTemplate, hasPlaceholder } from "./research-lib.mjs";
import { summarise } from "./research-competitors.mjs";

const DEFAULT_DIRS = ["icm/knowledge/seo", "icm/knowledge/market", "docs/research", "research"];
const walk = (d, depth = 0) => (!fs.existsSync(d) || depth > 3 ? [] : fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name.startsWith(".git") ? [] : walk(path.join(d, e.name), depth + 1)) : [path.join(d, e.name)])));

// Knowledge files come out of git as CRLF on this machine (core.autocrlf=true) and some editors add a BOM: read both as plain LF.
const lf = (text) => stripBom(String(text)).replace(/\r\n?/g, "\n");
export function frontMatter(text) {
  const m = lf(text).match(/^---\n([\s\S]*?)\n---/);
  const o = {}; if (m) for (const l of m[1].split("\n")) { const k = l.match(/^([a-z_]+):\s*(.*)$/i); if (k) o[k[1].toLowerCase()] = k[2].trim(); }
  return o;
}
export function tables(text) {
  const lines = text.replace(/\r/g, "").split("\n"), out = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) continue;
    const cells = (l) => l.trim().replace(/^\||\|$/g, "").replace(/\\\|/g, "\u0001").split("|").map((c) => c.replace(/\u0001/g, "|").trim());
    const head = cells(lines[i]).map((h) => h.toLowerCase()); const rows = [];
    let j = i + 2; for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) rows.push({ line: j + 1, cells: cells(lines[j]) });
    out.push({ head, rows, start: i + 1 }); i = j;
  }
  return out;
}
const colOf = (head, re) => head.findIndex((h) => re.test(h));

// A knowledge file can cover TWO businesses (this project's keyword map and question bank do). Section headings say whose a section is:
// "(Francine)", "(Eli; also Francine's /cash-offer)", "Eli's own area", or a legend letter "(F)" defined by "F = Francine, E = Eli, B = both".
// partyTags() reads those names; sectionVerdict() decides what to do with the rows under the heading.
const NOT_A_PARTY = new Set("google bing zillow yelp facebook reddit chatgpt gemini openai copilot".split(" "));
export function legendOf(text) {
  const legend = {};
  for (const m of text.matchAll(/\b([A-Z]) = ([A-Za-z]+)/g)) legend[m[1]] = m[2];
  return legend;
}
export function partyTags(heading, legend = {}) {
  const tags = new Set(), add = (t) => { const n = legend[t] ?? t; if (n && !NOT_A_PARTY.has(n.toLowerCase())) tags.add(n); };
  for (const m of heading.matchAll(/\(([^)]*)\)/g)) {
    for (const part of m[1].split(/[;,]/)) { // "(Eli; also Francine's ...)", "(E, F)": each part that is one bare name (or one legend letter) is a party
      const one = part.trim().match(/^([A-Z][a-z]{2,}|[A-Z])$/);
      if (one && (one[1].length > 1 || legend[one[1]])) add(one[1]);
    }
  }
  for (const m of heading.matchAll(/\b([A-Z][a-z]{2,})'s\b/g)) add(m[1]);
  return [...tags];
}
export function sectionsOf(text) {
  const legend = legendOf(text), lines = text.replace(/\r/g, "").split("\n"), stack = [], out = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(#{1,6})\s+(.*)$/); if (!m) return;
    const level = m[1].length; while (stack.length && stack.at(-1).level >= level) stack.pop();
    const own = partyTags(m[2], legend), tags = own.length ? own : stack.at(-1)?.tags || [];
    stack.push({ level, tags }); out.push({ line: i + 1, title: m[2].replace(/\*\*/g, "").slice(0, 120), tags });
  });
  return { legend, sections: out };
}
// -> { act: "import" | "shared" | "refuse", sharedWith: [...], tags }
export function sectionVerdict(tags, isTarget, legend = {}) {
  if (!tags.length) return { act: "import", sharedWith: [], tags };
  const both = tags.some((t) => /^both$/i.test(t));
  const mine = tags.filter((t) => !/^both$/i.test(t) && isTarget(t)), others = tags.filter((t) => !/^both$/i.test(t) && !isTarget(t));
  if (both) return { act: "shared", sharedWith: others.length ? others : ["another business"], tags };
  if (mine.length && others.length) return { act: "shared", sharedWith: others, tags };
  if (mine.length) return { act: "import", sharedWith: [], tags };
  return { act: "refuse", sharedWith: [], tags };
}

// The free demand signal this project recorded for every keyword (icm/knowledge/seo/keywords.md): the Bing autocomplete tier.
// T1 = the typed phrase comes back as a suggestion (people type it), T2 = only related/broader phrases come back, T0 = not tested
// on autocomplete, so the only evidence is what the results page showed (map pack, People Also Ask). Never a search count:
// a sourced ESTIMATE whose value is the tier label, with a numeric rank (T1 3 > T2 2 > T0 1) so clusters can be ordered.
export const TIER_RANK = { T1: 3, T2: 2, T0: 1 };
export function tierVolume(cell, file, st, line) {
  const all = [...String(cell || "").matchAll(/\bT([012])\b/g)].map((m) => `T${m[1]}`);
  if (!/^\s*T[012]\b/.test(String(cell || "")) || !all.length) return null;
  const tier = all.reduce((lo, t) => (TIER_RANK[t] < TIER_RANK[lo] ? t : lo)); // a cell that names several tiers ("T1 for San Jose; T0 for ...") counts at its weakest
  return {
    value: `${tier} (Bing autocomplete tier)`, rank: TIER_RANK[tier], estimate: true,
    source: `${file} (updated ${st.updated}) line ${line}: demand tier from Bing autocomplete (captures/SUGGEST.md, 20 seeds), not a search count`,
    fetchedAt: `${st.updated}T00:00:00.000Z`, cacheFile: file,
    unit: "ordinal demand tier: T1 the typed phrase comes back as a Bing suggestion, T2 only related phrases, T0 not tested (results-page evidence only); rank 3 > 2 > 1",
  };
}

// Knowledge files list where they came from in their front matter ("sources:"). Follow those paths (searching upward from the file for
// the repo root) to find the saved SERP captures, AI answers and audit JSON they were built from.
function followSources(file, text, found) {
  const fm = lf(text).match(/^---\n([\s\S]*?)\n---/); if (!fm) return;
  const block = (fm[1].match(/^sources:\s*\n((?:[ \t]+-.*(?:\n|$))+)/m) || [])[1] || "";
  const refs = [...block.matchAll(/((?:[\w.\-]+\/)+[^\s`'"),;]*)/g)].map((m) => m[1].split(/[<*]/)[0]).filter((r) => r.includes("/"));
  const resolveUp = (rel) => { for (let d = path.dirname(file), i = 0; i < 8; i++, d = path.dirname(d)) { const c = path.join(d, rel); if (fs.existsSync(c)) return c; } return null; };
  const bases = new Set();
  const add = (hit0, ref) => { const hit = path.resolve(hit0); const st = fs.statSync(hit); const base = st.isDirectory() ? hit : path.dirname(hit); bases.add(base); found.refs.push({ knowledgeFile: file, ref, resolved: hit }); if (!st.isDirectory() && /\.json$/i.test(hit)) found.json.add(hit); };
  const rest = [];
  for (const ref of refs) { const hit = resolveUp(ref); if (hit) add(hit, ref); else rest.push(ref); }
  for (const b0 of [...bases]) bases.add(path.dirname(b0)); // sibling folders (fresh/, ai-answers/) hang off the parent of the folder a source lives in
  for (const ref of rest) for (const b of [...bases]) { const hit = path.join(b, ref); if (fs.existsSync(hit)) add(hit, ref); } // "fresh/*.google.md" is relative to the folder the other sources live in
  for (const b of bases) for (const d of [b, ...fs.readdirSync(b, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(b, e.name))]) {
    let names = []; try { names = fs.readdirSync(d); } catch {}
    for (const n of names) if (/audit.*\.json$/i.test(n)) found.json.add(path.join(d, n)); // a seo-kit audit next to the sources
    if (names.some((n) => /\.(google|bing)\.md$/i.test(n))) found.serp.add(d);
    if (names.some((n) => /^AI-.*\.(chatgpt|gemini|perplexity|copilot)\.md$/i.test(n))) found.ai.add(d);
  }
}

// Whose research may this be? A URL target reads ONLY the folders it is given (--dir) and <pewp>/inputs/existing; it never looks at the current folder.
// A repo target reads the default research folders INSIDE that repo. Every imported file must name the business (its domain, its name or an alias)
// or sit under the target; anything else is refused and listed, so one client's keyword map can never end up in another client's research.
export async function run(ctx, { dirs = [], maxAgeDays = 30, aliases = [] } = {}) {
  const biz = needBusiness(ctx);
  const inputs = path.join(ctx.pewp, "inputs", "existing");
  const defaults = ctx.loc.kind === "repo" ? [...DEFAULT_DIRS.map((d) => path.join(ctx.loc.root, d)), inputs] : [inputs];
  const roots = [...(dirs.length ? dirs : defaults)].filter((d) => fs.existsSync(d));
  const owned = [ctx.loc.kind === "repo" ? ctx.loc.root : null, inputs].filter(Boolean);
  const ids = [biz.domain, biz.name, ...aliases].filter(Boolean).map((s) => String(s).toLowerCase());
  const under = (f, d) => { const r = path.relative(d, f); return !!r && !r.startsWith("..") && !path.isAbsolute(r); };
  const textOf = (f) => { try { return fs.readFileSync(f, "utf8").slice(0, 2e6).toLowerCase(); } catch { return ""; } };
  const namesUs = (f) => owned.some((d) => under(f, d)) || ids.some((i) => textOf(f).includes(i));
  const refused = [], refusedDirs = new Set();
  const dirNamesUs = (d) => owned.some((o) => under(d, o)) || (() => { try { return fs.readdirSync(d).slice(0, 12).some((n) => { const p = path.join(d, n); return fs.statSync(p).isFile() && namesUs(p); }); } catch { return false; } })();
  const dirOk = (d) => { if (dirNamesUs(d)) return true; if (!refusedDirs.has(d)) { refusedDirs.add(d); refused.push({ file: d, why: `a capture folder none of whose files names ${biz.domain}, ${biz.name} or an alias, and not under the target` }); } return false; };
  if (dirs.length && dirs.some((d) => !fs.existsSync(d))) throw new Blocked(`--dir ${dirs.find((d) => !fs.existsSync(d))} does not exist`);
  const files = [], keywords = [], questions = [], entities = [], competitorAudits = {}, serpDirs = new Set(), aiDirs = new Set();
  const stamp = (file, fm) => { const updated = (fm.updated || fm.date || "").slice(0, 10) || fs.statSync(file).mtime.toISOString().slice(0, 10); return { updated, ageDays: Math.round(ageDays(updated) * 10) / 10, stale: ageDays(updated) > maxAgeDays, status: fm.status || null }; };
  const cities = knownPlaces(ctx.business).map((p) => p.city), dropped = []; // service-area cities fill {city} templates
  const found = { refs: [], serp: new Set(), ai: new Set(), json: new Set() };
  const isCapture = (f) => /\.(google|bing)\.md$|^AI-.*\.(chatgpt|gemini|perplexity|copilot)\.md$/i.test(path.basename(f));
  const own = roots.flatMap((root) => walk(root)).filter((f) => isCapture(f) || namesUs(f) || (refused.push({ file: f, why: `does not name ${biz.domain}, ${biz.name} or an alias, and is not under the target` }), false));
  for (const file of own) if (/\.md$/i.test(file) && !/\.(google|bing)\.md$/i.test(file)) { try { followSources(file, fs.readFileSync(file, "utf8"), found); } catch {} }
  const extraJson = [...found.json].filter((f) => !own.includes(f) && (namesUs(f) || (refused.push({ file: f, why: `named in a sources: list but does not name ${biz.domain}, ${biz.name} or an alias` }), false)));
  for (const d of found.serp) if (dirOk(d)) serpDirs.add(d);
  for (const d of found.ai) if (dirOk(d)) aiDirs.add(d);
  for (const file of [...own, ...extraJson]) {
    const base = path.basename(file);
    if (/\.(google|bing)\.md$/i.test(base)) { if (dirOk(path.dirname(file))) serpDirs.add(path.dirname(file)); continue; }
    if (/^AI-.*\.(chatgpt|gemini|perplexity|copilot)\.md$/i.test(base)) { if (dirOk(path.dirname(file))) aiDirs.add(path.dirname(file)); continue; }
    if (/\.md$/i.test(base)) {
      const text = fs.readFileSync(file, "utf8"), fm = frontMatter(text), st = stamp(file, fm);
      const ntext = /NOT MEASURED/i.test(text) ? "the file states volumes are NOT MEASURED" : null;
      let kinds = [];
      const secInfo = sectionsOf(text), isTarget = (n) => ids.some((i) => i.includes(n.toLowerCase()) || n.toLowerCase().includes(i));
      const refusedSecs = new Set();
      for (const t of tables(text)) {
        const sec = [...secInfo.sections].reverse().find((s) => s.line < t.start) || null; // the heading this table sits under
        const verdict = sec ? sectionVerdict(sec.tags, isTarget, secInfo.legend) : { act: "import", sharedWith: [], tags: [] };
        if (verdict.act === "refuse") { if (!refusedSecs.has(sec.line)) { refusedSecs.add(sec.line); refused.push({ file, section: sec.title, line: sec.line, why: `section names only another business (${verdict.tags.join(", ")}), not ${biz.name}: refused` }); } continue; }
        const shared = verdict.act === "shared" ? { sharedWith: verdict.sharedWith, section: sec.title } : sec ? { section: sec.title } : {};
        const ki = colOf(t.head, /^keyword\b/), qi = colOf(t.head, /^question$/), fi = colOf(t.head, /^fact$/);
        const ci = colOf(t.head, /^(city|place)\b/), di = colOf(t.head, /difficulty/), mi = colOf(t.head, /demand/), si = colOf(t.head, /seen at|source/), ii = colOf(t.head, /intent/);
        for (const r of t.rows) {
          const src = { file, line: r.line, updated: st.updated, status: st.status };
          if (ki >= 0 && r.cells[ki]) {
            const volume = tierVolume(mi >= 0 ? r.cells[mi] : "", file, st, r.line) || { ...notMeasured(ntext || "the imported keyword map carries no search volume"), cacheFile: file };
            const cityCell = ci >= 0 ? r.cells[ci] || "" : "";
            // one row can stand for a pattern: "home value {city} ca" with the cities listed in the City cell -> one keyword per city, same tier
            const listed = cityCell.split(",").map((c) => c.replace(/\(.*?\)/g, "").trim()).filter(Boolean), cs = listed.length ? listed : cities;
            const queries = /\{city\}/i.test(r.cells[ki]) ? expandTemplate(r.cells[ki], cs).map((q, k) => ({ query: normQuery(q), location: cs[k] })) : hasPlaceholder(r.cells[ki]) ? [] : [{ query: normQuery(r.cells[ki]), location: cityCell || null }];
            if (!queries.length) dropped.push({ kind: "keyword", text: r.cells[ki], file, line: r.line, why: /\{city\}/i.test(r.cells[ki]) ? "no city to fill {city} (empty City cell and no service-area city in business.json)" : "a placeholder other than {city}" });
            for (const q of queries) { keywords.push({ query: q.query, location: q.location, difficultyNote: di >= 0 ? r.cells[di].slice(0, 300) : null, demandNote: mi >= 0 ? r.cells[mi].slice(0, 200) : null, volume, ...shared, imported: src }); kinds.push("keywords"); }
          }
          else if (qi >= 0 && r.cells[qi]) {
            const texts = expandTemplate(r.cells[qi], cities); // "How is the housing market in {city}?" -> one question per service-area city
            if (!texts.length) dropped.push({ kind: "question", text: r.cells[qi], file, line: r.line, why: /\{city\}/i.test(r.cells[qi]) ? "no service-area city in business.json to fill {city}" : "a placeholder other than {city}" });
            texts.forEach((q, k) => { questions.push({ question: q, city: /\{city\}/i.test(r.cells[qi]) ? cities[k] : ci >= 0 ? r.cells[ci] : null, intent: ii >= 0 ? r.cells[ii] : null, seenAt: si >= 0 ? r.cells[si] : null, ...shared, imported: src }); kinds.push("questions"); });
          }
          else if (fi >= 0 && r.cells[fi]) { entities.push({ fact: r.cells[fi], known: r.cells[colOf(t.head, /known/)] ?? null, sourceOfTruth: r.cells[colOf(t.head, /source of truth/)] ?? null, consistent: r.cells[colOf(t.head, /consistent/)] ?? null, imported: src }); kinds.push("entities"); }
        }
      }
      if (kinds.length) files.push({ file, kind: [...new Set(kinds)].join("+"), rows: kinds.length, ...st });
      continue;
    }
    if (/\.json$/i.test(base) && fs.statSync(file).size < 40e6) {
      const j = J(file);
      if (j && Array.isArray(j.results) && j.results.some((r) => r?.input)) {
        const when = String(j.date || "").slice(0, 10) || fs.statSync(file).mtime.toISOString().slice(0, 10), st = stamp(file, { updated: when });
        let n = 0;
        for (const r of j.results) {
          if (!r?.input || !(r.page || r.error)) continue;
          const d = domainOf(r.finalUrl || r.input);
          const f = factor(`seo-kit audit.mjs run of ${when} (imported from ${base})`, `${when}T00:00:00.000Z`, file);
          competitorAudits[d] = { domain: d, ...r, fetchedAt: `${when}T00:00:00.000Z`, facts: summarise(r, f), importedFrom: file, ageDays: st.ageDays };
          n++;
        }
        if (n) files.push({ file, kind: "competitor-audit", rows: n, ...st });
      }
    }
  }
  if (!files.length && !serpDirs.size && !aiDirs.size && !refused.length) { const m = `no existing research found in ${roots.join(", ") || "any default folder"}: nothing to reuse (not an error for research.mjs); pass --dir <folder> if it lives elsewhere`; writeBlocked(ctx, "existing", m); throw new Blocked(m); }
  return writeStep(ctx, "existing", { roots, maxAgeDays, files, keywords, questions, entities, competitorAudits, refused, droppedTemplates: dropped, serpDirs: [...serpDirs], aiDirs: [...aiDirs], discoveredVia: found.refs.filter((r) => [...found.serp, ...found.ai].some((d) => r.resolved === d || r.resolved.startsWith(d + path.sep) || path.dirname(r.resolved) === path.dirname(d) || d.startsWith(path.dirname(r.resolved)))).slice(0, 40), sharedRows: keywords.filter((x) => x.sharedWith).length, tierEstimateRows: keywords.filter((x) => x.volume.rank).length, freshKeywordRows: keywords.filter((x) => ageDays(x.imported.updated) <= maxAgeDays).length });
}

await runCli(import.meta.url, "node research-existing.mjs <target> [--dir DIR]... [--alias NAME]... [--max-age-days 30] [--cwd DIR]", [], async (a) => {
  const ctx = context(a._[0], { cwd: a.get("cwd") || process.cwd() });
  const r = await run(ctx, { dirs: a.all("dir").map((d) => path.resolve(d)), maxAgeDays: a.num("max-age-days", 30), aliases: a.all("alias") });
  return `OK existing: ${r.files.length} files (${r.keywords.length} keyword rows, ${r.questions.length} questions, ${r.entities.length} entity facts, ${Object.keys(r.competitorAudits).length} competitor audits); SERP capture dirs: ${r.serpDirs.length}, AI answer dirs: ${r.aiDirs.length}; stale (> ${r.maxAgeDays} d): ${r.files.filter((f) => f.stale).length}; refused (does not name this business): ${r.refused.length}${r.refused.slice(0, 5).map((x) => `\n  refused ${x.file}: ${x.why}`).join("")}\n  ->${path.join(ctx.rdir, "existing.json")}`;
});
