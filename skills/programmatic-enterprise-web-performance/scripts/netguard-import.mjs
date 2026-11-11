// Loaded with `node --import scripts/netguard-import.mjs <script>` by the tests that run a real script: every non-local request (fetch, http,
// https) is refused and, when PEWP_NETGUARD_LOG is set, logged there. Nothing here talks to a network.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";

const log = (s) => { if (process.env.PEWP_NETGUARD_LOG) { try { fs.appendFileSync(process.env.PEWP_NETGUARD_LOG, s + "\n"); } catch {} } };
const local = (h) => /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/.test(String(h || ""));
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  let h = ""; try { h = new URL(url).hostname; } catch {}
  if (!local(h)) { log(url); return Promise.reject(new Error("NETWORK GUARD: refused non-local request " + url)); }
  return realFetch(input, init);
};
for (const mod of [http, https]) for (const fn of ["request", "get"]) {
  const real = mod[fn];
  mod[fn] = function (...a) {
    const o = a[0];
    const h = typeof o === "string" ? (() => { try { return new URL(o).hostname; } catch { return ""; } })() : o instanceof URL ? o.hostname : (o?.hostname || o?.host || "");
    if (!local(String(h).replace(/:\d+$/, ""))) { log(fn + " " + h); throw new Error("NETWORK GUARD: refused non-local request " + h); }
    return real.apply(this, a);
  };
}
