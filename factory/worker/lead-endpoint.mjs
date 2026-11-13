// The site's /api/lead endpoint (docs/blueprint/14-LEAD-PATH.md section 2; sops/site-endpoints.md 2.3 and 2.4): one handler
// that runs unchanged as a Cloudflare Pages Function (pages-function-lead.js) or inside a Worker. It takes the browser's JSON,
// refuses the obvious (wrong method, too large, not JSON, honeypot filled), signs the exact body with the site's own key
// (t + METHOD + path?query + body, HMAC-SHA256: the same canonical form as supabase/functions/_shared/signature.ts) and forwards
// it to the platform's capture-lead, with the visitor (sha256 of the site id and the address in cf-connecting-ip) in the signed path as &visitor=<hash>,
// so that capture-lead can limit one visitor. Whatever comes back is turned into the plain-words answer the form shows; only a 202 from
// the platform may become "sent". Web Crypto only; no dependencies. Tests: factory/worker/test/run.mjs and mutate.mjs.
// Brief 5-L: the plain browser form (application/x-www-form-urlencoded, no script) is accepted too. Its fields become the same
// JSON object a script sends, that JSON is what is signed and forwarded, and the answer is a page for a person, never JSON.
// Product row E5-b: a visitor the platform answered 429 is answered 429 here, with the same words, for the next 60 s, from the Cloudflare data center's cache.
const H = { 'content-type': 'application/json', 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' };
const CALL_US = 'We could not send this. Please call or email us.';
const TRY_AGAIN = 'We could not send this. Your answers are still here. Try again, or call us.';
const SLOW_DOWN = 'Please try again in a minute.';   // the words of every 429 this endpoint gives: the platform's and the hold's (product row E5-b)
// The hold (product row E5-b): after the platform answered 429 for a visitor, that visitor's posts are answered here for HOLD_SECONDS from the Cloudflare
// data center's cache (the Cache API's caches.default: no binding, and its contents stay in that data center), so they cost capture-lead no call and the
// database no connection. The key is the visitor hash on this site's own address, never the address. A cache that fails is skipped: the post goes on.
const HOLD_SECONDS = 60;
const enc = new TextEncoder();

export async function sign(key, method, pathWithQuery, body, t = Math.floor(Date.now() / 1000)) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${t}\n${method.toUpperCase()}\n${pathWithQuery}\n${body}`)));
  return `t=${t},v1=${Array.from(mac, b => b.toString(16).padStart(2, '0')).join('')}`;
}

// The visitor: sha256 of "<site id>:<address>", the same text capture-lead hashes for its own records (capture-lead/index.ts), so stored hashes keep their
// meaning. It goes inside the signed path (product row E5), where capture-lead limits one visitor; the address itself never leaves this endpoint.
export async function visitorHash(siteId, ip) {
  if (!ip) return null;
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${siteId}:${ip}`)));
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('');
}

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: H });

// The plain browser form (no script): application/x-www-form-urlencoded, answered with a page for a person, never JSON.
// Words: sops/site-endpoints.md 2.3 for the failures; the plan gives no thank-you wording, so the success line is the shortest neutral one.
const HTML_H = { ...H, 'content-type': 'text/html; charset=utf-8' };
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const FIELD_WORDS = { name: 'Your name', email: 'Email', phone: 'Phone', consentText: 'Consent', form: 'The form', page: 'The page' };
const TOP = new Set(['form', 'flow', 'page', 'cta', 'assignee', 'name', 'email', 'phone', 'consentText', 'hp', 'idempotencyKey']);
const isFormPost = (request) => (request.headers.get('content-type') || '').toLowerCase().startsWith('application/x-www-form-urlencoded');

// The form's fields as the LeadRequest a JSON caller sends. A name in TOP is a LeadRequest field; any other name is one of the
// form's own fields and goes into answers. The tick-boxes carry consent: consentText is forwarded only with the contact box ticked
// (capture-lead then refuses it as REQUIRED, as for a JSON caller that sends none), and marketingConsent is { given, text }, given
// false when its box was left empty (sops/site-endpoints.md 6).
export function leadFromForm(body) {
  const p = new URLSearchParams(body), lead = {}, answers = {};
  for (const k of new Set(p.keys())) {
    if (k === 'consent' || k === 'marketingConsent' || k === 'marketingConsentText' || k === '__proto__') continue;
    const all = p.getAll(k);
    if (TOP.has(k)) lead[k] = all[0]; else answers[k] = all.length > 1 ? all : all[0];
  }
  if (p.get('consent') !== 'yes') delete lead.consentText;
  const text = p.get('marketingConsentText');
  if (text) lead.marketingConsent = { given: p.get('marketingConsent') === 'yes', text };
  if (Object.keys(answers).length) lead.answers = answers;
  return lead;
}

