// Book check (hardening step H0-6, rule 36 in docs/product/11-rules.md): the product book checks itself. Called from
// check() in index.mjs, so CI's `node tools/icm/index.mjs --check` runs it. Node 20, no dependencies, no network.
// One plain line per problem, each starting "BOOK":
//   (a) every table in "### Counts" of docs/product/1-product.md equals the WORKS / PARTLY / MISSING rows of its part
//       (parts are the "### X. ..." sections, X any capital letter), and the Total row equals the sum of the parts;
//   (b) a WORKS row that names a repository path in backticks (a slash or a known extension; the short forms of the
//       "Short forms:" line are resolved; routes, M-numbers and plain words are skipped) names one that exists;
//   (c) a row of the hardening-steps table in docs/product/9-blocks.md has an owner, and a Row cell that names rows
//       of the book that exist; a part E row that no step names is a problem.
// A tree with neither book file (the test fixture) has nothing to check.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PRODUCT = 'docs/product/1-product.md';
const BLOCKS = 'docs/product/9-blocks.md';
const STATES = ['WORKS', 'PARTLY', 'MISSING'];
const PATH_EXT = /\.(?:mjs|cjs|js|ts|tsx|sql|md|json|ya?ml|toml|css|html|cmd|ps1|sh)$/i;
// folders a bare path in the book may be relative to, after the repository root
const BASES = ['', 'docs/product', 'supabase/functions'];

const cells = line => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
const isRow = line => /^\s*\|/.test(line) && !/^\s*\|[\s:|-]+\|\s*$/.test(line);

// "### A. The Omnikom CRM" sections with their feature rows, and the Counts table
export function parseProduct(text) {
  const parts = new Map(); // letter -> { title, rows: [{ id, state, line, cells }] }
  const counts = [];       // { label, nums: [w, p, m, rows], raw }
  const problems = [];
  let part = null, inCounts = false, sawCounts = false;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const h = /^### (.*)$/.exec(line);
    if (h) {
      const pm = /^([A-Z])\. (.*)$/.exec(h[1]);
      part = pm ? pm[1] : null;
      inCounts = h[1].trim() === 'Counts';
      if (inCounts) sawCounts = true;
      if (pm) parts.set(pm[1], { title: pm[2], rows: [] });
      continue;
    }
    if (/^#{1,3} /.test(line)) { part = null; inCounts = false; continue; }
    if (!isRow(line)) continue;
    const c = cells(line);
    if (inCounts) {
      if (/^Part$/i.test(c[0])) continue;
      const nums = c.slice(1, 5).map(x => (/^\d+$/.test(x) ? Number(x) : NaN));
      if (c.length < 5 || nums.some(Number.isNaN)) { problems.push(`BOOK COUNTS: the Counts row "${c[0]}" is not four whole numbers`); continue; }
      counts.push({ label: c[0], nums });
    } else if (part) {
      const m = /^([A-Z])(\d+)\b/.exec(c[0]);
      if (!m) continue; // the header row
      if (m[1] !== part) problems.push(`BOOK ROWS: ${m[1]}${m[2]} sits under part ${part}`);
      const state = (/^[A-Z]+/.exec(c[1]) || [''])[0];
      if (!STATES.includes(state)) problems.push(`BOOK ROWS: ${m[1]}${m[2]} has the state "${c[1]}", not WORKS, PARTLY or MISSING`);
      parts.get(part).rows.push({ id: m[1] + m[2], state, text: line, cells: c });
    }
  }
  return { parts, counts, sawCounts, problems };
}

