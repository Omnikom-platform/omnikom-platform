// Usage: node test-writing-gate.mjs [--only <mutant name part>] [--no-mutants]
// Proof of writing-gate.mjs (stages/build.md "The writing gate", stages/launch.md `writing`). Local fixtures only: a small good site
// (lib-writing-fixture.mjs, invented) that passes all 7 rules, served on 127.0.0.1 with its `_headers` for the --url checks, and
// mutants made by editing a COPY of it, one habit per rule. Every gate child runs with a network guard (--import) that refuses and
// logs any non-local request; the log must stay empty. Chromium comes from the render-gate install (lib-shots.mjs).
// Every mutant must turn exactly its rule(s) red, with the reason in the detail line (watched-fail), and the good site must stay green.
// WG-6 contains WG-5 by design (llms.txt is agent readiness AND a clean accessibility tree), so the role mutant expects WG-5 and WG-6.
// Prints PASS/FAIL per check and mutant, then `WRITING-GATE TEST PASS|FAIL: N checks, M mutants red for the right reason`.
// Exit 0 = every check passed and every mutant was caught for the right reason.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";
import { writeGoodSite, serveSite, patchFile, patchPages, PNG, PAGES } from "./lib-writing-fixture.mjs";
import { checkRole, roleViolations } from "./lib-aria-roles.mjs";
import { lintReadAfterWrite } from "./writing-gate.mjs";

const A = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(here, "writing-gate.mjs");

const GUARD = String.raw`import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
const log = (u) => { if (process.env.WG_NETGUARD_LOG) fs.appendFileSync(process.env.WG_NETGUARD_LOG, u + "\n"); };
const local = (h) => /^(127\.0\.0\.1|localhost|\[::1\])$/.test(h || "");
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => { const url = typeof input === "string" ? input : input?.url ?? String(input); let h = ""; try { h = new URL(url).hostname; } catch {} if (!local(h)) { log(url); return Promise.reject(new Error("NETWORK GUARD: refused non-local request " + url)); } return realFetch(input, init); };
for (const mod of [http, https]) for (const fn of ["request", "get"]) { const real = mod[fn]; mod[fn] = function (...a) { const o = a[0]; const h = typeof o === "string" ? (() => { try { return new URL(o).hostname; } catch { return ""; } })() : o instanceof URL ? o.hostname : (o?.hostname || o?.host || ""); if (!local(String(h).replace(/:\d+$/, ""))) { log(fn + " " + h); throw new Error("NETWORK GUARD: refused non-local request " + h); } return real.apply(this, a); }; }
syncBuiltinESMExports();
`;

// ---- a PageSpeed v5 answer with the five audits the gate reads; `bad` swaps one audit for the red shape PSI printed for ELEV8 ----
const psiFile = (bad = null) => {
  const audits = {
    "render-blocking-insight": { score: 1, metricSavings: { FCP: 0, LCP: 0 }, details: { type: "table", items: [] } },
    "unused-css-rules": { score: 1, details: { type: "opportunity", items: [{ url: "https://fixture-realty.test/assets/app.css", totalBytes: 800, wastedBytes: 40, wastedPercent: 5 }] } },
    "image-delivery-insight": { score: 1, details: { type: "table", items: [] } },
    "forced-reflow-insight": { score: 1, details: { type: "list", items: [{ type: "table", items: [], headings: [{ key: "reflowTime" }] }] } },
    "aria-allowed-role": { score: 1, details: { type: "table", items: [] } },
  };
  if (bad === "render-blocking-insight") audits[bad] = { score: 0, metricSavings: { FCP: 850, LCP: 0 }, details: { type: "table", items: [{ url: "https://fixture-realty.test/assets/app.css", totalBytes: 24888, wastedMs: 151 }] } };
  if (bad === "unused-css-rules") audits[bad] = { score: 0, details: { type: "opportunity", items: [{ url: "https://fixture-realty.test/assets/app.css", totalBytes: 23594, wastedBytes: 10479, wastedPercent: 44.4 }] } };
  if (bad === "image-delivery-insight") audits[bad] = { score: 0, details: { type: "table", items: [{ url: "https://fixture-realty.test/assets/img/hero.webp", totalBytes: 142000, wastedBytes: 83000 }] } };
  if (bad === "forced-reflow-insight") audits[bad] = { score: 0, details: { type: "list", items: [{ type: "table", items: [{ source: { type: "source-location", url: "https://fixture-realty.test/assets/site.js", line: 64 }, reflowTime: 53 }], headings: [{ key: "reflowTime" }] }] } };
  if (bad === "aria-allowed-role") audits[bad] = { score: 0, details: { type: "table", items: [{ node: { snippet: '<form class="hro-form" role="tabpanel">' } }] } };
  return { kind: "pagespeedonline#result", lighthouseResult: { requestedUrl: "https://fixture-realty.test/", finalUrl: "https://fixture-realty.test/", configSettings: { formFactor: "mobile" }, audits } };
};

