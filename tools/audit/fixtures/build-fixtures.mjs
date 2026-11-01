// Builds fixtures/bad-<RULE-ID>[-part]/ from fixtures/good plus one edit function per fixture. The results are committed as files so a
// reader sees them; test/run.mjs checks that the committed files equal this generator's output.
//   node tools/audit/fixtures/build-fixtures.mjs           write every bad fixture (stale bad-* folders are removed)
//   node tools/audit/fixtures/build-fixtures.mjs --check   write nothing, exit 1 when the committed files differ from the output
// Every edit is split/join on an exact text that must occur exactly once (rep) or at least once (repAll): a patch that does not apply
// throws, so a fixture can never silently equal the good site.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const O = "https://www.brindlewood-tea.example";
// The _headers file of the factory (factory/lib/launch.mjs headersText, shortened to four headers): a preview adds the X-Robots-Tag noindex line.
const headersText = ({ preview }) => ["/*", "  Strict-Transport-Security: max-age=31536000; includeSubDomains", "  X-Content-Type-Options: nosniff", "  Referrer-Policy: strict-origin-when-cross-origin", "  X-Frame-Options: DENY",
  ...(preview ? ["  X-Robots-Tag: noindex, nofollow"] : []), "/assets/*", "  Cache-Control: public, max-age=31536000, immutable", ""].join("\n");

