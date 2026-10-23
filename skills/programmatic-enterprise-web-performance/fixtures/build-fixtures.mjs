// Rebuilds the committed fixtures of the plan stage and the S5 gate (review item 21). Invented business, invented numbers.
//   fixtures/pewp/            business.json, targets.json, plan/programmatic-data.json   (the inputs of plan-site.mjs)
//   fixtures/site-clean/      6 static pages built to the plan's briefs: every gate check passes
//   fixtures/site/            the same business with planted faults: one cannibalisation, one missing cluster page, one orphan,
//                             one wrong schema type, one page missing its licence number
//   fixtures/measure/<date>/  two dates of ranking and AI-citation rows (schemas/targets.md) + expected-diff.json
// The site pages are written by a simulated builder that follows plan/briefs, so they are regenerated from the plan:
// after changing plan-site.mjs run `node fixtures/build-fixtures.mjs` and review the diff. test-plan-gate.mjs fails if the
// committed fixtures are stale. Usage: node build-fixtures.mjs [--out <dir>]   (default: this folder)
import fs from "node:fs";
import { isMain } from "../scripts/lib-main.mjs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseBrief } from "../scripts/lib-plan.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : HERE);
export const PLAN_FLAGS = ["--today", "2026-10-22", "--prog-min-words", "250", "--prog-min-unique", "150", "--prog-min-facts", "4", "--prog-max-similarity", "0.4", "--data-source", "fixture data sheet (invented)"];
const DOMAIN = "sample-valley-realty.test";
const src = (n) => ({ value: n, source: "fixture (invented numbers for tests)", fetchedAt: "2026-10-20", cacheFile: null });
const cluster = (id, primary, queries, intent, location, vol, fmt, page, ents, qs, prio, words = [200, 1500]) => ({
  id, primaryQuery: primary, queries, intent, location,
  volume: { ...src(vol), estimate: Array.isArray(vol) }, difficulty: src(30), value: src(4.5), serpFeatures: src(["local_pack", "paa"]),
  winningFormat: fmt, competitorsTop3: [{ url: "https://example-competitor-one.test/page/", domain: "example-competitor-one.test" }],
  requiredEntities: ents, questions: qs, targetPage: page, priority: prio, wordRange: src(words),
});
const business = {
  name: "Sample Valley Realty", domain: DOMAIN, kind: "real-estate-agent", industry: "real-estate-agent",
  offer: "residential real estate sales and purchases", audience: "home sellers and buyers in Placer County",
  market: { country: "US", language: "en" },
  locations: [{ name: "Roseville office", address: null, serviceArea: ["Roseville", "Rocklin", "Lincoln"] }],
  goals: ["leads", "calls"], competitors: ["example-competitor-one.test", "example-competitor-two.test"], brand: { constraints: ["no MLS listing pages"] },
  existing: { site: null, searchConsole: false, businessProfile: null, socials: ["https://www.facebook.com/samplevalleyrealty.test"] },
  launchState: "live", rankTracking: { source: "search-console", locations: ["Roseville, CA"], devices: ["mobile"] },
  credentials: { state: "CA", licenseNumber: "01234567", brokerage: "Sample Valley Brokerage Inc.", licensed: true },
};
const targets = {
  version: 1, business: DOMAIN, market: { country: "US", language: "en" }, createdAt: "2026-10-20T09:00:00Z",
  clusters: [
    cluster("c-agent-roseville", "real estate agent roseville ca", ["real estate agent roseville ca", "realtor roseville ca", "roseville real estate agent"], "local", "Roseville, CA", [100, 1000], "city landing page", "/", ["Roseville", "Placer County", "Sample Valley Brokerage"], ["How do I choose a real estate agent in Roseville?", "What does a real estate agent do for sellers?"], 9),
    cluster("c-agent-rocklin", "real estate agent rocklin ca", ["real estate agent rocklin ca", "realtor rocklin ca", "rocklin real estate agent"], "local", "Rocklin, CA", [50, 500], "city landing page", "/rocklin-ca/", ["Rocklin", "Placer County"], ["How much does it cost to sell a home in Rocklin?", "How long does a home take to sell in Rocklin?"], 7),
    cluster("c-agent-lincoln", "real estate agent lincoln ca", ["real estate agent lincoln ca", "realtor lincoln ca", "lincoln real estate agent"], "local", "Lincoln, CA", [50, 500], "city landing page", "/lincoln-ca/", ["Lincoln", "Placer County"], ["How much does it cost to sell a home in Lincoln?", "How long does a home take to sell in Lincoln?"], 6),
    cluster("c-cost-of-realtor", "how much does a realtor cost in california", ["how much does a realtor cost in california", "realtor commission california", "real estate agent fees california"], "informational", null, 1900, "guide", "/sell/cost-of-a-realtor/", ["commission", "listing agreement", "buyer's agent"], ["Is 3% a normal real estate commission?", "Who pays the buyer's agent?"], 8),
    cluster("c-home-value", "home value roseville ca", ["home value roseville ca", "what is my home worth roseville"], "local", "Roseville, CA", 880, "valuation tool", "/home-value/", ["comparative market analysis", "Roseville"], ["How accurate is an online home value estimate?", "What is a comparative market analysis?"], 5),
    cluster("c-sell-without-agent", "sell my house without a realtor california", ["sell my house without a realtor california", "for sale by owner california"], "commercial", null, 720, "guide", "new", ["for sale by owner", "disclosures", "title company"], ["Can I sell my house without a realtor in California?", "What disclosures does a California seller need?"], 4),
  ],
};
const facts = (rows) => rows.map(([label, value]) => ({ label, value, source: "fixture data sheet (invented)", date: "2026-10-20" }));
const progData = { note: "Fixture facts: invented, each with source and date.", records: {
  "/rocklin-ca/": { facts: facts([["median sale price", "$812,000"], ["days on market", "27 days"], ["elementary school", "Granite Ridge Elementary"], ["trail", "Oakmont Trail"], ["park", "Stonecrest Park"], ["neighbourhood", "Whitney Oaks"]]) },
  "/lincoln-ca/": { facts: facts([["median sale price", "$689,000"], ["days on market", "41 days"], ["community", "Twelve Bridges"], ["main road", "Joiner Parkway"], ["park", "Coyote Creek Park"], ["neighbourhood", "Lincoln Crossing"]]) },
} };

