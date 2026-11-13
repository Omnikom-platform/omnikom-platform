// The 8 pages of the client copy, built in memory from the data of client-copy-data.mjs and the wording that is data
// (client-copy/*.json). Same design as the first client copy: page order, layout, fonts, colours, logo. A text that states a
// finding is printed only when the finding holds. Nothing is written here: the caller writes the HTML and the sheet.
import { stop } from "./client-copy-data.mjs";

const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ctx: { D, S, fmt, w (the words), std (standard copy), fixes (the plan's rows), contact (text or null), draft, notRead (list of texts),
//        client (linkCompare, linkPlace, rivalsLede), logoUrl, fontsUrl }
export function buildPages(ctx) {
  const { D, S, fmt, w, std, fixes: fixRows, contact, draft, notRead, client, logoUrl, fontsUrl } = ctx;
  const name = D.biz.name, home = D.biz.home, short = D.biz.shortName;

  // ---- the sheet: one row per number and per factual claim, in page order
  const sheet = [];
  let page = 0;
  const clean = (s) => String(s).replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[\t\r\n]+/g, " ").trim();
  const cut = (s) => { s = clean(s); return s.length > 80 ? s.slice(0, 79) + "…" : s; };
  // c(key, printed, sentence, pick): prints `printed` and writes a sheet row for each source of D[key] (or those `pick` keeps:
  // a text the source's field or value holds, or a test on the source record)
  const c = (key, printed, sentence, pick) => {
    const recs = (S[key] || []).filter((s) => !pick || (typeof pick === "function" ? pick(s) : s.where.includes(pick) || s.value.includes(pick)));
    if (!recs.length) throw new Error(`build: no source for ${key}${pick ? ` matching ${pick}` : ""}`);
    for (const s of recs) sheet.push([page, cut(sentence), clean(printed), s.file, s.where, String(s.value).replace(/\s+/g, " ").trim(), s.measured, s.kind]);
    return printed;
  };
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const andList = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const plural = (n, one, many) => (n === 1 ? one : many);
  const none = (n) => (n === 0 ? "none" : fmt(n));
  const last = (...xs) => xs[xs.length - 1];

  const T = D.topDemand, sv = D.serp, ai = D.ai, g = D.grid, pr = D.profiles, sr = D.sitesRead, pp = D.productPages;
  const month = D.month;
  const awayNames = andList(g.awayCities);
  const sac = (row) => row.cells[0];
  const notListed = D.directories.filter((r) => r.status === "not listed").map((r) => r.name);
  const brokenApply = andList(pr.broken);
  const lcpSlow = Number(D.lcpS) > Number(D.goodLcpS);
  const where = (xs) => xs.map((x) => (x === "Your website" ? "your website" : x === "State filing" ? "the state filing" : x));
  const leadRead = D.formFields !== null;
  const fieldsRange = leadRead ? (D.formFieldsOne < D.formFields ? `${D.formFieldsOne} to ${D.formFields}` : `${D.formFields}`) : null;
  const nickList = (client.alsoSearchedAs || []).map((x) => `"${esc(x)}"`);
  const someNoPage = D.demand.some((r) => !r.page);
  const thenSecond = T.second ? `, then ${T.second}` : "";
  const goAhead = std.goAhead;
  const whoOf = (f) => f.who;

  // ---- the plan: rows are data (fixes.json); a rule decides whether a row is printed; a placeholder is filled from the data
  const RULES = {
    // [the rule, the data key it reads]
    wordsSentIsZero: [() => D.wordsSent === 0, "wordsSent"],
    profileLinkBroken: [() => pr.broken.length > 0, "profiles"],
    noAnalyticsTag: [() => D.outsideOnlyFonts, "outsideOnlyFonts"],
    leadPathRead: [() => leadRead, "formFields"],
    topProductHasNoPage: [() => !T.page, "topDemand"],
    otherProductsHaveNoPage: [() => D.demand.slice(2).some((r) => !r.page), "productPages"],
    addressesDiffer: [() => D.addresses.length > 1, "addresses"],
    mailRead: [() => D.mail !== null, "mail"],
    mailProblem: [() => D.mail !== null && (D.mail.spf !== 1 || D.mail.dmarcMissing || !D.mail.dkimFound), "mail"],
    trustRead: [() => D.licenceWords !== null, "licenceWords"],
    linkPlacesFound: [() => Boolean(client.linkPlace) && D.linkPlaces.metro > 0 && !D.ourLinks, "linkPlaces"],
    phoneIsSlow: [() => lcpSlow, "lcpS"],
    profilesNotInCard: [() => pr.inCard < pr.total, "profiles"],
  };
  const PH = {
    wordsSent: () => c("wordsSent", fmt(D.wordsSent), "words from your home page today"),
    brokenApply: () => c("profiles", brokenApply, "the profiles whose link to the site is broken", "linksBroken"),
    takesClause: () => (D.takes ? `"${c("takes", esc(D.takes), "the promise on the home page")}" on the home page; ` : ""),
    fieldsRange: () => { const lower = D.formFieldsOne < D.formFields ? `${c("formFieldsOne", String(D.formFieldsOne), "fields on the form with the optional part left out")} to ` : ""; return lower + c("formFields", String(D.formFields), "fields on the form"); },
    topLower: () => c("topDemand", T.lower, "the product with the most demand"),
    thenSecond: () => thenSecond,
    topShare: () => c("topDemand", String(T.share), "share of the demand for your products held by the top one"),
    otherCount: () => c("productPages", String(D.demand.length - 2), "the products after the first two"),
    pagesLine: () => c("productPages", pp.listed === 0 ? `Google and Bing list no page of yours for any ${w.product}` : `Google and Bing list a page for ${pp.listed} of ${pp.of}`, "how many products have a page listed"),
    claimClause: () => (notListed.length ? `; claim ${c("directories", andList(notListed), "the directories where you are not listed", (s) => s.value === "not listed")}` : ""),
    addrCount: () => c("addresses", String(D.addresses.length), "different addresses a buyer finds"),
    spfClause: () => (D.mail.spf > 1 ? ` (one sender record, not ${c("mail", String(D.mail.spf), "sender records found")})` : ""),
    renewClause: () => (D.renewBy ? `; renew the domain before ${c("renewBy", D.renewBy, "the domain's expiry date")}` : ""),
    licenceWhy: () => c("licenceWords", D.licenceWords === 0 ? "No licence wording a buyer can check" : "A buyer who checks can verify more", "licence wording on the home page"),
    lcpS: () => c("lcpS", D.lcpS, "main picture on a phone, seconds"),
    goodLcpS: () => c("goodLcpS", D.goodLcpS, "Google's good mark, seconds"),
    profilesTotal: () => c("profiles", String(pr.total), "profiles on other sites", (s) => /sameAs|rows \(length\)/.test(s.where)),
    home: () => esc(home), name: () => esc(name),
    ...Object.fromEntries(Object.keys(w).map((k) => [k, () => esc(w[k])])),
  };
  for (const f of fixRows) {
    if (!RULES[f.when]) stop(`STOP: fixes.json row ${f.id} names the rule ${f.when}`);
    for (const t of [f.fix, f.why]) for (const m of String(t).matchAll(/\{(\w+)\}/g)) if (!PH[m[1]]) stop(`STOP: fixes.json row ${f.id} names {${m[1]}}`);
  }
  const fill = (t) => String(t).replace(/\{(\w+)\}/g, (_, k) => PH[k]());

  const css = `
:root { --paper:#F4F2EC; --ink:#15161B; --ink-2:#4A4C52; --ink-3:#7D7F85; --lime:#A8D41A; --hair:rgba(21,22,27,.14); }
@page { size: Letter; margin: 0.72in 0.7in 0.58in; background: #F4F2EC;
  @top-left { content: "${name.replace(/["\\]/g, "\\$&")}"; font: 600 8pt "Open Sans", sans-serif; color: #15161B; }
  @top-right { content: "SEO, AI search and local audit, ${month}"; font: 400 8pt "Open Sans", sans-serif; color: #7D7F85; }
  @bottom-left { content: "Prepared by Omnikom"; font: 400 8pt "Open Sans", sans-serif; color: #7D7F85; }
  @bottom-right { content: counter(page) " / " counter(pages); font: 600 8pt "Open Sans", sans-serif; color: #15161B; } }
@page cover { size: Letter; margin: 0; background: #131318; }
* { box-sizing: border-box; }
html, body { margin: 0; color: var(--ink); font: 400 10pt/1.5 "Open Sans", Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cover { page: cover; width: 8.5in; height: 11in; position: relative; overflow: hidden; break-after: page; background: #fff; color: #111214; }
.cover .block { position: absolute; left: 0; top: 4.2in; width: 5.3in; height: 3.7in; background: #E9E8E4; }
.cover .panel { position: absolute; left: 3.3in; top: 5.0in; width: 4.5in; height: 2.3in; background: #111214; color: #fff; padding: 0.32in 0.38in; display: flex; flex-direction: column; justify-content: flex-end; }
.cover .panel .caps { font: 500 8.5pt/1 Montserrat, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: #9A9BA1; margin: 0 0 9pt; }
.cover .panel .lead { font: 400 15pt/1.35 Montserrat, sans-serif; margin: 0; }
.cover .logo { position: absolute; left: 0.7in; top: 0.7in; height: 0.32in; filter: invert(1) grayscale(1) brightness(0); }
.cover .title { position: absolute; left: 0.7in; right: 0.7in; top: 1.55in; }
.cover .title .caps { font: 500 8.5pt/1 Montserrat, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: #8A8C92; margin: 0 0 14pt; }
.cover h1 { font: 300 34pt/1.1 Montserrat, sans-serif; letter-spacing: -.02em; margin: 0; max-width: 11em; }
.cover h1 + p { font: 300 17pt/1.3 Montserrat, sans-serif; margin: 14pt 0 0; color: #4A4C52; }
.cover .score { position: absolute; left: 0.7in; top: 4.5in; width: 2.45in; display: block; margin: 0; padding: 0; border: 0; }
.cover .score .big { font: 300 66pt/0.9 Montserrat, sans-serif; letter-spacing: -.03em; color: #111214; }
.cover .score .big small { font-size: 18pt; color: #8A8C92; letter-spacing: 0; margin-left: 3pt; }
.cover .score p { margin: 14pt 0 0; font: 400 10.5pt/1.5 Montserrat, sans-serif; color: #4A4C52; max-width: 14em; padding-left: 12pt; border-left: 4px solid var(--lime); }
.cover .score p b { font-weight: 600; color: #111214; }
.cover .nums { position: absolute; left: 0.7in; right: 0.7in; top: 8.55in; margin: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 0 20pt; border-top: 1px solid #111214; }
.cover .num { padding-top: 12pt; }
.cover .num b { display: block; font: 300 27pt/1 Montserrat, sans-serif; color: #111214; letter-spacing: -.02em; }
.cover .num span { display: block; margin-top: 6pt; font: 300 9pt/1.45 Montserrat, sans-serif; color: #4A4C52; }
.cover .meta { position: absolute; left: 0.7in; right: 0.7in; bottom: 0.5in; display: flex; justify-content: space-between; font: 500 8pt/1 Montserrat, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: #8A8C92; }
.scope { background: #E9E8E4; padding: 12pt 14pt; margin-top: 14pt; }
.scope .label { margin-bottom: 6pt; }
.scope ul { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 4pt 20pt; font-size: 9.4pt; color: var(--ink-2); }
.scope li.wide { grid-column: 1 / -1; }
.scope b { font-weight: 600; color: var(--ink); }
.pg { break-after: page; }
.pg:last-child { break-after: auto; }
.shead { border-top: 1.4pt solid var(--ink); padding-top: 9pt; }
.label { font: 600 7.8pt/1.3 "Open Sans", sans-serif; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); }
h2 { font: 400 20pt/1.18 Montserrat, Arial, sans-serif; letter-spacing: -.01em; margin: 6pt 0 8pt; max-width: 21em; }
h3 { font: 500 12pt/1.25 Montserrat, Arial, sans-serif; margin: 11pt 0 4pt; }
.lede { color: var(--ink-2); font-size: 10.5pt; max-width: 42em; margin: 0 0 6pt; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0 16pt; margin: 14pt 0 4pt; border-top: 1px solid var(--hair); }
.stats.two-up { grid-template-columns: repeat(2, 1fr); }
.stat { padding: 11pt 0 10pt; border-bottom: 1px solid var(--hair); }
.stat b { display: block; font: 300 27pt/1 Montserrat, Arial, sans-serif; letter-spacing: -.02em; }
.stat span { display: block; margin-top: 6pt; font-size: 9pt; color: var(--ink-2); line-height: 1.4; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 26pt; }
table.comp td { white-space: nowrap; }
table { width: 100%; border-collapse: collapse; font-size: 9.4pt; }
th { text-align: left; font: 600 7.6pt/1.3 "Open Sans", sans-serif; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); padding: 0 8pt 5pt 0; border-bottom: 1.2pt solid var(--ink); }
td { padding: 5.5pt 8pt 5.5pt 0; border-bottom: 1px solid var(--hair); vertical-align: top; }
td.r, th.r { text-align: right; padding-right: 0; font-variant-numeric: tabular-nums; }
td small { display: block; color: var(--ink-3); font-size: 8pt; }
.you td { font-weight: 600; background: rgba(21,22,27,.05); }
.state { white-space: nowrap; font-weight: 600; }
.fixes { margin: 6pt 0 0; padding: 0; list-style: none; counter-reset: f; }
.fixes li { counter-increment: f; display: grid; grid-template-columns: 0.4in 1fr; padding: 4.5pt 0; border-bottom: 1px solid var(--hair); }
.fixes li::before { content: counter(f); font: 300 21pt/1 Montserrat, sans-serif; color: var(--ink-3); }
.fixes li:first-child { border-left: 4px solid var(--lime); padding-left: 10pt; grid-template-columns: 0.32in 1fr; }
.fixes b { font-weight: 600; }
.fixes span { display: block; color: var(--ink-2); font-size: 9.4pt; }
.next { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0 18pt; margin-top: 16pt; border-top: 1px solid var(--ink); padding-top: 9pt; }
.next.four { grid-template-columns: repeat(2, 1fr); gap: 12pt 28pt; }
.next b { display: block; font: 500 11.5pt/1.3 Montserrat, sans-serif; margin: 3pt 0 3pt; }
.next p:not(.label) { margin: 0; color: var(--ink-2); font-size: 9.4pt; }
.goahead { margin-top: 18pt; background: #111214; color: #fff; padding: 20pt 24pt; display: grid; grid-template-columns: auto 1fr; gap: 0 28pt; align-items: end; }
.goahead .label { color: #9A9BA1; margin: 0 0 8pt; }
.goahead .big { font: 300 21pt/1.2 Montserrat, sans-serif; margin: 0; }
.goahead .note { margin: 0; color: #C8C9CC; font-size: 9.6pt; }
.goahead .contact { margin: 10pt 0 0; font: 500 11pt/1.4 Montserrat, sans-serif; color: #fff; }
ul.plain { margin: 4pt 0 0; padding-left: 14pt; color: var(--ink-2); }
ul.plain li { margin: 0 0 4pt; }
.plan td:first-child { font: 300 16pt/1 Montserrat, sans-serif; color: var(--ink-3); width: 0.36in; }
.plan td { padding: 5pt 8pt 5pt 0; font-size: 9.2pt; }
.plan tr.first td:first-child { border-left: 4px solid var(--lime); padding-left: 6pt; width: 0.42in; }
.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0 18pt; margin-top: 8pt; }
.step { border-top: 1.2pt solid var(--ink); padding-top: 8pt; }
.step b { display: block; font: 500 11.5pt/1.3 Montserrat, sans-serif; margin-bottom: 4pt; }
.step p { margin: 0; color: var(--ink-2); font-size: 9.4pt; }
.note { color: var(--ink-2); font-size: 9.4pt; margin: 8pt 0 0; }
`;

  const stat = (b, s) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`;
  const head = (label, h, lede) => `<div class="shead"><div class="label">${label}</div></div><h2>${h}</h2>${lede ? `<p class="lede">${lede}</p>` : ""}`;
  const fixesList = (items) => (items.length ? `<h3>What to do</h3><ol class="fixes">${items.map(([b, s]) => `<li><div><b>${b}</b><span>${s}</span></div></li>`).join("")}</ol>` : "");

  // ---- page 1: the cover
  const cover = () => {
    page = 1;
    const empty = D.wordsSent === 0 && sv.productWithUs === 0;
    let found = "Your website is hard for search tools to read.";
    if (empty) {
      c("wordsSent", "an empty page", "What we found: your website sends search tools an empty page");
      found = c("serp", `Your website sends search tools an empty page, and ${w.buyers} who search by ${w.product} find other companies.`, "What we found: an empty page, and buyers searching by product find others", "product search");
    }
    const away = (s) => g.awayCities.some((x) => s.where.includes(` ${x}]`));
    const mapSpan = g.awayBest === 0
      ? `points in ${awayNames} where Google Maps puts you in its first three, for every one of your ${g.products} ${w.products}`
      : `the most points in ${awayNames} where Google Maps puts you in its first three, for any one of your ${g.products} ${w.products}`;
    const means = empty
      ? `<b>What it means:</b> ${w.buyers} who search for your ${w.products} are mostly shown other companies. <b>The fix</b> starts on your website: send its words with the page, then give each ${w.product} a page of its own.`
      : `<b>What it means:</b> some ${w.buyers} who search for your ${w.products} are shown other companies. <b>The fix</b> starts on your website.`;
    return `
<section class="cover">
  <div class="block"></div>
  <div class="score"><p>${means}</p></div>
  <div class="panel"><p class="caps">What we found</p><p class="lead">${found}</p></div>
  <img class="logo" src="${logoUrl}" alt="Omnikom">
  <div class="title"><p class="caps">Audit</p><h1>SEO, AI search and local audit</h1><p>${esc(name)}<br>${c("month", month, "Cover: the business name, month of the audit")}</p></div>
  <div class="nums">
    <div class="num"><b>${c("wordsSent", `${D.wordsSent} words`, "what your site sends search tools and AI assistants before a script runs")}</b><span>what your site sends search tools and AI assistants before a script runs</span></div>
    <div class="num"><b>${c("serp", `${sv.productWithUs} of ${sv.product}`, "results pages for product searches on Google and Bing that showed your site", "product search")}</b><span>results pages for ${w.product} searches on Google and Bing that showed your site${sv.outside ? ", read from outside your area" : ""}</span></div>
    ${g.awayBest === null ? "" : `<div class="num"><b>${c("grid", `${g.awayBest} of ${g.per}`, mapSpan, away)}</b><span>${mapSpan}</span></div>`}
  </div>
  <div class="meta"><span>Omnikom</span><span>${month}</span></div>
</section>`;
  };

  // ---- page 2: summary
  const page2 = () => {
    page = 2;
    const deadEnds = pr.broken.length > 0;
    const addrWhere = D.addresses.map((a) => andList(where(a.where))).join("; ");
    const asks = [D.formAsks && D.formAsks.taxId ? "tax ID" : null, D.formAsks && D.formAsks.ssn ? "SSN" : null].filter(Boolean);
    const fieldsSpan = leadRead
      ? `fields on the ${w.application}${D.formAsks.optional ? `, ${w.optionalNote}` : ""}${asks.length ? `, including ${andList(asks)}` : ""}${D.takes ? `, while your home page promises "${esc(D.takes)}"` : ""}`
      : "";
    const ratingSpan = `your Google rating${D.rating.rating === "5.0" ? ", the top mark" : ""}${D.rivalReviews.of > 0 ? `; ${D.rivalReviews.more} of the ${D.rivalReviews.of} businesses Google Maps put in its first three around ${esc(home)} show more reviews` : ""}`;
    const readLine = sr.read === 0 ? "" : sr.allSend ? `Every one of the ${sr.read} competitor sites we could read sends its words at once.` : `Most competitor sites we could read send their words at once.`;
    const trackLine = D.outsideOnlyFonts ? `in our test visit no analytics tag loaded, so nobody can see where an ${w.applicant} came from` : "";
    const pagesLine = pp.listed === 0 ? `Google and Bing list no page of yours for any of them` : `Google and Bing list a page of yours for ${pp.listed} of them`;
    const tiles = [];
    if (leadRead) tiles.push(stat(last(c("formFieldsOne", fieldsRange, "fields on the form with the optional part left out (the lower number)"), c("formFields", fieldsRange, fieldsSpan)), last(c("formAsks", fieldsSpan, fieldsSpan), D.takes ? c("takes", fieldsSpan, fieldsSpan) : fieldsSpan)));
    tiles.push(D.addresses.length > 1
      ? stat(c("addresses", D.addresses.length, "different street addresses a buyer finds"), `different street addresses a buyer finds: ${addrWhere}`)
      : stat(c("addresses", D.addresses.length, "street address a buyer finds"), `street address a buyer finds, the same on ${addrWhere}`));
    tiles.push(stat(`${c("rating", D.rating.rating, "your Google rating")} <small style='font-size:13pt;color:var(--ink-3)'>from ${c("rating", D.rating.reviews, "your Google rating, from N reviews")}</small>`, c("rivalReviews", ratingSpan, ratingSpan)));
    const ops = [];
    if (D.wordsSent === 0) ops.push(["Make your pages readable on the first visit.", `Your server sends an empty page that fills in after a script runs. ${readLine ? c("sitesRead", readLine, readLine) : ""}`.trim()]);
    if (deadEnds || trackLine) {
      const parts = [];
      if (deadEnds) parts.push(c("profiles", `The link to your site on your ${brokenApply} profiles leads to an error page`, "The link to your site on your profiles leads to an error page", "linksBroken"));
      if (trackLine) parts.push(c("outsideOnlyFonts", deadEnds ? trackLine : upperFirst(trackLine), trackLine));
      ops.push([`Stop losing ${w.buyers} who are ready to ${w.apply}.`, `${parts.join(", and ")}.`]);
    }
    if (someNoPage) ops.push([`Give each ${w.product} its own page, ${T.lower} first.`, `${c("topDemand", `${T.lower} is about ${T.share}% of Bing's demand across your ${T.products} ${w.products}`, "the top product's share of Bing's demand")}, and ${c("productPages", pagesLine, pagesLine)}.`]);
    return `
<section class="pg">
  ${head("Summary", deadEnds ? "Your site is hard for search tools to read, and buyers who do arrive meet dead ends." : "Your site is hard for search tools to read.", "The numbers and the opportunities that matter most for being found on Google and Bing (SEO), named by AI assistants, and seen on Google Maps.")}
  <div class="stats">
    ${tiles.join("\n    ")}
  </div>
  ${ops.length ? `<h3>The ${ops.length === 1 ? "biggest opportunity" : `${ops.length === 3 ? "three" : ops.length} biggest opportunities`}</h3>
  ${fixesList(ops).replace("<h3>What to do</h3>", "")}` : ""}
  <div class="scope"><div class="label">What we looked at</div><ul>
    <li><b>${c("serp", sv.total, "results pages on Google and Bing, phone and desktop, read from outside your area", "counts")}</b> results pages on Google and Bing, phone and desktop${sv.outside ? ", read from outside your area" : ""}, plus search-box suggestions for ${c("suggest", D.suggest.seeds, "search-box suggestions for N searches")} searches</li>
    <li><b>${c("keywordsRead", fmt(D.keywordsRead), "searches with Bing's own estimate of demand")}</b> searches with Bing's own estimate of demand</li>
    <li><b>${c("sitesRead", sr.read, "competitor sites read")}</b> of ${c("sitesRead", sr.of, "of N competitor sites")} competitor sites read</li>
    <li><b>${c("grid", g.captures, "Google Maps points: cities, products, points each", "plan.n")}</b> Google Maps points: ${g.cities.length} ${plural(g.cities.length, "city", "cities")}, ${g.products} ${w.products}, ${g.per} points each</li>
    <li class="wide"><b>${c("ai", [ai.chat, ai.perp].filter((e) => e.status === "ok").length, "AI assistants asked the same questions", (s) => /engine=(chatgpt|perplexity)\]/.test(s.where))}</b> AI assistants asked ${ai.sameQuestions ? "the same" : "each"} ${ai.chat.questions} questions, plus ${c("googleAi", D.googleAi.total, "AI answers on Google's results pages")} AI answers on Google's results pages</li>
    ${D.gscBlocked ? `<li class="wide">${c("gscBlocked", std.noOwnStatistics, "Your own search statistics are not in this review (Search Console not read)")}</li>` : ""}
    ${notRead.length ? `<li class="wide">Not read in this review: ${andList(notRead)}.</li>` : ""}
  </ul></div>
