// Usage: node test-prompt-map.mjs [--scripts <dir>] [--json] [--no-mutants] [--verbose]
// Self-test of the prompt map (DECISIONS 35, slice 5a): lib-prompt-map.mjs (row, validator, personal-data rules, engines) and research-prompts.mjs
// (candidates from leads, reviews, forums, existing; --check; --engines) on SYNTHETIC input only: an invented tea shop, temp folders, no network,
// no model API, no client file. Every refusal has its own check, and the M part breaks the scripts one rule at a time (the patch asserts its
// target text exists exactly once, so "the patch never applied" cannot pass as green) and requires the NAMED check to go red.
//   L lib helpers   V validator refusals   C candidates   E engines   K --check CLI   N network guard   M mutants
// Exit 0 = all pass. --json prints {passed, total, failed:[names]} as the last line (child mode of the M part).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(opt("--scripts") || HERE);
const SKILL = path.join(HERE, "..");
const VERBOSE = args.includes("--verbose");

async function suite(scriptsDir) {
  const R = [];
  const check = (name, ok, detail = "") => R.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 900) });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-pm-"));
  const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof s === "string" ? s : JSON.stringify(s, null, 1)); };
  const J = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
  const rf = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } }; // a missing file is a red check, never a crash that hides the named one
  const lib = await import(pathToFileURL(path.join(scriptsDir, "lib-prompt-map.mjs")).href);
  // every child refuses a request that is not to this machine and logs it: the last check asserts the log is empty
  const guard = path.join(tmp, "netguard.mjs"), netLog = path.join(tmp, "net.log");
  w(guard, `import fs from "node:fs"; const real = globalThis.fetch; globalThis.fetch = (i, o) => { const u = typeof i === "string" ? i : i?.url ?? String(i); let h = ""; try { h = new URL(u).hostname; } catch {} if (!/^(127\\.0\\.0\\.1|localhost)$/.test(h)) { fs.appendFileSync(process.env.PM_NETLOG, u + "\\n"); return Promise.reject(new Error("NETWORK GUARD " + u)); } return real(i, o); };\n`);
  const env = { ...process.env, NODE_OPTIONS: `--import ${pathToFileURL(guard).href}`, PM_NETLOG: netLog, PEWP_RULES_DIR: process.env.PEWP_RULES_DIR || path.join(SKILL, "rules"), PEWP_FIXTURES_DIR: process.env.PEWP_FIXTURES_DIR || path.join(SKILL, "fixtures") };
  const node = (a) => spawnSync(process.execPath, [path.join(scriptsDir, "research-prompts.mjs"), ...a], { encoding: "utf8", timeout: 120000, env, cwd: tmp });
  let seq = 0;
  // a fresh target folder with a business (an invented tea shop)
  const target = () => { const t = path.join(tmp, `t${seq++}`); w(path.join(t, ".pewp", "business.json"), { name: "Kettle & Leaf Tea Shop", domain: "kettleandleaf.test", market: { country: "US", language: "en" } }); return t; };
  const rd = (t, f) => path.join(t, ".pewp", f === "prompt-candidates.json" ? "private" : "research", f); // the candidates hold lead text: private/, git-ignored

  try {
    // ============ L: lib helpers ============
    check("L: promptId is pm- plus 8 hex of sha256 (known vector: hello -> 2cf24dba)", lib.promptId("hello") === "pm-2cf24dba", lib.promptId("hello"));
    const long = "word ".repeat(200);
    check("L: cutQuote collapses white space and cuts to 300 characters", lib.cutQuote(`  a \n\n b  ${long}`).length === 300 && lib.cutQuote("  a \n b ") === "a b", lib.cutQuote(long).length);
    check("L: an email address and a US phone number are personal data", lib.hasPersonalData("write to sam@example.test please") && lib.hasPersonalData("call 415-555-0134 now") && lib.hasPersonalData("call (415) 555-0134") && lib.hasPersonalData("my number 4155550134"));
    check("L: a year range, a price and a plain sentence are not personal data", !lib.hasPersonalData("a house built 2005-2015 for under $400,000 in Austin") && !lib.hasPersonalData("renting versus buying with 20% down"));
    check("L: freeTexts keeps free sentences and drops person keys, short values, numbers", (() => { const t = lib.freeTexts({ message: "we want a gift box for an office of twelve people", name: "this is a long name field with many words", email_address: "four words in an email field", budget: 400, kind: "Buying a home", extra: ["second free text answer with enough words"] }); return t.length === 2 && t.includes("we want a gift box for an office of twelve people"); })());
    check("L: parseCsv reads quoted cells with commas, doubled quotes and line breaks", (() => { const r = lib.parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n'); return r.length === 2 && r[1][0] === "x, y" && r[1][1] === 'say "hi"\nthere'; })(), JSON.stringify(lib.parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n')));

    // ============ V: validator ============
    const good = () => { const prompt = "I am a first-time buyer in Austin, should I rent or buy a house under 400k?"; return { id: lib.promptId(prompt), prompt, scenario: "first-time buyer in Austin", comparison: "renting versus buying", constraint: "under 400k", location: "Austin, TX", sources: [{ kind: "lead", ref: "leads.csv:3", seenAt: "2026-10-01" }], engines: { chatgpt: { named: true, cited: true, pageCited: "https://kettleandleaf.test/guides/", at: "2026-10-20", source: "captures/ai/a.json" }, perplexity: { named: null, cited: null, pageCited: null, at: null, source: null } }, fix: { kind: "new-page", target: "new", pageType: "situation", note: "no page answers the first-time buyer case" } }; };
    const bad = (mut) => { const r = good(); mut(r); return lib.validateRow(r); };
    const has = (errs, rule, re) => errs.some((e) => e.rule === rule && re.test(e.message));
    check("V: a complete row passes", lib.validateRow(good()).length === 0, JSON.stringify(lib.validateRow(good())));
    check("V: a bare list and an object with rows are both a map", lib.validateMap([good()]).ok && lib.validateMap({ rows: [good()] }).ok && !lib.validateMap({ nope: 1 }).ok);
    for (const k of ["scenario", "comparison", "constraint"]) check(`V: refuses a row whose ${k} is empty`, has(bad((r) => { r[k] = "  "; }), "PM-PARTS", new RegExp(`^${k} is empty`)), JSON.stringify(bad((r) => { r[k] = " "; })));
    check("V: refuses a row whose location is not a string (empty is allowed: no place named)", has(bad((r) => { delete r.location; }), "PM-PARTS", /location/) && lib.validateRow({ ...good(), location: "" }).length === 0);
    check("V: refuses a row with no source", has(bad((r) => { r.sources = []; }), "PM-SRC", /no source/) && has(bad((r) => { delete r.sources; }), "PM-SRC", /no source/));
    check("V: refuses a source of an unknown kind", has(bad((r) => { r.sources[0].kind = "rumour"; }), "PM-SRC", /kind must be one of/));
    check("V: refuses a source with no ref", has(bad((r) => { r.sources[0].ref = ""; }), "PM-SRC", /ref is empty/));
    check("V: refuses a source with a bad or future date", has(bad((r) => { r.sources[0].seenAt = "last week"; }), "PM-SRC", /seenAt/) && has(bad((r) => { r.sources[0].seenAt = "2999-01-01"; }), "PM-SRC", /seenAt/));
    const badq = (mut) => bad((r) => { r.sources[0].kind = "review"; r.sources[0].quote = "a buyer question about gift boxes"; mut(r); }); // a public source: it keeps its quote
    check("V: refuses a lead source that carries a quote (even an empty one); a lead with ref and seenAt only passes", has(bad((r) => { r.sources[0].quote = "first-time buyer in Austin, rent or buy under 400k"; }), "PM-SRC", /lead source and carries a quote/) && has(bad((r) => { r.sources[0].quote = ""; }), "PM-SRC", /lead source and carries a quote/) && !bad(() => {}).length);
    check("V: refuses a review, forum or existing source with no quote", has(badq((r) => { r.sources[0].quote = ""; }), "PM-SRC", /quote is empty/) && has(badq((r) => { delete r.sources[0].quote; }), "PM-SRC", /quote is empty/) && has(bad((r) => { r.sources[0].kind = "forum"; }), "PM-SRC", /quote is empty/));
    check("V: refuses a source quote of 301 characters and accepts 300", has(badq((r) => { r.sources[0].quote = "q".repeat(301); }), "PM-QUOTE", /301 characters/) && !badq((r) => { r.sources[0].quote = "q".repeat(300); }).length);
    check("V: refuses an email address or a phone number in a quote or a prompt", has(badq((r) => { r.sources[0].quote = "mail me at sam@example.test about gift boxes"; }), "PM-PII", /quote/) && has(badq((r) => { r.sources[0].quote = "call 415-555-0134 about gift boxes"; }), "PM-PII", /quote/) && has(bad((r) => { r.prompt = "ring 415-555-0134 gift boxes for an office"; r.id = lib.promptId(r.prompt); }), "PM-PII", /prompt/));
    check("V: refuses an id that is not the hash of the prompt", has(bad((r) => { r.id = "pm-00000000"; }), "PM-ID", /expected pm-/) && has(bad((r) => { r.prompt += " today"; }), "PM-ID", /expected pm-/));
    check("V: refuses a fix that is a list of two fixes", has(bad((r) => { r.fix = [{ kind: "new-page", target: "new", pageType: "situation", note: "a" }, { kind: "improve-page", target: "/guides/", note: "b" }]; }), "PM-FIX", /ONE object/));
    check("V: refuses a fix with two kinds in one field, an unknown kind, or no kind", has(bad((r) => { r.fix.kind = ["new-page", "improve-page"]; }), "PM-FIX", /exactly one of/) && has(bad((r) => { r.fix.kind = "new-page|improve-page"; }), "PM-FIX", /exactly one of/) && has(bad((r) => { r.fix.kind = "rewrite"; }), "PM-FIX", /exactly one of/) && has(bad((r) => { delete r.fix; }), "PM-FIX", /ONE object/));
    check("V: a new-page fix has target new and pageType situation or comparison", has(bad((r) => { r.fix.target = "/x/"; }), "PM-FIX", /target "new"/) && has(bad((r) => { r.fix.pageType = "guide"; }), "PM-FIX", /pageType/) && has(bad((r) => { delete r.fix.pageType; }), "PM-FIX", /pageType/) && !bad((r) => { r.fix.pageType = "comparison"; }).length);
    check("V: an improve-page fix names a page path; an earn-mention fix names a path or new", has(bad((r) => { r.fix = { kind: "improve-page", target: "new", note: "n" }; }), "PM-FIX", /path/) && has(bad((r) => { r.fix = { kind: "improve-page", target: "guides/", note: "n" }; }), "PM-FIX", /path/) && !bad((r) => { r.fix = { kind: "improve-page", target: "/guides/", pageType: "guide", note: "n" }; }).length && !bad((r) => { r.fix = { kind: "earn-mention", target: "new", note: "n" }; }).length && has(bad((r) => { r.fix = { kind: "earn-mention", target: "tea", note: "n" }; }), "PM-FIX", /earn-mention/));
    check("V: refuses a fix with an empty note or target", has(bad((r) => { r.fix.note = ""; }), "PM-FIX", /note/) && has(bad((r) => { r.fix.target = ""; }), "PM-FIX", /target/));
    check("V: engines: an unknown engine, a bare boolean with no source or date, a page without a citation are refused", has(bad((r) => { r.engines.copilot = { named: null, cited: null, pageCited: null, at: null, source: null }; }), "PM-ENG", /unknown engine/) && has(bad((r) => { r.engines.chatgpt.source = null; }), "PM-ENG", /no date or no source/) && has(bad((r) => { r.engines.chatgpt.at = null; }), "PM-ENG", /no date or no source/) && has(bad((r) => { r.engines.chatgpt.cited = false; }), "PM-ENG", /pageCited is set/) && has(bad((r) => { r.engines.chatgpt.named = "yes"; }), "PM-ENG", /true, false or null/));
    check("V: a row with no engines key passes (engines are filled after the map is written)", !bad((r) => { delete r.engines; }).length);
    const dupMap = lib.validateMap([good(), good()]);
    check("V: refuses the same id or the same prompt twice", !dupMap.ok && dupMap.errors.some((e) => e.rule === "PM-DUP" && /^id pm-[0-9a-f]{8} appears twice/.test(e.message)) && dupMap.errors.some((e) => e.rule === "PM-DUP" && /same prompt/.test(e.message)), JSON.stringify(dupMap.errors));
    check("V: unsourced entries: needs a prompt and a why, must not carry a source or sit in the map", lib.validateUnsourced([{ prompt: "p one two three", why: "heard in a call" }], []).length === 0 && lib.validateUnsourced([{ prompt: "p" }], []).length === 1 && lib.validateUnsourced([{ prompt: "p", why: "w", sources: [{}] }], []).length === 1 && lib.validateUnsourced([{ prompt: good().prompt, why: "w" }], [good()]).length === 1);

    // ============ C: candidates ============
    const EMAIL = "priya.ramanathan@example-mail.test", PHONE = "415-555-0198", PERSON = "Priya Ramanathan";
    const longText = "We are a small law firm office and need a gift box for twelve partners every december ".repeat(8).trim();
    const csvq = (s) => `"${s.replace(/"/g, '""')}"`;
    const leadRow = (received, name, email, phone, answers) => [received, name, email, phone, "contact", "/contact/", "new", "", csvq(JSON.stringify(answers))].join(",");
    const csv = [
      "received,name,email,phone,form,page,status,owner,answers",
      leadRow("2026-10-02T09:30:00Z", PERSON, EMAIL, PHONE, { message: "Looking for a gift box for an office of twelve people, is loose leaf better than bags for a gift?", name: "Priya Ramanathan the tea buyer", phone: "415 555 0198 call anytime", kind: "Gift box", budget: 80 }),
      leadRow("2026-10-03T11:00:00Z", "Marcus Webb", "marcus@example-mail.test", "415-555-0111", { message: "Looking for a gift box for an office of twelve people, is loose leaf better than bags for a gift?\n" }),
      leadRow("2026-10-04T08:00:00Z", PERSON, EMAIL, PHONE, { message: `Hi I am ${PERSON} and I want to know which oolong is best for a beginner under twenty dollars` }),
      leadRow("2026-10-04T08:05:00Z", "Dana Cho", "dana@example-mail.test", "415-555-0122", { message: "Please email me at ops.desk@example-mail.test about a monthly tea subscription for two people" }),
      leadRow("2026-10-05T08:05:00Z", "Lee Park", "lee@example-mail.test", "415-555-0133", { message: "Can I get a tea subscription for two people that ships monthly to the Austin area?", note: "ring 415-555-0133 after noon about the subscription please" }),
      leadRow("2026-10-06T08:05:00Z", "Sam Roe", "sam@example-mail.test", "415-555-0144", { message: longText }),
      leadRow("2026-10-07T08:05:00Z", "No Text", "nt@example-mail.test", "415-555-0155", { kind: "Gift box" }),
      "2026-10-08T08:05:00Z,Broken,b@example-mail.test,415-555-0166,contact,/c/,new,,{not json",
    ].join("\r\n") + "\r\n";
    const t1 = target(); w(path.join(tmp, "leads.csv"), csv);
    const r1 = node([t1, "--leads", path.join(tmp, "leads.csv")]);
    const out1 = fs.existsSync(rd(t1, "prompt-candidates.json")) ? fs.readFileSync(rd(t1, "prompt-candidates.json"), "utf8") : "";
    const c1 = J(rd(t1, "prompt-candidates.json")) || { candidates: [], inputs: { leads: {} } };
    check("C: a lead CSV with names, emails and phones is read (exit 0, candidates written)", r1.status === 0 && c1.candidates.length >= 3, `${r1.status} ${r1.stdout} ${r1.stderr}`);
    const secret = [EMAIL, PHONE, PERSON, "Priya", "Ramanathan", "marcus@", "Marcus", "Webb", "dana", "Dana Cho", "ops.desk", "lee@", "Lee Park", "415-555", "415 555", "4155550"];
    const leaked = secret.filter((s) => out1.toLowerCase().includes(s.toLowerCase()));
    check("C: NO name, email or phone of any lead appears anywhere in the output", out1.length > 0 && !leaked.length, `leaked: ${leaked.join(" | ")}`);
    check("C: an answer that names the person, or holds an email or a phone, is dropped whole and counted", c1.inputs.leads?.personalDataDropped === 3 && !out1.includes("oolong") && !out1.includes("monthly tea subscription for two people\"") , JSON.stringify(c1.inputs.leads));
    check("C: the same words from two leads are ONE candidate with two lead sources (file:row, date, quote)", (() => { const g = c1.candidates.find((c) => /gift box for an office of twelve/.test(c.prompt)); return g && g.sources.length === 2 && g.sources.every((s) => s.kind === "lead" && /^leads\.csv:\d+$/.test(s.ref) && /^2026-10-0\d$/.test(s.seenAt) && s.quote.length > 0) && g.sources[0].ref === "leads.csv:2" && g.sources[1].ref === "leads.csv:3"; })(), JSON.stringify(c1.candidates.map((c) => [c.prompt.slice(0, 40), c.sources.map((s) => s.ref)])));
    check("C: a quote over 300 characters is cut to 300 (source quote and prompt)", (() => { const g = c1.candidates.find((c) => /small law firm/.test(c.prompt)); return g && g.sources[0].quote.length > 290 && g.sources[0].quote.length <= 300 && g.prompt.length <= 300; })(), JSON.stringify(c1.candidates.map((c) => c.sources[0].quote.length)));
    check("C: pick-list values, numbers, person keys, rows with no text or broken JSON add no candidate and are counted", !out1.includes("Gift box") && c1.inputs.leads.noText >= 1 && c1.inputs.leads.unreadable === 1 && c1.inputs.leads.rows === 8, JSON.stringify(c1.inputs.leads));
    check("C: the parts and the fix are left empty for the session (parts \"\", fix null)", c1.candidates.every((c) => c.scenario === "" && c.comparison === "" && c.constraint === "" && c.location === "" && c.fix === null && c.id === lib.promptId(c.prompt)));
    const r1b = node([t1, "--leads", path.join(tmp, "leads.csv")]);
    const strip = (s) => s.replace(/"generatedAt": "[^"]*"/, "");
    check("C: a second run writes the same candidates (deterministic apart from the time)", r1b.status === 0 && out1 !== "" && strip(out1) === strip(rf(rd(t1, "prompt-candidates.json"))));
    // lead text stays in private/
    const priv1 = path.join(t1, ".pewp", "private"), gi = () => { try { return fs.readFileSync(path.join(priv1, ".gitignore"), "utf8").trim(); } catch { return null; } };
    check("C: the candidates file is under <pewp>/private/ and not under research/", fs.existsSync(path.join(priv1, "prompt-candidates.json")) && !fs.existsSync(path.join(t1, ".pewp", "research", "prompt-candidates.json")) && r1.stdout.includes(path.join(".pewp", "private", "prompt-candidates.json")), r1.stdout);
    const giFirst = gi();
    fs.mkdirSync(priv1, { recursive: true });
    fs.writeFileSync(path.join(priv1, ".gitignore"), "# nothing\n"); node([t1, "--leads", path.join(tmp, "leads.csv")]); const giFixed = gi();
    fs.rmSync(path.join(priv1, ".gitignore")); node([t1, "--leads", path.join(tmp, "leads.csv")]); const giBack = gi();
    check("C: private/.gitignore holds * on every run (rewritten when wrong, recreated when gone)", giFirst === "*" && giFixed === "*" && giBack === "*", JSON.stringify([giFirst, giFixed, giBack]));
    const walkOut = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== "private") walkOut(p, out); } else out.push(p); } return out; };
    const LEAD_TEXT = ["gift box for an office of twelve", "small law firm", "tea subscription for two people"];
    const outside = walkOut(t1).filter((f) => LEAD_TEXT.some((s) => fs.readFileSync(f, "utf8").includes(s)));
    const inside = rf(path.join(priv1, "prompt-candidates.json"));
    check("C: the fixture leads' message text appears in no file outside private/ (and does appear inside it)", outside.length === 0 && LEAD_TEXT.every((s) => inside.includes(s)) && walkOut(t1).length >= 1, `outside: ${outside.join(", ")}`);
    // reviews, forums, existing
    const t2 = target();
    w(path.join(tmp, "reviews.json"), [
      { text: "Bought a sampler as a gift for my mother-in-law who only drinks black tea, she loved the Assam", url: "https://reviews.example.test/kettle/1", date: "2026-09-15", platform: "SampleReviews" },
      { text: "Great shop, email me at fan@example-mail.test for photos of the tins", url: "https://reviews.example.test/kettle/2", date: "2026-09-16", platform: "SampleReviews" },
      { text: "no url on this one at all so it is not usable", date: "2026-09-17" },
      { text: "short one", url: "https://reviews.example.test/kettle/4", date: "2026-09-18" },
    ]);
    w(rd(t2, "forums.json"), { step: "forums", status: "ok", generatedAt: "2026-10-10T10:00:00.000Z", questions: [{ question: "Is gyokuro worth the price compared to sencha for a beginner?", url: "https://forum.example.test/r/tea/1", created: "2026-08-01" }, { question: "How is the tea in {city}?", url: "https://forum.example.test/r/tea/2" }] });
    w(rd(t2, "existing.json"), { step: "existing", status: "ok", generatedAt: "2026-10-11T10:00:00.000Z", questions: [{ question: "What tea goes well with a heavy dinner?", imported: { file: "C:/old/icm/knowledge/seo/question-bank.md", line: 14, updated: "2026-09-30" } }] });
    const r2 = node([t2, "--reviews", path.join(tmp, "reviews.json")]);
    const c2 = J(rd(t2, "prompt-candidates.json")) || { candidates: [], inputs: {} };
    const kinds = Object.fromEntries(c2.candidates.map((c) => [c.sources[0].kind, c.sources[0]]));
    check("C: reviews, forum questions and existing questions each become a candidate with their own source kind, ref and date", r2.status === 0 && c2.candidates.length === 3 && kinds.review?.ref === "https://reviews.example.test/kettle/1" && kinds.review.seenAt === "2026-09-15" && kinds.forum?.ref === "https://forum.example.test/r/tea/1" && kinds.forum.seenAt === "2026-10-10" && kinds.existing?.ref === "question-bank.md:14" && kinds.existing.seenAt === "2026-09-30", `${r2.stdout} ${r2.stderr} ${JSON.stringify(c2.candidates.map((c) => c.sources))}`);
    check("C: a review with an email, no url or too few words, and a { } template question are skipped and counted", c2.inputs.reviews?.personalDataDropped === 1 && c2.inputs.reviews.bad === 1 && c2.inputs.reviews.noText === 1 && c2.inputs.reviews.used === 1 && c2.inputs.forums?.used === 1 && !JSON.stringify(c2).includes("fan@") && !JSON.stringify(c2).includes("{city}"), JSON.stringify(c2.inputs));
    const t3 = target(), r3 = node([t3]);
    check("C: with no buyer words at all the step is BLOCKED (exit 3), says what unblocks it, and the blocked file and the .gitignore are under private/ too", r3.status === 3 && /^BLOCKED: no buyer words/.test(r3.stdout) && J(rd(t3, "prompt-candidates.json"))?.status === "blocked" && !fs.existsSync(path.join(t3, ".pewp", "research", "prompt-candidates.json")) && rf(path.join(t3, ".pewp", "private", ".gitignore")).trim() === "*", `${r3.status} ${r3.stdout}`);
    const r4 = node([t3, "--leads", path.join(tmp, "nope.csv")]), r5 = node([t3, "--leads", path.join(tmp, "reviews.json")]);
    check("C: a named --leads file that is missing, or is not a lead-export CSV, is a usage error (exit 2)", r4.status === 2 && /file not found/.test(r4.stderr) && r5.status === 2 && /no "answers" column/.test(r5.stderr), `${r4.status} ${r4.stderr} | ${r5.status} ${r5.stderr}`);
    const r6 = node([t1, "--leads", path.join(tmp, "leads.csv"), "--max-candidates", "1"]), c6 = J(rd(t1, "prompt-candidates.json"));
    check("C: --max-candidates cuts the list and says how many were left out (never silent)", r6.status === 0 && c6.candidates.length === 1 && c6.truncated >= 2, `${r6.stdout} ${c6?.truncated}`);

    // ============ E: engines ============
    const t7 = target(), cap = path.join(t7, ".pewp", "captures", "ai");
    const rowA = good(), rowB = (() => { const prompt = "Is loose leaf tea better than tea bags as an office gift for twelve people?"; return { ...good(), id: lib.promptId(prompt), prompt, engines: undefined }; })();
    const rowC = (() => { const prompt = "Which oolong is best for a beginner under twenty dollars in Austin?"; return { ...good(), id: lib.promptId(prompt), prompt, engines: undefined, fix: { kind: "earn-mention", target: "new", note: "n" } }; })();
    delete rowB.engines; delete rowC.engines; delete rowA.engines;
    w(rd(t7, "prompt-map.json"), { step: "prompt-map", rows: [rowA, rowB, rowC] });
    w(path.join(cap, "chatgpt-1.json"), { engine: "chatgpt", question: rowA.prompt, prompt: rowA.prompt, capturedAt: "2026-10-20T10:00:00Z", answer: "Try Kettle & Leaf Tea Shop for an office gift.", sources: ["https://kettleandleaf.test/guides/office-gifts/", "https://other.example.test/x"] });
    w(path.join(cap, "perplexity-1.json"), { engine: "perplexity", promptId: rowB.id, question: "an unrelated wording", capturedAt: "2026-10-21", answer: "Loose leaf is better.", sources: ["https://other.example.test/y"] });
    w(path.join(cap, "chatgpt-near.json"), { engine: "chatgpt", question: "Which oolong is best for a beginner under twenty dollars?", prompt: "Which oolong is best for a beginner under twenty dollars?", capturedAt: "2026-10-22", answer: "Kettle & Leaf Tea Shop", sources: ["https://kettleandleaf.test/"] }); // one phrase differs from rowC: not the exact prompt
    w(path.join(cap, "copilot-1.json"), { engine: "copilot", question: rowA.prompt, prompt: rowA.prompt, capturedAt: "2026-10-23", answer: "Kettle & Leaf Tea Shop", sources: ["https://kettleandleaf.test/"] });
    w(rd(t7, "ai-citations.json"), { step: "ai-citations", status: "ok", rows: [{ question: rowA.prompt, engine: "gemini-grounded", prompt: rowA.prompt, ourDomainCited: false, ourNameMentionedShare: { value: 0.5 }, dates: ["2026-10-18", "2026-10-19"] }, { question: rowB.prompt, engine: "chatgpt", prompt: rowB.prompt, ourDomainCited: true, ourNameMentionedShare: { value: 1 }, dates: [] }, { question: "never asked in the map", engine: "chatgpt", prompt: "never asked in the map", ourDomainCited: true, ourNameMentionedShare: { value: 1 }, dates: ["2026-10-19"] }] });
    const before = J(rd(t7, "prompt-map.json")), r7 = node([t7, "--engines"]);
    const m7 = J(rd(t7, "prompt-map.json")), [a7, b7, c7] = m7.rows.map((r) => ({ ...r, engines: r.engines || { chatgpt: {}, perplexity: {}, gemini: {} } }));
    check("E: --engines writes the engines back into the map file (every row gets all three engines)", r7.status === 0 && m7.rows.every((r) => r.engines && Object.keys(r.engines).sort().join() === "chatgpt,gemini,perplexity"), `${r7.stdout} ${r7.stderr}`);
    check("E: an ai-citations row with no date is not an observation (the engine stays null)", b7.engines.chatgpt.named === null && b7.engines.chatgpt.at === null, JSON.stringify(b7.engines.chatgpt));
    check("E: --engines fills a row from an owner capture matched by the exact prompt text (named from the answer, cited from the sources, page of ours)", r7.status === 0 && a7.engines.chatgpt.named === true && a7.engines.chatgpt.cited === true && a7.engines.chatgpt.pageCited === "https://kettleandleaf.test/guides/office-gifts/" && a7.engines.chatgpt.at === "2026-10-20" && a7.engines.chatgpt.source === "captures/ai/chatgpt-1.json", `${r7.stdout} ${r7.stderr} ${JSON.stringify(a7?.engines)}`);
    check("E: a capture is matched by promptId when its wording differs", b7.engines.perplexity.named === false && b7.engines.perplexity.cited === false && b7.engines.perplexity.pageCited === null && b7.engines.perplexity.at === "2026-10-21", JSON.stringify(b7?.engines));
    check("E: a capture whose wording is not exactly the prompt matches nothing: the engine stays null, never guessed", c7.engines.chatgpt.named === null && c7.engines.chatgpt.cited === null && c7.engines.chatgpt.source === null, JSON.stringify(c7?.engines));
    check("E: gemini-grounded rows of ai-citations fill the gemini engine (latest date, source file named)", a7.engines.gemini.named === true && a7.engines.gemini.cited === false && a7.engines.gemini.pageCited === null && a7.engines.gemini.at === "2026-10-19" && a7.engines.gemini.source === "research/ai-citations.json", JSON.stringify(a7?.engines.gemini));
    check("E: an engine the map does not track (copilot) is ignored, and an engine with no capture is all null", Object.keys(a7.engines).sort().join() === "chatgpt,gemini,perplexity" && a7.engines.perplexity.named === null && a7.engines.perplexity.at === null && b7.engines.gemini.cited === null);
    check("E: only the engines key changes: every other key of every row is byte-identical", m7.rows.every((r, i) => { const { engines, ...rest } = r; const { engines: _e, ...old } = before.rows[i]; return JSON.stringify(rest) === JSON.stringify(old); }) && m7.step === "prompt-map");
    check("E: the count line names the observations that matched no row (the never-asked row and the near capture: 2 of 5)", /from 5 observation\(s\); 2 matched no row/.test(r7.stdout), r7.stdout);
    check("E: a filled map passes --check on its engines (observed values carry a date and a source)", !lib.validateMap(m7).errors.some((e) => e.rule === "PM-ENG"), JSON.stringify(lib.validateMap(m7).errors.filter((e) => e.rule === "PM-ENG")));
    fs.rmSync(path.join(cap, "chatgpt-1.json"));
    const r7b = node([t7, "--engines"]), a7b = J(rd(t7, "prompt-map.json")).rows[0];
    check("E: a re-run with the capture gone keeps the value the row already held (nothing is blanked)", r7b.status === 0 && a7b.engines.chatgpt.named === true && a7b.engines.chatgpt.source === "captures/ai/chatgpt-1.json", JSON.stringify(a7b.engines.chatgpt));
    const t8 = target(), r8 = node([t8, "--engines"]);
    check("E: --engines with no map is BLOCKED (exit 3)", r8.status === 3 && /^BLOCKED: no /.test(r8.stdout), `${r8.status} ${r8.stdout}`);

    // ============ K: --check CLI ============
    const t9 = target(); w(rd(t9, "prompt-map.json"), { rows: [good()] });
    const k1 = node([t9, "--check"]);
    check("K: --check on a valid map: exit 0 and a PASS line", k1.status === 0 && /^PASS prompt-map 1 row\(s\) valid/.test(k1.stdout), `${k1.status} ${k1.stdout} ${k1.stderr}`);
    const badRow = good(); badRow.scenario = ""; badRow.sources = []; badRow.fix.kind = ["new-page", "improve-page"];
    w(rd(t9, "prompt-map.json"), { rows: [badRow] });
    const k2 = node([t9, "--check"]);
    check("K: --check on a bad map: exit 1, one FAIL line per problem naming the rule and the row id", k2.status === 1 && /^FAIL PM-PARTS pm-[0-9a-f]{8} scenario is empty/m.test(k2.stdout) && /^FAIL PM-SRC .* no source/m.test(k2.stdout) && /^FAIL PM-FIX .* exactly one of/m.test(k2.stdout) && /^FAIL prompt-map 3 problem\(s\) in 1 row\(s\)/m.test(k2.stdout), `${k2.status} ${k2.stdout}`);
    const k3 = node([target(), "--check"]);
    check("K: --check with no map is BLOCKED (exit 3)", k3.status === 3 && /^BLOCKED: no /.test(k3.stdout), `${k3.status} ${k3.stdout}`);
    const t10 = target(); w(rd(t10, "prompt-map.json"), "{ not json");
    const k4 = node([t10, "--check"]);
    check("K: --check on a file that is not JSON: exit 1 and says so", k4.status === 1 && /not valid JSON/.test(k4.stdout), `${k4.status} ${k4.stdout}`);
    const t11 = target(); w(rd(t11, "prompt-map.json"), { rows: [good()] }); w(rd(t11, "prompt-unsourced.json"), { rows: [{ prompt: good().prompt, why: "heard once" }, { prompt: "a prompt with no reason given at all" }] });
    const k5 = node([t11, "--check"]);
    check("K: --check also refuses an unsourced entry that is in the map, and one with no reason", k5.status === 1 && /PM-UNS .* this prompt is in prompt-map.json too/.test(k5.stdout) && /PM-UNS .* says why/.test(k5.stdout), `${k5.status} ${k5.stdout}`);
    const t12 = target(); w(rd(t12, "prompt-map.json"), { rows: [good()] }); w(rd(t12, "prompt-unsourced.json"), { rows: [{ prompt: "what is a good tea for a cold night", why: "heard on a call, no record" }] });
    check("K: a map plus an unsourced file with a reason passes --check", node([t12, "--check"]).status === 0);
    const t13 = target(); const piiRow = good(); piiRow.sources[0].kind = "review"; piiRow.sources[0].quote = "email sam@example.test about the gift boxes"; w(rd(t13, "prompt-map.json"), { rows: [piiRow] });
    const k6 = node([t13, "--check"]);
    const t14 = target(); const leadQ = good(); leadQ.sources[0].quote = "first-time buyer in Austin rent or buy"; w(rd(t14, "prompt-map.json"), { rows: [leadQ] });
    const k7 = node([t14, "--check"]);
    check("K: --check refuses a lead source with a quote (exit 1, PM-SRC naming the lead source)", k7.status === 1 && /^FAIL PM-SRC pm-[0-9a-f]{8} sources\[0\] is a lead source and carries a quote/m.test(k7.stdout), `${k7.status} ${k7.stdout}`);
    // lead wording: 8 or more consecutive words of a lead quote in private/prompt-candidates.json
    const LQ = "We are a small law firm office and need a gift box for twelve partners every december";
    const mkLead = (t, status = "ok") => w(path.join(t, ".pewp", "private", "prompt-candidates.json"), { status, candidates: [{ sources: [{ kind: "lead", ref: "leads.csv:7", seenAt: "2026-10-06", quote: LQ }, { kind: "review", ref: "https://r.example.test/1", seenAt: "2026-10-06", quote: "Our dentist waiting room tea service was lovely and the staff loved every single cup" }] }] });
    const withText = (field, text) => { const r = good(); r[field] = text; if (field === "prompt") r.id = lib.promptId(text); return r; };
    const chk = (row, { lead = true, status = "ok" } = {}) => { const t = target(); w(rd(t, "prompt-map.json"), { rows: [row] }); if (lead) mkLead(t, status); return node([t, "--check"]); };
    const L1 = chk(withText("prompt", "What do you suggest: Need a gift box, for twelve partners... EVERY year? Which tea is best?"));
    check("K: a row that copies 8 or more consecutive words of a lead quote is refused (case and punctuation ignored), naming the row and the source, never the words", L1.status === 1 && /^FAIL PM-LEAD pm-[0-9a-f]{8} prompt repeats 8 or more consecutive words of a lead quote \(leads\.csv:7\)/m.test(L1.stdout) && !/small law firm|twelve partners|gift box/i.test(L1.stdout), `${L1.status} ${L1.stdout}`);
    const L2 = ["scenario", "comparison", "constraint"].map((f) => [f, chk(withText(f, "an office that will need a gift box for twelve partners every month"))]);
    check("K: the same refusal for scenario, comparison and constraint", L2.every(([f, r]) => r.status === 1 && new RegExp(`^FAIL PM-LEAD pm-[0-9a-f]{8} ${f} repeats`, "m").test(r.stdout)), JSON.stringify(L2.map(([f, r]) => [f, r.status, r.stdout.slice(0, 120)])));
    const L3 = chk(withText("prompt", "an office that will need a gift box for twelve partners")), L4 = chk(withText("prompt", "our dentist waiting room tea service was lovely and cheap too"));
    check("K: 7 consecutive words of a lead quote are allowed, and a review quote (public) is never a lead quote", L3.status === 0 && !/PM-LEAD/.test(L3.stdout) && L4.status === 0 && !/PM-LEAD/.test(L4.stdout), `${L3.status} ${L3.stdout} | ${L4.status} ${L4.stdout}`);
    const N1 = chk(good(), { lead: false }), N2 = chk(good()), N3 = chk(good(), { status: "blocked" });
    const lines = (s, re) => s.split("\n").filter((l) => re.test(l)).length;
    check("K: --check says when lead wording was not checked (once), and what it checked against", N1.status === 0 && lines(N1.stdout, /^lead wording not checked: no private candidates$/) === 1 && N2.status === 0 && /^lead wording checked against 1 lead quote\(s\)/m.test(N2.stdout) && !/not checked/.test(N2.stdout) && N3.status === 0 && lines(N3.stdout, /^lead wording not checked: no private candidates$/) === 1, `${N1.stdout} | ${N2.stdout} | ${N3.stdout}`);
    w(rd(t1, "prompt-map.json"), { rows: [withText("prompt", "Looking for a gift box for an office of twelve people, is loose leaf better than bags for a gift?")] });
    const L5 = node([t1, "--check"]);
    check("K: --check against the private candidates the script wrote refuses a copied lead sentence (both lead rows named)", L5.status === 1 && /^FAIL PM-LEAD pm-[0-9a-f]{8} prompt .*\(leads\.csv:2, leads\.csv:3\)/m.test(L5.stdout) && !/loose leaf/.test(L5.stdout), `${L5.status} ${L5.stdout}`);
    check("K: --check refuses a map row whose quote holds an email address", k6.status === 1 && /^FAIL PM-PII /m.test(k6.stdout), `${k6.status} ${k6.stdout}`);

    // ============ N: network guard ============
    check("N: nothing in this suite made a request to a non-local host", !fs.existsSync(netLog) || fs.readFileSync(netLog, "utf8").trim() === "", fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8") : "");
  } catch (e) {
    check("suite crashed", false, e.stack || e);
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  return R;
}

