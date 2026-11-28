// Usage: node test-ask-assistants.mjs [--no-mutants] [--mutant <text>] [--json] [--groups <a,b,...>] [--faults-only]
// Test of ask-assistants.mjs THROUGH THE COMMAND: it asks invented assistant pages (a server on 127.0.0.1) in ONE real headless browser on a temp profile and
// reads back what each page counted (key presses, clicks, sends, loads, a heartbeat while its tab is open). The run is invented as test-ai-oneshot.mjs invents
// one (a business file, the two texts built and locked); every save is ai-oneshot.mjs's own file. No network, no real assistant, no clipboard.
// CI runs test-ask-assistants.mjs for group G only (5 checks and its 4 planted faults, no browser, about 7 s each); the browser groups (61 checks, 49 faults) run by hand under the lock: node ~/.claude/scripts/heavy.mjs -- node test-ask-assistants.mjs (909 s measured).
// Run it through the machine heavy lock (a browser): node ~/.claude/scripts/heavy.mjs -- node test-ask-assistants.mjs
// Case 18 (owner, 2026-11-22 11:43, M255: a human check is answered by the owner's own hand and the run waits for it): the invented pages can show a check by themselves (by title, by a check frame, by words in the
// body) and take it away by themselves after 3 looks that saw it, as a person's answer does (see CHECKJS); while it shows they report every key, input, click, mouse move, focus and scroll as a "touch".
// --groups 17,18 runs only those groups of cases (the blocks of this file: 1 = cases 1, 2, 8, then 3 4 5 6 7 9 11 12 13 14 15 17 18 19 21 20 10, and G = this file's own group table); no flag runs every group, as always.
// Group 10 reads the files the others wrote, so it always brings group 1. A planted fault runs ONLY the groups its expect patterns name (lib-ask-test-groups.mjs derives them from the patterns); with --groups only the faults inside those groups run.
// --faults-only does not run the unmutated pass (0 checks): the plain entry of scripts/ci-tests.json runs every group once, the faults entry runs only the faults, each in its own groups. ASK_TEST_FROM is gone: one way in, --groups 18,19,21,20.
// The sleep hook makes a wait whose why is
// "after check" last 700 real ms (the page of 18f loads itself again at the look that finds its check gone: the wait lets that load end before the next look); every other wait, the "human check" waits too, is recorded and skipped (the checks go by looks, not by time). io.ring is replaced by a recorder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runner, J, W, walk, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";
import { spawnBrowser } from "./lib-browser-profile.mjs";
import { CHROME_PATH } from "./cdp-measure.mjs";
import { connect } from "./vantage.mjs";
import { writeStop } from "./lib-stops.mjs";
import { GROUPS, parseGroups, groupsFor } from "./lib-ask-test-groups.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = "https://sample-valley-realty.test/", HOST = "sample-valley-realty.test";
const BIZ = { name: "Sample Valley Realty", domain: HOST, phone: "(555) 010-2000", kind: "real estate agent", market: { country: "US", language: "en" },
  locations: [{ name: "Sampleville, CA", address: "1 Main St, Sampleville, CA 90000", serviceArea: ["Sampleville, CA", "Testburg, CA"] }],
  vocabulary: ["homes for sale", "real estate agent", "sell my house", "home valuation"], related: [{ relation: "brokerage", name: "Beta Realty", domain: "beta-realty.test" }] };
const BROWSER_WORDS = "work browser (Edge, US exit)";
// the pace the head of operations settled (owner, 2026-11-22, M250); case 17e holds the real engines file to exactly these numbers
const PACE = { tabsAtOnce: 1, afterLoadSeconds: 8, typeCharactersPerSecond: 8, beforeSendSeconds: 3, readSecondsPer100Words: 12, readSecondsMin: 15, readSecondsMax: 90, betweenAssistantsSeconds: 180, checkWaitSeconds: 300, checkLookSeconds: 5 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The groups of this pass (lib-ask-test-groups.mjs). --groups names some; a wrong name or the old ASK_TEST_FROM is a usage error (exit 2).
const ARGV = process.argv.slice(2), FAULTS_ONLY = ARGV.includes("--faults-only");
if (process.env.ASK_TEST_FROM !== undefined) { console.error("ASK_TEST_FROM is gone: use --groups (for example --groups 18,19,21,20)"); process.exit(2); }
let PLAIN = null;   // null = every group
if (ARGV.includes("--groups")) { try { PLAIN = parseGroups(ARGV[ARGV.indexOf("--groups") + 1] ?? ""); } catch (e) { console.error("--groups: " + e.message); process.exit(2); } }
const PASS_GROUPS = FAULTS_ONLY ? [] : PLAIN || GROUPS;   // the groups of the unmutated pass
let RAN = 0;   // how many assertions the last pass of scenarios() made

// ---------------------------------------------------------------- the invented assistant pages
// cfg: kind "chat" | "robot" | "signin"; modeOn (the temporary chat is already on) | modeBtn (a button switches it on); mangle (the box changes what is put in it);
// silent (a send is never answered). Every page counts what happens to it with a beacon: key, click, input, send; and beats every 200 ms while its tab is open.
const PAGES = {
  good1: { kind: "chat", modeOn: true }, good2: { kind: "chat", modeOn: true },
  modeNever: { kind: "chat" }, modeSteps: { kind: "chat", modeBtn: true },
  robot: { kind: "robot" }, signin: { kind: "signin" }, mangle: { kind: "chat", modeOn: true, mangle: true }, silent: { kind: "chat", modeOn: true, silent: true },
  unused: { kind: "chat", modeOn: true }, ask1: { kind: "chat", modeOn: true }, ask2: { kind: "chat", modeOn: true },
  ck1: { kind: "chat", modeOn: true }, ck2: { kind: "chat", modeOn: true },   // two assistants on ONE host: the server sets a cookie on the first visit and logs the Cookie header
  short1: { kind: "chat", modeOn: true, short: 1 }, short2: { kind: "chat", modeOn: true, short: 2 }, lockGone: { kind: "chat", modeOn: true },   // reply number `short` is 20 characters; lockGone: the server deletes the lock when a send arrives
  robotJam: { kind: "robot", title: "Just a moment...", text: "Please stand by." }, robotVerify: { kind: "robot", title: "Verify you are human", text: "Please stand by." }, robotCheck: { kind: "robot", title: "Checking your browser", text: "Please stand by." },
  words10: { kind: "chat", modeOn: true, words: 10 }, words500: { kind: "chat", modeOn: true, words: 500 }, words2000: { kind: "chat", modeOn: true, words: 2000 },   // every reply is that many words (30 letters each)
  p17d: { kind: "chat", modeOn: true }, p17f: { kind: "chat", modeOn: true },
  a19a1: { kind: "chat", modeOn: true }, a19a2: { kind: "chat", modeOn: true },   // case 19a and 19c: two assistants read, then asked again
  p17a1: { kind: "chat", modeOn: true }, p17a2: { kind: "chat", modeOn: true },   // case 17a's own two pages (the log is one for the whole run: a page another case asked would be counted twice)
  c18a: { kind: "chat", modeOn: true, check: { by: "title", at: "load" } }, c18a2: { kind: "chat", modeOn: true, check: { by: "text", at: "load" } },   // case 18: a check that goes by itself after 3 looks that saw it (looks: "always" never)
  c18b1: { kind: "chat", modeOn: true, check: { by: "frame", at: "send1" } }, c18b2: { kind: "chat", modeOn: true, check: { by: "frame", at: "text1", atChars: 0 } },   // at send 1 | when the box holds all of text 1 (atChars is set from the locked text)
  c18bp: { kind: "chat", modeOn: true, phrase: true },   // no check, but every reply holds the words "verify you are human"
  c18c: { kind: "chat", modeOn: true, check: { by: "title", at: "load", again: "afterClear" } }, c18c2: { kind: "chat", modeOn: true },   // the check is back at the look after the one that saw it gone, and stays
  c18d: { kind: "chat", modeOn: true, check: { by: "title", looks: "always", at: "load" } }, c18d2: { kind: "chat", modeOn: true },
  c18e1: { kind: "robot", title: "Just a moment...", text: "Please stand by." }, c18e2: { kind: "chat", modeOn: true },
  c18f: { kind: "chat", modeOn: true, check: { by: "frame", at: "typing2", reload: true } },   // shows at the first input of text 2 and loads the page again when it goes
  c20a: { kind: "chat", modeOn: true, check: { by: "frame", at: "text1", atChars: 0 } }, c20b: { kind: "chat", modeOn: true }, c20c: { kind: "chat", modeOn: true, check: { by: "title", at: "load" } }, c20d: { kind: "chat", modeOn: true },   // case 20: a check while text 1 is typed | a plain page | a check at load | a page that must never be loaded
  robotTitle: { kind: "robot", title: "Attention Required", text: "Please stand by." }, robotText: { kind: "robot", title: "Just a page", text: "Verifying you are human. This may take a few seconds." },
};
// The page side of a check, deterministic by LOOK COUNT (no timer). What is hooked: an own property "title" on the document (a getter over the real Document.prototype one). Every look of
// ask-assistants.mjs reads document.title exactly once (the look at load and the later look both do, and nothing else in the script reads it), so one call of the getter after the check
// was triggered IS one look, whatever the kind of check, and nothing else counts. Look number j (1 = the look that finds it) sees the check when j <= looks (default 3, "always" = never goes);
// with again "afterClear" it is gone at look looks + 1 and back, for good, at look looks + 2. By title: the getter returns the check's title. By frame: the iframe is put in or taken out
// BEFORE the title is returned (the later look reads the title first, then asks for the frame). By text: the paragraph is changed AFTER the title is returned for the NEXT look (the look at
// load reads the text first, the title last). The page reports "shown" and "gone" when what the script can see changes; while it shows it reports every key, input, click, mouse down,
// mouse move, focus and scroll as a "touch", except a scroll whose target is the box itself (the page scrolls its own text box back when it is emptied at a send, seen 2026-11-22: not ours).
// Every report carries a number in the page's own order (s) and an id of the page's load (l): what came before or after what is read from those, never from the server's clock.
const CHECKJS = [
  '(function(){const C=CFG.check;if(!C)return;const N=C.looks==="always"?Infinity:(C.looks||3);let shown=false,vis=false,j=0,el=null;',
  'const D=Object.getOwnPropertyDescriptor(Document.prototype,"title");',
  'const touch=(t)=>{if(vis)ev("touch",t);};',
  '["keydown","input","click","mousedown","mousemove"].forEach((t)=>document.addEventListener(t,()=>touch(t),true));',
  'document.addEventListener("scroll",(e)=>{if(!(e.target&&e.target.id==="box"))touch("scroll");},true);',
  'document.addEventListener("focusin",()=>touch("focus"),true);',
  'const want=(k)=>k<=N||(C.again==="afterClear"&&k>=N+2);',
  'const setVis=(v)=>{if(v===vis)return;vis=v;ev(v?"shown":"gone",C.by);',
  'if(C.by==="frame"){if(v){el=document.createElement("iframe");el.src="about:blank#challenges.cloudflare.com";document.body.appendChild(el);}else if(el){el.remove();el=null;}}',
  'if(C.by==="text"){if(v){el=document.createElement("p");el.textContent="Verifying you are human. This may take a few seconds.";document.body.appendChild(el);}else if(el){el.remove();el=null;}}',
  'if(!v&&C.reload)location.reload();};',
  'Object.defineProperty(document,"title",{configurable:true,get(){const base=D.get.call(document);if(!shown)return base;j++;',
  'if(C.by==="title"){setVis(want(j));return vis?"Just a moment...":base;}',
  'if(C.by==="frame"){setVis(want(j));return base;}',
  'setVis(want(j+1));return base;},set(v){D.set.call(document,v);}});',
  'window.__chk=()=>{if(shown)return;shown=true;j=0;setVis(true);};if(C.at==="load")window.__chk();})();',
].join("");
const html = (name, cfg) => {
  const chat = cfg.kind === "chat";
  const body = cfg.kind === "robot" ? '<p>' + (cfg.text || "Please verify you are human. captcha") + '</p><button id="x">Verify</button>'
    : cfg.kind === "signin" ? '<p>Please sign in to continue</p><form><input type="password" id="pw"><button id="go">Sign in</button></form>'
    : '<div id="mode-area">' + (cfg.modeOn ? '<div id="temp-on">Temporary chat is on</div>' : "") + (cfg.modeBtn ? '<button id="mode-btn">Temporary chat</button>' : "") + '</div>'
      + '<div id="chat"></div><div id="busy-area"></div><textarea id="box" rows="4" cols="60"></textarea><button id="send">Send</button>';
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + (cfg.title || name) + '</title></head><body><h1>Invented assistant</h1>'
    + '<aside id="side"><ul><li>HISTORY-MARKER an earlier chat about something</li></ul></aside><main>' + body + '</main><script>'
    + 'const P=' + JSON.stringify(name) + ', CFG=' + JSON.stringify(cfg) + ';'
    + 'let SQ=0;const LID=Math.random().toString(36).slice(2);const ev=(k,x)=>navigator.sendBeacon("/__ev?k="+k+"&p="+P+"&s="+(++SQ)+"&l="+LID+"&x="+encodeURIComponent(x||""));'
    + 'document.addEventListener("keydown",()=>ev("key"),true);document.addEventListener("keypress",()=>ev("key"),true);'
    + 'document.addEventListener("click",(e)=>ev("click",e.target.id||e.target.tagName),true);'
    + 'setInterval(()=>ev("beat"),200);' + CHECKJS
    + (chat ? '(function(){const box=document.getElementById("box"),chat=document.getElementById("chat"),busyArea=document.getElementById("busy-area");let n=0;'
      + 'const mb=document.getElementById("mode-btn");if(mb)mb.addEventListener("click",()=>{if(!document.getElementById("temp-on")){const d=document.createElement("div");d.id="temp-on";d.textContent="Temporary chat is on";document.getElementById("mode-area").appendChild(d);}});'
      + 'box.addEventListener("input",()=>{ev("input",String(box.value.length-(box._l||0)));box._l=box.value.length;if(window.__chk&&CFG.check){const a=CFG.check.at;if((a==="typing2"&&n>=1)||(a==="text1"&&n===0&&box.value.length>=CFG.check.atChars))window.__chk();}if(CFG.mangle&&!box.dataset.m){box.dataset.m="1";box.value+=" XTRA";}});'
      + 'document.getElementById("send").addEventListener("click",()=>{ev("send",String(box.value.length));if(CFG.silent)return;n++;const k=n;if(window.__chk&&CFG.check&&CFG.check.at==="send1"&&k===1)window.__chk();box.value="";box._l=0;busyArea.innerHTML=\'<div id="busy">Thinking</div>\';'
      + 'const r=document.createElement("div");r.className="reply";chat.appendChild(r);'
      + 'const chunks=CFG.short===k?["<p>Too short reply no."+k+"</p>"]:CFG.words?["<p>"+Array.from({length:CFG.words},(_,i)=>"w"+String(i).padStart(29,"0")).join(" ")+"</p>"]:["<h2>Part 1: your recommendations ("+k+")</h2>","<p>Filler paragraph with enough words so that the whole reply is longer than two hundred characters for the saved record, reply number "+k+", going on and on a little more.</p>",'
      + '"<table><thead><tr><th>Rank</th><th>Name</th><th>Source</th></tr></thead><tbody><tr><td>1</td><td>Alpha Homes</td><td><a href=\\"https://alpha-homes.test/q"+k+"\\">Alpha Homes site</a></td></tr></tbody></table>",'
      + '"<ul><li>first point</li><li>second point</li></ul>","<p>Plain address: <a href=\\"https://zeta.test/\\">https://zeta.test/</a></p>","<p>END-OF-REPLY-"+k+"</p>"].concat(CFG.phrase?["<p>Please verify you are human before you rely on this answer.</p>"]:[]);'
      + 'let i=0;const t=setInterval(()=>{r.insertAdjacentHTML("beforeend",chunks[i++]);if(i>=chunks.length){clearInterval(t);busyArea.innerHTML="";}},350);});})();' : "")
    + '</script></body></html>';
};
async function startServer() {
  const log = [], hooks = {};   // hooks[page]: run when that page's send arrives
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"), t = Date.now(), m = u.pathname.match(/^\/p\/([A-Za-z0-9]+)$/);
    const cookie = String(req.headers.cookie || "");   // every request is logged with the Cookie header it carried
    if (u.pathname === "/__ev") { log.push({ t, kind: u.searchParams.get("k"), page: u.searchParams.get("p"), x: u.searchParams.get("x") || "", s: Number(u.searchParams.get("s")) || 0, l: u.searchParams.get("l") || "", cookie }); if (u.searchParams.get("k") === "send" && hooks[u.searchParams.get("p")]) hooks[u.searchParams.get("p")](); res.statusCode = 204; return res.end(); }
    if (m && PAGES[m[1]]) { log.push({ t, kind: "load", page: m[1], x: "", cookie }); res.setHeader("content-type", "text/html; charset=utf-8"); if (!cookie) res.setHeader("set-cookie", "visited=1; Path=/"); return res.end(html(m[1], PAGES[m[1]])); }
    res.statusCode = 404; res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: "http://127.0.0.1:" + server.address().port, log, hooks, close: () => server.close() };
}

