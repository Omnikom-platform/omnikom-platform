// The file graph behind `omnikom impact` (DECISIONS 43): which tracked file imports, reads or copies which other file, and which CI job or
// gate reaches it. Built from `git ls-files` (or the files of one commit), by a small tokenizer for JavaScript and TypeScript (strings,
// templates, comments and regex literals are told apart, so a path inside a comment is not an edge) and a path-token scan for the data
// and script files. Only these kinds of file are read; every other file is a leaf: it can be depended on, it depends on nothing.
//
//   import edge  a static `import ... from '<p>'`, `export ... from '<p>'`, `import('<p>')`, `require('<p>')`, relative specifiers only
//   read edge    a path built from string literals in ONE call: join / resolve / path.join / new URL('<p>', import.meta.url) / repoPath /
//                importRepo, or a bare string literal with at least one "/". A first argument that is a root variable (REPO, REPO_ROOT,
//                ROOT, root, repoRoot) counts from the repository root; any other first argument counts from the file's folder or one of
//                its parent folders (the nearest where the path exists). A name that is a FOLDER reads every file under it only when it was
//                built from the root or written as a bare literal AND has at least two path segments ('supabase' alone reads nothing).
//
// KNOWN GAPS (the graph cannot see them): a path assembled at run time from a variable (join(dir, name)), an import map or alias, a
// path read out of a data file and used later, a command run through a shell string, a glob built in code.
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

export const SCAN_EXT = new Set(['.mjs', '.js', '.cjs', '.ts', '.sql', '.yml', '.yaml', '.json', '.sh', '.ps1', '.toml']);
const JS_EXT = new Set(['.mjs', '.js', '.cjs', '.ts']);
const MAX_SCAN = 3_000_000;
const IMPORT_EXT = ['.mjs', '.js', '.cjs', '.ts', '.tsx', '.json'];
const ROOT_VARS = new Set(['REPO', 'REPO_ROOT', 'ROOT', 'root', 'repoRoot']);
const INTERP = '\u0001';

// ------------------------------------------------------------------------------------------------ sources
// A source says which files exist and gives their text: the working tree (git ls-files + disk) or one commit (git ls-tree + cat-file).
export function workingTreeSource(git, root) {
  const files = git.out(['ls-files', '-z']).split('\0').filter(Boolean);
  const read = p => { try { if (statSync(join(root, p)).size > MAX_SCAN) return ''; return readFileSync(join(root, p), 'utf8'); } catch { return null; } };
  return { files, label: 'working tree', read, readMany: ps => new Map(ps.map(p => [p, read(p)])) };
}

export function treeSource(git, treeish) {
  const files = git.out(['ls-tree', '-r', '--name-only', '-z', treeish]).split('\0').filter(Boolean);
  const readMany = paths => {
    const map = new Map();
    if (paths.length === 0) return map;
    const r = git.run(['cat-file', '--batch'], { input: paths.map(p => `${treeish}:${p}\n`).join(''), buffer: true });
    if (!r.ok) throw new Error(`git cat-file --batch: ${r.err || `exit ${r.status}`}`.slice(0, 200));
    const b = r.out;
    let at = 0;
    for (const p of paths) {
      const nl = b.indexOf(0x0a, at);
      if (nl < 0) break;
      const header = b.toString('utf8', at, nl);
      at = nl + 1;
      const m = /^[0-9a-f]+ \w+ (\d+)$/.exec(header);
      if (!m) { map.set(p, null); continue; }
      const size = Number(m[1]);
      map.set(p, size > MAX_SCAN ? '' : b.toString('utf8', at, at + size));
      at += size + 1;
    }
    return map;
  };
  return { files, label: `tree ${treeish}`, read: p => readMany([p]).get(p) ?? null, readMany };
}

// ------------------------------------------------------------------------------------------------ the tokenizer
const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await']);
const isIdStart = c => /[A-Za-z_$]/.test(c);
const isIdChar = c => /[\w$]/.test(c);

function unescape1(c) { return c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c; }

