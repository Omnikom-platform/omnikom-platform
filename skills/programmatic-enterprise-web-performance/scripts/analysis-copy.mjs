// Usage: node scripts/analysis-copy.mjs <url or profile:slug> --pewp <the run's .pewp folder> --out <folder> [--words <folder>] [--assets <folder>] [--book <file>]
// The client's report of 6 to 8 pages, printed from the judge's analysis (AB-8, parts AU.S-4 and AU.D-47): <stem>.html and numbers-<date>.tsv, the stem always ending
// -draft (a final copy needs a sign-off, which is another job). Reads only: <pewp>/analysis.json, analysis.checked.json, analysis.sheet.json and profile.json (and
// internal/not-gathered.json when there is one), --words (default client-copy/ of the skill: fixes.json, how-we-work.json, backing.json), --assets (default
// assets/client-copy/) and --book (default docs/product/1-product.md of the repository). Pages: the cover, the summary, one page for each section of the analysis
// packed onto pages by their size in lines (analysis-shape.mjs: a page is about 40 lines; sections that fit share a page; at least 2 analysis pages at least half
// full are needed; a page with little on it is set larger, class roomy), the plan, the last page; the title says only what the sections held (SEO, AI search, local; AB-8b); a business with a site and one with none are built the same way. Every pointer is filled from its row of the sheet, every value and
// every text is escaped for html. Starts no model, no browser, makes no network request. Nothing is written before every gate of client-copy-gates.mjs has passed.
// Exit 0 built; 1 a STOP (one line on stderr, nothing written); 2 a usage fault (one line).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { locate } from "./state.mjs";
import { stop, fmt } from "./client-copy-data.mjs";
import { CSS } from "./client-copy-design.mjs";
import { gates, visible } from "./client-copy-gates.mjs";
import { checkShape, pagesOf, fullPages, HALF_LINES, MIN_PAGES } from "./analysis-shape.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(here, "..");
// what each of the three lines of what is in the draft rests on: the keys of backing.json whose product book rows must all read WORKS
const LINE_KEYS = [["pages"], ["firstVisit"], ["forms", "crm", "alert"]];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const TOPIC_LABEL = { site: "Your website", demand: "What buyers search for", search: "Found in search", assistants: "Named in AI answers", local: "Seen on the map", rivals: "What rivals do", standing: "Who links to you" };
const isText = (v) => typeof v === "string" && v.trim() !== "";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const DASHES = new RegExp("[" + String.fromCharCode(8212, 8211) + "]", "g");
const plain = (s) => String(s).replace(DASHES, "-"); // a value read from the run: a dash becomes "-" (the dash gate stops any other)
const escRe = (s) => s.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
const SEO_TOPICS = ["site", "demand", "search", "rivals", "standing"];
// our own words never reach a client's page: a page that holds one of these (case ignored, white space squeezed) is refused before the gates
const OUR_WORDS = ["first response", "words sent", "sends its words"];

/** The title of the report says only what was read: SEO for a section of one of the five topics, AI search for the assistants, local for the local one. */
export function titleOf(topics) {
  const parts = [];
  if (topics.some((t) => SEO_TOPICS.includes(t))) parts.push("SEO");
  if (topics.includes("assistants")) parts.push("AI search");
  if (topics.includes("local")) parts.push("local");
  if (!parts.length) return stop("STOP: no section of the analysis gives the report a title");
  const joined = parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0];
  return joined[0].toUpperCase() + joined.slice(1) + " audit";
}
const ourWords = (html) => {
  const re = new RegExp(OUR_WORDS.map(escRe).join("|"), "i");
  (html.match(/<section\b[\s\S]*?<\/section>/g) || []).forEach((s, i) => { const m = re.exec(visible(s)); if (m) stop(`STOP: gate our words: page ${i + 1} prints "${m[0]}"`); });
};

