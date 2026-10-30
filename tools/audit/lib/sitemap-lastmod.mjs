// Copied from skills/programmatic-enterprise-web-performance/checks-builtin/check-builtin-se004-idx003-sitemap-lastmod.mjs on 2026-10-30; the skill copy stays the source, changes go there first and are copied back.
// Changes in this copy: the script's logic is lifted into two functions (the script walked the folder and called process.exit; the audit
// engine has already read the sitemaps), the two thresholds and the problem() wording are unchanged.
// SE-004: every sitemap <lastmod> is a W3C datetime with seconds and a timezone (date-only fails) and is not in the future (> now + 1 day).
// IDX-003: the build-clock signature: >= 5 URLs of one sitemap all share one lastmod that lies within 10 minutes of the time the
// sitemap file was written (lastmod = the clock at build time, not each page's content date).

// Why a lastmod value fails SE-004, or null when it is fine.
export const lastmodProblem = (v, now = Date.now()) => {
  const s = String(v ?? "").trim();
  if (!s) return "empty";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "date-only";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) return "no timezone";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s)) return "not a W3C datetime with seconds";
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return "not a valid date";
  if (t > now + 86_400_000) return "in the future";
  return null;
};

// True when the url entries of one sitemap show the build-clock signature. `urls` are { lastmod } objects, `mtimeMs` the file's write time.
export function buildClockSignature(urls, mtimeMs) {
  if (urls.length < 5 || !urls.every((u) => u.lastmod)) return false;
  // "one lastmod": a clock read once, or once per URL (`new Date()` in the loop: milliseconds apart), so all within one minute
  const ts = urls.map((u) => Date.parse(u.lastmod));
  const lo = Math.min(...ts), hi = Math.max(...ts);
  const oneStamp = ts.every(Number.isFinite) && hi - lo <= 60_000;
  return oneStamp && Math.abs(hi - mtimeMs) <= 10 * 60_000;
}
