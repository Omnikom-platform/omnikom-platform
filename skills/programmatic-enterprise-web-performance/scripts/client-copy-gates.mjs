// client-copy-gates.mjs: the report rules as gates over the finished html and sheet. gates() is called once by client-copy.mjs after the pages are built and
// before anything is written; the first gate that fails is a STOP of one line: STOP: gate <name>: <what was found>. Reads nothing, writes nothing.
import { stop } from "./client-copy-data.mjs";

export const STEP_IDS = ["approve-business", "approve-seeds", "demand-bing", "research-plan", "capture-google", "capture-bing", "capture-index", "index-import", "capture-autocomplete", "autocomplete-import", "capture-trends", "trends-import", "capture-ai", "ai-import", "targets-validate", "local-grid-plan", "capture-maps", "approve-competitors", "authority-anchors", "authority-classify", "authority-vet", "local-grid-import", "capture-directories", "capture-reputation", "reputation-import", "capture-social", "social-import", "capture-ads", "ads-import", "client-profile", "report-live", "client-copy", "client-copy-pdf"];
const WORD = /\b(?:pending|not run|not read in this review|could not read|not in this review)\b/i;
const UPPER = /\b(?:BLOCKED|UNPROVEN|PARTIAL|PARTLY|MISSING|WORKS|TODO|TBD)\b/;
const BROKEN = /\bundefined\b|\bNaN\b|\bnull\b|\[object |[{}]|@@/;
const FILE = /[\w.-]+\.(?:json|jsonl|tsv|mjs|csv)\b|\bpewp\b|\b(?:snapshots|captures|research|approved|authority|psi)\//;
const CODE = /\b[a-z]{4,}[A-Z]\w*\b|\b[a-z0-9]+_[a-z0-9_]+\b|\bD\.[a-z]\w*|\w\[[^\]]*[=\d][^\]]*\]/;
const STEP = new RegExp(`(?<![\\w-])(?:${STEP_IDS.join("|")})(?![\\w-])`);
const DASH = /[\u2013\u2014]|&(?:mdash|ndash);|&#(?:8212|8211|x2014|x2013);/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
const PHONE = /\+\d[\d\s().-]{8,}\d|\(\d{3}\)\s?\d{3}[\s.-]?\d{4}|\b\d{3}[.-]\d{3}[.-]\d{4}\b|\b\d{3}[.-]\d{4}\b|\b\d{10,}\b/;
const NUM = /\d+(?:[.,]\d+)*/g;