// the end index (exclusive) of a template literal that starts at src[i] === '`'
function scanTemplate(src, i) {
  let j = i + 1, v = '', interp = false;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { v += unescape1(src[j + 1] || ''); j += 2; continue; }
    if (c === '`') return { end: j + 1, v, interp };
    if (c === '$' && src[j + 1] === '{') {
      interp = true; v += INTERP;
      let depth = 1; j += 2;
      while (j < src.length && depth > 0) {
        const d = src[j];
        if (d === '"' || d === "'") { j++; while (j < src.length && src[j] !== d && src[j] !== '\n') { if (src[j] === '\\') j++; j++; } j++; continue; }
        if (d === '`') { j = scanTemplate(src, j).end; continue; }
        if (d === '{') depth++;
        else if (d === '}') depth--;
        j++;
      }
      continue;
    }
    v += c; j++;
  }
  return { end: src.length, v, interp };
}

export function tokenize(src) {
  const toks = [];
  const n = src.length;
  let i = 0;
  const last = () => toks[toks.length - 1];
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, v = '';
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') { v += unescape1(src[j + 1] || ''); j += 2; continue; } v += src[j]; j++; }
      toks.push({ t: 'str', v });
      i = j + 1;
      continue;
    }
    if (c === '`') { const s = scanTemplate(src, i); toks.push({ t: 'tpl', v: s.v, interp: s.interp }); i = s.end; continue; }
    if (c === '/') {
      const p = last();
      const regexOk = !p || (p.t === 'p' && !')]}'.includes(p.v)) || (p.t === 'id' && KEYWORDS_BEFORE_REGEX.has(p.v));
      if (regexOk) {
        let j = i + 1, cls = false;
        while (j < n && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false;
          else if (src[j] === '/' && !cls) break;
          j++;
        }
        if (j < n && src[j] === '/') { j++; while (j < n && isIdChar(src[j])) j++; toks.push({ t: 're' }); i = j; continue; }
      }
      toks.push({ t: 'p', v: '/' }); i++; continue;
    }
    if (isIdStart(c)) { let j = i + 1; while (j < n && isIdChar(src[j])) j++; toks.push({ t: 'id', v: src.slice(i, j) }); i = j; continue; }
    if (c >= '0' && c <= '9') { let j = i + 1; while (j < n && /[\w.]/.test(src[j])) j++; toks.push({ t: 'num' }); i = j; continue; }
    toks.push({ t: 'p', v: c }); i++;
  }
  return toks;
}

// ------------------------------------------------------------------------------------------------ path helpers
// "a/./b/../c" -> "a/c"; null when it climbs out of the repository
export function normalizeRel(p) {
  const out = [];
  for (const s of String(p).split(/[\\/]+/)) {
    if (s === '' || s === '.') continue;
    if (s === '..') { if (out.length === 0) return null; out.pop(); continue; }
    out.push(s);
  }
  return out.join('/');
}
const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const extOf = p => extname(p).toLowerCase();
const segCount = p => (p === '' ? 0 : p.split('/').length);
// a literal that can be a repository path: no spaces, no scheme, no interpolation
const PATHISH = /^\.{0,2}\/?[\w@.+-]+(?:\/[\w@.+-]+)*\/?$/;
const lit = v => typeof v === 'string' && v.includes('/') && !v.includes('://') && !v.startsWith('/') && PATHISH.test(v);

// ------------------------------------------------------------------------------------------------ what one file refers to
function splitArgs(toks, open) {
  const args = [[]];
  let depth = 0, k = open;
  for (; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'p' && '([{'.includes(t.v)) { depth++; if (depth === 1) continue; }
    if (t.t === 'p' && ')]}'.includes(t.v)) { depth--; if (depth === 0) break; }
    if (depth === 1 && t.t === 'p' && t.v === ',') { args.push([]); continue; }
    args[args.length - 1].push(t);
  }
  return args.filter((a, i) => a.length || i < args.length - 1);
}

const isRootVar = arg => {
  if (arg.length === 1 && arg[0].t === 'id') return ROOT_VARS.has(arg[0].v);
  if (arg.length === 3 && arg[0].t === 'id' && arg[1].t === 'p' && arg[1].v === '.' && arg[2].t === 'id') return ROOT_VARS.has(arg[2].v);
  return false;
};

// a literal argument -> { segs, partial } ; a template with an interpolation keeps its folder part and stops the path
function pieceOf(arg) {
  if (arg.length !== 1) return null;
  const a = arg[0];
  if (a.t === 'str' || (a.t === 'tpl' && !a.interp)) return { text: a.v, partial: false };
  if (a.t === 'tpl') { const pre = a.v.split(INTERP)[0]; return { text: pre.includes('/') ? pre.slice(0, pre.lastIndexOf('/') + 1) : '', partial: true }; }
  return null;
}