// ---- the simulated builder: follows plan/briefs ----
const CITY = {
  rocklin: {
    why: ["Rocklin buyers and sellers tend to ask about school boundaries first, so every conversation starts with a map of the Granite Ridge Elementary area and the drive to Highway 65.", "We have walked the streets around Stonecrest Park and the Oakmont Trail many times, and we know which blocks sell quickly in spring and which wait for summer."],
    help: ["In Rocklin we photograph homes in the late afternoon, because the western light on the hills makes older stucco look warmer.", "Every listing gets a printed street guide naming the nearest parks, bakeries and the weekend farmers market."],
    facts: ["The median sale price in Rocklin was $812,000 in the quarter we reviewed.", "Homes near Stonecrest Park spent 27 days on the market on average, against 34 days in the wider county.", "Granite Ridge Elementary and the Oakmont Trail are the two places buyers mention most often in a first call.", "The Whitney Oaks neighbourhood has 140 homes built after 2005, which changes the inspection list for sellers there."],
    cost: ["A Rocklin seller should plan for the agent commission, escrow and title charges, transfer tax and a few small repairs before the first showing."],
    a: ["A Rocklin seller should plan for the agent commission, escrow and title charges, transfer tax and any repairs, and we write the exact figures into an estimate before you sign anything.", "Rocklin homes in good condition near Stonecrest Park often sell within a month, while homes that need work can take two or three months."],
  },
  lincoln: {
    why: ["Lincoln is a town of planned communities, so buyers ask early whether a street belongs to Twelve Bridges or to Lincoln Crossing and what the association charges.", "We keep a folder of floor plans for the older Lincoln Crossing models, which saves sellers there a lot of guessing about square footage."],
    help: ["In Lincoln we schedule open houses around the Joiner Parkway commute, because weekday evening traffic decides how many visitors arrive.", "Sellers receive a neighbourhood sheet listing the nearest trailheads, the Coyote Creek Park entrances and the closest coffee."],
    facts: ["The median sale price in Lincoln was $689,000 in the quarter we reviewed.", "Homes in Twelve Bridges spent 41 days on the market on average, longer than the county figure.", "Joiner Parkway and Coyote Creek Park are the landmarks buyers use when they describe where they want to live.", "The Lincoln Crossing community mixes single-storey and two-storey plans, which changes who tours a home first."],
    cost: ["A Lincoln seller should expect association documents, escrow and title charges, transfer tax and the agent commission, plus any repairs found at inspection."],
    a: ["A Lincoln seller should budget for the agent commission, association documents, escrow and title charges and transfer tax, and we list every figure in a written estimate first.", "Lincoln homes priced close to recent sales in Twelve Bridges tend to sell in about six weeks, while stretched prices wait much longer."],
  },
};
const ANSWERS = {
  "How do I choose a real estate agent in Roseville?": "Ask for recent sales on your street, read the reviews, compare how each agent explains price, and pick the one whose plan you can repeat back.",
  "What does a real estate agent do for sellers?": "An agent prices the home, prepares and markets it, handles offers and negotiation, and manages the paperwork through to closing.",
  "Is 3% a normal real estate commission?": "Rates are negotiable and vary by agent and home; 2.5% to 3% for each side is common, and the listing agreement states the exact figure.",
  "Who pays the buyer's agent?": "The seller usually agrees the buyer's agent fee in the listing agreement, but terms differ, so read what your agreement says before you sign.",
  "How accurate is an online home value estimate?": "Online estimates are a rough guide; they miss renovations and street-level differences, which is why an agent compares recent nearby sales by hand.",
  "What is a comparative market analysis?": "A comparative market analysis is a written comparison of your home with recently sold nearby homes, used to set a realistic list price.",
  "Can I sell my house without a realtor in California?": "Yes, an owner may sell without an agent, but you take on pricing, marketing, disclosures and negotiation yourself.",
  "What disclosures does a California seller need?": "Sellers give the buyer written disclosures about the property's condition and known problems; a title company or attorney can confirm the current forms.",
};
const EXTRA = {
  "/": ["Roseville homeowners often ask us about timing, so we share what the last three months of sales looked like on the streets near their own.", "We keep our client list small on purpose, which means the person you meet first is the person who answers your calls."],
  "/sell/cost-of-a-realtor/": ["Commission is only one line on the closing statement, and sellers who read the whole statement make better decisions.", "A listing agreement can be short or long, and the length rarely tells you anything about the service behind it.", "Ask every agent to write down what the commission includes, such as photography, staging advice and open houses."],
  "/home-value/": ["The honest answer to what a home is worth starts with the street, the condition and the latest comparable sale.", "We prepare each valuation by hand, so please allow a business day, and expect a range with reasons rather than a single number."],
  "/guides/sell-my-house-without-a-realtor-california/": ["Owners who sell alone should price against sold homes rather than listed homes, because asking prices are only hopes.", "Photographs, a clear description and quick replies to enquiries do most of the marketing work for a sale by owner.", "A title company can explain the closing steps even when no agent is involved."],
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cityKey = (pg) => (pg.location ? pg.location.split(",")[0].toLowerCase() : null);

function sectionParas(pg, heading, v) {
  const h = heading.toLowerCase(), ck = cityKey(pg), C = CITY[ck];
  const prog = pg.programmatic && C;
  if (/^who we are/.test(h)) return [`${v.brand} is a small local team. We help ${v.audience} with ${v.offer}, and we explain each step in plain words before anything is decided.`];
  if (/^areas we serve/.test(h)) return ["We work in Roseville, Rocklin and Lincoln. Each town has its own page with local facts, and every fact names its source and date."];
  if (/^why work with/.test(h)) return prog ? C.why : ["We answer your questions in plain words and put every promise in writing."];
  if (/^how we help in/.test(h)) return prog ? ["We start with a free walk-through, give you a written price range with the reasoning, and only then talk about timing, repairs and marketing.", ...C.help] : [];
  if (/^how we help/.test(h)) return ["We start with a free walk-through of your plans, give you a written price range with the reasoning, and only then talk about timing, repairs and marketing."];
  if (/market and neighbourhood facts/.test(h)) return prog ? C.facts : [];
  if (/^what it costs/.test(h)) return prog ? ["There is no fee to talk. If you list with us, the commission and every other cost are written down in the listing agreement before you sign.", ...C.cost] : [];
  if (/^the short answer/.test(h)) return [`${v.h1Plain}: the short answer is below, then the facts behind it, so you can check our reasoning against your own numbers.`];
  if (/^what changes the answer/.test(h)) return ["Three things move the answer most: the size and condition of the home, how busy the local market is this month, and what the written agreement actually includes."];
  if (/^step by step/.test(h)) return ["First gather the facts, then compare at least two written offers of service, then ask each person to explain the numbers in their own words."];
  if (/^common mistakes/.test(h)) return ["The usual mistakes are choosing on the lowest fee alone, skipping the written agreement and guessing the price from online estimates."];
  if (/^how it works/.test(h)) return ["You tell us about the home, we compare it with recent nearby sales, and we send a written range with the reasons behind it."];
  if (/^what you get/.test(h)) return ["You get a written range, the sales we compared, and a plain list of what could raise or lower the figure."];
  if (/^proof/.test(h)) return ["Our reviews are from real clients, shown with their permission and the month they were written."];
  if (/^talk to/.test(h)) return ["Tell us about your plans and we will reply the same business day with next steps."];
  if (/^(next step|get started)/.test(h)) return ["Send us a short note about your situation and we will reply the same business day with a clear next step."];
  if (/^where we work/.test(h)) return ["Every area below has its own page with local facts."];
  return ["This section is written for the people who search for this topic."];
}
function jsonld(pg, brief, v, brand) {
  const url = `https://${DOMAIN}${pg.path}`, g = [];
  for (const t of pg.schemaOverride || brief.schema) {
    if (t === "RealEstateAgent" || t === "LocalBusiness") g.push({ "@type": t, "@id": `https://${DOMAIN}/#business`, name: brand, url: `https://${DOMAIN}/`, telephone: "+1-555-010-0199", areaServed: ["Roseville", "Rocklin", "Lincoln"] });
    else if (t === "WebSite") g.push({ "@type": "WebSite", name: brand, url: `https://${DOMAIN}/` });
    else if (t === "WebPage") g.push({ "@type": "WebPage", name: brief.title, url });
    else if (t === "Service") g.push({ "@type": "Service", name: brief.h1, areaServed: "Placer County, CA", provider: { "@id": `https://${DOMAIN}/#business` } });
    else if (t === "Article") g.push({ "@type": "Article", headline: brief.h1, author: { "@type": "Person", name: "Jane Sample" }, datePublished: "2026-10-01", dateModified: "2026-10-20" });
    else if (t === "FAQPage") g.push({ "@type": "FAQPage", mainEntity: brief.questions.map((q) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: ANSWERS[q] || (CITY[cityKey(pg)]?.a[brief.questions.indexOf(q)] ?? "See the page.") } })) });
  }
  return `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": g })}</script>`;
}
function renderPage(pg, brief, sitemap, v, o = {}) {
  const outLinks = sitemap.links.filter((l) => l.from === pg.path && !(o.dropLink && o.dropLink(l)));
  const body = [`<h1>${esc(brief.h1)}</h1>`, `<p>${esc(`${v.plain(brief.h1)}: this page gives the plain answer, the facts behind it and the next step, written by ${v.brand} for ${v.audience}.`)}</p>`];
  const ents = brief.sections["entities to cover"] || [];
  const outline = brief.outline;
  const linksLi = outLinks.map((l) => `<li><a href="${l.to}">${esc(l.anchor)}</a></li>`).join("");
  for (const h of outline) {
    body.push(`<section><h2>${esc(h)}</h2>`);
    if (/^frequently asked questions/i.test(h)) {
      brief.questions.forEach((q, i) => body.push(`<h3>${esc(q)}</h3><p>${esc(ANSWERS[q] || CITY[cityKey(pg)]?.a[i] || "See the page.")}</p>`));
    } else {
      for (const t of sectionParas(pg, h, v)) body.push(`<p>${esc(t)}</p>`);
      for (const e of ents.filter((x) => x.endsWith(`(in: ${h})`))) body.push(`<p>${esc(`A note on ${e.replace(/\s*\(in:.*\)$/, "")}: it affects the advice in this section, so we explain it in plain words.`)}</p>`);
      if (outline.indexOf(h) === 0) for (const t of EXTRA[pg.path] || []) body.push(`<p>${esc(t)}</p>`);
    }
    body.push("</section>");
  }
  if (o.extraBody) body.push(o.extraBody);
  if (linksLi) body.push(`<section><h2>Related pages</h2><ul>${linksLi}</ul></section>`);
  const lic = o.noLicence ? "" : ` DRE #${business.credentials.licenseNumber}.`;
  const footer = `<footer><p>Jane Sample, Real Estate Salesperson.${lic} Broker: ${business.credentials.brokerage} &copy; 2026 ${esc(v.brand)}</p></footer>`;
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(brief.title)}</title><meta name="description" content="${esc(brief.metaDescription)}"><link rel="canonical" href="https://${DOMAIN}${pg.path}">${jsonld(pg, brief, v, v.brand)}</head>\n<body><header><nav><a href="/">${esc(v.brand)}</a></nav></header>\n<main>${body.join("\n")}</main>\n${footer}</body></html>\n`;
}

function buildSites(planned, outDir) {
  const { sitemap, briefs } = planned;
  const v = { brand: business.name, audience: business.audience, offer: business.offer, plain: (s) => s.replace(/\?$/, ""), h1Plain: "" };
  const page = (pg, o = {}) => renderPage(pg, briefs.get(pg.path), sitemap, { ...v, h1Plain: v.plain(briefs.get(pg.path).h1) }, o);
  const write = (root, p, html) => { const f = path.join(root, p === "/" ? "index.html" : path.join(p, "index.html")); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };
  const clean = path.join(outDir, "site-clean"), bad = path.join(outDir, "site");
  for (const d of [clean, bad]) fs.rmSync(d, { recursive: true, force: true });
  const MISSING = "/guides/sell-my-house-without-a-realtor-california/", ORPHAN = "/lincoln-ca/", COST = "/sell/cost-of-a-realtor/", BLOG = "/blog/realtor-fees-california/";
  for (const pg of sitemap.pages) {
    write(clean, pg.path, page(pg));
    if (pg.path === MISSING) continue; // fault: a cluster with no page
    const o = { dropLink: (l) => l.to === MISSING || l.to === ORPHAN }; // the missing page cannot be linked; the orphan gets no inbound link
    if (pg.path === "/rocklin-ca/") o.noLicence = true; // fault: no licence number
    if (pg.path === COST) o.extraBody = `<p>See also <a href="${BLOG}">our shorter note on realtor fees in California</a>.</p>`; // links the cannibal page
    const pg2 = pg.path === "/home-value/" ? { ...pg, schemaOverride: ["Article"] } : pg; // fault: wrong schema type
    write(bad, pg.path, page(pg2, o));
  }
  // fault: a second page on the cost cluster's primary query (cannibalisation); it is not in the plan
  const cb = briefs.get(COST);
  const blog = { path: BLOG, programmatic: null, location: null };
  const bb = { ...cb, sections: { ...cb.sections, "entities to cover": [] }, schema: ["Article"], questions: [], outline: ["The short answer"] };
  write(bad, BLOG, renderPage(blog, bb, { links: [{ from: BLOG, to: "/", anchor: "realtor roseville ca" }] }, { ...v, h1Plain: v.plain(cb.h1) }));

}

// ---- measure pair ----
const row = (query, location, pos, url, fetchedAt, extra = {}) => ({ query, location, device: "mobile", language: "en", engine: "google", position: { value: pos, source: "Google Search Console API (fixture)", fetchedAt, cacheFile: null }, url, ...extra });
const cite = (question, share, sources, ours, at) => ({ question, engine: "gemini", model: "gemini-fixture-1", prompt: `Answer for a homeowner in Roseville, CA: ${question}`, runs: 3, citedShare: { value: share, source: "Gemini API with Google Search grounding (fixture)", fetchedAt: at, cacheFile: null }, citedSources: sources, ourDomainCited: ours, location: "Roseville, CA" });
const measure = {
  "2026-09-22": {
    rankings: [row("real estate agent roseville ca", "Roseville, CA", 14, `https://${DOMAIN}/`, "2026-09-22"), row("real estate agent rocklin ca", "Roseville, CA", 22, `https://${DOMAIN}/rocklin-ca/`, "2026-09-22"), row("real estate agent lincoln ca", "Roseville, CA", null, null, "2026-09-22"), row("how much does a realtor cost in california", "Roseville, CA", 31, `https://${DOMAIN}/sell/cost-of-a-realtor/`, "2026-09-22"), row("home value roseville ca", "Roseville, CA", 18, `https://${DOMAIN}/home-value/`, "2026-09-22")],
    citations: [cite("How much does a realtor cost in California?", 0, ["example-competitor-one.test", "example-listing-portal.test"], false, "2026-09-22"), cite("Who is a good real estate agent in Roseville CA?", 0.3333, ["example-competitor-one.test", DOMAIN], true, "2026-09-22")],
  },
  "2026-10-22": {
    rankings: [row("real estate agent roseville ca", "Roseville, CA", 9, `https://${DOMAIN}/`, "2026-10-22"), row("real estate agent rocklin ca", "Roseville, CA", 17, `https://${DOMAIN}/rocklin-ca/`, "2026-10-22"), row("real estate agent lincoln ca", "Roseville, CA", 38, `https://${DOMAIN}/lincoln-ca/`, "2026-10-22"), row("how much does a realtor cost in california", "Roseville, CA", 25, `https://${DOMAIN}/sell/cost-of-a-realtor/`, "2026-10-22"), row("home value roseville ca", "Sacramento, CA", 12, `https://${DOMAIN}/home-value/`, "2026-10-22"), row("sell my house without a realtor california", "Roseville, CA", 44, `https://${DOMAIN}/guides/sell-my-house-without-a-realtor-california/`, "2026-10-22")],
    citations: [cite("How much does a realtor cost in California?", 0.3333, ["example-competitor-one.test", DOMAIN], true, "2026-10-22"), cite("Who is a good real estate agent in Roseville CA?", 0.6667, [DOMAIN, "example-competitor-one.test"], true, "2026-10-22")],
  },
};
const expectedDiff = {
  note: "What the measure builder's diff of 2026-09-22 -> 2026-10-22 must say (hand-written; test-plan-gate.mjs checks compareMeasure() against it).",
  rankings: {
    comparable: [{ query: "real estate agent roseville ca", from: 14, to: 9, change: 5 }, { query: "real estate agent rocklin ca", from: 22, to: 17, change: 5 }, { query: "real estate agent lincoln ca", from: null, to: 38, change: null }, { query: "how much does a realtor cost in california", from: 31, to: 25, change: 6 }],
    notComparable: [{ query: "home value roseville ca", why: "measured from a different location, device or language than the earlier run" }],
    newInB: ["sell my house without a realtor california"], goneInB: [],
  },
  citations: [{ question: "How much does a realtor cost in California?", from: 0, to: 0.3333 }, { question: "Who is a good real estate agent in Roseville CA?", from: 0.3333, to: 0.6667 }],
};

