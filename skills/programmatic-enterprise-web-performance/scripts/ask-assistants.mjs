// The assistants, asked by a script (owner, 2026-11-22): for each assistant, one after the other, the locked text 1 and then the locked text 2 in the SAME
// chat of the work browser (a browser on a debugging port). The texts are pasted (one Input.insertText), never typed; ai-oneshot.mjs does every check and every
// save (box, save, blocked). No model is called. An assistant is never asked twice, a robot check is never passed (a 24 h stop, nothing clicked), a sign-in
// form is never typed into, and no chat history or side list is read: the script reads only the page's own composer, send, reply, busy and mode elements, and the
// whole page's text ONLY to test for a robot check or a sign-in wall (tested and thrown away, never written or printed).
// Usage: node ask-assistants.mjs <url> [--engines a,b] [--engines-file F] [--port N] [--cwd DIR]
//   work-browser-engines.json: per engine { url, mode, signedIn, freshContext, composer, send, reply, busy, modeProof, modeSteps, capSeconds }; optional quietSeconds
//   (how long the reply must stay unchanged, default 5). "selectors": "NOT SET" = no page description yet: blocked, nothing opened.
// Exit 0 = at least one assistant ended read or already asked, the others read, already asked or recorded blocked (the ASKED line says which). 2 = usage. 3 = BLOCKED (no work browser, no lock, or no assistant could be asked).
// Whatever ai-oneshot.mjs refuses (no lock, a changed text) ends the run with its own line and exit code, nothing sent; the one exception is a reply that save refuses (exit 1):
// for message 1 that assistant is recorded blocked ('reply refused: ...') and the run goes on, for message 2 the line says 'read, follow-up refused: ...' and the run goes on.
// When no assistant of the run ended read or already asked, the last line is BLOCKED: no assistant could be asked (...) and the exit is 3; every reason an active stop adds ' | outside: stop'.
// Never change the exit, the profile, the user agent, the timing or the way a tab is opened in order to get past a check: that is evasion and is not ours to do. A check is recorded and its source is not gathered.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { connect, openPage, evalIn, closePage, settle, looksLikeRobotCheck, aiWallReason } from "./vantage.mjs";
import { isStopped, writeStop } from "./lib-stops.mjs";
import { context } from "./research-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BROWSER_WORDS = "work browser (Edge, US exit)";
const USAGE = "usage: node ask-assistants.mjs <url> [--engines a,b] [--engines-file F] [--port N] [--cwd DIR]";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ROBOT_WORDS = /just a moment|verifying you are human|verify you are (?:a )?human|checking your browser|attention required/i;   // a robot check's title or text
class Stop extends Error { constructor(line, code) { super(line); this.line = line; this.code = code; } }

// ---------------------------------------------------------------- the page-side reader (handed to evalIn): the last element matching sel, as text the counter can read
function readerInPage(sel) {
  const els = document.querySelectorAll(sel), root = els[els.length - 1];
  if (!root) return "";
  const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "UL", "OL", "TABLE", "THEAD", "TBODY", "BLOCKQUOTE", "PRE"]);
  const walk = (n) => {
    if (n.nodeType === 3) return n.textContent.replace(/\s+/g, " ");
    if (n.nodeType !== 1) return "";
    const t = n.tagName, kids = () => Array.from(n.childNodes).map(walk).join("");
    if (t === "SCRIPT" || t === "STYLE") return "";
    if (/^H[1-6]$/.test(t)) return "\n" + "#".repeat(Number(t[1])) + " " + kids().trim() + "\n";
    if (t === "TR") {
      const cells = Array.from(n.children), line = "\n| " + cells.map((c) => walk(c).replace(/\s+/g, " ").trim()).join(" | ") + " |\n";
      return cells.length && cells.every((c) => c.tagName === "TH") ? line + "|" + cells.map(() => "---|").join("") + "\n" : line;
    }
    if (t === "LI") { const p = n.parentElement, mark = p && p.tagName === "OL" ? (Array.from(p.children).indexOf(n) + 1) + ". " : "- "; return "\n" + mark + kids().trim() + "\n"; }
    if (t === "A") {
      const text = kids().trim(), href = n.href || "";
      if (!href || text === href || text.replace(/\/$/, "") === href.replace(/\/$/, "")) return text;
      return text + " [" + href + "]";
    }
    if (t === "BR") return "\n";
    return BLOCK.has(t) ? "\n" + kids() + "\n" : kids();
  };
  return walk(root).replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------- the command line
const argv = process.argv.slice(2), pos = [], opt = new Map();
try {
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) { pos.push(argv[i]); continue; }
    if (i + 1 >= argv.length) throw new Stop(argv[i] + " needs a value\n" + USAGE, 2);
    opt.set(argv[i].slice(2), argv[++i]);
  }
  if (pos.length !== 1) throw new Stop("the site's address is needed\n" + USAGE, 2);
} catch (e) { console.error(e.line); process.exit(e.code); }
const url = pos[0], cwd = opt.get("cwd") || process.cwd();
let cdp = null;

