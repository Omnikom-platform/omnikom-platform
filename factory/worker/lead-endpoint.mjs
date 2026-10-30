// The site's /api/lead endpoint (docs/blueprint/14-LEAD-PATH.md section 2; sops/site-endpoints.md 2.3 and 2.4): one handler
// that runs unchanged as a Cloudflare Pages Function (pages-function-lead.js) or inside a Worker. It takes the browser's JSON,
// refuses the obvious (wrong method, too large, not JSON, honeypot filled), signs the exact body with the site's own key
// (t + METHOD + path?query + body, HMAC-SHA256: the same canonical form as supabase/functions/_shared/signature.ts) and forwards
// it to the platform's capture-lead. Whatever comes back is turned into the plain-words answer the form shows; only a 202 from
// the platform may become "sent". Web Crypto only; no dependencies. Tests: factory/worker/test/run.mjs and mutate.mjs.
const H = { 'content-type': 'application/json', 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' };
const CALL_US = 'We could not send this. Please call or email us.';
const TRY_AGAIN = 'We could not send this. Your answers are still here. Try again, or call us.';
const enc = new TextEncoder();

export async function sign(key, method, pathWithQuery, body, t = Math.floor(Date.now() / 1000)) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${t}\n${method.toUpperCase()}\n${pathWithQuery}\n${body}`)));
  return `t=${t},v1=${Array.from(mac, b => b.toString(16).padStart(2, '0')).join('')}`;
}

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: H });

// makeLeadHandler({ siteId, signingKey, platformBase }) -> async (request) => Response
// platformBase: "https://<project ref>.supabase.co/functions/v1" (staging or production). fetchImpl and now are for tests.
export function makeLeadHandler({ siteId, signingKey, platformBase, fetchImpl = globalThis.fetch, now = () => Math.floor(Date.now() / 1000), maxBytes = 16 * 1024, log = () => {} }) {
  return async function handle(request) {
    if (request.method !== 'POST') return json(405, { sent: false, error: 'POST only' });
    const body = await request.text();
    if (body.length > maxBytes) return json(413, { sent: false, problems: [{ code: 'SIZE', path: '', msg: 'Too large.' }] });
    let data;
    try { data = JSON.parse(body); } catch { return json(400, { sent: false, problems: [{ code: 'BODY', path: '', msg: 'Send the form as JSON.' }] }); }
    if (data && typeof data.hp === 'string' && data.hp.trim() !== '') return json(400, { sent: false, problems: [{ code: 'HP', path: '', msg: 'Something is missing.' }] });
    if (!siteId || !signingKey || !platformBase) { log('lead endpoint not configured'); return json(503, { sent: false, msg: CALL_US }); }
    const path = `/capture-lead?site=${siteId}`;
    const signature = await sign(signingKey, 'POST', path, body, now());
    let res;
    try {
      res = await fetchImpl(platformBase.replace(/\/$/, '') + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-site-signature': signature }, body });
    } catch (e) {
      log(`platform unreachable: ${String(e).slice(0, 120)}`);
      return json(502, { sent: false, retry: true, msg: TRY_AGAIN });
    }
    if (res.status === 202) return json(200, { sent: true });
    if (res.status === 400) {
      const j = await res.json().catch(() => ({}));
      return json(400, { sent: false, problems: Array.isArray(j.problems) ? j.problems : [{ code: 'BODY', path: '', msg: 'Something is missing.' }] });
    }
    if (res.status === 429) return json(429, { sent: false, retry: true, msg: 'Please try again in a minute.' });
    if (res.status === 401) { log('platform refused the site signature (key or clock)'); return json(502, { sent: false, retry: false, msg: CALL_US }); }
    if (res.status === 409) { log('platform refused: the site is paused or its workspace suspended'); return json(409, { sent: false, retry: false, msg: CALL_US }); }   // step 3: S-SITE-PAUSED, S-WORKSPACE-SUSPENDED
    log(`platform answered ${res.status}`);
    return json(502, { sent: false, retry: true, msg: TRY_AGAIN });
  };
}
