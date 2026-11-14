// Usage: node scripts/client-copy.mjs <url> --pewp <run's .pewp folder> --client-file <client-copy.json> --out <folder>
//          [--words <folder>] [--book <file>] [--assets <folder>]
// The client's 8-page copy of a finished audit run: <stem>.html and numbers-<date>.tsv (one sheet row per number and per factual
// claim, with its file and field). Reads only: the files under --pewp, the snapshot folder that <pewp>/report.json names, the client
// file and the hand-read files it names, --words (default client-copy/ of the skill: the wording that is data), --book (default
// docs/product/1-product.md of the repository) and --assets (default assets/client-copy/ of the skill). Starts no browser, writes no
// PDF (client-copy-pdf.mjs prints it), makes no network request. Exit 0 built; 1 a STOP (one line on stderr, nothing written); 2 a usage fault (one line).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collect, stop } from "./client-copy-data.mjs";
import { buildPages } from "./client-copy-pages.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(here, "..");
const usage = (what) => { console.error(`client-copy: ${what}`); process.exit(2); };

// ---- arguments
const VALUE = ["--pewp", "--client-file", "--out", "--words", "--book", "--assets"];
const argv = process.argv.slice(2), opt = {}, pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (VALUE.includes(a)) { if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) usage(`${a} needs a value`); opt[a] = argv[++i]; }
  else if (a.startsWith("--")) usage(`unknown argument ${a}`);
  else pos.push(a);
}
if (pos.length !== 1) usage("one <url> is needed");
for (const k of ["--pewp", "--client-file", "--out"]) if (!opt[k]) usage(`${k} is missing`);
const pewp = path.resolve(opt["--pewp"]);
const clientFile = path.resolve(opt["--client-file"]);
const outDir = path.resolve(opt["--out"]);
const wordsDir = path.resolve(opt["--words"] || path.join(skillDir, "client-copy"));
const bookAbs = path.resolve(opt["--book"] || path.join(skillDir, "..", "..", "docs", "product", "1-product.md"));
const assetsDir = path.resolve(opt["--assets"] || path.join(skillDir, "assets", "client-copy"));

// ---- the client file (it lives with the client, never in the repository)
const KEYS = ["shortName", "nameWord", "alsoSearchedAs", "date", "contact", "labels", "words", "rivals", "adsFor", "linkPlace", "linkCompare", "rivalsLede", "promisePattern", "handReads"];
const WORDS = { buyer: "buyer", buyers: "buyers", applicant: "enquirer", application: "enquiry form", apply: "get in touch", applies: "gets in touch", pastCustomer: "past customer", outcome: "customers", offers: "messages", product: "service", products: "services", localRivals: "businesses", optionalNote: "with or without its optional part" };
const HANDS = ["leadPath", "mail", "domain", "trust", "trustKey", "filing"];
const isText = (v) => typeof v === "string" && v.trim() !== "";
const isTexts = (v) => Array.isArray(v) && v.every(isText);
if (!fs.existsSync(clientFile) || !fs.statSync(clientFile).isFile()) stop0("STOP: the client file is missing");
function stop0(line) { console.error(line); process.exit(1); }
let client;
try { client = JSON.parse(fs.readFileSync(clientFile, "utf8").replace(/^﻿/, "")); } catch { usage("the client file is not JSON"); }
if (client === null || typeof client !== "object" || Array.isArray(client)) usage("the client file is not a JSON object");
for (const k of Object.keys(client)) if (!KEYS.includes(k)) usage(`the client file has an unknown key ${k}`);
if (!("contact" in client)) usage('the client file has no contact (null = not set, "none" = no contact line, or the text to print)');
const contactIn = client.contact;
if (contactIn !== null && !isText(contactIn)) usage('contact must be null, "none" or the text to print');
const draft = contactIn === null;
const contact = draft || contactIn === "none" ? null : contactIn;
for (const k of ["shortName", "nameWord", "linkPlace", "rivalsLede", "promisePattern"]) if (k in client && !isText(client[k])) usage(`${k} must be a text`);
for (const k of ["alsoSearchedAs", "adsFor"]) if (k in client && !isTexts(client[k])) usage(`${k} must be a list of texts`);
if ("date" in client && !/^\d{4}-\d{2}-\d{2}$/.test(String(client.date))) usage("date must be yyyy-mm-dd");
if ("labels" in client && !(client.labels && typeof client.labels === "object" && !Array.isArray(client.labels) && Object.values(client.labels).every(isText))) usage("labels must map a product to a text");
if ("words" in client) {
  const wd = client.words;
  if (!(wd && typeof wd === "object" && !Array.isArray(wd))) usage("words must be an object");
  for (const [k, v] of Object.entries(wd)) { if (!(k in WORDS)) usage(`words has an unknown key ${k}`); if (!isText(v)) usage(`words.${k} must be a text`); }
}
if ("rivals" in client) {
  if (!Array.isArray(client.rivals)) usage("rivals must be a list");
  for (const r of client.rivals) if (!(r && isText(r.domain) && (r.name === null || isText(r.name)) && isText(r.type) && isText(r.group))) usage("each rival needs domain, name (or null), type and group");
}
if ("linkCompare" in client && !(client.linkCompare && isText(client.linkCompare.group) && isText(client.linkCompare.label))) usage("linkCompare needs group and label");
if ("promisePattern" in client) { try { new RegExp(client.promisePattern); } catch { usage("promisePattern is not a regular expression"); } }
if ("handReads" in client) {
  const h = client.handReads;
  if (!(h && typeof h === "object" && !Array.isArray(h))) usage("handReads must be an object");
  for (const [k, v] of Object.entries(h)) {
    if (!HANDS.includes(k)) usage(`handReads has an unknown key ${k}`);
    if (v === null) continue;
    if (!isText(v)) usage(`handReads.${k} must be null or a text`);
    if (k !== "trustKey" && !(/^(pewp|here):[^\\:]+$/.test(v) && !v.split("/").includes(".."))) usage(`handReads.${k} must be pewp:<path under .pewp> or here:<path beside the client file>`);
  }
}
const words = { ...WORDS, ...(client.words || {}) };
const hr = client.handReads || {};
const handOf = (k) => {
  if (!hr[k] || (k === "trust" && !hr.trustKey)) return null;
  const [kind, rel] = [hr[k].slice(0, hr[k].indexOf(":")), hr[k].slice(hr[k].indexOf(":") + 1)];
  return kind === "pewp" ? { abs: path.join(pewp, rel), label: `.pewp/${rel}` } : { abs: path.join(path.dirname(clientFile), rel), label: path.basename(rel) };
};
const hand = { leadPath: handOf("leadPath"), mail: handOf("mail"), domain: handOf("domain"), trust: handOf("trust"), filing: handOf("filing") };
const NOT_READ = { leadPath: "the application form", mail: "mail records", domain: "the domain record", trust: "licence wording", filing: "the state filing" };
const notRead = Object.keys(NOT_READ).filter((k) => !hand[k]).map((k) => NOT_READ[k]);