function main() {
  fs.mkdirSync(path.join(out, "pewp", "plan"), { recursive: true });
  fs.writeFileSync(path.join(out, "pewp", "business.json"), JSON.stringify(business, null, 1) + "\n");
  fs.writeFileSync(path.join(out, "pewp", "targets.json"), JSON.stringify(targets, null, 1) + "\n");
  fs.writeFileSync(path.join(out, "pewp", "plan", "programmatic-data.json"), JSON.stringify(progData, null, 1) + "\n");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-fx-"));
  fs.cpSync(path.join(out, "pewp"), tmp, { recursive: true });
  const r = spawnSync(process.execPath, [path.join(HERE, "..", "scripts", "plan-site.mjs"), tmp, ...PLAN_FLAGS], { encoding: "utf8", timeout: 300_000 });
  if (r.status !== 0) { console.error("plan-site failed:\n" + r.stdout + r.stderr); process.exit(1); }
  const sitemap = JSON.parse(fs.readFileSync(path.join(tmp, "plan", "sitemap.json"), "utf8"));

  const briefs = new Map(sitemap.pages.map((p) => [p.path, parseBrief(fs.readFileSync(path.join(tmp, p.brief), "utf8"))]));
  buildSites({ sitemap, briefs }, out);
  for (const [d, m] of Object.entries(measure)) {
    fs.mkdirSync(path.join(out, "measure", d), { recursive: true });
    fs.writeFileSync(path.join(out, "measure", d, "rankings.json"), JSON.stringify({ date: d, rankings: m.rankings }, null, 1) + "\n");
    fs.writeFileSync(path.join(out, "measure", d, "citations.json"), JSON.stringify({ date: d, citations: m.citations }, null, 1) + "\n");
  }
  fs.writeFileSync(path.join(out, "measure", "expected-diff.json"), JSON.stringify(expectedDiff, null, 1) + "\n");
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`fixtures written to ${out}`);
}


// --help prints the usage and writes nothing (the path test-main.mjs runs through a junction); inside the guard on purpose
if (isMain(import.meta.url)) { if (process.argv.includes("--help")) console.log("usage: node build-fixtures.mjs [--out <dir>]   (default: this folder)"); else main(); } // lib-main.mjs: real paths, junction/symlink safe
