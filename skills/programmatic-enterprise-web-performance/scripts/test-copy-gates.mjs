// Usage: node test-copy-gates.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of client-copy-gates.mjs (scripts/client-copy-gates.mjs): the report rules as gates over the finished html and sheet of the client copy, run on
// INVENTED pages (no file of a client, no network, no browser). Every gate is a STOP of one line, STOP: gate <name>: <what was found>; the first gate that
// fails speaks, in the order sections, blank page, pictures, last page, dashes, contact line, internal words, numbers, internal (the lines of the internal sheet).
// What is pinned: 5 to 8 sections with the cover first; no section without visible text; the logo as the only picture; the pipeline list on the last page
// only; no em or en dash; no contact line; no internal word (a status word only in capitals); every number of a page held by a printed cell of that page's
// sheet rows, with the four exemptions checked (header month, footer, step and plan counters, page references); the step ids equal the pipeline's.
// --mutants: watched-fail. Copies the skill, breaks one thing at a time, runs this test against the copy and requires the named
//   case to go red (green = the case measures nothing, or the patch never applied; a `from` that occurs other than once is refused).
// Exit 0 = all pass, exit 1 = a case failed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : here);
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const GATES = "client-copy-gates.mjs", LIST = "[WORD, UPPER, BROKEN, FILE, CODE, STEP]";
  const MUT = [
    { id: "sections-marked-unchecked", file: GATES, from: "marked !== opens || ", to: "", red: "case 2:" },
    { id: "sections-min-one", file: GATES, from: "opens < 5", to: "opens < 1", red: "case 2:" },
    { id: "sections-max-eighty", file: GATES, from: "opens > 8", to: "opens > 80", red: "case 2:" },
    { id: "sections-built-unchecked", file: GATES, from: "opens !== pages ||", to: "", red: "case 2:" },
    { id: "cover-first-unchecked", file: GATES, from: "!secs[0].startsWith('<section class=\"cover\" id=\"p1\">')", to: "false", red: "case 2:" },
    { id: "page-order-unchecked", file: GATES, from: "if (i > 0 && !s.startsWith(", to: "if (false && !s.startsWith(", red: "case 2:" },
    { id: "blank-never", file: GATES, from: '=== "") fail("blank page"', to: '=== "x") fail("blank page"', red: "case 3:" },
    { id: "blank-counts-header-footer", file: GATES, from: '.replace(/<div class="rh">[\\s\\S]*?<\\/div>/, "").replace(/<div class="rf">[\\s\\S]*?<\\/div>/, "")', to: "", red: "case 3:" },
    { id: "second-img-allowed", file: GATES, from: "imgs.length > 1 || ", to: "", red: "case 4:" },
    { id: "any-img-is-the-logo", file: GATES, from: "imgs.some((t) => !(t.includes('class=\"logo\"') && t.includes(`src=\"${logoUrl}\"`)))", to: "imgs.some((t) => false)", red: "case 4:" },
    { id: "css-url-allowed", file: GATES, from: "/url\\(|image-set\\(|", to: "/image-set\\(|", red: "case 4:" },
    { id: "font-face-url-refused", file: GATES, from: 'html.replace(/@font-face\\s*\\{[^}]*\\}/gi, "")', to: "html", red: "case 4:" },
    { id: "svg-image-allowed", file: GATES, from: "|image|foreignObject)", to: "|foreignObject)", red: "case 4:" },
    { id: "steps-anywhere", file: GATES, from: "steps.join() !== String(secs.length)", to: "false", red: "case 5:" },
    { id: "sheet-dash-allowed", file: GATES, from: "const dm = DASH.exec(html) || DASH.exec(tsv);", to: "const dm = DASH.exec(html);", red: "case 6:" },
    { id: "en-dash-allowed", file: GATES, from: "/[\\u2013\\u2014]|&(", to: "/[\\u2014]|&(", red: "case 6:" },
    { id: "dash-entity-numeric-allowed", file: GATES, from: "|&#(?:8212|8211|x2014|x2013);/i", to: "/i", red: "case 6:" },
    { id: "email-not-checked", file: GATES, from: "EMAIL.exec(t) || PHONE.exec(t)", to: "PHONE.exec(t)", red: "case 7:" },
    { id: "phone-not-checked", file: GATES, from: "EMAIL.exec(t) || PHONE.exec(t)", to: "EMAIL.exec(t)", red: "case 7:" },
    { id: "long-digits-allowed", file: GATES, from: "|\\b\\d{10,}\\b/;", to: "/;", red: "case 7:" },
    { id: "plain-phone-allowed", file: GATES, from: "|\\b\\d{3}[.-]\\d{4}\\b", to: "", red: "case 7:" },
    { id: "mailto-allowed", file: GATES, from: '/mailto:|tel:|class="contact"/i', to: '/class="contact"/i', red: "case 7:" },
    { id: "words-unchecked", file: GATES, from: LIST, to: "[UPPER, BROKEN, FILE, CODE, STEP]", red: "case 8:" },
    { id: "status-words-unchecked", file: GATES, from: LIST, to: "[WORD, BROKEN, FILE, CODE, STEP]", red: "case 8:" },
    { id: "broken-text-unchecked", file: GATES, from: LIST, to: "[WORD, UPPER, FILE, CODE, STEP]", red: "case 8:" },
    { id: "file-names-unchecked", file: GATES, from: LIST, to: "[WORD, UPPER, BROKEN, CODE, STEP]", red: "case 8:" },
    { id: "code-names-unchecked", file: GATES, from: LIST, to: "[WORD, UPPER, BROKEN, FILE, STEP]", red: "case 8:" },
    { id: "step-ids-unchecked", file: GATES, from: LIST, to: "[WORD, UPPER, BROKEN, FILE, CODE]", red: "case 8:" },
    { id: "word-inside-a-word", file: GATES, from: "\\b(?:pending|", to: "(?:pending|", red: "case 8:" },
    { id: "numbers-never-missed", file: GATES, from: ".filter((x) => !have.has(x))", to: ".filter((x) => false)", red: "case 9:" },
    { id: "numbers-of-any-page", file: GATES, from: "rows.filter((r) => r[0] === String(pg))", to: "rows", red: "case 9:" },
    { id: "commas-kept", file: GATES, from: '(x) => x.replace(/,/g, "")', to: "(x) => x", red: "case 9:" },
    { id: "header-month-unchecked", file: GATES, from: "if (!visible(x).endsWith(", to: "if (false && !visible(x).endsWith(", red: "case 10:" },
    { id: "footer-unchecked", file: GATES, from: "if (visible(x) !== `Prepared by Omnikom", to: "if (false && visible(x) !== `Prepared by Omnikom", red: "case 10:" },
    { id: "step-counter-unchecked", file: GATES, from: "if (visible(x) !== String(++n))", to: "if (++n && false)", red: "case 10:" },
    { id: "plan-counter-unchecked", file: GATES, from: "if (visible(x) !== String(++k))", to: "if (++k && false)", red: "case 10:" },
    { id: "page-reference-unchecked", file: GATES, from: "if (+x < 1 || +x > secs.length)", to: "if (false)", red: "case 10:" },
    { id: "page-reference-case-sensitive", file: GATES, from: "(?![\\d%])/gi, (_, xs)", to: "(?![\\d%])/g, (_, xs)", red: "case 10:" },
    { id: "page-reference-eats-a-percent", file: GATES, from: "(?![\\d%])/gi, (_, xs)", to: "/gi, (_, xs)", red: "case 10:" },
    { id: "step-id-dropped", file: GATES, from: '"capture-maps", ', to: "", red: "case 11:" },
    { id: "internal-gate-removed", file: GATES, from: 'if (i >= 0) fail("internal"', to: 'if (i >= 999) fail("internal"', red: "case 13:" },
    { id: "internal-short-texts-looked-for", file: GATES, from: "(x) => x.length >= 8", to: "(x) => x.length >= 1", red: "case 13:" },
    { id: "dash-in-source", file: GATES, from: "// client-copy-gates.mjs: the report rules", to: "// client-copy-gates.mjs: the report rules" + String.fromCharCode(8212), red: "case 12:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "copygates-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-copy-gates.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => c.kill(), 300000);
    c.on("close", (code) => {
      clearTimeout(t);
      const failed = (out.match(/^FAIL .*$/gm) || []).map((l) => l.slice(5).split(" :: ")[0]);
      const hit = failed.some((n) => n.startsWith(m.red));
      resolve({ good: code !== 0 && hit, line: `MUTANT ${m.id}: ${code === 0 ? "STAYED GREEN (case measures nothing)" : hit ? "red for the right reason" : "red, but NOT the expected case"} | expected "${m.red}" | failed: ${failed.join(" ; ").slice(0, 160) || "(none)"}` });
    });
  });
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const queue = MUT.filter((m) => !only || m.id === only);
  await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) { const r = await runOne(queue.shift()); console.log(r.line); if (r.good) ok++; else process.exitCode = 1; } }));
  console.log(`mutants: ${ok}/${only ? 1 : MUT.length} red for the right reason`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}