const oneshot = (args) => {
  const r = spawnSync(process.execPath, [path.join(here, "ai-oneshot.mjs"), ...args, "--cwd", cwd], { encoding: "utf8", windowsHide: true, timeout: 60000 });
  return { code: r.status, out: String(r.stdout || "") + String(r.stderr || "") };
};
const refused = (r) => new Stop(r.out.trim().split("\n")[0] || "ai-oneshot.mjs failed", r.code || 1);   // its own line and exit code

async function main() {
  const file = opt.get("engines-file") || path.join(here, "work-browser-engines.json");
  let all;
  try { all = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")); } catch (e) { throw new Stop("cannot read " + file + ": " + e.message, 2); }
  const names = opt.has("engines") ? opt.get("engines").split(",").map((s) => s.trim()).filter(Boolean) : Object.keys(all);
  const unknown = names.filter((n) => !Object.hasOwn(all, n));
  if (!names.length || unknown.length) throw new Stop("the engines file has no engine " + (unknown.join(", ") || "(none given)") + "; it has " + Object.keys(all).join(", ") + "\n" + USAGE, 2);

  let port = opt.has("port") ? Number(opt.get("port")) : null;
  if (opt.has("port") && !Number.isInteger(port)) throw new Stop("--port is a whole number\n" + USAGE, 2);
  if (!port) {
    try { port = Number(await (await import("./work-browser.mjs")).workPort()) || null; } catch { port = null; }
    if (!port) throw new Stop("BLOCKED: the work browser is not open | unblocks: node work-browser.mjs open", 3);
  }

  const ctx = context(url, { cwd }), dirOf = path.join(ctx.pewp, "captures", "ai-oneshot"), lockFile = path.join(dirOf, "prompt-lock.json");
  if (!fs.existsSync(lockFile)) throw new Stop("BLOCKED: the prompt is not locked | unblocks: node ai-oneshot.mjs lock <url> --by \"<who read both texts>\"", 3);
  const lock = JSON.parse(fs.readFileSync(lockFile, "utf8").replace(/^﻿/, "")), texts = { 1: lock.text1, 2: lock.text2 };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ask-assistants-"));
  const getCdp = async () => {
    if (cdp) return cdp;
    try { cdp = await connect(port); } catch (e) { throw new Stop("BLOCKED: the work browser does not answer on port " + port + " (" + e.message + ") | unblocks: node work-browser.mjs open", 3); }
    return cdp;
  };
  const why = new Map();   // per assistant ended blocked: its reason, and the stop's until when the reason is an active stop
  const block = (name, reason, until = null) => {
    const r = oneshot(["blocked", url, name, "--reason", reason, "--browser", BROWSER_WORDS]);
    if (r.code !== 0) throw refused(r);
    why.set(name, { reason, until });
    return "blocked (" + reason + ")";
  };

  async function askEngine(name) {
    const sp = all[name], first = path.join(dirOf, name + "-1.json");
    const stop = isStopped(name);
    if (stop) return block(name, stop.reason, stop.until);
    if (fs.existsSync(first)) return "already asked";
    if (sp.selectors === "NOT SET") return block(name, "page description not set");
    const cap = Number(sp.capSeconds) > 0 ? Number(sp.capSeconds) : 300, quietMs = (Number(sp.quietSeconds) > 0 ? Number(sp.quietSeconds) : 5) * 1000;
    const c = await getCdp();
    let tab = null, ctxId = null;
    try {
      if (sp.freshContext) {   // a new browser context with no cookies
        ctxId = (await c.send("Target.createBrowserContext")).browserContextId;
        const { targetId } = await c.send("Target.createTarget", { url: "about:blank", browserContextId: ctxId });
        const { sessionId } = await c.send("Target.attachToTarget", { targetId, flatten: true });
        tab = { sessionId, targetId };
        await c.send("Page.enable", {}, sessionId);
        const loaded = new Promise((res) => { const l = (m) => { if (m.sessionId === sessionId && m.method === "Page.loadEventFired") { c.listeners.delete(l); res(true); } }; c.listeners.add(l); setTimeout(() => { c.listeners.delete(l); res(false); }, 30000); });
        await c.send("Page.navigate", { url: sp.url }, sessionId); await loaded;
      } else tab = await openPage(c, sp.url);
      const sid = tab.sessionId, ev = (x) => evalIn(c, sid, x), q = (s) => JSON.stringify(s);
      try { await c.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sid); } catch { /* an older browser: the page still takes the paste */ }
      const has = async (sel) => !!sel && await ev("!!document.querySelector(" + q(sel) + ")");
      const click = async (sel) => {   // a real mouse click on the middle of the element
        const pt = await ev("(() => { const e = document.querySelector(" + q(sel) + "); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
        if (!pt) return false;
        await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y }, sid);
        await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 }, sid);
        await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 }, sid);
        return true;
      };
      const quiet = (ms, capMs) => settle(() => ev("document.readyState + ':' + document.getElementsByTagName('*').length"), { quietMs: ms, capMs, pollMs: 300 });   // the page's element count, not its text
      await quiet(1500, 30000);

      // d, e: a robot check or a sign-in wall. The page text is tested here and thrown away.
      const here1 = await ev("location.href"); let pageText = await ev("document.body ? document.body.innerText : ''");
      let title = await ev("document.title");   // the title is tested and thrown away like the text
      const wall = aiWallReason(here1, pageText, 0), robot = looksLikeRobotCheck(here1, pageText) || wall === "bot wall or CAPTCHA" || wall === "robot check" || ROBOT_WORDS.test(title) || ROBOT_WORDS.test(pageText);
      pageText = null; title = null;
      if (robot) {
        const st = writeStop({ engine: name, hosts: [new URL(sp.url).hostname], reason: "robot check", setBy: "ask-assistants.mjs", evidence: sp.url });
        return block(name, "robot check", st.stop.until);
      }
      const composerThere = await has(sp.composer);
      if (wall || (!composerThere && await has("input[type=password], input[type=email], input[autocomplete=username]"))) return block(name, "sign-in wall");
      if (!composerThere) return block(name, "no message box found");

      // f: the temporary chat must be on
      const modeOn = () => has(sp.modeProof);
      if (!(await modeOn())) {
        for (const s of sp.modeSteps || []) { if (!(await click(s))) break; await sleep(500); }
        await quiet(1000, 10000);
        if (!(await modeOn())) return block(name, "temporary chat not confirmed");
      }

      for (const n of [1, 2]) {
        // g: one paste, the box read back, the box check
        await ev("document.querySelector(" + q(sp.composer) + ").focus()");
        const text = texts[n];
        await c.send("Input.insertText", { text }, sid);
        const boxFile = path.join(tmp, name + "-" + n + "-box.txt");
        fs.writeFileSync(boxFile, await ev("(() => { const e = document.querySelector(" + q(sp.composer) + "); return !e ? '' : (typeof e.value === 'string' ? e.value : e.innerText); })()"));
        const bx = oneshot(["box", url, name, String(n), "--file", boxFile]);
        if (bx.code !== 0) {
          if (bx.code === 1 && /BOX DIFFERS/.test(bx.out)) return block(name, "the box did not hold the text");
          throw refused(bx);
        }
        // h: send, wait for the reply to stop changing
        const before = Number(await ev("document.querySelectorAll(" + q(sp.reply) + ").length"));
        if (!(await click(sp.send))) return block(name, "send button not found");
        const state = () => ev("(() => { const els = document.querySelectorAll(" + q(sp.reply) + "), l = els[els.length - 1]; return JSON.stringify([" + (sp.busy ? "!!document.querySelector(" + q(sp.busy) + ")" : "false") + ", els.length, l ? l.innerText : '']); })()");
        const w = await settle(state, { quietMs, capMs: cap * 1000, pollMs: 500, ready: (s) => { const [b, k] = JSON.parse(s); return !b && k > before; } });
        const [, k, said] = JSON.parse(w.text);
        if (k <= before || !String(said).trim()) return block(name, "no reply in " + cap + " s");
        // i: the reply, read by the page-side reader, saved by ai-oneshot
        const replyFile = path.join(tmp, name + "-" + n + "-reply.txt");
        fs.writeFileSync(replyFile, await ev("(" + readerInPage.toString() + ")(" + q(sp.reply) + ")"));
        const sv = oneshot(["save", url, name, String(n), "--file", replyFile, "--browser", BROWSER_WORDS, "--mode", sp.mode, ...(sp.signedIn ? ["--signed-in"] : [])]);
        if (sv.code !== 0) {
          if (sv.code !== 1) throw refused(sv);   // a reply ai-oneshot will not take ends this assistant, not the run
          const line = sv.out.trim().split("\n")[0] || "ai-oneshot.mjs failed";
          if (n === 1) return block(name, "reply refused: " + line);
          return "read, follow-up refused: " + line;
        }
      }
      return "read";
    } finally {
      if (tab) await closePage(c, tab.targetId);
      if (ctxId) { try { await c.send("Target.disposeBrowserContext", { browserContextId: ctxId }); } catch { /* gone with the browser */ } }
    }
  }

  const outcomes = [];
  try {
    for (const name of names) outcomes.push([name, await askEngine(name)]);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  console.log("ASKED: " + outcomes.map(([n, o]) => n + " " + o).join(", "));
  if (!outcomes.some(([, o]) => o === "already asked" || o.startsWith("read"))) {
    const reasons = outcomes.map(([n]) => n + ": " + (why.get(n)?.until ? why.get(n).reason + ", stopped until " + why.get(n).until : why.get(n)?.reason)), allStops = outcomes.every(([n]) => why.get(n)?.until);
    throw new Stop("BLOCKED: no assistant could be asked (" + reasons.join(", ") + ") | unblocks: the stops end or the owner lifts them; the page descriptions are set" + (allStops ? " | outside: stop" : ""), 3);
  }
}

try { await main(); if (cdp) cdp.close(); process.exit(0); }
catch (e) {
  if (cdp) cdp.close();
  if (e instanceof Stop) { (e.code === 2 ? console.error : console.log)(e.line); process.exit(e.code); }
  console.error(e.stack || e); process.exit(1);
}
