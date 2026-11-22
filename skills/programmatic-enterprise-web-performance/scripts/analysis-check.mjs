// Usage: node analysis-check.mjs <url or profile:slug> [--analysis FILE] [--cwd DIR]
// The number guard (AB-5). The model's analysis is any JSON object (default <pewp>/analysis.json). Every TEXT value in it, at any depth, is checked; keys are not.
// A text may hold slots {{<file>#<path>}}: <file> is relative to the run's .pewp folder, <path> a field path as client-copy-data.mjs reads it (a.b[3].c).
// A slot is allowed only when <file> is a .json file named by the outputs of a step the run's profile.json calls "gathered". Refused: a digit anywhere in a
// text outside a slot, a number typed as a JSON number, a slot with no #, an empty file or path, a {{ never closed, a file that is missing or not JSON, a path
// to nothing, to null, to a list or to an object, a text longer than 200 characters, a file spelled with a backslash, a drive letter, a leading slash, . or ..
// or anything outside A-Z a-z 0-9 . _ - and /. Every refusal is listed, then "REFUSED: <n> problems; nothing was written" (exit 1) and neither output file exists.
// Passed: <pewp>/analysis.checked.json (the same JSON, each slot replaced by its value as text) and <pewp>/analysis.sheet.json (where each value came from);
// last line "ANALYSIS OK: <n> values, each from a gathered file" (exit 0). Exit 3 "BLOCKED: <what> | unblocks: <what>" when profile.json or the analysis is
// missing or not a JSON object; exit 2 usage.
// What this guard does NOT do: it calls no model and judges no sentence: it does not read what a sentence means or implies. It checks numbers and names by
// pointer, nothing else. There is no list of exempt numbers. It writes only the two output files (and removes an older copy of them).
import fs from "node:fs";
import path from "node:path";
import { isMain } from "./lib-main.mjs";
import { locate } from "./state.mjs";
import { parsePath, walk } from "./client-copy-data.mjs";

const SAFE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const MAX_TEXT = 200;
const covers = (out, file) => (out.endsWith("/") ? file.startsWith(out) : file === out);

/** Every output a step of the profile names, with whether its step is gathered. */
export function outputsOf(profile) {
  const outs = [];
  for (const st of Array.isArray(profile?.stations) ? profile.stations : []) for (const sp of Array.isArray(st?.steps) ? st.steps : []) for (const out of Array.isArray(sp?.outputs) ? sp.outputs : []) if (typeof out === "string") outs.push({ step: sp.id, out, gathered: sp.bucket === "gathered", state: sp.state });
  return outs;
}

/** { error } or { step }: is this file name one a slot may point to. */
function fileCheck(file, outs) {
  if (file.includes("\\")) return { error: "a backslash is not allowed in the file name" };
  if (/^[A-Za-z]:/.test(file)) return { error: "a drive letter is not allowed in the file name" };
  if (file.startsWith("/")) return { error: "a leading slash is not allowed in the file name" };
  if (file.split("/").some((p) => p === "." || p === "..")) return { error: "a . or .. part is not allowed in the file name" };
  if (!SAFE.test(file)) return { error: "the file name has characters outside A-Z a-z 0-9 . _ - and /" };
  if (!file.endsWith(".json")) return { error: "the file is not a .json file" };
  const hit = outs.find((o) => o.gathered && covers(o.out, file));
  if (!hit) {
    const no = outs.find((o) => !o.gathered && covers(o.out, file));
    return { error: no ? "the file belongs to step " + no.step + ", which is not gathered (" + (no.state || "no state") + ")" : "the file lies under no step's outputs" };
  }
  return { step: hit.step };
}

/** { error } or { value, measured }: what a slot's path leads to. */
function valueOf(pewp, file, p, cache) {
  if (!cache.has(file)) {
    const abs = path.join(pewp, file);
    let c;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) c = { error: "the file does not exist" };
    else { try { c = { json: JSON.parse(fs.readFileSync(abs, "utf8").replace(/^﻿/, "")), measured: fs.statSync(abs).mtime.toISOString() }; } catch { c = { error: "the file is not JSON" }; } }
    cache.set(file, c);
  }
  const c = cache.get(file);
  if (c.error) return c;
  const segs = parsePath(p);
  if (!segs.length) return { error: "the path names no field" };
  const v = walk(c.json, segs);
  if (v === undefined) return { error: "the path leads to nothing" };
  if (v === null) return { error: "the path leads to null" };
  if (Array.isArray(v)) return { error: "the path leads to a list, not a number or a text" };
  if (typeof v === "object") return { error: "the path leads to an object, not a number or a text" };
  if (typeof v === "boolean") return { error: "the path leads to a true or false, not a number or a text" };
  if (typeof v === "string" && v.length > MAX_TEXT) return { error: "the value is a text longer than " + MAX_TEXT + " characters" };
  return { value: String(v), measured: c.measured };
}