async function main() {
  if (A.includes("--help")) { console.log("usage: node test-writing-gate.mjs [--only <mutant name part>] [--no-mutants]"); return 0; }
  const results = [], mutants = [];
  const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 1400) });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-wg-"));
  const guardFile = path.join(tmp, "netguard.mjs"), netLog = path.join(tmp, "net-attempts.log");
  fs.writeFileSync(guardFile, GUARD);

  // run the gate as a child with the guard; with live:true the dir is also served (headers from its _headers) and passed as --url
  const gate = async (dir, args = [], { live = false, drop = [], env = {}, timeout = 400000 } = {}) => {
    let srv = null;
    if (live) { srv = await serveSite(dir, { drop }); args = [...args, "--url", srv.base]; }
    try {
      return await new Promise((resolve) => {
        const e = { ...process.env, NODE_OPTIONS: `--import ${pathToFileURL(guardFile).href}`, WG_NETGUARD_LOG: netLog, ...env };
        const c = spawn(process.execPath, [GATE, dir, ...args], { cwd: tmp, stdio: ["ignore", "pipe", "pipe"], env: e });
        let so = "", se = "";
        c.stdout.on("data", (d) => (so += d)); c.stderr.on("data", (d) => (se += d));
        const t = setTimeout(() => c.kill(), timeout);
        c.on("close", (code) => {
          clearTimeout(t);
          const st = {}, line = {};
          for (const m of so.matchAll(/^(PASS|FAIL|NOT RUN) (WG-\d) .*$/gm)) { st[m[2]] = m[1]; line[m[2]] = m[0]; }
          // a rule's detail block = the indented lines after its first line
          const block = (id) => { const i = so.split("\n").findIndex((l) => l.startsWith(`${st[id]} ${id} `)); if (i < 0) return ""; const out = [so.split("\n")[i]]; for (const l of so.split("\n").slice(i + 1)) { if (!l.startsWith("    ")) break; out.push(l); } return out.join("\n"); };
          resolve({ code, so, se, out: so + se, st, line, block });
        });
      });
    } finally { if (srv) srv.server.close(); }
  };
  const copy = (name, mut) => { const d = path.join(tmp, name); writeGoodSite(d); if (mut) mut(d); return d; };
  const quick = ["--pages", "/", "--viewports", "390x844,1366x900"]; // mutants: one page, both viewports
  const IDS = ["WG-1", "WG-2", "WG-3", "WG-4", "WG-5", "WG-6", "WG-7"];

  try {
    // ---- usage ----
    const good = copy("good");
    const u0 = await gate(good, ["--help"]), u1 = await gate(good, ["--only", "WG-9"]), u2 = await gate(good, ["--viewports", "tall"]);
    check("usage: --help exit 0 with the usage; an unknown rule or a bad viewport is a usage error (exit 2)", u0.code === 0 && /usage: node writing-gate/.test(u0.so) && u1.code === 2 && /not a rule/.test(u1.se) && u2.code === 2 && /WIDTHxHEIGHT/.test(u2.se), `${u0.code} ${u1.code} ${u1.se} ${u2.code} ${u2.se}`);

    // ---- the good site: all 7 rules, default pages, with --url and --json ----
    const jsonOut = path.join(tmp, "out", "wg.json");
    const g = await gate(good, ["--json", jsonOut], { live: true });
    console.log("--- writing-gate on the good fixture (as run by this test) ---\n" + g.so + "--- end ---");
    check("good site: all 7 rules PASS, exit 0, the summary line says 7 PASS", g.code === 0 && IDS.every((id) => g.st[id] === "PASS") && /^PASS writing-gate 7 rules: 7 PASS, 0 FAIL, 0 NOT RUN$/m.test(g.so), `${g.code} ${JSON.stringify(g.st)}\n${g.out.slice(0, 1500)}`);
    check("good site: the pages line names the pages that ran, one per folder pattern (/blog/post-1/ ran, /blog/post-2/ did not)", /^pages: 3 of 4 html file\(s\)/m.test(g.so) && /\/blog\/post-1\//.test(g.so.split("\n")[0]) && !/post-2/.test(g.so.split("\n")[0]), g.so.split("\n")[0]);
    let j = null; try { j = JSON.parse(fs.readFileSync(jsonOut, "utf8")); } catch {}
    check("--json writes the 7 rules with status and summary, and the exit code", j && j.rules?.length === 7 && j.rules.every((r) => r.status === "PASS" && r.summary) && j.exit === 0, JSON.stringify(j)?.slice(0, 300));
    // a sheet flipped by a script (no onload, as a strict CSP needs) passes once the browser sees it applied after load
    const swapDir = copy("swap", (d) => { patchPages(d, ` onload="this.media='all'"`, " data-defer"); patchFile(d, "assets/site.js", "(function () {", "(function () {\n  for (var l of document.querySelectorAll('link[data-defer]')) l.media = 'all';"); });
    const sw = await gate(swapDir, ["--only", "WG-1"]);
    check("WG-1: a media=print sheet flipped by a script (no onload) passes, the line says the swap was checked in the browser, and the size reads gzip", sw.code === 0 && sw.st["WG-1"] === "PASS" && /3 page\(s\) with a script-swapped sheet checked in the browser/.test(sw.line["WG-1"]) && /KiB gzip \(limit 14 KiB gzip\)/.test(sw.line["WG-1"]), sw.out);
    check("good site: WG-2 prints a % per page and viewport, WG-3 prints its worst images, WG-4 says it was measured by Chromium trace, WG-6 and WG-7 checked the live server", /measured \/ @390x844: [\d.]+ KiB gzip wasted, [\d.]+% unused/.test(g.so) && /worst \/ @1366x900: 960w for 520 px/.test(g.so) && /measured by Chromium trace/.test(g.line["WG-4"]) && /live 200 text\/plain/.test(g.line["WG-6"]) && /3 live page\(s\) checked/.test(g.line["WG-7"]), g.so.slice(0, 1800));

    // ---- --only, missing pages ----
    const o1 = await gate(good, ["--only", "WG-6"]);
    check("--only WG-6 prints WG-6 alone (WG-5 is computed inside it)", o1.code === 0 && Object.keys(o1.st).join() === "WG-6" && /WG-5 0 violation/.test(o1.line["WG-6"]), o1.out);
    const o2 = await gate(good, ["--only", "WG-1", "--pages", "/,/nope/"]);
    check("a --pages entry that is not in the built folder: the rule cannot PASS (NOT RUN), exit 2, the missing page is named", o2.code === 2 && o2.st["WG-1"] === "NOT RUN" && /\/nope\//.test(o2.so) && /^ERROR writing-gate/m.test(o2.so), o2.out);

    // ---- the ARIA table (library) ----
    const roleCases = [["form", { role: "tabpanel" }, false], ["div", { role: "tabpanel" }, true], ["form", { role: "search" }, true], ["a", { href: "/x", role: "button" }, true], ["a", { href: "/x", role: "tablist" }, false],
      ["a", { role: "tablist" }, true], ["button", { role: "tab" }, true], ["button", { role: "heading" }, false], ["img", { alt: "", role: "presentation" }, true], ["img", { alt: "", role: "button" }, false], ["img", { alt: "a cat", role: "button" }, true],
      ["ul", { role: "tablist" }, true], ["li", { role: "tab" }, true], ["nav", { role: "navigation" }, true], ["main", { role: "tabpanel" }, false], ["section", { role: "tabpanel" }, true], ["h2", { role: "tab" }, true], ["h2", { role: "button" }, false],
      ["input", { type: "text", role: "searchbox" }, true], ["input", { type: "checkbox", role: "switch" }, true], ["select", { role: "listbox" }, true], ["textarea", { role: "tab" }, false], ["label", { role: "tab" }, false], ["span", { role: "tab" }, true],
      ["a", { href: "/x", role: "doc-backlink" }, true], ["footer", { role: "contentinfo" }, true], ["custom-el", { role: "tab" }, true]];
    const roleBad = roleCases.filter(([t, a, ok]) => (checkRole(t, a) === null) !== ok).map(([t, a]) => `${t} ${JSON.stringify(a)}`);
    check(`ARIA table: ${roleCases.length} element/role cases agree with ARIA in HTML (form+tabpanel bad, div+tabpanel fine, a[href]+tablist bad, ...)`, !roleBad.length, roleBad.join("; "));
    const rv = roleViolations(`<!-- <form role="tab"> --><script>var s='<form role="tab">'</script><div role="tabpanel"><form role="tabpanel" id="x" class="f">`);
    check("ARIA parser: a role inside a comment or a script is not read; the real <form role=tabpanel> is found with its snippet", rv.length === 1 && rv[0].tag === "form" && /id="x"/.test(rv[0].snippet), JSON.stringify(rv));
    const lintOk = lintReadAfterWrite(`function a(){ var h = el.offsetHeight; el.classList.add("x"); }`).length === 0 && lintReadAfterWrite(`function a(){ el.classList.add("x"); return el.getBoundingClientRect().top; }`).length === 1;
    check("static lint: a read before a write is fine, a read after a write in one function body is a hit", lintOk, "");

    if (A.includes("--no-mutants")) { /* skip */ } else {
      // ---- mutants: one habit each, on a copy; exactly the named rules go red, and the detail says why ----
      const noise = (n) => { let s = 2463534242, o = ""; while (o.length < n) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; o += (s >>> 0).toString(36); } return o.slice(0, n); };
      const M = [
        { name: "render-blocking stylesheet in <head>", mut: (d) => patchPages(d, ` media="print" onload="this.media='all'"`, ""), expect: ["WG-1"], why: [["WG-1", /blocks the first paint/]] },
        { name: "deferred stylesheet without a noscript fallback", mut: (d) => patchPages(d, `<noscript><link rel="stylesheet" href="/assets/rest.css"></noscript>\n`, ""), expect: ["WG-1"], why: [["WG-1", /no <noscript>/]], args: ["--only", "WG-1"] },
        { name: "about 20 KiB gzip of inline <style> in <head> (random, so it does not compress away)", mut: (d) => patchPages(d, "<style>", `<style>/*${noise(44 * 1024)}*/`), expect: ["WG-1"], why: [["WG-1", /inline <style> in <head> is [12]\d\.\d KiB gzip \(4\d\.\d KiB raw; limit 14 KiB gzip\)/]], args: ["--only", "WG-1"] },
        { name: "deferred sheet left on media=print with no onload and no script flips it (never applied)", mut: (d) => patchPages(d, ` onload="this.media='all'"`, ""), expect: ["WG-1"], why: [["WG-1", /still print 1\.5 s after load \(never applied\)/]], args: ["--only", "WG-1"] },
        { name: "about 12 KiB gzip of unused CSS in the deferred sheet (random selectors, so it does not compress away)", mut: (d) => fs.appendFileSync(path.join(d, "assets", "rest.css"), Array.from({ length: 700 }, (_, i) => `.z${noise(16800).slice(i * 24, i * 24 + 24).replace(/^\d/, "a")}${i}{color:#12${String(i).padStart(4, "0")}}`).join("")), expect: ["WG-2"], why: [["WG-2", /1\d\.\d KiB gzip of CSS is unused \(9\d\.\d% of [\d.]+ KiB raw; limit 8 KiB gzip\)/]] },
        { name: "boxed image with sizes=100vw and an oversized candidate", mut: (d) => { patchPages(d, `sizes="300px"`, `sizes="100vw"`); patchPages(d, `/assets/img/card-600.png 600w`, `/assets/img/card-600.png 600w, /assets/img/card-1800.png 1800w`); fs.writeFileSync(path.join(d, "assets", "img", "card-1800.png"), PNG); }, expect: ["WG-3"], why: [["WG-3", /sizes="100vw" but the image is 300 px wide/], ["WG-3", /chose the 1800w candidate for a 300 px slot/]] },
        { name: "script writes a class then reads offsetHeight in a loop of 50 (forced reflow)", mut: (d) => fs.appendFileSync(path.join(d, "assets", "site.js"), `(function () { var box = document.createElement("div"); document.body.appendChild(box); for (var i = 0; i < 50; i++) { var p = document.createElement("p"); p.textContent = "row " + i; box.appendChild(p); p.classList.add("row"); var h = p.offsetHeight; } })();\n`), expect: ["WG-4"], why: [["WG-4", /[1-9]\d* forced Layout event\(s\) from our own scripts/], ["WG-4", /top frame \/assets\/site\.js:\d+ x\d+/]] },
        { name: "same forced reflow, caught by the static lint (--wg4 static)", mut: (d) => fs.appendFileSync(path.join(d, "assets", "site.js"), `(function () { var box = document.createElement("div"); document.body.appendChild(box); for (var i = 0; i < 50; i++) { var p = document.createElement("p"); box.appendChild(p); p.classList.add("row"); var h = p.offsetHeight; } })();\n`), expect: ["WG-4"], args: ["--only", "WG-4", "--wg4", "static"], why: [["WG-4", /assets\/site\.js:\d+ reads offsetHeight after writing styles/], ["WG-4", /STATIC LINT/]] },
        { name: "tracing unusable: the fallback lint still FAILs the reflow", mut: (d) => fs.appendFileSync(path.join(d, "assets", "site.js"), `(function () { var p = document.body; p.classList.add("row"); var h = p.getBoundingClientRect(); })();\n`), expect: ["WG-4"], args: ["--only", "WG-4", "--pages", "/", "--viewports", "390x844"], env: { WRITING_GATE_BREAK_TRACE: "1" }, why: [["WG-4", /STATIC LINT \(tracing is not usable here after two attempts/], ["WG-4", /reads getBoundingClientRect after writing styles/]] },
        { name: "role=tabpanel on the form", mut: (d) => patchPages(d, `<div role="tabpanel" id="p1"><form class="f" `, `<div id="p1"><form role="tabpanel" class="f" `), expect: ["WG-5", "WG-6"], why: [["WG-5", /role="tabpanel" is not allowed on <form> \(allowed: search none presentation/], ["WG-6", /WG-5 has \d+ role violation/]] },
        { name: "llms.txt removed", mut: (d) => fs.rmSync(path.join(d, "llms.txt")), expect: ["WG-6"], why: [["WG-6", /llms\.txt is not in the built folder/]], args: ["--only", "WG-6"] },
        { name: "llms.txt without an H1", mut: (d) => patchFile(d, "llms.txt", "# Fixture Realty\n", "Fixture Realty\n"), expect: ["WG-6"], why: [["WG-6", /does not begin with an "# " H1/]], args: ["--only", "WG-6"] },
        { name: "llms.txt links a page that is not built", mut: (d) => patchFile(d, "llms.txt", "[About](/about/)", "[About](/about-us/)"), expect: ["WG-6"], why: [["WG-6", /links \/about-us\/, which is not a built page/]], args: ["--only", "WG-6"] },
        { name: "llms.txt with no link", mut: (d) => fs.writeFileSync(path.join(d, "llms.txt"), "# Fixture Realty\n\nNo links here.\n"), expect: ["WG-6"], why: [["WG-6", /no markdown link/]], args: ["--only", "WG-6"] },
        { name: "Cross-Origin-Opener-Policy dropped from _headers", mut: (d) => patchFile(d, "_headers", "  Cross-Origin-Opener-Policy: same-origin\n", ""), expect: ["WG-7"], why: [["WG-7", /_headers \/\* block has no Cross-Origin-Opener-Policy/], ["WG-7", /live .* has no Cross-Origin-Opener-Policy header/]], args: ["--only", "WG-7"] },
        { name: "Strict-Transport-Security dropped from _headers", mut: (d) => patchFile(d, "_headers", "  Strict-Transport-Security: max-age=31536000; includeSubDomains\n", ""), expect: ["WG-7"], why: [["WG-7", /_headers \/\* block has no Strict-Transport-Security/]], args: ["--only", "WG-7"] },
        { name: "live response lacks COOP although _headers has it", live: { drop: ["Cross-Origin-Opener-Policy"] }, expect: ["WG-7"], why: [["WG-7", /live .* has no Cross-Origin-Opener-Policy header/]], args: ["--only", "WG-7"], noFileBlame: true },
        ...["render-blocking-insight:WG-1", "unused-css-rules:WG-2", "image-delivery-insight:WG-3", "forced-reflow-insight:WG-4", "aria-allowed-role:WG-5"].map((x) => {
          const [audit, id] = x.split(":");
          return { name: `PageSpeed evidence: ${audit} red`, psi: audit, expect: [id], why: [[id, new RegExp(`PSI CONTRADICTS psi mobile /: .*`)], [id, /PageSpeed evidence contradicts/]], args: ["--only", id, ...(id === "WG-5" || id === "WG-1" ? [] : ["--pages", "/", "--viewports", "390x844"])] };
        }),
      ];
      // the clean PSI files keep every rule green and add evidence lines
      const psiDir = path.join(tmp, "psi-clean"); fs.mkdirSync(psiDir); fs.writeFileSync(path.join(psiDir, "psi-mobile-_.json"), JSON.stringify(psiFile()));
      const pc = await gate(good, ["--psi-dir", psiDir, "--pages", "/", "--viewports", "390x844"]);
      check("clean PageSpeed files add 5 evidence lines and keep every rule PASS (exit 0)", pc.code === 0 && IDS.every((id) => pc.st[id] === "PASS") && ["WG-1", "WG-2", "WG-3", "WG-4", "WG-5"].every((id) => new RegExp(`evidence psi mobile /: `).test(pc.block(id))), `${pc.code}\n${pc.out.slice(0, 1500)}`);
      // a PageSpeed file with an audit missing does not invent evidence
      const psiDir2 = path.join(tmp, "psi-partial"); fs.mkdirSync(psiDir2); { const p = psiFile(); delete p.lighthouseResult.audits["aria-allowed-role"]; fs.writeFileSync(path.join(psiDir2, "x.json"), JSON.stringify(p)); }
      const pp = await gate(good, ["--psi-dir", psiDir2, "--only", "WG-5"]);
      check("a PageSpeed file without the aria-allowed-role audit says so and does not decide WG-5", pp.code === 0 && /aria-allowed-role is not in this file/.test(pp.block("WG-5")), pp.out);

      for (const m of M.filter((x) => !A.includes("--only") || x.name.includes(A[A.indexOf("--only") + 1]))) {
        const dir = copy("m-" + mutants.length, m.mut);
        let args = m.args || quick;
        if (m.psi) { const d = path.join(tmp, "psi-" + mutants.length); fs.mkdirSync(d); fs.writeFileSync(path.join(d, "psi-mobile-_.json"), JSON.stringify(psiFile(m.psi))); args = [...args, "--psi-dir", d]; }
        const r = await gate(dir, args, { live: !!m.live || /WG-7|llms|WG-6/.test(args.join(" ")) || !m.args, drop: m.live?.drop || [], env: m.env || {} });
        const reds = IDS.filter((id) => r.st[id] === "FAIL");
        const others = Object.entries(r.st).filter(([id, s]) => !m.expect.includes(id) && s !== "PASS").map(([id, s]) => `${id} ${s}`);
        const missingWhy = (m.why || []).filter(([id, re]) => !re.test(r.block(id)));
        const ok = r.code === 1 && m.expect.every((id) => reds.includes(id)) && !others.length && !missingWhy.length;
        mutants.push({ name: m.name, ok, detail: ok ? `red: ${reds.join(" ")}` : `exit ${r.code}; red ${reds.join(" ") || "none"} (wanted ${m.expect.join(" ")}); other rules not PASS: ${others.join(", ") || "none"}; reason missing: ${missingWhy.map(([id, re]) => id + " " + re).join(" | ") || "none"}\n${r.out.slice(0, 1800)}` });
      }
    }

    const net = fs.existsSync(netLog) ? fs.readFileSync(netLog, "utf8").trim() : "";
    check("no request left this machine (network guard log empty)", !net, net);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }

  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail}`}`);
  if (mutants.length) console.log("\nWatched-fail mutants (each edits a copy of the good site; exactly its rule(s) must go red, for the reason named):");
  for (const m of mutants) console.log(`${m.ok ? "RED (caught)" : "FAIL (wrong or survived)"} ${m.name}: ${m.detail}`);
  const failed = results.filter((r) => !r.ok).length + mutants.filter((m) => !m.ok).length;
  const caught = mutants.filter((m) => m.ok).length;
  console.log(`WRITING-GATE TEST ${failed ? "FAIL" : "PASS"}: ${results.length} checks (${results.filter((r) => r.ok).length} passed), ${caught} of ${mutants.length} mutants red for the right reason`);
  return failed ? 1 : 0;
}
if (isMain(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error(`test-writing-gate crashed: ${e.stack || e}`); process.exit(1); });
