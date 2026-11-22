// AI answers asked ONCE per assistant (owner, 2026-11-15): ONE engineered prompt that holds every question and gets one reply, then ONE follow-up about
// the business by name in the same chat. The assistants are asked one after the other, never side by side. NO script asks an assistant: a person or a
// helper pastes the two texts in the owner's browser; this command builds the texts, checks what was pasted, saves each reply whole and does every count.
// Usage: node ai-oneshot.mjs <command> <url> [...] [--cwd DIR]
//   build <url> [--max-questions 8]     the two texts from business.json (kind, vocabulary, places, name) and ai-oneshot-ask.md / ai-oneshot-follow-up.md:
//                                       research/ai-oneshot-prompt.json and ai-oneshot-1.txt / -2.txt. Every question names its place in full (city, state,
//                                       country); a US place without its state is BLOCKED; the business's name or address in message 1 is REFUSED.
//   lock <url> --by "<who read both>"   the texts as read: captures/ai-oneshot/prompt-lock.json. Every later command builds the texts again and refuses
//                                       when they differ from the lock (nothing is sent or saved under a changed text).
//   clip <url> <engine> <1|2>           puts the locked text on the clipboard (Windows) and reads it back. The text is pasted, never typed.
//   box <url> <engine> <1|2> --file F | --from-clipboard     the text read back from the page's box BEFORE it is sent: BOX OK, or BOX DIFFERS (exit 1).
//   save <url> <engine> <1|2> --file F | --from-clipboard [--browser B] [--signed-in] [--mode M]     the reply, whole. Needs BOX OK for that text; message 2
//                                       needs message 1 on file; a saved reply is never overwritten (never a re-ask); a missing part is saved as it is.
//   blocked <url> <engine> --reason "sign-in wall"            an assistant that could not be read.
//   count <url> [--retire-old]          reads the saved replies with no model: research/ai-oneshot.json (per assistant and question: listed with its rank,
//                                       not listed, no list, layout not followed, not reached, other place; the classes add up to the questions asked) and
//                                       one file per COUNTED question in captures/ai/ in the form import-ai.mjs reads, so the report and the copy count
//                                       them as before. A reply about another place or one that ignored the layout is never counted as "not listed".
//                                       Older files in captures/ai/ (answers to other questions) stop the count; --retire-old moves them, unchanged, to
//                                       captures/ai-retired/.
// Engines: chatgpt, perplexity, copilot, gemini. Exit 0 = done, 1 = REFUSED (a rule above), 2 = usage, 3 = BLOCKED (something is missing).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Blocked, Usage, J, context, iso, knownPlaces } from "./research-lib.mjs";
import { relatedOf } from "./lib-related.mjs";

class Refused extends Error {}
const here = path.dirname(fileURLToPath(import.meta.url));
const ENGINES = ["chatgpt", "perplexity", "copilot", "gemini"];
const CLASSES = ["listed", "not listed", "no list", "layout not followed", "not reached", "other place"];
const MARK = "---PROMPT---";
const STATES = { AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut", DE: "delaware", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania", RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont", VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming", DC: "district of columbia" };

