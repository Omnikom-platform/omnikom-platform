// client-copy-design.mjs: the approved design of the client copy, built in memory from the data of client-copy-data.mjs.
// Job R2a builds the frame (head, footer, style), page 1 (the cover) and page 2 (the summary); later jobs add pages 3 to 8 at the
// two anchor comments below (PAGES, ALL). Every drawn value goes through P/PC/sum and gets ONE sheet row (8 columns, as the old pages' sheet);
// a sentence that states a finding is printed only when the finding holds, else the build STOPs with one line naming page, sentence
// and condition. No client word is typed here: names, products and cities come from the data and the client file.
// Nothing is written here: the caller writes the html and the sheet. Not called by client-copy.mjs yet (the command keeps the old pages).
import { stop } from "./client-copy-data.mjs";

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
  const { D, S, fmt, w, draft, logoUrl, fontsUrl } = ctx;
  const NAME = D.biz.name, home = D.biz.home, MONTH = D.month;
  const sheet = [];
  let page = 0;
  const clean = (s) => String(s).replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[\t\r\n]+/g, " ").trim();
  const plain = (s) => String(s).replace(/[\u2014\u2013]/g, "-"); // text from the run: a dash becomes "-" (R4's gate stops any other)
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const andList = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  // cite: ONE sheet row for one drawn value: the sources of D[key] that `pick` keeps, joined with " | " in the five source columns; the label is not cut
  const cite = (key, printed, label, pick) => {
    const recs = (S[key] || []).filter((s) => !pick || s.where.includes(pick) || s.value.includes(pick));
    if (!recs.length) throw new Error(`build: no source for ${key}${pick ? ` matching ${pick}` : ""}`);
    const j = (f) => recs.map((s) => clean(s[f])).join(" | ");
    sheet.push([page, label, clean(printed), j("file"), j("where"), j("value"), j("measured"), j("kind")]);
  };
  const calc = (printed, label, how) => sheet.push([page, label, clean(printed), "(computed)", how, clean(printed), "(computed)", "COMPUTED"]);
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

  // @@PAGES
  const all = [p1, p2]; // @@ALL
  const spaced = all.join("\n").replace(/>(?=<(?!\/?(?:i|svg|rect|br)\b))/g, ">\n"); // a space between neighbours, so no label runs into its number when read as text
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(NAME)}: SEO, AI search and local audit, ${esc(MONTH)}${draft ? " (draft)" : ""}</title>
<link href="${fontsUrl}" rel="stylesheet"><style>${CSS}</style></head><body>
${spaced.replace(/@@TOTAL@@/g, String(all.length))}
</body></html>
`;
  const tsv = [["page", "the text it stands in", "printed", "file", "where in the file", "value there", "measured", "kind"], ...sheet].map((r) => r.map((x) => String(x).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n") + "\n";
  return { html, tsv, pages: all.length };
}
