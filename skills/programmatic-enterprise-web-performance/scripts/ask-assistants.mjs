// The assistants, asked by a script (owner, 2026-11-22): for each assistant, one after the other, the locked text 1 and then the locked text 2 in the SAME
// chat of the work browser (a browser on a debugging port). The texts go in by Input.insertText in small pieces at the fixed pace below, never by key presses; ai-oneshot.mjs does every check and every
// save (box, save, blocked). No model is called. An assistant is never asked twice, a robot check is never passed (a 24 h stop, nothing clicked; a HUMAN check on ChatGPT and Perplexity is rung to the owner first, see below), a sign-in
// form is never typed into, and no chat history or side list is read: the script reads only the page's own composer, send, reply, busy and mode elements, and the
// whole page's text ONLY to test for a robot check or a sign-in wall (tested and thrown away, never written or printed).
// THE PACE (owner, 2026-11-22 10:20, M250: "properly pace the browser driving in order for it to not trigger these checks"; the head of operations' reading binds).
// The pace is a fixed design, not a reaction: one tab at a time, one assistant at a time, a steady typing rate and reading pauses, the two texts in one chat and nothing
// more per assistant per audit, minutes between assistants, no reload, no retry. The numbers are ONE block, "pace", in work-browser-engines.json beside the engines:
//   tabsAtOnce 1 | afterLoadSeconds (after a page has loaded, before anything else) | typeCharactersPerSecond (a text goes into the box in pieces of that many characters,
//   one piece each second, in order) | beforeSendSeconds (before each send) | readSecondsPer100Words, readSecondsMin, readSecondsMax (after the first reply is whole: its words / 100
//   x readSecondsPer100Words seconds, never under the least, never over the most; then the second text) | betweenAssistantsSeconds (after one assistant's tab is closed, before the next page is loaded).
// The block is read once at the start and checked before any page is loaded (exit 2, the key named); nothing changes a wait or the rate afterwards, not a check, not a stop,
// not a refused reply, and no flag and no environment variable can. Every wait goes through io.sleep (lib-ask-pace.mjs), which only the test replaces. No wait has a jitter: fixed numbers anyone can read in the file.
// The pace pretends nothing and the pace is the same before and after any check. What pace is NOT: no changed or invented user agent, no stealth patch, no faked pointer movement,
// no changed exit, no fresh profile to look new: those disguise a script and are not ours. A check that shows anyway is the hard stop, except the first human check of a run on a host that rings (below).
// A HUMAN CHECK (owner, 2026-11-22 11:43, M255: "why does it stop when I saw GPT waiting for the human verification I checked the button"; the head of operations' ruling binds):
//   an engine of the engines file may carry "humanCheck": "ring" (chatgpt, perplexity) or "stop" (gemini; absent means stop; any other value is exit 2 before any page is loaded).
//   On "ring", when a human check shows in the scripted tab the run stops ALL typing and clicking in that tab (no Input, no focus, no scroll, no navigation, no reload), brings the tab to the front once,
//   rings the owner once (io.ring) and waits up to checkWaitSeconds, looking (read only) every checkLookSeconds. It never points at, focuses or keys the check. If HE answers it the run goes on at the same
//   pace (afterLoadSeconds, one more look, then where it was); if nobody does the source is NOT GATHERED (blocked, no stop) and the audit goes on. Once per run and host: a second showing in the same run, or
//   a check that comes straight back after he answered, means the host objects: the tab is closed, a 24 h stop, no second ring. Still never ours: answering a check by script, and any change of exit, profile,
//   user agent or timing to get past one. On every other engine (gemini, any other host) the old rule holds: close, no retry, a 24 h stop on the first showing.
//   Two looks, both read only: at load the whole test (title, text, address); later (before every piece, before the click on send, when the wait for a reply has ended) the title or a check frame, never the page text.
//   captures/ai-oneshot/<engine>-check.json records every showing: { engine, host, shownAt, stage, rang, answered, waitedSeconds, secondShowing }.
// The tab is opened plainly (openPlain of vantage.mjs): no permission is granted and no location is set.
// The limit (2026-11-22 08:51): ChatGPT challenged a scripted tab on its first page load, before any typing, so pace does not change that host's answer.
// Usage: node ask-assistants.mjs <url> [--engines a,b] [--engines-file F] [--port N] [--cwd DIR]
//   work-browser-engines.json: the "pace" block above, and per engine { url, mode, signedIn, freshContext, composer, send, reply, busy, modeProof, modeSteps, capSeconds }; optional quietSeconds
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
import { connect, openPlain, evalIn, closePage, settle, looksLikeRobotCheck, aiWallReason } from "./vantage.mjs";
import { isStopped, writeStop } from "./lib-stops.mjs";
import { context } from "./research-lib.mjs";
import { io, pause, checkPace, pieces, readingSeconds, wordCount, PaceError } from "./lib-ask-pace.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BROWSER_WORDS = "work browser (Edge, US exit)";
const USAGE = "usage: node ask-assistants.mjs <url> [--engines a,b] [--engines-file F] [--port N] [--cwd DIR]";
const FLAGS = new Set(["engines", "engines-file", "port", "cwd"]);   // no other flag: none of them changes the pace
const ROBOT_WORDS = /just a moment|verifying you are human|verify you are (?:a )?human|checking your browser|attention required/i;   // a robot check's title or text
const CHECK_FRAME = 'iframe[src*="challenges.cloudflare.com"], iframe[src*="hcaptcha.com"], iframe[src*="recaptcha"], iframe[title*="challenge" i]';   // a check frame in the page: seen as an element, its inside is never read
const HUMAN_CHECK = new Set(["ring", "stop"]);   // an engine's "humanCheck"; absent means "stop"
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
    if (!FLAGS.has(argv[i].slice(2))) throw new Stop("unknown option " + argv[i] + " (no flag changes the pace; it is the pace block of the engines file)\n" + USAGE, 2);
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
  let pace;   // read once, here, and checked before any page is loaded; nothing below changes it
  try { pace = checkPace(all.pace); } catch (e) { if (e instanceof PaceError) throw new Stop(e.message + " (key: " + e.key + ")\n" + USAGE, 2); throw e; }
  const engineNames = Object.keys(all).filter((k) => k !== "pace");
  const names = opt.has("engines") ? opt.get("engines").split(",").map((s) => s.trim()).filter(Boolean) : engineNames;
  const unknown = names.filter((n) => !engineNames.includes(n));
  if (!names.length || unknown.length) throw new Stop("the engines file has no engine " + (unknown.join(", ") || "(none given)") + "; it has " + engineNames.join(", ") + "\n" + USAGE, 2);

  for (const n of names) {   // before any page is loaded
    const v = all[n] && all[n].humanCheck;
    if (v !== undefined && !HUMAN_CHECK.has(v)) throw new Stop("the engine " + n + " has humanCheck " + JSON.stringify(v) + ": it is \"ring\" or \"stop\" (or absent, which means stop)\n" + USAGE, 2);
  }

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

  const shownHosts = new Map();   // host -> "unanswered" | "answered": a human check was shown on it in this run (once per run and host)
  let opened = false;   // a page of an earlier assistant was loaded: the next page waits betweenAssistantsSeconds after that tab is closed
  async function askEngine(name) {
    const sp = all[name], first = path.join(dirOf, name + "-1.json");
    const stop = isStopped(name);
    if (stop) return block(name, stop.reason, stop.until);
    if (fs.existsSync(first)) return "already asked";
    if (sp.selectors === "NOT SET") return block(name, "page description not set");
    const cap = Number(sp.capSeconds) > 0 ? Number(sp.capSeconds) : 300, quietMs = (Number(sp.quietSeconds) > 0 ? Number(sp.quietSeconds) : 5) * 1000;
    if (opened) await pause(pace.betweenAssistantsSeconds, "between assistants");
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
      } else tab = await openPlain(c, sp.url);
      opened = true;
      await pause(pace.afterLoadSeconds, "after load");
      const sid = tab.sessionId, ev = (x) => evalIn(c, sid, x), q = (s) => JSON.stringify(s);
      try { await c.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sid); } catch { /* an older browser: the page still takes the paste */ }
      const has = async (sel) => !!sel && await ev("!!document.querySelector(" + q(sel) + ")");
      // an element is brought into view on its own, and the page is given 120 ms for its scroll event, BEFORE the click, so the click itself sends no scroll. This is tidier, not a fix of
      // anything seen: a scroll that a test saw 38 ms after a check appeared (2026-11-22) turned out to be the invented page's own text box scrolling itself back, not ours.
      const bring = (sel) => ev("(async () => { const e = document.querySelector(" + q(sel) + "); if (!e) return false; e.scrollIntoView({ block: 'center' }); await new Promise((r) => setTimeout(r, 120)); return true; })()");
      const click = async (sel) => {   // a real mouse click on the middle of the element, where it is now
        const pt = await ev("(() => { const e = document.querySelector(" + q(sel) + "); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
        if (!pt) return false;
        await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y }, sid);
        await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 }, sid);
        await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 }, sid);
        return true;
      };
      const quiet = (ms, capMs) => settle(() => ev("document.readyState + ':' + document.getElementsByTagName('*').length"), { quietMs: ms, capMs, pollMs: 300 });   // the page's element count, not its text
      await quiet(1500, 30000);

      // d, e: a robot check or a sign-in wall. The page text is tested here and thrown away. Everything the looks do is read only.
      const host = new URL(sp.url).hostname, rings = sp.humanCheck === "ring", recFile = path.join(dirOf, name + "-check.json");
      let wall = null, stage = "load", rec = null, savedFirst = false, origin = null;
      const loadLook = async () => {   // the look at load: address, text and title
        const here1 = await ev("location.href"); let pageText = await ev("document.body ? document.body.innerText : ''");
        let title = await ev("document.title");   // the title is tested and thrown away like the text
        wall = aiWallReason(here1, pageText, 0);
        const robot = looksLikeRobotCheck(here1, pageText) || wall === "bot wall or CAPTCHA" || wall === "robot check" || ROBOT_WORDS.test(title) || ROBOT_WORDS.test(pageText);
        pageText = null; title = null;
        return robot;
      };
      const laterLook = async () => ROBOT_WORDS.test(String(await ev("document.title"))) || await has(CHECK_FRAME);   // the later look: the title, or a check frame; never the page text (a reply may hold those words)
      const shows = async (look) => { try { return await look(); } catch { return null; } };   // null: the page could not be read just now (a page that loads again)
      const writeRec = () => fs.writeFileSync(recFile, JSON.stringify(rec, null, 2) + "\n");
      const hardStop = (reason) => { const st = writeStop({ engine: name, hosts: [host], reason: "robot check", setBy: "ask-assistants.mjs", evidence: sp.url }); return block(name, reason, st.stop.until); };
      // a check shows. Returns null when a person answered it and the page is clear again, else the outcome of this assistant. Nothing is sent to the tab until the check is gone.
      const onCheck = async (look) => {
        const second = shownHosts.has(host), was = shownHosts.get(host);
        if (!rec) rec = { engine: name, host, shownAt: new Date().toISOString(), stage, rang: false, answered: null, waitedSeconds: 0, secondShowing: false };
        rec.stage = stage; rec.secondShowing = second; writeRec();
        if (!rings) return hardStop("robot check");
        if (second) return hardStop(was === "answered" ? "robot check shown again after a person answered it" : "robot check");
        shownHosts.set(host, "unanswered");
        try { await c.send("Page.bringToFront", {}, sid); } catch { /* the tab is shown or it is not; nothing else is sent */ }
        console.log("RING: " + name + " shows a human check: answer it in the work browser window; the run waits up to " + pace.checkWaitSeconds + " s and sends nothing to that tab");
        io.ring(name);
        rec.rang = true; writeRec();
        let waited = 0, clear = false;
        while (waited < pace.checkWaitSeconds) {
          const w = Math.min(pace.checkLookSeconds, pace.checkWaitSeconds - waited);
          await pause(w, "human check"); waited += w;
          if ((await shows(look)) === false) { clear = true; break; }
        }
        rec.waitedSeconds = waited;
        if (!clear) { rec.answered = false; writeRec(); return block(name, "human check not answered in " + pace.checkWaitSeconds + " s"); }
        shownHosts.set(host, "answered"); rec.answered = true; writeRec();
        await pause(pace.afterLoadSeconds, "after check");
        const again = await shows(look);
        if (again === null) return block(name, "the page could not be read after a human check");
        if (again === true) { rec.secondShowing = true; writeRec(); return hardStop("robot check shown again after a person answered it"); }
        console.log("CHECK: " + name + " showed a human check and a person answered it after " + waited + " s");
        return null;
      };
      // the later look, taken before every piece, before the click on send and when the wait for a reply has ended. null: no check; true: a check was answered and it is the same page; a string: the outcome.
      const guard = async (st) => {
        stage = st;
        if (!(await laterLook())) return null;
        const out = await onCheck(laterLook);
        if (out) return out;
        const o = Number(await ev("performance.timeOrigin"));
        if (origin !== null && o !== origin) return savedFirst ? "read, follow-up not asked: the page was reloaded by a human check" : block(name, "the page was reloaded by a human check");
        return true;
      };
      const robot = await loadLook();
      if (robot) { const out = await onCheck(loadLook); if (out) return out; }   // answered: the sign-in and message-box tests below read the one more look
      const composerThere = await has(sp.composer);
      if (wall || (!composerThere && await has("input[type=password], input[type=email], input[autocomplete=username]"))) return block(name, "sign-in wall");
      if (!composerThere) return block(name, "no message box found");

      // f: the temporary chat must be on
      const modeOn = () => has(sp.modeProof);
      if (!(await modeOn())) {
        for (const s of sp.modeSteps || []) { const gm = await guard("load"); if (gm && gm !== true) return gm; if (!(await bring(s)) || !(await click(s))) break; await pause(0.5, "mode step"); }
        await quiet(1000, 10000);
        if (!(await modeOn())) return block(name, "temporary chat not confirmed");
      }

      origin = Number(await ev("performance.timeOrigin"));   // a page that is loaded again by a later check is told by this number changing
      const focusBox = () => ev("document.querySelector(" + q(sp.composer) + ").focus()");
      for (const n of [1, 2]) {
        // g: the text in pieces at the fixed rate, one piece each second, the box read back, the box check
        const g0 = await guard("typing " + n); if (g0 && g0 !== true) return g0;
        await focusBox();
        const text = texts[n];
        for (const piece of pieces(text, pace.typeCharactersPerSecond)) {
          let g = await guard("typing " + n); if (g && g !== true) return g;
          if (g === true) await focusBox();   // a person answered a check: the box is pointed at again, now that the check is gone
          await c.send("Input.insertText", { text: piece }, sid);
          await pause(1, "piece");
        }
        const boxFile = path.join(tmp, name + "-" + n + "-box.txt");
        fs.writeFileSync(boxFile, await ev("(() => { const e = document.querySelector(" + q(sp.composer) + "); return !e ? '' : (typeof e.value === 'string' ? e.value : e.innerText); })()"));
        const bx = oneshot(["box", url, name, String(n), "--file", boxFile]);
        if (bx.code !== 0) {
          if (bx.code === 1 && /BOX DIFFERS/.test(bx.out)) return block(name, "the box did not hold the text");
          throw refused(bx);
        }
        // h: send, wait for the reply to stop changing
        const gb = await guard("send " + n); if (gb && gb !== true) return gb;
        if (!(await bring(sp.send))) return block(name, "send button not found");
        await pause(pace.beforeSendSeconds, "before send");
        const gs = await guard("send " + n); if (gs && gs !== true) return gs;
        const before = Number(await ev("document.querySelectorAll(" + q(sp.reply) + ").length"));
        if (!(await click(sp.send))) return block(name, "send button not found");
        const state = () => ev("(() => { const els = document.querySelectorAll(" + q(sp.reply) + "), l = els[els.length - 1]; return JSON.stringify([" + (sp.busy ? "!!document.querySelector(" + q(sp.busy) + ")" : "false") + ", els.length, l ? l.innerText : '']); })()");
        const w = await settle(state, { quietMs, capMs: cap * 1000, pollMs: 500, ready: (s) => { const [b, k] = JSON.parse(s); return !b && k > before; } });
        const gr = await guard("reply " + n); if (gr && gr !== true) return gr;
        const [, k, said] = JSON.parse(w.text);
        if (k <= before || !String(said).trim()) return block(name, "no reply in " + cap + " s");
        // i: the reply, read by the page-side reader, saved by ai-oneshot
        const replyFile = path.join(tmp, name + "-" + n + "-reply.txt");
        const replyText = await ev("(" + readerInPage.toString() + ")(" + q(sp.reply) + ")");
        fs.writeFileSync(replyFile, replyText);
        const sv = oneshot(["save", url, name, String(n), "--file", replyFile, "--browser", BROWSER_WORDS, "--mode", sp.mode, ...(sp.signedIn ? ["--signed-in"] : [])]);
        if (sv.code !== 0) {
          if (sv.code !== 1) throw refused(sv);   // a reply ai-oneshot will not take ends this assistant, not the run
          const line = sv.out.trim().split("\n")[0] || "ai-oneshot.mjs failed";
          if (n === 1) return block(name, "reply refused: " + line);
          return "read, follow-up refused: " + line;
        }
        if (n === 1) savedFirst = true;
        if (n === 1) await pause(readingSeconds(wordCount(replyText), pace), "reading");   // the reply is read before the second text goes in
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
  // ONE record per run, on exit 0 and on exit 3 (the step ai-ask's evidence): a run in which every assistant was "already asked" still leaves new evidence, and the station sheet can read why an assistant was not gathered
  const askedFile = path.join(dirOf, "asked.json"), anyAsked = outcomes.some(([, o]) => o === "already asked" || o.startsWith("read"));
  fs.writeFileSync(askedFile, JSON.stringify({ step: "ai-ask", at: new Date().toISOString(), outcomes: Object.fromEntries(outcomes) }, null, 1) + "\n");
  if (!anyAsked) {
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
