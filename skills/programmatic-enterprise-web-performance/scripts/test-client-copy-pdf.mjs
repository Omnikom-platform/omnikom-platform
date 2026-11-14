// Usage: node test-client-copy-pdf.mjs [--scripts <dir>] [--quiet] [--mutants] [--only <id>]
// Test of client-copy-pdf.mjs: checkPdf on PDFs built here (page count, blank page, object streams, a stream that cannot be inflated), printCopy
// with a fake spawn and a fake clock (a good print, a missing profile or browser, a wrong page count, a blank page, no file, a file still growing,
// a stale part file, a file that is not a copy), and the command line (usage, the folder pick, the BLOCKED line, --seed-profile).
// No browser, no network, nothing outside its temp folder.
// --mutants: watched-fail. Breaks one thing at a time in a copy of the skill and requires the named case to go red (green = the case
//   measures nothing, or the patch never applied; a `from` that occurs twice is refused). Exit 0 = all pass, exit 1 = a case failed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { EventEmitter } from "node:events";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkTmp, rmTmp } from "./lib-test-kit.mjs";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(args.includes("--scripts") ? args[args.indexOf("--scripts") + 1] : here);
const quiet = args.includes("--quiet");
const skill = path.dirname(dir);

// ---------------------------------------------------------------- mutants
if (args.includes("--mutants")) {
  const MUT = [
    { id: "page-count-unchecked", file: "client-copy-pdf.mjs", from: "if (c.pages !== want) return", to: "if (false) return", red: "case 9:" },
    { id: "blank-unchecked", file: "client-copy-pdf.mjs", from: "if (c.blank.length) return", to: "if (false) return", red: "case 10:" },
    { id: "image-only-page-reads-blank", file: "client-copy-pdf.mjs", from: "(?:Tj|TJ|Do)", to: "(?:Tj|TJ)", red: "case 4:" },
    { id: "count-crosscheck-dropped", file: "client-copy-pdf.mjs", from: "if (count !== pageObjs.length) return", to: "if (false) return", red: "case 5:" },
    { id: "profile-check-dropped", file: "client-copy-pdf.mjs", from: "if (!fs.existsSync(path.join(profileDir, \"Local State\"))) return", to: "if (false) return", red: "case 8:" },
    { id: "rename-before-check", file: "client-copy-pdf.mjs", from: "const c = checkPdf(buf);", to: "try { fs.renameSync(part, outPath); } catch {}\n  const c = checkPdf(buf);", red: "case 9:" },
    { id: "old-pdf-removed-first", file: "client-copy-pdf.mjs", from: "drop(); // stale part file", to: "drop(); fs.rmSync(outPath, { force: true });", red: "case 9:" },
    { id: "wait-ends-at-first-size", file: "client-copy-pdf.mjs", from: "if (size > 0 && size === last)", to: "if (size > 0)", red: "case 12:" },
    { id: "stale-part-kept", file: "client-copy-pdf.mjs", from: "drop(); // stale part file", to: "// stale part file", red: "case 13:" },
    { id: "spawn-error-ignored", file: "client-copy-pdf.mjs", from: "child.on(\"error\", (e) => { spawnErr = e; });", to: "child.on(\"error\", () => {});", red: "case 11:" },
    { id: "zero-sections-not-refused", file: "client-copy-pdf.mjs", from: "if (want === 0) return", to: "if (false) return", red: "case 14:" },
    { id: "unsound-print-not-refused", file: "client-copy-pdf.mjs", from: "if (!c.ok) return fail(", to: "if (false) return fail(", red: "case 10:" },
    { id: "blocked-profile-line-no-unblocks", file: "client-copy-pdf.mjs", from: " | unblocks: run node scripts/client-copy-pdf.mjs --seed-profile\"", to: "\"", red: "case 8:" },
    { id: "blocked-exe-line-no-unblocks", file: "client-copy-pdf.mjs", from: " | unblocks: install Chrome or Edge, or set CHROME_PATH to chrome.exe / msedge.exe\"", to: "\"", red: "case 8:" },
    { id: "line-printed-after-blocked", file: "client-copy-pdf.mjs", from: "(r.state === \"written\" ? console.log : console.error)(r.line);", to: "(r.state === \"written\" ? console.log : console.error)(r.line); if (r.state === \"blocked\") console.error(\"try again later\");", red: "case 17:" },
    { id: "oldest-html-picked", file: "client-copy-pdf.mjs", from: "b.t - a.t ||", to: "a.t - b.t ||", red: "case 16:" },
    { id: "folder-read-as-file", file: "client-copy-pdf.mjs", from: "fs.statSync(htmlPath).isDirectory()", to: "false", red: "case 17:" },
    { id: "seed-profile-writes-nothing", file: "client-copy-pdf.mjs", from: "seedProfile(PROFILE_DIR);", to: "", red: "case 18:" },
    { id: "contents-list-unread", file: "client-copy-pdf.mjs", from: "\\[[^\\]]*\\]|", to: "", red: "case 4:" },
    { id: "inflate-failure-swallowed", file: "client-copy-pdf.mjs", from: "catch { return bad(`a stream of page ${n} cannot be inflated`); }", to: "catch { bytes = Buffer.alloc(0); }", red: "case 6:" },
    { id: "stream-eol-cut", file: "client-copy-pdf.mjs", from: "let bytes = Buffer.from(sm[2], \"latin1\");", to: "let bytes = Buffer.from(sm[2].replace(/\\r?\\n$/, \"\"), \"latin1\");", red: "case 19:" },
  ];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "copypdf-mut-"));
  let ok = 0;
  const runOne = (m) => new Promise((resolve) => {
    const copy = path.join(root, m.id);
    fs.cpSync(skill, copy, { recursive: true, filter: (s) => !/[\\/](runs|site-checks|\.git)([\\/]|$)/.test(s) });
    const f = path.join(copy, "scripts", m.file); const src = fs.readFileSync(f, "utf8");
    const hits = src.split(m.from).length - 1;
    if (hits !== 1) return resolve({ good: false, line: `MUTANT ${m.id}: PATCH DID NOT APPLY (target text found ${hits} times in ${m.file})` });
    fs.writeFileSync(f, src.replace(m.from, () => m.to));
    const c = spawn(process.execPath, ["--max-old-space-size=256", path.join(copy, "scripts", "test-client-copy-pdf.mjs"), "--scripts", path.join(copy, "scripts"), "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
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
  console.log(`mutants: ${ok}/${MUT.length} red for the right reason`);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}

// ---------------------------------------------------------------- harness
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); if (!quiet) console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " :: " + String(detail).slice(0, 400)}`); else if (!ok) console.log(`FAIL ${name} :: ${String(detail).slice(0, 200)}`); };

const tmp = mkTmp("copypdf");
try {
  const S = await import(pathToFileURL(path.join(dir, "client-copy-pdf.mjs")).href + "?" + Math.random());
  const TXT = (n) => `BT /F1 12 Tf (page ${n}) Tj ET`, RECT = "0.9 g 0 0 612 792 re f", IMG = "q /Im0 Do Q";
  // more: text of one extra stream, the SECOND stream of page 2 (its /Contents is a list); stored: no compression, the text stays in the file's bytes
  const mkPdf = (pages, { count = pages.length, objStm = false, badStream = false, more = null, stored = false } = {}) => {
    const objs = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 2 * i} 0 R`).join(" ")}] /Count ${count} >>`];
    pages.forEach((p, i) => { objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${more && i === 1 ? `[${4 + 2 * i} 0 R ${3 + 2 * pages.length} 0 R]` : `${4 + 2 * i} 0 R`} >>`); objs.push({ s: badStream ? Buffer.from("not deflate data") : zlib.deflateSync(p, { level: stored ? 0 : 6 }) }); });
    if (more) objs.push({ s: zlib.deflateSync(more) });
    if (objStm) objs.push("<< /Type /ObjStm /N 0 /First 0 >>");
    const out = [Buffer.from("%PDF-1.4\n")];
    objs.forEach((o, i) => out.push(Buffer.from(`${i + 1} 0 obj\n`), typeof o === "string" ? Buffer.from(o + "\n") : Buffer.concat([Buffer.from(`<< /Length ${o.s.length} /Filter /FlateDecode >>\nstream\n`), o.s, Buffer.from("\nendstream\n")]), Buffer.from("endobj\n")));
    return Buffer.concat(out);
  };
  const mkHtml = (n) => `<html><body><section class="cover">c</section>${'<section class="pg">p</section>'.repeat(n - 1)}</body></html>`;
  const SHAPE = /^BLOCKED: .+ \| unblocks: .+$/;
  // a run of the script with its temp folder (so the shared profile folder) the test's own; the run is skipped unless os.tmpdir() follows the variables (the machine's real profile is never reached)
  const sandbox = (sub) => {
    const sd = path.join(tmp, sub), v = { TEMP: sd, TMP: sd, TMPDIR: sd }, was = Object.fromEntries(Object.keys(v).map((k) => [k, process.env[k]]));
    fs.mkdirSync(sd, { recursive: true }); fs.writeFileSync(path.join(sd, "not-a-browser.txt"), "x");
    Object.assign(process.env, v); const seen = os.tmpdir();
    for (const [k, x] of Object.entries(was)) { if (x === undefined) delete process.env[k]; else process.env[k] = x; }
    return { sd, profile: path.join(sd, "pewp-pdf-shared-profile"), env: { ...v, CHROME_PATH: path.join(sd, "not-a-browser.txt") }, safe: path.resolve(seen) === path.resolve(sd) };
  };
  const OLD = Buffer.from("OLD PDF");
  let wn = 0;
  const world = (html, opt = {}) => {
    const d = path.join(tmp, `w${wn++}`), prof = path.join(d, "prof");
    fs.mkdirSync(prof, { recursive: true });
    const x = { d, prof, htmlPath: path.join(d, "copy.html"), outPath: path.join(d, "copy.pdf"), part: path.join(d, "copy.part.pdf") };
    fs.writeFileSync(x.htmlPath, html);
    if (!opt.noProfile) fs.writeFileSync(path.join(prof, "Local State"), "{}");
    if (opt.old) fs.writeFileSync(x.outPath, OLD);
    return x;
  };
  const go = async (x, pdf, opt = {}) => {
    const calls = []; let clock = 0, later = null;
    const io = {
      spawn: (exe, a) => {
        calls.push({ exe, args: a });
        const p = a.find((s) => s.startsWith("--print-to-pdf=")).slice("--print-to-pdf=".length), em = new EventEmitter();
        if (!opt.none) { if (opt.split) { fs.writeFileSync(p, pdf.subarray(0, 100)); later = () => fs.writeFileSync(p, pdf); } else fs.writeFileSync(p, pdf); }
        if (opt.err) queueMicrotask(() => em.emit("error", Object.assign(new Error("spawn failed"), { code: "ENOENT" })));
        return em;
      },
      now: () => clock,
      nap: async (ms) => { clock += ms; if (later) { const f = later; later = null; f(); } },
    };
    const t = Date.now();
    const r = await S.printCopy({ htmlPath: x.htmlPath, outPath: x.outPath, exe: "exe" in opt ? opt.exe : "fake-chrome", profileDir: x.prof, waitMs: 3000, stepMs: 1000 }, io);
    return { r, calls, ms: Date.now() - t };
  };
  const run = (a, env = {}) => spawnSync(process.execPath, [path.join(dir, "client-copy-pdf.mjs"), ...a], { encoding: "utf8", timeout: 60000, env: { ...process.env, NODE_OPTIONS: "", ...env } });
  const untouched = (x) => fs.existsSync(x.outPath) && fs.readFileSync(x.outPath).equals(OLD) && !fs.existsSync(x.part);
  const oneLine = (s) => s.trim() !== "" && !s.trim().includes("\n");

  check("case 1: countSections counts the cover and the pages of a copy", S.countSections(mkHtml(8)) === 8 && S.countSections(mkHtml(3)) === 3 && S.countSections("<html><p>x</p></html>") === 0);
  const c2 = S.checkPdf(mkPdf([TXT(1), TXT(2), TXT(3)]));
  check("case 2: checkPdf reads a good 3-page PDF: ok, 3 pages, no blank page", c2.ok && c2.pages === 3 && c2.blank.length === 0, JSON.stringify(c2));
  const c3 = S.checkPdf(mkPdf([TXT(1), RECT, TXT(3)]));
  check("case 3: checkPdf names a page that only draws a background as blank", c3.ok && JSON.stringify(c3.blank) === "[2]", JSON.stringify(c3));
  const c4 = S.checkPdf(mkPdf([TXT(1), IMG, TXT(3)])), c4b = S.checkPdf(mkPdf([TXT(1), RECT, TXT(3)], { more: TXT(2) }));
  check("case 4: a page that only draws an image is not blank, and a page whose /Contents is a list reads its second stream", c4.ok && c4.blank.length === 0 && c4b.ok && c4b.blank.length === 0, JSON.stringify([c4, c4b]));
  const c5 = S.checkPdf(mkPdf([TXT(1), TXT(2), TXT(3)], { count: 5 }));
  check("case 5: a /Count that is not the number of page objects is not ok and names the count", !c5.ok && /\/Count 5/.test(c5.why), JSON.stringify(c5));
  const c6 = [Buffer.from("hello"), mkPdf([TXT(1)], { badStream: true }), mkPdf([TXT(1)], { objStm: true }), mkPdf(["BT (endobj) Tj ET"], { stored: true })].map((b) => S.checkPdf(b));
  check("case 6: not a PDF, a stream that cannot be inflated, object streams and a stream holding the word endobj are each not ok with a reason", c6.every((c) => !c.ok && c.why), JSON.stringify(c6));

  const x7 = world(mkHtml(3), { old: true }), p7 = mkPdf([TXT(1), TXT(2), TXT(3)]), g7 = await go(x7, p7);
  check("case 7: a good print is put at the out path (the old PDF replaced), the part file is gone, ONE browser start on the profile with the part path and the copy's file URL",
    g7.r.state === "written" && g7.r.pages === 3 && g7.r.line === `wrote copy.pdf ${p7.length} bytes, pages: 3 (from copy.html)` && fs.readFileSync(x7.outPath).equals(p7) && !fs.existsSync(x7.part)
    && g7.calls.length === 1 && g7.calls[0].exe === "fake-chrome" && g7.calls[0].args[0] === `--user-data-dir=${x7.prof}` && g7.calls[0].args.includes(`--print-to-pdf=${x7.part}`) && g7.calls[0].args.at(-1) === pathToFileURL(x7.htmlPath).href,
    JSON.stringify({ r: g7.r, calls: g7.calls }));

  const x8 = world(mkHtml(3), { noProfile: true }), g8 = await go(x8, p7), x8b = world(mkHtml(3)), g8b = await go(x8b, p7, { exe: null });
  check("case 8: no profile or no browser is BLOCKED in the one-line shape naming what unblocks it, with no browser start, no PDF, no part file and no Local State made",
    g8.r.state === "blocked" && SHAPE.test(g8.r.line) && g8.r.line.includes("--seed-profile") && g8.calls.length === 0 && !fs.existsSync(x8.outPath) && !fs.existsSync(x8.part) && !fs.existsSync(path.join(x8.prof, "Local State"))
    && g8b.r.state === "blocked" && SHAPE.test(g8b.r.line) && g8b.r.line.includes("CHROME_PATH") && g8b.calls.length === 0, JSON.stringify([g8.r, g8b.r]));

  const x9 = world(mkHtml(8), { old: true }), g9 = await go(x9, mkPdf(Array.from({ length: 9 }, (_, i) => TXT(i + 1))));
  check("case 9: a print with more pages than the copy has sections is FAILED and the old PDF is left byte for byte", g9.r.state === "failed" && g9.r.line === "FAILED: the print has 9 pages, the copy has 8 sections" && untouched(x9), JSON.stringify(g9.r));
  const x10 = world(mkHtml(3), { old: true }), g10 = await go(x10, mkPdf([TXT(1), RECT, TXT(3)]));
  const x10b = world(mkHtml(3), { old: true }), g10b = await go(x10b, Buffer.from("not a pdf at all"));
  check("case 10: a blank page and a file that is not a PDF are each FAILED with the page or the reason named, the old PDF untouched",
    g10.r.line === "FAILED: page 2 of the print is blank" && untouched(x10) && g10b.r.line === "FAILED: the print is not a sound PDF: not a PDF" && untouched(x10b), JSON.stringify([g10.r, g10b.r]));

  const x11 = world(mkHtml(3), { old: true }), g11 = await go(x11, p7, { none: true });
  const x11b = world(mkHtml(3), { old: true }), g11b = await go(x11b, p7, { none: true, err: true });
  check("case 11: no file in the time is FAILED in a fake clock (under 2 s real), and a browser that cannot start is FAILED at once, the old PDF untouched",
    g11.r.line === "FAILED: no PDF was written in 3 s" && g11.ms < 2000 && untouched(x11) && g11b.r.state === "failed" && g11b.r.line.startsWith("FAILED: the browser did not start") && untouched(x11b), JSON.stringify([g11.r, g11b.r]));

  const x12 = world(mkHtml(3)), g12 = await go(x12, p7, { split: true });
  check("case 12: a file still growing is waited for: the size must stand still before the file is read", g12.r.state === "written" && g12.r.pages === 3 && fs.readFileSync(x12.outPath).equals(p7), JSON.stringify(g12.r));

  const x13 = world(mkHtml(3)); fs.writeFileSync(x13.part, p7);
  const g13 = await go(x13, p7, { none: true });
  check("case 13: a valid part file left by an earlier run is never taken for this print: FAILED no PDF, no out file, no part file", g13.r.state === "failed" && /^FAILED: no PDF was written/.test(g13.r.line) && !fs.existsSync(x13.outPath) && !fs.existsSync(x13.part), JSON.stringify(g13.r));

  const x14 = world("<html>x</html>", { old: true }), g14 = await go(x14, p7);
  check("case 14: a file with no section of the copy is a STOP with no browser start, the old PDF untouched", g14.r.state === "failed" && g14.r.line.startsWith("STOP: not a copy") && g14.calls.length === 0 && untouched(x14), JSON.stringify(g14.r));

  const r15 = [run([]), run(["--bogus"])], h15 = run(["--help"]);
  check("case 15: no argument and an unknown argument exit 2 with one line on stderr and nothing on stdout; --help exits 0 and prints Usage",
    r15.every((r) => r.status === 2 && oneLine(r.stderr) && r.stdout === "") && h15.status === 0 && /Usage/.test(h15.stdout), JSON.stringify([r15.map((r) => [r.status, r.stderr, r.stdout]), h15.status, h15.stdout]));

  const f16 = path.join(tmp, "folder16"), e16 = path.join(tmp, "empty16");
  fs.mkdirSync(f16); fs.mkdirSync(e16);
  for (const [f, t] of [["z-draft.html", 1700000000], ["a-final.html", 1700100000]]) { fs.writeFileSync(path.join(f16, f), mkHtml(3)); fs.utimesSync(path.join(f16, f), t, t); }
  fs.writeFileSync(path.join(f16, "numbers.tsv"), "a\tb\n");
  const r16 = run([e16]);
  check("case 16: a folder gives its newest html (not the name that sorts last), an empty one gives null, and the command on an empty folder is a STOP on stderr with exit 1",
    S.newestHtml(f16) === path.join(f16, "a-final.html") && S.newestHtml(e16) === null && r16.status === 1 && r16.stdout === "" && r16.stderr.trim() === `STOP: no copy html in ${e16}`, JSON.stringify([S.newestHtml(f16), r16.status, r16.stderr]));

  const sb17 = sandbox("sb-blocked"), in17 = path.join(sb17.sd, "in");
  fs.mkdirSync(in17); fs.writeFileSync(path.join(in17, "copy.html"), mkHtml(3));
  const r17 = sb17.safe ? [run([in17], sb17.env), run([path.join(in17, "copy.html")], sb17.env)] : [];
  check("case 17: with no seeded profile the command, given a folder or the html, exits 3 with nothing on stdout and ONE BLOCKED line on stderr naming --seed-profile; no profile and no PDF is made",
    sb17.safe && r17.every((r) => r.status === 3 && r.stdout === "" && oneLine(r.stderr) && SHAPE.test(r.stderr.trim()) && r.stderr.includes("--seed-profile")) && !fs.existsSync(sb17.profile) && fs.readdirSync(in17).join() === "copy.html",
    sb17.safe ? JSON.stringify(r17.map((r) => [r.status, r.stdout, r.stderr])) : "skipped: os.tmpdir() does not follow TEMP here");

  const sb18 = sandbox("sb-seed");
  const a18 = sb18.safe ? run(["--seed-profile", "x.html"], sb18.env) : null, made18 = fs.existsSync(sb18.profile);
  const b18 = sb18.safe ? run(["--seed-profile"], sb18.env) : null;
  let st18 = null; try { st18 = JSON.parse(fs.readFileSync(path.join(sb18.profile, "Local State"), "utf8")); } catch { /* none */ }
  check("case 18: --seed-profile with another argument is a usage fault that makes nothing; alone it seeds the profile (Local State says the password is not blank), prints seeded <folder>, exit 0",
    sb18.safe && a18.status === 2 && !made18 && b18.status === 0 && b18.stdout.trim() === `seeded ${sb18.profile}` && b18.stderr === "" && st18?.password_manager?.os_password_blank === false,
    sb18.safe ? JSON.stringify([a18.status, made18, b18.status, b18.stdout, b18.stderr, st18]) : "skipped: os.tmpdir() does not follow TEMP here");

  // the content grows until its compressed stream ends with the wanted byte (the bound: 2000 tries; none found = the case fails, never passes empty)
  const endsWith = (byte) => { for (let i = 0; i <= 2000; i++) { const t = `BT /F1 12 Tf (${"a".repeat(i)}) Tj ET`; if (zlib.deflateSync(t, { level: 6 }).at(-1) === byte) return t; } return null; };
  const t0d = endsWith(0x0d), t0a = endsWith(0x0a);
  const c19 = [t0d, t0a].map((t) => (t === null ? null : S.checkPdf(mkPdf([t]))));
  check("case 19: a sound page whose compressed stream ends with the byte 0x0D, and one that ends with 0x0A, are read (ok, 1 page, not blank)",
    c19.every((c) => c && c.ok && c.pages === 1 && c.blank.length === 0), JSON.stringify([t0d === null ? "no 0x0D content found" : "", t0a === null ? "no 0x0A content found" : "", c19]));
} catch (e) {
  check("test harness ran to the end", false, e.stack || e);
}
rmTmp(tmp);

const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed${failed.length ? "; FAILED: " + failed.map((r) => r.name.split(":")[0] + ": " + r.name.slice(r.name.indexOf(":") + 2, 60)).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
