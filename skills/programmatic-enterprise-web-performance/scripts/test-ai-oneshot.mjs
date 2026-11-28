// Usage: node test-ai-oneshot.mjs [--no-mutants] [--mutant <text>] [--json]
// Test of ai-oneshot.mjs THROUGH THE COMMAND on an INVENTED run on disk (an invented business, invented replies): the one prompt names every place with
// its state and country and never the business; a US place without a state stops the build; the box check passes the same words and refuses one changed
// word; a reply is saved only after BOX OK, the follow-up only after message 1, never twice, never under a changed prompt; the count reads a markdown
// reply, a plain-text reply cut half way, a reply that ignored the layout and a reply about another place, and writes the files import-ai.mjs counts.
// No network (netguard-import.mjs), no browser, no clipboard (the texts go in by --file). The mutants break one rule at a time in a copy of the scripts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runner, walk, J, W, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = "https://sample-valley-realty.test/", HOST = "sample-valley-realty.test";
const P1 = "Sampleville, CA, United States", P2 = "Testburg, CA, United States";
const BIZ = { name: "Sample Valley Realty", domain: HOST, phone: "(555) 010-2000", kind: "real estate agent", market: { country: "US", language: "en" },
  locations: [{ name: "Sampleville, CA", address: "1 Main St, Sampleville, CA 90000", serviceArea: ["Sampleville, CA", "Testburg, CA"] }],
  vocabulary: ["homes for sale", "real estate agent", "sell my house", "home valuation"], related: [{ relation: "brokerage", name: "Beta Realty", domain: "beta-realty.test" }] };

// ---------------------------------------------------------------- invented replies
const row = (r, name, co, why, url) => `| ${r} | ${name} | ${co} | ${why} | ${url} |`;
const table = (rows) => ["| Rank | Name | Company | Why you recommend them | Source |", "|---|---|---|---|---|", ...rows].join("\n");
const others = (i) => table([row(1, `Alpha Homes ${i}`, "Alpha Group", "many recent sales nearby", `https://alpha-homes.test/q${i}`), row(2, "Beta Realty", "Beta Realty", "strong reviews", "https://beta-realty.test/")]);
const sitesTable = "| Rank | Website | Full web address | What you take from it |\n|---|---|---|---|\n| 1 | Zeta Listings | https://zeta-listings.test/ | agent reviews |";
const part2 = `## Part 2: where you look\n\n### ${P1}\n${sitesTable}\n\n### ${P2}\n${sitesTable}`;
const part3 = (place) => ["## Part 3: how you answered", "| Item | Your answer |", "|---|---|", "| Searched the web for this reply, or answered from memory | Searched the web |", `| The place you understood each city to be (city, state, country) | ${place} |`,
  "| Date of the newest source you used | 2026-11-01 |", "| The three things that weigh most when you recommend one real estate agent over another | reviews, recent sales, local knowledge |", "| Anything you assumed | nothing |"].join("\n");
// in the layout: the business second for Q1 (its company cell carries a legal ending); Q2 holds a longer name that only CONTAINS the business's name
const CHATGPT = ["## Part 1: your recommendations",
  "### Q1", table([row(1, "Alpha Homes 1", "Alpha Group", "many recent sales nearby", "https://alpha-homes.test/q1"), row(2, "Ann Sample", "Sample Valley Realty LLC", "local and well reviewed", "https://www.sample-valley-realty.test/about")]),
  "### Q2", table([row(1, "Resample Valley Realty Partners", "Resample Group", "large team", "https://resample.test/"), row(2, "Beta Realty", "Beta Realty", "strong reviews", "https://beta-realty.test/")]),
  ...[3, 4, 5, 6, 7, 8].flatMap((i) => [`### Q${i}`, others(i)]), part2, part3(`${P1}; ${P2}`)].join("\n\n");
// copied from the page by hand as plain text: cells apart by runs of spaces, the header row GLUED to the first row, cut after question 4; no Part 3
const plain = (i) => [`Q${i}`, `Rank    Name    Company    Why    Source1    Alpha Homes ${i}    Alpha Group    many recent sales    https://alpha-homes.test/q${i}`, "2    Gamma Estates    Gamma Estates    local office    https://gamma-estates.test/"].join("\n");
const PLAIN = ["Part 1: your recommendations", ...[1, 2, 3, 4].map(plain)].join("\n\n");
// ignored the layout: lists in prose under the headings
const PROSE = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `### Q${i}\n1. Alpha Homes ${i} - a well known local team with many sales\n2. Beta Realty - strong reviews from recent clients`).join("\n\n");
// in the layout, but for same-named places elsewhere
const GEMINI = ["## Part 1: your recommendations", ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((i) => [`### Q${i}`, others(i)]), part2, part3("Sampleville, Ontario, Canada; Testburg, Texas, United States")].join("\n\n");
const BYNAME = ["## About this business", "| Item | What you know | Source (full web address) |", "|---|---|---|",
  "| Do you know this business (YES, NO or NOT SURE) | YES | https://www.sample-valley-realty.test/ |", "| What they do | Helps people buy and sell homes | UNKNOWN |", "| Areas they serve | Sampleville and Testburg | UNKNOWN |",
  "| Company they belong to | Sample Valley Realty | UNKNOWN |", "| Address | 1 Main St, Sampleville, CA | UNKNOWN |", "| Phone | 555-010-2000 | UNKNOWN |", "| Website | https://other-site.test | UNKNOWN |",
  "| Rating and number of reviews, and on which site | 4.8 from 30 reviews on Zeta Listings | https://zeta-listings.test/svr |", "| What they are known for | Local knowledge | UNKNOWN |",
  `| Would you recommend them to someone looking for a real estate agent in ${P1} (YES, NO or NOT SURE), and why | YES, good reviews | UNKNOWN |`, "| Why they were, or were not, in your recommendations above | Listed second for Sampleville | UNKNOWN |",
  "| What is missing or unclear about them online that would make you more likely to recommend them | More recent reviews | UNKNOWN |", "", "## Where they appear", "| Rank | Site | Full web address | What it says |", "|---|---|---|---|",
  "| 1 | Zeta Listings | https://zeta-listings.test/svr | profile with reviews |", "| 2 | Own site | https://www.sample-valley-realty.test/ | services and contact |"].join("\n");