// ---------------------------------------------------------------- harness
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); if (!quiet) console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " :: " + String(detail).slice(0, 400)}`); else if (!ok) console.log(`FAIL ${name} :: ${String(detail).slice(0, 200)}`); };
const run = (name, fn) => { let r; try { r = fn(); } catch (e) { r = [false, e.stack || String(e)]; } check(name, r[0], r[1]); };
const { gates, STEP_IDS } = await import(pathToFileURL(path.join(dir, "client-copy-gates.mjs")).href + "?" + Math.random()).catch(() => ({}));
const LOGO = "file:///logo.png", MONTH = "March 2031", NAME = "Birchwood Plumbing";
const HEAD = `<div class="rh"><span class="nm">${NAME}</span><span>SEO, AI search and local audit, ${MONTH}</span></div>`;
const FOOT = (i, n) => `<div class="rf"><span>Prepared by Omnikom</span><b>${i} / ${n}</b></div>`;
const STEPS = '<ol class="steps"><li><span class="sn">1</span><div><b>We draft</b></div></li><li><span class="sn">2</span><div><b>You look</b></div></li></ol>';
const PLAN = '<table class="plan"><tr><th>#</th><th>Fix</th></tr><tr><td>1</td><td>Fix one</td></tr><tr><td>2</td><td>Fix two</td></tr></table>';
const W = (i, n, body) => `${HEAD}<div class="in">${body}</div>${FOOT(i, n)}`;
const BODY = { 2: "<p>Hilltop shows 4 results and 12.5 s.</p>", 3: "<p>Your site sends 1,204 words.</p><p>See page 4.</p>", 4: `<p>2 of 8 answers.</p>${PLAN}` };
const mkDoc = (n = 5) => `<!doctype html><html><head><style>@font-face{font-family:X;src:url(f.woff2) format("woff2")}</style></head><body>${Array.from({ length: n }, (_, k) => k + 1).map((i) => i === 1
  ? `<section class="cover" id="p1"><img class="logo" src="${LOGO}" alt="Omnikom"><h1>${NAME}</h1><div class="num"><b>3 of 9</b><span>spots read</span></div></section>`
  : `<section class="pg" id="p${i}">${W(i, n, i === n ? `<h2>How we work</h2>${STEPS}` : BODY[i] || "<p>More text.</p>")}</section>`).join("\n")}</body></html>`;
const ROWS = [["month of the audit", "1", MONTH], ["spots read", "1", "3 of 9"], ["results", "2", "4 results"], ["seconds", "2", "12.5 s"], ["unused", "2", "777"], ["words", "3", "1,204 words"], ["answers", "4", "2 of 8"]];
const mkTsv = (rows = ROWS) => ["page\ttext\tprinted\tfile\twhere\tvalue\tmeasured\tkind", ...rows.map(([l, p, v]) => [p, l, v, "f.json", "w", "v", "m", "k"].join("\t"))].join("\n") + "\n";
const BASE = mkDoc(), TSV = mkTsv();
const stopOf = (fn) => { try { fn(); return ""; } catch (e) { return e.isStop ? e.message : "NOT A STOP: " + e.message; } };
const ask = (html, tsv = TSV, pages = 5) => stopOf(() => gates({ html, tsv, pages, logoUrl: LOGO }));
const setPage = (html, i, inner) => html.replace(new RegExp(`(<section class="pg" id="p${i}">)[\\s\\S]*?(</section>)`), (_, a, b) => a + inner + b);
const on2 = (text) => BASE.replace("<p>Hilltop shows 4 results and 12.5 s.</p>", `<p>${text}</p>`);
const want = (msg, re) => (re.test(msg) ? [] : [`${JSON.stringify(msg)} vs ${re}`]);
const gate = (name) => new RegExp(`^STOP: gate ${name}: `);
const D1 = String.fromCharCode(8212), D2 = String.fromCharCode(8211);

run("case 1: THE BASE: the invented copy (5 sections, and 8 with filler pages) passes every gate and the gate returns nothing; two faults at once give the first gate's line (dashes before numbers)", () => {
  const bad = [];
  if (ask(BASE) !== "") bad.push(`base: ${ask(BASE)}`);
  if (ask(mkDoc(8), TSV, 8) !== "") bad.push(`eight sections: ${ask(mkDoc(8), TSV, 8)}`);
  let ret = "?"; try { ret = gates({ html: BASE, tsv: TSV, pages: 5, logoUrl: LOGO }); } catch (e) { ret = "threw " + e.message; }
  if (ret !== undefined) bad.push(`returns ${ret}`);
  bad.push(...want(ask(BASE.replace("4 results", "4 results and 31 more").replace("Hilltop", `Hilltop ${D1}`)), gate("dashes")));
  return [bad.length === 0, bad.join(" | ")];
});
run("case 2: SECTIONS: fewer than 5, more than 8, a count that differs from the pages built, a first section that is not the cover, a section not marked cover or pg, a section out of order", () => {
  const bad = [], at3 = '<section class="pg" id="p3">';
  bad.push(...want(ask(mkDoc(4), TSV, 4), /^STOP: gate sections: the copy has 4 sections \(4 marked cover or pg, 4 built\); it needs 5 to 8, every one marked$/));
  bad.push(...want(ask(mkDoc(9), TSV, 9), /^STOP: gate sections: the copy has 9 sections \(9 marked cover or pg, 9 built\); it needs 5 to 8, every one marked$/));
  bad.push(...want(ask(BASE, TSV, 6), /^STOP: gate sections: the copy has 5 sections \(5 marked cover or pg, 6 built\); it needs 5 to 8, every one marked$/));
  bad.push(...want(ask(BASE.replace('<section class="cover" id="p1">', '<section class="pg" id="p1">')), /^STOP: gate sections: the first section is not the cover$/));
  bad.push(...want(ask(BASE.replace(at3, '<section class="pg sheet" id="p3">')), /^STOP: gate sections: the copy has 5 sections \(4 marked cover or pg, 5 built\); it needs 5 to 8, every one marked$/));
  bad.push(...want(ask(BASE.replace(at3, '<section class="pg" id="p7">')), /^STOP: gate sections: section 3 is not <section class="pg" id="p3">$/));
  return [bad.length === 0, bad.join(" | ")];
});
run("case 3: BLANK PAGE: a section holding only a picture (svg) or only a style has no visible text (its header and footer do not count); a page with an svg and a word passes", () => {
  const bad = [], re = /^STOP: gate blank page: page 3 has no visible text$/;
  bad.push(...want(ask(setPage(BASE, 3, W(3, 5, "<svg><rect/></svg>"))), re));
  bad.push(...want(ask(setPage(BASE, 3, W(3, 5, "<style>p{color:red}</style>"))), re));
  const g = ask(setPage(BASE, 3, W(3, 5, "<svg><rect/></svg><p>Some words</p>")));
  if (/blank page/.test(g)) bad.push(`green half: ${g}`);
  return [bad.length === 0, bad.join(" | ")];
});
run("case 4: PICTURES: the logo is the only picture: a second img, another src, a url() outside @font-face, an image element each STOP; the font url() and an inline svg shape pass", () => {
  const bad = [], re = gate("pictures");
  const b = (msg, text) => { const m = ask(msg); if (!re.test(m) || !m.includes(text)) bad.push(`${text}: ${JSON.stringify(m)}`); };
  b(BASE.replace("</section>", '</section><img src="x.png">'), "2 <img> found");
  b(BASE.replace("</section>", `</section><img class="logo" src="${LOGO}" alt="Omnikom">`), "2 <img> found");
  b(BASE.replace(`src="${LOGO}"`, 'src="file:///shot.png"'), "1 <img> found");
  b(BASE.replace("<h1>", '<h1 style="background:url(a.png)">'), "holds url(");
  b(BASE.replace("<h1>", '<h1><image href="a.png"/>'), "holds <image");
  for (const [nm, h] of [["BASE", BASE], ["svg shape", BASE.replace("<h1>", '<h1><svg viewBox="0 0 30 30"><rect width="9" height="9"/></svg>')]]) { const m = ask(h); if (re.test(m)) bad.push(`green half ${nm}: ${m}`); }
  return [bad.length === 0, bad.join(" | ")];
});
run("case 5: LAST PAGE: the pipeline list (ol.steps) is on the last page and on no other", () => {
  const bad = [];
  bad.push(...want(ask(BASE.replace(STEPS, "<p>x</p>")), /^STOP: gate last page: the pipeline list is on page none; it belongs on the last page, 5, only$/));
  bad.push(...want(ask(BASE.replace("2 of 8 answers.</p>", `2 of 8 answers.</p>${STEPS}`)), /^STOP: gate last page: the pipeline list is on page 4, 5; it belongs on the last page, 5, only$/));
  return [bad.length === 0, bad.join(" | ")];
});
run("case 6: DASHES: an em or en dash, as a character or an entity, in the html or in the sheet STOPs; a hyphen passes", () => {
  const bad = [], re = gate("dashes");
  for (const [nm, h] of [["em", BASE.replace("Hilltop", `Hilltop ${D1}`)], ["en", BASE.replace("Hilltop", `Hilltop ${D2}`)], ["&mdash;", BASE.replace("Hilltop", "Hilltop &mdash;")], ["&#8211;", BASE.replace("Hilltop", "Hilltop &#8211;")]]) bad.push(...want(ask(h), re).map((x) => nm + ": " + x));
  bad.push(...want(ask(BASE, mkTsv(ROWS.map((r) => (r[0] === "unused" ? [`un${D2}used`, r[1], r[2]] : r)))), /^STOP: gate dashes: the sheet holds a dash \(/));
  bad.push(...want(ask(BASE.replace("Hilltop", "Hilltop &mdash;")), /^STOP: gate dashes: the html holds a dash \(&mdash;\)$/));
  const g = ask(BASE.replace("Hilltop", "Hilltop - x")); if (re.test(g)) bad.push(`green half: ${g}`);
  return [bad.length === 0, bad.join(" | ")];
});
run("case 7: CONTACT LINE: an e-mail address, a phone number in four forms, mailto:, tel: and class=contact STOP; dates, numbers with commas or points and the month pass", () => {
  const bad = [];
  for (const [t, m] of [["hi@birchwood.test", "hi@birchwood.test"], ["Call 555-0100", "555-0100"], ["Call +1 (555) 010 0199", "+1 (555) 010 0199"], ["Call (555) 010-0199", "(555) 010-0199"], ["Call 5550100199", "5550100199"]]) bad.push(...want(ask(on2(t)), new RegExp(`^STOP: gate contact line: page 2 prints "${m.replace(/[()+]/g, "\\$&")}"$`)));
  bad.push(...want(ask(on2('<a href="mailto:a@b.test">Write</a>')), /^STOP: gate contact line: the html holds mailto:$/));
  bad.push(...want(ask(on2('<a href="tel:5550100">x</a>')), /^STOP: gate contact line: the html holds tel:$/));
  bad.push(...want(ask(on2('<span class="contact">x</span>')), /^STOP: gate contact line: the html holds class="contact"$/));
  for (const t of ["2026-11-13", "Nov 13 2026", "487 to 2,677", "12.5 s", "March 2031", "1,204 words"]) { const g = ask(on2(t)); if (gate("contact line").test(g)) bad.push(`green half ${t}: ${g}`); }
  return [bad.length === 0, bad.join(" | ")];
});
run("case 8: INTERNAL WORDS: the report's banned phrases, a status word in capitals, a code leftover, a file name, a run folder, a step id each STOP naming the match; an ordinary English word passes", () => {
  const bad = [];
  for (const [t, m] of [["pending", "pending"], ["Not read in this review", "Not read in this review"], ["not run", "not run"], ["could not read Copilot", "could not read"], ["serp.json", "serp.json"], [".pewp", "pewp"], ["snapshots/2026", "snapshots/"], ["capture-maps", "capture-maps"], ["pointsIn3Pack", "pointsIn3Pack"], ["v2_export", "v2_export"], ["BLOCKED", "BLOCKED"], ["undefined", "undefined"], ["{x}", "{"], ["rows[strategy=mobile]", "s[strategy=mobile]"], ["approve-seeds", "approve-seeds"]]) bad.push(...want(ask(on2(t)), new RegExp(`^STOP: gate internal words: page 2 prints "${m.replace(/[[\]{}.=]/g, "\\$&")}"$`)));
  for (const t of ["spending", "appended", "the blocked page", "partly", "city-centres", "search-console", "demand-driven", "research-based", "iPhone and eBay", "nullify"]) { const g = ask(on2(t)); if (gate("internal words").test(g)) bad.push(`green half ${t}: ${g}`); }
  return [bad.length === 0, bad.join(" | ")];
});
run("case 9: NUMBERS, uncovered: a number that no printed cell of its page holds STOPs naming it (up to four); a number of another page's row, a changed digit and a typed number all count; commas are ignored", () => {
  const bad = [], re = (s) => new RegExp(`^STOP: gate numbers: ${s}$`);
  bad.push(...want(ask(on2("Hilltop shows 4 results and 12.5 s and 31 more.")), re("page 2 prints 31 and no printed cell of page 2 of the sheet holds it")));
  bad.push(...want(ask(BASE.replace("2 of 8 answers.</p>", "2 of 8 answers. 777</p>")), re("page 4 prints 777 and no printed cell of page 4 of the sheet holds it")));
  bad.push(...want(ask(on2("Hilltop shows 4 results and 12.6 s.")), re("page 2 prints 12.6 and no printed cell of page 2 of the sheet holds it")));
  bad.push(...want(ask(on2("Hilltop shows 4 results and 12.5 s and 31 32 33 34 35.")), re("page 2 prints 31, 32, 33, 34 and 1 more and no printed cell of page 2 of the sheet holds them")));
  for (const [nm, h] of [["1204 for 1,204", BASE.replace("1,204 words", "1204 words")], ["a number of its own page", on2("Hilltop shows 4 results, 12.5 s and 777.")]]) { const g = ask(h); if (g !== "") bad.push(`green half ${nm}: ${g}`); }
  return [bad.length === 0, bad.join(" | ")];
});
run("case 10: THE FOUR EXEMPTIONS ARE CHECKED: a wrong header month, footer, plan row number, step number or page reference STOPs; a right page range passes; a year typed in a body is not the header", () => {
  const bad = [], re = (s) => new RegExp(`^STOP: gate numbers: ${s}$`), p3 = (f) => setPage(BASE, 3, f(W(3, 5, BODY[3])));
  bad.push(...want(ask(p3((x) => x.replace("March 2031", "March 2032"))), re("the header of page 3 does not end with the sheet's month, March 2031")));
  bad.push(...want(ask(p3((x) => x.replace("3 / 5", "3 / 6"))), re('the footer of page 3 is not "3 / 5"')));
  bad.push(...want(ask(BASE.replace("<tr><td>2</td>", "<tr><td>3</td>")), re("a row number of the plan on page 4 is not 2")));
  bad.push(...want(ask(BASE.replace('<span class="sn">2</span>', '<span class="sn">3</span>')), re("a step number on page 5 is not 2")));
  bad.push(...want(ask(p3((x) => x.replace("See page 4.", "See page 9."))), re("page 3 refers to page 9, which is not in the copy")));
  bad.push(...want(ask(p3((x) => x.replace("1,204 words.", "1,204 words in 2031."))), re("page 3 prints 2031 and no printed cell of page 3 of the sheet holds it")));
  bad.push(...want(ask(p3((x) => x.replace("See page 4.", "See Page 9."))), re("page 3 refers to page 9, which is not in the copy")));
  bad.push(...want(ask(p3((x) => x.replace("See page 4.", "No page 34%"))), re("page 3 prints 34 and no printed cell of page 3 of the sheet holds it")));
  for (const t of ["See pages 3 to 5.", "See Page 4.", "See pages 3 and 4."]) { const g = ask(p3((x) => x.replace("See page 4.", t))); if (g !== "") bad.push(`green half ${t}: ${g}`); }
  return [bad.length === 0, bad.join(" | ")];
});
run("case 11: THE STEP IDS FOLLOW THE PIPELINE: the hyphenated step ids of pipeline.json, less the two ordinary words, equal STEP_IDS (32)", () => {
  const ids = JSON.parse(fs.readFileSync(path.join(skill, "pipeline.json"), "utf8")).steps.map((s) => s.id).filter((i) => i.includes("-") && !["city-centres", "search-console"].includes(i));
  const have = new Set(STEP_IDS), need = new Set(ids), bad = [];
  for (const i of ids) if (!have.has(i)) bad.push(`pipeline step missing in STEP_IDS: ${i}`);
  for (const i of STEP_IDS) if (!need.has(i)) bad.push(`STEP_IDS holds a name that is not a step: ${i}`);
  if (STEP_IDS.length !== 32) bad.push(`length ${STEP_IDS.length}`);
  return [bad.length === 0, bad.join(" | ")];
});
run("case 12: the module and this test hold no em dash, no en dash and no user-folder or drive path", () => {
  const dashes = [D1, D2], paths = [["C:", "Users"].join("\\"), "E:" + "\\"];
  const bad = ["client-copy-gates.mjs", "test-copy-gates.mjs"].filter((f) => { const s = fs.readFileSync(path.join(dir, f), "utf8"); return dashes.some((d) => s.includes(d)) || paths.some((p) => s.includes(p)); });
  return [bad.length === 0, bad.join()];
});
run("case 13: THE INTERNAL SHEET: a page whose visible text holds a line of the internal sheet STOPs (other case and spacing too, the page named); a text of 7 characters is not looked for; no list or an empty list leaves every old case as before; the gate is last", () => {
  const bad = [], LINE = "Maps capture blocked by the host", askI = (html, internal, tsv = TSV) => stopOf(() => gates({ html, tsv, pages: 5, logoUrl: LOGO, internal }));
  const page2 = on2(LINE + ".");
  bad.push(...want(askI(page2, [LINE]), /^STOP: gate internal: page 2 holds a line of the internal sheet$/));
  bad.push(...want(askI(on2("MAPS   capture\n blocked  by THE host."), [LINE]), /^STOP: gate internal: page 2 holds a line of the internal sheet$/));
  bad.push(...want(askI(page2, ["maps  CAPTURE blocked by the HOST"]), /^STOP: gate internal: page 2 holds a line of the internal sheet$/));
  bad.push(...want(askI(setPage(BASE, 3, W(3, 5, "<p>" + LINE + ".</p>")), ["other line to look for", LINE]), /^STOP: gate internal: page 3 holds a line of the internal sheet$/));
  for (const [nm, h, list] of [["a text of 7 characters", BASE, ["Hilltop"]], ["a line the pages do not hold", page2, ["The review was skipped"]], ["no list", page2, undefined], ["an empty list", page2, []]]) { const g = askI(h, list); if (g !== "") bad.push(`green half ${nm}: ${g}`); }
  bad.push(...want(askI(page2.replace("Maps", `Maps ${D1}`), [LINE]), gate("dashes")));
  bad.push(...want(askI(on2(LINE + " 31."), [LINE]), gate("numbers")));
  if (ask(BASE) !== "") bad.push(`old base: ${ask(BASE)}`);
  return [bad.length === 0, bad.join(" | ")];
});

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
