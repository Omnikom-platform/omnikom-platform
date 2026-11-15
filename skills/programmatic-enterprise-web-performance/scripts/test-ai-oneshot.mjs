// Usage: node test-ai-oneshot.mjs [--no-mutants] [--mutant <text>] [--json]
// Test of ai-oneshot.mjs THROUGH THE COMMAND on an INVENTED run on disk (an invented business, invented replies): the one prompt names every place with
// its state and country and never the business; a US place without a state stops the build; the box check passes the same words and refuses one changed
// word; a reply is saved only after BOX OK, the follow-up only after message 1, never twice, never under a changed prompt; the count reads a markdown
// reply, a plain-text reply cut half way, a reply that ignored the layout and a reply about another place, and writes the files import-ai.mjs counts.
// No network (netguard-import.mjs), no browser, no clipboard (the texts go in by --file). The mutants break one rule at a time in a copy of the scripts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runner, J, W, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = "https://sample-valley-realty.test/", HOST = "sample-valley-realty.test";
const P1 = "Sampleville, CA, United States", P2 = "Testburg, CA, United States";
const BIZ = { name: "Sample Valley Realty", domain: HOST, phone: "(555) 010-2000", kind: "real estate agent", market: { country: "US", language: "en" },
  locations: [{ name: "Sampleville, CA", address: "1 Main St, Sampleville, CA 90000", serviceArea: ["Sampleville, CA", "Testburg, CA"] }],
  vocabulary: ["homes for sale", "real estate agent", "sell my house", "home valuation"] };

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
// copied as plain text (tabs, no pipes) and cut after question 4; no Part 3
const tabbed = (i) => [`Q${i}`, "Rank\tName\tCompany\tWhy\tSource", `1\tAlpha Homes ${i}\tAlpha Group\tmany recent sales\thttps://alpha-homes.test/q${i}`, "2\tGamma Estates\tGamma Estates\tlocal office\thttps://gamma-estates.test/"].join("\n");
const PERPLEXITY = ["Part 1: your recommendations", ...[1, 2, 3, 4].map(tabbed)].join("\n\n");
// ignored the layout: lists in prose under the headings
const COPILOT = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `### Q${i}\n1. Alpha Homes ${i} - a well known local team with many sales\n2. Beta Realty - strong reviews from recent clients`).join("\n\n");
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
    const s1 = await save(A, "chatgpt", 1, CHATGPT), on = jr(saved("chatgpt-1.json"));
    check("case 5c: after BOX OK the reply is saved whole, with the prompt's hash and the hash of the text it answers", s1.code === 0 && on?.answerText === CHATGPT && on.promptHash === doc.promptHash && on.textHash === doc.hash1 && /questions found: 8 of 8/.test(s1.out), d(s1));
    const s2 = await save(A, "chatgpt", 1, `${CHATGPT}\nmore`);
    check("case 5d: a saved reply is never overwritten (never a re-ask)", s2.code === 1 && /already saved/.test(s2.out) && jr(saved("chatgpt-1.json"))?.answerText === CHATGPT, d(s2));
    const D = world(BIZ);
    await cmd(D, "build"); await cmd(D, "lock", "--by", "test");
    W(path.join(D.pewp, "business.json"), { ...BIZ, vocabulary: ["homes for sale", "condos for sale"] }); W(boxF, text1);
    const d1 = await cmd(D, "box", "chatgpt", "1", "--file", boxF);
    check("case 5e: a prompt that would now be built differently from the locked one stops the sitting", d1.code === 1 && /differs from the locked one/.test(d1.out), d(d1));

    const a2 = await ask(A, "chatgpt", 2, BYNAME), ap = await ask(A, "perplexity", 1, PERPLEXITY), ac = await ask(A, "copilot", 1, COPILOT), ag = await ask(A, "gemini", 1, GEMINI, "--signed-in");
    const allSaved = [a2, ap, ac, ag].every((x) => x.bx.code === 0 && x.sv.code === 0);
    W(cap("chatgpt-1.json"), { engine: "chatgpt", type: "buyer", question: "homes for sale", capturedAt: new Date(Date.now() - 3600000).toISOString(), browser: "owner's Edge", answerText: "An older reply to a search phrase.", named: false, competitorsNamed: [], citedSources: [] });
    const c0 = await cmd(A, "count");
    check("case 8a: older replies to other questions stop the count until they are retired, and nothing is counted with them", allSaved && c0.code === 1 && /--retire-old/.test(c0.out) && !fs.existsSync(path.join(A.pewp, "research", "ai-oneshot.json")), `${[a2, ap, ac, ag].map((x) => `${x.bx.code}/${x.sv.code}`).join(" ")} | ${d(c0)} | ${d(ag.sv)}`);
    const c1 = await cmd(A, "count", "--retire-old"), res = jr(path.join(A.pewp, "research", "ai-oneshot.json")) || {};
    check("case 8b: with --retire-old the older file is moved unchanged to captures/ai-retired and the count runs", c1.code === 0 && jr(path.join(A.pewp, "captures", "ai-retired", "chatgpt-1.json"))?.question === "homes for sale" && !fs.existsSync(cap("chatgpt-1.json")), d(c1));
    const E = Object.fromEntries((res.engines || []).map((e) => [e.engine, e])), cls = (e) => JSON.stringify(E[e]?.classes ?? null), capFiles = fs.existsSync(path.join(A.pewp, "captures", "ai")) ? fs.readdirSync(path.join(A.pewp, "captures", "ai")) : [];
    check("case 6a: a reply in the layout is counted per question: the business listed once, at rank 2; a longer name that only contains its name is another business", cls("chatgpt") === JSON.stringify({ listed: 1, "not listed": 7 }) && E.chatgpt.questions[0].rank === 2 && E.chatgpt.questions[1].status === "not listed" && E.chatgpt.placeStated === true, cls("chatgpt"));
    check("case 6b: a reply copied as plain text and cut after question 4: 4 counted, 4 not reached", cls("perplexity") === JSON.stringify({ "not listed": 4, "not reached": 4 }) && capFiles.filter((x) => x.startsWith("perplexity-oneshot-q")).length === 4, cls("perplexity"));
    check("case 6c: a reply that ignored the layout is not counted (layout not followed), never not listed", cls("copilot") === JSON.stringify({ "layout not followed": 8 }) && !capFiles.some((x) => x.startsWith("copilot-oneshot-q")), `${cls("copilot")} | ${capFiles.join(" ")}`);
    check("case 6d: a reply about same-named places elsewhere is out of every count", cls("gemini") === JSON.stringify({ "other place": 8 }) && !capFiles.some((x) => x.startsWith("gemini-oneshot-q")), `${cls("gemini")} | ${capFiles.join(" ")}`);
    const im = await run("import-ai.mjs", [SITE, "--cwd", A.cwd]), ai = jr(path.join(A.pewp, "research", "ai-answers.json")) || {}, sum = ai.summary || {}, eng = (e) => (sum.engines || []).find((x) => x.engine === e) || {}, why = (e) => (sum.blockedEngines || []).find((x) => x.engine === e)?.reason || "";
    check("case 6e: import-ai.mjs reads the files as before: chatgpt 9 answers and 2 naming the business (8 questions and the follow-up), perplexity 4 and 0, copilot and gemini not read with the reason, nothing rejected, no disagreement",
      im.code === 0 && eng("chatgpt").questions === 9 && eng("chatgpt").named === 2 && eng("perplexity").questions === 4 && eng("perplexity").named === 0 && /layout not followed/.test(why("copilot")) && /other place/.test(why("gemini")) && (ai.rejected || []).length === 0 && (sum.disagreements || []).length === 0, `${d(im)} | ${JSON.stringify(sum).slice(0, 400)}`);
    const bn = E.chatgpt?.byName || {};
    check("case 7: asked by name: the assistant knows the business, its phone is right against our file, its website is wrong, two pages are named", bn.known === "YES" && bn.phone === "right" && bn.website === "wrong" && (bn.appears || []).length === 2 && Object.keys(bn.fields || {}).length === 12, JSON.stringify(bn).slice(0, 400));
  } catch (e) {
    check("the test ran to its end", false, e.stack || e);
  }
  rmTmp(tmp);
  return results;
}

