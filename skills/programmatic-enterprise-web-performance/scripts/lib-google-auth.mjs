// Google access token for the Search Console API, for every script of this skill (research-gsc.mjs, measure-sources.mjs).
// UNPROVEN against the live Google token endpoint (2026-10-26): the JWT shape, signature and exchange are tested only against a local
// fake endpoint and a generated RSA key (test-google-auth.mjs). The first real run proves it; read its BLOCKED text if Google refuses.
//   const { token, source, expiresAt } = await getGscToken({ env, tokenFile, scope });
// Two ways in, tried in this order:
//   1 service account  GSC_SERVICE_ACCOUNT_FILE (path to the key JSON) or GSC_SERVICE_ACCOUNT_JSON_B64 (the same JSON, base64).
//     A signed one-hour request (RS256 JWT, node:crypto) is exchanged for an access token. The token is kept in memory only
//     (module Map, renewed 60 s before it ends) and is NEVER written to disk. The service-account email must be a user of the property.
//   2 token file       GSC_TOKEN_FILE or ~/.config/pewp/gsc-token.json: { access_token, expiry|expiry_date } or
//     { refresh_token, client_id, client_secret } (a refreshed token is returned, not written; measure-sources.mjs keeps its own write-back).
// Test hook: GSC_TOKEN_URL (in env) replaces the token endpoint. Write access (sitemap submit): pass scope "https://www.googleapis.com/auth/webmasters"
// (the short word `webmasters` is accepted too). Every request is bounded to 30 s. A refusal throws GoogleAuthBlocked: .reason says what
// happened, .unblock says what the owner or we do next; neither ever contains the private key, the signed request or a token.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSign } from "node:crypto";

export const DEFAULT_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const UNBLOCK = "the site owner adds our Google account (or the service-account email) as a user of the Search Console property, then we either set GSC_SERVICE_ACCOUNT_FILE (path to the service-account JSON) or GSC_SERVICE_ACCOUNT_JSON_B64 (the same JSON, base64), or save an OAuth token at ~/.config/pewp/gsc-token.json (or set GSC_TOKEN_FILE); see scripts/doctor.mjs";
const REFRESH_SKEW_MS = 60000;
const TIMEOUT_MS = 30000;

export class GoogleAuthBlocked extends Error {
  constructor(kind, reason, unblock = UNBLOCK) { super(`${reason}; ${unblock}`); this.name = "GoogleAuthBlocked"; this.kind = kind; this.reason = reason; this.unblock = unblock; this.blocked = true; }
}

const cache = new Map(); // key -> { token, expiresAt }; memory only, by design
export const clearGoogleAuthCache = () => cache.clear();

const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const scrub = (s, secrets) => { let t = String(s ?? ""); for (const x of secrets) if (x && String(x).length > 3) t = t.split(String(x)).join("[hidden]"); return t.replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, "[hidden]").slice(0, 200); };
const fullScope = (s) => (!s ? DEFAULT_SCOPE : /^https?:/.test(s) ? s : `https://www.googleapis.com/auth/${s}`);

function readServiceAccount(env) {
  const file = env.GSC_SERVICE_ACCOUNT_FILE, b64 = env.GSC_SERVICE_ACCOUNT_JSON_B64;
  if (!file && !b64) return null;
  const name = file ? "GSC_SERVICE_ACCOUNT_FILE" : "GSC_SERVICE_ACCOUNT_JSON_B64";
  let sa;
  try { sa = JSON.parse(stripBom(file ? fs.readFileSync(file, "utf8") : Buffer.from(b64, "base64").toString("utf8"))); }
  catch { throw new GoogleAuthBlocked("sa-unreadable", `${name} is set but ${file ? `${file} cannot be read as JSON` : "its value is not base64 of a JSON file"}`, `fix ${name} (the service-account key JSON, never printed here) or unset it to use the OAuth token file`); }
  if (!sa || typeof sa.client_email !== "string" || typeof sa.private_key !== "string") throw new GoogleAuthBlocked("sa-invalid", `${name} has no client_email and private_key`, "use the JSON key downloaded for the service account (Google Cloud > IAM > Service accounts > Keys)");
  return sa;
}

async function postToken(url, params, secrets, timeoutMs) {
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString(), signal: ac.signal });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, json: j, why: scrub(j.error_description || j.error || "", secrets) };
  } finally { clearTimeout(timer); }
}