</section>`;
  };

  // ---- page 3: SEO
  const page3 = () => {
    page = 3;
    const lede = sv.name === 0 ? "" : `${sv.outside ? "In searches read from outside your area, your" : "Your"} site came first on ${sv.nameFirst} of ${sv.name} results pages for your name${sv.productWithUs === 0 ? `, and on none for a ${w.product}: a ${w.buyer} who does not know your name yet does not find you.` : "."}`;
    const smText = D.sitemapIsHome ? "The list of pages a site gives search tools. Yours returns a copy of the home page." : "The list of pages a site gives search tools. Yours lists none.";
    const blockers = [];
    if (D.sitemapPages === 0) blockers.push(["No sitemap", last(c("sitemapIsHome", smText, smText), c("sitemapPages", smText, smText))]);
    if (D.notFoundStatus === 200) blockers.push(["Missing pages look real", c("notFoundStatus", "An address that does not exist answers like a normal page, which confuses search tools.", "Any address that doesn't exist answers as a normal page")]);
    if (lcpSlow) blockers.push(["Slow on phones", `Your main picture appears after ${c("lcpS", D.lcpS, "main picture on a phone, seconds")} s in Google's phone test (${c("lcpDeskS", D.lcpDeskS, "on a computer, seconds")} s on a computer); Google's good mark is ${c("goodLcpS", D.goodLcpS, "Google's good mark, seconds")} s.`]);
    const todo = [];
    if (!T.page) todo.push([`Build the ${T.lower} page first${thenSecond}.`, `Put the words ${w.buyers} type in the title, the headings and the first paragraph, with a ${esc(home)} line.`]);
    if (D.sitemapPages === 0 || D.notFoundStatus === 200) todo.push(["Publish a sitemap and a real \"page not found\" page.", "A day of developer time, and it lets search tools list every page you add."]);
    return `
