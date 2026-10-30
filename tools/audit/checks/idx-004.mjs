// IDX-004 (P0): robots.txt is present at the folder root, references the sitemap file, and never disallows a sitemap URL or an indexable
// page of the folder. The HTTP parts (status 200, content type text/plain) are slice 2's and are not judged here.
import { mk } from "../lib/check.mjs";

export const id = "IDX-004";
export const severity = "P0";
export const source = "checklist/web-delivery.md IDX-004";
export const notCovered = ["HTTP status 200 and content type text/plain of the production robots.txt (needs a fetch)"];
const f = mk(id);

export const subjects = () => ["robots.txt"];

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
  if (!site.has("robots.txt")) return [f.fail("robots.txt", 1, "missing-element: no robots.txt at the folder root")];
  const out = [];
  const { groups, sitemaps } = parse(site.read("robots.txt"));
  const { files, root } = site.sitemaps();
  if (sitemaps.length === 0) out.push(f.fail("robots.txt", 1, "missing-element: no Sitemap line in robots.txt"));
  else {
    const rootPath = root ? "/" + root.rel : null;
    const paths = sitemaps.map((s) => { try { return new URL(s.url).pathname; } catch { return null; } });
    if (!paths.includes(rootPath)) out.push(f.fail("robots.txt", sitemaps[0].line, `value-mismatch: the Sitemap line ${sitemaps[0].url} is not the sitemap file of the folder (${rootPath || "none found"})`));
  }
  const targets = [...site.pageList.filter((p) => site.indexable(p)).map((p) => ({ path: p.path, what: `the page ${p.path}` })), ...files.map((s) => ({ path: "/" + s.rel, what: `the sitemap /${s.rel}` }))];
  for (const g of groups.filter((x) => x.agents.some((a) => AGENTS.has(a)))) {
    for (const t of targets) {
      const w = winner(g, t.path);
      if (w && !w.allow) out.push(f.fail("robots.txt", w.line, `forbidden-value: "Disallow: ${w.pattern}" disallows ${t.what}`));
    }
  }
  return out;
}