try {
  // ---- the wording that is data
  const readJson = (file, label) => {
    const p = path.join(wordsDir, file);
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) stop(`STOP: ${label} is missing`);
    try { return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, "")); } catch { return stop(`STOP: ${label} is not JSON`); }
  };
  const std = readJson("standard-copy.json", "standard-copy.json");
  for (const k of ["goAhead", "noOwnStatistics", "promise"]) if (!isText(std[k])) stop(`STOP: standard-copy.json has no ${k}`);
  if (!Array.isArray(std.nextSteps) || !std.nextSteps.length || !std.nextSteps.every((s) => Array.isArray(s) && s.length === 3 && s.every(isText))) stop("STOP: standard-copy.json has no nextSteps as a list of [label, title, text]");
  const fixes = readJson("fixes.json", "fixes.json");
  if (!Array.isArray(fixes)) stop("STOP: fixes.json has no list of rows");
  fixes.forEach((f, i) => { for (const k of ["id", "when", "fix", "why", "time", "who"]) if (!f || !isText(f[k])) stop(`STOP: fixes.json row ${i + 1} has no ${k}`); });
  const dirNames = readJson("directories.json", "directories.json");
  if (!fs.existsSync(path.join(wordsDir, "backing.json"))) stop("STOP: backing.json is missing");

  // ---- the assets: the logo, the font stylesheet and every file it names
  if (!fs.existsSync(path.join(assetsDir, "omnikom-logo-full.png"))) stop("STOP: assets omnikom-logo-full.png is missing");
  const cssFile = path.join(assetsDir, "fonts", "fonts.css");
  if (!fs.existsSync(cssFile)) stop("STOP: assets fonts/fonts.css is missing");
  const fontFiles = [...fs.readFileSync(cssFile, "utf8").matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/g)].map((m) => m[1]).filter((f) => !/^(data:|https?:)/.test(f));
  for (const f of fontFiles) { if (!fs.existsSync(path.join(assetsDir, "fonts", f))) stop(`STOP: assets fonts/${f} is missing`); }

  // ---- the run: report.json names the snapshot folder (relative to the folder that holds .pewp)
  const reportFile = path.join(pewp, "report.json");
  if (!fs.existsSync(reportFile)) stop("STOP: .pewp/report.json is missing");
  let report;
  try { report = JSON.parse(fs.readFileSync(reportFile, "utf8").replace(/^﻿/, "")); } catch { stop("STOP: .pewp/report.json is not JSON"); }
  if (!report || !isText(report.snapshot)) stop("STOP: .pewp/report.json has no snapshot");
  const snapRel = report.snapshot.replace(/\\/g, "/").replace(/\/+$/, "");
  const snapAbs = path.resolve(path.dirname(pewp), snapRel);

  const { D, S, fmt } = collect({ pewp, snapAbs, snapRel, client, hand, bookAbs, backingAbs: path.join(wordsDir, "backing.json"), dirNames });
  const date = client.date || D.fileDate;
  const stem = `${D.biz.shortName}-website-review-${date}${draft ? "-draft" : ""}`;
  const { html, tsv } = buildPages({ D, S, fmt, w: words, std, fixes, contact, draft, notRead, client, logoUrl: pathToFileURL(path.join(assetsDir, "omnikom-logo-full.png")).href, fontsUrl: pathToFileURL(cssFile).href });

  // ---- nothing is written before every number has been read and every page built
  fs.mkdirSync(outDir, { recursive: true });
  const htmlName = `${stem}.html`, tsvName = `numbers-${date}.tsv`;
  fs.writeFileSync(path.join(outDir, htmlName), html);
  fs.writeFileSync(path.join(outDir, tsvName), tsv);
  console.log(`wrote ${path.join(opt["--out"], htmlName)}`);
  console.log(`wrote ${path.join(opt["--out"], tsvName)}`);
  console.log("sections: 8");
} catch (e) {
  if (e && e.isStop) { console.error(e.message); process.exit(1); }
  throw e;
}
