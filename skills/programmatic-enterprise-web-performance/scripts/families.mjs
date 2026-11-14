// Template families: pages built from the same template have the same tag skeleton with different words in it.
// Checking each copy costs one worker per few pages and reports one template defect once per page, so the plan
// sends 2 representatives per family to the workers and lists the other members as covered by those two.
// A unit is one .html file in a codebase, or one pages/<slug>/ folder in a live-site snapshot.
import fs from "node:fs";
import path from "node:path";

const K = 4;           // shingle length (consecutive tags)
export const THRESHOLD = 0.8; // Jaccard similarity to join a family

// Tag skeleton: start tags with their sorted class names; text, scripts and styles ignored.
export function skeleton(html) {
  const h = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const toks = [];
  for (const m of h.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g)) {
    const cls = (m[2].match(/\bclass\s*=\s*["']([^"']*)["']/i) || [])[1];
    toks.push(m[1].toLowerCase() + (cls ? "." + cls.trim().split(/\s+/).map((c) => c.replace(/\d+/g, "#")).sort().join(".") : ""));
  }
  const set = new Set();
  for (let i = 0; i + K <= toks.length; i++) set.add(toks.slice(i, i + K).join(">"));
  if (!set.size && toks.length) set.add(toks.join(">"));
  return set;
}
export function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Path pattern shared by the members: differing segments become *.
function label(paths) {
  const split = paths.map((p) => p.split("/"));
  if (split.every((s) => s.length === split[0].length)) return split[0].map((seg, i) => (split.every((s) => s[i] === seg) ? seg : "*")).join("/");
  return `${paths[0]} (+${paths.length - 1} similar)`;
}

// units: [{ id, files: [rel paths], html: string, bytes }]. Returns { families, covered: Set of file paths left out }.
// Pages of one template also share a URL shape (first path segment + depth): blog/x/index.html and blog/y/index.html
// do, /blog and /neighborhoods don't. A platform that wraps every page in the same layout (one header, nav and footer)
// makes different page types look alike by markup alone, so the shape is required too.
export function pathShape(id) {
  const segs = id.startsWith("pages/") ? id.slice(6).split("__") : id.replace(/\/?index\.html?$/i, "").split("/").filter(Boolean);
  return `${segs[0] || "/"}#${segs.length}`;
}
export function groupFamilies(units, { threshold = THRESHOLD } = {}) {
  const fams = [];
  for (const u of units) {
    const sk = skeleton(u.html);
    const shape = pathShape(u.id);
    let best = null, bestJ = 0;
    for (const f of fams.filter((x) => x.shape === shape)) { const j = jaccard(sk, f.sk); if (j > bestJ) { bestJ = j; best = f; } }
    if (best && bestJ >= threshold) best.members.push(u);
    else fams.push({ sk, shape, members: [u] });
  }
  const families = [];
  const covered = new Set();
  let n = 0;
  for (const f of fams.filter((x) => x.members.length >= 3)) {
    const byPath = [...f.members].sort((a, b) => a.id.localeCompare(b.id));
    const largest = [...f.members].sort((a, b) => b.bytes - a.bytes)[0];
    const reps = [byPath[0], largest !== byPath[0] ? largest : byPath[1]];
    const id = `F${String(++n).padStart(2, "0")}`;
    for (const m of f.members) if (!reps.includes(m)) for (const file of m.files) covered.add(file);
    families.push({ id, label: label(byPath.map((m) => m.id)), size: f.members.length, reps: reps.map((r) => r.id), members: byPath.map((m) => m.id) });
  }
  return { families, covered };
}

// One page is one unit. In a live-site snapshot a page is the folder pages/<slug>/ (head.html, body.html ...), so its files count once.
// In a codebase every file is its own page, whatever its folder is called (a framework's pages/ folder is not a snapshot).
export function pageOf(file, snapshot) {
  const m = snapshot ? file.match(/^pages\/([^/]+)\//) : null;
  return m ? `pages/${m[1]}` : file;
}
// How many distinct pages a cause touches: a family stands for all its members, a snapshot page for itself, any other file for itself.
export function countPages(pageFiles, famOfFile, snapshot) {
  return new Set(pageFiles.flatMap((p) => famOfFile(p)?.members || [pageOf(p, snapshot)])).size;
}

// Builds the units for a repo root from the kept file list (codebase or snapshot).
export function unitsFor(root, files) {
  const snapshot = fs.existsSync(path.join(root, "_site.json"));
  const read = (f) => { try { return fs.readFileSync(path.join(root, f), "utf8"); } catch { return ""; } };
  if (snapshot) {
    const byPage = new Map();
    for (const f of files) {
      const m = f.match(/^pages\/([^/]+)\//);
      if (!m) continue;
      if (!byPage.has(m[1])) byPage.set(m[1], []);
      byPage.get(m[1]).push(f);
    }
    return [...byPage.entries()].map(([slug, fs_]) => {
      const html = fs_.filter((f) => /\/(head|body)(-\d+)?\.html$/.test(f)).sort().map(read).join("\n");
      return { id: `pages/${slug}`, files: fs_, html, bytes: html.length };
    }).filter((u) => u.html);
  }
  return files.filter((f) => /\.html?$/i.test(f)).map((f) => { const html = read(f); return { id: f, files: [f], html, bytes: html.length }; });
}
