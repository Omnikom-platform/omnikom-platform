// The draft gate (book row B15 part b3): a preview build's deployment answers only its signed link. A first visit with ?k= whose sha256 is this build's, before its end time, gets the cookie
// and a 302 to the same address without k; the cookie then opens every page; anything else a plain 404, noindex. Only the sha256 and end time are deployed (draft-gate-key.mjs). Web Crypto only.
export const COOKIE = 'omk_draft';
const TOKEN = /^[0-9a-f]{64}$/;
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const notFound = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' } });

export function makeDraftGate({ sha256, until, now = () => Date.now() }) {
  return async (request, next) => {
    if (!(now() < until)) return notFound();
    const url = new URL(request.url), link = url.searchParams.get('k');
    const kept = (/(?:^|;\s*)omk_draft=([0-9a-f]{64})(?:;|$)/.exec(request.headers.get('cookie') || '') || [])[1];
    const token = link || kept;
    if (!token || !TOKEN.test(token) || hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))) !== sha256) return notFound();
    if (!link) return next();
    url.searchParams.delete('k');   // R1: the address the visitor lands on holds no token; the cookie carries it from here
    return new Response(null, { status: 302, headers: { location: url.pathname.replace(/^\/+/, '/') + url.search, 'set-cookie': `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.floor((until - now()) / 1000)}`, 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } });
  };
}
