// Usage: node scripts/client-copy-pdf.mjs <copy.html | folder> [--out <file.pdf>]     |     node scripts/client-copy-pdf.mjs --seed-profile
// The PDF of the client's copy (client-copy.mjs writes the html): Chrome prints it on the ONE shared seeded profile (never a fresh one), the script waits
// until the file exists and stops growing, checks the result (it is a PDF, its page count is the copy's section count, no page is blank) and only then puts
// it at the out path (default: next to the html, same name). A folder means its newest html. --seed-profile makes the shared profile, starts no browser.
// Exit 0 written and checked; 1 FAILED or STOP (one line on stderr; an older PDF at the out path is left byte for byte); 2 a usage fault (one line);
// 3 BLOCKED (the LAST line is `BLOCKED: <what> | unblocks: <what would>`). Takes no lock: its caller does. Makes no network request.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { seedProfile, spawnBrowser } from "./lib-browser-profile.mjs";
import { CHROME_PATH } from "./cdp-measure.mjs";

const CHROME = CHROME_PATH;
export const PROFILE_DIR = path.join(os.tmpdir(), "pewp-pdf-shared-profile");
export const countSections = (html) => (String(html).match(/<section class="(?:cover|pg)"/g) || []).length;
export const newestHtml = (dir) => { // the *.html of a folder with the newest file time (a tie: the name that sorts last), or null
  const hs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && /\.html$/i.test(e.name)).map((e) => ({ f: e.name, t: fs.statSync(path.join(dir, e.name)).mtimeMs }));
  hs.sort((a, b) => b.t - a.t || (a.f < b.f ? 1 : -1));
  return hs.length ? path.join(dir, hs[0].f) : null;
};

const SHOWS = /\b(?:Tj|TJ|Do)\b/;

/** Reads a PDF with node's zlib only: { ok, pages, blank (page numbers from 1), why }. ok = readable and consistent; the caller decides on blanks. */
export function checkPdf(buf) {
  const bad = (why) => ({ ok: false, pages: 0, blank: [], why });
  if (!Buffer.isBuffer(buf) || buf.subarray(0, 5).toString("latin1") !== "%PDF-") return bad("not a PDF");
  const s = buf.toString("latin1");
  if (/\/Type\s*\/ObjStm/.test(s)) return bad("it uses object streams");
  const objs = new Map();
  for (const m of s.matchAll(/(\d+) (\d+) obj\b([\s\S]*?)(?:endstream\s*)?endobj/g)) objs.set(Number(m[1]), m[3]);
  const bodies = [...objs.values()];
  const pageObjs = bodies.filter((b) => /\/Type\s*\/Page(?![A-Za-z])/.test(b));
  const trees = bodies.filter((b) => /\/Type\s*\/Pages\b/.test(b));
  if (trees.length !== 1) return bad("the page tree is not one object");
  const cn = trees[0].match(/\/Count (\d+)/);
  if (!cn) return bad("no /Count");
  const count = Number(cn[1]);
  if (count !== pageObjs.length) return bad(`/Count ${count} but ${pageObjs.length} page objects`);
  const blank = [];
  for (let n = 1; n <= pageObjs.length; n++) {
    const page = pageObjs[n - 1];
    const cm = page.match(/\/Contents\s*(\[[^\]]*\]|\d+ \d+ R)/);
    const refs = cm ? [...cm[1].matchAll(/(\d+) \d+ R/g)].map((m) => Number(m[1])) : [];
    if (!refs.length || refs.some((r) => !objs.has(r))) return bad(`page ${n} has no content`);
    let text = "";
    for (const r of refs) {
      const sm = /^([\s\S]*?)stream\r?\n([\s\S]*)$/.exec(objs.get(r));
      if (!sm) continue;
      let bytes = Buffer.from(sm[2], "latin1"); // the end of line before endstream stays: zlib stops at the end of its own stream, and cutting it could cut a data byte
      if (/\/FlateDecode/.test(sm[1])) { try { bytes = zlib.inflateSync(bytes); } catch { return bad(`a stream of page ${n} cannot be inflated`); } }
      else if (/\/Filter/.test(sm[1])) return bad("unknown filter");
      text += bytes.toString("latin1") + "\n";
    }
    if (!SHOWS.test(text)) blank.push(n);
  }
  return { ok: true, pages: pageObjs.length, blank, why: "" };
}

