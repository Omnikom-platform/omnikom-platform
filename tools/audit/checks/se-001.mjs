// SE-001 (P0): robots.txt health. Snapshot mode judges it from site/robots.json and the saved body: status 200 (404 is the part "missing",
// a WARN; 5xx and 429 are FAIL, any other status is a FAIL), content type text/plain, at most 512,000 bytes (the size the server sent, not
// the size of the saved file, which snapshot-site.mjs cuts at 190 KB), valid UTF-8.
// Folder mode has no HTTP facts: it judges the size and the encoding of robots.txt as a file, and says SKIP when the folder has none.
import { mk } from "../lib/check.mjs";

export const id = "SE-001";
export const severity = "P0";
export const source = "checklist/search-engines.md SE-001";
export const notCovered = ["folder mode: status 200 and content type text/plain of the production robots.txt (needs a fetch; a snapshot carries them)"];
const f = mk(id);

export const MAX_BYTES = 512000;
export const subjects = (site) => [site.robots().rel];

// 1-based line of the first byte that is not valid UTF-8 (or the first U+FFFD, which is what snapshot-site.mjs saves in place of a bad byte); 0 when valid.
function badUtf8Line(buf) {
  const dec = new TextDecoder("utf-8", { fatal: true });
  let n = 0, start = 0;
  for (let i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === 0x0a) {
      n++;
      const chunk = buf.subarray(start, i);
      try { if (dec.decode(chunk).includes("\uFFFD")) return n; } catch { return n; }
      start = i + 1;
    }
  }
  return 0;
}

export function run(site) {
  const rb = site.robots();
  if (!rb.measured && !rb.present) return [f.skip(rb.rel, "no robots.txt in the folder (IDX-004 reports that); its size and encoding cannot be judged")];
  if (rb.measured) {
    const s = rb.status;
    if (s === 404) return [f.warn(rb.rel, 1, "missing-element: robots.txt answered 404, so crawlers read it as no restrictions (part missing); publish one that names the sitemap")];
    if (typeof s !== "number") return [f.fail(rb.rel, 1, `status-mismatch: robots.txt could not be fetched (${s})`)];
    if (s >= 500 || s === 429) return [f.fail(rb.rel, 1, `status-mismatch: robots.txt answered ${s}; Google and Naver treat a 5xx or 429 on robots.txt as disallow everything`)];
    if (s !== 200) return [f.fail(rb.rel, 1, `status-mismatch: robots.txt answered ${s}, not 200`)];
  }
  const out = [];
  if (rb.measured && !/^text\/plain\b/i.test(rb.headers["content-type"] || "")) out.push(f.fail(rb.rel, 1, `value-mismatch: the robots.txt content type is "${rb.headers["content-type"] || "none"}", not text/plain`));
  if (rb.bytes !== null && rb.bytes > MAX_BYTES) out.push(f.fail(rb.rel, 1, `value-mismatch: robots.txt is ${rb.bytes} bytes, the limit is ${MAX_BYTES}`));
  if (rb.buf) {
    const line = badUtf8Line(rb.buf);
    if (line) out.push(f.fail(rb.rel, line, "value-mismatch: robots.txt is not valid UTF-8"));
  }
  return out;
}