function readDir(dir) {
  const out = new Map();
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.set(path.relative(dir, p).split(path.sep).join("/"), fs.readFileSync(p, "utf8")); } };
  walk(dir);
  return out;
}
const need = (d, file) => { if (!d.has(file)) throw new Error(`fixture edit: no file ${file}`); return d.get(file); };
// replace `from` with `to`, which must occur exactly `times` times (default once)
const rep = (d, file, from, to, times = 1) => {
  const t = need(d, file); const n = t.split(from).length - 1;
  if (n !== times) throw new Error(`fixture edit: ${file}: expected ${times} occurrence(s) of ${JSON.stringify(from.slice(0, 70))}, found ${n}`);
  d.set(file, t.split(from).join(to));
};
// replace every occurrence (at least one)
const repAll = (d, file, from, to) => { const t = need(d, file); if (!t.includes(from)) throw new Error(`fixture edit: ${file}: no occurrence of ${JSON.stringify(from.slice(0, 70))}`); d.set(file, t.split(from).join(to)); };
// remove the whole ld+json script block of a page (the block starts at its script tag and ends at the first closing script tag)
const cutBlock = (d, file) => {
  const t = need(d, file);
  const a = t.indexOf('<script type="application/ld+json">'), b = t.indexOf("</script>\n", a);
  if (a < 0 || b < 0) throw new Error(`fixture edit: ${file}: no ld+json block to cut`);
  d.set(file, t.slice(0, a) + t.slice(b + "</script>\n".length));
};
const add = (d, file, text) => { if (d.has(file)) throw new Error(`fixture edit: ${file} exists already`); d.set(file, text); };
const del = (d, file) => { need(d, file); d.delete(file); };
// copy a page to a new path, swapping its address, title, description and heading so no other rule sees a clash
const copyPage = (d, from, to, title) => {
  const src = need(d, from + "index.html");
  let t = src.split(from).join(to).split(src.match(/<title>(.*)<\/title>/)[1]).join(title);
  t = t.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="A page added to the good site for a fixture: ${title}, with a description that is long enough to pass its length rule.">`);
  t = t.replace(/<h1>.*<\/h1>/, `<h1>${title}</h1>`);
  d.set(to + "index.html", t);
};

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';
const ABOUT_TITLE = "About Brindlewood Tea Co.: Our Blenders and Our Story";
const ABOUT_DESC = "Meet the two blenders behind Brindlewood Tea Co. and read how a market stall grew into a small shop with its own tasting room.";
const TASTING_TITLE = "Tasting Room: Sample Loose-Leaf Tea in Person";
const TASTING_DESC = "Book a seat in the Brindlewood tasting room and taste a flight of four loose-leaf teas, brewed at the table by one of our blenders.";
const T_HOME = "2026-10-02T08:15:00Z", T_ABOUT = "2026-09-21T14:40:00Z", T_TASTING = "2026-10-11T10:05:30+01:00", T_JOURNAL = "2026-10-19T16:22:10Z", T_BUILD = "2026-10-30T09:00:00Z";
// the exact text of one <url> block as fixtures/good/sitemap.xml has it, and a whole sitemap in the same layout
const urlBlock = (u, t) => `  <url>\n    <loc>${O}${u}</loc>\n    <lastmod>${t}</lastmod>\n  </url>\n`;
const sitemapXml = (urls) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, t]) => urlBlock(u, t)).join("")}</urlset>\n`;
const LEAF_ALT ="A single green tea leaf on a white background";
const ABOUT_LINK_TAIL = "tasting room</a> and try a flight of four teas.</p>";

// The plan's coverage file for the good site (plan/prompt-coverage.json, the shape slice 5b writes): three rows with a page, one earn-mention row with a written reason.
// `coverageText(change)` is the file text after `change(rows)` returned the rows to write (the fixtures break one row each).
const COVERAGE_FILE = "plan/prompt-coverage.json";
const coverageRows = () => [
  { id: "pm-1c2d3e4f", coveredBy: "/tasting-room/", kind: "improve-page", reason: "" },
  { id: "pm-9a8b7c6d", coveredBy: "/journal/how-to-steep-oolong/", kind: "new-page", reason: "" },
  { id: "pm-3f4e5d6c", coveredBy: "/about/", kind: "improve-page", reason: "" },
  { id: "pm-5e6f7a8b", coveredBy: null, kind: "earn-mention", reason: "offsite item 2: ask the local food writer for a mention (plan/offsite.json)" },
];
const coverageText = (change = (rows) => rows) => JSON.stringify({ map: "0".repeat(64), rows: change(coverageRows()) }, null, 1) + "\n";

// name -> { expect: text the FAIL (or WARN) of its own rule must contain, edit(d): the one break }
export const FIXTURES = {
  // MET-003: one <main>, one <h1>, no skipped heading level
  "bad-MET-003": { expect: "skips a level", at: "<h4>Small print", edit: (d) => rep(d, "tasting-room/index.html", "<h2>Before you come</h2>", "<h2>Before you come</h2>\n<p>Bring a friend if you like.</p>\n<h4>Small print</h4>") },
  "bad-MET-003-two-h1": { expect: "2 <h1> elements", at: "<h1>The blenders", edit: (d) => rep(d, "about/index.html", "<h2>The blenders</h2>", "<h1>The blenders</h1>") },
  "bad-MET-003-no-h1": { expect: "no <h1>", at: "<body", edit: (d) => rep(d, "about/index.html", "<h1>About Brindlewood Tea Co.</h1>", "<h2>About Brindlewood Tea Co.</h2>") },
  "bad-MET-003-no-main": { expect: "no <main>", at: "<body", edit: (d) => { rep(d, "about/index.html", "<main>", "<div>"); rep(d, "about/index.html", "</main>", "</div>"); } },
  "bad-MET-003-two-main": { expect: "2 <main> elements", at: "<main>", edit: (d) => rep(d, "about/index.html", "</main>", "</main>\n<main>\n<p>A second main element.</p>\n</main>") },

  // MET-001: one non-empty <title> in <head>, at most hardMax, unique per locale
  "bad-MET-001": { expect: "2 <title> elements", at: "<title>About", edit: (d) => rep(d, "about/index.html", VIEWPORT, VIEWPORT + "\n<title>A second title on the same page</title>") },
  "bad-MET-001-long": { expect: "the hard maximum is 70", at: "<title>Tasting Room", edit: (d) => rep(d, "tasting-room/index.html", TASTING_TITLE, "Tasting Room: Sample Loose-Leaf Tea in Person With One of Our Blenders at Brindlewood") },
  "bad-MET-001-empty": { expect: "the <title> is empty", at: "<title></title>", edit: (d) => rep(d, "about/index.html", `<title>${ABOUT_TITLE}</title>`, "<title></title>") },
  "bad-MET-001-missing": { expect: "no <title>", at: "<head", edit: (d) => rep(d, "about/index.html", `<title>${ABOUT_TITLE}</title>\n`, "") },
  "bad-MET-001-duplicate": { expect: "is also the title of", at: "<title>About", edit: (d) => rep(d, "tasting-room/index.html", TASTING_TITLE, ABOUT_TITLE) },

  // MET-002: a non-empty meta description in <head>, at most hardMax, unique
  "bad-MET-002": { expect: "no <meta name=\"description\">", at: "<head", edit: (d) => rep(d, "about/index.html", `<meta name="description" content="${ABOUT_DESC}">\n`, "") },
  "bad-MET-002-long": { expect: "the hard maximum is 180", at: "name=\"description\"", edit: (d) => rep(d, "about/index.html", ABOUT_DESC, ABOUT_DESC + " We open six days a week and the kettle is always on, so come in and ask us anything you like about tea, water and time.") },
  "bad-MET-002-empty": { expect: "the meta description is empty", at: "name=\"description\"", edit: (d) => rep(d, "about/index.html", `<meta name="description" content="${ABOUT_DESC}">`, '<meta name="description" content="">') },
  "bad-MET-002-duplicate": { expect: "is also the description of", at: "name=\"description\"", edit: (d) => rep(d, "tasting-room/index.html", TASTING_DESC, ABOUT_DESC) },

  // MET-004: a length outside warnMin to warnMax is a WARN (the exit stays 0)
  "bad-MET-004": { expect: "the title is 23 characters", at: "<title>Tasting Room: Loose", edit: (d) => rep(d, "tasting-room/index.html", TASTING_TITLE, "Tasting Room: Loose Tea") },
  "bad-MET-004-desc": { expect: "the meta description is 173 characters", edit: (d) => rep(d, "about/index.html", ABOUT_DESC, ABOUT_DESC + " Open six days a week; the kettle is always on.") },

  // SE-202: Bing minimum lengths, lower for zh, ja and ko
  "bad-SE-202": { expect: "Bing wants at least 20", at: "<title>Tasting Room</title>", edit: (d) => rep(d, "tasting-room/index.html", TASTING_TITLE, "Tasting Room") },
  "bad-SE-202-desc": { expect: "Bing wants at least 50", at: "name=\"description\"", edit: (d) => rep(d, "tasting-room/index.html", TASTING_DESC, "Book a tasting and try four teas.") },
  // URL-009: one canonical string everywhere, absolute, with the page's own path
  "bad-URL-009": { expect: "no canonical link", at: "<head", edit: (d) => rep(d, "about/index.html", `<link rel="canonical" href="${O}/about/">\n`, "") },
  "bad-URL-009-path": { expect: "is not this page's own path /about/", at: "rel=\"canonical\"", edit: (d) => { repAll(d, "about/index.html", `${O}/about/`, `${O}/about-us/`); rep(d, "sitemap.xml", `<loc>${O}/about/</loc>`, `<loc>${O}/about-us/</loc>`); } },
  "bad-URL-009-og": { expect: "og:url", at: "og:url", edit: (d) => rep(d, "about/index.html", `<meta property="og:url" content="${O}/about/">`, `<meta property="og:url" content="${O}/about/?ref=nav">`) },
  "bad-URL-009-hreflang": { expect: "the hreflang en href", at: "hreflang", edit: (d) => rep(d, "about/index.html", `<link rel="alternate" hreflang="en" href="${O}/about/">`, `<link rel="alternate" hreflang="en" href="${O}/about">`) },
  "bad-URL-009-webpage": { expect: "JSON-LD WebPage.url", at: "application/ld+json", edit: (d) => rep(d, "about/index.html", `"url": "${O}/about/",`, `"url": "${O}/about",`) },

  // SCH-001: one ld+json block with @graph, WebPage, WebSite, Organization on the home page, resolvable references
  "bad-SCH-001": { expect: "2 ld+json blocks", at: "application/ld+json", edit: (d) => rep(d, "about/index.html", "</script>\n</head>", `</script>\n<script type="application/ld+json">\n{"@context":"https://schema.org","@type":"Thing","name":"A second block"}\n</script>\n</head>`) },
  "bad-SCH-001-none": { expect: "has no <script type=\"application/ld+json\">", at: "<head", edit: (d) => cutBlock(d, "about/index.html") },
  "bad-SCH-001-parse": { expect: "does not parse", at: "application/ld+json", edit: (d) => rep(d, "about/index.html", `"name": "About Brindlewood Tea Co.",\n`, `"name": "About Brindlewood Tea Co."\n`) },
  "bad-SCH-001-no-graph": { expect: "has no @graph array", edit: (d) => rep(d, "about/index.html", '"@graph": [', '"graph": [') },
  "bad-SCH-001-no-webpage": { expect: "no WebPage node", edit: (d) => rep(d, "about/index.html", '"@type": "AboutPage",', '"@type": "Article",') },
  "bad-SCH-001-id": { expect: "is not", edit: (d) => rep(d, "about/index.html", `"@id": "${O}/about/#webpage",`, `"@id": "${O}/about/#page",`) },
  "bad-SCH-001-no-website": { expect: "no WebSite node", edit: (d) => rep(d, "about/index.html", `      "isPartOf": {\n        "@id": "${O}/#website"\n      },\n`, "") },
  "bad-SCH-001-no-org": { expect: "no full Organization node", count: 5, edit: (d) => rep(d, "index.html", `"@type": "Organization",\n      "@id": "${O}/#organization",`, `"@type": "Organization",\n      "@id": "${O}/#org",`) },
  "bad-SCH-001-dangling": { expect: "resolves to no node", edit: (d) => rep(d, "about/index.html", `"name": "About Brindlewood Tea Co.",\n`, `"name": "About Brindlewood Tea Co.",\n      "author": {\n        "@id": "${O}/#nobody"\n      },\n`) },

  // LNK-002: internal links land on a page or file of the folder, without nofollow, in the canonical form
  "bad-LNK-002": { expect: "lands on no page", at: "/missing/", edit: (d) => rep(d, "about/index.html", ABOUT_LINK_TAIL, ABOUT_LINK_TAIL.replace("</p>", ` See also <a href="/missing/">our wholesale page</a>.</p>`)) },
  "bad-LNK-002-nofollow": { expect: "forbidden-value", at: "nofollow", edit: (d) => rep(d, "about/index.html", `<a href="/tasting-room/">tasting room</a>`, `<a href="/tasting-room/" rel="nofollow">tasting room</a>`) },
  "bad-LNK-002-form": { expect: "is not the canonical form", at: "/tasting-room.html", edit: (d) => rep(d, "about/index.html", `<a href="/tasting-room/">tasting room</a>`, `<a href="/tasting-room.html">tasting room</a>`) },
  "bad-LNK-002-file": { expect: "lands on no file", at: "missing-guide.pdf", edit: (d) => rep(d, "index.html", `<a href="/files/steeping-guide.pdf">`, `<a href="/files/missing-guide.pdf">`) },

  // A11-007: a text alternative on every image, image button and image map area
  "bad-A11-007": { expect: "has no alt attribute", at: "<img src=\"/img/leaf.svg\" width=\"64\"", edit: (d) => rep(d, "index.html", ` alt="${LEAF_ALT}"`, "") },
  "bad-A11-007-filename": { expect: "is a file name", edit: (d) => rep(d, "index.html", `alt="${LEAF_ALT}"`, 'alt="leaf.svg"') },
  "bad-A11-007-src": { expect: "is the same as its src", edit: (d) => rep(d, "index.html", `alt="${LEAF_ALT}"`, 'alt="/img/leaf.svg"') },
  "bad-A11-007-segment": { expect: "is the same as its src", edit: (d) => rep(d, "index.html", `src="/img/leaf.svg" alt="${LEAF_ALT}"`, 'src="/img/leaf.svg?v=2" alt="leaf.svg?v=2"') },
  "bad-A11-007-generic": { expect: "is a generic word", edit: (d) => rep(d, "index.html", `alt="${LEAF_ALT}"`, 'alt="Photo"') },
  "bad-A11-007-blank": { expect: "has an empty alt", edit: (d) => rep(d, "index.html", `alt="${LEAF_ALT}"`, 'alt="   "') },
  "bad-A11-007-input": { expect: "<input type=image> has no alt", at: "<input type=\"image\"", edit: (d) => rep(d, "index.html", ' alt="Book a tasting"', "") },
  "bad-A11-007-area": { expect: "<area> has no alt", at: "<area", edit: (d) => rep(d, "index.html", ' alt="Tasting room"', "") },

  // IDX-001: the sitemap URL set equals the set of indexable pages, in canonical form
  "bad-IDX-001": { expect: "extra", at: "/ghost/", edit: (d) => rep(d, "sitemap.xml", "</urlset>", urlBlock("/ghost/", "2026-10-05T09:00:00Z") + "</urlset>") },
  "bad-IDX-001-missing": { expect: "is not in the sitemap", edit: (d) => rep(d, "sitemap.xml", urlBlock("/tasting-room/", T_TASTING), "") },
  "bad-IDX-001-noncanonical": { expect: "non-canonical", count: 2, at: "/about.html", edit: (d) => rep(d, "sitemap.xml", `<loc>${O}/about/</loc>`, `<loc>${O}/about.html</loc>`) },
  "bad-IDX-001-noindex": { expect: "is noindex", at: "/about/", edit: (d) => rep(d, "about/index.html", VIEWPORT, VIEWPORT + '\n<meta name="robots" content="noindex">') },

  // IDX-002: sitemap limits, index, valid escaped XML, absolute URLs on one origin, unique entries
  "bad-IDX-002": { expect: "unescaped &", at: "&", edit: (d) => rep(d, "sitemap.xml", `<loc>${O}/about/</loc>`, `<loc>${O}/about/</loc>\n    <changefreq>monthly & rarely</changefreq>`) },
  "bad-IDX-002-limit": { expect: "4 URLs, the limit is 3 per file", edit: (d) => add(d, "audit.config.json", '{ "sitemap": { "maxUrlsPerFile": 3 } }\n') },
  "bad-IDX-002-bytes": { expect: "bytes, the limit is 500 per file", edit: (d) => add(d, "audit.config.json", '{ "sitemap": { "maxBytesPerFile": 500 } }\n') },
  "bad-IDX-002-origin": { expect: "is not on the origin", at: "https://about.", edit: (d) => { repAll(d, "about/index.html", `${O}/about/`, `https://about.brindlewood-tea.example/about/`); rep(d, "sitemap.xml", `<loc>${O}/about/</loc>`, `<loc>https://about.brindlewood-tea.example/about/</loc>`); } },
  "bad-IDX-002-duplicate": { expect: "is listed more than once", at: "/about/", edit: (d) => rep(d, "sitemap.xml", urlBlock("/about/", T_ABOUT), urlBlock("/about/", T_ABOUT) + urlBlock("/about/", T_ABOUT)) },
  "bad-IDX-002-two-files": { expect: "is not a sitemap index", edit: (d) => { rep(d, "sitemap.xml", urlBlock("/tasting-room/", T_TASTING) + urlBlock("/journal/how-to-steep-oolong/", T_JOURNAL), ""); add(d, "sitemap-2.xml", sitemapXml([["/tasting-room/", T_TASTING], ["/journal/how-to-steep-oolong/", T_JOURNAL]])); } },

  // IDX-003: the build-clock signature (five URLs, one lastmod, written at that time) is a WARN
  "bad-IDX-003": { expect: "share one lastmod", edit: (d) => { copyPage(d, "about/", "contact/", "Contact Brindlewood Tea Co. for Wholesale Orders"); d.set("sitemap.xml", sitemapXml(["/", "/about/", "/tasting-room/", "/journal/how-to-steep-oolong/", "/contact/"].map((u) => [u, T_BUILD]))); },
    setup: (dir) => { const t = new Date(T_BUILD); fs.utimesSync(path.join(dir, "sitemap.xml"), t, t); } },

  // SE-004: lastmod as a W3C datetime with time and timezone, not in the future
  "bad-SE-004": { expect: "is date-only", at: "<lastmod>2026-09-21</lastmod>", edit: (d) => rep(d, "sitemap.xml", `<lastmod>${T_ABOUT}</lastmod>`, "<lastmod>2026-09-21</lastmod>") },
  "bad-SE-004-tz": { expect: "is no timezone", at: "<lastmod>2026-10-02T08:15:00</lastmod>", edit: (d) => rep(d, "sitemap.xml", `<lastmod>${T_HOME}</lastmod>`, "<lastmod>2026-10-02T08:15:00</lastmod>") },
  "bad-SE-004-future": { expect: "is in the future", at: "<lastmod>2099-01-01", edit: (d) => rep(d, "sitemap.xml", `<lastmod>${T_JOURNAL}</lastmod>`, "<lastmod>2099-01-01T00:00:00Z</lastmod>") },

  // IDX-004: robots.txt present, references the sitemap, disallows no sitemap and no indexable page
  "bad-IDX-004": { expect: "no robots.txt", edit: (d) => del(d, "robots.txt") },
  "bad-IDX-004-no-sitemap": { expect: "no Sitemap line", edit: (d) => rep(d, "robots.txt", `Sitemap: ${O}/sitemap.xml\n`, "") },
  "bad-IDX-004-wrong-sitemap": { expect: "is not the sitemap file", at: "other-sitemap.xml", edit: (d) => rep(d, "robots.txt", `Sitemap: ${O}/sitemap.xml`, `Sitemap: ${O}/other-sitemap.xml`) },
  "bad-IDX-004-disallow-page": { expect: "disallows the page /about/", at: "Disallow: /about/", edit: (d) => rep(d, "robots.txt", "Disallow: /private/\n", "Disallow: /private/\nDisallow: /about/\n") },
  "bad-IDX-004-disallow-sitemap": { expect: "disallows the sitemap /sitemap.xml", at: "Disallow: /sitemap.xml", edit: (d) => rep(d, "robots.txt", "Disallow: /private/\n", "Disallow: /private/\nDisallow: /sitemap.xml\n") },

  "bad-SE-202-cjk": { expect: "Bing wants at least 10", edit: (d) => { rep(d, "about/index.html", '<html lang="en">', '<html lang="ja">'); rep(d, "about/index.html", ABOUT_TITLE, "紅茶専門店のご案内"); } },

  // DSN (slice 4b): the design tells of DECISIONS 37. Each fixture is the good site plus one tell, and trips its own rule only (a WARN rule says status).
  // The snippets are added to the home page before "Learn to steep" (heading order stays valid) or to a head, so no other rule sees them.
  "bad-DSN-001": { expect: 'class "animate-pulse"', at: "animate-pulse", edit: (d) => homeAdd(d, '<p class="animate-pulse">Opening soon</p>') },
  "bad-DSN-001-hover-scale": { expect: 'class "hover:scale-105"', at: "hover:scale-105", edit: (d) => homeAdd(d, '<p class="hover:scale-105">Hover to see more</p>') },
  "bad-DSN-001-transition-all": { expect: 'class "transition-all"', at: "transition-all", edit: (d) => homeAdd(d, '<p class="transition-all">Every property moves</p>') },
  "bad-DSN-001-shimmer-class": { expect: 'class "skeleton-shimmer"', at: "skeleton-shimmer", edit: (d) => homeAdd(d, '<p class="skeleton-shimmer">Loading the shelf</p>') },
  "bad-DSN-001-shimmer-keyframes": { expect: '@keyframes "shimmer"', at: "@keyframes shimmer", edit: (d) => headAdd(d, "index.html", "<style>\n@keyframes shimmer { from { opacity: 0.4 } to { opacity: 1 } }\n</style>") },
  // a linked stylesheet of the folder, linked from two pages: the @keyframes is reported once, on the file
  "bad-DSN-001-stylesheet": { expect: '@keyframes "pulse-shimmer"', at: "@keyframes pulse-shimmer", edit: (d) => { add(d, "css/site.css", "body { margin: 0 }\n@keyframes pulse-shimmer {\n  from { opacity: 0.4 }\n  to { opacity: 1 }\n}\n"); linkCss(d, "index.html"); linkCss(d, "about/index.html"); } },

  "bad-DSN-002-text": { expect: "gradient text", at: "bg-clip-text", edit: (d) => homeAdd(d, '<h2 class="bg-gradient-to-r from-blue-600 to-blue-400 bg-clip-text text-transparent">Steeped slowly</h2>') },
  "bad-DSN-002-text-css": { expect: "gradient text", at: 'class="fancy"', edit: (d) => { headAdd(d, "index.html", "<style>\n.fancy { background-image: linear-gradient(#222222, #888888); -webkit-background-clip: text; background-clip: text }\n</style>"); homeAdd(d, '<p class="fancy">Steeped slowly</p>'); } },
  "bad-DSN-002-background": { expect: "name two hue families (blue, purple)", at: "from-indigo-500", edit: (d) => homeAdd(d, '<div class="bg-gradient-to-r from-indigo-500 to-purple-600"><p>Steeped slowly</p></div>') },
  "bad-DSN-002-background-css": { expect: "two hue families (blue, purple)", at: "linear-gradient", edit: (d) => homeAdd(d, '<div style="background-image: linear-gradient(90deg, #6366f1, #a855f7)"><p>Steeped slowly</p></div>') },
  "bad-DSN-002-background-stylesheet": { expect: "two hue families (red, blue)", at: 'class="hero"', edit: (d) => { add(d, "css/site.css", ".hero { background: linear-gradient(to right, red, blue) }\n"); linkCss(d, "index.html"); homeAdd(d, '<div class="hero"><p>Steeped slowly</p></div>'); } },

  "bad-DSN-003": { expect: "emoji", at: "What we sell", edit: (d) => rep(d, "index.html", "<h2>What we sell</h2>", "<h2>\u{1F375} What we sell</h2>") },

  // a text-style symbol (the north-east arrow) turned into an emoji by U+FE0F
  "bad-DSN-003-selector": { expect: "emoji", at: "Visit the shop", edit: (d) => homeAdd(d, `<p><a href="/about/">Visit the shop ${String.fromCharCode(0x2197, 0xfe0f)}</a></p>`) },

  "bad-DSN-004": { expect: "uppercase tracked label", at: "uppercase tracking-widest", edit: (d) => homeAdd(d, '<p><span class="uppercase tracking-widest">Our story</span></p>') },
  "bad-DSN-004-inline": { expect: "uppercase tracked label", at: "text-transform: uppercase", edit: (d) => homeAdd(d, '<p style="text-transform: uppercase; letter-spacing: 2px">Our story</p>') },
  "bad-DSN-004-style-block": { expect: "uppercase tracked label", at: 'class="eyebrow"', edit: (d) => { headAdd(d, "index.html", "<style>\n.eyebrow { text-transform: uppercase; letter-spacing: 0.2em }\n</style>"); homeAdd(d, '<p class="eyebrow">Our story</p>'); } },
  "bad-DSN-004-stylesheet": { expect: "uppercase tracked label", at: 'class="eyebrow"', edit: (d) => { add(d, "css/site.css", ".eyebrow {\n  text-transform: uppercase;\n  letter-spacing: 0.2em;\n}\n"); linkCss(d, "index.html"); homeAdd(d, '<p class="eyebrow">Our story</p>'); } },

  "bad-DSN-005": { expect: 'hype copy "AI-powered"', at: "AI-powered", edit: (d) => homeAdd(d, "<p>Our AI-powered blends find the tea you like.</p>") },
  "bad-DSN-005-hype-word": { expect: 'hype copy "magic"', at: "magic", edit: (d) => homeAdd(d, "<p>Pure magic in every cup.</p>") },
  "bad-DSN-006": { expect: "exclamation mark in <h2>", at: "What we sell!", edit: (d) => rep(d, "index.html", "<h2>What we sell</h2>", "<h2>What we sell!</h2>") },
  "bad-DSN-007": { expect: 'greeting "Welcome"', at: "Welcome to", edit: (d) => rep(d, "index.html", "<h2>What we sell</h2>", "<h2>Welcome to our shelves</h2>") },
  "bad-DSN-008": { expect: 'badge <span> "PRO"', at: ">PRO<", edit: (d) => homeAdd(d, '<p>Steeping guide <span class="badge">PRO</span></p>') },
  "bad-DSN-009": { expect: 'unverifiable claim "Loved by 10,000+ tea"', at: "Loved by", edit: (d) => homeAdd(d, "<p>Loved by 10,000+ tea drinkers.</p>") },
  "bad-DSN-009-times": { expect: 'unverifiable claim "3x faster"', at: "3x faster", edit: (d) => homeAdd(d, "<p>Steeps 3x faster than a kettle.</p>") },
  "bad-DSN-009-trusted": { expect: 'unverifiable claim "Trusted by 5k tea"', at: "Trusted by", edit: (d) => homeAdd(d, "<p>Trusted by 5k tea shops.</p>") },
  "bad-DSN-010": { status: "WARN", expect: 'weight 700 at 12 px on <span> "New"', at: "text-xs font-bold", edit: (d) => homeAdd(d, '<p><span class="text-xs font-bold">New</span></p>') },
  "bad-DSN-010-inline": { status: "WARN", expect: "weight 700 at 12 px", at: "font-weight: 700", edit: (d) => homeAdd(d, '<p style="font-weight: 700; font-size: 12px">New</p>') },
  "bad-DSN-011": { status: "WARN", expect: 'negative letter spacing at 12 px on <span> "Small print"', at: "text-xs tracking-tight", edit: (d) => homeAdd(d, '<p><span class="text-xs tracking-tight">Small print</span></p>') },
  "bad-DSN-011-inline": { status: "WARN", expect: "negative letter spacing at 12 px", at: "letter-spacing: -0.02em", edit: (d) => homeAdd(d, '<p style="letter-spacing: -0.02em; font-size: 12px">Small print</p>') },

  // one page with every tell: run.mjs exits 1 and names all eleven rules (multi lists the status each rule must show; the one-rule-per-fixture check is unchanged for every other fixture)
  "bad-DSN": { multi: { "DSN-001": "FAIL", "DSN-002": "FAIL", "DSN-003": "FAIL", "DSN-004": "FAIL", "DSN-005": "FAIL", "DSN-006": "FAIL", "DSN-007": "FAIL", "DSN-008": "FAIL", "DSN-009": "FAIL", "DSN-010": "WARN", "DSN-011": "WARN" },
    edit: (d) => homeAdd(d, [
      '<h2 class="bg-gradient-to-r from-blue-600 to-blue-400 bg-clip-text text-transparent">Welcome to the tea shelf \u{1F375}!</h2>',
      '<div class="bg-gradient-to-r from-indigo-500 to-purple-600"><p>Steeped slowly</p></div>',
      '<p><span class="animate-pulse uppercase tracking-widest">Fresh</span> <span class="text-xs font-bold tracking-tight">small print</span> <span>PRO</span></p>',
      "<p>Our AI-powered blends are loved by 10,000+ tea drinkers and steep 3x faster.</p>",
    ].join("\n")) },

  // ENV-001 (slice 4c): the build's indexing matches its target. `target` is passed to the audit for this fixture only (the one-rule check is not loosened).
  // preview: a _headers file with no noindex line, so a preview would be indexed (one FAIL per page, four pages)
  "bad-ENV-001-preview": { target: "preview", expect: "a preview would be indexed", count: 4, at: "<head", edit: (d) => add(d, "_headers", headersText({ preview: false })) },
  // production: the preview's _headers (a /* noindex line) shipped to production. ENV-001 names every page, and IDX-001 now sees every sitemap page as noindex
  "bad-ENV-001-production": { target: "production", multi: { "ENV-001": "FAIL", "IDX-001": "FAIL" }, edit: (d) => add(d, "_headers", headersText({ preview: true })) },

  // PMP-001 (slice 5c): the prompt map's publish rule. `coverage` is the path, inside the fixture, of the plan's coverage file; the test passes it to the audit for this fixture only.
  // a row with no page and no reason (the plan left a buyer's question unanswered): one FAIL naming the row id
  "bad-PMP-001-uncovered": { coverage: COVERAGE_FILE, expect: "row pm-5e6f7a8b (earn-mention) has no page", count: 1, edit: (d) => add(d, COVERAGE_FILE, coverageText((rows) => rows.map((r) => (r.id === "pm-5e6f7a8b" ? { ...r, reason: "" } : r)))) },
  // a row whose page is not in the build (the plan promised /tasting-room/best-chai/, the build has no such page): one FAIL naming the row id and the path
  "bad-PMP-001-missing-page": { coverage: COVERAGE_FILE, expect: "row pm-1c2d3e4f (improve-page) says /tasting-room/best-chai/ answers it, but the build has no page at /tasting-room/best-chai/", count: 1, edit: (d) => add(d, COVERAGE_FILE, coverageText((rows) => rows.map((r) => (r.id === "pm-1c2d3e4f" ? { ...r, coveredBy: "/tasting-room/best-chai/" } : r)))) },
};
const HOME_ANCHOR = "<h2>Learn to steep</h2>";
function homeAdd(d, html) { rep(d, "index.html", HOME_ANCHOR, html + "\n" + HOME_ANCHOR); }
function headAdd(d, file, html) { rep(d, file, VIEWPORT, VIEWPORT + "\n" + html); }
function linkCss(d, file) { headAdd(d, file, '<link rel="stylesheet" href="/css/site.css">'); }

// ---------------------------------------------------------------------------------------------------------------------------------------
// Snapshot fixtures (slice 2): fixtures/snapshot-good/ is the good site in the form snapshot-site.mjs saves a live site (see that script's
// header for every file), generated from fixtures/good by snapshotGood(). fixtures/snapshot-bad-<RULE-ID>[-part]/ are snapshotGood() plus one
// edit. Entries are Maps of path -> string | Buffer. A .gz file is compared on its gunzipped bytes (the gzip header carries an OS byte that
// differs between platforms); the writer fixes that byte and the time stamp, so the files are also the same bytes everywhere.
// A fixture entry may carry: status ("FAIL" default, "WARN", "SKIP", "PASS" = the status of its own rule's finding), also (rule ids whose
// findings are expected as well, because one fact breaks two rules), count, expect, at.
const SO = "https://example-tea.invalid";
const gz = (text) => { const b = zlib.gzipSync(Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8"), { level: 9 }); b.fill(0, 4, 8); b[9] = 3; return b; };
const ungz = (b) => zlib.gunzipSync(b).toString("utf8");
const txt = (d, file) => String(need(d, file));
const jsonOf = (d, file) => JSON.parse(txt(d, file));
const putJson = (d, file, o) => d.set(file, JSON.stringify(o, null, 1) + "\n");
const edJson = (d, file, fn) => { const o = jsonOf(d, file); fn(o); putJson(d, file, o); };
const edHtml = (d, slug, from, to) => {
  const f = `pages/${slug}/raw.html.gz`;
  const t = ungz(need(d, f)); const n = t.split(from).length - 1;
  if (n !== 1) throw new Error(`fixture edit: ${f}: expected 1 occurrence of ${JSON.stringify(from.slice(0, 70))}, found ${n}`);
  d.set(f, gz(t.split(from).join(to)));
};
const edHtmlAll = (d, slug, from, to) => { const f = `pages/${slug}/raw.html.gz`; const t = ungz(need(d, f)); if (!t.includes(from)) throw new Error(`fixture edit: ${f}: no occurrence of ${JSON.stringify(from.slice(0, 70))}`); d.set(f, gz(t.split(from).join(to))); };
const edText = (d, file, from, to) => rep(d, file, from, to);
const SNAP_PAGES = [
  { file: "index.html", slug: "home", path: "/", ttfb: 238, lcp: 1840, cls: 0.02, tbt: 70 },
  { file: "about/index.html", slug: "about", path: "/about/", ttfb: 261, lcp: 2010, cls: 0.01, tbt: 95 },
  { file: "tasting-room/index.html", slug: "tasting-room", path: "/tasting-room/", ttfb: 244, lcp: 2230, cls: 0.04, tbt: 120 },
  { file: "journal/how-to-steep-oolong/index.html", slug: "journal__how-to-steep-oolong", path: "/journal/how-to-steep-oolong/", ttfb: 275, lcp: 1950, cls: 0, tbt: 60 },
];
const TRUSTED = "trusted";
const responseJson = (url, finalUrl, status, ttfbMs, extra = {}) => ({ url, finalUrl, status, chain: [{ url, status, ttfbMs }], headers: { "content-type": "text/html; charset=utf-8" }, ttfbMs, totalMs: ttfbMs + 40, htmlBytes: 4096, mainTextHash: null, fetchedAt: "2026-10-30T08:02:00.000Z", userAgent: "PEWP-SiteCheck/1.0", ...extra });
const browserJson = (url, lcpMs, cls, tbtMs) => ({ url, finalUrl: url, profile: "mobile", measuredAt: "2026-10-30T08:05:00.000Z", timedOut: false, vitals: { lcpMs, cls, tbtMs, fcpMs: Math.round(lcpMs * 0.6), ttfbMs: 240, loadMs: lcpMs + 600 }, method: "median of 3 run(s); other fields from the median-LCP run", totals: { requests: 14, bytes: 412000 }, errors: [] });

export function snapshotGood(good) {
  const d = new Map();
  const swap = (s) => s.split(O).join(SO);
  const robots = swap(need(good, "robots.txt"));
  const sitemap = swap(need(good, "sitemap.xml"));
  const entries = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)].map((m) => ({ kind: "url", loc: m[1], lastmod: m[2] }));
  const pagesMeta = [];
  for (const p of SNAP_PAGES) {
    const url = SO + p.path;
    d.set(`pages/${p.slug}/raw.html.gz`, gz(swap(need(good, p.file))));
    putJson(d, `pages/${p.slug}/response.json`, responseJson(url, url, 200, p.ttfb));
    putJson(d, `pages/${p.slug}/browser-mobile.json`, browserJson(url, p.lcp, p.cls, p.tbt));
    pagesMeta.push({ url, slug: p.slug, status: 200, finalUrl: url, redirects: 0, mobile: { lcpMs: p.lcp, cls: p.cls, tbtMs: p.tbt, requests: 14, kb: 402, errors: 0, timedOut: false, runs: 3 }, speedTrust: TRUSTED });
  }
  d.set("site/robots.txt", robots);
  putJson(d, "site/robots.json", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" }, bytes: Buffer.byteLength(robots), sitemaps: [SO + "/sitemap.xml"] });
  d.set("site/sitemap-1.xml", sitemap);
  putJson(d, "site/sitemaps.json", { declaredInRobots: [SO + "/sitemap.xml"], fetched: [{ url: SO + "/sitemap.xml", status: 200, contentType: "application/xml", bytes: Buffer.byteLength(sitemap), file: "site/sitemap-1.xml", entries: entries.length, withLastmod: entries.length, sampleLastmod: entries[0].lastmod }], urlCount: entries.length, urls: entries });
  putJson(d, "_site.json", { url: SO, origin: SO, startedAt: "2026-10-30T08:00:00.000Z", tool: "programmatic-enterprise-web-performance/snapshot-site.mjs", userAgent: "PEWP-SiteCheck/1.0", gapMs: 4000, runs: 3, maxPages: 16, perGroup: 2, profiles: ["mobile"], ignoreRobots: false, note: "synthetic fixture", pages: pagesMeta, skipped: [], stoppedEarly: null, machineLoad: { cpuPctAvg: 12.5, cpuPctMax: 31, samples: 40, thresholdPct: 35 }, finishedAt: "2026-10-30T08:09:41.000Z", requests: 31, rateLimited: 0 });
  return d;
}

const SM_ABOUT = urlBlock("/about/", T_ABOUT).split(O).join(SO);
const smBlock = (u, t) => urlBlock(u, t).split(O).join(SO);
// a crawled record that is not a normal 200 page: slug, the url crawled, the url it ended on, its chain and body
const addRecord = (d, { slug, url, finalUrl, status, chain, html }) => {
  putJson(d, `pages/${slug}/response.json`, responseJson(url, finalUrl, status, 250, { chain }));
  if (html !== undefined) d.set(`pages/${slug}/raw.html.gz`, gz(html));
  edJson(d, "_site.json", (m) => m.pages.push({ url, slug, status, finalUrl, redirects: chain.length - 1 }));
};
const NOT_FOUND_HTML = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Not found</title>\n</head>\n<body>\n<h1>Not found</h1>\n</body>\n</html>\n';
const linkAbout = (d, href) => edHtml(d, "about", ABOUT_LINK_TAIL, ABOUT_LINK_TAIL.replace("</p>", ` See also <a href="${href}">a page we link to</a>.</p>`));
const untrusted = (d) => edJson(d, "_site.json", (m) => { m.pages[0].speedTrust = "UNTRUSTED: machine busy (cpu avg 71%)"; });
const homeLab = (d, key, value) => edJson(d, "pages/home/browser-mobile.json", (m) => { m.vitals[key] = value; });
const psiFile = (lcpMs, strategy = "mobile") => ({ generatedAt: "2026-10-30T09:12:00.000Z", pages: [{ url: SO + "/", strategy, performance: 41, lcpMs, cls: 0.02, tbtMs: 120, fcpMs: 1500, speedIndexMs: 2600, fetchedAt: "2026-10-30T09:12:00.000Z", cacheFile: "cache/psi/home.json" }], failures: [] });
const ROBOTS_BAD_BYTES = Buffer.from("User-agent: *\nDisallow: /private/\n# caf\xe9 closed on Mondays\nSitemap: " + SO + "/sitemap.xml\n", "latin1");

export const SNAPSHOT_FIXTURES = {
  // the slice 1 rules on a snapshot: the mode shares the checks
  "snapshot-bad-MET-003": { expect: "skips a level", at: "<h4>Small print", edit: (d) => edHtml(d, "tasting-room", "<h2>Before you come</h2>", "<h2>Before you come</h2>\n<p>Bring a friend if you like.</p>\n<h4>Small print</h4>") },
  "snapshot-bad-MET-001-duplicate": { expect: "is also the title of", at: "<title>About", edit: (d) => edHtml(d, "tasting-room", TASTING_TITLE, ABOUT_TITLE) },
  "snapshot-bad-IDX-002-origin": { expect: "is not on the origin", count: 4, at: "www.example-tea.invalid", also: ["IDX-001"], edit: (d) => d.set("site/sitemap-1.xml", txt(d, "site/sitemap-1.xml").split(SO).join("https://www.example-tea.invalid")) },
  "snapshot-bad-URL-009-origin": { expect: "is not the origin", at: "rel=\"canonical\"", also: ["IDX-001"], edit: (d) => edHtmlAll(d, "about", `${SO}/about/`, "https://www.example-tea.invalid/about/") },
  // IDX-001: "extra" and "missing" need a complete crawl; a snapshot is a sample unless _site.json says complete
  "snapshot-bad-IDX-001-missing": { expect: "incomplete-crawl", status: "SKIP", edit: (d) => edText(d, "site/sitemap-1.xml", smBlock("/tasting-room/", T_TASTING), "") },
  "snapshot-bad-IDX-001-extra": { expect: "incomplete-crawl", status: "SKIP", edit: (d) => edText(d, "site/sitemap-1.xml", "</urlset>", smBlock("/ghost/", "2026-10-05T09:00:00Z") + "</urlset>") },
  "snapshot-bad-IDX-001-missing-complete": { expect: "is not in the sitemap", edit: (d) => { edText(d, "site/sitemap-1.xml", smBlock("/tasting-room/", T_TASTING), ""); edJson(d, "_site.json", (m) => { m.complete = true; }); } },
  "snapshot-bad-IDX-001-extra-complete": { expect: "extra", at: "/ghost/", edit: (d) => { edText(d, "site/sitemap-1.xml", "</urlset>", smBlock("/ghost/", "2026-10-05T09:00:00Z") + "</urlset>"); edJson(d, "_site.json", (m) => { m.complete = true; }); } },
  // IDX-004 http part (status 200, content type text/plain) and SE-001 judge the same robots.json; one fact breaks both
  "snapshot-bad-IDX-004-type": { expect: "not text/plain", also: ["SE-001"], edit: (d) => edJson(d, "site/robots.json", (m) => { m.headers["content-type"] = "text/html; charset=utf-8"; }) },
  "snapshot-bad-IDX-004-status": { expect: "answered 403, not 200", also: ["SE-001"], edit: (d) => { edJson(d, "site/robots.json", (m) => { m.status = 403; }); del(d, "site/robots.txt"); } },
  "snapshot-bad-IDX-004-wrong-sitemap": { expect: "is not the sitemap file", at: "other-sitemap.xml", edit: (d) => edText(d, "site/robots.txt", `Sitemap: ${SO}/sitemap.xml`, `Sitemap: ${SO}/other-sitemap.xml`) },
  // SE-001: robots.txt health
  "snapshot-bad-SE-001": { expect: "answered 500; Google", also: ["IDX-004"], edit: (d) => { edJson(d, "site/robots.json", (m) => { m.status = 500; }); del(d, "site/robots.txt"); } },
  "snapshot-bad-SE-001-404": { expect: "answered 404", status: "WARN", also: ["IDX-004"], edit: (d) => { edJson(d, "site/robots.json", (m) => { m.status = 404; }); del(d, "site/robots.txt"); } },
  "snapshot-bad-SE-001-429": { expect: "answered 429; Google", also: ["IDX-004"], edit: (d) => { edJson(d, "site/robots.json", (m) => { m.status = 429; }); del(d, "site/robots.txt"); } },
  "snapshot-bad-SE-001-type": { expect: "application/json", also: ["IDX-004"], edit: (d) => edJson(d, "site/robots.json", (m) => { m.headers["content-type"] = "application/json"; }) },
  "snapshot-bad-SE-001-bytes": { expect: "600000 bytes, the limit is 512000", edit: (d) => edJson(d, "site/robots.json", (m) => { m.bytes = 600000; }) },
  "snapshot-bad-SE-001-utf8": { expect: "not valid UTF-8", at: "caf", edit: (d) => { d.set("site/robots.txt", ROBOTS_BAD_BYTES); edJson(d, "site/robots.json", (m) => { m.bytes = ROBOTS_BAD_BYTES.length; }); } },
  // LNK-002 status part: what the crawl saw at the target
  "snapshot-bad-LNK-002-404": { expect: "answer 404, not 200", at: "/gone/", edit: (d) => { linkAbout(d, "/gone/"); addRecord(d, { slug: "gone", url: SO + "/gone/", finalUrl: SO + "/gone/", status: 404, chain: [{ url: SO + "/gone/", status: 404 }], html: NOT_FOUND_HTML }); } },
  "snapshot-bad-LNK-002-301": { expect: "redirect-target", at: "/old-tea/", edit: (d) => { linkAbout(d, "/old-tea/"); addRecord(d, { slug: "old-tea", url: SO + "/old-tea/", finalUrl: SO + "/tasting-room/", status: 200, chain: [{ url: SO + "/old-tea/", status: 301, location: "/tasting-room/" }, { url: SO + "/tasting-room/", status: 200 }], html: ungz(need(d, "pages/tasting-room/raw.html.gz")) }); } },
  "snapshot-bad-LNK-002-uncrawled": { expect: "not-crawled", status: "SKIP", edit: (d) => linkAbout(d, "/wholesale/") },
  // PRF-001: LCP, CLS and TBT budgets, the speed trust rule and the PSI preference
  "snapshot-bad-PRF-001": { expect: "LCP 3100 ms > 2500 ms", edit: (d) => homeLab(d, "lcpMs", 3100) },
  "snapshot-bad-PRF-001-cls": { expect: "CLS 0.25 > 0.1", edit: (d) => homeLab(d, "cls", 0.25) },
  "snapshot-bad-PRF-001-tbt": { expect: "TBT 350 ms > 200 ms", edit: (d) => homeLab(d, "tbtMs", 350) },
  "snapshot-bad-PRF-001-untrusted": { expect: "speed UNTRUSTED (machine busy (cpu avg 71%))", status: "SKIP", edit: (d) => { homeLab(d, "lcpMs", 3100); untrusted(d); } },
  "snapshot-bad-PRF-001-psi-fail": { expect: "LCP 3400 ms > 2500 ms (source: PSI 2026-10-30)", edit: (d) => { untrusted(d); add(d, "psi/2026-10-30.json", JSON.stringify(psiFile(3400), null, 1) + "\n"); } },
  "snapshot-bad-PRF-001-psi-pass": { expect: "", status: "PASS", edit: (d) => { homeLab(d, "lcpMs", 3100); untrusted(d); add(d, "psi/2026-10-30.json", JSON.stringify(psiFile(1900), null, 1) + "\n"); } },
  // PRF-016: one cold request over ttfbMs is a WARN
  "snapshot-bad-PRF-016": { expect: "TTFB 1900 ms > 600 ms (single cold request", status: "WARN", edit: (d) => edJson(d, "pages/home/response.json", (m) => { m.ttfbMs = 1900; }) },
  // slice 4c: the response header of every listed page says noindex, no target given: IDX-001 judges what the live site says (its meta tags say nothing)
  "snapshot-bad-IDX-001-header": { expect: "is noindex", count: 4, edit: (d) => { for (const p of SNAP_PAGES) edJson(d, `pages/${p.slug}/response.json`, (m) => { m.headers["x-robots-tag"] = "noindex"; }); } },
  // DSN (slice 4b): the design tells run on a snapshot's HTML too (its stylesheets are not in the snapshot)
  "snapshot-bad-DSN-003": { expect: "emoji", at: "What we sell", edit: (d) => edHtml(d, "home", "<h2>What we sell</h2>", "<h2>\u{1F375} What we sell</h2>") },
};

const isSnapshotName = (n) => n === "snapshot-good" || n.startsWith("snapshot-bad-");
// good-preview (slice 4c): the good site as a preview build ships it, with the /* noindex _headers; it passes with target preview
const GOOD_PREVIEW = "good-preview";
// good-coverage (slice 5c): the good site plus a coverage file in which every row is answered; it passes with --prompt-coverage plan/prompt-coverage.json
const GOOD_COVERAGE = "good-coverage";
const isFixtureName = (n) => n === GOOD_PREVIEW || n === GOOD_COVERAGE || n.startsWith("bad-") || isSnapshotName(n);

export function buildAll() {
  const good = readDir(path.join(HERE, "good"));
  const out = new Map();
  for (const [name, { edit }] of Object.entries(FIXTURES)) { const d = new Map(good); edit(d); out.set(name, d); }
  const preview = new Map(good); add(preview, "_headers", headersText({ preview: true })); out.set(GOOD_PREVIEW, preview);
  const covered = new Map(good); add(covered, COVERAGE_FILE, coverageText()); out.set(GOOD_COVERAGE, covered);
  const sg = snapshotGood(good);
  out.set("snapshot-good", sg);
  for (const [name, { edit }] of Object.entries(SNAPSHOT_FIXTURES)) { const d = new Map(sg); edit(d); out.set(name, d); }
  return out;
}

// every file of a folder as bytes (the folder fixtures are text, the snapshot ones hold .gz files and one latin-1 text)
function readDirBytes(dir) {
  const out = new Map();
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.set(path.relative(dir, p).split(path.sep).join("/"), fs.readFileSync(p)); } };
  walk(dir);
  return out;
}
const bytesOf = (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v, "utf8"));
const same = (rel, a, b) => { const x = bytesOf(a), y = bytesOf(b); if (/\.gz$/i.test(rel)) { try { return zlib.gunzipSync(x).equals(zlib.gunzipSync(y)); } catch { return false; } } return x.equals(y); };