// "Short forms: `D:` = `apps/dashboard/src/`, `F:x` = `supabase/functions/x/`" -> { 'D:': 'apps/dashboard/src/', 'F:': 'supabase/functions/' }
function shortForms(text) {
  const map = {};
  const line = text.split('\n').find(l => /^Short forms:/.test(l)) || '';
  for (const m of line.matchAll(/`([A-Z]:)(x?)` = `([^`]+)`/g)) map[m[1]] = m[2] ? m[3].replace(/x\/?$/, '') : m[3];
  return map;
}

function pathsIn(row, forms) {
  const out = [];
  for (const m of row.matchAll(/`([^`]+)`/g)) {
    let s = m[1].trim().replace(/#[\w-]+$/, '').replace(/:\d+(?:-\d+)?$/, '');
    if (!s || /[\s$*<>(){}=|]/.test(s) || s.startsWith('/')) continue;
    const short = /^([A-Z]:)(.+)$/.exec(s);
    if (short) {
      if (!forms[short[1]]) continue;
      s = forms[short[1]] + short[2];
      if (!s.endsWith('/') && !s.includes('.', s.lastIndexOf('/'))) s += '/';
    } else if (!s.includes('/') && !PATH_EXT.test(s)) continue;
    out.push({ shown: m[1].trim(), path: s });
  }
  return out;
}
const exists = (root, rel) => BASES.some(b => existsSync(join(root, b, rel)));

function countProblems(book) {
  const out = [];
  const sum = [0, 0, 0, 0];
  const labelOf = new Map(); // letter -> counts entry
  for (const c of book.counts) {
    const m = /^([A-Z]) /.exec(c.label);
    if (m) labelOf.set(m[1], c);
  }
  for (const [letter, p] of book.parts) {
    const got = STATES.map(s => p.rows.filter(r => r.state === s).length);
    got.push(p.rows.length);
    got.forEach((n, i) => { sum[i] += n; });
    const c = labelOf.get(letter);
    if (!c) { out.push(`BOOK COUNTS: part ${letter} has ${p.rows.length} rows but no row in the Counts table`); continue; }
    if (c.nums.join() !== got.join()) out.push(`BOOK COUNTS: part ${letter} says ${fmt(c.nums)} in the Counts table, its rows give ${fmt(got)}`);
  }
  for (const letter of labelOf.keys()) if (!book.parts.has(letter)) out.push(`BOOK COUNTS: the Counts table has a row for part ${letter}, which has no "### ${letter}." section`);
  const total = book.counts.find(c => /^Total$/i.test(c.label));
  if (!total) out.push('BOOK COUNTS: the Counts table has no Total row');
  else if (total.nums.join() !== sum.join()) out.push(`BOOK COUNTS: Total says ${fmt(total.nums)}, the parts' rows give ${fmt(sum)}`);
  return out;
}
const fmt = n => `${n[0]} works, ${n[1]} partly, ${n[2]} missing, ${n[3]} rows`;

function pathProblems(book, root, forms) {
  const out = [];
  for (const p of book.parts.values()) {
    for (const r of p.rows) {
      if (r.state !== 'WORKS') continue;
      for (const { shown, path } of pathsIn(r.text, forms)) {
        if (!exists(root, path)) out.push(`BOOK PATHS: ${r.id} is WORKS and names \`${shown}\`, which does not exist`);
      }
    }
  }
  return out;
}

function stepProblems(blocks, book) {
  const out = [];
  const known = new Set();
  for (const p of book.parts.values()) for (const r of p.rows) known.add(r.id);
  const named = new Set();
  let inSteps = false, col = null, found = false;
  for (const line of blocks.replace(/\r\n/g, '\n').split('\n')) {
    const h = /^#{1,6} (.*)$/.exec(line);
    if (h) { inSteps = /^Hardening steps/.test(h[1]); col = null; continue; }
    if (!inSteps || !isRow(line)) continue;
    const c = cells(line);
    if (!col) {
      const o = c.findIndex(x => /^Owner$/i.test(x)), r = c.findIndex(x => /^Row$/i.test(x));
      if (o >= 0 && r >= 0) { col = { owner: o, row: r }; found = true; }
      continue;
    }
    const step = c[0];
    if (!(c[col.owner] || '').trim()) out.push(`BOOK STEPS: step ${step} has no owner`);
    const rowCell = c[col.row] || '';
    if (!rowCell.trim()) out.push(`BOOK STEPS: step ${step} names no row of the book`);
    for (const id of rowCell.match(/\b[A-Z]\d+\b/g) || []) {
      named.add(id);
      if (!known.has(id)) out.push(`BOOK STEPS: step ${step} names row ${id}, which is not in ${PRODUCT}`);
    }
  }
  if (!found) out.push(`BOOK STEPS: ${BLOCKS} has no "Hardening steps" table with Owner and Row columns`);
  const e = book.parts.get('E');
  if (e) for (const r of e.rows) if (!named.has(r.id)) out.push(`BOOK STEPS: part E row ${r.id} is named by no hardening step`);
  return out;
}

export function checkBook(root) {
  const productPath = join(root, PRODUCT), blocksPath = join(root, BLOCKS);
  const hasP = existsSync(productPath), hasB = existsSync(blocksPath);
  if (!hasP && !hasB) return [];
  if (!hasP) return [`BOOK: ${PRODUCT} is missing`];
  if (!hasB) return [`BOOK: ${BLOCKS} is missing`];
  const text = readFileSync(productPath, 'utf8');
  const book = parseProduct(text);
  const lines = [...book.problems];
  if (!book.sawCounts) lines.push(`BOOK COUNTS: ${PRODUCT} has no "### Counts" section`);
  else lines.push(...countProblems(book));
  lines.push(...pathProblems(book, root, shortForms(text.replace(/\r\n/g, '\n'))));
  lines.push(...stepProblems(readFileSync(blocksPath, 'utf8'), book));
  return lines;
}
