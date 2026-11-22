// Usage: node test-ask-assistants.mjs [--no-mutants] [--mutant <text>] [--json]
// Test of ask-assistants.mjs THROUGH THE COMMAND: it asks invented assistant pages (a server on 127.0.0.1) in ONE real headless browser on a temp profile and
// reads back what each page counted (key presses, clicks, sends, loads, a heartbeat while its tab is open). The run is invented as test-ai-oneshot.mjs invents
// one (a business file, the two texts built and locked); every save is ai-oneshot.mjs's own file. No network, no real assistant, no clipboard.
// Run it through the machine heavy lock (a browser): node ~/.claude/scripts/heavy.mjs -- node test-ask-assistants.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runner, J, W, walk, mkTmp, rmTmp, checker, main } from "./lib-test-kit.mjs";
import { spawnBrowser } from "./lib-browser-profile.mjs";
import { CHROME_PATH } from "./cdp-measure.mjs";
import { connect } from "./vantage.mjs";
import { writeStop } from "./lib-stops.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = "https://sample-valley-realty.test/", HOST = "sample-valley-realty.test";
const BIZ = { name: "Sample Valley Realty", domain: HOST, phone: "(555) 010-2000", kind: "real estate agent", market: { country: "US", language: "en" },
  locations: [{ name: "Sampleville, CA", address: "1 Main St, Sampleville, CA 90000", serviceArea: ["Sampleville, CA", "Testburg, CA"] }],
  vocabulary: ["homes for sale", "real estate agent", "sell my house", "home valuation"], related: [{ relation: "brokerage", name: "Beta Realty", domain: "beta-realty.test" }] };