const sha = (s) => crypto.createHash("sha256").update(String(s), "utf8").digest("hex");
const W = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof o === "string" ? o : JSON.stringify(o, null, 1) + "\n"); };
const lf = (s) => String(s ?? "").replace(/\r\n?/g, "\n");
const norm = (s) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const normName = (s) => norm(s).replace(/\b(llc|inc|ltd|corp|co|company|pllc|llp)\b/g, " ").replace(/\s+/g, " ").trim();
const impNorm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();   // the text check of import-ai.mjs
const words = (s) => lf(s).split(/\s+/).filter(Boolean);
const firstDiff = (a, b) => { const n = Math.max(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i; return -1; };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };
const dom = (d) => String(d || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const urlsOf = (line) => (String(line).match(/https?:\/\/[^\s)|\]>"]+/g) || []).map((u) => u.replace(/[.,;]+$/, ""));
const digits = (s) => String(s || "").replace(/\D/g, "").slice(-10);
const F = (ctx) => { const dir = path.join(ctx.pewp, "captures", "ai-oneshot"); return { dir, prompt: path.join(ctx.rdir, "ai-oneshot-prompt.json"), t1: path.join(ctx.rdir, "ai-oneshot-1.txt"), t2: path.join(ctx.rdir, "ai-oneshot-2.txt"), lock: path.join(dir, "prompt-lock.json"), cap: path.join(ctx.pewp, "captures", "ai"), retired: path.join(ctx.pewp, "captures", "ai-retired"), out: path.join(ctx.rdir, "ai-oneshot.json") }; };

// ---------------------------------------------------------------- the two texts
const template = (name) => { const t = lf(fs.readFileSync(path.join(here, name), "utf8")), i = t.indexOf(MARK); if (i < 0) throw new Refused(`${name} has no ${MARK} line`); return t.slice(i + MARK.length).trim(); };
const fill = (t, map) => t.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => { if (!(k in map)) throw new Refused(`a template asks for {{${k}}}, which the command does not fill`); return map[k]; });

function compose(ctx, max) {
  const b = ctx.business;
  if (!b) throw new Blocked(`no ${path.join(ctx.pewp, "business.json")} | unblocks: run the intake first`);
  const kind = String(b.kind || "").replace(/[-_]+/g, " ").trim(), name = String(b.name || "").trim();
  if (!kind || !name) throw new Blocked("business.json has no kind or no name | unblocks: the intake sets both");
  const code = String(b.market?.country || "").trim(), us = /^(us|usa|united states)$/i.test(code);
  if (!code) throw new Blocked("business.json has no market.country: an assistant asked without the country answers for another one | unblocks: the intake sets it");
  let country = code;
  if (/^[A-Za-z]{2}$/.test(code)) { try { country = new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) || code; } catch { country = code; } }
  const seen = [...(b.rankTracking?.locations || []), ...(b.locations || []).flatMap((l) => [l.name, ...(l.serviceArea || [])])].map((x) => String(x || "").replace(/,\s*[A-Za-z]{2}$/, "").trim().toLowerCase());
  const at = (p) => { const i = seen.indexOf(p.city.toLowerCase()); return i < 0 ? seen.length : i; };
  const all = knownPlaces(b).sort((x, y) => at(x) - at(y));
  if (!all.length) throw new Blocked("business.json names no place (locations, serviceArea) | unblocks: the intake sets the places the business serves");
  for (const p of all) {
    if (us && !p.state) throw new Blocked(`the place "${p.city}" has no state, and the same city name exists in several states | unblocks: write it as "City, ST" in business.json`);
    p.full = [p.city, p.state, country].filter(Boolean).join(", ");
  }
  const places = all.slice(0, max), per = Math.max(1, Math.floor(max / places.length));
  const needs = [...new Set((b.vocabulary || []).map((v) => String(v || "").trim()).filter(Boolean))].filter((v) => norm(v) !== norm(kind) && norm(v) !== `${norm(kind)}s`);
  const questions = [];
  for (const p of places) {
    questions.push({ place: p.full, need: null, text: `In ${p.full}, which ${kind} would you recommend?` });
    for (const need of needs.slice(0, per - 1)) questions.push({ place: p.full, need, text: `In ${p.full}, who would you recommend for "${need}"?` });
  }
  questions.forEach((q, i) => { q.id = `Q${i + 1}`; });
  const fulls = places.map((p) => p.full), listed = fulls.length > 1 ? `${fulls.slice(0, -1).join("; ")} and ${fulls[fulls.length - 1]}` : fulls[0];
  const text1 = fill(template("ai-oneshot-ask.md"), { KIND: kind, PLACES: listed, QUESTIONS: questions.map((q) => `${q.id}. ${q.text}`).join("\n"), PLACE_HEADINGS: fulls.map((x) => `### ${x}`).join(", ") });
  const text2 = fill(template("ai-oneshot-follow-up.md"), { NAME: name, KIND: kind, HOME: fulls[0] });
  const t1 = ` ${norm(text1)} `, d = dom(ctx.domain);
  const leak = [name, b.shortName].map(norm).filter(Boolean).find((n) => t1.includes(` ${n} `)) || (d && text1.toLowerCase().includes(d) ? d : null);
  if (leak) throw new Refused(`message 1 would hold the business's own name or address ("${leak}"): an assistant that reads the name lists the business. Take it out of kind and vocabulary in business.json`);
  return { max, kind, name, home: fulls[0], places: places.map((p) => ({ city: p.city, state: p.state, full: p.full })), questions, dropped: { needs: needs.slice(per - 1), places: all.slice(max).map((p) => p.full) },
    text1, text2, hash1: sha(text1), hash2: sha(text2), promptHash: sha(`${text1}\n---\n${text2}`) };
}

