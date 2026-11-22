// Usage: node test-open-plain.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Test of the plain opener (AB-12): a script that drives the WORK BROWSER opens its tab plainly (work-browser.mjs: "no geolocation override"): Target.createTarget, Target.attachToTarget, Page.enable,
// Page.navigate and the wait for the load. No permission is granted and no location is set, so a reading is the work browser's own. vantage.mjs openPage keeps its old calls for the vantage tool's own
// captures (Sacramento location). NO browser and no network: a fake cdp records every method it is sent and answers what the opener needs. Watched-fail mutants: see lib-test-kit.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { checker, main } from "./lib-test-kit.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(A.includes("--scripts") ? A[A.indexOf("--scripts") + 1] : here);
const imp = (dir, f) => import(pathToFileURL(path.join(dir, f)).href);
const PLAIN = ["Target.createTarget", "Target.attachToTarget", "Page.enable", "Page.navigate"];

// the fake: records { method, params, sessionId }; answers a target, a session, and fires Page.loadEventFired for that session after Page.navigate
function fakeCdp() {
  const calls = [], listeners = new Set();
  const send = async (method, params = {}, sessionId) => {
    calls.push({ method, params, sessionId });
    if (method === "Target.createTarget") return { targetId: "T1" };
    if (method === "Target.attachToTarget") return { sessionId: "S1" };
    if (method === "Page.navigate") setTimeout(() => { for (const l of [...listeners]) l({ sessionId: "S1", method: "Page.loadEventFired" }); }, 0);
    return {};
  };
  return { calls, listeners, send };
}
const names = (c) => c.calls.map((x) => x.method);
const T = async (fn) => { try { return await fn(); } catch (e) { return [false, "threw: " + (e && e.message)]; } };

