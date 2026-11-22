// Usage: node test-analysis-copy.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of analysis-copy.mjs (AB-8, parts AU.S-4 and AU.D-47): the checked analysis of the judge printed as the client's report of 6 to 8 pages in the old
// copy's look, with its numbers sheet, every gate passed before anything is written. Run on INVENTED run folders (a profile with gathered stations and small
// invented files, an invented analysis), the REAL analysis-check.mjs makes the checked file and the sheet, the real analysis-copy.mjs runs as a child
// process with the real words and assets folders and the real product book. No network, no model, no browser.
// Pinned: the pages and their order, the sheet (the month row, one row per pointer on the page that prints it, plan rows, step titles), every STOP with its own
// words and nothing written, the gates, the escaping of every value, the number format, the plan from fixes.json, the last page and the WORKS rule against the
// old data layer's rule, the manifest step. Mutants: a fault patched into a copy of the scripts must turn the named case red.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { mkTmp, rmTmp, checker, main, W as writeFile, J as readJson } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const SKILL = path.resolve(here, "..");
const WORDS = path.join(SKILL, "client-copy"), ASSETS = path.join(SKILL, "assets", "client-copy"), BOOK = path.join(SKILL, "..", "..", "docs", "product", "1-product.md");
const GEN = "2031-03-01T00:00:00.000Z";
const BT = String.fromCharCode(96);
const S = (f, p) => "{{" + f + "#" + p + "}}";
const EVIL = "<img src=x onerror=alert(1)>", AMP = 'Tom & "Jerry" <b>bold</b>';
const DATA = {
  site: { name: "Birchwood Plumbing", pages: 12, words: 1234567, route: "Route 66 Diner", evil: EVIL, amp: AMP, term: "drain repair" },
  search: { share: 5 },
  local: { name: "Acme Heating", spots: 3, n: 9, reviews: 41 },
  rivals: { top: "Hilltop Pipes" },
};
const sec = (topic, extra = {}) => ({ topic, title: "What we read about " + topic, lede: "A plain sentence about " + topic + " in your market today.", points: ["A plain point about " + topic], ...extra });
const A1 = () => ({
  business: S("site.json", "name"),
  verdict: "Buyers who search for what you sell are shown other firms.",
  numbers: [{ value: S("site.json", "pages"), label: "pages Google can list for you" }, { value: S("site.json", "words"), label: "words sent in the first response" }, { value: S("local.json", "spots") + " of " + S("local.json", "n"), label: "map spots where you are shown" }],
  have: [{ value: S("site.json", "pages"), text: "pages already built for you" }, { value: S("local.json", "reviews"), text: "reviews from happy buyers" }],
  back: ["Searches for " + S("site.json", "term") + " show other firms", "Your phone page is slow"],
  sections: [sec("site", { table: { columns: ["Page", "Words"], rows: [[S("site.json", "route"), S("site.json", "words")]] } }), sec("local", { points: ["You are shown on " + S("local.json", "spots") + " spots"] }), sec("rivals", { points: ["The leader is " + S("rivals.json", "top")] })],
  plan: [{ fix: "site", why: "Buyers find " + S("site.json", "pages") + " pages today" }, { fix: "words", why: "Your words must reach the first response" }, { fix: "speed", why: "A slow page loses buyers" }],
});

const profileOf = (topics) => ({ step: "client-profile", generatedAt: GEN, stations: [...topics.map((t) => ({ id: t, what: t, verdict: "OPEN", steps: [{ id: "step-" + t, what: t, state: "RUN", bucket: "gathered", partial: false, why: null, ruling: null, outputs: [t + ".json"], files: [], fileCount: 0 }] })), { id: "ads", what: "ads", verdict: "OPEN", steps: [{ id: "step-ads", what: "ads", state: "SKIPPED", bucket: "not gathered", outputs: ["ads.json"], files: [], fileCount: 0 }] }], notGathered: [], counts: {} });

