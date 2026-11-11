// Shared parts of the small per-script tests (test-bing-refusal, test-crux, test-importers, test-city-centres): a local fake server, a script
// runner with an empty home folder and the network guard, and the watched-fail mutant loop in the pattern of test-psi.mjs.
// Nothing here talks to a network: the fake servers listen on 127.0.0.1 and netguard-import.mjs refuses every non-local request.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

// handler(req{url,method,headers,body}) -> { status?, body (object -> JSON, string -> as is), headers?, hang? }
export async function serve(handler) {
  const reqs = [], sockets = new Set();
  const server = http.createServer(async (req, res) => {
    let body = ""; await new Promise((done) => { req.on("data", (d) => (body += d)); req.on("end", done); });
    const r = { url: req.url, method: req.method, headers: req.headers, body, t: Date.now() };
    reqs.push(r);
    const a = (await handler(r, reqs)) || { status: 404, body: {} };
    if (a.hang) return;
    res.statusCode = a.status || 200;
    for (const [k, v] of Object.entries(a.headers || {})) res.setHeader(k, v);
    if (!a.headers?.["content-type"]) res.setHeader("content-type", typeof a.body === "string" ? "text/plain" : "application/json");
    res.end(typeof a.body === "string" ? a.body : JSON.stringify(a.body ?? {}));
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, reqs, close: () => { for (const s of sockets) s.destroy(); server.close(); } };
}

// run a script of `dir` with the network guard; env keys listed in `clear` are removed unless the scenario sets them
export function runner(dir, home, netLog, clear = []) {
  return (file, argv, { env = {}, timeout = 60000 } = {}) => new Promise((resolve) => {
    const e = { ...process.env, USERPROFILE: home, HOME: home, NODE_OPTIONS: "", PEWP_NETGUARD_LOG: netLog, ...env };
    for (const k of clear) if (!(k in env)) delete e[k];
    const c = spawn(process.execPath, ["--import", pathToFileURL(path.join(dir, "netguard-import.mjs")).href, path.join(dir, file), ...argv], { stdio: ["ignore", "pipe", "pipe"], env: e, windowsHide: true });
    let so = "", se = "";
    c.stdout.on("data", (d) => (so += d)); c.stderr.on("data", (d) => (se += d));
    const timer = setTimeout(() => { se += "TIMED OUT"; c.kill(); }, timeout);
    c.on("close", (code) => { clearTimeout(timer); resolve({ code, so, se, out: so + se }); });
  });
}

export const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)])) : []);
export const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
export const W = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof o === "string" ? o : JSON.stringify(o, null, 1)); };
export const mkTmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `pewp-${label}-`));
export const rmTmp = (d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 });
export const checker = (results) => (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 800) });

// The test's main: runs `scenarios(dir)` on the real tree, prints PASS/FAIL, then every mutant (a patch applied to a copy of the scripts folder
// that must turn the named assertions red). Returns the exit code. label: "BING REFUSAL" etc. With --json the LAST line is one JSON object:
// { suite, ok, assertions: { total, failed }, mutants: { ran, caught, failed } | null, wallMs }.
export async function main({ label, scenarios, MUTANTS, scriptsDir, argv }) {
  const opt = (k, d = null) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
  const t0 = Date.now();
  const out = await scenarios(scriptsDir);
  for (const r of out) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail}`}`);
  let failed = out.filter((r) => !r.ok).length; const mainFailed = failed; let caught = 0, ran = 0;
  console.log(failed ? `${label} TEST FAIL: ${failed} of ${out.length}` : `${label} TEST PASS: ${out.length} of ${out.length}`);
  if (!failed && !argv.includes("--no-mutants")) {
    console.log("\nWatched-fail mutants (each must turn the named assertions red; the unmutated tree is green above):");
    for (const mu of MUTANTS.filter((m) => !opt("--mutant") || m.name.includes(opt("--mutant")))) {
      ran++;
      const mdir = mkTmp("mutant"), sdir = path.join(mdir, "scripts");
      for (let t = 0; ; t++) { try { fs.mkdirSync(sdir, { recursive: true }); fs.cpSync(scriptsDir, sdir, { recursive: true }); break; } catch (e) { if (t >= 4) throw e; } }
      let applied = true;
      for (const p of mu.patches) {
        const target = path.join(sdir, p.file), src = fs.readFileSync(target, "utf8"), count = src.split(p.from).length - 1;
        if (count !== 1) { console.log(`FAIL mutant "${mu.name}": patch target found ${count} times in ${p.file} (the patch did not apply)`); failed++; applied = false; break; }
        fs.writeFileSync(target, src.replace(p.from, () => p.to));
      }
      if (!applied) { rmTmp(mdir); continue; }
      let res;
      try { res = await scenarios(sdir); } catch (e) { res = [{ name: `crashed: ${e.message}`, ok: false }]; }
      const red = res.filter((r) => !r.ok);
      const missing = mu.expect.filter((re) => !red.some((r) => re.test(r.name)));
      const ok = red.length > 0 && !missing.length;
      if (ok) caught++; else failed++;
      console.log(`${ok ? "RED (caught)" : "FAIL (survived)"} ${mu.name}: ${red.length} assertion(s) red${red.length ? ` e.g. "${red[0].name.slice(0, 80)}"` : ""}${missing.length ? `; expected red but green: ${missing.map(String).join(" ")}` : ""}`);
      rmTmp(mdir);
    }
    console.log(failed ? `MUTANTS FAIL: ${caught} of ${ran} caught` : `MUTANTS PASS: ${caught} of ${ran} caught`);
  }
  if (argv.includes("--json")) console.log(JSON.stringify({ suite: label.toLowerCase().replace(/ /g, "-"), ok: !failed, assertions: { total: out.length, failed: mainFailed }, mutants: ran ? { ran, caught, failed: ran - caught } : null, wallMs: Date.now() - t0 }));
  return failed ? 1 : 0;
}
