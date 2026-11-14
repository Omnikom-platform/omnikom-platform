// client-copy-design.mjs: the approved design of the client copy, built in memory from the data of client-copy-data.mjs.
// Jobs R2a to R3b build the frame (head, footer, style), page 1 (the cover) and pages 2 to 8 (summary, SEO, AI search, Maps, rivals, the plan,
// how Omnikom works); the two anchor comments below (PAGES, ALL) stay. Pages 7 and 8 take their words from plan.json and how-we-work.json. Every drawn value goes through P/PC/sum and gets ONE sheet row (8 columns);
// a sentence that states a finding is printed only when the finding holds, else the build STOPs with one line naming page, sentence
// and condition. No client word is typed here: names, products and cities come from the data and the client file.
// Nothing is written here: the caller writes the html and the sheet. client-copy.mjs calls it and writes the files.
import { stop } from "./client-copy-data.mjs";
import { tagOf as ruleTag } from "./client-copy-rules.mjs";

const steps = [];
for (let w = 800; w >= 320; w -= 20) steps.push(`@media screen and (max-width:${w}px){section{zoom:${(w / 816).toFixed(4)}}}`);
const CSS = `
:root{--paper:#F4F2EC;--ink:#15161B;--ink-2:#4A4C52;--ink-3:#7D7F85;--lime:#A8D41A;--hair:rgba(21,22,27,.14);}
@page{size:Letter;margin:0}
*{box-sizing:border-box}
html,body{margin:0;background:#DAD8D0;color:var(--ink);font:400 10pt/1.5 "Open Sans",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;-webkit-text-size-adjust:none;text-size-adjust:none}
section{position:relative;width:8.5in;height:10.99in;overflow:hidden;background:var(--paper);padding:.72in .7in .58in;margin:0 auto 16px;break-after:page;page-break-after:always}
section:last-child{break-after:auto;page-break-after:auto;margin-bottom:0}
section.cover{background:#fff;padding:0;color:#111214}
${steps.join("\n")}
@media screen{body{padding:16px 0}section{box-shadow:0 1px 8px rgba(0,0,0,.18)}}
@media print{html,body{background:var(--paper)}section{margin:0;box-shadow:none}section.cover{background:#fff;box-shadow:0 .02in 0 #fff}}
.rh{position:absolute;left:.7in;right:.7in;top:.3in;display:flex;justify-content:space-between;font:400 8pt/1 "Open Sans",sans-serif;color:var(--ink-3)}
.rh .nm{font-weight:600;color:var(--ink)}
.rf{position:absolute;left:.7in;right:.7in;bottom:.28in;display:flex;justify-content:space-between;font:400 8pt/1 "Open Sans",sans-serif;color:var(--ink-3)}
.rf b{font-weight:600;color:var(--ink)}
.cover .logo{position:absolute;left:.7in;top:.7in;height:.32in;filter:invert(1) grayscale(1) brightness(0)}
.cover .title{position:absolute;left:.7in;right:.7in;top:1.55in}
.cover .caps,.panel .caps{font:500 8.5pt/1 Montserrat,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8A8C92;margin:0 0 14pt}
.cover h1{font:300 34pt/1.1 Montserrat,sans-serif;letter-spacing:-.02em;margin:0;max-width:11em}
.cover h1+p{font:300 17pt/1.3 Montserrat,sans-serif;margin:14pt 0 0;color:#4A4C52}
.cover .panel{position:absolute;left:.7in;width:7.1in;top:4.6in;height:2.3in;background:#111214;color:#fff;padding:.32in .38in;display:flex;flex-direction:column;justify-content:flex-end}
.cover .panel .caps{color:#9A9BA1;margin:0 0 9pt}
.cover .panel .lead{font:400 18pt/1.35 Montserrat,sans-serif;margin:0;max-width:17em}
.cover .nums{position:absolute;left:.7in;right:.7in;top:7.85in;display:grid;grid-template-columns:repeat(3,1fr);gap:0 20pt;border-top:1px solid #111214}
.cover .num{padding-top:12pt}
.cover .num b{display:block;font:300 27pt/1 Montserrat,sans-serif;color:#111214;letter-spacing:-.02em}
.cover .num span{display:block;margin-top:6pt;font:300 9pt/1.45 Montserrat,sans-serif;color:#4A4C52}
.cover .scopeline{position:absolute;left:.7in;right:.7in;top:9.75in;margin:0;font:300 9pt/1.4 Montserrat,sans-serif;color:#4A4C52}
.cover .meta{position:absolute;left:.7in;right:.7in;bottom:.5in;display:flex;justify-content:space-between;font:500 8pt/1 Montserrat,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8A8C92}
.shead{border-top:1.4pt solid var(--ink);padding-top:9pt}
.label{font:600 7.8pt/1.3 "Open Sans",sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
h2{font:400 18pt/1.2 Montserrat,Arial,sans-serif;letter-spacing:-.01em;margin:6pt 0 8pt;max-width:26em}
h3{font:500 11pt/1.25 Montserrat,Arial,sans-serif;margin:12pt 0 5pt}
h3.m0{margin-top:0}
.lede{color:var(--ink-2);font-size:10pt;max-width:44em;margin:0 0 6pt}
.two{display:grid;grid-template-columns:1fr 1fr;gap:0 26pt}
.cols2{align-items:start}
.mt{margin-top:12pt}
.note{color:var(--ink-2);font-size:8.8pt;margin:6pt 0 0}
table{width:100%;border-collapse:collapse;font-size:9pt}
th{text-align:left;font:600 7.4pt/1.3 "Open Sans",sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);padding:0 8pt 5pt 0;border-bottom:1.2pt solid var(--ink)}
td{padding:4.5pt 8pt 4.5pt 0;border-bottom:1px solid var(--hair);vertical-align:middle}
td.r,th.r{text-align:right;padding-right:0;font-variant-numeric:tabular-nums}
td small{display:block;color:var(--ink-3);font-size:7.6pt;line-height:1.3}
.you td{font-weight:600;background:rgba(21,22,27,.05)}
.state{white-space:nowrap;font-weight:600}
.bc{width:34%;padding-right:10pt}
.bar{display:block;height:7pt;background:transparent;position:relative}
.bar i{display:block;height:100%;background:var(--ink-3)}
.bar.me i{background:var(--lime)}
.bars td{padding:3pt 8pt 3pt 0}
.bars td.r{padding-right:0}
.bars .bc{width:30%}
table.dem td:first-child{width:30%}
ul.have{list-style:none;margin:0;padding:0}
ul.have li{display:block;padding:6pt 0;border-bottom:1px solid var(--hair)}
ul.have b{display:block;font:300 18pt/1.1 Montserrat,sans-serif;letter-spacing:-.02em}
ul.have span{display:block;margin-top:2pt;font-size:9pt;color:var(--ink-2);line-height:1.4}
ol.back{list-style:none;margin:0;padding:0;counter-reset:b}
ol.back li{counter-increment:b;display:grid;grid-template-columns:.34in 1fr;padding:7pt 0;border-bottom:1px solid var(--hair);font-size:9.6pt}
ol.back li::before{content:counter(b);font:300 19pt/1 Montserrat,sans-serif;color:var(--ink-3)}
ol.back em{font-style:normal;color:var(--ink-3);font-size:8.4pt;white-space:nowrap}
.serps{display:grid;grid-template-columns:1fr 1fr;gap:0 18pt;margin-top:8pt}
.serp-h{font:600 7.6pt/1.3 "Open Sans",sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);border-bottom:1.2pt solid var(--ink);padding-bottom:4pt}
.serp ol{list-style:none;margin:0;padding:0}
.serp li{display:grid;grid-template-columns:.3in 1fr;align-items:center;padding:3pt 0;border-bottom:1px solid var(--hair)}
.serp .pos{font:300 15pt/1 Montserrat,sans-serif;color:var(--ink-3)}
.serp .rt{min-width:0}
.serp .rt b{display:block;font-weight:400;font-size:8.6pt;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.serp small{display:block;font-size:7.4pt;color:var(--ink-3);line-height:1.3}
.serp u{text-decoration:none;font-weight:600;color:var(--ink);border:1px solid var(--ink-3);border-radius:2pt;padding:0 3pt;margin-left:3pt;font-size:6.8pt}
.serp li.me{background:rgba(21,22,27,.05);border-left:4px solid var(--lime);padding-left:6pt;margin-top:0}
.serp li.me b{font-weight:600}
.first{margin:11pt 0 0;padding:10pt 0 8pt;border-top:1px solid var(--ink);border-bottom:1px solid var(--hair)}
.big1{font:400 13pt/1.3 Montserrat,sans-serif;margin:0 0 4pt;max-width:30em}
.sm1{margin:0;font-size:9pt;color:var(--ink-2)}
.lede+.sm1{margin-top:-2pt}
.addr3{display:grid;grid-template-columns:repeat(3,1fr);gap:0 14pt;border-top:1.2pt solid var(--ink)}
.addr3>div{padding:5pt 0;border-bottom:1px solid var(--hair);font-size:9pt}
.addr3 .al{display:block;font:600 7.4pt/1.3 "Open Sans",sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
.addr3 b{display:block;font-weight:400}
.fixes{margin:4pt 0 0;padding:0;list-style:none;counter-reset:f}
.fixes li{counter-increment:f;display:grid;grid-template-columns:.4in 1fr;padding:4.5pt 0;border-bottom:1px solid var(--hair)}
.fixes li::before{content:counter(f);font:300 19pt/1 Montserrat,sans-serif;color:var(--ink-3)}
.fixes li:first-child{border-left:4px solid var(--lime);padding-left:10pt;grid-template-columns:.32in 1fr}
.fixes b{font-weight:600;font-size:9.4pt}
.fixes span{display:block;color:var(--ink-2);font-size:9pt}
table.grid td{padding:4pt 8pt 4pt 0;font-size:8.2pt;vertical-align:top}
table.grid td.qq{width:34%;font-size:8.4pt}
table.grid td.qq u{text-decoration:none;color:var(--ink-3);font-size:7.2pt;display:block}
.dot{display:inline-block;width:8pt;height:8pt;border-radius:50%;border:1.3pt solid var(--ink);vertical-align:-1pt;margin-right:5pt;background:transparent}
.dot.on{background:var(--ink)}
.nm2{font-size:8pt;color:var(--ink-2)}
td .dot.on+.nm2{font-weight:600;color:var(--ink)}
.maps th.tc,.maps td.tc{text-align:center}
.maps td{padding:3pt 0;vertical-align:middle}
.maps td.pl{font-size:8.6pt;width:36%;padding-right:6pt}
.maps td.tc span{display:block;font-size:7.4pt;color:var(--ink-2);line-height:1.2;margin-top:1pt}
.maps svg{display:block;margin:0 auto}
.t3{fill:#15161B}.tl{fill:#fff;stroke:#15161B;stroke-width:1.1}.ta{fill:#DEDBD0}
.key{margin-top:7pt;font-size:8pt;color:var(--ink-2)}
.key svg{vertical-align:-1pt;margin:0 3pt 0 8pt}.key svg:first-child{margin-left:0}
.sbaT td{font-size:8.2pt;padding:3.5pt 5pt 3.5pt 0}
.sbaT td.mt2{white-space:nowrap}
.sbaT td.mt2 i{display:inline-block;width:4.2pt;height:7pt;margin-right:1pt;background:#DEDBD0}
.sbaT td.mt2 i.on{background:var(--ink)}
.sbaT .rv{font-size:7.6pt;color:var(--ink-2)}
.sbaT td.r,.sbaT td.rv{white-space:nowrap}
.q{color:var(--ink-3)}
u{text-decoration:none}
.sbaT u,.comp u{font-weight:600;font-size:6.8pt;border:1px solid var(--ink-3);border-radius:2pt;padding:0 3pt;margin-left:3pt}
.callout{margin:11pt 0 0;padding:8pt 12pt;background:#E9E8E4;border-left:4px solid var(--lime);font-size:9pt;color:var(--ink-2)}
.callout b{color:var(--ink);font-weight:600}
table.comp td{font-size:8.6pt;padding:3.4pt 8pt 3.4pt 0;white-space:nowrap}
table.comp td:first-child{width:30%}
table.comp .bc{width:26%}
table.plan td{padding:4pt 8pt 4pt 0;font-size:8.2pt;vertical-align:top;line-height:1.35}
table.plan td:first-child{font:300 15pt/1 Montserrat,sans-serif;color:var(--ink-3);width:.34in}
table.plan td:nth-child(2){width:32%;font-weight:600}
table.plan td:nth-child(3){width:35%}
table.plan td:nth-child(4){width:14%}
table.plan td.see{color:var(--ink-3);font-size:7.8pt;white-space:nowrap}
table.plan tr.first td:first-child{border-left:4px solid var(--lime);padding-left:6pt}
ol.steps{list-style:none;margin:6pt 0 0;padding:0}
ol.steps>li{display:grid;grid-template-columns:.5in 1fr;padding:8pt 0;border-top:1.2pt solid var(--ink)}
ol.steps .sn{font:300 24pt/1 Montserrat,sans-serif;color:var(--ink-3)}
ol.steps b{display:block;font:500 11.5pt/1.3 Montserrat,sans-serif}
ol.steps p{margin:2pt 0 0;color:var(--ink-2);font-size:9.2pt}
ol.steps.tight>li{padding:5pt 0}
ul.draft{margin:5pt 0 0;padding-left:13pt;color:var(--ink-2);font-size:9pt}
ul.draft li{margin:0 0 2pt}
.own{margin:10pt 0 0;font-size:9.2pt;color:var(--ink-2)}
.own b{color:var(--ink);font-weight:600}
.rep{display:grid;grid-template-columns:repeat(3,1fr);gap:0 16pt;border-top:1px solid var(--hair)}
.rep>div{padding:8pt 0;border-bottom:1px solid var(--hair)}
.rep b{display:block;font:300 22pt/1 Montserrat,sans-serif;letter-spacing:-.02em}
.rep span{display:block;margin-top:4pt;font-size:8.6pt;color:var(--ink-2)}
.goahead{margin-top:14pt;background:#111214;color:#fff;padding:16pt 22pt;display:grid;grid-template-columns:auto 1fr;gap:0 26pt;align-items:end}
.goahead .label{color:#9A9BA1;margin:0 0 6pt}
.goahead .big{font:300 20pt/1.2 Montserrat,sans-serif;margin:0}
.goahead .note2{margin:0;color:#C8C9CC;font-size:9.4pt}
table.wrong{margin-top:8pt}
table.wrong td{font-size:8.6pt;vertical-align:top}
`;