const one = (name, from, to, ...expect) => ({ name, patches: [{ file: "ai-oneshot.mjs", from, to }], expect });
const MUTANTS = [
  one("a service question loses its place", 'text: `In ${p.full}, who would you recommend for "${need}"?`', 'text: `Who would you recommend for "${need}"?`', /^case 1a:/),
  one("a US place without a state passes", "if (us && !p.state) throw new Blocked(", "if (false) throw new Blocked(", /^case 2:/),
  one("the name scan of message 1 is off", "if (leak) throw new Refused(", "if (false) throw new Refused(", /^case 3:/),
  one("the box check accepts any text", "const at = firstDiff(words(want), words(got));", "const at = -1;", /^case 4a:/),
  one("a reply is saved without a box check", "if (!boxOk) throw new Refused(", "if (false) throw new Refused(", /^case 5a:/),
  one("the follow-up goes before message 1 is saved", "if (n === 2 && !saved1) throw new Refused(", "if (false) throw new Refused(", /^case 5b:/),
  one("a second save overwrites the reply", "if (fs.existsSync(out)) throw new Refused(", "if (false) throw new Refused(", /^case 5d:/),
  one("a changed prompt is still used", "if (cur.promptHash !== lock.promptHash) throw new Refused(", "if (false) throw new Refused(", /^case 5e:/),
  one("the business is matched inside a longer word", "h.includes(` ${n} `)", "h.includes(n)", /^case 6a:/),
  one("a reply that ignored the layout counts as not listed", 'blk.hasText ? "layout not followed" : "no list"', '"not listed"', /^case 6c:/),
  one("a reply about another place is counted", "const wrongPlace = stated && !placeOk(place, placeSaid);", "const wrongPlace = false;", /^case 6d:/),
  one("older answers are counted with the new", "if (old.length && !retire) throw new Refused(", "if (false) throw new Refused(", /^case 8a:/),
];

process.exit(await main({ label: "AI ONESHOT", scenarios, MUTANTS, scriptsDir: here, argv: process.argv.slice(2) }));
