// ICM index and code map: walks the repo and writes icm/index.json + icm/INDEX.md (every doc) and icm/code-map.json +
// icm/CODE-MAP.md (every source file). Node 20, no dependencies. Deterministic: sorted, no timestamps, so a re-run on an
// unchanged tree changes nothing (and writes nothing).
//   node tools/icm/index.mjs                 write the four files (prints one counts line; --quiet prints nothing)
//   node tools/icm/index.mjs --check         exit 1, one line per difference, when the written files are stale versus the tree,
//                                            a doc in docs/product/ is over 300 lines, a source file has no owner, or the
//                                            product book disagrees with itself (book-check.mjs: counts, WORKS paths, steps)
//   node tools/icm/index.mjs --root <dir>    index another tree (the tests use a fixture)
// Owner = longest matching prefix in the "Owns" lists of docs/departments/*.md (an "except `x`" on a line removes x from that entry).
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBook } from './book-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKIP_DIRS = new Set(['node_modules', '.git', 'film', 'creds and accounts login', '.secrets', 'archive']);
const SRC_EXT = /\.(mjs|js|ts|tsx|sql)$/i;
const GENERATED = new Set(['icm/INDEX.md', 'icm/CODE-MAP.md']);
const GENERIC_BASE = /^(index|run|main|mod)\.[a-z]+$/i;
const SUMMARY_MAX = 160;
const PRODUCT_DOC_MAX = 300;

// ---- .gitignore (the subset this repo uses: comments, !negation, trailing /, leading / or inner / anchors, * ? **) ----
function globToRe(g) {
  let s = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      if (g[i + 2] === '/') { s += '(?:.*/)?'; i += 2; } else { s += '.*'; i += 1; }
    } else if (c === '*') s += '[^/]*';
    else if (c === '?') s += '[^/]';
    else s += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + s + '$');
}
function parseIgnore(text) {
  const rules = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    let neg = false;
    if (line.startsWith('!')) { neg = true; line = line.slice(1); }
    let dirOnly = false;
    if (line.endsWith('/')) { dirOnly = true; line = line.slice(0, -1); }
    let anchored = false;
    if (line.startsWith('/')) { anchored = true; line = line.slice(1); } else if (line.includes('/')) anchored = true;
    if (!line) continue;
    rules.push({ neg, dirOnly, anchored, re: globToRe(line) });
  }
  return rules;
}
function isIgnored(stack, rel, isDir) {
  let state = false;
  for (const f of stack) {
    const sub = f.base ? rel.slice(f.base.length + 1) : rel;
    for (const r of f.rules) {
      if (r.dirOnly && !isDir) continue;
      if (r.re.test(r.anchored ? sub : basename(rel))) state = !r.neg;
    }
  }
  return state;
}

// ---- the walk ----
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
function walk(root) {
  const docs = [], srcs = [];
  const rec = (rel, stack) => {
    const abs = rel ? join(root, rel) : root;
    const entries = readdirSync(abs, { withFileTypes: true }).sort(byName);
    const gi = entries.find(e => e.isFile() && e.name === '.gitignore');
    if (gi) stack = [...stack, { base: rel, rules: parseIgnore(readFileSync(join(abs, '.gitignore'), 'utf8')) }];
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || isIgnored(stack, r, true)) continue;
        rec(r, stack);
      } else if (e.isFile()) {
        if (isIgnored(stack, r, false)) continue;
        if (/\.md$/i.test(e.name) && !GENERATED.has(r)) docs.push(r);
        else if (SRC_EXT.test(e.name) && !/\.min\.js$/i.test(e.name)) srcs.push(r);
      }
    }
  };
  rec('', []);
  return { docs, srcs };
}