<section class="pg">
  ${head("SEO · Found on Google and Bing", c("demand", T.page ? `Buyers search for ${T.lower}.` : `Buyers search for ${T.lower}, and your site has no page for it.`, "Buyers search for the top product, and your site has no page for it", "servicesMissing"), lede ? c("serp", lede, lede, (s) => !/nickname/.test(s.where)) : "")}
  <div class="stats two-up">
    ${stat(c("topDemand", fmt(T.value), `times Bing showed results for "${T.key}"`), `times Bing showed results for "${esc(T.key)}" across ${c("demandWhere", D.demandWhere, "across the US")} in ${c("demandDays", D.demandDays, "in N days")} days, by its own estimate: ${c("topDemand", `${T.share}%`, "share of the demand for your products")} of the demand for your ${T.products} ${w.products}`)}
    ${stat(c("serp", `${sv.productWithUs} of ${sv.product}`, "results pages for product searches that showed your site", "product search"), `results pages for ${w.product} searches on Google and Bing, phone and desktop, that showed your site`)}
  </div>
  <h3>Demand by ${w.product}, and the page you have for it</h3>
  <table>
    <tr><th>${upperFirst(w.product)}</th><th class="r">Bing demand, ${D.demandDays} days</th><th class="r">Page of its own</th></tr>
    ${D.demand.map((r) => `<tr><td>${esc(r.product)}</td><td class="r">${c("demand", fmt(r.value), `Bing demand, ${r.product}`, `query=${r.key}&`)}</td><td class="r state">${c("demand", r.page ? "Listed" : "None", `Page of its own, ${r.product}`, "servicesMissing")}</td></tr>`).join("")}
  </table>
  ${blockers.length ? `<h3>What stands in the way</h3>
  <table>
    <tr><th>Blocker</th><th>In plain words</th></tr>
    ${blockers.map(([b, t]) => `<tr><td class="state">${b}</td><td>${t}</td></tr>`).join("")}
  </table>` : ""}
  ${fixesList(todo)}