/** The whole check: { problems: [{ at, what, reason }], checked, rows }. Pure but for reading the files under pewp. */
export function checkAnalysis({ pewp, profile, analysis }) {
  const outs = outputsOf(profile), cache = new Map(), problems = [], rows = [];
  const bad = (at, what, reason) => problems.push({ at, what, reason });
  function text(s, at) {
    if (s.length > MAX_TEXT) bad(at, "a text of " + s.length + " characters", "longer than " + MAX_TEXT + " characters");
    let i = 0, outside = "", built = "", ok = true;
    for (;;) {
      const a = s.indexOf("{{", i);
      if (a < 0) { outside += s.slice(i); built += s.slice(i); break; }
      const b = s.indexOf("}}", a + 2);
      outside += s.slice(i, a) + " "; built += s.slice(i, a);
      if (b < 0) { bad(at, s.slice(a, a + 40), "{{ is never closed by }}"); ok = false; break; }
      const raw = s.slice(a, b + 2), body = s.slice(a + 2, b), h = body.indexOf("#");
      i = b + 2;
      const slotBad = (reason) => { bad(at, raw, reason); ok = false; };
      if (h < 0) { slotBad("the slot has no #"); continue; }
      const file = body.slice(0, h), p = body.slice(h + 1);
      if (file === "") { slotBad("the file is empty"); continue; }
      if (p === "") { slotBad("the path is empty"); continue; }
      const fc = fileCheck(file, outs);
      if (fc.error) { slotBad(fc.error); continue; }
      const v = valueOf(pewp, file, p, cache);
      if (v.error) { slotBad(v.error); continue; }
      built += v.value;
      rows.push({ at, pointer: file + "#" + p, file, where: p, value: v.value, measured: v.measured, step: fc.step });
    }
    const digits = outside.match(/\d+/g);
    if (/\d/.test(outside)) bad(at, "digits " + digits.join(", "), "a number must be a slot, never typed");
    return ok ? built : null;
  }
  function visit(v, at) {
    if (typeof v === "string") return text(v, at);
    if (typeof v === "number") { bad(at, String(v), "a number written as a number; it must be a slot"); return v; }
    if (Array.isArray(v)) return v.map((x, i) => visit(x, at + "[" + i + "]"));
    if (v && typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = visit(x, at + (/^[A-Za-z_]\w*$/.test(k) ? "." + k : "[" + JSON.stringify(k) + "]")); return o; }
    return v;
  }
  const checked = visit(analysis, "$");
  return { problems, checked, rows };
}

const readJson = (f) => { try { return { json: JSON.parse(fs.readFileSync(f, "utf8").replace(/^﻿/, "")) }; } catch (e) { return { error: e.code === "ENOENT" ? "is missing" : "is not JSON" }; } };
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function main() {
  const a = process.argv.slice(2);
  const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : null);
  const pos = a.filter((x, i) => !x.startsWith("--") && !["--analysis", "--cwd"].includes(a[i - 1]));
  const usage = (why) => { console.error((why ? why + "\n" : "") + "usage: node analysis-check.mjs <url or profile:slug> [--analysis FILE] [--cwd DIR]"); process.exit(2); };
  if (pos.length < 1) usage("no run was named");
  let loc; try { loc = locate(pos[0], { cwd: opt("--cwd") || process.cwd() }); } catch (e) { usage(e.message); }
  const pewp = loc.pewp, checkedF = path.join(pewp, "analysis.checked.json"), sheetF = path.join(pewp, "analysis.sheet.json");
  const rmOutputs = () => { fs.rmSync(checkedF, { force: true }); fs.rmSync(sheetF, { force: true }); };
  const blocked = (what, unblocks) => { rmOutputs(); console.log("BLOCKED: " + what + " | unblocks: " + unblocks); process.exit(3); };
  const pf = readJson(path.join(pewp, "profile.json"));
  if (pf.error || !isObj(pf.json)) blocked("profile.json " + (pf.error || "is not a JSON object"), "the client profile step writing " + path.join(pewp, "profile.json"));
  const af = opt("--analysis") ? path.resolve(opt("--analysis")) : path.join(pewp, "analysis.json");
  const an = readJson(af);
  if (an.error || !isObj(an.json)) blocked("the analysis " + af + " " + (an.error || "is not a JSON object"), "a JSON object of the analysis at " + af);
  const r = checkAnalysis({ pewp, profile: pf.json, analysis: an.json });
  if (r.problems.length) {
    rmOutputs();
    for (const p of r.problems) console.log(p.at + ": " + p.what + ": " + p.reason);
    console.log("REFUSED: " + r.problems.length + " problems; nothing was written");
    process.exit(1);
  }
  fs.writeFileSync(checkedF, JSON.stringify(r.checked, null, 1) + "\n");
  fs.writeFileSync(sheetF, JSON.stringify({ rows: r.rows }, null, 1) + "\n");
  console.log("ANALYSIS OK: " + r.rows.length + " values, each from a gathered file");
}

if (isMain(import.meta.url)) main();