// The way back is the page the visitor was on (the form's own `page` field), only ever a path on this site.
const backPath = (page) => (typeof page === 'string' && /^\/(?!\/)[^\s"'<>\\]*$/.test(page) ? page : '/');
function htmlPage(status, title, inner, back, linkText = 'Back to the form') {
  const link = back ? `<p><a href="${escHtml(back)}">${linkText}</a></p>` : '';
  return new Response(`<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escHtml(title)}</title></head><body><main><h1>${escHtml(title)}</h1>\n${inner}\n${link}</main></body></html>\n`, { status, headers: HTML_H });
}
// The JSON answer shapes below, as a page: sent -> thank-you; problems -> each named in words; msg -> the plain-words message.
// A sent form post is answered 303 (post-redirect-get: a refresh asks for the page again, it does not send the form twice).
const thankYouPage = () => htmlPage(200, 'Thank you', '<p>Your message was sent.</p>', '/', 'Back to the site');
const FORM_TRY_AGAIN = 'We could not send this. Nothing was sent. Go back and try again, or call us.';
function formAnswer(status, obj, back, thanksTo) {
  if (obj.sent) return new Response(null, { status: 303, headers: { 'x-robots-tag': H['x-robots-tag'], 'cache-control': H['cache-control'], location: thanksTo } });
  if (Array.isArray(obj.problems)) {
    const items = obj.problems.map((q) => `<li>${q.path ? `${escHtml(FIELD_WORDS[q.path] || q.path)}: ` : ''}${escHtml(q.msg)}</li>`).join('');
    return htmlPage(status, 'We could not send this', `<ul>${items}</ul>`, back);
  }
  return htmlPage(status, 'We could not send this', `<p>${escHtml(obj.msg === TRY_AGAIN ? FORM_TRY_AGAIN : obj.msg || obj.error || CALL_US)}</p>`, back);
}

// makeLeadHandler({ siteId, signingKey, platformBase }) -> async (request) => Response
// platformBase: "https://<project ref>.supabase.co/functions/v1" (staging or production). fetchImpl, now and holdCache (the hold's cache: the Cache API's caches.default, absent in Node) are for tests.
export function makeLeadHandler({ siteId, signingKey, platformBase, fetchImpl = globalThis.fetch, now = () => Math.floor(Date.now() / 1000), maxBytes = 16 * 1024, log = () => {}, thanksPath = '', holdCache = globalThis.caches && globalThis.caches.default }) {
  // thanksPath: the site's own thank-you page (a path on the site). A sent form post answers 303 there; without it, 303 to GET <this endpoint>?sent=1.
  const thanks = backPath(thanksPath) === thanksPath ? thanksPath : '';
  return async function handle(request) {
    if (request.method === 'GET' && new URL(request.url).searchParams.get('sent') === '1') return thankYouPage();
    if (request.method !== 'POST') return json(405, { sent: false, error: 'POST only' });
    const fromForm = isFormPost(request);
    let back = '/';
    const reply = (status, obj) => (fromForm ? formAnswer(status, obj, back, thanks || `${new URL(request.url).pathname}?sent=1`) : json(status, obj));
    const body = await request.text();
    if (body.length > maxBytes) return reply(413, { sent: false, problems: [{ code: 'SIZE', path: '', msg: 'Too large.' }] });
    let data, forward = body;
    if (fromForm) {
      data = leadFromForm(body); back = backPath(data.page);
      forward = JSON.stringify(data);
    } else {
      try { data = JSON.parse(body); } catch { return json(400, { sent: false, problems: [{ code: 'BODY', path: '', msg: 'Send the form as JSON.' }] }); }
    }
    if (data && typeof data.hp === 'string' && data.hp.trim() !== '') return reply(400, { sent: false, problems: [{ code: 'HP', path: '', msg: 'Something is missing.' }] });
    if (!siteId || !signingKey || !platformBase) { log('lead endpoint not configured'); return reply(503, { sent: false, msg: CALL_US }); }
    const visitor = await visitorHash(siteId, request.headers.get('cf-connecting-ip'));
    const held = visitor && holdCache ? `${new URL(request.url).origin}/api/lead-hold/${visitor}` : null;
    if (held && (await holdCache.match(held).catch(() => undefined))) return reply(429, { sent: false, retry: true, msg: SLOW_DOWN });
    const path = `/capture-lead?site=${siteId}${visitor ? `&visitor=${visitor}` : ''}`;
    const signature = await sign(signingKey, 'POST', path, forward, now());
    let res;
    try {
      res = await fetchImpl(platformBase.replace(/\/$/, '') + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-site-signature': signature }, body: forward });
    } catch (e) {
      log(`platform unreachable: ${String(e).slice(0, 120)}`);
      return reply(502, { sent: false, retry: true, msg: TRY_AGAIN });
    }
    if (res.status === 202) return reply(200, { sent: true });
    if (res.status === 400) {
      const j = await res.json().catch(() => ({}));
      return reply(400, { sent: false, problems: Array.isArray(j.problems) ? j.problems : [{ code: 'BODY', path: '', msg: 'Something is missing.' }] });
    }
    if (res.status === 429) {
      if (held) await holdCache.put(held, new Response('held', { headers: { 'cache-control': `max-age=${HOLD_SECONDS}` } })).catch(() => {});
      return reply(429, { sent: false, retry: true, msg: SLOW_DOWN });
    }
    if (res.status === 401) { log('platform refused the site signature (key or clock)'); return reply(502, { sent: false, retry: false, msg: CALL_US }); }
    if (res.status === 409) { log('platform refused: the site is paused or its workspace suspended'); return reply(409, { sent: false, retry: false, msg: CALL_US }); }   // step 3: S-SITE-PAUSED, S-WORKSPACE-SUSPENDED
    log(`platform answered ${res.status}`);
    return reply(502, { sent: false, retry: true, msg: TRY_AGAIN });
  };
}