/** Prints the copy with the browser on the shared profile and puts the PDF at outPath only when it passed its checks. io: spawn, now, nap (tests). */
export async function printCopy({ htmlPath, outPath, exe, profileDir, waitMs = 90000, stepMs = 1000 }, io = {}) {
  const now = io.now || Date.now, nap = io.nap || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const part = outPath.replace(/\.pdf$/i, "") + ".part.pdf", drop = () => fs.rmSync(part, { force: true });
  const done = (state, line, o = {}) => ({ state, line, pages: 0, bytes: 0, ...o });
  const fail = (why) => { drop(); return done("failed", `FAILED: ${why}`); };
  let html; try { html = fs.readFileSync(htmlPath, "utf8"); } catch (e) { return done("failed", `FAILED: cannot read ${path.basename(htmlPath)} (${e.code || e.message})`); }
  const want = countSections(html);
  if (want === 0) return done("failed", "STOP: not a copy client-copy.mjs wrote (no section of the copy in it)");
  if (!exe) return done("blocked", "BLOCKED: no Chrome or Edge found | unblocks: install Chrome or Edge, or set CHROME_PATH to chrome.exe / msedge.exe");
  if (!fs.existsSync(path.join(profileDir, "Local State"))) return done("blocked", "BLOCKED: the shared print profile has no Local State | unblocks: run node scripts/client-copy-pdf.mjs --seed-profile");
  fs.mkdirSync(path.dirname(outPath), { recursive: true }); // Chrome does not make the folder
  drop(); // stale part file
  const args = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--no-pdf-header-footer", "--print-to-pdf-no-header", "--virtual-time-budget=25000", `--print-to-pdf=${part}`, pathToFileURL(htmlPath).href];
  let child, spawnErr = null;
  try { child = spawnBrowser({ exe, dir: profileDir, args, options: { stdio: "ignore", windowsHide: true } }, io); } catch (e) { return fail(`the browser did not start (${e.message})`); }
  child.on("error", (e) => { spawnErr = e; });
  let last = -1, steady = false; const t0 = now();
  while (!spawnErr && now() - t0 <= waitMs) {
    const size = fs.existsSync(part) ? fs.statSync(part).size : 0;
    if (size > 0 && size === last) { steady = true; break; }
    last = size; await nap(stepMs);
  }
  if (spawnErr) return fail(`the browser did not start (${spawnErr.code || spawnErr.message})`);
  if (!steady) return fail(`no PDF was written in ${Math.round(waitMs / 1000)} s`);
  let buf; try { buf = fs.readFileSync(part); } catch (e) { return fail(`the print cannot be read (${e.code || e.message})`); }
  const c = checkPdf(buf);
  if (!c.ok) return fail(`the print is not a sound PDF: ${c.why}`);
  if (c.pages !== want) return fail(`the print has ${c.pages} pages, the copy has ${want} sections`);
  if (c.blank.length) return fail(`page ${c.blank[0]} of the print is blank`); // names the first blank page only
  try { fs.renameSync(part, outPath); } catch (e) { return fail(`the PDF could not be put at ${path.basename(outPath)} (${e.code || e.message}); is it open elsewhere?`); }
  return done("written", `wrote ${path.basename(outPath)} ${buf.length} bytes, pages: ${c.pages} (from ${path.basename(htmlPath)})`, { pages: c.pages, bytes: buf.length });
}

if (isMain(import.meta.url)) {
  const usage = (what) => { console.error(`client-copy-pdf: ${what}`); process.exit(2); };
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) { console.log("Usage: node scripts/client-copy-pdf.mjs <copy.html | folder> [--out <file.pdf>] | --seed-profile"); process.exit(0); }
  const opt = {}, pos = []; let seed = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") { if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) usage("--out needs a value"); opt.out = argv[++i]; }
    else if (a === "--seed-profile") seed = true;
    else if (a.startsWith("--")) usage(`unknown argument ${a}`);
    else pos.push(a);
  }
  if (seed) {
    if (argv.length !== 1) usage("--seed-profile takes no other argument");
    seedProfile(PROFILE_DIR);
    console.log(`seeded ${PROFILE_DIR}`);
    process.exit(0);
  }
  if (pos.length !== 1) usage("one <copy.html or folder> is needed");
  let htmlPath = path.resolve(pos[0]);
  if (fs.existsSync(htmlPath) && fs.statSync(htmlPath).isDirectory()) {
    htmlPath = newestHtml(htmlPath);
    if (!htmlPath) { console.error(`STOP: no copy html in ${pos[0]}`); process.exit(1); }
  }
  const outPath = opt.out ? path.resolve(opt.out) : (({ dir, name }) => path.join(dir, name + ".pdf"))(path.parse(htmlPath));
  const r = await printCopy({ htmlPath, outPath, exe: CHROME, profileDir: PROFILE_DIR });
  (r.state === "written" ? console.log : console.error)(r.line);
  process.exitCode = r.state === "written" ? 0 : r.state === "blocked" ? 3 : 1;
}