// -> { imports: [spec], paths: [{ base: 'root'|'file'|'anc', rel, folder }], lits: [value] }
export function scanJs(src) {
  const toks = tokenize(src);
  const imports = [], paths = [], lits = [];
  const used = new Set();
  const isP = (t, v) => t && t.t === 'p' && t.v === v;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'id') continue;
    const nx = toks[k + 1], pv = toks[k - 1], pv2 = toks[k - 2];
    if (t.v === 'import' && nx && nx.t === 'str') { imports.push(nx.v); used.add(k + 1); continue; }
    if (t.v === 'from' && nx && nx.t === 'str') { imports.push(nx.v); used.add(k + 1); continue; }
    if ((t.v === 'import' || t.v === 'require') && isP(nx, '(') && toks[k + 2] && toks[k + 2].t === 'str' && isP(toks[k + 3], ')')) { imports.push(toks[k + 2].v); used.add(k + 2); continue; }
    if (!isP(nx, '(')) continue;
    const member = isP(pv, '.');
    let kind = null;
    if (t.v === 'join' || t.v === 'resolve') kind = !member || (pv2 && pv2.t === 'id' && ['path', 'posix', 'win32'].includes(pv2.v)) ? 'join' : null;
    else if (t.v === 'repoPath' || t.v === 'importRepo') kind = 'repo';
    else if (t.v === 'URL') kind = pv && pv.t === 'id' && pv.v === 'new' ? 'url' : null;
    if (!kind) continue;
    // the argument tokens, remembering which string tokens were consumed here
    const args = splitArgs(toks, k + 1);
    const idxOf = new Map();
    { let pos = k + 2, depth = 1, a = 0; idxOf.set(a, []); for (; pos < toks.length; pos++) { const x = toks[pos]; if (x.t === 'p' && '([{'.includes(x.v)) depth++; if (x.t === 'p' && ')]}'.includes(x.v)) { depth--; if (depth === 0) break; } if (depth === 1 && x.t === 'p' && x.v === ',') { a++; idxOf.set(a, []); continue; } idxOf.get(a).push(pos); } }
    const collect = (from, rel) => {
      for (let a = from; a < args.length; a++) {
        const p = pieceOf(args[a]);
        if (!p) break;
        for (const i of idxOf.get(a) || []) used.add(i);
        rel.push(p.text);
        if (p.partial) break;
      }
    };
    if (kind === 'url') {
      const meta = args[1] && args[1].some(x => x.t === 'id' && x.v === 'meta');
      const p = args[0] && pieceOf(args[0]);
      if (p && meta) { for (const i of idxOf.get(0) || []) used.add(i); paths.push({ base: 'file', rel: p.text, folder: false }); }
    } else if (kind === 'repo') {
      const rel = [];
      collect(0, rel);
      if (rel.length) paths.push({ base: 'root', rel: rel.join('/'), folder: true });
    } else if (args.length) {
      const rel = [];
      let base, folder;
      if (isRootVar(args[0])) { base = 'root'; folder = true; collect(1, rel); }
      else if (pieceOf(args[0])) { base = 'anc'; folder = true; collect(0, rel); }
      else { base = 'anc'; folder = false; collect(1, rel); }
      if (rel.length) paths.push({ base, rel: rel.join('/'), folder });
    }
  }
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (used.has(k)) continue;
    if (t.t === 'str' || (t.t === 'tpl' && !t.interp)) if (lit(t.v)) lits.push(t.v);
  }
  return { imports, paths, lits };
}

// yml / sh / ps1 / toml: tokens that look like a path (a comment line is skipped)
const PATH_TOKEN = /(?<![\w./@$-])(?:\.{1,2}\/)?[\w@.-]+(?:\/[\w@.*+-]+)+\/?/g;
export function scanTokens(src) {
  const lits = [];
  for (const line of String(src).split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    for (const m of line.matchAll(PATH_TOKEN)) if (!m[0].includes('*')) lits.push(m[0]);   // a glob is an entry point's business (entryPoints), not an edge
  }
  return { imports: [], paths: [], lits };
}