async function scenarios(dir) {
  const results = [], check = checker(results);
  const tmp = mkTmp("acopy");
  const copyScript = path.join(dir, "analysis-copy.mjs"), checkScript = path.join(dir, "analysis-check.mjs");
  let n = 0;
  // the real book has rows that read PARTLY today (the alert, the export): the runs below use an invented book of which every row reads WORKS; the rule itself is compared on the real book in case 8
  const bk0 = readJson(path.join(WORDS, "backing.json")), BOOK_OK = path.join(tmp, "book-ok.md");
  fs.writeFileSync(BOOK_OK, Object.values(bk0).flat().map((id) => "| " + id + " a row | WORKS |").join("\n"));
  const node = (script, args) => { const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 120000 }); return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" }; };
  // a run folder: the data files, the profile, the analysis; the real analysis-check writes the checked file and the sheet
  const mk = (name, topics, analysis, { site = true, internal = null } = {}) => {
    const key = site ? "https://" + name + ".example.test/" : "profile:" + name;
    const root = path.join(tmp, "site-checks", site ? name + ".example.test" : name), pewp = path.join(root, ".pewp");
    for (const t of Object.keys(DATA)) writeFile(path.join(pewp, t + ".json"), DATA[t]);
    writeFile(path.join(pewp, "profile.json"), profileOf(topics));
    writeFile(path.join(pewp, "analysis.json"), analysis);
    if (internal) writeFile(path.join(pewp, "internal", "not-gathered.json"), { rows: internal.map((why) => ({ why })) });
    const c = node(checkScript, [key, "--cwd", tmp]);
    if (c.code !== 0) throw new Error("fixture refused by the real check: " + c.stdout.slice(0, 300) + c.stderr.slice(0, 200));
    return { key, pewp };
  };
  const copy = (r, over = {}) => {
    const out = path.join(tmp, "out-" + ++n);
    const x = node(copyScript, [r.key, "--pewp", r.pewp, "--out", out, "--words", over.words || WORDS, "--assets", over.assets || ASSETS, "--book", over.book || BOOK_OK]);
    const files = fs.existsSync(out) ? fs.readdirSync(out).sort() : [];
    const html = files.find((f) => f.endsWith(".html")), tsv = files.find((f) => f.endsWith(".tsv"));
    return { ...x, out, files, html: html ? fs.readFileSync(path.join(out, html), "utf8") : "", tsv: tsv ? fs.readFileSync(path.join(out, tsv), "utf8") : "", lines: x.stdout.trim().split(/\r?\n/), err: x.stderr.trim() };
  };
  const secs = (html) => html.match(/<section\b[\s\S]*?<\/section>/g) || [];
  const rowsOf = (tsv) => tsv.split("\n").slice(1).filter(Boolean).map((l) => l.split("\t"));
  const G = await import(pathToFileURL(path.join(dir, "client-copy-gates.mjs")).href);
  const LOGO = pathToFileURL(path.join(ASSETS, "omnikom-logo-full.png")).href;
  const FIX = readJson(path.join(WORDS, "fixes.json")), HW = readJson(path.join(WORDS, "how-we-work.json"));
  const stopped = (r, re, label) => { const bad = []; if (r.code !== 1) bad.push(label + ": exit " + r.code + " " + r.stdout.slice(0, 120)); if (!re.test(r.err)) bad.push(label + ": stderr " + JSON.stringify(r.err.slice(0, 200)) + " vs " + re); if (r.err.split("\n").length !== 1) bad.push(label + ": more than one line"); if (r.files.length) bad.push(label + ": wrote " + r.files.join()); return bad; };
  const A1_PTR = {
    1: [["$.business", "site.json#name"], ["$.numbers[0].value", "site.json#pages"], ["$.numbers[1].value", "site.json#words"], ["$.numbers[2].value", "local.json#spots"], ["$.numbers[2].value", "local.json#n"]],
    2: [["$.business", "site.json#name"], ["$.have[0].value", "site.json#pages"], ["$.have[1].value", "local.json#reviews"], ["$.back[0]", "site.json#term"]],
    3: [["$.business", "site.json#name"], ["$.sections[0].table.rows[0][0]", "site.json#route"], ["$.sections[0].table.rows[0][1]", "site.json#words"]],
    4: [["$.business", "site.json#name"], ["$.sections[1].points[0]", "local.json#spots"]],
    5: [["$.business", "site.json#name"], ["$.sections[2].points[0]", "rivals.json#top"]],
    6: [["$.business", "site.json#name"], ["$.plan[0].why", "site.json#pages"]],
    7: [["$.business", "site.json#name"], ["$.numbers[0].value", "site.json#pages"], ["$.numbers[1].value", "site.json#words"], ["$.numbers[2].value", "local.json#spots"], ["$.numbers[2].value", "local.json#n"]],
  };
  try {
    // ---- 1: three sections, two have, two back, three numbers, three plan rows
    const r1 = mk("c1", ["site", "local", "rivals"], A1());
    const c1 = copy(r1), sheet1 = readJson(path.join(r1.pewp, "analysis.sheet.json")).rows;
    {
      const bad = [], s = secs(c1.html);
      if (c1.code !== 0) bad.push("exit " + c1.code + " " + c1.err.slice(0, 300));
      if (c1.files.join() !== "c1.example.test-audit-2031-03-01-draft.html,numbers-2031-03-01.tsv") bad.push("files " + c1.files.join());
      if (c1.lines.length !== 3 || !/^wrote .*-draft\.html$/.test(c1.lines[0]) || !/^wrote .*numbers-2031-03-01\.tsv$/.test(c1.lines[1]) || c1.lines[2] !== "sections: 7") bad.push("console " + JSON.stringify(c1.lines));
      if (s.length !== 7 || !s[0].startsWith('<section class="cover" id="p1">') || s.some((x, i) => i > 0 && !x.startsWith('<section class="pg" id="p' + (i + 1) + '">'))) bad.push("sections " + s.length);
      try { G.gates({ html: c1.html, tsv: c1.tsv, pages: 7, logoUrl: LOGO, internal: [] }); } catch (e) { bad.push("gates again: " + e.message); }
      const rows = rowsOf(c1.tsv);
      if (c1.tsv.split("\n")[0] !== ["page", "the text it stands in", "printed", "file", "where in the file", "value there", "measured", "kind"].join("\t")) bad.push("sheet header");
      const month = rows.find((r) => r[1] === "month of the audit");
      if (!month || month.join("|") !== ["1", "month of the audit", "March 2031", "profile.json", "generatedAt", GEN, GEN, "RUN"].join("|")) bad.push("month row " + JSON.stringify(month));
      const want = [];
      for (const [pg, list] of Object.entries(A1_PTR)) for (const [at, ptr] of list) { const sr = sheet1.find((x) => x.at === at && x.pointer === ptr); const printed = String(Number(sr.value)) === sr.value ? Number(sr.value).toLocaleString("en-US") : sr.value; want.push([pg, at, printed, sr.file, sr.where, sr.value, sr.measured, "RUN"].join("|")); }
      const got = rows.filter((r) => r[1].startsWith("$")).map((r) => r.join("|"));
      const uniq = [...new Set(want)].sort(), gotS = [...new Set(got)].sort();
      if (uniq.join("\n") !== gotS.join("\n")) bad.push("pointer rows differ: missing " + uniq.filter((x) => !gotS.includes(x)).slice(0, 3).join(" ; ") + " extra " + gotS.filter((x) => !uniq.includes(x)).slice(0, 3).join(" ; "));
      const plan = ["site", "words", "speed"].map((id) => FIX.find((f) => f.id === id)).map((f) => ["6", "plan row " + f.id, f.fix, "client-copy/fixes.json", "id=" + f.id, f.fix, "(not dated)", "STANDARD COPY"].join("|"));
      for (const p of plan) if (!rows.some((r) => r.join("|") === p)) bad.push("plan row missing " + p.slice(0, 60));
      HW.nextSteps.forEach((st, i) => { const w = ["7", "step " + (i + 1) + " title", st[1], "client-copy/how-we-work.json", "nextSteps[" + i + "]", st[1], "(not dated)", "STANDARD COPY"].join("|"); if (!rows.some((r) => r.join("|") === w)) bad.push("step row missing " + i); });
      if (!/What you already have going for you/.test(s[1] || "") || !/What works for you today, and what holds you back/.test(s[1] || "")) bad.push("summary words");
      check("case 1: three sections (one with a table), two have, two back, three numbers, three plan rows: exit 0, 7 sections, sections: 7, the two files, the gates pass again, the sheet has the month row, one row per pointer on the page that prints it, the plan rows and the step titles", bad.length === 0, bad.join(" | "));
    }

    // ---- 2: no site (two sections, have empty), and four sections
    {
      const bad = [];
      const a2 = { ...A1(), business: S("local.json", "name"), have: [], numbers: [A1().numbers[2]], back: ["Your phone page is slow"], sections: [sec("local"), sec("rivals")], plan: [A1().plan[1]] };
      const r2 = mk("acme", ["local", "rivals"], a2, { site: false });
      const c2 = copy(r2), s2 = secs(c2.html);
      if (c2.code !== 0 || c2.lines[c2.lines.length - 1] !== "sections: 6" || s2.length !== 6) bad.push("two sections: exit " + c2.code + " " + c2.err.slice(0, 200) + " " + s2.length);
      if (c2.files.join() !== "acme-audit-2031-03-01-draft.html,numbers-2031-03-01.tsv") bad.push("files " + c2.files.join());
      if (/already have/.test(c2.html) || /What works for you today/.test(c2.html) || !/What holds you back today/.test(s2[1] || "") || !/What holds you back/.test(s2[1] || "")) bad.push("summary of an empty have");
      const a4 = { ...A1(), sections: [sec("site"), sec("search"), sec("local"), sec("rivals")] };
      const r4 = mk("four", ["site", "search", "local", "rivals"], a4);
      const c4 = copy(r4);
      if (c4.code !== 0 || c4.lines[c4.lines.length - 1] !== "sections: 8" || secs(c4.html).length !== 8) bad.push("four sections: exit " + c4.code + " " + c4.err.slice(0, 200));
      const last = secs(c4.html);
      if (last.length === 8 && (!/id="p7"/.test(last[6]) || !/<table class="plan">/.test(last[6]) || !/<ol class="steps"/.test(last[7]))) bad.push("plan and last page are not p7 and p8");
      check("case 2: a business with no site (two sections, have empty): 6 sections and the summary has no already-have block; four sections: 8", bad.length === 0, bad.join(" | "));
    }

    // ---- 3: STOPs with nothing written
    {
      const bad = [];
      let r = mk("s1", ["site", "local", "rivals"], A1());
      const later = new Date(Date.now() + 120000); fs.utimesSync(path.join(r.pewp, "analysis.json"), later, later);
      bad.push(...stopped(copy(r), /^STOP: the analysis was not checked after it was written$/, "checked older"));
      r = mk("s2", ["site", "local", "rivals"], A1()); fs.rmSync(path.join(r.pewp, "analysis.sheet.json"));
      bad.push(...stopped(copy(r), /^STOP: analysis\.sheet\.json is missing$/, "sheet missing"));
      r = mk("s3", ["site", "local", "rivals"], A1());
      const sp = path.join(r.pewp, "analysis.sheet.json"), sh = readJson(sp); sh.rows = sh.rows.filter((x) => x.at !== "$.numbers[0].value"); writeFile(sp, sh);
      bad.push(...stopped(copy(r), /^STOP: the sheet has no row for .*site\.json#pages.* at \$\.numbers\[0\]\.value$/, "pointer without row"));
      r = mk("s4", ["site", "local", "rivals"], { ...A1(), sections: [A1().sections[0]] });
      bad.push(...stopped(copy(r), /^STOP: the analysis has the wrong shape \(\$\.sections: .*2 to 4 items/, "shape"));
      r = mk("s5", ["site", "local", "rivals"], A1()); fs.rmSync(path.join(r.pewp, "profile.json"));
      bad.push(...stopped(copy(r), /^STOP: profile\.json is missing$/, "profile missing"));
      const u = node(copyScript, ["https://x.example.test/", "--pewp", tmp]);
      if (u.code !== 2) bad.push("no --out is exit " + u.code);
      check("case 3: the checked file older than analysis.json, the sheet missing, a pointer with no sheet row, a shape refusal (one section), no profile: each one STOP line, exit 1, nothing written; a missing --out is exit 2", bad.length === 0, bad.join(" | "));
    }

    // ---- 4: the analysis's words trip a gate
    {
      const bad = [], D = String.fromCharCode(8211);
      const trip = (name, text, re, internal = null) => { const a = A1(); a.back[1] = text; const r = mk(name, ["site", "local", "rivals"], a, { internal }); bad.push(...stopped(copy(r), re, name)); };
      trip("g1", "Your leads are pending", /^STOP: gate internal words: page 2 prints "pending"$/);
      trip("g2", "Your page is slow " + D + " and thin", /^STOP: gate dashes: /);
      trip("g3", "Write to boss@example.com", /^STOP: gate contact line: page 2 prints "boss@example\.com"$/);
      trip("g4", "See the full list in report.json", /^STOP: gate internal words: page 2 prints "report\.json"$/);
      trip("g5", "The maps capture needed a person to sign in", /^STOP: gate internal: page 2 holds a line of the internal sheet$/, ["The maps capture needed a person to sign in"]);
      check("case 4: the analysis's words trip a gate, one row each (the word pending, a dash, an e-mail address, a file name, a line of the internal sheet): the gate's own STOP line, nothing written", bad.length === 0, bad.join(" | "));
    }

    // ---- 5: escaping
    {
      const bad = [], a = A1();
      a.business = S("site.json", "evil"); a.have[0].text = "Seen as " + S("site.json", "amp"); a.sections[0].table.rows[0][0] = S("site.json", "evil"); a.sections[0].table.rows[0][1] = S("site.json", "amp");
      const r = mk("e1", ["site", "local", "rivals"], a), c = copy(r);
      if (c.code !== 0) bad.push("exit " + c.code + " " + c.err.slice(0, 300));
      if (!c.html.includes("&lt;img src=x onerror=alert(1)&gt;")) bad.push("the img value is not printed escaped");
      if ((c.html.match(/<img\b/gi) || []).length !== 1) bad.push("img tags: " + (c.html.match(/<img\b/gi) || []).length);
      if (/<b>bold<\/b>/.test(c.html) || !c.html.includes('Tom &amp; "Jerry" &lt;b&gt;bold&lt;/b&gt;')) bad.push("the ampersand value is not escaped");
      check("case 5: a value that is an img tag with a handler, and one with & and double quotes and a b tag: printed escaped everywhere (cover, running head, title, lists, table), the gates pass, no second img in the html", bad.length === 0, bad.join(" | "));
    }

    // ---- 6: numbers
    {
      const bad = [], c = c1;
      if (!c.html.includes(">1,234,567<")) bad.push("no thousands mark");
      if (!rowsOf(c.tsv).some((r) => r[1] === "$.numbers[1].value" && r[2] === "1,234,567" && r[5] === "1234567")) bad.push("sheet row of the large number");
      if (!c.html.includes("Route 66 Diner")) bad.push("a text with digits in it is not printed");
      if (c.code !== 0) bad.push("exit " + c.code);
      check("case 6: a large number prints with its thousands mark (the sheet holds both forms) and passes the numbers gate; a text value with digits in it (a name) passes too", bad.length === 0, bad.join(" | "));
    }

    // ---- 7: the plan
    {
      const bad = [], s = secs(c1.html)[5] || "", t = (s.match(/<table class="plan">[\s\S]*?<\/table>/) || [""])[0];
      const rows = [...t.matchAll(/<tr\b[^>]*>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td>([\s\S]*?)<\/td>/g)].map((m) => m.slice(1, 5).map((x) => x.replace(/<[^>]+>/g, "").trim()));
      const ids = ["site", "words", "speed"], whys = ["Buyers find 12 pages today", "Your words must reach the first response", "A slow page loses buyers"];
      if (rows.length !== 3) bad.push("plan rows " + rows.length);
      rows.forEach((r, i) => { const f = FIX.find((x) => x.id === ids[i]); if (r[0] !== String(i + 1) || r[1] !== f.fix || r[2] !== whys[i] || r[3] !== f.who) bad.push("row " + (i + 1) + " " + JSON.stringify(r)); });
      if (!/Action plan/.test(s) || !/What to fix, in this order/.test(s) || !/What to do/.test(t) || !/>Why</.test(t) || !/>Who</.test(t)) bad.push("plan words");
      check("case 7: the plan: the fix and the who come from fixes.json (never from the analysis), the why from the analysis, the row numbers run 1 to 3", bad.length === 0, bad.join(" | "));
    }

    // ---- 8: the last page
    {
      const bad = [], s = secs(c1.html), last = s[6] || "";
      if ((c1.html.match(/<ol class="steps/g) || []).length !== 1 || !last.includes('<ol class="steps">')) bad.push("the pipeline list is not on the last page only");
      const draft = (last.match(/<ul class="draft">[\s\S]*?<\/ul>/) || [""])[0], lis = [...draft.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
      if (lis.length !== 3 || lis.join("|") !== HW.draftContainsPlain.join("|") || HW.draftContainsPlain[0] !== "A page for each thing you sell, built from a plan you approve before anything goes live.") bad.push("the three plain lines " + JSON.stringify(lis));
      if (!last.includes("Your leads are yours.") || !last.includes("The numbers we report against, as they are today") || !last.includes(HW.goAhead) || !last.includes(HW.promise.replace("{outcome}", "customers"))) bad.push("last page words");
      const firstLi = (last.match(/<ol class="steps">\s*<li>[\s\S]*?<\/li>\s*<li>/) || [""])[0];
      if (!firstLi.includes('<ul class="draft">')) bad.push("the three lines are not under the first step");
      // the WORKS rule against the old data layer's rule, on the real backing.json and the real product book, and on invented books
      const M = await import(pathToFileURL(copyScript).href + "?" + Math.random());
      const backing = readJson(path.join(WORDS, "backing.json")), realBook = fs.readFileSync(BOOK, "utf8");
      const dataSrc = fs.readFileSync(path.join(dir, "client-copy-data.mjs"), "utf8");
      const at0 = dataSrc.indexOf('state: get("book", ' + BT + 'match:'), q0 = at0 < 0 ? -1 : dataSrc.indexOf(BT, at0), q1 = q0 < 0 ? -1 : dataSrc.indexOf(BT, q0 + 1);
      const tplText = q1 > q0 && q0 > 0 ? dataSrc.slice(q0 + 1, q1) : null;
      const escRe = (x) => x.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
      const oldRule = (bk, text) => { const out = {}; for (const [k, ids] of Object.entries(bk)) out[k] = ids.every((id) => { const field = new Function("id", "escRe", "return " + BT + tplText + BT + ";")(id, escRe); const m = text.match(new RegExp(field.slice(6), "m")); return (m ? (m[1] !== undefined ? m[1] : m[0]) : undefined) === "WORKS"; }); return out; };
      const allIds = Object.values(backing).flat(), books = { real: realBook };
      books.allWorks = allIds.map((id) => "| " + id + " a row | WORKS |").join("\n");
      books.oneNot = allIds.map((id, i) => "| " + id + " a row | " + (i === 1 ? "PARTIAL" : "WORKS") + " |").join("\n");
      books.oneMissing = allIds.slice(1).map((id) => "| " + id + " a row | WORKS |").join("\n");
      books.prefix = allIds.map((id) => "| " + id + "0 a row | WORKS |").join("\n");
      if (!tplText) bad.push("the old data layer's rule was not found in client-copy-data.mjs");
      else for (const [nm, text] of Object.entries(books)) { const mine = M.draftRowsWork(backing, text), old = oldRule(backing, text); if (JSON.stringify(mine) !== JSON.stringify(old)) bad.push("rule differs on " + nm + ": " + JSON.stringify(mine) + " vs " + JSON.stringify(old)); }
      const verdict = M.draftRowsWork(backing, books.oneNot), failing = Object.keys(verdict).filter((k) => !verdict[k]);
      if (!failing.length) bad.push("the control book with one row not WORKS gives no failing key");
      // the STOP, through the command
      const bookFile = path.join(tmp, "book-one-not.md"); fs.writeFileSync(bookFile, books.oneNot);
      const lineKeys = ["pages", "firstVisit", "forms", "crm", "alert"];
      const cb = copy(mk("b1", ["site", "local", "rivals"], A1()), { book: bookFile });
      // a line the product book does not fully back is LEFT OUT (the report says less, never more), the other lines stay, and the run says so (head, 2026-11-22: the real book reads PARTLY for two rows today)
      const failKey = lineKeys.find((k) => !verdict[k]) || "?", failLine = [["pages"], ["firstVisit"], ["forms", "crm", "alert"]].findIndex((ks) => ks.includes(failKey));
      if (cb.code !== 0) bad.push("a row not WORKS: exit " + cb.code + " " + cb.err.slice(0, 160));
      else {
        const lastB = secs(cb.html).pop() || "";
        HW.draftContainsPlain.forEach((t, j) => { const there = lastB.includes(t); if (j === failLine ? there : !there) bad.push("a row not WORKS: line " + (j + 1) + (there ? " is printed" : " is missing")); });
        if (!cb.stdout.includes("left out of the last page: line " + (failLine + 1) + " of what is in the draft (the product book rows of " + failKey + " do not all read WORKS)")) bad.push("a row not WORKS: the run does not say what it left out: " + cb.stdout.slice(0, 200));
      }
      const okFile = path.join(tmp, "book-all.md"); fs.writeFileSync(okFile, books.allWorks);
      const cg = copy(mk("b2", ["site", "local", "rivals"], A1()), { book: okFile });
      if (cg.code !== 0) bad.push("a book with every row WORKS: exit " + cg.code + " " + cg.err.slice(0, 200));
      check("case 8: the last page: the pipeline list is there and nowhere else, the three plain lines under the first step; the WORKS rule gives the old data layer's verdict on the real backing.json with the real book and four invented books; a book with a row not WORKS leaves that line out, keeps the others and says so", bad.length === 0, bad.join(" | "));
    }

    // ---- 9: the manifest
    {
      const L = await import(pathToFileURL(path.join(here, "lib-pipeline.mjs")).href), ml = L.loadManifest(path.join(SKILL, "pipeline.json")), st = ml.manifest?.steps || [];
      const c = st.find((x) => x.id === "client-copy") || {}, p = st.find((x) => x.id === "client-copy-pdf") || {}, bad = [], J = JSON.stringify;
      if (!ml.ok) bad.push("manifest invalid: " + ml.problems.map(L.describe).join("; "));
      if (c.script !== "scripts/analysis-copy.mjs" || J(c.args) !== J(["{key}", "--pewp", "{pewp}", "--out", "{pewp}/client-copy"])) bad.push("script/args " + J([c.script, c.args]));
      if (J(c.dependsOn) !== J(["analysis-judge"])) bad.push("dependsOn " + J(c.dependsOn));
      if (J(c.inputs) !== J(["{pewp}/analysis.json", "{pewp}/analysis.checked.json", "{pewp}/analysis.sheet.json", "{pewp}/profile.json"])) bad.push("inputs " + J(c.inputs));
      if (J(c.outputs) !== J(["{pewp}/client-copy/*.html", "{pewp}/client-copy/numbers-*.tsv"]) || J(c.evidence) !== J(c.outputs) || c.needsBrowser !== "none" || c.heavy !== false || c.needsAi !== false || c.kind !== "derived") bad.push("fields");
      if (p.script !== "scripts/client-copy-pdf.mjs" || J(p.args) !== J(["{pewp}/client-copy"]) || J(p.inputs) !== J(["{pewp}/client-copy/*.html"]) || J(p.outputs) !== J(["{pewp}/client-copy/*.pdf"]) || J(p.dependsOn) !== J(["client-copy"]) || p.needsBrowser !== "headless" || p.heavy !== true || p.timeoutMinutes !== 20) bad.push("client-copy-pdf is not as it was " + J(p).slice(0, 200));
      check("case 9: the manifest: client-copy runs analysis-copy.mjs after analysis-judge on the three analysis files and the profile, outputs unchanged; client-copy-pdf is as it was; the manifest is valid", bad.length === 0, bad.join(" | "));
    }

    // ---- 10: the module and this test hold no dash
    {
      const dashes = [String.fromCharCode(8212), String.fromCharCode(8211)];
      const bad = ["analysis-copy.mjs", "test-analysis-copy.mjs"].filter((f) => { let x = ""; try { x = fs.readFileSync(path.join(dir, f), "utf8"); } catch { return true; } return dashes.some((d) => x.includes(d)); });
      check("case 10: the module and this test hold no em dash and no en dash", bad.length === 0, bad.join());
    }
  } finally { rmTmp(tmp); }
  return results;
}

const AC = "analysis-copy.mjs";
const MUTANTS = [
  { name: "a value is printed without escaping", patches: [{ file: AC, from: "return esc(printed); // @value", to: "return printed;" }], expect: [/^case 5:/] },
  { name: "the freshness of the checked file is not asked", patches: [{ file: AC, from: "if (stale) stop(", to: "if (false) stop(" }], expect: [/^case 3:/] },
  { name: "the gates are not called", patches: [{ file: AC, from: "gates({ html, tsv, pages, logoUrl, internal });", to: "" }], expect: [/^case 4:/] },
  { name: "a file is written before the gates", patches: [{ file: AC, from: "gates({ html, tsv, pages, logoUrl, internal });", to: 'fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, "early.html"), html);\n  gates({ html, tsv, pages, logoUrl, internal });' }], expect: [/^case 4:/] },
  { name: "the plan's fix is taken from the analysis", patches: [{ file: AC, from: "const fixText = fx.fix;", to: "const fixText = p.fix;" }], expect: [/^case 7:/] },
  { name: "the month row is left out", patches: [{ file: AC, from: 'add([1, "month of the audit", MONTH, "profile.json", "generatedAt", gen, gen, "RUN"]);', to: "" }], expect: [/^case 1:/] },
  { name: "the already-have heading is printed when the list is empty", patches: [{ file: AC, from: "have.length > 0 ?", to: "true ?" }], expect: [/^case 2:/] },
  { name: "the WORKS rule is not applied", patches: [{ file: AC, from: 'state === "WORKS"', to: "true" }], expect: [/^case 8:/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-analysis-copy.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "ANALYSIS COPY", scenarios, MUTANTS, scriptsDir, argv: A }));
}
