// IDX-004 (P0): robots.txt is present at the folder root, references the sitemap file, and never disallows a sitemap URL or an indexable
// page of the folder. The HTTP parts (status 200, content type text/plain) are judged in snapshot mode from site/robots.json (slice 2)
// and stay notCovered in folder mode.
import { mk } from "../lib/check.mjs";

export const id = "IDX-004";
export const severity = "P0";
export const source = "checklist/web-delivery.md IDX-004";
export const notCovered = ["folder mode only: HTTP status 200 and content type text/plain of the production robots.txt (needs a fetch; a snapshot carries them)"];
const f = mk(id);

export const subjects = (site) => [site.robots().rel];

const AGENTS = new Set(["*", "googlebot", "bingbot"]);

// robots.txt pattern to RegExp: * is any run, a trailing $ anchors the end, everything else is literal.
const toRegExp = (pat) => new RegExp("^" + pat.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\$$/, "$"));

function parse(text) {
  const groups = [], sitemaps = [];
  let cur = null, lastWasAgent = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) return;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === "sitemap") { sitemaps.push({ url: value, line: i + 1 }); return; }
    if (key === "user-agent") { if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(value.toLowerCase()); lastWasAgent = true; return; }
    lastWasAgent = false;
    if (cur && (key === "allow" || key === "disallow")) cur.rules.push({ allow: key === "allow", pattern: value, line: i + 1 });
  });
  return { groups, sitemaps };
}

// The winning rule for a path in one group: the longest matching pattern, Allow beating Disallow at equal length; null when none matches.
function winner(group, path) {
  let best = null;
  for (const r of group.rules) {
    if (!r.pattern || !toRegExp(r.pattern).test(path)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return best;
}

export function run(site) {
  const rb = site.robots();
  const out = [];
  if (rb.measured) {
    // the HTTP parts, judged from the snapshot: status 200 first (a non-200 saves no body, so nothing else can be judged), then the content type
    if (rb.status !== 200) return [f.fail(rb.rel, 1, `status-mismatch: robots.txt answered ${typeof rb.status === "number" ? rb.status : "no status (" + rb.status + ")"}, not 200`)];
    if (!/^text\/plain\b/i.test(rb.headers["content-type"] || "")) out.push(f.fail(rb.rel, 1, `value-mismatch: the robots.txt content type is "${rb.headers["content-type"] || "none"}", not text/plain`));
  }
  if (!rb.present) return [...out, f.fail(rb.rel, 1, site.mode === "snapshot" ? "missing-element: the snapshot saved no robots.txt" : "missing-element: no robots.txt at the folder root")];
  const { groups, sitemaps } = parse(rb.text);
  const { files, root } = site.sitemaps();
  if (sitemaps.length === 0) out.push(f.fail(rb.rel, 1, "missing-element: no Sitemap line in robots.txt"));
  else {
    const rootPath = root ? root.urlPath : null;
    const paths = sitemaps.map((s) => { try { return new URL(s.url).pathname; } catch { return null; } });
    if (!paths.includes(rootPath)) out.push(f.fail(rb.rel, sitemaps[0].line, `value-mismatch: the Sitemap line ${sitemaps[0].url} is not the sitemap file of the folder (${rootPath || "none found"})`));
  }
  const targets = [...site.pageList.filter((p) => site.indexable(p)).map((p) => ({ path: p.path, what: `the page ${p.path}` })), ...files.filter((s) => s.urlPath).map((s) => ({ path: s.urlPath, what: `the sitemap ${s.urlPath}` }))];
  for (const g of groups.filter((x) => x.agents.some((a) => AGENTS.has(a)))) {
    for (const t of targets) {
      const w = winner(g, t.path);
      if (w && !w.allow) out.push(f.fail(rb.rel, w.line, `forbidden-value: "Disallow: ${w.pattern}" disallows ${t.what}`));
    }
  }
  return out;
}