export function buildPages(ctx) {
  const { D, S, fmt, w, std, fixes, draft, logoUrl, fontsUrl, client } = ctx;
  const NAME = D.biz.name, home = D.biz.home, MONTH = D.month;
  const sheet = [], seenRows = new Set();
  const add = (row) => { const k = row.join("\u0001"); if (!seenRows.has(k)) { seenRows.add(k); sheet.push(row); } }; // an identical row is one row
  let page = 0;
  const clean = (s) => String(s).replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[\t\r\n]+/g, " ").trim();
  const plain = (s) => String(s).replace(/[\u2014\u2013]/g, "-"); // text from the run: a dash becomes "-" (R4's gate stops any other)
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const andList = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  // cite: ONE sheet row for one drawn value: the sources of D[key] that `pick` keeps, joined with " | " in the five source columns; the label is not cut
  const cite = (key, printed, label, pick) => {
    const recs = [].concat(key).flatMap((k) => S[k] || []).filter((s) => !pick || s.where.includes(pick) || s.value.includes(pick));
    if (!recs.length) throw new Error(`build: no source for ${key}${pick ? ` matching ${pick}` : ""}`);
    const j = (f) => recs.map((s) => clean(s[f])).join(" | ");
    add([page, plain(label), clean(printed), j("file"), j("where"), j("value"), j("measured"), j("kind")]);
  };
  const calc = (printed, label, how) => add([page, plain(label), clean(printed), "(computed)", how, clean(printed), "(computed)", "COMPUTED"]);
  const miss = (v) => v === null || v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v));
  // P: draw a value read from D[key] (never null) and give it a row; returns the html text
  const P = (key, shown, label, pick) => { if (miss(shown)) stop(`STOP: page ${page}, ${label}: the value is missing`); const t = plain(typeof shown === "number" ? fmt(shown) : shown); cite(key, t, label, pick); return esc(t); };
  // PC: the same for a value the build computes (a sum's total): file "(computed)"
  const PC = (shown, label, how) => { if (miss(shown)) stop(`STOP: page ${page}, ${label}: the value is missing`); const t = plain(shown); calc(t, label, how); return esc(t); };
  // sum: one row per addend ([part label, value, key, pick]) and one row for the total, label "<label> (addend: <part>)"
  const sum = (label, parts) => { let t = 0; for (const [pl, v, key, pick] of parts) { if (miss(v)) stop(`STOP: page ${page}, ${label}: the addend ${pl} is missing`); cite(key, fmt(v), `${label} (addend: ${pl})`, pick); t += v; } calc(fmt(t), label, `sum of the ${parts.length} addends above`); return t; };
  const rh = () => `<div class="rh"><span class="nm">${esc(NAME)}</span><span>SEO, AI search and local audit, ${esc(MONTH)}</span></div>`;
  const rf = (n) => `<div class="rf"><span>Prepared by Omnikom</span><b>${n} / @@TOTAL@@</b></div>`;
  const sheetPage = (n, inner) => `<section class="pg" id="p${n}">${rh()}<div class="in">${inner}</div>${rf(n)}</section>`;
  const head = (label, h, lede) => `<div class="shead"><div class="label">${label}</div></div><h2>${h}</h2>${lede ? `<p class="lede">${lede}</p>` : ""}`;
  const bar = (v, max, cls = "") => `<span class="bar ${cls}"><i style="width:${v <= 0 ? 0 : Math.max(0.8, (v / max) * 100).toFixed(2)}%"></i></span>`;
  // ---- the pages (R2a: 1 and 2). Each: page = n; const pN = (() => { ... })();
  // =============================================================== page 1: the cover
  page = 1;
  const p1 = (() => {
    const sv = D.serp, pp = D.productPages;
    if (!sv.outside || [...sv.engines].sort().join() !== "bing,google") stop("STOP: page 1, product searches read from outside your area on Google and Bing: serp.json has a localized capture or an engine other than google and bing");
    if (!(sv.productWithUs < sv.product)) stop("STOP: page 1, the verdict says buyers are shown other companies: every product search already shows your site");
    if (D.sitesRead.read === 0) stop("STOP: page 1, rival sites read: no rival site was read");
    const t1 = P("serp", `${sv.productWithUs} of ${sv.product}`, `${w.product} searches that show your site (of the results pages read)`, "where the query is a product search");
    const t2 = P("productPages", `${pp.listed} of ${pp.of}`, `${w.products} with a page of their own`);
    const t3 = P("wordsSent", `${D.wordsSent} words`, "words in the first response");
    const nRes = P("nPages", D.nPages, "results pages read");
    const nMaps = P("nPoints", D.nPoints, "Maps spots read");
    const nRiv = P("sitesRead", D.sitesRead.read, "rival sites read");
    const nAi = P("aiAsked", D.aiAsked, "AI assistants asked");
    return `<section class="cover" id="p1">
  <img class="logo" src="${logoUrl}" alt="Omnikom">
  <div class="title"><p class="caps">Audit</p><h1>SEO, AI search and local audit</h1><p>${esc(NAME)}<br>${P("month", MONTH, "month of the audit")}</p></div>
  <div class="panel"><p class="caps">What we found</p><p class="lead">Buyers who search for what you sell are shown other companies.</p></div>
  <div class="nums">
    <div class="num"><b>${t1}</b><span>${w.product} searches on Google and Bing that show your site, read from outside your area</span></div>
    <div class="num"><b>${t2}</b><span>${w.products} with a page of their own that Google or Bing list</span></div>
    <div class="num"><b>${t3}</b><span>in the first response your site sends to Google, Bing and ChatGPT (page 3)</span></div>
  </div>
  <p class="scopeline">${nRes} results pages, ${nMaps} Google Maps spots, ${nRiv} rival sites and ${nAi} AI assistants read.</p>
  <div class="meta"><span>Omnikom</span><span>${esc(MONTH)}</span></div>
</section>`;
  })();

  // =============================================================== page 2: the summary
  page = 2;
  const p2 = (() => {
    const sv = D.serp, pp = D.productPages, T = D.mapTiles, chat = D.ai.chat, perp = D.ai.perp, topP = D.topDemand;
    const F = T.rows.filter((r) => r.cells[0].counts["top three"] === r.cells[0].points); // products with every home spot in the top three, demand order
    const away = T.cities.slice(1), bing = D.directories.find((r) => /bing/i.test(r.directory));
    if (!(chat.named > 0)) stop("STOP: page 2, the headline says answers in ChatGPT: ChatGPT names the business on no question");
    if (!F.length) stop(`STOP: page 2, what already works: no ${w.product} has every ${home} spot in the top three`);
    const fList = andList(F.map((f) => f.lower));
    const homeTop = sum(`${home} spots in the top three, ${fList}`, F.map((f) => [f.lower, f.cells[0].counts["top three"], "mapTiles", "query=" + f.cells[0].query]));
    const homeOf = sum(`${home} spots read, ${fList}`, F.map((f) => [f.lower, f.cells[0].points, "mapTiles", "query=" + f.cells[0].query]));
    if (!bing || bing.status !== "listed") stop("STOP: page 2, your business on Bing Places: the Bing directory is not listed");
    const lines = [
      [P("rating", D.rating.rating, "Google rating", "reviews.rating"), `Google rating, from ${P("rating", D.rating.reviews, "Google reviews")} reviews`],
      [PC(`${homeTop} of ${homeOf}`, `${home} spots in the top three (sum)`, "sum, see the rows of this page"), `${esc(home)} spots where Google Maps puts you in its top three, ${esc(andList(F.map((f) => `for ${f.lower}`)))}`],
      [P("ai", `${chat.named} of ${chat.questions}`, "ChatGPT questions that name you", "summary.engines[engine=chatgpt]"), "questions to ChatGPT answered with your name"],
      [P("serp", `${sv.nameFirst} of ${sv.name}`, "searches for your name where your site is first", "holds the business's name"), "results pages for your name where your site comes first"],
      [P("directories", upperFirst(bing.status), "Bing Places", `directory=${bing.directory}`), "your business on Bing Places"],
    ];
    const awayTop = sum(`${andList(away)} spots in the top three`, T.rows.flatMap((r) => r.cells.slice(1).map((c) => [`${r.product}, ${c.city}`, c.counts["top three"], "mapTiles", "query=" + c.query])));
    const awayOf = sum(`${andList(away)} spots read`, T.rows.flatMap((r) => r.cells.slice(1).map((c) => [`${r.product}, ${c.city}`, c.points, "mapTiles", "query=" + c.query])));
    if (!away.length || awayTop >= awayOf) stop("STOP: page 2, away cities: there is none, or the business is in the top three at every spot");
    if (pp.listed >= pp.of) stop(`STOP: page 2, what holds you back: every ${w.product} has a page`);
    if (perp.named >= perp.questions || D.googleAi.named >= D.googleAi.total) stop("STOP: page 2, Perplexity and Google's AI answers: one of them already names the business on every question");
    const bad = [
      `Google and Bing list ${pp.listed === 0 ? "none" : "only " + P("productPages", pp.listed, `${w.products} listed`)} of your ${P("productPages", pp.of, w.products)} ${w.products}. <em>Page 3</em>`,
      `Perplexity names you on ${P("ai", `${perp.named} of ${perp.questions}`, "Perplexity questions that name you", "summary.engines[engine=perplexity]")} questions, and Google's AI answers on ${P("googleAi", `${D.googleAi.named} of ${D.googleAi.total}`, "Google AI answers that name you")} pages. <em>Page 4</em>`,
      `In ${esc(andList(away))}, Google Maps puts you in its top three at ${PC(`${awayTop} of ${fmt(awayOf)}`, "away spots in the top three", "sum, see the rows of this page")} spots. <em>Page 5</em>`,
    ];
    if (D.demand.length < 2) stop("STOP: page 2, what buyers search for: fewer than two products");
    const maxD = Math.max(...D.demand.map((r) => r.value));
    const dem = D.demand.map((d) => `<tr><td>${esc(d.product)}</td><td class="bc">${bar(d.value, maxD)}</td><td class="r">${P("demand", d.value, `Bing demand, ${d.product}`, `query=${d.key}&`)}</td><td class="r state">${P("demand", d.page ? "Listed" : "No page", `page of its own, ${d.product}`, "servicesMissing")}</td></tr>`).join("");
    const h = `You have ${P("rating", D.rating.rating, "rating")} stars and answers in ChatGPT, and still ${P("serp", `${sv.productWithUs} of ${sv.product}`, `${w.product} searches that show you`, "where the query is a product search")} ${w.product} searches show you.`;
    return sheetPage(2, `${head("Summary", h, "You are easy to trust and hard to find.")}
  <div class="two cols2">
    <div><h3>What you already have going for you</h3><ul class="have">${lines.map(([b, s]) => `<li><b>${b}</b><span>${s}</span></li>`).join("")}</ul></div>
    <div><h3>What holds you back</h3><ol class="back">${bad.map((t) => `<li>${t}</li>`).join("")}</ol></div>
  </div>
  <h3 class="mt">What buyers search for, and the page you have for it</h3>
  <table class="dem"><tr><th>${esc(upperFirst(w.product))}</th><th></th><th class="r">Bing, ${P("demandDays", D.demandDays, "days")} days</th><th class="r">Page of its own</th></tr>${dem}</table>
  <p class="note">${P("topDemand", `${topP.share}%`, `share of demand, ${topP.product}`)} of the demand for your ${pp.of} ${w.products} is for ${esc(topP.product)}. Bing's own figure for ${esc(D.demandWhere)}: how often it showed results for each search.</p>`);
  })();

  const rt = (s) => esc(plain(s)); // text from the run
  const fixesOl = (items) => `<h3>What to do</h3><ol class="fixes">${items.map(([b, s]) => `<li><div><b>${b}</b><span>${s}</span></div></li>`).join("")}</ol>`;

  // =============================================================== page 3: SEO
  page = 3;
  const p3 = (() => {
    const SL = D.serpLists, topP = D.topDemand;
    if (D.wordsSent !== 0) stop("STOP: page 3, the first thing your site sends is a blank page: the home page's first response holds words");
    if (!D.sitesRead.allSend) stop("STOP: page 3, every rival site we read sends its words at once: one of them sends none");
    if (!D.sitemapIsHome || D.sitemapPages !== 0) stop("STOP: page 3, your list of pages is a copy of the home page: the list the site gives Google is not one");
    if (D.notFoundStatus !== 200) stop(`STOP: page 3, a wrong address does not say page not found: it answers ${D.notFoundStatus}`);
    const tagOf = (...a) => { try { return ruleTag(...a); } catch (e) { stop(`STOP: page 3, the tag of a result: ${e.message}`); } };
    let tagged = 0, total = 0;
    const listHtml = (eng) => {
      const L = SL[eng];
      if (L.localized) stop(`STOP: page 3, ${eng} results read from outside your area: the capture of "${SL.query}" is localized`);
      if (L.ours !== null) stop(`STOP: page 3, none of the results is the business: ${eng} lists it at position ${L.ours}`);
      const rows = L.first5.map((r) => {
        const tag = tagOf(r.domain, D.approvedSet, w.otherKind);
        if (tag !== null && tag !== "government" && tag !== "your rival" && tag !== w.otherKind) stop(`STOP: page 3, ${eng} position ${r.position}, ${r.domain}: its tag is "${tag}", the headline counts only the government, "your rival" and "${w.otherKind}"`);
        if (tag !== null) tagged++;
        total++;
        const main = r.title ? rt(r.title) : rt(r.domain);
        return `<li><span class="pos">${P("serpLists", r.position, `${eng} position`, `engine=${eng}&`)}</span><div class="rt"><b>${main}</b><small>${rt(r.domain)}${tag !== null ? ` <u>${esc(tag)}</u>` : ""}</small></div></li>`;
      }).join("");
      return `<div class="serp"><div class="serp-h">${upperFirst(eng)}, read from outside your area</div><ol>${rows}<li class="me"><span class="pos"></span><div class="rt"><b>${esc(NAME)}</b><small>not among the ${P("serpLists", L.read, `results read on ${eng}`, `engine=${eng}&`)} results read</small></div></li></ol></div>`;
    };
    const gHtml = listHtml("google"), bHtml = listHtml("bing");
    const h = `For "${rt(SL.query)}", ${PC(tagged, `results that are the government or ${w.otherKind}`, "count of the results above that carry a tag")} of the ${PC(total, "results shown", "count of the results above")} results below are the government or ${esc(w.otherKind)}. None is you.`;
    const lede = `${P("topDemand", `${topP.share}%`, `share of demand, ${topP.product}`)} of the demand for your ${w.products} is for ${esc(topP.product)} (page 2). First five results, read on a computer.`;
    const you = D.wordsSent, riv3 = D.rivals.slice(0, 3);
    const maxW = Math.max(...riv3.map((r) => r.words), you);
    const wbars = [`<tr class="you"><td>Your site</td><td class="bc">${bar(you, maxW, "me")}</td><td class="r">${P("wordsSent", you, "words, your site")}</td></tr>`]
      .concat(riv3.map((r) => `<tr><td>${rt(r.printName)}</td><td class="bc">${bar(r.words, maxW)}</td><td class="r">${P("rivals", r.words, `words, ${r.printName}`, `sites[domain=${r.domain}]`)}</td></tr>`)).join("");
    const lcp = Number(D.lcpS), good = Number(D.goodLcpS);
    const sbars = [`<tr class="you"><td>Your site on a phone</td><td class="bc">${bar(lcp, Math.max(lcp, good), "me")}</td><td class="r">${P("lcpS", D.lcpS, "seconds, main picture on a phone")} s</td></tr>`, `<tr><td>Google's good mark</td><td class="bc">${bar(good, Math.max(lcp, good))}</td><td class="r">${P("goodLcpS", D.goodLcpS, "seconds, Google's good mark")} s</td></tr>`].join("");
    cite(["sitemapType", "sitemapPages"], `${D.sitemapType}, ${D.sitemapPages} urls`, "your list of pages is a copy of the home page");
    cite("notFoundStatus", `status ${D.notFoundStatus}`, "a wrong address on your site does not say 'page not found'");
    const fixes = [
      ["Send every page with its words in it.", "Part of the site we draft: the first response carries the words of every page."],
      ["Give Google a list of your pages, and a real \"page not found\".", "Today the list is a copy of your home page, and a wrong address does not say \"page not found\". The site we draft has both."],
    ];
    return sheetPage(3, `${head("SEO \u00b7 Found on Google and Bing", h, lede)}
  <div class="serps">${gHtml}${bHtml}</div>
  <div class="first">
    <p class="big1">The first thing your site sends Google, Bing and ChatGPT is a blank page.</p>
    <p class="sm1">Its words only appear after a program runs in a browser. Every one of the ${P("sitesRead", D.sitesRead.read, "rival sites that send words")} rival sites we read sends its words at once.</p>
  </div>
  <div class="two cols2">
    <div><h3>Words in the first response</h3><table class="bars">${wbars}</table></div>
    <div><h3>Seconds until your main picture shows</h3><table class="bars">${sbars}</table><p class="note">Measured with ${P("lcpStrategy", "PageSpeed Insights, on a phone", "source of the seconds until the main picture shows")}.</p></div>
  </div>
  ${fixesOl(fixes)}`);
  })();

  // =============================================================== page 4: AI search
  page = 4;
  const p4 = (() => {
    const G = D.aiGrid, pr = D.profiles, pp = D.productPages;
    for (const [e, k, E] of [["chatgpt", "chat", "ChatGPT"], ["perplexity", "perp", "Perplexity"]]) { const nm = G.rows.filter((x) => x[e].named).length; if (nm !== D.ai[k].named || G.rows.length !== D.ai[k].questions) stop(`STOP: page 4, ${E}: the answers read (${nm} of ${G.rows.length}) differ from the summary of ai-answers.json (${D.ai[k].named} of ${D.ai[k].questions})`); }
    if (D.faq === null) stop("STOP: page 4, FAQ answers marked: the home page has no FAQ heading");
    if (!(pr.inCard < pr.total)) stop("STOP: page 4, the fix Link your profiles: every profile is already linked");
    if (!D.aiInstead.length) stop("STOP: page 4, named instead: the run lists no business the assistants name instead");
    const chN = G.rows.filter((x) => x.chatgpt.named).length, peN = G.rows.filter((x) => x.perplexity.named).length;
    const cell = (x, qi, e, E) => {
      if (x[e].named) return `<td><i class="dot on"></i><span class="nm2">names you</span></td>`;
      const ns = x[e].instead;
      if (!ns.length) stop(`STOP: page 4, "${x.question}" on ${E}: the answer does not name the business and no business is named instead`);
      const shown = ns.slice(0, 2).map(rt).join(", ");
      const more = ns.length > 2 ? ` and ${P("aiGrid", ns.length - 2, `more businesses named, question ${qi + 1}, ${E}`)} more` : "";
      return `<td><i class="dot"></i><span class="nm2">${shown}${more}</span></td>`;
    };
    const rows = G.rows.map((x, qi) => `<tr><td class="qq">${rt(x.question)}${x.type === "brand" ? " <u>asks for you by name</u>" : ""}</td>${cell(x, qi, "chatgpt", "ChatGPT")}${cell(x, qi, "perplexity", "Perplexity")}</tr>`).join("");
    const insHtml = D.aiInstead.map((a) => `<tr><td>${rt(a.name)}</td><td class="r">${P("aiInstead", a.count, `answers naming ${a.name}`, `${a.name} ${a.count}`)}</td></tr>`).join("");
    const prodStat = `${P("productPages", pp.listed, `${w.products} with a page`)} of ${P("productPages", pp.of, w.products)}`;
    const faqStat = `${P("faq", D.faq.marked, "FAQ answers marked", "FAQPage")} of ${P("faq", D.faq.of, "FAQ answers", "headings")}`;
    const profStat = `${P("profiles", pr.inCard, "profiles linked", "sameAs")} of ${P("profiles", pr.total, "profiles", "rows (length)")}`;
    const h = `ChatGPT names you on ${P("ai", `${chN} of ${G.rows.length}`, "ChatGPT", "summary.engines[engine=chatgpt]")} questions. Perplexity names you on ${P("ai", `${peN} of ${G.rows.length}`, "Perplexity", "summary.engines[engine=perplexity]")}, and Google's AI answers on ${P("googleAi", `${D.googleAi.named} of ${D.googleAi.total}`, "Google AI answers that name you")} pages.`;
    const fixes = [[`Link your ${P("profiles", pr.total, "profiles to link", "rows (length)")} profiles in the company details your site gives Google.`, `Included in the site we draft. Today ${profStat} are linked.`]];
    return sheetPage(4, `${head("AI search \u00b7 GEO and AEO", h, `${P("aiGrid", G.rows.length, "questions asked")} questions a buyer would ask, put to ChatGPT and to Perplexity. A filled dot means the answer names you; a ring means it names other businesses.`)}<p class="sm1" style="margin-bottom:13px">GEO: being named by AI assistants. AEO: a page built to be the answer.</p>
  <table class="grid"><tr><th>The question</th><th>ChatGPT</th><th>Perplexity</th></tr>${rows}</table>
  <div class="two cols2 mt">
    <div><h3>Named instead, across ${P("ai", D.ai.answers, "answers from both assistants", "summary.questions")} answers</h3><table class="bars">${insHtml}</table></div>
    <div><h3>Is a page built to be the answer?</h3><table class="bars"><tr><td>A page for each ${w.product}</td><td class="r state">${prodStat}</td></tr><tr><td>FAQ answers marked so Google can quote them</td><td class="r state">${faqStat}</td></tr><tr><td>Profiles linked in the company details Google reads</td><td class="r state">${profStat}</td></tr></table><p class="note">Today the first response holds no words for an AI answer to use (page 3).</p></div>
  </div>
  ${fixesOl(fixes)}`);
  })();

  // ---- helpers of pages 5 and 6
  const numberWord = (n) => { const W9 = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]; if (!(n >= 0 && n <= 10)) stop(`STOP: page ${page}, a count of ${n} has no word (zero to ten)`); return W9[n]; };
  const ordinal = ["first", "second", "third", "fourth", "fifth"];
  // one square per Maps spot (3 by 3): the state of each spot as the data layer's tile holds it
  const tile = (v, product, city) => {
    const cls = { "top three": "t3", listed: "tl", absent: "ta" };
    const cells = [];
    for (let r = 0; r < 3; r++) for (let cc = 0; cc < 3; cc++) cells.push(`<rect class="${cls[v.tile[r][cc]]}" x="${cc * 10 + 0.6}" y="${r * 10 + 0.6}" width="8.8" height="8.8"/>`);
    const t3 = v.counts["top three"], li = v.counts.listed, ab = v.counts.absent;
    return `<svg viewBox="0 0 30 30" width="24" height="24" role="img" aria-label="${esc(plain(product))}, ${esc(plain(city))}: ${t3} in the top three, ${li} listed lower, ${ab} not listed">${cells.join("")}</svg>`;
  };
  const keyHtml = `<div class="key"><svg viewBox="0 0 10 10" width="9" height="9"><rect class="t3" x=".6" y=".6" width="8.8" height="8.8"/></svg> Top three <svg viewBox="0 0 10 10" width="9" height="9"><rect class="tl" x=".6" y=".6" width="8.8" height="8.8"/></svg> Listed <svg viewBox="0 0 10 10" width="9" height="9"><rect class="ta" x=".6" y=".6" width="8.8" height="8.8"/></svg> Absent</div>`;

  // =============================================================== page 5: Maps and reputation
  page = 5;
  const p5 = (() => {
    const T = D.mapTiles, MS = D.mapShown, rr = D.rivalReviews, per = T.per, topP = D.topDemand;
    const away = T.cities.slice(1), bing = D.directories.find((r) => /bing/i.test(r.directory)), notListed = D.directories.filter((r) => r.status === "not listed");
    // page 2 has stopped the build already when there is no away city, the business is in the top three at every away spot, or the Bing directory is not listed
    if (MS.clientAt < 0 || MS.clientAt > 4) stop(`STOP: page 5, you are in this list: the business is not among the first five businesses Maps shows in its top three for "${MS.query}"`);
    const you = MS.rows[MS.clientAt];
    if (you.reviews !== D.rating.reviews) stop(`STOP: page 5, your reviews: the pack rows show ${you.reviews}, the profile shows ${D.rating.reviews}`);
    if (MS.points !== per) stop(`STOP: page 5, who Maps shows: ${MS.points} points for "${MS.query}", the tile has ${per}`);
    if (D.addresses.length < 2) stop("STOP: page 5, one business with several addresses: the run holds one address");
    if (!notListed.length || notListed.length > 10) stop(`STOP: page 5, the directories to claim: ${notListed.length} are not listed (1 to 10 are written out)`);
    if (!(rr.more > 0)) stop("STOP: page 5, the fix asks for reviews: no business in Maps' top three shows more reviews than yours");
    const trs = T.rows.map((r) => `<tr><td class="pl">${rt(r.product)}</td>${r.cells.map((c) => `<td class="tc">${tile(c, r.product, c.city)}<span>${P("mapTiles", `${c.counts["top three"]} of ${c.points}`, `${r.product}, ${c.city}: top three`, `query=${c.query}`)}</span></td>`).join("")}</tr>`).join("");
    const homeTop = sum(`${home} spots in the top three`, T.rows.map((r) => [r.product, r.cells[0].counts["top three"], "mapTiles", `query=${r.cells[0].query}`]));
    const homeOf = sum(`${home} spots read`, T.rows.map((r) => [r.product, r.cells[0].points, "mapTiles", `query=${r.cells[0].query}`]));
    const awayTop = sum("away-city spots in the top three", T.rows.flatMap((r) => r.cells.slice(1).map((c) => [`${r.product}, ${c.city}`, c.counts["top three"], "mapTiles", `query=${c.query}`])));
    const awayOf = sum("away-city spots read", T.rows.flatMap((r) => r.cells.slice(1).map((c) => [`${r.product}, ${c.city}`, c.points, "mapTiles", `query=${c.query}`])));
    const h = `On Google Maps you are in the top three at ${PC(`${homeTop} of ${homeOf}`, `${home} spots in the top three`, "sum, see the rows of this page")} ${rt(home)} spots, and at ${PC(`${awayTop} of ${fmt(awayOf)}`, "away spots in the top three", "sum, see the rows of this page")} in ${rt(andList(away))}.`;
    const tableRows = MS.rows.slice(0, 5).map((r) => {
      const meter = Array.from({ length: per }, (_, i) => `<i${i < r.inThree ? ' class="on"' : ""}></i>`).join("");
      const rev = r.reviews === null ? `<span class="q">no count shown</span>` : `${P("mapShown", r.reviews, `reviews, ${r.name}`)} reviews`;
      return `<tr${r.isTheClient ? ' class="you"' : ""}><td>${rt(r.name)}${r.isTheClient ? " <u>you</u>" : ""}</td><td class="mt2">${meter}</td><td class="r">${P("mapShown", `${r.inThree} of ${per}`, `spots in the top three, ${r.name}`)}</td><td class="r rv">${rev}</td></tr>`;
    }).join("");
    const youLine = `You are in this list: ${ordinal[MS.clientAt]} most often, at ${P("mapShown", `${you.inThree} of ${per}`, `your spots in the top three, ${topP.product}`)} spots, with ${P("mapShown", you.reviews, "your reviews")} reviews.`;
    const addrHtml = D.addresses.map((a) => `<div><span class="al">${rt(andList(a.where))}</span> <b>${P("addresses", a.address, `address shown, ${andList(a.where)}`, a.address)}</b></div>`).join("");
    cite("directories", String(notListed.length), "directories where you are not listed", "not listed");
    cite("directories", "Listed", "Bing Places: listed or not", `directory=${bing.directory}`);
    const rvLine = `${P("rivalReviews", rr.more, `businesses in Maps' top three around ${home} with more reviews`)} of the ${P("rivalReviews", rr.of, `businesses in Maps' top three around ${home}`)} businesses in Maps' top three around ${rt(home)} show more reviews than your ${P("rivalReviews", rr.ours, "your reviews")}.`;
    const fixes = [
      ["Show one address everywhere.", "Tell us which one is right. The site we draft shows it."],
      [`Fill in your Google profile and claim ${andList(notListed.map((r) => rt(r.name)))}.`, `You are listed on Bing Places and on none of those ${numberWord(notListed.length)}.`],
      [`Ask every ${w.pastCustomer} for a review, and reply to each one.`, rvLine],
    ];
    return sheetPage(5, `${head("Local and reputation", h, `Google Maps was read at ${P("mapTiles", per, "spots around each city", `query=${T.rows[0].cells[0].query}`)} spots around each city, for each ${w.product}. One square is one spot.`)}
  <div class="two cols2">
    <div><table class="maps"><tr><th></th>${T.cities.map((c) => `<th class="tc">${rt(c)}</th>`).join("")}</tr>${trs}</table>${keyHtml}</div>
    <div>
      <h3 class="m0">${rt(topP.product)} in ${rt(home)}: who Maps shows in its top three</h3>
      <table class="sbaT">${tableRows}</table>
      <p class="note">${youLine}</p>
    </div>
  </div>
  <h3 class="mt">${P("addresses", D.addresses.length, "addresses for one business")} addresses for one business</h3>
  <div class="addr3">${addrHtml}</div>
  <p class="note">Check it: compare the address on your site with the one on Google Maps.</p>
  ${fixesOl(fixes)}`);
  })();

  // =============================================================== page 6: competitors
  page = 6;
  const p6 = (() => {
    const RV = D.rivals, local = RV.filter((r) => r.group === "local"), lnk = (r) => (r.links === null ? "none found" : r.links), LP = D.linkPlaces;
    // page 3 has stopped the build already when the home page sends words
    if (!client.rivalsLede) stop("STOP: page 6, the lede: the client file has no rivalsLede");
    if (local.length !== 2) stop(`STOP: page 6, the headline names two ${home} rivals: the client file marks ${local.length} rivals as group local`);
    if (local.some((r) => r.words === 0)) stop("STOP: page 6, the headline says your rivals send words and you send none: a local rival sends none");
    if (!D.ads.length || new Set(D.ads.map((a) => a.days)).size !== 1) stop("STOP: page 6, Google's ad library line: no rival has an ad count with its window, or the windows differ");
    if (!(client.linkPlace && LP.metro > 0 && !D.ourLinks && LP.pursue > 0)) stop("STOP: page 6, the chambers fix: the client file names no linkPlace, it links to no rival, it links to you, or no place is worth asking");
    const pk = (r, kind) => (kind === "sites" ? `sites[domain=${r.domain}]` : `results[domain=${r.domain}]`);
    const h = `Your ${PC(numberWord(local.length), `${home} rivals`, "count of the rivals of group local")} ${rt(home)} rivals send ${P("rivals", local[0].words, "words, first local rival", pk(local[0], "sites"))} and ${P("rivals", local[1].words, "words, second local rival", pk(local[1], "sites"))} words and have ${P("rivals", local[0].links, "sites linking, first local rival", pk(local[0], "links"))} and ${P("rivals", local[1].links, "sites linking, second local rival", pk(local[1], "links"))} sites linking to them. You send ${P("wordsSent", D.wordsSent, "your words")}.`;
    const maxW = Math.max(...RV.map((r) => r.words));
    const youRow = `<tr class="you"><td>${rt(NAME)}<small>you</small></td><td class="bc">${bar(D.wordsSent, maxW, "me")}</td><td class="r">${P("wordsSent", D.wordsSent, "your words")}</td><td class="r">${P("sitemapPages", D.sitemapPages, "your pages in the sitemap")}</td><td class="r">${P("usLinks", D.usLinks === null ? "none found" : D.usLinks, "sites linking to you")}</td></tr>`;
    const rows = RV.map((r) => `<tr><td>${rt(r.printName)}<small>${rt(r.type)}</small></td><td class="bc">${bar(r.words, maxW)}</td><td class="r">${P("rivals", r.words, `words, ${r.printName}`, pk(r, "sites"))}</td><td class="r">${P("rivals", r.sitemap, `pages, ${r.printName}`, pk(r, "sites"))}</td><td class="r">${P("rivals", lnk(r), `sites linking, ${r.printName}`, pk(r, "links"))}</td></tr>`).join("");
    const nameOf = (a) => { const r = RV.find((x) => x.domain === a.domain); return r ? r.printName : a.domain; };
    const adPart = (a) => { const n = P("ads", a.count, `ads, ${nameOf(a)}`, `advertiser=${a.domain}`); return a.count === 0 ? `none for ${rt(nameOf(a))}` : `${n} ${a.count === 1 ? "ad" : "ads"} for ${rt(nameOf(a))}`; };
    const adLine = `Google's ad library shows ${andList(D.ads.map(adPart))} in the last ${P("ads", D.ads[0].days, "days of the ad library window", `advertiser=${D.ads[0].domain}`)} days.`;
    const fixes = [[`Join the ${rt(home)} chambers and ask for listings.`, `We found ${P("linkPlaces", LP.pursue, "places worth asking for a listing", "summary.PURSUE")} places worth asking, ${P("linkPlaces", LP.chambers, "of them chambers of commerce", "chamber-local")} of them chambers of commerce. ${rt(client.linkPlace)} links to ${P("linkPlaces", LP.metro, `rivals linked from ${client.linkPlace}`, "opportunities[")} of the businesses you compete with, and not to you. You and Omnikom ask together.`]];
    return sheetPage(6, `${head("Competitors", h, rt(client.rivalsLede))}
  <table class="comp"><tr><th>Business</th><th colspan="2">Words in the first response</th><th class="r">Pages in the list it gives Google</th><th class="r">Other sites pointing to it</th></tr>${youRow}${rows}</table>
  <p class="note">${adLine}</p>
  ${fixesOl(fixes)}`);
  })();

  // =============================================================== page 7: the action plan
  page = 7;
  const p7 = (() => {
    const pr = D.profiles, T7 = D.topDemand, leadRead = D.formFields !== null, lcpSlow = Number(D.lcpS) > Number(D.goodLcpS);
    // the rows are data (plan.json); a rule decides whether a row is printed; a placeholder is filled from the data and drawn as a sheet row
    const RULES = {
      wordsSentIsZero: () => D.wordsSent === 0,
      profileLinkBroken: () => pr.broken.length > 0,
      noAnalyticsTag: () => D.outsideOnlyFonts,
      leadPathRead: () => leadRead,
      topProductHasNoPage: () => !T7.page,
      otherProductsHaveNoPage: () => D.demand.slice(2).some((r) => !r.page),
      addressesDiffer: () => D.addresses.length > 1,
      mailProblem: () => D.mail !== null && (D.mail.spf !== 1 || D.mail.dmarcMissing || !D.mail.dkimFound),
      trustRead: () => D.licenceWords !== null,
      linkPlacesFound: () => Boolean(client.linkPlace) && D.linkPlaces.metro > 0 && !D.ourLinks,
      phoneIsSlow: () => lcpSlow,
      profilesNotInCard: () => pr.inCard < pr.total,
    };
    const PH = {
      wordsSent: () => P("wordsSent", D.wordsSent, "words from the home page"),
      brokenApply: () => { cite("profiles", pr.broken.length, `profile links that open an error page (${pr.broken.join(", ")})`, "linksBroken"); return rt(andList(pr.broken)); },
      spfClause: () => (D.mail.spf > 1 ? ` (one sender record, not ${P("mail", D.mail.spf, "sender records found")})` : ""),
      takes: () => {
        if (D.takes === null) stop("STOP: page 7, the first step of the application matches a promise: the client file has no promisePattern or the home page holds none");
        return P("takes", D.takes, `${D.takes.replace(/\d+/, "N")}, on the home page`);
      },
      applicant: () => esc(w.applicant), application: () => esc(w.application), offers: () => esc(w.offers), applying: () => esc(w.applying), product: () => esc(w.product),
      home: () => rt(home), linkPlace: () => rt(client.linkPlace), topProduct: () => rt(T7.lower), secondLower: () => rt(D.demand[1].lower),
      claimList: () => rt(andList(D.directories.filter((r) => r.status === "not listed").map((r) => r.name))),
      fieldsRange: () => {
        if (!D.formAsks.taxId || !D.formAsks.ssn || !(D.formFieldsOne < D.formFields)) stop("STOP: page 7, the application row names a tax ID, each owner's SSN and a range of fields: the form asks for less or has no optional part");
        return `${P("formFieldsOne", D.formFieldsOne, "fields, one owner")} to ${P("formFields", D.formFields, "fields, two owners")}`;
      },
      topShare: () => P("topDemand", `${T7.share}%`, `share of demand, ${T7.product}`),
      otherCount: () => P("demand", D.demand.length - 2, `other ${w.product} pages`),
      listedOrNone: () => (D.productPages.listed === 0 ? "none" : P("productPages", D.productPages.listed, `${w.products} listed`)),
      addrCount: () => P("addresses", D.addresses.length, "addresses"),
      renewClause: () => (D.renewBy ? `; renew the domain before ${P("renewBy", D.renewBy, "domain expiry")}` : ""),
      linkMetro: () => P("linkPlaces", D.linkPlaces.metro, `rivals linked from ${client.linkPlace}`, "opportunities["),
      lcpS: () => P("lcpS", D.lcpS, "seconds on a phone"),
      goodLcpS: () => P("goodLcpS", D.goodLcpS, "seconds, Google's mark"),
      profilesTotal: () => {
        if (pr.inCard !== 0) stop("STOP: page 7, the profiles row says none is linked: some are");
        return P("profiles", pr.total, "profiles", "rows (length)");
      },
    };
    for (const f of fixes) {
      if (!RULES[f.when]) stop(`STOP: plan.json row ${f.id} names the rule ${f.when}`);
      for (const t of [f.fix, f.gets]) for (const m of String(t).matchAll(/\{(\w+)\}/g)) if (!PH[m[1]]) stop(`STOP: plan.json row ${f.id} names {${m[1]}}`);
    }
    const live = fixes.filter((f) => RULES[f.when]()), memo = {};
    const ph = (k) => (k in memo ? memo[k] : (memo[k] = PH[k]()));
    const fill = (t) => String(t).split(/(\{\w+\})/).map((s) => (/^\{\w+\}$/.test(s) ? ph(s.slice(1, -1)) : esc(s))).join("");
    for (const k of ["takes", "brokenApply", "spfClause"]) if (live.some((f) => `${f.fix} ${f.gets}`.includes(`{${k}}`))) ph(k); // drawn before the rows, in this order
    const R = live.map((f) => [fill(f.fix), fill(f.gets), f.who, f.see]);
    PC(String(R.length), "number of fixes", "count of the plan rows printed");
    if (live.some((f) => f.when === "trustRead")) {
      if (D.licenceWords !== 0) stop("STOP: page 7, the licence row says your home page shows no license wording: it shows some");
      cite("licenceWords", D.licenceWords, "licence wording on the home page");
    }
    if (live.some((f) => f.when === "noAnalyticsTag")) cite("outsideOnlyFonts", "fonts only", "analytics host in the test visit");
    if (live.some((f) => f.when === "mailProblem")) cite("mail", `spf ${D.mail.spf}, dmarc ${D.mail.dmarcMissing ? "missing" : "found"}`, "domain's sender records, DMARC");
    const rowsHtml = R.map(([fx, gt, wh, se], i) => `<tr${i === 0 ? ' class="first"' : ""}><td>${i + 1}</td><td>${fx}</td><td>${gt}</td><td>${esc(wh)}</td><td class="see">${esc(se)}</td></tr>`).join("");
    return sheetPage(7, `${head("Action plan", `${PC(String(R.length), "fixes", "count of the plan rows printed")} fixes, in the order that decides whether a ${esc(w.buyer)} finds you and ${esc(w.applies)}.`, "Start at the top. Each line says what you get.")}
  <table class="plan"><tr><th>#</th><th>Fix</th><th>What you get</th><th>Who</th><th>Told on</th></tr>${rowsHtml}</table>`);
  })();

  // =============================================================== page 8: how Omnikom works
  page = 8;
  const p8 = (() => {
    const v2 = Object.keys(D).filter((k) => k.startsWith("v2_")), steps = std.nextSteps, pp = D.productPages;
    for (const k of v2) if (!D[k]) stop(`STOP: page 8, what is in the draft: the product book rows of ${k.slice(3)} do not all read WORKS`);
    if (!Array.isArray(steps) || steps.length !== 4) stop("STOP: page 8, the four steps: how-we-work.json does not hold 4 steps");
    cite(v2, v2.flatMap((k) => JSON.parse(S[k][0].value)).join(" "), "product rows that read WORKS");
    steps.forEach((s, i) => add([page, `step ${i + 1} title`, s[1], "client-copy/how-we-work.json", `nextSteps[${i}]`, s[1], "(not dated)", "STANDARD COPY"]));
    const bullet = (t) => String(t).split(/(\{\w+\})/).map((s) => (s === "{n}" ? P("productPages", pp.of, `${w.products}`) : s === "{products}" ? esc(w.products) : esc(s))).join("");
    const stepHtml = steps.map((s, i) => `<li><span class="sn">${i + 1}</span><div><b>${esc(s[1])}</b><p>${esc(s[2])}</p>${i === 0 ? `<ul class="draft">${std.draftContains.map((t) => `<li>${bullet(t)}</li>`).join("")}</ul>` : ""}</div></li>`).join("");
    const nums = `<div class="rep"><div><b>${P("serp", `${D.serp.productWithUs} of ${D.serp.product}`, `${w.product} searches that show you`, "where the query is a product search")}</b><span>${esc(w.product)} searches that show your site</span></div><div><b>${P("productPages", `${pp.listed} of ${pp.of}`, `${w.products} with a page`)}</b><span>${esc(w.products)} with a page of their own</span></div><div><b>${P("wordsSent", `${D.wordsSent} words`, "words in the first response")}</b><span>in the first response your site sends</span></div></div>`;
    return sheetPage(8, `${head("How Omnikom works", `We draft your whole website, you look at it, it goes live, and for ${esc(steps[3][1])} we keep it in place and report the numbers.`, "")}
  <ol class="steps">${stepHtml}</ol>
  <p class="own"><b>Your leads are yours.</b> Export them to a spreadsheet at any time, and take a full copy of your data if you leave.</p>
  <h3>The numbers we report against, as they are today</h3>${nums}
  <div class="goahead"><div><p class="label">To go ahead</p><p class="big">${esc(std.goAhead)}</p></div><div><p class="note2">${esc(std.promise.replace("{outcome}", w.outcome))}</p></div></div>`);
  })();
  // @@PAGES
  const all = [p1, p2, p3, p4, p5, p6, p7, p8]; // @@ALL
  page = all.length; PC(String(all.length), "page count in the footers", "number of sections built");
  const spaced = all.join("\n").replace(/>(?=<(?!\/?(?:i|svg|rect|br)\b))/g, ">\n"); // a space between neighbours, so no label runs into its number when read as text
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(NAME)}: SEO, AI search and local audit, ${esc(MONTH)}${draft ? " (draft)" : ""}</title>
<link href="${fontsUrl}" rel="stylesheet"><style>${CSS}</style></head><body>
${spaced.replace(/@@TOTAL@@/g, String(all.length))}
</body></html>
`;
  const tsv = [["page", "the text it stands in", "printed", "file", "where in the file", "value there", "measured", "kind"], ...sheet].map((r) => r.map((x) => String(x).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n") + "\n";
  return { html, tsv, pages: all.length };
}