function build(ctx, a) {
  const max = a.get("max-questions") == null ? 8 : Number(a.get("max-questions"));
  if (!Number.isInteger(max) || max < 1 || max > 10) throw new Usage("--max-questions is a whole number from 1 to 10");
  const doc = compose(ctx, max), f = F(ctx), was = J(f.prompt), same = was?.promptHash === doc.promptHash && was?.max === max, d = doc.dropped;
  if (!same) { W(f.prompt, { step: "ai-oneshot-prompt", generatedAt: iso(), ...doc }); W(f.t1, `${doc.text1}\n`); W(f.t2, `${doc.text2}\n`); }
  return `OK ai-oneshot build: ${same ? "unchanged" : "written"}; ${doc.questions.length} questions over ${doc.places.length} place(s): ${doc.places.map((p) => p.full).join("; ")}; message 1 ${doc.text1.length} characters, follow-up ${doc.text2.length}; prompt ${doc.promptHash.slice(0, 8)}`
    + (d.needs.length || d.places.length ? `\n  NOT ASKED in this run (over --max-questions ${max}): ${[...d.needs.map((x) => `"${x}"`), ...d.places].join(", ")}` : "") + `\n  -> ${f.prompt}`;
}

function lock(ctx, a) {
  const f = F(ctx), built = J(f.prompt), by = a.get("by");
  if (!built) throw new Blocked("no built prompt | unblocks: node ai-oneshot.mjs build <url>");
  if (!by) throw new Usage("lock needs --by \"<who read both texts>\"");
  const doc = compose(ctx, built.max);
  if (built.promptHash !== doc.promptHash) throw new Refused("the built prompt is older than the business file or the templates: run build again and read the new texts");
  const was = J(f.lock), replies = fs.existsSync(f.dir) ? fs.readdirSync(f.dir).filter((x) => /-[12]\.json$/.test(x)) : [];
  if (was && was.promptHash !== doc.promptHash && replies.length) throw new Refused(`${replies.length} reply file(s) answer the earlier locked prompt (${was.promptHash.slice(0, 8)}): a new prompt is a new sitting; move captures/ai-oneshot aside first`);
  W(f.lock, { ...doc, lockedAt: iso(), by });
  return `OK ai-oneshot lock: prompt ${doc.promptHash.slice(0, 8)} locked by ${by}\n  -> ${f.lock}`;
}

// ---------------------------------------------------------------- the sitting: clipboard, box check, save
function ps(script, file) {
  if (process.platform !== "win32") throw new Refused("the clipboard commands run on Windows only (the owner's machine); give the text with --file");
  for (const exe of ["pwsh", "powershell"]) {
    const r = spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, AI_ONESHOT_FILE: file }, encoding: "utf8", windowsHide: true, timeout: 20000 });
    if (r.error && r.error.code === "ENOENT") continue;
    if (r.error || r.status !== 0) throw new Refused(`the clipboard call failed (${exe}): ${String(r.error?.message || r.stderr || "").trim().slice(0, 200)}`);
    return;
  }
  throw new Refused("no PowerShell was found for the clipboard call");
}
const clipSet = (file) => ps("Set-Clipboard -Value ([IO.File]::ReadAllText($env:AI_ONESHOT_FILE))", file);
const clipGet = (file) => ps("$t = Get-Clipboard -Raw; if ($null -eq $t) { $t = '' }; [IO.File]::WriteAllText($env:AI_ONESHOT_FILE, $t, [Text.UTF8Encoding]::new($false))", file);
const tmpFile = () => path.join(os.tmpdir(), `ai-oneshot-${process.pid}.txt`);
// a rich editor (Gemini's) shows the text's "- " list marks as bullets glued to the next word: the same words, so the box check reads a bullet as "- "
const unbullet = (s) => String(s).replace(/[•◦▪‣]/g, " - ");

function input(a) {
  if (a.has("from-clipboard")) { const t = tmpFile(); clipGet(t); const s = fs.readFileSync(t, "utf8"); fs.rmSync(t, { force: true }); return s; }
  const file = a.get("file");
  if (!file) throw new Usage("give the text with --file F or --from-clipboard");
  if (!fs.existsSync(file)) throw new Usage(`${file}: file not found`);
  return fs.readFileSync(file, "utf8").replace(/^﻿/, "");
}

function turn(ctx, engine, nRaw) {
  const f = F(ctx), n = Number(nRaw), lock = J(f.lock);
  if (!ENGINES.includes(engine)) throw new Usage(`the assistant is one of ${ENGINES.join(", ")}`);
  if (n !== 1 && n !== 2) throw new Usage("the message is 1 (the prompt) or 2 (the follow-up)");
  if (!lock) throw new Blocked("the prompt is not locked | unblocks: node ai-oneshot.mjs lock <url> --by \"<who read both texts>\"");
  const cur = compose(ctx, lock.max);
  if (cur.promptHash !== lock.promptHash) throw new Refused("the prompt that would be built now differs from the locked one (the business file or a template changed): nothing is sent or saved under a changed text");
  const saved1 = fs.existsSync(path.join(f.dir, `${engine}-1.json`));
  if (n === 2 && !saved1) throw new Refused(`message 1 is not saved for ${engine} yet: the follow-up goes only after the first reply is on file`);
  return { f, n, lock, text: n === 1 ? lock.text1 : lock.text2, hash: n === 1 ? lock.hash1 : lock.hash2 };
}