/** The old data layer's rule for a line of what is in the draft: { key: true } when every product book row the key names reads WORKS. */
export function draftRowsWork(backing, book) {
  const out = {};
  for (const [k, ids] of Object.entries(backing)) {
    out[k] = ids.every((id) => {
      const m = String(book).match(new RegExp("^\\| " + escRe(String(id)) + " [^|]*\\| ([A-Z]+) \\|", "m"));
      const state = m ? m[1] : undefined;
      return state === "WORKS";
    });
  }
  return out;
}

const readJson = (dir, file, what) => {
  const p = path.join(dir, file);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) stop("STOP: " + file + " is missing" + (what ? " (" + what + ")" : ""));
  try { return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, "")); } catch { return stop("STOP: " + file + " is not JSON"); }
};
/** Every pointer of the analysis with the path it stands in, as analysis-check.mjs names the path. */
const pointersOf = (v, at, out = []) => {
  if (typeof v === "string") for (const m of v.matchAll(/\{\{([^{}]*)\}\}/g)) out.push([at, m[1]]);
  else if (Array.isArray(v)) v.forEach((x, i) => pointersOf(x, at + "[" + i + "]", out));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) pointersOf(x, at + (/^[A-Za-z_]\w*$/.test(k) ? "." + k : "[" + JSON.stringify(k) + "]"), out);
  return out;
};
const joinAnd = (xs) => (xs.length > 1 ? xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1] : xs[0]);