export function diffAgainstDisk(built, root = HERE) {
  const problems = [];
  const onDisk = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && isFixtureName(e.name)).map((e) => e.name);
  for (const n of onDisk) if (!built.has(n)) problems.push(`stale fixture folder ${n} (no generator entry)`);
  for (const [name, files] of built) {
    const dir = path.join(root, name);
    const have = fs.existsSync(dir) ? readDirBytes(dir) : new Map();
    for (const [rel, text] of files) { if (!have.has(rel)) problems.push(`${name}/${rel} is missing on disk`); else if (!same(rel, have.get(rel), text)) problems.push(`${name}/${rel} differs from the generator output`); }
    for (const rel of have.keys()) if (!files.has(rel)) problems.push(`${name}/${rel} is on disk but not generated`);
  }
  return problems;
}

const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) {
  const built = buildAll();
  if (process.argv.includes("--check")) {
    const problems = diffAgainstDisk(built);
    for (const p of problems) console.log(p);
    console.log(problems.length ? `FAILED: ${problems.length} difference(s)` : `OK: ${built.size} fixture(s) equal the generator output`);
    process.exit(problems.length ? 1 : 0);
  }
  for (const e of fs.readdirSync(HERE, { withFileTypes: true })) if (e.isDirectory() && isFixtureName(e.name)) fs.rmSync(path.join(HERE, e.name), { recursive: true, force: true });
  for (const [name, files] of built) for (const [rel, text] of files) { const p = path.join(HERE, name, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.isBuffer(text) ? text : Buffer.from(text, "utf8")); }
  console.log(`wrote ${built.size} fixture(s)`);
}
void O; void add; void del; void copyPage;