// ---------------------------------------------------------------- scenarios
async function scenarios(dir) {
  const results = [], check = checker(results), tmp = mkTmp("ai-oneshot"), home = path.join(tmp, "home");
  fs.mkdirSync(home);
  const run = runner(dir, home, path.join(tmp, "net.log"));
  let n = 0;
  const world = (biz) => { const cwd = path.join(tmp, `w${n++}`), pewp = path.join(cwd, "site-checks", HOST, ".pewp"); W(path.join(pewp, "business.json"), biz); return { cwd, pewp }; };
  const cmd = (w, c, ...rest) => run("ai-oneshot.mjs", [c, SITE, ...rest, "--cwd", w.cwd]);
  const jr = (p) => (fs.existsSync(p) ? J(p) : null), d = (r) => `exit ${r.code} | ${r.out.slice(0, 500)}`;
  const boxF = path.join(tmp, "box.txt"), ansF = path.join(tmp, "reply.txt");
  try {
    const A = world(BIZ), pf = path.join(A.pewp, "research", "ai-oneshot-prompt.json"), saved = (f) => path.join(A.pewp, "captures", "ai-oneshot", f), cap = (f) => path.join(A.pewp, "captures", "ai", f);
    const b1 = await cmd(A, "build"), doc = jr(pf) || {}, qs = doc.questions || [], text1 = doc.text1 || "", text2 = doc.text2 || "";
    check("case 1a: build writes one prompt of 8 questions, 4 for each place, and every question names its place with state and country", b1.code === 0 && qs.length === 8 && qs.every((q) => q.text.includes(P1) || q.text.includes(P2)) && qs.filter((q) => q.text.includes(P1)).length === 4 && text1.includes("Q8. "), `${d(b1)} | ${JSON.stringify(qs.map((q) => q.text))}`);
    check("case 1b: message 1 never holds the business's name or address; the follow-up holds the name and the home place", !!text1 && !/sample valley realty/i.test(text1) && !text1.includes(HOST) && text2.includes("Sample Valley Realty") && text2.includes(P1) && !/\{\{/.test(text1 + text2), text1.slice(0, 300));
    const b2 = await cmd(A, "build");
    check("case 1c: a second build with nothing changed leaves the file as it was", b2.code === 0 && /unchanged/.test(b2.out) && jr(pf)?.generatedAt === doc.generatedAt, d(b2));

    const B = world({ ...BIZ, locations: [{ name: "Sampleville", address: "1 Main St", serviceArea: ["Sampleville"] }] }), bb = await cmd(B, "build");
    check("case 2: a place in the United States without its state stops the build (exit 3) and no prompt is written", bb.code === 3 && /state/.test(bb.out) && !fs.existsSync(path.join(B.pewp, "research", "ai-oneshot-prompt.json")), d(bb));
    const C = world({ ...BIZ, vocabulary: ["homes for sale", "sample valley realty homes"] }), bc = await cmd(C, "build");
    check("case 3: the business's own name inside message 1 is refused (exit 1) and no prompt is written", bc.code === 1 && /own name/.test(bc.out) && !fs.existsSync(path.join(C.pewp, "research", "ai-oneshot-prompt.json")), d(bc));

    const save = async (w, engine, m, text, ...flags) => { W(ansF, text); return cmd(w, "save", engine, String(m), "--file", ansF, ...flags); };
    const ask = async (w, engine, m, text, ...flags) => { W(boxF, m === 1 ? text1 : text2); const bx = await cmd(w, "box", engine, String(m), "--file", boxF); return { bx, sv: await save(w, engine, m, text, ...flags) }; };
    const lk = await cmd(A, "lock", "--by", "the head of operations (test)");
    const s0 = await save(A, "chatgpt", 1, CHATGPT);
    check("case 5a: a reply cannot be saved before the box was checked", lk.code === 0 && s0.code === 1 && /box was not checked/.test(s0.out) && !fs.existsSync(saved("chatgpt-1.json")), `${d(lk)} || ${d(s0)}`);
    W(boxF, text2);
    const f0 = await cmd(A, "box", "chatgpt", "2", "--file", boxF);
    check("case 5b: the follow-up is refused until message 1 is saved", f0.code === 1 && /message 1 is not saved/.test(f0.out), d(f0));
    W(boxF, text1.replace("recommendations", "suggestions"));
    const x1 = await cmd(A, "box", "chatgpt", "1", "--file", boxF);
    check("case 4a: one changed word in the box is BOX DIFFERS (exit 1)", x1.code === 1 && /BOX DIFFERS/.test(x1.out), d(x1));
    W(boxF, text1.replace(/\n/g, "\r\n").replace(/ /g, "  "));
    const x2 = await cmd(A, "box", "chatgpt", "1", "--file", boxF);
    check("case 4b: the same words with other line ends and doubled spaces are BOX OK", x2.code === 0 && /BOX OK/.test(x2.out), d(x2));
    W(boxF, text1.replace(/^- /gm, "•"));
    const x3 = await cmd(A, "box", "chatgpt", "1", "--file", boxF);
    check("case 4c: a rich editor that shows the text's list marks as bullets glued to the next word holds the same words: BOX OK", x3.code === 0 && /BOX OK/.test(x3.out) && /^- /m.test(text1), d(x3));
    const s1 = await save(A, "chatgpt", 1, CHATGPT), on = jr(saved("chatgpt-1.json"));
    check("case 5c: after BOX OK the reply is saved whole, with the prompt's hash and the hash of the text it answers", s1.code === 0 && on?.answerText === CHATGPT && on.promptHash === doc.promptHash && on.textHash === doc.hash1 && /questions found: 8 of 8/.test(s1.out), d(s1));
    const s2 = await save(A, "chatgpt", 1, `${CHATGPT}\nmore`);
    check("case 5d: a saved reply is never overwritten (never a re-ask)", s2.code === 1 && /already saved/.test(s2.out) && jr(saved("chatgpt-1.json"))?.answerText === CHATGPT, d(s2));
    const D = world(BIZ);
    await cmd(D, "build"); await cmd(D, "lock", "--by", "test");
    W(path.join(D.pewp, "business.json"), { ...BIZ, vocabulary: ["homes for sale", "condos for sale"] }); W(boxF, text1);
    const d1 = await cmd(D, "box", "chatgpt", "1", "--file", boxF);
    check("case 5e: a prompt that would now be built differently from the locked one stops the sitting", d1.code === 1 && /differs from the locked one/.test(d1.out), d(d1));

    const OW = world(BIZ);
    await cmd(OW, "build"); await cmd(OW, "lock", "--by", "test");
    const o1 = await save(OW, "gemini", 1, GEMINI, "--owner-pasted", "--signed-in"), oj = jr(path.join(OW.pewp, "captures", "ai-oneshot", "gemini-1.json"));
    check("case 5f: a reply the owner pasted by hand is saved without a box check, and the file says who pasted", o1.code === 0 && oj?.pasted === "by the owner, by hand" && on?.pasted === "clipboard, box checked", d(o1));

    const a2 = await ask(A, "chatgpt", 2, BYNAME), ag = await ask(A, "gemini", 1, PLAIN, "--signed-in");
    const PR = world(BIZ);   // the reply that ignored the layout, in a run of its own
    await cmd(PR, "build"); await cmd(PR, "lock", "--by", "test");
    const ap = await ask(PR, "gemini", 1, PROSE, "--signed-in");
    const allSaved = [a2, ag, ap].every((x) => x.bx.code === 0 && x.sv.code === 0);
    W(cap("chatgpt-1.json"), { engine: "chatgpt", type: "buyer", question: "homes for sale", capturedAt: new Date(Date.now() - 3600000).toISOString(), browser: "owner's Edge", answerText: "An older reply to a search phrase.", named: false, competitorsNamed: [], citedSources: [] });
    const c0 = await cmd(A, "count");
    check("case 8a: older replies to other questions stop the count until they are retired, and nothing is counted with them", allSaved && c0.code === 1 && /--retire-old/.test(c0.out) && !fs.existsSync(path.join(A.pewp, "research", "ai-oneshot.json")), `${[a2, ag, ap].map((x) => `${x.bx.code}/${x.sv.code}`).join(" ")} | ${d(c0)} | ${d(ag.sv)}`);
    const c1 = await cmd(A, "count", "--retire-old"), res = jr(path.join(A.pewp, "research", "ai-oneshot.json")) || {};
    check("case 8b: with --retire-old the older file is moved unchanged to captures/ai-retired and the count runs", c1.code === 0 && jr(path.join(A.pewp, "captures", "ai-retired", "chatgpt-1.json"))?.question === "homes for sale" && !fs.existsSync(cap("chatgpt-1.json")), d(c1));
    const E = Object.fromEntries((res.engines || []).map((e) => [e.engine, e])), cls = (e) => JSON.stringify(E[e]?.classes ?? null), capFiles = fs.existsSync(path.join(A.pewp, "captures", "ai")) ? fs.readdirSync(path.join(A.pewp, "captures", "ai")) : [];
    check("case 6a: a reply in the layout is counted per question: the business listed once, at rank 2; a longer name that only contains its name is another business", cls("chatgpt") === JSON.stringify({ listed: 1, "not listed": 7 }) && E.chatgpt.questions[0].rank === 2 && E.chatgpt.questions[1].status === "not listed" && E.chatgpt.placeStated === true, cls("chatgpt"));
    const q2 = jr(cap("chatgpt-oneshot-q2.json")) || {};
    check("case 6f: a business the owner declared related (the brokerage) is never listed instead: not in the question's file, not in the totals, named apart", JSON.stringify(q2.competitorsNamed) === JSON.stringify(["Resample Valley Realty Partners"]) && JSON.stringify(E.chatgpt.questions[1].related) === JSON.stringify(["Beta Realty"]) && !(res.instead || []).some((x) => x.name === "Beta Realty") && (res.instead || []).some((x) => x.name === "Alpha Homes 1"), `${JSON.stringify(q2.competitorsNamed)} | ${JSON.stringify(res.instead).slice(0, 300)}`);
    check("case 6b: a reply copied by hand as plain text, its header glued to the first row, cut after question 4: both rows of a list are read, 4 counted, 4 not reached", cls("gemini") === JSON.stringify({ "not listed": 4, "not reached": 4 }) && capFiles.filter((x) => x.startsWith("gemini-oneshot-q")).length === 4 && E.gemini.questions[0].rows.length === 2 && E.gemini.questions[0].rows[0].name === "Alpha Homes 1" && E.gemini.questions[0].rows[0].rank === 1, `${cls("gemini")} | ${JSON.stringify(E.gemini?.questions?.[0]?.rows)}`);
    const pc = await cmd(PR, "count"), pres = jr(path.join(PR.pewp, "research", "ai-oneshot.json")) || {}, pg1 = (pres.engines || []).find((e) => e.engine === "gemini"), pcap = path.join(PR.pewp, "captures", "ai"), pfiles = fs.existsSync(pcap) ? fs.readdirSync(pcap) : [];
    check("case 6c: a reply that ignored the layout is not counted (layout not followed), never not listed", pc.code === 0 && JSON.stringify(pg1?.classes) === JSON.stringify({ "layout not followed": 8 }) && !pfiles.some((x) => x.startsWith("gemini-oneshot-q")), `${d(pc)} | ${JSON.stringify(pg1?.classes)} | ${pfiles.join(" ")}`);
    const oc = await cmd(OW, "count"), ores = jr(path.join(OW.pewp, "research", "ai-oneshot.json")) || {}, og = (ores.engines || []).find((e) => e.engine === "gemini"), ocap = path.join(OW.pewp, "captures", "ai"), ofiles = fs.existsSync(ocap) ? fs.readdirSync(ocap) : [];
    check("case 6d: a reply about same-named places elsewhere is out of every count", oc.code === 0 && JSON.stringify(og?.classes) === JSON.stringify({ "other place": 8 }) && !ofiles.some((x) => x.startsWith("gemini-oneshot-q")), `${d(oc)} | ${JSON.stringify(og?.classes)} | ${ofiles.join(" ")}`);
    const im = await run("import-ai.mjs", [SITE, "--cwd", A.cwd]), ai = jr(path.join(A.pewp, "research", "ai-answers.json")) || {}, sum = ai.summary || {}, eng = (e) => (sum.engines || []).find((x) => x.engine === e) || {}, why = (e) => (sum.blockedEngines || []).find((x) => x.engine === e)?.reason || "";
    const pim = await run("import-ai.mjs", [SITE, "--cwd", PR.cwd]), pai = jr(path.join(PR.pewp, "research", "ai-answers.json")) || {}, pwhy = (pai.summary?.blockedEngines || []).find((x) => x.engine === "gemini")?.reason || "";
    check("case 6e: import-ai.mjs reads the files as before: chatgpt 8 answers and 1 naming the business (the follow-up by name is never among them), gemini 4 and 0, a reply that ignored the layout not read with the reason, nothing rejected, no disagreement",
      im.code === 0 && eng("chatgpt").questions === 8 && eng("chatgpt").named === 1 && !capFiles.some((x) => /-name\.json$/.test(x)) && eng("gemini").questions === 4 && eng("gemini").named === 0 && pim.code === 0 && /layout not followed/.test(pwhy) && (ai.rejected || []).length === 0 && (sum.disagreements || []).length === 0, `${d(im)} | ${JSON.stringify(sum).slice(0, 400)}`);
    const bn = E.chatgpt?.byName || {};
    check("case 7: asked by name: the assistant knows the business, its phone is right against our file, its website is wrong, two pages are named", bn.known === "YES" && bn.phone === "right" && bn.website === "wrong" && (bn.appears || []).length === 2 && Object.keys(bn.fields || {}).length === 12, JSON.stringify(bn).slice(0, 400));
    // the live report on the same files (a world without a business file, as test-ai-notread.mjs runs it)
    const R = { cwd: path.join(tmp, "wr") }, rpewp = path.join(R.cwd, "site-checks", HOST, ".pewp"), sd = path.join(R.cwd, "site-checks", HOST, "snapshots", "2026-10-24");
    fs.cpSync(path.join(A.pewp, "research"), path.join(rpewp, "research"), { recursive: true }); fs.cpSync(path.join(A.pewp, "captures"), path.join(rpewp, "captures"), { recursive: true });
    const pg = { measuredAt: "2026-10-24T10:00:00Z", vitals: { lcpMs: 1500, cls: 0.01, tbtMs: 100 }, totals: { bytes: 1024000, requests: 20 }, page: { canonical: SITE, metaDescription: "d", h1Count: 1, structuredData: [{ ok: true, types: ["WebPage"] }], og: { "og:title": "t" }, robotsMeta: [] } };
    W(path.join(sd, "_site.json"), { finishedAt: "2026-10-24T10:00:00Z", runs: 1, stoppedEarly: null, machineLoad: null, pages: [{ url: SITE, slug: "home", status: 200 }] });
    W(path.join(sd, "site/robots.json"), { status: 200, groups: [{ agents: ["*"], rules: [] }] }); W(path.join(sd, "site/sitemaps.json"), { urlCount: 3 }); W(path.join(sd, "site/probes.json"), { notFound: { finalStatus: 404 } });
    W(path.join(sd, "pages", "home", "browser-mobile.json"), { url: SITE, ...pg }); W(path.join(sd, "pages", "home", "response.json"), { headers: {} });
    const rr = await run("report-live.mjs", [SITE, "--cwd", R.cwd, "--snapshot", sd], { env: { GSC_TOKEN_FILE: "", GSC_SERVICE_ACCOUNT_FILE: "", GSC_SERVICE_ACCOUNT_JSON_B64: "" } });
    const rf = path.join(rpewp, "report.md"), sec = ((fs.existsSync(rf) ? fs.readFileSync(rf, "utf8") : "").split("### AI answers")[1] || "").split("\n### ")[0], rl = sec.split("\n").filter((l) => l.startsWith("- "));
    const want = ['- chatgpt: the business is in 1 of 8 lists of recommendations (place 2 for "In Sampleville, CA, United States, which real estate agent would you recommend?")', "- gemini: the business is in 0 of 4 lists of recommendations; not counted: 4 not reached", 
      "- Asked about the business by name: chatgpt knows it (phone right, website wrong, would recommend it: YES)", "- The business's own site is among the sources the assistants name"];
    const R2 = { cwd: path.join(tmp, "wr2") };   // the same report on the run whose one reply ignored the layout
    fs.cpSync(R.cwd, R2.cwd, { recursive: true });
    for (const sub of ["research", "captures"]) { const to = path.join(R2.cwd, "site-checks", HOST, ".pewp", sub); fs.rmSync(to, { recursive: true, force: true }); fs.cpSync(path.join(PR.pewp, sub), to, { recursive: true }); }
    const rr2 = await run("report-live.mjs", [SITE, "--cwd", R2.cwd, "--snapshot", path.join(R2.cwd, "site-checks", HOST, "snapshots", "2026-10-24")], { env: { GSC_TOKEN_FILE: "", GSC_SERVICE_ACCOUNT_FILE: "", GSC_SERVICE_ACCOUNT_JSON_B64: "" } });
    const rf2 = path.join(R2.cwd, "site-checks", HOST, ".pewp", "report.md"), none2 = (fs.existsSync(rf2) ? fs.readFileSync(rf2, "utf8") : "").split("\n").includes("- gemini: no list was counted: 8 layout not followed");
    check("case 9: the live report prints the one-prompt run in its own words: lists of recommendations per assistant, what was not counted, the follow-up by name apart; never 'answers name the business'", rr.code === 0 && rr2.code === 0 && none2 && want.every((x) => rl.includes(x)) && !rl.some((l) => /answers name the business|named in \d+ of/.test(l)) && rl.some((l) => l.startsWith("- Listed most often instead: ") && !l.includes("Beta Realty")), `exit ${rr.code} | ${JSON.stringify(rl)}`);
    // ---- case 18h: the check record of ask-assistants.mjs (captures/ai-oneshot/<engine>-check.json, owner 2026-11-22 11:43) is not a reply: count, lock and blocked do not trip over it
    const CKW = world(BIZ), ckd = path.join(CKW.pewp, "captures", "ai-oneshot"), rec18 = (engine) => ({ engine, host: engine + ".test", shownAt: new Date().toISOString(), stage: "load", rang: true, answered: true, waitedSeconds: 10, secondShowing: false });
    await cmd(CKW, "build"); const lk1 = await cmd(CKW, "lock", "--by", "test");
    W(path.join(ckd, "chatgpt-check.json"), rec18("chatgpt")); W(path.join(ckd, "gemini-check.json"), rec18("gemini")); W(path.join(A.pewp, "captures", "ai-oneshot", "chatgpt-check.json"), rec18("chatgpt"));
    const bk = await cmd(CKW, "blocked", "gemini", "--reason", "sign-in wall");
    W(path.join(CKW.pewp, "business.json"), { ...BIZ, name: "Sample Valley Realty Group" });   // a changed prompt: a new lock is refused only when REPLY files answer the old one
    const lb = await cmd(CKW, "build"), lk2 = await cmd(CKW, "lock", "--by", "test");
    const cc2 = await cmd(A, "count"), res2 = jr(path.join(A.pewp, "research", "ai-oneshot.json")) || {};
    check("case 18h: with a <engine>-check.json in the folder: blocked is written, a changed prompt is locked again (a check file is not a reply), and count gives the same engines as without it",
      lk1.code === 0 && bk.code === 0 && fs.existsSync(path.join(ckd, "gemini-blocked.json")) && lb.code === 0 && lk2.code === 0 && cc2.code === 0 && JSON.stringify(res2.engines) === JSON.stringify(res.engines) && (res2.engines || []).length > 0, [lk1, bk, lb, lk2, cc2].map(d).join(" || "));
    // ---- case 20 (AB-9): the steps ai-prompt and ai-lock of pipeline.json run these commands; asked.json (ask-assistants.mjs's record of a run) is not a reply
    const PM = JSON.parse(fs.readFileSync(path.join(here, "..", "pipeline.json"), "utf8")), argAfter = (id, flag) => { const a = PM.steps.find((s) => s.id === id)?.args || []; return a[a.indexOf(flag) + 1] ?? ""; };
    const byText = argAfter("ai-lock", "--by");   // the manifest's own text: what the run says about who froze the texts
    const LK = world(BIZ), lkf = path.join(LK.pewp, "captures", "ai-oneshot", "prompt-lock.json"), pfl = path.join(LK.pewp, "research", "ai-oneshot-prompt.json");
    const lb20 = await cmd(LK, "build"), ll1 = await cmd(LK, "lock", "--by", byText), lj1 = jr(lkf) || {};
    check("case 20a: build, then lock with the manifest's own --by text: exit 0, the lock holds that text and the hash of the built prompt", byText.length > 40 && !/\u2014/.test(byText) && lb20.code === 0 && ll1.code === 0 && lj1.by === byText && !!lj1.promptHash && lj1.promptHash === jr(pfl)?.promptHash, `by "${byText}" | ${d(lb20)} | ${d(ll1)}`);
    await ask(LK, "chatgpt", 1, CHATGPT);   // a reply on file for this prompt
    const ll2 = await cmd(LK, "lock", "--by", byText), lj2 = jr(lkf) || {};
    check("case 20b: a second lock of the same, unchanged prompt (the step run again) is NOT refused: exit 0, the hashes and the text are as before and the reply on file stays (it writes the lock again, with a new time)", ll2.code === 0 && lj2.promptHash === lj1.promptHash && lj2.hash1 === lj1.hash1 && lj2.hash2 === lj1.hash2 && lj2.by === byText && Date.parse(lj2.lockedAt) >= Date.parse(lj1.lockedAt) && fs.existsSync(path.join(LK.pewp, "captures", "ai-oneshot", "chatgpt-1.json")), d(ll2));
    const cnt20a = await cmd(LK, "count"), eng20a = jr(path.join(LK.pewp, "research", "ai-oneshot.json"))?.engines;
    const askedDoc = { step: "ai-ask", at: new Date().toISOString(), outcomes: { chatgpt: "read", gemini: "blocked (sign-in wall)" } };
    W(path.join(LK.pewp, "captures", "ai-oneshot", "asked.json"), askedDoc);
    const cnt20b = await cmd(LK, "count"), eng20b = jr(path.join(LK.pewp, "research", "ai-oneshot.json"))?.engines;   // the same engines with asked.json beside the replies
    const blk20 = await cmd(LK, "blocked", "gemini", "--reason", "sign-in wall"), lkA = await cmd(LK, "lock", "--by", byText);
    const AK = world(BIZ), akd = path.join(AK.pewp, "captures", "ai-oneshot");
    await cmd(AK, "build"); await cmd(AK, "lock", "--by", byText); W(path.join(akd, "asked.json"), askedDoc);
    W(path.join(AK.pewp, "business.json"), { ...BIZ, name: "Sample Valley Realty Group" });   // a changed prompt: a new lock is refused only when REPLY files answer the old one
    const akb = await cmd(AK, "build"), akl = await cmd(AK, "lock", "--by", byText);
    check("case 20c: with asked.json in the folder: count gives the same engines as without it, blocked and a second lock still work, and a changed prompt is locked again (asked.json is not a reply)", cnt20a.code === 0 && cnt20b.code === 0 && blk20.code === 0 && lkA.code === 0 && JSON.stringify(eng20b) === JSON.stringify(eng20a) && (eng20a || []).length > 0 && akb.code === 0 && akl.code === 0, [cnt20a, blk20, lkA, cnt20b, akb, akl].map(d).join(" || "));
    // ---- case 10: two assistants (copilot left on 2026-11-22; Perplexity leaves the paste form, owner's pick M332)
    const three = await Promise.all([cmd(A, "box", "copilot", "1", "--file", boxF), cmd(A, "blocked", "copilot", "--reason", "sign-in wall"), cmd(A, "save", "nobody", "1", "--file", boxF)]);
    const listed = three.map((r) => (/the assistant is one of ([a-z, ]+)/.exec(r.out) || [])[1]);
    check("case 10: the assistants a new run asks are two: chatgpt, gemini; copilot is refused (exit 2) with exactly that list, by box and by blocked, as any other name is", three.every((r) => r.code === 2) && listed.every((l) => l === "chatgpt, gemini") && !fs.existsSync(path.join(A.pewp, "captures", "ai-oneshot", "copilot-blocked.json")), three.map((r) => d(r)).join(" || "));
    // ---- case 21: Perplexity left the paste form (its terms bar a manual process too); count writes one gap line for it, with the stand-in RT-A
    const QUOTE = "or engage in any manual process to do the same", AT = "perplexity-terms.txt:97";
    const tree = (w) => walk(w.cwd).map((p) => `${path.relative(w.cwd, p)} ${fs.statSync(p).size} ${fs.statSync(p).mtimeMs}`).sort().join("\n");
    const PX = world(BIZ);
    await cmd(PX, "build"); await cmd(PX, "lock", "--by", "test"); W(boxF, text1); W(ansF, CHATGPT);
    const noShell = path.join(tmp, "empty-path");   // clip is run with no PowerShell to be found, so a clip that is not refused cannot touch the machine's clipboard
    fs.mkdirSync(noShell);
    const noPs = Object.fromEntries([...Object.keys(process.env).filter((k) => k.toUpperCase() === "PATH"), "PATH"].map((k) => [k, noShell]));
    const was = tree(PX);
    const px = [
      ["clip", await run("ai-oneshot.mjs", ["clip", SITE, "perplexity", "1", "--cwd", PX.cwd], { env: noPs })],
      ["box", await cmd(PX, "box", "perplexity", "1", "--file", boxF)],
      ["save", await cmd(PX, "save", "perplexity", "1", "--file", ansF)],
      ["save --owner-pasted", await cmd(PX, "save", "perplexity", "1", "--file", ansF, "--owner-pasted")],
      ["blocked", await cmd(PX, "blocked", "perplexity", "--reason", "sign-in wall")],
    ];
    for (const [verb, r] of px) check(`case 21a: ${verb} for perplexity is REFUSED (exit 1) with one line that quotes the terms and names the line of the file`, r.code === 1 && r.out.trim().split("\n").length === 1 && r.out.startsWith("REFUSED: ") && r.out.includes(QUOTE) && r.out.includes(AT), d(r));
    check("case 21a: after clip, box, save and blocked for perplexity no file is written or changed", tree(PX) === was, tree(PX));
    const g0 = await cmd(PX, "count");
    check("case 21b: with no reply and no blocked assistant on file the count is still BLOCKED: the gap line is not a sitting", g0.code === 3 && /no reply and no blocked assistant/.test(g0.out) && !fs.existsSync(path.join(PX.pewp, "research", "ai-oneshot.json")), d(g0));
    await ask(PX, "chatgpt", 1, CHATGPT); await ask(PX, "gemini", 1, PLAIN, "--signed-in");
    const old = path.join(PX.pewp, "captures", "ai-oneshot", "perplexity-1.json");   // a reply saved before Perplexity left, under the same locked prompt
    W(old, { engine: "perplexity", message: 1, promptHash: doc.promptHash, textHash: doc.hash1, capturedAt: new Date().toISOString(), signedIn: true, answerText: CHATGPT.replaceAll("Alpha Homes", "Omega Homes") });
    const oldText = fs.readFileSync(old, "utf8");
    const g1 = await cmd(PX, "count"), gres = jr(path.join(PX.pewp, "research", "ai-oneshot.json")) || {}, ge = gres.engines || [], gap = ge.filter((e) => e.engine === "perplexity");
    check("case 21c: with chatgpt and gemini on file the count is OK: 2 read assistants and exactly one gap line for perplexity, with the terms line as its reason and the stand-in RT-A", g1.code === 0 && JSON.stringify(ge.filter((e) => e.status === "read").map((e) => e.engine)) === JSON.stringify(["chatgpt", "gemini"]) && ge.length === 3 && gap.length === 1 && gap[0].status === "gap" && gap[0].standIn === "RT-A" && String(gap[0].reason).includes(QUOTE) && String(gap[0].reason).includes(AT) && g1.out.split("\n").filter((l) => /^\s*perplexity: gap/.test(l)).length === 1, `${d(g1)} | ${JSON.stringify(gap)}`);
    const gcap = path.join(PX.pewp, "captures", "ai"), gfiles = fs.existsSync(gcap) ? fs.readdirSync(gcap) : [];
    check("case 21d: a perplexity reply already on file is not counted (no file in captures/ai, none of its names in any total) and is left where it is", !gfiles.some((x) => x.startsWith("perplexity")) && gfiles.length > 0 && !JSON.stringify(gres).includes("Omega Homes") && fs.existsSync(old) && fs.readFileSync(old, "utf8") === oldText, `${gfiles.join(" ")} | ${JSON.stringify(gres.instead).slice(0, 300)}`);
  } catch (e) {
    check("the test ran to its end", false, e.stack || e);
  }
  rmTmp(tmp);
  return results;
}

const one = (name, from, to, ...expect) => ({ name, patches: [{ file: "ai-oneshot.mjs", from, to }], expect });
const MUTANTS = [
  one("a check record is read as a reply", '/-[12]\\.json$/.test(x)', '/-[a-z0-9]+\\.json$/.test(x)', /^case 18h:/),
  one("asked.json is read as a reply", '/-[12]\\.json$/.test(x)', '/(-[12]|asked)\\.json$/.test(x)', /^case 20c:/),
  one("copilot is back among the assistants", 'const ENGINES = ["chatgpt", "gemini"];', 'const ENGINES = ["chatgpt", "copilot", "gemini"];', /^case 10:/),
  one("a service question loses its place", 'text: `In ${p.full}, who would you recommend for "${need}"?`', 'text: `Who would you recommend for "${need}"?`', /^case 1a:/),
  one("a US place without a state passes", "if (us && !p.state) throw new Blocked(", "if (false) throw new Blocked(", /^case 2:/),
  one("the name scan of message 1 is off", "if (leak) throw new Refused(", "if (false) throw new Refused(", /^case 3:/),
  one("the box check accepts any text", "const at = firstDiff(words(want), words(got));", "const at = -1;", /^case 4a:/),
  one("a bullet shown for a list mark is a difference", 'String(s).replace(/[•◦▪‣]/g, " - ")', "String(s)", /^case 4c:/),
  one("a reply is saved without a box check", "if (!boxOk) throw new Refused(", "if (false) throw new Refused(", /^case 5a:/),
  one("the follow-up goes before message 1 is saved", "if (n === 2 && !saved1) throw new Refused(", "if (false) throw new Refused(", /^case 5b:/),
  one("a second save overwrites the reply", "if (fs.existsSync(out)) throw new Refused(", "if (false) throw new Refused(", /^case 5d:/),
  one("a changed prompt is still used", "if (cur.promptHash !== lock.promptHash) throw new Refused(", "if (false) throw new Refused(", /^case 5e:/),
  one("the business is matched inside a longer word", "h.includes(` ${n} `)", "h.includes(n)", /^case 6a:/),
  one("a reply that ignored the layout counts as not listed", 'blk.hasText ? "layout not followed" : "no list"', '"not listed"', /^case 6c:/),
  one("a reply about another place is counted", "const wrongPlace = stated && !placeOk(place, placeSaid);", "const wrongPlace = false;", /^case 6d:/),
  one("a header glued to the first row loses that row", "(c && headRe.test(c[0]) ? unglue(c) : c)", "(c && headRe.test(c[0]) ? null : c)", /^case 6b:/),
  one("a related business is listed instead", "real.filter((r) => r !== mine && !isRelated(r)).map((r) => r.name))]", "real.filter((r) => r !== mine).map((r) => r.name))]", /^case 6f:/),
  one("the owner's own paste is not recorded", 'pasted: a.has("owner-pasted") ? "by the owner, by hand" : "clipboard, box checked"', 'pasted: "clipboard, box checked"', /^case 5f:/),
  { name: "the live report ignores the one-prompt run", patches: [{ file: "report-live.mjs", from: "if (one) return one;", to: "if (false) return one;" }], expect: [/^case 9:/] },
  one("perplexity is taken by clip, box and save again", "  refuseOut(engine);\n  if (!ENGINES.includes(engine)) throw new Usage(`the assistant is one of ${ENGINES.join(\", \")}`);\n  if (n !== 1", "  if (n !== 1", /^case 21a:/),
  one("perplexity is taken by blocked again", "  refuseOut(engine);\n  if (!ENGINES.includes(engine)) throw new Usage(`the assistant is one of ${ENGINES.join(\", \")}`);\n  if (!reason)", "  if (!reason)", /^case 21a:/),
  one("the refusal does not name the terms line", "is not asked by hand or by script: ${OUT[engine]}", "is not asked by hand or by script", /^case 21a:/),
  one("the gap line is not written", "engines: [...engines, ...GAPS]", "engines", /^case 21c:/),
  one("the gap line is not printed", "...GAPS.map(line), ", "", /^case 21c:/),
  one("perplexity is counted again", 'const ENGINES = ["chatgpt", "gemini"];', 'const ENGINES = ["chatgpt", "perplexity", "gemini"];', /^case 21d:/),
  one("older answers are counted with the new", "if (old.length && !retire) throw new Refused(", "if (false) throw new Refused(", /^case 8a:/),
];

process.exit(await main({ label: "AI ONESHOT", scenarios, MUTANTS, scriptsDir: here, argv: process.argv.slice(2) }));
