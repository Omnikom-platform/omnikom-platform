// PRF-016 (P2, printed as a WARN): server response time per page from response.json ttfbMs against speed.ttfbMs. The spec's number is the
// median of 5 warm requests; a snapshot holds one cold request per page, so an exceeded budget is a WARN, never a FAIL, and says so.
// Folder mode has no response time: no lines at all (listed as not covered).
import { mk } from "../lib/check.mjs";

export const id = "PRF-016";
export const severity = "P2";
export const source = "checklist/performance.md PRF-016";
export const notCovered = ["the median of 5 warm requests (a snapshot has one cold request per page)", "route groups (the check judges each snapshot page)", "folder mode: every part (a built folder has no server)"];
const f = mk(id);

export const subjects = (site) => (site.mode === "snapshot" ? site.pageList.map((p) => p.path) : []);

export function run(site) {
  if (site.mode !== "snapshot") return [];
  const out = [];
  const limit = site.config.speed.ttfbMs;
  for (const p of site.pageList) {
    if (p.ttfbMs === null) { out.push(f.skip(p.path, "not measured: response.json has no ttfbMs")); continue; }
    if (p.ttfbMs > limit) out.push(f.warn(p.path, 1, `budget-exceeded: TTFB ${p.ttfbMs} ms > ${limit} ms (single cold request; the spec number is the median of 5 warm requests)`));
  }
  return out;
}