/** Reads everything, builds the pages and runs the gates; returns { html, tsv, name, date, pages }. Writes nothing. */
export function build({ pewp, name, wordsDir, assetsDir, bookAbs }) {
  // ---- the words that are data, the assets
  const std = readJson(wordsDir, "how-we-work.json");
  for (const k of ["goAhead", "promise"]) if (!isText(std[k])) stop("STOP: how-we-work.json has no " + k);
  const contact = isText(std.contact) ? std.contact.trim() : ""; // the one address of the last page; with none, the last page has no box
  if (!Array.isArray(std.draftContainsPlain) || std.draftContainsPlain.length !== 3 || !std.draftContainsPlain.every(isText)) stop("STOP: how-we-work.json has no draftContainsPlain as a list of 3 texts");
  if (!Array.isArray(std.nextSteps) || std.nextSteps.length !== 4 || !std.nextSteps.every((s) => Array.isArray(s) && s.length === 3 && s.every(isText))) stop("STOP: how-we-work.json has no nextSteps as 4 of [label, title, text]");
  const fixes = readJson(wordsDir, "fixes.json");
  if (!Array.isArray(fixes) || !fixes.length || !fixes.every((f) => f && isText(f.id) && isText(f.fix) && isText(f.who))) stop("STOP: fixes.json is not a list of { id, fix, who }");
  const fixById = new Map(fixes.map((f) => [f.id, f]));
  const backing = readJson(wordsDir, "backing.json");
  if (!isObj(backing) || !Object.values(backing).every((v) => Array.isArray(v))) stop("STOP: backing.json is not an object of lists");
  if (!fs.existsSync(bookAbs) || !fs.statSync(bookAbs).isFile()) stop("STOP: the product book is missing");
  const logoFile = path.join(assetsDir, "omnikom-logo-full.png"), cssFile = path.join(assetsDir, "fonts", "fonts.css");
  if (!fs.existsSync(logoFile)) stop("STOP: assets omnikom-logo-full.png is missing");
  if (!fs.existsSync(cssFile)) stop("STOP: assets fonts/fonts.css is missing");
  for (const m of fs.readFileSync(cssFile, "utf8").matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/g)) if (!/^(data:|https?:)/.test(m[1]) && !fs.existsSync(path.join(assetsDir, "fonts", m[1]))) stop("STOP: assets fonts/" + m[1] + " is missing");
  const logoUrl = pathToFileURL(logoFile).href;

  // ---- the analysis: all four files there, checked after it was written, in its shape, every pointer with its row
  const analysis = readJson(pewp, "analysis.json");
  const checked = readJson(pewp, "analysis.checked.json");
  const sheetFile = readJson(pewp, "analysis.sheet.json");
  const profile = readJson(pewp, "profile.json");
  const mt = (f) => fs.statSync(path.join(pewp, f)).mtimeMs;
  const stale = mt("analysis.checked.json") < mt("analysis.json") || mt("analysis.sheet.json") < mt("analysis.json");
  if (stale) stop("STOP: the analysis was not checked after it was written");
  if (!isObj(analysis) || !isObj(checked) || !isObj(sheetFile) || !Array.isArray(sheetFile.rows) || !isObj(profile)) stop("STOP: the analysis files are not of the form analysis-check.mjs writes");
  const gatheredStations = (Array.isArray(profile.stations) ? profile.stations : []).filter((st) => (Array.isArray(st?.steps) ? st.steps : []).some((sp) => sp.bucket === "gathered")).map((st) => String(st.id));
  const bad = checkShape(analysis, { gatheredStations, fixIds: fixes.map((f) => f.id), floor: false }); // the floor of pages is stopped on below, in the copy's own words
  if (bad.length) stop("STOP: the analysis has the wrong shape (" + bad[0] + ")");
  const byAt = new Map();
  for (const r of sheetFile.rows) if (r && typeof r.at === "string" && typeof r.pointer === "string" && !byAt.has(r.at + "\u0001" + r.pointer)) byAt.set(r.at + "\u0001" + r.pointer, r);
  for (const [at, ptr] of pointersOf(analysis, "$")) if (!byAt.has(at + "\u0001" + ptr)) stop("STOP: the sheet has no row for " + ptr + " at " + at);
  const gen = profile.generatedAt, when = new Date(gen);
  if (!isText(gen) || Number.isNaN(when.getTime())) stop("STOP: profile.json has no generatedAt");
  const MONTH = MONTHS[when.getUTCMonth()] + " " + when.getUTCFullYear(), date = when.toISOString().slice(0, 10);
  // the sections are packed onto pages by their size; the floor of 2 analysis pages is counted on pages at least half full
  const packed = pagesOf(analysis.sections), full = fullPages(analysis.sections), printed = packed.length;
  if (full < MIN_PAGES) stop("STOP: too little for a client's report: " + full + " analysis page(s) at least half full (it needs " + MIN_PAGES + "); the run stays an internal draft");

  // ---- the pages
  const sheet = [], seen = new Set();
  let page = 0;
  const add = (row) => { const k = row.join("\u0001"); if (!seen.has(k)) { seen.add(k); sheet.push(row); } };
  // F: a text of the analysis with each pointer filled from its sheet row (a number through fmt, a text as it is), everything escaped; one sheet row for each pointer
  const F = (s, at) => String(s).split(/(\{\{[^{}]*\}\})/).map((part) => {
    const m = /^\{\{([^{}]*)\}\}$/.exec(part);
    if (!m) return esc(part);
    const r = byAt.get(at + "\u0001" + m[1]);
    if (!r) return stop("STOP: the sheet has no row for " + m[1] + " at " + at);
    const v = String(r.value), printed = plain(String(Number(v)) === v ? fmt(Number(v)) : v);
    add([page, at, printed, r.file, r.where, v, r.measured, "RUN"]);
    return esc(printed); // @value
  }).join("");
  const rh = () => '<div class="rh"><span class="nm">' + F(analysis.business, "$.business") + "</span><span>" + title + ", " + esc(MONTH) + "</span></div>";
  const rf = (n) => '<div class="rf"><span>Prepared by Omnikom</span><b>' + n + " / @@TOTAL@@</b></div>";
  // a page with little on it (under half of a page's lines) is set larger: class roomy on its inner div (the section keeps class="pg": the page gate of client-copy-gates.mjs counts only that exact form)
  const sheetPage = (n, inner, lines) => { page = n; return '<section class="pg" id="p' + n + '">' + rh() + '<div class="in' + (lines !== undefined && lines < HALF_LINES ? " roomy" : "") + '">' + inner + "</div>" + rf(n) + "</section>"; };
  const head = (label, h, lede) => '<div class="shead"><div class="label">' + label + "</div></div><h2>" + h + "</h2>" + (lede ? '<p class="lede">' + lede + "</p>" : "");
  const { numbers, have, back, sections, plan } = analysis;
  const title = titleOf(sections.map((s) => s.topic));
  const all = [];

  page = 1;
  add([1, "month of the audit", MONTH, "profile.json", "generatedAt", gen, gen, "RUN"]);
  const nums = numbers.map((x, i) => '<div class="num"><b>' + F(x.value, "$.numbers[" + i + "].value") + "</b><span>" + F(x.label, "$.numbers[" + i + "].label") + "</span></div>").join("");
  all.push('<section class="cover" id="p1">\n<img class="logo" src="' + logoUrl + '" alt="Omnikom">\n<div class="title"><p class="caps">Audit</p><h1>' + title + '</h1><p>' + F(analysis.business, "$.business") + "<br>" + esc(MONTH) + "</p></div>\n" +
    '<div class="panel"><p class="caps">What we found</p><p class="lead">' + F(analysis.verdict, "$.verdict") + '</p></div>\n<div class="nums">' + nums + "</div>\n</section>");

  const haveHtml = have.length > 0 ? '<h3 class="m0">What you already have going for you</h3><ul class="have">' + have.map((h, i) => "<li><b>" + (page = 2, F(h.value, "$.have[" + i + "].value")) + "</b><span>" + F(h.text, "$.have[" + i + "].text") + "</span></li>").join("") + "</ul>" : "";
  all.push(sheetPage(2, head("Summary", have.length ? "What works for you today, and what holds you back" : "What holds you back today", "") + haveHtml +
    "<h3" + (have.length ? "" : ' class="m0"') + ">What holds you back</h3><ol class=\"back\">" + back.map((b, i) => "<li><span>" + F(b, "$.back[" + i + "]") + "</span></li>").join("") + "</ol>", 3 + 3 * have.length + 2 * back.length));

  // one section's list of points and its table, every pointer filled
  const bodyOf = (s, at) => '<ul class="draft">' + s.points.map((p, j) => "<li>" + F(p, at + ".points[" + j + "]") + "</li>").join("") + "</ul>" +
    (s.table ? '<div class="mt"><table class="grid"><tr>' + s.table.columns.map((c, j) => "<th>" + F(c, at + ".table.columns[" + j + "]") + "</th>").join("") + "</tr>" +
      s.table.rows.map((row, j) => "<tr>" + row.map((c, k) => "<td>" + F(c, at + ".table.rows[" + j + "][" + k + "]") + "</td>").join("") + "</tr>").join("") + "</table></div>" : "");
  // a page of one section: its topic's label, its title as the page's heading; a page of several: the labels joined, each section with its own title as a heading of the same element and size (h2; the one after another gets space before it)
  const notes = [];
  packed.forEach((pg, n) => {
    page = 3 + n;
    if (pg.sections.length === 1) {
      const i = pg.sections[0], s = sections[i], at = "$.sections[" + i + "]";
      all.push(sheetPage(page, head(TOPIC_LABEL[s.topic], F(s.title, at + ".title"), F(s.lede, at + ".lede")) + bodyOf(s, at), pg.lines));
    } else {
      const label = joinAnd(pg.sections.map((i, k) => (k ? TOPIC_LABEL[sections[i].topic].replace(/^./, (ch) => ch.toLowerCase()) : TOPIC_LABEL[sections[i].topic])));
      all.push(sheetPage(page, '<div class="shead"><div class="label">' + label + "</div></div>" + pg.sections.map((i, k) => {
        const s = sections[i], at = "$.sections[" + i + "]";
        return "<h2>" + F(s.title, at + ".title") + "</h2>" + (s.lede ? '<p class="lede">' + F(s.lede, at + ".lede") + "</p>" : "") + bodyOf(s, at);
      }).join(""), pg.lines));
    }
    if (pg.lines < HALF_LINES) notes.push("page " + page + " is under half full (" + pg.lines + " of 40 lines)");
  });

  page = 3 + printed;
  const planRows = plan.map((p, i) => {
    const fx = fixById.get(p.fix);
    const fixText = fx.fix;
    const who = fx.who;
    add([page, "plan row " + fx.id, fixText, "client-copy/fixes.json", "id=" + fx.id, fixText, "(not dated)", "STANDARD COPY"]);
    return "<tr" + (i === 0 ? ' class="first"' : "") + "><td>" + (i + 1) + "</td><td>" + esc(fixText) + "</td><td>" + F(p.why, "$.plan[" + i + "].why") + "</td><td>" + esc(who) + "</td></tr>";
  }).join("");
  all.push(sheetPage(page, head("Action plan", "What to fix, in this order", "") + '<table class="plan"><tr><th>#</th><th>What to do</th><th>Why</th><th>Who</th></tr>' + planRows + "</table>", 3 + 3 * plan.length));

  // the last page: a line of what is in the draft stands only if every product book row behind it reads WORKS
  page = 4 + printed;
  const works = draftRowsWork(backing, fs.readFileSync(bookAbs, "utf8"));
  for (const k of LINE_KEYS.flat()) if (!(k in works)) stop("STOP: backing.json has no " + k);
  // a line our own product book does not fully back is left out (the report then says less, never more); the run says which, so it is seen
  const stands = LINE_KEYS.map((keys) => keys.every((k) => works[k]));
  const leftOut = LINE_KEYS.map((keys, j) => (stands[j] ? null : "left out of the last page: line " + (j + 1) + " of what is in the draft (the product book rows of " + keys.find((k) => !works[k]) + " do not all read WORKS)")).filter(Boolean);
  std.nextSteps.forEach((s, i) => add([page, "step " + (i + 1) + " title", s[1], "client-copy/how-we-work.json", "nextSteps[" + i + "]", s[1], "(not dated)", "STANDARD COPY"]));
  const steps = std.nextSteps.map((s, i) => '<li><span class="sn">' + (i + 1) + "</span><div><b>" + esc(s[1]) + "</b><p>" + esc(s[2]) + "</p>" + (i === 0 && stands.some(Boolean) ? '<ul class="draft">' + std.draftContainsPlain.filter((_, j) => stands[j]).map((t) => "<li>" + esc(t) + "</li>").join("") + "</ul>" : "") + "</div></li>").join("");
  const rep = '<div class="rep">' + numbers.map((x, i) => "<div><b>" + F(x.value, "$.numbers[" + i + "].value") + "</b><span>" + F(x.label, "$.numbers[" + i + "].label") + "</span></div>").join("") + "</div>";
  // the box "To go ahead" holds the one address of the call (as text and as a mail link); with no address there is no box and the promise is a plain paragraph
  const promise = esc(std.promise.replace("{outcome}", "customers"));
  if (contact) add([page, "contact address", contact, "client-copy/how-we-work.json", "contact", contact, "(not dated)", "STANDARD COPY"]);
  const box = contact
    ? '<div class="goahead"><div><p class="label">To go ahead</p><p class="big">' + esc(std.goAhead) + '</p><p class="note2"><a href="mailto:' + esc(contact) + '">' + esc(contact) + '</a></p></div><div><p class="note2">' + promise + "</p></div></div>"
    : "<p>" + promise + "</p>";
  all.push(sheetPage(page, head("How Omnikom works", "We draft your whole website, you look at it, it goes live, and for " + esc(std.nextSteps[3][1]) + " we keep it in place and report the numbers.", "") +
    '<ol class="steps">' + steps + '</ol><p class="own"><b>Your leads are yours.</b></p><h3>The numbers we report against, as they are today</h3>' + rep +
    box));

  const pages = all.length, total = String(pages);
  const spaced = all.join("\n").replace(/>(?=<(?!\/?(?:i|svg|rect|br)\b))/g, ">\n");
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + F(analysis.business, "$.business") + ": " + title + ", " + esc(MONTH) + ' (draft)</title>\n<link href="' + pathToFileURL(cssFile).href + '" rel="stylesheet"><style>' + CSS + ".goahead a{color:#fff}.pg .in>:not(.shead)+h2{margin-top:20pt}.pg .in.roomy>*:not(.shead):not(h2){zoom:1.3}</style></head><body>\n" + spaced.replace(/@@TOTAL@@/g, total) + "\n</body></html>\n";
  const cell = (x) => plain(String(x).replace(/[\t\r\n]+/g, " "));
  const tsv = [["page", "the text it stands in", "printed", "file", "where in the file", "value there", "measured", "kind"], ...sheet].map((r) => r.map(cell).join("\t")).join("\n") + "\n";
  // the internal sheet of the run (what was not gathered): a page that holds one of its lines is refused
  let internal = [];
  const intFile = path.join(pewp, "internal", "not-gathered.json");
  if (fs.existsSync(intFile)) {
    let ints; try { ints = JSON.parse(fs.readFileSync(intFile, "utf8").replace(/^﻿/, "")); } catch { stop("STOP: internal/not-gathered.json is not JSON"); }
    internal = (Array.isArray(ints?.rows) ? ints.rows : []).map((r) => r?.why).filter((w) => typeof w === "string");
  }
  ourWords(html);
  gates({ html, tsv, pages, logoUrl, internal, title, topics: sections.map((s) => s.topic), contact: contact || undefined });
  const stem = String(name).replace(/[^A-Za-z0-9.-]/g, "-") + "-audit-" + date + "-draft";
  return { html, tsv, pages, date, stem, leftOut, notes };
}

