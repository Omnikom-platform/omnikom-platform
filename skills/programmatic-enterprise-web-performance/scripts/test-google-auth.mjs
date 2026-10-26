// Usage: node test-google-auth.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]
// Proof of lib-google-auth.mjs (contract C5): a Search Console access token from a service account (RS256 JWT) or from the token file.
// No network: a local http server on 127.0.0.1 is the token endpoint (GSC_TOKEN_URL, the same hook the other tests use) and a fetch guard
// refuses any other host. The RSA key pair is generated at test time. Mutants (watched-fail, same pattern as test-start.mjs): break the code each
// assertion guards in a copy of the scripts folder, expect the named assertions red. A live Google endpoint is NOT exercised here (UNPROVEN).
// Exit 0 = every assertion passed and every mutant was caught.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMain } from "./lib-main.mjs";

const A = process.argv.slice(2);
const opt = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsDir = path.resolve(opt("--scripts", here));

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const PEM_BODY = privateKey.split("\n")[3]; // a line from the middle of the key: must never show up in any message
const DEFAULT_AUD = "https://oauth2.googleapis.com/token";
const SCOPE_RO = "https://www.googleapis.com/auth/webmasters.readonly";

// any fetch that leaves this machine is a test bug (or a mutant that ignores the hook): refuse it
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => { const h = new URL(typeof u === "string" ? u : u.url).hostname; if (h !== "127.0.0.1") throw new Error(`test guard: non-local request to ${h}`); return realFetch(u, o); };

const dec = (p) => JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

