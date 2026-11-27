// The session report endpoint (docs/advisor/r3/HANDOVER-collector.md, ADR 007 step 2): a Cloudflare Pages Function on omnikom.io with a
// Workers KV binding ADVISOR_REPORTS and a secret REPORT_SALT. onRequest({ request, env }) answers 405 for anything but POST; 204 with nothing
// stored under Sec-GPC: 1; 503 without the binding or the salt, or when a KV call throws; 413 over 8 KiB; 400 for bad JSON, a field outside the
// allow-list or a pack not on the list; 429 past 30 reports from one IP in a day; 204 when stored. The body is read as text whatever its
// Content-Type (sendBeacon with a string sends text/plain). The report is redacted again, stored under r:<UTC day>:<session> for 30 days; the
// IP is kept only as a salted hash in the counter key c:<hash> for 24 hours, never in a report. No fetch, no model call, no log line.
import { redact } from './redact.mjs';
import { REPORT_PACKS } from './policy.mjs';

const BODY_MAX = 8192, KEEP_S = 2592000, CAP_S = 86400, CAP = 30, MISSES_MAX = 20;
const COUNTS = ['open', 'turns', 'answered', 'clarify', 'noMatch', 'threeNoMatch', 'qualified', 'planShown', 'handoffOpened', 'didntAnswer'];
const KINDS = ['no-match', 'clarify-picked', 'three-no-match', 'didnt-answer'];
const BANDS = ['answer', 'clarify', 'fallback', 'abstain'];
const TOP_KEYS = ['v', 'pack', 'packVersion', 'session', 'counts', 'misses'];
const MISS_KEYS = ['kind', 'text', 'band', 'top', 'turn'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const only = (o, keys) => Object.keys(o).every((k) => keys.includes(k));
const reply = (status) => new Response(null, { status });

// the report as stored, or null when anything is outside the shape
function clean(r) {
  if (!isObj(r) || !only(r, TOP_KEYS) || r.v !== 1) return null;
  if (!REPORT_PACKS.includes(r.pack)) return null;
  if (typeof r.packVersion !== 'string' || r.packVersion.length > 32) return null;
  if (typeof r.session !== 'string' || !UUID.test(r.session)) return null;
  if (!isObj(r.counts) || !only(r.counts, COUNTS)) return null;
  const counts = {};
  for (const k of COUNTS) {
    const n = r.counts[k] ?? 0;
    if (!Number.isInteger(n) || n < 0 || n > 10000) return null;
    counts[k] = n;
  }
  if (!Array.isArray(r.misses) || r.misses.length > MISSES_MAX) return null;
  const misses = [];
  for (const m of r.misses) {
    if (!isObj(m) || !only(m, MISS_KEYS) || !KINDS.includes(m.kind) || !BANDS.includes(m.band) || typeof m.text !== 'string') return null;
    if (!Number.isInteger(m.turn) || m.turn < 0 || m.turn > 10000) return null;
    if (!Array.isArray(m.top) || m.top.length > 3 || !m.top.every((t) => typeof t === 'string' && t.length <= 80)) return null;
    misses.push({ kind: m.kind, text: redact(m.text), band: m.band, top: [...m.top], turn: m.turn });
  }
  return { v: 1, pack: r.pack, packVersion: r.packVersion, session: r.session.toLowerCase(), counts, misses };
}

async function hmacHex(key, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return reply(405);
  if (request.headers.get('sec-gpc') === '1') return reply(204);
  const kv = env?.ADVISOR_REPORTS, salt = env?.REPORT_SALT;
  if (!kv || typeof salt !== 'string' || !salt) return reply(503);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > BODY_MAX) return reply(413);
  let body;
  try { body = JSON.parse(text); } catch { return reply(400); }
  const rep = clean(body);
  if (!rep) return reply(400);
  const day = new Date().toISOString().slice(0, 10);
  const capKey = 'c:' + (await hmacHex(salt, day + '|' + (request.headers.get('cf-connecting-ip') || '')));
  try {
    const n = Number(await kv.get(capKey)) || 0;
    if (n >= CAP) return reply(429);
    await kv.put(capKey, String(n + 1), { expirationTtl: CAP_S });
    await kv.put('r:' + day + ':' + rep.session, JSON.stringify(rep), { expirationTtl: KEEP_S });
  } catch {
    return reply(503);
  }
  return reply(204);
}