function cli() {
  const usage = (what) => { console.error("analysis-copy: " + what); process.exit(2); };
  const VALUE = ["--pewp", "--out", "--words", "--book", "--assets"];
  const argv = process.argv.slice(2), opt = {}, pos = [];
  if (argv.includes("--help")) { console.log("Usage: node scripts/analysis-copy.mjs <url or profile:slug> --pewp <the run's .pewp folder> --out <folder> [--words <folder>] [--assets <folder>] [--book <file>]"); process.exit(0); }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE.includes(a)) { if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) usage(a + " needs a value"); opt[a] = argv[++i]; }
    else if (a.startsWith("--")) usage("unknown argument " + a);
    else pos.push(a);
  }
  if (pos.length !== 1) usage("one <url or profile:slug> is needed");
  for (const k of ["--pewp", "--out"]) if (!opt[k]) usage(k + " is missing");
  let loc; try { loc = locate(pos[0], { cwd: process.cwd() }); } catch (e) { usage(e.message); }
  const outDir = path.resolve(opt["--out"]);
  try {
    const r = build({
      pewp: path.resolve(opt["--pewp"]), name: loc.host || loc.slug || path.basename(loc.root),
      wordsDir: path.resolve(opt["--words"] || path.join(skillDir, "client-copy")), assetsDir: path.resolve(opt["--assets"] || path.join(skillDir, "assets", "client-copy")),
      bookAbs: path.resolve(opt["--book"] || path.join(skillDir, "..", "..", "docs", "product", "1-product.md")),
    });
    fs.mkdirSync(outDir, { recursive: true });
    const htmlName = r.stem + ".html", tsvName = "numbers-" + r.date + ".tsv";
    fs.writeFileSync(path.join(outDir, htmlName), r.html);
    fs.writeFileSync(path.join(outDir, tsvName), r.tsv);
    for (const l of r.leftOut) console.log(l);
    for (const l of r.notes) console.log(l);
    console.log("wrote " + path.join(opt["--out"], htmlName));
    console.log("wrote " + path.join(opt["--out"], tsvName));
    console.log("sections: " + r.pages);
  } catch (e) {
    if (e && e.isStop) { console.error(e.message); process.exit(1); }
    throw e;
  }
}
if (isMain(import.meta.url)) cli();