/** The text a reader sees: style, script and svg dropped, tags to spaces, the entities of the design decoded, white space squeezed. */
export const visible = (h) => String(h).replace(/<(style|script|svg)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&middot;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

export function gates({ html, tsv, pages, logoUrl, branches, approvedWords, internal }) {
  const fail = (gate, found) => stop(`STOP: gate ${gate}: ${found}`);
  const secs = html.match(/<section\b[\s\S]*?<\/section>/g) || [];
  const opens = (html.match(/<section\b/g) || []).length, marked = (html.match(/<section class="(?:cover|pg)" id="p\d+">/g) || []).length;
  // b: 5 to 8 sections, the cover first, then p2, p3 ... in order
  if (opens !== secs.length || marked !== opens || opens !== pages || opens < 5 || opens > 8) fail("sections", `the copy has ${opens} sections (${marked} marked cover or pg, ${pages} built); it needs 5 to 8, every one marked`);
  if (!secs[0].startsWith('<section class="cover" id="p1">')) fail("sections", "the first section is not the cover");
  secs.forEach((s, i) => { if (i > 0 && !s.startsWith(`<section class="pg" id="p${i + 1}">`)) fail("sections", `section ${i + 1} is not <section class="pg" id="p${i + 1}">`); });
  // c: a section with no visible text (its header and footer do not count)
  secs.forEach((s, i) => { if (visible(s.replace(/<div class="rh">[\s\S]*?<\/div>/, "").replace(/<div class="rf">[\s\S]*?<\/div>/, "")) === "") fail("blank page", `page ${i + 1} has no visible text`); });
  // e: the Omnikom logo is the only picture; a url() is allowed only inside @font-face
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  if (imgs.length > 1 || imgs.some((t) => !(t.includes('class="logo"') && t.includes(`src="${logoUrl}"`)))) fail("pictures", `${imgs.length} <img> found; only the logo may be a picture`);
  const pic = /url\(|image-set\(|<(?:picture|video|canvas|object|embed|iframe|image|foreignObject)\b|data:image/i.exec(html.replace(/@font-face\s*\{[^}]*\}/gi, ""));
  if (pic) fail("pictures", `the html holds ${pic[0]}; only the logo may be a picture`);
  // f: the pipeline list (ol.steps) is on the last page and on no other
  const steps = secs.map((s, i) => (/<ol class="steps[ "]/.test(s) ? i + 1 : 0)).filter(Boolean);
  if (steps.join() !== String(secs.length)) fail("last page", `the pipeline list is on page ${steps.join(", ") || "none"}; it belongs on the last page, ${secs.length}, only`);
  // h: no em dash and no en dash, as a character or an entity, in the html or the sheet
  const dm = DASH.exec(html) || DASH.exec(tsv);
  if (dm) fail("dashes", `the ${DASH.exec(html) ? "html" : "sheet"} holds a dash (${dm[0]})`);
  const text = secs.map(visible);
  // g: no contact line: an e-mail address, a phone number, mailto:, tel:, an element of class contact
  text.forEach((t, i) => { const m = EMAIL.exec(t) || PHONE.exec(t); if (m) fail("contact line", `page ${i + 1} prints "${m[0]}"`); });
  const ct = /mailto:|tel:|class="contact"/i.exec(html);
  if (ct) fail("contact line", `the html holds ${ct[0]}`);
  // d: no word of the report rule and no internal name in the visible text
  text.forEach((t, i) => { for (const re of [WORD, UPPER, BROKEN, FILE, CODE, STEP]) { const m = re.exec(t); if (m) fail("internal words", `page ${i + 1} prints "${m[0]}"`); } });
  // a: every number of a page's visible text is a number of a printed cell of that page's sheet rows (commas ignored)
  const norm = (x) => x.replace(/,/g, ""), rows = tsv.split("\n").slice(1).filter(Boolean).map((l) => l.split("\t"));
  const mrow = rows.find((r) => r[0] === "1" && r[1] === "month of the audit");
  if (!mrow) fail("numbers", 'the sheet has no row "month of the audit" on page 1');
  secs.forEach((s, i) => {
    const pg = i + 1; let n = 0, k = 0;
    const t = s.replace(/<div class="rh">([\s\S]*?)<\/div>/, (_, x) => { if (!visible(x).endsWith(`SEO, AI search and local audit, ${mrow[2]}`)) fail("numbers", `the header of page ${pg} does not end with the sheet's month, ${mrow[2]}`); return " "; })
      .replace(/<div class="rf">([\s\S]*?)<\/div>/, (_, x) => { if (visible(x) !== `Prepared by Omnikom ${pg} / ${secs.length}`) fail("numbers", `the footer of page ${pg} is not "${pg} / ${secs.length}"`); return " "; })
      .replace(/<span class="sn">([\s\S]*?)<\/span>/g, (_, x) => { if (visible(x) !== String(++n)) fail("numbers", `a step number on page ${pg} is not ${n}`); return " "; })
      .replace(/<table class="plan">[\s\S]*?<\/table>/, (tb) => tb.replace(/<tr\b[^>]*>\s*<td>([\s\S]*?)<\/td>/g, (_, x) => { if (visible(x) !== String(++k)) fail("numbers", `a row number of the plan on page ${pg} is not ${k}`); return "<tr>"; }));
    const v = visible(t).replace(/\bpages? (\d+(?:(?:,| and| to) \d+)*)(?![\d%])/gi, (_, xs) => { for (const x of xs.match(/\d+/g)) if (+x < 1 || +x > secs.length) fail("numbers", `page ${pg} refers to page ${x}, which is not in the copy`); return " "; });
    const have = new Set(rows.filter((r) => r[0] === String(pg)).flatMap((r) => (r[2] || "").match(NUM) || []).map(norm));
    const miss = [...new Set((v.match(NUM) || []).map(norm))].filter((x) => !have.has(x));
    if (miss.length) fail("numbers", `page ${pg} prints ${miss.slice(0, 4).join(", ")}${miss.length > 4 ? ` and ${miss.length - 4} more` : ""} and no printed cell of page ${pg} of the sheet holds ${miss.length === 1 ? "it" : "them"}`);
  });
  // i: new words: every word of every sentence of other-branches.json ({...} parts aside) is a word of the approved print, or the plural or singular of one
  if (branches && approvedWords) {
    const ok = new Set(approvedWords.map((x) => String(x).toLowerCase())), known = (w) => ok.has(w) || ok.has(`${w}s`) || ok.has(`${w}es`) || (w.endsWith("es") && ok.has(w.slice(0, -2))) || (w.endsWith("s") && ok.has(w.slice(0, -1)));
    const bad = [];
    for (const [id, t] of Object.entries(branches)) for (const w of String(t).replace(/\{[^}]*\}/g, " ").toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || []) if (!known(w) && !bad.some((b) => b[0] === w && b[1] === id)) bad.push([w, id]);
    if (bad.length) fail("new words", bad.length === 1 ? `"${bad[0][0]}" in ${bad[0][1]} is not a word of the approved print` : `${bad.slice(0, 4).map((b) => `"${b[0]}" in ${b[1]}`).join(", ")}${bad.length > 4 ? ` and ${bad.length - 4} more` : ""} are not words of the approved print`);
  }
  // j: the internal sheet (what the run did not gather) never reaches a client page: a page whose visible text holds one of its lines (8 characters or more, case and white space ignored) is refused
  const sq = (x) => String(x).toLowerCase().replace(/\s+/g, " ").trim();
  for (const n of (internal || []).map(sq).filter((x) => x.length >= 8)) { const i = text.findIndex((t) => sq(t).includes(n)); if (i >= 0) fail("internal", `page ${i + 1} holds a line of the internal sheet`); }
}