function clip(ctx, a, engine, nRaw) {
  const t = turn(ctx, engine, nRaw), tmp = tmpFile();
  fs.writeFileSync(tmp, t.text); clipSet(tmp); clipGet(tmp);
  const back = lf(fs.readFileSync(tmp, "utf8")).trim(); fs.rmSync(tmp, { force: true });
  if (back !== t.text) throw new Refused("the clipboard does not hold the locked text after the copy");
  return `CLIP OK ${engine} message ${t.n}: ${t.text.length} characters on the clipboard, text ${t.hash.slice(0, 8)}. Paste it with one real Ctrl+V; never type it.`;
}

function box(ctx, a, engine, nRaw) {
  const t = turn(ctx, engine, nRaw), want = t.text, got = unbullet(input(a));
  const at = firstDiff(words(want), words(got));
  W(path.join(t.f.dir, `${engine}-${t.n}.box.json`), { engine, message: t.n, textHash: t.hash, ok: at < 0, checkedAt: iso(), differsAtWord: at < 0 ? null : at + 1 });
  if (at >= 0) throw new Refused(`BOX DIFFERS for ${engine} message ${t.n} at word ${at + 1}: the locked text has "${words(want)[at] ?? "(nothing)"}", the box has "${words(got)[at] ?? "(nothing)"}". Clear the box and paste again; do not send.`);
  return `BOX OK ${engine} message ${t.n}: the box holds the locked text word for word (${words(want).length} words). Send it.`;
}

function save(ctx, a, engine, nRaw) {
  const t = turn(ctx, engine, nRaw), bx = J(path.join(t.f.dir, `${engine}-${t.n}.box.json`));
  const boxOk = (bx?.ok === true && bx.textHash === t.hash) || a.has("owner-pasted");   // --owner-pasted: the owner pasted the text into the page himself (recorded in the file)
  if (!boxOk) throw new Refused(`the box was not checked for ${engine} message ${t.n} (no BOX OK on file for this text): a reply is saved only for a text that was checked before it was sent`);
  const out = path.join(t.f.dir, `${engine}-${t.n}.json`);
  if (fs.existsSync(out)) throw new Refused(`${engine} message ${t.n} is already saved: a reply is never overwritten and never asked again`);
  if (engine === "gemini" && !a.has("signed-in")) throw new Refused("a Gemini reply is saved with --signed-in (Gemini web without a sign-in is recorded with: blocked <url> gemini --reason \"sign-in wall\")");
  const text = lf(input(a)).trim();
  if (text.length < 200) throw new Refused(`the text is ${text.length} characters: too short to be the whole reply (copy the reply with the page's own copy button)`);
  if (firstDiff(words(text), words(t.text)) < 0) throw new Refused("this is the text that was sent, not the reply");
  W(out, { engine, message: t.n, promptHash: t.lock.promptHash, textHash: t.hash, capturedAt: iso(), browser: a.get("browser") || "owner's Edge", signedIn: a.has("signed-in"), mode: a.get("mode") || "new chat", pasted: a.has("owner-pasted") ? "by the owner, by hand" : "clipboard, box checked", answerText: text, answerSha256: sha(text) });
  let found;
  if (t.n === 1) {
    const p = parseAsk(text, t.lock), miss = t.lock.questions.filter((q, i) => !p.q.has(i + 1)).map((q) => q.id);
    found = `questions found: ${t.lock.questions.length - miss.length} of ${t.lock.questions.length}${miss.length ? ` (missing: ${miss.join(", ")})` : ""}; Part 2 ${p.sites.length ? "found" : "missing"}; Part 3 ${p.how.found ? "found" : "missing"}`;
  } else found = `rows read about the business: ${parseName(text).rows} of 12`;
  return `SAVED ${engine} message ${t.n}: ${text.length} characters, sha256 ${sha(text).slice(0, 8)}; ${found}. A missing part stays as it is: never ask again.\n  -> ${out}`;
}

function blocked(ctx, a, engine) {
  const f = F(ctx), reason = a.get("reason"), lock = J(f.lock);
  if (!ENGINES.includes(engine)) throw new Usage(`the assistant is one of ${ENGINES.join(", ")}`);
  if (!reason) throw new Usage("blocked needs --reason \"<what stopped it>\"");
  if (!lock) throw new Blocked("the prompt is not locked | unblocks: node ai-oneshot.mjs lock <url> --by \"<who read both texts>\"");
  W(path.join(f.dir, `${engine}-blocked.json`), { engine, blocked: reason, capturedAt: iso(), browser: a.get("browser") || "owner's Edge", promptHash: lock.promptHash });
  return `OK ai-oneshot blocked: ${engine} is recorded as not read (${reason})`;
}