const b64url = (v) => Buffer.from(v).toString("base64url");
function makeJwt(sa, scope, aud, now) {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: sa.client_email, scope, aud, iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256"); signer.update(`${head}.${body}`);
  try { return `${head}.${body}.${signer.sign(sa.private_key, "base64url")}`; }
  catch { throw new GoogleAuthBlocked("sa-sign", "the service-account private key could not be used to sign (not a valid RSA key)", "download a new JSON key for the service account"); }
}

async function viaServiceAccount(sa, { env, scope, tokenUrl, timeoutMs }) {
  const key = `${sa.client_email}\n${scope}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt - REFRESH_SKEW_MS > Date.now()) return { token: hit.token, source: "service-account", expiresAt: hit.expiresAt };
  const now = Math.floor(Date.now() / 1000);
  const jwt = makeJwt(sa, scope, sa.token_uri || DEFAULT_TOKEN_URL, now);
  const url = env.GSC_TOKEN_URL || sa.token_uri || tokenUrl || DEFAULT_TOKEN_URL;
  const secrets = [sa.private_key, jwt];
  let r;
  try { r = await postToken(url, { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }, secrets, timeoutMs); }
  catch (e) { throw new GoogleAuthBlocked("sa-unreachable", `the Google token endpoint could not be reached (${scrub(e.name === "AbortError" ? "timed out after 30 s" : e.message, secrets)})`, "check the network and run again"); }
  if (!r.ok || !r.json.access_token) throw new GoogleAuthBlocked("sa-refused", `Google refused the service account ${sa.client_email} (HTTP ${r.status}${r.why ? `: ${r.why}` : ""})`, "check the key is current and that the Search Console API is enabled for its project, then add the service-account email as a user of the property");
  const expiresAt = Date.now() + (Number(r.json.expires_in) || 3600) * 1000;
  cache.set(key, { token: r.json.access_token, expiresAt });
  return { token: r.json.access_token, source: "service-account", expiresAt };
}

async function viaTokenFile({ env, tokenFile, tokenUrl, timeoutMs }) {
  const file = tokenFile || env.GSC_TOKEN_FILE || path.join(os.homedir(), ".config", "pewp", "gsc-token.json");
  let t = null;
  try { t = JSON.parse(stripBom(fs.readFileSync(file, "utf8"))); } catch { t = null; }
  if (!t) throw new GoogleAuthBlocked("no-token", `no token file at ${file} and no service account set`);
  // measure-sources.mjs writes `expiry` (ISO); Google's own files carry `expiry_date` (ms)
  const exp = t.expiry_date ?? t.expiry;
  const expMs = typeof exp === "number" ? exp : exp ? Date.parse(exp) : null;
  const hasExp = expMs != null && !Number.isNaN(expMs);
  if (t.access_token && (!hasExp || expMs - Date.now() > REFRESH_SKEW_MS)) return { token: t.access_token, source: "token-file", expiresAt: hasExp ? expMs : null, file };
  if (!(t.refresh_token && t.client_id && t.client_secret))
    throw new GoogleAuthBlocked("no-usable", t.access_token ? "the token has expired and has no refresh_token/client_id/client_secret" : `${file} has no usable access_token or refresh_token+client_id+client_secret`);
  const url = env.GSC_TOKEN_URL || t.token_uri || tokenUrl || DEFAULT_TOKEN_URL;
  const secrets = [t.refresh_token, t.client_secret, t.access_token];
  const again = `the owner re-authorises and we save a new token at ${file} (or use a service account: GSC_SERVICE_ACCOUNT_FILE / GSC_SERVICE_ACCOUNT_JSON_B64)`;
  let r;
  try { r = await postToken(url, { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: t.client_id, client_secret: t.client_secret }, secrets, timeoutMs); }
  catch (e) { throw new GoogleAuthBlocked("refresh-failed", `token refresh failed: ${scrub(e.name === "AbortError" ? "timed out after 30 s" : e.message, secrets)}`, again); }
  if (!r.ok || !r.json.access_token) throw new GoogleAuthBlocked("refresh-refused", `the Search Console token could not be refreshed (HTTP ${r.status}${r.why ? `: ${r.why}` : ""})`, again);
  return { token: r.json.access_token, source: "token-file", expiresAt: Date.now() + (Number(r.json.expires_in) || 3600) * 1000, refreshed: true, file };
}

export async function getGscToken({ env = process.env, tokenFile, scope, tokenUrl, timeoutMs = TIMEOUT_MS } = {}) {
  const sa = readServiceAccount(env);
  if (sa) return viaServiceAccount(sa, { env, scope: fullScope(scope), tokenUrl, timeoutMs });
  return viaTokenFile({ env, tokenFile, tokenUrl, timeoutMs });
}
