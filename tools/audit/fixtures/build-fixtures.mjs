// Builds fixtures/bad-<RULE-ID>[-part]/ from fixtures/good plus one edit function per fixture. The results are committed as files so a
// reader sees them; test/run.mjs checks that the committed files equal this generator's output.
//   node tools/audit/fixtures/build-fixtures.mjs           write every bad fixture (stale bad-* folders are removed)
//   node tools/audit/fixtures/build-fixtures.mjs --check   write nothing, exit 1 when the committed files differ from the output
// Every edit is split/join on an exact text that must occur exactly once (rep) or at least once (repAll): a patch that does not apply
// throws, so a fixture can never silently equal the good site.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const O = "https://www.brindlewood-tea.example";

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
};

export function buildAll() {
  const good = readDir(path.join(HERE, "good"));
  const out = new Map();
  for (const [name, { edit }] of Object.entries(FIXTURES)) { const d = new Map(good); edit(d); out.set(name, d); }
  return out;
}

export function diffAgainstDisk(built, root = HERE) {
  const problems = [];
  const onDisk = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith("bad-")).map((e) => e.name);
  for (const n of onDisk) if (!built.has(n)) problems.push(`stale fixture folder ${n} (no generator entry)`);
  for (const [name, files] of built) {
    const dir = path.join(root, name);
    const have = fs.existsSync(dir) ? readDir(dir) : new Map();
    for (const [rel, text] of files) { if (!have.has(rel)) problems.push(`${name}/${rel} is missing on disk`); else if (have.get(rel) !== text) problems.push(`${name}/${rel} differs from the generator output`); }
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
  for (const e of fs.readdirSync(HERE, { withFileTypes: true })) if (e.isDirectory() && e.name.startsWith("bad-")) fs.rmSync(path.join(HERE, e.name), { recursive: true, force: true });
  for (const [name, files] of built) for (const [rel, text] of files) { const p = path.join(HERE, name, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text, "utf8"); }
  console.log(`wrote ${built.size} fixture(s)`);
}
void O; void add; void del; void copyPage;