// ---------------------------------------------------------------- reading a reply (no model)
const cleanCell = (s) => s.replace(/\*\*|__|`/g, "").replace(/\[([^\]]*)\]\((https?:[^)\s]+)\)/g, (m, t, u) => `${t} ${u}`).replace(/\s+/g, " ").trim();
// a table row as cells: a markdown row (pipes) or a row copied as plain text (tabs); the rule under a header and prose are not rows
function cells(line) {
  const t = String(line).trim(), pipes = t.includes("|"), sep = pipes ? "|" : t.includes("\t") ? "\t" : / {3,}/.test(t) ? / {3,}/ : null;
  if (!sep) return null;
  const c = t.split(sep).map(cleanCell);
  if (pipes) { if (c[0] === "") c.shift(); if (c.length && c[c.length - 1] === "") c.pop(); }
  if (c.length < 2 || c.every((x) => x === "" || /^:?-{2,}:?$/.test(x))) return null;
  return c;
}
function head(line) {
  const t = String(line).replace(/[#*_`>]/g, " ").replace(/\s+/g, " ").trim();
  let m = t.match(/^Part\s*([123])\b/i);
  if (m) return { part: Number(m[1]) };
  m = t.length < 300 ? t.match(/^Q(?:uestion)?\s*\.?\s*(\d{1,2})\b/i) : null;
  return m ? { q: Number(m[1]) } : null;
}
const isRank = (x) => /^\d{1,2}\.?$/.test(x);
// a table copied from a page as plain text (cells apart by tabs or runs of spaces) can come with its header row GLUED to the first row
// ("... | Source (full web address)1 | Name | ..."): the first row is given back, never lost
const HEAD_LAST = ["source (full web address)", "what you take from it (8 words at most)", "what it says (8 words at most)", "your answer"];
function unglue(c) {
  for (let k = 1; k < c.length; k++) {
    const low = c[k].toLowerCase(), h = HEAD_LAST.find((x) => low.startsWith(x) && low.length > x.length);
    if (h) return [c[k].slice(h.length).trim(), ...c.slice(k + 1)];
  }
  const k = c.findIndex((x, i) => i >= 2 && /\D\d{1,2}$/.test(x) && c.length - i > 2);
  return k < 0 ? null : [c[k].match(/\d{1,2}$/)[0], ...c.slice(k + 1)];
}
// the cells of a data row: null for a header row, unless the first row was glued to it
const dataRow = (c, headRe) => (c && headRe.test(c[0]) ? unglue(c) : c);

function parseAsk(text, lock) {
  const blocks = []; let cur = null;
  for (const line of lf(text).split("\n")) {
    const h = cells(line) ? null : head(line);
    if (h) { cur = { ...h, lines: [] }; blocks.push(cur); continue; }
    if (cur) cur.lines.push(line);
  }
  const q = new Map();   // question number -> its block; a number seen twice (the prompt copied with the reply) keeps the block with more rows
  for (const b of blocks.filter((x) => x.q)) {
    const rows = [];
    for (const line of b.lines) {
      const c = dataRow(cells(line), /^(rank|name)$/i);
      if (!c) continue;
      const [name, company, why] = isRank(c[0]) ? c.slice(1) : c;
      rows.push({ rank: isRank(c[0]) ? parseInt(c[0], 10) : rows.length + 1, name: name || "", company: company || "", why: why || "", urls: urlsOf(line), unknown: !name || /^unknown$/i.test(name) });
    }
    const blk = { rows, hasText: b.lines.some((l) => l.trim()), raw: b.lines.join("\n") };
    if (!q.has(b.q) || q.get(b.q).rows.length < rows.length) q.set(b.q, blk);
  }
  const pick = (k) => blocks.filter((x) => x.part === k).sort((x, y) => y.lines.length - x.lines.length)[0] || null;
  const sites = [], p2 = pick(2), p3 = pick(3), how = { found: false };
  if (p2) {
    let at = null;
    for (const line of p2.lines) {
      const raw = cells(line);
      if (!raw) { const pl = lock.places.find((x) => ` ${norm(line)} `.includes(` ${norm(x.city)} `)); if (pl) { at = { place: pl.full, rows: [] }; sites.push(at); } continue; }
      const c = dataRow(raw, /^(rank|website)$/i);
      if (!c) continue;
      if (!at) { at = { place: null, rows: [] }; sites.push(at); }
      at.rows.push({ rank: isRank(c[0]) ? parseInt(c[0], 10) : at.rows.length + 1, site: (isRank(c[0]) ? c[1] : c[0]) || "", urls: urlsOf(line) });
    }
  }
  if (p3) for (const line of p3.lines) {
    const c = dataRow(cells(line), /^item$/i);
    if (!c) continue;
    const v = c.slice(1).join(" | "); how.found = true;
    if (/\bplace\b/i.test(c[0])) how.place = v; else if (/search|memory/i.test(c[0])) how.searched = v; else if (/newest source/i.test(c[0])) how.newest = v; else if (/weigh most/i.test(c[0])) how.weighs = v; else if (/assumed/i.test(c[0])) how.assumed = v;
  }
  return { q, sites, how };
}