export function scanSql(src) {
  const lits = [];
  for (const m of String(src).matchAll(/^\\ir?\s+(\S+)/gm)) lits.push(m[1]);
  return { imports: [], paths: [], lits };
}

export function scanFile(path, text) {
  const ext = extOf(path);
  if (JS_EXT.has(ext)) return scanJs(text);
  if (ext === '.json') { const r = scanJs(text); return { imports: [], paths: [], lits: r.lits }; }
  if (ext === '.sql') return scanSql(text);
  return scanTokens(text);
}

// ------------------------------------------------------------------------------------------------ the graph
const globRe = g => new RegExp('^' + g.split('**').map(p => p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*') + '$');

// source: { files, readMany }. extraPaths: files that are not in the tree any more (deleted by the change) but are still named by others.
export function buildGraph(source, { extraPaths = [], noScan = [] } = {}) {
  const files = [...new Set([...source.files, ...extraPaths])].sort();
  const fileSet = new Set(files);
  const dirFiles = new Map();
  for (const f of files) {
    let d = dirOf(f);
    while (d !== '') { (dirFiles.get(d) || dirFiles.set(d, []).get(d)).push(f); d = dirOf(d); }
  }

  // a repo-relative candidate -> the files it names: a file, a glob's matches, or (two segments or more, when allowed) a folder's files
  const resolvePath = (cand, { folder = true } = {}) => {
    const c = normalizeRel(cand);
    if (c === null || c === '') return [];
    if (c.includes('*')) { const re = globRe(c); return files.filter(f => re.test(f)); }
    if (fileSet.has(c)) return [c];
    if (folder && dirFiles.has(c) && segCount(c) >= 2) return dirFiles.get(c);
    return [];
  };
  const resolveImport = (from, spec) => {
    if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
    const base = normalizeRel(`${dirOf(from)}/${spec}`);
    if (base === null) return null;
    for (const cand of [base, ...IMPORT_EXT.map(e => base + e), ...IMPORT_EXT.map(e => `${base}/index${e}`)]) if (fileSet.has(cand)) return cand;
    return null;
  };
  const fromAncestors = (from, rel, folder) => {
    let d = dirOf(from);
    for (;;) {
      const r = resolvePath(`${d}/${rel}`, { folder });
      if (r.length) return r;
      if (d === '') return [];
      d = dirOf(d);
    }
  };

  const imports = new Map(), reads = new Map();
  const add = (m, a, b) => { if (a !== b) (m.get(a) || m.set(a, new Set()).get(a)).add(b); };
  const inTree = new Set(source.files), skip = new Set(noScan);
  const scannable = files.filter(f => SCAN_EXT.has(extOf(f)) && !skip.has(f) && inTree.has(f));
  const texts = source.readMany(scannable);
  for (const f of scannable) {
    const text = texts.get(f);
    if (!text) continue;
    const s = scanFile(f, text);
    for (const spec of s.imports) { const to = resolveImport(f, spec); if (to) add(imports, f, to); }
    for (const p of s.paths) {
      let r;
      if (p.base === 'root') r = resolvePath(p.rel, { folder: p.folder });
      else if (p.base === 'file') r = resolvePath(`${dirOf(f)}/${p.rel}`, { folder: false });
      else r = fromAncestors(f, p.rel, p.folder);
      for (const to of r) add(reads, f, to);
    }
    for (const v of s.lits) {
      const rel = v.startsWith('./') || v.startsWith('../');
      const r = rel ? resolvePath(`${dirOf(f)}/${v}`, { folder: false }) : resolvePath(v);
      for (const to of r) add(reads, f, to);
    }
  }
  const reverse = m => { const out = new Map(); for (const [a, set] of m) for (const b of set) (out.get(b) || out.set(b, new Set()).get(b)).add(a); return out; };
  return { files, fileSet, imports, reads, importedBy: reverse(imports), readBy: reverse(reads), resolvePath };
}

// ------------------------------------------------------------------------------------------------ entry points: CI jobs and gates
// the [name, script] rows of `const GATES = [...]` in run-all-gates.mjs, read as data (the file is never imported)
export function parseGates(text) {
  const toks = tokenize(text);
  const rows = [];
  for (let k = 0; k + 3 < toks.length; k++) {
    if (!(toks[k].t === 'id' && toks[k].v === 'GATES' && toks[k + 1].t === 'p' && toks[k + 1].v === '=' && toks[k + 2].t === 'p' && toks[k + 2].v === '[')) continue;
    let depth = 1, row = null;
    for (let j = k + 3; j < toks.length && depth > 0; j++) {
      const t = toks[j];
      if (t.t === 'p' && t.v === '[') { depth++; if (depth === 2) row = []; }
      else if (t.t === 'p' && t.v === ']') { if (depth === 2 && row && row.length >= 2) rows.push([row[0], row[1]]); depth--; }
      else if (t.t === 'str' && depth === 2 && row) row.push(t.v);
    }
    break;
  }
  return rows;
}

// the jobs of ci.yml: { id, timeoutMinutes, run } where run is the text of every `run:` of the job
export function parseJobs(text) {
  const lines = String(text).split(/\r?\n/);
  const jobs = [];
  let inJobs = false, cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^jobs:\s*$/.test(l)) { inJobs = true; continue; }
    if (!inJobs) continue;
    if (/^\S/.test(l) && !/^\s*#/.test(l)) break;
    const jm = /^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(l);
    if (jm) { cur = { id: jm[1], name: jm[1], timeoutMinutes: null, run: '' }; jobs.push(cur); continue; }
    if (!cur) continue;
    const nm = /^ {4}name:[ \t]*(.+?)\s*$/.exec(l);          // the job's display name is what GitHub calls the job in a run
    if (nm) { cur.name = nm[1].replace(/^(['"])(.*)\1$/, '$2').replace(/\s+#.*$/, ''); continue; }
    const tm = /^ {4}timeout-minutes:\s*(\d+)/.exec(l);
    if (tm) { cur.timeoutMinutes = Number(tm[1]); continue; }
    const rm = /^(\s*)(?:- )?run:\s*(.*)$/.exec(l);
    if (!rm) continue;
    const indent = rm[1].length + (l.trimStart().startsWith('- ') ? 2 : 0);
    const val = rm[2].trim();
    if (/^[|>][+-]?\s*(?:#.*)?$/.test(val)) {
      let j = i + 1;
      while (j < lines.length && (lines[j].trim() === '' || lines[j].length - lines[j].trimStart().length > indent)) { cur.run += lines[j] + '\n'; j++; }
      i = j - 1;
    } else cur.run += val.replace(/^(['"])(.*)\1$/, '$2') + '\n';
  }
  return jobs;
}

export function closureOf(map, roots) {
  const seen = new Set(roots);
  const queue = [...roots];
  while (queue.length) {
    const f = queue.shift();
    for (const to of map.get(f) || []) if (!seen.has(to)) { seen.add(to); queue.push(to); }
  }
  return seen;
}

// -> [{ label: 'job functions' | 'gate function tests (Deno)', reach: Set<path> }]
// reach = the import closure of the entry's files, plus the files those read (one step). The secret scan job is left out: it covers every
// file and is no evidence that behaviour still works.
export function entryPoints(graph, source) {
  const entries = [];
  const reach = roots => {
    const closure = closureOf(graph.imports, roots);
    const out = new Set(closure);
    for (const f of closure) if (JS_EXT.has(extOf(f))) for (const to of graph.reads.get(f) || []) out.add(to);
    return out;
  };
  const gateText = source.read('docs/blueprint/specs/run-all-gates.mjs');
  const rows = gateText ? parseGates(gateText) : [];
  const gateRoots = [];
  for (const [name, script] of rows) {
    if (!graph.fileSet.has(script)) continue;
    gateRoots.push(script);
    entries.push({ label: `gate ${name}`, kind: 'gate', reach: reach([script]) });
  }
  const ciText = source.read('.github/workflows/ci.yml');
  if (ciText) {
    for (const job of parseJobs(ciText)) {
      if (/gitleaks/.test(job.run)) continue;
      const roots = [];
      for (const line of job.run.split('\n')) {
        if (/^\s*#/.test(line)) continue;
        for (const m of line.matchAll(PATH_TOKEN)) for (const f of graph.resolvePath(m[0])) roots.push(f);
      }
      if (/run-all-gates/.test(job.run)) roots.push(...gateRoots);
      if (roots.length) entries.push({ label: `job ${job.id}`, kind: 'job', reach: reach([...new Set(roots)]) });
    }
  }
  return entries;
}
