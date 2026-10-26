// Submit the live sitemap FILE (sitemap.xml) to Search Console and Bing, but only after sitemap-check.mjs passed today (overhaul step 13, contract C9).
// Usage: node sitemap-submit.mjs <live url> --sitemap <sitemap url> [--engines gsc,bing] [--property url-prefix|domain|<site>] [--cwd DIR] [--today YYYY-MM-DD] [--dotenv FILE]
// Refuses (exit 1, "nothing submitted: no PASS of sitemap-check for <date>") unless <pewp>/sitemap/check-<today>.json has status PASS and the
// sitemap named here is one the check read. Nothing is sent otherwise.
//   gsc   PUT {GSC_API_BASE | https://www.googleapis.com/webmasters/v3}/sites/{site}/sitemaps/{sitemap}   (both URL-encoded)
//         bearer token from getGscToken({ scope: ".../auth/webmasters" }) (lib-google-auth.mjs; service account or token file).
//         site = the URL-prefix property <origin>/ by default; --property domain -> sc-domain:<host>; --property <site> is used as given.
//   bing  POST {BING_API_BASE | https://ssl.bing.com/webmaster/api.svc/json}/SubmitFeed?siteUrl=<origin>/&feedUrl=<sitemap>&apikey=$BING_WEBMASTER_KEY
//         (the same two fields are also sent as a JSON body, which is how Bing documents the call).
// UNPROVEN LIVE: neither API was called for real by this build; the request shapes follow Google's and Bing's published docs and are proved only
// against local fake servers (test-sitemap.mjs). The first live submission is the proof: read the recorded status and body head.
// A missing token or key makes that engine BLOCKED (recorded, with what unblocks it). Never retries (a 4xx is final). Each request is bounded to 30 s.
// Records <pewp>/sitemap/submit-<date>.json { generatedAt, date, site, sitemapUrl, engines, responses:[{ engine, status, outcome, bodyHead (200 chars), at, request }] }.
// The key and the token never appear in any output or file (they are cut out of the request line and the body head).
// Exit 0 when at least one engine accepted, 1 refused (no same-day PASS, or every engine that ran was refused), 2 usage, 3 when no engine could run (all BLOCKED).
import fs from "node:fs";
import path from "node:path";
import { isMain } from "./lib-main.mjs";
import { locate } from "./state.mjs";
import { envFileArg, loadEnv, EnvFileError } from "./lib-env.mjs";
import { UsageError } from "./lib-polite.mjs";
import { getGscToken } from "./lib-google-auth.mjs";
import { parseArgs } from "./sitemap-check.mjs";

const USAGE = "usage: node sitemap-submit.mjs <live url> --sitemap <sitemap url> [--engines gsc,bing] [--property url-prefix|domain|<site>] [--cwd DIR] [--today YYYY-MM-DD] [--dotenv FILE]";
const VALUE_OPTS = new Set(["--sitemap", "--engines", "--property", "--cwd", "--today", "--dotenv", "--env-file"]);
const TIMEOUT_MS = 30000;
const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters";
const BING_UNBLOCK = "verify the site in Bing Webmaster Tools, create an API key (Settings > API access) and set BING_WEBMASTER_KEY";
const strict = (u) => { try { const x = new URL(u); x.hash = ""; return x.href; } catch { return String(u); } };

// every secret cut out of a text, raw and URL-encoded
function scrubber(secrets) {
  const list = secrets.filter((s) => s && String(s).length > 3).flatMap((s) => [String(s), encodeURIComponent(String(s))]);
  return (t) => { let x = String(t ?? ""); for (const s of list) x = x.split(s).join("[hidden]"); return x; };
}

async function send(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text().catch(() => "");
  return { status: res.status, text };
}