const KEYS = [["known", /know this business/i], ["missing", /missing or unclear/i], ["whyListed", /why they were/i], ["recommend", /would you recommend/i], ["does", /what they do/i], ["areas", /areas/i], ["company", /company/i], ["address", /^address/i], ["phone", /^phone/i], ["website", /^website/i], ["rating", /rating/i], ["knownFor", /known for/i]];
function parseName(text) {
  const out = { fields: {}, appears: [], rows: 0 }; let where = false;
  for (const line of lf(text).split("\n")) {
    const raw = cells(line);
    if (!raw) { if (/where they appear/i.test(line)) where = true; continue; }
    const c = dataRow(raw, /^(item|rank)$/i);
    if (!c) continue;
    if (where) { out.appears.push({ site: (isRank(c[0]) ? c[1] : c[0]) || "", urls: urlsOf(line), says: c[c.length - 1] }); continue; }
    const k = KEYS.find(([, re]) => re.test(c[0]))?.[0];
    if (!k || out.fields[k]) continue;
    out.fields[k] = { value: c[1] || "", urls: urlsOf(line) }; out.rows++;
  }
  return out;
}

// the business among the rows: its name as a whole phrase in the name or company cell (legal endings apart), or its own address as a source
const isClient = (row, b) => {
  const n = normName(b.name), d = dom(b.domain), hay = [row.name, row.company].map((x) => ` ${normName(x)} `);
  return (!!n && hay.some((h) => h.includes(` ${n} `))) || (!!d && row.urls.some((u) => { const h = hostOf(u); return !!h && (h === d || h.endsWith(`.${d}`)); }));
};
const textNames = (text, b) => { const n = impNorm(b.name), d = dom(b.domain); return (!!n && ` ${impNorm(text)} `.includes(` ${n} `)) || (!!d && String(text).toLowerCase().includes(d)); };
// the place the assistant says it answered for: the city, and for a place with a state its two letters (as written, capitals) or its full name
const placeOk = (place, said) => {
  const s = ` ${norm(said)} `;
  if (!place || !s.includes(` ${norm(place.city)} `)) return false;
  if (!place.state) return true;
  return new RegExp(`\\b${place.state}\\b`).test(said) || (!!STATES[place.state] && s.includes(` ${STATES[place.state]} `));
};
const verdict = (said, ours, same) => (!ours ? "not checked" : !String(said || "").trim() || /^unknown$/i.test(String(said).trim()) ? "unknown" : same(String(said), String(ours)) ? "right" : "wrong");
const siteHost = (x) => { const t = String(x).trim().split(/\s+/).find((w) => /\./.test(w)) || ""; return hostOf(/^https?:\/\//i.test(t) ? t : `https://${t}`); };

// ---------------------------------------------------------------- the count
function count(ctx, a) {
  const f = F(ctx), lock = J(f.lock), b = { name: ctx.business?.name, domain: ctx.domain, phone: ctx.business?.phone };
  if (!lock) throw new Blocked("no locked prompt, so no reply to count | unblocks: build, lock, then the sitting");
  const files = fs.existsSync(f.cap) ? fs.readdirSync(f.cap).filter((x) => /\.json$/i.test(x)) : [];
  const old = files.filter((x) => J(path.join(f.cap, x))?.promptHash !== lock.promptHash), retire = a.has("retire-old");
  if (old.length && !retire) throw new Refused(`${old.length} file(s) in captures/ai answer other questions than the locked prompt (first: ${old[0]}) and would be counted with the new ones. Run count again with --retire-old: they are moved, unchanged, to captures/ai-retired/`);
  if (retire) for (const x of old) { fs.mkdirSync(f.retired, { recursive: true }); let to = path.join(f.retired, x); for (let i = 2; fs.existsSync(to); i++) to = path.join(f.retired, x.replace(/\.json$/i, `.${i}.json`)); fs.renameSync(path.join(f.cap, x), to); }
  for (const x of files.filter((y) => !old.includes(y) && /-oneshot-/.test(y))) fs.rmSync(path.join(f.cap, x));
  const N = lock.questions.length, instead = new Map(), hosts = new Map(), siteHosts = new Map(), notes = [];
  const related = relatedOf(ctx.pewp), isRelated = (r) => !!(related.byName(r.name) || related.byName(r.company) || r.urls.some((u) => related.byDomain(u)));
  const bump = (m, k, engine) => { const v = m.get(k) || { count: 0, engines: new Set() }; v.count++; v.engines.add(engine); m.set(k, v); };
  const engines = ENGINES.map((engine) => {
    const m1 = J(path.join(f.dir, `${engine}-1.json`)), m2 = J(path.join(f.dir, `${engine}-2.json`)), bl = J(path.join(f.dir, `${engine}-blocked.json`));
    const stamp = (m) => ({ capturedAt: m.capturedAt, browser: m.browser || "owner's Edge", promptHash: lock.promptHash });
    if (!m1) {
      if (bl) W(path.join(f.cap, `${engine}-oneshot-blocked.json`), { engine, blocked: bl.blocked, ...stamp(bl) });
      return { engine, status: bl ? "blocked" : "not read", reason: bl?.blocked ?? null };
    }
    const p = parseAsk(m1.answerText, lock), placeSaid = p.how.place || "", stated = !!placeSaid.trim() && !/^unknown$/i.test(placeSaid.trim()), none = p.q.size === 0;
    const classes = {}; let written = 0;
    const questions = lock.questions.map((q, i) => {
      const blk = p.q.get(i + 1), place = lock.places.find((x) => x.full === q.place);
      const wrongPlace = stated && !placeOk(place, placeSaid);
      const rows = blk ? blk.rows : [], real = rows.filter((r) => !r.unknown), mine = real.find((r) => isClient(r, b));
      const status = !blk ? (none ? "layout not followed" : "not reached") : wrongPlace ? "other place" : real.length ? (mine ? "listed" : "not listed") : rows.length ? "no list" : blk.hasText ? "layout not followed" : "no list";
      classes[status] = (classes[status] || 0) + 1;
      const kin = [...new Set(real.filter((r) => r !== mine && isRelated(r)).map((r) => r.name))];   // a teammate or the brokerage (lib-related.mjs): never "listed instead"
      if (status === "listed" || status === "not listed") {
        const names = [...new Set(real.filter((r) => r !== mine && !isRelated(r)).map((r) => r.name))], urls = [...new Set(real.flatMap((r) => r.urls))].filter(hostOf);
        const text = real.map((r) => [r.rank, r.name, r.company, r.why, r.urls.join(" ")].join(" | ")).join("\n"), seen = textNames(text, b);   // the rows as read, one per line
        W(path.join(f.cap, `${engine}-oneshot-q${i + 1}.json`), { engine, type: "buyer", question: q.text, ...stamp(m1), signedIn: m1.signedIn === true, answerText: mine && !seen ? `${text}\n(matched as the business: ${b.name})` : text, named: !!mine, competitorsNamed: names, citedSources: urls, oneshot: { question: q.id, rank: mine ? mine.rank : null } });
        written++;
        for (const x of names) bump(instead, x, engine);
        for (const u of urls) bump(hosts, hostOf(u), engine);
        if (!mine && seen) notes.push(`note: ${engine} ${q.id}: the business's name stands outside the name and company cells; import-ai.mjs counts that answer as naming it`);
      }
      return { id: q.id, text: q.text, place: q.place, need: q.need, status, rank: mine ? mine.rank : null, rows: real.map(({ unknown, ...r }) => r), ...(kin.length ? { related: kin } : {}) };
    });
    const ordered = Object.fromEntries(CLASSES.filter((c) => classes[c]).map((c) => [c, classes[c]]));
    if (Object.values(ordered).reduce((s, v) => s + v, 0) !== N) throw new Error(`${engine}: the classes do not add up to the ${N} questions asked: ${JSON.stringify(classes)}`);
    let byName = null;
    if (m2) {
      const n = parseName(m2.answerText), fl = n.fields, known = (fl.known?.value || "").match(/\b(not sure|yes|no)\b/i)?.[1]?.toUpperCase() || null;
      // the follow-up is NOT a file in captures/ai: an assistant that is asked by name names the business, and that would count as "named" in every total
      byName = { layout: n.rows ? "read" : "layout not followed", known, recommend: (fl.recommend?.value || "").match(/\b(not sure|yes|no)\b/i)?.[1]?.toUpperCase() || null, phone: verdict(fl.phone?.value, b.phone, (x, y) => digits(x).length >= 7 && digits(x) === digits(y)), website: verdict(fl.website?.value, b.domain, (x, y) => siteHost(x) === dom(y)), fields: fl, appears: n.appears };
    }
    if (!written) W(path.join(f.cap, `${engine}-oneshot-notcounted.json`), { engine, blocked: `reply saved whole but not counted: ${Object.entries(ordered).map(([k, v]) => `${v} ${k}`).join(", ")}`, ...stamp(m1) });
    const counted = (ordered.listed || 0) + (ordered["not listed"] || 0);
    return { engine, status: "read", capturedAt: m1.capturedAt, how: p.how, placeStated: stated, classes: ordered, counted, listed: ordered.listed || 0, questions, sites: p.sites, byName };
  });
  if (!engines.some((e) => e.status !== "not read")) throw new Blocked("no reply and no blocked assistant is on file | unblocks: the sitting (clip, box, save for each assistant, one after the other)");
  const top = (m) => [...m].map(([name, v]) => ({ name, count: v.count, engines: v.engines.size })).sort((x, y) => y.count - x.count || String(x.name).localeCompare(String(y.name)));
  const read = engines.filter((e) => e.status === "read"), askedOn = read.map((e) => String(e.capturedAt).slice(0, 10)).sort()[0] || null;
  for (const e of read) for (const h of new Set(e.sites.flatMap((s) => s.rows.flatMap((r) => r.urls.map(hostOf).filter(Boolean))))) bump(siteHosts, h, e.engine);
  W(f.out, { step: "ai-oneshot", status: "ok", generatedAt: iso(), promptHash: lock.promptHash, askedOn, questions: N, engines, instead: top(instead), sources: top(hosts), sites: top(siteHosts), ownSiteNamed: !!dom(b.domain) && hosts.has(dom(b.domain)), note: "one reply from each assistant: a business left out of one reply can be in the next; no number here is a rate" });
  const line = (e) => (e.status !== "read" ? `${e.engine}: ${e.status}${e.reason ? ` (${e.reason})` : ""}`
    : `${e.engine}: the business is listed in ${e.listed} of ${e.counted} counted questions${e.questions.filter((q) => q.rank).map((q) => ` (${q.id} rank ${q.rank})`).join("")}; of ${N} asked: ${Object.entries(e.classes).map(([k, v]) => `${v} ${k}`).join(", ")}${e.placeStated ? "" : "; the place it answered for is not stated"}${e.byName ? `; by name: ${e.byName.layout === "read" ? `knows it ${e.byName.known || "?"}, phone ${e.byName.phone}, website ${e.byName.website}` : "layout not followed"}` : "; no follow-up on file"}`);
  return `OK ai-oneshot count: asked once on ${askedOn || "(no reply)"}, prompt ${lock.promptHash.slice(0, 8)}${old.length ? `; ${old.length} older file(s) moved to captures/ai-retired` : ""}\n  ${[...engines.map(line), ...notes].join("\n  ")}\n  -> ${f.out}\n  next: node import-ai.mjs <url> --cwd <skill> reads captures/ai/ as before`;
}

// ---------------------------------------------------------------- command line
const USAGE = "usage: node ai-oneshot.mjs build|lock|clip|box|save|blocked|count <url> [engine] [1|2] [--file F | --from-clipboard] [--by WHO] [--reason WHY] [--retire-old] [--signed-in] [--browser B] [--mode M] [--max-questions N] [--cwd DIR]";
const FLAGS = new Set(["retire-old", "signed-in", "from-clipboard", "owner-pasted"]), CMDS = { build, lock, clip, box, save, blocked, count };
try {
  const argv = process.argv.slice(2), pos = [], opt = new Map();
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (!x.startsWith("--")) { pos.push(x); continue; }
    if (FLAGS.has(x.slice(2))) opt.set(x.slice(2), true);
    else { if (i + 1 >= argv.length) throw new Usage(`${x} needs a value`); opt.set(x.slice(2), argv[++i]); }
  }
  const a = { get: (k) => (opt.has(k) && opt.get(k) !== true ? opt.get(k) : null), has: (k) => opt.get(k) === true }, [cmd, target, engine, nRaw] = pos;
  if (!cmd || !target || !Object.hasOwn(CMDS, cmd)) throw new Usage(cmd && !Object.hasOwn(CMDS, cmd) ? `unknown command "${cmd}"` : "a command and the site's address are needed");
  console.log(CMDS[cmd](context(target, { cwd: a.get("cwd") || process.cwd() }), a, engine, nRaw));
} catch (e) {
  if (e instanceof Usage) { console.error(`${e.message}\n${USAGE}`); process.exit(2); }
  if (e instanceof Blocked) { console.log(`BLOCKED: ${e.message}`); process.exit(3); }
  if (e instanceof Refused) { console.log(`REFUSED: ${e.message}`); process.exit(1); }
  throw e;
}