</section>`;
  };

  // ---- page 4: AI search
  const page4 = () => {
    page = 4;
    const ch = ai.chat, pe = ai.perp, ga = D.googleAi;
    const chMost = ch.named * 2 > ch.questions, peFew = pe.named * 2 < pe.questions, gaFew = ga.named * 2 < ga.total;
    const h = chMost && peFew && gaFew ? "ChatGPT names you; Perplexity and Google's AI answers mostly do not." : "Whether an AI answer names you depends on where the buyer asks.";
    const lede = `GEO and AEO mean being named and quoted by AI assistants and by the AI answers on Google. We asked ChatGPT and Perplexity ${ai.sameQuestions ? "the same" : "each"} ${ch.questions} questions a ${w.buyer} would ask${ai.allSignedIn ? ", each in a signed-in session" : ""}, and read Google's AI answers on ${ga.total} results pages, from outside your area. A ${w.buyer} whose answer does not name you is sent to a company it does name.`;
    const chSpan = `ChatGPT answers that named you: ${ch.buyerNamed} of the ${ch.buyer} ${w.buyer} questions${ch.brandNamed ? ", and the question about you by name" : ""}`;
    const peSpan = pe.buyerNamed === 0 && pe.brandNamed ? "Perplexity answers that named you: only the question about you by name" : `Perplexity answers that named you: ${pe.buyerNamed} of the ${pe.buyer} ${w.buyer} questions`;
    const gaSpan = `Google AI answers that named you${ga.namedForName ? `, ${ga.namedForName} of them on a search for your own name` : ""}`;
    const card = [
      [`Words in the page as first sent`, c("wordsSent", D.wordsSent === 0 ? "None" : fmt(D.wordsSent), "Words in the page as first sent")],
      [`A page per ${w.product}`, c("productPages", `${pp.listed} of ${pp.of}`, "A page per product")],
      ...(D.faq ? [["FAQ answers labelled for machines", c("faq", `${D.faq.marked} of ${D.faq.of}`, "FAQ answers labelled for machines")]] : []),
      ["Profiles named in the page's hidden business card", c("profiles", `${pr.inCard} of ${pr.total}`, "Profiles named in the page's hidden business card", (s) => /sameAs|rows \(length\)/.test(s.where))],
    ];
    const todo = [];
    if (D.wordsSent === 0) todo.push(["Send the page with its words in it.", `${sr.allSend ? "Every competitor site we could read does. " : ""}Your developer's job, not a redesign.`]);
    if (someNoPage) todo.push([`Give each ${w.product} its own page, ${T.lower} first.`, `Open with a short answer, then each ${w.buyer} question under its own heading${D.faq ? ", and label every FAQ answer for machines" : ""}.`]);
    const nick = sv.short > 0 ? `${c("serp", `Searched as ${andList(nickList)}, your site was on ${sv.shortWithUs} of ${sv.short} results pages`, "Searched under a nickname, your site was on N of M results pages", "nickname")}. ` : "";
    const cardLine = pr.inCard < pr.total ? `, and name your ${c("profiles", pr.total, "name your N profiles in the page's hidden business card", (s) => /sameAs|rows \(length\)/.test(s.where))} profiles in the page's hidden business card (the labels search tools read)` : "";
    todo.push([`Use your full name everywhere${pr.inCard < pr.total ? " and connect your profiles" : ""}.`, `${nick}Say "${esc(name)}" every time${cardLine}.`]);
    return `
<section class="pg">
  ${head("AI search · GEO and AEO", last(c("ai", h, h, (s) => /engine=(chatgpt|perplexity)\]/.test(s.where)), c("googleAi", h, h)), last(c("ai", lede, lede, (s) => /engine=(chatgpt|perplexity)\]|signedIn/.test(s.where)), c("googleAi", lede, lede)))}
  <div class="stats">
    ${stat(c("ai", `${ch.named} of ${ch.questions}`, "ChatGPT answers that named you", "engine=chatgpt]"), c("ai", chSpan, chSpan, "rows[type=buyer]"))}
    ${stat(c("ai", `${pe.named} of ${pe.questions}`, "Perplexity answers that named you", "engine=perplexity]"), c("ai", peSpan, peSpan, "rows[type=buyer]"))}
    ${stat(c("googleAi", `${ga.named} of ${ga.total}`, "Google AI answers that named you"), c("googleAi", gaSpan, gaSpan))}
  </div>
  <div class="two">
    <div>
      <h3>Who the AI names instead, of ${c("ai", ai.answers, "answers from both assistants", "summary.questions")} answers</h3>
      <table><tr><th>Business</th><th class="r">Answers naming it</th></tr>${D.aiInstead.map((x) => `<tr><td>${esc(x.name)}</td><td class="r">${c("aiInstead", x.count, `Who the AI names instead: ${x.name}`)}</td></tr>`).join("")}</table>
    </div>
    <div>
      <h3>Is a page built to be the answer?</h3>
      <table>
        <tr><th>What an answer needs</th><th class="r">Today</th></tr>
        ${card.map(([a, b]) => `<tr><td>${a}</td><td class="r state">${b}</td></tr>`).join("\n        ")}
      </table>
    </div>
  </div>
  ${ai.blockedBySignIn ? `<p class="note">${c("ai", "We could not read Copilot or Gemini: both asked for a signed-in account.", "We could not read Copilot or Gemini: both asked for a signed-in account", "copilot|gemini")}</p>` : ""}
  ${fixesList(todo)}
</section>`;
  };

  // ---- page 5: local
  const page5 = () => {
    page = 5;
    const sacIn3 = g.rows.filter((r) => sac(r).in3 > 0).length;
    const h = sacIn3 > 0 && g.awayBest === 0 ? `Near the top of Google Maps in ${esc(g.cities[0])} only, not for every ${w.product}.` : `On Google Maps you are near the top for some ${w.products} and missing for others.`;
    const lede = g.cities.length < D.serviceCities
      ? c("serviceCities", `What Google Maps lists at ${g.per} points, ${g.spacing} km apart, in ${g.cities.length} of your ${D.serviceCities} cities.`, "in N of your M cities (M = the service-area cities of the business file)")
      : `What Google Maps lists at ${g.per} points, ${g.spacing} km apart, in ${g.cities.length === 1 ? "your city" : `each of ${g.cities.length} cities`}.`;
    const top = g.rows[0];
    const note = c("grid", `${top.product}, with the most demand, puts you in the first three at ${sac(top).in3} of ${g.per} ${esc(home)} points${sac(top).in3 * 2 < g.per ? ", so most buyers there see others first" : ""}.`, `${top.product}, with the most demand, first three points in ${home}`, ` ${home}]`);
    c("demand", "with the most demand", `${top.product} has the most demand`, `query=${top.key}&`);
    const profileLine = D.profileEmpty.description && D.profileEmpty.services ? "Your Google profile has no description and lists no services." : D.profileEmpty.description ? "Your Google profile has no description." : D.profileEmpty.services ? "Your Google profile lists no services." : "";
    const agreeName = (x) => (x === "Your website" ? "the website" : x === "Google Maps" ? "Google" : /^bing/i.test(x) ? "Bing" : x === "State filing" ? "the state filing" : x);
    const places = [...new Set(D.addresses.flatMap((a) => a.where.map(agreeName)))];
    const todo = [];
    if (D.addresses.length > 1) todo.push(["Show one address everywhere.", `Tell us the right one, then make ${andList(places)} agree.`]);
    if (profileLine || notListed.length) todo.push([`Fill in your Google profile${notListed.length ? `, then claim ${c("directories", andList(notListed), "claim the directories where you are not listed", (s) => s.value === "not listed")}` : ""}.`, `${profileLine ? c("profileEmpty", profileLine, profileLine) + " " : ""}Name each ${w.product} there.`]);
    if (D.rivalReviews.more > 0) todo.push([`Ask every ${w.pastCustomer} for a review, and reply to each one.`, c("rivalReviews", `${D.rivalReviews.more} of the ${D.rivalReviews.of} businesses in Maps' first three around ${esc(home)} show more reviews than your ${D.rivalReviews.ours}.`, "N of M businesses in Maps' first three around the home city show more reviews")]);
    return `
<section class="pg">
  ${head("Local and reputation", c("grid", h, h, "pointsIn3Pack"), c("grid", lede, lede, "plan.n"))}
  <table>
    <tr><th>${upperFirst(w.product)} (points of ${g.per})</th><th class="r">${esc(g.cities[0])}, listed</th>${g.cities.map((city) => `<th class="r">${esc(city)}, first three</th>`).join("")}</tr>
    ${g.rows.map((r) => `<tr><td style="white-space:nowrap">${esc(r.product)}</td><td class="r">${c("grid", sac(r).inPack, `${r.product}, ${g.cities[0]}: listed`, `solv[query=${r.key} ${g.cities[0]}]`)}</td>${r.cells.map((cl) => `<td class="r">${c("grid", cl.in3, `${r.product}, ${cl.cityName}: first three`, `solv[query=${r.key} ${cl.cityName}]`)}</td>`).join("")}</tr>`).join("")}
  </table>
  <p class="lede" style="margin-top:8pt;font-size:9.4pt">${note}</p>
  <div class="two">
    <div>
      <h3>Where a buyer can find you</h3>
      <table>
        <tr><th>Listing</th><th class="r">${esc(short)}</th></tr>
        <tr><td>Google Maps</td><td class="r state">${c("rating", `${D.rating.rating} from ${D.rating.reviews}`, "Google Maps rating from reviews")}</td></tr>
        ${D.directories.map((r) => `<tr><td>${esc(r.name)}</td><td class="r state">${c("directories", r.status === "listed" ? "Listed" : "Not listed", `${r.name}: listed or not`, `(${r.name})`)}</td></tr>`).join("")}
      </table>
    </div>
    <div>
      <h3>${D.addresses.length > 1 ? `${c("addresses", D.addresses.length, "addresses for one business")} addresses for one business` : "The same address everywhere we looked"}</h3>
      <table>
        <tr><th>Where</th><th>Address shown</th></tr>
        ${D.addresses.map((a) => `<tr><td>${andList(a.where)}</td><td>${c("addresses", esc(a.address), `${andList(a.where)}: address shown`, (s) => s.value === a.address)}</td></tr>`).join("")}
      </table>
    </div>
  </div>
  ${fixesList(todo)}
</section>`;
  };

  // ---- page 6: competitors
  const page6 = () => {
    page = 6;
    const R = D.rivals;
    const local = R.filter((r) => r.group === "local");
    const cmpRows = client.linkCompare ? R.filter((r) => r.group === client.linkCompare.group) : [];
    const lo = R.length ? Math.min(...R.map((r) => r.words)) : 0, hi = R.length ? Math.max(...R.map((r) => r.words)) : 0;
    const ads = D.ads.map((a) => `${a.count === 0 ? "none" : `${a.count} ${plural(a.count, "ad", "ads")}`} for ${a.name}`);
    const adLine = ads.length ? `Google's ad library shows ${andList(ads)} in the last ${D.ads[0].days} days.` : "";
    const lp = D.linkPlaces;
    const linkOf = (r) => (r.links === null ? "no" : fmt(r.links));
    const rowOf = (r) => R.find((x) => x.words === r.words);
    const bullets = [];
    if (R.length) bullets.push(`${c("sitesRead", sr.allSend ? `Every one of the ${sr.read} competitor sites we could read sends its words at once` : `Most of the ${sr.read} competitor sites we could read send their words at once`, "Every one of the N competitor sites we could read sends its words at once")}: these send ${c("rivals", fmt(lo), "these send N to M words (lowest)", `sites[domain=${rowOf({ words: lo }).domain}]`)} to ${c("rivals", fmt(hi), "these send N to M words (highest)", `sites[domain=${rowOf({ words: hi }).domain}]`)}. You send ${c("wordsSent", none(D.wordsSent), "You send none")}.`);
    if (local.length) bullets.push(`Your ${esc(home)} rivals are small: ${andList(local.map((r) => esc(r.name)))} send ${c("rivals", local.map((r) => fmt(r.words)).join(" and "), "local rivals: words", (s) => local.some((r) => s.where.includes(`sites[domain=${r.domain}]`)))} words, and only ${c("rivals", local.map(linkOf).join(" and "), "local rivals: sites linking", (s) => local.some((r) => s.where.includes(`results[domain=${r.domain}]`)))} sites link to them, so catching up is realistic.`);
    const cmp = cmpRows.length ? `; ${c("rivals", cmpRows.map(linkOf).join(" and "), "sites link to the compared group above", (s) => cmpRows.some((r) => s.where.includes(`results[domain=${r.domain}]`)))} link to the ${cmpRows.length} ${esc(client.linkCompare.label)} above` : "";
    bullets.push(`${c("ourLinks", D.ourLinks ? "Some sites link to you" : "In the public record of web links we checked, no site links to you", "In the public record of web links we checked, no site links to you")}${cmp}.`);
    if (adLine) bullets.push(c("ads", adLine, adLine));
    const todo = [];
    if (local.length && D.wordsSent === 0) todo.push(["Match the basics your rivals already have.", `Words on the first visit, a sitemap and a page per ${w.product} put you level with the ${esc(home)} ${w.localRivals} within weeks.`]);
    if (lp.pursue > 0) todo.push([`Join the ${esc(home)} chambers and ask for listings.`, c("linkPlaces", `We found ${lp.pursue} places worth asking for a listing, ${lp.chambers} of them chambers of commerce.${lp.metro === null ? "" : ` ${esc(client.linkPlace)} links to ${lp.metro} of the businesses you compete with${D.ourLinks ? "" : ", and not to you"}.`}`, "We found N places worth asking for a listing, M of them chambers")]);
    return `
<section class="pg">
  ${head("Competitors", D.wordsSent === 0 && sr.allSend ? "The companies you compete with send their words at once. You send none." : "How your site compares with the companies you compete with.", client.rivalsLede ? esc(client.rivalsLede) : `The companies that show for your ${w.products}, the ones near you first.`)}
  <table class="comp">
    <tr><th>Business</th><th>Type</th><th class="r">Words on the first visit</th><th class="r">Pages in its sitemap</th><th class="r">Sites linking to it</th></tr>
    <tr class="you"><td>${esc(name)}</td><td>you</td><td class="r">${c("wordsSent", D.wordsSent, `${short}: words on the first visit`)}</td><td class="r">${c("sitemapPages", D.sitemapPages, `${short}: pages in its sitemap`)}</td><td class="r">${c("ourLinks", D.ourLinks ? "found" : "none found", `${short}: sites linking to it`)}</td></tr>
    ${R.map((r) => `<tr><td>${esc(r.name)}</td><td>${c("rivals", esc(r.type), `${r.name}: type`, `rows[domain=${r.domain}]`)}</td><td class="r">${c("rivals", fmt(r.words), `${r.name}: words on the first visit`, `sites[domain=${r.domain}]`)}</td><td class="r">${c("rivals", fmt(r.sitemap), `${r.name}: pages in its sitemap`, `sites[domain=${r.domain}]`)}</td><td class="r">${c("rivals", r.links === null ? "none found" : fmt(r.links), `${r.name}: sites linking to it`, `results[domain=${r.domain}]`)}</td></tr>`).join("")}
  </table>
  <h3>What stands out</h3>
  <ul class="plain">
    ${bullets.map((b) => `<li>${b}</li>`).join("\n    ")}
  </ul>
  ${fixesList(todo)}
</section>`;
  };

  // ---- page 7: action plan (rows are data; a rule decides each; the rest are numbered again)
  const page7 = () => {
    page = 7;
    const rows = fixRows.filter((f) => RULES[f.when][0]()).map((f) => {
      const before = sheet.length;
      const fix = fill(f.fix), why = fill(f.why);
      if (sheet.length === before) c(RULES[f.when][1], why, f.why);
      return [fix, why, f.time, whoOf(f)];
    });
    return `
<section class="pg">
  ${head("Action plan", `${rows.length} ${plural(rows.length, "fix", "fixes")}, in the order they decide whether a ${w.buyer} reaches you and ${w.applies}.`, "Time is our estimate of the work. Start at the top before spending on ads.")}
  <table class="plan">
    <tr><th>#</th><th>Fix</th><th>Why it pays</th><th>Time</th><th>Who</th></tr>
    ${rows.map((r, i) => `<tr${i === 0 ? ' class="first"' : ""}><td>${i + 1}</td><td>${r[0]}</td><td>${r[1]}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td></tr>`).join("\n    ")}
  </table>
</section>`;
  };

  // ---- page 8: what Omnikom does (a line only when its product rows read WORKS)
  const page8 = () => {
    page = 8;
    const lines = [];
    if (D.v2_firstVisit && D.wordsSent === 0) lines.push([c("wordsSent", "The page your server sends is empty", "The page your server sends is empty"), c("v2_firstVisit", "Your site is built so every page sends its words, headings, sitemap and hidden business card on the first visit.", "every page sends words, headings, sitemap and business card on the first visit")]);
    const formsLine = "Your forms work without a script, and every enquiry lands in your lead list, with an email to the person who should act.";
    if (D.v2_forms && D.v2_crm && D.v2_alert && pr.broken.length) lines.push([c("profiles", `The link to your site on ${brokenApply} leads to an error page, so that ${w.buyer} reaches no form`, "The link to your site on a profile leads to an error page", "linksBroken"), last(c("v2_forms", formsLine, "forms work without a script"), c("v2_crm", formsLine, "every enquiry lands in your lead list (CRM)"), c("v2_alert", formsLine, "an email to the person who should act"))]);
    if (D.v2_pages && pp.listed === 0) lines.push([c("productPages", `One page holds all ${pp.of} ${w.products}`, "One page holds all N products"), c("v2_pages", `Each ${w.product} gets its own page, built from a plan you approve before anything goes live.`, "Each product gets its own page, built from a plan you approve")]);
    const lede = D.v2_crm ? c("v2_crm", "Your website and your leads on one platform, with every enquiry in a lead list you log into (your CRM).", "every enquiry in a lead list you log into (CRM)") : "Your website and your leads on one platform.";
    const promise = std.promise.replace("{outcome}", w.outcome);
    return `
<section class="pg">
  ${head("How Omnikom fixes this", "Each problem in this review, and what Omnikom does about it.", lede)}
  <div class="stats two-up">
    ${stat(c("wordsSent", `${D.wordsSent} words`, "what search tools get from your home page today"), `what search tools get from your home page today${D.wordsSent === 0 ? ", so they cannot see what you offer" : ""}`)}
    ${stat(c("productPages", `${pp.listed} of ${pp.of}`, "of your products with a page of its own"), `of your ${w.products} with a page of its own${pp.listed === 0 ? `, so a ${w.buyer} searching for one lands nowhere specific` : ""}`)}
  </div>
  ${lines.length ? `<table>
    <tr><th>What is wrong</th><th>What Omnikom does</th></tr>
    ${lines.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join("")}
  </table>` : ""}
  ${D.v2_export ? `<p class="lede" style="font-size:9.4pt;margin-top:10pt"><b style="font-weight:600;color:var(--ink)">Your leads are yours:</b> ${c("v2_export", "export them to a spreadsheet at any time, and take a full copy of your data if you leave.", "export them to a spreadsheet; take a full copy of your data if you leave")}</p>` : ""}
  <div class="next four">
    ${std.nextSteps.map(([label, title, text]) => `<div><p class="label">${label}</p><b>${title}</b><p>${text}</p></div>`).join("\n    ")}
  </div>
  <div class="goahead">
    <div><p class="label">To go ahead</p><p class="big">${goAhead}</p></div>
    <div><p class="note">${promise}</p>${contact ? `<p class="contact">${esc(contact)}</p>` : ""}</div>
  </div>
</section>`;
  };

  const body = [cover, page2, page3, page4, page5, page6, page7, page8].map((f) => f()).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(name)}: SEO, AI search and local audit, ${month}${draft ? " (draft)" : ""}</title>
<link href="${fontsUrl}" rel="stylesheet"><style>${css}</style></head><body>${body}</body></html>
`;
  const tsv = [["page", "sentence (cut to 80 characters)", "printed", "file", "where in the file", "value there", "measured", "kind"], ...sheet].map((r) => r.map((x) => String(x).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n") + "\n";
  return { html, tsv };
}