// ---- owners, from the charters ----
function sectionOf(text, title) {
  const m = new RegExp('(?:^|\\n)## ' + title + '[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)').exec(text);
  return m ? m[1] : null;
}
const trimSlash = p => p.replace(/\\/g, '/').replace(/\/+$/, '');
function loadOwners(root) {
  const dir = join(root, 'docs', 'departments');
  const entries = [];
  if (!existsSync(dir)) return entries;
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.md') || f === 'README.md' || f === 'TEMPLATE.md') continue;
    const owns = sectionOf(readFileSync(join(dir, f), 'utf8').replace(/\r\n/g, '\n'), 'Owns');
    if (owns === null) continue;
    for (const line of owns.split('\n')) {
      const m = /^- `([^`]+)`(.*)$/.exec(line);
      if (!m) continue;
      const except = [];
      const parts = m[2].split(/\bexcept\b/).slice(1);
      for (const part of parts) {
        const t = /`([^`]+)`/.exec(part) || /^\s*([^\s`,);]+)/.exec(part);
        if (t) except.push(trimSlash(t[1]));
      }
      entries.push({ slug: f.replace(/\.md$/, ''), path: trimSlash(m[1]), except });
    }
  }
  return entries;
}
const under = (p, prefix) => p === prefix || p.startsWith(prefix + '/');
function ownerOf(path, owners) {
  let best = null;
  for (const o of owners) {
    if (!under(path, o.path) || o.except.some(x => under(path, x))) continue;
    if (!best || o.path.length > best.path.length) best = o;
  }
  return best ? best.slug : null;
}

// ---- docs ----
function layerOf(p) {
  if (p === 'work/STATE.md' || p === '.claude/POSITION.md' || p === 'docs/blueprint/PROGRESS.md') return 4;
  if (p === 'CLAUDE.md') return 0;
  if (p.startsWith('icm/')) return 1;
  if (p.startsWith('work/')) return 2;
  if (p.startsWith('docs/product/') || p.startsWith('skills/')) return 3;
  return 'unplaced';
}
const LOAD_FOR = /^\s*(?:<!--|>|\/\/|#|--)?\s*load-for:\s*(.*?)\s*(?:-->)?\s*$/i;
const FEATURE = /^\s*(?:\/\/|--|\/\*+|\*|#|<!--)\s*feature:\s*(.*?)\s*(?:\*+\/|-->)?\s*$/i;
function firstLines(lines, re) {
  for (const l of lines.slice(0, 10)) { const m = re.exec(l); if (m) return m[1]; }
  return null;
}
function describeDoc(text, path) {
  const lines = text.split('\n');
  let i = 0;
  let fmName = '';
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) { for (const l of lines.slice(1, end)) { const m = /^name:\s*(.+)$/.exec(l); if (m) fmName = m[1].trim(); } i = end + 1; }
  }
  let title = '', fence = false;
  const para = [];
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; if (para.length) break; continue; }
    if (fence) continue;
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(l);
    if (h) { if (!title) title = h[1]; if (para.length) break; continue; }
    if (!l.trim() || /^\s*<!--.*-->\s*$/.test(l) || /^\s*-{3,}\s*$/.test(l) || LOAD_FOR.test(l)) { if (para.length) break; continue; }
    para.push(l.trim());
  }
  let summary = para.join(' ').replace(/\s+/g, ' ');
  if (summary.length > SUMMARY_MAX) summary = summary.slice(0, SUMMARY_MAX - 3) + '...';
  const lf = firstLines(lines, LOAD_FOR);
  const lineCount = text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
  return {
    path,
    title: title || fmName || basename(path, '.md'),
    summary,
    layer: layerOf(path),
    lines: lineCount,
    loadFor: lf ? lf.split(',').map(s => s.trim()).filter(Boolean) : [],
  };
}

// ---- source files ----
const EXPORT_DECL = /^[ \t]*export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_DEFAULT = /^[ \t]*export\s+default\b/m;
const EXPORT_LIST = /^[ \t]*export\s*\{([^}]*)\}/gm;
function exportsOf(text, path) {
  const out = new Set();
  if (/\.sql$/i.test(path)) {
    const t = text.replace(/--[^\n]*/g, '');
    for (const m of t.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w."]+)/gi)) out.add('fn:' + m[1].replace(/"/g, ''));
    for (const m of t.matchAll(/create\s+(?:(?:unlogged|temporary|temp)\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi)) out.add('table:' + m[1].replace(/"/g, ''));
  } else {
    for (const m of text.matchAll(EXPORT_DECL)) out.add(m[1]);
    if (EXPORT_DEFAULT.test(text)) out.add('default');
    for (const m of text.matchAll(EXPORT_LIST)) {
      for (const part of m[1].split(',')) {
        const n = part.trim().split(/\s+as\s+/).pop().trim();
        if (n) out.add(n);
      }
    }
  }
  return [...out].sort();
}
const isTestPath = p => /(^|\/)(test|tests|__tests__)\//.test(p) || /\.(test|spec)\.[a-z]+$/i.test(p);
const TOKEN = /[\w@$./-]+\.(?:mjs|js|ts|tsx|sql)(?![\w])/g;

// ---- build ----
export function build(root) {
  root = resolve(root);
  const { docs: docPaths, srcs: srcPaths } = walk(root);
  const owners = loadOwners(root);
  const norm = t => t.replace(/\r\n/g, '\n');

  const docs = docPaths.map(p => {
    const d = describeDoc(norm(readFileSync(join(root, p), 'utf8')), p);
    return { path: d.path, title: d.title, summary: d.summary, owner: ownerOf(p, owners), layer: d.layer, lines: d.lines, loadFor: d.loadFor };
  }).sort((a, b) => (a.path < b.path ? -1 : 1));

  // test files: which source-looking tokens they name (basename, and parent/basename for generic names)
  const texts = new Map();
  const byBase = new Map(), byPair = new Map();
  const add = (m, k, t) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(t); };
  for (const p of srcPaths) {
    const text = norm(readFileSync(join(root, p), 'utf8'));
    texts.set(p, text);
    if (!isTestPath(p)) continue;
    for (const tok of new Set(text.match(TOKEN) || [])) {
      const parts = tok.split('/');
      add(byBase, parts[parts.length - 1], p);
      if (parts.length > 1) add(byPair, parts.slice(-2).join('/'), p);
    }
  }
  const files = srcPaths.map(p => {
    const text = texts.get(p);
    const base = basename(p);
    const dir = dirname(p);
    const hits = new Set();
    if (!isTestPath(p)) {
      if (GENERIC_BASE.test(base)) {
        for (const t of byPair.get(basename(dir) + '/' + base) || []) hits.add(t);
        // a generic name is also taken when the test sits inside the source's own folder tree
        for (const t of byBase.get(base) || []) if (dir !== '.' && t.startsWith(dir + '/')) hits.add(t);
      } else {
        for (const t of byBase.get(base) || []) hits.add(t);
      }
    }
    hits.delete(p);
    const feat = firstLines(text.split('\n'), FEATURE);
    return { path: p, owner: ownerOf(p, owners), exports: exportsOf(text, p), tests: [...hits].sort(), feature: feat || '' };
  }).sort((a, b) => (a.path < b.path ? -1 : 1));

  const over300 = docs.filter(d => d.lines > PRODUCT_DOC_MAX);
  const counts = {
    docs: docs.length,
    unownedDocs: docs.filter(d => !d.owner).length,
    unplaced: docs.filter(d => d.layer === 'unplaced').length,
    over300All: over300.length,
    over300Product: over300.filter(d => d.path.startsWith('docs/product/')).length,
    sources: files.length,
    unownedSources: files.filter(f => !f.owner).length,
  };
  const problems = [];
  for (const d of over300) if (d.path.startsWith('docs/product/')) problems.push(`OVER ${PRODUCT_DOC_MAX} LINES: ${d.path} has ${d.lines} lines`);
  for (const f of files) if (!f.owner) problems.push(`UNOWNED: source file ${f.path} is in no charter's Owns list`);

  const outputs = {
    'icm/index.json': jsonFile({ version: 1, counts: { docs: counts.docs, unownedDocs: counts.unownedDocs, unplaced: counts.unplaced, over300: counts.over300All } }, 'docs', docs),
    'icm/code-map.json': jsonFile({ version: 1, counts: { sources: counts.sources, unowned: counts.unownedSources } }, 'files', files),
    'icm/INDEX.md': indexMd(docs, counts),
    'icm/CODE-MAP.md': codeMapMd(files, counts),
  };
  return { docs, files, counts, problems, outputs };
}

// one entry per line so a grep returns a whole record
function jsonFile(head, key, entries) {
  const h = JSON.stringify(head, null, 2);
  const body = entries.map(e => '    ' + JSON.stringify(e)).join(',\n');
  return h.slice(0, -2) + ',\n  "' + key + '": [' + (entries.length ? '\n' + body + '\n  ' : '') + ']\n}\n';
}
const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
function indexMd(docs, c) {
  const L = ['# ICM index', '', 'Generated by `node tools/icm/index.mjs`; do not edit. Layers: 0 CLAUDE.md, 1 icm/, 2 work/, 3 docs/product/ and skills/, 4 running record (work/STATE.md, .claude/POSITION.md, docs/blueprint/PROGRESS.md).', '',
    `${c.docs} docs; ${c.unownedDocs} with no owner; ${c.unplaced} unplaced; ${c.over300All} over ${PRODUCT_DOC_MAX} lines.`, ''];
  for (const layer of [0, 1, 2, 3, 4, 'unplaced']) {
    const rows = docs.filter(d => d.layer === layer);
    L.push(`## Layer ${layer} (${rows.length})`, '');
    if (!rows.length) { L.push('none', ''); continue; }
    L.push('| Path | Owner | Lines | Title | Summary | Load for |', '|---|---|---|---|---|---|');
    for (const d of rows) L.push(`| ${cell(d.path)} | ${cell(d.owner || '(none)')} | ${d.lines} | ${cell(d.title)} | ${cell(d.summary)} | ${cell(d.loadFor.join(', '))} |`);
    L.push('');
  }
  return L.join('\n');
}
function codeMapMd(files, c) {
  const L = ['# Code map', '', 'Generated by `node tools/icm/index.mjs`; do not edit. Full export lists are in `icm/code-map.json`.', '',
    `${c.sources} source files; ${c.unownedSources} with no owner.`, ''];
  const owners = [...new Set(files.map(f => f.owner || '(none)'))].sort();
  for (const o of owners) {
    const rows = files.filter(f => (f.owner || '(none)') === o);
    L.push(`## ${o} (${rows.length})`, '', '| Path | Exports | Tests | Feature |', '|---|---|---|---|');
    for (const f of rows) {
      const ex = f.exports.length > 10 ? f.exports.slice(0, 10).join(', ') + ` (+${f.exports.length - 10})` : f.exports.join(', ');
      L.push(`| ${cell(f.path)} | ${cell(ex)} | ${cell(f.tests.join(', '))} | ${cell(f.feature)} |`);
    }
    L.push('');
  }
  return L.join('\n');
}

// ---- write and check ----
function writeOutputs(root, outputs) {
  let wrote = 0;
  mkdirSync(join(root, 'icm'), { recursive: true });
  for (const [rel, text] of Object.entries(outputs)) {
    const abs = join(root, rel);
    if (existsSync(abs) && readFileSync(abs, 'utf8') === text) continue;
    writeFileSync(abs, text, 'utf8');
    wrote++;
  }
  return wrote;
}
function entryDiff(rel, key, oldText, fresh) {
  const out = [];
  let old;
  try { old = JSON.parse(oldText)[key]; } catch { return [`STALE ${rel}: cannot be parsed, rewrite it with: node tools/icm/index.mjs`]; }
  const was = new Map(old.map(e => [e.path, JSON.stringify(e)]));
  const now = new Map(fresh.map(e => [e.path, e]));
  for (const [p, e] of now) {
    if (!was.has(p)) out.push(`STALE ${rel}: not indexed yet: ${p}`);
    else if (was.get(p) !== JSON.stringify(e)) {
      const o = JSON.parse(was.get(p));
      const fields = Object.keys(e).filter(k => JSON.stringify(o[k]) !== JSON.stringify(e[k]));
      out.push(`STALE ${rel}: changed: ${p} (${fields.join(', ')})`);
    }
  }
  for (const p of was.keys()) if (!now.has(p)) out.push(`STALE ${rel}: indexed but gone from the tree: ${p}`);
  return out;
}
export function check(root) {
  root = resolve(root);
  const b = build(root);
  const lines = [...b.problems, ...checkBook(root)];
  const keys = { 'icm/index.json': ['docs', b.docs], 'icm/code-map.json': ['files', b.files] };
  for (const [rel, text] of Object.entries(b.outputs)) {
    const abs = join(root, rel);
    if (!existsSync(abs)) { lines.push(`MISSING ${rel}: run node tools/icm/index.mjs`); continue; }
    const disk = readFileSync(abs, 'utf8');
    if (disk === text) continue;
    const found = keys[rel] ? entryDiff(rel, keys[rel][0], disk, keys[rel][1]) : [];
    if (found.length) lines.push(...found);
    else lines.push(`STALE ${rel}: differs from what the tree generates`);
  }
  return { lines, counts: b.counts };
}

function main() {
  const argv = process.argv.slice(2);
  const flag = n => argv.includes(n);
  const ri = argv.indexOf('--root');
  const root = ri >= 0 ? resolve(argv[ri + 1]) : resolve(HERE, '..', '..');
  if (flag('--check')) {
    const r = check(root);
    if (r.lines.length) { for (const l of r.lines) console.log(l); process.exit(1); }
    if (!flag('--quiet')) console.log(`OK: icm index is fresh (${r.counts.docs} docs, ${r.counts.sources} source files)`);
    return;
  }
  const b = build(root);
  const wrote = writeOutputs(root, b.outputs);
  if (!flag('--quiet')) {
    const c = b.counts;
    console.log(`icm: ${c.docs} docs, ${c.sources} source files, ${c.unownedSources} unowned source, ${c.unplaced} unplaced docs, ${c.over300All} docs over ${PRODUCT_DOC_MAX} lines; wrote ${wrote} file(s)`);
  }
}
const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) main();