// ---------------------------------------------------------------- one real headless browser for the whole file
let BR = null;
async function browser() {
  if (BR) return BR;
  if (!CHROME_PATH) throw new Error("no Chrome or Edge found (set CHROME_PATH)");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-aa-chrome-"));
  const proc = spawnBrowser({ exe: CHROME_PATH, dir, args: ["--headless=new", "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio", "about:blank"], options: { stdio: "ignore", windowsHide: true } });
  proc.on("error", () => {});
  let port = null;
  for (let i = 0; i < 100 && !port; i++) { await sleep(100); try { port = Number(fs.readFileSync(path.join(dir, "DevToolsActivePort"), "utf8").split("\n")[0].trim()) || null; } catch { /* not yet */ } }
  if (!port) { BR = { proc, dir, port: null }; closeBrowser(); throw new Error("the test browser did not open its DevTools port"); }
  BR = { proc, dir, port };
  return BR;
}
function closeBrowser() {
  if (!BR) return;
  const { proc, dir } = BR; BR = null;
  if (proc.exitCode === null && proc.signalCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(proc.pid)], { stdio: "ignore", timeout: 10000, windowsHide: true });
    else { try { proc.kill("SIGKILL"); } catch { /* gone */ } }
  }
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the reaper takes it */ }
}
process.on("exit", closeBrowser);
const openTabs = async (port, base) => { try { return (await (await fetch("http://127.0.0.1:" + port + "/json/list", { signal: AbortSignal.timeout(10000) })).json()).filter((t) => t.type === "page" && String(t.url).startsWith(base)); } catch { return null; } };