// ---------- child mode: one mutant's suite in its own process ----------
if (args.includes("--suite-json")) {
  const rs = await suite(path.resolve(opt("--suite-json")));
  process.stdout.write("\n" + JSON.stringify(rs.map((r) => ({ name: r.name, ok: r.ok }))));
  process.exit(0);
}

const t0 = Date.now();
const main = await suite(SCRIPTS);
const failed = main.filter((r) => !r.ok);
for (const r of main) if (VERBOSE || !r.ok) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}${r.ok ? "" : "\n     " + r.detail.replace(/\n/g, "\n     ")}`);
const grp = (r) => (r.name.match(/^([A-Z]):/) || [, "?"])[1];
const names = { L: "lib helpers", V: "validator", C: "candidates", E: "engines", K: "--check", N: "network guard" };
console.log(Object.keys(names).map((g) => { const rs = main.filter((r) => grp(r) === g); return `${g} ${names[g]}: ${rs.filter((r) => r.ok).length}/${rs.length}`; }).join("\n"));
console.log(`${failed.length ? "FAIL" : "PASS"} test-prompt-map ${main.length - failed.length}/${main.length} checks (${Math.round((Date.now() - t0) / 1000)} s)`);
let mutantsBad = 0;

// ---------- M: watched-fail mutants: break ONE rule, require the NAMED check to go red ----------
if (!args.includes("--no-mutants") && !opt("--scripts")) {
  // [file, from, to, regex the red check's name must match, what the mutant breaks]
  const MUTANTS = [
    ["lib-prompt-map.mjs", 'for (const k of ["scenario", "comparison", "constraint"]) if (!nonEmpty(row[k]))', 'for (const k of ["comparison", "constraint"]) if (!nonEmpty(row[k]))', /^V: refuses a row whose scenario is empty/, "an empty scenario is accepted"],
    ["lib-prompt-map.mjs", 'for (const k of ["scenario", "comparison", "constraint"]) if (!nonEmpty(row[k]))', 'for (const k of ["scenario", "constraint"]) if (!nonEmpty(row[k]))', /^V: refuses a row whose comparison is empty/, "an empty comparison is accepted"],
    ["lib-prompt-map.mjs", 'for (const k of ["scenario", "comparison", "constraint"]) if (!nonEmpty(row[k]))', 'for (const k of ["scenario", "comparison"]) if (!nonEmpty(row[k]))', /^V: refuses a row whose constraint is empty/, "an empty constraint is accepted"],
    ["lib-prompt-map.mjs", 'if (typeof row.location !== "string")', "if (false)", /^V: refuses a row whose location is not a string/, "a row with no location is accepted"],
    ["lib-prompt-map.mjs", "if (!Array.isArray(src) || !src.length) e.push(", "if (false) e.push(", /^V: refuses a row with no source/, "a row with no source is accepted"],
    ["lib-prompt-map.mjs", "if (!SOURCE_KINDS.includes(s.kind)) e.push(", "if (false) e.push(", /^V: refuses a source of an unknown kind/, "a source of any kind is accepted"],
    ["lib-prompt-map.mjs", "if (!nonEmpty(s.ref)) e.push(", "if (false) e.push(", /^V: refuses a source with no ref/, "a source with no ref is accepted"],
    ["lib-prompt-map.mjs", "if (!(isIsoDate(s.seenAt) && s.seenAt <= today)) e.push(", "if (false) e.push(", /^V: refuses a source with a bad or future date/, "a source with no date is accepted"],
    ["lib-prompt-map.mjs", "if (s.quote.length > QUOTE_MAX) e.push(", "if (false) e.push(", /^V: refuses a source quote of 301 characters/, "a quote over 300 characters is accepted"],
    ["lib-prompt-map.mjs", "if (hasPersonalData(s.quote)) e.push(", "if (false) e.push(", /^V: refuses an email address or a phone number/, "a quote with an email or phone is accepted"],
    ["lib-prompt-map.mjs", "if (row.id !== promptId(row.prompt)) e.push(", "if (false) e.push(", /^V: refuses an id that is not the hash/, "any id is accepted"],
    ["lib-prompt-map.mjs", 'if (!isObj(fix)) return [err("PM-FIX", "fix must be ONE object', 'if (!isObj(fix) && !Array.isArray(fix)) return [err("PM-FIX", "fix must be ONE object', /^V: refuses a fix that is a list of two fixes/, "a list of two fixes is accepted"],
    ["lib-prompt-map.mjs", 'if (typeof fix.kind !== "string" || !FIX_KINDS.includes(fix.kind)) {', 'if (!FIX_KINDS.includes(Array.isArray(fix.kind) ? fix.kind[0] : fix.kind)) {', /^V: refuses a fix with two kinds in one field/, "a fix with two kinds is accepted"],
    ["lib-prompt-map.mjs", 'else if (fix.kind === "new-page" && fix.target !== "new")', "else if (false)", /^V: a new-page fix has target new/, "a new-page fix may target an existing path"],
    ["lib-prompt-map.mjs", "if (fix.kind === \"new-page\" && !NEW_PAGE_TYPES.includes(fix.pageType)) e.push(", "if (false) e.push(", /^V: a new-page fix has target new and pageType/, "a new page of any type is accepted"],
    ["lib-prompt-map.mjs", 'else if (fix.kind === "improve-page" && !/^\\//.test(fix.target))', "else if (false)", /^V: an improve-page fix names a page path/, "an improve-page fix may name no page"],
    ["lib-prompt-map.mjs", 'if (!nonEmpty(fix.note)) e.push(', "if (false) e.push(", /^V: refuses a fix with an empty note/, "a fix with no note is accepted"],
    ["lib-prompt-map.mjs", "if (!ENGINES.includes(name)) { e.push(", "if (false) { e.push(", /^V: engines: an unknown engine/, "an unknown engine is accepted"],
    ["lib-prompt-map.mjs", "&& (v.at == null || v.source == null)) e.push(", "&& false) e.push(", /^V: engines: an unknown engine, a bare boolean/, "an observed value with no date or source is accepted"],
    ["lib-prompt-map.mjs", "if (v.pageCited != null && v.cited !== true) e.push(", "if (false) e.push(", /^V: engines: an unknown engine, a bare boolean/, "a cited page without a citation is accepted"],
    ["lib-prompt-map.mjs", "if (r.id && ids.has(r.id)) errors.push", "if (false) errors.push", /^V: refuses the same id or the same prompt twice/, "a duplicate id is accepted"],
    ["lib-prompt-map.mjs", "else if (inMap.has(id)) errors.push(", "else if (false) errors.push(", /^V: unsourced entries/, "an unsourced entry may also sit in the map"],
    ["lib-prompt-map.mjs", "export const cutQuote = (s) => squash(s).slice(0, QUOTE_MAX).trim();", "export const cutQuote = (s) => squash(s);", /^L: cutQuote|^C: a quote over 300/, "a quote is never cut"],
    ["lib-prompt-map.mjs", "if (!PERSON_KEY.test(k)) freeTexts(v, depth + 1, out);", "freeTexts(v, depth + 1, out);", /^L: freeTexts keeps free sentences/, "answer keys about a person are read as free text"],
    ["lib-prompt-map.mjs", "return p.names.some((re) => re.test(t)) || ", "return ", /^C: NO name, email or phone/, "an answer naming the lead is kept"],
    ["lib-prompt-map.mjs", "export const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}/i;", "export const EMAIL_RE = /^$/;", /^C: NO name, email or phone/, "an email inside an answer is kept"],
    ["lib-prompt-map.mjs", "|\\b\\d{10,}\\b|", "|", /^L: an email address and a US phone number/, "a bare 10-digit number is not personal data"],
    ["research-prompts.mjs", "if (hasPersonalData(t) || namesPerson(t, who)) {", "if (false) {", /^C: NO name, email or phone/, "lead answers are not screened for personal data"],
    ["research-prompts.mjs", "ref: `${base}:${n}`,", "ref: `${base}:${n}:${get(\"email\")}`,", /^C: NO name, email or phone/, "the lead's email is written into the source ref"],
    ["research-prompts.mjs", "quote: cutQuote(t) } });\n    }\n  });", "quote: t } });\n    }\n  });", /^C: a quote over 300 characters is cut/, "a lead quote is written uncut"],
    ["lib-prompt-map.mjs", 'if (s.kind === "lead") { if (s.quote !== undefined) e.push(', 'if (s.kind === "lead") { if (false) e.push(', /^V: refuses a lead source that carries a quote|^K: --check refuses a lead source/, "a lead source may carry its quote into the map"],
    ["lib-prompt-map.mjs", 'if (s.kind === "lead") { if (s.quote !== undefined) e.push(', 'if (false) { if (s.quote !== undefined) e.push(', /^V: refuses a lead source that carries a quote/, "a lead source is held to the public-source quote rule (a lead with no quote is refused)"],
    ["research-prompts.mjs", 'const dir = path.join(ctx.pewp, "private");', 'const dir = path.join(ctx.pewp, "research");', /^C: the candidates file is under <pewp>\/private\//, "the candidates (lead text) are written under research/, which a repo target commits"],
    ["research-prompts.mjs", 'fs.writeFileSync(path.join(dir, ".gitignore"), "*\\n");', "", /^C: private\/\.gitignore holds \*/, "private/ gets no .gitignore"],
    ["research-prompts.mjs", 'fs.writeFileSync(path.join(dir, ".gitignore"), "*\\n");', 'if (!fs.existsSync(path.join(dir, ".gitignore"))) fs.writeFileSync(path.join(dir, ".gitignore"), "# private\\n");', /^C: private\/\.gitignore holds \*/, "private/.gitignore does not ignore everything"],
    ["research-prompts.mjs", 'writeBlocked(priv, "prompt-candidates", UNBLOCK_NONE);', 'writeBlocked(ctx, "prompt-candidates", UNBLOCK_NONE);', /^C: with no buyer words at all/, "the blocked file goes to research/"],
    ["research-prompts.mjs", 'return writeStep(priv, "prompt-candidates", {', 'writeStep(ctx, "prompt-lead-copy", { candidates: cands }); return writeStep(priv, "prompt-candidates", {', /^C: the fixture leads' message text appears in no file outside private/, "a copy of the lead text is written outside private/"],
    ["research-prompts.mjs", "if (hasPersonalData(text)) { tally.personalDataDropped++; continue; }", "", /^C: a review with an email/, "a review with an email is kept"],
    ["research-prompts.mjs", "if (!text || !/^https?:\\/\\//i.test(url) || !isIsoDate(date)) { tally.bad++; continue; }", "if (!text) { tally.bad++; continue; }", /^C: a review with an email|^C: reviews, forum/, "a review without a url or date is kept"],
    ["research-prompts.mjs", "const g = groups.find((x) => sameQuery(x.first, it.text));", "const g = null;", /^C: the same words from two leads are ONE candidate/, "near-identical words are not grouped"],
    ["research-prompts.mjs", "const truncated = Math.max(0, cands.length - maxCandidates);", "const truncated = 0;", /^C: --max-candidates/, "the cut of the candidate list is silent"],
    ["research-prompts.mjs", "if (!items.length) { writeBlocked(", "if (false) { writeBlocked(", /^C: with no buyer words at all/, "no input writes an empty candidate file"],
    ["research-prompts.mjs", 'if (ix("answers") < 0) throw new Usage(', "if (false) throw new Usage(", /^C: a named --leads file/, "a CSV with no answers column is read"],
    ["lib-prompt-map.mjs", "o.promptId === row.id || ", "false || ", /^E: a capture is matched by promptId/, "prompt ids are not used to match"],
    ["lib-prompt-map.mjs", "o.keys.some((k) => nonEmpty(k) && squash(k) === squash(row.prompt))", "o.keys.some((k) => nonEmpty(k) && (squash(k).toLowerCase().includes(squash(row.prompt).slice(0, 25).toLowerCase())))", /^E: a capture whose wording is not exactly the prompt|^E: --engines fills a row/, "a near prompt matches"],
    ["lib-prompt-map.mjs", "const page = items ? items.find((s) => /^https?:\\/\\//i.test(s) && hitsDomain(domainOfUrl(s), own)) || null : null;", "const page = null;", /^E: --engines fills a row/, "the cited page is never read"],
    ["lib-prompt-map.mjs", 'const s = String(e || "").toLowerCase(); return s === "gemini-grounded" || s === "gemini" ? "gemini"', 'const s = String(e || "").toLowerCase(); return s === "gemini" ? "gemini"', /^E: gemini-grounded rows/, "gemini-grounded rows are ignored"],
    ["lib-prompt-map.mjs", "if (!list.length) { next[e] = isObj(prev[e]) ? prev[e] : nullEngine(); continue; }", "if (!list.length) { next[e] = nullEngine(); continue; }", /^E: a re-run with the capture gone/, "a re-run blanks what was observed"],
    ["lib-prompt-map.mjs", "if (!engine || !at) continue;\n    const share", "if (!engine) continue;\n    const share", /^E: a filled map passes --check|^E: an ai-citations row with no date/, "an observation with no date is written"],
    ["research-prompts.mjs", "W(mapFile, doc);\n  return `OK engines:", "return `OK engines:", /^E: --engines writes the engines back/, "the engines are never written back"],
    ["research-prompts.mjs", "if (lines.length) { process.exitCode = 1;", "if (lines.length) { process.exitCode = 0;", /^K: --check on a bad map/, "a refused map exits 0"],
    ["lib-prompt-map.mjs", "export const LEAD_RUN = 8;", "export const LEAD_RUN = 9;", /^K: a row that copies 8 or more/, "9 words of a lead quote are needed to refuse (the boundary moves up)"],
    ["lib-prompt-map.mjs", "export const LEAD_RUN = 8;", "export const LEAD_RUN = 7;", /^K: 7 consecutive words of a lead quote are allowed/, "7 words of a lead quote are refused (the boundary moves down)"],
    ["lib-prompt-map.mjs", 'export const LEAD_FIELDS = ["prompt", "scenario", "comparison", "constraint"];', 'export const LEAD_FIELDS = ["scenario", "comparison", "constraint"];', /^K: a row that copies 8 or more/, "the prompt is not checked for lead wording"],
    ["lib-prompt-map.mjs", 'export const LEAD_FIELDS = ["prompt", "scenario", "comparison", "constraint"];', 'export const LEAD_FIELDS = ["prompt", "scenario", "comparison"];', /^K: the same refusal for scenario, comparison and constraint/, "the constraint is not checked for lead wording"],
    ["lib-prompt-map.mjs", 'String(s ?? "").toLowerCase().replace(', 'String(s ?? "").replace(', /^K: a row that copies 8 or more/, "lead wording is matched case-sensitively"],
    ["lib-prompt-map.mjs", 'if (s?.kind === "lead" && typeof s.quote === "string")', 'if (typeof s?.quote === "string")', /^K: 7 consecutive words of a lead quote are allowed/, "a review quote counts as a lead quote"],
    ["lib-prompt-map.mjs", 'ref: String(s.ref ?? "?"), grams:', 'ref: String(s.ref ?? "?") + " " + s.quote, grams:', /^K: a row that copies 8 or more/, "the refusal prints the lead's words"],
    ["research-prompts.mjs", "if (leadQuotes) for (const e of checkLeadWording(rows, leadQuotes)) lines.push(", "if (leadQuotes) for (const e of []) lines.push(", /^K: a row that copies 8 or more/, "the lead wording check never refuses"],
    ["research-prompts.mjs", ': "lead wording not checked: no private candidates";', ': "";', /^K: --check says when lead wording was not checked/, "a check that did not run is silent"],
    ["research-prompts.mjs", 'pc?.status === "ok" && Array.isArray(pc.candidates)', "Array.isArray(pc?.candidates)", /^K: --check says when lead wording was not checked/, "a blocked private file is read as candidates"],
    ["research-prompts.mjs", "for (const e of validateUnsourced(u, rows))", "for (const e of [])", /^K: --check also refuses an unsourced entry/, "the unsourced file is not checked"],
  ];
  const copyFiles = (to) => { // the import closure of research-prompts.mjs, computed (a hand list goes stale)
    const need = new Set(), q = ["research-prompts.mjs", "lib-prompt-map.mjs", "test-prompt-map.mjs"];
    while (q.length) {
      const f = q.shift(); if (need.has(f)) continue; need.add(f);
      const src = fs.readFileSync(path.join(SCRIPTS, f), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
      for (const m of src.matchAll(/(?:^|[\s;])(?:import|export)\s[^"'`;]*?\bfrom\s*["'](\.\/[^"']+)["']|(?:^|[\s;])import\s*["'](\.\/[^"']+)["']|\bimport\(\s*["'](\.\/[^"']+)["']\s*\)/gm)) q.push(path.basename(m[1] || m[2] || m[3]));
    }
    for (const f of need) fs.copyFileSync(path.join(SCRIPTS, f), path.join(to, f));
  };
  const results = new Array(MUTANTS.length), jobs = [];
  for (const [i, [file, from, to, expectRe, why]] of MUTANTS.entries()) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-pmm-"));
    copyFiles(root);
    const f = path.join(root, file), src = fs.readFileSync(f, "utf8"), n = src.split(from).length - 1;
    if (n !== 1) { results[i] = { i, file, why, status: "PATCH-NOT-APPLIED", detail: `target text found ${n}x` }; fs.rmSync(root, { recursive: true, force: true }); continue; }
    fs.writeFileSync(f, src.replace(from, () => to));
    jobs.push({ i, file, why, expectRe, root });
  }
  const runJob = (j) => new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(j.root, "test-prompt-map.mjs"), "--suite-json", j.root], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_OPTIONS: "", PEWP_RULES_DIR: path.join(SKILL, "rules"), PEWP_FIXTURES_DIR: path.join(SKILL, "fixtures") } });
    let out = ""; c.stdout.on("data", (d) => (out += d));
    const t = setTimeout(() => c.kill(), 10 * 60_000);
    c.on("close", () => {
      clearTimeout(t);
      let rs; try { rs = JSON.parse(out.slice(out.lastIndexOf("\n") + 1)); } catch { rs = [{ name: "mutant suite did not finish", ok: false }]; }
      const red = rs.filter((r) => !r.ok), right = red.filter((r) => j.expectRe.test(r.name));
      results[j.i] = { i: j.i, file: j.file, why: j.why, status: right.length ? "RED (right reason)" : red.length ? "RED (other reason only)" : "GREEN (survived)", red: red.length, detail: (right[0] || red[0] || {}).name };
      try { fs.rmSync(j.root, { recursive: true, force: true }); } catch {}
      resolve();
    });
  });
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(4, os.cpus().length) }, async () => { while (queue.length) await runJob(queue.shift()); }));
  for (const r of results) console.log(`M mutant ${String(r.i + 1).padStart(2)} ${r.file}: ${r.why} -> ${r.status}${r.red ? ` (${r.red} failing; e.g. ${r.detail})` : r.detail ? ` ${r.detail}` : ""}`);
  const ok = results.filter((r) => r.status === "RED (right reason)").length;
  console.log(`${ok === results.length ? "PASS" : "FAIL"} mutants ${ok}/${results.length} went red for the right reason`);
  mutantsBad = results.length - ok;
}
if (args.includes("--json")) console.log(JSON.stringify({ passed: main.length - failed.length, total: main.length, failed: failed.map((r) => r.name) }));
process.exit(failed.length || mutantsBad ? 1 : 0);