async function scenarios(dir) {
  const results = [], check = checker(results);
  const v = await T(() => imp(dir, "vantage.mjs")).then((x) => (Array.isArray(x) ? {} : x));
  const nap = async () => {};   // openPlain takes its settle wait from the caller: the test does not wait the real 2 seconds

  { const [ok, detail] = await T(async () => {
    const c = fakeCdp(), r = await v.openPlain(c, "https://x.test/", { sleep: nap }), bad = [];
    if (names(c).join() !== PLAIN.join()) bad.push("methods " + names(c).join());
    if (names(c).some((m) => /^(Emulation\.|Browser\.)/.test(m))) bad.push("an Emulation or Browser call was sent");
    const p = (m) => c.calls.find((x) => x.method === m) || {};
    if (JSON.stringify(p("Target.createTarget").params) !== '{"url":"about:blank"}' || JSON.stringify(p("Target.attachToTarget").params) !== '{"targetId":"T1","flatten":true}' || p("Page.enable").sessionId !== "S1" || p("Page.navigate").sessionId !== "S1" || p("Page.navigate").params.url !== "https://x.test/") bad.push("params " + JSON.stringify(c.calls));
    if (JSON.stringify(r) !== '{"sessionId":"S1","targetId":"T1","loaded":true}') bad.push("returned " + JSON.stringify(r));
    if (c.listeners.size !== 0) bad.push("a listener is left behind");
    return [bad.length === 0, bad.join(" | ")];
  }); check("O1: openPlain sends exactly Target.createTarget, Target.attachToTarget, Page.enable, Page.navigate in that order, no Emulation. and no Browser.grantPermissions, and returns { sessionId, targetId, loaded: true }", ok, detail); }

  { const [ok, detail] = await T(async () => {
    const c = fakeCdp(), r = await v.openPage(c, "https://x.test/", ["https://extra.test"]), bad = [];   // takes the real 2 seconds of its settle: openPage is left as it was
    const want = ["Browser.grantPermissions", "Target.createTarget", "Target.attachToTarget", "Page.enable", "Emulation.setGeolocationOverride", "Page.navigate"];
    if (names(c).join() !== want.join()) bad.push("methods " + names(c).join());
    const g = c.calls.find((x) => x.method === "Browser.grantPermissions"), e = c.calls.find((x) => x.method === "Emulation.setGeolocationOverride");
    if (!g || JSON.stringify(g.params) !== JSON.stringify({ origins: [...v.ORIGINS, "https://extra.test"], permissions: ["geolocation"] })) bad.push("grant " + JSON.stringify(g));
    if (!e || e.sessionId !== "S1" || JSON.stringify(e.params) !== JSON.stringify({ latitude: v.GEO.lat, longitude: v.GEO.lon, accuracy: v.GEO.accuracy })) bad.push("location " + JSON.stringify(e));
    if (JSON.stringify(r) !== '{"sessionId":"S1","targetId":"T1","loaded":true}') bad.push("returned " + JSON.stringify(r));
    return [bad.length === 0, bad.join(" | ")];
  }); check("O2: openPage on the same fake still sends Browser.grantPermissions first and the Sacramento Emulation.setGeolocationOverride before Page.navigate (its old calls, in its old order)", ok, detail); }

  { const [ok, detail] = await T(async () => {
    const bad = [], ra = fs.readFileSync(path.join(dir, "read-bing.mjs"), "utf8"), aa = fs.readFileSync(path.join(dir, "ask-assistants.mjs"), "utf8");
    for (const [name, text] of [["read-bing.mjs", ra], ["ask-assistants.mjs", aa]]) {
      if (/\bopenPage\b/.test(text)) bad.push(name + " mentions openPage");
      if (/grantPermissions|setGeolocationOverride/.test(text)) bad.push(name + " grants a permission or sets a location");
      if (!/\bopenPlain\b/.test(text)) bad.push(name + " does not use openPlain");
    }
    if (/Emulation\./.test(ra)) bad.push("read-bing.mjs has Emulation.");
    // ask-assistants.mjs keeps its one setFocusEmulationEnabled (a tab in the background still takes the paste): it is not a location or a permission
    if ((aa.match(/Emulation\.\w+/g) || []).some((m) => m !== "Emulation.setFocusEmulationEnabled")) bad.push("ask-assistants.mjs has an Emulation call other than setFocusEmulationEnabled");
    return [bad.length === 0, bad.join(" | ")];
  }); check("O3: the text of read-bing.mjs and of ask-assistants.mjs holds no openPage, no grantPermissions, no location override, uses openPlain, and no Emulation call of any other kind in read-bing.mjs", ok, detail); }

  { const [ok, detail] = await T(async () => {
    const mod = await imp(dir, "read-bing.mjs"), c = fakeCdp(), bad = [];
    if (typeof mod.drv.openPlain !== "function" || mod.drv.openPage !== undefined) bad.push("the driver's opener is not openPlain: " + Object.keys(mod.drv).join());
    else await mod.drv.openPlain(c, "https://x.test/", { sleep: nap });
    if (names(c).join() !== PLAIN.join() || names(c).some((m) => /^(Emulation\.|Browser\.)/.test(m))) bad.push("methods " + names(c).join());
    return [bad.length === 0, bad.join(" | ")];
  }); check("O4: read-bing.mjs's real driver object opens with openPlain: on the fake, no Emulation and no grant", ok, detail); }
  return results;
}

const VA = "vantage.mjs", AA = "ask-assistants.mjs", RB = "read-bing.mjs";
const MUTANTS = [
  { name: "openPlain sets the location", patches: [{ file: VA, from: 'if (!plain) await cdp.send("Emulation.setGeolocationOverride"', to: 'if (true) await cdp.send("Emulation.setGeolocationOverride"' }], expect: [/^O1:/, /^O4:/] },
  { name: "openPlain grants the permission", patches: [{ file: VA, from: 'if (!plain) await cdp.send("Browser.grantPermissions"', to: 'if (true) await cdp.send("Browser.grantPermissions"' }], expect: [/^O1:/, /^O4:/] },
  { name: "ask-assistants opens with openPage again", patches: [{ file: AA, from: "else tab = await openPlain(c, sp.url);", to: "else tab = await openPage(c, sp.url);" }], expect: [/^O3:/] },
  { name: "read-bing opens with openPage again", patches: [{ file: RB, from: "import { connect, openPlain, evalIn,", to: "import { connect, openPage, openPlain, evalIn," }, { file: RB, from: "connect, openPlain, navigate, evalIn, closePage,", to: "connect, openPlain: openPage, navigate, evalIn, closePage," }], expect: [/^O3:/, /^O4:/] },
  { name: "openPage no longer sets the location", patches: [{ file: VA, from: 'if (!plain) await cdp.send("Emulation.setGeolocationOverride"', to: 'if (false) await cdp.send("Emulation.setGeolocationOverride"' }], expect: [/^O2:/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-open-plain.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  process.exit(await main({ label: "OPEN PLAIN", scenarios, MUTANTS, scriptsDir, argv: A }));
}