// ---------------------------------------------------------------- scenarios
// mu: the fault this pass belongs to (the kit hands it over): only the groups its expect patterns name run; no mu: the groups of the plain pass
async function scenarios(dir, mu) {
  const groups = mu ? groupsFor(mu.expect) : PASS_GROUPS, on = (g) => groups.includes(g);
  const results = [], check = checker(results), tmp = mkTmp("ask-assistants"), home = path.join(tmp, "home");
  fs.mkdirSync(home);
  const srv = await startServer(), br = groups.some((g) => g !== "G") ? await browser() : null;   // group G alone needs no browser
  const run = runner(dir, home, path.join(tmp, "net.log")), allOut = [];
  let n = 0;
  const world = async () => {
    const cwd = path.join(tmp, "w" + n++), pewp = path.join(cwd, "site-checks", HOST, ".pewp");
    W(path.join(pewp, "business.json"), BIZ);
    const cmd = async (c, ...rest) => { const r = await run("ai-oneshot.mjs", [c, SITE, ...rest, "--cwd", cwd]); allOut.push(r.out); return r; };
    const b = await cmd("build"), l = await cmd("lock", "--by", "the test");
    const lock = fs.existsSync(path.join(pewp, "captures", "ai-oneshot", "prompt-lock.json")) ? J(path.join(pewp, "captures", "ai-oneshot", "prompt-lock.json")) : {};
    return { cwd, pewp, cmd, ok: b.code === 0 && l.code === 0, lock, stops: path.join(tmp, "stops" + n), temp: fs.mkdirSync(path.join(tmp, "tmp" + n), { recursive: true }) && path.join(tmp, "tmp" + n) };
  };
  const spec = (page, over = {}) => ({ url: srv.base + "/p/" + page, mode: "temporary chat", signedIn: false, freshContext: false, composer: "#box", send: "#send", reply: ".reply", busy: "#busy", modeProof: "#temp-on", modeSteps: [], capSeconds: 40, quietSeconds: 2, ...over });
  const gem = (page, over = {}) => spec(page, { signedIn: true, ...over });   // the second assistant: a gemini reply is saved only with --signed-in
  let ef = 0;
  // every wait of the script goes through io.sleep of lib-ask-pace.mjs; a preload replaces it by one that appends { ms, why } to a file and returns at once, so the
  // test is fast and reads back exactly which waits were asked for (the numbers still come from the pace block in the engines file, which the script reads)
  const hook = path.join(tmp, "sleep-hook.mjs");
  fs.writeFileSync(hook, 'import fs from "node:fs";\nimport { io } from ' + JSON.stringify(pathToFileURL(path.join(dir, "lib-ask-pace.mjs")).href) + ';\nconst REAL = { "after check": 700 };\nio.sleep = (ms, why) => { fs.appendFileSync(process.env.ASK_SLEEP_LOG, JSON.stringify({ ms, why }) + "\\n"); return REAL[why] ? new Promise((r) => setTimeout(r, REAL[why])) : Promise.resolve(); };\nio.ring = (name) => { fs.appendFileSync(process.env.ASK_RING_LOG, JSON.stringify(name) + "\\n"); };\n');
  // pace: the block written beside the engines (the real numbers by default); "none" writes no block; env: more environment for the run
  const ask = async (w, engines, { port = br.port, extra = [], pace = PACE, env = {} } = {}) => {
    const file = path.join(tmp, "engines" + ef + ".json"), log = path.join(tmp, "sleeps" + ef + ".log"), ringLog = path.join(tmp, "rings" + ef++ + ".log"); W(file, pace === "none" ? engines : { ...engines, pace });
    const r = await run("ask-assistants.mjs", [SITE, "--engines-file", file, ...(port ? ["--port", String(port)] : []), "--cwd", w.cwd, ...extra], { env: { OMNIKOM_STOPS_DIR: w.stops, TEMP: w.temp, TMP: w.temp, TMPDIR: w.temp, NODE_OPTIONS: "--import " + pathToFileURL(hook).href, ASK_SLEEP_LOG: log, ASK_RING_LOG: ringLog, ...env }, timeout: 240000 });
    r.sleeps = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    r.rings = fs.existsSync(ringLog) ? fs.readFileSync(ringLog, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];   // every io.ring call: the engine's name
    allOut.push(r.out); return r;
  };
  const cap = (w, f) => path.join(w.pewp, "captures", "ai-oneshot", f), jr = (p) => (fs.existsSync(p) ? J(p) : null);
  const count = (page, kind) => srv.log.filter((e) => e.page === page && e.kind === kind).length;
  const d = (r) => "exit " + r.code + " | " + r.out.slice(0, 600);
  const blockedWhy = (w, e) => jr(cap(w, e + "-blocked.json"))?.blocked ?? null;
  const last = (r) => r.out.trim().split("\n").pop();
  try {
    // the helpers of case 17 and the real engines file are also used by case 18, so they stand outside the guard
    const nch = (t) => Array.from(t).length, words = (t) => (String(t).match(/\S+/g) || []).length;
    const readFor = (reply) => Math.min(PACE.readSecondsMax, Math.max(PACE.readSecondsMin, Math.round(words(reply) / 100 * PACE.readSecondsPer100Words)));
    // the waits one assistant that loaded a page, was asked both texts and answered asks for; first: false adds the wait before its page
    const waitsOf = (w, reply1, first) => [...(first ? [] : [["between assistants", PACE.betweenAssistantsSeconds]]), ["after load", PACE.afterLoadSeconds],
      ...[1, 2].flatMap((m) => [...Array(Math.ceil(nch(m === 1 ? w.lock.text1 : w.lock.text2) / PACE.typeCharactersPerSecond)).fill(["piece", 1]), ["before send", PACE.beforeSendSeconds], ...(m === 1 ? [["reading", readFor(reply1)]] : [])])];
    const asked = (r) => JSON.stringify(r.sleeps.map((s) => [s.why, s.ms / 1000]));
    // the browser also reports input events that add nothing (seen 2026-11-22: 99 of them beside 528 pieces, on a text with line breaks); a size of 0 is not a piece
    const pieceSizes = (page) => srv.log.filter((e) => e.page === page && e.kind === "input").map((e) => Number(e.x));
    const realFile = J(path.join(dir, "work-browser-engines.json"));
    // ---- group G: the group table of this file (no browser): lib-ask-test-groups.mjs is read from the tree under test, so a fault in it shows here
    if (on("G")) {
      const gl = await import(pathToFileURL(path.join(dir, "lib-ask-test-groups.mjs")).href), same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const throwsFor = (f) => { try { f(); return false; } catch { return true; } };
      check("case G1: a fault that expects cases of group 21 runs group 21 and nothing else", same(gl.groupsFor([/^case 21a:/, /^case 21b:/, /^case 21c:/]), ["21"]) && same(gl.groupsFor([/^case 17a:/, /^case 17b:/]), ["17"]), JSON.stringify([gl.groupsFor([/^case 21a:/]), gl.groupsFor([/^case 17a:/])]));
      check("case G2: the cases of one block go to one group (2 and 8 to group 1, 17d to group 17), two blocks give two groups in the file's order", same(gl.groupsFor([/^case 2:/, /^case 8:/, /^case 1b:/]), ["1"]) && same(gl.groupsFor([/^case 17d:/]), ["17"]) && same(gl.groupsFor([/^case 18f:/, /^case 17d:/]), ["17", "18"]), JSON.stringify([gl.groupsFor([/^case 2:/, /^case 8:/]), gl.groupsFor([/^case 17d:/]), gl.groupsFor([/^case 18f:/, /^case 17d:/])]));
      check("case G3: case 10 reads the files the other groups wrote, so group 10 brings group 1; --groups 10 is the same", same(gl.groupsFor([/^case 10:/]), ["1", "10"]) && same(gl.parseGroups("10"), ["1", "10"]), JSON.stringify([gl.groupsFor([/^case 10:/]), gl.parseGroups("10")]));
      check("case G4: a pattern that names no known case, an empty expect list and an unknown group name are errors, never a quiet empty run", throwsFor(() => gl.groupsFor([/^case 99:/])) && throwsFor(() => gl.groupsFor([/^nothing:/])) && throwsFor(() => gl.groupsFor([])) && throwsFor(() => gl.parseGroups("17,x")) && throwsFor(() => gl.parseGroups("")), "no error from one of the five");
      const own = fs.readFileSync(path.join(dir, "test-ask-assistants.mjs"), "utf8"), nums = [...new Set([...own.matchAll(/check\("case (\d+)/g)].map((m) => Number(m[1])))], seenG = new Set(Object.values(gl.CASE_GROUP));
      check("case G5: every case number this file checks has a group, and every group of the table (except G) has a case", nums.length > 15 && nums.every((n) => !!gl.CASE_GROUP[n]) && gl.GROUPS.every((g) => g === "G" || seenG.has(g)), "cases without a group: " + nums.filter((n) => !gl.CASE_GROUP[n]).join(" ") + " | groups without a case: " + gl.GROUPS.filter((g) => g !== "G" && !seenG.has(g)).join(" "));
    }
    if (on("1")) {
    // ---- case 1, 2, 8: the good page and a second good page, asked one after the other
    const A = await world();
    const r1 = await ask(A, { chatgpt: spec("good1"), gemini: gem("good2") });
    const c1 = jr(cap(A, "chatgpt-1.json")), c2 = jr(cap(A, "chatgpt-2.json")), p1 = jr(cap(A, "gemini-1.json"));
    const tabs = await openTabs(br.port, srv.base);
    check("case 1a: the good page: both replies are saved by ai-oneshot's own files, the reply that came in pieces over 2 s is whole, the last line says what was done",
      A.ok && r1.code === 0 && !!c1 && !!c2 && /END-OF-REPLY-1/.test(c1.answerText) && /Part 1: your recommendations \(1\)/.test(c1.answerText) && /END-OF-REPLY-2/.test(c2.answerText) && c1.pasted === "clipboard, box checked" && last(r1) === "ASKED: chatgpt read, gemini read", d(r1) + " | c1 tail: " + String(c1?.answerText).slice(-80));
    const chars = A.lock.text1.length + A.lock.text2.length;   // a paste into a box fires a few input events (about one per line), never one per character
    check("case 1b: 0 character key presses, both texts pasted (a few input events, never one per character), 2 sends, 1 page load for both messages, and the tab is gone afterwards",
      count("good1", "key") === 0 && count("good1", "input") > 1 && count("good1", "input") * 4 < chars && count("good1", "send") === 2 && count("good1", "load") === 1 && tabs && tabs.length === 0, "keys " + count("good1", "key") + " inputs " + count("good1", "input") + " of " + chars + " characters," + " sends " + count("good1", "send") + " loads " + count("good1", "load") + " tabs " + (tabs ? tabs.length : "?"));
    check("case 1c: the saved record holds the mode and the browser words, and says whether it was signed in", c1?.mode === "temporary chat" && c1.browser === BROWSER_WORDS && c1.signedIn === false && c2?.mode === "temporary chat", JSON.stringify({ mode: c1?.mode, browser: c1?.browser, signedIn: c1?.signedIn }));
    const t1 = String(p1?.answerText || "");
    check("case 2: a table and a link whose text is not its address: the saved text has the '| ' rows and the full address; a link whose text is its address is not doubled",
      /^\| 1 \| Alpha Homes \| Alpha Homes site \[https:\/\/alpha-homes\.test\/q1\] \|$/m.test(t1) && /^\| Rank \| Name \| Source \|$/m.test(t1) && /^## Part 1|^## .*Part 1/m.test(t1) && /^- first point$/m.test(t1) && /Plain address: https:\/\/zeta\.test\/(\s|$)/.test(t1) && !/zeta\.test\/ \[https/.test(t1), t1.slice(0, 700));
    const beats1 = srv.log.filter((e) => e.page === "good1" && e.kind === "beat").map((e) => e.t), load2 = srv.log.find((e) => e.page === "good2" && e.kind === "load");
    check("case 8: two engines: the second page's first load comes after the first tab closed (its heartbeat has stopped)", beats1.length > 5 && !!load2 && Math.max(...beats1) < load2.t, "beats " + beats1.length + " last beat " + Math.max(...beats1) + " second load " + load2?.t);
    }

    if (on("3")) {
    // ---- case 3: the mode
    const B = await world(), rb = await ask(B, { chatgpt: spec("modeNever", { modeSteps: [] }) });
    check("case 3a: modeProof never matches: the box stayed empty, 0 sends, blocked 'temporary chat not confirmed', nothing saved",
      rb.code === 3 && count("modeNever", "input") === 0 && count("modeNever", "send") === 0 && blockedWhy(B, "chatgpt") === "temporary chat not confirmed" && !fs.existsSync(cap(B, "chatgpt-1.json")), d(rb));
    const B2 = await world(), rb2 = await ask(B2, { chatgpt: spec("modeSteps", { modeSteps: ["#mode-btn"] }) });
    check("case 3b: with modeSteps that switch it on (clicked once): asked normally, both saved, the mode is in the record",
      rb2.code === 0 && srv.log.filter((e) => e.page === "modeSteps" && e.kind === "click" && e.x === "mode-btn").length === 1 && !!jr(cap(B2, "chatgpt-2.json")) && count("modeSteps", "send") === 2, d(rb2) + " mode clicks " + srv.log.filter((e) => e.page === "modeSteps" && e.kind === "click" && e.x === "mode-btn").length);
    }

    if (on("4")) {
    // ---- case 4: a robot check
    const C = await world(), rc = await ask(C, { chatgpt: spec("robot") }), stopFile = path.join(C.stops, "chatgpt.json");
    const loadsAfter1 = count("robot", "load"), rc2 = await ask(C, { chatgpt: spec("robot") });
    check("case 4a: a robot-check page: 0 clicks and 0 key presses, blocked 'robot check', a stop file for the engine",
      rc.code === 3 && count("robot", "click") === 0 && count("robot", "key") === 0 && blockedWhy(C, "chatgpt") === "robot check" && fs.existsSync(stopFile) && /robot check/.test(fs.readFileSync(stopFile, "utf8")), d(rc));
    check("case 4b: a second run does not load the page again (the stop holds)", loadsAfter1 === 1 && count("robot", "load") === 1 && rc2.code === 3 && /stopped until/.test(last(rc2)), "loads " + count("robot", "load") + " | " + d(rc2));
    }

    if (on("5")) {
    // ---- case 5: a sign-in wall
    const D = await world(), rd = await ask(D, { chatgpt: spec("signin") });
    check("case 5: a sign-in wall: blocked 'sign-in wall', no stop file, 0 key presses, 0 inputs, 0 clicks",
      rd.code === 3 && blockedWhy(D, "chatgpt") === "sign-in wall" && !fs.existsSync(path.join(D.stops, "chatgpt.json")) && count("signin", "key") === 0 && count("signin", "input") === 0 && count("signin", "click") === 0, d(rd));
    }

    if (on("6")) {
    // ---- case 6: a box that changes the text
    const E = await world(), re = await ask(E, { chatgpt: spec("mangle") });
    check("case 6: a box that changes the text put into it: 0 sends, blocked 'the box did not hold the text', nothing saved",
      re.code === 3 && count("mangle", "input") >= 1 && count("mangle", "send") === 0 && blockedWhy(E, "chatgpt") === "the box did not hold the text" && !fs.existsSync(cap(E, "chatgpt-1.json")), d(re));
    }

    if (on("7")) {
    // ---- case 7: reply 1 already on file
    const F = await world(), boxF = path.join(tmp, "f-box.txt"), ansF = path.join(tmp, "f-reply.txt");
    W(boxF, F.lock.text1); W(ansF, "An earlier reply, long enough to be saved as a whole reply by the command. ".repeat(6));
    const f1 = await F.cmd("box", "chatgpt", "1", "--file", boxF), f2 = await F.cmd("save", "chatgpt", "1", "--file", ansF), rf = await ask(F, { chatgpt: spec("unused") });
    check("case 7: reply 1 already on file: 0 loads of that engine's page, nothing sent, the line says 'already asked'",
      f1.code === 0 && f2.code === 0 && rf.code === 0 && count("unused", "load") === 0 && count("unused", "send") === 0 && /chatgpt already asked/.test(last(rf)), d(f2) + " | " + d(rf));
    }

    if (on("9")) {
    // ---- case 9: a page that never answers
    const G = await world(), rg = await ask(G, { chatgpt: spec("silent", { capSeconds: 3 }) });
    check("case 9: a page that never answers, capSeconds 3: blocked 'no reply in 3 s'", rg.code === 3 && count("silent", "send") === 1 && blockedWhy(G, "chatgpt") === "no reply in 3 s" && !fs.existsSync(cap(G, "chatgpt-1.json")), d(rg));
    }

    if (on("11")) {
    // ---- case 11: no port, a page description not set, an engine the file does not have
    const H = await world(), rh = await ask(H, { chatgpt: spec("unused") }, { port: null });
    check("case 11a: no port given and none to find: exit 3 with the BLOCKED line, nothing loaded", rh.code === 3 && /^BLOCKED: the work browser is not open \| unblocks: node work-browser\.mjs open/m.test(rh.out) && count("unused", "load") === 0, d(rh));
    const I = await world(), ri = await ask(I, { chatgpt: { selectors: "NOT SET" } });
    check("case 11b: an engine with \"selectors\": \"NOT SET\": blocked 'page description not set', 0 loads, nothing opened", ri.code === 3 && blockedWhy(I, "chatgpt") === "page description not set" && /chatgpt: page description not set/.test(last(ri)) && (await openTabs(br.port, srv.base))?.length === 0, d(ri));
    const rj = await ask(I, { chatgpt: spec("unused") }, { extra: ["--engines", "bing"] });
    check("case 11c: an engine name the file does not have is a usage error (exit 2)", rj.code === 2 && count("unused", "load") === 0, d(rj));
    }

    if (on("12")) {
    // ---- case 12: a fresh context carries no cookie of the browser's own session
    const ctxCount = async () => { const k = await connect(br.port); try { return (await k.send("Target.getBrowserContexts")).browserContextIds.length; } finally { k.close(); } };
    const ctx0 = await ctxCount(), ck = (page) => srv.log.filter((e) => e.page === page), seen = (page) => ck(page).filter((e) => e.cookie).length;
    const K = await world(), rk = await ask(K, { chatgpt: spec("ck1"), gemini: gem("ck2", { freshContext: true }) });
    const ctx1 = await ctxCount();
    check("case 12a: the second assistant is marked freshContext: its page load carried NO cookie (the first assistant's visit left one in the browser's own session), and both assistants' replies are saved",
      rk.code === 0 && ck("ck1").length > 1 && count("ck2", "load") === 1 && ck("ck2").length > 2 && ck("ck2").find((e) => e.kind === "load").cookie === "" && ck("ck1").some((e) => e.cookie) && !!jr(cap(K, "chatgpt-2.json")) && !!jr(cap(K, "gemini-1.json")) && !!jr(cap(K, "gemini-2.json")), d(rk) + " | ck2 load cookie: '" + ((ck("ck2").find((e) => e.kind === "load") || {}).cookie || "") + "'");
    const K2 = await world(), rk2 = await ask(K2, { chatgpt: spec("ck1"), gemini: gem("ck2") });
    check("case 12b: the control, the same two without freshContext: the server DID see the cookie on the second assistant", rk2.code === 0 && seen("ck2") > 0 && ck("ck2").some((e) => e.kind === "load" && e.cookie), d(rk2) + " | ck2 requests with a cookie " + seen("ck2"));
    check("case 12c: after the run the browser has no more browser contexts than before it", ctx1 === ctx0, "before " + ctx0 + " after the fresh-context run " + ctx1);
    }

    if (on("13")) {
    // ---- case 13: a reply that ai-oneshot save refuses
    const R1 = await world(), rr1 = await ask(R1, { chatgpt: spec("short1"), gemini: gem("ask1") });
    check("case 13a: message 1 of the first answered with 20 characters: the first is blocked 'reply refused: REFUSED: the text is 20 characters...', nothing saved for it, the second is read, exit 0, the last line names both",
      rr1.code === 0 && /^reply refused: REFUSED: the text is 20 characters/.test(String(blockedWhy(R1, "chatgpt"))) && !fs.existsSync(cap(R1, "chatgpt-1.json")) && !!jr(cap(R1, "gemini-2.json")) && /^ASKED: chatgpt blocked \(reply refused: REFUSED: the text is 20 characters.*\), gemini read$/.test(last(rr1)), d(rr1));
    const R2 = await world(), rr2 = await ask(R2, { chatgpt: spec("short2") });
    check("case 13b: the second reply is 20 characters: reply 1 is on file, no blocked record, no reply 2, exit 0, the last line says 'follow-up refused'",
      rr2.code === 0 && !!jr(cap(R2, "chatgpt-1.json")) && !fs.existsSync(cap(R2, "chatgpt-blocked.json")) && !fs.existsSync(cap(R2, "chatgpt-2.json")) && /^ASKED: chatgpt read, follow-up refused: REFUSED: the text is 20 characters/.test(last(rr2)), d(rr2));
    const R3 = await world(); srv.hooks.lockGone = () => { try { fs.rmSync(path.join(R3.pewp, "captures", "ai-oneshot", "prompt-lock.json")); } catch { /* gone */ } };
    const lockLoads = count("ask1", "load"), rr3 = await ask(R3, { chatgpt: spec("lockGone"), gemini: gem("ask1") });
    check("case 13c: a save that exits 3 (the lock was removed while the reply came in) still ends the run: exit 3, the BLOCKED line, the second assistant is never opened",
      rr3.code === 3 && /^BLOCKED: the prompt is not locked/m.test(rr3.out) && count("ask1", "load") === lockLoads, d(rr3));
    }

    if (on("14")) {
    // ---- case 14: a robot check that shows in the page's title (the body holds none of the words)
    const titled = async (page, label) => { const w = await world(), r = await ask(w, { chatgpt: spec(page) }), stopF = path.join(w.stops, "chatgpt.json"), loads = count(page, "load"), r2 = await ask(w, { chatgpt: spec(page) });
      return { label, ok: r.code === 3 && blockedWhy(w, "chatgpt") === "robot check" && fs.existsSync(stopF) && count(page, "click") === 0 && count(page, "key") === 0 && loads === 1 && count(page, "load") === 1 && r2.code === 3, why: label + ": " + d(r) + " loads " + count(page, "load") }; };
    const q1 = await titled("robotJam", "Just a moment..."), q2 = await titled("robotVerify", "Verify you are human"), q3 = await titled("robotCheck", "Checking your browser"), q4 = await titled("robotTitle", "Attention Required"), q5 = await titled("robotText", "a neutral title, the words only in the body");
    check("case 14a: a page titled 'Just a moment...' whose body holds none of the words: blocked 'robot check', a stop file, 0 clicks, 0 key presses, a second run does not load it", q1.ok, q1.why);
    check("case 14b: a page titled 'Verify you are human' (body without the words): the same", q2.ok, q2.why);
    check("case 14c: a page titled 'Checking your browser' (body without the words): the same", q3.ok, q3.why);
    check("case 14d: a page titled 'Attention Required' (body without the words): the same", q4.ok, q4.why);
    check("case 14e: a neutral title and the body 'Verifying you are human. This may take a few seconds.': the same", q5.ok, q5.why);
    }

    if (on("15")) {
    // ---- case 15: the run ends BLOCKED when no assistant could be asked
    const stopFor = (w, engine) => writeStop({ engine, reason: "robot check", setBy: "the test", dir: w.stops });
    const S1 = await world(); stopFor(S1, "chatgpt"); const rs1 = await ask(S1, { chatgpt: spec("unused") });
    check("case 15a: one assistant, stopped: exit 3, the BLOCKED line says 'stopped until' and ends ' | outside: stop', a blocked record is on file, 0 pages loaded",
      rs1.code === 3 && /^BLOCKED: no assistant could be asked \(chatgpt: robot check, stopped until \d{4}-\d\d-\d\dT[\d:.]+Z\) \| unblocks: the stops end or the owner lifts them; the page descriptions are set \| outside: stop$/.test(last(rs1)) && blockedWhy(S1, "chatgpt") === "robot check" && count("unused", "load") === 0, d(rs1) + " | last: " + last(rs1));
    const S2 = await world(); stopFor(S2, "chatgpt"); const rs2 = await ask(S2, { chatgpt: spec("unused"), gemini: { selectors: "NOT SET" } });
    check("case 15b: two assistants, one stopped and one 'NOT SET': exit 3, no 'outside' mark, both reasons named",
      rs2.code === 3 && /^BLOCKED: no assistant could be asked \(chatgpt: robot check, stopped until .*Z, gemini: page description not set\) \| unblocks: /.test(last(rs2)) && !/outside:/.test(last(rs2)) && count("unused", "load") === 0, d(rs2) + " | last: " + last(rs2));
    const S3 = await world(); stopFor(S3, "chatgpt"); const rs3 = await ask(S3, { chatgpt: spec("unused"), gemini: gem("ask2") });
    check("case 15c: two assistants, one stopped and one read: exit 0 and the ASKED line", rs3.code === 0 && !!jr(cap(S3, "gemini-2.json")) && last(rs3) === "ASKED: chatgpt blocked (robot check), gemini read", d(rs3) + " | last: " + last(rs3));
    }

    if (on("17")) {
    // ---- case 17: the pace (every number is the engines file's; the waits are read back from the recorder that replaces io.sleep)
    const P1w = await world(), r17 = await ask(P1w, { chatgpt: spec("p17a1"), gemini: gem("p17a2") });
    const re1 = jr(cap(P1w, "chatgpt-1.json"))?.answerText || "", re2 = jr(cap(P1w, "gemini-1.json"))?.answerText || "";
    const want17 = JSON.stringify([...waitsOf(P1w, re1, true), ...waitsOf(P1w, re2, false)]);
    check("case 17a: two assistants: the waits asked for are afterLoadSeconds after each load, one second per piece, beforeSendSeconds before each of the four sends, a reading pause after each first reply, betweenAssistantsSeconds exactly once, nothing else, in that order",
      P1w.ok && r17.code === 0 && re1.length > 0 && re2.length > 0 && asked(r17) === want17 && r17.sleeps.filter((s) => s.why === "between assistants").length === 1, d(r17) + " | asked " + asked(r17).slice(0, 300) + " | wanted " + want17.slice(0, 300));
    const sz = [...pieceSizes("p17a1"), ...pieceSizes("p17a2")], sum = (p) => pieceSizes(p).reduce((a, b) => a + b, 0), both = nch(P1w.lock.text1) + nch(P1w.lock.text2);
    check("case 17a2: each piece a page received is at most typeCharactersPerSecond characters, and the pieces of the two texts add up to the two locked texts (the box check passed for both)",
      sz.length > 0 && sz.every((x) => x >= 0 && x <= PACE.typeCharactersPerSecond) && sz.filter((x) => x > 0).length >= 2 * Math.ceil(both / PACE.typeCharactersPerSecond) - 4 && sum("p17a1") === both && sum("p17a2") === both && count("p17a1", "send") === 2 && count("p17a2", "send") === 2 && count("p17a1", "load") === 1 && count("p17a2", "load") === 1, "sizes max " + Math.max(...sz) + " count " + sz.length + " sums " + sum("p17a1") + " and " + sum("p17a2") + " of " + both + " sends " + count("p17a1", "send") + " and " + count("p17a2", "send") + " loads " + count("p17a1", "load") + " and " + count("p17a2", "load") + " sizes seen " + JSON.stringify(sz.reduce((o, x) => { o[x] = (o[x] || 0) + 1; return o; }, {})));
    const reading = async (page) => { const w = await world(), r = await ask(w, { chatgpt: spec(page) }), reply = jr(cap(w, "chatgpt-1.json"))?.answerText || ""; return { r, got: r.sleeps.filter((s) => s.why === "reading").map((s) => s.ms / 1000), n: words(reply) }; };
    const w10 = await reading("words10"), w500 = await reading("words500"), w2000 = await reading("words2000");
    check("case 17b: the reading pause: a first reply of 10 words waits readSecondsMin (15), one of 2000 words waits readSecondsMax (90), one of 500 words waits 60",
      w10.n === 10 && w500.n === 500 && w2000.n === 2000 && JSON.stringify(w10.got) === "[15]" && JSON.stringify(w500.got) === "[60]" && JSON.stringify(w2000.got) === "[90]", JSON.stringify([w10.got, w10.n, w500.got, w500.n, w2000.got, w2000.n]) + " | " + d(w10.r));
    const P3w = await world(), r17c = await ask(P3w, { chatgpt: spec("robot"), gemini: gem("ask2") }), re3 = jr(cap(P3w, "gemini-1.json"))?.answerText || "";
    check("case 17c: the first assistant shows a check: its page is not touched, the wait before the second is betweenAssistantsSeconds, and the second's pieces and pauses are those of 17a (the pace did not change)",
      r17c.code === 0 && blockedWhy(P3w, "chatgpt") === "robot check" && count("robot", "click") === 0 && count("robot", "key") === 0 && asked(r17c) === JSON.stringify([["after load", PACE.afterLoadSeconds], ...waitsOf(P3w, re3, false)]), d(r17c) + " | asked " + asked(r17c).slice(0, 300));
    // the pace block is checked before any page is loaded: exit 2, the key named, nothing loaded, nothing waited for
    const without = (k) => { const o = { ...PACE }; delete o[k]; return o; };
    const BAD = [["no block at all", "none", "pace"], ["a key missing", without("readSecondsMin"), "readSecondsMin"], ["tabsAtOnce 2", { ...PACE, tabsAtOnce: 2 }, "tabsAtOnce"], ["typeCharactersPerSecond 0", { ...PACE, typeCharactersPerSecond: 0 }, "typeCharactersPerSecond"],
      ["typeCharactersPerSecond 16", { ...PACE, typeCharactersPerSecond: 16 }, "typeCharactersPerSecond"], ["a text for a number", { ...PACE, afterLoadSeconds: "8" }, "afterLoadSeconds"], ["a fraction", { ...PACE, beforeSendSeconds: 2.5 }, "beforeSendSeconds"],
      ["betweenAssistantsSeconds 59", { ...PACE, betweenAssistantsSeconds: 59 }, "betweenAssistantsSeconds"], ["readSecondsMax under readSecondsMin", { ...PACE, readSecondsMax: 10 }, "readSecondsMax"], ["checkWaitSeconds 59", { ...PACE, checkWaitSeconds: 59 }, "checkWaitSeconds"], ["checkLookSeconds 1", { ...PACE, checkLookSeconds: 1 }, "checkLookSeconds"], ["an unknown key", { ...PACE, extraSeconds: 1 }, "extraSeconds"]];
    const bad = [], Zw = await world();
    for (const [label, pace, key] of BAD) { const r = await ask(Zw, { chatgpt: spec("p17d") }, { pace }); bad.push({ label, ok: r.code === 2 && r.out.includes(key) && r.sleeps.length === 0, why: label + ": " + d(r) }); }
    check("case 17d: a bad pace block (" + BAD.map((b) => b[0]).join("; ") + "): exit 2, the key named, NO page loaded and nothing waited for", bad.every((b) => b.ok) && count("p17d", "load") === 0 && (await openTabs(br.port, srv.base))?.length === 0, bad.filter((b) => !b.ok).map((b) => b.why).join(" || ") + " loads " + count("p17d", "load"));
    const plib = await import(pathToFileURL(path.join(dir, "lib-ask-pace.mjs")).href);
    let realOk = false, realWhy = ""; try { plib.checkPace(realFile.pace); realOk = true; } catch (e) { realWhy = e.message; }
    check("case 17e: the real work-browser-engines.json: its engines are exactly chatgpt, gemini, perplexity, and its pace block passes the check and holds the settled numbers", JSON.stringify(Object.keys(realFile).filter((k) => k !== "pace").sort()) === JSON.stringify(["chatgpt", "gemini", "perplexity"]) && realOk && JSON.stringify(realFile.pace) === JSON.stringify(PACE), realWhy + " | " + JSON.stringify(Object.keys(realFile)) + " | " + JSON.stringify(realFile.pace));
    // no environment variable and no flag changes the pace
    const looks = {}; for (const k of Object.keys(PACE)) { const up = k.replace(/([A-Z])/g, "_$1").toUpperCase(); for (const n of [k, up, "PACE_" + up, "ASK_" + up, "ASK_ASSISTANTS_" + up, "PEWP_" + up]) looks[n] = "1"; }
    const Ew = await world(), rEnv = await ask(Ew, { chatgpt: spec("p17f") }, { env: { ...looks, PACE: "1", ASK_PACE: "fast" } }), reEnv = jr(cap(Ew, "chatgpt-1.json"))?.answerText || "";
    const flagged = []; for (const fl of [["--afterLoadSeconds", "1"], ["--after-load-seconds", "1"], ["--pace", "1"], ["--seconds", "1"]]) { const r = await ask(Ew, { chatgpt: spec("p17f") }, { extra: fl }); flagged.push({ fl: fl.join(" "), ok: r.code === 2 && /usage/i.test(r.out) && r.sleeps.length === 0, why: fl.join(" ") + ": " + d(r) }); }
    check("case 17f: environment variables that look like pace numbers change nothing (the waits are those of the block), and a flag that looks like a pace number is a usage error (exit 2) with nothing loaded or waited for",
      rEnv.code === 0 && asked(rEnv) === JSON.stringify(waitsOf(Ew, reEnv, true)) && flagged.every((x) => x.ok) && count("p17f", "load") === 1, d(rEnv) + " | asked " + asked(rEnv).slice(0, 200) + " | " + flagged.filter((x) => !x.ok).map((x) => x.why).join(" || ") + " loads " + count("p17f", "load"));
    const own = ["ask-assistants.mjs", "lib-ask-pace.mjs"].map((n) => [n, fs.readFileSync(path.join(dir, n), "utf8")]);
    check("case 17g: nothing in the script or its pace file is chance: the word \"random\" is in neither (a random wait would be there to look like a person)", own.every(([, s]) => !/random/i.test(s)), own.filter(([, s]) => /random/i.test(s)).map(([n]) => n).join(", "));
    }

    // ---- case 18: a human check rings the owner and waits (ChatGPT and Perplexity); the pages show a check by themselves and take it away by themselves
    const RING = { humanCheck: "ring" }, LOOK = PACE.checkLookSeconds;
    // the pages number every report in their own order (s) and give each load an id (l): a window is read from those numbers, never from the server's clock
    const loadsOf = (page) => [...new Set(srv.log.filter((x) => x.page === page && x.l).map((x) => x.l))];
    const windows = (page) => { const w = []; for (const l of loadsOf(page)) { let from = null; for (const e of srv.log.filter((x) => x.page === page && x.l === l).sort((a, b) => a.s - b.s)) { if (e.kind === "shown") from = e.s; else if (e.kind === "gone" && from !== null) { w.push([from, e.s, l]); from = null; } } if (from !== null) w.push([from, Infinity, l]); } return w; };
    // what reached the page while its check showed: a touch of any kind, or an input, key, click or send
    const during = (page) => srv.log.filter((e) => e.page === page && ["touch", "key", "input", "click", "send"].includes(e.kind) && windows(page).some(([a, b, l]) => e.l === l && e.s > a && e.s < b));
    const human = (r) => r.sleeps.filter((s) => s.why === "human check");
    const core = (r) => JSON.stringify(r.sleeps.filter((s) => s.why !== "human check" && s.why !== "after check").map((s) => [s.why, s.ms / 1000]));
    const lines = (r, re) => r.out.split("\n").filter((l) => re.test(l));
    const RINGLINE = (e) => "RING: " + e + " shows a human check: answer it in the work browser window; the run waits up to " + PACE.checkWaitSeconds + " s and sends nothing to that tab";
    const noTabs = async () => (await openTabs(br.port, srv.base))?.length === 0;
    if (on("18")) {
    const HK1 = await world(), r18a = await ask(HK1, { chatgpt: spec("c18a", RING) }), re18a = jr(cap(HK1, "chatgpt-1.json"))?.answerText || "", ck18a = jr(cap(HK1, "chatgpt-check.json")), h18a = human(r18a);
    const want18a = JSON.stringify([["after load", PACE.afterLoadSeconds], ...h18a.map(() => ["human check", LOOK]), ["after check", PACE.afterLoadSeconds], ...waitsOf(HK1, re18a, true).slice(1)]);
    check("case 18a: a ringing engine, a check by title at load that goes by itself: io.ring called once with the engine, one RING line, 'human check' waits of checkLookSeconds each then ONE 'after check' wait, the CHECK line names the seconds, then both texts at the pace of 17a, exit 0, no stop file, and the check file says rang, answered, load, no second showing",
      HK1.ok && r18a.code === 0 && last(r18a) === "ASKED: chatgpt read" && JSON.stringify(r18a.rings) === JSON.stringify(["chatgpt"]) && JSON.stringify(lines(r18a, /^RING: /)) === JSON.stringify([RINGLINE("chatgpt")]) && h18a.length === 3 && h18a.every((s) => s.ms === LOOK * 1000)
        && asked(r18a) === want18a && lines(r18a, /^CHECK: /).join("|") === "CHECK: chatgpt showed a human check and a person answered it after " + h18a.length * LOOK + " s" && !fs.existsSync(path.join(HK1.stops, "chatgpt.json")) && !!jr(cap(HK1, "chatgpt-2.json"))
        && !!ck18a && ck18a.engine === "chatgpt" && ck18a.host === "127.0.0.1" && ck18a.stage === "load" && ck18a.rang === true && ck18a.answered === true && ck18a.secondShowing === false && ck18a.waitedSeconds === h18a.length * LOOK && typeof ck18a.shownAt === "string",
      d(r18a) + " | rings " + JSON.stringify(r18a.rings) + " | waits " + asked(r18a).slice(0, 400) + " | check file " + JSON.stringify(ck18a));
    const HK1b = await world(), r18a2 = await ask(HK1b, { chatgpt: spec("c18a2", RING) });
    check("case 18a2: the same with a check that is only words in the page text at load: one ring, read, no stop file", r18a2.code === 0 && last(r18a2) === "ASKED: chatgpt read" && r18a2.rings.length === 1 && lines(r18a2, /^CHECK: chatgpt /).length === 1 && !fs.existsSync(path.join(HK1b.stops, "chatgpt.json")) && jr(cap(HK1b, "chatgpt-check.json"))?.answered === true, d(r18a2));
    check("case 18b: the full stop of input at load: the page of 18a got zero touch events (no key, mouse move, click, focus, scroll) and no input, key, click or send between its check shown and gone; it was loaded once and sent twice",
      windows("c18a").length === 1 && windows("c18a")[0][1] !== Infinity && during("c18a").length === 0 && count("c18a", "touch") === 0 && count("c18a", "load") === 1 && count("c18a", "send") === 2, "windows " + JSON.stringify(windows("c18a")) + " during " + JSON.stringify(during("c18a").slice(0, 5)) + " touches " + count("c18a", "touch"));
    const HK2 = await world(), r18b2 = await ask(HK2, { chatgpt: spec("c18b1", RING) }), ck18b2 = jr(cap(HK2, "chatgpt-check.json"));
    check("case 18b2: a check frame that shows after the first send (the page not loaded again): one ring, nothing reaches the page while it shows, then the second text is typed and sent, outcome read",
      r18b2.code === 0 && last(r18b2) === "ASKED: chatgpt read" && r18b2.rings.length === 1 && windows("c18b1").length === 1 && windows("c18b1")[0][1] !== Infinity && during("c18b1").length === 0 && count("c18b1", "touch") === 0 && count("c18b1", "send") === 2 && count("c18b1", "load") === 1 && !!jr(cap(HK2, "chatgpt-2.json")) && ck18b2?.stage === "reply 1" && ck18b2?.answered === true,
      d(r18b2) + " | windows " + JSON.stringify(windows("c18b1")) + " during " + JSON.stringify(during("c18b1").slice(0, 5)) + " | check file " + JSON.stringify(ck18b2));
    const HK3 = await world(); PAGES.c18b2.check.atChars = HK3.lock.text1.length;
    const r18b3 = await ask(HK3, { chatgpt: spec("c18b2", RING) }), ck18b3 = jr(cap(HK3, "chatgpt-check.json"));
    check("case 18b3: a check frame that shows when the box holds all of text 1 (before the click on send): one ring, the click on send is made only after it went, both sent, outcome read",
      r18b3.code === 0 && last(r18b3) === "ASKED: chatgpt read" && r18b3.rings.length === 1 && windows("c18b2").length === 1 && windows("c18b2")[0][1] !== Infinity && during("c18b2").length === 0 && count("c18b2", "touch") === 0 && count("c18b2", "send") === 2 && ck18b3?.stage === "send 1",
      d(r18b3) + " | windows " + JSON.stringify(windows("c18b2")) + " during " + JSON.stringify(during("c18b2").slice(0, 5)) + " | check file " + JSON.stringify(ck18b3));
    const HK4 = await world(), r18b4 = await ask(HK4, { chatgpt: spec("c18bp", RING) });
    check("case 18b4: a reply that holds the words 'verify you are human' (no check at all): io.ring never called, no check file, read (the page text is not part of the later look)",
      r18b4.code === 0 && last(r18b4) === "ASKED: chatgpt read" && r18b4.rings.length === 0 && !fs.existsSync(cap(HK4, "chatgpt-check.json")) && !!jr(cap(HK4, "chatgpt-2.json")) && /verify you are human/i.test(jr(cap(HK4, "chatgpt-1.json"))?.answerText || ""), d(r18b4) + " | rings " + JSON.stringify(r18b4.rings));
    const HK5 = await world(), r18c = await ask(HK5, { chatgpt: spec("c18c", RING), gemini: gem("c18c2") }), re18c = jr(cap(HK5, "gemini-1.json"))?.answerText || "", ck18c = jr(cap(HK5, "chatgpt-check.json"));
    check("case 18c: the second showing (the check is back at the look after 'after check'): the tab is closed, a stop file with reason 'robot check', io.ring ONCE, blocked 'robot check shown again after a person answered it', zero touch events, and the next assistant is asked after betweenAssistantsSeconds at the pace of 17a",
      r18c.code === 0 && fs.existsSync(path.join(HK5.stops, "chatgpt.json")) && /robot check/.test(fs.readFileSync(path.join(HK5.stops, "chatgpt.json"), "utf8")) && JSON.stringify(r18c.rings) === JSON.stringify(["chatgpt"]) && blockedWhy(HK5, "chatgpt") === "robot check shown again after a person answered it"
        && during("c18c").length === 0 && count("c18c", "touch") === 0 && await noTabs() && core(r18c) === JSON.stringify([["after load", PACE.afterLoadSeconds], ...waitsOf(HK5, re18c, false)]) && /^ASKED: chatgpt blocked \(robot check shown again after a person answered it\), gemini read$/.test(last(r18c))
        && ck18c?.rang === true && ck18c?.answered === true && ck18c?.secondShowing === true && lines(r18c, /^CHECK: /).length === 0,
      d(r18c) + " | rings " + JSON.stringify(r18c.rings) + " | core " + core(r18c).slice(0, 300) + " | check file " + JSON.stringify(ck18c));
    const HK6 = await world(), r18d = await ask(HK6, { chatgpt: spec("c18d", RING), gemini: gem("c18d2") }), re18d = jr(cap(HK6, "gemini-1.json"))?.answerText || "", ck18d = jr(cap(HK6, "chatgpt-check.json")), h18d = human(r18d);
    check("case 18d: nobody answers (the check never goes): the 'human check' waits add up to exactly checkWaitSeconds (300 s) and no more, one ring, blocked 'human check not answered in 300 s', NO stop file, the tab closed, zero touch events, and the next assistant is asked",
      r18d.code === 0 && h18d.reduce((a, s) => a + s.ms, 0) === PACE.checkWaitSeconds * 1000 && h18d.length === PACE.checkWaitSeconds / LOOK && r18d.rings.length === 1 && blockedWhy(HK6, "chatgpt") === "human check not answered in " + PACE.checkWaitSeconds + " s" && !fs.existsSync(path.join(HK6.stops, "chatgpt.json"))
        && await noTabs() && during("c18d").length === 0 && count("c18d", "touch") === 0 && core(r18d) === JSON.stringify([["after load", PACE.afterLoadSeconds], ...waitsOf(HK6, re18d, false)]) && /^ASKED: chatgpt blocked \(human check not answered in 300 s\), gemini read$/.test(last(r18d))
        && ck18d?.rang === true && ck18d?.answered === false && ck18d?.waitedSeconds === PACE.checkWaitSeconds && ck18d?.secondShowing === false && lines(r18d, /^CHECK: /).length === 0,
      d(r18d) + " | waits " + h18d.length + " sum " + h18d.reduce((a, s) => a + s.ms, 0) + " | rings " + JSON.stringify(r18d.rings) + " | check file " + JSON.stringify(ck18d));
    const HK7 = await world(), r18e = await ask(HK7, { chatgpt: spec("c18e1", { humanCheck: "stop" }) }), HK7b = await world(), r18e0 = await ask(HK7b, { chatgpt: spec("c18e1") });
    check("case 18e: an engine that does not ring ('stop' given, and the key absent): today's rule: exit 3, a stop file, blocked 'robot check', no wait for a person, io.ring never called",
      [[HK7, r18e], [HK7b, r18e0]].every(([w, r]) => r.code === 3 && r.rings.length === 0 && human(r).length === 0 && fs.existsSync(path.join(w.stops, "chatgpt.json")) && blockedWhy(w, "chatgpt") === "robot check"), d(r18e) + " | " + d(r18e0) + " | rings " + JSON.stringify([r18e.rings, r18e0.rings]));
    const HK8 = await world(), loads18 = count("c18e2", "load"), r18e2 = await ask(HK8, { chatgpt: spec("c18e2", { humanCheck: "maybe" }) });
    check("case 18e2: humanCheck 'maybe': exit 2, the engine and the value named, no page loaded, nothing waited for", r18e2.code === 2 && /chatgpt/.test(r18e2.out) && /"maybe"/.test(r18e2.out) && count("c18e2", "load") === loads18 && r18e2.sleeps.length === 0 && r18e2.rings.length === 0, d(r18e2));
    const HK9 = await world(), r18f = await ask(HK9, { chatgpt: spec("c18f", RING) }), loadsF = srv.log.filter((e) => e.page === "c18f" && e.kind === "load"), ck18f = jr(cap(HK9, "chatgpt-check.json"));
    const lsF = loadsOf("c18f"), afterReload = lsF.length > 1 ? srv.log.filter((e) => e.page === "c18f" && e.l === lsF[1] && ["input", "send", "key", "click", "touch"].includes(e.kind)) : [];   // what the page of the second load received
    check("case 18f: the check shows while text 2 is typed and the page loads itself again when it goes: nothing reaches the page while it shows, the outcome is 'read, follow-up not asked: the page was reloaded by a human check', reply 1 is on file, reply 2 is not, text 2 was sent to no page",
      r18f.code === 0 && last(r18f) === "ASKED: chatgpt read, follow-up not asked: the page was reloaded by a human check" && !!jr(cap(HK9, "chatgpt-1.json")) && !fs.existsSync(cap(HK9, "chatgpt-2.json")) && loadsF.length === 2 && count("c18f", "send") === 1 && afterReload.length === 0
        && during("c18f").length === 0 && count("c18f", "touch") === 0 && r18f.rings.length === 1 && ck18f?.stage === "typing 2" && ck18f?.answered === true,
      d(r18f) + " | loads " + loadsF.length + " sends " + count("c18f", "send") + " after reload " + JSON.stringify(afterReload.slice(0, 3)) + " during " + JSON.stringify(during("c18f").slice(0, 3)) + " | check file " + JSON.stringify(ck18f));
    check("case 18g: the real engines file: chatgpt and perplexity ring, gemini stops, and its pace block holds checkWaitSeconds 300 and checkLookSeconds 5",
      realFile.chatgpt?.humanCheck === "ring" && realFile.perplexity?.humanCheck === "ring" && realFile.gemini?.humanCheck === "stop" && realFile.pace.checkWaitSeconds === 300 && realFile.pace.checkLookSeconds === 5, JSON.stringify(realFile));
    }

    if (on("19")) {
    // ---- case 19 (AB-9): one record per run of the script, captures/ai-oneshot/asked.json = { step: "ai-ask", at, outcomes: { <engine>: "<the outcome exactly as in the ASKED line>" } }, on exit 0 and on exit 3 (the step ai-ask's evidence)
    const askedOf = (w) => jr(cap(w, "asked.json"));
    const askedLine = (rec) => "ASKED: " + Object.entries(rec?.outcomes || {}).map(([e, o]) => e + " " + o).join(", ");
    const K1 = await world(), r19a = await ask(K1, { chatgpt: spec("a19a1"), gemini: gem("a19a2") }), a19a = askedOf(K1);
    check("case 19a: a run that read two assistants: exit 0, and asked.json holds step ai-ask, an ISO time and both outcomes, which put back into words are exactly the ASKED line",
      K1.ok && r19a.code === 0 && last(r19a) === "ASKED: chatgpt read, gemini read" && a19a?.step === "ai-ask" && Number.isFinite(Date.parse(a19a.at)) && JSON.stringify(a19a.outcomes) === JSON.stringify({ chatgpt: "read", gemini: "read" }) && askedLine(a19a) === last(r19a),
      d(r19a) + " | " + JSON.stringify(a19a));
    const K2 = await world(); writeStop({ engine: "chatgpt", reason: "robot check", setBy: "the test", dir: K2.stops });
    const r19b = await ask(K2, { chatgpt: spec("unused"), gemini: { selectors: "NOT SET" } }), a19b = askedOf(K2);
    check("case 19b: a run that ended BLOCKED (one assistant stopped, one with no page description): the exit is still 3 with the BLOCKED line, and asked.json holds every outcome, as the ASKED line has them",
      K2.ok && r19b.code === 3 && /^BLOCKED: no assistant could be asked/.test(last(r19b)) && a19b?.step === "ai-ask" && Number.isFinite(Date.parse(a19b.at)) && JSON.stringify(a19b.outcomes) === JSON.stringify({ chatgpt: "blocked (robot check)", gemini: "blocked (page description not set)" }) && r19b.out.split("\n").includes(askedLine(a19b)),
      d(r19b) + " | " + JSON.stringify(a19b));
    const m19 = fs.existsSync(cap(K1, "asked.json")) ? fs.statSync(cap(K1, "asked.json")).mtimeMs : 0;
    await sleep(40);
    const r19c = await ask(K1, { chatgpt: spec("a19a1"), gemini: gem("a19a2") }), a19c = askedOf(K1), m19c = fs.existsSync(cap(K1, "asked.json")) ? fs.statSync(cap(K1, "asked.json")).mtimeMs : 0;
    check("case 19c: a second run on the same folder (both assistants already asked): exit 0, the ASKED line says so, no page is loaded again, and asked.json is NEWER (its time and the file's) with both outcomes 'already asked'",
      r19c.code === 0 && last(r19c) === "ASKED: chatgpt already asked, gemini already asked" && JSON.stringify(a19c?.outcomes) === JSON.stringify({ chatgpt: "already asked", gemini: "already asked" }) && Date.parse(a19c?.at) > Date.parse(a19a?.at) && m19c > m19 && count("a19a1", "load") === 1 && count("a19a2", "load") === 1,
      d(r19c) + " | " + JSON.stringify(a19c) + " | mtime " + m19 + " -> " + m19c);
    }

    if (on("21")) {
    // ---- case 21 (J28): an engine the paste form does not take (perplexity: its terms bar a manual process too) is never asked by the script
    const J1 = await world(), la = count("ask1", "load"), lp = count("ask2", "load"), r21a = await ask(J1, { chatgpt: spec("ask1"), perplexity: spec("ask2") }), a21 = jr(cap(J1, "asked.json"));
    const dir21 = path.join(J1.pewp, "captures", "ai-oneshot"), of21 = fs.existsSync(dir21) ? fs.readdirSync(dir21).filter((x) => x.startsWith("perplexity")) : ["(no folder)"];
    check("case 21a: perplexity in the engines file: its page is never loaded, nothing of it is written (no blocked record either), it is in no ASKED line and not in asked.json, one LEFT OUT line names it and the stand-in RT-A, and the other is asked with no wait between assistants",
      J1.ok && r21a.code === 0 && count("ask1", "load") === la + 1 && count("ask2", "load") === lp && of21.length === 0 && last(r21a) === "ASKED: chatgpt read" && JSON.stringify(Object.keys(a21?.outcomes || {})) === JSON.stringify(["chatgpt"]) && lines(r21a, /^LEFT OUT: perplexity .*RT-A/).length === 1 && !r21a.sleeps.some((s) => s.why === "between assistants"),
      d(r21a) + " | loads " + (count("ask2", "load") - lp) + " | files " + of21.join(" ") + " | " + JSON.stringify(a21));
    const J2 = await world(); writeStop({ engine: "chatgpt", reason: "robot check", setBy: "the test", dir: J2.stops });
    const r21b = await ask(J2, { chatgpt: spec("unused"), perplexity: spec("ask2") });
    check("case 21b: the other assistant stopped: exit 3, the BLOCKED line names no perplexity and still ends ' | outside: stop'", r21b.code === 3 && /^BLOCKED: no assistant could be asked \(chatgpt: robot check, stopped until [^)]*\) \| .* \| outside: stop$/.test(last(r21b)), d(r21b) + " | last: " + last(r21b));
    const J3 = await world(), lp3 = count("ask2", "load"), r21c = await ask(J3, { chatgpt: spec("ask1"), perplexity: spec("ask2") }, { extra: ["--engines", "perplexity"] });
    check("case 21c: only perplexity asked for: exit 1 with a REFUSED line, no page loaded, no asked.json", r21c.code === 1 && /^REFUSED: perplexity is not asked/.test(last(r21c)) && count("ask2", "load") === lp3 && !fs.existsSync(cap(J3, "asked.json")), d(r21c));
    }

    if (on("20")) {
    // ---- case 20 (AB-13): the focus emulation is a declared behaviour. The script's CDP methods are recorded by a second preload (cdp-hook.mjs, the test's own --import beside the sleep hook): it wraps the global
    // WebSocket, so every message the script sends to the browser is appended as { m: method, e: params.enabled }, and it wraps io.sleep a second time so that every wait is appended as { s: why } in the same file and in the
    // same order. "A check is answered" is read from that order: the wait "after check" comes right after the look that found the check gone. Nothing here reads the server's clock.
    const cdpHook = path.join(tmp, "cdp-hook.mjs");
    fs.writeFileSync(cdpHook, 'import fs from "node:fs";\nimport { io } from ' + JSON.stringify(pathToFileURL(path.join(dir, "lib-ask-pace.mjs")).href) + ';\nconst L = (o) => fs.appendFileSync(process.env.ASK_CDP_LOG, JSON.stringify(o) + "\\n");\nconst Real = globalThis.WebSocket;\nglobalThis.WebSocket = class extends Real { send(d) { try { const m = JSON.parse(d); L({ m: m.method, e: m.params && m.params.enabled }); } catch { /* not JSON */ } return super.send(d); } };\nconst prev = io.sleep;\nio.sleep = (ms, why) => { L({ s: why }); return prev(ms, why); };\n');
    let c20n = 0;
    const ask20 = async (w, engines, over = {}) => {
      const f = path.join(tmp, "cdp" + c20n++ + ".log");
      const r = await ask(w, engines, { env: { NODE_OPTIONS: "--import " + pathToFileURL(hook).href + " --import " + pathToFileURL(cdpHook).href, ASK_CDP_LOG: f }, ...over });
      r.cdp = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
      return r;
    };
    const EMU = "Emulation.setFocusEmulationEnabled", idx = (r, f) => r.cdp.map((x, i) => [x, i]).filter(([x]) => f(x)).map(([, i]) => i);
    const K20a = await world(); PAGES.c20a.check.atChars = K20a.lock.text1.length;
    const r20a = await ask20(K20a, { chatgpt: spec("c20a", RING) }), ck20a = jr(cap(K20a, "chatgpt-check.json"));
    const offs = idx(r20a, (x) => x.m === EMU && x.e === false), ons = idx(r20a, (x) => x.m === EMU && x.e === true), fronts = idx(r20a, (x) => x.m === "Page.bringToFront"), afters = idx(r20a, (x) => x.s === "after check"), inserts = idx(r20a, (x) => x.m === "Input.insertText");
    const iOn = ons.find((i) => offs.length && i > offs[0]), iIns = inserts.find((i) => afters.length && i > afters[0]);
    check("case 20a: a ring engine, a check shows while text 1 is typed: the emulation is on from the start, enabled false is sent ONCE and BEFORE Page.bringToFront, no enabled true is sent until the check is answered (the 'after check' wait), and enabled true is sent after it and before the next Input.insertText (none was typed in between); exit 0",
      K20a.ok && r20a.code === 0 && last(r20a) === "ASKED: chatgpt read" && ons.length >= 2 && ons[0] < offs[0] && offs.length === 1 && fronts.length === 1 && offs[0] < fronts[0] && afters.length === 1 && ons.every((i) => i < offs[0] || i > afters[0]) && iOn !== undefined && iOn > afters[0] && iIns !== undefined && iOn < iIns && !inserts.some((i) => i > offs[0] && i < iOn),
      d(r20a) + " | offs " + offs + " ons " + ons + " fronts " + fronts + " afters " + afters + " iOn " + iOn + " iIns " + iIns + " | inserts " + inserts.length);
    const K20b = await world(), r20b = await ask20(K20b, { chatgpt: spec("c20b", { focus: "front" }) });
    const ins20 = idx(r20b, (x) => x.m === "Input.insertText"), fr20 = idx(r20b, (x) => x.m === "Page.bringToFront"), p1 = Math.ceil(nch(K20b.lock.text1) / PACE.typeCharactersPerSecond);
    check("case 20b: an engine with focus 'front': no Emulation.* method at all in the log, Page.bringToFront sent exactly twice, once before the first Input.insertText of each of the two texts; exit 0",
      K20b.ok && r20b.code === 0 && last(r20b) === "ASKED: chatgpt read" && !r20b.cdp.some((x) => String(x.m).startsWith("Emulation.")) && ins20.length > p1 && fr20.length === 2 && fr20[0] < ins20[0] && fr20[1] > ins20[p1 - 1] && fr20[1] < ins20[p1],
      d(r20b) + " | emulation calls " + JSON.stringify(r20b.cdp.filter((x) => String(x.m).startsWith("Emulation."))) + " | fronts " + fr20 + " first insert " + ins20[0] + " last of text 1 " + ins20[p1 - 1] + " first of text 2 " + ins20[p1]);
    const K20c = await world(), r20c = await ask20(K20c, { chatgpt: spec("c20c", { ...RING, focus: "front" }) }), ck20c = jr(cap(K20c, "chatgpt-check.json"));
    check("case 20c: the check record holds the focus mode: 'emulated' (the default, absent in the engine) on the run of 20a, 'front' on a run with a check and focus front, where still no Emulation.* method was sent",
      ck20a?.focus === "emulated" && r20c.code === 0 && ck20c?.focus === "front" && ck20c?.rang === true && !r20c.cdp.some((x) => String(x.m).startsWith("Emulation.")), d(r20c) + " | " + JSON.stringify(ck20a) + " | " + JSON.stringify(ck20c));
    const K20d = await world(), r20d = await ask20(K20d, { chatgpt: spec("c20d", { focus: "sideways" }) });
    check("case 20d: a focus value that is neither 'emulated' nor 'front' is exit 2 before any page is loaded, naming the engine and the key", K20d.ok && r20d.code === 2 && /chatgpt/.test(r20d.out) && /focus/.test(r20d.out) && count("c20d", "load") === 0 && r20d.cdp.length === 0, d(r20d));
    }

    if (on("10")) {
    // ---- case 10: the side list is in no file written and no line printed
    const files = walk(tmp).filter((f) => !/[\\/]net\.log$/.test(f)), hits = files.filter((f) => { try { return fs.readFileSync(f, "utf8").includes("HISTORY-MARKER"); } catch { return false; } });
    check("case 10: a side list on the page holds HISTORY-MARKER: the word is in no file written (" + files.length + " files looked at) and no line printed", files.length > 20 && hits.length === 0 && !allOut.some((o) => o.includes("HISTORY-MARKER")), "in: " + hits.join(", "));
    }
  } catch (e) {
    check("the test ran to its end", false, e.stack || e);
  }
  srv.close(); rmTmp(tmp);
  RAN = results.length;
  if (mu) console.log("   [this fault ran groups " + groups.join(" ") + ": " + RAN + " checks]");
  return results;
}

const one = (name, from, to, ...expect) => ({ name, patches: [{ file: "ask-assistants.mjs", from, to }], expect });
const lib = (name, from, to, ...expect) => ({ name, patches: [{ file: "lib-ask-pace.mjs", from, to }], expect });
const grp = (name, from, to, ...expect) => ({ name, patches: [{ file: "lib-ask-test-groups.mjs", from, to }], expect });
const PAUSE = "export const pause = (seconds, why) => io.sleep(seconds * 1000, why);";
const MUTANTS = [
  lib("the pauses are cut (no sleep is asked for)", PAUSE, "export const pause = (seconds, why) => Promise.resolve();", /^case 17a:/, /^case 17b:/, /^case 17c:/),
  one("the text is pasted in one piece", "pieces(text, pace.typeCharactersPerSecond)", "pieces(text, text.length + 1)", /^case 17a2:/),
  lib("the reading pause has no upper bound", "return Math.min(pace.readSecondsMax, Math.max(pace.readSecondsMin, wanted));", "return Math.max(pace.readSecondsMin, wanted);", /^case 17b:/),
  one("the wait between assistants is left out after a check", "if (robot) {", "if (robot) { opened = false;", /^case 17c:/),
  one("a pace number is read from the environment", "pace = checkPace(all.pace);", "pace = { ...checkPace(all.pace), afterLoadSeconds: Number(process.env.AFTER_LOAD_SECONDS) || all.pace.afterLoadSeconds };", /^case 17f:/),
  one("a flag that looks like a pace number is ignored", "if (!FLAGS.has(argv[i].slice(2))) throw", "if (false) throw", /^case 17f:/),
  lib("tabsAtOnce 2 is accepted", 'if (v !== 1) throw new PaceError(k, "pace tabsAtOnce must be exactly 1', 'if (v < 1) throw new PaceError(k, "pace tabsAtOnce must be exactly 1', /^case 17d:/),
  lib("a wait gets chance added", PAUSE, "export const pause = (seconds, why) => io.sleep(seconds * 1000 + Math.floor(Math.random() * 400), why);", /^case 17a:/, /^case 17g:/),
  one("the mode test is skipped", "if (!(await modeOn())) {", "if (false) {", /^case 3a:/),
  one("the robot test is skipped", "if (robot) {", "if (false) {", /^case 4a:/),
  one("the box check is skipped", "if (bx.code !== 0) {", "if (false) {", /^case 6:/),
  one("the already-asked test is removed", "if (fs.existsSync(first)) return \"already asked\";", "if (false) return \"already asked\";", /^case 7:/),
  one("the reader drops link addresses", "return text + \" [\" + href + \"]\";", "return text;", /^case 2:/),
  one("both engines are started at once", "for (const name of names) outcomes.push([name, await askEngine(name)]);", "await Promise.all(names.map(async (name) => outcomes.push([name, await askEngine(name)])));", /^case 8:/),
  one("the text goes in by key presses", "await c.send(\"Input.insertText\", { text: piece }, sid);", "for (const ch of piece) await c.send(\"Input.dispatchKeyEvent\", { type: \"keyDown\", key: ch, text: ch }, sid);", /^case 1b:/),
  one("the page text is written to a file", "pageText = null;", "fs.writeFileSync(path.join(cwd, \"page-text.txt\"), pageText); pageText = null;", /^case 10:/),
  one("a fresh context is ignored", "if (sp.freshContext) {", "if (false) {", /^case 12a:/),
  one("a refused reply ends the run", "if (sv.code !== 1) throw refused(sv);", "throw refused(sv);", /^case 13a:/, /^case 13b:/),
  one("the page title is not looked at", "ROBOT_WORDS.test(title) || ", "", /^case 14a:/, /^case 14b:/, /^case 14c:/, /^case 14d:/),
  one("the title wording 'just a moment' is gone", "just a moment|", "", /^case 14a:/),
  one("the title wording 'verify you are human' is gone", "verify you are (?:a )?human|", "", /^case 14b:/),
  one("the title wording 'checking your browser' is gone", "checking your browser|", "", /^case 14c:/),
  one("the title wording 'attention required' is gone", "|attention required", "", /^case 14d:/),
  one("the page text is not looked at", " || ROBOT_WORDS.test(pageText)", "", /^case 14e:/),
  one("all blocked still exits 0", "if (!anyAsked) {", "if (false) {", /^case 15a:/, /^case 15b:/),
  one("a ring is given on an engine that stops", 'rings = sp.humanCheck === "ring"', "rings = true", /^case 18e:/),
  one("no ring is given", "io.ring(name);", "/* no ring */", /^case 18a:/),
  one("a second ring", "io.ring(name);", "io.ring(name); io.ring(name);", /^case 18a:/),
  one("a piece is typed while the check shows (the later look before a piece is gone)", '          let g = await guard("typing " + n); if (g && g !== true) return g;', "          let g = null;", /^case 18f:/),
  { name: "the click on send is made while the check shows (both later looks before it are gone)", patches: [{ file: "ask-assistants.mjs", from: 'const gb = await guard("send " + n); if (gb && gb !== true) return gb;', to: "" }, { file: "ask-assistants.mjs", from: 'const gs = await guard("send " + n); if (gs && gs !== true) return gs;', to: "" }], expect: [/^case 18b3:/] },
  one("no stop on the second showing", 'writeRec(); return hardStop("robot check shown again after a person answered it"); }', 'writeRec(); return block(name, "robot check shown again after a person answered it"); }', /^case 18c:/),
  one("a stop is written when nobody answered", 'return block(name, "human check not answered in " + pace.checkWaitSeconds + " s");', 'return hardStop("human check not answered in " + pace.checkWaitSeconds + " s");', /^case 18d:/),
  one("the wait for an answer is twice as long as checkWaitSeconds", "        while (waited < pace.checkWaitSeconds) {\n          const w = Math.min(pace.checkLookSeconds, pace.checkWaitSeconds - waited);", "        while (waited < pace.checkWaitSeconds * 2) {\n          const w = pace.checkLookSeconds;", /^case 18d:/),
  one("the page text is part of the later look", 'const laterLook = async () => ROBOT_WORDS.test(String(await ev("document.title"))) || await has(CHECK_FRAME);', 'const laterLook = async () => ROBOT_WORDS.test(String(await ev("document.title"))) || ROBOT_WORDS.test(String(await ev("document.body ? document.body.innerText : \'\'"))) || await has(CHECK_FRAME);', /^case 18b4:/),
  one("a page loaded again by the check is not noticed", "if (origin !== null && o !== origin)", "if (false)", /^case 18f:/),
  lib("checkWaitSeconds 59 is accepted", "checkWaitSeconds: [60, 600]", "checkWaitSeconds: [59, 600]", /^case 17d:/),
  lib("checkLookSeconds 1 is accepted", "checkLookSeconds: [2, 30]", "checkLookSeconds: [1, 30]", /^case 17d:/),
  one("asked.json is not written when the run ends BLOCKED", 'fs.writeFileSync(askedFile, JSON.stringify({ step: "ai-ask"', 'if (anyAsked) fs.writeFileSync(askedFile, JSON.stringify({ step: "ai-ask"', /^case 19b:/),
  one("asked.json is not written again by a second run", 'fs.writeFileSync(askedFile, JSON.stringify({ step: "ai-ask"', 'if (!fs.existsSync(askedFile)) fs.writeFileSync(askedFile, JSON.stringify({ step: "ai-ask"', /^case 19c:/),
  one("the emulation is left on when the check shows", 'await c.send("Emulation.setFocusEmulationEnabled", { enabled: false }, sid); emuOff = true;', "emuOff = true;", /^case 20a:/),
  one("the emulation is switched on again while the check still shows", 'await pause(w, "human check"); waited += w;', 'await pause(w, "human check"); waited += w; try { await c.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sid); } catch { /* x */ }', /^case 20a:/),
  one("a front engine still gets the emulation", 'if (focus !== "front") { try { await c.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sid); }', 'if (true) { try { await c.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sid); }', /^case 20b:/),
  one("a front engine is not brought to the front before its texts", 'if (focus === "front") await front();', "", /^case 20b:/),
  one("the check record does not say the focus mode", "secondShowing: false, focus };", "secondShowing: false };", /^case 20c:/),
  one("the engine the paste form does not take is asked", "const names = listed.filter((n) => !LEFT_OUT.has(n));", "const names = listed;", /^case 21a:/, /^case 21b:/, /^case 21c:/),
  one("a left-out engine is not named", 'for (const n of listed) if (LEFT_OUT.has(n)) console.log(', 'for (const n of listed) if (false) console.log(', /^case 21a:/),
  one("nothing left to ask is not refused", "if (!names.length) throw new Stop(\"REFUSED: \"", "if (false) throw new Stop(\"REFUSED: \"", /^case 21c:/),
  lib("a bad focus value is accepted", "if (!FOCUS_MODES.has(v)) throw new Error(", "if (false) throw new Error(", /^case 20d:/),
  grp("a fault is sent to one fixed group, not the group of its cases", "CASE_GROUP[Number(m[1])]", "CASE_GROUP[3]", /^case G1:/, /^case G2:/),
  grp("case 10 does not bring group 1", 'export const NEEDS = { "10": ["1"] };', "export const NEEDS = {};", /^case G3:/),
  grp("a pattern that names no case is quietly sent to group 1", 'if (!g) throw new Error("the pattern "', 'if (!g) return "1"; if (false) throw new Error("the pattern "', /^case G4:/),
  grp("an unknown group name is accepted", 'if (!GROUPS.includes(n)) throw new Error("unknown group "', 'if (false) throw new Error("unknown group "', /^case G4:/),
  one("an outcome is cut to its first word in asked.json", "outcomes: Object.fromEntries(outcomes) }", "outcomes: Object.fromEntries(outcomes.map(([n, o]) => [n, o.split(\" \")[0]])) }", /^case 19b:/, /^case 19c:/),
];

// A pass of the faults: --groups limits them to the faults whose groups are inside the named ones; every fault then runs ONLY the groups its expect patterns name (lib-ask-test-groups.mjs derives them).
// --faults-only: the unmutated pass is NOT run here (0 checks; the plain entry of scripts/ci-tests.json runs every group once), so a fault costs only its own groups.
const FAULTS = PLAIN ? MUTANTS.filter((m) => groupsFor(m.expect).every((g) => PLAIN.includes(g))) : MUTANTS;
if (FAULTS_ONLY) console.log("FAULTS ONLY: the unmutated pass is not run in this command (0 checks); the plain entry runs every group once. Faults: " + FAULTS.length + " of " + MUTANTS.length);
const code = await main({ label: "ASK ASSISTANTS", scenarios, MUTANTS: FAULTS, scriptsDir: here, argv: process.argv.slice(2) });
closeBrowser();
if (PLAIN || FAULTS_ONLY) console.log("GROUPS of the unmutated pass: " + (PASS_GROUPS.join(" ") || "none (faults only)"));
process.exit(code);