const BROWSER_WORDS = "work browser (Edge, US exit)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  robotTitle: { kind: "robot", title: "Attention Required", text: "Please stand by." }, robotText: { kind: "robot", title: "Just a page", text: "Verifying you are human. This may take a few seconds." },
};
const html = (name, cfg) => {
  const chat = cfg.kind === "chat";
  const body = cfg.kind === "robot" ? '<p>' + (cfg.text || "Please verify you are human. captcha") + '</p><button id="x">Verify</button>'
    : cfg.kind === "signin" ? '<p>Please sign in to continue</p><form><input type="password" id="pw"><button id="go">Sign in</button></form>'
    : '<div id="mode-area">' + (cfg.modeOn ? '<div id="temp-on">Temporary chat is on</div>' : "") + (cfg.modeBtn ? '<button id="mode-btn">Temporary chat</button>' : "") + '</div>'
      + '<div id="chat"></div><div id="busy-area"></div><textarea id="box" rows="4" cols="60"></textarea><button id="send">Send</button>';
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + (cfg.title || name) + '</title></head><body><h1>Invented assistant</h1>'
    + '<aside id="side"><ul><li>HISTORY-MARKER an earlier chat about something</li></ul></aside><main>' + body + '</main><script>'
    + 'const P=' + JSON.stringify(name) + ', CFG=' + JSON.stringify(cfg) + ';'
    + 'const ev=(k,x)=>navigator.sendBeacon("/__ev?k="+k+"&p="+P+"&x="+encodeURIComponent(x||""));'
    + 'document.addEventListener("keydown",()=>ev("key"),true);document.addEventListener("keypress",()=>ev("key"),true);'
    + 'document.addEventListener("click",(e)=>ev("click",e.target.id||e.target.tagName),true);'
    + 'setInterval(()=>ev("beat"),200);'
    + (chat ? '(function(){const box=document.getElementById("box"),chat=document.getElementById("chat"),busyArea=document.getElementById("busy-area");let n=0;'
      + 'const mb=document.getElementById("mode-btn");if(mb)mb.addEventListener("click",()=>{if(!document.getElementById("temp-on")){const d=document.createElement("div");d.id="temp-on";d.textContent="Temporary chat is on";document.getElementById("mode-area").appendChild(d);}});'
      + 'box.addEventListener("input",()=>{ev("input");if(CFG.mangle&&!box.dataset.m){box.dataset.m="1";box.value+=" XTRA";}});'
      + 'document.getElementById("send").addEventListener("click",()=>{ev("send",String(box.value.length));if(CFG.silent)return;n++;const k=n;box.value="";busyArea.innerHTML=\'<div id="busy">Thinking</div>\';'
      + 'const r=document.createElement("div");r.className="reply";chat.appendChild(r);'
      + 'const chunks=CFG.short===k?["<p>Too short reply no."+k+"</p>"]:["<h2>Part 1: your recommendations ("+k+")</h2>","<p>Filler paragraph with enough words so that the whole reply is longer than two hundred characters for the saved record, reply number "+k+", going on and on a little more.</p>",'
      + '"<table><thead><tr><th>Rank</th><th>Name</th><th>Source</th></tr></thead><tbody><tr><td>1</td><td>Alpha Homes</td><td><a href=\\"https://alpha-homes.test/q"+k+"\\">Alpha Homes site</a></td></tr></tbody></table>",'
      + '"<ul><li>first point</li><li>second point</li></ul>","<p>Plain address: <a href=\\"https://zeta.test/\\">https://zeta.test/</a></p>","<p>END-OF-REPLY-"+k+"</p>"];'
      + 'let i=0;const t=setInterval(()=>{r.insertAdjacentHTML("beforeend",chunks[i++]);if(i>=chunks.length){clearInterval(t);busyArea.innerHTML="";}},350);});})();' : "")
    + '</script></body></html>';
};
async function startServer() {
  const log = [], hooks = {};   // hooks[page]: run when that page's send arrives
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"), t = Date.now(), m = u.pathname.match(/^\/p\/([A-Za-z0-9]+)$/);
    const cookie = String(req.headers.cookie || "");   // every request is logged with the Cookie header it carried
    if (u.pathname === "/__ev") { log.push({ t, kind: u.searchParams.get("k"), page: u.searchParams.get("p"), x: u.searchParams.get("x") || "", cookie }); if (u.searchParams.get("k") === "send" && hooks[u.searchParams.get("p")]) hooks[u.searchParams.get("p")](); res.statusCode = 204; return res.end(); }
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
async function scenarios(dir) {
  const results = [], check = checker(results), tmp = mkTmp("ask-assistants"), home = path.join(tmp, "home");
  fs.mkdirSync(home);
  const srv = await startServer(), br = await browser();
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
  let ef = 0;
  const ask = async (w, engines, { port = br.port, extra = [] } = {}) => {
    const file = path.join(tmp, "engines" + ef++ + ".json"); W(file, engines);
    const r = await run("ask-assistants.mjs", [SITE, "--engines-file", file, ...(port ? ["--port", String(port)] : []), "--cwd", w.cwd, ...extra], { env: { OMNIKOM_STOPS_DIR: w.stops, TEMP: w.temp, TMP: w.temp, TMPDIR: w.temp }, timeout: 240000 });
    allOut.push(r.out); return r;
  };
  const cap = (w, f) => path.join(w.pewp, "captures", "ai-oneshot", f), jr = (p) => (fs.existsSync(p) ? J(p) : null);
  const count = (page, kind) => srv.log.filter((e) => e.page === page && e.kind === kind).length;
  const d = (r) => "exit " + r.code + " | " + r.out.slice(0, 600);
  const blockedWhy = (w, e) => jr(cap(w, e + "-blocked.json"))?.blocked ?? null;
  const last = (r) => r.out.trim().split("\n").pop();
  try {
    // ---- case 1, 2, 8: the good page and a second good page, asked one after the other
    const A = await world();
    const r1 = await ask(A, { chatgpt: spec("good1"), perplexity: spec("good2") });
    const c1 = jr(cap(A, "chatgpt-1.json")), c2 = jr(cap(A, "chatgpt-2.json")), p1 = jr(cap(A, "perplexity-1.json"));
    const tabs = await openTabs(br.port, srv.base);
    check("case 1a: the good page: both replies are saved by ai-oneshot's own files, the reply that came in pieces over 2 s is whole, the last line says what was done",
      A.ok && r1.code === 0 && !!c1 && !!c2 && /END-OF-REPLY-1/.test(c1.answerText) && /Part 1: your recommendations \(1\)/.test(c1.answerText) && /END-OF-REPLY-2/.test(c2.answerText) && c1.pasted === "clipboard, box checked" && last(r1) === "ASKED: chatgpt read, perplexity read", d(r1) + " | c1 tail: " + String(c1?.answerText).slice(-80));
    const chars = A.lock.text1.length + A.lock.text2.length;   // a paste into a box fires a few input events (about one per line), never one per character
    check("case 1b: 0 character key presses, both texts pasted (a few input events, never one per character), 2 sends, 1 page load for both messages, and the tab is gone afterwards",
      count("good1", "key") === 0 && count("good1", "input") > 1 && count("good1", "input") * 4 < chars && count("good1", "send") === 2 && count("good1", "load") === 1 && tabs && tabs.length === 0, "keys " + count("good1", "key") + " inputs " + count("good1", "input") + " of " + chars + " characters," + " sends " + count("good1", "send") + " loads " + count("good1", "load") + " tabs " + (tabs ? tabs.length : "?"));
    check("case 1c: the saved record holds the mode and the browser words, and says whether it was signed in", c1?.mode === "temporary chat" && c1.browser === BROWSER_WORDS && c1.signedIn === false && c2?.mode === "temporary chat", JSON.stringify({ mode: c1?.mode, browser: c1?.browser, signedIn: c1?.signedIn }));
    const t1 = String(p1?.answerText || "");
    check("case 2: a table and a link whose text is not its address: the saved text has the '| ' rows and the full address; a link whose text is its address is not doubled",
      /^\| 1 \| Alpha Homes \| Alpha Homes site \[https:\/\/alpha-homes\.test\/q1\] \|$/m.test(t1) && /^\| Rank \| Name \| Source \|$/m.test(t1) && /^## Part 1|^## .*Part 1/m.test(t1) && /^- first point$/m.test(t1) && /Plain address: https:\/\/zeta\.test\/(\s|$)/.test(t1) && !/zeta\.test\/ \[https/.test(t1), t1.slice(0, 700));
    const beats1 = srv.log.filter((e) => e.page === "good1" && e.kind === "beat").map((e) => e.t), load2 = srv.log.find((e) => e.page === "good2" && e.kind === "load");
    check("case 8: two engines: the second page's first load comes after the first tab closed (its heartbeat has stopped)", beats1.length > 5 && !!load2 && Math.max(...beats1) < load2.t, "beats " + beats1.length + " last beat " + Math.max(...beats1) + " second load " + load2?.t);

    // ---- case 3: the mode
    const B = await world(), rb = await ask(B, { chatgpt: spec("modeNever", { modeSteps: [] }) });
    check("case 3a: modeProof never matches: the box stayed empty, 0 sends, blocked 'temporary chat not confirmed', nothing saved",
      rb.code === 3 && count("modeNever", "input") === 0 && count("modeNever", "send") === 0 && blockedWhy(B, "chatgpt") === "temporary chat not confirmed" && !fs.existsSync(cap(B, "chatgpt-1.json")), d(rb));
    const B2 = await world(), rb2 = await ask(B2, { chatgpt: spec("modeSteps", { modeSteps: ["#mode-btn"] }) });
    check("case 3b: with modeSteps that switch it on (clicked once): asked normally, both saved, the mode is in the record",
      rb2.code === 0 && srv.log.filter((e) => e.page === "modeSteps" && e.kind === "click" && e.x === "mode-btn").length === 1 && !!jr(cap(B2, "chatgpt-2.json")) && count("modeSteps", "send") === 2, d(rb2) + " mode clicks " + srv.log.filter((e) => e.page === "modeSteps" && e.kind === "click" && e.x === "mode-btn").length);

    // ---- case 4: a robot check
    const C = await world(), rc = await ask(C, { chatgpt: spec("robot") }), stopFile = path.join(C.stops, "chatgpt.json");
    const loadsAfter1 = count("robot", "load"), rc2 = await ask(C, { chatgpt: spec("robot") });
    check("case 4a: a robot-check page: 0 clicks and 0 key presses, blocked 'robot check', a stop file for the engine",
      rc.code === 3 && count("robot", "click") === 0 && count("robot", "key") === 0 && blockedWhy(C, "chatgpt") === "robot check" && fs.existsSync(stopFile) && /robot check/.test(fs.readFileSync(stopFile, "utf8")), d(rc));
    check("case 4b: a second run does not load the page again (the stop holds)", loadsAfter1 === 1 && count("robot", "load") === 1 && rc2.code === 3 && /stopped until/.test(last(rc2)), "loads " + count("robot", "load") + " | " + d(rc2));

    // ---- case 5: a sign-in wall
    const D = await world(), rd = await ask(D, { chatgpt: spec("signin") });
    check("case 5: a sign-in wall: blocked 'sign-in wall', no stop file, 0 key presses, 0 inputs, 0 clicks",
      rd.code === 3 && blockedWhy(D, "chatgpt") === "sign-in wall" && !fs.existsSync(path.join(D.stops, "chatgpt.json")) && count("signin", "key") === 0 && count("signin", "input") === 0 && count("signin", "click") === 0, d(rd));

    // ---- case 6: a box that changes the text
    const E = await world(), re = await ask(E, { chatgpt: spec("mangle") });
    check("case 6: a box that changes the text put into it: 0 sends, blocked 'the box did not hold the text', nothing saved",
      re.code === 3 && count("mangle", "input") >= 1 && count("mangle", "send") === 0 && blockedWhy(E, "chatgpt") === "the box did not hold the text" && !fs.existsSync(cap(E, "chatgpt-1.json")), d(re));

    // ---- case 7: reply 1 already on file
    const F = await world(), boxF = path.join(tmp, "f-box.txt"), ansF = path.join(tmp, "f-reply.txt");
    W(boxF, F.lock.text1); W(ansF, "An earlier reply, long enough to be saved as a whole reply by the command. ".repeat(6));
    const f1 = await F.cmd("box", "chatgpt", "1", "--file", boxF), f2 = await F.cmd("save", "chatgpt", "1", "--file", ansF), rf = await ask(F, { chatgpt: spec("unused") });
    check("case 7: reply 1 already on file: 0 loads of that engine's page, nothing sent, the line says 'already asked'",
      f1.code === 0 && f2.code === 0 && rf.code === 0 && count("unused", "load") === 0 && count("unused", "send") === 0 && /chatgpt already asked/.test(last(rf)), d(f2) + " | " + d(rf));

    // ---- case 9: a page that never answers
    const G = await world(), rg = await ask(G, { chatgpt: spec("silent", { capSeconds: 3 }) });
    check("case 9: a page that never answers, capSeconds 3: blocked 'no reply in 3 s'", rg.code === 3 && count("silent", "send") === 1 && blockedWhy(G, "chatgpt") === "no reply in 3 s" && !fs.existsSync(cap(G, "chatgpt-1.json")), d(rg));

    // ---- case 11: no port, a page description not set, an engine the file does not have
    const H = await world(), rh = await ask(H, { chatgpt: spec("unused") }, { port: null });
    check("case 11a: no port given and none to find: exit 3 with the BLOCKED line, nothing loaded", rh.code === 3 && /^BLOCKED: the work browser is not open \| unblocks: node work-browser\.mjs open/m.test(rh.out) && count("unused", "load") === 0, d(rh));
    const I = await world(), ri = await ask(I, { chatgpt: { selectors: "NOT SET" } });
    check("case 11b: an engine with \"selectors\": \"NOT SET\": blocked 'page description not set', 0 loads, nothing opened", ri.code === 3 && blockedWhy(I, "chatgpt") === "page description not set" && /chatgpt: page description not set/.test(last(ri)) && (await openTabs(br.port, srv.base))?.length === 0, d(ri));
    const rj = await ask(I, { chatgpt: spec("unused") }, { extra: ["--engines", "bing"] });
    check("case 11c: an engine name the file does not have is a usage error (exit 2)", rj.code === 2 && count("unused", "load") === 0, d(rj));

    // ---- case 12: a fresh context carries no cookie of the browser's own session
    const ctxCount = async () => { const k = await connect(br.port); try { return (await k.send("Target.getBrowserContexts")).browserContextIds.length; } finally { k.close(); } };
    const ctx0 = await ctxCount(), ck = (page) => srv.log.filter((e) => e.page === page), seen = (page) => ck(page).filter((e) => e.cookie).length;
    const K = await world(), rk = await ask(K, { chatgpt: spec("ck1"), perplexity: spec("ck2", { freshContext: true }) });
    const ctx1 = await ctxCount();
    check("case 12a: the second assistant is marked freshContext: its page load carried NO cookie (the first assistant's visit left one in the browser's own session), and both assistants' replies are saved",
      rk.code === 0 && ck("ck1").length > 1 && count("ck2", "load") === 1 && ck("ck2").length > 2 && ck("ck2").find((e) => e.kind === "load").cookie === "" && ck("ck1").some((e) => e.cookie) && !!jr(cap(K, "chatgpt-2.json")) && !!jr(cap(K, "perplexity-1.json")) && !!jr(cap(K, "perplexity-2.json")), d(rk) + " | ck2 load cookie: '" + ((ck("ck2").find((e) => e.kind === "load") || {}).cookie || "") + "'");
    const K2 = await world(), rk2 = await ask(K2, { chatgpt: spec("ck1"), perplexity: spec("ck2") });
    check("case 12b: the control, the same two without freshContext: the server DID see the cookie on the second assistant", rk2.code === 0 && seen("ck2") > 0 && ck("ck2").some((e) => e.kind === "load" && e.cookie), d(rk2) + " | ck2 requests with a cookie " + seen("ck2"));
    check("case 12c: after the run the browser has no more browser contexts than before it", ctx1 === ctx0, "before " + ctx0 + " after the fresh-context run " + ctx1);

    // ---- case 13: a reply that ai-oneshot save refuses
    const R1 = await world(), rr1 = await ask(R1, { chatgpt: spec("short1"), perplexity: spec("ask1") });
    check("case 13a: message 1 of the first answered with 20 characters: the first is blocked 'reply refused: REFUSED: the text is 20 characters...', nothing saved for it, the second is read, exit 0, the last line names both",
      rr1.code === 0 && /^reply refused: REFUSED: the text is 20 characters/.test(String(blockedWhy(R1, "chatgpt"))) && !fs.existsSync(cap(R1, "chatgpt-1.json")) && !!jr(cap(R1, "perplexity-2.json")) && /^ASKED: chatgpt blocked \(reply refused: REFUSED: the text is 20 characters.*\), perplexity read$/.test(last(rr1)), d(rr1));
    const R2 = await world(), rr2 = await ask(R2, { chatgpt: spec("short2") });
    check("case 13b: the second reply is 20 characters: reply 1 is on file, no blocked record, no reply 2, exit 0, the last line says 'follow-up refused'",
      rr2.code === 0 && !!jr(cap(R2, "chatgpt-1.json")) && !fs.existsSync(cap(R2, "chatgpt-blocked.json")) && !fs.existsSync(cap(R2, "chatgpt-2.json")) && /^ASKED: chatgpt read, follow-up refused: REFUSED: the text is 20 characters/.test(last(rr2)), d(rr2));
    const R3 = await world(); srv.hooks.lockGone = () => { try { fs.rmSync(path.join(R3.pewp, "captures", "ai-oneshot", "prompt-lock.json")); } catch { /* gone */ } };
    const lockLoads = count("ask1", "load"), rr3 = await ask(R3, { chatgpt: spec("lockGone"), perplexity: spec("ask1") });
    check("case 13c: a save that exits 3 (the lock was removed while the reply came in) still ends the run: exit 3, the BLOCKED line, the second assistant is never opened",
      rr3.code === 3 && /^BLOCKED: the prompt is not locked/m.test(rr3.out) && count("ask1", "load") === lockLoads, d(rr3));

    // ---- case 14: a robot check that shows in the page's title (the body holds none of the words)
    const titled = async (page, label) => { const w = await world(), r = await ask(w, { chatgpt: spec(page) }), stopF = path.join(w.stops, "chatgpt.json"), loads = count(page, "load"), r2 = await ask(w, { chatgpt: spec(page) });
      return { label, ok: r.code === 3 && blockedWhy(w, "chatgpt") === "robot check" && fs.existsSync(stopF) && count(page, "click") === 0 && count(page, "key") === 0 && loads === 1 && count(page, "load") === 1 && r2.code === 3, why: label + ": " + d(r) + " loads " + count(page, "load") }; };
    const q1 = await titled("robotJam", "Just a moment..."), q2 = await titled("robotVerify", "Verify you are human"), q3 = await titled("robotCheck", "Checking your browser"), q4 = await titled("robotTitle", "Attention Required"), q5 = await titled("robotText", "a neutral title, the words only in the body");
    check("case 14a: a page titled 'Just a moment...' whose body holds none of the words: blocked 'robot check', a stop file, 0 clicks, 0 key presses, a second run does not load it", q1.ok, q1.why);
    check("case 14b: a page titled 'Verify you are human' (body without the words): the same", q2.ok, q2.why);
    check("case 14c: a page titled 'Checking your browser' (body without the words): the same", q3.ok, q3.why);
    check("case 14d: a page titled 'Attention Required' (body without the words): the same", q4.ok, q4.why);
    check("case 14e: a neutral title and the body 'Verifying you are human. This may take a few seconds.': the same", q5.ok, q5.why);

    // ---- case 15: the run ends BLOCKED when no assistant could be asked
    const stopFor = (w, engine) => writeStop({ engine, reason: "robot check", setBy: "the test", dir: w.stops });
    const S1 = await world(); stopFor(S1, "chatgpt"); const rs1 = await ask(S1, { chatgpt: spec("unused") });
    check("case 15a: one assistant, stopped: exit 3, the BLOCKED line says 'stopped until' and ends ' | outside: stop', a blocked record is on file, 0 pages loaded",
      rs1.code === 3 && /^BLOCKED: no assistant could be asked \(chatgpt: robot check, stopped until \d{4}-\d\d-\d\dT[\d:.]+Z\) \| unblocks: the stops end or the owner lifts them; the page descriptions are set \| outside: stop$/.test(last(rs1)) && blockedWhy(S1, "chatgpt") === "robot check" && count("unused", "load") === 0, d(rs1) + " | last: " + last(rs1));
    const S2 = await world(); stopFor(S2, "chatgpt"); const rs2 = await ask(S2, { chatgpt: spec("unused"), perplexity: { selectors: "NOT SET" } });
    check("case 15b: two assistants, one stopped and one 'NOT SET': exit 3, no 'outside' mark, both reasons named",
      rs2.code === 3 && /^BLOCKED: no assistant could be asked \(chatgpt: robot check, stopped until .*Z, perplexity: page description not set\) \| unblocks: /.test(last(rs2)) && !/outside:/.test(last(rs2)) && count("unused", "load") === 0, d(rs2) + " | last: " + last(rs2));
    const S3 = await world(); stopFor(S3, "chatgpt"); const rs3 = await ask(S3, { chatgpt: spec("unused"), perplexity: spec("ask2") });
    check("case 15c: two assistants, one stopped and one read: exit 0 and the ASKED line", rs3.code === 0 && !!jr(cap(S3, "perplexity-2.json")) && last(rs3) === "ASKED: chatgpt blocked (robot check), perplexity read", d(rs3) + " | last: " + last(rs3));

    // ---- case 10: the side list is in no file written and no line printed
    const files = walk(tmp).filter((f) => !/[\\/]net\.log$/.test(f)), hits = files.filter((f) => { try { return fs.readFileSync(f, "utf8").includes("HISTORY-MARKER"); } catch { return false; } });
    check("case 10: a side list on the page holds HISTORY-MARKER: the word is in no file written (" + files.length + " files looked at) and no line printed", files.length > 20 && hits.length === 0 && !allOut.some((o) => o.includes("HISTORY-MARKER")), "in: " + hits.join(", "));
  } catch (e) {
    check("the test ran to its end", false, e.stack || e);
  }
  srv.close(); rmTmp(tmp);
  return results;
}

const one = (name, from, to, ...expect) => ({ name, patches: [{ file: "ask-assistants.mjs", from, to }], expect });
const MUTANTS = [
  one("the mode test is skipped", "if (!(await modeOn())) {", "if (false) {", /^case 3a:/),
  one("the robot test is skipped", "if (robot) {", "if (false) {", /^case 4a:/),
  one("the box check is skipped", "if (bx.code !== 0) {", "if (false) {", /^case 6:/),
  one("the already-asked test is removed", "if (fs.existsSync(first)) return \"already asked\";", "if (false) return \"already asked\";", /^case 7:/),
  one("the reader drops link addresses", "return text + \" [\" + href + \"]\";", "return text;", /^case 2:/),
  one("both engines are started at once", "for (const name of names) outcomes.push([name, await askEngine(name)]);", "await Promise.all(names.map(async (name) => outcomes.push([name, await askEngine(name)])));", /^case 8:/),
  one("the text goes in by key presses", "await c.send(\"Input.insertText\", { text }, sid);", "for (const ch of text) await c.send(\"Input.dispatchKeyEvent\", { type: \"keyDown\", key: ch, text: ch }, sid);", /^case 1b:/),
  one("the page text is written to a file", "pageText = null;", "fs.writeFileSync(path.join(cwd, \"page-text.txt\"), pageText); pageText = null;", /^case 10:/),
  one("a fresh context is ignored", "if (sp.freshContext) {", "if (false) {", /^case 12a:/),
  one("a refused reply ends the run", "if (sv.code !== 1) throw refused(sv);", "throw refused(sv);", /^case 13a:/, /^case 13b:/),
  one("the page title is not looked at", "ROBOT_WORDS.test(title) || ", "", /^case 14a:/, /^case 14b:/, /^case 14c:/, /^case 14d:/),
  one("the title wording 'just a moment' is gone", "just a moment|", "", /^case 14a:/),
  one("the title wording 'verify you are human' is gone", "verify you are (?:a )?human|", "", /^case 14b:/),
  one("the title wording 'checking your browser' is gone", "checking your browser|", "", /^case 14c:/),
  one("the title wording 'attention required' is gone", "|attention required", "", /^case 14d:/),
  one("the page text is not looked at", " || ROBOT_WORDS.test(pageText)", "", /^case 14e:/),
  one("all blocked still exits 0", "if (!outcomes.some(([, o]) => o === \"already asked\" || o.startsWith(\"read\"))) {", "if (false) {", /^case 15a:/, /^case 15b:/),
];

const code = await main({ label: "ASK ASSISTANTS", scenarios, MUTANTS, scriptsDir: here, argv: process.argv.slice(2) });
closeBrowser();
process.exit(code);