async function scenarios(dir) {
  const results = [];
  const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail: ok ? "" : String(detail).slice(0, 600) });
  const lib = await import(pathToFileURL(path.join(dir, "lib-google-auth.mjs")).href + `?v=${Math.random()}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-gauth-"));
  const cwd = path.join(tmp, "cwd"), keys = path.join(tmp, "keys"), toks = path.join(tmp, "tokens");
  for (const d of [cwd, keys, toks]) fs.mkdirSync(d);
  const w = (p, o) => { fs.writeFileSync(p, typeof o === "string" ? o : JSON.stringify(o)); return p; };
  const sa = (name, extra = {}) => ({ type: "service_account", client_email: `${name}@proj.iam.gserviceaccount.com`, private_key: privateKey, ...extra });
  const saFile = (name, extra) => w(path.join(keys, `${name}.json`), sa(name, extra));

  // ---- the fake token endpoint ----
  const reqs = []; const sockets = new Set(); let mode = "ok", expiresIn = 3600, n = 0, lastBody = "";
  const server = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      const params = Object.fromEntries(new URLSearchParams(b)); lastBody = b;
      reqs.push({ method: req.method, ctype: req.headers["content-type"], params });
      if (mode === "hang") return;
      res.setHeader("content-type", "application/json");
      if (mode === "deny") { res.statusCode = 401; return res.end(JSON.stringify({ error: "invalid_grant", error_description: `bad request ${b} key ${privateKey}` })); }
      res.end(JSON.stringify({ access_token: `${params.grant_type === "refresh_token" ? "RF" : "SA"}-TOKEN-${++n}`, expires_in: expiresIn, token_type: "Bearer" }));
    });
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const URL_ = `http://127.0.0.1:${server.address().port}/token`;
  // GSC_TOKEN_FILE always points at a file that does not exist: without it the lib falls back to ~/.config/pewp/gsc-token.json, and a real
  // token on this machine (fresh or expired) leaked into the "b64 ignored" mutant run (seen 2026-10-26: the mutant "survived" as a crash)
  const NO_TOKEN_FILE = path.join(os.tmpdir(), `pewp-gauth-no-token-${process.pid}.json`);
  const env = (o = {}) => ({ GSC_TOKEN_URL: URL_, GSC_TOKEN_FILE: NO_TOKEN_FILE, ...o });
  const soft = (p) => p.catch((e) => ({ error: e.message })); // a mutant that breaks a path must turn the assertion red, not crash the run
  const fail = async (p) => { try { await p; return null; } catch (e) { return e; } };

  const prevCwd = process.cwd(); process.chdir(cwd);
  try {
    // ---- 1 service account from a file ----
    const fA = saFile("alpha");
    const t0 = Date.now();
    const r1 = await lib.getGscToken({ env: env({ GSC_SERVICE_ACCOUNT_FILE: fA }) });
    const q = reqs[0] || { params: {} };
    const [h, bd, sg] = String(q.params.assertion || "").split(".");
    const head = h ? dec(h) : {}, claims = bd ? dec(bd) : {};
    check("request: a POST with the jwt-bearer grant type and one assertion of three parts", reqs.length === 1 && q.method === "POST" && /x-www-form-urlencoded/.test(q.ctype) && q.params.grant_type === "urn:ietf:params:oauth:grant-type:jwt-bearer" && String(q.params.assertion).split(".").length === 3, JSON.stringify(q));
    check("jwt: the signature verifies with the public key (RS256 over header.claims)", sg && crypto.verify("RSA-SHA256", Buffer.from(`${h}.${bd}`), publicKey, Buffer.from(sg, "base64url")), `sig ${sg ? sg.length : 0} chars`);
    check("jwt: header is exactly {alg:RS256,typ:JWT}", JSON.stringify(head) === JSON.stringify({ alg: "RS256", typ: "JWT" }), JSON.stringify(head));
    check("jwt: claims carry iss=client_email, the read-only scope and the Google token endpoint as aud", claims.iss === "alpha@proj.iam.gserviceaccount.com" && claims.scope === SCOPE_RO && claims.aud === DEFAULT_AUD, JSON.stringify(claims));
    check("jwt: exp is iat + 3600 and iat is now", claims.exp - claims.iat === 3600 && Math.abs(claims.iat - Math.floor(t0 / 1000)) <= 5, JSON.stringify(claims));
    check("result: { token, source: service-account, expiresAt about an hour ahead }", r1.token === "SA-TOKEN-1" && r1.source === "service-account" && Math.abs(r1.expiresAt - (Date.now() + 3600000)) < 10000, JSON.stringify(r1));

    // ---- 2 cache ----
    const r2 = await lib.getGscToken({ env: env({ GSC_SERVICE_ACCOUNT_FILE: fA }) });
    check("cache: a second call within the hour makes no second request and returns the same token", reqs.length === 1 && r2.token === r1.token, `requests ${reqs.length}, ${r2.token}`);

    // ---- 3 scope parameter ----
    const r3 = await lib.getGscToken({ env: env({ GSC_SERVICE_ACCOUNT_FILE: fA }), scope: "webmasters" });
    const c3 = reqs[1] ? dec(reqs[1].params.assertion.split(".")[1]) : {};
    const r3b = await lib.getGscToken({ env: env({ GSC_SERVICE_ACCOUNT_FILE: fA }), scope: "https://www.googleapis.com/auth/webmasters" });
    check("scope: the scope parameter changes the claim (the short word `webmasters` becomes the full write scope) and gets its own token", reqs.length === 2 && c3.scope === "https://www.googleapis.com/auth/webmasters" && r3.token !== r1.token && r3b.token === r3.token, JSON.stringify([reqs.length, c3.scope, r3.token, r1.token]));

    // ---- 4 aud follows the key file's token_uri; the request still goes to the test hook ----
    await lib.getGscToken({ env: env({ GSC_SERVICE_ACCOUNT_FILE: saFile("bravo", { token_uri: "https://token.example.test/oauth" }) }) });
    const c4 = dec(reqs[reqs.length - 1].params.assertion.split(".")[1]);
    check("jwt: aud is the key file's token_uri when it has one", c4.aud === "https://token.example.test/oauth", JSON.stringify(c4));

    // ---- 5 base64 env ----
    const before5 = reqs.length;
    const b64 = Buffer.from(JSON.stringify(sa("charlie"))).toString("base64");
    const r5 = await soft(lib.getGscToken({ env: env({ GSC_SERVICE_ACCOUNT_JSON_B64: b64 }) })); // soft: a mutant that ignores the variable must turn THIS assertion red, not crash the run
    const c5 = reqs.length > before5 ? dec(reqs[reqs.length - 1].params.assertion.split(".")[1]) : {};
    check("b64: GSC_SERVICE_ACCOUNT_JSON_B64 works the same way as the file", !r5.error && reqs.length === before5 + 1 && r5.source === "service-account" && c5.iss === "charlie@proj.iam.gserviceaccount.com", JSON.stringify([r5, c5]));

    // ---- 6 renewal 60 s before the end ----
    expiresIn = 30;
    const fD = saFile("delta"); const before6 = reqs.length;
    await lib.getGscToken({ env: env({ GSC_SERVICE_ACCOUNT_FILE: fD }) });
    await lib.getGscToken({ env: env({ GSC_SERVICE_ACCOUNT_FILE: fD }) });
    expiresIn = 3600;
    check("cache: a token with less than 60 s left is renewed, not reused", reqs.length === before6 + 2, `requests ${reqs.length - before6}`);

    // ---- 7 refusal: a Blocked-style error that leaks neither key nor token ----
    mode = "deny"; const before7 = reqs.length;
    const e7 = await fail(lib.getGscToken({ env: env({ GSC_SERVICE_ACCOUNT_FILE: saFile("echo") }) }));
    const sent = reqs[reqs.length - 1] ? reqs[reqs.length - 1].params.assertion : "?";
    mode = "ok";
    const text7 = e7 ? `${e7.message} ${e7.reason} ${e7.unblock} ${e7.stack}` : "";
    check("refusal: a 401 from the endpoint gives a Blocked-style error (blocked, reason, unblock naming the next step)", e7 && e7.blocked === true && e7.name === "GoogleAuthBlocked" && /401/.test(e7.reason) && /service-account email|service account/i.test(e7.unblock), e7 ? e7.message : "no error thrown");
    check("refusal: the error message holds neither the private key nor the signed request nor a token", e7 && reqs.length === before7 + 1 && sent.length > 20 && !text7.includes(PEM_BODY) && !text7.includes(sent) && !/SA-TOKEN|RF-TOKEN/.test(text7), text7.slice(0, 300));
    const r7 = await lib.getGscToken({ env: env({ GSC_SERVICE_ACCOUNT_FILE: saFile("echo") }) });
    check("refusal: a refused request is not cached (the next call asks again and succeeds)", r7.token.startsWith("SA-TOKEN-") && reqs.length === before7 + 2, JSON.stringify(r7));

    // ---- 8 a service account that is set but broken is BLOCKED, not silently replaced by the token file ----
    const okTok = w(path.join(toks, "fresh.json"), { access_token: "FILE-TOKEN-1", expiry_date: Date.now() + 3600000 });
    const before8 = reqs.length;
    const e8 = await fail(lib.getGscToken({ env: env({ GSC_SERVICE_ACCOUNT_FILE: path.join(keys, "missing.json") }), tokenFile: okTok }));
    const e8b = await fail(lib.getGscToken({ env: env({ GSC_SERVICE_ACCOUNT_FILE: w(path.join(keys, "nokey.json"), { client_email: "x@y.z" }) }), tokenFile: okTok }));
    check("broken service account: an unreadable key file or one without private_key is BLOCKED and names the variable (no silent fallback)", e8 && e8.kind === "sa-unreadable" && /GSC_SERVICE_ACCOUNT_FILE/.test(e8.message) && e8b && e8b.kind === "sa-invalid" && reqs.length === before8, JSON.stringify([e8 && e8.message, e8b && e8b.message]));

    // ---- 9 bounded ----
    mode = "hang"; const t9 = Date.now();
    const e9 = await Promise.race([fail(lib.getGscToken({ env: env({ GSC_SERVICE_ACCOUNT_FILE: saFile("hotel") }), timeoutMs: 300 })), new Promise((r) => setTimeout(() => r("STILL WAITING"), 4000))]);
    mode = "ok";
    for (const s of sockets) s.destroy();
    check("bounded: a token endpoint that never answers is given up on (AbortController) with a Blocked-style error", e9 && e9 !== "STILL WAITING" && e9.kind === "sa-unreachable" && Date.now() - t9 < 3500, e9 === "STILL WAITING" ? "no answer after 4 s: the request is not bounded" : String(e9 && e9.message));

    // ---- 10 the token file ----
    const before10 = reqs.length;
    const f1 = await soft(lib.getGscToken({ env: env(), tokenFile: okTok }));
    const isoTok = w(path.join(toks, "iso.json"), { access_token: "FILE-TOKEN-ISO", expiry: new Date(Date.now() + 3600000).toISOString() });
    const f2 = await soft(lib.getGscToken({ env: env(), tokenFile: isoTok }));
    const viaEnv = await soft(lib.getGscToken({ env: env({ GSC_TOKEN_FILE: okTok }) }));
    check("token file: a fresh access_token (expiry_date in ms, or expiry as ISO, or GSC_TOKEN_FILE) is returned with source token-file and no request", f1.token === "FILE-TOKEN-1" && f1.source === "token-file" && f2.token === "FILE-TOKEN-ISO" && viaEnv.token === "FILE-TOKEN-1" && reqs.length === before10, JSON.stringify([f1, f2, viaEnv]));
    const rf = w(path.join(toks, "refresh.json"), { access_token: "OLD", expiry_date: Date.now() - 1000, refresh_token: "RTOKEN-XYZ", client_id: "cid", client_secret: "CSECRET-XYZ" });
    const shaBefore = sha(rf);
    const f3 = await soft(lib.getGscToken({ env: env(), tokenFile: rf }));
    const q3 = reqs[reqs.length - 1];
    check("token file: an expired token with refresh_token+client_id+client_secret is exchanged (refresh_token grant) and returned, the file is not rewritten here", f3.source === "token-file" && /^RF-TOKEN-/.test(f3.token) && f3.refreshed === true && q3.params.grant_type === "refresh_token" && q3.params.refresh_token === "RTOKEN-XYZ" && q3.params.client_id === "cid" && sha(rf) === shaBefore, JSON.stringify([f3, q3 && q3.params.grant_type]));
    mode = "deny";
    const e10 = await fail(lib.getGscToken({ env: env(), tokenFile: rf }));
    mode = "ok";
    const t10 = e10 ? `${e10.message} ${e10.stack}` : "";
    check("token file: a refused refresh is BLOCKED with the status and never echoes the refresh token or client secret", e10 && e10.kind === "refresh-refused" && /401/.test(e10.reason) && !/RTOKEN-XYZ|CSECRET-XYZ/.test(t10), t10.slice(0, 300));
    const e11 = await fail(lib.getGscToken({ env: env(), tokenFile: path.join(toks, "nothing-here.json") }));
    check("no way in: BLOCKED, and the text names both service-account variables as a way in", e11 && e11.kind === "no-token" && /GSC_SERVICE_ACCOUNT_FILE/.test(e11.message) && /GSC_SERVICE_ACCOUNT_JSON_B64/.test(e11.message), e11 && e11.message);
    const e12 = await fail(lib.getGscToken({ env: env(), tokenFile: w(path.join(toks, "expired-only.json"), { access_token: "OLD", expiry: "2020-01-01T00:00:00Z" }) }));
    check("token file: expired with nothing to refresh it with is BLOCKED", e12 && e12.kind === "no-usable" && /expired/.test(e12.reason), e12 && e12.message);

    // ---- 11 the service account wins over a token file ----
    const r13 = await lib.getGscToken({ env: env({ GSC_SERVICE_ACCOUNT_FILE: saFile("india") }), tokenFile: okTok });
    check("order: with both set, the service account is used, not the token file", r13.source === "service-account" && r13.token !== "FILE-TOKEN-1", JSON.stringify(r13));

    // ---- 12 the two callers use this one function ----
    const rg = fs.readFileSync(path.join(dir, "research-gsc.mjs"), "utf8"), ms = fs.readFileSync(path.join(dir, "measure-sources.mjs"), "utf8");
    check("callers: research-gsc.mjs and measure-sources.mjs call getGscToken and carry no token-exchange code of their own", [rg, ms].every((s) => /from "\.\/lib-google-auth\.mjs"/.test(s) && /getGscToken\(/.test(s) && !/grant_type/.test(s)), "one of them has its own token code");
    const M = await import(pathToFileURL(path.join(dir, "measure-sources.mjs")).href + `?v=${Math.random()}`);
    const mctx = (e) => ({ env: e, endpoints: { token: URL_ }, tokenFile: path.join(toks, "nothing-here.json") });
    const m1 = await M.gscAccessToken(mctx({ GSC_SERVICE_ACCOUNT_JSON_B64: Buffer.from(JSON.stringify(sa("measure"))).toString("base64") }));
    const m2 = await M.gscAccessToken(mctx({}));
    check("callers: measure-sources gscAccessToken takes the service account from its ctx.env, and blocks (with the two variable names) when there is none", m1.ok === true && /^SA-TOKEN-/.test(m1.token) && m2.ok === false && /GSC_SERVICE_ACCOUNT_FILE/.test(JSON.stringify(m2)) && /GSC_SERVICE_ACCOUNT_JSON_B64/.test(JSON.stringify(m2)), JSON.stringify([m1, m2]).slice(0, 400));

    // ---- 13 nothing on disk ----
    const all = []; const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : all.push(p); } }; walk(tmp);
    const leaked = all.filter((p) => /SA-TOKEN-|RF-TOKEN-/.test(fs.readFileSync(p, "utf8")));
    check("disk: no file under the temp folder (cwd, key and token folders) contains a service-account or refreshed token, and the cwd stays empty", !leaked.length && fs.readdirSync(cwd).length === 0, `${leaked.join(", ")} cwd: ${fs.readdirSync(cwd).join(",")}`);
  } finally {
    process.chdir(prevCwd);
    for (const s of sockets) s.destroy();
    await new Promise((r) => server.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return results;
}

// ---------------- mutants ----------------
const MUTANTS = [
  { name: "signing with the wrong algorithm", file: "lib-google-auth.mjs", from: 'createSign("RSA-SHA256")', to: 'createSign("RSA-SHA1")', expect: [/^jwt: the signature verifies/] },
  { name: "header says HS256", file: "lib-google-auth.mjs", from: 'alg: "RS256"', to: 'alg: "HS256"', expect: [/^jwt: header is exactly/] },
  { name: "lifetime of two hours", file: "lib-google-auth.mjs", from: "exp: now + 3600", to: "exp: now + 7200", expect: [/^jwt: exp is iat \+ 3600/] },
  { name: "scope parameter ignored", file: "lib-google-auth.mjs", from: "iss: sa.client_email, scope, aud", to: "iss: sa.client_email, scope: DEFAULT_SCOPE, aud", expect: [/^scope: the scope parameter/] },
  { name: "aud ignores the key file's token_uri", file: "lib-google-auth.mjs", from: "sa.token_uri || DEFAULT_TOKEN_URL, now", to: "DEFAULT_TOKEN_URL, now", expect: [/^jwt: aud is the key file/] },
  { name: "cache disabled", file: "lib-google-auth.mjs", from: "if (hit && hit.expiresAt - REFRESH_SKEW_MS > Date.now())", to: "if (false)", expect: [/^cache: a second call within the hour/, /^scope: the scope parameter/] },
  { name: "no 60 s renewal margin", file: "lib-google-auth.mjs", from: "hit.expiresAt - REFRESH_SKEW_MS > Date.now()", to: "hit.expiresAt > Date.now()", expect: [/^cache: a token with less than 60 s left/] },
  { name: "base64 variable ignored", file: "lib-google-auth.mjs", from: "b64 = env.GSC_SERVICE_ACCOUNT_JSON_B64;", to: "b64 = undefined;", expect: [/^b64: GSC_SERVICE_ACCOUNT_JSON_B64 works/] },
  { name: "token-file fallback removed", file: "lib-google-auth.mjs", from: "return viaTokenFile({ env, tokenFile, tokenUrl, timeoutMs });", to: 'throw new GoogleAuthBlocked("no-token", "gone");', expect: [/^token file: a fresh access_token/, /^token file: an expired token/] },
  { name: "request is not bounded", file: "lib-google-auth.mjs", from: "signal: ac.signal", to: "signal: undefined", expect: [/^bounded: a token endpoint that never answers/] },
  { name: "errors echo what the server said unscrubbed", file: "lib-google-auth.mjs", from: "const scrub = (s, secrets) => {", to: 'const scrub = (s, secrets) => { return String(s ?? "");', expect: [/^refusal: the error message holds neither/, /^token file: a refused refresh/] },
  { name: "the service-account token is written to disk", file: "lib-google-auth.mjs", from: "cache.set(key, { token: r.json.access_token, expiresAt });", to: 'cache.set(key, { token: r.json.access_token, expiresAt }); fs.writeFileSync(path.join(process.cwd(), "gsc-token.json"), JSON.stringify({ access_token: r.json.access_token }));', expect: [/^disk: no file under the temp folder/] },
  { name: "a broken service account silently falls back to the token file", file: "lib-google-auth.mjs", from: "const sa = readServiceAccount(env);", to: "let sa = null; try { sa = readServiceAccount(env); } catch {}", expect: [/^broken service account/] },
  { name: "research-gsc.mjs goes back to its own token code", file: "research-gsc.mjs", from: "await getGscToken({ tokenFile: tokenFile() })", to: 'await getGscTokenOld({ tokenFile: tokenFile() })', expect: [/^callers: research-gsc\.mjs and measure-sources\.mjs call getGscToken/] },
];

if (isMain(import.meta.url)) {
  if (A.includes("--help")) { console.log("usage: node test-google-auth.mjs [--scripts <dir>] [--no-mutants] [--mutant <name part>]"); process.exit(0); }
  const main = await scenarios(scriptsDir);
  for (const r of main) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : `\n     ${r.detail}`}`);
  let failed = main.filter((r) => !r.ok).length;
  console.log(failed ? `GOOGLE AUTH TEST FAIL: ${failed} of ${main.length}` : `GOOGLE AUTH TEST PASS: ${main.length} of ${main.length}`);
  if (!failed && !A.includes("--no-mutants")) {
    console.log("\nWatched-fail mutants (each must turn the named assertions red; the unmutated tree is green above):");
    let caught = 0, ran = 0;
    for (const mu of MUTANTS.filter((m) => !opt("--mutant") || m.name.includes(opt("--mutant")))) {
      ran++;
      const mdir = fs.mkdtempSync(path.join(os.tmpdir(), "pewp-gauth-mutant-"));
      const sdir = path.join(mdir, "scripts");
      for (let t = 0; ; t++) { try { fs.mkdirSync(sdir, { recursive: true }); fs.cpSync(scriptsDir, sdir, { recursive: true }); break; } catch (e) { if (t >= 4) throw e; } }
      const target = path.join(sdir, mu.file); const src = fs.readFileSync(target, "utf8"); const count = src.split(mu.from).length - 1;
      if (count !== 1) { console.log(`FAIL mutant "${mu.name}": patch target found ${count} times in ${mu.file} (the patch did not apply)`); failed++; fs.rmSync(mdir, { recursive: true, force: true }); continue; }
      fs.writeFileSync(target, src.replace(mu.from, () => mu.to));
      let res;
      try { res = await scenarios(sdir); } catch (e) { res = [{ name: `crashed: ${e.message}`, ok: false }]; }
      const red = res.filter((r) => !r.ok);
      const missing = mu.expect.filter((re) => !red.some((r) => re.test(r.name)));
      const ok = red.length > 0 && !missing.length;
      if (ok) caught++; else failed++;
      console.log(`${ok ? "RED (caught)" : "FAIL (survived)"} ${mu.name}: ${red.length} assertion(s) red${red.length ? ` e.g. "${red[0].name.slice(0, 80)}"` : ""}${missing.length ? `; expected red but green: ${missing.map(String).join(" ")}` : ""}`);
      fs.rmSync(mdir, { recursive: true, force: true, maxRetries: 5 });
    }
    console.log(failed ? `MUTANTS FAIL: ${caught} of ${ran} caught` : `MUTANTS PASS: ${caught} of ${ran} caught`);
  }
  process.exit(failed ? 1 : 0);
}
