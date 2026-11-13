// The gone list (book row B12-E): the middleware of a deployment that answers a true 404 at the address of an item that left the site in the last 7 days. Cloudflare's edge goes on serving
// an old deployment's page at its address for up to a week ("Serving Pages": assets have a time-to-live of one week, per data center), so a build that no longer has the page is not enough.
// paths: the addresses, exactly as the build computes them (no query string, no other spelling); page: the site's own 404 page. Every other request goes on to the site. Web standards only.
export function makeGone({ paths, page }) {
  const gone = new Set(paths);
  return (request, next) => gone.has(new URL(request.url).pathname)
    ? new Response(page, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex', 'cache-control': 'no-store' } })
    : next();
}