export async function run(argv, out = (s) => console.log(s)) {
  let args;
  try { args = parseArgs(argv, VALUE_OPTS); } catch (e) { if (e instanceof UsageError) { console.error(`usage error: ${e.message}\n${USAGE}`); return 2; } throw e; }
  const { pos, opts } = args;
  if (opts.help) { out(USAGE); return 0; }
  if (pos.length !== 1 || !/^https?:\/\//i.test(pos[0])) { console.error(`usage error: give the live site address (http:// or https://)\n${USAGE}`); return 2; }
  if (!opts.sitemap || !/^https?:\/\//i.test(opts.sitemap)) { console.error(`usage error: --sitemap <full sitemap address> is required\n${USAGE}`); return 2; }
  const engines = String(opts.engines || "gsc,bing").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!engines.length || engines.some((x) => x !== "gsc" && x !== "bing")) { console.error(`usage error: --engines is a comma list of gsc, bing (got ${opts.engines})\n${USAGE}`); return 2; }
  if (opts.today && !/^\d{4}-\d{2}-\d{2}$/.test(opts.today)) { console.error(`usage error: --today must be YYYY-MM-DD (got ${opts.today})`); return 2; }
  const cwd = path.resolve(opts.cwd || process.cwd());
  const loc = locate(pos[0], { cwd });
  try { loadEnv({ envFile: envFileArg(argv), pewp: loc.pewp, cwd }); } catch (e) { if (e instanceof EnvFileError) { console.error(`usage error: ${e.message}`); return 2; } throw e; }

  const date = opts.today || new Date().toISOString().slice(0, 10);
  const origin = new URL(pos[0]).origin;
  const dir = path.join(loc.pewp, "sitemap");
  const checkFile = path.join(dir, `check-${date}.json`);
  let check = null;
  try { check = JSON.parse(fs.readFileSync(checkFile, "utf8")); } catch { check = null; }
  if (!check || check.status !== "PASS") {
    out(`nothing submitted: no PASS of sitemap-check for ${date} (${check ? `the check of ${date} says ${check.status}` : `${checkFile} does not exist`}). Run sitemap-check.mjs and fix what it finds first.`);
    return 1;
  }
  const checkedMaps = new Set([check.sitemapUrl, ...(check.sitemapUrls || [])].filter(Boolean).map(strict));
  if (!checkedMaps.has(strict(opts.sitemap))) {
    out(`nothing submitted: ${opts.sitemap} is not a sitemap file the check of ${date} read (it read ${[...checkedMaps].join(", ")}). Submit the file that was checked.`);
    return 1;
  }

  const key = (process.env.BING_WEBMASTER_KEY || "").trim();
  const responses = [];
  let token = null;
  const gscSite = !opts.property || /^(url-prefix|url|prefix)$/i.test(opts.property) ? `${origin}/` : /^(domain|sc-domain)$/i.test(opts.property) ? `sc-domain:${loc.host}` : opts.property;

  for (const engine of engines) {
    const at = new Date().toISOString();
    if (engine === "gsc") {
      let tok;
      try { tok = (await getGscToken({ env: process.env, scope: GSC_SCOPE })).token; token = tok; }
      catch (e) {
        const reason = String(e && e.reason || e && e.message || e).slice(0, 300);
        responses.push({ engine, status: "BLOCKED", outcome: "blocked", reason, unblock: e && e.unblock || "set up Search Console access (see doctor.mjs)", bodyHead: "", at });
        out(`gsc: BLOCKED ${reason}`);
        continue;
      }
      const base = (process.env.GSC_API_BASE || "https://www.googleapis.com/webmasters/v3").replace(/\/$/, "");
      const url = `${base}/sites/${encodeURIComponent(gscSite)}/sitemaps/${encodeURIComponent(opts.sitemap)}`;
      const clean = scrubber([tok, key]);
      try {
        const r = await send(url, { method: "PUT", headers: { authorization: `Bearer ${tok}`, "user-agent": "pewp-sitemap-submit" } });
        const ok = r.status >= 200 && r.status < 300;
        responses.push({ engine, status: r.status, outcome: ok ? "submitted" : "rejected", bodyHead: clean(r.text).slice(0, 200), at, request: `PUT ${clean(url)}` });
        out(`gsc: ${ok ? "submitted" : "REFUSED"} (HTTP ${r.status}) ${opts.sitemap} for ${gscSite}${ok ? "" : ` ${clean(r.text).replace(/\s+/g, " ").slice(0, 120)}`}`);
      } catch (e) {
        responses.push({ engine, status: null, outcome: "error", bodyHead: clean(String(e.cause?.code || e.message || e)).slice(0, 200), at, request: `PUT ${clean(url)}` });
        out(`gsc: ERROR ${clean(String(e.cause?.code || e.message || e)).slice(0, 120)} (not retried)`);
      }
    } else {
      if (!key) {
        responses.push({ engine, status: "BLOCKED", outcome: "blocked", reason: "BING_WEBMASTER_KEY is not set", unblock: BING_UNBLOCK, bodyHead: "", at });
        out(`bing: BLOCKED BING_WEBMASTER_KEY is not set; ${BING_UNBLOCK}`);
        continue;
      }
      const base = (process.env.BING_API_BASE || "https://ssl.bing.com/webmaster/api.svc/json").replace(/\/$/, "");
      const q = { siteUrl: `${origin}/`, feedUrl: opts.sitemap };
      const url = `${base}/SubmitFeed?${new URLSearchParams({ ...q, apikey: key })}`;
      const clean = scrubber([key, token]);
      const shown = clean(url);
      try {
        const r = await send(url, { method: "POST", headers: { "content-type": "application/json; charset=utf-8", "user-agent": "pewp-sitemap-submit" }, body: JSON.stringify(q) });
        const ok = r.status >= 200 && r.status < 300 && !/"ErrorCode"\s*:\s*[1-9]/.test(r.text);
        responses.push({ engine, status: r.status, outcome: ok ? "submitted" : "rejected", bodyHead: clean(r.text).slice(0, 200), at, request: `POST ${shown}` });
        out(`bing: ${ok ? "submitted" : "REFUSED"} (HTTP ${r.status}) ${opts.sitemap}${ok ? "" : ` ${clean(r.text).replace(/\s+/g, " ").slice(0, 120)}`}`);
      } catch (e) {
        responses.push({ engine, status: null, outcome: "error", bodyHead: clean(String(e.cause?.code || e.message || e)).slice(0, 200), at, request: `POST ${shown}` });
        out(`bing: ERROR ${clean(String(e.cause?.code || e.message || e)).slice(0, 120)} (not retried)`);
      }
    }
  }

  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `submit-${date}.json`);
  fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), date, site: `${origin}/`, gscProperty: engines.includes("gsc") ? gscSite : null, sitemapUrl: opts.sitemap, check: path.basename(checkFile), engines, responses }, null, 1) + "\n");
  const done = responses.filter((r) => r.outcome === "submitted").length;
  out(`submitted: ${done} of ${engines.length} engine(s); recorded in ${file}`);
  if (done) return 0;
  return responses.some((r) => r.outcome !== "blocked") ? 1 : 3;
}

if (isMain(import.meta.url)) {
  run(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(`ERROR sitemap-submit crashed: ${String(e && e.message || e).slice(0, 300)}`); process.exit(1); });
}
